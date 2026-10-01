/**
 * kit/structures/stall.ts — buildStall: the market stall and the wares laid out
 * on it.
 * Part of the structures set: follows the contract in kit/core.ts, and the
 * cover heights and round-collider rule in `./index.ts`.
 */
import { Matrix, Scene, type Mesh } from "@babylonjs/core";
import { CONFIG } from "../../../config";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  streetSeed,
  AWNING,
  BRICK,
  CREEPER,
  DIRT,
  ENAMEL,
  IRON,
  PLANK,
  RUST,
  SAILCLOTH,
  STRAW,
  THATCH,
  TIMBER,
} from "../core";
import { reframe, cartSack } from "./cartParts";

const TRANSLUCENCY = CONFIG.graphics.translucency;

/**
 * Market stall: a boarded counter under a pitched canvas on a timber frame,
 * laid out with one trade's goods. Waist-high cover. Counter along X, the
 * customer's side at -Z and the stallholder's at +Z.
 *
 * **It is built the way one is built.** The stall it replaces was a plank box
 * with four poles and a flat lid, and nothing on it said market: so four
 * corner posts tied by head rails and knee braces, a ridge pole on a king post
 * over each end, rafters down to the eaves, and the canvas laid on them in
 * sewn widths with a dagged valance at both eaves; a counter of three boards
 * over a boarded front, ledged-and-braced ends and a lapped back; and on it
 * what somebody came to sell.
 *
 * **The collider is the box it has always been** — 3.4 x 1.1 x 1.5, first and
 * alone — and the counter's top boards are drawn with their tops ON it, so a
 * capture ring laid over the counter is not buried. Everything else obeys the
 * three rules: the boarding is applied on the faces, what stands on the
 * counter stands on the collider, what hangs from the head rail hangs over the
 * counter's own footprint, the valance's lowest point is 2.4 m up, and what
 * stands on the ground behind is under 0.3 m — a sack, a basket.
 *
 * The canvas stays translucent, as the one lid it replaced was: it is the one
 * surface here anyone routinely stands beneath, and from underneath it lights
 * up rather than reading as a black roof — the reason the term is spent on a
 * stall and not on a roof. A striped canvas's light widths are the exception,
 * and opaque, for the draw calls (see the canvas below).
 *
 * **What it sells and how it is kept are seeded off where it stands**
 * (`streetSeed`), which is what puts it in `CONFORMS_TO_TERRAIN`: a
 * greengrocer's tipped trays, a corn-chandler's open sacks, a potter's jars or
 * a draper's bolts; a front of bare boards, painted boards or a pleated cloth;
 * canvas in stripes or plain. And its posts and boarding are carried down to
 * the ground under them rather than to the one sample under its middle.
 */
