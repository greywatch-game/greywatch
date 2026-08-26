/**
 * wgsl/includes.ts — The shader text every surface in the game shares, as
 * Babylon WGSL includes.
 * Owns: the registration of `celBand`, `celShadow`, `celProbe`, `celProbeBox`,
 * `celDither` and the two `celInstances` entries into
 * `ShaderStore.IncludesShadersStoreWGSL`, and — for each of them — the
 * argument the GLSL original carried.
 * Invariants: every entry is prefixed `cel`; nothing here declares a uniform
 * or a sampler its consumer does not also list; registration happens at import
 * and must therefore precede the first effect COMPILE, not merely the first
 * material.
 * Contract: `docs/rendering.md`.
 *
 * WHY A REGISTERED INCLUDE RATHER THAN AN INTERPOLATED STRING. The GLSL these
 * replace are template literals pasted into three consumers, which was
 * survivable for a reason that does not survive the port: under WebGL2 a copy
 * that had drifted was a COMPILE ERROR in one shader, because the uniform
 * declarations and the code reading them travelled together and a mismatch did
 * not link. `celShadow` and `celProbe` declare uniforms and samplers, and
 * under WebGPU those feed the auto-generated `LeftOver` UBO struct — so three
 * copies that disagree are no longer a diagnostic anywhere. They are a
 * DIFFERENT UBO LAYOUT per shader, which fails as plausible values read from
 * the wrong offsets, on one surface, with nothing in the console.
 *
 * WHY THE `cel` PREFIX IS THE COLLISION GUARD AND NOT A STYLE. Babylon
 * registers an include first-writer-wins (`if (!IncludesShadersStoreWGSL[name])`),
 * and its own library ships `instancesDeclaration`, `instancesVertex` and some
 * two hundred more under bare names. An unprefixed `dither` or `band` would
 * either silently shadow one of those or be silently shadowed BY one,
 * depending on which module the bundler happened to evaluate first — and the
 * failure is a shader that compiles and draws the wrong thing.
 *
 * WHAT STAYS IN TYPESCRIPT AND WHY. `SHADOW_UNIFORM_NAMES`,
 * `SHADOW_SAMPLER_NAMES`, `PROBE_UNIFORM_NAMES` and `PROBE_SAMPLER_NAMES` stay
 * where they are, in `CelShader.ts`. Registering the source is only half the
 * contract: a `ShaderMaterial` builds its bind group from the lists it is
 * CONSTRUCTED with, so an include that declares a sampler nobody listed is a
 * binding with nothing behind it — which under WebGPU is not the harmless
 * unbound black texture it was under WebGL2 but a bind group that fails to
 * build and every draw using it lost. The two halves have to be edited
 * together, which is easier to remember when they are visibly two halves.
 */
import { ShaderStore } from "@babylonjs/core";
import { DITHER_WGSL } from "../Dither";

/**
 * Registers one include, refusing to overwrite a DIFFERENT source under a name
 * already taken. First-writer-wins is Babylon's own rule and this keeps it,
 * so a collision with the library (or with a second copy of this module) is a
 * loud failure here rather than a quiet difference in the picture.
 */
function register(name: string, source: string): void {
  const store = ShaderStore.IncludesShadersStoreWGSL;
  if (store[name] !== undefined && store[name] !== source) {
    throw new Error(`wgsl/includes: "${name}" is already registered`);
  }
  store[name] = source;
}

/**
 * The hard-band quantizer, shared verbatim by every surface shader in the game.
 *
 * It was three identical copies — cel, grass and water — which was harmless
 * only because nobody had ever changed it. `celShadow` below is the one that
 * made sharing necessary rather than tidy, and the two travel together: a band
 * function that disagreed between the three would put a different terminator on
 * a wall, the grass in front of it and the water beside it.
 *
 * **A consumer owes `#define DISABLE_UNIFORMITY_ANALYSIS`.** `fwidth` is a
 * derivative, and WGSL's uniformity analysis rejects a derivative reached
 * through control flow it cannot prove uniform — which is what a point-light
 * loop is. There is nothing else to say here: a derivative IS what was meant,
 * so unlike a texture fetch there is no explicit-LOD form to reach for
 * instead.
 */
