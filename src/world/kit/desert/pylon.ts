/**
 * kit/desert/pylon.ts — buildPylon: an 11 kV distribution pole of the state
 * grid, and the SPAN of line it carries to the next one. A precast concrete
 * H-section pole, its web pierced up its length, with a steel channel
 * crossarm on three pin insulators and a bundled low-voltage cable hung under
 * them. Seeded: some poles carry a transformer, some a stork's nest, some a
 * shell's bite or anti-climb wire, and some spans have lost a phase to a
 * shell and its metal to a scrap man. The last pole of a run takes the line
 * underground.
 * Part of the desert-town set: follows the contract in kit/core.ts and the
 * set's rules in `./index.ts`. Invariants: ONE collider, the ray-only post,
 * stated by hand ahead of every drawn part; every height a span meets is a
 * module constant (`ARM_Y`, `WIRE_Y`, `LV_Y`), never a function of the pole's
 * own `height`; seeded off where it stands (`streetSeed`), never
 * `Math.random()`. Never imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  ALLOY,
  Build,
  CONCRETE,
  IRON,
  Lay,
  NO_ENDS,
  TIMBER,
  band,
  disc,
  eye,
  orient,
  streetSeed,
  type BuildCtx,
  type BuildParams,
  type Mesher,
  type Point3,
  type Structure,
  type V3,
} from "../core";
import { PALM_BEAM, SANDBAG, WHITEWASH } from "./shared";

// --- the line's geometry -----------------------------------------------------
//
// **Every height a span meets is fixed here, or a span misses the pole it is
// strung to.** A pole carries the span AHEAD of it and knows nothing about the
// next pole but the ground under it, so a span drawn to THIS pole's own
// crossarm would land wherever the next pole's crossarm is not — the layout's
// poles run 7.8 to 9.2 m, a metre and a half of disagreement. A real line is
// strung at one attachment height and its poles differ only in how much stands
// over the crossarm, so `height` is where the pole's TOP is and nothing else.
// Everything under the top is the line's.

/** The crossarm's centre, the head of its channel, and the conductor's groove on a pin. */
const ARM_Y = 7.45;
const ARM_TOP = ARM_Y + 0.05;
const WIRE_Y = ARM_TOP + 0.225;
/** The three phases, across the line: flat, one of them close in to the pole. */
const PHASES = [-1.02, 0.36, 1.02] as const;
/** The low-voltage bundle: its clamp, the height it hangs at, and its side of the pole. */
const LV_Y = 5.7;
const LV_WIRE = LV_Y - 0.04;
const LV_Z = -0.3;
/** The pole's depth along the line at the ground, and what it loses a metre up it. */
const D0 = 0.3;
const TAPER = 0.01;
/** The flanges' width across the line and their thickness, and the web's. */
const FW = 0.26;
const TF = 0.055;
const TW = 0.07;
/** The web's piercings: the first one's centre, the pitch, and each one's height. */
const HOLE0 = 0.95;
const HOLE_PITCH = 0.5;
const HOLE_H = 0.26;
/** The danger plate's centre on the +X flange: the number is stencilled over it, the anti-climb wire over that. */
const PLATE_Y = 2.55;

/** The pole's depth along the line at height `y` — the same on every pole, so the arm is too. */
const depth = (y: number): number => D0 - TAPER * y;
/** The +X flange's outer face at `y`: where the crossarm, the plates and the cabinet are bolted. */
const face = (y: number): number => depth(y) / 2;
/** Where the conductors run along the line: over the middle of the channel's head. */
const ARM_X = face(ARM_Y) + 0.03;

