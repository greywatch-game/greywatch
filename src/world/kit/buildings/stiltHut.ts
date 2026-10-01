/**
 * kit/buildings/stiltHut.ts — buildStiltHut: the tropical dwelling on its
 * platform.
 * Part of the buildings set: follows the contract in kit/core.ts; the set's
 * files are listed in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Structure,
  streetSeed,
  carve,
  convexSolid,
  onFace,
  outward,
  runsAlongX,
  type Hole,
  type Side,
  CASEMENT,
  BRICK,
  CREEPER,
  DARK_STONE,
  DIRT,
  EMBER,
  FLAME,
  GUARD_HEIGHT,
  GUARD_THICKNESS,
  IRON,
  MOSS_STONE,
  PITCH,
  PLANK,
  SAILCLOTH,
  TEAK,
  THATCH,
  TIMBER,
} from "../core";
import { inside } from "./gothic";
import { LAMPLIT, offFace, RAFTER_REMAINS } from "./village";

/**
 * Walked height of a stilt hut's platform. INSIDE CONFIG.nav.stepHeight (0.6),
 * which is the entire reason the builder contains no ramp and no stair: every
 * cell of the platform links to the ground beside it from every bearing. It is
 * the manor's 0.40 m podium trick at 0.55.
 */
const HUT_DECK = 0.55;
/**
 * The platform's collider, placed by its TOP face. It is no longer DRAWN: what
 * is drawn is boards on joists on bearers on piles, and this box only says
 * where a body stands and where a round stops.
 */
const HUT_DECK_T = 0.69;
/** How far the platform oversails the walls, on all four sides. */
const HUT_VER = 1.6;
/**
 * The thatch's pitch, as rise over run. Steeper than the cottage's reed
 * (`THATCH_PITCH`), because palm thatch sheds a monsoon only at about forty
 * degrees — and a tall roof over a small house is what a stilt house is
 * recognised by from across a river.
 */
const HUT_PITCH = 0.8;
/** How deep the palm thatch is, which is what its eave and verge read as. */
const HUT_THATCH = 0.45;
/**
 * Where a pile stops when there is no ground to read. Deep enough to be under
 * any floor a placement's own lift puts it over.
 */
const HUT_PILE_FOOT = -3.2;
/**
 * Woven bamboo in a timber frame: the infill of the walls, the gables and the
 * propped shutters. It is the one pale value on the hut. The frame, the boards
 * and the piles are all dark hardwood, so at forty metres in a green gloom the
 * house reads as pale panels between dark posts. That is the cottage's plaster
 * and frame, in a second climate.
 */
const MATTING = "#7f7862";

/**
 * The jungle's cottage: a timber-framed house of woven panels on a platform
 * of boards carried on piles, under a steep palm thatch.
 *
 * This is the repeatable dwelling of the tropical kit. A village is a dozen of
 * these and some boardwalk, and the manor is the landmark they are a village
 * *of*.
 *
 * ## Raised, and linked, and those are separate problems
 *
 * The obvious way to build a stilt house is to put its floor where a stilt
 * house's floor goes, a metre and a half up, and hang a stair off it. That
 * costs a ramp, a nav surface and a climb, and it makes every hut a building
 * you enter rather than cover you move through. So the two reads are
 * decoupled:
 *
 * - **The walked surface is `HUT_DECK`, full stop.** It is inside
 *   `stepHeight`, so the platform links on every bearing with nothing to
 *   climb.
 * - **The stilt read costs navigation nothing**, and it comes from things
 *   that are true whatever height the deck is at. The platform OVERSAILS the
 *   walls by `HUT_VER` on all four sides, and a house reads as raised because
 *   the thing on posts is visibly wider than the box it carries. The deck is
 *   drawn as what it is (boards on joists on bearers), so there is a shadowed
 *   gap under it with the pile heads showing even on level ground. And the
 *   piles are cut to the GROUND: each one is sampled at its own foot, so
 *   wherever the floor falls away inside the footprint the pile is as long as
 *   the fall, with a footing stone under it. That is what puts `stiltHut` in
 *   `CONFORMS_TO_TERRAIN`. Where a pile is long enough, it is cross-braced to
 *   its neighbour.
 *
 * Worked example, on Greyfen's west branch: a hut centred where the terrain
 * reads -0.45 puts its deck at +0.10 absolute. The landward corner stands
 * 0.10 m over dry ground and links trivially; the seaward corner stands over a
 * bed at -1.34, which is 1.44 m of deck above the mud with 0.82 m of standing
 * water under the piles. One placement, both reads.
 *
 * **So a stilt hut wants its centre on ground that falls away within a few
 * metres.** On dead-level ground it reads as a raised timber house, which is
 * also correct and is what a hamlet inland should look like. Lifted off the
 * floor (Greyfen's treeline hamlet, two metres up), every pile is the full
 * lift long, braced.
 *
 * ## The masses are the colliders' and the detail is the drawing
 *
 * The block at the top of the builder is every collider this hut has ever
 * had, in the order it has always emitted them. The platform and the roof are
 * stated by hand now, because the platform is drawn as timber and the roof as
 * thatch rather than as the boxes `wall` and `gableRoof` would draw. The rails
 * are still `guard`, whose box is drawn as the balustrade's dark core with
 * boards over it. So a change below that block owes no `npm run collision`,
 * and one inside it does.
 *
 * Everything else is drawing: frame, boards, shutters, thatch, the props on
 * the platform and the furniture inside. It is all flat on a face, overhead,
 * low enough to walk over, or small and stood against a wall out of the way.
 * The roof rises about three and a half metres over its collider slab (the old
 * one rose one and a half), which is the cottage's trade: a round through the
 * thatch above the eaves passes. The slab is enclosed by the thatch at the
 * eaves and the verges, and the loft over the back half of the room lies
 * inside it.
 *
 * ## Three things that must not change
 *
 * A cell under this building carries exactly THREE nav surfaces: the terrain,
 * the platform top, and the roof's eaves block. `NavGrid` keeps three and
 * silently drops the fourth. So: no second floor slab inside the walls (the
 * platform is the floor), no colliders on the piles or on anything in the
 * room, and **the roof is emitted last**. Any of the three costs the
 * platform, which is the only thing here anything actually walks on.
 *
 * The guards are on ±X only. The ±Z faces are deliberately open: a platform
 * railed on all four sides links to the map on none of them, and the door is
 * in the -Z gable.
 *
 * ## What it is drawn as
 *
 * - **Piles, bearers, joists and boards.** Twelve piles in three rows, each
 *   a little different in girth and set a little off plumb, under bearers,
 *   joists and boards laid with gaps. The board ends show at the platform's
 *   edges and the butt joints are staggered.
 * - **A frame with two infills.** Corner posts, a sill beam, a rail at the
 *   window sills and a wall plate, all proud of the face. Under the rail the
 *   wall is boarded and battened; over it, woven panels between studs.
 * - **Windows unglazed, as they are in the climate.** Each long side has one
 *   propped open (a top-hung shutter of the wall's own matting, on a stick,
 *   over bars and a dark room) and the rest shut behind louvred leaves. The
 *   door stands open with its leaves folded back inside, under a slatted
 *   transom for the air.
 * - **A steep palm thatch over an open roof.** The thatch is laid in courses,
 *   cut plumb at the eave, and capped at the ridge with crossed stakes pinning
 *   the cap. It rests on rafters that stand clear of the wall plate, so the
 *   eaves are an open slot for the air. The bargeboards cross at each apex
 *   and run on past it. Inside are tie beams, king posts, purlins, the ridge
 *   beam, laths, and a loft of boards over the back half of the room.
 * - **Lived in.** A water jar and pots by the door, sandals on the deck,
 *   firewood under the back eave, a fish trap. Inside: a sleeping mat and
 *   bedding, a hearth box with a pot on its stones, a shelf, a hanging basket
 *   and a lantern. A vine climbs one back corner, and moss has taken the
 *   thatch's lower course on the same side.
 *
 * **Which window is open, which end of the front the jar stands at and which
 * corner the vine takes are seeded off where the hut stands** (`streetSeed`),
 * so a village of these is not one house repeated.
 *
 * `litWindows` lights the windows (through the louvres where they are shut),
 * the lantern and the hearth, as glow only. The hut has never spent a light
 * slot and does not start now.
 */
