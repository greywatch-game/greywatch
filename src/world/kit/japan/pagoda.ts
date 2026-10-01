/**
 * kit/japan/pagoda.ts — buildPagoda: the painted five-storey pagoda, the
 * valley's landmark.
 * Part of the temple-town set: follows the contract in kit/core.ts and the
 * set's rules in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Side,
  type Structure,
  HIDE_UNDER,
  StoneBatch,
  VERDIGRIS,
  convexSolid,
  hideBack,
  limb,
  orient,
  outward,
  runsAlongX,
  streetSeed,
} from "../core";
import {
  BRONZE,
  GILT_GLOW,
  GRANITE,
  GRANITE_DARK,
  HINOKI,
  KAWARA,
  KAWARA_DARK,
  SHIKKUI,
  SHU,
  SUMI,
} from "./palette";
import { curvedRoof, roofHeight, type RoofSpec } from "./roof";

/**
 * The FIVE-STOREY PAGODA (gojū-no-tō): the valley's landmark, twenty-eight
 * metres of it, and the one thing on the map you can see from every flag.
 *
 * It is drawn as a painted Edo-period pagoda — Kiyomizu's colours on Tō-ji's
 * five storeys — and every detail follows from how one is built:
 *
 * - **The podium** is dan-jō-zumi: a ground course, granite posts at even
 *   bays with the panels between them set back, and a coping course over it;
 *   the top is laid in flags, and a flight of two steps meets the middle of
 *   each face. It is carried down to the ground under it.
 * - **Each storey** is three bays a side: round vermilion pillars on the
 *   faces, a sill, the door-head nageshi and the head tie whose ends run on
 *   past the corners. The ground storey's doors stand open on the two faces
 *   the courtyard sees (±X) with the lamp inside showing, and are shut
 *   panelled doors on the other two with the lamp showing through their
 *   lattice; the upper storeys have boarded doors. Every side bay has a
 *   renji window — green bars on the diagonal in a vermilion frame.
 * - **Under every eave** is the bracket band on a white wall: a plate on the
 *   pillar heads, a bearing block on each pillar, arms along the wall and out
 *   from it carrying small blocks, a frog-leg strut in each bay, a diagonal
 *   arm at the corners, and the eave purlin the rafters rest on. The rafters
 *   are two layers, base and flying, parallel and cut against the hip beam
 *   at each corner, their ends painted; the hip beam carries a wind bell.
 * - **Each roof** is tiled in rows of round tiles with an end tile at the
 *   eave, a hip ridge down each corner banded in white under a round cap, a
 *   demon tile where it turns up and a short ridge on to the corner.
 * - **Each upper storey** stands on a balcony: a floor on small brackets
 *   over the roof below and a railing of posts, three rails crossed at the
 *   corners and struts between.
 * - **The spire** (sōrin): the dew basin, the inverted bowl, the lotus, the
 *   nine rings, the water flame, the dragon car and the jewel — and four
 *   chains from under the flame down to the corners of the top roof.
 *
 * **The colliders are the ones the pagoda always had, in the same order**:
 * the plinth, the five storeys, then the five roofs (walked first — see the
 * kit header). Only the plinth is walked; the storeys are solid, because a
 * pagoda has no floors to stand on and a perch over every flag with one stair
 * up it is a problem. Everything on the plinth is flat on a face or under
 * 0.3 m; everything else is overhead or stands on a collider.
 *
 * It reads the ground (`BuildCtx`) to carry its podium and its steps down,
 * and seeds the podium's stone lengths off where it stands — which is what
 * puts `pagoda` in `CONFORMS_TO_TERRAIN`.
 */
