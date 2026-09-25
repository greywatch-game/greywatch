/**
 * kit/candy.ts — Candy Land: the gingerbread house at the end of the path, the
 * crooked old peanut brittle house, the gingerbread plum tree, gumdrop
 * mountains, peppermint sticks, conversation hearts, ice cream floats and a
 * popsicle buoy, the mileage signs, the molasses swamp's sheet, and the small
 * sweets a lawn is dressed with — a gingerbread man, a cupcake, a cone, a
 * candy corn, a chocolate bar and a peppermint fence. All follow the contract
 * in kit/core.ts (origin-local geometry, no solid/pickable/collisions
 * metadata, a front on local -Z).
 *
 * ## What this set is, and why it is a set
 *
 * The map is modelled on the 1962 Milton Bradley board
 * (`reference-media/candyland-board.jpg`), and the rule `kit/harbour.ts` wrote
 * down holds with more force than anywhere else in the tree: **a map feels
 * like a place because the buildings are the ones that place would have
 * built.** Candy Land built a gingerbread house with its roof iced pink, a
 * crooked brittle cottage, a plum tree hung with sweets, and a range of
 * gumdrops — and nothing else in the kit could stand in for any of them.
 *
 * It is made of what sweets are made of, and every colour is a SWEET's rather
 * than a paint's: gingerbread and its white icing, pink frosting, milk and
 * dark chocolate, peppermint's red on white, gumdrop and lollipop colours, the
 * butterscotch of a brittle cottage. They are a shade under their swatches
 * for the khaki clamp's reason (`candyland/environment.ts`): the key is a
 * high sun, and a primary at full value clips flat against the shoulder.
 *
 * ## The rules this file adds to the kit contract
 *
 * - **Round things are ROUND.** A gumdrop, a cupcake, a scoop and a cherry
 *   are surfaces of revolution with shared vertices (`candyShapes.ts`), so
 *   the cel bands sweep round them the way a sweet catches light; everything
 *   CUT — a heart, a chocolate bar, a brittle roof — is flat shaded.
 * - **A stripe is wound, never painted.** A candy cane's red spirals round it
 *   as whole columns of a twisted tube (`stripedTube`), which is what keeps
 *   the edge clean at every distance.
 * - **Words are geometry.** A sign and a heart say what they say in block
 *   letters standing off the face (`blockText`), which the ink outlines like
 *   any other shape — no texture, so the server's missing canvas never
 *   matters and a word is lit by the same sun as the board it is on.
 * - **Nothing tall is climbable**, `buildMinaret`'s rule: the plum tree and
 *   the big gumdrops are landmarks and cover, and a perch on one would see
 *   every flag.
 */
import {
  CreateSphereVertexData,
  CreateTorusVertexData,
  Scene,
  type VertexData,
} from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import {
  type V3,
  blockText,
  canePath,
  heartOutline,
  ovalOutline,
  prism,
  revolve,
  starOutline,
  stripedTube,
} from "../candyShapes";
import { mulberry32 } from "../rng";
import { Build, type BuildParams, type Structure } from "./core";

// --- palette -------------------------------------------------------------------

/** Gingerbread: the house's walls, a gingerbread man. */
const GINGER = "#a8672f";
const GINGER_DARK = "#7e4a21";
/** Royal icing: every piped line, every window frame. */
const ICING = "#f3ece4";
/** The house's frosting, and a cupcake's. */
const FROSTING = "#e6769e";
const CHOCOLATE = "#4a2918";
const MILK_CHOC = "#6e3f22";
const CANE_RED = "#cc2230";
const CANE_WHITE = "#f2ece5";
const CHERRY = "#c21a28";
const MINT = "#3f9f55";
/** Sugar glass: a window in a house made of sweets. */
const SUGAR_GLASS = "#8fc7de";
/** The brittle cottage: butterscotch walls, a toffee roof and its nuts. */
const BUTTERSCOTCH = "#dcae58";
const TOFFEE = "#8e5220";
const PEANUT = "#dcb06c";
const BRICK_RED = "#a7342a";
const COOKIE = "#c7864a";
const VANILLA = "#efe0b6";
const STRAWBERRY = "#ee8da4";
const WAFER = "#d49c55";
const SIGN_BOARD = "#b88450";
const MOLASSES = "#34200f";
const MOLASSES_SHEEN = "#4d2f18";
const FOIL = "#b9bcc2";
const WRAPPER = "#7a2a36";
const PLUM_LEAF = "#2f7a3c";
const PLUM_LEAF_LIT = "#58a94c";
const PLUM_BARK = "#5a3620";
const SUGAR_PLUM = "#6c2a73";
const GUMBALL = "#f0c72a";

/** The colours a sweet comes in, for studs, sprinkles and jelly buttons. */
const SPRINKLES = ["#f0c72a", "#ee7fb0", "#4fb26a", "#4d8fe0", "#f08a2a", "#a45ad0", "#f3ece4"];

/** Gumdrop colours, the board's five. */
export const GUMDROP_TINTS = ["#d3263a", "#ef7b22", "#efbd2a", "#3d9e48", "#7a3aa6"];

// --- small helpers --------------------------------------------------------------

/** A surface of vertex data, placed and turned. */
function put(
  b: Build,
  data: VertexData,
  color: string,
  x: number,
  y: number,
  z: number,
  rot?: { x?: number; y?: number; z?: number },
): Mesh {
  const m = b.surface(data, color);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
  return m;
}

function sphere(b: Build, d: number, x: number, y: number, z: number, color: string, segments = 10): Mesh {
  return put(b, CreateSphereVertexData({ diameter: d, segments }), color, x, y, z);
}

/**
 * A half disc standing in the XY plane on its diameter, facing -Z: the arch
 * over a door. A full disc there would hang its lower half across the doorway.
 */
function halfDisc(b: Build, r: number, thick: number, x: number, y: number, z: number, color: string): Mesh {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // Built lying down (its round side toward +Z), then stood up: rotX of -π/2
  // takes local +Z to +Y.
  return put(b, prism(pts, -thick / 2, thick / 2, 0, [0, r * 0.4]), color, x, y, z, { x: -Math.PI / 2 });
}

/**
 * An oval's outline turned in its own plane by `a` — for a part that will be
 * stood up with rotX alone. Babylon composes `rotation` Z first, so a part
 * cannot be stood up with X and THEN leaned with Z; the lean goes into the
 * outline instead, where the lying frame's (x, z) become the standing (x, y).
 */
function ovalTurned(rx: number, rz: number, a: number, n = 22): [number, number][] {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return ovalOutline(rx, rz, n).map(([x, z]): [number, number] => [x * c - z * sn, x * sn + z * c]);
}

/** A cupcake: fluted case, a swirl of frosting and a cherry. `s` is its scale, base at y. */
function cupcake(b: Build, s: number, x: number, y: number, z: number, caseColor: string, frost = FROSTING): void {
  put(b, revolve([[0.5 * s, 0], [0.62 * s, 0.5 * s]], 20, { flutes: 10, fluteDepth: 0.06, fluteFade: false }), caseColor, x, y, z);
  // The swirl: three shoulders of frosting, each narrower, to a point.
  const prof: [number, number][] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lobe = 0.12 * Math.max(0, Math.sin(t * Math.PI * 3));
    prof.push([Math.max(0, (0.72 * (1 - t) + lobe * (1 - t)) * s), (0.5 + 0.75 * t) * s]);
  }
  put(b, revolve(prof, 20), frost, x, y, z);
  sphere(b, 0.26 * s, x, y + 1.3 * s, z, CHERRY, 8);
}

