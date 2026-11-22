/**
 * kit/desert/fuelStation.ts — buildFuelStation: a state fuel station of the
 * 1980s on the highway at the edge of a desert town — a steel canopy with a
 * panelled soffit and a lettered fascia on four clad columns over two pump
 * islands, a rendered kiosk with a shopfront, a lube bay and the tanks' vent
 * stacks at the back, a water tank on a stand, a tyre fitter's stacks, and a
 * pylon sign with its price board at the road.
 * Part of the desert-town set: follows the contract in kit/core.ts and the
 * set's rules in `./index.ts`. Invariants: the forecourt is open to -Z (the
 * road); the twelve colliders byte for byte and in their order, restated at
 * the top — islands, kiosk, the column struts, the sign's pole, the canopy,
 * the water tank, the tyre stacks; no light (the map's rule); variation is
 * seeded off where it stands (`streetSeed`), never `Math.random()`. Never
 * imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  ALLOY,
  AWNING,
  ASPHALT,
  Build,
  CONCRETE,
  DARK_CONCRETE,
  ENAMEL,
  GLASS,
  IRON,
  RUST,
  carve,
  hideBack,
  runsAlongX,
  streetSeed,
  type BuildCtx,
  type BuildParams,
  type Mesher,
  type Point3,
  type Side,
  type Structure,
  type V3,
} from "../core";
import { PALM_BEAM, SANDBAG, SCORCH, WHITEWASH, WINDOW_VOID } from "./shared";
import {
  HIDE_DOWN,
  Lay,
  NO_ENDS,
  TAU,
  band,
  blob,
  disc,
  eye,
  fdir,
  fp,
  kufic,
  lobe,
  opp,
  pocks,
  poster,
  ragged,
  rod,
  slabOn,
  spall,
  star,
  type Bond,
} from "./lay";

/** How high the canopy's underside stands: a lorry's cab clears it. */
const CLEAR = 4.6;
/** The canopy's fascia: deep enough to carry the band and the lettering. */
const FASCIA = 0.75;
/** Pump-island kerb height, and the island's collider (crouch cover). */
const KERB = 0.2;
const ISLAND_COVER = 1.1;
/** The forecourt's top: poured bays a hand thick over the ground. */
const FT = 0.08;

/** A box's six faces, and what is left out of a thing seen only from the front, or only from below. */
const ALL = 63;
const HIDE_UP = 1 << 2;
const onlyFront = (s: Side): number => ALL & ~hideBack(opp(s));

/** Hollow concrete block, which the kiosk is laid in under its render. */
const BLOCK: Bond = { ground: DARK_CONCRETE, unit: CONCRETE, course: 0.2, len: 0.38, pitch: 0.4 };

/**
 * The fuel station.
 *
 * ## What it is FOR
 *
 * **It is what a highway at the edge of a town in this part of the world
 * has, and nothing else on the map says "road" as plainly.** The old town is
 * mud and the new town is cement, and the asphalt running out past both into
 * the desert needs one thing standing beside it that only a road would put
 * there. A canopy on four columns is also a silhouette no other piece in the
 * kit makes — a flat lid four and a half metres up with daylight under it —
 * so it reads from the next quarter.
 *
 * In play it is a SHELTER rather than a building: the canopy stops rounds
 * from above and hides a body from anybody on a roof, the two islands are
 * waist-high cover with a column on each end, and the kiosk at the back is
 * one solid box to put your back to. Nothing is walked but the forecourt.
 *
 * ## What it is drawn as
 *
 * A station of the state fuel company, built when the highway was, in the
 * steel and render every such station between the Gulf and the Mediterranean
 * was built in, and run down since by a war that came along the road.
 *
 * The FORECOURT is poured in bays with real joints between them, a painted
 * kerb round three sides, a drain grating across the mouth, the underground
 * tanks' fill points under colour-coded lids beside a manway, painted lane
 * arrows worn half away, the oil twenty years of engines dripped, glass in
 * front of the shop and sand blown in against everything standing.
 *
 * The ISLANDS are kerbed in a steel angle and striped, with a bollard at each
 * tip, and carry two dispensers each — the mechanical kind with a door, a
 * louvred foot, a head of rolling-number dials behind a bezel and the
 * company's band on its crown, two nozzles a face in their boots and the hoses
 * looping down to the kerb — a fire point at the road end and a bin and a
 * squeegee bucket at the other. The COLUMNS are steel boxes cased in concrete
 * to the island's head and striped against a bumper, with the downpipe the
 * canopy drains through, the pump numbers, a no-smoking sign facing the road
 * and an extinguisher on its bracket.
 *
 * The CANOPY is a steel deck of standing seams on purlins: under it a grid of
 * soffit panels with the purlins showing in the joints, the flush fittings
 * between them — some lit glass, some smashed to their tubes, some hanging on
 * their cables — and a few panels gone or dropped; round it a fascia of
 * panels between corner trims, under a coping and over a drip, the company's
 * band and pinstripe along it, its name in square kufic front and back, its
 * emblem at the ends; streaks of rust, and pocks where rounds went high.
 *
 * The KIOSK is a concrete frame infilled with block and rendered, on a dark
 * plinth, its corner pilasters and ring beam in the frame's grey, under a
 * slab with the band round its edge. Its front is the shop — a tiled riser,
 * an aluminium shopfront with panes intact, blown in, boarded or papered with
 * the dead, a signboard lettered over it — then the door behind a scissor
 * gate under a cast hood, and the lube bay's roller shutter half up. The
 * tanks' vent stacks climb its -X end beside the meter box and the store
 * door; its +X end is the tyre fitter's, a sign painted on the render and
 * inner tubes hung on nails; the back has the yard door, a barred window and
 * the air-conditioner's drip. On the roof: the air-conditioner, a black water
 * tank, a dish and an aerial, tar patches and sand.
 *
 * The WATER TANK stands on an angle-iron stand braced on every face, banded,
 * with its ladder, its pipes and its bullet holes weeping rust. The TYRES are
 * tyres. The SIGN is a pylon: a cabinet with the emblem and the name on both
 * faces, a price board of three grades in seven-segment numbers under it,
 * bolted to its pole over a plinth, with a ladder up the back.
 *
 * ## `ruined`
 *
 * The -X half of the canopy has come down at the front: its front column
 * gone, its slab pitched from the back columns to the forecourt. Its collider
 * is that pitched slab, and too steep for the nav graph to link. Drawn: the
 * deck and its seams still on top, the soffit half shaken off below, the
 * fascia lying at its foot, the standing half's end torn open with its
 * purlins and cables hanging out of it, the pumps under it burnt and a crater
 * in the forecourt.
 *
 * ## The colours
 *
 * The city kit's — concrete, alloy, enamel, glass and `AWNING` for the
 * company's band, a colour faded to brick by the sun, which is as much chroma
 * as this town allows anything that is not a dome — with the town's
 * whitewash, sand, scorch and void, and palm-board brown for the plywood over
 * a blown pane.
 *
 * ## Colliders
 *
 * Unchanged, and restated below exactly as first emitted: the islands, the
 * kiosk, the column struts, the sign's pole, the canopy (or its standing half
 * and the pitched slab), the water tank and the two tyre stacks. Everything
 * after is DRAWING: on a face (the kiosk's frame stands 0.06 proud, its vent
 * stacks 0.1 and jog out over a head), low enough to step over (the kerbs,
 * the grating, the lids, the drifts, the tyres lying loose), inside a
 * collider (what stands on an island under its head), or overhead (the
 * soffit, its fittings and what hangs from it, which stop over 2.8 m).
 *
 * Seeded off where it stands (`streetSeed`), which is what puts it in
 * `CONFORMS_TO_TERRAIN`: the soffit's missing and hanging panels and its
 * fittings, the fascia's gaps, the panes, the dials, the drifts and stains,
 * the scars and the pocks — and the forecourt's edge, the tank's feet and the
 * sign's plinth are carried down to the ground where it falls away.
 */
export function buildFuelStation(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "fuelStation");
  const w = p.width ?? 18;
  const d = p.depth ?? 14;
  const ruined = p.ruined === true;
  const hw = w / 2;
  const hd = d / 2;

  // The kiosk across the back, and the canopy over the forecourt in front of it.
  const kw = Math.min(9, w * 0.5);
  const kd = Math.min(5.5, d * 0.38);
  const kh = 3.3;
  const kx = hw - kw / 2 - 1.6;
  const kz = hd - kd / 2 - 0.3;
  const cw = Math.min(w - 2, 14);
  const cd = Math.min(d - kd - 2.2, 8);
  const cx = -hw + cw / 2 + 1;
  const cz = -hd + cd / 2 + 1.2;
  const islandX = [cx - cw * 0.22, cx + cw * 0.22];
  const islandL = cd - 2.0;
  const colZ = [cz - islandL / 2 + 0.3, cz + islandL / 2 - 0.3];

  // --- the colliders, in order -----------------------------------------------
  for (const ix of islandX) {
    b.block({ w: 1.1, h: ISLAND_COVER, d: islandL, x: ix, y: ISLAND_COVER / 2, z: cz });
  }
  b.block({ w: kw, h: kh + 0.5, d: kd, x: kx, y: (kh + 0.5) / 2, z: kz });
  const standing = (ix: number, z: number): boolean => !(ruined && ix < cx && z < cz);
  for (const ix of islandX) {
    for (const z of colZ) {
      if (!standing(ix, z)) continue;
      b.strut(0.36, CLEAR - ISLAND_COVER, 0.36, ix, ISLAND_COVER + (CLEAR - ISLAND_COVER) / 2, z, ALLOY);
    }
  }
  // The sign pole, at the road.
  const sx = -hw + 0.9;
  const sz = -hd + 0.5;
  const poleH = 7.2;
  b.strut(0.3, poleH, 0.3, sx, poleH / 2, sz, ALLOY);
  // The canopy: what a round from a roof stops on. Ruined, the -X half is a
  // pitched slab from the back columns down onto the forecourt.
  const pitch = Math.atan2(CLEAR - 0.6, cd);
  if (ruined) {
    b.block({ w: cw / 2, h: FASCIA, d: cd, x: cx + cw / 4, y: CLEAR + FASCIA / 2, z: cz });
    b.block({
      w: cw / 2,
      h: 0.5,
      d: cd / Math.cos(pitch),
      x: cx - cw / 4,
      y: (CLEAR + 0.6) / 2,
      z: cz,
      rotX: -pitch,
    });
  } else {
    b.block({ w: cw, h: FASCIA, d: cd, x: cx, y: CLEAR + FASCIA / 2, z: cz });
  }
  // The water tank on its stand at the kiosk's -X end.
  const tx = kx - kw / 2 - 1.1;
  const tank = tx - 0.9 > -hw;
  if (tank) b.block({ w: 1.3, h: 3.5, d: 1.3, x: tx, y: 1.75, z: kz });
  // The tyre stacks against the kiosk's +X end.
  const tyX = Math.min(hw - 0.7, kx + kw / 2 + 0.75);
  const tyres = tyX + 0.55 <= hw + 0.3;
  const stacks = [
    [tyX, kz - kd * 0.2, 5],
    [tyX, kz + kd * 0.25, 3],
  ] as const;
  if (tyres) {
    for (const [x, z, n] of stacks) b.block({ w: 0.68, h: n * 0.205, d: 0.68, x, y: (n * 0.205) / 2, z });
  }

  // --- the drawing -------------------------------------------------------------
  const rnd = mulberry32(streetSeed(w, d, CLEAR, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const k: Station = {
    w, d, hw, hd, ruined, rnd, ground,
    kw, kd, kh, kx, kz, cw, cd, cx, cz,
    islandX, islandL, colZ, standing,
    sx, sz, poleH, pitch,
    tx, tank, tyX, tyres, stacks,
    top: CLEAR + FASCIA,
  };
  const lay = new Lay();
  forecourt(lay, k);
  for (const ix of islandX) island(lay, k, ix);
  columns(lay, k);
  if (ruined) {
    canopy(lay, k, cw / 2, cx + cw / 4, true);
    fallen(lay, k);
  } else {
    canopy(lay, k, cw, cx, false);
  }
  kiosk(lay, k);
  if (tank) waterTank(lay, k);
  if (tyres) tyreStacks(lay, k);
  sign(lay, k);
  lay.flush(b);

  // The cores, after what is laid on them.
  b.box(kw, kh, kd, kx, kh / 2, kz, WHITEWASH);
  return b;
}

/** What every part of the drawing is measured off. */
interface Station {
  w: number;
  d: number;
  hw: number;
  hd: number;
  ruined: boolean;
  rnd: () => number;
  ground: (lx: number, lz: number) => number;
  kw: number;
  kd: number;
  kh: number;
  kx: number;
  kz: number;
  cw: number;
  cd: number;
  cx: number;
  cz: number;
  islandX: number[];
  islandL: number;
  colZ: number[];
  standing: (ix: number, z: number) => boolean;
  sx: number;
  sz: number;
  poleH: number;
  pitch: number;
  tx: number;
  tank: boolean;
  tyX: number;
  tyres: boolean;
  stacks: readonly (readonly [number, number, number])[];
  /** The canopy's top. */
  top: number;
}

const SIDES: readonly Side[] = ["-z", "+z", "-x", "+x"];

/**
 * The plane `onFace` and `fp` want for a face of something centred at `c`
 * and `h` from it on side `e` — the same arithmetic whichever axis the face
 * runs along, since `u` is then the absolute coordinate along it.
 */
const pl = (e: number, c: number, h: number): number => (e < 0 ? h - c : c + h);

/** The side facing `e` along X or along Z. */
const xSide = (e: number): Side => (e < 0 ? "-x" : "+x");
const zSide = (e: number): Side => (e < 0 ? "-z" : "+z");

/** A flat convex outline `[x, z][]` laid face up at `y`, its edges a centimetre deep. */
function flat(m: Mesher, pts: readonly (readonly [number, number])[], y: number): void {
  const up: V3 = [0, 1, 0];
  const n = pts.length;
  for (let i = 1; i + 1 < n; i++) m.tri([pts[0][0], y, pts[0][1]], [pts[i][0], y, pts[i][1]], [pts[i + 1][0], y, pts[i + 1][1]], up);
  let cxs = 0;
  let czs = 0;
  for (const [x, z] of pts) {
    cxs += x / n;
    czs += z / n;
  }
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % n];
    m.quad([ax, y - 0.01, az], [bx, y - 0.01, bz], [bx, y, bz], [ax, y, az], [(ax + bx) / 2 - cxs, 0, (az + bz) / 2 - czs]);
  }
}

