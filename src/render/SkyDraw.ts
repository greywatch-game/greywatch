/**
 * render/SkyDraw.ts — The sky's dome and moon as OUR renderer draws them
 * (`BABYLON_EXIT.md` X4.5c): one draw of the dome, one of the disc and one of the
 * disc's bloom, what the `sky-dome` and `sky-moon` meshes on `StandardMaterial`
 * drew through Babylon until X4.5c.
 * Owns: `SkyDraw` — the three pipelines (`ready`), for the session; each standing
 * piece's arrays on the GPU, its block and its bind groups, from `setSky` to
 * `clearSky`; the prepare that stands the pieces and uploads a frame's blocks;
 * whoever is told of a failure (`onFailed`), and what it drew last (`stats`);
 * `SkyPiece`.
 * Invariants: it DECIDES NOTHING: where a piece stands, every value it is drawn
 * with and the painted textures are `Sky`'s (`systems/Sky.ts`), held in the recipes
 * it was handed and read every frame it draws, and whether the moon may bloom is
 * `Game`'s (`admits`, `GlowRules`' answer); **the dome draws at `"first"`, ahead of
 * everything else in the frame, because it writes no depth and stands at 600 m:
 * drawn after anything farther it would paint over it**; **the moon draws at
 * `"beforeBlended"`, after the group's particles and ahead of its transparent
 * list**, where it was the first of that list by distance, so it paints over ash
 * and rotor wash and everything blended that writes no depth draws over it; both
 * test LEQUAL and write no depth, the dome opaque, the moon blended
 * (`SKY_BLEND`); all three draw only while a map stands (`setStanding`,
 * `BABYLON_EXIT.md` X4.5c), so over the menu they count for nothing and the frame
 * does no work of ours for them; the moon's bloom draws in the glow's mask behind
 * every other draw of ours that opens it and ahead of every mesh of Babylon's
 * (`Renderer.addGlowMaskBlended`), where it was the first of Babylon's blended
 * mask list; it stands at 9 km, behind the depth a cloud writes, so a cloud or any
 * surface rejects it and its bloom alike; a piece's world, and whether the disc is
 * in view (a disc out of it is no draw in either pass, as Babylon culled it), are
 * asked of `Sky` as the main pass begins (`stand`), off the camera as this frame
 * draws it, never in `Sky.update` (a frozen frame holds that one still and moves
 * the camera); a frame
 * with its pipelines unbuilt or a texture not published draws no sky, as a Babylon
 * material not ready drew none; a pipeline that fails and a refused pass are told
 * to `onFailed`'s listener only while a sky stands, the refusal once per change
 * rather than every refused frame, and neither inside the render's commands;
 * nothing here allocates on a frame.
 * Never: imports Babylon; reads a node, a camera or a material; samples anything
 * but the texture it was handed; draws in a bake (a probe's face leaves the sky's
 * pixels at alpha 0, where its readers put the sky: `render/ProbeBake.ts`).
 * Contract: `docs/rendering.md`, "The sky".
 */
import { HostBindGroup, type TextureHandles } from "./HostBindGroup";
import type { BuiltPipeline, PipelineState } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import type { PassTargets } from "./frameHost";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import {
  SKY_BLEND,
  SKY_BLOCK,
  SKY_GEOMETRY,
  SKY_TEXTURE,
  skyPrograms,
  type SkyRecipe,
} from "./skyProgram";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import type { AssembledModule } from "./wgsl/assemble";

/** A piece as `Sky` hands it over: its geometry, packed tight, and what it is drawn with. */
export interface SkyPiece {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly recipe: SkyRecipe;
}

/** A piece on the GPU. */
interface Standing {
  readonly recipe: SkyRecipe;
  readonly block: UniformBlockBuffer;
  readonly material: HostBindGroup;
  /** What `material` is refreshed with every frame, built once so that a frame allocates nothing. */
  readonly textures: TextureHandles;
  readonly geometry: HostBindGroup;
  readonly buffers: readonly GPUBuffer[];
  readonly count: number;
}

/** The block's variant: its fields are unguarded. */
const NO_DEFINES: readonly string[] = [];

/** Whether anything is painted by `glow`, as `GlowPass.buildList` asked of a material's emissive colour. */
function blooms(glow: Float32Array): boolean {
  return glow[0] > 0 || glow[1] > 0 || glow[2] > 0;
}

const PIPELINE_FAILED = "our sky cannot draw: a pipeline of its failed";

export class SkyDraw {
  /** Whether every pipeline built — asked once, for the session; false if one failed. */
  readonly ready: Promise<boolean>;
  /** What the last frame drew: main-pass draws, and mask draws. No outcome reads it; a profiler capture does (`Game`'s `prof.setPools`), and the census. */
  readonly stats = { drawn: 0, masked: 0 };

