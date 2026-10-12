/**
 * src/sim/events.ts — What the simulation SAYS happened: one typed,
 * allocation-free event ring the core writes and its host drains.
 * Owns: the event vocabulary (`EV`), each kind's payload layout, the ring the
 * core appends to (`EventRing`), the cursor a host reads a drain through
 * (`EventCursor`), and the one decoder (`decode`/`toObjects`).
 * Invariants: **every event carries every number it states, captured at
 * EMISSION** — a reader never goes back to a live object to finish the
 * sentence, because by the time it reads, the object has moved on (a body's
 * health regenerates, a respawn clock runs, a scratch vector is overwritten by
 * the next round). Events are in EMISSION ORDER, which is the order the
 * immediate callbacks they replaced used to run in — `Match` relies on it for
 * the order of its outgoing queue and `simulate` for its fight hash.
 * Never: hold an object reference, a string or a closure. A record is a kind
 * byte, a tick and `STRIDE` float64s, plus a run of int32s in the side array
 * for the one variable-length list (a round's broken panes) — so a ring is
 * three typed arrays and a fourth, and can be copied or transferred whole.
 *
 * **Why a ring and not callbacks** (`BABYLON_EXIT.md` X2.5a C2): a callback
 * hands the reader the live object and lets it read whatever it likes off it,
 * whenever it likes — `Match` read `player.health`, `respawnT` and
 * `bot.deathFrom` inside its handlers. That works in one process and is
 * exactly what cannot cross a worker boundary or a `structuredClone`, which is
 * where the core is headed. A ring states the facts once, as numbers, and the
 * host decides what to do with them afterwards.
 *
 * **Allocation**: writing allocates nothing. The arrays DOUBLE when a step
 * emits more than they hold — rare, amortised, and the only allocation on the
 * write path. `drain` SWAPS the ring's arrays with the cursor's, so the cursor
 * holds a stable copy of the drained events until the NEXT drain and the core
 * writes on into the cursor's old arrays. `decode` allocates (it builds an
 * object); a hot reader switches on `EventCursor.kind` first and decodes only
 * what it will keep.
 *
 * ## The vocabulary
 *
 * Slots are roster slots (a bot's pool index, a person's seat — the same
 * number); `tank` is a hardstanding index into `VehicleSystem.hulls`; `team`
 * is the authority's team index; vectors are three consecutive floats; a
 * boolean is 0 or 1; enumerated strings are indices into the code tables
 * below (`DAMAGE_KINDS`, `DEATH_CAUSES`, `IMPACT_KINDS`, `SCORE_KINDS`,
 * `VICTIM_KINDS`, `SURFACES`, `REFUSED_ITEMS`). Field order is the order in `decode`.
 *
 * | kind | payload | raised by |
 * | --- | --- | --- |
 * | `round` | shooter, muzzle·3, to·3, impact, normal·3 (NaN when none), mark | `CombatSystem.onRound`, every round from every shooter; `shooter` -1 when no one is named |
 * | `botFired` | slot, muzzle·3 | `BattleSystem.onBotFired` |
 * | `botReload` | slot | `BattleSystem.onBotReloaded` |
 * | `botStep` | slot | `BattleSystem.onBotStepped` |
 * | `nearMiss` | slot, at·3 | a round passed a PERSON (`CombatSystem.onNearMiss`) |
 * | `hit` | shooter, victim, victimKind, killed, head, cause | a person's round (`resolveShot`), a hull gun, a blast, a burn, the tracks |
 * | `damaged` | slot, team, amount, hasFrom, from·3, killed, kind, health, respawnIn | a PERSON took a hit (`SimPlayer.onDamaged`) |
 * | `botDown` | slot, killer, by, cause, credited, head, from·3, damage, kind | a bot died (`KillLedger.botDown`) — the killfeed and the corpse |
 * | `death` | slot, cause, credited | every body's death on the board (`registerDeath`); a person's cause and credit are filed into it by the blow's own door (`amendDeath`) before the call returns |
 * | `spawned` | slot, pos·3, yaw | a person deployed |
 * | `award` | slot, kind, points, person | `ScoreBook.onAward`; `person` is whether a SimPlayer held the slot |
 * | `captured` | point, by | a flag changed hands (after its awards) |
 * | `neutralised` | point, by | a flag went neutral (after its awards) |
 * | `roundOver` | winner | the tick the round ended, once |
 * | `blast` | at·3, power, surface, normal·3 | `GrenadeSystem.onExploded`: every blast |
 * | `ignited` | id, at·3, surface, normal·3 | a molotov caught |
 * | `burntOut` | id | the fire `ignited` named went out |
 * | `rocket` | slot, from·3, dir·3 | a rocket left a tube (a person's or a bot's) |
 * | `glass` | at·3, dir·3, + ints: the panes | a round broke one or more panes; `at` is the first crossing |
 * | `cannon` | tank, muzzle·3, dir·3 | a main gun fired |
 * | `mg` | tank, muzzle·3, dir·3 | a cupola gun fired one round |
 * | `crushed` | tank, by, victim, victimKind | the tracks killed a body |
 * | `hullPlaced` / `hullKicked` / `hullWrecked` | tank, team | the hull's `HullPicture` hooks: put on a pad, main gun's kick, burned |
 * | `hullDestroyed` / `hullRespawned` | tank, team | `VehicleSystem.onDestroyed` / `onRespawned` |
 * | `seat` | slot, tank, seat, at·3, yaw | the answer to a person's mount/dismount, and the hull burning under them; `at`/`yaw` mean something only when `tank` is -1 |
 * | `ordnanceRefused` | slot, item | a person's rocket (0), mine (1) or throw (2) was refused — by the pool, or because the body was dead, seated or out of them — `REFUSED_ITEMS` |
 *
 * **Glass is ONE event, not three.** `GlassSystem`'s `onBroken`/`onBreak`/
 * `onCleared` are per pane and describe what a pane's own VIEW must do; the
 * page applies a `glass` event through its own `GlassSystem`, which raises
 * those three for itself — exactly as a netplay client does with the wire's
 * `glass` event. So the core says what broke, once.
 */
