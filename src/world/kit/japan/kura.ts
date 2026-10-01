/**
 * kit/japan/kura.ts — buildKura: the plastered storehouse, and `KURA_CRESTS`,
 * the merchant's marks the machiya's and the teahouse's noren carry too.
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
  carve,
  convexSolid,
  hideBack,
  outward,
  runsAlongX,
  streetSeed,
} from "../core";
import {
  GRANITE,
  GRANITE_DARK,
  KAWARA,
  KAWARA_DARK,
  NAMAKO,
  SHIKKUI,
  SUMI,
  TSUCHI,
} from "./palette";

/**
 * A KURA: an Edo storehouse of the fireproof kind — a mud wall a foot thick
 * under a skin of lime plaster, on a granite plinth, with a skirt of black
 * NAMAKO tile round its foot. Solid — what is in a kura is not somewhere a
 * round goes. It is the building a brewery is made of, and a row of them is
 * the whitest thing in the valley.
 *
 * **It was a cream box with a black grid round its foot under a board roof**:
 * a plaster block, the skirt a square grid of white lines on a dark band, a
 * door that was a dark rectangle in a frame, one window, a roof two slabs as
 * thin as a door, and nothing on the back or the gable ends at all. What
 * makes a kura one is what fire-proofing made it — everything is THICK, and
 * every edge is plastered in steps — so that is where this spends its
 * vertices:
 *
 * - **The skirt is set on the DIAGONAL**, the square tiles turned 45 degrees
 *   under raised white joints, which is the pattern the name means; the square
 *   grid read as a window. Framed by beads at its head, its foot, its corners
 *   and the door, and capped by a sloped tile drip course.
 * - **The plaster is a SKIN**, three and a half centimetres proud of a mud
 *   core (`TSUCHI`), so where a kura has aged the lime has come off in a lobed
 *   patch or two on the back and the ends and the mud shows behind a step the
 *   ink draws. Never on the front: the brewery keeps its face.
 * - **The eaves are plastered in steps** — three courses of cornice under the
 *   front and back eaves, a closed plaster box under each verge — and the roof
 *   is a thick sheathing slab under rows of round tiles, end tiles along the
 *   eave, edge tiles up the verge, and a ridge of stacked flat tiles banded by
 *   white mortar with a demon tile at each end.
 * - **The door is the storehouse's whole argument**: a stepped plaster frame
 *   three rings deep, the heavy plaster doors themselves (open back against
 *   the wall in three placements in five, shut and hasped in the rest), a
 *   boarded inner door, a tile hood on brackets and a granite step. The
 *   windows are the same thing small — a stepped frame, iron bars, plaster
 *   shutters, a hood — on the front, on one gable end of most, and on the
 *   back of half.
 * - **A family crest on each gable**: a raised plaster roundel with a black
 *   field and a white mark in it, one of five (`KURA_CRESTS`), the one mark on
 *   the building that says whose it is. And rows of L-shaped iron pegs
 *   (orikugi) under the eaves and across the ends, where scaffolding is hung
 *   to re-plaster it.
 *
 * Seeded by where it stands (`streetSeed`), which is why it is in
 * `CONFORMS_TO_TERRAIN`: the eight in the brewery are one building eight
 * ways, and the plinth is carried down to the ground under its lowest corner.
 *
 * **The colliders are unchanged, byte for byte and in the same order**: the
 * mass, then the flat roof slab at the eave (the retired `gableRoofX`'s,
 * spelled out).
 * Everything drawn is on a face (the skirt, the skin, the frames and the
 * leaves, none more than 0.6 m proud), overhead (the cornice, the hoods, the
 * roof), or ankle high (the plinth's lip and the step). The repeated work —
 * the tile joints, the roof tiles, the pegs, the plinth stones, the skin — is
 * laid through `StoneBatch` as one surface per colour, because a part is a
 * mesh the install pays for.
 */
