/**
 * editor/pathHandles.ts — The handles for editing a path road's POINTS, drawn
 * while one is selected.
 * Owns: the point, insert and extend handles, the two lines between them, and
 * their materials. Writes no layout — every click and drag they answer is
 * applied by `mutate.ts` (`movePathPoint`, `insertPathPoint`, ...).
 *
 * A path road is authored as the points its centreline passes THROUGH, and
 * the road on screen is not that polyline: every corner is an arc
 * (`bendPath`), and where it meets another road the network cuts it. So two
 * lines are drawn, and they are different on purpose:
 *
 * - the CONTROL line, point to point — what the handles are on;
 * - the CURVE, the same `bendPath` the builder runs, in the world frame the
 *   network runs it in — which is what makes a point drag readable before the
 *   map is rebuilt. The road's own geometry is only re-derived when the drag is
 *   released (the network re-resolves every junction off the whole placement
 *   list, so there is no moving it in place), and a line that already bends
 *   the way the road will is the preview.
 *
 * Three kinds of handle, all tagged `metadata.pathHandle` so `pickPathHandle`
 * can find them ahead of the road they sit on:
 *
 * - a POINT at every point — click to put the gizmo on it;
 * - an INSERT at the middle of every leg — click to split the leg there;
 * - an EXTEND past each end — click to lengthen the road by a new end point.
 *
 * Same invariants as `proxies.ts`, for the same reasons: never `solid`, never
 * `checkCollisions`, never a WorldBox; noGlow + noShadowCaster and the glow
 * layer's exclusion by hand. Handles are resized every frame against the
 * camera (`update`), so they stay clickable at any distance.
 */
import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  VertexData,
  type GlowLayer,
  type Scene,
} from "@babylonjs/core";
import { bendPath } from "../world/roadPaths";
import { ROAD_WIDTH } from "../world/roads";
import type { TerrainField } from "../world/TerrainField";
import { pathWorldPoints, type EntryRecord } from "./mutate";
import type { SelectionRef } from "./selection";
import { EDITOR } from "./tuning";

/**
 * What a handle does when clicked. An insert carries the world point it stands
 * at, so the click writes exactly where the handle was drawn.
 */
export type PathHandle =
  | { op: "point"; index: number }
  | { op: "insert"; index: number; x: number; z: number };

/** Longest stretch of a drawn line between two floor samples, in metres. */
const LINE_STEP = 4;

interface Handle {
  mesh: Mesh;
  /** The floor under it; the sphere sits on this at whatever size it is. */
  ground: number;
  /** Relative size: 1 for a point, `insertScale` for an insert. */
  size: number;
}

export class PathHandles {
  private handles: Handle[] = [];
  private lines: Mesh[] = [];
  private readonly mats: {
    point: StandardMaterial;
    selected: StandardMaterial;
    insert: StandardMaterial;
    control: StandardMaterial;
    curve: StandardMaterial;
  };

  constructor(
    private scene: Scene,
    private glow: GlowLayer,
  ) {
    const c = EDITOR.colors;
    this.mats = {
      point: this.material("point", c.pathPoint, 0.95),
      selected: this.material("selected", c.pathPointSelected, 0.95),
      insert: this.material("insert", c.pathInsert, 0.9),
      control: this.material("control", c.pathControl, 0.35),
      curve: this.material("curve", c.pathCurve, 0.9),
    };
  }

