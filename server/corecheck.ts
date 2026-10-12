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
 * `Match`'s VALIDATED door (a fake transport, the client messages a real one
 * would send, every claim gate in the path) must leave the identical award
 * and death list — the scoring rules exercised offline and online.
 *
 * **The hosts.** `CoreHost` is the TRUSTED door, the offline page's shape:
 * it submits each of the person's acts as a `SimCommand`
 * (`src/sim/commands.ts`) with nothing in front of it. `MatchHost` is the
 * VALIDATED door: a real `Match`, its loop timer stopped so the script steps
 * it by hand, fed JSON through its transport's `message` handler — every
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
 * And the X2.5a review's three, on the same botless Sarab: `sarab/leash` — a
 * person in a FLYING hull past the play square (pilot and gunner, trusted
 * door and `Match`) is put on foot and killed by the leash, the hull left
 * standing; `sarab/clock` — a peer's stamps are bounded against when they
 * arrive (`Match.onStamp`): an honest sprint is never corrected, a stretched
 * one is refused, a hard landing on a lying clock is still charged, and a
 * sample crowded a millisecond onto the last is no rate; `sarab/break` — a
 * refused sample mid-descent followed by the client's `resync` costs nothing,
 * and a lie on the sample before touchdown still pays the landing.
 *
 * And `greyfen/owned` (X2.5c C2): a match its OWNER drives (`Match`'s
 * `owned`) plays the benchmark's round — its seed, difficulty and length — as
 * the offline page's core plays it, a tick an `advance` and at 144 Hz alike,
 * one event stream and the bench's own `FightHash`; then the owned lifecycle:
 * the map's own slot table, no admit before `begin`, a round that ends held
 * with no ballot or rotation until the owner begins the next, empty is not
 * idle, and `close`.
 *
 * And `greyfen/local` (X2.5c C3): the same round through the LOCAL
 * TRANSPORT — the host the page runs in a Worker (`server/localMatch.ts`),
 * here on a `MessageChannel` in this thread, driven through the owner's own
 * client (`src/net/LocalMatch.ts`): the bench's fight hash comes back over
 * the owner channel, and a person joins over a port through the page's real
 * `Connection` — welcomed, deployed, an honest report uncorrected, the
 * scoreboard's ping row filled, and told why when the owner closes the match.
 *
 * The person is always slot 0, team 0: the first seat `Roster.claim` hands
 * out, which `MatchHost` asserts. `-- --list` also prints each map's event
 * counts and the award/death list the hosts are compared on.
 */
