/**
 * src/sim/frame.ts — The simulation core's STATE, as numbers: `SimFrame`, the
 * structure of typed arrays a host reads the standing round off, and
 * `fillFrame`, the one writer, which the core runs at the end of every call
 * that can change what is in it (`BABYLON_EXIT.md` X2.5a C5).
 * Owns: the frame's layout — every section, every field, its type and its
 * stride — and the copy of the core's live objects into it.
 * Invariants:
 * - **Postable.** A frame is plain objects of typed arrays and numbers and
 *   nothing else: no class, no prototype, no getter, no reference back into
 *   the simulation. `structuredClone(frame)` is the same frame, and its
 *   arrays can be transferred whole — which is what X2.5b's Worker does with
 *   it, and what `?simcopy` rehearses every step on the page today.
 * - **Bits preserved.** Every number a reader compares is a float64 (or an
 *   integer code that cannot be `-0`), so a reader of the frame reads the
 *   simulation's own value, `Object.is`-equal — which is what the DEV mirror
 *   check (`src/sim/simCheck.ts`) asserts every frame. A pose is the bot's
 *   SOLVED joints, packed (`packJoints`), so a rig posed from the frame is the
 *   rig posed from the bot.
 * - **Sized per pool, filled without allocating.** A section's arrays are
 *   (re)built only when its COUNT moves — a new pool, a new map, a person
 *   added past the capacity — which is a round boundary; a step or a submit
 *   writes into what is there.
 * - **Every code is a table's.** A damage kind is `events.ts`' code, a
 *   throwable is its index in `THROWABLE_IDS`, a seat holder is `HOLDER`'s;
 *   a null is -1.
 * Never: decide, or hold anything a reader could write back through. The frame
 * is a COPY; the simulation never reads it.
 *
 * **What it carries is what the page's views read**, and no more: the bots a
 * `BotRig` follows and the minimap, the shadows, the grass and the sounds
 * place; the flags and the tickets the gauges draw and the deploy screen
 * offers; the persons; the hulls the page's fleet is posed off and the seat
 * prompts ask; the pools the grenade and anti-tank pictures pose; the board;
 * the broken panes; the target list the aim assist holds; and a `timing` row
 * for the profiler's `sim` phase (C6).
 */
import { JOINT_STRIDE, packJoints } from "../entities/soldierPose";
import { THROWABLE_IDS } from "../entities/throwables";
import type { Bot } from "../entities/Bot";
import type { Combatant } from "../entities/Combatant";
import type { Vehicle } from "../entities/Vehicle";
import { DRIVER, GUNNER } from "../entities/hullSeats";
import type { BattleSystem } from "../systems/BattleSystem";
import type { ConquestSystem } from "../systems/ConquestSystem";
import type { GrenadeSystem } from "../systems/GrenadeSystem";
import type { AntiTankSystem } from "../systems/AntiTankSystem";
import type { GlassSystem } from "../systems/GlassSystem";
import type { ScoreBook } from "../systems/ScoreBook";
import type { VehicleCrew } from "../systems/VehicleCrew";
import type { SimPlayer } from "./SimPlayer";
import { damageCode } from "./events";

/**
 * Who holds a hull's chair, as the frame writes it — the page's `SeatHolder`
 * ("open", "bot", "player") as a code.
 */
export const HOLDER = { open: 0, bot: 1, person: 2 } as const;

/**
 * The phases of `SimCore.step` the profiler files under its `sim` phase
 * (`BABYLON_EXIT.md` X2.5a C6) — the frame's `timing` row, one float64 of
 * milliseconds each. Zero until a core built with `timing` records them.
 */
export const SIM_PHASES = ["conquest", "vehicles", "bots", "grenades", "antiTank"] as const;

/** The flags, one entry per control point in the map's order. */
export interface FrameFlags {
  count: number;
  /** -1 neutral, else the owning team. */
  owner: Int8Array;
  meter: Float64Array;
  contested: Uint8Array;
  /** Bodies in the zone, two per point: team 0's then team 1's. */
  present: Int32Array;
}

/** Every bot in the pool, by slot. */
export interface FrameBots {
  count: number;
  /** The rig's root, four per bot: `rootX`, `rootY`, `rootZ`, `rootYaw`. */
  root: Float64Array;
  /** Feet, centre (the hit sphere) and eye — three per bot each. */
  pos: Float64Array;
  center: Float64Array;
  eye: Float64Array;
  lookYaw: Float64Array;
  hitRadius: Float64Array;
  team: Uint8Array;
  alive: Uint8Array;
  /** `BattleSystem.aside` — benched, crewed or not fielded. */
  aside: Uint8Array;
  shown: Uint8Array;
  launcher: Uint8Array;
  life: Uint32Array;
  /** Where the killing blow came from (three per bot), how much, and what. */
  deathFrom: Float64Array;
  deathDamage: Float64Array;
  deathKind: Uint8Array;
  /** The SOLVED pose, `JOINT_STRIDE` per bot (`packJoints`). */
  joints: Float64Array;
}

