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
 * **And the PLAYER pays the same walk once a frame on every map**, armour or
 * not, which turned out to be worth as much again: walking a real round it is
 * **2.21 ms a frame on Sarab, 0.62 on Coldharbour and 0.52 on Hollowmere**.
 * The two callers are `Vehicle.update` and `Player.update`, they are the only
 * two sweeps in the game, and both go through `narrowedMove` below.
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
 * moves no geometry and draws nothing. The player's own sweep goes **2.21 ms a
 * frame to 0.036** on the same map, and its median frame 14.6 ms to 11.3.
 *
 * **The walk is charged PER RETRY, which is why a static measurement of it
 * under-reports by an order of magnitude.** `_collideWithWorld` recurses up to
 * `collisionRetryCount` times and re-walks every time, so the cost peaks
 * exactly when a body is pressed against geometry — which is when it matters
 * and is not what a body standing in the open measures. Timed in isolation at
 * a spawn the player's walk reads 106-377 us; timed in a round with the player
 * actually moving through a town it is 388-2,209.
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
 * ## …and the third thing, which had been wrong on the AUTHORITY all along
 *
 * Both of those read `getAbsolutePosition()`, and that is whatever
 * `computeWorldMatrix` last wrote. On a CLIENT the render walk writes it once a
 * frame, so nothing ever had to say so. **The authority never renders**, so
 * nothing wrote it at all: every hull on the server swept from the origin its
 * box was built at. Measured on Sarab over a headless round before
 * `narrowedMove` forced the matrix — a tank asking for 11 m/s made 1, every
 * hull was ejected sideways at a constant 3.1 m/s out of the pile of colliders
 * standing at 0,0 whatever its route said, and a bot crew took two minutes to
 * cross ground it covers in twenty seconds. It cost nothing to fix and nothing
 * to keep: one 4x4 compose per sweep per frame, and there are two sweeps.
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
import type { AbstractMesh, Vector3 } from "@babylonjs/core";

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

/**
 * Slack on the locality query, metres. See `narrowedMove`.
 *
 * The radius and the step are the whole of what a sweep can reach, so this is
 * pure margin against float error and against a bounding box being
 * fractionally larger than the geometry it wraps. It is a metre because a metre
 * costs nothing — one or two more meshes in a list of ten — and because the
 * failure it guards is a body passing THROUGH a wall on one frame in a
 * thousand, which is exactly the kind of bug nobody would ever attribute to
 * this line.
 */
const SWEEP_MARGIN = 1;

/**
 * `mesh.moveWithCollisions(step)`, against `field` instead of against the whole
 * scene — and the two are the same move, which is the only claim this function
 * makes and the only one worth checking.
 *
 * **Both callers go through here rather than each writing the three rules
 * out.** `Vehicle.update` for a hull and `Player.update` for a body on foot are
 * the only two sweeps left in the game, they need the identical reach, the
 * identical ordering and the identical guard, and a second copy of that
 * reasoning is a second place for it to drift. `field` may be null, which is
 * the whole-scene walk exactly as it always was: SLOW rather than wrong, which
 * is the right way round for a field only `installMap` is supposed to set.
 *
 * **The reach is the sphere's own radius plus the WHOLE step plus a margin**,
 * never the radius alone, and it is centred on `getAbsolutePosition()` plus
 * `ellipsoidOffset` because that is the expression `moveWithCollisions` itself
 * opens with. Centring on `mesh.position` instead makes the guarantee
 * conditional on the two agreeing, and they can come apart — the getter
 * early-outs when the world matrix was already computed under this render id.
 *
 * **And the promise is CHECKED rather than trusted, which is what makes this
 * lossless by construction instead of by argument.** A sphere that began INSIDE
 * a box is ejected rather than swept, and an ejection is not bounded by the
 * displacement asked for: Babylon pushes out along the slide plane and carries
 * on from wherever that put it, which is a place the list was never asked
 * about. The bound is exact — a sphere of radius `r` that travels `T` can only
 * touch geometry within `r + T` of where it started, and the list covers
 * `r + asked + SWEEP_MARGIN` — so the list was sufficient exactly when
 * `T <= asked + SWEEP_MARGIN`, and when it was not, the move is thrown away and
 * re-run from the same start against the whole scene. That is the old code
 * path, so it is the old answer.
 *
 * This is not a rare theoretical case for a body on foot: a hull respawning on
 * its hardstanding arrives around whoever is standing there, and
 * `VehicleSystem` deliberately leaves that to be resolved by the shove on their
 * next frame.
 */
export function narrowedMove(
  mesh: AbstractMesh,
  step: Vector3,
  field: CollisionField | null,
  scratch: AbstractMesh[],
): void {
  if (!field) {
    // **Cleared, not merely skipped.** `surroundingMeshes` is state ON THE
    // MESH and Babylon keeps walking whatever was last written there, so a
    // body that stops being given a field would go on sweeping against a
    // frozen list of the street it was standing in when it last had one —
    // which is the "through a wall" failure this whole file is arranged to
    // prevent, arriving by the one route that has nothing to do with the
    // reach. It cost an afternoon as a measurement bug first: an A/B that
    // nulled the field to time the old path timed the NEW one twice and
    // reported the narrowing as worth nothing.
    mesh.surroundingMeshes = null;
    mesh.moveWithCollisions(step);
    return;
  }
  const asked = step.length();
  const e = mesh.ellipsoid;
  const off = mesh.ellipsoidOffset;
  // **The mover's world matrix is brought up to date first, and this is a
  // correctness line rather than a tidy-up.** Both the locality query below and
  // `moveWithCollisions` itself start from `getAbsolutePosition()`, which is
  // whatever `computeWorldMatrix` last wrote — and on a CLIENT that is the
  // render walk, once a frame, so nothing ever had to say so. **The AUTHORITY
  // never renders**, so nothing computed it at all: every hull on the server
  // swept from wherever its box was when it was built, which is the origin.
  // Measured on Sarab before this line, over a headless round — a tank asking
  // for 11 m/s made 1, every hull was ejected sideways at a constant 3.1 m/s
  // out of the pile of colliders standing at 0,0, and a bot crew took two
  // minutes to cross ground it should cover in twenty seconds. It costs a
  // client nothing: it is one 4x4 compose per sweep per frame, and there are
  // two sweeps in the game.
  //
  // **FORCED, and the unforced form is the version that looks right and does
  // nothing.** `computeWorldMatrix()` returns the cached matrix unless the node
  // reports itself out of sync, and a node whose matrix has never been computed
  // has nothing to compare against — so on the authority, where that is every
  // node, the cheap call returned the identity it was already holding and the
  // measurement below was unchanged by it.
  mesh.computeWorldMatrix(true);
  const at = mesh.getAbsolutePosition();
  const p = mesh.position;
  const fromX = p.x;
  const fromY = p.y;
  const fromZ = p.z;
  mesh.surroundingMeshes = field.near(
    at.x + off.x,
    at.z + off.z,
    Math.max(e.x, e.z) + asked + SWEEP_MARGIN,
    mesh,
    scratch,
  );
  mesh.moveWithCollisions(step);
  const dx = p.x - fromX;
  const dy = p.y - fromY;
  const dz = p.z - fromZ;
  const budget = asked + SWEEP_MARGIN;
  if (dx * dx + dy * dy + dz * dz > budget * budget) {
    p.set(fromX, fromY, fromZ);
    mesh.surroundingMeshes = null;
    mesh.moveWithCollisions(step);
  }
}
