/**
 * ObstacleField.ts — Sub-cell collision: collider boxes bucketed at load,
 * queried per bot step to push a body clear of thin obstacles (trees,
 * gravestones, drums) that fall between NavGrid cell centres.
 * Invariants: the push-out is a PREFERENCE, never a veto — callers (Bot) keep
 * the overlapping position if the pushed-clear one isn't walkable; frozen is
 * worse than clipping. HEADROOM and CONFIG.nav.stepHeight must stay in sync
 * with NavGrid, and are the DEFAULT band rather than the only one — a hull
 * passes its own (`Vehicle.freeFromWalls`). The oversize boxes a map's rim is made
 * of are kept out of the buckets and walked by `resolve` alone; do not delete
 * that list to tidy the constructor, and do not let `groundAt` or `wallAt` see
 * it — see `oversize` and `resolve` for both halves of why. Height tests use box planes and the box frame is entered
 * through `rotateToLocalXZ` (boxGeometry.ts, shared with NavGrid) so ramps push
 * correctly and a rotated box is not pushed out of backwards.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import {
  clampToTopFace,
  halfDepth,
  type LocalXZ,
  rotateToLocalXZ,
  slabThickness,
  topFaceAtLocalZ,
  topFaceHeight,
} from "./boxGeometry";
import type { WorldBox } from "./MapBuilder";

/**
 * "Is there a body's width of space here?", answered against the collider boxes
 * themselves rather than the nav grid.
 *
 * ## Why the nav grid isn't enough
 *
 * `NavGrid` samples one column per 1.5 m cell *centre*. A collider narrower than
 * a cell can sit entirely between two centres and leave every cell around it
 * walkable — and most of Hollowmere's props are exactly that: a scattered dead
 * tree or gravestone gets a 1.1 m collider, a fire drum 1.2 m. Flow fields then
 * route bots straight through the trunk. Even for the buildings the grid only
 * knows about walls that happen to cross a cell centre, so a bot can stand with
 * half its body inside a cottage wall.
 *
 * That is not just a visual glitch. `CombatSystem.fire` caps every shot at the
 * first `solid` hit and only counts a target sphere *closer* than that, so a bot
 * embedded in a prop has the prop soaking up every round aimed at it — the
 * "bots are stuck in things and impossible to shoot" pair is one bug.
 *
 * ## How
 *
 * Box footprints are bucketed once at load. A query pulls the handful of boxes
 * over one spot and pushes the body back out to `CONFIG.nav.bodyRadius` of any
 * face that is too tall to step onto and too low to duck under. Height is
 * evaluated from the top-face *plane* at the contact point, the same way
 * `NavGrid` does it, so a ramp reads as a floor at its foot rather than a wall.
 *
 * The map changes in exactly one way and in one direction: a pane of glass
 * breaks and never mends (`BoxSpec.glass`). So the buckets are built once, read
 * from then on, and only ever have entries TAKEN OUT — by `remove`, which is
 * the one writer and is called a handful of times in a round. Nothing here may
 * grow at runtime, and nothing may be added back.
 */

/** Bucket edge in metres. Comfortably larger than any query radius. */
const BUCKET = 4;
/**
 * How much slack a box's stamped footprint carries, in metres.
 *
 * A query at or under this radius therefore hits everything it can overlap
 * from the ONE bucket it stands in, which is the arrangement every body-sized
 * caller wants. It is not a cap: `resolve` widens its own bucket walk by
 * whatever a larger radius asks for beyond this (a hull's is 2.2), so the
 * slack is a budget for the common case rather than a limit on the query.
 */
const MAX_RADIUS = 1.0;
/** Vertical clearance a body needs; matches `NavGrid`'s headroom. */
const HEADROOM = 1.7;

export class ObstacleField {
  private readonly dim: number;
  private readonly origin: number;
  /** Box indices per bucket, `null` where nothing overlaps. */
  private readonly buckets: (number[] | null)[];
  private readonly boxes: WorldBox[] = [];
  /**
   * The boxes too big to bucket, walked in full by `resolve` and by nothing
   * else. Today it is a map's four rim slabs and only those — see the
   * constructor for why they cannot go in the grid, and `resolve` for why the
   * push-out still has to know about them.
   */
  private readonly oversize: WorldBox[] = [];
  /**
   * Each oversize box's world footprint, flat: `cx, cz, halfX, halfZ` per box.
   *
   * Held because the list is walked without a bucket to have pre-rejected it,
   * and a 324 m slab must cost a query on the far side of the map ONE compare
   * rather than a transform. Conservative — the rotated extent of the whole
   * solid — for `eachCell`'s reason: a footprint used to reject with may be
   * too big and may never be too small.
   */
  private readonly oversizeBounds: number[] = [];
  /** Scratch for the box-frame transform; `push` runs it per bot per box per step. */
  private readonly localScratch: LocalXZ = { lx: 0, lz: 0 };

