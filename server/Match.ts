/**
 * server/Match.ts — One match: its roster, its peers, its simulation loop, and
 * the snapshots that go out from it.
 * Owns: the fixed-step clock, the peer set, and the bridge between a roster slot
 * changing hands and the bot in that slot being benched or released. It owns no
 * game rules — those are `HeadlessGame`'s — and no transport details beyond
 * `send`/`broadcast`, which are the one place a dead socket is handled.
 * Invariants: a peer's slot is assigned here and nowhere else, and a peer never
 * names its own slot. The loop is fixed-step and drift-corrected: a `dt` taken
 * from wall clock would make the simulation run at the speed of the server's
 * load, and every recoil, bleed and reload timer in `CONFIG` is written against
 * real seconds.
 */
import { Vector3 } from "@babylonjs/core";
import type { WebSocket } from "ws";
import {
  encode,
  MAX_NAME_LENGTH,
  PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  INPUT_HZ,
  TICK_HZ,
  type ClientMessage,
  type EntityState,
  type GrenadeState,
  type MatchSummary,
  type PointState,
  type MineState,
  type RocketState,
  type ServerEvent,
  type ServerMessage,
  type Snapshot,
  type VehicleState,
} from "../src/net/protocol";
import { CONFIG } from "../src/config";
import {
  DEFAULT_WEAPON,
  isPrimaryWeaponId,
  SIDEARM,
  weaponSetup,
  WEAPON_IDS,
  type WeaponSetup,
} from "../src/entities/weapons";
import {
  DEFAULT_EQUIPMENT,
  equipmentSetup,
  isEquipmentId,
  type EquipmentId,
} from "../src/entities/equipment";
import { DRIVER, GUNNER, type CrewSeat } from "../src/entities/Vehicle";
import { MAPS } from "../src/world/maps";
import { HeadlessGame } from "./HeadlessGame";
import { Roster } from "./Roster";
import { validateDrive, validateMove } from "./validate";
import { readClientMessage } from "./wire";

/** One connected human. */
interface Peer {
  id: string;
  name: string;
  socket: WebSocket;
  /** The roster slot this peer holds, which is also its entity id on the wire. */
  slot: number;
  /** Last input sequence accepted from this peer. */
  seq: number;
  /**
   * Inbound messages this peer may still send, and when that was last topped
   * up. A bucket rather than a counter per window — see `spendMessage`.
   */
  budget: number;
  budgetAt: number;
  /**
   * The round trip to this peer in ms, smoothed, or -1 before its first pong
   * has come back. See `pingPeer`.
   */
  ping: number;
  /** When the outstanding ping went out, or 0 when there is not one. */
  pingAt: number;
  /**
   * What that ping carried, so a pong is matched to the ping it answers.
   *
   * The process-wide liveness sweep in `server/index.ts` pings the very same
   * sockets, and its pongs arrive here too — without a token this class would
   * time its own ping against somebody else's answer. The payload of a pong is
   * the payload of the ping that caused it (RFC 6455), so the token is the
   * whole of the test.
   */
  pingToken: number;
}

/**
 * A queued event and who is allowed to see it.
 *
 * Most of what happens in a match is public — a flag changed hands, a body went
 * down, a grenade went off — and every client needs it to draw the same round.
 * A few are one person's business, and those are ADDRESSED rather than
 * broadcast-and-filtered: a client cannot act on what it was never sent, and a
 * filter on the far side is a promise about the client rather than a property
 * of the server.
 */
interface PendingEvent {
  /** The slot this is for, or `ALL_PEERS`. */
  to: number;
  ev: ServerEvent;
}

/** `PendingEvent.to` for an event every client gets. */
const ALL_PEERS = -1;

const STEP_MS = 1000 / TICK_HZ;

/**
 * The largest client-reported gap a single movement sample may claim, in
 * seconds. Longer stalls are legitimate — a backgrounded tab, a GC pause — but
 * the ground they would buy is not, so the step is validated against this and
 * the rest of the gap is simply lost.
 */
const MAX_MOVE_GAP = 0.5;

/**
 * How far off their own reported aim a claimed shot may leave, as a cosine.
 *
 * Generous — about 25 degrees — because it is bounding a lie rather than
 * measuring accuracy: the client's own spread, the recoil that has not been
 * reported yet, and a whole `INPUT_HZ` interval of un-uploaded mouse movement
 * all legitimately live inside it. Tightening it toward the real spread cone
 * would start refusing honest shots from anyone turning quickly.
 */
const SHOT_CONE_COS = Math.cos((25 * Math.PI) / 180);

/**
 * The same bound for a tank gun, and it is WIDER — about 50 degrees.
 *
 * Measured against the driver's reported LOOK rather than against the gun,
 * because the gun's bearing is the thing being claimed. The turret walks
 * toward the look at `traverseRate`, so the two legitimately disagree by
 * however far the traverse has not caught up — which after a fast look across
 * the field is most of a quarter turn. What is left is still a bound worth
 * having: it refuses a shell claimed to have left backwards, and everything
 * inside it is a direction the gun could genuinely have been pointing.
 */
const SHELL_CONE_COS = Math.cos((50 * Math.PI) / 180);

/**
 * How far a claimed shell's muzzle may be from the hull's own centre, in
 * metres.
 *
 * `onShot`'s origin gate, sized for a vehicle: the muzzle is at the end of a
 * barrel on a turret that traverses, so the honest distance is most of the
 * hull's length. Generous, and it costs nothing to be — the round is fired
 * down the authority's own gun from the authority's own muzzle whatever this
 * says, so all this bounds is which hull a client may claim to be shooting
 * out of.
 */
const SHELL_ORIGIN_SLACK = 9;

/**
 * …and how far a rocket's tube or a mine's plate may be from the layer's own
 * eye. A body's reach plus the launch clearance the muzzle already stands off
 * at, which is what stops a mine being posted across the street.
 */
const ORDNANCE_ORIGIN_SLACK = 4;

/** Scratch for an ordnance ask, so the path allocates nothing. */
const ORDNANCE_AT = new Vector3();
const ORDNANCE_DIR = new Vector3();

/**
 * The same bound for a thrown grenade, and wider because the throw itself is
 * not along the aim: `CONFIG.grenade.throwLift` tilts it up before it leaves.
 */
const GRENADE_CONE_COS = Math.cos((50 * Math.PI) / 180);

/** How far a claimed muzzle may be from the shooter's own head, in metres. */
const MAX_ORIGIN_SLIP = 2;

/**
 * The fastest anything in the weapon table can be fired, in rounds a second.
 *
 * DERIVED rather than written down, for the reason `validate.ts` derives its
 * speed ceiling from `CONFIG.player`: a weapon added at thirty rounds a second
 * would otherwise make every player carrying it look like a flooder, and the
 * symptom — dropped shots for one weapon only — would read as anything but a
 * constant in this file.
 */
const FASTEST_FIRE_HZ = Math.max(
  ...WEAPON_IDS.map((id) => CONFIG.weapons[id].fireRate),
);

/**
 * How long the sidearm takes to reload.
 *
 * The floor under the reload announcement's rate gate, alongside whatever
 * primary the peer picked: everyone carries the pistol whatever else is in the
 * kit, and the server is not told which of the two is in the hands. Derived
 * from the table rather than written down, for the reason `FASTEST_FIRE_HZ`
 * above is — a faster sidearm would otherwise make everybody's second reload
 * silent, and the symptom would look like anything but a constant in this file.
 */
const SIDEARM_RELOAD = CONFIG.weapons[SIDEARM].reloadTime;

/**
 * Inbound messages one peer may send per second, sustained.
 *
 * **`onShot` was the only thing here with a rate limit, and a weapon's rate of
 * fire is not the rate a socket can talk at.** A client's honest traffic is
 * movement at `INPUT_HZ` plus at most one `shot` per round of the fastest
 * weapon there is; grenades are bounded by a pouch of two and deploys by a
 * screen a person is looking at, so both disappear into the doubling. Anything
 * past that is a client this process would otherwise `JSON.parse` and act on as
 * fast as it can produce it — and `onMove` is the expensive one, because it
 * spends a nav-graph lookup and an obstacle resolve on every sample and answers
 * a rejected one with a `correct` message BACK, so an unbounded inbound rate is
 * an unbounded outbound rate too. There is one core here and every match on the
 * box shares it.
 */
const MESSAGE_RATE = (INPUT_HZ + FASTEST_FIRE_HZ) * 2;

/**
 * How much of that a peer may bank against a moment of it — one second's worth,
 * which is an order of magnitude more than the bunching a real connection
 * delivers after a stall and still a bound.
 */
const MESSAGE_BURST = MESSAGE_RATE;

/**
 * How far past its allowance a peer may get before the socket is closed rather
 * than the message dropped.
 *
 * Dropping is the ordinary answer, because the ordinary cause is a connection
 * that bunched rather than a client that is misbehaving, and a laggy player who
 * loses a movement sample loses nothing a later one does not correct. Five
 * seconds of solid over-budget traffic is not that: it is a client with a
 * runaway loop or a peer with a purpose, and either is better off the socket.
 */
const MESSAGE_DEBT = MESSAGE_RATE * 5;

/**
 * How long an empty match keeps its world before throwing it away.
 *
 * Long enough that a player who dropped and reconnected rejoins the round they
 * were in rather than a fresh one; short enough that a public server does not
 * accumulate abandoned scenes.
 */
const IDLE_DISPOSE_MS = 60_000;

/** How long the round-over card stays up before the next map is built. */
const ROUND_OVER_MS = 8_000;

/** Scratch for shot resolution; reused so a firefight allocates nothing. */
const SHOT_ORIGIN = new Vector3();
const SHOT_DIR = new Vector3();

/**
 * Ticks between snapshots. `SNAPSHOT_HZ` divides `TICK_HZ`, so this is exact —
 * see the note on those constants for why a fractional ratio is not allowed.
 */
const TICKS_PER_SNAPSHOT = TICK_HZ / SNAPSHOT_HZ;

/**
 * Ticks between one sweep of transport pings, and between the tables reporting
 * what the last sweep measured.
 *
 * A second. It is a number a player glances at between deaths rather than
 * anything the game reads, so measuring it twenty times a second would buy
 * nothing but traffic; and it is a round trip per peer per second, which is two
 * frames of nothing next to the snapshot going the same way.
 *
 * Written as snapshots-per-second rather than as `TICK_HZ` so it is a MULTIPLE
 * of `TICKS_PER_SNAPSHOT` by construction: the sweep runs inside
 * `broadcastSnapshot`, and an interval that is not one would simply never come
 * round.
 */
const TICKS_PER_PING = TICKS_PER_SNAPSHOT * SNAPSHOT_HZ;

/**
 * How much of a new round-trip sample replaces the running estimate.
 *
 * One sample is one packet that may have queued behind anything — a burst of
 * snapshots, a wifi retransmit, the far end's kernel — so a display fed the raw
 * number jumps between 40 and 180 and back on a connection that is genuinely
 * fine. Half is mild: two samples of a real change and the reading is most of
 * the way there, which at this cadence is two seconds behind a connection that
 * actually deteriorated and nobody has ever needed it sooner.
 */
