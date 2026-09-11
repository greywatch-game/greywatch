/**
 * Volumetrics.ts — Moonlight scattered by the air, marched through the SHADOW
 * VOLUME rather than smeared across the screen. Owns the pass, the rung it was
 * built at and the camera basis it reconstructs rays from; owns no scene state,
 * renders nothing of its own and copies nothing.
 * Invariants: it runs after the ink and FXAA and before the blur and the grade,
 * because it ADDS light to the frame — the beams belong to the same instant as
 * the geometry, so they have to smear with it and be graded on top of it. Its shader is hand-written WGSL and `shaderLanguage` on
 * the PostProcess is load-bearing rather than declarative: the constructor
 * defaults to GLSL and would look this pass up in a store nothing writes any
 * more. Contract: `docs/rendering.md`.
 *
 * **IT REPLACED `GodRays` AND THAT PASS IS GONE**, rather than being kept as a
 * cheap rung. The player's `off` is the bottom of this ladder; there is one
 * light-shaft mechanism in the game and one set of numbers describing it, which
 * is the same rule the one blast and the one wind are held to.
 *
 * WHAT IT DOES THAT THE SCREEN-SPACE PASS COULD NOT, which is the whole
 * argument for paying anything at all. `GodRays` accumulated BRIGHT PIXELS
 * along a line toward the moon's projected position, so it could only draw a
 * beam whose light source was ON SCREEN, and it could only be cut by something
 * ALSO on screen — it was detached outright for 22 of 24 bearings on a level
 * sweep. A shaft through a doorway you are looking at side-on, a beam between
 * two roofs with the moon behind you, the bar of light across a street you are
 * walking down: none of those existed for it, because there was nothing in
 * frame for it to smear. This marches the air itself and asks the shadow map
 * what is lit, so the light does not have to be in frame and neither does the
 * occluder.
 *
 * **AND IT IS THEREFORE ATTACHED ALL THE TIME, WHICH IS THE TRADE.** The old
 * pass cost nothing for most of a round and everything for a few seconds of it;
 * this costs the same every frame. Measured worst-case-to-worst-case it is
 * CHEAPER at the two lower rungs (`CONFIG.graphics.volumetrics` carries the
 * table), but nobody should read that as free over a round — it is about
 * 0.75 ms of GPU, spent on a frame that leaves ~75% of the GPU idle.
 *
 * WHAT IT GIVES UP, and it is not small and it is not yet answered:
 * **CHARACTERS DO NOT OCCLUDE.** The screen-space pass got a bot cutting a beam
 * for free — a dark pixel simply stopped contributing — and this cannot see one
 * at all, because a rig is not a shadow caster (`ShadowSystem`: the player is
 * ~60 meshes and each bot 9, and they get blob discs instead). It is a real
 * regression against what shipped and it is knowingly taken, because putting
 * rigs in the shadow map is exactly the CPU cost this whole design exists to
 * avoid — and worse than the caster count suggests, since the depth pass
 * re-renders only when the texel-snapped focus MOVES and an animated caster
 * makes it a per-frame pass. **Do not "fix" it by registering rigs as casters
 * without measuring that first.**
 *
 * WHAT IT COSTS THE CPU, which is the question that was actually asked: one
 * full-screen draw and a dozen uniform writes. Every input it needs already
 * exists and is already computed — the depth image is `FrameDepth`'s, shared
 * with the ink and the blur; the shadow map and its matrix are `ShadowSystem`'s
 * and are published to the cel materials whether this exists or not; the camera
 * basis is read straight out of the view matrix. It builds nothing, walks
 * nothing, and adds no draw to the scene.
 *
 * THE RUNG IS A SAMPLE COUNT AND NOT A RESOLUTION, and the reason is worth
 * stating because the obvious lever is the wrong one here. A `PostProcess`
 * with `size` under 1 renders the CHAIN's image into a smaller target and every
 * pass after it reads that target — so a half-res march is a half-res frame.
 * Scaling the march itself means a render target of its own plus a depth-aware
 * upsample, which is real structure; it is the next step if the measurement
 * says taps alone are not enough. The count is a WGSL `const` interpolated per
 * rung, so each rung is its own compiled shader and its own pass — which is why
 * the rung is fixed at construction and `Game.setVolumetrics` REBUILDS rather
 * than re-configures when the player moves the slider.
 */
