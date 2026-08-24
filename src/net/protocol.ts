/**
 * net/protocol.ts — The wire format, and the ONLY module both the client and
 * the multiplayer server import.
 * Owns: every message shape, the tick/rate constants both sides must agree on,
 * and the slot/entity vocabulary. Pure types and plain constants — no Babylon,
 * no DOM, no `CONFIG`, nothing with a side effect. It is imported by a Node
 * process and by a browser, so anything that cannot run in both does not
 * belong here.
 * Invariants: the server is the authority for everything in a `Snapshot`; a
 * client may only ever ASK (`ClientMessage`), never assert. A client's claimed
 * hit is a hint the server re-resolves, never a fact — see `docs/multiplayer.md`.
 * Vectors cross the wire as plain `[x, y, z]` tuples rather than `Vector3`,
 * because `Vector3` is a Babylon class with private `_x` fields that neither
 * `JSON.stringify` nor a `DataView` encoder has any business knowing about.
 *
 * The one import in the file is a TYPE, and it is allowed for the reason the
 * ban above exists: `import type` is erased, so `ScoreKind` costs this module
 * no runtime edge to `CONFIG` while keeping the awards the wire can name and
 * the awards the game can pay a single declaration (`config/score.ts`).
 *
 * Encoding is JSON today. Every message is a flat object with short, fixed
 * fields precisely so that swapping in a binary encoder later is a change to
 * `encode`/`decode` and to nothing that calls them.
 */
import type { ScoreKind } from "../systems/ScoreBook";

/**
 * Protocol version. Bumped on any incompatible change; a mismatch is refused.
 *
 * 3 is spawn selection. It is a version bump rather than a silent addition
 * because the change is to who ACTS FIRST: a version-3 server deploys a person
 * only once they have asked, so a version-2 client — which never sends
 * `deploy` — would sit dead in a live match forever, alive on its own screen
 * and absent from everyone else's. Refusing it at the handshake turns that into
 * a sentence the lobby can print.
 */
export const PROTOCOL_VERSION = 3;

/**
 * The longest display name a client may claim, in characters.
 *
 * Here rather than in `CONFIG` because both ends need it: the server TRUNCATES
 * to it (a bound the client cannot talk its way past) and the lobby's name
 * field stops there, so what a player types is what they get rather than
 * something silently shortened on arrival.
 */
export const MAX_NAME_LENGTH = 20;

/**
 * How often the server steps the simulation.
 *
 * 60 rather than 30 because every round in this game is hitscan and the
 * authority re-resolves each one against rewound positions: the rewind can only
 * be as fine as the history, and 16 ms of granularity is half of 33 ms of
 * error on a strafing target. It is affordable — `npm run simulate` runs a
 * sixteen-bot round at roughly a thousand ticks a second on one core, so a live
 * match at 60 Hz costs a few percent of it.
 */
export const TICK_HZ = 60;

/**
 * How often the server broadcasts a snapshot. Must DIVIDE `TICK_HZ` — a
 * fractional ratio makes the broadcast alternate between two tick spacings, and
 * a client interpolating on the assumption of an even cadence renders that as a
 * limp.
 */
export const SNAPSHOT_HZ = 20;

/** How often a client uploads its own movement. */
export const INPUT_HZ = 20;

/**
 * How far behind the newest snapshot a client renders other entities.
 *
 * Two snapshots' worth plus a margin: interpolation needs a sample on each side
 * of the render time, so anything less than one interval guarantees
 * extrapolation on a perfect connection, and the margin absorbs jitter. This is
 * also the window the server rewinds through for hit validation, which is why
 * the two live in one constant rather than being tuned apart and drifting.
 */
export const INTERP_DELAY_MS = 100;

/** How much position history the server keeps per combatant, for rewind. */
export const REWIND_WINDOW_MS = 400;

/** A world position or direction on the wire. */
export type Vec3 = [x: number, y: number, z: number];

/** 0 = Valeguard, 1 = Redline — the same indices `CONFIG.teams` uses. */
export type NetTeam = 0 | 1;

// --- lobby ----------------------------------------------------------------

/**
 * One match as the lobby lists it.
 *
 * The only shape here that does NOT travel over the WebSocket — it is the body
 * of `GET /matches`, fetched before there is a socket at all. It lives in this
 * module anyway, because the rule is that a shape both ends must agree on is
 * declared once, and "the server writes it, the client parses it" is exactly
 * that. A client picks a row and sends its `id` back as `Join.matchId`.
 *
 * `slots` is on the wire rather than assumed to be sixteen: a client drawing
 * "3 / 16" from its own `CONFIG.bots.perTeam` would draw the wrong denominator
 * against a server built with a different one, and the row would be a lie in
 * the one place a player is choosing between servers.
 */