/** A hose or a cable through `pts`, a straight frustum of `n` sides a span. */
function hose(m: Mesher, pts: readonly Point3[], r: number, n = 5): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    const dir: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    eye(m, [a[0], a[1], a[2]], dir, r, r, Math.hypot(dir[0], dir[1], dir[2]) + r * 0.6, n, false, false);
  }
}

/** `count + 1` points on a cubic from `a` to `c` pulled toward `p1` and `p2`. */
function cubic(a: Point3, p1: Point3, p2: Point3, c: Point3, count: number): Point3[] {
  const out: Point3[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = 1 - t;
    const f = (j: number): number => u * u * u * a[j] + 3 * u * u * t * p1[j] + 3 * u * t * t * p2[j] + t * t * t * c[j];
    out.push([f(0), f(1), f(2)]);
  }
  return out;
}

/**
 * A seven-segment numeral `digit` centred at `(u, y)` on side `s`, `H` tall,
 * its strokes standing `out` past the plane — a price board's, a dial's.
 */
function numeral(lay: Lay, s: Side, plane: number, u: number, y: number, H: number, digit: number, out: number, color: string): void {
  const SEG = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"][digit];
  const wd = H * 0.55;
  const t = H * 0.13;
  const f = onlyFront(s);
  const put = (uu: number, yy: number, along: number, tall: number): void =>
    lay.sb.onFace(s, plane, uu, yy, along, tall, 0.008, out, color, 0, 0, f);
  for (const c of SEG) {
    if (c === "a") put(u, y + H / 2 - t / 2, wd, t);
    else if (c === "d") put(u, y - H / 2 + t / 2, wd, t);
    else if (c === "g") put(u, y, wd, t);
    else {
      const sideU = c === "b" || c === "c" ? 1 : -1;
      const hi = c === "b" || c === "f";
      // A face's `u` runs the other way on the far side, so a numeral is
      // mirrored there unless its right is taken along the face's own right.
      const right = s === "-z" || s === "+x" ? 1 : -1;
      put(u + right * sideU * (wd / 2 - t / 2), y + (hi ? H / 4 : -H / 4), t, H / 2);
    }
  }
}

/**
 * A tyre lying flat at `(x, z)` on `y`: its tread in three bands — the
 * shoulders tucked in, which is the bend the ink finds — and its sidewall.
 */
function tyre(lay: Lay, x: number, y: number, z: number, phase: number): void {
  const m = lay.m(IRON);
  const R = 0.34;
  band(m, 12, phase, R - 0.03, y, R, y + 0.045, x, z);
  band(m, 12, phase, R, y + 0.045, R, y + 0.155, x, z);
  band(m, 12, phase, R, y + 0.155, R - 0.03, y + 0.2, x, z);
  disc(m, 12, phase, R - 0.03, 0.19, y + 0.2, true, x, z);
}

// --- the forecourt ---------------------------------------------------------------

/**
 * Poured bays over a dark bed, so every joint is a real groove; a painted
 * kerb round three sides; the drain across the mouth; the tanks' fill points
 * and manway; the lane arrows; oil, sand and glass — and the edge carried
 * down to the ground where it falls away.
 */
function forecourt(lay: Lay, k: Station): void {
  const { w, d, hw, hd, rnd, ground } = k;
  const sb = lay.sb;
  // The bed, a centimetre under the bays' top, which the joints show.
  sb.box(w - 0.06, FT - 0.01, d - 0.06, 0, (FT - 0.01) / 2, 0, DARK_CONCRETE, undefined, HIDE_DOWN);
  const nx = Math.max(2, Math.round(w / 4.5));
  const nz = Math.max(2, Math.round(d / 4.6));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x0 = -hw + (i * w) / nx + (i ? 0.015 : 0);
      const x1 = -hw + ((i + 1) * w) / nx - (i + 1 < nx ? 0.015 : 0);
      const z0 = -hd + (j * d) / nz + (j ? 0.015 : 0);
      const z1 = -hd + ((j + 1) * d) / nz - (j + 1 < nz ? 0.015 : 0);
      sb.box(x1 - x0, FT, z1 - z0, (x0 + x1) / 2, FT / 2, (z0 + z1) / 2, CONCRETE, undefined, HIDE_DOWN);
    }
  }

  // The edge's face, down to the ground where it falls away.
  for (const s of SIDES) {
    const along = runsAlongX(s) ? w : d;
    const o = (runsAlongX(s) ? hd : hw) + 0.05;
    let low = 0;
    for (let i = 0; i <= 8; i++) {
      const u = -along / 2 + (i / 8) * along;
      const e = s === "+z" || s === "+x" ? 1 : -1;
      low = Math.min(low, runsAlongX(s) ? ground(u, e * o) : ground(e * o, u));
    }
    if (low < -0.03) sb.onFace(s, runsAlongX(s) ? hd : hw, 0, low / 2, along + 0.02, -low, 0.08, -0.03, CONCRETE, 0, 0, hideBack(s));
  }

  // The kerb on three sides, painted in stones of black and white; the road
  // side is open.
  const kerb = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 0.9));
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const sl = len / n - 0.02;
      sb.box(alongX ? sl : 0.18, 0.13, alongX ? 0.18 : sl, x, FT + 0.065, z, i % 2 ? IRON : WHITEWASH, undefined, HIDE_DOWN);
    }
  };
  kerb(-hw + 0.09, -hd + 1.2, -hw + 0.09, hd - 0.09);
  kerb(-hw + 0.18, hd - 0.09, hw - 0.18, hd - 0.09);
  kerb(hw - 0.09, hd - 0.09, hw - 0.09, -hd + 1.2);

  // The drain across the mouth: a channel, its two angles and its grating.
  const dz = -hd + 0.45;
  const d0 = -hw + 1.6;
  const d1 = hw - 1.2;
  sb.box(d1 - d0, 0.004, 0.24, (d0 + d1) / 2, FT + 0.002, dz, WINDOW_VOID, undefined, HIDE_DOWN);
  for (const e of [-1, 1]) sb.box(d1 - d0 + 0.06, 0.014, 0.04, (d0 + d1) / 2, FT + 0.007, dz + e * 0.14, IRON, undefined, HIDE_DOWN);
  for (let x = d0 + 0.08; x < d1 - 0.04; x += 0.16) sb.box(0.03, 0.012, 0.24, x, FT + 0.01, dz, IRON, undefined, HIDE_DOWN | NO_ENDS);

  // The underground tanks' fill points behind the canopy at -X: a raised
  // spill pad, four lids colour-coded by grade, and the manway beside them.
  const fz = Math.min(k.cz + k.cd / 2 + 1.5, hd - 1.2);
  const f0 = -hw + 1.4;
  if (k.kx - k.kw / 2 - f0 > 3.4) {
    sb.box(3.5, 0.03, 1.1, f0 + 1.6, FT + 0.015, fz, CONCRETE, undefined, HIDE_DOWN);
    const codes = [AWNING, ENAMEL, WHITEWASH, IRON];
    for (let i = 0; i < 4; i++) {
      const x = f0 + 0.4 + i * 0.8;
      const y = FT + 0.03;
      band(lay.m(codes[i]), 12, 0, 0.3, y, 0.3, y + 0.025, x, fz);
      disc(lay.m(codes[i]), 12, 0, 0.3, 0.24, y + 0.025, true, x, fz);
      disc(lay.m(IRON), 12, 0, 0.24, 0, y + 0.018, true, x, fz);
      sb.box(0.4, 0.012, 0.05, x, y + 0.024, fz, IRON, undefined, HIDE_DOWN);
      sb.box(0.05, 0.012, 0.4, x, y + 0.024, fz, IRON, undefined, HIDE_DOWN);
    }
    const mz = Math.min(fz + 1.3, hd - 0.7);
    sb.box(1.0, 0.016, 1.0, f0 + 1.0, FT + 0.008, mz, IRON, undefined, HIDE_DOWN);
    for (let i = -2; i <= 2; i++) sb.box(0.9, 0.01, 0.025, f0 + 1.0, FT + 0.021, mz + i * 0.18, IRON, undefined, HIDE_DOWN);
  }

  // The lane arrows, worn: three lanes, each a shaft and a head, a stretch
  // of each gone under the tyres.
  const lanes = [k.islandX[0] - 1.7, (k.islandX[0] + k.islandX[1]) / 2, k.islandX[1] + 1.7];
  const az = -hd + 0.9;
  const paint = lay.m(WHITEWASH);
  for (const ax of lanes) {
    if (ax < -hw + 0.6 || ax > hw - 0.6) continue;
    const gap = 0.2 + rnd() * 0.4;
    flat(paint, [[ax - 0.12, az], [ax + 0.12, az], [ax + 0.12, az + gap], [ax - 0.12, az + gap]], FT + 0.008);
    flat(paint, [[ax - 0.12, az + gap + 0.18], [ax + 0.12, az + gap + 0.18], [ax + 0.12, az + 1.1], [ax - 0.12, az + 1.1]], FT + 0.008);
    flat(paint, [[ax - 0.36, az + 1.1], [ax + 0.36, az + 1.1], [ax, az + 1.75]], FT + 0.008);
  }

  // Oil where engines stood at the pumps, darker under the long stays.
  for (const ix of k.islandX) {
    for (const e of [-1, 1]) {
      for (const pz of [k.cz - k.islandL * 0.18, k.cz + k.islandL * 0.18]) {
        if (rnd() < 0.25) continue;
        lobe(lay.m(ASPHALT), ix + e * (1.4 + rnd() * 0.5), FT + 0.008, pz + (rnd() - 0.5) * 0.8, 0.35 + rnd() * 0.35, 0.22 + rnd() * 0.2, rnd() * TAU, rnd);
      }
    }
  }

  // Glass blown out of the shopfront, lying where it fell.
  const front = k.kz - k.kd / 2;
  for (let i = 0; i < 14; i++) {
    const x = k.kx - k.kw / 2 + 0.6 + rnd() * k.kw * 0.55;
    const z = front - 0.15 - rnd() * 1.1;
    sb.box(0.05 + rnd() * 0.1, 0.006, 0.04 + rnd() * 0.07, x, FT + 0.004, z, GLASS, { y: rnd() * TAU }, HIDE_DOWN);
  }

  // Sand blown in: drifts against the kiosk's front, round the islands' far
  // ends and into the corners, each a broad layer and a smaller one on it.
  const sand = lay.m(SANDBAG);
  const drift = (x: number, z: number, a: number, bb: number, yaw: number): void => {
    lobe(sand, x, FT + 0.015, z, a, bb, yaw, rnd);
    if (a > 0.4) lobe(sand, x + (rnd() - 0.5) * a * 0.4, FT + 0.035, z + (rnd() - 0.5) * bb * 0.4, a * 0.55, bb * 0.5, yaw, rnd);
  };
  for (let i = 0; i < 3; i++) drift(k.kx - k.kw / 2 + 0.8 + i * (k.kw / 3) + rnd() * 0.8, front - 0.35, 0.9 + rnd() * 0.6, 0.3 + rnd() * 0.12, 0);
  for (const ix of k.islandX) drift(ix + 0.3, k.cz + k.islandL / 2 + 0.55, 0.6, 0.28, 0.4);
  drift(hw - 0.8, hd - 0.7, 1.2, 0.5, 0.6);
  drift(-hw + 0.8, hd - 0.8, 1.0, 0.45, -0.5);
  drift(k.sx + 0.5, k.sz + 0.5, 0.7, 0.35, 0.3);

  if (!k.ruined) return;
  // A shell's crater in the +X lane, its slab broken up round it, and the
  // black the pumps left burning.
  const crx = hw - 2.2;
  const crz = -hd + 2.6;
  lobe(lay.m(SCORCH), crx, FT + 0.008, crz, 1.5, 1.2, 0.3, rnd);
  lobe(lay.m(WINDOW_VOID), crx, FT + 0.016, crz, 0.55, 0.45, 0.3, rnd);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + rnd() * 0.4;
    const r = 0.7 + rnd() * 0.4;
    const sz = 0.3 + rnd() * 0.35;
    sb.box(sz, 0.08, sz * (0.6 + rnd() * 0.5), crx + Math.cos(a) * r, FT + 0.06, crz + Math.sin(a) * r, CONCRETE, {
      y: a + (rnd() - 0.5) * 0.6,
      z: -0.3 - rnd() * 0.3,
    }, HIDE_DOWN);
  }
  lobe(lay.m(SCORCH), k.islandX[0], FT + 0.012, k.cz - k.islandL * 0.18, 1.6, 1.1, 0.2, rnd);
}

