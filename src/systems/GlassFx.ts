/**
 * GlassFx.ts — The PICTURE of a pane going in: the glazing's vertex range
 * collapsed out of its merged surface — our renderer's (`render/GlassDraw.ts`,
 * `BABYLON_EXIT.md` X4.6e).
 * Owns: the one write a break makes to the picture — `collapse`, into the
 * glazing draw's buffer — and the standing map's panes and glazing groups it
 * reads to find the range.
 * Invariants: it READS `GameMap` and is told by `GlassSystem`'s `onBroken`,
 * and it never writes the simulation — whether a pane is broken, whether its
 * box is out of the queries and the nav graph, and the whole netplay question
 * of who decided it are `GlassSystem`'s. A pane is collapsed at most once per
 * map, because the simulation raises the event once per pane. The authority
 * never builds one: it draws no glazing (`paneGroups` is empty there).
 * Contract: `docs/world.md` "Panes".
 *
 * Split out of `GlassSystem` on `CombatFx`'s line: `Game` builds
 * both, wires the event, and hands both the same map in `installMap`.
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
 * ## Why there is no collider to write
 *
 * A pane's collider is its BOX, and breaking it is one write on the
 * simulation's side (`RayWorld.remove`, in `GlassSystem`), which takes it out
 * of every ray and every sweep. The collider MESH this file used to switch off
 * as well (`metadata.solid`, `checkCollisions`, disabled) was read by nothing
 * once the map editor's pick went (`BABYLON_EXIT.md` X5.3c), and is not made
 * since X5.3e.
 */
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
   * Takes a freshly built map, beside `GlassSystem.setMap` in `installMap`, so
   * nothing here holds the last map's panes.
   */
  setMap(map: GameMap): void {
    this.panes = map.panes;
    this.groups = map.paneGroups;
  }

  /** No map at all: `Game.teardownMap`, for the menu. */
  clearMap(): void {
    this.panes = [];
    this.groups = [];
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
    // The surface its record names.
    const surfaces = this.glass.surfaces;
    for (let i = 0; i < surfaces.length; i++) {
      if (surfaces[i].record === group.record) this.glass.collapse(surfaces[i], p.vertexStart, p.vertexCount);
    }
  }
}
