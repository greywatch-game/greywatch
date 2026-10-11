/**
 * server/corecheck.ts — The scoring rules, exercised with no `Game` and no
 * socket: `SimCore` driven by a scripted person and asserted from the events
 * it drains — and then the SAME script through `Match` with a fake peer,
 * which must produce the same awards and deaths. `npm run corecheck`.
 * Owns: nothing the game runs. It is a test, the project's only one, and it
 * exits non-zero on any failed assertion.
 * Invariants: everything asserted is read off the core's drained events
 * (`src/sim/events.ts`), never off a callback — that ring is the one thing a
 * host hears. Every scenario is DETERMINISTIC: a fixed seed, the core's fixed
 * step, and every body that matters PLACED by the script rather than left to
 * the AI to happen to bring there. Imports nothing from `@babylonjs/core`
 * (`scripts/check-babylon-free.mjs` holds this directory).
 * Never: reach into `Game` or the page. A case that cannot be set up through a
 * person's door is driven through the door the CORE itself calls, and each
 * case below says which door it uses.
 *
 * **Why it exists** (`BABYLON_EXIT.md` X2.5a C3): the offline page hosts the
 * core the authority hosts (since C4a), and `simulate` cannot see a
 * person — it seats nobody, so every rule about a person's death, a person's
 * award and a person's seat had no instrument at all. This is that
 * instrument, and the second half is the point: the same script run through
 * `Match`'s VALIDATED door (a fake socket, the client messages a real one
 * would send, every claim gate in the path) must leave the identical award
 * and death list — the scoring rules exercised offline and online.
 *
 * **The hosts.** `CoreHost` is the TRUSTED door, the offline page's shape:
 * it submits each of the person's acts as a `SimCommand`
 * (`src/sim/commands.ts`) with nothing in front of it. `MatchHost` is the
 * VALIDATED door: a real `Match`, its loop timer stopped so the script steps
 * it by hand, fed JSON through the socket's own `message` handler — every
 * claim gate runs and then `Match` submits the same command. So the identity
 * below is the proof that the two doors agree: the rules are the core's, once
 * (`SimCore.submit`), and nothing in either host restates one. Each records
 * every event the core drained, in order, raw (`Log`). Setup that no person's
 * message could do — placing a body, setting a flag's owner, lowering a
 * victim's health, seating a bot crew — is done identically on both, between
 * calls, on the live core; it is a fixture, not a door.
 *
 * Two cases are the core's alone, on a core built as the offline page builds
 * it. `holdsRespawn`: a core built with `hostHoldsRespawn` — the offline
 * page's respawn clock — must honour a deploy AT SUBMIT through the same door
 * and the same spawn stream the authority's reinforcement pass uses, where the
 * default core (above) keeps the request until its own clock runs out.
 * `reportedHull` (X2.5a C4b): a person's hull is POSED from their `drive` and
 * `gun` reports — the page's predicted hull offline, a peer's on the
 * authority — and the shell asked between the step and the next report leaves
 * the reported pose's muzzle.
 *
 * And `crashCalibration` (`sarab/crash`, FINDINGS.md 60), on botless Sarab:
 * scripted flights of the person's helicopter — hard, firm, under the
 * threshold, gentle, a late flare, a landing at speed, a low cruise with a
 * climb and a descent — flown once by `Vehicle.update` (the bot path, its own
 * crash charging it) and then REPORTED to a core with the person in the seat:
 * every step (the offline page: the same charge to float noise), at `INPUT_HZ`
 * on jittered whole-ms stamps (a match's client: within the clock's slack),
 * and the same uploads through `Match` (the identical charge, the snapshot's
 * `hp` saying so, nothing corrected). It prints the calibration table.
 *
 * The person is always slot 0, team 0: the first seat `Roster.claim` hands
 * out, which `MatchHost` asserts. `-- --list` also prints each map's event
 * counts and the award/death list the hosts are compared on.
 */
