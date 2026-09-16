/**
 * mapPlan.ts — What the three maps in this interface all draw, as one
 * description, built from either of the two things a map can be at the time
 * it is asked for.
 * Owns: the `MapPlan` type and the two adapters that make one — from a BUILT
 * `GameMap` (the deploy screen and the minimap, which are standing in it) and
 * from a `MapDef` plus whichever of its two bulk halves have landed (the menu,
 * where nothing has been built yet).
 * Invariants: a plan is the STATIC GROUND and nothing else — the floor, the
 * water, the carriageways and the masses standing on them. Flags, spawns,
 * bodies and a cursor are the SCREEN's, because each of the three knows a
 * different amount about them (a layout's five control points, a round's live
 * meters, a player's own team), and a plan that carried the union would be
 * three different objects wearing one type. See `mapPaint.ts` for the look.
 *
 * **The reason this file exists is that there were three maps of one place and
 * they did not agree.** The menu drew placements as squares, the deploy screen
 * drew collider boxes as flat grey, the minimap drew the same boxes in
 * translucent white, and each had its own idea of what a building, a road and
 * a shoreline looked like — so a player learned the village three times. One
 * plan and one painter is what makes them the same drawing at three
 * magnifications, and it is why a fourth surface (a spectator map, an
 * end-of-round card) is a projection and a call rather than a fourth dialect.
 *
 * **The two adapters differ in ONE thing and it is not detail — it is
 * WAITING.** A built map has its colliders, its roads and its floor in hand
 * and `planFromWorld` is synchronous. A `MapDef` on the menu has its
 * placements and its water in the bundle, and its FLOOR and its COLLIDER BAKE
 * behind `import()` — so `planFromLayout` takes both as arguments that may be
 * `null` and draws what it has. What that costs is that the menu's schematic
 * arrives in up to three passes (flat, then relief, then masses), which is the
 * order `OverlayScreen.paintThumb` was already repainting in for the floor
 * alone and is still the honest one: a drawing that improves is better than a
 * hole that waits.
 */
import { CONFIG } from "../config";
import type { MapCollision } from "../world/collision";
import type { EnvironmentSpec } from "../world/environment";
import type { Heightfield, MapLayout, ScatterSpec } from "../world/layout";
import type { GameMap, WaterRect } from "../world/MapBuilder";
import { pieceCorners, type RoadFootprint } from "../world/roads";
import { roadNetwork } from "../world/roadPaths";
import { TerrainField } from "../world/TerrainField";

/**
 * One thing standing on the ground, as the rectangle it covers and how far it
 * rises above the floor under it.
 *
 * `rise` is what makes a plan read as a town rather than as a spill of boxes:
 * the painter ladders its fill and the length of its shadow off it, so a
 * three-storey block on Coldharbour sits visibly over the yard walls around it
 * and Sarab's alleys read as alleys. It is measured against the FLOOR under
 * the box's own centre rather than against y=0, because a map whose ground
 * climbs forty metres would otherwise report every hut on the hill as a tower.
 */
export interface PlanMass {
  cx: number;
  cz: number;
  /** Full extents, as the collider carries them — not half-extents. */
  w: number;
  d: number;
  rot: number;
  rise: number;
}

/** A convex patch of carriageway, in world metres, corners in order. */
export interface PlanPoly {
  xs: readonly number[];
  zs: readonly number[];
}

/**
 * Everything the painter needs about a place, and nothing about a round.
 *
 * Every list is allowed to be empty and every optional is allowed to be
 * absent: a map with no floor yet, no bake yet, no water and no roads is a
 * legal plan, and is exactly the first thing the menu draws.
 */
export interface MapPlan {
  /** The play square's side, centred on the origin. */
  size: number;
  /** How far the floor carries on past it; 0 on a map closed by a rim. */
  margin: number;
  /** Never null — a map with no heightfield is a `TerrainField` over nothing. */
  terrain: TerrainField;
  /** True when the floor is genuinely known, rather than defaulted to level. */
  hasFloor: boolean;
  water: readonly WaterRect[];
  /** The masses, low to high — the order the painter must draw them in. */
  masses: readonly PlanMass[];
  /**
   * What a `porous` collider stands for: a fence, a hedge, a railing. Drawn as
   * a LINE rather than as a mass, which is both what it looks like from above
   * and what it means — a thing you cannot cross and can see over.
   */
  fences: readonly PlanMass[];
  roads: readonly PlanPoly[];
  /**
   * The dressing regions, from a LAYOUT only. A built map has the props
   * themselves and not the regions that sowed them, and their colliders are
   * already in `masses`/`fences` — so this is empty on that side and the
   * painter's canopy layer simply does not run. See `planFromWorld`.
   */
  scatter: readonly ScatterSpec[];
  /** The palette every colour on the drawing is derived from. */
  env: EnvironmentSpec;
}

/**
 * The shortest RUN worth calling a structure, in metres — the box's LONG axis
 * and deliberately not its area.
 *
 * Area was the first rule and it is the wrong one, because a building here is
 * not a box: it is eight or ten WALLS, and a wall is 0.25 m thick. At 6 m² a
 * 6 m wall (1.5 m²) is dropped and a 2.5 m crate (6.25 m²) is kept, which on
 * Greyfen left one mass standing on the whole map and on Hollowmere drew the
 * village as confetti — every cover crate, bollard and gravestone plotted and
 * every building gone. The long axis is what separates a thing that ENCLOSES
 * from a thing that stands in the open, and it does it on all six maps at
 * once: 262 masses on Hollowmere, 228 on Coldharbour, 1,443 on Cinderhaven.
 *
 * The number is not about pixels. The painter already grows a mass to a
 * legible thickness at whatever magnification it is drawn at (see
 * `mapPaint.ts`), so a rule stated in pixels would make a city read as a rash
 * close in and as nothing at all far out.
 */
