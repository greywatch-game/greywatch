/**
 * editor/mutate.ts — Applies a moved/rotated selection to the layout and to
 * the geometry already in the scene.
 * Owns: the write path. Reading is inspect.ts's job. That includes a path
 * road's POINTS — moved, inserted, deleted and re-centred in the placement's
 * own frame (see "path roads" below) — which the handles in `pathHandles.ts`
 * draw and nothing else writes.
 *
 * The layout is the source of truth and is edited in place; the scene is
 * brought back into agreement with it. Two tiers, because they cost three
 * orders of magnitude apart (measured, not guessed):
 *
 * - **Reposition** — visuals, colliders and WorldBoxes moved directly.
 *   Sub-millisecond, so it runs on every frame of a drag. A builder assembles
 *   at the origin and MapBuilder transforms the result, so a placement's
 *   transform is genuinely all that changes when it moves.
 * - **Navigation** — NavGrid plus all seven flow fields, and ObstacleField.
 *   ~45 ms, so it runs when a drag ends, not during it.
 *
 * Editing a param, changing a kind, and adding or deleting an entry are the
 * third tier and are NOT handled here: they alter the geometry itself and can
 * change how many colliders an item emits, which shifts every later index in
 * `colliderBoxes` and invalidates the whole editor index. This file writes the
 * layout for them (`setField` / `addItem` / `deleteItem`) and reports which
 * tier the caller owes with `tierFor`; performing the rebuild is the caller's
 * decision, because it disposes the map the caller is holding.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { BuilderKind } from "../world/BuildingKit";
import type { EnvironmentSpec } from "../world/environment";
import {
  DEFAULT_FLOOR_SURFACE,
  FLOOR_SURFACE_IDS,
  type FloorSurfaceId,
} from "../world/floorSurfaces";
import { isScatterRect, type MapLayout } from "../world/layout";
import { repositionItem, type GameMap } from "../world/MapBuilder";
import { waterY, type TerrainField } from "../world/TerrainField";
import { NavGrid } from "../world/NavGrid";
import { ObstacleField } from "../world/ObstacleField";
import {
  isAngleKey,
  isIntegerKey,
  isOptionalKey,
  toRadians,
  type FieldValue,
} from "./fields";
import { PARAMS, paramKeys, SCATTER_DEFAULTS } from "./params";
import type { SelectionList, SelectionRef } from "./selection";

/**
 * Where a selected item currently sits **in the world**, for the gizmo to
 * attach to and for `repositionScene` to move geometry to.
 *
 * This is not the same as what the layout stores. A placement's, scatter
 * region's or grass rect's `y` is an offset above the local floor, so the
 * terrain height has to be added back to find the thing on screen — otherwise
 * the handle hangs in the air over anything standing in a basin. Control
 * points and spawns are authored absolute and need no adjustment.
 */
export function originOf(
  layout: MapLayout,
  ref: SelectionRef,
  terrain: TerrainField,
): Vector3 | null {
  const lift = (x: number, y: number, z: number) =>
    new Vector3(x, y + terrain.heightAt(x, z), z);

  switch (ref.list) {
    case "placements": {
      const p = layout.placements[ref.index];
      return p ? lift(p.x, p.y ?? 0, p.z) : null;
    }
    case "scatter": {
      const s = layout.scatter[ref.index];
      return s ? lift(s.x, s.y ?? 0, s.z) : null;
    }
    case "controlPoints":
      return layout.controlPoints[ref.index]?.pos.clone() ?? null;
    case "spawns":
      return layout.spawns[ref.index]?.pos.clone() ?? null;
    case "water": {
      const r = layout.water?.[ref.index];
      return r ? new Vector3(r.x, waterY(r, terrain), r.z) : null;
    }
    case "grass": {
      const r = layout.grass?.[ref.index];
      return r ? lift(r.x, r.y ?? 0, r.z) : null;
    }
    // The floor is the whole map. Nothing to attach a gizmo to, and a handle
    // planted somewhere on it would claim it could be dragged.
    case "floor":
      return null;
  }
}

/** The item's current Y rotation, or 0 for things that have no facing. */
export function rotationOf(layout: MapLayout, ref: SelectionRef): number {
  if (ref.list === "placements") return layout.placements[ref.index]?.rotY ?? 0;
  if (ref.list === "spawns") return layout.spawns[ref.index]?.yaw ?? 0;
  if (ref.list === "scatter") {
    const s = layout.scatter[ref.index];
    return s && isScatterRect(s) ? (s.rotY ?? 0) : 0;
  }
  return 0;
}

