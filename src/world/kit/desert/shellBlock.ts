/**
 * kit/desert/shellBlock.ts — buildShellBlock: the shelled apartment block of
 * the town's newer streets, a reinforced-concrete frame infilled with hollow
 * block, shops shuttered along its ground floor, three walked floors with an
 * open window band on each and its top corner blown off — and `STOREY_RC`,
 * the concrete frame's storey, which nothing else uses. Part of the
 * desert-town set: follows the contract in kit/core.ts and the set's rules in
 * `./index.ts`. Invariants: every collider byte for byte and in its order —
 * the plinth, the flights, the slabs, the frame, the parapet, the heap and
 * its bars — restated at the top; variation is seeded off where it stands
 * (`streetSeed`), never `Math.random()`. Never imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  ALLOY,
  AWNING,
  Build,
  CONCRETE,
  DARK_CONCRETE,
  ENAMEL,
  IRON,
  Mesher,
  carve,
  hideBack,
  orient,
  outward,
  runsAlongX,
  streetSeed,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Side,
  type Structure,
  type V3,
} from "../core";
import {
  WHITEWASH,
  ROOF_MUD,
  PALM_BEAM,
  SANDBAG,
  SCORCH,
  WINDOW_VOID,
  T,
  PLINTH,
  SLAB,
  PARAPET,
  PARAPET_T,
  LANDING,
  levels,
  laneGeom,
  assertClimbable,
  laneFlight,
  clothHash,
  drape,
} from "./shared";
import { HIDE_DOWN, Lay, TAU, blob, eye, fdir, fp, kufic, log, opp, pocks } from "./lay";

/** Storey height for a reinforced-concrete frame. */
const STOREY_RC = 3.2;
/** The wall under every opening on a floor above the street: chest high. */
const SPANDREL = 0.95;
/** The beam over every opening, which the floor above stands on. */
const LINTEL = 0.42;
/** The stair's doorway through each long wall of the ground floor. */
const DOOR_W = 1.8;
const DOOR_H = 2.4;

/**
 * Hollow concrete block, which every wall that is not the frame is laid in:
 * a course of 0.2 m and a unit of 0.4 at a pitch of 0.42 (half of it the
 * bond's stagger), bedded on a darker mortar.
 */
const BLOCK = { course: 0.2, len: 0.4, pitch: 0.42, half: 0.21, color: CONCRETE, ground: DARK_CONCRETE } as const;

/** The bit that leaves a member's TOP out, where it is cast into a slab. */
const HIDE_UP = 1 << 2;
/** A box's six faces; what is left out of a thing seen only from above or only from the front. */
const ALL = 63;
/** Only the top: grout a few millimetres proud, whose sides no eye resolves. */
const ONLY_UP = ALL & ~HIDE_UP;
/** Only the face looking out along side `s`: paint or lettering standing a hair off its ground. */
const onlyFront = (s: Side): number => ALL & ~hideBack(opp(s));
/** A bar's two end caps, which are its local Z faces and a few millimetres square. */
const NO_ENDS = (1 << 4) | (1 << 5);

/**
 * The shelled block: a reinforced-concrete apartment block with its top
 * corner taken off, three walked floors, and an open window band on every
 * one of them.
 *
 * ## What it is FOR, against the house next to it
 *
 * The house is a roof; this is a BUILDING you fight inside. Three plates, a
 * stair shaft joining them, no glass anywhere and a chest-high spandrel under
 * every opening — so every floor shoots every street around it and is shot back
 * at from the floors above and below. It is `buildOffice`'s shape with the
 * glazing taken out and one corner blown off, and it is deliberately the only
 * thing on this map carrying that much interior: the rest of the town is walls.
 *
 * **No glass at all, and that is a rule rather than a saving.**
 * `PaneSpec.breakable` is for glass with enterable space behind it, and a
 * shelled block is enterable space behind every opening on it — so every window
 * here would qualify, and a dozen buildings' worth would be hundreds of entries
 * in `GameMap.panes`, which is identity on the wire. A town this size gets to
 * have its breakable glazing somewhere it is worth naming; here the windows are
 * already gone, which is both cheaper and truer.
 *
 * ## The sheared corner, which is not decoration
 *
 * The top floor keeps a little over half its plate and a spur along one side;
 * the rest, and the spandrels that stood on it, are gone. What it buys is a
 * building whose top floor is a different SHAPE from the two under it — an
 * open edge with a two-storey drop off it, which is a place worth holding and
 * a place worth not standing on. A block shelled uniformly is a block with
 * three identical floors, which is the thing this whole file is trying not to
 * build.
 *
 * `depth` carries the stair exactly as the house's does, and at `STOREY_RC` the
 * flights are longer — 10.9 m of run, so 14 m is the least depth that works and
 * `assertClimbable` says so.
 *
 * ## What it is drawn as
 *
 * The block the Levant's towns put up in the seventies and eighties: a frame
 * of columns, beams and slab edges, infilled with hollow block rendered cream
 * or left in cement grey (seeded), so the frame reads against the infill by
 * VALUE. The ground floor is a row of shops between pilasters — steel roller
 * shutters in their guides, painted signboards lettered over them, posters
 * pasted beside the stair's doorway under a cast hood, the steel door thrown
 * back inside it. Every opening above has a cast sill and either nothing left
 * in it, an aluminium frame with its roller box and sometimes its shutter
 * half down, a frame torn half out, or burglar bars on the first floor; air
 * conditioners hang off the spandrels, washing hangs over them, and a burnt
 * window has its scorch climbing the face. The infill is holed through to its
 * blockwork and pocked; the frame carries downpipes, the roof starter bars
 * for the storey nobody built, dishes, an aerial and a sniper's mattress.
 * Inside, every floor has its partitions' footings and its tiles, and what
 * was left in the rooms; the ceilings have their beams, fans and bulbs. The
 * shear has a broken edge with its bars hanging out of it, the stubs of the
 * columns it took and their bars, scorch, and slab lying on the floor under
 * it; the heap inside the ground floor is rubble with its bars standing in it.
 *
 * Everything that varies is seeded off where the block stands (`streetSeed`),
 * so the four blocks round one square are four blocks, and its plinth's face
 * is carried down to the ground — which is what puts it in
 * `CONFORMS_TO_TERRAIN`.
 *
 * **What is drawn over the open band is thin or overhead** — a frame, bars,
 * a roller box, a shutter that stops above the eye — because nothing in that
 * band stops a round or a look, and a sheet drawn across it would hide a body
 * the bots can see.
 */
