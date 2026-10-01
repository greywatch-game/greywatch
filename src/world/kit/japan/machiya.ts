/**
 * kit/japan/machiya.ts — buildMachiya: the narrow lattice-fronted townhouse the
 * street is made of.
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
  convexSolid,
  hideBack,
  outward,
  runsAlongX,
  streetSeed,
} from "../core";
import { KURA_CRESTS } from "./kura";
import {
  CEDAR,
  GRANITE,
  GRANITE_DARK,
  HINOKI,
  KAWARA,
  KAWARA_DARK,
  NOREN,
  PAPER,
  SHIKKUI,
  SHOJI_GLOW,
  SUMI,
  TRANSLUCENCY,
} from "./palette";

/**
 * A MACHIYA: the narrow townhouse the street is made of — a Kyoto merchant's
 * house of the late Edo period, built as a TSUSHI-NIKAI: a full ground floor
 * that is the shop, and over it a low loft under the roof, lit by slits in the
 * plaster. A street of them is one lattice front after another under one run
 * of pent roofs, which is what makes a row read as a street rather than a
 * terrace of boxes.
 *
 * - **The shop front (omote)**: posts and a deep head beam framing two bays
 *   either side of the door, each bay a lattice (kōshi) on a sill under a rail
 *   (kamoi), paper behind it — or the room's glow when `litWindows` is set —
 *   and a transom over it with a small lattice light. The lattice is one of
 *   three a street really had: close-set slats (senbon-gōshi), full slats
 *   with short ones hung between them in the top (kiriko), or heavy slats with
 *   thin ones between them stopped short of the sill (oya-ko). Before a bay
 *   there may stand a curved bamboo fence (inuyarai) that keeps dogs and
 *   splashing carts off the lattice, or the shop's bench (battari-shōgi)
 *   folded up against it for the night.
 * - **The door**: a noren on a rod from the kamoi, dyed with the house's mark
 *   (the kura's `KURA_CRESTS` — a merchant's mark is the same mark on the
 *   storehouse and the shop), a granite step before it, and — when the house
 *   is not `enterable` — a pair of lattice leaves over a boarded kick rail,
 *   shut. A signboard (kanban) under its own tile cap hangs on a corner post
 *   of half of them.
 * - **The pent roof (hisashi)**: a tile sheet with round tiles down it and the
 *   straight-edged eave tile (ichimonji-gawara) that is the Kyoto street's own
 *   line, on rafters, an eave beam and bracket arms out of the posts. A
 *   clay Shōki stands guard on a third of them.
 * - **The fire walls (udatsu)**: a plaster wall standing on the hisashi at
 *   each end, cut to its slope, with a timber edge and a tile coping — what
 *   stops a fire walking along the row, and what a merchant who could afford
 *   one built high.
 * - **The loft**: three plaster slit windows (mushiko-mado) in raised frames
 *   on sills, or two of them either side of a timber lattice window with a
 *   bamboo blind let down inside it; timber at the corners, an eave beam, and
 *   the rafter ends under the eave.
 * - **The roof**: a thick tile sheet with round tiles, end tiles and verge
 *   tiles, a ridge of courses banded in white mortar with a demon tile at each
 *   end, and on half of them the kitchen's smoke vent (kemuridashi) standing
 *   over the ridge under a little roof of its own. The gables are plaster.
 * - **The ends and the back**: aged boarding under battens to the height of a
 *   hand, plaster over it framed by posts, the floor beam and the wall plate;
 *   the back has its own door under a tile hood, a lattice window and a loft
 *   slit. A granite plinth runs round all four sides, carried down to the
 *   ground under its lowest corner.
 *
 * `enterable` hollows the ground floor behind the doorway; the upper storey is
 * its ceiling, as the townhouse's is. `tint` is the plaster.
 *
 * Seeded by where it stands (`streetSeed`), which is why it is in
 * `CONFORMS_TO_TERRAIN`: the lattice, what stands before each bay, the
 * signboard, the Shōki, the loft window, the vent, the back door and the
 * mark on the noren all vary along a street of 47.
 *
 * **The colliders are unchanged, byte for byte and in the same order** — the
 * ground floor's walls and the loft (`doorWall` and `wall` spelled out when it
 * is enterable, the two masses when it is not), then the retired `gableRoofX`'s flat slab
 * at the eave. Everything drawn is on a face (nothing more than 0.3 m proud
 * below the hisashi — inside any body's radius), ankle high (the plinth's lip
 * and the step), or overhead (the hisashi, its brackets and everything on
 * it). The repeated work is laid through `StoneBatch`, one surface per colour.
 */
