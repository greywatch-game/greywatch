/**
 * RayWorld.ts — The segment query that retired `scene.pickWithRay`.
 * Owns: a uniform grid over the collider boxes, the oriented-box and
 * heightfield intersections behind it, and the two questions every ray in the
 * game asks. Owns no meshes, no materials, and nothing a frame can move except
 * the hulls, which are handed in rather than held.
 *
 * WHY THIS EXISTS, and it is the same argument `ObstacleField.groundAt` won.
 * `scene.pickWithRay` filters `scene.meshes` by predicate, then bounds-tests,
 * then triangle-tests — so it is `O(colliders in the scene)` and prices every
 * ray on how big the MAP is rather than on how far the ray goes. `FINDINGS.md`
 * 22 measured that at **2,438 us a ray** on a 1500 m proving ground against 222
 * on Coldharbour: 11x the cost for 7.7x the colliders, and 30.7% of an 8.6 ms
 * frame with sixteen bots in contact. Tripling a ray's LENGTH made it very
 * slightly cheaper, which is the wall's signature — nothing about the cost was
 * bounded by the ray at all.
 *
 * `Player.probeGround` had already been through this and the shape here is its
 * shape: answer analytically off `colliderBoxes` and `TerrainField`, which are
 * the geometry the meshes were built from, and let the cost be bounded by what
 * the segment crosses. **Read `ObstacleField.groundAt`'s header before changing
 * anything here** — in particular the part about what the audit found, because
 * the 0.2% the analytic and the ray disagreed on was a real bug in the shared
 * primitive rather than a rounding difference.
 *
 * ## The two questions, and where the mesh predicates went
 *
 * `world/solid.ts` holds them and they are now the EDITOR's alone — its
 * centre-screen pick is a `scene.pick` over real meshes and stays one. The two
 * questions live on here as `castBody` and `castRound`, and the mapping is
 * exact:
 *
 * | collider | `SOLID_ONLY` / `castBody` | `OPAQUE_ONLY` / `castRound` |
 * | --- | --- | --- |
 * | ordinary — `wall`, `block` | yes | yes |
 * | `porous` — a fence's coarse run | yes | **no** |
 * | `rayOnly` — a fence's posts and rails | **no** | yes |
 * | `glass`, intact | yes | **no** |
 * | `glass`, broken | **no** | **no** |
 *
 * Both are one bit per box in `flags`, tested with an `&`. Breaking a pane is
 * `remove`, one write, exactly as clearing `metadata.solid` was — the whole of
 * "glass" on this side of the question is still a flag no query evaluates.
 *
 * ## The three things that are not boxes
 *
 * - **The floor**, which is the one documented exception to the visual/collider
 *   rule and has no box standing in for it. It is marched here at the
 *   heightfield's own resolution against the two triangles `Accum.quad` emits
 *   per cell, in the order it emits them, so what a round stops on is the floor
 *   as DRAWN and not the smooth field under it. It is also the one thing that
 *   answers `surface: "ground"`; everything else answers `"hard"` by omission,
 *   exactly as `metadata.surface` did.
 * - **The struts**, which emit no `WorldBox` because nothing derived from
 *   geometry can represent a 0.1 m rail. They are handed in as `rayGroups` and
 *   indexed here with the round bit and not the body one.
 * - **The hulls**, which MOVE. A tank is in neither the boxes nor the bake, for
 *   the ragdoll's reason, so `hulls` is a list its owner keeps and every cast
 *   walks. There are at most two, so they are tested before the grid rather
 *   than in it — which also gives the grid walk a `best` to prune against.
 *
 * ## What a caster owes
 *
 * `dir` must be NORMALISED and `length` is the whole reach of the query: a hit
 * past it is not a hit, which is `Ray.length`'s rule and the one every call
 * site was already written against. A `RayHit` is scratch a caller keeps and
 * this fills — read it before the next cast, never hold it.
 *
 * **A ray that starts INSIDE a box reports that box's FAR face**, with the
 * outward normal, because that is what Babylon's two-sided triangle picking did
 * and two call sites are written against it: the grenade flips a normal
 * pointing away from itself (a wall met from inside a doorway) and the blast
 * probe flips one pointing down. Do not "fix" it into a near-face hit.
 */
