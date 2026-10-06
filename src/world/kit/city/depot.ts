/**
 * kit/city/depot.ts — buildDepot: one goods-shed volume with a gallery round
 * the back of it, drawn by `drawDepot`, and `stencil`, the block lettering of
 * its sign, its bay numbers and its date stone. Part of the downtown set: follows the contract in kit/core.ts and
 * the set's rules in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildParams,
  type Structure,
  ALLOY,
  ASHLAR,
  CITY_BRICK,
  CONCRETE,
  DARK_CONCRETE,
  ENAMEL,
  IRON,
  PLANK,
  ROAD_PAINT,
  SLATE,
  TEAK,
  WINDOW_LIGHT,
  StoneBatch,
  carve,
  streetSeed,
  HIDE_UNDER,
  hideBack,
  outward,
  runsAlongX,
  type Side,
} from "../core";
import {
  SLAB,
  WALL,
  GRADE,
  RISER,
  GROUND,
  DOORWAY,
  HIDE_TOP,
} from "./shared";

/**
 * The goods depot: one big brick shed with a gallery round the back of it, and
 * the third kind of interior this map has.
 *
 * ## What it is FOR, given the office and the parkade
 *
 * The three enterable buildings on Coldharbour are three different questions.
 * The office is a stack of rooms you clear one storey at a time. The parkade
 * is three open platforms that all shoot each other. This is neither: it is
 * ONE VOLUME 28 m across with a mezzanine along the back of it, so the whole
 * interior is visible from the whole interior and the only thing that changes
 * is whether you are eight metres up. Cover is the crates and the columns and
 * nothing else, and the mezzanine is a firing platform over the lot of it with
 * exactly one stair to it.
 *
 * What that makes it is a room worth throwing a grenade into, which is a thing
 * the map otherwise has none of.
 *
 * ## The ways in, and why there are three
 *
 * The loading elevation faces +Z and is mostly opening: a run of roller bays
 * between brick piers, tall enough and wide enough that a body walks straight
 * in without a doorway ever being mentioned. One bay is shuttered, which is
 * what stops the frontage reading as a colonnade and gives the elevation
 * somewhere for a round to stop.
 *
 * The third is a personnel door in the -X gable, opening UNDER the gallery.
 * That is deliberate and it is the building's one asymmetry: the bays put you
 * on the floor in front of everybody on the gallery, and the side door puts
 * you beneath them, where a gallery that faces the hall over a solid rail
 * cannot look.
 *
 * **It stands where the stair is NOT, and for a long time it did not.** The
 * stair's lane runs the whole -X gable, so a doorway anywhere along the flight
 * opens onto the side of it: the door stood at `d * 0.24`, where the flight is
 * 0.8-1.4 m up, a body walked 0.4 m into the wall's thickness and stopped, and
 * the nav graph never linked the doorway to the street — a door nobody and
 * nothing could use, said to stand at the stair's foot. The foot leaves only
 * 1.3 m of floor before the front wall, which no `DOORWAY` fits. Under the
 * gallery there is 3.1 m of headroom and no flight at all.
 *
 * ## The mezzanine, and the one number the plate has to hold
 *
 * `MEZZ_D` deep along the -Z wall, spanning the full width, with the flight
 * climbing toward it up a lane at the -X end. It climbs **-Z**, which is the
 * one flight in this set that does — the loading front has to stay clear, so
 * the stair runs back from it — and that is why this does not go through
 * `laneFlight`, whose whole contract is that a lane climbs +Z.
 *
 * So the depth is what has to hold `MEZZ_D + run + 0.6`, and DEV throws rather
 * than pushing a stair through the loading elevation. There is no landing at
 * the head, and there does not need to be one: the mezzanine slab IS the
 * landing, because the flight arrives at its front edge rather than into a
 * void the way a lane's does.
 *
 * ## The roof is a sawtooth, and it is the silhouette that does the work
 *
 * Three teeth, each a pitched slab with a glazed face standing up at its high
 * end. It is the one roof shape in the kit that is neither flat nor gabled,
 * which is most of why this reads as industry from four hundred metres away on
 * a map with no fog to hide the far side of. The glazing is decoration on the
 * same terms as a tower's curtain wall — there is a roof void behind it and
 * nothing anybody can get to — so none of it breaks.
 *
 * The gable walls run past the eaves to the tops of the teeth, which is what
 * closes the triangles at each end. Cut them at the eaves instead and the shed
 * has three slots in it you can see the sky through from inside.
 */
