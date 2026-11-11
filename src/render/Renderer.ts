/**
 * render/Renderer.ts — Our renderer: the device, the frame's uniforms and
 * their buffer, the pipeline cache, the frame's own targets and passes — the
 * opening clear, the main pass, the glow's mask and its blur (`BABYLON_EXIT.md`
 * X5.4e) — and the draws it records into them. (The post chain's passes,
 * which the HOST opened and this queued a stage's draw into until X5.4f, are
 * our renderer's too: `render/ChainPasses.ts` begins them and the chain draws
 * in them, `render/PostChain.ts`.)
 * Owns: `Renderer` — the frame's `FrameUniforms` and `FrameUniformBuffer`,
 * its `FrameTextures` and the bind group they make with the buffer (group 0
 * of every program, `FrameContext.frameGroup`, handed to a prepare as to a
 * draw), the `PipelineCache`, the frame's targets (`targets`, `FrameTargets`)
 * and the descriptors of the passes it records into them, the `FrameDraw`s at
 * each of the seven points they may be drawn at and those drawn in the glow's
 * mask — first (`addGlowMask`, and behind those `addGlowMaskBlended`) or last
 * (`addGlowMaskLate`) — each with the predicate that
 * says whether it has anything to draw this frame (`Active`), the
 * `FramePrepare`s run as the draw phase begins, whoever is told of a refused
 * pass (`onRefused`, and the mask's `onGlowMaskRefused`),
 * the hook into the host's draw phase, the `PassTimer` that times the
 * prepares' passes under `?gpu` (`timer`), and the `TextureMaker` that makes
 * the textures the game paints for itself (`textureMaker`, `BABYLON_EXIT.md`
 * X5.4d); `FrameDraw`, `FramePrepare`,
 * `DrawPoint`, `FrameContext` and `RendererOptions`.
 * Invariants: every GPU resource it holds it made, on the host's device, and
 * destroys in `dispose` (`BABYLON_EXIT.md` rule 5) — AT ONCE, its frame
 * buffer, the frame's targets and every texture its maker made, so its one
 * caller, a lost device's teardown (`Game.deviceLost`, X5.4i), calls it
 * between frames, after the last submit, the loop stopped and no frame
 * recording into it after; the frame's uniforms are
 * filled by the `fill` it is handed (`CelMaterialFactory.fillFrame`) and the
 * host's camera, and its textures by `fillTextures`
 * (`CelMaterialFactory.fillFrameTextures`) resolved through the host, once
 * per frame as the draw phase begins, and uploaded only when something will
 * draw — a draw is counted only while its predicate says it has something
 * (none: always), so a frame with nothing of ours committed (the menu with no
 * kit screen up) fills nothing, uploads nothing, refreshes no bind group and
 * runs no prepare: one walk of the predicates; the next frame that DOES draw
 * fills, uploads and refreshes in full before anything binds (`begin`), so no
 * draw ever binds a frame or a texture a skipped frame left stale (X4.3c's
 * review, the owner's decision); every `FramePrepare` runs right after that
 * fill, on the same frames,
 * so what it hands the GPU is this frame's, and records into the host's
 * encoder rather than submitting one of its own, so the frame's GPU timer
 * sees it, the LATE ones after the rest (`onFrame`'s `late`) — and, with a
 * `timer`, is handed the `PassTiming` its passes take
 * their timestamp writes from on a frame being timed, null on every other
 * (`gpu.cull`); without one, timing costs the frame one null test;
 * **the frame's passes are recorded into that same encoder, after the
 * prepares, as Babylon began them** (`BABYLON_EXIT.md` X5.4e, read off the
 * device at its BEFORE): at the draw phase's END the opening pass (the
 * frame's colour cleared to the host's clear colour, its depth to 1) and the
 * main pass (the colour loaded, the depth cleared again), every frame the
 * camera draws, whatever is to draw; then, asked by `GlowPass` from the same
 * end, the mask (`recordGlowMask`: cleared to black with alpha 1, the frame's
 * depth loaded) and the blur's passes (`glowBlurPass`, each loaded) — so the
 * post chain, whose passes `ChainPasses` begins in the same encoder after
 * these (X5.4f; the host opened them on the encoder it submits after this
 * one until then), reads them, and `gpu.frame` and `present` keep Babylon's
 * meaning until X5.4g;
 * every target is made from the targets its pipelines are built against
 * (`FRAME_TARGETS`, `GLOW_TARGETS`, `GLOW_BLUR_TARGETS`), so a pass of ours
 * takes them by construction and is never tested; a frame draws only if it was
 * FILLED this frame (a draw added mid-phase waits for the next), and a frame
 * whose targets are not made yet records no pass, every `onRefused` listener
 * told, with one console error per change, if something was to draw (the
 * world's failure, since nothing else would draw it);
 * a GLOW MASK draw is recorded in the mask's pass on a frame whose `begin`
 * filled the frame, FIRST in it, right after its clear (`addGlowMask`), or
 * LAST (`addGlowMaskLate`) — with the main pass's refusal rule and listeners
 * of its own (`onGlowMaskRefused`);
 * a GLOW BLUR draw reads no frame of ours, so it is recorded whether or not
 * `begin` filled one;
 * **no draw here needs anything of Babylon's in group 0**: the points are told
 * by this file, in their order, at the end of every draw phase
 * (`BABYLON_EXIT.md` X4.5a, X5.4e);
 * the mask reads the MAIN pass's frame — the same camera, in the same submit
 * — so it binds the same group 0; nothing here allocates on a frame.
 * Never: imports Babylon — it is handed a `FrameHost`; draws into a pass of
 * anyone else's (a prepare's pass into a texture of ours is the prepare's;
 * the post chain's are `ChainPasses`'); reads a Babylon material; records a
 * pass of the frame's anywhere but the host's prepare encoder.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * WHERE A DRAW LANDS, at one of seven points of the main pass, six of them
 * named for rendering group 0 (the world) as Babylon's queues ordered it
 * (`DrawPoint`), which come in this order in every frame, recorded together at
 * the end of the draw phase (`end`):
 * - `"first"`: as the pass starts, ahead of everything of the host's. A draw
 *   that writes no depth and is MEANT to be painted over belongs here: anything
 *   drawn after a depthless sky must be nearer than it or the sky paints over it,
 *   and anything before it spends shading the sky covers. It is the dome's
 *   (`SkyDraw`, `BABYLON_EXIT.md` X4.5c, added at construction and so first of
 *   the list); an empty list asks nothing of the pass.
 * - `"beforeAlphaTest"`: after the group's opaque meshes and before its
 *   ALPHA-TESTED ones — or, in a frame with none of those, immediately ahead
 *   of `"opaque"`. An opaque draw that something at `"opaque"`
 *   is laid OVER goes here: that is where a blend that must land after
 *   the surface under it is put (the turf, `GrassDraw`), and
 *   the turf writes no depth of its own — so the FLOOR it lies on must be in
 *   the depth buffer, and in the picture, before it draws. FIRST of ours here is the
 *   one nearest-first run of the zones, the blades and the water (`NearestRun`,
 *   X4.6d), what stands in Babylon's opaque list's place, which holds only the
 *   `backed` panes in a round now and ties with nothing in it. The world's other
 *   opaque draws go here too, AHEAD of the floor (`WorldBlocks`): the point
 *   is after the sky dome, which writes no depth, and a building drawn
 *   before the floor behind it spares that floor its shading. The emissive
 *   palette goes FIRST in that one draw, where Babylon's opaque queue had
 *   it ahead of every surface of ours, so an equal-depth tie with its own
 *   wall goes the way it went.
 * - `"afterSurfaces"`: right behind the whole of `"beforeAlphaTest"`, whatever
 *   order anything was added in, and still ahead of the alpha-tested list: the
 *   one place that is after EVERY opaque surface, the host's and ours, and
 *   before everything blended, the turf included. It is the clouds'
 *   (`CloudDraw`, `BABYLON_EXIT.md` X4.5b), who write a far depth: drawn before
 *   a surface they pass where it has not written yet, and drawn after the turf,
 *   which writes no depth, they paint over any of it against the sky.
 * - `"opaque"`: after the group's opaque and alpha-tested meshes and before
 *   anything blended in it — its particles and its transparent meshes. It is the
 *   turf's (`GrassDraw`, `BABYLON_EXIT.md` X4.6c). No
 *   OPAQUE draw goes later, because the blended surfaces write no depth: an
 *   opaque wall drawn after the glazing or the water in front of it paints
 *   over them, and one drawn after a particle in front of it paints over
 *   the particle.
 * - `"particles"`: right behind the whole of `"opaque"`, whatever order anything
 *   was added in, and still ahead of `"beforeBlended"` and of anything blended
 *   the host draws in the group: where the host's group drew its PARTICLES —
 *   every field of the game's is ours (`ParticleDraw`, `BABYLON_EXIT.md` X4.7c
 *   the ash, X4.7d the rotor wash), behind the turf, which is added at
 *   `"opaque"` at every install, and ahead of the moon.
 * - `"beforeBlended"`: after the group's sprites and particles and ahead of its
 *   transparent meshes. It is the moon's (`SkyDraw`, `BABYLON_EXIT.md` X4.5c), a
 *   blended draw that writes no depth and was the first of that list by distance:
 *   so it paints over the particles in front of it, and everything else that
 *   blends paints over it.
 * - `"afterGroup"`: after the group has been queued whole — its blended
 *   queue included — and before any group above it (none holds anything
 *   since `BABYLON_EXIT.md` X4.3d). The player's whole WEAPON is drawn here
 *   (`ViewDraw`, X4.3c and X4.3d): the kit card first, where it was the last
 *   of group 0's blended queue, then the opaque parts, where group 1's opaque
 *   queue drew them, then the optics' glasses, where its blended queue did —
 *   so the card covers the world, the weapon covers the card and the glasses
 *   draw over the weapon.
 */