const PING_SMOOTHING = 0.5;

/** What an unusable name falls back to, so a slot always has something to say. */
const NAME_FALLBACK = "operative";

/**
 * A display name that can safely go on fifteen other people's screens.
 *
 * BOUNDED rather than validated — anything may be a name, so this strips what
 * is not one: the C0/C1 control characters (which can hide the rest of a string
 * or rewrite a log line) and whitespace runs that make one name read as
 * several. The length cap matters because the name is in every roster
 * broadcast, and a client that could state a kilobyte would be handed sixteen
 * ways to send it.
 *
 * The `typeof` guard is not paranoia: `decode` returns parsed JSON asserted to
 * a `ClientMessage`, so the static type is a claim about a well-behaved client
 * and nothing more. Every other field off that message is range-checked before
 * use for the same reason.
 *
 * It deliberately does NOT escape markup. Escaping belongs to whatever renders
 * the string, and a name stored pre-escaped shows up as `&amp;` the moment it
 * reaches something that escapes properly — every screen in `src/ui/` writes a
 * name with `textContent`, which needs none.
 */
function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return NAME_FALLBACK;
  const clean = raw
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return clean.length > 0 ? clean : NAME_FALLBACK;
}

let nextPeerId = 1;

export class Match {
  readonly roster = new Roster();
  readonly game = new HeadlessGame();

  private readonly peers = new Map<string, Peer>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * The map this match is on. The AUTHORITY's, from the moment it is built:
   * every client that joins is told it in the welcome and builds that world
   * locally, whatever its own menu had selected.
   *
   * Assigned in the constructor from what the creating peer asked for, and
   * `rotate` is the only thing that moves it afterwards.
   */
  private mapId: string;
  private ticks = 0;

  /**
   * Events accumulated since the last broadcast, each with the audience it is
   * for: `ALL_PEERS`, or the one roster slot it is addressed to.
   *
   * Queued rather than sent as they happen because a kill and the snapshot that
   * shows the body falling belong in the same frame for a client: delivering the
   * killfeed line first makes the corpse arrive late, and it reads as lag in the
   * one moment a player is paying most attention.
   *
   * The audience is carried on the queue rather than kept in a second list so
   * that ORDER survives it. Events are a single stream to a client — the hit
   * credits `Game.claimPredictedHit` pairs off are FIFO with no shot id on the
   * wire — and two lists flushed one after the other would put a tick's shared
   * events either wholly before or wholly after that client's own, whichever
   * way round the flush happened to be written.
   */
  private readonly pending: PendingEvent[] = [];

  /** Reused so a snapshot allocates nothing per tick beyond its own arrays. */
  private readonly entityScratch: EntityState[] = [];

  /**
   * The same, for whatever is in the air. Usually empty, and an empty one is
   * left OFF the snapshot rather than sent — see `Snapshot.grenades`.
   */
  private readonly grenadeScratch: GrenadeState[] = [];
  /** …and the hulls, and the rockets. Same reason, same lifetime. */
  private readonly vehicleScratch: VehicleState[] = [];
  private readonly rocketScratch: RocketState[] = [];

  /** Last broadcast position per slot, for deriving a player's walk cycle. */
  private readonly lastSeen: ({ x: number; z: number } | undefined)[] = [];

  /**
   * What each seated player is carrying, resolved from the weapon TABLE.
   *
   * The server owns this. A client names a weapon id at join and the id is
   * validated; the damage, range and fall-off are looked up here and never
   * cross the wire, because a client that could state its own damage would
   * state whatever it liked.
   */
  private readonly loadouts = new Map<number, WeaponSetup>();

  /**
   * What each seated player has in the THIRD slot, resolved from the equipment
   * table here for `loadouts`' reason exactly.
   *
   * A separate map rather than a field on the `WeaponSetup` beside it, because
   * they are answers to different questions: one is the weapon this person is
   * shooting people with and the other is the thing they carry for armour, and
   * `equipmentSetup` deliberately resolves to a `WeaponSetup` whose every
   * combat field says it is not a gun.
   */
  private readonly equipment = new Map<number, EquipmentId>();

  /** When each slot last fired, for the rate limit. */
  private readonly lastShot: number[] = [];

  /** …and last announced a reload, for that message's own gate. */
  private readonly lastReload: number[] = [];

  /**
   * …and last spent an AT item, and last fired a tank gun.
   *
   * Two more of `lastShot`'s clock, and both are needed for its reason: a
   * client asking for a rocket or a shell is asking the authority to put an
   * object in the world, and without a gate the rate at which it may do so
   * would be a client-side opinion. The gun's own reload already refuses a
   * shell fired early (`Vehicle.fireGun` returns false) — this is the cheaper
   * refusal in front of it, so a flood costs a comparison rather than a hull
   * lookup.
   */
  private readonly lastOrdnance: number[] = [];
  private readonly lastShell: number[] = [];
  /**
   * The same clock for the CUPOLA gun, and a second array rather than a second
   * meaning on the one above: a hull has two guns with two triggers and two
   * people, and one timestamp shared between them would let either seat's fire
   * rate-limit the other's.
   */
  private readonly lastMg: number[] = [];

  /**
   * The `AntiTankSystem.version` the clients have been told about, or -1 for
   * "tell them".
   *
   * `sentScoreVersion`'s twin, for the table that behaves the same way: a mine
   * never moves, so the list goes out when the SET changes and not otherwise.
   */
  private sentMineVersion = -1;

  /**
   * How many rounds each slot has fired since the last snapshot went out.
   *
   * One `fire` event per slot per snapshot is still the whole of what goes on
   * the wire — the difference between a burst and a held trigger must not be
   * the difference between one small event and thirty — but the COUNT rides
   * along on it, because the client makes a report out of this as well as a
   * minimap reveal. A reveal is a timer being refreshed and does not care how
   * many rounds refreshed it; a string of shots the player is meant to place by
   * ear is three rounds and has to sound like three.
   *
   * Drained in `broadcastSnapshot`, which is also the only place `pending` is
   * flushed, so a fire raised on any tick of the interval leaves on the same
   * message as everything else that happened in it.
   */
  private readonly firedRounds = new Map<number, number>();

  /**
   * The `ScoreBook` version the clients have been told about, or -1 for "tell
   * them".
   *
   * The board is state and goes out only when it moves, so this is the whole of
   * that test: `broadcastSnapshot` compares it against the simulation's counter
   * and sends the table when the two differ. It starts at -1 so the empty board
   * of a fresh round is published once rather than waiting for the first death,
   * and `rotate` puts it back for the same reason.
   */
  private sentScoreVersion = -1;

  /**
   * `wantedMap` is the map id the peer whose join created this match asked for.
   *
   * RESOLVED against the real table rather than taken as sent, exactly as the
   * weapon id is in `admit`: an id this build has never heard of — an older
   * client, a newer one, or something a peer made up — falls back to the default
   * map instead of standing up a match naming a world that does not exist here.
   * Nothing downstream re-checks it, which is why this is the one door.
   */
  constructor(readonly id: string, wantedMap?: string) {
    this.mapId = MAPS.find((m) => m.id === wantedMap)?.id ?? MAPS[0].id;
    // A bot went down, however it was done. The bearing, the size and the KIND
    // of the killing blow ride along because a client throws its corpse with
    // them — `Bot.takeDamage` captured all three before this fired, which is
    // the same triple the offline game hands `RagdollSystem` and the reason it
    // does not need a second copy of any of it.
    this.game.onKillEvent = (bot, killer, headshot) => {
      this.queue({
        e: "kill",
        killer,
        victim: this.game.battle.bots.indexOf(bot),
        headshot,
        from: [bot.deathFrom.x, bot.deathFrom.y, bot.deathFrom.z],
        amount: bot.deathDamage,
        kind: bot.deathKind,
      });
    };
    // A bot pulled its trigger. Taken HERE rather than in `HeadlessGame.wire`
    // because nothing in the simulation wants it — it is news for a screen, and
    // the queue that carries news to a screen is this class's. It is also the
    // only way the fact can reach one: a client runs none of the AI, so a bot's
    // shot is otherwise silent and invisible on every machine but this one.
    this.game.battle.onBotFired = (bot) =>
      this.noteFire(this.game.battle.bots.indexOf(bot));
    // A bot working its magazine, taken here for exactly the reason its trigger
    // is: the fact belongs to the authority (no client runs the AI) and what it
    // is FOR belongs to a screen — or in this case an ear, since a reload is
    // the cue to push whoever has just gone dry.
    this.game.battle.onBotReloaded = (bot) =>
      this.noteReload(this.game.battle.bots.indexOf(bot));
    // A round that went past somebody. Addressed to the one person it happened
    // to, and the copy is not optional: `at` is `CombatSystem`'s module scratch
    // and the next round in the firefight overwrites it.
    this.game.onNearMiss = (player, at) =>
      this.queueTo(player.slot, { e: "nearmiss", at: [at.x, at.y, at.z] });
    // Through the simulation rather than off `ConquestSystem` directly: a flag
    // changing hands pays everybody standing on it, which is a rule, so
    // `HeadlessGame` takes the conquest callbacks and hands the news back out
    // — the same shape `onKillEvent` has, and for the same reason.
    this.game.onCapturedEvent = (point, by) =>
      this.queue({ e: "captured", point: point.def.id, by });
    this.game.onNeutralisedEvent = (point) =>
      this.queue({ e: "neutralised", point: point.def.id });
    // Somebody was paid. Addressed to the one slot that earned it, and only
    // when a PERSON is sitting in it: bots earn all round and there is nobody
    // behind them to show a feed to, so queueing theirs would push every tick
    // with a bot kill on it onto `flushEvents`'s per-peer path for an event no
    // client would be sent.
    this.game.scores.onAward = (slot, kind, points) => {
      if (this.game.players.has(slot)) {
        this.queueTo(slot, { e: "score", kind, points });
      }
    };
    this.game.onPlayerDamaged = (player, amount, from, killed, kind) => {
      // Addressed to the victim, and the sharpest case for it: this is the ONE
      // message in the protocol carrying a health, so broadcasting it published
      // every player's exact pool to everybody, live, along with the bearing
      // they were shot from. That is the read a wallhack wants — who is hurt
      // and which way they are facing it — handed over for free.
      //
      // The `kill` below stays public, and the pair is the line: that somebody
      // DIED is everyone's business, because the killfeed and the corpse are on
      // every screen. How close they were to dying is nobody's but theirs.
      this.queueTo(player.slot, {
        e: "damage",
        victim: player.slot,
        amount,
        from: from ? [from.x, from.y, from.z] : [0, 0, 0],
        health: player.health,
        // The victim's own corpse is thrown from this rather than from the
        // `kill` below: a client reads its OWN death off the `damage`/`died`
        // pair, and only somebody else's off the kill.
        kind,
      });
      if (killed) {
        // The other half of "one kill event per death". A person goes down
        // through this callback whoever pulled the trigger — a bot's rifle, a
        // blast, another client's round — so it is the only place that sees
        // every one of them, exactly as `onKillEvent` is for a bot.
        //
        // The killer's team is DERIVED and not carried: friendly fire is
        // excluded by construction everywhere in this game (`fire` takes the
        // shooter's own target list), so the side that killed a person is
        // always the other one, and plumbing a killer down through
        // `CombatSystem.takeDamage` to be told what is already known would be
        // the kind of wire field that can disagree with the world.
        //
        // `headshot` is false rather than unknown: the flag is the SHOOTER's
        // feedback and reaches them on their own `hit` event, which is
        // resolved where the head zone was actually tested. Nothing renders it
        // for a victim.
        this.queue({
          e: "kill",
          // …and the one death that has no killer to derive. The leash passes
          // no origin because nothing shot this player, and -1 is what stops
          // the feed on sixteen screens announcing that the other side did.
          killer: from ? 1 - player.team : -1,
          victim: player.slot,
          headshot: false,
          from: from ? [from.x, from.y, from.z] : [0, 0, 0],
          amount,
          kind,
        });
        this.queue({
          e: "died",
          slot: player.slot,
          by: -1,
          respawnIn: player.respawnT,
        });
      }
    };
    // How big it LOOKS goes with it now that more than one thing explodes: a
    // grenade is 1 by definition, a tank shell 1.85, the AT kit its own. Left
    // off at 1 for the reason `fire`'s `n` is left off at one round — that is
    // what the field's absence has always meant and what every grenade in the
    // game still is.
    this.game.onExplosion = (at, power) =>
      this.queue(
        power === 1
          ? { e: "explode", at: [at.x, at.y, at.z] }
          : { e: "explode", at: [at.x, at.y, at.z], power },
      );
    // A tank gun. Public, and `fire`'s counterpart for the one weapon nobody
    // is carrying — it reaches a client no other way, because no client runs
    // the crew that pulled the trigger or resolves the round it fired.
    this.game.onCannon = (tank) => {
      const i = this.game.vehicles.hulls.indexOf(tank);
      if (i >= 0) this.queue({ e: "cannon", tank: i });
    };
    // The answer to a mount or a dismount, addressed to the one person who
    // asked — see the `seat` event. It is raised for the hull BURNING as well,
    // which is the one seat change nobody asked for and the one a client can
    // least afford to miss: without it the driver's own screen keeps the chase
    // camera on a wreck for the rest of the round.
    this.game.onSeatChanged = (player, tank, at, yaw) =>
      this.queueTo(
        player.slot,
        tank >= 0
          ? { e: "seat", slot: player.slot, tank, seat: player.crewSeat }
          : { e: "seat", slot: player.slot, tank, pos: [at.x, at.y, at.z], yaw },
      );
    // Glass. One event for however many panes the round crossed, carrying the
    // FIRST crossing and the round's direction — see the `glass` event for why
    // the shards of the panes behind it are thrown from a point a few metres
    // off rather than paying a message each.
    this.game.onGlassBroken = (panes, at, dir) =>
      this.queue({
        e: "glass",
        panes,
        at: [at.x, at.y, at.z],
        dir: [dir.x, dir.y, dir.z],
      });
    this.game.onPlayerSpawned = (player, at, yaw) =>
      this.queue({
        e: "spawn",
        slot: player.slot,
        pos: [at.x, at.y, at.z],
        yaw,
      });
  }

