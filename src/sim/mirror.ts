/**
 * src/sim/mirror.ts — The page-side READERS of the simulation core: what a
 * view on the offline page asks of the core's state, answered in the shapes
 * the netplay client already asks the wire in.
 * Owns: `FleetMirror` — the core's hulls read as the page's posed fleet reads
 * `NetVehicles` (where each hull is, whether it is on the field, alive, how
 * hurt, who sits where, where its cupola gun points).
 * Invariants: **a reader writes nothing it reads from** — every method here
 * is a read of the core's live objects at the moment it is asked, copied into
 * a held answer, and nothing on the far side is touched. Nothing here imports
 * `@babylonjs/core` (`scripts/check-babylon-free.mjs` walks this directory).
 * Never: decide. A mirror says where the simulation's hull IS; the page's
 * `VehicleSystem` poses its own copy of that hull to it (`updateRemote`), the
 * same door a netplay client's hulls are posed through.
 *
 * **Temporary in its SOURCE, not in its shape** (`BABYLON_EXIT.md` X2.5a):
 * at C4a it reads the core's hulls through `SimCore.live`; C5 points the same
 * answers at the core's `SimFrame` instead and `live` goes. What the page asks
 * does not change between the two, which is the reason the shape is the
 * wire's.
 */
import type { GunAngles, Vehicle } from "../entities/Vehicle";
import { DRIVER, GUNNER } from "../entities/hullSeats";
import type { RemoteHull } from "../systems/VehicleSystem";

/**
 * The core's fleet, read by hardstanding index as `NetVehicles` answers the
 * snapshot's. `stateFor` and `mgFor` hand back ONE held object per index,
 * rewritten on each ask, so the page's per-frame posing allocates nothing.
 */
export class FleetMirror {
  private readonly states: RemoteHull[] = [];
  private readonly guns: GunAngles[] = [];

  constructor(private readonly hulls: () => readonly Vehicle[]) {}

  /** Where hull `i` is, or null when it is not on the field. */
  stateFor(i: number): RemoteHull | null {
    const tank = this.hulls()[i];
    if (!tank || !tank.present) return null;
    const s = (this.states[i] ??= { x: 0, y: 0, z: 0, yaw: 0, turretYaw: 0, gunPitch: 0 });
    s.x = tank.position.x;
    s.y = tank.position.y;
    s.z = tank.position.z;
    s.yaw = tank.yaw;
    s.turretYaw = tank.turretYaw;
    s.gunPitch = tank.gunPitch;
    return s;
  }

  /** Where hull `i`'s cupola gun points, or null when it is not on the field. */
  mgFor(i: number): GunAngles | null {
    const tank = this.hulls()[i];
    if (!tank || !tank.present) return null;
    const g = (this.guns[i] ??= { yaw: 0, pitch: 0 });
    g.yaw = tank.mgYaw;
    g.pitch = tank.mgPitch;
    return g;
  }

  present(i: number): boolean {
    return this.hulls()[i]?.present ?? false;
  }

  alive(i: number): boolean {
    return this.hulls()[i]?.alive ?? false;
  }

  health(i: number): number {
    return this.hulls()[i]?.health ?? 0;
  }

  /**
   * Whether the driver's chair is held: 0 when it is, -1 when it is not. The
   * wire's `occupant` is a SLOT; nothing that reads this mirror asks which —
   * the page's own `seatHeldBy` asks the core's crew table offline.
   */
  occupant(i: number): number {
    return this.hulls()[i]?.seats[DRIVER] ? 0 : -1;
  }

  /** `occupant`'s twin for the gunner's chair. */
  gunner(i: number): number {
    return this.hulls()[i]?.seats[GUNNER] ? 0 : -1;
  }
}