export interface MatchSummary {
  id: string;
  /** Which map is standing, so a lobby row can name it. */
  mapId: string;
  humans: number;
  slots: number;
  /**
   * `empty` — built, nobody in it, the world may already be disposed.
   * `live` — a round is being simulated.
   * `rotating` — the round ended and the next map is being built.
   */
  state: "empty" | "live" | "rotating";
}

/**
 * The body of `GET /matches`.
 *
 * It carries the server's protocol version even though every row is otherwise
 * about matches, because this is the FIRST thing a client asks and therefore
 * the cheapest place to discover a version mismatch. Learning it here means the
 * lobby can say "this server is running a newer build, reload" instead of
 * offering rows that all fail at the socket with a message nobody sees.
 */
export interface MatchList {
  protocol: number;
  /** True when the server will not create any more matches. */
  full: boolean;
  matches: MatchSummary[];
}

// --- roster ---------------------------------------------------------------

/**
 * Who is in a roster slot.
 *
 * The roster is a fixed 16 slots and a slot is never created or destroyed — it
 * only changes who feeds it. That is what makes "start without a full lobby"
 * and "backfill a leaver with a bot" the same mechanism rather than two.
 */
export type SlotOccupant =
  | { kind: "bot" }
  | { kind: "human"; peerId: string; name: string };

export interface SlotState {
  /** Stable index into the roster, 0..15. Also the entity id on the wire. */
  index: number;
  team: NetTeam;
  occupant: SlotOccupant;
}

// --- snapshots ------------------------------------------------------------

/**
 * One combatant as the client needs to draw it.
 *
 * Deliberately identical for a bot and a remote human: the client pools one
 * `NetSoldier` per slot and never learns which it is drawing. Everything that
 * differs between them is the server's problem.
 */
export interface EntityState {
  /** Roster slot index. */
  i: number;
  /** Feet. */
  p: Vec3;
  /** Where it looks, radians. */
  yaw: number;
  /** Where its feet point, radians — see `Bot`'s yaw/bodyYaw split. */
  bodyYaw: number;
  /** Torso pitch, radians. */
  pitch: number;
  /**
   * 0..1, how much of a walk cycle to play.
   *
   * The WEIGHT, not the phase. A client advances its own stride from this, so
   * the free-running cycle costs no bandwidth and cannot judder when a packet
   * is late — the leg is somewhere sensible either way.
   */
  moving: number;
  alive: boolean;
  /** Collapse tween progress, 0 while alive. */
  dead: number;
  /** Set on the tick it fired, for the muzzle flash and the tracer. */
  fired?: boolean;
  /**
   * Stance, 0 standing .. 1 fully crouched. Absent means standing, which is
   * most bodies most of the time — people and bots alike take the stance, and
   * both are sent the same way.
   *
   * **The authority's own blend, not the key a client is holding**, and that is
   * the point of sending a number rather than the boolean the client already
   * sends up. `NetPlayer` eases this exactly as `Player.syncCombatant` does,
   * and drops the eye and the hit sphere along it; a client draws the body from
   * the same number and puts its local copy of those spheres in the same place.
   * So what an observer aims at and what the server rewinds are the same shape
   * at the same instant, including halfway through the quarter-second the
   * stance takes to change. Sent as the boolean instead, every client would run
   * its own blend against the authority's and disagree with it for that whole
   * window — a 0.5 m disagreement about where a head is.
   *
   * Additive, like `fired` and `present`: an older client ignores it and draws
   * what it drew before the field existed, so no `PROTOCOL_VERSION` bump.
   */
  crouch?: number;
}

/**
 * One grenade in the air, as the client needs to draw it.
 *
 * **State and not an event**, which is the whole of the design here. A throw
 * announced once and simulated on each client would be sixteen ballistic
 * solves off one message — and they would not agree: the flight is integrated
 * per frame against a frame time nobody shares, and a bounce multiplies the
 * disagreement rather than damping it. The grenade would come to rest at your
 * feet on your screen and go off three metres away, because the blast is the
 * authority's and always has been. So the position is sent at the snapshot
 * cadence like everything else that moves, and interpolated behind the same
 * clock — see `net/NetGrenades`.
 *
 * Additive, like `fire` and `scores`: an older client ignores the field and
 * sees exactly what it saw before it existed, a newer client against an older
 * server draws nothing, and neither is a protocol break — hence no version
 * bump.
 */
