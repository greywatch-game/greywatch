/**
 * kit/structures.ts — Small standalone structures and cover: silo, well,
 * stall, fence, stone wall, bridge, trestle bridge, temple ruin, haystack,
 * lamp post, cart, crates, woodpile, shed, trough, shrine, kiln. All follow
 * the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata).
 *
 * Cover vocabulary, so a layout can pick the right height deliberately. A
 * prop's COLLIDER height is the whole of it, and `CONFIG.bots.cover` draws
 * three lines through the range: 0.9 (`softHeight` — a steering hint and
 * nothing more), 1.3 (`crouchHeight` — stops a round at a body that gets DOWN
 * behind it, and only within `crouchProbe` of it), and 1.7 (`hardHeight` —
 * stops one at a body standing up). Trough (1.0) and the fence's run (1.4, and
 * `porous`, so in no mask at all) are *low*: a step over with the eyes, not
 * the body. Cart (1.7), woodpile (1.9), haystack (2.2) and crates (2.3) are
 * all at or over the hard line — cover you stand and shoot from, not cover you
 * duck behind. Stone wall, shed, silo and kiln break sightlines outright. The
 * fence is the one thing here that is cover from nothing but its own timber —
 * its coarse box is `porous` and its posts and rails are `strut`s, so it turns
 * a route without turning a sightline, and stops only what actually hits wood.
 *
 * **A ROUND prop's collider is its body at the height rounds arrive at, not a
 * square drawn round its widest circle.** `b.cyl`'s diameter is a
 * CIRCUMdiameter — the polygon's vertices touch it and its silhouette does not
 * — so a box taking that number is already wider than what you can see, and a
 * box taking it at the widest course and then holding it to the top is wider
 * again everywhere the prop tapers. That is what the haystack and the kiln both
 * did, and it measured as rounds stopping on open air a metre off the drawn
 * surface. Size these off the silhouette across the middle of the solid part
 * and leave the cap, the neck and any hoop banding outside it — the same trade
 * `PROP_BODIES` in MapBuilder.ts argues for scatter, where too small costs a
 * round clipping a silhouette and too large costs shots that visibly should
 * have landed. The silo has always done this (its box is the nominal `dia`,
 * not the 1.06 it splays to at the foot); it is the pattern to copy.
 *
 * Two things here are walked ON rather than hidden behind — the two bridges and
 * the temple — so they additionally owe what kit/terrain.ts's header states:
 * collider top faces within CONFIG.nav.stepHeight of adjacent ground, and rotX
 * on the COLLIDER of anything pitched, not just on the visual.
 */
import { Matrix, Quaternion, Scene, Vector3, VertexData, type Mesh } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { mulberry32 } from "../rng";
import { marksSway } from "../sway";
import {
  Build,
  groundRun,
  carve,
  convexSolid,
  fern,
  heading,
  limb,
  onFace,
  outward,
  orient,
  rope,
  slab,
  stepAlong,
  type BuildCtx,
  type BuildParams,
  type Structure,
  type Point3,
  type Hole,
  type Side,
  streetSeed,
  AWNING,
  BRICK,
  CASEMENT,
  CREEPER,
  DARK_STONE,
  DIRT,
  DOOR_PAINTS,
  EMBER,
  ENAMEL,
  FIG_BARK,
  FIG_LEAF,
  FIG_LEAF_LIT,
  FLAME,
  GUARD_HEIGHT,
  GUARD_THICKNESS,
  IRON,
  MOSS_STONE,
  PITCH,
  PLANK,
  RUST,
  SAILCLOTH,
  SLATE,
  STONE,
  STRAW,
  TEAK,
  THATCH,
  TIMBER,
} from "./core";

const TRANSLUCENCY = CONFIG.graphics.translucency;

/** Grain silo: a tall corrugated cylinder. Pure cover, not enterable. */
export function buildSilo(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "silo");
  const h = 12;
  const dia = 6;
  b.cyl(h, dia, dia * 1.06, 10, 0, h / 2, 0, DARK_STONE);
  for (let i = 1; i < 5; i++) {
    b.cyl(0.25, dia * 1.05, dia * 1.05, 10, 0, (i * h) / 5, 0, IRON);
  }
  b.cyl(2.4, 0.6, dia * 1.02, 10, 0, h + 1.2, 0, SLATE);
  b.block({ w: dia, h, d: dia, x: 0, y: h / 2, z: 0 });
  return b;
}

/** Stone well — the Square's centrepiece and flag C's anchor. */
export function buildWell(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "well");
  b.cyl(1.5, 3.2, 3.4, 10, 0, 0.75, 0, STONE);
  b.cyl(0.3, 2.6, 2.6, 10, 0, 1.5, 0, DARK_STONE);
  b.block({ w: 3.4, h: 1.5, d: 3.4, x: 0, y: 0.75, z: 0 });
  for (const sx of [-1, 1]) {
    b.box(0.28, 3.2, 0.28, sx * 1.3, 2.9, 0, TIMBER);
  }
  b.box(3.4, 0.3, 0.9, 0, 4.4, 0, PLANK); // roof over the shaft
  b.cyl(2.4, 0.4, 0.4, 6, 0, 3.8, 0, TIMBER, { z: Math.PI / 2 }); // windlass
  return b;
}

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

/**
 * Post-and-rail fence run along X. Blocks movement, not sight, and stops a
 * round on its timber and nowhere else.
 *
 * **The body and the round are described separately, and that is the whole of
 * it.** The `block` at the bottom is the fence to a BODY: 1.4 m of it, the
 * length of the run, `porous`, so the nav graph severs across it and a player
 * walks into it while no round ever stops on it. The posts and rails are
 * `strut`s, so a ROUND stops exactly where the timber is drawn and passes
 * through the gaps — which is most of a fence, and was the whole of it before
 * the slab was told to stop pretending.
 *
 * Neither half works alone: without the block a fence is walked through, and
 * without the struts it is a wall you can see your target through.
 *
 * On a slope it steps (`groundRun`) and only ever AT A POST, since a rail has
 * to end on something: where the ground wants a step between two posts, the
 * run gets another post instead.
 */
export function buildFence(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "fence");
  const len = p.length ?? 10;
  const run = groundRun(ctx, len, {
    pitch: 2.5,
    minGaps: 2,
    depth: 0.4,
    pad: 0.09,
    between: false,
  });
  for (const j of run.joints) {
    const top = j.ground + 1.5;
    b.strut(0.18, top - j.base, 0.18, j.x, (top + j.base) / 2, 0, TIMBER);
  }
  for (const s of run.spans) {
    const w = s.x1 - s.x0;
    const x = (s.x0 + s.x1) / 2;
    b.strut(w, 0.12, 0.1, x, s.ground + 1.2, 0, TIMBER);
    b.strut(w, 0.12, 0.1, x, s.ground + 0.6, 0, TIMBER);
  }
  for (const s of run.spans) {
    // Down to the footing, so a body cannot pass under the run where the floor
    // falls away beneath its ground line.
    const top = s.ground + 1.4;
    b.block({
      w: s.x1 - s.x0,
      h: top - s.base,
      d: 0.4,
      x: (s.x0 + s.x1) / 2,
      y: (top + s.base) / 2,
      z: 0,
      porous: true,
    });
  }
  return b;
}

/**
 * Dry-stone field wall run along X. Unlike `fence` this is chest-high and
 * opaque: it breaks a sightline rather than just a walking line, which is what
 * turns open ground into a fight instead of a shooting gallery. Author it in
 * runs with gaps — a sealed field is a wall the nav grid routes bots all the
 * way around.
 *
 * On a slope it STEPS (`groundRun`): each span stands its full height on its
 * own ground line with its footing under the floor, the coping steps with it,
 * and a step may fall between piers because that is how dry stone is laid up
 * a hill.
 */
export function buildStoneWall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "stonewall");
  const len = p.length ?? 12;
  const h = p.height ?? 1.5;
  const run = groundRun(ctx, len, { pitch: 5, depth: 0.72, pad: 0.35, between: true });
  for (const s of run.spans) {
    const w = s.x1 - s.x0;
    const x = (s.x0 + s.x1) / 2;
    const top = s.ground + h;
    b.wall(w, top - s.base, 0.5, x, (top + s.base) / 2, 0, MOSS_STONE);
    // Capstones, and a stouter pier every few metres: the silhouette is what
    // sells dry stone, since the shader gives it no texture.
    b.box(w, 0.18, 0.66, x, top + 0.09, 0, DARK_STONE);
  }
  for (const j of run.joints) {
    const top = j.ground + h + 0.35;
    b.box(0.7, top - j.base, 0.72, j.x, (top + j.base) / 2, 0, MOSS_STONE);
  }
  return b;
}

/**
 * A PILE-AND-STRINGER FOOTBRIDGE over the creek, running along Z: plank
 * decking laid across four stringers, a close-boarded parapet each side with
 * its posts on the outside, pile bents standing in the channel, and a
 * dry-stone bank seat under each end where the bank falls away. It was a plank
 * slab between two blank walls, standing on nothing.
 *
 * **The colliders are the three it has always had, first and in order**: the
 * deck slab, walked by the ground probe, and one `guard` each side. The
 * handrails are `guard`s because they once were bare `box`es, and a bridge
 * whose whole reason to exist is that the creek runs a metre and more below
 * the banks had two sides you could simply walk out of. `Build.guard` is what
 * makes them solid without costing the deck a nav cell.
 *
 * **The parapet is BOARDED because that guard is solid.** It stops a round over
 * its whole 1.1 m, so an open rail — posts and two bars — would stop rounds on
 * the air between them: the fence's problem without the fence's answer
 * (`porous` and `strut`), on the one piece of cover somebody crossing has. So
 * the guard's own panel is drawn as the dark core, and horizontal boards are
 * laid on both faces of it, tipped out at the foot so every course is a band
 * and a line. A board seeded missing shows the core, which is still the
 * timber a round stops on. The posts stand OUTSIDE the boarding, on the
 * outer stringer, as a boarded parapet is built.
 *
 * **Nothing walked is drawn proud of the collider**: the planks' tops are the
 * slab's top (a worn one sits a few millimetres under it), and everything
 * else — stringers, headstocks, piles, knee braces, the bank seats — is under
 * the deck or outside the parapet, where nobody's feet go. Under the deck the
 * channel has a metre or so of headroom, which the nav graph already severs,
 * so none of it needs a collider; a pile's would only give a body something
 * to wedge on in the water.
 *
 * Seeded off where it stands (`streetSeed`) — the planks' widths and wear,
 * where the boarding is jointed and which boards are gone, the stones — and
 * cut to the ground: the bank seats are placed where the bank FALLS below
 * them, found by sampling the floor under the centreline, and each pile is
 * carried down into the bed under its own foot. That is what puts `bridge` in
 * `CONFORMS_TO_TERRAIN`. Without a `BuildCtx` (a preview) it is drawn over a
 * nominal creek a metre and a quarter deep.
 */
export function buildBridge(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "bridge");
  const len = p.length ?? 12;
  const w = p.width ?? 3.2;
  const deckT = 0.28;
  /** Walkable height of the deck: the surface, not the slab's centre. */
  const top = deckT / 2;

  // --- the colliders: unchanged, and in this order -------------------------
  // Each guard also draws its panel, which is the parapet's CORE below.
  b.block({ w, h: deckT, d: len, x: 0, y: 0, z: 0 });
  for (const side of ["-x", "+x"] as const) {
    const sx = side === "+x" ? 1 : -1;
    b.guard(side, (sx * w) / 2, 0, len, top);
  }

  // --- everything after this is drawing ------------------------------------
  const rnd = mulberry32(streetSeed(w, len, top, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) {
      // A preview: banks at the ends, and a creek between them.
      const m = len / 2 - Math.abs(lz);
      return m < 1.5 ? 0 : m < 2.5 ? -0.6 : -1.25;
    }
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };

  const plankT = 0.08;
  /** The stringers' tops: the planks' undersides. */
  const bed = top - plankT;
  const stringerH = 0.34;
  /** The stringers' undersides, which everything under the deck hangs from. */
  const soffit = bed - stringerH;
  /** The parapet core's outer face, |x|. Its inner face is the deck edge. */
  const face = w / 2 + GUARD_THICKNESS;
  const boardT = 0.03;
  const post = 0.16;
  /** A post's centre, |x|: bedded on the outer boarding. */
  const postX = face + boardT + post / 2;
  /** The top of the guard's panel. */
  const rail = top + GUARD_HEIGHT;

  // Where the bank has fallen below the bank seat's stones, from each end. The
  // seats stand there, and the bents stand between them.
  const seatTop = soffit - 0.24;
  const fall = seatTop - 0.1;
  let south: number | null = null;
  let north: number | null = null;
  for (let z = -len / 2; z <= len / 2; z += 0.25) {
    if (ground(0, z) < fall) {
      south = z;
      break;
    }
  }
  for (let z = len / 2; z >= -len / 2; z -= 0.25) {
    if (ground(0, z) < fall) {
      north = z;
      break;
    }
  }
  const bents: number[] = [];
  if (south !== null && north !== null && north - south > 4.2) {
    const n = Math.ceil((north - south) / 4.2);
    for (let i = 1; i < n; i++) bents.push(south + ((north - south) * i) / n);
  }

  // Parapet posts: one at each end, one over every bent, and enough between
  // that none stands more than 2.4 m from the next.
  const endZ = len / 2 - 0.1;
  const stations = [-endZ, ...bents, endZ];
  const posts: number[] = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const n = Math.max(1, Math.ceil((stations[i + 1] - stations[i]) / 2.4));
    for (let j = 0; j < n; j++) posts.push(stations[i] + ((stations[i + 1] - stations[i]) * j) / n);
  }
  posts.push(endZ);

  // The decking: planks across, of seeded widths with a gap the ink finds,
  // their ends ragged under the parapet and a few worn hollow.
  for (let z = -len / 2; z < len / 2 - 0.05; ) {
    let pw = 0.22 + rnd() * 0.08;
    if (z + pw > len / 2 - 0.12) pw = len / 2 - z;
    const xl = -(w / 2 + 0.15 + rnd() * 0.035);
    const xr = w / 2 + 0.15 + rnd() * 0.035;
    const sink = rnd() < 0.2 ? 0.005 + rnd() * 0.01 : 0;
    b.box(xr - xl, plankT, pw - 0.018, (xl + xr) / 2, top - sink - plankT / 2, z + pw / 2, PLANK);
    z += pw;
  }
  // The stringers the planks are spiked to — the outer pair under the
  // parapet, which stands on the plank ends over them — emitted after the
  // planks that hide their tops.
  for (const x of [-(w / 2 + 0.04), -w / 6, w / 6, w / 2 + 0.04]) {
    const sw = Math.abs(x) > w / 2 ? 0.28 : 0.2;
    b.box(sw, stringerH, len, x, bed - stringerH / 2, 0, TIMBER);
  }

  // The parapet. Four courses a face, tipped out at the foot. The outer
  // boarding is jointed at the posts, under them; the inner is jointed
  // wherever a board ran out, staggered course by course.
  const courses = 4;
  const courseH = GUARD_HEIGHT / courses;
  const boardH = courseH - 0.014;
  for (const sx of [-1, 1]) {
    for (const outer of [true, false]) {
      const plane = sx * (outer ? face : w / 2);
      const nx = outer ? sx : -sx;
      for (let c = 0; c < courses; c++) {
        const joints: number[] = [-len / 2];
        if (outer) {
          joints.push(...posts.slice(1, -1));
        } else {
          for (let z = -len / 2 + 0.8 + rnd() * 2.4; z < len / 2 - 1.0; z += 2.2 + rnd() * 2.2) joints.push(z);
        }
        joints.push(len / 2);
        for (let j = 0; j < joints.length - 1; j++) {
          if (rnd() < 0.04) continue;
          const z0 = joints[j] + (j > 0 ? 0.006 : 0);
          const z1 = joints[j + 1] - (j < joints.length - 2 ? 0.006 : 0);
          const tip = 0.03 + rnd() * 0.03;
          const x = plane + nx * (boardT / 2 + (boardH / 2) * Math.sin(tip));
          const y = top + (c + 0.5) * courseH;
          b.box(boardT, boardH, z1 - z0, x, y, (z0 + z1) / 2, PLANK, { z: nx * tip });
        }
      }
    }
    // The handrail capping the boarding: a board laid flat on the core.
    b.box(GUARD_THICKNESS + 2 * boardT + 0.05, 0.07, len + 0.06, sx * (w / 2 + GUARD_THICKNESS / 2), rail + 0.035, 0, PLANK);
    // Posts from the outer stringer to over the capping, a weathered pyramid
    // on each; the two at each end stouter.
    const postFoot = soffit - 0.02;
    const postTop = rail + 0.13;
    for (let i = 0; i < posts.length; i++) {
      const z = posts[i];
      const end = i === 0 || i === posts.length - 1;
      const pp = end ? 0.2 : post;
      const px = sx * (face + boardT + pp / 2);
      const pt = postTop + (end ? 0.08 : 0);
      b.box(pp, pt - postFoot, pp, px, (pt + postFoot) / 2, z, TIMBER);
      b.cyl(0.09, 0, pp * 1.42, 4, px, pt + 0.045, z, TIMBER, { y: Math.PI / 4 });
    }
  }

  // The bents: a headstock under the stringers, run out past the parapet as an
  // outrigger for the knee braces to each post over it, carried on two piles
  // (three on a wide deck) cut into the bed and braced across on the upstream
  // face where they stand tall enough to need it.
  const outrig = face + 0.45;
  const headH = 0.24;
  const headFoot = soffit - headH;
  const pileXs = w >= 3 ? [-(w / 2 - 0.2), 0, w / 2 - 0.2] : [-(w / 2 - 0.2), w / 2 - 0.2];
  bents.forEach((z, i) => {
    b.box(outrig * 2, headH, 0.26, 0, soffit - headH / 2, z, TIMBER);
    let lowest = headFoot;
    for (const x of pileXs) {
      const foot = ground(x, z) - 0.3;
      lowest = Math.min(lowest, foot);
      if (headFoot - foot < 0.15) continue;
      limb(b, [x + (rnd() - 0.5) * 0.08, foot, z + (rnd() - 0.5) * 0.06], [x, headFoot + 0.02, z], 0.27, 0.22, TIMBER, 7);
    }
    if (headFoot - lowest > 0.9) {
      const d = i % 2 === 0 ? 1 : -1;
      const xa = pileXs[0];
      const xc = pileXs[pileXs.length - 1];
      const ya = headFoot - 0.1;
      const yc = Math.max(lowest + 0.5, headFoot - (xc - xa) * 0.7);
      slab(b, [d * xa, ya, z - 0.165], [d * xc, yc, z - 0.165], 0.06, 0.15, TIMBER);
    }
    for (const sx of [-1, 1]) {
      slab(b, [sx * (outrig - 0.08), soffit, z], [sx * (postX + post / 2), top + 0.5, z], 0.1, 0.12, TIMBER);
    }
  });

  // The bank seats: a timber sill across the channel's edge under the
  // stringers, on a dry-stone face retaining the bank, its stones laid with a
  // gap over a darker core set back so every joint is inked.
  for (const s of [-1, 1]) {
    const edge = s < 0 ? south : north;
    if (edge === null || Math.abs(edge) > len / 2 - 0.4) continue;
    /** The face looks into the channel, toward -s. */
    const nz = -s;
    b.box(w + 0.6, 0.24, 0.3, 0, soffit - 0.12, edge - nz * 0.15, TIMBER);
    const half = w / 2 + 0.35;
    const foot =
      Math.min(ground(-half, edge + nz * 0.3), ground(0, edge + nz * 0.3), ground(half, edge + nz * 0.3)) - 0.25;
    const height = seatTop - foot;
    if (height < 0.2) continue;
    const n = Math.max(1, Math.round(height / 0.26));
    const ch = height / n;
    for (let c = 0; c < n; c++) {
      const y = seatTop - (c + 0.5) * ch;
      for (let x = -half; x < half - 0.1; ) {
        let sw = 0.32 + rnd() * 0.36;
        if (x + sw > half - 0.2) sw = half - x;
        const proud = 0.03 + rnd() * 0.025;
        b.box(sw - 0.025, ch - 0.025, 0.32, x + sw / 2, y, edge + nz * (proud - 0.16), rnd() < 0.3 ? STONE : MOSS_STONE);
        x += sw;
      }
    }
    b.box(half * 2, height, 0.7, 0, (seatTop + foot) / 2, edge - nz * 0.4, DARK_STONE);
  }
  return b;
}