  hasBotSlot(): boolean {
    return this.roster.hasBotSlot();
  }

  /**
   * This match as the lobby lists it.
   *
   * `state` is read off what is actually running rather than tracked as a
   * field, so it cannot disagree with the loop: the timer exists only while
   * there are peers (`stop` clears it when the last one leaves) and `rotating`
   * spans the gap between a round ending and the next map being built.
   */
  summary(): MatchSummary {
    return {
      id: this.id,
      mapId: this.mapId,
      humans: this.roster.humanCount,
      slots: this.roster.slots.length,
      state: this.rotating ? "rotating" : this.timer ? "live" : "empty",
    };
  }

  /**
   * Seats a connected socket.
   *
   * A refused join is a full match, which the registry should have prevented by
   * routing elsewhere — but the check is kept here anyway, because the caller
   * asking "is there room" and this method acting on the answer are two separate
   * moments and a race between them is exactly how a seventeenth player gets in.
   */
  async admit(
    socket: WebSocket,
    rawName: string,
    weapon?: string,
    equipment?: string,
  ): Promise<void> {
    const id = `p${nextPeerId++}`;
    // Cleaned HERE, at the one door into the roster, rather than at the
    // handshake — the same placement as the weapon lookup below, and for the
    // same reason: a second caller of `admit` must not be able to skip it.
    const name = cleanName(rawName);
    const slot = this.roster.claim(id, name);
    if (!slot) {
      socket.send(encode({ t: "rejected", reason: "match full" }));
      socket.close();
      return;
    }

    const peer: Peer = {
      id,
      name,
      socket,
      slot: slot.index,
      seq: 0,
      budget: MESSAGE_BURST,
      budgetAt: Date.now(),
      ping: -1,
      pingAt: 0,
      pingToken: 0,
    };
    this.peers.set(id, peer);
    // Somebody came back before the world was thrown away.
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    socket.on("message", (raw) => {
      // Gone: dropped by `spendMessage` below, or by a `close` whose remaining
      // buffered messages are still being delivered. Either way this peer has
      // no slot to act on any more, and the test is what stops a flooder being
      // logged and refused once per message all the way through the close.
      if (!this.peers.has(id)) return;
      // Before the decode, because the parse is what a flood is spending.
      if (!this.spendMessage(peer)) return;
      // `readClientMessage` and never `decode`: the shape gate is what makes
      // the `ClientMessage` type below a fact rather than a claim about a
      // well-behaved client, and every handler past this line reads fields off
      // it without checking them again. See `server/wire.ts` — a `move` with no
      // `pos` on it used to throw out of this listener and take the process.
      const msg = readClientMessage(String(raw));
      if (msg) this.onMessage(peer, msg);
    });
    socket.on("close", () => this.drop(peer));
    socket.on("error", () => this.drop(peer));
    // The far end answered a ping, and the gap is what the scoreboard shows.
    // A pong with any other payload is the liveness sweep's in `index.ts`,
    // which pings the same socket on its own clock and would otherwise be
    // timed against a ping this class sent at a different moment.
    socket.on("pong", (data) => {
      if (peer.pingAt === 0 || data.toString() !== String(peer.pingToken)) return;
      const sample = Date.now() - peer.pingAt;
      peer.pingAt = 0;
      peer.ping =
        peer.ping < 0 ? sample : peer.ping + (sample - peer.ping) * PING_SMOOTHING;
    });

    // The round is built on the first arrival, not at construction: building a
    // world costs a couple of hundred milliseconds and a match nobody has joined
    // has nothing to simulate.
    await this.ensureRunning();

    // That await is long enough for the socket to have gone — a tab closed, a
    // connection that never really came up — and `close` was wired above it, so
    // `drop` has ALREADY run: it released the roster slot and put the bot back.
    // Seating the player now would bench that bot for the life of the match and
    // leave a body in `HeadlessGame.players` that no peer owns and nothing ever
    // removes, because the only thing that removes one is the drop that has
    // been and gone. The team plays a body short and the ghost is tracked for
    // rewind forever.
    //
    // Tested on the peer map rather than on a flag, because that map is what
    // `drop` empties and what everything else here reads to mean "still
    // connected".
    if (!this.peers.has(id)) return;

    // The bot in this slot comes off the field and a person takes its place.
    const player = this.game.addPlayer(slot.index, slot.team);
    // A slot changing hands must not inherit the last occupant's travel. The
    // walk cycle is derived from how far a body moved between snapshots, so a
    // stale entry here makes the new arrival's first frame a sprint from
    // wherever the previous player was standing.
    delete this.lastSeen[slot.index];
    // Resolved from the weapon table HERE, not taken from the client. An
    // unknown id, or the sidearm (which the kit screen never offers), falls
    // back to the default rather than being refused — a client on a newer
    // build naming a weapon this server has not heard of should still play.
    this.loadouts.set(
      slot.index,
      weaponSetup(weapon && isPrimaryWeaponId(weapon) ? weapon : DEFAULT_WEAPON),
    );
    // The third slot, resolved the same way and for the same reason: what a
    // rocket is worth and how many mines a person may have on the field are
    // this side's numbers. An id this build has never heard of falls back to
    // the launcher rather than being refused, exactly as an unknown weapon
    // falls back to the rifle.
    //
    // It is resolved on every map, including the two that offer no third slot
    // at all: the kit is the MAP's question and `armourOffered` is where a
    // client answers it, so what happens on a map with no armour is simply
    // that no `ordnance` message ever arrives to spend this on. Resolving it
    // conditionally would mean a rotation onto a map WITH armour leaving this
    // player carrying nothing.
    const kit = equipment && isEquipmentId(equipment) ? equipment : DEFAULT_EQUIPMENT;
    this.equipment.set(slot.index, kit);
    player.ordnanceCarried = equipmentSetup(kit).magSize;
    player.ordnance = player.ordnanceCarried;
    // Not spawned here: a fresh player is dead with a zero timer, which is
    // exactly the state the reinforcement pass in `HeadlessGame.step` picks up.
    // Joining and redeploying are the same act and go through the same door.

    this.send(peer, {
      t: "welcome",
      version: PROTOCOL_VERSION,
      matchId: this.id,
      slot: slot.index,
      team: slot.team,
      mapId: this.mapId,
      now: Date.now(),
      // The glass as it stands, to this peer alone, for the same reason the
      // board below goes with it: a joiner has missed every `glass` event in
      // the round, so without this they see a street of intact windows the
      // rest of the match has shot out — and are held out of a shopfront
      // everybody else walks through. Omitted when nothing is broken, which is
      // most joins and is what an older server means by saying nothing.
      ...(this.game.glass.brokenPanes.length > 0
        ? { brokenPanes: this.game.glass.brokenPanes }
        : {}),
    });
    this.broadcastRoster();
    // The board as it stands, to this peer alone. A joiner arrives mid-round
    // and has missed every kill in it, so without this their scoreboard is
    // zeros until somebody happens to die — and in a quiet minute that is a
    // screen confidently reporting that nothing has happened all round.
    this.send(peer, this.scores());
    // Started now rather than on the next sweep, so this peer's own row has a
    // real number on it by the time the first table reaches them — a second of
    // "—" against your own name reads as a connection that is not working.
    this.pingPeer(peer);
    console.log(
      `[${this.id}] ${name} (${id}) took slot ${slot.index} on team ${slot.team}`,
    );
  }