/**
 * Block letters on a face that looks down local -Z, centred on (cx, cy), the
 * letters `px` metres a pixel and standing `proud` off `faceZ`. `|` breaks a
 * line. `back` puts them on a face looking down +Z instead, mirrored so they
 * read from behind.
 */
function letters(
  b: Build,
  text: string,
  cx: number,
  cy: number,
  faceZ: number,
  px: number,
  color: string,
  opts: { back?: boolean; proud?: number } = {},
): void {
  const lines = text.split("|");
  const proud = opts.proud ?? 0.04;
  const lineH = 7 * px;
  const total = lines.length * lineH - 2 * px;
  lines.forEach((line, li) => {
    const { runs, width } = blockText(line);
    const top = cy + total / 2 - li * lineH;
    for (const r of runs) {
      // A viewer on the -Z side faces +Z, so their right is +X; from behind
      // it is mirrored.
      const u = (r.x + r.w / 2 - width / 2) * px;
      const x = opts.back ? cx - u : cx + u;
      const y = top - (r.y + 0.5) * px;
      const z = opts.back ? faceZ + proud / 2 : faceZ - proud / 2;
      b.box(r.w * px, px, proud, x, y, z, color);
    }
  });
}

/**
 * Frosting DRIPS hanging from a line: a run of rounded icicles of varying
 * length from (x0, y0, z0) to (x1, y1, z1), every `pitch` metres. The lengths
 * come from a hash of the index, so two eaves of one house do not drip alike.
 */
function drips(
  b: Build,
  a: V3,
  c: V3,
  pitch: number,
  color: string,
  seed: number,
  scale = 1,
): void {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const n = Math.max(1, Math.floor(len / pitch));
  const rng = mulberry32(seed);
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const x = a[0] + (c[0] - a[0]) * f;
    const y = a[1] + (c[1] - a[1]) * f;
    const z = a[2] + (c[2] - a[2]) * f;
    const l = (0.25 + rng() * 0.9) * scale;
    const d = (0.24 + rng() * 0.1) * scale;
    b.cyl(l, d, d * 0.9, 8, x, y - l / 2, z, color);
    sphere(b, d * 1.12, x, y - l, z, color, 6);
  }
}

/** A striped candy-cane post, `h` tall, standing at (x, y, z). */
function canePost(b: Build, h: number, r: number, x: number, y: number, z: number, hook = 0): void {
  let path: V3[];
  if (hook > 0) {
    path = canePath(h, hook, 0.1);
  } else {
    const n = Math.max(2, Math.ceil(h / 0.15));
    path = [];
    for (let i = 0; i <= n; i++) path.push([0, (h * i) / n, 0]);
  }
  const [red, white] = stripedTube(path, r, { seg: 14, bands: 3, twist: 1.6 / Math.max(0.3, r * 4) });
  put(b, red, CANE_RED, x, y, z);
  put(b, white, CANE_WHITE, x, y, z);
}

// --- Home Sweet Home ---------------------------------------------------------------

/**
 * HOME SWEET HOME: the gingerbread house the whole board is a road to. Walls of
 * gingerbread studded with sweets and piped round with icing, a steep roof
 * iced so thick the pink runs off every eave, a peppermint chimney with a
 * cupcake on it, a lifesaver for a round window and a heart over the door.
 *
 * The same builder is every smaller gingerbread cottage on the map: `width`,
 * `depth` and `tint` (the frosting) are what make one the landmark and another
 * a sweetshop, and the landmark is simply the one that is big. `enterable`
 * hollows it behind an open doorway; `text` hangs a sign by the door — the
 * landmark's says HOME|SWEET|HOME, three lines, as the board's does.
 */