export function buildShellBlock(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "shell");
  const w = p.width ?? 20;
  const d = p.depth ?? 15;
  const floors = Math.max(2, Math.min(4, p.floors ?? 3));
  const ys = levels(floors, STOREY_RC);
  const { plateW, plateX } = laneGeom(w);
  const plateD = d - 2 * T;
  /** What is left of the top plate after the shear. */
  const topW = plateW * 0.58;
  const topX = plateX - (plateW - topW) / 2;
  const rw = plateW - topW;
  assertClimbable("shellBlock", d, ys[1] - ys[0]);

  // --- the colliders, restated in their order ----------------------------------
  // 1 — the plinth.
  b.block({ w: w + 0.8, h: PLINTH, d: d + 0.8, x: 0, y: PLINTH / 2, z: 0 });
  // 2 — the flights, alternating in the one lane; they draw their own treads.
  const dir0: 1 | -1 = (p.rampSide ?? -1) === 1 ? 1 : -1;
  for (let k = 1; k <= floors; k++) {
    const dir: 1 | -1 = k % 2 === 1 ? dir0 : ((-dir0) as 1 | -1);
    laneFlight(b, w, d, ys[k - 1], ys[k], dir, DARK_CONCRETE);
  }
  // 3 — the slabs, the last of them sheared, and the spur left on the -Z side
  // of the break, so the shear runs across the floor at an angle rather than
  // cutting it straight in two.
  for (let k = 1; k <= floors; k++) {
    const top = k === floors;
    const pw = top ? topW : plateW;
    const px = top ? topX : plateX;
    b.block({ w: pw, h: SLAB, d: plateD, x: px, y: ys[k] - SLAB / 2, z: 0 });
    if (top) {
      b.block({ w: rw, h: SLAB, d: plateD * 0.46, x: px + topW / 2 + rw / 2, y: ys[k] - SLAB / 2, z: -plateD * 0.27 });
    }
  }
  // 4 — the frame. The ground floor is enclosed with two doorways and every
  // floor above it is a spandrel under an open band, which is the gradient this
  // building is: a dark room to get into, a gallery to hold.
  for (let k = 0; k < floors; k++) {
    const y = ys[k];
    const shear = k === floors - 1;
    const spanW = shear ? topW : w;
    const spanX = shear ? topX : 0;
    if (k === 0) {
      doorBlocks(b, w, STOREY_RC, T, 0, y + STOREY_RC / 2, -(d - T) / 2, DOOR_W, DOOR_H);
      doorBlocks(b, w, STOREY_RC, T, 0, y + STOREY_RC / 2, (d - T) / 2, DOOR_W, DOOR_H);
      for (const sx of [-1, 1] as const) {
        b.block({ w: T, h: STOREY_RC, d: plateD, x: (sx * (w - T)) / 2, y: y + STOREY_RC / 2, z: 0 });
      }
      continue;
    }
    for (const sz of [-1, 1] as const) {
      const z = (sz * (d - T)) / 2;
      b.block({ w: spanW, h: SPANDREL, d: T, x: spanX, y: y + SPANDREL / 2, z });
      b.block({ w: spanW, h: LINTEL, d: T, x: spanX, y: y + STOREY_RC - 0.21, z });
    }
    b.block({ w: T, h: SPANDREL, d: plateD, x: -(w - T) / 2, y: y + SPANDREL / 2, z: 0 });
    b.block({ w: T, h: LINTEL, d: plateD, x: -(w - T) / 2, y: y + STOREY_RC - 0.21, z: 0 });
    if (!shear) {
      b.block({ w: T, h: SPANDREL, d: plateD, x: (w - T) / 2, y: y + SPANDREL / 2, z: 0 });
      b.block({ w: T, h: LINTEL, d: plateD, x: (w - T) / 2, y: y + STOREY_RC - 0.21, z: 0 });
    }
  }
  // 5 — what is left of the roof parapet, and the heap inside the ground floor
  // with its bars standing in it. All of it after every walked surface.
  const roofY = ys[floors];
  for (const sz of [-1, 1] as const) {
    b.block({ w: topW, h: PARAPET, d: PARAPET_T, x: topX, y: roofY + PARAPET / 2, z: (sz * (d - PARAPET_T)) / 2 });
  }
  b.block({ w: PARAPET_T, h: PARAPET, d: plateD, x: topX - (topW - PARAPET_T) / 2, y: roofY + PARAPET / 2, z: 0 });
  const heaps: Heap[] = [
    { w: 3.6, h: 1.15, d: 3.0, x: w * 0.3, y: PLINTH + 0.575, z: d * 0.24 },
    { w: 2.6, h: 0.8, d: 2.4, x: w * 0.36, y: PLINTH + 0.4, z: -d * 0.1 },
  ];
  for (const h of heaps) b.block({ w: h.w, h: h.h, d: h.d, x: h.x, y: h.y, z: h.z });
  for (let i = 0; i < 5; i++) {
    b.strut(0.08, 1.5, 0.08, w * 0.3 + (i - 2) * 0.5, PLINTH + 1.6, d * 0.24 + (i % 2) * 0.4, IRON);
  }

  // --- the drawing ---------------------------------------------------------------
  const rnd = mulberry32(streetSeed(w, d, floors * STOREY_RC, ctx));
  const skin = rnd() < 0.6 ? WHITEWASH : CONCRETE;
  const k: Shell = {
    w,
    d,
    floors,
    ys,
    plateD,
    edge: plateX + plateW / 2,
    topW,
    topX,
    xe: topX + topW / 2,
    spurZ: -plateD * 0.27 + (plateD * 0.46) / 2,
    roofY,
    skin,
    frame: skin === WHITEWASH ? CONCRETE : DARK_CONCRETE,
    grid: rhythm(w, 0),
    topDir: floors % 2 === 1 ? dir0 : ((-dir0) as 1 | -1),
    plans: [],
    rnd,
    ground: (lx: number, lz: number): number => {
      if (!ctx) return 0;
      const cos = Math.cos(ctx.rotY);
      const sin = Math.sin(ctx.rotY);
      return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
    },
  };
  for (let f = 0; f < floors; f++) {
    const lines = k.grid.filter((x) => x > -w / 2 + T + 1.2 && x < k.edge - 1.2);
    const first = rnd() < 0.5 ? 0 : 1;
    k.plans.push({ spine: (rnd() - 0.5) * 1.6, cross: lines.filter((_, i) => i % 2 === first) });
  }
  const lay = new Lay();
  plinth(lay, k);
  shops(lay, k);
  ends(lay, k);
  storeys(lay, b, k);
  shear(lay, k);
  roof(lay, b, k);
  lay.flush(b);

  // --- the masses, after what is laid on them ------------------------------------
  b.box(w + 0.8, PLINTH, d + 0.8, 0, PLINTH / 2, 0, DARK_CONCRETE);
  // Every storey's floor slab without its top, which the rooms lay once
  // (tiles, or the screed at the slab's own height): a top under a tiled
  // room is a floor shaded twice, which measured 3.5% standing in one.
  const slabs = new Lay();
  for (let f = 1; f < floors; f++) slabs.sb.box(plateW, SLAB, plateD, plateX, ys[f] - SLAB / 2, 0, CONCRETE, undefined, HIDE_UP);
  slabs.flush(b);
  for (let f = 1; f <= floors; f++) {
    const top = f === floors;
    const pw = top ? topW : plateW;
    const px = top ? topX : plateX;
    if (top) b.box(pw, SLAB, plateD, px, ys[f] - SLAB / 2, 0, CONCRETE);
    if (top) b.box(rw, SLAB, plateD * 0.46, px + topW / 2 + rw / 2, ys[f] - SLAB / 2, -plateD * 0.27, CONCRETE);
    // The slab's edge beam, brought out to the face of the wall under it: the
    // floor line every storey of a frame is read by. Over the plate, and over
    // the column at the lane's far side; the lane itself is the stair's slot.
    for (const sz of [-1, 1] as const) {
      const x1 = top ? (sz > 0 ? k.xe : k.edge) : k.edge;
      const zc = sz * (d / 2 - T / 2);
      b.box(x1 + w / 2, SLAB, T, (x1 - w / 2) / 2, ys[f] - SLAB / 2, zc, k.frame);
      if (!top) b.box(T, SLAB, T, (w - T) / 2, ys[f] - SLAB / 2, zc, k.frame);
    }
  }
  // The ground floor's walls: the two doorways' pieces and the two ends.
  const side = (w - DOOR_W) / 2;
  for (const sz of [-1, 1] as const) {
    const z = (sz * (d - T)) / 2;
    for (const e of [-1, 1]) b.box(side, STOREY_RC, T, e * (DOOR_W / 2 + side / 2), PLINTH + STOREY_RC / 2, z, skin);
    b.box(DOOR_W, STOREY_RC - DOOR_H, T, 0, PLINTH + DOOR_H + (STOREY_RC - DOOR_H) / 2, z, skin);
  }
  for (const sx of [-1, 1] as const) b.box(T, STOREY_RC, plateD, (sx * (w - T)) / 2, PLINTH + STOREY_RC / 2, 0, skin);
  for (let f = 1; f < floors; f++) {
    const y = ys[f];
    const shear = f === floors - 1;
    const spanW = shear ? topW : w;
    const spanX = shear ? topX : 0;
    for (const sz of [-1, 1] as const) {
      const z = (sz * (d - T)) / 2;
      b.box(spanW, SPANDREL, T, spanX, y + SPANDREL / 2, z, skin);
      b.box(spanW, LINTEL, T, spanX, y + STOREY_RC - LINTEL / 2, z, k.frame);
      // The columns between the bays: the frame the spandrels hang off, and
      // the only thing standing at the corners of an open floor.
      for (const x of rhythm(spanW, spanX)) b.box(0.44, STOREY_RC, 0.5, x, y + STOREY_RC / 2, z, k.frame);
    }
    for (const sx of shear ? [-1] : [-1, 1]) {
      b.box(T, SPANDREL, plateD, (sx * (w - T)) / 2, y + SPANDREL / 2, 0, skin);
      b.box(T, LINTEL, plateD, (sx * (w - T)) / 2, y + STOREY_RC - LINTEL / 2, 0, k.frame);
    }
  }
  for (const sz of [-1, 1] as const) {
    b.box(topW, PARAPET, PARAPET_T, topX, roofY + PARAPET / 2, (sz * (d - PARAPET_T)) / 2, skin);
  }
  b.box(PARAPET_T, PARAPET, plateD, topX - (topW - PARAPET_T) / 2, roofY + PARAPET / 2, 0, skin);
  // What is inside, after the walls that hide most of it from the street:
  // the rooms and the heap, then the ceilings under every slab, so from
  // outside and from above it is they the depth test rejects rather than
  // the walls and slabs drawn over them.
  const inside = new Lay();
  rooms(inside, k);
  for (const h of heaps) heap(inside, k, h);
  inside.flush(b);
  const under = new Lay();
  ceilings(under, k);
  under.flush(b);
  return b;
}

/**
 * `Build.doorWall`'s colliders, and nothing drawn: its two piers and its
 * lintel, in its order and by its arithmetic, so the boxes are the ones it
 * always emitted to the bit.
 */
function doorBlocks(
  b: Build,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  gapWidth: number,
  gapHeight: number,
): void {
  const side = (w - gapWidth) / 2;
  if (side > 0.05) {
    const off = gapWidth / 2 + side / 2;
    b.block({ w: side, h, d, x: x - off, y, z });
    b.block({ w: side, h, d, x: x + off, y, z });
  }
  const lintel = h - gapHeight;
  if (lintel > 0.05) b.block({ w: gapWidth, h: lintel, d, x, y: y + h / 2 - lintel / 2, z });
}

/** Where the columns of a front `span` wide centred on `x` stand: every 5 m or so. */
function rhythm(span: number, x: number): number[] {
  const bays = Math.max(2, Math.round(span / 5.0));
  const out: number[] = [];
  for (let i = 0; i <= bays; i++) out.push(x - span / 2 + (i / bays) * span);
  return out;
}

/** One of the two boxes the heap's colliders are. */
interface Heap {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
}

/** What the drawing's parts are measured by. */
interface Shell {
  w: number;
  d: number;
  floors: number;
  ys: number[];
  plateD: number;
  /** The plate's +X edge, where the stair lane begins. */
  edge: number;
  topW: number;
  topX: number;
  /** The shear's line across the plate: the top storey and the roof stop here. */
  xe: number;
  /** The spur's free edge: past `xe`, what is left of the roof runs from the -Z face to here. */
  spurZ: number;
  roofY: number;
  /** The infill's render, and the frame's concrete, a value apart from it. */
  skin: string;
  frame: string;
  /** Where the frame's columns stand across the whole front. */
  grid: number[];
  /** Which way the last flight climbs: to +Z, its landing is left on its own. */
  topDir: 1 | -1;
  /** Each floor's plan: the spine wall's line and the cross walls'. */
  plans: { spine: number; cross: number[] }[];
  rnd: () => number;
  ground: (lx: number, lz: number) => number;
}

