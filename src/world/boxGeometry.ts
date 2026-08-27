/**
 * boxGeometry.ts — The analytic WorldBox primitives, and nothing else.
 * Owns: the box-frame transform, the top-face plane, the slab span, and the
 * XZ segment test. Pure functions, no Babylon, no allocation beyond the two
 * small results that say so in their signature — and a rejection says `null`,
 * so it must not allocate either. The one piece of state is `LOCAL`, the
 * private scratch that keeps the footprint test off the allocator; it never
 * escapes a call.
 *
 * Why this exists as a shared file rather than a helper in each caller: the
 * top-face plane is sign-sensitive and was written out independently in
 * `NavGrid.topFaceHeight` and `ObstacleField.push`, with the same warning
 * comment copy-pasted onto both. `CoverMap` needs it a third time, and cover
 * computed from different geometry than collision is how you get bots hiding
 * behind nothing. There is now exactly one site to get wrong.
 *
 * Invariants: half-thickness is h/2/cos(rotX) and the slope is tan(rotX) —
 * writing it as h/2*cos and -tan is the easy sign error and it silently makes
 * every ramp unwalkable. Every footprint here is `halfDepth`, never `d / 2`:
 * a pitched slab covers more ground than its depth, and the two only agree at
 * zero pitch.
 *
 * THERE ARE TWO FOOTPRINTS AND THEY ARE NOT THE SAME ONE. `halfDepth` is the
 * SOLID's ground projection — where the box IS — and it is what a barrier test
 * and a push-out want. `topFaceHalfDepth`/`topFaceCentreZ` are the TOP FACE's
 * own ground projection — where the box has a surface you could stand on — and
 * it is what every height query wants, because the top-face PLANE is only a
 * plane and the face is a finite rectangle sitting on part of it. Asking the
 * plane about ground the face does not cover is the bug this pair exists to
 * close: it extrapolates, and at the far edge of the uncovered strip it
 * overshoots by exactly one `slabThickness`. See `topFaceHalfDepth`.
 */
import type { WorldBox } from "./MapBuilder";

/**
 * Below this the box is pitched to (or past) vertical and its top face stops
 * being a function of position at all, so every query here refuses rather than
 * dividing by something near zero.
 */
const MIN_COS = 1e-4;

/**
 * Half-depth of the box's footprint in its own frame. A slab tilted by `rotX`
 * covers more ground than its depth, so the pitch grows this.
 */
export function halfDepth(box: WorldBox): number {
  return (
    (box.d / 2) * Math.abs(Math.cos(box.rotX)) +
    (box.h / 2) * Math.abs(Math.sin(box.rotX))
  );
}

/**
 * Local-Z centre of the TOP FACE's own ground projection — signed, because a
 * pitch leans the face off the box's own centre line and which way it leans is
 * the whole point.
 *
 * The top face is `y = h/2` swept over `z` in `[-d/2, d/2]`, and the pitch
 * carries a point `(y, z)` to `Z = y sin + z cos`. So the face's shadow is an
 * interval of half-width `(d/2)|cos|` centred on `(h/2) sin`, while the SOLID's
 * shadow is `halfDepth` about zero. The two share one end and the face is inset
 * from the other by `h |sin|` — which is the strip where a box has ground under
 * it and no top face over it, and where every query here used to answer with an
 * extrapolation of a plane that had run out of face.
 */
export function topFaceCentreZ(box: WorldBox): number {
  return (box.h / 2) * Math.sin(box.rotX);
}

/**
 * Half-depth of the TOP FACE's own ground projection. `halfDepth`'s mirror, and
 * read the pair together: this one is always the smaller, they are equal at
 * zero pitch, and their difference is the `h |sin|` strip above.
 *
 * WHY THE DIFFERENCE MATTERS AT ALL, since the strip is narrow. Inside it the
 * top-face plane keeps climbing at `tan(rotX)` over ground the face does not
 * reach, and at the far edge it stands exactly `slabThickness` — a whole box
 * height — above the highest point the box actually has there. On the shipped
 * maps that is a stair parapet claiming a surface a metre up, a third of a metre
 * past the foot of its own flight, in the open air beside it. `NavGrid` could
 * live with that (a phantom node is a routing nuisance) and a GROUND PROBE
 * could not, because it stands a player on air — which is the whole of why
 * `Player.probeGround` stayed a whole-scene ray pick for as long as it did.
 * FINDINGS 6 carries the measurement.
 */
export function topFaceHalfDepth(box: WorldBox): number {
  return (box.d / 2) * Math.abs(Math.cos(box.rotX));
}