import { createHash, type Hash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { WebSocket } from "ws";
import { CONFIG } from "../src/config";
import { Vector3, type Vector3Like } from "../src/math";
import { INPUT_HZ, TICK_HZ } from "../src/net/protocol";
import type { Bot } from "../src/entities/Bot";
import type { Team } from "../src/entities/Combatant";
import type { DriveInput, Vehicle } from "../src/entities/Vehicle";
import { DRIVER, GUNNER, type CrewSeat } from "../src/entities/hullSeats";
import { DEFAULT_WEAPON, PRIMARY_SLOT, weaponSetup } from "../src/entities/weapons";
import { DEFAULT_EQUIPMENT, equipmentSetup } from "../src/entities/equipment";
import { DEFAULT_THROWABLE, throwableCarried } from "../src/entities/throwables";
import { perTeamOf } from "../src/world/layout";
import { crushSweep, type HullRules } from "../src/systems/hullRules";
import type { ControlPoint } from "../src/systems/ConquestSystem";
import { MAPS, type MapDef } from "../src/world/maps";
import type { MapCollision } from "../src/world/collision";
import type { Heightfield } from "../src/world/layout";
import { SimCore, type RoundSpec, type SimCoreOptions } from "../src/sim/SimCore";
import type { KitCommand } from "../src/sim/commands";
import type { SimPlayer } from "../src/sim/SimPlayer";
import { SimMirror } from "../src/sim/mirror";
import { simCheck } from "../src/sim/simCheck";
import {
  EV,
  EventCursor,
  STRIDE,
  decode,
  type SimEvent,
  type Vec3,
} from "../src/sim/events";
import { Match } from "./Match";
import { claimedDir } from "./claimGates";
import { loadSimWorld } from "./world";

const SEED = 777;
const DT = 1 / TICK_HZ;
/** The wall-clock anchor both hosts give `SimCore.now`, so a shot's render time is the same number on both. */
const ANCHOR = 1_000_000_000_000;
const PERSON_SLOT = 0;
const PERSON_TEAM: Team = 0;
/** Ticks the respawn clock holds a body down for — `SimCore.step`'s countdown. */
const RESPAWN_TICKS = Math.round(CONFIG.conquest.respawnDelay * TICK_HZ);

// ---------------------------------------------------------------------------
// What a host heard.

/**
 * Every event a host drained, decoded for the assertions and folded RAW into
 * a hash: the kind byte, the tick, all `STRIDE` float64s of the record (NaN
 * normals and the zero-filled tail included) and a glass event's pane run.
 * Each drain's cursor and decoded batch are also put through
 * `structuredClone` and compared back, which is the transfer X2.5b will make.
 */
class Log {
  readonly events: SimEvent[] = [];
  private readonly hash: Hash = createHash("sha256");
  cloneFailures = 0;
  drains = 0;

  absorb(c: EventCursor): void {
    this.drains++;
    const batch: SimEvent[] = [];
    const head = Buffer.alloc(5);
    for (let i = 0; i < c.count; i++) {
      head.writeUInt8(c.kinds[i], 0);
      head.writeUInt32LE(c.ticks[i], 1);
      this.hash.update(head);
      this.hash.update(
        Buffer.from(c.data.buffer, c.data.byteOffset + i * STRIDE * 8, STRIDE * 8),
      );
      if (c.kinds[i] === EV.glass) {
        const start = c.data[i * STRIDE + 6];
        const n = c.data[i * STRIDE + 7];
        const ints = c.ints.subarray(start, start + n);
        this.hash.update(Buffer.from(ints.buffer, ints.byteOffset, ints.byteLength));
      }
      batch.push(decode(c, i));
    }
    if (c.count > 0) {
      const raw = {
        kinds: c.kinds.slice(0, c.count),
        ticks: c.ticks.slice(0, c.count),
        data: c.data.slice(0, c.count * STRIDE),
        ints: c.ints.slice(),
      };
      if (!isDeepStrictEqual(structuredClone(raw), raw)) this.cloneFailures++;
      if (!isDeepStrictEqual(structuredClone(batch), batch)) this.cloneFailures++;
    }
    for (const ev of batch) this.events.push(ev);
  }

  digest(): string {
    return this.hash.copy().digest("hex").slice(0, 16);
  }
}

/** Every `award` and `death`, in order, with its tick — the list the two hosts must agree on. */
function scoreList(events: readonly SimEvent[]): string[] {
  const out: string[] = [];
  for (const ev of events) {
    if (ev.type === "award") out.push(`${ev.tick} award ${ev.slot} ${ev.kind} ${ev.points} ${ev.person ? 1 : 0}`);
    else if (ev.type === "death") out.push(`${ev.tick} death ${ev.slot} ${ev.cause} ${ev.credited ? 1 : 0}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The two hosts.

interface World {
  def: MapDef;
  collision: MapCollision;
  floor: Heightfield | undefined;
}

/** What a scenario may do. The first group are a PERSON's doors; `step` and `flush` are the host's. */
interface Host {
  readonly name: string;
  readonly core: SimCore;
  readonly log: Log;
  player(): SimPlayer;
  /** Ask to come back at spawn `spawn` — Match's `deploy`. */
  deploy(spawn: number): Promise<void>;
  /** Report a look without moving — Match's `move`, at the body's own position. */
  aim(yaw: number, pitch: number): Promise<void>;
  /** A round fired from `origin` toward `dir` (unnormalised) — Match's `shot`. */
  shot(origin: Vector3Like, dir: Vec3): Promise<void>;
  mount(tank: number, seat: CrewSeat): Promise<void>;
  dismount(): Promise<void>;
  step(): void;
  /** Drain whatever a fixture's direct call on the core raised. */
  flush(): void;
}

/** The person's kit as `Match.setKit` resolves the defaults — the `kit` it submits. */
const KIT: KitCommand = {
  t: "kit",
  grenades: throwableCarried(DEFAULT_THROWABLE),
  ordnance: equipmentSetup(DEFAULT_EQUIPMENT).magSize,
};

const RIFLE = weaponSetup(DEFAULT_WEAPON);

/**
 * The round both hosts build: `Match`'s pool and fielding, the script's seed.
 * `fielded` 0 is a botless round — `Match`'s `bots: false`.
 */
function roundOf(world: World, fielded = perTeamOf(world.def.layout)): RoundSpec {
  return {
    ...world,
    difficulty: 1,
    pool: CONFIG.bots.maxPerTeam,
    fielded,
    seed: SEED,
  };
}

/**
 * The trusted door: every act a `SimCommand`, submitted with nothing in front
 * of it. Built with `rewind` and handed the shooter's render time as `Match`
 * hands the client's, so a round meets the same rewound world on both hosts.
 */
class CoreHost implements Host {
  readonly name = "core";
  readonly core: SimCore;
  readonly log = new Log();
  private readonly cursor = new EventCursor();
  private readonly dir = new Vector3();
  /**
   * With `mirror`, the page's readers (`src/sim/mirror.ts`) off a structured
   * clone of the core's frame, held against the live core by `simCheck`
   * after every drain — the page's `?simcheck` and `?simcopy` together, with
   * the PERSON paths in it that a bench never has.
   */
  private readonly mirror: SimMirror | null;
  /** `simCheck` passes run and mismatches summed, and the first few by name. */
  readonly mirrorChecks = { passes: 0, mismatches: 0, first: [] as string[] };

  constructor(options: SimCoreOptions = { rewind: true }, mirror = false) {
    this.core = new SimCore(mirror ? { ...options, publish: true } : options);
    this.mirror = mirror ? new SimMirror() : null;
  }

  start(world: World, fielded?: number): void {
    this.core.startRound(roundOf(world, fielded));
    this.core.anchor(ANCHOR);
    this.flush();
    this.core.addPlayer(PERSON_SLOT, PERSON_TEAM);
    this.flush();
    this.core.submit(PERSON_SLOT, KIT);
    this.flush();
  }

  player(): SimPlayer {
    return this.core.players.get(PERSON_SLOT)!;
  }

  flush(): void {
    this.core.drain(this.cursor);
    this.log.absorb(this.cursor);
    if (!this.mirror) return;
    // Published again first: a fixture may have written the core directly,
    // which no door of the core's publishes (`SimCore.publish`'s note).
    this.core.publish();
    this.mirror.sync(structuredClone(this.core.frame));
    const tally = this.mirrorChecks;
    tally.passes++;
    tally.mismatches += simCheck(this.core, this.mirror, {}, (what) => {
      if (tally.first.length < 8) tally.first.push(`tick ${this.core.tick} ${what}`);
    });
  }

  /** `Match.onDeploy`'s two submits: the kit the deploy confirms, then the ask. */
  async deploy(spawn: number): Promise<void> {
    this.core.submit(PERSON_SLOT, KIT);
    this.core.submit(PERSON_SLOT, { t: "deploy", spawn });
    this.flush();
  }

  async aim(yaw: number, pitch: number): Promise<void> {
    const p = this.player().position;
    this.core.submit(PERSON_SLOT, {
      t: "move",
      dt: 0.1,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw,
      pitch,
      crouch: false,
      sprint: false,
    });
    this.flush();
  }

  async shot(origin: Vector3Like, dir: Vec3): Promise<void> {
    // The direction a round flew is a unit vector — `claimedDir` is the
    // normalisation `Match` applies to the client's before it submits.
    if (!claimedDir(dir, this.dir)) return;
    this.core.submit(PERSON_SLOT, {
      t: "shot",
      origin: { x: origin.x, y: origin.y, z: origin.z },
      dir: this.dir,
      weapon: RIFLE,
      renderTime: this.core.now,
    });
    this.flush();
  }

  async mount(tank: number, seat: CrewSeat): Promise<void> {
    this.core.submit(PERSON_SLOT, { t: "mount", tank, seat });
    this.flush();
  }

  async dismount(): Promise<void> {
    this.core.submit(PERSON_SLOT, { t: "dismount" });
    this.flush();
  }

  step(): void {
    this.core.step(DT);
    this.flush();
  }
}

/** A `ws` socket as `Match` uses one: records what is sent, delivers what the script says. */
class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  readonly frames: Array<{ t: string; [k: string]: unknown }> = [];
  private readonly handlers = new Map<string, (data: unknown) => void>();

  on(event: string, fn: (data: unknown) => void): this {
    this.handlers.set(event, fn);
    return this;
  }
  send(data: string): void {
    this.frames.push(JSON.parse(data));
  }
  ping(): void {}
  close(): void {
    this.readyState = 3;
  }
  deliver(msg: object): void {
    this.handlers.get("message")?.(JSON.stringify(msg));
  }
}

/** Waits out `RateGate`'s wall-clock spacing so the rifle's bucket is never what refuses a scripted round. */
const settle = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The authority: a real `Match`, stepped by hand, fed through its socket's own handler. */
class MatchHost implements Host {
  readonly name = "match";
  readonly match: Match;
  readonly core: SimCore;
  readonly log = new Log();
  readonly socket = new FakeSocket();
  private seq = 0;
  private clock = 1000;

  constructor(def: MapDef, bots = true) {
    this.match = new Match("corecheck", def.id, bots);
    this.core = this.match.game;
    // Hear every drain `Match` makes — the tee is the whole of the
    // instrumentation, and `relay` still gets the cursor as it always did.
    const drain = this.core.drain.bind(this.core);
    this.core.drain = (out) => {
      drain(out);
      this.log.absorb(out);
    };
  }

  async start(world: World, fielded?: number): Promise<void> {
    // The round is built BEFORE the first peer arrives, from the same seed
    // and anchor as the core run, so `Match.start` finds a map standing and
    // skips its own `freshSeed()` round.
    this.core.startRound(roundOf(world, fielded));
    this.core.anchor(ANCHOR);
    await this.match.admit(this.socket as unknown as WebSocket, "corecheck");
    // No macrotask has run since `start` armed the loop: stopped before its
    // first tick, so every step from here is the script's.
    clearInterval(this.match["timer"] ?? undefined);
    const welcome = this.socket.frames.find((f) => f.t === "welcome");
    if (welcome?.slot !== PERSON_SLOT || welcome?.team !== PERSON_TEAM) {
      throw new Error(`Match seated the peer at slot ${welcome?.slot} team ${welcome?.team}`);
    }
  }

  player(): SimPlayer {
    return this.core.players.get(PERSON_SLOT)!;
  }

  flush(): void {
    this.match["relay"]();
  }

  async deploy(spawn: number): Promise<void> {
    this.socket.deliver({ t: "deploy", spawn });
  }

  async aim(yaw: number, pitch: number): Promise<void> {
    const p = this.player().position;
    this.clock += 100;
    this.socket.deliver({
      t: "move",
      seq: ++this.seq,
      time: this.clock,
      pos: [p.x, p.y, p.z],
      yaw,
      pitch,
      crouching: false,
      sprinting: false,
    });
  }

  async shot(origin: Vector3Like, dir: Vec3): Promise<void> {
    await settle(RIFLE.shotInterval * 1000 + 20);
    this.socket.deliver({
      t: "shot",
      seq: ++this.seq,
      time: this.core.now,
      origin: [origin.x, origin.y, origin.z],
      dir,
      slot: PRIMARY_SLOT,
    });
  }

  async mount(tank: number, seat: CrewSeat): Promise<void> {
    this.socket.deliver({ t: "mount", tank, seat });
  }

  async dismount(): Promise<void> {
    this.socket.deliver({ t: "dismount" });
  }

  step(): void {
    this.match["step"]();
  }

  /** Every event of kind `e` the peer was sent, in order. */
  wireEvents(e: string): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const f of this.socket.frames) {
      if (f.t !== "events") continue;
      for (const ev of f.events as Array<Record<string, unknown>>) if (ev.e === e) out.push(ev);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Assertions.

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

class Checks {
  readonly results: Result[] = [];
  constructor(readonly tag: string) {}
  that(name: string, ok: boolean, detail = ""): boolean {
    this.results.push({ name, ok, detail });
    return ok;
  }
  get failed(): Result[] {
    return this.results.filter((r) => !r.ok);
  }
}

/** Events since `mark`. */
function since(h: Host, mark: number): SimEvent[] {
  return h.log.events.slice(mark);
}

function awardsOf(evs: readonly SimEvent[], slot: number): string[] {
  const out: string[] = [];
  for (const ev of evs) if (ev.type === "award" && ev.slot === slot) out.push(ev.kind);
  return out;
}

function deathOf(evs: readonly SimEvent[], slot: number): Extract<SimEvent, { type: "death" }> | null {
  for (const ev of evs) if (ev.type === "death" && ev.slot === slot) return ev;
  return null;
}

function fmtDeath(d: Extract<SimEvent, { type: "death" }> | null): string {
  return d ? `death ${d.slot} ${d.cause} credited=${d.credited}` : "no death";
}

// ---------------------------------------------------------------------------
// Fixtures — the same calls on either host.

function map(h: Host) {
  return h.core.map!;
}

function groundY(h: Host, x: number, z: number): number {
  return map(h).terrain.heightAt(x, z);
}

/** A spot a body can stand on: inside the play square, on the floor, no wall through it. */
function standable(h: Host, x: number, z: number): boolean {
  const m = map(h);
  const half = m.size / 2 - 3;
  if (Math.abs(x) > half || Math.abs(z) > half) return false;
  const y = groundY(h, x, z);
  return !m.obstacles.wallAt(x, z, y + 0.35, y + 2);
}

function placePerson(h: Host, x: number, y: number, z: number): void {
  const p = h.player();
  p.apply(0, x, y, z, p.yaw, p.pitch, false, false);
}

/** A bot put down at `x, z` — and recorded, so a rewind to `now` finds it there rather than a tick back. */
function placeBot(h: Host, bot: Bot, x: number, z: number): void {
  bot.nudgeTo({ x, y: groundY(h, x, z), z });
  h.core.lag.record(h.core.now);
}

function slotOfBot(h: Host, bot: Bot): number {
  return h.core.battle.bots.indexOf(bot);
}

/** Living, fielded bots of `team` that nothing has taken out of the fight. */
function freeBots(h: Host, team: Team, used: ReadonlySet<Bot>): Bot[] {
  return h.core.battle.bots.filter(
    (b) => b.alive && b.team === team && !h.core.battle.aside(b) && !used.has(b),
  );
}

function homeSpawn(h: Host, team: Team): number {
  return map(h).spawns.findIndex((s) => s.team === team);
}

/** Steps until slot 0 deploys; returns the tick it did, or -1. */
function stepUntilSpawned(h: Host, limit: number): number {
  for (let i = 0; i < limit; i++) {
    const mark = h.log.events.length;
    h.step();
    for (const ev of since(h, mark)) {
      if (ev.type === "spawned" && ev.slot === PERSON_SLOT) return ev.tick;
    }
  }
  return -1;
}

/** Turns the person to look from its eye at `to`, then fires there. Returns the events the round raised. */
async function shootAt(h: Host, to: Vector3Like): Promise<SimEvent[]> {
  const p = h.player();
  const eye = p.eyePos;
  const dx = to.x - eye.x;
  const dy = to.y - eye.y;
  const dz = to.z - eye.z;
  await h.aim(Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz)));
  const mark = h.log.events.length;
  await h.shot({ x: eye.x, y: eye.y, z: eye.z }, [dx, dy, dz]);
  return since(h, mark);
}

/**
 * A line through `point` with clear sight both ways: an INNER spot a few
 * metres from its centre and an OUTER one past its radius, on the first of
 * sixteen bearings where both are standable and nothing solid lies between
 * them at body height. Deterministic: the same map answers the same bearing.
 */
function lineThrough(h: Host, point: ControlPoint): { inner: Vector3; outer: Vector3 } | null {
  const { pos, radius } = point.def;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const ux = Math.sin(a);
    const uz = Math.cos(a);
    for (const r of [0, 2, 4]) {
      const ix = pos.x + ux * r;
      const iz = pos.z + uz * r;
      const ox = pos.x + ux * (radius + 4);
      const oz = pos.z + uz * (radius + 4);
      if (r >= radius - 1 || !standable(h, ix, iz) || !standable(h, ox, oz)) continue;
      const inner = new Vector3(ix, groundY(h, ix, iz), iz);
      const outer = new Vector3(ox, groundY(h, ox, oz), oz);
      const eyeIn = new Vector3(ix, inner.y + 1.55, iz);
      const eyeOut = new Vector3(ox, outer.y + 1.55, oz);
      const chestIn = new Vector3(ix, inner.y + 0.9, iz);
      const chestOut = new Vector3(ox, outer.y + 0.9, oz);
      const rays = map(h).rays;
      if (rays.blocked(eyeOut, chestIn) || rays.blocked(eyeIn, chestOut)) continue;
      if (rays.blocked(eyeOut, new Vector3(ix, inner.y + 1.55, iz))) continue;
      return { inner, outer };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The scripts.

/**
 * Greyfen: the kill awards keyed on the VICTIM's flag, a capture, the leash
 * and the respawn clock.
 */
async function greyfen(h: Host, c: Checks): Promise<void> {
  const core = h.core;
  const used = new Set<Bot>();

  // --- deploy: nobody unasked comes in, an ask is honoured -----------------
  // Door: `deploy` (`SimCore.submit` → `SimPlayer.deployRequest`), spent by the
  // reinforcement pass in `SimCore.step`.
  for (let i = 0; i < 30; i++) h.step();
  c.that(
    "deploy: an unasked person is never put in (30 ticks, no spawned)",
    !h.log.events.some((e) => e.type === "spawned") && !h.player().alive,
  );
  await h.deploy(homeSpawn(h, PERSON_TEAM));
  const first = stepUntilSpawned(h, 120);
  c.that("deploy: an ask with the clock run out deploys on the next tick", first > 0, `spawned at ${first}`);
  if (first < 0) return;

  // --- the kill awards, keyed on the VICTIM's flag -------------------------
  // Door: `shot` (Match.onShot's rate/cone/origin gates → `SimCore.submit` →
  // `resolveShot`, rewind at `now`). Fixture: the victim is placed and its
  // health lowered so one round settles it; the flag's owner is set.
  let line: { inner: Vector3; outer: Vector3 } | null = null;
  let flag: ControlPoint | null = null;
  for (const p of core.conquest.points) {
    line = lineThrough(h, p);
    if (line) {
      flag = p;
      break;
    }
  }
  if (!c.that("fixture: a flag with a clear line through it", !!line && !!flag) || !line || !flag) return;
  const flagIndex = core.conquest.points.indexOf(flag);

  const killCase = async (
    name: string,
    owner: Team | null,
    killerAt: Vector3,
    victimAt: Vector3,
    head: boolean,
    expect: string[],
  ): Promise<void> => {
    flag!.owner = owner;
    flag!.meter = owner === null ? 0 : owner === 0 ? -1 : 1;
    const victim = freeBots(h, 1, used)[0];
    if (!c.that(`${name}: a living enemy to shoot`, !!victim) || !victim) return;
    used.add(victim);
    victim.hp = 1;
    placePerson(h, killerAt.x, killerAt.y, killerAt.z);
    placeBot(h, victim, victimAt.x, victimAt.z);
    const slot = slotOfBot(h, victim);
    const target = head ? victim.eyePos : victim.center;
    const evs = await shootAt(h, { x: target.x, y: target.y, z: target.z });
    const hit = evs.find((e) => e.type === "hit");
    const awards = awardsOf(evs, PERSON_SLOT);
    const death = deathOf(evs, slot);
    const zone = core.conquest.pointAt(victim.eyePos);
    const killerZone = core.conquest.pointAt(h.player().eyePos);
    c.that(
      `${name}: awards ${expect.join("+")}`,
      isDeepStrictEqual(awards, expect) &&
        hit?.type === "hit" && hit.victim === slot && hit.killed && hit.head === head &&
        death?.cause === "round" && death.credited,
      `awards [${awards.join(",")}], ${fmtDeath(death)}, victim zone ${zone?.def.id ?? "none"}, killer zone ${killerZone?.def.id ?? "none"}`,
    );
  };

  // Killer OUTSIDE, victim INSIDE a flag the enemy holds: an attack.
  await killCase("attack (victim in enemy flag, killer outside)", 1, line.outer, line.inner, false, ["kill", "attack"]);
  // Killer OUTSIDE, victim INSIDE a flag the killer's side holds: a defence.
  await killCase("defend (victim in own flag, killer outside)", 0, line.outer, line.inner, false, ["kill", "defend"]);
  // The same, through the head zone: the headshot is an upgrade, the zone still the victim's.
  await killCase("headshot (victim in own flag)", 0, line.outer, line.inner, true, ["kill", "headshot", "defend"]);
  // Killer INSIDE the flag, victim OUTSIDE it: no zone bonus, whoever stands where.
  await killCase("no bonus (killer in flag, victim outside)", 0, line.inner, line.outer, false, ["kill"]);

  // --- a capture pays the bodies present, and never a benched bot ----------
  // Door: `ConquestSystem.update` inside `SimCore.step` (its `onCaptured` →
  // `awardZone`). Fixture: the person, one fielded teammate and the BENCHED
  // bot of the person's own slot all stood in the ring; the meter one step
  // short of team 0's end.
  {
    const mate = freeBots(h, 0, used)[0];
    const benched = core.battle.bots[PERSON_SLOT];
    if (c.that("capture: a living teammate", !!mate) && mate) {
      used.add(mate);
      placePerson(h, line.inner.x, line.inner.y, line.inner.z);
      flag.owner = null;
      flag.meter = -0.999;
      const mateSlot = slotOfBot(h, mate);
      let captured = false;
      let evs: SimEvent[] = [];
      for (let i = 0; i < 10 && !captured; i++) {
        placeBot(h, mate, line.inner.x + 1.2, line.inner.z);
        benched.nudgeTo({ x: line.inner.x - 1.2, y: line.inner.y, z: line.inner.z });
        const mark = h.log.events.length;
        h.step();
        evs = since(h, mark);
        captured = evs.some((e) => e.type === "captured" && e.point === flagIndex && e.by === 0);
      }
      const paid = evs.filter((e) => e.type === "award" && e.kind === "capture");
      const personPaid = paid.filter((e) => e.type === "award" && e.slot === PERSON_SLOT);
      const matePaid = paid.filter((e) => e.type === "award" && e.slot === mateSlot);
      const capIdx = evs.findIndex((e) => e.type === "captured");
      let lastPay = -1;
      evs.forEach((e, i) => {
        if (e.type === "award" && e.kind === "capture") lastPay = i;
      });
      c.that(
        "capture: paid to the person and the teammate standing in it, once each, before the news",
        captured && personPaid.length === 1 && matePaid.length === 1 &&
          personPaid[0].type === "award" && personPaid[0].person && lastPay < capIdx,
        `captured=${captured}, capture awards to [${paid.map((e) => (e.type === "award" ? e.slot : -1)).join(",")}]`,
      );
      c.that(
        "capture: the benched bot in the ring is not alive and earned nothing on its slot",
        !benched.alive && core.battle.aside(benched) && personPaid.length === 1,
        `benched alive=${benched.alive} aside=${core.battle.aside(benched)}`,
      );
    }
  }

  // --- the leash: killer -1, cause `other`; then the respawn clock ---------
  // Door: the leash clock in `SimCore.step` (`SimPlayer.takeDamage` with no
  // origin). Fixture: the person stood just past the play square's edge.
  {
    const m = map(h);
    const x = m.size / 2 + 6;
    const z = 0;
    placePerson(h, x, groundY(h, x, z), z);
    let died = -1;
    let evs: SimEvent[] = [];
    for (let i = 0; i < Math.ceil(CONFIG.map.leash.seconds * TICK_HZ) + 30 && died < 0; i++) {
      const mark = h.log.events.length;
      h.step();
      const now = since(h, mark);
      if (deathOf(now, PERSON_SLOT)) {
        died = now[0]?.tick ?? -1;
        evs = now;
      }
    }
    const dmg = evs.find((e) => e.type === "damaged" && e.slot === PERSON_SLOT);
    const death = deathOf(evs, PERSON_SLOT);
    c.that(
      "leash: the person dies out of bounds, from nobody, filed `other` and uncredited",
      died > 0 && dmg?.type === "damaged" && dmg.from === null && dmg.killed &&
        death?.cause === "other" && !death.credited &&
        !evs.some((e) => e.type === "award"),
      `died at ${died} after ${died - first} ticks out, ${fmtDeath(death)}, from=${dmg?.type === "damaged" ? JSON.stringify(dmg.from) : "?"}`,
    );

    // Door: `deploy`, asked at once — KEPT and not honoured until the clock
    // the death armed has run out.
    await h.deploy(homeSpawn(h, PERSON_TEAM));
    let early = false;
    let back = -1;
    for (let i = 0; i < RESPAWN_TICKS + 30 && back < 0; i++) {
      const mark = h.log.events.length;
      h.step();
      for (const ev of since(h, mark)) {
        if (ev.type === "spawned" && ev.slot === PERSON_SLOT) back = ev.tick;
      }
      if (back < 0 && h.player().alive) early = true;
    }
    c.that(
      `deploy: refused until respawnT runs out (${RESPAWN_TICKS} ticks), honoured after`,
      died > 0 && !early && back - died >= RESPAWN_TICKS,
      `died ${died}, spawned ${back} (+${back - died})`,
    );
  }
}

/** Coldharbour: the hull cases — a crew's shell and its tracks, a hull that pays nobody, a crew filed `crew`, seat and evict. */
async function coldharbour(h: Host, c: Checks): Promise<void> {
  const core = h.core;
  const hulls = core.vehicles.hulls;
  const t0 = hulls.findIndex((t) => t.team === 0);
  const t1 = hulls.findIndex((t) => t.team === 1 && !!t.spec.gun);
  if (!c.that("fixture: a hull a side", t0 >= 0 && t1 >= 0) || t0 < 0 || t1 < 0) return;
  const own = hulls[t0];
  const enemy = hulls[t1];
  const used = new Set<Bot>();

  await h.deploy(homeSpawn(h, PERSON_TEAM));
  if (!c.that("deploy: the person comes in", stepUntilSpawned(h, 120) > 0)) return;
  // Long enough for both sides' first reinforcements to be standing.
  for (let i = 0; i < 30; i++) h.step();

  /** `tank`'s `seat` crewed by a bot — the one already in it, or one TAKEN (`VehicleCrew`'s own boarding door). */
  const crewed = (tank: Vehicle, seat: CrewSeat): Bot | null => {
    const held = core.crew.crewOf(tank, seat);
    if (held) return held;
    if (tank.seats[seat]) return null;
    const bot = freeBots(h, tank.team, used)
      .sort((a, b) => Vector3.DistanceSquared(a.position, tank.center) - Vector3.DistanceSquared(b.position, tank.center))[0];
    if (!bot) return null;
    core.crew["take"](bot, tank, seat);
    h.flush();
    return bot;
  };
  const respawn = async (): Promise<boolean> => {
    await h.deploy(homeSpawn(h, PERSON_TEAM));
    return stepUntilSpawned(h, RESPAWN_TICKS + 60) > 0;
  };
  const rules = core["hullRules"] as HullRules;

  // --- a bot crew's SHELL on the person: credited to the bot ---------------
  // Door: `SimCore.resolveShell(tank, crewman)` — exactly what the crew's
  // `fireShell` calls. Fixture: the person stood three metres down the gun.
  {
    const gunner = crewed(enemy, DRIVER);
    if (c.that("shell: the enemy hull has a bot on the gun", !!gunner && enemy.gunReady) && gunner) {
      const muzzle = enemy.muzzleToRef(new Vector3());
      const dir = enemy.gunDirToRef(new Vector3());
      const at = new Vector3(muzzle.x + dir.x * 3, muzzle.y + dir.y * 3, muzzle.z + dir.z * 3);
      const p = h.player();
      placePerson(h, at.x, at.y, at.z);
      placePerson(h, at.x, at.y - (p.center.y - p.position.y), at.z);
      const mark = h.log.events.length;
      const fired = core["resolveShell"](enemy, gunner);
      h.flush();
      const evs = since(h, mark);
      const death = deathOf(evs, PERSON_SLOT);
      const slot = slotOfBot(h, gunner);
      const dmg = evs.find((e) => e.type === "damaged" && e.slot === PERSON_SLOT && e.killed);
      c.that(
        "shell: a bot crew's shell kills the person, filed by its door and credited, the kill on the bot's row",
        fired && !!death && (death.cause === "shell" || death.cause === "blast") && death.credited &&
          awardsOf(evs, slot)[0] === "kill" && dmg?.type === "damaged" && dmg.from !== null,
        `fired=${fired}, ${fmtDeath(death)}, bot slot ${slot} awards [${awardsOf(evs, slot).join(",")}]`,
      );
    }
  }

  // --- a bot crew's TRACKS on the person: credited to the driver -----------
  // Door: `crushSweep(hullRules)` — the call `SimCore.step` makes right after
  // `VehicleSystem.update`. Fixture: the hull given its crush speed and the
  // person stood inside its footprint.
  if (c.that("crush: the person redeploys", await respawn())) {
    const driver = crewed(enemy, DRIVER);
    if (c.that("crush: the enemy hull has a bot driving", !!driver && enemy.alive) && driver) {
      const speed = enemy.speed;
      enemy.speed = enemy.spec.crush.minSpeed + 0.5;
      placePerson(h, enemy.center.x, enemy.position.y, enemy.center.z);
      const mark = h.log.events.length;
      crushSweep(rules);
      h.flush();
      enemy.speed = speed;
      const evs = since(h, mark);
      const death = deathOf(evs, PERSON_SLOT);
      const slot = slotOfBot(h, driver);
      const crushed = evs.find((e) => e.type === "crushed");
      c.that(
        "crush: the tracks kill the person, filed `tracks`, credited, the kill on the driver's row",
        death?.cause === "tracks" && death.credited && awardsOf(evs, slot)[0] === "kill" &&
          crushed?.type === "crushed" && crushed.tank === t1 && crushed.by === slot &&
          crushed.victim === PERSON_SLOT && crushed.victimKind === "person",
        `${fmtDeath(death)}, driver slot ${slot} awards [${awardsOf(evs, slot).join(",")}]`,
      );
    }
  }

  // --- seat and evict ------------------------------------------------------
  // Doors: `mount` and `dismount` (`SimCore.submit`: the core's seat policy
  // around `seat`, one copy for both hosts). Fixture: both chairs of the person's own hull crewed by
  // bots, the person stood at its exit spot.
  if (c.that("seat: the person redeploys", await respawn())) {
    const driver = crewed(own, DRIVER);
    const gunner = crewed(own, GUNNER);
    if (c.that("seat: both chairs of the own hull held by bots", !!driver && !!gunner) && driver && gunner) {
      const spot = core.vehicles.exitSpot(own);
      placePerson(h, spot.x, spot.y, spot.z);
      let mark = h.log.events.length;
      await h.mount(t0, DRIVER);
      let evs = since(h, mark);
      const seat = evs.find((e) => e.type === "seat");
      const p = h.player();
      c.that(
        "seat: a mount on a full own hull turns the bot driver out and seats the person",
        seat?.type === "seat" && seat.slot === PERSON_SLOT && seat.tank === t0 && seat.seat === DRIVER &&
          p.seat === t0 && p.crewSeat === DRIVER && p.invulnerable &&
          core.crew.crewOf(own, DRIVER) === null && core.crew.crewOf(own, GUNNER) === gunner &&
          !core.battle.aside(driver) && driver.alive,
        `seat event ${JSON.stringify(seat)}, player seat ${p.seat}/${p.crewSeat}`,
      );
      mark = h.log.events.length;
      await h.dismount();
      evs = since(h, mark);
      const out = evs.find((e) => e.type === "seat");
      c.that(
        "seat: a dismount puts the person down on foot and frees the chair",
        out?.type === "seat" && out.tank === -1 && p.seat === -1 && !p.invulnerable && !own.seats[DRIVER],
        `seat event ${JSON.stringify(out)}`,
      );
    }
  }

  // --- a hull pays nobody; its crew are filed `crew`, uncredited -----------
  // Door: `shot` — the person's rifle round on the enemy hull. Fixture: the
  // hull's health lowered so one round burns it, the person stood in clear
  // sight of it.
  {
    const crew = [core.crew.crewOf(enemy, DRIVER), core.crew.crewOf(enemy, GUNNER)].filter(
      (b): b is Bot => b !== null,
    );
    const p = h.player();
    let spot: Vector3 | null = null;
    for (let k = 0; k < 16 && !spot; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = enemy.center.x + Math.sin(a) * 10;
      const z = enemy.center.z + Math.cos(a) * 10;
      if (!standable(h, x, z)) continue;
      const eye = new Vector3(x, groundY(h, x, z) + 1.55, z);
      if (map(h).rays.blocked(eye, enemy.center, enemy)) continue;
      spot = new Vector3(x, groundY(h, x, z), z);
    }
    if (c.that("hull: a clear line to the enemy hull, a crew in it", !!spot && crew.length > 0 && p.alive) && spot) {
      placePerson(h, spot.x, spot.y, spot.z);
      enemy.health = 0.01;
      const evs = await shootAt(h, enemy.center);
      const hit = evs.find((e) => e.type === "hit" && e.shooter === PERSON_SLOT);
      const destroyed = evs.some((e) => e.type === "hullDestroyed" && e.tank === t1);
      const crewDeaths = crew.map((b) => deathOf(evs, slotOfBot(h, b)));
      const downs = evs.filter((e) => e.type === "botDown" && e.cause === "crew");
      c.that(
        "hull: the round that burns a hull pays the shooter nothing",
        destroyed && hit?.type === "hit" && hit.victimKind === "hull" && hit.killed &&
          awardsOf(evs, PERSON_SLOT).length === 0,
        `destroyed=${destroyed}, hit ${JSON.stringify(hit)}, awards [${awardsOf(evs, PERSON_SLOT).join(",")}]`,
      );
      c.that(
        `hull: its ${crew.length} bot crew die filed \`crew\`, uncredited, nobody paid`,
        crewDeaths.every((d) => d?.cause === "crew" && !d.credited) &&
          downs.length === crew.length && downs.every((e) => e.type === "botDown" && e.by === -1) &&
          !evs.some((e) => e.type === "award"),
        crewDeaths.map(fmtDeath).join("; "),
      );
    }
  }

  // --- a PERSON riding a hull that burns: `crew`, uncredited ---------------
  // Door: `Vehicle.takeDamage` — what every round and blast calls on a hull —
  // raising `VehicleSystem.onDestroyed`. Fixture: the hull's health lowered.
  {
    const p = h.player();
    const spot = core.vehicles.exitSpot(own);
    placePerson(h, spot.x, spot.y, spot.z);
    await h.mount(t0, DRIVER);
    if (c.that("burn: the person is aboard the own hull", p.seat === t0)) {
      own.health = 0.01;
      const mark = h.log.events.length;
      own.takeDamage(1, enemy.center, "shell");
      h.flush();
      const evs = since(h, mark);
      const death = deathOf(evs, PERSON_SLOT);
      const out = evs.find((e) => e.type === "seat" && e.slot === PERSON_SLOT);
      c.that(
        "burn: a person going up with the hull is filed `crew`, uncredited, and put out of the seat",
        death?.cause === "crew" && !death.credited && out?.type === "seat" && out.tank === -1 &&
          !evs.some((e) => e.type === "award"),
        fmtDeath(death),
      );
    }
  }
}

