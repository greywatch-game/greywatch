/**
 * src/sim/mirror.ts — The page-side READERS of the simulation core: what a
 * view on the offline page asks of the round, answered off the core's
 * `SimFrame` (`src/sim/frame.ts`) in the shapes the views already ask in.
 * Owns: `SimMirror` and its parts — `RosterMirror` (one `BotMirror` per pool
 * slot: what a `BotRig`, the minimap, the shadows, the grass, the sounds and
 * the bench's spectator read of a bot), `FleetMirror` (the hulls, read as the
 * posed fleet reads `NetVehicles`, and who holds each chair), the persons
 * (`PersonMirror`), the pools the grenade and anti-tank pictures pose
 * (`OrdnanceMirror`), the board (`ScoresMirror`), the broken panes, the
 * target list the aim assist holds, and `flagsInto` — the flags and tickets
 * written onto the page's own `ConquestSystem`, as a match's `NetRoster`
 * writes them off the wire.
 * Invariants:
 * - **A reader reads the FRAME and nothing else** (`BABYLON_EXIT.md` X2.5a
 *   C5). Nothing here holds or is handed an object of the simulation's (the
 *   one value it imports from a system is `fireStrength`, a pure function of
 *   a fire's age); `sync` takes a frame — the core's own, or a structured
 *   clone of it under `?simcopy`, or (X2.5b) one posted out of a Worker — and
 *   every answer is a copy of a number in it. The DEV check
 *   (`src/sim/simCheck.ts`, `?simcheck`) asserts every answer here equals the
 *   live object's with `Object.is`, every frame.
 * - **Identity is stable within a pool.** A `BotMirror` is a slot's for as
 *   long as the core's pool stands (`poolVersion`), so a view keyed on the
 *   object — `BattleView`'s rigs, the minimap's reveals, the blob shadows —
 *   keeps its key; a new pool is new objects, as a rebuilt `BattleSystem`
 *   pool is new `Bot`s.
 * - Allocation-free per `sync` once a pool stands: every answer is written
 *   into an object held for the life of its slot.
 * - Nothing here imports `@babylonjs/core` (`scripts/check-babylon-free.mjs`
 *   walks this directory).
 * Never: decide, or write anything the simulation reads. A `BotMirror`'s
 * `takeDamage` refuses, as a match's `NetSoldier`'s does: a body drawn here is
 * a picture of one the core holds.
 */
import { Vector3, type Vector3Like } from "../math";
import type { Combatant, Team } from "../entities/Combatant";
import type { GunAngles } from "../entities/Vehicle";
import {
  DRIVER,
  GUNNER,
  type CrewSeat,
  type SeatHolder,
} from "../entities/hullSeats";
import {
  JOINT_STRIDE,
  newSoldierJoints,
  unpackJoints,
  type SoldierJoints,
} from "../entities/soldierPose";
import { THROWABLE_IDS, type ThrowableId } from "../entities/throwables";
import type { DamageKind, Hittable } from "../systems/CombatSystem";
import type { ControlPoint } from "../systems/ConquestSystem";
import {
  fireStrength,
  type FireSlot,
  type GrenadeFlight,
} from "../systems/GrenadeSystem";
import type { MineSlot, RocketFlight } from "../systems/AntiTankSystem";
import type { RemoteHull } from "../systems/VehicleSystem";
import { DAMAGE_KINDS } from "./events";
import { HOLDER, newFrame, type SimFrame } from "./frame";

/**
 * Everything a view reads of one bot — `BotRig`, the minimap, the blob
 * shadows, the grass, the sounds, the scoreboard, the bench's spectator. A
 * `Bot` satisfies it (the simulation's own body), and so does a `BotMirror`
 * (the frame's copy of one), which is what lets one rig follow either.
 */
export interface BotRead {
  readonly team: Team;
  readonly alive: boolean;
  /** In the world to be drawn — `Bot.shown`. */
  readonly shown: boolean;
  /** Which life the body is on — a view does its once-a-life work off this. */
  readonly life: number;
  readonly launcher: boolean;
  readonly position: Vector3Like;
  readonly center: Vector3Like;
  readonly eyePos: Vector3Like;
  readonly lookYaw: number;
  readonly rootX: number;
  readonly rootY: number;
  readonly rootZ: number;
  readonly rootYaw: number;
  readonly deathFrom: Vector3Like;
  readonly deathDamage: number;
  readonly deathKind: DamageKind;
  /** The pose, solved to its joints. */
  readonly solved: Readonly<SoldierJoints>;
}

