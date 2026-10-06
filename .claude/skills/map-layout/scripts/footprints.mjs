// The ground each village-, jungle-, city- and harbour-kit kind takes, and which way it faces — shared by
// audit.mjs and plan.mjs.
//
// The TABLE is the generators' own, `scripts/lib/footprints.mjs` — one copy for
// every generator and these scripts, measured off the builders and checked by
// `npm run kit:hash -- --feet`. A builder whose footprint changes owes an edit
// there and nowhere else. What is here is only the geometry the audit and the
// plan ask of it.
//
// Every builder's front is its local -Z but the three in `FRONT_PLUS_Z` (the
// city kit's tower, shophouse and depot face their street on +Z). `rotY` of
// π/2 takes local -Z to world -X.

import { DOORS, FOOT, FRONT_PLUS_Z } from "../../../../scripts/lib/footprints.mjs";

export { DOORS, FOOT, FRONT_PLUS_Z };

/** A kind's front face, as `[localZ, sign]`: where it stands in the builder's frame and which way it looks. */
export function frontOf(p) {
  const [, , z0, z1] = FOOT[p.kind](p.params ?? {});
  return FRONT_PLUS_Z.has(p.kind) ? [z1, 1] : [z0, -1];
}

/** Kinds that are buildings: the ones a slope check applies to strictly. */
export const BUILDINGS = new Set([...DOORS, "silo", "watchtower", "gatehouse", "shed", "kiln", "parkade", "crane", "monument"]);

/** The world offset of a local one under a placement's `rotY` (Babylon's rotation.y). */
export function rotate(lx, lz, rotY = 0) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return [lx * c + lz * s, -lx * s + lz * c];
}

/** The four world corners of a placement's footprint, or null for a kind with no entry. */
export function corners(p) {
  const f = FOOT[p.kind];
  if (!f) return null;
  const [x0, x1, z0, z1] = f(p.params ?? {});
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([a, b]) => {
    const [dx, dz] = rotate(a, b, p.rotY ?? 0);
    return [p.x + dx, p.z + dz];
  });
}

/** Axis-aligned bounds of a placement's footprint. */
export function bounds(p) {
  const c = corners(p);
  if (!c) return null;
  const xs = c.map((q) => q[0]);
  const zs = c.map((q) => q[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

/** Point-in-footprint, in the placement's own frame (exact for any rotation). */
export function inside(p, x, z, pad = 0) {
  const f = FOOT[p.kind];
  if (!f) return false;
  const [x0, x1, z0, z1] = f(p.params ?? {});
  const [lx, lz] = rotate(x - p.x, z - p.z, -(p.rotY ?? 0));
  return lx >= x0 - pad && lx <= x1 + pad && lz >= z0 - pad && lz <= z1 + pad;
}
