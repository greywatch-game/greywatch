/**
 * NavGrid.ts — Walkable-surface graph + one precomputed flow field per
 * objective (5 flags + 2 home spawns). Built ONCE at map load from the final
 * collider set; runtime is read-only (bots call steer(), never pathfind).
 * Invariants: a graph node is a (cell, height) SURFACE — one cell can hold
 * creek floor + bridge deck (maxSurfaces, 3 unless the map raises it). Surface
 * heights come from the
 * collider's top-face PLANE at the cell centre, not its AABB — see
 * boxGeometry.ts, which owns that (sign-sensitive) math for every caller.
 * The base surface in every cell comes from
 * the TerrainField, NOT from a hardcoded zero — that constant was what made
 * the floor unable to be anything but flat. Reachability is a flood fill from
 * open ground, which is what keeps bots off rooftops. Links crossing a solid box
 * are severed (severLinks) — without it every wall thinner than a cell is
 * invisible to the graph and bots walk into fences forever. stepHeight must
 * match ObstacleField. Too coarse to be the only collision test — see
 * ObstacleField.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import {
  clampToTopFace,
  segmentHitsBox,
  slabThickness,
  topFaceAtLocalZ,
  topFaceHeight,
  verticalSpan,
} from "./boxGeometry";
import type { WorldBox } from "./MapBuilder";
import type { TerrainField } from "./TerrainField";

/**
 * Navigation for Hollowmere: a uniform grid of walkable surfaces plus one
 * precomputed flow field per objective.
 *
 * ## Why not steering
 *
 * The retired enemies steered straight at the player and pushed themselves out
 * of obstacle circles afterwards. That works in an empty box and fails
 * completely in a village — a bot would grind along a cottage wall forever
 * instead of walking round it. A grid gives real pathing, and precomputing a
 * field per goal means 16 bots share the same seven searches rather than each
 * running its own A*.
 *
 * ## Surfaces, not cells
 *
 * A cell can have more than one standable height: the creek floor and the
 * bridge deck above it, the barn floor and its hayloft. So the graph node is a
 * *surface* — a (cell, height) pair — discovered by rasterising every collider's
 * top face into the grid. Two surfaces are connected when they are
 * side-by-side and within `stepHeight` of each other, which is what makes ramps
 * traversable and walls not.
 *
 * The map never changes, so all of this is built once at load and then only
 * read.
 */

/**
 * Max standable surfaces tracked per cell, where a map does not say otherwise.
 * Three is enough for Hollowmere's worst case — creek floor, bank top, bridge
 * deck stacked in one column. A map that stacks FLOORS raises it through
 * `MapLayout.surfaces`; see that field, and `maxSurfaces` below, which is the
 * value this grid was actually built with.
 */
const DEFAULT_MAX_SURFACES: number = CONFIG.nav.maxSurfaces;
/** Heights closer than this are the same surface. */
const HEIGHT_EPS = 0.35;
/** Vertical clearance a combatant needs to stand somewhere. */
const HEADROOM = 1.7;

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
/** Index of the NEIGHBOURS entry pointing the other way. Keep in step. */
const OPPOSITE = [1, 0, 3, 2, 7, 6, 5, 4];

/** An inclusive rectangle of cells. Grid coordinates, never world ones. */
interface CellRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A precomputed route to one goal: per-surface step count, lower is closer. */
export class FlowField {
  constructor(
    readonly name: string,
    /** Indexed by surface id; `Infinity` where the goal is unreachable. */
    readonly dist: Float32Array,
  ) {}
}

export class NavGrid {
  readonly cellSize: number;
  /** Cells per side. */
  readonly dim: number;
  /**
   * Standable surfaces tracked per cell — the stride of every array below, and
   * the map's own answer rather than a constant (see `MapLayout.surfaces`).
   *
   * Public because the editor rebuilds this grid from a `GameMap` and has no
   * layout in hand: reading it back off the grid it is replacing is what keeps
   * the rebuild the same shape as the build.
   */
  readonly maxSurfaces: number;
  private readonly origin: number;