/**
 * Whether to show the rotation ring. Placements and spawns always; a scatter
 * region only when it is a rectangle — turning a disc does nothing, and a
 * handle that visibly does nothing reads as a broken one.
 */
export function isRotatable(layout: MapLayout, ref: SelectionRef): boolean {
  if (ref.list === "scatter") {
    const s = layout.scatter[ref.index];
    return s !== undefined && isScatterRect(s);
  }
  return ref.list === "placements" || ref.list === "spawns";
}

/**
 * Rounds a dragged value to the precision the serializer writes at.
 *
 * Gizmo drags do not produce exact numbers even with snapping on: a quarter
 * turn comes back as 1.5707963267948968, and a rotation taken back to zero
 * lands on something like 1e-17 rather than 0. Storing that raw caused a
 * cottage rotated and un-rotated to be written as `rotY: 0` — not `=== 0`, so
 * the field was never dropped, then rounded to "0" on the way out. Quantising
 * here keeps the layout data identical to what gets written to the file.
 */
function q(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Angles get their own treatment, and must NOT be rounded to three decimals
 * like positions are.
 *
 * `Math.PI / 2` is 1.5707963…; rounded to 1.571 it is no longer a quarter turn
 * to within the serializer's tolerance, so it would be written as the literal
 * `1.571` instead of `Math.PI / 2` and the file would drift away from the way
 * it is authored. So a value within a whisker of a quarter turn is snapped to
 * the exact quarter turn, and anything genuinely freehand keeps six decimals.
 */
function qAngle(v: number): number {
  const turns = v / Math.PI;
  const quarter = Math.round(turns * 4) / 4;
  if (Math.abs(turns - quarter) < 1e-6) {
    const exact = quarter * Math.PI;
    return Object.is(exact, -0) ? 0 : exact;
  }
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Cleans up a raw gizmo transform. Call this once per drag and hand the result
 * to both the layout write and the scene reposition, so what is stored and
 * what is drawn can never disagree.
 */
export function quantize(at: Vector3, rotY: number): { at: Vector3; rotY: number } {
  return { at: new Vector3(q(at.x), q(at.y), q(at.z)), rotY: qAngle(rotY) };
}

/**
 * Writes a new transform into the layout.
 *
 * Optional fields are dropped when they quantise to zero rather than written
 * as an explicit `0` — `y` and `rotY` are absent by default in the data and
 * should stay absent, so a drag that returns something to where it started
 * leaves no trace in the file.
 */
export function applyTransform(
  layout: MapLayout,
  ref: SelectionRef,
  position: Vector3,
  rotation: number,
  terrain: TerrainField,
): void {
  const at = new Vector3(q(position.x), q(position.y), q(position.z));
  const rotY = qAngle(rotation);
  // The gizmo works in world space; the layout stores a height above the local
  // floor. Convert on the way in, so dragging something sideways across a bank
  // keeps its relationship to the ground rather than to sea level.
  const rel = q(at.y - terrain.heightAt(at.x, at.z));

  switch (ref.list) {
    case "placements": {
      const p = layout.placements[ref.index];
      if (!p) return;
      p.x = at.x;
      p.z = at.z;
      // y is optional in the data and absent means "on the ground". Keep it
      // that way rather than writing a zero into every layout line.
      if (rel === 0) delete p.y;
      else p.y = rel;
      if (rotY === 0) delete p.rotY;
      else p.rotY = rotY;
      return;
    }
    case "scatter": {
      const s = layout.scatter[ref.index];
      if (!s) return;
      s.x = at.x;
      s.z = at.z;
      if (rel === 0) delete s.y;
      else s.y = rel;
      // Only a rectangle has a facing; a disc's `rotY` would be noise in the
      // file describing nothing.
      if (isScatterRect(s)) {
        if (rotY === 0) delete s.rotY;
        else s.rotY = rotY;
      }
      return;
    }
    case "controlPoints": {
      // The Vector3 is shared by reference into GameMap and ConquestSystem, so
      // it is mutated rather than replaced.
      layout.controlPoints[ref.index]?.pos.copyFrom(at);
      return;
    }
    case "spawns": {
      const s = layout.spawns[ref.index];
      if (!s) return;
      s.pos.copyFrom(at);
      s.yaw = rotY;
      return;
    }
    case "water": {
      const r = layout.water?.[ref.index];
      if (!r) return;
      r.x = at.x;
      r.z = at.z;
      // A pool's surface is absolute — it is level whatever its bed does — so
      // this stores the world height, and drops it when the rect is back at
      // ankle-deep over its own bed.
      const def = q(terrain.heightAt(at.x, at.z) + CONFIG.water.surfaceY);
      if (at.y === def) delete r.y;
      else r.y = at.y;
      return;
    }
    case "grass": {
      const r = layout.grass?.[ref.index];
      if (!r) return;
      r.x = at.x;
      r.z = at.z;
      if (rel === 0) delete r.y;
      else r.y = rel;
      return;
    }
  }
}

/**
 * How much has to be rebuilt after a structural change to one of these lists.
 *
 * Placements, scatter, water and grass all feed geometry the builder produces,
 * so they need a full rebuild. Control points and spawns produce no geometry
 * at all — they are proxy meshes plus one flow field each, so navigation is
 * the whole cost.
 *
 * The floor takes the full rebuild too, and for a reason worth stating: unlike
 * everything else on an `EnvironmentSpec`, its colour and surface are a
 * MATERIAL, baked into the terrain blocks by `MapBuilder.buildValley` rather
 * than pushed as a uniform. `applyEnvironment` cannot reach it — which is the
 * same fact `workLight.ts` states from the other side when it refuses to touch
 * `floorColor`.
 */
export type Tier = "geometry" | "navigation";

export function tierFor(list: SelectionList): Tier {
  return list === "controlPoints" || list === "spawns" ? "navigation" : "geometry";
}

/** Anything that can be added or deleted — which is every list. */
export type EntryRecord = Record<string, unknown>;

/**
 * The layout array behind a selection list. The list names are the layout's
 * own key names, which is what makes this generic pass safe.
 */
function arrayFor(layout: MapLayout, list: SelectionList): EntryRecord[] | undefined {
  const v = (layout as unknown as Record<string, unknown>)[list];
  return Array.isArray(v) ? (v as EntryRecord[]) : undefined;
}

/**
 * The two lists that are OPTIONAL on `MapLayout`: a map with no pools and no
 * lawns omits them, and Coldharbour omits both.
 *
 * They are the reason `addItem` creates rather than refuses. "This map has
 * never had grass" is not a state the author can do anything about from inside
 * the editor — the add is the request to give it some — and refusing made the
 * feature look broken on exactly the maps that most needed it. The other four
 * lists are required, so a missing one there means the layout is not a layout
 * and inventing an array would paper over it.
 *
 * Creating the array is only half of it: `serializeLayout` writes the matching
 * `const` into the source, so the declaration and the entries appear together
 * on the next save. Neither half is any use alone — an array with no
 * declaration is entries that vanish on Ctrl+S.
 */
const OPTIONAL_LISTS = new Set<SelectionList>(["water", "grass"]);

/** The array behind a list, created empty when the map has never had one. */
function arrayForOrCreate(
  layout: MapLayout,
  list: SelectionList,
): EntryRecord[] | undefined {
  const existing = arrayFor(layout, list);
  if (existing) return existing;
  if (!OPTIONAL_LISTS.has(list)) return undefined;
  const fresh: EntryRecord[] = [];
  (layout as unknown as Record<string, unknown>)[list] = fresh;
  return fresh;
}

function entryFor(layout: MapLayout, ref: SelectionRef): EntryRecord | undefined {
  return arrayFor(layout, ref.list)?.[ref.index];
}

/** Rounds a value the way the field it belongs to should be stored. */
function quantizeField(key: string, v: number): number {
  if (isAngleKey(key)) return qAngle(toRadians(v));
  if (isIntegerKey(key)) return Math.max(0, Math.round(v));
  return q(v);
}

/**
 * Writes one value, or removes the field when the value is the absent one.
 *
 * "Absent" is not the same as "zero" everywhere, which is why this is a rule
 * and not an assignment: `y` absent means on the ground, `rotY` absent means
 * unrotated, and a non-blocking scatter region simply has no `blocking` key.
 * Writing those explicitly would add a field to every line the editor touches
 * and drift the file away from how it is authored.
 *
 * A field that is NOT optional keeps whatever it had when the control is
 * cleared, rather than losing the key: the panel re-syncs from the layout on
 * the next frame, and a rect that has lost its `width` builds as NaN.
 */
function put(target: EntryRecord, key: string, value: FieldValue): void {
  if (value === null || value === "") {
    if (isOptionalKey(key)) delete target[key];
    return;
  }
  if (typeof value === "boolean") {
    if (!value && isOptionalKey(key)) delete target[key];
    else target[key] = value;
    return;
  }
  if (typeof value === "string") {
    target[key] = value;
    return;
  }
  const n = quantizeField(key, value);
  if (n === 0 && isOptionalKey(key)) delete target[key];
  else target[key] = n;
}

/**
 * A placement's kind changed: keep only the params the new builder reads.
 *
 * Choosing the kind it already has is not a change. Pruning on it anyway would
 * take a path road's `path` — which is not in the descriptor table, being a
 * list of points rather than a control — and leave a 40 m rectangle behind.
 */
function setKind(entry: EntryRecord, kind: string): void {
  if (!(kind in PARAMS) || entry.kind === kind) return;
  entry.kind = kind;
  const params = entry.params as EntryRecord | undefined;
  if (!params) return;
  const allowed = paramKeys(kind as BuilderKind);
  for (const k of Object.keys(params)) {
    if (!allowed.has(k)) delete params[k];
  }
  if (!Object.keys(params).length) delete entry.params;
}

/**
 * One params field. A value equal to the builder's own default is REMOVED
 * rather than written, so `{ kind: "cottage", x, z }` stays that short instead
 * of accumulating every field the inspector happened to show.
 */
function setParam(entry: EntryRecord, key: string, value: FieldValue): void {
  const specs = PARAMS[entry.kind as BuilderKind] ?? [];
  const spec = specs.find((s) => s.key === key);
  const bag = (entry.params as EntryRecord | undefined) ?? {};

  let next = value;
  if (spec?.type === "choice" && spec.numeric && typeof next === "string") {
    next = Number(next);
  }
  const isDefault =
    spec !== undefined &&
    next !== null &&
    (spec.type === "choice"
      ? String(next) === spec.def
      : spec.type === "number"
        ? typeof next === "number" &&
          quantizeField(key, next) === spec.def
        : next === spec.def);

  // Every param is optional by construction — absent means the builder's own
  // default — so clearing one removes it, which is not what `put` does for a
  // required top-level field.
  if (isDefault || next === null || next === "") delete bag[key];
  else put(bag, key, next);

  if (Object.keys(bag).length) entry.params = bag;
  else delete entry.params;
}

/**
 * A scatter region's shape. `radius` and `width`/`depth` are alternatives and
 * never coexist — the presence of `width` is what makes a region rectangular —
 * so this writes one set and removes the other, rather than leaving a stale
 * field behind for the next reader to trip over.
 *
 * The new extents keep the footprint recognisable: a disc becomes the square
 * that contains it and a rectangle becomes the disc that contains its longer
 * side, so the count spread over it still reads as roughly the same field
 * rather than jumping density on the way through the control.
 */
function setShape(entry: EntryRecord, shape: string): void {
  const wantRect = shape === "rect";
  if (wantRect === (entry.width !== undefined)) return;
  if (wantRect) {
    const r = Number(entry.radius ?? 8);
    entry.width = q(r * 2);
    entry.depth = q(r * 2);
    delete entry.radius;
  } else {
    const w = Number(entry.width ?? 16);
    const d = Number(entry.depth ?? 16);
    entry.radius = q(Math.max(w, d) / 2);
    delete entry.width;
    delete entry.depth;
    delete entry.rotY;
  }
}

/** A `[min, max]` scale pair, dropped entirely when it is back at 1..1. */
function setScale(entry: EntryRecord, index: number, value: FieldValue): void {
  const current = entry.scale as [number, number] | undefined;
  const next: [number, number] = [current?.[0] ?? 1, current?.[1] ?? 1];
  next[index] = value === null || value === "" ? 1 : q(Number(value));
  if (next[0] === 1 && next[1] === 1) delete entry.scale;
  else entry.scale = next;
}

/**
 * A spawn's owner. `team` and `controlPoint` are one decision spelled as two
 * fields, so they are always written together — a spawn carrying both, or
 * neither, is a state ConquestSystem has no reading for.
 */
function setOwner(entry: EntryRecord, owner: string): void {
  if (owner.startsWith("team:")) {
    entry.team = Number(owner.slice(5)) === 1 ? 1 : 0;
    delete entry.controlPoint;
  } else {
    entry.team = null;
    entry.controlPoint = owner.slice(3);
  }
}

/**
 * Applies one inspector field to the layout. `key` is the dotted path the
 * field was built with (see `fields.ts`); the three compound keys — `kind`,
 * `owner` and `shape` — write more than one field each.
 *
 * The layout entry is mutated in place, and Vector3s are written component-wise
 * rather than replaced: `controlPoints[i].pos` is shared by reference into
 * GameMap and ConquestSystem.
 */
export function setField(
  layout: MapLayout,
  ref: SelectionRef,
  key: string,
  value: FieldValue,
): void {
  const entry = entryFor(layout, ref);
  if (!entry) return;

  const dot = key.indexOf(".");
  const head = dot < 0 ? key : key.slice(0, dot);
  const tail = dot < 0 ? "" : key.slice(dot + 1);

  if (key === "kind") return setKind(entry, String(value));
  if (key === "owner") return setOwner(entry, String(value));
  if (key === "shape") {
    // Two entries have a shape, and a road's is a different decision from a
    // scatter region's: a rectangle or a centreline, not a disc or a box.
    if (ref.list === "placements") return setRoadShape(entry, String(value));
    return setShape(entry, String(value));
  }
  if (head === "params") return setParam(entry, tail, value);
  if (head === "scale") return setScale(entry, Number(tail), value);
  if (head === "pos") {
    const pos = entry.pos as Vector3 | undefined;
    if (!pos || typeof value !== "number") return;
    if (tail === "x") pos.x = q(value);
    else if (tail === "y") pos.y = q(value);
    else if (tail === "z") pos.z = q(value);
    return;
  }
  put(entry, key, value);
}

/**
 * Applies one inspector field to the map's ENVIRONMENT — the floor's colour
 * and surface, which live on the `EnvironmentSpec` rather than in any layout
 * array. Its own entry point rather than a branch inside `setField` because
 * that function's whole contract is "a layout entry, mutated in place", and
 * the two writes have nothing in common but the caller.
 *
 * Reports whether anything actually moved. A colour input fires on every step
 * of a drag and the rebuild it schedules is the ~570 ms one, so a value that
 * repeats must not buy another.
 */
export function setFloorField(
  env: EnvironmentSpec,
  key: string,
  value: FieldValue,
): boolean {
  if (key === "floorColor") {
    // Normalised because the control emits `#RRGGBB` in whichever case the
    // browser prefers, and the colour is part of a material's cache key.
    const hex = String(value).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex) || hex === env.floorColor) return false;
    env.floorColor = hex;
    return true;
  }
  if (key === "floorSurface") {
    const id = String(value) as FloorSurfaceId;
    if (!FLOOR_SURFACE_IDS.includes(id)) return false;
    // The default is spelled by absence, like every other optional field —
    // a map that wants no pattern says nothing rather than saying "flat".
    const next = id === DEFAULT_FLOOR_SURFACE ? undefined : id;
    if (next === env.floorSurface) return false;
    if (next === undefined) delete env.floorSurface;
    else env.floorSurface = next;
    return true;
  }
  return false;
}