import { createHash, type Hash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { CONFIG } from "../src/config";
import { Vector3, type Vector3Like } from "../src/math";
import { INPUT_HZ, PROTOCOL_VERSION, SNAPSHOT_HZ, TICK_HZ, type ServerMessage } from "../src/net/protocol";
import { Connection } from "../src/net/Connection";
import { LocalMatch } from "../src/net/LocalMatch";
import type { Advanced } from "../src/net/localWire";
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
import { Match, type PeerHandlers, type PeerTransport, type RoundChoice } from "./Match";
import { FightHash } from "../src/bench/fightHash";
import { claimedDir } from "./claimGates";
import { serveLocalMatch } from "./localMatch";
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

/** A peer's connection as `Match` reaches one: records what is sent, delivers what the script says. */
class FakeTransport implements PeerTransport {
  open = true;
  readonly frames: Array<{ t: string; [k: string]: unknown }> = [];
  private handlers: PeerHandlers | null = null;

  listen(handlers: PeerHandlers): void {
    this.handlers = handlers;
  }
  send(text: string): void {
    this.frames.push(JSON.parse(text));
  }
  ping(): void {}
  close(): void {
    this.open = false;
  }
  deliver(msg: object): void {
    this.handlers?.message(JSON.stringify(msg));
  }
  /** The far end goes away, raised as a socket raises it. */
  hangUp(): void {
    this.open = false;
    this.handlers?.closed();
  }
}

/** Waits out `RateGate`'s wall-clock spacing so the rifle's bucket is never what refuses a scripted round. */
const settle = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The authority: a real `Match`, stepped by hand, fed through its transport's own handler. */
class MatchHost implements Host {
  readonly name = "match";
  readonly match: Match;
  readonly core: SimCore;
  readonly log = new Log();
  readonly transport = new FakeTransport();
  private seq = 0;
  private clock = 1000;

  constructor(def: MapDef, bots = true) {
    this.match = new Match("corecheck", { map: def.id, bots });
    this.core = this.match.game;
    // The ARRIVAL clock a peer's stamps are bounded against (`Match.onStamp`)
    // is the script's own: the simulation's time, which advances with each
    // scripted step exactly as a real match's wall clock advances with its
    // loop — so an upload delivered before step `at` arrived at that step.
    this.match["arrivalClock"] = () => this.core.now;
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
    await this.match.admit(this.transport, "corecheck");
    // No macrotask has run since `start` armed the loop: stopped before its
    // first tick, so every step from here is the script's.
    clearInterval(this.match["timer"] ?? undefined);
    const welcome = this.transport.frames.find((f) => f.t === "welcome");
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
    this.transport.deliver({ t: "deploy", spawn });
  }

  async aim(yaw: number, pitch: number): Promise<void> {
    const p = this.player().position;
    this.clock += 100;
    this.transport.deliver({
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
    this.transport.deliver({
      t: "shot",
      seq: ++this.seq,
      time: this.core.now,
      origin: [origin.x, origin.y, origin.z],
      dir,
      slot: PRIMARY_SLOT,
    });
  }

  async mount(tank: number, seat: CrewSeat): Promise<void> {
    this.transport.deliver({ t: "mount", tank, seat });
  }

  async dismount(): Promise<void> {
    this.transport.deliver({ t: "dismount" });
  }

  step(): void {
    this.match["step"]();
  }

  /** Every event of kind `e` the peer was sent, in order. */
  wireEvents(e: string): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const f of this.transport.frames) {
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
 * The benchmark's round (`?bench=<map>`): its seed and the difficulty the
 * page plays it at, and how many fixed steps it runs — the lead, then the
 * measured fight (`BenchScript`'s two legs, each its seconds over the step).
 */
const BENCH = CONFIG.profiling.bench;
const BENCH_ROUND: RoundChoice = { seed: BENCH.seed, difficulty: CONFIG.bots.skill.defaultDifficulty };
const BENCH_STEPS = Math.round(BENCH.leadSeconds / BENCH.dt) + Math.round(BENCH.fightSeconds / BENCH.dt);

/** The bench's fold (`Game.onSimEvent`): every award and death after `mark`, stamped from `tick0`. */
function benchFight(log: Log, mark: number, tick0: number): FightHash {
  const fight = new FightHash();
  for (const ev of log.events.slice(mark)) {
    if (ev.type === "death") fight.death(ev.tick - tick0, ev.slot);
    else if (ev.type === "award") fight.award(ev.tick - tick0, ev.slot, ev.kind, ev.points);
  }
  return fight;
}

/** An OWNED match on `world`, every drain of its core heard, begun on the bench's round. */
async function ownedOn(world: World): Promise<{ match: Match; log: Log; mark: number; tick0: number }> {
  const match = new Match("local", { map: world.def.id, owned: true });
  const log = new Log();
  const drain = match.game.drain.bind(match.game);
  match.game.drain = (out) => {
    drain(out);
    log.absorb(out);
  };
  await quietly(() => match.begin(BENCH_ROUND));
  return { match, log, mark: log.events.length, tick0: match.game.tick };
}

/**
 * **A match its OWNER drives plays the offline page's round** (`BABYLON_EXIT.md`
 * X2.5c C2). The benchmark's round — its seed, its difficulty, its length —
 * played three ways on the same map: on a core built as the offline page
 * builds it (the map's own pool, fielded whole, `hostHoldsRespawn`) stepped
 * by hand; through an owned `Match` advanced by the bench's own step, one
 * `advance` a tick; and through another advanced in 144 Hz frames, most of
 * which hold no whole step. All three must be one event stream, which is what
 * says the owner's clock is the server's accumulator, the pool is the map's
 * and the seed reaches the core unchanged — and the fold printed is the
 * bench's own (`FightHash`), so the line carries the number the bench banks.
 *
 * Then the rest of what being OWNED means, on the first match: the slot table
 * is the map's roster, not the ceiling; a peer may not be admitted before the
 * owner has begun a round; a round that ends opens no ballot and arms no
 * rotation, and holds — nothing steps — until the owner begins the next, which
 * the seated peer hears as a `roundstart` on the same map; the last peer
 * leaving retires nothing and the owner's clock still steps; and `close` ends
 * it for good.
 */
async function ownedMatch(world: World, c: Checks): Promise<string> {
  const tag = "owned";
  const perTeam = perTeamOf(world.def.layout);

  // The offline page's core, stepped by hand.
  const core = new SimCore({ hostHoldsRespawn: true });
  const coreLog = new Log();
  const cursor = new EventCursor();
  const heard = () => {
    core.drain(cursor);
    coreLog.absorb(cursor);
  };
  core.startRound({ ...world, ...BENCH_ROUND, pool: perTeam, fielded: perTeam });
  heard();
  const coreMark = coreLog.events.length;
  const coreTick0 = core.tick;
  for (let i = 0; i < BENCH_STEPS; i++) {
    core.step(BENCH.dt);
    heard();
  }
  const coreFight = benchFight(coreLog, coreMark, coreTick0);
  core.dispose();

  // The owner's clock at the bench's step: one `advance`, one tick.
  const a = await ownedOn(world);
  let uneven = 0;
  for (let i = 0; i < BENCH_STEPS; i++) {
    const before = a.match.game.tick;
    a.match.advance(BENCH.dt);
    if (a.match.game.tick !== before + 1) uneven++;
  }
  const aFight = benchFight(a.log, a.mark, a.tick0);
  // …and in 144 Hz frames, until the same number of ticks has run.
  const b = await ownedOn(world);
  let frames = 0;
  while (b.match.game.tick - b.tick0 < BENCH_STEPS) {
    b.match.advance(1 / 144);
    frames++;
  }
  const bFight = benchFight(b.log, b.mark, b.tick0);
  await quietly(async () => b.match.close());

  c.that(
    `${tag}: the bench's round (${BENCH_STEPS} steps) — the offline page's core, an owned Match a tick an advance (${uneven} uneven) and one at 144 Hz (${frames} frames) are one event stream (${coreLog.digest()})`,
    uneven === 0 && a.log.digest() === coreLog.digest() && b.log.digest() === coreLog.digest(),
    `core ${coreLog.digest()} / per-tick ${a.log.digest()} / 144 Hz ${b.log.digest()}`,
  );
  c.that(
    `${tag}: the bench's fight hash, all three (${coreFight.hex}, ${coreFight.events} awards and deaths)`,
    coreFight.events > 0 && aFight.hex === coreFight.hex && bFight.hex === coreFight.hex,
    `core ${coreFight.hex} / per-tick ${aFight.hex} / 144 Hz ${bFight.hex}`,
  );

  const m = a.match;
  c.that(
    `${tag}: the slot table and the bot pool are the map's own roster (${perTeam} a side), team 1 from slot ${perTeam}`,
    m.roster.slots.length === 2 * perTeam && m.game.battle.bots.length === 2 * perTeam &&
      m.roster.slots[perTeam].team === 1 && m.roster.slots[perTeam - 1].team === 0,
    `${m.roster.slots.length} slots, ${m.game.battle.bots.length} bots`,
  );

  const early = new Match("local", { map: world.def.id, owned: true });
  const turned = new FakeTransport();
  await early.admit(turned, "early");
  c.that(
    `${tag}: a peer admitted before the owner begins a round is refused, and holds no seat`,
    turned.frames.some((f) => f.t === "rejected") && !turned.open && early.roster.humanCount === 0,
    `${JSON.stringify(turned.frames)}, open ${turned.open}, humans ${early.roster.humanCount}`,
  );
  await quietly(async () => early.close());

  const peer = new FakeTransport();
  await quietly(() => m.admit(peer, "corecheck"));
  const welcome = peer.frames.find((f) => f.t === "welcome");
  m.game.conquest.tickets[1] = 0;
  m.advance(BENCH.dt);
  const ended = m.game.tick;
  for (let i = 0; i < TICK_HZ; i++) m.advance(BENCH.dt);
  const over = peer.frames.some(
    (f) => f.t === "events" && (f.events as Array<{ e: string }>).some((e) => e.e === "roundover"),
  );
  c.that(
    `${tag}: a round that ends is heard (\`roundover\`), opens no ballot, arms no rotation, and holds — a second's advance steps nothing`,
    welcome?.slot === PERSON_SLOT && over && !peer.frames.some((f) => f.t === "mapvote") &&
      m["rotateTimer"] === null && m.game.tick === ended,
    `welcome ${JSON.stringify(welcome)}, roundover ${over}, tick ${ended} -> ${m.game.tick}`,
  );

  await quietly(() => m.begin({ seed: SEED + 1, difficulty: BENCH_ROUND.difficulty }));
  const start = peer.frames.find((f) => f.t === "roundstart");
  const begun = m.game.tick;
  m.advance(BENCH.dt);
  c.that(
    `${tag}: the owner begins the next: the seated peer hears \`roundstart\` on the same map, the seed is the owner's, and the clock steps again`,
    start?.mapId === world.def.id && m.game.random.seed === SEED + 1 && m.game.tick === begun + 1 &&
      m.game.players.has(PERSON_SLOT),
    `roundstart ${JSON.stringify(start)}, seed ${m.game.random.seed}, tick ${begun} -> ${m.game.tick}`,
  );

  await quietly(async () => peer.hangUp());
  const left = m.game.tick;
  m.advance(BENCH.dt);
  c.that(
    `${tag}: the last peer leaving retires nothing — no idle timer, and the owner's clock still steps`,
    !m.game.players.has(PERSON_SLOT) && m["idleTimer"] === null && m.game.tick === left + 1,
    `idle timer ${m["idleTimer"] !== null}, tick ${left} -> ${m.game.tick}`,
  );

  await quietly(async () => m.close());
  const late = new FakeTransport();
  await m.admit(late, "late");
  const closed = (() => {
    try {
      m.advance(BENCH.dt);
      return false;
    } catch {
      return true;
    }
  })();
  c.that(
    `${tag}: \`close\` ends it — the world disposed, the clock refuses to step it, and a late peer is turned away`,
    closed && m["retired"] && late.frames.some((f) => f.t === "rejected" && f.reason === "match closed"),
  );
  return coreFight.hex;
}

/** Waits a turn of the event loop at a time — a port delivers on one — until `ready`, or `ms` runs out. */
async function until(ready: () => boolean, ms = 2000): Promise<boolean> {
  const end = performance.now() + ms;
  while (!ready()) {
    if (performance.now() > end) return false;
    await new Promise<void>((done) => setTimeout(done, 1));
  }
  return true;
}

/**
 * **The local match, through its transport** (`BABYLON_EXIT.md` X2.5c C3).
 * The host the page runs in a Worker (`serveLocalMatch`), on a
 * `MessageChannel` in this thread — the same code path as the page's
 * fallback — driven through the owner's client the page will hold
 * (`LocalMatch`).
 *
 * First the bench's round over the owner channel alone, as the page's
 * benchmark will drive it: `open`, `begin` on the bench's seed, `markFight`,
 * then one posted `advance` a tick, every hundredth timed. Each answer says
 * one step, and carries the timing exactly when it was asked for. `fight` is
 * answered after every advance before it, and is the core's own hash
 * (`benchHex`, from `ownedMatch`).
 *
 * Then a PERSON, through the page's real `Connection` over a port the owner
 * dialled, so the protocol's JSON goes both ways and through `Match`'s own
 * door:
 * - welcomed at slot 0 of the map's table;
 * - a `deploy` answered by a `spawn` on the owner's clock;
 * - an honest `move` at the spawn never corrected;
 * - the scoreboard's ping row filled, answered by the host (`portPeer`);
 * - a second match refused while one is open;
 * - the owner's `close` heard as `rejected: match closed`, after which a
 *   new dial is told there is no match.
 */
async function localMatch(world: World, c: Checks, benchHex: string): Promise<void> {
  const tag = "local";
  const channel = new MessageChannel();
  serveLocalMatch(channel.port2);
  const owner = new LocalMatch(channel.port1);
  const answers: Advanced[] = [];
  owner.onAdvanced = (a) => answers.push(a);
  const failed: string[] = [];
  owner.onFailed = (m) => failed.push(m);

  await owner.open(world.def.id);
  await quietly(() => owner.begin(BENCH_ROUND));
  await owner.markFight();
  const TIMED_EVERY = 100;
  for (let i = 0; i < BENCH_STEPS; i++) owner.advance(BENCH.dt, i % TIMED_EVERY === 0);
  const fight = await owner.fight();
  const asked = answers.filter((a, i) => (i % TIMED_EVERY === 0) === (a.timing !== null));
  const phased = answers.filter((a) => a.timing !== null && a.timing.total >= 0 && a.timing.at[0] >= 0);
  c.that(
    `${tag}: the bench's round over the owner channel — ${BENCH_STEPS} posted advances, each answered one step, all before \`fight\` is`,
    answers.length === BENCH_STEPS && answers.every((a) => a.steps === 1 && !a.ended) && failed.length === 0,
    `${answers.length} answers, ${answers.filter((a) => a.steps !== 1).length} not one step, failed [${failed.join("; ")}]`,
  );
  c.that(
    `${tag}: a step's timing comes back exactly when asked for (${phased.length} timed of ${answers.length})`,
    asked.length === answers.length && phased.length === Math.ceil(BENCH_STEPS / TIMED_EVERY),
    `${asked.length} agree, ${phased.length} with phases`,
  );
  c.that(
    `${tag}: the fight hash, back over the owner channel, is the core's (${fight.hex}, ${fight.events} awards and deaths)`,
    fight.hex === benchHex,
    `${fight.hex} vs ${benchHex}`,
  );

  // A person, through the page's own `Connection`.
  const conn = new Connection();
  const frames: ServerMessage[] = [];
  conn.onMessage = (m) => {
    frames.push(m);
    // NetSession's answer to a refusal: the session ends, nothing redials.
    if (m.t === "rejected") conn.close();
  };
  conn.connect({ name: "corecheck", dial: () => owner.dial() });
  const welcomed = await until(() => frames.some((f) => f.t === "welcome"));
  const welcome = frames.find((f): f is Extract<ServerMessage, { t: "welcome" }> => f.t === "welcome");
  c.that(
    `${tag}: a person dialled over a port is welcomed by \`Match\` at slot ${PERSON_SLOT}, team ${PERSON_TEAM}, on ${world.def.id} (protocol ${PROTOCOL_VERSION})`,
    welcomed && conn.state === "open" && welcome?.slot === PERSON_SLOT && welcome.team === PERSON_TEAM &&
      welcome.mapId === world.def.id,
    `welcomed ${welcomed}, state ${conn.state}, ${JSON.stringify(welcome)}`,
  );

  // The deploy is answered on the owner's clock: advanced a tick at a time
  // until the `spawn` arrives.
  const spawn = world.def.layout.spawns.findIndex((s) => s.team === PERSON_TEAM);
  conn.send({ t: "deploy", spawn });
  const spawned = (): { pos: Vec3; yaw: number } | undefined => {
    for (const f of frames) {
      if (f.t !== "events") continue;
      for (const e of f.events) if (e.e === "spawn" && e.slot === PERSON_SLOT) return e;
    }
    return undefined;
  };
  for (let i = 0; i < 4 * TICK_HZ && !spawned(); i++) {
    owner.advance(1 / TICK_HZ, false);
    await owner.settle();
    await until(() => spawned() !== undefined, 5);
  }
  const at = spawned();
  c.that(
    `${tag}: a \`deploy\` over the port is answered by a \`spawn\` as the owner advances`,
    at !== undefined,
    `${frames.length} frames, none a spawn for slot ${PERSON_SLOT}`,
  );

  // An honest report and a few seconds of clock: never corrected, the
  // scoreboard's ping answered across the port, snapshots at the wire's rate.
  // The report turns the look and nothing else, so a snapshot carrying that
  // look says the host has read it — and a port delivers in order, so a
  // correction it answered with arrived before that snapshot did.
  const look = at ? at.yaw + 0.5 : 0;
  if (at) {
    conn.send({
      t: "move",
      seq: 1,
      time: performance.now(),
      pos: at.pos,
      yaw: look,
      pitch: 0,
      crouching: false,
      sprinting: false,
    });
  }
  const pinged = (): boolean => frames.some((f) => f.t === "pings" && f.ms[PERSON_SLOT] >= 0);
  const turned = (): boolean =>
    frames.some((f) => f.t === "snap" && f.entities.some((e) => e.i === PERSON_SLOT && Math.abs(e.yaw - look) < 1e-3));
  let seconds = 0;
  while (seconds < 4 && !(pinged() && turned())) {
    for (let i = 0; i < TICK_HZ; i++) owner.advance(1 / TICK_HZ, false);
    await owner.settle();
    await until(() => pinged() && turned(), 50);
    seconds++;
  }
  // Stamped, not counted: the owner's clock is what a snapshot is on, so
  // every one is a snapshot interval of it after the last.
  const stamps = frames.flatMap((f) => (f.t === "snap" ? [f.now] : []));
  const uneven = stamps.slice(1).filter((t, i) => Math.abs(t - stamps[i] - 1000 / SNAPSHOT_HZ) > 1e-3);
  const corrections = frames.filter((f) => f.t === "correct").length;
  c.that(
    `${tag}: an honest \`move\` is not corrected, and every snapshot is stamped ${1000 / SNAPSHOT_HZ} ms of the owner's clock after the last`,
    at !== undefined && turned() && corrections === 0 && stamps.length >= seconds * SNAPSHOT_HZ &&
      uneven.length === 0,
    `${stamps.length} snapshots (${uneven.length} uneven) in ${seconds} s, ${corrections} corrections`,
  );
  c.that(
    `${tag}: the scoreboard's ping row is filled for a port, answered by the host's end of it`,
    pinged(),
    `no pings row for slot ${PERSON_SLOT} in ${seconds} s`,
  );

  const twice = await owner.open(world.def.id).then(
    () => "opened",
    (err: Error) => err.message,
  );
  c.that(
    `${tag}: a second \`open\` while a match is open is refused, over the channel`,
    twice.includes("already open"),
    twice,
  );

  await quietly(() => owner.close());
  const refused = await until(() => conn.state === "closed");
  const reason = frames.find((f): f is Extract<ServerMessage, { t: "rejected" }> => f.t === "rejected");
  const later = new Connection();
  const laterFrames: ServerMessage[] = [];
  later.onMessage = (m) => {
    laterFrames.push(m);
    if (m.t === "rejected") later.close();
  };
  later.connect({ name: "late", dial: () => owner.dial() });
  await until(() => later.state === "closed");
  const laterReason = laterFrames.find((f): f is Extract<ServerMessage, { t: "rejected" }> => f.t === "rejected");
  c.that(
    `${tag}: the owner's \`close\` is heard as \`rejected: match closed\`, and a dial after it is told there is no match`,
    refused && reason?.reason === "match closed" && laterReason?.reason === "no match is open",
    `closed ${refused}, ${JSON.stringify(reason)}, then ${JSON.stringify(laterReason)}`,
  );
  channel.port1.close();
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
  /**
   * Sent as `DriveMessage.resync` — the client's first report since it took
   * a `hullcorrect` (`NetSession`), which the scripts below set by hand.
   */
  resync?: boolean;
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

/** The person seated in `chair` (DRIVER by default) of hull `tank`, on either host. */
async function seatPilot(h: Host, tank: number, chair: CrewSeat = DRIVER): Promise<boolean> {
  await h.deploy(homeSpawn(h, PERSON_TEAM));
  if (!h.player().alive && stepUntilSpawned(h, 60) < 0) return false;
  const hull = h.core.vehicles.hulls[tank];
  const spot = h.core.vehicles.exitSpot(hull);
  placePerson(h, spot.x, spot.y, spot.z);
  await h.mount(tank, chair);
  h.flush();
  return h.player().seat === tank && h.player().crewSeat === chair;
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
        // The peer's message budget is a WALL-CLOCK bucket (`spendMessage`)
        // and this flight is delivered as fast as the script runs: topped up
        // per message, so the bucket is never what drops a sample here.
        for (const peer of h.match["peers"].values()) peer.budget = 1;
        h.transport.deliver({
          t: "drive", seq: ++seq, time: wire[w].stamp, tank: index,
          pos: [s.x, s.y, s.z], yaw: s.yaw, tyaw: s.turretYaw, gun: s.gunPitch, aimYaw: s.yaw, aimPitch: 0,
          ...(wire[w].resync ? { resync: 1 } : {}),
        });
        w++;
      }
      h.step();
    }
    // Snapshots after the last of it, so the client's gauge is read off the
    // state the flight ended in.
    for (let i = 0; i < 6; i++) h.step();
    let hp: number | null = null;
    for (const f of h.transport.frames) {
      if (f.t !== "snap") continue;
      const v = (f.vehicles as Array<{ i: number; hp: number }> | undefined)?.find((s) => s.i === index);
      if (v) hp = v.hp;
    }
    const corrections = h.transport.frames.filter((f) => f.t === "hullcorrect").length;
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
// The X2.5a review: the leash in a seat, the bounded clock, the broken series.

/** Runs `fn` with `console.log` silenced — a `Match` narrates its round. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

/** One message onto a Match host's transport, its wall-clock budget topped up first (`flyReportedMatch`'s reason). */
function deliver(h: MatchHost, msg: object): void {
  for (const peer of h.match["peers"].values()) peer.budget = 1;
  h.transport.deliver(msg);
}

/** Wire-clock origin the review's scripted peers stamp from, ms. */
const PEER0 = 1_700_000_000_000;

/**
 * **The leash kills a person in a flying hull** (the X2.5a review, item 1).
 * The person's own helicopter out past the play square — flown there as its
 * PILOT, reporting a hover twenty metres up, or set down there with them on
 * its GUN — on a core built as the offline page builds it and through
 * `Match`'s validated door. Inside the count they are put on foot (`seat`
 * -1) and killed from nobody, filed `other` and uncredited, exactly as the
 * leash kills a body; the hull is left standing, out of its chair; and both
 * hosts kill on the same tick.
 */
async function leashSeated(world: World, c: Checks): Promise<void> {
  for (const chair of [DRIVER, GUNNER] as const) {
    const name = chair === DRIVER ? "pilot" : "gunner";
    const ticks: number[] = [];
    for (const which of ["core", "match"] as const) {
      const tag = `leash/${name}/${which}`;
      await quietly(async () => {
        const h: CoreHost | MatchHost =
          which === "core" ? new CoreHost({ hostHoldsRespawn: true }) : new MatchHost(world.def, false);
        if (h instanceof CoreHost) h.start(world, 0);
        else await h.start(world, 0);
        const core = h.core;
        const index = heliOf(core);
        const tank = core.vehicles.hulls[index];
        const m = core.map!;
        const x = m.size / 2 + 40;
        const z = tank?.position.z ?? 0;
        const feet = m.terrain.heightAt(x, z) + (chair === DRIVER ? 20 : 0);
        // Nobody drives a gunner's hull: it is the core's to step, so it is
        // set down out there as a fresh hull is, before anybody boards.
        if (tank && chair === GUNNER) tank.placeAt({ x, y: feet, z }, tank.yaw);
        if (!c.that(`${tag}: fixture — seated in the person's helicopter`, index >= 0 && (await seatPilot(h, index, chair)))) {
          core.dispose();
          return;
        }
        const p = h.player();
        if (chair === DRIVER) {
          // The pilot's report is where the core poses the hull: written as
          // the accepted sample, so the reports below are a hover THERE.
          const held = core.reportedHull(p)!;
          held.x = x;
          held.y = feet;
          held.z = z;
        }
        let seq = 2000;
        const from = core.tick;
        let died = -1;
        let evs: SimEvent[] = [];
        const limit = Math.ceil(CONFIG.map.leash.seconds * TICK_HZ) + 120;
        for (let i = 0; i < limit && died < 0; i++) {
          if (chair === DRIVER && p.seat >= 0) {
            const time = i * DT;
            if (h instanceof CoreHost) {
              core.submit(PERSON_SLOT, {
                t: "drive", x, y: feet, z, yaw: tank.yaw, turretYaw: tank.turretYaw, gunPitch: tank.gunPitch,
                aimYaw: tank.yaw, aimPitch: 0, time,
              });
            } else if (i % 3 === 0) {
              deliver(h, {
                t: "drive", seq: ++seq, time: PEER0 + time * 1000, tank: index,
                pos: [x, feet, z], yaw: tank.yaw, tyaw: tank.turretYaw, gun: tank.gunPitch, aimYaw: tank.yaw, aimPitch: 0,
              });
            }
          }
          const mark = h.log.events.length;
          h.step();
          const now = since(h, mark);
          if (deathOf(now, PERSON_SLOT)) {
            died = core.tick;
            evs = now;
          }
        }
        ticks.push(died - from);
        const seat = evs.findIndex((e) => e.type === "seat" && e.slot === PERSON_SLOT && e.tank === -1);
        const dmg = evs.findIndex((e) => e.type === "damaged" && e.slot === PERSON_SLOT);
        const d = evs[dmg];
        const death = deathOf(evs, PERSON_SLOT);
        c.that(
          `${tag}: out past the play square in a flying hull, the person is put on foot and then killed — from nobody, filed \`other\`, uncredited`,
          died > from && seat >= 0 && dmg > seat && d?.type === "damaged" && d.killed && d.from === null &&
            death?.cause === "other" && !death.credited && !evs.some((e) => e.type === "award"),
          `died at ${died}, seat event at ${seat}, damaged at ${dmg}, ${fmtDeath(death)}`,
        );
        c.that(
          `${tag}: the hull is left standing and out of that chair; the person holds no seat`,
          tank.alive && !tank.seats[chair] && p.seat === -1 && !p.alive,
          `hull alive ${tank.alive} seats ${JSON.stringify(tank.seats)}, person seat ${p.seat} alive ${p.alive}`,
        );
        core.dispose();
      });
    }
    c.that(
      `leash/${name}: the trusted door and Match's validated one kill as many ticks after the fixture (${ticks.join(" / ")})`,
      ticks.length === 2 && ticks[0] > 0 && ticks[0] === ticks[1],
    );
  }
}

/**
 * **A peer's clock is BOUNDED by when its reports arrive** (the review, item
 * 2), on botless Sarab through `Match` with a fake peer:
 *
 * - a body sprinting honestly on honest stamps is never corrected, and one
 *   claiming three sprints a second on stamps inflated by half a second each
 *   is refused — the stretched stamp no longer buys the ground;
 * - a hard landing uploaded on stamps inflated by a second each is CHARGED,
 *   where an unbounded clock measured every rate over a second and landed it
 *   free;
 * - a gentle descent with one sample stamped a millisecond after the last is
 *   not a crash — a one-millisecond rate is no rate (`SimCoreOptions.reportGap`),
 *   where it used to pin the jolt at `joltLimit` and burn the hull.
 */
async function clockBound(world: World, c: Checks, route: { yaw: number; top: number; low: number }): Promise<void> {
  const tag = "clock";
  // --- the body: an honest sprint, then a fast one on stretched stamps ---
  await quietly(async () => {
    const h = new MatchHost(world.def, false);
    await h.start(world, 0);
    await h.deploy(homeSpawn(h, PERSON_TEAM));
    if (!c.that(`${tag}: fixture — the person deployed`, stepUntilSpawned(h, 120) > 0)) {
      h.core.dispose();
      return;
    }
    // A straight run of open ground from where they stand: the first of
    // sixteen bearings standable every half metre for 90 m.
    const p0 = h.player().position.clone();
    let dir: { x: number; z: number } | null = null;
    for (let k = 0; k < 16 && !dir; k++) {
      const a = (k / 16) * Math.PI * 2;
      const ux = Math.sin(a);
      const uz = Math.cos(a);
      let ok = true;
      for (let d = 0; d <= 90 && ok; d += 0.5) ok = standable(h, p0.x + ux * d, p0.z + uz * d);
      if (ok) dir = { x: ux, z: uz };
    }
    if (!c.that(`${tag}: fixture — 90 m of open ground from the spawn`, !!dir) || !dir) {
      h.core.dispose();
      return;
    }
    const sprint = CONFIG.player.moveSpeed * CONFIG.player.sprintMult;
    let seq = 3000;
    let stamp = PEER0;
    let d = 0;
    const run = (n: number, speed: number, stretch: number): number => {
      const before = h.transport.frames.filter((f) => f.t === "correct").length;
      for (let i = 0; i < n; i++) {
        d += speed / INPUT_HZ;
        stamp += 1000 / INPUT_HZ + stretch;
        const x = p0.x + dir!.x * d;
        const z = p0.z + dir!.z * d;
        deliver(h, {
          t: "move", seq: ++seq, time: stamp, pos: [x, groundY(h, x, z), z],
          yaw: Math.atan2(dir!.x, dir!.z), pitch: 0, crouching: false, sprinting: true,
        });
        for (let k = 0; k < TICK_HZ / INPUT_HZ; k++) h.step();
      }
      return h.transport.frames.filter((f) => f.t === "correct").length - before;
    };
    const honest = run(40, sprint, 0);
    const stretched = run(40, sprint * 3, 500);
    c.that(
      `${tag}: an honest sprint on honest stamps is never corrected (${honest} of 40)`,
      honest === 0,
    );
    c.that(
      `${tag}: three sprints a second on stamps stretched half a second each are refused (${stretched} of 40 corrected)`,
      stretched >= 35,
    );
    h.core.dispose();
  });

  // --- the helicopter: a hard landing on a lying clock, a 1 ms gap ---
  // On an EVEN network — each upload arriving three ticks after the step it
  // samples — so the arrivals are the flight's own clock and what the bound
  // leaves a lying stamp is exactly the honest interval.
  const hard = CRASH_PROFILES[0];
  const { track } = flyStepped(world, hard, route);
  const honestWire = wireOf(track, 9500, 0).map((w) => ({ ...w, at: Math.round(w.s.t / DT) + 3 }));
  const honest = await flyReportedMatch(world, honestWire);
  const lying = honestWire.map((w, k) => ({ ...w, stamp: w.stamp + 1000 * (k + 1) }));
  const lied = await flyReportedMatch(world, lying);
  c.that(
    `${tag}: a hard landing uploaded on stamps a second fast each is still charged (${lied.damage.toFixed(1)}, honest ${honest.damage.toFixed(1)})`,
    honest.damage > 0 && lied.damage >= 0.5 * honest.damage,
    `honest ${honest.damage}, lying ${lied.damage} (${lied.corrections} hullcorrects)`,
  );

  const gentle = CRASH_PROFILES.find((p) => p.name.startsWith("gentle"))!;
  const g = flyStepped(world, gentle, route);
  const gw = wireOf(g.track, 9600, 0);
  // A sample on the way down, a metre or more a second, stamped 1 ms after the last.
  let j = -1;
  for (let k = 2; k < gw.length && j < 0; k++) {
    const rate = (gw[k].s.y - gw[k - 1].s.y) / ((gw[k].stamp - gw[k - 1].stamp) / 1000);
    if (rate < -1 && gw[k].s.y - route.top > 3) j = k;
  }
  if (c.that(`${tag}: fixture — a sample in the gentle descent`, j > 0)) {
    const gap = gw.map((w, k) => (k === j ? { ...w, stamp: gw[k - 1].stamp + 1 } : w));
    const r = await flyReportedMatch(world, gap);
    c.that(
      `${tag}: a gentle descent with one sample 1 ms after the last costs nothing (${r.damage.toFixed(1)})`,
      r.damage === 0,
      `charged ${r.damage}, left ${r.left}, ${r.corrections} hullcorrects`,
    );
  }
}

/**
 * **A correction BREAKS the reported series, and the break is not a pass**
 * (the review, item 3), on botless Sarab through `Match`:
 *
 * - a pilot refused once in the middle of a full-rate descent, put back where
 *   the authority holds them, who reports their first sample since with
 *   `resync` and then flies down gently, is charged nothing — the stop the
 *   correction made is the authority's, not a landing;
 * - a pilot who LIES on the sample before touchdown (refused) and resyncs on
 *   the touchdown is charged the landing anyway: the descent the break cut is
 *   carried to the first rate after it, and a rate on the plank is a landing.
 */
async function correctionBreak(world: World, c: Checks, route: { yaw: number; top: number; low: number }): Promise<void> {
  const tag = "break";
  const hard = CRASH_PROFILES[0];
  const { track } = flyStepped(world, hard, route);
  const wire = wireOf(track, 9700, 0);
  const honest = await flyReportedMatch(world, wire);
  // The plank under a point, as feet, off a probe of the same pad.
  const probe = new SimCore({});
  probe.startRound(roundOf(world, 0));
  const hull = probe.vehicles.hulls[heliOf(probe)];
  const half = hull.spec.hull.height / 2;
  const floorFeet = (s: Sample) => hull.restAt(s.x, s.z, s.yaw, s.y) - half;
  const rateAt = (k: number) => (wire[k].s.y - wire[k - 1].s.y) / ((wire[k].stamp - wire[k - 1].stamp) / 1000);

  // (1) refused mid-descent, then a resync and a gentle way down.
  let j = -1;
  for (let k = 3; k < wire.length && j < 0; k++) {
    if (rateAt(k - 1) < -7.5 && wire[k].s.y - floorFeet(wire[k].s) > 5) j = k;
  }
  if (c.that(`${tag}: fixture — a sample in a full-rate descent, 5 m up`, j > 0)) {
    const a = wire[j - 1];
    const ground = floorFeet(a.s);
    const out: Wire[] = wire.slice(0, j);
    // The lie: sixty metres sideways in one upload — refused, `hullcorrect`.
    out.push({ ...wire[j], s: { ...wire[j].s, x: wire[j].s.x + 60 } });
    let stamp = wire[j].stamp;
    let at = wire[j].at;
    let y = a.s.y;
    // Put back where the authority holds it, the client holds there a round
    // trip (its first report says `resync`), then comes down at 1 m/s and sits.
    for (let n = 0; n < 400; n++) {
      stamp += 1000 / INPUT_HZ;
      at += 3;
      if (n >= 3) y = Math.max(ground, y - 1 / INPUT_HZ);
      out.push({ s: { ...a.s, y, t: 0 }, stamp, at, resync: n === 0 });
      if (y === ground && n > 60) break;
    }
    const r = await flyReportedMatch(world, out);
    c.that(
      `${tag}: refused mid-descent, put back, resynced and flown down gently — charged nothing (${r.damage.toFixed(1)})`,
      r.damage === 0 && r.corrections >= 1,
      `charged ${r.damage}, ${r.corrections} hullcorrects`,
    );
  }

  // (2) a lie on the sample before touchdown, a resync on the touchdown.
  let t = -1;
  for (let k = 2; k < wire.length && t < 0; k++) {
    if (wire[k].s.y - floorFeet(wire[k].s) < 0.02 && rateAt(k) < -4) t = k;
  }
  if (c.that(`${tag}: fixture — the touchdown sample`, t > 1)) {
    const out = wire.map((w, k) =>
      k === t - 1 ? { ...w, s: { ...w.s, x: w.s.x + 60 } } : k === t ? { ...w, resync: true } : w,
    );
    const r = await flyReportedMatch(world, out);
    c.that(
      `${tag}: a lie before touchdown and a resync on it still pays the landing (${r.damage.toFixed(1)}, uninterrupted ${honest.damage.toFixed(1)})`,
      honest.damage > 0 && Math.abs(r.damage - honest.damage) <= WIRE_SLACK,
      `charged ${r.damage} against ${honest.damage}, ${r.corrections} hullcorrects`,
    );
  }
  probe.dispose();
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
      const owned = new Checks("greyfen/owned");
      const benchHex = await ownedMatch(world, owned);
      for (const r of owned.results) report(owned.tag, r);
      const local = new Checks("greyfen/local");
      await localMatch(world, local, benchHex);
      for (const r of local.results) report(local.tag, r);
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

    // The review's three (X2.5a): the leash in a seat, the bounded clock,
    // the broken series — on the same botless Sarab and the same corridor.
    const probe = new SimCore({});
    probe.startRound(roundOf(world, 0));
    const route = clearBearing(probe, probe.vehicles.hulls[heliOf(probe)]);
    probe.dispose();
    const review: Array<[string, (c: Checks) => Promise<void>]> = [
      ["sarab/leash", (c) => leashSeated(world, c)],
      ["sarab/clock", (c) => clockBound(world, c, route)],
      ["sarab/break", (c) => correctionBreak(world, c, route)],
    ];
    for (const [tag, run] of review) {
      const c = new Checks(tag);
      await run(c);
      for (const r of c.results) report(c.tag, r);
    }
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