import { CONFIG } from "../config";
import type { Vector3Like } from "../math";
import type { Team } from "../entities/Combatant";
import type { DamageKind, ImpactKind } from "../systems/CombatSystem";
import type { DeathCause } from "../systems/killRules";
import type { ScoreKind } from "../systems/ScoreBook";

/** Every kind of event, as the byte a record carries. 0 is never written. */
export const EV = {
  round: 1,
  botFired: 2,
  botReload: 3,
  botStep: 4,
  nearMiss: 5,
  hit: 6,
  damaged: 7,
  botDown: 8,
  death: 9,
  spawned: 10,
  award: 11,
  captured: 12,
  neutralised: 13,
  roundOver: 14,
  blast: 15,
  ignited: 16,
  burntOut: 17,
  rocket: 18,
  glass: 19,
  cannon: 20,
  mg: 21,
  crushed: 22,
  hullPlaced: 23,
  hullKicked: 24,
  hullWrecked: 25,
  hullDestroyed: 26,
  hullRespawned: 27,
  seat: 28,
  ordnanceRefused: 29,
} as const;

export type EventName = keyof typeof EV;
export type EventKind = (typeof EV)[EventName];

/** float64s per record — the widest payload (`round`) and no wider. */
export const STRIDE = 12;

// ---------------------------------------------------------------------------
// Code tables. Each is a `Record` over its union, so a new member does not
// compile until it has a code, and the inverse array is derived from it.

const DAMAGE_CODE = {
  bullet: 0,
  blast: 1,
  shell: 2,
  crush: 3,
  fire: 4,
} as const satisfies Record<DamageKind, number>;
export const DAMAGE_KINDS = inverse<DamageKind>(DAMAGE_CODE);

/** The code a `DamageKind` is written as — here and in the frame's `deathKind`. */
export function damageCode(kind: DamageKind): number {
  return DAMAGE_CODE[kind];
}

const CAUSE_CODE = {
  round: 0,
  blast: 1,
  fire: 2,
  tracks: 3,
  shell: 4,
  mg: 5,
  crew: 6,
  other: 7,
} as const satisfies Record<DeathCause, number>;
export const DEATH_CAUSES = inverse<DeathCause>(CAUSE_CODE);

