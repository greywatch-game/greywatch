/**
 * kit/buildings/rubble.ts — The burnt cottage's drawing: random rubble laid in
 * courses over a core set back behind the collider's face, dressed ashlar and
 * its edges, the wall heads, the teeth, the footing, the fallen heap and the
 * ivy — the words `buildRuin` is drawn in.
 * Invariants: VISUAL only — the block at the top of `buildRuin` is every
 * collider the ruin has, and nothing here may add one.
 */
import {
  Build,
  type Point3,
  StoneBatch,
  HIDE_UNDER,
  hideBack,
  carve,
  convexSolid,
  outward,
  type Hole,
  type Side,
  slab,
  CREEPER,
  DARK_STONE,
  DIRT,
  MOSS_STONE,
  STONE,
  TIMBER,
} from "../core";

// The words `buildRuin` is drawn in: random rubble laid in courses over a core
// set back behind the collider's face, so every joint between two stones is a
// step the ink finds. Everything they make is VISUAL — the block at the top of
// `buildRuin` is every collider the ruin has, and nothing here may add one.

/** How far a rubble stone's face stands proud of the collider's, at most. */
const RUBBLE_PROUD = 0.03;
/**
 * How far the core between the stones stands BEHIND the collider's face: the
 * depth of a joint. Flush, a wall is a grey box with lines on it; this far
 * back, every stone is its own step and the ink draws round it.
 */
export const RUBBLE_BACK = 0.04;
/** A face stone's depth front to back; its back is buried in the core. */
const RUBBLE_DEEP = 0.08;
/** The mortar joint between two stones, bed and perpend alike. */
const RUBBLE_JOINT = 0.025;

/**
 * Courses from `y0` to `y1`, each `h0` plus up to `hs` high and the last one
 * fitted to the head. Both faces of a wall are laid to ONE list, which is what
 * lets a tooth at a break be a through-stone in the course either face shows,
 * and two walls meeting at a corner share one so its dressed stones cross.
 */
export function rubbleCourses(y0: number, y1: number, rnd: () => number, h0 = 0.17, hs = 0.12): [number, number][] {
  const out: [number, number][] = [];
  for (let y = y0; y1 - y > 0.02; ) {
    let h = h0 + rnd() * hs;
    if (y1 - (y + h) < h0 * 0.7) h = y1 - y;
    out.push([y, y + h]);
    y += h;
  }
  return out;
}

/** One face of rubble, and what is left unlaid in it. */
interface RubbleFace {
  s: Side;
  /** The collider's face, as a signed coordinate on the side's own axis. */
  at: number;
  u0: number;
  u1: number;
  courses: readonly [number, number][];
  /** A face whose head steps down lays each course only along the run standing that high. */
  extent?: (c1: number) => [number, number];
  /** What a course leaves unlaid its whole height: the dressed stones at a corner or a jamb. */
  cut?: (k: number) => [number, number][];
  /** Openings, pockets and the masses standing against the face; stones are cut round them both ways. */
  holes?: readonly Hole[];
  /** The chance a stone at (u, y) is blackened: how far the fire reached up an inside face. */
  soot?: (u: number, y: number) => number;
  /** The ground along the face; the first course is carried down to it. */
  ground?: (u: number) => number;
  /** Smaller stones: the later infill of a blocked opening. */
  small?: boolean;
}

/**
 * Random rubble on one face, a course at a time: stones of uneven length, each
 * standing a different distance proud and leaning a little in its bed, so the
 * face is a field of small planes the bands catch one by one rather than one
 * plane with a pattern on it. Cut round the holes exactly.
 */
