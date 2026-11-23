/**
 * kit/desert/fittings.ts — The hardware a desert-town house is fitted with:
 * its door, the joinery and ironwork in its windows, its roof spouts, its
 * electricity meter, and what stands on its roofline — a water tank on a
 * stand, a satellite dish, an aerial and an evaporative cooler. Each is a
 * `Fitting`: a KIND, a VARIANT and a frame (`x`, `y`, `z`, `yaw`), drawn by
 * `fit` into a `Lay` of its own. Part of the desert-town set: follows the
 * contract in kit/core.ts and the set's rules in `./index.ts`.
 *
 * Invariants: **a fitting's drawing is a function of its kind and its variant
 * ALONE**, in its own frame — never of the house it is fitted to, a random
 * stream or the ground — so every `(kind, v)` is one fixed drawing, and the
 * frame is a placement of it (a translation and a turn about the vertical,
 * never a mirror). That is the seam two cheaper ways of drawing a town of
 * these hang off: the frames are instance transforms of a few dozen
 * variants built once, and a builder that flushes its fittings into a batch
 * of their own keeps them apart from its masonry, where a range or a flag can
 * find them. VISUAL only: nothing here declares a collider, and what a
 * fitting may project past its face is in each one's own comment — the side
 * walls of a terrace stand half a metre from their neighbours.
 *
 * Never: imports a builder, reads `Math.random()`, or sizes a part off
 * anything but the constants here and in `./shared.ts`.
 */
import { ALLOY, IRON, TEAK, eye, rod, type Lay, type V3 } from "../core";
import { MUDBRICK, MUDBRICK_DARK, PALM_BEAM, PARAPET, PARAPET_T, SANDBAG, T, WINDOW_VOID } from "./shared";

/** What a fitting is. */
export type FittingKind = "window" | "door" | "meter" | "spout" | "tank" | "dish" | "aerial" | "cooler";

/**
 * One fitting: its kind, its variant, and its frame — the point it is
 * anchored at and its turn about the vertical, local -Z being the way it
 * faces out. Each kind's comment says where its anchor is.
 */
export interface Fitting {
  kind: FittingKind;
  v: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** A window's opening: the dark room behind it. */
export const WINDOW_W = 0.9;
export const WINDOW_H = 1.1;
/** The window's variants. */
export const WIN = { grille: 0, open: 1, shut: 2, sandbagged: 3, broken: 4 } as const;
/** A door's opening, as `doorWall` cuts it: 1.3 m, and 2.2 from the wall's foot, which is the plinth's under it. */
export const DOOR_W = 1.3;
export const DOOR_H = 1.95;
/** The door's variants: the first three hang in a real opening, the last three on a wall with none. */
export const DOOR = { back: 0, torn: 1, steelBack: 2, shut: 3, steelShut: 4, bricked: 5 } as const;
/** The spout's variants. */
export const SPOUT = { palm: 0, tin: 1 } as const;
/** The tank's variants. */
export const TANK = { round: 0, box: 1 } as const;
/** The cooler's duct turns over a parapet this tall and this thick, so its anchor is the wall face at the roof's top. */
const CAP = PARAPET + 0.14;

/** The box face that looks back at the wall a fitting is on (local +Z). */
const BACK = 1 << 4;
/** The box face that looks out from it (local -Z): the wall side of a leaf folded back INSIDE. */
const FRONT = 1 << 5;
/** The underside, which nothing looks up at. */
const DOWN = 1 << 3;
/** A bar's two end caps along local X. */
const ENDS_X = 1 | (1 << 1);
/** A bar's two end caps along local Z. */
const ENDS_Z = (1 << 4) | (1 << 5);

/**
 * A fitting's frame: `a` along its face (local +X), `y` up, `o` out from the
 * face (local -Z) — Babylon's turn about Y, so a box laid here with the
 * frame's `yaw` is the box `StoneBatch` turns.
 */
class Frame {
  private readonly c: number;
  private readonly s: number;
  constructor(
    readonly lay: Lay,
    readonly f: Fitting,
  ) {
    this.c = Math.cos(f.yaw);
    this.s = Math.sin(f.yaw);
  }