/**
 * `hostHoldsRespawn`: a deploy honoured AT SUBMIT, through the same door.
 *
 * Two cores off one seed and one script — the default one (the authority's
 * respawn clock) and one built with `hostHoldsRespawn` (the offline page's) —
 * stepped to the same tick, where the person asks to come in. Door: `deploy`
 * (`SimCore.submit`), spent by `deployPerson` from either trigger. The default
 * core spends it in the reinforcement pass of the NEXT step; the held one in
 * the submit itself, one step sooner — and since that pass runs first in a
 * step, before any bot can draw a spawn, both spend the same draw of the
 * spawn stream: the same spot, the same bearing. Then the person is killed
 * (fixture: `SimPlayer.takeDamage`, the door every blow takes) and asks again
 * at once: the held core puts them straight back in with its own clock still
 * running, where the default core keeps the request until it runs out (the
 * greyfen script's last case).
 */
function holdsRespawn(world: World, c: Checks): void {
  const tag = "hostHoldsRespawn";
  const held = new CoreHost({ rewind: true, hostHoldsRespawn: true });
  const plain = new CoreHost();
  held.start(world);
  plain.start(world);
  for (let i = 0; i < 30; i++) {
    held.step();
    plain.step();
  }
  const spawn = homeSpawn(held, PERSON_TEAM);
  const spawnedIn = (h: CoreHost, mark: number) =>
    since(h, mark).find((e): e is Extract<SimEvent, { type: "spawned" }> => e.type === "spawned" && e.slot === PERSON_SLOT) ?? null;

  let mark = held.log.events.length;
  void held.deploy(spawn);
  const atSubmit = spawnedIn(held, mark);
  mark = plain.log.events.length;
  void plain.deploy(spawn);
  const plainAtSubmit = spawnedIn(plain, mark);
  plain.step();
  const plainNext = spawnedIn(plain, mark);
  c.that(
    `${tag}: a deploy is honoured at submit (tick ${atSubmit?.tick ?? "-"}), the default core's on its next step (${plainNext?.tick ?? "-"})`,
    !!atSubmit && held.player().alive && atSubmit.tick === held.core.tick &&
      !plainAtSubmit && !!plainNext && plainNext.tick === atSubmit.tick + 1,
  );
  c.that(
    `${tag}: one door, one spawn stream — the same spot and bearing as the reinforcement pass's`,
    !!atSubmit && !!plainNext && isDeepStrictEqual(atSubmit.pos, plainNext.pos) && atSubmit.yaw === plainNext.yaw,
    `held ${JSON.stringify(atSubmit?.pos)} ${atSubmit?.yaw} vs pass ${JSON.stringify(plainNext?.pos)} ${plainNext?.yaw}`,
  );

  // Killed, and asking again at once: the core's own clock has hardly moved.
  const p = held.player();
  const killed = p.takeDamage(p.health);
  held.flush();
  const respawnT = p.respawnT;
  mark = held.log.events.length;
  void held.deploy(spawn);
  const again = spawnedIn(held, mark);
  c.that(
    `${tag}: asked again the moment it died, honoured at once — the host holds the clock, not the core (${respawnT.toFixed(2)} s left on it)`,
    killed && respawnT > 0 && !!again && p.alive,
    `respawnT ${respawnT}, spawned ${JSON.stringify(again)}`,
  );
  // …and a deploy from a LIVING body is refused, held clock or not.
  mark = held.log.events.length;
  const refused = !held.core.submit(PERSON_SLOT, { t: "deploy", spawn });
  c.that(
    `${tag}: a living body's deploy is refused`,
    refused && !spawnedIn(held, mark),
  );
  held.core.dispose();
  plain.core.dispose();
}