export function buildStall(
  scene: Scene,
  mats: CelMaterialFactory,
  _p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "stall");
  // ---- the collider: the counter, as it always was.
  b.block({ w: 3.4, h: 1.1, d: 1.5, x: 0, y: 0.55, z: 0 });

  const seed = streetSeed(3.4, 1.5, 1.1, ctx);
  const rnd = mulberry32(seed);
  /** 0 greengrocer, 1 corn-chandler, 2 potter, 3 draper. */
  const trade = (seed >>> 3) % 4;
  /** 0 bare boards, 1 painted boards, 2 a pleated cloth hung over the front. */
  const front = (seed >>> 7) % 3;
  const striped = (seed >>> 11) % 3 !== 0;
  const FACE = front === 1 ? ENAMEL : PLANK;

  /** The floor under a local point, as a local height — the cart's reading. */
  const ground = (lx: number, lz: number): number => {
    if (!ctx || Math.abs(ctx.y - ctx.floor) > 0.05) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    const h = ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
    return Math.max(-0.4, Math.min(0.4, h));
  };
  const gLow = Math.min(0, ground(-1.7, -0.75), ground(1.7, -0.75), ground(-1.7, 0.75), ground(1.7, 0.75));

  // ---- the numbers everything hangs off.
  /** The collider's top, which is the counter's. */
  const TOP = 1.1;
  /** Corner posts: centred here, `POST` square, proud of every face they stand in. */
  const PX = 1.67;
  const PZ = 0.72;
  const POST = 0.12;
  /** The head rails' top, the ridge pole's centre, and how far out the eaves come. */
  const HEAD = 2.7;
  const RY = 3.05;
  const EZ = 1.12;
  /** The rafters' centre-line: on the ridge at z = 0, on the head rail at PZ. */
  const R0 = RY + 0.04 + 0.025;
  const SLOPE = (R0 - (HEAD + 0.025)) / PZ;
  const PITCH_A = Math.atan(SLOPE);
  const cosP = Math.cos(PITCH_A);
  const sinP = Math.sin(PITCH_A);

  // ================================================================ the frame
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = ground(sx * PX, sz * PZ) - 0.06;
      b.box(POST, HEAD - g, POST, sx * PX, (HEAD + g) / 2, sz * PZ, TIMBER);
    }
  }
  // Head rails round the top, and a knee brace under each long one at every post.
  for (const sz of [-1, 1]) {
    b.box(2 * PX + POST, 0.08, 0.08, 0, HEAD - 0.04, sz * PZ, TIMBER);
    for (const sx of [-1, 1]) {
      b.box(0.06, 0.5, 0.05, sx * (PX - 0.2), HEAD - 0.26, sz * PZ, TIMBER, { z: sx * 0.8 });
    }
  }
  for (const sx of [-1, 1]) {
    b.box(0.08, 0.08, 2 * PZ, sx * PX, HEAD - 0.04, 0, TIMBER);
    // The king post on the end rail's middle, carrying the ridge.
    b.box(0.08, RY - HEAD, 0.08, sx * PX, (RY + HEAD) / 2, 0, TIMBER);
  }
  b.cyl(2 * PX + 0.5, 0.08, 0.08, 7, 0, RY, 0, TIMBER, { z: Math.PI / 2 });
  // Rafters from the ridge over the head rails to the eaves, both sides.
  {
    const len = (EZ + 0.02) / cosP;
    const zc = (EZ + 0.02) / 2;
    for (const sz of [-1, 1]) {
      for (const x of [-PX, -PX / 2, 0, PX / 2, PX]) {
        b.cyl(len, 0.05, 0.05, 6, x, R0 - zc * SLOPE, sz * zc, TIMBER, {
          x: Math.PI / 2 + sz * PITCH_A,
        });
      }
    }
  }

  // =============================================================== the canvas
  // Sewn in widths down the slope, each lapped a few millimetres over the
  // next so the seams are a step the ink finds; striped widths alternate the
  // two canvas colours, plain ones are all the one — and a plain canvas is
  // sewn from half as many widths, since seams a stripe apart on one colour
  // read as boards.
  //
  // **Only the dark widths are translucent.** A translucent sheet's material
  // is keyed by its colour, so a second translucent colour is a draw call in
  // every block a stall stands in — measured, three on Sarab's market and
  // 4% of the frame looking across it — where an opaque one joins the
  // palette the rest of the stall is already drawn in. From underneath the
  // stripes therefore read as light coming through every other width, which
  // is what a canvas of two weights does.
  {
    const sheet = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      light: boolean,
      rot?: { x?: number; z?: number },
    ): void => {
      if (light) b.box(w, h, d, x, y, z, SAILCLOTH, rot);
      else b.translucentBox(w, h, d, x, y, z, THATCH, TRANSLUCENCY.awning, rot);
    };
    const WIDTHS = striped ? 12 : 6;
    const DAGS = 12;
    const span = 2 * PX + 0.5;
    const ww = span / WIDTHS;
    const dw = span / DAGS;
    const z0 = -0.03;
    const z1 = EZ + 0.04;
    const zc = (z0 + z1) / 2;
    const len = (z1 - z0) / cosP;
    /** The canvas's lower edge, where the valance hangs from. */
    const yEdge = R0 - z1 * SLOPE + 0.035 * cosP;
    const zEdge = z1 + 0.035 * sinP + 0.006;
    for (const sz of [-1, 1]) {
      for (let i = 0; i < WIDTHS; i++) {
        const x = -span / 2 + ww * (i + 0.5);
        const light = striped && i % 2 === 1;
        const n = 0.035 + (i % 2) * 0.006;
        sheet(ww + 0.01, 0.018, len, x, R0 - zc * SLOPE + n * cosP, sz * (zc + n * sinP), light, {
          x: sz * PITCH_A,
        });
        // The valance: a band hung plumb from the eave, the width's own.
        sheet(ww + 0.004, 0.075, 0.012, x, yEdge - 0.03, sz * zEdge, light);
      }
      // One dag cut below the band every stripe's width — a square turned on
      // its corner, half of it behind the band — its point 2.4 m up.
      for (let i = 0; i < DAGS; i++) {
        sheet(0.07, 0.07, 0.012, -span / 2 + dw * (i + 0.5), yEdge - 0.068, sz * zEdge, striped && i % 2 === 1, {
          z: Math.PI / 4,
        });
      }
    }
  }

  // ============================================================== the counter
  // Three boards across the top, their tops on the collider's, a nosing over
  // the front and a hand's overhang at the ends; the posts come up through it.
  {
    const z0 = -0.81;
    const z1 = 0.78;
    const bw = (z1 - z0 - 0.02) / 3;
    for (let i = 0; i < 3; i++) {
      b.box(3.52 - (i % 2) * 0.03, 0.04, bw, (i - 1) * 0.008, TOP - 0.02, z0 + bw / 2 + i * (bw + 0.01), PLANK);
    }
  }
  // Rails under the top along the front and the back.
  for (const sz of [-1, 1]) {
    b.box(2 * PX - POST, 0.1, 0.03, 0, 1.0, sz * 0.765, sz > 0 ? PLANK : FACE);
  }
  // The front: upright boards between the posts, alternately a few
  // millimetres proud, cut to the ground under each — or a cloth hung over it.
  if (front !== 2) {
    const n = 15;
    const run = 2 * (PX - POST / 2);
    const bw = (run - (n - 1) * 0.012) / n;
    for (let i = 0; i < n; i++) {
      const x = -run / 2 + bw / 2 + i * (bw + 0.012);
      const g = ground(x, -0.76) - 0.03;
      b.box(bw, 0.95 - g, 0.018, x, (0.95 + g) / 2, -(0.759 + (i % 2) * 0.004), FACE);
    }
  } else {
    // Box pleats: alternate panels stand out and the hem swings in a slow
    // wave, under a band of the stall's colour tacked along the top — which
    // is what tells a hung cloth from boards in the shade.
    const n = 26;
    const run = 2 * (PX + POST / 2) + 0.02;
    const pw = run / n;
    const phase = rnd() * 6;
    for (let i = 0; i < n; i++) {
      const x = -run / 2 + pw * (i + 0.5);
      const hem = ground(x, -0.8) + 0.12 + Math.sin(phase + x * 2.3) * 0.04 + (rnd() - 0.5) * 0.02;
      b.box(pw + 0.004, 0.96 - hem, 0.014, x, (0.96 + hem) / 2, -(0.8 + (i % 2) * 0.022), SAILCLOTH);
    }
    b.box(run + 0.02, 0.11, 0.016, 0, 1.005, -0.832, AWNING);
  }
  // The ends: boards between the posts, two ledges and a brace between them.
  for (const sx of [-1, 1]) {
    const x = sx * 1.7075;
    const n = 6;
    const run = 2 * (PZ - POST / 2);
    const bw = (run - (n - 1) * 0.01) / n;
    for (let i = 0; i < n; i++) {
      const z = -run / 2 + bw / 2 + i * (bw + 0.01);
      const g = ground(sx * 1.7, z) - 0.03;
      b.box(0.015, 1.05 - g, bw, x + sx * (i % 2) * 0.004, (1.05 + g) / 2, z, PLANK);
    }
    for (const y of [0.3, 0.86]) b.box(0.022, 0.1, run - 0.04, sx * 1.726, y, 0, PLANK);
    const rise = 0.46;
    const across = run - 0.24;
    b.box(0.022, 0.09, Math.hypot(rise, across), sx * 1.726, 0.58, 0, PLANK, {
      x: -sx * Math.atan2(rise, across),
    });
  }
  // The back: lapped boards, each tipped out at its foot, the lowest one
  // carried down to the ground.
  {
    const run = 2 * (PX - POST / 2);
    const course = 0.26;
    const gBack = Math.min(ground(-1.6, 0.76), ground(1.6, 0.76), ground(0, 0.76)) - 0.03;
    for (let i = 0; i < 4; i++) {
      const top = 0.95 - i * (course - 0.025);
      const bottom = i === 3 ? gBack : top - course;
      b.box(run, top - bottom, 0.018, 0, (top + bottom) / 2, 0.77 + (i % 2) * 0.004, PLANK, { x: -0.08 });
    }
    // Two battens up the back, which the boards are nailed to.
    for (const x of [-0.55, 0.55]) b.box(0.09, 0.95 - gBack, 0.025, x, (0.95 + gBack) / 2, 0.793, PLANK);
    // An apron hung on a nail at the stallholder's end.
    b.box(0.04, 0.03, 0.04, 0.95, 0.93, 0.79, IRON);
    b.box(0.46, 0.62, 0.012, 0.95, 0.61, 0.795, SAILCLOTH, { z: 0.04 });
  }
  // The body behind all of it, dark in the gaps: emitted after what hides it.
  {
    const top = TOP - 0.045;
    const bottom = gLow - 0.05;
    b.box(2 * PX - 0.14, top - bottom, 1.49, 0, (top + bottom) / 2, 0, TIMBER);
  }

  // ================================================================ the goods
  const onTop = (meshes: Mesh[], m: Matrix): void => reframe(meshes, m.multiply(Matrix.Translation(0, TOP, 0)));
  if (trade === 0) {
    // Three trays tipped to the customer on a batten, each heaped with one
    // thing; baskets and the scales behind.
    const COLS = [BRICK, CREEPER, STRAW, RUST];
    const first = (seed >>> 13) % 4;
    for (let k = 0; k < 3; k++) {
      const tray = stallTray(b, 0.92, 0.5, COLS[(first + k) % 4], k === 1 ? 0.16 : 0.1, rnd);
      onTop(tray, Matrix.RotationX(-0.15).multiply(Matrix.Translation((k - 1) * 1.02, 0.05, -0.4)));
      b.box(0.9, 0.085, 0.05, (k - 1) * 1.02, TOP + 0.0425, -0.17, PLANK);
    }
    onTop(stallBasket(b, 0.44, 0.24, COLS[(first + 3) % 4], rnd), Matrix.Translation(-1.0, 0, 0.35));
    onTop(stallBasket(b, 0.36, 0.2, COLS[(first + 1) % 4], rnd), Matrix.Translation(-0.5, 0, 0.42));
    onTop(stallScales(b), Matrix.RotationY(0.2).multiply(Matrix.Translation(0.75, 0, 0.35)));
  } else if (trade === 1) {
    // Open sacks along the front, necks rolled down, a scoop in one; the
    // scales and a measure behind.
    const COLS = [STRAW, RUST, BRICK, DIRT, STRAW];
    const first = (seed >>> 13) % 5;
    for (let k = 0; k < 5; k++) {
      const s = stallOpenSack(b, 0.3 + rnd() * 0.08, 0.34 + rnd() * 0.06, COLS[(first + k) % 5], k === 2);
      onTop(s, Matrix.RotationY(rnd() * 2).multiply(Matrix.Translation(-1.3 + k * 0.65, 0, -0.38 + (k % 2) * 0.1)));
    }
    onTop(stallScales(b), Matrix.RotationY(-0.3).multiply(Matrix.Translation(-0.6, 0, 0.4)));
    b.cyl(0.2, 0.2, 0.2, 8, 0.5, TOP + 0.1, 0.4, PLANK);
    b.cyl(0.03, 0.22, 0.22, 8, 0.5, TOP + 0.185, 0.4, IRON);
    b.cyl(0.02, 0.18, 0.18, 8, 0.5, TOP + 0.17, 0.4, COLS[first]);
  } else if (trade === 2) {
    // Jars stood in two ranks, the big ones behind, and bowls in stacks.
    for (let k = 0; k < 4; k++) {
      const h = 0.36 + rnd() * 0.14;
      onTop(stallJar(b, h, h * 0.62), Matrix.Translation(-1.25 + k * 0.72 + rnd() * 0.1, 0, 0.32));
    }
    for (let k = 0; k < 5; k++) {
      const h = 0.18 + rnd() * 0.1;
      onTop(stallJar(b, h, h * 0.7), Matrix.Translation(-1.4 + k * 0.58 + rnd() * 0.08, 0, -0.3 - rnd() * 0.2));
    }
    for (const x of [-1.1, 0.15, 1.2]) {
      const n = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        b.cyl(0.07, 0.3 - i * 0.004, 0.14, 8, x, TOP + 0.035 + i * 0.045, -0.02, BRICK);
      }
    }
  } else {
    // Bolts laid end-on to the customer, and folded lengths stacked behind.
    const COLS = [SAILCLOTH, AWNING, ENAMEL, THATCH, STRAW, AWNING, SAILCLOTH];
    const first = (seed >>> 13) % 7;
    for (let k = 0; k < 7; k++) {
      const d = 0.16 + rnd() * 0.06;
      const x = -1.35 + k * 0.45;
      b.cyl(0.6, d, d, 8, x, TOP + d / 2, -0.38, COLS[(first + k) % 7], { x: Math.PI / 2 });
      b.box(0.05, d + 0.02, 0.62, x, TOP + d / 2, -0.38, PLANK);
    }
    for (const [j, x] of [-0.95, 0, 0.95].entries()) {
      const n = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        b.box(0.62, 0.075, 0.4, x + (rnd() - 0.5) * 0.05, TOP + 0.04 + i * 0.078, 0.38, COLS[(first + j * 2 + i * 3) % 7], {
          y: (rnd() - 0.5) * 0.12,
        });
      }
    }
    // A yard measure along the front edge.
    b.box(0.92, 0.012, 0.03, 0.3, TOP + 0.006, -0.72, STRAW);
  }

  // ---- hung from the front head rail, over the counter's own footprint.
  if (trade === 0 || trade === 1) {
    // Strings of onions, plaited: each hangs by its neck from the cord and
    // swings out to alternate sides.
    for (const x of [-1.2, -0.45, 0.4, 1.25]) {
      if (rnd() < 0.25) continue;
      const n = 7 + Math.floor(rnd() * 4);
      const cord = n * 0.05 + 0.08;
      b.box(0.01, cord, 0.01, x, HEAD - 0.08 - cord / 2, -PZ, STRAW);
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const lean = side * (0.5 + rnd() * 0.3);
        reframe(
          stallOnion(b, 0.075 + rnd() * 0.015),
          Matrix.RotationZ(lean)
            .multiply(Matrix.RotationX((rnd() - 0.5) * 0.6))
            .multiply(Matrix.Translation(x + side * 0.035, HEAD - 0.17 - i * 0.05, -PZ)),
        );
      }
    }
  } else if (trade === 2) {
    // Jugs by their handles.
    for (const x of [-1.0, 0.1, 1.1]) {
      b.box(0.012, 0.18, 0.012, x, HEAD - 0.17, -PZ, STRAW);
      reframe(stallJar(b, 0.26, 0.18), Matrix.Translation(x, HEAD - 0.52, -PZ));
    }
  } else {
    // A length of cloth thrown over the rail to show it.
    const c = (seed >>> 17) % 2 === 0 ? AWNING : ENAMEL;
    b.box(0.62, 0.72, 0.012, -0.6, HEAD - 0.4, -PZ - 0.05, c);
    b.box(0.62, 0.4, 0.012, -0.6, HEAD - 0.24, -PZ + 0.05, c);
  }

  // ---- behind, on the ground under the back canvas: low enough to walk over.
  {
    const gz = 1.05;
    reframe(cartSack(b), Matrix.RotationY(0.3 + rnd()).multiply(Matrix.Translation(-0.9, ground(-0.9, gz), gz)));
    if (rnd() < 0.6) {
      const k = stallBasket(b, 0.42, 0.22, trade === 3 ? SAILCLOTH : STRAW, rnd);
      reframe(k, Matrix.Translation(0.6, ground(0.6, gz), gz - 0.05));
    }
  }
  return b;
}

