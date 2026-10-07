/**
 * props/cask.ts — buildBarrel and caskData: the coopered cask, which the
 * structure kit's crate stack borrows (`kit/structures/small.ts`). Part of the
 * scatter set: follows the contract in `./index.ts`.
 */
import {
  CreateBoxVertexData,
  CreateCylinderVertexData,
  Material,
  Matrix,
  Mesh,
  Scene,
  VertexData,
} from "@babylonjs/core";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { partSurface } from "../parts";
import {
  newSheet,
  type Sheet,
  sheetData,
  sheetFace,
  sheetVert,
  type V3,
} from "./geometry";
import { BARK, DARK_METAL } from "./palette";

/**
 * The cask's staves: the kit's `PLANK` (`kit/core.ts`), which is what the
 * barrel always wore, so a yard of them costs a village no draw call.
 */
const CASK_WOOD = "#4a4034";
/** Height over the chimes, and the outer radius at the bilge and at each end. */
const CASK_H = 1.2;
const CASK_BELLY = 0.44;
const CASK_END = 0.37;
/** A stave's thickness, and how far its ends stand past the head (the chime). */
const STAVE_T = 0.024;
const CASK_CHIME = 0.04;
/** Half the open joint between two staves, metres across the face. */
const STAVE_JOINT = 0.0035;
/** A hoop's width, and how far its face stands off the staves. */
const HOOP_W = 0.045;
const HOOP_T = 0.007;

/** The cask's outer radius at `y`: a parabolic bilge, widest at the middle. */
function caskR(y: number): number {
  const u = (y - CASK_H / 2) / (CASK_H / 2);
  return CASK_END + (CASK_BELLY - CASK_END) * (1 - u * u);
}

/**
 * Abandoned cask — small hard cover, and the village's loose change: a
 * coopered barrel stood on its end and left where it was emptied. Eighteen to
 * twenty-one staves of unequal width (a cooper uses the timber he has), each
 * FLAT across its face and bent to the bilge, with a hair of open joint
 * between it and the next; four iron hoops driven on over them — a chime hoop
 * at each end and a quarter hoop inside it; the staves standing a few
 * centimetres past the head as the chime, and the head itself four or five
 * boards across with their seams open. A bung in the belly, in one stave.
 *
 * **It was a tapered octagon with two bands round it**, wider at the foot than
 * at the head — a post, not a barrel. What makes a cask read is the BILGE (the
 * belly wider than either end) and the staves: flat faces are what the cel
 * bands turn into a ring of planks, and the joints and the hoops' top edges
 * are steps the ink can find, so those are where its vertices go.
 *
 * Abandoned, so it has decayed the way a cask does: it dries out, the staves
 * shrink and the hoops come loose. A quarter hoop has slid down towards the
 * bilge; a stave has sprung proud between the quarter hoops; a head board has
 * fallen in, so the dark inside shows through the slot; or the top chime hoop
 * has gone altogether — it lies on the ground at the foot — the staves have
 * sprung open over the quarter hoop, the head has dropped in, and rainwater
 * has stood in it since, a board of the head afloat.
 *
 * **`PROP_BODIES.barrel` is unchanged and the drawing stays inside it**: the
 * bilge is the box's half-width to a centimetre, nothing stands over 1.21 m,
 * and the one thing outside it is the fallen hoop, 4.5 cm high on the ground.
 *
 * **Its variation comes from `sub`, never `rng`** — the barrel has never drawn
 * from the map's shared stream, and drawing now would move every prop sown
 * after it (`buildFireDrum` has the argument). Three colours, the three it
 * always wore: the plank, the head's bark and the hoops' dark iron, which is
 * also the dark behind the joints, inside the cask and in the water.
 */
export function buildBarrel(
  scene: Scene,
  mats: CelMaterialFactory,
  _rng: () => number = Math.random,
  sub: () => number = Math.random,
): Mesh {
  const parts = caskData(sub);
  const cask = partSurface("barrel", parts.wood, scene);
  cask.material = mats.get(CASK_WOOD);
  const rest: [string, VertexData, Material][] = [
    ["barrel-iron", parts.iron, mats.get(DARK_METAL)],
    ["barrel-head", parts.head, mats.get(BARK)],
  ];
  for (const [name, data, material] of rest) {
    const mesh = partSurface(name, data, scene);
    mesh.parent = cask;
    mesh.material = material;
  }
  return cask;
}

/**
 * One cask's drawing, by material and not yet coloured, stood on its foot at
 * the origin — `buildBarrel`'s, and the crate stack's (`kit/structures/
 * small.ts`), so the barrel stood against a stack of crates is the same
 * barrel as the one lying loose in the yard beside it. Each caller paints it
 * from its own palette.
 */
