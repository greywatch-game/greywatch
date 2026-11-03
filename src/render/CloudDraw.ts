/**
 * render/CloudDraw.ts — The sky's cloud ring as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.5b): one draw of one soup, into the frame's main pass,
 * what the `sky-clouds` mesh on `CloudShader.ts`'s material drew through Babylon
 * until X4.5b.
 * Owns: `CloudDraw` — the pipeline (`ready`) and the ring's block, for the
 * session; the standing ring's arrays on the GPU and its geometry group, from
 * `setRing` to `clearRing`; the index buffer's partial rewrite (`writeIndices`);
 * the draw and the prepare that uploads a frame's block; whoever is told of a
 * failure (`onFailed`), and what it drew last (`stats`); `CloudArrays`.
 * Invariants: it DECIDES NOTHING: where the ring stands, its turn, its order and
 * every value it is lit with are `Sky`'s (`systems/Sky.ts`), held in the recipe
 * it was handed and read every frame it draws; it draws at `"afterSurfaces"`, so
 * after every opaque surface of Babylon's and ours and ahead of group 0's
 * alpha-tested list, the turf, as Babylon's alpha-test list drew the mesh ahead
 * of the turf (by material id, `RenderingGroup.PainterSortCompare`: the sky is
 * applied before the map's grass is built); front faces only, LEQUAL, depth
 * written; the draw is hung for the SESSION as the weapon's is, so it draws in
 * every state while a ring stands, the menu included (`BABYLON_EXIT.md` X4.5c
 * owes that an `Active` of a map standing); a frame with its pipeline unbuilt
 * draws no cloud, as a Babylon material not ready drew none, and so does one with
 * a frame texture unpublished, a dependency that material did not have (it read
 * none) and harmless, every frame texture being published from construction; a
 * pipeline that fails and a refused main pass are told to `onFailed`'s listener
 * only while a ring stands, a map stating none having no draw to refuse it for,
 * the refusal once per change rather than every refused frame, and neither
 * inside the render's commands; nothing here allocates on a frame,
 * `writeIndices` included.
 * Never: imports Babylon; reads a node or a material; sorts anything.
 * Contract: `docs/rendering.md`, "The sky".
 */
import { CLOUD_BLOCK, CLOUD_GEOMETRY, cloudProgram, type CloudRecipe } from "./cloudProgram";
import { HostBindGroup } from "./HostBindGroup";
import type { BuiltPipeline } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";

/** The ring's soup, as `cloudMasses.ts` built it: three floats a corner, every triangle its own three. */
export interface CloudArrays {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly smoothNormals: Float32Array;
}

/** The block's variant: its fields are unguarded. */
const BLOCK_DEFINES: readonly string[] = [];

const PIPELINE_FAILED = "our clouds cannot draw: their pipeline failed";

export class CloudDraw {
  /** Whether the pipeline built — asked once, for the session; false if it failed. */
  readonly ready: Promise<boolean>;
  /** What the last frame drew: main-pass draws. Nothing in the game reads it; the census does. */
  readonly stats = { drawn: 0 };

  private readonly device: GPUDevice;
  private readonly block: UniformBlockBuffer;
  private readonly material: HostBindGroup;
  private pipeline: BuiltPipeline | null = null;
  /** The standing ring's four buffers; empty with no ring. */
  private readonly owned: GPUBuffer[] = [];
  private indexBuffer: GPUBuffer | null = null;
  private geometry: HostBindGroup | null = null;
  private recipe: CloudRecipe | null = null;
  private count = 0;
  /** This frame's verdict: a ring stands, the pipeline built, the block uploaded. */
  private ours = false;

  private failed: (reason: string) => void;
  private failedPipeline = false;
  /** A refusal already told: once per change and listener, not every refused frame (`Renderer.onRefused`). */
  private refusalTold = false;

  constructor(
    private readonly renderer: Renderer,
    failed: (reason: string) => void,
  ) {
    const device = renderer.device;
    this.device = device;
    this.failed = failed;
    this.block = new UniformBlockBuffer(device, CLOUD_BLOCK, BLOCK_DEFINES, "clouds: material");
    this.material = new HostBindGroup(device, "clouds: material", [CLOUD_BLOCK], BLOCK_DEFINES, {
      [CLOUD_BLOCK.var]: this.block.buffer,
    });
    this.material.refresh(renderer.host, {});

    const program = cloudProgram();
    this.ready = renderer.pipelines
      .get({
        vertex: program.vertex,
        vertexEntry: "main",
        fragment: program.fragment,
        fragmentEntry: "main",
        targets: FRAME_TARGETS,
      })
      .then(
        (built) => {
          this.pipeline = built;
          return true;
        },
        (err: unknown) => {
          console.error("clouds: the pipeline did not build; no cloud of ours can be drawn", err);
          this.failedPipeline = true;
          if (this.recipe) this.failed(PIPELINE_FAILED);
          return false;
        },
      );
    // For the session (the header). Counted only on a frame a ring stands.
    renderer.onFrame(this.prepare);
    renderer.add(this.draw, "afterSurfaces", () => this.recipe !== null);
    renderer.onRefused(this.refused);
  }

