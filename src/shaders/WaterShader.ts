/**
 * WaterShader.ts — Stylized water ShaderMaterial: a displaced wave field over
 * a camera-following grid, a Fresnel mirror over a depth-graded body colour,
 * light cut hard on the waves themselves, shoreline foam, cel banding.
 * Invariants: point-light uniform arrays are pre-allocated to MAX_POINT_LIGHTS
 * and filled by WaterSystem each frame from the same LightingSystem slots as
 * the cel shader. Opaque output. No Babylon lights. The wave field is SAMPLED
 * FROM NOTHING — there is no normal map and there must not be one again — and
 * the vertex and fragment stages evaluate the SAME field (`WAVES` below), so
 * the geometry and the light can never describe two different seas.
 * Both stages are hand-written WGSL, and `shaderLanguage` on the material is
 * load-bearing rather than declarative: a `ShaderMaterial` defaults to GLSL
 * and would look these up in a store nothing writes any more. See
 * `docs/rendering.md` for what the dialect and Babylon's WGSL processor decide.
 */
import {
  Scene,
  ShaderLanguage,
  ShaderMaterial,
  ShaderStore,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import {
  MAX_POINT_LIGHTS,
  PROBE_SAMPLER_NAMES,
  PROBE_UNIFORM_NAMES,
  SHADOW_SAMPLER_NAMES,
  SHADOW_UNIFORM_NAMES,
} from "./CelShader";
// The shared includes self-register in the IncludesShadersStoreWGSL; import
// them explicitly so the #include<cel...> lines below can never be tree-shaken
// away, and so registration is provably before the first effect COMPILE rather
// than merely before the first material.
import "./wgsl/includes";

/**
 * Water — the one surface in the game whose SHAPE moves, and the only one
 * whose colour is mostly somewhere else.
 *
 * ## What a water surface actually is
 *
 * **It is a mirror with a dark body under it, and the split between the two is
 * the view angle.** That sentence is still the whole composite: the grazing
 * end of the Fresnel has to return a PICTURE, or a pond seen from its own bank
 * is one flat colour from every vantage a player has.
 *
 * - the **body**, `deepColor` graded toward `shallowColor` over a shoal and
 *   then toward the map's own floor colour in the last few centimetres, off
 *   the baked bed-depth map, lit by the same banded key and ambient as the
 *   ground it sits in — banded on the SWELL's normal, so the tone patches are
 *   the shapes of the waves rather than of the chop;
 * - the **mirror**, the map's own dome with the light's glare in it, and a
 *   picture of the world out of the cube `ReflectionSystem` bakes per body —
 *   `celProbe`, never `celProbeBox` — following the swell and only part of
 *   the chop;
 * - **Schlick** between them, unbanded;
 * - the **light on the waves**, which is two hard cuts in DEGREES on the
 *   mirrored ray, asked of the full wave field, plus the light glowing
 *   THROUGH a backlit crest;
 * - the **foam**, crisp, at the waterline the bed-depth map knows about, and
 *   on the crests of a sea big enough to break;
 * - and the **atmosphere**, the cel shader's but for one ramp (see its note).
 *
 * ## The surface MOVES, and what that bought
 *
 * It used to be a plane with a normal painted on it, and 13 cm of implied
 * relief is all a plane can honestly carry: past about a quarter of a metre
 * the slope aims the mirrored ray at the ground behind the player, which a
 * surface that does not move cannot show. So the sea was a flat sheet with a
 * fine crinkle on it at every scale a player looked at, and that is exactly
 * what it read as. The swell is GEOMETRY now — the grid `WaterSystem` stands
 * under the camera is displaced by the same function the fragment lights, so
 * a crest can occlude the trough behind it, the waterline runs up the bank and
 * drains, and the ink finds the crests of a sea by the depth step they leave
 * exactly as it finds a roofline. A wave is drawn the way everything else here
 * is drawn, by its own silhouette.
 *
 * ## The wave field, and the three things in it that are load-bearing
 *
 * **There is no normal map and there must not be one again**: a lattice
 * sampled on a plane the size of a valley is a lattice you can see. A sum of
 * directional wave trains has none. The trains are built in TypeScript
 * (`waveTrains`, seeded, so every body of a partitioned sea sums the same
 * field and a seam is invisible) and handed over as two arrays.
 *
 * 1. **`exp(sin(x) - 1)` rather than `sin(x)`.** Water piles into a narrow
 *    crest and lies flat between; the exponential is the cheapest function
 *    with that asymmetry, and its derivative is itself times `cos`.
 * 2. **Each train is sampled where the ones above it have DRAGGED the point**
 *    (`waveDrag`). Sinusoids crossed at fixed bearings still beat on a period
 *    you can see; sliding the next train's sample toward this one's crest is
 *    what destroys the repeat, and it is also what bunches the chop onto the
 *    swell's crests, which is what a wind sea does.
 * 3. **The trains obey deep-water dispersion outright**, `omega = sqrt(g k)`.
 *    Short waves are slow waves, so the ripples crawl while the swell rolls;
 *    give every train one speed and the field slides across the pond as a
 *    sheet, which is the single most obvious scrolling-texture tell there is.
 *
 * **The spectrum is the MAP's and the steepness is the physics.** A map states
 * how tall its open-water swell is (`WaterEnvSpec.swell`); the longest train's
 * wavelength follows from `waves.steepness`, and everything finer from the
 * ratios. So a pond is all ripple and a sea rolls, with one number between
 * them. **And no wave may be taller than the water under it** (`waves.break`):
 * a flood meadow ankle-deep for twenty metres is calm because it is shallow,
 * not because anyone wrote a special case for it, while its ripples — far
 * shorter than the depth — survive.
 *
 * ## Two sampling tests, one per stage
 *
 * A train is DRAWN into the geometry only where the grid has the vertices to
 * carry it (`grid.detail`, in cells per wavelength — the grid is coarse away
 * from the camera, so the swell flattens out of the geometry with distance by
 * itself), and LIT only where the pixel can resolve it (`waves.detail`, in
 * pixels per wavelength off `fwidth`). A train too fine for the pixel is not
 * thrown away: its slope becomes ROUGHNESS, which blurs the mirror and widens
 * the glint while dimming it by the same factor, so the far reach of a lake
 * is a soft sheen rather than a hard egg of light.
 *
 * Output is opaque and display-ready (`imageProcessingEnabled` stays false).
 */

/**
 * The wave field, as WGSL, interpolated into BOTH stages so the two cannot
 * drift: the vertex stage displaces by `waves(...).h` and the fragment lights
 * by `waves(...).slope`, and a copy of either would be a sea whose light and
 * whose shape disagree the first time anybody tuned one of them.
 */
const WAVES = /* wgsl */ `
const MAX_TRAINS: i32 = ${CONFIG.water.waves.trains};
// The mean of exp(sin(x) - 1) over a period, I0(1)/e. Subtracted so the
// water's REST level is its mean level: a surface that only ever rose above
// surfaceY would move every waterline in the game up a few centimetres.
const WAVE_MEAN: f32 = 0.46576;

struct Waves {
  h: f32,        // metres about the rest surface
  slope: vec2f,  // dh/dx, dh/dz of every train drawn
  broad: vec2f,  // the same, of the swell alone
  crest: f32,    // 0..1, where on the swell's profile this is
  lost: f32,     // slope variance (rad^2) of the trains too fine to draw
  total: f32,    // slope variance of every train, for the ratio
}

// How tall a train of this amplitude may stand in this much water. A wave
// breaks at a height of about 0.78 of the depth, and 'waveBreak' is what that
// ratio is asked to be here; 'waveLap' is a floor under it at the waterline,
// so the very edge of the water still breathes rather than standing dead.
fn waveCap(amp: f32, depth: f32) -> f32 {
  return amp * clamp((depth + uniforms.waveLap) / (uniforms.waveBreak * amp), 0.0, 1.0);
}

/**
 * The surface at a point. 'cell' is how many metres one sample of it covers —
 * a grid cell in the vertex stage, a pixel's footprint in the fragment — and
 * 'lo'/'hi' are the samples-per-wavelength a train needs to be drawn at all
 * and drawn whole. 'early' lets the vertex stage stop at the first train it
 * cannot carry, which the fragment may not do: it still owes the rest as
 * roughness.
 */
fn waves(p0: vec2f, depth: f32, cell: f32, lo: f32, hi: f32, early: bool) -> Waves {
  var o: Waves;
  o.h = 0.0;
  o.slope = vec2f(0.0);
  o.broad = vec2f(0.0);
  o.lost = 0.0;
  o.total = 0.0;
  var crest = 0.0;
  var crestSum = 0.0;
  // A stream carries its whole field downstream; standing water has no flow.
  var p = p0 - uniforms.waveFlow * uniforms.time;
  for (var i = 0; i < MAX_TRAINS; i++) {
    if (f32(i) >= uniforms.trainCount) { break; }
    let a = uniforms.trainA[i]; // bearing.x, bearing.z, k, omega
    let b = uniforms.trainB[i]; // amplitude, phase, wavelength, broad
    let vis = smoothstep(lo, hi, b.z / max(cell, 1e-4));
    let amp = waveCap(b.x, depth);
    // The trains run longest first, so the first one this sample cannot
    // carry is the first of a tail it cannot carry either. The vertex stage
    // stops there; the fragment still owes the tail's slope as ROUGHNESS but
    // not its shape, which is a multiply rather than a sin, a cos and an exp —
    // most of the sea at a grazing angle is exactly this branch.
    if (vis <= 0.0) {
      if (early) { break; }
      let lost = 0.45 * a.z * amp;
      o.total += lost * lost;
      o.lost += lost * lost;
      continue;
    }
    let x = dot(a.xy, p) * a.z - uniforms.time * a.w + b.y;
    let s = sin(x);
    let c = cos(x);
    // Detail 1: sharp crests, flat troughs, and its own derivative.
    let e = exp(s - 1.0);
    let grad = a.xy * (e * c * a.z * amp);
    o.h += (e - WAVE_MEAN) * amp * vis;
    o.slope += grad * vis;
    o.broad += grad * vis * b.w;
    crest += e * amp * b.w;
    crestSum += amp * b.w;
    // The slope a train of this shape reaches, squared. What the pixel could
    // not draw of it is roughness, not nothing.
    let steep = 0.45 * a.z * amp;
    o.total += steep * steep;
    o.lost += (1.0 - vis) * steep * steep;
    // Detail 2: the next train is sampled where this one has dragged the
    // point — toward its crest, by as much as it is tall.
    p += a.xy * (e * c) * amp * uniforms.waveDrag;
  }
  o.crest = crest / max(crestSum, 1e-4);
  return o;
}
`;

/**
 * The bed depth under a point, off the baked map, in metres. The vertex stage
 * has no derivatives and so asks for level 0 explicitly; the fragment keeps
 * `textureSample` for the anisotropy argued at its call.
 */
const BED_UV = /* wgsl */ `
fn bedUv(xz: vec2f) -> vec2f {
  return (xz - uniforms.bounds.xy) / max(uniforms.bounds.zw - uniforms.bounds.xy, vec2f(0.001));
}

// The byte is SIGNED depth: 0 is 'depthDry' of bank above the surface and 1 is
// 'depthMax' of water under it, so the zero this returns is the real
// waterline. Negative is dry ground.
fn bedDepth(texel: f32) -> f32 {
  return texel * (uniforms.depthMax + uniforms.depthDry) - uniforms.depthDry;
}
`;

/** The uniforms both stages read. Declared in each, laid out once. */
const SHARED_UNIFORMS = /* wgsl */ `
uniform time: f32;
uniform bounds: vec4f;   // minX, minZ, maxX, maxZ — the rect
uniform surfaceY: f32;   // the rest level
uniform depthMax: f32;   // metres the depth byte saturates at
uniform depthDry: f32;   // metres of bank the byte reaches below zero

// --- the wave field (see waves() and waveTrains) ---
uniform trainA: array<vec4f, ${CONFIG.water.waves.trains}>;
uniform trainB: array<vec4f, ${CONFIG.water.waves.trains}>;
uniform trainCount: f32;
uniform waveFlow: vec2f;  // metres per second the whole field is carried
uniform waveDrag: f32;
uniform waveBreak: f32;
uniform waveLap: f32;

// --- the rotor wash: what a machine hovering over this water is doing to it ---
// One site per rotor working the surface, published by 'RotorWash'. xy = where
// the ring is standing, z = its radius (the DISC's, so the rim of the hole and
// the ring of spray particles are the same circle), w = 0..1, how hard. Both
// stages read it: the swell is pressed out of the GEOMETRY under the disc as
// well as out of the light, or the lit surface lies flat on a mesh still
// heaving under it.
uniform washSite: array<vec4f, ${CONFIG.water.wash.sites}>;
uniform washCount: f32;
uniform washFlatten: f32; // how much of the wind's field is pressed out

const ROTOR_WASH: i32 = ${CONFIG.water.wash.sites};

// How hard the rotors are shredding this point: the disc, 0..1. The one shape
// 'rotorWash' and the vertex stage both need, so it is written once.
fn washCore(p: vec2f) -> f32 {
  var churn = 0.0;
  for (var i = 0; i < ROTOR_WASH; i++) {
    if (f32(i) < uniforms.washCount) {
      let site = uniforms.washSite[i];
      let radius = max(site.z, 0.001);
      churn = max(churn, site.w
        * (1.0 - smoothstep(radius * 0.5, radius * 1.25, length(p - site.xy))));
    }
  }
  return churn;
}
`;

ShaderStore.ShadersStoreWGSL["waterVertexShader"] = `
// x, z: where this vertex stands relative to the grid's origin. y: how many
// metres of world one cell of the grid covers here — the grid is fine under
// the camera and coarse away from it, and this is what the vertex's own
// sampling test is asked against.
attribute position: vec3f;

uniform viewProjection: mat4x4f;
// Where the grid is standing: the camera, snapped to one near cell so the
// near vertices land on the same world points every frame and cannot swim.
uniform gridOrigin: vec2f;
uniform gridDetail: vec2f; // cells per wavelength: drawn at all, drawn whole
${SHARED_UNIFORMS}

var depthTexSampler: sampler;
var depthTex: texture_2d<f32>;

varying vPosW: vec3f;

${WAVES}
${BED_UV}

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  // **The rect is cut by CLAMPING, not by discarding.** The grid is axis
  // aligned and so is the rect, so clamping a cell's four corners into the
  // rect gives exactly the cell's overlap with it: a cell wholly outside
  // collapses to a line and draws nothing, and one straddling the shore is
  // trimmed to the edge. No fragment is discarded and no second mesh per
  // rect is built, and a camera-following grid can serve a pond and a sea
  // with the same geometry.
  let xz = clamp(vertexInputs.position.xz + uniforms.gridOrigin,
    uniforms.bounds.xy, uniforms.bounds.zw);
  let depth = bedDepth(textureSampleLevel(depthTex, depthTexSampler, bedUv(xz), 0.0).r);
  let w = waves(xz, depth, vertexInputs.position.y,
    uniforms.gridDetail.x, uniforms.gridDetail.y, true);
  let calm = 1.0 - washCore(xz) * uniforms.washFlatten;
  let worldPos = vec4f(xz.x, uniforms.surfaceY + w.h * calm, xz.y, 1.0);
  vertexOutputs.vPosW = worldPos.xyz;
  vertexOutputs.position = uniforms.viewProjection * worldPos;
}
`;

// The derivatives are what was MEANT — `fwidth(vPosW.xz)` IS the sampling
// criterion the whole lit field rests on, and every hard cut below is widened
// by its own fwidth — so there is no explicit-LOD form to reach for, and
// WGSL's uniformity analysis has to be told. Of the fetches below only the
// cube's LOD is explicit — its level IS the unresolved chop.
ShaderStore.ShadersStoreWGSL["waterFragmentShader"] = `
#define DISABLE_UNIFORMITY_ANALYSIS

varying vPosW: vec3f;

var foamTexSampler: sampler;
var foamTex: texture_2d<f32>;
var depthTexSampler: sampler;
var depthTex: texture_2d<f32>; // r = SIGNED bed depth (see bedDepth), over "bounds"
uniform camPos: vec3f;
${SHARED_UNIFORMS}

uniform lightDir: vec3f;
uniform lightColor: vec3f;
uniform ambientColor: vec3f;
// The hemispheric fill from the sky itself, the same term the cel shader gives
// the ground by n.y. Water is the most up-facing surface on any map, and
// leaving it out was what made a pond read as a hole in a lit field.
uniform skyLightColor: vec3f;
uniform fogColor: vec3f;
uniform fogParams: vec2f;  // x = start, y = end
uniform mistColor: vec3f;
uniform mistParams: vec2f; // x = height falloff, y = strength
// The top of the sky dome and the bright band under it, as the mirror
// returns them. The HORIZON end of the same gradient is fogColor.
uniform skyZenithColor: vec3f;
uniform skyHorizonColor: vec3f;

uniform deepColor: vec3f;
uniform shallowColor: vec3f;
uniform bedColor: vec3f;
uniform foamColor: vec3f;

uniform waveDetail: f32;     // pixels per wavelength a train needs to be lit

// --- the mirror ---
uniform reflectance: f32;    // Fresnel face-on. Water is about 0.02
uniform fresnelPower: f32;   // Schlick is 5. Lower brings the sheen on sooner
uniform sunHalo: f32;        // cosine half-width of the light's soft glare
uniform haloStrength: f32;
uniform mirrorBlur: f32;     // mip levels the unresolved chop blurs it by
uniform mirrorChop: f32;     // share of the chop the PICTURE follows (the light takes all)

// --- the light on the waves: two hard cuts on the mirrored ray ---
uniform glintCut: f32;       // radians — the core, where a facet shows the light
uniform glintStrength: f32;
uniform sheenCut: f32;       // radians — the path of light round it
uniform sheenStrength: f32;
uniform lampCut: vec2f;      // the same pair for a point light, radians
// Light through a backlit crest: how much, and where on the swell it starts.
uniform throughStrength: f32;
uniform throughCrest: f32;

// --- the bed ---
uniform depthFade: f32;  // metres over which the body reaches deepColor
uniform bedDepth: f32;   // metres over which the bed stops showing through
uniform bedShow: f32;    // how much of the bed shows at zero depth
uniform caustics: f32;   // crest-focused light on a shoal
uniform scatter: f32;    // share of the key the body takes facing any way

// --- the foam ---
uniform foamWidth: f32;
uniform foamScale: f32;
uniform foamSpeed: f32;
uniform foamSlope: f32;  // the flattest bed the foam line is measured against
uniform crestFoam: f32;  // whitecaps, on a swell big enough to break
uniform capLevel: f32;   // how near the crest a cap may start
uniform fleckStrength: f32; // scum drifting out on the open water

// --- the rotor wash: what a machine hovering over this water is doing to it ---
// One site per rotor working the surface, published by 'RotorWash'. xy = where
// the ring is standing, z = its radius (the DISC's, so the rim of the hole and
// the ring of spray particles are the same circle), w = 0..1, how hard.
uniform washReach: f32;   // multiples of the radius the rings run out to
uniform washBlur: f32;    // roughness added to the mirror inside the disc
uniform washFoam: f32;    // whitewater across it
// The rings themselves, deliberately the same three numbers a wave train
// states, because that is what they are — one train bent into a circle.
uniform washHeight: f32;
uniform washLength: f32;
uniform washSpeed: f32;

uniform pointPos: array<vec3f, ${MAX_POINT_LIGHTS}>;
uniform pointColor: array<vec3f, ${MAX_POINT_LIGHTS}>; // rgb premultiplied by intensity
uniform pointRange: array<f32, ${MAX_POINT_LIGHTS}>;
uniform pointCount: f32;

// Both counts reach the declarations above by INTERPOLATION and the loop bounds
// below as real consts, and the split is forced rather than stylistic: a
// uniform array's size must be a literal or a #define, because Babylon resolves
// the bound out of the preprocessor table when it lays out the leftover UBO and
// a WGSL const is not in that table. GrassShader settled this.
const MAX_POINT_LIGHTS: i32 = ${MAX_POINT_LIGHTS};
const TAU: f32 = 6.2831853;

#include<celBand>
#include<celShadow>
#include<celProbe>
#include<celDither>

${WAVES}
${BED_UV}

// Rotates a uv about the origin. The foam mask is the one tiled image left in
// this shader, and a lattice sampled straight off world X/Z is parallel to the
// plane's own edges, which is what reads as "the pattern".
fn swirl(p: vec2f, c: f32, s: f32) -> vec2f {
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

// A step one pixel wide and no wider — the foam, the caps and every light on
// the waves are HARD edges in the frame's own vocabulary, and a hard edge with
// nothing under it to antialias it has to antialias itself.
fn aastep(edge: f32, x: f32) -> f32 {
  let w = max(fwidth(x), 1e-5);
  return smoothstep(edge - w, edge + w, x);
}

// The cel shader's band(), with its edge one pixel wide and no wider.
//
// **The shared band() has a FLOOR on its edge, and on water that floor is the
// whole picture.** It is 0.15 of a band — nothing on a facet, whose index
// barely moves across a wall — but the swell turns its normal a few degrees
// over metres, so 0.15 of a band is a ramp the size of the wave, and the
// tone patches it was meant to cut arrived as soft translucent lobes that
// read as ghosts on the night maps. The swell is what these bands are drawn
// on, so the edge is the pixel's and nothing else's.
fn waterBand(ndl: f32, steps: f32) -> f32 {
  let x = ndl * steps;
  let w = clamp(fwidth(x), 0.01, 0.5);
  return min((floor(x) + smoothstep(0.5 - w, 0.5 + w, fract(x))) / steps, 1.0);
}

// Inside a cone of half-angle 'cut' about 'axis', cut hard. The edge is widened
// by the angle's own fwidth — clamped, because where the chop turns the normal
// faster than a pixel the fwidth is enormous and the cut would dissolve into a
// smear, which is the continuous-tone glare this term exists NOT to be.
fn cone(dir: vec3f, axis: vec3f, cut: f32) -> f32 {
  let ang = acos(clamp(dot(dir, axis), -1.0, 1.0));
  let w = clamp(fwidth(ang), 1e-4, cut * 0.5);
  return 1.0 - smoothstep(cut - w, cut + w, ang);
}

// What a rotor is doing to one patch of water. See rotorWash.
struct Wash {
  churn: f32,   // 0..1 — this water is being atomised rather than waved
  foam: f32,    // 0..1 — whitewater, into the shoreline foam's own mix
  slope: vec2f, // metres of relief per world metre, from the rings running out
}

/**
 * What the rotors over this water are doing to it, summed over the sites.
 *
 * ## A downwash is a HOLE, not a wave
 *
 * Concentric rings spreading from a point is a raindrop rather than a
 * helicopter: what a rotor puts on water is a dark, matted disc with a white
 * rim, and the rings are only the wake running out from under it. So the disc
 * is drawn FIRST and the rings start at its rim. The disc is three of the
 * numbers the surface already has, spent the other way: the ordered swell is
 * pressed out ('washFlatten'), the mirror is roughened ('washBlur') — the
 * term that actually reads as a hole — and it foams ('washFoam') into the
 * shoreline's own mix. The rings take the wave trains' sampling test for their
 * reason; the disc takes none, because a smooth thing has nothing to alias.
 * Sites are WORLD positions and every body is handed the same list, so a wash
 * on the seam between two rects is one hole in one sea.
 */
fn rotorWash(p: vec2f, footprint: f32) -> Wash {
  var w: Wash;
  w.churn = 0.0;
  w.foam = 0.0;
  w.slope = vec2f(0.0);
  let k = TAU / max(uniforms.washLength, 0.05);
  let vis = smoothstep(1.0, uniforms.waveDetail,
    uniforms.washLength / max(footprint, 1e-4));
  for (var i = 0; i < ROTOR_WASH; i++) {
    if (f32(i) < uniforms.washCount) {
      let site = uniforms.washSite[i];
      let radius = max(site.z, 0.001);
      let to = p - site.xy;
      let d = length(to);
      let reach = radius * uniforms.washReach;
      // The churn is the disc; the froth piles into an annulus at the rim,
      // because a downwash pushes the surface OUT.
      let core = site.w * (1.0 - smoothstep(radius * 0.5, radius * 1.25, d));
      w.churn = max(w.churn, core);
      let rim = smoothstep(0.0, radius * 0.75, d);
      w.foam = max(w.foam, core * uniforms.washFoam * mix(0.3, 1.0, rim));
      let out = max(d - radius, 0.0);
      let phase = k * (out - uniforms.time * uniforms.washSpeed);
      let h = exp(sin(phase) - 1.0);
      let amp = uniforms.washHeight * site.w * vis
        * smoothstep(0.0, radius * 0.35, out)
        * (1.0 - smoothstep(0.0, max(reach - radius, 0.001), out));
      w.slope += (to / max(d, 1e-4)) * (h * cos(phase) * k) * amp;
    }
  }
  return w;
}

/**
 * The map's own sky, at an elevation, and it is the SAME gradient 'Sky'
 * paints onto the dome — the four stops read off 'paintDomeTexture'. A
 * two-colour lerp is what a mirror this big cannot use: a pond is a third of
 * the screen and its Fresnel is 1 at every angle a player looks at it from,
 * so whatever this function returns IS the water.
 */
fn domeAt(y: f32) -> vec3f {
  let v = acos(clamp(y, -1.0, 1.0)) * 0.3183099; // /PI: 0 zenith, 0.5 horizon
  let mid = mix(uniforms.skyZenithColor, uniforms.skyHorizonColor, 0.5);
  if (v < 0.28) { return mix(uniforms.skyZenithColor, mid, v / 0.28); }
  if (v < 0.43) { return mix(mid, uniforms.skyHorizonColor, (v - 0.28) / 0.15); }
  return mix(uniforms.skyHorizonColor,
    mix(uniforms.skyHorizonColor, uniforms.fogColor, 0.6),
    (v - 0.43) / 0.07);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let posW = fragmentInputs.vPosW;
  let viewDist = length(posW - uniforms.camPos);
  let viewDir = normalize(uniforms.camPos - posW);
  let up = vec3f(0.0, 1.0, 0.0);
  // How much world one pixel covers. The whole distance story is told here.
  let fw = fwidth(posW.xz);
  let footprint = max(max(fw.x, fw.y), 1e-4);

  // --- bed depth, off the baked map (metres) ---
  // textureSample and NOT textureSampleLevel: the sampler is anisotropic
  // (Babylon enables it for BILINEAR whether or not the texture carries
  // mips), and an explicit level 0 turns that off — a single bilinear tap
  // that moved the far shoreline of Harrowmead's millpond by up to 28/255.
  // See docs/rendering.md.
  let restDepth = bedDepth(textureSample(depthTex, depthTexSampler, bedUv(posW.xz)).r);

  // --- the surface ---
  let wv = waves(posW.xz, restDepth, footprint, 1.0, uniforms.waveDetail, false);
  // The water actually standing over the bed HERE: the displaced surface's
  // own height, so a trough over a bank is shallower than a crest and shows
  // more of the bed — the lap is in the colour as well as the waterline.
  let depth = max(restDepth + (posW.y - uniforms.surfaceY), 0.0);
  let shoal = exp(-depth / max(uniforms.depthFade, 0.001));

  // What a rotor over this patch is doing to it — nothing at all on every map
  // and every frame with no machine low over the water.
  let wash = rotorWash(posW.xz, footprint);
  let calm = 1.0 - wash.churn * uniforms.washFlatten;
  let slope = wv.slope * calm + wash.slope;
  let n = normalize(vec3f(-slope.x, 1.0, -slope.y));
  // The swell alone: what the body's tone patches follow, so they are the
  // shapes of the WAVES rather than of the chop on them.
  let broadSlope = wv.broad * calm + wash.slope;
  let nb = normalize(vec3f(-broadSlope.x, 1.0, -broadSlope.y));

  // --- the key light over the body colour ---
  // Gated by the same shadow map as the bank it laps against. The offset
  // normal is the FLAT up-vector: a shadow's edge must not slide back and
  // forth with the chop. And the clouds', which takes the glare off the water
  // under one.
  let shade = min(shadowVisibility(up, posW), cloudLit(posW));
  let light = uniforms.ambientColor
    + uniforms.skyLightColor * waterBand(0.5 + 0.5 * nb.y, 3.0)
    + uniforms.lightColor * shade * mix(uniforms.scatter, 1.0,
      waterBand(max(dot(nb, -uniforms.lightDir), 0.0), 3.0))
    + flashLight(nb, up, posW);

  // The body: deep water, paling over a shoal, and then the bed itself in the
  // last few centimetres. 'bedColor' is the MAP's own floor colour, so a
  // waterline grades into the bank it is cut in.
  var body = mix(uniforms.deepColor, uniforms.shallowColor, shoal);
  let through = exp(-depth / max(uniforms.bedDepth, 0.001)) * uniforms.bedShow;
  body = mix(body, uniforms.bedColor, through);
  var col = body * light;

  // Light focused by the crests onto a shallow bed. SOFT, the one term here
  // that is: a caustic is a network finer than anything this field resolves,
  // and cut hard on the swell's crests it drew a flat pale lobe under every
  // wave in a shallow pond — ghosts, on the night maps. A brightening that
  // rides the crest is what is left of it that can be drawn honestly.
  col += uniforms.lightColor * uniforms.caustics
    * smoothstep(0.35, 0.8, wv.crest) * shoal * shade;

  // --- the mirror ---
  // **The PICTURE follows the swell and only part of the chop; the LIGHT
  // follows all of it.** That split is the stylisation, and it is how water
  // is painted: the reflection of the far bank is a few smooth, wobbling
  // shapes, and the sun on the same water is a scatter of hard sparks. Asked
  // of one normal, the chop steep enough to break the sun into glitter also
  // breaks the reflection into foil — which is what every photographic water
  // shader does, and exactly what did not belong in this frame.
  let seenSlope = broadSlope + (slope - broadSlope) * uniforms.mirrorChop;
  let nm = normalize(vec3f(-seenSlope.x, 1.0, -seenSlope.y));
  let bounced = reflect(-viewDir, n);
  let seen = reflect(-viewDir, nm);
  // A ripple steep enough to aim the ray under the horizon returns the
  // underside of the map; clamp it to a grazing sky instead.
  let mirrored = normalize(vec3f(seen.x, max(seen.y, 0.02), seen.z));
  var sky = domeAt(mirrored.y);
  // The light's own glare, soft and broad — what the sky itself looks like
  // round the sun, reflected. The hard light is below, cut on the waves.
  sky += uniforms.lightColor * uniforms.haloStrength
    * smoothstep(uniforms.sunHalo, 1.0, dot(mirrored, -uniforms.lightDir)) * shade;
  // The unresolved chop, as roughness: the share of the field's slope the
  // pixel could not draw. It blurs the reflection and — below — widens the
  // light's cone. The wash's churn is the same claim about a torn surface.
  let unresolved = sqrt(wv.lost / max(wv.total, 1e-8));
  let rough = clamp(unresolved + wash.churn * uniforms.washBlur, 0.0, 1.0);
  // The world, out of the cube: sampled along the raw mirrored ray with NO
  // parallax correction (the far bank is far enough that a skybox read is
  // right, and a box the size of the map collapses the reflection to one
  // colour). An EXPLICIT LOD, because a cube direction's derivative across a
  // grazing pixel is enormous and the automatic mip is the whole cube's
  // average. Un-premultiplied by hand, as the glazing does it.
  let cube = textureSampleLevel(reflectionCube, reflectionCubeSampler,
    probeCubeDir(mirrored), rough * uniforms.mirrorBlur);
  let mirror = mix(sky, cube.rgb / max(cube.a, 0.001),
    cube.a * uniforms.reflectProbe.w);

  // Schlick, deliberately NOT banded: a band edge here is a contour drawn
  // across the pond where the view angle crosses a step, sliding over it as
  // the player walks. Off the picture's normal,
  // so the mix between the body and the mirror is as smooth as the mirror.
  let fres = uniforms.reflectance + (1.0 - uniforms.reflectance)
    * pow(1.0 - max(dot(viewDir, nm), 0.0), uniforms.fresnelPower);
  col = mix(col, mirror, fres);

  // --- light THROUGH a backlit crest ---
  // Looking toward a low light, the thin top of a wave is lit from behind and
  // glows the colour of the water rather than the sky. It needs the light in
  // FRONT of the viewer, a crest (thin water) and a face turned toward the
  // eye, and it arrives through the body, so it is what the Fresnel leaves.
  // Two hard steps of it, never a gradient.
  let flatView = normalize(viewDir.xz + vec2f(1e-5, 0.0));
  let flatLight = normalize(uniforms.lightDir.xz + vec2f(1e-5, 0.0));
  let backlit = max(dot(flatView, flatLight), 0.0);
  let facing = clamp(dot(-broadSlope, flatView) * 6.0, 0.0, 1.0);
  let lift = backlit * backlit * facing
    * smoothstep(uniforms.throughCrest, 1.0, wv.crest);
  let glow = 0.5 * aastep(0.2, lift) + 0.5 * aastep(0.5, lift);
  col += uniforms.lightColor * uniforms.shallowColor * uniforms.throughStrength
    * glow * (1.0 - fres) * shade;

  // --- the light on the waves ---
  // **Every light on the water is asked of the WAVES, and cut hard in
  // DEGREES.** A facet whose mirrored ray lands within 'glintCut' of the light
  // shows the light; one within 'sheenCut' shows the path of light round it.
  // Nothing here is a lattice or a clock: where the glints are is where the
  // wave field puts a facet, and they move because the waves do. The chop too
  // fine to draw widens both cones and spends the same light over the wider
  // one, so a far reach dims into the soft glare rather than drawing the
  // light's image as a hard egg on water gone flat.
  let spread = 2.0 * sqrt(wv.lost);
  let gCut = sqrt(uniforms.glintCut * uniforms.glintCut + spread * spread);
  let sCut = sqrt(uniforms.sheenCut * uniforms.sheenCut + spread * spread);
  let gEnergy = (uniforms.glintCut / gCut) * (uniforms.glintCut / gCut);
  let sEnergy = (uniforms.sheenCut / sCut) * (uniforms.sheenCut / sCut);
  // Face-on water still shows a facet the sun, just less of it.
  let facet = mix(0.35, 1.0, fres);
  col += uniforms.lightColor * shade * facet
    * (uniforms.glintStrength * gEnergy * cone(bounced, -uniforms.lightDir, gCut)
      + uniforms.sheenStrength * sEnergy * cone(bounced, -uniforms.lightDir, sCut));

  // --- point lights: a little diffuse lift, and the same two cuts ---
  // A lamp on the far bank lays a broken column of light across the water
  // toward the eye, for the reason the sun does.
  for (var i = 0; i < MAX_POINT_LIGHTS; i++) {
    if (f32(i) < uniforms.pointCount) {
      let toLight = uniforms.pointPos[i] - posW;
      let dist = length(toLight);
      var atten = clamp(1.0 - dist / max(uniforms.pointRange[i], 0.001), 0.0, 1.0);
      atten *= atten;
      let ldir = toLight / max(dist, 0.001);
      let lndl = max(dot(nb, ldir), 0.0);
      // Cone and atlas off the flat up-vector, for the moon's reason.
      var loc = vec2f(1.0, -1.0);
      if (atten > 0.0) {
        loc = pointLocal(i, posW, up);
      }
      let vis = select(1.0, loc.y, loc.y >= 0.0);
      let lampG = sqrt(uniforms.lampCut.x * uniforms.lampCut.x + spread * spread);
      let lampS = sqrt(uniforms.lampCut.y * uniforms.lampCut.y + spread * spread);
      let hits = cone(bounced, ldir, lampG) * (uniforms.lampCut.x / lampG)
        + 0.35 * cone(bounced, ldir, lampS) * (uniforms.lampCut.y / lampS);
      col += uniforms.pointColor[i] * atten * loc.x * vis
        * (body * lndl * 0.5 + hits * facet * 0.9);
    }
  }

  // Same soft shoulder as the cel shader, so stacked lights stay tinted.
  let over = max(col - 0.75, vec3f(0.0));
  col = min(col, vec3f(0.75)) + 0.25 * over / (1.0 + over);

  // --- foam ---
  // Two takes of the mask at different scales and angles, because one is a
  // 3 m tile and a shoreline is longer than that. textureSample on all three:
  // the mask carries mips, and trilinear is what the tiling needs at range.
  let drift = vec2f(uniforms.time * uniforms.foamSpeed);
  let mask = textureSample(foamTex, foamTexSampler,
    swirl(posW.xz, 0.8020, -0.5972) * uniforms.foamScale + drift).r * 0.65
    + textureSample(foamTex, foamTexSampler,
      swirl(posW.xz, -0.1455, 0.9894) * uniforms.foamScale * 2.3 - drift * 0.6).r * 0.45;
  // The shoreline: the nearer of the rect's edge and the real waterline.
  //
  // **How far the waterline IS, in metres, rather than how shallow the water
  // is.** Depth over the bed's own slope is the distance to where the bed
  // comes out of the water, so the foam is a line of one width on a steep bank
  // and on a gentle one alike. Keyed on depth alone it was a line on the steep
  // bank and a SHEET on the gentle one: a flat just awash is shallow over its
  // whole area, and it foamed white from one side to the other in the middle
  // of Cinderhaven's bay. The slope is two more taps of the bed map; the
  // floor under it is the flattest bed the line is measured against.
  //
  // The depth is the DISPLACED one, so the line runs up the bank under a crest
  // and drains behind it — the lapping is the swell's, not a clock of its own.
  let texel = 1.0 / vec2f(textureDimensions(depthTex));
  let bedAt = bedUv(posW.xz);
  let bedX = textureSample(depthTex, depthTexSampler, bedAt + vec2f(texel.x, 0.0)).r
    - textureSample(depthTex, depthTexSampler, bedAt - vec2f(texel.x, 0.0)).r;
  let bedZ = textureSample(depthTex, depthTexSampler, bedAt + vec2f(0.0, texel.y)).r
    - textureSample(depthTex, depthTexSampler, bedAt - vec2f(0.0, texel.y)).r;
  let perTexel = (uniforms.bounds.zw - uniforms.bounds.xy) * texel * 2.0;
  let bedSlope = length(vec2f(bedX, bedZ) / perTexel)
    * (uniforms.depthMax + uniforms.depthDry);
  let edge = min(posW.xz - uniforms.bounds.xy, uniforms.bounds.zw - posW.xz);
  let shore = min(min(edge.x, edge.y),
    depth / max(bedSlope, uniforms.foamSlope));
  let foamBand = 1.0 - smoothstep(0.0, uniforms.foamWidth, shore);
  // CRISP, and a LACE rather than a lip: hard edges, broken even at the
  // waterline itself, thinning to scattered scraps as the band runs out. A
  // solid strip — which is what a band that fills whenever it is full draws —
  // on a gentle bank is a metre of white paint along the shore.
  let foam = aastep(0.6, foamBand * (0.35 + 0.75 * mask));
  // Whitecaps: only on a swell tall enough to break, only at its crests, and
  // only where the mask is thick — a SCRAP riding the crest, not the crest.
  // Gated on the crest alone, the top of the nearest big wave went white from
  // end to end, which read as a sandbar in the middle of the bay.
  let capMask = textureSample(foamTex, foamTexSampler,
    swirl(posW.xz, 0.3907, 0.9205) * uniforms.foamScale * 1.7 + drift * 1.4).r;
  let caps = aastep(uniforms.capLevel, wv.crest) * aastep(0.62, capMask)
    * uniforms.crestFoam;
  // Sparse flecks out in the open water, kept OUT of the band.
  let flecks = aastep(0.9, textureSample(foamTex, foamTexSampler,
    swirl(posW.xz, -0.9284, -0.3717) * uniforms.foamScale * 0.6 - drift * 0.7).r)
    * uniforms.fleckStrength * (1.0 - foamBand);
  // Never all the way to the foam colour: a broad shoal foamed solid reads as
  // snow. The wash's whitewater lands in the same mix and is broken by the
  // same drifting mask.
  col = mix(col, uniforms.foamColor * light,
    clamp(foam * 0.85 + caps + flecks + wash.foam * (0.55 + 0.45 * mask),
      0.0, 1.0));

  // --- atmosphere: the cel shader's, with one difference ---
  // The mist's range ramp is SMOOTHSTEPPED here where the cel shader clamps
  // it. A clamped ramp has a kink where it starts, six metres from the eye,
  // and on a textured bank nothing shows it; on a surface this smooth it drew
  // a ring round the player's feet on every map. The two agree to a couple of
  // percent everywhere a waterline can be, which the bank's grain swallows.
  let mist = uniforms.mistParams.y
    * exp(-max(posW.y, 0.0) / max(uniforms.mistParams.x, 0.001))
    * smoothstep(6.0, 51.0, viewDist);
  col = mix(col, uniforms.mistColor, clamp(mist, 0.0, 0.9));
  let fog = clamp(
    (viewDist - uniforms.fogParams.x)
      / (uniforms.fogParams.y - uniforms.fogParams.x), 0.0, 1.0);
  col = mix(col, uniforms.fogColor, fog * fog);

  // Alpha 0, for the reason the grass writes 0: the frame's alpha channel is
  // TRANSLUCENT COVERAGE and the water is opaque. See CelInk.
  fragmentOutputs.color = vec4f(dither(col), 0.0);
}
`;

/** Uniforms the WaterSystem pushes per frame / per round. */
const WATER_UNIFORMS = [
  "viewProjection",
  "gridOrigin",
  "gridDetail",
  "time",
  "camPos",
  "surfaceY",
  "lightDir",
  "lightColor",
  "ambientColor",
  "skyLightColor",
  "fogColor",
  "fogParams",
  "mistColor",
  "mistParams",
  "skyZenithColor",
  "skyHorizonColor",
  "deepColor",
  "shallowColor",
  "bedColor",
  "foamColor",
  "bounds",
  "trainA",
  "trainB",
  "trainCount",
  "waveFlow",
  "waveDrag",
  "waveBreak",
  "waveLap",
  "waveDetail",
  "reflectance",
  "fresnelPower",
  "sunHalo",
  "haloStrength",
  "mirrorBlur",
  "mirrorChop",
  "glintCut",
  "glintStrength",
  "sheenCut",
  "sheenStrength",
  "lampCut",
  "throughStrength",
  "throughCrest",
  "depthMax",
  "depthDry",
  "depthFade",
  "bedDepth",
  "bedShow",
  "caustics",
  "scatter",
  "foamWidth",
  "foamScale",
  "foamSpeed",
  "foamSlope",
  "crestFoam",
  "capLevel",
  "fleckStrength",
  "washSite",
  "washCount",
  "washReach",
  "washFlatten",
  "washBlur",
  "washFoam",
  "washHeight",
  "washLength",
  "washSpeed",
  "pointPos",
  "pointColor",
  "pointRange",
  "pointCount",
];

/**
 * The trains one body's surface is summed from: two vec4s each, as the shader
 * reads them — `a` is the bearing (x, z), the wavenumber and the angular
 * speed; `b` is the amplitude (m), the phase, the wavelength (m) and whether
 * the train is part of the SWELL the body's tone patches follow.
 *
 * **Seeded and never random, and the seed is not the body's.** A sea is
 * partitioned into rects (Cinderhaven's is eight), and a rect that summed a
 * different field from its neighbour would draw the seam between them as a
 * line across the bay. So every body on every map sums the same trains, and
 * the only thing that differs is how TALL they are, which is the map's.
 */
export interface WaveTrains {
  a: Float32Array;
  b: Float32Array;
  count: number;
  /** The tallest the surface stands above its rest level, metres. */
  crest: number;
}

export function waveTrains(swell: number): WaveTrains {
  const w = CONFIG.water.waves;
  const a = new Float32Array(w.trains * 4);
  const b = new Float32Array(w.trains * 4);
  // mulberry32 — the seeded generator's shape everywhere else in the tree.
  let seed = w.seed >>> 0;
  const rand = (): number => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let lambda = swell / w.steepness;
  let amp = swell;
  let count = 0;
  let crest = 0;
  for (let i = 0; i < w.trains && lambda >= w.ripple; i++) {
    // The swell holds close to its bearing and the chop comes from anywhere:
    // a wind sea's spread widens as its waves shorten.
    const t = w.trains > 1 ? i / (w.trains - 1) : 0;
    const spread = w.spread[0] + (w.spread[1] - w.spread[0]) * t;
    const bearing = w.bearing + (rand() * 2 - 1) * spread;
    const k = (2 * Math.PI) / lambda;
    // Detail 3: deep-water dispersion, outright.
    const omega = Math.sqrt(9.81 * k) * w.speed;
    a.set([Math.cos(bearing), Math.sin(bearing), k, omega], i * 4);
    b.set([amp, rand() * Math.PI * 2, lambda, i < w.broad ? 1 : 0], i * 4);
    crest += amp * (1 - 0.46576);
    count++;
    // Never an exact ratio: an exact one puts every crest on a harmonic of
    // the swell's, and harmonics beat.
    lambda /= w.lacunarity * (1 + (rand() * 2 - 1) * w.jitter);
    amp *= w.gain;
  }
  return { a, b, count, crest };
}

/** What a body's shape is, as `WaterSystem` works it out per rect. */
export interface WaterSurface {
  /** The rest level, metres. */
  y: number;
  /** The field it sums. */
  trains: WaveTrains;
  /** Metres per second its whole field is carried; zero for standing water. */
  flow: Vector2;
  /** How far a crest may break toward the foam colour — the map's sea state. */
  caps: number;
  /** How much light shows through a backlit crest — none on a ripple. */
  through: number;
}

/**
 * One water material per body (each carries its own shoreline `bounds`, its own
 * baked bed-depth map and its own reflection probe). Motion and shape come from
 * `CONFIG.water` and the body's own `WaterSurface`; palette, lighting and the
 * mirror are set by the WaterSystem from the map's environment and from
 * `ReflectionSystem`.
 *
 * Every uniform the fragment shader reads is written here or by the system —
 * `foamParams` was once declared, read and never uploaded, which silently
 * zeroed the foam on every map. **Add a uniform to the shader and it owes a
 * line here and a name in `WATER_UNIFORMS`.**
 *
 * `reflectionCube` is the one exception and it is deliberate: it is bound by
 * `WaterSystem.build` from the probe the reflection callback hands back inside
 * the same call, so a material never exists for a frame without one — and
 * under WebGPU **a sampler a material DECLARES has to be BOUND, used or not**,
 * or the bind group fails to build and every draw with it is lost.
 */
export function createWaterMaterial(
  scene: Scene,
  name: string,
  textures: { foam: Texture; depth: Texture },
  bounds: Vector4,
  surface: WaterSurface,
): ShaderMaterial {
  const mat = new ShaderMaterial(
    name,
    scene,
    { vertex: "water", fragment: "water" },
    {
      attributes: ["position"],
      uniforms: [
        ...WATER_UNIFORMS,
        ...SHADOW_UNIFORM_NAMES,
        ...PROBE_UNIFORM_NAMES,
      ],
      samplers: [
        "foamTex",
        "depthTex",
        ...SHADOW_SAMPLER_NAMES,
        ...PROBE_SAMPLER_NAMES,
      ],
      shaderLanguage: ShaderLanguage.WGSL,
    },
  );
  const w = CONFIG.water;
  const deg = Math.PI / 180;
  mat.setTexture("foamTex", textures.foam);
  mat.setTexture("depthTex", textures.depth);
  mat.setVector4("bounds", bounds);
  mat.setFloat("surfaceY", surface.y);
  mat.setArray4("trainA", surface.trains.a as unknown as number[]);
  mat.setArray4("trainB", surface.trains.b as unknown as number[]);
  mat.setFloat("trainCount", surface.trains.count);
  mat.setVector2("waveFlow", surface.flow);
  mat.setFloat("waveDrag", w.waves.drag);
  mat.setFloat("waveBreak", w.waves.break);
  mat.setFloat("waveLap", w.waves.lap);
  mat.setFloat("waveDetail", w.waves.detail);
  mat.setVector2("gridDetail", new Vector2(w.grid.detail[0], w.grid.detail[1]));
  mat.setVector2("gridOrigin", Vector2.Zero());
  mat.setFloat("reflectance", w.reflectance);
  mat.setFloat("fresnelPower", w.fresnelPower);
  mat.setFloat("sunHalo", w.sunHalo);
  mat.setFloat("haloStrength", w.haloStrength);
  mat.setFloat("mirrorBlur", w.mirrorBlur);
  mat.setFloat("mirrorChop", w.mirrorChop);
  mat.setFloat("glintCut", w.light.glint.degrees * deg);
  mat.setFloat("glintStrength", w.light.glint.strength);
  mat.setFloat("sheenCut", w.light.sheen.degrees * deg);
  mat.setFloat("sheenStrength", w.light.sheen.strength);
  mat.setVector2(
    "lampCut",
    new Vector2(w.light.lamp[0] * deg, w.light.lamp[1] * deg),
  );
  mat.setFloat("throughStrength", surface.through);
  mat.setFloat("throughCrest", w.light.through.crest);
  mat.setFloat("depthMax", w.depthMax);
  mat.setFloat("depthDry", w.depthDry);
  mat.setFloat("depthFade", w.depthFade);
  mat.setFloat("bedDepth", w.bedDepth);
  mat.setFloat("bedShow", w.bedShow);
  mat.setFloat("caustics", w.caustics);
  mat.setFloat("scatter", w.scatter);
  mat.setFloat("foamWidth", w.foamWidth);
  mat.setFloat("foamScale", w.foamScale);
  mat.setFloat("foamSpeed", w.foamSpeed);
  mat.setFloat("foamSlope", w.foamSlope);
  mat.setFloat("crestFoam", surface.caps);
  mat.setFloat("capLevel", w.caps.level);
  mat.setFloat("fleckStrength", w.fleckStrength);
  mat.setFloat("washReach", w.wash.reach);
  mat.setFloat("washFlatten", w.wash.flatten);
  mat.setFloat("washBlur", w.wash.blur);
  mat.setFloat("washFoam", w.wash.foam);
  mat.setFloat("washHeight", w.wash.height);
  mat.setFloat("washLength", w.wash.length);
  mat.setFloat("washSpeed", w.wash.speed);
  // A body born with no rotor over it, which is every body on every map until
  // one flies out there — `WaterSystem.setWash` is what moves it.
  mat.setArray4("washSite", new Array(w.wash.sites * 4).fill(0));
  mat.setFloat("washCount", 0);
  mat.setFloat("time", 0);
  mat.setVector3("camPos", Vector3.Zero());
  mat.setArray3("pointPos", new Array(MAX_POINT_LIGHTS * 3).fill(0));
  mat.setArray3("pointColor", new Array(MAX_POINT_LIGHTS * 3).fill(0));
  mat.setFloats("pointRange", new Array(MAX_POINT_LIGHTS).fill(0));
  mat.setFloat("pointCount", 0);
  // FROZEN for `CelMaterialFactory.remember`'s reason: `ShaderMaterial.isReady`
  // rebuilds the whole define set for every submesh of every pass and throws
  // it away, and `isFrozen` is what stops it. The uniforms keep flowing — what
  // gates those is `_mustRebind`, which does not read `isFrozen`.
  mat.freeze();
  return mat;
}
