/**
 * kit/structures/well.ts — buildWell: the draw-well, its coursed drum and its
 * head frame.
 * Part of the structures set: follows the contract in kit/core.ts, and the
 * cover heights and round-collider rule in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  convexSolid,
  limb,
  rope,
  slab,
  type BuildCtx,
  type BuildParams,
  type Structure,
  type Point3,
  streetSeed,
  DARK_STONE,
  IRON,
  MOSS_STONE,
  PITCH,
  PLANK,
  STONE,
  STRAW,
  TIMBER,
} from "../core";

/**
 * Draw-well: a battered drum of coursed stone on a paved foot, capped by a
 * ring of dressed coping stones, with a timber head frame over the mouth that
 * carries a windlass and a small shingled roof. The Square's centrepiece.
 *
 * **It is built the way one is built.** The well it replaces was one grey
 * cylinder with a dark disc on it and a plank laid flat across two posts. So
 * the drum is laid in six courses of squared stones, broken joint, over a
 * rubble core set back behind them, so every joint is a real step the ink
 * finds; the coping is twelve wedge stones weathered off at the outer edge and
 * cramped across some of their joints; and the foot is a ring of flags the
 * drum stands in. The two posts are bedded down through the coping and each
 * carries a gable frame — a tie beam through the post knee-braced to it, a
 * pair of rafters from its ends to the ridge, the triangle boarded behind the
 * timbers so the frame stands proud of it. Eave plates and purlins span gable to gable, and the
 * roof is riven shingles on a board deck, each course tipped out at its butt,
 * under a ridge roll and bargeboards. Between the posts the windlass turns on
 * iron gudgeons, rope coiled round it and running down to a coopered bucket
 * hung in the mouth, cranked from one side. Half the mouth is closed by a
 * boarded lid.
 *
 * **The collider is the drum, not a square drawn round it.** It was one
 * 3.4 m box, so on the diagonals it stood 0.7 m proud of the stone and a round
 * stopped on open air — the haystack's and the kiln's bug. It is a
 * dodecagon now, with an apothem of `DRUM` and corners at 1.656 m, built as
 * the union of six bars turned 30° apart, each 2 x `DRUM` long and one side
 * wide (three crossed SQUARES are a twelve-pointed star reaching 2.26 m, which
 * is worse than the square they replace). It sits inside the drawn faces
 * everywhere (18 stones on 1.60-1.66 m) and never more than ~5 cm short of
 * them, which is the side of the trade a round clipping the stone is on
 * rather than one stopping in the air. Still 1.5 m and still first. Every part obeys the three rules: the drum and the
 * coping are its silhouette, the flags round the foot are 7 cm high, and
 * everything else stands on its top — the mouth is a black disc laid ON it
 * rather than a shaft cut into it, so a round that stops there stops on what
 * is drawn.
 *
 * **Which half the lid covers, which side the crank is on, how the stones
 * are laid and weathered and whether a pail stands on the lid are seeded off
 * where it stands** (`streetSeed`), and the foot flags are carried down to
 * the ground under each — which is what puts it in `CONFORMS_TO_TERRAIN`.
 */
