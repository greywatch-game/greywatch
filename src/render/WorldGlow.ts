/**
 * render/WorldGlow.ts — The emissive palette's share of the glow's MASK as
 * OUR renderer draws it (`BABYLON_EXIT.md` X3.6d): the lit windows, lamp
 * lenses, embers and signs of a map's merged world, drawn FIRST into the mask
 * pass Babylon's `GlowPass` opens, from the main pass's own view of the culls
 * (`WorldBlocks.glowView`); `GlowPass` leaves those meshes out of its list on
 * the frames this means to draw them.
 * Owns: `WorldGlow` — the world it draws while the handover holds the whole
 * palette (`GlowSource`, the map's `WorldBlocks`; the handover owns it), that
 * world's `GlowWorld` (a mask pipeline a palette bias, at most two), this
 * frame's verdict (`drawing`), each palette material's last-written bloom
 * colour, the mask draw and the prepare it registers on the renderer while
 * it holds a world, the draws it issued last (`drawn`), and `broken`;
 * `GlowSource`, `GlowWorld` and `GlowWorldRules`.
 * Invariants: it DECIDES NOTHING about what blooms — whether the palette may
 * bloom this frame, and how brightly, are `Game`'s rules (`GlowRules`, the
 * same questions `GlowPass` asks of Babylon's meshes, PULLED once a frame
 * through `GlowWorldRules`), and which world it holds is the handover's; ONE
 * side draws each frame's palette: the verdict is made in a renderer prepare,
 * as the main pass begins — the world held, its pipelines built, not broken,
 * the rules admitting the palette and every palette group drawable — and
 * `GlowPass` builds its list after it, at the end of the draw phase, asking
 * it (`Game`'s `GlowRules.drawnElsewhere`), so a frame with a pipeline
 * compiling or a texture unpublished is Babylon's — and the one frame a
 * refused MASK pass is found is NEITHER side's, Babylon having built the
 * mask's list before the clear that announces the pass; the mask is NOT this
 * module's (rule 5): `GlowPass` owns it and its clear, Babylon's bodies,
 * effects, fire, viewmodel and moon still draw into it, and ours draws FIRST
 * in that pass, right after its clear (`Renderer.addGlowMask`) — no depth
 * written, LEQUAL against the depth Babylon's palette wrote in the main pass
 * at the same bias, so it lands where Babylon's twin landed; a bloom colour
 * is written to a palette material's block only when it changed; a LOSS
 * (`lose`) hands the palette back at once — `drawing` false, so `GlowPass`'s
 * next list has it — and takes the draw and the prepare off the renderer
 * after the task in hand, because it may land inside a render (a refused
 * pass); a mask pipeline that FAILS latches it BROKEN for the session, every
 * map's palette mask then Babylon's; nothing here allocates on a frame.
 * Never: imports Babylon; reads a node, a mesh's metadata or a material — a
 * material reaches it as its `EmissiveRecipe`; owns, clears or binds the
 * mask; draws in the main pass.
 * Contract: `docs/rendering.md`, "The glow: what the depth share replaced"
 * and "Our renderer's frame".
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

/** What `Game` decides about the palette's bloom: `GlowRules`' two questions, asked of the palette. */
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
  /** This frame's verdict: ours draws the palette into the mask, and `GlowPass` leaves it out. */
  private ours = false;
  private drawnLast = 0;
  /** Each palette material's colour as last written, four floats apiece; NaN is never. */
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
   * decided as the main pass begins, and what `GlowPass` asks (through
   * `Game`'s `GlowRules.drawnElsewhere`) before it lists Babylon's meshes.
   */
  get drawing(): boolean {
    return this.ours;
  }

  /** Whether a world is held: the map's palette mask may be ours. */
  get holds(): boolean {
    return this.world !== null;
  }

  /** The draws issued into the last mask — what a census of the mask adds to Babylon's. */
  get drawn(): number {
    return this.drawnLast;
  }

  /**
   * The world the palette's mask is drawn from from now on — the map's, when
   * the handover holds the whole palette — or null: then the mask's palette
   * is Babylon's. Its pipelines are asked for here, at the install, under the
   * building card, whose warm-up waits on the renderer's cache.
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
        // No mask of ours can be drawn: the palette's mask is Babylon's for the session.
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
   * The world can no longer draw what Babylon's twin would — a palette
   * surface went back to Babylon, the main pass or the mask's was refused, a
   * pipeline failed: the palette is Babylon's from `GlowPass`'s next list,
   * and the draw and the prepare come off the renderer once the task in hand
   * is done.
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
    console.error("WorldGlow: the glow's mask pass was refused; the emissive palette's mask goes back to Babylon for this map");
    this.lose();
  };
}
