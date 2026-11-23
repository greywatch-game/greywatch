/**
 * kit/structures/silo.ts — buildSilo: the concrete stave tower silo.
 * Part of the structures set: follows the contract in kit/core.ts, and the
 * cover heights and round-collider rule in `./index.ts`.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  Lay,
  TAU,
  convexSolid,
  disc,
  eye,
  log,
  rod,
  streetSeed,
  type BuildCtx,
  type BuildParams,
  type Mesher,
  type Structure,
  type V3,
  DARK_STONE,
  IRON,
  SLATE,
  STONE,
  TIMBER,
} from "../core";

/** The drum's height to the eave and its nominal diameter: the collider's. */
const H = 12;
const DIA = 6;
/** Facets round the hoops, the footing and the dome. */
const N = 36;
const STEP = TAU / N;
/** Facets round the drum: one stave each, every other course turned half of one. */
const NS = 72;
const SSTEP = TAU / NS;
/** Apothem of a course at its foot; each course is tipped in by `TIP` at its head. */
const R = 2.98;
const TIP = 0.03;
/** Where the first course stands on the footing. */
const FOOT = 0.25;
const COURSES = 16;
const CH = (H - FOOT) / COURSES;
/** One stave's width at the foot of a course. */
const FW = 2 * R * Math.tan(SSTEP / 2);
const PLINTH = 3.12;
/** The roof: apothem at the eave and the dome's rise over it, a spherical cap. */
const EAVE = 3.14;
const RISE = 1.9;
const RHO = (EAVE * EAVE + RISE * RISE) / (2 * RISE);
const YC = H + RISE - RHO;
const domeY = (r: number): number => YC + Math.sqrt(Math.max(0, RHO * RHO - r * r));
/** The chute in its own frame: half its width, where it meets the drum, its arc's centre. */
const CW = 0.48;
const CVB = 2.92;
const CVC = 3.3;
const CHUTE_FOOT = 2.3;
const CHUTE_HEAD = 12.25;
/** The blower pipe: across from the chute's axis, out from the drum's. */
const PIPE_U = 0.75;
const PIPE_V = 3.25;

const K0 = 1 / Math.cos(Math.PI / N);
const KS = 1 / Math.cos(Math.PI / NS);
/** The vertex at bearing `a` on an `n`-faceted ring of apothem `r` (bearings from +Z toward +X). */
const at = (a: number, r: number, y: number, k = K0): V3 => [Math.sin(a) * r * k, y, Math.cos(a) * r * k];
/** How far bearing `a` is round from bearing `b`, in (-PI, PI]. */
const round = (a: number, b: number): number => {
  const d = (((a - b) % TAU) + TAU) % TAU;
  return d > Math.PI ? d - TAU : d;
};

/** A ring of `n` planar facets from apothem `r0` at `y0` to `r1` at `y1`, leaving out what `skip` names. */
function facets(m: Mesher, ph: number, r0: number, y0: number, r1: number, y1: number, skip?: (j: number) => boolean, n = N): void {
  const slope = (r0 - r1) / (y1 - y0);
  const step = TAU / n;
  const k = 1 / Math.cos(Math.PI / n);
  for (let j = 0; j < n; j++) {
    if (skip?.(j)) continue;
    const a0 = ph + (j - 0.5) * step;
    const a1 = a0 + step;
    const am = ph + j * step;
    m.quad(at(a0, r0, y0, k), at(a1, r0, y0, k), at(a1, r1, y1, k), at(a0, r1, y1, k), [Math.sin(am), slope, Math.cos(am)]);
  }
}