export function buildGingerbreadHouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "gingerhouse");
  const w = p.width ?? 16;
  const d = p.depth ?? 12;
  const frost = p.tint ?? FROSTING;
  const s = Math.min(w / 16, d / 12);
  const plinth = 0.35;
  const wallH = 5.0 * Math.max(0.8, s);
  const t = 0.4;
  const eave = plinth + wallH;
  const doorW = 2.4;
  const doorH = 3.0;

  // The chocolate plinth, and a piped band of icing along its top.
  b.box(w + 0.6, plinth, d + 0.6, 0, plinth / 2, 0, CHOCOLATE);
  b.block({ w: w + 0.6, h: plinth, d: d + 0.6, x: 0, y: plinth / 2, z: 0 });
  const wy = plinth + wallH / 2;
  if (p.enterable) {
    b.box(w - 0.4, 0.06, d - 0.4, 0, plinth + 0.03, 0, MILK_CHOC);
    b.doorWall(w, wallH, t, 0, wy, -d / 2 + t / 2, GINGER, doorW, doorH);
    b.wall(w, wallH, t, 0, wy, d / 2 - t / 2, GINGER);
    b.wall(t, wallH, d - 2 * t, -w / 2 + t / 2, wy, 0, GINGER);
    b.wall(t, wallH, d - 2 * t, w / 2 - t / 2, wy, 0, GINGER);
    // A chocolate-bar table and two gingerbread benches: something to put a
    // back to inside.
    b.wall(3.2, 0.9, 1.4, 0, plinth + 0.45, d / 4, CHOCOLATE);
    for (const sx of [-1, 1]) b.box(3.0, 0.45, 0.5, 0, plinth + 0.225, d / 4 + sx * 1.3, GINGER_DARK);
  } else {
    b.box(w, wallH, d, 0, wy, 0, GINGER);
    b.block({ w, h: wallH, d, x: 0, y: wy, z: 0 });
    // The door, drawn shut.
    b.box(doorW, doorH, 0.08, 0, plinth + doorH / 2, -d / 2 - 0.04, "#6b8fd0");
  }
  // Piped icing: the plinth line, the corners and the eave line.
  b.box(w + 0.1, 0.16, d + 0.1, 0, plinth + 0.06, 0, ICING);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl(wallH, 0.26, 0.26, 8, sx * (w / 2 + 0.02), wy, sz * (d / 2 + 0.02), ICING);
    }
  }
  for (const sz of [-1, 1]) b.box(w + 0.2, 0.2, 0.2, 0, eave - 0.1, sz * (d / 2 + 0.06), ICING);
  for (const sx of [-1, 1]) b.box(0.2, 0.2, d + 0.2, sx * (w / 2 + 0.06), eave - 0.1, 0, ICING);

  // The door: a peppermint arch round it, the leaf (blue, with a star) and a
  // heart over it.
  const face = -d / 2;
  for (const sx of [-1, 1]) canePost(b, doorH, 0.17, sx * (doorW / 2 + 0.2), plinth, face - 0.12);
  {
    const arc: V3[] = [];
    const r = doorW / 2 + 0.2;
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI;
      arc.push([Math.cos(a) * r, Math.sin(a) * r * 0.75, 0]);
    }
    const [red, white] = stripedTube(arc, 0.17, { seg: 12, bands: 3, twist: 2.4 });
    put(b, red, CANE_RED, 0, plinth + doorH, face - 0.12);
    put(b, white, CANE_WHITE, 0, plinth + doorH, face - 0.12);
    // The tympanum under the arch, in icing: a half disc, so the doorway
    // under it stays open.
    halfDisc(b, r - 0.12, 0.06, 0, plinth + doorH, face - 0.03, ICING);
  }
  // The door leaf — blue, with a star — swung back flat against the inside
  // of the front wall when the house is open, shut across the doorway when
  // it is not.
  const star = prism(starOutline(5, 0.42, 0.18, Math.PI / 2), -0.04, 0.04, 0.02);
  if (p.enterable) {
    const lx = -doorW / 2 - (doorW - 0.2) / 2;
    b.box(doorW - 0.2, doorH - 0.1, 0.08, lx, plinth + doorH / 2, face + t + 0.05, "#6b8fd0");
    put(b, star, "#f3c62a", lx, plinth + doorH * 0.62, face + t + 0.1, { x: Math.PI / 2 });
  } else {
    put(b, star, "#f3c62a", 0, plinth + doorH * 0.62, face - 0.1, { x: -Math.PI / 2 });
  }
  {
    const { pts, centre } = heartOutline(1.5);
    put(b, prism(pts, -0.12, 0.12, 0.08, centre), CHERRY, 0, plinth + doorH + 1.35 * s + 0.3, face - 0.13, { x: -Math.PI / 2 });
  }

  // Windows of sugar glass in icing frames, either side of the door, and the
  // lifesaver round window over the heart's left.
  const win = (cx: number, cy: number, faceZ: number, alongZ = false): void => {
    const ww = 1.6;
    const wh = 1.5;
    const dz = alongZ ? 0 : -0.03;
    const dx = alongZ ? (faceZ > 0 ? 0.03 : -0.03) : 0;
    if (alongZ) {
      b.box(0.06, wh, ww, faceZ + dx, cy, cx, SUGAR_GLASS);
      b.box(0.12, wh + 0.3, 0.16, faceZ + dx * 2, cy, cx - ww / 2, ICING);
      b.box(0.12, wh + 0.3, 0.16, faceZ + dx * 2, cy, cx + ww / 2, ICING);
      b.box(0.12, 0.16, ww + 0.3, faceZ + dx * 2, cy - wh / 2, cx, ICING);
      b.box(0.12, 0.16, ww + 0.3, faceZ + dx * 2, cy + wh / 2, cx, ICING);
      b.box(0.1, wh, 0.08, faceZ + dx * 2, cy, cx, ICING);
      b.box(0.1, 0.08, ww, faceZ + dx * 2, cy, cx, ICING);
      return;
    }
    b.box(ww, wh, 0.06, cx, cy, faceZ + dz, SUGAR_GLASS);
    b.box(0.16, wh + 0.3, 0.12, cx - ww / 2, cy, faceZ + dz * 2, ICING);
    b.box(0.16, wh + 0.3, 0.12, cx + ww / 2, cy, faceZ + dz * 2, ICING);
    b.box(ww + 0.3, 0.16, 0.12, cx, cy - wh / 2, faceZ + dz * 2, ICING);
    b.box(ww + 0.3, 0.16, 0.12, cx, cy + wh / 2, faceZ + dz * 2, ICING);
    b.box(0.08, wh, 0.1, cx, cy, faceZ + dz * 2, ICING);
    b.box(ww, 0.08, 0.1, cx, cy, faceZ + dz * 2, ICING);
  };
  const winY = plinth + wallH * 0.55;
  const sideX = Math.min(w / 2 - 1.6, doorW / 2 + 2.4);
  win(-sideX, winY, face);
  win(sideX, winY, face);
  // A window box of sweets under the right-hand window.
  b.box(2.1, 0.45, 0.5, sideX, winY - 1.05, face - 0.3, GINGER_DARK);
  for (let i = 0; i < 6; i++) {
    sphere(b, 0.34, sideX - 0.8 + i * 0.32, winY - 0.7, face - 0.32, SPRINKLES[i % SPRINKLES.length], 6);
  }
  for (const sx of [-1, 1]) {
    for (const zc of d > 9 ? [-d / 4, d / 4] : [0]) win(zc, winY, sx * (w / 2), true);
  }
  put(b, CreateTorusVertexData({ diameter: 1.3 * s + 0.2, thickness: 0.34, tessellation: 20 }), MINT, -sideX, eave + 0.9 * s, face - 0.1, { x: Math.PI / 2 });

  // Sweets studded over the walls — the board's dotted gingerbread.
  const rng = mulberry32(0x6769 + Math.round(w * 10 + d));
  const studFace = (along: number, alongZ: boolean, faceAt: number, n: 1 | -1): void => {
    for (let y = plinth + 0.7; y < eave - 0.4; y += 0.85) {
      for (let u = -along / 2 + 0.6; u < along / 2 - 0.4; u += 0.9) {
        const jit = (rng() - 0.5) * 0.2;
        const uu = u + jit;
        // Keep clear of the door and the windows.
        if (!alongZ && Math.abs(uu) < doorW / 2 + 0.5 && y < plinth + doorH + 0.6) continue;
        if (!alongZ && Math.abs(Math.abs(uu) - sideX) < 1.2 && Math.abs(y - winY) < 1.1) continue;
        if (alongZ && Math.abs(Math.abs(uu) - (d > 9 ? d / 4 : 0)) < 1.2 && Math.abs(y - winY) < 1.1) continue;
        const color = SPRINKLES[Math.floor(rng() * (SPRINKLES.length - 1))];
        if (alongZ) {
          b.cyl(0.08, 0.3, 0.3, 8, faceAt + n * 0.04, y, uu, color, { z: Math.PI / 2 });
        } else {
          b.cyl(0.08, 0.3, 0.3, 8, uu, y, faceAt + n * 0.04, color, { x: Math.PI / 2 });
        }
      }
    }
  };
  studFace(w, false, face, -1);
  studFace(d, true, -w / 2, -1);
  studFace(d, true, w / 2, 1);

  // The roof: a steep gable with its ridge running front to back, so the
  // front is the gable over the door — iced pink, thick, and running off
  // every eave.
  // As steep as the board's, which is most of the house from any distance.
  const rise = 7.2 * Math.max(0.75, s);
  const ov = 0.8;
  const slopeW = w / 2 + ov;
  const len = Math.hypot(slopeW, rise);
  const pitch = Math.atan2(rise, slopeW);
  const slab = 0.8;
  for (const sx of [-1, 1]) {
    b.box(len + 0.2, slab, d + 2 * ov, (sx * slopeW) / 2, eave + rise / 2 + 0.1, 0, frost, { z: -sx * pitch });
  }
  // The gable ends span the slabs, `gableRoof`'s rule, so no wedge of the
  // roof void shows at a corner.
  for (const sz of [-1, 1]) b.gableEnd(slopeW * 2, rise, 0.3, 0, eave, sz * (d / 2 - 0.15), GINGER);
  // The drips hang from the slab's underside: along both eaves and down the
  // front and back gables.
  const under = slab / 2 / Math.cos(pitch) - 0.08;
  const lineAt = (x: number): number => eave + 0.1 + rise * (1 - Math.abs(x) / slopeW) - under;
  for (const sx of [-1, 1]) {
    const x = sx * (slopeW - 0.12);
    drips(b, [x, lineAt(x), -d / 2 - ov], [x, lineAt(x), d / 2 + ov], 0.7, frost, 11 + sx, s * 1.4);
  }
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const a = sx * (slopeW - 0.25);
      const c = sx * 0.4;
      drips(
        b,
        [a, lineAt(a), sz * (d / 2 + ov - 0.08)],
        [c, lineAt(c), sz * (d / 2 + ov - 0.08)],
        0.8,
        frost,
        23 + sx * 5 + sz,
        s * 1.1,
      );
    }
  }
  // Sweets along the ridge.
  for (let z = -d / 2 - ov + 0.5; z <= d / 2 + ov - 0.4; z += 1.1) {
    sphere(b, 0.6, 0, eave + rise + 0.6, z, SPRINKLES[Math.floor(Math.abs(z * 7)) % SPRINKLES.length], 8);
  }
  b.block({ w: w + 2 * ov, h: 0.3, d: d + 2 * ov, x: 0, y: eave, z: 0 });

  // The peppermint chimney on the right-hand slope, and the cupcake on it.
  if (s > 0.7) {
    const cx = slopeW * 0.42;
    const cz = d / 4;
    const baseY = eave + rise * (1 - cx / slopeW) - 0.6;
    const ch = rise * 0.55 + 1.6;
    for (let i = 0; i < 7; i++) {
      const bh = ch / 7;
      b.cyl(bh, 1.2 * s, 1.2 * s, 16, cx, baseY + bh * (i + 0.5), cz, i % 2 === 0 ? CANE_RED : CANE_WHITE);
    }
    b.block({ w: 1.0 * s, h: ch, d: 1.0 * s, x: cx, y: baseY + ch / 2, z: cz });
    cupcake(b, 1.05 * s, cx, baseY + ch, cz, "#7cc5e8");
  }

  // The sign by the door.
  if (p.text) {
    const sx = -(doorW / 2 + 2.6);
    const sz = face - 2.2;
    const bw = 2.6;
    const bh = 2.0;
    for (const px of [-1, 1]) canePost(b, 2.6, 0.1, sx + px * (bw / 2 - 0.15), 0, sz + 0.1);
    b.box(bw, bh, 0.12, sx, 2.9 - bh / 2 + 0.6, sz, VANILLA);
    b.box(bw + 0.16, 0.14, 0.18, sx, 2.9 + 0.6 - 0.07, sz, ICING);
    b.box(bw + 0.16, 0.14, 0.18, sx, 2.9 + 0.6 - bh + 0.07, sz, ICING);
    letters(b, p.text, sx, 2.9 + 0.6 - bh / 2, sz - 0.06, 0.07, CANE_RED);
    letters(b, p.text, sx, 2.9 + 0.6 - bh / 2, sz + 0.06, 0.07, CANE_RED, { back: true });
    b.block({ w: 0.25, h: 2.6, d: 0.25, x: sx - bw / 2 + 0.15, y: 1.3, z: sz + 0.1 });
    b.block({ w: 0.25, h: 2.6, d: 0.25, x: sx + bw / 2 - 0.15, y: 1.3, z: sz + 0.1 });
  }
  // Brownie steps up to the door.
  b.box(doorW + 0.8, 0.18, 0.9, 0, 0.09, face - 0.75, CHOCOLATE);
  return b;
}

