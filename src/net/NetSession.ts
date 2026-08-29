/**
 * net/NetSession.ts — A networked round, from the client's side.
 * Owns: the `Connection`, the `NetRoster`, the `NetGrenades` pool, the movement
 * upload clock, and the translation of server messages into the callbacks
 * `Game` wires. It is the single seam between the game and the wire.
 * Invariants: `Game` talks to this and never to a socket; this talks to the
 * socket and never to a game system it was not handed. It decides nothing about
 * the round — every outcome here arrived from the authority.
 *
 * It exists so that `Game` gains a field and a branch rather than a protocol.
 * The offline path is untouched: with no session, `updateWorld` runs
 * `ConquestSystem` and `BattleSystem` exactly as it always has, and nothing in
 * this file is constructed at all.
 *
 * **Movement is uploaded, not commanded.** The local `Player` simulates itself
 * exactly as it does offline and this reports where it ended up at `INPUT_HZ`.
 * The server validates and, when it refuses, sends a correction — which is the
 * only thing that ever moves the local body from outside. See
 * `docs/multiplayer.md`.
 */
import { Scene, Vector3 } from "@babylonjs/core";
import type { Team } from "../entities/Combatant";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { ControlPoint } from "../systems/ConquestSystem";
import { Connection, type ConnectionState, type JoinOptions } from "./Connection";
import { NetGrenades } from "./NetGrenades";
import { NetOrdnance } from "./NetOrdnance";
import { NetRoster } from "./NetRoster";
import { NetVehicles } from "./NetVehicles";
import {
  INPUT_HZ,
  type ServerEvent,
  type ServerMessage,
  type SlotState,
} from "./protocol";

const UPLOAD_INTERVAL = 1 / INPUT_HZ;

/** What the local player looks like this frame, for the upload. */
export interface LocalState {
  /**
   * FEET — `Player.position`, never the collider capsule's centre. Every
   * consumer downstream (the validator, the rewind, the other clients' bodies)
   * builds upward from this `y` and takes it as the ground the player stands
   * on. See `Player.position` for what a half-body of error does to all three.
   */
  position: Vector3;
  yaw: number;
  pitch: number;
  crouching: boolean;
  sprinting: boolean;
  /**
   * The hull this player is DRIVING, or null on foot and null on the gun.
   *
   * Non-null for exactly as long as `Game.driving` is AND the player is in the
   * driver's seat, which is what makes the upload's three branches one fact
   * rather than flags that can disagree: a driver has no body of their own to
   * report because the tank carries them, and a GUNNER has neither a body nor
   * a hull — see `gun` below.
   */
  hull: LocalHull | null;
  /**
   * …and the cupola gun this player is LAYING, or null when they are not on
   * one. Mutually exclusive with `hull` by construction: `Game.localHull` and
   * `Game.localGun` read the same seat and exactly one of them can answer.
   */
  gun: LocalGun | null;
}

/** One driven hull, as the upload needs it. `Vehicle`'s own fields, by reference. */
export interface LocalHull {
  /** The hardstanding index — the hull's identity on the wire. */
  tank: number;
  position: Vector3;
  yaw: number;
  turretYaw: number;
  gunPitch: number;
}

/**
 * One laid cupola gun, as the upload needs it. `LocalHull`'s twin, and it
 * carries an ANGLE where that carries a position — see `GunnerMessage`: a
 * gunner moves nothing, so the only thing about the world he decides is where
 * one gun points.
 */
export interface LocalGun {
  tank: number;
  yaw: number;
  pitch: number;
}

export class NetSession {
  readonly conn = new Connection();
  readonly roster: NetRoster;

  /**
   * Everybody else's grenades, in the air. The one thing the authority sends
   * that is neither a body nor a fact about the round — see `NetGrenades` for
   * why it is state on the wire and not a throw announced once.
   */
  readonly grenades: NetGrenades;

  /**
   * Everybody else's armour, and every hull nobody is in. The one thing on the
   * wire that is a moving `solid` mesh — see `NetVehicles`.
   */
  readonly vehicles = new NetVehicles();

  /** …and the anti-tank kit: rockets in the air, mines on the ground. */
  readonly ordnance: NetOrdnance;

  /** The roster slot this client owns, or -1 before the welcome lands. */
  slot = -1;
  team: Team = 0;
  mapId = "";

  /** True once the welcome has arrived and the round is ours to play. */
  seated = false;