  /** Surface heights per cell, ascending. `-1` marks an unused slot. */
  private readonly heights: Float32Array;
  /** How many surfaces each cell actually has. */
  private readonly counts: Uint8Array;
  /** Whether each surface was reached by the connectivity flood fill. */
  private readonly walkable: Uint8Array;
  /** Neighbour surface ids per surface, `-1`-padded. */
  private readonly links: Int32Array;

  private readonly fields = new Map<string, FlowField>();

  /**
   * What each field was built FROM, so one can be built again.
   *
   * The graph was immutable when `buildField` was written, so a field's own goal
   * was spent on the way in and never kept. Glass made the graph mutable in one
   * direction (see `openBox`), and a route computed before a wall opened is a
   * route that still walks round it — so the arguments are held. Nothing else
   * reads this: `rebuildFields` is the one caller, and it is what `GlassSystem`
   * amortises over the frames after a break.
   */
  private readonly fieldGoals = new Map<
    string,
    { goal: Vector3; radius: number }
  >();

  constructor(
    size: number,
    boxes: WorldBox[],
    terrain: TerrainField,
    maxSurfaces = DEFAULT_MAX_SURFACES,
  ) {
    this.cellSize = CONFIG.nav.cellSize;
    this.dim = Math.ceil(size / this.cellSize);
    this.maxSurfaces = maxSurfaces;
    this.origin = -size / 2;

    const cells = this.dim * this.dim;
    // -1 pads the slots no surface ever fills. It is NOT "below ground": every
    // read walks `counts[cell]`, which is what lets a sunken floor hold a
    // perfectly ordinary negative height.
    this.heights = new Float32Array(cells * this.maxSurfaces).fill(-1);
    this.counts = new Uint8Array(cells);
    this.walkable = new Uint8Array(cells * this.maxSurfaces);
    this.links = new Int32Array(cells * this.maxSurfaces * NEIGHBOURS.length).fill(-1);

    this.rasterize(boxes, terrain);
    this.link(boxes);
  }

  get surfaceCount(): number {
    return this.dim * this.dim * this.maxSurfaces;
  }

  /** Number of surfaces the flood fill could actually stand on. */
  get walkableCount(): number {
    let n = 0;
    for (let i = 0; i < this.walkable.length; i++) if (this.walkable[i]) n++;
    return n;
  }

  /**
   * Raw internals, for the map editor's overlay and validation passes.
   *
   * Returns LIVE references, not copies — the arrays total ~600 KB and copying
   * them per redraw would cost more than everything the caller does with them.
   * The grid is built once and read-only from then on (see the header), so
   * sharing them is safe as long as callers treat them that way: **read,
   * never write**.
   *
   * `walkable` is what the flood fill reached; a surface with `counts > 0`
   * that is neither `blocked` nor `walkable` is standable ground nothing can
   * get to — a sealed courtyard or a deck out of step range, which is exactly
   * what the editor wants to draw in red.
   */
  debugSnapshot(): {
    dim: number;
    cellSize: number;
    origin: number;
    maxSurfaces: number;
    stepHeight: number;
    heights: Float32Array;
    counts: Uint8Array;
    walkable: Uint8Array;
    blocked: Uint8Array;
    links: Int32Array;
    neighbours: readonly [number, number][];
  } {
    return {
      dim: this.dim,
      cellSize: this.cellSize,
      origin: this.origin,
      maxSurfaces: this.maxSurfaces,
      stepHeight: CONFIG.nav.stepHeight,
      heights: this.heights,
      counts: this.counts,
      walkable: this.walkable,
      blocked: this.blocked,
      links: this.links,
      neighbours: NEIGHBOURS,
    };
  }

  // --- construction --------------------------------------------------------