  /**
   * Whom a failure is told: the round, while one stands, the console otherwise
   * (`Game.installMap`, `Game.teardownMap`) — told at once if the pipeline has
   * failed already and a ring stands. A failure with none standing is held here
   * and told by nothing else, so **the ring must stand BEFORE this hand-over**,
   * as it does (`Game.startRound`: `applySky`, then `installMap`): that is how a
   * ring that comes after the failure still refuses its round. `setRing` does
   * not tell, because the listener it would reach is the map's being replaced.
   * A new listener has been told of no refusal yet.
   */
  onFailed(failed: (reason: string) => void): void {
    this.failed = failed;
    this.refusalTold = false;
    if (this.failedPipeline && this.recipe) failed(PIPELINE_FAILED);
  }

  /**
   * Stands a ring: its soup on the GPU, `indices` the order to draw it in as it
   * now is, and `recipe` what it is drawn with — read in place every frame, so
   * its owner writes into it and need tell nobody. Replaces any ring standing.
   */
  setRing(arrays: CloudArrays, indices: Uint32Array, recipe: CloudRecipe): void {
    this.clearRing();
    const device = this.device;
    const upload = (label: string, data: ArrayBufferView, dst: boolean): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `clouds: ${label}`,
        size: Math.max(16, data.byteLength),
        usage: dst ? GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST : GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
      });
      new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      buffer.unmap();
      this.owned.push(buffer);
      return buffer;
    };
    this.indexBuffer = upload("indices", indices, true);
    this.geometry = new HostBindGroup(device, "clouds: geometry", CLOUD_GEOMETRY, [], {
      positionData: upload("positions", arrays.positions, false),
      normalData: upload("facet normals", arrays.normals, false),
      smoothNormalData: upload("smooth normals", arrays.smoothNormals, false),
      indexData: this.indexBuffer,
    });
    // No textures: resolved once, whole for good.
    this.geometry.refresh(this.renderer.host, {});
    this.count = indices.length;
    this.recipe = recipe;
  }

  /** No ring stands: nothing is drawn or counted until the next `setRing`. */
  clearRing(): void {
    for (const buffer of this.owned) buffer.destroy();
    this.owned.length = 0;
    this.indexBuffer = null;
    this.geometry = null;
    this.recipe = null;
    this.count = 0;
    this.ours = false;
    this.stats.drawn = 0;
  }

  /** `count` indices of `indices` from `first` on, written to the GPU at the same place. Allocates nothing. */
  writeIndices(indices: Uint32Array<ArrayBuffer>, first: number, count: number): void {
    if (this.indexBuffer) this.device.queue.writeBuffer(this.indexBuffer, first * 4, indices, first, count);
  }

  /** As the main pass begins: the frame's block, off the recipe its owner wrote. */
  private readonly prepare = (): void => {
    this.stats.drawn = 0;
    const recipe = this.recipe;
    this.ours = recipe !== null && this.pipeline !== null;
    if (recipe && this.ours) this.block.write(recipe.values);
  };

  /** The ring: one draw, whose vertex stage reads the order out of `indexData`. */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    // Reached only through a pass that is not refused.
    this.refusalTold = false;
    if (!this.ours) return;
    const built = this.pipeline!;
    const frame = ctx.frameGroup(built.groups[0]);
    const material = this.material.get(built.groups[1]);
    const geometry = this.geometry!.get(built.groups[2]);
    if (!frame || !material || !geometry) return;
    pass.setPipeline(built.pipeline);
    pass.setBindGroup(0, frame);
    pass.setBindGroup(1, material);
    pass.setBindGroup(2, geometry);
    pass.draw(this.count);
    this.stats.drawn = 1;
  };

  /** `Renderer.onRefused`: the main pass drew nothing of ours, the ring included. */
  private readonly refused = (): void => {
    if (!this.ours || this.refusalTold) return;
    this.refusalTold = true;
    this.failed("the main pass was refused, so the clouds cannot be drawn");
  };
}