  /**
   * Who is in each slot, as the last roster message said.
   *
   * Kept here rather than in `NetRoster` because it is not about drawing
   * anybody: that class deliberately reads a roster only to find out which body
   * to stop rendering, and everything else about an occupant is invisible to
   * it — a bot and a person are the same object on screen and must stay that
   * way. The one screen that does need to tell them apart is the scoreboard,
   * which is naming rows rather than drawing bodies, and this is what it reads.
   */
  slots: readonly SlotState[] = [];

  /**
   * The round's board, indexed by slot, as the authority last stated it.
   *
   * Mirrored rather than counted, exactly like `tickets`. A client sees only
   * the kill events it was connected for — and `kill` names a killer's team
   * rather than the body — so anything added up here would be a different board
   * on every screen and would start a joiner's round at zero-all. Both arrays
   * are empty until the first `scores` message, which the server sends on
   * arrival and then only when the table moves; a row that has not arrived
   * reads as 0.
   */
  readonly slotKills: number[] = [];
  readonly slotDeaths: number[] = [];
  /**
   * What each slot has been paid this round, mirrored from the same message.
   *
   * Empty against a server too old to send the column, which the board reads
   * as a row of zeros — see `ScoresMessage.points`.
   */
  readonly slotScores: number[] = [];

  /**
   * The round trip to each slot's peer in ms, as the authority last measured
   * it, and -1 wherever there is no connection to measure — every bot, and a
   * peer whose first ping has not come back.
   *
   * Mirrored like the board next door, and for a sharper version of the same
   * reason: this client can time its own round trip and has no way whatsoever
   * to learn anybody else's, so a locally-measured column would be your own row
   * and fifteen blanks. See `PingsMessage`.
   */
  readonly slotPings: number[] = [];

  /** Wired by Game: the server has placed us. */
  onSpawn: (pos: Vector3, yaw: number) => void = () => {};
  /** Wired by Game: the server rejected our position and this is the truth. */
  onCorrection: (pos: Vector3, reason: string) => void = () => {};
  /** Wired by Game: an event worth showing — a kill, a capture, a round ending. */
  onEvent: (event: ServerEvent) => void = () => {};
  /** Wired by Game: the connection came up or went away. */
  onStateChange: (state: ConnectionState) => void = () => {};
  /** Wired by Game: the server refused the handshake, and this is why. */
  onRejected: (reason: string) => void = () => {};
  /** Wired by Game: a new round has begun on this map. */
  onRoundStart: (mapId: string) => void = () => {};

  /**
   * Wired by Game: the welcome landed, and this is the side we are on.
   *
   * The one thing in the welcome the client cannot work out for itself.
   * `Roster.claim` seats the second human on team 1, so a client that assumes
   * team 0 reads every mine/theirs question in the game backwards — its flags,
   * its ticket strip, its minimap and the colours its own corpse falls in.
   *
   * It is RAISED and not merely stored because the welcome can arrive on
   * either side of the local map build: `joinMatch` books the round before the
   * socket is open. `Game.buildRound` reads `team` off this class when the
   * welcome was early; this is how it hears about it when it was late.
   */
  onSeated: (team: Team) => void = () => {};

  /**
   * The panes already broken when this client was seated.
   *
   * A FIELD rather than a callback argument, and for the same reason `team` is
   * raised as well as stored: the welcome can arrive on either side of the
   * local map build. Applied too early it would be written into a `GameMap`
   * that `installMap` is about to replace, and applied only on the edge it
   * would be missed whenever the welcome was the first of the two. `Game` reads
   * it in both places and `GlassSystem.catchUp` is idempotent, which is what
   * makes doing it twice correct rather than merely harmless.
   *
   * It is the running list for the whole round rather than a snapshot of the
   * welcome: every `glass` event appends to it as well as being shown, because
   * `installMap` resets `GlassSystem` and an event that arrived between the
   * welcome and the local build would otherwise be applied to a map about to be
   * replaced. See the `events` case.
   *
   * Cleared on `roundstart`: a rotation rebuilds the map and puts every pane
   * back, so last round's list is the one thing that must not survive it.
   */
  brokenPanes: number[] = [];

  /**
   * The live control points, kept as a field because a snapshot arrives on a
   * socket callback rather than on a frame — there is no call stack to thread
   * them down. `update` refreshes the reference every frame.
   */
  private points: ControlPoint[] = [];

