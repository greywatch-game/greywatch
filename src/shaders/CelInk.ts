/**
 * CelInk.ts — The game's ink, as one full-screen pass over the depth buffer
 * the frame has ALREADY written: its CPU HALF and the post chain's stage our
 * renderer draws it as (`render/PostChain.ts`, `BABYLON_EXIT.md` X5.2d).
 * Owns: `CelInk` — the map's fog band it fades over, and `stage`, the
 * `PostStage` the host draws: the program as Babylon's processor compiled
 * the WGSL this file used to register (`wgsl/celInk.ts`, the glow's compose
 * in its last line), its 112-byte block, its four extra bindings (the frame's
 * depth, read by `textureLoad`, and the glow's mask and two blurred targets,
 * each read through the host's own view and sampler) and its input — the
 * frame the scene drew — read NEAREST, clamped, as Babylon bound it. Reads no
 * game state and writes to no mesh.
 * Invariants: it runs FIRST in the post chain, before FXAA, the light shafts,
 * the blur and the grade — the host's list order, which `Game` assembles —
 * because it is part of the picture rather than a grade over one: FXAA
 * antialiases the lines it draws, and shafts and grain belong on top of
 * inked geometry, not under it.
 * Running first is also what lets it read the frame's alpha as translucent
 * coverage: it is the last pass that could, since every pass after it writes
 * alpha 1.
 * It only ever DARKENS (`mix(scene, scene * tint, edge)` with tint < 1), which
 * is what makes it safe to lay over a lit frame and is worth keeping true. The
 * bloom is composited AFTER it, in this pass's own last line — the glow's
 * compose, `GlowPass`' arithmetic, which the header there says is not a pass
 * of its own and which hands this stage its two targets and its intensity —
 * so a halo lies over the lines round its lamp rather than under them. "Only
 * darker" is therefore a promise about the ink's own `mix`, not about the
 * pixel this pass writes. Its block is filled when the host draws it, every
 * float; it is never off.
 * Never: draws, binds or owns a GPU resource (the host does); edits its
 * program — the text is the compiled one, and the notes on what each line
 * does are kept below, verbatim from the source it was compiled from.
 * Contract: `docs/rendering.md`, "The ink".
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
 * (`docs/rendering.md`, "The paint palette: why colour left the merge key").
 *
 * Measured, live round, uncapped headless, arms interleaved A B C A so the
 * run's own drift is on the page rather than assumed away — **Coldharbour
 * +15.4% with all of it gone and +6.4% with this in its place; Harrowmead
 * +34.7% and +32.6%**, against control drifts of 3.0% and 5.6%. Hollowmere was
 * discarded: 57.7% drift, the round had walked somewhere else.
 *
 * WHAT MAKES IT POSSIBLE is that the frame's own depth image is sampleable —
 * our renderer's since `BABYLON_EXIT.md` X5.4e (`FrameTargets.depth`, made
 * with `TEXTURE_BINDING`), `FrameDepth`'s capture of Babylon's before it; this
 * pass was where that capture first lived, and it moved out when `MotionBlur`
 * became its second reader. What is left here is the one fact that is this shader's: **no
 * sampler is needed and therefore none can be wrong.** The declaration is
 * `texture_depth_2d`, off which Babylon's WGSL processor inferred
 * `sampleType: "depth"` and which our pipeline cache lays out the same, and
 * every read is a `textureLoad`. An edge wants exact texels rather than
 * filtered ones anyway.
 *
 * DISTANCE IS IN THIS PASS THREE TIMES AND THE DEPTH BUFFER DOES NOT HOLD IT.
 * What a depth texel holds, linearised, is z along the camera's FORWARD AXIS;
 * what the cel shader fogs against is the radial distance to the eye, and the
 * two diverge as 1/cos(theta) toward the edges of the frame. So the fade, the
 * nib and the near band all read `dist` — view-z scaled by the frustum ray
 * through the pixel — and the ring tests keep view-z, because `ringAt`'s crease
 * term rests on 1/z being linear in screen space and that is a fact about the
 * projection rather than about distance. Getting it wrong is a bug that hides
 * from whoever looks for it: it appears on the FLANKS of a wide frame as ink
 * standing in front of fog that has already dissolved what it outlines, and
 * turning to face it takes theta to zero and the symptom with it.
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
 * which is the part the paint-palette measurement (`docs/rendering.md`) said
 * would need an ink-id attachment.
 * - **Emissives are masked out by the glow's MASK.** Every emissive part was
 *   excluded from the hull through what is now `noInk`, and an inked emissive
 *   is swallowed glow. `GlowPass` draws that mask at FULL RESOLUTION and
 *   emissive-only, so it costs one texture read and no pass. It is SHARP — the
 *   blur starts from a downsample of it and never writes back — and already
 *   depth-tested against this frame, so a lamp behind a wall does not protect
 *   the wall in front of it.
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
 * (`CelShader`'s `opaqueAlpha`, and a literal 0 in `wgsl/grass.ts` and
 * `wgsl/water.ts`), the dome and a frame with no map say 1 where there is only sky
 * (`wgsl/sky.ts`, `applyClearColor`), and every alpha-blended draw
 * accumulates into it with no help at all, because Babylon's ALPHA_COMBINE
 * blends alpha as (ONE, ONE). **So it costs no pass, no target and no texture
 * read** — it is the fourth channel of the sample this shader already took —
 * and this pass writes 1 back out, so nothing downstream ever sees it. THREE
 * things share it and each is checked in the tree rather than assumed: the glow
 * composes after the ink, inside this pass, and writes no alpha of its own, so
 * a bloom cannot claim coverage it does not have; an ADDITIVE effect leaves the
 * channel alone and should, since a flare adds light rather than hiding what is
 * behind it; and a REFLECTION PROBE wants the opposite value out of the same
 * line, which is why `opaqueAlpha` is a uniform: the frame's is 0, and the
 * bake's own frame (our renderer's, the only bake since X3.7c) states 1
 * (`CelMaterialFactory.fillBakeFrame`) — nothing flips it on a material.
 *
 * **It inks the terrain, the grass, the water and the debris, none of which the
 * hull touched, and that is KEPT.** Every blade of grass writes depth, so every
 * blade is a silhouette, and what that reads as is denser, darker grass. A
 * judgement rather than an accident — and `noInk` is deliberately absent from
 * those meshes so the flag does not claim otherwise.
 *
 * THE SHADER'S OWN NOTES, verbatim from the WGSL this file registered until
 * X5.2d, which Babylon's processor compiled into `wgsl/celInk.ts` and which
 * the compiled text keeps no comment of — each under the line it explained,
 * in the order the lines run. They were written for that source: where one
 * says Babylon's processor or `GlowPass` declares or binds something, the
 * compiled text and the stage below hold it as the processor left it.
 *
 * **At `depthTexture`, the frame's depth:**
 * The MAIN pass's depth attachment, the frame's own (`FrameTargets.depth`). Declared as a
 * depth texture so Babylon's WGSL processor gives the binding sampleType
 * "depth"; every read below is a textureLoad, so this pass declares no sampler
 * for it and there is none to get wrong.
 *
 * **At `emissiveSampler`, the glow's mask:**
 * The GLOW's mask: the emissive meshes ALONE, full resolution and UNBLURRED
 * (the blur reads a downsample of it and never writes back), already
 * depth-tested against this same frame. See
 * CONFIG.graphics.ink.emissiveMask.
 *
 * **At the glow's compose (`glowAt`):**
 * The bloom's compose, owned by GlowPass and added in this pass's last line.
 *
 * **At `linearise`:**
 * Buffer depth -> metres. Babylon is left-handed and WebGPU's NDC z is [0, 1]
 * (engine.isNDCHalfZRange), and nothing in the tree turns on a reverse depth
 * buffer, so this is the plain inverse of the projection's z row.
 *
 * **At `ringAt`:**
 * THE TWO TESTS, taken at a RING of radius r and handed back as (silhouette,
 * crease), so one function serves every ring the nib is wide enough to want.
 *
 * A SILHOUETTE is a step in depth, taken relative to the centre so that one
 * doorway reads the same at 5 m and at 50.
 *
 * A CREASE is a box corner, where depth is CONTINUOUS and only its slope
 * jumps — what a naive Sobel of depth misses, and what a normal buffer is
 * usually bought for. See CONFIG.graphics.ink.crease: 1/z is linear in screen
 * space across any plane, so this is zero on a flat surface at any angle and
 * large at a corner. Multiplying back by dc makes it dimensionless, so one
 * threshold holds at every range.
 *
 * **BOTH ARE DIVIDED BY r, and that is what lets ONE PAIR OF THRESHOLDS serve
 * every ring.** Across a sloped surface a depth difference grows in proportion
 * to the step taken over it, and a slope BREAK's second difference does the
 * same, so without the division an outer ring would read a grazing floor as a
 * silhouette and every dune would be a contour. What the division costs is
 * sensitivity on the outer ring at a WEAK edge — and that cost is the feature
 * rather than the price: a weak edge keeps the inner ring alone and is drawn
 * as a hairline, a strong one carries the whole nib, so a stroke varies in
 * width along its length with what it is describing. That is pressure, and it
 * is arrived at rather than painted on.
 *
 * **At `strokeOf`:**
 * A stroke's DARKNESS from a measurement and its threshold. The first factor is
 * whether there is a line here at all; the second is PRESSURE — a line that
 * only just qualifies is laid down lighter than one the geometry shouts, over a
 * band (t..5t) wide enough that the variation runs ALONG a stroke rather than
 * sitting at its ends. The floor is what the faintest line keeps.
 *
 * **At `frame`, the first sample:**
 * RGBA, because the alpha is doing work here — see the coverage term below.
 *
 * **At the wobble (`n`, `wob`, `p`):**
 * THE WOBBLE — the whole cross displaced together, so a stroke MEANDERS
 * rather than its sampling breaking up. Two octaves per axis, the long one
 * carrying the drift and the short one the tremor, at an amplitude under a
 * texel. What it buys is that a long straight edge is no longer exactly
 * straight, which is the clearest single tell of a machine-drawn line.
 * **It is anchored in SCREEN space, and that is a compromise stated rather
 * than hidden**: a surface-anchored field would want the world position
 * reconstructed per pixel, and would swim over every bot that walks anyway.
 * At this amplitude and this frequency it reads as a line that wavers rather
 * than as a pattern the camera slides across — turning grain.y or grain.z up
 * finds the shower door quickly, which is why both are small.
 *
 * **At `dist` (`ndc`):**
 * VIEW-Z IS NOT A DISTANCE, AND THE THREE TERMS BELOW WANT A DISTANCE. What
 * the depth buffer holds is z along the camera's FORWARD AXIS, and what the
 * cel shader fogs against is length(vPosW - camPos) — the radial distance
 * to the eye. The two agree only down the middle of the screen and diverge as
 * 1/cos(theta) toward its edges: on a 21:9 panel at the hip fov the horizontal
 * edge is 50.9 degrees off-axis, so a tree the fog has fully dissolved at 78 m
 * reported 49 m here and kept 0.78 of its ink and a near-bold nib.
 * That is line work hanging in FRONT of the fog on the flanks of the frame and
 * nowhere else — and turning to face it walks theta back to zero and takes it
 * away again, which is the tell.
 *
 * The ring tests above stay on view-z and MUST: ringAt's crease term rests
 * on 1/z being linear in screen space across a plane, which is a fact about
 * the projection's z and not about distance. So the conversion is spent here,
 * once, on the three terms that are asking how far away a thing IS.
 *
 * **At the nib (`wb` to `nib`):**
 * THE NIB, WHICH IS THE WHOLE OF WHY DISTANCE IS IN THIS PASS TWICE.
 *
 * A line one texel wide everywhere is the one thing a pen never draws: it
 * gives the palm grove at 300 m exactly the weight of the crate at 5, so a
 * frame full of geometry arrives with no hierarchy in it and the fog fade is
 * left to do alone what a draughtsman does with the NIB. Darkness and weight
 * are not one reading — a thin black line comes forward and a thick pale one
 * does not — so the two are separated here and spent together.
 *
 * The curve has TWO SIDES, because the near end is the viewmodel's: bold at
 * widthRange.x, tapering to a fine line by widthRange.y, and tapering back
 * DOWN inside widthRange.x for the reason ink.near already exists — at arm's
 * length the parts are smaller than the pen, and a full nib on a trigger
 * guard is a smudge.
 * The outward taper is on sqrt so most of the thinning happens in the first
 * few metres, where perspective does most of its own — but nowhere near the
 * 1/z that a constant WORLD thickness would give, which is the inverted hull
 * this pass replaced and which vanished at range.
 *
 * Widths are stated at widthBand.w rows and scale with the frame's own,
 * because a stroke is a fraction of the PICTURE rather than a count of
 * pixels — the same drawing on a phone and on a 4K panel. The reach is two
 * rings, so the nib is clamped at 3 texels (a five-texel stroke); past that a
 * third ring is four more loads.
 *
 * **At `core` and `flank`:**
 * What each ring is worth at this nib. The inner one carries a stroke up to a
 * texel wide and LIGHTENS below that rather than vanishing, which is the
 * honest reading of a sub-texel line and is what keeps distant clutter from
 * matting into a tangle of full-strength hairlines. The outer one is the
 * flank, and it arrives only once the core is full — so a stroke has a dark
 * centre and a softer edge, which is what a nib does and what a single ring
 * could never give.
 *
 * **At `kNib`:**
 * A crease is interior detail, and an artist draws it finer as well as
 * lighter: the contour is laid down first and heaviest.
 *
 * **At the fade (`t`):**
 * The ink's own fade, on the cel shader's t*t curve. **Anything drawn
 * unshaded owes this** — see fogAmountAt — and here it is free and exact,
 * because the distance is already in hand where the hull needed a whole
 * shader-store patch (OutlineFog) to get it per pixel and a per-mesh width
 * ramp to approximate it. Without it a dense map at range mats into black
 * lines, which is the classic screen-space outline failure. The nib's taper
 * is the OTHER half of that and neither stands in for the other: this one
 * takes the line's DARKNESS, the nib takes its WEIGHT.
 *
 * **At the near band (`edge *= mix(uniforms.nearBand.y, …)`):**
 * The NEAR BAND, which is the viewmodel and can only be the viewmodel: a body
 * cannot get within about 0.4 m of world geometry, so this names the weapon
 * without any per-mesh data. It stands in for the 0.004 m hull the gun used
 * to wear — full-weight line work on parts that small swallows it in black.
 * The nib's inward taper above is that same argument spent on WIDTH; this is
 * the darkness half, and the weapon wants both.
 *
 * **At the emissive mask (`emissive`, `lit`):**
 * The EMISSIVE MASK — what the noInk flag used to buy. An inked emissive is
 * swallowed glow, so the ink gives way wherever the glow layer drew
 * something. Luma rather than a channel, because an emissive may be any
 * colour and a green sign must mask as well as a white one.
 *
 * **At the coverage term (`edge *= 1.0 - saturate(frame.a)`):**
 * TRANSLUCENT COVERAGE, and it is the one thing a depth buffer cannot tell
 * this pass. Smoke and the capture columns write no depth — they must not,
 * or a marker would hide what it marks — so the depth here is the bots and
 * the crates BEHIND them, and their line work was landing on top of the
 * effect at full strength, which reads as ink floating in front of it. The
 * frame's alpha channel carries how much got in the way: everything opaque
 * writes 0 (opaqueAlpha in CelShader, and the same 0 in the grass and the
 * water), a pixel of sky is 1, and every alpha-blended draw accumulates into it
 * for free, because Babylon's ALPHA_COMBINE blends the alpha channel (ONE,
 * ONE). So this costs no pass, no target and not even a texture read — it is
 * the channel of the sample the first line already took.
 *
 * It ATTENUATES rather than deletes, which is what makes it right rather than
 * merely absent: a wall seen through thin smoke keeps a faint line, and only
 * a fully opaque plume takes the line away. An ADDITIVE effect contributes
 * nothing here (ALPHA_ADD leaves the channel alone) and wants to contribute
 * nothing — a tracer's flare adds light rather than hiding what is behind it.
 *
 * **At the output (`inked`):**
 * ONLY EVER DARKER. tint < 1, so the ink cannot leave a pixel brighter than
 * it arrived — which is what lets it sit over a lit frame, with the bloom
 * composited over it afterwards, without either disturbing the other. The
 * bloom is that afterwards: added to the inked pixel rather than inked over.
 */
