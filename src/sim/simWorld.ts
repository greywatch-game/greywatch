/**
 * src/sim/simWorld.ts — Rebuilds a map's SOLID world from the baked collider
 * set plus the layout, as data and nothing else: no engine, no scene, no mesh.
 * Owns: the nav/cover/obstacle/ray/sweep structures built from the baked
 * boxes and the map's floor, and the `GameMap` that carries them.
 *
 * **There are no collider meshes on this side any more, and that is the end of
 * a road rather than a shortcut.** They existed first so this process's
 * `scene.pickWithRay` had something to pick, and then so a driven hull's
 * `moveWithCollisions` had something to walk. Every ray became a box query
 * (`RayWorld`, `ENGINE_UPGRADE.md` wall 2) and so did every sweep
 * (`CollisionField`, `BABYLON_EXIT.md` X2.1), both off `colliderBoxes`, which
 * left the meshes an inert mirror of the client's that nothing read; X2.3 took
 * them away with the scene they stood in. `GameMap.colliders` and
 * `terrainColliders` are therefore EMPTY here, as `visuals` and `paneGroups`
 * always were — every reader of either is a client view (`GlassFx`,
 * `WorldCulling`, `PhysicsWorld`), and the authority builds none of them.
 * Invariants: this is the collider half of `MapBuilder.build` and nothing else,
 * and it imports nothing from `@babylonjs/core` — `scripts/check-babylon-free.mjs`
 * fails the build if any path from `server/` or `src/sim/` reaches it. What it builds must
 * line up with the client's exactly, or a shot that lands on a wall here passes
 * through it there: the same boxes, the same `rayGroups`, the same
 * `boxGroups` (the sweep's tie order), the same floor, and `npm run parity`
 * proving the derived structures agree.
 *
 * Why a rebuild and not a build: `MapBuilder` builds meshes and materials and
 * reaches a canvas through `floorMaterial` (`DynamicTexture.getContext()`), and
 * this process has neither a canvas nor, now, an engine. See
 * `scripts/bake-collision.mjs`.
 *
 * Two sources, and the split is not arbitrary:
 *
 *   - **The boxes are baked**, because they come out of the structure builders
 *     and those build geometry and read textures. `MapBuilder.collider()` is
 *     the only place a collider is made and the `WorldBox` it records carries
 *     everything a query needs, so the bake is lossless.
 *   - **Everything else is read from the map's own data**, because it is
 *     already data or already arithmetic: control points and spawns pass
 *     through `MapBuilder.build` untouched off the layout, and the floor is
 *     `TerrainField` over the heightfield — which is a lazy `import()` beside
 *     the bake rather than a field on the layout, and so is loaded beside it
 *     (see `MapDef.heights`). Baking those too would be three more things that
 *     can go stale for no gain.
 *
 * **Both arrive as DATA and this file loads neither** (`BABYLON_EXIT.md`
 * X2.5a): `buildSimWorld` is synchronous, and the two lazy imports are the
 * host's — `server/world.ts`'s `loadSimWorld` on the authority, which is all
 * that file still is. So the core that owns this world can be handed one by
 * any host that holds a `MapCollision`, and none of it lives in `server/`.
 *
 * The four boundary boxes need no special handling — `collider()` made them,
 * so they are in the bake like everything else, and they keep the `w > 200 ||
 * d > 200` shape that `NavGrid`, `ObstacleField` and `CoverMap` identify the
 * boundary by.
 */
import { CONFIG } from "../config";
import {
  toRayGroups,
  toWorldBoxes,
  toWorldPanes,
  type MapCollision,
} from "../world/collision";
import { CoverMap } from "../world/CoverMap";
import type { GameMap } from "../world/MapBuilder";
import { BLOCK_SIZE } from "../world/blocks";
import type { MapDef } from "../world/maps";
import type { Heightfield } from "../world/layout";
import { NavGrid } from "../world/NavGrid";
import { ObstacleField } from "../world/ObstacleField";
import { RayWorld } from "../world/RayWorld";
import { CollisionField } from "../world/CollisionField";
import { roadNetwork } from "../world/roadPaths";
import { TerrainField } from "../world/TerrainField";

/**
 * Rebuilds `def`'s solid world.
 *
 * Returns a real `GameMap` so the systems that consume one need no server-only
 * variant — `BattleSystem.setMap` reads `nav`/`cover`/`obstacles` and
 * `ConquestSystem.start` reads `controlPoints`/`spawns`, and both get exactly
 * what they get on the client. The fields that are genuinely absent are the
 * MESH lists (`colliders`, `terrainColliders`, `visuals`, `paneGroups` —
 * there is no scene to stand one in) and `editor` (there is no editor); all
 * are empty rather than faked.
 */