const IMPACT_CODE = {
  flesh: 0,
  ground: 1,
  hard: 2,
  glass: 3,
} as const satisfies Record<ImpactKind, number>;
export const IMPACT_KINDS = inverse<ImpactKind>(IMPACT_CODE);

/** The award table's own order — a new award is a row in `config/score.ts`. */
export const SCORE_KINDS = Object.keys(CONFIG.score) as ScoreKind[];

/** What a `hit` or `crushed` landed on: a bot, a person, a hull, or nothing on the roster. */
export type VictimKind = "bot" | "person" | "hull" | "none";
const VICTIM_CODE = {
  bot: 0,
  person: 1,
  hull: 2,
  none: 3,
} as const satisfies Record<VictimKind, number>;
export const VICTIM_KINDS = inverse<VictimKind>(VICTIM_CODE);

/** What a person's `ordnanceRefused` was refused: the tube, the mine, or a throw. */
export type RefusedItem = "rocket" | "mine" | "grenade";
const REFUSED_CODE = { rocket: 0, mine: 1, grenade: 2 } as const satisfies Record<RefusedItem, number>;
export const REFUSED_ITEMS = inverse<RefusedItem>(REFUSED_CODE);

/** The code a refused `item` is written as. */
export function refusedCode(item: RefusedItem): number {
  return REFUSED_CODE[item];
}

/** What a blast or a fire went off ON — `BlastGround.surface`. */
export type Surface = "ground" | "hard";
const SURFACE_CODE = { ground: 0, hard: 1 } as const satisfies Record<Surface, number>;
export const SURFACES = inverse<Surface>(SURFACE_CODE);

function inverse<K extends string>(codes: Record<K, number>): readonly K[] {
  const out: K[] = [];
  for (const key of Object.keys(codes) as K[]) out[codes[key]] = key;
  return out;
}

/** The code a `VictimKind` is written as — for the core's victim helper. */
export function victimCode(kind: VictimKind): number {
  return VICTIM_CODE[kind];
}

// ---------------------------------------------------------------------------
// The ring.

/**
 * The core's half: appended to in emission order, drained by the host.
 *
 * Not circular in the wrapping sense — a drain takes EVERYTHING written since
 * the last one, so the write head simply returns to zero — and that is the
 * whole contract: a host drains after every call it makes on the core, and
 * the ring never holds more than one step's worth.
 */
export class EventRing {
  kinds: Uint8Array;
  ticks: Uint32Array;
  data: Float64Array;
  ints: Int32Array;
  /** Records written since the last drain. */
  count = 0;
  /** Int32s written into `ints` since the last drain. */
  intCount = 0;

  constructor(capacity = 1024, intCapacity = 256) {
    this.kinds = new Uint8Array(capacity);
    this.ticks = new Uint32Array(capacity);
    this.data = new Float64Array(capacity * STRIDE);
    this.ints = new Int32Array(intCapacity);
  }

  /**
   * Opens one record and returns its OFFSET into `data`, where its payload
   * starts. Read `data` AFTER this call: growing replaces the array. Unused
   * payload fields are zeroed so a record never carries a previous one's
   * numbers.
   */
  open(kind: EventKind, tick: number): number {
    if (this.count >= this.kinds.length) this.grow();
    const i = this.count++;
    this.kinds[i] = kind;
    this.ticks[i] = tick;
    const o = i * STRIDE;
    this.data.fill(0, o, o + STRIDE);
    return o;
  }

  /** Copies a list into the side array and returns where it starts. */
  pushInts(list: readonly number[]): number {
    const start = this.intCount;
    const need = start + list.length;
    if (need > this.ints.length) {
      let size = Math.max(64, this.ints.length * 2);
      while (size < need) size *= 2;
      const ints = new Int32Array(size);
      ints.set(this.ints.subarray(0, start));
      this.ints = ints;
    }
    for (let i = 0; i < list.length; i++) this.ints[start + i] = list[i];
    this.intCount = need;
    return start;
  }