/**
 * **A person's hull is REPORTED, never steered** (`BABYLON_EXIT.md` X2.5a C4b)
 * — the offline page's driver exactly as the authority's peer, so the door is
 * asserted on a core built as the page builds it (`hostHoldsRespawn`, no
 * rewind). A driver's `drive` is where the core's copy stands after its next
 * step — position, heading, the gun's bearing and elevation — with the person
 * riding it and the look on the body; the shell asked after that step leaves
 * the muzzle of the REPORTED pose; a gunner's `gun` is where the cupola gun
 * points; and a report from the wrong chair moves nothing.
 */
function reportedHull(world: World, c: Checks): void {
  const tag = "reported";
  const h = new CoreHost({ hostHoldsRespawn: true });
  h.start(world);
  const core = h.core;
  const t0 = core.vehicles.hulls.findIndex((t) => t.team === PERSON_TEAM && !!t.spec.gun);
  void h.deploy(homeSpawn(h, PERSON_TEAM));
  for (let i = 0; i < 10; i++) h.step();
  const p = h.player();
  if (!c.that(`${tag}: fixture — the person standing, an armed hull of their own`, t0 >= 0 && p.alive)) {
    core.dispose();
    return;
  }
  const tank = core.vehicles.hulls[t0];
  const spot = core.vehicles.exitSpot(tank);
  placePerson(h, spot.x, spot.y, spot.z);
  void h.mount(t0, DRIVER);
  const held = core.reportedHull(p);
  c.that(
    `${tag}: a mount as DRIVER puts the hull in \`driven\` where it stands`,
    p.seat === t0 && p.crewSeat === DRIVER && !!held &&
      held.x === tank.position.x && held.z === tank.position.z && held.yaw === tank.yaw,
    `seat ${p.seat}/${p.crewSeat}, held ${JSON.stringify(held)}`,
  );

  // One report a metre and a half up the road, turned, the turret swung.
  const x = tank.position.x + Math.sin(tank.yaw) * 1.5;
  const y = tank.position.y;
  const z = tank.position.z + Math.cos(tank.yaw) * 1.5;
  const yaw = tank.yaw + 0.05;
  const turretYaw = tank.turretYaw + 0.4;
  const gunPitch = 0.06;
  const took = core.submit(PERSON_SLOT, {
    t: "drive", x, y, z, yaw, turretYaw, gunPitch, aimYaw: turretYaw, aimPitch: gunPitch, time: 0,
  });
  h.flush();
  h.step();
  c.that(
    `${tag}: a \`drive\` is where the core's hull stands after its next step, the person riding it`,
    took && tank.position.x === x && tank.position.z === z && tank.yaw === yaw &&
      tank.turretYaw === turretYaw && tank.gunPitch === gunPitch &&
      p.position.x === x && p.position.z === z && p.yaw === turretYaw && p.pitch === gunPitch,
    `hull ${tank.position.x},${tank.position.z} yaw ${tank.yaw} turret ${tank.turretYaw} gun ${tank.gunPitch}`,
  );

  // The trigger, asked between the step and the next report — the page's
  // `pullHullTrigger` moment: the round leaves the reported pose's muzzle.
  const muzzle = tank.muzzleToRef(new Vector3());
  let mark = h.log.events.length;
  const fired = tank.gunReady && core.submit(PERSON_SLOT, { t: "shell", early: 0 });
  h.flush();
  const cannon = since(h, mark).find((e) => e.type === "cannon");
  c.that(
    `${tag}: the shell asked after that step leaves the reported pose's muzzle`,
    fired && cannon?.type === "cannon" && cannon.tank === t0 &&
      isDeepStrictEqual(cannon.muzzle, [muzzle.x, muzzle.y, muzzle.z]),
    `fired=${fired}, cannon ${JSON.stringify(cannon)}, muzzle ${muzzle.x},${muzzle.y},${muzzle.z}`,
  );
  c.that(
    `${tag}: a driver's \`gun\` is refused`,
    !core.submit(PERSON_SLOT, { t: "gun", yaw: 1, pitch: 0 }),
  );

  // Across to the gun: the hull leaves `driven`, the ring is laid by report.
  void h.mount(t0, GUNNER);
  const mgYaw = tank.turretYaw - 0.7;
  const mgPitch = 0.1;
  const laid = core.submit(PERSON_SLOT, { t: "gun", yaw: mgYaw, pitch: mgPitch });
  // …and a `drive` from this chair moves nothing: reported far away.
  const away = { x: tank.position.x + 50, z: tank.position.z + 50 };
  core.submit(PERSON_SLOT, {
    t: "drive", x: away.x, y, z: away.z, yaw, turretYaw, gunPitch, aimYaw: mgYaw, aimPitch: mgPitch, time: 0.1,
  });
  mark = h.log.events.length;
  h.step();
  c.that(
    `${tag}: across to the gun, the hull leaves \`driven\` and a \`gun\` is where the ring points`,
    p.crewSeat === GUNNER && core.reportedHull(p) === null && laid &&
      tank.mgYaw === mgYaw && tank.mgPitch === mgPitch,
    `seat ${p.seat}/${p.crewSeat}, mg ${tank.mgYaw}/${tank.mgPitch}`,
  );
  c.that(
    `${tag}: a gunner's \`drive\` moves nothing`,
    Math.hypot(tank.position.x - away.x, tank.position.z - away.z) > 40,
    `hull ${tank.position.x},${tank.position.z}`,
  );
  core.dispose();
}

