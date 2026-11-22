/**
 * kit/desert/qubba.ts — buildQubba: a saint's domed tomb, a limewashed cube
 * under a white dome on an octagonal drum, the thing every burial ground in
 * this part of the world is laid out round. Part of the desert-town set:
 * follows the contract in kit/core.ts and the set's rules in `./index.ts`.
 * Invariants: the cube is ONE solid block to its parapet's head and the dome
 * a second over it — cover, never walked, never entered; variation comes from
 * the params, never `Math.random()`. Never imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  ALLOY,
  Build,
  IRON,
  type BuildParams,
  type Structure,
} from "../core";
import {
  MUDBRICK_DARK,
  PALM_BEAM,
  PLINTH,
  WHITEWASH,
  WINDOW_VOID,
  clothHash,
} from "./shared";

/**
 * The qubba: a cube about as tall as it is wide, a parapet of stepped
 * merlons with a taller horn at each corner, a squat octagonal drum, and a
 * limewashed dome over it, with one pointed doorway on the -Z face.
 *
 * ## What it is FOR
 *
 * **A landmark you can READ, in a town whose one chroma is spent.** The
 * mosques carry `TILE_BLUE`; this is the other dome on the skyline, and it is
 * white, so it says "tomb" from four hundred metres and never "mosque". It
 * stands at the head of a burial ground or by a gate, which is where every
 * town on a caravan road put its saint, and on a map otherwise made of flat
 * roofs it is the one solid silhouette that is not a house.
 *
 * In play it is a pillar of mud the size of a small room: solid cover all
 * round, nothing to climb, nothing inside. The door is drawn and not cut —
 * a qubba is one chamber over a cenotaph, and a fight that could get into a
 * six-metre box would be a fight about a corner nobody can leave.
 *
 * ## The dome is drums, as the mosque's is
 *
 * The cel shader bands light, and a smooth sphere bands into contour rings;
 * stepped drums band into what reads as courses of plaster, which is what a
 * dome is anyway. It is limewashed rather than tiled — the white is the read.
 *
 * ## Colliders
 *
 * The plinth, then the cube to the head of its merlons, then the drum and the
 * dome as one block over the middle — a round aimed at the dome from the
 * citadel stops on it rather than passing through a drawn dome into the sky.
 */
