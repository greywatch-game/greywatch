/**
 * net/NetShotQueue.ts — Other people's rounds off the wire, waiting for a
 * frame to draw them.
 * Owns: the pooled queue of pending shots, its cap, and the rule that a
 * frame's worth is what it holds — a frame that did not run drops its own.
 * Owns NO drawing: it never casts a round, flies a tracer or flashes a
 * muzzle, and never reads the roster or a hull. `Game` queues a shot from the
 * event that announced it and draws the queue inside the netplay frame
 * (`Game.drawNetShots`), which is the two halves `docs/game.md` says stay
 * behind.
 * Invariants: nothing on the event path allocates — the pool's high-water mark
 * is the busiest interval's shooter count, and the cap is the roster's own
 * ceiling, so a snapshot in which literally everybody fired still fits and
 * nothing beyond one can accumulate. The SLOT is queued rather than the body:
 * where a round leaves from is read at draw time, off the pose that frame
 * actually puts on screen.
 * Never: be drawn from outside a frame that steps the tracers, or be carried
 * across a frame that did not run — `Game.tick` clears it whichever state ran.
 */
import { CONFIG } from "../config";

/**
 * One slot's `fire` event, waiting for the frame that will draw it.
 *
 * The SLOT and not the body, because where a round leaves from is read at draw
 * time off the pose that frame puts on screen.
 */
export interface PendingShot {
  /** The roster slot that fired — or, when `gun` names one, the HULL index. */
  slot: number;
  /**
   * Which barrel: a body's weapon (`body`), or one of a hull's two guns. A
   * hull's round is drawn off the hull the snapshot posed rather than off a
   * rig, because nobody is holding it.
   */
  gun: "body" | "mg" | "cannon";
  /** Rounds that slot spent inside the snapshot interval, at least one. */
  rounds: number;
  /** Seconds between them, the interval laid back out — see `Game.onNetFire`. */
  spacing: number;
  /** How far they reach: the named weapon's, or a bot's flat round. */
  range: number;
}

/**
 * The PICTURE of a burst somebody else fired, PUT IN A QUEUE rather than
 * drawn when the event lands.
 *
 * Offline a tracer is `CombatSystem.fire` throwing one off as it resolves
 * the round, because this machine resolves every round in the village. In a
 * match it resolves exactly one shooter's — its own — so every other body
 * fired a round that made a noise, moved a minimap blip and left the barrel
 * as nothing at all: the tell that says WHERE fire is coming from, which is
 * most of what a tracer is for, was the local player's alone.
 *
 * **It is a queue because an event is not a frame.** Server messages are
 * dispatched off the socket, so a shot is queued whenever a packet lands and
 * in whatever state the game is in — and a tracer is a streak
 * `CombatSystem.update` flies out of the barrel and hides again. Spawned in a
 * state that does not step it, it is not a missing effect but a HAUNTING: a
 * lit dot hanging in the air where the muzzle was, one per shot, for the rest
 * of the round (see `docs/multiplayer.md`). A sound can be fired from anywhere
 * and this cannot, so it waits for `Game.drawNetShots`, which runs inside the
 * netplay frame — and `Game.tick` drops whatever a frame that never ran left
 * behind.
 */
export class NetShotQueue {
  /**
   * The pool. Pooled for `BattleSystem.flashPool`'s reason — this is emptied
   * every frame, so nothing on the event path allocates past the busiest
   * interval's shooter count.
   */
  private readonly shots: PendingShot[] = [];
  /** How many of the pool are in use. */
  private count = 0;

  /** How many shots are waiting. */
  get length(): number {
    return this.count;
  }

  /** The `i`th shot waiting, oldest first. Valid until the next `clear`. */
  at(i: number): PendingShot {
    return this.shots[i];
  }

  /** Queues a burst. Refused, silently, past the roster's ceiling. */
  push(
    slot: number,
    rounds: number,
    spacing: number,
    range: number,
    gun: PendingShot["gun"],
  ): void {
    // A frame's worth is what this holds, and a frame that did not run drops
    // its own. The cap is what makes that true of a frame that ran late as
    // well: it is the roster's own ceiling, so a snapshot in which literally
    // everybody fired still fits and nothing beyond one can accumulate.
    if (this.count >= CONFIG.bots.maxPerTeam * 2) return;
    const shot = (this.shots[this.count++] ??= {
      slot: 0,
      gun: "body",
      rounds: 0,
      spacing: 0,
      range: 0,
    });
    shot.slot = slot;
    shot.gun = gun;
    shot.rounds = rounds;
    shot.spacing = spacing;
    shot.range = range;
  }

  /** Drops everything waiting — drawn this frame, or never to be. */
  clear(): void {
    this.count = 0;
  }
}