import { Vector3 } from "@babylonjs/core";
import type { WorldBox } from "./MapBuilder";
import type { TerrainField } from "./TerrainField";

/**
 * Bucket edge for the box grid, metres. Larger than `ObstacleField`'s and
 * `boxIndex`'s 4 m because those answer about a POINT and pay per box in one
 * cell, while this walks a line and pays per cell crossed as well: a tank gun's
 * 180 m ray is 23-45 cells here and twice that at 4 m, for the same handful of
 * boxes in each.
 */
const CELL = 8;

/** Above this in either footprint axis a box is boundary, not furniture. */
const MAP_SIZED = 200;

/** Stops a body: the ordinary world, plus the fences' coarse runs and glass. */
const BLOCKS_BODY = 1;
/** Stops a round or a look: the ordinary world, plus the struts. */
const BLOCKS_ROUND = 2;

/** Denominators below this are a ray parallel to the slab, not a division. */
const EPS = 1e-9;

/**
 * How much nearer the FLOOR has to be than a collider before it wins, metres.
 *
 * **This is a tie-break and not a tolerance, and the tie is common rather than
 * exotic**: a prop is planted with its foot on the ground, so the bottom face
 * of its box and the terrain under it are the same plane, and a ray that
 * reaches either reaches both at the same distance. Which one answers decides
 * nothing but the spark — `surface` — so the rule is to keep the one the ray
 * used to give: `scene.pickWithRay` walked `scene.meshes` in CREATION order and
 * replaced a hit only when the next was STRICTLY nearer, and every collider on
 * a map is made before the floor's clones are. The collider therefore won, and
 * it wins here.
 *
 * Sized off what a tie actually measures. Across 32,000 sampled rays on the
 * four shipped maps the coincident cases came in between 1e-15 and 3e-7 m
 * apart, so a tenth of a millimetre is three orders clear of the noise and four
 * orders under anything the game can tell apart.
 */
const COINCIDENT = 1e-4;

/**
 * What a cast found. Scratch, kept by the caller and refilled per cast — the
 * same contract `PickingInfo` had, minus the allocation.
 *
 * `surface` is `CombatSystem.ImpactKind`'s two world answers, stated rather
 * than looked up: it was `metadata.surface`, present on exactly one thing (the
 * floor's collider clone) and absent everywhere else.
 */
export interface RayHit {
  /** Metres along the ray. */
  distance: number;
  /** Where it landed. */
  point: Vector3;
  /** The OUTWARD normal of the face that stopped it — see the header. */
  normal: Vector3;
  surface: "ground" | "hard";
  /**
   * The moving hull the cast stopped ON, or null for the static world.
   *
   * **The one thing a cast can hit that is also a TARGET**, which is why it is
   * reported rather than merely stopping the ray. Everything else in here is
   * geometry a round dies against; a hull is a `Combatant` whose shape is this
   * box and not the sphere every body is tested as, and `CombatSystem.fire`
   * reads this to resolve a hit ON it instead of the sphere that used to lose
   * to its own collider — see that file's note on armour.
   */
  hull: RayHull | null;
}

/** A `RayHit` a caller can keep. Allocated once, never per cast. */
export function newRayHit(): RayHit {
  return {
    distance: 0,
    point: new Vector3(),
    normal: new Vector3(0, 1, 0),
    surface: "hard",
    hull: null,
  };
}

/**
 * Something SOLID that MOVES, and today that is a tank hull and nothing else.
 *
 * It answers with a box rather than being one because the body is what moves
 * and a cached copy is a second opinion about where the hull is — the same
 * reasoning as `Vehicle.deckBox`, which is the scratch this hands back. Null takes
 * it out of every query, which is what a wreck carried away is.
 */
export interface RayHull {
  rayBox(): WorldBox | null;
}

/** Module scratch: the normal of the last successful primitive test. */
let _nx = 0;
let _ny = 1;
let _nz = 0;

/** `blocked`'s direction, so a line-of-sight query allocates nothing. */
const ANY_DIR = new Vector3();

export class RayWorld {
  /**
   * The hulls, kept by whoever owns them (`VehicleSystem`) and walked by every
   * cast. Mutable on purpose and never rebuilt per frame — the list changes
   * when a fleet is built and at no other time.
   */
  readonly hulls: RayHull[] = [];