export interface GrenadeState {
  /**
   * Names the FLIGHT, not a pool slot: monotonic on the server and never
   * reused, so a client can key a sample buffer on it. See `Grenade.id` in
   * `GrenadeSystem` for what reuse would draw.
   */
  i: number;
  p: Vec3;
  /**
   * The thrower's roster slot, or -1 for one nobody on the roster threw.
   *
   * On the wire so that the one client who must NOT draw this can tell: the
   * thrower has watched their own copy leave their own hand since the frame
   * they threw it, a round trip before this arrived, and drawing the
   * authority's as well would put two grenades in the air for one throw.
   */
  by: number;
  /**
   * Seconds of fuse left, so the pip blinks in step with the thrower's own —
   * see `pipLit`. It falls linearly, which is what makes lerping it between
   * two samples exact rather than merely close.
   */
  fuse: number;
}

/** A control point, mirrored onto the client's `ConquestSystem`. */
export interface PointState {
  id: string;
  owner: NetTeam | null;
  meter: number;
  contested: boolean;
  /**
   * Bodies inside the zone this tick, per team — the authority's count, for
   * the same reason the ping is: a client can see only what it is drawing,
   * and what it is drawing is a tenth of a second behind the tick that
   * decided `contested`.
   *
   * It carries no more than `contested` already does — that flag says both
   * sides are standing on the flag, and a snapshot puts every body's position
   * on every screen regardless — but three things on the client read
   * occupancy rather than the flag: the capture panel's enemy count, the
   * CAPTURING/LOSING word beside it, and the ring's capturing pulse. Without
   * it they read a `[0, 0]` no netplay frame ever writes, and the panel
   * announces a contest against nobody.
   *
   * Additive, like `fire` and `grenades`: an older client ignores it, and a
   * newer client against an older server counts the zero it counted before
   * the field existed — so no `PROTOCOL_VERSION` bump.
   */
  present?: [number, number];
}

export interface Snapshot {
  t: "snap";
  /** Server tick this was taken on. */
  tick: number;
  /** Server clock in ms, for the client's offset estimate. */
  now: number;
  entities: EntityState[];
  points: PointState[];
  tickets: [number, number];
  /**
   * Grenades in the air, and ABSENT when there are none — which is most ticks.
   * A snapshot goes out twenty times a second and a grenade is a rare thing,
   * so the empty array is worth not sending; a client reads the missing field
   * as "nothing is flying", which is also what an older server means by it.
   */
  grenades?: GrenadeState[];
}

// --- events ---------------------------------------------------------------

/**
 * Things that happen at an instant rather than being a state.
 *
 * Separate from the snapshot because a snapshot is lossy by design — a client
 * that misses one interpolates past it and loses nothing, whereas a missed kill
 * is a killfeed line that never appears. Events are queued per client and
 * cleared on acknowledgement.
 */