/**
 * Clamps a local Z into the span the top face actually covers.
 *
 * For the two callers that deliberately ask about a point OUTSIDE the face and
 * want a height anyway — `NavGrid.severLinks` sampling where a link crosses a
 * box, `ObstacleField.push` sampling where a body contacts one. Both want "how
 * tall is this box near here", not "what is under my feet", and both took
 * `halfDepth` before, which handed them the extrapolation rather than a height
 * the box has. Clamping into the face returns its nearest EDGE instead, which
 * is the tallest thing genuinely there and keeps both of them conservative in
 * the direction they need — `severLinks` cuts a link it is unsure of, `push`
 * holds a body out.
 */
export function clampToTopFace(box: WorldBox, lz: number): number {
  const centre = topFaceCentreZ(box);
  const half = topFaceHalfDepth(box);
  return lz < centre - half ? centre - half : lz > centre + half ? centre + half : lz;
}

/** Vertical thickness of the slab: a slab tilted by theta is h/cos(theta) thick. */
export function slabThickness(box: WorldBox): number {
  return box.h / Math.max(Math.abs(Math.cos(box.rotX)), MIN_COS);
}

/**
 * Height of the box's top face at `lz` — the *post*-rotation local Z of a point
 * in the box's own frame. Null for a box pitched to vertical.
 *
 * This is the one place the pitch math lives. The top face is a plane through
 * local (0, h/2, 0) tilted by `rotX`; written against the post-rotation Z that
 * gives a half-thickness of h/2/cos and a slope of tan. Not h/2*cos and -tan.
 *
 * It is analytic rather than an axis-aligned bounds lookup because a ramp's
 * bounding box reports its peak across the whole footprint and reads as a wall.
 */
export function topFaceAtLocalZ(box: WorldBox, lz: number): number | null {
  const cx = Math.cos(box.rotX);
  if (Math.abs(cx) < MIN_COS) return null;
  return box.cy + box.h / 2 / cx - lz * (Math.sin(box.rotX) / cx);
}

/** A point in a box's own XZ frame. */
export interface LocalXZ {
  lx: number;
  lz: number;
}

/**
 * Rotates a world XZ point into the box's own frame, into `out`. No extents
 * test — that is `toLocalXZ`'s job, and the callers that pad the footprint or
 * ask about it in more than two dimensions do it themselves.
 *
 * THE ONE PLACE THE YAW CONVENTION LIVES, and it is here because it had already
 * been got wrong. The transform is world→local, so it rotates by *minus* rotY;
 * the inverse — `[[cos, sin], [-sin, cos]]`, which is what `MapBuilder.rotateY`
 * uses to *place* a collider — reflects the test across the box instead. That
 * is invisible on anything square and wrong on everything longer than it is
 * deep, and it is what `MapBuilder.insideCollider` did while carrying a comment
 * describing the correct convention: scatter's burial rejection was mirrored
 * around every yaw-rotated building in the game, accepting props inside walls
 * and refusing them in the open ground beside one.
 *
 * Takes an `out` because the two callers that matter run it several million
 * times per map build.
 */
export function rotateToLocalXZ(
  box: WorldBox,
  x: number,
  z: number,
  out: LocalXZ,
): LocalXZ {
  const dx = x - box.cx;
  const dz = z - box.cz;
  if (box.rotY === 0) {
    out.lx = dx;
    out.lz = dz;
    return out;
  }
  const c = Math.cos(box.rotY);
  const s = Math.sin(box.rotY);
  out.lx = dx * c - dz * s;
  out.lz = dx * s + dz * c;
  return out;
}

/**
 * The scratch behind the footprint test, and the module's one piece of state.
 * A test has to rotate before it can answer, so writing the rotation into the
 * caller's result would put an allocation on the REJECTING path — which is the
 * overwhelming majority, because every caller sweeps a rectangle sized to the
 * box's reach and asks about a footprint several times smaller inside it.
 * Nothing may hold this across a call: `toLocalXZ` copies out of it and
 * `topFaceHeight` reads one field and drops it.
 */
const LOCAL: LocalXZ = { lx: 0, lz: 0 };

/** Rotates into `LOCAL` and answers whether the point is inside the footprint. */
function intoFootprint(box: WorldBox, x: number, z: number): boolean {
  rotateToLocalXZ(box, x, z, LOCAL);
  return Math.abs(LOCAL.lx) <= box.w / 2 && Math.abs(LOCAL.lz) <= halfDepth(box);
}

/**
 * The same, against the TOP FACE's own footprint rather than the solid's — the
 * gate on every height query here. See the header: outside it the box still has
 * ground under it, but what stands over that ground is an END face, and the
 * top-face plane asked about it answers with an extrapolation that runs up to a
 * whole `slabThickness` above anything really there. Refusing is right and is
 * also the safe direction: a height query that declines falls through to
 * whatever the caller has underneath — the terrain, for the ground probe — and
 * one that invents a surface stands a body on air.
 */