export function buildDepot(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "depot");
  const w = p.width ?? 28;
  const d = p.depth ?? 16;
  /** Wall head, where the sawtooth springs from. */
  const eaves = p.height ?? 8;
  /** How far a tooth climbs above the eaves. */
  const TOOTH = 1.9;
  /** The gallery's walked height, and how far it reaches out from the back. */
  const MEZZ = 3.8;
  const MEZZ_D = 4.0;
  /** Stair lane at the -X end. `buildOffice`'s width, for its reason. */
  const lane = 3.4;
  /** Clear opening of a roller bay. */
  const OPEN = 4.6;

  const zBack = -d / 2 + WALL / 2;
  const zFront = d / 2 - WALL / 2;
  /** The gallery's front edge — where the flight arrives. */
  const zMezz = zBack + MEZZ_D;
  const laneCx = -w / 2 + WALL / 2 + lane / 2;
  const laneInner = -w / 2 + WALL / 2 + lane;
  const rise = MEZZ - GROUND;
  const run = rise / GRADE;
  const pitch = Math.atan(GRADE);
  const steps = Math.max(4, Math.round(rise / RISER));
  /** The gables run past the eaves to the top of the teeth — see the header. */
  const gableH = eaves + TOOTH;
  /**
   * Where along the -X gable the personnel door stands: under the middle of
   * the gallery, clear of the stair's lane — see the header.
   */
  const doorAt = zBack + MEZZ_D / 2;
  const bays = Math.max(2, Math.round(w / 7));
  const pierW = 1.6;
  const bayW = (w - pierW * (bays + 1)) / bays;
  const cols = Math.max(1, Math.round(w / 13));
  const colXs: number[] = [];
  for (let i = 1; i <= cols; i++) colXs.push(-w / 2 + (i / (cols + 1)) * w);
  const colZ = d * 0.16;
  const office = { x: w * 0.24, z: zBack + MEZZ_D / 2 };
  // Pallets and crates: the floor's cover, and what stops 28 m of concrete
  // being a shooting gallery. Under `CoverMap`'s 1.7 m line except the tall
  // stack, which is over it on purpose — one piece of hard cover in the room.
  const stacks: [number, number, number, number, number][] = [
    // [w, h, d, x, z]
    [2.6, 1.5, 2.2, -w * 0.24, d * 0.26],
    [3.2, 1.2, 2.4, w * 0.3, d * 0.3],
    [2.2, 2.1, 2.2, w * 0.04, -d * 0.06],
  ];
  const teeth = Math.max(2, Math.round(d / 5.5));

  if (import.meta.env.DEV && zMezz + run + 0.6 > zFront) {
    throw new Error(
      `depot: a ${d} m plate cannot hold a ${MEZZ_D} m gallery and the ` +
        `${run.toFixed(1)} m flight up to it — the stair would run out through ` +
        "the loading elevation. See buildDepot.",
    );
  }

  // Drawn FIRST: it emits no collider, and the merge keeps emission order, so
  // the brickwork, the steel and the fittings go down before the masses they
  // hide. Everything below this line is a collider and the box it wears.
  drawDepot(b, {
    w,
    d,
    eaves,
    tooth: TOOTH,
    mezz: MEZZ,
    mezzD: MEZZ_D,
    zBack,
    zMezz,
    lane,
    laneCx,
    laneInner,
    run,
    pitch,
    steps,
    open: OPEN,
    gableH,
    doorAt,
    bays,
    pierW,
    bayW,
    colXs,
    colZ,
    office,
    stacks,
    teeth,
    pitchZ: d / teeth,
    lit: !!p.litWindows,
  });

  // --- walked surfaces first (set's header, first rule) ---------------------

  // The floor. Inside `HEIGHT_EPS` of the street, so the nav grid merges it
  // with the ground rather than spending a slot, and inside `stepHeight`, so
  // every roller bay links to the pavement without a ramp. See `GROUND`.
  b.box(w, SLAB, d, 0, GROUND - SLAB / 2, 0, DARK_CONCRETE);
  b.block({ w, h: SLAB, d, x: 0, y: GROUND - SLAB / 2, z: 0 });

  // The gallery: one slab the full width, so the flight arrives on it at its
  // front edge and there is no landing to get right.
  b.box(w - WALL, SLAB, MEZZ_D, 0, MEZZ - SLAB / 2, zBack + MEZZ_D / 2, CONCRETE);
  b.block({ w: w - WALL, h: SLAB, d: MEZZ_D, x: 0, y: MEZZ - SLAB / 2, z: zBack + MEZZ_D / 2 });

  // The flight, climbing -Z. Overrunning its own foot by 0.6 m, which
  // `Build.flight` buries: every tread under the ground line is skipped.
  // `drawn: false` — the steel stair over it is `drawDepot`'s.
  b.flight({
    x: laneCx,
    w: lane,
    topZ: zMezz,
    topY: MEZZ,
    run: run + 0.6,
    rise: rise + 0.6 * GRADE,
    dir: -1,
    steps,
    color: ALLOY,
    drawn: false,
  });

  // --- cover and enclosure --------------------------------------------------

  // The gallery's rail, and the stair's. Both are `guard`s rather than boxes
  // on the edge: a rail has to stop a body (a rail you walk through is a
  // three-metre fall) and has to stand OFF the surface it guards, or the nav
  // grid loses the cell it samples. The run stops at the lane, which is where
  // the stair arrives and the one place the gallery is meant to be open.
  const railLen = w / 2 - WALL / 2 - laneInner;
  b.guard("+z", zMezz, laneInner + railLen / 2, railLen, MEZZ, { color: ALLOY });
  b.guard("+x", laneInner, zMezz + run / 2, run, MEZZ - (run / 2) * GRADE, {
    pitch: -pitch,
    color: ALLOY,
  });

  // The back and the +X gable, solid. The gables run past the eaves to the top
  // of the teeth — see the header, or the shed has slots of sky in it.
  b.wall(w, eaves, WALL, 0, eaves / 2, -d / 2, CITY_BRICK);
  b.wall(WALL, gableH, d, w / 2, gableH / 2, 0, CITY_BRICK);

  // The -X gable, with the personnel door cut by hand: this wall runs along Z
  // and `doorWall` runs along X, so it is the two jambs and the lintel that
  // method would emit. The doorway opens under the gallery.
  {
    const gap = DOORWAY;
    const at = doorAt;
    const lo = -d / 2;
    const hi = d / 2;
    const back = at - gap / 2 - lo;
    const front = hi - (at + gap / 2);
    b.wall(WALL, gableH, back, -w / 2, gableH / 2, lo + back / 2, CITY_BRICK);
    b.wall(WALL, gableH, front, -w / 2, gableH / 2, hi - front / 2, CITY_BRICK);
    b.wall(WALL, gableH - 2.4, gap, -w / 2, 2.4 + (gableH - 2.4) / 2, at, CITY_BRICK);
  }

  // The loading elevation: brick piers, a header over the lot of them, and one
  // bay shuttered. The bays are left as OPENINGS rather than doorways — at
  // 4.6 m of clear height there is nothing for a lintel to do that the header
  // above is not already doing.
  for (let i = 0; i <= bays; i++) {
    b.wall(pierW, eaves, WALL, -w / 2 + pierW / 2 + i * (pierW + bayW), eaves / 2, d / 2, CITY_BRICK);
  }
  b.wall(w, eaves - OPEN, WALL, 0, OPEN + (eaves - OPEN) / 2, d / 2, CITY_BRICK);
  // The shut bay.
  b.wall(bayW, OPEN, 0.18, -w / 2 + pierW + bayW / 2, OPEN / 2, d / 2 + 0.1, ENAMEL);

  // Columns, full height and one box each: a column is solid at every level,
  // so one box blocks the floor and the roof void together. The parkade's
  // argument, in a building with one floor to block.
  for (const x of colXs) b.wall(0.5, eaves, 0.5, x, eaves / 2, colZ, ALLOY);

  // The site office, tucked under the gallery. One box — it is cover in the
  // middle of an otherwise empty floor, and the only thing under the
  // mezzanine worth walking behind.
  b.wall(5.0, 2.7, 3.2, office.x, GROUND + 1.35, office.z, ENAMEL);

  for (const [cw, ch, cd, cx, cz] of stacks) b.wall(cw, ch, cd, cx, GROUND + ch / 2, cz, PLANK);

  // --- the roof, LAST -------------------------------------------------------
  // The collider is ONE flat slab at the eaves rather than the teeth —
  // `gableRoof`'s call, for `gableRoof`'s reason: nothing walks up there and a
  // round only has to stop. Its underside is where `drawDepot` hangs the
  // ceiling, so a round fired up inside stops where it is seen to.
  b.block({ w: w + 0.4, h: 0.4, d: d + 0.4, x: 0, y: eaves + 0.2, z: 0 });

  if (p.litWindows) {
    // Two, for `buildOffice`'s reason: this is a deep enclosed room on a
    // daylit map, and the sky term lands on the floor and not at all on the
    // ceiling — so an unlit shed reads as a bright plate under a black lid.
    // One over the floor and one over the gallery, which is the storey the
    // clerestory is furthest from.
    //
    // **The hall's one hangs AT THE GIRDERS rather than over head height**,
    // and that is what makes the ceiling read at all. Everything above the
    // point lights is on the ambient term alone in here: the sky term is zero
    // on a downward normal and the key is shadowed out by the roof, so the
    // ceiling and the steelwork are lit by this lamp or by nothing. Hung at
    // 5.6 m it lit the floor and left a black lid four metres over the
    // gallery; hung under the girders it lights both, which is also where a
    // high bay actually goes — `drawDepot` draws its fittings there.
    b.light(WINDOW_LIGHT, 24, 0.75, 0.02, 0, eaves - 1.1, d * 0.16);
    // The gallery's own, and it hangs mid-span rather than off to one side for
    // the same reason: a 27 m gallery lit from one end is a gallery whose far
    // half is on the ambient term. High, so it reaches the ceiling too.
    b.light(WINDOW_LIGHT, 20, 0.6, 0.02, 0, MEZZ + 3.2, zBack + MEZZ_D / 2);
  }
  return b;
}

/**
 * Block letters and figures as strokes on a 3 x 5 grid, x to the right and y
 * up: `[x0, y0, x1, y1]` per stroke. Painted words and cast dates — what a
 * depot's fascia, its bay numbers and its datestone say. Only the characters
 * something here spells; a new word adds its letters.
 */
const STENCIL: Record<string, readonly (readonly [number, number, number, number])[]> = {
  G: [[0, 4, 3, 5], [0, 0, 1, 5], [0, 0, 3, 1], [2, 0, 3, 2.6], [1.6, 2, 3, 2.8]],
  O: [[0, 4, 3, 5], [0, 0, 3, 1], [0, 0, 1, 5], [2, 0, 3, 5]],
  D: [[0, 0, 1, 5], [0, 4, 2.1, 5], [0, 0, 2.1, 1], [2, 0.6, 3, 4.4]],
  S: [[0, 4, 3, 5], [0, 2, 1, 5], [0, 2, 3, 3], [2, 0, 3, 3], [0, 0, 3, 1]],
  E: [[0, 0, 1, 5], [0, 4, 3, 5], [0, 2, 2.3, 3], [0, 0, 3, 1]],
  P: [[0, 0, 1, 5], [0, 4, 3, 5], [0, 2, 3, 3], [2, 2, 3, 5]],
  T: [[0, 4, 3, 5], [1, 0, 2, 5]],
  F: [[0, 0, 1, 5], [0, 4, 3, 5], [0, 2, 2.3, 3]],
  I: [[1, 0, 2, 5], [0.3, 4, 2.7, 5], [0.3, 0, 2.7, 1]],
  C: [[0, 4, 3, 5], [0, 0, 1, 5], [0, 0, 3, 1]],
  "0": [[0, 4, 3, 5], [0, 0, 3, 1], [0, 0, 1, 5], [2, 0, 3, 5]],
  "1": [[1, 0, 2, 5], [0.2, 3.7, 1, 4.6], [0.3, 0, 2.7, 1]],
  "2": [[0, 4, 3, 5], [2, 2, 3, 5], [0, 2, 3, 3], [0, 0, 1, 3], [0, 0, 3, 1]],
  "3": [[0, 4, 3, 5], [0.7, 2, 3, 3], [0, 0, 3, 1], [2, 0, 3, 5]],
  "4": [[0, 2, 1, 5], [0, 2, 3, 3], [2, 0, 3, 5]],
  "5": [[0, 4, 3, 5], [0, 2, 1, 5], [0, 2, 3, 3], [2, 0, 3, 3], [0, 0, 3, 1]],
  "6": [[0, 4, 3, 5], [0, 0, 1, 5], [0, 2, 3, 3], [2, 0, 3, 3], [0, 0, 3, 1]],
  "7": [[0, 4, 3, 5], [2, 0, 3, 5]],
  "8": [[0, 4, 3, 5], [0, 2, 3, 3], [0, 0, 3, 1], [0, 0, 1, 5], [2, 0, 3, 5]],
  "9": [[0, 4, 3, 5], [0, 2, 3, 3], [0, 0, 3, 1], [0, 2, 1, 5], [2, 0, 3, 5]],
};