  constructor(size: number, boxes: WorldBox[]) {
    this.dim = Math.ceil(size / BUCKET) + 2;
    this.origin = -size / 2 - BUCKET;
    this.buckets = new Array(this.dim * this.dim).fill(null);

    for (const box of boxes) {
      // Same exclusions as the nav grid: the ground plane is the floor and the
      // ridge is pure boundary, which the grid's own extents already enforce.
      //
      // **They are KEPT rather than dropped, and the reason is the shape of
      // the stamp rather than a change of mind about the boundary.** A box is
      // bucketed by the circle of its own half-diagonal, so a 324 x 2 rim slab
      // would claim a 162 m radius of cells and cost every query on the map;
      // that is what this test is really about. But `resolve` is the one
      // reader that asks what it is INSIDE rather than what it is standing on,
      // and a rim slab is something a hull can be inside — measured as the
      // whole of the residual after `Vehicle.freeFromWalls` landed, 445 of 451
      // frames. So they go on a list this size can be walked linearly.
      if (box.w > 200 || box.d > 200) {
        this.oversize.push(box);
        const hw = box.w / 2;
        const hd = Math.max(box.d / 2, halfDepth(box));
        const c = Math.abs(Math.cos(box.rotY));
        const sn = Math.abs(Math.sin(box.rotY));
        this.oversizeBounds.push(box.cx, box.cz, hw * c + hd * sn, hw * sn + hd * c);
        continue;
      }
      const index = this.boxes.push(box) - 1;
      this.eachCell(box, (cell) => {
        (this.buckets[cell] ??= []).push(index);
      });
    }
  }

  /**
   * Takes a box out of every bucket it was stamped into. True when it was
   * there.
   *
   * **The box's slot in `this.boxes` is left behind**, holes and all, because
   * every bucket entry is an index into that array and compacting it would
   * silently renumber every box after the removed one. A retired slot costs one
   * `WorldBox` of memory and is never reached again — `resolve` walks buckets,
   * never `boxes`.
   *
   * Removal recomputes the same cell rectangle the constructor stamped with
   * rather than remembering it: one arithmetic expression in one place cannot
   * disagree with itself, and two copies of it can — by a cell, leaving an
   * entry stranded in a bucket that goes on pushing bodies out of glass that
   * is no longer there.
   */
  remove(box: WorldBox): boolean {
    const index = this.boxes.indexOf(box);
    if (index < 0) {
      // A pane of glass is never one of these, but the door is the door: a
      // box taken out of the world has to leave every list this holds.
      const big = this.oversize.indexOf(box);
      if (big < 0) return false;
      this.oversize.splice(big, 1);
      this.oversizeBounds.splice(big * 4, 4);
      return true;
    }
    this.eachCell(box, (cell) => {
      const bucket = this.buckets[cell];
      if (!bucket) return;
      const at = bucket.indexOf(index);
      if (at >= 0) bucket.splice(at, 1);
    });
    return true;
  }

