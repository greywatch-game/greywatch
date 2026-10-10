/**
 * GlassFx.ts — The PICTURE of a pane going in: the glazing's vertex range
 * collapsed out of its merged mesh, and the collider MESH told it is no longer
 * a wall.
 * Owns: the pane → collider-mesh index for the standing map (built off the
 * `metadata.pane` stamp `MapBuilder.paneGroup` writes), and the two writes a
 * break makes on Babylon objects — `collapse` and `clear`.
 * Invariants: it READS `GameMap` and is told by `GlassSystem`'s `onBroken`
 * and `onCleared`, and it never writes the simulation — whether a pane is
 * broken, whether its box is out of the queries and the nav graph, and the
 * whole netplay question of who decided it are `GlassSystem`'s. A pane is
 * collapsed at most once and cleared at most once per map, because the
 * simulation raises each event once per pane. The authority never builds one
 * (`BABYLON_EXIT.md` X2.2): it draws no glazing (`paneGroups` is empty there)
 * and nothing on it reads a collider mesh. Contract: `docs/world.md` "Panes".
 *
 * Split out of `GlassSystem` at X2.2 C4, on `CombatFx`'s line: `Game` builds
 * both, wires the two events, and hands both the same map in `installMap`.
 *
 * ## Why the collapse is the whole of the visual
 *
 * A breakable pane's positions are a known range in its block's merged
 * glazing (`WorldPane.vertexStart`/`vertexCount` into `paneGroups[group]`).
 * Collapsing that range onto its own first vertex makes every triangle in it
 * degenerate, which rasterises nothing — and a pane carries no outline and
 * casts no shadow, so there is no second registration to revoke. One
 * `updateVerticesData` on one small buffer; only the blocks that hold a
 * breakable pane keep an updatable position buffer at all.
 *
 * ## Why the collider mesh is written at all
 *
 * Nothing that moves or shoots reads it: the rays stopped at
 * `ENGINE_UPGRADE.md` wall 2 and the sweeps at `BABYLON_EXIT.md` X2.1, and both
 * read the BOX, which `GlassSystem` takes out. `metadata.solid` is still read
 * by `world/solid.ts`, which is the editor's centre-screen pick — the
 * editor's side of CLAUDE.md's "one write on each side", `RayWorld.remove`
 * being the queries' — and `checkCollisions` and disabling keep the mesh
 * describing itself as what it now is.
 */
import { VertexBuffer, type Mesh } from "@babylonjs/core";
import type { GameMap, PaneGroup, WorldPane } from "../world/mapTypes";

export class GlassFx {
  private panes: readonly WorldPane[] = [];
  private groups: readonly PaneGroup[] = [];
  /**
   * A pane's collider mesh, by pane index, off the `metadata.pane` stamp
   * `MapBuilder.paneGroup` writes on the client's colliders.
   */
  private readonly colliders = new Map<number, Mesh>();

  /**
   * Takes a freshly built map, beside `GlassSystem.setMap` in `installMap` —
   * the editor's rebuilds included, so nothing here holds a disposed mesh.
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
   * a client's own predicted break leaves the editor's pick seeing the pane
   * for the round trip the box itself is left standing, and the two agree.
   */
  clear(pane: number): void {
    const mesh = this.colliders.get(pane);
    if (!mesh) return;
    mesh.metadata.solid = false;
    mesh.checkCollisions = false;
    mesh.setEnabled(false);
  }
}
