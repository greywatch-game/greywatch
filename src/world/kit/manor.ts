/**
 * kit/manor.ts — buildJungleManor: a two-storey colonial manor with a
 * wrap-around veranda on both levels, and the largest single structure in the
 * kit. Follows the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata); it gets a file of its own only because
 * it is bigger than the rest of buildings.ts put together.
 *
 * ## What it is for
 *
 * A control point you fight *through* three times over: the colonnaded ground
 * veranda, the hall inside it, and the upper gallery that overlooks every
 * approach. The gallery is the point of the building — a railed ring right the
 * way round at 4.15 m, which is a firing position on all four bearings with
 * `guard`-height cover the whole way. Everything below exists to make that
 * gallery worth taking and expensive to hold.
 *
 * ## The six things here that are load-bearing rather than decorative
 *
 * - **TWO routes up, and only one of them is covered.** The grand stair is
 *   inside the hall, so taking the gallery from the front means clearing the
 *   ground floor first; the service stair runs up the open east flank, so the
 *   fast way up is the way everyone can see. One route would make the gallery
 *   a fortress with a single choke, which is what `buildBarn`'s "the perch's
 *   ramp is exposed" note is about from the other side.
 * - **Both flights are `Build.flight()`** (kit/core.ts, where they moved when
 *   `buildStairs` became the second caller), which is `buildBarn`'s ramp math
 *   with the
 *   two mistakes that comment names already made and fixed: the pitch is
 *   derived from the RUN (never from the slab's own length), and the slab is
 *   placed by its TOP face, whose half-thickness is measured VERTICALLY
 *   (`h / 2 / cos`, not `h / 2 * cos`). Both flights are inside
 *   `MAX_WALKABLE_GRADE`; the service stair additionally runs on PAST the
 *   ground by `SERVICE_DROP`, because the terrain under it is not the
 *   structure's to know.
 * - **The podium is a real collider, and the ground floor IS its top face.**
 *   0.4 m is inside `CONFIG.nav.stepHeight`, so the whole footprint links to
 *   the ground around it from every direction without a single ramp, and
 *   nothing has to lay a second floor slab over it — which would be an
 *   up-facing surface coplanar with the podium in a different colour, i.e. the
 *   taproom flicker `buildTavern` documents.
 * - **The upper floor is built AROUND the stairwell, and the void is longer
 *   than the stair needs.** The slab may cover the flight only while it clears
 *   the treads by `HEADROOM` (1.7 m), which at this grade runs out at
 *   `VOID_Z0`; past that the ceiling would blank the stair out of the nav
 *   graph and the gallery would be reachable only from outside.
 * - **Roofs are emitted LAST.** A cell inside the footprint already holds the
 *   podium, the upper deck and (outside) the terrain, and `NavGrid`'s
 *   `MAX_SURFACES` is 3 with the fourth candidate DROPPED rather than sorted
 *   in. Emitting the roofs first would spend that slot on geometry nothing can
 *   ever stand on and lose the gallery instead. **The chimney is emitted late
 *   for the same reason** and not with the hall it belongs to: its breast tops
 *   are two more candidates inside the one footprint, so a chimney built with
 *   the ground storey takes the upper floor's slot in every cell it stands in.
 * - **There is ONE flue, and both fireplaces are on it.** The building carried
 *   two brick stacks at the gable ends before this, each running floor to
 *   ridge with no fireplace under it and nothing but `b.box` around it — so
 *   they stood *inside* both storeys as walk-through columns, and the west one
 *   came up through the middle of the grand stair's treads. A stack is the top
 *   of a flue or it is nothing: anything added to this roofline owes a hearth
 *   underneath it and a breast joining the two.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Structure,
  BRICK,
  CREEPER,
  DARK_STONE,
  EMBER,
  FLAME,
  GUARD_THICKNESS,
  IRON,
  MOSS_STONE,
  PLANK,
  STONE,
  STUCCO,
  TEAK,
  VERDIGRIS,
} from "./core";

// --- the section everything else is measured from --------------------------

/** Core block, X. The veranda is added outside this on every side. */
const CW = 22;
/** Core block, Z. Front elevation faces -Z. */
const CD = 15;
/** Veranda depth. Two nav cells, so a bot can walk the ring past a pier. */
const VER = 3;
/** Footprint, veranda included. */
const FW = CW + VER * 2;
const FD = CD + VER * 2;
/** Outer wall thickness. Walls are centred ON the footprint lines. */
const T = 0.4;

/** Podium top — the ground floor's walked surface, on a stone base course. */
const POD = 0.4;
/** Ground storey: podium top to the underside of the floor above. */
const GROUND = 3.4;
/** Upper floor slab. */
const SLAB = 0.35;
/** The upper gallery's walked surface. The whole building is about this line. */
const DECK = POD + GROUND + SLAB;
/** Upper storey: gallery deck to the eaves. */
const UPPER = 3.3;
const EAVE = DECK + UPPER;

/** Main roof rise over half the core's depth. */
const ROOF_RISE = 3.2;
const ROOF_EAVE_OVER = 0.6;

// --- the grand stair -------------------------------------------------------
// Inside the hall, against the west wall, rising north. The void above it is
// what the upper floor is cut around, so both are derived here.

const GRAND_W = 3.2;
const GRAND_X = -CW / 2 + 1.9;
/** Where the treads meet the upper floor: the void's north edge. */
const GRAND_TOP_Z = 4.8;
const GRAND_RISE = DECK - POD;
const GRAND_RUN = 10.8;
/** 0.347 — inside the 0.4 the nav graph severs above. */
const GRAND_GRADE = GRAND_RISE / GRAND_RUN;
const GRAND_FOOT_Z = GRAND_TOP_Z - GRAND_RUN;

/**
 * Where the west elevation's ground doorway goes.
 *
 * Not the wall's centre line, which is what it was: the flight owns the whole
 * west wall from z -6.0 to 4.8 and crosses the middle of it a metre and a half
 * up, so a centred door opened into the underside of its own treads —
 * measured **1.58 m of headroom at the south jamb**, under the 1.7 m `NavGrid`
 * wants before it will call a cell standable at all, and reading from outside
 * as a doorway sliced in half by a beam. This is the one bay the stair leaves
 * clear, and it is why `doorWallZ` takes an offset at all.
 */
const WEST_DOOR_Z = 6;

/** The stairwell void in the upper floor. */
const VOID_X = -CW / 2 + 4;
/**
 * How early the ceiling has to stop. The slab's underside is at
 * `DECK - SLAB`, so it may only cover the flight while the treads below clear
 * it by `HEADROOM`; solving `POD + (z - foot) * grade + 1.7 <= 3.8` puts the
 * last legal cover at z = -1.1, and this keeps most of a cell in hand. South
 * of it the lower flight runs under a real ceiling, which is what a stair
 * enclosure looks like anyway.
 */
const VOID_Z0 = -2.4;

// --- the service stair -----------------------------------------------------
// Up the open east flank to a landing deck that meets the gallery. Runs along
// Z like every other pitched slab in the kit, so `guard` can rail it.