register(
  "celBand",
  `
// Quantizes a 0..1 diffuse term into hard bands, smoothstepping across each
// edge so the terminator reads as a hard line without aliasing.
//
// **The transition is at least one PIXEL wide, and the fixed 0.15 it used to be
// is only the floor.** A band edge is a hard edge with no geometry behind it,
// so nothing in the pipe antialiases it: FXAA works on luminance contrast and
// these are low-contrast interior edges, and there is no MSAA (the only thing
// drawn to the default framebuffer is FXAA's own quad). That was harmless while
// the normal driving ndl was a facet normal — a wall's band index moves a
// thousandth of a band per pixel and one edge crosses the whole face. It stops
// being harmless the moment a BUMP map drives it: the relief puts a terminator
// around every grain, thousands of them per screen, each one aliasing on its
// own. Measured against a 4x supersampled reference of the same frame, the
// valley floor's near ground went from 1.8% of pixels off-reference to 10.3%
// when it gained a height map — and the whole of that difference was here.
//
// fwidth(x) is how fast the band index moves per pixel, so widening the
// smoothstep to it makes the edge exactly resolvable and no wider. Where the
// index moves slowly — every wall, roof and flat face in the game — it is below
// the authored 0.15 and nothing changes at all. Clamped at 0.5 because half a
// cell either side already spans the whole band: past that the quantization
// would invert rather than soften, and what it degrades to instead is smooth
// shading, which is the correct answer for a surface whose bands can no longer
// be drawn.
fn band(ndl: f32, steps: f32) -> f32 {
  let x = ndl * steps;
  let w = clamp(fwidth(x), 0.15, 0.5);
  return min((floor(x) + smoothstep(0.5 - w, 0.5 + w, fract(x))) / steps, 1.0);
}
`,
);

/**
 * The stepped shadow lookup, and the uniforms it reads. Included by the cel,
 * grass and water fragment shaders so all three sample the SAME depth map with
 * the SAME kernel.
 *
 * Grass and water went without this for as long as they existed, and the
 * artefact is the loudest continuity break the frame had: the key light is the
 * moon, so a cottage lays a hard shadow across the ground — and that shadow
 * stopped dead at the edge of a grass rect and at the waterline, because the
 * two surfaces standing in the same shadow were the two that could not see it.
 *
 * A consumer owes two uniforms (`SHADOW_UNIFORM_NAMES`) and one sampler
 * (`SHADOW_SAMPLER_NAMES`) in its own lists, and owes REGISTERING with
 * `CelMaterialFactory.registerShadowConsumer` — the factory pushes all three,
 * and a material that is never registered samples an unbound texture.
 */
register(
  "celShadow",
  `
// Stepped directional shadows. lightMatrix is the ShadowGenerator's
// view*projection (no [0,1] bias baked in — the UV/depth remap below mirrors
// Babylon's own computeShadow: uv = clip.xy*0.5+0.5, depth = (clip.z+1)*0.5).
uniform lightMatrix: mat4x4f;
var shadowMapSampler: sampler;
var shadowMap: texture_2d<f32>;
// x = depth bias, y = darkness, z = normal offset, w = tap radius in UV
uniform shadowParams: vec4f;

// Hard two-level shadow: lit or not, nothing in between — a soft penumbra
// would fight the flat bands. The sample point is pushed off the facet along
// its normal so a flat face never tests against its own depth (acne).
//
// The normal passed in is the one to OFFSET along, which is not always the one
// being lit: it must be the real geometry's. The cel shader hands it the facet
// normal rather than the bumped one, and water hands it the flat up-vector
// rather than the wave normal, for the same reason in both cases — the relief
// is a fiction, and offsetting along a fiction moves the shadow with it.
//
// **FOUR taps, and the count is the whole design.** One tap put the shadow map's
// own texel grid on screen: at 110 m over 2048 texels an edge climbs in 5.4 cm
// steps, and up close that reads as a staircase rather than as a line. The
// staircase has a spatial period of exactly one texel, so a kernel whose support
// covers one period cancels it — and anything WIDER starts producing a real
// penumbra, which is the thing this shader's flat bands cannot have. The
// softening is confined to the width of the artefact: a 5.4 cm edge is
// sub-pixel past about 2 m, so what is left still reads as the hard line the
// look wants. The cel terminator is band(dot(n, -lightDir), 4.0) and is not
// touched by any of this.
//
// The 2x2 is ROTATED per pixel, which matters as much as the count. Four taps
// averaged give five possible values, and five values along an edge are five
// visible contours — a staircase with more steps. Rotating by a hash of the
// pixel turns that residue into noise, which composes with dither() rather
// than fighting it.
//
// Hardware PCF is not available: this samples a plain depth texture and
// compares by hand rather than through a comparison sampler, so every tap is a
// full fetch. That is the other half of why the count stops at four.
//
// **textureSampleLevel and never textureSample**, and this function is what
// settled the rule: the fetches sit behind two early-outs, so an implicit LOD
// is a sample reached through control flow WGSL cannot prove uniform, and the
// error names a function that has been correct for the life of the project.
// The map carries no mip chain, so an explicit level 0 is what was meant.
fn shadowVisibility(n: vec3f, posW: vec3f) -> f32 {
  let sc4 = uniforms.lightMatrix * vec4f(posW + n * uniforms.shadowParams.z, 1.0);
  let sc = sc4.xyz / sc4.w;
  let uv = sc.xy * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
  if (sc.z < -1.0 || sc.z > 1.0) { return 1.0; }
  let depth = (sc.z + 1.0) * 0.5 - uniforms.shadowParams.x;

  let a = fract(sin(dot(fragmentInputs.position.xy, vec2f(12.9898, 78.233))) * 43758.5453)
    * 6.2831853;
  let rot = vec2f(cos(a), sin(a)) * uniforms.shadowParams.w;
  let perp = vec2f(-rot.y, rot.x);

  let lit = step(depth, textureSampleLevel(shadowMap, shadowMapSampler, uv + rot, 0.0).x)
    + step(depth, textureSampleLevel(shadowMap, shadowMapSampler, uv - rot, 0.0).x)
    + step(depth, textureSampleLevel(shadowMap, shadowMapSampler, uv + perp, 0.0).x)
    + step(depth, textureSampleLevel(shadowMap, shadowMapSampler, uv - perp, 0.0).x);
  // Narrow smoothstep rather than a plain average: the four taps give a 0,
  // 0.25, 0.5, 0.75, 1 ladder, and this pulls the middle of it back toward a
  // decision so the edge stays an edge and only its jaggies are dissolved.
  return mix(uniforms.shadowParams.y, 1.0, smoothstep(0.25, 0.75, lit * 0.25));
}
`,
);

