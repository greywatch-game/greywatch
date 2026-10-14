/**
 * core/PipelineWarmup.ts — Where the building card stands the camera while the
 * round's render pipelines are compiled, and when it may stop.
 * Owns: the list of vantages, which one is being drawn from, how many frames
 * have been spent there and how many of them compiled nothing, and the two
 * wall clocks it is capped by. Owns no camera, no mesh and no system: `Game`
 * places the camera at `vantage`, draws the frame, and reports back through
 * `afterFrame` how many pipelines Babylon's cache had built by the end of it;
 * our renderer's own cache it is handed and reads (`CompileProgress`). It
 * decides WHEN, never HOW.
 * Invariants: it ends. Every path through `afterFrame` either holds, moves to
 * the next vantage or reports done, and the frame cap per vantage and the two
 * wall-clock caps end it whatever the counters do — a warm-up that cannot
 * settle must not hang the card any more than the reflection drain may. It
 * OPENS by waiting, with no vantage, for OUR renderer's pipelines
 * (`CONFIG.graphics.warmup.oursCapMs`): they were asked for as the map was
 * built and compile off the frame, so drawing does not hurry them, but a
 * group of ours still compiling draws NOTHING and Babylon no longer draws the
 * blocks in the main pass — so the vantages are drawn with ours built, and a
 * surface a failed compile handed back to Babylon is compiled by Babylon at a
 * vantage like any other mesh. A vantage is then held until it has drawn
 * `CONFIG.graphics.warmup.quietFrames` in a row that created nothing in
 * either cache and left nothing of ours compiling, because a mesh whose
 * effect is still compiling is SKIPPED by a frame rather than compiled by it
 * and turns up on the next one.
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
 * warm-up only has to wait for them.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CompileProgress } from "../render/PipelineCache";

/** Where a vantage's eye stands above the point it is taken at. */
const EYE_HEIGHT = 1.7;

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

  /**
   * `points` are where a life can start or be fought over — the spawns and the
   * flags. Each becomes an eye at standing height above it; the frustum is off
   * for these frames, so which way it faces does not matter, but where it
   * STANDS does: the shadow window, the bodies' map and the lamps that win a
   * shadow tile are all chosen around the eye. `createdSoFar` is Babylon's
   * pipeline cache's running count, and `ours` is our renderer's cache.
   */
  constructor(
    points: readonly Vector3[],
    createdSoFar: number,
    private readonly ours: CompileProgress,
  ) {
    this.vantages = points.map(
      (p) => new Vector3(p.x, p.y + EYE_HEIGHT, p.z),
    );
    this.lastCount = createdSoFar + ours.settled;
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
      // Ours first, under a cap of their own — see the header.
      if (compiling > 0 && now - this.since < cfg.oursCapMs) return false;
      if (compiling > 0 && import.meta.env.DEV) {
        console.warn(
          `[warmup] ${compiling} of our renderer's pipeline(s) still compiling after ` +
            `${cfg.oursCapMs} ms — what they draw is missing from the frame until they land`,
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
          `${Math.round(now - this.since)} ms` +
          (overrun && !done ? " — over the cap, the rest compiles in the round" : ""),
      );
    }
    return done || overrun;
  }
}