// --- the Crooked Old Peanut Brittle House -------------------------------------------

/**
 * THE CROOKED OLD PEANUT BRITTLE HOUSE: tall and narrow, butterscotch walls,
 * a steep roof of brittle slabs studded with peanuts, an arched red door, a
 * round window over it and a brick-red chimney that leans. Its crookedness is
 * in the chimney and the ridge, never in a collider — a leaning wall is a
 * picture, and a round stops on the upright box it stands for.
 */
export function buildBrittleHouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "brittlehouse");
  const w = p.width ?? 10;
  const d = p.depth ?? 9;
  const plinth = 0.3;
  const wallH = 5.2;
  const t = 0.4;
  const eave = plinth + wallH;
  const doorW = 2.2;
  const doorH = 2.8;
  b.box(w + 0.5, plinth, d + 0.5, 0, plinth / 2, 0, "#8c8a86");
  b.block({ w: w + 0.5, h: plinth, d: d + 0.5, x: 0, y: plinth / 2, z: 0 });
  const wy = plinth + wallH / 2;
  if (p.enterable) {
    b.box(w - 0.4, 0.06, d - 0.4, 0, plinth + 0.03, 0, TOFFEE);
    b.doorWall(w, wallH, t, 0, wy, -d / 2 + t / 2, BUTTERSCOTCH, doorW, doorH);
    b.wall(w, wallH, t, 0, wy, d / 2 - t / 2, BUTTERSCOTCH);
    b.wall(t, wallH, d - 2 * t, -w / 2 + t / 2, wy, 0, BUTTERSCOTCH);
    b.wall(t, wallH, d - 2 * t, w / 2 - t / 2, wy, 0, BUTTERSCOTCH);
    // A brittle hearth against the back wall.
    b.wall(2.6, 1.4, 1.0, 0, plinth + 0.7, d / 2 - t - 0.5, BRICK_RED);
  } else {
    b.box(w, wallH, d, 0, wy, 0, BUTTERSCOTCH);
    b.block({ w, h: wallH, d, x: 0, y: wy, z: 0 });
    b.box(doorW, doorH, 0.08, 0, plinth + doorH / 2, -d / 2 - 0.04, BRICK_RED);
  }
  const face = -d / 2;
  // Timber at the corners and under the eaves.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box(0.3, wallH, 0.3, sx * (w / 2), wy, sz * (d / 2), TOFFEE);
  }
  // The arched door frame, in cream, and the red leaf.
  for (const sx of [-1, 1]) b.box(0.25, doorH, 0.2, sx * (doorW / 2 + 0.12), plinth + doorH / 2, face - 0.1, VANILLA);
  halfDisc(b, doorW / 2 + 0.25, 0.2, 0, plinth + doorH, face - 0.1, VANILLA);
  halfDisc(b, doorW / 2 - 0.05, 0.08, 0, plinth + doorH, face - 0.24, BRICK_RED);
  if (p.enterable) {
    b.box(0.08, doorH - 0.1, doorW - 0.3, doorW / 2 - 0.05, plinth + doorH / 2, face + t + (doorW - 0.3) / 2, BRICK_RED);
  }
  // Windows: a round one over the door, shuttered ones at the sides.
  put(b, CreateTorusVertexData({ diameter: 1.4, thickness: 0.28, tessellation: 18 }), TOFFEE, 0, plinth + doorH + 1.35, face - 0.12, { x: Math.PI / 2 });
  b.box(1.1, 1.1, 0.05, 0, plinth + doorH + 1.35, face - 0.03, SUGAR_GLASS);
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 1.8);
    const y = plinth + wallH * 0.52;
    b.box(1.3, 1.5, 0.06, x, y, face - 0.03, SUGAR_GLASS);
    b.box(1.5, 0.16, 0.14, x, y - 0.8, face - 0.07, VANILLA);
    b.box(0.08, 1.5, 0.1, x, y, face - 0.06, VANILLA);
    for (const k of [-1, 1]) b.box(0.6, 1.6, 0.08, x + k * 1.0, y, face - 0.08, TOFFEE);
  }
  for (const sx of [-1, 1]) {
    b.box(0.06, 1.5, 1.4, sx * (w / 2 + 0.03), plinth + wallH * 0.52, 0, SUGAR_GLASS);
    b.box(0.1, 0.16, 1.6, sx * (w / 2 + 0.07), plinth + wallH * 0.52 - 0.8, 0, VANILLA);
  }

  // The roof: steep, its ridge front to back, brittle slabs thick with nuts,
  // and a ridge that sags a little.
  const rise = 5.2;
  const ov = 0.6;
  const slopeW = w / 2 + ov;
  const len = Math.hypot(slopeW, rise);
  const pitch = Math.atan2(rise, slopeW);
  const slab = 0.4;
  const rng = mulberry32(0x6272);
  for (const sx of [-1, 1]) {
    b.box(len + 0.1, slab, d + 2 * ov, (sx * slopeW) / 2, eave + rise / 2 + 0.05, 0, TOFFEE, { z: -sx * pitch });
    // Nuts set in the slab's top face, rotated with it.
    const nx = Math.cos(pitch);
    const ny = Math.sin(pitch);
    for (let u = 0.4; u < len - 0.3; u += 0.62) {
      for (let z = -d / 2 - ov + 0.35; z < d / 2 + ov - 0.3; z += 0.6) {
        const uu = u + (rng() - 0.5) * 0.3;
        const zz = z + (rng() - 0.5) * 0.3;
        // Along the slope from the eave end up, then out along the slab's normal.
        const x = sx * (slopeW - uu * nx) + sx * (slab / 2) * ny;
        const y = eave + uu * ny + (slab / 2) * nx + 0.05;
        b.cyl(0.12, 0.34, 0.4, 7, x, y, zz, PEANUT, { z: -sx * pitch });
      }
    }
  }
  for (const sz of [-1, 1]) b.gableEnd(slopeW * 2, rise, 0.3, 0, eave, sz * (d / 2 - 0.15), BUTTERSCOTCH);
  // The ridge cap, sagging in the middle.
  for (let i = 0; i < 4; i++) {
    const z0 = -d / 2 - ov + (i + 0.5) * ((d + 2 * ov) / 4);
    const sag = 0.18 * Math.cos(((i + 0.5) / 4 - 0.5) * Math.PI);
    b.box(0.6, 0.35, (d + 2 * ov) / 4 + 0.05, 0, eave + rise + 0.2 - sag, z0, TOFFEE);
  }
  b.block({ w: w + 2 * ov, h: 0.3, d: d + 2 * ov, x: 0, y: eave, z: 0 });
  // The crooked chimney, leaning out over the right-hand slope.
  {
    const cx = slopeW * 0.35;
    const cz = d / 5;
    const baseY = eave + rise * (1 - cx / slopeW) - 0.5;
    const ch = 3.6;
    const lean = 0.22;
    b.cyl(ch, 0.8, 1.0, 10, cx + Math.sin(lean) * ch / 2, baseY + Math.cos(lean) * ch / 2, cz, BRICK_RED, { z: -lean });
    b.cyl(0.35, 1.05, 1.05, 10, cx + Math.sin(lean) * ch, baseY + Math.cos(lean) * ch, cz, CHOCOLATE, { z: -lean });
    b.block({ w: 0.9, h: ch * 0.6, d: 0.9, x: cx + 0.2, y: baseY + ch * 0.3, z: cz });
  }
  // Stepping stones to the door.
  for (let i = 0; i < 4; i++) {
    b.box(1.3, 0.08, 0.8, (i % 2 ? 0.3 : -0.3), 0.04, face - 1.2 - i * 1.3, "#8a8791");
  }
  return b;
}

