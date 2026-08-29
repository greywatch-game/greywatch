/**
 * server/world.ts — Rebuilds a map's SOLID world under a NullEngine, from the
 * baked collider set plus the layout.
 * Owns: the collider meshes `moveWithCollisions` walks, the terrain floor's
 * collider clones, and the nav/cover/obstacle/ray structures built from them.
 *
 * **THE MESHES ARE NO LONGER WHAT A SHOT IS RESOLVED AGAINST, and they are
 * still required.** They existed so this process's `scene.pickWithRay` had
 * something to pick; every ray on both sides is a box query now (`RayWorld`,
 * `ENGINE_UPGRADE.md` wall 2), so nothing here is picked at all. What still
 * needs them is `Vehicle.update`, which drives a hull with
 * `body.moveWithCollisions` — and the authority simulates its own hulls. So a
 * pass that deleted this geometry as dead weight would leave armour driving
 * through walls on the server and stopping at them on every client, which is
 * the worst-shaped disagreement this file exists to prevent.
 * Invariants: this is the collider half of `MapBuilder.build` and nothing else
 * — no visuals, no materials, no textures, no AO bake, and the two merges here
 * (`strutMesh`, `clusterMesh`) merge COLLIDERS and draw nothing. It must produce
 * geometry that lines up with the client's exactly, or a shot that lands on a
 * wall here passes through it there.
 *
 * Why a rebuild and not a build: the server has no canvas, so
 * `DynamicTexture.getContext()` throws and `MapBuilder` cannot run at all (it
 * reaches one through `floorMaterial`). See `scripts/bake-collision.mjs`.
 *
 * Two sources, and the split is not arbitrary:
 *
 *   - **The boxes are baked**, because they come out of the structure builders
 *     and those build meshes and read textures. `MapBuilder.collider()` is the
 *     only place a collider is made and the `WorldBox` it records carries
 *     everything `CreateBox` needs, so the bake is lossless.
 *   - **Everything else is read from the map's own data**, because it is
 *     already data or already arithmetic: control points and spawns pass
 *     through `MapBuilder.build` untouched off the layout, and the floor is
 *     `TerrainField` over the heightfield — which is a lazy `import()` beside
 *     the bake rather than a field on the layout, and so is awaited here (see
 *     `MapDef.heights`). Baking those too would be three more things that can
 *     go stale for no gain.
 *
 * The four boundary boxes need no special handling — `collider()` made them,
 * so they are in the bake like everything else, and they keep the `w > 200 ||
 * d > 200` shape that `NavGrid`, `ObstacleField` and `CoverMap` identify the
 * boundary by.
 */
import { Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../src/config";
import {
  toRayGroups,
  toWorldBoxes,
  toWorldPanes,
  type MapCollision,
} from "../src/world/collision";
import { CoverMap } from "../src/world/CoverMap";
import type { GameMap, WorldBox } from "../src/world/MapBuilder";
import { BLOCK_SIZE } from "../src/world/MapBuilder";
import type { MapDef } from "../src/world/maps";
import { NavGrid } from "../src/world/NavGrid";
import { ObstacleField } from "../src/world/ObstacleField";
import { RayWorld } from "../src/world/RayWorld";
import { roadRects } from "../src/world/roads";
import { TerrainField, terrainPatches } from "../src/world/TerrainField";

/**
 * Builds one collider box, matching `MapBuilder.collider()` exactly.
 *
 * The flags are copied even though nothing here reads them any more, and that
 * is deliberate: `MapBuilder`'s mesh carries them, the editor's predicate
 * reads them there, and a mesh on this side that describes itself differently
 * from its twin is a difference a future reader would have to rediscover. The
 * flags that DECIDE anything travel on the `WorldBox` — that is what
 * `RayWorld`, `NavGrid`, `CoverMap` and `ObstacleField` all read. They are
 * copied rather than shared because the two functions build from different
 * inputs — one from a `BoxSpec` in a structure's local frame, one from a
 * `WorldBox` already in world space — and the only thing they have in common
 * is the result.
 */
function colliderBox(scene: Scene, box: WorldBox, i: number): Mesh {
  const mesh = MeshBuilder.CreateBox(
    `col${i}`,
    { width: box.w, height: box.h, depth: box.d },
    scene,
  );
  mesh.position.set(box.cx, box.cy, box.cz);
  mesh.rotation.set(box.rotX, box.rotY, 0);
  mesh.isVisible = false;
  mesh.isPickable = true;
  // `checkCollisions` is what `moveWithCollisions` walks, and it is the ONE
  // thing on this side that still needs these meshes at all: a bot or a human
  // driving a hull is simulated here, and `Vehicle.update` moves it that way. The
  // legs never touched this list — a client does its own movement and
  // `validateMove` checks the result analytically — and neither did the bots.
  mesh.checkCollisions = true;
  // `porous` copied through so the mesh describes itself the way the client's
  // twin does. The flag that DECIDES a shot rides on the `WorldBox` and is read
  // by `RayWorld`; see the header on why both sides still carry it.
  mesh.metadata = box.porous ? { solid: true, porous: true } : { solid: true };
  mesh.freezeWorldMatrix();
  return mesh;
}

/**
 * One group of `strut` boxes as the single collider mesh the client merged them
 * into — a fence's posts and rails.
 *
 * **This is the one merge on the server**, and it is here because the client
 * merges the same group and the two worlds must be the same shape. The
 * header's "no merges" is about visuals: there is nothing to draw here and
 * this produces no material, no texture and no draw call. Group by group,
 * exactly as baked, because a merge is a decision the CLIENT made and this
 * side has to reproduce it rather than invent one.
 *
 * **A strut stops a round and is no body at all, so `checkCollisions` is off
 * and this mesh is now inert on this side** — what a round meets is
 * `RayWorld`'s copy of `rayGroups`, and what a hull meets is the boxes above.
 * Nothing here is in `colliderBoxes`, so the nav graph, the cover bake and the
 * obstacle field never see a rail either, which is what keeps this world
 * identical to the one `npm run parity` compares.
 */
/**
 * One group of a scatter region's boxes as the single collider mesh the client
 * merged them into — a dozen tree trunks in a 12 m square.
 *
 * **The second merge on the server, and it exists for the same reason as the
 * first**: the client merged these and the two worlds must be the same shape.
 * It used to be a budget argument as well — a pick costs per mesh before it
 * costs per triangle, and Greyfen's ~950 one-metre trunks unmerged would be
 * more collider meshes than the rest of the map put together — and that half
 * went with the picks. Group by group exactly as baked, never all in one.
 *
 * Unlike a strut, every box in here IS in `colliderBoxes`, so the nav grid, the
 * cover bake and the obstacle field still see individual trunks. The merge is
 * about nothing but what a ray meets. `MapBuilder.clusterColliders` is the
 * client's half, and both refuse to group anything but plain `solid` boxes —
 * one mesh cannot carry two answers about porosity, and glass has to stay
 * addressable a sheet at a time.
 */
function clusterMesh(scene: Scene, group: WorldBox[], i: number): Mesh {
  const parts = group.map((box, j) => {
    const part = MeshBuilder.CreateBox(
      `clump${i}-${j}`,
      { width: box.w, height: box.h, depth: box.d },
      scene,
    );
    part.position.set(box.cx, box.cy, box.cz);
    part.rotation.set(box.rotX, box.rotY, 0);
    return part;
  });
  const merged =
    parts.length === 1
      ? parts[0]
      : Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!merged) throw new Error(`cluster ${i} failed to merge`);
  merged.name = `clump${i}`;
  merged.isVisible = false;
  merged.isPickable = true;
  merged.checkCollisions = true;
  merged.metadata = { solid: true };
  merged.freezeWorldMatrix();
  return merged;
}

function strutMesh(scene: Scene, group: WorldBox[], i: number): Mesh {
  const parts = group.map((box, j) => {
    const part = MeshBuilder.CreateBox(
      `timber${i}-${j}`,
      { width: box.w, height: box.h, depth: box.d },
      scene,
    );
    part.position.set(box.cx, box.cy, box.cz);
    part.rotation.set(box.rotX, box.rotY, 0);
    return part;
  });
  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!merged) throw new Error(`strut group ${i} failed to merge`);
  merged.name = `timber${i}`;
  merged.isVisible = false;
  merged.isPickable = true;
  merged.checkCollisions = false;
  merged.metadata = { solid: true, rayOnly: true };
  merged.freezeWorldMatrix();
  return merged;
}

/**
 * The floor, as collider clones — one mesh per terrain block.
 *
 * This is the one collider in the game that is not a box, and the one that
 * carries `surface: "ground"`. It matters here for the same reason it matters
 * on the client: without it, line of sight runs straight through hills, and a
 * bot on the far side of a rise is visible to one that should not see it.
 * `terrainPatches` is pure arithmetic over the heightfield, so it costs the
 * server nothing that the bake would have saved.
 */