/** The persons seated in the core, in the core's own order. */
export interface FramePlayers {
  count: number;
  slot: Int32Array;
  team: Uint8Array;
  alive: Uint8Array;
  health: Float64Array;
  pos: Float64Array;
  center: Float64Array;
  eye: Float64Array;
  hitRadius: Float64Array;
  /** Hardstanding index, or -1 on foot. */
  seat: Int32Array;
  crewSeat: Int8Array;
  grenades: Int32Array;
  ordnance: Int32Array;
  respawnT: Float64Array;
  /** `AntiTankSystem.minesFor` this person. */
  mines: Int32Array;
}

/** The fleet, by hardstanding index. */
export interface FrameHulls {
  count: number;
  present: Uint8Array;
  alive: Uint8Array;
  health: Float64Array;
  team: Uint8Array;
  pos: Float64Array;
  center: Float64Array;
  eye: Float64Array;
  hitRadius: Float64Array;
  yaw: Float64Array;
  turretYaw: Float64Array;
  gunPitch: Float64Array;
  mgYaw: Float64Array;
  mgPitch: Float64Array;
  /** `HOLDER` codes, the driver's chair and the gunner's. */
  driver: Int8Array;
  gunner: Int8Array;
}

/** The grenade pool, slot by slot (`GrenadeSystem.flights`). */
export interface FrameGrenades {
  count: number;
  live: Uint8Array;
  resting: Uint8Array;
  id: Float64Array;
  /** Index in `THROWABLE_IDS`. */
  kind: Uint8Array;
  fuse: Float64Array;
  pos: Float64Array;
  vel: Float64Array;
}

/** The fire pool, slot by slot (`GrenadeSystem.fireSlots`). */
export interface FrameFires {
  count: number;
  id: Float64Array;
  /** Seconds burning; < 0 while the slot is free. */
  t: Float64Array;
  at: Float64Array;
}

/** The rocket pool (`AntiTankSystem.rocketSlots`). */
export interface FrameRockets {
  count: number;
  live: Uint8Array;
  flown: Float64Array;
  pos: Float64Array;
  vel: Float64Array;
}

/** The mine pool (`AntiTankSystem.mineSlots`). */
export interface FrameMines {
  count: number;
  live: Uint8Array;
  armT: Float64Array;
  pos: Float64Array;
}

/** The board, one row per roster slot. */
export interface FrameScores {
  count: number;
  kills: Float64Array;
  deaths: Float64Array;
  points: Float64Array;
  /** `ScoreBook.version`. */
  version: number;
}

/**
 * The non-bot combatants in `BattleSystem.humanList`'s order — what the
 * target list puts after the bots. A person is its SLOT (0 and up); a hull is
 * `-1 - index`.
 */
export interface FrameHumans {
  count: number;
  who: Int32Array;
}

export interface SimFrame {
  /** `SimCore.tick` — steps since the round began. */
  tick: number;
  /** `SimCore.now` — the simulation's clock, ms. */
  time: number;
  /** The round's seed (`RoundRandom.seed`). */
  seed: number;
  /** `BattleSystem.poolVersion` — moves when the pool is rebuilt. */
  poolVersion: number;
  /** How many bots a side the round fields (`SimCore.perTeam`). */
  fielded: number;
  /** -1 while the round is live, else the winning team. */
  winner: number;
  tickets: Float64Array;
  flags: FrameFlags;
  bots: FrameBots;
  players: FramePlayers;
  hulls: FrameHulls;
  grenades: FrameGrenades;
  fires: FrameFires;
  rockets: FrameRockets;
  mines: FrameMines;
  scores: FrameScores;
  humans: FrameHumans;
  /** One per breakable pane of the standing map: 1 once it has broken. */
  panes: Uint8Array;
  /** Milliseconds per `SIM_PHASES` entry for the last step (C6). */
  timing: Float64Array;
}

