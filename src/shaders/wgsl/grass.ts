/**
 * wgsl/grass.ts — The grass field's two surfaces as plain strings OUR renderer
 * assembles (`render/grassProgram.ts`, `BABYLON_EXIT.md` X4.6c): the BLADES,
 * placed in the vertex stage from a patch of seeds and the map's grass mask,
 * bent by a travelling gust field, a steady sway and combatants pushing
 * through; and the TURF, the ground-hugging sheet under them that carries the
 * field's colour out past the last blade. Both are lit with the same banded
 * key/point/fog/mist terms as the cel shader, through one shared function.
 * Owns: `TURF_LODS`; `GRASS_VERTEX` (`grassVertex`), `GRASS_SURFACE`
 * (`grassSurface`), `TURF_VERTEX` (`turfVertex`) and `TURF_SURFACE`
 * (`turfSurface`).
 * Invariants: the blade mesh carries SEEDS, not blades — `position` is
 * (u, t, v), the root's place in its patch and the height along the blade,
 * and `blade` is (side, rank, s0, s1). A patch is two `vec4f`s:
 * `uniforms.patch0` is (side, lift, min x, min z) and `uniforms.patch1`
 * (edges, corners), the turf's stitching, read only by its vertex stage.
 * `rank` is the blade's place in the patch's progressive order, and the keep
 * test below must agree with `GrassSystem.keep` or a patch is drawn
 * from a mesh that holds fewer blades than it wants. Point-light arrays are
 * MAX_POINT_LIGHTS and filled from the same LightingSystem slots as the cel
 * shader; the pusher array is CONFIG.grass.maxPushers. The blades are opaque;
 * the turf BLENDS, and leaves the frame's coverage alpha untouched
 * (`render/grassProgram.ts`' `TURF_BLEND`). No Babylon lights. Nothing inside
 * a WGSL template string may contain a backtick — it closes the template.
 * Never: imports Babylon (`src/render/` imports this, and the build gate walks
 * it); declares a binding (`wgsl/chunks.ts`' rule).
 * Contract: `docs/rendering.md`, "The grass".
 *
 * Grass — the one surface in the game that is BUILT in the vertex stage.
 *
 * Nothing about a blade is stored per blade on the CPU. A patch mesh holds
 * seeds — where in an 8 m square a root goes, where it falls in the patch's
 * progressive order, two random numbers — and the vertex stage turns each into
 * a blade on the ground under it:
 *
 * - **where and whether**: the patch puts the root in the world, the
 *   MASK (density, height multiplier, and the ground's height, baked by
 *   `world/grassMask.ts`) says whether anything grows there and how tall, and
 *   the blade's `rank` against the field's keep share says whether this far
 *   from the eye it is still drawn. A blade that is not is collapsed to a
 *   point, and one ON the threshold is SHRUNK into the ground, so the field
 *   thins without a single blade blinking out;
 * - **how it stands**: its own lean, a curve (the tip travels as t² while the
 *   height is given back so a bent blade keeps its length), and its width,
 *   widened as the field thins so a far hillside is still covered;
 * - **how it moves**, all taken at the ROOT so a blade bends as one stalk:
 *   a slow noise field carried downwind (the GUSTS — the waves you watch roll
 *   across a field), the steady sway under it, a quick flutter, and up to
 *   `CONFIG.grass.maxPushers` bodies parting it. The bearing is
 *   `CONFIG.wind.dir`, shared with the foliage.
 *
 * **A blade is lit on the side the light is on, and SEEN from whichever side
 * faces the eye.** A leaf is thin enough that the key comes through it, so the
 * key term takes the blade's normal flipped toward the LIGHT and turned part
 * way to the sky, and the face turned away from the eye is given `transmit`
 * of it — which is what lets a field under a 14-degree evening sun glow rather
 * than stand in its own shade. Everything else (ambient, lamps, the rim) takes
 * the normal turned most of the way up, so a stand is lit like the ground it
 * covers and does not scintillate facet by facet under a banded key.
 *
 * **The TURF is why the field is a carpet and not a comb.** Past `near` the
 * blades thin, and whatever is between them is the map's own floor — which on
 * a summer pasture is cracked earth. The turf is a sheet laid on the same
 * ground the blades stand on, only where the mask grows grass, in the colour
 * the field reads as from the distance it is drawn at: the dark floor of the
 * stand under your feet, the field's own average green on the far hillside.
 * It is biased toward the eye as a road is (`ROAD_DEPTH_UNITS`), because it IS
 * a road's problem — a sheet coplanar with the floor.
 */
