/**
 * net/NetRoster.ts — The other bodies on screen, driven by snapshots.
 * Owns: the `NetSoldier` pool, applying snapshots to it, the mirrored flag and
 * ticket state, the distance LOD, and the target list the local player's own
 * rounds are resolved against. It is the client's replacement for
 * `BattleSystem` in a networked round — same job on screen, none of the job
 * underneath, because no AI runs here.
 * Invariants: the pool holds one soldier per slot the ROUND fields, and a
 * slot's soldier is the same object for as long as the map is standing; only
 * its OCCUPANT changes, which is why a human taking a bot's place costs nothing
 * on this side and is invisible on screen.
 * Never runs a think tick, never calls `CombatSystem.fire`, never decides a
 * death. If any of those appear here, AI has come back to the client.
 *
 * The local player is not in the pool. `Game` keeps its own `Player` and the
 * server knows which slot that is; this renders everybody else, and the slot
 * belonging to the local player is left disabled.
 *
 * **A SLOT IS NOT A POOL INDEX HERE, and that is the one thing to know before
 * touching this file.** The authority's slot table is the ceiling any map may
 * field — forty-eight, so that a rotation never renumbers a player (see
 * `server/Roster.ts`) — while a round fields the standing map's `perTeam` out
 * of each team's block. So on a map fielding eight a side the bodies are slots
 * 0-7 and 24-31, and this class keeps two views of one pool: `soldiers`, dense,
 * for everything that walks the roster, and `bySlot`, sparse, for everything
 * that arrives off the wire holding a slot number. They are built and thrown
 * away together by `setFielded`, which is the only thing that may write either.
 */
import { Scene, Vector3 } from "@babylonjs/core";
import { CONFIG, FOG_WALL } from "../config";
import { NetSoldier } from "../entities/NetSoldier";
import type { Combatant, Team } from "../entities/Combatant";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { Hittable } from "../systems/CombatSystem";
import type { ControlPoint } from "../systems/ConquestSystem";
import type { PointState, SlotState, Snapshot } from "./protocol";

export class NetRoster {
  /**
   * Every body in the round, in slot order — DENSE, so `soldiers[3]` is the
   * fourth body and not necessarily slot 3. Everything that walks the roster
   * reads this; anything holding a slot number off the wire goes through
   * `at`. Rebuilt by `setFielded` when the map changes what it fields.
   */
  readonly soldiers: NetSoldier[] = [];

  /**
   * The same bodies indexed BY SLOT — sparse, with a hole at every slot this
   * map does not field. See the header for why the two are not the same array.
   */
  private readonly bySlot: (NetSoldier | undefined)[] = [];

  /**
   * How far a body is worth drawing — the match's map's, pushed by
   * `Game.installMap` (and again by `wireNet`, for a join into a match already
   * standing). `BattleSystem.viewDistance` is the same field for the same
   * reason: past the fog there is nothing to see, and a map with no fog has no
   * such distance short of its own far side — which is why a map may now state
   * one outright as `EnvironmentSpec.bodyDrawDistance`, resolved by
   * `bodyDrawDistanceOf` and pushed to the three body gates together.
   */
  private viewDistance = FOG_WALL;

  /** See `viewDistance`. Pushed with the map, not read from CONFIG. */
  setViewDistance(metres: number): void {
    this.viewDistance = metres;
  }

  /** Mirrored from the server each snapshot. */
  readonly tickets: [number, number] = [0, 0];

  /** The slot the local player owns, or -1 while spectating. */
  localSlot = -1;

  /**
   * Which slots are inside a hull, by slot.
   *
   * A body in a tank is not drawn: offline `Game.mount` hides the player's
   * viewmodel and `BattleSystem.setCrewed` takes a bot's rig off the field,
   * and this is the same statement made from the wire. Without it a crewed
   * hull drives down the street with its driver standing in the road at the
   * hull's own position, at the hull's own SPEED — which reads as a man being
   * dragged along under the tracks.
   *
   * Written by `NetSession` off `VehicleState.by` and `by2` together — a
   * hull holds two people and the man on the cupola gun is inside it exactly
   * as the driver is (`NetVehicles.riding` folds the pair), which is the one
   * place occupancy is stated. It is a fact about the ROUND rather than about a
   * body, exactly as the bench is in `BattleSystem`, which is why it lives
   * here as an array rather than as a flag on `NetSoldier`.
   */
  private readonly riding: boolean[] = [];