  /** Every indexed box, plain solid boxes and struts alike. */
  private readonly boxes: WorldBox[] = [];
  /** `BLOCKS_BODY` / `BLOCKS_ROUND` per box; 0 once `remove` has been through. */
  private readonly flags: Uint8Array;
  /**
   * The map-sized boxes — the rim, the ground plane's stand-in — which the grid
   * refuses for `boxIndex`'s reason: a 244 m box in an 8 m bucket is in every
   * cell on the map. There are only ever a handful, so every cast walks them.
   */
  private readonly big: number[] = [];

  /** CSR over the grid: `cellStart[c] .. cellStart[c + 1]` indexes `cellBox`. */
  private readonly cellStart: Int32Array;
  private readonly cellBox: Int32Array;
  private readonly dim: number;
  private readonly gridOrigin: number;

  /**
   * Which cast last tested each box. A box straddles cells and would otherwise
   * be re-tested once per cell the segment crosses it in; this is the standard
   * stamp, and an `Int32Array` rather than a `Set` because it is read once per
   * candidate on the hottest query in the game.
   */
  private readonly mark: Int32Array;
  private stamp = 0;

  /** The heightfield's own numbers, hoisted: every terrain step reads them. */
  private readonly half: number;
  private readonly cell: number;
  private readonly grid: number;
  private readonly heights: readonly number[] | null;
  private readonly lattice: number;

  constructor(
    /** The PLAY square's side — what a flat map's single floor quad spans. */
    private readonly size: number,
    boxes: readonly WorldBox[],
    rayGroups: readonly (readonly WorldBox[])[],
    private readonly terrain: TerrainField,
  ) {
    const f = terrain.field;
    this.grid = f ? f.size : 0;
    this.cell = f ? f.cell : 1;
    this.half = f ? (f.size * f.cell) / 2 : 0;
    this.heights = f ? f.heights : null;
    // The borderland is cut on the same lattice, extended, and `terrainPatches`
    // rounds the margin to whole cells exactly here. A march using a different
    // count would run off the end of the floor it is meant to find.
    this.lattice = f ? Math.round(terrain.margin / f.cell) : 0;

    // The grid spans the play square AND the borderland: a round fired at
    // somebody standing out there still has to stop on what is out there.
    const extent = size + 2 * terrain.margin;
    this.dim = Math.ceil(extent / CELL) + 2;
    this.gridOrigin = -extent / 2 - CELL;

    const cells = this.dim * this.dim;
    // Two passes so the boxes land in one flat array rather than in `dim * dim`
    // little ones: the grid over a 1500 m map is 36k cells, most of them empty,
    // and an array per cell is 36k allocations to say so.
    const counts = new Int32Array(cells + 1);
    const flags: number[] = [];
    const take = (box: WorldBox, flag: number): void => {
      const at = this.boxes.push(box) - 1;
      flags.push(flag);
      if (box.w > MAP_SIZED || box.d > MAP_SIZED) {
        this.big.push(at);
        return;
      }
      this.eachCell(box, (c) => counts[c + 1]++);
    };
    for (const box of boxes) {
      // Glass is `porous` and says so on the box, so an intact pane stops a
      // body and passes a round with no term of its own — `world/solid.ts`.
      take(box, box.porous ? BLOCKS_BODY : BLOCKS_BODY | BLOCKS_ROUND);
    }
    for (const group of rayGroups) for (const box of group) take(box, BLOCKS_ROUND);

    this.flags = Uint8Array.from(flags);
    this.mark = new Int32Array(this.boxes.length).fill(-1);
    for (let c = 0; c < cells; c++) counts[c + 1] += counts[c];
    this.cellStart = counts;
    this.cellBox = new Int32Array(counts[cells]);
    const cursor = Int32Array.from(counts.subarray(0, cells));
    for (let i = 0; i < this.boxes.length; i++) {
      const box = this.boxes[i];
      if (box.w > MAP_SIZED || box.d > MAP_SIZED) continue;
      this.eachCell(box, (c) => {
        this.cellBox[cursor[c]++] = i;
      });
    }
  }