// --- the islands ----------------------------------------------------------------------

/**
 * One pump island: the kerbed plinth and its rounded ends, the steel angle
 * and the stripes on it, a bollard at each tip, two dispensers, and what an
 * attendant keeps at the ends.
 */
function island(lay: Lay, k: Station, ix: number): void {
  const { cz, islandL, rnd } = k;
  const sb = lay.sb;
  const run = islandL - 0.6;
  sb.box(1.1, KERB, run, ix, KERB / 2, cz, CONCRETE, undefined, HIDE_DOWN);
  for (const e of [-1, 1]) {
    const ez = cz + e * (islandL / 2 - 0.3);
    band(lay.m(CONCRETE), 10, 0, 0.55, 0, 0.55, KERB, ix, ez);
    disc(lay.m(CONCRETE), 10, 0, 0.55, 0, KERB, true, ix, ez);
    // The steel angle along each long edge, and the stripes on the kerb's face.
    sb.box(0.04, 0.04, run, ix + e * 0.535, KERB - 0.015, cz, IRON, undefined, HIDE_DOWN);
    const n = Math.floor(run / 0.45);
    for (let i = 0; i < n; i += 2) {
      sb.box(0.008, 0.15, run / n - 0.02, ix + e * 0.554, 0.1, cz - run / 2 + ((i + 0.5) * run) / n, WHITEWASH, undefined, hideBack(xSide(e)) | HIDE_DOWN);
    }
    // The bollard on the tip: a pipe filled with concrete, banded, its head domed.
    const bz = cz + e * (islandL / 2 + 0.1);
    const bm = lay.m(WHITEWASH);
    band(bm, 8, 0, 0.1, KERB, 0.1, KERB + 0.85, ix, bz);
    band(bm, 8, 0, 0.1, KERB + 0.85, 0.05, KERB + 0.93, ix, bz);
    disc(bm, 8, 0, 0.05, 0, KERB + 0.93, true, ix, bz);
    for (const y of [KERB + 0.55, KERB + 0.75]) band(lay.m(AWNING), 8, 0, 0.104, y, 0.104, y + 0.1, ix, bz);
  }

  for (const pz of [cz - islandL * 0.18, cz + islandL * 0.18]) {
    pump(lay, k, ix, pz, k.ruined && ix < k.cx && pz < cz);
  }

  // The road end: a fire point — a sand bucket and an extinguisher.
  const fz = cz - islandL / 2 + 0.72;
  const sm = lay.m(AWNING);
  band(sm, 10, 0, 0.12, KERB, 0.14, KERB + 0.28, ix - 0.27, fz);
  disc(lay.m(SANDBAG), 10, 0, 0.13, 0, KERB + 0.24, true, ix - 0.27, fz);
  rod(lay, [ix - 0.39, KERB + 0.28, fz], [ix - 0.27, KERB + 0.42, fz], 0.015, IRON);
  rod(lay, [ix - 0.27, KERB + 0.42, fz], [ix - 0.15, KERB + 0.28, fz], 0.015, IRON);
  band(sm, 8, 0, 0.085, KERB, 0.085, KERB + 0.5, ix + 0.27, fz);
  band(sm, 8, 0, 0.085, KERB + 0.5, 0.04, KERB + 0.56, ix + 0.27, fz);
  band(lay.m(IRON), 6, 0, 0.03, KERB + 0.56, 0.03, KERB + 0.64, ix + 0.27, fz);
  hose(lay.m(IRON), [[ix + 0.27, KERB + 0.6, fz - 0.03], [ix + 0.2, KERB + 0.5, fz - 0.1], [ix + 0.18, KERB + 0.3, fz - 0.09]], 0.012);

  // The far end: a bin and the squeegee's bucket, its handle up out of it.
  const bz = cz + islandL / 2 - 0.72;
  const em = lay.m(ENAMEL);
  band(em, 10, 0, 0.14, KERB, 0.15, KERB + 0.6, ix - 0.25, bz);
  disc(lay.m(WINDOW_VOID), 10, 0, 0.13, 0, KERB + 0.56, true, ix - 0.25, bz);
  band(lay.m(IRON), 10, 0, 0.152, KERB + 0.57, 0.152, KERB + 0.61, ix - 0.25, bz);
  disc(em, 10, 0, 0.16, 0.13, KERB + 0.61, true, ix - 0.25, bz);
  band(lay.m(ALLOY), 8, 0, 0.11, KERB, 0.13, KERB + 0.26, ix + 0.27, bz);
  disc(lay.m(WINDOW_VOID), 8, 0, 0.12, 0, KERB + 0.22, true, ix + 0.27, bz);
  const lean = (rnd() - 0.5) * 0.3;
  rod(lay, [ix + 0.27, KERB + 0.1, bz], [ix + 0.27 + lean, KERB + 1.0, bz + 0.12], 0.025, PALM_BEAM);
  sb.box(0.3, 0.06, 0.05, ix + 0.27 + lean * 1.03, KERB + 1.03, bz + 0.125, IRON, { y: 0.2 });
}

/**
 * A dispenser of the 1980s, back to back across the island: a plinth; a
 * cabinet with a door, a louvred foot and a lock; two nozzles a face in their
 * boots, their hoses looping down off the head to the kerb; the head, its
 * dials behind a bezel — three rows of rolling numbers, or smashed — and the
 * crown in the company's band. Burnt, it is all one black, its dials gone and
 * a hose melted across the island.
 */
function pump(lay: Lay, k: Station, ix: number, pz: number, burnt: boolean): void {
  const { rnd } = k;
  const sb = lay.sb;
  const body = burnt ? SCORCH : ENAMEL;
  const head = burnt ? SCORCH : WHITEWASH;
  const y0 = KERB + 0.18;
  const y1 = y0 + 1.0;
  const h0 = y1 + 0.03;
  const h1 = h0 + 0.42;
  sb.box(0.62, 0.18, 0.98, ix, KERB + 0.09, pz, DARK_CONCRETE, undefined, HIDE_DOWN);
  sb.box(0.5, y1 - y0, 0.86, ix, (y0 + y1) / 2, pz, body, undefined, HIDE_DOWN);
  sb.box(0.46, 0.03, 0.82, ix, y1 + 0.015, pz, IRON, undefined, HIDE_DOWN);
  sb.box(0.56, h1 - h0, 0.92, ix, (h0 + h1) / 2, pz, head, undefined, HIDE_DOWN);
  sb.box(0.6, 0.2, 0.98, ix, h1 + 0.1, pz, burnt ? SCORCH : AWNING, undefined, HIDE_DOWN);
  sb.box(0.64, 0.04, 1.02, ix, h1 + 0.22, pz, burnt ? SCORCH : ALLOY);
  const smashed = burnt || rnd() < 0.22;
  for (const e of [-1, 1]) {
    const s = xSide(e);
    const back = hideBack(s);
    const cab = pl(e, ix, 0.25);
    const hp = pl(e, ix, 0.28);
    // The door: rails round a panel, the louvres at its foot, the lock.
    for (const y of [y0 + 0.08, y1 - 0.08]) sb.onFace(s, cab, pz, y, 0.74, 0.04, 0.02, 0.01, body, 0, 0, back);
    for (const u of [pz - 0.35, pz + 0.35]) sb.onFace(s, cab, u, (y0 + y1) / 2, 0.04, y1 - y0 - 0.12, 0.02, 0.01, body, 0, 0, back);
    for (let i = 0; i < 5; i++) sb.onFace(s, cab, pz, y0 + 0.16 + i * 0.05, 0.5, 0.018, 0.012, 0.006, IRON, 0, 0, back);
    sb.onFace(s, cab, pz + 0.28, y1 - 0.3, 0.03, 0.05, 0.02, 0.02, ALLOY, 0, 0, back);
    // The dials.
    const dy = (h0 + h1) / 2 + 0.02;
    sb.onFace(s, hp, pz, dy, 0.72, 0.28, 0.012, 0.006, WINDOW_VOID, 0, 0, back);
    for (const y of [dy - 0.155, dy + 0.155]) sb.onFace(s, hp, pz, y, 0.78, 0.03, 0.024, 0.012, burnt ? SCORCH : ALLOY, 0, 0, back);
    for (const u of [pz - 0.375, pz + 0.375]) sb.onFace(s, hp, u, dy, 0.03, 0.28, 0.024, 0.012, burnt ? SCORCH : ALLOY, 0, 0, back);
    if (smashed) {
      if (!burnt) {
        slabOn(lay, s, hp, [[pz - 0.36, dy + 0.14], [pz - 0.18, dy + 0.14], [pz - 0.36, dy - 0.02]], 0.01, 0.016, GLASS);
        slabOn(lay, s, hp, [[pz + 0.36, dy - 0.14], [pz + 0.36, dy + 0.04], [pz + 0.22, dy - 0.14]], 0.01, 0.016, GLASS);
      }
    } else {
      const f = onlyFront(s);
      const right = e < 0 ? -1 : 1;
      for (let r = -1; r <= 1; r++) {
        sb.onFace(s, hp, pz - right * 0.27, dy + r * 0.085, 0.12, 0.03, 0.008, 0.014, AWNING, 0, 0, f);
        for (let i = 0; i < 5; i++) sb.onFace(s, hp, pz + right * (0.3 - i * 0.05), dy + r * 0.085, 0.034, 0.05, 0.008, 0.014, WHITEWASH, 0, 0, f);
      }
    }
    if (!burnt) sb.onFace(s, pl(e, ix, 0.3), pz, h1 + 0.1, 0.9, 0.05, 0.01, 0.005, WHITEWASH, 0, 0, back);

    // The nozzles in their boots, and the hoses off the head down to the kerb.
    for (const g of [-1, 1]) {
      const u = pz + g * 0.2;
      const yb = y1 - 0.34;
      sb.onFace(s, cab, u, yb, 0.12, 0.2, 0.1, 0.05, ALLOY, 0, 0, back);
      if (burnt && g > 0) continue;
      const grip = g < 0 ? AWNING : IRON;
      sb.onFace(s, cab, u, yb + 0.15, 0.06, 0.22, 0.06, 0.13, burnt ? SCORCH : grip, 0.25 * g, 0, back);
      rod(lay, fp(s, cab, u, yb + 0.06, 0.13), fp(s, cab, u, yb - 0.08, 0.05), 0.028, burnt ? SCORCH : ALLOY);
      const port = fp(s, hp, pz + g * 0.4, h0 + 0.06, 0.02);
      const end = fp(s, cab, u, yb + 0.27, 0.14);
      const sag = 0.42 + rnd() * 0.12;
      hose(lay.m(IRON), cubic(port, fp(s, hp, pz + g * 0.48, 0.4, 0.2), fp(s, cab, u + g * 0.06, sag - 0.2, 0.34), end, 6), 0.022);
    }
    // The grade's price on each end.
    const zs = zSide(e);
    const zp = pl(e, pz, 0.43);
    sb.onFace(zs, zp, ix, y1 - 0.3, 0.34, 0.22, 0.01, 0.005, burnt ? SCORCH : WHITEWASH, 0, 0, hideBack(zs));
    if (!burnt) for (let i = 0; i < 3; i++) numeral(lay, zs, zp, ix + (i - 1) * 0.08 * (e < 0 ? 1 : -1), y1 - 0.3, 0.12, Math.floor(rnd() * 10), 0.012, IRON);
  }
  if (burnt) {
    // A hose melted off its port and lying across the island.
    const z0 = pz + (rnd() - 0.5) * 0.4;
    hose(lay.m(SCORCH), [[ix - 0.6, KERB + 0.01, z0 - 0.3], [ix - 0.3, KERB + 0.02, z0 + 0.1], [ix + 0.1, KERB + 0.02, z0 - 0.1], [ix + 0.55, KERB + 0.01, z0 + 0.35], [ix + 0.9, 0.02 + FT, z0 + 0.2]], 0.022);
  }
}

