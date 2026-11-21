/**
 * viewer/marks.ts — The layout's entries that have no geometry of their own —
 * scatter regions, control points, spawns, water rects and grass rects — as
 * SHAPES on the ground plane: `editor/proxies.ts`'s stand-ins without their
 * meshes (`BABYLON_EXIT.md` X5.3b, row "X5.3, the viewer's overlays").
 * Owns: the shape list and nothing else; `ViewerPlan` paints it.
 *
 * Each entry is the proxy's own reading of the thing, in world metres:
 * a control point is a ring at its TRUE radius (`ControlPointDef.radius`, which
 * is what `pointAt` tests, so the line is the zone and not an illustration of
 * one); a spawn is an arrow along its yaw, coloured by side; water and grass
 * are their rectangles; a scatter region is its boundary — a ring, or an
 * oriented frame turned by the same left-handed `rotY` `MapBuilder` lays it
 * with — never a filled sheet, since the water and the grass own that reading.
 * A proxy also stood a pole on each flag and spawn; a plan seen from above has
 * no use for a height, so the pole is the flag's hexagon here.
 *
 * Never: makes a mesh, a collider or a `WorldBox`, or reads anything but the
 * map's layout-derived lists and the layout's scatter (which `GameMap` keeps no
 * record of, the proxies' reason for taking it apart).
 */
import { isScatterRect, type ScatterSpec } from "../world/layout";
import type { GameMap } from "../world/MapBuilder";
import { VIEWER } from "./tuning";

export interface PlanRing {
  x: number;
  z: number;
  r: number;
  color: string;
}

/** A closed outline, corners in order. */
export interface PlanOutline {
  xs: number[];
  zs: number[];
  color: string;
  /** Filled at this alpha under its line; 0 is a boundary alone. */
  fill: number;
}

export interface PlanArrow {
  x: number;
  z: number;
  /** 0 faces +Z, map north, as a spawn's `yaw` does. */
  yaw: number;
  color: string;
}

export interface PlanFlag {
  x: number;
  z: number;
  r: number;
  id: string;
}

export interface PlanMarks {
  rings: PlanRing[];
  outlines: PlanOutline[];
  arrows: PlanArrow[];
  flags: PlanFlag[];
}

export function marksOf(map: GameMap, scatter: readonly ScatterSpec[]): PlanMarks {
  const c = VIEWER.colors;
  const out: PlanMarks = { rings: [], outlines: [], arrows: [], flags: [] };

  for (const cp of map.controlPoints) {
    out.flags.push({ x: cp.pos.x, z: cp.pos.z, r: cp.radius, id: cp.id });
  }
  for (const s of map.spawns) {
    out.arrows.push({ x: s.pos.x, z: s.pos.z, yaw: s.yaw, color: s.team === 1 ? c.spawnEnemy : c.spawnFriendly });
  }
  for (const r of map.water) out.outlines.push(rect(r.x, r.z, r.width, r.depth, 0, c.water, 0.22));
  for (const r of map.grass) out.outlines.push(rect(r.x, r.z, r.width, r.depth, 0, c.grass, 0.16));
  for (const s of scatter) {
    if (isScatterRect(s)) out.outlines.push(rect(s.x, s.z, s.width, s.depth, s.rotY ?? 0, c.scatter, 0));
    else out.rings.push({ x: s.x, z: s.z, r: s.radius, color: c.scatter });
  }
  return out;
}

/**
 * An oriented rectangle's corners, turned about its centre by `rotY` in
 * `MapBuilder`'s convention — local (lx, lz) to world (x + lx·cos + lz·sin,
 * z − lx·sin + lz·cos), the proxies' `frame` — so a region and its mark turn
 * the same way.
 */
function rect(
  x: number,
  z: number,
  width: number,
  depth: number,
  rotY: number,
  color: string,
  fill: number,
): PlanOutline {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const xs: number[] = [];
  const zs: number[] = [];
  for (const [lx, lz] of [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ]) {
    xs.push(x + lx * c + lz * s);
    zs.push(z - lx * s + lz * c);
  }
  return { xs, zs, color, fill };
}