// --- the trestle -----------------------------------------------------------

/** Walked height of the trestle deck above LOCAL ZERO, which is bank grade. */
const TRESTLE_DECK = 1.6;
/**
 * Deck slab thickness, placed by its TOP face.
 *
 * The footbridge gets away with 0.28 and the jetty with 0.24; this does not,
 * and the difference is area seen at a grazing angle. `OutlineRenderer` draws
 * the outline shell with a slope-scaled negative depth offset, and the manor's
 * documented failure is a 0.14 m deck over 22 x 15 m coming back painted flat
 * in its own ink. A cart-width deck over a 26 m span is 83 m² walked down its
 * long axis — squarely between the two, and not somewhere to guess.
 *
 * The girder read therefore comes from bracing hung BELOW this box. A plank cap
 * laid on top would put its own top face 0.12 m in front of nothing again;
 * depth behind the WALKED face is the only thing that buys the margin.
 */
const TRESTLE_DECK_T = 0.6;
/** Approach gradient. Inside the 0.4 at which NavGrid.link severs itself. */
const TRESTLE_GRADE = 0.32;
/**
 * How far each ramp foot runs on PAST local zero, to be buried.
 *
 * buildBarn's `rampDrop` and the manor's `SERVICE_DROP` under another name, for
 * the same reason: nothing guarantees the ground at a ramp's foot is exactly
 * the height its structure was sampled at, and a foot even a couple of
 * centimetres over `stepHeight` above the terrain severs everything above it.
 * A `stepHeight` of overrun buries the last stretch instead, where the terrain
 * simply wins the surface and it costs nothing.
 */
const TRESTLE_DROP = 0.6;
/** Metres between pile bents along the span. */
const TRESTLE_BENT = 4.0;

/**
 * A timber trestle carried on raked pile bents, with a graded approach at each
 * end: the plantation road's way over a river, and the piece that makes a
 * colonial valley read as settled rather than merely built on.
 *
 * ## Local zero is BANK grade, not the ground under the centre
 *
 * This is the one thing to get right when placing one. `MapBuilder` samples the
 * terrain ONCE, at the placement's own (x, z), and translates the whole
 * structure by it — and a bridge's centre is over the CHANNEL, so that sample
 * is the river bed. Left alone the whole trestle sinks by the bed's depth and
 * both ramp feet end up floating a metre over the banks, severing everything.
 *
 * The fix is one authored number in the layout: give the placement a `y` equal
 * to minus the bed depth at its centre, so local zero lands back at bank grade
 * and the feet bury themselves by `TRESTLE_DROP` as intended.
 *
 * It could instead read `BuildCtx` and derive that itself. It deliberately does
 * not: that would put it in `CONFORMS_TO_TERRAIN`, whose members the editor
 * REBUILDS rather than translates on every frame of a drag (~570 ms against
 * sub-ms), and a landmark placed once does not need to cost that. If a second
 * trestle ever lands somewhere awkward, this is the thing to change.
 *
 * ## Why the deck is 1.6 m up, which is not a choice
 *
 * A deck low enough to link to a 0-height bank without ramps needs its top at
 * or under `stepHeight` (0.6). A deck high enough for the river bed underneath
 * to stay walkable needs its UNDERSIDE more than `HEADROOM` (1.7) above that
 * bed, or `severLinks` cuts every link crossing it and `clearBlocked` blanks the
 * ground beneath — an invisible wall across the channel, exactly where a player
 * would run under a bridge. Over a 1.34 m bed with a 0.6 m slab those two want
 * `top <= 0.6` and `top > 0.66`. No height does both.
 *
 * So the ramps are not decoration. They are the only way to have a deck you
 * walk over AND a river you can wade under, and at 1.6 m the underside clears
 * the bed by 2.34 m with room to spare.
 *
 * ## It runs along Z, and must
 *
 * `Build.guard` throws in DEV on a pitched run that is not along Z, because a
 * pitched rail turns about X. The ramps are pitched and railed, so the whole
 * structure is built along Z and turned by the placement's `rotY` — the same
 * rule every other pitched slab in the kit follows.
 */
export function buildTrestleBridge(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "trestle");
  /** The WATER span. The two approaches are extra, and considerable. */
  const len = p.length ?? 26;
  const w = p.width ?? 3.2;
  const rise = TRESTLE_DECK + TRESTLE_DROP;
  const run = rise / TRESTLE_GRADE;
  // Pitch from the RUN, never from the slab's own length: conflating the two is
  // what left buildBarn's ramp 0.3 m short of the loft and 1.5 m past the barn.
  const pitch = Math.atan(TRESTLE_GRADE);
  const slab = Math.hypot(run, rise);
  const rampT = 0.5;
  const under = TRESTLE_DECK - TRESTLE_DECK_T;

  // The deck: visual and collider in one box, placed by its top face.
  b.wall(w, TRESTLE_DECK_T, len, 0, TRESTLE_DECK - TRESTLE_DECK_T / 2, 0, PLANK);
  // Longitudinal girders under it — the read the deck slab cannot carry itself.
  for (const sx of [-1, 1]) {
    b.box(0.3, 0.5, len, (sx * (w - 0.5)) / 2, under - 0.25, 0, TEAK);
  }

  // The two approaches, mirrored. `s` is +1 for the one running out to +Z.
  for (const s of [-1, 1]) {
    const midZ = s * (len / 2 + run / 2);
    // Walked height at the run's centre: half the rise below the deck.
    const surface = TRESTLE_DECK - rise / 2;
    // Placed by its TOP face; the half-thickness is measured VERTICALLY, so
    // that term is h/2/cos, not h/2*cos.
    const y = surface - rampT / 2 / Math.cos(pitch);
    b.box(w, rampT, slab, 0, y, midZ, PLANK, { x: s * pitch });
    b.block({ w, h: rampT, d: slab, x: 0, y, z: midZ, rotX: s * pitch });
    // Abutment where the ramp meets the deck, and a sleeper wall at the foot.
    b.box(w + 1.0, 1.1, 1.2, 0, TRESTLE_DECK - 0.75, s * (len / 2 + 0.5), MOSS_STONE);
    b.box(w + 0.6, 0.7, 0.8, 0, -0.45, s * (len / 2 + run - 0.3), MOSS_STONE);
  }

  // Pile bents. All visual: a collider on a pile would sever the bed links this
  // bridge exists to leave alone, and give bots something to wedge on mid-river.
  const bents = Math.max(2, Math.round(len / TRESTLE_BENT));
  for (let i = 0; i <= bents; i++) {
    const z = -len / 2 + (i / bents) * len;
    for (const sx of [-1, 1]) {
      // Raked so the bent is wider at the mud than at the cap.
      b.cyl(3.4, 0.32, 0.42, 6, (sx * (w - 0.6)) / 2, under - 1.7, z, TEAK, {
        z: sx * 0.1,
      });
    }
    // Cap beam and a cross brace: what makes a row of posts read as a trestle.
    b.box(w + 0.7, 0.26, 0.34, 0, under - 0.13, z, TEAK);
    for (const sd of [-1, 1]) {
      b.box(w + 0.5, 0.16, 0.18, 0, under - 1.3, z, TEAK, { z: sd * 0.55 });
    }
    // Creeper up two of them — enough to say the forest is winning, not enough
    // to say the bridge is derelict.
    if (i === 1 || i === bents - 1) {
      b.box(0.12, 1.6, 0.12, (w - 0.6) / 2, under - 0.9, z + 0.2, CREEPER);
    }
  }

  // Rails, along the deck and both approaches. `guard`'s `pitch` is positive for
  // a run RISING toward +Z, which is the opposite sign to the slab's own rotX,
  // and its `length` is the RUN rather than the slab — it cuts the section by
  // cos itself so a ramp's rail meets the deck's in one line.
  for (const side of ["-x", "+x"] as const) {
    const sx = side === "+x" ? 1 : -1;
    const edge = (sx * w) / 2;
    b.guard(side, edge, 0, len, TRESTLE_DECK, { color: TEAK });
    for (const s of [-1, 1]) {
      b.guard(side, edge, s * (len / 2 + run / 2), run, TRESTLE_DECK - rise / 2, {
        pitch: -s * pitch,
        color: TEAK,
      });
    }
    // Posts on the rail's own centreline, half a thickness outboard — drawn at
    // the deck edge they would be inside the guard box and invisible.
    const postX = (sx * (w + GUARD_THICKNESS)) / 2;
    for (let i = 0; i <= bents; i++) {
      const z = -len / 2 + (i / bents) * len;
      b.box(0.2, 1.3, 0.2, postX, TRESTLE_DECK + 0.65, z, TIMBER);
    }
  }
  return b;
}

// --- the temple ------------------------------------------------------------

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
 * Sandstone as the temple was faced in it: warmer than the village's `STONE`
 * and a step lighter than `MOSS_STONE`, so a terrace laid in the three reads as
 * one stone that has weathered three ways rather than as three materials.
 */
const SANDSTONE = "#5d5a4e";
/**
 * Laterite, the rust-coloured rock a temple like this is FILLED with behind
 * its facing. It is only ever seen where the sandstone has fallen away, and
 * that is what it is for: a hole in the facing that shows a different rock in
 * coarse courses says the terrace was BUILT, where one that shows the joint
 * colour says it is a box with stones drawn on it. Ochre rather than the red
 * of `BRICK`, so nobody reads a colonial wall inside a Khmer terrace.
 */
const LATERITE = "#5e4a37";
/**
 * Moss on the paving: `CREEPER`'s own green a step darker, because a level
 * surface takes the sky term in full and `CREEPER` laid flat came back as
 * lily pads — bright coins on grey stone.
 */
const TEMPLE_MOSS = "#374528";
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
 * A member laid flat on a face. `alongX` faces run along X and look down ±Z;
 * `plane` is the face's own coordinate and `sgn` which way is out of it. `tilt`
 * leans it in the face's plane, rising toward +u — with the opposite rotation
 * sign on each axis for the same lean, which is `onFace`'s argument in
 * buildings.ts.
 */
function flat(
  b: Build,
  alongX: boolean,
  plane: number,
  sgn: number,
  u: number,
  y: number,
  along: number,
  tall: number,
  thick: number,
  out: number,
  color: string,
  tilt = 0,
): void {
  const c = plane + sgn * out;
  if (alongX) b.box(along, tall, thick, u, y, c, color, tilt ? { z: tilt } : undefined);
  else b.box(thick, tall, along, c, y, u, color, tilt ? { x: -tilt } : undefined);
}

/**
 * Cuts `[u0, u1]` into stones of `min`..`max` length and hands each to `put`.
 * A remnant too short to be a stone is given to the last one, so no run ends
 * in a sliver.
 */
function courses(
  u0: number,
  u1: number,
  min: number,
  max: number,
  rnd: () => number,
  put: (a: number, c: number) => void,
): void {
  for (let u = u0; u < u1 - 0.04; ) {
    let len = Math.min(u1 - u, min + rnd() * (max - min));
    if (u1 - u - len < min * 0.45) len = u1 - u;
    put(u, u + len);
    u += len;
  }
}

/** The stone one facing block is cut from: more of it green the damper it sits. */
function templeTone(rnd: () => number, damp: number): string {
  const r = rnd();
  return r < damp ? MOSS_STONE : r < damp + (1 - damp) * 0.45 ? STONE : SANDSTONE;
}

/**
 * Creeper hanging off a lip: strands of irregular length, longest in the
 * middle of the run, leafed alternately down their length and stopping at
 * `floor`. The same drawing as the jungle ruin's `curtain`, on a face given as
 * a plane rather than a side.
 */
function hang(
  b: Build,
  alongX: boolean,
  plane: number,
  sgn: number,
  u0: number,
  u1: number,
  yTop: number,
  reach: number,
  floor: number,
  out: number,
  rnd: () => number,
): void {
  if (u1 - u0 < 0.25) return;
  for (let u = u0 + rnd() * 0.08; u < u1; u += 0.13 + rnd() * 0.16) {
    const q = (u - u0) / (u1 - u0);
    const env = Math.sqrt(Math.max(0, Math.sin(Math.PI * q)));
    const bottom = Math.max(yTop - reach * env * (0.3 + 0.7 * rnd()), floor);
    if (yTop - bottom < 0.1) continue;
    flat(b, alongX, plane, sgn, u, (yTop + bottom) / 2, 0.022 + rnd() * 0.02, yTop - bottom, 0.03, out, CREEPER, (rnd() - 0.5) * 0.05);
    let side = rnd() < 0.5 ? -1 : 1;
    for (let y = yTop - 0.04 - rnd() * 0.06; y > bottom + 0.03; y -= 0.09 + rnd() * 0.09) {
      const lu = u + side * (0.03 + rnd() * 0.03);
      flat(b, alongX, plane, sgn, lu, y, 0.09 + rnd() * 0.05, 0.055 + rnd() * 0.035, 0.02, out + 0.015 + rnd() * 0.015, rnd() < 0.18 ? FIG_LEAF_LIT : CREEPER, side * (0.35 + rnd() * 0.5));
      side = -side;
    }
  }
}

/**
 * Moss lying on a level surface at `y`: a few low lobes overlapping, each
 * drawn out along its own bearing and a few millimetres off the last so no
 * two share a plane — which is what keeps its outline from being a coin.
 */
function moss(b: Build, x: number, y: number, z: number, r: number, rnd: () => number): void {
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const o = i === 0 ? 0 : r * (0.35 + rnd() * 0.45);
    const dia = r * (i === 0 ? 1.2 : 0.6 + rnd() * 0.5);
    const lobe = b.cyl(0.016, dia, dia * 1.05, 6, x + Math.cos(a) * o, y + 0.003 + i * 0.003, z + Math.sin(a) * o, TEMPLE_MOSS, { y: rnd() * Math.PI });
    lobe.scaling.x = 1.4 + rnd() * 0.8;
  }
}

/** A fallen block lying at ground height `gy`: bedded a little, never standing. */
function fallen(b: Build, x: number, gy: number, z: number, s: number, rnd: () => number, color: string): void {
  const w = s * (0.55 + rnd() * 0.4);
  const h = Math.min(0.3, s * (0.28 + rnd() * 0.14));
  const d = s * (0.35 + rnd() * 0.25);
  const pitch = (rnd() - 0.5) * 0.25;
  b.box(w, h, d, x, gy + h / 2 - 0.03, z, color, { x: pitch, y: rnd() * Math.PI, z: (rnd() - 0.5) * 0.25 });
}