export function buildWell(
  scene: Scene,
  mats: CelMaterialFactory,
  _p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "well");
  // ---- the collider: the drum, as a dodecagon — the union of six bars, each
  // reaching a pair of opposite flats and exactly as wide as one side, so its
  // corners are the polygon's own. Squares would make a star.
  const DRUM = 1.6;
  const SIDES = 12;
  for (let k = 0; k < SIDES / 2; k++) {
    b.block({ w: 2 * DRUM, h: 1.5, d: 2 * DRUM * Math.tan(Math.PI / SIDES), x: 0, y: 0.75, z: 0, rotY: (2 * k * Math.PI) / SIDES });
  }

  // Seeded on the footprint the collider used to be, so the drawing did not re-roll with it.
  const rnd = mulberry32(streetSeed(3.4, 3.4, 1.5, ctx));
  /** Which half of the mouth the lid covers (+Z or -Z) and the crank's side. */
  const lidSide = rnd() < 0.5 ? 1 : -1;
  const crankSide = rnd() < 0.5 ? 1 : -1;

  /** The floor under a local point, as a local height — the stall's reading. */
  const ground = (lx: number, lz: number): number => {
    if (!ctx || Math.abs(ctx.y - ctx.floor) > 0.05) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    const h = ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
    return Math.max(-0.4, Math.min(0.4, h));
  };
  const at = (r: number, a: number, y: number): Point3 => [r * Math.sin(a), y, r * Math.cos(a)];

  // ---- the numbers everything hangs off.
  /** The drum's face at the foot and under the coping: a batter of 6 cm. */
  const R_FOOT = 1.66;
  const R_HEAD = 1.6;
  /** The coping's bed (the collider's top, less 2 cm of mortar) and its top. */
  const BED = 1.48;
  const COPE = 1.68;
  /** The mouth's radius at the coping's inner edge. */
  const MOUTH = 1.12;
  /** The flags round the foot: their top, and how far out they come. */
  const FOOT_TOP = 0.07;
  const FOOT_OUT = 1.84;
  /** Posts: centred on x = ±POST_X, square POST. */
  const POST_X = 1.3;
  const POST = 0.24;
  /** The tie beam's centre, the ridge's top, and the eave's reach in z. */
  const TIE_Y = 3.56;
  const RIDGE_Y = 4.62;
  const EAVE_Z = 1.22;
  const VERGE_X = 1.72;
  /** The windlass's axis. */
  const AXLE_Y = 2.46;

  // ---- the foot: a ring of flags the drum stands in, weathered off outward.
  {
    const n = 14;
    const gap = 0.025;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2 + gap / FOOT_OUT;
      const a1 = ((k + 1) / n) * Math.PI * 2 - gap / FOOT_OUT;
      const g = Math.min(ground(FOOT_OUT * Math.sin(a0), FOOT_OUT * Math.cos(a0)), ground(FOOT_OUT * Math.sin(a1), FOOT_OUT * Math.cos(a1)), 0);
      const bot = g - 0.08;
      const lift = (rnd() - 0.5) * 0.02;
      const inner = R_FOOT - 0.1;
      convexSolid(
        b,
        [at(inner, a0, bot), at(FOOT_OUT, a0, bot), at(FOOT_OUT, a1, bot), at(inner, a1, bot)],
        [at(inner, a0, FOOT_TOP + lift), at(FOOT_OUT, a0, FOOT_TOP - 0.03 + lift), at(FOOT_OUT, a1, FOOT_TOP - 0.03 + lift), at(inner, a1, FOOT_TOP + lift)],
        rnd() < 0.2 ? DARK_STONE : STONE,
      );
    }
  }

  // ---- the drum: six courses of squared stone, broken joint, faces a little
  // irregular, the odd one fallen back where its face spalled.
  {
    const n = 18;
    const courses = 6;
    const rise = (BED - FOOT_TOP) / courses;
    const deep = 0.22;
    for (let c = 0; c < courses; c++) {
      const y0 = FOOT_TOP + c * rise;
      const t = (c + 0.5) / courses;
      const rFace = R_FOOT + (R_HEAD - R_FOOT) * t;
      const side = 2 * rFace * Math.tan(Math.PI / n);
      const offset = c % 2 === 0 ? 0 : 0.5;
      for (let k = 0; k < n; k++) {
        const a = ((k + offset + (rnd() - 0.5) * 0.06) / n) * Math.PI * 2;
        const w = side - 0.025 - rnd() * 0.03;
        const h = rise - 0.02 - rnd() * 0.012;
        const spalled = rnd() < 0.07;
        const face = rFace + (rnd() - 0.5) * 0.02 - (spalled ? 0.035 : 0);
        const r = face - deep / 2;
        const color = spalled || rnd() < 0.14 ? DARK_STONE : c < 2 && rnd() < 0.3 ? MOSS_STONE : STONE;
        b.box(w, h, deep, r * Math.sin(a), y0 + 0.01 + h / 2, r * Math.cos(a), color, { y: a });
      }
    }
    // The core behind them, emitted after what hides it; the joints show it 5-9 cm back.
    // Its top stops short of the mouth's disc, which is a different colour.
    const core = (r: number): number => (2 * (r - 0.05)) / Math.cos(Math.PI / n);
    const coreTop = BED - 0.02;
    b.cyl(coreTop - FOOT_TOP + 0.02, core(R_HEAD), core(R_FOOT), n, 0, (coreTop + FOOT_TOP - 0.02) / 2, 0, DARK_STONE);
  }

  // ---- the coping: twelve wedge stones weathered off at the outer arris,
  // cramped across some of their joints.
  {
    const n = 12;
    const rOut = R_HEAD + 0.08;
    const gap = 0.022;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2 + gap / rOut;
      const a1 = ((k + 1) / n) * Math.PI * 2 - gap / rOut;
      const top = COPE + (rnd() - 0.5) * 0.012;
      convexSolid(
        b,
        [at(MOUTH, a0, BED), at(rOut, a0, BED), at(rOut, a1, BED), at(MOUTH, a1, BED)],
        [at(MOUTH, a0, top), at(rOut - 0.05, a0, top), at(rOut - 0.05, a1, top), at(MOUTH, a1, top)],
        rnd() < 0.25 ? DARK_STONE : STONE,
      );
      if (rnd() < 0.5) {
        const aj = ((k + 1) / n) * Math.PI * 2;
        const rj = (MOUTH + rOut) / 2;
        b.box(0.14, 0.012, 0.035, rj * Math.sin(aj), COPE + 0.012, rj * Math.cos(aj), IRON, { y: aj });
      }
    }
  }

  // ---- the mouth: the dark of the shaft, laid on the collider's top.
  b.cyl(0.02, (2 * (MOUTH + 0.04)) / Math.cos(Math.PI / 12), (2 * (MOUTH + 0.04)) / Math.cos(Math.PI / 12), 12, 0, 1.495, 0, PITCH, { y: Math.PI / 12 });

  // ---- the head frame. Everything on the roof is measured off one plane
  // through the ridge: the deck's underside, falling `DROP` over `EAVE_Z`.
  const DROP = RIDGE_Y + 0.02 - (TIE_Y + 0.14);
  const deckY = (z: number): number => RIDGE_Y + 0.02 - (Math.abs(z) / EAVE_Z) * DROP;
  for (const sx of [-1, 1]) {
    const x = sx * POST_X;
    // The post, bedded down through the coping into the drum.
    b.box(POST, RIDGE_Y - 0.18 - 1.2, POST, x, (RIDGE_Y - 0.18 + 1.2) / 2, 0, TIMBER);
    // The tie beam through it, and the rafters from its ends to the ridge.
    b.box(0.16, 0.18, 2.16, x, TIE_Y, 0, TIMBER);
    for (const sz of [-1, 1]) {
      slab(b, [x, deckY(1.06) - 0.07, sz * 1.06], [x, deckY(0.02) - 0.07, sz * 0.02], 0.14, 0.13, TIMBER);
      // Knee brace, post to tie.
      slab(b, [x, TIE_Y - 0.55, sz * (POST / 2 - 0.01)], [x, TIE_Y - 0.06, sz * 0.52], 0.1, 0.09, TIMBER);
    }
    // The gable, boarded behind the frame so the post, the tie and the
    // rafters stand proud of it: vertical boards raked off to the rafters.
    const xa = x - sx * (POST / 2 + 0.005);
    const xb = xa - sx * 0.025;
    const boards = 8;
    const span = 2.04;
    const bot = TIE_Y;
    for (let i = 0; i < boards; i++) {
      const z0 = -span / 2 + (i * span) / boards + 0.006;
      const z1 = -span / 2 + ((i + 1) * span) / boards - 0.006;
      const t0 = deckY(z0) - 0.12;
      const t1 = deckY(z1) - 0.12;
      const face = (fx: number): Point3[] => [[fx, bot, z0], [fx, bot, z1], [fx, t1, z1], [fx, t0, z0]];
      convexSolid(b, face(xa), face(xb), PLANK);
    }
  }
  // The ridge beam on the post heads, and the eave plates and purlins.
  b.box(2 * VERGE_X - 0.08, 0.2, 0.16, 0, RIDGE_Y - 0.18, 0, TIMBER);
  for (const sz of [-1, 1]) {
    for (const f of [0.86, 0.45]) {
      const z = sz * f * EAVE_Z;
      b.box(2 * VERGE_X - 0.1, 0.1, 0.1, 0, deckY(z) - 0.06, z, TIMBER);
    }
  }

  // ---- the roof: a board deck, riven shingles in tipped courses, a ridge
  // roll, bargeboards.
  {
    const L = Math.hypot(DROP, EAVE_Z);
    for (const sz of [-1, 1]) {
      // Down the slope and out of it, on this side.
      const dz = (sz * EAVE_Z) / L;
      const dy = -DROP / L;
      const nz = (sz * DROP) / L;
      const ny = EAVE_Z / L;
      const on = (x: number, s: number, lift: number): Point3 => [x, RIDGE_Y + 0.02 + dy * s + ny * lift, dz * s + nz * lift];
      // The deck.
      slab(b, on(0, 0, 0.02), on(0, L, 0.02), 2 * VERGE_X - 0.06, 0.04, PLANK);
      // The shingles, from the eave up, so each course laps the one below;
      // every other course starts on a half-width one so the joints break.
      const expose = 0.27;
      const courses = Math.ceil((L - 0.05) / expose);
      for (let c = 0; c < courses; c++) {
        const butt = L + 0.04 - c * expose;
        const head = Math.max(0.02, butt - expose * 1.7);
        let x = -VERGE_X;
        let first = true;
        while (x < VERGE_X - 0.01) {
          const want = first && c % 2 === 1 ? 0.1 + rnd() * 0.05 : 0.22 + rnd() * 0.13;
          first = false;
          const w = Math.min(want, VERGE_X - x);
          const xc = x + w / 2;
          const tail = butt + (rnd() - 0.5) * 0.03;
          slab(b, on(xc, head, 0.05), on(xc, tail, 0.08), w - 0.018, 0.022, rnd() < 0.2 ? PLANK : TIMBER);
          x += w;
        }
      }
      // Bargeboards at both verges.
      for (const sx of [-1, 1]) {
        const top = on(sx * (VERGE_X + 0.02), 0, 0.02);
        const foot = on(sx * (VERGE_X + 0.02), L + 0.04, 0.02);
        slab(b, [top[0], top[1] - 0.02, top[2]], [foot[0], foot[1] - 0.02, foot[2]], 0.035, 0.2, TIMBER);
      }
    }
    // The ridge roll, and a knob at either end.
    b.cyl(2 * VERGE_X + 0.08, 0.13, 0.13, 6, 0, RIDGE_Y + 0.1, 0, TIMBER, { z: Math.PI / 2 });
    for (const sx of [-1, 1]) b.box(0.08, 0.2, 0.08, sx * (VERGE_X + 0.03), RIDGE_Y + 0.2, 0, TIMBER);
  }

  // ---- the windlass: a log roller on iron gudgeons through the posts, iron
  // bands at its ends, rope coiled round it, cranked from one side.
  const inner = POST_X - POST / 2;
  b.cyl(2 * inner - 0.04, 0.26, 0.26, 8, 0, AXLE_Y, 0, TIMBER, { z: Math.PI / 2 });
  for (const sx of [-1, 1]) {
    b.cyl(0.05, 0.285, 0.285, 8, sx * (inner - 0.06), AXLE_Y, 0, IRON, { z: Math.PI / 2 });
    b.cyl(0.02, 0.2, 0.2, 8, sx * (POST_X + POST / 2 + 0.01), AXLE_Y, 0, IRON, { z: Math.PI / 2 });
  }
  const coilX = -crankSide * 0.25;
  for (let i = 0; i < 5; i++) {
    b.cyl(0.034, 0.3, 0.3, 8, coilX - 0.08 + i * 0.038, AXLE_Y, 0, STRAW, { z: Math.PI / 2 });
  }
  // The crank: the gudgeon run on out, an arm down from it, a handle out from that.
  {
    const x0 = crankSide * (POST_X + POST / 2);
    const armX = crankSide * (POST_X + POST / 2 + 0.1);
    const ang = rnd() * Math.PI * 2;
    const reach = 0.36;
    const hy = AXLE_Y - Math.cos(ang) * reach;
    const hz = Math.sin(ang) * reach;
    b.cyl(0.14, 0.05, 0.05, 6, (x0 + armX) / 2, AXLE_Y, 0, IRON, { z: Math.PI / 2 });
    slab(b, [armX, AXLE_Y, 0], [armX, hy, hz], 0.03, 0.05, IRON);
    b.cyl(0.24, 0.05, 0.05, 6, armX + crankSide * 0.13, hy, hz, TIMBER, { z: Math.PI / 2 });
  }

  // ---- the bucket, hung in the open half of the mouth: coopered staves (the
  // facets), two iron hoops, the water's dark in it, an iron bail.
  {
    const bz = -lidSide * 0.42;
    const bx = coilX;
    const by = 1.62;
    const bh = 0.34;
    b.cyl(bh, 0.36, 0.3, 10, bx, by + bh / 2, bz, PLANK);
    for (const f of [0.18, 0.8]) {
      const dd = 0.3 + 0.06 * f + 0.02;
      b.cyl(0.035, dd, dd, 10, bx, by + f * bh, bz, IRON);
    }
    b.cyl(0.01, 0.32, 0.32, 10, bx, by + bh - 0.05, bz, PITCH);
    const top = by + bh;
    rope(b, [[bx - 0.17, top, bz], [bx - 0.12, top + 0.13, bz], [bx, top + 0.18, bz], [bx + 0.12, top + 0.13, bz], [bx + 0.17, top, bz]], 0.018, 0.018, IRON, 5);
    // The rope, off the roller's side to the bail.
    limb(b, [bx, AXLE_Y, -lidSide * 0.13], [bx, top + 0.18, bz], 0.03, 0.03, STRAW, 5);
  }

  // ---- the lid: boards across the covered half, cut to the coping and
  // ledged by two battens; the first board stopped short of the posts.
  {
    const R = MOUTH + 0.26;
    const boards = 6;
    const z0 = 0.13;
    const bw = (R - 0.02 - z0) / boards;
    for (let i = 0; i < boards; i++) {
      const za = z0 + i * bw;
      const zc = za + bw / 2;
      const zFar = za + bw;
      let len = 2 * Math.sqrt(Math.max(0, R * R - zFar * zFar));
      if (za < POST / 2 + 0.03) len = Math.min(len, 2 * (inner - 0.02));
      if (len < 0.2) continue;
      b.box(len, 0.03, bw - 0.012, (rnd() - 0.5) * 0.03, COPE + 0.03, lidSide * zc, PLANK);
    }
    for (const sx of [-1, 1]) {
      b.box(0.1, 0.035, R - z0 - 0.2, sx * 0.45, COPE + 0.063, lidSide * (z0 + (R - z0 - 0.2) / 2 + 0.03), TIMBER);
    }
    // A pail stood on it, sometimes.
    if (rnd() < 0.5) {
      const px = (rnd() < 0.5 ? -1 : 1) * 0.72;
      const pz = lidSide * 0.62;
      const py = COPE + 0.045;
      b.cyl(0.28, 0.3, 0.26, 10, px, py + 0.14, pz, PLANK);
      b.cyl(0.03, 0.315, 0.315, 10, px, py + 0.22, pz, IRON);
      b.cyl(0.01, 0.27, 0.27, 10, px, py + 0.24, pz, PITCH);
    }
  }
  return b;
}
