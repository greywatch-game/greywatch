/**
 * CollisionField.ts — A uniform grid over the collidable MESHES, so that
 * `moveWithCollisions` walks a street rather than a map.
 * Owns: the bucket grid, the list of collidable meshes that MOVE, and the
 * "which meshes could this sweep touch" lookup.
 * Owns no geometry: every mesh in here was built by `MapBuilder` or by
 * `buildServerWorld`, and this never creates, disposes, hides or flags one.
 *
 * ## Why this exists
 *
 * `RayWorld` took every PICK off the scene (`ENGINE_UPGRADE.md` wall 2), and
 * one whole-scene walk was left behind: `moveWithCollisions` MOVES a body
 * rather than answering a question about one, so no analytic query replaces it.
 * Babylon's `DefaultCollisionCoordinator._collideWithWorld` walks
 * `scene.meshes` — every mesh on the map, `isEnabled()` up the parent chain and
 * a bounding-box test each, up to `maximumRetry` times per call — which prices
 * a hull on how big the map is rather than on what is near it.
 *
 * **Measured on Sarab, six hulls, four of them driven by bot crews: the fleet
 * cost 2.30 ms a frame and 2.21 ms of it was that one call** — 553 us a call
 * against 2,894 collidable meshes, and 96% of everything the vehicles did. The
 * ground probe, the springs, the lean, the whips, the crew AI, the crush sweep
 * and the engine audio came to 0.09 ms between them.
 *
 * ## The substitution, and why it is Babylon's own and not a trick
 *
 * That same line reads `(excludedMesh && excludedMesh.surroundingMeshes) ||
 * scene.meshes`, so a body carrying a list is a supported narrowing of the
 * walk rather than a patch over it: nothing about the collision response
 * changes, and the answer is IDENTICAL as long as the list is a **superset** of
 * what the sweep could reach. That is the whole contract of this file, and it
 * is the one thing a change here can get dangerously wrong — a list that misses
 * a mesh is a hull driving through a wall, silently, on one frame in a
 * thousand.
 *
 * With the list in: **11 us a call including the lookup, ~10 meshes against
 * 2,894, and the fleet 2.30 ms a frame to 0.12** — Sarab's median frame 11.3 ms
 * to 8.7 (87 to 113 fps), which is a quarter of the frame for a change that
 * moves no geometry and draws nothing.
 *
 * ## It is IDENTICAL and not merely close, and that was measured the hard way
 *
 * `sweeporacle` (scratchpad, throwaway) runs both walks from the same state at
 * 8,000 points per hull kind on each map with armour and diffs the landing
 * position: **exactly zero difference on the tank, the truck and the
 * helicopter's 10.4 m disc, with 760 to 2,484 of those samples genuinely
 * blocked by something.** Two things had to be got right for that, and neither
 * was obvious:
 *
 * - **The order is the scene's**, restored by the sort in `near` — see it.
 * - **The centre is what `moveWithCollisions` itself opens with**, which is
 *   `getAbsolutePosition()` and not `position`. See `Vehicle.update`.
 *
 * A scripted DRIVE proved none of this and looked like it did: every hull on
 * all three maps completed 1,800 steps without being blocked once, because a
 * hardstanding is in a yard and armour spends its first half-minute crossing
 * open ground. A run in which nothing collided is a run that tested nothing.
 *
 * ## Two rules a caller owes
 *
 * - **Ask with a reach that covers the whole sweep**, which is the collision
 *   sphere's own radius plus the displacement being asked for plus a margin —
 *   never the radius alone — and then CHECK it, because a sphere that began
 *   inside a box is ejected rather than swept. `Vehicle.update` has the check
 *   and the argument for why it is exact.
 * - **Anything collidable that MOVES goes in `movers` and never in the grid.**
 *   The grid is stamped once from meshes that are frozen where they stand; a
 *   hull is not, so it is appended to every answer instead. There are a handful
 *   of them and the map has thousands of the other kind, which is why the two
 *   are stored differently rather than symmetrically.
 *
 * A mesh whose `checkCollisions` goes false inside a round — a pane `GlassSystem`
 * has broken — needs no removal: it stays in the grid and Babylon's own loop
 * skips it, exactly as it skipped it in `scene.meshes`.
 *
 * **The grid is stamped once and is never updated, which is a claim about the
 * WORLD and not an optimisation**: a collider is built where it stands and
 * frozen there. The one dev-only exception is the editor's tier-1 gizmo drag,
 * which moves a placement's collider meshes in place — this index goes stale
 * exactly as `RayWorld` already does, and `docs/editor.md` says so in the one
 * place both belong.
 */
import type { AbstractMesh } from "@babylonjs/core";

