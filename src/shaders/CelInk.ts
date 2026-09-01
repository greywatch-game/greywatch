/**
 * CelInk.ts — The game's ink, as one full-screen pass over the depth buffer
 * the frame has ALREADY written. Owns the pass, the depth handle it borrows
 * and the band it fades over; reads no game state and writes to no mesh.
 * Invariants: it runs FIRST in the post chain, before the god rays and the
 * blur and the grade, because it is part of the picture rather than a grade
 * over one — shafts and grain belong on top of inked geometry, not under it.
 * It only ever DARKENS (`mix(scene, scene * tint, edge)` with tint < 1), which
 * is what makes it safe to lay over a finished frame and is worth keeping
 * true. Its shader is hand-written WGSL and `shaderLanguage` on the
 * PostProcess is load-bearing rather than declarative: the constructor
 * defaults to GLSL and would look this pass up in a store nothing writes any
 * more.
 *
 * WHAT IT REPLACED, AND WHY THE OLD ANSWER WAS TWO ANSWERS. The ink used to be
 * geometry, twice over. Babylon's `renderOutline` drew a back-face shell for
 * every inked mesh — a second draw of that mesh, every frame — and everything
 * the palette merge collapsed into `cel-world` could not use it at all, since
 * that pass is per MESH with one colour and a merged block holds ten. So the
 * world's own line work was `MapBuilder.inkTwin`: a separate INVERTED HULL
 * MESH per merge group, wearing a `CEL_INK` material. Counted live, on the
 * current tree: Coldharbour carried **84 outline shells and 53 ink twins** of
 * 609 active meshes, Harrowmead **77 and 144** of 726. A twin is the expensive
 * kind of draw — a mesh with a material switch, ~6.3 us against a shell's ~2.3
 * (`FINDINGS.md` 18).
 *
 * Measured, live round, uncapped headless, arms interleaved A B C A so the
 * run's own drift is on the page rather than assumed away — **Coldharbour
 * +15.4% with all of it gone and +6.4% with this in its place; Harrowmead
 * +34.7% and +32.6%**, against control drifts of 3.0% and 5.6%. Hollowmere was
 * discarded: 57.7% drift, the round had walked somewhere else.
 *
 * WHAT MAKES IT POSSIBLE, all three checked in the tree rather than assumed:
 *
 * 1. **The frame's depth at the end of the draw phase is the WORLD's.** Babylon
 *    clears depth between rendering groups — the classic viewmodel trick — but
 *    `Sky.ts` turns that clear OFF for group 1 so the moon cannot draw through
 *    a wall. So group 1 shares group 0's buffer and there is ONE coherent
 *    depth image holding the village, the sky shell and the gun. That line is
 *    also what makes `GlowDepth`'s occlusion work, and breaking it breaks both.
 * 2. **It is sampleable.** Babylon's WebGPU backend creates depth textures with
 *    `TEXTURE_BINDING`, and `FINDINGS.md` 4 put the engine at sample count 1
 *    with `depth32float` and no stencil, so no MSAA resolve stands in the way.
 * 3. **No sampler is needed and therefore none can be wrong.** The declaration
 *    below is `texture_depth_2d`, off which Babylon's WGSL processor infers
 *    `sampleType: "depth"`, and every read is a `textureLoad`. An edge wants
 *    exact texels rather than filtered ones anyway.
 *
 * NO ORIENTATION FLAG, AND THAT IS DELIBERATE. Which way round a render target
 * is stored is the sort of question that costs an hour and it is not asked:
 * the colour is sampled at `vUV` and the depth is loaded at `vUV *
 * textureDimensions(depth)`, and those index the same screen point in the same
 * convention whatever the storage is.
 *
 * WHAT IT DOES NOT DO YET, and each is a deliberate hole rather than an
 * oversight — see `FINDINGS.md`:
 * - **It has no `noOutline`.** Every emissive part was excluded from the hull;
 *   this inks them. The cheap answer is `glow.mainTexture`, which `GlowDepth`
 *   made full-resolution and emissive-only — a ready-made mask.
 * - **It inks the viewmodel at full weight.** The gun sits 0.3 m from the eye,
 *   so its silhouette is an enormous depth step, where the hull gave it 0.004 m
 *   of deliberately fine line.
 * - **It inks the terrain and the grass**, neither of which the hull touched.
 *   The grass is the loud one and it is KEPT: every blade writes depth, so
 *   every blade is a silhouette, and what that reads as is denser, darker
 *   grass. A judgement, not an accident.
 */
