/**
 * Combatant.ts — The shared shootable/shooter interface (player + bots) and
 * the Team type (0/1 index into CONFIG.teams). Pure types, no runtime logic.
 * CombatSystem.fire() takes a shooter's target list built from Combatants, so
 * friendly fire is excluded by construction, never by a team check inside.
 */
import type { Vector3 } from "@babylonjs/core";
import type { Hittable } from "../systems/CombatSystem";

/** 0 = Valeguard, 1 = Redline. Indexes into `CONFIG.teams`. */
export type Team = 0 | 1;

export const OTHER_TEAM: Record<Team, Team> = { 0: 1, 1: 0 };

/**
 * Anything that holds a flag and can be shot at — the player and every bot
 * alike.
 *
 * This replaces the retired `AICtx`, which hard-coded exactly one target
 * (`playerPos`) and exactly one victim (`damagePlayer`). Conquest needs the
 * damage model to be symmetric: bots shoot bots, bots shoot the player, and the
 * player shoots bots, all through the same path.
 *
 * `eyePos` — where line of sight is tested from, where shots originate, and
 * the centre of the head zone — is inherited from `Hittable` rather than
 * declared here. It moved down when the head zone arrived: resolving a shot
 * needs it, and `CombatSystem` may not assume its targets are Combatants even
 * though in practice they all are.
 */
export interface Combatant extends Hittable {
  team: Team;
  alive: boolean;
  /** Feet. */
  position: Vector3;
}