// ---------------------------------------------------------------------------
// A person's helicopter crashes as a bot's does (FINDINGS.md 60).

/** One scripted phase of a flight: the sticks held, until `done` says so. */
interface Phase {
  input: Partial<DriveInput>;
  /**
   * Seconds into the phase, the skids' height over the floor and over the
   * cruise height (`low`'s climb ends on the second).
   */
  done: (t: number, above: number, overCruise: number) => boolean;
}

interface Profile {
  name: string;
  /** Must this flight cost nothing at all, on every path? */
  free: boolean;
  /**
   * How far its `INPUT_HZ` charge may land from the bot path's, hull points:
   * the clock's share for a steady descent (`WIRE_SLACK`), more for one whose
   * rate CHANGES in its last tenth of a second — see `reportedLanding.ts`.
   */
  slack?: number;
  phases: Phase[];
}

/** Where a flown hull stood after each fixed step, and when — what a pilot's page reports. */
interface Sample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  turretYaw: number;
  gunPitch: number;
  /** Seconds since the flight began. */
  t: number;
}

const forSecs = (secs: number) => (t: number) => t >= secs;
/** The rotor up to speed: `spoolTime` is 4.5 s and lift starts at 55% of it. */
const SPOOL: Phase = { input: {}, done: forSecs(5) };
/** Up 15 m or so and settled: full collective for 1.8 s, then a second centred. */
const CLIMB: Phase[] = [
  { input: { lift: 1 }, done: forSecs(1.8) },
  { input: {}, done: forSecs(1) },
];