/**
 * A devata — a temple dancer carved in low relief — handed to `f` a part at a
 * time, in the face's own (u, up) from her feet. Every part is a slab a few
 * centimetres proud, so what draws her is the ink finding each step, the only
 * fidelity a cel band can carry. `whole` false has lost her head, which is how
 * most of them are found.
 */
function devata(
  f: (du: number, dy: number, along: number, tall: number, tilt?: number) => void,
  whole: boolean,
): void {
  f(0, 0.025, 0.28, 0.05); // the lotus she stands on
  f(0, 0.1, 0.27, 0.1); // the hem, flared
  f(0, 0.33, 0.21, 0.38); // the skirt
  f(0, 0.55, 0.23, 0.06); // the sash
  f(0, 0.72, 0.15, 0.28); // the body
  for (const s of [-1, 1]) f(s * 0.11, 0.66, 0.045, 0.28, s * 0.3); // arms
  if (whole) {
    f(0, 0.92, 0.1, 0.12); // head
    f(0, 1.03, 0.06, 0.1); // the tiara's spire
    for (const s of [-1, 1]) f(s * 0.06, 1.08, 0.05, 0.1, s * -0.5); // its flames
  }
}

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

/**
 * Haystack — soft cover in the paddocks.
 *
 * **The box is the rick's width at the height a round arrives at, not the
 * circle it is drawn inside.** The drum is a heptagon tapering 3.2 -> 2.6 over
 * its 2.2 m, and 3.2 is a CIRCUMdiameter: seven vertices touch it and the
 * silhouette between them never does, so a 3.2 box was a square drawn around
 * the widest circle and then held at that width all the way up. Measured, it
 * stopped rounds through 1.0 m of open air abreast of the rick and through
 * 1.5 m at the corners, and above 0.6 m there were bearings where it stopped
 * a round with nothing drawn on that line at all.
 *
 * 2.8 is the drawn silhouette across the middle of the drum (circumdiameter
 * 2.90 there, and a heptagon is about 0.95 of its own circumdiameter however
 * you stand to it). This is `PROP_BODIES`' rule in `MapBuilder.ts` — the trunk
 * at chest height rather than the flare it stands on — and the same rule the
 * silo next door already follows by taking its nominal `dia` rather than the
 * 1.06 it splays to at the foot. It errs small by about 4 cm abreast, which is
 * the cheap side of that file's trade: too small costs a round clipping a
 * silhouette, too large costs shots that visibly should have landed.
 *
 * The cap stays outside the collider, as it was: it is 1.4 m of hay starting
 * at 2.2, which is over every head in the game, and a box that held it would
 * be another square around another cone.
 */
export function buildHaystack(
  scene: Scene,
  mats: CelMaterialFactory,
): Structure {
  const b = new Build(scene, mats, "haystack");
  b.cyl(2.2, 2.6, 3.2, 7, 0, 1.1, 0, THATCH);
  b.cyl(1.4, 0.2, 2.6, 7, 0, 2.9, 0, THATCH);
  b.block({ w: 2.8, h: 2.2, d: 2.8, x: 0, y: 1.1, z: 0 });
  return b;
}

/** Iron lamp post, the village's standard fixture. Carries a light. */
export function buildLampPost(
  scene: Scene,
  mats: CelMaterialFactory,
): Structure {
  const b = new Build(scene, mats, "lamp");
  b.cyl(4, 0.14, 0.26, 6, 0, 2, 0, IRON);
  b.box(0.9, 0.1, 0.1, 0.35, 3.75, 0, IRON);
  b.cyl(0.62, 0.42, 0.3, 6, 0.75, 3.45, 0, IRON);
  b.glow(0.3, 0.3, 0.3, 0.75, 3.45, 0, FLAME);
  b.cyl(0.18, 0.1, 0.5, 6, 0.75, 3.85, 0, IRON);
  b.block({ w: 0.5, h: 4, d: 0.5, x: 0, y: 2, z: 0 });
  b.light(FLAME, 22, 2.2, 0.35, 0.75, 3.45, 0);
  return b;
}

/**
 * Moves parts that have already been built as though the frame they were drawn
 * in had moved: `m` is applied AFTER each part's own transform, so a wheel is
 * built round its own nave and then carried to its axle, and a front carriage
 * is built square and then turned on its kingpin. The result is written back
 * as an ordinary position, rotation and scaling — never as a quaternion, which
 * `MapBuilder` would then have to know to compose its own `rotation.y` with.
 */
function reframe(meshes: readonly Mesh[], m: Matrix): void {
  const s = new Vector3();
  const q = new Quaternion();
  const t = new Vector3();
  for (const mesh of meshes) {
    Matrix.Compose(mesh.scaling, Quaternion.FromEulerVector(mesh.rotation), mesh.position)
      .multiply(m)
      .decompose(s, q, t);
    mesh.scaling.copyFrom(s);
    mesh.rotation.copyFrom(q.toEulerAngles());
    mesh.position.copyFrom(t);
  }
}

/** A rotation `r` about the point (x, y, z) rather than about the origin. */
function about(x: number, y: number, z: number, r: Matrix): Matrix {
  return Matrix.Translation(-x, -y, -z).multiply(r).multiply(Matrix.Translation(x, y, z));
}

/**
 * One cart wheel, built round its own nave with the axle along Z and the
 * linchpin side at +Z: an iron tyre shrunk onto a ring of felloes, spokes
 * morticed into a hooped nave, and the axle's end and pin standing out of it.
 *
 * **Every member is its own part, because the spokes ARE the wheel.** A disc is
 * what the cart was, and a disc reads as a millstone or a barrel end at any
 * range the ink can draw it; what says wheel is the light between the spokes,
 * and that only exists if they are separate.
 *
 * `broken` is a wheel that has come off: no pin, two spokes snapped out, one
 * felloe gone and the tyre sprung off over that quarter.
 */
function cartWheel(
  b: Build,
  R: number,
  spokes: number,
  color: string,
  phase: number,
  broken = false,
): Mesh[] {
  const from = b.meshes.length;
  /** Tyre and felloe segments: enough that the rim reads round at arm's length. */
  const segs = spokes + 6;
  const step = (2 * Math.PI) / segs;
  const chord = (r: number): number => 2 * r * Math.sin(step / 2) + 0.012;
  const tyreT = 0.028;
  const felloeD = 0.08;
  const hubR = R * 0.22;
  const hubLen = R * 0.55;
  const hubZ = -0.04;
  /** Where each member sits on the circle: its own +Y points out along `a`. */
  const at = (r: number, a: number): [number, number] => [-Math.sin(a) * r, Math.cos(a) * r];
  for (let i = 0; i < segs; i++) {
    // The gap in a broken wheel is one felloe's worth, and the tyre that ran
    // over it has sprung clear of the three either side.
    const lost = broken && i >= 2 && i <= 4;
    const a = phase + i * step;
    if (!lost || i === 3) {
      if (!(broken && i === 3)) {
        const rf = R - tyreT - felloeD / 2;
        const [fx, fy] = at(rf, a);
        b.box(chord(rf), felloeD, 0.075, fx, fy, 0, color, { z: a });
      }
    }
    if (!lost) {
      const rt = R - tyreT / 2;
      const [tx, ty] = at(rt, a);
      b.box(chord(rt), tyreT, 0.088, tx, ty, 0, IRON, { z: a });
    }
  }
  const r0 = hubR * 0.9;
  const r1 = R - tyreT - felloeD + 0.02;
  for (let i = 0; i < spokes; i++) {
    if (broken && (i === 1 || i === 2)) continue;
    const a = phase + (i + 0.5) * ((2 * Math.PI) / spokes);
    const [sx, sy] = at((r0 + r1) / 2, a);
    b.box(0.048, r1 - r0, 0.038, sx, sy, 0, color, { z: a });
  }
  // The nave: fatter where the spokes go in, tapering to both ends, hooped at
  // each. `x: PI/2` stands a cylinder's top on +Z.
  const half = hubLen / 2;
  b.cyl(half, hubR * 1.7, hubR * 2, 10, 0, 0, hubZ + half / 2, color, { x: Math.PI / 2 });
  b.cyl(half, hubR * 2, hubR * 1.8, 10, 0, 0, hubZ - half / 2, color, { x: Math.PI / 2 });
  for (const k of [-1, 1]) {
    const d = k > 0 ? hubR * 1.78 : hubR * 1.88;
    b.cyl(0.03, d, d, 10, 0, 0, hubZ + k * (half - 0.03), IRON, { x: Math.PI / 2 });
  }
  if (!broken) {
    // The axle's end through the nave, and the linchpin through the axle.
    b.cyl(0.07, 0.075, 0.075, 8, 0, 0, hubZ + half + 0.03, IRON, { x: Math.PI / 2 });
    b.box(0.022, 0.13, 0.022, 0, 0.005, hubZ + half + 0.045, IRON);
  }
  return b.meshes.slice(from);
}

/**
 * A full hessian sack lying along X, tied at +X, built on its own belly.
 *
 * **It is SOFT, and that is the whole of what separates it from a bottle**: a
 * straight prism with a neck on it is one, however it is coloured. So the belly
 * swells between a bottom end that is gathered rather than cut flat and a
 * shoulder that slumps down into the tie, and the whole of it is squashed
 * flatter than it is wide, the way a full sack settles on a floor.
 */
function cartSack(b: Build): Mesh[] {
  const from = b.meshes.length;
  // Each piece is a cylinder laid along X (`z: PI/2` puts its top at -X, and
  // `-PI/2` at +X) and squashed upright, its own X being what stands after
  // the turn — so the squash is `scaling.x`, and the belly sits at `Y`.
  const Y = 0.14;
  const piece = (h: number, dTop: number, dBot: number, x: number, toward: 1 | -1): void => {
    b.cyl(h, dTop, dBot, 8, x, Y, 0, SAILCLOTH, { z: (-toward * Math.PI) / 2 }).scaling.x = 0.6;
  };
  piece(0.1, 0.28, 0.46, -0.32, -1);
  piece(0.4, 0.46, 0.42, -0.07, -1);
  piece(0.22, 0.2, 0.46, 0.24, 1);
  b.cyl(0.035, 0.1, 0.1, 6, 0.37, Y + 0.01, 0, PITCH, { z: -Math.PI / 2 });
  b.cyl(0.09, 0.16, 0.07, 6, 0.42, Y + 0.02, 0, SAILCLOTH, { z: -Math.PI / 2 + 0.25 });
  return b.meshes.slice(from);
}

/** A hay fork lying along X, tines at +X, on its own shaft. */
function cartFork(b: Build): Mesh[] {
  const from = b.meshes.length;
  b.cyl(1.5, 0.035, 0.04, 6, 0, 0, 0, TIMBER, { z: Math.PI / 2 });
  b.box(0.1, 0.035, 0.035, 0.78, 0, 0, IRON);
  b.box(0.035, 0.03, 0.24, 0.84, 0, 0, IRON);
  for (const z of [-0.11, 0, 0.11]) b.box(0.34, 0.016, 0.016, 1.0, 0.01, z, IRON, { z: 0.08 });
  return b.meshes.slice(from);
}

/** A cask standing on end, its foot at y = 0. */
function cartCask(b: Build, h: number, d: number): Mesh[] {
  const from = b.meshes.length;
  b.cyl(h / 2, d, d * 0.86, 10, 0, h / 4, 0, PLANK);
  b.cyl(h / 2, d * 0.86, d, 10, 0, (h * 3) / 4, 0, PLANK);
  for (const y of [0.08, 0.3, 0.7, 0.92]) {
    const k = 1 - Math.abs(y - 0.5) * 0.28;
    b.cyl(0.035, d * k + 0.02, d * k + 0.02, 10, 0, h * y, 0, IRON);
  }
  b.cyl(0.02, d * 0.8, d * 0.8, 10, 0, h - 0.005, 0, TIMBER);
  return b.meshes.slice(from);
}

/**
 * Farm wagon, bed along X, shafts to +X. Chest-high cover with a readable
 * silhouette — spoked wheels, a flared box on a turned front carriage, and the
 * shafts run out along the ground — so it never reads as a crate. `ruined`
 * has lost its near hind wheel and sits down on that corner, for ground that
 * has already been fought over.
 *
 * **It is built the way one is built, and that is the whole of the brief.**
 * The cart it replaces was a plank box on four discs with its shafts hanging in
 * the air, and every one of those three was a thing a player standing beside it
 * could see was not a cart. So: big wheels behind and small ones in front, the
 * front pair on a turntable under the bed so they can lock round, and locked
 * round a little, because nobody leaves a wagon with its wheels dead straight;
 * a perch coupling the two axles, hounds bracing each; a floor of boards on
 * bearers between two sills; sides that flare outward on staked standards
 * to a rave; a headboard and a pinned tailboard on chains; and the shafts,
 * unhitched, resting their tips on the ground — which is where a pair of
 * timbers pinned at one end goes when the horse walks out of them.
 *
 * **Everything that is not the collider is drawing**, and the collider is the
 * one box it has always been: 3.4 x 1.7 x 2.0, hard cover, in the same order.
 * The shafts, the naves, a load heaped over the rave and anything spilled on
 * the ground stand outside it, as the old shafts did — a round through a
 * shaft's tip or a tuft of hay is a round through dressing.
 *
 * **What it carries, and how it is kept, are seeded off where it stands**
 * (`streetSeed`), which is what puts it in `CONFORMS_TO_TERRAIN`: loose straw
 * and a fork, sacks, a heaped load of hay or casks; bare weathered timber or
 * the painted body and red running gear a wagon was sold in; which way the
 * front wheels are locked; and whether a chock sits behind a hind wheel. And it
 * SITS on the ground under its four wheels rather than on the one sample under
 * its middle — pitched and rolled to it, within reason — so a wagon on a slope
 * has all four tyres on the road.
 */