/**
 * What `BattleView` reads of a roster: the pool, and the number that moves
 * when the pool is rebuilt. Nothing it could write.
 */
export interface RosterRead {
  readonly bots: readonly BotRead[];
  readonly poolVersion: number;
}

/** One pool slot, as the frame last said it. */
export class BotMirror implements BotRead, Combatant {
  team: Team = 0;
  alive = false;
  shown = false;
  life = 0;
  launcher = false;
  /** `BattleSystem.aside` — benched, crewed or not fielded. */
  aside = false;
  readonly position = new Vector3();
  readonly center = new Vector3();
  readonly eyePos = new Vector3();
  hitRadius = 0;
  lookYaw = 0;
  rootX = 0;
  rootY = 0;
  rootZ = 0;
  rootYaw = 0;
  readonly deathFrom = new Vector3();
  deathDamage = 0;
  deathKind: DamageKind = "bullet";
  readonly solved: SoldierJoints = newSoldierJoints();
  readonly isBot = true;

  constructor(readonly slot: number) {}

  /** A picture of a body: no blow lands here. */
  takeDamage(): boolean {
    return false;
  }

  /** Slot `i` of the frame's bots, copied in. */
  read(f: SimFrame, i: number): void {
    const b = f.bots;
    this.team = b.team[i] as Team;
    this.alive = b.alive[i] === 1;
    this.shown = b.shown[i] === 1;
    this.life = b.life[i];
    this.launcher = b.launcher[i] === 1;
    this.aside = b.aside[i] === 1;
    at(b.pos, i, this.position);
    at(b.center, i, this.center);
    at(b.eye, i, this.eyePos);
    this.hitRadius = b.hitRadius[i];
    this.lookYaw = b.lookYaw[i];
    this.rootX = b.root[i * 4];
    this.rootY = b.root[i * 4 + 1];
    this.rootZ = b.root[i * 4 + 2];
    this.rootYaw = b.root[i * 4 + 3];
    at(b.deathFrom, i, this.deathFrom);
    this.deathDamage = b.deathDamage[i];
    this.deathKind = DAMAGE_KINDS[b.deathKind[i]];
    unpackJoints(b.joints, i * JOINT_STRIDE, this.solved);
  }
}

/** The pool, slot by slot — `BattleView`'s roster offline. */
export class RosterMirror implements RosterRead {
  bots: BotMirror[] = [];
  poolVersion = -1;

  sync(f: SimFrame): void {
    const n = f.bots.count;
    // A rebuilt pool is new bodies, exactly as `setRoster` makes new `Bot`s:
    // a view keyed on the old objects lets them go with its own rebuild.
    if (f.poolVersion !== this.poolVersion || n !== this.bots.length) {
      this.poolVersion = f.poolVersion;
      const bots: BotMirror[] = [];
      for (let i = 0; i < n; i++) bots.push(new BotMirror(i));
      this.bots = bots;
    }
    for (let i = 0; i < n; i++) this.bots[i].read(f, i);
  }

  /** Bodies up and in the fight — `BattleSystem`'s own count, `aside` skipped. */
  aliveCount(): number {
    let n = 0;
    for (const bot of this.bots) if (bot.alive && !bot.aside) n++;
    return n;
  }
}

/** One seated person, as the frame last said them. */
export class PersonMirror implements Hittable {
  slot = -1;
  team: Team = 0;
  alive = false;
  health = 0;
  readonly position = new Vector3();
  readonly center = new Vector3();
  readonly eyePos = new Vector3();
  hitRadius = 0;
  /** Hardstanding index, or -1 on foot. */
  seat = -1;
  crewSeat: CrewSeat = DRIVER;
  grenades = 0;
  ordnance = 0;
  respawnT = 0;
  /** Mines this person has on the field. */
  mines = 0;

  takeDamage(): boolean {
    return false;
  }