/**
 * Appends a new entry to one of the layout's lists and returns a ref to it.
 *
 * `choice` names the builder kind or the scatter prop and is ignored by the
 * lists that have neither. New entries carry as few fields as they can get
 * away with — a placement is `{ kind, x, z }` and picks up its dimensions from
 * the builder — because that is how the file is written by hand.
 */
export function addItem(
  layout: MapLayout,
  list: SelectionList,
  choice: string,
  at: Vector3,
  terrain: TerrainField,
): SelectionRef | null {
  const array = arrayForOrCreate(layout, list);
  if (!array) return null;
  const x = q(at.x);
  const z = q(at.z);
  // `at` is a world point snapped to the nav surface. Flags and spawns store
  // that as-is; everything else stores a height above the local floor, which
  // is zero for anything dropped straight onto the ground.
  const world = q(at.y);
  const y = q(at.y - terrain.heightAt(x, z));

  switch (list) {
    case "placements": {
      if (choice === ROAD_PATH_CHOICE) {
        // Two points, one straight leg of the default length along local Z —
        // the same line a fresh rectangle road would cover — so the first
        // thing on screen is a road to pull points out of, not a dot.
        const half = PATH_START_LENGTH / 2;
        array.push({
          kind: "road",
          x,
          z,
          ...(y === 0 ? {} : { y }),
          params: { path: [[0, -half], [0, half]] },
        });
        break;
      }
      if (!(choice in PARAMS)) return null;
      array.push({ kind: choice, x, z, ...(y === 0 ? {} : { y }) });
      break;
    }
    case "scatter": {
      const defaults = SCATTER_DEFAULTS[choice as keyof typeof SCATTER_DEFAULTS];
      if (!defaults) return null;
      array.push({ prop: choice, x, z, ...(y === 0 ? {} : { y }), ...defaults });
      break;
    }
    case "controlPoints": {
      const id = nextFlagId(layout);
      if (!id) return null;
      array.push({
        id,
        name: `Point ${id}`,
        pos: new Vector3(x, world, z),
        radius: 12,
      });
      break;
    }
    case "spawns": {
      // A new spawn belongs to the nearest flag by default: home spawns are
      // decided by the map's shape, flag spawns by where you dropped it.
      const near = nearestFlag(layout, x, z);
      array.push({
        team: near ? null : 0,
        ...(near ? { controlPoint: near } : {}),
        pos: new Vector3(x, world, z),
        yaw: 0,
      });
      break;
    }
    case "water":
      // No `y`: a fresh pool is ankle-deep over whatever bed it lands on.
      array.push({ x, z, width: 12, depth: 12 });
      break;
    case "grass":
      array.push({ x, z, width: 14, depth: 14, ...(y === 0 ? {} : { y }) });
      break;
  }
  return { list, index: array.length - 1 };
}

