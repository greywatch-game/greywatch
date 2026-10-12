/**
 * server/Match.ts — One match: its roster, its peers, its simulation loop, and
 * the snapshots that go out from it.
 * Owns: the fixed-step clock, the peer set, and the bridge between a roster slot
 * changing hands and the bot in that slot being benched or released. It owns no
 * game rules — those are `SimCore`'s — and no transport: a peer is reached
 * through a `PeerTransport` (a WebSocket on the server, `server/index.ts`),
 * and `send`/`broadcast` are the one place a dead connection is handled.
 * It is the core's HOST: it hears the simulation only through the core's
 * event ring, DRAINED after every call it makes on the core — each step, each
 * accepted message — and `relay` turns what it drained into wire events. It
 * installs no callback on the core and reads nothing back off a live object
 * to finish an event (`src/sim/events.ts`).
 * **It VALIDATES and the core DECIDES** (`BABYLON_EXIT.md` X2.5a C4a): each
 * message handler runs this side's claim gates — the shape (`server/wire.ts`),
 * the sequence and the clock (a peer's stamps BOUNDED against when its
 * messages arrive, `onStamp` — the state is this class's `Peer`, never the
 * core's object), the rate buckets, the cones and origin slips,
 * `validateMove`/`validateDrive` and the corrections they answer with — and
 * then hands what it accepted to `SimCore.submit` as one `SimCommand`
 * (`src/sim/commands.ts`). Everything that is a rule — the pouch counts, the
 * seat policy, the rewound round, when a person comes back in — is the core's,
 * the one copy the offline page submits to as well. What it still reads
 * off the core is in-process state its validators and snapshot need
 * (`players`, `hullOf`, `reportedHull`, the fleet, the board).
 * `server/corecheck.ts` drives a real instance through a fake transport and
 * steps it by hand — it reaches `step`, `relay`, `timer`, `peers` and
 * `arrivalClock` by name — so renaming one of those owes that file a look.
 * Invariants: a peer's slot is assigned here and nowhere else, and a peer never
 * names its own slot. The loop is fixed-step and drift-corrected: a `dt` taken
 * from wall clock would make the simulation run at the speed of the server's
 * load, and every recoil, bleed and reload timer in `CONFIG` is written against
 * real seconds.
 */
import { Vector3 } from "../src/math";
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
  SIDEARM_SLOT,
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
import {
  DEFAULT_THROWABLE,
  isThrowableId,
  throwableCarried,
  type ThrowableId,
} from "../src/entities/throwables";
import { DRIVER, GUNNER, type CrewSeat } from "../src/entities/hullSeats";
import { MAPS, type MapDef } from "../src/world/maps";
import { perTeamOf } from "../src/world/layout";
import { freshSeed } from "../src/systems/RoundRandom";
import { HULL_EARLY } from "../src/systems/hullRules";
import { SimCore } from "../src/sim/SimCore";
import { EV, EventCursor, decode, type EventKind } from "../src/sim/events";
import { MapVote } from "./MapVote";
import { HUMANS_PER_TEAM, Roster, SLOT_COUNT } from "./Roster";
import { validateDrive, validateMove } from "./validate";
import { readClientMessage } from "./wire";
import { loadSimWorld } from "./world";
import {
  claimedDir,
  lookDir,
  RateGate,
  SHOT_SLACK,
  withinCone,
  withinSlip,
} from "./claimGates";

/**
 * Everything this match holds about whoever is in ONE roster slot — the kit a
 * person named and every gate their claims are spent against — as one record.
 *
 * **One record rather than a table per field, so a slot changing hands is one
 * assignment** (`freshSlot`, in `drop` and `admit`). These were ten parallel
 * tables keyed by slot and `drop` cleared each by hand, so a new one it forgot
 * would have leaked one player's state — a half-spent rate bucket, a kit, a
 * walk cycle — into the next person seated in that slot. Keyed by the slot
 * INDEX, because a slot index is a bot index (`CLAUDE.md`).
 *
 * Named `SlotRecord` because `SlotState` is the wire's roster row.
 */
interface SlotRecord {
  /**
   * What this slot's person is carrying, resolved from the weapon TABLE —
   * null for a bot, which fires the flat round the field's absence means.
   *
   * The server owns this. A client names a weapon id and the id is validated;
   * the damage, range and fall-off are looked up here and never cross the
   * wire, because a client that could state its own damage would state
   * whatever it liked.
   */
  loadout: WeaponSetup | null;
  /**
   * What they have in the THIRD slot, resolved from the equipment table here
   * for `loadout`'s reason exactly.
   *
   * A separate field rather than part of the `WeaponSetup` beside it, because
   * they are answers to different questions: one is the weapon this person is
   * shooting people with and the other is the thing they carry for armour, and
   * `equipmentSetup` deliberately resolves to a `WeaponSetup` whose every
   * combat field says it is not a gun.
   */
  equipment: EquipmentId | null;
  /**
   * What their POUCH holds — a frag or a molotov — resolved here for
   * `equipment`'s reason: what leaves the hand on a `grenade` message is this
   * side's to say, and a client naming it per throw would name whatever it
   * liked. `onGrenade` reads it; `setKit` writes it.
   */
  throwable: ThrowableId | null;
  /**
   * The rifle's rate limit, built on this person's first round.
   *
   * A BUCKET rather than the timestamp of the last accepted round, because the
   * thing being bounded is a rate and what arrives is a schedule the network
   * has already had its way with — see `SHOT_SLACK` and `onShot`.
   */
  fire: {
    bucket: RateGate;
    /** When a round was last ACCEPTED, which is what a draw is measured from. */
    fired: number;
    /** Whether the last round claimed the sidearm, so a change of hands shows. */
    sidearm: boolean;
  } | null;
  /** When they last announced a reload, for that message's own gate. */
  lastReload: number;
  /**
   * …and the AT slot's and the tank guns' gates.
   *
   * The shot gate's kind exactly — a `RateGate` each — because a client asking
   * for a rocket or a shell is asking the authority to put an object in the
   * world, and without a gate the rate at which it may do so would be a
   * client-side opinion. They were minimum spacings once, the rule the rifle
   * retired, and at the cupola gun's nine a second that dropped honest rounds
   * on ordinary jitter. **These ARE the rate limit for a person's hull round**:
   * the hull's own clock, a spacing too, is asked with `HULL_EARLY` of slack.
   *
   * The two guns are two gates rather than one: a hull has two guns with two
   * triggers and two people, and one gate shared between them would let either
   * seat's fire rate-limit the other's. A `RateGate` starts full, so built
   * eagerly here it is the same gate it was when built on the first claim.
   */
  ordnanceGate: RateGate;
  shellGate: RateGate;
  mgGate: RateGate;
  /**
   * Where this slot's PERSON was on the last snapshot, for deriving their walk
   * cycle (`movingFor`). A bot's is the simulation's own and never lands here.
   */
  lastSeen: { x: number; z: number } | null;
}

/** A slot nobody has been in: no kit, every gate full, no travel. */
function freshSlot(): SlotRecord {
  return {
    loadout: null,
    equipment: null,
    throwable: null,
    fire: null,
    lastReload: 0,
    ordnanceGate: new RateGate(),
    shellGate: new RateGate(),
    mgGate: new RateGate(),
    lastSeen: null,
  };
}

/**
 * The one connection a peer is reached over, as this class needs it
 * (`BABYLON_EXIT.md` X2.5c C1): a WebSocket on the server (`server/index.ts`'s
 * `wsTransport`), and a fake one in `server/corecheck.ts`. Everything about
 * what is CARRIED — the JSON both ways, the claim gates, the rate bucket — is
 * this class's and stays above it, so whatever carries a peer is told nothing
 * a WebSocket was not.
 */
export interface PeerTransport {
  /**
   * Whether `send` and `ping` still reach the far end. False once a close has
   * begun from either side, and `send`/`broadcast` test it, so they are still
   * the one place a dead connection is handled.
   */
  readonly open: boolean;
  /** One encoded `ServerMessage`. */
  send(text: string): void;
  /**
   * Ends the connection. `closed` may follow a turn later (a WebSocket's
   * closing handshake) or not at all, so a caller that needs the peer gone
   * NOW drops it by hand, as `abandon` and `spendMessage` do.
   */
  close(): void;
  /**
   * Starts one round trip, answered by `pong` (`pingPeer`). **A transport
   * shared with another pinger owns telling the answers apart**, so `pong`
   * means THIS ping and nothing else — the WebSocket's is shared with the
   * process's liveness sweep, and `wsTransport` tokens its pings for it.
   */
  ping(): void;
  /** Hands this class its handlers. Called once, inside `admit`. */
  listen(handlers: PeerHandlers): void;
}

/** What a transport raises into `Match`, one handler per thing it can say. */
export interface PeerHandlers {
  /** One inbound frame, as text: still a CLAIM until `server/wire.ts` reads it. */
  message(text: string): void;
  /** The connection ended or failed — either way the peer is gone. */
  closed(): void;
  /** The far end answered the outstanding `ping`. */
  pong(): void;
}