export function buildCart(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "cart");
  const ruined = p.ruined ?? false;
  const seed = streetSeed(3.4, 2.0, 1.7, ctx);
  /**
   * Painted — a blue body over red-oxide running gear, faded to what the
   * palette already has — or bare timber gone grey.
   */
  const painted = !ruined && (seed >>> 3) % 3 === 0;
  const BODY = painted ? ENAMEL : PLANK;
  const GEAR = painted ? BRICK : TIMBER;
  /** 0 straw and a fork, 1 sacks, 2 a load of hay, 3 casks. */
  const load = (seed >>> 7) % 4;
  /** Which way, and how far, the front wheels are locked. */
  const lock = (((seed >>> 11) & 1) === 0 ? -1 : 1) * (0.1 + ((seed >>> 12) % 5) * 0.035);
  const chocked = ((seed >>> 17) & 1) === 0;

  // ---- the numbers everything hangs off. Bed along X, shafts to +X.
  /** Hind and fore axle stations, and their wheels' radii — the hind pair big. */
  const XR = -0.95;
  const XF = 1.05;
  const RR = 0.66;
  const RF = 0.5;
  /** Where the wheels' planes stand either side of the centreline. */
  const TRACK = 0.9;
  /** The sills' underside, the floor's top, and the body's length. */
  const SILL = 0.84;
  const SILL_TOP = SILL + 0.14;
  const FLOOR = SILL_TOP + 0.035;
  const L = 3.1;
  const HL = L / 2;
  /**
   * The sides: they rise from the floor's edge at `SIDE_Z` and lean OUT by
   * `LEAN` for `SLANT` metres, to a rave at about the collider's top. The flare
   * is what a wagon box is — it is also what keeps the hind wheels, which stand
   * above the floor, clear of the boarding.
   */
  const SIDE_Z = 0.63;
  const LEAN = 0.24;
  const SLANT = 0.7;
  const cosL = Math.cos(LEAN);
  const sinL = Math.sin(LEAN);
  /** A point `s` up the slope of the side at `sz`, stood `n` off its outer face. */
  const onSide = (sz: number, s: number, n: number): [number, number] => [
    SILL_TOP + s * cosL - n * sinL,
    sz * (SIDE_Z + s * sinL + n * cosL),
  ];

  /**
   * The floor under a local point, as a local height, or 0 with nothing to
   * read — and 0 for a placement lifted onto something `MapBuilder` does not
   * know about (see `BuildCtx.floor`). `MapBuilder`'s rotation: local +X lands
   * on (cos, -sin), +Z on (sin, cos).
   */
  const ground = (lx: number, lz: number): number => {
    if (!ctx || Math.abs(ctx.y - ctx.floor) > 0.05) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    const h = ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
    return Math.max(-0.4, Math.min(0.4, h));
  };

  // ================================================================ the body
  // Built level, on its own frame; the ruin sits it down afterwards.
  const bodyFrom = b.meshes.length;
  // Two sills the length of the bed, and the end rails and bearers between.
  for (const sz of [-1, 1]) b.box(L + 0.06, 0.14, 0.1, 0, SILL + 0.07, sz * 0.58, GEAR);
  for (const sx of [-1, 1]) b.box(0.1, 0.14, 1.26, sx * (HL - 0.05), SILL + 0.07, 0, GEAR);
  for (const x of [-0.95, -0.3, 0.35, 1.0]) b.box(0.08, 0.1, 1.06, x, SILL + 0.09, 0, GEAR);
  // The floor: six boards, a finger's gap apart.
  {
    const bw = 0.2;
    const gap = 0.012;
    for (let i = 0; i < 6; i++) {
      const z = -0.63 + bw / 2 + i * (bw + gap);
      b.box(L - 0.02 - (i % 2) * 0.03, 0.035, bw, (i % 2) * 0.015, SILL_TOP + 0.0175, z, BODY);
    }
  }
  // The sides: three boards up the flare, each leaned out by `LEAN`.
  //
  // **The boards LAP rather than butt**: each overlaps the one under it and
  // the middle one stands `LAP` proud, so every joint is a step the ink finds
  // on both faces. A gap between square boards drew the same line and let a
  // lit window across the street shine through the cart.
  const BOARD = 0.237;
  const LAP = 0.007;
  const boardS = (i: number): number => BOARD / 2 + i * BOARD;
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const [y, z] = onSide(sz, boardS(i), 0.0175 + (i % 2) * LAP);
      b.box(L - 0.04, BOARD + 0.012, 0.035, 0, y, z, BODY, { x: sz * LEAN });
    }
    // Standards on the outer face, from the sill to the rave, with an iron
    // knee where each one meets the sill.
    for (const x of [-(HL - 0.05), -0.78, 0, 0.78, HL - 0.05]) {
      const [y, z] = onSide(sz, 0.29, 0.06);
      b.box(0.075, 0.86, 0.05, x, y, z, GEAR, { x: sz * LEAN });
      const [ky, kz] = onSide(sz, 0.02, 0.09);
      b.box(0.09, 0.14, 0.012, x, ky, kz, IRON, { x: sz * LEAN });
    }
    // The rave along the top, standing a little proud of the standards.
    {
      const [y, z] = onSide(sz, SLANT + 0.035, 0.035);
      b.box(L + 0.14, 0.075, 0.09, 0, y, z, GEAR, { x: sz * LEAN });
      // An iron cap over each end of it.
      for (const sx of [-1, 1]) {
        b.box(0.1, 0.085, 0.1, sx * (HL + 0.02), y, z, IRON, { x: sz * LEAN });
      }
    }
  }
  /** The body's half-width across the inside of its sides, at slope `s`. */
  const across = (s: number): number => 2 * (SIDE_Z + s * sinL);
  // The headboard, capped with a rail level with the raves. Its boards are
  // as tall as the sides' in plan, so their joints line through the corner.
  for (let i = 0; i < 3; i++) {
    const s = boardS(i);
    b.box(0.035, BOARD * cosL + 0.012, across(s), HL - 0.02 + (i % 2) * LAP, SILL_TOP + s * cosL, 0, BODY);
  }
  b.box(0.07, 0.07, across(SLANT) + 0.04, HL, SILL_TOP + 3 * BOARD * cosL + 0.02, 0, GEAR);
  for (const sz of [-1, 1]) {
    // Its two uprights, from the sill to the cap.
    b.box(0.075, 0.86, 0.05, HL + 0.035, SILL_TOP + 0.28, sz * 0.5, GEAR);
  }
  // The tailboard is its own piece: it comes out. On a ruin it has.
  const tailFrom = b.meshes.length;
  for (let i = 0; i < 3; i++) {
    const s = boardS(i);
    b.box(0.035, BOARD * cosL + 0.012, across(s) - 0.02, -(i % 2) * LAP, SILL_TOP + s * cosL, 0, BODY);
  }
  for (const sz of [-1, 1]) {
    b.box(0.012, 0.66, 0.06, -0.03, SILL_TOP + 0.34, sz * 0.4, IRON);
  }
  const tail = b.meshes.slice(tailFrom);
  if (!ruined) {
    reframe(tail, Matrix.Translation(-(HL - 0.02), 0, 0));
    // Pinned through the end standards, a chain from each top corner.
    for (const sz of [-1, 1]) {
      const [y, z] = onSide(sz, 0.62, 0.02);
      b.box(0.14, 0.022, 0.022, -(HL + 0.03), y, z, IRON);
      for (let k = 0; k < 4; k++) {
        b.box(0.02, 0.06, 0.035, -(HL + 0.06), y - 0.05 - k * 0.05, z - sz * 0.02 * k, IRON, {
          y: k % 2 ? Math.PI / 2 : 0,
        });
      }
    }
  }

  // ---- the hind carriage: fixed to the body, so it goes where the body goes.
  b.box(0.14, 0.14, 1.36, XR, RR, 0, GEAR);
  b.box(0.15, SILL - (RR + 0.07), 1.3, XR, (SILL + RR + 0.07) / 2, 0, GEAR);
  for (const sz of [-1, 1]) {
    b.box(0.17, 0.26, 0.03, XR, RR + 0.06, sz * 0.46, IRON);
  }
  // The perch, coupling the hind axle to the fore, and the hounds bracing it.
  b.box(XF - XR + 0.3, 0.09, 0.1, (XF + XR) / 2 + 0.05, RR - 0.08, 0, GEAR);
  {
    const x0 = XR;
    const x1 = XR + 0.95;
    const z0 = 0.42;
    const len = Math.hypot(x1 - x0, z0);
    for (const sz of [-1, 1]) {
      b.box(len, 0.07, 0.07, (x0 + x1) / 2, RR - 0.08, (sz * z0) / 2, GEAR, {
        y: sz * Math.atan2(z0, x1 - x0),
      });
    }
  }
  // The fore bolster under the body, and the turntable ring it bears on.
  b.box(0.14, 0.1, 1.2, XF, SILL - 0.05, 0, GEAR);
  b.cyl(0.03, 0.8, 0.8, 14, XF, SILL - 0.115, 0, IRON);
  // The hind wheels.
  for (const sz of [-1, 1]) {
    if (ruined && sz < 0) continue;
    const w = cartWheel(b, RR, 12, GEAR, 0.13 * sz + ((seed >>> 20) % 7) * 0.07);
    const flip = sz < 0 ? Matrix.RotationY(Math.PI) : Matrix.Identity();
    reframe(w, flip.multiply(Matrix.Translation(XR, RR, sz * TRACK)));
  }
  // A drag shoe hung on its chain from the near sill, ahead of the hind wheel,
  // as every wagon that ever went down a hill carried one.
  if (!ruined) {
    const x = XR + RR + 0.12;
    for (let k = 0; k < 5; k++) {
      b.box(0.035, 0.07, 0.02, x, SILL - 0.04 - k * 0.065, -0.66, IRON, { y: k % 2 ? Math.PI / 2 : 0 });
    }
    b.box(0.34, 0.05, 0.1, x - 0.1, SILL - 0.4, -0.66, IRON, { z: 0.35 });
    b.box(0.04, 0.1, 0.1, x - 0.26, SILL - 0.37, -0.66, IRON, { z: 0.35 });
  }
  // A step iron hung off the off-side sill by the front.
  b.box(0.03, 0.26, 0.03, XF - 0.45, SILL - 0.1, 0.66, IRON);
  b.box(0.18, 0.025, 0.1, XF - 0.45, SILL - 0.23, 0.69, IRON);

  // ---- the load, on the floor.
  const loadFrom = b.meshes.length;
  const onFloor = (meshes: Mesh[], x: number, z: number, yaw: number, lift = 0, roll = 0): void =>
    reframe(
      meshes,
      Matrix.RotationX(roll).multiply(Matrix.RotationY(yaw)).multiply(Matrix.Translation(x, FLOOR + lift, z)),
    );
  if (ruined) {
    // What is left of the sacks has slid to the low corner.
    onFloor(cartSack(b), -0.95, -0.22, 0.15, 0, -0.1);
    onFloor(cartSack(b), 0.1, -0.24, -0.1);
  } else if (load === 0) {
    // Loose straw left in drifts over the boards — low cones squashed flat,
    // since a slab of it is a plank — and a fork thrown in on top.
    for (const [x, z, d, h, sx] of [
      [-0.85, 0.15, 0.95, 0.16, 1.5],
      [0.25, -0.22, 0.8, 0.12, 1.7],
      [1.0, 0.25, 0.6, 0.1, 1.2],
      [-0.2, 0.3, 0.5, 0.08, 1.4],
    ] as const) {
      b.cyl(h, d * 0.3, d, 6, x, FLOOR + h / 2 - 0.01, z, STRAW, { y: x }).scaling.x = sx;
    }
    onFloor(cartFork(b), -0.7, -0.1, -0.35, 0.07, 0.05);
  } else if (load === 1) {
    // Sacks, laid two ways as they were thrown up.
    const SACKS: [number, number, number, number][] = [
      [-1.05, -0.3, 0.1, 0],
      [-1.05, 0.28, -0.05, 0],
      [-0.25, -0.28, 0.0, 0],
      [-0.25, 0.3, 0.12, 0],
      [0.6, -0.1, 1.5, 0],
      [-0.65, 0.0, 0.08, 0.24],
      [0.15, 0.02, -0.1, 0.24],
    ];
    for (const [x, z, yaw, lift] of SACKS) {
      if (lift > 0 && ((seed >>> 22) & 1) === 0 && x > 0) continue;
      onFloor(cartSack(b), x, z, yaw, lift);
    }
  } else if (load === 2) {
    // A load of hay heaped over the rave. The box fills the bed to the rave and
    // is all but hidden by it; what shows is a row of heaps over it, each a
    // shoulder and a crown stacked as the haystack's cap is, overlapping into
    // one ridge that rises and falls, and spread past the rave on both sides
    // the way a load is built. A single loaf drawn with seven facets read as a
    // lid; hanging wisps and loose stalks read as flaps and slots.
    b.box(L - 0.12, 0.62, 1.34, 0, FLOOR + 0.3, 0, STRAW);
    const HAY = FLOOR + 0.56;
    for (const [x, h, yaw] of [
      [-1.2, 0.34, 0.2],
      [-0.62, 0.48, 1.1],
      [-0.05, 0.42, 0.5],
      [0.5, 0.5, 1.6],
      [0.9, 0.32, 0.9],
    ] as const) {
      const sh = h * 0.5;
      b.cyl(sh, 1.3, 1.62, 7, x, HAY + sh / 2, 0, STRAW, { y: yaw }).scaling.x = 0.72;
      b.cyl(h - sh, 0.4, 1.3, 7, x, HAY + sh + (h - sh) / 2, 0, STRAW, { y: yaw + 0.45 }).scaling.x = 0.72;
    }
    const fork = cartFork(b);
    reframe(
      fork,
      Matrix.RotationZ(-0.75).multiply(Matrix.RotationY(0.5)).multiply(Matrix.Translation(-0.35, FLOOR + 1.02, 0.15)),
    );
  } else {
    // Casks stood on end and a crate, with a sack wedged against them.
    onFloor(cartCask(b, 0.78, 0.56), -0.95, -0.26, 0);
    onFloor(cartCask(b, 0.78, 0.56), -0.95, 0.3, 0.7);
    onFloor(cartCask(b, 0.62, 0.46), -0.3, 0.3, 0.2);
    b.box(0.7, 0.5, 0.56, 0.45, FLOOR + 0.25, -0.2, TIMBER, { y: 0.15 });
    for (const dx of [-0.33, 0.33]) {
      b.box(0.06, 0.52, 0.6, 0.45 + dx * Math.cos(0.15), FLOOR + 0.26, -0.2 - dx * Math.sin(0.15), PLANK, { y: 0.15 });
    }
    onFloor(cartSack(b), 0.45, 0.35, 0.1);
  }
  const loadMeshes = b.meshes.slice(loadFrom);
  const body = b.meshes.slice(bodyFrom, loadFrom).filter((m) => !tail.includes(m) || !ruined);

  // ====================================================== the fore carriage
  // Built square on its own axle, then turned on the kingpin by `lock`.
  const foreFrom = b.meshes.length;
  b.box(0.13, 0.13, 1.44, XF, RF, 0, GEAR);
  b.box(0.14, SILL - 0.13 - (RF + 0.065), 1.16, XF, (SILL - 0.13 + RF + 0.065) / 2, 0, GEAR);
  b.cyl(0.46, 0.05, 0.05, 6, XF, SILL - 0.16, 0, IRON);
  for (const sz of [-1, 1]) b.box(0.16, 0.24, 0.03, XF, RF + 0.05, sz * 0.44, IRON);
  // The fore hounds, from a slider bar under the perch out to the shaft pins.
  /** Where each shaft is pinned, and the height it is pinned at. */
  const PX = XF + 0.5;
  const PZ = 0.36;
  const PY = RF + 0.02;
  {
    const x0 = XF - 0.55;
    const z0 = 0.12;
    const len = Math.hypot(PX - x0, PZ - z0);
    for (const sz of [-1, 1]) {
      b.box(len, 0.075, 0.07, (x0 + PX) / 2, PY, (sz * (z0 + PZ)) / 2, GEAR, {
        y: -sz * Math.atan2(PZ - z0, PX - x0),
      });
    }
    b.box(0.07, 0.06, 0.5, x0, RR - 0.15, 0, GEAR);
  }
  for (const sz of [-1, 1]) {
    const w = cartWheel(b, RF, 10, GEAR, 0.21 * sz + ((seed >>> 24) % 5) * 0.09);
    const flip = sz < 0 ? Matrix.RotationY(Math.PI) : Matrix.Identity();
    reframe(w, flip.multiply(Matrix.Translation(XF, RF, sz * TRACK)));
  }
  // The shafts, unhitched: pinned at the hounds and resting their tips on the
  // ground ahead, which is where they fall when the horse walks out of them.
  // The ruin has snapped one and the rest of it lies where it fell.
  const SHAFT = 2.75;
  const tip = 0.05;
  const pitch = -Math.asin((PY - tip) / SHAFT);
  const along = (d: number): [number, number] => [PX + Math.cos(pitch) * d, PY + Math.sin(pitch) * d];
  for (const sz of [-1, 1]) {
    const snapped = ruined && sz > 0;
    const len = snapped ? 1.25 : SHAFT;
    const [x, y] = along(len / 2);
    b.box(len, 0.085, 0.07, x, y, sz * PZ, GEAR, { z: pitch });
    b.box(0.1, 0.11, 0.09, PX, PY, sz * PZ, IRON);
    if (!snapped) {
      const [tx, ty] = along(SHAFT - 0.05);
      b.box(0.1, 0.1, 0.085, tx, ty, sz * PZ, IRON, { z: pitch });
      const [hx, hy] = along(1.55);
      b.box(0.12, 0.05, 0.03, hx, hy + 0.05, sz * (PZ + 0.05), IRON, { z: pitch });
      b.box(0.03, 0.08, 0.03, hx + 0.05, hy + 0.08, sz * (PZ + 0.05), IRON, { z: pitch });
    }
  }
  {
    const [x, y] = along(0.35);
    b.box(0.07, 0.07, 2 * PZ + 0.1, x, y + 0.01, 0, GEAR, { z: pitch });
  }
  const fore = b.meshes.slice(foreFrom);
  reframe(fore, about(XF, 0, 0, Matrix.RotationY(lock)));

  // ================================================================ the ruin
  // The near hind wheel is off and the body has come down on that corner,
  // pitched back and rolled toward it about the turntable, with the axle's end
  // propped on a log somebody got under it.
  const loose: Mesh[] = [];
  if (ruined) {
    const sit = about(XF, SILL - 0.1, 0, Matrix.RotationZ(0.12).multiply(Matrix.RotationX(-0.26)));
    reframe([...body, ...loadMeshes], sit);
    // A log rolled under the axle-tree's end, wherever the sit put it.
    const stub = Vector3.TransformCoordinates(new Vector3(XR, RR, -0.62), sit);
    const propD = Math.max(0.12, stub.y - 0.07);
    b.cyl(0.6, propD, propD * 1.08, 7, stub.x, propD / 2, stub.z, TIMBER, { x: Math.PI / 2, y: 0.3 });
    // The wheel, face down where it came off and canted up on its nave.
    const w = cartWheel(b, RR, 12, GEAR, 0.4, true);
    reframe(
      w,
      Matrix.RotationX(Math.PI / 2)
        .multiply(Matrix.RotationZ(0.14))
        .multiply(Matrix.RotationY(0.6))
        .multiply(Matrix.Translation(XR - 0.35, 0.17 + ground(XR - 0.35, -1.75), -1.75)),
    );
    loose.push(...w);
    // The tailboard, flat on the ground behind, irons up.
    reframe(
      tail,
      Matrix.Translation(0, -(SILL_TOP + 0.35), 0)
        .multiply(Matrix.RotationZ(-Math.PI / 2))
        .multiply(Matrix.RotationY(0.25))
        .multiply(Matrix.Translation(-HL - 0.75, 0.02 + ground(-HL - 0.75, 0.2), 0.2)),
    );
    loose.push(...tail);
    // The broken half of the shaft, and a sack that went over the side.
    const brokenFrom = b.meshes.length;
    b.box(1.45, 0.085, 0.07, 0, 0.04, 0, GEAR);
    b.box(0.1, 0.1, 0.085, 0.68, 0.045, 0, IRON);
    reframe(
      b.meshes.slice(brokenFrom),
      Matrix.RotationY(-0.5).multiply(Matrix.Translation(PX + 2.0, ground(PX + 2.0, 1.0), 1.0)),
    );
    loose.push(...b.meshes.slice(brokenFrom));
    const sack = cartSack(b);
    reframe(
      sack,
      Matrix.RotationX(0.2).multiply(Matrix.RotationY(1.2)).multiply(Matrix.Translation(-0.6, ground(-0.6, -1.35), -1.35)),
    );
    loose.push(...sack);
  } else if (chocked) {
    // A chock behind a hind wheel.
    const x = XR - 0.34;
    const from = b.meshes.length;
    b.box(0.24, 0.13, 0.14, x, 0.05 + ground(x, TRACK), TRACK, TIMBER, { z: -0.3 });
    loose.push(...b.meshes.slice(from));
  }

  // ============================================================ the ground
  // Sit the whole cart down on the ground under its four wheels: the pitch
  // between the axles, the roll across them, and the lift that puts all four
  // tyres on the floor. Anything already lying on the ground found its own.
  const gF = (ground(XF, TRACK) + ground(XF, -TRACK)) / 2;
  const gR = (ground(XR, TRACK) + ground(XR, -TRACK)) / 2;
  const gP = (ground(XF, TRACK) + ground(XR, TRACK)) / 2;
  const gN = (ground(XF, -TRACK) + ground(XR, -TRACK)) / 2;
  const clamp = (v: number): number => Math.max(-0.18, Math.min(0.18, v));
  const pitchG = clamp(Math.atan2(gF - gR, XF - XR));
  const rollG = clamp(Math.atan2(gP - gN, 2 * TRACK));
  const lift = (gF + gR) / 2 - ((XF + XR) / 2) * Math.tan(pitchG);
  if (pitchG !== 0 || rollG !== 0 || lift !== 0) {
    const standing = b.meshes.filter((m) => !loose.includes(m));
    reframe(
      standing,
      Matrix.RotationZ(pitchG).multiply(Matrix.RotationX(-rollG)).multiply(Matrix.Translation(0, lift, 0)),
    );
  }

  b.block({ w: 3.4, h: 1.7, d: 2.0, x: 0, y: 0.85, z: 0 });
  return b;
}