import { CONFIG } from "../../config";
import { MAX_POINT_LIGHTS } from "./celSurface";

/** A float as a WGSL literal: always with a point, never in exponent form. */
const f = (n: number): string => n.toFixed(6);

const g = CONFIG.grass;

/**
 * The pusher count, one of the two numbers (with `MAX_POINT_LIGHTS`) that
 * reach the shader by INTERPOLATION: both are TypeScript constants, and the
 * loop bounds stay real WGSL `const` declarations.
 */
const MAX_PUSHERS = g.maxPushers;

/**
 * The turf's patch meshes: cells a side, the distance (already scaled by the
 * sight) inside which each is used, and how far it is lifted off the ground it
 * samples. Read by `GrassSystem`, which picks a row per patch, and by the
 * turf's vertex stage, which draws an EDGE at the coarser of the two rows
 * either side of it.
 *
 * The lift is what a coarse sheet owes the floor it lies on: the terrain is
 * flat triangles three to six metres across and the turf samples it only at
 * its own vertices, so a cell that spans a fold in the ground cuts under it by
 * up to half the fold. A metre cell spans almost none and lies on the floor
 * to the millimetre; four metres at eighty metres out is lifted a hand's
 * width, which nobody standing that far away can see.
 *
 * **Where a fine patch meets a coarse one the fine one's edge is drawn as the
 * coarse one's** — the ground at the coarse cells, joined straight, at the
 * coarse lift — so the sheet has no crack to close. It used to hang a SKIRT
 * down each edge instead, which was invisible while the turf was opaque and is
 * a grid of dark lines under a blend: the skirt and the sheet beside it both
 * land on the same pixels along every seam, and a blend counts twice.
 */
export const TURF_LODS = [
  { cells: 8, within: 24, lift: 0.006 },
  { cells: 4, within: 80, lift: 0.04 },
  { cells: 2, within: Infinity, lift: 0.12 },
] as const;

/** One column of `TURF_LODS` as a WGSL lookup body over `row`. */
function turfTable(key: "cells" | "lift"): string {
  const rows = TURF_LODS.map((r, i) => "if (row == " + i + "u) { return " + f(r[key]) + "; }");
  return rows.join("\n  ");
}

/**
 * Hashes and value noise, shared by every stage here. Sine-free on purpose:
 * the `fract(sin(x) * 43758)` hash loses its bits on some mobile GPUs at the
 * world coordinates a 1500 m map reaches, and it is a hash of POSITION here.
 */
const NOISE = /* wgsl */ `
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let t = fract(p);
  let u = t * t * (3.0 - 2.0 * t);
  let a = hash12(i);
  let b = hash12(i + vec2f(1.0, 0.0));
  let c = hash12(i + vec2f(0.0, 1.0));
  let d = hash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// The field's colour wave, 0-centred: the same function in the blades and
// the turf, so a pale patch of meadow is pale all the way down to the ground.
fn fieldTint(xz: vec2f) -> f32 {
  return vnoise(xz / ${f(g.tint.length)} + vec2f(31.0, 7.0)) * 2.0 - 1.0;
}
`;

/** The mask, read by hand. A stage that includes it reads `maskTex` and three of the block's fields. */
const MASK = /* wgsl */ `
// One texel of the mask, as (ground height 0..1, density, height multiplier,
// wet). Alpha's low seven bits are the multiplier and its top bit the water.
fn maskAt(p: vec2i) -> vec4f {
  let dims = vec2i(uniforms.maskSize);
  let q = clamp(p, vec2i(0), dims - vec2i(1));
  let e = textureLoad(maskTex, q, 0);
  // Outside the grid nothing grows, and the height is the clamped edge's.
  let inside = p.x == q.x && p.y == q.y;
  let a = u32(round(e.a * 255.0));
  return vec4f((e.r * 65280.0 + e.g * 255.0) / 65535.0,
    select(0.0, e.b, inside),
    select(0.0, f32(a & 127u) * ${f(2 / 127)}, inside),
    select(0.0, 1.0, (a & 128u) != 0u));
}

// Bilinear by hand: the height is split over two bytes, and filtering the bytes
// would blend a carry into the wrong one — and the flag in the alpha's top bit
// has to be taken out before anything is averaged.
fn sampleMask(xz: vec2f) -> vec4f {
  let st = (xz - uniforms.maskOrigin.xy) / uniforms.maskOrigin.z - 0.5;
  let i = vec2i(floor(st));
  let t = fract(st);
  let a = maskAt(i);
  let b = maskAt(i + vec2i(1, 0));
  let c = maskAt(i + vec2i(0, 1));
  let d = maskAt(i + vec2i(1, 1));
  var m = mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
  m.x = mix(uniforms.maskHeight.x, uniforms.maskHeight.y, m.x);
  return m;
}
`;