  /**
   * Takes a box out of both questions. True when it was in one.
   *
   * `GlassSystem.clearCollider` is the only caller, and this is the analogue of
   * the `metadata.solid = false` it used to write on the mesh: one flag, so the
   * one mutable thing in an otherwise static world costs a write rather than a
   * term every cast evaluates. Nothing is spliced — the box keeps its slot and
   * every cell entry pointing at it, exactly as `ObstacleField.remove` leaves
   * its own hole behind, because the entries are indices and compacting
   * silently renumbers everything after one.
   */
  remove(box: WorldBox): boolean {
    const at = this.boxes.indexOf(box);
    if (at < 0 || this.flags[at] === 0) return false;
    this.flags[at] = 0;
    return true;
  }

  /**
   * Where may a body be? The old `SOLID_ONLY`: the death cam's pull-in, a
   * tank's chase camera, the dismount's floor test.
   *
   * `skip` is how a caster takes its OWN hull out of the answer — two property
   * writes around a `scene.pickWithRay` before this, an argument now.
   * `world/solid.ts` forbade minting a predicate at a call site and that rule
   * is kept: nothing here allocates per cast.
   */
  castBody(
    origin: Vector3,
    dir: Vector3,
    length: number,
    out: RayHit,
    skip: RayHull | null = null,
  ): boolean {
    return this.cast(origin, dir, length, BLOCKS_BODY, out, skip);
  }

  /**
   * What stops a round or a look? The old `OPAQUE_ONLY`: the hitscan's wall
   * cap, the grenade's step ray and its blast probe, the rocket.
   *
   * **`skip` is `castBody`'s, for a reason that turns out to be the same one
   * seen from the other end**: a hull's guns are drawn ON it, so a muzzle is
   * regularly INSIDE the box the hull is answered by, and `boxCast` returns
   * the FAR face to a ray that started inside — so a round leaving such a
   * muzzle stops on its own vehicle at whatever distance the exit face
   * happens to be. It is the same shape as the crew's sightline diving back
   * into its own cupola (`docs/vehicles.md`), and it is the shooter that
   * knows which hull to take out, never this.
   */
  castRound(
    origin: Vector3,
    dir: Vector3,
    length: number,
    out: RayHit,
    skip: RayHull | null = null,
  ): boolean {
    return this.cast(origin, dir, length, BLOCKS_ROUND, out, skip);
  }