/** Stack of crates and barrels — waist-to-chest cover for yards and docks. */
export function buildCrates(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "crates");
  b.box(1.5, 1.2, 1.4, -0.6, 0.6, 0, PLANK);
  b.box(1.3, 1.1, 1.3, 0.8, 0.55, 0.3, TIMBER);
  b.box(1.2, 1.0, 1.1, -0.35, 1.7, -0.15, TIMBER, { y: 0.4 });
  // Barrel leaning against the stack.
  b.cyl(1.3, 0.85, 0.95, 8, 0.9, 0.65, -0.9, PLANK);
  for (const y of [0.35, 0.95]) {
    b.cyl(0.12, 0.99, 0.99, 8, 0.9, y, -0.9, IRON);
  }
  b.block({ w: 3.2, h: 2.3, d: 2.6, x: 0.1, y: 1.15, z: 0 });
  return b;
}

/**
 * Woodpile: a cord of split firewood in two rows, stacked ends-out on a pair
 * of bearers and held at each end — cover to stand behind in a yard or behind
 * a house. Long along X; both long faces (±Z) show end grain.
 *
 * **It is built the way one is stacked.** The pile it replaces was six 5 m
 * poles between two posts: three courses of telegraph pole, the one thing a
 * woodpile never is. So: two bearer poles on flat stones to keep the wood off
 * the damp, and on them two rows of billets laid ACROSS the pile, so every
 * one shows its sawn end on a face — rounds, halves and split quarters in
 * courses that do not quite line up, each end cut at its own angle and
 * standing out of the face by its own few centimetres, weathered grey most of
 * them and a few fresh-cut and pale. Behind the ends is the dark of the stack
 * itself, which is what the gaps between them are drawn in. Each end is held
 * either by a pair of posts with a batten across their heads or by a crib — a
 * square tower of billets laid crosswise course by course, which is how a
 * pile is ended with nothing but the wood it is made of. On top it is left
 * open with a few billets thrown on (and sometimes an axe in one), or covered
 * against the rain with boards or lapped iron sheets weighted with stones,
 * pitched to shed the water off one face. Some piles have lost a few billets
 * onto the ground in front.
 *
 * **Billets are one surface per colour, not a part each**: a billet is its
 * sawn end and a ring of sides carrying the bark, with no far end, because
 * the far end is inside the stack — three vertices per corner. That is what
 * keeps some three hundred billets inside a structure's budget on a prop
 * Cinderhaven places fifty-one times.
 *
 * **The collider is the box it has always been**, len x 1.9 x 1.3, first and
 * alone. The sawn ends stand from flush to 4 cm proud of its faces, so a
 * round stops on wood and never short of it, and the dark of the stack is
 * 5 cm behind the faces. The top course fills to the box's top, and the
 * cover, the posts' heads and whatever is thrown on stand on it; the bearers,
 * the pads and the fallen billets are under 0.2 m and walked over.
 *
 * Seeded off where it stands (`streetSeed`) — how it is ended and covered,
 * and every billet — and its posts and pads are carried down to the ground,
 * which puts `woodpile` in `CONFORMS_TO_TERRAIN`.
 */
export function buildWoodpile(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "woodpile");
  const len = p.length ?? 5;
  // ---- the collider: the box it has always been.
  b.block({ w: len, h: 1.9, d: 1.3, x: 0, y: 0.95, z: 0 });

  const seed = streetSeed(len, 1.3, 1.9, ctx);
  const rnd = mulberry32(seed);
  const crib = (seed >>> 3) % 5 < 2;
  const cover = (["open", "boards", "iron"] as const)[(seed >>> 6) % 3];
  const axe = cover === "open" && (seed >>> 9) % 2 === 0;
  /** Which face the fallen billets lie in front of, or 0 for none. */
  const spill = (seed >>> 11) % 4 === 0 ? 0 : (seed >>> 13) % 2 === 0 ? -1 : 1;

  /** The floor under a local point, as a local height — the shed's reading. */
  const ground = (lx: number, lz: number): number => {
    if (!ctx || Math.abs(ctx.y - ctx.floor) > 0.05) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    const g = ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
    return Math.max(-0.5, Math.min(0.3, g));
  };

  // ---- the numbers everything hangs off.
  /** The collider's top, which the top course fills to. */
  const H = 1.9;
  /** The stack's foot: the bearers' tops. */
  const BASE = 0.12;
  /** Where the dark of the stack stands behind the sawn ends. */
  const CORE = 0.6;
  /** Where the face billets stop at each end: short of the posts, or of the crib. */
  const xEnd = crib ? len / 2 - 0.5 : len / 2 - 0.13;
  /** The cover's slope across the pile, and which face it sheds onto. */
  const fall = (rnd() < 0.5 ? -1 : 1) * 0.06;

  // ---- the billets, accumulated per colour and emitted as one surface each.
  type Acc = { pos: number[]; nrm: number[]; uv: number[]; idx: number[] };
  const accs = new Map<string, Acc>();
  const acc = (c: string): Acc => {
    let a = accs.get(c);
    if (!a) accs.set(c, (a = { pos: [], nrm: [], uv: [], idx: [] }));
    return a;
  };
  const vert = (a: Acc, q: Point3, n: Point3): number => {
    a.pos.push(q[0], q[1], q[2]);
    a.nrm.push(n[0], n[1], n[2]);
    a.uv.push(q[0] + q[2], q[1]);
    return a.pos.length / 3 - 1;
  };
  /** One triangle, wound so its cross product points INTO the solid (see `convexSolid`). */
  const tri = (a: Acc, i: number, j: number, k: number, out: Point3): void => {
    const P = a.pos;
    const u = [P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]];
    const v = [P[k * 3] - P[i * 3], P[k * 3 + 1] - P[i * 3 + 1], P[k * 3 + 2] - P[i * 3 + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] > 0) a.idx.push(i, k, j);
    else a.idx.push(i, j, k);
  };
  const unit = (v: Point3): Point3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  /** `o + u x + v y + w t`: a point in a billet's own frame. */
  const at = (o: Point3, u: Point3, v: Point3, w: Point3, x: number, y: number, t: number): Point3 => [
    o[0] + u[0] * x + v[0] * y + w[0] * t,
    o[1] + u[1] * x + v[1] * y + w[1] * t,
    o[2] + u[2] * x + v[2] * y + w[2] * t,
  ];
  const ORIGIN: Point3 = [0, 0, 0];
  /**
   * A billet: `poly` (convex, in the u/v plane about `o`) run along `w` from
   * `t0` to `t1`. Its sides are the BARK, smooth round the corners; an end is
   * SAWN in the colour given, cut on a tilt (the cap's slope in u and v), and
   * an end given null is inside the stack and not drawn at all.
   */
  const billet = (
    o: Point3,
    u: Point3,
    v: Point3,
    w: Point3,
    poly: [number, number][],
    t0: number,
    t1: number,
    grain0: string | null,
    grain1: string | null,
    tilt0: [number, number] = [0, 0],
    tilt1: [number, number] = [0, 0],
  ): void => {
    const n = poly.length;
    const cx = poly.reduce((sum, q) => sum + q[0], 0) / n;
    const cy = poly.reduce((sum, q) => sum + q[1], 0) / n;
    const tAt = (end: 0 | 1, q: [number, number]): number => {
      const [tx, ty] = end ? tilt1 : tilt0;
      return (end ? t1 : t0) + tx * (q[0] - cx) + ty * (q[1] - cy);
    };
    /** Edge i's outward normal in the u/v plane. */
    const edgeN = (i: number): [number, number] => {
      const a = poly[i];
      const c = poly[(i + 1) % n];
      let nx = c[1] - a[1];
      let ny = a[0] - c[0];
      if (nx * ((a[0] + c[0]) / 2 - cx) + ny * ((a[1] + c[1]) / 2 - cy) < 0) [nx, ny] = [-nx, -ny];
      const l = Math.hypot(nx, ny) || 1;
      return [nx / l, ny / l];
    };
    // The bark: each corner's normal is the mean of its two edges'.
    const bark = acc(TIMBER);
    const ring: number[] = [];
    for (let i = 0; i < n; i++) {
      const e0 = edgeN((i + n - 1) % n);
      const e1 = edgeN(i);
      const nn = unit(at(ORIGIN, u, v, w, e0[0] + e1[0], e0[1] + e1[1], 0));
      const q = poly[i];
      ring.push(vert(bark, at(o, u, v, w, q[0], q[1], tAt(0, q)), nn));
      ring.push(vert(bark, at(o, u, v, w, q[0], q[1], tAt(1, q)), nn));
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const e = edgeN(i);
      const out = at(ORIGIN, u, v, w, e[0], e[1], 0);
      tri(bark, ring[i * 2], ring[j * 2], ring[j * 2 + 1], out);
      tri(bark, ring[i * 2], ring[j * 2 + 1], ring[i * 2 + 1], out);
    }
    // The sawn ends: flat, each on its own tilt.
    for (const end of [0, 1] as const) {
      const grain = end ? grain1 : grain0;
      if (!grain) continue;
      const [tx, ty] = end ? tilt1 : tilt0;
      const sg = end ? 1 : -1;
      const out = unit(at(ORIGIN, u, v, w, -tx * sg, -ty * sg, sg));
      const a = acc(grain);
      const ids = poly.map((q) => vert(a, at(o, u, v, w, q[0], q[1], tAt(end, q)), out));
      for (let i = 1; i + 1 < n; i++) tri(a, ids[0], ids[i], ids[i + 1], out);
    }
  };

  /**
   * One billet's end: a round, a half or a split quarter, turned any way and
   * fitted to a w x h cell. `kind` under 0.25 asks for a round.
   */
  const outline = (w: number, h: number, kind = rnd()): [number, number][] => {
    let pts: [number, number][];
    if (kind < 0.25) {
      pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
        const r = 0.9 + rnd() * 0.1;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
    } else if (kind < 0.6) {
      pts = [0, 0.25, 0.5, 0.75, 1].map((f) => [Math.cos(f * Math.PI), Math.sin(f * Math.PI)]);
    } else {
      const spread = Math.PI * (0.45 + rnd() * 0.2);
      pts = [[0, 0], ...[0, 0.5, 1].map((f): [number, number] => [Math.cos(f * spread), Math.sin(f * spread)])];
    }
    const turn = rnd() * Math.PI * 2;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    pts = pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const k = 0.86 + rnd() * 0.1;
    return pts.map(([x, y]) => [((x - (x0 + x1) / 2) / (x1 - x0)) * w * k, ((y - (y0 + y1) / 2) / (y1 - y0)) * h * k]);
  };
  /** Weathered grey most of it, some browner, a few fresh-cut and pale. */
  const endGrain = (): string => {
    const r = rnd();
    return r < 0.55 ? THATCH : r < 0.85 ? PLANK : STRAW;
  };
  const tilt = (): [number, number] => [(rnd() - 0.5) * 0.24, (rnd() - 0.5) * 0.24];
  const X: Point3 = [1, 0, 0];
  const Y: Point3 = [0, 1, 0];
  const Z: Point3 = [0, 0, 1];

  // ---- the two faces: a row of billets behind each, laid in courses that do not line up.
  for (const s of [-1, 1]) {
    const w: Point3 = [0, 0, s];
    let y = BASE;
    while (y < H - 0.05) {
      let ch = 0.2 + rnd() * 0.07;
      if (H - y - ch < 0.14) ch = H + 0.03 - y;
      let x = -xEnd;
      while (x < xEnd - 0.06) {
        let cw = 0.2 + rnd() * 0.12;
        const first = x === -xEnd;
        const last = xEnd - x - cw < 0.14;
        if (last) cw = xEnd - x;
        // The billet at either end of a course is its bark side on the pile's
        // END: a round or a half, pulled in by its own amount, or the end is
        // one flat face of bark and reads as boarding.
        const inset = first || last ? rnd() * 0.05 : 0;
        const cx = x + cw / 2 + (first ? inset / 2 : last ? -inset / 2 : (rnd() - 0.5) * 0.02);
        const o: Point3 = [cx, y + ch / 2 + (rnd() - 0.5) * 0.02, 0];
        const shape = outline(cw - inset, ch, first || last ? rnd() * 0.6 : rnd());
        billet(o, X, Y, w, shape, 0.02, 0.65 + rnd() * 0.04, null, endGrain(), undefined, tilt());
        x += cw;
      }
      y += ch;
    }
  }

  // ---- the ends.
  for (const s of [-1, 1]) {
    if (crib) {
      // A crib: courses of rounds laid crosswise, across the pile and then along it.
      let y = BASE;
      let across = true;
      while (y < H - 0.02) {
        const d = Math.min(0.17 + rnd() * 0.04, H + 0.03 - y);
        if (across) {
          for (const xc of [len / 2 - 0.02 - d / 2, len / 2 - 0.48 + d / 2]) {
            billet([s * xc, y + d / 2, 0], X, Y, Z, outline(d, d, 0), -0.67, 0.67, endGrain(), endGrain(), tilt(), tilt());
          }
        } else {
          for (const zc of [-1, 1]) {
            const o: Point3 = [s * (len / 2 - 0.25), y + d / 2, zc * (0.65 - d / 2)];
            billet(o, Z, Y, X, outline(d, d, 0), -0.27, 0.27, endGrain(), endGrain(), tilt(), tilt());
          }
        }
        y += d * 0.88;
        across = !across;
      }
    } else {
      // Posts at the two corners, driven in, with a batten nailed across their heads.
      for (const zc of [-1, 1]) {
        const foot = Math.min(0, ground(s * (len / 2 - 0.06), zc * 0.55)) - 0.05;
        const top = 2.12 + (rnd() - 0.5) * 0.08;
        b.box(0.12, top - foot, 0.12, s * (len / 2 - 0.06), (top + foot) / 2, zc * 0.55, PLANK, { y: (rnd() - 0.5) * 0.3 });
      }
      b.box(0.03, 0.08, 1.34, s * (len / 2 + 0.015), 2.0, 0, PLANK, { x: (rnd() - 0.5) * 0.04 });
    }
  }

  // ---- what is on top.
  /** The cover's underside over the middle of the pile: clear of the top course at its low edge. */
  const coverY = H + 0.035 + 0.75 * Math.abs(fall);
  if (cover === "boards") {
    // Boards laid across the pile, their ends out over both faces.
    let x = -len / 2 + 0.02;
    while (x < len / 2 - 0.12) {
      const bw = Math.min(0.2 + rnd() * 0.1, len / 2 - x);
      b.box(bw - 0.015, 0.03, 1.46 + rnd() * 0.08, x + bw / 2, coverY + 0.015 + rnd() * 0.012, (rnd() - 0.5) * 0.06, PLANK, {
        x: -Math.atan(fall),
        y: (rnd() - 0.5) * 0.04,
      });
      x += bw;
    }
  } else if (cover === "iron") {
    // Iron sheets across the pile, each lapped over the last, ribs running with the fall.
    const n = Math.max(2, Math.round(len / 0.85));
    const sw = (len + 0.1 * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const xc = -len / 2 + sw / 2 + i * (sw - 0.1);
      const y = coverY + 0.006 + (i % 2) * 0.008;
      const rot = { x: -Math.atan(fall), y: (rnd() - 0.5) * 0.03 };
      b.box(sw, 0.012, 1.5, xc, y, 0, IRON, rot);
      for (let r = -2; r <= 2; r++) b.box(0.035, 0.02, 1.5, xc + r * (sw / 5.2), y + 0.012, 0, IRON, rot);
    }
  }
  if (cover !== "open") {
    // Stones to hold it down.
    const count = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1) - 0.5) * (len - 1.2) + (rnd() - 0.5) * 0.4;
      b.box(0.26 + rnd() * 0.1, 0.14, 0.2 + rnd() * 0.08, x, coverY + 0.12, 0, STONE, { y: rnd() * 3 });
    }
  } else {
    // Left open, with a few billets thrown on top.
    const count = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const d = 0.16 + rnd() * 0.06;
      const yaw = (rnd() - 0.5) * 0.9;
      const w: Point3 = [Math.cos(yaw), 0, Math.sin(yaw)];
      const u: Point3 = [-Math.sin(yaw), 0, Math.cos(yaw)];
      const o: Point3 = [(rnd() - 0.5) * (len - 1.4), H + 0.03 + d * 0.4, (rnd() - 0.5) * 0.6];
      billet(o, u, Y, w, outline(d, d * 0.85, rnd() * 0.6), -0.3, 0.3, endGrain(), endGrain(), tilt(), tilt());
    }
    if (axe) {
      // An axe left in the top of the pile, its head driven in.
      const x = (rnd() - 0.5) * (len - 1.6);
      const z = (rnd() - 0.5) * 0.5;
      const lean = 0.5 + rnd() * 0.25;
      const hl = 0.72;
      b.box(0.17, 0.1, 0.028, x, H + 0.02, z, IRON, { z: lean });
      b.box(0.036, hl, 0.03, x - Math.sin(lean) * (hl / 2 - 0.04), H + 0.02 + Math.cos(lean) * (hl / 2 - 0.04), z, STRAW, { z: lean });
    }
  }

  // ---- fallen billets, lying on the ground in front of one face.
  if (spill) {
    const count = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const d = 0.13 + rnd() * 0.06;
      const x = (rnd() - 0.5) * (len - 1);
      const z = spill * (0.8 + rnd() * 0.5);
      const yaw = rnd() * Math.PI;
      const w: Point3 = [Math.cos(yaw), 0, Math.sin(yaw)];
      const u: Point3 = [-Math.sin(yaw), 0, Math.cos(yaw)];
      billet([x, ground(x, z) + d * 0.38, z], u, Y, w, outline(d * 1.2, d), -0.3, 0.3, endGrain(), endGrain(), tilt(), tilt());
    }
  }

  // ---- the bearers, each on a flat stone at both ends and in the middle.
  for (const zc of [-0.33, 0.33]) {
    b.cyl(len - 0.12, 0.12, 0.12, 6, 0, 0.06, zc, TIMBER, { z: Math.PI / 2 });
    for (const x of [-len / 2 + 0.3, 0, len / 2 - 0.3]) {
      const bottom = Math.min(0, ground(x, zc)) - 0.04;
      b.box(0.26, 0.004 - bottom, 0.22, x, (0.004 + bottom) / 2, zc, STONE, { y: (rnd() - 0.5) * 0.3 });
    }
  }

  // ---- the billets, then the dark of the stack they hide (last: see craft notes on emission order).
  for (const [colour, a] of accs) {
    const data = new VertexData();
    data.positions = a.pos;
    data.normals = a.nrm;
    data.uvs = a.uv;
    data.indices = a.idx;
    b.surface(data, colour);
  }
  const low = Math.min(0, ground(-len / 2, -0.6), ground(len / 2, -0.6), ground(-len / 2, 0.6), ground(len / 2, 0.6)) - 0.02;
  // Short of the end billets by most of their width, so their bark stands out of it.
  const coreW = 2 * (crib ? len / 2 - 0.12 : xEnd - 0.16);
  b.box(coreW, H - 0.005 - low, 2 * CORE, 0, (H - 0.005 + low) / 2, 0, PITCH);
  return b;
}

