/**
 * kit/buildings/boathouse.ts — buildBoathouse: the tarred boat shed on piles
 * under a reed thatch.
 * Part of the buildings set: follows the contract in kit/core.ts; the set's
 * files are listed in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type Point3,
  type Structure,
  carve,
  convexSolid,
  onFace,
  outward,
  runsAlongX,
  type Hole,
  type Side,
  CASEMENT,
  BRICK,
  FLAME,
  IRON,
  PITCH,
  PLANK,
  SAILCLOTH,
  THATCH,
  TIMBER,
} from "../core";
import { SHOPLIT, offFace, framing, THATCH_PITCH, THATCH_DEPTH, WEATHERBOARD } from "./village";

/**
 * The boathouse: a tarred boat shed on piles at the water's edge, under a
 * steep reed thatch. The boat door is in the -Z gable and stands open, the
 * water doors in the +Z gable are shut and barred, and the whole +X side is
 * open to the moorings under a deep canopy. Inside there is a boat on its
 * cradle, a bench, and a net loft hung over the open side.
 *
 * Hollowmere's flag E is inside it, which makes it a deliberately cramped,
 * low-visibility fight. Cinderhaven stands a row of them along its bay.
 *
 * **The shell's colliders are the ones it has always had, in the order it has
 * always emitted them**: the deck, the boat door's jambs and head, the two
 * solid walls, the slab over the open side, and the roof's flat slab at the
 * eaves (`gableRoof`'s, stated by hand now). This is the tavern's rule, and its
 * header argues it. The slab over the open side is the odd one. It was a
 * `doorWall` laid along a 0.3 m wall, so it came out as a lintel 3.4 m deep
 * over a 13 m opening with nothing under it. That is the fight's main
 * sightline from the jetties, so it stays, and the drawing now agrees with
 * it. Inside the wall line it is a NET LOFT, hung from the trusses by iron
 * rods, so no post stands in the room. Outside the wall line it is a CANOPY
 * with a deep boarded valance, carried on brackets from the corner posts.
 *
 * **What was wrong was that it read as a crate.** It was a plank box with a
 * shallow plank lid, a door hole, a slab stuck out of one side, six stumps
 * under it and a green lamp over the door. It is now the things a boathouse
 * is recognised by:
 *
 * - **Tarred board-and-batten on a raw frame.** The walls' own boxes are raw
 *   boards and read as the inside. The outside is vertical boards in `PITCH`
 *   with a batten over every joint and a couple of unpainted replacement
 *   boards. The trim is painted pale (`WEATHERBOARD`): corner boards, window
 *   and door frames, the verge boards and the valance's capping. On the
 *   darkest value in the kit, those pale lines are what carries the building
 *   at night.
 * - **A reed roof steep enough to shed water**, built from the cottage's
 *   thatch words (`THATCH_PITCH`, `THATCH_DEPTH`): coats cut plumb at the
 *   eave, courses stepping down the slope, and a block-cut ridge. Under it is
 *   open timber: king-post trusses, purlins, common rafters whose feet show
 *   under the eave, and a ridge board.
 * - **Piles**: four rows under bearers, cross-braced on the outer faces, and
 *   cut long so a placement on a slope shows them rather than a gap.
 * - **A boat**: an open clinker double-ender on keel blocks and shores. Its
 *   strakes lap outward one over the next, so every land is an edge the ink
 *   finds. It is tarred, with a pale sheer strake, and has ribs, thwarts,
 *   bottom boards, a gunwale and oars.
 *
 * **Four colliders follow the shell's**, so the shell's part of the bake is
 * unchanged: the boat as three boxes (the waist and two narrower ends) and
 * the bench. Everything else is drawing, and all of it is either overhead,
 * flat on a wall, or small enough to walk over. The aisle from the boat door
 * to the water doors, and the whole open side, are kept clear. So is the
 * flag's own spot on Hollowmere (local (0, 4)).
 *
 * **The roof is three metres taller than it was, and Hollowmere's flag E
 * says so**: the flag is flown from the ridge, and its `poleLift` puts the
 * pole's foot on the ridge roll rather than on the collider slab.
 *
 * One light, as before: a lantern hung from the middle truss. The one by the
 * boat door is glow only, the chapel's rule for fixtures past the first.
 */