  /**
   * Is anything a round would stop on between the two points? The line-of-sight
   * half of `castRound` — the bots', the aim assist's, the blast's line to a
   * victim it has already found inside the radius.
   *
   * A query of its own rather than a `castRound` whose result is thrown away,
   * because it wants ANY hit rather than the nearest: it returns on the first
   * box that blocks instead of walking the rest of the segment to find out
   * which blocked first. At sixteen bots and `thinkRate` that is the difference
   * between a whole segment and a few metres of one.
   */
  blocked(from: Vector3, to: Vector3): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return false;
    ANY_DIR.set(dx / len, dy / len, dz / len);
    return this.cast(from, ANY_DIR, len, BLOCKS_ROUND, null, null);
  }

  /**
   * The cells a box's XZ footprint touches.
   *
   * The footprint is the box's own frame grown by the pitch — `halfDepth`'s
   * reasoning, inlined because this also wants the yawed extents and rolling
   * the two together is one `cos`/`sin` pair instead of two. A PITCHED slab
   * stands deeper than `d / 2` when it is taller than it is deep, and a stair
   * parapet is exactly that case.
   */
  private eachCell(box: WorldBox, fn: (cell: number) => void): void {
    const c = Math.abs(Math.cos(box.rotY));
    const s = Math.abs(Math.sin(box.rotY));
    const hw = box.w / 2;
    const hd =
      (box.d / 2) * Math.abs(Math.cos(box.rotX)) +
      (box.h / 2) * Math.abs(Math.sin(box.rotX));
    const x0 = this.cellOf(box.cx - (hw * c + hd * s));
    const x1 = this.cellOf(box.cx + (hw * c + hd * s));
    const z0 = this.cellOf(box.cz - (hw * s + hd * c));
    const z1 = this.cellOf(box.cz + (hw * s + hd * c));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) fn(cz * this.dim + cx);
    }
  }

  /** World coordinate to grid index, clamped — the border cell catches strays. */
  private cellOf(v: number): number {
    const i = Math.floor((v - this.gridOrigin) / CELL);
    return i < 0 ? 0 : i > this.dim - 1 ? this.dim - 1 : i;
  }

  /**
   * The whole query. `out` null asks only whether anything is in the way and
   * returns on the first hit rather than the nearest.
   *
   * The order is hulls, then the map-sized boxes, then the grid, then the
   * floor, and it is a pruning order rather than a taste: each stage bounds
   * `best` for the next, and the floor — the only stage whose cost grows with
   * the LENGTH of the segment — is bounded by all three.
   */
  private cast(
    origin: Vector3,
    dir: Vector3,
    length: number,
    mask: number,
    out: RayHit | null,
    skip: RayHull | null,
  ): boolean {
    if (!(length > 0)) return false;
    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;
    let best = length;
    let found = false;
    let nx = 0;
    let ny = 1;
    let nz = 0;
    let surface: "ground" | "hard" = "hard";
    // Which hull is holding `best`, and therefore null the moment any of the
    // three static stages below beats it. Kept beside the normal rather than
    // written straight onto `out` for that reason: a hull that lost is not
    // what the ray stopped on, and a stale one would be a shell registering on
    // a tank it flew past.
    let hull: RayHull | null = null;

    for (const h of this.hulls) {
      if (h === skip) continue;
      const box = h.rayBox();
      if (!box) continue;
      const t = boxCast(box, ox, oy, oz, dx, dy, dz, best);
      if (t < 0) continue;
      if (!out) return true;
      best = t;
      found = true;
      hull = h;
      nx = _nx;
      ny = _ny;
      nz = _nz;
    }

    for (const i of this.big) {
      if ((this.flags[i] & mask) === 0) continue;
      const t = boxCast(this.boxes[i], ox, oy, oz, dx, dy, dz, best);
      if (t < 0) continue;
      if (!out) return true;
      best = t;
      found = true;
      hull = null;
      nx = _nx;
      ny = _ny;
      nz = _nz;
    }

    const xz = Math.hypot(dx, dz);
    const stamp = ++this.stamp;
    if (xz < EPS) {
      // Straight up or straight down: one cell, and every downward probe in
      // the game takes this path.
      const c = this.cellOf(oz) * this.dim + this.cellOf(ox);
      const end = this.cellStart[c + 1];
      for (let k = this.cellStart[c]; k < end; k++) {
        const b = this.cellBox[k];
        if ((this.flags[b] & mask) === 0) continue;
        const t = boxCast(this.boxes[b], ox, oy, oz, dx, dy, dz, best);
        if (t < 0) continue;
        if (!out) return true;
        best = t;
        found = true;
        hull = null;
        nx = _nx;
        ny = _ny;
        nz = _nz;
      }
    } else {
      // Amanatides & Woo over the XZ projection. `s` is distance in the plane,
      // so the ray's own parameter is `s / xz` — which is what every bound
      // below is compared against.
      const px = dx / xz;
      const pz = dz / xz;
      let i = this.cellOf(ox);
      let j = this.cellOf(oz);
      const stepI = px > 0 ? 1 : px < 0 ? -1 : 0;
      const stepJ = pz > 0 ? 1 : pz < 0 ? -1 : 0;
      const dsI = stepI === 0 ? Infinity : CELL / Math.abs(px);
      const dsJ = stepJ === 0 ? Infinity : CELL / Math.abs(pz);
      let sI =
        stepI === 0
          ? Infinity
          : (this.gridOrigin + (stepI > 0 ? i + 1 : i) * CELL - ox) / px;
      let sJ =
        stepJ === 0
          ? Infinity
          : (this.gridOrigin + (stepJ > 0 ? j + 1 : j) * CELL - oz) / pz;
      // A ray starting outside the grid has its first boundary BEHIND it; the
      // clamped cell is the border one, and the walk must not step backwards
      // out of the map to look for it.
      if (sI < 0) sI = Infinity;
      if (sJ < 0) sJ = Infinity;
      let s = 0;
      for (;;) {
        const c = j * this.dim + i;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) {
          const b = this.cellBox[k];
          if (this.mark[b] === stamp) continue;
          this.mark[b] = stamp;
          if ((this.flags[b] & mask) === 0) continue;
          const t = boxCast(this.boxes[b], ox, oy, oz, dx, dy, dz, best);
          if (t < 0) continue;
          if (!out) return true;
          best = t;
          found = true;
          hull = null;
          nx = _nx;
          ny = _ny;
          nz = _nz;
        }
        // Nothing further along the segment can beat what is already held.
        const stop = best * xz;
        if (s >= stop) break;
        const next = sI < sJ ? sI : sJ;
        if (next > stop) break;
        if (sI < sJ) {
          s = sI;
          i += stepI;
          sI += dsI;
        } else {
          s = sJ;
          j += stepJ;
          sJ += dsJ;
        }
        if (i < 0 || i >= this.dim || j < 0 || j >= this.dim) break;
      }
    }

    // The floor last, bounded by everything above it — and losing a tie to it.
    // See `COINCIDENT`, which is the whole of why that is not just `t < best`.
    const t = this.castTerrain(ox, oy, oz, dx, dy, dz, best);
    if (t >= 0 && (!found || t < best - COINCIDENT)) {
      if (!out) return true;
      best = t;
      found = true;
      hull = null;
      nx = _nx;
      ny = _ny;
      nz = _nz;
      surface = "ground";
    }

    if (!found) return false;
    if (out) {
      out.distance = best;
      out.point.set(ox + dx * best, oy + dy * best, oz + dz * best);
      out.normal.set(nx, ny, nz);
      out.surface = surface;
      out.hull = hull;
    }
    return true;
  }

  /**
   * The floor, at the heightfield's own resolution and against the two
   * triangles `Accum.quad` cuts each cell into.
   *
   * It is the DRAWN floor rather than the smooth field, for the reason
   * `TerrainField.surfaceAt` exists: the mesh is two flat triangles across a
   * bilinear surface, and what a round used to stop on was a clone of the
   * visual's own vertices. The corner order and the a→c diagonal are
   * `Accum.quad`'s; changing either here without changing it there puts the
   * collision floor a few centimetres off the one on screen, on twisted cells
   * only, which is the sort of disagreement nothing reports.
   *
   * The per-cell height band is what makes this affordable on a long ray: four
   * array reads reject a cell the segment passes well over — which is most
   * cells for most rays — before either triangle is considered.
   */
  private castTerrain(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxT: number,
  ): number {
    if (!this.heights) {
      // A flat map is the single quad it always was: one plane, the play
      // square's own extent, and no march at all.
      if (Math.abs(dy) < EPS) return -1;
      const t = -oy / dy;
      if (t < 0 || t > maxT) return -1;
      const h = this.size / 2;
      const x = ox + dx * t;
      const z = oz + dz * t;
      if (x < -h || x > h || z < -h || z > h) return -1;
      _nx = 0;
      _ny = 1;
      _nz = 0;
      return t;
    }

    const cell = this.cell;
    const half = this.half;
    const m = this.lattice;
    const lo = -half - m * cell;
    const hi = half + m * cell;

    // Clip the segment to the floor's own extent first: outside it there is no
    // floor to find, and a march that clamped instead would walk the border
    // cell for the whole of a shot into the sky.
    let t0 = 0;
    let t1 = maxT;
    if (Math.abs(dx) < EPS) {
      if (ox < lo || ox > hi) return -1;
    } else {
      let a = (lo - ox) / dx;
      let b = (hi - ox) / dx;
      if (a > b) {
        const swap = a;
        a = b;
        b = swap;
      }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
    }
    if (Math.abs(dz) < EPS) {
      if (oz < lo || oz > hi) return -1;
    } else {
      let a = (lo - oz) / dz;
      let b = (hi - oz) / dz;
      if (a > b) {
        const swap = a;
        a = b;
        b = swap;
      }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
    }
    if (t0 > t1) return -1;

    const iMin = -m;
    const iMax = this.grid + m - 1;
    let i = Math.floor((ox + dx * t0 + half) / cell);
    let j = Math.floor((oz + dz * t0 + half) / cell);
    if (i < iMin) i = iMin;
    else if (i > iMax) i = iMax;
    if (j < iMin) j = iMin;
    else if (j > iMax) j = iMax;

    const stepI = dx > EPS ? 1 : dx < -EPS ? -1 : 0;
    const stepJ = dz > EPS ? 1 : dz < -EPS ? -1 : 0;
    const dtI = stepI === 0 ? Infinity : cell / Math.abs(dx);
    const dtJ = stepJ === 0 ? Infinity : cell / Math.abs(dz);
    let tI =
      stepI === 0 ? Infinity : (-half + (stepI > 0 ? i + 1 : i) * cell - ox) / dx;
    let tJ =
      stepJ === 0 ? Infinity : (-half + (stepJ > 0 ? j + 1 : j) * cell - oz) / dz;
    if (tI < t0) tI = t0;
    if (tJ < t0) tJ = t0;

    let t = t0;
    for (;;) {
      const ya = this.latticeHeight(i, j);
      const yb = this.latticeHeight(i + 1, j);
      const yc = this.latticeHeight(i + 1, j + 1);
      const yd = this.latticeHeight(i, j + 1);
      const tEnd = tI < tJ ? (tI < t1 ? tI : t1) : tJ < t1 ? tJ : t1;
      const yA = oy + dy * t;
      const yB = oy + dy * tEnd;
      const yLo = yA < yB ? yA : yB;
      const yHi = yA < yB ? yB : yA;
      let cMax = ya;
      let cMin = ya;
      if (yb > cMax) cMax = yb;
      else if (yb < cMin) cMin = yb;
      if (yc > cMax) cMax = yc;
      else if (yc < cMin) cMin = yc;
      if (yd > cMax) cMax = yd;
      else if (yd < cMin) cMin = yd;
      if (yLo <= cMax && yHi >= cMin) {
        const xa = -half + i * cell;
        const xb = xa + cell;
        const za = -half + j * cell;
        const zb = za + cell;
        // -X/-Z, +X/-Z, +X/+Z, -X/+Z with the diagonal a→c: `Accum.quad`'s
        // corner order, and its two triangles in its order.
        let hit = triCast(
          xa, ya, za,
          xb, yb, za,
          xb, yc, zb,
          ox, oy, oz, dx, dy, dz, maxT,
        );
        let hx = _nx;
        let hy = _ny;
        let hz = _nz;
        const other = triCast(
          xa, ya, za,
          xb, yc, zb,
          xa, yd, zb,
          ox, oy, oz, dx, dy, dz, maxT,
        );
        if (other >= 0 && (hit < 0 || other < hit)) {
          hit = other;
          hx = _nx;
          hy = _ny;
          hz = _nz;
        }
        if (hit >= 0) {
          _nx = hx;
          _ny = hy;
          _nz = hz;
          return hit;
        }
      }
      if (tEnd >= t1) return -1;
      if (tI < tJ) {
        t = tI;
        i += stepI;
        tI += dtI;
      } else {
        t = tJ;
        j += stepJ;
        tJ += dtJ;
      }
      if (i < iMin || i > iMax || j < iMin || j > iMax) return -1;
    }
  }

  /**
   * One lattice vertex's height, inside the authored grid or out in the
   * borderland.
   *
   * The split is `Accum.grid` and `Accum.field`: inside, the mesh reads the
   * heightfield straight; outside, it samples `heightAt`, which is the one
   * place that knows what the ground does past the grid. The two agree exactly
   * on the boundary ring — bilinear interpolation at a grid vertex IS that
   * vertex, and the roll is zero there — which is what keeps the floor and its
   * borderland one surface with no seam for a round to fall through.
   */
  private latticeHeight(i: number, j: number): number {
    const n = this.grid;
    const h = this.heights;
    if (h && i >= 0 && i <= n && j >= 0 && j <= n) return h[j * (n + 1) + i];
    return this.terrain.heightAt(
      -this.half + i * this.cell,
      -this.half + j * this.cell,
    );
  }
}