export function buildSimWorld(
  def: MapDef,
  collision: MapCollision,
  floor: Heightfield | undefined,
): GameMap {
  // The layout's own extent, exactly as `MapBuilder.build` reads it: a server
  // that took the global would rasterize a larger map's nav grid over a 240 m
  // square and steer bots against a world a third the size of the clients'.
  const size = def.layout.size ?? CONFIG.map.size;
  // How far the floor carries on past that square. Read from the layout for the
  // same reason `size` is: a server that took the default would put the ground
  // to an abrupt stop at ±size/2 and reject every honest player standing in the
  // borderland its clients are drawing. `RayWorld` needs no telling — the
  // extent is the FIELD's, and it reads it off this object.
  const margin = def.layout.borderland?.margin ?? 0;
  // How the map is CUT, read off the layout for the third time the same reason
  // `size` and `margin` are. Neither decides anything here — there is no merge,
  // nothing to draw and no floor patch to tessellate (the floor's line of sight
  // is `RayWorld`'s march over the field's own cells) — but both are carried on
  // the map so that a `GameMap` from this file cannot disagree with one from
  // `MapBuilder` about what the map IS.
  const blockSize = def.layout.blockSize ?? BLOCK_SIZE;
  const terrainBlock = def.layout.terrainBlock ?? BLOCK_SIZE;
  // The floor, which is no longer on the layout: it is a lazy `import()` of its
  // own (`MapDef.heights`, ENGINE_UPGRADE.md S7), for the reason `collision`
  // is one. Loaded beside it by the host rather than bundled — the boxes are
  // baked and the ground is arithmetic, and this world needs both.
  const terrain = new TerrainField(
    floor,
    margin,
    def.layout.borderland?.roll,
    def.layout.borderland?.ease,
  );
  const boxes = toWorldBoxes(collision);

  // The boxes the client merged with their neighbours into a scatter cluster —
  // see `MapCollision.boxGroups`. Read here for one guard: a clustered box was
  // never a mesh of its own, so it is never a pane.
  const grouped = new Set((collision.boxGroups ?? []).flat());
  // A pane's BOX carries `glass`, as `MapBuilder.paneGroup` marks it on the
  // client. A pane is never clustered (glass has to stay addressable one sheet
  // at a time, and the client refuses to group it), so the guard is the test it
  // was when it asked whether the box had a collider mesh of its own.
  //
  // The client also stamps the pane index on the collider MESH, for `GlassFx`
  // to write the editor's flags on; there is no mesh here, the authority builds
  // no `GlassFx`, and `GlassSystem` reads only the box.
  const panes = toWorldPanes(collision);
  for (const p of panes) {
    if (p.box < 0 || p.box >= boxes.length || grouped.has(p.box)) continue;
    // `glass` is what `clearCollider` reads as its own idempotence flag —
    // without it the authority leaves the collider standing, so a player who
    // shot a shopfront out is snapped back out of it by `validateMove`.
    //
    // Derived from `panes` rather than baked as a tenth tuple entry: the pane
    // list already says which boxes are glass, and two sources for one fact is
    // one that can go stale. `porous` IS baked, because it is a property of the
    // box independent of any pane.
    boxes[p.box].glass = true;
  }
  const rayGroups = toRayGroups(collision);

  // Same order and same inputs as `MapBuilder.build`: the graph is derived from
  // the finished collider set, never from the geometry that suggested it.
  const nav = new NavGrid(size, boxes, terrain, def.layout.surfaces);
  const cover = new CoverMap(nav, boxes);
  const obstacles = new ObstacleField(size, boxes);
  // The segment query, off the same two lists the client's colliders were
  // built from plus the same floor: every ray the shared systems fire — the
  // rewound hitscan, the bots' line of sight, the grenade, the rocket — goes
  // through this. There is no scene here to go through instead.
  const rays = new RayWorld(size, boxes, rayGroups, terrain, collision.boxGroups ?? []);
  // And the sweep a driven hull moves by, over the same boxes: the authority's
  // one sweep is a hull's, and it is answered off `rays` exactly as the
  // client's is — no mesh, no scene.
  const collidables = new CollisionField(rays);

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
    // what `SimCore`'s own `VehicleSystem` fleets from, and it must be the
    // same list the clients read or the two would disagree about how many
    // hulls the round has and which side owns which.
    //
    // It was empty on every map until armour reached netplay, with a comment
    // saying the authority had never heard of a vehicle. It has now: see
    // `docs/multiplayer.md` on hulls and `docs/vehicles.md` on the driver's
    // report.
    vehicleSpawns: def.layout.vehicles ?? [],
    // The collider MESHES, which stand in the client's scene and nowhere else:
    // no ray and no sweep reads one on either side, and every reader left is a
    // client view (`GlassFx`'s pane index, `WorldCulling`, `PhysicsWorld`'s
    // floor). Empty, as `visuals` is — see the header.
    colliders: [],
    colliderBoxes: boxes,
    rayGroups,
    boxGroups: (collision.boxGroups ?? []).map((g) => [...g]),
    // Panes come off the bake with the boxes, and `paneGroups` deliberately
    // stays empty: a group is the MERGED MESH a pane's vertices live in, and
    // there is nothing to draw here. The authority needs a pane's rect to know
    // a round crossed it and its `box` to stop blocking a body — both of which
    // are on the pane itself. See `GlassSystem`, which reads exactly those two
    // fields on both sides; `paneGroups` is `GlassFx`'s, which only draws.
    panes,
    paneGroups: [],
    terrainColliders: [],
    terrainGeometry: [],
    visuals: [],
    // Empty for `paneGroups`' reason: it is the record the DRAWN world was
    // made of, and there is nothing drawn here.
    world: { surfaces: [], pieces: [] },
    nav,
    obstacles,
    cover,
    rays,
    collidables,
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
    roads: roadNetwork(def.layout.placements).footprint,
    terrain,
    // Nothing to release: every structure above is plain arrays the collector
    // takes with the map.
    dispose(): void {},
  };
}