export function buildMachiya(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "machiya");
  const w = p.width ?? 7;
  const d = p.depth ?? 11;
  const plaster = p.tint ?? SHIKKUI;
  const lit = !!p.litWindows;
  const t = 0.3;
  const g = 3.3;
  const up = 2.4;
  const h = g + up;
  const door = 1.8;
  const doorH = 2.3;
  const overhang = 0.55;

  // --- colliders, exactly as they were: the ground floor's walls (the old
  // `doorWall` and `wall` calls) or its mass, the loft, then the roof slab at
  // the eave (the old `gableRoofX`'s).
  if (p.enterable) {
    const side = (w - door) / 2;
    const off = door / 2 + side / 2;
    const fz = -d / 2 + t / 2;
    const lintel = g - doorH;
    b.block({ w: side, h: g, d: t, x: 0 - off, y: g / 2, z: fz });
    b.block({ w: side, h: g, d: t, x: 0 + off, y: g / 2, z: fz });
    b.block({ w: door, h: lintel, d: t, x: 0, y: g / 2 + g / 2 - lintel / 2, z: fz });
    b.block({ w, h: g, d: t, x: 0, y: g / 2, z: d / 2 - t / 2 });
    b.block({ w: t, h: g, d, x: -w / 2 + t / 2, y: g / 2, z: 0 });
    b.block({ w: t, h: g, d, x: w / 2 - t / 2, y: g / 2, z: 0 });
    b.block({ w, h: up, d, x: 0, y: g + up / 2, z: 0 });
  } else {
    b.block({ w, h: g, d, x: 0, y: g / 2, z: 0 });
    b.block({ w, h: up, d, x: 0, y: g + up / 2, z: 0 });
  }
  b.block({ w: w + overhang * 2, h: 0.3, d: d + overhang * 2, x: 0, y: h, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(w, d, h, ctx));
  const lattice = Math.floor(rnd() * 3);
  const bays = [0, 1].map(() => {
    const r = rnd();
    return r < 0.45 ? "fence" : r < 0.7 ? "bench" : "none";
  });
  const kanban = rnd() < 0.55 ? (rnd() < 0.5 ? -1 : 1) : 0;
  const shoki = rnd() < 0.35;
  const loftWindow = rnd() < 0.5;
  const blind = 0.3 + rnd() * 0.5;
  const vent = rnd() < 0.5;
  const ventX = (rnd() - 0.5) * Math.max(0, w - 2.6);
  const backDoorU = (rnd() < 0.5 ? -1 : 1) * (w / 2 - 1.1);
  const mark = KURA_CRESTS[Math.floor(rnd() * KURA_CRESTS.length)];

  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const foot =
    Math.min(
      0,
      ground(-w / 2 - 0.2, -d / 2 - 0.2),
      ground(w / 2 + 0.2, -d / 2 - 0.2),
      ground(-w / 2 - 0.2, d / 2 + 0.2),
      ground(w / 2 + 0.2, d / 2 + 0.2),
    ) - 0.08;

  const sb = new StoneBatch();
  const PL = 0.25;
  const F = -d / 2;
  const wallFace = (s: Side): number => (runsAlongX(s) ? d / 2 : w / 2);
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  /** A member on side `s`'s face, `out` from the face to its own centre. */
  const on = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
  ): void => sb.onFace(s, wallFace(s), u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
  /** A glow on side `s` (±z only), `out` from the face to its centre. */
  const glowOn = (s: Side, u: number, y: number, along: number, tall: number, out: number): void => {
    b.glow(along, tall, 0.02, u, y, outward(s) * (d / 2 + out), SHOJI_GLOW);
  };
  /** A bamboo or timber member on the street face from (oA, yA) to (oB, yB), `o` out from the face. */
  const lean = (
    u: number,
    oA: number,
    yA: number,
    oB: number,
    yB: number,
    color: string,
    hide: number,
    wide = 0.035,
  ): void => {
    const len = Math.hypot(yB - yA, oA - oB);
    const a = Math.atan2(oA - oB, yB - yA);
    sb.box(wide, len, wide, u, (yA + yB) / 2, F - (oA + oB) / 2, color, { x: a }, hide);
  };

  // --- the plinth: dressed granite round a dark core, down to the ground ---
  const plinthH = PL - foot;
  for (const s of SIDES) {
    const run = runsAlongX(s) ? w / 2 + 0.2 : d / 2 + 0.04;
    let u = -run;
    while (run - u > 0.05) {
      let len = 1.1 + rnd() * 0.8;
      if (run - (u + len) < 0.6) len = run - u;
      sb.onFace(s, wallFace(s) + 0.04, u + len / 2, foot + plinthH / 2 + 0.005, len - 0.022, plinthH + 0.01, 0.16, 0.08, GRANITE, 0, 0, hideBack(s));
      u += len;
    }
  }

  // --- the shop front: posts, the head beam and the kamoi ---------------------
  for (const sx of [-1, 1]) {
    on("-z", sx * (w / 2 - 0.13), (PL + g) / 2, 0.26, g - PL, 0.2, 0.1, SUMI);
    on("-z", sx * (door / 2 + 0.08), (PL + g - 0.3) / 2, 0.16, g - 0.3 - PL, 0.16, 0.08, SUMI);
  }
  on("-z", 0, g - 0.15, w + 0.1, 0.3, 0.24, 0.12, SUMI);
  on("-z", 0, doorH + 0.06, w - 0.52, 0.12, 0.16, 0.08, SUMI);

  // The two bays: sill, paper, lattice, rails, the transom, and what stands
  // before each.
  const u0 = door / 2 + 0.16;
  const u1 = w / 2 - 0.26;
  const bw = u1 - u0;
  const y0 = PL + 0.14;
  const y1 = doorH;
  const ty0 = doorH + 0.12;
  const ty1 = g - 0.3;
  for (const [i, sx] of [-1, 1].entries()) {
    const cx = (sx * (u0 + u1)) / 2;
    on("-z", cx, PL + 0.07, bw, 0.14, 0.14, 0.07, SUMI);
    if (lit) glowOn("-z", cx, (y0 + y1) / 2, bw, y1 - y0, 0.02);
    else on("-z", cx, (y0 + y1) / 2, bw, y1 - y0, 0.03, 0.015, PAPER);
    const slat = (u: number, ya: number, yb: number, wide: number): void =>
      on("-z", u, (ya + yb) / 2, wide, yb - ya, 0.06, 0.11, SUMI);
    const at = (f: number): number => cx - bw / 2 + f * bw;
    if (lattice === 0) {
      const n = Math.max(6, Math.round(bw / 0.11));
      for (let k = 1; k < n; k++) slat(at(k / n), y0, y1, 0.045);
    } else if (lattice === 1) {
      const n = Math.max(5, Math.round(bw / 0.15));
      for (let k = 1; k < n; k++) slat(at(k / n), y0, y1, 0.05);
      for (let k = 0; k < n; k++) slat(at((k + 0.5) / n), y1 - 0.55, y1, 0.035);
    } else {
      const n = Math.max(3, Math.round(bw / 0.38));
      for (let k = 1; k < n; k++) slat(at(k / n), y0, y1, 0.075);
      for (let k = 0; k < n; k++) {
        for (let j = 1; j <= 3; j++) slat(at((k + j / 4) / n), y0 + 0.45, y1, 0.03);
      }
    }
    on("-z", cx, y0 + 0.05, bw, 0.08, 0.04, 0.16, SUMI);
    on("-z", cx, y1 - 0.05, bw, 0.08, 0.04, 0.16, SUMI);

    // The transom: plaster, with a small lattice light in it.
    on("-z", cx, (ty0 + ty1) / 2, bw, ty1 - ty0, 0.03, 0.015, plaster);
    const rw = Math.min(0.9, bw - 0.5);
    const rh = 0.3;
    const ry = (ty0 + ty1) / 2;
    if (lit) glowOn("-z", cx, ry, rw, rh, 0.04);
    else on("-z", cx, ry, rw, rh, 0.02, 0.04, PAPER);
    for (let k = 0; k <= 4; k++) {
      on("-z", cx - rw / 2 + (k / 4) * rw, ry, k === 0 || k === 4 ? 0.06 : 0.03, rh + 0.06, 0.04, 0.06, SUMI);
    }
    for (const e of [-1, 1]) on("-z", cx, ry + (e * rh) / 2, rw, 0.05, 0.04, 0.06, SUMI);

    if (bays[i] === "fence") {
      // The inuyarai: bamboo from the ground out past the plinth, up to a
      // knee and back to the lattice, banded twice.
      const n = Math.max(8, Math.round(bw / 0.12));
      for (let k = 0; k <= n; k++) {
        const u = cx - bw / 2 + 0.04 + (k / n) * (bw - 0.08);
        const gy = ground(u, F - 0.3);
        lean(u, 0.3, gy - 0.05, 0.27, 0.45, HINOKI, HIDE_UNDER);
        lean(u, 0.27, 0.45, 0.1, 0.95, HINOKI, 1 << 2);
      }
      sb.box(bw, 0.045, 0.04, cx, 0.45, F - 0.3, SUMI);
      sb.box(bw, 0.045, 0.04, cx, 0.85, F - 0.165, SUMI);
    } else if (bays[i] === "bench") {
      // The battari-shōgi folded up for the night: its top against the
      // lattice, its legs folded flat on it.
      const bl = bw - 0.24;
      on("-z", cx, 0.78, bl, 0.62, 0.045, 0.19, HINOKI);
      for (const e of [-1, 1]) on("-z", cx + e * (bl / 2 - 0.12), 0.78, 0.06, 0.5, 0.04, 0.23, SUMI);
      on("-z", cx, 0.55, bl - 0.3, 0.05, 0.04, 0.23, SUMI);
    }
  }

  // --- the door ----------------------------------------------------------------
  if (!p.enterable) {
    // A pair of lattice leaves, shut, over a boarded kick rail.
    const dm = (PL + doorH) / 2;
    if (lit) glowOn("-z", 0, dm, door, doorH - PL, 0.02);
    else on("-z", 0, dm, door, doorH - PL, 0.03, 0.015, PAPER);
    on("-z", 0, PL + 0.2, door, 0.4, 0.04, 0.06, HINOKI);
    for (const e of [-1, 0, 1]) on("-z", (e * (door - 0.08)) / 2, dm, 0.08, doorH - PL, 0.05, 0.075, SUMI);
    on("-z", 0, doorH - 0.04, door, 0.08, 0.05, 0.075, SUMI);
    on("-z", 0, 1.35, door, 0.05, 0.05, 0.075, SUMI);
    for (const e of [-1, 1]) {
      const lc = (e * door) / 4;
      const lw = door / 2 - 0.08;
      const n = Math.round(lw / 0.1);
      for (let k = 1; k < n; k++) {
        on("-z", lc - lw / 2 + (k / n) * lw, (PL + 0.4 + doorH - 0.08) / 2, 0.03, doorH - 0.48 - PL, 0.03, 0.07, SUMI);
      }
    }
  }
  // The step before it, carried down to the ground.
  const stepG = ground(0, F - 0.5);
  const stepH = 0.15 + Math.max(0, stepG - foot);
  sb.box(door + 0.2, stepH, 0.4, 0, stepG + 0.15 - stepH / 2, F - 0.5, GRANITE);
  // The noren on its rod, with the house's mark on it.
  b.translucentBox(door + 0.2, 0.75, 0.04, 0, 1.95, F - 0.22, NOREN, TRANSLUCENCY.awning);
  on("-z", 0, doorH + 0.03, door + 0.4, 0.04, 0.04, 0.22, SUMI);
  for (const e of [-1, 1]) on("-z", e * (door / 2 + 0.12), doorH + 0.06, 0.04, 0.05, 0.12, 0.18, SUMI);
  for (const [du, dy, mw, mh] of mark) {
    on("-z", du * 0.45, 2.0 + dy * 0.45, mw * 0.45, mh * 0.45, 0.012, 0.247, PAPER);
  }
  // The signboard, on a corner post.
  if (kanban) {
    const ku = kanban * (w / 2 - 0.13);
    on("-z", ku, 1.6, 0.3, 1.2, 0.04, 0.22, HINOKI);
    on("-z", ku, 2.24, 0.38, 0.06, 0.12, 0.2, KAWARA_DARK);
    for (let k = 0; k < 4; k++) {
      on("-z", ku, 1.95 - k * 0.24, 0.14 + (k % 2) * 0.04, 0.12, 0.012, 0.246, SUMI);
    }
  }

  // --- the hisashi -------------------------------------------------------------
  const HIS = 1.1;
  const HP = 0.36;
  const cosH = Math.cos(HP);
  const sinH = Math.sin(HP);
  const hLen = HIS / cosH;
  const hy = g + 0.05;
  const hz = F - HIS / 2;
  const hisW = w + 0.3;
  /** A point `lift` off the sheet's mid-plane and `along` it toward the wall. */
  const hAt = (lift: number, along: number): [number, number] => [
    hy + cosH * lift + sinH * along,
    hz - sinH * lift + cosH * along,
  ];
  sb.box(hisW, 0.14, hLen, 0, hy, hz, KAWARA, { x: -HP });
  const hr = Math.round(hisW / 0.26);
  for (let k = 0; k < hr; k++) {
    const x = -hisW / 2 + (hisW / hr) * (k + 0.5);
    const [ry, rz] = hAt(0.11, 0.05);
    sb.box(0.1, 0.08, hLen - 0.1, x, ry, rz, KAWARA_DARK, { x: -HP }, HIDE_UNDER | (1 << 4) | (1 << 5));
    const [ey, ez] = hAt(0.12, -hLen / 2 + 0.03);
    sb.box(0.15, 0.13, 0.06, x, ey, ez, KAWARA_DARK, { x: -HP }, HIDE_UNDER | (1 << 4));
  }
  // The straight-edged eave tile along its foot.
  const [iy, iz] = hAt(0.02, -hLen / 2 - 0.02);
  sb.box(hisW + 0.04, 0.16, 0.05, 0, iy, iz, KAWARA_DARK);
  // Rafters under the sheet, the eave beam across them, and an arm out of
  // each post to carry it.
  const nr = Math.max(6, Math.round(w / 0.4));
  for (let k = 0; k <= nr; k++) {
    const [ty, tz] = hAt(-0.105, 0.05);
    sb.box(0.06, 0.07, hLen - 0.1, -w / 2 + 0.1 + (k / nr) * (w - 0.2), ty, tz, SUMI, { x: -HP }, (1 << 2) | (1 << 4));
  }
  const [by, bz] = hAt(-0.21, -hLen / 2 + 0.3);
  sb.box(w + 0.1, 0.14, 0.12, 0, by, bz, SUMI);
  for (const u of [-(w / 2 - 0.13), -(door / 2 + 0.08), door / 2 + 0.08, w / 2 - 0.13]) {
    const armLen = F - (bz - 0.1);
    sb.box(0.1, 0.12, armLen, u, by - 0.13, F - armLen / 2, SUMI);
  }
  if (shoki) {
    // The clay Shōki, sword up, guarding the door against what comes down
    // the street.
    const [sy, sz] = hAt(0.07, 0.1);
    sb.box(0.24, 0.08, 0.2, 0, sy + 0.04, sz, KAWARA_DARK);
    sb.box(0.18, 0.26, 0.13, 0, sy + 0.2, sz, KAWARA_DARK);
    sb.box(0.11, 0.11, 0.11, 0, sy + 0.38, sz, KAWARA_DARK);
    sb.box(0.2, 0.04, 0.12, 0, sy + 0.45, sz, KAWARA_DARK);
    sb.box(0.035, 0.32, 0.035, 0.13, sy + 0.3, sz - 0.03, KAWARA_DARK, { z: -0.5 });
  }

  // --- the udatsu: a fire wall on the hisashi at each end ----------------------
  const sheetTop = (z: number): number => hy + 0.07 / cosH + (z - hz) * Math.tan(HP) - 0.03;
  const zf = F - 0.95;
  const yt = g + 1.5;
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.12);
    const prof = (px: number): Point3[] => [
      [px, sheetTop(zf), zf],
      [px, sheetTop(F), F],
      [px, yt, F],
      [px, yt, zf],
    ];
    convexSolid(b, prof(x - 0.1), prof(x + 0.1), plaster);
    sb.box(0.24, yt - sheetTop(zf), 0.05, x, (yt + sheetTop(zf)) / 2, zf - 0.02, SUMI);
    sb.box(0.38, 0.1, 1.1, x, yt + 0.05, (zf + F) / 2 - 0.05, KAWARA_DARK);
    sb.box(0.14, 0.08, 1.12, x, yt + 0.14, (zf + F) / 2 - 0.05, KAWARA_DARK);
  }

  // --- the loft ------------------------------------------------------------------
  const slitY = g + up * 0.5;
  /** A mushiko-mado: plaster bars in a raised plaster frame, on a sill. */
  const mushiko = (s: Side, cx: number, ww: number, wh: number, glowing: boolean): void => {
    const ring = 0.12;
    for (const e of [-1, 1]) on(s, cx + e * (ww / 2 + ring / 2), slitY, ring, wh + ring * 2, 0.07, 0.035, plaster);
    on(s, cx, slitY + wh / 2 + ring / 2, ww, ring, 0.07, 0.035, plaster);
    on(s, cx, slitY - wh / 2 - 0.05, ww + ring * 2 + 0.1, 0.1, 0.12, 0.06, plaster);
    if (glowing) glowOn(s, cx, slitY, ww, wh, 0.01);
    else on(s, cx, slitY, ww, wh, 0.02, 0.01, SUMI);
    for (let k = 1; k < 5; k++) on(s, cx - ww / 2 + (k / 5) * ww, slitY, 0.08, wh, 0.07, 0.04, plaster);
  };
  const upX = w / 3.2;
  for (const sx of [-1, 0, 1]) {
    if (sx === 0 && loftWindow) continue;
    mushiko("-z", sx * upX, 1.1, 0.55, lit && sx === 0);
  }
  if (loftWindow) {
    // A timber lattice window with a bamboo blind let down inside it.
    const ww = 1.5;
    const wh = 0.8;
    if (lit) glowOn("-z", 0, slitY, ww, wh, 0.01);
    else on("-z", 0, slitY, ww, wh, 0.02, 0.01, PAPER);
    const bh = wh * blind;
    on("-z", 0, slitY + wh / 2 - bh / 2, ww - 0.06, bh, 0.02, 0.035, HINOKI);
    for (let y = slitY + wh / 2 - 0.1; y > slitY + wh / 2 - bh + 0.02; y -= 0.1) {
      on("-z", 0, y, ww - 0.06, 0.014, 0.01, 0.05, SUMI);
    }
    const n = Math.round(ww / 0.1);
    for (let k = 1; k < n; k++) on("-z", -ww / 2 + (k / n) * ww, slitY, 0.03, wh, 0.04, 0.08, SUMI);
    for (const e of [-1, 1]) {
      on("-z", (e * (ww + 0.08)) / 2, slitY, 0.08, wh + 0.16, 0.1, 0.05, SUMI);
      on("-z", 0, slitY + (e * (wh + 0.08)) / 2, ww, 0.08, 0.1, 0.05, SUMI);
    }
  }
  // Timber at the loft's corners, and the eave beam, front and back.
  for (const s of ["-z", "+z"] as const) {
    for (const sx of [-1, 1]) on(s, sx * (w / 2 - 0.09), (g + h) / 2, 0.18, up, 0.05, 0.025, SUMI);
    on(s, 0, h - 0.22, w, 0.2, 0.12, 0.06, SUMI);
    on(s, 0, g, w, 0.14, 0.05, 0.025, SUMI);
  }

  // --- the ends: boarding under battens, posts and plaster over it --------------
  const BOARD = 2.1;
  for (const s of ["-x", "+x"] as const) {
    on(s, 0, (PL + BOARD) / 2, d, BOARD - PL, 0.03, 0.015, HINOKI);
    const nb = Math.max(6, Math.round(d / 0.75));
    for (let k = 1; k < nb; k++) on(s, -d / 2 + (k / nb) * d, (PL + BOARD) / 2, 0.05, BOARD - PL, 0.03, 0.045, SUMI);
    on(s, 0, BOARD + 0.04, d + 0.02, 0.08, 0.07, 0.035, SUMI);
    const np = Math.max(2, Math.round(d / 3));
    for (let k = 0; k <= np; k++) {
      on(s, -d / 2 + 0.09 + (k / np) * (d - 0.18), (BOARD + 0.08 + h) / 2, 0.18, h - BOARD - 0.08, 0.05, 0.025, SUMI);
    }
    on(s, 0, g, d, 0.14, 0.05, 0.025, SUMI);
    on(s, 0, h - 0.1, d, 0.2, 0.05, 0.025, SUMI);
  }

  // --- the back: boarding, a door under a hood, a window, a loft slit --------------
  on("+z", 0, (PL + BOARD) / 2, w, BOARD - PL, 0.03, 0.015, HINOKI);
  {
    const nb = Math.max(6, Math.round(w / 0.6));
    for (let k = 1; k < nb; k++) {
      const u = -w / 2 + (k / nb) * w;
      if (Math.abs(u - backDoorU) < 0.6) continue;
      on("+z", u, (PL + BOARD) / 2, 0.05, BOARD - PL, 0.03, 0.045, SUMI);
    }
    on("+z", 0, BOARD + 0.04, w + 0.02, 0.08, 0.07, 0.035, SUMI);
  }
  // The back door: a boarded leaf on ledges in a timber frame.
  on("+z", backDoorU, PL + 0.95, 0.9, 1.9, 0.03, 0.045, HINOKI);
  for (const yl of [PL + 0.3, PL + 0.95, PL + 1.6]) on("+z", backDoorU, yl, 0.84, 0.1, 0.03, 0.075, SUMI);
  for (const e of [-1, 1]) on("+z", backDoorU + e * 0.5, PL + 1.0, 0.1, 2.0, 0.08, 0.04, SUMI);
  on("+z", backDoorU, PL + 2.0, 1.1, 0.1, 0.08, 0.04, SUMI);
  sb.box(1.4, 0.08, 0.62, backDoorU, 2.55, d / 2 + 0.3, KAWARA, { x: 0.3 });
  for (const e of [-1, 1]) sb.box(0.08, 0.1, 0.55, backDoorU + e * 0.55, 2.42, d / 2 + 0.275, SUMI);
  // The kitchen's window, on the other side.
  const bwU = -Math.sign(backDoorU) * (w / 2 - 1.3);
  if (lit) glowOn("+z", bwU, 1.55, 0.9, 0.6, 0.05);
  else on("+z", bwU, 1.55, 0.9, 0.6, 0.02, 0.05, PAPER);
  for (let k = 0; k <= 6; k++) on("+z", bwU - 0.45 + (k / 6) * 0.9, 1.55, k === 0 || k === 6 ? 0.07 : 0.03, 0.66, 0.04, 0.08, SUMI);
  for (const e of [-1, 1]) on("+z", bwU, 1.55 + e * 0.31, 0.97, 0.06, 0.05, 0.08, SUMI);
  mushiko("+z", 0, 0.9, 0.45, false);

  // --- the roof -----------------------------------------------------------------
  const RISE = 1.9;
  const RUN = d / 2 + overhang;
  const EAVE = d / 2 + 0.6;
  const pitch = Math.atan2(RISE, RUN);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const T = 0.22;
  const len = EAVE / cosP;
  const roofW = w + overhang * 2;
  const lineY = (z: number): number => h + RISE * (1 - Math.abs(z) / RUN);
  for (const s of [-1, 1]) {
    // A point `lift` off the roof line at `z`, along the slope's normal.
    const at = (z: number, lift: number): [number, number] => [lineY(z) + cosP * lift, z + s * sinP * lift];
    // The face of a member on this slope that looks UP it — into the ridge,
    // the wall or the rib above — which nobody sees.
    const upEnd = s > 0 ? 1 << 5 : 1 << 4;
    const zm = (s * EAVE) / 2;
    const [sy, sz] = at(zm, T / 2);
    sb.box(roofW, T, len, 0, sy, sz, KAWARA, { x: s * pitch });
    const [ry, rz] = at(zm, T + 0.045);
    const ribs = Math.round(roofW / 0.3);
    for (let i = 0; i < ribs; i++) {
      const x = -roofW / 2 + (roofW / ribs) * (i + 0.5);
      sb.box(0.12, 0.09, len - 0.2, x, ry - 0.1 * sinP, rz + s * 0.1 * cosP, KAWARA_DARK, { x: s * pitch }, HIDE_UNDER | (1 << 4) | (1 << 5));
      sb.box(0.17, 0.16, 0.06, x, ry - (len / 2) * sinP, rz + s * (len / 2) * cosP, KAWARA_DARK, { x: s * pitch }, HIDE_UNDER | upEnd);
    }
    sb.box(roofW, 0.1, 0.06, 0, sy - (len / 2) * sinP - 0.02, sz + s * (len / 2) * cosP, KAWARA_DARK);
    for (const sx of [-1, 1]) {
      const [ty, tz] = at(zm, T + 0.06);
      sb.box(0.24, 0.12, len, sx * (roofW / 2 - 0.12), ty, tz, KAWARA_DARK, { x: s * pitch });
    }
    // The rafter ends under the eave.
    const zr = (s * (d / 2 + EAVE - 0.08)) / 2;
    const [ay, az] = at(zr, -0.05);
    const rl = (EAVE - 0.08 - d / 2) / cosP;
    const nr2 = Math.max(6, Math.round(w / 0.5));
    for (let k = 0; k <= nr2; k++) {
      sb.box(0.07, 0.09, rl, -w / 2 + 0.12 + (k / nr2) * (w - 0.24), ay, az, SUMI, { x: s * pitch }, (1 << 2) | upEnd);
    }
  }
  // The gables: plaster, up under the roof.
  for (const sx of [-1, 1]) {
    const tri = (x: number): Point3[] => [
      [x, h, -d / 2],
      [x, h, d / 2],
      [x, h + RISE * 0.96, 0],
    ];
    convexSolid(b, tri(sx * (w / 2 + 0.01)), tri(sx * (w / 2 - 0.4)), plaster);
  }
  // The ridge: courses banded in white, a round cap, a demon tile each end.
  const ry0 = h + RISE + T / cosP - 0.06;
  const ridgeL = w + 0.4;
  let ridgeY = ry0;
  for (let i = 0; i < 3; i++) {
    const depth = 0.62 - i * 0.07;
    sb.box(ridgeL, 0.08, depth, 0, ridgeY + 0.04, 0, KAWARA_DARK);
    ridgeY += 0.08;
    if (i < 2) {
      sb.box(ridgeL - 0.04, 0.028, depth - 0.05, 0, ridgeY + 0.014, 0, SHIKKUI);
      ridgeY += 0.028;
    }
  }
  sb.box(ridgeL, 0.16, 0.3, 0, ridgeY + 0.08, 0, KAWARA_DARK);
  ridgeY += 0.16;
  for (const sx of [-1, 1]) {
    const ox = sx * (ridgeL / 2 + 0.02);
    sb.box(0.14, 0.66, 0.74, ox, ry0 + 0.27, 0, KAWARA_DARK);
    sb.box(0.14, 0.3, 0.46, ox, ry0 + 0.74, 0, KAWARA_DARK);
    sb.box(0.14, 0.3, 0.13, ox + sx * 0.02, ry0 + 0.94, 0, KAWARA_DARK, { z: -sx * 0.35 });
  }
  if (vent) {
    // The kitchen's smoke vent: a louvred box over the ridge under its own roof.
    const vb = ridgeY - 0.1;
    const vh = 0.42;
    sb.box(0.9, vh, 0.7, ventX, vb + vh / 2, 0, SUMI);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        sb.box(0.84, 0.04, 0.05, ventX, vb + 0.1 + k * 0.12, s * 0.37, HINOKI, { x: s * 0.5 });
      }
      sb.box(1.2, 0.07, 0.62, ventX, vb + vh + 0.12, s * 0.27, KAWARA, { x: s * 0.5 });
    }
    sb.box(1.25, 0.1, 0.16, ventX, vb + vh + 0.29, 0, KAWARA_DARK);
  }

  sb.flush(b);

  // --- the cores, emitted after what hides them -----------------------------------
  b.box(w + 0.34, plinthH - 0.01, d + 0.34, 0, foot + (plinthH - 0.01) / 2, 0, GRANITE_DARK);
  if (p.enterable) {
    const side = (w - door) / 2;
    const off = door / 2 + side / 2;
    const lintel = g - doorH;
    b.box(w - 0.2, 0.2, d - 0.2, 0, 0.25, 0, CEDAR);
    b.box(side, g, t, -off, g / 2, F + t / 2, HINOKI);
    b.box(side, g, t, off, g / 2, F + t / 2, HINOKI);
    b.box(door, lintel, t, 0, g - lintel / 2, F + t / 2, HINOKI);
    b.box(w, g, t, 0, g / 2, d / 2 - t / 2, plaster);
    b.box(t, g, d, -w / 2 + t / 2, g / 2, 0, plaster);
    b.box(t, g, d, w / 2 - t / 2, g / 2, 0, plaster);
    b.box(w, up, d, 0, g + up / 2, 0, plaster);
  } else {
    b.box(w, g, d, 0, g / 2, 0, plaster);
    b.box(w, up, d, 0, g + up / 2, 0, plaster);
  }
  return b;
}