  private uploadT = 0;
  private seq = 0;
  private readonly scratch = new Vector3();

  constructor(scene: Scene, mats: CelMaterialFactory) {
    this.roster = new NetRoster(scene, mats);
    this.grenades = new NetGrenades(scene, mats);
    this.ordnance = new NetOrdnance(scene, mats);
    this.conn.onStateChange = (s) => this.onStateChange(s);
    this.conn.onMessage = (msg) => this.receive(msg);
  }

  /**
   * Everything in `opts` is passed straight through and not kept here:
   * `Connection` holds it so a RECONNECT re-sends the same loadout and asks for
   * the same match, and a second copy in this class would be one that could
   * disagree with what is actually on the wire.
   */
  connect(opts: JoinOptions): void {
    this.conn.connect(opts);
  }

  /** Which match we are in, once the server has said. Empty before that. */
  matchId = "";

  /**
   * One frame of a networked round: draw everybody else, then report ourselves.
   *
   * `points` are the client's own `ControlPoint` objects, mutated in place —
   * `CaptureZoneSystem`, `HUD` and `Minimap` all hold references to them, so
   * they are updated rather than replaced.
   */
  update(
    dt: number,
    local: LocalState,
    points: ControlPoint[],
    cameraPos: Vector3,
    alive: boolean,
  ): void {
    this.points = points;
    // One render time for both, read once: the bodies and the grenades between
    // them are the same instant of the same round, and two calls to a clock
    // that moves would draw a grenade a hair ahead of the man it is landing on.
    const renderTime = this.conn.renderTime();
    this.roster.update(renderTime, cameraPos);
    this.grenades.update(renderTime);
    // The hulls and the AT kit, on the SAME render time as the bodies for the
    // reason the grenades share it: a tank, the man beside it and the rocket
    // coming at it are one instant of one round, and three reads of a clock
    // that moves would draw them at three.
    this.vehicles.update(renderTime);
    this.ordnance.update(renderTime);

    if (!this.seated || !alive) return;
    this.uploadT += dt;
    if (this.uploadT < UPLOAD_INTERVAL) return;
    this.uploadT = 0;
    // **A driver reports their HULL and not their body**, and the two are
    // exclusive — see `DriveMessage`. `local.hull` is non-null for exactly as
    // long as `Game.driving` is, so this branch and the seat are one fact.
    if (local.hull) {
      const h = local.hull;
      this.conn.send({
        t: "drive",
        seq: ++this.seq,
        time: Date.now(),
        tank: h.tank,
        pos: [h.position.x, h.position.y, h.position.z],
        yaw: h.yaw,
        tyaw: h.turretYaw,
        gun: h.gunPitch,
        // The chase camera's own aim, which is the ORDER the turret is walking
        // toward rather than where the gun has got to. It is what the shell's
        // cone is measured against on the far side.
        aimYaw: local.yaw,
        aimPitch: local.pitch,
      });
      return;
    }
    // **A gunner reports one BEARING and nothing else**, and it replaces the
    // `move` below for the driver's own reason: the hull carries him, so a
    // body sample would be one person in two places. Which of the three
    // branches is taken is the SEAT and never a mode — see `LocalState.gun`.
    if (local.gun) {
      const g = local.gun;
      this.conn.send({
        t: "gunner",
        seq: ++this.seq,
        time: Date.now(),
        tank: g.tank,
        myaw: g.yaw,
        mpitch: g.pitch,
      });
      return;
    }
    this.conn.send({
      t: "move",
      seq: ++this.seq,
      // The CLIENT clock, deliberately. The server measures the gap between two
      // of our samples to decide what step was possible, and both readings have
      // to come off the same clock for that difference to mean anything.
      time: Date.now(),
      pos: [local.position.x, local.position.y, local.position.z],
      yaw: local.yaw,
      pitch: local.pitch,
      crouching: local.crouching,
      sprinting: local.sprinting,
    });
  }