// --- path roads --------------------------------------------------------------
//
// A `road` with `params.path` is laid along a centreline stated in the
// placement's OWN frame (`BuildParams.path`, `world/roadPaths.ts`), so moving
// or turning the placement carries the whole road and everything below works
// in that frame: a point is read out into the world for a handle, and written
// back in through the inverse of MapBuilder's `rotateY`. Every write here is a
// geometry change — the network re-resolves its junctions off the whole
// placement list — so the caller owes the full rebuild, as for any param.

/** The add menu's entry for a path road, beside the builder kinds. */
export const ROAD_PATH_CHOICE = "road (path)";

/** How long a freshly added path road's one leg is, in metres. */
const PATH_START_LENGTH = 30;

/** A path point, in the placement's own frame. */
type PathPoint = [number, number];

/** The placement behind a ref when it is a road laid along a path, else null. */
export function pathRoadOf(layout: MapLayout, ref: SelectionRef | null): EntryRecord | null {
  if (ref?.list !== "placements") return null;
  const entry = entryFor(layout, ref);
  return entry && pointsOf(entry) ? entry : null;
}

/** A path road's points, or null when the entry is not one. */
function pointsOf(entry: EntryRecord): readonly PathPoint[] | null {
  if (entry.kind !== "road") return null;
  const path = (entry.params as EntryRecord | undefined)?.path;
  return Array.isArray(path) && path.length >= 2 ? (path as PathPoint[]) : null;
}

