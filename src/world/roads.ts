/**
 * roads.ts — The road network as RECTANGLES, and the two questions they
 * answer: is this patch of ground PAVED, and — where two carriageways cross —
 * which of them is the ground?
 * Owns: the road footprint's defaults, the surface RANKING and the height that
 * ranking is expressed as, the footprints' derivation from a layout's
 * placements, and the point-in-road tests. Pure arithmetic — no Babylon, no
 * allocation per query — so the client, the authority and the grass field all
 * ask it the same way.
 *
 * **A road is still visual-only and still stops nothing.** It has no collider,
 * emits no `WorldBox`, and is invisible to navigation, to cover and to every
 * ray in the game; that is deliberate and none of it changes here. What it now
 * rejects is one thing and one thing only: something ROOTED being sown on top
 * of it. A palm growing out of fourteen metres of asphalt is not cover a bot
 * can use or a round can stop on — it is a picture of a bug — and the rule that
 * every map used to keep by hand (`scatter regions dodge the roads`) is the
 * sort of rule a layout cannot be trusted with, because nothing checks it and
 * the failure is only ever visible from inside the map.
 *
 * The two readers of `onRoad` are `MapBuilder.findSpot`, which holds
 * `PropBody.rooted` props off the carriageway, and `GrassSystem.scatter`,
 * which holds every tuft off it — grass is rooted by definition and has no
 * table to say so in.
 *
 * **What is new here is the JUNCTION.** Two roads that cross are two flat
 * sheets at the same height in two different meshes, and until `ROAD_RANK`
 * below nothing decided which one you were looking at: the tie was broken per
 * pixel, by whichever mesh that frame's front-to-back sort happened to draw
 * first. `roadTop` is that decision, made once, off the SURFACE — and
 * `buildRoad` is the only thing that draws with it, so a layout still says
 * nothing about junctions and still cannot.
 *
 * **A road is a rectangle OR a path, and the footprint holds both.** A
 * rectangle is what every road was and what every map but Cinderhaven still
 * states, and it is tested exactly as it always was — a linear scan, because
 * the busiest rectangle list in the tree is twenty-four long. A PATH road is
 * resolved by `roadPaths.ts` into convex PIECES (a quad per stretch of
 * carriageway, a triangle per slice of junction), and there are thousands of
 * those on an island, so they are bucketed on a lattice. Nothing about a
 * rectangle's answer moved when paths arrived, which is what keeps the seeded
 * dressing on the maps that have none bit-identical.
 */
import type { Placement } from "./layout";

/**
 * The width `buildRoad` gives a road that does not ask for one. Here rather
 * than in the builder because the footprint below has to agree with the slab
 * exactly, and two roads in the shipped layouts state a `length` and no
 * `width` — so a second copy of this number would be wrong on Greyfen only,
 * by four metres, in a way nothing would report.
 */
export const ROAD_WIDTH = 8;
/** The length `buildRoad` gives a road that does not ask for one. */
export const ROAD_LENGTH = 40;

/**
 * What a road is PAVED with, and — through `roadTop` below — which of two
 * roads owns the ground where they cross.
 *
 * The same three the `road` builder draws (`BuildParams.surface`), named here
 * because the ORDER of them is a road fact rather than a builder's: a layout
 * states the surface and nothing else, and the junction has to fall out of
 * that.
 */
export type RoadSurface = "dirt" | "cobble" | "asphalt";

/**
 * Which surface trumps which where two roads cross, low to high.
 *
 * **A junction has to be settled by the SURFACES rather than by whatever the
 * renderer happens to draw first**, and this is the whole of the decision. The
 * order is how the ground was actually built: a track is scraped, a street is
 * laid over it, and blacktop is poured over that — so the more made-up surface
 * is the one that carries on through the crossing, which is also how a person
 * reads it. A layout says nothing about junctions and cannot: two roads that
 * cross are two placements that know nothing about each other.
 *
 * Adding a fourth surface is a row here and a colour in `buildRoad`. What it
 * may NOT be is a rank shared with an existing surface — two roads at the same
 * rank are two coplanar sheets again, which is the bug this exists for.
 */