  /**
   * A peer left. Its slot goes back to being a bot, and the bot walks on.
   *
   * The same handover as `admit`, run backwards, and it is why the roster is a
   * fixed table rather than a list that grows: there is nothing to allocate,
   * nothing to place in the world, and no window in which the match is fifteen
   * bodies instead of sixteen.
   */
  private drop(peer: Peer): void {
    if (!this.peers.delete(peer.id)) return;
    this.game.removePlayer(peer.slot);
    this.loadouts.delete(peer.slot);
    this.equipment.delete(peer.slot);
    delete this.lastShot[peer.slot];
    delete this.lastOrdnance[peer.slot];
    delete this.lastShell[peer.slot];
    delete this.lastMg[peer.slot];
    delete this.lastReload[peer.slot];
    delete this.lastSeen[peer.slot];
    const slot = this.roster.release(peer.id);
    if (slot) {
      console.log(`[${this.id}] ${peer.name} left; slot ${slot.index} back to a bot`);
    }
    this.broadcastRoster();
    // Nobody watching: stop burning a core on a fight with no audience. The
    // world stays built for a while, so somebody rejoining resumes the round
    // rather than reloading it — but not forever. An idle match holds a scene,
    // sixteen rigs and a nav graph, and on a public server the matches nobody
    // came back to would accumulate for the life of the process.
    if (this.peers.size === 0) {
      this.stop();
      this.idleTimer = setTimeout(() => this.retire(), IDLE_DISPOSE_MS);
    }
  }

  /** Wired by the registry: this match has gone and should be forgotten. */
  onRetired: () => void = () => {};

  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  private retire(): void {
    if (this.peers.size > 0) return;
    this.idleTimer = null;
    this.game.dispose();
    this.onRetired();
    console.log(`[${this.id}] idle; world disposed`);
  }

  /**
   * Ends this match and drops everyone in it, for a failure it cannot carry on
   * through. The only caller is a rotation that threw.
   *
   * Closing the sockets is the honest answer rather than the harsh one: every
   * client reconnects on its own (`net/Connection.retry`) and lands in a fresh
   * match a second later, whereas a match left standing with a stopped loop is
   * a round that renders, never advances and never ends — and nothing on a
   * client can tell that from a server that has merely gone quiet.
   *
   * The peer map is emptied here rather than left to each socket's `close`,
   * which arrives a turn later: `retire` refuses to run while anybody is still
   * seated, and the point of this method is that nobody is.
   */
  private abandon(reason: string): void {
    this.rotating = false;
    this.stop();
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    for (const peer of this.peers.values()) {
      this.send(peer, { t: "rejected", reason });
      peer.socket.close();
    }
    this.peers.clear();
    this.retire();
  }

  /**
   * The build that is in flight, or null. **The whole of what makes
   * `ensureRunning` safe to call from two arrivals at once.**
   *
   * Every guard in `start` below is written on the far side of an `await`, so
   * without this two peers landing in an empty match inside the world build —
   * a couple of hundred milliseconds, which is one lobby row two people click
   * on, or a server restart everybody reconnects to — each find `timer` null
   * and `map` null and each go on to build a world and start a loop over it.
   * What that leaves is not a slow match, it is a broken process: the second
   * assignment to `timer` orphans the first interval, so `stop` can never clear
   * it, the match steps twice per tick for the rest of its life, and the orphan
   * goes on calling `step` after `retire` has disposed the scene — which throws
   * inside a timer callback and takes down every other match in the process
   * with it.
   *
   * Cleared in a `finally` so a build that FAILED is retried by the next
   * arrival rather than being remembered as permanently in progress; the
   * rejection still reaches every caller that was waiting on it, and
   * `server/index.ts` closes each of their sockets with a reason.
   */
  private starting: Promise<void> | null = null;