export type ServerEvent =
  /**
   * A body went down, whoever it belonged to and whoever put it there.
   *
   * `from` and `amount` are the killing blow's origin and size — the same pair
   * `damage` carries, and for the same reason on the far side: they are what a
   * client throws the corpse with. Without them every death would be a body
   * lifted straight up, because a zero-length direction is all
   * `RagdollSystem.applyImpulse` would have to work from. They are on the KILL
   * rather than on the snapshot because a death is an instant and a snapshot is
   * a state — sending a bearing every tick for the one tick it matters is the
   * trade this event type exists to avoid.
   *
   * Raised exactly once per death, for a bot and a person alike. `Match` is
   * where the two paths converge and where that "exactly once" is argued.
   */
  | {
      e: "kill";
      /**
       * The TEAM that killed, or **-1 for a death with no killer at all**.
       *
       * The team is derived rather than carried because friendly fire is
       * excluded by construction, so the side that killed a person is always
       * the other one. `world/leash.ts` is the one death that breaks the
       * premise instead of the derivation: nobody shot a player who walked out
       * of the map, and -1 is how the feed is told to say so rather than blame
       * the enemy for it. A client must guard before indexing `CONFIG.teams`.
       */
      killer: number;
      victim: number;
      headshot: boolean;
      from: Vec3;
      amount: number;
    }
  /**
   * A blow one player took: how big, which way it came from, and what it left
   * them on.
   *
   * **Addressed to the victim.** It is the only message in the protocol that
   * carries a health at all — see `docs/multiplayer.md` on why one is enough —
   * so broadcasting it published every player's exact pool to every client,
   * live, with the bearing they were shot from beside it. `victim` stays on the
   * wire and the client still checks it, for the reason `hit` below does.
   */
  | { e: "damage"; victim: number; amount: number; from: Vec3; health: number }
  /**
   * A round cracked past this client's own head without connecting.
   *
   * **Addressed to the victim**, and the most private thing in the protocol
   * after `damage`: it says a named player was very nearly hit, which is the
   * read a wallhack wants and is nobody's business but theirs. It carries no
   * victim field for that reason — the only client it is ever sent to is the
   * one it happened to, so there is nothing for a guard to compare. (`hit` and
   * `damage` keep theirs because they predate being addressed and an older
   * server still broadcasts them; nothing has ever broadcast this.)
   *
   * `at` is the round's point of CLOSEST APPROACH, which is what the crack past
   * an ear physically is — not the shooter, and not wherever the round
   * eventually stopped. Offline this is `CombatSystem.onNearMiss`'s third
   * argument, and it is the same number here: the authority is the only thing
   * in a match that resolves anybody else's rounds, so it is the only thing
   * that can say a round went past you. Without it a networked player has no
   * warning at all that the fire is meant for them.
   *
   * Additive: an older client has no case for it, a newer one against an older
   * server simply never hears one.
   */
  | { e: "nearmiss"; at: Vec3 }
  /**
   * A round the authority agrees landed — the shooter's own hitmarker, arriving
   * a round trip after the prediction it either claims or corrects.
   *
   * **Addressed to the shooter.** Everything not marked that way here is public
   * by nature: a client needs the kills, the captures and the blasts to draw the
   * same round as everyone else. This one is feedback about one person's
   * trigger, and broadcasting it handed every client a live feed of who was
   * hitting whom — including `killed`, which says a body is going down a tick
   * before the snapshot shows it. `Match` sends it to one peer; the client still
   * checks `shooter`, because the two halves deploy separately and an older
   * server broadcasts it with this same shape.
   */
  | { e: "hit"; shooter: number; victim: number; killed: boolean; headshot: boolean }
  | { e: "died"; slot: number; by: number; respawnIn: number }
  /**
   * A weapon went off in this slot. Public, and the only thing on the wire that
   * says a shot was fired at all.
   *
   * It carries a slot and no POSITION, and that is still right now that the
   * client makes a noise out of it as well as a minimap reveal: where that body
   * is has already arrived in the snapshot every client holds, so a position
   * here would be a second copy of one on a different clock, and the report
   * would come from somewhere the rifle visibly is not. Placing the sound on the
   * body being drawn makes the two agree by construction. A client cannot reach
   * either rule on its own, because the trigger was pulled by an AI it does not
   * run or by a person it never hears from.
   *
   * **One event per slot per snapshot, carrying `n` — the rounds that slot fired
   * during the interval.** The coalescing is what keeps the wire cost bounded by
   * the roster instead of by the rate of fire (sixteen automatic weapons at 600
   * rpm would otherwise be ten times the traffic), and the count is what stops
   * that costing the report its rate: a reveal is a timer being refreshed, so
   * one event is as good as three, but a burst the player is supposed to place
   * by ear is three shots and has to sound like three. Absent means one, which
   * is what an older server means by it and what all but the fastest weapons
   * produce.
   *
   * `n` is bounded by construction rather than by a clamp on the wire: a slot
   * may fire at most once per tick (`Match.onShot`'s rate gate for a person, one
   * shot per think for a bot), so it can never exceed `TICK_HZ / SNAPSHOT_HZ`.
   * A client that spends it in a loop should still bound it there — the number
   * came off a socket.
   *
   * Additive: a client that has never heard of it ignores it, and a new client
   * against an older server simply gets no reveals, so this arrived without a
   * `PROTOCOL_VERSION` bump.
   *
   * `w` is what this slot is HOLDING, and it is here because a report is the
   * one thing on the wire that says what somebody is carrying before they hit
   * you with it. A client voices the shot through `CONFIG.weapons[w].report`,
   * so a DMR two streets away does not sound like the SMG beside you. Absent
   * means the flat round every bot fires off the same rig — which is also what
   * an older server means by it, and what a slot that has left between the
   * trigger and the snapshot leaves behind — so this too is additive and
   * needed no version bump.
   *
   * A STRING rather than an index, and resolved against the client's own
   * weapon table exactly as `Join.weapon` is resolved against the server's: an
   * id one side has never heard of has to degrade to the flat round rather
   * than index a table with it.
   */
  | { e: "fire"; slot: number; n?: number; w?: string }
  /**
   * This slot is working its magazine. Public, like `fire` and for the same
   * reason: knowing WHICH of the enemies in front of you has just gone dry is
   * the cue to push, and offline it is a sound every bot makes.
   *
   * It carries `w` for `fire`'s reason and to sharpen exactly that cue: a
   * mechanism is voiced by the weapon it belongs to, so the sound says whether
   * the window is the pistol's third of a second or the LMG's three and a
   * half. Same optionality, same fallback, same absence of a version bump.
   *
   * Rare — a few per player per minute — so it is one event per reload rather
   * than anything coalesced, and it carries a slot for the same reason `fire`
   * does: the body it belongs to is already being drawn.
   *
   * A bot reaches this through `BattleSystem.onBotReloaded`, which only the
   * authority runs. A person reaches it through the `reload` message they send,
   * which is the one thing in this protocol a client announces about itself with
   * nothing for the server to re-derive — see `ReloadMessage`.
   */
  | { e: "reload"; slot: number; w?: string }
  | { e: "explode"; at: Vec3 }
  /**
   * Panes of glass that just went in, by their index in `GameMap.panes`.
   *
   * **The index is the identity, and it is an identity because both sides build
   * the pane list in the same order** — placements in layout order, each
   * placement's panes in the order its builder declared them. The client gets
   * that order from `MapBuilder`; the authority gets it from the collision
   * bake, which is written FROM a client build. `npm run parity` is what proves
   * they still agree.
   *
   * It carries the crossing point and the round's direction as well, because
   * the shards are thrown from them and the authority is the only side that
   * knows where the round actually was. Without the pair a remote break is a
   * pane vanishing with a puff of glass going straight up.
   *
   * An ARRAY rather than one per pane: a round crosses everything in its path,
   * so a shot down a glazed street breaks several at once and they share a
   * direction by construction. `at` is the FIRST crossing — the shards of the
   * ones behind it are thrown from a point a few metres off, which is a
   * wrongness measured in metres on an effect that lasts a second and a half,
   * against a message per pane on the wire.
   *
   * Additive: a client that has never heard of it ignores it, and a new client
   * against an older server simply sees glass that never breaks. Neither is a
   * protocol break, so this arrived without a `PROTOCOL_VERSION` bump.
   */
  | { e: "glass"; panes: number[]; at: Vec3; dir: Vec3 }
  /**
   * THIS client was just paid for something. Addressed to the earner, and to
   * nobody else.
   *
   * The receipt behind the score feed, and it is a message rather than a
   * derivation for the reason the board itself is state on the wire: a client
   * runs none of the fight, so it cannot know that the body it just shot was
   * standing on a flag its side does not hold. It could diff the totals in the
   * next `ScoresMessage` and would get the NUMBER right and the reason wrong —
   * "+150" once, instead of a kill and the attack that earned the bonus.
   *
   * Addressed rather than broadcast, on the rule `hit` and `nearmiss` follow:
   * it is feedback about one player's own round, and sixteen clients hearing
   * every award anybody earns is a live feed of who is doing what and where.
   * There is no slot on it, for `nearmiss`'s reason exactly — the only client
   * it is ever sent to is the one it happened to.
   *
   * The authority sends one per award, so a headshot on an attacker inside a
   * contested zone is three of these — the itemisation IS the feature, and
   * folding them into a total on the wire would be the client-side diff this
   * message exists to avoid. The rate is bounded by how often a person kills.
   *
   * Additive: an older client has no case for it and simply shows no feed,
   * while its board still fills in from `scores`.
   */
  | { e: "score"; kind: ScoreKind; points: number }
  | { e: "captured"; point: string; by: NetTeam }
  | { e: "neutralised"; point: string }
  | { e: "spawn"; slot: number; pos: Vec3; yaw: number }
  | { e: "roundover"; winner: NetTeam };

