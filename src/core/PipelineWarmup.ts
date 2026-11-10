/**
 * core/PipelineWarmup.ts — When the building card may come down: the wait
 * for every pipeline of OUR renderer the round can use.
 * Owns: `DeclaredPipelines`, the shape of one entry of the round's DECLARED
 * list; which of the declared entries have settled, how many of our
 * renderer's compiles settled while it waited, and the wall clock it is
 * capped by.
 * Owns no camera, no mesh, no draw and no system: `Game` declares the list
 * (`Game.roundPipelines`), draws its frames as any `loading` frame, and asks
 * `afterFrame` after each one's render; our renderer's cache it is handed and
 * reads (`CompileProgress`). It decides WHEN, never HOW.
 * Invariants: it ends. It waits for every entry of the declared list settled
 * — the bodies, the hulls, the weapon, the bodies' shadow map, the lamps'
 * proxies, every effect pool of ours, the sky, the post chain, the glow's
 * blur and the irradiance volume, each asked once at `Game`'s construction —
 * and nothing of ours left compiling, which is the map's own (the world's
 * groups, its depth passes — the lamps' atlas's casters among them — the
 * probes' bake, the palette's mask, asked as its install built them), under
 * `CONFIG.graphics.warmup.oursCapMs`; a cap reached names the entries still
 * unsettled (a DEV warning) and ends the wait whatever the counters say — a
 * wait that cannot settle must not hang the card any more than the
 * reflection drain may. A group of ours still compiling draws NOTHING, so the
 * round must not open on one; a compile of ours that FAILS fails the world
 * under the card (`BABYLON_EXIT.md` X3.7b: `Game.worldFailed`). "Ours" is the
 * whole of our renderer's cache, so a compile a torn-down map left in flight
 * holds the wait too — at worst a slower card, since a later map reuses what
 * it built.
 * Never: reads the scene, touches the GPU, stands the camera anywhere, or
 * allocates per frame.
 *
 * **Nothing is DRAWN for a pipeline's sake, because ours are not compiled by
 * drawing.** Our renderer states every field of a pipeline itself and asks for
 * it ahead of the frame (`render/PipelineCache.ts`), so the card only has to
 * wait for them; and once it is down the cache is SEALED (`PipelineCache.seal`),
 * so a compile in play is a DEV warning naming what the list missed. **There
 * were VANTAGES here until `BABYLON_EXIT.md` X5.4c**: the card stood the camera
 * at each home spawn and each flag in turn and drew the whole map from there,
 * frustum and cull cells off, until a frame compiled nothing — because Babylon
 * compiled a pipeline on the first draw that needed one, and a restatement of
 * every field by hand (`engine.createRenderPipelineAsync`) that was wrong in one
 * would have built a pipeline nothing asked for and left the stall where it
 * was. As Babylon's draws left the round (the post chain's last at X5.2d, the
 * irradiance volume's computes at X5.1b, every pool by X4.6e), the vantages had
 * less and less to compile, and X5.4a's log and X5.4c's showed them compiling
 * NOTHING in either cache on all seven shipped maps — fifteen installs, eleven
 * vantages each — so X5.4c retired them, and with them the read of Babylon's
 * pipeline cache's miss count, the quiet-frame rule and its two caps.
 */
import { CONFIG } from "../config";
import type { CompileProgress } from "../render/PipelineCache";

/**
 * One entry of the round's declared pipelines: a draw of ours whose every
 * pipeline was asked once, at `Game`'s construction, and the promise it
 * settles when all of them have (true built, false one failed — the failure
 * is the draw's to tell, at its install).
 */
export interface DeclaredPipelines {
  readonly name: string;
  readonly ready: Promise<boolean>;
}

export class PipelineWarmup {
  private readonly since = performance.now();
  /** Our cache's settled count when the wait opened, for the DEV line at the end. */
  private readonly settledAtStart: number;
  /** Of the declared entries, which have settled (by index, made once a wait) and how many have not. */
  private readonly declaredSettled: boolean[];
  private declaredPending: number;

  /**
   * `ours` is our renderer's cache and `declared` the round's declared list
   * (`Game.roundPipelines`), waited on by name.
   */
  constructor(
    private readonly ours: CompileProgress,
    private readonly declared: readonly DeclaredPipelines[],
  ) {
    this.settledAtStart = ours.settled;
    this.declaredSettled = declared.map(() => false);
    this.declaredPending = declared.length;
    declared.forEach((entry, i) => {
      const settle = (): void => {
        this.declaredSettled[i] = true;
        this.declaredPending--;
      };
      void entry.ready.then(settle, settle);
    });
  }

  /**
   * One frame, reported after its render. Returns true when the wait is over —
   * every declared entry settled and nothing of ours compiling, or the cap
   * reached.
   */
  afterFrame(): boolean {
    const cap = CONFIG.graphics.warmup.oursCapMs;
    const now = performance.now();
    const compiling = this.ours.compiling;
    const waiting = compiling > 0 || this.declaredPending > 0;
    if (waiting && now - this.since < cap) return false;
    if (import.meta.env.DEV) {
      if (waiting) {
        // Once, at the cap: the names of what is still out.
        const unsettled = this.declared.filter((_, i) => !this.declaredSettled[i]).map((e) => e.name);
        console.warn(
          `[warmup] ${compiling} of our renderer's pipeline(s) still compiling, ` +
            `${this.declaredPending} of ${this.declared.length} declared draw(s) unsettled` +
            (unsettled.length > 0 ? ` (${unsettled.join(", ")})` : "") +
            `, after ${cap} ms — what they draw is missing from the frame until they land`,
        );
      }
      console.info(
        `[warmup] ${this.ours.settled - this.settledAtStart} of our pipeline(s) settled in ` +
          `${Math.round(now - this.since)} ms waiting for ours`,
      );
    }
    return true;
  }
}