/** One connected human. */
interface Peer {
  id: string;
  name: string;
  transport: PeerTransport;
  /** The roster slot this peer holds, which is also its entity id on the wire. */
  slot: number;
  /**
   * Last input sequence accepted from this peer — the one a correction names,
   * and the floor below which a `move`, `drive` or `gunner` is stale. The
   * VALIDATOR's state, so it is this class's and never the core's object's.
   */
  seq: number;
  /**
   * The peer's clock as `onStamp` keeps it: the last `move`/`drive` stamp it
   * read (client ms, NaN before the first), when that one ARRIVED (this
   * process's `arrivalClock`), how far the stamps have run ahead of their
   * arrivals since the first (`lead`, ms, held within `STAMP_SLACK`), and how
   * far the BOUNDED clock has fallen behind the raw one (`behind`, ms) — so
   * the bounded clock is `stamp - behind`, and an honest peer's is its own
   * stamp to the bit.
   */
  stamp: number;
  arrived: number;
  lead: number;
  behind: number;
  /**
   * A `hullcorrect` that moved this peer's hull vertically has gone out and
   * no `drive` has yet answered it with `resync` — the one window in which
   * that flag is honoured (`onDrive`, `reportedLanding.ts` "A broken series").
   */
  resyncOwed: boolean;
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

/**
 * The core's event kinds `relay` puts on the wire. Everything else — a
 * footstep, a tracer, a death's audit, a hull's kick — is drained and
 * dropped without being decoded.
 */
const RELAYED: ReadonlySet<EventKind> = new Set<EventKind>([
  EV.botDown,
  EV.botFired,
  EV.botReload,
  EV.nearMiss,
  EV.captured,
  EV.neutralised,
  EV.award,
  EV.damaged,
  EV.blast,
  EV.ignited,
  EV.cannon,
  EV.mg,
  EV.seat,
  EV.glass,
  EV.spawned,
  EV.hit,
  EV.roundOver,
]);

const STEP_MS = 1000 / TICK_HZ;

/**
 * How often the loop LOOKS to see whether a step is due, in ms.
 *
 * Not the step: the accumulator below is what decides how many ticks a wake-up
 * runs, and it is fixed at `STEP_MS` whatever this is. This is only the
 * granularity with which a tick is executed near the wall instant it belongs
 * to — and therefore the granularity with which a snapshot is SENT.
 *
 * Polled at `STEP_MS` a wake-up is late as often as not, so the tick a snapshot
 * rides on runs anywhere in a 16 ms window and the twenty sends a second land
 * 31 to 80 ms apart. That spread is not rendered as speed any more (the stamps
 * are the simulation's own clock — `SimCore.now`), but it is still spent:
 * a client draws bodies `CONFIG.net.interpDelay` behind the newest sample it
 * holds, and a send that is early shortens that buffer by exactly its
 * earliness. Half the spread came off the budget meant for the NETWORK's
 * jitter, on a link with none.
 *
 * At 4 ms the same measurement is 47 to 66 — the early cluster is gone
 * entirely, which is the half that costs. 2 ms and 1 ms measured no better
 * (the host's timer floor), so this is the knee rather than a budget: 250
 * wake-ups a second that almost always find nothing due.
 */
const POLL_MS = 4;

/**
 * The largest client-reported gap a single movement sample may claim, in
 * seconds. Longer stalls are legitimate — a backgrounded tab, a GC pause — but
 * the ground they would buy is not, so the step is validated against this and
 * the rest of the gap is simply lost.
 */
const MAX_MOVE_GAP = 0.5;

/**
 * How far, in ms, a peer's stamps may run ahead of — or fall behind — the
 * clock their messages ARRIVE on, before the excess is not believed.
 *
 * **The stamp is the client's word for how long a step took, and every bound
 * downstream is priced in it**: `validateMove`'s and `validateDrive`'s
 * allowance is a speed times this interval, and the crash test's rate is a
 * height over it (`reportedLanding.ts`). Clamped per sample alone
 * (`MAX_MOVE_GAP`), a client adding half a second to every stamp at
 * `INPUT_HZ` bought ten times the legal ground forever, and one adding a
 * second measured every descent over a second and landed free. So the sum is
 * bounded too: each interval is held to what ARRIVED in the same time plus
 * whatever of this slack the stamps have not already used, and a stamp
 * running ahead of its arrivals spends the slack once and then advances at
 * the arrival rate. Symmetric, so a client cannot bank slow stamps to spend
 * on one long interval later.
 *
 * **An honest client never touches it.** Its stamps and its arrivals are one
 * wall clock read at the two ends of a socket, so the lead moves only by the
 * network's jitter — a packet held back, then the bunch behind it — and it
 * comes back. Latency swinging by up to twice this, peak to peak, passes
 * every stamp through to the bit; past that the lead re-centres and gives the
 * excess away rather than holding it against the client. What it costs a
 * client whose clock steps forward mid-match (an NTP jump) is that one step,
 * and a few intervals clipped by however far its latency then dips below the
 * level it stepped at — which is the price of not believing a clock that
 * jumped.
 */
const STAMP_SLACK = 250;

/**
 * The shortest interval two of a person's `drive` reports may be apart and
 * still be a RATE for the crash test — `SimCoreOptions.reportGap`, seconds.
 * Half an upload interval: `NetSession` never sends closer than
 * `1 / INPUT_HZ`, so only a crowded stamp is skipped, and a skipped sample is
 * measured into the next one rather than lost.
 */
const REPORT_GAP = 0.5 / INPUT_HZ;

/**
 * A correction that moved the hull by more than this vertically, in metres,
 * stopped the client's vertical motion (`Vehicle.correctTo`'s own threshold)
 * — so its first report after it is a rebase (`Peer.resyncOwed`).
 */
const RESYNC_RISE = 1e-3;

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
 * The sidearm's own numbers, resolved once.
 *
 * The second half of what a person is carrying. The kit chooses the primary
 * and everybody has this one whatever else is in the kit, so there is nothing
 * per-peer about it and nothing to store per slot: `onShot` picks between this
 * and the peer's own `loadout` on the slot the round says it left.
 */
const SIDEARM_SETUP = weaponSetup(SIDEARM);

/**
 * The client messages that belong to a round in progress — `onMessage`'s gated
 * block, as a type, so the arm list there and `onRoundMessage`'s switch are one
 * list the compiler checks against itself.
 */
type RoundMessage = Extract<
  ClientMessage,
  {
    t:
      | "move"
      | "shot"
      | "grenade"
      | "reload"
      | "drive"
      | "gunner"
      | "mount"
      | "dismount"
      | "shell"
      | "mg"
      | "ordnance";
  }
>;

/**
 * `HULL_EARLY` — how far ahead of a HULL's own reload a person's round may
 * arrive, in seconds (`Vehicle.fireGun`'s `early`) — is stated once, in
 * `src/systems/hullRules.ts`, because the offline page asks its core with the
 * same slack for its own reason. Here it is `SHOT_SLACK`: the bucket is what
 * bounds a person's rate, the hull's clock is asked as well because it is the
 * HULL's and a seat changes hands, and the jitter the bucket was sized to
 * forgive is the jitter the clock must forgive too. So the two may not drift
 * apart, and this module refuses to load if they have.
 */
if (HULL_EARLY * 1000 !== SHOT_SLACK) {
  throw new Error(`[match] HULL_EARLY (${HULL_EARLY} s) is not SHOT_SLACK (${SHOT_SLACK} ms)`);
}

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
/** The claimant's reported look, which every cone in `claimGates` is measured about. */
const CLAIM_LOOK = new Vector3();

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
  /**
   * The simulation, built with `rewind` — the one option that is the
   * authority's: every person here is a remote shooter whose round meets the
   * world they saw a round trip ago. The respawn clock is the core's own
   * (`hostHoldsRespawn` off): a `deploy` is a request the reinforcement pass
   * spends once that clock runs out.
   */
  readonly game = new SimCore({ rewind: true, reportGap: REPORT_GAP });
  /**
   * When a message ARRIVED, in ms — what `onStamp` holds each peer's stamps
   * against. Monotonic and never compared with a client stamp directly: only
   * its INTERVALS are read. A harness that steps the match by hand replaces
   * it with its own (`server/corecheck.ts`, the simulation's time).
   */
  private arrivalClock: () => number = () => performance.now();

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
  /**
   * Whether this match fields bots — `Join.bots` off the join that created it,
   * and a fact about the MATCH rather than about the round.
   *
   * `readonly` in effect and deliberately not moved by anything: a rotation
   * changes the map and re-decides how many bodies it fields, and a player
   * arriving in a botless round joined one for that reason. There is no way to
   * turn bots on in a running match and there should not be one — the roster is
   * how a match fills, and a round that grew sixteen bodies under the four
   * people playing it would be a different game than the row they picked.
   */
  private readonly withBots: boolean;
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
   * credits `HitCredits.claim` pairs off are FIFO with no shot id on the
   * wire — and two lists flushed one after the other would put a tick's shared
   * events either wholly before or wholly after that client's own, whichever
   * way round the flush happened to be written.
   */
  private readonly pending: PendingEvent[] = [];

  /**
   * What the core said on its last call, drained into here by `relay`. Held
   * for the life of the match: a drain swaps arrays with it rather than
   * allocating.
   */
  private readonly drained = new EventCursor();

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

  /**
   * One `SlotRecord` per roster slot, for the life of the match — see that
   * type. Replaced whole when a slot changes hands, never cleared field by
   * field.
   */
  private readonly slots: SlotRecord[] = Array.from({ length: SLOT_COUNT }, freshSlot);

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
   * `firedRounds` for the cupola guns, keyed by HULL index rather than slot.
   *
   * A hull's second gun is not carried by a body, so the `fire` event — which
   * names a slot and is drawn off that slot's rig — cannot describe it, and
   * before this there was nothing on the wire for it at all: a gunner's belt
   * was silent and invisible on every screen but the gunner's own, including
   * the driver's sitting under it. Coalesced for `firedRounds`' reason, at
   * nine rounds a second.
   */
  private readonly firedMg = new Map<number, number>();

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
   * The ballot for the next map, open only between a round ending and the next
   * one being built — which is exactly the span `rotating` is true for.
   *
   * Null the rest of the time, and that is the test every path here asks
   * rather than a second flag: a vote that arrives outside the window has no
   * ballot to index and is dropped, and a rotation reads the winner off this
   * and then drops it, so nothing can carry a preference into a round it was
   * not cast in. See `server/MapVote.ts` for the rules it holds.
   */
  private mapVote: MapVote | null = null;
  /**
   * When the window shuts, on the WALL clock — the one place on this server
   * that is right rather than a lapse from `SimCore.now`.
   *
   * The simulation is not stepped while `rotating`, so its clock is frozen for
   * the whole of the window and a countdown measured against it would read the
   * same eight seconds forever. The wall clock is also what the rotation
   * itself is on (`setTimeout`), so this and the moment the vote actually
   * closes are the same clock by construction. It is not a stamp anything is
   * read AGAINST — see `MapVoteMessage.ms` — which is what the rule about
   * `Date.now()` is for.
   */
  private voteEndsAt = 0;
  /** Ticks since the ballot opened, for the flush cadence below. */
  private voteTicks = 0;
  /**
   * Whether the tally has moved since it was last sent.
   *
   * The ballot is the one message on this wire a client can ask for at will —
   * a peer alternating between two candidates moves the tally on every message
   * it sends — so it is sent on a CADENCE the peers do not control rather than
   * on the change itself. `scores` and `mines` are the same trade made against
   * a simulation that cannot be provoked; this one is made against peers who
   * can.
   */
  private voteDirty = false;

