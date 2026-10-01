/**
 * kit/buildings/jungleRuin.ts — buildJungleRuin: the rendered colonial house
 * the forest has taken back.
 * Part of the buildings set: follows the contract in kit/core.ts; the set's
 * files are listed in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import { CONFIG } from "../../../config";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import { marksSway } from "../../sway";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Structure,
  streetSeed,
  convexSolid,
  curtain,
  onFace,
  outward,
  type Hole,
  type Side,
  fern,
  heading,
  limb,
  orient,
  rope,
  slab,
  stepAlong,
  BRICK,
  CREEPER,
  DARK_STONE,
  DIRT,
  FIG_BARK,
  FIG_LEAF,
  FIG_LEAF_LIT,
  IRON,
  MOSS_STONE,
  PITCH,
  PLANK,
  STONE,
  STUCCO,
  TEAK,
  THATCH,
  TIMBER,
  VERDIGRIS,
} from "../core";
import {
  RUIN_CORE,
  TILE,
  TILE_SLATE,
  COURSE,
  RENDER_T,
  CORE_BACK,
  patch,
  spallsOn,
  renderFace,
  wallHead,
  toothing,
  quoins,
  type Spall,
  type RenderFace,
  type HeadSeg,
} from "./render";

/**
 * Walked height of a jungle ruin's floor. Three numbers had to agree: inside
 * `stepHeight` so the plinth links from every bearing with no ramp, at least
 * `HEIGHT_EPS` (0.35) above the terrain so it is a genuine second nav surface
 * rather than a coplanar smear on the floor, and standing on enough slab that
 * the outline shell cannot win the depth test across it.
 */
const RUIN_FLOOR = 0.45;

/**
 * A colonial house the forest has taken back: a brick house rendered in lime
 * stucco on a stone plinth, its roof gone and its walls broken down to
 * different heights, with a fig growing up through the north-east corner of
 * the room and gripping the walls either side of it.
 *
 * `buildRuin` is this building's temperate cousin and the grammar is
 * deliberately the same: every wall is cover on both sides and none reaches
 * the eaves. Two things are different, and both are the point.
 *
 * **The floor is real.** `buildRuin` lays a 0.2 m visual-only slab and gets
 * away with it because nothing stands on it: its walls are chest-high and the
 * fight is around them. This one has walls at head height and doorways through
 * them, so the fight is INSIDE it, and a floor you fight on is a walked surface
 * with everything that implies: a thick box placed by its top face, and a
 * collider.
 *
 * **One wall can be shot through.** The +X elevation keeps its full height but
 * carries an empty window: a ruin whose every standing wall is opaque is a set
 * of blinds, and the one opening is what makes holding the inside a decision
 * rather than a default. It is a window and not a door — sill at 1.2 above the
 * floor — so it is a firing port, not a fourth way in.
 *
 * Nav: two surfaces per cell, terrain and the plinth. There is no roof and no
 * upper storey, which is the whole reason this one can carry a fallen roof and
 * a tree without anyone having to count.
 *
 * ## The masses are the colliders' and the detail is the drawing
 *
 * The block at the top of the builder is every collider this ruin has ever
 * had, in the order it has always emitted them. They are stated by hand now,
 * because nothing is drawn as the box `wall` would draw — so a change below
 * that block owes no `npm run collision`, and one inside it does. The door
 * wall is `doorWall`'s arithmetic spelled out, in that method's own order, so
 * the bake cannot move by a float.
 *
 * Everything else is drawing, and all of it obeys one of three rules: it is
 * flat on a face, it is low enough to walk over, or it stands on top of a
 * collider. A broken head and the teeth at a break stand a course or several
 * over the box that answers for them, which is the cottage's trade at its
 * eaves: a round through the top course of a ruin passes.
 *
 * ## What it is drawn as
 *
 * - **Brick under lime render.** Each wall is a dark brick core with a coat of
 *   stucco on both faces, laid as strips a hand wide (`renderFace`). Where the
 *   render has come away — patches over every face, a bite out of every break,
 *   and the head of every broken wall — the brick shows in stretcher bond,
 *   three and a half centimetres back from the stucco, which is the step the
 *   ink draws a spall's edge by.
 * - **Broken heads and broken ends.** A head is short stretches of brick a
 *   course or several high, mossed or with a loose brick on it; a wall that
 *   broke off has teeth down its end, one pair of courses in two running on;
 *   and where a wall has gone altogether its footing is still there, a course
 *   or three high, so the line of the house survives. The north wall still
 *   has its eave: a stucco coping, and a cornice in three steps on the outside
 *   with a length fallen out of it.
 * - **The things a colonial house is recognised by.** Quoins up the two
 *   corners that are still corners. A skirting of render outside and a dado
 *   inside, painted darker below the moulding. A stone plinth of coursed
 *   blocks under a capping, cut to the ground under it and with a block or two
 *   pushed out or gone. A moulded case round the window with a keystone, a
 *   hood and a stone sill, the frame's stub mullion still hanging, and one
 *   louvred shutter left, hanging off its top hinge. A door case of pilasters
 *   under a head, a timber lintel through the wall, a stone threshold and
 *   steps down to the ground; one leaf still hung and swung back against the
 *   wall, the other flat on the floor. A copper downpipe off a hopper under
 *   the cornice, its foot fallen. A row of joist pockets inside, where the
 *   ceiling was, some with a rotted joist still in them.
 * - **The floor** is tiles in a two-colour checker on a bed of dark earth,
 *   lost wherever the forest has got in — round the fig, at each gap in the
 *   walls, worn through at the threshold — and lifted and tilted where the
 *   roots run under them. Leaf litter drifts against the walls.
 * - **The roof lies where it fell.** The copper heap is a bank of rubble with
 *   two lengths of seamed sheet on it, creased where they folded, and rafters
 *   out from under it; a second, smaller sheet lies crumpled on the floor.
 *   Timbers lie about the room and one leans on the south wall.
 * - **The veranda's corner.** Its two posts stand on stone pedestals, turned
 *   octagonal, with capitals, bolsters and knee braces under the beam; the
 *   beam is broken off beyond the second post and hangs; a rafter hangs off it
 *   to the ground and a scrap of copper is draped over it. Along the front the
 *   rest of the posts are pedestals, and one lies on the ground.
 * - **The fig.** A strangler: three stems braided round a core, flared into
 *   buttresses at the foot, rooting over the east wall's head and down its
 *   outside to the ground, over the north stub the same way, and across the
 *   floor under the tiles. Its crown is the forest's own — the same plates
 *   and fronds as `buildJungleTree`, and marked to move in the same wind — at
 *   the forest's height, with aerial roots hanging off a limb over the room
 *   and a bird's-nest fern in the fork. Every root and fin hugs a wall or
 *   lies on the floor; nothing of it stands in the room at chest height, and
 *   nothing of it hangs lower than 2.4 m over the floor.
 * - **The forest on the masonry.** Creeper hangs down the faces from the
 *   heads it has taken over — off the cornice's lip on the north front, so
 *   the curtain stands off the wall the way it would — and stops short of
 *   every opening. Ferns grow out of the heads, the floor and the foot of the
 *   plinth; moss holds the heads and the capping; and the rubble where the
 *   north wall came down lies against it outside, with a length of wall face
 *   up in it.
 *
 * **All of it is seeded off where the ruin stands** (`streetSeed`), and the
 * plinth, the steps, the veranda and the rubble outside are cut to the ground
 * under them, which is what puts `jungleRuin` in `CONFORMS_TO_TERRAIN`.
 */