/**
 * A pole of the state grid, and the span of line from it to the next one.
 *
 * **The span is what this builder is for, and it is why the wire lives on the
 * pole rather than between two of them.** A placement is built at the origin
 * and knows nothing about any other placement, so a line of poles with the
 * cable authored between them is not expressible here at all. What is
 * expressible is a pole that carries the segment AHEAD of it: `length` is the
 * distance to the next pole along local +X, and a chain of them at that pitch
 * draws one continuous line — because every height a span meets is the same on
 * every pole (the constants above) and the one thing that differs, the ground,
 * is asked of the world. The last pole in a run states no `length`, and the
 * line goes down it into the ground, which is what a line arriving at a town
 * does.
 *
 * **What it is FOR is the middle distance.** Sarab is 900 m of play square
 * with quarters in it and open ground between them, and open ground with
 * nothing on it reads as no distance at all: the eye has no object between the
 * body and the haze to measure against. A line of poles at a known pitch is
 * the cheapest ruler there is — it states the scale of the ground it crosses,
 * and it says which way the road goes from a mile off. Every part of it is in
 * the map's own palette, so it merges into the block it stands in. The pale
 * porcelain on the crossarm is what makes a line legible against sand at
 * range; the H-section's piercings are what it reads by from the road beside
 * it.
 *
 * **The post is a `strut` and the wire is not solid at all.** A 0.28 m post is
 * exactly the shape `NavGrid` gets wrong (see the rule in `CLAUDE.md`), so it
 * stops a round and a look and is invisible to navigation, the cover bake and
 * the obstacle field — the fence's posts, one vernacular over. The cable is
 * drawn and nothing more: a round that clipped a cable seven metres up would
 * be a hitscan stopping in the sky. Everything hung on the pole is overhead or
 * thin on its face, and what lies at its foot is under a boot's height.
 */
