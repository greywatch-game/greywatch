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
 *
 * ## The masses are the colliders' and the detail is the drawing
 *
 * Every collider this building has is emitted exactly where and in the order
 * it always was, and nothing drawn here adds one — so a change to the drawing
 * owes no `npm run collision`, and a change to a `wall`, `block`, `guard`,
 * `flight`, `doorWall` or `doorWallZ` call does. Where the drawing had to part
 * company with a box, the `wall` is spelled out as `block` plus `box` with
 * the same numbers in the same order (the gallery columns, which now stop
 * under the veranda roof's plate), and where a `gableRoof` would have painted
 * its gables in copper its block is restated by hand as the last collider.
 *
 * Everything else obeys one of three rules: it is flat on a face, it is low
 * enough to walk over, or it is overhead — at least 2.4 m over the floor it
 * hangs above, which is where the arcade springs (`SPRING`). The one place the
 * drawing is SMALLER than a collider is the gallery column's head: the box
 * runs on 0.45 m above the veranda roof it now stops under, where nothing can
 * see it and a round aimed at a roof is not a round anyone fires.
 *
 * ## What it is drawn as
 *
 * An Anglo-Indian planter's house of the 1880s: brick under lime stucco on a
 * stone podium, a masonry arcade carrying a timber gallery, and a copper roof
 * gone green, in a forest that is taking it back.
 *
 * - **The ground storey is rusticated** — channelled bands of render with a
 *   stone skirting and a moulded cornice under the veranda ceiling — and **the
 *   upper storey is smooth**, divided by pilasters that stand wherever two
 *   openings leave room, under a cornice and the wall plate the veranda
 *   rafters bear on.
 * - **The veranda is an arcade.** Elliptical arches spring from moulded
 *   imposts on the piers at `SPRING`, a band of render round each with a
 *   keystone at its crown, and a stucco floor band over them where a plank
 *   fascia used to be. Cross beams run from every pier back to the wall under
 *   the gallery floor. The spandrels are surfaces rather than boxes
 *   (`Sheet`), because an arch drawn in boxes is a staircase and one drawn in
 *   a box per slice is 36 vertices a slice.
 * - **The gallery is a colonnade under a hipped lean-to**: the columns stand on
 *   bases and carry a plate on knee braces, the rafters run from the wall
 *   plate over it to a copper gutter, and the roof over them is four solids
 *   meeting on hips — it was four boxes crossing at every corner with the
 *   column heads standing up through them. The parapet is the balustrade it
 *   stands for: stucco balusters in relief on a dark ground, which from the
 *   approach reads as a pierced rail and to a round is still solid.
 * - **The windows are sashes** — four lights a sash in a frame, a stucco
 *   architrave with a keystone, a sill on consoles — with louvred shutters in
 *   the gallery's green thrown back beside them, some hanging off one hinge
 *   and the odd one gone. Every one has its inside too: a lit hall with no
 *   windows in it was the other half of what read as a box.
 * - **The doors have cases** — the front door a pair of pilasters under an
 *   entablature and a lamp either side — and their leaves stand open, folded
 *   back flat on the inside of the wall.
 * - **The roofs are thick and seamed**, and every one is copper laid on
 *   boarding (`copperOn`), so what the gallery looks up at is a boarded
 *   ceiling on rafters. The main roof is two solids cut plumb
 *   at the eave with standing seams and a ridge roll; its gables are
 *   pedimented with a raking cornice and a louvred oculus; the portico's
 *   pediment is a stucco tympanum with a lunette in it, where it was a copper
 *   wedge; the belvedere is a glazed lantern on a plinth under a copper cap
 *   the flag stands on; and the stack has oversailing courses and two pots.
 * - **The hall is furnished as far as a fight allows**: a beamed ceiling on the
 *   two columns, a panelled dado, a rug, pictures and an overmantel glass —
 *   all of it on a face, overhead or underfoot. The stair has a newel at each
 *   end and balusters on its rail, and the upper rooms have a ceiling.
 * - **The forest** hangs off the gallery's floor band over the arches and
 *   down the piers, off the cornices down the blank bays, and in a fringe off
 *   the veranda roof's eave — `curtain`, the jungle ruin's growth — and ferns
 *   stand round the apron. Nothing soft comes lower than 2.4 m over anywhere
 *   a body stands, except down a wall or a pier, where no body can stand.
 *
 * Fixed geometry apart from `litWindows`, so what varies between the shutters
 * and the growth is drawn from one fixed seed rather than a placement's.
 */
import { Scene, VertexData } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { mulberry32 } from "../rng";
import {
  Build,
  type BuildParams,
  type Hole,
  type Point3,
  type Side,
  type Structure,
  carve,
  convexSolid,
  curtain,
  fern,
  onFace,
  outward,
  runsAlongX,
  slab as member,
  AWNING,
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

// --- the arcade ------------------------------------------------------------

/** The veranda ceiling: the underside of the gallery floor. */
const SOFFIT = DECK - SLAB;
/**
 * Where the arches spring: 2.4 m over the veranda floor, which is the lowest
 * anything overhead may come down over a walked surface, and the arch is only
 * ever overhead — the piers are the colliders and the spandrel is drawing.
 */
const SPRING = POD + 2.4;
/** The crown, under the floor band with 0.4 of wall over it. */
const CROWN = SOFFIT - 0.4;
/** The band of render round each arch, and how proud it stands. */
const ARCH_BAND = 0.13;
const ARCH_PROUD = 0.03;
/** The pier's section. */
const PIER = 0.55;

// --- the veranda roof ------------------------------------------------------
// A lean-to on the colonnade, pitched from the wall's centre line at the eave
// out past the columns. The section is the one the colliders have always had.

const SKIRT_DROP = 0.75;
const SKIRT_RUN = VER + 0.7;
const SKIRT_T = 0.18;
/** Half the roof's thickness, measured vertically. */
const SKIRT_HV = SKIRT_T / 2 / Math.cos(Math.atan2(SKIRT_DROP, SKIRT_RUN));
/** The skirt's top and underside `d` out from the wall's centre line. */
const skirtTop = (d: number): number => EAVE - (d * SKIRT_DROP) / SKIRT_RUN + SKIRT_HV;
const skirtBot = (d: number): number => EAVE - (d * SKIRT_DROP) / SKIRT_RUN - SKIRT_HV;
/** The rafters under it. */
const RAFTER = 0.13;
/** The colonnade line, out from the wall's centre line: the piers' own. */
const COLONNADE_D = VER - 0.3;
/** The plate the rafters bear on at the colonnade, and the columns' drawn head. */
const PLATE_TOP = skirtBot(COLONNADE_D) - RAFTER;
const PLATE_H = 0.2;
const COL_TOP = PLATE_TOP - PLATE_H;
/** The plate the rafters bear on at the wall. */
const WALL_PLATE_TOP = skirtBot(0.26) - RAFTER;

// --- openings --------------------------------------------------------------

/** Sash windows: one width, and a sill and a height per storey. */
const WIN_W = 1.5;
const G_SILL = POD + 0.9;
const G_WIN_H = 2.1;
/** Tops out under the upper cornice, which is the window's head. */
const U_SILL = DECK + 0.75;
const U_WIN_H = 1.95;
/** A shutter leaf, as a share of the window's width. */
const LEAF = 0.44;

// --- colours the manor adds to the palette it shares -----------------------

/** A window with nobody behind it: the reveal, not the glass. */
const REVEAL = "#2b312d";
/**
 * The lamplit pane. A shade under the village's `LAMPLIT`: these are big
 * sashes, and at the old `#ffc27a` a lit one bloomed white across its own
 * glazing bars (`ROOM_GLOW`'s argument — what an emissive may be is set by
 * its AREA), and a step under that it still did from the gallery, a metre
 * off the glass. This is the village's `SHOPLIT`, for the same reason.
 */
const WINDOW = "#b3733a";

// --- helpers ---------------------------------------------------------------

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
 * Triangles gathered in the structure's frame and emitted as one surface: for
 * the shapes a box cannot be and a `convexSolid` would be wasteful as — an
 * arch's spandrel is not convex, and slicing it into solids spends 36
 * vertices a slice on faces nobody sees.
 *
 * Each triangle is wound by the direction it must FACE rather than by the
 * order it was walked in, with `convexSolid`'s rule: a front face's cross
 * product points INTO the solid, so a triangle whose normal agrees with `out`
 * is turned over. Every triangle carries its own vertices, so the normals come
 * out flat and the ink finds the bends.
 */
class Sheet {
  private pos: number[] = [];

  tri(p: Point3, q: Point3, r: Point3, out: Point3): void {
    const ux = q[0] - p[0];
    const uy = q[1] - p[1];
    const uz = q[2] - p[2];
    const vx = r[0] - p[0];
    const vy = r[1] - p[1];
    const vz = r[2] - p[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * out[0] + ny * out[1] + nz * out[2] > 0) [q, r] = [r, q];
    this.pos.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
  }

  quad(a: Point3, c: Point3, d: Point3, e: Point3, out: Point3): void {
    this.tri(a, c, d, out);
    this.tri(a, d, e, out);
  }

  emit(b: Build, color: string): void {
    const n = this.pos.length / 3;
    if (!n) return;
    const indices: number[] = [];
    const uvs: number[] = [];
    for (let i = 0; i < n; i++) {
      indices.push(i);
      uvs.push(this.pos[i * 3], this.pos[i * 3 + 1]);
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(this.pos, indices, normals);
    const data = new VertexData();
    data.positions = this.pos;
    data.indices = indices;
    data.uvs = uvs;
    data.normals = normals;
    b.surface(data, color);
    this.pos = [];
  }
}

/** A point on a run of the arcade: `u` along it, `w` out from its centre line `c`. */
const onRun = (s: Side, c: number, u: number, y: number, w: number): Point3 =>
  runsAlongX(s) ? [u, y, outward(s) * (c + w)] : [outward(s) * (c + w), y, u];
/** A direction in that same frame. */
const runDir = (s: Side, du: number, dy: number, dw: number): Point3 =>
  runsAlongX(s) ? [du, dy, outward(s) * dw] : [outward(s) * dw, dy, du];

/**
 * One bay of the arcade, between two pier faces `u0` and `u1` on a run whose
 * piers stand on the line `c`: the spandrel over a semi-elliptic arch from
 * `SPRING` to `CROWN`, both faces and the soffit, and the band of render round
 * its outer face. The band's ends run onto the piers' faces, where the impost
 * caps them. Wide bays get the same rise, which flattens them into the
 * segmental arch a span that wide would have been built as.
 */
function arch(sheet: Sheet, s: Side, c: number, u0: number, u1: number, half: number): void {
  const um = (u0 + u1) / 2;
  const hs = (u1 - u0) / 2;
  const rise = CROWN - SPRING;
  const n = Math.max(8, Math.min(15, Math.round((u1 - u0) * 2.4)));
  const at = (i: number, grow: number): [number, number] => {
    const t = (Math.PI * i) / n;
    return [um - (hs + grow) * Math.cos(t), SPRING + (rise + grow) * Math.sin(t)];
  };
  const P = (u: number, y: number, w: number): Point3 => onRun(s, c, u, y, w);
  const f = half + ARCH_PROUD;
  for (let i = 0; i < n; i++) {
    const [ua, ya] = at(i, 0);
    const [ub, yb] = at(i + 1, 0);
    const [ua1, ya1] = at(i, ARCH_BAND);
    const [ub1, yb1] = at(i + 1, ARCH_BAND);
    const mu = (ua + ub) / 2;
    const my = (ya + yb) / 2;
    const inward = runDir(s, um - mu, SPRING - my, 0);
    for (const w of [half, -half]) {
      sheet.quad(P(ua, ya, w), P(ub, yb, w), P(ub, SOFFIT, w), P(ua, SOFFIT, w), runDir(s, 0, 0, w));
    }
    sheet.quad(P(ua, ya, half), P(ub, yb, half), P(ub, yb, -half), P(ua, ya, -half), inward);
    sheet.quad(P(ua, ya, f), P(ub, yb, f), P(ub1, yb1, f), P(ua1, ya1, f), runDir(s, 0, 0, 1));
    sheet.quad(P(ua, ya, half), P(ub, yb, half), P(ub, yb, f), P(ua, ya, f), inward);
    sheet.quad(
      P(ua1, ya1, half),
      P(ub1, yb1, half),
      P(ub1, yb1, f),
      P(ua1, ya1, f),
      runDir(s, (ua1 + ub1) / 2 - um, (ya1 + yb1) / 2 - SPRING, 0),
    );
  }
}

/**
 * A roof as it is laid: a skin of copper over the boarding it is nailed to,
 * between a top face `top` and an underside `bot` walked the same way round.
 * The boarding is what the gallery looks up at — a copper underside read as a
 * green lid, not a ceiling.
 */
function copperOn(b: Build, top: Point3[], bot: Point3[]): void {
  const skin = top.map((q, i): Point3 => {
    const k = 0.07 / Math.max(0.07, q[1] - bot[i][1]);
    return [q[0] + (bot[i][0] - q[0]) * k, q[1] + (bot[i][1] - q[1]) * k, q[2] + (bot[i][2] - q[2]) * k];
  });
  convexSolid(b, top, skin, VERDIGRIS);
  convexSolid(b, skin, bot, PLANK);
}

/** The height of an arch's outer band over `u`, or null clear of it. */
function archTop(u: number, u0: number, u1: number): number | null {
  const um = (u0 + u1) / 2;
  const hs = (u1 - u0) / 2 + ARCH_BAND;
  const q = (u - um) / hs;
  if (Math.abs(q) >= 1) return null;
  return SPRING + (CROWN - SPRING + ARCH_BAND) * Math.sqrt(1 - q * q);
}

/** The inside of an elevation: the opposite side, with its plane inside the wall. */
const flip = (s: Side): Side => (s === "-z" ? "+z" : s === "+z" ? "-z" : s === "-x" ? "+x" : "-x");

/** How a shutter leaf hangs. */
type Leaf = "open" | "askew" | "gone";

/**
 * A sash window in a rendered wall: the glass (dark, or lamplit) in a frame
 * with a meeting rail and a bar either way in each sash, a stucco architrave
 * with a keystone, a stone sill on two consoles, and a louvred shutter thrown
 * back either side.
 *
 * The glazing bars are what turn a lit pane into a window — a bright
 * rectangle with nothing across it read as a lamp on the wall, and bloomed
 * into one. The louvres are tipped rather than laid flat, so each is a band
 * of shade as well as two lines of ink. `head` draws the architrave's head;
 * the upper storey's is the cornice itself, which the keystone runs up into.
 */
function sash(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  sill: number,
  wh: number,
  o: { lit: boolean; head: boolean; leaves: readonly [Leaf, Leaf] },
): void {
  const ww = WIN_W;
  const top = sill + wh;
  const mid = sill + wh / 2;
  const gw = ww - 0.26;
  const gh = wh - 0.26;
  const g0 = sill + 0.13;
  if (o.lit) {
    const c = outward(s) * (plane + 0.02);
    if (runsAlongX(s)) b.glow(gw, gh, 0.04, u, mid, c, WINDOW);
    else b.glow(0.04, gh, gw, c, mid, u, WINDOW);
  } else {
    onFace(b, s, plane, u, mid, gw, gh, 0.04, 0.02, REVEAL);
  }
  // The sashes: a frame, a meeting rail, and four lights a sash.
  for (const k of [-1, 1]) onFace(b, s, plane, u + k * (gw / 2 + 0.05), mid, 0.1, gh + 0.2, 0.06, 0.04, TEAK);
  onFace(b, s, plane, u, top - 0.07, gw + 0.2, 0.1, 0.06, 0.04, TEAK);
  onFace(b, s, plane, u, sill + 0.07, gw + 0.2, 0.1, 0.06, 0.04, TEAK);
  onFace(b, s, plane, u, mid, gw, 0.07, 0.05, 0.045, TEAK);
  onFace(b, s, plane, u, mid, 0.04, gh, 0.04, 0.045, TEAK);
  for (const f of [0.25, 0.75]) onFace(b, s, plane, u, g0 + gh * f, gw, 0.035, 0.04, 0.045, TEAK);
  // The architrave, the keystone and the sill.
  for (const k of [-1, 1]) {
    onFace(b, s, plane, u + k * (ww / 2 + 0.04), mid + 0.06, 0.16, wh + 0.12, 0.07, 0.035, STUCCO);
    onFace(b, s, plane, u + k * (ww / 2 + 0.02), sill - 0.19, 0.1, 0.18, 0.13, 0.065, STUCCO);
  }
  if (o.head) onFace(b, s, plane, u, top + 0.07, ww + 0.24, 0.14, 0.07, 0.035, STUCCO);
  onFace(b, s, plane, u, top + 0.06, 0.2, 0.3, 0.1, 0.05, STUCCO);
  onFace(b, s, plane, u, sill - 0.05, ww + 0.36, 0.1, 0.2, 0.1, STONE);
  // The shutters, in the gallery's green.
  const lw = ww * LEAF;
  for (const [i, k] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const leaf = o.leaves[i];
    if (leaf === "gone") continue;
    const askew = leaf === "askew";
    const tilt = askew ? k * 0.1 : 0;
    const drop = askew ? 0.06 : 0;
    const lu = u + k * (ww / 2 + 0.14 + lw / 2);
    const lm = mid - drop;
    onFace(b, s, plane, lu, lm, lw, wh - 0.04, 0.035, 0.035, VERDIGRIS, tilt);
    onFace(b, s, plane, lu, lm, lw, 0.1, 0.04, 0.07, VERDIGRIS, tilt);
    for (const [y0, y1] of [
      [sill + 0.14 - drop, lm - 0.1],
      [lm + 0.1, top - 0.14 - drop],
    ]) {
      for (let j = 0; j < 3; j++) {
        const y = y0 + ((j + 0.5) * (y1 - y0)) / 3;
        if (askew) {
          onFace(b, s, plane, lu + (y - lm) * -tilt, y, lw - 0.1, 0.07, 0.02, 0.065, VERDIGRIS, tilt);
          continue;
        }
        const c = outward(s) * (plane + 0.065);
        if (runsAlongX(s)) b.box(lw - 0.1, 0.075, 0.02, lu, y, c, VERDIGRIS, { x: 0.55 });
        else b.box(0.02, 0.075, lw - 0.1, c, y, lu, VERDIGRIS, { z: 0.55 });
      }
    }
  }
}

/** A window's footprint on its face, frame and shutters and all. */
function sashHole(u: number, sill: number, wh: number): Hole {
  const reach = WIN_W / 2 + 0.14 + WIN_W * LEAF + 0.03;
  return { u0: u - reach, u1: u + reach, y0: sill - 0.2, y1: sill + wh + 0.2 };
}

/** The same window from inside the room: a dark pane in a cased frame on a window board. */
function innerSash(b: Build, s: Side, plane: number, u: number, sill: number, wh: number): void {
  const ww = WIN_W;
  const mid = sill + wh / 2;
  onFace(b, s, plane, u, mid, ww - 0.26, wh - 0.26, 0.03, 0.015, REVEAL);
  for (const k of [-1, 1]) onFace(b, s, plane, u + k * (ww / 2 - 0.05), mid, 0.16, wh, 0.05, 0.025, TEAK);
  onFace(b, s, plane, u, sill + wh - 0.06, ww, 0.14, 0.05, 0.025, TEAK);
  onFace(b, s, plane, u, sill + 0.03, ww + 0.2, 0.08, 0.16, 0.08, TEAK);
  onFace(b, s, plane, u, mid, ww - 0.26, 0.06, 0.04, 0.035, TEAK);
  onFace(b, s, plane, u, mid, 0.04, wh - 0.26, 0.04, 0.035, TEAK);
}

/**
 * A door case round an opening the walls already leave — jambs and a head of
 * teak standing proud of the render — and, when `leaves` is given, the pair
 * of panelled leaves stood open and folded back flat against the INSIDE face
 * of the wall, which is the one place a leaf can be drawn that is neither in
 * the doorway nor standing out into a room at chest height.
 */
function doorCase(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  floor: number,
  w: number,
  h: number,
  leaves: boolean,
): void {
  for (const k of [-1, 1]) onFace(b, s, plane, u + k * (w / 2 + 0.09), floor + (h + 0.18) / 2, 0.18, h + 0.18, 0.1, 0.05, TEAK);
  onFace(b, s, plane, u, floor + h + 0.09, w + 0.36, 0.18, 0.1, 0.05, TEAK);
  if (!leaves) return;
  const inside = flip(s);
  const at = -(plane - T);
  const lw = w / 2;
  for (const k of [-1, 1]) {
    const lu = u + k * (w / 2 + lw / 2 + 0.03);
    onFace(b, inside, at, lu, floor + h / 2, lw - 0.02, h - 0.04, 0.05, 0.025, TEAK);
    for (const f of [0.27, 0.71]) {
      onFace(b, inside, at, lu, floor + h * f, lw - 0.24, h * 0.34, 0.03, 0.06, TEAK);
    }
  }
}

/**
 * The dressing on one run of gallery parapet: a coping, a plinth, dies at a
 * pitch, a sunk panel on the inside and a balustrade in relief on the outside.
 *
 * It is a PARAPET rather than the turned balustrade a veranda wants, and that
 * is `Build.guard`'s decision rather than a taste one: a guard is a solid box
 * the full height of the rail, because a rail you can walk through is a fall,
 * and it stands outboard of the deck because a 0.16 m rail sampled by a 1.5 m
 * nav grid costs whichever cell it lands in. Balusters drawn at that offset
 * are simply inside it and invisible — measured, on the first pass. So the
 * detail goes on the faces of the box that is already there: stucco
 * balusters on a DARK ground, since a relief this shallow is only ever read
 * by the value behind it (the temple's devatas learned that), and from the
 * approach a dark ground between balusters is a pierced rail.
 *
 * VISUAL ONLY. The `guard` beside each call is the solid half, and a collider
 * here would put the walked surface back under the rail.
 */
function balustrade(
  b: Build,
  side: Side,
  edge: number,
  from: number,
  to: number,
  surface: number,
  height: number,
  baluster = STUCCO,
): void {
  const alongZ = side === "-x" || side === "+x";
  const n = side === "+x" || side === "+z" ? 1 : -1;
  const G = GUARD_THICKNESS;
  /** A box `a` along the run, between `w0` and `w1` out from the deck's edge. */
  const put = (a: number, bh: number, u: number, y: number, w0: number, w1: number, color: string): void => {
    const c = edge + (n * (w0 + w1)) / 2;
    if (alongZ) b.box(w1 - w0, bh, a, c, y, u, color);
    else b.box(a, bh, w1 - w0, u, y, c, color);
  };
  const length = to - from;
  const mid = (from + to) / 2;
  put(length, 0.14, mid, surface + height + 0.04, -0.09, G + 0.09, TEAK);
  put(length, 0.18, mid, surface + 0.09, -0.06, G + 0.06, TEAK);
  const bays = Math.max(1, Math.round(length / 1.7));
  const bay = length / bays;
  for (let i = 0; i <= bays; i++) {
    put(0.26, height, from + i * bay, surface + height / 2, -0.07, G + 0.07, TEAK);
  }
  const ph = height - 0.52;
  const py = surface + height / 2;
  for (let i = 0; i < bays; i++) {
    const u = from + (i + 0.5) * bay;
    const pw = bay - 0.36;
    put(pw, ph, u, py, -0.015, 0.005, MOSS_STONE);
    put(pw, ph + 0.08, u, py, G - 0.005, G + 0.012, DARK_STONE);
    const count = Math.max(1, Math.floor(pw / 0.34));
    for (let j = 0; j < count; j++) {
      const bu = u - pw / 2 + ((j + 0.5) * pw) / count;
      put(0.07, ph + 0.08, bu, py, G, G + 0.05, baluster);
      put(0.13, 0.26, bu, py - ph * 0.12, G, G + 0.07, baluster);
    }
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
    // Two fires on the one bed, because the grate is wider than it is deep and
    // a single round flame in a long firebox reads as a candle.
    b.flame(openD * 0.32, openH * 0.55, fireX, floor + 0.2, z - openW * 0.17, 3);
    b.flame(openD * 0.28, openH * 0.44, fireX, floor + 0.2, z + openW * 0.17, 3);
    // In FRONT of the opening and above the bed, so the breast and the boards
    // are what the fire lights rather than the back of its own firebox. A
    // hearth is not a forge: at `buildSmithy`'s 2.3 it washed the hall's
    // render out to white and the hearth stone with it.
    b.light(EMBER, 13, 1.4, 0.5, face - 0.4, floor + openH * 0.6, z);
  }
  // A surround of dressed stone round the opening, standing off the breast.
  for (const s of [-1, 1]) {
    b.box(0.06, openH + 0.2, 0.2, face - 0.03, floor + (openH + 0.2) / 2, z + (s * (openW + 0.2)) / 2, STONE);
  }
  b.box(0.06, 0.22, openW + 0.4, face - 0.03, floor + openH + 0.11, z, STONE);
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
 * Per-strip variation for the moss on the apron: what share of its pitch a
 * patch fills and how far it is inset. A table rather than a generator
 * because it predates the manor's seed and the moss is laid out by hand.
 */
const VINE = [
  [0.92, 0.0, 0.0],
  [0.58, 0.85, 1.3],
  [0.8, 0.3, 0.45],
  [0.5, 1.5, 2.4],
  [0.72, 0.55, 0.15],
] as const;

/** One elevation of the core block: which face, where its plane is, how far it runs. */
interface Elevation {
  s: Side;
  plane: number;
  half: number;
}

const ELEVATIONS: readonly Elevation[] = [
  { s: "-z", plane: CD / 2 + T / 2, half: CW / 2 + T / 2 },
  { s: "+z", plane: CD / 2 + T / 2, half: CW / 2 + T / 2 },
  { s: "-x", plane: CW / 2 + T / 2, half: CD / 2 + T / 2 },
  { s: "+x", plane: CW / 2 + T / 2, half: CD / 2 + T / 2 },
];

/** Every window: which face, where along it, which storey, and whether its lamp is lit. */
const WINDOWS: readonly { s: Side; u: number; up: boolean; lit: boolean }[] = [
  ...[-8.4, -4.6, 4.6, 8.4].flatMap((u) => [
    { s: "-z" as const, u, up: false, lit: true },
    { s: "-z" as const, u, up: true, lit: true },
  ]),
  ...[-7.6, 7.6].flatMap((u) => [
    { s: "+z" as const, u, up: false, lit: false },
    { s: "+z" as const, u, up: true, lit: true },
  ]),
  // The two flanks are NOT a matching pair, and neither missing bay is a
  // saving. The west ground storey's +4.8 bay is where the stair hall's door
  // had to go (`WEST_DOOR_Z`, and a shuttered opening is nearly 3 m wide with
  // its leaves thrown back, so the two would overlap). Both east bays at -4.8
  // are the chimney: a lit pane in front of 1.5 m of breast is a window into
  // masonry, with this roof's one stack standing directly over it.
  { s: "-x", u: -4.8, up: true, lit: false },
  { s: "-x", u: 4.8, up: true, lit: false },
  { s: "-x", u: -4.8, up: false, lit: false },
  { s: "+x", u: 4.8, up: false, lit: true },
  { s: "+x", u: 4.8, up: true, lit: true },
];

/**
 * Every doorway, as the `doorWall`/`doorWallZ` calls cut it — those calls are
 * the colliders and stay the authority; this is the drawing's copy of them.
 */
const DOORS: readonly { s: Side; u: number; up: boolean; w: number; h: number; leaves: boolean }[] = [
  { s: "-z", u: 0, up: false, w: 3.2, h: 2.9, leaves: true },
  { s: "+z", u: 0, up: false, w: 2, h: 2.5, leaves: true },
  // The west door's leaves would fold back into the stair and the north wall.
  { s: "-x", u: WEST_DOOR_Z, up: false, w: 2, h: 2.5, leaves: false },
  { s: "+x", u: 0, up: false, w: 2, h: 2.5, leaves: true },
  { s: "-z", u: 0, up: true, w: 2.6, h: 2.5, leaves: true },
  { s: "+z", u: 0, up: true, w: 1.8, h: 2.4, leaves: true },
  // …and the upper one's into the stairwell it opens over.
  { s: "-x", u: 0, up: true, w: 1.8, h: 2.4, leaves: false },
  { s: "+x", u: 0, up: true, w: 1.8, h: 2.4, leaves: true },
];

/** The front door's pilasters, out from its centre line. */
const FRONT_PILASTER = 3.2 / 2 + 0.45;

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
  const rnd = mulberry32(0x6d616e72);

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
  // **The box is as DEEP as the podium, not as deep as the boards look**, and
  // the bug that set that rule is retired while the shape it left is not. A
  // 0.14 m slab here rendered its own ink over the entire hall floor and read
  // as a black void, back when the ink was a back-face shell: `OutlineRenderer`
  // drew it with a NEGATIVE z-offset, which is slope-scaled, and at the grazing
  // angle a floor is seen from that bias is enormous — so the shell's
  // underside, only `h + outlineWidth` behind the real top face, won the depth
  // test. Thick enough and it could not: the same floor at 0.5 m deep put its
  // shell 0.55 m back and rendered clean. A full-screen ink cannot reproduce
  // it, having no shell to misplace, so what is left here is a depth this
  // podium no longer needs and a warning about how quietly the old one failed
  // — nothing announced it; the surface simply came back inked in its own
  // colour.
  boardDeck(b, FW, FD, 0, 0);
  // Under the portico, and the one flight of steps up to the front door.
  b.block({ w: PORTICO_HW * 2 + 1.2, h: POD, d: PORTICO_OUT + 0.4, x: 0, y: POD / 2, z: PORTICO_Z });
  boardDeck(b, PORTICO_HW * 2 + 1.2, PORTICO_OUT + 0.4, 0, PORTICO_Z);
  b.wall(PORTICO_HW * 2 + 2, 0.2, 0.55, 0, 0.1, -FD / 2 - PORTICO_OUT - 0.47, MOSS_STONE);
  // A stone nosing on the step, 3 cm proud of its top.
  b.box(PORTICO_HW * 2 + 2, 0.08, 0.1, 0, 0.19, -FD / 2 - PORTICO_OUT - 0.47 - 0.25, STONE);

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
  // use, which is the only reason they are colliders and not dressing. Each
  // stands on a plinth and takes the summer beam on a bolster.
  for (const s of [-1, 1]) {
    b.wall(0.44, GROUND, 0.44, s * 3.6, gy, -3, TEAK);
    b.box(0.56, 0.22, 0.56, s * 3.6, POD + 0.11, -3, TEAK);
    b.box(0.9, 0.12, 0.5, s * 3.6, SOFFIT - 0.42, -3, TEAK);
  }
  // The hall's fireplace is NOT emitted here, with the storey it stands in —
  // see the chimney block below the upper floor, and the header for why.

  // --- ground colonnade -----------------------------------------------------
  // Masonry piers at the veranda's outer edge, carrying the gallery above.
  // Their tops land a slab's thickness under the deck, which `addSurface`
  // merges into it rather than inventing a second surface per bay.
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
  const eastBays = flankBays.filter((z) => !inLandingBay(z));
  const porticoZ = FD / 2 + PORTICO_OUT - 0.3;
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
    b.box(PIER + 0.12, 0.1, PIER + 0.12, px, POD + 0.31, pz, STONE);
    // The impost the arches spring from.
    b.box(PIER + 0.1, 0.12, PIER + 0.1, px, SPRING - 0.06, pz, STONE);
  }

  // The arcade. Runs of piers, each with the line they stand on; a pair of
  // neighbours closer than 7.6 m is an arch, and the one wider gap — the front
  // behind the portico — is the entrance, which the portico's own arch fronts.
  const runs: [Side, number, number[]][] = [
    ["-z", pierZ, frontBays],
    ["+z", pierZ, backBays],
    ["-x", pierX, [-pierZ, ...flankBays, pierZ]],
    ["+x", pierX, [-pierZ, ...eastBays, pierZ]],
    ["-z", porticoZ, [-PORTICO_HW + 0.2, PORTICO_HW - 0.2]],
  ];
  /** Every arch as it was drawn, for the growth that hangs over it. */
  const bays: { s: Side; c: number; u0: number; u1: number }[] = [];
  const arcade = new Sheet();
  for (const [s, c, us] of runs) {
    for (let i = 0; i + 1 < us.length; i++) {
      const u0 = us[i] + PIER / 2;
      const u1 = us[i + 1] - PIER / 2;
      if (u1 - u0 > 7.6) continue;
      arch(arcade, s, c, u0, u1, PIER / 2);
      bays.push({ s, c, u0, u1 });
      const um = (u0 + u1) / 2;
      const key = onRun(s, c, um, CROWN + 0.08, 0);
      if (runsAlongX(s)) b.box(0.26, 0.36, PIER + 0.08, key[0], key[1], key[2], STUCCO);
      else b.box(PIER + 0.08, 0.36, 0.26, key[0], key[1], key[2], STUCCO);
    }
  }
  arcade.emit(b, STUCCO);
  // A beam from every pier back to the wall under the gallery floor, so the
  // veranda ceiling is carried rather than a plank lid. Not from the corners,
  // which have no wall behind them.
  for (const [px, pz] of piers) {
    const portico = pz < -FD / 2 - 0.5;
    const corner = Math.abs(px) > pierX - 0.01 && Math.abs(pz) > pierZ - 0.01;
    if (corner) continue;
    if (Math.abs(px) > pierX - 0.01) {
      const x0 = pierX - PIER / 2;
      const x1 = CW / 2 + T / 2;
      b.box(x0 - x1, 0.26, 0.2, Math.sign(px) * ((x0 + x1) / 2), SOFFIT - 0.13, pz, TEAK);
    } else {
      const z0 = (portico ? porticoZ : pierZ) - PIER / 2;
      const z1 = CD / 2 + T / 2;
      b.box(0.2, 0.26, z0 - z1, px, SOFFIT - 0.13, Math.sign(pz) * ((z0 + z1) / 2), TEAK);
    }
  }

  // --- upper floor ----------------------------------------------------------
  // Three slabs round the stairwell void, then the gallery ring outside them.
  // Same colour as the ring, so the coplanar joins merge into one mesh and
  // cannot z-fight (see buildTavern for the version that does).
  const slabY = DECK - SLAB / 2;
  const floorSlab = (w: number, d: number, x: number, z: number): void => {
    b.box(w, SLAB, d, x, slabY, z, PLANK);
    b.block({ w, h: SLAB, d, x, y: slabY, z });
  };
  /** East of the void: the whole depth of the core, in one piece. */
  floorSlab(CW / 2 - VOID_X, CD, (VOID_X + CW / 2) / 2, 0);
  /** West of it, the two strips the void leaves — south of it and north of it. */
  const westW = VOID_X + CW / 2;
  const westX = -CW / 2 + westW / 2;
  floorSlab(westW, VOID_Z0 + CD / 2, westX, (-CD / 2 + VOID_Z0) / 2);
  floorSlab(westW, CD / 2 - GRAND_TOP_Z, westX, (GRAND_TOP_Z + CD / 2) / 2);
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
    floorSlab(w, d, x, z);
  }
  // The floor band: a stucco fascia hiding the slab's cut edge all round the
  // gallery, over the arcade, with a lip along its head. ONE per side: the
  // first pass ran nine joists at 0.7 m across a 3 m veranda, which is not a
  // joist course but a second, deeper floor, and from outside it read as a
  // metre-thick brown band swallowing the whole balustrade above it.
  const bandY = DECK - SLAB + 0.02;
  for (const s of [-1, 1]) {
    b.box(FW + 0.4, 0.34, 0.2, 0, bandY, (s * (FD + 0.2)) / 2, STUCCO);
    b.box(0.2, 0.34, FD + 0.4, (s * (FW + 0.2)) / 2, bandY, 0, STUCCO);
    b.box(FW + 0.5, 0.07, 0.3, 0, bandY + 0.2, (s * (FD + 0.3)) / 2, STONE);
    b.box(0.3, 0.07, FD + 0.5, (s * (FW + 0.3)) / 2, bandY + 0.2, 0, STONE);
  }
  b.box(PORTICO_HW * 2 + 0.4, 0.34, 0.2, 0, bandY, -FD / 2 - PORTICO_OUT - 0.1, STUCCO);
  b.box(PORTICO_HW * 2 + 0.5, 0.07, 0.3, 0, bandY + 0.2, -FD / 2 - PORTICO_OUT - 0.15, STONE);
  for (const s of [-1, 1]) {
    b.box(0.2, 0.34, PORTICO_OUT, s * (PORTICO_HW + 0.1), bandY, PORTICO_Z, STUCCO);
    b.box(0.3, 0.07, PORTICO_OUT, s * (PORTICO_HW + 0.15), bandY + 0.2, PORTICO_Z, STONE);
  }

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
  // A stone band where it clears the roof, two oversailing courses under the
  // cap, and a pot on each flue.
  b.box(FLUE_D + 0.08, 0.12, FLUE_W + 0.08, FLUE_X, EAVE + 2.1, FIRE_Z, DARK_STONE);
  b.box(FLUE_D + 0.14, 0.14, FLUE_W + 0.14, FLUE_X, STACK_TOP - 0.33, FIRE_Z, BRICK);
  b.box(FLUE_D + 0.24, 0.12, FLUE_W + 0.24, FLUE_X, STACK_TOP - 0.13, FIRE_Z, BRICK);
  b.box(FLUE_D + 0.35, 0.24, FLUE_W + 0.35, FLUE_X, STACK_TOP + 0.12, FIRE_Z, DARK_STONE);
  for (const dz of [-0.45, 0.45]) {
    b.cyl(0.5, 0.24, 0.3, 8, FLUE_X, STACK_TOP + 0.49, FIRE_Z + dz, BRICK);
    b.cyl(0.07, 0.31, 0.31, 8, FLUE_X, STACK_TOP + 0.71, FIRE_Z + dz, BRICK);
  }
  // An overmantel glass over the hall's fire, on the flue's face.
  onFace(b, "-x", -(FLUE_X - FLUE_D / 2), FIRE_Z, hallMantel + 0.55, 1.3, 0.85, 0.05, 0.025, TEAK);
  onFace(b, "-x", -(FLUE_X - FLUE_D / 2), FIRE_Z, hallMantel + 0.55, 1.1, 0.65, 0.03, 0.04, REVEAL);

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
  // A ceiling under the roof, its underside on the roof block's.
  b.box(CW - T, 0.1, CD - T, 0, EAVE - 0.1, 0, PLANK);

  // Slender columns over each pier, carrying the veranda roof. SOLID, like the
  // piers they stand on: the gallery is a ring people fight along, and a column
  // you walk through — and shoot through — on the upper storey while the
  // identical one below stops both is the sort of disagreement that reads as a
  // hitscan bug. 0.3 m against a 3 m deck leaves the ring two cells wide.
  //
  // The collider runs to the eave as it always has; the DRAWN column stops
  // under the plate at `COL_TOP`, because the veranda roof crosses the
  // colonnade 0.55 m under the eave and a full-height box came up through it
  // as a row of stumps along every slope. The portico's two stand clear of
  // that roof and carry its entablature to the eave, so they are drawn whole.
  for (const [px, pz] of piers) {
    const portico = pz < -FD / 2 - 0.5;
    if (portico) {
      b.wall(0.3, UPPER, 0.3, px, uy, pz, TEAK);
    } else {
      b.block({ w: 0.3, h: UPPER, d: 0.3, x: px, y: uy, z: pz });
      b.box(0.3, COL_TOP - DECK, 0.3, px, (DECK + COL_TOP) / 2, pz, TEAK);
      b.box(0.4, 0.1, 0.4, px, COL_TOP - 0.05, pz, TEAK);
    }
    b.box(0.42, 0.16, 0.42, px, DECK + 0.08, pz, TEAK);
    if (portico) b.box(0.46, 0.2, 0.46, px, EAVE - 0.52, pz, TEAK);
  }

  // --- the gallery balustrade -----------------------------------------------
  // `guard` is the solid half and stands outboard of the deck; `balustrade`
  // is the look. Two gaps, both deliberate: the portico balcony breaks the
  // south run, and the service landing breaks the east one.
  const railH = 1.1;
  const rail = (side: Side, edge: number, from: number, to: number): void => {
    // Rendered, like the walls: the parapet is masonry and the teak is the
    // coping and dies `balustrade` stands on it.
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
  const grandRail = GRAND_X + GRAND_W / 2;
  b.box(
    GUARD_THICKNESS + 0.16,
    0.13,
    GRAND_RUN / Math.cos(grandPitch),
    grandRail + GUARD_THICKNESS / 2,
    POD + GRAND_RISE / 2 + railH + 0.04,
    grandMidZ,
    TEAK,
    { x: -grandPitch },
  );
  // Its balusters, in relief on the hall side like the gallery's, a newel at
  // each end, and a string under the treads on that side.
  const grandFace = grandRail + GUARD_THICKNESS;
  b.box(
    0.012,
    (railH - 0.28) * Math.cos(grandPitch),
    (GRAND_RUN - 0.5) / Math.cos(grandPitch),
    grandFace + 0.004,
    POD + GRAND_RISE / 2 + railH / 2,
    grandMidZ,
    DARK_STONE,
    { x: -grandPitch },
  );
  for (let z = GRAND_FOOT_Z + 0.45; z < GRAND_TOP_Z - 0.3; z += 0.3) {
    const y0 = POD + (z - GRAND_FOOT_Z) * GRAND_GRADE + 0.15;
    const y1 = y0 + railH - 0.29;
    b.box(0.05, y1 - y0, 0.07, grandFace + 0.025, (y0 + y1) / 2, z, STUCCO);
  }
  for (const [z, y] of [
    [GRAND_FOOT_Z + 0.14, POD],
    [GRAND_TOP_Z - 0.14, DECK],
  ]) {
    b.box(0.28, railH + 0.2, 0.28, grandRail + GUARD_THICKNESS / 2, y + (railH + 0.2) / 2, z, TEAK);
    b.box(0.36, 0.08, 0.36, grandRail + GUARD_THICKNESS / 2, y + railH + 0.24, z, TEAK);
  }
  b.box(0.08, 0.36, GRAND_RUN / Math.cos(grandPitch), grandRail + 0.04, POD + GRAND_RISE / 2 - 0.2, grandMidZ, TEAK, {
    x: -grandPitch,
  });

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
    // The string the treads are housed in, under the rail.
    b.box(
      0.1,
      0.36,
      (svcFootZ - SERVICE_TOP_Z) / Math.cos(Math.atan(SERVICE_GRADE)),
      SERVICE_X + (s * (SERVICE_W + 0.1)) / 2,
      svcMidY - 0.2,
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
      b.box(0.36, 0.2, 0.36, px, 0.1, z, DARK_STONE);
    }
    b.box(SERVICE_W, 0.16, 0.16, SERVICE_X, hgt - 0.08, z, TEAK);
  }
  for (const s of [-1, 1]) {
    const px = SERVICE_X + s * (SERVICE_W / 2);
    b.box(0.28, DECK - SLAB, 0.28, px, (DECK - SLAB) / 2, LANDING_Z - LANDING_D / 2 + 0.3, TEAK);
    b.block({ w: 0.36, h: DECK - SLAB, d: 0.36, x: px, y: (DECK - SLAB) / 2, z: LANDING_Z - LANDING_D / 2 + 0.3 });
    b.box(0.4, 0.2, 0.4, px, 0.1, LANDING_Z - LANDING_D / 2 + 0.3, DARK_STONE);
  }
  const landX = (FW / 2 + SERVICE_X + SERVICE_W / 2) / 2;
  const landW = SERVICE_X + SERVICE_W / 2 - FW / 2;
  b.guard("+x", SERVICE_X + SERVICE_W / 2, LANDING_Z, LANDING_D + GUARD_THICKNESS * 2, DECK, {
    height: railH,
    color: PLANK,
  });
  balustrade(b, "+x", SERVICE_X + SERVICE_W / 2, LANDING_Z - LANDING_D / 2, LANDING_Z + LANDING_D / 2, DECK, railH, TEAK);
  b.guard("-z", LANDING_Z - LANDING_D / 2, landX, landW, DECK, {
    height: railH,
    color: PLANK,
  });
  balustrade(b, "-z", LANDING_Z - LANDING_D / 2, FW / 2, SERVICE_X + SERVICE_W / 2, DECK, railH, TEAK);

  // --- the elevations -------------------------------------------------------
  // Ground-floor openings look onto the covered veranda; the upper ones onto
  // the gallery. Neither is a firing port — the gallery itself is the firing
  // position — and all of it is drawn on the walls' outer FACES, not on the
  // footprint lines the walls are centred on: at 0.4 m thick that is 0.2 m
  // out, and anything laid on the line is inside the render.
  //
  // Each face is laid in the order a mason would: the openings' footprints
  // first, then whatever runs across the face is carved round them.
  const shutters = (): readonly [Leaf, Leaf] => {
    const pick = (): Leaf => {
      const r = rnd();
      return r < 0.06 ? "gone" : r < 0.18 ? "askew" : "open";
    };
    return [pick(), pick()];
  };
  for (const e of ELEVATIONS) {
    const { s, plane, half } = e;
    for (const up of [false, true]) {
      const floor = up ? DECK : POD;
      const sill = up ? U_SILL : G_SILL;
      const wh = up ? U_WIN_H : G_WIN_H;
      const holes: Hole[] = [];
      for (const w of WINDOWS) {
        if (w.s !== s || w.up !== up) continue;
        sash(b, s, plane, w.u, sill, wh, { lit: lit && w.lit, head: !up, leaves: shutters() });
        innerSash(b, flip(s), -(plane - T), w.u, sill, wh);
        holes.push(sashHole(w.u, sill, wh));
      }
      const doors: Hole[] = [];
      for (const d of DOORS) {
        if (d.s !== s || d.up !== up) continue;
        doorCase(b, s, plane, d.u, floor, d.w, d.h, d.leaves);
        const front = s === "-z" && !up;
        const reach = front ? FRONT_PILASTER + 0.22 : d.w / 2 + 0.28;
        doors.push({ u0: d.u - reach, u1: d.u + reach, y0: floor - 0.1, y1: floor + d.h + 0.3 });
      }
      holes.push(...doors);
      const doorCuts = doors.map((h): [number, number] => [h.u0, h.u1]);

      if (!up) {
        // A stone skirting, then channelled rustication in bands of render
        // with the wall's own face in the channels, then a cornice under the
        // veranda ceiling that wraps the corners.
        for (const [a, c] of carve(-half - 0.05, half + 0.05, doorCuts)) {
          if (c - a > 0.1) onFace(b, s, plane, (a + c) / 2, POD + 0.17, c - a, 0.26, 0.05, 0.025, DARK_STONE);
        }
        for (let k = 0; k < 6; k++) {
          const y0 = POD + 0.32 + k * 0.47;
          const y1 = y0 + 0.43;
          const cuts = holes.filter((h) => h.y0 < y1 && h.y1 > y0).map((h): [number, number] => [h.u0, h.u1]);
          for (const [a, c] of carve(-half - 0.03, half + 0.03, cuts)) {
            if (c - a > 0.12) onFace(b, s, plane, (a + c) / 2, (y0 + y1) / 2, c - a, 0.43, 0.03, 0.015, STUCCO);
          }
        }
        onFace(b, s, plane, 0, SOFFIT - 0.11, 2 * half + 0.12, 0.22, 0.06, 0.03, STUCCO);
        onFace(b, s, plane, 0, SOFFIT - 0.06, 2 * half + 0.24, 0.12, 0.12, 0.06, STUCCO);
      } else {
        // A skirting board on the gallery, pilasters wherever two openings
        // leave room between them and at the corners, and a cornice under the
        // plate the veranda rafters bear on.
        for (const [a, c] of carve(-half - 0.03, half + 0.03, doorCuts)) {
          if (c - a > 0.1) onFace(b, s, plane, (a + c) / 2, DECK + 0.07, c - a, 0.14, 0.04, 0.02, TEAK);
        }
        const sorted = [...holes].sort((p, q) => p.u0 - q.u0);
        const pil = [-half + 0.2, half - 0.2];
        for (let i = 0; i + 1 < sorted.length; i++) {
          if (sorted[i + 1].u0 - sorted[i].u1 > 0.55) pil.push((sorted[i].u1 + sorted[i + 1].u0) / 2);
        }
        for (const u of pil) {
          onFace(b, s, plane, u, (DECK + 0.4 + 6.79) / 2, 0.36, 6.79 - DECK - 0.4, 0.05, 0.025, STUCCO);
          onFace(b, s, plane, u, DECK + 0.27, 0.46, 0.26, 0.08, 0.04, STUCCO);
          onFace(b, s, plane, u, 6.79, 0.48, 0.16, 0.08, 0.04, STUCCO);
        }
        onFace(b, s, plane, 0, 6.935, 2 * half + 0.16, 0.13, 0.08, 0.04, STUCCO);
        onFace(b, s, plane, 0, (7 + WALL_PLATE_TOP) / 2, 2 * half + 0.3, WALL_PLATE_TOP - 7, 0.14, 0.07, TEAK);
      }
    }
  }
  // The corners. The walls are centred on the footprint, so the two that meet
  // at a corner each stop at the other's centre line and leave a 0.2 m notch
  // up the arris of both storeys.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.2, EAVE - POD, 0.2, sx * (CW / 2 + 0.1), (POD + EAVE) / 2, sz * (CD / 2 + 0.1), STUCCO);
    }
  }
  // The front door is the one with a case of its own: pilasters under an
  // entablature, and a lamp on a bracket either side.
  {
    const face = CD / 2 + T / 2;
    for (const k of [-1, 1]) {
      const u = k * FRONT_PILASTER;
      onFace(b, "-z", face, u, (POD + 0.3 + 3.34) / 2, 0.36, 3.34 - POD - 0.3, 0.08, 0.04, STUCCO);
      onFace(b, "-z", face, u, 3.41, 0.48, 0.14, 0.1, 0.05, STUCCO);
      onFace(b, "-z", face, u, POD + 0.2, 0.46, 0.2, 0.1, 0.05, STONE);
      const lu = k * (FRONT_PILASTER + 0.58);
      b.box(0.05, 0.05, 0.32, lu, POD + 2.62, -face - 0.16, IRON);
      b.cyl(0.34, 0.26, 0.2, 6, lu, POD + 2.4, -face - 0.3, IRON);
      b.glow(0.15, 0.2, 0.15, lu, POD + 2.4, -face - 0.3, FLAME);
      b.cyl(0.12, 0.08, 0.28, 6, lu, POD + 2.62, -face - 0.3, IRON);
    }
    onFace(b, "-z", face, 0, 3.52, FRONT_PILASTER * 2 + 0.6, 0.1, 0.12, 0.06, STUCCO);
  }

  // --- the hall, furnished --------------------------------------------------
  // A summer beam over the two columns and joists across it, clear of the
  // stair's lane; a panelled dado; a rug; two pictures. All of it
  // on a face, overhead, or underfoot — a hall is the room this building is
  // fought through, and furniture in it would be cover with no collider.
  b.box(CW / 2 + 7.3, 0.36, 0.34, (CW / 2 - 7.3) / 2, SOFFIT - 0.18, -3, TEAK);
  for (let x = -6.7; x < CW / 2 - 0.3; x += 1.2) {
    b.box(0.14, 0.2, PART_Z - 0.15 + CD / 2 - T / 2, x, SOFFIT - 0.1, (PART_Z - 0.15 - CD / 2 + T / 2) / 2, TEAK);
  }
  const inner = CD / 2 - T / 2;
  for (const [s, plane, a, c] of [
    ["+z", -inner, -(CW / 2 - T / 2), -3.3],
    ["+z", -inner, 3.3, CW / 2 - T / 2],
    ["-z", -(PART_Z - 0.15), -7.0, -1.6],
    ["-z", -(PART_Z - 0.15), 1.6, CW / 2 - T / 2],
  ] as const) {
    const len = c - a;
    onFace(b, s, plane, (a + c) / 2, POD + 0.5, len, 0.92, 0.02, 0.01, PLANK);
    onFace(b, s, plane, (a + c) / 2, POD + 0.97, len, 0.07, 0.06, 0.03, TEAK);
    onFace(b, s, plane, (a + c) / 2, POD + 0.11, len, 0.14, 0.04, 0.02, TEAK);
    const n = Math.max(1, Math.round(len / 1.1));
    for (let i = 0; i < n; i++) {
      onFace(b, s, plane, a + ((i + 0.5) * len) / n, POD + 0.54, len / n - 0.3, 0.56, 0.02, 0.03, TEAK);
    }
  }
  // Upstairs, a dado along both faces of the one partition.
  for (const [s, plane] of [
    ["-z", -(PART_Z - 0.14)],
    ["+z", PART_Z + 0.14],
  ] as const) {
    const a = VOID_X + 3.2;
    const c = CW / 2 - T / 2;
    onFace(b, s, plane, (a + c) / 2, DECK + 0.5, c - a, 0.92, 0.02, 0.01, PLANK);
    onFace(b, s, plane, (a + c) / 2, DECK + 0.97, c - a, 0.07, 0.06, 0.03, TEAK);
    onFace(b, s, plane, (a + c) / 2, DECK + 0.11, c - a, 0.14, 0.04, 0.02, TEAK);
  }
  for (const u of [4.4, 8.2]) {
    onFace(b, "-z", -(PART_Z - 0.15), u, POD + 2.2, 0.95, 1.15, 0.05, 0.025, TEAK);
    onFace(b, "-z", -(PART_Z - 0.15), u, POD + 2.2, 0.75, 0.95, 0.03, 0.04, DARK_STONE);
  }
  // The rug, between the columns and the door, in three layers a centimetre
  // apart so no two colours ever share a plane.
  b.box(5.0, 0.05, 3.2, 0, POD + 0.027, -5.0, AWNING);
  b.box(4.3, 0.05, 2.5, 0, POD + 0.037, -5.0, TEAK);
  b.box(1.5, 0.05, 0.9, 0, POD + 0.047, -5.0, AWNING);

  // --- roofs ----------------------------------------------------------------
  // LAST, and the header says why: `NavGrid` keeps three surfaces per cell and
  // DROPS the fourth candidate rather than sorting it in, so a roof emitted
  // early takes the gallery's slot.
  //
  // The main roof is hand-rolled rather than `gableRoof`d because that method
  // always runs its ridge along Z, and a manor presents its long eave to the
  // front: this one's ridge is along X. Each slope is a solid cut plumb at the
  // eave and at the ridge, with standing seams down it and a roll along the
  // ridge; the gables are stucco, pedimented by a raking cornice and a
  // cornice across their base, with a louvred oculus to vent the roof.
  const slopeD = CD / 2 + ROOF_EAVE_OVER;
  const roofPitch = Math.atan2(ROOF_RISE, slopeD);
  const roofHv = 0.1 / Math.cos(roofPitch);
  const roofLine = (z: number): number => EAVE + ROOF_RISE * (1 - Math.abs(z) / slopeD);
  const verge = CW / 2 + ROOF_EAVE_OVER;
  for (const s of [-1, 1]) {
    const top: Point3[] = [
      [-verge, roofLine(0) + roofHv, 0],
      [verge, roofLine(0) + roofHv, 0],
      [verge, roofLine(slopeD) + roofHv, s * slopeD],
      [-verge, roofLine(slopeD) + roofHv, s * slopeD],
    ];
    copperOn(
      b,
      top,
      top.map((q): Point3 => [q[0], q[1] - 2 * roofHv, q[2]]),
    );
    for (let x = -verge + 0.3; x < verge - 0.2; x += 0.8) {
      member(b, [x, roofLine(slopeD) + roofHv + 0.02, s * (slopeD - 0.02)], [x, roofLine(0.1) + roofHv + 0.02, s * 0.1], 0.05, 0.05, VERDIGRIS);
    }
    const gx = s * (CW / 2 + 0.09);
    b.gableEnd(slopeD * 2, ROOF_RISE, 0.18, (s * CW) / 2, EAVE, 0, STUCCO).rotation.y = Math.PI / 2;
    for (const k of [-1, 1]) {
      const eaveZ = k * (slopeD - 0.3);
      member(b, [gx + s * 0.06, roofLine(eaveZ) - roofHv - 0.1, eaveZ], [gx + s * 0.06, roofLine(0) - roofHv - 0.1, 0], 0.12, 0.2, STUCCO);
      member(b, [gx + s * 0.12, roofLine(eaveZ) - roofHv - 0.03, eaveZ], [gx + s * 0.12, roofLine(0) - roofHv - 0.03, 0], 0.1, 0.1, STUCCO);
    }
    const g: Side = s > 0 ? "+x" : "-x";
    onFace(b, g, CW / 2 + 0.09, 0, EAVE + 0.2, slopeD * 2 - 0.6, 0.2, 0.14, 0.07, STUCCO);
    onFace(b, g, CW / 2 + 0.09, 0, EAVE + 0.33, slopeD * 2 - 0.5, 0.08, 0.22, 0.11, STUCCO);
    const oy = EAVE + 1.25;
    b.cyl(0.08, 1.35, 1.35, 16, gx + s * 0.04, oy, 0, STUCCO, { z: Math.PI / 2 });
    b.cyl(0.06, 1.0, 1.0, 16, gx + s * 0.09, oy, 0, REVEAL, { z: Math.PI / 2 });
    for (const [dy, len] of [
      [-0.25, 0.8],
      [0, 0.96],
      [0.25, 0.8],
    ]) {
      b.box(0.06, 0.07, len, gx + s * 0.12, oy + dy, 0, TEAK, { z: s * 0.5 });
    }
    b.box(0.12, 0.3, 0.24, gx + s * 0.1, oy + 0.62, 0, STUCCO);
  }
  b.cyl(verge * 2 + 0.1, 0.2, 0.2, 6, 0, roofLine(0) + roofHv, 0, VERDIGRIS, { z: Math.PI / 2 });
  b.block({
    w: CW + ROOF_EAVE_OVER * 2,
    h: 0.3,
    d: CD + ROOF_EAVE_OVER * 2,
    x: 0,
    y: EAVE,
    z: 0,
  });

  // The veranda roof: a shallower flare carried on the colonnade, so the eave
  // line steps rather than running one plane from ridge to rail. The colliders
  // first, as they always were; then the drawing, which is four solids meeting
  // on hips — the old four boxes each ran the full length of their side and
  // crossed at every corner.
  for (const s of [-1, 1]) {
    b.block({ w: FW + 1.4, h: 0.26, d: VER + 0.7, x: 0, y: EAVE - SKIRT_DROP / 2, z: (s * (CD + VER + 0.7)) / 2 });
    b.block({ w: VER + 0.7, h: 0.26, d: FD + 1.4, x: (s * (CW + VER + 0.7)) / 2, y: EAVE - SKIRT_DROP / 2, z: 0 });
  }
  const R = SKIRT_RUN;
  for (const e of ELEVATIONS) {
    const alongX = runsAlongX(e.s);
    const n = outward(e.s);
    /** The wall's half-length, and where the wall's centre line is. */
    const half = alongX ? CW / 2 : CD / 2;
    const base = alongX ? CD / 2 : CW / 2;
    const P = (u: number, d: number, y: number): Point3 => (alongX ? [u, y, n * (base + d)] : [n * (base + d), y, u]);
    const plan: [number, number][] = [
      [-half, 0],
      [half, 0],
      [half + R, R],
      [-half - R, R],
    ];
    copperOn(
      b,
      plan.map(([u, d]) => P(u, d, skirtTop(d))),
      plan.map(([u, d]) => P(u, d, skirtBot(d))),
    );
    // Seams down it, and rafters under it on the same pitch — each cut to the
    // hip, which is what a jack rafter is.
    for (let u = -half - R + 0.3; u < half + R - 0.2; u += 0.72) {
      const d0 = Math.max(0.3, Math.abs(u) - half + 0.08);
      if (R - d0 < 0.3) continue;
      member(b, P(u, d0, skirtTop(d0) + 0.02), P(u, R - 0.02, skirtTop(R) + 0.02), 0.05, 0.05, VERDIGRIS);
      const ur = u + 0.36;
      const r0 = Math.max(0.26, Math.abs(ur) - half + 0.1);
      if (R - r0 > 0.3) {
        member(b, P(ur, r0, skirtBot(r0) - RAFTER / 2), P(ur, R - 0.03, skirtBot(R) - RAFTER / 2), 0.08, RAFTER, TEAK);
      }
    }
    // A roll over each hip and the hip rafter under it — drawn from the two
    // runs along X, which between them reach all four corners.
    if (alongX) {
      for (const k of [-1, 1]) {
        member(b, P(k * (half + 0.05), 0.05, skirtTop(0.05) + 0.03), P(k * (half + R), R, skirtTop(R) + 0.03), 0.12, 0.08, VERDIGRIS);
        member(b, P(k * (half + 0.2), 0.2, skirtBot(0.2) - 0.08), P(k * (half + R - 0.05), R - 0.05, skirtBot(R) - 0.08), 0.12, 0.16, TEAK);
      }
    }
    // The copper gutter along the eave, and the plate on the colonnade.
    const g = P(0, R + 0.05, skirtTop(R) - 0.12);
    const pl = P(0, COLONNADE_D, PLATE_TOP - PLATE_H / 2);
    if (alongX) {
      b.box(2 * (half + R) + 0.2, 0.12, 0.16, g[0], g[1], g[2], VERDIGRIS);
      b.box(2 * (half + COLONNADE_D) + 0.3, PLATE_H, 0.24, pl[0], pl[1], pl[2], TEAK);
    } else {
      b.box(0.16, 0.12, 2 * (half + R) + 0.2, g[0], g[1], g[2], VERDIGRIS);
      b.box(0.24, PLATE_H, 2 * (half + COLONNADE_D) + 0.3, pl[0], pl[1], pl[2], TEAK);
    }
  }
  // Knee braces from each column up to the plate, in the colonnade's plane.
  for (const [px, pz] of piers) {
    if (pz < -FD / 2 - 0.5) continue;
    const alongX = Math.abs(pz) > pierZ - 0.01;
    const dirs: [number, number][] = [];
    if (alongX) dirs.push([1, 0], [-1, 0]);
    if (Math.abs(px) > pierX - 0.01) dirs.push([0, 1], [0, -1]);
    for (const [dx, dz] of dirs) {
      if (Math.abs(px + dx * 0.6) > pierX + 0.01 || Math.abs(pz + dz * 0.6) > pierZ + 0.01) continue;
      member(b, [px + dx * 0.15, COL_TOP - 0.3, pz + dz * 0.15], [px + dx * 0.55, COL_TOP + 0.02, pz + dz * 0.55], 0.1, 0.1, TEAK);
    }
  }
  // A downpipe off each corner of the gutter, down past the corner of the
  // parapet and the floor band to a shoe on the apron, stayed back to the
  // corner pier and the band on iron brackets.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (FW / 2 + 0.34);
      const z = sz * (FD / 2 + 0.34);
      const top = skirtTop(R) - 0.18;
      b.cyl(top - 0.2, 0.1, 0.1, 6, x, (top + 0.2) / 2, z, VERDIGRIS);
      member(b, [x, top, z], [sx * (CW / 2 + R), top + 0.1, sz * (CD / 2 + R)], 0.1, 0.1, VERDIGRIS);
      b.box(0.18, 0.1, 0.18, x, 0.25, z, VERDIGRIS);
      const pier: Point3 = [sx * (pierX + PIER / 2), 0, sz * (pierZ + PIER / 2)];
      for (const y of [1.2, 2.6]) member(b, [x, y, z], [pier[0], y, pier[2]], 0.04, 0.04, IRON);
      member(b, [x, bandY, z], [sx * (FW / 2 + 0.2), bandY, sz * (FD / 2 + 0.2)], 0.04, 0.04, IRON);
    }
  }

  // The portico's pediment, breaking the skirt line — the read from down the
  // approach. It stands on an entablature of architrave, frieze and a cornice
  // with dentils under it: without one the pediment is a wedge hanging over a
  // gap with the columns stopping short of it, which is what the first pass
  // looked like. The tympanum is stucco with a lunette in it, as the main
  // gables are, where `gableRoof` painted it in the roof's copper.
  b.box(PORTICO_HW * 2 + 0.9, 0.22, PORTICO_OUT + 0.8, 0, EAVE - 0.31, PORTICO_Z - 0.1, STUCCO);
  b.box(PORTICO_HW * 2 + 0.8, 0.2, PORTICO_OUT + 0.7, 0, EAVE - 0.1, PORTICO_Z - 0.05, STUCCO);
  const dentilZ = PORTICO_Z - 0.05 - (PORTICO_OUT + 0.7) / 2 - 0.04;
  for (let x = -PORTICO_HW - 0.3; x <= PORTICO_HW + 0.3; x += 0.24) {
    b.box(0.09, 0.1, 0.08, x, EAVE - 0.05, dentilZ, STUCCO);
  }
  b.box(PORTICO_HW * 2 + 1.3, 0.2, PORTICO_OUT + 1.2, 0, EAVE + 0.06, PORTICO_Z - 0.1, STUCCO);
  {
    const w = PORTICO_HW * 2 + 1.3;
    const d = PORTICO_OUT + 1.0;
    const rise = 1.7;
    const over = 0.3;
    const y = EAVE + 0.16;
    const slopeW = w / 2 + over;
    const hv = 0.09 / Math.cos(Math.atan2(rise, slopeW));
    const z0 = PORTICO_Z - d / 2 - over;
    const z1 = PORTICO_Z + d / 2 + over;
    const at = (x: number): number => y + rise * (1 - Math.abs(x) / slopeW);
    for (const s of [-1, 1]) {
      const top: Point3[] = [
        [0, at(0) + hv, z0],
        [s * slopeW, at(slopeW) + hv, z0],
        [s * slopeW, at(slopeW) + hv, z1],
        [0, at(0) + hv, z1],
      ];
      copperOn(
        b,
        top,
        top.map((q): Point3 => [q[0], q[1] - 2 * hv, q[2]]),
      );
      for (let z = z0 + 0.25; z < z1 - 0.1; z += 0.62) {
        member(b, [s * (slopeW - 0.02), at(slopeW) + hv + 0.02, z], [s * 0.1, at(0.1) + hv + 0.02, z], 0.05, 0.05, VERDIGRIS);
      }
      // The raking cornice, in two steps under the roof's edge.
      const front = PORTICO_Z - d / 2;
      member(b, [s * (w / 2 - 0.1), at(w / 2) - hv - 0.1, front - 0.12], [0, at(0) - hv - 0.1, front - 0.12], 0.24, 0.2, STUCCO);
      member(b, [s * (w / 2 - 0.1), at(w / 2) - hv - 0.03, front - 0.2], [0, at(0) - hv - 0.03, front - 0.2], 0.12, 0.1, STUCCO);
    }
    b.cyl(z1 - z0 + 0.05, 0.16, 0.16, 6, 0, at(0) + hv, PORTICO_Z, VERDIGRIS, { x: Math.PI / 2 });
    // Tympanum front and back, and the lunette in the front one: a dark
    // half-disc behind glazing bars, in a band of render with a keystone.
    const front = PORTICO_Z - d / 2;
    b.gableEnd(w, rise, 0.2, 0, y, front + 0.1, STUCCO);
    b.gableEnd(w, rise, 0.16, 0, y, PORTICO_Z + d / 2, STUCCO);
    const ly = y + 0.14;
    const lr = 0.8;
    const disc: Point3[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = (Math.PI * i) / 10;
      disc.push([-lr * Math.cos(t), ly + lr * Math.sin(t), front - 0.01]);
    }
    convexSolid(
      b,
      disc,
      disc.map((q): Point3 => [q[0], q[1], q[2] + 0.04]),
      REVEAL,
    );
    for (let i = 1; i < 6; i++) {
      const t = (Math.PI * i) / 6;
      member(b, [0, ly, front - 0.03], [-lr * Math.cos(t), ly + lr * Math.sin(t), front - 0.03], 0.035, 0.04, TEAK);
    }
    const ring = new Sheet();
    arcRing(ring, 0, ly, lr, front, 0.12, 0.04);
    ring.emit(b, STUCCO);
    b.box(0.18, 0.26, 0.12, 0, ly + lr + 0.08, front - 0.05, STUCCO);
    // An acroterion at the apex.
    b.box(0.34, 0.24, 0.34, 0, at(0) + hv + 0.1, front - 0.1, STONE);
    b.cyl(0.3, 0.26, 0.3, 8, 0, at(0) + hv + 0.36, front - 0.1, STONE);
    b.cyl(0.14, 0.04, 0.16, 8, 0, at(0) + hv + 0.58, front - 0.1, STONE);
    // `gableRoof`'s collider, restated: that method's block, with its own
    // arithmetic, as the last collider this building emits.
    b.block({ w: w + over * 2, h: 0.3, d: d + over * 2, x: 0, y, z: PORTICO_Z });
  }

  // Belvedere on the ridge: a glazed lantern on a stucco plinth, under a
  // copper cap with a finial the flag's pole stands on (`flagMount` finds the
  // roof block and lifts the pole `poleLift` over it, which lands at the
  // finial). Visual only and unreachable on purpose: the gallery is the perch
  // this building is about, and a third level would need a third stair, a
  // third nav surface per cell and a reason to exist.
  const cupY = EAVE + ROOF_RISE;
  b.box(2.6, 0.8, 2.6, 0, cupY + 0.02, 0, STUCCO);
  b.box(2.84, 0.1, 2.84, 0, cupY + 0.45, 0, STONE);
  const lanternY = cupY + 1.1;
  b.glow(2.1, 1.0, 2.1, 0, lanternY, 0, lit ? WINDOW : "#8fa3a8");
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.2, 1.2, 0.2, sx * 1.1, lanternY, sz * 1.1, TEAK);
    }
  }
  for (const dy of [-0.55, 0.55]) b.box(2.4, 0.1, 2.4, 0, lanternY + dy, 0, TEAK);
  for (const e of ELEVATIONS) {
    for (const du of [-0.36, 0.36]) onFace(b, e.s, 1.05, du, lanternY, 0.05, 1.0, 0.04, 0.02, TEAK);
    onFace(b, e.s, 1.05, 0, lanternY, 2.1, 0.05, 0.04, 0.02, TEAK);
  }
  b.box(2.9, 0.14, 2.9, 0, lanternY + 0.67, 0, STUCCO);
  const capY = lanternY + 0.74;
  const capTop = capY + 0.9;
  convexSolid(
    b,
    [
      [-1.5, capY, -1.5],
      [1.5, capY, -1.5],
      [1.5, capY, 1.5],
      [-1.5, capY, 1.5],
    ],
    [
      [-0.06, capTop, -0.06],
      [0.06, capTop, -0.06],
      [0.06, capTop, 0.06],
      [-0.06, capTop, 0.06],
    ],
    VERDIGRIS,
  );
  b.cyl(0.24, 0.12, 0.22, 8, 0, capTop + 0.1, 0, VERDIGRIS);

  // Nothing else on the ridge. Two "service stacks" stood at the gable ends
  // here, and neither was a stack: each ran from y = 0 to the ridge as one
  // un-collidable `b.box` with no fireplace under it, so both stood INSIDE the
  // hall and the upper rooms as columns you walked through — and the west one
  // came up through the middle of the grand stair. The chimney above is the
  // real one; see the header.

  // --- what the forest has taken --------------------------------------------
  // Creeper is the whole point of the building being HERE rather than in a
  // village. It is the jungle ruin's `curtain` — strands leafed down their
  // length, longest mid-run — hung from things it could hang from: the
  // gallery's floor band over the arches and down the piers, the cornices
  // over the blank bays, and the veranda roof's eave.
  //
  // Three rules, each learned by breaking it on the first pass of this
  // building, when the growth was flat green boxes:
  //
  // - **Never across an opening.** A strand stops at the arch's band, a door
  //   head or a window's architrave (`floor`), so the growth frames an
  //   opening rather than hanging across it.
  // - **Never through a floor.** The gallery slab runs out to the band, so
  //   growth is banded storey by storey and never one sheet down both.
  // - **Nothing on the roof slopes.** Creeper laid flat on the copper reads
  //   as a HOLE punched through it: the roof is the one large surface the key
  //   light hits square. Growth needs something to hang off.
  const bandOut = 0.24;
  const grown: [Side, number][] = [
    ["-x", 0],
    ["-x", 2],
    ["+z", 0],
    ["-z", 0],
  ];
  for (const [s, i] of grown) {
    const bay = bays.filter((q) => q.s === s && q.c !== porticoZ)[i];
    if (!bay) continue;
    const face = bay.c + PIER / 2;
    curtain(b, s, face, bay.u0 + 0.05, bay.u1 - 0.05, SOFFIT + 0.19, 0.6, bandOut, rnd, (u) => (archTop(u, bay.u0, bay.u1) ?? SPRING) + 0.06);
    curtain(b, s, face, bay.u0 - PIER - 0.05, bay.u0 + 0.05, SOFFIT + 0.19, 3.1, bandOut, rnd, () => POD + 0.25);
  }
  // Down the portico's west column from its entablature.
  curtain(b, "-z", porticoZ + 0.15, -PORTICO_HW - 0.12, -PORTICO_HW + 0.52, EAVE - 0.42, 3.0, 0.03, rnd, () => DECK + 1.2);
  // Over the blank bays, off the cornices: the east upper storey in front of
  // the chimney breast, and the west beside its door.
  const wallFace = CW / 2 + T / 2;
  curtain(b, "+x", wallFace, -6.4, -2.2, 6.87, 2.3, 0.09, rnd, () => DECK + 0.2);
  curtain(b, "-x", wallFace, 1.3, 3.1, 6.87, 1.6, 0.09, rnd, () => DECK + 0.2);
  // A fringe off the veranda roof's eave on the shaded side, kept over
  // head height outboard of the parapet a body leans on to shoot.
  const eave = skirtTop(SKIRT_RUN) - 0.06;
  curtain(b, "+z", CD / 2 + SKIRT_RUN + 0.16, -14, -7, eave, 0.4, 0.04, rnd, () => DECK + 2.1);
  // Green-black runs down the piers under the imposts, where the gallery's
  // water has come down them for a century.
  for (const [px, pz] of piers) {
    const flank = Math.abs(px) > pierX - 0.01;
    const s: Side = flank ? (px > 0 ? "+x" : "-x") : pz > 0 ? "+z" : "-z";
    const plane = (flank ? Math.abs(px) : Math.abs(pz)) + PIER / 2;
    const u = flank ? pz : px;
    for (let k = 0; k < 2; k++) {
      if (rnd() < 0.4) continue;
      const len = 0.4 + rnd() * 1.4;
      onFace(b, s, plane, u + (rnd() - 0.5) * 0.36, SPRING - 0.13 - len / 2, 0.03 + rnd() * 0.04, len, 0.004, 0.002, MOSS_STONE);
    }
  }
  // Ferns round the foot of the apron, where it meets the forest floor: never
  // across the front steps or under the service stair.
  const apronX = FW / 2 + 1.1;
  const apronZ = FD / 2 + 1.1;
  for (let i = 0; i < 7; i++) {
    const onX = rnd() < 0.57;
    const side = rnd() < 0.5 ? -1 : 1;
    const t = rnd() * 2 - 1;
    const [x, z] = onX ? [t * apronX, side * (apronZ + 0.2)] : [side * (apronX + 0.2), t * apronZ];
    if (z < 0 && Math.abs(x) < PORTICO_HW + 1.6) continue;
    if (x > 0 && Math.abs(x) > apronX && z > LANDING_Z - 2 && z < svcFootZ + 1) continue;
    fern(b, x, 0.02, z, 0.7 + rnd() * 0.35, rnd);
  }
  // Moss creeping up out of the podium's own joints — the joint being the
  // 0.85 m of apron left standing outside the base course, which is the only
  // band on this footprint where a flat mat lies on ONE surface. The first
  // pass laid 1.6 m patches across both steps at once: buried in the course at
  // one edge, hanging 0.23 m over bare ground at the other.
  //
  // Broken into runs rather than laid as one strip, and for a reason peculiar
  // to a mat lying face up: `skyLightColor` is applied by `n.y` and never
  // gated by the shadow map, so a horizontal surface takes the hemispheric
  // term at full strength and the green comes back pale. A long even rectangle
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
  // the point at which the hall's two lanterns come down to one. The door's
  // bracket lamps are glow only for that reason.
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

/**
 * A band of render round a semicircular opening of radius `r` centred at
 * (`x`, `y`) on the plane z = `z` facing -Z: `wide` across and `proud` out.
 */
function arcRing(sheet: Sheet, x: number, y: number, r: number, z: number, wide: number, proud: number): void {
  const n = 12;
  const out: Point3 = [0, 0, -1];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * i) / n;
    const c = (Math.PI * (i + 1)) / n;
    const p = (t: number, rr: number, dz: number): Point3 => [x - rr * Math.cos(t), y + rr * Math.sin(t), z - dz];
    sheet.quad(p(a, r, proud), p(c, r, proud), p(c, r + wide, proud), p(a, r + wide, proud), out);
    const m = (a + c) / 2;
    sheet.quad(p(a, r, 0), p(c, r, 0), p(c, r, proud), p(a, r, proud), [Math.cos(m), -Math.sin(m), 0]);
    sheet.quad(p(a, r + wide, 0), p(c, r + wide, 0), p(c, r + wide, proud), p(a, r + wide, proud), [-Math.cos(m), Math.sin(m), 0]);
  }
}