export const ROAD_RANK: Record<RoadSurface, number> = {
  dirt: 0,
  cobble: 1,
  asphalt: 2,
};

/**
 * How far the LOWEST-ranked road's top face rides above the floor under it.
 *
 * A centimetre — enough that the slab does not fight the ground it is lying
 * on **inside a hundred metres or so**, and not enough to swallow a
 * character's ankles. Nothing stands on a road (feet rest on the floor from
 * the ground probe and the nav grid, neither of which has ever heard of a
 * carriageway), so this is a look and never a walked height — and
 * `ROAD_RANK_STEP` below is small enough that the highest-ranked road is still
 * within four millimetres of it.
 *
 * **What a centimetre does NOT survive is DISTANCE**, and that is what
 * `ROAD_DEPTH_UNITS` is for: this number is metres, and what the depth buffer
 * can tell apart is not.
 */
export const ROAD_TOP = 0.01;

/**
 * How far toward the eye a carriageway is biased in the depth TEST, in
 * polygon-offset units — the fix for a road that is eaten by the ground it is
 * lying on, from about a hundred metres out.
 *
 * **`ROAD_TOP` is stated in metres and the depth buffer's own step is not, so
 * a fixed lift is a promise that expires with range.** The near plane is 5 cm
 * (it has to be — the viewmodel's optics sit inside it), and against a buffer
 * resolving 2^-24 of the range that leaves a step of about a centimetre at
 * 90 m and tens of centimetres by the far end of a big map: past that the slab
 * and the floor are the SAME depth, the tie is broken per pixel, and it is
 * broken differently as the eye moves. Measured on Sarab from 40 m up — a
 * helicopter's height, which is the vantage that made this a bug report rather
 * than a curiosity, because altitude is what puts half a kilometre of
 * carriageway on screen at once: **the far half of a 900 m street was drawn as
 * detached bands of asphalt on bare sand**, 22.0% of the far window covered
 * against the 35.7% the road actually paves, and the pattern crawled with
 * every metre the aircraft flew.
 *
 * A polygon offset is the fix rather than a bigger lift for the reason
 * `CelMaterialFactory.GLASS_DEPTH_UNITS` is: it is stated in exactly the units
 * the problem is in. A unit is derived from the buffer's own smallest
 * resolvable step at that fragment rather than from any distance, so this is fractions of a millimetre in the street you are
 * standing in, where a road needs nothing, and metres at the fog wall, where
 * the buffer's step is that coarse. A lift big enough to survive 560 m would
 * have to be half a metre of kerb underfoot.
 *
 * **Eight is a doubled margin on a measured floor of four, and the plateau
 * above it is wide.** Swept live over the same two vantages, the far window's
 * road coverage goes 22.0% unbiased, 34.1% at -2, and 35.7% from -4 — where it
 * stops moving, and is still exactly 35.7% at -32. The same reading taken in
 * the band nearest the fog wall saturates at the same place: 14.8% unbiased,
 * 20.0% at -2, 21.0% at -4 and unchanged at -32. So the number is not tuned to
 * a look; it is the point at which the carriageway is all there, doubled.
 *
 * **It is the BUILDER's and not the slab's** (`Build`'s `depthUnits`), which
 * is what keeps everything a road already carried in step with it: the lane
 * markings are painted 2 cm above their own slab and move toward the eye with
 * it, so that pair is settled by the same geometry it always was. What this
 * changes is only the road against the FLOOR.
 *
 * **What it costs is nothing, and that was measured against the tightest
 * clearance anything keeps over a carriageway.** A bullet's DUST DISC is the
 * ceiling `ROAD_RANK_STEP` is squeezed by, and its margin over a road is
 * tighter than that note's 20 mm: a road carries no collider, so the round
 * stops on the FLOOR and the disc is lifted `CONFIG.effects.discLift` from
 * there — 10 mm of clearance over the slab, not 20. Forty of them laid every
 * 5 m down 200 m of Sarab's asphalt and diffed against the same street with
 * none: **twelve are drawn, at identical screen positions, with and without
 * the bias** — the same twelve blobs to within a few pixels of edge
 * antialiasing. Eight units at the range a disc is still a disc is fractions
 * of a millimetre; it only becomes metres out where the buffer's own step
 * already is.
 *
 * **The RANKS below are deliberately still millimetres and were measured
 * rather than assumed.** A crossing is decided by geometry at every range a
 * road is drawn at — with both surfaces biased by this same number, a
 * dirt/asphalt junction 400 m away renders BIT-IDENTICALLY to one where the
 * two are given different offsets, so there is nothing here for a per-rank
 * unit to buy.
 */