// --- the columns -------------------------------------------------------------------

/**
 * Steel boxes cased in concrete to the island's head with a weathered cap,
 * striped against a bumper; the downpipe the canopy drains through; the
 * pump number; the no-smoking sign facing the road; an extinguisher on the
 * back column; the capital plate under the soffit. The ruined half's front
 * column lies across the forecourt, its casing broken off on the island.
 */
function columns(lay: Lay, k: Station): void {
  const sb = lay.sb;
  const { rnd } = k;
  let number = 1;
  for (const ix of k.islandX) {
    for (const z of k.colZ) {
      const road = z < k.cz;
      if (!k.standing(ix, z)) {
        // The casing, broken off in two lumps, the bolts bent out of it.
        sb.box(0.56, 0.42, 0.56, ix, KERB + 0.21, z, CONCRETE, undefined, HIDE_DOWN);
        sb.box(0.36, 0.22, 0.4, ix + 0.08, KERB + 0.5, z - 0.05, CONCRETE, { y: 0.3, z: 0.25 }, HIDE_DOWN);
        for (const e of [-1, 1]) rod(lay, [ix + e * 0.12, KERB + 0.4, z + 0.12], [ix + e * 0.16, KERB + 0.62, z + 0.25], 0.025, RUST);
        continue;
      }
      const top = ISLAND_COVER - 0.06;
      sb.box(0.56, top - KERB, 0.56, ix, (KERB + top) / 2, z, CONCRETE, undefined, HIDE_DOWN);
      band(lay.m(CONCRETE), 4, 0, 0.28, top, 0.19, top + 0.08, ix, z);
      for (const [y, c] of [[0.42, WHITEWASH], [0.62, IRON], [0.82, WHITEWASH]] as const) {
        sb.box(0.572, 0.12, 0.572, ix, y, z, c, undefined, HIDE_DOWN | HIDE_UP);
      }
      // Rust bleeding out of the joint onto the cap.
      sb.box(0.37, 0.03, 0.37, ix, top + 0.085, z, RUST, undefined, HIDE_DOWN);
      // The capital plate under the soffit.
      sb.box(0.5, 0.03, 0.5, ix, CLEAR - 0.04, z, ALLOY, undefined, HIDE_UP);
      // The downpipe down the +X face, its clips and its shoe into the cap.
      const px = ix + 0.18 + 0.05;
      sb.box(0.08, CLEAR - 0.05 - (top + 0.03), 0.08, px, (CLEAR - 0.05 + top + 0.03) / 2, z, IRON, undefined, HIDE_DOWN | HIDE_UP);
      for (const y of [1.6, 2.6, 3.6]) sb.box(0.12, 0.03, 0.12, px - 0.01, y, z, ALLOY);
      // The pump number, stencilled on the road face of the road columns
      // and the back face of the back ones.
      const s: Side = road ? "-z" : "+z";
      const plane = pl(road ? -1 : 1, z, 0.18);
      sb.onFace(s, plane, ix, 2.3, 0.24, 0.32, 0.01, 0.005, WHITEWASH, 0, 0, hideBack(s));
      numeral(lay, s, plane, ix, 2.3, 0.22, number++ % 10, 0.012, IRON);
      if (road) {
        // No smoking: a white disc in a red ring, the bar across it.
        const at = fp("-z", plane, ix, 1.75, 0);
        eye(lay.m(AWNING), at, fdir("-z", 0, 0, 1), 0.17, 0.17, 0.012, 12, true, false);
        eye(lay.m(WHITEWASH), at, fdir("-z", 0, 0, 1), 0.13, 0.13, 0.02, 12, true, false);
        sb.onFace("-z", plane, ix + 0.02, 1.75, 0.16, 0.04, 0.008, 0.024, IRON, 0, 0, onlyFront("-z"));
        sb.onFace("-z", plane, ix, 1.75, 0.3, 0.04, 0.008, 0.028, AWNING, Math.PI / 4, 0, onlyFront("-z"));
      } else {
        // An extinguisher on its bracket.
        const ez = z + 0.18 + 0.1;
        sb.box(0.12, 0.04, 0.14, ix, 1.85, z + 0.25, ALLOY);
        const em = lay.m(AWNING);
        band(em, 8, 0, 0.085, 1.3, 0.085, 1.78, ix, ez);
        band(em, 8, 0, 0.085, 1.78, 0.035, 1.84, ix, ez);
        disc(em, 8, 0, 0.085, 0, 1.3, false, ix, ez);
        sb.box(0.05, 0.08, 0.04, ix, 1.88, ez, IRON);
        hose(lay.m(IRON), [[ix + 0.03, 1.86, ez + 0.02], [ix + 0.1, 1.75, ez + 0.07], [ix + 0.1, 1.45, ez + 0.08]], 0.012);
      }
    }
  }
  if (!k.ruined) return;
  // The front column the ruined half lost, lying across the forecourt with
  // its foot torn off the plate.
  const fx = k.islandX[0] - 1.1;
  const fz = k.cz - 0.6;
  sb.box(0.34, 0.34, CLEAR - 0.6, fx, 0.25, fz, ALLOY, { y: 0.35 });
  sb.box(0.42, 0.02, 0.42, fx - Math.sin(0.35) * (CLEAR - 0.6) / 2, 0.25, fz - Math.cos(0.35) * (CLEAR - 0.6) / 2, RUST, { y: 0.35, x: Math.PI / 2 });
  for (let i = 0; i < 4; i++) {
    const a = rnd() * TAU;
    const r = 0.3 + rnd() * 1.4;
    sb.box(0.14 + rnd() * 0.18, 0.08, 0.12 + rnd() * 0.12, fx + Math.cos(a) * r, FT + 0.04, fz + Math.sin(a) * r, CONCRETE, { y: a }, HIDE_DOWN);
  }
}

// --- the canopy -----------------------------------------------------------------------

/**
 * The canopy over `x0 ± w0/2`: a dark core; on top, a deck of standing seams;
 * under it purlins and beams, the soffit's grid of panels — a few gone and a
 * few dropped on one edge — and the flush fittings between them; round it
 * the fascia of panels, corner trims, coping, drip, band, pinstripe, the
 * name and the emblems. `torn` is the ruined half's: its -X end has no
 * fascia, and the purlins, deck and cables come out of it.
 */
