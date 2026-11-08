/**
 * core/PipelineWarmup.ts — Where the building card stands the camera while the
 * round's render pipelines are compiled, and when it may stop.
 * Owns: `DeclaredPipelines`, the shape of one entry of the round's DECLARED
 * list; the list of vantages, which one is being drawn from, how many frames
 * have been spent there and how many of them compiled nothing, which of the
 * declared entries have settled, and the two wall clocks it is capped by.
 * Owns no camera, no mesh, no draw and no system: `Game` declares the list
 * (`Game.roundPipelines`), places the camera at `vantage`, draws the frame,
 * and reports back through `afterFrame` how many pipelines Babylon's cache had
 * built by the end of it; our renderer's own cache it is handed and reads
 * (`CompileProgress`). It decides WHEN, never HOW.
 * Invariants: it ends. Every path through `afterFrame` either holds, moves to
 * the next vantage or reports done, and the frame cap per vantage and the two
 * wall-clock caps end it whatever the counters do — a warm-up that cannot
 * settle must not hang the card any more than the reflection drain may. It
 * OPENS by waiting, with no vantage, for OUR renderer's pipelines
 * (`CONFIG.graphics.warmup.oursCapMs`): every entry of the declared list
 * settled — the bodies, the hulls, the weapon, the bodies' shadow map, the
 * lamps' proxies, every effect pool of ours and the sky, each asked once at
 * `Game`'s construction — and nothing of ours left compiling, which is the map's own
 * (the world's groups, its depth passes — the lamps' atlas's casters among
 * them — the probes' bake, the palette's mask, asked as its install built
 * them); a cap reached names the entries still unsettled. They compile off the
 * frame, so drawing does not hurry them, but a group of ours still compiling
 * draws NOTHING and Babylon no longer draws the blocks in the main pass — so
 * the vantages are drawn with ours built; a compile of ours that FAILS fails
 * the world under the card (`BABYLON_EXIT.md` X3.7b: `Game.worldFailed`),
 * Babylon holding no mesh of it to compile at a vantage instead. A vantage is
 * then held until it has drawn `CONFIG.graphics.warmup.quietFrames` in a row
 * that created nothing in either cache and left nothing of ours compiling,
 * because a mesh whose effect is still compiling is SKIPPED by a frame rather
 * than compiled by it and turns up on the next one. "Ours" is the whole of our
 * renderer's cache, so a compile a torn-down map left in flight holds the wait
 * too — at worst a slower card, since a later map reuses what it built.
 * Never: reads the scene, touches the GPU, or allocates per frame.
 *
 * **Why Babylon's pipelines are DRAWN rather than pre-built.** Babylon 9.28 has
 * `engine.createRenderPipelineAsync`, which builds one without a draw — but a
 * pipeline is keyed on the effect, the vertex layout, the target's formats,
 * the blend, the depth state, the cull, the write mask and the depth bias, and
 * every one of those would have to be restated by hand for every mesh in every
 * pass. A restatement that is wrong in one field compiles a pipeline nothing
 * ever asks for, and the stall it was meant to remove stays exactly where it
 * was, silently. A real frame states all of them by construction. Ours are
 * the other way round: our renderer states every field of a pipeline itself
 * and asks for it ahead of the frame (`render/PipelineCache.ts`), so the
 * warm-up only has to wait for them — which is why an effect pool of ours is
 * never POSED at a vantage (`BABYLON_EXIT.md` X4.4e). What the vantages still
 * draw for in a round is Babylon's own, and since X4.7d that is the post chain
 * alone: every particle field is ours (the ash since X4.7c, the rotor wash
 * since X4.7d), their pipelines on the list. Measured at X4.7d (Cinderhaven,
 * Sarab, Hollowmere, from `startRound` to 120 frames into the deploy): Babylon
 * compiles NOTHING at a vantage — the post chain's six pipelines on the frames
 * before the card (five since X5.2b made the glow's blur and box filter ours,
 * every rung at every render scale on the declared list as "the glow's blur";
 * four since X5.2c1 made the grade ours, "the post chain" on the list),
 * and `GiVolume`'s three computes under it (its race) until
 * X5.1b made them OURS, asked at construction and on the declared list ("the
 * irradiance volume"), so Babylon makes no compute pipeline at all — so the
 * vantages are handed to X5.4, which owns retiring them, as a step that
 * finds nothing of Babylon's left to compile. The glazing, the blob shadows
 * and the three blended pools were Babylon's until X4.6e, the pools and the
 * blobs posed at a vantage
 * (`warm(on)`, `warmBlob`) until then; they are our renderer's now, their
 * pipelines on the round's declared list like every other draw of ours.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CompileProgress } from "../render/PipelineCache";

/** Where a vantage's eye stands above the point it is taken at. */
const EYE_HEIGHT = 1.7;

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
  /** The eyes to draw from, in order. */
  private readonly vantages: Vector3[];
  /** The vantage being drawn from; -1 while our pipelines are awaited. */
  private index = -1;
  /** Frames drawn at the current vantage. */
  private frames = 0;
  /** Of those, how many in a row created nothing. */
  private quiet = 0;
  /** Both caches' counts, summed, after the last frame. */
  private lastCount: number;
  private readonly since = performance.now();
  /** When the first vantage was stood at — what `capMs` is measured from. */
  private drawingSince = 0;
  /** Pipelines this warm-up has seen built, for the DEV line at the end. */
  private built = 0;
  /** Of the declared entries, which have settled (by index, made once a warm-up) and how many have not. */
  private readonly declaredSettled: boolean[];
  private declaredPending: number;

  /**
   * `points` are where a life can start or be fought over — the spawns and the
   * flags. Each becomes an eye at standing height above it; the frustum is off
   * for these frames, so which way it faces does not matter, but where it
   * STANDS does: the shadow window, the bodies' map and the lamps that win a
   * shadow tile are all chosen around the eye. `createdSoFar` is Babylon's
   * pipeline cache's running count, `ours` is our renderer's cache, and
   * `declared` is the round's declared list (`Game.roundPipelines`), waited
   * on by name before the first vantage.
   */
  constructor(
    points: readonly Vector3[],
    createdSoFar: number,
    private readonly ours: CompileProgress,
    private readonly declared: readonly DeclaredPipelines[],
  ) {
    this.vantages = points.map(
      (p) => new Vector3(p.x, p.y + EYE_HEIGHT, p.z),
    );
    this.lastCount = createdSoFar + ours.settled;
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

  /** Where this frame's eye stands, or null while there is none: ours awaited, or done. */
  get vantage(): Vector3 | null {
    return this.vantages[this.index] ?? null;
  }

  /**
   * One frame, reported after its render. `created` is Babylon's pipeline
   * cache's running count. Returns true when the warm-up is over — every
   * vantage settled, or a cap reached.
   */
  afterFrame(created: number): boolean {
    const cfg = CONFIG.graphics.warmup;
    const now = performance.now();
    const count = created + this.ours.settled;
    const fresh = count - this.lastCount;
    this.lastCount = count;
    this.built += fresh;
    const compiling = this.ours.compiling;
    if (this.index < 0) {
      // Ours first — the declared list, then the map's — under a cap of their
      // own: see the header.
      const waiting = compiling > 0 || this.declaredPending > 0;
      if (waiting && now - this.since < cfg.oursCapMs) return false;
      if (waiting && import.meta.env.DEV) {
        // Once, at the cap: the names of what is still out.
        const unsettled = this.declared.filter((_, i) => !this.declaredSettled[i]).map((e) => e.name);
        console.warn(
          `[warmup] ${compiling} of our renderer's pipeline(s) still compiling, ` +
            `${this.declaredPending} of ${this.declared.length} declared draw(s) unsettled` +
            (unsettled.length > 0 ? ` (${unsettled.join(", ")})` : "") +
            `, after ${cfg.oursCapMs} ms — what they draw is missing from the frame until they land`,
        );
      }
      this.index = 0;
      this.drawingSince = now;
    } else {
      this.frames++;
      this.quiet = fresh > 0 || compiling > 0 ? 0 : this.quiet + 1;
      if (this.quiet >= cfg.quietFrames || this.frames >= cfg.maxFramesPerVantage) {
        this.index++;
        this.frames = 0;
        this.quiet = 0;
      }
    }
    const done = this.index >= this.vantages.length;
    const overrun = now - this.drawingSince >= cfg.capMs;
    if ((done || overrun) && import.meta.env.DEV) {
      console.info(
        `[warmup] ${this.built} pipeline(s) from ${Math.min(this.index, this.vantages.length)}` +
          ` of ${this.vantages.length} vantage(s) in ` +
          `${Math.round(now - this.drawingSince)} ms, after ` +
          `${Math.round(this.drawingSince - this.since)} ms waiting for ours` +
          (overrun && !done ? " — over the cap, the rest compiles in the round" : ""),
      );
    }
    return done || overrun;
  }
}
