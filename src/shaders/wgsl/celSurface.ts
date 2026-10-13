/**
 * wgsl/celSurface.ts — The cel fragment's BODY: everything the cel material
 * computes for a pixel, as one function both renderers call, `celSurface()`.
 * Owns: `CEL_SURFACE` (the chunk `celSurface` in `WGSL_CHUNKS`) — the key and
 * its wrap, the sky fill and the traced indirect term, the point lights and
 * the lamps' atlas, the albedo and its weathering, the wear, the rim, the
 * mirror rung, the specular, the translucency, the glazing, the mist and the
 * fog, and the coverage alpha (`opaqueAlpha`) — and the two shader-sized
 * numbers every declaration of it is sized by, `MAX_POINT_LIGHTS` and
 * `MAX_PALETTE`.
 * Invariants: declares nothing (`wgsl/chunks.ts`'s rule): Babylon's
 * declarations for it are `CelShader.ts`'s `celFragmentShader`, ours are
 * `render/celFragment.ts`; returns the pixel's colour and alpha, and each
 * side's own `main` writes it; the variant defines it reads are exactly
 * `CEL_SMOOTH`, `CEL_GROUND_TEX`, `CEL_BUMP`, `CEL_PALETTE`, `CEL_GLASS` and
 * `CEL_GLASS_BACKED`.
 * Never: imports Babylon; is edited for one renderer — what the two must
 * differ in is a declaration, never a body.
 * Contract: `docs/rendering.md` (the look, and "Hand-written WGSL" for the
 * split); `CelShader.ts`'s header is the material's own.
 */
import { CONFIG } from "../../config";

/**
 * Shader-side light slots. The LightingSystem uploads the nearest N — a big
 * arena holds far more fixtures than this, and with only a handful of slots
 * a cluster of small glows (fungus, glyphs) would starve the lanterns and
 * braziers that actually shape the room.
 *
 * It is also the length of `celShadow`'s per-slot lamp arrays (`pointSpot`,
 * `pointShade`) and of `celGi`'s `giSlotChannel`, which index the same slots.
 */
export const MAX_POINT_LIGHTS = 16;

/**
 * How many albedos one map's world geometry may carry before the merge stops
 * collapsing it.
 *
 * **Overflow is not an error and must never become one.** A colour past this
 * cap simply keeps its own material and merges the way everything did before
 * the palette existed — one more mesh per block, which is the cost this whole
 * mechanism exists to avoid and not a broken map. That is what lets the number
 * be a judgement rather than a contract: the four shipped maps' world geometry
 * uses 43 to 79 colours, so 128 is roughly a doubling of headroom, and a map
 * that wanted 300 would get the first 128 collapsed and the rest as they were.
 *
 * The cost of raising it is a uniform buffer on two materials — WGSL pads a
 * `vec3f` in an array to 16 bytes, so this is 2 KB apiece — plus nothing else.
 * The cost of lowering it is silent, which is why it is stated here beside the
 * measurement rather than left in `config/`: it is a property of the SHADER,
 * and it has to be a compile-time literal to size the array at all.
 */
export const MAX_PALETTE = 128;

/**
 * The cel fragment, minus its declarations and its entry point. It `#include`s
 * every chunk it calls, so a renderer that resolves this one name has the
 * whole fragment.
 */
