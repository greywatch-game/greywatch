/**
 * render/ProbeBake.ts — The reflection bake as OUR renderer draws it
 * (`BABYLON_EXIT.md` X3.6c): each probe's cube, its six faces drawn from the
 * world our main pass takes — through a second VIEW of the main pass's culls,
 * with the probe's eye PASSED in a frame of the bake's own — and its mip
 * chain after them; Babylon's glazing and water sample a wrapped view of it.
 * The only bake there is since X3.7c (Babylon's `ReflectionProbe`s are gone).
 * Owns: `ProbeBake` — the cube pool (`cube`: `rgba8unorm`, six layers, a
 * full mip chain, never destroyed but by `dispose`, the pool outliving
 * every map; each handed out as a `ProbeCube`, which whoever asked for it
 * indexes — `ReflectionSystem` does — and which a `ProbeJob` carries), the
 * face passes made with each cube and the one `depth32float`
 * attachment they share, the bake's FRAME (its `FrameUniformBuffer`, the
 * staging slots each face's camera reaches it through, and its group-0 bind
 * group over the frame's textures), each face's cull inputs, the mip
 * generator (`CubeMips`), the probes released and not yet recorded, and the
 * world's probe VIEW (`ProbeWorld`, `WorldBlocks.probeView`) from the bake
 * being opened (`open`) to its draining (`close`); it HOLDS the world it
 * draws (`ProbeSource`, the map's `WorldBlocks` in a round), which the
 * handover owns, and the failure handed over with it; `ProbeCube`,
 * `ProbeJob`, `ProbeExclusion`, `ProbeSource` and `ProbeWorld`.
 * Invariants: it DECIDES NOTHING — which probes there are, where each
 * stands, what it leaves out, how far it reaches, when it is released and
 * whether a map bakes at all are `ReflectionSystem`'s; a released probe
 * is recorded on the next frame our renderer prepares that can draw every
 * group the bake draws (`ProbeWorld.drawable`), at most `perFrame` a frame,
 * oldest first, into the encoder the host submits ahead of every Babylon
 * pass, LATE (`Renderer.onFrame`'s `late`) so it samples the world's shadow
 * maps and the lamps' atlas as that frame draws them; a face is Babylon's
 * face — `ReflectionProbe`'s look along +X, -X, -Y, +Y, +Z, -Z from the
 * probe with Babylon's up, a 90-degree square perspective over the camera's
 * near and far planes in WebGPU's half-z range (`src/math`'s copies of
 * Babylon's two helpers), drawn upside down as every render target is, into
 * layer `f`, cleared to transparent black and depth 1 — culled at a slot of
 * its own (`PASS_PROBE`, the reach to a surface's sphere, the probe's blocks
 * left out), so its draws read its own survivors, and its frame is the
 * factory's bake frame (`fill`, ONCE a recorded frame: the frame's values,
 * an opaque alpha of 1 and the clouds' shadow held off) with the face's
 * view-projection and its probe's eye, each face's camera reaching the one
 * buffer through a staging slot copied in the encoder ahead of its pass,
 * never a second `writeBuffer` to it; a probe's mips follow its sixth face;
 * a cube can be COPIED from (`COPY_SRC`), so a readback needs no help
 * (`VERIFYING.md`); a world it cannot draw — the mips' pipeline failed
 * (asked once, for the session, so every world handed over after it fails
 * on it too), or the view of the culls could not be made or did not build —
 * is never drawn, and the failure handed over with the world is told
 * (`setWorld`: the world's, `BlockHandover`, which has nothing to fall back
 * on), the view and the world kept until the handover takes them back; the
 * view is built when a bake is opened and destroyed when it drains, so a
 * round holds none; a cube is born zeroed by WebGPU — alpha 0, the sky a
 * pane shows before any probe has claimed it — and is never cleared but by
 * its own faces (the DEFAULT cube, `ReflectionSystem`'s, by none); nothing
 * here allocates on a frame but the passes WebGPU makes.
 * Never: imports Babylon; reads a node; decides a probe, a reach or an
 * exclusion; submits.
 * Contract: `docs/rendering.md`, "The glazing and the reflection bake" and
 * "Our renderer's frame".
 */