const SERVICE_W = 3.2;
const SERVICE_X = FW / 2 + 1.9;
/** Its foot is on TERRAIN, not on the podium, so it must overrun. */
const SERVICE_DROP = 0.6;
const SERVICE_GRADE = 0.35;
const SERVICE_RUN = (DECK + SERVICE_DROP) / SERVICE_GRADE;
/** The landing's north edge — where the treads arrive. */
const SERVICE_TOP_Z = -5.5;
const LANDING_D = 3;
const LANDING_Z = SERVICE_TOP_Z - LANDING_D / 2;

// --- the portico -----------------------------------------------------------

const PORTICO_HW = 4.2;
/** How far it breaks forward of the veranda's south edge. */
const PORTICO_OUT = 1.6;
const PORTICO_Z = -FD / 2 - PORTICO_OUT / 2;

// --- colours the manor adds to the palette it shares -----------------------

/** A window with nobody behind it: the reveal, not the glass. */
const REVEAL = "#2b312d";
const WINDOW = "#ffc27a";

// --- helpers ---------------------------------------------------------------

/** Which way a wall faces. Fixes both the axis and the outward sign. */
type Facing = "-z" | "+z" | "-x" | "+x";

/**
 * Colonnade stations along one run of the veranda: `bays` even spans across
 * `±half`, dropping any station the entrance bay needs clear.
 *
 * Even spacing rather than a fixed pitch because the front and the flanks are
 * different lengths and a colonnade whose end bay is a different width from
 * the rest reads as a mistake from anywhere on the map.
 */
function stations(half: number, bays: number, gap: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= bays; i++) {
    const u = -half + (i * half * 2) / bays;
    if (Math.abs(u) < gap / 2 - 0.01) continue;
    out.push(u);
  }
  return out;
}

/**
 * A wall running along Z with a doorway punched through it — `Build.doorWall`
 * with the axes swapped, which that method cannot do because it takes a width
 * along X. The barn hand-rolled this once; the manor needs it four times.
 *
 * `gapAt` offsets the opening along the run, and the two jambs are then
 * measured rather than mirrored. `Build.doorWall` has no equivalent because
 * nothing has needed one; the west elevation does, since the grand stair owns
 * every metre of that wall but the bay north of its head (`WEST_DOOR_Z`).
 */
function doorWallZ(
  b: Build,
  t: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
  gapDepth: number,
  gapHeight: number,
  gapAt = 0,
): void {
  const gap = z + gapAt;
  for (const [from, to] of [
    [z - d / 2, gap - gapDepth / 2],
    [gap + gapDepth / 2, z + d / 2],
  ]) {
    if (to - from > 0.05) b.wall(t, h, to - from, x, y, (from + to) / 2, color);
  }
  const lintel = h - gapHeight;
  if (lintel > 0.05) {
    b.wall(t, lintel, gapDepth, x, y + h / 2 - lintel / 2, gap, color);
  }
}

/**
 * A tall shuttered opening in one wall, with its louvred leaves thrown back
 * against the elevation either side.
 *
 * `wall` is the coordinate of the wall's outer plane on the facing's axis and
 * `u` is the position along it, so the same call sites work on all four
 * elevations; `sill` is the opening's bottom, measured from the structure's
 * own origin like everything else here.
 */
function shutteredWindow(
  b: Build,
  facing: Facing,
  wall: number,
  u: number,
  sill: number,
  w: number,
  h: number,
  lit: boolean,
): void {
  const flat = facing === "-z" || facing === "+z";
  const n = facing === "+z" || facing === "+x" ? 1 : -1;
  /** A box `a` along the wall, `t` through it, `o` proud of the outer face. */
  const put = (
    a: number,
    bh: number,
    t: number,
    du: number,
    y: number,
    o: number,
    color: string,
  ): void => {
    if (flat) b.box(a, bh, t, u + du, y, wall + n * o, color);
    else b.box(t, bh, a, wall + n * o, y, u + du, color);
  };
  const mid = sill + h / 2;

  // The opening: a dark reveal, or a warm pane when the house is still lit.
  if (lit) {
    if (flat) b.glow(w - 0.3, h - 0.3, 0.08, u, mid, wall + n * 0.03, WINDOW);
    else b.glow(0.08, h - 0.3, w - 0.3, wall + n * 0.03, mid, u, WINDOW);
  } else {
    put(w - 0.3, h - 0.3, 0.08, 0, mid, 0.03, REVEAL);
  }
  // Frame: two jambs, a head, and a sill board standing proud of the render.
  for (const s of [-1, 1]) put(0.14, h, 0.18, (s * (w - 0.14)) / 2, mid, 0.06, TEAK);
  put(w, 0.16, 0.18, 0, sill + h - 0.08, 0.06, TEAK);
  put(w + 0.34, 0.14, 0.34, 0, sill - 0.07, 0.12, TEAK);
  // Louvred leaves, folded flat to the wall.
  for (const s of [-1, 1]) {
    const du = s * (w / 2 + w * 0.23);
    put(w * 0.44, h - 0.24, 0.1, du, mid, 0.16, TEAK);
    for (let i = 0; i < 3; i++) {
      put(w * 0.38, 0.07, 0.15, du, sill + 0.45 + i * ((h - 1.1) / 2), 0.19, DARK_STONE);
    }
  }
}

/**
 * The dressing on one run of gallery parapet: a coping, a plinth, pilasters
 * and the weathered panel between them.
 *
 * It is a PARAPET rather than the turned balustrade a veranda wants, and that
 * is `Build.guard`'s decision rather than a taste one: a guard is a solid box
 * the full height of the rail, because a rail you can walk through is a fall,
 * and it stands outboard of the deck because a 0.16 m rail sampled by a 1.5 m
 * nav grid costs whichever cell it lands in. Balusters drawn at that offset
 * are simply inside it and invisible — measured, on the first pass. So the
 * detail goes on the faces of the box that is already there.
 *
 * VISUAL ONLY. The `guard` beside each call is the solid half, and a collider
 * here would put the walked surface back under the rail.
 */
function balustrade(
  b: Build,
  side: Facing,
  edge: number,
  from: number,
  to: number,
  surface: number,
  height: number,
): void {
  const alongZ = side === "-x" || side === "+x";
  const n = side === "+x" || side === "+z" ? 1 : -1;
  const off = edge + (n * GUARD_THICKNESS) / 2;
  /** A box `a` along the run and `t` through it, centred on the parapet. */
  const put = (
    a: number,
    bh: number,
    t: number,
    u: number,
    y: number,
    color: string,
  ): void => {
    if (alongZ) b.box(t, bh, a, off, y, u, color);
    else b.box(a, bh, t, u, y, off, color);
  };
  const length = to - from;
  put(length, 0.14, GUARD_THICKNESS + 0.18, (from + to) / 2, surface + height + 0.04, TEAK);
  put(length, 0.18, GUARD_THICKNESS + 0.12, (from + to) / 2, surface + 0.09, TEAK);
  const bays = Math.max(1, Math.round(length / 1.7));
  for (let i = 0; i <= bays; i++) {
    put(0.26, height, GUARD_THICKNESS + 0.14, from + (i * length) / bays, surface + height / 2, TEAK);
  }
  for (let i = 0; i < bays; i++) {
    const u = from + ((i + 0.5) * length) / bays;
    put(length / bays - 0.36, height - 0.52, GUARD_THICKNESS + 0.06, u, surface + height / 2, MOSS_STONE);
  }
}