  private readonly device: GPUDevice;
  private domePipeline: BuiltPipeline | null = null;
  private moonPipeline: BuiltPipeline | null = null;
  private maskPipeline: BuiltPipeline | null = null;
  private dome: Standing | null = null;
  private moon: Standing | null = null;
  /** Asked as the main pass begins: stands the pieces for the frame, and says whether the disc is in view. */
  private stand: (() => boolean) | null = null;
  /** Whether a map stands: with none the sky is undrawn, its pieces kept for the next round's sake. */
  private standing = false;
  /** This frame's verdicts: the piece and a map stand, its pipeline built, its block uploaded. */
  private domeOurs = false;
  private moonOurs = false;
  private maskOurs = false;

  private failed: (reason: string) => void;
  private failedPipeline = false;
  /** A refusal already told, in each pass: once per change and listener, not every refused frame. */
  private refusalTold = false;
  private maskRefusalTold = false;

  constructor(
    private readonly renderer: Renderer,
    /** `GlowRules.admits`, asked of the moon once a frame. */
    private readonly admits: () => boolean,
    failed: (reason: string) => void,
  ) {
    const device = renderer.device;
    this.device = device;
    this.failed = failed;

    const programs = skyPrograms();
    const ask = (
      fragment: AssembledModule,
      targets: PassTargets,
      state: PipelineState,
      keep: (built: BuiltPipeline) => void,
    ): Promise<boolean> =>
      renderer.pipelines
        .get({ vertex: programs.vertex, vertexEntry: "main", fragment, fragmentEntry: "main", targets, state })
        .then(
          (built) => {
            keep(built);
            return true;
          },
          (err: unknown) => {
            console.error("sky: a pipeline did not build; the sky cannot be drawn", err);
            return false;
          },
        );
    this.ready = Promise.all([
      ask(programs.dome, FRAME_TARGETS, { depthWrite: false }, (b) => (this.domePipeline = b)),
      ask(programs.moon, FRAME_TARGETS, { depthWrite: false, blend: SKY_BLEND }, (b) => (this.moonPipeline = b)),
      ask(programs.moonGlow, GLOW_TARGETS, { depthWrite: false, blend: SKY_BLEND }, (b) => (this.maskPipeline = b)),
    ]).then((oks) => oks.every(Boolean));
    void this.ready.then((ok) => {
      if (ok) return;
      this.failedPipeline = true;
      if (this.dome) this.failed(PIPELINE_FAILED);
    });

    // For the session, as the clouds' draw is. Counted only on a frame a sky and a map stand.
    renderer.onFrame(this.prepare);
    renderer.add(this.drawDome, "first", () => this.standing && this.dome !== null);
    renderer.add(this.drawMoon, "beforeBlended", () => this.standing && this.moon !== null);
    renderer.addGlowMaskBlended(
      this.drawMask,
      () => this.standing && this.moon !== null && blooms(this.moon.recipe.values.skyGlow) && this.admits(),
    );
    renderer.onRefused(this.refused);
    renderer.onGlowMaskRefused(this.maskRefused);
  }

  /**
   * Whom a failure is told: the round, while one stands, the console otherwise
   * (`Game.installMap`, `Game.teardownMap`), told at once if a pipeline has failed
   * already and a sky stands; as `CloudDraw.onFailed`, so **the sky must stand
   * BEFORE this hand-over**, as it does (`Game.startRound`: `applySky`, then
   * `installMap`). A new listener has been told of no refusal yet.
   */
  onFailed(failed: (reason: string) => void): void {
    this.failed = failed;
    this.refusalTold = false;
    this.maskRefusalTold = false;
    if (this.failedPipeline && this.dome) failed(PIPELINE_FAILED);
  }

  /**
   * Stands a sky: the dome, the moon if the map draws a disc, and what stands them
   * for a frame — `stand` writes each piece's `skyWorld` into the array its recipe
   * holds and answers whether the disc is in view, and is called once a frame this
   * draws, as the main pass begins. Replaces any sky standing. `setSky` does not tell a failure: the listener it would reach
   * is the map's being replaced.
   */
  setSky(dome: SkyPiece, moon: SkyPiece | null, stand: () => boolean): void {
    this.clearSky();
    this.dome = this.upload("dome", dome);
    this.moon = moon && this.upload("moon", moon);
    this.stand = stand;
  }

  /**
   * Whether a map stands (`Sky.setStanding`). With none, nothing is drawn or
   * counted, and a frame with nothing else of ours skips `prepare`, so what it
   * drew last is put back here.
   */
  setStanding(on: boolean): void {
    this.standing = on;
    if (on) return;
    this.domeOurs = false;
    this.moonOurs = false;
    this.maskOurs = false;
    this.stats.drawn = 0;
    this.stats.masked = 0;
  }

