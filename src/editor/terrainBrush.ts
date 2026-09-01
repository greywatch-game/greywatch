/**
 * editor/terrainBrush.ts — Terrain mode: the hover highlight and the drag that
 * raises or lowers the ground.
 * Owns: the brush state, its overlay mesh, and the heightfield writes a stroke
 * makes. Owns nothing else — the rebuild that brings colliders, navigation and
 * everything standing on the ground back into agreement is the session's call,
 * because it disposes the map the session is holding.
 *
 * Why a mode rather than another selectable entity: the ground is *under*
 * everything, so a terrain proxy is a flat sheet competing for the same click
 * as the water rect, the grass rect and the jetty sitting on it. Whichever
 * annotation happens to be on top wins and the rest become unselectable. A mode
 * settles it by construction — in terrain mode only the ground answers, and in
 * object mode terrain is not in the pick at all.
 *
 * A stroke is ABSOLUTE, not incremental: the affected vertices' heights are
 * snapshotted when the drag starts and every mouse move re-derives them from
 * that snapshot. Accumulating deltas per frame would make the result depend on
 * frame rate and on how fast the mouse was moving.
 *
 * There are two tools, and they differ only in what the stroke re-derives from:
 *
 * - `sculpt` stamps its footprint once and reads a vertical pointer drag, so
 *   the ground rises and falls under a brush that stays put.
 * - `level` samples the height under the first click and then paints, stamping
 *   the footprint wherever the cursor goes and pulling those vertices to that
 *   one height. Free-hand sculpting cannot produce a flat basin floor or a pad
 *   that meets the ground around it — every pass lands somewhere slightly
 *   different, and "slightly different" is exactly what the nav grid's slope
 *   limit and a building's footings care about.
 *
 * Absoluteness is what makes painting settle: a vertex remembers the height it
 * had when the stroke FIRST touched it and the STRONGEST falloff weight any
 * pass has given it, so dragging back and forth over the same ground converges
 * instead of creeping toward the target one pass at a time.
 */
import {
  Color3,
  Mesh,
  StandardMaterial,
  VertexData,
  type GlowLayer,
  type Scene,
} from "@babylonjs/core";
import { clamp } from "../core/math";
import type { Heightfield } from "../world/layout";
import type { GameMap } from "../world/MapBuilder";
import { MAX_WALKABLE_GRADE, terrainPatches } from "../world/TerrainField";
import { EDITOR } from "./tuning";

/** Lift the highlight clear of the ground it traces. */
const LIFT = 0.05;

/** How far a vertical mouse drag moves the ground, in metres per pixel. */
const SENSITIVITY = 0.02;

/** Hard stops, so a wild drag cannot put the floor somewhere absurd. */
const MIN_Y = -12;
const MAX_Y = 24;

/**
 * Ceiling on the stamps one pointer move may fill in. A move that jumps most
 * of the map — the cursor re-entering the ground far from where it left, or a
 * window losing and regaining focus — is not a stroke anyone drew.
 */
const MAX_FILL_STEPS = 64;

/** Which stroke the left button draws. */
export type TerrainTool = "sculpt" | "level";

/** Grid vertex coordinates. */
interface Vertex {
  i: number;
  j: number;
}

interface Stroke {
  kind: TerrainTool;
  /** Vertex index -> its height when the stroke first touched it. */
  before: Map<number, number>;
  /** Vertex index -> the strongest falloff weight any pass has given it, 0..1. */
  weight: Map<number, number>;
  /** Blocks whose meshes this stroke has to keep re-applying. */
  blocks: Set<string>;
  /** sculpt: metres the pointer has dragged, positive up. */
  delta: number;
  startPointerY: number;
  /** level: the height sampled where the stroke began. */
  target: number;
  /**
   * level: the vertex the last stamp was centred on, so a fast drag can be
   * filled in rather than leaving a dotted line of untouched ground. Null when
   * the cursor has been off the grid since, which must not be interpolated
   * across.
   */
  last: Vertex | null;
}

export class TerrainBrush {
  /** Radius in cells. */
  private radius = 2;
  private overlay: Mesh | null = null;
  private readonly material: StandardMaterial;
  private stroke: Stroke | null = null;
  private tool: TerrainTool = "sculpt";
  /** Grid vertex the cursor is over, or null when it is off the ground. */
  private at: Vertex | null = null;

  constructor(
    private scene: Scene,
    private glow: GlowLayer,
    private map: GameMap,
  ) {
    const m = new StandardMaterial("ed-brush", scene);
    m.emissiveColor = Color3.FromHexString(EDITOR.colors.terrain);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.alpha = 0.3;
    m.disableDepthWrite = true;
    this.material = m;
  }