const SIDES: readonly Side[] = ["-z", "+z", "-x", "+x"];
const LONG: readonly Side[] = ["-z", "+z"];

// --- small words -------------------------------------------------------------------

/** A bar from `a` to `c`: rebar, a conduit, an aerial's element. */
function rod(lay: Lay, a: Point3, c: Point3, r: number, color: string = IRON): void {
  const o = orient(a, c);
  lay.sb.box(r, r, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot, NO_ENDS);
}

/** A broken lump of concrete or block lying at `(x, z)` on `y`. */
function chunk(lay: Lay, x: number, y: number, z: number, size: number, color: string, rnd: () => number): void {
  const h = Math.min(0.22, size * (0.35 + rnd() * 0.4));
  lay.sb.box(size * (0.7 + rnd() * 0.6), h, size * (0.6 + rnd() * 0.5), x, y + h * 0.4, z, color, {
    y: rnd() * TAU,
    x: (rnd() - 0.5) * 0.5,
    z: (rnd() - 0.5) * 0.5,
  }, HIDE_DOWN);
}

/**
 * A lobe laid on a level surface, its face at `y` looking up (or down, for a
 * soffit) and its sides 2 cm deep: an ellipse `a` by `b` turned `yaw`, with a
 * slow wave in its edge. Fanned from its centre, from which it is star-shaped.
 */
function lobe(m: Mesher, x: number, y: number, z: number, a: number, bb: number, yaw: number, up: boolean, rnd: () => number): void {
  const p1 = rnd() * TAU;
  const p2 = rnd() * TAU;
  const N = 14;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU;
    const kk = 1 + 0.18 * Math.sin(2 * t + p1) + 0.1 * Math.sin(3 * t + p2);
    const u = Math.cos(t) * a * kk;
    const v = Math.sin(t) * bb * kk;
    pts.push([x + u * c - v * sn, z + u * sn + v * c]);
  }
  const face: V3 = [0, up ? 1 : -1, 0];
  const back = up ? y - 0.02 : y + 0.02;
  for (let i = 0; i < N; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % N];
    m.tri([x, y, z], [ax, y, az], [bx, y, bz], face);
    m.quad([ax, back, az], [bx, back, bz], [bx, y, bz], [ax, y, az], [(ax + bx) / 2 - x, 0, (az + bz) / 2 - z]);
  }
}

/** A ragged outline round `(u, y)`, `a` by `bb`, for a hole or a burn on a face. */
function ragged(u: number, y: number, a: number, bb: number, n: number, rnd: () => number): [number, number][] {
  const pts: [number, number][] = [];
  const p = rnd() * TAU;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const kk = 0.75 + 0.2 * Math.sin(3 * t + p) + rnd() * 0.3;
    pts.push([u + Math.cos(t) * a * kk, y + Math.sin(t) * bb * kk]);
  }
  return pts;
}

/** A poster pasted on a face at `out`: a sheet, a portrait on it and two lines under that. */
function poster(lay: Lay, s: Side, plane: number, u: number, y: number, out: number, rnd: () => number): void {
  const back = hideBack(s);
  const tilt = (rnd() - 0.5) * 0.08;
  lay.sb.onFace(s, plane, u, y, 0.44, 0.6, 0.008, out + 0.004, WHITEWASH, tilt, 0, back);
  lay.sb.onFace(s, plane, u, y + 0.08, 0.22, 0.28, 0.008, out + 0.012, SCORCH, tilt, 0, back);
  lay.sb.onFace(s, plane, u, y - 0.17, 0.34, 0.05, 0.008, out + 0.012, AWNING, tilt, 0, back);
  lay.sb.onFace(s, plane, u, y - 0.24, 0.26, 0.03, 0.008, out + 0.012, SCORCH, tilt, 0, back);
}

// --- the plinth --------------------------------------------------------------------

/** A cast nosing on the plinth's lip all round, and its face carried down to the ground. */
function plinth(lay: Lay, k: Shell): void {
  for (const s of SIDES) {
    const along = runsAlongX(s);
    const len = (along ? k.w : k.d) + 0.8;
    const plane = (along ? k.d : k.w) / 2 + 0.4;
    const back = hideBack(s);
    lay.sb.onFace(s, plane, 0, PLINTH - 0.04, len + 0.06, 0.08, 0.06, 0.03, k.frame, 0, 0, back);
    let low = 0;
    for (let i = 0; i <= 8; i++) {
      const u = -len / 2 + (i / 8) * len;
      const o = outward(s) * (plane + 0.3);
      low = Math.min(low, along ? k.ground(u, o) : k.ground(o, u));
    }
    if (low < -0.03) lay.sb.onFace(s, plane, 0, low / 2, len, -low, 0.3, -0.15, DARK_CONCRETE, 0, 0, back);
  }
}

// --- the ground floor --------------------------------------------------------------

/** Both long fronts of the ground floor: pilasters, the shops between them, and the stair's door. */
function shops(lay: Lay, k: Shell): void {
  const { w, d } = k;
  const lo = PLINTH;
  const hi = PLINTH + STOREY_RC;
  for (const s of LONG) {
    const plane = d / 2;
    const back = hideBack(s);
    const cols = k.grid.map((x) => Math.max(-w / 2 + 0.25, Math.min(w / 2 - 0.25, x))).filter((x) => Math.abs(x) > DOOR_W / 2 + 0.75);
    for (const u of cols) lay.sb.onFace(s, plane, u, (lo + hi) / 2, 0.5, hi - lo, 0.08, 0.04, k.frame, 0, 0, back);
    pocks(lay, s, plane, -w / 2, w / 2, lo + 0.3, hi - 0.1, 4, k.rnd);
    const cuts: [number, number][] = cols.map((u) => [u - 0.25, u + 0.25]);
    cuts.push([-DOOR_W / 2 - 1.0, DOOR_W / 2 + 1.0]);
    for (const [a, c] of carve(-w / 2, w / 2, cuts)) {
      if (c - a > 1.6) shop(lay, k, s, a, c);
      else if (c - a > 0.55) poster(lay, s, plane, (a + c) / 2, lo + 1.55, 0, k.rnd);
    }
    entrance(lay, k, s);
  }
}

/**
 * One shop: a roller shutter between its guides, its bottom rail and lock,
 * the box it rolls into, and the signboard over that — and what the war did
 * to it: a few holes punched through, a slogan sprayed across it, posters,
 * or the black of a fire behind it.
 */
function shop(lay: Lay, k: Shell, s: Side, a: number, c: number): void {
  const { rnd } = k;
  const plane = k.d / 2;
  const back = hideBack(s);
  const u = (a + c) / 2;
  const sw = c - a - 0.3;
  const lo = PLINTH + 0.02;
  const hi = PLINTH + 2.35;
  const paint = rnd() < 0.6 ? ALLOY : ENAMEL;
  for (const e of [-1, 1]) lay.sb.onFace(s, plane, u + e * (sw / 2 + 0.05), (lo + hi) / 2, 0.08, hi - lo, 0.07, 0.035, IRON, 0, 0, back);
  lay.sb.onFace(s, plane, u, (lo + hi) / 2, sw, hi - lo, 0.03, 0.015, paint, 0, 0, back);
  for (let y = lo + 0.2; y < hi - 0.05; y += 0.18) lay.sb.onFace(s, plane, u, y, sw, 0.025, 0.02, 0.035, paint, 0, 0, back | 3);
  lay.sb.onFace(s, plane, u, lo + 0.05, sw, 0.1, 0.05, 0.035, IRON, 0, 0, back);
  lay.sb.onFace(s, plane, u + 0.3, lo + 0.13, 0.08, 0.1, 0.05, 0.075, IRON, 0, 0, back);
  lay.sb.onFace(s, plane, u - 0.3, lo + 0.13, 0.08, 0.1, 0.05, 0.075, IRON, 0, 0, back);
  lay.sb.onFace(s, plane, u, hi + 0.14, sw + 0.2, 0.28, 0.22, 0.11, paint, 0, 0, back);
  // The signboard, over the box and up across the slab's edge.
  const by = PLINTH + 3.0;
  const bh = 0.62;
  const front = 0.07;
  if (rnd() < 0.8) {
    const board = [AWNING, ENAMEL, WHITEWASH, PALM_BEAM][Math.floor(rnd() * 4)];
    const ink = board === WHITEWASH ? AWNING : WHITEWASH;
    lay.sb.onFace(s, plane, u, by + bh / 2, c - a - 0.1, bh, 0.06, 0.03, board, 0, 0, back);
    lay.sb.onFace(s, plane, u, by + 0.03, c - a - 0.06, 0.06, 0.07, 0.035, IRON, 0, 0, back);
    const tl = Math.min(c - a - 0.6, 2.8);
    kufic(
      (uu, yy, along, tall) => lay.sb.onFace(s, plane, uu, yy, along, tall, 0.015, front, ink, 0, 0, onlyFront(s)),
      u - tl / 2,
      u + tl / 2,
      by + 0.08,
      bh - 0.16,
      rnd,
    );
  }
  // Holes punched through by splinters, standing just proud of the slats.
  const holes = Math.floor(rnd() * 4);
  for (let i = 0; i < holes; i++) {
    const hu = u + (rnd() - 0.5) * (sw - 0.4);
    const hy = lo + 0.4 + rnd() * 1.4;
    const r = 0.04 + rnd() * 0.09;
    blob(lay, s, plane, [hu, hy], ragged(hu, hy, r, r * 0.8, 8, rnd), 0.045, 0.052, WINDOW_VOID);
  }
  const t = rnd();
  if (t < 0.25) {
    // A slogan sprayed across it.
    const sl = Math.min(sw - 0.3, 2.2);
    const sy = lo + 0.9 + rnd() * 0.4;
    kufic(
      (uu, yy, along, tall) => lay.sb.onFace(s, plane, uu, yy, along, tall, 0.006, 0.049, SCORCH, 0, 0, onlyFront(s)),
      u - sl / 2,
      u + sl / 2,
      sy,
      0.38,
      rnd,
    );
  } else if (t < 0.5) {
    poster(lay, s, plane, u - 0.35 + rnd() * 0.2, lo + 1.5, 0.047, rnd);
    poster(lay, s, plane, u + 0.3 + rnd() * 0.2, lo + 1.45, 0.047, rnd);
  } else if (t < 0.65) {
    // Gutted by fire: the black licking up the shutter's head and the board.
    const fu = u + (rnd() - 0.5) * (sw * 0.4);
    blob(lay, s, plane, [fu, hi - 0.35], ragged(fu, hi - 0.35, sw * 0.3, 0.5, 14, rnd), 0.046, 0.05, SCORCH);
    blob(lay, s, plane, [fu, by + 0.25], ragged(fu, by + 0.25, sw * 0.22, 0.3, 12, rnd), front + 0.005, front + 0.009, SCORCH);
  }
}