// --- the Gingerbread Plum Tree --------------------------------------------------------

/**
 * THE GINGERBREAD PLUM TREE: the board's middle, and this map's landmark — a
 * short, thick trunk with a gingerbread man peering out of it, and a vast round
 * crown of spiky star-shaped leaf hung with sugar plums, chocolates, cherries
 * and gumballs. About 26 m high and 24 across, so it stands over the lawn from
 * anywhere on the map.
 *
 * Its collider is the TRUNK and its buttress roots, the ash's rule: the crown
 * is leaf a round passes through, and it starts nine metres up.
 */
export function buildPlumTree(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "plumtree");
  const s = p.height ? p.height / 26 : 1;
  const rng = mulberry32(0x706c756d);
  // The trunk: flared at the root, forking under the crown.
  put(
    b,
    revolve([[3.0 * s, 0], [2.2 * s, 1.2 * s], [1.8 * s, 3 * s], [1.7 * s, 6 * s], [2.1 * s, 9 * s], [2.8 * s, 10.5 * s], [0, 11 * s]], 18, { flutes: 7, fluteDepth: 0.12, fluteFade: false }),
    PLUM_BARK,
    0,
    0,
    0,
  );
  // Roots, reaching out along the ground.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const len = (3 + rng() * 1.5) * s;
    // Laid over by roll (thin end outward and dipping), then aimed by yaw.
    b.cyl(len, 0.35 * s, 0.9 * s, 8, Math.cos(a) * (1.6 * s + len / 2 - 0.4), 0.25 * s, Math.sin(a) * (1.6 * s + len / 2 - 0.4), PLUM_BARK, {
      y: -a,
      z: -(Math.PI / 2 + 0.12),
    });
  }
  // The gingerbread man in the trunk, peering out toward local -Z.
  {
    const fz = -1.32 * s;
    const fy = 3.4 * s;
    put(b, prism(ovalOutline(0.95 * s, 1.05 * s), -0.15, 0.15, 0.1), GINGER, 0, fy, fz, { x: -Math.PI / 2 });
    for (const sx of [-1, 1]) {
      sphere(b, 0.32 * s, sx * 0.35 * s, fy + 0.25 * s, fz - 0.18, ICING, 8);
      sphere(b, 0.16 * s, sx * 0.35 * s, fy + 0.25 * s, fz - 0.3, "#3a5fb0", 6);
    }
    // The smile, piped.
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.15 + (i / 4) * 0.7);
      b.box(0.14 * s, 0.1 * s, 0.1, Math.cos(a) * 0.5 * s, fy - 0.2 * s - Math.sin(a) * 0.3 * s, fz - 0.2, ICING);
    }
    // Two hands on the bark.
    for (const sx of [-1, 1]) {
      put(b, prism(ovalOutline(0.32 * s, 0.4 * s), -0.12, 0.12, 0.06), GINGER, sx * 1.25 * s, fy - 0.6 * s, fz + 0.12, { x: -Math.PI / 2, y: sx * 0.4 });
    }
  }
  b.block({ w: 2.6 * s, h: 11 * s, d: 2.6 * s, x: 0, y: 5.5 * s, z: 0 });

  // The limbs into the crown.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.6;
    b.cyl(6 * s, 0.5 * s, 1.0 * s, 8, Math.cos(a) * 2.2 * s, 12.5 * s, Math.sin(a) * 2.2 * s, PLUM_BARK, { y: -a, z: -0.75 });
  }
  // The crown: a solid dark mass — the board's crown is a round tree, not a
  // lattice of leaves with sky through it — and star-shaped leaf clusters
  // sown over its shell, the lit ones on top and outside.
  const cy = 17 * s;
  const R = 12 * s;
  const stars = 150;
  put(b, CreateSphereVertexData({ diameterX: R * 1.72, diameterY: R * 1.36, diameterZ: R * 1.72, segments: 14 }), PLUM_LEAF, 0, cy, 0);
  const leafData: VertexData[] = [];
  for (let k = 0; k < 6; k++) {
    leafData.push(prism(starOutline(7 + (k % 3), 2.5 * s, 1.3 * s, k * 0.4), -0.4 * s, 0.4 * s, 0.2 * s));
  }
  for (let i = 0; i < stars; i++) {
    // Uniform over a ball, biased to the shell.
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const rr = R * (0.8 + 0.2 * Math.cbrt(rng()));
    const sq = Math.sqrt(1 - u * u);
    const x = Math.cos(th) * sq * rr;
    const z = Math.sin(th) * sq * rr;
    const y = cy + u * rr * 0.78;
    if (y < 9.5 * s) continue;
    const lit = u > -0.1 && rng() < 0.75;
    put(b, leafData[i % leafData.length], lit ? PLUM_LEAF_LIT : PLUM_LEAF, x, y, z, {
      x: (rng() - 0.5) * 1.6,
      y: rng() * Math.PI * 2,
      z: (rng() - 0.5) * 1.6,
    });
  }
  // What hangs in it: sugar plums, chocolates, cherries and gumballs, on the
  // outside of the crown where the board draws them.
  for (let i = 0; i < 70; i++) {
    const u = rng() * 1.7 - 0.8;
    const th = rng() * Math.PI * 2;
    const sq = Math.sqrt(1 - u * u);
    const rr = R * (0.93 + rng() * 0.12);
    const x = Math.cos(th) * sq * rr;
    const z = Math.sin(th) * sq * rr;
    const y = cy + u * rr * 0.78;
    const kind = i % 4;
    if (kind === 0) sphere(b, 1.2 * s, x, y, z, SUGAR_PLUM, 10);
    else if (kind === 1) {
      b.box(1.1 * s, 0.8 * s, 1.1 * s, x, y, z, CHOCOLATE, { y: th });
      b.box(0.8 * s, 0.25 * s, 0.8 * s, x, y + 0.5 * s, z, MILK_CHOC, { y: th });
    } else if (kind === 2) {
      sphere(b, 0.85 * s, x, y, z, CHERRY, 8);
      b.cyl(0.8 * s, 0.06, 0.06, 4, x, y + 0.7 * s, z, MINT);
    } else sphere(b, 0.8 * s, x, y, z, GUMBALL, 8);
  }
  return b;
}