/**
 * Bucket edge, metres.
 *
 * Sized against what is being LOOKED UP rather than against the map, exactly as
 * `boxIndex`'s 4 m is and for the same reason — and deliberately not
 * `MapLayout.blockSize`, which is draw calls and cull granularity. A big map
 * wants more buckets here, not fewer. The largest reach anything asks with is a
 * helicopter's 10.4 m rotor disc plus its 1.6 m step, so 24 m is two cells
 * across a query in the worst case and one in the common one; measured on
 * Sarab it answers with ~10 meshes for a tank and ~12 for the disc.
 */
const CELL = 24;

/** Cell key. The grid is sparse, so a map's extent is nobody's business here. */
const keyOf = (ix: number, iz: number): number => (ix + 0x8000) * 0x10000 + (iz + 0x8000);

export class CollisionField {
  /**
   * Collidable meshes that MOVE, appended to every answer.
   *
   * Public and pushed into from outside, exactly as `RayWorld.hulls` is and by
   * the same caller: `VehicleSystem.build` is the one place that knows there is
   * a fleet, and nothing in the world layer may learn what a vehicle is.
   */
  readonly movers: AbstractMesh[] = [];

  private readonly meshes: AbstractMesh[] = [];
  private readonly cells = new Map<number, number[]>();
  /** Per-mesh visit marks, so a query dedupes without allocating. */
  private readonly seen: Int32Array;
  private stamp = 0;
  /** A query's hits as INDICES, so they can be put back in order. See `near`. */
  private readonly picked: number[] = [];

  /**
   * Stamps every collidable mesh in `all` into the cells its bounding box
   * covers. Anything not `checkCollisions` is skipped — `moveWithCollisions`
   * would skip it too, so carrying it would only make the answers longer.
   */
  constructor(all: readonly AbstractMesh[]) {
    for (const mesh of all) {
      if (!mesh.checkCollisions) continue;
      const i = this.meshes.length;
      this.meshes.push(mesh);
      const bb = mesh.getBoundingInfo().boundingBox;
      const x0 = Math.floor(bb.minimumWorld.x / CELL);
      const x1 = Math.floor(bb.maximumWorld.x / CELL);
      const z0 = Math.floor(bb.minimumWorld.z / CELL);
      const z1 = Math.floor(bb.maximumWorld.z / CELL);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = keyOf(ix, iz);
          const cell = this.cells.get(k);
          if (cell) cell.push(i);
          else this.cells.set(k, [i]);
        }
      }
    }
    this.seen = new Int32Array(this.meshes.length);
  }

  /** How many meshes the grid holds. For the DEV warning and for tests. */
  get size(): number {
    return this.meshes.length;
  }

  /**
   * Everything a sphere at `(cx, cz)` could touch while sweeping `reach`
   * metres, written into `out` and handed back so a caller can assign it
   * straight onto `mesh.surroundingMeshes` without allocating.
   *
   * `self` is the mesh doing the sweeping and is the one thing left out —
   * Babylon skips `excludedMesh` itself anyway, but a hull that found its own
   * box in the list would be paying for a test whose answer is known.
   *
   * **The centre is the collision SPHERE's and not the mesh's position**, which
   * on a vehicle are 1.4 m apart: `ellipsoidOffset` rides the sphere toward the
   * leading end, and asking from the origin would leave the far half of the
   * sweep unlisted at exactly the moment the hull is driving into something.
   */
  near(
    cx: number,
    cz: number,
    reach: number,
    self: AbstractMesh,
    out: AbstractMesh[],
  ): AbstractMesh[] {
    out.length = 0;
    const stamp = ++this.stamp;
    const x0 = Math.floor((cx - reach) / CELL);
    const x1 = Math.floor((cx + reach) / CELL);
    const z0 = Math.floor((cz - reach) / CELL);
    const z1 = Math.floor((cz + reach) / CELL);
    const picked = this.picked;
    picked.length = 0;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.cells.get(keyOf(ix, iz));
        if (!cell) continue;
        for (const i of cell) {
          if (this.seen[i] === stamp) continue;
          this.seen[i] = stamp;
          if (this.meshes[i] !== self) picked.push(i);
        }
      }
    }
    // **Sorted, and that is a correctness line rather than tidiness.** Babylon
    // keeps the FIRST mesh it finds at a given distance — `_testTriangle`
    // rejects on `>=`, not `>` — so two coplanar box faces, which a world made
    // of boxes is full of, are a tie broken by walk ORDER. `scene.meshes` walks
    // creation order; a grid walks cell order, and the two disagree, which
    // showed up as the hull settling a few centimetres differently against a
    // wall. Restoring the index order restores creation order, because the grid
    // was stamped from `map.colliders` in the order the scene received them.
    // Measured: sub-decimetre before, exactly zero after.
    picked.sort((a, b) => a - b);
    for (const i of picked) out.push(this.meshes[i]);
    // The movers go on the END for the same reason: a hull is built after the
    // map it stands on, so that is where `scene.meshes` has it.
    for (const mover of this.movers) if (mover !== self) out.push(mover);
    return out;
  }
}