/**
 * The lighting both fragment stages share: the cel shader's model, in one
 * place, so a blade and the turf under it cannot drift into two weathers.
 * Needs the includes celBand, celShadow and celDither ahead of it.
 */
const LIGHTING = /* wgsl */ `
const MAX_POINT_LIGHTS: i32 = ${MAX_POINT_LIGHTS};

struct FieldLit {
  light: vec3f,
  // How much of the key reaches this point (shadow and cloud), for the terms
  // that ride on it.
  key: f32,
};

// n lights the ambient and the lamps; nKey lights the key and places the
// shadow lookup; keyGain scales the key (a blade's far face transmits).
fn fieldLight(n: vec3f, nKey: vec3f, posW: vec3f, occl: f32, keyGain: f32) -> FieldLit {
  var light = uniforms.ambientColor * occl;
  // The cel shader's WRAP, so a field is lit by the same low sun the ground
  // under it is — see the cel key term for the argument.
  let ndl = dot(nKey, -uniforms.lightDir);
  let lift = uniforms.keyWrap * smoothstep(0.0, 0.08, ndl) * (1.0 - max(ndl, 0.0));
  let lit = min(shadowVisibility(nKey, posW), cloudLit(posW));
  light += uniforms.lightColor * band(clamp(ndl + lift, 0.0, 1.0), 4.0) * lit * keyGain;
  // The lightning's own key, which the field takes as the ground under it does.
  light += flashLight(n, n, posW);
  for (var i = 0; i < MAX_POINT_LIGHTS; i++) {
    // A uniform bound, so the whole wave leaves together: on a map with no
    // lamps near the field this is one comparison per pixel, not sixteen.
    if (f32(i) >= uniforms.pointCount) {
      break;
    }
    {
      let toLight = uniforms.pointPos[i] - posW;
      let dist = length(toLight);
      var atten = clamp(1.0 - dist / max(uniforms.pointRange[i], 0.001), 0.0, 1.0);
      atten *= atten;
      let pndl = max(dot(n, toLight / max(dist, 0.001)), 0.0);
      // The spot's cone and the lamps' atlas, off the same slot. A point the
      // atlas does not hold keeps the old answer: lit.
      var loc = vec2f(1.0, -1.0);
      if (atten > 0.0) {
        loc = pointLocal(i, posW, n);
      }
      let vis = select(1.0, loc.y, loc.y >= 0.0);
      light += uniforms.pointColor[i] * atten * loc.x * vis * occl
        * (0.25 + 0.75 * band(pndl, 3.0));
    }
  }
  return FieldLit(light, lit);
}

// The soft shoulder, the height mist and the distance fog — identical to the
// cel shader's, in its order.
fn fieldAtmosphere(c: vec3f, posW: vec3f) -> vec3f {
  let over = max(c - 0.75, vec3f(0.0));
  var col = min(c, vec3f(0.75)) + 0.25 * over / (1.0 + over);
  let dist = length(posW - uniforms.camPos);
  let mist = uniforms.mistParams.y
    * exp(-max(posW.y, 0.0) / max(uniforms.mistParams.x, 0.001))
    * clamp((dist - 6.0) / 45.0, 0.0, 1.0);
  col = mix(col, uniforms.mistColor, clamp(mist, 0.0, 0.9));
  let fog = clamp((dist - uniforms.fogParams.x) / (uniforms.fogParams.y - uniforms.fogParams.x), 0.0, 1.0);
  return mix(col, uniforms.fogColor, fog * fog);
}
`;