export const ROAD_DEPTH_UNITS = -8;

/**
 * What one rank is worth in height. **Two millimetres, and it is squeezed from
 * both sides.**
 *
 * *Below*, by what it has to beat: nothing. Two roads that cross are two sheets
 * at the SAME height in two different merged meshes — one per material — and an
 * exact tie is broken per pixel, in favour of whichever mesh that frame's
 * front-to-back sort happened to draw first, which changes as the camera moves
 * round the junction. Any separation the depth buffer can resolve settles it,
 * and on `depth32float` that is a very small number: measured on Sarab's
 * asphalt/dirt crossings from 30, 60, 150, 300 and 420 m, along both roads and
 * from above, **a millimetre is clean at every range and zero is wrong at every
 * range**. Two is that with a doubled margin, not a figure anything was tuned
 * to. It is worth knowing that the floor here is the DEPTH FORMAT, which
 * `main.ts`'s `stencil: false` decides (see `plans/webgpu-ref/depth.mjs`) —
 * putting the stencil back takes the buffer to `depth24plus` and this margin
 * with it.
 *
 * *Above*, by everything else that lies on the ground, because a road is a
 * sheet ON TOP of the floor and almost nothing else knows it is there. Feet are
 * not the problem — a road carries no collider, so a body stands on the floor
 * and always has, and the player has no body mesh to sink anyway — but a
 * bullet's DUST DISC is: it is spawned on the floor the round actually hit and
 * lifted `CONFIG.effects.discLift`, **twenty millimetres**, which is the
 * tightest clearance in the game over a carriageway and the real ceiling on
 * this ladder. A blob shadow's 40 mm is the next one up. So the whole ladder
 * has to fit inside what a road already stood proud by, and it does: the top of
 * it is 14 mm against the 10 mm every road used to sit at, so nothing that
 * cleared a road before clears it by more than four millimetres less now.
 *
 * The one thing that did NOT clear it before is fixed properly instead of by
 * this number — `MapBuilder`'s scatter pass puts a prop sown on a street on the
 * STREET (`roadTopAt`), because blown litter is 12 mm tall and was half buried
 * in the carriageway at the old flat 10 mm.
 *
 * The other half of what makes two millimetres enough is that **a road is not
 * INKED** — see `MapBuilder`'s road merge. An outline shell stamps depth a full
 * outline-width (5 cm) above the sheet it wraps, which is twenty-five times
 * this number: with the ink on, the loser's shell painted the whole junction
 * black however far the winner was lifted.
 *
 * **This ladder settles a CROSSING and it is not what settles the FLOOR** —
 * see `ROAD_DEPTH_UNITS`, which is the same question asked at 500 m, where
 * millimetres of any number are below what the buffer can tell apart. The two
 * do not interact: both surfaces at a junction carry the same bias, so what
 * decides between them is still the two millimetres here.
 */
export const ROAD_RANK_STEP = 0.002;

/** The surface a road placement asks for, defaulting as `buildRoad` does. */
export function roadSurface(surface?: string): RoadSurface {
  return surface === "dirt" || surface === "asphalt" ? surface : "cobble";
}