function canopy(lay: Lay, k: Station, w0: number, x0: number, torn: boolean): void {
  const sb = lay.sb;
  const { cd, cz, rnd, top } = k;
  const xa = x0 - w0 / 2;
  const xb = x0 + w0 / 2;
  const za = cz - cd / 2;
  const zb = cz + cd / 2;
  sb.box(w0 - 0.1, top - 0.02 - (CLEAR + 0.12), cd - 0.1, x0, (top - 0.02 + CLEAR + 0.12) / 2, cz, DARK_CONCRETE);

  // The deck and its seams.
  sb.box(w0 - 0.24, 0.02, cd - 0.24, x0, top - 0.01, cz, ALLOY, undefined, HIDE_DOWN);
  for (let x = xa + 0.42; x < xb - 0.3; x += 0.6) sb.box(0.035, 0.04, cd - 0.3, x, top + 0.02, cz, ALLOY, undefined, HIDE_DOWN | NO_ENDS);
  // Sand on the deck, drifted against the coping on the lee side.
  const sand = lay.m(SANDBAG);
  for (let i = 0; i < 4; i++) {
    lobe(sand, xa + 0.8 + rnd() * (w0 - 1.6), top + 0.05, zb - 0.5 - rnd() * 0.4, 0.8 + rnd() * 0.8, 0.3 + rnd() * 0.15, (rnd() - 0.5) * 0.3, rnd);
  }
  if (!torn && rnd() < 0.7) tyre(lay, xa + 1.5 + rnd() * (w0 - 3), top + 0.04, za + 1.2 + rnd() * (cd - 2.4), rnd());

  // The steel under the soffit: purlins across, a beam over each column line.
  const nv = Math.max(2, Math.round((cd - 0.3) / 1.5));
  const pd = (cd - 0.3) / nv;
  for (let j = 0; j <= nv; j++) {
    sb.box(w0 - 0.12, 0.1, 0.06, x0, CLEAR + 0.07, za + 0.15 + j * pd, IRON, undefined, 1 | 2 | HIDE_UP);
  }
  for (const ix of k.islandX) {
    if (ix > xa && ix < xb) sb.box(0.14, 0.1, cd - 0.12, ix, CLEAR + 0.07, cz, IRON, undefined, NO_ENDS | HIDE_UP);
  }

  // The soffit panels.
  const nu = Math.max(2, Math.round((w0 - 0.3) / 1.2));
  const pw = (w0 - 0.3) / nu;
  const lampRows = [cz - cd * 0.22, cz + cd * 0.22];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const x = xa + 0.15 + (i + 0.5) * pw;
      const z = za + 0.15 + (j + 0.5) * pd;
      const r = rnd();
      const gone = torn && i === 0 ? 0.45 : 0.06;
      if (r < gone) continue;
      if (r < gone + 0.04 && pd < 2.4) {
        // Dropped on one edge and hanging from it.
        const th = 0.5 + rnd() * 0.6;
        const e = rnd() < 0.5 ? -1 : 1;
        const zp = z - e * (pd / 2);
        sb.box(pw - 0.03, 0.02, pd - 0.03, x, CLEAR - 0.01 - (Math.sin(th) * pd) / 2, zp + (e * Math.cos(th) * pd) / 2, WHITEWASH, { x: e * th });
        continue;
      }
      sb.box(pw - 0.03, 0.02, pd - 0.03, x, CLEAR - 0.01, z, WHITEWASH, undefined, HIDE_UP);
    }
  }

  // The fittings: flush in two rows, lit glass, smashed to the tubes, or
  // hanging on their cables.
  const nl = Math.max(2, Math.round(w0 / 3.6));
  for (const lz of lampRows) {
    for (let i = 0; i < nl; i++) {
      const lx = xa + ((i + 0.5) * w0) / nl;
      const r = rnd();
      if (r < 0.55) {
        sb.box(1.0, 0.05, 0.42, lx, CLEAR - 0.045, lz, ALLOY, undefined, HIDE_UP);
        sb.box(0.92, 0.012, 0.34, lx, CLEAR - 0.074, lz, GLASS, undefined, HIDE_UP);
      } else if (r < 0.85) {
        sb.box(1.0, 0.05, 0.42, lx, CLEAR - 0.045, lz, ALLOY, undefined, HIDE_UP);
        sb.box(0.92, 0.01, 0.34, lx, CLEAR - 0.066, lz, WINDOW_VOID, undefined, HIDE_UP);
        for (const e of [-1, 1]) if (rnd() < 0.8) sb.box(0.86, 0.025, 0.025, lx, CLEAR - 0.085, lz + e * 0.08, WHITEWASH, undefined, HIDE_UP);
      } else {
        const e = rnd() < 0.5 ? -1 : 1;
        const ph = 0.6 + rnd() * 0.5;
        const a: Point3 = [lx - e * 0.5, CLEAR - 0.06, lz];
        const c: Point3 = [lx - e * 0.5 + e * Math.cos(ph), CLEAR - 0.06 - Math.sin(ph), lz];
        sb.box(0.42, 0.05, 1.0, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, lz, ALLOY, { y: e * (Math.PI / 2), x: ph });
        rod(lay, [lx + e * 0.5, CLEAR - 0.02, lz + 0.1], c, 0.012, IRON);
        rod(lay, [lx + e * 0.45, CLEAR - 0.02, lz - 0.12], [c[0], c[1] - 0.02, lz - 0.05], 0.012, IRON);
        sb.box(1.0, 0.012, 0.42, lx, CLEAR - 0.02, lz, WINDOW_VOID, undefined, HIDE_UP);
      }
    }
  }

  // The fascia.
  const nameOn = (s: Side): boolean => runsAlongX(s) && w0 > 6;
  const nameLen = Math.min(5, w0 * 0.4);
  for (const s of SIDES) {
    if (torn && s === "-x") continue;
    const back = hideBack(s);
    const P = s === "-z" ? cd / 2 - cz : s === "+z" ? cz + cd / 2 : s === "-x" ? w0 / 2 - x0 : x0 + w0 / 2;
    const ua = runsAlongX(s) ? xa : za;
    const ub = runsAlongX(s) ? xb : zb;
    const um = (ua + ub) / 2;
    const len = ub - ua;
    const n = Math.max(1, Math.round(len / 1.25));
    const fw = len / n;
    const gaps: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const u = ua + (i + 0.5) * fw;
      const r = rnd();
      const named = nameOn(s) && Math.abs(u - um) < nameLen / 2 + 0.7;
      if (!named && r < (s === "-z" ? 0.09 : 0.04)) {
        // A panel gone: the bearers it hung on, and the dark behind.
        gaps.push([u - fw / 2, u + fw / 2]);
        for (const y of [CLEAR + 0.18, top - 0.18]) sb.onFace(s, P, u, y, fw, 0.06, 0.04, -0.03, IRON, 0, 0, back);
        continue;
      }
      const tilt = !named && r < 0.16 ? (rnd() - 0.5) * 0.08 : 0;
      const dent = !named && r > 0.95 ? -0.03 : 0;
      sb.onFace(s, P, u, (CLEAR + 0.04 + top - 0.06) / 2 - Math.abs(tilt) * 0.4, fw - 0.025, FASCIA - 0.1, 0.04, -0.02 + dent, WHITEWASH, tilt, 0, back);
      // Rust running down from the joint.
      if (rnd() < 0.35) {
        const l = 0.15 + rnd() * 0.35;
        sb.onFace(s, P, u - fw / 2 + 0.03, top - 0.06 - l / 2, 0.025, l, 0.006, 0.003, RUST, 0, 0, back);
      }
    }
    for (const [a, c] of carve(ua, ub, gaps)) {
      sb.onFace(s, P, (a + c) / 2, CLEAR + 0.22, c - a, 0.2, 0.02, 0.008, AWNING, 0, 0, back);
      sb.onFace(s, P, (a + c) / 2, CLEAR + 0.08, c - a, 0.04, 0.012, 0.006, ENAMEL, 0, 0, back);
    }
    sb.onFace(s, P, um, top + 0.03, len + 0.1, 0.06, 0.2, -0.06, ALLOY, 0, 0, HIDE_DOWN);
    sb.onFace(s, P, um, CLEAR + 0.02, len + 0.04, 0.04, 0.06, 0.0, IRON, 0, 0, back);
    const ym = CLEAR + 0.47;
    if (nameOn(s)) {
      kufic(
        (uu, yy, along, tall) => sb.onFace(s, P, uu, yy, along, tall, 0.012, 0.006, ENAMEL, 0, 0, onlyFront(s)),
        um - nameLen / 2,
        um + nameLen / 2,
        CLEAR + 0.33,
        0.3,
        rnd,
      );
      for (const u of [ua + 0.75, ub - 0.75]) emblem(lay, s, P, u, ym, 0.27);
    } else if (!runsAlongX(s)) {
      emblem(lay, s, P, um, ym, 0.27);
    }
    if (s === "-z") pocks(lay, s, P, ua + 0.3, ub - 0.3, CLEAR + 0.1, top - 0.12, 8 + Math.floor(rnd() * 6), rnd);
  }
  // The corner trims.
  for (const x of [xa, xb]) {
    for (const z of [za, zb]) {
      if (torn && x === xa) continue;
      sb.box(0.07, FASCIA - 0.06, 0.07, x, CLEAR + FASCIA / 2, z, ALLOY, undefined, HIDE_DOWN | HIDE_UP);
    }
  }

  if (!torn) return;
  // The torn end: the purlins bent down out of it, the deck's sheets folded
  // over its edge, and the cables hanging.
  for (let j = 0; j <= nv; j++) {
    const z = za + 0.15 + j * pd;
    rod(lay, [xa + 0.05, CLEAR + 0.07, z], [xa - 0.3 - rnd() * 0.6, CLEAR + 0.07 - (0.25 + rnd() * 0.7), z + (rnd() - 0.5) * 0.5], 0.07, IRON);
  }
  for (let z = za + 0.5; z < zb - 0.4; z += 0.9 + rnd() * 0.6) {
    const drop = 0.3 + rnd() * 0.5;
    sb.box(0.012, drop, 0.55, xa - 0.04 - drop * 0.25, top - 0.02 - drop / 2, z, ALLOY, { z: 0.45 });
  }
  for (let i = 0; i < 3; i++) {
    const z = za + 0.8 + rnd() * (cd - 1.6);
    const mid: Point3 = [xa - 0.2 - rnd() * 0.3, CLEAR - 0.5 - rnd() * 0.4, z + (rnd() - 0.5) * 0.3];
    hose(lay.m(IRON), [[xa + 0.1, CLEAR + 0.05, z], mid, [mid[0] + 0.05, mid[1] - 0.5 - rnd() * 0.4, mid[2] + 0.1]], 0.014, 4);
  }
}

/** The company's emblem on a face: a disc in its band's colour and a star on it. */
function emblem(lay: Lay, s: Side, plane: number, u: number, y: number, r: number): void {
  eye(lay.m(AWNING), fp(s, plane, u, y, 0), fdir(s, 0, 0, 1), r, r, 0.02, 14, true, false);
  star(lay, s, plane, u, y, r * 1.05, 0.035, WHITEWASH);
}

/**
 * The ruined half that came down: the slab pitched from the back columns to
 * the forecourt, its deck and seams still on top, its soffit half shaken off
 * underneath, its fascia along the -X edge and lying at its foot, its torn
 * +X edge, and the panels and fittings it threw.
 */
function fallen(lay: Lay, k: Station): void {
  const sb = lay.sb;
  const { cw, cd, cx, cz, pitch, rnd } = k;
  const fx = cx - cw / 4;
  const len = cd / Math.cos(pitch);
  const y = (CLEAR + 0.6) / 2;
  const rot = { x: -pitch };
  const cos = Math.cos(pitch);
  const sin = Math.sin(pitch);
  // A point `n` off the slab's mid-plane and `s` along it, as [y, z].
  const at = (n: number, s: number): [number, number] => [y + n * cos + s * sin, cz + s * cos - n * sin];
  sb.box(cw / 2 - 0.2, 0.5, len, fx, y, cz, DARK_CONCRETE, rot);
  const [dy, dz] = at(0.26, 0);
  sb.box(cw / 2 - 0.3, 0.02, len - 0.2, fx, dy, dz, ALLOY, rot, HIDE_DOWN);
  const [ry, rz] = at(0.29, 0);
  for (let x = fx - cw / 4 + 0.4; x < fx + cw / 4 - 0.3; x += 0.6) sb.box(0.035, 0.04, len - 0.3, x, ry, rz, ALLOY, rot, HIDE_DOWN | NO_ENDS);
  // Sand slid down it into a ridge at the foot.
  lobe(lay.m(SANDBAG), fx, FT + 0.02, cz - cd / 2 - 0.15, cw / 4, 0.35, 0, rnd);
  // The soffit underneath, half of it shaken off.
  const nu = Math.max(2, Math.round((cw / 2 - 0.3) / 1.2));
  const pw = (cw / 2 - 0.3) / nu;
  const nv = 4;
  const pd = (len - 0.4) / nv;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      if (rnd() < 0.5) continue;
      const [py, pz] = at(-0.26, -len / 2 + 0.2 + (j + 0.5) * pd);
      sb.box(pw - 0.03, 0.02, pd - 0.03, fx - cw / 4 + 0.15 + (i + 0.5) * pw, py, pz, WHITEWASH, rot, HIDE_UP);
    }
  }
  // The fascia still on its -X edge, the band on it.
  const ex = cx - cw / 2 + 0.06;
  sb.box(0.12, FASCIA, len - 0.2, ex, y, cz, WHITEWASH, rot);
  const [by, bz] = at(-0.05, 0);
  sb.box(0.14, 0.2, len - 0.2, ex, by, bz, AWNING, rot);
  // The front's fascia lying at its foot, crumpled.
  sb.box(cw / 2 - 0.3, 0.6, 0.12, fx, 0.4, cz - cd / 2 + 0.2, WHITEWASH, { x: 0.3 });
  sb.box(cw / 2 - 0.3, 0.2, 0.14, fx, 0.42, cz - cd / 2 + 0.12, AWNING, { x: 0.3 });
  // The torn +X edge: purlins bent out of it, where they are over a head.
  for (let j = 0; j <= 4; j++) {
    const [py, pz] = at(-0.2, -len / 2 + 0.3 + (j * (len - 0.6)) / 4);
    if (py < 2.6) continue;
    rod(lay, [cx - 0.1, py, pz], [cx + 0.25 + rnd() * 0.4, py - 0.1 - rnd() * 0.3, pz + (rnd() - 0.5) * 0.4], 0.06, IRON);
  }
  // Panels and fittings shaken out of it.
  for (let i = 0; i < 6; i++) {
    sb.box(0.9, 0.02, 0.5, fx + (rnd() - 0.5) * cw * 0.45, FT + 0.02, cz - cd / 2 - 0.4 + rnd() * 1.0, WHITEWASH, { y: rnd() * 3, x: (rnd() - 0.5) * 0.12 }, HIDE_DOWN);
  }
  for (let i = 0; i < 2; i++) {
    sb.box(1.0, 0.05, 0.42, fx + (rnd() - 0.5) * cw * 0.4, FT + 0.03, cz - cd / 2 - 0.9 - rnd() * 0.6, ALLOY, { y: rnd() * 3, z: 0.1 }, HIDE_DOWN);
  }
}

// --- the kiosk ------------------------------------------------------------------------

/** A face of the kiosk's plane, as `onFace` wants it. */
const kPlane = (k: Station, s: Side): number =>
  s === "-z" ? k.kd / 2 - k.kz : s === "+z" ? k.kz + k.kd / 2 : s === "-x" ? k.kw / 2 - k.kx : k.kx + k.kw / 2;

/**
 * The kiosk: a concrete frame infilled with block and rendered — the plinth,
 * the corner pilasters and the ring beam in the frame's grey — under a slab
 * with the company's band round its edge, and each elevation what it is for.
 */