/** The blades' vertex stage: the whole of a blade, off its seeds. */
export const GRASS_VERTEX = /* wgsl */ `
${MASK}

const MAX_PUSHERS: i32 = ${MAX_PUSHERS};

${NOISE}

// The share of the patch's blades kept at distance d. MUST agree with
// GrassSystem.keep: the CPU picks the mesh a patch is drawn from off this.
fn keepShare(d: f32) -> f32 {
  let near = uniforms.fieldParams.x;
  let reach = uniforms.fieldParams.y;
  let thin = clamp((near * near) / max(d * d, 0.0001), uniforms.fieldParams.z, 1.0);
  return thin * (1.0 - smoothstep(reach * ${f(1 - g.fade)}, reach, d));
}

fn grassVertex() {
  let t = vertexInputs.position.y;
  let side = vertexInputs.blade.x;
  let rank = vertexInputs.blade.y;
  let patchSide = uniforms.patch0.x;
  let patchXZ = uniforms.patch0.zw;
  let root = patchXZ + vertexInputs.position.xz * patchSide;

  // Every patch holds the SAME seeds, so a patch's own position is folded into
  // everything random about a blade — or the field repeats every eight metres.
  let cell = floor(patchXZ / max(patchSide, 0.001) + 0.5);
  let s0 = fract(vertexInputs.blade.z + hash12(cell));
  let s1 = fract(vertexInputs.blade.w + hash12(cell + vec2f(17.0, 5.0)));
  let s2 = hash12(vec2f(s0, s1) * 91.7);
  let s3 = hash12(vec2f(s1, s0) * 57.3 + 3.1);

  let m = sampleMask(root);
  let ground = m.x - 0.02; // sink roots a touch into the surface

  // --- whether: density and distance share one progressive threshold ---
  let rootW = vec3f(root.x, ground, root.y);
  let dist = length(rootW - uniforms.camPos) * uniforms.lodScale;
  let keep = keepShare(dist);
  let thr = keep * m.y;
  // The last fifth of the kept blades are on their way out and shrink with
  // it, so a blade leaves the field by sinking rather than by vanishing.
  let alive = clamp((thr - rank) / max(thr * 0.2, 0.0005), 0.0, 1.0);

  vertexOutputs.vTip = t;
  vertexOutputs.vGust = 0.0;
  vertexOutputs.vShade = 1.0;
  vertexOutputs.vBladeN = vec3f(0.0, 1.0, 0.0);
  vertexOutputs.vPosW = rootW;
  if (alive <= 0.0 || m.z <= 0.0) {
    // Collapsed: every vertex of the blade lands on one point outside the clip
    // volume, so its triangles have no area and never reach the rasteriser.
    vertexOutputs.position = vec4f(0.0, 0.0, 2.0, 1.0);
    return;
  }

  // --- how it stands ---
  let clump = 1.0 + ${f(g.clump.amount)} * (vnoise(root / ${f(g.clump.length)}) * 2.0 - 1.0);
  // Widened as the field thins, to cover for the blades left out; never below
  // the near width, and never more than widenMax of it. A widened blade is also
  // shortened a little — past "near" a blade is standing in for a tuft, and a
  // tuft is broader than it is tall — which is what lets a far hillside read
  // as a carpet rather than as a comb of hairs.
  let widen = clamp(inverseSqrt(max(keep, 0.0001)), 1.0, uniforms.fieldParams.w);
  let squat = mix(1.0, 0.7, clamp((widen - 1.0) / 3.0, 0.0, 1.0));
  let h = mix(${f(g.heightMin)}, ${f(g.heightMax)}, s1) * m.z * clump * squat
    * (0.35 + 0.65 * alive);
  let halfW = 0.5 * mix(${f(g.widthMin)}, ${f(g.widthMax)}, s2) * widen * alive;
  let yaw = s0 * 6.2831853;
  let across = vec2f(cos(yaw), sin(yaw));
  let leanYaw = s3 * 6.2831853;
  // Most blades lean a little and a few arch right over: a squared seed, so
  // the stand is upright on average with the odd long blade falling out of it.
  var bend = vec2f(cos(leanYaw), sin(leanYaw)) * (${f(g.lean)} * (0.25 + 1.5 * s2 * s2)) * h;

  // --- how it moves: all at the root, so the blade bends as one stalk ---
  let wd = uniforms.windDir;
  let downwind = root - wd * uniforms.time * uniforms.gustParams.y;
  let gn = vnoise(downwind * uniforms.gustParams.x)
    + 0.5 * vnoise(downwind * uniforms.gustParams.x * 2.1 + vec2f(5.2, 1.3));
  let gust = smoothstep(0.5, 1.2, gn);
  let along = dot(root, wd);
  let sway = sin(uniforms.time * uniforms.windParams.y + along * 0.45 + s0 * 1.3)
    + 0.5 * sin(uniforms.time * uniforms.windParams.y * 2.33 + along * 0.77);
  let flutter = sin(uniforms.time * 9.0 + s1 * 6.2831853 + along * 1.7)
    * uniforms.gustParams.w * (0.3 + gust);
  bend += wd * (uniforms.windParams.x * (0.6 * sway + flutter)
    + gust * uniforms.gustParams.z * h);
  bend += vec2f(-wd.y, wd.x) * flutter * uniforms.windParams.x * 0.5;

  // Pushers part the stalk away from a body and lay it over.
  var push = vec2f(0.0);
  for (var i = 0; i < MAX_PUSHERS; i++) {
    if (f32(i) < uniforms.pusherCount) {
      let delta = root - uniforms.pushers[i].xz;
      let dy = abs(ground - uniforms.pushers[i].y);
      let d = length(delta);
      var infl = 1.0 - smoothstep(0.0, uniforms.pushParams.x, d);
      infl *= infl * (1.0 - smoothstep(1.0, 2.5, dy));
      // max() guards the divide when a blade sits exactly on a pusher.
      push += (delta / max(d, 0.05)) * infl;
    }
  }
  bend += push * uniforms.pushParams.y * h;

  // A blade keeps its length: the further the tip travels, the lower it stands.
  let reachOver = min(length(bend) / max(h, 0.001), 0.92);
  let off = bend * t * t;
  let rise = h * t * sqrt(1.0 - reachOver * reachOver * t * t);
  let taper = select(side * (1.0 - t * 0.82), 0.0, t >= 0.999);
  let p = vec3f(root.x + off.x + across.x * halfW * taper,
    ground + rise,
    root.y + off.y + across.y * halfW * taper);
  vertexOutputs.vPosW = p;

  // The blade's own face normal: across the blade crossed with up it.
  let tangent = normalize(vec3f(2.0 * off.x / max(t, 0.05), h, 2.0 * off.y / max(t, 0.05)));
  vertexOutputs.vBladeN = normalize(cross(vec3f(across.x, 0.0, across.y), tangent));
  vertexOutputs.vGust = gust;
  vertexOutputs.vShade = (0.9 + 0.2 * s2) * (1.0 + ${f(g.tint.amount)} * fieldTint(root));
  vertexOutputs.position = uniforms.viewProjection * vec4f(p, 1.0);
}
`;