  /** See `riding`. */
  setRiding(slot: number, on: boolean): void {
    this.riding[slot] = on;
  }

  /** One per team, reused by `hittablesAgainst` so a shot allocates nothing. */
  private readonly hittableScratch: [Hittable[], Hittable[]] = [[], []];

  /**
   * Wired by `Game`: this body just went down, and may be offered to the
   * ragdoll pool. The counterpart of `BattleSystem.onBotKill`, and it says
   * strictly less: a death here is news that ALREADY happened, so there is no
   * killer, no ticket and no score on it — the authority spent all three
   * before this client heard about it. What is left is the body falling over,
   * which is this side's alone.
   *
   * Raised off the INTERPOLATED death rather than off the `kill` event, and
   * that is the whole reason it is here instead of in `Game.onNetEvent`. The
   * event arrives in real time and the body is drawn `interpDelay` behind it,
   * so spawning from the event throws a corpse a tenth of a second before the
   * round that killed it appears to land. It is also the only signal that
   * cannot be missed: every death is in the snapshot stream by construction,
   * whereas an event is a message that a reconnect can drop.
   */
  onDeath: (soldier: NetSoldier) => void = () => {};

  /**
   * Wired by `Game`: this body is somebody else's again — it respawned, or its
   * slot changed hands — and any corpse the pool is still holding for it has to
   * be handed back before the rig is posed from the wire once more.
   *
   * Fires on bodies the pool never took, which is most of them. Retiring one of
   * those is a documented no-op, and that is what lets this be a plain edge
   * rather than a question asked of the pool every frame.
   */
  onRetire: (soldier: NetSoldier) => void = () => {};

  /**
   * Wired by `Game`: this body put a boot down.
   *
   * The counterpart of `BattleSystem.onBotStepped`, and it fires for every body
   * but the local player's — `Sfx.botStep` rejects the far ones on distance,
   * which is where that decision belongs, so nothing on this side should do
   * work per step.
   *
   * Raised by the soldier's own gait rather than by anything on the wire; see
   * `NetSoldier.onStep` for why a footfall is derived and not sent.
   */
  onStep: (soldier: NetSoldier) => void = () => {};

  constructor(
    private readonly scene: Scene,
    private readonly mats: CelMaterialFactory,
  ) {
    // What a map that states nothing fields, which is four of the five and is
    // the only honest guess before a `roundstart` has named one. `Game`
    // pushes the real number every round.
    this.buildPool(CONFIG.bots.perTeam);
  }

  /**
   * How many bodies a side the standing map fields, from `Game.buildRound`.
   *
   * **The exact counterpart of `BattleSystem.setRoster`, down to being the one
   * place "built once and never disposed" bends and to bending at a MAP
   * CHANGE** — the world is being torn down and rebuilt anyway and a loading
   * card is already up. It is called for the same reason too: a pool built to
   * `CONFIG.bots.maxPerTeam` on every map would park thirty-two rigs nobody is
   * fighting in the frame's own mesh walk on the four maps that field eight,
   * and a disabled mesh is skipped cheaply rather than skipped.
   *
   * It is the CLIENT's copy of a decision the authority has already made:
   * `Roster.fielded` is what it sends and this is the same count arriving by
   * the map rather than by the wire, because the map never crosses the wire.
   *
   * A no-op at the same size, which is every round on every map but the first
   * one after a change of roster. Anything holding a body — the ragdoll pool
   * above all — must have been reset before this is called, exactly as for
   * `setRoster`.
   */
  setFielded(perTeam: number): void {
    if (perTeam * 2 === this.soldiers.length) return;
    for (const soldier of this.soldiers) soldier.dispose();
    this.soldiers.length = 0;
    this.bySlot.length = 0;
    this.riding.length = 0;
    this.buildPool(perTeam);
  }