  private grow(): void {
    const size = Math.max(64, this.kinds.length * 2);
    const kinds = new Uint8Array(size);
    kinds.set(this.kinds);
    const ticks = new Uint32Array(size);
    ticks.set(this.ticks);
    const data = new Float64Array(size * STRIDE);
    data.set(this.data);
    this.kinds = kinds;
    this.ticks = ticks;
    this.data = data;
  }

  /**
   * Hands everything written since the last drain to `out`, by SWAPPING
   * arrays — nothing is copied and nothing allocated — and starts the ring
   * again at zero. `out` keeps the drained events until it is drained into
   * again.
   */
  drainInto(out: EventCursor): void {
    const { kinds, ticks, data, ints } = out;
    out.kinds = this.kinds;
    out.ticks = this.ticks;
    out.data = this.data;
    out.ints = this.ints;
    out.count = this.count;
    out.intCount = this.intCount;
    // A cursor that has never been drained into holds empty arrays; the ring
    // keeps its own capacity rather than taking those.
    if (kinds.length > 0) {
      this.kinds = kinds;
      this.ticks = ticks;
      this.data = data;
      this.ints = ints;
    } else {
      this.kinds = new Uint8Array(out.kinds.length);
      this.ticks = new Uint32Array(out.ticks.length);
      this.data = new Float64Array(out.data.length);
      this.ints = new Int32Array(out.ints.length);
    }
    this.count = 0;
    this.intCount = 0;
  }

  /**
   * Appends `count` records and `intCount` side ints, laid out as a drain
   * hands them over (a cursor's arrays, or the shared copy of one a Worker
   * publishes — `src/sim/publication.ts`), after whatever this ring already
   * holds. The ONE place a record is moved between rings, because one kind
   * points into the side array: a `glass` record's start is rebased onto
   * where its panes land here. Allocates only when it grows.
   */
  append(
    kinds: Uint8Array,
    ticks: Uint32Array,
    data: Float64Array,
    ints: Int32Array,
    count: number,
    intCount: number,
  ): void {
    if (count === 0 && intCount === 0) return;
    const base = this.intCount;
    const needInts = base + intCount;
    if (needInts > this.ints.length) {
      let size = Math.max(64, this.ints.length * 2);
      while (size < needInts) size *= 2;
      const grown = new Int32Array(size);
      grown.set(this.ints.subarray(0, base));
      this.ints = grown;
    }
    for (let i = 0; i < intCount; i++) this.ints[base + i] = ints[i];
    this.intCount = needInts;
    for (let i = 0; i < count; i++) {
      const o = this.open(kinds[i] as EventKind, ticks[i]);
      const from = i * STRIDE;
      const d = this.data;
      for (let k = 0; k < STRIDE; k++) d[o + k] = data[from + k];
      if (kinds[i] === EV.glass) d[o + 6] += base;
    }
  }
}

/**
 * The host's half: one drain's events, read by index. Valid until the next
 * drain into it. The arrays are plain typed arrays, so a cursor can be copied
 * whole — into shared memory by a Worker's publication and out again into the
 * page's own ring (`EventRing.append`, `BABYLON_EXIT.md` X2.5b).
 */
export class EventCursor {
  kinds: Uint8Array = new Uint8Array(0);
  ticks: Uint32Array = new Uint32Array(0);
  data: Float64Array = new Float64Array(0);
  ints: Int32Array = new Int32Array(0);
  count = 0;
  /** Side ints in `ints` belonging to this drain — what a copy of it must carry. */
  intCount = 0;

  kind(i: number): EventKind {
    return this.kinds[i] as EventKind;
  }

  tick(i: number): number {
    return this.ticks[i];
  }

  /** Field `field` of record `i`'s payload. */
  f(i: number, field: number): number {
    return this.data[i * STRIDE + field];
  }
}

// ---------------------------------------------------------------------------
// Writers — one per kind, so each payload's layout is stated once, here.
// Every argument is a number or a vector READ INSIDE the call.

function v3(d: Float64Array, o: number, v: Vector3Like): void {
  d[o] = v.x;
  d[o + 1] = v.y;
  d[o + 2] = v.z;
}

