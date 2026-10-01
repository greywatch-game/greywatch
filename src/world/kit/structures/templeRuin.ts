/**
 * kit/structures/templeRuin.ts — buildTempleRuin: the stepped stone platform
 * the jungle has taken back.
 * Part of the structures set: follows the contract in kit/core.ts, and the
 * cover heights and round-collider rule in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import { CONFIG } from "../../../config";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import { marksSway } from "../../sway";
import {
  Build,
  carve,
  fern,
  heading,
  limb,
  orient,
  rope,
  slab,
  stepAlong,
  type BuildCtx,
  type BuildParams,
  type Structure,
  type Point3,
  streetSeed,
  DARK_STONE,
  FIG_BARK,
  FIG_LEAF,
  FIG_LEAF_LIT,
  MOSS_STONE,
  STONE,
} from "../core";
import {
  SANDSTONE,
  LATERITE,
  flat,
  courses,
  templeTone,
  hang,
  moss,
  fallen,
  devata,
} from "./templeStone";

const TRANSLUCENCY = CONFIG.graphics.translucency;

/**
 * Rise per tier. It has to clear `NavGrid`'s HEIGHT_EPS (0.35) or `addSurface`
 * merges two tiers into one surface and the climb stops existing; and it has to
 * stay under CONFIG.nav.stepHeight (0.6) or a tier is a wall the flood fill
 * refuses. That is a 0.25 m window, and this sits near its middle — the slack
 * over 0.5 is what pays for the terrain varying across a 26 m footprint that
 * MapBuilder height-samples at ONE point.
 */
const TIER_RISE = 0.45;
/** How far each tier steps in from the one below, on every side. */
const TIER_INSET = 3.2;
/** How far the tiers are sunk below the placement's own ground. */
const TIER_BURY = 0.4;

/**
 * How deep a joint between two facing stones is, and so the step the ink draws
 * every stone's outline by. The temple is dry-laid: its joints are hairlines,
 * and what makes them read is the depth behind them rather than a colour.
 */
const TEMPLE_JOINT = 0.02;
/**
 * How far the COPING — the lip stone every tread's edge is laid in — reaches
 * back onto the tread, and how far it overhangs the riser below it.
 */
const COPE_IN = 0.34;
const COPE_OUT = 0.09;
const COPE_H = 0.14;
/** The moulded course at a riser's foot, and how far it stands out. */
const FOOT_H = 0.1;
const FOOT_OUT = 0.07;
/** How far the dressed face of a riser's facing stands proud of the collider's. */
const FACE_PROUD = 0.02;
/** How far the core the facing is laid on stands BEHIND the collider's face. */
const CORE_BACK = 0.05;
/**
 * A stepped stone platform the jungle has taken back: three terraces faced in
 * moulded sandstone over a laterite core, stairs up the middle of every face,
 * the surviving piers of the gallery that once ran round the middle terrace,
 * and a sanctuary wall across the summit with a strangler fig growing out of
 * the top of it.
 *
 * ## What it is for
 *
 * It is the only elevation in the kit that needs no ramp, no stair and no
 * doorway. Every tier is a step inside `stepHeight`, so it is walked up from
 * any bearing by anything with feet — which makes it high ground a bot can hold
 * without the pathing having to be clever, and high ground a player can be
 * pushed off from four sides at once. The watchtower and the barn loft are
 * verticality with ONE way up; this is the opposite of that on purpose. The
 * stairs drawn up each face are a picture of that and nothing more: the whole
 * riser is still the step.
 *
 * There is deliberately no `guard` anywhere on it. A rail would turn a platform
 * you can leave in any direction into a fortress with one entrance, and would
 * cost a nav cell on every face.
 *
 * ## The colliders are RINGS, and the whole thing turns on it
 *
 * The obvious build is three nested solid boxes. It looks right, it walks right
 * in the editor, and it silently loses its top tier. `NavGrid` keeps
 * MAX_SURFACES = 3 per cell and `addSurface` RETURNS when it is full — so trace
 * a cell at the centre: terrain goes in, tier 1's top goes in, tier 2's top goes
 * in, and tier 3's top — the summit, the only part anyone climbs for — is
 * dropped. Nothing throws, nothing draws differently, and the flag on top is
 * unstandable.
 *
 * So each tier's COLLIDER is only the ring of tread it actually exposes.
 * `topFaceHeight` returns null outside a box's own XZ footprint and
 * `NavGrid.rasterize` skips on null, so a cell centre lands inside exactly one
 * ring and every cell carries two surfaces instead of four.
 *
 * The visual CORES stay three nested solid boxes, and that is what satisfies
 * the thick-box rule: every walked tread is paved on the top face of a
 * 0.85–1.75 m block. They are all one colour, so they merge into a single mesh
 * and their buried coplanar faces cannot be a depth-test tie.
 *
 * ## The nav budget, which is the thing to preserve
 *
 * | cell | surfaces |
 * | --- | --- |
 * | off the temple | terrain |
 * | on any tread | terrain (blocked) + that tread |
 * | under a pier, the wall, or the fallen pier | terrain + tread + that thing's top |
 *
 * Never four. So: no fourth tier, no nested solid COLLIDERS, and nothing new
 * standing in a cell that already carries two treads.
 *
 * ## The masses are the colliders' and the detail is the drawing
 *
 * The block at the top of the builder is every collider the temple has ever
 * had, in the order it has always emitted them, stated by hand because nothing
 * is drawn as the box `wall` would draw — the sanctuary wall is `doorWall`'s
 * own arithmetic spelled out, so the bake cannot move by a float. A change
 * below that block owes no `npm run collision`; one inside it does.
 *
 * Everything else is drawing, and all of it obeys one of three rules: it is
 * flat on a face, it is low enough to walk over, or it stands on top of a
 * collider. The pediment, the broken courses on the wall's head and the fig
 * all stand on the wall; the architraves stand on the piers; the stairs, the
 * pier stumps, the roots across the treads and the rubble are all under a
 * third of a metre.
 *
 * **A paving flag's top is the tread's walked height EXACTLY**, with the
 * joints sunk into the core under it, rather than standing a few centimetres
 * proud the way the jungle ruin's tiles do. The capture ring's paint is laid
 * 18 mm over whatever box top it finds (`CaptureZoneSystem`'s `PAINT_LIFT`),
 * and this temple is flag D: a pavement even two centimetres proud of the
 * collider buries the ring's line under the stone everywhere it crosses a
 * tread.
 *
 * ## What it is drawn as
 *
 * - **Three moulded terraces.** Every riser is a foot moulding, a dado of
 *   dressed facing stones — a few carved with a rosette — and a coping whose
 *   lip overhangs it, all laid dry on a dark core. A stone or two has gone
 *   from most runs, and a stretch of some faces has slumped altogether: the
 *   coping and the dado lie at its foot and the LATERITE fill shows behind in
 *   its own coarse courses. The lowest terrace's facing is carried down to the
 *   ground under it.
 * - **Paved treads.** Flags in running bond, three weathered tones, damper
 *   and greener on the lower terraces; lost where the forest has got in,
 *   lifted and tilted over the fig's roots, cracked in two here and there.
 *   Moss holds the inside corners of the north treads, and ferns grow out of
 *   the holes.
 * - **Stairs.** One up the middle of every face of every terrace: two steps in
 *   front of the riser and a top step laid into it, between stepped cheek
 *   blocks. The south stair leads down onto the stub of a paved causeway, its
 *   slabs sunk and lost into the forest floor.
 * - **The gallery.** The four colliders on the middle terrace's corners are
 *   the four piers still standing: moulded bases, a devata carved in a framed
 *   panel on every face, stepped capitals, and a broken length of architrave
 *   still on most of them. Between them, the stumps of the piers that fell.
 *   One of those lies across the foot of the east stair — the old toppled
 *   column's collider — in three pieces, the carved face of its shaft looking
 *   at the sky.
 * - **The sanctuary wall.** Coursed sandstone on a moulded plinth under a
 *   cornice; a doorway with jambs, a carved lintel and an octagonal colonnette
 *   either side; a balustered blind window left and right of it; and a
 *   pediment over the door framed by a naga whose hoods fan out at each end.
 *   Its ends are toothed where the wall once ran on, and a course or two of
 *   what stood on it survives in places. Ruined, it is a coursed stub with a
 *   broken head, and the pediment lies face up on the summit in front of it.
 * - **The fig.** A strangler growing out of the top of the wall, as they do at
 *   Ta Prohm: braided stems over a core, buttresses gripping the head, roots
 *   cascading down both faces — south onto the summit, north down every
 *   terrace to the ground — and the forest's own crown, marked to move in the
 *   same wind as `buildJungleTree`'s. Its aerial roots stay 2.5 m over every
 *   tread.
 * - **The socket on the summit.** The flag stands where the image did: in the
 *   square socket of its pedestal, the image long gone.
 *
 * **All of it is seeded off where the temple stands** (`streetSeed`), and the
 * lowest terrace's facing, the south stair and the causeway are cut to the
 * ground under them, which is what puts `templeRuin` in
 * `CONFORMS_TO_TERRAIN`.
 */