export function buildJungleRuin(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "jungleruin");
  const w = p.width ?? 12;
  const d = p.depth ?? 9;
  const h = p.height ?? 3.6;
  const t = 0.45;
  /** Centre height of a wall of height `hh` standing on the plinth. */
  const on = (hh: number): number => RUIN_FLOOR + hh / 2;
  // The east window, stated once because the colliders and the drawing both
  // read it.
  const runZ = d * 0.72;
  const midZ = d * 0.14;
  const gap = 1.5;
  const sill = 1.2;
  const head = 2.4;
  const leg = (runZ - gap) / 2;
  // The south wall and its door: `doorWall(w, 2.4, t, ..., 2.0, 2.2)`.
  const southH = 2.4;
  const doorW = 2.0;
  const doorH = 2.2;

  // ------------------------------------------------------------ the masses
  //
  // Every collider the ruin has, in the order it has always emitted them. See
  // the header before adding to it.
  b.block({ w: w + 0.8, h: 0.6, d: d + 0.8, x: 0, y: RUIN_FLOOR - 0.3, z: 0 });
  b.block({ w: w * 0.62, h, d: t, x: -w * 0.19, y: on(h), z: d / 2 });
  b.block({ w: w * 0.38, h: 1.1, d: t, x: w * 0.31, y: on(1.1), z: d / 2 });
  for (const sz of [-1, 1]) {
    b.block({ w: t, h, d: leg, x: w / 2, y: on(h), z: midZ + (sz * (gap + leg)) / 2 });
  }
  b.block({ w: t, h: sill, d: gap, x: w / 2, y: on(sill), z: midZ });
  b.block({ w: t, h: h - head, d: gap, x: w / 2, y: RUIN_FLOOR + head + (h - head) / 2, z: midZ });
  b.block({ w: t, h: 1.1, d: d * 0.5, x: -w / 2, y: on(1.1), z: -d * 0.1 });
  {
    const side = (w - doorW) / 2;
    const lintel = southH - doorH;
    if (side > 0.05) {
      const off = doorW / 2 + side / 2;
      b.block({ w: side, h: southH, d: t, x: 0 - off, y: on(southH), z: -d / 2 });
      b.block({ w: side, h: southH, d: t, x: 0 + off, y: on(southH), z: -d / 2 });
    }
    if (lintel > 0.05) {
      b.block({ w: doorW, h: lintel, d: t, x: 0, y: on(southH) + southH / 2 - lintel / 2, z: -d / 2 });
    }
  }
  // The veranda's two surviving posts. Each is a collider of its own: a post
  // you shoot through standing beside one you do not reads as a hitscan bug,
  // which is the manor's rule.
  for (let i = 0; i < 2; i++) {
    b.block({ w: 0.34, h: 3.0, d: 0.34, x: w / 2 + 1.5, y: on(3.0), z: -d / 2 - 0.4 - i * 2.4 });
  }
  // The fallen roof: chest cover inside.
  b.block({ w: 3.6, h: 0.9, d: 2.6, x: -w * 0.16, y: on(0.9), z: d * 0.1 });

  // ----------------------------------------------------------- the drawing
  const rnd = mulberry32(streetSeed(w, d, h, ctx));
  const F = RUIN_FLOOR;
  const top = F + h;
  /** The ends of the north wall's two pieces: its west corner and its break. */
  const xA = -w / 2;
  const xB = -w * 0.19 + w * 0.31;
  /** Where the east wall's south end broke off. */
  const zE0 = midZ - runZ / 2;
  /** The plinth's half extents. */
  const PX = w / 2 + 0.4;
  const PZ = d / 2 + 0.4;
  /** The veranda's posts. */
  const colX = w / 2 + 1.5;
  const colZ = [-d / 2 - 0.4, -d / 2 - 2.8];
  /** The fallen roof. */
  const heapX = -w * 0.16;
  const heapZ = d * 0.1;
  /** The fig. */
  const tx = w / 2 - 0.9;
  const tz = d / 2 - 0.9;
  const core = t - 2 * CORE_BACK;
  const headW = t - 0.06;

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

  // ---- the plinth: coursed blocks under a capping, over a dark core that
  // runs down to the lowest ground under the footprint.
  //
  // **Whatever is hidden is emitted AFTER what hides it** — the plinth's core
  // after its facing and the floor, a wall's brick core after its render, the
  // fallen roof's core after its rubble — and that order is load-bearing. The
  // part merge keeps it, so within one draw the depth test rejects the hidden
  // layer instead of shading it and then shading over it: laid the other way
  // round, standing in the room cost about 4% of the frame in overdraw alone.
  let low = -0.15;
  {
    for (const [sx, sz] of [
      [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0],
    ]) {
      low = Math.min(low, ground(sx * PX, sz * PZ) - 0.25);
    }
    const CAP = 0.13;
    const LENS = [1.1, 0.8, 1.3, 0.9, 1.2, 0.75, 1.0];
    const CH = 0.28;
    const courseTop = F - CAP + 0.01;
    // The ±Z faces take the corners, the ±X faces stop short of them.
    const faces = [
      { alongX: true, sgn: 1, half: PX + 0.02, at: PZ },
      { alongX: true, sgn: -1, half: PX + 0.02, at: PZ },
      { alongX: false, sgn: 1, half: PZ - 0.12, at: PX },
      { alongX: false, sgn: -1, half: PZ - 0.12, at: PX },
    ];
    for (const [fi, f] of faces.entries()) {
      for (let c = 0; courseTop - c * CH > low; c++) {
        const yt = courseTop - c * CH;
        const yb = yt - CH;
        let u = -f.half - ((c * 0.31 + fi * 0.17) % 0.5);
        for (let k = 0; u < f.half; k++) {
          const len = LENS[(k + c * 3 + fi) % LENS.length];
          const u0 = Math.max(u, -f.half);
          const u1 = Math.min(u + len, f.half);
          u += len;
          if (u1 - u0 < 0.08) continue;
          const um = (u0 + u1) / 2;
          const g = f.alongX ? ground(um, f.sgn * f.at) : ground(f.sgn * f.at, um);
          if (yt < g - 0.03) continue;
          const bot = Math.max(yb, g - 0.12);
          if (yt - bot < 0.06) continue;
          const r = rnd();
          if (r < 0.03) continue;
          const push = r < 0.09 ? 0.025 + rnd() * 0.035 : 0;
          const bh = yt - bot - 0.022;
          const cy = bot + bh / 2;
          const cc = f.sgn * (f.at - 0.05 + push);
          const rot = push ? { y: (rnd() - 0.5) * 0.08 } : undefined;
          if (f.alongX) b.box(u1 - u0 - 0.022, bh, 0.14, um, cy, cc, MOSS_STONE, rot);
          else b.box(0.14, bh, u1 - u0 - 0.022, cc, cy, um, MOSS_STONE, rot);
        }
      }
    }
    // The capping, in lengths, a few settled or cracked. The ±Z runs take the
    // corners; each reaches in under its wall and no further, so it never
    // shares a plane with the floor.
    const capY = F + 0.01 - CAP / 2;
    const over = 0.06;
    const lay = (alongX: boolean, sgn: number): void => {
      const half = alongX ? PX + over : d / 2;
      const inner = alongX ? d / 2 : w / 2;
      const depth = (alongX ? PZ : PX) + over - inner;
      for (let u = -half; u < half - 0.05; ) {
        const len = Math.min(0.85 + rnd() * 0.45, half - u);
        const r = rnd();
        const um = u + len / 2;
        const cc = sgn * (inner + depth / 2);
        u += len;
        if (r < 0.04) continue;
        const drop = r < 0.12 ? 0.012 : 0;
        const rot = r < 0.12 ? { y: (rnd() - 0.5) * 0.04 } : undefined;
        if (alongX) b.box(len - 0.018, CAP, depth, um, capY - drop, cc, STONE, rot);
        else b.box(depth, CAP, len - 0.018, cc, capY - drop, um, STONE, rot);
        if (rnd() < 0.3) {
          // Moss on the ledge the wall leaves, never under the wall.
          const mc = sgn * ((alongX ? PZ : PX) + over - 0.13);
          const ml = len * (0.4 + rnd() * 0.5);
          if (alongX) b.box(ml, 0.012, 0.2, um, F + 0.016, mc, CREEPER);
          else b.box(0.2, 0.012, ml, mc, F + 0.016, um, CREEPER);
        }
      }
    };
    lay(true, 1);
    lay(true, -1);
    lay(false, 1);
    lay(false, -1);

    // Steps down from the threshold, where the ground in front of the plinth
    // is low enough to want them.
    const g = ground(0, -PZ - 0.35);
    const drop = F - g;
    if (drop > 0.22) {
      const n = Math.max(1, Math.round(drop / 0.2) - 1);
      for (let i = 1; i <= n; i++) {
        const st = F - (i * drop) / (n + 1);
        const sz = -PZ - over - 0.17 - (i - 1) * 0.34;
        const gs = ground(0, sz);
        b.box(2.6 - i * 0.12, st - gs + 0.12, 0.36, 0, (st + gs - 0.12) / 2, sz, STONE, { y: (rnd() - 0.5) * 0.03 });
      }
    }
  }

  // ---- the floor: tiles in a checker on the bed, lost where the forest has
  // got in and lifted where the fig's roots run under them.
  {
    const rx0 = -w / 2 + t / 2;
    const rx1 = w / 2 - t / 2;
    const rz0 = -d / 2 + t / 2;
    const rz1 = d / 2 - t / 2;
    const nx = Math.max(2, Math.round((rx1 - rx0) / 0.5));
    const nz = Math.max(2, Math.round((rz1 - rz0) / 0.5));
    const sx = (rx1 - rx0) / nx;
    const sz = (rz1 - rz0) / nz;
    const blobs = [
      { x: tx, z: tz, r: 1.8 },
      { x: -w / 2 + 0.9, z: d / 2 - 0.8, r: 1.3 },
      { x: -w / 2 + 0.7, z: -d / 2 + 0.7, r: 1.0 },
      { x: 0, z: -d / 2 + 0.45, r: 0.85 },
      { x: w / 2 - 0.8, z: -d / 2 + 0.8, r: 1.0 },
      { x: (rnd() - 0.5) * w * 0.5, z: (rnd() - 0.5) * d * 0.4, r: 0.6 + rnd() * 0.5 },
    ];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = rx0 + (i + 0.5) * sx;
        const z = rz0 + (j + 0.5) * sz;
        // Under the fallen roof nothing is seen.
        if (Math.abs(x - heapX) < 1.65 && Math.abs(z - heapZ) < 1.15) continue;
        let lost = 0.05;
        for (const bl of blobs) {
          const q = Math.hypot(x - bl.x, z - bl.z) / bl.r;
          if (q < 1) lost = Math.max(lost, 0.95 - 0.75 * q * q);
        }
        if (rnd() < lost) {
          if (rnd() < 0.35) {
            b.box(sx * (0.45 + rnd() * 0.5), 0.012, sz * (0.4 + rnd() * 0.5), x + (rnd() - 0.5) * 0.15, F, z + (rnd() - 0.5) * 0.15, CREEPER, { y: rnd() * Math.PI });
          }
          continue;
        }
        const color = ((i + j) & 1) === 0 ? TILE : TILE_SLATE;
        const dt = Math.hypot(x - tx, z - tz);
        const lift = dt < 2.4 ? 1 - dt / 2.4 : 0;
        const rot = lift > 0
          ? { x: (rnd() - 0.5) * 0.2 * lift, y: (rnd() - 0.5) * 0.12 * lift, z: (rnd() - 0.5) * 0.2 * lift }
          : undefined;
        const y = F - 0.003 + lift * 0.04 * rnd();
        const tw = sx - 0.022;
        if (rnd() < 0.07) {
          // Cracked across, one half settled.
          const cut = 0.35 + rnd() * 0.3;
          b.box(tw * cut - 0.008, 0.03, sz - 0.022, x - tw / 2 + (tw * cut) / 2 - 0.004, y, z, color, rot);
          b.box(tw * (1 - cut) - 0.008, 0.03, sz - 0.022, x + tw / 2 - (tw * (1 - cut)) / 2 + 0.004, y - 0.006, z, color, { y: (rnd() - 0.5) * 0.06 });
        } else {
          b.box(tw, 0.03, sz - 0.022, x, y, z, color, rot);
        }
      }
    }
    // Leaf litter, drifted against the walls where the wind leaves it.
    const n = Math.round((w + d) * 3);
    for (let i = 0; i < n; i++) {
      const side = Math.floor(rnd() * 4);
      const f = rnd();
      const off = rnd() * rnd() * 0.8 + 0.04;
      const x = side < 2 ? rx0 + f * (rx1 - rx0) : side === 2 ? rx0 + off : rx1 - off;
      const z = side >= 2 ? rz0 + f * (rz1 - rz0) : side === 0 ? rz0 + off : rz1 - off;
      if (Math.abs(x - heapX) < 1.8 && Math.abs(z - heapZ) < 1.3) continue;
      const s = 0.12 + rnd() * 0.22;
      b.box(s, 0.01, s * (0.5 + rnd() * 0.6), x, F + 0.022 + rnd() * 0.012, z, rnd() < 0.6 ? THATCH : PLANK, { y: rnd() * Math.PI });
    }
    // Ferns where the floor has gone back to earth.
    fern(b, -w / 2 + 0.8, F, d / 2 - 0.7, 0.8, rnd);
    fern(b, -w / 2 + 0.6, F, -d / 2 + 0.6, 0.65, rnd);
    fern(b, w / 2 - 0.7, F, -d / 2 + 0.75, 0.6, rnd);
    // Under all of it, the bed the tiles are laid on — what shows where one
    // has gone — and the plinth's core.
    b.box(w + 0.7, 0.096, d + 0.7, 0, F - 0.052, 0, DIRT);
    b.box(w + 0.7, F - 0.1 - low, d + 0.7, 0, (F - 0.1 + low) / 2, 0, DARK_STONE);
  }

  // ---- the render
  const win: Hole = { u0: midZ - gap / 2, u1: midZ + gap / 2, y0: F + sill, y1: F + head };
  const door: Hole = { u0: -doorW / 2, u1: doorW / 2, y0: F - 1, y1: top + 1 };
  const pipeU = xA + 0.6;
  /** What no spall may undercut: a moulding, a quoin, the pipe. */
  const keepN: Hole[] = [
    { u0: xA - t, u1: xA + 0.1, y0: F - 1, y1: top + 1 },
    { u0: pipeU - 0.25, u1: pipeU + 0.25, y0: F - 1, y1: top + 1 },
    { u0: xA - t, u1: xB, y0: top - 0.5, y1: top + 1 },
  ];
  const keepE: Hole[] = [
    { u0: win.u0 - 0.3, u1: win.u1 + 1.1, y0: win.y0 - 0.25, y1: win.y1 + 0.35 },
    { u0: d / 2 - 0.4, u1: d / 2 + t, y0: F - 1, y1: top + 1 },
  ];
  const keepS: Hole[] = [{ u0: -doorW / 2 - 0.4, u1: doorW / 2 + 0.4, y0: F - 1, y1: top + 1 }];
  /** The joist pockets, where the ceiling's joists were built into the wall. */
  const pocketY = top - 0.62;
  const pocketsN: number[] = [];
  const pocketsE: number[] = [];
  if (h >= 3) {
    for (let u = xA + 0.45; u < xB - 0.5; u += 0.62) pocketsN.push(u);
    for (let u = zE0 + 0.5; u < d / 2 - t / 2 - 0.3; u += 0.62) pocketsE.push(u);
  }
  const pocket = (u: number): Hole => ({ u0: u - 0.065, u1: u + 0.065, y0: pocketY, y1: pocketY + 0.2 });
  const lintelIn: Hole = { u0: win.u0 - 0.25, u1: win.u1 + 0.25, y0: F + head, y1: F + head + 0.16 };
  const doorLintel: Hole = { u0: -doorW / 2 - 0.25, u1: doorW / 2 + 0.25, y0: F + doorH, y1: top + 1 };
  const bite = (u: number, y: number, hu: number, hy: number): Spall[] => patch(u, y, hu, hy, rnd);

  const faces: RenderFace[] = [];
  {
    // North, the long piece.
    const ext = { u0: xA - t / 2, u1: xB, y0: F, top };
    faces.push({
      s: "+z", at: d / 2 + t / 2, ...ext, holes: [], fray: 0.03, skirting: true, streaks: true,
      spalls: [
        ...spallsOn(ext, 2, rnd, keepN),
        ...bite(xB, F + 1.1 + (h - 1.1) * 0.55, 0.45, (h - 1.1) * 0.4),
        ...bite(xA + 2.2 + rnd() * (xB - xA - 3.5), F + 0.35, 0.6, 0.28),
      ],
    });
    faces.push({
      s: "-z", at: d / 2 - t / 2, ...ext, holes: pocketsN.map(pocket), fray: 0.05, dado: F + 1.0,
      spalls: [...spallsOn(ext, 1, rnd, [keepN[2]]), ...bite(xB, F + 1.1 + (h - 1.1) * 0.55, 0.4, (h - 1.1) * 0.38)],
    });
    // Its west end, which is still a corner.
    faces.push({ s: "-x", at: -(w / 2 + t / 2), u0: d / 2 - t / 2, u1: d / 2 + t / 2, y0: F, top, holes: [], spalls: [], fray: 0.03, skirting: true });
    // North, the stub.
    const stub = { u0: xB, u1: w / 2 - t / 2, y0: F, top: F + 1.1 };
    faces.push({
      s: "+z", at: d / 2 + t / 2, ...stub, holes: [], fray: 0.25, skirting: true, streaks: true,
      spalls: [...spallsOn(stub, 1, rnd, []), ...bite(xB + 0.2, F + 0.9, 0.5, 0.35)],
    });
    faces.push({
      s: "-z", at: d / 2 - t / 2, ...stub, holes: [], fray: 0.25, dado: F + 1.0,
      spalls: spallsOn(stub, 1, rnd, []),
    });
    // East.
    const east = { u0: zE0, u1: d / 2 + t / 2, y0: F, top };
    faces.push({
      s: "+x", at: w / 2 + t / 2, ...east, holes: [win], fray: 0.05, skirting: true, streaks: true,
      spalls: [...spallsOn(east, 2, rnd, keepE), ...bite(zE0, F + h * 0.55, 0.42, h * 0.3)],
    });
    faces.push({
      s: "-x", at: w / 2 - t / 2, ...east, fray: 0.05, dado: F + 1.0,
      holes: [win, lintelIn, { u0: d / 2 - t / 2, u1: d / 2 + t, y0: F - 1, y1: F + 1.1 }, ...pocketsE.map(pocket)],
      spalls: [...spallsOn(east, 1, rnd, [{ ...lintelIn, y1: lintelIn.y1 + 0.2 }]), ...bite(zE0, F + h * 0.5, 0.38, h * 0.25)],
    });
    // The corner the east wall keeps, facing north.
    faces.push({ s: "+z", at: d / 2 + t / 2, u0: w / 2 - t / 2, u1: w / 2 + t / 2, y0: F, top, holes: [], spalls: [], fray: 0.05, skirting: true });
    // West.
    const west = { u0: -d * 0.35, u1: d * 0.15, y0: F, top: F + 1.1 };
    faces.push({
      s: "-x", at: -(w / 2 + t / 2), ...west, holes: [], fray: 0.25, skirting: true, streaks: true,
      spalls: [...spallsOn(west, 1, rnd, []), ...bite(west.u0, F + 0.8, 0.35, 0.4), ...bite(west.u1, F + 0.7, 0.3, 0.35)],
    });
    faces.push({
      s: "+x", at: -(w / 2 - t / 2), ...west, holes: [], fray: 0.25, dado: F + 1.0,
      spalls: bite(west.u1, F + 0.8, 0.3, 0.4),
    });
    // South.
    const south = { u0: -w / 2, u1: w / 2, y0: F, top: F + southH };
    faces.push({
      s: "-z", at: -(d / 2 + t / 2), ...south, holes: [door], fray: 0.2, skirting: true, streaks: true,
      spalls: [...spallsOn(south, 2, rnd, keepS), ...bite(-w / 2, F + 1.4, 0.4, 0.65), ...bite(w / 2, F + 1.2, 0.42, 0.6)],
    });
    faces.push({
      s: "+z", at: -(d / 2 - t / 2), ...south, holes: [door, doorLintel], fray: 0.2, dado: F + 1.0,
      spalls: [...spallsOn(south, 1, rnd, [...keepS, { u0: 1, u1: 2.2, y0: F - 1, y1: top }]), ...bite(-w / 2, F + 1.3, 0.35, 0.55), ...bite(w / 2, F + 1.5, 0.38, 0.5)],
    });
  }
  for (const f of faces) renderFace(b, f, rnd);

  // ---- the walls' cores: brick, set back behind the render on both faces.
  b.box(w * 0.62 + t / 2, h, core, -w * 0.19 - t / 4, on(h), d / 2, RUIN_CORE);
  b.box(w * 0.38, 1.1, core, w * 0.31, on(1.1), d / 2, RUIN_CORE);
  for (const sz of [-1, 1]) b.box(core, h, leg, w / 2, on(h), midZ + (sz * (gap + leg)) / 2, RUIN_CORE);
  // The east wall's north end is carried on to the outside corner: the north
  // wall broke off below it, and this is the corner that is left.
  b.box(core, h, t / 2, w / 2, on(h), d / 2 + t / 4, RUIN_CORE);
  b.box(core, sill, gap, w / 2, on(sill), midZ, RUIN_CORE);
  b.box(core, h - head, gap, w / 2, F + head + (h - head) / 2, midZ, RUIN_CORE);
  b.box(core, 1.1, d * 0.5, -w / 2, on(1.1), -d * 0.1, RUIN_CORE);
  {
    const side = (w - doorW) / 2;
    const off = doorW / 2 + side / 2;
    for (const k of [-1, 1]) b.box(side, southH, core, k * off, on(southH), -d / 2, RUIN_CORE);
    // The lintel is a baulk of teak run through the wall and bedded a hand
    // into each jamb.
    b.box(doorW + 0.5, southH - doorH, t + 0.004, 0, F + doorH + (southH - doorH) / 2, -d / 2, TEAK);
  }

  // The joist pockets: dark in the brick, and a rotted joist left in a few.
  for (const [s, at, us] of [
    ["-z", d / 2 - t / 2, pocketsN],
    ["-x", w / 2 - t / 2, pocketsE],
  ] as const) {
    const plane = outward(s) * at;
    for (const u of us) {
      onFace(b, s, plane, u, pocketY + 0.1, 0.13, 0.2, 0.004, -CORE_BACK + 0.002, PITCH);
      if (rnd() < 0.3) {
        const stub = 0.12 + rnd() * 0.3;
        onFace(b, s, plane, u, pocketY + 0.095, 0.1, 0.17, stub + 0.05, stub / 2 - 0.02, TIMBER, (rnd() - 0.5) * 0.08);
      }
    }
  }

  // ---- the heads, the breaks and the footings.
  const straight = (k: number) => (): number => k;
  const grownN: [number, number][] = [[xA + 1.2, xA + 3.4]];
  const grownE: [number, number][] = [[zE0 + 0.2, win.u0 - 0.3], [tz - 0.3, tz + 0.5]];
  const heads: HeadSeg[][] = [];
  // The north wall kept its eave: a coping, gone near the break.
  const breakN = xB - 0.6 - rnd() * 0.5;
  heads.push(
    wallHead(b, true, d / 2, xA - t / 2, xB, top, headW, (u) => (u > breakN ? 2 : 1), rnd, {
      mossy: 0.35,
      coping: (u) => u < breakN && rnd() > 0.12,
      grown: grownN,
    }),
  );
  // The stub climbs toward the break, as a wall comes down along its bond.
  heads.push(
    wallHead(b, true, d / 2, xB, w / 2 - t / 2, F + 1.1, headW, (u) => 1.2 + 3.5 * Math.max(0, 1 - (u - xB) / 1.4), rnd, { mossy: 0.4 }),
  );
  heads.push(wallHead(b, false, w / 2, zE0, d / 2 + t / 2, top, headW, straight(1.3), rnd, { mossy: 0.35, grown: grownE }));
  heads.push(wallHead(b, false, -w / 2, -d * 0.35, d * 0.15, F + 1.1, headW, straight(1.6), rnd, { mossy: 0.45 }));
  heads.push(
    wallHead(b, true, -d / 2, -w / 2, w / 2, F + southH, headW, (u) => (Math.abs(u) < doorW / 2 + 0.3 ? 1.2 : 1.8), rnd, {
      mossy: 0.35,
      grown: [[-w / 2 + 0.4, -1.5]],
    }),
  );
  // Footings where a wall has gone: a course or three, and the line survives.
  const footing = (alongX: boolean, c: number, u0: number, u1: number): void => {
    if (u1 - u0 > 0.1) wallHead(b, alongX, c, u0, u1, F, headW, straight(1.4), rnd, { mossy: 0.45 });
  };
  footing(false, -w / 2, -d / 2 - t / 2, -d * 0.35);
  footing(false, -w / 2, d * 0.15, d / 2 - t / 2);
  footing(false, w / 2, -d / 2 - t / 2, zE0);
  toothing(b, true, d / 2, xB, 1, F + 1.1, top, headW, rnd);
  toothing(b, false, w / 2, zE0, -1, F, top, headW, rnd);
  toothing(b, false, -w / 2, -d * 0.35, -1, F, F + 1.1, headW, rnd);
  toothing(b, false, -w / 2, d * 0.15, 1, F, F + 1.1, headW, rnd);
  toothing(b, true, -d / 2, -w / 2, -1, F, F + southH, headW, rnd);
  toothing(b, true, -d / 2, w / 2, 1, F, F + southH, headW, rnd);

  // ---- the north front's eave: a cornice in three steps, a length of it
  // fallen, returned round the west corner; the quoins under it; the pipe.
  {
    const plane = d / 2 + t / 2;
    const steps = [
      { y: top - 0.31, tall: 0.07, proud: 0.05 },
      { y: top - 0.215, tall: 0.12, proud: 0.11 },
      { y: top - 0.075, tall: 0.15, proud: 0.18 },
    ];
    const lost0 = xA + 3.4 + rnd() * Math.max(0, xB - xA - 6);
    const lost1 = lost0 + 0.8 + rnd() * 0.6;
    const spans: [number, number][] = [
      [xA - t / 2, lost0],
      [lost1, breakN - 0.2],
    ];
    for (const [si, [u0, u1]] of spans.entries()) {
      steps.forEach((st, k) => {
        // A broken end is stepped back, the deepest member furthest.
        const a = u0 + (si === 0 ? -st.proud : k * 0.12);
        const c = u1 - k * 0.12;
        if (c - a > 0.1) onFace(b, "+z", plane, (a + c) / 2, st.y, c - a, st.tall, st.proud, st.proud / 2, STUCCO);
      });
    }
    for (const st of steps) {
      onFace(b, "-x", w / 2 + t / 2, d / 2 + st.proud / 2, st.y, t + st.proud, st.tall, st.proud, st.proud / 2, STUCCO);
    }
    quoins(
      b,
      { s: "+z", plane, corner: xA - t / 2, dir: 1, max: 1 },
      { s: "-x", plane: w / 2 + t / 2, corner: d / 2 + t / 2, dir: -1, max: t + 0.03 },
      F + 0.3,
      top - 0.36,
    );
    quoins(
      b,
      { s: "+x", plane: w / 2 + t / 2, corner: d / 2 + t / 2, dir: -1, max: 1 },
      { s: "+z", plane, corner: w / 2 + t / 2, dir: -1, max: t + 0.03 },
      F + 0.3,
      top - 0.1,
    );
    // A copper downpipe off a hopper under the cornice, its foot long gone.
    const pipeOut = 0.11;
    onFace(b, "+z", plane, pipeU, top - 0.45, 0.26, 0.2, 0.2, pipeOut + 0.02, VERDIGRIS);
    onFace(b, "+z", plane, pipeU, top - 0.57, 0.16, 0.06, 0.14, pipeOut, VERDIGRIS);
    const pipeFoot = F + 1.1 + rnd() * 0.4;
    b.cyl(top - 0.57 - pipeFoot, 0.09, 0.09, 6, pipeU, (top - 0.57 + pipeFoot) / 2, plane + pipeOut, VERDIGRIS);
    for (const y of [top - 0.9, (top + pipeFoot) / 2 - 0.2, pipeFoot + 0.2]) {
      onFace(b, "+z", plane, pipeU, y, 0.14, 0.035, pipeOut + 0.04, (pipeOut + 0.04) / 2, IRON);
    }
    const lx = pipeU + 0.5;
    const lz = plane + 0.8;
    const lg = ground(lx, lz);
    slab(b, [lx - 0.6, lg + 0.05, lz - 0.1], [lx + 0.5, lg + 0.05, lz + 0.25], 0.09, 0.09, VERDIGRIS);
  }

  // ---- the east window: its case, its sill, the frame's remains and the
  // one shutter left.
  {
    const plane = w / 2 + t / 2;
    const s: Side = "+x";
    const wm = midZ;
    const hw = gap / 2;
    for (const k of [-1, 1]) {
      onFace(b, s, plane, wm + k * (hw + 0.07), F + (sill + head) / 2 + 0.07, 0.14, head - sill + 0.14, 0.04, 0.02, STUCCO);
    }
    onFace(b, s, plane, wm, F + head + 0.07, gap + 0.28, 0.14, 0.04, 0.02, STUCCO);
    onFace(b, s, plane, wm, F + head + 0.2, gap + 0.5, 0.07, 0.11, 0.055, STUCCO);
    onFace(b, s, plane, wm, F + head + 0.06, 0.18, 0.26, 0.06, 0.03, STUCCO);
    onFace(b, s, plane, wm, F + sill - 0.03, gap + 0.36, 0.08, 0.16, 0.06, STONE);
    // The reveals, lined, and the stone sill run through under the opening.
    for (const k of [-1, 1]) b.box(t + 0.02, head - sill, 0.02, w / 2, F + (sill + head) / 2, wm + k * (hw - 0.01), STUCCO);
    b.box(t + 0.02, 0.02, gap, w / 2, F + head - 0.01, wm, STUCCO);
    b.box(t + 0.1, 0.04, gap + 0.04, w / 2 + 0.04, F + sill + 0.01, wm, STONE);
    // The frame: its jambs and head, a stub of the mullion hanging from it.
    const fx = w / 2 + 0.05;
    for (const k of [-1, 1]) b.box(0.1, head - sill - 0.04, 0.07, fx, F + (sill + head) / 2, wm + k * (hw - 0.055), TEAK);
    b.box(0.1, 0.07, gap - 0.04, fx, F + head - 0.055, wm, TEAK);
    b.box(0.1, 0.06, gap - 0.04, fx, F + sill + 0.06, wm, TEAK);
    const stubM = (head - sill) * (0.3 + rnd() * 0.25);
    b.box(0.08, stubM, 0.06, fx, F + head - 0.09 - stubM / 2, wm, TEAK);
    // The shutter, hanging off its top hinge: the lower one gave, and the leaf
    // swung down about the upper until its heel caught the case.
    const hu = wm + hw + 0.2;
    const hy = F + head - 0.02;
    const a = -0.3 - rnd() * 0.12;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const LW = 0.72;
    const LH = 1.15;
    const part = (du: number, dy: number, al: number, tall: number, thick: number, out: number, color: string): void =>
      onFace(b, s, plane, hu + du * ca - dy * sa, hy + du * sa + dy * ca, al, tall, thick, out, color, a);
    for (const du of [0.035, LW - 0.035]) part(du, -LH / 2, 0.07, LH, 0.035, 0.075, TEAK);
    for (const dy of [-0.035, -LH / 2, -LH + 0.035]) part(LW / 2, dy, LW, 0.07, 0.035, 0.075, TEAK);
    for (const [y0, y1] of [
      [-0.075, -LH / 2 - 0.04],
      [-LH / 2 - 0.04 - 0.035, -LH + 0.075],
    ]) {
      for (let y = y0 - 0.035; y > y1; y -= 0.065) {
        if (rnd() < 0.2) continue;
        part(LW / 2, y, LW - 0.13, 0.05, 0.012, 0.07 + (rnd() < 0.5 ? 0.006 : -0.006), TEAK);
      }
    }
    for (const y of [hy - 0.08, hy - LH + 0.08]) onFace(b, s, plane, hu - 0.02, y, 0.07, 0.05, 0.06, 0.04, IRON);
    // Inside: the timber lintel the render has fallen from.
    onFace(b, "-x", -(w / 2 - t / 2), wm, F + head + 0.08, gap + 0.5, 0.16, 0.03, -CORE_BACK + 0.015, TEAK);
  }

  // ---- the south door: its case, the threshold, the two leaves.
  {
    const plane = d / 2 + t / 2;
    const s: Side = "-z";
    for (const k of [-1, 1]) {
      const u = k * (doorW / 2 + 0.11);
      onFace(b, s, plane, u, F + doorH / 2, 0.22, doorH, 0.05, 0.025, STUCCO);
      onFace(b, s, plane, u, F + 0.15, 0.28, 0.3, 0.07, 0.035, STUCCO);
      onFace(b, s, plane, u, F + doorH - 0.04, 0.3, 0.08, 0.08, 0.04, STUCCO);
    }
    onFace(b, s, plane, 0, F + doorH + (southH - doorH) / 2, doorW + 0.54, southH - doorH, 0.05, 0.025, STUCCO);
    b.box(doorW, 0.05, t + 0.12, 0, F - 0.005, -d / 2 - 0.03, STONE);
    // One leaf still hung, swung back flat against the wall inside and
    // dropped on its hinges.
    const ip = -d / 2 + t / 2;
    const ia = -0.04;
    const leafU = doorW / 2 + 0.08 + 0.49;
    const leafY = F + 0.06 + 1.05;
    const leaf = (du: number, dy: number, al: number, tall: number, thick: number, out: number, color: string): void =>
      onFace(b, "+z", ip, leafU + du * Math.cos(ia) - dy * Math.sin(ia), leafY + du * Math.sin(ia) + dy * Math.cos(ia), al, tall, thick, out, color, ia);
    leaf(0, 0, 0.98, 2.1, 0.05, 0.1, TEAK);
    for (const du of [-0.23, 0.23]) {
      for (const dy of [0.5, -0.5]) leaf(du, dy, 0.34, 0.8, 0.018, 0.132, TEAK);
    }
    for (const dy of [0.8, -0.8]) leaf(-0.3, dy, 0.42, 0.05, 0.02, 0.14, IRON);
    // The other on the floor, one end on a lump of the wall.
    const lo: Point3 = [-0.8, F + 0.1, -d / 2 + 1.5];
    const yaw = 0.35 + rnd() * 0.3;
    const pitch = -0.07;
    const at = (x: number, y: number, z: number): Point3 => {
      const y1 = y * Math.cos(pitch) - z * Math.sin(pitch);
      const z1 = y * Math.sin(pitch) + z * Math.cos(pitch);
      return [lo[0] + x * Math.cos(yaw) + z1 * Math.sin(yaw), lo[1] + y1, lo[2] - x * Math.sin(yaw) + z1 * Math.cos(yaw)];
    };
    const rot = { x: pitch, y: yaw };
    b.box(0.98, 0.05, 2.1, lo[0], lo[1], lo[2], TEAK, rot);
    for (const px of [-0.23, 0.23]) {
      for (const pz of [0.5, -0.5]) {
        const q = at(px, 0.033, pz);
        b.box(0.34, 0.018, 0.8, q[0], q[1], q[2], TEAK, rot);
      }
    }
    const under = at(0, -0.12, 0.85);
    b.box(0.3, 0.2, 0.25, under[0], F + 0.08, under[2], BRICK, { y: yaw + 0.4 });
  }

  // ---- the veranda's corner: two posts on their pedestals under the beam,
  // the beam broken beyond them, and the rest of the front gone to pedestals.
  {
    for (const [i, z] of colZ.entries()) {
      const g = ground(colX, z);
      b.box(0.5, F + 0.1 - g + 0.2, 0.5, colX, (F + 0.1 + g - 0.2) / 2, z, STONE);
      b.box(0.56, 0.05, 0.56, colX, F + 0.1, z, STONE);
      b.box(0.4, 0.14, 0.4, colX, F + 0.19, z, TEAK);
      b.cyl(2.56, 0.34, 0.36, 8, colX, F + 0.26 + 1.28, z, TEAK, { y: Math.PI / 8 });
      b.box(0.44, 0.1, 0.44, colX, F + 2.87, z, TEAK);
      b.box(0.26, 0.12, 0.8, colX, F + 2.98, z, TEAK);
      // Knee braces up into the beam, both ways along it, and into the front's
      // stub on the corner post.
      for (const k of i === 0 ? [-1, 1] : [1]) slab(b, [colX, F + 2.3, z], [colX, F + 3.02, z + k * 0.62], 0.09, 0.12, TEAK);
      if (i === 1) slab(b, [colX, F + 2.3, z], [colX - 0.62, F + 3.02, z], 0.09, 0.12, TEAK);
    }
    const bz0 = colZ[1] - 0.3;
    const bz1 = colZ[0] + 0.9;
    b.box(0.24, 0.3, bz1 - bz0, colX, F + 3.15, (bz0 + bz1) / 2, TEAK);
    // Its broken end, hanging.
    slab(b, [colX, F + 3.12, bz1 - 0.05], [colX + 0.08, F + 2.2, bz1 + 0.45], 0.22, 0.26, TEAK);
    for (const k of [-1, 1]) slab(b, [colX + k * 0.07, F + 3.2, bz1 - 0.02], [colX + k * 0.1, F + 3.25, bz1 + 0.25], 0.04, 0.04, TEAK);
    // The front's beam, snapped off a short way from the corner.
    b.box(1.3, 0.3, 0.24, colX - 0.65, F + 3.15, colZ[1], TEAK);
    slab(b, [colX - 1.18, F + 3.2, colZ[1] + 0.07], [colX - 1.45, F + 3.24, colZ[1] + 0.1], 0.04, 0.04, TEAK);
    // A rafter still pinned at the beam, its foot on the ground; another down.
    {
      const fz = colZ[0] - 1.2;
      const gx = colX - 2.2;
      slab(b, [colX - 0.1, F + 3.34, fz + 0.1], [gx, ground(gx, fz - 0.3) + 0.06, fz - 0.3], 0.09, 0.15, TIMBER);
      const lx = colX - 1.4;
      const lz = colZ[1] + 0.6;
      slab(b, [lx, ground(lx, lz) + 0.07, lz], [lx - 2.1, ground(lx - 2.1, lz + 0.7) + 0.07, lz + 0.7], 0.09, 0.14, TIMBER);
      // Two more fell the other way, from the beam across onto the south
      // wall's head, which is what says the beam carried a roof.
      for (const [k, fz] of [
        [0, colZ[0] - 0.55],
        [1, colZ[0] - 1.75],
      ] as const) {
        const hx = w / 2 - 1.1 - k * 1.3;
        slab(b, [colX + 0.05, F + 3.36, fz], [hx, F + southH + 0.18, -d / 2 - t / 2 + 0.1], 0.09, 0.15, TIMBER);
      }
      // And the sheet they still carry, torn short of both ends.
      {
        const a0: Point3 = [colX - 0.5, F + 3.3, colZ[0] - 1.2];
        const a1: Point3 = [w / 2 - 1.3, F + southH + 0.28, -d / 2 - t / 2 - 0.05];
        const o = orient(a0, a1);
        b.box(1.5, 0.025, o.len, o.mid[0], o.mid[1], o.mid[2], VERDIGRIS, { ...o.rot, z: 0.06 });
      }
      // And a scrap of the veranda's copper draped over the beam.
      slab(b, [colX - 0.3, F + 3.32, colZ[0] - 1.9], [colX + 0.35, F + 2.35, colZ[0] - 2.0], 0.8, 0.02, VERDIGRIS);
    }
    // Pedestals where the rest of the front stood, and one of its posts down.
    for (let k = 1; colX - k * 2.6 > -w / 2 + 0.5; k++) {
      const x = colX - k * 2.6;
      const z = colZ[1];
      const g = ground(x, z);
      b.box(0.5, 0.5, 0.5, x, g + 0.05, z, STONE, { y: (rnd() - 0.5) * 0.1 });
      if (k === 1) {
        b.cyl(0.25, 0.28, 0.34, 8, x, g + 0.42, z, TEAK, { y: Math.PI / 8, z: 0.05 });
        const lx = x - 0.4;
        const lz = z - 0.9;
        b.cyl(2.3, 0.32, 0.34, 8, lx, ground(lx, lz) + 0.15, lz, TEAK, { z: Math.PI / 2, y: 0.25 + rnd() * 0.3 });
      }
    }
  }

  // ---- the roof where it fell: a bank of rubble, two lengths of seamed
  // copper creased over it, rafters out from under.
  const chunk = (x: number, z: number, g: number, s: number, faced: boolean): void => {
    const cw = s * (0.8 + rnd() * 0.5);
    const ch = s * (0.4 + rnd() * 0.3);
    const cd = s * (0.55 + rnd() * 0.4);
    const yaw = rnd() * Math.PI;
    if (faced) {
      const tilt = (rnd() - 0.5) * 0.12;
      b.box(cw, ch, cd, x, g + ch * 0.3, z, BRICK, { x: tilt, y: yaw });
      b.box(cw + 0.01, RENDER_T, cd + 0.01, x, g + ch * 0.3 + ch / 2 + RENDER_T / 2 - 0.005, z, STUCCO, { x: tilt, y: yaw });
    } else {
      b.box(cw, ch, cd, x, g + ch * 0.3, z, rnd() < 0.8 ? BRICK : RUIN_CORE, {
        x: (rnd() - 0.5) * 0.6,
        y: yaw,
        z: (rnd() - 0.5) * 0.6,
      });
    }
  };
  const heap = (cx: number, cz: number, rx: number, rz: number, n: number, big: number, floor: (x: number, z: number) => number): void => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd());
      const x = cx + Math.cos(a) * r * rx;
      const z = cz + Math.sin(a) * r * rz;
      const s = big * (0.45 + 0.55 * (1 - r)) * (0.6 + rnd() * 0.5);
      chunk(x, z, floor(x, z) + (1 - r * r) * big * 0.3, s, rnd() < 0.3);
    }
  };
  const onFloor = (): number => F;
  {
    // Rafters and a purlin, out from under the sheet.
    slab(b, [heapX - 2.3, F + 0.1, heapZ - 0.6], [heapX + 1.0, F + 0.86, heapZ - 0.8], 0.1, 0.15, TIMBER);
    slab(b, [heapX - 0.3, F + 0.88, heapZ + 0.9], [heapX + 2.45, F + 0.08, heapZ + 1.25], 0.1, 0.15, TIMBER);
    slab(b, [heapX - 1.55, F + 0.84, heapZ - 1.45], [heapX - 1.3, F + 0.88, heapZ + 1.5], 0.12, 0.12, TIMBER);
    // The sheet in three lengths, creased where it folded. Each is laid in its
    // own frame — turned so its length runs along X, and pitched along it.
    const sheet = (x0: number, y0: number, x1: number, y1: number, zc: number, width: number, yaw: number): void => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const pitch = -Math.atan2(y1 - y0, x1 - x0);
      const turn = Math.PI / 2 + yaw;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const rot = { x: pitch, y: turn };
      b.box(width, 0.025, len, cx, cy, zc, VERDIGRIS, rot);
      // Standing seams, riding the sheet's upper face.
      for (let k = 0; k <= Math.floor(width / 0.45); k++) {
        const lx = -width / 2 + 0.1 + k * 0.45;
        if (lx > width / 2 - 0.05) break;
        const ly = 0.028;
        const y1r = ly * Math.cos(pitch);
        const z1r = ly * Math.sin(pitch);
        b.box(0.03, 0.035, len, cx + lx * Math.cos(turn) + z1r * Math.sin(turn), cy + y1r, zc - lx * Math.sin(turn) + z1r * Math.cos(turn), VERDIGRIS, rot);
      }
    };
    const crease = heapX + 0.25 + (rnd() - 0.5) * 0.4;
    sheet(heapX - 1.95, F + 0.66, crease, F + 0.99, heapZ - 0.1, 2.3, 0.03);
    sheet(crease, F + 0.99, heapX + 1.95, F + 0.8, heapZ - 0.07, 2.25, -0.04);
    sheet(heapX + 1.95, F + 0.8, heapX + 2.3, F + 0.18, heapZ - 0.04, 2.1, -0.06);
    // Its long edge, torn and hanging down the bank on the north side.
    slab(b, [heapX - 0.4, F + 0.9, heapZ + 1.03], [heapX - 0.3, F + 0.38, heapZ + 1.4], 1.7, 0.025, VERDIGRIS);
    for (let i = 0; i < 40; i++) {
      // Banked round the edge of the heap in two tiers, so its sides are
      // rubble and the core under the sheet is never seen.
      const edge = rnd() * 2 * (3.4 + 2.4);
      let x: number;
      let z: number;
      if (edge < 3.4) [x, z] = [heapX - 1.7 + edge, heapZ - 1.2];
      else if (edge < 6.8) [x, z] = [heapX - 1.7 + edge - 3.4, heapZ + 1.2];
      else if (edge < 9.2) [x, z] = [heapX - 1.7, heapZ - 1.2 + edge - 6.8];
      else [x, z] = [heapX + 1.7, heapZ - 1.2 + edge - 9.2];
      const upper = i % 2 === 1;
      const pull = upper ? 0.7 : 1.0;
      x = heapX + (x - heapX) * pull;
      z = heapZ + (z - heapZ) * pull;
      chunk(x, z, F + (upper ? 0.38 + rnd() * 0.18 : 0.02 + rnd() * 0.12), 0.32 + rnd() * 0.22, rnd() < 0.35);
    }
    // The heap's own core, last: see the plinth.
    b.box(2.8, 0.62, 1.8, heapX, F + 0.31, heapZ, RUIN_CORE);
    // A second, smaller sheet crumpled on the floor over a rafter.
    const cx = w * 0.24;
    const cz = -d * 0.22;
    slab(b, [cx - 0.9, F + 0.07, cz - 0.4], [cx + 1.1, F + 0.07, cz + 0.3], 0.1, 0.14, TIMBER);
    sheet(cx - 0.9, F + 0.04, cx + 0.35, F + 0.2, cz, 1.4, 0.35);
    sheet(cx + 0.35, F + 0.2, cx + 0.95, F + 0.05, cz + 0.2, 1.3, 0.5);
    // Timbers about the room, and one leaning on the south wall.
    slab(b, [-w * 0.36, F + 0.12, -d * 0.3], [w * 0.02, F + 0.12, -d * 0.02], 0.2, 0.24, TIMBER);
    slab(b, [-w * 0.27, F + 0.02, -d / 2 + t / 2 + 1.1], [-w * 0.3, F + 2.1, -d / 2 + t / 2 + 0.08], 0.1, 0.14, TIMBER);
    slab(b, [heapX + 0.3, F + 0.05, heapZ - 2.3], [heapX + 0.1, F + 0.92, heapZ - 1.05], 0.09, 0.14, TIMBER);
  }

  // ---- rubble: where the north wall came down, outside it, with a length of
  // the wall lying face up; against the west stub inside; at the gaps.
  {
    const cx = (xB + w / 2) / 2;
    heap(cx, PZ + 1.0, (w / 2 - xB) / 2 + 0.3, 0.9, 20, 0.42, ground);
    const sx = xB + 0.9 + rnd() * 0.6;
    const sz = PZ + 1.2;
    const g = ground(sx, sz);
    const yaw = 0.15 + rnd() * 0.3;
    b.box(1.5, 0.3, 0.85, sx, g + 0.12, sz, BRICK, { y: yaw, z: 0.06 });
    b.box(1.51, RENDER_T, 0.86, sx, g + 0.27 + RENDER_T / 2, sz, STUCCO, { y: yaw, z: 0.06 });
    heap(-w / 2 + t / 2 + 0.5, -d * 0.1, 0.45, d * 0.2, 9, 0.3, onFloor);
    heap(PX + 0.6, (-d / 2 + zE0) / 2, 0.5, 0.7, 7, 0.32, ground);
    heap(-PX - 0.5, -d / 2 + 0.3, 0.5, 0.6, 6, 0.3, ground);
    heap(-PX - 0.5, d / 2 - 0.4, 0.5, 0.7, 6, 0.3, ground);
    for (const k of [-1, 1]) heap(k * (w / 2 - 0.3), -PZ - 0.6, 0.5, 0.4, 5, 0.28, ground);
  }

  // ---- the fig: three stems braided round a core, flared at the foot, its
  // roots over both walls either side and across the floor.
  {
    const fork = Math.max(h + 3.0, 6.6);
    const lean = 0.4;
    const coreD0 = 0.85;
    const coreD1 = 0.45;
    limb(b, [tx, F - 0.25, tz], [tx - lean, F + fork, tz - lean], coreD0, coreD1, FIG_BARK, 8);
    // The stems wind round the core ON its surface: each is offset by the
    // core's own radius at that height plus most of its own, so it stands
    // proud as a rib rather than vanishing inside the column.
    for (let i = 0; i < 4; i++) {
      const th = (i / 4) * Math.PI * 2 + 0.3;
      const d0 = 0.42 - i * 0.03;
      const d1 = 0.2;
      const hs = [-0.2, 0.9, 2.2, 3.8, 5.4, fork];
      const pts = hs.map((y, k): Point3 => {
        const f = Math.max(0, y) / fork;
        const r = (coreD0 + (coreD1 - coreD0) * f) / 2 + ((d0 + (d1 - d0) * f) / 2) * 0.6;
        const a = th + k * 0.5;
        return [tx - lean * f + Math.cos(a) * r, F + y, tz - lean * f + Math.sin(a) * r];
      });
      rope(b, pts, d0, d1, FIG_BARK, 7);
    }
    // Buttresses: to the two walls, into the corner, and three low ones out
    // across the floor. Every one reaches a wall or stays under a knee.
    const fin = (ang: number, len: number, tall: number, thick: number): void => {
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const nx = (-sa * thick) / 2;
      const nz = (ca * thick) / 2;
      const r0 = 0.4;
      const tri = (o: number): Point3[] => [
        [tx + ca * r0 + nx * o, F - 0.05, tz + sa * r0 + nz * o],
        [tx + ca * r0 * 0.6 + nx * o * 0.6, F + tall, tz + sa * r0 * 0.6 + nz * o * 0.6],
        [tx + ca * (r0 + len) + nx * o * 0.3, F - 0.02, tz + sa * (r0 + len) + nz * o * 0.3],
      ];
      convexSolid(b, tri(-1), tri(1), FIG_BARK);
    };
    fin(0, 0.3, 1.7, 0.2);
    fin(Math.PI / 2, 0.3, 1.4, 0.2);
    fin(Math.PI / 4, 0.55, 2.2, 0.22);
    fin(Math.PI, 1.0, 0.6, 0.17);
    fin(-Math.PI / 2, 0.9, 0.62, 0.17);
    fin((-3 * Math.PI) / 4, 1.3, 0.7, 0.18);
    const ex = w / 2 + t / 2;
    const nz = d / 2 + t / 2;
    // Over the east wall's head, down its outside, off the plinth and into
    // the ground, north of the window's shutter and south of the quoins. Two,
    // side by side, which is what makes a strangler's grip read as a grip.
    for (const [k, rz, d0] of [
      [0, tz + 0.05, 0.34],
      [1, tz - 0.45, 0.22],
    ] as const) {
      const gx = PX + 0.35 + k * 0.3;
      const r = d0 / 2;
      rope(b, [
        [tx + 0.2, F + 1.7 + k * 0.7, rz + 0.25],
        [w / 2 - t / 2 - r * 0.6, top - 0.3, rz - 0.05],
        [w / 2 - 0.05, top + COURSE + 0.08 + r, rz],
        [ex + r * 0.9, top - 0.15, rz + 0.08],
        [ex + r * 0.9, F + h * 0.45, rz + 0.3 - k * 0.2],
        [ex + r, F + 0.15, rz + 0.4 - k * 0.3],
        [gx, ground(gx, rz + 0.5) + 0.05, rz + 0.5 - k * 0.3],
        [gx + 0.7, ground(gx + 0.7, rz + 0.7) - 0.04, rz + 0.7 - k * 0.5],
      ], d0, d0 * 0.4, FIG_BARK);
    }
    {
      const rz = tz + 0.05;
      // Thinner ones off them, netted down both faces.
      rope(b, [
        [w / 2 - t / 2 - 0.05, top - 0.3, rz - 0.1],
        [w / 2 - t / 2 - 0.05, F + 2.0, rz - 0.75],
        [w / 2 - t / 2 - 0.05, F + 0.8, rz - 0.45],
        [w / 2 - t / 2 - 0.06, F + 0.05, rz - 0.95],
      ], 0.09, 0.05, FIG_BARK, 5);
      rope(b, [
        [ex + 0.06, F + h * 0.7, rz + 0.18],
        [ex + 0.05, F + h * 0.4, rz - 0.3],
        [ex + 0.06, F + 0.2, rz - 0.15],
      ], 0.08, 0.05, FIG_BARK, 5);
    }
    // Over the north stub and down its outside, two the same way.
    for (const [rx, d0, y0] of [
      [tx - 0.45, 0.36, 0.9],
      [tx - 1.35, 0.24, 0.35],
    ] as const) {
      const gz = PZ + 0.35;
      const r = d0 / 2;
      rope(b, [
        [tx - 0.3, F + y0, tz + 0.2],
        [rx + 0.05, F + 1.1 + 2 * COURSE + r * 0.8, d / 2 - 0.05],
        [rx - 0.05, F + 0.95, nz + r * 0.9],
        [rx - 0.1, F + 0.15, nz + r],
        [rx - 0.2, ground(rx - 0.2, gz) + 0.05, gz],
        [rx - 0.4, ground(rx - 0.4, gz + 0.8) - 0.04, gz + 0.8],
      ], d0, d0 * 0.4, FIG_BARK);
    }
    // Across the floor, along the north wall and out into the room.
    rope(b, [
      [tx - 0.2, F + 0.08, tz + 0.25],
      [tx - 1.4, F + 0.07, d / 2 - t / 2 - 0.12],
      [tx - 2.6, F + 0.05, d / 2 - t / 2 - 0.14],
      [tx - 3.3, F + 0.02, d / 2 - t / 2 - 0.3],
    ], 0.26, 0.08, FIG_BARK);
    rope(b, [
      [tx - 0.2, F + 0.1, tz - 0.25],
      [tx - 1.0, F + 0.06, tz - 1.3],
      [tx - 1.3, F + 0.03, tz - 2.3],
    ], 0.24, 0.07, FIG_BARK);

    // The crown: limbs out of the fork, and the forest's own leaf on them.
    const T: Point3 = [tx - lean, F + fork, tz - lean];
    const C: Point3 = [tx - 0.9, F + fork + 2.4, tz - 0.9];
    limb(b, T, [tx - 2.6, F + fork + 1.9, tz - 2.2], 0.42, 0.18, FIG_BARK);
    limb(b, T, [tx + 0.9, F + fork + 2.2, tz - 0.4], 0.38, 0.16, FIG_BARK);
    limb(b, T, [tx - 0.5, F + fork + 2.6, tz + 0.9], 0.38, 0.16, FIG_BARK);
    const low0: Point3 = [tx - lean * 0.8, F + fork - 1.4, tz - lean * 0.8];
    const low1: Point3 = [tx - 3.3, F + fork - 0.3, tz - 1.1];
    limb(b, low0, low1, 0.3, 0.12, FIG_BARK);
    // Aerial roots off the low limb, over the room and above every head.
    for (let i = 0; i < 4; i++) {
      const f = 0.35 + i * 0.18 + rnd() * 0.06;
      const hang: Point3 = [low0[0] + (low1[0] - low0[0]) * f, low0[1] + (low1[1] - low0[1]) * f - 0.05, low0[2] + (low1[2] - low0[2]) * f];
      const foot = Math.max(F + 2.5, hang[1] - 1.5 - rnd() * 1.8);
      limb(b, hang, [hang[0] + (rnd() - 0.5) * 0.2, foot, hang[2] + (rnd() - 0.5) * 0.2], 0.06, 0.035, FIG_BARK, 5);
    }
    const trans = CONFIG.graphics.translucency.canopy;
    const plates: [number, number, number, number, number][] = [
      // count, height over C, width, depth, thickness
      [4, 0, 6.6, 2.8, 0.5],
      [3, 0.8, 5.0, 2.4, 0.42],
    ];
    plates.forEach(([count, dy, pw, pd, pt], tier) => {
      const turn = rnd() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + turn + rnd() * 0.3;
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
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + turn + rnd() * 0.25;
      const droop = -(0.3 + rnd() * 0.16);
      const base = stepAlong([C[0], C[1] - 0.2, C[2]], heading(a, 0), 0.5);
      const tip = stepAlong(base, heading(a, droop), 3.2);
      const end = stepAlong(tip, heading(a, droop - 0.6 - rnd() * 0.3), 2.5);
      for (const [p0, p1, bw, color] of [
        [base, tip, 1.6, FIG_LEAF],
        [tip, end, 1.15, FIG_LEAF],
      ] as const) {
        const o = orient(p0, p1);
        marksSway(b.translucentBox(bw, 0.14, o.len, o.mid[0], o.mid[1], o.mid[2], color, trans, o.rot), "canopy");
      }
    }
    // A bird's-nest fern in the fork of the low limb.
    fern(b, low0[0], low0[1] + 0.1, low0[2], 0.9, rnd);
  }

  // ---- the forest on the masonry: creeper down the faces it has taken, and
  // ferns on the heads and at the plinth's foot.
  {
    // Off the cornice's lip on the north front, so it hangs clear of the wall.
    curtain(b, "+z", d / 2 + t / 2, grownN[0][0], grownN[0][1], top - 0.05, h * 0.8, 0.2, rnd, () => F + 0.35);
    curtain(b, "+x", w / 2 + t / 2, grownE[0][0], grownE[0][1], top + 0.05, h * 0.85, 0.03, rnd, () => F + 0.3);
    curtain(b, "-x", -(w / 2 - t / 2), tz - 0.3, tz + 0.5, top + 0.05, 1.6, 0.04, rnd, () => F + 1.2);
    curtain(b, "+z", -(d / 2 - t / 2), -w / 2 + 0.4, -1.5, F + southH + 0.05, 1.7, 0.03, rnd, () => F + 0.5);
    // Ferns out of the heads, where a seed lodged in a joint.
    const segs = heads.flat();
    for (let i = 0; i < 5 && segs.length; i++) {
      const sg = segs[Math.floor(rnd() * segs.length)];
      const u = (sg.u0 + sg.u1) / 2;
      const hi = heads.findIndex((hs) => hs.includes(sg));
      // Heads 0, 1 and 4 run along X; 2 and 3 along Z.
      const alongX = hi === 0 || hi === 1 || hi === 4;
      const c = [d / 2, d / 2, w / 2, -w / 2, -d / 2][hi];
      fern(b, alongX ? u : c, sg.top, alongX ? c : u, 0.45 + rnd() * 0.25, rnd);
    }
    for (const [x, z] of [
      [PX + 0.15, -PZ + 0.6],
      [-PX - 0.15, PZ - 1.2],
      [-PX + 1.5, PZ + 0.15],
    ]) {
      fern(b, x, ground(x, z), z, 0.8 + rnd() * 0.3, rnd);
    }
  }
  return b;
}