/**
 * The stair's doorway: a cast surround and a hood over it, the steel door
 * thrown back against the wall inside, the number plate and the meter beside
 * it, a conduit up to the slab, and the dead pasted round it.
 */
function entrance(lay: Lay, k: Shell, s: Side): void {
  const { d, rnd } = k;
  const plane = d / 2;
  const back = hideBack(s);
  const hw = DOOR_W / 2;
  const top = PLINTH + DOOR_H;
  for (const e of [-1, 1]) lay.sb.onFace(s, plane, e * (hw + 0.13), (PLINTH + top + 0.26) / 2, 0.26, top + 0.26 - PLINTH, 0.1, 0.05, k.frame, 0, 0, back);
  lay.sb.onFace(s, plane, 0, top + 0.13, DOOR_W + 0.52, 0.26, 0.1, 0.05, k.frame, 0, 0, back);
  lay.sb.onFace(s, plane, 0, top + 0.42, DOOR_W + 1.3, 0.12, 0.85, 0.425, k.frame, 0, 0, back);
  // The leaf, open flat against the inside face.
  const inner = opp(s);
  const ib = hideBack(inner);
  const lu = (rnd() < 0.5 ? -1 : 1) * (hw + 0.5);
  lay.sb.onFace(inner, d / 2 - T, lu, PLINTH + 1.15, 0.92, 2.25, 0.05, 0.025, IRON, 0, 0, ib);
  for (const py of [0.6, 1.62]) lay.sb.onFace(inner, d / 2 - T, lu, PLINTH + py, 0.68, 0.78, 0.02, 0.06, IRON, 0, 0, ib);
  // The number plate, the meter and its conduit.
  const side = rnd() < 0.5 ? -1 : 1;
  lay.sb.onFace(s, plane, side * (hw + 0.5), PLINTH + 2.05, 0.3, 0.2, 0.02, 0.06, ENAMEL, 0, 0, back);
  for (const du of [-0.05, 0.05]) lay.sb.onFace(s, plane, side * (hw + 0.5) + du, PLINTH + 2.05, 0.03, 0.12, 0.01, 0.075, WHITEWASH, 0, 0, back);
  const mu = -side * (hw + 0.55);
  lay.sb.onFace(s, plane, mu, PLINTH + 1.6, 0.34, 0.46, 0.16, 0.08, ALLOY, 0, 0, back);
  lay.sb.onFace(s, plane, mu + 0.08, (PLINTH + 1.83 + PLINTH + STOREY_RC + SLAB) / 2, 0.05, STOREY_RC + SLAB - 1.83, 0.05, 0.025, IRON, 0, 0, back);
  // The dead, pasted up beside the door in a row.
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    poster(lay, s, plane, side * (hw + 0.52) + (rnd() - 0.5) * 0.06, PLINTH + 1.25 - i * 0.66 + (i ? 0 : 0.05), 0.1, rnd);
    if (PLINTH + 1.25 - (i + 1) * 0.66 < PLINTH + 0.4) break;
  }
}

/** The two ends of the ground floor: corner pilasters, a slogan, a downpipe, and the render shot off. */
function ends(lay: Lay, k: Shell): void {
  const { w, d, rnd } = k;
  const lo = PLINTH;
  const hi = PLINTH + STOREY_RC;
  for (const s of ["-x", "+x"] as const) {
    const plane = w / 2;
    const back = hideBack(s);
    for (const e of [-1, 1]) lay.sb.onFace(s, plane, e * (d / 2 - 0.25), (lo + hi) / 2, 0.5, hi - lo, 0.08, 0.04, k.frame, 0, 0, back);
    scar(lay, k, s, plane, (rnd() - 0.5) * (d - 5), lo + 1.3 + rnd() * 1.0);
    pocks(lay, s, plane, -d / 2 + 0.6, d / 2 - 0.6, lo + 0.3, hi - 0.2, 6, rnd);
    if (rnd() < 0.5) {
      const sl = 3 + rnd() * 3;
      const su = (rnd() - 0.5) * (d - sl - 2);
      kufic(
        (uu, yy, along, tall) => lay.sb.onFace(s, plane, uu, yy, along, tall, 0.006, 0.003, rnd() < 0.85 ? SCORCH : AWNING, 0, 0, onlyFront(s)),
        su - sl / 2,
        su + sl / 2,
        lo + 1.0 + rnd() * 0.5,
        0.55,
        rnd,
      );
    }
  }
}

// --- the floors above the street -----------------------------------------------------

/** Every storey's openings, on the two fronts and the -X end, and the lane's sills at +X. */
function storeys(lay: Lay, b: Build, k: Shell): void {
  const { w, d, rnd } = k;
  for (let f = 1; f < k.floors; f++) {
    const y = k.ys[f];
    const shear = f === k.floors - 1;
    const spanW = shear ? k.topW : w;
    const spanX = shear ? k.topX : 0;
    const xs = rhythm(spanW, spanX);
    for (const s of LONG) {
      for (let i = 0; i + 1 < xs.length; i++) opening(lay, b, k, s, f, xs[i] + 0.22, xs[i + 1] - 0.22, true);
      const a = spanX - spanW / 2;
      const c = spanX + spanW / 2;
      pocks(lay, s, d / 2, a + 0.3, c - 0.3, y + 0.1, y + SPANDREL - 0.1, 3, rnd);
      pocks(lay, s, d / 2, a + 0.3, c - 0.3, y + STOREY_RC - LINTEL + 0.05, y + STOREY_RC + SLAB - 0.05, 2, rnd);
    }
    const zo = d / 2 - 0.475;
    opening(lay, b, k, "-x", f, -zo, zo, false);
    pocks(lay, "-x", w / 2, -zo, zo, y + 0.1, y + SPANDREL - 0.1, 5, rnd);
    if (!shear) {
      const plane = (w - T) / 2;
      lay.sb.onFace("+x", plane, 0, y + SPANDREL + 0.03, 2 * zo + 0.1, 0.06, T + 0.08, 0.025, k.frame);
    }
  }
  downpipes(lay, k);
}

/**
 * One opening between two columns, `u0` to `u1` along side `s`, on storey
 * `f`: its cast sill, whatever is left in it, and — on a front — what hangs
 * off the spandrel under it or has burnt over it.
 */
function opening(lay: Lay, b: Build, k: Shell, s: Side, f: number, u0: number, u1: number, front: boolean): void {
  const { rnd } = k;
  const along = runsAlongX(s);
  const face = (along ? k.d : k.w) / 2;
  const centre = face - T / 2;
  const y = k.ys[f];
  const sill = y + SPANDREL;
  const head = y + STOREY_RC - LINTEL;
  const L = u1 - u0;
  const u = (u0 + u1) / 2;
  lay.sb.onFace(s, centre, u, sill + 0.03, L + 0.1, 0.06, T + 0.08, 0.025, k.frame);
  const burnt = front && rnd() < 0.16;
  const r = rnd();
  const state: Win = burnt ? (r < 0.6 ? "gone" : "torn") : r < 0.42 ? "gone" : r < 0.72 ? "framed" : r < 0.85 ? "torn" : f === 1 ? "barred" : "gone";
  windowIn(lay, k, s, centre, u0, u1, sill + 0.06, head, state);
  if (!front) return;
  const sz = outward(s);
  if (rnd() < 0.16 && L > 1.6) acUnit(lay, k, s, face, u0 + 0.6 + rnd() * (L - 1.2), y);
  if (burnt) tongue(lay, s, face, u0, u1, head, rnd);
  else if (rnd() < 0.1) {
    // A course of sandbags along the sill: somebody's position.
    let uu = u0 + 0.1 + rnd() * 0.3;
    while (uu < u1 - 0.55) {
      lay.sb.onFace(s, centre, uu + 0.27, sill + 0.13, 0.52, 0.14, 0.3, 0, SANDBAG, 0, (rnd() - 0.5) * 0.2, HIDE_DOWN);
      uu += 0.5 + rnd() * 0.08;
    }
  }
  const t = rnd();
  if (t < 0.12) shellHole(lay, k, s, face, u0 + 0.5 + rnd() * (L - 1.0), y + 0.47);
  else if (t < 0.24 && !burnt) {
    const dw = 1.1 + rnd() * 0.6;
    const dx = u0 + dw / 2 + 0.2 + rnd() * Math.max(0, L - dw - 0.4);
    drape(b, dw, 0.85, dx, sill + 0.06, sz * face, sz as 1 | -1, clothHash(dx, y, sz, 3));
  }
}

type Win = "gone" | "framed" | "torn" | "barred";

/**
 * What is left in an opening from `lo` (the sill's top) to `hi` (the lintel's
 * soffit), in the wall's middle plane `centre` out along side `s`: nothing,
 * an aluminium frame under its roller box (the shutter sometimes run down,
 * never below the eye), a frame torn half out, or burglar bars.
 */