export function rubbleFace(sb: StoneBatch, f: RubbleFace, rnd: () => number): void {
  const plane = outward(f.s) * f.at;
  const hide = hideBack(f.s) | HIDE_UNDER;
  const [lo, span] = f.small ? [0.14, 0.14] : [0.3, 0.42];
  const holes = f.holes ?? [];
  // Each stone is turned a little about the vertical as well as in its bed,
  // so its face is a plane of its own that the key light finds at its own
  // angle; laid square to the wall, a course read as a row of bricks. A
  // stone short of its bed sits anywhere in it, which is what varies the
  // joints.
  const stone = (ua: number, ub: number, y0: number, y1: number): void => {
    const um = (ua + ub) / 2;
    const short = rnd() < 0.4 ? rnd() * 0.05 : 0;
    const tall = y1 - y0 - short;
    const y = y0 + tall / 2 + short * rnd();
    const soot = f.soot?.(um, y) ?? 0;
    const color = rnd() < soot + 0.07 ? DARK_STONE : rnd() < 0.28 ? STONE : MOSS_STONE;
    const proud = 0.008 + rnd() * (RUBBLE_PROUD - 0.008);
    sb.onFace(f.s, plane, um, y, ub - ua, tall, RUBBLE_DEEP, proud - RUBBLE_DEEP / 2, color, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.12, hide);
  };
  for (let k = 0; k < f.courses.length; k++) {
    const [c0, c1] = f.courses[k];
    const [e0, e1] = f.extent?.(c1) ?? [f.u0, f.u1];
    if (e1 - e0 < 0.08) continue;
    const cuts = f.cut?.(k) ?? [];
    const y0 = c0 + RUBBLE_JOINT / 2;
    const y1 = c1 - RUBBLE_JOINT / 2;
    // The first stone of every course is cut short by its own amount, so no
    // perpend runs up two courses.
    let len = lo * (0.3 + rnd() * 0.9);
    for (let u = e0; u < e1 - 0.04; ) {
      if (e1 - (u + len) < lo * 0.5) len = e1 - u;
      const a = u;
      u += len;
      len = lo + rnd() * span;
      for (const [p0, p1] of carve(a, u, cuts)) {
        const over = holes.filter((h) => h.u1 > p0 && h.u0 < p1 && h.y1 > y0 && h.y0 < y1);
        const edges = [p0, p1];
        for (const h of over) for (const e of [h.u0, h.u1]) if (e > p0 && e < p1) edges.push(e);
        edges.sort((m, n) => m - n);
        for (let i = 0; i + 1 < edges.length; i++) {
          const [q0, q1] = [edges[i], edges[i + 1]];
          if (q1 - q0 < 0.08) continue;
          const qm = (q0 + q1) / 2;
          const inHole = over.filter((h) => qm > h.u0 && qm < h.u1).map((h): [number, number] => [h.y0, h.y1]);
          const bot = k === 0 && f.ground ? Math.min(y0, f.ground(qm) - 0.05) : y0;
          for (const [r0, r1] of carve(bot, y1, inHole)) {
            if (r1 - r0 < 0.06) continue;
            stone(q0 + RUBBLE_JOINT / 2, q1 - RUBBLE_JOINT / 2, r0 > bot ? r0 + RUBBLE_JOINT / 2 : r0, r1 < y1 ? r1 - RUBBLE_JOINT / 2 : r1);
          }
        }
      }
    }
  }
}

/**
 * Squared stone in level courses: the stack above the eaves, which was built
 * to be seen and so is the one part of this house that is not rubble.
 */
export function ashlarFace(
  sb: StoneBatch,
  s: Side,
  at: number,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  rnd: () => number,
  soot: (y: number) => number,
): void {
  const plane = outward(s) * at;
  const n = Math.max(1, Math.round((y1 - y0) / 0.3));
  const ch = (y1 - y0) / n;
  for (let k = 0; k < n; k++) {
    const y = y0 + (k + 0.5) * ch;
    let len = 0.22 + rnd() * 0.2 + (k % 2) * 0.18;
    for (let u = u0; u < u1 - 0.05; ) {
      if (u1 - (u + len) < 0.2) len = u1 - u;
      const color = rnd() < soot(y) + 0.05 ? DARK_STONE : STONE;
      sb.onFace(s, plane, u + len / 2, y, len - 0.015, ch - 0.015, 0.06, -0.01, color, 0, 0, hideBack(s));
      u += len;
      len = 0.4 + rnd() * 0.25;
    }
  }
}