/**
 * `text` laid on face `s` in `STENCIL`'s strokes, centred on `(uc, yc)` with
 * `cell` the size of one grid square. Read left to right as the face is
 * LOOKED at: a face's u runs from the viewer's right on +Z and on -X, so there
 * the line is laid backwards (the tower's ghost sign found this first).
 */
function stencil(
  sb: StoneBatch,
  s: Side,
  plane: number,
  uc: number,
  yc: number,
  cell: number,
  text: string,
  thick: number,
  out: number,
  color: string,
  hide: number,
): void {
  const dir = s === "+z" || s === "-x" ? -1 : 1;
  const pitch = cell * 4.2;
  const total = text.length * pitch - cell * 1.2;
  let u0 = uc - (dir * total) / 2;
  for (const ch of text) {
    for (const [x0, y0, x1, y1] of STENCIL[ch] ?? []) {
      const ua = u0 + dir * x0 * cell;
      const ub = u0 + dir * x1 * cell;
      const yy = yc + ((y0 + y1) / 2 - 2.5) * cell;
      sb.onFace(s, plane, (ua + ub) / 2, yy, (x1 - x0) * cell, (y1 - y0) * cell, thick, out, color, 0, 0, hide);
    }
    u0 += dir * pitch;
  }
}

/** Everything `drawDepot` reads off `buildDepot`'s plan. */
interface DepotPlan {
  w: number;
  d: number;
  eaves: number;
  tooth: number;
  mezz: number;
  mezzD: number;
  zBack: number;
  zMezz: number;
  lane: number;
  laneCx: number;
  laneInner: number;
  /** The flight's horizontal run from the floor to the gallery, its pitch and treads. */
  run: number;
  pitch: number;
  steps: number;
  open: number;
  gableH: number;
  doorAt: number;
  bays: number;
  pierW: number;
  bayW: number;
  colXs: readonly number[];
  colZ: number;
  office: { x: number; z: number };
  stacks: readonly (readonly [number, number, number, number, number])[];
  teeth: number;
  pitchZ: number;
  lit: boolean;
}

/**
 * Everything on the depot that is DRAWING, and what it draws it as: an
 * interwar railway goods shed — a brick box on a tarred plinth, its walls
 * ruled into bays by pilasters and lit by steel windows under segmental brick
 * arches, a corbel table and a stone cornice at the eaves, a north-light roof
 * of sheeted teeth, and inside, a steel frame, a steel stair and the fittings
 * of a working floor. It read as a flat red box with holes in the front and a
 * strip of glass under the eaves — and the clerestory that strip was meant to
 * be was drawn centred in the wall, inside the brick, so none of it showed
 * from either side. It emits no collider (`npm run kit:hash`).
 *
 * - **The brick elevations** (the back and both gables) are bays: a pilaster
 *   on every bay line with a stone cap where it meets the corbel table, a
 *   steel window centred in every bay, a stone sill course tying the sills
 *   together, and a tarred plinth with an air brick per bay. The gables' bays
 *   are the ROOF's — a pilaster stands under every valley, where the gutter
 *   comes out, and the downpipe runs down beside it — and the back's are its
 *   own, four to five metres. Over the eaves a gable stands on as a parapet
 *   with a stone coping and a datestone with the year cast in it.
 * - **The windows** are small-paned steel lights at the BACK of a reveal: the
 *   glass on the wall face, the frame and bars standing on it, brick jambs
 *   and a segmental arch of voussoirs round it with a stone keystone, and a
 *   stone sill under it. About a third have one light hopped open. Each is
 *   drawn again on the inside face, with a concrete sill and lintel.
 * - **The corners** are FILLED and stand proud as piers: four walls meeting
 *   on their centre lines left a 0.2 m notch at each, and above the eaves the
 *   gable's end stood back from the face below it.
 * - **The loading front**: every bay gets its shutter box (the shut one had
 *   none), with its bay number painted on it; the shut shutter is slatted
 *   across as a roller shutter is, rather than ribbed down, with a bottom rail,
 *   lifting handles and a padlock; an open one shows its bottom rail under the
 *   box. The piers' feet are painted white with black bands for drivers, and
 *   carry a stone impost where the header springs; a gooseneck lamp hangs on
 *   each pier between bays. The fascia is lettered GOODS DEPOT in a painted
 *   border, and the hoist beam gets a wall plate, a strut under it and a hook.
 * - **The side door** is a pair of steel leaves folded back flat against the
 *   gable, in brick jambs under a stone lintel, under a steel hood on two
 *   brackets with a lamp under it, on a concrete step.
 * - **The roof**: the teeth sheeted in ribs, closer glazing bars on the north
 *   lights, the ridge caps on the RIDGES (they stood on the valleys, the first
 *   one floating 1.9 m over the back eaves), and the two ventilators stood on
 *   the slope on curbs (they hovered over it).
 * - **Inside**: a CEILING at the underside of the roof's collider, carried by
 *   a steel girder under every valley — bearing on stone padstones and, on the
 *   +X gable, on internal piers — and joists on the back's bay lines, with a
 *   high-bay lamp hung from each girder and a pendant over the gallery. The
 *   ceiling is where it is because the collider is: the roof stops a round at
 *   the eaves, and a round fired up inside must stop where it is SEEN to,
 *   which with the teeth open over the hall it would not. Before this the same
 *   lid was the cornice box, 0.41 m lower and black. The columns carry flange
 *   plates and painted feet. The gallery has a channel on its edge, downstand
 *   beams under it and posts and a capping rail on its guard; the stair is
 *   steel — two stringers, open treads with painted nosings, a capping rail
 *   on its guard and a handrail on the gable. The
 *   site office gets a framed window, a framed door with a vision panel and a
 *   kick plate, a sign over the door and a clock on the gallery over it. The
 *   floor is painted — the loading line, the gallery's edge and a hatched box
 *   at the stair's foot — and carries empty pallets; the crate stacks stand
 *   on pallets, with corner battens and a lot number; the back wall under the
 *   gallery has an electrical board with its conduit, a notice board and a
 *   pallet leaning on it.
 *
 * ## The rules the drawing keeps
 *
 * **The drawing moves no collider** — the one collider this rework moved is the
 * side door's, in `buildDepot` (see its header). Everything here is on a face —
 * trim within the kit's budget, the deepest being the pilasters at 14 cm, the
 * downpipes 24 cm, the door leaves folded flat at 13 cm — low enough to walk
 * over (the painted floor at 12 mm, a pallet at 14 cm, two stacked at 25 cm,
 * the door step at 10 cm), overhead (the lamps clear the floor by 2.6 m and
 * the gallery by 2.6 m, the gallery's beams leave 2.75 m under them, the clock
 * 2.5 m, the door's hood 2.7 m), or on top of a collider (the gable copings,
 * the rails' capping, the office's roof). Nothing stands in the doorway: the
 * stair is not in front of it, and the door's leaves fold back beside it.
 *
 * Seeded off the params (`streetSeed`) as the parkade is: which windows have a
 * light open, which lamps are dead, the year on the datestone, what is pinned
 * on the notice board and the lot numbers. Not in `CONFORMS_TO_TERRAIN` — the
 * one thing that reaches the ground outside is the door step, and the shed is
 * laid on made ground by every layout that places one.
 *
 * **One colour is new to the depot**, `ASHLAR`, for the stone dressings — the
 * downtown's one light value at street level, which is what a cornice and a
 * keystone are on a brick wall — plus the `WINDOW_LIGHT` lenses of a lit
 * placement. Everything else is a colour it already wore. Batched through
 * `StoneBatch` (lenses through `flushGlow`).
 */
