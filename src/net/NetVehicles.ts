/**
 * net/NetVehicles.ts — Somebody else's armour, drawn from the wire.
 * Owns: one interpolation buffer per HARDSTANDING, and the state each hull
 * should be in at the client's render time.
 * Owns NO hull. The `Tank` objects are `VehicleSystem`'s exactly as they are
 * offline — this class produces the six numbers `Tank.updateRemote` takes and
 * hands them to `Game`, which is the only place that knows both about a fleet
 * and about a socket. It is `NetRoster`'s job done for the one thing in the
 * game that is a moving `solid` mesh.
 * Invariants: nothing here drives, damages, destroys or respawns anything.
 * Every transition a hull makes in a match — a fresh one arriving, one
 * burning, a wreck being taken away — arrived from the authority, and this
 * class only reports what it was told.
 *
 * **The local player's own hull is not in here**, and that is the same filter
 * `NetGrenades` applies to the thrower's own grenade rather than an omission:
 * a driver simulates their own tank exactly as they simulate their own body
 * (see `DriveMessage`), and drawing the authority's copy of it as well would
 * be two tanks a tenth of a second apart with one set of tracks between them.
 * `VehicleState.by` is what says which one that is.
 *
 * A hull that stops appearing in snapshots has been taken off the field, and
 * it is reported gone on the snapshot that drops it rather than played out to
 * the end of its buffer — `NetGrenades`' rule, for the reason that class
 * gives. The cost is the last `interpDelay` of a wreck standing still, which
 * is nothing at all.
 */
import type { RemoteHull } from "../systems/VehicleSystem";
import type { Snapshot } from "./protocol";

/** One received sample, with the server time it describes. */
interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  tyaw: number;
  gun: number;
}

/** How many samples to keep. Two is the minimum to interpolate; more absorbs jitter. */
const BUFFER = 8;

/** One hardstanding's hull, as this client last heard about it. */
interface Ghost {
  /** True while the authority is still sending this hull at all. */
  present: boolean;
  alive: boolean;
  /** What is left of it. See `VehicleState.hp`. */
  hp: number;
  /** The roster slot inside it, or -1. See `VehicleState.by`. */
  by: number;
  /**
   * True once at least one sample has been resolved, which is what `Game`
   * keys a hull's first PLACEMENT off.
   *
   * A ghost claimed on a socket callback and posed on the next frame would
   * otherwise be put on the field at wherever the pooled `Tank` last stood —
   * the hardstanding for a hull nobody has driven, and the spot the last one
   * burned for one that has. Both read as a tank flashing across the map.
   */
  posed: boolean;
  readonly samples: Sample[];
  /** Where the interpolation put it this frame. Reused; never allocated. */
  readonly state: RemoteHull;
}

export class NetVehicles {
  /**
   * One entry per hardstanding, grown on demand and never shrunk.
   *
   * Indexed by `VehicleState.i`, which is a hull's identity for the whole
   * round — so this is the same arrangement `NetRoster` has with its slots,
   * with the one difference that how many there are is the MAP's rather than
   * the roster's, and a rotation can change it.
   */
  private readonly ghosts: Ghost[] = [];

  /** Which hulls this snapshot mentioned. Reused; never a fresh Set. */
  private readonly seen = new Set<number>();

  /**
   * Takes a snapshot's hulls: a sample for every one still on the field, and
   * the end of every one that is not.
   *
   * `localSlot` is this client's own roster slot, and the hull it is sitting
   * in is skipped — see the header.
   */
  applySnapshot(snap: Snapshot, localSlot: number): void {
    this.seen.clear();
    for (const v of snap.vehicles ?? []) {
      const ghost = this.ghost(v.i);
      this.seen.add(v.i);
      // Occupancy and life are STATE and are taken whoever is driving,
      // including from the hull under this client's own feet: a driver still
      // has to be told by the authority that their tank has burned. It is only
      // the POSITION that a driver owns, which is the sample below.
      ghost.present = true;
      ghost.alive = v.alive;
      ghost.hp = v.hp;
      ghost.by = v.by;
      if (v.by === localSlot) continue;
      push(ghost.samples, {
        t: snap.now,
        x: v.p[0],
        y: v.p[1],
        z: v.p[2],
        yaw: v.yaw,
        tyaw: v.tyaw,
        gun: v.gun,
      });
    }
    for (const [i, ghost] of this.ghosts.entries()) {
      if (ghost.present && !this.seen.has(i)) this.release(ghost);
    }
  }