  /**
   * Finds every standable height in every cell by evaluating each collider's
   * top face at the cell centre. Analytic rather than raycast: 25,600 cells
   * against 300 colliders is a handful of milliseconds, where 25,600
   * `pickWithRay` calls would be seconds.
   */
  private rasterize(boxes: WorldBox[], terrain: TerrainField): void {
    // The valley floor is standable everywhere by default, at whatever height
    // the terrain field puts it. This used to be a hardcoded 0, which is why
    // the floor could never be anything but flat: the free surface in every
    // cell overrode any collider trying to dig below it.
    for (let i = 0; i < this.dim * this.dim; i++) {
      const cx = i % this.dim;
      const cz = (i - cx) / this.dim;
      this.heights[i * this.maxSurfaces] = terrain.heightAt(
        this.toWorld(cx),
        this.toWorld(cz),
      );
      this.counts[i] = 1;
    }

    for (const box of boxes) {
      // Skip the ridge: it is pure boundary, and the floor is already in.
      if (box.w > 200 || box.d > 200) continue;

      const reach = (Math.abs(box.w) + Math.abs(box.d)) / 2 + box.h;
      const minX = Math.max(0, this.toCell(box.cx - reach));
      const maxX = Math.min(this.dim - 1, this.toCell(box.cx + reach));
      const minZ = Math.max(0, this.toCell(box.cz - reach));
      const maxZ = Math.min(this.dim - 1, this.toCell(box.cz + reach));

      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const wx = this.toWorld(cx);
          const wz = this.toWorld(cz);
          const top = topFaceHeight(box, wx, wz);
          if (top === null) continue;
          this.addSurface(cz * this.dim + cx, top);
        }
      }
    }
  }

  /** Inserts a candidate height into a cell, keeping the list sorted and deduped. */
  private addSurface(cell: number, y: number): void {
    const base = cell * this.maxSurfaces;
    const n = this.counts[cell];
    for (let i = 0; i < n; i++) {
      if (Math.abs(this.heights[base + i] - y) < HEIGHT_EPS) {
        // Keep the higher of two near-identical surfaces — that's the one you
        // actually stand on where a deck overlaps its own support beam.
        if (y > this.heights[base + i]) this.heights[base + i] = y;
        return;
      }
    }
    if (n >= this.maxSurfaces) return;
    let i = n;
    while (i > 0 && this.heights[base + i - 1] > y) {
      this.heights[base + i] = this.heights[base + i - 1];
      i--;
    }
    this.heights[base + i] = y;
    this.counts[cell] = n + 1;
  }

  /**
   * Builds the surface graph, then flood-fills it from the valley floor to
   * decide what is actually reachable.
   *
   * The flood fill is what keeps bots off rooftops: a roof is a perfectly good
   * standable surface, but nothing adjacent to it is within a step, so it is
   * never reached and never becomes walkable.
   *
   * The `<= step` test below is also the map's slope limit, and terrain leans
   * on it: with cellSize 1.5 and stepHeight 0.6 a graded bank is walkable up to
   * a gradient of 0.4 (~22 deg) and severs itself above that. Nothing else
   * enforces it, which is why the editor validates a terrain rect's skirt
   * against the same ratio.
   *
   * ## Why blocked surfaces are decided FIRST
   *
   * A surface keeps one link per direction — the nearest neighbour within a
   * step — and a surface with no headroom can never be stood on, so letting
   * one win that slot spends the link on a dead end. That is not a rounding
   * error: it is what made every ramp on the map a coin toss.
   *
   * Walk one. The ground under a ramp is blocked for as long as the slab is
   * within `HEADROOM` of it, and the ramp's own top face is a *separate*
   * surface only once it stands more than `HEIGHT_EPS` (0.35 m) above that
   * ground — below which `addSurface` merges the two and the entry is free.
   * So there is a band, from 0.35 m up to the `step` (0.6 m) where the buried
   * ground drops out of range entirely, in which both surfaces are candidates
   * and the blocked one is nearer. At the barn's 0.35 gradient a 1.5 m cell
   * climbs 0.525 m, so whether a ramp's samples land in that band is decided
   * by where the grid's cell centres happen to fall against its foot — i.e. by
   * the placement's world position. The barn's loft ramp landed in it and the
   * hayloft was unreachable by every bot on the map; the boathouse's identical
   * ramp escaped only because the bog floor slopes away under it.
   *
   * Skipping blocked candidates cannot cost connectivity, because the flood
   * fill already refuses to traverse a blocked surface — the link was a dead
   * end either way. `clearBlocked` reads only `counts`/`heights`, so it is
   * free to run before the graph it now informs.
   */
  private link(boxes: WorldBox[]): void {
    const linkStride = NEIGHBOURS.length;

    // Anything with a solid box sitting on top of it is not standable.
    this.clearBlocked(boxes);

    this.linkCells(0, this.dim - 1, 0, this.dim - 1);

    // Links that pass straight through a wall thinner than a cell.
    this.severLinks(boxes);

    // Flood from the map's outer ring, which is guaranteed open ground.
    const queue: number[] = [];
    const push = (cell: number) => {
      if (this.counts[cell] === 0) return;
      const s = cell * this.maxSurfaces;
      if (this.blocked[s] || this.walkable[s]) return;
      this.walkable[s] = 1;
      queue.push(s);
    };
    for (let i = 2; i < this.dim - 2; i++) {
      push(2 * this.dim + i);
      push((this.dim - 3) * this.dim + i);
      push(i * this.dim + 2);
      push(i * this.dim + this.dim - 3);
    }

    for (let head = 0; head < queue.length; head++) {
      const surface = queue[head];
      for (let n = 0; n < linkStride; n++) {
        const next = this.links[surface * linkStride + n];
        if (next < 0 || this.walkable[next] || this.blocked[next]) continue;
        this.walkable[next] = 1;
        queue.push(next);
      }
    }
  }

  /**
   * Writes every link out of every surface in a cell rectangle, from the
   * heights and the blocked table alone.
   *
   * The whole-grid form is what `link` runs; the bounded form is what `openBox`
   * runs, and it is the SAME code rather than a second implementation because
   * the two must agree exactly — a relink that linked by slightly different
   * rules would open a route the original bake would never have drawn, in one
   * spot on one map, and nothing would say so. It writes rather than adds, so
   * running it a second time over ground that has already been severed restores
   * the links that severing removed; `openBox` re-severs afterwards, which is
   * what makes that safe.
   */
  private linkCells(x0: number, x1: number, z0: number, z1: number): void {
    const step = CONFIG.nav.stepHeight;
    const linkStride = NEIGHBOURS.length;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = cz * this.dim + cx;
        for (let si = 0; si < this.counts[cell]; si++) {
          const surface = cell * this.maxSurfaces + si;
          const y = this.heights[surface];
          for (let n = 0; n < linkStride; n++) {
            const [dx, dz] = NEIGHBOURS[n];
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= this.dim || nz >= this.dim) continue;
            const ncell = nz * this.dim + nx;
            // Nearest STANDABLE neighbouring surface within a step, if any.
            let best = -1;
            let bestDy = Infinity;
            for (let ni = 0; ni < this.counts[ncell]; ni++) {
              const other = ncell * this.maxSurfaces + ni;
              if (this.blocked[other]) continue;
              const ny = this.heights[other];
              const dy = Math.abs(ny - y);
              if (dy <= step && dy < bestDy) {
                bestDy = dy;
                best = other;
              }
            }
            this.links[surface * linkStride + n] = best;
          }
        }
      }
    }
  }

  /**
   * Cuts every link whose path between two cell centres runs through a solid
   * box.
   *
   * The rasteriser samples one column per cell *centre*, so anything thinner
   * than a cell — every fence, field wall, ruin wall and gravestone — can sit
   * between two centres and leave the cells either side both standable and
   * linked. The flow field then points straight through the wall, and the bot
   * walks into it for the rest of the round: `ObstacleField` keeps its body out
   * of the stone but cannot change where the field says to go. This was already
   * true of the chapel's graveyard fence and got much louder once the village
   * grew walls everywhere.
   *
   * Testing the *segment between the two centres* fixes it without sealing
   * doorways the way blocking whole cells would: a 1.6 m cottage door still has
   * links running through the gap, while a 0.5 m wall cuts every link crossing
   * it.
   *
   * A box only counts as a barrier where it stands more than a step above both
   * ends of the link. Otherwise a bridge deck, a kerb or the terrace's own top
   * face would cut the links leading onto itself.
   *
   * ## Pitched boxes are asked the same question, not skipped
   *
   * That height test is evaluated from the box's top-face PLANE at the
   * crossing, which is what lets a pitched box through the same gate as an
   * upright one: a ramp's own slab is within a step of the surfaces at either
   * end of a link running up it, so it spares itself exactly as the terrace top
   * does, while its underside spares the ground beneath it by `HEADROOM`.
   *
   * This used to be `if (box.rotX !== 0) continue`, on the reasoning that ramps
   * are surfaces to walk up rather than barriers. True of a ramp and false of
   * everything else pitched — above all a stair's PARAPET, which is pitched
   * only because it rails a pitched flight, and which stands a metre over the
   * treads. The manor's grand stair was the worked example: the parapet severed
   * nothing, so the graph offered diagonal links straight THROUGH the handrail,
   * every flow field took that shortcut over the flight's own foot, and
   * `ObstacleField` — which reads the same box correctly — pushed each bot
   * back out, at exactly `bodyRadius` from the rail's face. `Bot`'s stuck
   * watchdog is the only reason that was slow rather than fatal: it sidesteps
   * along whatever it is grinding on, which eventually walks the bot round to
   * the flight's foot. Measured on Greyfen, climbing from the great hall:
   * **9.7 s, four detours and ~3 s of grinding, against 4.6 s and none** with
   * the link cut. Cutting them costs no connectivity anywhere — the walkable
   * count and all seven fields' reach are identical on both maps.
   */
  private severLinks(boxes: readonly WorldBox[], within?: CellRect): void {
    const linkStride = NEIGHBOURS.length;
    const step = CONFIG.nav.stepHeight;
    for (const box of boxes) {
      if (box.w > 200 || box.d > 200) continue;
      const cosY = Math.cos(-box.rotY);
      const sinY = Math.sin(-box.rotY);
      const thickness = slabThickness(box);
      const span = this.cellsOf(box);
      // Clipped to the caller's window when there is one. `openBox` re-severs
      // only the ground it has just relinked, so a box reaching into that
      // window contributes the part of itself that overlaps and nothing else —
      // the rest of its links were never touched and must not be recomputed.
      const minX = within ? Math.max(span.minX, within.minX) : span.minX;
      const maxX = within ? Math.min(span.maxX, within.maxX) : span.maxX;
      const minZ = within ? Math.max(span.minZ, within.minZ) : span.minZ;
      const maxZ = within ? Math.min(span.maxZ, within.maxZ) : span.maxZ;

      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const cell = cz * this.dim + cx;
          if (this.counts[cell] === 0) continue;
          const wx = this.toWorld(cx);
          const wz = this.toWorld(cz);
          for (let n = 0; n < linkStride; n++) {
            const [dx, dz] = NEIGHBOURS[n];
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= this.dim || nz >= this.dim) continue;
            const ox = this.toWorld(nx);
            const oz = this.toWorld(nz);
            if (!segmentHitsBox(box, wx, wz, ox, oz)) continue;
            // Where the link meets the box, taken at the halfway point and
            // clamped into the TOP FACE — the same plane and the same clamp
            // `ObstacleField.push` reads, so a rail and a ramp are told apart
            // by their geometry rather than by their `rotX`. An upright box has
            // no slope, so this is its `cy ± h / 2` however the sample lands.
            //
            // `clampToTopFace` and not `halfDepth`: this asks how TALL the box
            // is where the link crosses it, and past the face's own edge the
            // plane keeps climbing over ground the face never reaches. Clamping
            // to the solid's footprint fed that extrapolation straight into the
            // step test below — up to a `slabThickness` too high at the edge of
            // a pitched box, which severs on a height the box does not have.
            const mx = (wx + ox) / 2 - box.cx;
            const mz = (wz + oz) / 2 - box.cz;
            const lz = clampToTopFace(box, -mx * sinY + mz * cosY);
            const top = topFaceAtLocalZ(box, lz);
            if (top === null) continue;
            const bottom = top - thickness;
            for (let si = 0; si < this.counts[cell]; si++) {
              const surface = cell * this.maxSurfaces + si;
              const other = this.links[surface * linkStride + n];
              if (other < 0) continue;
              const y = Math.max(this.heights[surface], this.heights[other]);
              // Low enough to step over, or high enough to walk under.
              if (top <= y + step || bottom > y + HEADROOM) continue;
              this.links[surface * linkStride + n] = -1;
              const back = OPPOSITE[n];
              if (this.links[other * linkStride + back] === surface) {
                this.links[other * linkStride + back] = -1;
              }
            }
          }
        }
      }
    }
  }

  /**
   * The cell rectangle a box can reach, generously.
   *
   * Shared by `severLinks` and `openBox` so the ground one of them re-links is
   * exactly the ground the other severs — the two ran identical arithmetic in
   * two places first, which is a pair that can drift by a cell and leave a
   * relinked strip nothing re-severs.
   */
  private cellsOf(box: WorldBox): CellRect {
    // The pitch term is what the footprint gains by leaning; the rest is the
    // generous bound this always used.
    const reach =
      (Math.abs(box.w) + Math.abs(box.d)) / 2 +
      (box.h / 2) * Math.abs(Math.sin(box.rotX)) +
      this.cellSize * 2;
    return {
      minX: Math.max(0, this.toCell(box.cx - reach)),
      maxX: Math.min(this.dim - 1, this.toCell(box.cx + reach)),
      minZ: Math.max(0, this.toCell(box.cz - reach)),
      maxZ: Math.min(this.dim - 1, this.toCell(box.cz + reach)),
    };
  }

  /**
   * Takes one box out of the graph: relinks the ground it was severing, and
   * floods walkability into whatever that opened.
   *
   * **This is the only mutation the graph admits, and it is monotonic.** A pane
   * of glass breaks and never mends, so the graph only ever GAINS links — which
   * is what makes an incremental update safe rather than merely cheap. No route
   * that was valid can become invalid; a field computed before the break is
   * stale (it walks the long way) and never wrong, so a bot steering on one
   * while `rebuildField` catches up is following a route that still exists.
   *
   * `boxes` must be the collider set with `box` ALREADY REMOVED, or the sever
   * pass puts back exactly what this was called to take away.
   *
   * The work is bounded by the box: relink its own cell rectangle, re-sever
   * that rectangle against everything else, then flood from the surfaces around
   * its edge. What it does NOT do is rebuild the flow fields — those are the
   * expensive half and are the caller's to amortise. See `GlassSystem`.
   *
   * Returns the number of surfaces that became walkable, which is 0 for the
   * ordinary case of a window in a wall a body could already walk round, and
   * positive when the break opened a space that was genuinely sealed.
   */
  openBox(box: WorldBox, boxes: readonly WorldBox[]): number {
    const rect = this.cellsOf(box);
    this.linkCells(rect.minX, rect.maxX, rect.minZ, rect.maxZ);
    this.severLinks(boxes, rect);

    // Flood outward from every walkable surface in the window. The links out of
    // it now include whatever the box was cutting, so this reaches anything the
    // break opened — and it terminates immediately in the common case, where
    // both sides were already connected by another route.
    const linkStride = NEIGHBOURS.length;
    const queue: number[] = [];
    for (let cz = rect.minZ; cz <= rect.maxZ; cz++) {
      for (let cx = rect.minX; cx <= rect.maxX; cx++) {
        const cell = cz * this.dim + cx;
        for (let si = 0; si < this.counts[cell]; si++) {
          const surface = cell * this.maxSurfaces + si;
          if (this.walkable[surface]) queue.push(surface);
        }
      }
    }
    let opened = 0;
    for (let head = 0; head < queue.length; head++) {
      const surface = queue[head];
      for (let n = 0; n < linkStride; n++) {
        const next = this.links[surface * linkStride + n];
        if (next < 0 || this.walkable[next] || this.blocked[next]) continue;
        this.walkable[next] = 1;
        opened++;
        queue.push(next);
      }
    }
    return opened;
  }

  private blocked = new Uint8Array(0);

  /**
   * Marks surfaces with no headroom. A cottage's interior floor has a roof slab
   * well above it and stays clear; the cell *under* a wall does not.
   */
  private clearBlocked(boxes: WorldBox[]): void {
    this.blocked = new Uint8Array(this.dim * this.dim * this.maxSurfaces);
    for (const box of boxes) {
      if (box.w > 200 || box.d > 200) continue;
      const reach = (Math.abs(box.w) + Math.abs(box.d)) / 2 + box.h;
      const minX = Math.max(0, this.toCell(box.cx - reach));
      const maxX = Math.min(this.dim - 1, this.toCell(box.cx + reach));
      const minZ = Math.max(0, this.toCell(box.cz - reach));
      const maxZ = Math.min(this.dim - 1, this.toCell(box.cz + reach));
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const wx = this.toWorld(cx);
          const wz = this.toWorld(cz);
          const span = verticalSpan(box, wx, wz);
          if (!span) continue;
          const cell = cz * this.dim + cx;
          for (let si = 0; si < this.counts[cell]; si++) {
            const y = this.heights[cell * this.maxSurfaces + si];
            // Overlapping the space a body would occupy, but not merely being
            // the surface itself.
            if (span.top > y + 0.15 && span.bottom < y + HEADROOM) {
              this.blocked[cell * this.maxSurfaces + si] = 1;
            }
          }
        }
      }
    }
  }

  // --- queries -------------------------------------------------------------

  private toCell(world: number): number {
    return Math.floor((world - this.origin) / this.cellSize);
  }

  private toWorld(cell: number): number {
    return this.origin + (cell + 0.5) * this.cellSize;
  }

  /**
   * The walkable surface at a world position, or -1. Picks the standable height
   * nearest the given `y`, so a bot on a bridge resolves to the deck and one in
   * the creek resolves to the floor.
   */
  surfaceAt(x: number, y: number, z: number): number {
    const cx = this.toCell(x);
    const cz = this.toCell(z);
    if (cx < 0 || cz < 0 || cx >= this.dim || cz >= this.dim) return -1;
    const cell = cz * this.dim + cx;
    let best = -1;
    let bestDy = Infinity;
    for (let si = 0; si < this.counts[cell]; si++) {
      const s = cell * this.maxSurfaces + si;
      if (!this.walkable[s]) continue;
      const dy = Math.abs(this.heights[s] - y);
      if (dy < bestDy) {
        bestDy = dy;
        best = s;
      }
    }
    return best;
  }

  /** Standing height of a surface. */
  heightOf(surface: number): number {
    return this.heights[surface];
  }

  /** World centre of a surface's cell. */
  positionOf(surface: number, into: Vector3): Vector3 {
    const cell = Math.floor(surface / this.maxSurfaces);
    return into.set(
      this.toWorld(cell % this.dim),
      this.heights[surface],
      this.toWorld(Math.floor(cell / this.dim)),
    );
  }

  /**
   * Precomputes a flow field: a breadth-first sweep out from every surface
   * inside `radius` of the goal. Called once per objective at load.
   */
  buildField(name: string, goal: Vector3, radius: number): FlowField {
    const dist = new Float32Array(this.surfaceCount).fill(Infinity);
    const queue: number[] = [];
    const linkStride = NEIGHBOURS.length;

    const r = Math.ceil(radius / this.cellSize);
    const gx = this.toCell(goal.x);
    const gz = this.toCell(goal.z);
    for (let cx = gx - r; cx <= gx + r; cx++) {
      for (let cz = gz - r; cz <= gz + r; cz++) {
        if (cx < 0 || cz < 0 || cx >= this.dim || cz >= this.dim) continue;
        const s = this.surfaceAt(this.toWorld(cx), goal.y, this.toWorld(cz));
        if (s < 0 || dist[s] === 0) continue;
        dist[s] = 0;
        queue.push(s);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const s = queue[head];
      const next = dist[s] + 1;
      for (let n = 0; n < linkStride; n++) {
        const t = this.links[s * linkStride + n];
        if (t < 0 || !this.walkable[t] || dist[t] <= next) continue;
        dist[t] = next;
        queue.push(t);
      }
    }

    const field = new FlowField(name, dist);
    this.fields.set(name, field);
    this.fieldGoals.set(name, { goal: goal.clone(), radius });
    return field;
  }

  field(name: string): FlowField | undefined {
    return this.fields.get(name);
  }

  /** Every field's name, in the order they were first built. */
  get fieldNames(): string[] {
    return [...this.fields.keys()];
  }

  /**
   * Rebuilds one field from the goal it was first built with.
   *
   * **A field is REPLACED rather than written through**, because a bot may be
   * steering on it in the same frame: `buildField` allocates a fresh
   * `Float32Array`, fills it and only then swaps the map entry, so a reader
   * holding the old `FlowField` sees a complete route that is merely one break
   * out of date. Filling in place would hand it a half-swept field with
   * `Infinity` in the half not reached yet, and a bot on one of those surfaces
   * would read itself as stranded and stop.
   *
   * Returns false for a name that was never built, which is the only way this
   * can be asked about a field that does not exist.
   */
  rebuildField(name: string): boolean {
    const from = this.fieldGoals.get(name);
    if (!from) return false;
    this.buildField(name, from.goal, from.radius);
    return true;
  }

  /**
   * Direction to move from `pos` to get closer to a field's goal: the
   * neighbouring surface with the lowest remaining distance. Returns a zero
   * vector at the goal or when stranded.
   */
  steer(field: FlowField, pos: Vector3, into: Vector3): Vector3 {
    into.setAll(0);
    const here = this.surfaceAt(pos.x, pos.y, pos.z);
    if (here < 0) return into;
    const linkStride = NEIGHBOURS.length;
    let best = -1;
    let bestDist = field.dist[here];
    for (let n = 0; n < linkStride; n++) {
      const t = this.links[here * linkStride + n];
      if (t < 0 || !this.walkable[t]) continue;
      if (field.dist[t] < bestDist) {
        bestDist = field.dist[t];
        best = t;
      }
    }
    if (best < 0) return into;

    const cell = Math.floor(best / this.maxSurfaces);
    const dx = this.toWorld(cell % this.dim) - pos.x;
    const dz = this.toWorld(Math.floor(cell / this.dim)) - pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return into;
    return into.set(dx / len, 0, dz / len);
  }

  /**
   * Like `steer`, but aims at a cell `steps` further down the gradient.
   *
   * `steer` returns the direction to the single best 8-neighbour cell *centre*,
   * which is why bots walked flow fields as a visible 1.5 m zigzag: every step
   * re-aimed at the next centre in turn. Looking further ahead points at where
   * the route is actually going.
   *
   * The result is blended with the immediate direction rather than used raw. A
   * route that bends round a corner has a lookahead cell on the far side of the
   * wall, and steering straight at it would drive the bot into the stone; the
   * blend cuts the corner without ever aiming hard through it, and the caller's
   * stuck watchdog covers what is left.
   */
  steerAhead(field: FlowField, pos: Vector3, steps: number, into: Vector3): Vector3 {
    into.setAll(0);
    let here = this.surfaceAt(pos.x, pos.y, pos.z);
    if (here < 0) return into;

    const linkStride = NEIGHBOURS.length;
    let firstX = 0;
    let firstZ = 0;
    let aheadX = pos.x;
    let aheadZ = pos.z;

    for (let step = 0; step < steps; step++) {
      let best = -1;
      let bestDist = field.dist[here];
      for (let n = 0; n < linkStride; n++) {
        const t = this.links[here * linkStride + n];
        if (t < 0 || !this.walkable[t]) continue;
        if (field.dist[t] < bestDist) {
          bestDist = field.dist[t];
          best = t;
        }
      }
      if (best < 0) break;
      const cell = Math.floor(best / this.maxSurfaces);
      aheadX = this.toWorld(cell % this.dim);
      aheadZ = this.toWorld(Math.floor(cell / this.dim));
      if (step === 0) {
        firstX = aheadX - pos.x;
        firstZ = aheadZ - pos.z;
      }
      here = best;
    }

    const firstLen = Math.hypot(firstX, firstZ);
    if (firstLen < 1e-4) return into;
    const aheadLen = Math.hypot(aheadX - pos.x, aheadZ - pos.z);
    if (aheadLen < 1e-4) return into.set(firstX / firstLen, 0, firstZ / firstLen);

    const x = firstX / firstLen + (aheadX - pos.x) / aheadLen;
    const z = firstZ / firstLen + (aheadZ - pos.z) / aheadLen;
    const len = Math.hypot(x, z);
    if (len < 1e-4) return into.set(firstX / firstLen, 0, firstZ / firstLen);
    return into.set(x / len, 0, z / len);
  }

  /** True when a field can reach the surface under `pos` at all. */
  reachable(field: FlowField, pos: Vector3): boolean {
    const s = this.surfaceAt(pos.x, pos.y, pos.z);
    return s >= 0 && field.dist[s] !== Infinity;
  }
}
