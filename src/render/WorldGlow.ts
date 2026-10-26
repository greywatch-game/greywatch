/**
 * render/WorldGlow.ts — The emissive palette's share of the glow's MASK as
 * OUR renderer draws it (`BABYLON_EXIT.md` X3.6d): the lit windows, lamp
 * lenses, embers and signs of a map's merged world, drawn FIRST into the mask
 * pass Babylon's `GlowPass` opens, from the main pass's own view of the culls
 * (`WorldBlocks.glowView`). Since X3.6e the palette's MAIN pass is ours on
 * the same decision (`BlockHandover`, which says what that keeps out of
 * Babylon's lists).
 * Owns: `WorldGlow` — the world it draws while the handover holds the whole
 * palette (`GlowSource`, the map's `WorldBlocks`; the handover owns it), that
 * world's `GlowWorld` (a mask pipeline a palette bias, at most two), this
 * frame's verdict (`drawing`), each palette material's last-written bloom
 * colour, the mask draw, the prepare and the mask's refusal listener
 * (`Renderer.onGlowMaskRefused`) it registers on the renderer while it holds
 * a world, the draws it issued last (`drawn`), `broken`, and the listeners a
 * LOSS is announced to (`onLost`); `GlowSource`, `GlowWorld` and
 * `GlowWorldRules`.
 * Invariants: it DECIDES NOTHING about what blooms — whether the palette may
 * bloom this frame, and how brightly, are `Game`'s rules (`GlowRules`, the
 * same questions `GlowPass` asks of Babylon's meshes, PULLED once a frame
 * through `GlowWorldRules`), and which world it holds is the handover's; the
 * verdict is made in a renderer prepare, as the main pass begins — the world
 * held, its pipelines built, not broken, the rules admitting the palette and
 * every palette group drawable — and a frame it is not ours is a frame with
 * no palette bloom, never Babylon's, the palette being our main pass's too
 * while a world is held (a pipeline compiling or a texture unpublished is
 * the warm-up's to prevent, as a block group's hole in the main pass is);
 * the mask is NOT this module's (rule 5):
 * `GlowPass` owns it and its clear, Babylon's bodies, effects, fire,
 * viewmodel and moon still draw into it, and ours draws FIRST in that pass,
 * right after its clear (`Renderer.addGlowMask`) — no depth written, LEQUAL
 * against the depth OUR main pass's palette wrote, by the same vertex module
 * at the same bias, so it lands where the main pass's palette landed; a bloom
 * colour is written to a palette material's block only when it changed; a
 * LOSS (`lose`) stops the palette's bloom at once — `drawing` false — tells
 * its `onLost` listeners in the same call (the handover, which fails the
 * world: Babylon has no mesh of the palette, X3.7b), and takes the draw, the
 * prepare and the refusal listener off the renderer after the task in hand,
 * because it may land inside a render (a refused pass); a mask pipeline that
 * FAILS latches it BROKEN for the session (no world held again, so every
 * round with a glowing palette fails); nothing here allocates on a frame.
 * Never: imports Babylon; reads a node, a mesh's metadata or a material — a
 * material reaches it as its `EmissiveRecipe`; owns, clears or binds the
 * mask; draws in the main pass; announces a loss when no world was held (a
 * map going, `setWorld(null)`, is no loss).
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
  /** The world held while the palette is ours; null while it is Babylon's. */
  private world: GlowWorld | null = null;
  /** Whether its pipelines are built. */
  private built = false;
  /** A mask pipeline failed: no world is held again this session. */
  private broken = false;
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
  /** Told of every LOSS of a held world (`onLost`). */
  private readonly lostListeners = new Set<() => void>();

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

  /** Whether a world is held: the map's palette mask may be ours. */
  get holds(): boolean {
    return this.world !== null;
  }

  /**
   * `listener` told of every LOSS of a held world (`lose`: a refused mask
   * pass, a failed mask pipeline), in the call that loses it.
   * Never told of a world dropped for a map going. Returns its remove.
   */
  onLost(listener: () => void): () => void {
    this.lostListeners.add(listener);
    return () => {
      this.lostListeners.delete(listener);
    };
  }

  /** The draws issued into the last mask — what a census of the mask adds to Babylon's. */
  get drawn(): number {
    return this.drawnLast;
  }

  /**
   * The world the palette's mask is drawn from from now on — the map's, when
   * the handover holds the whole palette — or null: then the mask's palette
   * is Babylon's. Its pipelines are asked for here, at the install, under the
   * building card, whose warm-up waits on the renderer's cache. Only the
   * handover hands it a world, with the palette's main pass: a world set
   * alone would take the mask while Babylon's main pass still holds the
   * palette ACTIVE, and `GlowPass` would bloom it a second time.
   */
  setWorld(source: GlowSource | null): void {
    this.drop();
    if (this.broken || !source) return;
    const world = source.glowView();
    if (!world) return;
    this.world = world;
    this.built = false;
    this.written = new Float32Array(world.recipes.length * 4).fill(Number.NaN);
    const generation = ++this.generation;
    void world.ready.then((ok) => {
      if (generation !== this.generation) return;
      if (!ok) {
        // No mask of ours can be drawn: no world is held for the session.
        this.broken = true;
        this.lose();
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

  /**
   * The world can no longer draw what Babylon's twin would — the mask pass
   * was refused, or a mask pipeline failed: the `onLost` listeners are told
   * at once (the handover fails the world), and the draw, the prepare and
   * the refusal listener come off the renderer once the task in hand is
   * done.
   */
  lose(): void {
    if (!this.world) return;
    this.ours = false;
    this.drawnLast = 0;
    this.generation++;
    const world = this.world;
    this.world = null;
    this.built = false;
    const unhook = this.unhook;
    this.unhook = null;
    // After the task: a loss can land INSIDE a render — the renderer walking
    // the very list this would splice — whose commands still hold the world.
    queueMicrotask(() => {
      unhook?.();
      world.dispose();
    });
    for (const listener of this.lostListeners) listener();
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

  /** `Renderer.onGlowMaskRefused`: the mask is not what our pipelines were built for. */
  private readonly refused = (): void => {
    console.error("WorldGlow: the glow's mask pass was refused; the emissive palette cannot bloom");
    this.lose();
  };
}
