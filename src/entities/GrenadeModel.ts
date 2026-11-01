/**
 * GrenadeModel.ts — What a grenade looks like: the body, the fuse pip, and the
 * blink that reads the fuse.
 * Owns: the two parts and the tell. Owns NO behaviour — nothing here flies,
 * bounces, times out or goes off.
 * Invariants: a grenade is DRESSING WITH A TIMER, never a collider. It carries
 * no `solid` flag and no `WorldBox`, so nothing shoots it, walks into it or
 * treats it as cover, and it must stay that way on both sides of the wire.
 * Both parts are `Part`s on `src/geometry/` spheres, the KIT our renderer
 * draws every grenade as an instance of (`entities/pieces.ts`,
 * `BABYLON_EXIT.md` X4.4b) — Babylon is made no mesh of either.
 *
 * It is a file of its own for the reason `SoldierModel` is one: two things
 * draw a grenade, both through `GrenadeFx`'s `GrenadeBody`: `GrenadeFx`
 * draws the pool the local SIMULATION is drawn in, and `net/NetGrenades`
 * draws the ones a client is only DRAWING, from positions the authority
 * sent. A grenade somebody else threw has to be the same object
 * on screen as the one you threw yourself — same size, same ink, same pip
 * blinking at the same rate — and the way that stays true is one description
 * of it (one kit) rather than two that agree on the day they were written.
 */
import { CONFIG } from "../config";
import { createSphere } from "../geometry/primitives";
import { type CelMaterialFactory } from "../shaders/CelShader";
import { Part } from "../world/parts";
import type { PiecePart } from "./pieces";

/** The body's paint. */
const BODY = "#3f4a33";
/** The pip's: unlit, so it reads at night. */
const PIP = "#ff5a4f";

/**
 * One grenade's two parts — the body, and the pip hung from it — as the kit
 * `pieceKit` makes of them: each painted as its mesh was (the material out of
 * the factory's cache, and its hex beside it for our renderer), placed where
 * the mesh stood in the body's frame.
 */
export function grenadeParts(mats: CelMaterialFactory, name: string): PiecePart[] {
  const g = CONFIG.grenade;
  const body = new Part(name, createSphere({ diameter: g.radius * 2, segments: 6 }));
  body.material = mats.get(BODY);
  // A grenade is a thing in the world, not a collider: it carries no `solid`
  // flag and no WorldBox, so nothing shoots it, walks into it or treats it as
  // cover — it is dressing with a timer.

  const pip = new Part(`${name}Pip`, createSphere({ diameter: g.radius * 0.62, segments: 4 }));
  // The pip has to stand proud of the body's outline shell or the ink
  // swallows it — the same rule the player's visor slit follows. At this size
  // that is a fine line, hence the deliberately thin outline below.
  pip.position.y = g.radius;
  pip.material = mats.getEmissive(PIP);
  pip.metadata = { noInk: true };

  // Ink, or a dark green sphere in a night game is invisible against the
  // ground it is rolling across — which for the one object the player has to
  // notice arriving is the whole ball game.
  return [
    { part: body, cel: BODY, unlit: null, parent: -1 },
    { part: pip, cel: null, unlit: PIP, parent: 0 },
  ];
}

/**
 * The tell: whether the pip is lit with `left` of the fuse remaining (1 at the
 * release, 0 at the detonation).
 *
 * A blink that quickens as the fuse runs out, so a grenade at your feet is
 * readable without a timer on the HUD. It is the only warning there is, which
 * is why it is a separate mesh rather than a colour change on a body the ink
 * already darkens — it has to be visible from the side a grenade is most
 * likely to arrive from.
 *
 * A pure function of the fuse and nothing else, so a replicated grenade blinks
 * in step with the one the thrower is watching: both sides run this over the
 * same remaining fraction and neither has to be told what the pattern is.
 */
export function pipLit(left: number): boolean {
  return Math.sin((1 - left) * (1 - left) * 90) > 0 || left > 0.75;
}