import {
  createFrameTextures,
  createFrameUniforms,
  FRAME_BLOCK,
  FRAME_TEXTURES,
  type FrameTextures,
  type FrameUniforms,
} from "./frame";
import type { FrameHost } from "./frameHost";
import { type FrameTarget, FrameTargets } from "./FrameTargets";
import { FrameUniformBuffer } from "./FrameUniformBuffer";
import { HostBindGroup } from "./HostBindGroup";
import { type PassTiming, PassTimer } from "./PassTimer";
import { PipelineCache } from "./PipelineCache";
import { FRAME_TARGETS } from "./targets";
import { anisotropic, TextureMaker } from "./TextureMaker";

/** What a draw is handed beside the pass. */
export interface FrameContext {
  /** The frame block's buffer: group 0, binding 0 of every program. */
  readonly frameBuffer: GPUBuffer;
  /** Whether clip-space y is negated in this pass — see `PassTargets.flipY`. */
  readonly flipY: boolean;
  /**
   * Group 0 — the frame block and every frame texture — made against
   * `layout`, or null on a frame a texture is not published yet (draw
   * nothing that reads it). Valid for this frame.
   */
  frameGroup(layout: GPUBindGroupLayout): GPUBindGroup | null;
}

/**
 * One thing drawn in the main pass — or in the glow's mask (`addGlowMask`).
 * It sets its own pipeline, bind groups and buffers (the draw before it in the
 * pass may have left any of them), changes none of the pass's viewport,
 * scissor, stencil reference or blend constant (no draw of the frame's sets
 * one, and each holds the pass's defaults, as Babylon's did), and draws only
 * with pipelines built against its pass's targets (`FRAME_TARGETS`,
 * `GLOW_TARGETS`).
 */
