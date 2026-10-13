/**
 * collision.ts — The shape of a baked collider set, and how to expand one back
 * into `WorldBox`es.
 * Owns: the `MapCollision` type the generated `<map>/collision.ts` files are
 * written against, and the tuple→struct expansion the server rebuilds from.
 * Invariants: this file names no map. The generated modules are reached through
 * `MapDef.collision`, which is a LAZY import so neither bundle carries one.
 * It exists so the multiplayer server and the bake script agree on one format
 * instead of two — and, since the menu's map schematic began drawing real
 * buildings, so that the CLIENT can read the same boxes for a map it has not
 * built (`src/ui/mapPlan.ts`). Only the server EXPANDS them into a world; the
 * interface reads the tuples and draws them.
 *
 * **Every host of the simulation core reads it**:
 * `Match` — a server's, or the page's own local match offline — `simulate`
 * and `corecheck` all build the core's world (`buildSimWorld`) off the
 * COMMITTED bake, which is why `npm run build` refuses one older than its
 * layout. `scripts/bake-collision.mjs` is what writes it, off a built map.
 *
 * Why the data exists: the server simulates with no Babylon and no canvas,
 * and `MapBuilder` builds meshes and reaches a
 * `DynamicTexture` through `floorMaterial`, so it cannot run there. The server
 * rebuilds the solid world from these boxes instead, as data. That is sound
 * because `MapBuilder.collider()` is the one place a collider is made and a
 * `WorldBox` records everything a ray or a sweep asks of it — so both sides
 * answer every query off the same geometry through the same `RayWorld`,
 * rather than through two implementations that can drift. That includes `porous`,
 * which is a flag on the box and therefore part of the geometry: a server that
 * dropped it would rebuild a world whose fences stop rounds the client sent
 * through them.
 */
import type { WorldBox, WorldPane } from "./MapBuilder";

/**
 * One collider, as `[w, h, d, cx, cy, cz, rotX, rotY]`, plus a ninth entry on
 * the few that are `porous` (a fence: a wall to a body, air to a round).
 *
 * A tuple rather than an object because a map carries thousands of them and the
 * field names would be the same eight words repeated tens of thousands of times
 * in a generated file somebody has to review the diff of.
 *
 * The porous flag is OPTIONAL rather than a `0` on every row for the same
 * reason: it is true of a few dozen boxes out of hundreds, and writing it out
 * everywhere is a column of zeroes in a file that is reviewed as a diff. It
 * must nonetheless be baked — the server resolves every shot, so a fence it
 * thinks is solid is a fence that eats hits the shooter watched land.
 */
export type CollisionBox = readonly [
  w: number,
  h: number,
  d: number,
  cx: number,
  cy: number,
  cz: number,
  rotX: number,
  rotY: number,
  porous?: 0 | 1,
];

/**
 * One breakable pane of glass, as `[w, h, d, cx, cy, cz, rotY, box]`.
 *
 * Seven numbers and an index. There is no `rotX` — a pane is a sheet in a wall
 * and nothing in the kit tilts one — and `box` is its position in `boxes`: the
 * collider that holds a body out of the opening until the pane goes.
 *
 * **What is deliberately NOT baked is the vertex range.** A pane's identity on
 * the wire is its position in this array, which both sides build in the same
 * order; where its 24 positions sit in a merged mesh is a fact about geometry
 * the server does not have and will never draw. `WorldPane` carries both
 * because the client fills in the half the bake omits.
 */
export type CollisionPane = readonly [
  w: number,
  h: number,
  d: number,
  cx: number,
  cy: number,
  cz: number,
  rotY: number,
  box: number,
];