  /**
   * Reports a round this client just fired.
   *
   * `dir` must be the direction the bullet ACTUALLY flew — spread already
   * applied — because the server fires with zero spread along it. Sending the
   * clean aim instead would resolve a different bullet from the one the player
   * watched leave the barrel.
   *
   * `renderTime` is what the shooter was looking at, not now: other bodies are
   * drawn `interpDelay` in the past, so that is the instant the server has to
   * rewind them to for the crosshair to have meant anything.
   */
  sendShot(origin: Vector3, dir: Vector3, weaponSlot: number): void {
    if (!this.seated) return;
    this.conn.send({
      t: "shot",
      seq: ++this.seq,
      time: this.conn.renderTime(),
      origin: [origin.x, origin.y, origin.z],
      dir: [dir.x, dir.y, dir.z],
      slot: weaponSlot,
    });
  }

  /**
   * Announces a reload, so the people around this player can hear one.
   *
   * The one thing this client tells the authority about itself that the
   * authority has no way to re-derive, and it is safe to be exactly that
   * because it decides nothing: a magazine is the client's own, so this cannot
   * buy a round, a position or a hit — only a noise on somebody else's machine.
   * The server bounds the rate against the real reload times; see
   * `ReloadMessage` and `Match.onReload`.
   *
   * Fire-and-forget, unlike `sendDeploy`: a reload that was dropped by a socket
   * is a sound nobody heard, and by the time a reconnect could re-send it the
   * magazine is in.
   */
  sendReload(): void {
    if (!this.seated) return;
    this.conn.send({ t: "reload" });
  }

  /**
   * Asks to be deployed at one of the map's spawns.
   *
   * `spawn` is an index into `GameMap.spawns` — see `DeployMessage` for why it
   * is that and not an index into the list the screen is showing. This is an
   * ASK and the only one in the protocol that moves the local body: the server
   * decides whether the position is still one this team may use, when the
   * reinforcement clock allows it, and answers with a `spawn` event. Nothing
   * here puts the player in the world.
   *
   * The request STANDS until the authority answers it with a spawn, and that is
   * what makes it survive a socket. `joinMatch` books the local round before
   * the socket is open, so the deploy screen can be up and confirmable before
   * the welcome lands; and a reconnect re-seats this client into a fresh body
   * that is dead until it asks. In both cases the player has already pressed
   * the button, and a request dropped on the floor leaves them looking at a
   * screen that answered once and then wanted pressing again for no reason they
   * could see.
   */
  sendDeploy(spawn: number): void {
    this.pendingDeploy = spawn;
    this.flushDeploy();
  }

  /**
   * The deploy request the authority has not answered yet, or null.
   *
   * Cleared by the `spawn` event rather than by the send, which is what makes
   * it a standing request rather than a fire-and-forget: an unanswered one is
   * re-sent on the next welcome.
   */
  private pendingDeploy: number | null = null;

  private flushDeploy(): void {
    if (!this.seated || this.pendingDeploy === null) return;
    this.conn.send({ t: "deploy", spawn: this.pendingDeploy });
  }

  /**
   * Reports a grenade this client just threw.
   *
   * `dir` is the aim, not the launch vector: `GrenadeSystem.throwAlong` applies
   * `CONFIG.grenade.throwLift` itself, so both sides tilt the same aim by the
   * same amount and get the same arc. Sending the already-lifted vector would
   * have the server lift it twice.
   */
  sendGrenade(origin: Vector3, dir: Vector3): void {
    if (!this.seated) return;
    this.conn.send({
      t: "grenade",
      seq: ++this.seq,
      time: this.conn.renderTime(),
      origin: [origin.x, origin.y, origin.z],
      dir: [dir.x, dir.y, dir.z],
    });
  }

  /**
   * Asks to be put into a hull, by hardstanding index.
   *
   * An ASK and nothing more, on `sendDeploy`'s model: this client mounts
   * nothing locally and the authority answers with a `seat` event either way,
   * having re-derived every term of the offer against its own copy — the
   * hull's team, its life, the distance to it, and whether the crew inside may
   * be turned out.
   *
   * `seat` is a PREFERENCE — see `MountMessage.seat`. Omitted it means
   * "whichever chair is free", which is what walking up to a tank asks; named
   * it is either the chair the offer promised or, from a player already
   * aboard, the request to CROSS to the other one. Both are the same sentence
   * and therefore the same message.
   *
   * Fire-and-forget rather than standing, unlike a deploy: a mount that was
   * dropped by a socket is a key press, and the player is standing next to the
   * tank and can press it again. A request that outlived its own frame would
   * be worse — it would put somebody in a tank a second after they walked away
   * from it.
   */
  sendMount(tank: number, seat?: number): void {
    if (!this.seated) return;
    this.conn.send({ t: "mount", tank, seat });
  }