/** Returns the record's offset, so the core can name the shooter afterwards (`setRoundShooter`). */
export function emitRound(
  r: EventRing,
  tick: number,
  shooter: number,
  muzzle: Vector3Like,
  to: Vector3Like,
  impact: ImpactKind | null,
  normal: Vector3Like | null,
  mark: boolean,
): number {
  const o = r.open(EV.round, tick);
  const d = r.data;
  d[o] = shooter;
  v3(d, o + 1, muzzle);
  v3(d, o + 4, to);
  d[o + 7] = impact === null ? -1 : IMPACT_CODE[impact];
  if (normal) v3(d, o + 8, normal);
  else d[o + 8] = d[o + 9] = d[o + 10] = NaN;
  d[o + 11] = mark ? 1 : 0;
  return o;
}

/** Names the shooter of a `round` written with -1 — a bot's, named by its `botFired`. */
export function setRoundShooter(r: EventRing, offset: number, shooter: number): void {
  r.data[offset] = shooter;
}

export function emitSlotAt(
  r: EventRing,
  kind: typeof EV.botFired | typeof EV.nearMiss,
  tick: number,
  slot: number,
  at: Vector3Like,
): void {
  const o = r.open(kind, tick);
  r.data[o] = slot;
  v3(r.data, o + 1, at);
}

export function emitSlot(
  r: EventRing,
  kind: typeof EV.botReload | typeof EV.botStep,
  tick: number,
  slot: number,
): void {
  r.data[r.open(kind, tick)] = slot;
}

export function emitHit(
  r: EventRing,
  tick: number,
  shooter: number,
  victim: number,
  victimKind: number,
  killed: boolean,
  head: boolean,
  cause: DeathCause,
): void {
  const o = r.open(EV.hit, tick);
  const d = r.data;
  d[o] = shooter;
  d[o + 1] = victim;
  d[o + 2] = victimKind;
  d[o + 3] = killed ? 1 : 0;
  d[o + 4] = head ? 1 : 0;
  d[o + 5] = CAUSE_CODE[cause];
}

export function emitDamaged(
  r: EventRing,
  tick: number,
  slot: number,
  team: number,
  amount: number,
  from: Vector3Like | undefined,
  killed: boolean,
  kind: DamageKind,
  health: number,
  respawnIn: number,
): void {
  const o = r.open(EV.damaged, tick);
  const d = r.data;
  d[o] = slot;
  d[o + 1] = team;
  d[o + 2] = amount;
  d[o + 3] = from ? 1 : 0;
  if (from) v3(d, o + 4, from);
  d[o + 7] = killed ? 1 : 0;
  d[o + 8] = DAMAGE_CODE[kind];
  d[o + 9] = health;
  d[o + 10] = respawnIn;
}

export function emitBotDown(
  r: EventRing,
  tick: number,
  slot: number,
  killer: number,
  by: number,
  cause: DeathCause,
  credited: boolean,
  head: boolean,
  from: Vector3Like,
  damage: number,
  kind: DamageKind,
): void {
  const o = r.open(EV.botDown, tick);
  const d = r.data;
  d[o] = slot;
  d[o + 1] = killer;
  d[o + 2] = by;
  d[o + 3] = CAUSE_CODE[cause];
  d[o + 4] = credited ? 1 : 0;
  d[o + 5] = head ? 1 : 0;
  v3(d, o + 6, from);
  d[o + 9] = damage;
  d[o + 10] = DAMAGE_CODE[kind];
}

/** Returns the record's offset, so a person's audit can be filed afterwards (`amendDeath`). */
export function emitDeath(
  r: EventRing,
  tick: number,
  slot: number,
  cause: DeathCause,
  credited: boolean,
): number {
  const o = r.open(EV.death, tick);
  r.data[o] = slot;
  r.data[o + 1] = CAUSE_CODE[cause];
  r.data[o + 2] = credited ? 1 : 0;
  return o;
}

/**
 * Files the audit of a `death` already written — a PERSON's, whose door
 * counts the death inside `takeDamage` before the blow's own door (the one
 * that knows the cause and whether anybody was paid) has run. Same call, same
 * drain, so the record has not left the ring; `setRoundShooter`'s pattern.
 */