  /** A point in the frame. */
  p(a: number, y: number, o: number): V3 {
    return [this.f.x + a * this.c - o * this.s, this.f.y + y, this.f.z - a * this.s - o * this.c];
  }

  /** A direction in the frame. */
  dir(a: number, y: number, o: number): V3 {
    return [a * this.c - o * this.s, y, -a * this.s - o * this.c];
  }

  /** A box centred at `(a, y, o)`: `along` the face, `tall`, `thick` through it; `tilt` leans it in the face's plane, `turn` about the vertical. */
  box(a: number, y: number, o: number, along: number, tall: number, thick: number, color: string, hide = 0, tilt = 0, turn = 0): void {
    const [x, yy, z] = this.p(a, y, o);
    this.lay.sb.box(along, tall, thick, x, yy, z, color, { y: this.f.yaw + turn, z: tilt }, hide);
  }
}

/** Draws one fitting into `lay`. */
export function fit(lay: Lay, f: Fitting): void {
  DRAW[f.kind](new Frame(lay, f), f.v);
}

const DRAW: Record<FittingKind, (F: Frame, v: number) => void> = {
  window,
  door,
  meter,
  spout,
  tank,
  dish,
  aerial,
  cooler,
};

// --- the window ---------------------------------------------------------------------

/**
 * A window's joinery, anchored at the middle of its sill on the wall's face:
 * the dark room behind it, the palm frame's two stiles and the palm lintel
 * the opening is built under — and in it an iron grille, two board shutters
 * folded back on the wall or shut, the sandbags of a firing position with a
 * slit left over them, or nothing but one stile hanging where the frame was
 * torn out. The reveal and the sill round it are the wall's, and the
 * builder's: they are the colour of the render they are returned in.
 *
 * Projects 0.12 m at the lintel and 0.27 at the sandbags, which only a
 * builder that knows the face is a street's may ask for.
 */
function window(F: Frame, v: number): void {
  const ww = WINDOW_W;
  const wh = WINDOW_H;
  if (v !== WIN.shut) F.box(0, wh / 2, 0.01, ww, wh, 0.02, WINDOW_VOID, BACK);
  F.box(0, wh + 0.17, 0.06, ww + 0.6, 0.16, 0.12, PALM_BEAM, BACK);
  if (v === WIN.grille || v === WIN.open) {
    for (const e of [-1, 1]) F.box(e * (ww / 2 - 0.03), wh / 2, 0.03, 0.06, wh, 0.03, PALM_BEAM, BACK);
  }
  if (v === WIN.grille) {
    for (const a of [-0.22, 0, 0.22]) F.box(a, wh / 2, 0.045, 0.025, wh - 0.02, 0.025, IRON, BACK);
    F.box(0, wh * 0.52, 0.06, ww - 0.08, 0.025, 0.025, IRON, BACK);
  } else if (v === WIN.open) {
    // Back on the wall, clear of the reveal's jambs, each on one batten.
    for (const e of [-1, 1]) {
      const a = e * (ww / 2 + 0.12 + 0.235);
      F.box(a, wh / 2, 0.022, 0.45, wh - 0.04, 0.035, PALM_BEAM, BACK, e * 0.012);
      F.box(a, wh * 0.62, 0.05, 0.4, 0.06, 0.02, TEAK, BACK);
    }
  } else if (v === WIN.shut) {
    // Shut in the reveal, a finger's gap between the leaves showing the room.
    F.box(0, wh / 2, 0.006, 0.04, wh - 0.04, 0.012, WINDOW_VOID, BACK);
    for (const e of [-1, 1]) F.box(e * (ww / 4 + 0.006), wh / 2, 0.025, ww / 2 - 0.012, wh - 0.02, 0.035, PALM_BEAM, BACK);
    for (const y of [0.26, 0.76]) F.box(0, wh * y, 0.05, ww - 0.04, 0.06, 0.02, TEAK, BACK);
  } else if (v === WIN.sandbagged) {
    // Three courses of two, broken joint, then the slit, then a course over it.
    const bag = (a: number, y: number, turn: number, tilt: number): void =>
      F.box(a, y, 0.13, 0.44, 0.17, 0.3, SANDBAG, BACK, tilt, turn);
    bag(-0.22, 0.085, 0.04, 0.02);
    bag(0.23, 0.09, -0.05, -0.03);
    bag(-0.2, 0.25, -0.03, -0.04);
    bag(0.22, 0.255, 0.06, 0.02);
    bag(-0.23, 0.415, 0.05, 0.03);
    bag(0.21, 0.42, -0.02, -0.02);
    bag(-0.21, 0.98, -0.04, 0.03);
    bag(0.22, 0.99, 0.05, -0.02);
  } else {
    // Torn out: one stile left, hanging off its top.
    F.box(-(ww / 2 - 0.1), wh * 0.55, 0.035, 0.06, wh * 0.9, 0.03, PALM_BEAM, BACK, -0.24);
  }
}

// --- the door -----------------------------------------------------------------------

/**
 * The door, anchored at the middle of its threshold — the plinth's top — on
 * the wall's outer face, `DOOR_W` by `DOOR_H` as `doorWall` cuts it. Every
 * variant has a palm frame on the face, a palm lintel over it and a lamp on
 * a bracket beside it. In a REAL opening (`back`, `torn`, `steelBack`) the
 * reveal is lined in palm boards, a threshold stone lies through it and the
 * leaves stand folded back against the wall INSIDE — or one does and the
 * other lies on the floor where it was torn off. On a wall with no opening
 * (`shut`, `steelShut`, `bricked`) the door is shut on a padlocked hasp, or
 * it is a sheet-steel one with its panels pressed in, or the doorway has been
 * filled with fresh mud brick under the old lintel; a step stands on the
 * plinth in front of each. So an open doorway in this town is one you can
 * walk through, and nothing that looks shut is.
 *
 * Projects 0.14 m at the lintel and 0.4 at the step, which is on the
 * plinth; the torn leaf lies inside, under 6 cm high.
 */
function door(F: Frame, v: number): void {
  const dw = DOOR_W;
  const dh = DOOR_H;
  const real = v <= DOOR.steelBack;
  // The frame on the face, the lintel, the lamp.
  for (const e of [-1, 1]) F.box(e * (dw / 2 + 0.07), dh / 2 + 0.04, 0.03, 0.14, dh + 0.08, 0.06, PALM_BEAM, BACK);
  F.box(0, dh + 0.07, 0.03, dw + 0.28, 0.14, 0.06, PALM_BEAM, BACK);
  F.box(0, dh + 0.25, 0.07, dw + 0.9, 0.2, 0.14, PALM_BEAM, BACK);
  F.box(dw / 2 + 0.3, dh + 0.55, 0.15, 0.03, 0.03, 0.3, IRON, ENDS_Z);
  F.box(dw / 2 + 0.3, dh + 0.5, 0.29, 0.13, 0.08, 0.13, ALLOY);

  if (real) {
    // The lining and the threshold, through the wall's thickness.
    for (const e of [-1, 1]) F.box(e * (dw / 2 - 0.015), dh / 2, -T / 2, 0.03, dh, T, PALM_BEAM, e < 0 ? 1 << 1 : 1);
    F.box(0, dh - 0.015, -T / 2, dw - 0.06, 0.03, T, PALM_BEAM, 1 << 2);
    F.box(0, 0.02, (0.25 - T) / 2, dw, 0.04, T + 0.25, MUDBRICK, DOWN);
    const steel = v === DOOR.steelBack;
    const leafColor = steel ? IRON : PALM_BEAM;
    // The leaves, folded back against the wall's inside face.
    const inner = -T - 0.026;
    for (const e of [-1, 1]) {
      if (v === DOOR.torn && e > 0) continue;
      const a = e * (dw / 2 + 0.33);
      F.box(a, dh / 2, inner, 0.64, dh - 0.06, 0.05, leafColor, FRONT);
      if (steel) {
        for (const y of [0.45, 0.98, 1.5]) F.box(a, y, inner - 0.03, 0.56, 0.06, 0.012, IRON, FRONT);
      } else {
        for (const y of [0.32, 0.98, 1.62]) F.box(a, y, inner - 0.033, 0.58, 0.05, 0.016, IRON, FRONT);
      }
    }
    if (v === DOOR.torn) {
      // The other leaf, flat on the floor inside where it fell.
      F.box(0.25, 0.028, -T - 1.1, 0.64, 0.05, dh - 0.06, PALM_BEAM, DOWN, 0, 0.32);
      for (const t of [-0.6, 0, 0.6]) {
        const [ca, co] = [Math.cos(0.32), Math.sin(0.32)];
        F.box(0.25 + t * co, 0.059, -T - 1.1 + t * ca, 0.58, 0.012, 0.05, IRON, DOWN, 0, 0.32);
      }
    }
    return;
  }

  // On a wall with no opening: a step on the plinth.
  F.box(0, 0.06, 0.2, dw + 0.3, 0.12, 0.4, MUDBRICK_DARK, DOWN);
  if (v === DOOR.bricked) {
    // The doorway filled under the old lintel: a mortar ground and five
    // courses of new brick laid two to a course, a little proud of it.
    F.box(0, dh / 2, 0.012, dw, dh, 0.024, MUDBRICK_DARK, BACK);
    for (let k = 0; k < 5; k++) {
      const y = 0.2 + k * 0.38;
      const off = k % 2 ? 0.14 : -0.1;
      F.box(off - 0.32, y, 0.03, 0.6, 0.32, 0.03, MUDBRICK, BACK);
      F.box(off + 0.33, y, 0.03, k % 2 ? 0.34 : 0.56, 0.32, 0.03, MUDBRICK, BACK);
    }
    return;
  }
  // Shut: the leaves in the frame, the dark of the joint between them.
  F.box(0, dh / 2, 0.006, 0.04, dh, 0.012, WINDOW_VOID, BACK);
  const steel = v === DOOR.steelShut;
  const leafColor = steel ? IRON : PALM_BEAM;
  for (const e of [-1, 1]) F.box(e * (dw / 4 + 0.006), dh / 2, 0.025, dw / 2 - 0.012, dh, 0.05, leafColor, BACK);
  if (steel) {
    // Two panels pressed into each leaf, and the bar across both.
    for (const e of [-1, 1]) {
      for (const y of [0.5, 1.4]) F.box(e * (dw / 4 + 0.006), y, 0.055, dw / 2 - 0.16, 0.68, 0.012, IRON, BACK);
    }
    F.box(0, 1.0, 0.07, dw - 0.1, 0.06, 0.02, IRON, BACK);
  } else {
    for (const y of [0.3, 0.98, 1.66]) F.box(0, y, 0.058, dw - 0.06, 0.05, 0.016, IRON, BACK);
  }
  // The hasp and its padlock.
  F.box(0.03, 1.08, 0.065, 0.16, 0.04, 0.02, IRON, BACK);
  F.box(0.08, 1.0, 0.08, 0.06, 0.08, 0.03, ALLOY, BACK);
}

// --- the meter, the spout ---------------------------------------------------------------

/**
 * The electricity meter, anchored at its middle on the wall's face: its box,
 * its dial, and the conduit's foot, which the builder carries on up to the
 * wall head. Projects 0.16 m.
 */
function meter(F: Frame): void {
  F.box(0, 0, 0.07, 0.3, 0.42, 0.14, ALLOY, BACK);
  F.box(0, 0.04, 0.15, 0.12, 0.1, 0.02, WINDOW_VOID, BACK);
  F.box(0, 0.36, 0.02, 0.04, 0.3, 0.04, IRON, BACK);
}

/**
 * A roof spout through the parapet's foot, anchored on the wall's face at
 * its middle: a split palm log with the dark of its channel at the mouth, or
 * a channel of galvanised sheet. The wash it leaves is the wall's.
 * Projects 0.62 m, so a builder puts it on a street face only.
 */
function spout(F: Frame, v: number): void {
  if (v === SPOUT.palm) {
    F.box(0, 0, 0.27, 0.16, 0.14, 0.62, PALM_BEAM, BACK);
    F.box(0, 0.035, 0.585, 0.08, 0.05, 0.012, WINDOW_VOID, BACK);
    return;
  }
  F.box(0, -0.05, 0.26, 0.2, 0.015, 0.56, ALLOY, BACK);
  for (const e of [-1, 1]) F.box(e * 0.095, 0, 0.26, 0.012, 0.1, 0.56, ALLOY, BACK);
}

// --- the roofline ------------------------------------------------------------------------

/**
 * A galvanised water tank on a stand of angle iron, anchored at the top of a
 * parapet's CORNER, with the frame turned so the two runs that meet there go
 * inboard along -a and -o. Three legs stand on the caps — one on the corner,
 * one along each run — under a frame of two bearers, which puts the tank's
 * underside 2.4 m over the deck it overhangs and its body wholly inside the
 * walls' faces; the feed pipe comes down the corner leg. Round or a riveted
 * box. The tallest thing on most roofs in the town.
 */
function tank(F: Frame, v: number): void {
  const H = 1.35;
  const L = 1.2;
  for (const [a, o] of [
    [0, 0],
    [-L, 0],
    [0, -L],
  ] as const) {
    F.box(a, H / 2, o, 0.05, H, 0.05, IRON, DOWN);
  }
  F.box(-L / 2, H + 0.04, 0, L + 0.05, 0.08, 0.06, IRON, ENDS_X);
  F.box(0, H + 0.04, -L / 2, 0.06, 0.08, L + 0.05, IRON, ENDS_Z);
  const y0 = H + 0.08;
  const [cx, , cz] = F.p(-0.5, 0, -0.5);
  if (v === TANK.round) {
    const m = F.lay.m(ALLOY);
    tube(m, cx, cz, 0.42, F.f.y + y0, F.f.y + y0 + 0.85, F.f.yaw);
    F.box(-0.5, y0 + 0.88, -0.5, 0.3, 0.06, 0.3, ALLOY, DOWN);
  } else {
    F.box(-0.5, y0 + 0.4, -0.5, 0.9, 0.8, 0.9, ALLOY, DOWN);
    for (const y of [0.2, 0.6]) F.box(-0.5, y0 + y, -0.5, 0.92, 0.035, 0.92, ALLOY, DOWN);
    F.box(-0.5, y0 + 0.82, -0.5, 0.3, 0.04, 0.3, ALLOY, DOWN);
  }
  rod(F.lay, F.p(-0.28, H + 0.08, -0.28), F.p(-0.04, 0.02, -0.04), 0.04, IRON);
}

/** An eight-sided drum standing from `y0` to `y1`, its top closed. */
function tube(m: ReturnType<Lay["m"]>, cx: number, cz: number, r: number, y0: number, y1: number, yaw: number): void {
  const n = 8;
  const k0 = 1 / Math.cos(Math.PI / n);
  const at = (i: number, y: number): V3 => {
    const t = yaw + ((i - 0.5) * 2 * Math.PI) / n;
    return [cx + Math.sin(t) * r * k0, y, cz + Math.cos(t) * r * k0];
  };
  for (let i = 0; i < n; i++) {
    const t = yaw + (i * 2 * Math.PI) / n;
    m.quad(at(i, y0), at(i + 1, y0), at(i + 1, y1), at(i, y1), [Math.sin(t), 0, Math.cos(t)]);
  }
  for (let i = 1; i + 1 < n; i++) m.tri(at(0, y1), at(i, y1), at(i + 1, y1), [0, 1, 0]);
}

/**
 * A satellite dish on a parapet's cap, anchored on the cap's top with the
 * frame turned to the dish's AIM rather than to the face — every dish in a
 * town looks at the same satellite, so a builder turns the frame to one
 * bearing in the world. A foot plate, a mast, the dish tilted up to its
 * elevation and the arm carrying the feed out in front of it.
 */
function dish(F: Frame): void {
  F.box(0, 0.01, 0, 0.26, 0.02, 0.2, IRON, DOWN);
  F.box(0, 0.32, 0, 0.045, 0.62, 0.045, IRON, DOWN);
  const el = 0.62;
  const ax = F.dir(0, Math.sin(el), Math.cos(el));
  const at = F.p(0, 0.62, 0.02);
  eye(F.lay.m(ALLOY), at, ax, 0.05, 0.36, 0.13, 8, true, false);
  const feed = F.p(0, 0.62 + 0.42 * Math.sin(el) - 0.04, 0.02 + 0.42 * Math.cos(el));
  rod(F.lay, F.p(0, 0.62 - 0.3 * Math.cos(el), 0.02 + 0.3 * Math.sin(el) + 0.04), feed, 0.022, IRON);
  const [fx, fy, fz] = feed;
  F.lay.sb.box(0.06, 0.06, 0.1, fx, fy, fz, IRON, { y: F.f.yaw, x: -el });
}

/**
 * An aerial strapped up a parapet's outer face, anchored on the face at the
 * cap's top: the mast from just over the string course to two metres over
 * the roof, two straps, and a yagi on its head with its boom out over the
 * street. Projects 0.5 m at the boom.
 */
function aerial(F: Frame): void {
  F.box(0, 0.55, 0.06, 0.035, 2.9, 0.035, IRON, DOWN);
  for (const y of [-0.62, -0.12]) F.box(0, y, 0.035, 0.12, 0.05, 0.07, IRON, BACK);
  F.box(0, 1.95, 0.06, 0.025, 0.025, 1.0, IRON, ENDS_Z);
  for (let i = 0; i < 5; i++) F.box(0, 1.95, 0.06 + 0.42 - i * 0.21, 0.62 - i * 0.07, 0.02, 0.02, IRON, ENDS_X);
}

/**
 * An evaporative cooler hung on the outer face at the roof's height,
 * anchored on the face at the roof's top (the deck under the parapet): the
 * cabinet on two brackets and two struts, its louvres, and its duct climbing
 * the parapet, over the cap and down its inside face into the roof. The
 * cabinet's foot is 0.4 m under the roof, which on every house here is more
 * than a storey over the street. Projects 0.64 m.
 */
function cooler(F: Frame): void {
  F.box(0, 0.3, 0.33, 0.8, 0.6, 0.62, ALLOY, BACK);
  for (let i = 0; i < 4; i++) F.box(0, 0.1 + i * 0.13, 0.65, 0.66, 0.03, 0.02, IRON, BACK);
  for (const e of [-1, 1]) {
    F.box(e * 0.3, -0.02, 0.33, 0.04, 0.04, 0.62, IRON, ENDS_Z);
    rod(F.lay, F.p(e * 0.3, -0.4, 0.02), F.p(e * 0.3, -0.03, 0.6), 0.035, IRON);
  }
  F.box(0, 0.88, 0.17, 0.34, 0.56, 0.3, ALLOY, BACK);
  F.box(0, CAP + 0.15, -0.16, 0.34, 0.3, 0.96, ALLOY);
  F.box(0, CAP - 0.25, -PARAPET_T - 0.1, 0.34, 0.5, 0.2, ALLOY, DOWN);
}