  /** …and asks to get out. It names no hull — the authority knows which. */
  sendDismount(): void {
    if (!this.seated) return;
    this.conn.send({ t: "dismount" });
  }

  /**
   * Reports a round out of the tank gun.
   *
   * `dir` is the GUN's axis and not the camera's, which is the reticle rule
   * crossing the wire: the look is an order the turret is still walking
   * toward, and the shell goes where the barrel is pointing. The server fires
   * down its own copy of that axis regardless — this is what the cone check
   * bounds, not what the round is resolved along.
   */
  sendShell(origin: Vector3, dir: Vector3): void {
    if (!this.seated) return;
    this.conn.send({
      t: "shell",
      seq: ++this.seq,
      time: this.conn.renderTime(),
      origin: [origin.x, origin.y, origin.z],
      dir: [dir.x, dir.y, dir.z],
    });
  }

  /**
   * Reports a round out of the CUPOLA gun. `sendShell`'s twin, and a separate
   * verb for the reason `MgMessage` is: the two guns are fired by two people
   * in two seats, and the authority's gate for each is the chair rather than
   * the weapon.
   *
   * `dir` is the machine gun's own axis and not the camera's, which is the
   * same half of the reticle rule the shell's is.
   */
  sendMg(origin: Vector3, dir: Vector3): void {
    if (!this.seated) return;
    this.conn.send({
      t: "mg",
      seq: ++this.seq,
      time: this.conn.renderTime(),
      origin: [origin.x, origin.y, origin.z],
      dir: [dir.x, dir.y, dir.z],
    });
  }

  /**
   * Reports an anti-tank item leaving the hands — a rocket, or a mine.
   *
   * One method for both, because the third slot is one slot and which item is
   * in it is a fact the authority already holds off the join. `dir` is the aim
   * for a rocket and is ignored for a mine, which goes where `origin` says.
   */
  sendOrdnance(origin: Vector3, dir: Vector3): void {
    if (!this.seated) return;
    this.conn.send({
      t: "ordnance",
      seq: ++this.seq,
      time: this.conn.renderTime(),
      origin: [origin.x, origin.y, origin.z],
      dir: [dir.x, dir.y, dir.z],
    });
  }

  /** Mirrored ticket counts, for the HUD. */
  get tickets(): readonly [number, number] {
    return this.roster.tickets;
  }