/** The placement's frame, as MapBuilder's `rotateY` turns it. */
function frameOf(entry: EntryRecord): { x: number; z: number; c: number; s: number } {
  const rot = Number(entry.rotY ?? 0);
  return { x: Number(entry.x), z: Number(entry.z), c: Math.cos(rot), s: Math.sin(rot) };
}

/**
 * A path road's points in the WORLD, in order — what the handles are drawn at.
 * Empty when the entry is not a path road.
 */
export function pathWorldPoints(entry: EntryRecord): PathPoint[] {
  const pts = pointsOf(entry);
  if (!pts) return [];
  const f = frameOf(entry);
  return pts.map(([lx, lz]) => [f.x + lx * f.c + lz * f.s, f.z - lx * f.s + lz * f.c]);
}

/** A world point into the placement's frame: the inverse of `pathWorldPoints`. */
function toLocal(entry: EntryRecord, x: number, z: number): PathPoint {
  const f = frameOf(entry);
  const dx = x - f.x;
  const dz = z - f.z;
  return [q(dx * f.c - dz * f.s), q(dx * f.s + dz * f.c)];
}

/** Replaces the path with a new array rather than writing into the old one. */
function writePath(entry: EntryRecord, pts: PathPoint[]): void {
  (entry.params as EntryRecord).path = pts;
}

