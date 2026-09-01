/**
 * CelInk.ts — The game's ink, as one full-screen pass over the depth buffer
 * the frame has ALREADY written. Owns the pass, the depth handle it borrows
 * and the band it fades over; reads no game state and writes to no mesh.
 * Invariants: it runs FIRST in the post chain, before the god rays and the
 * blur and the grade, because it is part of the picture rather than a grade
 * over one — shafts and grain belong on top of inked geometry, not under it.
 * Running first is also what lets it read the frame's alpha as translucent
 * coverage: it is the last pass that could, since every pass after it writes
 * alpha 1.
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
 * THE NIB HAS A WIDTH AND THE WIDTH IS A DISTANCE, which is the second thing
 * this pass spends depth on and the one the fog fade could not give. A line one
 * texel wide everywhere is the one thing a pen never draws: it gives the palm
 * grove at 300 m exactly the weight of the crate at 5, so a dense frame arrives
 * with no hierarchy in it. Darkness and weight are not one reading — a thin
 * black line comes FORWARD and a thick pale one does not — so `ink.width` sits
 * beside the fade rather than instead of it, and aerial perspective in ink is
 * the two together. The curve has TWO SIDES because the near end is the
 * viewmodel's, which is `ink.near`'s argument about darkness spent again on
 * width. Width is bought with a SECOND RING at two texels, both rings divided
 * by their own radius so one pair of thresholds serves both — and what that
 * division costs on a weak edge is the PRESSURE it buys, since a weak edge
 * keeps the inner ring alone and stays a hairline while a strong one carries
 * the whole nib. Three smaller terms finish the hand and none of them is new
 * data: a CONTOUR and a CREASE are drawn at different weight and width
 * (`ink.creaseStroke`), a line the geometry only just asks for is laid down
 * lighter than one it shouts (`ink.pressure`), and the sample cross is nudged
 * by a sub-texel two-octave field so a long straight edge is not exactly
 * straight (`ink.wobble`, anchored in screen space, which the config says out
 * loud). `docs/rendering.md` carries the argument in full.
 *
 * **The second ring costs eight more depth loads a pixel and no measurable
 * time**, which is what a DRAW-CALL bound frame means in practice. Interleaved
 * A B A, uncapped headless, live round on the Windows box: Coldharbour 152.8 /
 * 152.4 / 152.0 fps at a 6.4 ms median in all three arms, and Sarab 115.1 /
 * 109.5 / 106.6 with the two LIKE arms 7.4% apart — the run's own drift is
 * larger than the difference between the arms, and the baseline sits inside
 * it. Do not read that as headroom for a THIRD ring on a phone: it is a
 * statement about where this frame's bottleneck is, taken on a 4070 Ti SUPER.
 *
 * TWO THINGS STAND IN FOR THE HULL'S PER-MESH CONTROL AND NEITHER IS A FLAG,
 * which is the part `FINDINGS.md` 18 said would need an ink-id attachment.
 * - **Emissives are masked out by `glow.mainTexture`.** Every emissive part was
 *   excluded from the hull through what is now `noInk`, and an inked emissive
 *   is swallowed glow. `GlowDepth` had already made that texture FULL
 *   RESOLUTION and emissive-only, so the mask costs one texture read and no
 *   pass. It is SHARP — the layer's blur writes to its own targets rather than
 *   back into this one — and already depth-tested against this frame, so a lamp
 *   behind a wall does not protect the wall in front of it.
 * - **The viewmodel is scaled down by a DEPTH band.** The gun sits 0.3-0.5 m
 *   from the lens and a body cannot get within about 0.4 m of world geometry,
 *   so distance names the weapon with no per-mesh data at all. It replaces the
 *   hand-set 0.004 m hull `ViewModel` used to wear — the LAST outline in the
 *   game, which outlived the sweep that took the pass out because it set
 *   `renderOutline` directly and never went through `addOutline`.
 *
 * THE FRAME'S ALPHA CHANNEL IS TRANSLUCENT COVERAGE, and that is the one fact
 * in this file that is not this file's alone. A depth buffer cannot say that
 * smoke got between the pass and the geometry it is drawing an edge off —
 * nothing alpha-blended writes depth, and the capture markers must not, or a
 * marker would hide what it marks — so an edge derived from the bots behind a
 * plume was painted over the plume at full strength. The channel nothing was
 * using carries the answer: everything opaque writes 0 into it
 * (`CelShader`'s `opaqueAlpha`, and a literal 0 in `GrassShader` and
 * `WaterShader`), `applyEnvironment` clears to 0, and every alpha-blended draw
 * accumulates into it with no help at all, because Babylon's ALPHA_COMBINE
 * blends alpha as (ONE, ONE). **So it costs no pass, no target and no texture
 * read** — it is the fourth channel of the sample this shader already took —
 * and this pass writes 1 back out, so nothing downstream ever sees it. THREE
 * things share it and each is checked in the tree rather than assumed: the glow
 * layer composes with ALPHA_ADD, whose alpha factors are (ZERO, ONE), so a
 * bloom cannot claim coverage it does not have; an ADDITIVE effect leaves the
 * channel alone and should, since a flare adds light rather than hiding what is
 * behind it; and a REFLECTION PROBE wants the opposite value out of the same
 * line, which is why `opaqueAlpha` is a uniform and `ReflectionSystem` flips it
 * for the length of a bake.
 *
 * **It inks the terrain, the grass, the water and the debris, none of which the
 * hull touched, and that is KEPT.** Every blade of grass writes depth, so every
 * blade is a silhouette, and what that reads as is denser, darker grass. A
 * judgement rather than an accident — and `noInk` is deliberately absent from
 * those meshes so the flag does not claim otherwise.
 */