// --- gumdrops, canes, corn and hearts ---------------------------------------------------

/** A gumdrop's profile, base radius `r` and `h` tall. */
function gumdropProfile(r: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const rr = r * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.6))) * (1 - 0.4 * t);
    out.push([rr, h * t]);
  }
  return out;
}

/**
 * A GUMDROP the size of a hill: moulded ridges round a bell to a rounded top,
 * in one of the board's five colours (`tint`). `height` is 9 m unless it says
 * otherwise. Its collider is three stepped boxes inside the bell, so a round
 * stops on the sugar and nothing can stand on one.
 */
export function buildGumdrop(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "gumdrop");
  const h = p.height ?? 9;
  const r = h * 0.62;
  put(b, revolve(gumdropProfile(r, h), 40, { flutes: 11, fluteDepth: 0.055 }), p.tint ?? GUMDROP_TINTS[0], 0, 0, 0);
  const rAt = (t: number): number => r * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.6))) * (1 - 0.4 * t);
  const bands: [number, number][] = [[0, 0.34], [0.34, 0.64], [0.64, 0.86]];
  for (const [t0, t1] of bands) {
    const side = rAt(t1) * 1.34;
    b.block({ w: side, h: (t1 - t0) * h, d: side, x: 0, y: ((t0 + t1) / 2) * h, z: 0 });
  }
  return b;
}

/**
 * A PEPPERMINT STICK as tall as a tree: a red-and-white cane, its stripes
 * wound round it, hooked over at the top toward local +X. `height` is 10 m
 * unless stated; the collider is the shaft.
 */
export function buildCandyCane(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "candycane");
  const h = p.height ?? 10;
  const r = h * 0.035;
  const hook = h * 0.14;
  const [red, white] = stripedTube(canePath(h, hook, 0.15), r, { seg: 18, bands: 3, twist: 1.1 / (h / 10) });
  put(b, red, p.tint ?? CANE_RED, 0, 0, 0);
  put(b, white, CANE_WHITE, 0, 0, 0);
  b.block({ w: r * 1.5, h: h - hook, d: r * 1.5, x: 0, y: (h - hook) / 2, z: 0 });
  return b;
}

/**
 * A CANDY CORN the size of a person, standing on its broad end: yellow,
 * orange, a white tip.
 */
export function buildCandyCorn(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "candycorn");
  const h = p.height ?? 2.6;
  const r = h * 0.36;
  const at = (t: number): number => r * (1 - t) * (1 - 0.15 * t);
  const band = (t0: number, t1: number, color: string): void => {
    const prof: [number, number][] = [];
    for (let i = 0; i <= 4; i++) {
      const t = t0 + ((t1 - t0) * i) / 4;
      prof.push([Math.max(0.02, at(t)), h * t]);
    }
    put(b, revolve(prof, 16), color, 0, 0, 0);
  };
  band(0, 0.4, "#f0b52a");
  band(0.4, 0.75, "#ee7a22");
  put(b, revolve([[at(0.75), 0.75 * h], [at(0.88), 0.88 * h], [0.05 * r, 0.98 * h], [0, h]], 16), CANE_WHITE, 0, 0, 0);
  b.block({ w: r * 1.2, h: h * 0.7, d: r * 1.2, x: 0, y: h * 0.35, z: 0 });
  return b;
}

/**
 * A CONVERSATION HEART, a person's height, leaning back on the lawn with its
 * motto piped on its face in block letters (`text`, `|` for a new line) —
 * the board's candy hearts say I LOVE YOU, and so does the first of these.
 * `tint` is the sweet's colour; the letters are a deeper red.
 *
 * It leans back a quarter of the way to flat, so it is chest-high cover a
 * round stops on, and its collider leans with it.
 */
export function buildCandyHeart(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "candyheart");
  const size = p.width ?? 3.4;
  const thick = 0.7;
  const lean = 0.62;
  const { pts, centre } = heartOutline(size);
  // Built lying in XZ with its point at -Z and its face up, then stood up:
  // rotX of -(π/2 - lean) turns the face toward -Z, leaning back by `lean`.
  const tilt = -(Math.PI / 2 - lean);
  const lift = size * 0.36;
  const rot = { x: tilt };
  put(b, prism(pts, -thick / 2, thick / 2, 0.16, centre), p.tint ?? "#f28bb0", 0, lift, 0, rot);
  // The motto, on the face (local +Y before the stand-up).
  const text = p.text ?? "I|LOVE|YOU";
  const lines = text.split("|");
  const px = Math.min(0.09, (size * 0.62) / (Math.max(...lines.map((l) => l.length)) * 6));
  const cy = size * 0.02;
  const lineH = 7 * px;
  const total = lines.length * lineH - 2 * px;
  const c = Math.cos(tilt);
  const sn = Math.sin(tilt);
  lines.forEach((line, li) => {
    const { runs, width } = blockText(line);
    const top = cy + total / 2 - li * lineH;
    for (const r of runs) {
      // Lying-down coordinates: u across (X), v up the heart (Z), on the face.
      const u = (r.x + r.w / 2 - width / 2) * px;
      const v = top - (r.y + 0.5) * px;
      const yl = thick / 2 + 0.03;
      // Rotate (y, z) = (yl, v) about X by `tilt`.
      const y = yl * c - v * sn;
      const z = yl * sn + v * c;
      b.box(r.w * px, 0.06, px, u, lift + y, z, "#b8193a", rot);
    }
  });
  // Collider: a box through the heart's body, leaning with it.
  b.block({ w: size * 0.78, h: thick, d: size * 0.75, x: 0, y: lift, z: 0, rotX: tilt });
  return b;
}