export function buildQubba(
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(mats, "qubba");
  const w = p.width ?? 6;
  const skin = p.tint ?? WHITEWASH;
  const half = w / 2;
  // The cube's height: a little under its width, which is the proportion
  // that makes the dome sit ON the box rather than float off a tower.
  const hc = w * 0.72;
  const top = PLINTH + hc;
  const merlonH = 0.5;
  const seed = clothHash(w, hc);

  // --- the colliders ---------------------------------------------------------
  b.box(w + 0.4, PLINTH, w + 0.4, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  b.block({ w: w + 0.4, h: PLINTH, d: w + 0.4, x: 0, y: PLINTH / 2, z: 0 });
  b.block({ w, h: hc + merlonH, d: w, x: 0, y: PLINTH + (hc + merlonH) / 2, z: 0 });
  const drumD = w * 0.74;
  const drumH = Math.max(0.9, w * 0.17);
  const domeH = w * 0.46;
  b.block({
    w: drumD * 0.74,
    h: drumH + domeH * 0.8,
    d: drumD * 0.74,
    x: 0,
    y: top + 0.35 + (drumH + domeH * 0.8) / 2,
    z: 0,
  });

  // --- the cube --------------------------------------------------------------
  b.box(w, hc, w, 0, PLINTH + hc / 2, 0, skin);
  // A pilaster at each corner, 8 cm proud: the corner a mason squared, and the
  // only thing that tells a lime-rendered box it has an edge under a noon sun.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.5, hc, 0.5, sx * (half - 0.21), PLINTH + hc / 2, sz * (half - 0.21), skin);
    }
  }
  // The cornice band under the parapet, in the wall's own shade.
  b.box(w + 0.18, 0.16, w + 0.18, 0, top - 0.3, 0, MUDBRICK_DARK);

  // A blind arch on each face but the door's, sunk into the wall — the panel
  // recessed rather than painted, so the ink draws its edge.
  const archW = w * 0.42;
  const archH = hc * 0.56;
  const archY = PLINTH + 0.55 + archH / 2;
  const sunk = (fx: number, fz: number): void => {
    const along = fx === 0;
    const x = fx * (half + 0.015);
    const z = fz * (half + 0.015);
    b.box(along ? archW : 0.04, archH, along ? 0.04 : archW, x, archY, z, MUDBRICK_DARK);
    // The pointed head: a square on its corner over the panel, half of it
    // hidden behind the wall above the springing.
    const s = archW / Math.SQRT2;
    b.box(along ? s : 0.04, s, along ? 0.04 : s, x, archY + archH / 2, z, MUDBRICK_DARK, along ? { z: Math.PI / 4 } : { x: Math.PI / 4 });
  };
  sunk(0, 1);
  sunk(-1, 0);
  sunk(1, 0);
  // A small grilled window high in each side panel: the void, and two iron
  // bars across it.
  for (const sx of [-1, 1]) {
    const x = sx * (half + 0.05);
    const y = archY + archH * 0.18;
    b.box(0.04, 0.55, 0.42, x, y, 0, WINDOW_VOID);
    for (const bz of [-0.1, 0.1]) b.box(0.05, 0.6, 0.04, x + sx * 0.01, y, bz, IRON);
  }

  // The doorway on -Z: a reveal in the shade, the void inside it with a
  // pointed head, a step, and the timber lintel the arch is turned over.
  const doorW = Math.min(1.3, w * 0.24);
  const doorH = Math.min(2.3, hc * 0.52);
  const dz = -half - 0.02;
  b.box(doorW + 0.5, doorH + 0.25, 0.06, 0, PLINTH + (doorH + 0.25) / 2, dz, MUDBRICK_DARK);
  const ds = (doorW + 0.5) / Math.SQRT2;
  b.box(ds, ds, 0.06, 0, PLINTH + doorH + 0.25, dz, MUDBRICK_DARK, { z: Math.PI / 4 });
  b.box(doorW, doorH, 0.06, 0, PLINTH + doorH / 2, dz - 0.03, WINDOW_VOID);
  const vs = doorW / Math.SQRT2;
  b.box(vs, vs, 0.06, 0, PLINTH + doorH, dz - 0.03, WINDOW_VOID, { z: Math.PI / 4 });
  b.box(doorW + 1.1, 0.16, 0.36, 0, PLINTH + 0.08, -half, MUDBRICK_DARK);
  // The green-painted door leaves are not here on purpose: the town's one
  // chroma is the mosques' tile. A palm-log leaf stands folded back against
  // the wall beside the opening instead.
  b.box(doorW * 0.5, doorH * 0.86, 0.06, -(doorW * 0.75 + 0.3), PLINTH + doorH * 0.43, dz - 0.07, PALM_BEAM);

  // --- the parapet -------------------------------------------------------------
  // A low band round the roof and a row of stepped merlons on it, with a
  // taller "horn" at each corner — the silhouette that says North Africa and
  // the Gulf at once, and the one thing at roof height a cube can hang a
  // shadow from.
  const band = 0.24;
  for (const sz of [-1, 1]) {
    b.box(w, band, 0.36, 0, top + band / 2, sz * (half - 0.18), skin);
  }
  for (const sx of [-1, 1]) {
    b.box(0.36, band, w - 0.72, sx * (half - 0.18), top + band / 2, 0, skin);
  }
  const mer = Math.max(3, Math.round((w - 1.2) / 0.78));
  for (let i = 1; i < mer; i++) {
    const t = -half + 0.6 + (i / mer) * (w - 1.2);
    const mh = merlonH - band + 0.08;
    for (const s of [-1, 1]) {
      // Along the ±Z edges, then the ±X ones.
      b.box(0.34, mh, 0.32, t, top + band + mh / 2, s * (half - 0.18), skin);
      b.box(0.17, 0.14, 0.32, t, top + band + mh + 0.07, s * (half - 0.18), skin);
      b.box(0.32, mh, 0.34, s * (half - 0.18), top + band + mh / 2, t, skin);
      b.box(0.32, 0.14, 0.17, s * (half - 0.18), top + band + mh + 0.07, t, skin);
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (half - 0.26);
      const z = sz * (half - 0.26);
      b.box(0.52, 0.72, 0.52, x, top + 0.36, z, skin);
      b.box(0.36, 0.22, 0.36, x, top + 0.83, z, skin);
      b.box(0.18, 0.18, 0.18, x, top + 1.03, z, skin);
    }
  }
  // A palm-log spout through the parapet on two faces, and the dark streak the
  // roof's water has left down the lime under each: the weathering a white
  // building actually wears, and what keeps it from reading as new.
  for (const sx of [-1, 1]) {
    const z = (clothHash(seed, sx) - 0.5) * w * 0.4;
    b.box(0.17, 0.13, 0.13, sx * (half + 0.06), top + 0.05, z, PALM_BEAM);
    const streak = hc * (0.35 + clothHash(seed, sx, 3) * 0.3);
    b.box(0.025, streak, 0.16, sx * (half + 0.012), top - streak / 2, z, MUDBRICK_DARK);
  }

  // --- the drum and the dome ----------------------------------------------------
  // A square base where the squinches turn the cube into an octagon, the drum
  // with its eight small windows, and the dome in stepped courses.
  b.box(drumD + 0.3, 0.35, drumD + 0.3, 0, top + 0.175, 0, skin);
  b.cyl(drumH, drumD, drumD, 8, 0, top + 0.35 + drumH / 2, 0, skin, { y: Math.PI / 8 });
  b.cyl(0.14, drumD + 0.16, drumD + 0.16, 8, 0, top + 0.35 + drumH - 0.07, 0, MUDBRICK_DARK, { y: Math.PI / 8 });
  const ar = drumD / 2 - 0.01;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    // Each window sits on a flat of the octagon (turned by PI/8 above, so the
    // flats face the eight bearings k * PI/4).
    const r = ar * Math.cos(Math.PI / 8);
    b.box(0.22, drumH * 0.42, 0.04, Math.sin(a) * r, top + 0.35 + drumH * 0.45, Math.cos(a) * r, WINDOW_VOID, { y: a });
  }
  const domeY = top + 0.35 + drumH;
  const shells: [number, number, number][] = [
    [0.16, 0.97, 1.0],
    [0.15, 0.9, 0.97],
    [0.15, 0.78, 0.9],
    [0.14, 0.6, 0.78],
    [0.12, 0.38, 0.6],
    [0.1, 0.14, 0.38],
  ];
  let dy = domeY;
  for (const [f, t, bt] of shells) {
    const sh = domeH * f;
    b.cyl(sh, drumD * t, drumD * bt, 14, 0, dy + sh / 2, 0, skin);
    dy += sh;
  }
  // The finial: three brass balls on a rod and a crescent, small enough to be
  // a glint and not a shape.
  b.cyl(0.9, 0.05, 0.07, 6, 0, dy + 0.45, 0, ALLOY);
  for (const [y, d] of [
    [0.18, 0.22],
    [0.42, 0.18],
    [0.62, 0.13],
  ] as const) {
    b.cyl(d, d * 0.6, d * 0.6, 8, 0, dy + y, 0, ALLOY);
    b.cyl(d * 0.5, d, d * 0.6, 8, 0, dy + y + d * 0.25, 0, ALLOY);
  }
  b.box(0.05, 0.26, 0.04, -0.05, dy + 0.98, 0, ALLOY, { z: 0.5 });
  b.box(0.05, 0.26, 0.04, 0.05, dy + 0.98, 0, ALLOY, { z: -0.5 });

  // Offerings at the door: a rag tied to the step's iron ring is the custom
  // and is cloth, which this set reserves for the wind — so a few votive
  // stones heaped by the threshold instead, a hand high.
  for (let i = 0; i < 4; i++) {
    const r = clothHash(seed, i, 9);
    b.box(0.16 + r * 0.1, 0.1 + r * 0.06, 0.14, doorW * 0.6 + 0.3 + i * 0.13, PLINTH + 0.05, -half - 0.04, i % 2 ? WHITEWASH : MUDBRICK_DARK, { y: r * 2 });
  }
  return b;
}