  /** No sky stands: nothing is drawn or counted until the next `setSky`. */
  clearSky(): void {
    for (const piece of [this.dome, this.moon]) {
      if (!piece) continue;
      piece.block.destroy();
      for (const buffer of piece.buffers) buffer.destroy();
    }
    this.dome = null;
    this.moon = null;
    this.stand = null;
    this.domeOurs = false;
    this.moonOurs = false;
    this.maskOurs = false;
    this.stats.drawn = 0;
    this.stats.masked = 0;
  }

  private upload(label: string, piece: SkyPiece): Standing {
    const device = this.device;
    const array = (name: string, data: ArrayBufferView): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `sky: ${label} ${name}`,
        size: Math.max(16, data.byteLength),
        usage: GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
      });
      new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      buffer.unmap();
      return buffer;
    };
    const positions = array("positions", piece.positions);
    const uvs = array("uvs", piece.uvs);
    const indices = array("indices", piece.indices);
    const block = new UniformBlockBuffer(device, SKY_BLOCK, NO_DEFINES, `sky: ${label}`);
    const geometry = new HostBindGroup(device, `sky: ${label} geometry`, SKY_GEOMETRY, NO_DEFINES, {
      positionData: positions,
      uvData: uvs,
      indexData: indices,
    });
    // No textures: resolved once, whole for good.
    geometry.refresh(this.renderer.host, {});
    return {
      recipe: piece.recipe,
      block,
      material: new HostBindGroup(device, `sky: ${label} material`, [SKY_BLOCK, SKY_TEXTURE], NO_DEFINES, {
        [SKY_BLOCK.var]: block.buffer,
      }),
      textures: { skyTexture: piece.recipe.texture },
      geometry,
      buffers: [positions, uvs, indices],
      count: piece.indices.length,
    };
  }

  /** As the main pass begins: the frame's stand, its blocks off the recipes, the textures as `Sky` holds them. */
  private readonly prepare = (): void => {
    this.stats.drawn = 0;
    this.stats.masked = 0;
    const dome = this.standing ? this.dome : null;
    const moon = this.standing ? this.moon : null;
    if (!dome && !moon) {
      this.domeOurs = false;
      this.moonOurs = false;
      this.maskOurs = false;
      return;
    }
    const inView = this.stand ? this.stand() : false;
    this.domeOurs = dome !== null && this.domePipeline !== null;
    this.moonOurs = moon !== null && inView && this.moonPipeline !== null;
    this.maskOurs =
      moon !== null && inView && this.maskPipeline !== null && blooms(moon.recipe.values.skyGlow) && this.admits();
    const host = this.renderer.host;
    if (dome && this.domeOurs) {
      dome.block.write(dome.recipe.values);
      dome.material.refresh(host, dome.textures);
    }
    if (moon && (this.moonOurs || this.maskOurs)) {
      moon.block.write(moon.recipe.values);
      moon.material.refresh(host, moon.textures);
    }
  };

  /** One piece's one draw, the block and the texture its group, whose vertex stage reads the order out of `indexData`. */
  private piece(pass: GPURenderPassEncoder, ctx: FrameContext, built: BuiltPipeline, piece: Standing): boolean {
    const frame = ctx.frameGroup(built.groups[0]);
    const material = piece.material.get(built.groups[1]);
    const geometry = piece.geometry.get(built.groups[2]);
    if (!frame || !material || !geometry) return false;
    pass.setPipeline(built.pipeline);
    pass.setBindGroup(0, frame);
    pass.setBindGroup(1, material);
    pass.setBindGroup(2, geometry);
    pass.draw(piece.count);
    return true;
  }

  private readonly drawDome = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    // Reached only through a pass that is not refused.
    this.refusalTold = false;
    if (this.domeOurs && this.piece(pass, ctx, this.domePipeline!, this.dome!)) this.stats.drawn++;
  };

  private readonly drawMoon = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (this.moonOurs && this.piece(pass, ctx, this.moonPipeline!, this.moon!)) this.stats.drawn++;
  };

  private readonly drawMask = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    // Reached only through a pass that is not refused.
    this.maskRefusalTold = false;
    if (this.maskOurs && this.piece(pass, ctx, this.maskPipeline!, this.moon!)) this.stats.masked++;
  };

  /** `Renderer.onRefused`: the main pass drew nothing of ours, the sky included. */
  private readonly refused = (): void => {
    if ((!this.domeOurs && !this.moonOurs) || this.refusalTold) return;
    this.refusalTold = true;
    this.failed("the main pass was refused, so the sky cannot be drawn");
  };

  /** `Renderer.onGlowMaskRefused`: the mask drew nothing of ours, the moon's bloom included. */
  private readonly maskRefused = (): void => {
    if (!this.maskOurs || this.maskRefusalTold) return;
    this.maskRefusalTold = true;
    this.failed("the glow's mask pass was refused, so the moon cannot bloom");
  };
}