/** A shallow slatted tray at y = 0, heaped with one thing. */
function stallTray(b: Build, w: number, d: number, color: string, big: number, rnd: () => number): Mesh[] {
  const from = b.meshes.length;
  b.box(w, 0.02, d, 0, 0.01, 0, PLANK);
  for (const sz of [-1, 1]) b.box(w, 0.08, 0.02, 0, 0.05, sz * (d / 2 - 0.01), PLANK);
  for (const sx of [-1, 1]) b.box(0.02, 0.1, d, sx * (w / 2 - 0.01), 0.05, 0, PLANK);
  // A mound of it, and the top layer as separate rounds so the heap has lumps.
  b.cyl(0.07, d * 0.5, d * 0.92, 7, 0, 0.055, 0, color).scaling.x = (w / d) * 0.95;
  // Staggered, a round short on every other row, and each one sat down a
  // little into the mound at its own height.
  const pitch = big * 1.3;
  const cols = Math.max(3, Math.round((w - 0.08) / pitch));
  const rows = Math.max(2, Math.round((d - 0.08) / pitch));
  for (let j = 0; j < rows; j++) {
    const n = cols - (j % 2);
    for (let i = 0; i < n; i++) {
      const x = -((n - 1) * pitch) / 2 + i * pitch + (rnd() - 0.5) * 0.025;
      const z = -((rows - 1) * pitch) / 2 + j * pitch + (rnd() - 0.5) * 0.025;
      const s = big * (0.85 + rnd() * 0.25);
      const crown = 1 - Math.abs(z) / d;
      reframe(stallRound(b, s, color), Matrix.RotationY(rnd() * 2).multiply(Matrix.Translation(x, 0.07 + s * 0.3 + crown * 0.03, z)));
    }
  }
  return b.meshes.slice(from);
}