function terrainColliders(
  scene: Scene,
  terrain: TerrainField,
  size: number,
  /** `MapLayout.terrainBlock`, or `BLOCK_SIZE`. See `buildServerWorld`. */
  terrainBlock: number,
): Mesh[] {
  const out: Mesh[] = [];
  for (const patch of terrainPatches(terrain, size, terrainBlock)) {
    const col = new Mesh(`terrain-${patch.key}-col`, scene);
    patch.data.applyToMesh(col);
    col.isVisible = false;
    col.isPickable = true;
    // Vertical placement is the ground probe's job — the same reason the client
    // keeps the floor out of `moveWithCollisions`.
    col.checkCollisions = false;
    col.metadata = { solid: true, surface: "ground" };
    col.freezeWorldMatrix();
    out.push(col);
  }
  return out;
}

/**
 * Rebuilds `def`'s solid world into `scene`.
 *
 * Returns a real `GameMap` so the systems that consume one need no server-only
 * variant — `BattleSystem.setMap` reads `nav`/`cover`/`obstacles` and
 * `ConquestSystem.start` reads `controlPoints`/`spawns`, and both get exactly
 * what they get on the client. The two fields that are genuinely absent are
 * `visuals` (there is nothing to draw) and `editor` (there is no editor); both
 * are empty rather than faked.
 */