export function buildStiltHut(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "stilthut");
  const w = p.width ?? 6.4;
  const d = p.depth ?? 5.2;
  const h = p.height ?? 2.8;
  const t = 0.28;
  const enterable = p.enterable ?? true;
  const ruined = p.ruined === true;
  const lit = p.litWindows && !ruined ? LAMPLIT : undefined;
  const fw = w + HUT_VER * 2;
  const fd = d + HUT_VER * 2;
  const wallY = HUT_DECK + h / 2;

  // ------------------------------------------------------------ the masses
  //
  // Every collider the hut has, in the order it has always emitted them. See
  // the header before adding to it.
  b.block({ w: fw, h: HUT_DECK_T, d: fd, x: 0, y: HUT_DECK - HUT_DECK_T / 2, z: 0 });
  if (enterable) {
    b.doorWall(w, h, t, 0, wallY, -d / 2, MATTING, 1.6, 2.1);
    b.wall(w, h, t, 0, wallY, d / 2, MATTING);
    b.wall(t, h, d, -w / 2, wallY, 0, MATTING);
    b.wall(t, h, d, w / 2, wallY, 0, MATTING);
  } else {
    b.box(w, h, d, 0, wallY, 0, MATTING);
    b.block({ w, h, d, x: 0, y: wallY, z: 0 });
  }
  if (ruined) b.block({ w: w + 0.8, h: 0.3, d: d + 0.8, x: 0, y: HUT_DECK + h, z: 0 });
  // The rails, ±X only. `guard` stands them outboard of the platform edge,
  // which keeps them out of the nav samples the platform needs, and its box is
  // the balustrade's dark core: the boards are dressed over it below.
  for (const side of ["-x", "+x"] as const) {
    b.guard(side, ((side === "+x" ? 1 : -1) * fw) / 2, 0, fd, HUT_DECK, { color: PITCH });
  }
  // LAST, and it has to be: this is the third and final nav surface the cells
  // under the hut can hold. It is exactly the eaves slab
  // `gableRoof(w + 0.6, d + 0.6, 1.5, ..., 0.5)` laid, spelled the way that
  // method spells it so the bake cannot move by a float.
  if (!ruined) {
    const rw = w + 0.6;
    const rd = d + 0.6;
    const over = 0.5;
    b.block({ w: rw + over * 2, h: 0.3, d: rd + over * 2, x: 0, y: HUT_DECK + h, z: 0 });
  }

  // ----------------------------------------------------------- the drawing
  const seed = streetSeed(w, d, h, ctx);
  /** Which end of the front the water jar stands at. The window takes the other. */
  const jarSide = ((seed >>> 7) & 1) === 0 ? -1 : 1;
  /** Which long side has its front window propped open. */
  const openSide: Side = ((seed >>> 11) & 1) === 0 ? "-x" : "+x";
  /** Which back corner the vine climbs, and which slope has the moss. */
  const vineX = ((seed >>> 17) & 1) === 0 ? -1 : 1;

  const D = HUT_DECK;
  /** The wall head. */
  const H = D + h;
  /** The walls' outer faces: half a wall further out on a hollow one (the cottage's `gx`). */
  const gx = w / 2 + (enterable ? t / 2 : 0);
  const gz = d / 2 + (enterable ? t / 2 : 0);
  /** The walls' inner faces, on a hollow one. */
  const ix = w / 2 - t / 2;
  const iz = d / 2 - t / 2;
  const plane = (s: Side): number => (runsAlongX(s) ? gz : gx);
  const half = (s: Side): number => (runsAlongX(s) ? gx : gz);
  const inner = (s: Side): number => (runsAlongX(s) ? iz : ix);
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];

  /**
   * The floor under a local point, as a local height, or null with nothing to
   * read. `MapBuilder`'s rotation: local +X lands on (cos, -sin), +Z on (sin, cos).
   */
  const groundAt = (lx: number, lz: number): number | null => {
    if (!ctx) return null;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };

  // ---- the platform: boards on joists on bearers on piles. Nothing here
  // stands above the deck, and nothing is a collider.
  /** Board thickness, joist depth, and the bearers' top and bottom. */
  const DB = 0.045;
  const JD = 0.2;
  const bearerTop = D - DB - JD;
  const bearerBot = bearerTop - 0.24;
  // A dark bed under the boards, so the gaps between them read as the shadow
  // under a floor rather than as the ground showing through it.
  b.box(fw - 0.14, 0.02, fd - 0.14, 0, D - DB - 0.012, 0, PITCH);
  {
    const WIDTHS = [0.21, 0.24, 0.19, 0.26, 0.22, 0.2, 0.25, 0.23];
    const JOINTS = [-0.19, 0.23, -0.02, 0.36, -0.33, 0.11];
    let z0 = -fd / 2;
    for (let i = 0; z0 < fd / 2 - 0.05; i++) {
      const bw = Math.min(WIDTHS[(i + seed) % WIDTHS.length], fd / 2 - z0);
      // The odd board replaced in a different wood.
      const tone = (i * 7 + seed) % 13 === 4 ? TEAK : PLANK;
      const j = JOINTS[(i + (seed >>> 3)) % JOINTS.length] * fw;
      for (const [x0, x1] of [
        [-fw / 2 - 0.03, j - 0.008],
        [j + 0.008, fw / 2 + 0.03],
      ] as const) {
        b.box(x1 - x0, DB, bw - 0.018, (x0 + x1) / 2, D - DB / 2, z0 + bw / 2, tone);
      }
      z0 += bw;
    }
  }
  // Joists along Z, the outermost two being the ±X rims, and a header across
  // each ±Z edge that their ends butt into.
  {
    const run = fw - 0.07;
    const n = Math.round(run / 0.6);
    for (let i = 0; i <= n; i++) b.box(0.07, JD, fd - 0.14, -run / 2 + (i * run) / n, D - DB - JD / 2, 0, TIMBER);
    for (const sz of [-1, 1]) b.box(fw, JD + 0.04, 0.07, 0, D - DB - JD / 2 - 0.02, (sz * (fd - 0.07)) / 2, TIMBER);
  }
  // Three bearers on twelve piles. Each pile is cut to the ground under it,
  // on a footing stone, and each is a little different in girth and set a
  // little off plumb, because they were cut from a forest rather than a mill.
  // Where the ground rises into the bearers there is no pile at all.
  const cols = [-1, -1 / 3, 1 / 3, 1].map((f) => f * (fw / 2 - 0.35));
  const rows = [-1, 0, 1].map((f) => f * (fd / 2 - 0.35));
  for (const z of rows) b.box(fw - 0.1, bearerTop - bearerBot, 0.22, 0, (bearerTop + bearerBot) / 2, z, TIMBER);
  /** The pile feet, `[col][row]`, or null where there is no pile. */
  const feet: (number | null)[][] = cols.map(() => rows.map(() => null));
  {
    const pileTop = bearerBot + 0.06;
    let n = 0;
    for (const [ci, x] of cols.entries()) {
      for (const [ri, z] of rows.entries()) {
        const k = ++n;
        const g = groundAt(x, z);
        if (g !== null && g > bearerBot - 0.05) continue;
        const foot = g === null ? HUT_PILE_FOOT : g - 0.3;
        feet[ci][ri] = foot;
        const dia = 0.26 + (0.07 * ((k * 5 + seed) % 7)) / 6;
        const lean = (m: number): number => ((((k * m + seed) % 5) - 2) * 0.005);
        b.cyl(pileTop - foot, dia * 0.9, dia, 7, x, (pileTop + foot) / 2, z, TIMBER, { x: lean(3), z: lean(7) });
        if (g !== null) b.box(dia + 0.3, 0.14, dia + 0.24, x, g + 0.02, z, MOSS_STONE, { y: k * 0.7 });
      }
    }
  }
  // Cross-bracing on the outer faces, wherever two neighbouring piles stand
  // clear of the ground by enough to need it.
  {
    const brace = (s: Side, pl: number, ua: number, ub: number, fa: number | null, fb: number | null): void => {
      if (fa === null || fb === null) return;
      const y0 = bearerBot - 0.12;
      const y1 = Math.max(fa, fb) + 0.5;
      if (y0 - y1 < 0.7) return;
      const du = ub - ua;
      const len = Math.hypot(du, y0 - y1);
      const a = Math.atan2(y0 - y1, du);
      const um = (ua + ub) / 2;
      onFace(b, s, pl, um, (y0 + y1) / 2, len, 0.12, 0.05, 0, TIMBER, a);
      onFace(b, s, pl + 0.06, um, (y0 + y1) / 2, len, 0.12, 0.05, 0, TIMBER, -a);
    };
    const last = rows.length - 1;
    for (let ci = 0; ci + 1 < cols.length; ci++) {
      brace("-z", -rows[0] + 0.17, cols[ci], cols[ci + 1], feet[ci][0], feet[ci + 1][0]);
      brace("+z", rows[last] + 0.17, cols[ci], cols[ci + 1], feet[ci][last], feet[ci + 1][last]);
    }
    const lc = cols.length - 1;
    for (let ri = 0; ri + 1 < rows.length; ri++) {
      brace("-x", -cols[0] + 0.17, rows[ri], rows[ri + 1], feet[0][ri], feet[0][ri + 1]);
      brace("+x", cols[lc] + 0.17, rows[ri], rows[ri + 1], feet[lc][ri], feet[lc][ri + 1]);
    }
  }
  // A step or two of split log down from the door's edge of the platform, where
  // the ground in front of it is low enough to want one and not so low that a
  // step would promise a climb nobody can make.
  {
    const zEdge = -fd / 2;
    const g = groundAt(0, zEdge - 0.45);
    const drop = g === null ? 0 : D - g;
    if (g !== null && drop > 0.3 && drop < 1.0) {
      const n = Math.max(1, Math.round(drop / 0.28) - 1);
      for (let i = 1; i <= n; i++) {
        const top = D - (i * drop) / (n + 1);
        const zc = zEdge - 0.2 - (i - 1) * 0.3;
        b.box(1.3, 0.1, 0.32, 0, top - 0.05, zc, TEAK);
        // On two stubs, driven into the ground under it.
        for (const k of [-1, 1]) b.cyl(top - g, 0.14, 0.16, 6, k * 0.5, (top + g) / 2 - 0.1, zc, TIMBER);
      }
    }
  }

  // ---- the walls' frame, on every face: corner posts, a sill beam, a rail at
  // the window sills with boarding and battens under it, studs over it, and
  // the wall plate. All of it proud of the matting, and stopped at openings.
  const doorW = 1.6;
  const doorH = 2.1;
  const railY = D + 0.9;
  const sill = railY + 0.08;
  const winH = 0.95;
  const plateY = H - 0.1;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box(0.26, h + 0.02, 0.26, sx * (gx - 0.08), D + h / 2, sz * (gz - 0.08), TEAK);
  }

  /** A window in an elevation: where it is and whether its shutter is open. */
  interface Win {
    s: Side;
    u: number;
    ww: number;
    open: boolean;
  }
  const wins: Win[] = [];
  {
    // The front window stands clear of the door leaf folded back inside.
    const u0 = doorW / 2 + 1.1;
    const u1 = gx - 0.45;
    const ww = Math.min(0.8, u1 - u0 - 0.25);
    if (ww >= 0.45) wins.push({ s: "-z", u: (-jarSide * (u0 + u1)) / 2, ww, open: true });
    wins.push({ s: "+z", u: -jarSide * gx * 0.4, ww: Math.min(0.9, gx * 0.5), open: false });
    for (const s of ["-x", "+x"] as const) {
      for (const k of [-1, 1]) wins.push({ s, u: k * gz * 0.44, ww: Math.min(0.85, gz * 0.36), open: s === openSide && k < 0 });
    }
  }

  /** An emissive panel lying on a face. */
  const glowOn = (s: Side, pl: number, u: number, y: number, along: number, tall: number, color: string): void => {
    const c = outward(s) * (pl + 0.012);
    if (runsAlongX(s)) b.glow(along, tall, 0.03, u, y, c, color);
    else b.glow(0.03, tall, along, c, y, u, color);
  };
  /** A louvre slat on a face, its top edge tipped in to the wall so it sheds rain. */
  const slat = (s: Side, pl: number, u: number, y: number, len: number, out: number): void => {
    const n = outward(s);
    const c = n * (pl + out);
    if (runsAlongX(s)) b.box(len, 0.11, 0.02, u, y, c, TEAK, { x: -n * 0.6 });
    else b.box(0.02, 0.11, len, c, y, u, TEAK, { z: n * 0.6 });
  };

  /**
   * A window on the outside: the frame, and either bars over the dark room
   * under a shutter hung from its head and propped out on a stick, or two
   * louvred leaves shut in the opening.
   */
  const windowOut = (o: Win): Hole => {
    const { s, u, ww } = o;
    const pl = plane(s);
    const top = sill + winH;
    const mid = sill + winH / 2;
    if (lit) glowOn(s, pl, u, mid, ww, winH, lit);
    else onFace(b, s, pl, u, mid, ww, winH, 0.02, 0.01, CASEMENT);
    if (o.open) {
      const n = Math.max(3, Math.round(ww / 0.16));
      for (let i = 1; i < n; i++) onFace(b, s, pl, u - ww / 2 + (i * ww) / n, mid, 0.045, winH, 0.045, 0.03, TEAK);
      // The shutter: matting in a frame, hung from the head and swung out.
      // Swung up nearly level, so its lower edge clears a head on the deck.
      const a = 1.2;
      const len = winH + 0.06;
      const y0 = top + 0.04;
      const r0 = 0.08;
      const at = (f: number): [number, number] => [r0 + len * Math.sin(a) * f, y0 - len * Math.cos(a) * f];
      const [r1, y1] = at(1);
      offFace(b, s, pl, u, ww + 0.1, y0, y1, r0, r1, 0.04, MATTING);
      for (const k of [-1, 1]) offFace(b, s, pl, u + k * (ww / 2 + 0.03), 0.06, y0, y1, r0, r1, 0.07, TEAK);
      for (const [fa, fb] of [
        [0, 0.08],
        [0.92, 1],
      ] as const) {
        const [ra, ya] = at(fa);
        const [rb, yb] = at(fb);
        offFace(b, s, pl, u, ww + 0.16, ya, yb, ra, rb, 0.07, TEAK);
      }
      // And the stick it stands on, from the sill board to the shutter's foot.
      offFace(b, s, pl, u + ww * 0.28, 0.04, sill - 0.02, y1 - 0.03, 0.18, r1 - 0.04, 0.04, TIMBER);
    } else {
      for (const k of [-1, 1]) {
        const lu = u + (k * ww) / 4;
        const lw = ww / 2 - 0.02;
        for (const kk of [-1, 1]) onFace(b, s, pl, lu + (kk * (lw - 0.06)) / 2, mid, 0.06, winH - 0.02, 0.05, 0.035, TEAK);
        for (const y of [sill + 0.05, top - 0.05]) onFace(b, s, pl, lu, y, lw, 0.08, 0.05, 0.035, TEAK);
        for (let y = sill + 0.17; y < top - 0.12; y += 0.095) slat(s, pl, lu, y, lw - 0.1, 0.035);
      }
    }
    for (const k of [-1, 1]) onFace(b, s, pl, u + k * (ww / 2 + 0.05), mid + 0.03, 0.1, winH + 0.16, 0.1, 0.05, TEAK);
    onFace(b, s, pl, u, top + 0.07, ww + 0.34, 0.12, 0.12, 0.06, TEAK);
    onFace(b, s, pl, u, sill - 0.04, ww + 0.36, 0.08, 0.2, 0.1, TEAK);
    return { u0: u - ww / 2 - 0.12, u1: u + ww / 2 + 0.12, y0: sill - 0.1, y1: top + 0.14 };
  };

  /**
   * The same window from inside a hollow hut: bars over the dark where the
   * shutter is open, and where it is shut, the backs of the two leaves with a
   * bar dropped across them.
   */
  const windowIn = (o: Win): void => {
    const { u, ww } = o;
    const s = inside(o.s);
    const pl = -inner(o.s);
    const top = sill + winH;
    const mid = sill + winH / 2;
    if (o.open) {
      onFace(b, s, pl, u, mid, ww, winH, 0.02, 0.01, CASEMENT);
      const n = Math.max(3, Math.round(ww / 0.16));
      for (let i = 1; i < n; i++) onFace(b, s, pl, u - ww / 2 + (i * ww) / n, mid, 0.045, winH, 0.045, 0.03, TEAK);
    } else {
      for (const k of [-1, 1]) onFace(b, s, pl, u + (k * ww) / 4, mid, ww / 2 - 0.03, winH - 0.02, 0.04, 0.02, TEAK);
      onFace(b, s, pl, u, mid, ww + 0.34, 0.08, 0.06, 0.08, TIMBER);
      for (const k of [-1, 1]) onFace(b, s, pl, u + k * (ww / 2 + 0.12), mid, 0.07, 0.16, 0.1, 0.05, TIMBER);
    }
    for (const k of [-1, 1]) onFace(b, s, pl, u + k * (ww / 2 + 0.05), mid, 0.1, winH + 0.12, 0.08, 0.04, TEAK);
    onFace(b, s, pl, u, top + 0.06, ww + 0.2, 0.12, 0.08, 0.04, TEAK);
    onFace(b, s, pl, u, sill - 0.04, ww + 0.2, 0.08, 0.14, 0.07, TEAK);
  };

  /**
   * The weave of a woven panel, as the strips that show on its face: a twill
   * of diagonals laid on a grid anchored to the elevation rather than to the
   * panel, so neighbouring panels line up, and running the other way in
   * alternate panels, which is the herringbone a wall of it is read by. It is
   * what tells matting in a frame from plaster in one — the same frame over a
   * flat pale infill read as an English cottage.
   */
  const weave = (s: Side, pl: number, a: number, c: number, y0: number, y1: number, dir: number): void => {
    const P = 0.3;
    const q0 = dir > 0 ? a - y1 : a + y0;
    const q1 = dir > 0 ? c - y0 : c + y1;
    for (let q = Math.ceil(q0 / P) * P; q < q1; q += P) {
      // The stretch of the line u = q + dir*y inside the panel, by height.
      const ya = Math.max(y0, dir > 0 ? a - q : q - c) + 0.015;
      const yb = Math.min(y1, dir > 0 ? c - q : q - a) - 0.015;
      if (yb - ya < 0.06) continue;
      const ym = (ya + yb) / 2;
      onFace(b, s, pl, q + dir * ym, ym, (yb - ya) * Math.SQRT2, 0.04, 0.014, 0.007, MATTING, (dir * Math.PI) / 4);
    }
  };

  const doorHole: Hole = { u0: -doorW / 2 - 0.14, u1: doorW / 2 + 0.14, y0: 0, y1: D + doorH + 0.16 };
  for (const s of SIDES) {
    const pl = plane(s);
    const hf = half(s);
    const holes = wins.filter((o) => o.s === s).map(windowOut);
    const door: [number, number][] = s === "-z" ? [[doorHole.u0, doorHole.u1]] : [];
    if (s === "-z") holes.push(doorHole);
    for (const [a, c] of carve(-hf - 0.05, hf + 0.05, door)) {
      onFace(b, s, pl, (a + c) / 2, D + 0.09, c - a, 0.18, 0.12, 0.05, TEAK);
    }
    // The boarding under the rail, and a batten over every joint.
    const y0 = D + 0.18;
    const y1 = railY - 0.06;
    for (const [a, c] of carve(-hf + 0.12, hf - 0.12, door)) {
      onFace(b, s, pl, (a + c) / 2, (y0 + y1) / 2, c - a, y1 - y0, 0.03, 0.015, PLANK);
      for (let u = a + 0.27; u < c - 0.1; u += 0.27) onFace(b, s, pl, u, (y0 + y1) / 2, 0.05, y1 - y0, 0.03, 0.04, TEAK);
    }
    for (const [a, c] of carve(-hf, hf, door)) onFace(b, s, pl, (a + c) / 2, railY, c - a, 0.12, 0.08, 0.04, TEAK);
    // Studs over the rail, left out wherever they would cross an opening.
    const run = hf - 0.24;
    const n = Math.max(1, Math.round((2 * run) / 1.05));
    const sa = railY + 0.06;
    const sb = plateY - 0.1;
    const studs: [number, number][] = [];
    for (let i = 1; i < n; i++) {
      const u = -run + (i * 2 * run) / n;
      if (holes.some((o) => u + 0.1 > o.u0 && u - 0.1 < o.u1)) continue;
      onFace(b, s, pl, u, (sa + sb) / 2, 0.11, sb - sa, 0.07, 0.035, TEAK);
      studs.push([u - 0.055, u + 0.055]);
    }
    // The weave in every panel the frame leaves, and over each window.
    {
      const edge = hf - 0.21;
      let dir = 1;
      for (const [a, c] of carve(-edge, edge, [...studs, ...holes.map((o): [number, number] => [o.u0, o.u1])])) {
        if (c - a > 0.12) weave(s, pl, a, c, sa, sb, (dir = -dir));
      }
      for (const o of holes) {
        if (o !== doorHole && sb - o.y1 > 0.12) weave(s, pl, o.u0, o.u1, o.y1, sb, (dir = -dir));
      }
    }
    onFace(b, s, pl, 0, plateY, 2 * hf + 0.16, 0.2, 0.14, 0.06, TEAK);
    if (enterable) {
      // Inside: the same frame, less of it, and the plate the ties sit on.
      const si = inside(s);
      const pi = -inner(s);
      const hi = runsAlongX(s) ? ix : iz;
      for (const o of wins) if (o.s === s) windowIn(o);
      for (const [a, c] of carve(-hi, hi, door)) onFace(b, si, pi, (a + c) / 2, D + 0.08, c - a, 0.16, 0.08, 0.04, TEAK);
      for (const [a, c] of carve(-hi, hi, door)) onFace(b, si, pi, (a + c) / 2, railY, c - a, 0.1, 0.06, 0.03, TEAK);
      onFace(b, si, pi, 0, plateY, 2 * hi, 0.2, 0.12, 0.06, TEAK);
      for (const k of [-1, 1]) onFace(b, si, pi, k * (hi - 0.09), (D + H) / 2, 0.18, h, 0.1, 0.05, TEAK);
      // The studs show inside as well, full height behind the rail, and the
      // weave between them: a room is where a wall is seen from a metre away.
      const edge = hi - 0.18;
      const inStuds = studs.filter(([a, c]) => a > -edge && c < edge);
      for (const [a, c] of inStuds) onFace(b, si, pi, (a + c) / 2, (D + 0.16 + sb) / 2, 0.11, sb - D - 0.16, 0.06, 0.03, TEAK);
      let dir = 1;
      const openings = holes.map((o): [number, number] => [o.u0, o.u1]);
      for (const [a, c] of carve(-edge, edge, [...inStuds, ...openings])) {
        if (c - a > 0.12) weave(si, pi, a, c, railY + 0.05, sb, (dir = -dir));
      }
      for (const [a, c] of carve(-edge, edge, [...inStuds, ...door])) {
        if (c - a > 0.12) weave(si, pi, a, c, D + 0.16, railY - 0.05, (dir = -dir));
      }
      for (const o of holes) {
        if (o !== doorHole && sb - o.y1 > 0.12) weave(si, pi, o.u0, o.u1, o.y1, sb, (dir = -dir));
      }
    }
  }

  // ---- the door (-Z): a frame, a slatted transom over it for the air, and on
  // a hollow hut both leaves folded back inside; on a solid one, shut.
  {
    const s: Side = "-z";
    const top = D + doorH;
    for (const k of [-1, 1]) onFace(b, s, gz, k * (doorW / 2 + 0.06), (D + top + 0.14) / 2, 0.12, doorH + 0.14, 0.14, 0.06, TEAK);
    onFace(b, s, gz, 0, top + 0.08, doorW + 0.4, 0.16, 0.16, 0.07, TEAK);
    const gy = top + 0.33;
    const gw = doorW - 0.2;
    const transom = (ts: Side, pl: number): void => {
      onFace(b, ts, pl, 0, gy, gw, 0.24, 0.02, 0.01, CASEMENT);
      for (let i = 0; i <= 8; i++) onFace(b, ts, pl, -gw / 2 + (i * gw) / 8, gy, 0.035, 0.24, 0.04, 0.03, TEAK);
      for (const y of [gy - 0.14, gy + 0.14]) onFace(b, ts, pl, 0, y, gw + 0.12, 0.05, 0.06, 0.04, TEAK);
    };
    if (plateY - 0.1 - (top + 0.16) > 0.32) transom(s, gz);
    if (enterable) {
      if (plateY - 0.1 - (top + 0.16) > 0.32) transom("+z", -iz);
      // The reveal's lining, its head, and a raised threshold.
      for (const k of [-1, 1]) b.box(0.05, doorH, t + 0.02, k * (doorW / 2 - 0.025), D + doorH / 2, -d / 2, TEAK);
      b.box(doorW, 0.05, t + 0.02, 0, top - 0.025, -d / 2, TEAK);
      b.box(doorW + 0.12, 0.07, t + 0.14, 0, D + 0.035, -d / 2, TEAK);
      // The leaves, opened inward and folded flat to the wall: boards, three
      // ledges, and the hinge side at the jamb.
      for (const k of [-1, 1]) {
        const u = k * (doorW / 2 + 0.41);
        onFace(b, "+z", -iz, u, D + 1.04, 0.78, 2.0, 0.05, 0.035, PLANK);
        for (let i = 1; i < 4; i++) onFace(b, "+z", -iz, u - 0.39 + i * 0.195, D + 1.04, 0.02, 1.96, 0.02, 0.065, TIMBER);
        for (const y of [D + 0.35, D + 1.04, D + 1.72]) onFace(b, "+z", -iz, u, y, 0.66, 0.13, 0.03, 0.075, TEAK);
      }
    } else {
      onFace(b, s, gz, 0, D + doorH / 2, doorW - 0.04, doorH - 0.02, 0.05, 0.02, PLANK);
      for (let i = 1; i < 6; i++) onFace(b, s, gz, -doorW / 2 + (i * doorW) / 6, D + doorH / 2, 0.02, doorH - 0.06, 0.02, 0.05, TIMBER);
      onFace(b, s, gz, 0, D + doorH / 2, 0.04, doorH - 0.04, 0.03, 0.055, TIMBER);
      for (const y of [D + 0.4, D + doorH - 0.4]) onFace(b, s, gz, 0, y, doorW - 0.2, 0.12, 0.03, 0.06, TEAK);
    }
  }

  // ---- the roof, described by the UNDERSIDE of the thatch. It stands on
  // rafters that bear on the wall plate, so the eaves are an open slot for the
  // air between the plate and the thatch, and everything else is measured off
  // that one line. It is laid over the roof's collider slab on every side.
  const k = HUT_PITCH;
  const pitch = Math.atan(k);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const T = HUT_THATCH;
  /** The roof's own half-widths, the same for a hollow hut and a solid one. */
  const rx = w / 2 + t / 2;
  const rz = d / 2 + t / 2;
  const tip = rx + 0.8;
  const zEnd = rz + 0.75;
  const under = (x: number): number => H + 0.2 + (rx - x) * k;
  const onRoof = (sx: number, x0: number, x1: number, o0: number, o1: number, z0: number, z1: number, color: string): void => {
    const xm = (x0 + x1) / 2;
    const o = (o0 + o1) / 2;
    b.box((x1 - x0) / cosP, o1 - o0, z1 - z0, sx * (xm + o * sinP), under(xm) + o * cosP, (z0 + z1) / 2, color, {
      z: -sx * pitch,
    });
  };
  const roofPt = (sx: number, x: number, o: number, z: number): Point3 => [sx * (x + o * sinP), under(x) + o * cosP, z];
  /** Thatch between `x0` and `x1`, `o0` to `o1` deep, cut PLUMB — the cottage's `coat`. */
  const coat = (sx: number, x0: number, x1: number, o0: number, o1: number, z0: number, z1: number, round = 0): void => {
    const lo = (x: number): number => under(x) + o0 / cosP;
    const hi = (x: number): number => under(x) + o1 / cosP;
    const eave: [number, number][] =
      round > 0
        ? [
            [x1 - round, lo(x1 - round)],
            [x1, lo(x1 - round) + round * 0.3],
            [x1, hi(x1) - round],
            [x1 - round * 0.8, hi(x1 - round * 0.8)],
          ]
        : [
            [x1, lo(x1)],
            [x1, hi(x1)],
          ];
    const section = (z: number): Point3[] => [
      [sx * x0, lo(x0), z],
      ...eave.map(([x, y]): Point3 => [sx * x, y, z]),
      [sx * x0, hi(x0), z],
    ];
    convexSolid(b, section(z0), section(z1), THATCH);
  };

  // The gables: matting, standing on the plate with their top edges under the
  // thatch, framed with a king post, a collar and two struts, and a pair of
  // louvred vents under the ridge.
  for (const sz of [-1, 1]) {
    const s: Side = sz < 0 ? "-z" : "+z";
    const face = (z: number): Point3[] => [
      [-gx, H - 0.02, z],
      [gx, H - 0.02, z],
      [gx, under(gx) - 0.02, z],
      [0, under(0) - 0.02, z],
      [-gx, under(gx) - 0.02, z],
    ];
    // Boarded, where the walls are woven: a gable takes the weather the eave
    // keeps off the walls. Battens over the joints, cut under the rakes.
    convexSolid(b, face(sz * (gz - t)), face(sz * gz), PLANK);
    for (let u = -gx + 0.3; u < gx - 0.1; u += 0.3) {
      const yt = under(Math.abs(u) + 0.03) - 0.05;
      if (yt - H > 0.15) onFace(b, s, gz, u, (H + yt) / 2, 0.05, yt - H, 0.03, 0.015, TEAK);
    }
    const kingTop = under(0) - 0.05;
    const yc = H + (under(0) - H) * 0.4;
    const xc = rx - (yc - H - 0.2) / k - 0.06;
    const frame = (fs: Side, pl: number): void => {
      onFace(b, fs, pl, 0, (H + kingTop) / 2, 0.16, kingTop - H, 0.12, 0.04, TEAK);
      onFace(b, fs, pl, 0, yc, 2 * xc, 0.14, 0.12, 0.04, TEAK);
      for (const kk of [-1, 1]) onFace(b, fs, pl, kk * xc * 0.55, (H + yc) / 2, 0.12, yc - H, 0.1, 0.035, TEAK);
    };
    frame(s, gz);
    if (enterable) frame(inside(s), -(gz - t));
    const vy = yc + (under(0) - yc) * 0.38;
    const vw = Math.min(0.42, rx - (vy + 0.2 - H - 0.2) / k - 0.3);
    if (vw > 0.2) {
      for (const kk of [-1, 1]) {
        const vu = kk * (0.12 + vw / 2);
        onFace(b, s, gz, vu, vy, vw, 0.36, 0.02, 0.01, CASEMENT);
        for (let y = vy - 0.12; y < vy + 0.16; y += 0.08) slat(s, gz, vu, y, vw - 0.02, 0.03);
        onFace(b, s, gz, vu, vy + 0.21, vw + 0.1, 0.06, 0.08, 0.04, TEAK);
        onFace(b, s, gz, vu, vy - 0.21, vw + 0.14, 0.06, 0.12, 0.06, TEAK);
        onFace(b, s, gz, kk * (vw + 0.15), vy, 0.06, 0.4, 0.08, 0.04, TEAK);
      }
    }
  }

  // Rafters from the ridge to past the plate, their feet showing under the
  // eave, and laths across them the thatch is tied to. On a ruin the +X slope
  // is rafters alone, most of them broken short, and the -X slope keeps its
  // laths only where it keeps its thatch.
  const zCut = zEnd * 0.25;
  {
    const span = 2 * zEnd - 0.24;
    const n = Math.round(span / 0.55);
    let r = seed % RAFTER_REMAINS.length;
    for (let i = 0; i <= n; i++) {
      const z = -zEnd + 0.12 + (i * span) / n;
      for (const sx of [-1, 1]) {
        const x1 = rx + 0.62;
        const x0 = ruined && sx > 0 ? x1 - (x1 - 0.06) * RAFTER_REMAINS[r++ % RAFTER_REMAINS.length] : 0.06;
        onRoof(sx, x0, x1, -0.2, -0.065, z - 0.045, z + 0.045, TIMBER);
      }
    }
    for (const sx of [-1, 1]) {
      if (ruined && sx > 0) continue;
      const z1 = ruined ? zCut + 0.9 : zEnd - 0.03;
      for (let x = 0.25; x < tip - 0.08; x += 0.3) onRoof(sx, x, x + 0.05, -0.065, -0.008, -zEnd + 0.03, z1, PLANK);
    }
  }

  if (!ruined) {
    for (const sx of [-1, 1]) {
      // The thatch in courses, each laid over the one below and ending in its
      // own butt, which are the lines a thatched roof is read by.
      coat(sx, 0, tip, 0, T, -zEnd, zEnd, 0.05);
      for (let i = 0; i < 7; i++) {
        coat(sx, 0, tip * (0.86 - i * 0.11), T - 0.02 + i * 0.022, T + 0.03 + i * 0.022, -zEnd, zEnd);
      }
      // The ridge cap, folded over from both sides.
      coat(sx, 0, 0.55, T + 0.14, T + 0.26, -zEnd - 0.02, zEnd + 0.02);
      // The eave's hem: palm fronds are cut, not trimmed, so the lowest
      // course hangs ragged, each tuft its own width and its own length.
      const eaveY = under(tip) + 0.02;
      let i = 0;
      for (let z = -zEnd + 0.1; z < zEnd - 0.08; i++) {
        const tw = 0.1 + ((i * 5 + seed) % 4) * 0.025;
        const tl = 0.04 + ((i * 7 + (seed >>> 5)) % 6) * 0.03;
        const zc = Math.min(z + tw / 2, zEnd - 0.08 - tw / 2);
        const tuft = (x: number): Point3[] => [
          [sx * x, eaveY + 0.06, zc - tw / 2],
          [sx * x, eaveY + 0.06, zc + tw / 2],
          [sx * (x + 0.02), eaveY - tl, zc + (((i * 3) % 3) - 1) * 0.03],
        ];
        convexSolid(b, tuft(tip - 0.06), tuft(tip - 0.03), THATCH);
        z += tw * 0.9;
      }
    }
    // Stakes crossed over the ridge in pairs, pinning the cap down.
    for (let z = -zEnd + 0.35; z < zEnd - 0.2; z += 0.85) {
      for (const sx of [-1, 1]) {
        const [px, py] = roofPt(sx, 0.5, T + 0.285, z);
        const L = 0.8 / cosP;
        b.box(L, 0.045, 0.045, px - (sx * cosP * L) / 2, py + (sinP * L) / 2, z + sx * 0.03, TIMBER, { z: -sx * pitch });
      }
    }
    // The bargeboards, standing off each verge, crossed at the apex and run on
    // past it.
    for (const sz of [-1, 1]) {
      const z = sz * (zEnd + 0.04);
      for (const sx of [-1, 1]) onRoof(sx, -1.3, tip - 0.02, -0.2, 0.07, z - 0.03, z + 0.03, TEAK);
    }
    // Moss, where the lowest course holds the wet, on the vine's side.
    for (const [z0, z1] of [
      [-zEnd * 0.7, -zEnd * 0.12],
      [zEnd * 0.3, zEnd * 0.64],
    ] as const) {
      onRoof(vineX, tip * 0.8, tip - 0.1, T - 0.004, T + 0.018, z0, z1, CREEPER);
    }
  } else {
    // One slope holds over the front and is torn off ragged behind it.
    coat(-1, 0, tip, 0, T, -zEnd, zCut, 0.08);
    coat(-1, 0, tip * 0.78, T - 0.02, T + 0.045, -zEnd, zCut);
    coat(-1, 0, tip * 0.5, 0, T, zCut, zCut + 0.9);
    // What came down, on the platform under the open slope: thatch and a
    // rafter, low enough to walk over.
    b.box(1.1, 0.26, d * 0.55, gx + 0.75, D + 0.1, -d * 0.1, THATCH, { y: 0.1, z: -0.14 });
    b.box(0.8, 0.22, d * 0.3, gx + 0.6, D + 0.1, d * 0.25, THATCH, { y: -0.2, z: 0.18 });
    b.box(0.12, 0.12, 2.6, gx + 0.95, D + 0.08, d * 0.05, TIMBER, { x: 0.06, y: 0.45 });
  }

  // ---- the balustrades on ±X: `guard`'s dark core, with a bottom rail, a top
  // rail and a handrail over it, boards standing between them with the core
  // showing through the gaps, and posts carried down over the rim.
  for (const sx of [-1, 1]) {
    const xg = sx * (fw / 2 + GUARD_THICKNESS / 2);
    const top = D + GUARD_HEIGHT;
    b.box(0.28, 0.08, fd + 0.12, xg, top + 0.04, 0, TEAK);
    b.box(0.2, 0.08, fd, xg, top - 0.12, 0, TEAK);
    b.box(0.22, 0.1, fd, xg, D + 0.12, 0, TEAK);
    const posts = [-1, -0.5, 0, 0.5, 1].map((f) => f * (fd / 2 - 0.1));
    for (const z of posts) b.box(0.22, top - D + 0.34, 0.16, xg, (top + D - 0.34) / 2, z, TEAK);
    const b0 = D + 0.17;
    const b1 = top - 0.16;
    for (let z = -fd / 2 + 0.19; z < fd / 2 - 0.1; z += 0.17) {
      if (posts.some((pz) => Math.abs(pz - z) < 0.14)) continue;
      b.box(0.2, b1 - b0, 0.1, xg, (b0 + b1) / 2, z, PLANK);
    }
  }

  // ---- on the platform: a water jar and pots by the door, sandals left on
  // the deck, a fish trap against the wall, and firewood under the back eave.
  /** A glazed jar, its belly built as three turned sections. */
  const jar = (x: number, z: number, s: number, lidded: boolean): void => {
    b.cyl(0.08 * s, 0.4 * s, 0.34 * s, 10, x, D + 0.04 * s, z, BRICK);
    b.cyl(0.34 * s, 0.6 * s, 0.4 * s, 10, x, D + 0.25 * s, z, BRICK);
    b.cyl(0.16 * s, 0.4 * s, 0.6 * s, 10, x, D + 0.5 * s, z, BRICK);
    b.cyl(0.08 * s, 0.34 * s, 0.32 * s, 10, x, D + 0.62 * s, z, BRICK);
    if (lidded) b.cyl(0.04, 0.4 * s, 0.4 * s, 10, x, D + 0.68 * s, z, PLANK);
  };
  {
    const jx = jarSide * (gx - 0.5);
    const jz = -gz - 0.42;
    jar(jx, jz, 1, true);
    // The dipper on its lid, a coconut shell on a stick.
    b.cyl(0.08, 0.16, 0.1, 8, jx + 0.06, D + 0.74, jz - 0.03, TEAK);
    b.cyl(0.36, 0.025, 0.025, 5, jx - 0.12, D + 0.74, jz + 0.05, TIMBER, { z: Math.PI / 2 - 0.12, y: 0.4 });
    jar(jx - jarSide * 0.55, jz + 0.1, 0.55, false);
    jar(jx - jarSide * 0.42, jz - 0.32, 0.45, false);
    // Two pairs of sandals, kicked off at the threshold.
    for (const [x, z, a] of [
      [-0.35, -gz - 0.45, 0.2],
      [-0.2, -gz - 0.5, 0.05],
      [0.25, -gz - 0.62, -0.5],
      [0.4, -gz - 0.55, -0.35],
    ] as const) {
      b.box(0.1, 0.02, 0.26, x, D + 0.01, z, TIMBER, { y: a });
    }
    // A conical fish trap, stood on its mouth against the wall by the corner.
    const fx = -jarSide * (gx - 0.25);
    b.cyl(1.1, 0.08, 0.42, 9, fx, D + 0.54, -gz - 0.28, THATCH, { x: 0.2 });
    for (const y of [0.25, 0.6, 0.9]) b.cyl(0.04, 0.42 - y * 0.32, 0.42 - y * 0.32, 9, fx, D + y, -gz - 0.28 - (y - 0.54) * 0.2, TIMBER, { x: 0.2 });
    // Firewood stacked against the back wall under the eave, clear of the
    // window, and a chopping block beside it.
    const wx = jarSide * gx * 0.38;
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5 - row; i++) {
        const z = gz + 0.1 + (i + row * 0.5) * 0.13;
        b.cyl(1.25 - ((i + row) % 3) * 0.1, 0.12, 0.12, 6, wx + (((i * 3 + row) % 3) - 1) * 0.04, D + 0.06 + row * 0.11, z, TIMBER, {
          z: Math.PI / 2,
        });
      }
    }
    b.cyl(0.36, 0.34, 0.38, 8, wx + jarSide * 1.05, D + 0.18, gz + 0.4, TIMBER);
    // A lantern on a hook by the door: glass, cage and hood.
    const lx = jarSide * (doorW / 2 + 0.45);
    const ly = D + 2.05;
    const lz = -gz - 0.2;
    onFace(b, "-z", gz, lx, ly + 0.36, 0.04, 0.04, 0.2, 0.1, IRON);
    if (lit) b.glow(0.14, 0.2, 0.14, lx, ly, lz, FLAME);
    else b.box(0.14, 0.2, 0.14, lx, ly, lz, CASEMENT);
    b.box(0.2, 0.03, 0.2, lx, ly - 0.12, lz, IRON);
    b.cyl(0.1, 0.06, 0.22, 6, lx, ly + 0.16, lz, IRON);
    b.box(0.02, 0.14, 0.02, lx, ly + 0.28, lz, IRON);
  }

  // ---- the vine: up the back corner's outer pile, then up the house's corner
  // post to the eave, in leaves along a stem.
  {
    /** One leaf, hanging off the stem at bearing `a` and drooping. */
    const leaf = (x: number, y: number, z: number, a: number, s = 1): void => {
      b.box(0.15 * s, 0.02, 0.1 * s, x + Math.sin(a) * 0.07 * s, y, z + Math.cos(a) * 0.07 * s, CREEPER, { y: a + Math.PI / 2, z: 0.55 });
    };
    /** A stem up a post, `ox`/`oz` off its axis, with the leaves in twos and threes along it. */
    const climb = (x: number, z: number, y0: number, y1: number, ox: number, oz: number): void => {
      if (y1 - y0 < 0.3) return;
      b.box(0.035, y1 - y0, 0.035, x + ox, (y0 + y1) / 2, z + oz, CREEPER, { x: oz * 0.04, z: -ox * 0.04 });
      const out = Math.atan2(ox, oz);
      let i = 0;
      for (let y = y0 + 0.15; y < y1 - 0.05; i++) {
        const r = (i * 7 + seed) % 5;
        for (let j = 0; j < 2 + (r % 2); j++) {
          leaf(x + ox, y - j * 0.05, z + oz, out + (j - 1) * 0.8 + (r - 2) * 0.15, 0.8 + ((i + j) % 3) * 0.15);
        }
        y += 0.18 + r * 0.04;
      }
    };
    const ci = vineX < 0 ? 0 : cols.length - 1;
    const foot = feet[ci][rows.length - 1];
    const px = cols[ci];
    const pz = rows[rows.length - 1];
    if (foot !== null) climb(px, pz, Math.max(foot + 0.3, groundAt(px, pz) ?? foot + 0.3), bearerBot, vineX * 0.12, 0.12);
    climb(vineX * (gx - 0.08), gz - 0.08, D + 0.05, H + 0.1, vineX * 0.15, 0.15);
    // And along the plate under the eave for a metre or so.
    for (let i = 0; i < 9; i++) {
      const z = gz - 0.3 - i * 0.16;
      leaf(vineX * (gx + 0.12), H - 0.08 - (i % 3) * 0.06, z, vineX * (Math.PI / 2) + ((i % 3) - 1) * 0.7, 0.9);
    }
  }

  if (!enterable) return b;

  // ------------------------------------------------------------ inside
  //
  // Two trusses on tie beams at the wall head, the ridge beam and the purlins
  // they carry, a loft of boards across the back half, and a room with a
  // hearth in one back corner and a bed in the other. Nothing in it is taller
  // than a hearth box except what hangs or stands on the loft.
  const ridgeBot = under(0) - 0.2 / cosP;
  const purlinX = rx * 0.5;
  const purlinBot = under(purlinX) - 0.38 / cosP;
  const ties = [-d * 0.2, d * 0.12];
  for (const z of ties) {
    b.box(2 * ix, 0.2, 0.18, 0, H - 0.1, z, TEAK);
    if (!ruined) {
      b.box(0.14, ridgeBot - 0.24 - H, 0.14, 0, (H + ridgeBot - 0.24) / 2, z, TEAK);
      for (const sx of [-1, 1]) b.box(0.1, purlinBot - H, 0.1, sx * purlinX, (H + purlinBot) / 2, z, TEAK);
    }
  }
  if (!ruined) {
    b.box(0.16, 0.24, 2 * zEnd - 0.2, 0, ridgeBot - 0.12, 0, TEAK);
    for (const sx of [-1, 1]) onRoof(sx, purlinX - 0.08, purlinX + 0.08, -0.38, -0.2, -zEnd + 0.1, zEnd - 0.1, TEAK);
    // The loft: boards from the back tie to the back plate, and what is kept
    // up there — baskets, a bundle of cane, a rolled mat.
    const lz0 = ties[1];
    const lz1 = iz;
    for (let x = -ix + 0.14; x < ix - 0.08; x += 0.23) b.box(0.2, 0.03, lz1 - lz0, x, H + 0.015, (lz0 + lz1) / 2, PLANK);
    b.cyl(0.36, 0.52, 0.42, 9, -ix + 0.6, H + 0.21, lz1 - 0.45, THATCH);
    b.cyl(0.3, 0.44, 0.36, 9, -ix + 1.15, H + 0.18, lz1 - 0.4, THATCH);
    b.cyl(1.6, 0.14, 0.14, 6, ix - 1.2, H + 0.1, (lz0 + lz1) / 2, PLANK, { x: Math.PI / 2 });
    b.cyl(1.5, 0.12, 0.12, 6, ix - 1.1, H + 0.2, (lz0 + lz1) / 2 + 0.05, PLANK, { x: Math.PI / 2 });
    b.cyl(1.1, 0.24, 0.24, 8, 0.6, H + 0.14, lz1 - 0.35, MATTING, { z: Math.PI / 2 });
  }

  // The bed, in the back corner away from the hearth: a mat on the boards, the
  // bedding rolled against the wall and a pillow.
  {
    const bx = -jarSide * (ix - 1.05);
    b.box(1.9, 0.014, 1.3, bx, D + 0.007, iz - 0.8, MATTING);
    for (const kk of [-1, 1]) b.box(0.02, 0.018, 1.3, bx + kk * 0.93, D + 0.009, iz - 0.8, TEAK);
    b.cyl(1.3, 0.26, 0.26, 8, bx, D + 0.13, iz - 0.2, SAILCLOTH, { z: Math.PI / 2 });
    b.box(0.46, 0.11, 0.3, bx - jarSide * 0.55, D + 0.07, iz - 0.62, SAILCLOTH);
  }
  // The hearth: a box of earth on the boards with three stones, a pot on them
  // and the ash under it — the hut's kitchen, in the corner under the plate.
  {
    const hx = jarSide * (ix - 0.6);
    const hz = iz - 0.55;
    b.box(1.0, 0.18, 0.9, hx, D + 0.09, hz, TEAK);
    b.box(0.88, 0.02, 0.78, hx, D + 0.18, hz, DIRT);
    b.box(0.34, 0.015, 0.3, hx, D + 0.195, hz, PITCH);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 + 0.3;
      b.box(0.14, 0.13, 0.12, hx + Math.cos(a) * 0.2, D + 0.25, hz + Math.sin(a) * 0.2, DARK_STONE, { y: a });
    }
    if (lit) b.glow(0.2, 0.03, 0.18, hx, D + 0.205, hz, EMBER);
    b.cyl(0.24, 0.34, 0.26, 10, hx, D + 0.43, hz, IRON);
    b.cyl(0.04, 0.36, 0.36, 10, hx, D + 0.56, hz, IRON);
    // A rack over it for drying, hung from the plate.
    b.box(0.9, 0.04, 0.04, hx, H - 0.55, hz - 0.1, TIMBER);
    for (const kk of [-1, 1]) b.box(0.02, 0.35, 0.02, hx + kk * 0.42, H - 0.37, hz - 0.1, IRON);
    for (let i = 0; i < 4; i++) b.box(0.05, 0.28, 0.03, hx - 0.3 + i * 0.2, H - 0.7, hz - 0.1, THATCH);
  }
  // A shelf on the long wall with the window shut, between its two windows:
  // jars, a bowl and a bundle.
  {
    const s: Side = openSide === "-x" ? "+x" : "-x";
    const si = inside(s);
    const pl = -ix;
    const y = D + 1.6;
    onFace(b, si, pl, 0, y, 0.9, 0.04, 0.26, 0.13, PLANK);
    for (const kk of [-1, 1]) onFace(b, si, pl, kk * 0.35, y - 0.12, 0.04, 0.2, 0.2, 0.1, TIMBER);
    const n = outward(si);
    const sx = n * (pl + 0.13);
    b.cyl(0.22, 0.14, 0.18, 8, sx, y + 0.13, -0.22, BRICK);
    b.cyl(0.16, 0.12, 0.14, 8, sx, y + 0.1, 0.02, BRICK);
    b.cyl(0.06, 0.22, 0.12, 8, sx, y + 0.05, 0.26, TEAK);
  }
  // A water jar in the front corner inside, a basket and a lantern hung from
  // the front tie.
  jar(jarSide * (ix - 0.35), -iz + 0.35, 0.85, true);
  {
    const tz = ties[0];
    const bx = -jarSide * 1.1;
    b.box(0.02, 0.32, 0.02, bx, H - 0.36, tz, IRON);
    b.cyl(0.26, 0.36, 0.26, 9, bx, H - 0.6, tz, THATCH);
    const lx = jarSide * 0.5;
    const ly = D + 2.15;
    b.box(0.02, H - 0.2 - ly - 0.2, 0.02, lx, (H - 0.2 + ly + 0.2) / 2, tz, IRON);
    if (lit) b.glow(0.14, 0.2, 0.14, lx, ly, tz, FLAME);
    else b.box(0.14, 0.2, 0.14, lx, ly, tz, CASEMENT);
    b.box(0.2, 0.03, 0.2, lx, ly - 0.12, tz, IRON);
    b.cyl(0.1, 0.06, 0.22, 6, lx, ly + 0.16, tz, IRON);
  }

  return b;
}