export function buildPylon(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "pylon");
  const h = p.height ?? 8.4;
  /** Distance to the NEXT pole along local +X. 0 draws no span. */
  const span = p.length ?? 0;

  // The collider, stated by hand: a 0.28 m square ray-only post, the box the
  // H-section is drawn round, so the drawing below can change without moving
  // a byte of what a round meets.
  b.colliders.push({ w: 0.28, h, d: 0.28, x: 0, y: h / 2, z: 0, rotX: undefined, rotY: undefined, rayOnly: true });

  const rnd = mulberry32(streetSeed(0.28, span, h, ctx));
  const cos = ctx ? Math.cos(ctx.rotY) : 1;
  const sin = ctx ? Math.sin(ctx.rotY) : 0;
  /** The ground under a local point, relative to this pole's: the floor MapBuilder dropped it to. */
  const ground = (lx: number, lz: number): number =>
    ctx ? ctx.terrain.heightAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y : 0;

  const lay = new Lay();
  const conc = lay.m(CONCRETE);
  const porc = lay.m(WHITEWASH);

  // What each pole is, drawn off its seed in a fixed order so a change to one
  // choice's odds never re-rolls another's.
  const transformer = rnd() < 0.25;
  const nest = rnd() < 0.45 && h - ARM_TOP > 1.0;
  const wired = rnd() < 0.45;
  const bite = rnd() < 0.3;
  const cut = rnd() < 0.06;
  const phase = Math.floor(rnd() * 3);
  const broken = cut && span > 0.5 ? phase : -1;

  const foot = Math.min(ground(-0.2, -0.15), ground(0.2, -0.15), ground(-0.2, 0.15), ground(0.2, 0.15)) - 0.25;

  // --- the pole ---------------------------------------------------------------
  //
  // Two flanges facing along the line and a web between them across it, so the
  // crossarm bolts flat to a flange and the web's piercings are seen from the
  // road the line follows — the ladder every precast pole in the region reads
  // as. A shell's bite takes a notch out of one flange's edge and leaves its
  // bars standing in it.
  const biteSx = rnd() < 0.5 ? -1 : 1;
  const biteSz = rnd() < 0.5 ? -1 : 1;
  const biteY0 = 1.8 + rnd() * 3.2;
  const biteY1 = biteY0 + 0.35 + rnd() * 0.35;
  const biteIn = 0.08 + rnd() * 0.04;
  for (const sx of [-1, 1]) {
    if (bite && sx === biteSx) {
      flange(conc, sx, foot, biteY0, -FW / 2, FW / 2);
      const z0 = biteSz < 0 ? -FW / 2 + biteIn : -FW / 2;
      const z1 = biteSz > 0 ? FW / 2 - biteIn : FW / 2;
      flange(conc, sx, biteY0, biteY1, z0, z1);
      flange(conc, sx, biteY1, h, -FW / 2, FW / 2);
    } else {
      flange(conc, sx, foot, h, -FW / 2, FW / 2);
    }
  }
  if (bite) {
    // The two bars in the flange's corner, bent out where the concrete went.
    const xm = biteSx * (depth(biteY0) / 2 - TF / 2);
    for (const dx of [-0.015, 0.015]) {
      const zb = biteSz * (FW / 2 - 0.045);
      const mid: Point3 = [xm + dx, (biteY0 + biteY1) / 2, zb + biteSz * 0.03];
      rod3(lay, [xm + dx, biteY0 - 0.03, zb], mid, 0.012, IRON);
      rod3(lay, mid, [xm + dx, biteY1 + 0.03, zb], 0.012, IRON);
    }
    // What came off it, at its foot.
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.5 + rnd() * 0.5;
      const fx = biteSx * 0.2 + Math.cos(a) * r * 0.6;
      const fz = biteSz * 0.25 + Math.sin(a) * r;
      const s = 0.05 + rnd() * 0.06;
      lay.sb.box(s * 1.4, s, s * 1.1, fx, ground(fx, fz) + s * 0.35, fz, CONCRETE, { y: rnd() * 3, z: (rnd() - 0.5) * 0.6 });
    }
  }
  // The web, between its piercings. Its ends are buried in the flanges.
  let y = foot;
  for (let hc = HOLE0; hc + HOLE_H / 2 < h - 0.45; hc += HOLE_PITCH) {
    webPiece(lay, y, hc - HOLE_H / 2);
    y = hc + HOLE_H / 2;
  }
  webPiece(lay, y, h);

  // The collar it is set in, and the sand drifted against it.
  band(conc, 8, Math.PI / 8, 0.36, foot, 0.34, 0.16);
  band(conc, 8, Math.PI / 8, 0.34, 0.16, 0.2, 0.22);
  band(lay.m(SANDBAG), 9, 0.3, 0.85, -0.12, 0.4, 0.1);
  disc(lay.m(SANDBAG), 9, 0.3, 0.4, 0.3, 0.1);

  // --- the crossarm ---------------------------------------------------------
  //
  // A steel channel on edge, its back to the flange and its lips out, through-
  // bolted to a back plate on the far flange; flat braces from its underside
  // to the pole. The three pins stand on its upper lip.
  const xb = face(ARM_Y);
  const ARM = 2.3;
  lay.sb.box(0.012, 0.1, ARM, xb + 0.006, ARM_Y, 0, ALLOY);
  lay.sb.box(0.06, 0.012, ARM, xb + 0.03, ARM_TOP - 0.006, 0, ALLOY);
  lay.sb.box(0.06, 0.012, ARM, xb + 0.03, ARM_Y - 0.044, 0, ALLOY);
  lay.sb.box(0.01, 0.12, 0.2, -xb - 0.005, ARM_Y, 0, ALLOY);
  for (const z of [-0.06, 0.06]) {
    lay.sb.box(0.028, 0.03, 0.03, xb + 0.026, ARM_Y + 0.015, z, IRON);
    lay.sb.box(0.028, 0.03, 0.03, -xb - 0.024, ARM_Y + 0.015, z, IRON);
    lay.sb.box(depth(ARM_Y) + 0.08, 0.014, 0.014, 0, ARM_Y + 0.015, z, IRON, undefined, NO_ENDS);
  }
  for (const s of [-1, 1]) {
    bar(lay, [xb + 0.02, ARM_Y - 0.05, s * 0.78], [face(ARM_Y - 0.72) + 0.005, ARM_Y - 0.72, s * 0.06], 0.008, 0.045, ALLOY);
    lay.sb.box(0.028, 0.03, 0.03, face(ARM_Y - 0.72) + 0.02, ARM_Y - 0.72, s * 0.06, IRON);
  }
  for (const z of PHASES) pinInsulator(lay, porc, ARM_X, ARM_TOP, z);

  // --- the low-voltage bundle's clamp ----------------------------------------
  //
  // A through-bolt across the web to a suspension clamp beside the pole, so
  // the bundle passes the pole rather than through it.
  lay.sb.box(0.022, 0.022, -LV_Z + 0.04, 0, LV_Y, LV_Z / 2 - 0.02, IRON, undefined, NO_ENDS);
  lay.sb.box(0.05, 0.02, 0.05, 0, LV_Y, FW / 2 + 0.02, IRON);
  lay.sb.box(0.1, 0.07, 0.06, 0, LV_Y - 0.01, LV_Z, IRON);
  lay.sb.box(0.03, 0.09, 0.03, 0, LV_Y + 0.07, LV_Z + 0.02, IRON);

  // --- the plates, the earth and the wire ----------------------------------
  //
  // On the +X flange: the danger plate, its bolt and its header strip, and the
  // pole's number stencilled above it.
  const fp = face(PLATE_Y);
  lay.sb.box(0.008, 0.24, 0.19, fp + 0.004, PLATE_Y, 0, WHITEWASH);
  lay.sb.box(0.006, 0.04, 0.19, fp + 0.01, PLATE_Y + 0.1, 0, IRON);
  bar(lay, [fp + 0.011, PLATE_Y + 0.06, 0.035], [fp + 0.011, PLATE_Y - 0.005, -0.02], 0.004, 0.022, IRON);
  bar(lay, [fp + 0.011, PLATE_Y + 0.0, -0.03], [fp + 0.011, PLATE_Y - 0.01, 0.035], 0.004, 0.02, IRON);
  bar(lay, [fp + 0.011, PLATE_Y - 0.005, 0.025], [fp + 0.011, PLATE_Y - 0.09, -0.03], 0.004, 0.022, IRON);
  const fn = face(PLATE_Y + 0.42);
  let num = Math.floor(rnd() * 900) + 100;
  for (let i = 2; i >= 0; i--) {
    digit(lay, fn + 0.005, PLATE_Y + 0.42, (i - 1) * 0.075, num % 10);
    num = Math.floor(num / 10);
  }
  // The earth from the crossarm down the flange's edge to a rod at its foot.
  const ez = FW / 2 - 0.02;
  bar(lay, [face(ARM_Y - 0.1) + 0.004, ARM_Y - 0.1, ez], [face(0) + 0.004, foot + 0.2, ez], 0.025, 0.006, IRON);
  for (let ye = 1; ye < ARM_Y - 0.5; ye += 1.3) lay.sb.box(0.012, 0.03, 0.035, face(ye) + 0.01, ye, ez, IRON);
  if (wired) {
    // Anti-climb wire: three loose turns, nothing a lineman could not cut.
    const r = 0.24;
    for (let t = 0; t < 3; t++) {
      for (let k = 0; k < 8; k++) {
        const a0 = (k / 8) * Math.PI * 2 + t * 0.3;
        const a1 = ((k + 1) / 8) * Math.PI * 2 + t * 0.3;
        const y0 = 3.25 + t * 0.11 + k * 0.012;
        rod3(lay, [Math.cos(a0) * r, y0, Math.sin(a0) * r], [Math.cos(a1) * r, y0 + 0.012, Math.sin(a1) * r], 0.014, IRON);
      }
    }
  }

  // --- the nest ---------------------------------------------------------------
  //
  // Storks nest on the tall poles along every river road in the region and
  // nobody moves them; it is what the extra metre over the crossarm is for. A
  // flat heap rather than a bowl — two lobes of it, wider than they are deep —
  // and what makes it a nest rather than a pot is the sticks: laid round the
  // rim across each other, poking out of it, and hanging under it. Half of
  // them have their stork standing in them.
  if (nest) {
    const nm = lay.m(PALM_BEAM);
    const ph = rnd();
    band(nm, 7, ph, 0.16, h - 0.2, 0.46, h);
    band(nm, 7, ph, 0.46, h, 0.55, h + 0.17);
    band(nm, 7, ph, 0.55, h + 0.17, 0.44, h + 0.29);
    disc(nm, 7, ph, 0.44, 0, h + 0.25);
    const ox = (rnd() - 0.5) * 0.3;
    const oz = (rnd() - 0.5) * 0.3;
    band(nm, 6, ph + 1, 0.3, h - 0.08, 0.46, h + 0.1, ox, oz);
    band(nm, 6, ph + 1, 0.46, h + 0.1, 0.36, h + 0.24, ox, oz);
    for (let i = 0; i < 30; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.42 + rnd() * 0.16;
      const half = 0.3 + rnd() * 0.25;
      const y0 = h - 0.02 + rnd() * 0.3;
      const out = 0.05 + rnd() * 0.25;
      bar(lay, [Math.cos(a - half) * r, y0, Math.sin(a - half) * r], [Math.cos(a + half) * (r + out), y0 + (rnd() - 0.6) * 0.18, Math.sin(a + half) * (r + out)], 0.028, 0.024, i % 3 ? TIMBER : PALM_BEAM);
    }
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.2 + rnd() * 0.2;
      bar(lay, [Math.cos(a) * r, h - 0.08, Math.sin(a) * r], [Math.cos(a) * (r + 0.15), h - 0.35 - rnd() * 0.3, Math.sin(a) * (r + 0.15)], 0.022, 0.022, TIMBER);
    }
    if (rnd() < 0.5) {
      const yaw = rnd() * Math.PI * 2;
      const at = (f: number, y: number): [number, number, number] => [Math.sin(yaw) * f, y, Math.cos(yaw) * f];
      const put = (w: number, hh: number, d: number, f: number, y: number, pitch: number, color: string): void => {
        const [x, yy, z] = at(f, y);
        lay.sb.box(w, hh, d, x, yy, z, color, { y: yaw, x: pitch });
      };
      put(0.22, 0.2, 0.44, 0, h + 0.47, -0.12, WHITEWASH);
      put(0.24, 0.1, 0.24, -0.15, h + 0.46, -0.3, IRON);
      put(0.07, 0.3, 0.07, 0.2, h + 0.66, 0.25, WHITEWASH);
      put(0.08, 0.08, 0.13, 0.25, h + 0.82, 0, WHITEWASH);
      put(0.03, 0.03, 0.2, 0.39, h + 0.79, 0.3, SANDBAG);
    }
  }

  // --- the transformer ------------------------------------------------------
  //
  // On its bearers under the crossarm: the tank finned on both sides, its
  // three bushings fed through fuse cutouts on an arm of their own, and its
  // low-voltage side up into the bundle and down to the board at the foot.
  if (transformer) {
    const TY = 4.5;
    const tx = face(TY) + 0.52;
    for (const s of [-1, 1]) {
      lay.sb.box(0.9, 0.08, 0.05, face(TY) + 0.45, TY - 0.04, s * 0.22, IRON);
      bar(lay, [face(TY) + 0.85, TY - 0.08, s * 0.22], [face(TY - 0.85) + 0.01, TY - 0.85, s * 0.07], 0.01, 0.05, IRON);
    }
    lay.sb.box(0.5, 0.85, 0.62, tx, TY + 0.425, 0, ALLOY);
    lay.sb.box(0.56, 0.04, 0.68, tx, TY + 0.87, 0, ALLOY);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        lay.sb.box(0.012, 0.6, 0.09, tx - 0.18 + i * 0.09, TY + 0.4, s * 0.355, ALLOY);
      }
      lay.sb.box(0.42, 0.03, 0.03, tx, TY + 0.73, s * 0.37, ALLOY);
    }
    lay.sb.box(0.008, 0.12, 0.18, tx + 0.254, TY + 0.25, -0.12, WHITEWASH);
    const bush: V3[] = [];
    for (const z of [-0.2, 0, 0.2]) {
      const top = TY + 0.89;
      band(porc, 6, 0, 0.04, top, 0.035, top + 0.22);
      for (const dy of [0.05, 0.12]) {
        band(porc, 6, 0, 0.075, top + dy, 0.04, top + dy + 0.04);
        disc(porc, 6, 0, 0.075, 0.04, top + dy, false);
      }
      disc(porc, 6, 0, 0.035, 0, top + 0.22);
      bush.push([tx, top + 0.22, z]);
    }
    for (const z of [-0.18, -0.06, 0.06, 0.18]) {
      eye(porc, [tx + 0.25, TY + 0.62, z], [1, 0, 0], 0.035, 0.03, 0.09, 6);
    }
    // The cutouts, each a porcelain post with its fuse tube hung off it.
    const CUT_Y = ARM_Y - 1.0;
    const cx = face(CUT_Y) + 0.16;
    lay.sb.box(0.05, 0.05, 1.3, face(CUT_Y) + 0.03, CUT_Y, 0, ALLOY);
    PHASES.forEach((pz, i) => {
      const zc = (i - 1) * 0.45;
      lay.sb.box(0.16, 0.03, 0.04, face(CUT_Y) + 0.1, CUT_Y, zc, IRON);
      eye(porc, [cx, CUT_Y + 0.02, zc], [0.3, 1, 0], 0.035, 0.03, 0.34, 6, true, true);
      eye(porc, [cx + 0.03, CUT_Y + 0.12, zc], [0.3, 1, 0], 0.065, 0.04, 0.03, 6, false, true);
      eye(porc, [cx + 0.06, CUT_Y + 0.22, zc], [0.3, 1, 0], 0.065, 0.04, 0.03, 6, false, true);
      const lo: Point3 = [cx + 0.07, CUT_Y + 0.03, zc];
      const hi: Point3 = [cx + 0.17, CUT_Y + 0.36, zc];
      rod3(lay, lo, hi, 0.03, IRON);
      // The drop from the phase to the cutout, and from the cutout to the tank.
      lead(lay, [ARM_X, WIRE_Y, pz], [hi[0], hi[1] + 0.02, zc], 0.06);
      lead(lay, [lo[0], lo[1] - 0.02, zc], bush[i], 0.12);
    });
    // The low-voltage tails up into the bundle.
    lead(lay, [tx + 0.34, TY + 0.62, -0.06], [face(LV_Y) + 0.3, LV_Y + 0.05, -0.2], 0.05, 0.04);
    lead(lay, [face(LV_Y) + 0.3, LV_Y + 0.05, -0.2], [0.06, LV_WIRE, LV_Z], 0.04, 0.04);
    // The board at the foot, its rain hood, its door and its lock, and the
    // conduit up the flange to the tank.
    const BY = 1.95;
    const bx = face(BY) + 0.08;
    lay.sb.box(0.16, 0.65, 0.45, bx, BY, 0, ALLOY);
    lay.sb.box(0.2, 0.02, 0.5, bx + 0.02, BY + 0.34, 0, ALLOY, { z: -0.25 });
    lay.sb.box(0.006, 0.6, 0.006, bx + 0.082, BY, 0.0, IRON);
    lay.sb.box(0.02, 0.06, 0.03, bx + 0.09, BY + 0.02, 0.04, IRON);
    lay.sb.box(0.012, 0.05, 0.035, bx + 0.09, BY - 0.03, 0.04, IRON);
    for (const hy of [BY - 0.22, BY + 0.22]) lay.sb.box(0.02, 0.05, 0.02, bx + 0.08, hy, -0.225, IRON);
    rod3(lay, [face(BY + 0.32) + 0.035, BY + 0.32, 0.15], [face(TY - 0.06) + 0.035, TY - 0.06, 0.15], 0.045, IRON);
    rod3(lay, [face(BY - 0.32) + 0.035, BY - 0.32, -0.15], [face(0) + 0.035, foot, -0.15], 0.06, IRON);
  }

  // --- the end of the line ---------------------------------------------------
  //
  // No span ahead: the conductors are jumpered down to three sealing ends on
  // the far side of the pole, and the cable goes down a guard pipe into the
  // ground — the line goes under the town.
  if (span <= 0.5) {
    const TERM_Y = ARM_Y - 1.25;
    const tx = -face(TERM_Y) - 0.15;
    lay.sb.box(0.05, 0.05, 1.3, -face(TERM_Y) - 0.03, TERM_Y, 0, ALLOY);
    PHASES.forEach((pz, i) => {
      const zt = (i - 1) * 0.42;
      lay.sb.box(0.16, 0.03, 0.04, -face(TERM_Y) - 0.09, TERM_Y, zt, IRON);
      band(porc, 6, 0, 0.05, TERM_Y + 0.03, 0.04, TERM_Y + 0.5, tx, zt);
      for (let k = 0; k < 4; k++) {
        const sy = TERM_Y + 0.12 + k * 0.1;
        band(porc, 6, 0, 0.09, sy, 0.045, sy + 0.04, tx, zt);
        disc(porc, 6, 0, 0.09, 0.045, sy, false, tx, zt);
      }
      lay.sb.box(0.03, 0.08, 0.03, tx, TERM_Y + 0.54, zt, IRON);
      lead(lay, [ARM_X, WIRE_Y, pz], [tx, TERM_Y + 0.58, zt], 0.15);
      rod3(lay, [tx, TERM_Y + 0.03, zt], [-face(3.2) - 0.06, 3.2, 0], 0.045, IRON);
    });
    // The low-voltage bundle down into the same pipe.
    lead(lay, [0, LV_WIRE, LV_Z], [-face(3.3) - 0.06, 3.3, -0.03], 0.1, 0.06);
    rod3(lay, [-face(3.2) - 0.06, 3.25, 0], [-face(0) - 0.06, foot, 0], 0.1, IRON);
    for (let yc = 0.6; yc < 3.2; yc += 0.8) lay.sb.box(0.03, 0.04, 0.16, -face(yc) - 0.015, yc, 0, IRON);
  }

  // --- the span ----------------------------------------------------------
  //
  // From this pole's groove to the next pole's — the same point in its own
  // frame — over the ground between them. **The far end is the GROUND'S and
  // not this pole's**: a placement is translated to the floor under its own
  // centre, so the next pole stands `rise` over or under this one, and
  // `BuildCtx` carries the terrain to ask. Each conductor is the chord plus a
  // parabolic dip, which is a catenary between ends at different heights
  // near enough at this span; the dip comes in where a swell between the
  // poles would put the line within reach of a hand.
  if (span > 0.5) {
    const rise = ground(span, 0);
    const seg = Math.max(6, Math.round(span / 5));
    const fit = (want: number, at: number, z: number, clear: number): number => {
      let sag = want;
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        const room = at + rise * t - (ground(span * t, z) + clear);
        if (room < 4 * sag * t * (1 - t)) sag = Math.max(0, room / (4 * t * (1 - t)));
      }
      return sag;
    };
    PHASES.forEach((pz, i) => {
      if (i === broken) return;
      const sag = fit(Math.min(1.4, span * 0.028), WIRE_Y, pz, 5);
      catenary(lay, [ARM_X, WIRE_Y, pz], [span + ARM_X, WIRE_Y + rise, pz], sag, seg, 0.05);
    });
    const lvSag = fit(Math.min(1.9, span * 0.04), LV_WIRE, LV_Z, 3.6);
    catenary(lay, [0, LV_WIRE, LV_Z], [span, LV_WIRE + rise, LV_Z], lvSag, seg, 0.075);
    if (broken >= 0) {
      // A phase cut by a shell, and the run of it lifted for its metal: a
      // short end left hanging off each pin, this pole's and the next one's.
      // Nothing of it comes below four metres, because a builder that cannot
      // see the car parked under its span cannot lay a cable down across it.
      const pz = PHASES[broken];
      dangle(lay, [ARM_X, WIRE_Y, pz], 1, 1.4 + rnd() * 1.8, (rnd() - 0.5) * 0.6);
      dangle(lay, [span + ARM_X, WIRE_Y + rise, pz], -1, 1.4 + rnd() * 1.8, (rnd() - 0.5) * 0.6);
    }
  }

  lay.flush(b);
  return b;
}