/**
 * Dressed stones up an arris — a corner or a jamb — long and short in turn,
 * and crossed at the arris with the face round it (`parity` 0 on one, 1 on the
 * other); the long one runs on over the other face's so the edge is closed.
 * Squared, a step paler than the rubble and standing further out of it: what
 * says this edge was BUILT, where every other end of this ruin is a break.
 * Returns the run each course's stone takes, for the rubble to be cut round.
 */
export function dressedEdge(
  sb: StoneBatch,
  s: Side,
  at: number,
  corner: number,
  dir: 1 | -1,
  courses: readonly [number, number][],
  parity: 0 | 1,
  long = 0.5,
  short = 0.28,
): (k: number) => [number, number][] {
  const plane = outward(s) * at;
  const lens = courses.map((_, k) => ((k + parity) % 2 === 0 ? long : short));
  courses.forEach(([c0, c1], k) => {
    const lap = lens[k] === long ? 0.035 : 0;
    const len = lens[k] + lap;
    sb.onFace(s, plane, corner + dir * (len / 2 - lap), (c0 + c1) / 2, len - 0.012, c1 - c0 - 0.012, 0.1, -0.015, STONE, 0, 0, hideBack(s));
  });
  return (k) => {
    const e = corner + dir * (lens[k] + 0.01);
    return [[Math.min(corner, e), Math.max(corner, e)]];
  };
}

/**
 * The broken head of a rubble wall: through-stones standing on the collider's
 * top, as many courses at each point as `ks` says with some noise on it, so a
 * head is a torn stepped line and never a ruled one; moss where it settled.
 */
export function rubbleHead(
  sb: StoneBatch,
  alongX: boolean,
  c: number,
  u0: number,
  u1: number,
  y: number,
  width: number,
  ks: (u: number) => number,
  rnd: () => number,
): void {
  const put = (l: number, hh: number, wd: number, u: number, yc: number, off: number, color: string, yaw: number): void => {
    if (alongX) sb.box(l, hh, wd, u, yc, c + off, color, { y: yaw }, HIDE_UNDER);
    else sb.box(wd, hh, l, c + off, yc, u, color, { y: yaw }, HIDE_UNDER);
  };
  for (let u = u0; u < u1 - 0.05; ) {
    const len = Math.min(u1 - u, 0.28 + rnd() * 0.4);
    const um = u + len / 2;
    u += len;
    const k = Math.max(0, Math.round(ks(um) + (rnd() - 0.5) * 1.2));
    let top = y;
    for (let i = 0; i < k; i++) {
      const hh = 0.13 + rnd() * 0.1;
      const l = (len - RUBBLE_JOINT) * (1 - i * 0.16) * (0.82 + rnd() * 0.18);
      const color = rnd() < 0.3 ? STONE : rnd() < 0.1 ? DARK_STONE : MOSS_STONE;
      put(l, hh, width + 0.02 - i * 0.06 - rnd() * 0.05, um + (rnd() - 0.5) * (len - l), top + hh / 2, (rnd() - 0.5) * 0.06, color, (rnd() - 0.5) * 0.12);
      top += hh;
    }
    if (rnd() < 0.35) {
      put(len * (0.4 + rnd() * 0.5), 0.03, width * (0.45 + rnd() * 0.4), um, top + 0.012, (rnd() - 0.5) * 0.1, CREEPER, (rnd() - 0.5) * 0.4);
    }
  }
}

/**
 * The free end of a rubble wall: through-stones run on past the break in
 * alternate courses, the way a wall comes apart along its bond. The
 * collider's end is square and these stand past it — the honest side of the
 * trade: a round aimed at a tooth passes.
 */
