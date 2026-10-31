/**
 * VehicleViews.ts — what the fleet LOOKS like: one `VehicleView` per hull, in
 * hardstanding order, each built with its kind's model. Only the client builds
 * it; the authority runs `VehicleSystem` alone and draws no hull.
 * Owns: the view list, and which hull each one is the picture of
 * (`Vehicle.picture`, set here and cleared here).
 * Reads `VehicleSystem`'s hulls and NEVER writes their state — a view decides
 * where a joint stands and what it is painted, and the hull is told nothing
 * back. `Game` builds both and wires them: `build` from `installMap` right
 * after `VehicleSystem.build`, `update` right after every `VehicleSystem.update`,
 * `dispose` from `teardownMap` — anything `installMap` hands a map to owes
 * `teardownMap` a line, and this is that line for the fleet's drawing. What
 * the views look like is drawn by our renderer off `views`, once a frame
 * immediately before the render (`Game.drawHulls`, `BABYLON_EXIT.md` X4.2b):
 * Babylon has no node and no mesh of a hull.
 * Invariants:
 * - **One view per hull, by INDEX**: `hulls[i]` was built for
 *   `spawns[i]` (`VehicleSystem.build` walks `vehicleSpawns` in order), so the
 *   model is looked up by that hardstanding's kind (`vehicleModels.modelOf`) —
 *   a lookup keyed by the kind, never a branch on it.
 * - `views` is the fleet's PICTURE and nothing reads it as a hull: the two
 *   shadow maps are handed the hulls themselves (`ShadowHull`, their collider
 *   boxes off their own fields, `BABYLON_EXIT.md` X4.1c).
 */
import type { Vehicle } from "../entities/Vehicle";
import { modelOf } from "../entities/vehicleModels";
import { VehicleView } from "../entities/VehicleView";
import type { VehicleSpawnDef } from "../world/MapBuilder";

export class VehicleViews {
  private readonly list: VehicleView[] = [];

  /** Every hull's picture, in hardstanding order — the order `Game.drawHulls` draws them in. Empty with no armour. */
  get views(): readonly VehicleView[] {
    return this.list;
  }

  /**
   * Draws a freshly built fleet. `hulls` is `VehicleSystem.hulls` and `spawns`
   * the map's `vehicleSpawns` it was built from, index for index.
   */
  build(hulls: readonly Vehicle[], spawns: readonly VehicleSpawnDef[]): void {
    this.dispose();
    for (let i = 0; i < hulls.length; i++) {
      const hull = hulls[i];
      const view = new VehicleView(hull, modelOf(spawns[i].kind));
      hull.picture = view;
      this.list.push(view);
    }
  }

  /** Every view off its hull's state. See `VehicleView.update`. */
  update(): void {
    for (const view of this.list) view.update();
  }

  /**
   * Takes every hull's drawing out of the world, and the hulls' pictures with
   * it. Nothing of a view is freed: its drawing is its kit's (X4.2b).
   */
  dispose(): void {
    for (const view of this.list) {
      if (view.hull.picture === view) view.hull.picture = null;
    }
    this.list.length = 0;
  }
}