/**
 * How high a road of this surface rides above the floor under it — the one
 * number that decides a crossing.
 *
 * `buildRoad` cuts its slab to this and `roadRects` records it, so the drawn
 * junction and the answer anything else gets about the same ground cannot
 * disagree.
 */
export function roadTop(surface: RoadSurface): number {
  return ROAD_TOP + ROAD_RANK[surface] * ROAD_RANK_STEP;
}

/**
 * One RECTANGULAR road's ground footprint in world space: `width` across the
 * carriageway, `length` along it, turned by `rotY` about (x, z).
 *
 * The slab itself is re-cut against the heightfield by `terrainSlab` and a
 * contoured road follows every bank it crosses — but it is bent VERTICALLY
 * only, so this rectangle is the footprint of both forms. A road that bends in
 * PLAN is a path, and is a `RoadPiece` list instead.
 */
export interface RoadRect {
  x: number;
  z: number;
  /** Across the carriageway, along the road's local X. */
  width: number;
  /** Along the carriageway, along the road's local Z. */
  length: number;
  rotY: number;
  /**
   * How far this carriageway's top face rides above the floor — `roadTop` of
   * its own surface, and the reason a `RoadRect` carries a height at all:
   * `roadTopAt` is what puts a prop sown on a street ON the street.
   */
  top: number;
}

/**
 * Every RECTANGULAR road in a layout — a `road` placement with no `path`.
 *
 * Derived from the placement list rather than authored beside it: a road is a
 * `Placement` like any other and stating its extent twice is the sort of pair
 * that drifts. Cheap enough to call per build — the longest list in the tree is
 * Coldharbour's twelve out of ~700 placements. The path roads are
 * `roadNetwork`'s (`roadPaths.ts`), which calls this for the rest.
 */
export function roadRects(placements: readonly Placement[]): RoadRect[] {
  const out: RoadRect[] = [];
  for (const p of placements) {
    if (p.kind !== "road" || p.params?.path) continue;
    out.push({
      x: p.x,
      z: p.z,
      width: p.params?.width ?? ROAD_WIDTH,
      length: p.params?.length ?? ROAD_LENGTH,
      rotY: p.rotY ?? 0,
      top: roadTop(roadSurface(p.params?.surface)),
    });
  }
  return out;
}

/**
 * One convex piece of a PATH road's footprint — a stretch of carriageway
 * between two cross-sections, or one slice of a junction — as the half-planes
 * that bound it.
 *
 * Stored as edges rather than corners because the only question ever asked of
 * one is "is this point inside, give or take a pad", and a unit inward normal
 * per edge answers that with three multiplications: `nx * x + nz * z >= c` on
 * every edge. A pad moves every edge outward by the same distance, which is a
 * MITRED grow — the same shape `onRoad`'s rectangle test has always grown by.
 */
export interface RoadPiece {
  /** `(nx, nz, c)` per edge, inward unit normal and offset. */
  edges: Float64Array;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** `roadTop`-style lift above the floor, as `RoadRect.top`. */
  top: number;
}

/**
 * Everything a layout PAVES, for the two questions below.
 *
 * Built once per map by `roadNetwork` (`roadPaths.ts`) — on the client by
 * `MapBuilder` and on the authority off the same placements — and carried on
 * `GameMap.roads`.
 */
export interface RoadFootprint {
  rects: readonly RoadRect[];
  pieces: readonly RoadPiece[];
  /** The lattice `pieces` are bucketed on: side, origin and extent in cells. */
  cell: number;
  ox: number;
  oz: number;
  nx: number;
  nz: number;
  /** Row-major, `nx * nz` long; each a list of indices into `pieces`. */
  cells: readonly (readonly number[])[];
}

/**
 * The side of the lattice path pieces are bucketed on. A junction slice is
 * rarely wider than this and a stretch of carriageway is cut far shorter, so a
 * piece lands in a handful of cells and a query reads one.
 */