/**
 * Pent shed: a boarded outbuilding under a single-pitch roof, its door in
 * the tall front (local -Z) and the roof falling to the back. Solid, never
 * enterable.
 *
 * **It is built the way one is built.** The shed it replaces was a plank box
 * with a post at each corner and a flat lid tipped over it, which left a
 * wedge of sky between the lid and the box at both ends. So: a rubble footing
 * with its joints drawn and a sole plate on it; walls of boards with a batten
 * over every joint and a board on every corner, the ends boarded up to the
 * roof's own line; rafters on the wall heads with their tails bare under both
 * eaves, a deck on them, and over it corrugated iron in lapped sheets or
 * tarred felt in strips with a roll batten at every lap, a fascia along the
 * high eave and a barge board down each verge; a ledged-and-braced door — two
 * leaves on a long shed — on strap hinges with a padlocked hasp, a stone step
 * in front of it, and a four-light window beside it and maybe in an end. Then
 * what a shed has on it: a gutter and a downpipe, a ladder on hooks along the
 * back, a spade and a coil of rope on an end.
 *
 * **The collider is the box it has always been**, w x h x d, first and alone,
 * and the solid under all the boarding is that box to its own height with
 * the roof's wedge over it, so no round stops on air. Everything else is flat
 * on a face (the proudest thing is the hung ladder, 9 cm), low enough to walk
 * over (the step, the downpipe's shoe) or over the wall heads: the low eave's
 * lowest point is 2.5 m up at the default height.
 *
 * Seeded off where it stands (`streetSeed`) — whether it is tarred, which
 * roof, which hand the door hangs, its paint and what hangs on the walls —
 * and its footing is cut to the ground under each wall, which puts `shed` in
 * `CONFORMS_TO_TERRAIN`.
 */
export function buildShed(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "shed");
  const w = p.width ?? 3.4;
  const d = p.depth ?? 2.8;
  const h = p.height ?? 2.6;
  // ---- the collider: the box it has always been.
  b.block({ w, h, d, x: 0, y: h / 2, z: 0 });

  const seed = streetSeed(w, d, h, ctx);
  const rnd = mulberry32(seed);
  /** A tarred shed is black all over and always roofed in iron: felt on tar is one blot. */
  const tarred = (seed >>> 3) % 3 === 0;
  const ironRoof = tarred || (seed >>> 5) % 2 === 0;
  /** Which end of the front a single door keeps to, and so which end everything else takes. */
  const hand = (seed >>> 7) % 2 === 0 ? -1 : 1;
  const CLAD = tarred ? PITCH : PLANK;
  const DOOR = [CLAD, CLAD, ...DOOR_PAINTS][(seed >>> 9) % (DOOR_PAINTS.length + 2)];
  const gutter = (seed >>> 12) % 5 < 3;
  const ladder = w >= 3 && (seed >>> 14) % 2 === 0;
  const endWindow = d >= 2.6 && (seed >>> 16) % 3 === 0;
  const tools = (seed >>> 18) % 2 === 0;

  /** The floor under a local point, as a local height — the stall's reading. */
  const ground = (lx: number, lz: number): number => {
    if (!ctx || Math.abs(ctx.y - ctx.floor) > 0.05) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    const g = ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
    return Math.max(-0.6, Math.min(0.4, g));
  };

  // ---- the numbers everything hangs off.
  /** The footing's top, and the sole plate's: where the boarding starts. */
  const FOOT = 0.2;
  const SILL = FOOT + 0.08;
  /** A quarter pitch whatever the depth, so a deep shed is a taller front. */
  const rise = d * 0.25;
  /** The roof line over a point on plan: h + rise at the front face, h at the back. */
  const top = (z: number): number => h + rise * (0.5 - z / d);
  const pitch = Math.atan2(rise, d);
  const ca = Math.cos(pitch);
  const sa = Math.sin(pitch);
  /** A point `off` out from the roof line, square to it, over (x, z) on plan. */
  const onRoof = (x: number, z: number, off: number): Point3 => [x, top(z) + off * ca, z + off * sa];
  /** The eaves' reach past the front and the back, and the verges' past the ends. */
  const zF = -d / 2 - 0.22;
  const zB = d / 2 + 0.32;
  const xE = w / 2 + 0.2;
  const holes: Record<Side, Hole[]> = { "-z": [], "+z": [], "-x": [], "+x": [] };

  // ================================================================= the door
  const double = w >= 5.5;
  const leafW = double ? 0.95 : 0.86;
  const doorW = double ? 2 * leafW : leafW;
  const dh = double ? 2.0 : 1.88;
  const doorX = double ? 0 : hand * Math.max(0, Math.min(w / 4, w / 2 - doorW / 2 - 0.35));
  const y0 = SILL;
  const y1 = SILL + dh;
  holes["-z"].push({ u0: doorX - doorW / 2 - 0.07, u1: doorX + doorW / 2 + 0.07, y0: FOOT, y1: y1 + 0.07 });
  // The casing: two jambs and a head.
  for (const s of [-1, 1]) {
    onFace(b, "-z", d / 2, doorX + s * (doorW / 2 + 0.035), (y0 + y1 + 0.07) / 2, 0.07, dh + 0.07, 0.03, 0.015, TIMBER);
  }
  onFace(b, "-z", d / 2, doorX, y1 + 0.035, doorW + 0.14, 0.07, 0.03, 0.015, TIMBER);
  // Each leaf: upright boards, alternately a few millimetres proud, three
  // ledges across them, a brace between each pair with its foot on the hinge
  // side where it is in compression, and a strap hinge along the top and
  // bottom ledge onto a pintle in the jamb.
  const leaves: [number, number][] = double
    ? [
        [doorX - leafW / 2, -1],
        [doorX + leafW / 2, 1],
      ]
    : [[doorX, hand]];
  for (const [cx, hs] of leaves) {
    const nb = 5;
    const bw = leafW / nb;
    for (let i = 0; i < nb; i++) {
      onFace(b, "-z", d / 2, cx - leafW / 2 + bw * (i + 0.5), (y0 + y1) / 2, bw - 0.006, dh, 0.024, 0.012 + (i % 2) * 0.004, DOOR);
    }
    const ly = [y0 + 0.22, (y0 + y1) / 2, y1 - 0.22];
    for (const y of ly) onFace(b, "-z", d / 2, cx, y, leafW - 0.08, 0.1, 0.022, 0.037, DOOR);
    const z = -(d / 2 + 0.037);
    for (let k = 0; k < 2; k++) {
      const xa = cx + hs * (leafW / 2 - 0.1);
      const xc = cx - hs * (leafW / 2 - 0.1);
      slab(b, [xa, ly[k] + 0.03, z], [xc, ly[k + 1] - 0.03, z], 0.022, 0.09, DOOR);
    }
    for (const y of [ly[0], ly[2]]) {
      onFace(b, "-z", d / 2, cx + hs * leafW * 0.2, y, leafW * 0.6, 0.035, 0.008, 0.052, IRON);
      onFace(b, "-z", d / 2, cx + hs * (leafW / 2 + 0.035), y, 0.045, 0.07, 0.02, 0.04, IRON);
    }
  }
  // The hasp and its padlock where the door shuts, and a pull beside them.
  {
    const lx = double ? doorX : doorX - hand * (leafW / 2 - 0.09);
    const ly = y0 + 1.12;
    onFace(b, "-z", d / 2, lx, ly, 0.17, 0.035, 0.01, 0.031, IRON);
    onFace(b, "-z", d / 2, lx, ly - 0.05, 0.045, 0.06, 0.025, 0.048, IRON);
    const px = double ? doorX + 0.2 : lx + hand * 0.12;
    onFace(b, "-z", d / 2, px, ly - 0.02, 0.025, 0.16, 0.02, 0.05, IRON);
    for (const s of [-1, 1]) onFace(b, "-z", d / 2, px, ly - 0.02 + s * 0.07, 0.025, 0.02, 0.03, 0.035, IRON);
  }
  // A stone step in front of it, its top under the sill and no higher than a
  // stride over the ground.
  {
    const gz = -d / 2 - 0.21;
    const gs = [ground(doorX - doorW / 2, gz), ground(doorX, gz), ground(doorX + doorW / 2, gz)];
    const stepTop = Math.min(FOOT - 0.03, Math.max(...gs) + 0.14);
    const stepBottom = Math.min(...gs) - 0.08;
    if (stepTop > Math.max(...gs) + 0.04) {
      b.box(doorW + 0.3, stepTop - stepBottom, 0.42, doorX, (stepTop + stepBottom) / 2, gz, DARK_STONE, { y: (rnd() - 0.5) * 0.04 });
    }
  }

  // ============================================================== the windows
  // Four lights in a frame, bars across them, a sill board to throw the rain
  // off and the dark glass behind all of it.
  const shedWindow = (s: Side, plane: number, u: number): void => {
    const ww = 0.62;
    const wh = 0.5;
    const sill = 1.25;
    holes[s].push({ u0: u - ww / 2 - 0.06, u1: u + ww / 2 + 0.06, y0: sill - 0.1, y1: sill + wh + 0.06 });
    for (const k of [-1, 1]) {
      onFace(b, s, plane, u + k * (ww / 2 + 0.0275), sill + wh / 2, 0.055, wh + 0.11, 0.03, 0.015, TIMBER);
      onFace(b, s, plane, u, sill + wh / 2 + k * (wh / 2 + 0.0275), ww, 0.055, 0.03, 0.015, TIMBER);
    }
    onFace(b, s, plane, u, sill + wh / 2, 0.025, wh, 0.02, 0.01, TIMBER);
    onFace(b, s, plane, u, sill + wh / 2, ww, 0.025, 0.02, 0.01, TIMBER);
    onFace(b, s, plane, u, sill - 0.075, ww + 0.2, 0.04, 0.08, 0.04, TIMBER);
    onFace(b, s, plane, u, sill + wh / 2, ww, wh, 0.006, 0.003, CASEMENT);
  };
  if (double) {
    const u = (doorW / 2 + 0.2 + w / 2) / 2;
    if (w >= 7) for (const s of [-1, 1]) shedWindow("-z", d / 2, s * u);
    else shedWindow("-z", d / 2, -hand * u);
  } else {
    const far = (-hand * w) / 2;
    const near = doorX - hand * (doorW / 2 + 0.07);
    if (Math.abs(near - far) >= 0.95) shedWindow("-z", d / 2, (far + near) / 2);
  }
  /** The end the door keeps away from takes the window; the other takes the tools. */
  const windowEnd: Side = hand > 0 ? "-x" : "+x";
  const toolEnd: Side = hand > 0 ? "+x" : "-x";
  if (endWindow) shedWindow(windowEnd, w / 2, -0.15);

  // ============================================================= the boarding
  // A batten over every board joint, cut round the openings and, on the ends,
  // to the roof's line; a board down every corner; a sole plate round the foot.
  {
    const BW = 0.06;
    const BT = 0.022;
    const battens = (s: Side, plane: number, run: number, topAt: (u: number) => number): void => {
      const n = Math.max(2, Math.round(run / 0.3));
      for (let i = 1; i < n; i++) {
        const u = -run / 2 + (i * run) / n;
        const cuts = holes[s]
          .filter((o) => u + BW / 2 > o.u0 && u - BW / 2 < o.u1)
          .map((o): [number, number] => [o.y0, o.y1]);
        for (const [a, c] of carve(SILL, topAt(u), cuts)) {
          if (c - a < 0.08) continue;
          onFace(b, s, plane, u, (a + c) / 2, BW, c - a, BT, BT / 2, CLAD);
        }
      }
    };
    battens("-z", d / 2, w, () => h + rise);
    battens("+z", d / 2, w, () => h - 0.01);
    for (const s of ["-x", "+x"] as const) battens(s, w / 2, d, (u) => top(u + BW / 2));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const yT = sz < 0 ? h + rise : h - 0.01;
        b.box(0.11, yT - SILL, 0.026, sx * (w / 2 - 0.029), (yT + SILL) / 2, sz * (d / 2 + 0.013), CLAD);
        const zc = sz * (d / 2 - 0.055);
        const yE = top(zc + 0.055);
        b.box(0.026, yE - SILL, 0.11, sx * (w / 2 + 0.013), (yE + SILL) / 2, zc, CLAD);
      }
    }
    for (const sz of [-1, 1]) b.box(w + 0.07, 0.08, 0.035, 0, FOOT + 0.04, sz * (d / 2 + 0.0175), TIMBER);
    for (const sx of [-1, 1]) b.box(0.035, 0.08, d, sx * (w / 2 + 0.0175), FOOT + 0.04, 0, TIMBER);
  }

  // ============================================================== the footing
  // Rubble stones of mixed lengths laid 3 cm apart over a dark core set back
  // behind them, each standing a little prouder or less than the last, so
  // every joint is a step the ink finds; carried down to the lowest ground
  // under each wall.
  {
    const course = (s: Side, plane: number, run: number, samples: number[]): void => {
      const base = Math.min(0, ...samples) - 0.1;
      let u = -run / 2;
      while (u < run / 2 - 0.01) {
        let len = 0.45 + rnd() * 0.4;
        if (run / 2 - u - len < 0.25) len = run / 2 - u;
        const t = FOOT - rnd() * 0.015;
        onFace(b, s, plane, u + len / 2, (t + base) / 2, len - 0.03, t - base, 0.07, -0.005 + rnd() * 0.012, STONE);
        u += len;
      }
      onFace(b, s, plane, 0, (FOOT - 0.01 + base) / 2, run, FOOT - 0.01 - base, 0.06, -0.02, DARK_STONE);
    };
    for (const s of ["-z", "+z"] as const) {
      const z = (s === "-z" ? -1 : 1) * (d / 2);
      course(s, d / 2, w + 0.06, [ground(-w / 2, z), ground(0, z), ground(w / 2, z)]);
    }
    for (const s of ["-x", "+x"] as const) {
      const x = (s === "-x" ? -1 : 1) * (w / 2);
      course(s, w / 2, d, [ground(x, -d / 2), ground(x, 0), ground(x, d / 2)]);
    }
  }

  // ================================================================= the roof
  // The covering first, since it hides the deck and the deck the rafters.
  if (ironRoof) {
    // Sheets laid down the slope, alternately a few millimetres up so every
    // side lap is a step, three ribs on each; a deep roof takes two courses,
    // the upper lapped over the lower. One in six has been replaced and is
    // still dark from the galvanising.
    const ns = Math.max(2, Math.ceil((2 * xE) / 0.78));
    const sw = (2 * xE) / ns;
    const mid = (zF + zB) / 2;
    const runs: [number, number][] =
      (zB - zF) / ca > 2.6
        ? [
            [mid - 0.075, zB + 0.03],
            [zF - 0.02, mid + 0.075],
          ]
        : [[zF - 0.02, zB + 0.03]];
    runs.forEach(([z0, z1], c) => {
      for (let i = 0; i < ns; i++) {
        const x = -xE + sw * (i + 0.5);
        const off = 0.131 + c * 0.014 + (i % 2) * 0.004;
        const col = rnd() < 0.17 ? IRON : RUST;
        slab(b, onRoof(x, z0, off), onRoof(x, z1, off), sw + 0.03, 0.008, col);
        for (let r = 0; r < 3; r++) {
          const rx = x - sw / 2 + (sw * (r + 0.5)) / 3;
          slab(b, onRoof(rx, z0, off + 0.014), onRoof(rx, z1, off + 0.014), 0.035, 0.02, col);
        }
      }
    });
  } else {
    // Felt in strips down the slope, a roll batten over every lap and at both
    // verges, and the felt dressed down over the high eave.
    const ns = Math.max(2, Math.ceil((2 * xE) / 0.9));
    const sw = (2 * xE) / ns;
    for (let i = 0; i < ns; i++) {
      const x = -xE + sw * (i + 0.5);
      const off = 0.131 + (i % 2) * 0.003;
      slab(b, onRoof(x, zF - 0.015, off), onRoof(x, zB + 0.015, off), sw + 0.02, 0.01, PITCH);
    }
    for (let i = 0; i <= ns; i++) {
      const x = Math.max(-xE + 0.025, Math.min(xE - 0.025, -xE + sw * i));
      slab(b, onRoof(x, zF - 0.015, 0.155), onRoof(x, zB + 0.015, 0.155), 0.045, 0.04, PITCH);
    }
    const [, yf, zf] = onRoof(0, zF - 0.015, 0.131);
    b.box(2 * xE + 0.02, 0.07, 0.012, 0, yf - 0.03, zf - 0.006 - 0.015 * sa, PITCH);
  }
  // The fascia along the high eave and a barge board down each verge, their
  // tops at the deck's.
  {
    const [, yf, zf] = onRoof(0, zF, 0.125);
    b.box(2 * xE + 0.05, 0.2, 0.025, 0, yf - 0.1, zf - 0.0125, TIMBER);
    for (const sx of [-1, 1]) {
      const x = sx * (xE + 0.0125);
      slab(b, onRoof(x, zF - 0.025, 0.035), onRoof(x, zB, 0.035), 0.025, 0.2, TIMBER);
    }
  }
  // The deck, and the rafters under it on the wall heads.
  slab(b, onRoof(0, zF, 0.1125), onRoof(0, zB, 0.1125), 2 * xE, 0.025, PLANK);
  {
    const nr = Math.max(3, Math.round(w / 0.6) + 1);
    for (let i = 0; i < nr; i++) {
      const x = -w / 2 + 0.03 + (i * (w - 0.06)) / (nr - 1);
      slab(b, onRoof(x, zF + 0.03, 0.05), onRoof(x, zB - 0.02, 0.05), 0.05, 0.1, TIMBER);
    }
  }
  // A gutter on the low eave, and the downpipe off its end: a swan neck back
  // to the wall, down the boarding on two clips, and a shoe at the foot.
  if (gutter) {
    const [, ye, ze] = onRoof(0, zB, 0.12);
    const gy = ye - 0.075;
    const gz = ze + 0.06;
    b.box(2 * xE - 0.08, 0.075, 0.11, 0, gy, gz, IRON);
    const px = hand * (w / 2 - 0.18);
    const pz = d / 2 + 0.05;
    const neck = gy - 0.34;
    slab(b, [px, gy - 0.02, gz], [px, neck, pz], 0.065, 0.065, IRON);
    b.box(0.065, neck - 0.36, 0.065, px, (neck + 0.36) / 2, pz, IRON);
    slab(b, [px, 0.4, pz], [px, 0.3, pz + 0.1], 0.065, 0.065, IRON);
    for (const y of [0.9, neck - 0.3]) onFace(b, "+z", d / 2, px, y, 0.1, 0.03, 0.05, 0.025, IRON);
  }

  // ======================================================= what hangs on it
  // A ladder on two hooks along the back, away from the downpipe.
  if (ladder) {
    const len = Math.min(w - 0.8, 3.0);
    const lx = -hand * (w / 2 - 0.3 - len / 2);
    const z = d / 2 + 0.07;
    for (const y of [1.45, 1.83]) onFace(b, "+z", d / 2, lx, y, len, 0.07, 0.045, 0.07, TIMBER);
    const n = Math.round(len / 0.3);
    for (let i = 0; i < n; i++) b.cyl(0.33, 0.032, 0.032, 6, lx - len / 2 + ((i + 0.5) * len) / n, 1.64, z, TIMBER);
    for (const k of [-1, 1]) onFace(b, "+z", d / 2, lx + k * len * 0.3, 1.4, 0.03, 0.08, 0.09, 0.045, IRON);
  }
  // A spade hung by its handle and a coil of rope on a nail, on the end the
  // window is not.
  if (tools) {
    const n = outward(toolEnd);
    const x = n * (w / 2);
    // The spade: a shaft, a D handle over the nail, the blade at the foot.
    const su = 0.45;
    b.cyl(0.78, 0.036, 0.036, 6, x + n * 0.04, 1.18, su, TIMBER);
    onFace(b, toolEnd, w / 2, su, 1.63, 0.14, 0.025, 0.03, 0.04, TIMBER);
    for (const k of [-1, 1]) onFace(b, toolEnd, w / 2, su + k * 0.06, 1.58, 0.025, 0.1, 0.03, 0.04, TIMBER);
    onFace(b, toolEnd, w / 2, su, 0.67, 0.19, 0.28, 0.012, 0.03, IRON);
    onFace(b, toolEnd, w / 2, su, 1.66, 0.02, 0.02, 0.06, 0.03, IRON);
    // The rope: two turns proud of each other, dark in the middle.
    const ru = -0.4;
    b.cyl(0.05, 0.36, 0.36, 10, x + n * 0.035, 1.45, ru, THATCH, { z: Math.PI / 2 });
    b.cyl(0.05, 0.3, 0.3, 10, x + n * 0.06, 1.47, ru + 0.02, THATCH, { z: Math.PI / 2 });
    b.cyl(0.052, 0.17, 0.17, 8, x + n * 0.062, 1.47, ru + 0.02, CLAD, { z: Math.PI / 2 });
    onFace(b, toolEnd, w / 2, ru, 1.62, 0.02, 0.02, 0.06, 0.03, IRON);
  }

  // ================================================== the body behind it all
  // The collider's box and the roof's wedge over it, emitted after everything
  // it is hidden by.
  {
    const sec = (x: number): Point3[] => [
      [x, FOOT - 0.01, -d / 2],
      [x, FOOT - 0.01, d / 2],
      [x, h, d / 2],
      [x, h + rise, -d / 2],
    ];
    convexSolid(b, sec(-w / 2), sec(w / 2), CLAD);
  }
  return b;
}