/** Moves one point to a world position. */
export function movePathPoint(entry: EntryRecord, index: number, x: number, z: number): void {
  const pts = pointsOf(entry);
  if (!pts || index < 0 || index >= pts.length) return;
  const next = pts.map((p) => [p[0], p[1]] as PathPoint);
  next[index] = toLocal(entry, x, z);
  writePath(entry, next);
}

/**
 * Inserts a point at a world position so that it BECOMES `index` — 0 puts a
 * new start on the road, the point count puts a new end on it.
 */
export function insertPathPoint(entry: EntryRecord, index: number, x: number, z: number): void {
  const pts = pointsOf(entry);
  if (!pts || index < 0 || index > pts.length) return;
  const next = pts.map((p) => [p[0], p[1]] as PathPoint);
  next.splice(index, 0, toLocal(entry, x, z));
  writePath(entry, next);
}

/**
 * Removes one point. Refused at two: a path of one point is ignored by the
 * network outright (`pathRoads`), so the road would vanish from the map while
 * its placement stayed in the file — deleting the road is the honest way to
 * ask for that.
 */
export function deletePathPoint(entry: EntryRecord, index: number): boolean {
  const pts = pointsOf(entry);
  if (!pts || pts.length <= 2 || index < 0 || index >= pts.length) return false;
  writePath(entry, pts.filter((_, i) => i !== index).map((p) => [p[0], p[1]] as PathPoint));
  return true;
}