const PIECE_CELL = 16;

/**
 * A footprint over these rectangles and these convex polygons, each polygon's
 * corners anticlockwise seen from above (+X right, +Z up the page) — which is
 * the order `roadPaths.ts` builds them in and the one the inward normals below
 * are derived from.
 */
export function roadFootprint(
  rects: readonly RoadRect[],
  polygons: readonly { xs: readonly number[]; zs: readonly number[]; top: number }[],
): RoadFootprint {
  const pieces: RoadPiece[] = [];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const poly of polygons) {
    const n = poly.xs.length;
    if (n < 3) continue;
    const edges = new Float64Array(n * 3);
    const piece: RoadPiece = {
      edges,
      minX: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxZ: -Infinity,
      top: poly.top,
    };
    let usable = true;
    for (let k = 0; k < n; k++) {
      const ax = poly.xs[k];
      const az = poly.zs[k];
      const bx = poly.xs[(k + 1) % n];
      const bz = poly.zs[(k + 1) % n];
      const len = Math.hypot(bx - ax, bz - az);
      // A zero-length edge bounds nothing; one is left as an always-true
      // half-plane rather than dividing by it.
      if (len < 1e-9) {
        edges[k * 3] = 0;
        edges[k * 3 + 1] = 0;
        edges[k * 3 + 2] = -Infinity;
      } else {
        // Anticlockwise, so the inside is on the LEFT of each edge.
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        edges[k * 3] = nx;
        edges[k * 3 + 1] = nz;
        edges[k * 3 + 2] = nx * ax + nz * az;
      }
      piece.minX = Math.min(piece.minX, ax);
      piece.minZ = Math.min(piece.minZ, az);
      piece.maxX = Math.max(piece.maxX, ax);
      piece.maxZ = Math.max(piece.maxZ, az);
      if (!Number.isFinite(ax) || !Number.isFinite(az)) usable = false;
    }
    if (!usable) continue;
    pieces.push(piece);
    minX = Math.min(minX, piece.minX);
    minZ = Math.min(minZ, piece.minZ);
    maxX = Math.max(maxX, piece.maxX);
    maxZ = Math.max(maxZ, piece.maxZ);
  }
  if (pieces.length === 0) {
    return { rects, pieces, cell: PIECE_CELL, ox: 0, oz: 0, nx: 0, nz: 0, cells: [] };
  }
  const ox = Math.floor(minX / PIECE_CELL) * PIECE_CELL;
  const oz = Math.floor(minZ / PIECE_CELL) * PIECE_CELL;
  const nx = Math.floor((maxX - ox) / PIECE_CELL) + 1;
  const nz = Math.floor((maxZ - oz) / PIECE_CELL) + 1;
  const cells: number[][] = Array.from({ length: nx * nz }, () => []);
  pieces.forEach((p, i) => {
    const i0 = Math.floor((p.minX - ox) / PIECE_CELL);
    const i1 = Math.floor((p.maxX - ox) / PIECE_CELL);
    const j0 = Math.floor((p.minZ - oz) / PIECE_CELL);
    const j1 = Math.floor((p.maxZ - oz) / PIECE_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let k = i0; k <= i1; k++) cells[j * nx + k].push(i);
    }
  });
  return { rects, pieces, cell: PIECE_CELL, ox, oz, nx, nz, cells };
}

/** Is (x, z) inside `p` grown by `pad`? */
function inPiece(p: RoadPiece, x: number, z: number, pad: number): boolean {
  if (x < p.minX - pad || x > p.maxX + pad || z < p.minZ - pad || z > p.maxZ + pad) {
    return false;
  }
  const e = p.edges;
  for (let k = 0; k < e.length; k += 3) {
    if (e[k] * x + e[k + 1] * z < e[k + 2] - pad) return false;
  }
  return true;
}