// --- server -> client -----------------------------------------------------

export interface Welcome {
  t: "welcome";
  version: number;
  matchId: string;
  /** The slot this client owns. */
  slot: number;
  team: NetTeam;
  mapId: string;
  now: number;
  /**
   * Every pane already broken in this round, by index — STATE, not the events
   * that produced it, and for `ScoresMessage`'s reason exactly.
   *
   * Broken glass is cumulative and permanent within a round, so a client that
   * joined five minutes in has missed every `glass` event and would otherwise
   * see intact shopfronts everyone else has shot out — and, since every pane
   * that breaks is a way into a building, would be held out of one the rest of
   * the match walks through. Sending the list means a joiner is right on
   * arrival and a dropped event is corrected by the next reconnect.
   *
   * Absent from an older server, which reads as a round with no broken glass.
   * It is deliberately NOT on `RoundStart`: a new round rebuilds the map, which
   * puts every pane back, so the empty list is the only correct answer there
   * and saying nothing is how it is said.
   */
  brokenPanes?: number[];
}

export interface RosterMessage {
  t: "roster";
  slots: SlotState[];
}

/**
 * A new round has started on this map, with the same people in the same slots.
 *
 * Distinct from `welcome` on purpose. An earlier draft broadcast a `welcome`
 * with `slot: -1` to announce a rotation, which every client would have taken
 * literally — `NetSession` assigns its own slot straight out of that field, so
 * one message meant to say "new map" would have told sixteen clients they no
 * longer had a body.
 */