function windowIn(lay: Lay, k: Shell, s: Side, centre: number, u0: number, u1: number, lo: number, hi: number, state: Win): void {
  if (state === "gone") return;
  const { rnd } = k;
  const L = u1 - u0;
  const u = (u0 + u1) / 2;
  const F = 0.06;
  const D = 0.07;
  if (state === "barred") {
    const n = Math.max(3, Math.round(L / 0.15));
    const out = T / 2 - 0.05;
    for (let i = 1; i < n; i++) lay.sb.onFace(s, centre, u0 + (i * L) / n, (lo + hi) / 2, 0.022, hi - lo, 0.022, out, IRON, 0, 0, HIDE_UP | HIDE_DOWN);
    for (const yy of [lo + 0.15, (lo + hi) / 2, hi - 0.15]) lay.sb.onFace(s, centre, u, yy, L, 0.035, 0.012, out, IRON);
    return;
  }
  lay.sb.onFace(s, centre, u, hi - 0.11, L, 0.22, 0.24, -0.03, ALLOY);
  const top = hi - 0.22;
  if (state === "framed") {
    for (const e of [-1, 1]) lay.sb.onFace(s, centre, u + e * (L / 2 - F / 2), (lo + top) / 2, F, top - lo, D, 0, ALLOY);
    lay.sb.onFace(s, centre, u, top - F / 2, L, F, D, 0, ALLOY);
    lay.sb.onFace(s, centre, u, lo + F / 2, L, F, D, 0, ALLOY);
    const panes = Math.max(1, Math.round(L / 1.25));
    for (let i = 1; i < panes; i++) lay.sb.onFace(s, centre, u0 + (i * L) / panes, (lo + top) / 2, F * 0.8, top - lo, D, 0, ALLOY);
    lay.sb.onFace(s, centre, u, top - 0.45, L, F * 0.8, D, 0, ALLOY);
    if (rnd() < 0.3) {
      // The shutter run part of the way down, and stuck there: it stops
      // above any eye at the window.
      const drop = 0.15 + rnd() * 0.36;
      const tilt = (rnd() - 0.5) * 0.06;
      lay.sb.onFace(s, centre, u, top - drop / 2, L - 0.04, drop, 0.025, -0.06, ALLOY, tilt);
      lay.sb.onFace(s, centre, u, top - drop + 0.02, L - 0.04, 0.04, 0.04, -0.06, IRON, tilt);
    }
    return;
  }
  // Torn half out: the sill rail, one jamb, the head hanging off one end and
  // a mullion swinging from it.
  lay.sb.onFace(s, centre, u, lo + F / 2, L, F, D, 0, ALLOY);
  const e = rnd() < 0.5 ? -1 : 1;
  lay.sb.onFace(s, centre, u + e * (L / 2 - F / 2), (lo + top) / 2, F, top - lo, D, 0, ALLOY);
  const a = 0.2 + rnd() * 0.35;
  const l = L * (0.45 + rnd() * 0.3);
  const end = u + e * (L / 2 - F);
  lay.sb.onFace(s, centre, end - e * (l / 2) * Math.cos(a), top - F / 2 - (l / 2) * Math.sin(a), l, F, D, 0, ALLOY, e * a);
  const mu = u - e * (L * 0.1);
  const ma = (rnd() - 0.5) * 0.7;
  const mh = (top - lo) * (0.5 + rnd() * 0.3);
  lay.sb.onFace(s, centre, mu + (mh / 2) * Math.sin(ma), top - (mh / 2) * Math.cos(ma), F * 0.8, mh, D, 0, ALLOY, ma);
}

/** An air conditioner on two brackets under a window, its fan's shroud, and the stain it drips. */
function acUnit(lay: Lay, k: Shell, s: Side, face: number, u: number, y: number): void {
  const back = hideBack(s);
  const cy = y + 0.5;
  lay.sb.onFace(s, face, u, cy, 0.8, 0.5, 0.3, 0.15, WHITEWASH, 0, 0, back);
  eye(lay.m(IRON), fp(s, face, u + 0.13, cy, 0.3), fdir(s, 0, 0, 1), 0.18, 0.18, 0.015, 6, true, false);
  for (let i = 0; i < 4; i++) lay.sb.onFace(s, face, u - 0.27, cy - 0.15 + i * 0.1, 0.16, 0.025, 0.01, 0.305, IRON, 0, 0, back);
  for (const e of [-1, 1]) lay.sb.onFace(s, face, u + e * 0.3, cy - 0.27, 0.04, 0.04, 0.34, 0.17, IRON, 0, 0, back);
  const lo = y - 0.35 - k.rnd() * 0.3;
  blob(lay, s, face, [u, (cy - 0.25 + lo) / 2], [
    [u - 0.07, cy - 0.25],
    [u + 0.09, cy - 0.25],
    [u + 0.12, lo + 0.12],
    [u + 0.03, lo],
    [u - 0.08, lo + 0.08],
  ], 0, 0.004, DARK_CONCRETE);
}

/** The black a fire leaves climbing a face from an opening's head. */
function tongue(lay: Lay, s: Side, face: number, u0: number, u1: number, head: number, rnd: () => number): void {
  const L = u1 - u0;
  const u = (u0 + u1) / 2;
  const H = 0.9 + rnd() * 0.6;
  const a = L * 0.42;
  const cy = head + H * 0.4;
  const p1 = rnd() * TAU;
  const p2 = rnd() * TAU;
  const N = 16;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU;
    const up = Math.sin(t);
    const kk = 1 + 0.1 * Math.sin(2 * t + p1) + (up > 0 ? 0.35 * up * Math.max(0, Math.sin(4 * t + p2)) : 0);
    const pu = u + Math.cos(t) * a * kk * (up > 0 ? 1 - 0.4 * up : 1);
    const py = Math.max(head - 0.03, cy + up * (up > 0 ? H * 0.6 : H * 0.4) * kk);
    pts.push([pu, py]);
  }
  blob(lay, s, face, [u, cy], pts, 0, 0.006, SCORCH);
}

/**
 * A shell's hole in the infill: a ragged ground of mortar where the render
 * went, the blocks broken round the hole's lip standing in it, and the hole.
 * Cheaper than `spall`, which a wall gets once; a front can take several.
 */
function shellHole(lay: Lay, k: Shell, s: Side, face: number, u: number, y: number): void {
  const { rnd } = k;
  const back = hideBack(s);
  const a = 0.36 + rnd() * 0.12;
  const bb = 0.24 + rnd() * 0.06;
  blob(lay, s, face, [u, y], ragged(u, y, a, bb, 12, rnd), 0, 0.006, DARK_CONCRETE);
  // The blocks round the hole, broken off at its lip.
  for (let i = 0; i < 9; i++) {
    const t = (i / 9) * TAU + rnd() * 0.3;
    const r = 0.55 + rnd() * 0.25;
    lay.sb.onFace(s, face, u + Math.cos(t) * a * r, y + Math.sin(t) * bb * r, 0.12 + rnd() * 0.16, 0.16, 0.03, 0.015, CONCRETE, (rnd() - 0.5) * 0.5, 0, back);
  }
  // A lip of render round the outside, which makes it a hole in the face.
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * TAU;
    lay.sb.onFace(s, face, u + Math.cos(t) * a * 1.02, y + Math.sin(t) * bb * 1.02, 0.2, 0.045, 0.035, 0.0175, k.skin, t + Math.PI / 2, 0, back);
  }
  blob(lay, s, face, [u, y], ragged(u, y, 0.19, 0.14, 10, rnd), 0, 0.04, WINDOW_VOID);
}

/**
 * Render shot off a wall back to its blockwork: a ragged mortar ground, a
 * few courses of block across it and a lip of render round it. `spall`'s
 * drawing (in `./lay`) at a quarter of its cost, which a block with a dozen
 * faces to scar cannot afford at full price.
 */
function scar(lay: Lay, k: Shell, s: Side, face: number, u: number, y: number): void {
  const { rnd } = k;
  const back = hideBack(s);
  const a = 0.5 + rnd() * 0.3;
  const bb = 0.35 + rnd() * 0.15;
  blob(lay, s, face, [u, y], ragged(u, y, a, bb, 14, rnd), 0, 0.006, BLOCK.ground);
  for (let yc = y - bb * 0.55; yc < y + bb * 0.6; yc += BLOCK.course) {
    const half = a * Math.sqrt(Math.max(0, 1 - ((yc - y) / bb) ** 2)) * 0.7;
    for (let uu = u - half + (Math.round((yc - y) / BLOCK.course) % 2 ? BLOCK.half : 0); uu + 0.1 < u + half; uu += BLOCK.pitch) {
      const l = Math.min(BLOCK.len, u + half - uu);
      lay.sb.onFace(s, face, uu + l / 2, yc, l, BLOCK.course - 0.022, 0.02, 0.014, BLOCK.color, 0, 0, back);
    }
  }
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * TAU;
    lay.sb.onFace(s, face, u + Math.cos(t) * a * 0.98, y + Math.sin(t) * bb * 0.98, 0.3, 0.045, 0.035, 0.0175, k.skin, t + Math.PI / 2, 0, back);
  }
}

/** A downpipe down each front from the roof to the plinth, on the -X corner's column. */
function downpipes(lay: Lay, k: Shell): void {
  const top = k.roofY + 0.1;
  for (const s of LONG) {
    const back = hideBack(s);
    const u = -k.w / 2 + 0.12;
    lay.sb.onFace(s, k.d / 2, u, (PLINTH + top) / 2, 0.1, top - PLINTH, 0.1, 0.13, ALLOY, 0, 0, back);
    for (let y = PLINTH + 1.5; y < top - 0.5; y += 1.85) lay.sb.onFace(s, k.d / 2, u, y, 0.14, 0.05, 0.14, 0.1, IRON, 0, 0, back);
    lay.sb.onFace(s, k.d / 2, u + 0.06, PLINTH + 0.12, 0.22, 0.1, 0.12, 0.14, ALLOY, 0, 0, back);
  }
}