/** A round wicker basket at y = 0, its rim bound darker, filled with `fill`. */
function stallBasket(b: Build, d: number, h: number, fill: string, rnd: () => number): Mesh[] {
  const from = b.meshes.length;
  b.cyl(h, d, d * 0.8, 8, 0, h / 2, 0, STRAW);
  b.cyl(0.03, d + 0.03, d + 0.03, 8, 0, h - 0.01, 0, PLANK);
  b.cyl(0.05, d * 0.5, d * 0.92, 8, 0, h - 0.01, 0, fill);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rnd();
    const s = d * 0.24;
    reframe(stallRound(b, s, fill), Matrix.Translation(Math.cos(a) * d * 0.2, h + 0.03, Math.sin(a) * d * 0.2));
  }
  return b.meshes.slice(from);
}

/** A sack stood open with its neck rolled down, at y = 0 — a scoop in it or not. */
function stallOpenSack(b: Build, d: number, h: number, fill: string, scoop: boolean): Mesh[] {
  const from = b.meshes.length;
  b.cyl(h * 0.3, d * 1.08, d * 0.95, 8, 0, h * 0.15, 0, SAILCLOTH);
  b.cyl(h * 0.7, d, d * 1.08, 8, 0, h * 0.65, 0, SAILCLOTH);
  // The neck rolled down into a fat roll, and what is in it heaped over the roll.
  b.cyl(0.05, d + 0.07, d + 0.04, 8, 0, h - 0.045, 0, SAILCLOTH);
  b.cyl(0.04, d + 0.04, d + 0.07, 8, 0, h - 0.005, 0, SAILCLOTH);
  b.cyl(0.11, d * 0.2, d * 0.98, 8, 0, h + 0.035, 0, fill);
  if (scoop) {
    b.cyl(0.08, 0.1, 0.08, 7, 0.03, h + 0.05, 0, IRON, { z: 0.5 });
    b.box(0.16, 0.02, 0.025, 0.14, h + 0.12, 0, TIMBER, { z: 0.5 });
  }
  return b.meshes.slice(from);
}