// --- the Ice Cream Sea -------------------------------------------------------------------

/**
 * AN ICE CREAM FLOAT: a Neapolitan bar — chocolate, vanilla, strawberry —
 * floating on the Ice Cream Sea. Place it with a `y` that puts its waterline
 * at the sea's surface; half a metre of it rides above the water, which is
 * the cover a wade across the sea is fought from. `length` along local X.
 */
export function buildIceCreamFloat(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "icefloat");
  const len = p.length ?? 7;
  const wid = p.width ?? 3;
  const h = p.height ?? 1.8;
  const third = len / 3;
  const colors = [CHOCOLATE, VANILLA, STRAWBERRY];
  colors.forEach((col, i) => {
    b.box(third + 0.01, h, wid, -len / 2 + third * (i + 0.5), h / 2, 0, col);
  });
  // A drip of melt along the top edges.
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      b.box(third * 0.7, 0.12, 0.14, -len / 2 + third * (i + 0.5), h - 0.02, sz * (wid / 2 + 0.03), colors[i]);
    }
  }
  b.block({ w: len, h, d: wid, x: 0, y: h / 2, z: 0 });
  return b;
}

/**
 * A POPSICLE BUOY: an orange ice lolly on its stick, driven into the sea bed
 * at a lean like a channel marker, with a red float round its foot.
 */
export function buildPopsicle(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "popsicle");
  const h = p.height ?? 6;
  const lean = 0.28;
  const pw = h * 0.36;
  const ph = h * 0.6;
  const stick = h * 0.45;
  const c = Math.cos(lean);
  const sn = Math.sin(lean);
  const at = (y: number): [number, number] => [sn * y, c * y];
  {
    const [x, y] = at(stick / 2);
    b.box(0.45, stick, 0.12, x, y, 0, WAFER, { z: -lean });
  }
  {
    const [x, y] = at(stick + ph / 2 - 0.4);
    // A rounded-top bar: a box and a half-oval cap.
    b.box(pw, ph - pw / 2, pw * 0.36, x, y - pw / 4, 0, p.tint ?? "#f08a2a", { z: -lean });
    const [cx, cyy] = at(stick + ph - 0.4 - pw / 2);
    // A disc is the same disc turned about its own axis, so standing it up
    // is the whole of its rotation.
    put(b, prism(ovalOutline(pw / 2, pw / 2, 20), -pw * 0.18, pw * 0.18, 0.05), p.tint ?? "#f08a2a", cx, cyy, 0, { x: -Math.PI / 2 });
  }
  put(b, CreateTorusVertexData({ diameter: 1.4, thickness: 0.45, tessellation: 18 }), CHERRY, 0, 0.3, 0);
  b.block({ w: pw * 0.8, h: ph * 0.8, d: pw * 0.4, x: sn * (stick + ph / 2), y: c * (stick + ph / 2), z: 0 });
  return b;
}

// --- signs --------------------------------------------------------------------------------

/**
 * A MILEAGE SIGN on a peppermint post: a board cut to an arrow pointing down
 * local +X, its words in block letters on both faces (`text`, `|` for a new
 * line) — 16 MILES, 59 MILES and the rest, and the START sign itself.
 */
export function buildSignpost(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "signpost");
  const text = p.text ?? "START";
  const lines = text.split("|");
  const px = 0.06;
  const longest = Math.max(...lines.map((l) => blockText(l).width));
  const bw = Math.max(1.6, longest * px + 0.6);
  const bh = lines.length * 7 * px + 0.25;
  const postH = 2.5 + bh;
  canePost(b, postH, 0.09, 0, 0, 0);
  const cy = postH - bh / 2 - 0.15;
  const board = p.tint ?? SIGN_BOARD;
  b.box(bw, bh, 0.12, bw / 2 - 0.35, cy, 0, board);
  // The arrow's point.
  const tip = bh / 2 + 0.05;
  for (const sy of [-1, 1]) {
    b.box(tip * 1.45, 0.14, 0.121, bw - 0.35 + tip / 2 - 0.08, cy + (sy * bh) / 4, 0, board, { z: -sy * Math.PI / 4 });
  }
  letters(b, text, bw / 2 - 0.35, cy, -0.06, px, "#5a2d1a");
  letters(b, text, bw / 2 - 0.35, cy, 0.06, px, "#5a2d1a", { back: true });
  b.block({ w: 0.22, h: postH, d: 0.22, x: 0, y: postH / 2, z: 0 });
  return b;
}

// --- the Molasses Swamp -----------------------------------------------------------------

/**
 * The MOLASSES SWAMP's sheet: a level, lobed pool of molasses at local zero,
 * `width` by `depth`, with bubbles standing in it.
 *
 * It is laid over a BASIN dug in the floor, the way water is (`docs/world.md`:
 * water in this engine is a hole in the floor with a plane over it), so where
 * its edge meets the bank is where the rising ground cuts through it and
 * nothing is coplanar with anything. Visual only — a body wades through it on
 * the bed underneath, shin-deep in treacle — and never a shadow caster: it is
 * a sheet lying on the ground.
 */
export function buildMolasses(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "molasses");
  const rx = (p.width ?? 24) / 2;
  const rz = (p.depth ?? 18) / 2;
  const outline: [number, number][] = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = 1 + 0.1 * Math.sin(3 * a + 0.4) + 0.06 * Math.sin(5 * a + 1.3);
    outline.push([Math.cos(a) * rx * wob, Math.sin(a) * rz * wob]);
  }
  const sheet = put(b, prism(outline, -0.4, 0, 0), MOLASSES, 0, 0, 0);
  sheet.metadata = { noShadowCaster: true };
  const rng = mulberry32(0x6d6f6c);
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.8;
    const d = 0.3 + rng() * 0.7;
    put(b, revolve([[d / 2, -0.05], [d * 0.45, d * 0.15], [d * 0.3, d * 0.3], [0, d * 0.36]], 12), MOLASSES_SHEEN, Math.cos(a) * rx * r, 0, Math.sin(a) * rz * r);
  }
  return b;
}

// --- dressing ------------------------------------------------------------------------------

/**
 * A CHOCOLATE BAR stood on its edge in the lawn, half unwrapped: a low wall of
 * moulded squares, foil and a paper band on one end. Waist-high cover,
 * `length` along local X.
 */