export function amendDeath(
  r: EventRing,
  offset: number,
  cause: DeathCause,
  credited: boolean,
): void {
  r.data[offset + 1] = CAUSE_CODE[cause];
  r.data[offset + 2] = credited ? 1 : 0;
}

export function emitSpawned(
  r: EventRing,
  tick: number,
  slot: number,
  pos: Vector3Like,
  yaw: number,
): void {
  const o = r.open(EV.spawned, tick);
  r.data[o] = slot;
  v3(r.data, o + 1, pos);
  r.data[o + 4] = yaw;
}

export function emitAward(
  r: EventRing,
  tick: number,
  slot: number,
  kind: ScoreKind,
  points: number,
  person: boolean,
): void {
  const o = r.open(EV.award, tick);
  r.data[o] = slot;
  r.data[o + 1] = SCORE_KINDS.indexOf(kind);
  r.data[o + 2] = points;
  r.data[o + 3] = person ? 1 : 0;
}

/** `captured`, `neutralised`, and the hull pair-of-numbers kinds. */
export function emitPair(
  r: EventRing,
  kind:
    | typeof EV.captured
    | typeof EV.neutralised
    | typeof EV.hullPlaced
    | typeof EV.hullKicked
    | typeof EV.hullWrecked
    | typeof EV.hullDestroyed
    | typeof EV.hullRespawned
    | typeof EV.ordnanceRefused,
  tick: number,
  a: number,
  b: number,
): void {
  const o = r.open(kind, tick);
  r.data[o] = a;
  r.data[o + 1] = b;
}

export function emitRoundOver(r: EventRing, tick: number, winner: number): void {
  r.data[r.open(EV.roundOver, tick)] = winner;
}

export function emitBlast(
  r: EventRing,
  tick: number,
  at: Vector3Like,
  power: number,
  surface: Surface,
  normal: Vector3Like,
): void {
  const o = r.open(EV.blast, tick);
  const d = r.data;
  v3(d, o, at);
  d[o + 3] = power;
  d[o + 4] = SURFACE_CODE[surface];
  v3(d, o + 5, normal);
}

export function emitIgnited(
  r: EventRing,
  tick: number,
  id: number,
  at: Vector3Like,
  surface: Surface,
  normal: Vector3Like,
): void {
  const o = r.open(EV.ignited, tick);
  const d = r.data;
  d[o] = id;
  v3(d, o + 1, at);
  d[o + 4] = SURFACE_CODE[surface];
  v3(d, o + 5, normal);
}

export function emitBurntOut(r: EventRing, tick: number, id: number): void {
  r.data[r.open(EV.burntOut, tick)] = id;
}

/** `rocket` (a slot), `cannon` and `mg` (a tank): who, from where, which way. */
export function emitShot(
  r: EventRing,
  kind: typeof EV.rocket | typeof EV.cannon | typeof EV.mg,
  tick: number,
  who: number,
  from: Vector3Like,
  dir: Vector3Like,
): void {
  const o = r.open(kind, tick);
  r.data[o] = who;
  v3(r.data, o + 1, from);
  v3(r.data, o + 4, dir);
}

export function emitGlass(
  r: EventRing,
  tick: number,
  panes: readonly number[],
  at: Vector3Like,
  dir: Vector3Like,
): void {
  const start = r.pushInts(panes);
  const o = r.open(EV.glass, tick);
  const d = r.data;
  v3(d, o, at);
  v3(d, o + 3, dir);
  d[o + 6] = start;
  d[o + 7] = panes.length;
}

export function emitCrushed(
  r: EventRing,
  tick: number,
  tank: number,
  by: number,
  victim: number,
  victimKind: number,
): void {
  const o = r.open(EV.crushed, tick);
  r.data[o] = tank;
  r.data[o + 1] = by;
  r.data[o + 2] = victim;
  r.data[o + 3] = victimKind;
}

export function emitSeat(
  r: EventRing,
  tick: number,
  slot: number,
  tank: number,
  seat: number,
  at: Vector3Like,
  yaw: number,
): void {
  const o = r.open(EV.seat, tick);
  const d = r.data;
  d[o] = slot;
  d[o + 1] = tank;
  d[o + 2] = seat;
  v3(d, o + 3, at);
  d[o + 6] = yaw;
}