  /**
   * Builds the world and starts the loop, once, however many peers ask at once.
   *
   * Not `async` itself: the point is to hand every concurrent caller the SAME
   * promise, and an async wrapper around the same body would give each of them
   * a fresh one over a fresh build.
   */
  private ensureRunning(): Promise<void> {
    if (this.timer) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async start(): Promise<void> {
    if (!this.game.map) {
      const def = MAPS.find((m) => m.id === this.mapId) ?? MAPS[0];
      await this.game.startRound(def, 1);
    }
    // Wall-clock accumulator rather than one step per timer fire: `setInterval`
    // drifts and coalesces under load, and a simulation that took its `dt` from
    // whenever the timer happened to run would speed up and slow down with the
    // host's load. Everything in `CONFIG` — reload times, bleed intervals,
    // recoil decay — is written against real seconds.
    let carried = 0;
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      carried += now - last;
      last = now;
      // Bounded so a long stall (a GC pause, a suspended container) is dropped
      // rather than replayed as a burst of catch-up ticks that would teleport
      // every body on every client at once.
      if (carried > 250) carried = 250;
      while (carried >= STEP_MS) {
        carried -= STEP_MS;
        this.step();
      }
    }, STEP_MS);
    console.log(`[${this.id}] round started on ${this.mapId}`);
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    console.log(`[${this.id}] no peers left; loop stopped`);
  }

  /** One simulation step, and a snapshot on the ticks that owe one. */
  private step(): void {
    // A rotation owns the world until it hands it back, and the loop keeps
    // firing across the whole of it — the round-over pause and then the rebuild
    // — because nothing here stops the interval. For the length of `rotate`'s
    // await, `HeadlessGame.map` still points at the map `startRound` has
    // already DISPOSED, so a step taken there walks a scene whose meshes are
    // gone.
    //
    // It does not currently crash, and that is an accident worth naming rather
    // than relying on: `conquest.winner` is still set from the round that
    // ended, so `HeadlessGame.step` returns before it reaches `battle`, and it
    // stops being true the moment anything resets that earlier. This flag is
    // the fact itself, so the safety no longer rests on a second one agreeing
    // with it.
    //
    // The tick the round ends on is not affected: `rotating` is set BELOW,
    // after that tick has already run and broadcast its `roundover`.
    if (this.rotating) return;

    const live = this.game.step(1 / TICK_HZ);
    this.ticks++;

    // No `!this.rotating` here any more: the guard at the top of this method is
    // that test, made once for the whole step rather than for this branch
    // alone.
    if (!live && this.game.conquest.winner !== null) {
      this.queue({ e: "roundover", winner: this.game.conquest.winner });
      // The round is over but the match is not. Everyone stays seated, the
      // card goes up on every client, and the next map is built after a pause
      // — a server that stopped here would leave sixteen people looking at a
      // frozen world with no way out but reconnecting.
      this.rotating = true;
      this.broadcastSnapshot();
      setTimeout(() => {
        // A rotation is the one place a failure would now be permanent. It is
        // what clears `rotating`, and `rotating` is what lets the loop step, so
        // a build that threw would leave sixteen people in a match that renders
        // and never advances — and an uncaught rejection out of a timer takes
        // the process, and every other match on it, down instead. Neither is
        // an outcome to leave to chance for the sake of an await that is
        // usually fine.
        this.rotate().catch((err: unknown) => {
          console.error(`[${this.id}] rotation failed; abandoning match:`, err);
          this.abandon("the match server could not build the next map");
        });
      }, ROUND_OVER_MS);
      return;
    }
    if (this.ticks % TICKS_PER_SNAPSHOT === 0) this.broadcastSnapshot();
  }

  private rotating = false;

  /**
   * Next map, same people.
   *
   * The roster is untouched: who is in which slot is a fact about the MATCH,
   * not about the round, so a rotation rebuilds the world and restarts the
   * fight without anybody being re-seated or having to rejoin. Every seated
   * player is dead with a zero timer afterwards, which is exactly the state
   * `HeadlessGame.step` deploys them from.
   */
  private async rotate(): Promise<void> {
    const order = MAPS.map((m) => m.id);
    const next = order[(order.indexOf(this.mapId) + 1) % order.length];
    this.mapId = next;
    const def = MAPS.find((m) => m.id === next) ?? MAPS[0];

    await this.game.startRound(def, 1);
    for (const player of this.game.players.values()) {
      player.retire();
      player.respawnT = 0;
    }
    // Re-bench, because `startRound` reset the whole bot roster and the bots in
    // occupied slots would otherwise walk back into a fight somebody is
    // already standing in.
    for (const slot of this.roster.slots) {
      if (slot.occupant.kind === "human") {
        this.game.battle.setBenched(this.game.battle.bots[slot.index], true);
      }
    }
    this.ticks = 0;
    this.rotating = false;
    // `startRound` cleared the board; this is what makes sure the cleared one
    // is sent. The version moved, so the test in `broadcastSnapshot` would
    // catch it anyway — resetting here is what covers the case where it has not
    // moved, which is a rotation nobody scored in.
    this.sentScoreVersion = -1;
    // …and the mines, for the same reason with a sharper edge: `startRound`
    // cleared the field, and a rotation that left the last map's list standing
    // would draw sixteen mines over a street that is not there.
    this.sentMineVersion = -1;
    this.broadcast({ t: "roundstart", mapId: this.mapId, now: Date.now() });
    this.broadcastRoster();
    console.log(`[${this.id}] rotated to ${this.mapId}`);
  }

  /**
   * The world as the clients need to draw it.
   *
   * Every slot is sent every time. A delta encoding would be smaller and is the
   * obvious next step, but it is only correct once there is an acknowledgement
   * channel to say which baseline a client actually holds — and getting that
   * wrong is a client that renders a stale world with no way to notice.
   */
  private broadcastSnapshot(): void {
    const bots = this.game.battle.bots;
    this.entityScratch.length = 0;
    for (let i = 0; i < bots.length; i++) {
      // A slot is a person or a bot, and the wire says the same thing either
      // way — one `EntityState` per slot, in slot order. Clients pool one body
      // per slot and never learn which is which.
      const player = this.game.players.get(i);
      if (player) {
        this.entityScratch.push({
          i,
          p: [player.position.x, player.position.y, player.position.z],
          yaw: player.yaw,
          // A human has no separate feet yaw: the first-person body turns as
          // one. Sending `yaw` for both means a remote player's torso twist
          // computes to zero, which is right — there is no strafe-walk pose to
          // reproduce because there was never a rig producing one.
          bodyYaw: player.yaw,
          pitch: player.pitch,
          // Derived from travel rather than reported, so a client cannot lie
          // about its own animation, and so the walk cycle matches the ground
          // actually covered — the same rule `NetSoldier` follows on the far
          // side.
          moving: this.movingFor(i, player.position.x, player.position.z),
          // The authority's own stance blend, which is the one the eye and the
          // hit sphere were derived from this tick. Every observer draws the
          // body from it and puts its local copy of those spheres in the same
          // place — see `EntityState.crouch`.
          crouch: player.crouchBlend,
          alive: player.alive,
          // The same tween a bot's body plays, off the same field — see
          // `NetPlayer.deathProgress` for why this is not a bare 1.
          dead: player.deathProgress,
        });
        continue;
      }
      const bot = bots[i];
      const state: EntityState = {
        i,
        p: [bot.position.x, bot.position.y, bot.position.z],
        yaw: bot.lookYaw,
        bodyYaw: bot.feetYaw,
        pitch: bot.aimAngle,
        moving: bot.moveAmount,
        alive: bot.alive,
        dead: bot.deathProgress,
      };
      // A bot takes a stance now, and it travels for exactly the reasons a
      // person's does: the authority dropped this body's eye and hit sphere
      // along this blend, and an observer drawing it standing would be aiming
      // at a helmet half a metre above the sphere that is actually there.
      // Omitted while standing, which is most of the time and what the field's
      // absence has always meant.
      if (bot.stance > 0.001) state.crouch = bot.stance;
      this.entityScratch.push(state);
    }

    const points: PointState[] = this.game.conquest.points.map((p) => ({
      id: p.def.id,
      owner: p.owner,
      meter: p.meter,
      contested: p.contested,
      // Copied rather than aliased: `present` is a live tuple the next tick's
      // occupancy pass zeroes in place, and this object outlives the call when
      // a snapshot is held for anything.
      present: [p.present[0], p.present[1]],
    }));

    // Everything in the air. A grenade is the one thing here that takes
    // SECONDS to arrive, so its position is state like a body's rather than a
    // throw announced once and re-simulated on sixteen clients that would each
    // land it somewhere else — see `GrenadeState`. `by` is the thrower's slot,
    // for the one client that must not draw this because it is already
    // watching its own copy of the same throw.
    this.grenadeScratch.length = 0;
    this.game.grenades.forEachLive((id, at, fuse, by) => {
      this.grenadeScratch.push({
        i: id,
        p: [at.x, at.y, at.z],
        by: this.slotOf(by),
        fuse,
      });
    });

    // Every hull the map has, whole. A hull that has been taken off the field
    // entirely is left OUT rather than flagged, which is the grenades' rule
    // above: a client hides whatever this snapshot did not mention, and the
    // hardstanding's index brings the fresh one back under the same name.
    //
    // `by`/`by2` are the roster slots in its two seats, and they are the one
    // place occupancy is stated — see `VehicleState.by`. A bot crew puts a
    // slot there exactly as a person does, which is what stops a client
    // drawing a crewman standing in the street beside the tank he is riding.
    // The two angles beside the turret's are the CUPOLA gun's, which is laid
    // by the second of them and by nothing else.
    this.vehicleScratch.length = 0;
    for (const [i, tank] of this.game.vehicles.hulls.entries()) {
      if (!tank.body.isEnabled()) continue;
      this.vehicleScratch.push({
        i,
        p: [tank.position.x, tank.position.y, tank.position.z],
        yaw: tank.yaw,
        tyaw: tank.turretYaw,
        gun: tank.gunPitch,
        mgy: tank.mgYaw,
        mgp: tank.mgPitch,
        alive: tank.alive,
        hp: tank.health,
        by: this.occupantOf(i, DRIVER),
        by2: this.occupantOf(i, GUNNER),
      });
    }

    // Everything in the air that is not a grenade. `by` is the shooter's slot,
    // for the one client that must not draw this because it is already
    // watching its own copy leave its own tube.
    this.rocketScratch.length = 0;
    this.game.antiTank.forEachRocket((id, at, vel, by) => {
      this.rocketScratch.push({
        i: id,
        p: [at.x, at.y, at.z],
        dir: [vel.x, vel.y, vel.z],
        by: this.slotOf(by),
      });
    });

    const snap: Snapshot = {
      t: "snap",
      tick: this.ticks,
      now: Date.now(),
      entities: this.entityScratch,
      points,
      tickets: [this.game.conquest.tickets[0], this.game.conquest.tickets[1]],
    };
    // Attached only when something is flying: the field is optional precisely
    // so that the twenty snapshots a second in which nothing is do not carry
    // an empty array to say so.
    if (this.grenadeScratch.length > 0) snap.grenades = this.grenadeScratch;
    if (this.rocketScratch.length > 0) snap.rockets = this.rocketScratch;
    // …and the hulls, absent on the maps that state none, which is what a
    // round with no armour in it should look like from the far side.
    if (this.vehicleScratch.length > 0) snap.vehicles = this.vehicleScratch;
    this.broadcast(snap);

    // The mines, on the ticks the SET has moved — a handful of times a round
    // against a snapshot every 50 ms, which is why they are a message of their
    // own rather than sixteen more positions on the one above. After the
    // snapshot for the scores' reason: a mine that has just gone off is a
    // fireball in this snapshot, and the list that no longer holds it should
    // not arrive ahead of it.
    if (this.game.antiTank.version !== this.sentMineVersion) {
      this.broadcast(this.mines());
      this.sentMineVersion = this.game.antiTank.version;
    }

    // The board, on the ticks it has moved — a few times a minute against a
    // snapshot every 50 ms, which is why it is a message of its own rather than
    // thirty-two more numbers on the one above. Sent AFTER the snapshot for the
    // same reason the fire events are queued after it: a death is visible in
    // this snapshot, so the score that counts it should not arrive ahead of the
    // body going down.
    if (this.game.scores.version !== this.sentScoreVersion) {
      this.broadcast(this.scores());
      this.sentScoreVersion = this.game.scores.version;
    }

    // What each connection is costing, once a second: the last sweep's answers
    // go out, and then the next sweep leaves. In that order because the table
    // is a report of round trips that have COME BACK — sending it after the
    // pings would report the same numbers a second later and nothing else.
    if (this.ticks % TICKS_PER_PING === 0) {
      this.broadcast(this.pings());
      for (const peer of this.peers.values()) this.pingPeer(peer);
    }

    // Everyone who fired during the interval this snapshot closes, one event
    // each and the rounds they spent on it. Queued here and not where the
    // trigger went, so the number of MESSAGES is bounded by the roster rather
    // than by the rate of fire — see `firedRounds`. After the snapshot's own
    // `push`es and before the flush, which puts a shot in the same message as
    // the kill it may have caused.
    //
    // `n` is left off the single-round case, which is most of them: the client
    // reads a missing count as one, and so does every build that predates the
    // field.
    //
    // `w` is read HERE rather than remembered at the trigger, because the
    // loadout is the authority's own and cannot change under a seated player
    // mid-interval. A slot with no entry is a bot, and a bot is the flat round
    // the field's absence already means — so there is nothing to say and the
    // event stays the shape it has always been.
    for (const [slot, n] of this.firedRounds) {
      const w = this.loadouts.get(slot)?.id;
      this.queue(n > 1 ? { e: "fire", slot, n, w } : { e: "fire", slot, w });
    }
    this.firedRounds.clear();

    this.flushEvents();
  }

  /**
   * A weapon went off in this slot, whoever was holding it.
   *
   * The one entry point for both kinds of shooter — `BattleSystem.onBotFired`
   * for a bot, an accepted `shot` message for a person — because the clients
   * cannot tell the two apart and nothing here should be able to either.
   * Guarded against -1: `indexOf` is how a bot names its slot, and a bot that
   * somehow is not in the pool must not queue an event for a slot that isn't.
   */
  private noteFire(slot: number): void {
    if (slot >= 0) this.firedRounds.set(slot, (this.firedRounds.get(slot) ?? 0) + 1);
  }

  /**
   * A magazine is being changed in this slot, whoever is holding it — the same
   * one door `noteFire` is, for the same reason.
   *
   * Queued straight rather than coalesced like a shot: a reload is seconds
   * long, so there is never a second one inside a snapshot interval to fold
   * into it, and the rate at which either kind of shooter can reach this is
   * bounded on its own side (a bot by `Bot`'s own reload timer, a person by the
   * gate in `onReload`).
   */
  private noteReload(slot: number): void {
    if (slot < 0) return;
    // The weapon whose magazine it is, for `noteFire`'s reason — and here the
    // cue is sharper for it, because what a listener does with a reload is
    // decide whether to push, and the answer is a different one for a pistol
    // and an LMG.
    this.queue({ e: "reload", slot, w: this.loadouts.get(slot)?.id });
  }

  /** Queues an event for every client. */
  private queue(ev: ServerEvent): void {
    this.pending.push({ to: ALL_PEERS, ev });
  }

  /** Queues an event for one roster slot, and for nobody else. */
  private queueTo(slot: number, ev: ServerEvent): void {
    this.pending.push({ to: slot, ev });
  }

  /**
   * Sends the tick's events and empties the queue.
   *
   * A tick with nothing addressed on it — which is most of them — keeps the
   * single encode it has always had. A tick that does carry somebody's own
   * event is built per peer, and that is deliberately not optimised: the
   * payload is a handful of small objects against a snapshot of sixteen
   * entities encoded once next door, so sixteen of these is noise beside the
   * message that has already gone out this tick.
   */
  private flushEvents(): void {
    if (this.pending.length === 0) return;

    const shared = this.pending.filter((p) => p.to === ALL_PEERS);
    if (shared.length === this.pending.length) {
      this.broadcast({ t: "events", events: shared.map((p) => p.ev) });
    } else {
      for (const peer of this.peers.values()) {
        const events = this.pending
          .filter((p) => p.to === ALL_PEERS || p.to === peer.slot)
          .map((p) => p.ev);
        if (events.length > 0) this.send(peer, { t: "events", events });
      }
    }
    this.pending.length = 0;
  }

  /**
   * Spends one message from a peer's inbound allowance, and says whether there
   * was one to spend.
   *
   * A token bucket rather than a count per window: a window boundary is a thing
   * a client can sit exactly on the wrong side of, sending a full window's worth
   * twice in a millisecond and being inside the rule both times. The bucket
   * refills continuously, so the sustained rate is the sustained rate wherever
   * the messages land in time.
   *
   * It is charged per MESSAGE and not per kind, because what is being bounded
   * is the socket rather than the move or the shot: the parse comes first, the
   * type is not known until after it, and a flood of unparseable bytes costs
   * this thread exactly what a flood of `move` does. The per-kind gates
   * downstream — `onShot`'s rate, `onGrenade`'s pouch, `onDeploy`'s dead-only
   * test — are about the GAME, and they still all apply.
   *
   * Debt is allowed to accumulate rather than being clamped at zero, which is
   * what makes "over budget for a moment" and "over budget for five seconds"
   * different states rather than the same one. The second is closed out.
   */
  private spendMessage(peer: Peer): boolean {
    const now = Date.now();
    peer.budget = Math.min(
      MESSAGE_BURST,
      peer.budget + ((now - peer.budgetAt) / 1000) * MESSAGE_RATE,
    );
    peer.budgetAt = now;
    peer.budget -= 1;
    if (peer.budget >= 0) return true;
    if (peer.budget <= -MESSAGE_DEBT) {
      console.warn(`[${this.id}] ${peer.name} (${peer.id}) flooded; dropped`);
      // Sent before the close, which `send` tests for, and dropped by hand
      // rather than left to the socket's own `close` — that arrives a turn
      // later, and until it does every buffered message would come back
      // through here.
      this.send(peer, { t: "rejected", reason: "too many messages" });
      peer.socket.close();
      this.drop(peer);
    }
    return false;
  }

  private onMessage(peer: Peer, msg: ClientMessage): void {
    switch (msg.t) {
      case "join":
        // Already seated. A second join is a confused client, not an attack.
        break;
      case "move":
      case "shot":
      case "grenade":
      case "reload":
      case "drive":
      case "gunner":
      case "mount":
      case "dismount":
      case "shell":
      case "mg":
      case "ordnance":
        // The four that belong to a round in progress, gated on the same fact
        // `step` is: between a round ending and the next one being built there
        // is a window in which `game.map` is the map `startRound` has already
        // disposed, and a message is the one thing that can arrive inside it —
        // a client whose own round is over still has a socket, and its last
        // shots are in flight. Dropping them is right on its own terms as well:
        // a round fired into a fight that has finished has nothing left to hit,
        // and a reload announced across a rotation is a noise from last round's
        // world arriving over the next one's.
        //
        // `deploy` below is deliberately NOT here. It touches no geometry — it
        // writes an integer a later tick spends — and refusing it would drop a
        // request the client has no reason to send twice.
        if (this.rotating) break;
        if (msg.t === "move") this.onMove(peer, msg);
        else if (msg.t === "shot") this.onShot(peer, msg);
        else if (msg.t === "grenade") this.onGrenade(peer, msg);
        else if (msg.t === "drive") this.onDrive(peer, msg);
        else if (msg.t === "gunner") this.onGunner(peer, msg);
        else if (msg.t === "mount") this.onMount(peer, msg);
        else if (msg.t === "dismount") this.onDismount(peer);
        else if (msg.t === "shell") this.onShell(peer, msg);
        else if (msg.t === "mg") this.onMg(peer, msg);
        else if (msg.t === "ordnance") this.onOrdnance(peer, msg);
        else this.onReload(peer);
        break;
      case "deploy":
        this.onDeploy(peer, msg);
        break;
    }
  }

  /**
   * A player asking to come back in, and where.
   *
   * All this does is RECORD the ask. The simulation spends it — see the
   * reinforcement pass in `HeadlessGame.step` — because when a person may
   * deploy is the reinforcement clock's answer and where they land is
   * conquest's, and neither of those questions is a transport's business.
   *
   * The index is checked for shape here and for MEANING there: `decode` returns
   * parsed JSON asserted to a `ClientMessage`, so the static type is a claim
   * about a well-behaved client and nothing more, and the `deployAt` lookup on
   * the far side is what refuses a spawn this team may not use.
   *
   * A living player asking is a confused client rather than an attack — a
   * queued request would deploy them out of a firefight the moment they next
   * died, which is a worse answer than nothing — and a second ask from a dead
   * one replaces the first, because it is the same player changing their mind
   * in front of a screen that is still up.
   */
  private onDeploy(peer: Peer, msg: Extract<ClientMessage, { t: "deploy" }>): void {
    const player = this.game.players.get(peer.slot);
    if (!player || player.alive) return;
    if (!Number.isInteger(msg.spawn)) return;
    player.deployRequest = msg.spawn;
  }

  /**
   * One reported movement sample: validate it, then keep it or push back.
   *
   * The client simulates its own `Player` and tells us where it ended up. This
   * is the whole of what stops that being a licence to teleport — see
   * `server/validate.ts` for what is and is not caught, and why the tolerance
   * leans toward letting a laggy honest player through.
   */
  private onMove(peer: Peer, msg: Extract<ClientMessage, { t: "move" }>): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !this.game.map) return;

    // Stale or replayed. Sequence numbers are the client's own counter, so an
    // out-of-order arrival is dropped rather than applied backwards.
    if (msg.seq <= player.seq) return;

    // Elapsed CLIENT time since the last sample, clamped. Unclamped, a client
    // that claims a huge gap buys itself a proportionally huge legal step,
    // which is the obvious way to dress a teleport as a lag spike.
    //
    // The first sample has nothing to measure against, so it is assumed to
    // cover one INPUT interval — the cadence a client actually sends at.
    // Assuming a single TICK instead (which this did at first) gives the very
    // first packet a 16 ms budget it has no way of knowing about.
    const raw =
      player.lastTime > 0 ? (msg.time - player.lastTime) / 1000 : 1 / INPUT_HZ;
    const dt = Math.min(Math.max(raw, 1 / TICK_HZ), MAX_MOVE_GAP);

    // The CLOCK advances whether or not the POSITION is accepted, and this is
    // load-bearing. Updating it only on success means one rejected move leaves
    // `lastTime` behind forever: every later sample is then measured against
    // the whole elapsed gap — or, on the very first move, against the
    // first-sample assumption above — and a player whose opening packet was a
    // fraction too long is judged against a 16 ms budget for the rest of the
    // match and can never move again. It presents as movement simply not
    // working, with corrections streaming, and it cost a debugging session.
    // Advancing it here is safe because the gap is clamped anyway.
    player.lastTime = msg.time;

    // A dead player reports nothing worth keeping. Their body is wherever they
    // fell and the server owns it until they redeploy.
    if (!player.alive) return;
    // …and neither does anybody in a hull: their body is the HULL's, written
    // by the step loop off the tank every frame, and a `move` accepted here
    // would put one person in two places for as long as the packets kept
    // arriving. A client in a seat sends `drive` or `gunner` instead — see
    // `DriveMessage` and `GunnerMessage` on why they replace this message
    // rather than riding beside it. Gated on `seat` rather than on which
    // chair, deliberately: a gunner has no body of their own either.
    if (player.seat >= 0) return;

    const [x, y, z] = msg.pos;
    const verdict = validateMove(this.game.map, player.position, { x, y, z }, dt);
    if (!verdict.ok) {
      // Rejected: the authoritative position is unchanged, and the client is
      // told to come back to it. The sequence sent is the last one ACCEPTED, so
      // the client knows which of its samples survived.
      this.send(peer, {
        t: "correct",
        pos: [player.position.x, player.position.y, player.position.z],
        seq: player.seq,
        reason: verdict.reason!,
      });
      return;
    }

    player.seq = msg.seq;
    peer.seq = msg.seq;
    player.apply(
      dt,
      x,
      y,
      z,
      msg.yaw,
      msg.pitch,
      msg.crouching,
      msg.sprinting,
    );
  }

  /**
   * How much walk cycle a player should be shown with, from the ground they
   * covered between snapshots.
   *
   * Derived and not reported: an animation flag a client sets is an animation
   * flag a client can lie about, and a body that slides without moving its legs
   * is the classic tell. `moveSpeed` is the reference, so a walk reads as a
   * full stride and a crouch-shuffle as a partial one.
   */
  private movingFor(slot: number, x: number, z: number): number {
    const prev = this.lastSeen[slot];
    const interval = TICKS_PER_SNAPSHOT / TICK_HZ;
    let moving = 0;
    if (prev) {
      const speed = Math.hypot(x - prev.x, z - prev.z) / interval;
      moving = Math.min(1, speed / CONFIG.player.moveSpeed);
    }
    this.lastSeen[slot] = { x, z };
    return moving;
  }

  /**
   * A round a client says it fired. The authority decides what it hit.
   *
   * Three gates before the ray is even run, in ascending cost:
   *
   *   1. **Rate.** A client cannot fire faster than its weapon's own
   *      `shotInterval`. Without this, "hold the trigger" is a client-side
   *      opinion and a modified one empties a magazine in a frame.
   *   2. **Direction.** The round must leave within a cone of where the shooter
   *      last said it was looking. This is what stops a claimed shot fired
   *      backwards, through the floor, or at somebody the shooter is not facing.
   *      It does NOT stop an aimbot — nothing can, since an aimbot is just
   *      unusually good input — but it bounds the lie to something a real
   *      player could have aimed at.
   *   3. **Origin.** The round must start near the shooter's own head. A client
   *      that could name any origin could shoot from inside your skull.
   *
   * Only then is the ray re-run, against every target rewound to what the
   * shooter was looking at. The client already flashed a hitmarker; this is
   * where it becomes true or turns out to have been a guess.
   */
  private onShot(peer: Peer, msg: Extract<ClientMessage, { t: "shot" }>): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !player.alive || !this.game.map) return;
    // There is no rifle in a driver's hands — the viewmodel is put away and
    // the trigger fires the main gun. A `shot` from a seat is a confused
    // client at best, and at worst somebody firing a carbine out of a hull
    // that nothing can shoot back at.
    if (player.seat >= 0) return;

    const weapon = this.loadouts.get(peer.slot);
    if (!weapon) return;

    // 1. rate
    const now = Date.now();
    if (now - (this.lastShot[peer.slot] ?? 0) < weapon.shotInterval * 1000 * 0.9) {
      return;
    }
    this.lastShot[peer.slot] = now;

    // 2. direction
    const [dx, dy, dz] = msg.dir;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    // The shooter's own reported look vector. Yaw is atan2(x, z) and pitch is
    // negative-for-down, the same convention `CameraSystem` uses.
    const cp = Math.cos(player.pitch);
    const lx = Math.sin(player.yaw) * cp;
    const ly = Math.sin(player.pitch);
    const lz = Math.cos(player.yaw) * cp;
    if (nx * lx + ny * ly + nz * lz < SHOT_CONE_COS) return;

    // 3. origin
    const [ox, oy, oz] = msg.origin;
    if (
      Math.hypot(ox - player.eyePos.x, oy - player.eyePos.y, oz - player.eyePos.z) >
      MAX_ORIGIN_SLIP
    ) {
      return;
    }

    // Past all three gates, so this is a round the authority accepts was fired
    // — which is what gives the shooter away, whatever it goes on to hit. Noted
    // before the ray rather than after it for exactly that reason: a miss is as
    // loud as a hit, and a shot at nobody must still light the map up.
    this.noteFire(peer.slot);

    SHOT_ORIGIN.set(ox, oy, oz);
    SHOT_DIR.set(nx, ny, nz);
    const result = this.game.resolveShot(
      player,
      SHOT_ORIGIN,
      SHOT_DIR,
      msg.time,
      weapon,
    );
    if (!result?.target) return;

    const victimSlot = this.slotOf(result.target);
    // Addressed to the shooter, because it is feedback about their own trigger
    // and nobody else's screen has anything to do with it. Broadcast, it told
    // fifteen other clients who is hitting whom and — through `killed` — that a
    // body across the map is going down, a tick before the snapshot that would
    // honestly show either.
    this.queueTo(peer.slot, {
      e: "hit",
      shooter: peer.slot,
      victim: victimSlot,
      killed: result.killed,
      headshot: result.headshot,
    });

    // The `hit` above and NOTHING ELSE. Everything a death owes — the ticket,
    // the `kill` line, the `died` clock — is raised by whichever of the two
    // authority callbacks saw the body go down: `onPlayerDamaged` for a person,
    // `onKillEvent` for a bot, and each of those fires for every death of its
    // kind however it was dealt. Pushing a second `kill` from here would put
    // two lines in the killfeed for one body, and the one this method could
    // build would be the poorer of the two — it does not know where a bot's
    // killing blow came from, which is what the corpse is thrown with.
  }

  /**
   * A grenade a client says it threw.
   *
   * Gated like a shot, minus the rate limit — a player carries
   * `CONFIG.grenade.carried` of them and the pouch is refilled only by death,
   * so the ammunition IS the limit. The pouch is the server's count, not the
   * client's: a client that tracked its own would throw as many as it liked.
   */
  private onGrenade(peer: Peer, msg: Extract<ClientMessage, { t: "grenade" }>): void {
    // Nothing is thrown from inside a hull, for `onShot`'s reason exactly.
    if ((this.game.players.get(peer.slot)?.seat ?? -1) >= 0) return;
    const player = this.game.players.get(peer.slot);
    if (!player || !player.alive) return;
    if (player.grenades <= 0) return;

    const [dx, dy, dz] = msg.dir;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    const nx = dx / len, ny = dy / len, nz = dz / len;
    const cp = Math.cos(player.pitch);
    const lx = Math.sin(player.yaw) * cp;
    const ly = Math.sin(player.pitch);
    const lz = Math.cos(player.yaw) * cp;
    // A grenade leaves along a lifted version of the aim, so the cone has to be
    // wider than a bullet's — `throwLift` tilts it up before it is thrown.
    if (nx * lx + ny * ly + nz * lz < GRENADE_CONE_COS) return;

    const [ox, oy, oz] = msg.origin;
    if (
      Math.hypot(ox - player.eyePos.x, oy - player.eyePos.y, oz - player.eyePos.z) >
      MAX_ORIGIN_SLIP
    ) {
      return;
    }

    SHOT_ORIGIN.set(ox, oy, oz);
    SHOT_DIR.set(nx, ny, nz);
    // Spent only if the arm accepts it — the pool refuses rather than stealing
    // a live slot, and a refused throw must cost nothing.
    if (
      this.game.grenades.throwAlong(SHOT_ORIGIN, SHOT_DIR, player.team, player)
    ) {
      player.grenades--;
    }
  }

  /**
   * A client saying it has started a reload, so the people around it can hear
   * one.
   *
   * The whole of what this can do is queue a noise on fifteen other machines —
   * a magazine is not on the wire and this cannot buy the sender a round, a
   * position or a hit — which is why it is accepted on the client's word at all
   * (see `ReloadMessage`). What it is gated for is the noise itself: a message
   * a client can send at `MESSAGE_RATE` is one it could turn into a magazine
   * catch clattering forty times a second in everybody's ears.
   *
   * The gate is the shortest reload this peer could actually be performing —
   * their primary or the sidearm they are also carrying, whichever is quicker,
   * with the same 0.9 of slack `onShot` allows a rate. That leaves an honest
   * player announcing every real reload and a dishonest one no faster than a
   * player who genuinely reloaded that often.
   */
  /**
   * One reported HULL sample, from the person driving it.
   *
   * `onMove`'s twin, and every line it does not have is a decision:
   *
   *   - **`validateDrive`, not `validateMove`.** The speed bound is the tank's
   *     — see `server/validate.ts` for why the ground and solid checks are
   *     wrong for a hull rather than merely skipped.
   *   - **No correction on a refusal.** A `correct` message moves the local
   *     BODY, and a client that received one while driving would be told to
   *     put its feet somewhere without being told anything about its tank.
   *     What a refused step costs instead is simply that it is not applied:
   *     the authority's hull stays where it was, the next snapshot says so,
   *     and `Vehicle.updateRemote`'s resync pulls the driver's own copy back.
   *   - **No seat is granted here.** A `drive` naming a hull this player is
   *     not in is dropped, not obeyed. Getting into a tank is `onMount`'s, and
   *     it is one door for the reason spawning is one door.
   */
  private onDrive(peer: Peer, msg: Extract<ClientMessage, { t: "drive" }>): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !this.game.map) return;
    if (msg.seq <= player.seq) return;
    // The clock advances whether or not the step is accepted, for the reason
    // `onMove` spells out at length: a rejection that left `lastTime` behind
    // measures every later sample against the whole elapsed gap.
    const raw =
      player.lastTime > 0 ? (msg.time - player.lastTime) / 1000 : 1 / INPUT_HZ;
    const dt = Math.min(Math.max(raw, 1 / TICK_HZ), MAX_MOVE_GAP);
    player.lastTime = msg.time;
    if (!player.alive || player.seat !== msg.tank) return;

    const tank = this.game.hullOf(player);
    if (!tank) return;
    const [x, y, z] = msg.pos;
    if (
      !validateDrive(
        this.game.map,
        tank.position,
        { x, y, z },
        dt,
        tank.spec.drive.maxSpeed,
      ).ok
    ) {
      return;
    }

    player.seq = msg.seq;
    peer.seq = msg.seq;
    // The LOOK, kept on the body it belongs to. It is the chase camera's aim
    // rather than the gun's, and it is what the shell's cone is measured
    // against — see `DriveMessage.aimYaw`. Nothing draws it: the snapshot
    // sends the hull's angles, and a driver's own body is not on screen.
    player.yaw = msg.aimYaw;
    player.pitch = msg.aimPitch;
    this.game.applyDrive(player, x, y, z, msg.yaw, msg.tyaw, msg.gun);
  }

  /**
   * "Put me in that hull." The authority re-derives every term of the offer
   * against its own copy and answers with a `seat` either way.
   *
   * Answered even on a refusal, and that is the point of it being addressed:
   * the client mounted nothing locally and is waiting to be told what it is
   * in, so silence would leave a player who pressed the key next to their own
   * tank with no idea whether it worked. The answer to a refusal is "you are
   * on foot", which is true.
   */
  private onMount(peer: Peer, msg: Extract<ClientMessage, { t: "mount" }>): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !player.alive) return;
    // The chair asked for, as a PREFERENCE — see `MountMessage.seat`. Anything
    // that is not the gunner's is the driver's, so a nonsense index is a
    // request for the ordinary thing rather than a refusal.
    const want: CrewSeat = msg.seat === GUNNER ? GUNNER : DRIVER;
    // **A peer already in this hull asking for its other chair is a SWAP**,
    // and it is granted here rather than through the offer below because
    // `seatOffered` refuses a player who is already seated — which is right
    // for the question it answers (may this body climb aboard) and wrong for
    // this one. `HeadlessGame.seat` is still the one door: it releases the old
    // chair, refuses if the new one is taken, and leaves everything about the
    // BODY standing, because none of that was ever about which seat.
    if (player.seat === msg.tank && player.seat >= 0) {
      const hull = this.game.hullOf(player);
      if (hull && want !== player.crewSeat && !hull.seats[want]) {
        this.game.seat(player, hull, want);
      }
      this.game.onSeatChanged(player, player.seat, player.position, player.yaw);
      return;
    }
    const offered = this.game.seatOffered(player);
    // Named hull and offered hull must be the SAME hull. The client picked one
    // and this is the authority's own answer to the same question; granting
    // whatever is nearest instead would seat somebody in a tank they did not
    // choose on the day a map states two.
    const tank =
      offered && this.game.vehicles.hulls.indexOf(offered) === msg.tank
        ? offered
        : null;
    const taken = tank ? this.game.seat(player, tank, want) : null;
    this.game.onSeatChanged(
      player,
      taken ? msg.tank : -1,
      player.position,
      player.yaw,
    );
  }

  /** "Let me out." Where the body lands is the authority's — see the `seat` event. */
  private onDismount(peer: Peer): void {
    const player = this.game.players.get(peer.slot);
    const tank = player ? this.game.hullOf(player) : null;
    if (!player || !tank) return;
    // Read BEFORE the seat is given up: `exitSpot` measures from the hull, and
    // `seat` is what stops this player being on it.
    const spot = this.game.vehicles.exitSpot(tank);
    const x = spot.x;
    const y = spot.y;
    const z = spot.z;
    this.game.seat(player, null);
    // The body is placed by the authority, exactly as a spawn is, and with
    // `dt` of 0 so the stance blend is written rather than eased from
    // whatever the drive left it at.
    player.apply(0, x, y, z, player.yaw, 0, false, false);
    this.game.onSeatChanged(player, -1, player.position, player.yaw);
  }

  /**
   * A gunner's reported cupola-gun bearing. `onDrive` for the second seat.
   *
   * **There is nothing to validate and that is the whole difference.** A hull
   * is a position, so a reported one is a claim about the world and goes
   * through `validateDrive`; a bearing claims nothing at all — the worst a
   * lying client can do is point a machine gun somewhere a ring could not have
   * swung it, which buys nothing, because the ROUND is re-resolved on this
   * side against the same cone check every other shot takes.
   *
   * The seat is checked rather than assumed for `onDrive`'s reason: a `gunner`
   * naming a hull this player is not on the gun of is dropped, not obeyed.
   * Getting onto that gun is `onMount`'s, and it is one door for the reason
   * spawning is one door.
   */
  private onGunner(peer: Peer, msg: Extract<ClientMessage, { t: "gunner" }>): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !player.alive) return;
    if (msg.seq <= player.seq) return;
    if (player.seat !== msg.tank || player.crewSeat !== GUNNER) return;
    player.seq = msg.seq;
    peer.seq = msg.seq;
    // The LOOK, kept on the body it belongs to — the chase camera's aim, and
    // what the machine gun's own cone is measured against, exactly as
    // `onDrive` keeps a driver's for the shell's.
    player.yaw = msg.myaw;
    player.pitch = msg.mpitch;
    this.game.applyGun(player, msg.myaw, msg.mpitch);
  }

  /**
   * A shell a client says it fired. The authority decides what it hit.
   *
   * `onShot`'s three gates, minus the one that does not apply: there is no
   * weapon slot to look up, because a hull has one gun. The RATE gate is the
   * cheap refusal in front of `Vehicle.fireGun`, which owns the real reload; the
   * CONE is measured against the driver's reported look rather than against
   * the gun, because the gun's bearing is the very thing being claimed; and
   * the ORIGIN must be near the hull, not near a head.
   */
  private onShell(peer: Peer, msg: Extract<ClientMessage, { t: "shell" }>): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !player.alive) return;
    // The main gun is the DRIVER's, and a gunner claiming one is a confused
    // client at best — the trigger in that seat fires the cupola gun and
    // reaches `onMg` instead. The two guns are two arms rather than a branch
    // for exactly this: each is gated on the chair that holds it.
    if (player.crewSeat !== DRIVER) return;
    const tank = this.game.hullOf(player);
    if (!tank) return;

    // The gun this hull actually has, and **a hull with none refuses the claim
    // outright** — a client naming a shell out of a truck is either confused or
    // lying, and either way there is no reload to measure it against.
    const gun = tank.spec.gun;
    if (!gun) return;
    const now = Date.now();
    if (now - (this.lastShell[peer.slot] ?? 0) < gun.cooldown * 1000 * 0.9) {
      return;
    }
    const [dx, dy, dz] = msg.dir;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return;
    // The cone, against where this driver last said they were LOOKING. It is
    // generous for `SHOT_CONE_COS`'s reason and then some: the gun is walking
    // toward the look at the turret's own rate, so the two legitimately differ
    // by a whole traverse — which is exactly why the shell is fired down the
    // gun's own axis below and not down this vector.
    const cp = Math.cos(player.pitch);
    const aimX = cp * Math.sin(player.yaw);
    const aimY = Math.sin(player.pitch);
    const aimZ = cp * Math.cos(player.yaw);
    if ((dx * aimX + dy * aimY + dz * aimZ) / len < SHELL_CONE_COS) return;
    // The origin, against the hull rather than the head. A client that could
    // name any origin could fire from inside somebody else's tank.
    const [ox, oy, oz] = msg.origin;
    if (
      Math.hypot(ox - tank.center.x, oy - tank.center.y, oz - tank.center.z) >
      SHELL_ORIGIN_SLACK
    ) {
      return;
    }

    // …and then nothing of the claim is used. The round goes down the
    // authority's own gun, from the authority's own muzzle, at the authority's
    // own reload — which is the whole security property, and the reason the
    // checks above bound a LIE rather than measure an aim.
    if (this.game.resolveShell(tank, player)) this.lastShell[peer.slot] = now;
  }

  /**
   * A round out of the cupola gun a client says it fired. `onShell`'s twin,
   * with the three gates sized for the other weapon.
   *
   * The RATE gate is the same cheap refusal in front of `Vehicle.fireMg`, which
   * owns the real one, and it is per-ROUND rather than per-reload: nine a
   * second, so the slack is the same tenth. The CONE is measured against the
   * gunner's reported look, which for this seat is the gun's own order — the
   * ring is light and settles in a fraction of a second, so the two differ by
   * far less than the turret's do and `SHELL_CONE_COS` is generous for both.
   * The ORIGIN is bounded to the hull for `onShell`'s reason.
   */
  private onMg(peer: Peer, msg: Extract<ClientMessage, { t: "mg" }>): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !player.alive) return;
    if (player.crewSeat !== GUNNER) return;
    const tank = this.game.hullOf(player);
    if (!tank) return;

    const now = Date.now();
    const gap = (1000 / tank.spec.mg.fireRate) * 0.9;
    if (now - (this.lastMg[peer.slot] ?? 0) < gap) return;
    const [dx, dy, dz] = msg.dir;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return;
    const cp = Math.cos(player.pitch);
    const aimX = cp * Math.sin(player.yaw);
    const aimY = Math.sin(player.pitch);
    const aimZ = cp * Math.cos(player.yaw);
    if ((dx * aimX + dy * aimY + dz * aimZ) / len < SHELL_CONE_COS) return;
    const [ox, oy, oz] = msg.origin;
    if (
      Math.hypot(ox - tank.center.x, oy - tank.center.y, oz - tank.center.z) >
      SHELL_ORIGIN_SLACK
    ) {
      return;
    }
    // …and then nothing of the claim is used, which is `onShell`'s whole
    // security property one calibre down: the round goes down the authority's
    // own gun, from its own muzzle, at its own rate.
    if (this.game.resolveMg(tank, player)) this.lastMg[peer.slot] = now;
  }

  /**
   * A rocket out of the tube, or a mine on the ground.
   *
   * The pouch is the SERVER's, exactly as the grenade pouch is, and it is
   * debited only on an item that actually reached the world — the refusal
   * contract `AntiTankSystem` states and `Game` obeys, unchanged by arriving
   * over a socket.
   *
   * A mine ignores the direction and lands where the ORIGIN says, bounded to
   * arm's length of where the authority holds this player: a client that could
   * name any point could mine the enemy hardstanding from its own spawn.
   */
  private onOrdnance(
    peer: Peer,
    msg: Extract<ClientMessage, { t: "ordnance" }>,
  ): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !player.alive || player.ordnance <= 0) return;
    // Not from inside a tank. The third slot is carried by a body, and
    // `Player.tryShot` cannot even reach the trigger while driving — this is
    // the authority saying the same thing rather than trusting it.
    if (player.seat >= 0) return;
    const kind = this.equipment.get(peer.slot);
    if (!kind) return;

    const now = Date.now();
    const interval = equipmentSetup(kind).shotInterval * 1000 * 0.9;
    if (now - (this.lastOrdnance[peer.slot] ?? 0) < interval) return;

    const [ox, oy, oz] = msg.origin;
    if (
      Math.hypot(ox - player.eyePos.x, oy - player.eyePos.y, oz - player.eyePos.z) >
      ORDNANCE_ORIGIN_SLACK
    ) {
      return;
    }

    let placed = false;
    if (kind === "mine") {
      ORDNANCE_AT.set(ox, oy, oz);
      placed = this.game.layMine(ORDNANCE_AT, player);
    } else {
      const [dx, dy, dz] = msg.dir;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-3) return;
      // The same cone a rifle round is bounded by, and for the same reason —
      // it stops a claimed rocket leaving backwards or through the shooter's
      // own feet, and it stops nothing else.
      const cp = Math.cos(player.pitch);
      const dot =
        (dx * (cp * Math.sin(player.yaw)) +
          dy * Math.sin(player.pitch) +
          dz * (cp * Math.cos(player.yaw))) /
        len;
      if (dot < SHOT_CONE_COS) return;
      ORDNANCE_AT.set(ox, oy, oz);
      ORDNANCE_DIR.set(dx / len, dy / len, dz / len);
      placed = this.game.launchRocket(ORDNANCE_AT, ORDNANCE_DIR, player);
    }
    if (!placed) return;
    player.ordnance -= 1;
    this.lastOrdnance[peer.slot] = now;
    // Heard as a shot is, so the fifteen other clients get the report and the
    // minimap reveal a launcher earns. A mine is silent on the wire for the
    // same reason it is nearly silent in the world — there is nothing to hear
    // and nothing to give away.
    if (kind === "rpg") this.noteFire(peer.slot);
  }

  private onReload(peer: Peer): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !player.alive) return;
    const weapon = this.loadouts.get(peer.slot);
    if (!weapon) return;

    const now = Date.now();
    const soonest = Math.min(weapon.reloadTime, SIDEARM_RELOAD) * 1000 * 0.9;
    if (now - (this.lastReload[peer.slot] ?? 0) < soonest) return;
    this.lastReload[peer.slot] = now;
    this.noteReload(peer.slot);
  }

  /**
   * Which roster slot a body belongs to, or -1 if it is not on the roster —
   * the one a round hit, or the one that threw a grenade. `null` (a grenade
   * nobody owns) is a slotless body like any other and comes back as -1.
   */
  /**
   * Who is in the hull on hardstanding `i`, as a roster slot, or -1.
   *
   * Derived at the snapshot rather than tracked, and that is deliberate: the
   * two things that can be in a tank keep the fact in two different places
   * (`NetPlayer.seat` for a person, `VehicleCrew`'s pairing for a bot), and a
   * third copy kept in step with both is the copy that would be wrong. It is
   * sixteen comparisons twenty times a second on a map with armour, twice
   * over now that a hull holds two.
   */
  private occupantOf(i: number, seat: CrewSeat): number {
    for (const player of this.game.players.values()) {
      if (player.seat === i && player.crewSeat === seat) return player.slot;
    }
    const tank = this.game.vehicles.hulls[i];
    const crew = tank ? this.game.crew.crewOf(tank, seat) : null;
    return crew ? this.game.battle.bots.indexOf(crew) : -1;
  }

  /** Every mine on the field, whole — see `MinesMessage`. */
  private mines(): ServerMessage {
    const mines: MineState[] = [];
    this.game.antiTank.forEachMine((i, at, team, armed, by) => {
      mines.push({ i, p: [at.x, at.y, at.z], team, armed, by: this.slotOf(by) });
    });
    return { t: "mines", mines };
  }

  private slotOf(target: unknown): number {
    for (const [slot, player] of this.game.players) {
      if (player === target) return slot;
    }
    const i = this.game.battle.bots.indexOf(target as never);
    return i;
  }

  private broadcastRoster(): void {
    this.broadcast({ t: "roster", slots: this.roster.slots });
  }

  /**
   * The scoreboard as one message. Copied, not referenced: `encode` runs
   * immediately for a broadcast, but the arrays are the simulation's own and
   * live ones on a queued message would report whatever the round had reached
   * by the time it was encoded.
   */
  private scores(): ServerMessage {
    return {
      t: "scores",
      kills: [...this.game.scores.kills],
      deaths: [...this.game.scores.deaths],
      points: [...this.game.scores.points],
    };
  }

  /**
   * The round trip to every seated peer, as one message.
   *
   * A full-roster array with -1 in every slot nobody is connected in, which is
   * the shape `scores` already has and for the same reason: a client indexes it
   * with the number it indexes everything else with, and a bot's row has nothing
   * to put in the column rather than a zero that would read as a perfect
   * connection.
   */
  private pings(): ServerMessage {
    const ms = this.roster.slots.map(() => -1);
    for (const peer of this.peers.values()) ms[peer.slot] = this.pingFor(peer);
    return { t: "pings", ms };
  }

  /**
   * Starts one round trip to a peer, on the WebSocket's own ping frame.
   *
   * A transport ping rather than a message pair of our own, which is the whole
   * reason this costs no protocol surface: a browser answers one from its
   * network stack without waking its JavaScript (the argument
   * `server/index.ts` already makes for its liveness sweep), so nothing is
   * added to `ClientMessage` for a client to send wrong, to flood with, or to
   * lie about — a peer cannot claim a ping it does not have.
   *
   * **A ping still outstanding is not replaced.** That peer has already failed
   * to answer inside the interval, `pingFor` is reporting the wait instead of
   * the stale number, and pinging again would restart that clock and hide
   * exactly the connection worth showing. Nothing is leaked by leaving it: a
   * peer that never answers again is dropped by the process-wide deadline in
   * `server/index.ts`, which is the one thing here that terminates a socket.
   */
  private pingPeer(peer: Peer): void {
    if (peer.socket.readyState !== peer.socket.OPEN) return;
    if (peer.pingAt > 0) return;
    peer.pingAt = Date.now();
    peer.socket.ping(String(++peer.pingToken));
  }

  /**
   * What to report for a peer: the measured round trip, or the wait for an
   * answer that has not come back yet when that is already longer.
   *
   * The second half is the point. A connection that has gone quiet still holds
   * whatever it last measured, and a board frozen at 38 ms over a peer who is
   * halfway through a four-second stall is precisely the lie this column exists
   * to prevent — so a ping in flight past the last estimate reads as the number
   * it has already reached, and climbs. Before the first pong there is nothing
   * measured at all and the answer is -1, because "at least 12 ms so far" is a
   * number a player would read as a measurement.
   */
  private pingFor(peer: Peer): number {
    if (peer.ping < 0) return -1;
    const waiting = peer.pingAt > 0 ? Date.now() - peer.pingAt : 0;
    return Math.round(Math.max(peer.ping, waiting));
  }

  private send(peer: Peer, msg: ServerMessage): void {
    if (peer.socket.readyState === peer.socket.OPEN) {
      peer.socket.send(encode(msg));
    }
  }

  private broadcast(msg: ServerMessage): void {
    const payload = encode(msg);
    for (const peer of this.peers.values()) {
      if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(payload);
    }
  }
}