/**
 * Stands the placement at the middle of its path's extent again, moving every
 * point the other way so the road does not move at all.
 *
 * The placement's origin is where the whole-road gizmo sits and what a click
 * on the road reselects around, so a road extended a hundred metres to one side
 * would otherwise be dragged from a handle in a field. It is the same anchor
 * `generate-cinderhaven.mjs` emits a path road with.
 *
 * `y` is left alone, and on purpose: a path road is draped over the floor in
 * WORLD height and its builder subtracts the origin's height back out
 * (`terrainRibbon`'s `originY`), so the origin's height moves nothing that is
 * drawn. Carrying the absolute height across to the new origin, as a gizmo drag
 * does for a building, wrote a `y` onto a road that never had one.
 */
export function recentrePath(entry: EntryRecord): void {
  const pts = pointsOf(entry);
  if (!pts) return;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const cx = q((Math.min(...xs) + Math.max(...xs)) / 2);
  const cz = q((Math.min(...zs) + Math.max(...zs)) / 2);
  if (cx === 0 && cz === 0) return;
  const f = frameOf(entry);
  entry.x = q(f.x + cx * f.c + cz * f.s);
  entry.z = q(f.z - cx * f.s + cz * f.c);
  writePath(entry, pts.map(([lx, lz]) => [q(lx - cx), q(lz - cz)]));
}

/** Which shape a road placement has, for the inspector's choice. */
export function roadShapeOf(entry: EntryRecord): "rect" | "path" {
  return pointsOf(entry) ? "path" : "rect";
}

/**
 * A road's shape: a `width` x `length` RECTANGLE, or a PATH. The two describe
 * the same carriageway either way round, so the conversion keeps the road where
 * it was rather than resetting it.
 *
 * - rect to path: its length becomes one leg along local Z, the axis
 *   `roadRects` lays a rectangle's length on, so nothing moves.
 * - path to rect: the rectangle runs from the path's first point to its last —
 *   the chord, which is all a rectangle can say — and the placement stands at
 *   the chord's middle, turned to face along it.
 *
 * `radius` means nothing to a rectangle and goes with the path.
 */
