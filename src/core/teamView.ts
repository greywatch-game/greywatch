/**
 * core/teamView.ts — which side the player is LOOKING from.
 *
 * Owns: the one remap between a team INDEX and the team a body is DRAWN and
 * NAMED as. The index is the authority's — `Roster.claim` fills the thinner
 * side, so the second person into a match is on team 1 — and from behind that
 * player's own eyes their side is amber Valeguard against red Redline exactly
 * as it is for everybody else. Two humans on opposite sides each see
 * themselves as team 0; neither is told the other's answer, and neither needs
 * to be.
 *
 * **It is PRESENTATION and nothing else.** Nothing in `CombatSystem`,
 * `ConquestSystem`, the nav layer, the score or the wire may ask this file
 * anything: a target list, a capture, a spawn and a payout are all the
 * authority's team index and stay it. What reads it is a kit, a palette and a
 * name — the things a player looks at.
 *
 * **The viewer is set BEFORE a round is built, and that is the invariant this
 * file cannot enforce for itself.** A side is not a material you repaint: the
 * kits differ in hue, in accent AND in silhouette (`SoldierModel`'s helmet
 * against its respirator), so a rig is nineteen merged meshes built for one
 * side at the moment it is built. `Game.buildRound` therefore writes this on
 * its first line, before `setRoster` stands up the pool, and a side that
 * changes AFTER a build rebuilds the round rather than trying to repaint it —
 * see `net.onSeated`.
 *
 * The default is 0, which is the identity remap: an offline round, and the
 * authority's own NullEngine build, both want exactly that and neither has to
 * know this file exists.
 */
import { CONFIG } from "../config";
import type { Team } from "../entities/Combatant";

/** The side the local player is on. Written only by `Game.buildRound`. */
let viewer: Team = 0;

/** Puts the local player's side behind the eye. See the header for the order. */
export function setViewerTeam(team: Team): void {
  viewer = team;
}

/** The side the local player is on, as the authority numbers it. */
export function viewerTeam(): Team {
  return viewer;
}

/**
 * The palette row a team is drawn as: the viewer's own side is always 0, the
 * other side always 1.
 */
export function viewTeam(team: Team): Team {
  return team === viewer ? 0 : 1;
}

/** That row — the name, the worn colour and the visor's emissive. */
export function teamLook(team: Team): (typeof CONFIG.teams)[number] {
  return CONFIG.teams[viewTeam(team)];
}