export async function buildServerWorld(scene: Scene, def: MapDef): Promise<GameMap> {
  const collision: MapCollision = (await def.collision()).default;
  // The layout's own extent, exactly as `MapBuilder.build` reads it: a server
  // that took the global would rasterize a larger map's nav grid over a 240 m
  // square and steer bots against a world a third the size of the clients'.
  const size = def.layout.size ?? CONFIG.map.size;
  // How far the floor carries on past that square. Read from the layout for the
  // same reason `size` is: a server that took the default would put the ground
  // to an abrupt stop at ±size/2 and reject every honest player standing in the
  // borderland its clients are drawing. `terrainColliders` needs no telling —
  // the extent is the FIELD's, and `terrainPatches` reads it off this object.
  const margin = def.layout.borderland?.margin ?? 0;
  // How the map is CUT, read off the layout for the third time the same reason
  // `size` and `margin` are: a server that took the defaults would tessellate a
  // floor on a different lattice from the one its clients are standing on, and
  // line of sight over a rise is measured against these meshes. `blockSize`
  // decides nothing here — there is no merge and nothing to draw — but it is
  // carried on the map so that a `GameMap` from this file cannot disagree with
  // one from `MapBuilder` about what the map IS.
  const blockSize = def.layout.blockSize ?? BLOCK_SIZE;
  const terrainBlock = def.layout.terrainBlock ?? BLOCK_SIZE;
  // The floor, which is no longer on the layout: it is a lazy `import()` of its
  // own (`MapDef.heights`, ENGINE_UPGRADE.md S7), for the reason `collision`
  // above is one. Awaited beside it rather than bundled — the boxes are baked
  // and the ground is arithmetic, and this process needs both.
  const heights = def.heights ? (await def.heights()).default : undefined;
  const terrain = new TerrainField(heights, margin, def.layout.borderland?.roll);
  const boxes = toWorldBoxes(collision);

  // A box gets one mesh, unless the client merged it with its neighbours into a
  // cluster — see `MapCollision.boxGroups`. `byBox` is what keeps the pane
  // wiring below able to name a box's mesh either way; a clustered box has
  // none of its own and never is a pane.
  const byBox: (Mesh | null)[] = boxes.map(() => null);
  const grouped = new Set<number>();
  const colliders: Mesh[] = [];
  for (const [i, group] of (collision.boxGroups ?? []).entries()) {
    for (const b of group) grouped.add(b);
    colliders.push(clusterMesh(scene, group.map((b) => boxes[b]), i));
  }
  for (const [i, box] of boxes.entries()) {
    if (grouped.has(i)) continue;
    byBox[i] = colliderBox(scene, box, i);
    colliders.push(byBox[i]!);
  }
  // A pane's collider carries the pane index back, exactly as
  // `MapBuilder.paneGroup` stamps it on the client — so `GlassSystem` finds the
  // same mesh on both sides and a broken pane leaves the pick predicates here
  // too. A pane is never clustered (glass has to stay addressable one sheet at
  // a time, and the client refuses to group it), so `byBox` always has its mesh.
  const panes = toWorldPanes(collision);
  for (const [i, p] of panes.entries()) {
    if (p.box < 0 || !byBox[p.box]) continue;
    // Two marks, in the two places the client's `MapBuilder` puts them. The
    // mesh carries the pane index back, so `GlassSystem` finds the same mesh on
    // both sides. The BOX carries `glass`, which is what `clearCollider` reads
    // as its own idempotence flag — without it the authority breaks the visual
    // nobody here draws and leaves the collider standing, so a player who shot
    // a shopfront out is snapped back out of it by `validateMove`.
    //
    // Derived from `panes` rather than baked as a tenth tuple entry: the pane
    // list already says which boxes are glass, and two sources for one fact is
    // one that can go stale. `porous` IS baked, because it is a property of the
    // box independent of any pane.
    byBox[p.box]!.metadata.pane = i;
    boxes[p.box].glass = true;
  }
  const rayGroups = toRayGroups(collision);
  colliders.push(...rayGroups.map((group, i) => strutMesh(scene, group, i)));
  const floor = terrainColliders(scene, terrain, size, terrainBlock);
  colliders.push(...floor);

  // Same order and same inputs as `MapBuilder.build`: the graph is derived from
  // the finished collider set, never from the geometry that suggested it.
  const nav = new NavGrid(size, boxes, terrain, def.layout.surfaces);
  const cover = new CoverMap(nav, boxes);
  const obstacles = new ObstacleField(size, boxes);
  // The segment query, off the same two lists the meshes above were built from
  // plus the same floor. It is what makes those meshes a convenience rather
  // than the reason this file exists: every ray the shared systems fire — the
  // rewound hitscan, sixteen bots' line of sight, the grenade, the rocket —
  // goes through this and never through the scene.
  const rays = new RayWorld(size, boxes, rayGroups, terrain);

  // One flow field per objective, plus a route home per team — the set
  // `BattleSystem.fieldFor`/`homeFieldFor` ask for by name.
  //
  // The two radii are `MapBuilder.build`'s and must stay equal to it: a goal
  // radius decides how big the flat-bottomed basin at the end of the field is,
  // so a server that used a different one would send bots to a subtly different
  // place from where the clients draw them walking.
  for (const cp of def.layout.controlPoints) {
    nav.buildField(cp.id, cp.pos, cp.radius * 0.6);
  }
  for (const team of [0, 1] as const) {
    const home = def.layout.spawns.find((s) => s.team === team);
    if (home) nav.buildField(`home${team}`, home.pos, 6);
  }

  return {
    size,
    margin,
    blockSize,
    terrainBlock,
    controlPoints: def.layout.controlPoints,
    spawns: def.layout.spawns,
    // Straight off the layout, exactly as `MapBuilder.build` passes it through
    // — a hardstanding is data and there is nothing to build for one. This is
    // what `HeadlessGame`'s own `VehicleSystem` fleets from, and it must be the
    // same list the clients read or the two would disagree about how many
    // hulls the round has and which side owns which.
    //
    // It was empty on every map until armour reached netplay, with a comment
    // saying the authority had never heard of a vehicle. It has now: see
    // `docs/multiplayer.md` on hulls and `docs/vehicles.md` on the driver's
    // report.
    vehicleSpawns: def.layout.vehicles ?? [],
    colliders,
    colliderBoxes: boxes,
    rayGroups,
    boxGroups: (collision.boxGroups ?? []).map((g) => [...g]),
    // Panes come off the bake with the boxes, and `paneGroups` deliberately
    // stays empty: a group is the MERGED MESH a pane's vertices live in, and
    // there is nothing to draw here. The authority needs a pane's rect to know
    // a round crossed it and its `box` to stop blocking a body — both of which
    // are on the pane itself. See `GlassSystem`, which reads exactly those two
    // fields on both sides and touches `paneGroups` only where it draws.
    panes,
    paneGroups: [],
    terrainColliders: floor,
    visuals: [],
    nav,
    obstacles,
    cover,
    rays,
    // Passed through rather than left empty. Nothing on the server reads them —
    // water and grass are visual — but a `GameMap` that disagrees with the
    // client's about what the map contains is a trap for whoever next writes a
    // rule that does read them.
    water: def.layout.water ?? [],
    grass: def.layout.grass ?? [],
    // Derived here rather than passed through, because a road is a placement
    // and the authority does not build placements. Nothing on this side reads
    // it — a road stops no round and no body, and the scatter it holds back
    // was already held back when the client's bake was taken — but the same
    // rule applies: a `GameMap` that disagrees with the client's about what
    // the map contains is a trap for whoever next writes something that does.
    roads: roadRects(def.layout.placements),
    terrain,
    dispose(): void {
      for (const mesh of colliders) mesh.dispose();
    },
  };
}

/** Where the ground is at a point — what movement validation measures against. */
export function groundAt(map: GameMap, x: number, z: number): number {
  return map.terrain.heightAt(x, z);
}

/** Scratch so the helpers above never allocate per call. */
export const scratch = new Vector3();