export function buildKura(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "kura");
  const w = p.width ?? 6;
  const d = p.depth ?? 5;
  const h = p.height ?? 5.4;

  // --- colliders, exactly as they were: the mass, then the roof slab at the
  // eave (the retired `gableRoofX`'s, with its 0.45 overhang spelled out).
  b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  const overhang = 0.45;
  b.block({ w: w + overhang * 2, h: 0.3, d: d + overhang * 2, x: 0, y: h, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(w, d, h, ctx));
  const crest = KURA_CRESTS[Math.floor(rnd() * KURA_CRESTS.length)];
  const doorOpen = rnd() < 0.6;
  const frontShutters = rnd() < 0.65;
  const gableSide: Side = rnd() < 0.5 ? "-x" : "+x";
  const gableWindow = rnd() < 0.7;
  const backWindow = rnd() < 0.5;
  const backU = (rnd() - 0.5) * Math.max(0, w - 2.6);
  const gableU = (rnd() - 0.5) * 0.8;
  const gableOpen = rnd() < 0.5;
  const backOpen = rnd() < 0.5;

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
  const SKIN = 0.035;
  const PLINTH = 0.45;
  const skirt = 1.5;
  const skirtTop = PLINTH + skirt;
  const half = (s: Side): number => (runsAlongX(s) ? w / 2 : d / 2);
  const wallFace = (s: Side): number => (runsAlongX(s) ? d / 2 : w / 2);
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];

  /**
   * A member laid on side `s`'s plaster, `out` measured from the skin's face
   * to the member's own centre; `pitch` drops its outer edge (a hood, a drip).
   */
  const onSkin = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
    pitch = 0,
  ): void => {
    const n = outward(s);
    const c = n * (wallFace(s) + SKIN + out);
    if (runsAlongX(s)) sb.box(along, tall, thick, u, y, c, color, pitch ? { x: n * pitch } : undefined);
    else sb.box(thick, tall, along, c, y, u, color, pitch ? { z: -n * pitch } : undefined);
  };
  /** `onSkin` into the batch, its back face left out. */
  const onSkinBatch = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
  ): void => sb.onFace(s, wallFace(s) + SKIN, u, y, along, tall, thick, out, color, 0, 0, hideBack(s));

  // A stepped plaster frame round an opening: rings from the outermost (the
  // widest, the least proud) in, each a pair of jambs, a head and a sill.
  const frame = (
    s: Side,
    u: number,
    y0: number,
    wo: number,
    ho: number,
    rings: readonly [number, number, number][],
    sill: boolean,
  ): void => {
    for (const [fw, fh, depth] of rings) {
      const jamb = (fw - wo) / 2;
      const base = sill ? y0 - jamb : y0;
      const head = base + fh - (y0 + ho);
      for (const sx of [-1, 1]) {
        onSkin(s, u + sx * (wo / 2 + jamb / 2), base + fh / 2, jamb, fh, depth, depth / 2, SHIKKUI);
      }
      onSkin(s, u, y0 + ho + head / 2, wo, head, depth, depth / 2, SHIKKUI);
      if (sill) onSkin(s, u, base + jamb / 2, wo, jamb, depth, depth / 2, SHIKKUI);
    }
  };

  // A lean-to of tile over an opening, on two brackets.
  const hood = (s: Side, u: number, yTop: number, wide: number, proj: number): void => {
    const a = 0.38;
    const len = proj / Math.cos(a);
    const drop = proj * Math.tan(a);
    const yc = yTop - drop / 2;
    onSkin(s, u, yc, wide, 0.09, len, proj / 2, KAWARA, a);
    const ribs = Math.max(3, Math.round(wide / 0.24));
    for (let i = 0; i < ribs; i++) {
      const ru = u - wide / 2 + (wide / ribs) * (i + 0.5);
      onSkin(s, ru, yc + 0.075, 0.09, 0.07, len, proj / 2, KAWARA_DARK, a);
    }
    onSkin(s, u, yTop - drop - 0.01, wide + 0.04, 0.12, 0.05, proj, KAWARA_DARK);
    for (const sx of [-1, 1]) {
      onSkin(s, u + sx * (wide / 2 - 0.2), yTop - drop - 0.14, 0.09, 0.1, proj - 0.05, (proj - 0.05) / 2, SUMI);
    }
  };

  // A window: stepped frame, a dark back, iron bars, plaster shutters open
  // against the wall or shut over it, and a hood.
  const kuraWindow = (s: Side, u: number, yc: number, open: boolean, small = false): void => {
    const wo = small ? 0.5 : 0.62;
    const ho = small ? 0.45 : 0.55;
    const y0 = yc - ho / 2;
    frame(s, u, y0, wo, ho, [
      [wo + 0.38, ho + 0.38, 0.08],
      [wo + 0.2, ho + 0.2, 0.16],
    ], true);
    onSkin(s, u, yc, wo, ho, 0.02, 0.01, NAMAKO);
    for (let i = 1; i <= 3; i++) {
      onSkin(s, u - wo / 2 + (wo / 4) * i, yc, 0.035, ho, 0.035, 0.07, SUMI);
    }
    const leafW = (wo + 0.2) / 2;
    const leafH = ho + 0.24;
    for (const sx of [-1, 1]) {
      if (open) {
        const lu = u + sx * ((wo + 0.38) / 2 + leafW / 2 + 0.02);
        onSkin(s, lu, yc, leafW, leafH, 0.12, 0.06, SHIKKUI);
        onSkin(s, lu, yc, leafW - 0.12, leafH - 0.12, 0.03, 0.135, SHIKKUI);
      } else {
        const lu = u + sx * (leafW / 2);
        onSkin(s, lu, yc, leafW - 0.01, leafH, 0.12, 0.22, SHIKKUI);
        onSkin(s, lu, yc, leafW - 0.13, leafH - 0.12, 0.03, 0.295, SHIKKUI);
      }
    }
    hood(s, u, yc + (ho + 0.38) / 2 + 0.34, wo + 0.7, small ? 0.36 : 0.45);
  };

  // --- the plinth: dressed granite round a dark core, down to the ground ---
  const plinthH = PLINTH - foot;
  for (const s of SIDES) {
    const run = runsAlongX(s) ? w / 2 + 0.2 : d / 2 + 0.04;
    let u = -run;
    while (run - u > 0.05) {
      let len = 0.75 + rnd() * 0.55;
      if (run - (u + len) < 0.45) len = run - u;
      sb.onFace(s, wallFace(s) + 0.04, u + len / 2, foot + plinthH / 2 + 0.005, len - 0.022, plinthH + 0.01, 0.16, 0.08, GRANITE, 0, 0, hideBack(s));
      u += len;
    }
  }

  // --- the skirt: black tile on the diagonal under raised white joints ---
  const LATTICE = 0.3;
  const BEAD = 0.045;
  const PROUD = 0.035;
  const doorW = 2.3;
  for (const s of SIDES) {
    const plane = wallFace(s) + 0.04;
    const run = half(s) + 0.04;
    const holes: [number, number][] = s === "-z" ? [[-doorW / 2, doorW / 2]] : [];
    const y0 = PLINTH;
    const y1 = skirtTop;
    const H = y1 - y0;
    for (const [a, c1] of carve(-run, run, holes)) {
      for (const k of [1, -1]) {
        // Lines u = c + k * (y - y0), on one lattice for the whole face so
        // both sides of the door stay in step.
        const cMin = k > 0 ? a - H : a;
        const cMax = k > 0 ? c1 : c1 + H;
        for (let c = -run + Math.ceil((cMin + run) / LATTICE) * LATTICE; c <= cMax; c += LATTICE) {
          const t0 = k > 0 ? Math.max(0, a - c) : Math.max(0, c - c1);
          const t1 = k > 0 ? Math.min(H, c1 - c) : Math.min(H, c - a);
          if (t1 - t0 < 0.03) continue;
          sb.onFace(
            s,
            plane,
            c + (k * (t0 + t1)) / 2,
            y0 + (t0 + t1) / 2,
            (t1 - t0) * Math.SQRT2,
            BEAD,
            PROUD,
            PROUD / 2,
            SHIKKUI,
            (k * Math.PI) / 4,
            0,
            hideBack(s),
          );
        }
      }
      // A bead down each end of the run: the corner, or the door's jamb.
      for (const e of [a, c1]) {
        sb.onFace(s, plane, e, y0 + H / 2, 0.07, H, PROUD + 0.01, (PROUD + 0.01) / 2, SHIKKUI, 0, 0, hideBack(s));
      }
    }
    // Head and foot beads the whole run.
    for (const yb of [y0 + 0.035, y1 - 0.035]) {
      sb.onFace(s, plane, 0, yb, run * 2 + 0.07, 0.07, PROUD + 0.01, (PROUD + 0.01) / 2, SHIKKUI, 0, 0, hideBack(s));
    }
    // The drip course over it: a sloped tile ledge.
    onSkin(s, 0, skirtTop + 0.06, half(s) * 2 + 0.3, 0.05, 0.2, 0.1, KAWARA, 0.42);
  }

  // --- the plaster skin, spalled back to the mud in a lobe or two ----------
  const spalls: { s: Side; lobes: [number, number, number][] }[] = [];
  const nSpalls = Math.floor(rnd() * 2.6);
  for (let i = 0; i < nSpalls; i++) {
    const s: Side = (["+z", "-x", "+x"] as const)[Math.floor(rnd() * 3)];
    const u = (rnd() - 0.5) * (half(s) * 2 - 1.4);
    const y = skirtTop + 0.3 + rnd() * (h - skirtTop - 1.6);
    const lobes: [number, number, number][] = [];
    const n = 2 + Math.floor(rnd() * 2);
    for (let j = 0; j < n; j++) {
      lobes.push([u + (rnd() - 0.5) * 0.45, y + (rnd() - 0.5) * 0.35, 0.12 + rnd() * 0.18]);
    }
    spalls.push({ s, lobes });
  }
  const BAND = 0.09;
  for (const s of SIDES) {
    const run = runsAlongX(s) ? w / 2 + SKIN : d / 2;
    const lobes = spalls.filter((sp) => sp.s === s).flatMap((sp) => sp.lobes);
    const y0 = skirtTop + 0.09;
    const y1 = runsAlongX(s) ? h - 0.5 : h;
    const slab = (a: number, c: number): void => {
      if (c - a > 0.01) onSkinBatch(s, 0, (a + c) / 2, run * 2, c - a, SKIN, -SKIN / 2, SHIKKUI);
    };
    if (!lobes.length) {
      slab(y0, y1);
      continue;
    }
    let lo = y1;
    let hi = y0;
    for (const [, ly, r] of lobes) {
      lo = Math.min(lo, ly - r);
      hi = Math.max(hi, ly + r);
    }
    lo = Math.max(y0, lo);
    hi = Math.min(y1, hi);
    slab(y0, lo);
    for (let y = lo; y < hi - 1e-6; y += BAND) {
      const yt = Math.min(hi, y + BAND);
      const yc = (y + yt) / 2;
      const cuts: [number, number][] = [];
      for (const [lu, ly, r] of lobes) {
        const dy = yc - ly;
        if (Math.abs(dy) < r) {
          const hc = Math.sqrt(r * r - dy * dy);
          cuts.push([lu - hc, lu + hc]);
        }
      }
      for (const [a, c] of carve(-run, run, cuts)) {
        onSkinBatch(s, (a + c) / 2, yc, c - a, yt - y, SKIN, -SKIN / 2, SHIKKUI);
      }
    }
    slab(hi, y1);
  }

  // --- the eaves: three steps of plaster cornice front and back, and the
  // lowest carried round the ends as a string course -------------------------
  for (const s of ["-z", "+z"] as const) {
    const steps: [number, number, number][] = [
      [h - 0.5, h - 0.36, 0.06],
      [h - 0.36, h - 0.22, 0.14],
      [h - 0.22, h + 0.02, 0.24],
    ];
    for (const [y0, y1, proj] of steps) {
      onSkin(s, 0, (y0 + y1) / 2, w + SKIN * 2 + proj * 2, y1 - y0, proj, proj / 2, SHIKKUI);
    }
  }
  for (const s of ["-x", "+x"] as const) {
    onSkin(s, 0, h - 0.43, d, 0.14, 0.06, 0.03, SHIKKUI);
  }

  // --- the door --------------------------------------------------------------
  const wo = 1.3;
  const ho = 2.15;
  frame("-z", 0, PLINTH, wo, ho, [
    [doorW, 2.95, 0.12],
    [2.05, 2.72, 0.24],
    [1.8, 2.5, 0.34],
  ], false);
  // The boarded inner door, set back on the wall's own face.
  for (let i = 0; i < 4; i++) {
    onSkin("-z", -wo / 2 + (wo / 4) * (i + 0.5), PLINTH + ho / 2, wo / 4 - 0.012, ho, 0.04, -0.01, SUMI);
  }
  for (const yb of [PLINTH + 0.4, PLINTH + ho - 0.4]) {
    onSkin("-z", 0, yb, wo, 0.06, 0.02, 0.015, NAMAKO);
  }
  // The plaster doors: open back against the wall, or shut over the frame.
  const leafW = 0.78;
  const leafH = 2.4;
  for (const sx of [-1, 1]) {
    if (doorOpen) {
      const lu = sx * (doorW / 2 + leafW / 2 + 0.03);
      onSkin("-z", lu, PLINTH + leafH / 2, leafW, leafH, 0.2, 0.1, SHIKKUI);
      onSkin("-z", lu, PLINTH + leafH / 2, leafW - 0.16, leafH - 0.16, 0.05, 0.225, SHIKKUI);
    } else {
      const lu = sx * (leafW / 2 + 0.005);
      onSkin("-z", lu, PLINTH + leafH / 2, leafW, leafH, 0.2, 0.44, SHIKKUI);
      onSkin("-z", lu, PLINTH + leafH / 2, leafW - 0.16, leafH - 0.16, 0.05, 0.565, SHIKKUI);
    }
  }
  if (!doorOpen) {
    onSkin("-z", 0, PLINTH + 1.15, 0.1, 0.24, 0.04, 0.61, SUMI);
    onSkin("-z", 0, PLINTH + 1.02, 0.16, 0.06, 0.06, 0.62, SUMI);
  }
  hood("-z", 0, PLINTH + 2.95 + 0.42, 2.9, 0.8);
  // The step: a granite slab on the ground in front of the door, carried down
  // to it where the plinth is.
  const stepG = ground(0, -d / 2 - 0.55);
  const stepH = 0.2 + Math.max(0, stepG - foot);
  sb.box(1.7, stepH, 0.6, 0, stepG + 0.2 - stepH / 2, -d / 2 - 0.55, GRANITE);

  // --- the windows -------------------------------------------------------------
  kuraWindow("-z", 0, h - 1.3, frontShutters);
  if (gableWindow) kuraWindow(gableSide, gableU, h - 1.25, gableOpen, true);
  if (backWindow) kuraWindow("+z", backU, h - 1.3, backOpen);

  // --- the pegs (orikugi) scaffolding hangs from -----------------------------
  for (const s of SIDES) {
    const run = half(s);
    const rows = runsAlongX(s) ? [h - 0.72] : [skirtTop + 1.0, h - 0.72];
    for (const y of rows) {
      const n = Math.max(2, Math.round((run * 2 - 0.8) / 0.95));
      for (let i = 0; i <= n; i++) {
        const u = -run + 0.4 + ((run * 2 - 0.8) / n) * i;
        const high = y > h - 2;
        if (s === "-z" && Math.abs(u) < 0.9 && high) continue;
        if (s === "+z" && backWindow && Math.abs(u - backU) < 0.8) continue;
        if (s === gableSide && gableWindow && Math.abs(u - gableU) < 0.8 && high) continue;
        onSkinBatch(s, u, y, 0.035, 0.035, 0.15, 0.075, SUMI);
        onSkinBatch(s, u, y + 0.045, 0.035, 0.09, 0.035, 0.135, SUMI);
      }
    }
  }

  // --- the roof ---------------------------------------------------------------
  const RISE = 1.5;
  const RUN = d / 2 + overhang;
  const EAVE = d / 2 + 0.55;
  const pitch = Math.atan2(RISE, RUN);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const T = 0.22;
  const len = EAVE / cosP;
  const roofW = w + overhang * 2;
  const lineY = (z: number): number => h + RISE * (1 - Math.abs(z) / RUN);
  for (const s of [-1, 1]) {
    const zm = (s * EAVE) / 2;
    // A point `lift` off the roof line mid-run, along the slope's normal.
    const at = (lift: number): [number, number] => [lineY(zm) + cosP * lift, zm + s * sinP * lift];
    const [sy, sz] = at(T / 2);
    sb.box(roofW, T, len, 0, sy, sz, KAWARA, { x: s * pitch });
    // Round tiles down the slope, their ends out at the eave.
    const [ry, rz] = at(T + 0.045);
    const ribs = Math.round(roofW / 0.28);
    for (let i = 0; i < ribs; i++) {
      const x = -roofW / 2 + (roofW / ribs) * (i + 0.5);
      sb.box(0.12, 0.09, len - 0.2, x, ry - 0.1 * sinP, rz + s * 0.1 * cosP, KAWARA_DARK, { x: s * pitch }, HIDE_UNDER);
      sb.box(0.17, 0.16, 0.06, x, ry - (len / 2) * sinP, rz + s * (len / 2) * cosP, KAWARA_DARK, { x: s * pitch });
    }
    // The eave's front tile.
    sb.box(roofW, 0.1, 0.06, 0, sy - (len / 2) * sinP - 0.02, sz + s * (len / 2) * cosP, KAWARA_DARK);
    for (const sx of [-1, 1]) {
      // Edge tiles up the verge, and the plaster box closing the overhang under it.
      const [ty, tz] = at(T + 0.06);
      sb.box(0.24, 0.12, len, sx * (roofW / 2 - 0.12), ty, tz, KAWARA_DARK, { x: s * pitch });
      const [by, bz] = at(-0.16);
      sb.box(overhang + SKIN, 0.32, len - 0.05, sx * (w / 2 + (overhang + SKIN) / 2), by, bz, SHIKKUI, { x: s * pitch });
    }
  }
  // The gable ends: plaster, flush with the skin, up under the roof.
  for (const sx of [-1, 1]) {
    const tri = (x: number): Point3[] => [
      [x, h, -d / 2],
      [x, h, d / 2],
      [x, h + RISE * 0.96, 0],
    ];
    convexSolid(b, tri(sx * (w / 2 + SKIN)), tri(sx * (w / 2 - 0.4)), SHIKKUI);
  }
  // The ridge: flat tiles stacked in courses, banded by white mortar, under a
  // round cap, a demon tile at each end.
  const ry0 = h + RISE + T / cosP - 0.06;
  const ridgeL = roofW - 0.2;
  let ridgeY = ry0;
  for (let i = 0; i < 4; i++) {
    const depth = 0.66 - i * 0.07;
    sb.box(ridgeL, 0.075, depth, 0, ridgeY + 0.0375, 0, KAWARA_DARK);
    ridgeY += 0.075;
    if (i < 3) {
      sb.box(ridgeL - 0.04, 0.028, depth - 0.05, 0, ridgeY + 0.014, 0, SHIKKUI);
      ridgeY += 0.028;
    }
  }
  sb.box(ridgeL, 0.16, 0.3, 0, ridgeY + 0.08, 0, KAWARA_DARK);
  for (const sx of [-1, 1]) {
    const ox = sx * (ridgeL / 2 + 0.02);
    sb.box(0.14, 0.72, 0.78, ox, ry0 + 0.3, 0, KAWARA_DARK);
    sb.box(0.14, 0.34, 0.5, ox, ry0 + 0.8, 0, KAWARA_DARK);
    sb.box(0.14, 0.34, 0.14, ox + sx * 0.02, ry0 + 1.02, 0, KAWARA_DARK, { z: -sx * 0.35 });
  }

  // --- the crests ---------------------------------------------------------
  for (const s of ["-x", "+x"] as const) {
    const n = outward(s);
    const yc = h + RISE * 0.4;
    const face = w / 2 + SKIN;
    b.cyl(0.05, 0.92, 0.92, 20, n * (face + 0.025), yc, 0, SHIKKUI, { z: Math.PI / 2 });
    b.cyl(0.03, 0.74, 0.74, 20, n * (face + 0.065), yc, 0, NAMAKO, { z: Math.PI / 2 });
    for (const [du, dy, bw, bh] of crest) {
      sb.box(0.04, bh, bw, n * (face + 0.095), yc + dy, du, SHIKKUI);
    }
  }

  sb.flush(b);

  // --- the cores, emitted after what hides them -------------------------------
  b.box(w + 0.34, plinthH - 0.01, d + 0.34, 0, foot + (plinthH - 0.01) / 2, 0, GRANITE_DARK);
  b.box(w + 0.08, skirt, d + 0.08, 0, PLINTH + skirt / 2, 0, NAMAKO);
  b.box(w, h - skirtTop, d, 0, skirtTop + (h - skirtTop) / 2, 0, TSUCHI);
  return b;
}

/**
 * The marks a kura's crest may carry, as bars `[u, dy, width, height]` on its
 * black field: one, two and three bars (hikiryō), a cross, and the well frame
 * (igeta). A merchant's mark, not a sacred one, so it is white on black and
 * never vermilion.
 */
export const KURA_CRESTS: readonly (readonly [number, number, number, number][])[] = [
  [[0, 0, 0.56, 0.1]],
  [
    [0, 0.1, 0.56, 0.09],
    [0, -0.1, 0.56, 0.09],
  ],
  [
    [0, 0.15, 0.54, 0.08],
    [0, 0, 0.58, 0.08],
    [0, -0.15, 0.54, 0.08],
  ],
  [
    [0, 0, 0.56, 0.09],
    [0, 0, 0.09, 0.56],
  ],
  [
    [0, 0.1, 0.52, 0.07],
    [0, -0.1, 0.52, 0.07],
    [0.1, 0, 0.07, 0.52],
    [-0.1, 0, 0.07, 0.52],
  ],
];
