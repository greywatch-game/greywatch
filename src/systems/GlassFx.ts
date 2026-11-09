/**
 * GlassFx.ts — The PICTURE of a pane going in: the glazing's vertex range
 * collapsed out of its merged surface — our renderer's in a round
 * (`render/GlassDraw.ts`, `BABYLON_EXIT.md` X4.6e) — and the collider MESH
 * told it is no longer a wall.
 * Owns: the pane → collider-mesh index for the standing map (built off the
 * `metadata.pane` stamp `MapBuilder.paneGroup` writes), and the two writes a
 * break makes — `collapse` (into the glazing draw's buffer) and `clear` (onto
 * the collider mesh).
 * Invariants: it READS `GameMap` and is told by `GlassSystem`'s `onBroken`
 * and `onCleared`, and it never writes the simulation — whether a pane is
 * broken, whether its box is out of the queries and the nav graph, and the
 * whole netplay question of who decided it are `GlassSystem`'s. A pane is
 * collapsed at most once and cleared at most once per map, because the
 * simulation raises each event once per pane. The authority never builds
 * one: it draws no glazing (`paneGroups` is empty there)
 * and nothing on it reads a collider mesh. Contract: `docs/world.md` "Panes".
 *
 * Split out of `GlassSystem` on `CombatFx`'s line: `Game` builds
 * both, wires the two events, and hands both the same map in `installMap`.
 *
 * ## Why the collapse is the whole of the visual
 *
 * A breakable pane's positions are a known range in its block's merged
 * glazing (`WorldPane.vertexStart`/`vertexCount` into `paneGroups[group]`).
 * Collapsing that range onto its own first vertex makes every triangle in it
 * degenerate, which rasterises nothing — and a pane carries no outline and
 * casts no shadow, so there is no second registration to revoke. One write of
 * the range into one buffer (`GlassDraw.collapse`); only the blocks that hold a breakable pane keep a
 * writable copy of their positions at all.
 *
 * ## Why the collider mesh is written at all
 *
 * Nothing that moves or shoots reads it: the rays (`RayWorld`) and the
 * sweeps (`CollisionField`) both
 * read the BOX, which `GlassSystem` takes out. `metadata.solid` was read by
 * the map editor's centre-screen pick, which went with the editor
 * (`BABYLON_EXIT.md` X5.3c); the write stays, with `checkCollisions` and
 * disabling, so the mesh describes itself as what it now is until X5.3e
 * stops making collider meshes at all.
 */
import { VertexBuffer, type Mesh } from "@babylonjs/core";
import type { GlassDraw } from "../render/GlassDraw";
import type { GameMap, PaneGroup, WorldPane } from "../world/mapTypes";

export class GlassFx {
  constructor(
    /** A round's glazing, whose buffer a collapse writes into (`BABYLON_EXIT.md` X4.6e). */
    private readonly glass: Pick<GlassDraw, "surfaces" | "collapse">,
  ) {}

  private panes: readonly WorldPane[] = [];
  private groups: readonly PaneGroup[] = [];
  /**
   * A pane's collider mesh, by pane index, off the `metadata.pane` stamp
   * `MapBuilder.paneGroup` writes on the client's colliders.
   */
  private readonly colliders = new Map<number, Mesh>();

  /**
   * Takes a freshly built map, beside `GlassSystem.setMap` in `installMap`, so
   * nothing here holds a disposed mesh.
   */
  setMap(map: GameMap): void {
    this.panes = map.panes;
    this.groups = map.paneGroups;
    this.colliders.clear();
    for (const mesh of map.colliders) {
      const pane = mesh.metadata?.pane;
      if (typeof pane === "number") this.colliders.set(pane, mesh);
    }
  }

  /** No map at all: `Game.teardownMap`, for the menu. */
  clearMap(): void {
    this.panes = [];
    this.groups = [];
    this.colliders.clear();
  }

  /**
   * Collapses a pane's vertex range onto its own first vertex. Wired to
   * `GlassSystem.onBroken`, so a predicted break, a confirmed one and a
   * catch-up all land here exactly once.
   */
  collapse(pane: number): void {
    const p = this.panes[pane];
    if (!p || p.group < 0) return;
    const group = this.groups[p.group];
    if (!group) return;
    if (!group.mesh) {
      // A round's: the surface its record names.
      const surfaces = this.glass.surfaces;
      for (let i = 0; i < surfaces.length; i++) {
        if (surfaces[i].record === group.record) this.glass.collapse(surfaces[i], p.vertexStart, p.vertexCount);
      }
      return;
    }
    const positions = group.mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) return;
    const base = p.vertexStart * 3;
    const x = positions[base];
    const y = positions[base + 1];
    const z = positions[base + 2];
    for (let v = 1; v < p.vertexCount; v++) {
      const o = base + v * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
    }
    group.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
  }

  /**
   * The collider MESH's three writes, once its box has left the world. Wired
   * to `GlassSystem.onCleared`, which only an authoritative break raises — so
   * a client's own predicted break leaves the mesh describing the pane for
   * the round trip the box itself is left standing, and the two agree.
   */
  clear(pane: number): void {
    const mesh = this.colliders.get(pane);
    if (!mesh) return;
    mesh.metadata.solid = false;
    mesh.checkCollisions = false;
    mesh.setEnabled(false);
  }
}
