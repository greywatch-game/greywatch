/**
 * editor/navOverlay.ts — Draws what the nav grid actually thinks, over the map
 * it thinks it about.
 * Owns: the overlay meshes and their instance buffers.
 *
 * Three colours, and the middle one is the reason this exists:
 *
 * - **green** — walkable: the flood fill reached it, bots can stand there.
 * - **red** — standable but never reached. Sealed courtyards and decks lifted
 *   just past the 0.6 m step height look identical to green ground in the
 *   viewport and are completely dead in play. This is the single most useful
 *   thing the editor draws.
 * - **amber** — reached, but with no route to the selected objective.
 *
 * Cost is kept to three draw calls by using **thin instances** of one quad —
 * the same technique GrassSystem uses for its tufts. A per-cell mesh would be
 * ~25,000 meshes and would make the editor unusable. It is rebuilt only when
 * navigation is rebuilt, never per frame.
 */
import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  type GlowLayer,
} from "@babylonjs/core";
import type { GameMap } from "../world/MapBuilder";
import { EDITOR } from "./tuning";
import { makeIslandTest } from "./validate";

/** Lift off the surface so the quad never z-fights the ground it describes. */
const LIFT = 0.08;

type Bucket = "walkable" | "island" | "unrouted";

export class NavOverlay {
  private meshes = new Map<Bucket, Mesh>();
  private materials: StandardMaterial[] = [];
  private visible = false;

  constructor(
    private scene: Scene,
    private glow: GlowLayer,
  ) {}

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(on: boolean): void {
    this.visible = on;
    for (const m of this.meshes.values()) m.setEnabled(on);
  }

  /**
   * Rebuilds every bucket from the grid's current state. `field` names a flow
   * field to check routing against; pass null to skip the amber pass.
   */
  build(map: GameMap, field: string | null): void {
    this.dispose();
    const snap = map.nav.debugSnapshot();
    const { dim, cellSize, origin, maxSurfaces, counts, walkable, blocked, heights } = snap;
    const dist = field ? map.nav.field(field)?.dist : undefined;
    // Rooftops are unreached on purpose — painting them red would bury the
    // handful of cells that are unreached by mistake.
    const isIsland = makeIslandTest(snap);

    const rows: Record<Bucket, number[]> = {
      walkable: [],
      island: [],
      unrouted: [],
    };

    for (let cell = 0; cell < dim * dim; cell++) {
      // NavGrid indexes as `cz * dim + cx`, so X is the remainder and Z the
      // quotient. Taking them the other way round transposes the whole overlay.
      const x = origin + ((cell % dim) + 0.5) * cellSize;
      const z = origin + (Math.floor(cell / dim) + 0.5) * cellSize;
      for (let si = 0; si < counts[cell] && si < maxSurfaces; si++) {
        const s = cell * maxSurfaces + si;
        const y = heights[s];
        // No `y < 0` test: -1 pads unused slots, but the loop already bounds on
        // `counts`, and sunken terrain makes negative heights ordinary.
        if (blocked[s]) continue;

        let bucket: Bucket;
        if (!walkable[s]) {
          if (!isIsland(s)) continue; // a roof; not drawn
          bucket = "island";
        } else if (dist && !Number.isFinite(dist[s])) {
          bucket = "unrouted";
        } else {
          bucket = "walkable";
        }

        rows[bucket].push(x, y + LIFT, z);
      }
    }

    const c = EDITOR.colors;
    this.make("walkable", rows.walkable, c.navWalkable, 0.16, cellSize);
    this.make("unrouted", rows.unrouted, c.navUnrouted, 0.4, cellSize);
    // Islands are the finding, so they are drawn hardest.
    this.make("island", rows.island, c.navIsland, 0.65, cellSize);
  }

  /** One quad, thin-instanced across every position in `xyz`. */
  private make(
    bucket: Bucket,
    xyz: number[],
    hex: string,
    alpha: number,
    cellSize: number,
  ): void {
    const count = xyz.length / 3;
    if (!count) return;

    const quad = MeshBuilder.CreateGround(
      `ed-nav-${bucket}`,
      { width: cellSize * 0.92, height: cellSize * 0.92 },
      this.scene,
    );

    const mat = new StandardMaterial(`ed-nav-mat-${bucket}`, this.scene);
    mat.emissiveColor = Color3.FromHexString(hex);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.alpha = alpha;
    mat.disableDepthWrite = true;
    quad.material = mat;
    this.materials.push(mat);

    const matrices = new Float32Array(count * 16);
    const m = Matrix.Identity();
    for (let i = 0; i < count; i++) {
      Matrix.TranslationToRef(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2], m);
      m.copyToArray(matrices, i * 16);
    }
    quad.thinInstanceSetBuffer("matrix", matrices, 16);

    // Editor furniture: no outline, no glow, no shadows, and excluded from the
    // GlowLayer by hand because Game's exclusion scan ran long ago.
    quad.isPickable = false;
    quad.metadata = { noOutline: true, noGlow: true, noShadowCaster: true };
    this.glow.addExcludedMesh(quad);
    quad.setEnabled(this.visible);
    this.meshes.set(bucket, quad);
  }

  /** Per-bucket counts, for the panel. */
  counts(): Record<Bucket, number> {
    const out: Record<Bucket, number> = { walkable: 0, island: 0, unrouted: 0 };
    for (const [k, mesh] of this.meshes) out[k] = mesh.thinInstanceCount;
    return out;
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.dispose();
    for (const m of this.materials) m.dispose();
    this.meshes.clear();
    this.materials = [];
  }
}