/** Stone water trough and hitching rail. Low cover — cross it, don't hide. */
export function buildTrough(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "trough");
  b.box(3.0, 0.7, 1.1, 0, 0.35, 0, STONE);
  for (const sx of [-1, 1]) {
    b.box(0.18, 0.34, 1.1, (sx * 3.0) / 2, 0.87, 0, STONE);
  }
  for (const sz of [-1, 1]) {
    b.box(3.0, 0.34, 0.18, 0, 0.87, (sz * 1.1) / 2, STONE);
  }
  b.box(2.6, 0.06, 0.8, 0, 0.88, 0, DARK_STONE); // standing water
  b.block({ w: 3.0, h: 1.0, d: 1.1, x: 0, y: 0.5, z: 0 });
  // Hitching rail behind it.
  for (const sx of [-1, 1]) {
    b.box(0.16, 1.4, 0.16, sx * 1.3, 0.7, 1.6, TIMBER);
  }
  b.box(3.0, 0.14, 0.12, 0, 1.25, 1.6, TIMBER);
  b.block({ w: 3.0, h: 1.4, d: 0.4, x: 0, y: 0.7, z: 1.6 });
  return b;
}

/**
 * Roadside shrine: a stone pillar with a lit niche. Carries a small light, so
 * keep them spread — every one competes for a shader slot with the lamps.
 */
export function buildShrine(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "shrine");
  b.box(1.5, 0.4, 1.5, 0, 0.2, 0, DARK_STONE);
  b.box(1.0, 1.8, 1.0, 0, 1.3, 0, MOSS_STONE);
  // The niche: a shallow recess read as two jambs and a hood.
  for (const sx of [-1, 1]) {
    b.box(0.28, 0.8, 0.2, sx * 0.36, 1.9, -0.5, MOSS_STONE);
  }
  b.box(1.1, 0.22, 0.34, 0, 2.35, -0.45, DARK_STONE);
  b.glow(0.34, 0.5, 0.12, 0, 1.85, -0.52, FLAME);
  b.cyl(0.7, 0.28, 0.9, 4, 0, 2.55, 0, SLATE); // capstone
  b.block({ w: 1.5, h: 2.6, d: 1.5, x: 0, y: 1.3, z: 0 });
  b.light(FLAME, 12, 1.3, 0.5, 0, 1.9, -0.6);
  return b;
}

/**
 * The kiln is a brick BOTTLE KILN: a battered drum on a two-course stone
 * plinth, bound with iron bonts, turning in at a string course to a neck and
 * a short corbelled stack with the fire showing in its throat. The one kiln
 * stands for three trades — Hollowmere's charcoal burners, Harrowmead's
 * brickworks and Cinderhaven's sulphur works — and the bottle is the form all
 * three were built in, so nothing on it names the trade.
 *
 * Everything is laid on one of the nine FACES, never across a corner, and the
 * rings are all turned so a face looks square down -Z: that is where the
 * WICKET is, the arched doorway the kiln is set and drawn through. It is
 * CLAMMED for the firing — bricked up inside its arch ring, set back from it so
 * the ink finds the doorway it fills, with a peep hole — and the fire is fed
 * through an iron-framed, barred mouth left at its foot. Four smaller fire
 * mouths stand round the drum, each either firing (lit, barred, sooted round
 * its arch) or clammed. Between the bonts are patches of brickwork where the
 * mortar has gone, laid to one bond for the whole drum so a patch is a run of
 * its own courses rather than bricks scattered on it; two spy holes, one
 * sometimes glowing; and a ladder of climbing irons up one face to the crown.
 * At its foot: the ash raked out of the mouth with coals still alight in it,
 * fuel heaped against the drum, a hack of spare brick for the next clamming,
 * and the rake.
 *
 * Seeded off where it stands (`streetSeed`) — which mouths are firing, where
 * each bont is tightened, which face carries the irons, the brickwork and the
 * dressing — and its plinth is carried down to the lowest ground round the
 * drum, which puts `kiln` in `CONFORMS_TO_TERRAIN`. What burns is heard
 * burning: the one light is where it always was, and the fire's sound is at
 * the wicket's mouth.
 *
 * **The box is the DRUM, at its middle width.** It carried the haystack's bug
 * twice over: 3.8 is the circumdiameter of a nine-sided drum at its foot, and
 * the box held that width for 3.6 m — a metre past where the drum stops and
 * the neck starts narrowing to 1.3. Measured at 3.4 m up, where the kiln is a
 * chimney, the box stopped rounds on nothing at every bearing tested off the
 * axis.
 *
 * So it is 3.4 across (the drum's silhouette at 1.3 m, its half height) and
 * 2.6 tall (the drum, and nothing above it). Everything drawn over the drum
 * obeys the kit's three rules: it is bedded on a face and stands at most
 * 0.12 m off it (the bonts 2.5 cm, the arch rings 7, the climbing irons 12 —
 * `PROP_BODIES` is explicit that you do not lose a round to a piece of wire),
 * it is under 0.3 m and walked over (the plinth, the ash, the fuel, the
 * brick), or it stands above the box (the string course, the neck and the
 * stack). The neck and the stack are outside the box for the reason the
 * haystack's cap is — they start at 2.6 m, which clears a standing hit sphere
 * by nearly a metre, so nothing shelters there and the only cost is a round
 * clipping brick on its way over the top.
 */
