/**
 * render/WorldGlow.ts — The emissive palette's share of the glow's MASK as
 * OUR renderer draws it (`BABYLON_EXIT.md` X3.6d): the lit windows, lamp
 * lenses, embers and signs of a map's merged world, drawn FIRST into the mask
 * pass Babylon's `GlowPass` opens, from the main pass's own view of the culls
 * (`WorldBlocks.glowView`). The palette's MAIN pass is ours too (X3.6e), and
 * since X3.7b Babylon is made no mesh of it, so no Babylon draw of the
 * palette's bloom is left anywhere (X3.7c deleted its twin).
 * Owns: `WorldGlow` — the world it draws (`GlowSource`, the map's
 * `WorldBlocks` while a palette surface of it glows; the handover owns it),
 * that world's `GlowWorld` (a mask pipeline a palette bias, at most two),
 * the failure handed over with it, this frame's verdict (`drawing`), each
 * palette material's last-written bloom colour, the mask draw, the prepare
 * and the mask's refusal listener (`Renderer.onGlowMaskRefused`) it
 * registers on the renderer while it holds a world, and the draws it issued
 * last (`drawn`); `GlowSource`, `GlowWorld` and `GlowWorldRules`.
 * Invariants: it DECIDES NOTHING about what blooms — whether the palette may
 * bloom this frame, and how brightly, are `Game`'s rules (`GlowRules`, the
 * same questions `GlowPass` asks of Babylon's meshes, PULLED once a frame
 * through `GlowWorldRules`), and which world it holds is the handover's; the
 * verdict is made in a renderer prepare, as the main pass begins — the world
 * held, its pipelines built, the rules admitting the palette and every
 * palette group drawable — and a frame it is not ours is a frame with no
 * palette bloom (a pipeline compiling or a texture unpublished is the
 * warm-up's to prevent, as a block group's hole in the main pass is);
 * the mask is NOT this module's (rule 5):
 * `GlowPass` owns it and its clear, Babylon's bodies, effects, fire,
 * viewmodel and moon still draw into it, and ours draws FIRST in that pass,
 * right after its clear (`Renderer.addGlowMask`) — no depth written, LEQUAL
 * against the depth OUR main pass's palette wrote, by the same vertex module
 * at the same bias, so it lands where the main pass's palette landed; a bloom
 * colour is written to a palette material's block only when it changed; a
 * world it cannot draw — no view of the palette, a mask pipeline that
 * FAILED, a mask pass REFUSED (in which the renderer draws nothing of ours)
 * — tells the failure handed over with it (`setWorld`: the world's,
 * `BlockHandover`, which has nothing to fall back on), the world and its
 * registrations kept until the handover takes them back, never inside the
 * render a refusal lands in; nothing here allocates on a frame.
 * Never: imports Babylon; reads a node, a mesh's metadata or a material — a
 * material reaches it as its `EmissiveRecipe`; owns, clears or binds the
 * mask; draws in the main pass; tells a failure of a world it no longer
 * holds (a map going, `setWorld(null)`, is no failure).
 * Contract: `docs/rendering.md`, "The glow: what the depth share replaced"
 * (its "The palette, ours: the mask (X3.6d) and the main pass (X3.6e)") and
 * "Our renderer's frame".
 */
import type { EmissiveRecipe } from "./emissiveWorld";
import type { FrameUniforms } from "./frame";
import type { PassTiming } from "./PassTimer";
import type { FrameContext, Renderer } from "./Renderer";

/** A view's group 0, made against the layout a pipeline was built with; null while a texture is unpublished. */
type FrameGroup = (layout: GPUBindGroupLayout) => GPUBindGroup | null;

/** The world the palette's mask is drawn from, as the map's `WorldBlocks` offers it. */
export interface GlowSource {
  glowView(): GlowWorld | null;
}

/** The palette as the glow's mask draws it through the main pass's view of the culls (`WorldBlocks.glowView`). */
export interface GlowWorld {
  /** Resolves true once the mask's pipelines are built; false if one failed. */
  readonly ready: Promise<boolean>;
  /** Each palette material's recipe, in the order `writeColour` indexes them. */
  readonly recipes: readonly EmissiveRecipe[];
  /** Whether every palette group can draw NOW — the main view's culls built, its pipeline built, its three groups whole. */
  drawable(group0: FrameGroup): boolean;
  /** Every palette group into `pass`, off the main view's survivors this frame; how many draws it issued. */
  draw(pass: GPURenderPassEncoder, group0: FrameGroup): number;
  /** Palette material `k`'s bloom colour — rgb the scale, a the alpha — into its block. */
  writeColour(k: number, colour: Float32Array): void;
  /** Nothing drawn through it again. */
  dispose(): void;
}

/** What `Game` decides about the palette's bloom: `GlowRules`' `admits` and `colour`, asked of the palette. */
export interface GlowWorldRules {
  /** Whether the world's emissive meshes may bloom this frame (rendering group 0). */
  admits(): boolean;
  /** The bloom colour of the palette material `recipe` draws, into `out` — rgb the colour, a the alpha. */
  colour(recipe: EmissiveRecipe, out: Float32Array): void;
}