export const CEL_SURFACE = `
#include<celShadow>
#include<celGi>
#include<celBand>
#include<celDither>
#ifdef CEL_GLASS
#include<celProbe>
#include<celProbeBox>
#endif

// The count reaches each side's declarations by INTERPOLATION and the loop
// bound below as a real const, and the split is forced rather than stylistic: a
// uniform array's size must be a literal or a #define, because Babylon resolves
// the bound out of the preprocessor table when it lays out the leftover UBO and
// a WGSL const is not in that table — while a #define is the worse of the two,
// since the processor implements one as an un-anchored regex over the whole
// source. GrassShader settled this; see docs/rendering.md.
const MAX_POINT_LIGHTS: i32 = ${MAX_POINT_LIGHTS};

// How big a light is in a mirror — the exponent of the lobe the mirrored ray
// gathers one over, read as a half-width: 8 is about 35 degrees. And how sharp
// the horizon in that room is, as the sine either side of level: 0.1 is about
// 6 degrees. Both are about the LOOK rather than about any one material, which
// is why they are here beside the band counts rather than in a spec — the same
// call TranslucencySpec makes. The mirror block says what each buys and what
// the narrow settings of both photographed as.
const MIRROR_GLOSS: f32 = 8.0;
const MIRROR_HORIZON: f32 = 0.10;
// How upright a face must be before its wear can show in the 8-bit frame;
// under this its noise is not computed at all. The WEAR block has the
// arithmetic.
const WEAR_UNSEEN: f32 = 1.0 / 1024.0;

// Geometric (per-triangle) normal from the world position's screen-space
// derivatives. The cross product's sign depends on triangle winding and
// viewing direction, so it is flipped to agree with the interpolated normal.
//
// CEL_SMOOTH is the one exception, and it is for CLOTH: a sheet that bends is
// drawn from a fine grid, and a facet per triangle of it is a lattice of
// flickering diamonds rather than a fold. There the interpolated normal is the
// shape, and the bands still cut it hard — they just follow the folds.
fn facetNormal() -> vec3f {
#ifdef CEL_SMOOTH
  return normalize(fragmentInputs.vNormalW);
#else
  let n = normalize(cross(dpdx(fragmentInputs.vPosW), dpdy(fragmentInputs.vPosW)));
  return select(n, -n, dot(n, fragmentInputs.vNormalW) < 0.0);
#endif
}

// Trilinear value noise over world space, 0..1. Deliberately one octave: this
// is weathering, not detail — a second octave adds frequencies the palette
// cannot express and starts reading as texture on a surface that has none.
fn variationHash(cell: vec3f) -> f32 {
  return fract(sin(dot(cell, vec3f(127.1, 311.7, 74.7))) * 43758.5453123);
}

fn valueNoise(p: vec3f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  // Smoothstep the interpolant, or the cell boundaries show as creases.
  f = f * f * (3.0 - 2.0 * f);
  let n000 = variationHash(i + vec3f(0.0, 0.0, 0.0));
  let n100 = variationHash(i + vec3f(1.0, 0.0, 0.0));
  let n010 = variationHash(i + vec3f(0.0, 1.0, 0.0));
  let n110 = variationHash(i + vec3f(1.0, 1.0, 0.0));
  let n001 = variationHash(i + vec3f(0.0, 0.0, 1.0));
  let n101 = variationHash(i + vec3f(1.0, 0.0, 1.0));
  let n011 = variationHash(i + vec3f(0.0, 1.0, 1.0));
  let n111 = variationHash(i + vec3f(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}

#ifdef CEL_BUMP
// Bump mapping for the world-XZ ground textures: perturbs the facet normal by
// the height map's slope, so the quantized light bands ripple across individual
// stones instead of sliding over one flat plane.
//
// **The slope is measured in WORLD space, from taps a texel apart, and it must
// not be measured in screen space.** The first cut used the surface-gradient
// formulation (Mikkelsen 2010) off dpdx(h)/dpdy(h), which is the right tool
// for a UV-mapped normal map on a mesh and the wrong one here, for a reason
// that only bites once the ground is the whole frame:
//
// A screen-space derivative measures how the height changes across ONE PIXEL,
// so the slope a given patch of ground reports depends on how big a pixel is
// there — which is a fact about the camera, not about the ground. On a floor
// seen at a grazing angle a pixel spans several texels along the view
// direction, so the difference is taken across unrelated grains and comes back
// as noise; and because the sampling grid slides over the texture as the player
// walks, that noise is DIFFERENT every frame. The relief boils. It is invisible
// on the cobbled street this shader was written for — a few square metres, seen
// from close and steep — and unmissable the moment a map states a
// floorSurface and 240 m of valley floor gains a height map. Measured against
// a 4x supersampled reference of the same frame, ground at 3-9 m went from 1.8%
// of pixels off-reference to 10.3% when the floor gained relief, and every bit
// of that was this function.
//
// Central differences at a fixed WORLD offset have neither problem. The slope
// at a point is the same however far away the camera is, so nothing boils; each
// tap is a filtered fetch rather than a difference of one, so the anisotropic
// sampler does its job; and the relief fades out on its own at distance,
// because two taps a texel apart converge as the mip chain smooths them. That
// last part is the whole reason no explicit distance fade is needed here — and
// it is why these three fetches are textureSample rather than
// textureSampleLevel: the mip chain IS the fade, and an explicit level 0 would
// delete it.
//
// Three taps rather than four: forward differences off a shared centre. The
// asymmetry is half a texel of bias in where a grain's slope is reported, which
// is nothing beside a fetch per ground pixel.
//
// **Every fetch from here down is textureSampleGrad against the UNDISPLACED
// footprint** (gx, gy — the world-mapped uv's own screen derivatives, taken
// once in main). The mip chain is still the fade, exactly as it was when these
// were implicit; what the explicit gradient buys is that the parallax below may
// move uv by a different amount on neighbouring pixels without that jump being
// read as a footprint — an implicit LOD taken off a displaced uv picks the
// smallest mip along every silhouette the relief draws, which is a grey seam
// round every stone.
fn perturbNormal(n: vec3f, uv: vec2f, gx: vec2f, gy: vec2f) -> vec3f {
  // One texel of the height map. Albedo and height are painted at the same
  // size (SIZE in world/textures.ts), which is what lets this be a constant.
  let e = 1.0 / 512.0;
  let h0 = textureSampleGrad(bumpTex, bumpTexSampler, uv, gx, gy).r;
  let hx = textureSampleGrad(bumpTex, bumpTexSampler, uv + vec2f(e, 0.0), gx, gy).r;
  let hz = textureSampleGrad(bumpTex, bumpTexSampler, uv + vec2f(0.0, e), gx, gy).r;
  // Metres of rise per metre travelled: the tap is e / texScale metres away.
  let perMetre = uniforms.bumpScale * uniforms.texScale / e;
  var grad = vec3f((hx - h0) * perMetre, 0.0, (hz - h0) * perMetre);
  // Only the part of the gradient lying in the surface tilts it. On the
  // near-level ground this material is for that is almost all of it, and the
  // projection is what keeps a sloped road or a pitched deck honest.
  grad -= n * dot(grad, n);
  return normalize(n - grad);
}

// THE RELIEF'S DEPTH, which is what the slope above cannot give. A bump only
// turns a normal: every stone is still painted on one flat sheet, so nothing on
// the street ever hides anything else and nothing ever casts a shadow, and a
// raking sun — the one light that should make a street look carved — draws it
// as a mosaic with shading on it. Two marches over the SAME height map put the
// third dimension back, and both are asked of the height as a displacement
// straight DOWN in world space, which is exact rather than approximate here:
// the albedo is projected down the world Y axis, so a height keyed on world Y
// is the one frame the texture is already in, on a slope as on a level street.
//
// The sheet is the TOP of the relief (height 1) and everything is carved down
// into it, so no stone ever stands proud of the mesh the depth buffer and the
// ink know about.
const RELIEF_STEPS: i32 = ${CONFIG.graphics.relief.parallaxSteps};
const RELIEF_SHADOW_STEPS: i32 = ${CONFIG.graphics.relief.shadowSteps};

fn reliefHeight(uv: vec2f, gx: vec2f, gy: vec2f) -> f32 {
  return textureSampleGrad(bumpTex, bumpTexSampler, uv, gx, gy).r;
}

// PARALLAX: where the eye ray actually meets the carved surface, as that uv and
// the height it meets it at. A linear march through RELIEF_STEPS layers and one
// linear refine between the last two, which is enough for relief a few
// centimetres deep — the sampling layers are finer than a sett's shoulder at
// every distance this is not already faded out by.
//
// **It fades out with distance and has to.** The shift is depth over the view
// ray's rise, so at a graze it grows without limit, and a march at a fixed
// step count stops resolving it: past the fade the relief is the slope and the
// self-shadow alone, which is also all the mip chain has left of it by then.
// The rise is clamped for the same reason, so a pixel on the horizon line
// cannot ask for a shift of a whole tile.
fn reliefParallax(uv0: vec2f, gx: vec2f, gy: vec2f, dist: f32) -> vec3f {
  let amount = (1.0 - smoothstep(uniforms.reliefFade.x, uniforms.reliefFade.y, dist))
    * uniforms.reliefMarch;
  let top = reliefHeight(uv0, gx, gy);
  if (amount <= 0.0 || top >= 1.0) {
    return vec3f(uv0, top);
  }
  let v = normalize(uniforms.camPos - fragmentInputs.vPosW);
  // Tile units of travel across the relief's whole depth.
  let span = -v.xz / max(v.y, 0.2) * uniforms.bumpScale * uniforms.texScale * amount;
  // Fewer layers looking straight down, where the shift is short, and the
  // whole count at a graze, where it is long.
  let count = i32(ceil(mix(f32(RELIEF_STEPS), f32(RELIEF_STEPS) * 0.4, v.y)));
  let layer = 1.0 / f32(count);
  var prevDepth = 0.0;
  // Surface depth minus ray depth: positive while the ray is still above.
  var prevGap = 1.0 - top;
  for (var i = 1; i <= count; i++) {
    let depth = f32(i) * layer;
    let gap = (1.0 - reliefHeight(uv0 + span * depth, gx, gy)) - depth;
    if (gap <= 0.0) {
      // Bracketed between two layers: a few secant steps inside the bracket,
      // which is what stops the side of a stone reading as a stack of plates.
      var lo = prevDepth;
      var hi = depth;
      var gLo = prevGap;
      var gHi = gap;
      for (var j = 0; j < 3; j++) {
        let mid = mix(lo, hi, gLo / max(gLo - gHi, 1e-5));
        let gMid = (1.0 - reliefHeight(uv0 + span * mid, gx, gy)) - mid;
        if (gMid > 0.0) {
          lo = mid;
          gLo = gMid;
        } else {
          hi = mid;
          gHi = gMid;
        }
      }
      let d = mix(lo, hi, gLo / max(gLo - gHi, 1e-5));
      return vec3f(uv0 + span * d, 1.0 - d);
    }
    prevGap = gap;
    prevDepth = depth;
  }
  return vec3f(uv0 + span, 0.0);
}

// SELF-SHADOW: whether the relief between this point and the key light stands
// higher than the light's ray does. Marched only as far as the ray takes to
// climb out of the relief — past height 1 nothing can stand in its way — so a
// crown costs almost nothing and a groove is where the taps are spent.
//
// It is HARD, a narrow smoothstep on how far the relief stands over the ray,
// because the frame's shadow is hard: the stepped shadow map is lit or not, and
// a soft penumbra under every stone would be the one continuous-tone shadow on
// screen. What softens the edge is the geometry — a stone's shoulder is a slope,
// so where it rises past the ray is a line, not a stipple.
//
// The sun's rise is floored, so the reach across the tile is bounded for a
// light on the horizon: a street at 14.5 degrees of sun already throws a
// shadow four times the relief's own depth, which is the look this is for.
fn reliefLit(uv: vec2f, h: f32, gx: vec2f, gy: vec2f, dist: f32) -> f32 {
  let amount = (1.0 - smoothstep(uniforms.reliefFade.z, uniforms.reliefFade.w, dist))
    * uniforms.reliefShade.x * uniforms.reliefMarch;
  let l = -uniforms.lightDir;
  if (amount <= 0.0 || l.y <= 0.0 || h >= 1.0) {
    return 1.0;
  }
  let run = l.xz / max(l.y, 0.12) * uniforms.bumpScale * uniforms.texScale;
  let climb = (1.0 - h) / f32(RELIEF_SHADOW_STEPS);
  var occ = 0.0;
  for (var i = 1; i <= RELIEF_SHADOW_STEPS; i++) {
    let rise = f32(i) * climb;
    let over = reliefHeight(uv + run * rise, gx, gy) - (h + rise);
    occ = max(occ, smoothstep(0.0, 0.03, over));
  }
  return 1.0 - occ * amount;
}
#endif

// The pixel: its display-ready colour, and what it writes into the frame's
// alpha channel (opaqueAlpha, or the glazing's coverage).
fn celSurface() -> vec4f {
  var n = facetNormal();
  // The TRUE facet, kept for the lamps' atlas lookup in the light loop, which
  // runs after the relief has bent n — the offset rule shadowVisibility
  // states, applied to the other shadow.
  let nFacet = n;

  // How level this facet is, read off the TRUE geometry before any bump map
  // touches it — the rim gate below keys on it, and reading it from the
  // perturbed normal would let individual setts flick the gate on and off.
  let level = abs(n.y);

  // Where this pixel reads the irradiance volume, stepped off the TRUE facet
  // for the reason the shadow's offset is: the relief is a fiction, and a
  // lookup pushed along it would move the light with every stone. w = 0 is
  // "no volume here" and every GI term below falls back to the flat path.
  let giC = giCoord(fragmentInputs.vPosW + n * uniforms.giBand.z);
  // A var rather than a let: the light loop indexes it at run time, which
  // WGSL allows through a reference and not on an array VALUE.
  var giVis = giPointVis(giC);

  // --- directional key light (4 bands), gated by the stepped shadow ---
  // The shadow's normal-offset uses the true facet normal — the bump relief
  // is fake, and offsetting along it would leak light at stone edges.
  var shadow = shadowVisibility(n, fragmentInputs.vPosW);
  // Past the shadow map's own window, the volume's per-probe sun test takes
  // over rather than the ground going fully lit — see giFarShadow.
  shadow = giFarShadow(fragmentInputs.vPosW, giC, shadow);
  // The clouds' shadow joins AFTER the far test, because past the map's window
  // that test REPLACES the map's answer — mixed in before it, a cloud's shadow
  // would stop at the window's edge. min, not a product: either is enough to
  // take the key away. See celCloud.
  let cloudLitHere = cloudLit(fragmentInputs.vPosW);
  shadow = min(shadow, cloudLitHere);
  // The key's cosine off the TRUE facet, before the relief touches it — what
  // the wrap below is keyed on, for the reason the rim gate reads level.
  let ndlGeo = dot(n, -uniforms.lightDir);

  #ifdef CEL_GROUND_TEX
  // The world-mapped uv and its footprint, taken here, once, before anything
  // displaces it — see perturbNormal for why every relief fetch reads these.
  let groundUV0 = fragmentInputs.vPosW.xz * uniforms.texScale;
  let groundGX = dpdx(groundUV0);
  let groundGY = dpdy(groundUV0);
  var groundUV = groundUV0;
  #endif

  #ifdef CEL_BUMP
  let reliefDist = distance(fragmentInputs.vPosW, uniforms.camPos);
  let carved = reliefParallax(groundUV0, groundGX, groundGY, reliefDist);
  groundUV = carved.xy;
  // The relief's own shadow joins the map's, so the key, the specular and the
  // translucency all lose the light behind a stone together.
  shadow *= reliefLit(groundUV, carved.z, groundGX, groundGY, reliefDist);
  // From here on the bumped normal drives every lighting term: key bands,
  // point lights, rim, and the specular streak all follow the setts.
  n = perturbNormal(n, groundUV, groundGX, groundGY);
  #endif

  // Baked ambient occlusion, and it multiplies the two AMBIENT terms only.
  //
  // Not the key light: the shadow map already owns what the moon can reach, and
  // multiplying both would black out the underside of everything. Not the point
  // lights either, for the same reason those already ignore the shadow map — a
  // lantern hung in a doorway has to light the doorway, which is exactly the
  // place this term is darkest. What is left is the flat ambient and the sky
  // fill, which is the correct answer anyway: occlusion is a statement about
  // how much of the SKY a surface can see.
  //
  // Defaults to 1 on anything with no baked buffer (rigs, viewmodel, effects),
  // so this line is a no-op for them rather than a special case.
  #ifdef CEL_BUMP
  // A groove sees less sky than a crown, which is the relief's share of the
  // same statement — and what keeps a crack dark in a tree's shadow, where the
  // key and everything it drew are gone.
  let ao = fragmentInputs.vBaked.w
    * (1.0 - uniforms.reliefShade.y * (1.0 - smoothstep(0.0, 0.7, carved.z)));
  #else
  let ao = fragmentInputs.vBaked.w;
  #endif

  var light = vec3f(0.0);
  // THE WRAP (EnvironmentSpec.lighting.keyWrap), which is how a cel painter
  // lights a low sun: everything turned toward the light is LIT, and the angle
  // only decides how lit. A facet's cosine is lifted by wrap * (1 - cosine), so
  // a sun-square wall is untouched (it cannot clip any harder than it already
  // does against the shoulder) while a floor at a 14-degree sun climbs from the
  // 0.25 band to the 0.75 one — the ground in the light reads as IN the light,
  // instead of the sky fill being the brightest thing on it.
  //
  // **The lift is keyed on the GEOMETRIC facet and ADDED to the bumped cosine**,
  // so the relief keeps its whole amplitude instead of being squeezed by
  // (1 - wrap): a raking sun over cobbles is exactly where the relief is the
  // picture. And it fades IN over the first few degrees of the terminator, so a
  // facet grazing the light — where the shadow map is least sure of itself —
  // is not handed a full band of key to show its acne in. Zero is the old
  // Lambert exactly, which is what every map that says nothing gets.
  let lift = uniforms.keyWrap * smoothstep(0.0, 0.08, ndlGeo) * (1.0 - max(ndlGeo, 0.0));
  light += uniforms.lightColor
    * band(clamp(dot(n, -uniforms.lightDir) + lift, 0.0, 1.0), 4.0) * shadow;
  // The LIGHTNING's key, a term of its own over a map of its own — see
  // flashVisibility. Black whenever no flash is up, so this is one compare.
  light += flashLight(n, nFacet, fragmentInputs.vPosW);

  // Sky fill: the whole dome is a dim source, so anything looking up at it
  // picks up moonlight even where the key light is blocked. Deliberately NOT
  // gated by the shadow map — a roof in the moon's shadow still faces the sky.
  // This is what keeps roads, roofs and open ground reading as moonlit while
  // walls and undersides stay black.
  var indirect = uniforms.ambientColor * ao
    + uniforms.skyLightColor * band(0.5 + 0.5 * n.y, 3.0) * ao;

  // --- THE TRACED INDIRECT TERM (systems/GiVolume.ts) ---
  //
  // Where the volume has an answer it REPLACES the two terms above rather than
  // adding to them: the flat ambient and the sky fill were always a stand-in
  // for light arriving from everywhere that is not the key, and the volume is
  // that light measured — the sky a street can actually see, the sunlit wall
  // opposite handing some of it on, a lantern's pool bouncing off the cobbles.
  //
  // **Its LUMINANCE is banded and its HUE is not**, which is what lets colour
  // bleed exist in a cel frame: a whitewashed wall beside a red door steps up
  // a band warmer, rather than taking a smooth wash that reads as another
  // game's renderer. The steps are fractions of the unoccluded sky's own
  // brightness, so a map's bands land where its old sky fill's did.
  //
  // The map's flat ambient survives underneath as a FLOOR — the painter's
  // "how black does the unlit side go" — so a closed room is dark rather than
  // void; and the baked AO is kept at a share, for occlusion finer than the
  // volume's own spacing.
  let gi = giIrradiance(giC, n);
  if (gi.w > 0.0) {
    let lum = dot(gi.rgb, vec3f(0.2126, 0.7152, 0.0722)) * uniforms.giBand.y;
    let stepped = giBandOpen(lum, uniforms.giBand.x);
    let banded = gi.rgb * (stepped / max(lum, 1e-4));
    let aoG = mix(1.0, ao, uniforms.giShade.z);
    let traced = (banded * uniforms.giShade.x + uniforms.ambientColor * uniforms.giShade.y)
      * aoG;
    indirect = mix(indirect, traced, gi.w);
  }
  light += indirect;

  // LIGHTNING's fill (giExtra.y, off LightningStrikes): for a moment the whole
  // sky is a lamp, and what it reaches is what can SEE the sky — so a street is
  // lit and the parlour off it is not. Keyed on the facet's tilt as the sky
  // fill is, and in the key's colour, which a flash has already been added to.
  if (uniforms.giExtra.y > 0.0) {
    light += uniforms.flashColor
      * (uniforms.giExtra.y * giSkySeen(giC) * (0.35 + 0.65 * max(n.y, 0.0)));
  }

  // --- point lights (3 bands, smooth inverse-square-ish falloff) ---
  //
  // A BREAK on the count rather than a test inside every iteration, as the
  // grass does: the bound is a uniform, so the whole wave leaves together and a
  // frame with three lights in its slots walks three iterations, not sixteen.
  // The light is the same; a frame with every slot filled saves nothing.
  for (var i = 0; i < MAX_POINT_LIGHTS; i++) {
    if (f32(i) >= uniforms.pointCount) {
      break;
    }
    {
      let toLight = uniforms.pointPos[i] - fragmentInputs.vPosW;
      let dist = length(toLight);
      let range = max(uniforms.pointRange[i], 0.001);
      // Smooth window falloff: 1 at the source, 0 at the range limit.
      var atten = clamp(1.0 - dist / range, 0.0, 1.0);
      atten *= atten;
      let ndl = max(dot(n, toLight / max(dist, 0.001)), 0.0);
      // Whether this slot's light can SEE here, off the volume — so a lantern
      // no longer lights the far side of the wall it hangs on. 1 wherever the
      // volume has no answer, which is the old rule exactly.
      let ch = i32(uniforms.giSlotChannel[i]);
      // The lamps' atlas answers instead wherever it holds this light: a
      // shadow cut per texel rather than per probe, with bodies in it. Its
      // x is the spot's cone, 1 for a light that shines every way.
      //
      // Only INSIDE the range: a pixel the light cannot reach is dark whatever
      // the atlas says, and asking anyway was eight fetches per shadowed lamp
      // on every pixel of the frame.
      var loc = vec2f(1.0, -1.0);
      if (atten > 0.0) {
        loc = pointLocal(i, fragmentInputs.vPosW, nFacet);
      }
      let vis = select(giVis[ch / 4][ch % 4], loc.y, loc.y >= 0.0);
      // Lift the floor a little so lit surfaces read as glowing pools of
      // light rather than only the faces pointed at the flame.
      light += uniforms.pointColor[i] * atten * vis * loc.x
        * (0.25 + 0.75 * band(ndl, 3.0));
    }
  }

  // Base albedo: a flat palette colour, or a world-mapped ground texture. Both
  // are used raw (display-ready), matching the no-image-processing pipe.
  #ifdef CEL_GROUND_TEX
  var base = textureSampleGrad(
    baseColorTex, baseColorTexSampler, groundUV, groundGX, groundGY).rgb;
  // The same world-space drift the flat colours get below, and here it is
  // load-bearing rather than a nicety: this albedo REPEATS, every 4 m on the
  // valley floor and every 1.5 m on the street, and the eye finds a period in a
  // ground plane faster than in anything else in the frame. A drift keyed on
  // world position has no period to find, so the repeat stops being the most
  // legible thing about the ground the moment there is a slower change laid
  // over it. It is also why the tiles themselves are painted with no feature
  // larger than a quarter of their width — the big variation is THIS, and a
  // tile that carried its own would only be advertising where it ends.
  //
  // No vBaked.y branch, unlike the flat path. That mask exists because a flat
  // cel colour is worn by the rigs, the viewmodel and every effect mesh, and a
  // world-keyed term on a moving mesh shimmers as it walks. Nothing that moves
  // is ever ground: getGroundTextured is reached only from the terrain and from
  // the kit's paved surfaces, both of them baked map geometry.
  base *= 1.0 + uniforms.groundVariationAmount
    * (valueNoise(fragmentInputs.vPosW * uniforms.groundVariationScale) - 0.5);
  #else
  var base = uniforms.baseColor;
  #ifdef CEL_PALETTE
  // The albedo is the VERTEX's on anything a builder paletteised, and the
  // uniform's otherwise — index 0 is "not paletted" and is what an unwritten
  // attrib gives. Both paths are the same flat colour from here on: everything
  // below, the weathering drift included, applies to whichever one won.
  if (fragmentInputs.vPalette >= 0.5) {
    base = uniforms.celPalette[u32(fragmentInputs.vPalette + 0.5) - 1u];
  }
  #endif
  // Weathering: a slow value drift over world space, so a 48 m merged block
  // stops being one flat tone. Every wall, roof, plank and rock in the game is
  // drawn from a palette of a hundred-odd hexes, and the merge is per colour —
  // so all 26 cottages are literally the same PLASTER, and a whole block of
  // them arrives as a single mesh in a single value.
  //
  // Keyed on POSITION rather than on anything per-object, which is what makes
  // it free: no vertex data, no build cost, and it survives the merge by
  // construction because the merge preserves world positions. It is also the
  // more useful axis for a village — the artefact is a flat 48 m block, and
  // what breaks that up is variation across the block rather than between the
  // buildings in it.
  //
  // INTERPOLATED, and that is not a detail. GrassShader gets away with a
  // floor()-cell hash because a tuft is a quarter of a metre and lands inside
  // one cell. On a six-metre wall a stepped hash draws a hard vertical seam
  // through the middle of it with no geometry behind it, which is worse than
  // the flatness. Value noise costs seven more taps and has no edges.
  //
  // Gated by the world mask, because a term keyed on world position applied to
  // a MOVING mesh makes it shimmer as it walks: a bot's torso would drift in
  // tone across the map. vBaked.y is 1 on baked map geometry and 0 on the
  // rigs, the viewmodel and every effect mesh.
  //
  // A BRANCH, not a mix. Both of mix()'s arguments are evaluated, so the mask
  // written that way still ran valueNoise — eight variationHash calls, each a
  // sin/dot/fract — on every pixel of the viewmodel that fills the lower third
  // of the screen, on every pixel of sixteen bot rigs and every particle, and
  // then multiplied the result by zero. The branch is uniform across a whole
  // mesh (the mask is a vertex attribute that is 1 or 0 per model, never in
  // between), so it is exactly the shape a GPU predicts well.
  if (fragmentInputs.vBaked.y > 0.5) {
    base *= 1.0 + uniforms.variationAmount
      * (valueNoise(fragmentInputs.vPosW * uniforms.variationScale) - 0.5);
  }
  #endif

  // --- WEAR: the ground's dirt climbing the first metre of every wall ---
  //
  // THREE FACTORS, AND EACH IS HERE BECAUSE THE OTHER END COULD NOT ANSWER IT.
  // \`vBaked.z\` is the height LINE the bake wrote — 1 at the footing, 0 at
  // \`CONFIG.wear.height\`, and signed above that — because only the bake can
  // know how far above the TERRAIN a vertex is without sampling the heightfield
  // per pixel. It is 0 on every face with a ROOF over it as well, which is the
  // other thing only the bake can know: this end holds one normal and one world
  // position, and the inside and the outside of a wall are the same corners
  // with opposite normals, so the ramp alone grimes a parlour like a street
  // front (\`world/vertexShading.ts\`'s \`shelteredAt\`). \`n.y\` is how vertical
  // this face is, and only the fragment can know that cheaply, because it holds
  // the world normal already; baking it would have spent the colour buffer's
  // last free channel on something free at this end. And the CURVE is the
  // third, which used to be baked and is the reason this term barely read: see
  // below.
  //
  // WHY IT IS A MIX AND NOT A MULTIPLY. Grime is a substance ON the surface,
  // not the surface being darker, so a fully-grimed footing should reach the
  // same colour whatever it is made of — a whitewashed cottage and a slate
  // warehouse meet the same mud. A multiply keeps the wall's own hue and just
  // dims it, which is what AO already does two lines up, and stacking a second
  // darkening on the first is why this read as a shadow the first time it was
  // tried. It is applied to \`base\` rather than to \`col\` for the same reason:
  // dirt is ALBEDO, and it has to be lit by the map like the wall it is on, or
  // a wall in shadow has clean-looking dirt on it.
  //
  // OUTSIDE \`CEL_PALETTE\`, deliberately. The block-merged village draws through
  // \`getWorldCel\` and would be covered by sitting inside that define with the
  // albedo variation, but not every world mesh is block-merged, and a term that
  // grimed the buildings and left the scatter props and the terrain's banks
  // clean would draw a line exactly where the merge happens to fall — which is
  // a fact about draw-call batching and not about the world.
  //
  // THE BRANCH IS THE ONE ALREADY BEING TAKEN. \`vBaked.y\` is 1 on baked world
  // geometry and 0 on the rigs, the viewmodel and every effect mesh, so this is
  // uniform across a whole mesh and predicts perfectly — the argument written
  // out in full above the albedo variation. The \`wearParams.x > 0\` half is
  // uniform across the whole DRAW, so a clean map pays nothing per pixel.
  //
  // WHY THE CURVE IS SPENT HERE AND NOT IN THE BAKE. A box part has eight
  // corners and no vertical subdivision, so a wall carries exactly two samples
  // of this ramp — its footing and its eaves — and the rasteriser joins them
  // with a STRAIGHT LINE whatever was written at each. \`pow\` applied in the
  // walk therefore never reached a pixel as a curve: it reached it as 1 falling
  // linearly to 0 over the whole wall, which at head height on a 3 m wall is
  // still 0.47 of full grime. That is not a dirty footing, it is a building
  // rendered slightly darker, and it is what this term looked like for its
  // first version. Height above ground is itself linear up a vertical face, so
  // the LINE interpolates exactly; the curve is one \`pow\` here, on pixels the
  // branch below has already narrowed to world geometry.
  //
  // AND THE GRAIN IS WHY IT DOES NOT READ AS A CONTOUR. The same tide line at
  // the same height on every wall in the village is a rule you can see, which
  // is the failure this whole renderer's weathering rules are written against
  // — no lattice and no clock. Two octaves of the value noise the albedo
  // variation already uses displace the RAMP itself rather than tinting the
  // result, so one field does both jobs at once: the top edge comes out ragged,
  // and the footing is thinned wherever the grain runs low, which is right —
  // a wall is dirtiest exactly where the water ran down it. It is sampled in
  // WORLD space with Y squashed (\`wearGrain.y\`), so the cells stretch into
  // vertical runs and a wall, a fence post and a barrel all streak the same way
  // up with nothing needed to tell them apart. No uv, no sample, no second
  // material — the same test \`albedoVariation\` passes.
  //
  // AND THE NOISE IS ONLY PAID WHERE IT CAN SHOW. Two kinds of face get no
  // grime whatever the grain says, and between them they are much of the
  // screen: a face high up a wall, where the line is so far below zero that
  // even the grain's whole reach (\`edgeBreak / 2\`) cannot lift the ramp off
  // it, and a LEVEL face — the terrain, a road, a floor — where \`upright\` has
  // gone to zero. The first test is exact. The second skips under 1/1024 of upright, where the most
  // the mix could move a channel at full light is a quarter of one step of the
  // 8-bit target the scene draws into. Both are per pixel and neither guards a
  // texture read, so the branch is free to diverge.
  if (uniforms.wearParams.x > 0.0 && fragmentInputs.vBaked.y > 0.5) {
    // Full at vertical, none at level, smooth between. \`abs\` because an
    // UNDERSIDE is as level as a floor and collects no splash either — a
    // soffit, a deck's belly, the underside of an arch.
    let upright = 1.0 - smoothstep(uniforms.wearParams.y, 1.0, abs(n.y));
    let reach = fragmentInputs.vBaked.z + 0.5 * abs(uniforms.wearParams.w);
    if (upright > WEAR_UNSEEN && reach > 0.0) {
      // The squashed sampling point, and the fine octave at 3.4x the coarse
      // one with its cells stretched twice as far again — a ratio rather than
      // a second pair of uniforms, because what these two are FOR is one
      // blotch field with runs in it and the interesting knob is the pair's
      // scale.
      let gp = vec3f(
        fragmentInputs.vPosW.x,
        fragmentInputs.vPosW.y * uniforms.wearGrain.y,
        fragmentInputs.vPosW.z) * uniforms.wearGrain.x;
      let octaves = mix(
        valueNoise(gp),
        valueNoise(vec3f(gp.x, gp.y * 0.5, gp.z) * 3.4 + vec3f(19.3, 7.1, 41.7)),
        0.35);
      // STRETCHED ABOUT ITS MIDDLE, and without this the grain is not visible
      // at all. Trilinear value noise is eight hashes averaged, so it is
      // centrally peaked rather than uniform — a cell CENTRE has a standard
      // deviation of about 0.10 where a corner has 0.29 — and summing two
      // octaves narrows it again, to something like 0.15 overall. A
      // displacement of \`edgeBreak\` times that is a tide line that wanders a
      // few centimetres, which is a straight line with extra arithmetic. The
      // stretch turns the field bimodal, which is what dirt is: a wall is
      // either stained here or it is not, and the interesting part is the
      // boundary between those.
      let grain = clamp((octaves - 0.5) * uniforms.wearGrain.z + 0.5, 0.0, 1.0);
      // Clamped AFTER the displacement and after the interpolation, which is
      // the one place it is free and the one place it is correct.
      let ramp = clamp(
        fragmentInputs.vBaked.z + (grain - 0.5) * uniforms.wearParams.w,
        0.0, 1.0);
      base = mix(
        base,
        uniforms.wearColor,
        pow(ramp, uniforms.wearParams.z) * upright * uniforms.wearParams.x,
      );
    }
  }

  var col = base * light;

  // Soft shoulder: several lights overlapping (or a torch at point-blank
  // range) would otherwise clip to flat white and destroy the palette. This
  // compresses everything above 0.75 into the remaining headroom, so hot
  // spots stay tinted by the light that made them.
  let over = max(col - 0.75, vec3f(0.0));
  col = min(col, vec3f(0.75)) + 0.25 * over / (1.0 + over);

  // Hard-edged rim highlight (step, not smooth — keeps colors flat), and
  // deliberately NOT applied to near-level surfaces.
  //
  // A rim light is a silhouette effect, but on a plane the grazing angle is
  // nothing but the distance from the eye: for a floor, 1 - dot(viewDir, n) is
  // 1 - eyeHeight/dist, which crosses the 0.72 step at eyeHeight/0.28 — 5.5 m
  // standing, 3.75 m crouched. So an ungated rim paints every ground pixel
  // beyond that radius and none inside it: a hard-edged disc of un-rimmed floor
  // locked to the camera and sliding across the map with the player. With the
  // shoulder lamp inside it that reads as a bright pool, then a dark ring, then
  // brighter ground — measured on Hollowmere's floor colour, luminance 0.205 at
  // 5.0 m against 0.263 at 5.6 m, a 28% step across one hard circle. A floor has
  // no silhouette to catch, so it gets no rim.
  //
  //
  // **The tilt gate is HALF the rule, and the half that was found first.** The
  // sentence above is true of EVERY plane and not only of the floor: for a wall
  // at perpendicular distance p from the eye, dot(viewDir, n) is p/dist, the
  // 0.72 step is crossed at dist = 3.57p, and the locus of that on the wall is
  // a CIRCLE of radius 3.43p about the point nearest the eye. So the same
  // camera-locked disc the floor gate exists to kill was still being drawn on
  // every large flat wall in the game, and it slid with the player exactly as
  // the floor one did: standing 3 m off a wall put a 10 m circle on it, and
  // looking along a building's flank from a hull put the arc halfway down the
  // face. It reads as a shadow with nothing casting it.
  //
  // **There is no fragment-local signal that separates the two cases**, which
  // is why this is an exclusion rather than a better test. A limb's grazing
  // facet and a wall's far corner produce the same dot() and the same distance;
  // curvature would separate them and there is none to read, because the
  // shading is FACETED and a normal is constant across a facet by construction.
  //
  // So the second gate is vBaked.y, the world marker the variation noise
  // above already keys on: 1 on baked map geometry and 0 on the rigs, the
  // vehicles, the viewmodel and every effect mesh. A rim light separates a
  // SHAPE from its background, and a merged map block IS the background — the
  // world's edges are drawn by the outline ink, which is per-mesh, thinned with
  // distance and faded into the fog, and never needed this. What is left is the
  // case the effect was raised for on the bright maps: a BODY, a vehicle or the
  // weapon in your hands standing against haze very nearly its own colour.
  //
  // The tilt gate stays, and is not made redundant by it: it is what keeps the
  // near-level top faces of a rig or a hull deck out, and it is the thing that
  // has to hold if anyone ever gives the world its rim back.
  // The gate is on tilt, not on distance, because distance is the symptom. Zero
  // within 8 deg of level (every road, deck, terrace and the flat majority of
  // the heightfield), full past 26 deg — clear of the shallowest roof pitch in
  // the kit, ~24 deg (BuildingKit.gableRoof). Sculpted banks in between keep
  // most of theirs, and on a slope the boundary is broken up rather than being
  // a clean circle. Smooth, so a gentle rise doesn't draw an edge of its own.
  let viewDir = normalize(uniforms.camPos - fragmentInputs.vPosW);
  let rim = 1.0 - max(dot(viewDir, n), 0.0);
  col += base * uniforms.rimColor
    * step(0.72, rim)
    * (1.0 - smoothstep(0.90, 0.99, level))
    * (1.0 - step(0.5, fragmentInputs.vBaked.y));

  // --- the mirror rung: the ROOM, added to what the surface already is ---
  //
  // A highlight is not a reflection, and the gloss ladder's top rung had been
  // trying to be one by being brighter — the one direction that cannot work on
  // faceted geometry. A Blinn lobe is CONSTANT across a flat facet, so at
  // shininess 44 a weapon built out of a dozen plates catches the key light on
  // a whole plate or on none of it, and on the kit stage — where a finish is
  // actually chosen — it was none. What chrome drew was a flat field of albedo
  // with the grade's grain over it, which is what a player reads as paint, and
  // the gold plate came out tan.
  //
  // What makes chrome read as chrome is that neighbouring facets hand back
  // DIFFERENT parts of the room. So this term is the room, gathered down the
  // mirrored eye ray and built out of the only things this shader knows about
  // it: a horizon, the key light, and every point light in range.
  //
  // THREE DECISIONS, each of which was photographed the other way round first.
  //
  // **It is the LIGHT in a direction rather than the picture in it.** The
  // picture is available — the glazing below reflects the sky's own gradient,
  // and that is the honest answer for a pane — but a night sky is 0.03 and the
  // dead village under it is less, so a mirror built out of what is literally
  // there is a dark grey object on every map this game ships. What a surface
  // can be LIT to is the one full-range statement about the room the shader
  // holds; it is the map's own light rather than a constant, and it moves with
  // the weather and the hour for free.
  //
  // **It is ADDED and not mixed toward, which is where this parts company with
  // what a mirror physically does** — a real one has no diffuse under the
  // reflection. Written as a mix it makes chrome DARKER than the paint it is
  // supposed to outshine, and not marginally: the kit stage's own lamps light a
  // plate past anything the environment is worth, so replacing the shading with
  // the room put the gold plate under the standard finish. Reflective reads as
  // brighter than what is beside it. Added, the term is worth what the room is
  // worth — nothing in a dark cellar, and a weapon in a desert noon lit up like
  // the sand around it.
  //
  // **The horizon is HARD, and that is the whole of the facet-to-facet
  // contrast.** A gun is a box: its plates are level or vertical, so their
  // mirrored rays cluster within a few degrees of the horizontal, and any
  // gradient smooth enough to be a sky hands every one of them the same value —
  // photographed as a uniformly tan weapon three times over. A step at the
  // horizon puts those plates on opposite sides of it: what reflects a hair
  // above takes the sky, what reflects a hair below takes the ground, and
  // tilting the weapon sweeps that line across the metal. It is also what a
  // chrome object looks like, which is the horizon drawn across it.
  //
  // The lobes are what MOVE. A reflected light is one hard plate that lands,
  // jumps to the next facet as the weapon turns, and is gone — the one part of
  // this keyed to the player rather than to where they are standing. Written as
  // an exponent on the mirrored ray rather than as a Blinn half-vector so that
  // its width is a half-angle rather than a shininess, and WIDE for the reason
  // above: a reflection narrow enough to be honest is on no facet at all almost
  // always, which is the all-or-nothing this term replaces.
  //
  // Tinted by the surface's own albedo, because a metal colours what it hands
  // back: gold plate returns a gold room and quicksilver returns the room. That
  // is what keeps sixteen finishes distinguishable at the top rung instead of
  // collapsing them into one mirror wearing sixteen names.
  //
  // Schlick over the constant, for the reason every mirror has a bright edge:
  // face-on a plate returns specMirror of the room, at a graze all of it. NOT
  // banded — the same call the glazing's fresnel makes and for the same reason,
  // that a band edge here is a contour line across a flat plate drawn wherever
  // the view angle crosses a step, which slides over the surface as the weapon
  // moves and is exactly the artefact this term exists to replace.
  //
  // The whole block is behind a uniform branch, so every matte, satin and metal
  // material in the game skips it — its loop included — rather than multiplying
  // it out by zero, which is the shape the albedo weathering's mask above
  // already argues for. It is also the only surface in the game that answers a
  // POINT light with anything but diffuse: a chrome weapon that could not see
  // the lantern it was walking past was most of what made the top rung read as
  // paint, and a wall that could see one would be a change to the world's look
  // rather than to a weapon's.
  if (uniforms.specMirror > 0.0) {
    let mirrorDir = reflect(-viewDir, n);
    let roomHi = uniforms.ambientColor + uniforms.lightColor
      + uniforms.skyLightColor;
    var env = mix(uniforms.ambientColor, roomHi,
      smoothstep(-MIRROR_HORIZON, MIRROR_HORIZON, mirrorDir.y));
    env += uniforms.lightColor * band(
      pow(max(dot(mirrorDir, -uniforms.lightDir), 0.0), MIRROR_GLOSS), 2.0)
      * shadow;
    // The same break on the uniform count as the diffuse loop above.
    for (var i = 0; i < MAX_POINT_LIGHTS; i++) {
      if (f32(i) >= uniforms.pointCount) {
        break;
      }
      {
        let toLight = uniforms.pointPos[i] - fragmentInputs.vPosW;
        let dist = length(toLight);
        var atten = clamp(
          1.0 - dist / max(uniforms.pointRange[i], 0.001), 0.0, 1.0);
        atten *= atten;
        env += uniforms.pointColor[i] * atten * band(pow(
          max(dot(mirrorDir, toLight / max(dist, 0.001)), 0.0),
          MIRROR_GLOSS), 2.0);
      }
    }
    let reflectance = uniforms.specMirror
      + (1.0 - uniforms.specMirror)
      * pow(1.0 - max(dot(viewDir, n), 0.0), 5.0);
    col += env * base * reflectance;
  }

  // Toon specular: Blinn half-vector against the key light, quantized into
  // two hard bands (bright core + faint halo) and gated by the same shadow
  // as the diffuse — a glint never appears where the moon doesn't reach.
  // Added after the soft shoulder on purpose: a highlight is allowed to
  // blow past the 0.75 ceiling, that's what makes it read as a shine.
  // Matte materials carry specColor 0 and this contributes nothing.
  let h = normalize(viewDir - uniforms.lightDir);
  let spec = pow(max(dot(n, h), 0.0), uniforms.specShininess);
  col += uniforms.specColor * band(spec, 2.0) * shadow;

  // Translucency: light that came through the surface instead of off it. Two
  // terms multiply. dot(viewDir, lightDir) is how close the eye is to
  // looking INTO the key light — viewDir runs surface-to-eye and lightDir is
  // the direction the light travels, so the two align exactly when the source
  // is on the far side of the surface from the viewer. dot(n, lightDir) is
  // the diffuse term's mirror: the facet must be turned AWAY from the light,
  // since nothing transmits through a face the light is already landing on.
  // Banded like everything else, gated by the same shadow as the diffuse and
  // the specular (light cannot come through a surface the moon doesn't
  // reach), and added past the soft shoulder for the same reason the specular
  // is — a lit awning is allowed to be the brightest thing in the frame.
  // Opaque materials carry transColor 0 and this contributes nothing.
  //
  // **A SOLID only transmits where it is THIN**, and how thin is the foliage
  // map's to say. Both shadow maps record BACK faces, so a face turned away
  // from the key is its own recorded surface there and the shadow can only
  // say whether something ELSE is in front of it — never how much crown the
  // light crossed to reach it. The foliage map records the FRONT faces of the
  // translucent solids alone, so the same four-tap test against it, with the
  // material's transDepth as the allowance, answers exactly that: lit where
  // this face is within transDepth of the first lit foliage along the light.
  // A thin sheet (an awning) states no depth and transmits across its face.
  //
  // **A solid is gated against the WORLD map with the same allowance, and not
  // by the surfaces' own shadow term.** That term's 5 cm bias is tuned for
  // faces the key LIGHTS; on a face turned away from it — a steep cone's back,
  // compared against a back-face map that IS that surface — the four taps land
  // on neighbouring texels of itself and it shades itself in blotches. The key
  // is zero there so nothing else ever showed it, and this is the one term that
  // does. At transDepth the self-comparison always passes and a wall standing
  // between the tree and the moon, whose far side is metres nearer, still
  // does not.
  var transLit = shadow;
  if (uniforms.transDepth > 0.0) {
    let thin = shadowTap(uniforms.foliageLightMatrix, foliageMap, foliageMapSampler,
      fragmentInputs.vPosW, uniforms.transDepth * uniforms.foliageParams.y);
    let clear = shadowTap(uniforms.lightMatrix, shadowMap, shadowMapSampler,
      fragmentInputs.vPosW, uniforms.transDepth * uniforms.foliageParams.y);
    transLit = mix(uniforms.shadowParams.y, 1.0, thin * clear);
  }
  // Leaves are lit THROUGH by the light a cloud has already taken.
  transLit = min(transLit, cloudLitHere);
  let through = max(dot(viewDir, uniforms.lightDir), 0.0)
    * max(dot(n, uniforms.lightDir), 0.0);
  col += uniforms.transColor * band(through, 2.0) * transLit;

  // Opaque unless this is glazing, and the whole of what makes a pane a pane.
  // What "opaque" WRITES is not 1 — see opaqueAlpha.
  var alpha = uniforms.opaqueAlpha;

#ifdef CEL_GLASS
  // A window is two layers over one another and nothing else in the world is:
  // what it REFLECTS, and the tint of what you see THROUGH it. Both are
  // composited here rather than picked between, because which one you get is
  // the angle you are standing at — face-on a shopfront is the room behind it,
  // and from down the street the same glass is a sheet of sky.
  //
  // What it reflects is built in two goes down the mirrored eye ray: the sky,
  // analytically, and then the city over the top of it out of a cube baked
  // from the map's own geometry. The sky half comes first because it is what
  // the cube does NOT hold — the bake draws no dome, so everything above the
  // roofline comes back with alpha 0 and this gradient is what is left there.
  let mirrored = reflect(-viewDir, n);
  var sky = mix(uniforms.fogColor, uniforms.skyZenithColor,
    smoothstep(0.0, 0.55, mirrored.y));
  // The sun in that sky, as a HALO rather than a disc, and it is a GLARE rather
  // than a stand-in for one.
  //
  // This used to be justified by there being no disc to reflect:
  // SkySpec.discRadius was 0 on the one map with glass on it, so a hard disc
  // here would have been a reflection of something the player could not look up
  // and see. Coldharbour has a disc now (1.35 degrees of it), and the halo
  // stays broad anyway — CONFIG.graphics.glass.halo is ~21 degrees, which is
  // not that disc and is not trying to be. A low sun on a curtain wall is a
  // wide smeared glare across the whole elevation, not a sharp second sun — and
  // the same breadth is what the moon wants on Hollowmere, which is why the
  // number is global.
  //
  // Gated by the same shadow map as everything else — glass in a tower's shade
  // does not glare.
  let halo =
    smoothstep(uniforms.glassParams.z, 1.0, dot(mirrored, -uniforms.lightDir));
  sky += uniforms.lightColor * halo * shadow;

  // And the world, which is the half that makes a curtain wall read as glass
  // rather than as a tinted slab: the tower opposite, the street under it and
  // the traffic on the street, all moving across the pane as the player walks
  // because the ray is parallax-corrected before it is sampled.
  //
  // The bake is ONE cube from ONE point on the map (see ReflectionSystem), so
  // what a pane returns is the right city seen from slightly the wrong place.
  // That is the trade the feature is: six face renders once per map install
  // against a per-frame probe per building, on a renderer whose whole budget
  // argument is that the world is static and drawn once. Sold by the fact that
  // a reflection is read as motion and colour rather than as a picture —
  // nobody counts the windows in a window.
  //
  // Un-premultiplied by hand. The bake clears to a transparent black and the
  // world draws over it opaque, so a texel on a silhouette filters to a
  // fraction of the colour AND a fraction of the alpha; mixing toward that
  // colour directly would draw a dark seam around every roofline in the
  // reflection. Same arithmetic, and the same reason, as the composite below.
  //
  // textureSample and not textureSampleLevel: a ReflectionProbe's cube carries
  // a mip chain (Babylon generates one unless asked not to), so an implicit LOD
  // is the filtering the GLSL textureCube already had.
  let city = textureSample(reflectionCube, reflectionCubeSampler,
    reflectBoxDir(mirrored, fragmentInputs.vPosW));
  sky = mix(sky, city.rgb / max(city.a, 0.001), city.a * uniforms.reflectProbe.w);

  // Schlick, and deliberately NOT banded. Every other term in this shader is
  // quantized and this one must not be: the band edge would be a contour line
  // across a FLAT sheet, drawn where the view angle crosses a step and nowhere
  // else — so it would slide over the glazing as the player walks, which is
  // exactly the artefact the rim light is gated off level surfaces to avoid.
  // The water's fresnel is smooth for the same reason and is the precedent.
  let fres = uniforms.glassParams.x + (1.0 - uniforms.glassParams.x)
    * pow(1.0 - max(dot(viewDir, n), 0.0), uniforms.glassParams.y);

#ifdef CEL_GLASS_BACKED
  // Glazing hung on a solid mass, and the whole saving is that the layer behind
  // it is KNOWN — it is that mass, a hand away, on a parallel face under the
  // same key light, so the light term this sheet already computed is the one
  // that shades it too. Knowing it turns the blend into arithmetic. What the
  // rasterizer would have produced over a backdrop B is
  //
  //   C*alpha + B*(1-alpha),  C = (sky*fres + col*tint*(1-fres))/alpha
  //                           alpha = fres + tint*(1-fres)
  //
  // and since 1-alpha is exactly (1-fres)(1-tint), that whole expression folds
  // to
  //
  //   mix(mix(B, col, tint), sky, fres)
  //
  // which is what is written below. It is EXACT and not an approximation of
  // the blend: the only thing assumed is B, and the builder is the one thing
  // that knows it. No divide, and no alpha handed to a blender — alpha stays 1
  // so this sheet writes DEPTH, which is the point, because the mass behind it
  // is then rejected before it is ever shaded. See getGlass's backed argument
  // in this file, and Build.pane for who may claim it and what it costs to
  // claim it wrongly.
  col = mix(
    mix(uniforms.glassBackdrop * light, col, uniforms.glassParams.w), sky, fres);
#else
  // Composite the two layers into one colour and one alpha. The reflection
  // covers the tint, the tint covers what is behind the pane, and dividing by
  // the total is what keeps the blend from darkening the result twice — the
  // rasterizer is about to multiply the colour by this alpha, so what goes out
  // has to be the layers' colour rather than their contribution.
  let tint = uniforms.glassParams.w;
  alpha = fres + tint * (1.0 - fres);
  col = (sky * fres + col * tint * (1.0 - fres)) / max(alpha, 0.001);
#endif
#endif

  // --- atmosphere ---
  let dist = length(fragmentInputs.vPosW - uniforms.camPos);

  // Low-lying ground mist: thickest at the floor, builds up with distance.
  // The ramp is deliberately long so lit ground near the player stays
  // readable and only the middle distance turns to soup.
  let mist = uniforms.mistParams.y
    * exp(-max(fragmentInputs.vPosW.y, 0.0) / max(uniforms.mistParams.x, 0.001))
    * clamp((dist - 6.0) / 45.0, 0.0, 1.0);
  col = mix(col, uniforms.mistColor, clamp(mist, 0.0, 0.9));

  // Theme-tinted distance fog — reaches full strength so far walls vanish.
  //
  // The two atmosphere terms are applied to the colour and NOT to the alpha,
  // and a half-transparent pane in full fog still comes out right: whatever is
  // behind it is at least as far away and has already been mixed to the same
  // fogColor, so blending fog over fog lands on fog whatever the weight is.
  let fog = clamp((dist - uniforms.fogParams.x)
    / (uniforms.fogParams.y - uniforms.fogParams.x), 0.0, 1.0);
  col = mix(col, uniforms.fogColor, fog * fog);

  // Last thing before the write, because the write is the quantiser.
  return vec4f(dither(col), alpha);
}
`;
