/**
 * CollisionField.ts — How a body MOVES through the solid world: the one sweep
 * every body that walks, drives or coasts goes through.
 * Owns: one `EllipsoidSweep` and its candidate list, the check that the list
 * covered the whole sweep, and the millimetre rule for writing a move back.
 * Owns no geometry and no index of its own: the candidates are
 * `RayWorld.bodyNear`'s — the same body-blocking boxes `castBody` answers off,
 * the same hulls every ray sees, the same broken panes taken out by the same
 * one write — so what a body may walk through and where the death cam may sit
 * are one question with one answer. Never imports `@babylonjs/core`.
 *
 * ## What it replaced
 *
 * `moveWithCollisions`, which was the last whole-scene walk in the game:
 * Babylon's coordinator tested every collidable MESH in `scene.meshes` up to
 * three times a call, so a body was priced on how big the map was. This file
 * used to narrow that walk by handing Babylon a bucketed mesh list through
 * `surroundingMeshes` (Sarab's fleet 2.30 ms a frame to 0.12, the player's own
 * sweep 2.21 to 0.036). Now the collider itself is ours (`ellipsoidSweep.ts`,
 * a port of Babylon's, BABYLON_EXIT.md X2.1) and it is fed boxes rather than
 * meshes, so no collider mesh is walked by anything and the authority's
 * sweeps need no scene at all.
 *
 * ## The same answers, and the places they differ on purpose
 *
 * The port is held to the BIT against Babylon by `scripts/sweep-check.mjs`,
 * from Babylon's own start against a world of one collider mesh per box made
 * in the client's order. What shipped differs from that reference in three
 * ways, all Babylon artifacts this does not reproduce, and `sweep-check --mode
 * shipped` measures what they come to against the client's real scene:
 *
 * - **The start is the body's own position**, float64. Babylon read it out of
 *   the float32 world matrix (`getAbsolutePosition`), a few micrometres off.
 * - **A merged scatter cluster's triangles round at the other end.** The merge
 *   baked the world matrix into its vertices before the ellipsoid's scale was
 *   applied; a box here composes the two first, as a mesh of its own did.
 * - **A hull is where it IS.** Babylon swept against a hull's last computed
 *   world matrix: on a client a frame old for one already moved this frame,
 *   and on the AUTHORITY, which never renders, whatever a muzzle read or the
 *   hull's own last sweep had left there — the origin it was built at, for a
 *   hull nobody had driven. `rayBox()` reads the body's position, on both.
 *
 * Each of the first two only ever moves an answer by a rounding, which
 * matters only on a knife edge — an ellipsoid already touching two boxes,
 * whose slide Babylon's own answer would change under a micrometre's nudge.
 * The TIE ORDER is not among them: `RayWorld.bodyNear` hands boxes over in
 * the order the client's collider meshes were made, which is the order
 * Babylon met them in there — and the authority, which made its clusters
 * first, now agrees with the client where it used to break those ties apart.
 *
 * ## The two rules this file keeps
 *
 * - **The list must cover everything the sweep can reach, and that is CHECKED
 *   rather than trusted.** A sweep is gathered at the ellipsoid's ground-plane
 *   radius plus the step plus `SWEEP_MARGIN`. That covers a sweep that slides
 *   no farther than it was asked to, but an ellipsoid that began INSIDE a box
 *   is ejected along the slide plane and can travel farther — so `run`
 *   measures the path the centre actually took, and nothing farther than the
 *   radius plus that path could have been touched. A sweep whose path outran
 *   its list is thrown away and re-gathered at the reach it needed, and run
 *   again from the same start; if that keeps happening the last resort is
 *   every body box on the map — slow, and never wrong.
 * - **A move of a millimetre or less is not written back**, which is Babylon's
 *   position callback (`CollisionsEpsilon`) and is load-bearing for a hull
 *   pulling away from rest — see `Vehicle.update`. `COLLISIONS_EPSILON` is the
 *   number, exported so a caller gating on it names the same one.
 *
 * **The grid this reads is stamped once and never updated**, which is a claim
 * about the world: a collider is built where it stands. The one dev-only
 * exception is the editor's tier-1 gizmo drag (`docs/editor.md`), which moves a
 * placement's boxes in place without re-stamping `RayWorld` — so a sweep goes
 * stale exactly as a round does: it meets the box at its new pose, but only
 * where a query still reaches the cells of its old one.
 */
import type { Vector3Like, Vector3Ref } from "../math/index.ts";
import {
  COLLISIONS_EPSILON,
  EllipsoidSweep,
  type SweepResult,
} from "./ellipsoidSweep.ts";
import type { WorldBox } from "./mapTypes.ts";
import type { RayHull, RayWorld } from "./RayWorld.ts";

export { COLLISIONS_EPSILON };

/**
 * A body that sweeps: where it is, and the ellipsoid it sweeps as. A Babylon
 * mesh satisfies it as it stands — `position`, `ellipsoid`, `ellipsoidOffset`
 * — and so will whatever holds a body's state once the nodes are views
 * (X2.2), because nothing here reads anything else.
 */
export interface SweepBody {
  /** Written through `set` when the move is kept, and never otherwise. */
  readonly position: Vector3Ref;
  /** The ellipsoid's three radii, axis-aligned — it does not turn. */
  readonly ellipsoid: Vector3Like;
  /** Where the ellipsoid's centre sits relative to `position`. */
  readonly ellipsoidOffset: Vector3Like;
}