/**
 * The blades' pixel. The derivatives in `band` are what was MEANT — its width
 * is how fast its index moves per pixel — so there is no explicit-LOD form to
 * reach for the way a texture fetch has one, and WGSL's uniformity analysis has
 * to be told (`derivative_uniformity`, the program's). Every fetch in celShadow
 * is already a textureSampleLevel, so that covers the derivatives and nothing
 * else.
 */
export const GRASS_SURFACE = /* wgsl */ `
#include<celBand>
#include<celShadow>
#include<celDither>

${LIGHTING}

fn grassSurface() -> vec4f {
  let posW = fragmentInputs.vPosW;
  let tip = clamp(fragmentInputs.vTip, 0.0, 1.0);
  let up = vec3f(0.0, 1.0, 0.0);
  let viewDir = normalize(uniforms.camPos - posW);
  let nb = normalize(fragmentInputs.vBladeN);
  // The face the LIGHT is on, and the face the EYE is on. They are the same
  // face unless we are looking at the blade's shaded side.
  let towardLight = select(nb, -nb, dot(nb, -uniforms.lightDir) < 0.0);
  let towardEye = select(nb, -nb, dot(nb, viewDir) < 0.0);
  let seenFromBehind = dot(towardLight, viewDir) < 0.0;
  let nKey = normalize(mix(towardLight, up, 0.45));
  let n = normalize(mix(towardEye, up, 0.8));

  // --- albedo: root->tip gradient, the blade's value and the field's tint ---
  var base = mix(uniforms.rootColor, uniforms.tipColor, smoothstep(0.0, 0.7, tip));
  base *= fragmentInputs.vShade;
  // The gust turns a blade's flat side up to the sky: the pale wave that rolls
  // across a field in wind. On the upper blade only — the root stays in the
  // stand's own shade whatever the air is doing.
  base *= 1.0 + uniforms.sheen * fragmentInputs.vGust * tip;
  // The bottom of a thick stand is in the shade of every blade around it.
  let occl = mix(${f(g.rootShade)}, 1.0, smoothstep(0.0, 0.6, tip));

  let lit = fieldLight(n, nKey, posW, occl,
    mix(${f(g.rootShade)}, 1.0, occl) * select(1.0, ${f(g.transmit)}, seenFromBehind));
  var col = base * lit.light;

  // A blade is thin: with the key BEHIND it, the upper blade glows with the
  // light coming through. Only where the key actually reaches.
  let back = pow(max(dot(-viewDir, -uniforms.lightDir), 0.0), 4.0);
  col += uniforms.tipColor * uniforms.lightColor * back * lit.key * tip * tip * ${f(g.backlight)};

  // Hard rim, matching the cel look — including the cel shader's gate on tilt,
  // which keeps the rim off anything near-level (docs/rendering.md argues the
  // floor's version of it). On the upper blade, which is the silhouette.
  let rim = 1.0 - max(dot(viewDir, n), 0.0);
  col += base * uniforms.rimColor * step(0.72, rim) * (1.0 - smoothstep(0.90, 0.99, abs(n.y))) * tip;

  col = fieldAtmosphere(col, posW);

  // Last thing before the write, because the write is the quantiser. Alpha 0
  // and not 1: a blade is opaque, and the frame's alpha channel is TRANSLUCENT
  // COVERAGE — what the ink reads to know how much smoke is in front of the
  // depth it is drawing an edge off. See CelInk. Grass is in no bake, so unlike
  // the cel shader it needs no uniform to say which pass it is in.
  return vec4f(dither(col), 0.0);
}
`;