export function rubbleTeeth(
  sb: StoneBatch,
  alongX: boolean,
  c: number,
  width: number,
  uEnd: number,
  dir: 1 | -1,
  courses: readonly [number, number][],
  rnd: () => number,
): void {
  courses.forEach(([c0, c1], k) => {
    const reach = k % 2 === 0 ? 0.1 + rnd() * 0.16 : rnd() < 0.3 ? 0.05 + rnd() * 0.06 : 0;
    if (reach < 0.04) return;
    const len = reach + 0.06;
    const u = uEnd + (dir * (reach - 0.06)) / 2;
    const hh = c1 - c0 - RUBBLE_JOINT;
    const wd = width + 0.02 - rnd() * 0.06;
    const color = rnd() < 0.3 ? STONE : MOSS_STONE;
    const yaw = { y: (rnd() - 0.5) * 0.1 };
    if (alongX) sb.box(len, hh, wd, u, (c0 + c1) / 2, c, color, yaw);
    else sb.box(wd, hh, len, c, (c0 + c1) / 2, u, color, yaw);
  });
}

/**
 * Where a wall has gone altogether its footing is still there: a course or two
 * of stones along its line, low enough to step over, so the house keeps its
 * outline. Carried down to the ground under each stone.
 */
export function rubbleFooting(
  sb: StoneBatch,
  alongX: boolean,
  c: number,
  u0: number,
  u1: number,
  width: number,
  ground: (u: number) => number,
  rnd: () => number,
): void {
  for (let u = u0; u < u1 - 0.1; ) {
    const len = Math.min(u1 - u, 0.3 + rnd() * 0.35);
    const um = u + len / 2;
    u += len;
    const k = rnd() < 0.15 ? 0 : rnd() < 0.55 ? 1 : 2;
    let top = ground(um) - 0.05;
    for (let i = 0; i < k; i++) {
      const hh = 0.1 + rnd() * 0.05;
      const l = (len - RUBBLE_JOINT) * (1 - i * 0.2);
      const wd = width - i * 0.08 - rnd() * 0.06;
      const off = (rnd() - 0.5) * 0.08;
      const color = rnd() < 0.3 ? STONE : MOSS_STONE;
      const yaw = { y: (rnd() - 0.5) * 0.15 };
      if (alongX) sb.box(l, hh, wd, um, top + hh / 2, c + off, color, yaw, HIDE_UNDER);
      else sb.box(wd, hh, l, c + off, top + hh / 2, um, color, yaw, HIDE_UNDER);
      top += hh;
    }
  }
}

/** Loose stones lying on the ground round (x, z): what fell off a head. */
export function rubbleScatter(
  sb: StoneBatch,
  x: number,
  z: number,
  r: number,
  n: number,
  ground: (lx: number, lz: number) => number,
  rnd: () => number,
): void {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const q = r * Math.sqrt(rnd());
    const sx = x + Math.cos(a) * q;
    const sz = z + Math.sin(a) * q;
    const hh = 0.1 + rnd() * 0.1;
    const color = rnd() < 0.3 ? STONE : MOSS_STONE;
    sb.box(0.2 + rnd() * 0.2, hh, 0.14 + rnd() * 0.14, sx, ground(sx, sz) + hh * 0.25, sz, color, {
      x: (rnd() - 0.5) * 0.5,
      y: rnd() * Math.PI,
      z: (rnd() - 0.5) * 0.5,
    });
  }
}

/**
 * A heap of what came down, over a collider box `hw` by `hd` and `h` high: a
 * mound cut to CONTAIN the box — its crown the box's top and a little over,
 * the box's corners on the crown's chamfers — spreading past it onto the
 * ground, in earth and ash with stones and a charred rafter or two on it.
 */
