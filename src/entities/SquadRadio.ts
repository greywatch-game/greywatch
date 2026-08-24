/**
 * SquadRadio.ts — One team's shared board: the short list of things its bots
 * tell each other, and the one thing the team remembers between lives.
 * Owns: the freshest contact call per squad, and the hazard marks a team's own
 * deaths leave on the map.
 * Invariants: one per TEAM, held by BattleSystem, cleared on round start.
 * Everything here is a CUE and never knowledge — a call seeds the same decaying
 * `BotMemory` a gunshot does and can never become a target, because a radio
 * that hands out targets is a wallhack with an aerial on it. Nothing here
 * raycasts, allocates after construction, or reads the clock: time arrives as
 * `dt` and every position is jittered from the position itself, so a round
 * replays identically. A hazard is a fact about where THIS team's bodies fell,
 * never about where the enemy is.
 */
import { CONFIG } from "../config";

/**
 * Somewhere this team keeps dying, and the bearing it keeps dying to.
 *
 * The bearing is the useful half. Where a bot fell says which ground to be
 * careful on; where the round came FROM says which way to be looking while
 * crossing it, and it is already on every corpse (`Bot.deathFrom`) because the
 * ragdoll needs it.
 */
export interface Hazard {
  x: number;
  z: number;
  y: number;
  /** Where the killing fire came from. */
  fromX: number;
  fromZ: number;
  fromY: number;
  /** 0..1, how much this mark is worth. Deaths add, time takes away. */
  weight: number;
}

/** The freshest thing a squad has been told. */
interface Contact {
  x: number;
  y: number;
  z: number;
  /** Seconds of life left. */
  t: number;
}

export class SquadRadio {
  /**
   * One slot per squad, grown on demand and never shrunk. Overwritten rather
   * than queued: a squad acts on the freshest call it has, and a backlog of
   * where enemies used to be is exactly the stale knowledge the decay exists
   * to get rid of.
   */
  private readonly contacts: Contact[] = [];

  /**
   * Bounded at `radio.hazardMax`, and it stays bounded because deaths inside
   * `hazardMerge` reinforce the mark that is already there. A firefight on one
   * street corner is one strong mark, not six weak ones — which is both the
   * cheaper structure and the more useful memory.
   */
  private readonly hazards: Hazard[] = [];

  /** Wipes the board. A new round remembers nothing. */
  clear(): void {
    this.contacts.length = 0;
    this.hazards.length = 0;
  }

  /**
   * A bot has eyes on an enemy at `(x, y, z)`; its squad is told.
   *
   * Squad rather than team, because that is the unit that acts together and a
   * team-wide broadcast would turn one sighting into sixteen bots converging —
   * the herd this whole file is partly here to break up.
   */
  callContact(squad: number, x: number, y: number, z: number): void {
    while (this.contacts.length <= squad) {
      this.contacts.push({ x: 0, y: 0, z: 0, t: 0 });
    }
    const c = this.contacts[squad];
    c.x = x;
    c.y = y;
    c.z = z;
    c.t = CONFIG.bots.radio.contactMemory;
  }

  /** The squad's freshest call, or null once it has gone stale. */
  contactFor(squad: number): Contact | null {
    const c = this.contacts[squad];
    return c && c.t > 0 ? c : null;
  }

  /**
   * One of ours went down at `(x, y, z)`, to fire from `(fromX, fromY, fromZ)`.
   *
   * A death near an existing mark strengthens it and drags it a little toward
   * the new body rather than adding a second — see `hazards`. With the list
   * full and nothing near enough to merge into, the weakest mark is the one
   * that goes: what a team should be carrying is where it is dying NOW.
   */
  markHazard(
    x: number,
    y: number,
    z: number,
    fromX: number,
    fromY: number,
    fromZ: number,
  ): void {
    const r = CONFIG.bots.radio;
    const merge2 = r.hazardMerge * r.hazardMerge;
    let weakest = 0;
    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i];
      const dx = h.x - x;
      const dz = h.z - z;
      if (dx * dx + dz * dz <= merge2) {
        // Half-way toward the new body, so a mark drifts with a fight rather
        // than staying pinned to the first man who fell.
        h.x = (h.x + x) / 2;
        h.y = (h.y + y) / 2;
        h.z = (h.z + z) / 2;
        h.fromX = (h.fromX + fromX) / 2;
        h.fromY = (h.fromY + fromY) / 2;
        h.fromZ = (h.fromZ + fromZ) / 2;
        h.weight = Math.min(1, h.weight + 0.5);
        return;
      }
      if (h.weight < this.hazards[weakest].weight) weakest = i;
    }

    const fresh: Hazard = { x, y, z, fromX, fromY, fromZ, weight: 0.5 };
    if (this.hazards.length < r.hazardMax) this.hazards.push(fresh);
    else this.hazards[weakest] = fresh;
  }

  /**
   * The nearest place this team has been dying, within `radius` of `(x, z)`.
   *
   * Nearest rather than strongest: a bot is asking about the ground it is about
   * to walk onto, and the mark it is standing next to is the one that describes
   * it. The list is six entries long, so this is a walk and not a query.
   */
  hazardNear(x: number, z: number, radius: number): Hazard | null {
    let best: Hazard | null = null;
    let bestD2 = radius * radius;
    for (const h of this.hazards) {
      const dx = h.x - x;
      const dz = h.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = h;
      }
    }
    return best;
  }

  /**
   * Bleeds calls and marks off. Called once a frame with the frame's `dt`,
   * which is the only clock this file has — see the header.
   */
  decay(dt: number): void {
    for (const c of this.contacts) c.t = Math.max(0, c.t - dt);
    const fade = dt / CONFIG.bots.radio.hazardMemory;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.weight -= fade;
      // Swap-and-pop: the order of the list means nothing to any reader.
      if (h.weight <= 0) {
        this.hazards[i] = this.hazards[this.hazards.length - 1];
        this.hazards.pop();
      }
    }
  }
}