export interface CaskParts {
  /** The staves, their end grain and inside, and the closing disc under them. */
  wood: VertexData;
  /** The head's boards, the floating board and the bung. Never empty. */
  head: VertexData;
  /** The hoops, the dark behind the joints, the dark or water inside, the bung hole. */
  iron: VertexData;
}

/**
 * The drawing `buildBarrel` describes, off its own stream. `fall` turns where
 * an open cask's lost hoop may lie, as a bearing in the cask's frame and a
 * spread either side of it, for a caller with something standing on the other
 * sides; absent, it may lie anywhere round the foot. The same number of draws
 * either way, so the rest of the cask comes out the same.
 */
export function caskData(sub: () => number, fall?: { a: number; spread: number }): CaskParts {
  const wood = newSheet();
  const board = newSheet();
  const iron = newSheet();
  const boardExtra: VertexData[] = [];
  const ironExtra: VertexData[] = [];

  // --- what this one has suffered -------------------------------------------
  const staves = 18 + Math.floor(sub() * 4);
  const widths = Array.from({ length: staves }, () => 0.75 + sub() * 0.5);
  const total = widths.reduce((s, w) => s + w, 0);
  const spans = widths.map((w) => (w / total) * Math.PI * 2);
  const a0 = sub() * Math.PI * 2;
  const state = sub();
  const open = state < 0.22;
  const holed = !open && state < 0.4;
  const slip = sub() < 0.3 ? 0.03 + sub() * 0.05 : 0;
  const sprung = !open && sub() < 0.35 ? { k: Math.floor(sub() * staves), d: 0.008 + sub() * 0.007 } : null;
  const splay = open ? 0.015 + sub() * 0.015 : 0;
  const bungStave = Math.floor(sub() * staves);

  // The hoops' centres. The top quarter hoop is the one that slips; the top
  // chime hoop is the one an open cask has lost.
  const quarterTop = CASK_H - 0.27 - slip;
  const hoops = [0.07, 0.27, quarterTop];
  if (!open) hoops.push(CASK_H - 0.07);

  // Over the top quarter hoop's old place an open cask's staves spring out,
  // held by nothing; between the quarter hoops a sprung stave bows out.
  const springY = CASK_H - 0.27 + HOOP_W / 2;
  const R = (y: number, k = -1): number => {
    let r = caskR(y);
    if (splay && y > springY) r += splay * ((y - springY) / (CASK_H - springY)) ** 2;
    if (sprung && k === sprung.k) {
      const lo = 0.27 + HOOP_W;
      const hi = quarterTop - HOOP_W;
      if (y > lo && y < hi) r += sprung.d * Math.sin((Math.PI * (y - lo)) / (hi - lo));
    }
    return r;
  };
  const dR = (y: number, k = -1): number => (R(y + 0.005, k) - R(y - 0.005, k)) / 0.01;
  const ring = (a: number, r: number, y: number): V3 => [Math.sin(a) * r, y, Math.cos(a) * r];

  // How far down the inside is seen: a closed cask only to just under its
  // head, one with a board gone down into the dark, an open one to its water.
  const headY = CASK_H - CASK_CHIME;
  const floorY = open ? CASK_H - 0.3 - sub() * 0.3 : holed ? headY - 0.4 : headY - 0.012;

  // --- the staves -------------------------------------------------------------
  let edge = a0;
  for (let k = 0; k < staves; k++) {
    const span = spans[k];
    const am = edge + span / 2;
    const top = CASK_H + (sub() - 0.5) * 0.01;
    // The outer face, flat across and bent down its length, standing off its
    // neighbours by the joint.
    const face = (y: number): [number, number] => {
      const r = R(y, k);
      const g = STAVE_JOINT / r;
      const n: V3 = [Math.sin(am), -dR(y, k), Math.cos(am)];
      return [sheetVert(wood, ring(edge + g, r, y), n), sheetVert(wood, ring(edge + span - g, r, y), n)];
    };
    let prev = face(0);
    for (let j = 1; j <= 8; j++) {
      const next = face((j / 8) * top);
      sheetFace(wood, prev[0], next[0], prev[1]);
      sheetFace(wood, prev[1], next[0], next[1]);
      prev = next;
    }
    // The end grain, then the inside down to whatever is seen. The inside
    // runs the stave's full width, so the dark behind the joints is never
    // seen from in there.
    const rt = R(top, k);
    const up: V3 = [0, 1, 0];
    const t0 = sheetVert(wood, ring(edge, rt, top), up);
    const t1 = sheetVert(wood, ring(edge + span, rt, top), up);
    const t2 = sheetVert(wood, ring(edge, rt - STAVE_T, top), up);
    const t3 = sheetVert(wood, ring(edge + span, rt - STAVE_T, top), up);
    sheetFace(wood, t0, t2, t1);
    sheetFace(wood, t1, t2, t3);
    const inner = (y: number): [number, number] => {
      const r = R(y, k) - STAVE_T;
      const n: V3 = [-Math.sin(am), dR(y, k), -Math.cos(am)];
      return [sheetVert(wood, ring(edge, r, y), n), sheetVert(wood, ring(edge + span, r, y), n)];
    };
    const steps = open || holed ? 4 : 1;
    let back = inner(top);
    for (let j = 1; j <= steps; j++) {
      const next = inner(top + ((floorY - 0.01 - top) * j) / steps);
      sheetFace(wood, back[0], next[0], back[1]);
      sheetFace(wood, back[1], next[0], next[1]);
      back = next;
    }
    edge += span;
  }
  const disc = (s: Sheet, y: number, r: number, ny: number): void => {
    const c = sheetVert(s, [0, y, 0], [0, ny, 0]);
    const rim = Array.from({ length: 24 }, (_, i) => sheetVert(s, ring((i / 24) * Math.PI * 2, r, y), [0, ny, 0]));
    rim.forEach((w, i) => sheetFace(s, c, w, rim[(i + 1) % 24]));
  };
  // Under the cask, so the shadow map is handed a closed shape.
  disc(wood, 0.002, caskR(0), -1);

  // --- the iron -----------------------------------------------------------------
  // A hoop is its face and its top edge: the edge is what a standing eye sees
  // over, and the step the ink draws.
  const band = (
    cx: number,
    cz: number,
    y0: number,
    y1: number,
    rAt: (y: number) => number,
    slope: (y: number) => number,
    loose = false,
  ): void => {
    const SIDES = 32;
    let prev: number[] | null = null;
    for (let i = 0; i <= SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const r0 = rAt(y0) + HOOP_T;
      const r1 = rAt(y1) + HOOP_T;
      const ri = r1 - HOOP_T - 0.002;
      const v = [
        sheetVert(iron, [cx + s * r0, y0, cz + c * r0], [s, -slope(y0), c]),
        sheetVert(iron, [cx + s * r1, y1, cz + c * r1], [s, -slope(y1), c]),
        sheetVert(iron, [cx + s * r1, y1, cz + c * r1], [0, 1, 0]),
        sheetVert(iron, [cx + s * ri, y1, cz + c * ri], [0, 1, 0]),
      ];
      // A hoop off its cask is seen from inside as well.
      if (loose) {
        v.push(
          sheetVert(iron, [cx + s * ri, y1, cz + c * ri], [-s, 0, -c]),
          sheetVert(iron, [cx + s * ri, y0, cz + c * ri], [-s, 0, -c]),
        );
      }
      if (prev) {
        sheetFace(iron, prev[0], prev[1], v[0]);
        sheetFace(iron, v[0], prev[1], v[1]);
        sheetFace(iron, prev[2], prev[3], v[2]);
        sheetFace(iron, v[2], prev[3], v[3]);
        if (loose) {
          sheetFace(iron, prev[4], prev[5], v[4]);
          sheetFace(iron, v[4], prev[5], v[5]);
        }
      }
      prev = v;
    }
  };
  for (const y of hoops) band(0, 0, y - HOOP_W / 2, y + HOOP_W / 2, (yy) => R(yy), (yy) => dR(yy));
  // The lost chime hoop, lying on its edge at the foot where it fell.
  if (open && sub() < 0.6) {
    const a = fall ? fall.a + (sub() - 0.5) * fall.spread : sub() * Math.PI * 2;
    const r = caskR(CASK_H - 0.07);
    const d = CASK_BELLY + r + 0.06;
    band(Math.sin(a) * d, Math.cos(a) * d, 0, HOOP_W, () => r, () => 0, true);
  }
  // The dark behind the joints: a drum inside the staves' thickness, up under
  // the end grain. From inside, the staves' full-width faces cover it.
  {
    const ROWS = 7;
    const SIDES = 24;
    const yTop = CASK_H - 0.015;
    let last: number[] | null = null;
    for (let j = 0; j <= ROWS; j++) {
      const y = 0.01 + ((yTop - 0.01) * j) / ROWS;
      const row: number[] = [];
      for (let i = 0; i <= SIDES; i++) {
        const a = (i / SIDES) * Math.PI * 2;
        row.push(sheetVert(iron, ring(a, R(y) - STAVE_T / 2, y), [Math.sin(a), -dR(y), Math.cos(a)]));
      }
      if (last) {
        for (let i = 0; i < SIDES; i++) {
          sheetFace(iron, last[i], row[i], last[i + 1]);
          sheetFace(iron, last[i + 1], row[i], row[i + 1]);
        }
      }
      last = row;
    }
  }
  // The floor of what is seen inside: the dark under the head's seams, the
  // empty cask under a missing board, or the standing water.
  disc(iron, floorY, R(floorY) - STAVE_T + 0.004, 1);

  // --- the head -------------------------------------------------------------------
  // Boards across, cut to the croze, each a few millimetres off its
  // neighbours' plane where it has warped, and the seams open.
  const nb = 4 + Math.floor(sub() * 2);
  const theta = sub() * Math.PI;
  const u: V3 = [Math.cos(theta), 0, -Math.sin(theta)];
  const v: V3 = [Math.sin(theta), 0, Math.cos(theta)];
  const rh = caskR(headY) - STAVE_T + 0.003;
  const cuts = Array.from({ length: nb + 1 }, (_, i) =>
    -rh + (2 * rh * (i === 0 || i === nb ? i : i + (sub() - 0.5) * 0.3)) / nb,
  );
  const gone = holed ? 1 + Math.floor(sub() * (nb - 2)) : -1;
  const at = (x: number, z: number, y: number): V3 => [u[0] * x + v[0] * z, y, u[2] * x + v[2] * z];
  for (let i = 0; i < nb; i++) {
    const y = headY + (sub() - 0.5) * 0.008;
    if (open || i === gone) continue;
    const x0 = cuts[i] + 0.003;
    const x1 = cuts[i + 1] - 0.003;
    const outline: V3[] = [];
    for (let s = 0; s <= 4; s++) {
      const x = x0 + ((x1 - x0) * s) / 4;
      outline.push(at(x, Math.sqrt(Math.max(0, rh * rh - x * x)), y));
    }
    for (let s = 4; s >= 0; s--) {
      const x = x0 + ((x1 - x0) * s) / 4;
      outline.push(at(x, -Math.sqrt(Math.max(0, rh * rh - x * x)), y));
    }
    const c = sheetVert(board, at((x0 + x1) / 2, 0, y), [0, 1, 0]);
    const vs = outline.map((p) => sheetVert(board, p, [0, 1, 0]));
    vs.forEach((w, j) => sheetFace(board, c, w, vs[(j + 1) % vs.length]));
  }
  // An open cask's head went into the water, one board of it still afloat.
  if (open) {
    boardExtra.push(
      CreateBoxVertexData({ width: rh * 1.5, height: 0.025, depth: 0.12 + sub() * 0.04 }).transform(
        Matrix.RotationYawPitchRoll(sub() * Math.PI, (sub() - 0.5) * 0.15, 0.05 + sub() * 0.1).multiply(
          Matrix.Translation((sub() - 0.5) * 0.1, floorY + 0.004, (sub() - 0.5) * 0.1),
        ),
      ),
    );
  }

  // --- the bung -------------------------------------------------------------------
  // In the middle of its stave at the bilge: a plug driven into a dark hole a
  // little wider than itself.
  {
    const am = a0 + spans.slice(0, bungStave).reduce((s, w) => s + w, 0) + spans[bungStave] / 2;
    const r = R(CASK_H / 2, bungStave) * Math.cos(spans[bungStave] / 2);
    const out = (d: number): Matrix =>
      Matrix.RotationX(Math.PI / 2)
        .multiply(Matrix.RotationY(am))
        .multiply(Matrix.Translation(Math.sin(am) * d, CASK_H / 2, Math.cos(am) * d));
    ironExtra.push(CreateCylinderVertexData({ height: 0.004, diameter: 0.072, tessellation: 10 }).transform(out(r + 0.001)));
    boardExtra.push(CreateCylinderVertexData({ height: 0.03, diameter: 0.052, tessellation: 8 }).transform(out(r + 0.004)));
  }

  // An open cask has no head boards, but always the floating board and the
  // bung, so no list here is ever empty.
  const merged = (list: VertexData[]): VertexData => {
    const full = list.filter((d) => (d.positions?.length ?? 0) > 0);
    return full[0].merge(full.slice(1));
  };
  return {
    wood: sheetData(wood),
    head: merged([sheetData(board), ...boardExtra]),
    iron: merged([sheetData(iron), ...ironExtra]),
  };
}