import {
  Camera,
  PostProcess,
  Scene,
  ShaderLanguage,
  ShaderStore,
  ThinTexture,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { fogBand } from "./CelShader";

ShaderStore.ShadersStoreWGSL["celInkFragmentShader"] = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;

// The MAIN pass's depth attachment, handed over by CelInk each frame. Declared
// as a depth texture so Babylon's WGSL processor gives the binding sampleType
// "depth"; every read below is a textureLoad, so this pass declares no sampler
// for it and there is none to get wrong.
var depthTexture: texture_depth_2d;

uniform nearFar: vec2f;
uniform thresholds: vec2f;   // x = silhouette, y = crease
uniform fadeBand: vec2f;     // the map's fog start and end, in metres
uniform tint: f32;

// Buffer depth -> metres. Babylon is left-handed and WebGPU's NDC z is [0, 1]
// (engine.isNDCHalfZRange), and nothing in the tree turns on a reverse depth
// buffer, so this is the plain inverse of the projection's z row.
fn linearise(d: f32, nf: vec2f) -> f32 {
  return (nf.x * nf.y) / (nf.y - d * (nf.y - nf.x));
}

fn rawAt(p: vec2i, dims: vec2i) -> f32 {
  return textureLoad(depthTexture, clamp(p, vec2i(0), dims - vec2i(1)), 0);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let scene = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0).rgb;

  let nf = uniforms.nearFar;
  let dims = vec2i(textureDimensions(depthTexture, 0));
  let p = vec2i(input.vUV * vec2f(dims));

  let dc = linearise(rawAt(p, dims), nf);
  let dl = linearise(rawAt(p + vec2i(-1,  0), dims), nf);
  let dr = linearise(rawAt(p + vec2i( 1,  0), dims), nf);
  let du = linearise(rawAt(p + vec2i( 0, -1), dims), nf);
  let dd = linearise(rawAt(p + vec2i( 0,  1), dims), nf);

  // TWO TESTS, and the second is why depth alone is enough.
  //
  // A SILHOUETTE is a step in depth, taken relative to the centre so that one
  // doorway reads the same at 5 m and at 50.
  let sil = max(max(abs(dc - dl), abs(dc - dr)),
                max(abs(dc - du), abs(dc - dd))) / max(dc, 0.001);

  // A CREASE is a box corner, where depth is CONTINUOUS and only its slope
  // jumps — what a naive Sobel of depth misses, and what a normal buffer is
  // usually bought for. See CONFIG.graphics.ink.crease: 1/z is linear in
  // screen space across any plane, so this is zero on a flat surface at any
  // angle and large at a corner. Multiplying back by dc makes it
  // dimensionless, so one threshold holds at every range.
  let ic = 1.0 / max(dc, 0.001);
  let cx = abs((1.0 / max(dl, 0.001) + 1.0 / max(dr, 0.001)) * 0.5 - ic) * dc;
  let cy = abs((1.0 / max(du, 0.001) + 1.0 / max(dd, 0.001)) * 0.5 - ic) * dc;
  let crease = max(cx, cy);

  var edge = max(
    smoothstep(uniforms.thresholds.x, uniforms.thresholds.x * 2.0, sil),
    smoothstep(uniforms.thresholds.y, uniforms.thresholds.y * 2.0, crease)
  );

  // The ink's own fade, on the cel shader's t*t curve. **Anything drawn
  // unshaded owes this** — see fogAmountAt — and here it is free and exact,
  // because the distance is already in hand where the hull needed a whole
  // shader-store patch (OutlineFog) to get it per pixel and a per-mesh width
  // ramp to approximate it. Without it a dense map at range mats into black
  // lines, which is the classic screen-space outline failure.
  let t = saturate((dc - uniforms.fadeBand.x) / max(0.001, uniforms.fadeBand.y - uniforms.fadeBand.x));
  edge *= 1.0 - t * t;

  // ONLY EVER DARKER. tint < 1, so no pixel can leave this pass brighter than
  // it arrived — which is what lets the ink sit over a finished frame with the
  // glow already composited into it without touching the bloom.
  fragmentOutputs.color = vec4f(mix(scene, scene * uniforms.tint, edge), 1.0);
  return fragmentOutputs;
}
`;

/** What a render-target wrapper carries that this needs, cast in one place. */
type DepthOwner = {
  _depthStencilTexture?: object | null;
};

/** The engine internal `GlowDepth` already depends on, named the same way. */
type EngineInternals = {
  _currentRenderTarget?: DepthOwner | null;
};

export class CelInk {
  readonly pass: PostProcess;

  /** The main pass's depth, re-wrapped whenever the underlying texture moves. */
  private depth: ThinTexture | null = null;
  private source: object | null = null;

  /** The map's fog band, re-read on every environment change. */
  private fadeStart = 0;
  private fadeEnd = 1;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {
    const ink = CONFIG.graphics.ink;
    this.pass = new PostProcess("celInk", "celInk", {
      uniforms: ["nearFar", "thresholds", "fadeBand", "tint"],
      samplers: ["depthTexture"],
      size: 1.0,
      camera,
      engine: scene.getEngine(),
      shaderLanguage: ShaderLanguage.WGSL,
    });

    this.pass.onApply = (effect) => {
      effect.setFloat2("nearFar", this.camera.minZ, this.camera.maxZ);
      effect.setFloat2("thresholds", ink.silhouette, ink.crease);
      effect.setFloat2("fadeBand", this.fadeStart, this.fadeEnd);
      effect.setFloat("tint", ink.tint);
      // A DECLARED texture must be BOUND or the bind group fails to build and
      // the draw is silently lost. It cannot be null by the time this runs —
      // the capture below is on the draw phase, which is earlier in the same
      // scene.render() — but `applyEnvironment` keeps the pass off the camera
      // until the first frame has handed one over, rather than resting on it.
      if (this.depth) effect.setTexture("depthTexture", this.depth);
    };

    this.applyEnvironment();
    this.capture();
  }

  /**
   * Re-reads the map's fog band. Called by `Game` after `setEnvironment`, and
   * for the reason every unshaded pass in the tree owes that curve: an ink that
   * did not fade would hang in front of the fog wall at full strength while the
   * wall behind it dissolved. It is the MAP's band, so it cannot be captured
   * once at construction.
   */
  applyEnvironment(): void {
    const band = fogBand();
    this.fadeStart = band.start;
    this.fadeEnd = band.end;
  }

  /**
   * Takes the frame's depth attachment at the end of the draw phase — the same
   * hook and the same guard as `GlowDepth`, and deliberately AFTER it in the
   * observer list, since that one re-binds the framebuffer and this must not
   * disturb what it left.
   *
   * Nothing is copied and nothing is rendered: one identity test a frame, and
   * on the frames the target actually moves (a resize) one wrapper.
   */
  private capture(): void {
    const engine = this.scene.getEngine() as unknown as EngineInternals;
    this.scene.onAfterDrawPhaseObservable.add(() => {
      // Render targets drive this observable too — a reflection probe's bake
      // is the one that matters — and a probe's depth is not the frame's.
      if (this.scene.activeCamera !== this.camera) return;
      const tex = engine._currentRenderTarget?._depthStencilTexture;
      if (!tex || tex === this.source) return;
      this.source = tex;
      this.depth = new ThinTexture(tex as never);
    });
  }

  dispose(): void {
    this.pass.dispose();
  }
}