/**
 * Per-strip variation for `creeperBay`: what share of its pitch a strip fills,
 * how far below the band's head it starts, and how far short of the band's
 * foot it stops. Five entries so a bay of any width comes out uneven, and a
 * table rather than a generator because world-building may not draw a random
 * number outside `MapBuilder`'s seeded stream (`rng.ts`).
 */
const VINE = [
  [0.92, 0.0, 0.0],
  [0.58, 0.85, 1.3],
  [0.8, 0.3, 0.45],
  [0.5, 1.5, 2.4],
  [0.72, 0.55, 0.15],
] as const;

/**
 * Vine over one blank bay of one storey's elevation, as a run of ragged
 * strips: `face` is the wall's outer plane, `n` its outward sign, `z0`/`z1`
 * the bay, and `foot`/`head` the band it may grow in. `mat` adds the thicker
 * pad under the eave that the strips appear to hang from.
 */
function creeperBay(
  b: Build,
  face: number,
  n: -1 | 1,
  z0: number,
  z1: number,
  foot: number,
  head: number,
  mat: boolean,
): void {
  const width = z1 - z0;
  const strips = Math.max(2, Math.round(width / 0.8));
  const pitch = width / strips;
  for (let i = 0; i < strips; i++) {
    const [fill, drop, rise] = VINE[i % VINE.length];
    const top = head - drop;
    const bottom = foot + rise;
    if (top - bottom < 0.5) continue;
    b.box(0.14, top - bottom, pitch * fill, face + n * 0.07, (top + bottom) / 2, z0 + (i + 0.5) * pitch, CREEPER);
  }
  if (mat) {
    b.box(0.22, 0.85, width * 0.78, face + n * 0.11, head - 0.42, (z0 + z1) / 2, CREEPER);
  }
}

/**
 * A fireplace set into the east wall of whichever storey it is given: the
 * breast, a RECESSED firebox with the fire standing inside it, the hearth in
 * front, and the mantel. Returns the top of that mantel, which is where the
 * flue carries on from.
 *
 * **The recess is the entire feature**, and `buildSmithy` already records the
 * lesson from the other side — coals hung on the FACE of the masonry read as a
 * lit panel rather than a fire. This shipped as exactly that: one glow plate
 * 0.02 m proud of a plain stone box, which is a glowing rectangle stuck on
 * what looks like a wall. Two jambs, a lintel across them and a sooted back
 * set behind give the flame somewhere to BE, so the light falls out of an
 * opening instead of being painted on a surface. The fire itself then sits on
 * the hearth inside, never on the front plane.
 *
 * The hearth is a 0.5 m box placed by its TOP face rather than the slab it
 * looks like, for the reason `boardDeck` documents: a thin flat thing walked
 * over at a grazing angle loses the depth fight with its own outline shell and
 * comes back painted in its own ink.
 *
 * One collider for the whole breast — the firebox is 1.35 x 0.62 m and nothing
 * can stand in it, so modelling the recess as a hole would only cost the nav
 * grid a surface candidate for a hollow nobody can occupy.
 */
function fireplace(
  b: Build,
  opts: {
    /** Position along the east wall. */
    z: number;
    /** The walked surface this storey stands on. */
    floor: number;
    /** Breast: along the wall, into the room, and up to the mantel. */
    w: number;
    depth: number;
    height: number;
    /** The opening in it. */
    openW: number;
    openH: number;
    openD: number;
    lit: boolean;
  },
): number {
  const { z, floor, w, depth, height, openW, openH, openD, lit } = opts;
  const inner = CW / 2 - T / 2;
  const x = inner - depth / 2;
  const face = inner - depth;
  const jamb = (w - openW) / 2;
  /** Where the fire stands: on the hearth, well inside the opening. */
  const fireX = face + openD * 0.45;

  b.block({ w: depth, h: height, d: w, x, y: floor + height / 2, z });
  for (const s of [-1, 1]) {
    b.box(depth, height, jamb, x, floor + height / 2, z + (s * (openW + jamb)) / 2, STONE);
  }
  b.box(depth, height - openH, openW, x, floor + (openH + height) / 2, z, STONE);
  b.box(depth - openD, openH, openW, x + openD / 2, floor + openH / 2, z, DARK_STONE);
  const hearth = 0.5;
  b.box(depth * 0.7, hearth, w + 0.4, face - depth * 0.35, floor + 0.06 - hearth / 2, z, DARK_STONE);
  b.box(openD * 0.7, 0.12, openW - 0.4, fireX, floor + 0.06, z, DARK_STONE);
  if (lit) {
    for (const s of [-1, 1]) {
      b.box(openD * 0.55, 0.14, 0.14, fireX, floor + 0.16, z + s * 0.2, TEAK);
    }
    b.glow(openD * 0.6, 0.16, openW - 0.5, fireX, floor + 0.2, z, EMBER);
    b.glow(openD * 0.4, openH * 0.42, openW * 0.55, fireX, floor + 0.2 + openH * 0.22, z, FLAME);
    // In FRONT of the opening and above the bed, so the breast and the boards
    // are what the fire lights rather than the back of its own firebox. A
    // hearth is not a forge: at `buildSmithy`'s 2.3 it washed the hall's
    // render out to white and the hearth stone with it.
    b.light(EMBER, 13, 1.4, 0.5, face - 0.4, floor + openH * 0.6, z);
  }
  const mantel = 0.22;
  b.box(depth + 0.34, mantel, w + 0.4, x - 0.17, floor + height + mantel / 2, z, DARK_STONE);
  return floor + height + mantel;
}

/**
 * The boarded top of the podium, drawn 0.04 above the walked surface.
 *
 * Deep rather than thin, and the caller's header owns why: a thin flat box
 * loses a depth fight with its own outline shell at grazing angles and comes
 * back painted in its own ink. Visual only — the podium's collider is the
 * walked surface, and a second one here would stack a nav surface 4 cm above
 * it for nothing.
 */
function boardDeck(b: Build, w: number, d: number, x: number, z: number): void {
  const h = POD + 0.14;
  b.box(w, h, d, x, POD + 0.04 - h / 2, z, PLANK);
}

/**
 * The manor: stucco over a stone podium, a colonnaded veranda on both storeys,
 * a copper roof gone green, and as much of the forest growing over it as the
 * silhouette will take.
 *
 * Fixed geometry apart from `litWindows`, for the same reason the tavern and
 * the chapel are: the plan, the stair runs, the stairwell void and the
 * colonnade's bay spacing are all solved against one another, and a width
 * spinner would break three of them silently.
 */