  /** The cells a box is stamped into: the conservative footprint, plus slack. */
  private eachCell(box: WorldBox, fn: (cell: number) => void): void {
    // Conservative footprint: the rotated half-diagonal, plus the query slack.
    const reach =
      Math.hypot(box.w, box.d) / 2 +
      (box.h / 2) * Math.abs(Math.sin(box.rotX)) +
      MAX_RADIUS;
    const minX = this.clampCell(this.toCell(box.cx - reach));
    const maxX = this.clampCell(this.toCell(box.cx + reach));
    const minZ = this.clampCell(this.toCell(box.cz - reach));
    const maxZ = this.clampCell(this.toCell(box.cz + reach));
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) fn(cz * this.dim + cx);
    }
  }

  /**
   * Pushes a body standing at `(x, y, z)` out of anything it overlaps, writing
   * the corrected position into `out` (`y` is passed through untouched) and
   * returning true when it had to move at all.
   *
   * Boxes are resolved in sequence against the running position and the whole
   * set is swept twice, so an inside corner settles instead of ping-ponging
   * between its two walls.
   *
   * **The BAND is the caller's, and a caller that does not state one gets a
   * body's.** What counts as floor to step onto and what counts as headroom to
   * duck under are properties of the thing being pushed, not of the boxes —
   * `wallAt` and `groundAt` have taken theirs as arguments from the day a
   * vehicle asked them, and this is the same split arriving at the push-out.
   * A hull's two numbers are `drive.climbHeight` above its tracks and the top
   * of its own box; a body's are `CONFIG.nav.stepHeight` and `HEADROOM`, which
   * is what the defaults are.
   *
   * **The bucket walk widens with the RADIUS rather than assuming one bucket**,
   * because a hull's 2.2 m is over the `MAX_RADIUS` slack the footprints were
   * stamped with and the boxes it is inside would otherwise be in the bucket
   * next door. At or under that slack this is exactly the single-bucket read it
   * has always been, so nothing a bot asks costs a box more.
   *
   * **The rim is in the answer here and in no other query on this class**, and
   * that asymmetry is deliberate. `groundAt` and `wallAt` ask what a thing is
   * standing on and what is in front of it, and a map's boundary is neither —
   * the nav graph's extents settle it for a body and the leash settles it for
   * a hull. This one asks what a thing is INSIDE, and a boundary slab is
   * something a seven-metre vehicle can end up inside; leaving it out was the
   * whole of what `Vehicle.freeFromWalls` could not eject from. See `oversize`.
   */
  resolve(
    x: number,
    y: number,
    z: number,
    radius: number,
    out: Vector3,
    floor = y + CONFIG.nav.stepHeight,
    ceiling = y + HEADROOM,
  ): boolean {
    out.set(x, y, z);
    // How far past the query point a box's stamp may fall short. Zero for
    // every body-sized query, so those still read one bucket.
    const spill = Math.max(0, radius - MAX_RADIUS);
    const minX = this.clampCell(this.toCell(x - spill));
    const maxX = this.clampCell(this.toCell(x + spill));
    const minZ = this.clampCell(this.toCell(z - spill));
    const maxZ = this.clampCell(this.toCell(z + spill));

    let moved = false;
    for (let pass = 0; pass < 2; pass++) {
      let touched = false;
      for (let cz = minZ; cz <= maxZ; cz++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const bucket = this.buckets[cz * this.dim + cx];
          if (!bucket) continue;
          for (const index of bucket) {
            if (this.push(this.boxes[index], floor, ceiling, radius, out)) touched = true;
          }
        }
      }
      for (let i = 0; i < this.oversize.length; i++) {
        const b = i * 4;
        if (Math.abs(out.x - this.oversizeBounds[b]) > this.oversizeBounds[b + 2] + radius) continue;
        if (Math.abs(out.z - this.oversizeBounds[b + 1]) > this.oversizeBounds[b + 3] + radius) continue;
        if (this.push(this.oversize[i], floor, ceiling, radius, out)) touched = true;
      }
      if (!touched) break;
      moved = true;
    }
    return moved;
  }

  /**
   * The highest collider top face directly above `floor` and at or below
   * `ceiling` at `(x, z)`, or null when no box spans that band here.
   *
   * **TWO THINGS CALL THIS AND BOTH STAND ON IT.** `Vehicle.supportAt` asks it ten
   * times a frame, once per track contact, which is what lets a hull stand on a
   * PLANK rather than on a single point and therefore what lets a tank drive
   * over a parked car. `Player.probeGround` asks it once, and that call is the
   * whole reason this exists — see below.
   *
   * THIS IS THE GROUND PROBE'S ANSWER, and it exists to have retired a
   * whole-scene ray pick. `Player.probeGround` used to run `scene.pickWithRay`
   * with a `solid` predicate every frame: Babylon walked all ~1,800 meshes and
   * ray-tested all ~820 colliders to answer "what is under my feet", which
   * measured as the single largest piece of the game's own per-frame JS — five
   * times the next item, and scaling with how big the MAP is rather than with
   * what is on screen. The boxes were already bucketed here, and
   * `NavGrid.rasterize` was already computing exactly this at bake time from the
   * same primitive. Measured per probe on real hardware, against the ray at the
   * same 2,000 walkable positions: **350x to 634x**, and the exponent matters
   * more than the ratio — the ray was O(meshes in the scene) and this is
   * O(boxes in one 4 m bucket).
   *
   * The band is closed at both ends because a floor is not the only thing above
   * a foot: `ceiling` is how high a rise still reads as something to step (or
   * drive) up rather than as a wall, and `floor` is as far down as the caller
   * cares to look. A roof overhead is outside the band and correctly ignored.
   * **A caller owes the same ceiling to whatever decides what it is BLOCKED
   * by**, or it drives through the bottom of things it then refuses to stand
   * on; `CONFIG.vehicles.tank.drive.climbHeight` is the worked example.
   *
   * NOT the terrain. The heightfield has no box standing in for it — that is
   * the one documented exception to the visual/collider rule — so the caller
   * takes the higher of this and `TerrainField.surfaceAt`. And it is
   * `surfaceAt`, the floor as DRAWN, rather than `heightAt`, the smooth field
   * the floor is cut from: what the ray used to hit was a clone of the visual's
   * own vertices.
   *
   * ## What it was waiting on, and what closed it
   *
   * Over the nav graph's own walkable surfaces — the only honest domain, since
   * sweeping the map on a grid asks about positions a body cannot occupy and the
   * RAY is the one that lies there — this and `pickWithRay` agreed on 99.8% of
   * 51k standable positions, and one of the two classes that differed was a
   * blocker: along a fence line the analytic claimed a surface half a metre up
   * that the ray passed straight through. That was never this query. It was the
   * shared primitive: `topFaceAtLocalZ` extrapolated the top-face plane across
   * the whole SOLID footprint, which for a pitched box is wider than the face,
   * so a stair parapet claimed ground beside itself by up to a `slabThickness`.
   *
   * **`boxGeometry` now gates every height query on the TOP FACE's own
   * footprint** (`topFaceHalfDepth`/`topFaceCentreZ`), so this and the ray agree
   * by construction rather than by measurement, and `NavGrid` got the same fix
   * for free. What is left over is `WorldBox`-shaped and stated rather than
   * hidden: **the boxes are the STATIC world**, so a caller that can stand on
   * something that MOVES owes that thing its own query — `Player.probeGround`
   * takes a tank's deck from `VehicleSystem`, for the same reason a hull is in
   * no baked structure in the first place.
   *
   * **A HULL could live with the old behaviour and a body could not**, which is
   * why the vehicle was this query's first customer: a spurious surface half a
   * metre up is one of ten contacts under a seven-metre plank, and the rise it
   * asks for is rate-limited before it reaches the drawn tank. The same half
   * metre under a pair of feet is a player standing in the air.
   */
  /**
   * Is there something at `(x, z)` that a hull whose tracks are on the ground
   * CANNOT ride over — a wall rather than a step?
   *
   * `groundAt`'s mirror, and the pair are meant to be read together: that one
   * asks what a track contact would stand ON and answers with a height, this
   * one asks what is IN THE WAY and answers yes or no. A tank needs both,
   * because the two questions come apart exactly where a vehicle is
   * interesting — a kerb is ground and a shopfront is not, and the only thing
   * separating them is how far above the tracks the top face stands.
   *
   * The band is the caller's and both ends are load-bearing, exactly as
   * `groundAt`'s are. `floor` is the highest top face that is still a STEP —
   * the hull's own climb ceiling, and anything at or below it is something the
   * vehicle drives over rather than into. `ceiling` is the underside above
   * which a box is HEADROOM: a bridge deck or an arcade a hull passes beneath
   * is not in its way, and asking about the top face alone would read a
   * ten-metre tower and the archway through it as the same obstruction.
   *
   * Same three lines `resolve`'s push-out already tests a body against
   * (`CONFIG.nav.stepHeight` and `HEADROOM` there, a hull's own two numbers
   * here), and it costs the same one bucket walk. It is a STEERING answer and
   * never a collision one — `moveWithCollisions` is what actually stops a
   * hull, and this is what lets an AI driver turn before it gets there. It may
   * therefore be wrong in the safe direction (an overhang read as a wall costs
   * a detour) and must never be relied on to be wrong in the other.
   */
  wallAt(x: number, z: number, floor: number, ceiling: number): boolean {
    const cx = this.clampCell(this.toCell(x));
    const cz = this.clampCell(this.toCell(z));
    const bucket = this.buckets[cz * this.dim + cx];
    if (!bucket) return false;

    for (const index of bucket) {
      const box = this.boxes[index];
      const top = topFaceHeight(box, x, z);
      if (top === null) continue;
      // Low enough to ride onto, so it is a step rather than an obstruction.
      if (top <= floor) continue;
      // High enough to pass under: an arch, a deck, a footbridge.
      if (top - slabThickness(box) >= ceiling) continue;
      return true;
    }
    return false;
  }

  groundAt(x: number, z: number, ceiling: number, floor: number): number | null {
    const cx = this.clampCell(this.toCell(x));
    const cz = this.clampCell(this.toCell(z));
    const bucket = this.buckets[cz * this.dim + cx];
    if (!bucket) return null;

    let best: number | null = null;
    for (const index of bucket) {
      const box = this.boxes[index];
      const top = topFaceHeight(box, x, z);
      if (top === null) continue;
      if (top > ceiling || top < floor) continue;
      if (best === null || top > best) best = top;
    }
    return best;
  }

  /**
   * One box against one circle. Returns true when `out` was corrected.
   *
   * `floor` and `ceiling` are `wallAt`'s, term for term: a top face at or
   * below the floor is something to ride over, and an underside at or above
   * the ceiling is something to pass beneath. Neither is derived here, because
   * what they are depends on whether the thing being pushed has legs.
   */
  private push(
    box: WorldBox,
    floor: number,
    ceiling: number,
    radius: number,
    out: Vector3,
  ): boolean {
    // Into the box's frame through the shared transform rather than a private
    // copy of the yaw convention — that convention has already been got wrong
    // once, and a push resolved in a mirrored frame would shove a bot the wrong
    // way out of every rotated wall. Through `rotateToLocalXZ` rather than
    // `toLocalXZ` because this needs `lx`/`lz` even for a point outside the
    // footprint, which is exactly the case that helper answers with a bare null.
    const { lx, lz } = rotateToLocalXZ(box, out.x, out.z, this.localScratch);
    const hw = box.w / 2;
    const hd = halfDepth(box);

    const qx = clamp(lx, -hw, hw);
    const qz = clamp(lz, -hd, hd);

    // Height of the top face at the contact point, from the plane rather than
    // the bounding box — a ramp's peak must not be reported across its whole
    // footprint. `boxGeometry` owns that math; NavGrid reads the same plane and
    // the same clamp.
    //
    // Clamped through the TOP FACE and not through `hd`, which is why this is a
    // second clamp beside `qz` rather than a reuse of it. The two want different
    // footprints out of the same box: the push-out below is geometry and belongs
    // to the SOLID, while this is a height and belongs to the FACE, and past the
    // face's own edge the plane extrapolates by up to a `slabThickness`. Feeding
    // that to the step test would hold a body off a pitched box a third of a
    // metre beyond the end of it.
    const top = topFaceAtLocalZ(box, clampToTopFace(box, lz));
    if (top === null) return false;
    // Low enough to step onto, so it is floor rather than obstruction.
    if (top <= floor) return false;
    // High enough to walk under: a lintel, a hayloft, a bridge deck.
    if (top - slabThickness(box) >= ceiling) return false;

    let nx: number;
    let nz: number;
    if (lx > -hw && lx < hw && lz > -hd && lz < hd) {
      // Already inside. Leave by the nearest face, since any other exit would
      // drag the body through the whole box.
      const penX = hw - Math.abs(lx);
      const penZ = hd - Math.abs(lz);
      if (penX < penZ) {
        nx = (lx < 0 ? -1 : 1) * (hw + radius);
        nz = lz;
      } else {
        nx = lx;
        nz = (lz < 0 ? -1 : 1) * (hd + radius);
      }
    } else {
      const ox = lx - qx;
      const oz = lz - qz;
      const dist = Math.hypot(ox, oz);
      if (dist >= radius) return false;
      if (dist < 1e-6) {
        // Exactly on a face. Push straight out of the nearer one.
        if (hw - Math.abs(lx) < hd - Math.abs(lz)) {
          nx = (lx < 0 ? -1 : 1) * (hw + radius);
          nz = lz;
        } else {
          nx = lx;
          nz = (lz < 0 ? -1 : 1) * (hd + radius);
        }
      } else {
        nx = qx + (ox / dist) * radius;
        nz = qz + (oz / dist) * radius;
      }
    }

    // Back to world. `rotateToLocalXZ` owns the sign convention — these are its
    // world→local angles read back to be undone, not a second opinion about
    // which way the box faces. Computed HERE rather than beside the transform
    // because every refusal above leaves without them, and most calls refuse:
    // a box is usually steppable, duckable, or simply out of reach.
    const c = Math.cos(-box.rotY);
    const s = Math.sin(-box.rotY);
    out.x = box.cx + nx * c - nz * s;
    out.z = box.cz + nx * s + nz * c;
    return true;
  }

  private toCell(world: number): number {
    return Math.floor((world - this.origin) / BUCKET);
  }

  private clampCell(cell: number): number {
    return cell < 0 ? 0 : cell >= this.dim ? this.dim - 1 : cell;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