/**
 * Slack on the first gather, metres. The radius and the step are everything a
 * sweep reaches unless it is ejected, so this is margin against rounding and
 * against the epsilon push-offs a slide adds — a metre because it costs a box
 * or two, and a list one push short is the re-gather below every frame a body
 * leans on a wall.
 */
const SWEEP_MARGIN = 1;

/**
 * How many times a sweep that outran its list is re-gathered at the reach it
 * needed before the whole map is handed over instead. A re-run from a longer
 * list can slide differently and outrun that too, so the loop is bounded.
 */
const REGATHERS = 3;

/**
 * The gather's knobs, for `scripts/sweep-check.mjs` alone: a deliberately short
 * first reach is the only way the re-gather and the whole-map fallback get run
 * at all, since a real sweep almost never outruns its list. Production passes
 * nothing.
 */
export interface GatherKnobs {
  /** Metres added to every gather's reach; `SWEEP_MARGIN` by default. */
  margin?: number;
  /** The share of the step the first gather allows for; 1 by default. */
  stepShare?: number;
  /** Re-gathers before the whole map; `REGATHERS` by default. */
  regathers?: number;
}

export class CollisionField {
  /**
   * Sweeps that outran their first list, counted since construction — the
   * oracle's evidence that the re-gather ran. Nothing in the game reads it.
   */
  regathered = 0;

  private readonly sweep = new EllipsoidSweep();
  private readonly near: WorldBox[] = [];
  private readonly result: SweepResult = { x: 0, y: 0, z: 0, path: 0 };
  private readonly margin: number;
  private readonly stepShare: number;
  private readonly regathers: number;

  constructor(
    private readonly rays: RayWorld,
    knobs: GatherKnobs = {},
  ) {
    this.margin = knobs.margin ?? SWEEP_MARGIN;
    this.stepShare = knobs.stepShare ?? 1;
    this.regathers = knobs.regathers ?? REGATHERS;
  }

  /**
   * Moves `body` by `step` through the solid world, sliding where it meets
   * something — `mesh.moveWithCollisions(step)`, with `self` the hull doing the
   * sweeping (or null for a body on foot), which is taken out of its own list.
   *
   * The body's position is written only when the sweep moved it by more than
   * `COLLISIONS_EPSILON`, and then by exactly the displacement the sweep found,
   * added to where it stood — Babylon's callback, whose arithmetic this keeps.
   */
  move(body: SweepBody, step: Vector3Like, self: RayHull | null = null): void {
    const p = body.position;
    const e = body.ellipsoid;
    const off = body.ellipsoidOffset;
    const cx = p.x + off.x;
    const cy = p.y + off.y;
    const cz = p.z + off.z;
    const r = this.sweepFrom(cx, cy, cz, e, step, self);
    const dx = r.x - cx;
    const dy = r.y - cy;
    const dz = r.z - cz;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > COLLISIONS_EPSILON) {
      p.set(p.x + dx, p.y + dy, p.z + dz);
    }
  }

  /**
   * The gathered sweep from an ellipsoid CENTRE, answered in a result this
   * owns and refills — `move` without the write-back. Public for the oracle,
   * which starts it where Babylon started (see `ellipsoidSweep.ts`'s `run`).
   */
  sweepFrom(
    cx: number,
    cy: number,
    cz: number,
    radii: Vector3Like,
    step: Vector3Like,
    self: RayHull | null,
  ): SweepResult {
    const rx = radii.x;
    const ry = radii.y;
    const rz = radii.z;
    const flat = Math.max(rx, rz);
    const asked = Math.sqrt(step.x * step.x + step.y * step.y + step.z * step.z);
    const out = this.result;
    let reach = flat + asked * this.stepShare + this.margin;
    for (let tries = 0; ; tries++) {
      this.rays.bodyNear(cx, cz, reach, self, this.near);
      const sweep = this.sweep;
      sweep.begin(rx, ry, rz);
      for (const box of this.near) sweep.addBox(box);
      sweep.run(cx, cy, cz, step.x, step.y, step.z, out);
      // Nothing farther than the radius plus the path, in the ground plane,
      // can have been touched — so the list was enough exactly when the
      // path fits inside what it was gathered for.
      if (flat + out.path <= reach || reach === Infinity) return out;
      if (tries === 0) this.regathered++;
      reach = tries < this.regathers ? flat + out.path + this.margin : Infinity;
    }
  }
}

/**
 * `field.move(body, step, self)`, or — with no field, which is no world at
 * all (`Player.clearGround`, for the menu) — the step taken unobstructed
 * under the same millimetre rule, which is what Babylon's walk over an empty
 * scene did.
 */
export function moveBody(
  field: CollisionField | null,
  body: SweepBody,
  step: Vector3Like,
  self: RayHull | null = null,
): void {
  if (field) {
    field.move(body, step, self);
    return;
  }
  if (Math.sqrt(step.x * step.x + step.y * step.y + step.z * step.z) > COLLISIONS_EPSILON) {
    const p = body.position;
    p.set(p.x + step.x, p.y + step.y, p.z + step.z);
  }
}