  private receive(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome":
        this.slot = msg.slot;
        this.team = msg.team;
        this.mapId = msg.mapId;
        this.matchId = msg.matchId;
        this.brokenPanes = msg.brokenPanes ?? [];
        this.seated = true;
        // Interpreting the welcome is this class's job, not `Connection`'s —
        // so the match we actually landed in is handed back down for the
        // reconnect to aim at. See `Connection.pinMatch` for why a retry that
        // re-sent the ORIGINAL join would be a bug.
        this.conn.pinMatch(msg.matchId);
        // A deploy confirmed before the welcome arrived. Sent now rather than
        // forgotten — the player has already asked, and the seat is what they
        // were waiting on.
        this.flushDeploy();
        // Last, so that whatever `Game` does with the team is done against a
        // session that is already fully seated. A reconnect comes through here
        // a second time and can land in a slot on the OTHER team, which is why
        // this is an edge rather than a one-shot.
        this.onSeated(msg.team);
        break;

      // A new round on a new map, same seat. Only the map changes here; the
      // slot and team deliberately do not, because a rotation does not re-seat
      // anybody.
      case "roundstart":
        this.mapId = msg.mapId;
        // Last round's board is not this round's. The server clears and
        // re-sends its own within a snapshot of this message; clearing here is
        // what keeps the fraction of a second in between from showing a
        // finished round's kills against a map that has just been built.
        this.slotKills.length = 0;
        this.slotDeaths.length = 0;
        this.slotScores.length = 0;
        // Last round's broken glass, over last round's map. A rotation rebuilds
        // the world and every pane with it, so carrying the list would put
        // holes in this round's windows wherever last round's happened to fall.
        this.brokenPanes.length = 0;
        // Last round's grenades, over last round's terrain. Nothing will ever
        // send the end of a flight the rotation interrupted, so the pool is
        // dropped here for the same reason `Game.installMap` drops the local
        // one — and the local `Player`'s own copy is dropped with it there.
        this.grenades.reset();
        // Last round's armour, over last round's streets, and last round's
        // mines under them. Both for the grenades' reason: nothing will ever
        // send the end of a flight or the removal of a plate that a rotation
        // interrupted, and `installMap` rebuilds the fleet underneath either
        // way.
        this.vehicles.reset();
        this.ordnance.reset();
        this.onRoundStart(msg.mapId);
        break;

      case "roster":
        this.slots = msg.slots;
        this.roster.applyRoster(msg.slots, this.slot);
        break;

      // The board, whole. Copied INTO the arrays rather than replacing them,
      // because they are `readonly` fields other code holds a reference to —
      // the same reason `tickets` is written element-wise next door.
      case "scores":
        this.slotKills.length = 0;
        this.slotDeaths.length = 0;
        this.slotScores.length = 0;
        this.slotKills.push(...msg.kills);
        this.slotDeaths.push(...msg.deaths);
        // Absent from a server that predates the column, and an empty array
        // is exactly what that should read as — a board with kills and deaths
        // in it and no points, rather than one carrying last message's.
        if (msg.points) this.slotScores.push(...msg.points);
        break;

      // The latencies, whole, and copied in for the reason the board above is.
      // Deliberately NOT cleared on a `roundstart`: a ping is a fact about a
      // connection and not about a round, and the connection is the one thing a
      // rotation does not touch.
      case "pings":
        this.slotPings.length = 0;
        this.slotPings.push(...msg.ms);
        break;

      case "snap":
        // The hulls FIRST, because the roster reads them: a body inside a tank
        // is not drawn standing in the street, and which bodies those are is
        // what the hulls have just said. See `NetRoster.setRiding`.
        this.vehicles.applySnapshot(msg);
        for (const soldier of this.roster.soldiers) {
          this.roster.setRiding(soldier.slot, this.vehicles.riding(soldier.slot));
        }
        this.roster.applySnapshot(msg, this.points);
        // Our own slot, so the grenades we threw and the rockets we fired are
        // left to the local copies already flying out of our own hand.
        this.grenades.applySnapshot(msg, this.slot);
        this.ordnance.applySnapshot(msg, this.slot);
        break;

      // The mine table, whole, and only when it has moved — see
      // `MinesMessage`. There is no local-slot filter on it: a player's own
      // mine is drawn from here like everybody else's, because a mine is laid
      // at the feet and never moves.
      case "mines":
        this.ordnance.applyMines(msg);
        break;

      case "events":
        for (const e of msg.events) {
          // Broken glass ACCUMULATES here as well as being shown, and that is
          // not bookkeeping — it closes a race with the local map build.
          //
          // `?mp` books the round before the socket is open, so the welcome and
          // `buildRound` arrive in either order, and every `installMap` resets
          // `GlassSystem` because a fresh build puts every pane back. An event
          // that landed in the gap was therefore applied to a map that was
          // about to be replaced and then lost — the client showing intact
          // windows the rest of the match had shot out, with nothing wrong
          // anywhere. Keeping the running list means `buildRound` can catch up
          // on the whole round rather than on whatever the welcome happened to
          // carry, and a reconnect gets the same treatment for free.
          if (e.e === "glass") this.brokenPanes.push(...e.panes);
          // Our own spawn is the one event that moves the local body, so it is
          // routed rather than merely shown.
          if (e.e === "spawn" && e.slot === this.slot) {
            // The answer to whatever we asked for, so there is nothing left
            // standing. Cleared before the callback, which is the one that
            // hides the screen that made the request.
            this.pendingDeploy = null;
            this.scratch.set(e.pos[0], e.pos[1], e.pos[2]);
            this.onSpawn(this.scratch, e.yaw);
          }
          this.onEvent(e);
        }
        break;

      case "correct":
        this.scratch.set(msg.pos[0], msg.pos[1], msg.pos[2]);
        this.onCorrection(this.scratch, msg.reason);
        break;

      // The handshake was refused — a full match, a match that has retired, or
      // a protocol the server does not speak. It carries a reason precisely so
      // it can be shown, and a lobby that sent the player here is the thing
      // best placed to show it.
      case "rejected":
        console.warn(`[net] refused: ${msg.reason}`);
        this.onRejected(msg.reason);
        break;
    }
  }

  dispose(): void {
    this.conn.close();
    this.roster.dispose();
    this.grenades.dispose();
    this.ordnance.dispose();
  }
}