/** An empty frame: every section at count 0. */
export function newFrame(): SimFrame {
  return {
    tick: 0,
    time: 0,
    seed: 0,
    poolVersion: 0,
    fielded: 0,
    winner: -1,
    tickets: new Float64Array(2),
    flags: flagsOf(0),
    bots: botsOf(0),
    players: playersOf(0),
    hulls: hullsOf(0),
    grenades: grenadesOf(0),
    fires: firesOf(0),
    rockets: rocketsOf(0),
    mines: minesOf(0),
    scores: scoresOf(0),
    humans: { count: 0, who: new Int32Array(0) },
    panes: new Uint8Array(0),
    timing: new Float64Array(SIM_PHASES.length),
  };
}

/**
 * Everything `fillFrame` reads — the core's own fields, by name, so this file
 * never imports the class that calls it.
 */
export interface FrameSource {
  readonly tick: number;
  readonly now: number;
  readonly perTeam: number;
  readonly random: { readonly seed: number };
  readonly battle: BattleSystem;
  readonly conquest: ConquestSystem;
  readonly vehicles: { readonly hulls: readonly Vehicle[] };
  readonly crew: Pick<VehicleCrew, "crewOf">;
  readonly grenades: GrenadeSystem;
  readonly antiTank: AntiTankSystem;
  readonly glass: GlassSystem;
  readonly scores: ScoreBook;
  readonly players: ReadonlyMap<number, SimPlayer>;
}

/**
 * Copies the core's state into `f`. Rebuilds a section only when its count
 * has moved; otherwise writes in place and allocates nothing.
 *
 * **A bot's pose is SOLVED here**, every fill, for every bot whose motion
 * filled a pose since the last solve (`Bot.solved` caches the rest) — where
 * the page used to solve only the bodies inside its freeze distance. The
 * solve is a pure function of the pose, so this moves its COST and not its
 * answer: the muzzle `muzzleWorld` replays and the joints a rig is posed with
 * are the numbers they always were.
 */