/**
 * The best answer the path pieces give at (x, z): with `wantTop` false, 1 if
 * any piece grown by `pad` holds the point and 0 if none does; with it true,
 * the highest `top` among the pieces holding it. One walk for both questions,
 * written out rather than handed a callback so that a query allocates nothing.
 * A piece spanning two cells can be tested twice, which costs a repeated test
 * and nothing else.
 */
function pieceQuery(
  fp: RoadFootprint,
  x: number,
  z: number,
  pad: number,
  wantTop: boolean,
): number {
  if (fp.pieces.length === 0) return 0;
  const i0 = Math.max(0, Math.floor((x - pad - fp.ox) / fp.cell));
  const i1 = Math.min(fp.nx - 1, Math.floor((x + pad - fp.ox) / fp.cell));
  const j0 = Math.max(0, Math.floor((z - pad - fp.oz) / fp.cell));
  const j1 = Math.min(fp.nz - 1, Math.floor((z + pad - fp.oz) / fp.cell));
  let best = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      for (const k of fp.cells[j * fp.nx + i]) {
        const p = fp.pieces[k];
        if (wantTop && p.top <= best) continue;
        if (!inPiece(p, x, z, pad)) continue;
        if (!wantTop) return 1;
        best = p.top;
      }
    }
  }
  return best;
}

/**
 * True when (x, z) is on a road, with `pad` metres of margin around the
 * carriageway.
 *
 * `pad` is what the caller thinks is ROOTED in the ground at that point — a
 * trunk's half-width, not its canopy's. A palm leaning its fronds over a street
 * is what a street with palms down it looks like; a palm standing IN it is the
 * bug. Grass passes zero: a blade is a point and a tuft against the kerb reads
 * as the verge it is.
 */
export function onRoad(
  roads: RoadFootprint,
  x: number,
  z: number,
  pad: number,
): boolean {
  if (pieceQuery(roads, x, z, pad, false) > 0) return true;
  for (const r of roads.rects) {
    const dx = x - r.x;
    const dz = z - r.z;
    let lx = dx;
    let lz = dz;
    if (r.rotY !== 0) {
      // The `rotateY` convention MapBuilder places every structure with, run
      // backwards: world offset -> the road's own frame.
      const c = Math.cos(r.rotY);
      const s = Math.sin(r.rotY);
      lx = dx * c - dz * s;
      lz = dx * s + dz * c;
    }
    if (
      Math.abs(lx) <= r.width / 2 + pad &&
      Math.abs(lz) <= r.length / 2 + pad
    ) {
      return true;
    }
  }
  return false;
}

/**
 * How high the road surface at (x, z) stands above the floor, or 0 where there
 * is no road there — the MAXIMUM over every carriageway covering the point,
 * because at a junction that is the one you would be standing on.
 *
 * **A prop sown on a street stands on the STREET.** Everything the scatter
 * pass places is put down against the floor (`TerrainField`), and a road is a
 * sheet lying on top of that floor — so blown litter, whose scraps are twelve
 * millimetres tall, was already half sunk into every carriageway it landed on
 * before the ranks above widened the gap. `MapBuilder.scatterRegion` adds this
 * to a prop's base for that reason, and it is the only place in the tree that
 * needs it: nothing else is placed on a road by anything but an author's hand.
 *
 * Zero padding, unlike `onRoad`: this asks what the ground under a point IS,
 * not whether something may be planted there.
 */
export function roadTopAt(
  roads: RoadFootprint,
  x: number,
  z: number,
): number {
  let top = pieceQuery(roads, x, z, 0, true);
  for (const r of roads.rects) {
    if (r.top <= top) continue;
    const dx = x - r.x;
    const dz = z - r.z;
    let lx = dx;
    let lz = dz;
    if (r.rotY !== 0) {
      const c = Math.cos(r.rotY);
      const s = Math.sin(r.rotY);
      lx = dx * c - dz * s;
      lz = dx * s + dz * c;
    }
    if (Math.abs(lx) <= r.width / 2 && Math.abs(lz) <= r.length / 2) {
      top = r.top;
    }
  }
  return top;
}