/** One flange from `y0` to `y1` between `z0` and `z1`, on side `sx`, following the taper. */
function flange(m: Mesher, sx: number, y0: number, y1: number, z0: number, z1: number): void {
  const xo = (y: number): number => sx * (depth(y) / 2);
  const xi = (y: number): number => sx * (depth(y) / 2 - TF);
  const lo: V3[] = [
    [xi(y0), y0, z0],
    [xo(y0), y0, z0],
    [xo(y0), y0, z1],
    [xi(y0), y0, z1],
  ];
  const hi: V3[] = lo.map(([x, , z]) => [x === xi(y0) ? xi(y1) : xo(y1), y1, z]);
  const c: V3 = [(xi(y0) + xo(y0)) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const out = (pts: V3[]): V3 => {
    const f = [0, 1, 2].map((k) => pts.reduce((s, q) => s + q[k], 0) / pts.length);
    return [f[0] - c[0], f[1] - c[1], f[2] - c[2]];
  };
  const quad = (q: V3[]): void => m.quad(q[0], q[1], q[2], q[3], out(q));
  quad(hi);
  quad(lo);
  for (let k = 0; k < 4; k++) {
    const j = (k + 1) % 4;
    quad([lo[k], lo[j], hi[j], hi[k]]);
  }
}

/** A run of the web from `y0` to `y1`, its ends buried in the flanges. */
function webPiece(lay: Lay, y0: number, y1: number): void {
  if (y1 - y0 < 0.01) return;
  const ym = (y0 + y1) / 2;
  lay.sb.box(depth(ym) - 2 * TF + 0.01, y1 - y0, TW, 0, ym, 0, CONCRETE, undefined, 0b11);
}

/** A pin insulator on the arm's head at (`x`, `y`, `z`): the pin, two sheds, and the head the conductor lies in. */
function pinInsulator(lay: Lay, m: Mesher, x: number, y: number, z: number): void {
  lay.sb.box(0.026, 0.07, 0.026, x, y + 0.035, z, IRON);
  lay.sb.box(0.05, 0.03, 0.05, x, ARM_Y - 0.065, z, IRON);
  band(m, 8, 0, 0.045, y + 0.04, 0.05, y + 0.08, x, z);
  band(m, 8, 0, 0.13, y + 0.08, 0.06, y + 0.13, x, z);
  disc(m, 8, 0, 0.13, 0.045, y + 0.08, false, x, z);
  band(m, 8, 0, 0.06, y + 0.13, 0.055, y + 0.14, x, z);
  band(m, 8, 0, 0.105, y + 0.14, 0.055, y + 0.19, x, z);
  disc(m, 8, 0, 0.105, 0.055, y + 0.14, false, x, z);
  band(m, 8, 0, 0.055, y + 0.19, 0.05, y + 0.205, x, z);
  band(m, 8, 0, 0.04, y + 0.205, 0.04, y + 0.245, x, z);
  disc(m, 8, 0, 0.05, 0.04, y + 0.205, true, x, z);
  band(m, 8, 0, 0.05, y + 0.245, 0.035, y + 0.27, x, z);
  disc(m, 8, 0, 0.05, 0.04, y + 0.245, false, x, z);
  disc(m, 8, 0, 0.035, 0, y + 0.27, true, x, z);
  // The tie wire binding the conductor into the groove.
  lay.sb.box(0.14, 0.02, 0.095, x, y + 0.225, z, IRON);
}

/** A bar of section `w` x `t` from `a` to `c`, its flat side up. */
function bar(lay: Lay, a: Point3, c: Point3, w: number, t: number, color: string): void {
  const o = orient(a, c);
  lay.sb.box(w, t, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot);
}

/** A square rod from `a` to `c`, run on past both ends by half its section. */
function rod3(lay: Lay, a: Point3, c: Point3, r: number, color: string): void {
  const o = orient(a, c);
  lay.sb.box(r, r, o.len + r * 0.5, o.mid[0], o.mid[1], o.mid[2], color, o.rot, NO_ENDS);
}

/** A line from `a` to `c` in `seg` chords, dipping `sag` at mid-span. */
function catenary(lay: Lay, a: Point3, c: Point3, sag: number, seg: number, r: number): void {
  const at = (t: number): Point3 => [
    a[0] + (c[0] - a[0]) * t,
    a[1] + (c[1] - a[1]) * t - 4 * sag * t * (1 - t),
    a[2] + (c[2] - a[2]) * t,
  ];
  for (let i = 0; i < seg; i++) rod3(lay, at(i / seg), at((i + 1) / seg), r, IRON);
}

/** A slack lead from `a` to `c`, hanging `drop` at its middle. */
function lead(lay: Lay, a: Point3, c: Point3, drop: number, r = 0.022): void {
  const mid: Point3 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - drop, (a[2] + c[2]) / 2];
  rod3(lay, a, mid, r, IRON);
  rod3(lay, mid, c, r, IRON);
}