/**
 * The reflection probe a mirror samples, and the parallax correction that
 * stops it reading as a decal.
 *
 * **Shared verbatim by the two surfaces in the game that hold up a mirror** —
 * the glazing (`CEL_GLASS`) and the water — because both sample cubes
 * `ReflectionSystem` bakes the same way, and both subtleties in the function
 * are exactly the kind that get fixed in one copy and left standing in the
 * other. A material that includes this owes `PROBE_UNIFORM_NAMES` and
 * `PROBE_SAMPLER_NAMES` in its own lists.
 */
register(
  "celProbe",
  `
// The world as a mirror sees it: one cube baked per map install from the
// map's own geometry (systems/ReflectionSystem.ts). Alpha 1 where the bake
// drew something and 0 where it saw nothing at all, which is what lets the
// sky above stay the analytic gradient and the world below be a picture of
// the world. Colour is NOT premultiplied — see each sampler's own mix.
var reflectionCubeSampler: sampler;
var reflectionCube: texture_cube<f32>;
// Where the cube was baked from, and how much of it this surface returns
// against the sky it would otherwise show: reflectProbe.xyz is the bake point
// and .w is the strength — 0 where nothing was baked, which is every editor
// build and every map with nothing to bake for.
uniform reflectProbe: vec4f;

// The Y flip, which every sampler of one of these cubes owes.
//
// A cube face is stored top-down while a framebuffer is bottom-up, so a cube
// RENDERED into comes out mirrored about the horizon. Babylon says as much by
// giving a cube render target INVCUBIC_MODE, and its own reflection path
// spends that define on this one line. Without it a mirror returns the
// pavement where the sky should be, which reads as glass that is simply too
// dark rather than as anything upside down — the mistake is invisible until
// it is looked for.
fn probeCubeDir(dir: vec3f) -> vec3f {
  return vec3f(dir.x, -dir.y, dir.z);
}
`,
);

/**
 * The parallax half of a probe: the box a mirrored ray leaves the world
 * through, and the re-aim that turns an infinite-distance cube into one with
 * a place in it.
 *
 * **Separate from `celProbe` because the two mirrors want opposite things.** A
 * pane is vertical and a player walks ALONG it, so a decal that sits still as
 * you pass is exactly what the correction exists to stop. Water is horizontal
 * and its probe stands ON it, so what its rays can reach is the far surround —
 * far enough that an infinite cube is nearly right, and correcting it against
 * a map-sized box collapses every pixel onto the same far exit point. So the
 * glazing includes this and the water does not, and neither carries the
 * other's uniforms.
 */