import {
  type BaseTexture,
  Camera,
  Matrix,
  PostProcess,
  Scene,
  ShaderLanguage,
  ShaderStore,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { FrameDepth } from "./FrameDepth";

/** The rungs, derived from the config so the ladder is declared exactly once. */
export type VolumetricRung = keyof typeof CONFIG.graphics.volumetrics.rungs;

/** Whether a string off the query is a rung. Narrows, so the caller needs no cast. */
export function isVolumetricRung(s: string): s is VolumetricRung {
  return s in CONFIG.graphics.volumetrics.rungs;
}

/**
 * `CONFIG.graphics.shadows.edgeFade` as a WGSL literal, for the same reason
 * `wgsl/includes.ts` interpolates it rather than binding it: it never varies,
 * and a uniform that never varies is a binding that can be wrong.
 *
 * **The ramp has to be the SAME ramp the surfaces use.** `shadowVisibility`
 * fades a receiver back to fully lit over the outermost `edgeFade` of the
 * volume, and air that stopped being shadowed on a different schedule would
 * put a visible seam in the haze exactly where the ground under it is smooth.
 */
const EDGE_FADE = Math.max(CONFIG.graphics.shadows.edgeFade, 1e-4).toFixed(4);

/** One shader per rung; the tap count is a compile-time const. See the header. */
function source(samples: number): string {
  return `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;

// The frame's own depth, out of the shared FrameDepth — the same image the ink
// draws its edges off and the blur names the weapon with. Declared as a depth
// texture so Babylon's WGSL processor gives the binding sampleType "depth",
// which is what lets every read be a textureLoad and this pass declare no
// sampler for it.
var depthTexture: texture_depth_2d;

// The moon's own depth map, sampled in AIR rather than at a surface. Declared
// exactly as celShadow declares it — texture plus sampler — because that is the
// pairing Babylon binds from one setTexture, and a sampler a shader declares
// must be BOUND or the bind group fails to build and the draw is silently lost.
var shadowMapSampler: sampler;
var shadowMap: texture_2d<f32>;

// Ordered widest-first: these are collected into the auto-generated LeftOver
// UBO, and a std140 layout is least surprising when the big alignments come
// before the small ones.
uniform lightMatrix: mat4x4f;
uniform air: vec4f;         // x density, y height falloff, z height base, w g
uniform camPos: vec3f;
uniform camRight: vec3f;
uniform camUp: vec3f;
uniform camFwd: vec3f;
uniform moonDir: vec3f;     // unit, camera -> moon
uniform tint: vec3f;
uniform tanHalfFov: vec2f;  // half-extents of the near plane, at z = 1
uniform nearFar: vec2f;
uniform march: vec2f;       // x = metres to march, y = depth bias
uniform intensity: f32;

// A WGSL const rather than a #define. Babylon's WGSL processor implements a
// define by searching the whole shader for its NAME with an un-anchored regex
// and pasting the value over every hit, which is a substring collision waiting
// to happen; the count is interpolated from CONFIG either way, so nothing is
// lost by declaring it in the language. MotionBlur points here for this.
const SAMPLES: i32 = ${samples};
const PI: f32 = 3.14159265359;

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

// Buffer depth -> metres ALONG THE VIEW AXIS. The same inverse CelInk and
// MotionBlur take, and for the same reasons: Babylon is left-handed, WebGPU's
// NDC z is [0, 1], and nothing in the tree turns on a reverse depth buffer.
fn linearise(d: f32, nf: vec2f) -> f32 {
  return (nf.x * nf.y) / (nf.y - d * (nf.y - nf.x));
}

// Is this POINT IN THE AIR lit by the moon? The surface form of this is
// shadowVisibility in wgsl/includes.ts and the differences are both
// deliberate: there is no facet to offset along, so the normal bias is gone and
// the depth bias carries the whole job; and one tap rather than four, because
// the 2x2 exists to dissolve a texel staircase along a visible EDGE and air has
// no edge to put one on — what it has instead is the march's own jitter, which
// is already breaking the same grid up.
//
// **Outside the volume the answer is LIT, which is celShadow's answer too.** It
// is also why the march is clamped to the window's half-side: past the boundary
// this stops knowing anything, the beams stop being cut, and what is left is
// smooth haze. The ramp below is the same ramp the ground uses, so the air and
// the floor under it stop together.
fn shadowAt(p: vec3f) -> f32 {
  let sc4 = uniforms.lightMatrix * vec4f(p, 1.0);
  let sc = sc4.xyz / sc4.w;
  let uv = sc.xy * 0.5 + 0.5;
  let edge = min(
    min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)),
    min(sc.z, 1.0 - sc.z)
  );
  if (edge <= 0.0) { return 1.0; }
  let lit = step(sc.z - uniforms.march.y,
    textureSampleLevel(shadowMap, shadowMapSampler, uv, 0.0).x);
  return mix(1.0, lit, smoothstep(0.0, ${EDGE_FADE}, edge));
}

// Henyey-Greenstein, carrying its own 1/4pi — intensity absorbs it, which is
// what makes that config field a look knob rather than a physical quantity.
//
// This is the term the screen-space pass has no way to express: it is large
// looking INTO the moon and small looking away from it, off the same march, so
// one effect covers both and there is nothing to cross-fade.
fn phaseHG(cosT: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1e-4, 1.0 + g2 - 2.0 * g * cosT), 1.5));
}

// Triangular-PDF dither at one LSB, keyed on the pixel. The argument is
// Dither.ts and it applies with full force here: this ADDS a very wide, very
// shallow gradient to an 8-bit chain (DefaultRenderingPipeline is built with
// hdr = false), which is the exact shape that bands.
//
// It is a copy of celDither rather than the registered include, and for one
// mechanical reason: that include is keyed on fragmentInputs.position, a
// builtin a surface shader always carries and a post-process fragment stage
// does not declare. Keyed on the pixel either way — vUV * dims IS position.xy
// here — so the two do not disagree about anything.
fn dither(col: vec3f, px: vec2f) -> vec3f {
  return col + (hash(px) - hash(px + 17.31)) * (1.0 / 255.0);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let scene = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0).rgb;

  // The ray through this pixel, in world space and NOT normalised. Babylon is
  // left-handed, so the camera looks down +Z and the ray needs no sign flip;
  // keeping z at exactly 1 is what makes the depth below a scalar along it.
  let ndc = input.vUV * 2.0 - 1.0;
  let rayC = vec3f(ndc * uniforms.tanHalfFov, 1.0);
  let rayW = uniforms.camRight * rayC.x + uniforms.camUp * rayC.y + uniforms.camFwd * rayC.z;

  // How far the air in front of this pixel actually goes: to the geometry the
  // frame already drew, or to the edge of what the shadow map knows, whichever
  // is nearer. linearise is along the view axis and rayW's z-component is the
  // unit forward, so the two are in the same units and camPos + rayW * z is the
  // exact world point — no normalise, no second trig.
  let dims = vec2f(textureDimensions(depthTexture, 0));
  let px = clamp(vec2i(input.vUV * dims), vec2i(0), vec2i(dims) - vec2i(1));
  let far = min(linearise(textureLoad(depthTexture, px, 0), uniforms.nearFar), uniforms.march.x);

  // Evenly spaced, jittered by a hash of the pixel. Without the jitter a low
  // tap count lays the shadow map's own structure down the ray as banding —
  // distinct slabs of light rather than a shaft — and the jitter turns that
  // into noise, which composes with the dither on the way out rather than
  // beating against it.
  let stepLen = far / f32(SAMPLES);
  let jitter = hash(input.vUV * dims);
  var accum = 0.0;
  for (var i: i32 = 0; i < SAMPLES; i++) {
    let p = uniforms.camPos + rayW * ((f32(i) + jitter) * stepLen);
    // Haze thins going up. Without this the sky is as thick as the street and
    // the whole frame washes; with it a shaft between two roofs still reads.
    let dens = exp(-max(0.0, p.y - uniforms.air.z) * uniforms.air.y);
    accum += shadowAt(p) * dens;
  }
  accum *= stepLen * uniforms.air.x;

  // rayW is unnormalised, so the phase's cosine needs the direction proper.
  let phase = phaseHG(dot(normalize(rayW), uniforms.moonDir), uniforms.air.w);
  let lit = uniforms.tint * (accum * phase * uniforms.intensity);

  // Alpha 1, as every pass downstream of the ink writes: the frame's alpha is
  // translucent coverage and CelInk is the last pass that could read it.
  fragmentOutputs.color = vec4f(dither(scene + lit, input.vUV * dims), 1.0);
}
`;
}

/** Registered once per rung, at import — before any effect can compile. */
const SHADERS = new Map<VolumetricRung, string>();
for (const rung of Object.keys(
  CONFIG.graphics.volumetrics.rungs,
) as VolumetricRung[]) {
  const name = `volumetrics_${rung}`;
  ShaderStore.ShadersStoreWGSL[`${name}FragmentShader`] = source(
    CONFIG.graphics.volumetrics.rungs[rung],
  );
  SHADERS.set(rung, name);
}

/**
 * The volumetric moonlight pass, built at one rung.
 *
 * Built UNATTACHED, and that is not tidiness: the pass comes off the camera
 * whenever the player turns it off or changes rung, and goes back into the SLOT
 * it came out of. `detachPostProcess` nulls an entry while `attachPostProcess`
 * appends, so only what did the FIRST attach can say where this belongs —
 * `Game` claims that slot in its constructor and holds it.
 */
export class Volumetrics {
  private readonly post: PostProcess;
  /** The rendered camera's world basis, read off the view matrix each frame. */
  private readonly right = new Vector3(1, 0, 0);
  private readonly up = new Vector3(0, 1, 0);
  private readonly fwd = new Vector3(0, 0, 1);
  private readonly moon = new Vector3(0, 1, 0);
  private readonly tint = new Vector3(1, 1, 1);
  private tanY = 0.5;
  /** Metres of air to march — the shadow window's reach. See `setReach`. */
  private reach =
    CONFIG.graphics.shadows.frustumSize *
    0.5 *
    CONFIG.graphics.volumetrics.reachFraction;
  /** The moon's depth map and its view*projection, pushed by `Game`. */
  private shadowMap: BaseTexture | null = null;
  private lightMatrix: Matrix = Matrix.Identity();
  /** The map's own air, as multipliers on the config. See `setEnv`. */
  private densityMult = 1;
  private intensityMult = 1;

  constructor(
    scene: Scene,
    private readonly camera: Camera,
    /**
     * The frame's own depth image, shared with the ink and the blur. It is
     * what bounds every ray at the geometry already drawn, and it is why this
     * pass has to stay downstream of whichever pass the scene draws into.
     */
    private readonly depth: FrameDepth,
    readonly rung: VolumetricRung,
  ) {
    const v = CONFIG.graphics.volumetrics;
    this.post = new PostProcess(`volumetrics_${rung}`, SHADERS.get(rung)!, {
      uniforms: [
        "lightMatrix",
        "air",
        "camPos",
        "camRight",
        "camUp",
        "camFwd",
        "moonDir",
        "tint",
        "tanHalfFov",
        "nearFar",
        "march",
        "intensity",
      ],
      samplers: ["depthTexture", "shadowMap"],
      size: 1.0,
      camera: null,
      engine: scene.getEngine(),
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.post.onApply = (effect) => {
      effect.setMatrix("lightMatrix", this.lightMatrix);
      effect.setFloat4(
        "air",
        v.density * this.densityMult,
        v.heightFalloff,
        v.heightBase,
        v.anisotropy,
      );
      const p = this.camera.position;
      effect.setFloat3("camPos", p.x, p.y, p.z);
      effect.setFloat3("camRight", this.right.x, this.right.y, this.right.z);
      effect.setFloat3("camUp", this.up.x, this.up.y, this.up.z);
      effect.setFloat3("camFwd", this.fwd.x, this.fwd.y, this.fwd.z);
      effect.setFloat3("moonDir", this.moon.x, this.moon.y, this.moon.z);
      effect.setFloat3("tint", this.tint.x, this.tint.y, this.tint.z);
      // The aspect comes from the pass's own target rather than a cached
      // engine size, so a resized window is right on the frame it happens —
      // MotionBlur reads it the same way and for the same reason.
      effect.setFloat2(
        "tanHalfFov",
        (this.tanY * this.post.width) / Math.max(1, this.post.height),
        this.tanY,
      );
      effect.setFloat2("nearFar", this.camera.minZ, this.camera.maxZ);
      effect.setFloat2("march", this.reach, CONFIG.graphics.shadows.bias);
      effect.setFloat("intensity", v.intensity * this.intensityMult);
      // A DECLARED sampler must be BOUND or the bind group fails to build and
      // the draw is silently lost. Neither can be null by the time this runs —
      // the depth capture is on the draw phase of the same `scene.render()`
      // and the map is bound at startup — but nothing here rests on that.
      const depth = this.depth.texture;
      if (depth) effect.setTexture("depthTexture", depth);
      if (this.shadowMap) effect.setTexture("shadowMap", this.shadowMap);
    };
  }

  /**
   * The pass, for `Game` to attach and detach — exposed rather than given an
   * attach/detach pair of its own for the reason `MotionBlur`'s is: the ORDER
   * is the caller's business, and only what assembled the chain knows where
   * this goes.
   */
  get pass(): PostProcess {
    return this.post;
  }

  /** Everything it needs is bound. `Game` will not attach the pass until it is. */
  get ready(): boolean {
    return this.shadowMap !== null && this.depth.texture !== null;
  }

  /** The moon's depth map and its view*projection — `ShadowSystem`'s, via `Game`. */
  setShadow(map: BaseTexture, matrix: Matrix): void {
    this.shadowMap = map;
    this.lightMatrix = matrix;
  }

  /** The moon's own colour, pushed when the map's environment is applied. */
  setTint(r: number, g: number, b: number): void {
    this.tint.set(r, g, b);
  }

  /**
   * The direction TOWARD the key light, unit — the negated
   * `EnvironmentSpec.lighting.direction`.
   *
   * **It is the light whose shadow map this marches, and NOT the sky's moon
   * disc, which is the same vector by a different route and can be zero.**
   * `Sky` derives its disc from this very field and then withholds it when a
   * map draws no disc (`discRadius: 0`), which the screen-space pass read as
   * "switch off". A march has no such switch — it would simply get a zero
   * vector into the phase function's cosine and scatter sideways everywhere.
   * Reading the authority instead means a sky with no disc drawn is still air
   * lit from where the shadows actually come from.
   */
  setLightDir(x: number, y: number, z: number): void {
    this.moon.set(x, y, z).normalize();
  }

  /**
   * The map's own air, as MULTIPLIERS on `CONFIG.graphics.volumetrics` — both
   * absent meaning "the config's", so a map that says nothing is unaffected.
   *
   * **Multipliers and not absolutes, which is what lets a config change reach
   * every map.** The shipped numbers are the night village's; a jungle valley
   * wants thicker air than a clear desert and says so by ratio, so retuning the
   * base moves all six together and keeps the ordering their authors chose.
   *
   * **The six values in the tree were CARRIED OVER by ratio from the
   * screen-space pass and are not tuned against the march.** They preserve
   * which map wanted more shaft than which, which is the half of the old
   * numbers that still means anything — the other half was a luminance
   * threshold that no longer exists. Retuning them by eye, per map, is the
   * job this is waiting for.
   */
  setEnv(air: { density?: number; intensity?: number } | undefined): void {
    this.densityMult = air?.density ?? 1;
    this.intensityMult = air?.intensity ?? 1;
  }

  /**
   * How far the march reaches, derived from the map's shadow window.
   *
   * **The window is a SQUARE CENTRED ON THE PLAYER, so the reach is its HALF
   * side and not its side.** 55 m on the default 110 m window, which is the
   * honest limit of this whole approach: past it `shadowAt` knows nothing and
   * says lit. A map that states a bigger `shadowWindow` gets a longer march for
   * free and pays for it in texel density exactly as its shadows already do.
   */
  setReach(shadowWindow: number): void {
    this.reach = shadowWindow * 0.5 * CONFIG.graphics.volumetrics.reachFraction;
  }

  /**
   * The rendered camera's basis, once a frame.
   *
   * **It is the RENDERED camera and deliberately not the player's aim**, which
   * is where `MotionBlur` reads the opposite way: that pass excludes the view
   * punch because fresh shake is not motion worth smearing, and this one must
   * include it, because the rays it builds have to land on the same pixels the
   * depth buffer was written from. The view matrix's columns are the world
   * basis — Babylon's LookAtLH writes the axes there — so this is a read rather
   * than a second trig of the same angles.
   */
  update(): void {
    const m = this.camera.getViewMatrix().m;
    this.right.set(m[0], m[4], m[8]);
    this.up.set(m[1], m[5], m[9]);
    this.fwd.set(m[2], m[6], m[10]);
    // Babylon's default fovMode is FOVMODE_VERTICAL_FIXED, so camera.fov is the
    // vertical angle and the horizontal one follows the aspect ratio.
    this.tanY = Math.tan(this.camera.fov * 0.5);
  }

  dispose(): void {
    this.post.dispose();
  }
}