export interface RoundStart {
  t: "roundstart";
  mapId: string;
  now: number;
}

/**
 * The server moving a client that reported an impossible position.
 *
 * Not a general correction channel: movement is client-simulated and trusted
 * within tolerance, so this fires only when the validator has actually rejected
 * something. A client that receives one has been snapped.
 */
export interface Correction {
  t: "correct";
  pos: Vec3;
  /** The last input sequence the server accepted before rejecting. */
  seq: number;
  reason: "speed" | "ground" | "solid";
}

export interface EventsMessage {
  t: "events";
  events: ServerEvent[];
}

export interface Rejected {
  t: "rejected";
  reason: string;
}

/**
 * The round's scoreboard: points, kills and deaths for every slot, in slot
 * order.
 *
 * **State, not events, and that is the whole design.** A client could add up
 * the `kill` events instead, and it would be wrong within a minute — events are
 * a queue a reconnect drops, a spectator joining mid-round has missed every one
 * of them, and `kill` names the killer's TEAM rather than the body that did it,
 * because the killfeed only ever needed a side. Sending the table means a
 * missed message is corrected by the next one and a joiner is right on arrival.
 *
 * **Sent only when it changes**, which is a few times a minute rather than
 * twenty times a second: `Match` compares `HeadlessGame.scores.version` against
 * what it last sent, on the same tick the snapshot goes out. Thirty-two numbers
 * on a snapshot that carries none of them is the trade the `fire` event makes
 * next door — the wire says a thing once rather than repeating it at the
 * simulation's cadence.
 *
 * All three arrays are indexed by slot and always the full roster's length, so
 * a client indexes them with the same number it indexes everything else with.
 * Deaths are counted at the victim's door and kills at the killer's, once each
 * — see `HeadlessGame.creditKill`.
 *
 * Additive, like `fire`: an older client ignores a message type it has no case
 * for, and a newer client against an older server simply shows a board of
 * zeros. Neither is a protocol break, so this arrived without a version bump.
 */
export interface ScoresMessage {
  t: "scores";
  kills: number[];
  deaths: number[];
  /**
   * What each slot has been PAID — kills, the bonuses on them and the flags —
   * against `config/score.ts`, which both sides read.
   *
   * Optional for the reason `fire`'s `n` is: it arrived after the message did,
   * and the two images deploy separately. A server old enough not to send it
   * leaves a client showing a score column of zeros beside kills and deaths
   * that are right, which is a board that is missing a column rather than one
   * that is wrong — and the alternative, bumping `PROTOCOL_VERSION`, would
   * refuse the match outright over a number nothing in the simulation reads.
   *
   * The client never adds these up for itself, exactly as it never adds up the
   * kills: an award is decided where the fight is simulated, and a client
   * that inferred one from the events it happened to receive would show a
   * different board on every screen.
   */
  points?: number[];
}