  read(f: SimFrame, k: number): void {
    const p = f.players;
    this.slot = p.slot[k];
    this.team = p.team[k] as Team;
    this.alive = p.alive[k] === 1;
    this.health = p.health[k];
    at(p.pos, k, this.position);
    at(p.center, k, this.center);
    at(p.eye, k, this.eyePos);
    this.hitRadius = p.hitRadius[k];
    this.seat = p.seat[k];
    this.crewSeat = p.crewSeat[k] as CrewSeat;
    this.grenades = p.grenades[k];
    this.ordnance = p.ordnance[k];
    this.respawnT = p.respawnT[k];
    this.mines = p.mines[k];
  }
}

/** A hull as a TARGET — what the aim assist holds on. */
export class HullTarget implements Hittable {
  team: Team = 0;
  alive = false;
  readonly center = new Vector3();
  readonly eyePos = new Vector3();
  hitRadius = 0;
  readonly armoured = true;

  takeDamage(): boolean {
    return false;
  }
}

/**
 * The core's fleet, read by hardstanding index as `NetVehicles` answers the
 * snapshot's. `stateFor` and `mgFor` hand back ONE held object per index,
 * rewritten on each ask, so the page's per-frame posing allocates nothing.
 */
export class FleetMirror {
  private f: SimFrame = newFrame();
  private readonly states: RemoteHull[] = [];
  private readonly guns: GunAngles[] = [];
  /** One per hardstanding, rewritten at every `sync`. */
  readonly targets: HullTarget[] = [];

  sync(f: SimFrame): void {
    this.f = f;
    const h = f.hulls;
    while (this.targets.length < h.count) this.targets.push(new HullTarget());
    this.targets.length = h.count;
    for (let i = 0; i < h.count; i++) {
      const t = this.targets[i];
      t.team = h.team[i] as Team;
      t.alive = h.alive[i] === 1;
      at(h.center, i, t.center);
      at(h.eye, i, t.eyePos);
      t.hitRadius = h.hitRadius[i];
    }
  }

  get count(): number {
    return this.f.hulls.count;
  }

  /** Where hull `i` is, or null when it is not on the field. */
  stateFor(i: number): RemoteHull | null {
    const h = this.f.hulls;
    if (i < 0 || i >= h.count || h.present[i] !== 1) return null;
    const s = (this.states[i] ??= { x: 0, y: 0, z: 0, yaw: 0, turretYaw: 0, gunPitch: 0 });
    s.x = h.pos[i * 3];
    s.y = h.pos[i * 3 + 1];
    s.z = h.pos[i * 3 + 2];
    s.yaw = h.yaw[i];
    s.turretYaw = h.turretYaw[i];
    s.gunPitch = h.gunPitch[i];
    return s;
  }

  /** Where hull `i`'s cupola gun points, or null when it is not on the field. */
  mgFor(i: number): GunAngles | null {
    const h = this.f.hulls;
    if (i < 0 || i >= h.count || h.present[i] !== 1) return null;
    const g = (this.guns[i] ??= { yaw: 0, pitch: 0 });
    g.yaw = h.mgYaw[i];
    g.pitch = h.mgPitch[i];
    return g;
  }

  present(i: number): boolean {
    return i >= 0 && i < this.f.hulls.count && this.f.hulls.present[i] === 1;
  }

  alive(i: number): boolean {
    return i >= 0 && i < this.f.hulls.count && this.f.hulls.alive[i] === 1;
  }

  health(i: number): number {
    return i >= 0 && i < this.f.hulls.count ? this.f.hulls.health[i] : 0;
  }

  /**
   * Whether the driver's chair is held: 0 when it is, -1 when it is not. The
   * wire's `occupant` is a SLOT; nothing that reads this mirror asks which —
   * `seatHolder` says who.
   */
  occupant(i: number): number {
    return this.seatHolder(i, DRIVER) === "open" ? -1 : 0;
  }

  /** `occupant`'s twin for the gunner's chair. */
  gunner(i: number): number {
    return this.seatHolder(i, GUNNER) === "open" ? -1 : 0;
  }