export function buildJungleManor(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "manor");
  const lit = p.litWindows ?? false;

  // --- podium ---------------------------------------------------------------
  // A shallow apron round a taller base course. Both are colliders and both
  // steps are inside `stepHeight`, so the whole thing links to the ground on
  // every bearing; `addSurface` merges the two into one nav surface anyway,
  // since 0.18 and 0.4 are less than HEIGHT_EPS apart.
  b.wall(FW + 2.2, 0.18, FD + 2.2, 0, 0.09, 0, MOSS_STONE);
  b.wall(FW + 0.5, POD - 0.08, FD + 0.5, 0, (POD - 0.08) / 2, 0, DARK_STONE);
  // The walked surface, as a collider with no geometry of its own: the boards
  // below ARE the podium's visible top, so a stone box here would be a second
  // up-facing surface on almost the same plane in a different colour, which is
  // the taproom flicker `buildTavern` documents.
  b.block({ w: FW, h: POD, d: FD, x: 0, y: POD / 2, z: 0 });
  // Boards over the stone base, hall and veranda alike, standing 0.04 proud of
  // the collider — the board thickness showing, and what the ground probe
  // walks 4 cm under.
  //
  // **The box is as DEEP as the podium, not as deep as the boards look.** A
  // 0.14 m slab here rendered its own outline ink over the entire hall floor
  // and read as a black void: `OutlineRenderer` draws the ink shell with a
  // NEGATIVE z-offset, which is slope-scaled, and at the grazing angle a floor
  // is seen from that bias is enormous — so the shell's underside, only
  // `h + outlineWidth` behind the real top face, wins the depth test. Thick
  // enough and it cannot: the same floor at 0.5 m deep puts its shell 0.55 m
  // back and renders clean. Nothing announces this; the surface simply comes
  // back as `outlineInkFor` of its own colour.
  boardDeck(b, FW, FD, 0, 0);
  // Under the portico, and the one flight of steps up to the front door.
  b.block({ w: PORTICO_HW * 2 + 1.2, h: POD, d: PORTICO_OUT + 0.4, x: 0, y: POD / 2, z: PORTICO_Z });
  boardDeck(b, PORTICO_HW * 2 + 1.2, PORTICO_OUT + 0.4, 0, PORTICO_Z);
  b.wall(PORTICO_HW * 2 + 2, 0.2, 0.55, 0, 0.1, -FD / 2 - PORTICO_OUT - 0.47, MOSS_STONE);

  // --- ground storey --------------------------------------------------------
  // Walls are centred on the footprint lines, so the interior runs to ±10.8
  // in X and ±7.3 in Z. Every opening is at least 1.8 m: `CONFIG.nav.bodyRadius`
  // is 0.4, and the narrowest thing a bot can be trusted through is the 1.6 m
  // the cottages use.
  const gy = POD + GROUND / 2;
  b.doorWall(CW, GROUND, T, 0, gy, -CD / 2, STUCCO, 3.2, 2.9);
  b.doorWall(CW, GROUND, T, 0, gy, CD / 2, STUCCO, 2, 2.5);
  doorWallZ(b, T, GROUND, CD, -CW / 2, gy, 0, STUCCO, 2, 2.5, WEST_DOOR_Z);
  doorWallZ(b, T, GROUND, CD, CW / 2, gy, 0, STUCCO, 2, 2.5);

  // Cross partition at the back of the hall, open where the stair runs through
  // it: the flight spans z -6.0 to 4.8 and a wall in that lane would be a
  // handrail you cannot walk past.
  const PART_Z = 2;
  b.wall(5.4, GROUND, 0.3, -4.3, gy, PART_Z, STUCCO);
  b.wall(9.4, GROUND, 0.3, 6.3, gy, PART_Z, STUCCO);
  b.wall(3.2, GROUND - 2.4, 0.3, 0, POD + 2.4 + (GROUND - 2.4) / 2, PART_Z, STUCCO);
  // Two columns carrying the floor over the hall. Cover a body can actually
  // use, which is the only reason they are colliders and not dressing.
  for (const s of [-1, 1]) {
    b.wall(0.44, GROUND, 0.44, s * 3.6, gy, -3, TEAK);
    b.box(0.62, 0.2, 0.62, s * 3.6, POD + GROUND - 0.1, -3, TEAK);
  }
  // The hall's fireplace is NOT emitted here, with the storey it stands in —
  // see the chimney block below the upper floor, and the header for why.

  // --- ground colonnade -----------------------------------------------------
  // Masonry piers at the veranda's outer edge, carrying the gallery above.
  // Their tops land a slab's thickness under the deck, which `addSurface`
  // merges into it rather than inventing a second surface per bay.
  const PIER = 0.55;
  const pierX = FW / 2 - 0.3;
  const pierZ = FD / 2 - 0.3;
  const frontBays = stations(pierX, 8, 7.5);
  const backBays = stations(pierX, 8, 4);
  const flankBays = stations(pierZ, 6, 4).filter((z) => Math.abs(z) < pierZ - 0.01);
  /**
   * The east flank drops the bay the service landing arrives in, exactly as
   * the front drops the entrance bay and for the same reason. The gallery rail
   * is already broken across the landing so a body can step off the flight,
   * and the station at z = -6.8 stood 0.2 m off the CENTRE of that 3 m
   * opening — a post in the one doorway off the stair, with its 0.42 m base
   * block sitting on the deck to trip over as well.
   */
  const inLandingBay = (z: number): boolean =>
    z > LANDING_Z - LANDING_D / 2 - 0.6 && z < SERVICE_TOP_Z + 0.6;
  const piers: [number, number][] = [
    ...frontBays.map((x): [number, number] => [x, -pierZ]),
    ...backBays.map((x): [number, number] => [x, pierZ]),
    ...flankBays.flatMap((z): [number, number][] =>
      inLandingBay(z)
        ? [[-pierX, z]]
        : [
            [-pierX, z],
            [pierX, z],
          ],
    ),
    [-PORTICO_HW + 0.2, -FD / 2 - PORTICO_OUT + 0.3],
    [PORTICO_HW - 0.2, -FD / 2 - PORTICO_OUT + 0.3],
  ];
  for (const [px, pz] of piers) {
    b.wall(PIER, GROUND, PIER, px, gy, pz, STUCCO);
    b.box(PIER + 0.22, 0.26, PIER + 0.22, px, POD + 0.13, pz, DARK_STONE);
    b.box(PIER + 0.26, 0.22, PIER + 0.26, px, POD + GROUND - 0.11, pz, STONE);
  }

  // --- upper floor ----------------------------------------------------------
  // Three slabs round the stairwell void, then the gallery ring outside them.
  // Same colour as the ring, so the coplanar joins merge into one mesh and
  // cannot z-fight (see buildTavern for the version that does).
  const slabY = DECK - SLAB / 2;
  const slab = (w: number, d: number, x: number, z: number): void => {
    b.box(w, SLAB, d, x, slabY, z, PLANK);
    b.block({ w, h: SLAB, d, x, y: slabY, z });
  };
  /** East of the void: the whole depth of the core, in one piece. */
  slab(CW / 2 - VOID_X, CD, (VOID_X + CW / 2) / 2, 0);
  /** West of it, the two strips the void leaves — south of it and north of it. */
  const westW = VOID_X + CW / 2;
  const westX = -CW / 2 + westW / 2;
  slab(westW, VOID_Z0 + CD / 2, westX, (-CD / 2 + VOID_Z0) / 2);
  slab(westW, CD / 2 - GRAND_TOP_Z, westX, (GRAND_TOP_Z + CD / 2) / 2);
  for (const [w, d, x, z] of [
    [FW, VER, 0, -(CD + VER) / 2],
    [FW, VER, 0, (CD + VER) / 2],
    [VER, CD, -(CW + VER) / 2, 0],
    [VER, CD, (CW + VER) / 2, 0],
    // The portico balcony, breaking forward of the south gallery.
    [PORTICO_HW * 2, PORTICO_OUT, 0, PORTICO_Z],
    // The service stair's landing, meeting the east gallery edge on at 4.15.
    [SERVICE_X + SERVICE_W / 2 - CW / 2 - VER, LANDING_D, (FW / 2 + SERVICE_X + SERVICE_W / 2) / 2, LANDING_Z],
  ] as const) {
    slab(w, d, x, z);
  }
  // A fascia board hiding the slab's cut edge all round the gallery. ONE per
  // side: the first pass ran nine joists at 0.7 m across a 3 m veranda, which
  // is not a joist course but a second, deeper floor, and from outside it read
  // as a metre-thick brown band swallowing the whole balustrade above it.
  for (const s of [-1, 1]) {
    b.box(FW + 0.4, 0.34, 0.2, 0, DECK - SLAB + 0.02, (s * (FD + 0.2)) / 2, TEAK);
    b.box(0.2, 0.34, FD + 0.4, (s * (FW + 0.2)) / 2, DECK - SLAB + 0.02, 0, TEAK);
  }
  b.box(PORTICO_HW * 2 + 0.4, 0.34, 0.2, 0, DECK - SLAB + 0.02, -FD / 2 - PORTICO_OUT - 0.1, TEAK);

  // --- the chimney ----------------------------------------------------------
  // One flue, two hearths on it, and it comes out of the roof over its own
  // fireplaces. Deliberately emitted HERE rather than with the hall the lower
  // one stands in: `NavGrid` keeps three surfaces per cell and DROPS the
  // fourth, so with the breast built first a cell inside the chimney's
  // footprint would hold the terrain, the podium and the breast's top, and the
  // upper floor — the thing anything actually walks on — would be the one
  // thrown away. Same rule as the roofs; see the header.
  const FIRE_Z = -4.6;
  const FLUE_D = 1.0;
  const FLUE_W = 1.8;
  const FLUE_X = CW / 2 - T / 2 - FLUE_D / 2;
  const hallMantel = fireplace(b, {
    z: FIRE_Z,
    floor: POD,
    w: 2.6,
    depth: 1.5,
    height: 2.1,
    openW: 1.35,
    openH: 1.25,
    openD: 0.62,
    lit,
  });
  b.wall(FLUE_D, DECK - hallMantel, FLUE_W, FLUE_X, (hallMantel + DECK) / 2, FIRE_Z, STONE);
  const upperMantel = fireplace(b, {
    z: FIRE_Z,
    floor: DECK,
    w: 2.1,
    depth: 1.2,
    height: 1.75,
    openW: 1.0,
    openH: 0.95,
    openD: 0.5,
    lit,
  });
  // Brick from the upper mantel up — the flue leaving the render, and the one
  // stack on this roof. It stops bullets while it is in a room and is visual
  // only once it is in the roof void, where nothing can reach it anyway.
  const STACK_TOP = EAVE + 2.9;
  b.wall(FLUE_D, EAVE - upperMantel, FLUE_W, FLUE_X, (upperMantel + EAVE) / 2, FIRE_Z, BRICK);
  b.box(FLUE_D, STACK_TOP - EAVE, FLUE_W, FLUE_X, (EAVE + STACK_TOP) / 2, FIRE_Z, BRICK);
  b.box(FLUE_D + 0.35, 0.24, FLUE_W + 0.35, FLUE_X, STACK_TOP + 0.12, FIRE_Z, DARK_STONE);

  // --- upper storey ---------------------------------------------------------
  const uy = DECK + UPPER / 2;
  b.doorWall(CW, UPPER, T, 0, uy, -CD / 2, STUCCO, 2.6, 2.5);
  b.doorWall(CW, UPPER, T, 0, uy, CD / 2, STUCCO, 1.8, 2.4);
  doorWallZ(b, T, UPPER, CD, -CW / 2, uy, 0, STUCCO, 1.8, 2.4);
  doorWallZ(b, T, UPPER, CD, CW / 2, uy, 0, STUCCO, 1.8, 2.4);
  // One partition upstairs, so the floor is two rooms rather than a shed.
  b.wall(CW / 2 - VOID_X - 3.2, UPPER, 0.28, (VOID_X + CW / 2) / 2 + 1.6, uy, PART_Z, STUCCO);
  // The stairwell's own lip, running the VOID's length and not a metre more.
  // It was `CD - GRAND_TOP_Z + |VOID_Z0|`, which is 12.6 against a void 7.2
  // long — a mis-derivation that overshot 2.7 m at each end, and the north
  // overshoot ran straight across the head of the flight: a knee-high wall
  // shutting the landing off from the floor it exists to reach.
  //
  // VISUAL ONLY, exactly as the barn's loft edge is: the drop into the hall is
  // the gallery's second exit and the thing you fire down through, and a
  // collider here is a rail you can neither cross nor shoot over.
  b.box(0.16, 0.55, GRAND_TOP_Z - VOID_Z0, VOID_X, DECK + 0.28, (VOID_Z0 + GRAND_TOP_Z) / 2, TEAK);
  b.box(westW, 0.55, 0.16, westX, DECK + 0.28, VOID_Z0, TEAK);

  // Slender turned columns over each pier, carrying the eaves. SOLID, like the
  // piers they stand on: the gallery is a ring people fight along, and a column
  // you walk through — and shoot through — on the upper storey while the
  // identical one below stops both is the sort of disagreement that reads as a
  // hitscan bug. 0.3 m against a 3 m deck leaves the ring two cells wide.
  for (const [px, pz] of piers) {
    b.wall(0.3, UPPER, 0.3, px, uy, pz, TEAK);
    b.box(0.42, 0.16, 0.42, px, DECK + 0.08, pz, TEAK);
    b.box(0.46, 0.2, 0.46, px, EAVE - 0.1, pz, TEAK);
  }

  // --- the gallery balustrade -----------------------------------------------
  // `guard` is the solid half and stands outboard of the deck; `balustrade`
  // is the look. Two gaps, both deliberate: the portico balcony breaks the
  // south run, and the service landing breaks the east one.
  const railH = 1.1;
  const rail = (side: Facing, edge: number, from: number, to: number): void => {
    // Rendered, like the walls: the parapet is masonry and the teak is the
    // coping and pilasters `balustrade` stands on it.
    b.guard(side, edge, (from + to) / 2, to - from, DECK, {
      height: railH,
      color: STUCCO,
    });
    balustrade(b, side, edge, from, to, DECK, railH);
  };
  rail("-z", -FD / 2, -FW / 2, -PORTICO_HW);
  rail("-z", -FD / 2, PORTICO_HW, FW / 2);
  rail("+z", FD / 2, -FW / 2 - GUARD_THICKNESS, FW / 2 + GUARD_THICKNESS);
  rail("-x", -FW / 2, -FD / 2, FD / 2);
  rail("+x", FW / 2, -FD / 2, LANDING_Z - LANDING_D / 2);
  rail("+x", FW / 2, SERVICE_TOP_Z, FD / 2);
  // Round the portico balcony.
  rail("-z", -FD / 2 - PORTICO_OUT, -PORTICO_HW - GUARD_THICKNESS, PORTICO_HW + GUARD_THICKNESS);
  rail("-x", -PORTICO_HW, -FD / 2 - PORTICO_OUT, -FD / 2);
  rail("+x", PORTICO_HW, -FD / 2 - PORTICO_OUT, -FD / 2);

  // --- the two stairs -------------------------------------------------------
  b.flight({
    x: GRAND_X,
    w: GRAND_W,
    topZ: GRAND_TOP_Z,
    topY: DECK,
    run: GRAND_RUN,
    rise: GRAND_RISE,
    dir: 1,
    steps: 22,
    color: PLANK,
  });
  // Its outer handrail. The wall side needs none, and the run starts where the
  // flight leaves the podium rather than at the newel. A capping board rides
  // the top of the solid part at the same pitch — a `guard` is a parapet, and
  // a parapet without a coping reads as a wall someone forgot to finish.
  const grandPitch = Math.atan(GRAND_GRADE);
  const grandMidZ = (GRAND_FOOT_Z + GRAND_TOP_Z) / 2;
  b.guard("+x", GRAND_X + GRAND_W / 2, grandMidZ, GRAND_RUN, POD + GRAND_RISE / 2, {
    pitch: grandPitch,
    height: railH,
    color: STUCCO,
  });
  b.box(
    GUARD_THICKNESS + 0.16,
    0.13,
    GRAND_RUN / Math.cos(grandPitch),
    GRAND_X + GRAND_W / 2 + GUARD_THICKNESS / 2,
    POD + GRAND_RISE / 2 + railH + 0.04,
    grandMidZ,
    TEAK,
    { x: -grandPitch },
  );

  b.flight({
    x: SERVICE_X,
    w: SERVICE_W,
    topZ: SERVICE_TOP_Z,
    topY: DECK,
    run: SERVICE_RUN,
    rise: DECK + SERVICE_DROP,
    dir: -1,
    steps: 26,
    color: PLANK,
  });
  // Rails from where it comes out of the ground, not from its buried foot.
  const svcFootZ = SERVICE_TOP_Z + DECK / SERVICE_GRADE;
  const svcMidZ = (SERVICE_TOP_Z + svcFootZ) / 2;
  const svcMidY = DECK - (svcMidZ - SERVICE_TOP_Z) * SERVICE_GRADE;
  for (const side of ["-x", "+x"] as const) {
    const s = side === "+x" ? 1 : -1;
    // Negative: `guard` reads a pitch as rising toward +Z, and this flight
    // descends that way — it climbs from the north end down to the landing.
    b.guard(side, SERVICE_X + (s * SERVICE_W) / 2, svcMidZ, svcFootZ - SERVICE_TOP_Z, svcMidY, {
      pitch: -Math.atan(SERVICE_GRADE),
      height: railH,
      color: PLANK,
    });
    b.box(
      GUARD_THICKNESS + 0.14,
      0.12,
      (svcFootZ - SERVICE_TOP_Z) / Math.cos(Math.atan(SERVICE_GRADE)),
      SERVICE_X + (s * (SERVICE_W + GUARD_THICKNESS)) / 2,
      svcMidY + railH + 0.04,
      svcMidZ,
      TEAK,
      { x: Math.atan(SERVICE_GRADE) },
    );
  }
  // Trestles under the span, and round the landing.
  for (const i of [1, 2, 3]) {
    const z = SERVICE_TOP_Z + (i * (svcFootZ - SERVICE_TOP_Z)) / 4;
    const hgt = DECK - (z - SERVICE_TOP_Z) * SERVICE_GRADE - 0.36;
    if (hgt < 0.5) continue;
    for (const s of [-1, 1]) {
      const px = SERVICE_X + s * (SERVICE_W / 2 - 0.2);
      b.box(0.24, hgt, 0.24, px, hgt / 2, z, TEAK);
      b.block({ w: 0.32, h: hgt, d: 0.32, x: px, y: hgt / 2, z });
    }
    b.box(SERVICE_W, 0.16, 0.16, SERVICE_X, hgt - 0.08, z, TEAK);
  }
  for (const s of [-1, 1]) {
    const px = SERVICE_X + s * (SERVICE_W / 2);
    b.box(0.28, DECK - SLAB, 0.28, px, (DECK - SLAB) / 2, LANDING_Z - LANDING_D / 2 + 0.3, TEAK);
    b.block({ w: 0.36, h: DECK - SLAB, d: 0.36, x: px, y: (DECK - SLAB) / 2, z: LANDING_Z - LANDING_D / 2 + 0.3 });
  }
  const landX = (FW / 2 + SERVICE_X + SERVICE_W / 2) / 2;
  const landW = SERVICE_X + SERVICE_W / 2 - FW / 2;
  b.guard("+x", SERVICE_X + SERVICE_W / 2, LANDING_Z, LANDING_D + GUARD_THICKNESS * 2, DECK, {
    height: railH,
    color: PLANK,
  });
  balustrade(b, "+x", SERVICE_X + SERVICE_W / 2, LANDING_Z - LANDING_D / 2, LANDING_Z + LANDING_D / 2, DECK, railH);
  b.guard("-z", LANDING_Z - LANDING_D / 2, landX, landW, DECK, {
    height: railH,
    color: PLANK,
  });
  balustrade(b, "-z", LANDING_Z - LANDING_D / 2, FW / 2, SERVICE_X + SERVICE_W / 2, DECK, railH);

  // --- windows --------------------------------------------------------------
  // Ground-floor openings look onto the covered veranda; the upper ones onto
  // the gallery. Neither is a firing port — the gallery itself is the firing
  // position, and these are what stop the elevations reading as blank render.
  // `shutteredWindow` is given the wall's outer FACE, not the footprint line
  // the wall is centred on: at 0.4 m thick that is 0.2 m out, and everything
  // the helper stands proud of the render — frame, sill, leaves — is inside
  // half a metre of it.
  const southFace = -(CD / 2 + T / 2);
  const northFace = CD / 2 + T / 2;
  const westFace = -(CW / 2 + T / 2);
  const eastFace = CW / 2 + T / 2;
  for (const u of [-8.4, -4.6, 4.6, 8.4]) {
    shutteredWindow(b, "-z", southFace, u, POD + 0.9, 1.5, 2.1, lit);
    shutteredWindow(b, "-z", southFace, u, DECK + 0.8, 1.5, 2.0, lit);
  }
  for (const u of [-7.6, 7.6]) {
    shutteredWindow(b, "+z", northFace, u, POD + 0.9, 1.5, 2.1, false);
    shutteredWindow(b, "+z", northFace, u, DECK + 0.8, 1.5, 2.0, lit);
  }
  // The two flanks are NOT a matching pair, and neither missing bay is a
  // saving. The west ground storey's +4.8 bay is where the stair hall's door
  // had to go (`WEST_DOOR_Z`, and a shuttered opening is 2.85 m wide with its
  // leaves thrown back, so the two would overlap). Both east bays at -4.8 are
  // the chimney: a lit pane in front of 1.5 m of breast is a window into
  // masonry, with this roof's one stack standing directly over it.
  for (const u of [-4.8, 4.8]) {
    shutteredWindow(b, "-x", westFace, u, DECK + 0.8, 1.5, 2.0, false);
  }
  shutteredWindow(b, "-x", westFace, -4.8, POD + 0.9, 1.5, 2.1, false);
  shutteredWindow(b, "+x", eastFace, 4.8, POD + 0.9, 1.5, 2.1, lit);
  shutteredWindow(b, "+x", eastFace, 4.8, DECK + 0.8, 1.5, 2.0, lit);

  // --- roofs ----------------------------------------------------------------
  // LAST, and the header says why: `NavGrid` keeps three surfaces per cell and
  // DROPS the fourth candidate rather than sorting it in, so a roof emitted
  // early takes the gallery's slot.
  //
  // The main roof is hand-rolled rather than `gableRoof`d because that method
  // always runs its ridge along Z, and a manor presents its long eave to the
  // front: this one's ridge is along X, so the slabs pitch about X and the two
  // gable panels are turned a quarter into place.
  const slopeD = CD / 2 + ROOF_EAVE_OVER;
  const roofPitch = Math.atan2(ROOF_RISE, slopeD);
  for (const s of [-1, 1]) {
    b.box(
      CW + ROOF_EAVE_OVER * 2,
      0.2,
      Math.hypot(slopeD, ROOF_RISE),
      0,
      EAVE + ROOF_RISE / 2,
      (s * slopeD) / 2,
      VERDIGRIS,
      { x: s * roofPitch },
    );
    b.gableEnd(slopeD * 2, ROOF_RISE, 0.18, (s * CW) / 2, EAVE, 0, STUCCO).rotation.y =
      Math.PI / 2;
  }
  b.block({
    w: CW + ROOF_EAVE_OVER * 2,
    h: 0.3,
    d: CD + ROOF_EAVE_OVER * 2,
    x: 0,
    y: EAVE,
    z: 0,
  });

  // The veranda skirt: a shallower flare carried on the colonnade, so the eave
  // line steps rather than running one plane from ridge to rail.
  const SKIRT_DROP = 0.75;
  const skirtPitch = Math.atan2(SKIRT_DROP, VER + 0.7);
  const skirtLen = Math.hypot(VER + 0.7, SKIRT_DROP);
  for (const s of [-1, 1]) {
    b.box(FW + 1.4, 0.18, skirtLen, 0, EAVE - SKIRT_DROP / 2, (s * (CD + VER + 0.7)) / 2, VERDIGRIS, {
      x: s * skirtPitch,
    });
    b.block({ w: FW + 1.4, h: 0.26, d: VER + 0.7, x: 0, y: EAVE - SKIRT_DROP / 2, z: (s * (CD + VER + 0.7)) / 2 });
    b.box(skirtLen, 0.18, FD + 1.4, (s * (CW + VER + 0.7)) / 2, EAVE - SKIRT_DROP / 2, 0, VERDIGRIS, {
      z: -s * skirtPitch,
    });
    b.block({ w: VER + 0.7, h: 0.26, d: FD + 1.4, x: (s * (CW + VER + 0.7)) / 2, y: EAVE - SKIRT_DROP / 2, z: 0 });
  }

  // The portico's pediment, breaking the skirt line — the read from down the
  // approach, and `gableRoof`'s ridge along Z is exactly right for it.
  //
  // It needs the entablature under it. Without one the pediment is a wedge
  // hanging over a gap with the columns stopping short of it, which is what
  // the first pass looked like: the band is what the roof appears to sit on.
  b.box(PORTICO_HW * 2 + 1.0, 0.42, PORTICO_OUT + 0.9, 0, EAVE - 0.21, PORTICO_Z - 0.1, TEAK);
  b.box(PORTICO_HW * 2 + 1.3, 0.2, PORTICO_OUT + 1.2, 0, EAVE + 0.06, PORTICO_Z - 0.1, STUCCO);
  b.gableRoof(PORTICO_HW * 2 + 1.3, PORTICO_OUT + 1.0, 1.7, 0, EAVE + 0.16, PORTICO_Z, VERDIGRIS, 0.3);

  // Belvedere on the ridge. Visual only and unreachable on purpose: the
  // gallery is the perch this building is about, and a third level would need
  // a third stair, a third nav surface per cell and a reason to exist.
  const cupY = EAVE + ROOF_RISE;
  b.box(2.6, 0.24, 2.6, 0, cupY + 0.12, 0, PLANK);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.2, 1.5, 0.2, sx * 1.1, cupY + 0.99, sz * 1.1, TEAK);
    }
  }
  b.glow(1.3, 0.9, 1.3, 0, cupY + 0.95, 0, lit ? WINDOW : "#8fa3a8");
  b.cyl(1.3, 0.12, 3.1, 4, 0, cupY + 2.4, 0, VERDIGRIS);

  // Nothing else on the ridge. Two "service stacks" stood at the gable ends
  // here, and neither was a stack: each ran from y = 0 to the ridge as one
  // un-collidable `b.box` with no fireplace under it, so both stood INSIDE the
  // hall and the upper rooms as columns you walked through — and the west one
  // came up through the middle of the grand stair. The chimney above is the
  // real one; see the header.

  // --- what the forest has taken --------------------------------------------
  // Creeper is the whole point of the building being HERE rather than in a
  // village, and it is cheap: growth on the elevations, plus curtains hanging
  // off the eave where they catch the light against the fog.
  // Off the wall FACE, like the windows — a panel hung on the footprint line
  // is inside 0.2 m of render and invisible from anywhere but a doorway.
  //
  // Two rules on the flanks, both learned by breaking them:
  //
  // - **BLANK bays only.** These stand 0.07 proud of the render, so a panel
  //   over an opening is a green slab across the window's own frame, sill and
  //   thrown-back leaves — which is what all three used to be. A shuttered
  //   opening is 2.85 m wide (`w + 2 * (w * 0.23 + w * 0.44 / 2)`), so the bay
  //   at u carries a window from u - 1.425 to u + 1.425, and creeper may not
  //   enter it on EITHER storey — the panel is taller than both.
  // - **Never one sheet, and never through the gallery deck.** A single flat
  //   rectangle reads as a wall someone painted green from a metre away on the
  //   gallery, where a good deal of this building is fought; the silhouette is
  //   the whole effect, so the growth needs a ragged edge. And the upper floor
  //   is a solid slab out to the deck's edge, so one panel spanning both
  //   storeys is a vine growing through a floor: they are banded, veranda wall
  //   and gallery wall, with the slab between them left alone.
  for (const [face, n, z0, z1] of [
    [westFace, -1, -3.1, 3.1],
    [westFace, -1, -7.5, -6.4],
    [eastFace, 1, -7.4, -2.4],
  ] as const) {
    creeperBay(b, face, n, z0, z1, POD + 0.15, DECK - SLAB - 0.06, false);
    creeperBay(b, face, n, z0, z1, DECK + 0.1, EAVE - 0.45, true);
  }
  // A curtain over the rear eave, where it hangs against the fog.
  const eaveLip = FD / 2 + 0.62;
  b.box(6.4, 0.16, 0.14, -4.2, EAVE - SKIRT_DROP - 0.42, eaveLip, CREEPER);
  for (let i = 0; i < 9; i++) {
    const cx = -6.6 + i * 1.65;
    const drop = 0.9 + (i % 3) * 0.7;
    b.box(0.5, drop, 0.11, cx, EAVE - SKIRT_DROP - 0.5 - drop / 2, eaveLip, CREEPER);
  }
  for (const px of [-pierX, -pierX + 3.425, pierX]) {
    b.box(0.5, GROUND * 0.8, 0.15, px, POD + GROUND * 0.4, pierZ + PIER / 2 + 0.07, CREEPER);
  }
  // And on the front, which is the elevation the approach actually sees: two
  // piers and the column above one of them taken, and growth over the west
  // shoulder of the pediment. Without these the manor reads as maintained
  // from the one bearing most of a round is spent looking at it from.
  for (const px of [-pierX, pierX - 3.425]) {
    b.box(0.52, GROUND * 0.85, 0.15, px, POD + GROUND * 0.42, -pierZ - PIER / 2 - 0.07, CREEPER);
  }
  b.box(0.42, UPPER * 0.7, 0.15, -pierX, DECK + UPPER * 0.35, -pierZ - 0.2, CREEPER);
  b.box(2.6, 0.6, 0.14, -PORTICO_HW - 0.6, EAVE + 0.5, -FD / 2 - PORTICO_OUT - 0.5, CREEPER);
  for (let i = 0; i < 4; i++) {
    const drop = 0.7 + (i % 2) * 0.6;
    b.box(0.45, drop, 0.12, -PORTICO_HW - 1.5 + i * 0.6, EAVE + 0.2 - drop / 2, -FD / 2 - PORTICO_OUT - 0.5, CREEPER);
  }
  // Nothing on the roof slopes. Patches of CREEPER laid flat on them was the
  // obvious next move and is measurably wrong: the roof is the one large
  // surface here the key light hits square, so a dark green against a lit
  // copper reads as a HOLE punched through it, not as growth. Growth needs
  // something to hang off — a wall, a column, an eave — which is what
  // everything above is.
  // Moss creeping up out of the podium's own joints — the joint being the
  // 0.85 m of apron left standing outside the base course, which is the only
  // band on this footprint where a flat mat lies on ONE surface. The first
  // pass laid 1.6 m patches across both steps at once: buried in the course at
  // one edge, hanging 0.23 m over bare ground at the other.
  //
  // Broken into runs rather than laid as one strip, and for a reason peculiar
  // to a mat lying face up: `skyLightColor` is applied by `n.y` and never
  // gated by the shadow map, so a horizontal surface takes the hemispheric
  // term at full strength and CREEPER comes back pale. A long even rectangle
  // of it reads as a painted stripe on the podium; a run of unequal patches
  // reads as moss.
  const apron = FW / 2 + 1.1;
  for (const [mx, mz, mw, md] of [
    [-apron + 0.45, 4.2, 0.8, 5.5],
    [apron - 0.45, -6.0, 0.8, 4.2],
    [7.0, FD / 2 + 0.65, 6.0, 0.75],
  ] as const) {
    const alongZ = md > mw;
    const run = alongZ ? md : mw;
    const patches = Math.max(2, Math.round(run / 1.6));
    for (let i = 0; i < patches; i++) {
      const [fill, , inset] = VINE[i % VINE.length];
      const step = (run / patches) * fill;
      const u = (alongZ ? mz : mx) - run / 2 + ((i + 0.5) * run) / patches;
      const thin = (alongZ ? mw : md) * (0.55 + inset * 0.16);
      // Sunk into the apron with 0.03 standing proud, not laid on top of it as
      // a 0.1 m tile: a thin flat box walked over at a grazing angle loses the
      // depth fight with its own ink shell (`boardDeck`), and at the podium's
      // edge these read as three green paving slabs because of it.
      if (alongZ) b.box(thin, 0.36, step, mx, 0.03, u, CREEPER);
      else b.box(step, 0.36, thin, u, 0.03, mz, CREEPER);
    }
  }

  // --- lanterns -------------------------------------------------------------
  // Three, spread the length of the building: one over the portico and two in
  // the hall, which is 22 m long and would otherwise be lit at one end. They
  // hang a metre clear of the ceiling on their rods rather than tight up under
  // it — a point light 0.5 m from the boards above it and 2.9 m from the floor
  // below lights the ceiling and nothing else. Fixture lights compete
  // nearest-first for the sixteen slots, and with the two hearths that is FIVE
  // on one building — only affordable while it is the only lit structure on
  // the map, and the point at which a second lit building goes up nearby is
  // the point at which the hall's two lanterns come down to one.
  const lampY = DECK + 2.5;
  b.box(0.1, 0.1, 0.9, 0, lampY + 0.32, -FD / 2 - PORTICO_OUT + 0.45, IRON);
  b.cyl(0.62, 0.42, 0.3, 6, 0, lampY, -FD / 2 - PORTICO_OUT + 0.1, IRON);
  b.glow(0.3, 0.3, 0.3, 0, lampY, -FD / 2 - PORTICO_OUT + 0.1, FLAME);
  b.cyl(0.18, 0.1, 0.5, 6, 0, lampY + 0.4, -FD / 2 - PORTICO_OUT + 0.1, IRON);
  b.light(FLAME, 24, 2.0, 0.24, 0, lampY, -FD / 2 - PORTICO_OUT + 0.1);

  for (const [hx, hz] of [
    [-4, -2],
    [5, 3.5],
  ] as const) {
    b.cyl(0.5, 0.34, 0.26, 6, hx, POD + 2.3, hz, IRON);
    b.glow(0.26, 0.26, 0.26, hx, POD + 2.3, hz, FLAME);
    // Rod from the lantern's cap to the ceiling and no further: at 1.2 m it
    // ran 0.35 m past the boards and came out of the floor upstairs.
    const rod = DECK - SLAB - (POD + 2.55);
    b.box(0.06, rod, 0.06, hx, POD + 2.55 + rod / 2, hz, IRON);
    b.light(FLAME, 22, 2.4, 0.28, hx, POD + 2.3, hz);
  }

  return b;
}