  /**
   * Resolves every hull for `renderTime` — a server-clock instant the caller
   * has already put behind the newest sample.
   *
   * Takes no `dt` for `NetGrenades.update`'s reason: nothing here integrates
   * against frame time. What DOES integrate — the lean, the springs, the
   * belts, the masts — is `Tank.updateRemote`'s, off the positions this
   * produces, and it takes the frame's own `dt` there.
   */
  update(renderTime: number): void {
    for (const ghost of this.ghosts) {
      if (!ghost.present || ghost.samples.length === 0) continue;
      const [a, b, blend] = bracket(ghost.samples, renderTime);
      const s = ghost.state;
      s.x = a.x + (b.x - a.x) * blend;
      s.y = a.y + (b.y - a.y) * blend;
      s.z = a.z + (b.z - a.z) * blend;
      // The three angles go the SHORT way round, which the positions do not
      // have to worry about: a turret crossing north interpolates from 3.1 to
      // -3.1 radians, and lerped straight that is a gun spinning most of a
      // full turn backwards inside one snapshot interval.
      s.yaw = a.yaw + wrap(b.yaw - a.yaw) * blend;
      s.turretYaw = a.tyaw + wrap(b.tyaw - a.tyaw) * blend;
      s.gunPitch = a.gun + (b.gun - a.gun) * blend;
      ghost.posed = true;
    }
  }

  /**
   * Where hull `i` should be this frame, or null for one this client is not
   * being told about — a hull off the field, a hull whose first sample has not
   * been resolved yet, and the one the local player is driving.
   *
   * This is what `VehicleOrders.remoteFor` answers with, so null is read as
   * "simulate this one normally" — which is exactly right for the local hull
   * and harmless for the other two, since neither is on screen.
   */
  stateFor(i: number): RemoteHull | null {
    const ghost = this.ghosts[i];
    return ghost && ghost.present && ghost.posed && ghost.samples.length > 0
      ? ghost.state
      : null;
  }

  /** Is hull `i` on the field at all? False before the first snapshot names it. */
  present(i: number): boolean {
    return this.ghosts[i]?.present ?? false;
  }

  /** Is it a live hull rather than a wreck? Meaningless while it is not present. */
  alive(i: number): boolean {
    return this.ghosts[i]?.alive ?? false;
  }

  /** What is left of hull `i`, as the authority last stated it. */
  health(i: number): number {
    return this.ghosts[i]?.hp ?? 0;
  }

  /** The roster slot inside hull `i`, or -1. The one source for occupancy. */
  occupant(i: number): number {
    return this.ghosts[i]?.by ?? -1;
  }

  /**
   * Is this roster slot inside any hull?
   *
   * The inverse lookup, over at most a handful of hardstandings, and it is a
   * scan rather than a second table for `Match.occupantOf`'s reason: one fact
   * kept in two places is one that can go stale, and the one that would be
   * wrong here decides whether a body is drawn standing in the street.
   */
  riding(slot: number): boolean {
    for (const ghost of this.ghosts) {
      if (ghost.present && ghost.by === slot) return true;
    }
    return false;
  }

  /**
   * Drops every hull. Called when the round under them changes — a fleet whose
   * map has been rebuilt is one nothing will ever send the end of, and its
   * buffers hold positions on terrain that no longer exists.
   */
  reset(): void {
    for (const ghost of this.ghosts) this.release(ghost);
  }

  private ghost(i: number): Ghost {
    let ghost = this.ghosts[i];
    if (ghost) return ghost;
    // Filled rather than pushed at, because a snapshot may name hull 1 before
    // hull 0 on the frame one of them is away being rebuilt, and a sparse
    // array would put the wrong hull at the wrong index for the rest of the
    // round.
    for (let n = this.ghosts.length; n <= i; n++) {
      this.ghosts[n] = {
        present: false,
        alive: false,
        hp: 0,
        by: -1,
        posed: false,
        samples: [],
        state: { x: 0, y: 0, z: 0, yaw: 0, turretYaw: 0, gunPitch: 0 },
      };
    }
    ghost = this.ghosts[i];
    return ghost;
  }

  private release(ghost: Ghost): void {
    ghost.present = false;
    ghost.alive = false;
    ghost.hp = 0;
    ghost.by = -1;
    ghost.posed = false;
    ghost.samples.length = 0;
  }
}

/**
 * Appends a sample, dropping anything not newer than what is already held —
 * `NetGrenades.push`'s rule and its reason: a reconnect can replay an older
 * tick, and one stale sample in the middle of a buffer drags a hull backwards
 * along the street.
 */
function push(samples: Sample[], sample: Sample): void {
  const newest = samples[samples.length - 1];
  if (newest && sample.t <= newest.t) return;
  samples.push(sample);
  if (samples.length > BUFFER) samples.shift();
}

/** The shortest way round a circle, in radians. */
function wrap(d: number): number {
  let a = d;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * The two samples `t` falls between, and how far between them it is. Clamps at
 * both ends rather than extrapolating — `NetSoldier.bracket`'s rule, and it
 * matters more here than anywhere: a hull that kept driving because its
 * packets stopped is a solid mesh coasting through a wall, and it would be
 * yanked back through it when they resumed.
 */
function bracket(s: Sample[], t: number): [Sample, Sample, number] {
  if (t <= s[0].t) return [s[0], s[0], 0];
  const last = s[s.length - 1];
  if (t >= last.t) return [last, last, 0];
  for (let i = 0; i < s.length - 1; i++) {
    if (t <= s[i + 1].t) {
      const span = s[i + 1].t - s[i].t;
      return [s[i], s[i + 1], span > 0 ? (t - s[i].t) / span : 0];
    }
  }
  return [last, last, 0];
}
