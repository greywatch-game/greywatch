/**
 * server/world.ts — Rebuilds a map's SOLID world under a NullEngine, from the
 * baked collider set plus the layout.
 * Owns: the collider meshes the server's rays pick against, the terrain floor's
 * collider clones, and the nav/cover/obstacle structures built from them.
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
 *   - **Everything else is read from the layout**, because it is already data
 *     or already arithmetic: control points and spawns pass through
 *     `MapBuilder.build` untouched, and the floor is `TerrainField`. Baking
 *     those too would be three more things that can go stale for no gain.
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
import { TerrainField, terrainPatches } from "../src/world/TerrainField";

/**
 * Builds one collider box, matching `MapBuilder.collider()` exactly.
 *
 * The flags are the contract every ray test in the game reads: `solid` is what
 * `SOLID_ONLY` filters on, `porous` is what `OPAQUE_ONLY` subtracts from it,
 * and `MapBuilder` deliberately leaves `surface` absent so the box reads as
 * "hard". All three are copied here rather than shared
 * because the two functions build from different inputs — one from a `BoxSpec`
 * in a structure's local frame, one from a `WorldBox` already in world space —
 * and the only thing they have in common is the result.
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
  // `checkCollisions` is what `moveWithCollisions` walks, and nothing on the
  // server moves that way — the client does its own movement and the bots never
  // touched the collidable list. Left on anyway so the mesh is identical to the
  // client's in every field a future reader might compare.
  mesh.checkCollisions = true;
  // `porous` copied through for the reason the whole file exists: the server
  // resolves every shot, so a fence it thought was solid would eat rounds the
  // shooter watched go between the rails, and the client would be showing a
  // hitmarker the authority disagrees with.
  mesh.metadata = box.porous ? { solid: true, porous: true } : { solid: true };
  mesh.freezeWorldMatrix();
  return mesh;
}

/**
 * One group of `strut` boxes as the single collider mesh the client merged them
 * into — a fence's posts and rails.
 *
 * **This is the one merge on the server, and it is here because the client's
 * pick has to meet the same geometry the server's does.** The header's "no
 * merges" is about visuals: there is nothing to draw here and this produces no
 * material, no texture and no draw call — it is a triangle soup that exists to
 * be picked, and merging is what keeps the cost of picking it flat. Group by
 * group, exactly as baked: merging all of them into one mesh would wrap one
 * bounding box around every fence in the village, and then every ray this
 * process fires would pay for all of them.
 *
 * `rayOnly` keeps it out of `SOLID_ONLY`, matching the client, so the movement
 * validator and everything else that asks where a body may be never sees a
 * rail. Nothing here is in `colliderBoxes`, so the nav graph, the cover bake
 * and the obstacle field never see one either — which is what keeps this world
 * identical to the one `npm run parity` compares.
 */
/**
 * One group of a scatter region's boxes as the single collider mesh the client
 * merged them into — a dozen tree trunks in a 12 m square.
 *
 * **The second merge on the server, and it exists for the same reason as the
 * first**: a pick costs per mesh before it costs per triangle, and this process
 * resolves every shot in every match it is running. Greyfen's jungle is ~950
 * one-metre trunks; unmerged they would be more collider meshes than the rest
 * of the map put together, and every rewound shot would pay a bounding test for
 * each. Group by group exactly as baked, never all in one — see `strutMesh`,
 * whose bounding-box warning is the same one.
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
function terrainColliders(scene: Scene, terrain: TerrainField, size: number): Mesh[] {
  const out: Mesh[] = [];
  for (const patch of terrainPatches(terrain, size, BLOCK_SIZE)) {
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
  const terrain = new TerrainField(
    def.layout.terrain,
    margin,
    def.layout.borderland?.roll,
  );
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
  const floor = terrainColliders(scene, terrain, size);
  colliders.push(...floor);

  // Same order and same inputs as `MapBuilder.build`: the graph is derived from
  // the finished collider set, never from the geometry that suggested it.
  const nav = new NavGrid(size, boxes, terrain, def.layout.surfaces);
  const cover = new CoverMap(nav, boxes);
  const obstacles = new ObstacleField(size, boxes);

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
    // Passed through rather than left empty. Nothing on the server reads them —
    // water and grass are visual — but a `GameMap` that disagrees with the
    // client's about what the map contains is a trap for whoever next writes a
    // rule that does read them.
    water: def.layout.water ?? [],
    grass: def.layout.grass ?? [],
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