function kiosk(lay: Lay, k: Station): void {
  const sb = lay.sb;
  const { kw, kd, kh, kx, kz, rnd } = k;
  for (const s of SIDES) {
    const P = kPlane(k, s);
    const back = hideBack(s);
    const ua = runsAlongX(s) ? kx - kw / 2 : kz - kd / 2;
    const ub = runsAlongX(s) ? kx + kw / 2 : kz + kd / 2;
    const um = (ua + ub) / 2;
    sb.onFace(s, P, um, 0.25, ub - ua + 0.1, 0.5, 0.05, 0.025, DARK_CONCRETE, 0, 0, back);
    sb.onFace(s, P, um, kh - 0.15, ub - ua + 0.12, 0.3, 0.06, 0.03, CONCRETE, 0, 0, back);
    for (const u of [ua + 0.15, ub - 0.15]) sb.onFace(s, P, u, (0.5 + kh - 0.3) / 2, 0.36, kh - 0.8, 0.06, 0.03, CONCRETE, 0, 0, back);
    // The band round the slab's edge, under the coping.
    sb.onFace(s, P + 0.25, um, kh + 0.14, ub - ua + 0.5, 0.12, 0.012, 0.006, AWNING, 0, 0, back);
  }
  sb.box(kw + 0.5, 0.28, kd + 0.5, kx, kh + 0.14, kz, DARK_CONCRETE);
  sb.box(kw + 0.6, 0.12, kd + 0.6, kx, kh + 0.34, kz, WHITEWASH);
  kioskFront(lay, k);
  kioskEnds(lay, k);
  kioskBack(lay, k);
  kioskRoof(lay, k);

  // The war on the render: a spall or two back to the block, and pocks, on
  // the face toward the road and one other.
  const hit: Side = (["+x", "-x", "+z"] as const)[Math.floor(rnd() * 3)];
  for (const s of ["-z", hit] as const) {
    const P = kPlane(k, s);
    const ua = runsAlongX(s) ? kx - kw / 2 : kz - kd / 2;
    const ub = runsAlongX(s) ? kx + kw / 2 : kz + kd / 2;
    pocks(lay, s, P, ua + 0.4, ub - 0.4, 0.8, kh - 0.4, 8 + Math.floor(rnd() * 6), rnd);
  }
  // Where on that face the render has gone: clear of what hangs on it.
  const [hu, hy] = hit === "-x" ? [kz + 0.3, 1.3] : hit === "+x" ? [kz + 1.3, 1.0] : [kx - kw / 2 + 3.2, 1.05];
  spall(lay, hit, kPlane(k, hit), hu, hy, 0.45, 0.3, WHITEWASH, rnd, BLOCK);
}

/**
 * The shop, the door and the lube bay. The shopfront: a tiled riser, an
 * aluminium frame of four panes — intact, blown in to its shards, boarded or
 * papered — and the signboard over it lettered in the company's name. The
 * door behind a scissor gate, padlocked, under a cast hood and its lamp. The
 * lube bay's shutter half up under its box, a sign over it.
 */
function kioskFront(lay: Lay, k: Station): void {
  const sb = lay.sb;
  const { kw, kh, kx, rnd } = k;
  const s: Side = "-z";
  const P = kPlane(k, s);
  const back = hideBack(s);
  const f = onlyFront(s);
  const shop = kw * 0.55;
  const shopX = kx - kw / 2 + 0.4 + shop / 2;
  const s0 = shopX - shop / 2;
  const s1 = shopX + shop / 2;
  // The riser in tiles over the plinth.
  sb.onFace(s, P, shopX, 0.58, shop, 0.16, 0.04, 0.02, CONCRETE, 0, 0, back);
  for (let u = s0 + 0.15; u < s1 - 0.05; u += 0.3) sb.onFace(s, P, u, 0.58, 0.01, 0.16, 0.01, 0.04, DARK_CONCRETE, 0, 0, f);
  const panes = 4;
  const pw = shop / panes;
  for (let i = 0; i < panes; i++) {
    const u = s0 + (i + 0.5) * pw;
    const r = rnd();
    const lo = 0.7;
    const hi = 2.4;
    const ym = (lo + hi) / 2;
    if (r < 0.32) {
      sb.onFace(s, P, u, ym, pw - 0.12, hi - lo, 0.01, 0.005, GLASS, 0, 0, back);
      if (rnd() < 0.6) poster(lay, s, P, u + (rnd() - 0.5) * 0.3, 1.6 + rnd() * 0.2, 0.025, rnd);
    } else if (r < 0.7) {
      // Blown in, the shards left standing in the frame's corners.
      sb.onFace(s, P, u, ym, pw - 0.12, hi - lo, 0.01, 0.005, WINDOW_VOID, 0, 0, back);
      const a = u - pw / 2 + 0.06;
      const c = u + pw / 2 - 0.06;
      slabOn(lay, s, P, [[a, hi], [a + 0.25 + rnd() * 0.3, hi], [a, hi - 0.3 - rnd() * 0.5]], 0.012, 0.022, GLASS);
      slabOn(lay, s, P, [[c, lo], [c, lo + 0.2 + rnd() * 0.4], [c - 0.3 - rnd() * 0.3, lo]], 0.012, 0.022, GLASS);
      if (rnd() < 0.5) slabOn(lay, s, P, [[a, lo], [a + 0.2, lo], [a, lo + 0.35]], 0.012, 0.022, GLASS);
    } else {
      // Boarded: a sheet of ply nailed over it, a slogan sprayed across.
      sb.onFace(s, P, u, ym, pw - 0.05, hi - lo + 0.06, 0.02, 0.06, PALM_BEAM, (rnd() - 0.5) * 0.04, 0, back);
      kufic(
        (uu, yy, along, tall) => sb.onFace(s, P, uu, yy, along, tall, 0.004, 0.072, SCORCH, 0, 0, f),
        u - pw / 2 + 0.15,
        u + pw / 2 - 0.15,
        1.3,
        0.36,
        rnd,
      );
    }
    sb.onFace(s, P, u - pw / 2, ym, 0.08, hi - lo + 0.1, 0.07, 0.035, ALLOY, 0, 0, back);
  }
  sb.onFace(s, P, s1, 1.55, 0.08, 1.8, 0.07, 0.035, ALLOY, 0, 0, back);
  for (const y of [0.66, 2.44]) sb.onFace(s, P, shopX, y, shop + 0.1, 0.08, 0.07, 0.035, ALLOY, 0, 0, back);
  // The signboard over the shop, lettered.
  const sy = (2.48 + kh - 0.3) / 2;
  const sh = kh - 0.3 - 2.52;
  sb.onFace(s, P, shopX, sy, shop + 0.2, sh, 0.06, 0.04, AWNING, 0, 0, back);
  kufic(
    (uu, yy, along, tall) => sb.onFace(s, P, uu, yy, along, tall, 0.01, 0.075, WHITEWASH, 0, 0, f),
    shopX - Math.min(shop - 0.6, 3.2) / 2,
    shopX + Math.min(shop - 0.6, 3.2) / 2,
    sy - sh / 2 + 0.05,
    sh - 0.1,
    rnd,
  );
  // Scorch over the pane that burned.
  const bu = s0 + pw * (0.5 + Math.floor(rnd() * panes));
  blob(lay, s, P, [bu, 2.6], ragged(bu, 2.6, 0.7, 0.45, 12, rnd), 0.08, 0.084, SCORCH);

  // The door, its gate and hood.
  const doorX = shopX + shop / 2 + 0.75;
  sb.onFace(s, P, doorX, 1.1, 1.0, 2.2, 0.02, 0.0, GLASS, 0, 0, back);
  for (const u of [doorX - 0.54, doorX + 0.54]) sb.onFace(s, P, u, 1.12, 0.08, 2.24, 0.07, 0.035, ALLOY, 0, 0, back);
  sb.onFace(s, P, doorX, 2.24, 1.16, 0.08, 0.07, 0.035, ALLOY, 0, 0, back);
  sb.onFace(s, P, doorX, 1.0, 0.8, 0.05, 0.04, 0.03, ALLOY, 0, 0, back);
  for (let i = 0; i <= 8; i++) sb.onFace(s, P, doorX - 0.48 + i * 0.12, 1.08, 0.025, 2.1, 0.015, 0.08, IRON, 0, 0, back);
  const tong = Math.atan2(0.52, 0.12);
  for (let i = 0; i < 8; i++) {
    const u = doorX - 0.42 + i * 0.12;
    for (let row = 0; row < 4; row++) {
      const yc = 0.33 + row * 0.5;
      for (const sg of [-1, 1]) sb.onFace(s, P, u, yc, Math.hypot(0.12, 0.5), 0.02, 0.012, 0.09, IRON, sg * tong, 0, back);
    }
  }
  sb.onFace(s, P, doorX + 0.46, 1.1, 0.06, 0.1, 0.04, 0.11, ALLOY, 0, 0, back);
  sb.box(1.5, 0.1, 0.6, doorX, 2.47, kPlaneZ(k) - 0.3, CONCRETE);
  sb.onFace(s, P, doorX, 2.75, 0.22, 0.14, 0.12, 0.06, ALLOY, 0, 0, back);
  sb.onFace(s, P, doorX, 2.7, 0.18, 0.06, 0.1, 0.12, GLASS, 0, 0, back);

  // The lube bay's shutter, half up.
  const shutterX = kx + kw / 2 - 1.2;
  if (shutterX - 0.9 > doorX + 0.6) {
    const top = 2.7;
    const foot = 1.25 + rnd() * 0.3;
    // The opening stands just proud of the plinth it is cut through, which
    // is as deep as a face over a solid core can go.
    sb.onFace(s, P, shutterX, (FT + top) / 2, 1.6, top - FT, 0.01, 0.055, WINDOW_VOID, 0, 0, back);
    for (let y = foot + 0.05; y < top; y += 0.1) sb.onFace(s, P, shutterX, y, 1.6, 0.085, 0.03, 0.075, ALLOY, 0, 0, back);
    sb.onFace(s, P, shutterX, foot, 1.62, 0.06, 0.05, 0.085, IRON, 0, 0, back);
    for (const e of [-1, 1]) sb.onFace(s, P, shutterX + e * 0.84, (FT + top) / 2, 0.07, top - FT, 0.08, 0.075, IRON, 0, 0, back);
    sb.onFace(s, P, shutterX, top + 0.16, 1.8, 0.34, 0.3, 0.15, ALLOY, 0, 0, back);
    sb.onFace(s, P, shutterX, top + 0.5, 1.4, 0.22, 0.02, 0.01, WHITEWASH, 0, 0, back);
    kufic(
      (uu, yy, along, tall) => sb.onFace(s, P, uu, yy, along, tall, 0.006, 0.022, AWNING, 0, 0, f),
      shutterX - 0.6,
      shutterX + 0.6,
      top + 0.4,
      0.2,
      rnd,
    );
  }

  // The dead pasted on the pilasters, and a slogan on the render between.
  for (const u of [kx - kw / 2 + 0.15, kx + kw / 2 - 0.15]) {
    if (rnd() < 0.7) poster(lay, s, P, u, 1.5 + rnd() * 0.2, 0.06, rnd);
  }
  if (shutterX - 0.9 > doorX + 0.6) {
    const gu = (doorX + 0.6 + shutterX - 0.9) / 2;
    if (rnd() < 0.6) poster(lay, s, P, gu, 1.6, 0.0, rnd);
  }
}

/** The kiosk's front face, as a Z. */
const kPlaneZ = (k: Station): number => k.kz - k.kd / 2;

/**
 * The two ends. At -X, the underground tanks' vent stacks up the wall and
 * jogged out over its head past the slab to their cowls, beside the meter
 * box and its conduits, and the store door. At +X, the tyre fitter's:
 * a sign painted on the render and inner tubes hung on nails, and a barred
 * window.
 */