/**
 * The flights. Each is flown by `Vehicle.update` (a bot's path) and by
 * reports of that same flight (a person's), and the two must charge alike.
 * Every one is flown with the nose on `clearBearing`'s corridor; the cruise
 * holds `CRUISE` metres over the highest surface on it.
 */
const CRASH_PROFILES: Profile[] = [
  {
    name: "hard: collective full down from 15 m",
    free: false,
    phases: [SPOOL, ...CLIMB,
      { input: { throttle: 1 }, done: forSecs(1.5) },
      { input: {}, done: forSecs(2.5) },
      { input: { lift: -1 }, done: forSecs(4) },
      { input: {}, done: forSecs(1) }],
  },
  {
    name: "firm: 95% down",
    free: false,
    phases: [SPOOL, ...CLIMB,
      { input: { lift: -0.95 }, done: forSecs(4.5) },
      { input: {}, done: forSecs(1) }],
  },
  {
    name: "firm but under the threshold: 80% down",
    free: true,
    phases: [SPOOL, ...CLIMB,
      { input: { lift: -0.8 }, done: forSecs(5) },
      { input: {}, done: forSecs(1) }],
  },
  {
    name: "gentle: 30% down",
    free: true,
    phases: [SPOOL, ...CLIMB,
      { input: { lift: -0.3 }, done: forSecs(9) },
      { input: {}, done: forSecs(1) }],
  },
  {
    name: "late flare: full down, full up at 0.6 m",
    free: false,
    // The flare is the last 75 ms of the descent, inside one upload
    // interval, so the wire sees the rate before it: charged HIGH by what
    // the flare took off, the exact clock included.
    slack: 90,
    phases: [SPOOL, ...CLIMB,
      { input: { lift: -1 }, done: (_t, above) => above < 0.6 },
      { input: { lift: 1 }, done: forSecs(0.3) },
      { input: {}, done: forSecs(1) }],
  },
  {
    name: "moving: full down at speed",
    free: false,
    phases: [SPOOL,
      { input: { lift: 1 }, done: forSecs(1.8) },
      { input: { throttle: 1 }, done: forSecs(2) },
      { input: { throttle: 0.6, lift: -1 }, done: forSecs(4) },
      { input: {}, done: forSecs(2) }],
  },
  {
    name: "low cruise, a climb and a descent in the air, a gentle landing",
    free: true,
    phases: [SPOOL,
      { input: { lift: 1 }, done: (_t, _above, over) => over >= 0 },
      { input: {}, done: forSecs(1) },
      { input: { throttle: 1 }, done: forSecs(9) },
      { input: {}, done: forSecs(3) },
      { input: { lift: 1 }, done: forSecs(1.2) },
      { input: {}, done: forSecs(1) },
      { input: { lift: -1 }, done: forSecs(0.8) },
      { input: {}, done: forSecs(1.5) },
      { input: { lift: -0.3 }, done: forSecs(12) },
      { input: {}, done: forSecs(1) }],
  },
];

/** Metres of skid clearance the low cruise holds over the corridor's highest surface. */
const CRUISE = 1.5;

/**
 * How far a jittered `INPUT_HZ` landing may charge from the bot path's, hull
 * points, for a steady descent: a stamp read up to `WIRE_LATE` ms late moves
 * a 50 ms interval's rate by up to ~5%, which at 8 m/s is ~0.4 m/s of jolt and
 * ~50 points at `crashDamage` 130 — measured ±21 over `WIRE_SEEDS` wires.
 */
const WIRE_SLACK = 30;
/** Jittered wires flown per flight, and how late a stamp may be read, ms. */
const WIRE_SEEDS = 8;
const WIRE_LATE = 1.5;

/**
 * The bearing out of the hardstanding whose corridor — the hull's width
 * either side, 420 m out — has the lowest highest surface (terrain or a box
 * top), and that height. Deterministic: sixteen bearings, first lowest wins.
 */
function clearBearing(core: SimCore, tank: Vehicle): { yaw: number; top: number; low: number } {
  const m = core.map!;
  let best = { yaw: tank.yaw, top: Infinity, low: Infinity };
  for (let k = 0; k < 16; k++) {
    const yaw = (k / 16) * Math.PI * 2;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let top = -Infinity;
    let low = Infinity;
    for (let d = 0; d <= 420; d += 2) {
      for (const lat of [-4, 0, 4]) {
        const x = tank.position.x + fx * d + fz * lat;
        const z = tank.position.z + fz * d - fx * lat;
        const box = m.obstacles.groundAt(x, z, 1e6, -1e6);
        const ground = m.terrain.surfaceAt(x, z);
        top = Math.max(top, box !== null && box > ground ? box : ground);
        low = Math.min(low, ground);
      }
    }
    if (top < best.top) best = { yaw, top, low };
  }
  return best;
}

/** The helicopter of the person's side, by hardstanding index, or -1. */
function heliOf(core: SimCore): number {
  return core.vehicles.hulls.findIndex((t) => t.team === PERSON_TEAM && t.flies);
}

/**
 * Path (a), the BOT's: the hull stepped by `Vehicle.update` from the sticks
 * at a fixed step, its own crash check charging it — what a bot pilot's hull
 * runs, and what a person's page runs as its prediction. Returns the flight as
 * the samples that page would report, and what the hull lost.
 */
function flyStepped(
  world: World,
  profile: Profile,
  route: { yaw: number; top: number; low: number },
): { track: Sample[]; damage: number; landedAt: number } {
  const core = new SimCore({});
  core.startRound(roundOf(world, 0));
  core.anchor(ANCHOR);
  const tank = core.vehicles.hulls[heliOf(core)];
  core.vehicles.setOccupied(tank, DRIVER, true);
  const hp0 = tank.health;
  const terrain = core.map!.terrain;
  const sample = (t: number): Sample => ({
    x: tank.position.x, y: tank.position.y, z: tank.position.z,
    yaw: tank.yaw, turretYaw: tank.turretYaw, gunPitch: tank.gunPitch, t,
  });
  const track: Sample[] = [sample(0)];
  const input: DriveInput = { throttle: 0, steer: 0, lift: 0, aimYaw: route.yaw, aimPitch: 0 };
  const cruise = route.top + CRUISE;
  let k = 0;
  let landedAt = -1;
  for (const phase of profile.phases) {
    let t = 0;
    for (;;) {
      const p = tank.position;
      if (phase.done(t, p.y - terrain.surfaceAt(p.x, p.z), p.y - cruise) || t > 30) break;
      input.throttle = phase.input.throttle ?? 0;
      input.steer = phase.input.steer ?? 0;
      input.lift = phase.input.lift ?? 0;
      const hp = tank.health;
      tank.update(DT, input);
      k++;
      t += DT;
      if (tank.health < hp && landedAt < 0) landedAt = k * DT;
      track.push(sample(k * DT));
    }
  }
  const damage = hp0 - tank.health;
  core.dispose();
  return { track, damage, landedAt };
}

