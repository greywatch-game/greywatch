/**
 * BattleView.ts — what the bot roster LOOKS like: one `BotRig` per pooled
 * `Bot`, the distance LOD over them, and the muzzle flashes their shots leave
 * for the frame's light budget. Only the client builds it; the authority runs
 * `BattleSystem` alone and builds no rig.
 * Owns: the rig pool (built when the simulation's pool changes —
 * `BattleSystem.poolVersion` — or when the VIEWER's side does, and never
 * inside a round), `viewDistance` (the map's body draw distance), the flash
 * list and its backing store.
 * Reads `BattleSystem` and its bots and NEVER writes either: everything it
 * decides is whether a node is enabled, where it stands and how it is posed.
 * `Game` builds both and wires them — this file imports the simulation as a
 * type, which the wiring rules allow.
 * Invariants:
 * - The LOD decides nothing about the fight. Past `viewDistance` a rig is
 *   switched off; past `CONFIG.bots.lodFreezeDistance` its pose stops being
 *   written. The bot walks, fills its pose and fires at every distance either
 *   way (`Bot.update`), which is what keeps an outcome off the camera.
 * - `update` runs right after `BattleSystem.update` in the same frame, before
 *   anything reads a rig (the bodies' shadow map, the mesh walk, a ragdoll
 *   spawned from a bot's joints), and `hideAll` runs beside every
 *   `BattleSystem.reset`, so a reset round never shows a body for a frame.
 * - A side is chosen when a rig is BUILT (`core/teamView.ts`): the pool's
 *   identity is its size AND the viewer's side, and `syncPool` checks both.
 * - Rigs are disposed WITHOUT their materials (`BotRig.dispose`), and only
 *   by a pool rebuild — after `RagdollSystem.reset` has handed every rig back.
 */
import { Vector3, type Scene } from "@babylonjs/core";
import { CONFIG, FOG_WALL } from "../config";
import { viewerTeam } from "../core/teamView";
import type { Bot } from "../entities/Bot";
import { BotRig } from "../entities/BotRig";
import type { Team } from "../entities/Combatant";
import type { Vector3Like } from "../math";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { BattleSystem } from "./BattleSystem";

export class BattleView {
  /** One rig per pooled bot, in the pool's order. */
  readonly rigs: BotRig[] = [];
  private readonly byBot = new Map<Bot, BotRig>();
  /** Muzzle positions from this frame, for `Game` to spend its light budget on. */
  readonly muzzleFlashes: Vector3[] = [];
  /**
   * Backing store for the above: grown on demand, never shrunk, and handed out
   * from the start again every frame. `muzzleFlashes` holds references into it,
   * which is safe only because both are reset together in `beginFrame`.
   */
  private readonly flashPool: Vector3[] = [];
  private flashCount = 0;

  /**
   * How far a rig is worth drawing and posing — the map's, pushed by
   * `Game.installMap`, defaulting to the shipped fog wall.
   *
   * It is a FIELD rather than `CONFIG.bots.lodDisableDistance` because the
   * distance past which there is nothing to see belongs to the weather, and a
   * map is free to have none: on a clear one this is several hundred metres
   * and a bot that vanished at 78 would vanish in plain sight. The value the
   * config still holds is what a fogged map gets.
   *
   * **It is the map's `fogEnd` only until the map says otherwise.**
   * `EnvironmentSpec.bodyDrawDistance` overrides it, resolved once by
   * `bodyDrawDistanceOf` and pushed to all three gates together, because a
   * body is nineteen merged meshes and two pixels tall long before the world
   * around it stops being worth drawing — and on a map that can see past its
   * own diagonal the fog was never going to gate anything at all. The WALK's
   * reach (`WorldCulling`) deliberately did not move with it.
   */
  private viewDistance = FOG_WALL;
  /** The `poolVersion` the rigs were built against; -1 before the first. */
  private builtFor = -1;
  /**
   * The SIDE the rigs were painted for — `teamView`'s viewer at the moment
   * `syncPool` built them, and the pool's identity every bit as much as its
   * size is. A client that books a round before the authority has seated it
   * builds for team 0 and then learns it is on team 1; without this the round
   * would be fought by bodies wearing the wrong colours for the rest of the
   * match.
   */
  private paintedFor: Team = viewerTeam();

  constructor(
    private readonly scene: Scene,
    private readonly mats: CelMaterialFactory,
    private readonly battle: BattleSystem,
  ) {
    this.syncPool();
  }

  /**
   * Builds a rig for every bot in the simulation's pool, if the pool or the
   * viewer's side has changed since the last build — a no-op otherwise, which
   * is every round but the first after a change of roster or of seat.
   *
   * Called from `Game.buildRound` right after `BattleSystem.setRoster`, and
   * after `RagdollSystem.reset`, which is the one other holder of a rig.
   */
  syncPool(): void {
    const side = viewerTeam();
    if (this.builtFor === this.battle.poolVersion && this.paintedFor === side) return;
    this.builtFor = this.battle.poolVersion;
    this.paintedFor = side;
    this.disposeAll();
    for (const bot of this.battle.bots) {
      const rig = new BotRig(this.scene, this.mats, bot);
      this.rigs.push(rig);
      this.byBot.set(bot, rig);
    }
  }

  /** How far bodies are worth drawing on this map. See `viewDistance`. */
  setViewDistance(metres: number): void {
    this.viewDistance = metres;
  }

  /** This bot's rig, or null for a body this view did not build. */
  rigFor(bot: Bot): BotRig | null {
    return this.byBot.get(bot) ?? null;
  }

  /**
   * This bot's rig, caught up to the bot this instant (`BotRig.catchUp`), to
   * hand to `RagdollSystem` — the one place a body is offered to the pool.
   */
  corpseOf(bot: Bot): BotRig | null {
    const rig = this.byBot.get(bot) ?? null;
    rig?.catchUp();
    return rig;
  }

  /** Empties this frame's flash list. Before `BattleSystem.update`. */
  beginFrame(): void {
    // Both, together: the list holds references into the pool, so releasing one
    // without the other either leaks slots or hands out live vectors.
    this.muzzleFlashes.length = 0;
    this.flashCount = 0;
  }

  /**
   * A bot's muzzle flash at `at`, kept for the frame — `BattleSystem.onBotFired`,
   * wired by `Game`. The copy comes back, a Babylon vector for the consumers
   * still on Babylon's math.
   *
   * Pooled, not cloned: the muzzle handed in is the bot's own scratch and
   * walks away with its next shot, and a clone per shot was the one allocation
   * on the bot firing path. The list is emptied every frame, so a vector per
   * slot is reused for the life of the process and the high-water mark is the
   * busiest frame's flash count.
   */
  flash(at: Vector3Like): Vector3 {
    const v = (this.flashPool[this.flashCount++] ??= new Vector3());
    v.copyFromFloats(at.x, at.y, at.z);
    this.muzzleFlashes.push(v);
    return v;
  }

  /**
   * One frame of the picture, right after `BattleSystem.update`: every rig
   * follows its bot from `eye` (`BotRig.follow`).
   */
  update(eye: Vector3Like): void {
    const freeze = CONFIG.bots.lodFreezeDistance;
    for (const rig of this.rigs) rig.follow(eye, this.viewDistance, freeze);
  }

  /** Every rig switched off at once — beside every `BattleSystem.reset`. */
  hideAll(): void {
    for (const rig of this.rigs) rig.hide();
  }

  /** Frees every rig and empties the pool. Only `syncPool` reaches it. */
  private disposeAll(): void {
    for (const rig of this.rigs) rig.dispose();
    this.rigs.length = 0;
    this.byBot.clear();
  }
}