export function buildTempleRuin(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "temple");
  const w = p.width ?? 26;
  const d = p.depth ?? 22;
  // Keep the top tier from inverting on a small footprint: three tiers need six
  // insets out of the shorter half-span and something left to stand on.
  const inset = Math.min(TIER_INSET, (Math.min(w, d) / 2 - 2.2) / 2);
  const half = [
    { x: w / 2, z: d / 2 },
    { x: w / 2 - inset, z: d / 2 - inset },
    { x: w / 2 - inset * 2, z: d / 2 - inset * 2 },
  ];
  /** Walked height of tier `i`. */
  const top = (i: number): number => (i + 1) * TIER_RISE;
  const ruined = p.ruined === true;
  const sanctH = ruined ? 1.3 : 2.9;
  const wallZ = half[2].z - 0.25;
  const doorW = 1.8;
  const doorH = 2.0;
  const pierX = half[2].x + (half[1].x - half[2].x) / 2;
  const pierZ = half[2].z + (half[1].z - half[2].z) / 2;
  const colX = half[1].x + (half[0].x - half[1].x) / 2;
  const colY = top(0) + 0.39;
  const colZ = d * 0.1;

  // ------------------------------------------------------------ the masses
  //
  // Every collider the temple has, in the order it has always emitted them.
  // See the header before adding to it.

  // The terraces: for tiers 0 and 1, the exposed ring only. The ±X runs take
  // the corners and the ±Z runs stop short of them, so the four abut without
  // overlapping and no cell centre falls in two.
  for (let i = 0; i < 2; i++) {
    const h = top(i) + TIER_BURY;
    const y = top(i) - h / 2;
    const band = half[i].x - half[i + 1].x;
    for (const s of [-1, 1]) {
      b.block({ w: band, h, d: half[i].z * 2, x: s * (half[i].x - band / 2), y, z: 0 });
      b.block({ w: half[i + 1].x * 2, h, d: band, x: 0, y, z: s * (half[i].z - band / 2) });
    }
  }
  // The summit is the one tier that can be a single solid box: nothing steps in
  // above it, so its cells carry terrain and one tread and no more.
  {
    const h = top(2) + TIER_BURY;
    b.block({ w: half[2].x * 2, h, d: half[2].z * 2, x: 0, y: top(2) - h / 2, z: 0 });
  }
  // The sanctuary wall across the summit's north edge — the height the tiers
  // deliberately do not provide, and hard cover for whoever holds the top. The
  // standing one is `doorWall(half[2].x * 2, sanctH, 0.5, 0, ..., 1.8, 2.0)`.
  const wy = top(2) + sanctH / 2;
  if (ruined) {
    b.block({ w: half[2].x * 1.1, h: sanctH, d: 0.5, x: -half[2].x * 0.4, y: wy, z: wallZ });
  } else {
    const side = (half[2].x * 2 - doorW) / 2;
    const off = doorW / 2 + side / 2;
    const lintel = sanctH - doorH;
    b.block({ w: side, h: sanctH, d: 0.5, x: 0 - off, y: wy, z: wallZ });
    b.block({ w: side, h: sanctH, d: 0.5, x: 0 + off, y: wy, z: wallZ });
    b.block({ w: doorW, h: lintel, d: 0.5, x: 0, y: wy + sanctH / 2 - lintel / 2, z: wallZ });
  }
  // The four standing piers, on the middle tread's corners — not the summit's,
  // which the wall already spends cells on.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.block({ w: 0.9, h: 2.6, d: 0.9, x: sx * pierX, y: top(1) + 1.3, z: sz * pierZ });
    }
  }
  // The fallen pier on the lowest tread: waist-high cover on the climb, which
  // is what stops the bottom tier being a shooting gallery.
  b.block({ w: 0.78, h: 0.78, d: 5.0, x: colX, y: colY, z: colZ });

  // ----------------------------------------------------------- the drawing
  const rnd = mulberry32(streetSeed(w, d, sanctH, ctx));
  const wallX0 = ruined ? -half[2].x * 0.4 - half[2].x * 0.55 : -half[2].x;
  const wallX1 = ruined ? -half[2].x * 0.4 + half[2].x * 0.55 : half[2].x;
  const wallTop = top(2) + sanctH;
  const zS = wallZ - 0.25;
  const zN = wallZ + 0.25;
  /** Which end of the wall the fig grows from, and so which way it leans. */
  const figDir = ruined ? -1 : 1;
  const figX = figDir > 0 ? wallX1 - 0.9 : wallX0 + 0.9;
  /** The blind windows either side of the door, where there is room for them. */
  const winX = (1.45 + figX - 0.75) / 2;
  const windows = !ruined && figX - 0.75 - 1.45 >= 1.6;
  const winW = 1.3;
  const winY0 = top(2) + 0.85;
  const winY1 = top(2) + doorH;
  /** The stairs: their widths per tier, and which faces carry one. */
  const stairW = [3.4, 2.8, 2.0].map((s, i) => Math.min(s, 2 * Math.min(half[i].x, half[i].z) - 3));
  const CHEEK = 0.36;
  const hasStair = (i: number, alongX: boolean, sgn: number): boolean =>
    stairW[i] > 1 && !(i === 2 && alongX && sgn > 0 && ruined);

  /**
   * The floor under a local point, as a local height. `MapBuilder`'s rotation:
   * local +X lands on (cos, -sin), +Z on (sin, cos). Level with no placement.
   */
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };

  // ---- where the fig's roots run, stated before anything is paved so the
  // flags over them can lift and the stumps in their way can be gone.
  const figRoots: Point3[][] = [];
  /** Each root's diameter where it leaves the tree and where it ends. */
  const figR: [number, number][] = [];
  /**
   * A thinner root thrown off sideways from `at` across the tread it lies on
   * — what keeps one long root from reading as a pipe laid down the steps.
   */
  const branch = (at: Point3, side: number, d0: number, run: number): void => {
    const y = at[1];
    figRoots.push([
      at,
      [at[0] + side * run * 0.45, y - d0 * 0.2, at[2] + (rnd() - 0.3) * 0.5],
      [at[0] + side * run, y - d0 * 0.45, at[2] + (rnd() - 0.3) * 0.8],
    ]);
    figR.push([d0, 0.05]);
  };
  {
    const lipS = zS - 0.12;
    const lipN = zN + 0.12;
    // South, down the inner face and out across the summit.
    for (const [dx, d0, reach] of [
      [-0.6, 0.3, 2.6],
      [0.05, 0.26, 1.7],
      [0.6, 0.2, 3.1],
    ] as const) {
      const x = figX - figDir * dx;
      const r = d0 / 2;
      const j = (): number => (rnd() - 0.5) * 0.25;
      const mid: Point3 = [x + j() * 2, top(2) + r * 0.3, zS - 0.45 - reach * 0.55];
      figRoots.push([
        [figX - figDir * dx * 0.4, wallTop + 0.35, wallZ - 0.05],
        [x, wallTop + 0.08 + r, lipS - r * 0.3],
        [x, wallTop - 0.4, lipS - r * 0.9],
        [x + j(), top(2) + sanctH * 0.45, zS - r * 0.9],
        [x + j(), top(2) + 0.36, zS - 0.15 - r],
        [x + j(), top(2) + r * 0.3, zS - 0.45 - r],
        mid,
        [x + j() * 3, top(2) + 0.02, zS - 0.45 - reach],
      ]);
      figR.push([d0, d0 * 0.3]);
      branch(mid, rnd() < 0.5 ? -1 : 1, d0 * 0.45, 0.8 + rnd() * 0.7);
    }
    // North, down the outer face and every terrace to the ground. Each one
    // wanders across a tread, ROLLS over the lip rather than folding at it,
    // and throws a thinner root off sideways — one tube bent square at every
    // edge read as a pipe laid down the steps.
    for (const [dx, d0] of [
      [0.3, 0.36],
      [0.85, 0.26],
    ] as const) {
      const x = figX + figDir * dx;
      const r = d0 / 2;
      const j = (): number => (rnd() - 0.5) * 0.3;
      const x1 = x + j();
      const x2 = x1 + j();
      const x3 = x2 + j();
      const gz = half[0].z + 1.3;
      const t1a = zN + 0.4 + r;
      const t1b = half[1].z - 0.6;
      const t0a = half[1].z + 0.4 + r;
      const t0b = half[0].z - 0.6;
      const bow = (): number => (rnd() < 0.5 ? -1 : 1) * (0.2 + rnd() * 0.3);
      const m1: Point3 = [(x1 + x2) / 2 + bow(), top(1) + r * 0.25, (t1a + t1b) / 2];
      const m0: Point3 = [(x2 + x3) / 2 + bow(), top(0) + r * 0.25, (t0a + t0b) / 2];
      figRoots.push([
        [figX + figDir * dx * 0.4, wallTop + 0.35, wallZ + 0.05],
        [x, wallTop + 0.08 + r, lipN + r * 0.3],
        [x, wallTop - 0.4, lipN + r * 0.9],
        [x1, top(2) + 0.55, zN + 0.15 + r],
        [x1, top(1) + 0.16, zN + FOOT_OUT + r],
        [x1, top(1) + r * 0.3, t1a],
        m1,
        [x2, top(1) + r * 0.3, t1b],
        [x2, top(1) + r * 0.5, half[1].z + COPE_OUT * 0.5 + r * 0.5],
        [x2, top(1) - 0.12, half[1].z + COPE_OUT + r * 0.85],
        [x2, top(0) + 0.14, half[1].z + FOOT_OUT + r],
        [x2, top(0) + r * 0.3, t0a],
        m0,
        [x3, top(0) + r * 0.3, t0b],
        [x3, top(0) + r * 0.5, half[0].z + COPE_OUT * 0.5 + r * 0.5],
        [x3, top(0) - 0.12, half[0].z + COPE_OUT + r * 0.85],
        [x3, ground(x3, half[0].z + 0.3) + 0.12, half[0].z + FOOT_OUT + r],
        [x3 + j(), ground(x3, gz) - 0.06, gz],
      ]);
      figR.push([d0, d0 * 0.25]);
      branch(m1, -figDir, d0 * 0.45, 1.1 + rnd() * 0.8);
      branch(m0, rnd() < 0.5 ? -1 : 1, d0 * 0.4, 1.0 + rnd() * 0.8);
    }
    // Over the wall's end, down onto the summit and over its edge.
    if (!ruined) {
      const r = 0.12;
      const end = figDir > 0 ? wallX1 : wallX0;
      const ex = figDir * (half[2].x + COPE_OUT + r * 0.6);
      figRoots.push([
        [figX + figDir * 0.4, wallTop + 0.3, wallZ],
        [end + figDir * (0.1 + r), wallTop - 0.25, wallZ + 0.05],
        [end + figDir * (0.06 + r), top(2) + 0.7, wallZ - 0.1],
        [end - figDir * 0.2, top(2) + r * 0.3, zS - 0.6],
        [ex, top(2) + r * 0.5, zS - 1.1],
        [ex + figDir * 0.05, top(1) + 0.14, zS - 1.4],
        [ex + figDir * 0.45, top(1) + r * 0.3, zS - 1.8],
        [ex + figDir * 1.3, top(1) + 0.02, zS - 2.5],
      ]);
      figR.push([r * 2, r * 0.6]);
    }
  }
  /** How close a flat point is to a root lying on the tread it is on, in metres. */
  const rootNear = (x: number, z: number, y: number): number => {
    let best = Infinity;
    for (const path of figRoots) {
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1];
        const c = path[k];
        if (Math.min(a[1], c[1]) > y + 0.3 || Math.max(a[1], c[1]) < y - 0.2) continue;
        const dx = c[0] - a[0];
        const dz = c[2] - a[2];
        const L = dx * dx + dz * dz;
        const t = L > 1e-6 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L)) : 0;
        best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t));
      }
    }
    return best;
  };

  // ---- the gallery's stumps: the piers that fell, spaced between the four
  // that stand. None on the axes, where the gallery had its doors.
  const stumps: [number, number][] = [];
  for (const [alongX, run, at] of [
    [true, pierX, pierZ],
    [false, pierZ, pierX],
  ] as const) {
    const n = Math.max(2, Math.round((2 * run) / 3.3));
    for (let k = 1; k < n; k++) {
      const u = -run + (k * 2 * run) / n;
      if (Math.abs(u) < 1.6) continue;
      for (const s of [-1, 1]) {
        const [x, z] = alongX ? [u, s * at] : [s * at, u];
        if (rootNear(x, z, top(1)) < 0.8) continue;
        stumps.push([x, z]);
      }
    }
  }

  /** Whether a flag at (x, z) on tier `i` is under something that hides it. */
  const hidden = (i: number, x: number, z: number): boolean => {
    if (i === 1) {
      if (Math.abs(Math.abs(x) - pierX) < 0.5 && Math.abs(Math.abs(z) - pierZ) < 0.5) return true;
      for (const [sx, sz] of stumps) if (Math.abs(x - sx) < 0.45 && Math.abs(z - sz) < 0.45) return true;
    }
    if (i === 0 && Math.abs(x - colX) < 0.35 && Math.abs(z - colZ) < 2.4) return true;
    if (i === 2 && z > zS - 0.1 && x > wallX0 - 0.1 && x < wallX1 + 0.1) return true;
    if (i === 2 && Math.abs(x) < 0.7 && Math.abs(z) < 0.7) return true;
    return false;
  };

  // ---- the terraces: facing, coping and stairs on every riser, and the
  // paving on every tread.
  //
  // **Whatever is hidden is emitted AFTER what hides it** — the cores after
  // the facing and the paving laid over them — and that order is load-bearing,
  // for the reason the jungle ruin states: the part merge keeps it, so within
  // one draw the depth test rejects the hidden layer rather than shading it
  // and then shading over it.
  /** The slumps, per tier and face: the stretch of facing that has come down. */
  const slumps: { i: number; alongX: boolean; sgn: number; u0: number; u1: number }[] = [];
  for (let i = 0; i < 3; i++) {
    for (const [alongX, sgn] of [
      [true, -1], [true, 1], [false, -1], [false, 1],
    ] as const) {
      const runHalf = alongX ? half[i].x : half[i].z;
      if (rnd() > (i === 2 ? 0.2 : 0.45) || runHalf < 4) continue;
      const len = 1.6 + rnd() * 1.6;
      // Off the axis, where the stair is, and off the corner.
      const u = (rnd() < 0.5 ? -1 : 1) * (stairW[i] / 2 + CHEEK + 0.6 + len / 2 + rnd() * Math.max(0, runHalf - stairW[i] / 2 - len - 1.6));
      if (i === 2 && alongX && sgn > 0) continue;
      slumps.push({ i, alongX, sgn, u0: u - len / 2, u1: u + len / 2 });
    }
  }
  const slumpAt = (i: number, alongX: boolean, sgn: number, u: number): boolean =>
    slumps.some((s) => s.i === i && s.alongX === alongX && s.sgn === sgn && u > s.u0 && u < s.u1);

  for (let i = 0; i < 3; i++) {
    const hx = half[i].x;
    const hz = half[i].z;
    const yHi = top(i);
    const yLo = i === 0 ? 0 : top(i - 1);
    const damp = 0.55 - i * 0.15;
    for (const [alongX, sgn] of [
      [true, -1], [true, 1], [false, -1], [false, 1],
    ] as const) {
      const at = alongX ? hz : hx;
      const plane = sgn * at;
      // The ±Z faces take the corners, the ±X faces stop short of them.
      const runHalf = alongX ? hx + COPE_OUT : hz - COPE_IN;
      const footHalf = alongX ? hx + FOOT_OUT : hz;
      const faceHalf = alongX ? hx + FACE_PROUD : hz;
      const stair = hasStair(i, alongX, sgn);
      const cut: [number, number][] = stair ? [[-stairW[i] / 2 - CHEEK, stairW[i] / 2 + CHEEK]] : [];
      // The wall stands on the summit's north edge: no coping under it.
      const wallCut: [number, number][] =
        i === 2 && alongX && sgn > 0 ? [[wallX0, wallX1]] : [];
      const g = (u: number, out: number): number =>
        alongX ? ground(u, sgn * (at + out)) : ground(sgn * (at + out), u);

      // The coping: the lip every tread's edge is laid in.
      for (const [a, c] of carve(-runHalf, runHalf, [...cut, ...wallCut])) {
        courses(a, c, 0.8, 1.4, rnd, (u0, u1) => {
          const um = (u0 + u1) / 2;
          if (slumpAt(i, alongX, sgn, um)) return;
          const r = rnd();
          if (r < 0.025) return;
          const drop = r < 0.1 ? 0.01 + rnd() * 0.012 : 0;
          const cy = yHi - COPE_H / 2 - drop;
          const cc = plane + sgn * (COPE_OUT - COPE_IN) / 2;
          const rot = drop ? { y: (rnd() - 0.5) * 0.05 } : undefined;
          const color = templeTone(rnd, damp);
          if (alongX) b.box(u1 - u0 - TEMPLE_JOINT, COPE_H, COPE_IN + COPE_OUT, um, cy, cc, color, rot);
          else b.box(COPE_IN + COPE_OUT, COPE_H, u1 - u0 - TEMPLE_JOINT, cc, cy, um, color, rot);
        });
      }
      // The foot moulding, and on the lowest terrace the footing course under
      // it, carried down to the ground a stone at a time.
      for (const [a, c] of carve(-footHalf, footHalf, cut)) {
        courses(a, c, 0.9, 1.5, rnd, (u0, u1) => {
          const um = (u0 + u1) / 2;
          if (i === 0) {
            const gy = Math.min(g(um, 0.1), g(u0, 0.1), g(u1, 0.1));
            if (gy > FOOT_H - 0.02) return;
            const bot = Math.min(0, gy) - 0.1;
            const hh = FOOT_H - bot;
            const color = gy < -0.25 ? LATERITE : templeTone(rnd, 0.7);
            flat(b, alongX, plane, sgn, um, bot + hh / 2, u1 - u0 - TEMPLE_JOINT, hh, 0.18, FOOT_OUT - 0.09, color);
            return;
          }
          if (rnd() < 0.03) return;
          flat(b, alongX, plane, sgn, um, yLo + FOOT_H / 2, u1 - u0 - TEMPLE_JOINT, FOOT_H, 0.18, FOOT_OUT - 0.09, templeTone(rnd, damp + 0.15));
        });
      }
      // The dado between them: dressed stones, one in a few carved with a
      // rosette, and where one has gone the laterite behind it shows.
      const dY0 = yLo + FOOT_H;
      const dY1 = yHi - COPE_H;
      const dH = dY1 - dY0;
      for (const [a, c] of carve(-faceHalf, faceHalf, cut)) {
        courses(a, c, 0.45, 1.05, rnd, (u0, u1) => {
          const um = (u0 + u1) / 2;
          const len = u1 - u0 - TEMPLE_JOINT;
          if (slumpAt(i, alongX, sgn, um)) return;
          if (rnd() < 0.05) {
            flat(b, alongX, plane, sgn, um, dY0 + dH / 2, len, dH, 0.1, -0.07, LATERITE);
            return;
          }
          const push = rnd() < 0.07 ? 0.015 + rnd() * 0.03 : 0;
          flat(b, alongX, plane, sgn, um, dY0 + dH / 2, len, dH - TEMPLE_JOINT, 0.12, FACE_PROUD - 0.06 + push, templeTone(rnd, damp), push ? (rnd() - 0.5) * 0.04 : 0);
          if (len > 0.6 && rnd() < 0.3) {
            flat(b, alongX, plane, sgn, um, dY0 + dH / 2, 0.11, 0.11, 0.03, FACE_PROUD + push + 0.012, SANDSTONE, Math.PI / 4);
            flat(b, alongX, plane, sgn, um, dY0 + dH / 2, 0.05, 0.05, 0.03, FACE_PROUD + push + 0.026, SANDSTONE, Math.PI / 4);
          }
        });
      }
      // The slumps: coarse laterite courses behind, the facing at the foot.
      for (const s of slumps) {
        if (s.i !== i || s.alongX !== alongX || s.sgn !== sgn) continue;
        const lat0 = yLo + (i === 0 ? FOOT_H : 0);
        const latTop = yHi - 0.04;
        const rows = 2;
        const rh = (latTop - lat0) / rows;
        for (let k = 0; k < rows; k++) {
          courses(s.u0, s.u1, 0.3, 0.55, rnd, (u0, u1) => {
            const um = (u0 + u1) / 2;
            const hh = k === rows - 1 ? rh - rnd() * 0.06 : rh;
            flat(b, alongX, plane, sgn, um, lat0 + k * rh + hh / 2, u1 - u0 - 0.03, hh - 0.025, 0.12, -0.09 - rnd() * 0.025, LATERITE);
          });
        }
        // The lip gone too: the tread's edge is the laterite, a little under
        // the paving and broken back from the face.
        courses(s.u0 + 0.1, s.u1 - 0.1, 0.35, 0.6, rnd, (u0, u1) => {
          const um = (u0 + u1) / 2;
          const inn = COPE_IN + 0.1 + rnd() * 0.25;
          const cc = plane - sgn * (0.06 + inn / 2);
          const yt = yHi - 0.008 - rnd() * 0.012;
          if (alongX) b.box(u1 - u0 - 0.03, 0.1, inn, um, yt - 0.05, cc, LATERITE);
          else b.box(inn, 0.1, u1 - u0 - 0.03, cc, yt - 0.05, um, LATERITE);
        });
        // What came down lies at the foot.
        for (let k = 0; k < 4; k++) {
          const u = s.u0 + rnd() * (s.u1 - s.u0);
          const out = 0.35 + rnd() * 0.9;
          const [x, z] = alongX ? [u, sgn * (at + out)] : [sgn * (at + out), u];
          fallen(b, x, i === 0 ? ground(x, z) : yLo, z, 0.55 + rnd() * 0.35, rnd, k === 0 ? LATERITE : templeTone(rnd, damp));
        }
      }
      // Creeper off the lip of the north risers, and here and there elsewhere.
      if (sgn > 0 || rnd() < 0.3) {
        const n = alongX && sgn > 0 ? 3 : 1;
        for (let k = 0; k < n; k++) {
          const len = 0.8 + rnd() * 1.6;
          const u = (rnd() * 2 - 1) * (runHalf - len);
          if (stair && Math.abs(u) < stairW[i] / 2 + CHEEK + len / 2) continue;
          hang(b, alongX, plane, sgn, u - len / 2, u + len / 2, yHi - 0.02, TIER_RISE * 0.9, yLo + 0.06, COPE_OUT + 0.02, rnd);
        }
      }

      // The stair: two steps in front of the riser and a top step laid into
      // it, between stepped cheek blocks. `base` is the ground under its foot.
      if (stair) {
        const sw = stairW[i];
        const base = i === 0 ? Math.min(0, g(0, 0.7), g(-sw / 2, 0.7), g(sw / 2, 0.7)) - 0.08 : yLo - 0.02;
        const q = TIER_RISE / 3;
        const step = (o0: number, o1: number, y1: number, inside = false): void => {
          courses(-sw / 2, sw / 2, 0.8, 1.3, rnd, (u0, u1) => {
            const um = (u0 + u1) / 2;
            const y0 = inside ? y1 - 0.16 : base;
            const hh = y1 - y0 - (rnd() < 0.15 ? 0.015 : 0);
            const cc = plane + (sgn * (o0 + o1)) / 2;
            const color = templeTone(rnd, damp + 0.1);
            if (alongX) b.box(u1 - u0 - TEMPLE_JOINT, hh, o1 - o0, um, y0 + hh / 2, cc, color);
            else b.box(o1 - o0, hh, u1 - u0 - TEMPLE_JOINT, cc, y0 + hh / 2, um, color);
          });
        };
        step(0.3, 0.62, yLo + q);
        step(-0.02, 0.32, yLo + 2 * q);
        step(-COPE_IN, 0, yHi, true);
        for (const s of [-1, 1]) {
          const u = s * (sw / 2 + CHEEK / 2);
          const cheek = (o0: number, o1: number, y1: number): void => {
            const cc = plane + (sgn * (o0 + o1)) / 2;
            const color = templeTone(rnd, damp);
            if (alongX) b.box(CHEEK - 0.02, y1 - base, o1 - o0, u, (base + y1) / 2, cc, color);
            else b.box(o1 - o0, y1 - base, CHEEK - 0.02, cc, (base + y1) / 2, u, color);
          };
          cheek(0.36, 0.74, yLo + 0.22);
          cheek(-COPE_IN, 0.38, yHi + 0.04);
          if (rnd() < 0.5) moss(b, alongX ? u : plane + sgn * 0.55, yLo + 0.22, alongX ? plane + sgn * 0.55 : u, 0.14, rnd);
        }
      }
    }

    // The paving: rows along X in running bond, clear of the coping and of
    // the terrace above.
    const ox = hx - COPE_IN - 0.01;
    const oz = hz - COPE_IN - 0.01;
    const inner = i < 2 ? half[i + 1] : null;
    for (let z = -oz; z < oz - 0.05; ) {
      const rowD = Math.min(oz - z, 0.7 + rnd() * 0.35);
      const zm = z + rowD / 2;
      const cuts: [number, number][] =
        inner && Math.abs(zm) < inner.z + FOOT_OUT ? [[-inner.x - FOOT_OUT, inner.x + FOOT_OUT]] : [];
      for (const [a, c] of carve(-ox, ox, cuts)) {
        courses(a, c, 0.75, 1.5, rnd, (u0, u1) => {
          const xm = (u0 + u1) / 2;
          if (hidden(i, xm, zm)) return;
          const near = rootNear(xm, zm, yHi);
          // Lost: under the roots, at the corners, and anywhere at all a little.
          const corner = Math.min(ox - Math.abs(xm), oz - Math.abs(zm));
          let lost = 0.025 + (corner < 1.2 ? 0.1 : 0);
          if (near < 0.35) lost = 0.75;
          else if (near < 0.9) lost = 0.25;
          for (const s of slumps) {
            if (s.i !== i) continue;
            const along = s.alongX ? xm : zm;
            const dist = s.alongX ? s.sgn * hz - zm : s.sgn * hx - xm;
            if (along > s.u0 - 0.2 && along < s.u1 + 0.2 && Math.abs(dist) < COPE_IN + 0.8) lost = Math.max(lost, 0.6);
          }
          const len = u1 - u0 - TEMPLE_JOINT;
          const dep = rowD - TEMPLE_JOINT;
          if (rnd() < lost) {
            // A hole: the bed shows, and what grows in it.
            const r = rnd();
            if (r < 0.45) moss(b, xm, yHi - 0.035, zm, Math.min(len, dep) * 0.4, rnd);
            else if (r < 0.75) fern(b, xm, yHi - 0.03, zm, 0.45 + rnd() * 0.3, rnd);
            return;
          }
          const color = templeTone(rnd, damp);
          if (near < 1.4) {
            // Heaved by a root: lifted on the side toward it and tipped off it.
            const lift = 0.02 + rnd() * 0.04;
            b.box(len, 0.1, dep, xm, yHi - 0.05 + lift, zm, color, { x: (rnd() - 0.5) * 0.14, y: (rnd() - 0.5) * 0.1, z: (rnd() - 0.5) * 0.14 });
          } else if (len > 0.9 && rnd() < 0.08) {
            // Cracked across and settled, the two halves not quite agreeing.
            const f = 0.35 + rnd() * 0.3;
            const l0 = len * f - 0.012;
            const l1 = len * (1 - f) - 0.012;
            b.box(l0, 0.1, dep, u0 + l0 / 2, yHi - 0.05, zm, color);
            b.box(l1, 0.1, dep, u1 - TEMPLE_JOINT - l1 / 2, yHi - 0.05 - 0.008, zm, color, { y: (rnd() - 0.5) * 0.03, z: (rnd() - 0.5) * 0.03 });
          } else {
            const sink = rnd() < 0.06 ? 0.01 : 0;
            b.box(len, 0.1, dep, xm, yHi - 0.05 - sink, zm, color, sink ? { y: (rnd() - 0.5) * 0.03 } : undefined);
          }
          // Moss in the damp: the north treads' inside corners.
          if (zm > 0 && rnd() < (i === 2 ? 0.06 : 0.14)) moss(b, xm, yHi, zm, 0.2 + rnd() * 0.25, rnd);
        });
      }
      z += rowD;
    }
  }

  // ---- the socket on the summit's centre: the image's pedestal, the image
  // gone, and the flag stood where it was.
  {
    const y = top(2);
    const S = 1.3;
    const hole = 0.36;
    const rim = (S - hole) / 2;
    for (const s of [-1, 1]) {
      b.box(S, 0.18, rim, 0, y - 0.06, s * (hole / 2 + rim / 2), SANDSTONE);
      b.box(rim, 0.18, hole, s * (hole / 2 + rim / 2), y - 0.06, 0, SANDSTONE);
    }
    b.box(S + 0.14, 0.05, S + 0.14, 0, y - 0.015, 0, MOSS_STONE);
    moss(b, S / 2 - 0.1, y + 0.03, -S / 2 + 0.15, 0.13, rnd);
  }

  // ---- the causeway: the stub of the paved way the south stair led down to,
  // its slabs sunk and lost into the forest floor.
  {
    const cw = stairW[0];
    const z0 = -half[0].z - 0.64;
    const len = 4 + rnd() * 1.5;
    for (let z = z0; z > z0 - len; ) {
      const dep = 0.7 + rnd() * 0.3;
      const zm = z - dep / 2;
      const fade = (z0 - zm) / len;
      courses(-cw / 2, cw / 2, 0.8, 1.3, rnd, (u0, u1) => {
        const xm = (u0 + u1) / 2;
        if (rnd() < 0.08 + fade * 0.6) return;
        const gs = [ground(u0, z), ground(u1, z), ground(u0, z - dep), ground(u1, z - dep)];
        const hi = Math.max(...gs) + 0.03 - fade * 0.04;
        const lo = Math.min(...gs) - 0.08;
        b.box(u1 - u0 - 0.03, hi - lo, dep - 0.03, xm, (hi + lo) / 2, zm, templeTone(rnd, 0.6), { y: (rnd() - 0.5) * 0.06 });
      });
      // Its kerbs, where they are left.
      for (const s of [-1, 1]) {
        if (rnd() < fade * 0.8) continue;
        const x = s * (cw / 2 + 0.14);
        const gk = Math.max(ground(x, z), ground(x, z - dep));
        b.box(0.26, 0.24, dep - 0.03, x, gk + 0.02, zm, templeTone(rnd, 0.7), { y: (rnd() - 0.5) * 0.06, z: s * rnd() * 0.08 });
      }
      z -= dep;
    }
  }

  // ---- the gallery: four piers standing, stumps between, and one lying on
  // the lowest terrace in three pieces.
  const PIER = 0.86;
  const pierBase = (x: number, z: number, y: number): void => {
    b.box(1.08, 0.12, 1.08, x, y + 0.06, z, templeTone(rnd, 0.5));
    b.box(0.98, 0.1, 0.98, x, y + 0.17, z, SANDSTONE);
  };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * pierX;
      const z = sz * pierZ;
      const y = top(1);
      pierBase(x, z, y);
      b.box(0.93, 0.07, 0.93, x, y + 0.255, z, SANDSTONE);
      const s0 = y + 0.29;
      const s1 = y + 2.12;
      b.box(PIER, s1 - s0, PIER, x, (s0 + s1) / 2, z, STONE);
      // A framed panel on every face, a devata in each.
      for (const [alongX, sg] of [
        [true, -1], [true, 1], [false, -1], [false, 1],
      ] as const) {
        const plane = (alongX ? z : x) + (sg * PIER) / 2;
        const u = alongX ? x : z;
        const p0 = s0 + 0.12;
        const p1 = s1 - 0.1;
        // The niche: its ground in the dark the weather leaves in a recess,
        // which is what a relief is read by when no shadow map can see 5 cm.
        flat(b, alongX, plane, sg, u, (p0 + p1) / 2, 0.56, p1 - p0 - 0.06, 0.02, 0.004, DARK_STONE);
        for (const yy of [p0, p1]) flat(b, alongX, plane, sg, u, yy, 0.68, 0.07, 0.07, 0.02, STONE);
        for (const du of [-0.3, 0.3]) flat(b, alongX, plane, sg, u + du, (p0 + p1) / 2, 0.08, p1 - p0, 0.07, 0.02, STONE);
        devata((du, dy, al, ta, tilt = 0) => flat(b, alongX, plane, sg, u + du, p0 + 0.06 + dy, al, ta, 0.05, 0.022, SANDSTONE, tilt), rnd() > 0.35);
        // The niche's pointed head over her.
        for (const e of [-1, 1]) flat(b, alongX, plane, sg, u + e * 0.1, p0 + 1.34, 0.28, 0.06, 0.05, 0.022, SANDSTONE, e * -0.55);
        // A band of petals under the panel.
        for (let k = -2; k <= 2; k++) flat(b, alongX, plane, sg, u + k * 0.13, s0 + 0.035, 0.07, 0.07, 0.03, 0.01, SANDSTONE, Math.PI / 4);
      }
      // The capital: a neck, a bell and an abacus, up to the collider's top.
      b.box(0.92, 0.08, 0.92, x, s1 + 0.04, z, SANDSTONE);
      b.box(0.98, 0.14, 0.98, x, s1 + 0.15, z, STONE);
      b.box(1.06, top(1) + 2.6 - (s1 + 0.22), 1.06, x, (s1 + 0.22 + top(1) + 2.6) / 2, z, SANDSTONE);
      const cap = top(1) + 2.6;
      // What the architrave left: a broken length reaching toward the pier
      // that is gone, or a single block sat askew.
      const r = rnd();
      if (r < 0.7) {
        const alongX = r < 0.35;
        const reach = 0.9 + rnd() * 1.3;
        const dir = alongX ? -sx : -sz;
        const len = 0.55 + reach;
        const cu = (alongX ? x : z) + dir * (reach / 2);
        if (alongX) b.box(len, 0.44, 0.7, cu, cap + 0.22, z, templeTone(rnd, 0.35));
        else b.box(0.7, 0.44, len, x, cap + 0.22, cu, templeTone(rnd, 0.35));
        // Its broken end, stepped back.
        const eu = (alongX ? x : z) + dir * (reach + 0.28 + 0.1);
        if (alongX) b.box(0.2, 0.26, 0.5, eu, cap + 0.13, z, DARK_STONE);
        else b.box(0.5, 0.26, 0.2, x, cap + 0.13, eu, DARK_STONE);
        fern(b, x, cap + 0.44, z, 0.5 + rnd() * 0.3, rnd);
      } else {
        b.box(0.8, 0.34, 0.6, x + (rnd() - 0.5) * 0.2, cap + 0.17, z + (rnd() - 0.5) * 0.2, templeTone(rnd, 0.4), { y: 0.3 + rnd() * 0.6, z: 0.05 });
        moss(b, x, cap, z, 0.3, rnd);
      }
      // Creeper down whichever face looks out.
      if (rnd() < 0.6) {
        const alongX = rnd() < 0.5;
        const sg = alongX ? sz : sx;
        const plane = (alongX ? z : x) + (sg * 1.06) / 2;
        const u = alongX ? x : z;
        hang(b, alongX, plane, sg, u - 0.45, u + 0.4, cap - 0.02, 1.6, y + 0.4, 0.02, rnd);
      }
    }
  }
  for (const [x, z] of stumps) {
    const r = rnd();
    if (r < 0.2) continue; // Gone to the socket: the paving round it is all that says so.
    if (r < 0.35) {
      // Pushed off its footing.
      b.box(1.0, 0.16, 1.0, x + (rnd() - 0.5) * 0.3, top(1) + 0.08, z + (rnd() - 0.5) * 0.3, templeTone(rnd, 0.5), { x: (rnd() - 0.5) * 0.1, y: rnd(), z: (rnd() - 0.5) * 0.1 });
      continue;
    }
    pierBase(x, z, top(1));
    if (rnd() < 0.5) b.box(PIER, 0.06, PIER, x, top(1) + 0.25, z, STONE, { y: (rnd() - 0.5) * 0.1 });
    if (rnd() < 0.4) moss(b, x, top(1) + 0.22, z, 0.25, rnd);
    else if (rnd() < 0.4) fern(b, x + 0.2, top(1) + 0.22, z - 0.1, 0.5, rnd);
  }
  // The fallen pier across the foot of the east stair: base, shaft and
  // capital, lying where they broke, the shaft's carved face to the sky.
  {
    const y = top(0) + 0.37;
    const z0 = colZ - 2.5;
    const piece = (za: number, zb: number, dy: number, yaw: number, roll: number, color: string, s = 0.74): void => {
      b.box(s, s, zb - za, colX + (rnd() - 0.5) * 0.04, y + dy, (za + zb) / 2, color, { y: yaw, z: roll });
    };
    // The base end: the pier and its moulding in one block.
    piece(z0, z0 + 1.15, 0, 0.03, 0.04, STONE);
    b.box(0.98, 0.98, 0.26, colX, y + 0.09, z0 + 0.13, SANDSTONE, { z: 0.04 });
    // The shaft.
    const s0 = z0 + 1.25;
    const s1 = z0 + 3.45;
    piece(s0, s1, -0.01, -0.035, -0.05, STONE);
    const fy = y - 0.01 + 0.37;
    const feet = (s0 + s1) / 2 - 0.6;
    b.box(0.56, 0.02, 1.3, colX, fy + 0.004, feet + 0.62, DARK_STONE);
    for (const du of [-0.3, 0.3]) b.box(0.08, 0.07, 1.4, colX + du, fy + 0.02, feet + 0.62, STONE);
    devata((du, dy, al, ta, tilt = 0) => b.box(al, 0.05, ta, colX + du, fy + 0.022, feet + dy, SANDSTONE, tilt ? { y: -tilt } : undefined), false);
    // The capital end, rolled further.
    piece(z0 + 3.55, z0 + 4.45, 0.02, 0.07, 0.12, SANDSTONE, 0.76);
    b.box(1.02, 1.02, 0.4, colX + 0.05, y + 0.12, z0 + 4.72, SANDSTONE, { y: 0.07, z: 0.14 });
    // Chips where it broke.
    for (const zc of [s0 - 0.05, s1 + 0.05]) {
      for (let k = 0; k < 3; k++) fallen(b, colX + (rnd() - 0.5) * 1.1, top(0), zc + (rnd() - 0.5) * 0.4, 0.22, rnd, SANDSTONE);
    }
    moss(b, colX - 0.1, y + 0.37, s0 + 0.5, 0.2, rnd);
    hang(b, true, z0 + 1.15, 1, colX - 0.35, colX + 0.35, y + 0.37, 0.5, top(0) + 0.05, 0.02, rnd);
  }

  // ---- the sanctuary wall.
  {
    const x0 = wallX0;
    const x1 = wallX1;
    const y0 = top(2);
    const PLINTH = 0.32;
    const CORNICE = ruined ? 0 : 0.3;
    const bodyH = sanctH - PLINTH - CORNICE;
    const nRows = Math.max(2, Math.round(bodyH / 0.44));
    const rowH = bodyH / nRows;
    const doorCut: [number, number][] = ruined ? [] : [[-doorW / 2 - 0.26, doorW / 2 + 0.26]];
    /** Over the door head the lintel is wider than the jambs under it. */
    const LINTEL_HALF = doorW / 2 + 0.45;
    const lintelCut: [number, number][] = ruined ? [] : [[-LINTEL_HALF, LINTEL_HALF]];
    const winCut = (y: number): [number, number][] =>
      windows && y > winY0 - 0.05 && y < winY1 + 0.05
        ? [[-winX - winW / 2 - 0.1, -winX + winW / 2 + 0.1], [winX - winW / 2 - 0.1, winX + winW / 2 + 0.1]]
        : [];
    for (const sg of [-1, 1]) {
      const plane = sg < 0 ? zS : zN;
      const damp = sg > 0 ? 0.5 : 0.3;
      // The plinth: a base course and a fillet over it, both standing out.
      for (const [a, c] of carve(x0, x1, doorCut)) {
        courses(a, c, 0.9, 1.5, rnd, (u0, u1) => {
          const um = (u0 + u1) / 2;
          flat(b, true, plane, sg, um, y0 + 0.1, u1 - u0 - TEMPLE_JOINT, 0.2, 0.28, 0.14 - 0.14, templeTone(rnd, damp + 0.2));
          flat(b, true, plane, sg, um, y0 + 0.26, u1 - u0 - TEMPLE_JOINT, 0.12, 0.2, 0.08 - 0.1, templeTone(rnd, damp));
        });
      }
      // The coursed body. A stone or two pushed out, one or two gone.
      for (let k = 0; k < nRows; k++) {
        const ry = y0 + PLINTH + k * rowH;
        const cuts = [...(ry + rowH > y0 + doorH + 0.02 ? lintelCut : doorCut), ...winCut(ry + rowH / 2)];
        for (const [a, c] of carve(x0 - FACE_PROUD, x1 + FACE_PROUD, cuts)) {
          courses(a, c, 0.7, 1.4, rnd, (u0, u1) => {
            const um = (u0 + u1) / 2;
            if (rnd() < 0.03) return;
            const push = rnd() < 0.08 ? 0.015 + rnd() * 0.03 : 0;
            flat(b, true, plane, sg, um, ry + rowH / 2, u1 - u0 - TEMPLE_JOINT, rowH - TEMPLE_JOINT, 0.14, FACE_PROUD - 0.07 + push, templeTone(rnd, damp * (1 - k / nRows)), push ? (rnd() - 0.5) * 0.03 : 0);
          });
        }
      }
      if (!ruined) {
        // The cornice: a fillet and a crown, each further out than the last,
        // with a length fallen out of it.
        const cy = y0 + sanctH - CORNICE;
        const gap0 = x0 + 1 + rnd() * (x1 - x0 - 3);
        for (const [a, c] of carve(x0 - 0.12, x1 + 0.12, sg > 0 ? [[gap0, gap0 + 0.9 + rnd() * 0.8]] : [])) {
          courses(a, c, 0.9, 1.5, rnd, (u0, u1) => {
            const um = (u0 + u1) / 2;
            flat(b, true, plane, sg, um, cy + 0.05, u1 - u0 - TEMPLE_JOINT, 0.1, 0.22, 0.06 - 0.11, templeTone(rnd, 0.3));
            flat(b, true, plane, sg, um, cy + 0.2, u1 - u0 - TEMPLE_JOINT, 0.2, 0.3, 0.12 - 0.15, SANDSTONE);
          });
        }
      }
    }
    // The core, behind all of it and emitted after it.
    {
      const coreD = 0.5 - 2 * 0.04;
      const cy0 = y0 - 0.02;
      if (ruined) {
        b.box(x1 - x0, sanctH, coreD, (x0 + x1) / 2, cy0 + sanctH / 2, wallZ, DARK_STONE);
      } else {
        for (const s of [-1, 1]) {
          const a = s * (doorW / 2);
          const c = s * half[2].x;
          b.box(Math.abs(c - a), sanctH, coreD, (a + c) / 2, cy0 + sanctH / 2, wallZ, DARK_STONE);
        }
        b.box(doorW, sanctH - doorH, coreD, 0, y0 + doorH + (sanctH - doorH) / 2, wallZ, DARK_STONE);
      }
    }
    // The ends: toothed where the wall ran on, one pair of courses in two.
    for (const [end, dir] of [
      [x0, -1],
      [x1, 1],
    ] as const) {
      for (let k = 0; k < nRows; k += 2) {
        const reach = 0.28 + rnd() * 0.12;
        const ry = y0 + PLINTH + (k + 0.5) * rowH;
        b.box(reach, rowH - TEMPLE_JOINT, 0.46, end + (dir * reach) / 2, ry, wallZ, templeTone(rnd, 0.4));
      }
      for (let k = 0; k < 3; k++) {
        const x = end + dir * (0.6 + rnd() * 1.2);
        const z = wallZ + (rnd() - 0.5) * 1.6;
        const onTop = Math.abs(x) < half[2].x - 0.3 && Math.abs(z) < half[2].z - 0.3;
        fallen(b, x, onTop ? top(2) : top(1), z, 0.5 + rnd() * 0.3, rnd, templeTone(rnd, 0.4));
      }
    }
    // The head. The standing wall keeps a coping, and where the vault that
    // sprang from it has not all come down, a course or two of it; the ruined
    // one is broken off, a stone or two left on it here and there. Either way
    // everything stands ON the collider's top, never under it.
    {
      const headY = y0 + sanctH;
      if (!ruined) {
        courses(x0 - 0.1, x1 + 0.1, 0.9, 1.4, rnd, (u0, u1) => {
          b.box(u1 - u0 - TEMPLE_JOINT, 0.08, 0.72, (u0 + u1) / 2, headY + 0.04, wallZ, STONE);
        });
      }
      const hy = headY + (ruined ? 0 : 0.08);
      for (let s = 0; s < 3; s++) {
        const len = 1.2 + rnd() * 2;
        const u = x0 + 0.6 + rnd() * (x1 - x0 - 1.2 - len);
        if (Math.abs(u + len / 2 - figX) < 1.5 + len / 2) continue;
        if (!ruined && Math.abs(u + len / 2) < 2 + len / 2) continue;
        let yy = hy;
        const rows = 1 + Math.floor(rnd() * (ruined ? 2 : 3));
        for (let k = 0; k < rows; k++) {
          const lean = k * 0.06;
          const l = len - k * (0.4 + rnd() * 0.4);
          if (l < 0.4) break;
          courses(u + k * 0.25, u + k * 0.25 + l, 0.4, 0.9, rnd, (u0, u1) => {
            if (rnd() < 0.2) return;
            b.box(u1 - u0 - TEMPLE_JOINT, 0.34, 0.46 - lean * 2, (u0 + u1) / 2, yy + 0.17, wallZ + (rnd() - 0.5) * 0.03, templeTone(rnd, 0.35));
          });
          yy += 0.34;
        }
        moss(b, u + len * 0.3, hy + 0.01, wallZ, 0.18, rnd);
        fern(b, u + len * 0.7, hy, wallZ, 0.5 + rnd() * 0.3, rnd);
      }
    }

    if (!ruined) {
      // The doorway: jambs through the wall, a threshold, and a lintel carved
      // with a face and the garlands swagging out of its mouth.
      for (const s of [-1, 1]) {
        b.box(0.26, doorH, 0.62, s * (doorW / 2 + 0.13), y0 + doorH / 2, wallZ, SANDSTONE);
      }
      b.box(doorW + 0.52, 0.1, 0.66, 0, y0 + 0.05, wallZ, STONE);
      const lTop = y0 + sanctH - 0.3;
      const ly = (y0 + doorH + lTop) / 2;
      b.box(LINTEL_HALF * 2, lTop - (y0 + doorH), 0.64, 0, ly, wallZ, SANDSTONE);
      for (const sg of [-1, 1]) {
        const plane = sg < 0 ? zS - 0.07 : zN + 0.07;
        flat(b, true, plane, sg, 0, ly + 0.22, LINTEL_HALF * 2 - 0.1, 0.05, 0.03, 0.01, STONE);
        flat(b, true, plane, sg, 0, ly - 0.22, LINTEL_HALF * 2 - 0.1, 0.05, 0.03, 0.01, STONE);
        if (sg < 0) {
          // The kala's face: brow, eyes and the jaw the garlands leave from.
          flat(b, true, plane, sg, 0, ly + 0.07, 0.34, 0.08, 0.04, 0.02, STONE);
          for (const e of [-1, 1]) flat(b, true, plane, sg, e * 0.08, ly - 0.01, 0.07, 0.06, 0.04, 0.03, DARK_STONE);
          flat(b, true, plane, sg, 0, ly - 0.11, 0.26, 0.06, 0.04, 0.02, STONE);
          for (const e of [-1, 1]) {
            for (let k = 0; k < 7; k++) {
              const t = (k + 0.5) / 7;
              const u = e * (0.2 + t * (doorW / 2 + 0.2));
              const yy = ly - 0.06 - Math.sin(Math.PI * t) * 0.1;
              flat(b, true, plane, sg, u, yy, 0.13, 0.06, 0.03, 0.02, STONE, e * Math.cos(Math.PI * t) * -0.5);
            }
          }
        }
        // The colonnettes either side: octagonal, ringed at foot and head.
        for (const e of [-1, 1]) {
          const cx = e * (doorW / 2 + 0.26 + 0.14);
          const cz = plane + sg * 0.1;
          b.box(0.26, 0.14, 0.26, cx, y0 + 0.07, cz, STONE);
          b.cyl(doorH - 0.28, 0.17, 0.19, 8, cx, y0 + doorH / 2, cz, SANDSTONE);
          for (const f of [0.12, 0.2, 0.5, 0.8, 0.88]) b.cyl(0.04, 0.23, 0.23, 8, cx, y0 + doorH * f, cz, STONE);
          b.box(0.28, 0.14, 0.28, cx, y0 + doorH - 0.07, cz, STONE);
        }
      }

      // The blind windows: a moulded frame, a row of turned balusters, and
      // the stone blind half lowered over them.
      if (windows) {
        for (const e of [-1, 1]) {
          const cx = e * winX;
          for (const sg of [-1, 1]) {
            const plane = sg < 0 ? zS : zN;
            const broken = sg > 0 && e > 0;
            flat(b, true, plane, sg, cx, (winY0 + winY1) / 2, winW, winY1 - winY0, 0.1, -0.08, DARK_STONE);
            flat(b, true, plane, sg, cx, winY0 - 0.06, winW + 0.3, 0.12, 0.16, 0.03, STONE);
            flat(b, true, plane, sg, cx, winY1 + 0.07, winW + 0.3, 0.14, 0.14, 0.03, STONE);
            for (const f of [-1, 1]) flat(b, true, plane, sg, cx + f * (winW / 2 + 0.06), (winY0 + winY1) / 2, 0.14, winY1 - winY0, 0.14, 0.03, SANDSTONE);
            const blind = (winY1 - winY0) * 0.34;
            flat(b, true, plane, sg, cx, winY1 - blind / 2, winW, blind, 0.06, -0.01, SANDSTONE);
            for (let k = 1; k < 4; k++) flat(b, true, plane, sg, cx, winY1 - (k * blind) / 4, winW, 0.025, 0.03, 0.03, STONE);
            const bz = plane + sg * -0.02;
            const by0 = winY0;
            const by1 = winY1 - blind;
            const n = 5;
            for (let k = 0; k < n; k++) {
              const bx = cx - winW / 2 + ((k + 0.5) * winW) / n;
              if (broken && k === 3) continue;
              const bh = broken && k === 1 ? (by1 - by0) * 0.45 : by1 - by0;
              b.cyl(bh, 0.1, 0.1, 8, bx, by0 + bh / 2, bz, SANDSTONE);
              for (const f of [0.18, 0.5, 0.82]) {
                if (f * (by1 - by0) > bh) continue;
                b.cyl(0.05, 0.15, 0.15, 8, bx, by0 + f * (by1 - by0), bz, STONE);
              }
            }
          }
        }
      }

      // The pediment over the door, framed by a naga: its body along both
      // rakes, flames along its back, its hoods fanned out at either foot.
      {
        const PW = 3.4;
        const PR = 1.35;
        const py = wallTop + 0.08;
        b.gableEnd(PW, PR, 0.3, 0, py, wallZ, SANDSTONE);
        // A seated figure in the tympanum.
        for (const sg of [-1, 1]) {
          const plane = wallZ + sg * 0.15;
          flat(b, true, plane, sg, 0, py + 0.18, 0.44, 0.14, 0.03, 0.012, STONE);
          flat(b, true, plane, sg, 0, py + 0.37, 0.2, 0.26, 0.03, 0.012, STONE);
          flat(b, true, plane, sg, 0, py + 0.57, 0.11, 0.13, 0.03, 0.012, STONE);
          flat(b, true, plane, sg, 0, py + 0.69, 0.05, 0.1, 0.03, 0.012, STONE);
        }
        for (const e of [-1, 1]) {
          const foot: Point3 = [e * (PW / 2 + 0.1), py + 0.12, wallZ];
          const apex: Point3 = [0, py + PR + 0.12, wallZ];
          slab(b, foot, apex, 0.42, 0.2, STONE);
          // Flames along its back.
          const n = 6;
          for (let k = 1; k < n; k++) {
            const t = k / n;
            const px = foot[0] + (apex[0] - foot[0]) * t;
            const pyy = foot[1] + (apex[1] - foot[1]) * t + 0.14;
            b.box(0.09, 0.26, 0.28, px, pyy, wallZ, SANDSTONE, { z: e * -0.5 });
          }
          // The hoods: five heads fanned up and out from the foot.
          for (let k = 0; k < 5; k++) {
            const a = (e > 0 ? 0 : Math.PI) + e * (0.35 + k * 0.28);
            const hx = foot[0] + e * 0.12 + Math.cos(a) * 0.12;
            const hy = foot[1] + 0.1 + Math.sin(a) * 0.18 + k * 0.03;
            b.box(0.12, 0.34, 0.32, hx, hy, wallZ, k % 2 ? SANDSTONE : STONE, { z: -(a - Math.PI / 2) * 0.8 });
          }
          b.box(0.34, 0.2, 0.4, e * (PW / 2 + 0.22), py + 0.06, wallZ, STONE);
        }
        // The finial.
        b.cyl(0.4, 0.04, 0.16, 6, 0, py + PR + 0.42, wallZ, STONE);
        b.box(0.24, 0.12, 0.36, 0, py + PR + 0.2, wallZ, SANDSTONE);
      }
    } else {
      // The pediment fell forward and lies face up in front of what is left.
      const m = b.gableEnd(2.9, 1.15, 0.28, -half[2].x * 0.4 + 0.3, top(2) + 0.1, zS - 1.1, SANDSTONE);
      m.rotation.set(-Math.PI / 2 + 0.05, 0.25, 0.03);
      for (let k = 0; k < 4; k++) fallen(b, -half[2].x * 0.4 + (rnd() - 0.5) * 3, top(2), zS - 0.7 - rnd() * 1.2, 0.5, rnd, templeTone(rnd, 0.3));
    }

    // Creeper down the outer face from the head, and a little on the inner.
    hang(b, true, zN, 1, x0 + 0.5, x0 + 0.5 + (x1 - x0) * 0.3, y0 + sanctH - 0.02 - (ruined ? 0 : 0.1), sanctH * 0.8, y0 + 0.4, ruined ? 0.04 : 0.17, rnd);
    if (!ruined) {
      hang(b, true, zN, 1, 1.4, winX + 0.9, y0 + sanctH - 0.12, sanctH * 0.55, winY1 + 0.25, 0.17, rnd);
      hang(b, true, zS, -1, -winX - 0.7, -winX + 0.8, y0 + sanctH - 0.12, 0.6, winY1 + 0.2, 0.17, rnd);
    }
  }

  // ---- the fig: a strangler rooted in the top of the wall.
  {
    const B: Point3 = [figX, wallTop + 0.05, wallZ];
    const Fk: Point3 = [figX + figDir * 1.0, wallTop + 5.0, wallZ + 1.1];
    const lerp = (t: number): Point3 => [B[0] + (Fk[0] - B[0]) * t, B[1] + (Fk[1] - B[1]) * t, B[2] + (Fk[2] - B[2]) * t];
    limb(b, [B[0], B[1] + 0.3, B[2]], Fk, 0.95, 0.55, FIG_BARK, 7);
    // Three stems braided round the core, the strangler's own trunk.
    for (let k = 0; k < 3; k++) {
      const pts: Point3[] = [];
      for (let s = 0; s <= 6; s++) {
        const t = s / 6;
        const a = (k * 2 * Math.PI) / 3 + t * 4.4;
        const r = 0.46 - 0.16 * t;
        const c = lerp(t);
        pts.push([c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]);
      }
      rope(b, pts, 0.36, 0.22, FIG_BARK);
    }
    // Buttresses gripping the head, either way along it.
    for (const e of [-1, 1]) {
      rope(b, [
        [figX + e * 0.1, wallTop + 1.1, wallZ],
        [figX + e * 0.7, wallTop + 0.35, wallZ + (rnd() - 0.5) * 0.1],
        [figX + e * 1.3, wallTop + 0.12, wallZ],
      ], 0.34, 0.14, FIG_BARK);
    }
    figRoots.forEach((path, k) => rope(b, path, figR[k][0], figR[k][1], FIG_BARK));
    // Thinner ones netted between them down the faces.
    for (const sg of [-1, 1]) {
      const plane = sg < 0 ? zS - 0.05 : zN + 0.05;
      for (let k = 0; k < 2; k++) {
        const x = figX + figDir * (rnd() - 0.3) * 1.2;
        rope(b, [
          [x, wallTop - 0.3, plane + sg * 0.08],
          [x + (rnd() - 0.5) * 0.8, top(2) + sanctH * 0.5, plane],
          [x + (rnd() - 0.5) * 0.8, top(2) + 0.3, plane + sg * 0.12],
        ], 0.08, 0.05, FIG_BARK, 5);
      }
    }

    // The crown: limbs out of the fork, and the forest's own leaf on them.
    const C: Point3 = [Fk[0] + figDir * 0.6, Fk[1] + 2.2, Fk[2] + 0.7];
    limb(b, Fk, [Fk[0] + figDir * 2.3, Fk[1] + 1.7, Fk[2] + 1.0], 0.42, 0.18, FIG_BARK);
    limb(b, Fk, [Fk[0] - figDir * 0.9, Fk[1] + 2.3, Fk[2] + 1.5], 0.38, 0.16, FIG_BARK);
    limb(b, Fk, [Fk[0] + figDir * 0.7, Fk[1] + 2.6, Fk[2] - 0.8], 0.38, 0.16, FIG_BARK);
    const low0: Point3 = lerp(0.72);
    const low1: Point3 = [Fk[0] + figDir * 2.6, Fk[1] - 0.6, Fk[2] + 2.3];
    limb(b, low0, low1, 0.3, 0.12, FIG_BARK);
    // Aerial roots off the low limb, over the north terraces and clear of
    // every head on them.
    for (let k = 0; k < 4; k++) {
      const f = 0.35 + k * 0.18 + rnd() * 0.06;
      const hang0: Point3 = [low0[0] + (low1[0] - low0[0]) * f, low0[1] + (low1[1] - low0[1]) * f - 0.05, low0[2] + (low1[2] - low0[2]) * f];
      const foot = Math.max(top(2) + 2.5, top(1) + 3.5, hang0[1] - 1.5 - rnd() * 1.8);
      limb(b, hang0, [hang0[0] + (rnd() - 0.5) * 0.2, foot, hang0[2] + (rnd() - 0.5) * 0.2], 0.06, 0.035, FIG_BARK, 5);
    }
    const trans = TRANSLUCENCY.canopy;
    const plates: [number, number, number, number, number][] = [
      // count, height over C, width, depth, thickness
      [4, 0, 6.6, 2.8, 0.5],
      [3, 0.8, 5.0, 2.4, 0.42],
    ];
    plates.forEach(([count, dy, pw, pd, pt], tier) => {
      const turn = rnd() * Math.PI * 2;
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2 + turn + rnd() * 0.3;
        marksSway(
          b.translucentBox(pw, pt, pd, C[0], C[1] + dy, C[2], tier === 0 ? FIG_LEAF : FIG_LEAF_LIT, trans, {
            x: (rnd() - 0.5) * 0.18,
            y: a,
            z: (rnd() - 0.5) * 0.26,
          }),
          "canopy",
        );
      }
    });
    const turn = rnd() * Math.PI * 2;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + turn + rnd() * 0.25;
      const droop = -(0.3 + rnd() * 0.16);
      const base = stepAlong([C[0], C[1] - 0.2, C[2]], heading(a, 0), 0.5);
      const tip = stepAlong(base, heading(a, droop), 3.2);
      const end = stepAlong(tip, heading(a, droop - 0.6 - rnd() * 0.3), 2.5);
      for (const [p0, p1, bw] of [
        [base, tip, 1.6],
        [tip, end, 1.15],
      ] as const) {
        const o = orient(p0, p1);
        marksSway(b.translucentBox(bw, 0.14, o.len, o.mid[0], o.mid[1], o.mid[2], FIG_LEAF, trans, o.rot), "canopy");
      }
    }
    fern(b, low0[0], low0[1] + 0.12, low0[2], 0.9, rnd);
  }

  // ---- the cores: three nested solid boxes, each placed by its top face and
  // reaching down to one footing under the lowest ground round the temple.
  // Emitted LAST, behind the facing and the paving that hide them.
  {
    let low = -TIER_BURY;
    for (const [sx, sz] of [
      [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0],
    ]) {
      low = Math.min(low, ground(sx * half[0].x, sz * half[0].z) - 0.2);
    }
    for (let i = 0; i < 3; i++) {
      const yt = top(i) - 0.03;
      const h = yt - low;
      b.box((half[i].x - CORE_BACK) * 2, h, (half[i].z - CORE_BACK) * 2, 0, yt - h / 2, 0, DARK_STONE);
    }
  }
  return b;
}