/**
 * One round thing — an apple, a cabbage, a potato — centred at the origin:
 * two frustums base to base, which is the cheapest shape that is round from
 * every side the ink sees it from. A single frustum read as a pyramid.
 */
function stallRound(b: Build, s: number, color: string): Mesh[] {
  const from = b.meshes.length;
  b.cyl(s * 0.36, s, s * 0.72, 7, 0, -s * 0.18, 0, color);
  b.cyl(s * 0.36, s * 0.72, s, 7, 0, s * 0.18, 0, color);
  return b.meshes.slice(from);
}

/** An onion hung by its neck, the neck's tip at the origin. */
function stallOnion(b: Build, s: number): Mesh[] {
  const from = b.meshes.length;
  b.cyl(s * 0.55, s * 0.25, s, 6, 0, -s * 0.275, 0, STRAW);
  b.cyl(s * 0.4, s, s * 0.45, 6, 0, -s * 0.75, 0, STRAW);
  return b.meshes.slice(from);
}

/** A pair of shop scales at y = 0: a post on a foot, a beam, two pans. */
function stallScales(b: Build): Mesh[] {
  const from = b.meshes.length;
  b.box(0.2, 0.03, 0.14, 0, 0.015, 0, TIMBER);
  b.box(0.025, 0.36, 0.025, 0, 0.21, 0, IRON);
  b.box(0.42, 0.018, 0.018, 0, 0.39, 0, IRON);
  for (const sx of [-1, 1]) {
    b.box(0.006, 0.24, 0.006, sx * 0.2, 0.27, 0, IRON);
    b.cyl(0.025, 0.15, 0.11, 8, sx * 0.2, 0.14, 0, IRON);
  }
  return b.meshes.slice(from);
}

/** An earthenware jar at y = 0: belly, shoulder, neck and lip. */
function stallJar(b: Build, h: number, d: number): Mesh[] {
  const from = b.meshes.length;
  b.cyl(h * 0.45, d, d * 0.6, 8, 0, h * 0.225, 0, BRICK);
  b.cyl(h * 0.3, d * 0.45, d, 8, 0, h * 0.6, 0, BRICK);
  b.cyl(h * 0.16, d * 0.4, d * 0.45, 8, 0, h * 0.83, 0, BRICK);
  b.cyl(h * 0.06, d * 0.55, d * 0.55, 8, 0, h * 0.94, 0, BRICK);
  return b.meshes.slice(from);
}