/**
 * The silo is a CONCRETE STAVE TOWER SILO, the kind put up by the thousand
 * between the wars: precast staves laid dry in courses round a drum, held by
 * steel hoops drawn tight at cast lugs, with a column of doors up one side
 * under a sheet-metal chute and a steel dome on top. It stands for three
 * trades — Hollowmere's and Harrowmead's farms, Cinderhaven's sulphur works
 * and Sarab's grain yard by the depots — and the stave silo was built for all
 * of them, so nothing on it names the trade or the country.
 *
 * Each course is 36 facets, a pair of staves each, tipped in at its head so
 * the course below's foot stands proud as a lit line, and every other course
 * is turned half a facet so the joints break bond the way staves are laid;
 * the cel bands find that stagger at the terminator. The hoops are skirts a
 * few centimetres off the face, close together at the foot where the
 * pressure is and further apart up the drum, each tightened at three lugs
 * whose columns zigzag up the drum, and each ends on the door frame.
 *
 * **Everything that stands off the drum stands on a DIAGONAL.** The box is the
 * nominal diameter, so on every diagonal there is 1.2 m of collider outside the
 * drawn drum: the chute, its door column, the blower pipe beside it, the apron
 * at its foot and the spare staves all live in that corner, inside the box, so
 * a body never walks through steel and a round that used to stop on air there
 * now stops on the chute. The roof, the hood the chute climbs into and the
 * vent are over every head.
 *
 * Seeded off where it stands (`streetSeed`) — which diagonal carries the
 * chute, which side of it the pipe rises, where the lug columns fall, the
 * staves that have spalled, the damp running down from the eave and the rust
 * from the lugs, whether a shell has taken a bite out of it (and what fell),
 * the vent's hat and the spare staves — and its footing is carried down to the
 * lowest ground round it, which puts `silo` in `CONFORMS_TO_TERRAIN`.
 *
 * **The collider is the box it always was**: the nominal `dia`, 12 m tall,
 * the pattern `./index.ts` points the round props at.
 */