export function buildChocolateBar(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "chocbar");
  const len = p.length ?? 6;
  const h = p.height ?? 1.3;
  const t = 0.5;
  b.box(len, h, t, 0, h / 2, 0, p.tint ?? MILK_CHOC);
  const cols = Math.max(2, Math.round(len / 0.75));
  const rows = 2;
  const cw = len / cols;
  const rh = h / rows;
  const wrapped = Math.floor(cols * 0.35);
  for (let i = wrapped; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -len / 2 + cw * (i + 0.5);
      const y = rh * (j + 0.5);
      for (const sz of [-1, 1]) b.box(cw - 0.12, rh - 0.12, 0.08, x, y, sz * (t / 2 + 0.03), p.tint ?? MILK_CHOC);
    }
  }
  // The wrapper on the first third: foil, and the paper band over it.
  const ww = cw * wrapped;
  b.box(ww + 0.02, h + 0.06, t + 0.1, -len / 2 + ww / 2, h / 2 + 0.01, 0, FOIL);
  b.box(ww * 0.8, h + 0.1, t + 0.14, -len / 2 + ww * 0.4, h / 2 + 0.02, 0, WRAPPER);
  b.block({ w: len, h, d: t + 0.1, x: 0, y: h / 2, z: 0 });
  return b;
}

/**
 * A GINGERBREAD MAN standing on the lawn, three metres of cookie with piped
 * icing and gumdrop buttons, looking down local -Z. `tint` colours the cookie:
 * the board's four playing pieces are gingerbread men in red, green, yellow
 * and blue, and they wait at START.
 */
export function buildGingerbreadMan(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "gingerman");
  const cookie = p.tint ?? COOKIE;
  const s = (p.height ?? 3.2) / 3.2;
  const t = 0.42 * s;
  const up = { x: -Math.PI / 2 };
  // `lean` turns a limb in the standing plane, +X toward +Y — which from the
  // front is anticlockwise, so a positive lean raises a LEFT arm's hand.
  const part = (rx: number, rz: number, x: number, y: number, lean = 0): void => {
    put(b, prism(ovalTurned(rx * s, rz * s, lean), -t / 2, t / 2, 0.12 * s), cookie, x * s, y * s, 0, up);
  };
  part(0.62, 0.62, 0, 2.55); // head
  part(0.72, 0.85, 0, 1.55); // body
  part(0.28, 0.72, -0.9, 1.75, 1.0); // arms, raised
  part(0.28, 0.72, 0.9, 1.75, -1.0);
  part(0.3, 0.72, -0.42, 0.62, -0.28); // legs, apart
  part(0.3, 0.72, 0.42, 0.62, 0.28);
  const fz = -t / 2 - 0.02;
  for (const sx of [-1, 1]) {
    sphere(b, 0.2 * s, sx * 0.22 * s, 2.68 * s, fz, ICING, 6);
    sphere(b, 0.1 * s, sx * 0.22 * s, 2.68 * s, fz - 0.06, "#3a5fb0", 5);
  }
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.2 + (i / 4) * 0.6);
    b.box(0.1 * s, 0.07 * s, 0.06, Math.cos(a) * 0.3 * s, (2.45 - Math.sin(a) * 0.14) * s, fz, ICING);
  }
  [CHERRY, MINT, "#efbd2a"].forEach((col, i) => sphere(b, 0.24 * s, 0, (1.9 - i * 0.36) * s, fz - 0.05, col, 8));
  // Icing zigzags at the wrists and ankles.
  for (const [x, y, r] of [[-1.4, 2.25, -1.0], [1.4, 2.25, 1.0], [-0.55, 0.2, -0.28], [0.55, 0.2, 0.28]] as const) {
    b.box(0.5 * s, 0.07 * s, 0.05, x * s, y * s, fz, ICING, { z: r });
  }
  b.block({ w: 2.4 * s, h: 3.2 * s, d: t, x: 0, y: 1.6 * s, z: 0 });
  return b;
}

/** A CUPCAKE as tall as a person: a pleated case, a swirl, a cherry. */
export function buildCupcake(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "cupcake");
  const s = (p.height ?? 2.6) / 1.43;
  cupcake(b, s, 0, 0, 0, p.tint ?? "#7cc5e8", FROSTING);
  // Sprinkles over the frosting.
  const rng = mulberry32(0x63757063);
  for (let i = 0; i < 30; i++) {
    const a = rng() * Math.PI * 2;
    const tt = rng() * 0.8;
    const r = 0.72 * (1 - tt) * s + 0.02;
    b.box(0.05 * s, 0.05 * s, 0.16 * s, Math.cos(a) * r, (0.55 + 0.75 * tt) * s, Math.sin(a) * r, SPRINKLES[i % SPRINKLES.length], { y: rng() * 3, x: 0.6 });
  }
  b.block({ w: 1.1 * s, h: 1.0 * s, d: 1.1 * s, x: 0, y: 0.5 * s, z: 0 });
  return b;
}

/**
 * An ICE CREAM CONE stuck point-down in the lawn: a waffle cone and two scoops
 * with a melt collar. Like the board's cones outside Home Sweet Home.
 */
export function buildIceCreamCone(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "icecone");
  const s = (p.height ?? 3.2) / 3.2;
  put(b, revolve([[0.05 * s, -0.3 * s], [0.62 * s, 1.9 * s], [0.66 * s, 1.95 * s]], 16, { flutes: 16, fluteDepth: 0.03, fluteFade: false }), WAFER, 0, 0, 0);
  const scoops = [p.tint ?? STRAWBERRY, VANILLA];
  scoops.forEach((col, i) => {
    const y = (2.25 + i * 0.7) * s;
    sphere(b, (1.3 - i * 0.2) * s, 0, y, 0, col, 14);
    put(b, CreateTorusVertexData({ diameter: (1.15 - i * 0.2) * s, thickness: 0.22 * s, tessellation: 16 }), col, 0, y - 0.35 * s, 0);
  });
  sphere(b, 0.28 * s, 0, 3.55 * s, 0, CHERRY, 8);
  b.block({ w: 0.9 * s, h: 3.2 * s, d: 0.9 * s, x: 0, y: 1.6 * s, z: 0 });
  return b;
}

/**
 * A PEPPERMINT FENCE: candy-cane posts every couple of metres and two striped
 * rails, `length` along local X — the board's fence by Home Sweet Home.
 *
 * The fence's own pair, exactly as `buildFence` has it: a `porous` box is the
 * body (walked into, severed across by the nav graph, a round passes it) and
 * the posts and rails are `strut`s (a round aimed at one stops on it). For
 * level ground; it does not step.
 */
export function buildCandyFence(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "candyfence");
  const len = p.length ?? 10;
  const h = 1.25;
  const gaps = Math.max(1, Math.round(len / 2.2));
  for (let i = 0; i <= gaps; i++) {
    const x = -len / 2 + (len * i) / gaps;
    canePost(b, h, 0.09, x, 0, 0);
    sphere(b, 0.24, x, h + 0.04, 0, CANE_RED, 6);
    b.block({ w: 0.16, h, d: 0.16, x, y: h / 2, z: 0, rayOnly: true });
  }
  for (const y of [0.45, 0.95]) {
    const path: V3[] = [];
    const nn = Math.max(2, Math.ceil(len / 0.2));
    for (let i = 0; i <= nn; i++) path.push([-len / 2 + (len * i) / nn, 0, 0]);
    const [red, white] = stripedTube(path, 0.07, { seg: 10, bands: 2, twist: 4 });
    put(b, red, CANE_RED, 0, y, 0);
    put(b, white, CANE_WHITE, 0, y, 0);
    b.block({ w: len, h: 0.14, d: 0.14, x: 0, y, z: 0, rayOnly: true });
  }
  b.block({ w: len, h, d: 0.3, x: 0, y: h / 2, z: 0, porous: true });
  return b;
}
