/**
 * floorSurfaces.ts — What the valley floor is MADE of: the roster of ground
 * surfaces a map may state, and the one place a floor material is built.
 * Owns: the surface table (label, world scale, relief) and `floorMaterial`.
 * Owns no colour — that is `EnvironmentSpec.floorColor`, and this reads it.
 *
 * A surface is a PATTERN, not a place. The tones are derived from the map's
 * own `floorColor` by `textures.ts`, so picking one changes the grain of the
 * ground and not its colour; a map that says nothing gets `flat`, which is the
 * single untextured cel colour the floor has always been, at no cost.
 *
 * **`flat` is a real member of the list, not the absence of one.** It is what
 * Hollowmere is, it is the only variant that costs no texture sample per
 * ground pixel, and a map has to be able to choose it in the editor after
 * trying the others — an id that meant "unset" could be reached by clearing a
 * field but never by picking it.
 *
 * The material is deliberately MATTE. `getGroundTextured` registers a spec'd
 * material for `setGroundSpec` to re-apply the map's sheen to, and that sheen
 * is the wet-cobble one: a road's weather, tuned against the key light's
 * elevation. Soil is not wet stone, so the floor asks for no spec at all,
 * which also keeps it out of that registry — see `CelMaterialFactory.applySpec`,
 * which only records the materials it actually makes glossy.
 */
import type { Scene, ShaderMaterial } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";
import {
  getFloorBumpTexture,
  getFloorTexture,
  type FloorPatternId,
} from "./textures";

/** One textured surface's world scale and relief. */
interface FloorSurface {
  /** Shown in the editor's picker. */
  label: string;
  /**
   * Metres spanned by one texture repeat. Bigger reads as coarser ground and
   * repeats less often across a 240 m valley; smaller reads as finer grain and
   * starts to tile visibly on open ground.
   */
  metersPerTile: number;
  /**
   * Metres of fake relief at height 1.0. Authored against the grain's own
   * width — a lump about a third as tall as it is wide reads as ground, and
   * much past that reads as rubble. The cobbles' 0.1 over a 1.5 m tile is the
   * reference.
   */
  bumpScale: number;
}

/**
 * Every textured surface. Keyed by `FloorPatternId`, which `textures.ts`
 * derives from its own grain layouts — so a new pattern is a type error here
 * until it has been given a scale and a relief, and neither list can grow
 * without the other.
 */
const SURFACES: Record<FloorPatternId, FloorSurface> = {
  dirt: { label: "dirt", metersPerTile: 4, bumpScale: 0.035 },
  gravel: { label: "gravel", metersPerTile: 2.5, bumpScale: 0.03 },
  sand: { label: "sand", metersPerTile: 5, bumpScale: 0.015 },
  turf: { label: "turf", metersPerTile: 4.5, bumpScale: 0.03 },
};

/** What a map may state for its floor. `flat` is the shipped, untextured one. */
export type FloorSurfaceId = "flat" | FloorPatternId;

/** The default: the plain cel colour the floor was before surfaces existed. */
export const DEFAULT_FLOOR_SURFACE: FloorSurfaceId = "flat";

/** The picker's roster, in the order it is offered. */
export const FLOOR_SURFACE_IDS: readonly FloorSurfaceId[] = [
  "flat",
  ...(Object.keys(SURFACES) as FloorPatternId[]),
];

/** A surface's name for the editor. */
export function floorSurfaceLabel(id: FloorSurfaceId): string {
  return id === "flat" ? "flat colour" : SURFACES[id].label;
}

/**
 * The material every terrain block wears.
 *
 * Built here rather than in `MapBuilder` so the choice between a flat colour
 * and a world-mapped texture is made once, next to the table that describes
 * them. World mapping is what makes this work across a heightfield split into
 * 48 m blocks: the albedo is sampled at `vPosW.xz`, so neighbouring blocks
 * continue one another's grain with no UVs to author and no seam to line up.
 *
 * The cache key carries the colour as well as the pattern, because the factory
 * outlives a map and two maps on the same surface in different soils must not
 * share one material.
 */
export function floorMaterial(
  mats: CelMaterialFactory,
  scene: Scene,
  floorColor: string,
  surface: FloorSurfaceId | undefined,
): ShaderMaterial {
  const id = surface ?? DEFAULT_FLOOR_SURFACE;
  if (id === "flat") return mats.get(floorColor);
  const spec = SURFACES[id];
  return mats.getGroundTextured(
    `${id}-${floorColor.slice(1)}`,
    getFloorTexture(scene, id, floorColor),
    1 / spec.metersPerTile,
    {
      bump: getFloorBumpTexture(scene, id),
      bumpScale: spec.bumpScale,
    },
  );
}