function setRoadShape(entry: EntryRecord, shape: string): void {
  if (entry.kind !== "road" || shape === roadShapeOf(entry)) return;
  const params = (entry.params as EntryRecord | undefined) ?? {};
  const lengthDef = roadParamDef("length");

  if (shape === "path") {
    const len = typeof params.length === "number" ? params.length : lengthDef;
    delete params.length;
    params.path = [[0, q(-len / 2)], [0, q(len / 2)]];
    entry.params = params;
    return;
  }

  const pts = pointsOf(entry);
  if (!pts) return;
  const [ax, az] = pts[0];
  const [bx, bz] = pts[pts.length - 1];
  const f = frameOf(entry);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  entry.x = q(f.x + mx * f.c + mz * f.s);
  entry.z = q(f.z - mx * f.s + mz * f.c);
  // A local heading h is a world heading of rotY + h (`rotateY` on (sin h, cos h)).
  let rot = Number(entry.rotY ?? 0) + Math.atan2(bx - ax, bz - az);
  rot = Math.atan2(Math.sin(rot), Math.cos(rot));
  const rotY = qAngle(rot);
  if (rotY === 0) delete entry.rotY;
  else entry.rotY = rotY;
  delete params.path;
  delete params.radius;
  const len = q(Math.max(Math.hypot(bx - ax, bz - az), 1));
  if (len === lengthDef) delete params.length;
  else params.length = len;
  if (Object.keys(params).length) entry.params = params;
  else delete entry.params;
}

/** The road builder's own default for one of its numeric params. */
function roadParamDef(key: string): number {
  const spec = PARAMS.road.find((s) => s.key === key);
  return spec?.type === "number" ? spec.def : 0;
}

/** The first unused single-letter flag id, or null when all 26 are taken. */
function nextFlagId(layout: MapLayout): string | null {
  const used = new Set(layout.controlPoints.map((cp) => cp.id));
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(65 + i);
    if (!used.has(id)) return id;
  }
  return null;
}

function nearestFlag(layout: MapLayout, x: number, z: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const cp of layout.controlPoints) {
    const d = (cp.pos.x - x) ** 2 + (cp.pos.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = cp.id;
    }
  }
  return best;
}

/**
 * Removes an entry. Every ref pointing past it in the same list now names the
 * wrong entry, so the caller must drop its selection and rebuild rather than
 * trying to fix them up.
 */
export function deleteItem(layout: MapLayout, ref: SelectionRef): boolean {
  const array = arrayFor(layout, ref.list);
  if (!array || ref.index < 0 || ref.index >= array.length) return false;
  array.splice(ref.index, 1);
  return true;
}

/**
 * Brings the scene's geometry back in line with the layout for one item.
 * Cheap enough for every frame of a drag.
 */
export function repositionScene(
  map: GameMap,
  layout: MapLayout,
  ref: SelectionRef,
  at: Vector3,
  rotY: number,
): void {
  const index = map.editor;
  if (!index) return;
  if (ref.list !== "placements" && ref.list !== "scatter") return;
  const item = index[ref.list][ref.index];
  if (!item) return;
  // Scatter props were baked into their merged field at their sampled offsets,
  // so a region moves as a unit — and turns as one too, which is exactly what
  // MapBuilder would rebuild for a rectangle at this angle. A disc has no
  // angle, hence `rotationOf` rather than the raw handle value.
  const turn = ref.list === "scatter" ? rotationOf(layout, ref) : rotY;
  repositionItem(item, map.colliderBoxes, at, turn);
}

/**
 * Rebuilds navigation from the current collider boxes. ~45 ms — call it when a
 * drag ends, never inside one.
 *
 * Returns a fresh NavGrid and ObstacleField; the caller swaps them into the
 * map so anything holding the old pair keeps working until it does.
 */
export function rebuildNavigation(
  map: GameMap,
  layout: MapLayout,
): { nav: NavGrid; obstacles: ObstacleField } {
  // The map's own terrain field, not a fresh one off the layout: a terrain
  // edit is a "geometry" tier change and rebuilds the whole map anyway, so the
  // field here is always the one the current geometry was built from.
  // The stack depth comes off the grid being replaced rather than off the
  // layout, for the same reason the terrain does: it is what the geometry in
  // hand was built with, and a rebuild that quietly narrowed it would drop the
  // upper floors of everything the editor has not touched.
  const nav = new NavGrid(
    map.size,
    map.colliderBoxes,
    map.terrain,
    map.nav.maxSurfaces,
  );
  for (const cp of layout.controlPoints) {
    nav.buildField(cp.id, cp.pos, cp.radius * 0.6);
  }
  for (const team of [0, 1] as const) {
    const home = layout.spawns.find((s) => s.team === team);
    if (home) nav.buildField(`home${team}`, home.pos, 6);
  }
  return { nav, obstacles: new ObstacleField(map.size, map.colliderBoxes) };
}