// --- inside -------------------------------------------------------------------------

/**
 * Every floor's rooms: the footings of the partitions the blasts took, laid
 * to the floor's plan, and in each room its floor and what was left in it.
 * Nothing here stands higher than a step — a partition stub is no collider,
 * so it is drawn low enough that walking through it reads as stepping over.
 */
function rooms(lay: Lay, k: Shell): void {
  const xa = -k.w / 2 + T;
  const xb = k.edge;
  const zh = k.d / 2 - T;
  for (let f = 0; f < k.floors; f++) {
    const y = k.ys[f];
    const { spine, cross } = k.plans[f];
    const open = f === k.floors - 1;
    const bx = [xa, ...cross, xb];
    for (let i = 0; i + 1 < bx.length; i++) {
      for (const [z0, z1] of [
        [-zh, spine],
        [spine, zh],
      ]) {
        room(lay, k, f, bx[i], bx[i + 1], z0, z1, open && bx[i] > k.xe - 1);
      }
    }
    // The spine, with a door into every room on either side of it.
    const doors: number[] = [];
    for (let i = 0; i + 1 < bx.length; i++) doors.push(bx[i] + 0.7 + k.rnd() * (bx[i + 1] - bx[i] - 1.4));
    partition(lay, k, y, xa, xb, spine, true, doors);
    for (const x of cross) {
      partition(lay, k, y, -zh, zh, x, false, [(spine - zh) / 2 + (k.rnd() - 0.5), (spine + zh) / 2 + (k.rnd() - 0.5)]);
    }
  }
}

/**
 * A partition's footing from `a` to `c` along a line at `at`: bare block,
 * broken at a step's height. Grey whatever the outside is rendered: a
 * footing in the render's cream read, from across a floor, as paint.
 */
function partition(lay: Lay, k: Shell, y: number, a: number, c: number, at: number, alongX: boolean, doors: number[]): void {
  const { rnd } = k;
  const cuts: [number, number][] = doors.map((u) => [u - 0.45, u + 0.45]);
  if (rnd() < 0.5) {
    const g = a + 1 + rnd() * (c - a - 2);
    cuts.push([g - 0.6 - rnd() * 0.8, g + 0.6]);
  }
  for (const [p, q] of carve(a, c, cuts)) {
    let u = p;
    while (u < q - 0.05) {
      const l = Math.min(q - u, 0.8 + rnd() * 1.2);
      const h = 0.05 + rnd() * 0.23;
      if (alongX) lay.sb.box(l, h, 0.12, u + l / 2, y + h / 2, at, CONCRETE, undefined, HIDE_DOWN);
      else lay.sb.box(0.12, h, l, at, y + h / 2, u + l / 2, CONCRETE, undefined, HIDE_DOWN);
      u += l;
    }
  }
}

/**
 * One room on storey `f`: its floor, its rubble and the one thing left in
 * it. Above the street the room lays the WHOLE of its floor, to its walls'
 * lines — tiles, or the bare screed at the slab's height — because the slab
 * under it is drawn without a top; on the street the plinth is the floor,
 * and a tiled room lays its field on it.
 */
function room(lay: Lay, k: Shell, f: number, x0: number, x1: number, z0: number, z1: number, open: boolean): void {
  const { rnd } = k;
  const y = k.ys[f];
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const tiled = rnd() < 0.4;
  const lift = tiled ? 0.016 : 0;
  if (tiled) tiles(lay, x0, x1, z0, z1, y);
  else if (f > 0) lay.sb.box(x1 - x0, 0.01, z1 - z0, cx, y - 0.005, cz, CONCRETE, undefined, ONLY_UP);
  const n = (open ? 5 : 1) + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const c = rnd() < 0.5 ? k.skin : rnd() < 0.5 ? CONCRETE : DARK_CONCRETE;
    chunk(lay, x0 + 0.3 + rnd() * (x1 - x0 - 0.6), y + lift, z0 + 0.3 + rnd() * (z1 - z0 - 0.6), 0.12 + rnd() * 0.25, c, rnd);
  }
  const px = cx + (rnd() - 0.5) * Math.max(0, x1 - x0 - 2.4);
  const pz = cz + (rnd() - 0.5) * Math.max(0, z1 - z0 - 2.4);
  const yaw = rnd() * TAU;
  const t = rnd();
  if (t < 0.18) {
    lay.sb.box(1.9, 0.14, 0.9, px, y + lift + 0.07, pz, SANDBAG, { y: yaw }, HIDE_DOWN);
    lay.sb.box(0.55, 0.1, 0.35, px + Math.sin(yaw) * 0.6, y + lift + 0.19, pz + Math.cos(yaw) * 0.6, WHITEWASH, { y: yaw + 1.57 }, HIDE_DOWN);
  } else if (t < 0.32) {
    lay.sb.box(1.7, 0.012, 1.15, px, y + lift + 0.012, pz, AWNING, { y: yaw }, HIDE_DOWN);
  } else if (t < 0.44) {
    // A door off its hinges.
    lay.sb.box(0.85, 0.045, 2.0, px, y + lift + 0.08, pz, PALM_BEAM, { y: yaw, z: 0.06 });
  } else if (t < 0.52) {
    // A gas bottle on its side.
    const a: V3 = [px, y + lift + 0.15, pz];
    const c: V3 = [px + Math.sin(yaw) * 0.55, y + lift + 0.15, pz + Math.cos(yaw) * 0.55];
    log(lay.m(ENAMEL), a, c, 0.15, 8);
    lay.sb.box(0.08, 0.08, 0.08, c[0] + Math.sin(yaw) * 0.04, c[1], c[2] + Math.cos(yaw) * 0.04, IRON);
  } else if (t < 0.62) {
    // Clothes, emptied out.
    for (let i = 0; i < 5; i++) {
      const cc = [SANDBAG, AWNING, ENAMEL, WHITEWASH][i % 4];
      lay.sb.box(0.35 + rnd() * 0.25, 0.04, 0.25 + rnd() * 0.2, px + (rnd() - 0.5) * 0.9, y + lift + 0.02 + i * 0.012, pz + (rnd() - 0.5) * 0.9, cc, { y: rnd() * TAU }, HIDE_DOWN);
    }
  } else if (t < 0.7) {
    // A chair, broken over.
    lay.sb.box(0.42, 0.035, 0.42, px, y + lift + 0.14, pz, PALM_BEAM, { y: yaw, x: 0.35 });
    for (let i = 0; i < 2; i++) lay.sb.box(0.035, 0.035, 0.42, px + (i - 0.5) * 0.5, y + lift + 0.02, pz + 0.3, PALM_BEAM, { y: yaw + i });
  }
  if (open) {
    // The shear's floor: scorched, and a piece of the slab above lying on it.
    lobe(lay.m(SCORCH), cx + (rnd() - 0.5), y + lift + 0.012, cz + (rnd() - 0.5), (x1 - x0) * 0.32, (z1 - z0) * 0.32, rnd() * TAU, true, rnd);
    const sl = 1.2 + rnd() * 0.8;
    const sd = 0.8 + rnd() * 0.6;
    const sy = rnd() * TAU;
    lay.sb.box(sl, 0.18, sd, px, y + lift + 0.16, pz, CONCRETE, { y: sy, z: 0.1 });
    for (let i = 0; i < 4; i++) {
      const o = (i / 3 - 0.5) * sd * 0.8;
      const ax = px + Math.cos(sy) * (sl / 2) + Math.sin(sy) * o;
      const az = pz - Math.sin(sy) * (sl / 2) + Math.cos(sy) * o;
      rod(lay, [ax, y + lift + 0.24, az], [ax + Math.cos(sy) * (0.3 + rnd() * 0.4), y + lift + 0.1 + rnd() * 0.25, az - Math.sin(sy) * (0.3 + rnd() * 0.4)], 0.016);
    }
  }
}

/**
 * Terrazzo laid over a room: a field of tiles and its grout standing a hair
 * proud. Warm and middling rather than pale, because an up-facing face comes
 * back lighter than its swatch, and a pale field in the sun on an open floor
 * read from the air as a hole in the slab.
 */
function tiles(lay: Lay, x0: number, x1: number, z0: number, z1: number, y: number): void {
  const T0 = 0.6;
  lay.sb.box(x1 - x0, 0.012, z1 - z0, (x0 + x1) / 2, y + 0.006, (z0 + z1) / 2, ROOF_MUD, undefined, HIDE_DOWN);
  for (let x = x0 + T0; x < x1 - 0.1; x += T0) lay.sb.box(0.016, 0.004, z1 - z0, x, y + 0.014, (z0 + z1) / 2, DARK_CONCRETE, undefined, ONLY_UP);
  for (let z = z0 + T0; z < z1 - 0.1; z += T0) lay.sb.box(x1 - x0, 0.004, 0.016, (x0 + x1) / 2, y + 0.014, z, DARK_CONCRETE, undefined, ONLY_UP);
}

/**
 * Under every slab: a downstand beam on every column line across the depth,
 * and in the rooms under it a fan or a bulb on its flex, and here and there
 * the soffit spalled to its bars. All of it over every head.
 */