/** A seeded uniform 0..1, so the jittered wire is the same wire every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One `DriveMessage`'s worth of a sample: what it says, when it was stamped, which step it lands before. */
interface Wire {
  s: Sample;
  /** The client's stamp, ms — a whole-ms `Date.now()`, or the exact clock (`wireOf`'s `late` 0). */
  stamp: number;
  /** The authority step it arrives before. */
  at: number;
}

/**
 * The flight as a MATCH's client uploads it: `NetSession`'s accumulator at
 * `INPUT_HZ` over 60 Hz frames, arriving 3–6 ticks later and in order — so
 * two sometimes land in one tick. Each is stamped as `NetSession` stamps it,
 * a whole-ms `Date.now()` read up to `late` ms after the frame it samples
 * began (the work done before the upload line varies frame to frame); `late`
 * 0 is the EXACT clock instead, the frame's own time to the bit, which is
 * what separates the clock's share of the error from the sampling's.
 */
function wireOf(track: readonly Sample[], seed: number, late: number): Wire[] {
  const rnd = seeded(seed);
  const out: Wire[] = [];
  const CLIENT0 = 1_700_000_000_000;
  let upload = 0;
  let last = 0;
  for (let k = 1; k < track.length; k++) {
    upload += DT;
    if (upload < 1 / INPUT_HZ) continue;
    upload = 0;
    const exact = CLIENT0 + track[k].t * 1000;
    const stamp = late > 0 ? Math.floor(exact + rnd() * late) : exact;
    const at = Math.max(last, k + 3 + Math.floor(rnd() * 4));
    last = at;
    out.push({ s: track[k], stamp, at });
  }
  return out;
}

/** The person seated as DRIVER of hull `tank`, on either host. */
async function seatPilot(h: Host, tank: number): Promise<boolean> {
  await h.deploy(homeSpawn(h, PERSON_TEAM));
  if (!h.player().alive && stepUntilSpawned(h, 60) < 0) return false;
  const hull = h.core.vehicles.hulls[tank];
  const spot = h.core.vehicles.exitSpot(hull);
  placePerson(h, spot.x, spot.y, spot.z);
  await h.mount(tank, DRIVER);
  h.flush();
  return h.player().seat === tank && h.player().crewSeat === DRIVER;
}

/**
 * Path (b), the PERSON's, on the trusted door: every sample a `drive`, one
 * per step, as the offline page reports its predicted hull — or, with `wire`,
 * the jittered `INPUT_HZ` uploads a match's client sends, submitted as
 * `Match.onDrive` would (the stamp in seconds). Returns what the core's hull
 * lost.
 */
async function flyReportedCore(world: World, track: readonly Sample[], wire: Wire[] | null): Promise<number> {
  const h = new CoreHost({ hostHoldsRespawn: true });
  h.start(world, 0);
  const core = h.core;
  const index = heliOf(core);
  if (!(await seatPilot(h, index))) throw new Error("crash: the pilot was not seated");
  const tank = core.vehicles.hulls[index];
  const hp0 = tank.health;
  const send = (s: Sample, time: number) => {
    core.submit(PERSON_SLOT, {
      t: "drive", x: s.x, y: s.y, z: s.z, yaw: s.yaw, turretYaw: s.turretYaw, gunPitch: s.gunPitch,
      aimYaw: s.yaw, aimPitch: 0, time,
    });
  };
  if (!wire) {
    for (const s of track) {
      send(s, s.t);
      h.step();
    }
  } else {
    let w = 0;
    const end = (wire.at(-1)?.at ?? 0) + 2;
    for (let step = 0; step <= end; step++) {
      while (w < wire.length && wire[w].at === step) {
        send(wire[w].s, wire[w].stamp / 1000);
        w++;
      }
      h.step();
    }
  }
  const damage = hp0 - tank.health;
  core.dispose();
  return damage;
}

/**
 * Path (c), the person's through `Match` — the VALIDATED door, a fake peer
 * sending the same jittered uploads as real `drive` messages. Returns what the
 * authority's hull lost, what the last snapshot told the client it has left,
 * and how many `hullcorrect`s the flight cost.
 */
async function flyReportedMatch(
  world: World,
  wire: Wire[],
): Promise<{ damage: number; hp: number | null; left: number; corrections: number }> {
  const log = console.log;
  console.log = () => {};
  try {
    const h = new MatchHost(world.def, false);
    await h.start(world, 0);
    const core = h.core;
    const index = heliOf(core);
    if (!(await seatPilot(h, index))) throw new Error("crash: the pilot was not seated (match)");
    const tank = core.vehicles.hulls[index];
    const hp0 = tank.health;
    let seq = 1000;
    let w = 0;
    const end = (wire.at(-1)?.at ?? 0) + 2;
    for (let step = 0; step <= end; step++) {
      while (w < wire.length && wire[w].at === step) {
        const s = wire[w].s;
        // The socket's message budget is a WALL-CLOCK bucket (`spendMessage`)
        // and this flight is delivered as fast as the script runs: topped up
        // per message, so the bucket is never what drops a sample here.
        for (const peer of h.match["peers"].values()) peer.budget = 1;
        h.socket.deliver({
          t: "drive", seq: ++seq, time: wire[w].stamp, tank: index,
          pos: [s.x, s.y, s.z], yaw: s.yaw, tyaw: s.turretYaw, gun: s.gunPitch, aimYaw: s.yaw, aimPitch: 0,
        });
        w++;
      }
      h.step();
    }
    // Snapshots after the last of it, so the client's gauge is read off the
    // state the flight ended in.
    for (let i = 0; i < 6; i++) h.step();
    let hp: number | null = null;
    for (const f of h.socket.frames) {
      if (f.t !== "snap") continue;
      const v = (f.vehicles as Array<{ i: number; hp: number }> | undefined)?.find((s) => s.i === index);
      if (v) hp = v.hp;
    }
    const corrections = h.socket.frames.filter((f) => f.t === "hullcorrect").length;
    const damage = hp0 - tank.health;
    core.dispose();
    return { damage, hp, left: tank.health, corrections };
  } finally {
    console.log = log;
  }
}

/**
 * **A helicopter a person flies crashes as a bot's does** (FINDINGS.md 60).
 *
 * Each flight in `CRASH_PROFILES` is flown once by `Vehicle.update` — the bot
 * path, whose own `jolt` charges the crash — and the samples that flight
 * leaves are then REPORTED to a core with a person in the same seat: one per
 * step as the offline page reports (which must charge what the bot path
 * charged, to float noise), and at `INPUT_HZ` with a client's clock jitter as
 * a match's peer uploads, on the trusted door and through `Match`'s validated
 * one (which must agree with each other exactly, and with the bot path within
 * `WIRE_SLACK`). A flight the bot path does not charge must cost nothing on
 * every path, and the snapshot must tell the client what the authority's hull
 * has left. Returns the calibration table's lines.
 */