export type FrameDraw = (pass: GPURenderPassEncoder, ctx: FrameContext) => void;

/**
 * Work for the frame that must reach the GPU before the main pass's draws do
 * — a compute cull, or a pass into a texture our renderer owns that the
 * frame samples (a world shadow map, `WorldShadows`). Run once a frame as
 * the draw phase begins, after the frame is filled; it records into
 * `encoder`, the host's own, which is submitted ahead of every pass of the
 * host's and inside the frame's GPU timer (`FrameHost.prepareEncoder`) — a
 * pass it records is begun and ended there, ahead of the frame's own passes,
 * which are recorded into the same encoder after it — and it records nothing
 * into the main pass, submits nothing and keeps neither.
 * `timing` is non-null on a frame whose passes are timed (`PassTimer`): each
 * CULL's compute pass it records then begins with `timing.pass(its descriptor)`,
 * so `gpu.cull` is the sum of them; a compute pass that is no cull — the
 * particles' update (`ParticleDraw`, `BABYLON_EXIT.md` X4.7c), the irradiance
 * volume's three (`GiCompute`, X5.1b, a LATE prepare) — is left untimed and is
 * in the frame's time (`gpu.frame`) alone.
 * **Once a SUBMIT, as the frame block is**: what it hands the queue
 * (`writeBuffer`) lands before the submit its recording rides in, so a second
 * run before that submit would leave both reading the second one's values.
 * The main pass begins once a frame; a second pass that runs prepares owes
 * them a buffer of its own.
 */
export type FramePrepare = (
  frame: FrameUniforms,
  encoder: GPUCommandEncoder,
  timing: PassTiming | null,
  /** What a draw is handed, valid for this frame: a prepare may ask it whether something can draw. */
  ctx: FrameContext,
) => void;

/** How a `Renderer` is built beyond its host and its fills. */
export interface RendererOptions {
  /**
   * Time the prepares' compute passes (`PassTimer`, `gpu.cull`): `?gpu`,
   * and only where the device has `timestamp-query` — asked of the device,
   * so a request it cannot answer builds no timer.
   */
  readonly timePasses?: boolean;
}