export class WorldGlow {
  /** The world held: the map's, while a palette surface of it glows; null with none. */
  private world: GlowWorld | null = null;
  /** Whether its pipelines are built. */
  private built = false;
  /** Told why, if `world` cannot be drawn: handed over with it (`setWorld`). */
  private failed: (reason: string) => void = ignore;
  /** Bumped whenever the world changes: a build that settles for one already gone does nothing. */
  private generation = 0;
  /** This frame's verdict: ours draws the palette into the mask. */
  private ours = false;
  private drawnLast = 0;
  /**
   * Each palette material's colour as last written, four floats apiece; NaN:
   * never written, so the first frame writes every colour.
   */
  private written = new Float32Array(0);
  private readonly colour = new Float32Array(4);
  /** Takes the draw, the prepare and the refusal back off the renderer; null while nothing is registered. */
  private unhook: (() => void) | null = null;

  constructor(
    private readonly renderer: Renderer,
    private readonly rules: GlowWorldRules,
  ) {}

  /**
   * Whether ours draws the emissive palette into the glow's mask THIS frame —
   * decided as the main pass begins. Nothing in the game reads it; a scratch
   * script does (`VERIFYING.md`).
   */
  get drawing(): boolean {
    return this.ours;
  }

  /** The draws issued into the last mask — what a census of the mask adds to Babylon's. */
  get drawn(): number {
    return this.drawnLast;
  }

  /**
   * The world the palette's mask is drawn from from now on — the map's, when
   * a palette surface of it glows — or null: then no palette blooms. Its
   * pipelines are asked for here, at the install, under the building card,
   * whose warm-up waits on the renderer's cache. `failed` is told why if it
   * cannot be drawn — no view of the palette, a mask pipeline failed, the
   * mask pass refused — unless another world has been handed over since.
   */
  setWorld(source: GlowSource | null, failed: (reason: string) => void = ignore): void {
    this.drop();
    if (!source) return;
    const world = source.glowView();
    if (!world) {
      failed("our glow mask could not view the emissive palette");
      return;
    }
    this.world = world;
    this.failed = failed;
    this.built = false;
    this.written = new Float32Array(world.recipes.length * 4).fill(Number.NaN);
    const generation = ++this.generation;
    void world.ready.then((ok) => {
      if (generation !== this.generation) return;
      if (!ok) {
        failed("a glow-mask pipeline of the emissive palette failed");
        return;
      }
      this.built = true;
    });
    const renderer = this.renderer;
    const removes = [
      renderer.onFrame(this.prepare),
      renderer.addGlowMask(this.draw),
      renderer.onGlowMaskRefused(this.refused),
    ];
    this.unhook = () => {
      for (const remove of removes) remove();
    };
  }

  dispose(): void {
    this.drop();
  }

  /** The world and its registrations dropped at once: never inside a render. */
  private drop(): void {
    this.generation++;
    this.unhook?.();
    this.unhook = null;
    this.world?.dispose();
    this.world = null;
    this.failed = ignore;
    this.built = false;
    this.ours = false;
    this.drawnLast = 0;
  }

  /**
   * As the main pass begins, after the frame is filled: this frame's verdict,
   * and each palette material's bloom colour written if it moved — so the
   * mask, drawn later in the same submit, reads it.
   */
  private readonly prepare = (_frame: FrameUniforms, _encoder: GPUCommandEncoder, _timing: PassTiming | null, ctx: FrameContext): void => {
    this.drawnLast = 0;
    const world = this.world;
    this.ours =
      world !== null &&
      this.built &&
      this.rules.admits() &&
      world.drawable(ctx.frameGroup);
    if (!this.ours) return;
    const recipes = world!.recipes;
    const colour = this.colour;
    const written = this.written;
    for (let k = 0; k < recipes.length; k++) {
      this.rules.colour(recipes[k], colour);
      const o = k * 4;
      if (
        written[o] === colour[0] &&
        written[o + 1] === colour[1] &&
        written[o + 2] === colour[2] &&
        written[o + 3] === colour[3]
      ) {
        continue;
      }
      written.set(colour, o);
      world!.writeColour(k, colour);
    }
  };

  /** First in the glow's mask, right after its clear: the palette, on a frame the verdict was ours. */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    const world = this.world;
    this.drawnLast = this.ours && world ? world.draw(pass, ctx.frameGroup) : 0;
  };

  /**
   * `Renderer.onGlowMaskRefused`: the mask is not what our pipelines were
   * built for, and the renderer drew nothing of ours in it (it says so on the
   * console) — told on every frame it is refused, which the handover takes as
   * one failure.
   */
  private readonly refused = (): void => {
    this.failed("the glow's mask pass was refused, so the emissive palette cannot bloom");
  };
}

/** A `setWorld` with nobody to tell: handing none over, or tearing down. */
function ignore(): void {}