/**
 * The end of a cut conductor hanging off its pin at `from`: out along the
 * line (`dir`) a little way while it is still stiff off the tie, then down
 * for `len`, curling `curl` across.
 */
function dangle(lay: Lay, from: Point3, dir: number, len: number, curl: number): void {
  const [x, y, z] = from;
  const pts: Point3[] = [
    from,
    [x + dir * 0.35, y - 0.1, z],
    [x + dir * 0.55, y - 0.55, z + curl * 0.3],
    [x + dir * 0.6, y - len * 0.6, z + curl * 0.7],
    [x + dir * 0.48, y - len, z + curl],
  ];
  for (let k = 1; k < pts.length; k++) rod3(lay, pts[k - 1], pts[k], 0.05, IRON);
}

/** Which of a stencilled digit's seven strokes are painted: a, b, c, d, e, f, g. */
const SEGMENTS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f] as const;

/** A stencilled digit on the +X face at `x`, centred on (`y`, `z`), 0.1 m tall. */
function digit(lay: Lay, x: number, y: number, z: number, d: number): void {
  const w = 0.05;
  const hh = 0.05;
  const t = 0.012;
  const strokes: [number, number, number, number][] = [
    [0, hh, w, t],
    [w / 2, hh / 2, t, hh],
    [w / 2, -hh / 2, t, hh],
    [0, -hh, w, t],
    [-w / 2, -hh / 2, t, hh],
    [-w / 2, hh / 2, t, hh],
    [0, 0, w, t],
  ];
  strokes.forEach(([u, v, sw, sh], i) => {
    if (SEGMENTS[d] & (1 << i)) lay.sb.box(0.004, sh, sw, x, y + v, z + u, IRON);
  });
}
