/**
 * stance.ts — Where a body's eye and hit sphere sit for a crouch blend, and how
 * fast that blend eases. The one copy of both.
 *
 * Owns: `stanceCentre`, `stanceEye` and `easeStance`, pure functions of the
 * blend and of `CONFIG.player`/`CONFIG.camera`.
 *
 * Invariants:
 * - **The eye and the hit sphere come down TOGETHER, off ONE blend.** `eyePos`
 *   is what every shooter aims at and what line of sight is tested to;
 *   `center` is the sphere rounds are tested against. Drop the eye alone and
 *   crouching makes a body EASIER to kill — every incoming round aimed at the
 *   middle of an unmoved sphere instead of grazing its top. Five bodies take a
 *   stance (the player, a bot, a remote soldier, the authority's copy of a
 *   person and the death cam's corpse) and the arithmetic was written out at
 *   each of them; a sixth copy that moved one height and not the other is the
 *   bug this file exists to make impossible.
 * - It is the PLAYER's numbers for every body, a bot included: the crouch is
 *   one stance with one geometry, and a bot that takes it is the same shape as
 *   a person who does. The standing CENTRE is the caller's (`player.height / 2`
 *   for a person, `rig.centerHeight` for a rig), the standing EYE is
 *   `camera.eyeHeight` for everybody.
 * - Heights are above the FEET, never world positions: the caller adds its
 *   own feet, which is where the bodies genuinely differ.
 *
 * Must never: allocate (each is called per body per frame), or hold state —
 * the blend lives on the body that owns it.
 */
import { CONFIG } from "../config";

/** The hit sphere's centre above the feet, from `standCentre` standing to `player.crouchCenterHeight` crouched. */
export function stanceCentre(standCentre: number, blend: number): number {
  return standCentre + (CONFIG.player.crouchCenterHeight - standCentre) * blend;
}

/** The eye above the feet, from `camera.eyeHeight` standing to `player.crouchEyeHeight` crouched. */
export function stanceEye(blend: number): number {
  const stand = CONFIG.camera.eyeHeight;
  return stand + (CONFIG.player.crouchEyeHeight - stand) * blend;
}

/**
 * One frame of the blend easing toward the stance asked for, on
 * `player.crouchBlendSpeed` — the player's number for every body because it is
 * how fast a BODY folds rather than a property of whoever asked, and because a
 * remote copy has to fold at the rate its authority does.
 */
export function easeStance(blend: number, crouching: boolean, dt: number): number {
  return (
    blend +
    ((crouching ? 1 : 0) - blend) *
      Math.min(1, dt * CONFIG.player.crouchBlendSpeed)
  );
}