  /**
   * Draws the handles for one path road, or clears them. Cheap enough to call
   * on every frame of a drag: a road carries tens of points, and the materials
   * are built once.
   */
  show(
    entry: EntryRecord | null,
    ref: SelectionRef | null,
    terrain: TerrainField,
    selected: number | null,
  ): void {
    this.clear();
    if (!entry || !ref) return;
    const pts = pathWorldPoints(entry);
    if (pts.length < 2) return;
    const params = entry.params as EntryRecord;
    const width = typeof params.width === "number" ? params.width : ROAD_WIDTH;
    const radius = typeof params.radius === "number" ? params.radius : undefined;

    this.lines.push(this.line(pts, terrain, this.mats.control));
    this.lines.push(this.line(bendPath(pts, width, radius), terrain, this.mats.curve));

    pts.forEach(([x, z], i) => {
      const mat = i === selected ? this.mats.selected : this.mats.point;
      this.handle(x, z, 1, mat, ref, { op: "point", index: i }, terrain);
    });
    for (let i = 1; i < pts.length; i++) {
      const x = (pts[i - 1][0] + pts[i][0]) / 2;
      const z = (pts[i - 1][1] + pts[i][1]) / 2;
      this.insert(x, z, i, ref, terrain);
    }
    // Past each end, along the leg it finishes: 0 puts a new start on the road
    // and the point count a new end.
    const reach = width * EDITOR.path.extendWidths;
    const ends: [number, number, number][] = [
      [0, 1, 0],
      [pts.length - 1, pts.length - 2, pts.length],
    ];
    for (const [end, prev, index] of ends) {
      const dx = pts[end][0] - pts[prev][0];
      const dz = pts[end][1] - pts[prev][1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      this.insert(pts[end][0] + (dx / len) * reach, pts[end][1] + (dz / len) * reach, index, ref, terrain);
    }
  }

  /** Sizes every handle to the camera's distance from it. */
  update(eye: Vector3): void {
    const { radiusPerMetre, minRadius } = EDITOR.path;
    for (const h of this.handles) {
      const p = h.mesh.position;
      const d = Math.hypot(p.x - eye.x, h.ground - eye.y, p.z - eye.z);
      const r = Math.max(minRadius, d * radiusPerMetre) * h.size;
      h.mesh.scaling.setAll(r);
      p.y = h.ground + r;
    }
  }

  private insert(x: number, z: number, index: number, ref: SelectionRef, terrain: TerrainField): void {
    this.handle(x, z, EDITOR.path.insertScale, this.mats.insert, ref, { op: "insert", index, x, z }, terrain);
  }

  private handle(
    x: number,
    z: number,
    size: number,
    mat: StandardMaterial,
    ref: SelectionRef,
    op: PathHandle,
    terrain: TerrainField,
  ): void {
    // A unit sphere, scaled by `update` to its radius.
    const mesh = MeshBuilder.CreateSphere("ed-path-handle", { diameter: 2, segments: 8 }, this.scene);
    const ground = terrain.heightAt(x, z);
    mesh.position.set(x, ground, z);
    mesh.material = mat;
    mesh.isPickable = true;
    this.adopt(mesh, { editorRef: ref, pathHandle: op });
    this.handles.push({ mesh, ground, size });
  }

  /**
   * A flat ribbon along a polyline, draped over the floor. Long legs are cut
   * into `LINE_STEP` stretches so a line over a hill follows it rather than
   * tunnelling through; one mesh however many points.
   */
  private line(pts: readonly (readonly [number, number])[], terrain: TerrainField, mat: StandardMaterial): Mesh {
    const { lineWidth, lineLift } = EDITOR.path;
    const hw = lineWidth / 2;
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const nx = (-(bz - az) / len) * hw;
      const nz = ((bx - ax) / len) * hw;
      const steps = Math.max(1, Math.ceil(len / LINE_STEP));
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps;
        const t1 = (k + 1) / steps;
        const x0 = ax + (bx - ax) * t0;
        const z0 = az + (bz - az) * t0;
        const x1 = ax + (bx - ax) * t1;
        const z1 = az + (bz - az) * t1;
        const y0 = terrain.heightAt(x0, z0) + lineLift;
        const y1 = terrain.heightAt(x1, z1) + lineLift;
        const base = positions.length / 3;
        positions.push(
          x0 + nx, y0, z0 + nz,
          x0 - nx, y0, z0 - nz,
          x1 + nx, y1, z1 + nz,
          x1 - nx, y1, z1 - nz,
        );
        normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    const mesh = new Mesh("ed-path-line", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.applyToMesh(mesh);
    mesh.material = mat;
    // Drawn for reading, never for clicking: a click on the line is a click on
    // the road under it, which selects the road.
    mesh.isPickable = false;
    this.adopt(mesh, {});
    return mesh;
  }

  private adopt(mesh: Mesh, tags: Record<string, unknown>): void {
    mesh.checkCollisions = false;
    mesh.metadata = { ...tags, noGlow: true, noShadowCaster: true };
    this.glow.addExcludedMesh(mesh);
  }

  private material(name: string, hex: string, alpha: number): StandardMaterial {
    const m = new StandardMaterial(`ed-path-${name}`, this.scene);
    m.emissiveColor = Color3.FromHexString(hex);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.alpha = alpha;
    m.backFaceCulling = false;
    // Annotation, like every proxy: it must never hide what it annotates.
    m.disableDepthWrite = true;
    return m;
  }

  private clear(): void {
    for (const h of this.handles) h.mesh.dispose();
    for (const m of this.lines) m.dispose();
    this.handles = [];
    this.lines = [];
  }

  dispose(): void {
    this.clear();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