/**
 * The nearest point at which the ray meets an oriented box, or -1.
 *
 * The frame is entered exactly as `boxGeometry`'s is, and for its reason: the
 * yaw convention has been got wrong once already, and a box tested in a
 * mirrored frame is a wall that stops rounds beside itself. World→yawed is
 * `rotateToLocalXZ`'s transform to the letter, and yawed→local is the inverse
 * of the pitch `topFaceAtLocalZ` is written against — which is why a top face
 * comes back at `cy + h/2/cos - lz tan` from both files.
 *
 * Not `boxGeometry.segmentHitsBox`, and the difference is what this is for:
 * that answers a FOOTPRINT question in two dimensions and this needs a distance
 * and a face in three. `halfDepth` is deliberately absent — it is the ground
 * projection of a pitched box, and in the box's own frame the extent is `d / 2`
 * whatever the pitch.
 *
 * Writes the world-space outward normal into the module scratch. See the file
 * header on what a ray starting inside a box gets.
 */
function boxCast(
  b: WorldBox,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): number {
  const cy = Math.cos(b.rotY);
  const sy = Math.sin(b.rotY);
  const px = ox - b.cx;
  const py = oy - b.cy;
  const pz = oz - b.cz;
  let fx = px * cy - pz * sy;
  let fy = py;
  let fz = px * sy + pz * cy;
  let gx = dx * cy - dz * sy;
  let gy = dy;
  let gz = dx * sy + dz * cy;
  const pitched = b.rotX !== 0;
  let cx = 1;
  let sx = 0;
  if (pitched) {
    cx = Math.cos(b.rotX);
    sx = Math.sin(b.rotX);
    const ly = fy * cx + fz * sx;
    const lz = -fy * sx + fz * cx;
    fy = ly;
    fz = lz;
    const my = gy * cx + gz * sx;
    const mz = -gy * sx + gz * cx;
    gy = my;
    gz = mz;
  }

  let tMin = -Infinity;
  let tMax = Infinity;
  let axisIn = -1;
  let signIn = 0;
  let axisOut = -1;
  let signOut = 0;

  for (let axis = 0; axis < 3; axis++) {
    const g = axis === 0 ? gx : axis === 1 ? gy : gz;
    const f = axis === 0 ? fx : axis === 1 ? fy : fz;
    const h = (axis === 0 ? b.w : axis === 1 ? b.h : b.d) / 2;
    if (g > -EPS && g < EPS) {
      if (f < -h || f > h) return -1;
      continue;
    }
    const inv = 1 / g;
    let near = (-h - f) * inv;
    let far = (h - f) * inv;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
    }
    if (near > tMin) {
      tMin = near;
      axisIn = axis;
      signIn = g > 0 ? -1 : 1;
    }
    if (far < tMax) {
      tMax = far;
      axisOut = axis;
      signOut = g > 0 ? 1 : -1;
    }
    if (tMin > tMax) return -1;
  }

  let t: number;
  let axis: number;
  let sign: number;
  if (tMin >= 0) {
    t = tMin;
    axis = axisIn;
    sign = signIn;
  } else if (tMax >= 0) {
    // Started inside: the FAR face, which is what a two-sided triangle pick
    // reported and what two call sites flip the normal of.
    t = tMax;
    axis = axisOut;
    sign = signOut;
  } else return -1;
  if (t > maxT || axis < 0) return -1;

  // The local face normal, back out through the same two rotations.
  let lx = 0;
  let ly = 0;
  let lz = 0;
  if (axis === 0) lx = sign;
  else if (axis === 1) ly = sign;
  else lz = sign;
  if (pitched) {
    const wy = ly * cx - lz * sx;
    const wz = ly * sx + lz * cx;
    ly = wy;
    lz = wz;
  }
  _nx = lx * cy + lz * sy;
  _ny = ly;
  _nz = -lx * sy + lz * cy;
  return t;
}