async function crashCalibration(world: World, c: Checks): Promise<string[]> {
  const tag = "crash";
  const lines: string[] = [];
  // The corridor, off a core of its own: the same seed, the same pad.
  const probe = new SimCore({});
  probe.startRound(roundOf(world, 0));
  const index = heliOf(probe);
  if (!c.that(`${tag}: fixture — the person's side has a helicopter`, index >= 0)) {
    probe.dispose();
    return lines;
  }
  const route = clearBearing(probe, probe.vehicles.hulls[index]);
  probe.dispose();
  lines.push(
    `  -- ${tag}: hull ${index}, bearing ${route.yaw.toFixed(3)} rad, corridor floor ${route.low.toFixed(2)}..${route.top.toFixed(2)} m, cruise ${CRUISE} m over its top; hull points lost.`,
    `  -- ${tag}: rep20 = ${WIRE_SEEDS} jittered wires (whole-ms stamps up to ${WIRE_LATE} ms late), min..max; exact = the same uploads on an exact clock`,
    `  -- ${tag}: ${"flight".padEnd(64)} ${"bot".padStart(7)} ${"rep60".padStart(7)} ${"rep20".padStart(15)} ${"exact".padStart(7)} ${"match".padStart(7)}`,
  );
  const f = (v: number, w = 7) => v.toFixed(1).padStart(w);
  for (const [n, profile] of CRASH_PROFILES.entries()) {
    const { track, damage: bot, landedAt } = flyStepped(world, profile, route);
    const rep60 = await flyReportedCore(world, track, null);
    const wires = Array.from({ length: WIRE_SEEDS }, (_, i) => wireOf(track, 9000 + 100 * n + i, WIRE_LATE));
    const rep20: number[] = [];
    for (const wire of wires) rep20.push(await flyReportedCore(world, track, wire));
    const exact = await flyReportedCore(world, track, wireOf(track, 9000 + 100 * n, 0));
    const m = await flyReportedMatch(world, wires[0]);
    const lo = Math.min(...rep20);
    const hi = Math.max(...rep20);
    lines.push(
      `  -- ${tag}: ${profile.name.padEnd(64)} ${f(bot)} ${f(rep60)} ${`${f(lo, 0)}..${f(hi, 0)}`.padStart(15)} ${f(exact)} ${f(m.damage)}` +
        (landedAt >= 0 ? `   (bot charged at ${landedAt.toFixed(2)} s)` : ""),
    );
    if (profile.free) {
      c.that(
        `${tag}: ${profile.name} — costs nothing: bot, reported every step, at ${INPUT_HZ} Hz (every wire), through Match`,
        bot === 0 && rep60 === 0 && hi === 0 && exact === 0 && m.damage === 0,
        `bot ${bot} rep60 ${rep60} rep20 ${lo}..${hi} exact ${exact} match ${m.damage}`,
      );
    } else {
      c.that(
        `${tag}: ${profile.name} — the bot path charges it, reported every step charges the same (${Math.abs(rep60 - bot).toExponential(1)} apart)`,
        bot > 0 && Math.abs(rep60 - bot) < 1e-6,
        `bot ${bot} rep60 ${rep60}`,
      );
      c.that(
        `${tag}: ${profile.name} — at ${INPUT_HZ} Hz on every jittered wire, within ${profile.slack ?? WIRE_SLACK} of it`,
        Math.abs(lo - bot) <= (profile.slack ?? WIRE_SLACK) && Math.abs(hi - bot) <= (profile.slack ?? WIRE_SLACK),
        `bot ${bot} rep20 ${rep20.join(", ")}`,
      );
    }
    c.that(
      `${tag}: ${profile.name} — Match's validated door charges what the trusted one does, the snapshot says so, nothing corrected`,
      m.damage === rep20[0] && m.hp === m.left && m.corrections === 0,
      `match ${m.damage} vs core ${rep20[0]}, snapshot hp ${m.hp} of ${m.left}, ${m.corrections} hullcorrects`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The run.

type Script = (h: Host, c: Checks) => Promise<void>;

interface Run {
  checks: Checks;
  log: Log;
  host: Host;
}

async function runCore(world: World, script: Script, tag: string, mirror = false): Promise<Run> {
  const host = new CoreHost(undefined, mirror);
  host.start(world);
  const checks = new Checks(tag);
  await script(host, checks);
  return { checks, log: host.log, host };
}

async function runMatch(world: World, script: Script, tag: string): Promise<Run> {
  const log = console.log;
  console.log = () => {};
  try {
    const host = new MatchHost(world.def);
    await host.start(world);
    const checks = new Checks(tag);
    await script(host, checks);
    return { checks, log: host.log, host };
  } finally {
    console.log = log;
  }
}

/** The per-body state the core exposes, as plain numbers — a summary of what X2.5a C5's frame carries. */
function bodyState(core: SimCore): unknown {
  return {
    tick: core.tick,
    now: core.now,
    scores: {
      kills: [...core.scores.kills],
      deaths: [...core.scores.deaths],
      points: [...core.scores.points],
      version: core.scores.version,
    },
    tickets: [...core.conquest.tickets],
    flags: core.conquest.points.map((p) => ({ owner: p.owner, meter: p.meter, present: [...p.present] })),
    bots: core.battle.bots.map((b) => ({
      pos: [b.position.x, b.position.y, b.position.z],
      center: [b.center.x, b.center.y, b.center.z],
      eye: [b.eyePos.x, b.eyePos.y, b.eyePos.z],
      yaw: b.facing,
      alive: b.alive,
      hp: b.hp,
      team: b.team,
      aside: core.battle.aside(b),
      deathFrom: [b.deathFrom.x, b.deathFrom.y, b.deathFrom.z],
      // The SOLVED pose, not the private cache behind it: a core that
      // publishes solves every bot's joints each step and one that does not
      // solves only on a read, so the caches differ while the answer — a pure
      // function of the pose — cannot.
      joints: { ...b.solved },
    })),
    players: [...core.players.values()].map((p) => ({
      slot: p.slot,
      pos: [p.position.x, p.position.y, p.position.z],
      alive: p.alive,
      health: p.health,
      seat: p.seat,
      crewSeat: p.crewSeat,
      respawnT: p.respawnT,
      grenades: p.grenades,
      ordnance: p.ordnance,
    })),
    hulls: core.vehicles.hulls.map((t) => ({
      pos: [t.position.x, t.position.y, t.position.z],
      yaw: t.yaw,
      health: t.health,
      alive: t.alive,
      seats: [...t.seats],
    })),
  };
}

async function main(): Promise<void> {
  const started = performance.now();
  const lines: string[] = [];
  let failures = 0;
  const report = (tag: string, r: Result) => {
    if (!r.ok) failures++;
    lines.push(`${r.ok ? "  ok  " : "  FAIL"} ${tag.padEnd(18)} ${r.name}${r.ok ? "" : `  -- ${r.detail}`}`);
  };

  const plan: Array<{ id: string; script: Script }> = [
    { id: "greyfen", script: greyfen },
    { id: "coldharbour", script: coldharbour },
  ];
  for (const { id, script } of plan) {
    const def = MAPS.find((m) => m.id === id);
    if (!def) throw new Error(`no map ${id}`);
    const world: World = { def, ...(await loadSimWorld(def)) };

    const a = await runCore(world, script, `${id}/core`);
    // The repeat PUBLISHES and reads the frame back after every drain: the
    // same stream from it is what says the frame costs the fight nothing.
    const b = await runCore(world, script, `${id}/core#2`, true);
    const m = await runMatch(world, script, `${id}/match`);

    // The first core run's assertions are the pass list; the repeat and the
    // authority's must pass the same ones and print only a failure.
    for (const r of a.checks.results) report(a.checks.tag, r);
    for (const run of [b, m]) {
      for (const r of run.checks.results) if (!r.ok) report(run.checks.tag, r);
      const same = run.checks.results.length === a.checks.results.length;
      report(run.checks.tag, {
        name: `the same ${a.checks.results.length} assertions pass`,
        ok: same && run.checks.failed.length === 0,
        detail: `${run.checks.results.length} run, ${run.checks.failed.length} failed`,
      });
    }

    if (process.argv.includes("--list")) {
      const kinds = new Map<string, number>();
      for (const e of a.log.events) kinds.set(e.type, (kinds.get(e.type) ?? 0) + 1);
      lines.push(`  -- ${id}: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")}`);
      for (const l of scoreList(a.log.events)) lines.push(`  -- ${id}: ${l}`);
    }
    const tag = `${id}`;
    report(tag, {
      name: `same seed + same commands twice: identical event-stream hash (${a.log.digest()}, ${a.log.events.length} events)`,
      ok: a.log.digest() === b.log.digest(),
      detail: `${a.log.digest()} vs ${b.log.digest()}`,
    });
    const mc = (b.host as CoreHost).mirrorChecks;
    report(tag, {
      name: `the frame's readers equal the live core, Object.is, after every drain (${mc.passes} passes)`,
      ok: mc.passes > 0 && mc.mismatches === 0,
      detail: `${mc.mismatches} mismatches: ${mc.first.join("; ")}`,
    });
    const coreScore = scoreList(a.log.events);
    const matchScore = scoreList(m.log.events);
    const firstDiff = coreScore.findIndex((l, i) => l !== matchScore[i]);
    report(tag, {
      name: `Match (fake peer, validated door) gives the identical award/death list (${coreScore.length} lines)`,
      ok: isDeepStrictEqual(coreScore, matchScore),
      detail: `core ${coreScore.length} vs match ${matchScore.length}; first difference at ${firstDiff}: ` +
        `${coreScore[firstDiff] ?? "(end)"} | ${matchScore[firstDiff] ?? "(end)"}`,
    });
    report(tag, {
      name: `Match's whole event stream equals the core's (${m.log.digest()})`,
      ok: a.log.digest() === m.log.digest(),
      detail: `${a.log.digest()} vs ${m.log.digest()}`,
    });
    // What the authority actually SENT the person: every award of theirs as a
    // `score`, in order — and the leash's `kill` naming no killer.
    const mh = m.host as MatchHost;
    const sent = mh.wireEvents("score").map((e) => `${e.kind} ${e.points}`);
    const owed = a.log.events
      .filter((e): e is Extract<SimEvent, { type: "award" }> => e.type === "award" && e.person)
      .map((e) => `${e.kind} ${e.points}`);
    report(tag, {
      name: `the wire's \`score\` feed is the person's awards, in order (${owed.length})`,
      ok: isDeepStrictEqual(sent, owed),
      detail: `sent [${sent.join(", ")}] owed [${owed.join(", ")}]`,
    });
    if (id === "greyfen") {
      const leash = mh.wireEvents("kill").filter((e) => e.victim === PERSON_SLOT && e.killer === -1);
      report(tag, {
        name: "the wire's leash `kill` names no killer (killer -1)",
        ok: leash.length === 1,
        detail: `${leash.length} such kill events`,
      });
    }
    report(tag, {
      name: `structuredClone round-trips every drain (cursor arrays and decoded events, ${a.log.drains + m.log.drains} drains)`,
      ok: a.log.cloneFailures + b.log.cloneFailures + m.log.cloneFailures === 0,
      detail: `${a.log.cloneFailures}/${b.log.cloneFailures}/${m.log.cloneFailures} failures`,
    });
    const state = bodyState(a.host.core);
    report(tag, {
      name: "structuredClone round-trips the per-body state (bots, persons, hulls, flags, board)",
      ok: isDeepStrictEqual(structuredClone(state), state),
      detail: "",
    });
    report(tag, {
      name: "the two core runs end in the same per-body state; so does the authority's",
      ok: isDeepStrictEqual(state, bodyState(b.host.core)) && isDeepStrictEqual(state, bodyState(m.host.core)),
      detail: "",
    });
    for (const run of [a, b, m]) run.host.core.dispose();

    if (id === "greyfen") {
      const checks = new Checks("greyfen/held");
      holdsRespawn(world, checks);
      for (const r of checks.results) report(checks.tag, r);
    }
    if (id === "coldharbour") {
      const checks = new Checks("coldharbour/drive");
      reportedHull(world, checks);
      for (const r of checks.results) report(checks.tag, r);
    }
  }

  // A person's helicopter, on the one map that has them in the corecheck's
  // reach (FINDINGS.md 60): botless, so nothing but the ground hurts it.
  {
    const def = MAPS.find((m) => m.id === "sarab");
    if (!def) throw new Error("no map sarab");
    const world: World = { def, ...(await loadSimWorld(def)) };
    const checks = new Checks("sarab/crash");
    const table = await crashCalibration(world, checks);
    for (const r of checks.results) report(checks.tag, r);
    lines.push(...table);
  }

  console.log(lines.join("\n"));
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  if (failures > 0) {
    console.log(`\ncorecheck: ${failures} FAILED (${secs} s)`);
    process.exit(1);
  }
  console.log(`\ncorecheck: all passed (${secs} s)`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