/**
 * The turf's vertex stage. A patch's side and corner are `patch0`'s, its lift
 * its y, and `patch1` two numbers packed four base-4 digits apiece — which
 * `TURF_LODS` row each EDGE is sampled at (W, E, S, N) and each CORNER is
 * lifted by (SW, SE, NW, NE). See `GrassSystem.placeTurf`.
 */
export const TURF_VERTEX = /* wgsl */ `
${MASK}

fn turfCells(row: u32) -> f32 {
  ${turfTable("cells")}
  return ${f(TURF_LODS[TURF_LODS.length - 1].cells)};
}

fn turfLift(row: u32) -> f32 {
  ${turfTable("lift")}
  return ${f(TURF_LODS[TURF_LODS.length - 1].lift)};
}

fn digit(packed: f32, k: u32) -> u32 {
  return (u32(packed + 0.5) >> (2u * k)) & 3u;
}

// The sheet's height at a vertex on an EDGE, as the coarser of the two
// patches either side of it draws that edge: the ground sampled at that
// patch's cells and joined by straight lines, lifted by that patch's lift and
// at the two ends by the corners'. Both patches compute the same function of
// the same points, so a fine patch beside a coarse one meets it exactly and
// no crack opens between them. 'along' is where the vertex is on the edge,
// 0 at 'base' and 1 a patch side along 'dir'.
fn edgeHeight(base: vec2f, dir: vec2f, side: f32, along: f32, row: u32,
    liftStart: f32, liftEnd: f32) -> f32 {
  let n = turfCells(row);
  let s0 = min(floor(along * n), n - 1.0) / n;
  let s1 = s0 + 1.0 / n;
  let h0 = sampleMask(base + dir * (s0 * side)).x + select(turfLift(row), liftStart, s0 <= 0.0);
  let h1 = sampleMask(base + dir * (s1 * side)).x + select(turfLift(row), liftEnd, s1 >= 1.0);
  return mix(h0, h1, (along - s0) * n);
}

fn turfVertex() {
  let patchSide = uniforms.patch0.x;
  let corner = uniforms.patch0.zw;
  let edges = uniforms.patch1.x;
  let corners = uniforms.patch1.y;
  let uv = vertexInputs.position.xz;
  let xz = corner + uv * patchSide;
  // An interior vertex is the ground plus this patch's own lift; one on an
  // edge is the edge's, which is what keeps the sheet whole across a change of
  // cell size. A corner is on two edges and both give the same answer, the
  // corner's own lift at the ground under it.
  var h = sampleMask(xz).x + uniforms.patch0.y;
  if (uv.x <= 0.0 || uv.x >= 1.0) {
    let east = uv.x >= 1.0;
    h = edgeHeight(corner + vec2f(uv.x * patchSide, 0.0), vec2f(0.0, 1.0), patchSide, uv.y,
      digit(edges, select(0u, 1u, east)),
      turfLift(digit(corners, select(0u, 1u, east))),
      turfLift(digit(corners, select(2u, 3u, east))));
  } else if (uv.y <= 0.0 || uv.y >= 1.0) {
    let north = uv.y >= 1.0;
    h = edgeHeight(corner + vec2f(0.0, uv.y * patchSide), vec2f(1.0, 0.0), patchSide, uv.x,
      digit(edges, select(2u, 3u, north)),
      turfLift(digit(corners, select(0u, 2u, north))),
      turfLift(digit(corners, select(1u, 3u, north))));
  }
  // The ground's slope, off the same mask the height came from: a step either
  // way of one texel, which is as fine as the height itself is known.
  let e = uniforms.maskOrigin.z;
  let hx = sampleMask(xz + vec2f(e, 0.0)).x - sampleMask(xz - vec2f(e, 0.0)).x;
  let hz = sampleMask(xz + vec2f(0.0, e)).x - sampleMask(xz - vec2f(0.0, e)).x;
  vertexOutputs.vNormalW = normalize(vec3f(-hx, 2.0 * e, -hz));
  let p = vec3f(xz.x, h, xz.y);
  vertexOutputs.vPosW = p;
  let d = length(p - uniforms.camPos) * uniforms.lodScale;
  vertexOutputs.vFar = smoothstep(uniforms.fieldParams.x, uniforms.fieldParams.x * 5.0, d);
  vertexOutputs.position = uniforms.viewProjection * vec4f(p, 1.0);
}
`;

