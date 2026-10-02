// The ground each village-, jungle-, city- and harbour-kit kind takes, and which way it faces — shared by
// audit.mjs and plan.mjs.
//
// A mirror of the FOOT tables in scripts/generate-harrowmead.mjs and
// scripts/generate-hollowmere.mjs (each generator still carries its own). If a
// builder's footprint changes, change it in the generators and here.
//
// Every builder's front is its local -Z but the three in `FRONT_PLUS_Z` (the
// city kit's tower, shophouse and depot face their street on +Z). `rotY` of
// π/2 takes local -Z to world -X.

/** `[x0, x1, z0, z1]` in the builder's own frame, front at -Z. Eaves, porches, ramps and wheels included. */
export const FOOT = {
  cottage: (p) => {
    const w = p.width ?? 7;
    const d = p.depth ?? 6;
    return [-w / 2 - 0.8, w / 2 + 0.8, -d / 2 - 1.0, d / 2 + 0.8];
  },
  townhouse: (p) => {
    const w = p.width ?? 6.5;
    const d = p.depth ?? 6.5;
    return [-w / 2 - 0.5, w / 2 + 0.5, -d / 2 - 1.1, d / 2 + 0.6];
  },
  tavern: () => [-7.1, 7.1, -9.2, 5.6],
  smithy: () => [-5.2, 5.2, -6.6, 4.8],
  chapel: () => [-7.4, 7.4, -11.6, 16.6],
  barn: () => [-8.9, 11.9, -11.8, 11.8],
  mill: () => [-7.2, 5.4, -5.8, 5.0],
  boathouse: () => [-6.0, 7.2, -7.0, 7.0],
  silo: () => [-3.2, 3.2, -3.2, 3.2],
  watchtower: () => [-2.8, 2.8, -18.2, 2.8],
  gatehouse: () => [-11.3, 11.3, -8.2, 2.6],
  shed: (p) => {
    const w = p.width ?? 3.4;
    const d = p.depth ?? 2.8;
    return [-w / 2 - 0.3, w / 2 + 0.3, -d / 2 - 0.3, d / 2 + 0.3];
  },
  haystack: () => [-1.6, 1.6, -1.6, 1.6],
  cart: () => [-1.8, 3.8, -1.1, 1.1],
  crates: () => [-1.6, 1.7, -1.3, 1.3],
  woodpile: (p) => {
    const len = p.length ?? 5;
    return [-len / 2 - 0.2, len / 2 + 0.2, -0.7, 0.7];
  },
  trough: () => [-1.6, 1.6, -0.6, 0.6],
  well: () => [-1.7, 1.7, -1.7, 1.7],
  stall: () => [-2, 2, -1.1, 1.1],
  kiln: () => [-2, 2, -2.2, 2],
  shrine: () => [-0.8, 0.8, -0.8, 0.8],
  lamp: () => [-0.4, 1.1, -0.4, 0.4],
  ruin: (p) => {
    const w = p.width ?? 10;
    const d = p.depth ?? 8;
    return [-w / 2 - 0.3, w / 2 + 0.3, -d / 2 - 0.3, d / 2 + 0.3];
  },
  stoneWall: (p) => [-(p.length ?? 12) / 2, (p.length ?? 12) / 2, -0.4, 0.4],
  fence: (p) => [-(p.length ?? 10) / 2, (p.length ?? 10) / 2, -0.25, 0.25],
  bridge: (p) => [-(p.width ?? 3.2) / 2 - 0.3, (p.width ?? 3.2) / 2 + 0.3, -(p.length ?? 12) / 2, (p.length ?? 12) / 2],
  jetty: (p) => [-1.7, 1.7, -(p.length ?? 18) / 2, (p.length ?? 18) / 2],
  ramp: (p) => [-(p.width ?? 5) / 2, (p.width ?? 5) / 2, -(p.length ?? 8) / 2, (p.length ?? 8) / 2],
  // The jungle kit (Greyfen) — mirrored from scripts/generate-greyfen.mjs.
  manor: () => [-14.5, 18, -18.4, 7.4],
  stiltHut: () => [-5, 5, -4.4, 4.4],
  jungleRuin: (p) => {
    const w = p.width ?? 12;
    const d = p.depth ?? 9;
    return [-w / 2 - 1.8, w / 2 + 1.8, -d / 2 - 3.0, d / 2 + 0.6];
  },
  templeRuin: (p) => [-(p.width ?? 26) / 2 - 0.5, (p.width ?? 26) / 2 + 0.5, -(p.depth ?? 22) / 2 - 6, (p.depth ?? 22) / 2 + 0.5],
  trestleBridge: (p) => [-(p.width ?? 3.2) / 2 - 0.4, (p.width ?? 3.2) / 2 + 0.4, -(p.length ?? 26) / 2 - 7, (p.length ?? 26) / 2 + 7],
  boardwalk: (p) => [-(p.width ?? 2.4) / 2 - 0.2, (p.width ?? 2.4) / 2 + 0.2, -(p.length ?? 14) / 2, (p.length ?? 14) / 2],
  // Front (-Z) is the FOOT of the flight; it climbs toward +Z at 0.35.
  stairs: (p) => [-1.4, 1.4, -(p.height ?? 2.5) / 0.35 / 2 - 0.6, (p.height ?? 2.5) / 0.35 / 2],
  fishRack: (p) => [-(p.length ?? 9) / 2 - 0.2, (p.length ?? 9) / 2 + 0.2, -1.1, 1.1],
  careenedHull: (p) => [-1.9, 1.9, -(p.length ?? 11) / 2 - 0.3, (p.length ?? 11) / 2 + 0.3],
  sandbags: (p) => [-(p.length ?? 6) / 2 - 0.1, (p.length ?? 6) / 2 + 0.1, -0.5, 0.5],
  // The city kit (Coldharbour) — mirrored from scripts/generate-coldharbour.mjs.
  // Its street front is +Z for the three in `FRONT_PLUS_Z`; the office's main
  // door is on -Z like everything else.
  tower: (p) => [-(p.width ?? 18) / 2 - 0.4, (p.width ?? 18) / 2 + 0.4, -(p.depth ?? 16) / 2 - 0.4, (p.depth ?? 16) / 2 + 0.4],
  office: (p) => [-(p.width ?? 22) / 2 - 0.3, (p.width ?? 22) / 2 + 0.3, -(p.depth ?? 18) / 2 - 0.3, (p.depth ?? 18) / 2 + 0.3],
  shophouse: (p) => [-(p.width ?? 13) / 2 - 0.2, (p.width ?? 13) / 2 + 0.2, -(p.depth ?? 16) / 2 - 0.2, (p.depth ?? 16) / 2 + 0.4],
  depot: (p) => [-(p.width ?? 28) / 2 - 0.45, (p.width ?? 28) / 2 + 0.45, -(p.depth ?? 16) / 2 - 0.35, (p.depth ?? 16) / 2 + 0.4],
  parkade: (p) => [-(p.width ?? 32) / 2 - 0.3, (p.width ?? 32) / 2 + 0.3, -(p.depth ?? 24) / 2 - 0.3, (p.depth ?? 24) / 2 + 0.3],
  monument: (p) => [-(p.width ?? 11) / 2, (p.width ?? 11) / 2, -(p.width ?? 11) / 2, (p.width ?? 11) / 2],
  planter: (p) => [-(p.width ?? 2.6) / 2, (p.width ?? 2.6) / 2, -(p.depth ?? 1.4) / 2, (p.depth ?? 1.4) / 2],
  barrier: (p) => [-0.31, 0.31, -(p.length ?? 6) / 2, (p.length ?? 6) / 2],
  car: () => [-2.25, 2.25, -1.0, 1.0],
  streetLight: () => [-0.3, 0.3, -0.3, 0.3],
  quay: (p) => [-(p.length ?? 40) / 2, (p.length ?? 40) / 2, -4.44, 0],
  // The harbour kit (Cinderhaven, Coldharbour).
  lighthouse: () => [-5.7, 5.7, -11.2, 5.7],
  crane: () => [-4.2, 4.2, -4.0, 5.6],
  netLoft: (p) => [-(p.width ?? 9) / 2 - 0.45, (p.width ?? 9) / 2 + 0.45, -(p.depth ?? 7) / 2 - 0.45, (p.depth ?? 7) / 2 + 0.45],
};

/** Kinds whose street FRONT is local +Z rather than -Z: the city kit's shopfront, lobby and loading bays. */
export const FRONT_PLUS_Z = new Set(["tower", "shophouse", "depot"]);

/** A kind's front face, as `[localZ, sign]`: where it stands in the builder's frame and which way it looks. */
export function frontOf(p) {
  const [, , z0, z1] = FOOT[p.kind](p.params ?? {});
  return FRONT_PLUS_Z.has(p.kind) ? [z1, 1] : [z0, -1];
}

/** Kinds with a front door that has to open onto a street, a yard or open ground. */
export const DOORS = new Set([
  "cottage", "townhouse", "tavern", "smithy", "chapel", "mill", "barn", "boathouse", "ruin", "jungleRuin", "stiltHut",
  "tower", "office", "shophouse", "depot", "netLoft", "lighthouse",
]);

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