function kioskEnds(lay: Lay, k: Station): void {
  const sb = lay.sb;
  const { kd, kh, kz, rnd } = k;
  // --- -X ---
  {
    const s: Side = "-x";
    const P = kPlane(k, s);
    const back = hideBack(s);
    const z0 = kz - kd / 2;
    const vents = [z0 + 0.45, z0 + 0.65, z0 + 0.85];
    const jog = kh - 0.5;
    const iron = lay.m(IRON);
    sb.onFace(s, P, (vents[0] + vents[2]) / 2, FT + 0.1, 0.75, 0.2, 0.25, 0.125, CONCRETE, 0, 0, back);
    vents.forEach((u, i) => {
      const r = 0.035;
      const head = kh + 1.6 + i * 0.15;
      hose(iron, [fp(s, P, u, FT + 0.18, 0.1), fp(s, P, u, jog, 0.1), fp(s, P, u, jog + 0.35, 0.42), fp(s, P, u, head, 0.42)], r, 6);
      const cap = fp(s, P, u, head, 0.42);
      band(lay.m(ALLOY), 6, 0, 0.06, head, 0.06, head + 0.1, cap[0], cap[2]);
      band(lay.m(ALLOY), 6, 0, 0.09, head + 0.1, 0.02, head + 0.2, cap[0], cap[2]);
      for (const y of [0.9, 1.9]) sb.onFace(s, P, u, y, 0.09, 0.04, 0.12, 0.06, ALLOY, 0, 0, back);
    });
    sb.onFace(s, P, (vents[0] + vents[2]) / 2, kh + 0.14, 0.6, 0.05, 0.42, 0.21, ALLOY, 0, 0, 0);
    // The meter box and its conduits up under the slab.
    const mu = z0 + 1.6;
    sb.onFace(s, P, mu, 1.6, 0.5, 0.7, 0.18, 0.09, ALLOY, 0, 0, back);
    sb.onFace(s, P, mu, 1.6, 0.012, 0.66, 0.01, 0.185, IRON, 0, 0, back);
    sb.onFace(s, P, mu + 0.18, 1.5, 0.03, 0.06, 0.03, 0.19, IRON, 0, 0, back);
    for (const du of [-0.12, 0.12]) sb.onFace(s, P, mu + du, (1.95 + kh) / 2, 0.04, kh - 1.95, 0.04, 0.03, IRON, 0, 0, back);
    // The store door, steel in a steel frame, its sign over it.
    const du = kz + kd / 2 - 1.0;
    sb.onFace(s, P, du, 1.1, 0.96, 2.1, 0.02, 0.01, ENAMEL, 0, 0, back);
    for (const e of [-1, 1]) sb.onFace(s, P, du + e * 0.52, 1.12, 0.08, 2.2, 0.05, 0.025, ALLOY, 0, 0, back);
    sb.onFace(s, P, du, 2.2, 1.12, 0.08, 0.05, 0.025, ALLOY, 0, 0, back);
    sb.onFace(s, P, du + 0.34, 1.05, 0.03, 0.14, 0.04, 0.03, IRON, 0, 0, back);
    sb.onFace(s, P, du, 2.55, 0.7, 0.24, 0.02, 0.01, WHITEWASH, 0, 0, back);
    kufic(
      (uu, yy, along, tall) => sb.onFace(s, P, uu, yy, along, tall, 0.006, 0.022, ENAMEL, 0, 0, onlyFront(s)),
      du - 0.28,
      du + 0.28,
      2.46,
      0.2,
      rnd,
    );
  }
  // --- +X ---
  {
    const s: Side = "+x";
    const P = kPlane(k, s);
    const back = hideBack(s);
    const f = onlyFront(s);
    const mid = kz;
    sb.onFace(s, P, mid, 2.35, 1.7, 0.85, 0.008, 0.004, WHITEWASH, 0, 0, back);
    kufic(
      (uu, yy, along, tall) => sb.onFace(s, P, uu, yy, along, tall, 0.006, 0.01, AWNING, 0, 0, f),
      mid - 0.75,
      mid + 0.25,
      2.08,
      0.52,
      rnd,
    );
    // The tyre on the sign, a ring of short strokes.
    ringOn(lay, s, P, mid + 0.52, 2.35, 0.27, 0.07, 0.012, IRON);
    // Inner tubes hung on nails over the stacks.
    for (const u of [mid - 0.55, mid + 0.2]) {
      ringOn(lay, s, P, u, 1.55, 0.3, 0.07, 0.035, IRON);
      sb.onFace(s, P, u, 1.86, 0.03, 0.03, 0.08, 0.04, ALLOY, 0, 0, back);
    }
    const wu = kz + kd / 2 - 0.7;
    sb.onFace(s, P, wu, 2.3, 0.6, 0.5, 0.02, 0.0, WINDOW_VOID, 0, 0, back);
    for (let i = -1; i <= 1; i++) sb.onFace(s, P, wu + i * 0.15, 2.3, 0.025, 0.5, 0.025, 0.03, IRON, 0, 0, back);
    sb.onFace(s, P, wu, 2.02, 0.76, 0.06, 0.1, 0.05, CONCRETE, 0, 0, back);
  }
}

/** A ring of `n` short strokes round `(u, y)`, radius `r`: an inner tube, a painted tyre. */
function ringOn(lay: Lay, s: Side, plane: number, u: number, y: number, r: number, thick: number, out: number, color: string): void {
  const n = 12;
  const chord = 2 * r * Math.sin(Math.PI / n) + thick * 0.4;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * TAU;
    // The stroke runs along the tangent, its lean folded into (-90°, 90°].
    const lean = Math.atan2(Math.cos(a), -Math.sin(a));
    const t = lean > Math.PI / 2 ? lean - Math.PI : lean <= -Math.PI / 2 ? lean + Math.PI : lean;
    lay.sb.onFace(s, plane, u + Math.cos(a) * r, y + Math.sin(a) * r, chord, thick, thick, out, color, t, 0, hideBack(s));
  }
}

/**
 * The back, onto the yard: the yard door, a barred window, the
 * air-conditioner hung on the wall and its drip, the downpipe off the roof,
 * and a slogan.
 */
function kioskBack(lay: Lay, k: Station): void {
  const sb = lay.sb;
  const { kw, kh, kx, rnd } = k;
  const s: Side = "+z";
  const P = kPlane(k, s);
  const back = hideBack(s);
  const x0 = kx - kw / 2;
  const du = x0 + 1.0;
  sb.onFace(s, P, du, 1.05, 0.9, 2.0, 0.02, 0.01, ENAMEL, 0, 0, back);
  for (const e of [-1, 1]) sb.onFace(s, P, du + e * 0.49, 1.07, 0.08, 2.1, 0.05, 0.025, ALLOY, 0, 0, back);
  sb.onFace(s, P, du, 2.1, 1.06, 0.08, 0.05, 0.025, ALLOY, 0, 0, back);
  const wu = x0 + 2.8;
  sb.onFace(s, P, wu, 2.1, 0.9, 0.6, 0.02, 0.0, WINDOW_VOID, 0, 0, back);
  for (let i = -2; i <= 2; i++) sb.onFace(s, P, wu + i * 0.17, 2.1, 0.025, 0.6, 0.025, 0.03, IRON, 0, 0, back);
  sb.onFace(s, P, wu, 1.76, 1.06, 0.06, 0.1, 0.05, CONCRETE, 0, 0, back);
  // The air-conditioner and its drip.
  const au = x0 + kw * 0.62;
  const ay = 2.3;
  sb.onFace(s, P, au, ay, 0.8, 0.5, 0.3, 0.15, WHITEWASH, 0, 0, back);
  eye(lay.m(IRON), fp(s, P, au + 0.13, ay, 0.3), fdir(s, 0, 0, 1), 0.18, 0.18, 0.015, 8, true, false);
  for (let i = 0; i < 4; i++) sb.onFace(s, P, au - 0.27, ay - 0.15 + i * 0.1, 0.16, 0.025, 0.01, 0.305, IRON, 0, 0, back);
  for (const e of [-1, 1]) sb.onFace(s, P, au + e * 0.3, ay - 0.27, 0.04, 0.04, 0.34, 0.17, IRON, 0, 0, back);
  const lo = 1.0 + rnd() * 0.4;
  blob(lay, s, P, [au, (ay - 0.25 + lo) / 2], [
    [au - 0.07, ay - 0.25],
    [au + 0.09, ay - 0.25],
    [au + 0.12, lo + 0.12],
    [au + 0.03, lo],
    [au - 0.08, lo + 0.08],
  ], 0, 0.004, DARK_CONCRETE);
  // The downpipe off the roof's back corner.
  const pu = kx + kw / 2 - 0.45;
  sb.onFace(s, P, pu, (0.3 + kh) / 2, 0.09, kh - 0.3, 0.09, 0.08, IRON, 0, 0, back);
  sb.onFace(s, P, pu, kh + 0.08, 0.09, 0.2, 0.36, 0.18, IRON, 0, 0, back);
  const sl = 1.8;
  const su = x0 + 6.9;
  kufic(
    (uu, yy, along, tall) => sb.onFace(s, P, uu, yy, along, tall, 0.004, 0.003, SCORCH, 0, 0, onlyFront(s)),
    su - sl / 2,
    su + sl / 2,
    0.95,
    0.4,
    rnd,
  );
}

/**
 * The roof: an upstand round its edge; the air-conditioner and its pipes,
 * a black water tank, a dish and an aerial; tar patches and sand.
 */
function kioskRoof(lay: Lay, k: Station): void {
  const sb = lay.sb;
  const { kw, kd, kh, kx, kz, rnd } = k;
  const R = kh + 0.4;
  const hx = (kw + 0.6) / 2;
  const hz = (kd + 0.6) / 2;
  for (const e of [-1, 1]) {
    sb.box(kw + 0.6, 0.16, 0.12, kx, R + 0.08, kz + e * (hz - 0.06), WHITEWASH, undefined, HIDE_DOWN);
    sb.box(0.12, 0.16, kd + 0.36, kx + e * (hx - 0.06), R + 0.08, kz, WHITEWASH, undefined, HIDE_DOWN);
  }
  // The air-conditioner on its rails, its fan, its pipes over the edge.
  const ax = kx + kw * 0.25;
  const az = kz + 0.6;
  for (const e of [-1, 1]) sb.box(1.1, 0.06, 0.06, ax, R + 0.03, az + e * 0.3, IRON, undefined, HIDE_DOWN);
  sb.box(1.0, 0.7, 0.8, ax, R + 0.41, az, ALLOY, undefined, HIDE_DOWN);
  sb.box(0.92, 0.04, 0.72, ax, R + 0.78, az, IRON, undefined, HIDE_DOWN);
  band(lay.m(IRON), 10, 0, 0.3, R + 0.8, 0.3, R + 0.84, ax, az);
  disc(lay.m(WINDOW_VOID), 10, 0, 0.3, 0, R + 0.82, true, ax, az);
  for (let i = -2; i <= 2; i++) sb.box(0.58, 0.02, 0.02, ax, R + 0.85, az + i * 0.11, IRON, undefined, HIDE_DOWN);
  hose(lay.m(IRON), [[ax + 0.5, R + 0.2, az - 0.2], [kx + kw / 2 - 0.3, R + 0.06, az - 0.2], [kx + kw / 2 + 0.32, R + 0.2, az - 0.2], [kx + kw / 2 + 0.32, kh - 0.2, az - 0.2]], 0.02, 5);
  // A black water tank.
  const wx = kx - kw * 0.3;
  const wz = kz + kd * 0.2;
  const tm = lay.m(IRON);
  band(tm, 12, 0, 0.5, R, 0.5, R + 0.95, wx, wz);
  for (const y of [R + 0.3, R + 0.62]) band(tm, 12, 0, 0.52, y, 0.52, y + 0.05, wx, wz);
  band(tm, 12, 0, 0.5, R + 0.95, 0.2, R + 1.05, wx, wz);
  band(tm, 8, 0, 0.18, R + 1.05, 0.18, R + 1.12, wx, wz);
  disc(tm, 8, 0, 0.18, 0, R + 1.12, true, wx, wz);
  hose(tm, [[wx + 0.5, R + 0.1, wz], [wx + 1.0, R + 0.05, wz + 0.2], [kx - kw / 2 + 0.2, R + 0.05, wz + 0.6]], 0.025);
  // The dish on its pole, and an aerial.
  const dx = kx + kw / 2 - 0.6;
  const dz = kz - kd / 2 + 0.6;
  rod(lay, [dx, R, dz], [dx, R + 0.9, dz], 0.05, IRON);
  const aim: V3 = [-0.35, 0.55, -0.75];
  eye(lay.m(WHITEWASH), [dx, R + 0.95, dz], aim, 0.08, 0.42, 0.16, 12, true, true);
  rod(lay, [dx, R + 0.95, dz], [dx + aim[0] * 0.55, R + 0.95 + aim[1] * 0.55, dz + aim[2] * 0.55], 0.02, IRON);
  const mx = kx - kw / 2 + 0.6;
  const mz = kz - kd / 2 + 0.5;
  rod(lay, [mx, R, mz], [mx, R + 2.3, mz], 0.04, IRON);
  for (let i = 0; i < 4; i++) {
    const y = R + 1.3 + i * 0.28;
    const l = 0.9 - i * 0.15;
    rod(lay, [mx - l / 2, y, mz], [mx + l / 2, y, mz], 0.015, IRON);
  }
  // Tar patches over cracks, and sand.
  for (let i = 0; i < 5; i++) {
    lobe(lay.m(SCORCH), kx + (rnd() - 0.5) * (kw - 1), R + 0.01, kz + (rnd() - 0.5) * (kd - 1), 0.25 + rnd() * 0.4, 0.15 + rnd() * 0.2, rnd() * TAU, rnd);
  }
  lobe(lay.m(SANDBAG), kx + (rnd() - 0.5) * kw * 0.6, R + 0.025, kz + hz - 0.5, 1.2, 0.3, 0, rnd);
  lobe(lay.m(SANDBAG), kx + hx - 0.5, R + 0.025, kz + (rnd() - 0.5) * kd * 0.5, 0.3, 0.9, 0, rnd);
}