// ---------------------------------------------------------------------------
// The decoder.

export type Vec3 = [number, number, number];

/** One event as an object — what `decode` builds. `tick` is the core's tick at emission. */
export type SimEvent = { tick: number } & (
  | {
      type: "round";
      shooter: number;
      muzzle: Vec3;
      to: Vec3;
      impact: ImpactKind | null;
      normal: Vec3 | null;
      mark: boolean;
    }
  | { type: "botFired"; slot: number; muzzle: Vec3 }
  | { type: "botReload"; slot: number }
  | { type: "botStep"; slot: number }
  | { type: "nearMiss"; slot: number; at: Vec3 }
  | {
      type: "hit";
      shooter: number;
      victim: number;
      victimKind: VictimKind;
      killed: boolean;
      head: boolean;
      cause: DeathCause;
    }
  | {
      type: "damaged";
      slot: number;
      team: Team;
      amount: number;
      from: Vec3 | null;
      killed: boolean;
      kind: DamageKind;
      health: number;
      respawnIn: number;
    }
  | {
      type: "botDown";
      slot: number;
      killer: Team;
      by: number;
      cause: DeathCause;
      credited: boolean;
      head: boolean;
      from: Vec3;
      damage: number;
      kind: DamageKind;
    }
  | { type: "death"; slot: number; cause: DeathCause; credited: boolean }
  | { type: "spawned"; slot: number; pos: Vec3; yaw: number }
  | { type: "award"; slot: number; kind: ScoreKind; points: number; person: boolean }
  | { type: "captured"; point: number; by: Team }
  | { type: "neutralised"; point: number; by: Team }
  | { type: "roundOver"; winner: Team }
  | { type: "blast"; at: Vec3; power: number; surface: Surface; normal: Vec3 }
  | { type: "ignited"; id: number; at: Vec3; surface: Surface; normal: Vec3 }
  | { type: "burntOut"; id: number }
  | { type: "rocket"; slot: number; from: Vec3; dir: Vec3 }
  | { type: "glass"; panes: number[]; at: Vec3; dir: Vec3 }
  | { type: "cannon"; tank: number; muzzle: Vec3; dir: Vec3 }
  | { type: "mg"; tank: number; muzzle: Vec3; dir: Vec3 }
  | { type: "crushed"; tank: number; by: number; victim: number; victimKind: VictimKind }
  | {
      type:
        | "hullPlaced"
        | "hullKicked"
        | "hullWrecked"
        | "hullDestroyed"
        | "hullRespawned";
      tank: number;
      team: Team;
    }
  | { type: "seat"; slot: number; tank: number; seat: number; at: Vec3; yaw: number }
  | { type: "ordnanceRefused"; slot: number; item: RefusedItem }
);

const NAMES: EventName[] = [];
for (const name of Object.keys(EV) as EventName[]) NAMES[EV[name]] = name;