/** The turf's pixel. Its `discard` and its derivatives are `GRASS_SURFACE`'s rule. */
export const TURF_SURFACE = /* wgsl */ `
${MASK}

#include<celBand>
#include<celShadow>
#include<celDither>

${LIGHTING}

${NOISE}

fn turfSurface() -> vec4f {
  let posW = fragmentInputs.vPosW;
  // How much turf: a RAMP over the mask's density, centred at about HALF and
  // never a contour across it. Half and not the field's own edge, because a
  // thin field — scrub, a reed bed, grass going to seed under trees — is
  // ground with blades on it, and turf there would lay a green sheet over the
  // map's own floor. A ramp and not a cut, because a field is AUTHORED near
  // half as often as not, and a cut there broke it into dark islands with
  // hard edges wherever the density sat inside the noise that wandered the
  // cut. So a meadow at half is the floor half covered, evenly, drifting a
  // little on a slow wave. Read per PIXEL, so it holds still however coarse
  // the patch drawing it.
  let m = sampleMask(posW.xz);
  let lush = m.y + ${f(g.turf.wobble)} * (vnoise(posW.xz / ${f(g.turf.wobbleLength)}) - 0.5);
  // No turf under water: that is a reed bed, and the bed is the water's. The
  // wet share is already filtered, so the turf fades over the texel it ends in.
  let cover = smoothstep(${f(g.turf.from - g.turf.feather)}, ${f(g.turf.from + g.turf.feather)}, lush)
    * (1.0 - m.w);
  if (cover < ${f(1 / 255)}) {
    discard;
  }
  let n = normalize(fragmentInputs.vNormalW);
  // Under the stand the turf is the stand's floor — the root colour, in the
  // shade of the blades over it; out where the blades have thinned it stands
  // in for the whole field, and takes the green a field reads as from there.
  let far = fragmentInputs.vFar;
  var base = mix(uniforms.rootColor * ${f(g.turf.under)},
    mix(uniforms.rootColor, uniforms.tipColor, ${f(g.turf.over)}), far);
  base *= 1.0 + ${f(g.tint.amount)} * fieldTint(posW.xz);
  let occl = mix(${f(g.rootShade)}, 1.0, far);
  let lit = fieldLight(n, n, posW, occl, mix(${f(g.rootShade)}, 1.0, far));
  let col = fieldAtmosphere(base * lit.light, posW);
  // The alpha here is the BLEND weight and nothing else: the turf's blend
  // leaves the frame's coverage channel as the floor under it wrote it
  // (TURF_BLEND), so what this writes never reaches the ink.
  return vec4f(dither(col), cover);
}
`;
