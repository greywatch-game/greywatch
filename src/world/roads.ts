/**
 * roads.ts — The road network as RECTANGLES, and the one question they answer:
 * is this patch of ground PAVED?
 * Owns: the road footprint's defaults, its derivation from a layout's
 * placements, and the point-in-road test. Pure arithmetic — no Babylon, no
 * allocation per query — so the client, the authority and the grass field all
 * ask it the same way.
 *
 * **A road is still visual-only and still stops nothing.** It has no collider,
 * emits no `WorldBox`, and is invisible to navigation, to cover and to every
 * ray in the game; that is deliberate and none of it changes here. What it now
 * rejects is one thing and one thing only: something ROOTED being sown on top
 * of it. A palm growing out of fourteen metres of asphalt is not cover a bot
 * can use or a round can stop on — it is a picture of a bug — and the rule that
 * every map used to keep by hand (`scatter regions dodge the roads`) is the
 * sort of rule a layout cannot be trusted with, because nothing checks it and
 * the failure is only ever visible from inside the map.
 *
 * The two readers are `MapBuilder.findSpot`, which holds `PropBody.rooted`
 * props off the carriageway, and `GrassSystem.scatter`, which holds every tuft
 * off it — grass is rooted by definition and has no table to say so in.
 *
 * A linear scan is the whole implementation and is deliberate: the busiest map
 * in the tree lists twenty-four roads, and against ~11,000 tufts that is a
 * quarter of a million rectangle tests inside a build the loading card is
 * already covering. There is nothing here worth an index.
 */
import type { Placement } from "./layout";

/**
 * The width `buildRoad` gives a road that does not ask for one. Here rather
 * than in the builder because the footprint below has to agree with the slab
 * exactly, and two roads in the shipped layouts state a `length` and no
 * `width` — so a second copy of this number would be wrong on Greyfen only,
 * by four metres, in a way nothing would report.
 */
export const ROAD_WIDTH = 8;
/** The length `buildRoad` gives a road that does not ask for one. */
export const ROAD_LENGTH = 40;

/**
 * One road's ground footprint in world space: `width` across the carriageway,
 * `length` along it, turned by `rotY` about (x, z).
 *
 * The slab itself is re-cut against the heightfield by `terrainSlab` and a
 * contoured road follows every bank it crosses — but it is bent VERTICALLY
 * only, so this rectangle is the footprint of both forms and there is no third
 * case to carry.
 */
export interface RoadRect {
  x: number;
  z: number;
  /** Across the carriageway, along the road's local X. */
  width: number;
  /** Along the carriageway, along the road's local Z. */
  length: number;
  rotY: number;
}

/**
 * Every road in a layout, as rectangles.
 *
 * Derived from the placement list rather than authored beside it: a road is a
 * `Placement` like any other and stating its extent twice is the sort of pair
 * that drifts. Cheap enough to call per build — the longest list in the tree is
 * Coldharbour's twelve out of ~700 placements.
 */
export function roadRects(placements: readonly Placement[]): RoadRect[] {
  const out: RoadRect[] = [];
  for (const p of placements) {
    if (p.kind !== "road") continue;
    out.push({
      x: p.x,
      z: p.z,
      width: p.params?.width ?? ROAD_WIDTH,
      length: p.params?.length ?? ROAD_LENGTH,
      rotY: p.rotY ?? 0,
    });
  }
  return out;
}

/**
 * True when (x, z) is on a road, with `pad` metres of margin around the
 * carriageway.
 *
 * `pad` is what the caller thinks is ROOTED in the ground at that point — a
 * trunk's half-width, not its canopy's. A palm leaning its fronds over a street
 * is what a street with palms down it looks like; a palm standing IN it is the
 * bug. Grass passes zero: a blade is a point and a tuft against the kerb reads
 * as the verge it is.
 */
export function onRoad(
  roads: readonly RoadRect[],
  x: number,
  z: number,
  pad: number,
): boolean {
  for (const r of roads) {
    const dx = x - r.x;
    const dz = z - r.z;
    let lx = dx;
    let lz = dz;
    if (r.rotY !== 0) {
      // The `rotateY` convention MapBuilder places every structure with, run
      // backwards: world offset -> the road's own frame.
      const c = Math.cos(r.rotY);
      const s = Math.sin(r.rotY);
      lx = dx * c - dz * s;
      lz = dx * s + dz * c;
    }
    if (
      Math.abs(lx) <= r.width / 2 + pad &&
      Math.abs(lz) <= r.length / 2 + pad
    ) {
      return true;
    }
  }
  return false;
}
