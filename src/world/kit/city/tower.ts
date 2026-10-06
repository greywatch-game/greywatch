/**
 * kit/city/tower.ts — buildTower: the solid stock a downtown skyline is made
 * of — its curtain-wall and brick skins (`drawTower`, `drawBrickStock`) and
 * `towerRoll`, the stable variation it draws off its own params. Part of the
 * downtown set: follows the contract in kit/core.ts and the set's rules in
 * `./index.ts`. Invariants: three colliders, two on a brick one; everything
 * else is drawing. Never calls `Math.random()`.
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
  ASPHALT,
  CITY_BRICK,
  CONCRETE,
  DARK_CONCRETE,
  IRON,
  RENDER,
  ROOM_GLOW,
  RUST,
  STONE,
  TEAK,
  WINDOW_LIGHT,
  StoneBatch,
  carve,
  streetSeed,
  HIDE_UNDER,
  hideBack,
  outward,
  runsAlongX,
  type Hole,
  type Side,
} from "../core";
import {
  STOREY,
  HIDE_TOP,
  hideEnds,
} from "./shared";

/** `Build.glow`'s option for a lit room drawn over a `backed` pane. */
const OVER_GLASS = { overGlass: true } as const;

/**
 * A stable 0..1 from a builder's own parameters, so a row of these is not a row
 * of one of these.
 *
 * **World-building code may not call `Math.random()`** — the nav graph would
 * differ between page loads (`CLAUDE.md`) — and a structure builder is the one
 * place in the world layer with no seed to hand: a scatter prop is given one by
 * `MapBuilder`, and a `BuilderKind` is handed only its params. So the variation
 * comes out of the params themselves. `kit/desert.ts`'s `clothHash` got there
 * first and its header owns the argument, which is that two buildings with the
 * same footprint and the same height ARE the same building, and what separates
 * them on the ground is `rotY` and what is standing next to them.
 *
 * It lands better here than anywhere else in the kit, because HEIGHT is already
 * the one thing a layout varies about a tower: Coldharbour's thirty-seven are
 * nearly all 26 x 26 and no two are the same height, so a number the layout was
 * choosing anyway for the skyline drives every roll below as well — which crown
 * it wears, which flank carries the fire escape, where the entrance sits along
 * its frontage, and which floors have their lights on.
 *
 * **The FINALISER is what makes that true, and for a long time it was
 * missing.** The combine step moves mostly LOW bits — a small integer XORed
 * and added in — and the result is read off the HIGH twenty-four, so without
 * a mix at the end nothing but the first input reached the answer: every
 * 26 x 26 tower rolled 0.89 for every salt at every height, and so wore the
 * same crown, the same entrance, the same spine flank, the same fire escape
 * and the same lit floors as every other. `fmix32` (MurmurHash3's) avalanches
 * every input bit across the whole word before the read.
 */
function towerRoll(...ns: number[]): number {
  let hash = 0x9e3779b9;
  for (const n of ns) {
    hash ^= Math.round(n * 64) + 0x9e3779b9 + (hash << 6) + (hash >>> 2);
    hash = hash >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 8) / 0x1000000;
}

/**
 * A tower: the solid stock a downtown is mostly made of, and the thing that
 * turns a street into a canyon.
 *
 * **Not enterable, on purpose, and that has not changed.** Sixteen bots and a
 * player do not need sixty rooms; what a skyline needs is silhouette and a wall
 * to a sightline. The enterable buildings are `office`, `shophouse`, `depot`
 * and `parkade`, and they are worth entering partly because their neighbours
 * are not.
 *
 * ## The budget this is built inside, which is the whole of its design
 *
 * **It is still THREE colliders — two on a brick one — and every line below had
 * to be bought without a fourth.** The set's header prices an interior at 35 to
 * 50 boxes and records what that did to every ray in the game: ~95% dearer,
 * exactly linear in the mesh count. There are THIRTY-SEVEN of these on
 * Coldharbour, against **800 collider boxes on the whole map** (`npm run
 * collision`; 821 solid meshes in a live round, Hollowmere's 828 and 720). One
 * more box each is +37, which is 4.6% on every shot, every bot's LOS and every
 * grenade — for a building nobody can go into, on a map whose next want is more
 * building KINDS rather than more boxes on the ones it has. So the rule for
 * anything added here is the one the glass already followed: **buy it with
 * drawing, and if it cannot be bought with drawing, do not buy it.**
 *
 * The bake is the check, and it is exact: `npm run collision` reports 800 both
 * sides of this redesign. What DID move is the proving ground's scatter, by
 * nine props — placement is seeded against the collider set, so a footprint
 * that changed shape re-rolls which dressing fits beside it. That is
 * `CLAUDE.md`'s rule about a placement change owing a re-bake, arriving from
 * the one direction it is easy to miss.
 *
 * What that forbids and what it allows are both counter-intuitive, so:
 *
 * - **A recess is free and a projection is not.** The collider is the plain
 *   mass; the DRAWING may be notched into it as deep as you like, because
 *   nothing picks a visual and a body is stopped at the mass's own plane. So
 *   the lobby below is a 2.6 m hole cut in the podium's elevation with no
 *   collider anywhere near it, and a player who walks up to it is stopped at
 *   the glass — which is what glass does. Standing something PROUD is the
 *   opposite case and stays inside the trim budget the rest of the kit works to
 *   (the shophouse's shopfront frames are 0.1 to 0.34), with one exemption:
 *   anything over reach — a canopy, a cornice, a fire escape — projects as far
 *   as it likes, because nothing walks through what it cannot touch.
 * - **A LENS is free and a LIGHT is one of sixteen**, and this is the builder
 *   that rule binds hardest: thirty-seven lobbies with a lamp in each is the
 *   shader's whole budget four times over, and what actually happens is that
 *   every interior on the map goes dark. So every warm thing on a tower — the
 *   lobby's soffit, the lift call panel, the lit floors, the entrance sign, the
 *   obstruction light — is a lens, which costs a mesh that block-merges
 *   with every other emissive in its 48 m block and no slot at all.
 *   `litWindows` is honoured and spends exactly one, for the two or three
 *   towers a layout wants a pool of light at the foot of; no placement states
 *   it, so the map's light budget is exactly where it was.
 *
 * ## The podium, which is where a tower meets a person
 *
 * A tower used to be a shaft on a 0.3 m plinth, glazed from the kerb to the
 * parapet on all four bearings, and what was wrong with it was not that it
 * lacked detail. It was that the only part of it a player ever stands next to —
 * the bottom four metres — was the part with nothing on it at all.
 *
 * So the plinth grew into a PODIUM: one or two storeys of a different material,
 * carrying the entrance, the service bay and the signage, with the curtain wall
 * starting at its coping rather than at the ground. **It costs no collider,
 * because it IS the plinth's box** — `w + 0.5` against the plinth's `w + 0.7`,
 * so no layout moves and no street narrows: the solid footprint at body height
 * grows by 0.25 a side, and the drawn base course still stands where the
 * plinth's outer face did. What is genuinely given up is that the plinth's top
 * was walkable (inside `HEIGHT_EPS`, so the nav grid merged it with the terrain
 * rather than spending a slot on it). A 0.3 m step is not cover — `CoverMap`'s
 * low line is over a metre — and no cell centre lands in a 0.35 m ring, so the
 * graph does not notice: what is lost is a step, and what stands there instead
 * is a doorway.
 *
 * ## A tower has a FRONT now, and its doors are shut
 *
 * The other half of reading as a prop was four-fold symmetry — the same
 * elevation on every bearing is the one thing no building has. A placement
 * already carries `rotY`, and the rest of this set already means +Z by "the
 * street" (`buildOffice`'s shopfront, `buildShophouse`'s frontage), so the
 * entrance goes on +Z, the service bay on -Z, and the shaft's own blind service
 * spine on whichever flank the roll picks.
 *
 * **The entrance doors are drawn SHUT, and that is the exact inverse of
 * `buildShophouse`'s rule rather than an exception to it.** There, a door on an
 * opening a body walks through is drawn open, because a shut-looking door on a
 * way in is the one thing an elevation must not say. Here there is no way in,
 * so a door standing open would be the lie.
 *
 * The lobby glass is not `breakable` for the same reason and by the same test
 * (`PaneSpec.breakable`): there is nothing behind it to get into. It is not
 * `backed` either, and it is the one sheet on a tower that is not — every other
 * pane here hangs on a solid mass and is drawn opaque over that mass's own
 * colour, while this one has a drawn room behind it and the room is what you
 * are meant to see. It costs no reflection probe: `ReflectionSystem` mints one
 * per glazed BLOCK, and the curtain wall already put one on every block a
 * tower stands in.
 *
 * ## The skin is still chosen by the HEIGHT, and now so is everything else
 *
 * Under `BRICK_CEILING` it is older low stock in brick; over it, a curtain wall
 * on a stone podium, with a plant floor of louvres somewhere up the shaft and a
 * crown the roll picks from three. One number, two kinds of building, and no
 * way to ask for a fifty-metre brick warehouse by accident. What each of them
 * is drawn AS — and that it is all drawing, emitted before the masses it lies
 * on and none of it a collider — is `drawTower`'s.
 */
export function buildTower(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "tower");
  const w = p.width ?? 18;
  const d = p.depth ?? 16;
  const h = p.height ?? 34;
  /** Above this a building is a curtain wall; below it, brick. */
  const BRICK_CEILING = 17;
  const brick = h < BRICK_CEILING;
  const skin = brick ? CITY_BRICK : CONCRETE;
  /** This placement's stable variation. See `towerRoll`. */
  const roll = (salt: number): number => towerRoll(w, d, h, salt);

  /**
   * One storey under a brick block or a short shaft, two under a tall one, and
   * always a whole number of them, so the coping lands on a floor line and the
   * storeys above carry on the same rhythm. Clamped so a six-metre tower is not
   * all podium.
   */
  const podH = Math.min(
    (brick || h < 26 ? 1 : 2) * STOREY,
    Math.max(2.4, h - 2.4),
  );
  const pw = w + 0.5;
  const pd = d + 0.5;
  /**
   * Dressed stone under a curtain wall, a cooler stone course under brick —
   * and in both cases LIGHTER than what stands on it. See `ASHLAR`: a base in
   * the shaft's own dark grey is not a base, it is a hole across the whole
   * frontage at exactly the height a player's eye is.
   */
  const podSkin = brick ? STONE : ASHLAR;
  /** How deep the entrance is cut into the +Z elevation's DRAWING. */
  const recess = Math.min(2.8, Math.max(1.5, d * 0.14));
  /** The entrance bay: wide enough to read from across a street, never a slot. */
  const openW = Math.min(8.4, Math.max(4.2, pw * 0.34));
  const openH = Math.min(podH - 0.9, 4.2);
  /**
   * Where the entrance sits along the frontage. Centred on a narrow podium
   * because there is nowhere else for it to go; off-centre on a wide one, which
   * is what stops a block face of these reading as one building repeated with
   * all its doors in a line.
   */
  const ex = (roll(3) - 0.5) * Math.max(0, pw - openW - 5);
  /** The lobby's back wall, and the centre of the slice the piers stand in. */
  const zBack = pd / 2 - recess;
  const zFront = zBack + recess / 2;
  const pierL = ex - openW / 2 + pw / 2;
  const pierR = pw / 2 - (ex + openW / 2);
  /**
   * The shaft, and the setback above it. Two masses rather than one is what
   * stops a row of these reading as a row of crates: the upper one is inset, so
   * the skyline steps.
   */
  const setback = brick ? 0 : Math.round(h * 0.34);
  const lower = h - setback;
  const sw = w * 0.76;
  const sd = d * 0.76;
  const shaftH = Math.max(0.4, lower - podH);

  // --- the drawing, FIRST ---------------------------------------------------
  //
  // Everything on a tower that is not a mass. It emits no colliders, so where
  // it is called cannot move one; it is called before the masses it lies on
  // because the part merge keeps emission order, and a facing drawn first is
  // what lets the depth test reject the wall face behind it rather than shade
  // it twice.
  drawTower(b, {
    w,
    d,
    h,
    brick,
    skin,
    podSkin,
    podH,
    pw,
    pd,
    recess,
    openW,
    openH,
    ex,
    zBack,
    zFront,
    pierL,
    pierR,
    lower,
    sw,
    sd,
    setback,
    roll,
    sign: p.sign,
    litWindows: p.litWindows,
  });

  // --- the masses, and the three colliders ---------------------------------
  //
  // The podium's one collider is the plain mass, full depth, no notch;
  // everything else on the podium is drawn inside it. The drawn mass is drawn
  // back from the frontage by the lobby's depth, and the +Z elevation returned
  // round the opening as two piers and a head — four boxes where a podium would
  // be one, and the notch they leave between them is the room.
  b.block({ w: pw, h: podH, d: pd, x: 0, y: podH / 2, z: 0 });
  b.box(pw, podH, pd - recess, 0, podH / 2, -recess / 2, podSkin);
  if (pierL > 0.05) {
    b.box(pierL, podH, recess, -pw / 2 + pierL / 2, podH / 2, zFront, podSkin);
  }
  if (pierR > 0.05) {
    b.box(pierR, podH, recess, pw / 2 - pierR / 2, podH / 2, zFront, podSkin);
  }
  b.box(openW, podH - openH, recess, ex, openH + (podH - openH) / 2, zFront, podSkin);
  b.box(w, shaftH, d, 0, podH + shaftH / 2, 0, skin);
  b.block({ w, h: shaftH, d, x: 0, y: podH + shaftH / 2, z: 0 });
  if (setback > 0) {
    b.box(sw, setback, sd, 0, lower + setback / 2, 0, skin);
    b.block({ w: sw, h: setback, d: sd, x: 0, y: lower + setback / 2, z: 0 });
  }
  return b;
}