function ceilings(lay: Lay, k: Shell): void {
  const { rnd } = k;
  const zh = k.plateD / 2;
  for (let f = 1; f <= k.floors; f++) {
    const soffit = k.ys[f] - SLAB;
    const top = f === k.floors;
    const reach = top ? k.xe : k.edge;
    for (const x of k.grid) {
      if (x <= -k.w / 2 + 0.5 || x >= k.edge - 0.3) continue;
      if (x < reach - 0.3) lay.sb.box(0.3, 0.3, k.plateD, x, soffit - 0.15, 0, k.frame, undefined, HIDE_UP);
      else if (top) lay.sb.box(0.3, 0.3, k.spurZ + zh, x, soffit - 0.15, (k.spurZ - zh) / 2, k.frame, undefined, HIDE_UP);
    }
    const { spine, cross } = k.plans[f - 1];
    const bx = [-k.w / 2 + T, ...cross, k.edge];
    for (let i = 0; i + 1 < bx.length; i++) {
      const cx = (bx[i] + bx[i + 1]) / 2;
      if (top && cx > k.xe - 0.6) continue;
      for (const cz of [(spine - zh) / 2, (spine + zh) / 2]) {
        const r = rnd();
        if (r < 0.18) fan(lay, cx, soffit, cz, rnd);
        else if (r < 0.75) {
          const drop = 0.3 + rnd() * 0.25;
          lay.sb.box(0.012, drop, 0.012, cx, soffit - drop / 2, cz, IRON);
          lay.sb.box(0.07, 0.1, 0.07, cx, soffit - drop - 0.05, cz, WHITEWASH);
        }
      }
    }
    if (rnd() < 0.5) {
      const x = -k.w / 2 + 2 + rnd() * (reach - (-k.w / 2) - 4);
      const z = (rnd() - 0.5) * (k.plateD - 3);
      lobe(lay.m(DARK_CONCRETE), x, soffit - 0.006, z, 0.7, 0.45, rnd() * TAU, false, rnd);
      for (let i = 0; i < 4; i++) lay.sb.box(1.1, 0.014, 0.014, x, soffit - 0.02, z - 0.27 + i * 0.18, IRON);
      for (let i = 0; i < 5; i++) lay.sb.box(0.014, 0.014, 0.7, x - 0.4 + i * 0.2, soffit - 0.034, z, IRON);
    }
  }
}

/** A ceiling fan: rod, hub and three blades, at a head's height plus a hand. */
function fan(lay: Lay, x: number, soffit: number, z: number, rnd: () => number): void {
  lay.sb.box(0.025, 0.35, 0.025, x, soffit - 0.175, z, IRON);
  lay.sb.box(0.16, 0.12, 0.16, x, soffit - 0.41, z, ALLOY, { y: rnd() * TAU });
  const a0 = rnd() * TAU;
  for (let i = 0; i < 3; i++) {
    const a = a0 + (i * TAU) / 3;
    lay.sb.box(0.52, 0.012, 0.12, x + Math.cos(a) * 0.34, soffit - 0.44, z - Math.sin(a) * 0.34, WHITEWASH, { y: a, z: i === 1 ? -0.18 : 0 });
  }
}

// --- the shear -----------------------------------------------------------------------

/**
 * Where the corner went: the roof's broken edges with their bars out of
 * them, some hanging, the top storey's walls toothed where they stop, the
 * stubs of the columns it took and their bars, and the low stubs of the
 * spandrels along the floor's open edge.
 */
function shear(lay: Lay, k: Shell): void {
  const { w, d, rnd, xe, edge, spurZ, roofY } = k;
  const zh = k.plateD / 2;
  broken(lay, k, [xe, spurZ], [xe, zh], [1, 0]);
  broken(lay, k, [xe, spurZ], [edge, spurZ], [0, 1]);
  // The top storey's fronts, toothed where they stop, and the beam's bars.
  const y = k.ys[k.floors - 1];
  for (const s of LONG) {
    const zc = outward(s) * (d - T) / 2;
    for (let yy = y + 0.1; yy < y + SPANDREL - 0.05; yy += 0.2) {
      if (rnd() < 0.7) lay.sb.box(0.12 + rnd() * 0.2, 0.18, T * 0.85, xe + 0.08, yy, zc, k.skin);
    }
    for (let i = 0; i < 4; i++) {
      const by = y + STOREY_RC - LINTEL + 0.08 + (i >> 1) * 0.26;
      const bz = zc + ((i & 1) - 0.5) * 0.26;
      const l = 0.25 + rnd() * 0.5;
      rod(lay, [xe - 0.05, by, bz], [xe + l, by - rnd() * 0.3, bz + (rnd() - 0.5) * 0.15], 0.016);
    }
    // The columns it took, as stubs with their bars, and what is left of the
    // spandrels between them, never higher than a step.
    const lost = k.grid.filter((x) => x > xe + 0.5);
    for (const x of lost) {
      lay.sb.box(0.44, 0.26, 0.5, x, y + 0.13, zc, k.frame, undefined, HIDE_DOWN);
      for (let i = 0; i < 4; i++) {
        const bx = x + ((i & 1) - 0.5) * 0.28;
        const bz = zc + ((i >> 1) - 0.5) * 0.3;
        const l = 0.5 + rnd() * 0.8;
        rod(lay, [bx, y + 0.2, bz], [bx + (rnd() - 0.5) * 0.4, y + 0.26 + l, bz + outward(s) * rnd() * 0.3], 0.018);
      }
    }
    const cuts: [number, number][] = lost.map((x) => [x - 0.3, x + 0.3]);
    for (const [a, c] of carve(xe + 0.3, w / 2, cuts)) {
      let u = a;
      while (u < c - 0.1) {
        const l = Math.min(c - u, 0.4 + rnd() * 0.9);
        const h = 0.04 + rnd() * 0.24;
        if (rnd() < 0.8) lay.sb.box(l, h, T * 0.9, u + l / 2, y + h / 2, zc, k.skin, undefined, HIDE_DOWN);
        u += l;
      }
    }
  }
  // The top flight's landing, where it lands at the end the spur does not
  // reach: what is left of the slab it was, torn off along its inner edge.
  if (k.topDir === 1) broken(lay, k, [edge, k.d / 2 - T], [edge, k.d / 2 - T - LANDING], [-1, 0]);
  // Bars hanging off the spur's soffit over the open floor.
  for (let i = 0; i < 6; i++) {
    const x = xe + 0.4 + rnd() * (edge - xe - 0.8);
    const z = spurZ - 0.1 - rnd() * 0.4;
    rod(lay, [x, roofY - SLAB + 0.02, z], [x + (rnd() - 0.5) * 0.3, roofY - SLAB - 0.4 - rnd() * 0.5, z + rnd() * 0.3], 0.016);
  }
}

/**
 * A slab's broken edge from `a` to `c` (plan points), torn out toward `n`:
 * tongues of slab standing up to a third of a metre past the line, their
 * tops dropped and their soffits eaten back, and the bars out of the face
 * — some cut short, some bent down over the drop.
 */
function broken(lay: Lay, k: Shell, a: [number, number], c: [number, number], n: [number, number]): void {
  const { rnd, roofY } = k;
  const m = lay.m(CONCRETE);
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const N = Math.max(2, Math.round(len / 0.35));
  const yt = roofY;
  const yb = roofY - SLAB;
  const base: [number, number][] = [];
  const tip: { x: number; z: number; t: number; b: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const bx = a[0] + (c[0] - a[0]) * t;
    const bz = a[1] + (c[1] - a[1]) * t;
    const o = i === 0 || i === N ? 0.02 : 0.04 + rnd() * 0.3;
    base.push([bx, bz]);
    tip.push({ x: bx + n[0] * o, z: bz + n[1] * o, t: yt - rnd() * 0.12, b: yb + 0.05 + rnd() * 0.22 });
  }
  const up: V3 = [0, 1, 0];
  const down: V3 = [0, -1, 0];
  const out: V3 = [n[0], 0, n[1]];
  for (let i = 0; i < N; i++) {
    const b0 = base[i];
    const b1 = base[i + 1];
    const p = tip[i];
    const q = tip[i + 1];
    m.tri([b0[0], yt, b0[1]], [b1[0], yt, b1[1]], [q.x, q.t, q.z], up);
    m.tri([b0[0], yt, b0[1]], [q.x, q.t, q.z], [p.x, p.t, p.z], up);
    m.tri([b0[0], yb, b0[1]], [b1[0], yb, b1[1]], [q.x, q.b, q.z], down);
    m.tri([b0[0], yb, b0[1]], [q.x, q.b, q.z], [p.x, p.b, p.z], down);
    m.tri([p.x, p.b, p.z], [q.x, q.b, q.z], [q.x, q.t, q.z], out);
    m.tri([p.x, p.b, p.z], [q.x, q.t, q.z], [p.x, p.t, p.z], out);
    // The bars, top mat and bottom, out of the torn face.
    if (rnd() < 0.5) {
      const t = (i + rnd()) / N;
      const bx = a[0] + (c[0] - a[0]) * t;
      const bz = a[1] + (c[1] - a[1]) * t;
      const by = rnd() < 0.6 ? yt - 0.07 : yb + 0.07;
      const l = 0.35 + rnd() * 0.5;
      const ex = bx + n[0] * l + n[1] * (rnd() - 0.5) * 0.15;
      const ez = bz + n[1] * l + n[0] * (rnd() - 0.5) * 0.15;
      const ey = by - rnd() * 0.12;
      rod(lay, [bx, by, bz], [ex, ey, ez], 0.016);
      if (rnd() < 0.3) rod(lay, [ex, ey, ez], [ex + n[0] * 0.1, ey - 0.4 - rnd() * 0.8, ez + n[1] * 0.1], 0.016);
    }
  }
}

// --- the roof ------------------------------------------------------------------------

/**
 * The roof: copings on the parapets, the starter bars out of every column
 * for the storey that was never built, a patched membrane, a dish and an
 * aerial, washing over the front, and somebody's position by the parapet.
 */