  /**
   * The body in a slot, or undefined for a slot this map does not field.
   *
   * The one door for everything that arrives off the wire holding a slot
   * number. Undefined is an ordinary answer rather than an error: a snapshot
   * or an event can name a slot from the round before a rotation, and a
   * message that arrives while the pool is being rebuilt names a slot that
   * exists on the authority and not yet here.
   */
  at(slot: number): NetSoldier | undefined {
    return this.bySlot[slot];
  }

  /**
   * `perTeam` bodies a side, at the slots the authority will name them by.
   *
   * The slot arithmetic is `server/Roster.ts`'s: team 1's block begins at
   * `CONFIG.bots.maxPerTeam` on every map, and a round fills the first
   * `perTeam` of each block. Getting this wrong is not a crash — it is bodies
   * that never move, because every snapshot would be addressed to a hole.
   */
  private buildPool(perTeam: number): void {
    for (let team = 0; team < 2; team++) {
      for (let i = 0; i < perTeam; i++) {
        const slot = team * CONFIG.bots.maxPerTeam + i;
        const soldier = new NetSoldier(this.scene, this.mats, slot, team as Team);
        // Wired at construction, because a soldier lives exactly as long as
        // the pool it is in — the same lifetime `BattleSystem` gives a bot's
        // own hooks.
        soldier.onStep = () => this.onStep(soldier);
        this.soldiers.push(soldier);
        this.bySlot[slot] = soldier;
      }
    }
  }

  /**
   * A roster message: who is in which slot.
   *
   * Almost nothing to do, and that is the design working. A slot changing from
   * a bot to a human changes no mesh, no pool entry and no index — the body
   * carries on from where it was, now fed by a different source. The only
   * reaction needed is to stop drawing the slot the local player just took,
   * because that one is rendered as a first-person viewmodel instead.
   */
  applyRoster(slots: readonly SlotState[], localSlot: number): void {
    this.localSlot = localSlot;
    for (const slot of slots) {
      const soldier = this.at(slot.index);
      if (!soldier) continue;
      soldier.team = slot.team;
      if (slot.index !== localSlot) continue;
      // `reset` restores the rig itself, so a corpse the pool is still holding
      // has to be given back FIRST — otherwise the slot runs its clock out over
      // a rig that has already been put away and sinks it on the way.
      this.onRetire(soldier);
      soldier.reset();
    }
  }

  /** Takes a snapshot: entity samples in, mirrored objective state in. */
  applySnapshot(snap: Snapshot, points: ControlPoint[]): void {
    for (const e of snap.entities) {
      if (e.i === this.localSlot) continue;
      const soldier = this.at(e.i);
      if (!soldier) continue;
      soldier.receive(
        snap.now,
        e.p,
        e.yaw,
        e.bodyYaw,
        e.pitch,
        e.moving,
        e.dead,
        e.alive,
        // Absent is standing, which is every bot and every server that predates
        // the field. See `EntityState.crouch`.
        e.crouch ?? 0,
      );
    }

    this.tickets[0] = snap.tickets[0];
    this.tickets[1] = snap.tickets[1];
    applyPoints(points, snap.points);
  }