const MASS_RUN = 3;

/**
 * And how far it has to stand above the floor under it. A kerb, a loading
 * bank, a terrace slab and a road ramp are all long `solid` boxes that are
 * ankle high, and none of them is a thing you can see from the air — Greyfen
 * alone lays forty of them, several nearly thirty metres across.
 */
const MASS_RISE = 1;

/**
 * Above this a box is the GROUND PLANE or the RIM rather than a building —
 * the same test `MapBuilder`'s own readers key on, and the seven sites
 * `MapLayout.size`'s contract names. Kept as one constant here because the
 * two adapters both owe it and a plan that drew the ridge would be a plan
 * whose every map is one grey square.
 */
const WORLD_SPAN = 200;

/** A built map: the deploy screen's and the minimap's. */
export function planFromWorld(map: GameMap, env: EnvironmentSpec): MapPlan {
  const masses: PlanMass[] = [];
  const fences: PlanMass[] = [];
  for (const b of map.colliderBoxes) {
    sort(b.w, b.h, b.d, b.cx, b.cy, b.cz, b.rotY, b.porous === true, map.terrain, masses, fences);
  }
  // The struts — a fence's posts and rails — are the same object as the
  // `porous` run they stand in, so drawing both draws every fence twice. The
  // run is the one with the shape, and it is already in the list above.
  return {
    size: map.size,
    margin: map.margin,
    terrain: map.terrain,
    hasFloor: !map.terrain.flat,
    water: map.water,
    masses: masses.sort(byRise),
    fences,
    roads: roadPolys(map.roads),
    scatter: [],
    env,
  };
}

/**
 * A map that has not been built: the menu's.
 *
 * `floor` and `bake` are the two halves behind `import()`, and either may be
 * `null` — meaning "not here", not "none". A plan with no bake carries no
 * masses at all and the painter draws the layout's own scatter and roads over
 * bare relief, which is the schematic this screen had before the bake was
 * fetched for it; a plan with no floor is drawn level, and the water is left
 * out entirely, because a `WaterRect` is an extent rather than a shape and
 * filling one paints a valley as a lake (see `mapPaint.ts`'s water layer).
 */
export function planFromLayout(
  layout: MapLayout,
  env: EnvironmentSpec,
  floor: Heightfield | null,
  bake: MapCollision | null,
): MapPlan {
  const size = layout.size ?? CONFIG.map.size;
  const margin = layout.borderland?.margin ?? 0;
  const terrain = new TerrainField(
    floor ?? undefined,
    margin,
    layout.borderland?.roll,
  );
  const masses: PlanMass[] = [];
  const fences: PlanMass[] = [];
  for (const b of bake?.boxes ?? []) {
    sort(b[0], b[1], b[2], b[3], b[4], b[5], b[7], b[8] === 1, terrain, masses, fences);
  }
  return {
    size,
    margin,
    terrain,
    hasFloor: floor !== null,
    water: floor ? (layout.water ?? []) : [],
    masses: masses.sort(byRise),
    fences,
    roads: roadPolys(roadNetwork(layout.placements).footprint),
    // Only while there is no bake. Once the real masses are in hand the
    // regions are noise over them — a canopy wash across a town it is not in.
    scatter: bake ? [] : layout.scatter,
    env,
  };
}

/**
 * One collider, filed. The two adapters differ only in where the eight numbers
 * came from, so the rule that turns them into a drawing lives here once.
 */
function sort(
  w: number,
  h: number,
  d: number,
  cx: number,
  cy: number,
  cz: number,
  rotY: number,
  porous: boolean,
  terrain: TerrainField,
  masses: PlanMass[],
  fences: PlanMass[],
): void {
  if (w > WORLD_SPAN || d > WORLD_SPAN) return;
  const rise = cy + h / 2 - terrain.heightAt(cx, cz);
  if (porous) {
    fences.push({ cx, cz, w, d, rot: rotY, rise });
    return;
  }
  if (Math.max(w, d) < MASS_RUN || rise < MASS_RISE) return;
  masses.push({ cx, cz, w, d, rot: rotY, rise });
}

/** Low to high, so a tall block's shadow falls on the yard wall beside it. */
function byRise(a: PlanMass, b: PlanMass): number {
  return a.rise - b.rise;
}

/**
 * A footprint's two halves as one list of polygons — the rectangles a layout
 * states directly and the convex pieces a PATH road's network was cut into.
 *
 * Both sides of the game build a `RoadFootprint` off the same placements
 * (`MapBuilder` here, `server/world.ts` there), so this is the one place in
 * the interface that knows a carriageway's shape, and it knows it from the
 * same object the grass and the scatter are held off.
 */
function roadPolys(roads: RoadFootprint): PlanPoly[] {
  const out: PlanPoly[] = [];
  for (const r of roads.rects) {
    const c = Math.cos(r.rotY);
    const s = Math.sin(r.rotY);
    const hw = r.width / 2;
    const hl = r.length / 2;
    const xs: number[] = [];
    const zs: number[] = [];
    // The local corners of a `RoadRect`: `width` across local X, `length`
    // along local Z, turned about its centre — the same frame `MapBuilder`
    // lays the slab in.
    for (const [lx, lz] of [
      [-hw, -hl],
      [hw, -hl],
      [hw, hl],
      [-hw, hl],
    ]) {
      xs.push(r.x + lx * c + lz * s);
      zs.push(r.z - lx * s + lz * c);
    }
    out.push({ xs, zs });
  }
  for (const p of roads.pieces) {
    const corners = pieceCorners(p);
    if (corners) out.push(corners);
  }
  return out;
}
