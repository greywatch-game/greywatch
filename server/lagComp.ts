/**
 * server/lagComp.ts — What every body looked like a moment ago, so a shot can
 * be resolved against what the shooter actually saw.
 * Owns: the per-slot position history and the rewind/restore pair around a
 * shot. Owns no combat rules — it moves hit spheres and puts them back, and
 * `CombatSystem` decides what a ray finds.
 * Invariants: `resolve` is the ONLY way to rewind. It restores in a `finally`,
 * which is the whole reason it takes a callback rather than exposing
 * `rewind()`/`restore()` as a pair somebody has to remember to balance. A
 * throw between the two would leave sixteen bodies permanently displaced, and
 * nothing would report it — every subsequent shot, every LOS test and every
 * capture-zone check would silently use ghost positions.
 *
 * **Why this exists.** A client draws other bodies `INTERP_DELAY_MS` behind the
 * server, and its own packets took time to arrive on top of that. So when a
 * player puts their crosshair on someone and fires, that someone has already
 * moved on the server. Resolving the ray against the present would mean a
 * player has to lead every target by their own ping, which is the single most
 * complained-about thing in a networked shooter. Rewinding costs the opposite
 * unfairness — occasionally being shot after you thought you reached cover —
 * and that is the trade every shooter of this kind makes deliberately.
 *
 * The window is bounded by `REWIND_WINDOW_MS`. A client claiming a render time
 * older than that is clamped rather than honoured: unbounded rewind lets
 * someone shoot at where you stood a second ago.
 */
import { Vector3 } from "@babylonjs/core";
import type { Hittable } from "../src/systems/CombatSystem";
import { REWIND_WINDOW_MS, TICK_HZ } from "../src/net/protocol";

/** One body at one instant. Only what resolving a shot reads. */
interface Frame {
  t: number;
  cx: number;
  cy: number;
  cz: number;
  ex: number;
  ey: number;
  ez: number;
}

/** Enough frames to cover the window at the tick rate, plus slack. */
const DEPTH = Math.ceil((REWIND_WINDOW_MS / 1000) * TICK_HZ) + 4;

/** A body being tracked, and where it really is while it is rewound. */
interface Tracked {
  body: Hittable;
  frames: Frame[];
  head: number;
  count: number;
  /** The present, saved on rewind so `restore` needs no recomputation. */
  readonly savedCenter: Vector3;
  readonly savedEye: Vector3;
}

export class LagComp {
  private readonly tracked: Tracked[] = [];

  /** Starts tracking a body. Idempotent. */
  track(body: Hittable): void {
    if (this.tracked.some((t) => t.body === body)) return;
    this.tracked.push({
      body,
      // Pre-allocated ring: this records sixteen bodies sixty times a second
      // for the life of a round, and a growing array would be a steady drip of
      // garbage for a fixed-size window.
      frames: Array.from({ length: DEPTH }, () => ({
        t: 0, cx: 0, cy: 0, cz: 0, ex: 0, ey: 0, ez: 0,
      })),
      head: 0,
      count: 0,
      savedCenter: new Vector3(),
      savedEye: new Vector3(),
    });
  }

  untrack(body: Hittable): void {
    const i = this.tracked.findIndex((t) => t.body === body);
    if (i >= 0) this.tracked.splice(i, 1);
  }

  /** Records where everything is right now. Called once per simulation tick. */
  record(now: number): void {
    for (const t of this.tracked) {
      const f = t.frames[t.head];
      f.t = now;
      f.cx = t.body.center.x;
      f.cy = t.body.center.y;
      f.cz = t.body.center.z;
      f.ex = t.body.eyePos.x;
      f.ey = t.body.eyePos.y;
      f.ez = t.body.eyePos.z;
      t.head = (t.head + 1) % DEPTH;
      if (t.count < DEPTH) t.count++;
    }
  }

  /**
   * Runs `fn` with every tracked body moved back to where it was at `t`.
   *
   * A callback, not a pair of methods, so the restore cannot be skipped or
   * forgotten — see the note at the top of this file for what that would cost.
   * `except` is the shooter, who is never rewound: they are resolving their own
   * shot from where they say they are now, and moving them would put the ray's
   * origin somewhere they never stood.
   */
  resolve<T>(t: number, except: Hittable | null, fn: () => T): T {
    const now = Date.now();
    // Clamped, not trusted. An unbounded rewind is a licence to shoot at where
    // somebody stood a second ago.
    const at = Math.max(t, now - REWIND_WINDOW_MS);

    const moved: Tracked[] = [];
    for (const track of this.tracked) {
      if (track.body === except || track.count === 0) continue;
      track.savedCenter.copyFrom(track.body.center);
      track.savedEye.copyFrom(track.body.eyePos);
      this.apply(track, at);
      moved.push(track);
    }

    try {
      return fn();
    } finally {
      for (const track of moved) {
        track.body.center.copyFrom(track.savedCenter);
        track.body.eyePos.copyFrom(track.savedEye);
      }
    }
  }

  /** Moves one body to where it was at `t`, interpolating between frames. */
  private apply(track: Tracked, t: number): void {
    const { frames, count, head } = track;
    // Oldest first, walking the ring.
    const at = (i: number) => frames[(head - count + i + DEPTH * 2) % DEPTH];

    const oldest = at(0);
    const newest = at(count - 1);
    if (t <= oldest.t) return this.write(track, oldest, oldest, 0);
    if (t >= newest.t) return this.write(track, newest, newest, 0);

    for (let i = 0; i < count - 1; i++) {
      const a = at(i);
      const b = at(i + 1);
      if (t <= b.t) {
        const span = b.t - a.t;
        return this.write(track, a, b, span > 0 ? (t - a.t) / span : 0);
      }
    }
    this.write(track, newest, newest, 0);
  }

  private write(track: Tracked, a: Frame, b: Frame, blend: number): void {
    track.body.center.set(
      a.cx + (b.cx - a.cx) * blend,
      a.cy + (b.cy - a.cy) * blend,
      a.cz + (b.cz - a.cz) * blend,
    );
    track.body.eyePos.set(
      a.ex + (b.ex - a.ex) * blend,
      a.ey + (b.ey - a.ey) * blend,
      a.ez + (b.ez - a.ez) * blend,
    );
  }
}