/**
 * How long the round trip to each seated peer is, in milliseconds, in slot
 * order.
 *
 * **Measured by the authority and stated by it, for the same reason the
 * scoreboard is.** A ping is a fact about a connection to the server, and only
 * the server is on both ends of every one of them: a client can time its own
 * round trip and has no way at all to learn anybody else's, so a board where
 * every row but yours was blank is what a client-measured version buys. It is
 * measured with the WebSocket's own ping/pong frames rather than with a message
 * pair invented here — a browser answers those from its network stack without
 * waking its JavaScript, so the number is about the connection rather than about
 * how busy the far end's page is, and nothing is added to `ClientMessage` for a
 * client to get wrong or to lie about.
 *
 * Indexed by slot and always the full roster's length, like `ScoresMessage`, and
 * **-1 for a slot with nobody on a connection in it** — every bot, and a slot
 * whose peer has not answered its first ping yet. A client reads -1 as "there is
 * no ping here", never as a fast one.
 *
 * Sent on a fixed cadence (about once a second) rather than when it changes,
 * which is the opposite of `scores` and deliberately so: a score moves a few
 * times a minute and a latency moves on every sample, so "when it changes" would
 * mean every time. Sixteen small numbers a second is nothing beside a snapshot
 * stream of twenty a second.
 *
 * Additive, like `fire` and `scores`: an older client ignores a message type it
 * has no case for and a newer client against an older server shows a board with
 * no ping column filled in, so this arrived without a version bump.
 */
export interface PingsMessage {
  t: "pings";
  ms: number[];
}

export type ServerMessage =
  | Welcome
  | RoundStart
  | RosterMessage
  | Snapshot
  | EventsMessage
  | ScoresMessage
  | PingsMessage
  | Correction
  | Rejected;

// --- client -> server -----------------------------------------------------

export interface Join {
  t: "join";
  version: number;
  /**
   * What to call this player.
   *
   * Truncated and stripped on arrival, never trusted as sent — it is the one
   * client-supplied string that other people's screens render, so it is bounded
   * on the authority's side for the same reason the weapon id below is resolved
   * there. See `MAX_NAME_LENGTH`.
   */
  name: string;
  /**
   * Which match to join, from a `MatchSummary.id` the lobby listed.
   *
   * Absent means "put me wherever there is room", which is what `?mp` on the
   * URL does and what a client with no lobby has always done. Naming a match
   * that has since filled or been disposed is REFUSED rather than redirected:
   * a player who picked a specific row and silently landed somewhere else has
   * been lied to, and the lobby can simply refresh and show why.
   */
  matchId?: string;
  /**
   * Start a NEW match rather than filling one that has room.
   *
   * Only consulted when `matchId` is absent — naming a match and asking for a
   * fresh one are contradictory, and the named one wins because it is the more
   * specific request. Bounded by the server's match cap, so this is a request
   * and not an instruction.
   *
   * It exists because "there is room somewhere" and "I want to play there" are
   * different questions. A lobby showing a half-full round on a map you do not
   * want needs a way past it that is not waiting for sixteen strangers.
   */
  create?: boolean;
  /**
   * The map a NEW match should be started on.
   *
   * A request and only that. It is consulted when this join CREATES a match and
   * ignored entirely when it lands in one that already exists — a match's map is
   * a fact about the match, and sixteen people are already standing in it. So a
   * client sends its preference on every join and the server spends it or drops
   * it; what a client must never do is take its own answer, which is the bug
   * this field was added to fix (a lobby join built whatever the menu had
   * selected while the authority ran something else).
   *
   * Resolved against the server's own `MAPS` table exactly as the weapon id is,
   * and an id it has never heard of falls back to the default rather than being
   * refused. Additive: a server that has never heard of the field creates on its
   * default map, which is what every client got before this existed.
   */
  map?: string;
  /**
   * The primary weapon this client wants to carry.
   *
   * The SERVER resolves this to damage and range, and validates it against the
   * real weapon table before it does — a client that names an unknown weapon,
   * or the sidearm, gets the default. Damage numbers must never travel on the
   * wire: a client that could state its own would state whatever it liked.
   */
  weapon?: string;
}

/**
 * One movement sample. Sent at `INPUT_HZ`, validated on arrival.
 *
 * The client simulates its own `Player` exactly as it does offline and reports
 * where it ended up; the server checks the step is physically possible and
 * keeps it, or rejects and corrects. There is no input replay here — see
 * `docs/multiplayer.md` for why that trade was taken.
 */
export interface MoveMessage {
  t: "move";
  /** Monotonic per client, so a correction can name what it rejected. */
  seq: number;
  /** Client clock in ms when this was sampled. */
  time: number;
  pos: Vec3;
  yaw: number;
  pitch: number;
  crouching: boolean;
  sprinting: boolean;
}