  /** Re-points the brush after a rebuild replaced the map. */
  setMap(map: GameMap): void {
    this.map = map;
    this.refreshOverlay();
  }

  get isDragging(): boolean {
    return this.stroke !== null;
  }

  get size(): number {
    return this.radius;
  }

  get activeTool(): TerrainTool {
    return this.tool;
  }

  /**
   * The height a level stroke is pulling ground to, or null when no level
   * stroke is running. The status line shows it, because once the drag starts
   * the sampled height is the only thing the tool is doing and there is
   * otherwise nothing on screen that says what it is.
   */
  get levelTarget(): number | null {
    return this.stroke?.kind === "level" ? this.stroke.target : null;
  }

  /**
   * Swaps tools. Mid-stroke is ignored — the pointer is already committed to
   * one kind of stroke and changing what it means halfway through is the same
   * class of bug the object/terrain mode split exists to prevent.
   *
   * The brush recolours, so which tool is armed is visible where the user is
   * actually looking rather than only in the panel.
   */
  setTool(tool: TerrainTool): void {
    if (this.stroke || tool === this.tool) return;
    this.tool = tool;
    this.material.emissiveColor = Color3.FromHexString(
      tool === "level" ? EDITOR.colors.terrainLevel : EDITOR.colors.terrain,
    );
  }

  /** `[` and `]`. One cell at a time — the grid is the unit that matters. */
  resize(by: number): void {
    this.radius = Math.max(0, Math.min(12, this.radius + by));
    this.refreshOverlay();
  }

  /**
   * Moves the hover highlight to whatever the pointer is over. A sculpt stroke
   * pins the brush where it began; a level stroke paints, so the brush has to
   * keep following the cursor.
   *
   * The pick is against the terrain's VISUAL blocks, not its `solid` collider
   * clones. The two carry the same vertices everywhere except mid-stroke, where
   * only the visuals are re-tessellated — and picking the stale collider there
   * would make the brush drift away from the ground the user can see as they
   * level it, by roughly the height change at a shallow view angle.
   */
  hover(x: number, y: number): void {
    if (this.stroke?.kind === "sculpt") return;
    this.at = this.pickVertex(x, y);
    this.refreshOverlay();
  }

  /** Begins a stroke at the current hover position. Returns false if off-grid. */
  begin(pointerY: number): boolean {
    const f = this.map.terrain.field;
    if (!f || !this.at) return false;

    const s: Stroke = {
      kind: this.tool,
      before: new Map(),
      weight: new Map(),
      blocks: new Set(),
      delta: 0,
      startPointerY: pointerY,
      target: f.heights[this.at.j * (f.size + 1) + this.at.i],
      last: this.at,
    };
    this.stamp(f, s, this.at);
    if (s.before.size === 0) return false;

    this.stroke = s;
    // A level stroke does its work on the way down: the click samples a height
    // AND levels the brush to it, so a single click flattens a patch and a bare
    // click is not the no-op it is under the sculpt tool. Sculpt has nothing to
    // apply yet — its drag has not moved.
    if (s.kind === "level") this.applyStroke(f, s);
    return true;
  }

  /**
   * Continues a stroke. Sculpt reads the vertical drag — up raises, down
   * lowers. Level reads where the cursor is and paints the sampled height in.
   */
  drag(x: number, y: number): void {
    const s = this.stroke;
    const f = this.map.terrain.field;
    if (!s || !f) return;
    if (s.kind === "sculpt") {
      s.delta = (s.startPointerY - y) * SENSITIVITY;
    } else {
      const from = s.last;
      // Not `hover`: the overlay is rebuilt once at the end of the stroke
      // update, when the heights it traces are the ones just written.
      const to = (this.at = this.pickVertex(x, y));
      if (!to) {
        // Off the grid: nothing to stamp, and the gap must not be bridged when
        // the cursor comes back somewhere else entirely.
        s.last = null;
        this.refreshOverlay();
        return;
      }
      // Pointer moves are sampled, not continuous, so a quick drag would stamp
      // a dotted line of brush prints. Walk the gap between this move and the
      // last in steps of half a brush, which leaves no cell unstamped.
      if (from) {
        const span = Math.hypot(to.i - from.i, to.j - from.j);
        const steps = Math.min(MAX_FILL_STEPS, Math.ceil(span / this.stampStep()));
        for (let k = 1; k < steps; k++) {
          const t = k / steps;
          this.stamp(f, s, {
            i: Math.round(from.i + (to.i - from.i) * t),
            j: Math.round(from.j + (to.j - from.j) * t),
          });
        }
      }
      this.stamp(f, s, to);
      s.last = to;
    }
    this.applyStroke(f, s);
  }