/** Record `i` of a drain as an object. Allocates; see the header. */
export function decode(c: EventCursor, i: number): SimEvent {
  const tick = c.ticks[i];
  const d = c.data;
  const o = i * STRIDE;
  const vec = (at: number): Vec3 => [d[o + at], d[o + at + 1], d[o + at + 2]];
  const k = c.kinds[i] as EventKind;
  switch (k) {
    case EV.round:
      return {
        tick,
        type: "round",
        shooter: d[o],
        muzzle: vec(1),
        to: vec(4),
        impact: d[o + 7] < 0 ? null : IMPACT_KINDS[d[o + 7]],
        normal: Number.isNaN(d[o + 8]) ? null : vec(8),
        mark: d[o + 11] === 1,
      };
    case EV.botFired:
      return { tick, type: "botFired", slot: d[o], muzzle: vec(1) };
    case EV.botReload:
      return { tick, type: "botReload", slot: d[o] };
    case EV.botStep:
      return { tick, type: "botStep", slot: d[o] };
    case EV.nearMiss:
      return { tick, type: "nearMiss", slot: d[o], at: vec(1) };
    case EV.hit:
      return {
        tick,
        type: "hit",
        shooter: d[o],
        victim: d[o + 1],
        victimKind: VICTIM_KINDS[d[o + 2]],
        killed: d[o + 3] === 1,
        head: d[o + 4] === 1,
        cause: DEATH_CAUSES[d[o + 5]],
      };
    case EV.damaged:
      return {
        tick,
        type: "damaged",
        slot: d[o],
        team: d[o + 1] as Team,
        amount: d[o + 2],
        from: d[o + 3] === 1 ? vec(4) : null,
        killed: d[o + 7] === 1,
        kind: DAMAGE_KINDS[d[o + 8]],
        health: d[o + 9],
        respawnIn: d[o + 10],
      };
    case EV.botDown:
      return {
        tick,
        type: "botDown",
        slot: d[o],
        killer: d[o + 1] as Team,
        by: d[o + 2],
        cause: DEATH_CAUSES[d[o + 3]],
        credited: d[o + 4] === 1,
        head: d[o + 5] === 1,
        from: vec(6),
        damage: d[o + 9],
        kind: DAMAGE_KINDS[d[o + 10]],
      };
    case EV.death:
      return {
        tick,
        type: "death",
        slot: d[o],
        cause: DEATH_CAUSES[d[o + 1]],
        credited: d[o + 2] === 1,
      };
    case EV.spawned:
      return { tick, type: "spawned", slot: d[o], pos: vec(1), yaw: d[o + 4] };
    case EV.award:
      return {
        tick,
        type: "award",
        slot: d[o],
        kind: SCORE_KINDS[d[o + 1]],
        points: d[o + 2],
        person: d[o + 3] === 1,
      };
    case EV.captured:
      return { tick, type: "captured", point: d[o], by: d[o + 1] as Team };
    case EV.neutralised:
      return { tick, type: "neutralised", point: d[o], by: d[o + 1] as Team };
    case EV.roundOver:
      return { tick, type: "roundOver", winner: d[o] as Team };
    case EV.blast:
      return {
        tick,
        type: "blast",
        at: vec(0),
        power: d[o + 3],
        surface: SURFACES[d[o + 4]],
        normal: vec(5),
      };
    case EV.ignited:
      return {
        tick,
        type: "ignited",
        id: d[o],
        at: vec(1),
        surface: SURFACES[d[o + 4]],
        normal: vec(5),
      };
    case EV.burntOut:
      return { tick, type: "burntOut", id: d[o] };
    case EV.rocket:
      return { tick, type: "rocket", slot: d[o], from: vec(1), dir: vec(4) };
    case EV.glass: {
      const start = d[o + 6];
      return {
        tick,
        type: "glass",
        panes: Array.from(c.ints.subarray(start, start + d[o + 7])),
        at: vec(0),
        dir: vec(3),
      };
    }
    case EV.cannon:
      return { tick, type: "cannon", tank: d[o], muzzle: vec(1), dir: vec(4) };
    case EV.mg:
      return { tick, type: "mg", tank: d[o], muzzle: vec(1), dir: vec(4) };
    case EV.crushed:
      return {
        tick,
        type: "crushed",
        tank: d[o],
        by: d[o + 1],
        victim: d[o + 2],
        victimKind: VICTIM_KINDS[d[o + 3]],
      };
    case EV.hullPlaced:
    case EV.hullKicked:
    case EV.hullWrecked:
    case EV.hullDestroyed:
    case EV.hullRespawned:
      return {
        tick,
        type: NAMES[k] as "hullPlaced",
        tank: d[o],
        team: d[o + 1] as Team,
      };
    case EV.seat:
      return {
        tick,
        type: "seat",
        slot: d[o],
        tank: d[o + 1],
        seat: d[o + 2],
        at: vec(3),
        yaw: d[o + 6],
      };
    case EV.ordnanceRefused:
      return { tick, type: "ordnanceRefused", slot: d[o], item: REFUSED_ITEMS[d[o + 1]] };
    default: {
      const unknown: never = k;
      throw new Error(`event kind ${String(unknown)} has no decoder`);
    }
  }
}

/** Every event in a drain, as objects — for tests, tools and `simulate`. */
export function toObjects(c: EventCursor): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < c.count; i++) out.push(decode(c, i));
  return out;
}