/**
 * A round the client believes it fired.
 *
 * `time` is the client's RENDER time — what it was actually looking at, which
 * is `INTERP_DELAY_MS` behind the newest snapshot it holds. The server rewinds
 * every target to that instant before re-running the ray, so a shot at a
 * moving enemy lands where the shooter saw them and not where they now are.
 *
 * There is deliberately no victim field. An earlier draft had one and the
 * server checked it for plausibility; naming the victim at all invites
 * validating the claim instead of re-deriving the answer, and re-deriving it is
 * the entire security property.
 */
export interface ShotMessage {
  t: "shot";
  seq: number;
  /** Client render time in ms — what the shooter was looking at. */
  time: number;
  origin: Vec3;
  /**
   * The direction the round ACTUALLY flew, spread already applied.
   *
   * Not the clean aim: `CombatSystem.fire` jitters internally, and the server
   * cannot reproduce the client's roll of that dice — so it fires with a spread
   * of zero along this vector instead, and both sides resolve the same bullet.
   * The trust that buys is bounded by a cone check against the shooter's last
   * reported view angles, which is what stops a client claiming a round fired
   * backwards or through its own feet.
   */
  dir: Vec3;
  /** Which of the two carried weapons, so the server reads the right damage. */
  slot: number;
}

export interface GrenadeMessage {
  t: "grenade";
  seq: number;
  time: number;
  origin: Vec3;
  dir: Vec3;
}

/**
 * Where this client would like to come back in.
 *
 * Sent when the player confirms a spawn on the deploy screen, and it is the
 * only thing that puts a person into the world: the authority holds a dead
 * player at the end of their reinforcement wait until one of these arrives.
 *
 * `spawn` is an index into the MAP's own spawn table — `GameMap.spawns`, the
 * layout module both sides build from — and never into the list the deploy
 * screen happens to be showing. That list is derived from flag ownership and
 * changes as the round does, so an index into it means one thing on the client
 * and another on the server the moment a flag falls between the two. An index
 * into the layout is a name that cannot drift, and the server still validates
 * it against what it would offer that team RIGHT NOW — a spawn behind a flag
 * this player's side no longer holds is refused and the authority picks
 * instead, exactly as it does for a bot.
 */
export interface DeployMessage {
  t: "deploy";
  /** Index into `GameMap.spawns` — see above; not an index into the offer. */
  spawn: number;
}

/**
 * "I have started a reload", so the fifteen other clients can hear it.
 *
 * The one message in this protocol that announces something the authority has
 * no way to re-derive, and it is worth being plain about why that is acceptable
 * here and nowhere else: a reload decides NOTHING. Ammunition is the client's
 * own — a magazine is not on the wire, and the only thing the server counts is
 * grenades — so this cannot buy the sender a round, a position or a hit. What
 * it buys is a noise on somebody else's machine, and the cost of getting it
 * wrong is that a noise happens or does not.
 *
 * It carries no fields at all. `Match` knows which peer sent it, the weapon it
 * would be reloading, and how long that takes, so everything a handler could
 * read off this message is something the server already has a better copy of —
 * and a rate gate derived from the real reload time is what stops a client
 * turning it into a noise generator.
 *
 * A client that simply never sends it is silent while reloading, which is a
 * small advantage nothing here can take away — see the list of what is not
 * defended against in `docs/multiplayer.md`.
 *
 * Additive in both directions and so no version bump: an older server refuses
 * an unknown `t` in `readClientMessage` and drops the frame, and an older
 * client never sends one.
 */
export interface ReloadMessage {
  t: "reload";
}

export type ClientMessage =
  | Join
  | MoveMessage
  | ShotMessage
  | GrenadeMessage
  | ReloadMessage
  | DeployMessage;

// --- encoding -------------------------------------------------------------

/**
 * The one place a message becomes bytes.
 *
 * JSON for now. At sixteen entities and `SNAPSHOT_HZ` that is roughly 40 KB/s
 * per client, which is affordable and legible in a devtools frame inspector —
 * worth a great deal while the protocol is still moving. Both functions are
 * deliberately the only encoding site so the swap to a `DataView` is local.
 */
export function encode(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg);
}

/** Returns null on anything that is not a well-formed message. */
export function decode(raw: string): ServerMessage | ClientMessage | null {
  try {
    const msg = JSON.parse(raw);
    return typeof msg === "object" && msg !== null && typeof msg.t === "string"
      ? msg
      : null;
  } catch {
    return null;
  }
}