/** Where in the main pass a `FrameDraw` is drawn — see the header. */
export type DrawPoint =
  | "first"
  | "beforeAlphaTest"
  | "afterSurfaces"
  | "opaque"
  | "particles"
  | "beforeBlended"
  | "afterGroup";

/**
 * Whether a draw has anything to draw this frame — asked once a frame as the
 * pass begins, before anything is filled. Absent: always.
 */
export type Active = () => boolean;

/** Whether anything in `list` is active: a draw with no predicate always is. */
function anyActive(list: readonly FrameDraw[], active: readonly (Active | null)[]): boolean {
  for (let i = 0; i < list.length; i++) {
    const a = active[i];
    if (!a || a()) return true;
  }
  return false;
}

export class Renderer {
  readonly device: GPUDevice;
  readonly host: FrameHost;
  readonly pipelines: PipelineCache;
  /** The frame as last filled. Read-only to anything but `begin`. */
  readonly frame: FrameUniforms = createFrameUniforms();
  readonly frameBuffer: FrameUniformBuffer;
  /** The frame's textures as last pulled. Read-only to anything but `begin`. */
  readonly textures: FrameTextures = createFrameTextures();
  /** The prepares' pass timer, under `?gpu` on a device that can; null otherwise. */
  readonly timer: PassTimer | null;
  /** The textures the game paints, decodes and writes for itself, made as Babylon made them. */
  readonly textureMaker: TextureMaker;
  /**
   * The targets the frame's own passes draw into — the frame and its depth,
   * the glow's mask and its blur's five (`BABYLON_EXIT.md` X5.4e).
   */
  readonly targets: FrameTargets;
  private readonly frameBindings: HostBindGroup;

  /** In the order added, one list per point. Arrays, so a frame's walk allocates no iterator. */
  private readonly firstDraws: FrameDraw[] = [];
  private readonly beforeAlpha: FrameDraw[] = [];
  private readonly surfaced: FrameDraw[] = [];
  private readonly opaque: FrameDraw[] = [];
  private readonly particles: FrameDraw[] = [];
  private readonly blended: FrameDraw[] = [];
  private readonly after: FrameDraw[] = [];
  /** Each list's predicates, index for index (null: always active). */
  private readonly firstActive: (Active | null)[] = [];
  private readonly beforeAlphaActive: (Active | null)[] = [];
  private readonly surfacedActive: (Active | null)[] = [];
  private readonly opaqueActive: (Active | null)[] = [];
  private readonly particlesActive: (Active | null)[] = [];
  private readonly blendedActive: (Active | null)[] = [];
  private readonly afterActive: (Active | null)[] = [];
  private readonly prepares: FramePrepare[] = [];
  private readonly latePrepares: FramePrepare[] = [];
  private readonly refusals: (() => void)[] = [];
  /** Drawn first in the glow's mask, in the order added (`addGlowMask`). */
  private readonly maskDraws: FrameDraw[] = [];
  private readonly maskActive: (Active | null)[] = [];
  /** Drawn behind every `addGlowMask` draw in that same place, in the order added (`addGlowMaskBlended`). */
  private readonly maskBlendedDraws: FrameDraw[] = [];
  private readonly maskBlendedActive: (Active | null)[] = [];
  /** Drawn LAST in the glow's mask, in the order added (`addGlowMaskLate`). */
  private readonly maskLateDraws: FrameDraw[] = [];
  private readonly maskLateActive: (Active | null)[] = [];
  private readonly maskRefusals: (() => void)[] = [];
  /** What every draw and prepare is handed: the frame block's buffer and its group 0. */
  private readonly ctx: FrameContext;
  private readonly hook: { dispose(): void };
  /** Whether `begin` filled and uploaded the frame this draw phase. */
  private filled = false;
  /**
   * Whether `begin` filled the frame for the glow's mask, which is recorded
   * after the main pass — until it is: spent by the FIRST mask after `begin`.
   * The mask is recorded once a frame (one camera: `GlowPass.render` returns
   * for any other), and a second in one frame would draw nothing of ours.
   */
  private maskFilled = false;
  /** Whether the last frame could not record its main pass — so a refusal is reported once per change. */
  private refused = false;
  /** The same, for the glow's mask. */
  private maskRefused = false;
  /** The frame's clear colour this frame (`FrameHost.clearColor`), written in place. */
  private readonly clearValue: GPUColorDict = { r: 0, g: 0, b: 0, a: 1 };
  /**
   * The frame's two passes and the mask's, as Babylon began them (X5.4e's
   * BEFORE, `plans/webgpu-ref/post.mjs`), each a descriptor made once and
   * re-pointed at its targets' views every frame. The OPENING pass clears the
   * frame's colour to the scene's clear colour and its depth to 1, where
   * `Scene.render`'s first bind cleared the camera's output target
   * (`_clearFrameBuffer`); the MAIN pass loads that colour and clears the depth
   * again, as the camera's render bound the target and cleared its depth.
   */
  private readonly clearColour: GPURenderPassColorAttachment;
  private readonly clearDepth: GPURenderPassDepthStencilAttachment;
  private readonly clearPass: GPURenderPassDescriptor;
  private readonly mainColour: GPURenderPassColorAttachment;
  private readonly mainDepth: GPURenderPassDepthStencilAttachment;
  private readonly mainPass: GPURenderPassDescriptor;
  /** The mask's: its colour cleared to black, alpha 1 (`GlowPass`' old `NEUTRAL`), the frame's depth LOADED. */
  private readonly maskColour: GPURenderPassColorAttachment;
  private readonly maskDepth: GPURenderPassDepthStencilAttachment;
  private readonly maskPass: GPURenderPassDescriptor;
  /** A pass of the glow's blur: its target LOADED, no depth (`glowBlurPass`). */
  private readonly blurColour: GPURenderPassColorAttachment;
  private readonly blurPass: GPURenderPassDescriptor;