function drawDepot(b: Build, t: DepotPlan): void {
  const { w, d, eaves, tooth, mezz, zBack, zMezz, open, gableH, teeth, pitchZ } = t;
  // Well over a thousand boxes, and as parts each is a mesh for the merge to
  // build and throw away (`drawOffice`'s reason). Lenses in a batch of their own.
  const sb = new StoneBatch();
  const lens = new StoneBatch();
  const rnd = mulberry32(streetSeed(w, d, eaves + (t.lit ? 0.5 : 0)));
  const HW = WALL / 2;
  /** How far face `s`'s wall stands from the centre: its centre line. */
  const half = (s: Side): number => (runsAlongX(s) ? d : w) / 2;
  /** Half the length of face `s`'s run, centre line to centre line. */
  const span = (s: Side): number => (runsAlongX(s) ? w : d) / 2;
  const opp = (s: Side): Side => (s === "-z" ? "+z" : s === "+z" ? "-z" : s === "-x" ? "+x" : "-x");
  /** A member laid on the OUTSIDE of wall `s`, its centre `out` past the face. */
  const face = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
    hide = 0,
    tilt = 0,
  ): void => sb.onFace(s, half(s) + HW, u, y, along, tall, thick, out, color, tilt, 0, hide);
  /** The same on wall `s`'s INSIDE face, `out` into the room. */
  const inside = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
    hide = 0,
    tilt = 0,
  ): void => sb.onFace(opp(s), -(half(s) - HW), u, y, along, tall, thick, out, color, tilt, 0, hide);
  /** A lens where the placement is lit, and the same glass dark where it is not. */
  const lamp = (lw: number, lh: number, ld: number, x: number, y: number, z: number): void => {
    if (t.lit) lens.box(lw, lh, ld, x, y, z, WINDOW_LIGHT);
    else sb.box(lw, lh, ld, x, y, z, DARK_CONCRETE);
  };
  const doorLo = t.doorAt - DOORWAY / 2;
  const doorHi = t.doorAt + DOORWAY / 2;
  /** Within `m` of the -X doorway, along that gable. */
  const nearDoor = (s: Side, u: number, m: number): boolean => s === "-x" && u > doorLo - m && u < doorHi + m;

  // The elevations' bays. The back's are its own; the gables' are the roof's,
  // one per tooth, so every valley comes down on a pilaster.
  const backN = Math.max(3, Math.round(w / 4.7));
  const bayOf = (s: Side): { n: number; pitch: number } =>
    s === "-z" ? { n: backN, pitch: w / backN } : { n: teeth, pitch: pitchZ };
  const lines = (s: Side): number[] => {
    const { n, pitch } = bayOf(s);
    const out: number[] = [];
    for (let i = 1; i < n; i++) out.push(-span(s) + i * pitch);
    return out;
  };
  const centres = (s: Side): number[] => {
    const { n, pitch } = bayOf(s);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(-span(s) + (i + 0.5) * pitch);
    return out;
  };
  /** A pilaster's line, unless it would stand in the side door or its leaves. */
  const pilasters = (s: Side): number[] => lines(s).filter((u) => !nearDoor(s, u, 1.5));

  const PLINTH = 0.9;
  /** The windows' sill and springing line, and the rise of the arch over them. */
  const winLo = eaves - 2.7;
  const winHi = eaves - 1.2;
  const ARCH = 0.22;
  const F = 0.06;

  /** A steel window at the back of its reveal, on the outside of wall `s`. */
  const steelWindow = (s: Side, u: number, ww: number): void => {
    const hb = hideBack(s);
    const wh = winHi - winLo;
    const R = (ww * ww) / 4 / (2 * ARCH) + ARCH / 2;
    const cy = winHi + ARCH - R;
    const tMax = Math.asin(ww / 2 / R);
    /** How high the arch's soffit stands `du` from the window's centre line. */
    const soffit = (du: number): number => cy + Math.sqrt(R * R - du * du);
    // The glass, on the wall face and up into the arch: the voussoirs lap its
    // top corners. `backed`, as the clerestory always was — brick behind it.
    const c = outward(s) * (half(s) + HW + 0.02);
    const gh = wh + ARCH;
    const gy = winLo + gh / 2;
    if (runsAlongX(s)) b.pane(ww, gh, 0.04, u, gy, c, { backed: CITY_BRICK });
    else b.pane(0.04, gh, ww, c, gy, u, { backed: CITY_BRICK });
    // The frame, three rows of lights and a fan of bars into the arch.
    for (const e of [-1, 1]) face(s, u + e * (ww / 2 - F / 2), gy, F, gh, 0.05, 0.065, IRON, hb);
    face(s, u, winLo + F / 2, ww, F, 0.05, 0.065, IRON, hb);
    for (const k of [1, 2, 3]) face(s, u, winLo + (k * wh) / 3, ww - 2 * F, 0.035, 0.04, 0.06, IRON, hb);
    const nv = Math.max(3, Math.round(ww / 0.55));
    for (let k = 1; k < nv; k++) {
      const du = -ww / 2 + (k * ww) / nv;
      const top = soffit(du);
      face(s, u + du, (winLo + top) / 2, 0.035, top - winLo, 0.04, 0.06, IRON, hb);
    }
    // One light in the middle row hopped open on about a third of them, hung
    // from its bottom rail and leaning out.
    if (rnd() < 0.35) {
      const k = 1 + Math.floor(rnd() * (nv - 2));
      const du = -ww / 2 + ((k + 0.5) * ww) / nv;
      const pw = ww / nv - 0.05;
      const ph = wh / 3 - 0.05;
      const a = 0.4;
      const o = outward(s) * (half(s) + HW + 0.09 + (Math.sin(a) * ph) / 2);
      const yc = winLo + wh / 3 + 0.025 + (Math.cos(a) * ph) / 2;
      if (runsAlongX(s)) sb.box(pw, ph, 0.03, u + du, yc, o, IRON, { x: outward(s) * a });
      else sb.box(0.03, ph, pw, o, yc, u + du, IRON, { z: -outward(s) * a });
    }
    // The reveal: brick jambs, a stone sill, and the arch — voussoirs on the
    // arc, the middle one a stone keystone standing proud of the rest.
    for (const e of [-1, 1]) face(s, u + e * (ww / 2 + 0.11), (winLo + winHi) / 2, 0.22, wh, 0.1, 0.05, CITY_BRICK, hb | HIDE_UNDER);
    face(s, u, winLo - 0.05, ww + 0.4, 0.1, 0.15, 0.075, ASHLAR, hb);
    const Rm = R + 0.15;
    const n = Math.max(7, 2 * Math.round((tMax * Rm) / 0.3) + 1);
    const step = (2 * tMax) / n;
    for (let k = 0; k < n; k++) {
      const th = -tMax + (k + 0.5) * step;
      const key = k === (n - 1) / 2;
      face(
        s,
        u + Rm * Math.sin(th),
        cy + Rm * Math.cos(th) + (key ? 0.03 : 0),
        step * Rm - 0.025,
        key ? 0.38 : 0.3,
        key ? 0.14 : 0.1,
        key ? 0.07 : 0.05,
        key ? ASHLAR : CITY_BRICK,
        hb,
        -th,
      );
    }
  };

  /** The same window from inside: glass, frame and bars, a sill and a lintel. */
  const innerWindow = (s: Side, u: number, ww: number): void => {
    const hb = hideBack(opp(s));
    const wh = winHi - winLo;
    const ym = (winLo + winHi) / 2;
    const c = outward(opp(s)) * (-(half(s) - HW) + 0.02);
    if (runsAlongX(s)) b.pane(ww, wh, 0.04, u, ym, c, { backed: CITY_BRICK });
    else b.pane(0.04, wh, ww, c, ym, u, { backed: CITY_BRICK });
    for (const e of [-1, 1]) inside(s, u + e * (ww / 2 - F / 2), ym, F, wh, 0.05, 0.065, IRON, hb);
    for (const e of [-1, 1]) inside(s, u, ym + e * (wh / 2 - F / 2), ww - 2 * F, F, 0.05, 0.065, IRON, hb);
    for (const k of [1, 2]) inside(s, u, winLo + (k * wh) / 3, ww - 2 * F, 0.035, 0.04, 0.06, IRON, hb);
    const nv = Math.max(3, Math.round(ww / 0.55));
    for (let k = 1; k < nv; k++) inside(s, u - ww / 2 + (k * ww) / nv, ym, 0.035, wh - 2 * F, 0.04, 0.06, IRON, hb);
    inside(s, u, winLo - 0.04, ww + 0.2, 0.08, 0.12, 0.06, CONCRETE, hb);
    inside(s, u, winHi + 0.15, ww + 0.4, 0.3, 0.05, 0.025, CONCRETE, hb);
  };

  // --- the brick elevations: the back and both gables ------------------------

  for (const s of ["-z", "-x", "+x"] as const) {
    const hb = hideBack(s);
    const h = span(s);
    const pils = pilasters(s);
    const door: [number, number][] = s === "-x" ? [[doorLo - 0.22, doorHi + 0.22]] : [];
    // The plinth: tarred, which is what the foot of a brick shed is, with a
    // set-back course on top so the step reads as a weathering.
    for (const [a, z] of carve(-h + HW, h - HW, door)) {
      face(s, (a + z) / 2, PLINTH / 2, z - a, PLINTH, 0.07, 0.035, DARK_CONCRETE, hb | HIDE_UNDER);
      face(s, (a + z) / 2, PLINTH + 0.03, z - a, 0.06, 0.035, 0.0175, DARK_CONCRETE, hb);
    }
    // Pilasters on the bay lines, each on a plinth block, under a stone cap
    // where it meets the corbel table.
    const pilTop = eaves - 0.64;
    for (const u of pils) {
      face(s, u, pilTop / 2, 0.56, pilTop, 0.14, 0.07, CITY_BRICK, hb | HIDE_UNDER);
      face(s, u, PLINTH / 2, 0.68, PLINTH, 0.2, 0.1, DARK_CONCRETE, hb | HIDE_UNDER);
      face(s, u, pilTop + 0.11, 0.66, 0.22, 0.2, 0.1, ASHLAR, hb);
    }
    // The sill course, between the pilasters, a hand under the sills.
    for (const [a, z] of carve(-h + HW, h - HW, pils.map((u): [number, number] => [u - 0.28, u + 0.28]))) {
      face(s, (a + z) / 2, winLo - 0.16, z - a, 0.1, 0.06, 0.03, ASHLAR, hb);
    }
    // A window in every bay, from both sides; an air brick in the plinth.
    const { pitch } = bayOf(s);
    for (const u of centres(s)) {
      steelWindow(s, u, pitch - 1.7);
      innerWindow(s, u, pitch - 1.7);
      if (!nearDoor(s, u, 0.4)) face(s, u, 0.45, 0.24, 0.16, 0.08, 0.04, IRON, hb);
    }
  }

  // Tie plates on the back, where the gallery's beams are anchored through it.
  for (const u of centres("-z")) {
    const hb = hideBack("-z");
    for (const a of [-Math.PI / 4, Math.PI / 4]) face("-z", u, mezz - 0.25, 0.46, 0.06, 0.025, 0.0125, IRON, hb, a);
    face("-z", u, mezz - 0.25, 0.09, 0.09, 0.06, 0.03, IRON, hb);
  }

  // The corbel table, the bed course over it and the stone cornice, round all
  // four sides. The dentils stop at the pilasters, which rise into the table.
  for (const s of ["-z", "+z", "-x", "+x"] as const) {
    const hb = hideBack(s);
    const h = span(s);
    const cuts = s === "+z" ? [] : pilasters(s).map((u): [number, number] => [u - 0.36, u + 0.36]);
    for (const [a, z] of carve(-h + HW + 0.05, h - HW - 0.05, cuts)) {
      const n = Math.floor((z - a) / 0.3);
      const u0 = (a + z) / 2 - ((n - 1) * 0.3) / 2;
      for (let k = 0; k < n; k++) face(s, u0 + k * 0.3, eaves - 0.49, 0.13, 0.14, 0.1, 0.05, CITY_BRICK, hb | HIDE_TOP);
    }
    face(s, 0, eaves - 0.36, 2 * (h + HW + 0.1), 0.12, 0.1, 0.05, CITY_BRICK, hb);
    face(s, 0, eaves - 0.15, 2 * (h + HW + 0.22), 0.3, 0.62, 0.22 - 0.31, ASHLAR);
  }

  // The corners: filled, and standing proud as piers. Above the eaves the
  // gable's own end is the wall's centre line, a hand back from the face
  // below, and it is closed up to the coping.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const top = eaves - 0.42;
      sb.box(0.48, top, 0.48, sx * (w / 2 + 0.04), top / 2, sz * (d / 2 + 0.04), CITY_BRICK, undefined, HIDE_UNDER);
      sb.box(0.52, PLINTH, 0.52, sx * (w / 2 + 0.07), PLINTH / 2, sz * (d / 2 + 0.07), DARK_CONCRETE, undefined, HIDE_UNDER);
      sb.box(WALL, gableH - eaves, HW, (sx * w) / 2, (eaves + gableH) / 2, sz * (d / 2 + HW / 2), CITY_BRICK);
    }
  }
  // The gable parapets: a coping, and a datestone with the year cast in it on
  // a dark ground — a figure flush with stone of its own colour does not read.
  const year = String(1904 + Math.floor(rnd() * 32));
  for (const s of ["-x", "+x"] as const) {
    const hb = hideBack(s);
    sb.box(0.56, 0.1, d + 0.52, outward(s) * (w / 2), gableH + 0.05, 0, ASHLAR);
    const y = eaves + 0.95;
    face(s, 0, y, 1.3, 0.66, 0.04, 0.02, DARK_CONCRETE, hb);
    for (const e of [-1, 1]) {
      face(s, 0, y + e * 0.36, 1.46, 0.1, 0.09, 0.045, ASHLAR, hb);
      face(s, e * 0.68, y, 0.1, 0.62, 0.09, 0.045, ASHLAR, hb);
    }
    stencil(sb, s, half(s) + HW, 0, y, 0.07, year, 0.05, 0.065, ASHLAR, hb);
  }

  // Rainwater goods on the gables: a hopper at every valley's outlet and at
  // the back eaves, the pipe beside its pilaster, brackets and a shoe.
  for (const s of ["-x", "+x"] as const) {
    const hb = hideBack(s);
    const zs = [-(d / 2 - 0.4)];
    for (let i = 1; i < teeth; i++) zs.push(-d / 2 + i * pitchZ - 0.45);
    for (const u of zs) {
      if (nearDoor(s, u, 1.4)) continue;
      const top = eaves - 0.95;
      b.cyl(top - 0.2, 0.15, 0.15, 6, outward(s) * (w / 2 + HW + 0.16), 0.2 + (top - 0.2) / 2, u, IRON);
      face(s, u, eaves - 0.8, 0.36, 0.3, 0.3, 0.16, IRON, hb);
      face(s, u, eaves - 0.98, 0.2, 0.08, 0.22, 0.13, IRON, hb);
      face(s, u, 0.12, 0.2, 0.18, 0.38, 0.19, IRON, hb);
      for (let y = 1.6; y < top - 0.3; y += 1.8) face(s, u, y, 0.24, 0.05, 0.16, 0.08, IRON, hb);
    }
  }

  // --- the loading front --------------------------------------------------------
  const hbF = hideBack("+z");
  const fz = d / 2 + HW;
  for (let i = 0; i <= t.bays; i++) {
    const px = -w / 2 + t.pierW / 2 + i * (t.pierW + t.bayW);
    // The pier's face between the shutter guides and clear of a corner pier.
    const a = i === 0 ? -w / 2 + HW + 0.02 : px - t.pierW / 2 + 0.1;
    const z = i === t.bays ? w / 2 - HW - 0.02 : px + t.pierW / 2 - 0.1;
    // Painted feet, for drivers: white, with two black bands.
    face("+z", (a + z) / 2, 0.6, z - a, 1.2, 0.012, 0.006, ROAD_PAINT, hbF | HIDE_UNDER);
    for (const y of [0.45, 1.05]) face("+z", (a + z) / 2, y, z - a, 0.3, 0.018, 0.009, IRON, hbF);
    // A stone impost where the header springs.
    face("+z", (a + z) / 2, open - 0.1, z - a, 0.2, 0.12, 0.06, ASHLAR, hbF);
    // A gooseneck lamp on each pier between two bays — but not under the hoist.
    if (i > 0 && i < t.bays && Math.abs(px) > 0.5) {
      const y = open + 0.42;
      face("+z", px, y + 0.1, 0.16, 0.3, 0.04, 0.02, IRON, hbF);
      sb.box(0.06, 0.06, 0.66, px, y + 0.2, fz + 0.35, ALLOY);
      sb.box(0.06, 0.2, 0.06, px, y + 0.1, fz + 0.68, ALLOY);
      sb.box(0.42, 0.12, 0.42, px, y - 0.04, fz + 0.68, ALLOY);
      sb.box(0.22, 0.08, 0.22, px, y + 0.06, fz + 0.68, ALLOY);
      lamp(0.32, 0.02, 0.32, px, y - 0.105, fz + 0.68);
    }
  }
  for (let i = 0; i < t.bays; i++) {
    const x = -w / 2 + t.pierW + t.bayW / 2 + i * (t.pierW + t.bayW);
    const bw = t.bayW;
    // The shutter box over every bay, its end plates, and its bay number,
    // counted from the left as the yard reads them.
    sb.box(bw, 0.62, 0.5, x, open + 0.31, d / 2 + 0.2, ENAMEL);
    for (const e of [-1, 1]) sb.box(0.05, 0.68, 0.54, x + e * (bw / 2 + 0.02), open + 0.31, d / 2 + 0.2, IRON);
    stencil(sb, "+z", d / 2 + 0.45, x, open + 0.31, 0.06, String(t.bays - i), 0.012, 0.006, ROAD_PAINT, hbF);
    // The guides down each jamb, and the dock bumpers a lorry has been hitting.
    for (const e of [-1, 1]) sb.box(0.18, open, 0.3, x + (e * bw) / 2, open / 2, d / 2 + 0.16, ALLOY);
    for (const e of [-1, 1]) sb.box(0.3, 0.5, 0.28, x + (e * (bw + 0.3)) / 2, 0.85, d / 2 + 0.24, IRON);
    if (i > 0) {
      // Rolled up: its bottom rail and handles under the box.
      sb.box(bw - 0.1, 0.1, 0.07, x, open - 0.04, d / 2 + 0.16, IRON);
      for (const e of [-1, 1]) sb.box(0.14, 0.04, 0.05, x + e * bw * 0.25, open - 0.12, d / 2 + 0.2, IRON);
    } else {
      // Rolled down: slats across the curtain as a roller shutter has them,
      // the bottom rail, two lifting handles and the padlock on its hasp.
      for (let y = 0.3; y < open - 0.05; y += 0.14) {
        sb.box(bw - 0.06, 0.03, 0.03, x, y, d / 2 + 0.205, ENAMEL, undefined, HIDE_UNDER);
      }
      sb.box(bw - 0.04, 0.16, 0.06, x, 0.12, d / 2 + 0.21, IRON);
      for (const e of [-1, 1]) sb.box(0.16, 0.05, 0.06, x + e * bw * 0.3, 0.3, d / 2 + 0.24, IRON);
      sb.box(0.08, 0.1, 0.05, x + bw * 0.3 + 0.14, 0.17, d / 2 + 0.26, ALLOY);
    }
  }
  // The fascia: lettered in a painted border.
  {
    const sw = w * 0.42;
    const sy = eaves - 1.1;
    face("+z", 0, sy, sw, 0.9, 0.16, 0.08, DARK_CONCRETE, hbF);
    for (const e of [-1, 1]) {
      face("+z", 0, sy + e * 0.36, sw - 0.16, 0.035, 0.015, 0.1675, ROAD_PAINT, hbF);
      face("+z", e * (sw / 2 - 0.08), sy, 0.035, 0.755, 0.015, 0.1675, ROAD_PAINT, hbF);
    }
    stencil(sb, "+z", fz + 0.16, 0, sy, 0.1, "GOODS DEPOT", 0.015, 0.0075, ROAD_PAINT, hbF);
  }
  // The hoist beam over the middle of the front — the one thing that projects
  // from this building and most of its silhouette from the street — on a wall
  // plate with a strut under it, its block, its chain and a hook.
  {
    sb.box(0.34, 0.5, 2.6, 0, open + 1.5, d / 2 + 1.0, ALLOY);
    sb.box(0.7, 0.3, 0.7, 0, open + 1.5, d / 2 + 2.1, DARK_CONCRETE);
    b.cyl(0.9, 0.1, 0.1, 5, 0, open + 0.9, d / 2 + 2.1, IRON);
    face("+z", 0, open + 1.05, 0.5, 0.8, 0.04, 0.02, IRON, hbF);
    const ang = Math.atan2(0.5, 1.2);
    sb.box(0.12, 0.12, Math.hypot(1.2, 0.5), 0, open + 1.0, fz + 0.6, ALLOY, { x: -ang });
    sb.box(0.2, 0.26, 0.14, 0, open + 0.33, d / 2 + 2.1, IRON);
    sb.box(0.05, 0.18, 0.05, 0, open + 0.12, d / 2 + 2.1, IRON);
    sb.box(0.16, 0.05, 0.05, 0, open + 0.04, d / 2 + 2.08, IRON);
  }

  // --- the side door ---------------------------------------------------------------
  {
    const s = "-x" as const;
    const hb = hideBack(s);
    const gx = -(w / 2 + HW);
    for (const e of [-1, 1]) face(s, t.doorAt + e * (DOORWAY / 2 + 0.11), 1.2, 0.22, 2.4, 0.08, 0.04, CITY_BRICK, hb | HIDE_UNDER);
    face(s, t.doorAt, 2.55, DOORWAY + 0.64, 0.3, 0.14, 0.07, ASHLAR, hb);
    // The leaves, folded back flat against the gable either side.
    for (const e of [-1, 1]) {
      const u = t.doorAt + e * (DOORWAY / 2 + 0.68);
      face(s, u, 1.2, 0.88, 2.3, 0.05, 0.11, ENAMEL, hb | HIDE_UNDER);
      for (const y of [0.55, 1.2, 1.85]) face(s, u, y, 0.8, 0.06, 0.02, 0.145, IRON, hb);
      face(s, u, 0.2, 0.8, 0.26, 0.012, 0.141, ALLOY, hb);
    }
    // The hood on its two brackets, a drip at its edge and a lamp under it.
    face(s, t.doorAt, 2.95, DOORWAY + 0.9, 0.08, 0.95, 0.475, ENAMEL, hb);
    face(s, t.doorAt, 3.01, DOORWAY + 0.9, 0.04, 0.12, 0.89, IRON, hb);
    const ang = Math.atan2(0.5, 0.8);
    for (const e of [-1, 1]) {
      sb.box(Math.hypot(0.8, 0.5), 0.06, 0.06, gx - 0.4, 2.66, t.doorAt + e * (DOORWAY / 2 + 0.35), IRON, { z: -ang });
    }
    lamp(0.18, 0.02, 0.3, gx - 0.5, 2.9, t.doorAt);
    sb.box(DOORWAY + 0.5, 0.1, 0.7, gx - 0.35, 0.05, t.doorAt, CONCRETE, undefined, HIDE_UNDER);
  }

  // --- the roof ----------------------------------------------------------------------
  // A sawtooth: a pitched slab per tooth with its glazed face standing up at
  // the high end. CONCRETE and not `SLATE`, which is the parkade's deck
  // argument: asbestos-cement sheeting is pale, and ribbed.
  const toothPitch = Math.atan(tooth / pitchZ);
  const slope = Math.hypot(pitchZ, tooth);
  /** A tooth's top face normal, as (y, z). */
  const ny = Math.cos(toothPitch);
  const nz = -Math.sin(toothPitch);
  const gw = w - 1.4;
  for (let i = 0; i < teeth; i++) {
    const z0 = -d / 2 + i * pitchZ;
    const zc = z0 + pitchZ / 2;
    const yc = eaves + tooth / 2;
    sb.box(w - WALL, 0.26, slope, 0, yc, zc, CONCRETE, { x: -toothPitch });
    const nr = Math.floor((w - WALL) / 1.0);
    for (let k = 0; k < nr; k++) {
      const x = -(w - WALL) / 2 + ((k + 0.5) * (w - WALL)) / nr;
      sb.box(0.06, 0.05, slope - 0.12, x, yc + 0.155 * ny, zc + 0.155 * nz, CONCRETE, { x: -toothPitch }, HIDE_UNDER);
    }
    // The ridge cap, on the ridge.
    sb.box(w - WALL + 0.2, 0.2, 0.34, 0, eaves + tooth + 0.06, z0 + pitchZ - 0.1, SLATE);
    // The north light. Glazing on a roof void, so it is decoration by the same
    // test the curtain walls pass — see the header. Barred as patent glazing.
    b.pane(gw, tooth - 0.5, 0.12, 0, eaves + tooth / 2, z0 + pitchZ);
    sb.box(w - WALL, 0.22, 0.3, 0, eaves + tooth - 0.12, z0 + pitchZ, ALLOY);
    sb.box(w - WALL, 0.22, 0.3, 0, eaves + 0.12, z0 + pitchZ, ALLOY);
    const nb = Math.round(gw / 0.9);
    for (let j = 1; j < nb; j++) sb.box(0.05, tooth - 0.4, 0.2, -gw / 2 + (j / nb) * gw, eaves + tooth / 2, z0 + pitchZ, ALLOY);
    // The purlins under the sheeting, seen through the glazing of the tooth
    // behind.
    for (let j = 1; j < 3; j++) {
      const f = j / 3;
      sb.box(w - WALL, 0.14, 0.14, 0, eaves + tooth * f - 0.22, z0 + pitchZ * f, ALLOY);
    }
    // A ventilator on every other tooth, on a curb on the slope.
    if (i % 2 === 0) {
      const zv = z0 + pitchZ * 0.6;
      const yr = eaves + (tooth * (zv - z0)) / pitchZ + 0.14;
      sb.box(0.9, 0.5, 0.9, w * 0.3, yr + 0.05, zv, ALLOY, undefined, HIDE_UNDER);
      b.cyl(0.6, 0.62, 0.7, 8, w * 0.3, yr + 0.6, zv, ALLOY);
      b.cyl(0.08, 0.95, 0.95, 8, w * 0.3, yr + 0.97, zv, ALLOY);
      b.cyl(0.12, 0.3, 0.6, 8, w * 0.3, yr + 1.07, zv, ALLOY);
    }
  }

  // --- inside ------------------------------------------------------------------------

  // The ceiling, at the underside of the roof's collider, and the steel that
  // carries it: a girder under every valley and a joist on every one of the
  // back's bay lines. See the header on why there is a ceiling at all.
  sb.box(w - WALL, 0.06, d - WALL, 0, eaves + 0.03, 0, CONCRETE);
  const valleys: number[] = [];
  for (let i = 1; i < teeth; i++) valleys.push(-d / 2 + i * pitchZ);
  for (const z of valleys) {
    sb.box(w - WALL, 0.45, 0.3, 0, eaves - 0.225, z, ALLOY, undefined, HIDE_TOP);
    for (const s of ["-x", "+x"] as const) inside(s, z, eaves - 0.55, 0.5, 0.2, 0.12, 0.06, ASHLAR, hideBack(opp(s)));
    inside("+x", z, (eaves - 0.65) / 2, 0.5, eaves - 0.65, 0.08, 0.04, CITY_BRICK, hideBack("-x"));
  }
  for (const u of lines("-z")) {
    sb.box(0.14, 0.2, d - WALL, u, eaves - 0.1, 0, ALLOY, undefined, HIDE_TOP);
    inside("-z", u, eaves / 2, 0.5, eaves, 0.08, 0.04, CITY_BRICK, hideBack("+z"));
  }
  /** A high-bay fitting hung from `top`: its rod, its gear tray, its reflector and the lamp. */
  const pendant = (x: number, y: number, z: number, top: number): void => {
    sb.box(0.03, top - y, 0.03, x, (top + y) / 2, z, IRON);
    sb.box(0.26, 0.12, 0.26, x, y + 0.13, z, ALLOY);
    sb.box(0.5, 0.18, 0.5, x, y - 0.02, z, ALLOY);
    if (rnd() < 0.12) sb.box(0.4, 0.02, 0.4, x, y - 0.12, z, DARK_CONCRETE);
    else lamp(0.4, 0.02, 0.4, x, y - 0.12, z);
  };
  for (const z of valleys) {
    if (z < zMezz + 0.5) continue;
    for (const x of [-w / 3, 0, w / 3]) pendant(x, eaves - 1.1, z, eaves - 0.45);
  }
  for (const x of [-w / 3, 0, w / 3]) {
    if (x < t.laneInner + 0.5) continue;
    pendant(x, Math.min(mezz + 3.2, eaves - 0.6), zBack + t.mezzD / 2, eaves);
  }

  // The columns: flange plates, the stanchion's brackets under the girder,
  // the pad, and the feet painted for the forklifts.
  for (const x of t.colXs) {
    const z = t.colZ;
    sb.box(0.9, 0.16, 0.9, x, 0.28, z, DARK_CONCRETE);
    const fh = eaves - 0.45 - 1.6;
    for (const sz of [-1, 1]) sb.box(0.6, fh, 0.03, x, 1.6 + fh / 2, z + sz * 0.265, ALLOY);
    for (const sz of [-1, 1]) sb.box(0.34, 0.6, 0.34, x, eaves - 0.75, z + sz * 0.3, ALLOY);
    sb.box(0.52, 1.2, 0.52, x, 0.96, z, ROAD_PAINT, undefined, HIDE_UNDER | HIDE_TOP);
    for (const y of [0.81, 1.41]) sb.box(0.53, 0.3, 0.53, x, y, z, IRON, undefined, HIDE_UNDER | HIDE_TOP);
  }

  // The gallery: a channel on its edge (stopping at the lane, where the
  // stair's head is), beams under it from the back wall clear of the office,
  // and posts and a capping rail on its guard.
  {
    const x0 = t.laneInner;
    const x1 = w / 2 - HW;
    sb.box(x1 - x0, SLAB + 0.12, 0.05, (x0 + x1) / 2, mezz - (SLAB + 0.12) / 2 - 0.01, zMezz + 0.025, ALLOY);
    for (const u of lines("-z")) {
      if (u < x0 + 0.3 || Math.abs(u - t.office.x) < 2.8) continue;
      sb.box(0.2, 0.35, t.mezzD, u, mezz - SLAB - 0.175, zBack + t.mezzD / 2, ALLOY, undefined, HIDE_TOP);
    }
    sb.box(x1 - x0 + 0.04, 0.06, 0.26, (x0 + x1) / 2, mezz + 1.13, zMezz + 0.08, ALLOY);
    const np = Math.max(2, Math.round((x1 - x0) / 1.6));
    for (let k = 0; k <= np; k++) {
      const x = x0 + (k / np) * (x1 - x0);
      for (const e of [-1, 1]) sb.box(0.07, 1.1, 0.02, x, mezz + 0.55, zMezz + 0.08 + e * 0.09, IRON);
    }
  }

  // The stair, as steel: two stringers on the pitch, open treads on the
  // flight's own lines with a painted nosing and the angle under it, and the
  // guard capped and posted. `Build.flight`'s tread arithmetic, restated.
  {
    const sAt = (z: number): number => mezz + (zMezz - z) * GRADE;
    const L = t.run / Math.cos(t.pitch);
    const zc = zMezz + t.run / 2;
    for (const x of [-w / 2 + HW + 0.06, t.laneInner - 0.08]) {
      sb.box(0.1, 0.36, L, x, sAt(zc) - 0.08, zc, ALLOY, { x: t.pitch });
    }
    const runO = t.run + 0.6;
    const tread = runO / t.steps;
    const footZ = zMezz + runO;
    for (let i = 0; i < t.steps; i++) {
      const z = footZ - (i + 0.5) * tread;
      const y = sAt(z);
      if (y < 0.12) continue;
      sb.box(t.lane - 0.2, 0.05, tread + 0.03, t.laneCx, y - 0.005, z, ALLOY);
      sb.box(t.lane - 0.2, 0.012, 0.05, t.laneCx, y + 0.026, z + tread / 2 - 0.01, ROAD_PAINT);
      sb.box(t.lane - 0.2, 0.08, 0.04, t.laneCx, y - 0.06, z + tread / 2, IRON);
    }
    const gx = t.laneInner + 0.08;
    sb.box(0.26, 0.06, L, gx, sAt(zc) + 1.1 + 0.03 / Math.cos(t.pitch), zc, ALLOY, { x: t.pitch });
    const np = Math.max(2, Math.round(t.run / 1.6));
    for (let k = 0; k <= np; k++) {
      const z = zMezz + (k / np) * t.run;
      for (const e of [-1, 1]) sb.box(0.02, 1.1, 0.07, gx + e * 0.09, sAt(z) + 0.55, z, IRON);
    }
    // The handrail on the gable, broken for the door should one ever stand
    // along the flight.
    for (const [a, z] of carve(zMezz, zMezz + t.run, [[doorLo - 0.15, doorHi + 0.15]])) {
      if (z - a < 0.4) continue;
      const m = (a + z) / 2;
      inside("-x", m, sAt(m) + 0.9, (z - a) / Math.cos(t.pitch), 0.05, 0.05, 0.11, ALLOY, 0, -t.pitch);
      for (let q = a + 0.2; q < z; q += 1.4) inside("-x", q, sAt(q) + 0.86, 0.04, 0.1, 0.08, 0.04, IRON);
    }
  }

  // The site office: its roof, a framed window of three lights, a framed door
  // with a vision panel, a handle and a kick plate, the sign over it, and a
  // clock hung under the gallery's edge above.
  {
    const { x: ox, z: oz } = t.office;
    const of = oz + 1.6;
    const hb = hideBack("+z");
    const on = (u: number, y: number, a: number, h: number, th: number, out: number, color: string): void =>
      sb.onFace("+z", of, u, y, a, h, th, out, color, 0, 0, hb);
    sb.box(5.2, 0.16, 3.4, ox, GROUND + 2.78, oz, DARK_CONCRETE);
    b.pane(3.0, 1.1, 0.1, ox - 0.6, GROUND + 1.9, of, { backed: ENAMEL });
    on(ox - 0.6, GROUND + 2.47, 3.1, 0.06, 0.04, 0.07, IRON);
    on(ox - 0.6, GROUND + 1.33, 3.1, 0.06, 0.04, 0.07, IRON);
    for (const e of [-1, 1]) on(ox - 0.6 + e * 1.52, GROUND + 1.9, 0.06, 1.2, 0.04, 0.07, IRON);
    for (const e of [-1, 1]) on(ox - 0.6 + e * 0.5, GROUND + 1.9, 0.04, 1.1, 0.03, 0.065, IRON);
    on(ox - 0.6, GROUND + 1.28, 3.2, 0.05, 0.14, 0.07, ALLOY);
    const dx = ox + 1.8;
    on(dx, GROUND + 1.1, 1.0, 2.2, 0.06, 0.03, TEAK);
    for (const e of [-1, 1]) on(dx + e * 0.53, GROUND + 1.13, 0.06, 2.26, 0.08, 0.04, IRON);
    on(dx, GROUND + 2.23, 1.12, 0.06, 0.08, 0.04, IRON);
    on(dx, GROUND + 1.6, 0.3, 0.45, 0.01, 0.065, IRON);
    on(dx - 0.36, GROUND + 1.05, 0.14, 0.04, 0.05, 0.085, ALLOY);
    on(dx, GROUND + 0.13, 0.9, 0.22, 0.01, 0.065, ALLOY);
    on(dx, GROUND + 2.5, 0.95, 0.24, 0.02, 0.01, ROAD_PAINT);
    stencil(sb, "+z", of + 0.02, dx, GROUND + 2.5, 0.032, "OFFICE", 0.008, 0.004, DARK_CONCRETE, hb);
    // The clock.
    const cz = zMezz + 0.05;
    const cy = mezz - 0.85;
    sb.box(0.04, 0.26, 0.04, ox, mezz - 0.6, cz + 0.03, IRON);
    sb.box(0.44, 0.44, 0.05, ox, cy, cz + 0.045, IRON);
    sb.box(0.38, 0.38, 0.02, ox, cy, cz + 0.075, ROAD_PAINT);
    for (const [len, a] of [
      [0.1, rnd() * Math.PI * 2],
      [0.15, rnd() * Math.PI * 2],
    ] as const) {
      sb.onFace("+z", cz, ox + (Math.sin(a) * len) / 2, cy + (Math.cos(a) * len) / 2, 0.022, len, 0.01, 0.09, IRON, -a);
    }
  }

  // The back wall under the gallery: the electrical board and its conduit up
  // to the gallery's soffit, a pallet leaned on the wall and a notice board.
  {
    const cs = centres("-z");
    const hb = hideBack("+z");
    const soffit = mezz - SLAB;
    if (cs.length > 1) {
      const u = cs[1];
      inside("-z", u, 1.55, 0.7, 0.9, 0.12, 0.06, ENAMEL, hb);
      inside("-z", u, 1.55, 0.01, 0.84, 0.01, 0.125, IRON, hb);
      inside("-z", u + 0.22, 1.85, 0.12, 0.08, 0.01, 0.125, ROAD_PAINT, hb);
      for (const k of [-1, 0, 1]) inside("-z", u + k * 0.2, (2.0 + soffit) / 2, 0.04, soffit - 2.0, 0.04, 0.02, ALLOY, hb);
    }
    if (cs.length > 2) {
      const u = cs[2];
      for (let k = 0; k < 5; k++) inside("-z", u, GROUND + 0.16 + k * 0.22, 1.2, 0.12, 0.025, 0.125, PLANK, hb);
      for (const e of [-1, 0, 1]) inside("-z", u + e * 0.55, GROUND + 0.6, 0.1, 1.0, 0.1, 0.05, TEAK, hb);
    }
    if (cs.length > 3) {
      const u = cs[3];
      inside("-z", u, 1.6, 1.2, 0.8, 0.03, 0.015, PLANK, hb);
      for (let k = 0; k < 5; k++) {
        const pu = u - 0.45 + rnd() * 0.9;
        const py = 1.35 + rnd() * 0.5;
        inside("-z", pu, py, 0.18, 0.25, 0.01, 0.035, ROAD_PAINT, hb, (rnd() - 0.5) * 0.15);
      }
    }
  }

  // The crate stacks: each on a pallet, with corner battens, the bands it was
  // strapped with and a lot number on the face to the bays.
  for (const [cw, ch, cd, cx, cz] of t.stacks) {
    for (let i = 1; i * 0.75 < ch; i++) sb.box(cw + 0.08, 0.1, cd + 0.08, cx, GROUND + i * 0.75, cz, TEAK);
    sb.box(cw + 0.02, 0.07, cd + 0.02, cx, GROUND + 0.065, cz, DARK_CONCRETE, undefined, HIDE_UNDER | HIDE_TOP);
    sb.box(cw + 0.03, 0.03, cd + 0.03, cx, GROUND + 0.125, cz, PLANK, undefined, HIDE_UNDER | HIDE_TOP);
    for (const e of [-1, 0, 1]) {
      for (const f of [-1, 1]) {
        sb.box(0.14, 0.07, 0.03, cx + e * (cw / 2 - 0.08), GROUND + 0.065, cz + f * (cd / 2 + 0.01), TEAK);
        sb.box(0.03, 0.07, 0.14, cx + f * (cw / 2 + 0.01), GROUND + 0.065, cz + e * (cd / 2 - 0.08), TEAK);
      }
    }
    for (const ex of [-1, 1]) {
      for (const ez of [-1, 1]) {
        sb.box(0.1, ch - 0.16, 0.1, cx + ex * (cw / 2 - 0.04), GROUND + 0.16 + (ch - 0.16) / 2, cz + ez * (cd / 2 - 0.04), TEAK);
      }
    }
    const lot = String(10 + Math.floor(rnd() * 89));
    stencil(sb, "+z", cz + cd / 2, cx, GROUND + 0.55, 0.04, lot, 0.01, 0.005, ROAD_PAINT, hideBack("+z"));
  }

  // The floor, painted: the loading line, the gallery's edge, and a hatched
  // box at the stair's foot — 12 mm, so nothing trips and nothing strobes.
  {
    const paint = (len: number, wid: number, x: number, z: number, rotY = 0): void =>
      sb.box(len, 0.012, wid, x, GROUND + 0.006, z, ROAD_PAINT, rotY ? { y: rotY } : undefined, HIDE_UNDER);
    const x0 = t.laneInner + 0.4;
    const x1 = w / 2 - HW - 0.6;
    paint(x1 - x0, 0.1, (x0 + x1) / 2, d / 2 - 3.2);
    paint(x1 - x0, 0.1, (x0 + x1) / 2, zMezz + 0.7);
    const z0 = zMezz + t.run + 0.15;
    const z1 = Math.min(d / 2 - HW - 0.15, z0 + 1.4);
    if (z1 - z0 > 0.6) {
      const hw = (t.lane - 0.2) / 2;
      const D = z1 - z0;
      for (const e of [-1, 1]) {
        paint(2 * hw, 0.08, t.laneCx, (z0 + z1) / 2 + e * (D / 2 - 0.04));
        paint(0.08, D, t.laneCx + e * (hw - 0.04), (z0 + z1) / 2);
      }
      for (let xk = t.laneCx - hw + D / 2; xk <= t.laneCx + hw - D / 2 + 1e-6; xk += 0.5) {
        paint(0.08, D * Math.SQRT2 - 0.12, xk, (z0 + z1) / 2, Math.PI / 4);
      }
    }
    // Empty pallets, lying where a forklift left them — two of them stacked.
    const pallet = (x: number, y: number, z: number): void => {
      for (const e of [-1, 0, 1]) sb.box(0.1, 0.1, 1.0, x + e * 0.55, y + 0.05, z, TEAK, undefined, HIDE_UNDER);
      for (let k = 0; k < 5; k++) sb.box(1.2, 0.025, 0.12, x, y + 0.1125, z - 0.44 + k * 0.22, PLANK, undefined, HIDE_UNDER);
    };
    pallet(w * 0.04 + 2.2, GROUND, zMezz + 1.6);
    pallet(-w * 0.08, GROUND, d / 2 - 1.6);
    pallet(-w * 0.08, GROUND + 0.125, d / 2 - 1.6);
    pallet(w * 0.36, mezz, zBack + 0.8);
    pallet(-w * 0.04, mezz, zBack + 0.8);
  }

  sb.flush(b);
  lens.flushGlow(b);
}