  /**
   * `wantedMap` is the map id the peer whose join created this match asked for.
   *
   * RESOLVED against the real table rather than taken as sent, exactly as the
   * weapon id is in `admit`: an id this build has never heard of — an older
   * client, a newer one, or something a peer made up — falls back to the default
   * map instead of standing up a match naming a world that does not exist here.
   * Nothing downstream re-checks it, which is why this is the one door.
   */
  constructor(readonly id: string, wantedMap?: string, bots = true) {
    this.mapId = MAPS.find((m) => m.id === wantedMap)?.id ?? MAPS[0].id;
    this.withBots = bots;
    // Nothing is wired onto the core: everything it has to say arrives on its
    // event ring and leaves through `relay`.
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
      // How many PEOPLE this match seats, which is not how big the slot table
      // is: the table is the ceiling any map may field and the seats are the
      // smallest map in the rotation, so that a rotation never has to evict
      // anybody. See `Roster.capacity`.
      slots: this.roster.capacity,
      bots: this.withBots,
      state: this.rotating ? "rotating" : this.timer ? "live" : "empty",
    };
  }

  /**
   * Seats a connected peer.
   *
   * A refused join is a full match, which the registry should have prevented by
   * routing elsewhere — but the check is kept here anyway, because the caller
   * asking "is there room" and this method acting on the answer are two separate
   * moments and a race between them is exactly how a seventeenth player gets in.
   */
  async admit(
    transport: PeerTransport,
    rawName: string,
    weapon?: string,
    equipment?: string,
    throwable?: string,
  ): Promise<void> {
    const id = `p${nextPeerId++}`;
    // Cleaned HERE, at the one door into the roster, rather than at the
    // handshake — the same placement as the weapon lookup below, and for the
    // same reason: a second caller of `admit` must not be able to skip it.
    const name = cleanName(rawName);
    const slot = this.roster.claim(id, name);
    if (!slot) {
      transport.send(encode({ t: "rejected", reason: "match full" }));
      transport.close();
      return;
    }

    const peer: Peer = {
      id,
      name,
      transport,
      slot: slot.index,
      seq: 0,
      stamp: NaN,
      arrived: 0,
      lead: 0,
      behind: 0,
      resyncOwed: false,
      budget: MESSAGE_BURST,
      budgetAt: Date.now(),
      ping: -1,
      pingAt: 0,
    };
    this.peers.set(id, peer);
    // Somebody came back before the world was thrown away.
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    transport.listen({
      message: (text) => {
        // Gone: dropped by `spendMessage` below, or by a `close` whose
        // remaining buffered messages are still being delivered. Either way
        // this peer has no slot to act on any more, and the test is what stops
        // a flooder being logged and refused once per message all the way
        // through the close.
        if (!this.peers.has(id)) return;
        // Before the decode, because the parse is what a flood is spending.
        if (!this.spendMessage(peer)) return;
        // `readClientMessage` and never `decode`: the shape gate is what makes
        // the `ClientMessage` type below a fact rather than a claim about a
        // well-behaved client, and every handler past this line reads fields
        // off it without checking them again. See `server/wire.ts` — a `move`
        // with no `pos` on it used to throw out of this listener and take the
        // process.
        const msg = readClientMessage(text);
        if (msg) this.onMessage(peer, msg);
      },
      closed: () => this.drop(peer),
      // The far end answered this class's ping, and the gap is what the
      // scoreboard shows.
      pong: () => {
        if (peer.pingAt === 0) return;
        const sample = Date.now() - peer.pingAt;
        peer.pingAt = 0;
        peer.ping =
          peer.ping < 0 ? sample : peer.ping + (sample - peer.ping) * PING_SMOOTHING;
      },
    });

    // The round is built on the first arrival, not at construction: building a
    // world costs a couple of hundred milliseconds and a match nobody has joined
    // has nothing to simulate.
    await this.ensureRunning();

    // That await is long enough for the peer to have gone — a tab closed, a
    // connection that never really came up — and `closed` was wired above it, so
    // `drop` has ALREADY run: it released the roster slot and put the bot back.
    // Seating the player now would bench that bot for the life of the match and
    // leave a body in `SimCore.players` that no peer owns and nothing ever
    // removes, because the only thing that removes one is the drop that has
    // been and gone. The team plays a body short and the ghost is tracked for
    // rewind forever.
    //
    // Tested on the peer map rather than on a flag, because that map is what
    // `drop` empties and what everything else here reads to mean "still
    // connected".
    if (!this.peers.has(id)) return;

    // The bot in this slot comes off the field and a person takes its place.
    // The body is not kept here: `setKit` below looks it up by slot, because
    // it is called from the deploy door too, where there is no fresh one to
    // hold.
    this.game.addPlayer(slot.index, slot.team);
    this.relay();
    // A slot changing hands inherits nothing from whoever last sat in it — the
    // travel least of all: the walk cycle is derived from how far a body moved
    // between snapshots, so a stale entry makes the new arrival's first frame
    // a sprint from wherever the previous person was standing.
    this.slots[slot.index] = freshSlot();
    // The kit this person named at the handshake, resolved out of this side's
    // own tables. It is the FIRST of two doors: a player picks a kit more than
    // once in a match, and the second is `onDeploy`.
    this.setKit(slot.index, weapon, equipment, throwable);
    // Not spawned here: a fresh player is dead with a zero timer, which is
    // exactly the state the reinforcement pass in `SimCore.step` picks up.
    // Joining and redeploying are the same act and go through the same door.

    this.send(peer, {
      t: "welcome",
      version: PROTOCOL_VERSION,
      matchId: this.id,
      slot: slot.index,
      team: slot.team,
      mapId: this.mapId,
      // The same clock the snapshots carry, and that is the load-bearing part:
      // a client samples the offset from EVERY stamped message and keeps the
      // maximum, so one message on a clock that runs even slightly ahead of the
      // snapshots' would win the window and drag render time past the samples
      // that have arrived.
      now: this.game.now,
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
    // …and the ballot, if this peer arrived inside the round-over window.
    // They hold a seat, so their vote would count for exactly what anybody
    // else's does — but a peer seated HERE has no round-over card to cast it
    // from, and that is a fact about the window rather than something to fix
    // at this line. The `roundover` event is queued once, on the tick the
    // round ended, so a client that arrived after it never receives one:
    // `NetSession` stores this message, `OverlayScreen.setVote` refuses it
    // for want of a card, and the joiner waits the rotation out with no
    // ballot rather than one they cannot answer. Sent anyway, because the
    // authority stating what it holds is not conditional on the far side
    // having somewhere to put it, and because the day a client does raise a
    // card inside this window it is already being told.
    if (this.mapVote) this.send(peer, this.voteMessage(slot.index));
    // Started now rather than on the next sweep, so this peer's own row has a
    // real number on it by the time the first table reaches them — a second of
    // "—" against your own name reads as a connection that is not working.
    this.pingPeer(peer);
    console.log(
      `[${this.id}] ${name} (${id}) took slot ${slot.index} on team ${slot.team}`,
    );
  }

  /**
   * Resolves what a person is carrying, out of THIS side's tables.
   *
   * The one place the two kit maps are written, and it exists because a kit is
   * chosen more than once in a match: the handshake names one and every deploy
   * after it may name another, and the two doors must resolve the pick the
   * same way or the loadout the authority pays a round out of depends on which
   * screen the player chose it from.
   *
   * **Ids in, numbers here.** A client names a weapon and the damage, range
   * and fall-off are looked up on this side — a client that could state its
   * own damage would state whatever it liked. An id this build has never heard
   * of falls back to the default rather than being refused, on both halves: a
   * client on a newer build naming a gun this server does not have should
   * still play, and the sidearm (which the kit screen never offers as a
   * primary) falls through the same door.
   *
   * The third slot is resolved on every map, including the two that offer no
   * third slot at all. The kit is the MAP's question and `Game.armourOffered`
   * is where a client answers it, so on a map with no armour what happens is
   * simply that no `ordnance` message ever arrives to spend this on; resolving
   * it conditionally would leave a player carrying nothing through a rotation
   * onto a map that has armour on it.
   *
   * **Both callers reach this with the player DEAD** — the handshake seats a
   * body that is dead with a zero timer, and the kit screen is reachable from
   * the deploy screen and nowhere else — which is what lets the pouch be
   * handed over straight (the core's `kit` refuses a living body):
   * `SimPlayer.spawn` refills `ordnance` from `ordnanceCarried`, so the body
   * that comes back is the first one that carries this. It is also what keeps
   * `fire`'s `w` and `onReload`'s gate honest, both of which read the loadout
   * of a player who is shooting and rest on it not changing under them.
   */
  private setKit(
    slot: number,
    weapon?: string,
    equipment?: string,
    throwable?: string,
  ): void {
    const held = this.slots[slot];
    held.loadout = weaponSetup(
      weapon && isPrimaryWeaponId(weapon) ? weapon : DEFAULT_WEAPON,
    );
    const kit = equipment && isEquipmentId(equipment) ? equipment : DEFAULT_EQUIPMENT;
    held.equipment = kit;
    const pouch = isThrowableId(throwable) ? throwable : DEFAULT_THROWABLE;
    held.throwable = pouch;
    // What a full pouch IS for this kit, handed to the core, whose count it
    // is (`kit`): the body is dead (see above), and `spawn` refills from it.
    this.game.submit(slot, {
      t: "kit",
      grenades: throwableCarried(pouch),
      ordnance: equipmentSetup(kit).magSize,
    });
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
    // A vote cast by somebody who has left is a vote by nobody. Marked dirty
    // rather than flushed here, so a match emptying out sends one tally on the
    // next cadence instead of one per departure.
    if (this.mapVote?.clear(peer.slot)) this.voteDirty = true;
    this.game.removePlayer(peer.slot);
    this.relay();
    // Everything this match held about the person, in one assignment — the
    // slot goes back to a bot carrying nothing of theirs.
    this.slots[peer.slot] = freshSlot();
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
   * through. Two callers: a rotation that threw, and a simulation step that
   * threw (`start`'s loop).
   *
   * Closing the connections is the honest answer rather than the harsh one: every
   * client reconnects on its own (`net/Connection.retry`) and lands in a fresh
   * match a second later, whereas a match left standing with a stopped loop is
   * a round that renders, never advances and never ends — and nothing on a
   * client can tell that from a server that has merely gone quiet.
   *
   * The peer map is emptied here rather than left to each transport's
   * `closed`, which arrives a turn later: `retire` refuses to run while anybody is still
   * seated, and the point of this method is that nobody is.
   */
  private abandon(reason: string): void {
    this.rotating = false;
    this.mapVote = null;
    if (this.rotateTimer !== null) {
      clearTimeout(this.rotateTimer);
      this.rotateTimer = null;
    }
    this.stop();
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    for (const peer of this.peers.values()) {
      this.send(peer, { t: "rejected", reason });
      peer.transport.close();
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

  /**
   * How many slots a side this round puts on the WIRE — which is not how many
   * bots it fields, and in a botless match is not the same number.
   *
   * The two questions have always been distinct and only ever had one answer
   * before this: "how many bots are in the fight" (`SimCore.perTeam`,
   * spent on `BattleSystem.setFielded`) and "how many slots hold a body a
   * client must pool, draw and be shot by" (`Roster.setFielded`). On an
   * ordinary match every fielded slot is a bot until a person takes it, so the
   * two are one number and taking it from the simulation is what stopped them
   * drifting.
   *
   * A botless match separates them, and the separation is the honest one: the
   * simulation fields no bots, and the wire still carries the SEATS, because a
   * seat is where a person goes and a person is a body whatever the round
   * fields. `HUMANS_PER_TEAM` and not `perTeam` for two reasons that agree — it
   * is exactly the set of slots a botless round can ever hold a body in
   * (`Roster.claim` seats nobody outside it), and it is the smallest roster any
   * map fields, so it is inside the pool every client built off its own map and
   * a rotation can never take it out of range.
   *
   * What that buys is the case nobody sees coming: a person leaving a botless
   * match. Their slot goes back to a bot that is set aside — dead, disabled —
   * and the snapshot keeps carrying it as such, so every client puts the body
   * away. Sent as nothing at all instead, the last frame a leaver was alive in
   * would stand in the street for the rest of the round.
   */
  private fieldedSlots(): number {
    return this.withBots ? this.game.perTeam : HUMANS_PER_TEAM;
  }

  private async start(): Promise<void> {
    if (!this.game.map) {
      const def = MAPS.find((m) => m.id === this.mapId) ?? MAPS[0];
      await this.startRound(def);
    }
    // What this map fields, onto the table. The simulation has already been
    // told (`SimCore.startRound`); this is the same decision reaching the
    // one thing that decides what goes out on the wire, derived from the
    // simulation rather than resolved a second time so the two cannot drift.
    this.roster.setFielded(this.fieldedSlots());
    // Wall-clock accumulator rather than one step per timer fire: `setInterval`
    // drifts and coalesces under load, and a simulation that took its `dt` from
    // whenever the timer happened to run would speed up and slow down with the
    // host's load. Everything in `CONFIG` — reload times, bleed intervals,
    // recoil decay — is written against real seconds.
    let carried = 0;
    let last = Date.now();
    this.timer = setInterval(() => {
      // **A step that THROWS ends the match**, and it is caught here rather
      // than left to the process backstop (`server/index.ts`), which only logs.
      // Left to it, the throw had already taken `carried` down a step, so the
      // next poll threw again — a log line at up to 250 Hz — and everything in
      // `step` after the throw (the lag record, the snapshot) never ran: a
      // world clients stay connected to that no longer advances coherently.
      // The way out is the one a failed rotation already takes, and the catch
      // is OUTSIDE the `while` on purpose: `abandon` has cleared this interval
      // and disposed the world, and the loop must not take another step of it.
      try {
        const now = Date.now();
        carried += now - last;
        last = now;
        // Bounded so a long stall (a GC pause, a suspended container) is
        // dropped rather than replayed as a burst of catch-up ticks that would
        // teleport every body on every client at once.
        //
        // What is dropped is real time the world will never be stepped
        // through, and the simulation's own clock is told so — that clock is
        // what every snapshot is stamped with, and one left quietly behind the
        // wall is one no client can follow. See `SimCore.drop`.
        if (carried > 250) {
          this.game.drop(carried - 250);
          carried = 250;
        }
        while (carried >= STEP_MS) {
          carried -= STEP_MS;
          this.step();
        }
      } catch (err: unknown) {
        console.error(`[${this.id}] step failed; abandoning match:`, err);
        this.abandon("the match server hit an error and ended the match");
      }
    }, POLL_MS);
    console.log(`[${this.id}] round started on ${this.mapId}, seed ${this.game.random.seed}`);
  }

  /**
   * A round on `def`, as this host owes it to the core: the bake and the floor
   * LOADED (the one await), the seed DRAWN, and the clock ANCHORED — the three
   * things `SimCore` does not do for itself, because it reads no clock and no
   * entropy (`BABYLON_EXIT.md` X2.5a). The anchor is taken the moment the
   * build returns, which is where `SimCore.anchor` says it must be.
   */
  private async startRound(def: MapDef): Promise<void> {
    const { collision, floor } = await loadSimWorld(def);
    this.game.startRound({
      def,
      collision,
      floor,
      difficulty: 1,
      // The CEILING, on every map — a slot index is a bot index and a match
      // rotates maps under one slot table — and the map's own roster fielded
      // out of it, or none in a match created without bots. See `RoundSpec`.
      pool: CONFIG.bots.maxPerTeam,
      fielded: this.withBots ? perTeamOf(def.layout) : 0,
      seed: freshSeed(),
    });
    this.game.anchor(Date.now());
    this.relay();
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
    // await, `SimCore.map` still points at the map of the round that ended —
    // the next one is still LOADING (`loadSimWorld`) — so a step taken there
    // would play on a world the round is over in.
    //
    // It does not currently crash, and that is an accident worth naming rather
    // than relying on: `conquest.winner` is still set from the round that
    // ended, so `SimCore.step` returns before it reaches `battle`, and it
    // stops being true the moment anything resets that earlier. This flag is
    // the fact itself, so the safety no longer rests on a second one agreeing
    // with it.
    //
    // The tick the round ends on is not affected: `rotating` is set BELOW,
    // after that tick has already run and broadcast its `roundover`.
    if (this.rotating) {
      // …but the window the round-over card is up for is this one, and the
      // ballot on it is live. This is the only thing that happens between a
      // round ending and the next map being built, and it is deliberately not
      // a timer of its own: the loop is already running at `TICK_HZ` across
      // the whole pause, so the cadence costs nothing and dies with the match.
      this.voteTicks++;
      if (this.voteDirty && this.voteTicks % TICKS_PER_SNAPSHOT === 0) {
        this.flushVote();
      }
      return;
    }

    const live = this.game.step(1 / TICK_HZ);
    this.relay();
    this.ticks++;

    // No `!this.rotating` here any more: the guard at the top of this method is
    // that test, made once for the whole step rather than for this branch
    // alone.
    if (!live && this.game.conquest.winner !== null) {
      // The `roundover` event is already queued: the core wrote `roundOver`
      // last of this tick's events and `relay` put it on the queue above.
      // The round is over but the match is not. Everyone stays seated, the
      // card goes up on every client, and the next map is built after a pause
      // — a server that stopped here would leave sixteen people looking at a
      // frozen world with no way out but reconnecting.
      this.rotating = true;
      // The ballot goes out BEFORE the result does. The `roundover` event is
      // still in the queue that `broadcastSnapshot` flushes below, so opening
      // here means a client holds the candidates by the time the card it draws
      // them on is raised — rather than putting up a wait line and replacing it
      // a beat later with a vote.
      this.openVote();
      this.broadcastSnapshot();
      this.rotateTimer = setTimeout(() => {
        this.rotateTimer = null;
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
   * The round-over pause's timer, held so `abandon` can cancel it: a step that
   * throws inside that pause would otherwise leave a rotation queued against a
   * world `abandon` has already disposed.
   */
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Next map, same people.
   *
   * The slot table is untouched: who is in which slot is a fact about the
   * MATCH, not about the round, so a rotation rebuilds the world and restarts
   * the fight without anybody being re-seated or having to rejoin. Every seated
   * player is dead with a zero timer afterwards, which is exactly the state
   * `SimCore.step` deploys them from.
   *
   * What the new map DOES bring is how many bodies a side it fields
   * (`setFielded`), and the whole reason that is safe to change here is that it
   * moves nobody: the table is the ceiling, a person may only ever sit in the
   * first eight of a team's block, and every map fields at least that many. So
   * a rotation onto a smaller map takes bots off the field and never a player
   * out of a seat. See `server/Roster.ts`.
   */
  private async rotate(): Promise<void> {
    const order = MAPS.map((m) => m.id);
    // What the vote came to, and the fallback beside it is the SAME map on a
    // ballot nobody answered — `MapVote`'s first candidate is this expression.
    // The fallback is only reachable at all if a rotation ran without a window
    // in front of it, which nothing does today; it is here because a rotation
    // that could not name a map would abandon the match.
    const next =
      this.mapVote?.winner() ?? order[(order.indexOf(this.mapId) + 1) % order.length];
    // Closed before anything is built, so a vote arriving inside the build —
    // a peer whose last press was in flight — is dropped rather than counted
    // toward a ballot whose result has already been spent.
    this.mapVote = null;
    this.mapId = next;
    const def = MAPS.find((m) => m.id === next) ?? MAPS[0];

    await this.startRound(def);
    // The new map's roster, onto the table — see `start`. FIRST, because
    // everything below it sends a list this filters.
    this.roster.setFielded(this.fieldedSlots());
    // Nobody is retired or re-benched here: `SimCore.startRound` puts every
    // seated person back dead with a zero timer and benches the bot in their
    // slot itself, last of the round's build.
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
    // `game.now` and not the wall clock, for `welcome`'s reason: one stamp on a
    // different clock poisons the offset window every body is drawn against.
    this.broadcast({ t: "roundstart", mapId: this.mapId, now: this.game.now });
    this.broadcastRoster();
    console.log(`[${this.id}] rotated to ${this.mapId}, seed ${this.game.random.seed}`);
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
      // A slot this map does not field is not a body at all — see
      // `broadcastRoster`. It is left OUT rather than sent dead, which is the
      // rule the hulls and the grenades already follow: a client pools one
      // soldier per slot it was told about, and there is nothing there to
      // describe.
      if (!this.roster.isFielded(i)) continue;
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
          // `SimPlayer.deathProgress` for why this is not a bare 1.
          dead: player.deathProgress,
        });
        continue;
      }
      const bot = bots[i];
      // **A fielded slot with NOTHING in it**, which is what every seat in a
      // botless match is until somebody sits down in it, and what a seat goes
      // back to when they leave. A bot that is set aside without being ALIVE is
      // benched or unfielded — off the field until something puts it back — and
      // its `deathProgress` is frozen wherever its last death left it, which is
      // 0 for one that has never died. So the state is stated rather than read:
      // a client puts a body away at `dead >= 1` and would otherwise hold a
      // leaver's last standing frame in the street for the rest of the round.
      //
      // A CREWED bot is aside and alive, and is deliberately not this: it is a
      // body inside a hull, its position is the hull's, and `VehicleState.by`
      // is what stops it being drawn standing beside one.
      if (!bot.alive && this.game.battle.aside(bot)) {
        this.entityScratch.push({
          i,
          p: [bot.position.x, bot.position.y, bot.position.z],
          yaw: bot.lookYaw,
          bodyYaw: bot.feetYaw,
          pitch: bot.aimAngle,
          moving: 0,
          alive: false,
          dead: 1,
        });
        continue;
      }
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
    this.game.grenades.forEachLive((id, at, fuse, by, kind) => {
      const g: GrenadeState = {
        i: id,
        p: [at.x, at.y, at.z],
        by: this.slotOf(by),
        fuse,
      };
      // A frag says nothing — see `GrenadeState.k` — so the snapshot a round
      // of frags sends is byte for byte the one it always sent.
      if (kind !== "frag") g.k = kind;
      this.grenadeScratch.push(g);
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
      if (!tank.present) continue;
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
      // The SIMULATION's clock, not the wall's. Between two snapshots the world
      // advanced by exactly `TICKS_PER_SNAPSHOT` steps; `Date.now()` read here
      // advanced by however many times the host's timer happened to fire in
      // between, which on an idle box is 31 to 79 ms for the same 50 ms of
      // motion. A client interpolates position against these stamps, so that
      // spread is rendered directly as speed — measured at 0.63x to 1.61x,
      // changing every snapshot. It is the limp `docs/multiplayer.md` describes
      // for a `SNAPSHOT_HZ` that does not divide `TICK_HZ`, reached through the
      // timer instead of the ratio, and it is worst on the fastest thing in the
      // game: a gunship moves a metre and a half a snapshot, so ±60% of it is
      // the picture shaking for the man on its gun. See `SimCore.now`.
      now: this.game.now,
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
    // mid-interval. A slot with no loadout is a bot, and a bot is the flat round
    // the field's absence already means — so there is nothing to say and the
    // event stays the shape it has always been.
    for (const [slot, n] of this.firedRounds) {
      const w = this.slots[slot]?.loadout?.id;
      this.queue(n > 1 ? { e: "fire", slot, n, w } : { e: "fire", slot, w });
    }
    this.firedRounds.clear();
    // The cupola guns, on the same message for the same reason.
    for (const [tank, n] of this.firedMg) {
      this.queue(n > 1 ? { e: "mg", tank, n } : { e: "mg", tank });
    }
    this.firedMg.clear();

    this.flushEvents();
  }

  /**
   * Drains the core and turns what it said into wire events, in the order it
   * said it — the bodies of the callbacks this class used to install on the
   * core, reading the EVENT's numbers where they read the live objects.
   *
   * Called after every call this class makes on the core (`step`, each
   * message, `startRound`, a seat changing hands), so nothing of this class's
   * own can land between two of one call's events. Most kinds are not the
   * wire's — a footstep, a tracer, a hull's kick are the page's, and a death's
   * audit is `simulate`'s — so the kind is tested before anything is decoded.
   */
  private relay(): void {
    const c = this.drained;
    this.game.drain(c);
    for (let i = 0; i < c.count; i++) {
      if (!RELAYED.has(c.kind(i))) continue;
      const ev = decode(c, i);
      switch (ev.type) {
        // A bot went down, however it was done. The bearing, the size and the
        // KIND of the killing blow ride along because a client throws its
        // corpse with them — captured off `Bot.takeDamage` at the death, the
        // same triple the offline game hands `RagdollSystem`.
        case "botDown":
          this.queue({
            e: "kill",
            killer: ev.killer,
            victim: ev.slot,
            headshot: ev.head,
            from: ev.from,
            amount: ev.damage,
            kind: ev.kind,
          });
          break;
        // A bot pulled its trigger. News for a screen, and the only way the
        // fact reaches one: a client runs none of the AI, so a bot's shot is
        // otherwise silent and invisible on every machine but this one.
        case "botFired":
          this.noteFire(ev.slot);
          break;
        // A bot working its magazine, for exactly the reason its trigger is:
        // the fact is the authority's and what it is FOR is an ear — a reload
        // is the cue to push whoever has just gone dry.
        case "botReload":
          this.noteReload(ev.slot);
          break;
        // A round that went past somebody. Addressed to the one person it
        // happened to — a broadcast is the read a wallhack wants.
        case "nearMiss":
          this.queueTo(ev.slot, { e: "nearmiss", at: ev.at });
          break;
        // The flag's news, after the awards the core paid for it.
        case "captured":
          this.queue({ e: "captured", point: this.pointId(ev.point), by: ev.by });
          break;
        case "neutralised":
          this.queue({ e: "neutralised", point: this.pointId(ev.point) });
          break;
        // Somebody was paid. Addressed to the one slot that earned it, and
        // only when a PERSON was sitting in it: bots earn all round and there
        // is nobody behind them to show a feed to, so queueing theirs would
        // push every tick with a bot kill on it onto `flushEvents`'s per-peer
        // path for an event no client would be sent.
        case "award":
          if (ev.person) this.queueTo(ev.slot, { e: "score", kind: ev.kind, points: ev.points });
          break;
        case "damaged":
          // Addressed to the victim, and the sharpest case for it: this is the
          // ONE message in the protocol carrying a health, so broadcasting it
          // published every player's exact pool to everybody, live, along with
          // the bearing they were shot from. That is the read a wallhack wants
          // — who is hurt and which way they are facing it — handed over free.
          //
          // The `kill` below stays public, and the pair is the line: that
          // somebody DIED is everyone's business, because the killfeed and the
          // corpse are on every screen. How close they were to dying is
          // nobody's but theirs.
          this.queueTo(ev.slot, {
            e: "damage",
            victim: ev.slot,
            amount: ev.amount,
            from: ev.from ?? [0, 0, 0],
            health: ev.health,
            // The victim's own corpse is thrown from this rather than from the
            // `kill` below: a client reads its OWN death off the `damage`/
            // `died` pair, and only somebody else's off the kill.
            kind: ev.kind,
          });
          if (ev.killed) {
            // The other half of "one kill event per death". A person goes down
            // through this event whoever pulled the trigger — a bot's rifle, a
            // blast, another client's round — so it is the only place that
            // sees every one of them, exactly as `botDown` is for a bot.
            //
            // The killer's team is DERIVED and not carried: friendly fire is
            // excluded by construction everywhere in this game (`fire` takes
            // the shooter's own target list), so the side that killed a person
            // is always the other one.
            //
            // `headshot` is false rather than unknown: the flag is the
            // SHOOTER's feedback and reaches them on their own `hit` event,
            // which is resolved where the head zone was actually tested.
            this.queue({
              e: "kill",
              // …and the one death that has no killer to derive. The leash
              // passes no origin because nothing shot this player, and -1 is
              // what stops the feed on sixteen screens announcing that the
              // other side did.
              killer: ev.from ? 1 - ev.team : -1,
              victim: ev.slot,
              headshot: false,
              from: ev.from ?? [0, 0, 0],
              amount: ev.amount,
              kind: ev.kind,
            });
            // The respawn clock the blow armed, as it stood at the blow.
            this.queue({ e: "died", slot: ev.slot, by: -1, respawnIn: ev.respawnIn });
          }
          break;
        // How big it LOOKS goes with it now that more than one thing explodes:
        // a grenade is 1 by definition, a tank shell 1.85, the AT kit its own.
        // Left off at 1, which is what the field's absence has always meant.
        case "blast":
          this.queue(
            ev.power === 1
              ? { e: "explode", at: ev.at }
              : { e: "explode", at: ev.at, power: ev.power },
          );
          break;
        // A molotov caught. Public for `explode`'s reason — every client draws
        // the fire, the thrower included, because their own bottle lit nothing
        // on their screen (`GrenadeSystem.predicted`). The burn is this side's
        // and leaves as `damage`, like any other hit.
        case "ignited":
          this.queue({ e: "blaze", at: ev.at });
          break;
        // A tank gun. Public, and `fire`'s counterpart for the one weapon
        // nobody is carrying — no client runs the crew that pulled the trigger
        // or resolves the round it fired.
        case "cannon":
          if (ev.tank >= 0) this.queue({ e: "cannon", tank: ev.tank });
          break;
        // …and its cupola gun, counted rather than queued — see `firedMg`.
        case "mg":
          if (ev.tank >= 0) this.firedMg.set(ev.tank, (this.firedMg.get(ev.tank) ?? 0) + 1);
          break;
        // The answer to a mount or a dismount, addressed to the one person who
        // asked — see the `seat` event. Written for the hull BURNING as well,
        // the one seat change nobody asked for and the one a client can least
        // afford to miss: without it the driver's own screen keeps the chase
        // camera on a wreck for the rest of the round.
        case "seat":
          this.queueTo(
            ev.slot,
            ev.tank >= 0
              ? { e: "seat", slot: ev.slot, tank: ev.tank, seat: ev.seat as CrewSeat }
              : { e: "seat", slot: ev.slot, tank: ev.tank, pos: ev.at, yaw: ev.yaw },
          );
          break;
        // Glass. One event for however many panes the round crossed, carrying
        // the FIRST crossing and the round's direction — see the `glass` event
        // for why the shards of the panes behind it are thrown from a point a
        // few metres off rather than paying a message each.
        case "glass":
          this.queue({ e: "glass", panes: ev.panes, at: ev.at, dir: ev.dir });
          break;
        case "spawned":
          this.queue({ e: "spawn", slot: ev.slot, pos: ev.pos, yaw: ev.yaw });
          break;
        // A PERSON's round, resolved: addressed to the shooter, because it is
        // feedback about their own trigger and nobody else's screen has
        // anything to do with it. Broadcast, it told fifteen other clients who
        // is hitting whom and — through `killed` — that a body across the map
        // is going down, a tick before the snapshot that would honestly show
        // either. Every other cause's `hit` is the page's (a hull gun's, a
        // blast's, the tracks'), which this wire has never carried. A hull
        // victim is -1 on the wire, which names slots.
        case "hit":
          if (ev.cause !== "round") break;
          this.queueTo(ev.shooter, {
            e: "hit",
            shooter: ev.shooter,
            victim: ev.victimKind === "hull" ? -1 : ev.victim,
            killed: ev.killed,
            headshot: ev.head,
          });
          break;
        case "roundOver":
          this.queue({ e: "roundover", winner: ev.winner });
          break;
        default:
          break;
      }
    }
  }

  /** A control point's id, from the index a `captured`/`neutralised` names. */
  private pointId(index: number): string {
    return this.game.conquest.points[index]?.def.id ?? "";
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
    this.queue({ e: "reload", slot, w: this.slots[slot]?.loadout?.id });
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
      // rather than left to the transport's own `closed` — that arrives a
      // turn later, and until it does every buffered message would come back
      // through here.
      this.send(peer, { t: "rejected", reason: "too many messages" });
      peer.transport.close();
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
        // The ones that belong to a round in progress, gated on the same fact
        // `step` is: between a round ending and the next one being built there
        // is a window in which `game.map` is the map of the round that ended,
        // and a message is the one thing that can arrive inside it —
        // a client whose own round is over still has a socket, and its last
        // shots are in flight. Dropping them is right on its own terms as well:
        // a round fired into a fight that has finished has nothing left to hit,
        // and a reload announced across a rotation is a noise from last round's
        // world arriving over the next one's.
        //
        // `deploy` below is deliberately NOT here. It touches no geometry — it
        // writes an integer a later tick spends — and refusing it would drop a
        // request the client has no reason to send twice.
        if (!this.rotating) this.onRoundMessage(peer, msg);
        break;
      case "deploy":
        this.onDeploy(peer, msg);
        break;
      // The one message that is only meaningful while `rotating`, which is why
      // it is not in the block above and why `onVote` tests for a ballot
      // instead: everything there belongs to a round in progress and this
      // belongs to the gap between two.
      case "vote":
        this.onVote(peer, msg);
        break;
      // Every member of the union has an arm above, so a new one fails to
      // compile here until somebody has decided which side of the `rotating`
      // gate it belongs on — the `if`/`else` chain this replaced ran a type it
      // had not heard of as a RELOAD.
      default: {
        const unhandled: never = msg;
        void unhandled;
      }
    }
    // Whatever the core said while answering this message, onto the queue
    // NOW — before the next message or the next step can add to it. A
    // handler makes its core calls one after another with nothing of this
    // class's own queued between them, so one drain at its end is the drain
    // after each of them, and the queue's order is the order the immediate
    // callbacks this replaced produced.
    this.relay();
  }

  /**
   * The messages that belong to a round in progress, past `onMessage`'s gate.
   *
   * Exhaustive by construction, for `onMessage`'s reason: a type added to that
   * method's round block and not given an arm here fails the `never` below.
   */
  private onRoundMessage(peer: Peer, msg: RoundMessage): void {
    switch (msg.t) {
      case "move":
        this.onMove(peer, msg);
        break;
      case "shot":
        this.onShot(peer, msg);
        break;
      case "grenade":
        this.onGrenade(peer, msg);
        break;
      case "reload":
        this.onReload(peer);
        break;
      case "drive":
        this.onDrive(peer, msg);
        break;
      case "gunner":
        this.onGunner(peer, msg);
        break;
      case "mount":
        this.onMount(peer, msg);
        break;
      case "dismount":
        this.onDismount(peer);
        break;
      case "shell":
        this.onShell(peer, msg);
        break;
      case "mg":
        this.onMg(peer, msg);
        break;
      case "ordnance":
        this.onOrdnance(peer, msg);
        break;
      default: {
        const unhandled: never = msg;
        void unhandled;
      }
    }
  }

  /**
   * A player naming which of the offered maps they want next.
   *
   * An ASK in the deploy's sense, and everything that makes it safe is on the
   * far side of it: `MapVote.vote` refuses an index that is not on the ballot,
   * a slot may hold exactly one vote however many it sends, and the tally only
   * ever leaves here on the cadence `step` flushes it at. So a peer that votes
   * as fast as its allowance permits moves one row in a map sixteen times and
   * costs everybody else one message per snapshot interval.
   *
   * A vote with no ballot open — the window has shut, or a client that has
   * been sending them all round — is dropped in silence. There is nothing to
   * tell the player: the card is already down, and the map they asked for is
   * either being built or was never on offer.
   */
  private onVote(peer: Peer, msg: Extract<ClientMessage, { t: "vote" }>): void {
    if (!this.mapVote) return;
    if (this.mapVote.vote(peer.slot, msg.map)) this.voteDirty = true;
  }

  /**
   * Opens a ballot over the round-over pause and states it to everyone.
   *
   * The candidates are drawn out of `MAPS` — the same table the rotation walks
   * — so a build with one map offers one candidate and a dev build offers the
   * proving ground exactly as its rotation already does. Nothing here decides
   * WHEN the window shuts: the round-over timer already does, and this only
   * records what that will be so the card can count it down.
   */
  private openVote(): void {
    this.mapVote = new MapVote(
      MAPS.map((m) => m.id),
      this.mapId,
    );
    this.voteEndsAt = Date.now() + ROUND_OVER_MS;
    this.voteTicks = 0;
    this.voteDirty = false;
    this.flushVote();
  }

  /**
   * The ballot as it stands, to every peer — one message each, because
   * `choice` is the one field on it that is about the reader.
   *
   * Sixteen small encodes at twenty a second for eight seconds, which is the
   * shape `flushEvents` already takes for an addressed event and a fraction of
   * what a single snapshot costs. The alternative is a broadcast tally plus a
   * client that remembers its own pick, and a client remembering something the
   * authority holds is exactly the disagreement this side of the wire is built
   * not to have.
   */
  private flushVote(): void {
    if (!this.mapVote) return;
    this.voteDirty = false;
    for (const peer of this.peers.values()) {
      this.send(peer, this.voteMessage(peer.slot));
    }
  }

  /** The ballot as one slot reads it. */
  private voteMessage(slot: number): ServerMessage {
    const vote = this.mapVote!;
    return {
      t: "mapvote",
      maps: [...vote.maps],
      tally: vote.tally(),
      choice: vote.choiceOf(slot),
      ms: Math.max(0, this.voteEndsAt - Date.now()),
    };
  }

  /**
   * A player asking to come back in, where, and CARRYING WHAT.
   *
   * All this does about the spawn is SUBMIT the ask (`deploy`). The simulation
   * spends it — see the reinforcement pass in `SimCore.step` — because when a
   * person may deploy is the reinforcement clock's answer and where they land
   * is conquest's, and neither of those questions is a transport's business.
   *
   * The KIT is different, and is resolved here and now: it is this side's own
   * lookup rather than a rule the simulation owns, and it must be in place
   * before the body it describes exists. See `setKit`.
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
    // The kit the player confirmed this spawn with — the SECOND of the two
    // doors, and the one that catches every pick after the handshake. The kit
    // screen is reachable from the deploy screen, so a player who switches to
    // the sniper on their third death was carrying it locally while this side
    // went on resolving their rounds against the gun they joined with: a
    // sniper head shot that does not kill, and an LMG round paying the
    // marksman rifle's forty-five.
    //
    // Absent means UNCHANGED rather than default, which is what a client that
    // predates the fields means and what keeps them additive — hence the
    // fallback to what this slot already carries rather than a second call to
    // the tables. It is spent here, on a player who is by definition dead
    // (checked above), rather than at the spawn: `setKit` writes the pouch and
    // `SimPlayer.spawn` is what fills it.
    const held = this.slots[peer.slot];
    this.setKit(
      peer.slot,
      msg.weapon ?? held.loadout?.id,
      msg.equipment ?? held.equipment ?? undefined,
      msg.throwable ?? held.throwable ?? undefined,
    );
    this.game.submit(peer.slot, { t: "deploy", spawn: msg.spawn });
  }

  /**
   * One reported movement sample: validate it, then keep it or push back.
   *
   * The client simulates its own `Player` and tells us where it ended up. This
   * is the whole of what stops that being a licence to teleport — see
   * `server/validate.ts` for what is and is not caught, and why the tolerance
   * leans toward letting a laggy honest player through.
   */
  /**
   * A `move` or `drive` stamp, read: the interval since this peer's last one
   * that the validators may price a step at, in seconds — BOUNDED twice. Per
   * sample to [1 / `TICK_HZ`, `MAX_MOVE_GAP`], as it always was; and in sum
   * by the clock the messages ARRIVE on, so the stamps may lead or trail
   * their arrivals by `STAMP_SLACK` and no further (see it). Keeps the
   * BOUNDED clock too, as `Peer.behind`, which the crash test reads off the
   * same interval.
   *
   * Exact for an honest peer: the raw interval comes back to the bit, and the
   * bounded clock IS its stamp. The first stamp has nothing to measure
   * against, so it is assumed to cover one INPUT interval — the cadence a
   * client actually sends at. Assuming a single TICK instead (which this did
   * at first) gives the very first packet a 16 ms budget it has no way of
   * knowing about.
   */
  private onStamp(peer: Peer, stamp: number): number {
    const now = this.arrivalClock();
    if (Number.isNaN(peer.stamp)) {
      peer.stamp = stamp;
      peer.arrived = now;
      return 1 / INPUT_HZ;
    }
    const raw = stamp - peer.stamp;
    const arrived = now - peer.arrived;
    // The interval the lead allows: what arrived meanwhile, plus whatever is
    // left of the slack either way. Returns `raw` ITSELF whenever it is in
    // range, which is what keeps an honest peer's numbers bit for bit.
    const d = Math.min(
      Math.max(raw, arrived - STAMP_SLACK - peer.lead),
      arrived + STAMP_SLACK - peer.lead,
    );
    peer.lead += d - arrived;
    // The bounded clock never runs backwards and never takes more than one
    // sample's worth at once — the crash test's interval is the validators'.
    peer.behind += raw - Math.min(Math.max(d, 0), MAX_MOVE_GAP * 1000);
    peer.stamp = stamp;
    peer.arrived = now;
    return Math.min(Math.max(d / 1000, 1 / TICK_HZ), MAX_MOVE_GAP);
  }

  private onMove(peer: Peer, msg: Extract<ClientMessage, { t: "move" }>): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !this.game.map) return;

    // Stale or replayed. Sequence numbers are the client's own counter, so an
    // out-of-order arrival is dropped rather than applied backwards.
    if (msg.seq <= peer.seq) return;

    // Elapsed CLIENT time since the last sample, BOUNDED (`onStamp`): by the
    // clock the messages arrive on, and per sample to `MAX_MOVE_GAP`.
    // Unbounded, a client that claims a huge gap buys itself a
    // proportionally huge legal step, which is the obvious way to dress a
    // teleport as a lag spike.
    //
    // The CLOCK advances whether or not the POSITION is accepted, and this is
    // load-bearing. Updating it only on success means one rejected move leaves
    // the last stamp behind forever: every later sample is then measured
    // against the whole elapsed gap — or, on the very first move, against the
    // first-sample assumption — and a player whose opening packet was a
    // fraction too long is judged against a 16 ms budget for the rest of the
    // match and can never move again. It presents as movement simply not
    // working, with corrections streaming, and it cost a debugging session.
    // Advancing it here is safe because the gap is bounded anyway.
    const dt = this.onStamp(peer, msg.time);

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
        seq: peer.seq,
        reason: verdict.reason!,
      });
      return;
    }

    peer.seq = msg.seq;
    this.game.submit(peer.slot, {
      t: "move",
      dt,
      x,
      y,
      z,
      yaw: msg.yaw,
      pitch: msg.pitch,
      crouch: msg.crouching,
      sprint: msg.sprinting,
    });
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
    const held = this.slots[slot];
    const prev = held.lastSeen;
    const interval = TICKS_PER_SNAPSHOT / TICK_HZ;
    let moving = 0;
    if (prev) {
      const speed = Math.hypot(x - prev.x, z - prev.z) / interval;
      moving = Math.min(1, speed / CONFIG.player.moveSpeed);
      prev.x = x;
      prev.z = z;
    } else {
      held.lastSeen = { x, z };
    }
    return moving;
  }

  /**
   * A round a client says it fired. The authority decides what it hit.
   *
   * Three gates before the ray is even run, in ascending cost:
   *
   *   1. **Rate.** A client cannot fire faster than its weapon's own
   *      `shotInterval`, SUSTAINED — the gate is a credit bucket rather than a
   *      minimum spacing, because what it can measure is when rounds arrived
   *      and that is the network's schedule and not the shooter's. See
   *      `SHOT_SLACK`. Without a gate of some kind, "hold the trigger" is a
   *      client-side opinion and a modified one empties a magazine in a frame.
   *
   *      **Which weapon's interval is a question in itself**: everyone carries
   *      two, and the round says which one it left. That is the same field the
   *      damage is read off, so a slot the authority ignored got both wrong at
   *      once.
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

    const held = this.slots[peer.slot];
    const primary = held.loadout;
    if (!primary) return;
    // WHICH of the two, because they are not worth the same. A pistol round
    // paid out of the primary's table is a sniper's hundred from a sidearm at
    // one end and a nerfed pistol at the other, and the rate gate below is
    // wrong by the same amount. A claim like every other field on the message
    // — see `ShotMessage.slot` — so anything that is not the sidearm's index
    // resolves to the primary, which costs a lying client its own sidearm and
    // buys it nothing.
    const weapon = msg.slot === SIDEARM_SLOT ? SIDEARM_SETUP : primary;

    // 1. rate. Credit accrues in real time and a round spends an interval of
    // it; the cap is what a stall may hand back. See `SHOT_SLACK`.
    const now = Date.now();
    const interval = weapon.shotInterval * 1000;
    const sidearm = msg.slot === SIDEARM_SLOT;
    let gate = held.fire;
    // **A WEAPON JUST DRAWN HAS NO COOLDOWN**, which is the client's own rule
    // — `Player.completeSwap` drops the fire cooldown with the weapon that
    // earned it, because the swap has already cost more time than either. A
    // bucket that did not know this ate the first round out of every gun whose
    // interval is longer than its own draw, and there is exactly one:
    // the sniper draws in 1.0 s and cycles in 1.25, so "swap and shoot" —
    // which is what the second slot is FOR — silently lost the round.
    //
    // A swap is inferred rather than reported: the hands changed if this round
    // claims the other slot, and it cost at least the drawn weapon's own
    // `drawTime`, during which nothing can have fired. That second half is
    // what stops the refill being a cheat — a client alternating its claims to
    // farm full buckets must go a whole draw without firing to earn each one,
    // which bounds it at one round per 0.34 s, slower than any weapon in the
    // kit.
    const drawn =
      gate !== null &&
      gate.sidearm !== sidearm &&
      now - gate.fired >= weapon.drawTime * 1000 * 0.9;
    // A slot that has not fired before starts full (`RateGate`), so nobody's
    // first round is refused for arriving too soon after a match they were
    // not in.
    if (gate === null) {
      gate = held.fire = { bucket: new RateGate(), fired: now, sidearm };
    }
    if (drawn) gate.bucket.fill();
    gate.sidearm = sidearm;
    if (!gate.bucket.ready(now, interval)) return;
    gate.bucket.spend(interval);
    gate.fired = now;

    // 2. direction, about the shooter's own reported look
    if (!claimedDir(msg.dir, SHOT_DIR)) return;
    lookDir(player.yaw, player.pitch, CLAIM_LOOK);
    if (!withinCone(CLAIM_LOOK, SHOT_DIR, SHOT_CONE_COS)) return;

    // 3. origin
    if (!withinSlip(msg.origin, player.eyePos, MAX_ORIGIN_SLIP)) return;

    // Past all three gates, so this is a round the authority accepts was fired
    // — which is what gives the shooter away, whatever it goes on to hit. Noted
    // before the ray rather than after it for exactly that reason: a miss is as
    // loud as a hit, and a shot at nobody must still light the map up.
    this.noteFire(peer.slot);

    SHOT_ORIGIN.fromArray(msg.origin);
    // The verdict comes back as the core's `hit` event, written LAST of the
    // round's events and relayed to the shooter alone — see `relay`. Rewound
    // to the client's render clock, which is what `msg.time` is.
    this.game.submit(peer.slot, {
      t: "shot",
      origin: SHOT_ORIGIN,
      dir: SHOT_DIR,
      weapon,
      renderTime: msg.time,
    });

    // The `hit` and NOTHING ELSE. Everything a death owes — the ticket,
    // the `kill` line, the `died` clock — is raised by whichever of the two
    // core events saw the body go down: `damaged` for a person, `botDown` for
    // a bot, and each of those is written for every death of its kind however
    // it was dealt. Pushing a second `kill` from here would put
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
    // Nothing is thrown from inside a hull, for `onShot`'s reason exactly —
    // and the core refuses it too; asked here first so a seated, dead or
    // empty-handed peer costs no cone arithmetic.
    if ((this.game.players.get(peer.slot)?.seat ?? -1) >= 0) return;
    const player = this.game.players.get(peer.slot);
    if (!player || !player.alive) return;
    if (player.grenades <= 0) return;

    if (!claimedDir(msg.dir, SHOT_DIR)) return;
    lookDir(player.yaw, player.pitch, CLAIM_LOOK);
    // A grenade leaves along a lifted version of the aim, so the cone has to be
    // wider than a bullet's — `throwLift` tilts it up before it is thrown.
    if (!withinCone(CLAIM_LOOK, SHOT_DIR, GRENADE_CONE_COS)) return;
    if (!withinSlip(msg.origin, player.eyePos, MAX_ORIGIN_SLIP)) return;

    SHOT_ORIGIN.fromArray(msg.origin);
    // Spent by the core only if the arm accepts it — the pool refuses rather
    // than stealing a live slot, and a refused throw costs nothing. WHAT is
    // thrown is this side's record of the kit, never anything on the message.
    this.game.submit(peer.slot, {
      t: "grenade",
      origin: SHOT_ORIGIN,
      dir: SHOT_DIR,
      kind: this.slots[peer.slot].throwable ?? DEFAULT_THROWABLE,
    });
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
   * `onMove`'s twin, and the two places it differs are decisions:
   *
   *   - **`validateDrive`, not `validateMove`.** The speed bound is the tank's
   *     — see `server/validate.ts` for why the ground and solid checks are
   *     wrong for a hull rather than merely skipped, and for why two of its
   *     four terms are lids rather than refusals.
   *   - **`hullcorrect`, not `correct`.** A `correct` moves the local BODY, and
   *     a client that received one while driving would be told to put its feet
   *     somewhere without being told anything about its tank — which is why
   *     this used to answer a refusal with SILENCE.
   *
   *     **That silence was unrecoverable and it is the reason this method is
   *     written the way it is.** The one hull a client never poses from the
   *     wire is the one under its own driver (`Game.vehicleOrders.remoteFor`
   *     answers null for it), so nothing ever pulled a refused driver back:
   *     the authority's hull stopped where it was, every later sample was
   *     measured against that stale position and failed the speed bound by
   *     construction, and the pilot flew a copy nobody else could see. It
   *     presented as a helicopter that captured nothing, could not be got out
   *     of, and teleported across the map on the first seat change.
   *
   *     So EVERY outcome that is not "applied exactly as sent" is answered.
   *     A refusal sends the authority's own hull; a clamp sends the position
   *     that was actually taken. Both are the same message, because a client
   *     has the same thing to do about either.
   *   - **No seat is granted here.** A `drive` naming a hull this player is
   *     not in is dropped, not obeyed. Getting into a tank is `onMount`'s, and
   *     it is one door for the reason spawning is one door.
   */
  private onDrive(peer: Peer, msg: Extract<ClientMessage, { t: "drive" }>): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !this.game.map) return;
    if (msg.seq <= peer.seq) return;
    // The clock advances whether or not the step is accepted, for the reason
    // `onMove` spells out at length: a rejection that left the stamp behind
    // measures every later sample against the whole elapsed gap. Bounded the
    // same way, and the same bounded clock is what the crash test reads below.
    const dt = this.onStamp(peer, msg.time);
    if (!player.alive || player.seat !== msg.tank) return;

    const tank = this.game.hullOf(player);
    if (!tank) return;
    const [x, y, z] = msg.pos;
    // **Measured from the last sample this driver reported and the authority
    // ACCEPTED, and never from where the hull has got to** — which is
    // `onMove`'s rule, arriving late on the half of the wire that could not
    // take it for granted. A body's accepted position IS `player.position`,
    // written by `apply` on the tick it arrives, so the body check has always
    // compared one claim with the claim before it. A hull's is not: `driven`
    // is written here and `updateRemote` carries the hull to it on the next
    // TICK, so any second sample that lands before that tick was measured
    // against the position of the one before it — two steps of ground over
    // one step of time, which is a REFUSAL by construction at anything over
    // 1.35x.
    //
    // **It needs no packet loss, no cheat and nothing wrong with the client
    // at all.** A sample goes out about every 55 ms and a tick runs every
    // 16.7, so anything that puts two arrivals into one turn of the event
    // loop does it: network jitter, a GC pause on the host, or the world
    // build a rotation spends 250 ms inside — and the round-over pause does
    // it wholesale, because `step` returns early while `rotating` and the
    // hull is not carried anywhere for the length of it.
    //
    // Every refusal costs the driver a `hullcorrect`, which ARRESTS the hull
    // (`Vehicle.correctTo` — right for the lid it was written for, and the
    // thing itself here), so what a legitimate tank felt was an invisible
    // wall it could push through a bit at a time. Measured by replaying a
    // real hull's own samples through both forms over an ordered network: a
    // tank at full throttle, zero jitter, 0 refusals either way; at 60 ms,
    // 2 of 300 against the hull and 0 against the claim; at 80 ms on
    // Harrowmead, 22 of 300 (21 speed, 1 climb) against 0; at 100 ms, 42 of
    // 300 against 0. The claim form refused nothing at any jitter, because
    // there is nothing left for jitter to disturb.
    //
    // **Nothing is given away by the swap.** The chain is the same one the
    // body's check walks — each accepted sample within reach of the accepted
    // sample before it, over the gap the client's own clock reports — and it
    // is now the ONLY thing the bound depends on, rather than that plus when
    // the tick happened to run.
    const from = this.game.reportedHull(player) ?? tank.position;
    const verdict = validateDrive(
      this.game.map,
      from,
      { x, y, z },
      dt,
      tank.spec.drive.maxSpeed,
      tank.climbRate,
      tank.spec.flight?.ceiling ?? null,
    );
    // Refused: the authority's hull is unchanged and the client is told to come
    // back to it, exactly as `onMove` answers a rejected body. The sequence
    // sent is the last one ACCEPTED, so the client knows which of its samples
    // survived. Read off `tank.position` and not off the verdict, because on
    // this branch the verdict's position is the one being thrown away.
    if (!verdict.ok) {
      this.send(peer, {
        t: "hullcorrect",
        tank: msg.tank,
        pos: [tank.position.x, tank.position.y, tank.position.z],
        seq: peer.seq,
        reason: verdict.reason!,
      });
      if (Math.abs(tank.position.y - y) > RESYNC_RISE) peer.resyncOwed = true;
      return;
    }

    peer.seq = msg.seq;
    // **A `resync` is the authority's to grant**: honoured — the crash test
    // rebases here (`reportedLanding.ts`, "A broken series") — only while a
    // correction that stopped this hull vertically is unanswered, and spent
    // by the first accepted drive that answers it. A client cannot rebase at
    // will, and the rebase it is granted still pays a touchdown.
    const resync = peer.resyncOwed && msg.resync === 1;
    if (resync) peer.resyncOwed = false;
    // The VERDICT's position and never the message's: a lid is accepted at the
    // boundary rather than where the client asked to be, and applying the claim
    // here would make the clamp a fiction the correction below then contradicts.
    // The LOOK rides with it onto the body — the chase camera's aim rather
    // than the gun's, and what the shell's cone is measured against (see
    // `DriveMessage.aimYaw`).
    this.game.submit(peer.slot, {
      t: "drive",
      x: verdict.x,
      y: verdict.y,
      z: verdict.z,
      yaw: msg.yaw,
      turretYaw: msg.tyaw,
      gunPitch: msg.gun,
      aimYaw: msg.aimYaw,
      aimPitch: msg.aimPitch,
      // The peer's BOUNDED clock (`onStamp`), which is what the crash test
      // measures a descent over (`src/sim/reportedLanding.ts`, "The clock") —
      // the interval between ACCEPTED samples, so a refused one between them
      // is simply a longer interval rather than a doubled rate. An honest
      // client's is its own stamp to the bit.
      time: (msg.time - peer.behind) / 1000,
      resync,
    });
    // Accepted, but not where they said. The step counts — `seq` has already
    // advanced — and the client is told where it actually ended up, which is
    // what makes a lid a wall the pilot can feel instead of a divergence that
    // grows for as long as they hold the stick against it.
    if (verdict.clamped) {
      this.send(peer, {
        t: "hullcorrect",
        tank: msg.tank,
        pos: [verdict.x, verdict.y, verdict.z],
        seq: msg.seq,
        reason: verdict.reason!,
      });
      // A ceiling lid stops the climb; the map's edge moves nothing vertical
      // and breaks nothing — a pilot landing against it is measured as usual.
      if (Math.abs(verdict.y - y) > RESYNC_RISE) peer.resyncOwed = true;
    }
  }

  /**
   * "Put me in that hull." The core re-derives every term of the offer
   * against its own copy and answers with a `seat` either way — the policy
   * (the swap, the offer, the named hull) is `SimCore`'s `mount`, one copy
   * for every host. This resolves the message's SHAPE and nothing else.
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
    this.game.submit(peer.slot, { t: "mount", tank: msg.tank, seat: want });
  }

  /**
   * "Let me out." Where the body lands is the core's, and so is the refusal
   * of a dismount the hull cannot set a body down from — see `SimCore`'s
   * `dismount` and the `seat` event.
   */
  private onDismount(peer: Peer): void {
    if (!this.game.players.has(peer.slot)) return;
    this.game.submit(peer.slot, { t: "dismount" });
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
    if (msg.seq <= peer.seq) return;
    if (player.seat !== msg.tank || player.crewSeat !== GUNNER) return;
    peer.seq = msg.seq;
    // The bearing, which is also the LOOK kept on the body — the chase
    // camera's aim, and what the machine gun's own cone is measured against,
    // exactly as `onDrive` keeps a driver's for the shell's.
    this.game.submit(peer.slot, { t: "gun", yaw: msg.myaw, pitch: msg.mpitch });
  }

  /**
   * A shell a client says it fired. The authority decides what it hit.
   *
   * `onShot`'s three gates, minus the one that does not apply: there is no
   * weapon slot to look up, because a hull has one gun. The RATE gate is
   * `onShot`'s bucket at the gun's `cooldown`, and it is the rate limit — the
   * hull's own reload is asked only with `HULL_EARLY` of slack, being a
   * spacing on the tick grid that would otherwise eat a shell a tick tight; the
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
    const interval = gun.cooldown * 1000;
    const gate = this.slots[peer.slot].shellGate;
    if (!gate.ready(now, interval)) return;
    // The cone, against where this driver last said they were LOOKING. It is
    // generous for `SHOT_CONE_COS`'s reason and then some: the gun is walking
    // toward the look at the turret's own rate, so the two legitimately differ
    // by a whole traverse — which is exactly why the shell is fired down the
    // gun's own axis below and not down this vector.
    if (!claimedDir(msg.dir, SHOT_DIR)) return;
    lookDir(player.yaw, player.pitch, CLAIM_LOOK);
    if (!withinCone(CLAIM_LOOK, SHOT_DIR, SHELL_CONE_COS)) return;
    // The origin, against the hull rather than the head. A client that could
    // name any origin could fire from inside somebody else's tank.
    if (!withinSlip(msg.origin, tank.center, SHELL_ORIGIN_SLACK)) return;

    // …and then nothing of the claim is used. The round goes down the
    // authority's own gun, from the authority's own muzzle, at the authority's
    // own reload — which is the whole security property, and the reason the
    // checks above bound a LIE rather than measure an aim. The bucket spends
    // only on a shell that LEFT, which is what `submit`'s answer says.
    if (this.game.submit(peer.slot, { t: "shell", early: HULL_EARLY })) gate.spend(interval);
  }

  /**
   * A round out of the cupola gun a client says it fired. `onShell`'s twin,
   * with the three gates sized for the other weapon.
   *
   * The RATE gate is the same bucket at the gun's `fireRate`, per ROUND rather
   * than per reload — and at nine a second it is the gate the minimum spacing
   * hurt most, 11 ms of slack being less than ordinary jitter. The CONE is
   * measured against the gunner's reported look, which for this seat is the
   * gun's own order — the
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
    const interval = 1000 / tank.spec.mg.fireRate;
    const gate = this.slots[peer.slot].mgGate;
    if (!gate.ready(now, interval)) return;
    if (!claimedDir(msg.dir, SHOT_DIR)) return;
    lookDir(player.yaw, player.pitch, CLAIM_LOOK);
    if (!withinCone(CLAIM_LOOK, SHOT_DIR, SHELL_CONE_COS)) return;
    if (!withinSlip(msg.origin, tank.center, SHELL_ORIGIN_SLACK)) return;
    // …and then nothing of the claim is used, which is `onShell`'s whole
    // security property one calibre down: the round goes down the authority's
    // own gun, from its own muzzle, at its own rate.
    if (this.game.submit(peer.slot, { t: "mg", early: HULL_EARLY })) gate.spend(interval);
  }

  /**
   * A rocket out of the tube, or a mine on the ground.
   *
   * The pouch is the SIMULATION's, exactly as the grenade pouch is, and the
   * core debits it only on an item that actually reached the world — the
   * refusal contract `AntiTankSystem` states, unchanged by arriving over a
   * socket. This side spends its rate bucket on the same condition, which is
   * what `submit`'s answer says.
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
    const held = this.slots[peer.slot];
    const kind = held.equipment;
    if (!kind) return;

    const now = Date.now();
    const interval = equipmentSetup(kind).shotInterval * 1000;
    const gate = held.ordnanceGate;
    if (!gate.ready(now, interval)) return;

    if (!withinSlip(msg.origin, player.eyePos, ORDNANCE_ORIGIN_SLACK)) return;

    ORDNANCE_AT.fromArray(msg.origin);
    if (kind !== "mine") {
      // The same cone a rifle round is bounded by, and for the same reason —
      // it stops a claimed rocket leaving backwards or through the shooter's
      // own feet, and it stops nothing else.
      if (!claimedDir(msg.dir, ORDNANCE_DIR)) return;
      lookDir(player.yaw, player.pitch, CLAIM_LOOK);
      if (!withinCone(CLAIM_LOOK, ORDNANCE_DIR, SHOT_CONE_COS)) return;
    }
    // A mine ignores the direction and lands where the origin says.
    const placed = this.game.submit(peer.slot, {
      t: "ordnance",
      kind,
      origin: ORDNANCE_AT,
      dir: ORDNANCE_DIR,
    });
    if (!placed) return;
    gate.spend(interval);
    // Heard as a shot is, so the fifteen other clients get the report and the
    // minimap reveal a launcher earns. A mine is silent on the wire for the
    // same reason it is nearly silent in the world — there is nothing to hear
    // and nothing to give away.
    if (kind === "rpg") this.noteFire(peer.slot);
  }

  private onReload(peer: Peer): void {
    const player = this.game.players.get(peer.slot);
    if (!player || !player.alive) return;
    const held = this.slots[peer.slot];
    const weapon = held.loadout;
    if (!weapon) return;

    const now = Date.now();
    const soonest = Math.min(weapon.reloadTime, SIDEARM_RELOAD) * 1000 * 0.9;
    if (now - held.lastReload < soonest) return;
    held.lastReload = now;
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
   * (`SimPlayer.seat` for a person, `VehicleCrew`'s pairing for a bot), and a
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

  /**
   * Who is in which slot, for the slots this round HAS.
   *
   * `fielded` and not `slots`: the table is the ceiling (forty-eight, so that a
   * rotation never renumbers anybody — see `server/Roster.ts`) and the round is
   * the map's, so on every map but Sarab two thirds of the table is bodies this
   * round does not field. A client draws one soldier and one scoreboard row per
   * slot it is told about, so sending them would put thirty-two names on the
   * board for bodies nobody can see, shoot or score against.
   *
   * The arrays indexed BY slot — `scores`, `pings` — are deliberately not
   * filtered the same way: a client indexes those with a slot number, and a row
   * for a slot nobody is in costs three zeros a few times a minute.
   */
  private broadcastRoster(): void {
    this.broadcast({ t: "roster", slots: this.roster.fielded() });
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
   * Starts one round trip to a peer, on its transport's own ping — the
   * WebSocket's ping frame, on the server.
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
    if (!peer.transport.open) return;
    if (peer.pingAt > 0) return;
    peer.pingAt = Date.now();
    peer.transport.ping();
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
    if (peer.transport.open) peer.transport.send(encode(msg));
  }

  private broadcast(msg: ServerMessage): void {
    const payload = encode(msg);
    for (const peer of this.peers.values()) {
      if (peer.transport.open) peer.transport.send(payload);
    }
  }
}