  /** Who holds chair `seat` of hull `i` — the seat prompts' question. */
  seatHolder(i: number, seat: CrewSeat): SeatHolder {
    const h = this.f.hulls;
    if (i < 0 || i >= h.count) return "open";
    const code = seat === DRIVER ? h.driver[i] : h.gunner[i];
    return code === HOLDER.bot ? "bot" : code === HOLDER.person ? "player" : "open";
  }
}

/** One grenade slot, as `GrenadeFx` reads one. */
class FlightMirror implements GrenadeFlight {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  kind: ThrowableId = "frag";
  id = 0;
  fuse = 0;
  live = false;
  resting = false;
}

/** One fire slot. */
class FireMirror implements FireSlot {
  id = 0;
  t = -1;
  readonly at = new Vector3();
}

class RocketMirror implements RocketFlight {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  live = false;
  flown = 0;
}

class MineMirror implements MineSlot {
  readonly pos = new Vector3();
  live = false;
  armT = 0;
}

/**
 * The pools in the air and on the ground, slot by slot — what `GrenadeFx` and
 * `AntiTankFx` pose and what `forEachFire` lights and voices: the same reads
 * `GrenadeSystem` and `AntiTankSystem` answer, off the frame.
 */
export class OrdnanceMirror {
  readonly flights: FlightMirror[] = [];
  readonly fireSlots: FireMirror[] = [];
  readonly rocketSlots: RocketMirror[] = [];
  readonly mineSlots: MineMirror[] = [];

  sync(f: SimFrame): void {
    const g = f.grenades;
    grow(this.flights, g.count, () => new FlightMirror());
    for (let i = 0; i < g.count; i++) {
      const n = this.flights[i];
      n.live = g.live[i] === 1;
      n.resting = g.resting[i] === 1;
      n.id = g.id[i];
      n.kind = THROWABLE_IDS[g.kind[i]];
      n.fuse = g.fuse[i];
      at(g.pos, i, n.pos);
      at(g.vel, i, n.vel);
    }
    const fi = f.fires;
    grow(this.fireSlots, fi.count, () => new FireMirror());
    for (let i = 0; i < fi.count; i++) {
      const s = this.fireSlots[i];
      s.id = fi.id[i];
      s.t = fi.t[i];
      at(fi.at, i, s.at);
    }
    const r = f.rockets;
    grow(this.rocketSlots, r.count, () => new RocketMirror());
    for (let i = 0; i < r.count; i++) {
      const s = this.rocketSlots[i];
      s.live = r.live[i] === 1;
      s.flown = r.flown[i];
      at(r.pos, i, s.pos);
      at(r.vel, i, s.vel);
    }
    const m = f.mines;
    grow(this.mineSlots, m.count, () => new MineMirror());
    for (let i = 0; i < m.count; i++) {
      const s = this.mineSlots[i];
      s.live = m.live[i] === 1;
      s.armT = m.armT[i];
      at(m.pos, i, s.pos);
    }
  }

  /** `GrenadeSystem.forEachFire`, off the frame — the same visit, the same order. */
  forEachFire(fn: (id: number, at: Vector3, strength: number) => void): void {
    for (const f of this.fireSlots) {
      if (f.t >= 0) fn(f.id, f.at, fireStrength(f.t));
    }
  }
}

/** The board, one row per slot — `ScoreBook.row`'s answer, off the frame. */
export class ScoresMirror {
  private f: SimFrame = newFrame();
  private readonly held = { kills: 0, deaths: 0, points: 0 };

  sync(f: SimFrame): void {
    this.f = f;
  }

  get version(): number {
    return this.f.scores.version;
  }

  /** One held object, rewritten on each ask — read it inside the call. */
  row(slot: number): { kills: number; deaths: number; points: number } {
    const s = this.f.scores;
    const ok = slot >= 0 && slot < s.count;
    this.held.kills = ok ? s.kills[slot] : 0;
    this.held.deaths = ok ? s.deaths[slot] : 0;
    this.held.points = ok ? s.points[slot] : 0;
    return this.held;
  }
}

/**
 * Everything the offline page reads of the round, off one frame. `sync` once
 * per frame the core publishes — after every `step`, every `submit` and every
 * round call — and before anything reads it.
 */