/** Everything `drawTower` reads off `buildTower`'s plan. */
interface TowerPlan {
  w: number;
  d: number;
  h: number;
  brick: boolean;
  skin: string;
  podSkin: string;
  podH: number;
  pw: number;
  pd: number;
  recess: number;
  openW: number;
  openH: number;
  ex: number;
  zBack: number;
  zFront: number;
  pierL: number;
  pierR: number;
  lower: number;
  sw: number;
  sd: number;
  setback: number;
  roll: (salt: number) => number;
  sign?: string;
  litWindows?: boolean;
}

/**
 * Everything on a tower that is DRAWING, and what it draws it as. It emits no
 * collider, so every box a tower is made of is exactly where it was (`npm run
 * kit:hash`); and every part obeys one of the three rules a drawing on a
 * collider may take (`model-detail` skill) — FLAT on a face (the cladding, the
 * frames, the doors), LOW enough to walk over (the base course, the wheel
 * guards), or OVER reach, which is everything from the podium's coping up.
 *
 * ## The curtain wall: three systems, because a skyline is what these are FOR
 *
 * It read as a sheet of graph paper on a box: panels between collars and fins,
 * the same on every tower, so thirty-seven of them were one texture. A curtain
 * wall is a SYSTEM — how its glass is held and what covers the floor edge —
 * and the roll picks one of the three a downtown is actually built of:
 *
 * - **Ribbon** — precast spandrel bands across the floor edges, ribbons of
 *   glass between them, slim mullions. Horizontal, and the pale band is the
 *   thing catching the sun.
 * - **Grid** — a stick system: continuous aluminium mullions standing proud,
 *   transoms set back from them, dark spandrel panels flush with the glass,
 *   and deeper fins on the structural bays. Vertical, and a dark glass box
 *   with a silver grid on it.
 * - **Columns** — an expressed frame: deep precast column covers on the bay
 *   lines, recessed spandrels between them, glass behind both.
 *
 * **Every one of them reads by DEPTH, which is the only thing the ink draws**:
 * glass 10 cm off the mass, a transom 8 cm off that, a mullion 14, a fin 32, a
 * column cover half a metre — so each layer is a step, and the system is
 * legible as how far out each member stands rather than as a colour. The
 * mullions are one box the height of the mass rather than one a floor, drawn
 * behind the bands and spandrels that cross them, so the module costs a few
 * dozen boxes a tower rather than a thousand.
 *
 * Three things still break each grid's own regularity: one band of LOUVRES
 * where the plant floor is, the blind service SPINE up one flank (its own
 * pilaster now, jointed per storey, with the stair's slot window in each), and
 * the storeys whose lights are on — lit a module at a time, a third of the
 * floors at two modules in five, which is the share that was photographed down
 * to in `ROOM_GLOW`.
 *
 * ## The podium: stone that is laid, not a slab that is painted
 *
 * Faced in big jointed slabs laid broken-joint over the mass, the bay piers
 * cased in the same stone 16 cm proud, and every window set in an architrave
 * with a deeper sill — the office's ground floor at a tower's scale, and the
 * same finding behind it: a joint is a step the ink draws, and a base with
 * none is a black rectangle at eye height. The entrance gets a portal, heavier
 * stone than anything round it; the canopy its downlights; the lobby its
 * panelling, its directory and a desk with something on it. The rear keeps its
 * four service things and is laid in the same stone round them.
 *
 * ## The brick stock: an interwar commercial block
 *
 * It read as a red box with framed rectangles on it. It is drawn now as what a
 * twelve-to-sixteen-metre brick building of that age is: brick piers rising
 * between wide steel windows — a grid of glazing bars, under a stone lintel
 * with a keystone and over a stone sill — brick spandrels with a stone tablet,
 * a frieze, a corbelled cornice on a course of dentils, and a parapet with a
 * raised name panel over the front. The storey height is fitted to the
 * building rather than to `STOREY`, which is what loft floors are. The party
 * walls get corner pilasters, tie plates, a downpipe, bricked-up openings and
 * the ghost sign; the fire escape, the windows it serves at every landing (a
 * fire escape on a blank wall is a stair to nowhere); and the shopfront under
 * all of it is painted timber on stone pilasters.
 *
 * ## The crowns
 *
 * The same three, each now dressed as what it is: the lift motor room with a
 * door, a lamp, a louvre and a ladder beside an air handler and its
 * condensers; the stepped crown with the system's fins carried up it and a lit
 * band under each cap; the water tank hooped and roofed on a braced frame. A
 * tall roof also carries its window-cleaning machine — a track round the
 * parapet, the carriage, the jib and the cradle parked beside it — which is
 * the thinnest thing on the skyline and the one a roof most obviously has. A
 * brick roof gets a timber water tank on a steel stand.
 *
 * ## What it is drawn WITH
 *
 * A couple of thousand boxes, every one of them written into one surface per
 * colour (`StoneBatch`); the lenses into one emissive per colour, the lit
 * floors into one more that is drawn over the glass (`flushGlow`'s
 * `overGlass`). **No colour is new**: everything is a colour a tower already
 * wore, so a block a tower stands in draws exactly the materials it drew
 * before. The base course and the masses stay ordinary parts, because the
 * grass mask records a structure's PARTS to keep blades out of it and skips
 * a batch, whose bounds are a batch's rather than a shape's.
 *
 * Variation is the tower's own rolls where they already decided something —
 * the crown, the entrance, the spine, the lit floors — plus one for the
 * system (`towerRoll` salt 41) and one for the cleaning machine, and a stream
 * off the params for the per-bay decisions nobody needs to find again.
 */