export function fillFrame(f: SimFrame, src: FrameSource): void {
  f.tick = src.tick;
  f.time = src.now;
  f.seed = src.random.seed;
  f.poolVersion = src.battle.poolVersion;
  f.fielded = src.perTeam;
  const conquest = src.conquest;
  f.winner = conquest.winner ?? -1;
  f.tickets[0] = conquest.tickets[0];
  f.tickets[1] = conquest.tickets[1];

  // --- flags ---
  const points = conquest.points;
  if (f.flags.count !== points.length) f.flags = flagsOf(points.length);
  const fl = f.flags;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    fl.owner[i] = p.owner ?? -1;
    fl.meter[i] = p.meter;
    fl.contested[i] = p.contested ? 1 : 0;
    fl.present[i * 2] = p.present[0];
    fl.present[i * 2 + 1] = p.present[1];
  }

  // --- bots ---
  const battle = src.battle;
  const bots = battle.bots;
  if (f.bots.count !== bots.length) f.bots = botsOf(bots.length);
  const b = f.bots;
  for (let i = 0; i < bots.length; i++) writeBot(b, i, bots[i], battle.aside(bots[i]));

  // --- persons ---
  const players = src.players;
  // Capacity is the pool's slot count — a person's slot is always one of
  // them — so a person joining is not a reallocation.
  const cap = Math.max(players.size, bots.length);
  if (f.players.slot.length < cap) f.players = playersOf(cap);
  const pl = f.players;
  pl.count = players.size;
  let k = 0;
  for (const p of players.values()) {
    pl.slot[k] = p.slot;
    pl.team[k] = p.team;
    pl.alive[k] = p.alive ? 1 : 0;
    pl.health[k] = p.health;
    v3(pl.pos, k, p.position);
    v3(pl.center, k, p.center);
    v3(pl.eye, k, p.eyePos);
    pl.hitRadius[k] = p.hitRadius;
    pl.seat[k] = p.seat;
    pl.crewSeat[k] = p.crewSeat;
    pl.grenades[k] = p.grenades;
    pl.ordnance[k] = p.ordnance;
    pl.respawnT[k] = p.respawnT;
    pl.mines[k] = src.antiTank.minesFor(p);
    k++;
  }

  // --- hulls ---
  const hulls = src.vehicles.hulls;
  if (f.hulls.count !== hulls.length) f.hulls = hullsOf(hulls.length);
  const h = f.hulls;
  for (let i = 0; i < hulls.length; i++) {
    const t = hulls[i];
    h.present[i] = t.present ? 1 : 0;
    h.alive[i] = t.alive ? 1 : 0;
    h.health[i] = t.health;
    h.team[i] = t.team;
    v3(h.pos, i, t.position);
    v3(h.center, i, t.center);
    v3(h.eye, i, t.eyePos);
    h.hitRadius[i] = t.hitRadius;
    h.yaw[i] = t.yaw;
    h.turretYaw[i] = t.turretYaw;
    h.gunPitch[i] = t.gunPitch;
    h.mgYaw[i] = t.mgYaw;
    h.mgPitch[i] = t.mgPitch;
    h.driver[i] = holder(t, DRIVER, src.crew);
    h.gunner[i] = holder(t, GUNNER, src.crew);
  }

  // --- the target list's tail ---
  const humans = battle.humanList;
  if (f.humans.who.length < humans.length + cap) {
    f.humans = { count: 0, who: new Int32Array(humans.length + cap) };
  }
  const hu = f.humans;
  hu.count = humans.length;
  for (let i = 0; i < humans.length; i++) hu.who[i] = humanCode(humans[i], hulls);

  // --- what is in the air ---
  const flights = src.grenades.flights;
  if (f.grenades.count !== flights.length) f.grenades = grenadesOf(flights.length);
  const g = f.grenades;
  for (let i = 0; i < flights.length; i++) {
    const n = flights[i];
    g.live[i] = n.live ? 1 : 0;
    g.resting[i] = n.resting ? 1 : 0;
    g.id[i] = n.id;
    g.kind[i] = THROWABLE_IDS.indexOf(n.kind);
    g.fuse[i] = n.fuse;
    v3(g.pos, i, n.pos);
    v3(g.vel, i, n.vel);
  }
  const fires = src.grenades.fireSlots;
  if (f.fires.count !== fires.length) f.fires = firesOf(fires.length);
  const fi = f.fires;
  for (let i = 0; i < fires.length; i++) {
    fi.id[i] = fires[i].id;
    fi.t[i] = fires[i].t;
    v3(fi.at, i, fires[i].at);
  }
  const rockets = src.antiTank.rocketSlots;
  if (f.rockets.count !== rockets.length) f.rockets = rocketsOf(rockets.length);
  const r = f.rockets;
  for (let i = 0; i < rockets.length; i++) {
    r.live[i] = rockets[i].live ? 1 : 0;
    r.flown[i] = rockets[i].flown;
    v3(r.pos, i, rockets[i].pos);
    v3(r.vel, i, rockets[i].vel);
  }
  const mines = src.antiTank.mineSlots;
  if (f.mines.count !== mines.length) f.mines = minesOf(mines.length);
  const m = f.mines;
  for (let i = 0; i < mines.length; i++) {
    m.live[i] = mines[i].live ? 1 : 0;
    m.armT[i] = mines[i].armT;
    v3(m.pos, i, mines[i].pos);
  }

  // --- the board ---
  const book = src.scores;
  if (f.scores.count !== book.kills.length) f.scores = scoresOf(book.kills.length);
  const s = f.scores;
  for (let i = 0; i < book.kills.length; i++) {
    s.kills[i] = book.kills[i];
    s.deaths[i] = book.deaths[i];
    s.points[i] = book.points[i];
  }
  s.version = book.version;

  // --- the glass ---
  const glass = src.glass;
  if (f.panes.length !== glass.paneCount) f.panes = new Uint8Array(glass.paneCount);
  for (let i = 0; i < f.panes.length; i++) f.panes[i] = glass.intact(i) ? 0 : 1;
}

/** Bot `bot` into slot `i` of `b`. */
function writeBot(b: FrameBots, i: number, bot: Bot, aside: boolean): void {
  b.root[i * 4] = bot.rootX;
  b.root[i * 4 + 1] = bot.rootY;
  b.root[i * 4 + 2] = bot.rootZ;
  b.root[i * 4 + 3] = bot.rootYaw;
  v3(b.pos, i, bot.position);
  v3(b.center, i, bot.center);
  v3(b.eye, i, bot.eyePos);
  b.lookYaw[i] = bot.lookYaw;
  b.hitRadius[i] = bot.hitRadius;
  b.team[i] = bot.team;
  b.alive[i] = bot.alive ? 1 : 0;
  b.aside[i] = aside ? 1 : 0;
  b.shown[i] = bot.shown ? 1 : 0;
  b.launcher[i] = bot.launcher ? 1 : 0;
  b.life[i] = bot.life;
  v3(b.deathFrom, i, bot.deathFrom);
  b.deathDamage[i] = bot.deathDamage;
  b.deathKind[i] = damageCode(bot.deathKind);
  packJoints(bot.solved, b.joints, i * JOINT_STRIDE);
}

