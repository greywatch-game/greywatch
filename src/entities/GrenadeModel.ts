/**
 * GrenadeModel.ts — What a grenade looks like: the body, the fuse pip, and the
 * blink that reads the fuse.
 * Owns: the two meshes and the tell. Owns NO behaviour — nothing here flies,
 * bounces, times out or goes off.
 * Invariants: a grenade is DRESSING WITH A TIMER, never a collider. It carries
 * no `solid` flag and no `WorldBox`, so nothing shoots it, walks into it or
 * treats it as cover, and it must stay that way on both sides of the wire.
 *
 * It is a file of its own for the reason `SoldierModel` is one: two things
 * build a grenade now. `GrenadeSystem` builds the pool it SIMULATES, and
 * `net/NetGrenades` builds the ones a client is only DRAWING, from positions
 * the authority sent. A grenade somebody else threw has to be the same object
 * on screen as the one you threw yourself — same size, same ink, same pip
 * blinking at the same rate — and the way that stays true is one description
 * of it rather than two that agree on the day they were written.
 */
import { Mesh, MeshBuilder, Scene } from "@babylonjs/core";
import { CONFIG } from "../config";
import { addOutline, type CelMaterialFactory } from "../shaders/CelShader";

/** One grenade's meshes. The pip is parented to the body and moves with it. */
export interface GrenadeMeshes {
  mesh: Mesh;
  pip: Mesh;
}

/**
 * Builds one grenade, hidden. Both materials come out of the factory's cache,
 * so a pool of twenty costs two materials and not forty.
 */
export function buildGrenade(
  scene: Scene,
  mats: CelMaterialFactory,
  name: string,
): GrenadeMeshes {
  const g = CONFIG.grenade;
  const mesh = MeshBuilder.CreateSphere(
    name,
    { diameter: g.radius * 2, segments: 6 },
    scene,
  );
  mesh.material = mats.get("#3f4a33");
  mesh.isVisible = false;
  // A grenade is a thing in the world, not a collider: it carries no `solid`
  // flag and no WorldBox, so nothing shoots it, walks into it or treats it as
  // cover — it is dressing with a timer.
  mesh.isPickable = false;

  const pip = MeshBuilder.CreateSphere(
    `${name}Pip`,
    { diameter: g.radius * 0.62, segments: 4 },
    scene,
  );
  pip.parent = mesh;
  // The pip has to stand proud of the body's outline shell or the ink
  // swallows it — the same rule the player's visor slit follows. At this size
  // that is a fine line, hence the deliberately thin outline below.
  pip.position.y = g.radius;
  pip.material = mats.getEmissive("#ff5a4f");
  pip.metadata = { noOutline: true };
  pip.isPickable = false;
  pip.isVisible = false;

  // Ink, or a dark green sphere in a night game is invisible against the
  // ground it is rolling across — which for the one object the player has to
  // notice arriving is the whole ball game.
  addOutline(mesh, 0.02);
  return { mesh, pip };
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