  constructor(
    host: FrameHost,
    private readonly fill: (out: FrameUniforms) => void,
    private readonly fillTextures: (out: FrameTextures) => void,
    options: RendererOptions = {},
  ) {
    this.host = host;
    this.device = host.device;
    this.pipelines = new PipelineCache(this.device);
    this.textureMaker = new TextureMaker(this.device, host, this.pipelines);
    this.targets = new FrameTargets(
      this.device,
      host,
      this.textureMaker.sampler(anisotropic("clamp-to-edge", "clamp-to-edge", 4)),
    );
    this.timer =
      options.timePasses && this.device.features.has("timestamp-query") ? new PassTimer(this.device) : null;
    this.frameBuffer = new FrameUniformBuffer(this.device, "main pass");
    this.frameBindings = new HostBindGroup(
      this.device,
      "main pass frame",
      [FRAME_BLOCK, ...FRAME_TEXTURES],
      ["CEL_PALETTE"],
      { [FRAME_BLOCK.var]: this.frameBuffer.buffer },
    );
    const bindings = this.frameBindings;
    this.ctx = {
      frameBuffer: this.frameBuffer.buffer,
      flipY: FRAME_TARGETS.flipY,
      frameGroup: (layout) => bindings.get(layout),
    };
    // A view of `null` until the first frame points each at its target.
    const nothing = null as unknown as GPUTextureView;
    this.clearColour = { view: nothing, clearValue: this.clearValue, loadOp: "clear", storeOp: "store" };
    this.clearDepth = {
      view: nothing,
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
      depthReadOnly: false,
      stencilReadOnly: false,
    };
    this.clearPass = { label: "", colorAttachments: [this.clearColour], depthStencilAttachment: this.clearDepth };
    this.mainColour = { view: nothing, loadOp: "load", storeOp: "store" };
    this.mainDepth = { ...this.clearDepth };
    this.mainPass = { label: "", colorAttachments: [this.mainColour], depthStencilAttachment: this.mainDepth };
    this.maskColour = { view: nothing, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" };
    this.maskDepth = {
      view: nothing,
      depthLoadOp: "load",
      depthStoreOp: "store",
      depthReadOnly: false,
      stencilReadOnly: false,
    };
    this.maskPass = {
      label: this.targets.mask.passLabel,
      colorAttachments: [this.maskColour],
      depthStencilAttachment: this.maskDepth,
    };
    this.blurColour = { view: nothing, loadOp: "load", storeOp: "store" };
    this.blurPass = { label: "", colorAttachments: [this.blurColour] };
    this.hook = host.onDrawPhase({ begin: this.begin, end: this.end });
  }

  /**
   * Draws `draw` at `at` in every main pass from the next one on, until the
   * returned function is called.
   */
  add(draw: FrameDraw, at: DrawPoint = "afterGroup", active?: Active): () => void {
    switch (at) {
      case "first":
        return hang(this.firstDraws, this.firstActive, draw, active);
      case "beforeAlphaTest":
        return hang(this.beforeAlpha, this.beforeAlphaActive, draw, active);
      case "afterSurfaces":
        return hang(this.surfaced, this.surfacedActive, draw, active);
      case "opaque":
        return hang(this.opaque, this.opaqueActive, draw, active);
      case "particles":
        return hang(this.particles, this.particlesActive, draw, active);
      case "beforeBlended":
        return hang(this.blended, this.blendedActive, draw, active);
      case "afterGroup":
        return hang(this.after, this.afterActive, draw, active);
    }
  }

  /**
   * Runs `prepare` in every main pass from the next one on, until the
   * returned function is called — with `late`, after every prepare that is
   * not: work that SAMPLES what the others draw this frame (a probe's bake
   * reads the world's shadow maps and the lamps' atlas), whatever order the
   * two were added in.
   */
  onFrame(prepare: FramePrepare, late = false): () => void {
    const list = late ? this.latePrepares : this.prepares;
    list.push(prepare);
    return () => {
      const i = list.indexOf(prepare);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /**
   * Calls `refused` on every frame whose main pass cannot be recorded — its
   * targets not made yet — while something was to draw, until the returned
   * function is called; once a frame. (Until `BABYLON_EXIT.md` X5.4e it was a
   * pass of BABYLON's that was not `FRAME_TARGETS`, told at each point; the
   * pass is ours since, made from those targets.) It runs INSIDE the render,
   * after this frame's prepares were recorded, so it may take draws and
   * prepares off this renderer but must free nothing this frame's commands
   * hold.
   */
  onRefused(refused: () => void): () => void {
    this.refusals.push(refused);
    return () => {
      const i = this.refusals.indexOf(refused);
      if (i >= 0) this.refusals.splice(i, 1);
    };
  }

  /**
   * Draws `draw` in the glow's MASK pass from the next frame on, until the
   * returned function is called: FIRST in that pass, right after its clear —
   * on every frame its owner records it (`recordGlowMask`). Its pipelines are
   * built against `GLOW_TARGETS`, and it reads the main pass's frame
   * (`FrameContext`): the mask is drawn from the same camera in the same
   * submit.
   */
  addGlowMask(draw: FrameDraw, active?: Active): () => void {
    return hang(this.maskDraws, this.maskActive, draw, active);
  }

  /**
   * Draws `draw` in the glow's MASK pass from the next frame on, until the
   * returned function is called: where `addGlowMask`'s go and behind every one of
   * them, whatever order anything was added in. A draw that was first of the
   * mask's BLENDED list belongs here: only Babylon's mask-opaque meshes lay
   * between the two places (none since X5.3c), and each of those wrote the
   * depth a blended draw at its pixel is rejected by, so neither order was seen
   * (the moon, `SkyDraw`, `BABYLON_EXIT.md` X4.5c).
   */
  addGlowMaskBlended(draw: FrameDraw, active?: Active): () => void {
    return hang(this.maskBlendedDraws, this.maskBlendedActive, draw, active);
  }

  /**
   * Draws `draw` LAST in the glow's MASK pass from the next frame on, until
   * the returned function is called: after every `addGlowMask` and
   * `addGlowMaskBlended` draw, at the pass's close (`recordGlowMask`) — where
   * Babylon's group 1 drew the viewmodel's emissives (`BABYLON_EXIT.md` X4.3c's
   * review). The same pipelines and frame as `addGlowMask`'s.
   */
  addGlowMaskLate(draw: FrameDraw, active?: Active): () => void {
    return hang(this.maskLateDraws, this.maskLateActive, draw, active);
  }

  /**
   * Calls `refused` on every frame the glow's mask pass cannot be recorded —
   * its target not made yet — while something was to draw in it, until the
   * returned function is called. Like `onRefused`'s, it runs INSIDE the
   * render, so it may take draws and prepares off this renderer but must free
   * nothing this frame's commands hold.
   */
  onGlowMaskRefused(refused: () => void): () => void {
    this.maskRefusals.push(refused);
    return () => {
      const i = this.maskRefusals.indexOf(refused);
      if (i >= 0) this.maskRefusals.splice(i, 1);
    };
  }

  /**
   * The glow's MASK pass, recorded now into the host's prepare encoder, after
   * the main pass (`GlowPass.render` asks, from the draw phase's end, its
   * targets sized): the mask cleared to black with alpha 1 and the frame's own
   * depth LOADED, as Babylon's `onClearObservable` cleared it and its
   * `shareDepth` attached that depth (`BABYLON_EXIT.md` X5.4e). Its two
   * announcements are its two ends: the `addGlowMask` and `addGlowMaskBlended`
   * draws FIRST, where the open was told inside the clear, and the
   * `addGlowMaskLate` draws LAST, where the close was told inside the unbind —
   * Babylon draws nothing between them since X5.3c. Drawn only on a frame
   * `begin` filled; a mask not made yet (no frame drawn) is a pass that cannot
   * be recorded, and every `onGlowMaskRefused` listener is told, with one
   * console error per change.
   */
  recordGlowMask(): void {
    const filled = this.maskFilled;
    this.maskFilled = false;
    const t = this.targets;
    if (!t.mask.view || !t.depth.view) {
      if (filled && this.maskDraws.length + this.maskBlendedDraws.length + this.maskLateDraws.length > 0) {
        if (!this.maskRefused) console.error("render: the glow's mask has no target yet — drawing nothing of ours in it");
        this.maskRefused = true;
        const refusals = this.maskRefusals;
        for (let i = 0; i < refusals.length; i++) refusals[i]();
      }
      return;
    }
    this.maskRefused = false;
    this.maskColour.view = t.mask.view;
    this.maskDepth.view = t.depth.view;
    const pass = this.host.prepareEncoder().beginRenderPass(this.maskPass);
    if (filled) {
      if (this.maskDraws.length + this.maskBlendedDraws.length > 0) this.runMask(pass);
      if (this.maskLateDraws.length > 0) this.runMaskLate(pass);
    }
    pass.end();
  }

  /**
   * A pass of the glow's BLUR, recorded now into the host's prepare encoder:
   * `target` LOADED and stored, no depth, as Babylon's `bindFramebuffer` began
   * one with nothing to clear (`render/GlowBlur.ts`, `BABYLON_EXIT.md` X5.2b,
   * X5.4e), `run` its one draw. Asked by `GlowBlur` only once its draw can be
   * made, so a pass whose program is not built is not begun at all, as
   * Babylon began none that drew nothing. Reads no frame of ours, so it is
   * recorded whether or not `begin` filled one.
   */
  glowBlurPass(target: FrameTarget, run: (pass: GPURenderPassEncoder) => void): void {
    if (!target.view) return;
    this.blurColour.view = target.view;
    this.blurPass.label = target.passLabel;
    const pass = this.host.prepareEncoder().beginRenderPass(this.blurPass);
    run(pass);
    pass.end();
  }

  dispose(): void {
    this.hook.dispose();
    this.firstDraws.length = 0;
    this.beforeAlpha.length = 0;
    this.surfaced.length = 0;
    this.opaque.length = 0;
    this.particles.length = 0;
    this.blended.length = 0;
    this.after.length = 0;
    this.prepares.length = 0;
    this.latePrepares.length = 0;
    this.refusals.length = 0;
    this.maskDraws.length = 0;
    this.maskActive.length = 0;
    this.maskBlendedDraws.length = 0;
    this.maskBlendedActive.length = 0;
    this.maskLateDraws.length = 0;
    this.maskLateActive.length = 0;
    this.firstActive.length = 0;
    this.beforeAlphaActive.length = 0;
    this.surfacedActive.length = 0;
    this.opaqueActive.length = 0;
    this.particlesActive.length = 0;
    this.blendedActive.length = 0;
    this.afterActive.length = 0;
    this.maskRefusals.length = 0;
    this.frameBuffer.destroy();
    this.timer?.dispose();
    this.targets.dispose();
    this.textureMaker.dispose();
  }

  private readonly begin = (): void => {
    const timer = this.timer;
    // Last frame's reading, if one was recorded: its submit is past now.
    timer?.settle();
    // Only a draw with something to draw counts (`Active`): a frame with
    // nothing of ours committed skips everything below, and the next frame
    // that has something fills, uploads and refreshes in full.
    this.filled =
      anyActive(this.firstDraws, this.firstActive) ||
      anyActive(this.beforeAlpha, this.beforeAlphaActive) ||
      anyActive(this.surfaced, this.surfacedActive) ||
      anyActive(this.opaque, this.opaqueActive) ||
      anyActive(this.particles, this.particlesActive) ||
      anyActive(this.blended, this.blendedActive) ||
      anyActive(this.after, this.afterActive);
    // The glow's mask is recorded after the main pass, and draws from the
    // frame filled here.
    this.maskFilled =
      anyActive(this.maskDraws, this.maskActive) ||
      anyActive(this.maskBlendedDraws, this.maskBlendedActive) ||
      anyActive(this.maskLateDraws, this.maskLateActive);
    if (!this.filled && !this.maskFilled) return;
    this.fill(this.frame);
    this.host.viewProjection(this.frame.viewProjection);
    this.frameBuffer.write(this.frame);
    this.fillTextures(this.textures);
    this.frameBindings.refresh(this.textures);
    const prepares = this.prepares;
    const late = this.latePrepares;
    if (prepares.length + late.length === 0) return;
    const encoder = this.host.prepareEncoder();
    const timing = timer !== null && timer.open() ? timer : null;
    for (let i = 0; i < prepares.length; i++) prepares[i](this.frame, encoder, timing, this.ctx);
    for (let i = 0; i < late.length; i++) late[i](this.frame, encoder, timing, this.ctx);
    if (timing) timing.close(encoder);
  };

  /**
   * The draw phase's END (`FrameHost.onDrawPhase`): the frame's OPENING pass —
   * its colour cleared to the scene's clear colour, its depth to 1 — and then
   * its MAIN pass, recorded now into the host's prepare encoder after the
   * prepares `begin` recorded there, with every point told in its order: the
   * opening clear and the main pass are what Babylon began on its render
   * encoder for the camera's output target (`Scene._clearFrameBuffer` at
   * `Scene.render`'s first bind, then the camera's render, which cleared the
   * depth again), on every frame the camera drew, whatever was queued
   * (`BABYLON_EXIT.md` X5.4e). The draws are RECORDED in place of queued, where
   * Babylon ran its queue: the moment the next pass of the frame began, which
   * was the glow's mask's, right behind this. A frame `begin` did not fill
   * still clears and opens the main pass, as Babylon's did; a frame whose
   * targets are not made yet (no `ChainPasses.prepareFrame` has sized them)
   * records nothing, and is a refusal if something was to draw.
   */
  private readonly end = (): void => {
    const filled = this.filled;
    this.filled = false;
    const t = this.targets;
    if (!t.frame.view || !t.depth.view) {
      if (filled) this.refuse();
      return;
    }
    this.refused = false;
    this.host.clearColor(this.clearValue);
    const label = t.frameLabel;
    this.clearColour.view = t.frame.view;
    this.clearDepth.view = t.depth.view;
    this.clearPass.label = label;
    this.mainColour.view = t.frame.view;
    this.mainDepth.view = t.depth.view;
    this.mainPass.label = label;
    const encoder = this.host.prepareEncoder();
    encoder.beginRenderPass(this.clearPass).end();
    const pass = encoder.beginRenderPass(this.mainPass);
    if (filled) {
      // The seven points in their order (the header): `"first"`, then
      // `"beforeAlphaTest"` and `"afterSurfaces"`, `"opaque"` and
      // `"particles"`, `"beforeBlended"`, and `"afterGroup"` — each list
      // asked through its own field, so an instrument may wrap one.
      if (this.firstDraws.length > 0) this.runFirst(pass);
      if (this.beforeAlpha.length + this.surfaced.length > 0) this.runBeforeAlpha(pass);
      if (this.opaque.length + this.particles.length > 0) this.runOpaque(pass);
      if (this.blended.length > 0) this.runBlended(pass);
      if (this.after.length > 0) this.runAfter(pass);
    }
    pass.end();
  };

  /** The main pass could not be recorded with something to draw: every `onRefused` listener told, one error per change. */
  private refuse(): void {
    if (!this.refused) console.error("render: the frame has no target yet — drawing nothing of ours");
    this.refused = true;
    const refusals = this.refusals;
    for (let i = 0; i < refusals.length; i++) refusals[i]();
  }

  private readonly runFirst = (pass: GPURenderPassEncoder): void => {
    const draws = this.firstDraws;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
  };

  /** `"beforeAlphaTest"`'s list and then `"afterSurfaces"`'s: one slot of the host's. */
  private readonly runBeforeAlpha = (pass: GPURenderPassEncoder): void => {
    const draws = this.beforeAlpha;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
    const last = this.surfaced;
    for (let i = 0; i < last.length; i++) last[i](pass, this.ctx);
  };

  /** `"opaque"`'s list and then `"particles"`': one slot of the host's. */
  private readonly runOpaque = (pass: GPURenderPassEncoder): void => {
    const draws = this.opaque;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
    const last = this.particles;
    for (let i = 0; i < last.length; i++) last[i](pass, this.ctx);
  };

  private readonly runBlended = (pass: GPURenderPassEncoder): void => {
    const draws = this.blended;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
  };

  private readonly runAfter = (pass: GPURenderPassEncoder): void => {
    const draws = this.after;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
  };

  /** `addGlowMask`'s list and then `addGlowMaskBlended`'s: one place in the pass. */
  private readonly runMask = (pass: GPURenderPassEncoder): void => {
    const draws = this.maskDraws;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
    const last = this.maskBlendedDraws;
    for (let i = 0; i < last.length; i++) last[i](pass, this.ctx);
  };

  private readonly runMaskLate = (pass: GPURenderPassEncoder): void => {
    const draws = this.maskLateDraws;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
  };
}

/** `draw` (and its predicate) onto a list, and the function that takes both back off. */
function hang(list: FrameDraw[], actives: (Active | null)[], draw: FrameDraw, active?: Active): () => void {
  list.push(draw);
  actives.push(active ?? null);
  return () => {
    const i = list.indexOf(draw);
    if (i >= 0) {
      list.splice(i, 1);
      actives.splice(i, 1);
    }
  };
}