function intoTopFace(box: WorldBox, x: number, z: number): boolean {
  rotateToLocalXZ(box, x, z, LOCAL);
  return (
    Math.abs(LOCAL.lx) <= box.w / 2 &&
    Math.abs(LOCAL.lz - topFaceCentreZ(box)) <= topFaceHalfDepth(box)
  );
}

/**
 * Transforms a world XZ point into the box's local frame, returning null when
 * it falls outside the footprint. Allocates its result only once that has
 * passed.
 */
export function toLocalXZ(box: WorldBox, x: number, z: number): LocalXZ | null {
  if (!intoFootprint(box, x, z)) return null;
  return { lx: LOCAL.lx, lz: LOCAL.lz };
}

/**
 * Height of the box's top face above `(x, z)` in world space, or null when the
 * box has no top face over that spot. Allocates on neither path — it wants one
 * number out of the local point, so it reads the scratch rather than going
 * through `toLocalXZ` for a result it would drop. This is the query the nav
 * bake runs per cell per box.
 *
 * **The gate is `intoTopFace`, not `intoFootprint`**, and the difference is the
 * whole of what made this query untrustworthy for a ground probe. Validated
 * against a brute-force downward ray at the real rotated box over 640k samples
 * on 400 random boxes pitched to +-60 deg: it now answers on exactly the spots
 * where that ray lands on the top face, with the same height to 4e-12 m, and
 * declines on exactly the spots where it does not. The footprint gate answered
 * on 1.5% of samples with no standable surface under them at all, by as much as
 * 6 m.
 */
export function topFaceHeight(box: WorldBox, x: number, z: number): number | null {
  if (!intoTopFace(box, x, z)) return null;
  return topFaceAtLocalZ(box, LOCAL.lz);
}

/**
 * The vertical slab a box occupies above `(x, z)`, or null where it has no top
 * face there — `topFaceHeight`'s gate, so the span is `[top - slabThickness,
 * top]` exactly where that is the box's true extent and null where it is not.
 * `NavGrid.clearBlocked` is the caller, and what it gives up is headroom
 * blocking over the `h |sin|` strip beside a pitched box: the widest such strip
 * on any shipped map is 0.34 m, and `severLinks` and `ObstacleField.push` both
 * still work off the SOLID footprint there.
 */
export function verticalSpan(
  box: WorldBox,
  x: number,
  z: number,
): { bottom: number; top: number } | null {
  const top = topFaceHeight(box, x, z);
  if (top === null) return null;
  return { bottom: top - slabThickness(box), top };
}

/**
 * True when the XZ segment from (x0,z0) to (x1,z1) crosses the box's footprint.
 * Slab test in the box's own frame, so a rotated wall is handled without
 * inflating it to an AABB.
 *
 * The depth half-extent is `halfDepth`, so a PITCHED box is answered for
 * correctly too — it reduces to `d / 2` at zero pitch, so nothing that was
 * already passing flat boxes changes. This used to be `d / 2` outright, with a
 * contract line telling callers to exclude pitched boxes; `NavGrid.severLinks`
 * obeyed it by skipping every pitched box, which is how a stair's PARAPET —
 * pitched, because it rails a pitched flight — came to sever nothing at all.
 * A footprint test says where a box is, not whether it is a barrier; that
 * second question belongs to the caller, which is where it now lives.
 */
export function segmentHitsBox(
  box: WorldBox,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): boolean {
  const c = Math.cos(-box.rotY);
  const s = Math.sin(-box.rotY);
  const dx0 = x0 - box.cx;
  const dz0 = z0 - box.cz;
  const dx1 = x1 - box.cx;
  const dz1 = z1 - box.cz;
  const ax = dx0 * c + dz0 * s;
  const az = -dx0 * s + dz0 * c;
  const bx = dx1 * c + dz1 * s;
  const bz = -dx1 * s + dz1 * c;

  let t0 = 0;
  let t1 = 1;
  const half: [number, number] = [box.w / 2, halfDepth(box)];
  const from: [number, number] = [ax, az];
  const dir: [number, number] = [bx - ax, bz - az];
  for (let axis = 0; axis < 2; axis++) {
    const d = dir[axis];
    const p = from[axis];
    const h = half[axis];
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(p) > h) return false;
      continue;
    }
    let near = (-h - p) / d;
    let far = (h - p) / d;
    if (near > far) [near, far] = [far, near];
    if (near > t0) t0 = near;
    if (far < t1) t1 = far;
    if (t0 > t1) return false;
  }
  return true;
}
