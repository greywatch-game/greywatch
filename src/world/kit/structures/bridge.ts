/**
 * kit/structures/bridge.ts — buildBridge: the pile-and-stringer footbridge over
 * the creek.
 * Part of the structures set: follows the contract in kit/core.ts, and the
 * cover heights and round-collider rule in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  limb,
  slab,
  type BuildCtx,
  type BuildParams,
  type Structure,
  streetSeed,
  DARK_STONE,
  GUARD_HEIGHT,
  GUARD_THICKNESS,
  MOSS_STONE,
  PLANK,
  STONE,
  TIMBER,
} from "../core";

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
