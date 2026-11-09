/**
 * viewer/navPlan.ts — What the nav grid thinks of every surface, as numbers:
 * `editor/navOverlay.ts`'s classification without its Babylon draw
 * (`BABYLON_EXIT.md` X5.3b, row "X5.3, the viewer's overlays").
 * Owns: the per-surface bucket, the per-cell reduction a plan paints, and the
 * flow fields the viewer asks of the standing graph.
 *
 * Three colours, and the middle one is the reason this exists — the editor's
 * words, which still describe it:
 *
 * - **green** — walkable: the flood fill reached it, bots can stand there.
 * - **red** — standable but never reached. Sealed courtyards and decks lifted
 *   just past the 0.6 m step height look identical to green ground in the
 *   world and are completely dead in play. Rooftops are unreached on purpose,
 *   so only what `makeIslandTest` calls an island is red — the same test the
 *   validation list's island findings use, so the red cells are those findings.
 * - **amber** — reached, but with no route to the chosen objective.
 *
 * `classifyNav` walks the snapshot in the overlay's own order (every cell, then
 * every slot in it) and makes the overlay's decision per surface; the overlay
 * pushed a position into a bucket's instance list where this writes the bucket
 * into an array, which is how the two are graded against each other cell for
 * cell over the same `debugSnapshot`.
 *
 * **The fields are built on the STANDING graph, on demand** — a round on the
 * page builds none (`BuildOptions.navFields`: the page's own match steers its
 * bots in its host, off its own world), and the viewer is laid over a round
 * rather than building one. `fieldFor` returns the graph's own when it has one
 * (a server's match builds them all) and otherwise sweeps it with the goal and
 * radius `MapBuilder.derive` uses, which registers it on the graph under the
 * same name: from then on `NavGrid.openBox` relaxes it with the rest when a
 * pane breaks, and nothing on the page that decides anything reads it. It is
 * not dropped when the lid comes down — `NavGrid` has no way to unregister a
 * field — so it stands until the map is torn down: CPU on a pane's break, at
 * most the flags plus the two homes, reused by the next raise.
 *
 * Never: draws, holds a mesh, or changes a link.
 */
import type { MapLayout } from "../world/layout";
import { FLOW_UNREACHED, type FlowField, type NavGrid } from "../world/NavGrid";
import { makeIslandTest, type NavSnapshot } from "./validate";

/** A surface the plan does not paint: blocked, or a roof. */
export const NAV_NONE = 0;
export const NAV_WALKABLE = 1;
export const NAV_ISLAND = 2;
export const NAV_UNROUTED = 3;

export interface NavClasses {
  /** One bucket per surface id, `NAV_*`. */
  bucket: Uint8Array;
  /** Surfaces per painted bucket, the overlay's `counts()`. */
  walkable: number;
  island: number;
  unrouted: number;
}

/**
 * Buckets every surface of the graph. `dist` is the chosen objective's field,
 * or undefined to skip the amber pass — the overlay's `build(map, null)`.
 */
export function classifyNav(snap: NavSnapshot, dist: Uint16Array | undefined): NavClasses {
  const { dim, cellBase, counts, walkable, blocked, surfaceCount } = snap;
  const bucket = new Uint8Array(surfaceCount);
  const out: NavClasses = { bucket, walkable: 0, island: 0, unrouted: 0 };
  // Rooftops are unreached on purpose — painting them red would bury the
  // handful of cells that are unreached by mistake.
  const isIsland = makeIslandTest(snap);
  for (let cell = 0; cell < dim * dim; cell++) {
    for (let si = 0; si < counts[cell]; si++) {
      const s = cellBase[cell] + si;
      // No `y < 0` test, for the overlay's reason: the graph's ids are
      // compacted, so there is no padding left to skip, and sunken terrain
      // makes negative heights ordinary.
      if (blocked[s]) continue;
      if (!walkable[s]) {
        if (!isIsland(s)) continue; // a roof; not painted
        bucket[s] = NAV_ISLAND;
        out.island++;
      } else if (dist && dist[s] === FLOW_UNREACHED) {
        // The sentinel, not `!Number.isFinite`: a field is a `Uint16Array` of
        // step counts and every value in one is finite.
        bucket[s] = NAV_UNROUTED;
        out.unrouted++;
      } else {
        bucket[s] = NAV_WALKABLE;
        out.walkable++;
      }
    }
  }
  return out;
}

/**
 * One bucket per CELL (`cz * dim + cx`, `NavGrid`'s convention), for the plan.
 * `layer` is a slot — slot 0 the lowest surface in its cell, since a cell's
 * surfaces are kept sorted by height (`NavGrid.addSurface`) — or `null` for
 * every slot, where the most telling bucket in the cell wins: red over amber
 * over green, the order the overlay drew them hardest in.
 */
export function cellsOf(snap: NavSnapshot, classes: NavClasses, layer: number | null): Uint8Array {
  const { dim, cellBase, counts } = snap;
  const cells = new Uint8Array(dim * dim);
  for (let cell = 0; cell < dim * dim; cell++) {
    const n = counts[cell];
    if (layer !== null) {
      if (layer < n) cells[cell] = classes.bucket[cellBase[cell] + layer];
      continue;
    }
    let best: number = NAV_NONE;
    for (let si = 0; si < n; si++) best = Math.max(best, RANK[classes.bucket[cellBase[cell] + si]]);
    cells[cell] = UNRANK[best];
  }
  return cells;
}

/** A bucket's priority when a cell's slots are folded into one, and back. */
const RANK = [0, 1, 3, 2];
const UNRANK = [NAV_NONE, NAV_WALKABLE, NAV_UNROUTED, NAV_ISLAND];

/**
 * The field to a control point by id, or to a team's home (`home0`, `home1`),
 * swept on the graph if it has none — with `MapBuilder.derive`'s goal and
 * radius, so it is the field a server's match would hold. Null for an id the
 * layout does not name.
 */
export function fieldFor(nav: NavGrid, layout: MapLayout, id: string): FlowField | null {
  const have = nav.field(id);
  if (have) return have;
  const home = /^home([01])$/.exec(id);
  if (home) {
    const team = Number(home[1]);
    const spawn = layout.spawns.find((s) => s.team === team);
    return spawn ? nav.buildField(id, spawn.pos, 6) : null;
  }
  const cp = layout.controlPoints.find((c) => c.id === id);
  return cp ? nav.buildField(cp.id, cp.pos, cp.radius * 0.6) : null;
}