function drawTower(b: Build, t: TowerPlan): void {
  const { w, d, h, brick, skin, podSkin, podH, pw, pd, roll } = t;
  const { recess, openW, openH, ex, zBack, zFront, pierL, pierR } = t;
  const { lower, sw, sd, setback } = t;
  const sb = new StoneBatch();
  /** Lenses on something solid. */
  const lens = new StoneBatch();
  /** Lenses hung in front of a `backed` sheet, which owe `overGlass`. */
  const lensG = new StoneBatch();
  const rnd = mulberry32(streetSeed(w, d, h));
  const SIDES: readonly Side[] = ["+z", "-z", "-x", "+x"];
  /** The joint between two slabs, two panels or two segments. */
  const J = 0.025;

  /**
   * Which flank carries the shaft's service spine — the blind slot the lifts
   * and the risers are behind, and the one thing that stops a curtain wall
   * being the same elevation four times over.
   */
  const spine: -1 | 1 = roll(11) > 0.5 ? 1 : -1;
  /**
   * Whether this building's lights are on, which is a claim about the BUILDING
   * rather than about the hour: at dusk some towers are working and some are
   * shut, and a skyline with every window lit is the same mistake as one with
   * none. `litWindows: false` says "this one is dark" outright.
   */
  const lit = t.litWindows !== false && roll(12) > 0.34;

  /** The outer face plane of side `s` of a centred `mw` x `md` mass. */
  const planeOf = (s: Side, mw: number, md: number): number => (runsAlongX(s) ? md : mw) / 2;
  /** That side's length between its corners. */
  const lenOf = (s: Side, mw: number, md: number): number => (runsAlongX(s) ? mw : md);
  /** A box laid on face `s` at `plane`, its centre `out` off the plane. */
  const lay = (
    s: Side,
    plane: number,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
    hide = 0,
  ): void => sb.onFace(s, plane, u, y, along, tall, thick, out, color, 0, 0, hide);
  /** A sheet of glass laid on a face. */
  const paneOn = (
    s: Side,
    plane: number,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    backed: string,
  ): void => {
    const c = outward(s) * (plane + out);
    if (runsAlongX(s)) b.pane(along, tall, thick, u, y, c, { backed });
    else b.pane(thick, tall, along, c, y, u, { backed });
  };
  /**
   * A louvre blade along face `s`, its outer edge tipped DOWN by `tip`. A blade
   * running along X turns about X and one along Z about Z, and the sign is the
   * face's: a positive x-turn tips +Z down, a positive z-turn tips -X down.
   */
  const blade = (
    s: Side,
    plane: number,
    u: number,
    y: number,
    along: number,
    wide: number,
    out: number,
    color: string,
    tip: number,
  ): void => {
    const n = outward(s);
    const c = n * (plane + out);
    // Its two ends are in the frame it spans.
    if (runsAlongX(s)) sb.box(along, 0.03, wide, u, y, c, color, { x: n * tip }, 1 | 2);
    else sb.box(wide, 0.03, along, c, y, u, color, { z: -n * tip }, 16 | 32);
  };
  /**
   * Coursed slabs over `[u0, u1] x [y0, y1]` of a face, laid broken-joint and
   * round the holes — a slab a hole cuts keeps the parts of itself beside, over
   * and under it, so a window lands on whatever course it lands on and the
   * stone still closes round it.
   */
  const ashlar = (
    s: Side,
    plane: number,
    u0: number,
    u1: number,
    y0: number,
    y1: number,
    holes: readonly Hole[],
    color: string,
    course = 1.45,
    long = 2.4,
    thick = 0.06,
  ): void => {
    if (u1 - u0 < 0.1 || y1 - y0 < 0.1) return;
    // A slab's back is in the wall and its underside on the one below; its
    // top is only ever seen from under the eye, so a slab over it leaves that
    // out too.
    const slab = (a: number, z: number, c0: number, c1: number): void => {
      if (z - a < 0.1 || c1 - c0 < 0.08) return;
      const hide = hideBack(s) | HIDE_UNDER | (c1 > 2.0 ? HIDE_TOP : 0);
      lay(s, plane, (a + z) / 2, (c0 + c1) / 2, z - a, c1 - c0, thick, thick / 2, color, hide);
    };
    const courses = Math.max(1, Math.round((y1 - y0) / course));
    const ch = (y1 - y0) / courses;
    for (let c = 0; c < courses; c++) {
      const a0 = y0 + c * ch;
      const a1 = a0 + ch - J;
      for (let u = u0 - (c % 2) * (long / 2); u < u1; u += long) {
        const s0 = Math.max(u, u0);
        const s1 = Math.min(u + long - J, u1);
        if (s1 - s0 < 0.1) continue;
        const hit = holes.filter((o) => o.u1 > s0 && o.u0 < s1 && o.y1 > a0 && o.y0 < a1);
        for (const [q0, q1] of carve(s0, s1, hit.map((o): [number, number] => [o.u0, o.u1]))) {
          slab(q0, q1, a0, a1);
        }
        for (const o of hit) {
          const q0 = Math.max(s0, o.u0);
          const q1 = Math.min(s1, o.u1);
          slab(q0, q1, a0, Math.min(a1, o.y0 - J));
          slab(q0, q1, Math.max(a0, o.y1 + J), a1);
        }
      }
    }
  };

  // === the podium ===========================================================

  // The base course: a dark plinth 0.15 proud of the podium, which is where
  // the old plinth's outer face was, and at ankle height a proud visual takes
  // the latitude a step does. A PART rather than a batched box, so the grass
  // mask still finds the tower's foot.
  b.box(pw + 0.3, 0.34, pd + 0.3, 0, 0.17, 0, DARK_CONCRETE);
  {
    const BASE = 0.34;
    /** The underside of the coping, where the stone stops. */
    const corn = podH - 0.15;
    const rib = 0.6;
    const pierOut = 0.16;
    const storeys = podH > STOREY * 1.5 ? 2 : 1;
    /** Bronze-dark frames in a stone base; a painted timber shopfront under brick. */
    const frameC = brick ? TEAK : DARK_CONCRETE;
    /** Storey `k`'s window head and sill. A shopfront is deeper and lower. */
    const win = (k: number): [number, number] => {
      const base = k * STOREY;
      const y0 = base + (k === 0 ? (brick ? 0.7 : 0.75) : 0.95);
      const y1 = Math.min(corn - (brick && k === 0 ? 0.75 : 0.35), base + (k === 0 ? 3.0 : STOREY - 0.5));
      return [y0, y1];
    };
    /** The entrance's portal, which every elevation's stone stops at. */
    const portal = 0.5;
    const portalHole: Hole = {
      u0: ex - openW / 2 - portal,
      u1: ex + openW / 2 + portal,
      y0: -1,
      y1: openH + 0.35,
    };

    // The service bay's plan, read twice: by the stone it stops, and by what
    // is drawn in it further down.
    const zs = -pd / 2;
    const shutW = Math.min(4.6, pw * 0.3);
    const shutH = Math.min(3.6, podH - 0.5);
    const sx = (roll(7) - 0.5) * Math.max(0, pw - shutW - 6);
    const away = sx > 0 ? -1 : 1;
    /** Nothing on the service elevation may hang off the end of it. */
    const onRear = (x: number, half: number): number =>
      Math.max(-pw / 2 + half, Math.min(pw / 2 - half, x));
    const sdx = onRear(sx + away * (shutW / 2 + 1.4), 0.8);
    const gx = onRear(sx - away * (shutW / 2 + 1.6), 2.5);
    const mx = onRear(sdx + away * 1.5, 0.6);
    const serviceHoles: Hole[] = [
      { u0: sx - shutW / 2 - 0.25, u1: sx + shutW / 2 + 0.25, y0: -1, y1: shutH + 0.3 },
      { u0: sdx - 0.75, u1: sdx + 0.75, y0: -1, y1: 2.55 },
      { u0: gx - 1.0, u1: gx + 1.0, y0: podH - 1.9, y1: podH - 0.5 },
      { u0: mx - 0.5, u1: mx + 0.5, y0: 0.5, y1: 1.7 },
    ];

    /**
     * A window in a stone bay: the sheet set back in its frame, the frame's
     * lights, an architrave of the same stone standing proud round it and a
     * deeper sill under it — four depths, so the opening reads as a hole in
     * the stone rather than a dark rectangle laid on it.
     */
    const stoneWindow = (s: Side, plane: number, u0: number, u1: number, y0: number, y1: number, k: number): void => {
      const um = (u0 + u1) / 2;
      const ym = (y0 + y1) / 2;
      const ow = u1 - u0;
      const oh = y1 - y0;
      const hb = hideBack(s);
      paneOn(s, plane, um, ym, ow, oh, 0.04, 0.02, podSkin);
      // A member that butts into another at both ends leaves those faces out:
      // a post its top and foot, a rail its two ends.
      const post = hb | HIDE_TOP | HIDE_UNDER;
      const rail = hb | hideEnds(s);
      for (const e of [-1, 1]) lay(s, plane, um + e * (ow / 2 + 0.09), ym + 0.04, 0.18, oh + 0.08, 0.12, 0.06, podSkin, post);
      lay(s, plane, um, y1 + 0.09, ow + 0.36, 0.18, 0.12, 0.06, podSkin, hb);
      lay(s, plane, um, y0 - 0.07, ow + 0.44, 0.14, 0.18, 0.09, podSkin);
      lay(s, plane, um, y1 - 0.04, ow, 0.08, 0.08, 0.04, frameC, rail);
      lay(s, plane, um, y0 + 0.05, ow, 0.1, 0.08, 0.04, frameC, rail);
      const lights = Math.max(1, Math.round(ow / 1.5));
      for (let j = 0; j <= lights; j++) {
        const u = Math.max(u0 + 0.04, Math.min(u1 - 0.04, u0 + (j / lights) * ow));
        lay(s, plane, u, ym, j === 0 || j === lights ? 0.08 : 0.06, oh, 0.08, 0.04, frameC, post);
      }
      if (k === 0 && oh > 1.8) lay(s, plane, um, y0 + oh * 0.76, ow, 0.07, 0.08, 0.04, frameC, rail);
    };

    for (const s of SIDES) {
      const span = lenOf(s, pw, pd);
      const plane = planeOf(s, pw, pd);
      const xs = runsAlongX(s);
      const front = s === "+z";
      const rear = s === "-z";
      const n = Math.max(2, Math.round(span / 5.5));
      const pitch = span / n;
      const holes: Hole[] = [];
      if (front) holes.push(portalHole);
      if (rear) holes.push(...serviceHoles);
      /**
       * Pier `i`'s span along the elevation. The corner piers on the two Z
       * elevations wrap the corner, over the thickness of the flank's own
       * corner pier, so the stone closes round it.
       */
      const pierAt = (i: number): [number, number] => {
        if (i === 0) return [-span / 2 - (xs ? pierOut : 0), -span / 2 + rib];
        if (i === n) return [span / 2 - rib, span / 2 + (xs ? pierOut : 0)];
        const c = -span / 2 + i * pitch;
        return [c - rib / 2, c + rib / 2];
      };
      const piers: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const [u0, u1] = pierAt(i);
        if (front && u1 > portalHole.u0 - 0.3 && u0 < portalHole.u1 + 0.3) continue;
        if (rear && serviceHoles.some((o) => u1 > o.u0 - 0.1 && u0 < o.u1 + 0.1)) continue;
        piers.push([u0, u1]);
        holes.push({ u0, u1, y0: -1, y1: corn + 1 });
      }
      // The bays' windows, on the three public bearings. The back is the
      // service elevation and has its own four things on it; a building glazed
      // the whole way round at street level has no back.
      if (!rear) {
        for (let i = 0; i < n; i++) {
          const L = pierAt(i)[1];
          const R = pierAt(i + 1)[0];
          const u0 = L + 0.22;
          const u1 = R - 0.22;
          if (u1 - u0 < 1.0) continue;
          if (front && u1 + 0.5 > portalHole.u0 && u0 - 0.5 < portalHole.u1) continue;
          for (let k = 0; k < storeys; k++) {
            const [y0, y1] = win(k);
            if (y1 - y0 < 0.9) continue;
            stoneWindow(s, plane, u0, u1, y0, y1, k);
            holes.push({ u0: u0 - 0.18, u1: u1 + 0.18, y0: y0 - 0.14, y1: y1 + 0.18 });
            // A shopfront's FASCIA, the painted board a brick block's ground
            // floor carries its name on, between the head and the coping.
            if (brick && k === 0 && corn - y1 > 0.45) {
              const fy0 = y1 + 0.2;
              lay(s, plane, (L + R) / 2, (fy0 + corn - 0.04) / 2, R - L, corn - 0.04 - fy0, 0.1, 0.05, frameC, hideBack(s));
              lay(s, plane, (L + R) / 2, corn - 0.07, R - L, 0.06, 0.16, 0.08, frameC);
              holes.push({ u0: L, u1: R, y0: y1 + 0.18, y1: corn + 1 });
            }
          }
        }
      }
      // The stone itself, round everything above.
      ashlar(s, plane, -span / 2, span / 2, BASE, corn, holes, podSkin);
      // The piers, cased in the same stone 16 cm proud and jointed every
      // course; a shopfront's carry a capital at the fascia line.
      for (const [u0, u1] of piers) {
        const courses = Math.max(1, Math.round((corn - BASE) / 1.45));
        const ch = (corn - BASE) / courses;
        for (let c = 0; c < courses; c++) {
          const y = BASE + c * ch + (ch - J) / 2;
          const hide = hideBack(s) | HIDE_UNDER | (y + ch / 2 > 2.0 ? HIDE_TOP : 0);
          lay(s, plane, (u0 + u1) / 2, y, u1 - u0, ch - J, pierOut, pierOut / 2, podSkin, hide);
        }
        if (brick) lay(s, plane, (u0 + u1) / 2, corn - 0.2, u1 - u0 + 0.14, 0.24, pierOut + 0.07, (pierOut + 0.07) / 2, podSkin);
      }
    }

    // The string at the storey line, on a base deep enough to have one. It is
    // what turns a seven-metre mass into two courses, and it lands on `STOREY`
    // so the podium and the shaft above it are read on one rhythm.
    if (storeys > 1) sb.box(pw + 0.3, 0.26, pd + 0.3, 0, STOREY, 0, podSkin);
    // The coping, a metal flashing over it, and a dark reglet under it: the
    // ledge the shaft rises out of, and three lines where there was one.
    sb.box(pw + 0.24, 0.5, pd + 0.24, 0, podH + 0.1, 0, podSkin);
    sb.box(pw + 0.32, 0.05, pd + 0.32, 0, podH + 0.375, 0, ALLOY);
    sb.box(pw + 0.14, 0.08, pd + 0.14, 0, podH - 0.19, 0, DARK_CONCRETE, undefined, HIDE_UNDER);

    // --- the entrance: a portal, the screen, a shut door, a canopy ---------
    {
      const zf = pd / 2;
      const hb = hideBack("+z");
      // The portal: heavier stone than anything round it, 20 cm proud, so the
      // entrance is the deepest thing on the elevation as well as the widest.
      for (const k of [-1, 1]) {
        sb.box(portal, openH + 0.35, 0.2, ex + k * (openW / 2 + portal / 2), (openH + 0.35) / 2, zf + 0.1, podSkin, undefined, hb);
      }
      sb.box(openW + 2 * portal, 0.35, 0.2, ex, openH + 0.175, zf + 0.1, podSkin, undefined, hb);
      sb.box(openW + 2 * portal + 0.1, 0.06, 0.26, ex, openH + 0.38, zf + 0.13, ALLOY);

      const sill = 0.14;
      const gh = openH - sill - 0.24;
      const mull = 0.16;
      const bays = Math.max(2, Math.round(openW / 2.6));
      const pitch = openW / bays;
      // Unbacked — the one sheet on a tower that is. See `buildTower`.
      for (let i = 0; i < bays; i++) {
        const cx = ex - openW / 2 + (i + 0.5) * pitch;
        b.pane(pitch - mull, gh, 0.1, cx, sill + gh / 2, zf);
      }
      for (let i = 0; i <= bays; i++) {
        const cx = ex - openW / 2 + i * pitch;
        sb.box(mull, gh + 0.2, 0.2, cx, sill + gh / 2, zf + 0.03, ALLOY);
      }
      sb.box(openW + 0.4, 0.28, 0.3, ex, openH - 0.14, zf + 0.03, ALLOY);
      sb.box(openW + 0.4, 0.2, 0.42, ex, 0.1, zf + 0.04, DARK_CONCRETE);

      // The doors, SHUT — the inverse of the shophouse's rule, for the reason
      // in `buildTower`'s header. Two leaves with their meeting stiles together
      // in the middle, a transom over them, a kick plate and a pull on each.
      const dw = 2.3;
      const dh = Math.min(2.45, gh - 0.1);
      for (const s of [-1, 1]) {
        sb.box(0.1, dh, 0.14, ex + (s * dw) / 2, sill + dh / 2, zf + 0.06, ALLOY);
        sb.box(0.07, dh, 0.14, ex + s * 0.05, sill + dh / 2, zf + 0.06, ALLOY);
        sb.box(dw / 2 - 0.1, 0.09, 0.14, ex + (s * dw) / 4, sill + dh - 0.05, zf + 0.06, ALLOY);
        sb.box(dw / 2 - 0.1, 0.18, 0.14, ex + (s * dw) / 4, sill + 0.09, zf + 0.06, ALLOY);
        sb.box(dw / 2 - 0.2, 0.22, 0.02, ex + (s * dw) / 4, sill + 0.3, zf + 0.14, ALLOY);
        sb.box(0.05, 1.0, 0.05, ex + s * 0.26, sill + 1.06, zf + 0.15, ALLOY);
        for (const e of [-1, 1]) sb.box(0.04, 0.04, 0.1, ex + s * 0.26, sill + 1.06 + e * 0.42, zf + 0.1, ALLOY);
      }
      if (gh - dh > 0.4) sb.box(openW, 0.1, 0.16, ex, sill + dh + 0.05, zf + 0.04, ALLOY);
      // A mat inside the doors, 2 cm over the lobby floor.
      sb.box(dw + 0.6, 0.02, 1.2, ex, 0.15, zf - 0.75, DARK_CONCRETE);

      // The canopy — what says ENTRANCE from sixty metres, and the one thing on
      // the podium that projects. It hangs at `openH`, which is over reach, so
      // nothing walks through it. Two tie rods back to the wall, because a slab
      // standing two metres off a building with nothing holding it up reads as
      // a mistake; downlights under it, because a canopy is what lights a door.
      const proj = Math.min(2.1, recess + 0.7);
      const cy = openH + 0.46;
      sb.box(openW + 1.7, 0.22, proj, ex, cy, zf + proj / 2 - 0.15, ALLOY);
      sb.box(openW + 1.7, 0.42, 0.16, ex, cy - 0.06, zf + proj - 0.22, DARK_CONCRETE);
      sb.box(openW + 1.7, 0.08, 0.06, ex, cy + 0.19, zf + proj - 0.17, ALLOY);
      for (const s of [-1, 1]) sb.box(0.16, 0.42, proj - 0.16, ex + s * (openW / 2 + 0.77), cy - 0.06, zf + proj / 2 - 0.22, DARK_CONCRETE);
      {
        const lamps = Math.max(2, Math.round((openW + 1.2) / 1.6));
        for (let i = 0; i < lamps; i++) {
          const lx = ex - (openW + 1.2) / 2 + ((i + 0.5) * (openW + 1.2)) / lamps;
          lens.box(0.32, 0.02, 0.32, lx, cy - 0.12, zf + proj * 0.42, WINDOW_LIGHT);
        }
      }
      {
        // The ties end where there is WALL: on the podium's stone under its
        // coping, or over the coping on the face of the shaft above it.
        const rise = 1.35;
        const zt = cy + rise > podH - 0.15 ? d / 2 + 0.2 : zf + 0.06;
        const reach = zf + proj - 0.25 - zt;
        const len = Math.hypot(reach, rise);
        for (const s of [-1, 1]) {
          const tx = ex + s * (openW / 2 + 0.6);
          // Negative: a positive `rotation.x` tips local +Y toward +Z, and the
          // TOP of a tie is the end against the wall. Positive here draws a
          // strut rising to a point in mid-air off the canopy's outer edge,
          // which is the same three boxes and reads as a mistake.
          sb.box(0.07, len, 0.07, tx, cy + rise / 2, zt + reach / 2, ALLOY, { x: -Math.atan2(reach, rise) });
          sb.box(0.22, 0.22, 0.04, tx, cy + rise, zt + 0.02, ALLOY);
        }
      }
      // The name band on the fascia. A board either way; naming a colour is
      // what lights its FACE, which is `buildShophouse`'s reading of `sign` —
      // a `flicker` is only visible on a light, and this is a lens.
      if (t.sign) lens.box(openW * 0.66, 0.24, 0.03, ex, cy - 0.06, zf + proj - 0.125, t.sign);
      // The street number, on whichever pier is the wider of the two, on a
      // plate over the stone.
      if (Math.max(pierL, pierR) > 1.2) {
        const numX = pierL > pierR ? -pw / 2 + pierL / 2 : pw / 2 - pierR / 2;
        sb.box(0.5, 0.62, 0.04, numX, 2.5, zf + 0.08, ALLOY);
        sb.box(0.36, 0.44, 0.02, numX, 2.5, zf + 0.11, DARK_CONCRETE);
      }

      // One light, and only where a layout spends it. See the set's header on
      // the budget: this is a pool of light on the pavement at a tower a round
      // is fought around, not something thirty-seven buildings each get.
      if (t.litWindows) {
        b.light(WINDOW_LIGHT, 13, 0.7, 0.02, ex, openH - 0.5, zBack + recess * 0.6);
      }
    }

    // --- the lobby, drawn in the notch -------------------------------------
    //
    // It takes NO occlusion from the mass it is standing inside: `occlusionAt`
    // skips an occluder its sample point is within (`r < SELF`), so a room cut
    // into a collider is shaded as though it were out on the pavement. That is
    // the set's header's "bright plate under a black lid" with the lid missing
    // too, and the lit fittings are what answer it — one bright thing in a dark
    // hole is what a lobby looks like from a street at dusk anyway.
    {
      sb.box(openW, 0.14, recess, ex, 0.07, zFront, RENDER);
      // The soffit, and the FITTINGS in it rather than a lit ceiling: the
      // first cut glowed the whole soffit and the bloom took it to a flat white
      // rectangle with no lobby behind it. Two strips and the beams between
      // them read as downlighting because they are.
      sb.box(openW, 0.18, recess, ex, openH - 0.09, zFront, DARK_CONCRETE);
      for (let i = 1; i < 4; i++) {
        sb.box(0.12, 0.16, recess, ex - openW / 2 + (i / 4) * openW, openH - 0.26, zFront, DARK_CONCRETE);
      }
      for (const s of [-1, 1]) {
        lens.box(openW - 1.4, 0.05, 0.3, ex, openH - 0.21, zFront + s * recess * 0.22, WINDOW_LIGHT);
      }
      // The lift lobby on the back wall, which is the thing that says there is
      // a building over this rather than a shop: two cars in steel frames, a
      // call panel and the floor indicator over each.
      sb.box(openW, openH, 0.14, ex, openH / 2, zBack + 0.07, DARK_CONCRETE);
      const liftH = Math.min(2.3, openH - 0.5);
      for (const s of [-1, 1]) {
        const lx = ex + s * 0.92;
        sb.box(1.32, liftH + 0.12, 0.04, lx, (liftH + 0.12) / 2, zBack + 0.16, ALLOY);
        for (const e of [-1, 1]) sb.box(0.54, liftH, 0.04, lx + e * 0.28, liftH / 2, zBack + 0.2, ALLOY);
        lens.box(0.4, 0.08, 0.03, lx, liftH + 0.32, zBack + 0.16, ROOM_GLOW);
      }
      lens.box(0.08, 0.16, 0.05, ex, liftH * 0.5, zBack + 0.2, WINDOW_LIGHT);
      // Panelling on the back wall either side of the cars: timber battens, the
      // one warm material in the base, and what the lobby reads as from across
      // the street once it is lit.
      for (const s of [-1, 1]) {
        const a = ex + s * 1.7;
        const z = ex + (s * openW) / 2;
        const lo = Math.min(a, z);
        const hi = Math.max(a, z);
        for (let u = lo + 0.2; u < hi - 0.1; u += 0.32) {
          sb.box(0.16, openH - 0.5, 0.04, u, (openH - 0.5) / 2 + 0.14, zBack + 0.16, TEAK);
        }
      }
      // The directory on one side wall, which faces the doors.
      {
        const dx = ex - openW / 2 + 0.03;
        sb.box(0.04, 1.2, Math.min(1.1, recess - 0.5), dx, 1.5, zFront, ALLOY);
        for (let r = 0; r < 5; r++) sb.box(0.02, 0.1, Math.min(0.9, recess - 0.7), dx + 0.03, 1.15 + r * 0.18, zFront, podSkin);
      }
      // The desk, set back and to one side so that the way past it reads, with
      // a stone front, a screen and a lamp on it.
      const deskW = Math.max(2.2, openW * 0.4);
      const deskX = ex - openW * 0.16;
      sb.box(deskW, 1.02, 0.62, deskX, 0.65, zBack + 1.05, TEAK);
      sb.box(deskW - 0.1, 0.8, 0.03, deskX, 0.62, zBack + 1.375, podSkin);
      sb.box(deskW + 0.18, 0.08, 0.76, deskX, 1.2, zBack + 1.05, ALLOY);
      sb.box(0.5, 0.32, 0.04, deskX - deskW * 0.2, 1.42, zBack + 0.9, DARK_CONCRETE);
      lens.box(0.18, 0.06, 0.18, deskX + deskW * 0.3, 1.27, zBack + 0.95, WINDOW_LIGHT);
      // A bench against the far pier. It is the only thing in here at a
      // person's scale, which is what gives the rest of it one.
      sb.box(1.5, 0.1, 0.44, ex + openW * 0.3, 0.55, zBack + 0.75, TEAK);
      for (const s of [-1, 1]) {
        sb.box(0.08, 0.4, 0.4, ex + openW * 0.3 + s * 0.68, 0.34, zBack + 0.75, ALLOY);
      }
    }

    // --- the service side, on -Z -------------------------------------------
    //
    // The back of a building is the other half of it having a front. A shutter,
    // a door beside it, an extract grille and a riser, and a meter cupboard:
    // flat things on a wall, every one of them drawn on the elevation rather
    // than standing off it, and between them the reason a player who has
    // walked round the block knows which way they are facing.
    {
      const hb = hideBack("-z");
      // The shutter, drawn SHUT in its frame: guide channels, eight slats, and
      // a wheel guard either side at the foot, low enough to step over.
      sb.box(shutW + 0.4, shutH + 0.3, 0.16, sx, (shutH + 0.3) / 2, zs - 0.08, DARK_CONCRETE, undefined, hb);
      sb.box(shutW, shutH, 0.1, sx, shutH / 2, zs - 0.17, RUST, undefined, hb);
      for (let i = 1; i < 9; i++) sb.box(shutW, 0.06, 0.05, sx, (i / 9) * shutH, zs - 0.23, DARK_CONCRETE, undefined, hb);
      sb.box(shutW, 0.12, 0.06, sx, 0.1, zs - 0.24, ALLOY, undefined, hb);
      for (const k of [-1, 1]) {
        sb.box(0.1, shutH, 0.14, sx + k * (shutW / 2 + 0.03), shutH / 2, zs - 0.23, ALLOY, undefined, hb);
        sb.box(0.3, 0.24, 0.3, sx + k * (shutW / 2 + 0.35), 0.12, zs - 0.15, DARK_CONCRETE, undefined, HIDE_UNDER);
      }
      sb.box(shutW + 1.6, 0.06, 0.5, sx, 0.03, zs - 0.25, ASPHALT);
      // The service door in its frame, a vent in its foot, the step under it,
      // the lamp over it and the plate beside it.
      sb.box(1.5, 2.55, 0.1, sdx, 1.275, zs - 0.05, DARK_CONCRETE, undefined, hb);
      sb.box(1.1, 2.2, 0.12, sdx, 1.1, zs - 0.11, IRON, undefined, hb);
      for (let i = 0; i < 4; i++) sb.box(0.7, 0.04, 0.03, sdx, 0.3 + i * 0.1, zs - 0.18, DARK_CONCRETE);
      sb.box(0.07, 0.34, 0.06, sdx + 0.38, 1.05, zs - 0.2, ALLOY);
      sb.box(1.5, 0.16, 0.5, sdx, 0.08, zs - 0.25, DARK_CONCRETE);
      sb.box(0.4, 0.14, 0.18, sdx, 2.75, zs - 0.09, ALLOY, undefined, hb);
      lens.box(0.28, 0.04, 0.12, sdx, 2.66, zs - 0.1, WINDOW_LIGHT);
      sb.box(0.36, 0.24, 0.03, sdx - away * 0.95, 1.6, zs - 0.075, ALLOY, undefined, hb);
      // The meter cupboard.
      sb.box(0.9, 1.1, 0.12, mx, 1.1, zs - 0.08, ALLOY, undefined, hb);
      sb.box(0.04, 0.2, 0.05, mx + 0.32, 1.1, zs - 0.16, DARK_CONCRETE);
      // The grille and the riser beside it: the two pieces of plant that are
      // always on the back of a building and never on the front. The grille's
      // blades are tipped, so it is a louvre rather than a striped board.
      sb.box(1.8, 1.2, 0.14, gx, podH - 1.2, zs - 0.07, ALLOY, undefined, hb);
      for (let i = 0; i < 5; i++) blade("-z", pd / 2, gx, podH - 1.68 + i * 0.24, 1.66, 0.18, 0.2, DARK_CONCRETE, 0.6);
      b.cyl(podH - 0.4, 0.16, 0.16, 6, gx + 1.5, (podH - 0.4) / 2, zs - 0.16, RUST);
      for (let y = 0.9; y < podH - 0.6; y += 1.2) sb.box(0.22, 0.05, 0.18, gx + 1.5, y, zs - 0.09, DARK_CONCRETE);
    }
  }

  // === the shaft =============================================================

  if (!brick) {
    /**
     * The curtain wall's SYSTEM — see this function's header. 0 is ribbon, 1
     * grid, 2 expressed columns.
     */
    const system = Math.min(2, Math.floor(roll(41) * 3));
    /** The glass's outer face, off the mass. */
    const GF = 0.1;

    /**
     * One mass's curtain wall, from `y0` to `y1`, and its parapet up to `cap`.
     * The glazing's bands are keyed to `STOREY` as the collars were, so a band
     * is a storey however tall the mass; the bays to the fins' 5.5 m, and the
     * modules to 1.6 m inside a bay.
     */
    const curtain = (mw: number, md: number, y0: number, y1: number, cap: number): void => {
      const tall = y1 - y0 - 0.6;
      if (tall <= 0) return;
      const rows = Math.max(1, Math.round(tall / STOREY));
      const band = tall / rows;
      const foot = y0 + 0.3;
      const head = foot + tall;
      const bayCount = (span: number): number => Math.max(2, Math.round(span / 5.5));
      /**
       * The plant floor. A tower has one and it is never at the top: a band of
       * louvres two thirds of the way up is the cheapest thing there is that
       * says there is machinery in here, and it breaks the glazing's rhythm at
       * a height the eye is already reading.
       */
      const mech = rows >= 5 ? Math.max(1, Math.round(rows * (0.5 + roll(13) * 0.28))) : -1;
      /** Which bay of the spine flank is blind, all the way up. */
      const nzBays = bayCount(md);
      const spineBay = Math.min(nzBays - 1, Math.max(0, Math.round((nzBays - 1) * roll(14))));
      /** The spandrel at the foot of every band: the floor edge it covers. */
      const SP = Math.min(1.05, band * 0.3);
      const fin = 0.26;

      for (const [si, s] of SIDES.entries()) {
        const L = lenOf(s, mw, md);
        const plane = planeOf(s, mw, md);
        const xs = runsAlongX(s);
        const hb = hideBack(s);
        const n = bayCount(L);
        const pitch = L / n;
        const k = Math.max(1, Math.round(pitch / 1.6));
        const mod = pitch / k;
        const blind = !xs && outward(s) === spine ? spineBay : -1;
        /** Bay `i`'s glass, inset from the corners and from the fins. */
        const glassOf = (i: number): [number, number] => [
          -L / 2 + i * pitch + (i === 0 ? 0.6 : fin / 2 + 0.04),
          -L / 2 + (i + 1) * pitch - (i === n - 1 ? 0.6 : fin / 2 + 0.04),
        ];

        for (let r = 0; r < rows; r++) {
          const fb = foot + band * r;
          const vy0 = fb + SP;
          const vy1 = fb + band - 0.04;
          const vh = vy1 - vy0;
          const vm = (vy0 + vy1) / 2;
          // Whether this storey is working late, and how much of it is. Lit
          // floors rather than lit windows: an office keeps its lights on a
          // floor at a time, and scattered ones read as a fault in the drawing.
          const share = lit && towerRoll(w, h, r, 5) > 0.64 ? 0.4 : 0.06;

          if (r === mech) {
            // The plant floor: a dark void behind tipped blades, the whole
            // side's length, with the mullions and fins carried over it.
            lay(s, plane, 0, vm, L - 1.2, vh, 0.14, 0.03, DARK_CONCRETE, hb);
            const slats = Math.max(3, Math.round(vh / 0.3));
            for (let q = 0; q < slats; q++) {
              blade(s, plane, 0, vy0 + ((q + 0.5) / slats) * vh, L - 1.2, 0.24, GF + 0.06, ALLOY, 0.65);
            }
          } else {
            // The glass: one sheet per storey per side, broken only round the
            // spine. The mullions and fins drawn over it are what divide it,
            // so a sheet per bay bought nothing but sheets.
            const runs: [number, number][] =
              blind < 0
                ? [[-L / 2 + 0.6, L / 2 - 0.6]]
                : [
                    [-L / 2 + 0.6, glassOf(blind)[0] - 0.08],
                    [glassOf(blind)[1] + 0.08, L / 2 - 0.6],
                  ];
            for (const [g0, g1] of runs) {
              if (g1 - g0 > 0.2) paneOn(s, plane, (g0 + g1) / 2, vm, g1 - g0, vh, 0.14, 0.03, skin);
            }
            for (let i = 0; i < n; i++) {
              if (i === blind || !lit) continue;
              const [g0, g1] = glassOf(i);
              // The lit rooms, a module at a time, inset inside the module so
              // each keeps a frame of unlit glass round it: a glow filling its
              // own bay is a panel that HAS no bay, and the grid the elevation
              // is read by disappears wherever the lights are on.
              for (let j = 0; j < k; j++) {
                const m0 = Math.max(g0, -L / 2 + i * pitch + j * mod);
                const m1 = Math.min(g1, -L / 2 + i * pitch + (j + 1) * mod);
                if (m1 - m0 < 0.7) continue;
                const mu = (m0 + m1) / 2;
                if (towerRoll(mu, vm, si * 100 + i * 10 + j, 9) >= share) continue;
                lensG.onFace(s, plane, mu, vm, m1 - m0 - 0.4, vh - 0.6, 0.03, GF + 0.02, ROOM_GLOW);
              }
            }
          }

          // What covers this band's floor edge.
          if (system === 0) {
            // Ribbon: a precast band the length of the side, 24 cm off the
            // mass — proud of everything but the spine — and a drip on its
            // head. The Z elevations' bands return over the flanks'.
            lay(s, plane, 0, fb + SP / 2, L + (xs ? 0.48 : 0), SP, 0.24, 0.12, CONCRETE, hb);
            lay(s, plane, 0, fb + SP + 0.02, L + (xs ? 0.56 : 0), 0.04, 0.28, 0.14, ALLOY, hb);
          } else if (system === 1) {
            // Grid: a dark spandrel flush with the glass, and the transoms at
            // the sill and the head of the vision glass, set back from the
            // mullions so the mullions read as the continuous members they are.
            lay(s, plane, 0, fb + SP / 2, L, SP, 0.14, 0.03, DARK_CONCRETE, hb);
            for (const ty of [vy0 + 0.04, vy1 - 0.02]) lay(s, plane, 0, ty, L, 0.08, 0.08, GF + 0.04, ALLOY, hb | hideEnds(s));
          } else {
            // Columns: a recessed precast spandrel between each pair of
            // column covers, and a thin sill on it.
            for (let i = 0; i < n; i++) {
              const a = -L / 2 + i * pitch + 0.35;
              const z = -L / 2 + (i + 1) * pitch - 0.35;
              lay(s, plane, (a + z) / 2, fb + SP / 2, z - a, SP, 0.22, 0.11, CONCRETE, hb);
              lay(s, plane, (a + z) / 2, fb + SP + 0.02, z - a, 0.04, 0.26, 0.13, ALLOY, hb);
            }
          }
        }

        // The parapet zone over the glass, in the system's own cladding, and
        // its coping. NOT backed-off: above the mass its inner face is seen.
        const ph = cap - head;
        if (system === 0) {
          lay(s, plane, 0, head + ph / 2, L + (xs ? 0.48 : 0), ph, 0.24, 0.12, CONCRETE);
        } else if (system === 1) {
          lay(s, plane, 0, head + ph / 2, L + (xs ? 0.28 : 0), ph, 0.14, 0.07, DARK_CONCRETE);
        } else {
          lay(s, plane, 0, head + ph / 2, L + (xs ? 0.44 : 0), ph, 0.22, 0.11, CONCRETE);
        }
        const co = system === 2 ? 0.56 : system === 1 ? 0.46 : 0.34;
        lay(s, plane, 0, cap + 0.06, L + (xs ? 2 * co : 0), 0.12, co + 0.3, (co - 0.3) / 2, ALLOY);

        // The verticals, each one box the height of the mass, with their top
        // and foot left out — each runs from a coping to a coping.
        const post = hb | HIDE_TOP | HIDE_UNDER;
        const vTop = system === 0 ? head : cap;
        const vMid = (foot + vTop) / 2;
        const vH = vTop - foot;
        for (let m = 1; m < n * k; m++) {
          const u = -L / 2 + m * mod;
          const bay = Math.floor(m / k);
          const atFin = m % k === 0;
          if (!atFin && bay === blind) continue;
          if (system === 1) {
            if (atFin) {
              lay(s, plane, u, (foot + cap) / 2, 0.12, cap - foot, 0.32, GF + 0.16, ALLOY, post);
              lay(s, plane, u, (foot + cap) / 2, 0.05, cap - foot, 0.04, GF + 0.34, ALLOY, post);
            } else {
              lay(s, plane, u, (foot + head) / 2, 0.08, head - foot, 0.14, GF + 0.07, ALLOY, post);
            }
          } else if (system === 2 && atFin) {
            lay(s, plane, u, (foot - 0.3 + cap) / 2, 0.7, cap - foot + 0.3, 0.5, 0.25, skin, post);
          } else {
            lay(s, plane, u, (foot + head) / 2, atFin ? 0.12 : 0.07, head - foot, 0.08, GF + 0.04, ALLOY, post);
          }
        }
        // The corners.
        for (const e of [-1, 1]) {
          if (system === 0) {
            const a = xs ? L / 2 + 0.2 : L / 2;
            lay(s, plane, e * (a + L / 2 - 0.6) / 2, vMid, a - (L / 2 - 0.6), vH, 0.2, 0.1, skin, hb);
          } else if (system === 1) {
            const a = xs ? L / 2 + 0.1 : L / 2;
            lay(s, plane, e * (a + L / 2 - 0.6) / 2, (foot + head) / 2, a - (L / 2 - 0.6), head - foot, 0.14, 0.03, DARK_CONCRETE, hb);
            lay(s, plane, e * (L / 2 - 0.3), (foot + cap) / 2, 0.12, cap - foot, 0.32, GF + 0.16, ALLOY, hb);
          } else {
            const a = xs ? L / 2 + 0.5 : L / 2;
            lay(s, plane, e * (a + L / 2 - 0.7) / 2, (foot - 0.3 + cap) / 2, a - (L / 2 - 0.7), cap - foot + 0.3, 0.5, 0.25, skin, hb);
          }
        }

        // The spine: the blind bay, solid the height of the mass, and its
        // pilaster standing proud of it — jointed at every storey, with the
        // stair's slot window in each segment. A slot of solid wall in a
        // curtain reads as a mistake; the same slot with a rib on it, and the
        // stair lit up it a window at a time, reads as a core.
        if (blind >= 0) {
          const [g0, g1] = glassOf(blind);
          const bu = (g0 + g1) / 2;
          lay(s, plane, bu, (foot + head) / 2, g1 - g0 + 0.08, head - foot, 0.16, 0.04, skin, hb);
          const pwid = pitch * 0.62;
          for (let r = 0; r < rows; r++) {
            const fb = foot + band * r;
            lay(s, plane, bu, fb + band / 2, pwid, band - J, 0.3, 0.15, skin, hb);
            const sh = band - 1.3;
            if (sh < 0.8) continue;
            const sy = fb + 0.75 + sh / 2;
            paneOn(s, plane, bu, sy, 0.46, sh, 0.04, 0.32, skin);
            for (const e of [-1, 1]) lay(s, plane, bu + e * 0.27, sy, 0.08, sh + 0.08, 0.06, 0.33, ALLOY, hb);
            lay(s, plane, bu, sy - sh / 2 - 0.06, 0.66, 0.08, 0.1, 0.35, ALLOY);
            if (lit && towerRoll(bu, sy, si, 19) < 0.5) {
              lensG.onFace(s, plane, bu, sy, 0.3, sh - 0.2, 0.02, 0.35, ROOM_GLOW);
            }
          }
        }
      }
    };

    // The shaft from the podium's coping to the terrace, and the setback from
    // the terrace to the roof; each takes its parapet with it.
    curtain(w, d, podH, lower, lower + 0.75);
    if (setback > 0) curtain(sw, sd, lower, h - 0.4, h + 0.65);

    // The terrace the setback leaves, laid in a membrane 4 cm over the mass,
    // with a handrail on its parapet and the condensers on its back.
    if (setback > 0) {
      const y = lower + 0.01;
      for (const k of [-1, 1]) {
        sb.box(w, 0.06, (d - sd) / 2, 0, y, k * (sd / 2 + (d - sd) / 4), ASPHALT, undefined, HIDE_UNDER);
        sb.box((w - sw) / 2, 0.06, sd, k * (sw / 2 + (w - sw) / 4), y, 0, ASPHALT, undefined, HIDE_UNDER);
      }
      const ry = lower + 0.87;
      for (const s of SIDES) {
        const L = lenOf(s, w, d);
        const plane = planeOf(s, w, d) - 0.12;
        const posts = Math.max(2, Math.round(L / 4));
        for (let i = 0; i <= posts; i++) {
          lay(s, plane, -L / 2 + 0.15 + (i / posts) * (L - 0.3), ry + 0.5, 0.05, 1.0, 0.05, 0, ALLOY, HIDE_TOP | HIDE_UNDER);
        }
        lay(s, plane, 0, ry + 1.0, L - 0.2, 0.05, 0.06, 0, ALLOY, hideEnds(s));
        lay(s, plane, 0, ry + 0.5, L - 0.2, 0.03, 0.03, 0, ALLOY, hideEnds(s));
      }
      const ringZ = -(sd / 2 + (d - sd) / 4);
      const units = Math.max(1, Math.min(4, Math.floor(sw / 3.2)));
      for (let i = 0; i < units; i++) {
        const ux = -sw / 2 + ((i + 0.5) * sw) / units;
        sb.box(1.3, 0.9, 1.0, ux, lower + 0.49, ringZ, ALLOY);
        sb.box(1.36, 0.06, 1.06, ux, lower + 0.97, ringZ, DARK_CONCRETE);
        for (let q = 0; q < 4; q++) sb.box(1.2, 0.04, 0.02, ux, lower + 0.2 + q * 0.17, ringZ - 0.51, DARK_CONCRETE);
        b.cyl(0.06, 0.8, 0.8, 10, ux, lower + 1.03, ringZ, DARK_CONCRETE);
      }
    }
  } else {
    drawBrickStock({ b, sb, lens, lensG, rnd, w, d, h, podH, lit, lay, paneOn, roll });
  }

  // === the crown =============================================================
  //
  // Visual only; the shaft's own collider already stops everything at this
  // height. **Three crowns rather than one, chosen by the roll**, because the
  // skyline is what thirty-seven of these are FOR and a skyline of one
  // silhouette repeated is a texture rather than a city. Each is the same three
  // ideas in a different arrangement: something tall and off-centre (the lift
  // overrun), something low and wide (the plant), and something thin against
  // the sky.
  {
    const topW = setback > 0 ? sw : w;
    const topD = setback > 0 ? sd : d;
    const crown = brick ? 3 : Math.min(2, Math.floor(roll(31) * 3));
    const ox = topW * (roll(32) - 0.5) * 0.4;
    const oz = topD * (roll(33) - 0.5) * 0.4;
    // The roof's membrane, 4 cm over the mass and inside the parapet.
    sb.box(topW - (brick ? 0.6 : 0.02), 0.06, topD - (brick ? 0.6 : 0.02), 0, h + 0.01, 0, ASPHALT, undefined, HIDE_UNDER);

    /** A cat ladder up face `s` of a box centred at (cx, cz). */
    const ladder = (x: number, z: number, alongX: boolean, y0: number, y1: number, color: string): void => {
      for (const e of [-1, 1]) {
        if (alongX) sb.box(0.05, y1 - y0, 0.05, x + e * 0.22, (y0 + y1) / 2, z, color);
        else sb.box(0.05, y1 - y0, 0.05, x, (y0 + y1) / 2, z + e * 0.22, color);
      }
      for (let y = y0 + 0.3; y < y1 - 0.1; y += 0.3) {
        if (alongX) sb.box(0.44, 0.03, 0.03, x, y, z, color);
        else sb.box(0.03, 0.03, 0.44, x, y, z, color);
      }
    };

    if (crown === 0) {
      // The lift motor room and the plant beside it: the commonest roof in a
      // city, and the one that reads as a working building. The motor room
      // gets its door with the lamp over it, a louvre and a ladder to its own
      // roof; the plant is an air handler on a plinth, its panels seamed, its
      // condensers on top with their fan guards, and a duct across to the
      // motor room.
      const mw0 = topW * 0.3;
      const md0 = topD * 0.34;
      sb.box(mw0, 3.2, md0, ox, h + 1.6, oz, DARK_CONCRETE);
      sb.box(mw0 + 0.3, 0.2, md0 + 0.3, ox, h + 3.3, oz, ALLOY);
      sb.box(1.0, 2.1, 0.05, ox - mw0 * 0.2, h + 1.09, oz + md0 / 2 + 0.025, ALLOY);
      sb.box(0.05, 0.3, 0.05, ox - mw0 * 0.2 + 0.36, h + 1.05, oz + md0 / 2 + 0.07, DARK_CONCRETE);
      lens.box(0.3, 0.1, 0.08, ox - mw0 * 0.2, h + 2.4, oz + md0 / 2 + 0.05, WINDOW_LIGHT);
      sb.box(0.05, 1.1, md0 * 0.5, ox - mw0 / 2 - 0.025, h + 2.2, oz, ALLOY);
      for (let i = 0; i < 4; i++) blade("-x", -(ox - mw0 / 2), oz, h + 1.78 + i * 0.27, md0 * 0.46, 0.16, 0.06, DARK_CONCRETE, 0.6);
      ladder(ox + mw0 / 2 + 0.06, oz - md0 * 0.25, false, h, h + 3.4, ALLOY);

      const ax = -ox * 0.8;
      const az = -oz;
      const aw = topW * 0.42;
      const ad = topD * 0.24;
      sb.box(aw + 0.2, 0.15, ad + 0.2, ax, h + 0.075, az, DARK_CONCRETE);
      sb.box(aw, 1.35, ad, ax, h + 0.825, az, ALLOY);
      for (let u = -aw / 2 + 1.2; u < aw / 2 - 0.4; u += 1.2) {
        for (const e of [-1, 1]) sb.box(0.04, 1.2, 0.03, ax + u, h + 0.83, az + e * (ad / 2 + 0.015), DARK_CONCRETE);
      }
      for (let i = 0; i < 4; i++) blade("+x", ax + aw / 2, az, h + 0.4 + i * 0.26, ad * 0.8, 0.16, 0.06, DARK_CONCRETE, 0.6);
      for (let i = 0; i < 3; i++) {
        const fx = ax + (i - 1) * 1.3;
        sb.box(0.9, 0.85, 0.9, fx, h + 1.9, az, ALLOY);
        b.cyl(0.3, 0.8, 0.8, 8, fx, h + 2.45, az, DARK_CONCRETE);
        b.cyl(0.05, 0.86, 0.86, 8, fx, h + 2.62, az, ALLOY);
        sb.box(0.8, 0.03, 0.04, fx, h + 2.64, az, ALLOY);
        sb.box(0.04, 0.03, 0.8, fx, h + 2.64, az, ALLOY);
      }
      // The duct, at the motor room's height and clear of the condensers.
      {
        const [d0, d1] = ox >= 0 ? [ax + aw / 2, ox - mw0 / 2] : [ox + mw0 / 2, ax - aw / 2];
        if (d1 - d0 > 0.6 && Math.abs(az - oz) < md0 / 2 - 0.4) {
          sb.box(d1 - d0, 0.55, 0.55, (d0 + d1) / 2, h + 1.1, az, ALLOY);
        }
      }
    } else if (crown === 1) {
      // A stepped crown: two setbacks of the shaft's own skin over the
      // parapet, which is what pre-war stock did and what makes a tall one read
      // as tall. The system's fins are carried up both steps, a lit band runs
      // under each cap where the lights are on, and a spire stands on the top.
      const steps: [number, number, number][] = [
        [0.72, h, 2.4],
        [0.42, h + 2.65, 2.6],
      ];
      for (const [f, y0, hh] of steps) {
        const cw = topW * f;
        const cd = topD * f;
        sb.box(cw, hh, cd, 0, y0 + hh / 2, 0, skin);
        sb.box(cw + 0.2, 0.28, cd + 0.2, 0, y0 + hh + 0.12, 0, ALLOY);
        for (const s of SIDES) {
          const L = lenOf(s, cw, cd);
          const plane = planeOf(s, cw, cd);
          const fins = Math.max(2, Math.round(L / 1.6));
          for (let i = 1; i < fins; i++) {
            lay(s, plane, -L / 2 + (i / fins) * L, y0 + hh / 2 - 0.1, 0.1, hh - 0.4, 0.14, 0.07, ALLOY, hideBack(s));
          }
          if (lit) lens.onFace(s, plane, 0, y0 + hh - 0.16, L - 0.3, 0.12, 0.03, 0.015, ROOM_GLOW);
        }
      }
      sb.box(topW * 0.2, 1.4, topD * 0.2, ox * 0.4, h + 6.1, oz * 0.4, DARK_CONCRETE);
      sb.box(topW * 0.2 + 0.16, 0.12, topD * 0.2 + 0.16, ox * 0.4, h + 6.86, oz * 0.4, ALLOY);
      b.cyl(3.2, 0.06, 0.4, 6, ox * 0.4, h + 8.5, oz * 0.4, ALLOY);
    } else if (crown === 2) {
      // A water tank on a frame, and a gantry rail round the parapet: older
      // stock that got a lift and a tank bolted to the top of it later. The
      // tank is hooped and roofed; the frame braced, with a ring beam under
      // the tank and a ladder up one leg; the stair head has a door.
      const tankY = h + 2.9;
      b.cyl(2.6, 3.4, 3.4, 10, ox, tankY, oz, RUST);
      b.cyl(0.4, 3.6, 3.6, 10, ox, tankY + 1.5, oz, DARK_CONCRETE);
      b.cyl(0.5, 0.4, 3.5, 10, ox, tankY + 1.95, oz, DARK_CONCRETE);
      for (const hy of [-0.9, 0, 0.9]) b.cyl(0.06, 3.48, 3.48, 10, ox, tankY + hy, oz, DARK_CONCRETE);
      sb.box(2.7, 0.16, 2.7, ox, h + 1.52, oz, RUST);
      for (const sx2 of [-1, 1]) {
        for (const sz2 of [-1, 1]) {
          sb.box(0.16, 2.4, 0.16, ox + sx2 * 1.2, h + 1.2, oz + sz2 * 1.2, RUST);
          sb.box(0.3, 0.06, 0.3, ox + sx2 * 1.2, h + 0.03, oz + sz2 * 1.2, DARK_CONCRETE);
        }
        const brace = Math.hypot(2.4, 1.3);
        const ang = Math.atan2(2.4, 1.3);
        sb.box(0.06, brace, 0.06, ox + sx2 * 1.2, h + 0.8, oz, RUST, { x: ang });
        sb.box(0.06, brace, 0.06, ox, h + 0.8, oz + sx2 * 1.2, RUST, { z: ang });
      }
      ladder(ox + 1.88, oz + 0.6, false, h, h + 4.3, RUST);
      const bw = topW * 0.34;
      const bd = topD * 0.28;
      sb.box(bw, 1.6, bd, -ox, h + 0.8, -oz, DARK_CONCRETE);
      sb.box(bw + 0.2, 0.1, bd + 0.2, -ox, h + 1.65, -oz, ALLOY);
      sb.box(0.9, 1.4, 0.05, -ox, h + 0.72, -oz + bd / 2 + 0.025, ALLOY);
      // The gantry rail: a hairline round the coping, and what gives a flat top
      // a scale at all.
      for (const sz2 of [-1, 1]) {
        sb.box(topW + 0.4, 0.07, 0.07, 0, h + 1.9, (sz2 * (topD + 0.4)) / 2, ALLOY);
      }
      for (const sx2 of [-1, 1]) {
        sb.box(0.07, 0.07, topD + 0.4, (sx2 * (topW + 0.4)) / 2, h + 1.9, 0, ALLOY);
        for (let i = 0; i <= 3; i++) {
          sb.box(0.07, 1.1, 0.07, (sx2 * (topW + 0.4)) / 2, h + 1.35, -topD / 2 + (i / 3) * topD, ALLOY);
        }
      }
    } else {
      // Brick stock: a stair head and a stack of flues, which is what is on top
      // of a building of this age — and on some, the timber water tank on its
      // steel stand that a city of this age keeps on its roofs.
      sb.box(topW * 0.26, 2.0, topD * 0.3, ox, h + 0.9, oz, RENDER);
      sb.box(topW * 0.26 + 0.3, 0.2, topD * 0.3 + 0.3, ox, h + 2.0, oz, RENDER);
      sb.box(0.9, 1.7, 0.05, ox, h + 0.85, oz + topD * 0.15 + 0.025, IRON);
      lens.box(0.22, 0.1, 0.08, ox, h + 1.85, oz + topD * 0.15 + 0.05, WINDOW_LIGHT);
      sb.box(1.5, 2.6, 1.0, -ox, h + 1.2, -oz, CITY_BRICK);
      sb.box(1.8, 0.24, 1.3, -ox, h + 2.6, -oz, RENDER);
      sb.box(1.62, 0.1, 1.12, -ox, h + 2.0, -oz, RENDER);
      for (let i = 0; i < 3; i++) {
        b.cyl(0.5, 0.36, 0.42, 6, -ox - 0.5 + i * 0.5, h + 2.95, -oz, DARK_CONCRETE);
      }
      if (topW >= 10 && topD >= 10 && roll(36) > 0.35) {
        const tx = -Math.sign(ox || 1) * topW * 0.28;
        const tz = Math.sign(oz || 1) * topD * 0.28;
        const legH = 2.6;
        for (const sx2 of [-1, 1]) {
          for (const sz2 of [-1, 1]) {
            sb.box(0.14, legH, 0.14, tx + sx2 * 1.05, h + legH / 2, tz + sz2 * 1.05, RUST);
          }
          sb.box(2.3, 0.12, 0.12, tx, h + legH * 0.5, tz + sx2 * 1.05, RUST);
          sb.box(0.12, 0.12, 2.3, tx + sx2 * 1.05, h + legH * 0.5, tz, RUST);
        }
        sb.box(2.6, 0.12, 2.6, tx, h + legH + 0.06, tz, TEAK);
        const ty = h + legH + 0.12 + 1.4;
        b.cyl(2.8, 2.6, 2.7, 12, tx, ty, tz, TEAK);
        b.cyl(0.9, 0.14, 2.9, 12, tx, ty + 1.85, tz, DARK_CONCRETE);
        for (const hy of [-1.0, -0.3, 0.4, 1.0]) b.cyl(0.06, 2.72, 2.72, 12, tx, ty + hy, tz, RUST);
        ladder(tx + 1.45, tz, false, h, h + legH + 0.12, RUST);
      }
      b.cyl(0.9, 0.18, 0.18, 6, -ox + 1.4, h + 0.45, -oz, DARK_CONCRETE);
      b.cyl(0.08, 0.3, 0.3, 6, -ox + 1.4, h + 0.94, -oz, DARK_CONCRETE);
    }

    if (!brick) {
      // The window-cleaning machine on a tall roof: a track round the roof
      // inside the parapet, the carriage parked on it, its jib laid along the
      // track and the cradle parked beside it. The thinnest thing on the
      // skyline, and the one a tall roof most obviously has.
      const ti = 1.1;
      if (h > 26 && topW > 12 && topD > 12 && roll(35) > 0.3) {
        const tx = topW / 2 - ti;
        const tz = topD / 2 - ti;
        for (const k of [-1, 1]) {
          sb.box(topW - 2 * ti + 0.25, 0.14, 0.25, 0, h + 0.11, k * tz, DARK_CONCRETE);
          sb.box(topW - 2 * ti + 0.12, 0.04, 0.1, 0, h + 0.2, k * tz, ALLOY);
          sb.box(0.25, 0.14, topD - 2 * ti + 0.25, k * tx, h + 0.11, 0, DARK_CONCRETE);
          sb.box(0.1, 0.04, topD - 2 * ti + 0.12, k * tx, h + 0.2, 0, ALLOY);
        }
        const bx = (roll(37) - 0.5) * (topW - 2 * ti - 9);
        const bz = -tz;
        sb.box(2.4, 1.0, 1.4, bx, h + 0.72, bz, ALLOY);
        sb.box(2.5, 0.08, 1.5, bx, h + 1.26, bz, DARK_CONCRETE);
        b.cyl(1.4, 0.45, 0.5, 8, bx, h + 1.95, bz, ALLOY);
        const jl = Math.min(7, topW * 0.42);
        const up = 0.18;
        const dirX = bx > 0 ? -1 : 1;
        const jx = bx + dirX * (Math.cos(up) * jl) / 2;
        const jy = h + 2.6 + (Math.sin(up) * jl) / 2;
        for (const e of [-1, 1]) {
          sb.box(jl, 0.1, 0.1, jx, jy + e * 0.22, bz, ALLOY, { z: dirX * up });
        }
        for (let i = 1; i < 6; i++) {
          const f = i / 6;
          sb.box(0.05, 0.44, 0.05, bx + dirX * Math.cos(up) * jl * f, h + 2.6 + Math.sin(up) * jl * f, bz, ALLOY);
        }
        const tipX = bx + dirX * Math.cos(up) * jl;
        const tipY = h + 2.6 + Math.sin(up) * jl;
        sb.box(0.5, 0.5, 0.5, tipX, tipY, bz, DARK_CONCRETE);
        sb.box(0.03, tipY - h - 1.6, 0.03, tipX, (tipY + h + 1.6) / 2, bz, DARK_CONCRETE);
        // The cradle, parked behind the carriage between the track and the
        // parapet.
        const cz = bz - 0.6;
        const cx = bx - dirX * 2.8;
        sb.box(2.8, 0.08, 0.7, cx, h + 0.14, cz, DARK_CONCRETE);
        for (const sx2 of [-1, 1]) {
          for (const sz2 of [-1, 1]) sb.box(0.05, 1.0, 0.05, cx + sx2 * 1.37, h + 0.6, cz + sz2 * 0.32, ALLOY);
        }
        for (const sz2 of [-1, 1]) {
          sb.box(2.8, 0.05, 0.05, cx, h + 1.1, cz + sz2 * 0.32, ALLOY);
          sb.box(2.8, 0.18, 0.02, cx, h + 0.27, cz + sz2 * 0.34, ALLOY);
        }
        for (const sx2 of [-1, 1]) sb.box(0.05, 0.05, 0.7, cx + sx2 * 1.37, h + 1.1, cz, ALLOY);
      }

      // The mast, its stays, and a dish on the taller ones. Thin against the
      // sky is the third of the crown's three ideas, and the only one that is
      // the same on all of them.
      const mx = -topW * 0.3;
      const mz = topD * 0.24;
      b.cyl(6, 0.16, 0.3, 5, mx, h + 3.6, mz, ALLOY);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        sb.box(0.05, 3.4, 0.05, mx + Math.cos(a) * 0.55, h + 2.1, mz + Math.sin(a) * 0.55, ALLOY, {
          x: Math.sin(a) * 0.3,
          z: -Math.cos(a) * 0.3,
        });
      }
      if (h > 30) {
        b.cyl(0.24, 1.5, 0.5, 8, mx + 1.6, h + 2.4, mz, ALLOY, { x: Math.PI / 2.6 });
        sb.box(0.12, 1.6, 0.12, mx + 1.6, h + 1.6, mz, ALLOY);
      }
      // An obstruction light. Emissive, so it reads at any hour and at any
      // distance — on a map with no fog the far side of the skyline is a
      // silhouette, and this is the one thing on it that is not.
      lens.box(0.34, 0.34, 0.34, mx, h + 6.7, mz, "#ff5a4a");
    }
  }

  sb.flush(b);
  lens.flushGlow(b);
  lensG.flushGlow(b, OVER_GLASS);
}