  /**
   * Poses every body for `renderTime`, and applies the same distance LOD
   * `BattleSystem` applies to bots.
   *
   * The LOD is worth keeping even though nothing here is simulated: it is a
   * DRAWING budget, and sixteen rigs with outlines is the same number of draw
   * calls whether an FSM or a socket decided where they stand.
   *
   * No `dt`, for the reason `NetSoldier.update` gives: nothing on this path
   * integrates against frame time.
   */
  update(renderTime: number, cameraPos: Vector3): void {
    const b = CONFIG.bots;
    for (const soldier of this.soldiers) {
      if (soldier.slot === this.localSlot) continue;
      // The two edges the ragdoll pool cares about, read either side of the one
      // call that can move them. A body is drawn from the wire, so "it died" is
      // a value changing rather than an event arriving, and this is the only
      // place both readings exist.
      const was = soldier.alive;
      soldier.update(renderTime);
      if (was !== soldier.alive) {
        if (soldier.alive) this.onRetire(soldier);
        else this.onDeath(soldier);
      }
      // In a hull. Hidden AFTER the update above rather than instead of it,
      // which is what keeps the ragdoll edges honest: a crew burned inside its
      // tank goes from alive to dead on this slot like any other body, and
      // `onDeath` is what puts a corpse beside the wreck. What is skipped is
      // only the drawing.
      if (this.riding[soldier.slot]) {
        soldier.setEnabled(false);
        continue;
      }
      const d = Vector3.Distance(soldier.position, cameraPos);
      if (d > this.viewDistance) {
        soldier.setEnabled(false);
        continue;
      }
      // A corpse under physics is re-shown here for the same reason
      // `BattleSystem` re-shows a dead bot every frame inside the fog: the
      // branch above hides whatever walks out of range, and a body that came
      // back into it has no other way home. `NetSoldier.update` cannot do it —
      // it stands aside entirely while the pool owns the rig.
      if (soldier.ragdolling) soldier.setEnabled(true);
      soldier.setOutlines(d < b.lodOutlineDistance);
    }
  }

  /**
   * Living enemies of `team`, as hitscan targets. Reused, not reallocated —
   * `BattleSystem.hittablesAgainst`'s contract to the letter, because this
   * stands in for that call on a client and the callers are the same two: the
   * local player's shot resolve and the gamepad aim assist. They must be handed
   * the SAME list, or the assist holds an aim on a body the rounds cannot find.
   *
   * These targets exist to be predicted against and for nothing else.
   * `NetSoldier.takeDamage` returns false and changes nothing; the authority
   * re-resolves the round against its own rewound copy of the same body and
   * only that result deals damage. What the list buys is everything that is
   * owed to the shooter's own screen before the round trip: the tracer stopping
   * in the man it hit rather than sparking off the wall behind him, and an
   * immediate hitmarker for the server's `hit` event to correct.
   *
   * The local slot is skipped for the reason `update` and `combatants` skip it
   * — that body is drawn as a viewmodel, not a soldier — though the team check
   * would drop it anyway, since it is on the shooter's own side by definition.
   */
  hittablesAgainst(team: Team): Hittable[] {
    const out = this.hittableScratch[team];
    out.length = 0;
    for (const soldier of this.soldiers) {
      if (soldier.slot === this.localSlot) continue;
      // A body inside a hull is not a target, for the reason
      // `Game.mount` makes the player invulnerable: the TANK is what is being
      // shot at. Left in, the local prediction would stop every round on an
      // invisible man at the hull's centre — a tracer dying in mid-air and a
      // hitmarker the authority never confirms.
      if (this.riding[soldier.slot]) continue;
      if (soldier.alive && soldier.team !== team) out.push(soldier);
    }
    return out;
  }

  /** Everything drawable, for the systems that take a combatant list. */
  combatants(into: Combatant[]): void {
    for (const soldier of this.soldiers) {
      if (soldier.slot !== this.localSlot) into.push(soldier);
    }
  }

  dispose(): void {
    for (const soldier of this.soldiers) soldier.dispose();
    this.soldiers.length = 0;
    this.bySlot.length = 0;
  }
}

/**
 * Mirrors flag state onto the client's `ConquestSystem` points.
 *
 * Written in terms of the live `ControlPoint` objects rather than replacing
 * them, because `CaptureZoneSystem`, `HUD.setFlags` and `Minimap` all hold
 * references to those objects and read them every frame. Swapping the array
 * would leave three systems drawing last round's flags with nothing throwing.
 */
function applyPoints(points: ControlPoint[], states: readonly PointState[]): void {
  for (const state of states) {
    const point = points.find((p) => p.def.id === state.id);
    if (!point) continue;
    point.owner = state.owner;
    point.meter = state.meter;
    point.contested = state.contested;
    // Occupancy is mirrored for the same reason the meter is: nothing steps
    // `ConquestSystem.update` in a netplay round, so these counts are whatever
    // the wire last put in them. A server too old to send them leaves the zero
    // that field held before it existed.
    point.present[0] = state.present ? state.present[0] : 0;
    point.present[1] = state.present ? state.present[1] : 0;
  }
}