export class SimMirror {
  readonly roster = new RosterMirror();
  readonly fleet = new FleetMirror();
  readonly ordnance = new OrdnanceMirror();
  readonly scores = new ScoresMirror();
  /** The persons, in the frame's order. */
  private readonly persons: PersonMirror[] = [];
  private personCount = 0;
  /** The frame last synced — the header's numbers are read off it. */
  frame: SimFrame = newFrame();
  /** `hittablesAgainst`'s answer, one scratch list per side. */
  private readonly targets: [Hittable[], Hittable[]] = [[], []];

  sync(f: SimFrame): void {
    this.frame = f;
    this.roster.sync(f);
    this.fleet.sync(f);
    this.ordnance.sync(f);
    this.scores.sync(f);
    const p = f.players;
    grow(this.persons, p.count, () => new PersonMirror());
    for (let k = 0; k < p.count; k++) this.persons[k].read(f, k);
    this.personCount = p.count;
  }

  /** `SimCore.tick` as of the last sync. */
  get tick(): number {
    return this.frame.tick;
  }

  /** The person in `slot`, or null when nobody sits there. */
  person(slot: number): PersonMirror | null {
    for (let k = 0; k < this.personCount; k++) {
      if (this.persons[k].slot === slot) return this.persons[k];
    }
    return null;
  }

  /** Whether pane `i` has broken, as the frame says. */
  paneBroken(i: number): boolean {
    return i >= 0 && i < this.frame.panes.length && this.frame.panes[i] === 1;
  }

  /**
   * Everything a side may shoot at, in `BattleSystem.hittablesAgainst`'s
   * order — the living, fielded bots of the other side, then the humans (the
   * hulls and the persons) in the core's own list order — for the aim assist.
   * A scratch list per side, overwritten by the next ask: consume it inside
   * the call, as the simulation's own contract says.
   */
  hittablesAgainst(team: Team): Hittable[] {
    const out = this.targets[team];
    out.length = 0;
    for (const bot of this.roster.bots) {
      if (bot.alive && bot.team !== team && !bot.aside) out.push(bot);
    }
    const hu = this.frame.humans;
    for (let i = 0; i < hu.count; i++) {
      const who = hu.who[i];
      if (who < 0) {
        const t = this.fleet.targets[-1 - who];
        if (t && t.alive && t.team !== team) out.push(t);
      } else {
        const p = this.person(who);
        if (p && p.alive && p.team !== team) out.push(p);
      }
    }
    return out;
  }

  /**
   * The flags and the tickets, written onto the page's own `ConquestSystem`
   * points — `NetRoster`'s `applyPoints` with the frame as the wire, and for
   * its reason: the capture zones, the HUD's strip, the minimap and the
   * deploy screen hold those very objects, and the deploy screen's offer
   * (`deployOptions`, `spawnIndex`) is answered off them and the map's spawns.
   * A frame with a different flag count (between rounds) writes nothing.
   */
  flagsInto(conquest: {
    readonly points: ControlPoint[];
    readonly tickets: [number, number];
    winner: Team | null;
  }): void {
    const f = this.frame;
    const fl = f.flags;
    if (fl.count !== conquest.points.length) return;
    for (let i = 0; i < fl.count; i++) {
      const p = conquest.points[i];
      const owner = fl.owner[i];
      p.owner = owner < 0 ? null : (owner as Team);
      p.meter = fl.meter[i];
      p.contested = fl.contested[i] === 1;
      p.present[0] = fl.present[i * 2];
      p.present[1] = fl.present[i * 2 + 1];
    }
    conquest.tickets[0] = f.tickets[0];
    conquest.tickets[1] = f.tickets[1];
    conquest.winner = f.winner < 0 ? null : (f.winner as Team);
  }
}

/** Vector `i` of a three-wide array, into `out`. */
function at(src: Float64Array, i: number, out: Vector3): void {
  out.x = src[i * 3];
  out.y = src[i * 3 + 1];
  out.z = src[i * 3 + 2];
}

/** Grows (never shrinks below need) a held pool to `n` entries. */
function grow<T>(list: T[], n: number, make: () => T): void {
  while (list.length < n) list.push(make());
  list.length = n;
}