// --- the water tank and the tyres --------------------------------------------------------

/**
 * The water tank: four angle-iron legs on pads carried to the ground, braced
 * on every face, a grating under a banded steel tank, its ladder, its pipes
 * to the kiosk and the ground, and bullet holes weeping rust.
 */
function waterTank(lay: Lay, k: Station): void {
  const sb = lay.sb;
  const { tx, kz, rnd, ground } = k;
  const legs: [number, number][] = [[-0.55, -0.55], [0.55, -0.55], [0.55, 0.55], [-0.55, 0.55]];
  for (const [lx, lz] of legs) {
    const g = Math.min(0, ground(tx + lx, kz + lz));
    sb.box(0.28, 0.15 - g, 0.28, tx + lx, (0.15 + g) / 2, kz + lz, CONCRETE, undefined, HIDE_DOWN);
    sb.box(0.08, 1.9, 0.08, tx + lx, 0.15 + 0.95, kz + lz, IRON, undefined, HIDE_DOWN | HIDE_UP);
  }
  for (let i = 0; i < 4; i++) {
    const [ax, az] = legs[i];
    const [bx, bz] = legs[(i + 1) % 4];
    for (const y of [0.25, 1.15, 2.0]) rod(lay, [tx + ax, y, kz + az], [tx + bx, y, kz + bz], 0.05, IRON);
    rod(lay, [tx + ax, 0.25, kz + az], [tx + bx, 1.15, kz + bz], 0.035, IRON);
    rod(lay, [tx + bx, 0.25, kz + bz], [tx + ax, 1.15, kz + az], 0.035, IRON);
    rod(lay, [tx + ax, 1.15, kz + az], [tx + bx, 2.0, kz + bz], 0.035, IRON);
  }
  for (let i = -4; i <= 4; i++) sb.box(1.2, 0.03, 0.03, tx, 2.04, kz + i * 0.13, IRON, undefined, HIDE_DOWN | 1 | 2);
  // The tank, painted, banded, a lid and a vent on its cone.
  const tm = lay.m(WHITEWASH);
  band(tm, 14, 0, 0.64, 2.06, 0.64, 3.48, tx, kz);
  band(tm, 14, 0, 0.64, 3.48, 0.16, 3.62, tx, kz);
  for (const y of [2.12, 2.5, 2.9, 3.3]) band(lay.m(ALLOY), 14, 0, 0.66, y, 0.66, y + 0.05, tx, kz);
  band(lay.m(ALLOY), 8, 0, 0.16, 3.62, 0.16, 3.7, tx, kz);
  disc(lay.m(ALLOY), 8, 0, 0.16, 0, 3.7, true, tx, kz);
  rod(lay, [tx + 0.3, 3.5, kz + 0.2], [tx + 0.3, 3.85, kz + 0.2], 0.04, IRON);
  sb.box(0.12, 0.04, 0.12, tx + 0.3, 3.87, kz + 0.2, IRON);
  // Pipes: the outlet into the kiosk wall, the filler down to the ground.
  hose(lay.m(IRON), [[tx + 0.6, 2.25, kz - 0.2], [tx + 0.9, 2.25, kz - 0.2], [k.kx - k.kw / 2 - 0.02, 2.25, kz - 0.2]], 0.03);
  hose(lay.m(IRON), [[tx - 0.4, 3.55, kz - 0.4], [tx - 0.72, 3.4, kz - 0.4], [tx - 0.72, 0.4, kz - 0.4], [tx - 0.72, 0.12, kz - 0.7]], 0.03);
  sb.box(0.1, 0.1, 0.1, tx - 0.72, 0.9, kz - 0.4, AWNING);
  // The ladder up the -X face.
  for (const e of [-1, 1]) sb.box(0.04, 2.0, 0.04, tx - 0.62, 1.05, kz + e * 0.2, IRON, undefined, HIDE_DOWN);
  for (let y = 0.35; y < 2.0; y += 0.3) sb.box(0.03, 0.03, 0.4, tx - 0.62, y, kz, IRON, undefined, NO_ENDS);
  // Bullet holes on the road side, each weeping rust.
  for (let i = 0; i < 4; i++) {
    const a = Math.PI + (rnd() - 0.5) * 1.6;
    const y = 2.4 + rnd() * 0.9;
    const px = tx + Math.sin(a) * 0.655;
    const pz = kz + Math.cos(a) * 0.655;
    sb.box(0.05, 0.05, 0.02, px, y, pz, SCORCH, { y: a });
    const l = 0.2 + rnd() * 0.4;
    sb.box(0.03, l, 0.012, tx + Math.sin(a) * 0.648, y - l / 2, kz + Math.cos(a) * 0.648, RUST, { y: a });
  }
}

/**
 * The tyre fitter's stacks, each a column of tyres a little out of true with
 * the dark of the bore at the top, and two lying loose beside them.
 */
function tyreStacks(lay: Lay, k: Station): void {
  const { rnd, hw } = k;
  for (const [x, z, n] of k.stacks) {
    let px = x;
    let pz = z;
    for (let i = 0; i < n; i++) {
      px = x + (rnd() - 0.5) * 0.04;
      pz = z + (rnd() - 0.5) * 0.04;
      tyre(lay, px, i * 0.205, pz, rnd());
    }
    disc(lay.m(WINDOW_VOID), 12, 0, 0.2, 0, n * 0.205 - 0.12, true, px, pz);
  }
  const [x0, z0] = k.stacks[0];
  const lx = Math.min(hw - 0.4, x0 + 0.3);
  tyre(lay, lx, FT, z0 - 0.85, rnd());
  disc(lay.m(WINDOW_VOID), 12, 0, 0.2, 0, FT + 0.12, true, lx, z0 - 0.85);
}

// --- the sign ---------------------------------------------------------------------------

/**
 * The pylon at the road: a plinth carried to the ground, a base plate and an
 * access hatch, flange collars up the pole and a ladder up its back; the
 * cabinet with the emblem and the name to the road and its face to the town
 * blown in to its tubes; the price board under it, three grades in seven-segment numbers
 * with their colour-coded labels, two cells shot out.
 */
function sign(lay: Lay, k: Station): void {
  const sb = lay.sb;
  const { sx, sz, poleH, rnd, ground } = k;
  const g = Math.min(0, ground(sx, sz), ground(sx - 0.35, sz - 0.35), ground(sx + 0.35, sz - 0.35));
  sb.box(0.7, 0.4 - g, 0.7, sx, (0.4 + g) / 2, sz, CONCRETE, undefined, HIDE_DOWN);
  band(lay.m(CONCRETE), 4, 0, 0.35, 0.4, 0.26, 0.48, sx, sz);
  sb.box(0.44, 0.03, 0.44, sx, 0.495, sz, ALLOY, undefined, HIDE_DOWN);
  for (const [bx, bz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) sb.box(0.04, 0.06, 0.04, sx + bx * 0.17, 0.53, sz + bz * 0.17, IRON, undefined, HIDE_DOWN);
  sb.box(0.16, 0.36, 0.01, sx, 1.0, sz + 0.155, ALLOY);
  for (const y of [2.5, 4.9]) sb.box(0.38, 0.05, 0.38, sx, y, sz, ALLOY);
  sb.box(0.36, 0.06, 0.36, sx, poleH + 0.03, sz, ALLOY);
  for (let y = 2.7; y < 6.4; y += 0.3) sb.box(0.03, 0.03, 0.32, sx - 0.2, y, sz, IRON, undefined, NO_ENDS);
  for (const e of [-1, 1]) sb.box(0.03, 3.6, 0.03, sx - 0.2, 4.55, sz + e * 0.15, IRON, undefined, HIDE_DOWN | HIDE_UP);

  // The cabinet: a frame and both faces.
  const bw = 1.9;
  const bxc = sx + bw / 2 - 0.13;
  const by = poleH - 1.4;
  sb.box(bw + 0.08, 1.58, 0.28, bxc, by, sz, ALLOY);
  // The face to the town is the one blown in; the road's keeps its emblem.
  const blown = 1;
  for (const e of [-1, 1]) {
    const s = zSide(e);
    const P = pl(e, sz, 0.14);
    const back = hideBack(s);
    if (e === blown) {
      // This face blown in: the dark inside, its tubes, the shards.
      sb.onFace(s, P, bxc, by, bw - 0.1, 1.44, 0.01, 0.005, WINDOW_VOID, 0, 0, back);
      for (const y of [by - 0.45, by, by + 0.45]) sb.onFace(s, P, bxc, y, bw - 0.3, 0.04, 0.04, 0.03, WHITEWASH, 0, 0, back);
      const a = bxc - bw / 2 + 0.05;
      slabOn(lay, s, P, [[a, by + 0.72], [a + 0.6, by + 0.72], [a, by + 0.1]], 0.012, 0.022, WHITEWASH);
      slabOn(lay, s, P, [[a + bw - 0.1, by - 0.72], [a + bw - 0.1, by - 0.2], [a + bw - 0.7, by - 0.72]], 0.012, 0.022, WHITEWASH);
      continue;
    }
    sb.onFace(s, P, bxc, by, bw - 0.08, 1.44, 0.01, 0.005, WHITEWASH, 0, 0, back);
    emblem(lay, s, P, bxc, by + 0.22, 0.4);
    kufic(
      (uu, yy, along, tall) => sb.onFace(s, P, uu, yy, along, tall, 0.01, 0.015, ENAMEL, 0, 0, onlyFront(s)),
      bxc - 0.7,
      bxc + 0.7,
      by - 0.6,
      0.28,
      rnd,
    );
    sb.onFace(s, P, bxc, by - 0.66, bw - 0.08, 0.06, 0.012, 0.012, AWNING, 0, 0, back);
  }
  // The price board on two straps under it.
  const pyc = by - 1.95;
  sb.box(bw, 1.8, 0.22, bxc, pyc, sz, IRON);
  for (const u of [bxc - 0.6, bxc + 0.6]) sb.box(0.06, 0.25, 0.26, u, by - 0.9, sz, IRON);
  const grades = [AWNING, ENAMEL, ALLOY];
  for (const e of [-1, 1]) {
    const s = zSide(e);
    const P = pl(e, sz, 0.11);
    const back = hideBack(s);
    // Along the face's own right, so both faces read label first.
    const right = e < 0 ? 1 : -1;
    for (let r = 0; r < 3; r++) {
      const y = pyc + 0.55 - r * 0.55;
      const lu = bxc - right * 0.6;
      sb.onFace(s, P, lu, y, 0.5, 0.4, 0.02, 0.01, grades[r], 0, 0, back);
      kufic(
        (uu, yy, along, tall) => sb.onFace(s, P, uu, yy, along, tall, 0.006, 0.022, WHITEWASH, 0, 0, onlyFront(s)),
        lu - 0.18,
        lu + 0.18,
        y - 0.11,
        0.22,
        rnd,
      );
      for (let c = 0; c < 3; c++) {
        const u = bxc + right * (-0.12 + c * 0.32);
        sb.onFace(s, P, u, y, 0.27, 0.42, 0.01, 0.005, WINDOW_VOID, 0, 0, back);
        if (rnd() < 0.1) {
          blob(lay, s, P, [u, y], ragged(u, y, 0.1, 0.13, 8, rnd), 0.01, 0.014, SCORCH);
          continue;
        }
        numeral(lay, s, P, u, y, 0.32, Math.floor(rnd() * 10), 0.014, WHITEWASH);
      }
      sb.onFace(s, P, bxc + right * 0.04, y - 0.16, 0.035, 0.035, 0.008, 0.014, WHITEWASH, 0, 0, onlyFront(s));
      if (r < 2) sb.onFace(s, P, bxc, y - 0.275, bw - 0.06, 0.03, 0.02, 0.012, ALLOY, 0, 0, back);
    }
  }
}