/**
 * The brick stock's shaft: an interwar commercial block, drawn over the brick
 * mass from the podium's coping to the parapet — see `drawTower`'s header for
 * what it is and why. Its own function only because it is long; it shares the
 * tower's batches and words.
 */
function drawBrickStock(o: {
  b: Build;
  sb: StoneBatch;
  lens: StoneBatch;
  lensG: StoneBatch;
  rnd: () => number;
  w: number;
  d: number;
  h: number;
  podH: number;
  lit: boolean;
  lay: (s: Side, plane: number, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string, hide?: number) => void;
  paneOn: (s: Side, plane: number, u: number, y: number, along: number, tall: number, thick: number, out: number, backed: string) => void;
  roll: (salt: number) => number;
}): void {
  const { b, sb, lensG, rnd, w, d, h, podH, lit, lay, paneOn, roll } = o;
  const J = 0.025;
  /** Where the brick starts: the podium coping's top. */
  const face0 = podH + 0.35;
  /** The frieze and the cornice, under the roof line. */
  const frieze = h - 1.15;
  /**
   * How many storeys, and how tall: fitted to the building rather than to
   * `STOREY`, so a short block gets two tall loft floors rather than two
   * ordinary ones and a blank band of brick over them.
   */
  const avail = frieze - face0;
  const rows = avail >= 2.4 ? Math.max(1, Math.round(avail / STOREY)) : 0;
  const st = rows > 0 ? avail / rows : 0;
  const cols = Math.max(2, Math.round(w / 3.2));
  const pitch = w / cols;
  const pier = 0.5;
  const corner = 0.8;

  // --- the street and rear elevations: piers, steel windows, spandrels -----
  for (const s of ["+z", "-z"] as const) {
    const plane = d / 2;
    const hb = hideBack(s);
    /** Pier `c`'s span; the corner ones wrap over the flank's pilaster. */
    const pierAt = (c: number): [number, number] => {
      if (c === 0) return [-w / 2 - 0.2, -w / 2 + corner];
      if (c === cols) return [w / 2 - corner, w / 2 + 0.2];
      const x = -w / 2 + c * pitch;
      return [x - pier / 2, x + pier / 2];
    };
    for (let c = 0; c <= cols; c++) {
      const [u0, u1] = pierAt(c);
      const um = (u0 + u1) / 2;
      lay(s, plane, um, (face0 + frieze) / 2, u1 - u0, frieze - face0, 0.2, 0.1, CITY_BRICK, hb | HIDE_TOP | HIDE_UNDER);
      lay(s, plane, um, face0 + 0.15, u1 - u0 + 0.08, 0.3, 0.24, 0.12, RENDER, hb);
      lay(s, plane, um, frieze - 0.15, u1 - u0 + 0.1, 0.3, 0.26, 0.13, RENDER, hb);
    }
    const front = s === "+z";
    // The spandrels: one course of brick across the whole elevation per
    // storey, recessed behind the piers drawn over it, and the brick over the
    // top storey's lintels to the frieze.
    {
      let prev = face0;
      for (let r = 0; r < rows; r++) {
        const sp1 = face0 + r * st + 0.85 - 0.12;
        if (sp1 - prev > 0.1) lay(s, plane, 0, (prev + sp1) / 2, w, sp1 - prev - J, 0.1, 0.05, CITY_BRICK, hb);
        prev = face0 + (r + 1) * st - 0.55 + 0.26 + J;
      }
      if (frieze - prev > 0.1) lay(s, plane, 0, (prev + frieze) / 2, w, frieze - prev, 0.1, 0.05, CITY_BRICK, hb);
    }
    // A member that butts into another at both ends leaves those faces out:
    // a post its top and foot, a rail its two ends.
    const post = hb | HIDE_TOP | HIDE_UNDER;
    const rail = hb | hideEnds(s);
    for (let c = 0; c < cols; c++) {
      const L = pierAt(c)[1];
      const R = pierAt(c + 1)[0];
      const ow = R - L;
      const bu = (L + R) / 2;
      for (let r = 0; r < rows; r++) {
        const fy = face0 + r * st;
        const y0 = fy + 0.85;
        const y1 = fy + st - 0.55;
        const oh = y1 - y0;
        const ym = (y0 + y1) / 2;
        // A stone tablet on the street front's spandrels, where one is deep
        // enough to carry it.
        const spH = r === 0 ? y0 - 0.12 - face0 : st - oh - 0.38;
        if (front && spH > 0.8) lay(s, plane, bu, y0 - 0.12 - spH / 2, Math.min(0.9, ow * 0.3), 0.3, 0.13, 0.065, RENDER, hb);
        // The window, pier to pier: the sheet set back in a steel frame with
        // its grid of glazing bars, a stone sill under it and a stone lintel
        // over it — with a keystone on the street front.
        paneOn(s, plane, bu, ym, ow, oh, 0.04, 0.02, CITY_BRICK);
        lay(s, plane, bu, y0 - 0.06, ow + 0.24, 0.12, 0.16, 0.08, RENDER);
        lay(s, plane, bu, y1 + 0.13, ow, 0.26, 0.12, 0.06, RENDER, rail);
        if (front) lay(s, plane, bu, y1 + 0.15, 0.32, 0.36, 0.16, 0.08, RENDER, hb);
        for (const e of [-1, 1]) lay(s, plane, bu + e * (ow / 2 - 0.03), ym, 0.06, oh, 0.05, 0.045, DARK_CONCRETE, post);
        for (const e of [-1, 1]) lay(s, plane, bu, ym + e * (oh / 2 - 0.03), ow - 0.12, 0.06, 0.05, 0.045, DARK_CONCRETE, rail);
        const vb = Math.max(1, Math.round(ow / 0.8));
        const hbars = Math.max(1, Math.round(oh / 0.75));
        for (let i = 1; i < vb; i++) lay(s, plane, bu - ow / 2 + (i / vb) * ow, ym, 0.035, oh - 0.12, 0.03, 0.055, DARK_CONCRETE, post);
        for (let i = 1; i < hbars; i++) lay(s, plane, bu, y0 + (i / hbars) * oh, ow - 0.12, 0.035, 0.03, 0.055, DARK_CONCRETE, rail);
        // A blind in some windows, behind the bars: down a little, or most of
        // the way where the room is lit, so a lit window is a lit room under a
        // blind rather than a lamp the size of the window.
        const on = lit && towerRoll(bu, ym, c + r * 7, 3) < 0.16;
        const drop = on ? 0.35 : rnd() < 0.3 ? 0.2 + rnd() * 0.4 : 0;
        // 2.5 cm off the glass, which is what survives the sheet's own bias.
        if (drop > 0) lay(s, plane, bu, y1 - (oh * drop) / 2, ow - 0.08, oh * drop, 0.01, 0.065, RENDER);
        if (on) {
          lensG.onFace(s, plane, bu, y0 + (oh * (1 - drop)) / 2, ow - 0.2, oh * (1 - drop) - 0.15, 0.01, 0.045, ROOM_GLOW);
        }
      }
    }
    // The frieze, and the dentils under the cornice: the street elevations'
    // and the rear's, which are the two a block's cornice is built for.
    lay(s, plane, 0, frieze + 0.2, w + 0.48, 0.4, 0.24, 0.12, CITY_BRICK, hb);
    for (let u = -w / 2 - 0.1; u <= w / 2 + 0.1; u += 0.45) {
      lay(s, plane, u, h - 0.67, 0.14, 0.16, 0.34, 0.17, CITY_BRICK, hb | HIDE_TOP);
    }
  }

  // --- the party walls: pilasters, tie plates, a downpipe, old openings ----
  /** Which flank the fire escape is on, if there is one. */
  const escape = rows >= 2 && roll(20) > 0.42;
  const fx: -1 | 1 = roll(21) > 0.5 ? 1 : -1;
  /** The ghost sign goes on the flank the escape is NOT on. */
  const ghost = roll(17) > 0.4;
  const gsx: -1 | 1 = escape ? (-fx as -1 | 1) : roll(18) > 0.5 ? 1 : -1;
  for (const sx of [-1, 1] as const) {
    const s: Side = sx > 0 ? "+x" : "-x";
    const plane = w / 2;
    const hb = hideBack(s);
    for (const e of [-1, 1]) {
      lay(s, plane, e * (d / 2 - corner / 2), (face0 + frieze) / 2, corner, frieze - face0, 0.2, 0.1, CITY_BRICK, hb);
    }
    lay(s, plane, 0, frieze + 0.2, d, 0.4, 0.24, 0.12, CITY_BRICK, hb);
    // Tie plates at every floor line: the ends of the rods that hold the
    // floors to the wall.
    for (let r = 1; r < rows; r++) {
      const y = face0 + r * st;
      const n = Math.max(2, Math.round((d - 2) / 3.2));
      for (let i = 0; i < n; i++) {
        lay(s, plane, -d / 2 + 1 + ((i + 0.5) * (d - 2)) / n, y, 0.3, 0.3, 0.04, 0.02, IRON, hb);
      }
    }
    // What the flank's middle is used for: the escape, or the sign, or the
    // openings a demolished neighbour once had and that were bricked up.
    const busy = (escape && sx === fx) || (ghost && sx === gsx);
    if (!busy) {
      for (let r = 0; r < rows; r++) {
        const fy = face0 + r * st;
        for (const u of [-d * 0.22, d * 0.22]) {
          if (rnd() < 0.4) continue;
          const y0 = fy + 0.9;
          const y1 = fy + st - 0.6;
          lay(s, plane, u, (y0 + y1) / 2, 1.3, y1 - y0, 0.04, 0.02, CITY_BRICK, hb);
          lay(s, plane, u, y0 - 0.05, 1.5, 0.1, 0.12, 0.06, RENDER);
          lay(s, plane, u, y1 + 0.1, 1.5, 0.2, 0.08, 0.04, RENDER, hb);
        }
      }
    }
    // The downpipe, off the gutter behind the parapet to the podium roof, and
    // its hopper and its brackets.
    {
      const u = -sx * (d / 2 - 1.2);
      const top = h - 0.8;
      b.cyl(top - face0, 0.14, 0.14, 6, sx * (plane + 0.12), (top + face0) / 2, u, DARK_CONCRETE);
      lay(s, plane, u, top + 0.15, 0.36, 0.34, 0.3, 0.15, DARK_CONCRETE);
      for (let y = face0 + 1.0; y < top - 0.4; y += 1.8) lay(s, plane, u, y, 0.22, 0.05, 0.12, 0.06, DARK_CONCRETE);
    }
  }

  // --- the cornice and the parapet ------------------------------------------
  //
  // A corona of stone over the dentils, a top course over that, then the
  // parapet in brick with a stone coping overhanging both faces, and over the
  // street front a raised panel carrying the building's name tablet. It is
  // what a brick block has instead of a parapet slab, and at this height it is
  // the whole of the silhouette.
  sb.box(w + 0.92, 0.24, d + 0.92, 0, h - 0.47, 0, RENDER);
  sb.box(w + 0.84, 0.12, d + 0.84, 0, h - 0.29, 0, RENDER);
  {
    const ph = 0.85;
    for (const k of [-1, 1]) {
      sb.box(w + 0.12, ph, 0.35, 0, h + ph / 2, k * (d / 2 + 0.06 - 0.175), CITY_BRICK, undefined, HIDE_UNDER);
      sb.box(0.35, ph, d - 0.58, k * (w / 2 + 0.06 - 0.175), h + ph / 2, 0, CITY_BRICK, undefined, HIDE_UNDER);
      sb.box(w + 0.28, 0.12, 0.51, 0, h + ph + 0.06, k * (d / 2 + 0.14 - 0.255), RENDER);
      sb.box(0.51, 0.12, d - 0.74, k * (w / 2 + 0.14 - 0.255), h + ph + 0.06, 0, RENDER);
    }
    const nw = Math.min(8, w / 3);
    const nz = d / 2 + 0.06 - 0.175;
    sb.box(nw, 0.9, 0.35, 0, h + ph + 0.12 + 0.45, nz, CITY_BRICK);
    sb.box(nw + 0.16, 0.12, 0.51, 0, h + ph + 0.12 + 0.96, d / 2 + 0.14 - 0.255, RENDER);
    sb.box(nw - 1.0, 0.5, 0.06, 0, h + ph + 0.57, nz + 0.2, RENDER);
    sb.box(nw - 1.3, 0.3, 0.03, 0, h + ph + 0.57, nz + 0.245, CITY_BRICK);
  }

  // --- the ghost sign --------------------------------------------------------
  //
  // A painted panel gone flat with age on the blank flank, the brick showing
  // through where the paint has gone — which is what the letters are drawn as,
  // in lines of words.
  if (ghost) {
    const s: Side = gsx > 0 ? "+x" : "-x";
    const gsh = Math.min(4.2, h - podH - 2.4);
    if (gsh > 1.6) {
      const gy = podH + 1.6 + gsh / 2;
      const gw = d * 0.52;
      const hb = hideBack(s);
      lay(s, w / 2, 0, gy, gw, gsh, 0.05, 0.025, RENDER, hb);
      // Its painted border, a hand inside the panel's edge.
      for (const e of [-1, 1]) {
        lay(s, w / 2, 0, gy + e * (gsh / 2 - 0.2), gw - 0.33, 0.07, 0.02, 0.06, CITY_BRICK, hb | hideEnds(s));
        lay(s, w / 2, e * (gw / 2 - 0.2), gy, 0.07, gsh - 0.33, 0.02, 0.06, CITY_BRICK, hb | HIDE_TOP | HIDE_UNDER);
      }
      // Two lines of lettering, a name in tall letters and a line of small
      // ones under it — each letter a stem, a stroke and sometimes a second
      // stem, which is what reads as words at the distance a ghost sign is
      // ever read from. Blocks of brick colour read as a brick pattern.
      const lines: [number, number, number][] = [
        [gy + gsh * 0.13, gsh * 0.34, 0.62],
        [gy - gsh * 0.25, gsh * 0.15, 0.3],
      ];
      // Letters are laid left to right as the face is LOOKED at: a face's u runs
      // from the viewer's right on -X, so there it is turned round.
      const fl = s === "-x" ? -1 : 1;
      for (const [ly, lh, lp] of lines) {
        const stroke = lp * 0.18;
        let u = -gw / 2 + 0.5;
        while (u < gw / 2 - 0.5 - lp) {
          const letters = 3 + Math.floor(rnd() * 5);
          for (let i = 0; i < letters && u < gw / 2 - 0.5 - lp; i++) {
            lay(s, w / 2, fl * (u + stroke / 2), ly, stroke, lh, 0.02, 0.06, CITY_BRICK, hb);
            const k = rnd();
            const by = k < 0.33 ? ly + lh / 2 - stroke / 2 : k < 0.66 ? ly : ly - lh / 2 + stroke / 2;
            lay(s, w / 2, fl * (u + lp * 0.33), by, lp * 0.48, stroke, 0.02, 0.06, CITY_BRICK, hb);
            if (rnd() < 0.5) lay(s, w / 2, fl * (u + lp * 0.6), ly, stroke, lh, 0.02, 0.06, CITY_BRICK, hb);
            u += lp;
          }
          u += lp * 0.8;
        }
      }
    }
  }

  // --- the fire escape ---------------------------------------------------------
  //
  // The character element of this stock. **A zigzag is landings that
  // ALTERNATE**, and the flight between them is the whole of what makes it read
  // as one: drawn first with every landing at the same end, each flight ran off
  // into the air beside the next landing rather than up to it — a stair to
  // nowhere on every storey, invisible in the numbers because each piece is
  // individually right. **And it serves WINDOWS**: one behind every landing,
  // because a fire escape on a blank wall is the same stair to nowhere a storey
  // at a time.
  //
  // It is honest rather than decorative in the one way that matters here: the
  // bottom ladder is DRAWN RETRACTED, which is what a real one does, and that is
  // what puts every member of the assembly over a standing body. So nothing
  // needs a collider to keep anyone out of it, and it takes the header's
  // exemption for what projects above reach.
  if (escape) {
    const s: Side = fx > 0 ? "+x" : "-x";
    const face = (fx * w) / 2;
    /** Half the zigzag's travel along the elevation: a landing sits at each. */
    const half = 1.5;
    const run = half * 2;
    /** The first landing, and what the ladder below it hangs from. */
    const foot = face0 + 0.55;
    const flights = Math.min(3, rows - 1);
    const landZ = (i: number): number => (i % 2 === 0 ? -half : half);
    for (let i = 0; i <= flights; i++) {
      const y = foot + i * st;
      const cz = landZ(i);
      // The window it serves.
      {
        const y0 = y + 0.5;
        const y1 = Math.min(y + st - 0.6, y + 2.4);
        const ym = (y0 + y1) / 2;
        paneOn(s, w / 2, cz, ym, 1.1, y1 - y0, 0.04, 0.02, CITY_BRICK);
        lay(s, w / 2, cz, y0 - 0.06, 1.34, 0.12, 0.16, 0.08, RENDER);
        lay(s, w / 2, cz, y1 + 0.12, 1.4, 0.24, 0.12, 0.06, RENDER, hideBack(s));
        for (const e of [-1, 1]) lay(s, w / 2, cz + e * 0.54, ym, 0.06, y1 - y0, 0.05, 0.045, DARK_CONCRETE, hideBack(s));
        lay(s, w / 2, cz, ym, 1.1, 0.04, 0.03, 0.055, DARK_CONCRETE, hideBack(s));
      }
      // The landing: a grating on a frame, a rail along its outer edge with
      // balusters, and a post and a rail at each end.
      for (const e of [-1, 1]) sb.box(1.5, 0.07, 0.06, face + fx * 0.75, y, cz + e * 0.92, RUST);
      sb.box(0.06, 0.07, 1.9, face + fx * 1.47, y, cz, RUST);
      for (let q = 0; q < 6; q++) sb.box(0.04, 0.05, 1.8, face + fx * (0.15 + q * 0.24), y + 0.01, cz, RUST);
      sb.box(0.06, 0.06, 1.9, face + fx * 1.46, y + 1.0, cz, RUST);
      for (let q = 1; q < 7; q++) sb.box(0.03, 1.0, 0.03, face + fx * 1.46, y + 0.5, cz - 0.92 + (q / 7) * 1.84, RUST);
      for (const e of [-1, 1]) {
        sb.box(0.06, 1.0, 0.06, face + fx * 1.46, y + 0.5, cz + e * 0.92, RUST);
        sb.box(1.5, 0.06, 0.06, face + fx * 0.75, y + 1.0, cz + e * 0.92, RUST);
        sb.box(0.04, 0.16, 0.16, face + fx * 0.02, y - 0.56, cz + e * 0.8, RUST);
        const brace = Math.hypot(1.2, 0.6);
        sb.box(0.04, brace, 0.04, face + fx * 0.6, y - 0.3, cz + e * 0.8, RUST, { z: -fx * Math.atan2(1.2, 0.6) });
      }
      // The flight up to the next landing: two stringers, seven treads and a
      // handrail, raked in the YZ plane so the run is ALONG the elevation
      // rather than out of it. A positive `rotation.x` tips local +Y toward +Z,
      // so the sign IS which way this flight climbs and it comes off the
      // landings.
      if (i < flights) {
        const dirZ = landZ(i + 1) > cz ? 1 : -1;
        const len = Math.hypot(run, st);
        const rake = dirZ * Math.atan2(run, st);
        for (const e of [-1, 1]) {
          sb.box(0.07, len, 0.07, face + fx * (0.75 + e * 0.55), y + st / 2, cz + dirZ * half, RUST, { x: rake });
        }
        sb.box(0.04, len, 0.04, face + fx * 1.3, y + st / 2 + 0.9, cz + dirZ * half, RUST, { x: rake });
        for (let q = 1; q <= 7; q++) {
          const f = q / 8;
          sb.box(1.1, 0.04, 0.22, face + fx * 0.75, y + f * st, cz + dirZ * f * run, RUST);
        }
      }
    }
    // The retracted counterweighted ladder, hung from the first landing so the
    // two cannot drift apart. Its lowest member sits 2 m under that landing,
    // which on the shallowest podium in the kit is over a standing body — the
    // clearance the whole assembly rests on.
    const lz = landZ(0);
    for (const e of [-1, 1]) {
      sb.box(0.06, 2.2, 0.06, face + fx * (0.75 + e * 0.4), foot - 1.0, lz, RUST);
    }
    for (let i = 0; i < 4; i++) {
      sb.box(0.86, 0.05, 0.05, face + fx * 0.75, foot - 1.8 + i * 0.5, lz, RUST);
    }
    sb.box(0.3, 0.3, 0.2, face + fx * 1.3, foot + 0.3, lz + 0.8, DARK_CONCRETE);
  }
}