/**
 * Möller-Trumbore, two-sided, writing the triangle's own upward normal into the
 * module scratch.
 *
 * Two-sided because Babylon's triangle picking is (`assertFacesUp` says so from
 * the other direction), and the floor is met from underneath by anything
 * standing inside a building cut into a hill. The normal is turned to +Y rather
 * than toward the ray, because a heightfield has no overhangs and so has
 * exactly one honest answer — the flip two callers do is for a BOX met from
 * inside, which the floor cannot be.
 *
 * It is the FLAT triangle normal rather than the smoothed vertex normal
 * `PickingInfo.getNormal(true)` interpolated. The two differ by a degree or so
 * on a hillside, which is an impact disc lying a degree flatter and nothing
 * else — and the flat one is the plane the round actually stopped on.
 */
function triCast(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxT: number,
): number {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (det > -EPS && det < EPS) return -1;
  const inv = 1 / det;
  const sx = ox - ax;
  const sy = oy - ay;
  const sz = oz - az;
  const u = (sx * hx + sy * hy + sz * hz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (t < 0 || t > maxT) return -1;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz);
  if (len < EPS) return -1;
  const k = ny < 0 ? -1 / len : 1 / len;
  nx *= k;
  ny *= k;
  nz *= k;
  _nx = nx;
  _ny = ny;
  _nz = nz;
  return t;
}