  /**
   * Abandons a stroke in progress and puts the ground back the way it was.
   * Cheap because the stroke already holds every height it touched.
   *
   * Leaving terrain mode mid-drag has to go through here: the pointer-up
   * handler is gated on being in terrain mode, so a stroke left running would
   * never be ended and the next hover would keep painting with it.
   */
  cancel(): void {
    const s = this.stroke;
    const f = this.map.terrain.field;
    this.stroke = null;
    if (!s || !f) return;
    for (const [idx, base] of s.before) f.heights[idx] = base;
    this.reapply(s.blocks);
    this.refreshOverlay();
  }

  /** Ends a stroke. True when the ground actually moved. */
  end(): boolean {
    const s = this.stroke;
    const f = this.map.terrain.field;
    this.stroke = null;
    if (!s || !f) return false;
    for (const [idx, base] of s.before) {
      if (f.heights[idx] !== base) return true;
    }
    return false;
  }

  /**
   * The steepest gradient anywhere under the brush, for the status line. The
   * nav graph will not link across anything past `MAX_WALKABLE_GRADE`, and the
   * whole point of a sculpting tool is that it is easy to cross that by
   * accident and impossible to see afterwards.
   */
  gradeUnderBrush(): number {
    const f = this.map.terrain.field;
    if (!f || !this.at) return 0;
    const row = f.size + 1;
    let worst = 0;
    for (const { i, j } of this.footprint(f)) {
      const h = f.heights[j * row + i];
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni > f.size || nj > f.size) continue;
        worst = Math.max(worst, Math.abs(f.heights[nj * row + ni] - h) / f.cell);
      }
    }
    return worst;
  }

  /** Height at the brush centre, for the status line. */
  heightUnderBrush(): number {
    const f = this.map.terrain.field;
    if (!f || !this.at) return 0;
    return f.heights[this.at.j * (f.size + 1) + this.at.i];
  }

  setVisible(on: boolean): void {
    if (!on) this.at = null;
    this.refreshOverlay();
  }

  dispose(): void {
    this.overlay?.dispose();
    this.overlay = null;
    this.material.dispose();
  }

  /**
   * The terrain vertex under the pointer, or null when the ray misses the
   * ground. Picking supplies a predicate, so Babylon skips the `isPickable`
   * test and the visual blocks answer even though nothing else may pick them.
   */
  private pickVertex(x: number, y: number): Vertex | null {
    const hit = this.scene.pick(x, y, isTerrainVisual);
    const p = hit?.hit ? hit.pickedPoint : null;
    return p ? this.map.terrain.nearestVertex(p.x, p.z) : null;
  }

  /** How far apart two stamps of the same brush may be, in cells. */
  private stampStep(): number {
    return Math.max(0.5, this.radius * 0.5);
  }

  /**
   * Records the brush's footprint at `centre` into the stroke: each vertex's
   * pre-stroke height the first time it is touched, and thereafter only the
   * strongest weight it has been given. Writes no heights — `applyStroke` does
   * that, from this snapshot, which is what keeps a stroke absolute.
   */
  private stamp(f: Heightfield, s: Stroke, centre: Vertex): void {
    const row = f.size + 1;
    // Full strength across the inner half, then linear to nothing at the rim.
    // A hard-edged brush would make a cliff on its first click, which the nav
    // graph then refuses to walk across; for the level tool the same falloff is
    // what blends a levelled pad into the ground around it.
    const inner = this.radius * 0.5;
    for (const { i, j, d } of this.footprint(f, centre)) {
      const w = this.radius === 0 ? 1 : falloff(d, inner, this.radius);
      if (w <= 0) continue;
      const idx = j * row + i;
      if (!s.before.has(idx)) {
        s.before.set(idx, f.heights[idx]);
        for (const key of blocksTouching(f, i, j, this.map.terrainBlock))
          s.blocks.add(key);
      }
      if (w > (s.weight.get(idx) ?? 0)) s.weight.set(idx, w);
    }
  }

  /** Re-derives every vertex the stroke has touched from its snapshot. */
  private applyStroke(f: Heightfield, s: Stroke): void {
    for (const [idx, base] of s.before) {
      const w = s.weight.get(idx) ?? 0;
      const h = s.kind === "level" ? base + (s.target - base) * w : base + s.delta * w;
      f.heights[idx] = clamp(round2(h), MIN_Y, MAX_Y);
    }
    this.reapply(s.blocks);
    this.refreshOverlay();
  }

  /** Grid vertices inside the brush, with their distance from its centre. */
  private *footprint(
    f: Heightfield,
    centre: Vertex | null = this.at,
  ): Generator<{ i: number; j: number; d: number }> {
    if (!centre) return;
    const r = this.radius;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const i = centre.i + di;
        const j = centre.j + dj;
        if (i < 0 || j < 0 || i > f.size || j > f.size) continue;
        const d = Math.hypot(di, dj);
        if (d > r + 1e-6) continue;
        yield { i, j, d };
      }
    }
  }

  /**
   * Re-tessellates the blocks a stroke is touching and hands the result to the
   * meshes already in the scene.
   *
   * Only the visuals: the collider clones and the nav grid stay stale until the
   * session runs its rebuild on release. That is the right split — a stroke has
   * to look immediate, and nothing walks on the ground mid-drag.
   *
   * On a map with a `borderland` the same is true one step further out and it
   * shows rather than merely being stale: `terrainPatches` also returns the
   * blocks past the authored grid (keyed `b<i>,<j>`), a stroke's `blocks` are
   * grid cells and so never name one, and their inner ring is built from the
   * edge heights this stroke is moving. So a stroke ON THE BOUNDARY opens a
   * crack along it until the rebuild on release closes it. Left alone
   * deliberately: re-tessellating a 192 m block per drag frame to hide a seam
   * nobody edits from is the wrong trade.
   */
  private reapply(blocks: Set<string>): void {
    // The map's own cut, never the constant: `terrainPatches` is being asked to
    // reproduce the SAME patches the build made, and a brush that assumed 48 on
    // a map that states otherwise would name meshes that do not exist and leave
    // the ones under the cursor stale. See `GameMap.terrainBlock`.
    const patches = terrainPatches(
      this.map.terrain,
      this.map.size,
      this.map.terrainBlock,
    );
    for (const patch of patches) {
      if (!blocks.has(patch.key)) continue;
      const mesh = this.scene.getMeshByName(`terrain-${patch.key}`);
      if (mesh) patch.data.applyToMesh(mesh as Mesh, true);
    }
  }

  /** Rebuilds the highlight over the cells the brush would move. */
  private refreshOverlay(): void {
    this.overlay?.dispose();
    this.overlay = null;
    const f = this.map.terrain.field;
    if (!f || !this.at) return;

    const row = f.size + 1;
    const positions: number[] = [];
    const indices: number[] = [];
    const inside = new Set<number>();
    for (const { i, j } of this.footprint(f)) inside.add(j * row + i);

    // One quad per cell all four of whose corners the brush covers, so the
    // highlight reads as whole grid squares rather than a ring of fragments.
    for (const idx of inside) {
      const i = idx % row;
      const j = (idx - i) / row;
      if (i >= f.size || j >= f.size) continue;
      const corners = [idx, idx + 1, idx + row + 1, idx + row];
      if (!corners.every((c) => inside.has(c))) continue;
      const base = positions.length / 3;
      for (const c of corners) {
        const ci = c % row;
        const cj = (c - ci) / row;
        const at = this.map.terrain.vertexAt(ci, cj);
        positions.push(at.x, f.heights[c] + LIFT, at.z);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (indices.length === 0) return;

    const mesh = new Mesh("ed-brush", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    data.normals = normals;
    data.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.metadata = { noGlow: true, noShadowCaster: true };
    this.glow.addExcludedMesh(mesh);
    this.overlay = mesh;
  }
}

/**
 * Which block meshes hold a given grid vertex. Edges belong to both.
 *
 * `terrainBlock` is the MAP's — the same arithmetic `terrainPatches` cut the
 * floor with, and the keys have to match it exactly or `reapply` re-tessellates
 * a mesh the stroke never touched.
 */
function blocksTouching(
  f: Heightfield,
  i: number,
  j: number,
  terrainBlock: number,
): string[] {
  const per = Math.round(terrainBlock / f.cell);
  const out = new Set<string>();
  for (const vi of [i - 1, i]) {
    for (const vj of [j - 1, j]) {
      if (vi < 0 || vj < 0 || vi >= f.size || vj >= f.size) continue;
      out.add(`${Math.floor(vi / per)},${Math.floor(vj / per)}`);
    }
  }
  return [...out];
}

/**
 * The floor's visual blocks. Their collider clones share the same vertices, so
 * either would do outside a stroke — but only these are re-tessellated during
 * one, so these are what the brush must follow.
 */
function isTerrainVisual(m: { name: string }): boolean {
  return m.name.startsWith("terrain-") && !m.name.endsWith("-col");
}

function falloff(d: number, inner: number, outer: number): number {
  if (d <= inner) return 1;
  if (d >= outer) return 0;
  return 1 - (d - inner) / (outer - inner);
}

/** Centimetre precision — finer than that is noise in a generated file. */
function round2(v: number): number {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

export { MAX_WALKABLE_GRADE };