import {
  Camera,
  GlowLayer,
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

// The GLOW layer's main texture: the emissive meshes ALONE, full resolution and
// UNBLURRED (the blur writes to the layer's own blur targets, not back into
// this one), already depth-tested against this same frame. See
// CONFIG.graphics.ink.emissiveMask.
var emissiveSamplerSampler: sampler;
var emissiveSampler: texture_2d<f32>;

uniform nearFar: vec2f;
uniform thresholds: vec2f;   // x = silhouette, y = crease
uniform fadeBand: vec2f;     // the map's fog start and end, in metres
uniform nearBand: vec2f;     // x = metres it holds for, y = ink kept at the eye
uniform maskBand: vec2f;     // x = emissive luma where ink starts giving way, y = gone
uniform tint: f32;
uniform widthBand: vec4f;    // the NIB, in texels: x at the eye, y bold, z fine, w = the rows it is stated at
uniform widthRange: vec2f;   // x = where the bold nib is, y = where the fine one is, in metres
uniform creaseStroke: vec2f; // what a CREASE is worth against a contour: x = darkness, y = width
uniform grain: vec3f;        // x = pressure of the faintest line, y = wobble in texels, z = wobble frequency

// Buffer depth -> metres. Babylon is left-handed and WebGPU's NDC z is [0, 1]
// (engine.isNDCHalfZRange), and nothing in the tree turns on a reverse depth
// buffer, so this is the plain inverse of the projection's z row.
fn linearise(d: f32, nf: vec2f) -> f32 {
  return (nf.x * nf.y) / (nf.y - d * (nf.y - nf.x));
}

fn rawAt(p: vec2i, dims: vec2i) -> f32 {
  return textureLoad(depthTexture, clamp(p, vec2i(0), dims - vec2i(1)), 0);
}

// THE TWO TESTS, taken at a RING of radius r and handed back as (silhouette,
// crease), so one function serves every ring the nib is wide enough to want.
//
// A SILHOUETTE is a step in depth, taken relative to the centre so that one
// doorway reads the same at 5 m and at 50.
//
// A CREASE is a box corner, where depth is CONTINUOUS and only its slope
// jumps — what a naive Sobel of depth misses, and what a normal buffer is
// usually bought for. See CONFIG.graphics.ink.crease: 1/z is linear in screen
// space across any plane, so this is zero on a flat surface at any angle and
// large at a corner. Multiplying back by dc makes it dimensionless, so one
// threshold holds at every range.
//
// **BOTH ARE DIVIDED BY r, and that is what lets ONE PAIR OF THRESHOLDS serve
// every ring.** Across a sloped surface a depth difference grows in proportion
// to the step taken over it, and a slope BREAK's second difference does the
// same, so without the division an outer ring would read a grazing floor as a
// silhouette and every dune would be a contour. What the division costs is
// sensitivity on the outer ring at a WEAK edge — and that cost is the feature
// rather than the price: a weak edge keeps the inner ring alone and is drawn
// as a hairline, a strong one carries the whole nib, so a stroke varies in
// width along its length with what it is describing. That is pressure, and it
// is arrived at rather than painted on.
fn ringAt(p: vec2i, dims: vec2i, r: i32, dc: f32, nf: vec2f) -> vec2f {
  let rf = f32(r);
  let dl = linearise(rawAt(p + vec2i(-r,  0), dims), nf);
  let dr = linearise(rawAt(p + vec2i( r,  0), dims), nf);
  let du = linearise(rawAt(p + vec2i( 0, -r), dims), nf);
  let dd = linearise(rawAt(p + vec2i( 0,  r), dims), nf);

  let sil = max(max(abs(dc - dl), abs(dc - dr)),
                max(abs(dc - du), abs(dc - dd))) / (max(dc, 0.001) * rf);

  let ic = 1.0 / max(dc, 0.001);
  let cx = abs((1.0 / max(dl, 0.001) + 1.0 / max(dr, 0.001)) * 0.5 - ic) * dc / rf;
  let cy = abs((1.0 / max(du, 0.001) + 1.0 / max(dd, 0.001)) * 0.5 - ic) * dc / rf;
  return vec2f(sil, max(cx, cy));
}

// A stroke's DARKNESS from a measurement and its threshold. The first factor is
// whether there is a line here at all; the second is PRESSURE — a line that
// only just qualifies is laid down lighter than one the geometry shouts, over a
// band (t..5t) wide enough that the variation runs ALONG a stroke rather than
// sitting at its ends. The floor is what the faintest line keeps.
fn strokeOf(m: f32, t: f32, press: f32) -> f32 {
  return smoothstep(t, t * 2.0, m) * mix(press, 1.0, smoothstep(t, t * 5.0, m));
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  // RGBA, because the alpha is doing work here — see the coverage term below.
  let frame = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0);
  let scene = frame.rgb;

  let nf = uniforms.nearFar;
  let dims = vec2i(textureDimensions(depthTexture, 0));
  let dimsf = vec2f(dims);
  let base = input.vUV * dimsf;

  // THE WOBBLE — the whole cross displaced together, so a stroke MEANDERS
  // rather than its sampling breaking up. Two octaves per axis, the long one
  // carrying the drift and the short one the tremor, at an amplitude under a
  // texel. What it buys is that a long straight edge is no longer exactly
  // straight, which is the clearest single tell of a machine-drawn line.
  // **It is anchored in SCREEN space, and that is a compromise stated rather
  // than hidden**: a surface-anchored field would want the world position
  // reconstructed per pixel, and would swim over every bot that walks anyway.
  // At this amplitude and this frequency it reads as a line that wavers rather
  // than as a pattern the camera slides across — turning grain.y or grain.z up
  // finds the shower door quickly, which is why both are small.
  let n = base * uniforms.grain.z;
  let wob = vec2f(
    sin(n.y * 1.7 + 1.3) + 0.5 * sin(n.y * 4.3 + n.x * 1.1),
    sin(n.x * 1.9 + 2.7) + 0.5 * sin(n.x * 4.7 + n.y * 0.9)
  ) * uniforms.grain.y;
  let p = vec2i(base + wob);

  let dc = linearise(rawAt(p, dims), nf);

  // THE NIB, WHICH IS THE WHOLE OF WHY DISTANCE IS IN THIS PASS TWICE.
  //
  // A line one texel wide everywhere is the one thing a pen never draws: it
  // gives the palm grove at 300 m exactly the weight of the crate at 5, so a
  // frame full of geometry arrives with no hierarchy in it and the fog fade is
  // left to do alone what a draughtsman does with the NIB. Darkness and weight
  // are not one reading — a thin black line comes forward and a thick pale one
  // does not — so the two are separated here and spent together.
  //
  // The curve has TWO SIDES, because the near end is the viewmodel's: bold at
  // widthRange.x, tapering to a fine line by widthRange.y, and tapering back
  // DOWN inside widthRange.x for the reason ink.near already exists — at arm's
  // length the parts are smaller than the pen, and a full nib on a trigger
  // guard is a smudge.
  // The outward taper is on sqrt so most of the thinning happens in the first
  // few metres, where perspective does most of its own — but nowhere near the
  // 1/z that a constant WORLD thickness would give, which is the inverted hull
  // this pass replaced and which vanished at range.
  //
  // Widths are stated at widthBand.w rows and scale with the frame's own,
  // because a stroke is a fraction of the PICTURE rather than a count of
  // pixels — the same drawing on a phone and on a 4K panel. The reach is two
  // rings, so the nib is clamped at 3 texels (a five-texel stroke); past that a
  // third ring is four more loads.
  let wb = uniforms.widthBand;
  let far = saturate((dc - uniforms.widthRange.x)
    / max(0.001, uniforms.widthRange.y - uniforms.widthRange.x));
  let arm = smoothstep(0.0, 1.0, saturate(dc / max(0.001, uniforms.widthRange.x)));
  let nib = min(3.0, mix(wb.x, mix(wb.y, wb.z, sqrt(far)), arm) * (dimsf.y / wb.w));

  // What each ring is worth at this nib. The inner one carries a stroke up to a
  // texel wide and LIGHTENS below that rather than vanishing, which is the
  // honest reading of a sub-texel line and is what keeps distant clutter from
  // matting into a tangle of full-strength hairlines. The outer one is the
  // flank, and it arrives only once the core is full — so a stroke has a dark
  // centre and a softer edge, which is what a nib does and what a single ring
  // could never give.
  let core = saturate(nib);
  let flank = saturate((nib - 1.0) * 0.5);
  // A crease is interior detail, and an artist draws it finer as well as
  // lighter: the contour is laid down first and heaviest.
  let kNib = nib * uniforms.creaseStroke.y;
  let kCore = saturate(kNib);
  let kFlank = saturate((kNib - 1.0) * 0.5);

  let r1 = ringAt(p, dims, 1, dc, nf);
  let r2 = ringAt(p, dims, 2, dc, nf);

  let press = uniforms.grain.x;
  let contour = max(strokeOf(r1.x, uniforms.thresholds.x, press) * core,
                    strokeOf(r2.x, uniforms.thresholds.x, press) * flank);
  let crease = max(strokeOf(r1.y, uniforms.thresholds.y, press) * kCore,
                   strokeOf(r2.y, uniforms.thresholds.y, press) * kFlank);

  var edge = max(contour, crease * uniforms.creaseStroke.x);

  // The ink's own fade, on the cel shader's t*t curve. **Anything drawn
  // unshaded owes this** — see fogAmountAt — and here it is free and exact,
  // because the distance is already in hand where the hull needed a whole
  // shader-store patch (OutlineFog) to get it per pixel and a per-mesh width
  // ramp to approximate it. Without it a dense map at range mats into black
  // lines, which is the classic screen-space outline failure. The nib's taper
  // is the OTHER half of that and neither stands in for the other: this one
  // takes the line's DARKNESS, the nib takes its WEIGHT.
  let t = saturate((dc - uniforms.fadeBand.x) / max(0.001, uniforms.fadeBand.y - uniforms.fadeBand.x));
  edge *= 1.0 - t * t;

  // The NEAR BAND, which is the viewmodel and can only be the viewmodel: a body
  // cannot get within about 0.4 m of world geometry, so this names the weapon
  // without any per-mesh data. It stands in for the 0.004 m hull the gun used
  // to wear — full-weight line work on parts that small swallows it in black.
  // The nib's inward taper above is that same argument spent on WIDTH; this is
  // the darkness half, and the weapon wants both.
  edge *= mix(uniforms.nearBand.y, 1.0, saturate(dc / max(0.001, uniforms.nearBand.x)));

  // The EMISSIVE MASK — what the noInk flag used to buy. An inked emissive is
  // swallowed glow, so the ink gives way wherever the glow layer drew
  // something. Luma rather than a channel, because an emissive may be any
  // colour and a green sign must mask as well as a white one.
  let emissive = textureSampleLevel(emissiveSampler, emissiveSamplerSampler, input.vUV, 0.0).rgb;
  let lit = dot(emissive, vec3f(0.2126, 0.7152, 0.0722));
  edge *= 1.0 - smoothstep(uniforms.maskBand.x, uniforms.maskBand.y, lit);

  // TRANSLUCENT COVERAGE, and it is the one thing a depth buffer cannot tell
  // this pass. Smoke and the capture columns write no depth — they must not,
  // or a marker would hide what it marks — so the depth here is the bots and
  // the crates BEHIND them, and their line work was landing on top of the
  // effect at full strength, which reads as ink floating in front of it. The
  // frame's alpha channel carries how much got in the way: everything opaque
  // writes 0 (opaqueAlpha in CelShader, and the same 0 in the grass and the
  // water), the clear is 0, and every alpha-blended draw accumulates into it
  // for free, because Babylon's ALPHA_COMBINE blends the alpha channel (ONE,
  // ONE). So this costs no pass, no target and not even a texture read — it is
  // the channel of the sample the first line already took.
  //
  // It ATTENUATES rather than deletes, which is what makes it right rather than
  // merely absent: a wall seen through thin smoke keeps a faint line, and only
  // a fully opaque plume takes the line away. An ADDITIVE effect contributes
  // nothing here (ALPHA_ADD leaves the channel alone) and wants to contribute
  // nothing — a tracer's flare adds light rather than hiding what is behind it.
  edge *= 1.0 - saturate(frame.a);

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
    /** Read for its main texture ALONE — the emissive mask. Never mutated. */
    private readonly glow: GlowLayer,
  ) {
    const ink = CONFIG.graphics.ink;
    this.pass = new PostProcess("celInk", "celInk", {
      uniforms: [
        "nearFar",
        "thresholds",
        "fadeBand",
        "nearBand",
        "maskBand",
        "tint",
        "widthBand",
        "widthRange",
        "creaseStroke",
        "grain",
      ],
      samplers: ["depthTexture", "emissiveSampler"],
      size: 1.0,
      camera,
      engine: scene.getEngine(),
      shaderLanguage: ShaderLanguage.WGSL,
    });

    this.pass.onApply = (effect) => {
      effect.setFloat2("nearFar", this.camera.minZ, this.camera.maxZ);
      effect.setFloat2("thresholds", ink.silhouette, ink.crease);
      effect.setFloat2("fadeBand", this.fadeStart, this.fadeEnd);
      effect.setFloat2("nearBand", ink.near.until, ink.near.scale);
      effect.setFloat2("maskBand", ink.emissiveMask.from, ink.emissiveMask.to);
      effect.setFloat("tint", ink.tint);
      effect.setFloat4("widthBand", ink.width.eye, ink.width.bold, ink.width.fine, ink.width.rows);
      effect.setFloat2("widthRange", ink.width.from, ink.width.to);
      effect.setFloat2("creaseStroke", ink.creaseStroke.weight, ink.creaseStroke.width);
      effect.setFloat3("grain", ink.pressure, ink.wobble.amount, ink.wobble.scale);
      // A DECLARED texture must be BOUND or the bind group fails to build and
      // the draw is silently lost. It cannot be null by the time this runs —
      // the capture below is on the draw phase, which is earlier in the same
      // scene.render() — but `applyEnvironment` keeps the pass off the camera
      // until the first frame has handed one over, rather than resting on it.
      if (this.depth) effect.setTexture("depthTexture", this.depth);
      // Same rule, and this one cannot be null: the layer owns its main texture
      // from construction and `Game` builds the layer before this pass.
      effect.setTexture("emissiveSampler", this.glow.mainTexture);
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