register(
  "celProbeBox",
  `
// The box the mirrored ray is parallax-corrected against — the map's own
// extent, floor to roofline.
uniform reflectBoxMin: vec3f;
uniform reflectBoxMax: vec3f;

// Parallax correction for the reflection cube: where the mirrored ray leaves
// the map, expressed as a direction from the point the cube was baked at.
//
// A cube map is a picture taken from ONE place, and sampled with the raw
// mirrored ray it behaves as if everything in it were infinitely far away —
// so the city in a pane would sit still while the player walks past it, which
// reads as a decal rather than as a reflection. Intersecting the ray with a
// box that stands in for the world and re-aiming from the bake point at the
// hit is the standard correction, and here the box is not an approximation of
// anything: it is the map's own extent, which is a square with a hard boundary
// on all four sides and a roofline over it.
//
// The reciprocal is taken against a floor rather than the component itself. A
// ray exactly parallel to a face divides by zero, which is a well-behaved
// infinity that never wins the min below — but a ray parallel to a face it is
// also exactly ON divides zero by zero, and one NaN takes the whole sample
// with it. sign() cannot supply the missing direction (sign(0) is 0), so the
// magnitude is clamped and the sign restored by hand.

fn reflectBoxDir(dir: vec3f, pos: vec3f) -> vec3f {
  var sgn = sign(dir);
  sgn += 1.0 - abs(sgn);
  let inv = 1.0 / (sgn * max(abs(dir), vec3f(1e-5)));
  let tHi = (uniforms.reflectBoxMax - pos) * inv;
  let tLo = (uniforms.reflectBoxMin - pos) * inv;
  // The far intersection on each axis; the nearest of the three is the face
  // the ray actually leaves through. max() picks the far one per axis because
  // one of the pair is behind the ray whenever pos is inside the box.
  let t = max(tHi, tLo);
  let hit = min(min(t.x, t.y), t.z);
  let aimed = (pos + dir * max(hit, 0.0)) - uniforms.reflectProbe.xyz;
  return probeCubeDir(aimed);
}
`,
);

/**
 * Triangular-PDF dither at one LSB, keyed on the pixel and NOT on time.
 *
 * **The source and the argument are both in `Dither.ts`**, and this is the one
 * entry in the table that reaches for its text instead of stating it. Why it
 * exists at all, why it is not in the grade, why one LSB rather than half and
 * the run-length measurement that settled it are sixty lines against a
 * six-line function, and a reader arriving at either wants the other. The four
 * entries above are the opposite shape — a paragraph over a paragraph — so
 * they state their own.
 */
register("celDither", DITHER_WGSL);

/**
 * The mesh transform, and these two entries are OURS rather than Babylon's for
 * a reason that is a project rule and not a preference.
 *
 * The GLSL path deep-imported `@babylonjs/core/Shaders/ShadersInclude/
 * instances{Declaration,Vertex}`, which were two of the four grandfathered deep
 * imports in the tree. The WGSL twins would have been two MORE subpaths, and
 * `CLAUDE.md` forbids a new one absolutely — a deep static import into
 * `@babylonjs/core` breaks a DEV session only, blames a subsystem that is not
 * at fault, and hides itself on a restart. So the port ended with NONE of them
 * rather than six, and what these cost instead is fifteen lines that have to
 * be kept honest. `scripts/check-deep-imports.mjs` keeps the count at zero,
 * which is only an enforceable rule because these exist.
 *
 * **They mirror `ShadersWGSL/ShadersInclude/instances{Declaration,Vertex}.js`
 * of `@babylonjs/core` 9.19.1**, minus the branches nothing in this game
 * compiles: `INSTANCESCOLOR` (no instance colour buffer anywhere),
 * `WORLD_UBO` (a `ShaderMaterial` never defines it) and the four velocity
 * defines (no prepass). Anything that starts using one of those does not get
 * it for free here — diff against the files named above when Babylon moves.
 */
register(
  "celInstancesDeclaration",
  `
#ifdef INSTANCES
attribute world0 : vec4f;
attribute world1 : vec4f;
attribute world2 : vec4f;
attribute world3 : vec4f;
#ifdef THIN_INSTANCES
uniform world : mat4x4f;
#endif
#else
uniform world : mat4x4f;
#endif
`,
);

/**
 * Declares `finalWorld` — the mesh's world matrix times the per-instance one.
 * Goes INSIDE `main`, and every consumer's first world-space line reads it.
 *
 * A thin instance's matrix is the mesh's own times the instance's, which is
 * why the `world` uniform is still bound under `THIN_INSTANCES`; a plain
 * hardware instance carries the whole transform in its four columns and the
 * uniform is not declared at all.
 */
register(
  "celInstancesVertex",
  `
#ifdef INSTANCES
var finalWorld = mat4x4f(
  vertexInputs.world0, vertexInputs.world1, vertexInputs.world2, vertexInputs.world3);
#ifdef THIN_INSTANCES
finalWorld = uniforms.world * finalWorld;
#endif
#else
var finalWorld = uniforms.world;
#endif
`,
);