import type { Camera } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { FrameTargets } from "../render/FrameTargets";
import type { PostStage } from "../render/PostChain";
import { fogBand } from "./CelShader";
import type { GlowPass } from "./GlowPass";
import {
  CEL_INK_BLOCK as B,
  CEL_INK_FRAGMENT,
  CEL_INK_FRAGMENT_BINDINGS,
  CEL_INK_VERTEX,
  CEL_INK_VERTEX_BINDINGS,
} from "./wgsl/celInk";

/**
 * The sampler Babylon bound the ink's input — the frame — with (a
 * post-process's default `NEAREST_SAMPLINGMODE`, on a texture with no mips;
 * read off the parent's device by `plans/webgpu-ref/post.mjs`).
 */
const INPUT_SAMPLER: GPUSamplerDescriptor = {
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
  addressModeW: "repeat",
  magFilter: "nearest",
  minFilter: "nearest",
  mipmapFilter: "nearest",
  lodMinClamp: 0,
  lodMaxClamp: 0,
  maxAnisotropy: 1,
};

export class CelInk {
  /** The stage the post chain draws the ink as. */
  readonly stage: PostStage;

  /** The map's fog band, re-read on every environment change. */
  private fadeStart = 0;
  private fadeEnd = 1;

  constructor(
    private readonly camera: Camera,
    /** The bloom's rules: the intensity the compose adds (`composeIntensity`). Read, never written. */
    private readonly glow: GlowPass,
    /**
     * The frame's targets (`render/FrameTargets.ts`, our renderer's): the
     * frame's own depth image, shared with every stage, and the bloom's
     * emissive mask, read as the ink's mask, with the two blurred halves the
     * compose adds (`near`, `wide`). Read, never written.
     */
    frame: FrameTargets,
  ) {
    this.stage = {
      name: "ink",
      label: "celInk",
      vertex: CEL_INK_VERTEX,
      vertexBindings: CEL_INK_VERTEX_BINDINGS,
      fragment: CEL_INK_FRAGMENT,
      fragmentBindings: CEL_INK_FRAGMENT_BINDINGS,
      // The rings and the wobble walk the DEPTH across a neighbourhood, but
      // the input — the frame — is read at its own pixel alone.
      reads: "point",
      inputBinding: 0,
      inputSamplerBinding: 5,
      internalsBinding: 9,
      blockBinding: 10,
      inputSampler: INPUT_SAMPLER,
      blockFloats: B.floats,
      extras: [
        // The frame's depth, read by `textureLoad` (no sampler). Viewless
        // before the first frame has sized it, and the stage then draws
        // nothing — it cannot be by the time the chain draws, the frame being
        // sized as the same render starts.
        { binding: 1, texture: () => frame.depth },
        // The glow's mask and its two blurred targets, each through its own
        // view and the sampler Babylon's cache made for the glow's targets
        // (bilinear, clamped: `FrameTargets`, ours since X5.4e).
        { binding: 2, samplerBinding: 6, texture: () => frame.mask },
        { binding: 3, samplerBinding: 7, texture: () => frame.near },
        { binding: 4, samplerBinding: 8, texture: () => frame.wide },
      ],
      // Never off: the ink is part of the picture, not a setting.
      active: () => true,
      fill: (block, width, height) => this.fill(block, width, height),
    };
    this.applyEnvironment();
  }