export function buildKiln(
  scene: Scene,
  mats: CelMaterialFactory,
  _p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "kiln");
  // --- the collider: unchanged ---------------------------------------------
  b.block({ w: 3.4, h: 2.6, d: 3.4, x: 0, y: 1.3, z: 0 });

  // --- everything after this is drawing ------------------------------------
  const rnd = mulberry32(streetSeed(3.4, 3.4, 2.6, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };

  // The drum and the neck are nine-sided, and everything here is laid on one
  // of their FACES, so the rings are all turned by one angle that puts a face
  // (not a corner) square to -Z, where the wicket is. A Babylon cylinder's
  // first corner is at bearing 90°; its first face centre is half a side on.
  const SIDES = 9;
  const STEP = (2 * Math.PI) / SIDES;
  const TURN = Math.PI / 2 - STEP / 2;
  /** A face's distance from the axis over a corner's, and its half-width over a corner's. */
  const APO = Math.cos(Math.PI / SIDES);
  const HALF = Math.sin(Math.PI / SIDES);
  const turned = { y: TURN };
  interface Frustum {
    y0: number;
    y1: number;
    /** CIRCUMradii at y0 and y1 — what `b.cyl` is given, halved. */
    r0: number;
    r1: number;
  }
  const DRUM: Frustum = { y0: 0, y1: 2.6, r0: 1.9, r1: 1.5 };
  const NECK: Frustum = { y0: 2.6, y1: 3.7, r0: 1.5, r1: 0.65 };
  const circum = (f: Frustum, y: number): number => f.r0 + ((f.r1 - f.r0) * (y - f.y0)) / (f.y1 - f.y0);
  const lean = (f: Frustum): number => Math.atan(((f.r0 - f.r1) * APO) / (f.y1 - f.y0));
  /** Half the width of a face at height y: how far along it a part may reach. */
  const faceHalf = (f: Frustum, y: number): number => circum(f, y) * HALF;

  /**
   * A point on face `k` (bearing π + k·STEP), `u` along it and at height `y`,
   * stood `off` out along the face's own normal — which leans back with the
   * batter, so a part bedded on the face is bedded all the way up it.
   */
  const facePt = (f: Frustum, k: number, u: number, y: number, off: number): Point3 => {
    const phi = Math.PI + k * STEP;
    const t = lean(f);
    const a = circum(f, y) * APO;
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    return [s * a + c * u + s * Math.cos(t) * off, y + Math.sin(t) * off, c * a - s * u + c * Math.cos(t) * off];
  };
  /**
   * Stands a part `d` deep on face `k` with its front `proud` off it, turned
   * `roll` in the face's own plane (X toward face-up). A `disc` is a cylinder
   * whose axis is the face normal.
   */
  const place = (m: Mesh, f: Frustum, k: number, u: number, y: number, d: number, proud: number, roll = 0, disc = false): Mesh => {
    const p = facePt(f, k, u, y, proud - d / 2);
    m.position.set(p[0], p[1], p[2]);
    const t = lean(f);
    m.rotation.set(disc ? Math.PI / 2 - t : -t, Math.PI + k * STEP, roll);
    return m;
  };
  const brick = (f: Frustum, k: number, u: number, y: number, w: number, h: number, proud: number, color: string, roll = 0): Mesh =>
    place(b.box(w, h, proud + 0.04, 0, 0, 0, color), f, k, u, y, proud + 0.04, proud, roll);
  /** A 9-sided band hugging `f` between y ± h/2, stood `proud` off it. */
  const ring = (f: Frustum, y: number, h: number, proud: number, color: string): void => {
    const e = proud / APO;
    b.cyl(h, 2 * (circum(f, y + h / 2) + e), 2 * (circum(f, y - h / 2) + e), SIDES, 0, y, 0, color, turned);
  };
  /**
   * An arch-headed slab on face `k`: a rectangle from `yb` to the springing
   * `ys`, under a semicircle of radius `wo`. Convex, so one solid; its front
   * `proud` off the face and `d` deep.
   */
  const archSlab = (k: number, wo: number, yb: number, ys: number, proud: number, d: number, color: string): void => {
    const outline: [number, number][] = [
      [-wo, yb],
      [wo, yb],
    ];
    for (let i = 0; i <= 10; i++) {
      const th = (Math.PI * i) / 10;
      outline.push([wo * Math.cos(th), ys + wo * Math.sin(th)]);
    }
    convexSolid(
      b,
      outline.map(([u, y]) => facePt(DRUM, k, u, y, proud)),
      outline.map(([u, y]) => facePt(DRUM, k, u, y, proud - d)),
      color,
    );
  };
  /**
   * An arched opening on face `k`: quoined brick jambs from the plinth to the
   * springing, an arch ring of `n` voussoirs with a proud keystone, and the
   * dark ground inside — the hole the ring is built round. What fills it is
   * the caller's.
   */
  const opening = (k: number, wo: number, ys: number, ringD: number, jamb: number, n: number): void => {
    archSlab(k, wo, PLINTH, ys, 0.012, 0.05, DARK_STONE);
    const courses = Math.max(2, Math.round((ys - PLINTH) / 0.17));
    const ch = (ys - PLINTH) / courses;
    for (const s of [-1, 1]) {
      for (let c = 0; c < courses; c++) {
        const w = c % 2 ? jamb * 0.7 : jamb;
        brick(DRUM, k, s * (wo + w / 2), PLINTH + (c + 0.5) * ch, w, ch - 0.014, 0.07, BRICK);
      }
    }
    const rm = wo + ringD / 2;
    for (let i = 0; i < n; i++) {
      const th = (Math.PI * (i + 0.5)) / n;
      const key = i === (n - 1) / 2;
      const len = key ? ringD + 0.06 : ringD;
      const r = key ? rm + 0.03 : rm;
      brick(DRUM, k, r * Math.cos(th), ys + r * Math.sin(th), (Math.PI * rm) / n - 0.014, len, key ? 0.09 : 0.07, BRICK, th - Math.PI / 2);
    }
  };
  /**
   * Soot: the blackening a firing mouth leaves round its own arch — small
   * lobes along the extrados, thickest over the crown and licked a hand's
   * width up from it. It does not climb the drum: a plume of discs stacked up
   * the face read as a keyhole cut in the brick, and at thirty metres as a
   * hole.
   */
  const soot = (k: number, ys: number, ro: number): void => {
    for (let i = 0; i < 9; i++) {
      const th = Math.PI * (0.18 + 0.64 * rnd());
      const reach = ro + 0.02 + rnd() * 0.08 * (1 - Math.abs(th - Math.PI / 2));
      const u = reach * Math.cos(th);
      const y = ys + reach * Math.sin(th);
      const r = 0.05 + rnd() * 0.04;
      const sx = 1.1 + rnd() * 0.5;
      if (Math.abs(u) + r * sx > faceHalf(DRUM, y) - 0.06) continue;
      const m = place(b.cyl(0.012, 2 * r, 2 * r, 8, 0, 0, 0, IRON), DRUM, k, u, y, 0.012, 0.008 + i * 0.0005, 0, true);
      m.scaling.x = sx;
      m.scaling.z = 1.2 + rnd() * 0.4;
    }
  };

  /** Where the drum stands on its plinth: the foot of every opening. */
  const PLINTH = 0.22;
  const BANDS = [1.58, 2.02, 2.44];
  const WICKET = { wo: 0.36, ys: 0.85, ring: 0.19 };
  const MOUTH = { wo: 0.2, ys: 0.5, ring: 0.13 };
  /** The four fire mouths round the drum: two a side of the wicket, two at the back. */
  const MOUTHS = [2, 4, 5, 7];
  const stepFace = rnd() < 0.5 ? 3 : 6;
  const spyFaces = [stepFace === 3 ? 6 : 3, rnd() < 0.5 ? 1 : 8];

  // --- the plinth: two courses of stone, carried down to the ground --------
  let gMin = 0;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * 2 * Math.PI;
    gMin = Math.min(gMin, ground(Math.sin(a) * 2.1, Math.cos(a) * 2.1));
  }
  const footH = 0.1 - (gMin - 0.12);
  b.cyl(footH, 2 * 2.1, 2 * 2.12, SIDES, 0, 0.1 - footH / 2, 0, STONE, turned);
  b.cyl(PLINTH - 0.1, 2 * 1.99, 2 * 2.02, SIDES, 0, (0.1 + PLINTH) / 2, 0, STONE, turned);

  // --- the wicket, face 0: bricked up over a grated fire mouth --------------
  // A bottle kiln is set and drawn through its wicket and CLAMMED for the
  // firing: bricked up and daubed, with the fire fed through a mouth left at
  // its foot. The clamming is set back from the arch ring so the ink finds
  // the whole outline of the doorway it fills.
  opening(0, WICKET.wo, WICKET.ys, WICKET.ring, 0.2, 9);
  const mouthTop = 0.62;
  archSlab(0, WICKET.wo - 0.005, mouthTop + 0.045, WICKET.ys, 0.035, 0.06, BRICK);
  for (let c = 0; c < 6; c++) {
    const y = mouthTop + 0.1 + c * 0.082;
    const off = c % 2 ? 0.058 : 0;
    for (let u = -0.29 + off; u < 0.3; u += 0.232) {
      if (rnd() < 0.45) brick(DRUM, 0, u, y, 0.21, 0.068, 0.05, BRICK);
    }
  }
  // The peep hole in the clamming, and what the burner sees through it.
  brick(DRUM, 0, 0.12, 1.14, 0.11, 0.08, 0.04, DARK_STONE);
  place(b.glow(0.07, 0.045, 0.02, 0, 0, 0, EMBER), DRUM, 0, 0.12, 1.14, 0.02, 0.043);
  place(b.glow(0.5, 0.24, 0.02, 0, 0, 0, EMBER), DRUM, 0, 0, PLINTH + 0.16, 0.02, 0.03);
  brick(DRUM, 0, 0, mouthTop + 0.02, 2 * WICKET.wo + 0.05, 0.07, 0.065, IRON); // the lintel plate
  for (const s of [-1, 1]) brick(DRUM, 0, s * 0.3, PLINTH + 0.2, 0.045, 0.4, 0.05, IRON);
  for (const y of [PLINTH + 0.1, PLINTH + 0.22]) brick(DRUM, 0, 0, y, 0.6, 0.026, 0.06, IRON);

  // --- the fire mouths: each either firing or clammed ----------------------
  for (const k of MOUTHS) {
    opening(k, MOUTH.wo, MOUTH.ys, MOUTH.ring, 0.13, 5);
    if (rnd() < 0.55) {
      place(b.glow(0.3, 0.13, 0.02, 0, 0, 0, EMBER), DRUM, k, 0, PLINTH + 0.1, 0.02, 0.025);
      brick(DRUM, k, 0, PLINTH + 0.15, 2 * MOUTH.wo + 0.02, 0.026, 0.05, IRON);
      soot(k, MOUTH.ys, MOUTH.wo + MOUTH.ring);
    } else {
      archSlab(k, MOUTH.wo - 0.005, PLINTH, MOUTH.ys, 0.035, 0.06, BRICK);
      for (let c = 0; c < 4; c++) {
        if (rnd() < 0.6) brick(DRUM, k, (c % 2 ? 0.06 : -0.05) + (rnd() - 0.5) * 0.05, PLINTH + 0.07 + c * 0.082, 0.2, 0.068, 0.05, BRICK);
      }
    }
  }

  // --- the bonts: iron hoops cut to the batter, each with its tightener ----
  for (const y of BANDS) {
    ring(DRUM, y, 0.1, 0.025, IRON);
    const k = Math.floor(rnd() * SIDES);
    const u = (rnd() - 0.5) * 0.5;
    for (const s of [-1, 1]) brick(DRUM, k, u + s * 0.045, y, 0.04, 0.15, 0.085, IRON);
    place(b.cyl(0.18, 0.03, 0.03, 6, 0, 0, 0, IRON), DRUM, k, u, y, 0.03, 0.07, Math.PI / 2);
  }
  // The string course where the drum turns in to the neck, and the neck's own.
  ring(DRUM, 2.6, 0.12, 0.06, BRICK);
  ring(NECK, 3.15, 0.08, 0.025, IRON);

  // --- spy holes between the bonts, and the climbing irons -----------------
  for (const k of spyFaces) {
    const y = (BANDS[0] + BANDS[1]) / 2;
    brick(DRUM, k, 0, y, 0.12, 0.09, 0.006, DARK_STONE);
    if (rnd() < 0.5) place(b.glow(0.07, 0.05, 0.02, 0, 0, 0, EMBER), DRUM, k, 0, y, 0.02, 0.009);
    brick(DRUM, k, 0, y + 0.08, 0.26, 0.07, 0.03, BRICK);
    brick(DRUM, k, 0, y - 0.075, 0.24, 0.06, 0.03, BRICK);
    for (const s of [-1, 1]) brick(DRUM, k, s * 0.09, y, 0.06, 0.09, 0.03, BRICK);
  }
  const staple = (f: Frustum, y: number): void => {
    for (const s of [-1, 1]) place(b.box(0.028, 0.028, 0.14, 0, 0, 0, IRON), f, stepFace, s * 0.14, y, 0.14, 0.12);
    brick(f, stepFace, 0, y, 0.31, 0.028, 0.12, IRON);
  };
  for (let y = 0.55; y < 2.5; y += 0.36) {
    if (!BANDS.some((by) => Math.abs(by - y) < 0.08)) staple(DRUM, y);
  }
  for (const y of [2.82, 3.42]) staple(NECK, y);

  // --- weathered brickwork: patches where the mortar has gone -------------
  // Laid to one bond for the whole drum, so a patch is a run of the kiln's
  // own courses standing out rather than bricks scattered on it.
  const clear = (k: number, u: number, y: number, hw: number, hh: number): boolean => {
    if (y - hh < PLINTH + 0.06 || y + hh > 2.5) return false;
    if (Math.abs(u) + hw > faceHalf(DRUM, y) - 0.05) return false;
    if (BANDS.some((by) => Math.abs(y - by) < 0.07 + hh)) return false;
    if (k === 0 && Math.abs(u) < 0.62 + hw && y < 1.5 + hh) return false;
    if (MOUTHS.includes(k) && Math.abs(u) < 0.38 + hw && y < 0.9 + hh) return false;
    if (k === stepFace && Math.abs(u) < 0.2 + hw) return false;
    if (spyFaces.includes(k) && Math.abs(u) < 0.18 + hw && Math.abs(y - 1.8) < 0.1 + hh) return false;
    return true;
  };
  for (let k = 0; k < SIDES; k++) {
    for (let p = 0; p < 2; p++) {
      const c0 = Math.floor(rnd() * 26);
      const uc = (rnd() - 0.5) * 0.9;
      const n = 3 + Math.floor(rnd() * 3);
      for (let c = c0; c < c0 + n; c++) {
        const y = PLINTH + 0.05 + c * 0.082;
        const off = c % 2 ? 0.116 : 0;
        const run = 1 + Math.floor(rnd() * 3);
        const start = Math.round((uc - off) / 0.232 - run / 2 + (rnd() - 0.5));
        for (let i = start; i < start + run; i++) {
          const u = off + i * 0.232;
          if (clear(k, u, y, 0.11, 0.034)) brick(DRUM, k, u, y, 0.22, 0.068, 0.014 + rnd() * 0.01, BRICK);
        }
      }
    }
  }

  // --- the crown: a short stack, corbelled out, with the fire in its throat --
  b.cyl(0.4, 2 * 0.62, 2 * 0.66, SIDES, 0, 3.8, 0, BRICK, turned);
  b.cyl(0.07, 2 * 0.66, 2 * 0.67, SIDES, 0, 3.74, 0, IRON, turned);
  b.cyl(0.1, 2 * 0.78, 2 * 0.74, SIDES, 0, 4.01, 0, BRICK, turned);
  const lipIn = 0.44;
  for (let k = 0; k < SIDES; k++) {
    const a0 = Math.PI + (k - 0.5) * STEP;
    const a1 = Math.PI + (k + 0.5) * STEP;
    const at = (r: number, a: number, y: number): Point3 => [Math.sin(a) * r, y, Math.cos(a) * r];
    const course = (y: number): Point3[] => [at(lipIn, a0, y), at(0.72, a0, y), at(0.72, a1, y), at(lipIn, a1, y)];
    convexSolid(b, course(4.06), course(4.18), BRICK);
  }
  b.cyl(0.025, 2 * 0.5, 2 * 0.5, 12, 0, 4.0725, 0, DARK_STONE);
  // Two squares crossed are an octagon; its corners run under the lip, so
  // what shows is the throat's own outline.
  for (const a of [0, Math.PI / 4]) b.glow(0.7, 0.01, 0.7, 0, 4.1, 0, EMBER).rotation.y = a;

  // --- at its foot: the ash drawn out of the mouth, fuel, spare brick, a rake --
  // Raked out in a fan from the mouth: a low bank of cinder against the
  // plinth, thinning to scattered clinker, with a few coals still alight.
  for (let i = 0; i < 6; i++) {
    const x = (rnd() - 0.5) * (0.4 + i * 0.12);
    const z = -2.05 - i * 0.07 - rnd() * 0.1;
    const d = 0.5 - i * 0.05 + rnd() * 0.15;
    const h = 0.07 - i * 0.008;
    const m = b.cyl(h, d * 0.6, d, 7, x, ground(x, z) + h / 2 - 0.01, z, IRON, { y: rnd() * Math.PI });
    m.scaling.x = 1.2 + rnd() * 0.5;
  }
  for (let i = 0; i < 7; i++) {
    const x = (rnd() - 0.5) * 1.3;
    const z = -2.1 - rnd() * 0.6;
    const s = 0.05 + rnd() * 0.06;
    b.box(s, s * 0.6, s * 1.3, x, ground(x, z) + 0.02, z, DARK_STONE, { x: rnd() * 0.5, y: rnd() * 3 });
  }
  for (let i = 0; i < 3; i++) {
    const x = (rnd() - 0.5) * 0.5;
    const z = -2.08 - rnd() * 0.2;
    b.glow(0.045, 0.03, 0.04, x, ground(x, z) + 0.06, z, EMBER);
  }
  const side = rnd() < 0.5 ? -1 : 1;
  // Fuel heaped against the drum on one side of the wicket.
  {
    const x = side * 1.55;
    const z = -1.75;
    for (let i = 0; i < 3; i++) {
      const lx = x + (rnd() - 0.5) * 0.4;
      const lz = z + (rnd() - 0.5) * 0.4;
      const h = 0.2 - i * 0.05;
      const m = b.cyl(h, 0.2 + rnd() * 0.15, 0.8 - i * 0.15, 7, lx, ground(lx, lz) + h / 2 - 0.02, lz, IRON, { y: rnd() * Math.PI });
      m.scaling.x = 1.1 + rnd() * 0.4;
    }
    for (let i = 0; i < 12; i++) {
      const a = rnd() * 2 * Math.PI;
      const r = 0.2 + rnd() * 0.35;
      const lx = x + Math.sin(a) * r;
      const lz = z + Math.cos(a) * r;
      const s = 0.08 + rnd() * 0.07;
      b.box(s, s * 0.7, s * 1.2, lx, ground(lx, lz) + 0.04 + (0.55 - r) * 0.2, lz, IRON, { x: rnd(), y: rnd() * 3, z: rnd() });
    }
  }
  // Spare brick for the next clamming, stacked on the other side.
  {
    const x = -side * 1.6;
    const z = -2.0;
    const g = ground(x, z);
    const yaw = side * 0.5;
    // Hacked as a brickmaker stacks them: each course of stretchers laid
    // across the one under it, the top course short.
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (let course = 0; course < 4; course++) {
      const across = course % 2 === 1;
      const n = course === 3 ? 2 : 3;
      for (let i = 0; i < n; i++) {
        for (const j of [-0.5, 0.5]) {
          const a = (i - 1) * 0.12 + (rnd() - 0.5) * 0.015;
          const bOff = j * 0.235;
          const [lu, lv] = across ? [bOff, a] : [a, bOff];
          b.box(0.22, 0.066, 0.11, x + lu * c + lv * sn, g + 0.034 + course * 0.07, z - lu * sn + lv * c, BRICK, {
            y: yaw + (across ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.06,
          });
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      const lx = x + (rnd() - 0.5) * 1.0;
      const lz = z - 0.45 - rnd() * 0.3;
      b.box(0.22, 0.068, 0.11, lx, ground(lx, lz) + 0.034, lz, BRICK, { y: rnd() * 3 });
    }
    // The rake the ash was drawn with, dropped across the front.
    const x0 = x + side * 0.3;
    const z0 = z - 0.6;
    const x1 = x0 + side * 1.5;
    const z1 = z0 - 0.35;
    limb(b, [x0, ground(x0, z0) + 0.03, z0], [x1, ground(x1, z1) + 0.03, z1], 0.045, 0.04, TIMBER);
    const hx = x1 + side * 0.06;
    b.box(0.05, 0.05, 0.42, hx, ground(hx, z1) + 0.03, z1 - 0.01, IRON, { y: Math.atan2(side * 1.5, -0.35) + Math.PI / 2 });
  }

  // --- the masses, emitted last so the detail over them hides them ---------
  b.cyl(2.6, 2 * DRUM.r1, 2 * DRUM.r0, SIDES, 0, 1.3, 0, BRICK, turned);
  b.cyl(1.1, 2 * NECK.r1, 2 * NECK.r0, SIDES, 0, 3.15, 0, BRICK, turned);

  b.light(EMBER, 17, 1.9, 0.42, 0, 0.8, -2.0);
  b.sound("fire", 0, PLINTH + 0.2, -1.9);
  return b;
}