import { Matrix, Vector3 } from "../math";
import { createCullInputs, type CullInputs, rampReach, rigReach } from "./ClusterCull";
import { CubeMips } from "./cubeMips";
import { createFrameUniforms, FRAME_BLOCK, FRAME_TEXTURES, type FrameUniforms } from "./frame";
import { FrameUniformBuffer } from "./FrameUniformBuffer";
import { HostBindGroup } from "./HostBindGroup";
import type { PassTiming } from "./PassTimer";
import type { Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { PASS_PROBE, PROBE_EXCLUDE, PROBE_SPHERE_REACH } from "./wgsl/clusterCull";
import { blockLayout } from "./wgsl/layout";

/** Which blocks a probe leaves out of its own bake: those it serves (`ReflectionSystem`'s `exclusionOf`). */
export interface ProbeExclusion {
  /** Its cell, as `blockKey` packs a block's coordinates. */
  readonly cell: number;
  /** The cell's side, in blocks (`ReflectionSystem`'s `perCell`). */
  readonly perCell: number;
  /** Which of the cell's blocks it serves, a bit each, row by row. */
  readonly served: number;
}

/** A cube of the pool, as `cube` hands it out: its texture, and the six passes its faces are drawn with. */
export interface ProbeCube {
  /** What a reader is handed a wrapped view of. */
  readonly texture: GPUTexture;
  readonly faces: readonly GPURenderPassDescriptor[];
}

/** One probe as `ReflectionSystem` releases it: plain numbers and the cube it is baked into. */
export interface ProbeJob {
  /** One of this bake's cubes (`cube`). */
  readonly cube: ProbeCube;
  /** Where it stands. */
  readonly eye: Vector3;
  /** The camera's near and far planes, which Babylon's probe projected its faces with. */
  near: number;
  far: number;
  /** How far it reaches, metres, to the near side of a surface's sphere. */
  reach: number;
  /** The blocks it leaves out, or none (a water probe). */
  exclude: ProbeExclusion | null;
}

/**
 * The world a probe's faces are drawn from, as the map's `WorldBlocks`
 * offers it: a view of its culls made for `slots` faces a submit.
 */
export interface ProbeSource {
  probeView(slots: number): ProbeWorld | null;
}

/** A second view of the main pass's culls, as a probe's faces draw through it (`WorldBlocks.probeView`). */
export interface ProbeWorld {
  /** Resolves true once the view's culls and its own pipelines are built; false if one failed. */
  readonly ready: Promise<boolean>;
  /** Whether every group a face draws can draw NOW — its pipeline built, its textures published. */
  drawable(group0: (layout: GPUBindGroupLayout) => GPUBindGroup | null): boolean;
  /** The culls for `inputs` at `slot`, recorded ahead of the face that draws what survives. */
  cull(inputs: CullInputs, encoder: GPUCommandEncoder, slot: number): void;
  /** Every group the bake draws into `pass`, off the survivors of the `cull` recorded last before it. */
  draw(pass: GPURenderPassEncoder, group0: (layout: GPUBindGroupLayout) => GPUBindGroup | null): void;
  /** Its buffers destroyed. */
  dispose(): void;
}

/** The face looks Babylon's `ReflectionProbe` baked with and its cube readers expect, in layer order (`_invertYAxis` false, a left-handed scene). */
const FACE_LOOKS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** A staging slot's stride: a uniform copy's source offset needs no alignment, this keeps a face a slot. */
const SLOT_BYTES = 256;

/** A `setWorld` with nobody to tell: handing none over, or tearing down. */
function ignore(): void {}

/** Transparent black: alpha 0 is where the readers put sky. */
const CLEAR: GPUColor = { r: 0, g: 0, b: 0, a: 0 };

export class ProbeBake {
  private readonly device: GPUDevice;
  private readonly mipCount: number;
  /** Every cube made, for `dispose` alone: whoever asked for one indexes it. */
  private readonly cubes: ProbeCube[] = [];
  private readonly depth: GPUTexture;
  private readonly depthView: GPUTextureView;
  private readonly mips: CubeMips;
  private mipsBuilt = false;

  /** The bake's frame: its values, its buffer and its group 0. */
  private readonly frame: FrameUniforms = createFrameUniforms();
  private readonly frameBuffer: FrameUniformBuffer;
  private readonly frameBindings: HostBindGroup;
  private readonly group0 = (layout: GPUBindGroupLayout): GPUBindGroup | null => this.frameBindings.get(layout);
  /** Each face's camera — its view-projection, the eye and the opaque alpha — a staging slot apiece. */
  private readonly staging: GPUBuffer;
  private readonly slotValues: Float32Array<ArrayBuffer>;
  /** The bytes of the frame block a face's camera is: `viewProjection`, `camPos`, `opaqueAlpha`. */
  private readonly cameraBytes: number;
  private readonly faceCulls: CullInputs[] = [];

  /** The world the faces are drawn from — the map's in a round; null with none. */
  private source: ProbeSource | null = null;
  /** Told why, if `source` cannot be drawn: handed over with it (`setWorld`). */
  private failed: (reason: string) => void = ignore;
  /** Its view, from `open` until the bake drains, and whether it is built. */
  private view: ProbeWorld | null = null;
  private viewBuilt = false;
  /** Bumped whenever the view or the source changes: a build that settles for one already gone does nothing. */
  private generation = 0;
  /** Released, not yet recorded, oldest first. */
  private readonly released: ProbeJob[] = [];
  private readonly unhook: () => void;

  /** Scratch for a face's camera. */
  private readonly target = new Vector3();
  private readonly look = new Matrix();
  private readonly projection = new Matrix();
  private readonly viewProjection = new Matrix();

  constructor(
    private readonly renderer: Renderer,
    /** The factory's bake frame (`CelMaterialFactory.fillBakeFrame`): the frame's values, seen from `eye`. */
    private readonly fill: (out: FrameUniforms, eye: Vector3) => void,
    /** A face's side, texels (`CONFIG.graphics.reflection.size`). */
    private readonly size: number,
    /**
     * The most probes one frame records (`CONFIG.graphics.reflection
     * .probesPerFrame`) — the one statement of the budget, which
     * `ReflectionSystem` releases against.
     */
    readonly perFrame: number,
  ) {
    const device = renderer.device;
    this.device = device;
    this.mipCount = Math.floor(Math.log2(size)) + 1;
    this.depth = device.createTexture({
      label: "probe bake: depth",
      size: [size, size],
      format: FRAME_TARGETS.depthFormat!,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depth.createView();
    this.mips = new CubeMips(device, renderer.pipelines, FRAME_TARGETS.colorFormats[0]);
    void this.mips.ready.then((ok) => {
      this.mipsBuilt = ok;
    });

    this.frameBuffer = new FrameUniformBuffer(device, "probe bake");
    this.frameBindings = new HostBindGroup(
      device,
      "probe bake frame",
      [FRAME_BLOCK, ...FRAME_TEXTURES],
      ["CEL_PALETTE"],
      { [FRAME_BLOCK.var]: this.frameBuffer.buffer },
    );
    // A face's camera is the block's first three members, contiguous: one
    // copy a face.
    const layout = blockLayout(FRAME_BLOCK, ["CEL_PALETTE"]).fields;
    const at = (name: string): number => layout.find((f) => f.name === name)!.offset;
    if (at("viewProjection") !== 0 || at("camPos") !== 64 || at("opaqueAlpha") !== 76) {
      throw new Error("probe bake: the frame block no longer opens with the camera (viewProjection, camPos, opaqueAlpha)");
    }
    this.cameraBytes = 80;
    const slots = Math.max(1, perFrame) * FACE_LOOKS.length;
    this.staging = device.createBuffer({
      label: "probe bake: face cameras",
      size: slots * SLOT_BYTES,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.slotValues = new Float32Array((slots * SLOT_BYTES) / 4);
    for (let i = 0; i < slots; i++) {
      const inputs = createCullInputs();
      inputs.mask = PASS_PROBE;
      this.faceCulls.push(inputs);
    }
    this.unhook = renderer.onFrame(this.prepare, true);
  }

  /** The faces one submit may draw: a slot each in the view's culls. */
  get slots(): number {
    return this.faceCulls.length;
  }

  /** Whether a world is held: the map has a bake to draw. */
  get holds(): boolean {
    return this.source !== null;
  }

  /**
   * Whether a released probe can be recorded: the view built, and the mips'
   * pipeline. `ReflectionSystem` releases none before — and the frame that
   * records one still waits for every group to be drawable.
   */
  get ready(): boolean {
    return this.view !== null && this.viewBuilt && this.mipsBuilt;
  }

  /** Probes released and not yet recorded. */
  get unrecorded(): number {
    return this.released.length;
  }

  /**
   * A new cube of the pool, kept for the process: what a probe is baked into
   * and a reader is handed a wrapped view of. Whoever asks indexes it.
   */
  cube(label: string): ProbeCube {
    const texture = this.device.createTexture({
      label: `probe bake: ${label}`,
      size: [this.size, this.size, FACE_LOOKS.length],
      mipLevelCount: this.mipCount,
      format: FRAME_TARGETS.colorFormats[0],
      // COPY_SRC so a readback reads it as it lies (`VERIFYING.md`).
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const faces = FACE_LOOKS.map((_, f) => ({
      label: `probe bake: ${label} face ${f}`,
      colorAttachments: [
        {
          view: texture.createView({ dimension: "2d", baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: f, arrayLayerCount: 1 }),
          loadOp: "clear" as const,
          storeOp: "store" as const,
          clearValue: CLEAR,
        },
      ],
      depthStencilAttachment: {
        view: this.depthView,
        depthLoadOp: "clear" as const,
        depthStoreOp: "discard" as const,
        depthClearValue: 1,
      },
    }));
    const cube: ProbeCube = { texture, faces };
    this.cubes.push(cube);
    return cube;
  }

  /**
   * The world the faces are drawn from from now on — the map's — or null:
   * then nothing is released and the view goes. `failed` is told why if it
   * cannot be drawn (`open`, and the mips' pipeline — failed for the
   * session, every world handed over after it fails too) — unless another
   * world has been handed over since.
   */
  setWorld(source: ProbeSource | null, failed: (reason: string) => void = ignore): void {
    this.dropView();
    this.released.length = 0;
    this.source = source;
    this.failed = source ? failed : ignore;
    if (!source) return;
    void this.mips.ready.then((ok) => {
      if (!ok && this.source === source && this.failed === failed) {
        failed("our reflection bake cannot finish a cube: its mips' pipeline failed");
      }
    });
  }

  /** A bake is queued: the view of the world's culls is built for it, if it is not standing. */
  open(): void {
    if (this.view || !this.source) return;
    const view = this.source.probeView(this.slots);
    if (!view) {
      this.failed("our reflection bake could not make its view of the world's culls");
      return;
    }
    this.view = view;
    this.viewBuilt = false;
    const generation = ++this.generation;
    void view.ready.then((ok) => {
      if (generation !== this.generation) return;
      if (!ok) {
        this.failed("our reflection bake's view of the world's culls did not build");
        return;
      }
      this.viewBuilt = true;
    });
  }

  /** `job` is recorded on the next frame that can draw it. */
  release(job: ProbeJob): void {
    this.released.push(job);
  }

  /**
   * The bake has drained — nothing queued, nothing released unrecorded: the
   * view goes. Never inside a frame that recorded with it before that
   * frame's submit (`ReflectionSystem` asks before the frame records).
   */
  close(): void {
    this.dropView();
  }

  dispose(): void {
    this.unhook();
    this.setWorld(null);
    for (const cube of this.cubes) {
      this.mips.forget(cube.texture);
      cube.texture.destroy();
    }
    this.cubes.length = 0;
    this.depth.destroy();
    this.frameBuffer.destroy();
    this.staging.destroy();
  }

  private dropView(): void {
    this.generation++;
    this.view?.dispose();
    this.view = null;
    this.viewBuilt = false;
  }

  /** Face `f` of a probe standing at `eye`: Babylon's view and projection, multiplied as the scene does, into `out`. */
  private faceCamera(job: ProbeJob, f: number, out: Float32Array): void {
    const look = FACE_LOOKS[f];
    const eye = job.eye;
    this.target.copyFromFloats(eye.x + look[0], eye.y + look[1], eye.z + look[2]);
    Matrix.LookAtLHToRef(eye, this.target, Vector3.UpReadOnly, this.look);
    Matrix.PerspectiveFovLHToRef(Math.PI / 2, 1, job.near, job.far, this.projection, true, true);
    this.look.multiplyToRef(this.projection, this.viewProjection);
    out.set(this.viewProjection.m);
  }

  /** As the main pass begins, after every other prepare: this frame's share of the released probes. */
  private readonly prepare = (_frame: FrameUniforms, encoder: GPUCommandEncoder, _timing: PassTiming | null): void => {
    const released = this.released;
    const view = this.view;
    if (released.length === 0 || !view || !this.ready) return;
    const frame = this.frame;
    this.frameBindings.refresh(this.renderer.host, this.renderer.textures);
    if (!view.drawable(this.group0)) return;
    const probes = Math.min(released.length, this.perFrame);
    // The frame every face shares, once; each face's camera — its
    // view-projection and its probe's eye — over it below.
    this.fill(frame, released[0].eye);
    this.frameBuffer.write(frame);
    const values = this.slotValues;
    const alpha = frame.opaqueAlpha[0];
    const ramp = rampReach(frame);
    const rig = rigReach(frame);
    let slot = 0;
    for (let p = 0; p < probes; p++) {
      const job = released[p];
      const eye = job.eye;
      for (let f = 0; f < FACE_LOOKS.length; f++, slot++) {
        const inputs = this.faceCulls[slot];
        this.faceCamera(job, f, inputs.viewProjection);
        const o = (slot * SLOT_BYTES) / 4;
        values.set(inputs.viewProjection, o);
        values[o + 16] = eye.x;
        values[o + 17] = eye.y;
        values[o + 18] = eye.z;
        values[o + 19] = alpha;
        inputs.eye[0] = eye.x;
        inputs.eye[1] = eye.y;
        inputs.eye[2] = eye.z;
        inputs.reach2 = job.reach * job.reach;
        inputs.rampReach = ramp;
        inputs.rigReach = rig;
        const ex = job.exclude;
        inputs.probe = PROBE_SPHERE_REACH | (ex ? PROBE_EXCLUDE | (ex.perCell << 8) : 0);
        inputs.probeCell = ex ? ex.cell : 0;
        inputs.probeServed = ex ? ex.served : 0;
      }
    }
    this.device.queue.writeBuffer(this.staging, 0, values, 0, (slot * SLOT_BYTES) / 4);
    slot = 0;
    for (let p = 0; p < probes; p++) {
      const cube = released[p].cube;
      for (let f = 0; f < FACE_LOOKS.length; f++, slot++) {
        encoder.copyBufferToBuffer(this.staging, slot * SLOT_BYTES, this.frameBuffer.buffer, 0, this.cameraBytes);
        view.cull(this.faceCulls[slot], encoder, slot);
        const pass = encoder.beginRenderPass(cube.faces[f]);
        view.draw(pass, this.group0);
        pass.end();
      }
      this.mips.record(cube.texture, encoder);
    }
    released.copyWithin(0, probes);
    released.length -= probes;
  };
}