/** One map's baked collider set. Generated — see `scripts/bake-collision.mjs`. */
export interface MapCollision {
  /**
   * Hash over the map's `layout.ts` and `heights.ts` at the time of the bake.
   * `npm run build` refuses to proceed when it no longer matches, because a
   * stale bake is a server whose walls are somewhere else from its clients'.
   */
  sourceHash: string;
  boxes: readonly CollisionBox[];
  /**
   * The `strut` boxes — ray geometry with no body behind it — **grouped as the
   * client merged them**, one inner array per collider mesh.
   *
   * Separate from `boxes` because these are not the solid world: nothing
   * derived from geometry may see them (see `BoxSpec.rayOnly`), and `boxes` is
   * exactly the list `NavGrid`, `CoverMap` and `ObstacleField` are handed. The
   * grouping is baked rather than a flat list because the server merges each
   * group into one mesh the way the client does, and merging every fence on
   * the map into a single mesh would put one bounding box around the whole
   * village — every ray in the process would then pay for every fence's
   * triangles.
   */
  rayGroups: readonly (readonly CollisionBox[])[];
  /**
   * Which `boxes` the client merged into one collider mesh each, as indices
   * into that array — a scatter region's props, grouped by locality.
   *
   * The mirror of `rayGroups` and not its twin: these boxes ARE the solid
   * world and ARE in `boxes`, so the nav grid, the cover bake and the obstacle
   * field see every one of them separately. The grouping says nothing about
   * the world's shape: it is which meshes the client made, and in what order,
   * and what still reads it is a body's SWEEP, whose ties go by that order
   * (`RayWorld`'s rank) — so the authority's hulls break them as the client's
   * do. It began as a pick budget, when a pick cost per mesh and a jungle belt
   * was hundreds of one-metre trunks.
   *
   * Every index that appears here is left out of the one-mesh-per-box pass, so
   * a box belongs to exactly one mesh either way. Boxes named by no group are
   * their own mesh, which is every collider a structure builds.
   *
   * Optional so a map baked before clustering existed still loads: absent
   * reads as a map whose every box is its own mesh, which is what the bake
   * always produced.
   */
  boxGroups?: readonly (readonly number[])[];
  /**
   * Every pane of glass a round can take away, in the client's build order —
   * which is what makes the index into this array a name both processes agree
   * on, and therefore what a `glass` event on the wire is allowed to carry.
   *
   * Not the glazing, which is most of the glass and is drawn on one side only:
   * a sheet with something solid behind it opens nothing, so the authority has
   * no use for it and the bake does not carry it (see `PaneSpec.breakable`).
   * Coldharbour draws ~6,100 sheets and bakes twenty-four.
   *
   * Optional so a map baked before glass existed still loads: absent reads as a
   * map with no glazing, which is what every map but Coldharbour is.
   */
  panes?: readonly CollisionPane[];
}

function toWorldBox([
  w,
  h,
  d,
  cx,
  cy,
  cz,
  rotX,
  rotY,
  porous,
]: CollisionBox): WorldBox {
  const box: WorldBox = { w, h, d, cx, cy, cz, rotX, rotY };
  // Only when set, so a rebuilt box is key-for-key what `MapBuilder.collider`
  // produced — `porous: undefined` and no key at all read the same to every
  // consumer, but only one of them is the same object.
  if (porous) box.porous = true;
  return box;
}

/** Expands a baked set into the `WorldBox`es `NavGrid` and friends consume. */
export function toWorldBoxes(collision: MapCollision): WorldBox[] {
  return collision.boxes.map(toWorldBox);
}

/** The ray-only geometry, still grouped by the mesh each group merges into. */
export function toRayGroups(collision: MapCollision): WorldBox[][] {
  return collision.rayGroups.map((group) => group.map(toWorldBox));
}

/**
 * Expands the baked panes into the `WorldPane`s `GlassSystem` sweeps against.
 *
 * The two vertex fields come back as zeroes rather than being made up, and that
 * is honest rather than lossy: they address a merged mesh, the server has none,
 * and `paneGroups` is empty there for the same reason. Anything reading them on
 * this side is reading a mesh it does not have.
 */
export function toWorldPanes(collision: MapCollision): WorldPane[] {
  return (collision.panes ?? []).map(
    ([w, h, d, cx, cy, cz, rotY, box]): WorldPane => ({
      w,
      h,
      d,
      cx,
      cy,
      cz,
      rotY,
      vertexStart: 0,
      vertexCount: 0,
      group: -1,
      box,
    }),
  );
}