  /**
   * This frame's block, as Babylon's `onApply` set it: the vertex stage's
   * `scale` (1, 1), then every uniform the ink declares, and the compose's
   * intensity in the last float. Every float is written; the pad stays zero.
   */
  private fill(b: Float32Array, width: number, height: number): void {
    const ink = CONFIG.graphics.ink;
    b[B.scale] = 1;
    b[B.scale + 1] = 1;
    b[B.nearFar] = this.camera.minZ;
    b[B.nearFar + 1] = this.camera.maxZ;
    // Read fresh every frame rather than cached, because `fov` is written by
    // `CameraSystem.place` and moves with the ADS zoom, the sight and the
    // per-shot punch — and a stale one puts the ink's idea of distance back
    // out of step with the fog's the moment a scope comes up. Babylon's
    // default fovMode is FOVMODE_VERTICAL_FIXED, so `camera.fov` is the
    // VERTICAL half-angle doubled and the horizontal follows the aspect,
    // which is taken from the size of what the pass reads so a resized
    // window is right on the frame it happens (`MotionBlur` reads both the
    // same way).
    const tanY = Math.tan(this.camera.fov * 0.5);
    b[B.tanHalfFov] = (tanY * width) / Math.max(1, height);
    b[B.tanHalfFov + 1] = tanY;
    b[B.thresholds] = ink.silhouette;
    b[B.thresholds + 1] = ink.crease;
    b[B.fadeBand] = this.fadeStart;
    b[B.fadeBand + 1] = this.fadeEnd;
    b[B.nearBand] = ink.near.until;
    b[B.nearBand + 1] = ink.near.scale;
    b[B.maskBand] = ink.emissiveMask.from;
    b[B.maskBand + 1] = ink.emissiveMask.to;
    b[B.tint] = ink.tint;
    b[B.widthBand] = ink.width.eye;
    b[B.widthBand + 1] = ink.width.bold;
    b[B.widthBand + 2] = ink.width.fine;
    b[B.widthBand + 3] = ink.width.rows;
    b[B.widthRange] = ink.width.from;
    b[B.widthRange + 1] = ink.width.to;
    b[B.creaseStroke] = ink.creaseStroke.weight;
    b[B.creaseStroke + 1] = ink.creaseStroke.width;
    b[B.grain] = ink.pressure;
    b[B.grain + 1] = ink.wobble.amount;
    b[B.grain + 2] = ink.wobble.scale;
    b[B.glowIntensity] = this.glow.composeIntensity;
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
}