export function buildBoathouse(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "boathouse");
  const w = 11;
  const d = 13;
  const h = 4.6;
  const t = 0.3;

  // ------------------------------------------------------------ the masses
  //
  // Every collider the shell has, stated by hand in the order `doorWall`,
  // `wall` and `gableRoof` used to emit them. See the header before adding to
  // it.
  const wy = h / 2 + 0.7;
  const gap = 3.4;
  const gapH = 3;
  const side = (w - gap) / 2;
  const off = gap / 2 + side / 2;
  const lintel = h - gapH;
  const lintelY = wy + h / 2 - lintel / 2;
  b.block({ w, h: 0.25, d, x: 0, y: 0.6, z: 0 });
  b.block({ w: side, h, d: t, x: -off, y: wy, z: -d / 2 });
  b.block({ w: side, h, d: t, x: off, y: wy, z: -d / 2 });
  b.block({ w: gap, h: lintel, d: t, x: 0, y: lintelY, z: -d / 2 });
  b.block({ w, h, d: t, x: 0, y: wy, z: d / 2 });
  b.block({ w: t, h, d, x: -w / 2, y: wy, z: 0 });
  // The slab over the open side: the loft inside the wall line, the canopy
  // outside it. See the header.
  b.block({ w: gap, h: lintel, d, x: w / 2, y: lintelY, z: 0 });
  // The roof's collider: exactly the slab `gableRoof` laid at the eaves.
  b.block({ w: w + 1, h: 0.3, d: d + 1, x: 0, y: h + 0.7, z: 0 });

  // ----------------------------------------------------------- the drawing
  /** The deck's top, the wall head, and the top of both openings. */
  const F = 0.725;
  const H = h + 0.7;
  const OPEN = 0.7 + gapH;
  /** The walls' outer faces, and their inner ones. */
  const gx = w / 2 + t / 2;
  const gz = d / 2 + t / 2;
  const ix = w / 2 - t / 2;
  const iz = d / 2 - t / 2;
  /** Where the tar stops, below the deck's edge. */
  const foot = 0.15;

  // The deck, and the walls' own boxes in raw board: the inside of the shed.
  b.box(w, 0.25, d, 0, 0.6, 0, PLANK);
  for (const k of [-1, 1]) b.box(side, h, t, k * off, wy, -d / 2, PLANK);
  b.box(gap, lintel, t, 0, lintelY, -d / 2, PLANK);
  b.box(w, h, t, 0, wy, d / 2, PLANK);
  b.box(t, h, d, -w / 2, wy, 0, PLANK);
  // The loft's outer wall, over the open side between the plate and the head.
  b.box(t, H - OPEN, d, w / 2, (H + OPEN) / 2, 0, PLANK);

  // The roof, described by its UNDERSIDE: the cottage's construction, through
  // the top of the wall face at the thatch's own pitch.
  const k = THATCH_PITCH;
  const pitch = Math.atan(k);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const T = THATCH_DEPTH;
  const tip = gx + 0.5;
  const zEnd = gz + 0.35;
  const under = (x: number): number => H - 0.02 + (gx - x) * k;
  const ridgeTop = under(0) + T / cosP;

  // The gables' backing, raw board carried up under the thatch.
  for (const sz of [-1, 1]) {
    const zc = (sz * d) / 2;
    const face = (z: number): Point3[] => [
      [-gx, H - 0.3, z],
      [gx, H - 0.3, z],
      [gx, under(gx), z],
      [0, under(0), z],
      [-gx, under(gx), z],
    ];
    convexSolid(b, face(zc - t / 2), face(zc + t / 2), PLANK);
  }

  // ---- the tar: vertical boards over each outer face, a batten on every
  // joint, both stopped at every opening. A board's head is cut level at the
  // LOWER of its two edges, so under a rake the heads step, and the verge
  // board covers the steps (the mill's construction).
  const BP = 0.46;
  const tar = (
    s: Side,
    a0: number,
    a1: number,
    y0: (u: number) => number,
    top: (u: number) => number,
    holes: Hole[],
    raw: number[] = [],
  ): void => {
    const plane = runsAlongX(s) ? gz : gx;
    const n = Math.max(1, Math.round((a1 - a0) / BP));
    const bw = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      const c0 = a0 + i * bw;
      const c1 = c0 + bw;
      const edges = [c0, c1];
      for (const o of holes) for (const e of [o.u0, o.u1]) if (e > c0 + 0.02 && e < c1 - 0.02) edges.push(e);
      edges.sort((p, q) => p - q);
      // A board rotted at its foot and replaced from there up, not yet tarred.
      const patch = raw.includes(i) ? F + 1.1 + (i % 3) * 0.3 : -Infinity;
      for (let j = 0; j + 1 < edges.length; j++) {
        const e0 = edges[j];
        const e1 = edges[j + 1];
        const um = (e0 + e1) / 2;
        const yTop = Math.min(top(e0), top(e1));
        const cuts = holes.filter((o) => um > o.u0 && um < o.u1).map((o): [number, number] => [o.y0, o.y1]);
        for (const [ya, yb] of carve(y0(um), yTop, cuts)) {
          for (const [pa, pb, color] of [
            [ya, Math.min(yb, patch), PLANK],
            [Math.max(ya, patch), yb, PITCH],
          ] as const) {
            if (pb - pa > 0.05) onFace(b, s, plane, um, (pa + pb) / 2, e1 - e0, pb - pa, 0.03, 0.015, color);
          }
        }
      }
      if (i + 1 === n) break;
      const cuts = holes
        .filter((o) => c1 + 0.05 > o.u0 && c1 - 0.05 < o.u1)
        .map((o): [number, number] => [o.y0 - 0.02, o.y1 + 0.02]);
      for (const [ya, yb] of carve(y0(c1), top(c1) - 0.04, cuts)) {
        if (yb - ya > 0.1) onFace(b, s, plane, c1, (ya + yb) / 2, 0.07, yb - ya, 0.04, 0.05, PITCH);
      }
    }
  };
  const atFoot = (): number => foot;
  const gableTop = (u: number): number => under(Math.abs(u)) - 0.03;
  const eavesTop = (): number => H - 0.03;

  /** A louvred vent high in a gable: the roof space's air. */
  const ventY = under(0) - 1.4;
  const vent = (s: Side): Hole => {
    const n = outward(s);
    onFace(b, s, gz, 0, ventY, 0.9, 0.62, 0.04, -0.005, CASEMENT);
    for (let i = 0; i < 4; i++) {
      b.box(0.84, 0.13, 0.025, 0, ventY - 0.21 + i * 0.14, n * (gz + 0.035), TIMBER, { x: n * 0.7 });
    }
    for (const kk of [-1, 1]) onFace(b, s, gz, kk * 0.5, ventY, 0.1, 0.84, 0.08, 0.06, WEATHERBOARD);
    onFace(b, s, gz, 0, ventY + 0.37, 1.16, 0.1, 0.08, 0.06, WEATHERBOARD);
    onFace(b, s, gz, 0, ventY - 0.37, 1.2, 0.09, 0.14, 0.08, WEATHERBOARD);
    return { u0: -0.45, u1: 0.45, y0: ventY - 0.31, y1: ventY + 0.31 };
  };

  // ---- the boat door (-Z): open, its two leaves folded back flat against
  // the tar with their ledged INSIDE faces out, a pale frame, and a
  // threshold. A leaf folded back 180 degrees shows the face that was
  // inside, and a tarred door is raw on that side.
  const leafW = 1.66;
  const leafIn = gap / 2 + 0.08;
  const leafY0 = F + 0.06;
  const leafY1 = OPEN - 0.05;
  const front: Hole[] = [{ u0: -gap / 2, u1: gap / 2, y0: F - 0.02, y1: OPEN }, vent("-z")];
  for (const kk of [-1, 1]) {
    const uh = kk * leafIn;
    const ul = kk * (leafIn + leafW);
    const u = (uh + ul) / 2;
    front.push({ u0: Math.min(uh, ul), u1: Math.max(uh, ul), y0: leafY0, y1: leafY1 });
    onFace(b, "-z", gz, u, (leafY0 + leafY1) / 2, leafW, leafY1 - leafY0, 0.06, 0.1, PLANK);
    const ledges = [leafY0 + 0.3, (leafY0 + leafY1) / 2, leafY1 - 0.3];
    for (const y of ledges) onFace(b, "-z", gz, u, y, leafW - 0.14, 0.17, 0.04, 0.15, TIMBER);
    // The braces rise away from the hinge, from ledge to ledge.
    for (let i = 0; i < 2; i++) {
      const ya = ledges[i] + 0.1;
      const yb = ledges[i + 1] - 0.1;
      const ua = uh + kk * 0.14;
      const ub = ul - kk * 0.14;
      onFace(b, "-z", gz, (ua + ub) / 2, (ya + yb) / 2, Math.hypot(ub - ua, yb - ya), 0.14, 0.03, 0.15, TIMBER, Math.atan2(yb - ya, ub - ua));
    }
    // The hinge knuckles at the jamb, and the hook that holds the leaf back.
    for (const y of [ledges[0], ledges[2]]) onFace(b, "-z", gz, uh - kk * 0.02, y, 0.09, 0.2, 0.1, 0.1, IRON);
    onFace(b, "-z", gz, ul + kk * 0.1, leafY1 - 0.35, 0.26, 0.03, 0.03, 0.12, IRON);
  }
  for (const kk of [-1, 1]) {
    onFace(b, "-z", gz, kk * (gap / 2 + 0.03), (F + OPEN) / 2, 0.1, OPEN - F, 0.12, 0.08, WEATHERBOARD);
    // The reveal's lining, through the wall.
    b.box(0.06, OPEN - F, t + 0.02, kk * (gap / 2 - 0.03), (F + OPEN) / 2, -d / 2, PLANK);
  }
  onFace(b, "-z", gz, 0, OPEN + 0.1, gap + 0.34, 0.2, 0.12, 0.08, WEATHERBOARD);
  b.box(gap + 0.8, 0.3, 0.2, 0, OPEN + 0.15, -iz + 0.1, TIMBER);
  b.box(gap, 0.05, t + 0.12, 0, F - 0.015, -d / 2, TIMBER);
  tar("-z", -gx, gx, atFoot, gableTop, front, [5, 19]);

  // ---- the water doors (+Z): a pair of leaves, shut, their strap hinges
  // outside, and the ledges, braces and drop bar inside.
  const dw = 3.2;
  const dY0 = F + 0.05;
  const dY1 = OPEN - 0.1;
  const dMid = (dY0 + dY1) / 2;
  const back: Hole[] = [{ u0: -dw / 2, u1: dw / 2, y0: F - 0.02, y1: dY1 }, vent("+z")];
  for (const kk of [-1, 1]) {
    const u = (kk * dw) / 4;
    onFace(b, "+z", gz, u, dMid, dw / 2 - 0.02, dY1 - dY0, 0.07, 0.1, PITCH);
    for (let i = 1; i < 4; i++) onFace(b, "+z", gz, u - dw / 4 + (i * dw) / 8, dMid, 0.06, dY1 - dY0 - 0.06, 0.03, 0.15, PITCH);
    for (const y of [dY0 + 0.35, dMid, dY1 - 0.35]) {
      onFace(b, "+z", gz, kk * (dw / 2 - 0.55), y, 1.0, 0.08, 0.02, 0.175, IRON);
      onFace(b, "+z", gz, kk * (dw / 2 + 0.02), y, 0.08, 0.16, 0.1, 0.1, IRON);
    }
    // Inside: three ledges and two braces on each leaf.
    const ledges = [dY0 + 0.3, dMid, dY1 - 0.3];
    for (const y of ledges) onFace(b, "-z", -iz, u, y, dw / 2 - 0.2, 0.17, 0.05, 0.025, TIMBER);
    for (let i = 0; i < 2; i++) {
      const ya = ledges[i] + 0.1;
      const yb = ledges[i + 1] - 0.1;
      const ua = kk * (dw / 2 - 0.15);
      const ub = kk * 0.15;
      onFace(b, "-z", -iz, (ua + ub) / 2, (ya + yb) / 2, Math.hypot(ub - ua, yb - ya), 0.14, 0.04, 0.02, TIMBER, Math.atan2(yb - ya, ub - ua));
    }
    onFace(b, "+z", gz, kk * (dw / 2 + 0.06), (F + OPEN) / 2, 0.12, OPEN - F, 0.12, 0.08, WEATHERBOARD);
    // The drop bar's keepers.
    onFace(b, "-z", -iz, kk * (dw / 2 + 0.1), dMid, 0.12, 0.3, 0.2, 0.1, IRON);
  }
  onFace(b, "+z", gz, 0, OPEN + 0.02, dw + 0.4, 0.2, 0.12, 0.08, WEATHERBOARD);
  onFace(b, "+z", gz, 0, F - 0.04, dw + 0.4, 0.12, 0.2, 0.1, TIMBER);
  onFace(b, "-z", -iz, 0, dMid, dw + 0.6, 0.16, 0.12, 0.14, TIMBER);
  onFace(b, "-z", -iz, 0, OPEN, dw + 0.8, 0.3, 0.2, 0.1, TIMBER);
  tar("+z", -gx, gx, atFoot, gableTop, back, [8]);

  // ---- the windows (-X), over the boat: pale frames and glazing bars, the
  // glass on both faces of the wall. The one nearer the bench is lit.
  const winW = 1.1;
  const winH = 0.8;
  const sill = F + 1.45;
  const east: Hole[] = [];
  const eastIn: Hole[] = [];
  for (const [u, lit] of [
    [-2.3, SHOPLIT],
    [1.9, undefined],
  ] as const) {
    const mid = sill + winH / 2;
    if (lit) b.glow(0.05, winH, winW, -gx - 0.02, mid, u, lit);
    else onFace(b, "-x", gx, u, mid, winW, winH, 0.04, 0.02, CASEMENT);
    onFace(b, "+x", -ix, u, mid, winW, winH, 0.04, 0.02, CASEMENT);
    for (const kk of [-1, 1]) {
      onFace(b, "-x", gx, u + kk * (winW / 2 + 0.05), mid, 0.1, winH + 0.2, 0.08, 0.07, WEATHERBOARD);
      onFace(b, "+x", -ix, u + kk * (winW / 2 + 0.05), mid, 0.1, winH + 0.2, 0.06, 0.03, TIMBER);
    }
    onFace(b, "-x", gx, u, sill + winH + 0.06, winW + 0.32, 0.12, 0.1, 0.08, WEATHERBOARD);
    onFace(b, "-x", gx, u, sill - 0.05, winW + 0.36, 0.1, 0.16, 0.1, WEATHERBOARD);
    onFace(b, "+x", -ix, u, sill + winH + 0.06, winW + 0.2, 0.12, 0.06, 0.03, TIMBER);
    onFace(b, "+x", -ix, u, sill - 0.05, winW + 0.2, 0.08, 0.18, 0.07, TIMBER);
    for (let i = 1; i < 3; i++) onFace(b, "-x", gx, u - winW / 2 + (i * winW) / 3, mid, 0.04, winH, 0.04, 0.06, WEATHERBOARD);
    onFace(b, "-x", gx, u, mid, winW, 0.04, 0.04, 0.06, WEATHERBOARD);
    east.push({ u0: u - winW / 2, u1: u + winW / 2, y0: sill, y1: sill + winH });
    eastIn.push({ u0: u - winW / 2 - 0.15, u1: u + winW / 2 + 0.15, y0: sill - 0.15, y1: sill + winH + 0.15 });
  }
  tar("-x", -gz, gz, atFoot, eavesTop, east, [3, 17]);

  // Corner boards, pale, lapping both faces at every corner.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const sX: Side = sx > 0 ? "+x" : "-x";
      const sZ: Side = sz > 0 ? "+z" : "-z";
      onFace(b, sZ, gz, sx * (gx - 0.08), (foot + H) / 2, 0.2, H - foot, 0.05, 0.065, WEATHERBOARD);
      onFace(b, sX, gx, sz * (gz - 0.08), (foot + H) / 2, 0.2, H - foot, 0.05, 0.065, WEATHERBOARD);
    }
  }
  // The verge boards up each rake, under the thatch, over the stepped heads.
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const trim = (z: number): Point3[] => [
        [0, under(0) + 0.04, z],
        [sx * (gx + 0.12), under(gx + 0.12) + 0.04, z],
        [sx * (gx + 0.12), under(gx + 0.12) - 0.34, z],
        [0, under(0) - 0.34, z],
      ];
      convexSolid(b, trim(sz * (gz - 0.02)), trim(sz * (gz + 0.085)), WEATHERBOARD);
    }
  }

  // ---- inside: the frame on the three walls, and the plates.
  framing(b, "+z", -iz, ix, F, H - 0.25, 2.6, [{ u0: -gap / 2 - 0.1, u1: gap / 2 + 0.1, y0: 0, y1: OPEN + 0.3 }], "panel");
  framing(b, "-z", -iz, ix, F, H - 0.25, 2.6, [{ u0: -dw / 2 - 0.2, u1: dw / 2 + 0.2, y0: 0, y1: OPEN + 0.15 }], "panel");
  framing(b, "+x", -ix, iz, F, H - 0.25, 2.6, eastIn, "panel");
  for (const s of ["+z", "-z"] as const) onFace(b, s, -iz, 0, H - 0.13, 2 * ix, 0.24, 0.16, 0.05, TIMBER);
  onFace(b, "+x", -ix, 0, H - 0.13, 2 * iz, 0.24, 0.16, 0.05, TIMBER);

  // ---- the open side (+X): corner posts, the plate across the opening with
  // iron straps on it, and a knee brace in each top corner, all above head
  // height.
  const plateH = 0.42;
  for (const sz of [-1, 1]) {
    b.box(0.3, OPEN - F, 0.3, w / 2, (F + OPEN) / 2, (sz * d) / 2, TIMBER);
    const za = sz * (iz - 0.05);
    const zb = sz * (iz - 1.05);
    const ya = 2.85;
    onFace(b, "+x", w / 2, (za + zb) / 2, (ya + OPEN) / 2, Math.hypot(zb - za, OPEN - ya), 0.17, 0.15, 0, TIMBER, Math.atan2(OPEN - ya, zb - za));
  }
  b.box(0.42, plateH, 2 * iz, w / 2 - 0.01, OPEN + plateH / 2, 0, TIMBER);
  for (let z = -iz + 1.2; z < iz - 0.5; z += 1.75) {
    onFace(b, "+x", w / 2 + 0.2, z, OPEN + plateH / 2, 0.09, plateH + 0.02, 0.02, 0.01, IRON);
  }
  // The deck's edge on the open side, its fascia, and two cleats.
  onFace(b, "+x", w / 2, 0, 0.45, d, 0.5, 0.06, 0.03, TIMBER);
  for (const z of [-5, 5.6]) {
    b.box(0.12, 0.06, 0.36, w / 2 - 0.2, F + 0.08, z, IRON);
    b.box(0.08, 0.06, 0.08, w / 2 - 0.2, F + 0.03, z, IRON);
  }

  // ---- the canopy over the open side: boarded soffit, a roof laid to fall
  // under the thatch's eave, closed ends, a deep valance with a pale cap, and
  // a bracket off each corner post.
  {
    const x0 = gx;
    const x1 = gx + 1.6;
    const cz = gz + 0.2;
    const top = (x: number): number => 4.86 - (x - x0) * 0.2;
    const slab = 0.09;
    b.box(x1 - x0, 0.05, 2 * cz, (x0 + x1) / 2, OPEN + 0.025, 0, PLANK);
    const sec = (z: number): Point3[] => [
      [x0, top(x0), z],
      [x1 + 0.12, top(x1 + 0.12), z],
      [x1 + 0.12, top(x1 + 0.12) - slab, z],
      [x0, top(x0) - slab, z],
    ];
    convexSolid(b, sec(-cz - 0.1), sec(cz + 0.1), PITCH);
    const vTop = top(x1) - slab;
    const vBot = OPEN - 0.12;
    b.box(0.06, vTop - vBot, 2 * cz + 0.04, x1 + 0.03, (vTop + vBot) / 2, 0, PITCH);
    for (let z = -cz + BP; z < cz - 0.1; z += BP) b.box(0.04, vTop - vBot - 0.06, 0.07, x1 + 0.08, (vTop + vBot) / 2, z, PITCH);
    b.box(0.1, 0.07, 2 * cz + 0.1, x1 + 0.05, vTop - 0.03, 0, WEATHERBOARD);
    b.box(0.08, 0.06, 2 * cz + 0.06, x1 + 0.07, vBot + 0.04, 0, WEATHERBOARD);
    for (const sz of [-1, 1]) {
      const end = (z: number): Point3[] => [
        [x0, OPEN, z],
        [x1, OPEN, z],
        [x1, vTop, z],
        [x0, top(x0) - slab, z],
      ];
      convexSolid(b, end(sz * cz - 0.03), end(sz * cz + 0.03), PITCH);
      offFace(b, "+x", gx, sz * (iz + 0.1), 0.14, 2.8, OPEN, 0, 1.2, 0.16, TIMBER);
    }
    // The strip of tar left between the canopy and the thatch.
    tar("+x", -gz, gz, () => top(x0), eavesTop, []);
  }

  // ---- the net loft, hung over the open side from the trusses: joists and
  // boards, a front beam, a boarded apron with a cap, and nets drying over
  // it — corks along the head rope and the foot bunched. The rods it hangs
  // from are what keep a post out of the room.
  const loftX = w / 2 - gap / 2;
  const trussZ = [-iz / 2, 0, iz / 2];
  const tieBot = H - 0.24;
  {
    for (let z = -iz + 0.3; z < iz; z += 0.6) b.box(ix - loftX, 0.16, 0.1, (loftX + ix) / 2, OPEN + 0.08, z, TIMBER);
    b.box(ix - loftX, 0.05, 2 * iz, (loftX + ix) / 2, OPEN + 0.185, 0, PLANK);
    b.box(0.28, 0.32, 2 * iz, loftX + 0.14, OPEN + 0.16, 0, TIMBER);
    const capY = 4.84;
    b.box(0.05, capY - OPEN - 0.32, 2 * iz, loftX + 0.025, (capY + OPEN + 0.32) / 2, 0, PLANK);
    b.box(0.14, 0.08, 2 * iz, loftX + 0.06, capY + 0.04, 0, TIMBER);
    for (const z of trussZ) b.box(0.04, tieBot - OPEN - 0.3, 0.04, loftX + 0.16, (tieBot + OPEN + 0.3) / 2, z, IRON);
    // A net hangs in FOLDS, not as a sheet: strips of a hand's span, each
    // dropped its own length and standing a little off the next, so the hem
    // is ragged and every fold is an edge. Tanned nets are dark red-brown.
    for (const [z0, z1, drop] of [
      [-5.9, -4.0, 1.5],
      [-1.3, 0.7, 1.25],
      [2.1, 3.3, 1.6],
    ] as const) {
      const zc = (z0 + z1) / 2;
      const len = z1 - z0;
      const n = Math.round(len / 0.32);
      const fw = len / n;
      for (let i = 0; i < n; i++) {
        const fz = z0 + (i + 0.5) * fw;
        const fd = drop * (0.78 + 0.22 * Math.abs(Math.sin(i * 1.9 + z0)));
        const fx = loftX - 0.05 - (i % 2) * 0.05;
        b.box(0.05, fd, fw + 0.06, fx, capY + 0.02 - fd / 2, fz, BRICK, { x: (i % 2 ? 1 : -1) * 0.08, z: 0.04 });
        b.box(0.12, 0.1, fw * 0.8, fx - 0.03, capY + 0.02 - fd + 0.05, fz, BRICK);
      }
      b.box(0.32, 0.06, len, loftX + 0.08, capY + 0.1, zc, BRICK);
      for (let z = z0 + 0.15; z < z1; z += 0.3) b.cyl(0.11, 0.11, 0.11, 6, loftX - 0.1, capY - 0.08, z, SAILCLOTH, { z: Math.PI / 2 });
    }
    // Gear stored on the loft: a stack of pots, and oars stood up against the
    // rafters where their blades show over the apron.
    for (const [z, y] of [
      [-6.0, 0],
      [-5.35, 0],
      [-5.67, 0.46],
    ] as const) {
      b.cyl(0.62, 0.46, 0.46, 7, 4.65, OPEN + 0.44 + y, z, TIMBER, { z: Math.PI / 2 });
    }
    for (const z of [0.9, 1.15, 1.4, 4.4]) {
      const heel = [4.3, OPEN + 0.22];
      const head = [4.85, 5.55];
      const dx = head[0] - heel[0];
      const dy = head[1] - heel[1];
      b.box(0.06, Math.hypot(dx, dy), 0.06, (heel[0] + head[0]) / 2, (heel[1] + head[1]) / 2, z, PLANK, { z: Math.atan2(-dx, dy) });
      b.box(0.03, 0.75, 0.15, head[0] - 0.08, head[1] - 0.2, z, PLANK, { z: Math.atan2(-dx, dy) });
    }
    b.cyl(3.6, 0.34, 0.34, 8, 4.75, OPEN + 0.38, -1.6, SAILCLOTH, { x: Math.PI / 2 });
  }
  // The ladder up to it, at the water end.
  {
    const zL = 5.6;
    const xb = 3.1;
    const xt = loftX - 0.08;
    const yb = F;
    const yt = 4.75;
    const dx = xt - xb;
    const dy = yt - yb;
    for (const kz of [-0.24, 0.24]) b.box(0.07, Math.hypot(dx, dy), 0.07, (xb + xt) / 2, (yb + yt) / 2, zL + kz, TIMBER, { z: Math.atan2(-dx, dy) });
    for (let y = yb + 0.3; y < yt - 0.1; y += 0.3) b.box(0.05, 0.05, 0.5, xb + ((y - yb) * dx) / dy, y, zL, TIMBER);
  }

  // ---- the open roof: a king-post truss on each tie, purlins, commons whose
  // feet run out under the eave, and the ridge board. Every tie lies inside
  // the roof's collider slab.
  /** A slab laid in the roof plane on side `sx`; the cottage's `onRoof`. */
  const onRoof = (sx: number, x0: number, x1: number, o0: number, o1: number, z0: number, z1: number, color: string): void => {
    const xm = (x0 + x1) / 2;
    const o = (o0 + o1) / 2;
    b.box((x1 - x0) / cosP, o1 - o0, z1 - z0, sx * (xm + o * sinP), under(xm) + o * cosP, (z0 + z1) / 2, color, {
      z: -sx * pitch,
    });
  };
  for (const z of trussZ) {
    b.box(2 * ix, 0.28, 0.24, 0, H - 0.1, z, TIMBER);
    const kTop = under(0) - 0.12;
    b.box(0.22, kTop - H, 0.2, 0, (H + kTop) / 2, z, TIMBER);
    for (const sx of [-1, 1]) {
      onRoof(sx, 0.14, ix, -0.32, -0.02, z - 0.1, z + 0.1, TIMBER);
      const fx = sx * 0.12;
      const fy = H + 0.55;
      const tx = sx * 2.5;
      const ty = under(2.5) - 0.3;
      const dx = tx - fx;
      const dy = ty - fy;
      b.box(0.16, Math.hypot(dx, dy), 0.16, (fx + tx) / 2, (fy + ty) / 2, z, TIMBER, { z: Math.atan2(-dx, dy) });
    }
  }
  for (const sx of [-1, 1]) {
    for (const x of [1.9, 3.7]) onRoof(sx, x - 0.11, x + 0.11, -0.4, -0.15, -iz, iz, TIMBER);
    for (let z = -iz + 0.25; z < iz; z += 0.55) {
      if (trussZ.some((tz) => Math.abs(tz - z) < 0.2)) continue;
      onRoof(sx, 0.08, gx + 0.38, -0.15, -0.01, z - 0.04, z + 0.04, TIMBER);
    }
  }
  b.box(0.06, 0.3, 2 * iz, 0, under(0) - 0.17, 0, TIMBER);

  // ---- the thatch: the cottage's coats, cut plumb at the eave with the eave
  // rolled, three courses stepping down the slope, and a block-cut ridge.
  {
    const roofPt = (sx: number, x: number, o: number, z: number): Point3 => [sx * (x + o * sinP), under(x) + o * cosP, z];
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
    const xc = 0.85;
    const Tr = T + 0.1;
    for (const sx of [-1, 1]) {
      coat(sx, 0, tip, 0, T, -zEnd, zEnd, 0.16);
      coat(sx, 0, tip * 0.76, T - 0.02, T + 0.04, -zEnd, zEnd);
      coat(sx, 0, tip * 0.52, T + 0.02, T + 0.07, -zEnd, zEnd);
      coat(sx, 0, tip * 0.3, T + 0.05, Tr, -zEnd, zEnd);
      coat(sx, 0, xc, Tr - 0.02, Tr + 0.14, -zEnd + 0.06, zEnd - 0.06);
      for (let z = -zEnd + 0.3; z < zEnd - 0.2; z += 0.5) {
        const tooth = (o: number): Point3[] => [
          roofPt(sx, xc - 0.02, o, z - 0.21),
          roofPt(sx, xc + 0.28, o, z),
          roofPt(sx, xc - 0.02, o, z + 0.21),
        ];
        convexSolid(b, tooth(Tr - 0.02), tooth(Tr + 0.07), THATCH);
      }
      for (const x of [0.3, xc - 0.16]) onRoof(sx, x, x + 0.05, Tr + 0.14, Tr + 0.19, -zEnd + 0.12, zEnd - 0.12, TIMBER);
    }
    b.cyl(2 * zEnd - 0.1, 0.46, 0.46, 8, 0, ridgeTop + 0.28, 0, THATCH, { x: Math.PI / 2 });
  }

  // ---- the lanterns: the shed's one light hung from the middle truss, and a
  // second by the boat door that is glow only.
  /** A hurricane lantern: glass, an iron cage and hood, a ring to hang it by. */
  const lantern = (x: number, y: number, z: number): void => {
    b.glow(0.2, 0.26, 0.2, x, y, z, FLAME);
    for (const [ox, oz] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ] as const) {
      b.box(0.025, 0.32, 0.025, x + ox * 0.11, y, z + oz * 0.11, IRON);
    }
    b.box(0.26, 0.04, 0.26, x, y - 0.16, z, IRON);
    b.cyl(0.14, 0.08, 0.3, 6, x, y + 0.23, z, IRON);
    b.box(0.03, 0.12, 0.1, x, y + 0.36, z, IRON);
  };
  {
    const lx = 1.2;
    const ly = 3.35;
    b.box(0.03, tieBot - ly - 0.42, 0.03, lx, (tieBot + ly + 0.42) / 2, 0, IRON);
    lantern(lx, ly, 0);
    b.light(FLAME, 14, 1.4, 0.25, lx, ly, 0);
  }
  {
    const u = -2.55;
    const ly = 4.2;
    offFace(b, "-z", gz, u, 0.05, ly + 0.46, ly + 0.46, 0.04, 0.5, 0.05, IRON);
    b.box(0.03, 0.06, 0.03, u, ly + 0.41, -gz - 0.44, IRON);
    lantern(u, ly, -gz - 0.44);
  }

  // ---- the piles: four rows under bearers, braced on the outer faces, and
  // cut long, so a placement on falling ground stands on them rather than on
  // air. Everything here is under the deck and is drawing.
  {
    const rows = [-ix, -1.8, 1.8, ix];
    const pileFoot = -2.6;
    const pileTop = 0.2;
    const outerZ = [-iz, -iz / 2, 0, iz / 2, iz];
    for (const x of rows) {
      b.box(0.3, 0.3, d, x, 0.325, 0, TIMBER);
      for (const z of Math.abs(x) > 3 ? outerZ : [-iz, 0, iz]) {
        b.cyl(pileTop - pileFoot, 0.3, 0.34, 7, x, (pileTop + pileFoot) / 2, z, TIMBER);
      }
    }
    const y0 = 0.05;
    const y1 = -1.5;
    const cross = (s: Side, plane: number, us: number[]): void => {
      for (let i = 0; i + 1 < us.length; i++) {
        const du = us[i + 1] - us[i];
        const len = Math.hypot(du, y0 - y1);
        const a = Math.atan2(y0 - y1, du);
        const um = (us[i] + us[i + 1]) / 2;
        onFace(b, s, plane, um, (y0 + y1) / 2, len, 0.13, 0.06, 0, TIMBER, a);
        onFace(b, s, plane + 0.07, um, (y0 + y1) / 2, len, 0.13, 0.06, 0, TIMBER, -a);
      }
    };
    for (const s of ["-x", "+x"] as const) cross(s, ix + 0.2, outerZ);
    for (const s of ["-z", "+z"] as const) cross(s, iz + 0.2, rows);
    // The two dolphins off the open corners, with their rings.
    for (const sz of [-1, 1]) {
      const x = gx + 0.55;
      const z = sz * (gz + 0.3);
      const top = F + 1.0;
      b.cyl(top - pileFoot, 0.32, 0.36, 7, x, (top + pileFoot) / 2, z, TIMBER);
      b.cyl(0.08, 0.37, 0.37, 7, x, top + 0.02, z, IRON);
      b.cyl(0.16, 0.38, 0.38, 7, x, F + 0.5, z, SAILCLOTH);
      b.box(0.04, 0.22, 0.22, x - 0.19, F + 0.2, z, IRON);
    }
  }

  // ------------------------------------------------------------ the boat
  //
  // An open clinker double-ender on three keel blocks and four shores along
  // the solid side. A hull section at station `s` (-1..1, stem to stem) is a
  // quarter ellipse from the keel (`th` 0) to the sheer (`th` pi/2), and every
  // strake is a thin solid between two stations, laid a little OUTSIDE the one
  // below with its lower edge lapping it. That lap is the land, and it is
  // what the ink draws a clinker boat by.
  {
    const bx = -2.95;
    const bz = -0.5;
    const L = 7.0;
    const B = 0.92;
    const yk = F + 0.42;
    const D = 0.76;
    const N = 12;
    const half = (s: number): number => B * Math.pow(Math.max(0, 1 - s * s), 0.62);
    const keel = (s: number): number => yk + 0.34 * s ** 4;
    const sheer = (s: number): number => yk + D + 0.26 * s * s;
    const zOf = (s: number): number => bz + (s * L) / 2;
    const station = (j: number): number => -1 + (2 * j) / N;
    /** A point on the hull, `o` out from the skin along the section's normal. */
    const pt = (s: number, th: number, o: number, sx: number, dz = 0): Point3 => {
      const hb = half(s);
      const k0 = keel(s);
      const g = sheer(s);
      const nx = (g - k0) * Math.sin(th);
      const ny = -hb * Math.cos(th);
      const nl = Math.hypot(nx, ny) || 1;
      return [bx + sx * (hb * Math.sin(th) + (o * nx) / nl), k0 + (g - k0) * (1 - Math.cos(th)) + (o * ny) / nl, zOf(s) + dz];
    };
    /** The half-breadth inside the skin at height `y` above station `s`. */
    const breadthAt = (s: number, y: number): number => {
      const c = 1 - (y - keel(s)) / (sheer(s) - keel(s));
      return half(s) * Math.sin(Math.acos(Math.min(1, Math.max(-1, c))));
    };

    const TH = [0, 0.4, 0.8, 1.19, Math.PI / 2];
    const PLY = 0.035;
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const o = i * 0.02;
        const a = i === 0 ? 0 : TH[i] - 0.06;
        const c = TH[i + 1];
        for (let j = 0; j < N; j++) {
          const sec = (s: number): Point3[] => [pt(s, a, o, sx), pt(s, a, o + PLY, sx), pt(s, c, o + PLY, sx), pt(s, c, o, sx)];
          convexSolid(b, sec(station(j)), sec(station(j + 1)), i === 3 ? WEATHERBOARD : PITCH);
        }
      }
      // The gunwale over the sheer strake.
      for (let j = 0; j < N; j++) {
        const sec = (s: number): Point3[] => {
          const x = half(s);
          const g = sheer(s);
          return [
            [bx + sx * (x - 0.05), g - 0.06, zOf(s)],
            [bx + sx * (x + 0.13), g - 0.06, zOf(s)],
            [bx + sx * (x + 0.13), g + 0.04, zOf(s)],
            [bx + sx * (x - 0.05), g + 0.04, zOf(s)],
          ];
        };
        convexSolid(b, sec(station(j)), sec(station(j + 1)), TIMBER);
      }
      // A rib at every station, stepped with the strakes it lies against.
      for (let j = 1; j < N; j++) {
        const s = station(j);
        for (let i = 0; i < 4; i++) {
          const a = TH[i] + (i === 0 ? 0.08 : 0);
          const c = TH[i + 1] - (i === 3 ? 0.06 : 0);
          const o = i * 0.02;
          const sec = (dz: number): Point3[] => [pt(s, a, o, sx, dz), pt(s, c, o, sx, dz), pt(s, c, o - 0.045, sx, dz), pt(s, a, o - 0.045, sx, dz)];
          convexSolid(b, sec(-0.03), sec(0.03), TIMBER);
        }
      }
    }
    // The keel, following the rocker up into both stems, and the stem posts.
    for (let j = 0; j < N; j++) {
      const sec = (s: number): Point3[] => [
        [bx - 0.05, keel(s) - 0.1, zOf(s)],
        [bx + 0.05, keel(s) - 0.1, zOf(s)],
        [bx + 0.05, keel(s) + 0.02, zOf(s)],
        [bx - 0.05, keel(s) + 0.02, zOf(s)],
      ];
      convexSolid(b, sec(station(j)), sec(station(j + 1)), TIMBER);
    }
    for (const se of [-1, 1]) {
      const y0 = keel(se) - 0.1;
      const y1 = sheer(se) + 0.2;
      b.box(0.1, y1 - y0, 0.14, bx, (y0 + y1) / 2, zOf(se) + se * 0.04, TIMBER);
    }
    // Thwarts, bottom boards, and the oars laid along the thwarts.
    for (const s of [-0.5, 0.05, 0.5]) {
      const y = sheer(s) - 0.22;
      b.box(2 * breadthAt(s, y) + 0.02, 0.05, 0.24, bx, y, zOf(s), TIMBER);
    }
    for (let j = 2; j < N - 2; j++) {
      const s0 = station(j);
      const s1 = station(j + 1);
      const y = keel(0) + 0.16;
      const wd = 2 * Math.min(breadthAt(s0, y), breadthAt(s1, y)) - 0.06;
      if (wd > 0.2) b.box(wd, 0.03, zOf(s1) - zOf(s0) - 0.02, bx, y, (zOf(s0) + zOf(s1)) / 2, PLANK);
    }
    const oarY = sheer(0.05) - 0.22 + 0.055;
    for (const [ox, dir] of [
      [-0.24, 1],
      [0.24, -1],
    ] as const) {
      b.cyl(2.8, 0.06, 0.06, 6, bx + ox, oarY, bz + dir * 0.1, PLANK, { x: Math.PI / 2 });
      b.box(0.15, 0.025, 0.75, bx + ox, oarY, bz + dir * 1.85, PLANK);
    }
    // The cradle: crossed timbers under the keel, and a shore to each bilge.
    for (const s of [-0.55, 0, 0.55]) {
      const top = keel(s) - 0.1;
      const hh = (top - F) / 2;
      b.box(0.55, hh, 0.26, bx, F + hh / 2, zOf(s), TIMBER);
      b.box(0.26, hh, 0.55, bx, F + hh * 1.5, zOf(s), TIMBER);
    }
    for (const s of [-0.35, 0.35]) {
      for (const sx of [-1, 1]) {
        const [tx, ty, tz] = pt(s, 1.0, 0.05, sx);
        const fx = bx + sx * (half(s) * 0.84 + 0.25);
        const dx = tx - fx;
        const dy = ty - F;
        b.box(0.08, Math.hypot(dx, dy), 0.08, (fx + tx) / 2, (F + ty) / 2, tz, TIMBER, { z: Math.atan2(-dx, dy) });
        b.box(0.18, 0.06, 0.1, fx, F + 0.03, tz, TIMBER);
      }
    }
    // Its colliders: the waist, and a narrower box at each end.
    const top = sheer(0) + 0.08 - F;
    b.block({ w: 2 * B + 0.2, h: top, d: 4.6, x: bx, y: F + top / 2, z: bz });
    for (const sz of [-1, 1]) b.block({ w: 1.4, h: top + 0.2, d: 1.25, x: bx, y: F + (top + 0.2) / 2, z: bz + sz * 2.925 });
  }

  // ---- the bench along the boat door's wall, its tools on the wall over
  // it, and the things left about.
  {
    const x0 = -5.2;
    const x1 = -2.9;
    const z0 = -iz;
    const z1 = -5.7;
    const top = F + 0.88;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    b.block({ w: x1 - x0, h: top - F, d: z1 - z0, x: cx, y: (F + top) / 2, z: cz });
    b.box(x1 - x0 + 0.1, 0.08, z1 - z0 + 0.04, cx, top - 0.04, cz + 0.02, PLANK);
    for (const xl of [x0 + 0.1, x1 - 0.1]) {
      for (const zl of [z0 + 0.1, z1 - 0.08]) b.box(0.1, top - 0.08 - F, 0.1, xl, (F + top - 0.08) / 2, zl, TIMBER);
    }
    b.box(x1 - x0 - 0.1, 0.04, z1 - z0 - 0.1, cx, F + 0.2, cz, PLANK);
    b.box(x1 - x0, 0.12, 0.05, cx, top - 0.16, z1 + 0.02, TIMBER);
    // A leg vice at the end, its screw and bar.
    b.box(0.14, 0.82, 0.07, x1 - 0.3, F + 0.46, z1 + 0.08, TIMBER);
    b.cyl(0.24, 0.06, 0.06, 6, x1 - 0.3, top - 0.18, z1 + 0.12, IRON, { x: Math.PI / 2 });
    b.box(0.34, 0.03, 0.03, x1 - 0.3, top - 0.18, z1 + 0.22, IRON);
    // A tar pot on the shelf, a plane and a mallet on the top.
    b.cyl(0.26, 0.28, 0.24, 8, x0 + 0.45, F + 0.35, cz, PITCH);
    b.box(0.3, 0.01, 0.02, x0 + 0.45, F + 0.52, cz, IRON, { z: 0.4 });
    b.box(0.3, 0.1, 0.08, cx - 0.2, top + 0.05, cz, TIMBER, { y: 0.3 });
    b.box(0.14, 0.12, 0.1, cx + 0.5, top + 0.06, cz - 0.05, TIMBER);
    b.box(0.3, 0.03, 0.03, cx + 0.72, top + 0.03, cz, TIMBER, { y: -0.2 });
    // Tools on the wall: a saw, a brace, an adze, and a coil of line on a peg.
    onFace(b, "+z", -iz, x0 + 0.55, 2.35, 0.62, 0.2, 0.012, 0.03, IRON);
    onFace(b, "+z", -iz, x0 + 0.16, 2.36, 0.16, 0.13, 0.04, 0.04, TIMBER);
    onFace(b, "+z", -iz, cx + 0.15, 2.3, 0.04, 0.5, 0.03, 0.04, IRON);
    onFace(b, "+z", -iz, cx + 0.15, 2.3, 0.3, 0.04, 0.03, 0.05, IRON);
    onFace(b, "+z", -iz, cx + 0.7, 2.25, 0.05, 0.6, 0.04, 0.04, TIMBER);
    onFace(b, "+z", -iz, cx + 0.7, 2.57, 0.2, 0.06, 0.08, 0.06, IRON);
    b.cyl(0.08, 0.5, 0.5, 10, x1 - 0.2, 2.45, -iz + 0.06, SAILCLOTH, { x: Math.PI / 2 });
    b.cyl(0.09, 0.22, 0.22, 8, x1 - 0.2, 2.45, -iz + 0.06, CASEMENT, { x: Math.PI / 2 });
  }
  // A rack of oars on the solid wall over the windows.
  for (const y of [3.4, 3.66]) {
    b.cyl(3.4, 0.055, 0.055, 6, -ix + 0.1, y, -1.2, PLANK, { x: Math.PI / 2 });
    b.box(0.025, 0.14, 0.7, -ix + 0.1, y, y > 3.5 ? 0.55 : -2.95, PLANK);
  }
  for (const z of [-3.6, -1.2, 1.2]) b.box(0.22, 0.05, 0.05, -ix + 0.09, 3.33, z, TIMBER);
  // A coil of rope by the open side, and an anchor stood in the far corner.
  b.cyl(0.14, 0.72, 0.76, 12, 4.4, F + 0.07, -5.0, SAILCLOTH);
  b.cyl(0.16, 0.26, 0.26, 8, 4.4, F + 0.07, -5.0, CASEMENT);
  {
    const ax = -4.95;
    const az = iz - 0.35;
    b.box(0.08, 1.4, 0.08, ax, F + 0.7, az, IRON, { x: 0.18 });
    b.box(0.9, 0.07, 0.07, ax, F + 1.28, az + 0.1, TIMBER);
    for (const kk of [-1, 1]) b.box(0.07, 0.45, 0.07, ax + kk * 0.22, F + 0.2, az - 0.09, IRON, { z: kk * 0.9 });
  }

  return b;
}