function holder(t: Vehicle, seat: typeof DRIVER | typeof GUNNER, crew: Pick<VehicleCrew, "crewOf">): number {
  if (!t.seats[seat]) return HOLDER.open;
  return crew.crewOf(t, seat) ? HOLDER.bot : HOLDER.person;
}

function humanCode(who: Combatant, hulls: readonly Vehicle[]): number {
  const i = hulls.indexOf(who as Vehicle);
  if (i >= 0) return -1 - i;
  return (who as SimPlayer).slot;
}

function v3(out: Float64Array, i: number, v: { x: number; y: number; z: number }): void {
  out[i * 3] = v.x;
  out[i * 3 + 1] = v.y;
  out[i * 3 + 2] = v.z;
}

// --- section builders: the only places a frame allocates ---

function flagsOf(n: number): FrameFlags {
  return {
    count: n,
    owner: new Int8Array(n),
    meter: new Float64Array(n),
    contested: new Uint8Array(n),
    present: new Int32Array(n * 2),
  };
}

function botsOf(n: number): FrameBots {
  return {
    count: n,
    root: new Float64Array(n * 4),
    pos: new Float64Array(n * 3),
    center: new Float64Array(n * 3),
    eye: new Float64Array(n * 3),
    lookYaw: new Float64Array(n),
    hitRadius: new Float64Array(n),
    team: new Uint8Array(n),
    alive: new Uint8Array(n),
    aside: new Uint8Array(n),
    shown: new Uint8Array(n),
    launcher: new Uint8Array(n),
    life: new Uint32Array(n),
    deathFrom: new Float64Array(n * 3),
    deathDamage: new Float64Array(n),
    deathKind: new Uint8Array(n),
    joints: new Float64Array(n * JOINT_STRIDE),
  };
}

function playersOf(cap: number): FramePlayers {
  return {
    count: 0,
    slot: new Int32Array(cap),
    team: new Uint8Array(cap),
    alive: new Uint8Array(cap),
    health: new Float64Array(cap),
    pos: new Float64Array(cap * 3),
    center: new Float64Array(cap * 3),
    eye: new Float64Array(cap * 3),
    hitRadius: new Float64Array(cap),
    seat: new Int32Array(cap),
    crewSeat: new Int8Array(cap),
    grenades: new Int32Array(cap),
    ordnance: new Int32Array(cap),
    respawnT: new Float64Array(cap),
    mines: new Int32Array(cap),
  };
}

function hullsOf(n: number): FrameHulls {
  return {
    count: n,
    present: new Uint8Array(n),
    alive: new Uint8Array(n),
    health: new Float64Array(n),
    team: new Uint8Array(n),
    pos: new Float64Array(n * 3),
    center: new Float64Array(n * 3),
    eye: new Float64Array(n * 3),
    hitRadius: new Float64Array(n),
    yaw: new Float64Array(n),
    turretYaw: new Float64Array(n),
    gunPitch: new Float64Array(n),
    mgYaw: new Float64Array(n),
    mgPitch: new Float64Array(n),
    driver: new Int8Array(n),
    gunner: new Int8Array(n),
  };
}

function grenadesOf(n: number): FrameGrenades {
  return {
    count: n,
    live: new Uint8Array(n),
    resting: new Uint8Array(n),
    id: new Float64Array(n),
    kind: new Uint8Array(n),
    fuse: new Float64Array(n),
    pos: new Float64Array(n * 3),
    vel: new Float64Array(n * 3),
  };
}

function firesOf(n: number): FrameFires {
  return { count: n, id: new Float64Array(n), t: new Float64Array(n), at: new Float64Array(n * 3) };
}

function rocketsOf(n: number): FrameRockets {
  return {
    count: n,
    live: new Uint8Array(n),
    flown: new Float64Array(n),
    pos: new Float64Array(n * 3),
    vel: new Float64Array(n * 3),
  };
}

function minesOf(n: number): FrameMines {
  return { count: n, live: new Uint8Array(n), armT: new Float64Array(n), pos: new Float64Array(n * 3) };
}

function scoresOf(n: number): FrameScores {
  return {
    count: n,
    kills: new Float64Array(n),
    deaths: new Float64Array(n),
    points: new Float64Array(n),
    version: 0,
  };
}

/**
 * The frame's size in bytes — its arrays' storage. For a measurement, never
 * the hot path.
 */
export function frameBytes(f: SimFrame): number {
  let n = 0;
  const walk = (o: unknown): void => {
    if (ArrayBuffer.isView(o)) n += o.byteLength;
    else if (typeof o === "number") n += 8;
    else if (o && typeof o === "object") for (const v of Object.values(o)) walk(v);
  };
  walk(f);
  return n;
}