export function buildSilo(mats: CelMaterialFactory, _p: BuildParams = {}, ctx?: BuildCtx): Structure {
  const b = new Build(mats, "silo");
  b.block({ w: DIA, h: H, d: DIA, x: 0, y: H / 2, z: 0 });

  // ---- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(DIA, DIA, H, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const lay = new Lay();
  // Emission order: what hides comes before what it hides.
  const iron = lay.m(IRON);
  const slate = lay.m(SLATE);
  const dark = lay.m(DARK_STONE);
  const stone = lay.m(STONE);

  const phi = TAU / 8 + Math.floor(rnd() * 4) * (TAU / 4);
  const side = rnd() < 0.5 ? -1 : 1;
  const sn = Math.sin(phi);
  const cs = Math.cos(phi);
  /** A point in a frame turned to bearing `beta`: `u` across it, `v` out along it. */
  const fr = (beta: number, u: number, v: number, y: number): V3 => {
    const s = Math.sin(beta);
    const c = Math.cos(beta);
    return [s * v + c * u, y, c * v - s * u];
  };
  const cp = (u: number, v: number, y: number): V3 => [sn * v + cs * u, y, cs * v - sn * u];
  const cdir = (u: number, v: number): V3 => [sn * v + cs * u, 0, cs * v - sn * u];

  // ---- the staves ------------------------------------------------------------
  const phase = (k: number): number => phi + (k % 2) * (SSTEP / 2);
  const corners = (k: number, j: number, inset = 0): [V3, V3, V3, V3] => {
    const a0 = phase(k) + (j - 0.5) * SSTEP;
    const a1 = a0 + SSTEP;
    const y0 = FOOT + k * CH;
    return [at(a0, R - inset, y0, KS), at(a1, R - inset, y0, KS), at(a1, R - TIP - inset, y0 + CH, KS), at(a0, R - TIP - inset, y0 + CH, KS)];
  };
  const normal = (k: number, j: number): V3 => {
    const am = phase(k) + j * SSTEP;
    return [Math.sin(am), TIP / CH, Math.cos(am)];
  };
  /** A point on stave facet (k, j), `u` across it and `v` up it, `off` proud of it. */
  const onStave = (k: number, j: number, u: number, v: number, off: number): V3 => {
    const [p00, p10, p11, p01] = corners(k, j);
    const n = normal(k, j);
    const o: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      o[i] = (1 - v) * ((1 - u) * p00[i] + u * p10[i]) + v * ((1 - u) * p01[i] + u * p11[i]) + n[i] * off;
    }
    return o;
  };
  const locate = (k: number, beta: number): { j: number; u: number } => {
    const t = round(beta, phase(k)) / SSTEP;
    const j = Math.round(t);
    return { j: ((j % NS) + NS) % NS, u: 0.5 + (t - j) };
  };
  /** Behind the chute or in the door column, where nothing is seen or spalls. */
  const chuteSide = (k: number, j: number): boolean => Math.abs(round(phase(k) + j * SSTEP, phi)) < 0.29;

  // Spalled staves: the face gone to the aggregate, a few centimetres deep.
  const lost = new Set<number>();
  const spall = (k: number, j: number): void => {
    j = ((j % NS) + NS) % NS;
    if (k >= 1 && k < COURSES - 1 && !chuteSide(k, j)) lost.add(k * NS + j);
  };
  for (let i = 4 + Math.floor(rnd() * 6); i > 0; i--) spall(1 + Math.floor(rnd() * (COURSES - 2)), Math.floor(rnd() * NS));
  const shelled = rnd() < 0.45;
  const hb = phi + (0.22 + rnd() * 0.56) * TAU;
  const kc = 3 + Math.floor(rnd() * 9);
  if (shelled) {
    for (let k = kc - 1; k <= kc + 1; k++) {
      const { j } = locate(k, hb);
      for (let dj = -2; dj <= 2; dj++) if ((k === kc && Math.abs(dj) < 2) || rnd() < 0.5) spall(k, j + dj);
    }
  }

  for (let k = 0; k < COURSES; k++) {
    const y0 = FOOT + k * CH;
    facets(stone, phase(k), R, y0, R - TIP, y0 + CH, (j) => lost.has(k * NS + j), NS);
    if (k > 0) disc(stone, NS, phase(k), R, R - 0.06, y0, false);
  }
  for (const key of lost) {
    const k = Math.floor(key / NS);
    const j = key % NS;
    const [p00, p10, p11, p01] = corners(k, j);
    const [i00, i10, i11, i01] = corners(k, j, 0.04);
    const a0 = phase(k) + (j - 0.5) * SSTEP;
    const a1 = a0 + SSTEP;
    dark.quad(i00, i10, i11, i01, normal(k, j));
    stone.quad(p00, p01, i01, i00, [Math.cos(a0), 0, -Math.sin(a0)]);
    stone.quad(p10, p11, i11, i10, [-Math.cos(a1), 0, Math.sin(a1)]);
    stone.quad(p00, p10, i10, i00, [0, 1, 0]);
    stone.quad(p01, p11, i11, i01, [0, -1, 0]);
  }

  /** A stain running down the face from `yTop` to `yBot`, tapering to a point. */
  const streak = (m: Mesher, beta: number, yTop: number, yBot: number, hw: number): void => {
    const uw = hw / FW;
    for (let k = Math.max(0, Math.floor((yBot - FOOT) / CH)); k <= Math.min(COURSES - 1, Math.floor((yTop - FOOT) / CH)); k++) {
      const y0 = FOOT + k * CH;
      const v0 = Math.max(0, (yBot - y0) / CH);
      const v1 = Math.min(1, (yTop - y0) / CH);
      if (v1 - v0 < 0.02) continue;
      const { j, u } = locate(k, beta);
      if (lost.has(k * NS + j)) continue;
      const lo = Math.max(0.02, u - uw);
      const hi = Math.min(0.98, u + uw);
      const tip = yBot >= y0;
      m.quad(
        onStave(k, j, tip ? u : lo, v0, 0.008),
        onStave(k, j, tip ? u : hi, v0, 0.008),
        onStave(k, j, hi, v1, 0.008),
        onStave(k, j, lo, v1, 0.008),
        normal(k, j),
      );
    }
  };
  // Damp from the eave, off the facet edges so a streak lies on one facet a course.
  for (let i = 5 + Math.floor(rnd() * 4); i > 0; i--) {
    const beta = phi + (Math.floor(rnd() * NS) + (rnd() < 0.5 ? -0.25 : 0.25)) * SSTEP;
    if (Math.abs(round(beta, phi)) < 0.4) continue;
    const top = H - 0.2 - rnd() * 0.4;
    streak(dark, beta, top, top - 1.2 - rnd() * 3, 0.03 + rnd() * 0.025);
  }

  // ---- the hoops and their lugs --------------------------------------------------
  const hoops: number[] = [];
  for (let k = 0; k < COURSES; k++) {
    const y0 = FOOT + k * CH;
    if (k < 5) hoops.push(y0 + 0.3 * CH, y0 + 0.8 * CH);
    else if (k < 11) hoops.push(y0 + 0.55 * CH);
    else if (k % 2) hoops.push(y0 + 0.5 * CH);
  }
  const lugTurn = Math.floor(rnd() * 3) * STEP;
  const lugs: { y: number; beta: number }[] = [];
  hoops.forEach((y, i) => {
    facets(iron, phi, R + 0.035, y - 0.016, R + 0.012, y + 0.016, (j) => j === 0);
    for (let m = 0; m < 3; m++) {
      const beta = phi + lugTurn + (1 + 2 * m) * (TAU / 6) + (i % 2 ? STEP : 0);
      lugs.push({ y, beta });
      const [x, , z] = at(beta, (R + 0.045) / K0, 0);
      lay.sb.box(0.17, 0.085, 0.05, x, y, z, IRON, { y: beta }, 1 << 5);
      if (y < 2.5) {
        for (const t of [-0.105, 0.105]) {
          const p = fr(beta, t, R + 0.05, y);
          lay.sb.box(0.04, 0.05, 0.04, p[0], y, p[2], IRON, { y: beta }, 1 << 5);
        }
      }
    }
  });
  for (let i = 3 + Math.floor(rnd() * 3); i > 0; i--) {
    const l = lugs[Math.floor(rnd() * lugs.length)];
    streak(iron, l.beta + (rnd() < 0.5 ? -0.25 : 0.25) * SSTEP, l.y - 0.05, l.y - 0.35 - rnd() * 1.1, 0.02 + rnd() * 0.02);
  }

  // ---- the door column, open below the chute ----------------------------------------
  const frameTop = 3.1;
  for (const s of [-1, 1]) {
    const p = cp(s * 0.29, R + 0.05, (FOOT + frameTop) / 2);
    lay.sb.box(0.07, frameTop - FOOT, 0.06, p[0], p[1], p[2], IRON, { y: phi }, 1 << 5);
  }
  for (let i = 0; i < 4; i++) {
    const base = FOOT + i * CH;
    const bh = (0.56 - 0.04) / 3;
    for (let n = 0; n < 3; n++) {
      const p = cp(0, R + 0.028, base + 0.09 + bh / 2 + n * (bh + 0.02));
      lay.sb.box(0.5, bh, 0.03, p[0], p[1], p[2], TIMBER, { y: phi }, 1 << 5);
    }
    const r = cp(0, R + 0.094, base + 0.737);
    lay.sb.box(0.62, 0.028, 0.028, r[0], r[1], r[2], IRON, { y: phi });
  }

  // ---- the chute: lapped sections of sheet, a U against the drum ----------------------
  const prof = (g: number): [number, number][] => {
    const w = CW + g;
    const out: [number, number][] = [[-w, CVB]];
    for (let t = 0; t <= 6; t++) {
      const th = Math.PI - (t * Math.PI) / 6;
      out.push([Math.cos(th) * w, CVC + Math.sin(th) * w]);
    }
    out.push([w, CVB]);
    return out;
  };
  const hintAt = (u: number, v: number, inward = false): V3 => {
    const d = cdir(u, v - 3.0);
    return inward ? [-d[0], 0, -d[2]] : d;
  };
  const SECTIONS = 8;
  const SL = (CHUTE_HEAD - CHUTE_FOOT) / SECTIONS;
  const big = prof(0.018);
  const small = prof(0);
  const tuck = prof(-0.006);
  for (let s = 0; s < SECTIONS; s++) {
    const y0 = CHUTE_FOOT + s * SL;
    const y1 = y0 + SL + 0.04;
    for (let i = 0; i + 1 < big.length; i++) {
      const mu = (small[i][0] + small[i + 1][0]) / 2;
      const mv = (small[i][1] + small[i + 1][1]) / 2;
      iron.quad(cp(...big[i], y0), cp(...big[i + 1], y0), cp(...small[i + 1], y1), cp(...small[i], y1), hintAt(mu, mv));
      iron.quad(cp(...big[i], y0), cp(...big[i + 1], y0), cp(...tuck[i + 1], y0), cp(...tuck[i], y0), [0, -1, 0]);
    }
  }
  // Its open foot: the sheet's inside, and the dark of the chute above it.
  const capY = 3.05;
  for (let i = 0; i + 1 < tuck.length; i++) {
    const mu = (tuck[i][0] + tuck[i + 1][0]) / 2;
    const mv = (tuck[i][1] + tuck[i + 1][1]) / 2;
    iron.quad(cp(...tuck[i], CHUTE_FOOT), cp(...tuck[i + 1], CHUTE_FOOT), cp(...tuck[i + 1], capY), cp(...tuck[i], capY), hintAt(mu, mv, true));
    iron.tri(cp(0, 3.25, capY), cp(...tuck[i], capY), cp(...tuck[i + 1], capY), [0, -1, 0]);
  }

  // ---- the hood the chute climbs into, and its filling door ---------------------------
  const hood: [number, number][] = [
    [2.2, 12.65],
    [2.9, 11.95],
    [3.92, 11.95],
    [3.92, 12.85],
    [2.2, 13.55],
  ];
  convexSolid(
    b,
    hood.map(([v, y]) => cp(-0.56, v, y)),
    hood.map(([v, y]) => cp(0.56, v, y)),
    IRON,
  );
  {
    const p = cp(0, 3.935, 12.38);
    lay.sb.box(0.6, 0.6, 0.03, p[0], p[1], p[2], TIMBER, { y: phi }, 1 << 5);
    for (const y of [12.2, 12.56]) {
      const q = cp(-0.12, 3.955, y);
      lay.sb.box(0.36, 0.04, 0.012, q[0], q[1], q[2], IRON, { y: phi }, 1 << 5);
    }
  }

  // ---- the roof: a steel dome on a skirt, ribbed at its seams --------------------------
  facets(slate, phi, EAVE, H - 0.16, EAVE, H);
  disc(slate, N, phi, EAVE, R - 0.06, H - 0.16, false);
  const RINGS = 6;
  const th0 = Math.asin(EAVE / RHO);
  const th1 = Math.asin(0.42 / RHO);
  const ring: [number, number][] = [];
  for (let i = 0; i <= RINGS; i++) {
    const th = th0 + ((th1 - th0) * i) / RINGS;
    ring.push([RHO * Math.sin(th), YC + RHO * Math.cos(th)]);
  }
  for (let i = 0; i < RINGS; i++) facets(slate, phi, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
  disc(slate, N, phi, ring[RINGS][0], 0, ring[RINGS][1]);
  for (let m = 0; m < N; m += 2) {
    const beta = phi + (m + 0.5) * STEP;
    for (let i = 0; i < RINGS; i++) {
      const [r0, y0] = ring[i];
      const [r1, y1] = ring[i + 1];
      const len = Math.hypot(r1 - r0, y1 - y0);
      const nr = ((y1 - y0) / len) * 0.016;
      const ny = (-(r1 - r0) / len) * 0.016;
      rod(lay, fr(beta, 0, r0 * K0 + nr, y0 + ny), fr(beta, 0, r1 * K0 + nr, y1 + ny), 0.04, SLATE);
    }
  }
  // The roof ladder, from the hood's back up to the vent.
  {
    const rail = (u: number, v: number): V3 => cp(u, v, domeY(Math.hypot(u, v)) + 0.075);
    const vs = [2.15, 1.8, 1.45, 1.1, 0.75];
    for (const u of [-0.2, 0.2]) {
      for (let i = 0; i + 1 < vs.length; i++) rod(lay, rail(u, vs[i]), rail(u, vs[i + 1]), 0.035, IRON);
      for (const v of [2.0, 1.2]) rod(lay, rail(u, v), cp(u, v, domeY(Math.hypot(u, v)) - 0.02), 0.025, IRON);
    }
    for (let v = 2.05; v > 0.8; v -= 0.3) rod(lay, rail(-0.2, v), rail(0.2, v), 0.025, IRON);
  }
  // The vent: a collar on the crown, a hat on four legs or a plain cap, and the rod.
  {
    const top = ring[RINGS][1];
    const up: V3 = [0, 1, 0];
    eye(slate, [0, top - 0.02, 0], up, 0.4, 0.4, 0.2, 12, true);
    let tip = top + 0.18;
    if (rnd() < 0.7) {
      eye(slate, [0, top + 0.3, 0], up, 0.62, 0.05, 0.3, 12, true, true);
      for (let m = 0; m < 4; m++) {
        const a = phi + (m * TAU) / 4;
        rod(lay, [Math.sin(a) * 0.33, top + 0.17, Math.cos(a) * 0.33], [Math.sin(a) * 0.33, top + 0.31, Math.cos(a) * 0.33], 0.03, SLATE);
      }
      tip = top + 0.6;
    }
    rod(lay, [0, tip - 0.05, 0], [0, tip + 0.9, 0], 0.022, IRON);
  }

  // ---- the blower pipe, beside the chute ---------------------------------------------
  {
    const pu = side * PIPE_U;
    const pt = (v: number, y: number): V3 => cp(pu, v, y);
    const runs = [1.2, 3.9, 6.7, 9.5, 12.45];
    for (let i = 0; i + 1 < runs.length; i++) log(iron, pt(PIPE_V, runs[i]), pt(PIPE_V, runs[i + 1]), 0.11, 8);
    for (const y of runs.slice(1, -1)) eye(iron, pt(PIPE_V, y - 0.03), [0, 1, 0], 0.14, 0.14, 0.06, 8, true, true);
    // Its foot turns out to the flange the blower is coupled to.
    log(iron, pt(PIPE_V, 1.24), pt(3.34, 0.92), 0.11, 8);
    const out: V3 = cdir(0, 0.09);
    const fd: V3 = [out[0], -0.32, out[2]];
    eye(iron, pt(3.34, 0.92), fd, 0.16, 0.16, 0.04, 8, true, true);
    // Clamped back to the drum.
    for (const y of [2.6, 5.3, 8.1, 10.9]) {
      eye(iron, pt(PIPE_V, y - 0.025), [0, 1, 0], 0.125, 0.125, 0.05, 8, true, true);
      rod(lay, pt(PIPE_V - 0.12, y), pt(Math.sqrt(R * R - PIPE_U * PIPE_U) - 0.06, y), 0.045, IRON);
    }
    // The gooseneck over into the hood's side.
    let prev = pt(PIPE_V, 12.4);
    for (let t = 1; t <= 3; t++) {
      const th = (t * Math.PI) / 6;
      const next = cp(side * (0.55 + 0.2 * Math.cos(th)), PIPE_V, 12.45 + 0.2 * Math.sin(th));
      log(iron, prev, next, 0.11, 8);
      prev = next;
    }
  }

  // ---- the footing, carried down; the apron at the chute's foot -----------------------
  let low = 0;
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12;
    low = Math.min(low, ground(Math.sin(a) * 3.2, Math.cos(a) * 3.2));
  }
  facets(dark, phi, PLINTH, low - 0.12, PLINTH, FOOT);
  disc(dark, N, phi, PLINTH, R - 0.06, FOOT);
  {
    const pts = [cp(-0.5, 3.05, 0), cp(0.5, 3.05, 0), cp(0.5, 3.85, 0), cp(-0.5, 3.85, 0)].map((p) => ground(p[0], p[2]));
    const top = Math.max(...pts) + 0.06;
    const bot = Math.min(...pts) - 0.08;
    const p = cp(0, 3.45, (top + bot) / 2);
    lay.sb.box(1.0, top - bot, 0.8, p[0], p[1], p[2], DARK_STONE, { y: phi });
  }

  // ---- what lies at its foot ---------------------------------------------------------
  if (shelled) {
    // The pocks round the bite, and what it knocked off lying under it.
    for (let i = 14 + Math.floor(rnd() * 10); i > 0; i--) {
      const k = Math.max(1, Math.min(COURSES - 1, kc + Math.round((rnd() - 0.5) * 5)));
      const { j, u } = locate(k, hb + (rnd() - 0.5) * 0.55);
      if (lost.has(k * NS + j)) continue;
      const w = (0.02 + rnd() * 0.025) / FW;
      const h = (0.02 + rnd() * 0.025) / CH;
      const uu = Math.max(0.03 + w, Math.min(0.97 - w, u));
      const vv = 0.06 + rnd() * 0.88;
      dark.quad(
        onStave(k, j, uu, vv - h, 0.008),
        onStave(k, j, uu + w, vv, 0.008),
        onStave(k, j, uu, vv + h, 0.008),
        onStave(k, j, uu - w, vv, 0.008),
        normal(k, j),
      );
    }
    for (let i = 4 + Math.floor(rnd() * 4); i > 0; i--) {
      const beta = hb + (rnd() - 0.5) * 0.5;
      const w = 0.12 + rnd() * 0.3;
      const h = 0.05 + rnd() * 0.04;
      const d = 0.1 + rnd() * 0.16;
      // Inside the footprint the generators lay by (`FOOT`), however it lies.
      const room = (3.2 - Math.hypot(w, d) / 2) / Math.max(Math.abs(Math.sin(beta)), Math.abs(Math.cos(beta)));
      const reach = Math.min(3.3 + rnd() * 1.1, room);
      const x = Math.sin(beta) * reach;
      const z = Math.cos(beta) * reach;
      lay.sb.box(w, h, d, x, ground(x, z) + h * 0.3, z, STONE, { y: rnd() * TAU, z: (rnd() - 0.5) * 0.4 });
    }
  }
  if (rnd() < 0.55) {
    // Spare staves stacked on two bearers in another corner.
    const beta = phi + (1 + Math.floor(rnd() * 3)) * (TAU / 4);
    const yaw = beta + (rnd() - 0.5) * 0.1;
    const g = Math.min(...[-0.4, 0.4].flatMap((u) => [3.3, 4.0].map((v) => fr(beta, u, v, 0))).map((p) => ground(p[0], p[2])));
    for (const v of [3.37, 3.93]) {
      const p = fr(beta, 0, v, g + 0.02);
      lay.sb.box(0.9, 0.06, 0.07, p[0], p[1], p[2], TIMBER, { y: yaw });
    }
    const layers = 2 + Math.floor(rnd() * 3);
    for (let l = 0; l < layers; l++) {
      const count = l + 1 === layers && rnd() < 0.5 ? 2 : 3;
      for (let s = 0; s < count; s++) {
        const p = fr(beta, (s - 1) * 0.26 + (rnd() - 0.5) * 0.03, 3.65 + (rnd() - 0.5) * 0.04, g + 0.085 + l * 0.067);
        lay.sb.box(0.25, 0.065, 0.76, p[0], p[1], p[2], STONE, { y: yaw + (rnd() - 0.5) * 0.06 });
      }
    }
  }

  lay.flush(b);
  return b;
}