export function buildPagoda(
  scene: Scene,
  mats: CelMaterialFactory,
  _p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "pagoda");
  const plinthH = 0.55;
  const base = 6.2;

  // --- colliders, exactly as they were: the plinth, the storeys, the roofs --
  b.block({ w: base + 4.4, h: plinthH, d: base + 4.4, x: 0, y: plinthH / 2, z: 0 });
  interface Tier {
    i: number;
    bw: number;
    hb: number;
    /** The storey's foot. */
    y0: number;
    eave: number;
    roof: RoofSpec;
  }
  const tiers: Tier[] = [];
  let y = plinthH;
  for (let i = 0; i < 5; i++) {
    const bw = base - 0.55 * i;
    const hb = i === 0 ? 3.6 : 2.1;
    b.block({ w: bw, h: hb, d: bw, x: 0, y: y + hb / 2, z: 0 });
    const eave = y + hb + 0.45;
    const next = i < 4 ? base - 0.55 * (i + 1) : 0.7;
    tiers.push({
      i,
      bw,
      hb,
      y0: y,
      eave,
      roof: {
        y: eave,
        ex: bw / 2 + 2.0,
        ez: bw / 2 + 2.0,
        tx: next / 2,
        tz: next / 2,
        rise: i < 4 ? 1.25 : 2.6,
        curve: 1.6,
        upturn: 0.6,
        thick: 0.34,
        rings: 5,
        seg: 6,
      },
    });
    y = eave + 0.95;
  }
  // Roofs last (see the kit header).
  for (const t of tiers) {
    b.block({ w: t.bw + 4.0, h: 0.3, d: t.bw + 4.0, x: 0, y: t.eave, z: 0 });
  }

  // --- everything below is drawing -------------------------------------------
  const plinthW = base + 4.4;
  const PH = plinthW / 2;
  const rnd = mulberry32(streetSeed(plinthW, plinthW, 28, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  let foot = 0;
  for (const gx of [-1, 0, 1]) {
    for (const gz of [-1, 0, 1]) {
      if (gx || gz) foot = Math.min(foot, ground(gx * (PH + 0.9), gz * (PH + 0.9)));
    }
  }
  foot -= 0.08;

  const sb = new StoneBatch();
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  const CORNERS = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  /** Plan point `n` out from the centre on side `s`, `u` along it. */
  const at = (s: Side, u: number, n: number): [number, number] =>
    runsAlongX(s) ? [u, outward(s) * n] : [outward(s) * n, u];
  // A member laid from `a` to `c` along its own Z hides these faces.
  const TOP = 1 << 2;
  const START = 1 << 5;
  const END = 1 << 4;
  const member = (a: Point3, c: Point3, wide: number, deep: number, color: string, hide = 0): void => {
    const o = orient(a, c);
    sb.box(wide, deep, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot, hide);
  };
  /** A painted end: one face, 1.5 cm past `c`, square to the member from `a`. */
  const endFace = (a: Point3, c: Point3, wide: number, deep: number, color: string): void => {
    const o = orient(a, c);
    const k = 0.015 / o.len;
    sb.box(
      wide,
      deep,
      0.01,
      c[0] + (c[0] - a[0]) * k,
      c[1] + (c[1] - a[1]) * k,
      c[2] + (c[2] - a[2]) * k,
      color,
      o.rot,
      63 & ~END,
    );
  };
  /** A member on side `s`'s face `plane`, its back left out. */
  const face = (
    s: Side,
    plane: number,
    u: number,
    yc: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
  ): void => sb.onFace(s, plane, u, yc, along, tall, thick, out, color, 0, 0, hideBack(s));

  // --- the podium: dan-jō-zumi granite, carried down to the ground ----------
  const course = (s: Side, y0: number, y1: number, proud: number, run: number): void => {
    let u = -run;
    while (run - u > 0.05) {
      let len = 1.05 + rnd() * 0.6;
      if (run - (u + len) < 0.5) len = run - u;
      face(s, PH, u + len / 2, (y0 + y1) / 2, len - 0.02, y1 - y0, proud * 2, 0, GRANITE);
      u += len;
    }
  };
  const bays = 6;
  for (const s of SIDES) {
    course(s, foot, 0.1, 0.07, PH + 0.07);
    for (let k = 0; k <= bays; k++) {
      const edge = k === 0 || k === bays;
      const u = edge ? (k === 0 ? -1 : 1) * (PH - 0.06) : -PH + (k * plinthW) / bays;
      face(s, PH, u, 0.265, 0.24, 0.33, 0.12, 0, GRANITE);
      if (k < bays) {
        const u0 = -PH + (k * plinthW) / bays;
        face(s, PH, u0 + plinthW / bays / 2, 0.265, plinthW / bays - 0.2, 0.33, 0.05, 0, GRANITE);
      }
    }
    course(s, 0.43, 0.55, 0.08, PH + 0.08);
    // The flight: two treads in the middle of the face, carried down.
    for (const [top, deep] of [
      [0.15, 0.7],
      [0.3, 0.35],
    ] as const) {
      face(s, PH + 0.08, 0, (foot + top) / 2, 2.6, top - foot, deep, deep / 2, GRANITE);
    }
  }
  // The flags on top, in running bond, laid round the ground storey.
  {
    const inner = base / 2 - 0.05;
    const lim = PH - 0.08;
    const pitch = (lim * 2) / 14;
    for (let r = 0; r < 14; r++) {
      const zc = -lim + pitch * (r + 0.5);
      const spans: [number, number][] = Math.abs(zc) < inner
        ? [
            [-lim, -inner],
            [inner, lim],
          ]
        : [[-lim, lim]];
      for (const [a, c] of spans) {
        let x = a;
        if (r % 2 === 1 && c - a > 2) x += 0.3 + rnd() * 0.3;
        if (x > a) sb.box(x - a - 0.02, 0.05, pitch - 0.02, (a + x) / 2, plinthH - 0.025, zc, GRANITE, undefined, HIDE_UNDER);
        while (c - x > 0.05) {
          let len = 0.85 + rnd() * 0.45;
          if (c - (x + len) < 0.35) len = c - x;
          sb.box(len - 0.02, 0.05, pitch - 0.02, x + len / 2, plinthH - 0.025, zc, GRANITE, undefined, HIDE_UNDER);
          x += len;
        }
      }
    }
  }

  // --- the storeys -----------------------------------------------------------
  /** The side faces of a member on side `s`, turned by `yaw`, that look into the wall. */
  const facing = (s: Side, yaw: number): number => {
    const nx = runsAlongX(s) ? 0 : outward(s);
    const nz = runsAlongX(s) ? outward(s) : 0;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    let hide = 0;
    for (const [fx, fz, bit] of [
      [c, -sn, 1],
      [-c, sn, 1 << 1],
      [sn, c, 1 << 4],
      [-sn, -c, 1 << 5],
    ] as const) {
      if (fx * nx + fz * nz < -1e-6) hide |= bit;
    }
    return hide;
  };
  /** A renji window: a frame, a dark ground and green bars on the diagonal. */
  const renji = (s: Side, plane: number, u: number, yc: number, w: number, h: number): void => {
    face(s, plane, u, yc, w, h, 0.02, 0.01, SUMI);
    const n = Math.max(4, Math.round(w / 0.11));
    for (let k = 1; k < n; k++) {
      sb.onFace(s, plane, u - w / 2 + (w * k) / n, yc, 0.045, h, 0.045, 0.045, VERDIGRIS, 0, Math.PI / 4, TOP | HIDE_UNDER | facing(s, Math.PI / 4));
    }
    for (const su of [-1, 1]) face(s, plane, u + su * (w / 2 + 0.05), yc, 0.1, h + 0.2, 0.12, 0.06, SHU);
    face(s, plane, u, yc + h / 2 + 0.05, w, 0.1, 0.12, 0.06, SHU);
    face(s, plane, u, yc - h / 2 - 0.06, w + 0.3, 0.12, 0.16, 0.08, SHU);
  };
  /** A door frame: two jambs and a head, proud of the wall. */
  const doorFrame = (s: Side, plane: number, yb: number, w: number, h: number): void => {
    for (const su of [-1, 1]) face(s, plane, su * (w / 2 + 0.06), yb + h / 2, 0.12, h, 0.14, 0.07, SHU);
  };
  /** Shut boarded doors: two leaves of three boards, strapped, with ring pulls. */
  const itado = (s: Side, plane: number, yb: number, w: number, h: number): void => {
    face(s, plane, 0, yb + h / 2, w, h, 0.02, 0.01, SUMI);
    const lw = w / 2;
    for (const su of [-1, 1]) {
      const lu = su * (lw / 2);
      for (let k = 0; k < 3; k++) {
        face(s, plane, lu - lw / 2 + (lw / 3) * (k + 0.5), yb + h / 2, lw / 3 - 0.014, h - 0.02, 0.05, 0.025, SHU);
      }
      for (const yf of [0.22, 0.78]) face(s, plane, lu, yb + h * yf, lw - 0.1, 0.07, 0.02, 0.06, BRONZE);
      face(s, plane, su * 0.07, yb + h * 0.5, 0.06, 0.12, 0.03, 0.065, BRONZE);
    }
  };
  /** Shut panelled doors (sankarado): lattice over the lamp above, boards below. */
  const sankarado = (s: Side, plane: number, yb: number, w: number, h: number): void => {
    const lw = w / 2;
    const midY = yb + h * 0.42;
    const topY = yb + h;
    for (const su of [-1, 1]) {
      const lu = su * (lw / 2);
      const [gx, gz] = at(s, lu, plane + 0.012);
      const panelH = topY - midY - 0.2;
      const panelY = (midY + topY) / 2 - 0.01;
      if (runsAlongX(s)) b.glow(lw - 0.2, panelH, 0.02, gx, panelY, gz, GILT_GLOW);
      else b.glow(0.02, panelH, lw - 0.2, gx, panelY, gz, GILT_GLOW);
      face(s, plane, lu, (yb + midY) / 2, lw - 0.16, midY - yb, 0.04, 0.02, SHU);
      for (const e of [-1, 1]) face(s, plane, lu + e * (lw / 2 - 0.05), yb + h / 2, 0.1, h, 0.08, 0.04, SHU);
      for (const [yr, hr] of [
        [yb + 0.08, 0.16],
        [midY, 0.14],
        [topY - 0.06, 0.12],
      ] as const) {
        face(s, plane, lu, yr, lw - 0.2, hr, 0.08, 0.04, SHU);
      }
      for (let k = 1; k < 3; k++) face(s, plane, lu - (lw - 0.2) / 2 + ((lw - 0.2) * k) / 3, panelY, 0.035, panelH, 0.04, 0.045, SHU);
      for (let k = 1; k < 5; k++) face(s, plane, lu, midY + 0.07 + (panelH * k) / 5, lw - 0.2, 0.035, 0.04, 0.045, SHU);
      face(s, plane, su * 0.09, midY - 0.25, 0.07, 0.07, 0.03, 0.095, BRONZE);
    }
  };

  const ringPillars: [number, number, number][] = [];
  for (const t of tiers) {
    const half = t.bw / 2;
    const top = t.y0 + t.hb;
    const ground0 = t.i === 0;
    const floor = ground0 ? t.y0 : t.y0 + 0.15;
    const bay = t.bw / 3;
    // Pillars at the corners and either side of the middle bay, their centres
    // on the faces.
    const posts: [number, number][] = [];
    for (const [sx, sz] of CORNERS) posts.push([sx * half, sz * half]);
    for (const s of SIDES) for (const su of [-1, 1]) posts.push(at(s, (su * half) / 3, half));
    for (const [px, pz] of posts) {
      if (ground0) {
        b.cyl(t.hb, 0.4, 0.42, 10, px, t.y0 + t.hb / 2, pz, SHU);
        ringPillars.push([px, pz, 0.62]);
      } else {
        b.cyl(top - floor, 0.3, 0.3, 6, px, (floor + top) / 2, pz, SHU);
      }
    }
    for (const s of SIDES) {
      // The sill, the door-head nageshi and the head tie, whose ends run on
      // past the corner pillars.
      face(s, half, 0, floor + 0.1, t.bw + 0.1, 0.2, 0.12, 0.06, SHU);
      const doorH = ground0 ? 2.4 : 1.2;
      const doorB = floor + 0.2;
      const nageshi = doorB + doorH + 0.1;
      face(s, half, 0, nageshi, t.bw + 0.12, ground0 ? 0.2 : 0.14, 0.12, 0.06, SHU);
      face(s, half, 0, top - (ground0 ? 0.3 : 0.24), t.bw + 0.5, ground0 ? 0.2 : 0.16, 0.1, 0.05, SHU);
      // The middle bay's doors.
      const doorW = ground0 ? 1.6 : Math.min(1.1, bay - 0.45);
      doorFrame(s, half, doorB, doorW, doorH);
      if (!ground0) itado(s, half, doorB, doorW, doorH);
      else if (runsAlongX(s)) sankarado(s, half, doorB, doorW, doorH);
      else {
        const [gx, gz] = at(s, 0, half + 0.012);
        b.glow(0.02, doorH, doorW, gx, doorB + doorH / 2, gz, GILT_GLOW);
      }
      // A renji window in each side bay.
      const winW = ground0 ? 1.1 : Math.min(0.9, bay - 0.55);
      const winH = ground0 ? 1.0 : 0.72;
      const winY = nageshi - (ground0 ? 0.2 : 0.15) - winH / 2 - 0.08;
      for (const su of [-1, 1]) renji(s, half, (su * bay), winY, winW, winH);
    }
    if (!ground0) {
      // The balcony: a floor on small brackets over the roof below, an edge
      // beam, and a railing crossed at the corners.
      const rim = half + 0.6;
      sb.box(t.bw + 1.2, 0.1, t.bw + 1.2, 0, t.y0 + 0.1, 0, HINOKI);
      const railN = rim - 0.05;
      for (const s of SIDES) {
        face(s, rim, 0, t.y0 + 0.07, t.bw + 1.24, 0.16, 0.08, 0, SHU);
        const nb = Math.round((t.bw + 1.0) / 0.95);
        for (let k = 0; k <= nb; k++) {
          sb.onFace(s, rim, -half - 0.5 + ((t.bw + 1.0) * k) / nb, t.y0 - 0.06, 0.12, 0.22, 0.3, -0.15, SHU, 0, 0, hideBack(s) | TOP);
        }
        const along = railN * 2 + 0.24;
        face(s, railN, 0, t.y0 + 0.82, along, 0.08, 0.09, 0, SHU);
        face(s, railN, 0, t.y0 + 0.52, along, 0.06, 0.06, 0, SHU);
        face(s, railN, 0, t.y0 + 0.21, along, 0.1, 0.08, 0, SHU);
        for (const u of [-half / 3, half / 3]) face(s, railN, u, t.y0 + 0.5, 0.09, 0.7, 0.09, 0, SHU);
        const ns = Math.round((railN * 2) / 0.6);
        for (let k = 1; k < ns; k++) {
          sb.onFace(s, railN, -railN + (railN * 2 * k) / ns, t.y0 + 0.395, 0.04, 0.3, 0.04, 0, SHU, 0, 0, TOP | HIDE_UNDER);
        }
      }
      for (const [sx, sz] of CORNERS) {
        sb.box(0.11, 0.78, 0.11, sx * railN, t.y0 + 0.54, sz * railN, SHU);
        sb.box(0.13, 0.08, 0.13, sx * railN, t.y0 + 0.97, sz * railN, BRONZE);
      }
    }
  }
  for (const [px, pz, d] of ringPillars) b.cyl(0.06, d - 0.04, d, 10, px, plinthH + 0.03, pz, GRANITE_DARK);

  // --- under every eave: the bracket band, the rafters and the hip beams ----
  const RAFTER_BASE = 0.14;
  const RAFTER_FLY = 0.1;
  for (const t of tiers) {
    const R = t.roof;
    const half = t.bw / 2;
    const Y0 = t.y0 + t.hb;
    const soffit = (x: number, z: number): number => roofHeight(R, x, z, true) + 0.02;
    // The base rafters run from the wall to `baseEnd` and rest on the purlin at
    // `purlinN`; its top is where their straight run passes over it.
    const baseStart = half - 0.05;
    const baseEnd = half + 1.25;
    const purlinN = half + 0.5;
    const s0 = soffit(0, -baseStart);
    const s1 = soffit(0, -baseEnd);
    const purlinTop = s0 + ((s1 - s0) * (purlinN - baseStart)) / (baseEnd - baseStart) - RAFTER_BASE - 0.01;
    const purlinBot = Y0 + 0.51;

    // The white wall the brackets read against, up into the roof.
    const panelTop = soffit(0, -baseStart) + 0.05;
    sb.box(t.bw - 0.1, panelTop - Y0, t.bw - 0.1, 0, (Y0 + panelTop) / 2, 0, SHIKKUI);

    for (const s of SIDES) {
      face(s, half, 0, Y0 + 0.05, t.bw + 0.5, 0.1, 0.3, 0.1, SHU);
      // The bracket sets on the pillars: a bearing block, an arm along the
      // wall carrying two small blocks, and one out from it carrying another.
      for (const u of [-half / 3, half / 3]) {
        sb.onFace(s, half, u, Y0 + 0.19, 0.34, 0.18, 0.34, 0.1, SHU, 0, 0, hideBack(s) | TOP);
        face(s, half, u, Y0 + 0.345, 1.0, 0.13, 0.14, 0.1, SHU);
        for (const du of [-0.4, 0.4]) sb.onFace(s, half, u + du, Y0 + 0.46, 0.18, 0.1, 0.18, 0.1, SHU, 0, 0, hideBack(s) | TOP);
      }
      // The frog-leg strut in each bay.
      for (const u of [-(2 * half) / 3, 0, (2 * half) / 3]) {
        face(s, half, u, Y0 + 0.14, 0.48, 0.08, 0.16, 0.08, SHU);
        face(s, half, u, Y0 + 0.23, 0.22, 0.1, 0.16, 0.08, SHU);
        sb.onFace(s, half, u, Y0 + 0.46, 0.18, 0.1, 0.18, 0.1, SHU, 0, 0, hideBack(s) | TOP);
      }
      for (const u of [-half, -half / 3, 0, half / 3, half, -(2 * half) / 3, (2 * half) / 3]) {
        face(s, half, u, Y0 + 0.345, 0.14, 0.13, 0.77, 0.335, SHU);
        sb.onFace(s, half, u, Y0 + 0.46, 0.18, 0.1, 0.18, 0.5, SHU, 0, 0, hideBack(s) | TOP);
      }
      // The wall purlin and the eave purlin, crossed at the corners.
      face(s, half, 0, Y0 + 0.57, t.bw + 0.4, 0.12, 0.14, 0.1, SHU);
      face(s, half, 0, (purlinBot + purlinTop) / 2, t.bw + 1.2, purlinTop - purlinBot, 0.2, 0.5, SHU);
    }
    for (const [sx, sz] of CORNERS) {
      const yaw = Math.atan2(sx, sz);
      sb.box(0.4, 0.18, 0.4, sx * half, Y0 + 0.19, sz * half, SHU);
      member([sx * (half - 0.05), Y0 + 0.345, sz * (half - 0.05)], [sx * (half + 0.62), Y0 + 0.345, sz * (half + 0.62)], 0.16, 0.13, SHU);
      sb.box(0.2, 0.1, 0.2, sx * purlinN, Y0 + 0.46, sz * purlinN, SHU, { y: yaw });
    }

    // The rafters: parallel, base and flying, cut against the hip at the
    // corners, their tops tucked into the sheet and their ends painted.
    const SP = 0.36;
    const K = Math.floor((R.ex - 0.1) / SP);
    for (const s of SIDES) {
      for (let k = -K; k <= K; k++) {
        const u = k * SP;
        const au = Math.abs(u);
        const lay = (n0: number, n1: number, wide: number, deep: number): void => {
          if (n1 - n0 < 0.15) return;
          const [xa, za] = at(s, u, n0);
          const [xc, zc] = at(s, u, n1);
          const a: Point3 = [xa, soffit(xa, za) - deep / 2, za];
          const c: Point3 = [xc, soffit(xc, zc) - deep / 2, zc];
          member(a, c, wide, deep, SHU, TOP | START);
          endFace(a, c, wide - 0.01, deep - 0.01, SHIKKUI);
        };
        lay(Math.max(baseStart, au + 0.1), baseEnd, 0.12, RAFTER_BASE);
        lay(Math.max(half + 1.1, au + 0.1), R.ex - 0.04, 0.1, RAFTER_FLY);
      }
    }
    // The hip beam under each corner, capped in bronze, and a wind bell on it.
    for (const [sx, sz] of CORNERS) {
      const P = (n: number, deep: number): Point3 => [sx * n, roofHeight(R, sx * n, sz * n, true) + 0.02 - deep / 2, sz * n];
      member(P(half - 0.1, 0.28), P(half + 1.25, 0.28), 0.24, 0.28, SHU, TOP | START);
      const a = P(half + 1.1, 0.22);
      const c = P(R.ex + 0.06, 0.22);
      member(a, c, 0.2, 0.22, SHU, TOP | START);
      endFace(a, c, 0.22, 0.24, BRONZE);
      const bx = c[0];
      const bz = c[2];
      const by = c[1] - 0.11;
      sb.box(0.03, 0.16, 0.03, bx, by - 0.08, bz, BRONZE);
      b.cyl(0.3, 0.13, 0.22, 8, bx, by - 0.31, bz, BRONZE);
      sb.box(0.13, 0.2, 0.012, bx, by - 0.6, bz, BRONZE, { y: Math.atan2(sx, sz) + Math.PI / 2 });
    }
  }

  // --- the tiles: round-tile rows, end tiles, hip ridges and demon tiles ----
  for (const t of tiers) {
    const R = t.roof;
    const topAt = (x: number, z: number): number => roofHeight(R, x, z);
    const RSP = 0.5;
    const RH = 0.12;
    const segLen = R.rise > 2 ? 0.55 : 0.8;
    const K = Math.floor((R.ex - 0.25) / RSP - 0.5);
    for (const s of SIDES) {
      for (let k = -K - 1; k <= K; k++) {
        const u = (k + 0.5) * RSP;
        const au = Math.abs(u);
        const n0 = Math.max(R.tx - 0.04, au + 0.12);
        const n1 = R.ex - 0.01;
        if (n1 - n0 < 0.2) continue;
        const segs = Math.max(1, Math.ceil((n1 - n0) / segLen));
        for (let j = 0; j < segs; j++) {
          const na = n0 + ((n1 - n0) * j) / segs - (j > 0 ? 0.03 : 0);
          const nb = n0 + ((n1 - n0) * (j + 1)) / segs + (j < segs - 1 ? 0.03 : 0);
          const [xa, za] = at(s, u, na);
          const [xc, zc] = at(s, u, nb);
          const a: Point3 = [xa, topAt(xa, za) + RH / 2 - 0.025, za];
          const c: Point3 = [xc, topAt(xc, zc) + RH / 2 - 0.025, zc];
          // Laid inward-out, so `c` is the eave end.
          member(a, c, 0.15, RH, KAWARA_DARK, HIDE_UNDER | START | (j < segs - 1 ? END : 0));
          if (j === segs - 1) endFace(a, c, 0.2, 0.19, KAWARA_DARK);
        }
      }
    }
    for (const [sx, sz] of CORNERS) {
      const yaw = Math.atan2(sx, sz);
      const P = (n: number, lift: number): Point3 => [sx * n, topAt(sx * n, sz * n) + lift, sz * n];
      const oniN = R.ex - 0.6;
      const n0 = R.tx - 0.06;
      const segs = 4;
      for (let j = 0; j < segs; j++) {
        const na = n0 + ((oniN - n0) * j) / segs - (j > 0 ? 0.04 : 0);
        const nb = n0 + ((oniN - n0) * (j + 1)) / segs + 0.04;
        member(P(na, 0.09), P(nb, 0.09), 0.36, 0.26, KAWARA_DARK, HIDE_UNDER | START | END);
        member(P(na, 0.08), P(nb, 0.08), 0.39, 0.03, SHIKKUI, START | END | TOP | HIDE_UNDER);
        member(P(na, 0.26), P(nb, 0.26), 0.2, 0.12, KAWARA_DARK, HIDE_UNDER | START | END);
      }
      // The demon tile where the ridge turns up, and the short ridge on to
      // the corner under its own end tile.
      const [ox, oy, oz] = P(oniN + 0.04, 0);
      sb.box(0.52, 0.62, 0.14, ox, oy + 0.3, oz, KAWARA_DARK, { y: yaw });
      sb.box(0.36, 0.34, 0.2, ox, oy + 0.3, oz, KAWARA_DARK, { y: yaw });
      sb.box(0.16, 0.16, 0.12, ox, oy + 0.66, oz, KAWARA_DARK, { y: yaw, z: Math.PI / 4 });
      const a = P(oniN + 0.08, 0.06);
      const c = P(R.ex + 0.02, 0.06);
      member(a, c, 0.22, 0.16, KAWARA_DARK, HIDE_UNDER | START);
      endFace(a, c, 0.24, 0.2, KAWARA_DARK);
    }
  }

  // --- the spire (sōrin) -----------------------------------------------------
  const spire = tiers[4].eave + 2.6;
  sb.box(1.3, 0.2, 1.3, 0, spire - 0.05, 0, BRONZE);
  sb.box(1.1, 0.3, 1.1, 0, spire + 0.2, 0, BRONZE);
  b.cyl(0.25, 0.95, 1.05, 12, 0, spire + 0.475, 0, BRONZE);
  b.cyl(0.2, 0.55, 0.95, 12, 0, spire + 0.7, 0, BRONZE);
  b.cyl(0.35, 0.95, 0.4, 12, 0, spire + 0.975, 0, VERDIGRIS);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    sb.box(0.2, 0.22, 0.05, Math.sin(a) * 0.46, spire + 1.12, Math.cos(a) * 0.46, VERDIGRIS, { y: a, x: 0.45 });
  }
  b.cyl(5.9, 0.16, 0.2, 8, 0, spire + 1.1 + 2.95, 0, BRONZE);
  for (let r = 0; r < 9; r++) {
    const dia = 1.0 - r * 0.035;
    b.cyl(0.1, dia, dia, 12, 0, spire + 1.4 + r * 0.5, 0, VERDIGRIS);
  }
  // The water flame: two openwork plates crossed, each a pointed flame.
  const flameY = spire + 5.7;
  for (const turn of [0, Math.PI / 2]) {
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const outline: [number, number][] = [
      [0, 0],
      [0.3, 0.12],
      [0.44, 0.45],
      [0.38, 0.8],
      [0.2, 1.05],
      [0, 1.2],
      [-0.2, 1.05],
      [-0.38, 0.8],
      [-0.44, 0.45],
      [-0.3, 0.12],
    ];
    const plate = (off: number): Point3[] => outline.map(([h, v]) => [h * c + off * sn, flameY + v, -h * sn + off * c]);
    convexSolid(b, plate(-0.02), plate(0.02), VERDIGRIS);
  }
  b.cyl(0.14, 0.3, 0.12, 8, 0, spire + 7.0, 0, BRONZE);
  b.cyl(0.14, 0.12, 0.3, 8, 0, spire + 7.14, 0, BRONZE);
  b.cyl(0.3, 0.36, 0.14, 8, 0, spire + 7.36, 0, BRONZE);
  b.cyl(0.32, 0.02, 0.36, 8, 0, spire + 7.67, 0, BRONZE);
  // The chains, from under the flame to the corners of the top roof.
  {
    const R = tiers[4].roof;
    const n = R.ex - 0.75;
    for (const [sx, sz] of CORNERS) {
      const A: Point3 = [sx * 0.12, spire + 5.55, sz * 0.12];
      const C: Point3 = [sx * n, roofHeight(R, sx * n, sz * n) + 0.45, sz * n];
      const pts: Point3[] = [];
      for (let k = 0; k <= 3; k++) {
        const f = k / 3;
        pts.push([A[0] + (C[0] - A[0]) * f, A[1] + (C[1] - A[1]) * f - Math.sin(f * Math.PI) * 0.45, A[2] + (C[2] - A[2]) * f]);
      }
      for (let k = 0; k < 3; k++) limb(b, pts[k], pts[k + 1], 0.045, 0.045, BRONZE, 4);
    }
  }

  sb.flush(b);

  // --- the roofs, over the tiles laid on them, and the cores ----------------
  for (const t of tiers) curvedRoof(b, KAWARA, t.roof);
  for (const t of tiers) b.box(t.bw, t.hb, t.bw, 0, t.y0 + t.hb / 2, 0, SHIKKUI);
  b.box(plinthW, plinthH - 0.03 - foot, plinthW, 0, (foot + plinthH - 0.03) / 2, 0, GRANITE_DARK);
  return b;
}