function roof(lay: Lay, b: Build, k: Shell): void {
  const { d, rnd, roofY, topW, topX, plateD } = k;
  const head = roofY + PARAPET;
  for (const sz of [-1, 1] as const) {
    lay.sb.box(topW - 0.25, 0.07, PARAPET_T + 0.08, topX - 0.125, head + 0.035, (sz * (d - PARAPET_T)) / 2, k.frame);
  }
  const ex = topX - (topW - PARAPET_T) / 2;
  lay.sb.box(PARAPET_T + 0.08, 0.07, plateD + 0.1, ex, head + 0.035, 0, k.frame);
  // Starter bars, four to a column, and a cast stub on some.
  for (const x of rhythm(topW, topX)) {
    if (x > k.xe - 0.3) continue;
    for (const sz of [-1, 1] as const) {
      const zc = (sz * (d - PARAPET_T)) / 2;
      const stub = rnd() < 0.35;
      const by = head + 0.07 + (stub ? 0.22 : 0);
      if (stub) lay.sb.box(0.44, 0.22, 0.44, x + (x < topX - topW / 2 + 0.3 ? 0.22 : 0), head + 0.18, zc, k.frame, undefined, HIDE_DOWN);
      for (let i = 0; i < 4; i++) {
        const bx = x + (x < topX - topW / 2 + 0.3 ? 0.22 : 0) + ((i & 1) - 0.5) * 0.26;
        const bz = zc + ((i >> 1) - 0.5) * 0.24;
        const l = 0.45 + rnd() * 0.5;
        rod(lay, [bx, by - 0.05, bz], [bx + (rnd() - 0.5) * 0.12, by + l, bz + (rnd() - 0.5) * 0.12], 0.018);
      }
    }
  }
  // The membrane, patched with cut sheets of felt — straight-edged, which
  // is what says patch rather than puddle.
  const x0 = -k.w / 2 + 1;
  const x1 = k.xe - 1;
  for (let i = 0; i < 4; i++) {
    const px = x0 + rnd() * (x1 - x0);
    const pz = (rnd() - 0.5) * (plateD - 3);
    const yaw = (rnd() - 0.5) * 0.3;
    lay.sb.box(0.9 + rnd() * 1.4, 0.012, 0.7 + rnd() * 0.9, px, roofY + 0.006 + i * 0.003, pz, DARK_CONCRETE, { y: yaw }, HIDE_DOWN);
  }
  // What the shelling threw up here.
  for (let i = 0; i < 5; i++) {
    chunk(lay, x0 + rnd() * (x1 - x0), roofY, (rnd() - 0.5) * (plateD - 1.5), 0.12 + rnd() * 0.2, i % 2 ? k.skin : CONCRETE, rnd);
  }
  // The plinths the water tanks stood on, and the stubs of their pipes.
  const tanks = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < tanks; i++) {
    const tx = x0 + 0.8 + rnd() * (x1 - x0 - 1.6);
    const tz = (rnd() < 0.5 ? -1 : 1) * (plateD / 2 - 1.6);
    lay.sb.box(1.3, 0.22, 1.3, tx, roofY + 0.11, tz, k.frame, undefined, HIDE_DOWN);
    rod(lay, [tx + 0.5, roofY + 0.22, tz], [tx + 0.5, roofY + 0.5, tz], 0.04, ALLOY);
    rod(lay, [tx + 0.5, roofY + 0.48, tz], [tx + 0.5 + 0.35, roofY + 0.48, tz + 0.2], 0.04, ALLOY);
  }
  // A dish on the -X parapet's inside face, turned up at the sky.
  if (rnd() < 0.7) {
    const z = (rnd() - 0.5) * (plateD - 3);
    const x = ex + PARAPET_T / 2 + 0.3;
    const y = head - 0.25;
    lay.sb.box(0.3, 0.04, 0.04, x - 0.15, y, z, IRON);
    const dir: V3 = [0.55, 0.7, (rnd() - 0.5) * 0.6];
    eye(lay.m(ALLOY), [x, y, z], dir, 0.05, 0.4, 0.14, 12, true, false);
    const l = Math.hypot(dir[0], dir[1], dir[2]);
    rod(lay, [x, y, z], [x + (dir[0] / l) * 0.55, y + (dir[1] / l) * 0.55, z + (dir[2] / l) * 0.55], 0.018);
  }
  // An aerial on the front parapet's inside face.
  if (rnd() < 0.5) {
    const sz = rnd() < 0.5 ? -1 : 1;
    const x = x0 + rnd() * (x1 - x0);
    const z = sz * (d / 2 - PARAPET_T - 0.04);
    rod(lay, [x, roofY, z], [x, head + 1.9, z], 0.035);
    for (let i = 0; i < 4; i++) {
      const yy = head + 1.0 + i * 0.27;
      const hl = 0.55 - i * 0.1;
      rod(lay, [x - hl, yy, z], [x + hl, yy, z], 0.02);
    }
  }
  // Somebody's position: a mattress, a mat, and one course of bags along the parapet's foot.
  if (rnd() < 0.5) {
    const sz = rnd() < 0.5 ? -1 : 1;
    const x = x0 + 1 + rnd() * (x1 - x0 - 2);
    const z = sz * (plateD / 2 - 0.8);
    lay.sb.box(1.9, 0.12, 0.85, x, roofY + 0.06, z, SANDBAG, undefined, HIDE_DOWN);
    lay.sb.box(1.5, 0.012, 1.0, x + 1.6, roofY + 0.01, z, AWNING, { y: 0.2 }, HIDE_DOWN);
    for (let i = 0; i < 5; i++) lay.sb.box(0.52, 0.14, 0.3, x - 1.2 + i * 0.52, roofY + 0.07, sz * (plateD / 2 - 0.16), SANDBAG, { y: (rnd() - 0.5) * 0.2 }, HIDE_DOWN);
  }
  if (rnd() < 0.5) {
    const sz = rnd() < 0.5 ? -1 : 1;
    const dw = 1.3 + rnd() * 0.6;
    const dx = x0 + dw / 2 + rnd() * Math.max(0, x1 - x0 - dw);
    drape(b, dw, 0.95, dx, head, sz * (d / 2), sz as 1 | -1, clothHash(dx, roofY, sz, 11));
  }
}

// --- the heap ------------------------------------------------------------------------

/**
 * The heap inside the ground floor: its box drawn as a mound of rubble
 * rather than as a box — a faceted heap whose foot spreads a third of a
 * metre past the collider (inside the clearance a body keeps from it anyway)
 * and whose crown stands just over it — lumps of block and slab laid on its
 * crown and its flanks, a slab of floor lying across it, and a skirt of
 * lumps round its foot no higher than a step.
 */
function heap(lay: Lay, k: Shell, h: Heap): void {
  const { rnd } = k;
  const top = h.y + h.h / 2;
  const foot = h.y - h.h / 2;
  const colours = [k.skin, CONCRETE, DARK_CONCRETE, k.frame];
  /** A ring round the box `out` past its faces at `y`, three points a side, each pushed out by up to `jit` more. */
  const ring = (out: number, y: number, jit: number): V3[] => {
    const hw = h.w / 2 + out;
    const hd = h.d / 2 + out;
    const corners: [number, number][] = [
      [hw, hd],
      [-hw, hd],
      [-hw, -hd],
      [hw, -hd],
    ];
    const normals: [number, number][] = [
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0],
    ];
    const pts: V3[] = [];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [cx, cz] = corners[(i + 1) % 4];
      for (let j = 0; j < 3; j++) {
        const t = j / 3;
        const o = rnd() * jit;
        pts.push([h.x + ax + (cx - ax) * t + normals[i][0] * o, y + (rnd() - 0.5) * 0.08, h.z + az + (cz - az) * t + normals[i][1] * o]);
      }
    }
    return pts;
  };
  const rings = [ring(0.3, foot, 0.12), ring(0.12, foot + h.h * 0.55, 0.1), ring(0.02, top + 0.05, 0.06)];
  const m = lay.m(DARK_CONCRETE);
  const n = rings[0].length;
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < n; i++) {
      const a = rings[r][i];
      const b2 = rings[r][(i + 1) % n];
      const c = rings[r + 1][(i + 1) % n];
      const d = rings[r + 1][i];
      const hint: V3 = [(a[0] + c[0]) / 2 - h.x, 0.3, (a[2] + c[2]) / 2 - h.z];
      m.tri(a, b2, c, hint);
      m.tri(a, c, d, hint);
    }
  }
  const crown: V3 = [h.x + (rnd() - 0.5) * 0.4, top + 0.16, h.z + (rnd() - 0.5) * 0.4];
  for (let i = 0; i < n; i++) m.tri(crown, rings[2][i], rings[2][(i + 1) % n], [0, 1, 0]);
  for (let i = 0; i < 6; i++) {
    const x = h.x + (rnd() - 0.5) * (h.w - 0.5);
    const z = h.z + (rnd() - 0.5) * (h.d - 0.5);
    chunk(lay, x, top + 0.04, z, 0.25 + rnd() * 0.35, colours[i % 4], rnd);
  }
  // Lumps on the flanks, and the skirt, kept out of the stair's lane.
  for (let i = 0; i < n; i += 2) {
    const p = rings[1][i];
    chunk(lay, p[0] + (p[0] - h.x) * 0.02, p[1] - 0.1, p[2] + (p[2] - h.z) * 0.02, 0.22 + rnd() * 0.2, colours[(i + 1) % 4], rnd);
    const q = rings[0][i];
    const sx = q[0] + Math.sign(q[0] - h.x) * rnd() * 0.3;
    const sz = q[2] + Math.sign(q[2] - h.z) * rnd() * 0.3;
    if (sx < k.edge - 0.2) chunk(lay, sx, PLINTH, sz, 0.12 + rnd() * 0.18, colours[i % 4], rnd);
  }
  const sl = Math.min(h.w, h.d) * 0.8;
  lay.sb.box(sl, 0.18, sl * 0.6, h.x, top + 0.2, h.z, CONCRETE, { y: rnd() * TAU, z: 0.15, x: 0.08 });
}