export function rubbleHeap(
  b: Build,
  sb: StoneBatch,
  cx: number,
  cz: number,
  hw: number,
  hd: number,
  h: number,
  ground: (lx: number, lz: number) => number,
  rnd: () => number,
): void {
  const e = 0.06;
  const spread = 0.5;
  const top = h + 0.05;
  const ring = (m: number, y: (x: number, z: number) => number): Point3[] =>
    (
      [
        [hw + m, -hd],
        [hw + m, hd],
        [hw, hd + m],
        [-hw, hd + m],
        [-hw - m, hd],
        [-hw - m, -hd],
        [-hw, -hd - m],
        [hw, -hd - m],
      ] as const
    ).map(([x, z]): Point3 => [cx + x, y(cx + x, cz + z), cz + z]);
  convexSolid(b, ring(e, () => top), ring(spread, (x, z) => ground(x, z) - 0.05), DIRT);
  // A hump off-centre on the crown, so the heap is not a table.
  const ox = (rnd() - 0.5) * hw * 0.6;
  const oz = (rnd() - 0.5) * hd * 0.6;
  const hump = (sx: number, sz: number, y: number): Point3[] =>
    [
      [sx, -sz * 0.6],
      [sx, sz * 0.6],
      [sx * 0.6, sz],
      [-sx * 0.6, sz],
      [-sx, sz * 0.6],
      [-sx, -sz * 0.6],
      [-sx * 0.6, -sz],
      [sx * 0.6, -sz],
    ].map(([x, z]): Point3 => [cx + ox + x, y, cz + oz + z]);
  convexSolid(b, hump(hw * 0.7, hd * 0.7, top - 0.01), hump(hw * 0.35, hd * 0.3, top + 0.16), DIRT);

  const surface = (x: number, z: number): number => {
    const out = Math.max(Math.abs(x - cx) - hw - e, Math.abs(z - cz) - hd - e, 0) / (spread - e);
    return out >= 1 ? ground(x, z) : top + (ground(x, z) - top) * out;
  };
  const n = Math.round(16 + hw * hd * 12);
  for (let i = 0; i < n; i++) {
    const x = cx + (rnd() * 2 - 1) * (hw + spread * 0.8);
    const z = cz + (rnd() * 2 - 1) * (hd + spread * 0.8);
    const hh = 0.12 + rnd() * 0.12;
    const color = rnd() < 0.3 ? STONE : rnd() < 0.15 ? DARK_STONE : MOSS_STONE;
    sb.box(0.22 + rnd() * 0.28, hh, 0.18 + rnd() * 0.22, x, surface(x, z) + hh * 0.2, z, color, {
      x: (rnd() - 0.5) * 0.5,
      y: rnd() * Math.PI,
      z: (rnd() - 0.5) * 0.5,
    });
  }
  for (let i = 0; i < 2; i++) {
    const a = rnd() * Math.PI * 2;
    const from: Point3 = [cx + (rnd() - 0.5) * hw, top + 0.1, cz + (rnd() - 0.5) * hd];
    const far = Math.max(hw, hd) + 0.9 + rnd() * 0.6;
    const tx = cx + Math.cos(a) * far;
    const tz = cz + Math.sin(a) * far;
    slab(b, from, [tx, ground(tx, tz) + 0.05, tz], 0.1, 0.13, TIMBER);
  }
}

/**
 * Ivy up a face from its foot: a few stems wandering upward, leaves thick at
 * the foot and thinning toward where each stem gave out. The shaded front of
 * a ruin in a wet country always carries some.
 */
export function ivy(
  sb: StoneBatch,
  s: Side,
  at: number,
  u: number,
  spread: number,
  height: number,
  ground: (u: number) => number,
  rnd: () => number,
): void {
  const plane = outward(s) * at;
  const stems = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < stems; i++) {
    let su = u + (rnd() - 0.5) * spread;
    let y = ground(su);
    const reach = height * (0.45 + rnd() * 0.55);
    let side = 1;
    while (y < reach) {
      const step = 0.14 + rnd() * 0.08;
      const lean = (rnd() - 0.5) * 0.12;
      sb.onFace(s, plane, su + lean / 2, y + step / 2, 0.022, step + 0.02, 0.02, RUBBLE_PROUD + 0.012, CREEPER, 0, 0, hideBack(s));
      for (let j = 0; j < 2; j++) {
        if (rnd() > 1 - 0.5 * (y / reach)) continue;
        sb.onFace(s, plane, su + side * (0.05 + rnd() * 0.05), y + step * rnd(), 0.1 + rnd() * 0.05, 0.08 + rnd() * 0.04, 0.018, RUBBLE_PROUD + 0.03 + rnd() * 0.03, CREEPER, side * (0.3 + rnd() * 0.6), 0, hideBack(s));
        side = -side;
      }
      su += lean;
      y += step;
    }
  }
}
