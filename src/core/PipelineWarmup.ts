/**
 * core/PipelineWarmup.ts — Where the building card stands the camera while the
 * round's render pipelines are compiled, and when it may stop.
 * Owns: the list of vantages, which one is being drawn from, how many frames
 * have been spent there and how many of them compiled nothing, and the wall
 * clock the whole warm-up is capped by. Owns no camera, no mesh and no system:
 * `Game` places the camera at `vantage`, draws the frame, and reports back
 * through `afterFrame` how many pipelines Babylon's cache had built by the end
 * of it. It decides WHEN, never HOW.
 * Invariants: it ends. Every path through `afterFrame` either holds the
 * vantage, moves to the next one or reports done, and the frame cap per
 * vantage and the wall-clock cap both end it whatever the counter does — a
 * warm-up that cannot settle must not hang the card any more than the
 * reflection drain may. A vantage is held until it has drawn
 * `CONFIG.graphics.warmup.quietFrames` in a row that created nothing, because
 * a mesh whose effect is still compiling is SKIPPED by a frame rather than
 * compiled by it and turns up on the next one.
 * Never: reads the scene, touches the GPU, or allocates per frame.
 *
 * **Why the pipelines are DRAWN rather than pre-built.** Babylon 9.28 has
 * `engine.createRenderPipelineAsync`, which builds one without a draw — but a
 * pipeline is keyed on the effect, the vertex layout, the target's formats,
 * the blend, the depth state, the cull, the write mask and the depth bias, and
 * every one of those would have to be restated by hand for every mesh in every
 * pass. A restatement that is wrong in one field compiles a pipeline nothing
 * ever asks for, and the stall it was meant to remove stays exactly where it
 * was, silently. A real frame states all of them by construction.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";

/** Where a vantage's eye stands above the point it is taken at. */
const EYE_HEIGHT = 1.7;

export class PipelineWarmup {
  /** The eyes to draw from, in order. */
  private readonly vantages: Vector3[];
  private index = 0;
  /** Frames drawn at the current vantage. */
  private frames = 0;
  /** Of those, how many in a row created nothing. */
  private quiet = 0;
  /** The cache's creation count after the last frame. */
  private lastCount: number;
  private readonly since = performance.now();
  /** Pipelines this warm-up has seen built, for the DEV line at the end. */
  private built = 0;

  /**
   * `points` are where a life can start or be fought over — the spawns and the
   * flags. Each becomes an eye at standing height above it; the frustum is off
   * for these frames, so which way it faces does not matter, but where it
   * STANDS does: the shadow window, the bodies' map and the lamps that win a
   * shadow tile are all chosen around the eye.
   */
  constructor(points: readonly Vector3[], createdSoFar: number) {
    this.vantages = points.map(
      (p) => new Vector3(p.x, p.y + EYE_HEIGHT, p.z),
    );
    this.lastCount = createdSoFar;
  }

  /** Where this frame's eye stands, or null once there is nowhere left. */
  get vantage(): Vector3 | null {
    return this.vantages[this.index] ?? null;
  }

  /**
   * One frame, reported after its render. `created` is the pipeline cache's
   * running count. Returns true when the warm-up is over — every vantage
   * settled, or the cap reached.
   */
  afterFrame(created: number): boolean {
    const cfg = CONFIG.graphics.warmup;
    const fresh = created - this.lastCount;
    this.lastCount = created;
    this.built += fresh;
    this.frames++;
    this.quiet = fresh > 0 ? 0 : this.quiet + 1;
    if (this.quiet >= cfg.quietFrames || this.frames >= cfg.maxFramesPerVantage) {
      this.index++;
      this.frames = 0;
      this.quiet = 0;
    }
    const done = this.index >= this.vantages.length;
    const overrun = performance.now() - this.since >= cfg.capMs;
    if ((done || overrun) && import.meta.env.DEV) {
      console.info(
        `[warmup] ${this.built} pipeline(s) from ${Math.min(this.index, this.vantages.length)}` +
          ` of ${this.vantages.length} vantage(s) in ` +
          `${Math.round(performance.now() - this.since)} ms` +
          (overrun && !done ? " — over the cap, the rest compiles in the round" : ""),
      );
    }
    return done || overrun;
  }
}
