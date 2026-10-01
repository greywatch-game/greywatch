/**
 * kit/buildings/barn.ts — buildBarn: the open timber barn with a hayloft
 * reached by a ramp.
 * Part of the buildings set: follows the contract in kit/core.ts; the set's
 * files are listed in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type Structure,
  DARK_STONE,
  FLAME,
  GUARD_THICKNESS,
  IRON,
  PLANK,
  THATCH,
  TIMBER,
} from "../core";

/**
 * The barn: a big open timber shed with a hayloft platform reachable by an
 * external ramp. Holds flag D and is the map's main piece of verticality —
 * "the map's best perch and the ramp to it is exposed", per the layout's own
 * design intent, which only means anything if the perch can be reached.
 *
 * Five things here are load-bearing rather than decorative, and every one of
 * them is what the ramp needed to stop being a dead end you could walk up and
 * nothing more:
 *
 * - **The east wall is built AROUND the loft opening** — two jambs, a sill and
 *   a lintel — not as one full-height slab with a plank glued on where a door
 *   should be. `b.wall` emits a collider, so a solid wall is solid at the loft
 *   whatever is drawn on it.
 * - **The sill's top face IS the threshold.** It stands flush with both the
 *   loft floor and the deck outside, so `NavGrid` finds one continuous height
 *   through the opening: `severLinks` spares a box standing no more than
 *   `stepHeight` above the higher end of a link, which is exactly what a flush
 *   sill is.
 * - **The ramp lands on a level deck, not on the doorway.** A pitched
 *   collider's top face is a different height on each side of a threshold, and
 *   the deck is what gives the ramp and the loft one flat surface to meet on.
 * - **The pitch is derived from the RUN and the slab is cut to the SLOPE.**
 *   Those are not the same number, and conflating them (`pitch =
 *   atan2(rise, slabLength)`) is what left the old ramp 0.3 m short of the
 *   loft and 1.5 m past the barn's north end. `stepHeight` (0.6) over
 *   `cellSize` (1.5) also caps the gradient at 0.4 — a steeper ramp severs
 *   itself from its own top and is walkable by the player and invisible to
 *   every bot.
 * - **The ramp runs on past the ground rather than stopping level with the
 *   barn's own floor** — see `rampDrop`, which is what makes it meet the
 *   terrain whatever `y` the placement carries.
 *
 * **The sixth is about the DRAWING rather than the route, and it is the one a
 * new piece of this building is most likely to get wrong.** This shed is 16 m
 * by 22 m by 8 m and almost every square metre of it is wall, so what breaks
 * those elevations up is a frame laid ON them — and an applied member is
 * bedded on the wall's FACE, never centred in it. The corner posts were 0.3 m
 * boxes at `x = ±w / 2`, which is the middle of a 0.4 m wall: the boarding
 * closed over all fourteen of them, and what a player walked up to was 22 m of
 * one flat colour with a door in it. Everything under "the frame" below stands
 * `frameT / 2` proud of the boards, the battens behind it stand less, and the
 * two layers read in that order wherever the ink is still drawing a line.
 */
export function buildBarn(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "barn");
  const w = 16;
  const d = 22;
  const h = 8;
  const t = 0.4;

  // The loft is what the rest of the building is dimensioned against.
  /** Walkable height of the hayloft — the surface, not the slab's centre. */
  const loftTop = 4.2;
  const loftT = 0.3;
  const loftD = d / 3;
  /** Flush with the north wall's inner face, so the hay door opens onto it. */
  const loftZ = d / 2 - t / 2 - loftD / 2;

  // The loft doorway in the east wall, and the deck the ramp lands on.
  const doorW = 3.2;
  const doorH = 2.4;
  const doorS = loftZ - doorW / 2;
  const doorN = loftZ + doorW / 2;
  const deckW = 3.4;
  const deckD = doorW + 1.2;
  const deckX = w / 2 + t / 2 + deckW / 2;
  /** The deck's south edge — where the ramp arrives. */
  const deckS = loftZ - deckD / 2;

  /** The cart doorway through each gable end. */
  const cartW = 4.5;
  const cartH = 5;
  /** What the north one becomes above the loft floor — see below. */
  const hayH = loftTop + doorH;
  /** The rise `gableRoof` is given, and the eaves overhang with it. */
  const roofRise = 3.4;
  const eaves = 0.6;

  b.box(w, 0.2, d, 0, 0.1, 0, PLANK);
  b.doorWall(w, h, t, 0, h / 2, -d / 2, PLANK, cartW, cartH);
  // The north cart door runs up PAST the loft floor, which is what turns its
  // upper half into a hay door: the perch's whole value is the sightline over
  // the paddocks, and a wall at the loft's north edge is a room with a view of
  // planks.
  b.doorWall(w, h, t, 0, h / 2, d / 2, PLANK, cartW, hayH);
  b.wall(t, h, d, -w / 2, h / 2, 0, PLANK);

  // East wall, in four pieces around the loft doorway.
  const jambS = doorS + d / 2;
  b.wall(t, h, jambS, w / 2, h / 2, doorS - jambS / 2, PLANK);
  const jambN = d / 2 - doorN;
  b.wall(t, h, jambN, w / 2, h / 2, doorN + jambN / 2, PLANK);
  b.wall(t, loftTop, doorW, w / 2, loftTop / 2, loftZ, PLANK);
  const lintel = h - loftTop - doorH;
  b.wall(t, lintel, doorW, w / 2, h - lintel / 2, loftZ, PLANK);
  // Frame, so the opening reads as a door rather than as missing wall.
  for (const sz of [-1, 1]) {
    const z = loftZ + sz * (doorW / 2 - 0.08);
    b.box(t + 0.14, doorH, 0.16, w / 2, loftTop + doorH / 2, z, TIMBER);
  }
  b.box(t + 0.14, 0.16, doorW, w / 2, loftTop + doorH - 0.08, loftZ, TIMBER);

  // ------------------------------------------------------------- the frame
  //
  // Read the header's sixth bullet before moving anything here: every member
  // below is bedded on a wall FACE, and one centred in the wall instead is one
  // the boarding swallows whole.
  /** The outer faces the applied frame is laid on. */
  const faceX = w / 2 + t / 2;
  const faceZ = d / 2 + t / 2;
  /** A framing member's thickness — half of it proud of the boards. */
  const frameT = 0.2;
  /** A batten's, which is less, so the frame reads as the layer on top. */
  const battenT = 0.14;
  const plinthH = 0.55;
  const sillY = plinthH + 0.2;
  const plateY = h - 0.24;
  /**
   * Board widths, cycled with the index. World building may never call
   * `Math.random()` — the nav graph would differ between page loads — and an
   * exact rhythm reads as a fence rather than as boarding, so the only
   * irregularity a builder is allowed is a short list walked in order.
   */
  const BOARDS = [1.02, 0.84, 1.16, 0.93, 1.08, 0.88];

  // Stone footing, cut at both cart doorways rather than run through them: a
  // cart drives in over that threshold, and a course laid across it draws a
  // step the ground probe says is not there.
  for (const sx of [-1, 1]) {
    b.box(0.6, plinthH, d + 0.6, sx * (w / 2 + 0.1), plinthH / 2, 0, DARK_STONE);
  }
  const footing = (w + 0.6 - cartW) / 2;
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const x = (sx * (cartW + footing)) / 2;
      b.box(footing, plinthH, 0.6, x, plinthH / 2, sz * (d / 2 + 0.1), DARK_STONE);
    }
  }

  /** Post centres along the long walls; six bays of 3.6 m between them. */
  const bays = 6;
  const postZ: number[] = [];
  for (let i = 0; i <= bays; i++) postZ.push(-d / 2 + 0.2 + (i * (d - 0.4)) / bays);
  /** Whether a post, a brace or a batten is clear of the loft doorway. */
  const clearOfLoftDoor = (sx: number, z: number): boolean =>
    sx < 0 || Math.abs(z - loftZ) > doorW / 2 + 0.3;

  for (const sx of [-1, 1]) {
    // Posts, outside and in. The inner run is what the shed is read as from
    // the floor, where the only timber used to be the loft's own joists.
    for (const z of postZ) {
      if (!clearOfLoftDoor(sx, z)) continue;
      const tall = h - plinthH;
      b.box(frameT, tall, 0.34, sx * faceX, plinthH + tall / 2, z, TIMBER);
      b.box(0.28, tall, 0.34, sx * (w / 2 - t / 2), plinthH + tall / 2, z, TIMBER);
    }

    // Sill, mid girt and wall plate. The girt runs at the loft floor's own
    // height, so on the east it stops either side of the doorway — a beam
    // across that opening is drawn where the threshold has to stay flush.
    b.box(frameT, 0.3, d, sx * faceX, sillY, 0, TIMBER);
    b.box(frameT, 0.3, d, sx * faceX, plateY, 0, TIMBER);
    const girts: [number, number][] =
      sx > 0
        ? [
            [-d / 2, doorS - 0.1],
            [doorN + 0.1, d / 2],
          ]
        : [[-d / 2, d / 2]];
    for (const [zA, zB] of girts) {
      b.box(frameT, 0.28, zB - zA, sx * faceX, loftTop, (zA + zB) / 2, TIMBER);
      b.box(0.28, 0.3, zB - zA, sx * (w / 2 - t / 2), loftTop, (zA + zB) / 2, TIMBER);
    }

    // One long brace per bay, alternating: the zigzag is what tells the eye
    // this is a frame with boards on it rather than a stripe painted on a slab.
    for (let i = 0; i < bays; i++) {
      const zA = postZ[i];
      const zB = postZ[i + 1];
      if (!clearOfLoftDoor(sx, (zA + zB) / 2)) continue;
      const yA = sillY + 0.2;
      const yB = loftTop - 0.18;
      const angle = Math.atan2(yB - yA, zB - zA);
      const up = i % 2 === 0 ? 1 : -1;
      b.box(
        frameT - 0.04,
        0.24,
        Math.hypot(zB - zA, yB - yA),
        sx * faceX,
        (yA + yB) / 2,
        (zA + zB) / 2,
        TIMBER,
        { x: up > 0 ? -angle : angle },
      );
    }

    // Board-and-batten over the whole elevation. At the loft door the run
    // breaks above and below the opening rather than skipping the column, or
    // the one stretch of this wall a player stands against is the blank one.
    let z = -d / 2 + 0.45;
    let i = 0;
    while (z < d / 2 - 0.3) {
      const onPost = postZ.some((p) => Math.abs(p - z) < 0.36);
      if (!onPost) {
        if (clearOfLoftDoor(sx, z)) {
          b.box(battenT, plateY - sillY, 0.15, sx * faceX, (sillY + plateY) / 2, z, TIMBER);
        } else {
          b.box(battenT, loftTop - sillY, 0.15, sx * faceX, (sillY + loftTop) / 2, z, TIMBER);
          b.box(battenT, plateY - hayH, 0.15, sx * faceX, (hayH + plateY) / 2, z, TIMBER);
        }
      }
      z += BOARDS[i % BOARDS.length];
      i++;
    }

    // A shuttered vent in every other bay, up in the band between the girt and
    // the plate where there is nothing else at all. The dark is IRON and not a
    // hole: the wall is a collider and a round has to stop on it, so a vent
    // that let light through would be a window that shoots like a wall.
    for (let bay = 0; bay < bays; bay += 2) {
      const zc = (postZ[bay] + postZ[bay + 1]) / 2;
      if (!clearOfLoftDoor(sx, zc)) continue;
      const ventY = (loftTop + plateY) / 2;
      b.box(0.08, 0.66, 1.1, sx * (faceX + 0.02), ventY, zc, IRON);
      for (const k of [-1, 1]) {
        b.box(0.18, 0.14, 1.36, sx * faceX, ventY + k * 0.42, zc, TIMBER);
        b.box(0.14, 0.09, 1.1, sx * (faceX + 0.03), ventY + k * 0.17, zc, TIMBER);
      }
    }
  }

  /**
   * One gable end: the cart doorway's own frame, the boarding over the wall,
   * and the triangle above the eaves — which is the biggest single face on
   * this building and was, until now, one flat panel 17 m across.
   */
  const gableEndFrame = (sz: 1 | -1, gapH: number, hoist: boolean): void => {
    const zf = sz * faceZ;
    // Heavy jambs round the doorway, and a corner post at each end.
    for (const sx of [-1, 1]) {
      b.box(0.34, gapH + 0.3, frameT, sx * (cartW / 2 + 0.17), (gapH + 0.3) / 2, zf, TIMBER);
      const tall = h - plinthH;
      b.box(0.34, tall, frameT, sx * (w / 2 - 0.17), plinthH + tall / 2, zf, TIMBER);
    }
    b.box(cartW + 0.68, 0.3, frameT, 0, gapH + 0.15, zf, TIMBER);
    // Sill and girt, in the two runs outboard of the opening.
    const run = w / 2 - cartW / 2;
    for (const sx of [-1, 1]) {
      const x = sx * (cartW / 2 + run / 2);
      b.box(run, 0.28, frameT, x, sillY, zf, TIMBER);
      b.box(run, 0.26, frameT, x, loftTop, zf, TIMBER);
    }
    b.box(w - 0.3, 0.3, frameT, 0, plateY, zf, TIMBER);
    // Knee braces into the plate, which is what stops the head of this wall
    // reading as a line ruled across it.
    for (const sx of [-1, 1]) {
      const angle = Math.atan2(1.45, 1.6);
      b.box(
        Math.hypot(1.6, 1.45),
        0.22,
        frameT - 0.04,
        sx * (w / 2 - 1.1),
        plateY - 0.85,
        zf,
        TIMBER,
        { z: -sx * angle },
      );
    }

    // Boarding: full height outboard of the doorway, and over its head inside.
    let x = -w / 2 + 0.5;
    let i = 0;
    while (x < w / 2 - 0.4) {
      const onPost =
        Math.abs(Math.abs(x) - (cartW / 2 + 0.17)) < 0.36 ||
        Math.abs(Math.abs(x) - (w / 2 - 0.17)) < 0.36;
      if (!onPost) {
        if (Math.abs(x) > cartW / 2 + 0.34) {
          b.box(0.15, plateY - sillY, battenT, x, (sillY + plateY) / 2, zf, TIMBER);
        } else if (plateY - gapH > 1.2) {
          b.box(0.15, plateY - gapH - 0.4, battenT, x, (gapH + 0.4 + plateY) / 2, zf, TIMBER);
        }
      }
      x += BOARDS[i % BOARDS.length];
      i++;
    }

    // The triangle. Its panel is `gableRoof`'s, and that sits 0.12 m inboard
    // of the wall face, so everything applied to it is placed off the PANEL
    // and never off `faceZ` — see `gableEnd`.
    const zg = sz * (d / 2 + 0.12);
    const slope = w / 2 + eaves;
    b.box(w - 0.6, 0.26, 0.16, 0, h + 0.15, zg, TIMBER);
    for (const sx of [-1, 1]) {
      const angle = Math.atan2(2.0, 3.9);
      b.box(Math.hypot(3.9, 2.0), 0.22, 0.16, sx * 3.05, h + 1.3, zg, TIMBER, {
        z: -sx * angle,
      });
    }
    // The owl hole, louvred like the wall vents below it — but only on the
    // end that does not carry the hoist, whose beam comes out of the apex
    // through exactly this square.
    if (!hoist) {
      b.box(1.24, 0.9, 0.1, 0, h + 1.5, sz * (d / 2 + 0.16), IRON);
      for (const k of [-1, 1]) {
        b.box(1.5, 0.14, 0.18, 0, h + 1.5 + k * 0.52, zg, TIMBER);
        b.box(1.24, 0.09, 0.14, 0, h + 1.5 + k * 0.22, sz * (d / 2 + 0.18), TIMBER);
      }
    }
    for (let bx = -6.9; bx < 7.0; bx += 1.15) {
      if (Math.abs(bx) < 0.95) continue;
      const tall = roofRise * (1 - Math.abs(bx) / slope) - 0.25;
      if (tall < 0.5) continue;
      b.box(0.15, tall, battenT, bx, h + 0.25 + tall / 2, zg, TIMBER);
    }
  };
  gableEndFrame(-1, cartH, false);
  gableEndFrame(1, hayH, true);

  // One leaf of the south cart door, run back flat against the boarding. One
  // side only: a pair of them shut is a wall again, and the asymmetry is most
  // of what stops this end reading as the north end mirrored.
  const leafH = cartH - 0.25;
  const leafX = -(cartW / 2 + 1.15);
  const leafZ = -(faceZ + 0.16);
  b.box(2.1, leafH, 0.1, leafX, leafH / 2, leafZ, PLANK);
  for (const k of [0, 1, 2]) {
    b.box(2.2, 0.26, 0.12, leafX, 0.5 + (k * (leafH - 1.0)) / 2, leafZ - 0.11, TIMBER);
  }
  b.box(Math.hypot(2.1, leafH - 1.0), 0.22, 0.1, leafX, leafH / 2, leafZ - 0.11, TIMBER, {
    z: Math.atan2(leafH - 1.0, 2.1),
  });
  // Its ironwork: the strap hinges it is still hanging on.
  for (const k of [0, 2]) {
    b.box(1.5, 0.12, 0.06, leafX + 0.6, 0.5 + (k * (leafH - 1.0)) / 2, leafZ - 0.18, IRON);
  }

  b.gableRoof(w, d, roofRise, 0, h, 0, PLANK, eaves);

  // -------------------------------------------------------------- the roof
  //
  // 200 m2 of it in two slabs, and the eaves are what most of a map sees this
  // building against. The battens and the rafter tails are the walls' argument
  // again: one plane is one tone whatever the light is doing to it.
  const slope = w / 2 + eaves;
  const pitch = Math.atan2(roofRise, slope);
  const slabLen = Math.hypot(slope, roofRise);
  for (const sx of [-1, 1]) {
    for (let z = -(d / 2 + 0.35); z <= d / 2 + 0.4; z += 1.9) {
      // On the slab's own plane: its 0.09 of half-thickness, plus the batten's.
      const off = 0.125;
      b.box(
        slabLen,
        0.07,
        0.16,
        sx * (slope / 2 + off * Math.sin(pitch)),
        h + roofRise / 2 + off * Math.cos(pitch),
        z,
        TIMBER,
        { z: -sx * pitch },
      );
      // The rafter under it, showing where it crosses the wall plate.
      b.box(1.5, 0.15, 0.17, sx * (w / 2 - 0.05), h + 0.06, z, TIMBER, { z: -sx * pitch });
    }
    // Fascia along the eaves.
    b.box(0.16, 0.36, d + 1.3, sx * (slope + 0.06), h - 0.16, 0, TIMBER);
  }
  b.box(0.5, 0.2, d + 1.3, 0, h + roofRise + 0.05, 0, TIMBER); // ridge cap

  // The ridge vent, which is this building's silhouette from anywhere on the
  // map. Built by hand rather than with `gableRoof`: that emits a collider,
  // and a collider 13 m in the air is a standable surface nothing can reach
  // and a slot out of `maxSurfaces` in every cell underneath it.
  const cupZ = -d / 4;
  const ridgeY = h + roofRise;
  b.box(1.9, 0.3, 1.9, 0, ridgeY + 0.15, cupZ, PLANK);
  b.box(1.5, 1.2, 1.5, 0, ridgeY + 0.9, cupZ, IRON);
  for (const k of [0, 1, 2]) {
    b.box(1.66, 0.12, 1.66, 0, ridgeY + 0.5 + k * 0.4, cupZ, TIMBER);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.16, 1.3, 0.16, sx * 0.76, ridgeY + 0.95, cupZ + sz * 0.76, TIMBER);
    }
  }
  const capPitch = Math.atan2(0.5, 1.15);
  for (const sx of [-1, 1]) {
    b.box(1.3, 0.1, 2.3, sx * 0.58, ridgeY + 1.85, cupZ, PLANK, { z: -sx * capPitch });
  }
  b.cyl(1.1, 0.07, 0.07, 6, 0, ridgeY + 2.6, cupZ, IRON);
  b.box(1.3, 0.09, 0.05, 0.1, ridgeY + 3.05, cupZ, IRON, { y: 0.5 });
  b.box(0.36, 0.34, 0.04, -0.45, ridgeY + 3.05, cupZ - 0.24, IRON, { y: 0.5 });

  // The hoist over the hay door: the beam is what a loft is LOADED through,
  // and it is the one piece of this building that breaks its own outline.
  const hoistY = h + 1.35;
  b.box(0.26, 0.26, 2.8, 0, hoistY, d / 2 + 0.8, TIMBER);
  b.box(0.34, 0.34, 0.34, 0, hoistY - 0.3, d / 2 + 1.85, IRON);
  b.cyl(0.1, 0.44, 0.44, 8, 0, hoistY - 0.55, d / 2 + 1.85, IRON, { z: Math.PI / 2 });
  b.box(0.06, 1.5, 0.06, 0, hoistY - 1.35, d / 2 + 1.85, IRON);
  b.box(0.1, 0.28, 0.26, 0, hoistY - 2.15, d / 2 + 1.85, IRON);

  // A pentice over the south doorway. It shelters that threshold, which the
  // wear bake reads for itself — a vertex steps along its own normal and is
  // clean if a collider stands over that spot — so the boards under this hood
  // come out dry and the rest of the elevation does not.
  const hoodY = cartH + 0.6;
  b.box(cartW + 1.8, 0.14, 1.6, 0, hoodY, -(faceZ + 0.75), PLANK, { x: -0.22 });
  b.box(cartW + 1.8, 0.16, 0.18, 0, hoodY - 0.17, -(faceZ + 1.5), TIMBER);
  for (const sx of [-1, 1]) {
    b.box(0.16, 0.2, 1.3, sx * (cartW / 2 + 0.55), hoodY - 0.72, -(faceZ + 0.5), TIMBER, {
      x: Math.PI / 4,
    });
  }

  // Hayloft: a solid floor over the north third, walkable from the ramp.
  b.box(w - t * 2, loftT, loftD, 0, loftTop - loftT / 2, loftZ, PLANK);
  b.block({
    w: w - t * 2,
    h: loftT,
    d: loftD,
    x: 0,
    y: loftTop - loftT / 2,
    z: loftZ,
  });
  for (let i = -2; i <= 2; i++) {
    const z = loftZ + (i * loftD) / 5;
    b.box(w - t * 2, 0.22, 0.22, 0, loftTop - loftT - 0.11, z, TIMBER); // joist
  }
  // The south edge's lip is VISUAL ONLY, deliberately: the drop into the barn
  // is the loft's second exit and the thing you shoot down through. A collider
  // here is a rail you can neither step off nor fire over.
  b.box(w - t * 2, 0.5, 0.2, 0, loftTop + 0.25, loftZ - loftD / 2, TIMBER);
  // Loose hay. Flat pads rather than bales: anything up here tall enough to
  // read as cover has to be a collider, and a bale's top face would be a
  // standable surface 0.9 m clear of the floor that nothing can link to.
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 2.4);
    b.box(2.6, 0.14, 2.2, x, loftTop + 0.07, loftZ + loftD / 2 - 1.4, THATCH);
  }

  // --------------------------------------------------------- the shed floor
  //
  // Two tie beams and the fittings under them. The beams are DRAWN and nothing
  // else: `strut` would stop rounds on them, and a 0.3 m timber 6.6 m up is
  // exactly the geometry `NavGrid` and every ray in the game are better off
  // never hearing about.
  for (const z of [-7.4, -1.6]) {
    b.box(w - t * 2 - 0.2, 0.3, 0.28, 0, 6.6, z, TIMBER);
    for (const sx of [-1, 1]) {
      const angle = Math.atan2(1.0, 1.2);
      b.box(Math.hypot(1.2, 1.0), 0.2, 0.24, sx * (w / 2 - t - 0.75), 6.05, z, TIMBER, {
        z: -sx * angle,
      });
    }
  }
  // A lantern hung off the south tie, which is the one thing this shed was
  // missing to be read from the doorway at all: the loft's own lamp is on the
  // far side of a solid floor and lights nothing under it, so a player who
  // walked in was looking at an unlit box with a cart in it.
  const shedLampY = 4.6;
  b.box(0.06, 1.7, 0.06, -3, shedLampY + 1.1, -1.6, IRON);
  b.cyl(0.66, 0.44, 0.32, 6, -3, shedLampY, -1.6, IRON);
  b.glow(0.32, 0.32, 0.32, -3, shedLampY, -1.6, FLAME);
  b.cyl(0.18, 0.1, 0.52, 6, -3, shedLampY + 0.42, -1.6, IRON);
  b.light(FLAME, 20, 1.8, 0.3, -3, shedLampY, -1.6);

  // Mangers down the west wall, in two runs with the gap a barn keeps between
  // them. Chest high and solid, so the open half of this shed finally has
  // something in it to fight from — the loft's drop covers the north end and
  // this covers the south. They stand in cells holding the ground and the roof
  // slab and nothing else, so each one is the third surface rather than a
  // fourth that `addSurface` would drop on the floor.
  const mangerD = 0.75;
  const mangerX = -(w / 2 - t / 2 - mangerD / 2);
  const mangerRuns: [number, number][] = [
    [-9.6, -5.2],
    [-4.0, 0.6],
  ];
  for (const [zA, zB] of mangerRuns) {
    const len = zB - zA;
    const zc = (zA + zB) / 2;
    b.wall(mangerD, 0.9, len, mangerX, 0.45, zc, PLANK);
    b.box(mangerD + 0.18, 0.14, len, mangerX + 0.06, 0.97, zc, TIMBER);
    // The rack over it, and the feed behind the slats.
    b.box(0.14, 0.9, len, mangerX - mangerD / 2 + 0.3, 1.5, zc, THATCH);
    for (let z = zA + 0.35; z < zB - 0.2; z += 0.55) {
      b.box(0.5, 0.1, 0.1, mangerX - 0.12, 1.5, z, TIMBER, { z: 0.5 });
    }
  }
  // A stack of bales in the south-east corner. On the FLOOR a bale may be a
  // collider — it is cover, and one box stands in for the stack, where the
  // same four boxes in the loft would each be a standable top face 0.9 m clear
  // of a floor nothing can link them to.
  const baleX = w / 2 - t - 1.5;
  const baleZ = -d / 2 + t + 2.4;
  const bales: [number, number, number][] = [
    [0, 0, 0],
    [0, 1.05, 0],
    [0.95, 0.5, 0],
    [0.3, 0.5, 0.75],
  ];
  for (const [bx, bz, by] of bales) {
    b.box(1.5, 0.72, 0.95, baleX - bx, 0.37 + by, baleZ + bz, THATCH, {
      y: bx > 0 ? Math.PI / 2 : 0,
    });
  }
  b.block({ w: 2.9, h: 1.5, d: 2.5, x: baleX - 0.45, y: 0.75, z: baleZ + 0.5 });

  // The deck outside the loft door.
  const deckT = 0.3;
  b.box(deckW, deckT, deckD, deckX, loftTop - deckT / 2, loftZ, PLANK);
  b.block({
    w: deckW,
    h: deckT,
    d: deckD,
    x: deckX,
    y: loftTop - deckT / 2,
    z: loftZ,
  });
  for (const sz of [-1, 1]) {
    const z = loftZ + sz * (deckD / 2 - 0.3);
    const postH = loftTop - deckT;
    b.box(0.28, postH, 0.28, deckX + deckW / 2 - 0.3, postH / 2, z, TIMBER);
  }

  // External ramp up the east side to that deck. 0.35 rise over run, inside
  // the nav graph's 0.4 slope limit.
  const rampGrade = 0.35;
  /**
   * How far below the barn's own floor the ramp keeps going. A ramp whose foot
   * stops exactly at the structure's origin only meets the ground when the
   * placement's `y` is zero and the floor under it is level, and it misses by
   * centimetres otherwise — the second barn on Hollowmere carries `y: 0.33`,
   * which lifted the foot to 0.62 above the ground it stands on, two
   * centimetres past `stepHeight`, and severed the whole loft from the graph.
   * A `stepHeight` of overrun buries the last 1.7 m instead, where the terrain
   * simply wins the surface (`addSurface` keeps the higher of two within
   * `HEIGHT_EPS`) and costs nothing.
   */
  const rampDrop = 0.6;
  const rampRun = (loftTop + rampDrop) / rampGrade;
  const rampT = 0.3;
  const rampPitch = Math.atan2(loftTop + rampDrop, rampRun);
  /** The slab's own length: it spans the run only once it is tilted. */
  const rampLen = Math.hypot(rampRun, loftTop + rampDrop);
  // Placed by its TOP face — the surface walked on has to meet the deck at one
  // end and pass through the ground at the other. `topFaceHeight` measures the
  // slab's half-thickness VERTICALLY, so that term is h/2/cos, not h/2*cos.
  const rampY = (loftTop - rampDrop) / 2 - rampT / 2 / Math.cos(rampPitch);
  const rampZ = deckS - rampRun / 2;
  /** The ramp's walked surface at a point `lz` along the slab. */
  const rampTopAt = (lz: number): number =>
    rampY + rampT / 2 / Math.cos(rampPitch) + lz * Math.tan(rampPitch);
  b.box(deckW, rampT, rampLen, deckX, rampY, rampZ, PLANK, { x: -rampPitch });
  b.block({
    w: deckW,
    h: rampT,
    d: rampLen,
    x: deckX,
    y: rampY,
    z: rampZ,
    rotX: -rampPitch,
  });
  // Cleats across the ramp. Local (0, y, z) on a slab pitched by -rampPitch
  // lands at world (0, y*cos + z*sin, z*cos - y*sin).
  for (let i = -4; i <= 4; i++) {
    const ly = rampT / 2 + 0.04;
    const lz = (i * rampLen) / 10;
    // Nothing below the ground line: the last stretch of slab is buried.
    if (rampTopAt(lz) < 0.1) continue;
    b.box(
      deckW - 0.3,
      0.08,
      0.14,
      deckX,
      rampY + ly * Math.cos(rampPitch) + lz * Math.sin(rampPitch),
      rampZ - ly * Math.sin(rampPitch) + lz * Math.cos(rampPitch),
      TIMBER,
      { x: -rampPitch },
    );
  }

  // Handrail up the ramp's outer edge and round the deck. These were VISUAL
  // ONLY, and the ramp's was the worse half of that: 4.2 m of climb with an
  // open side you could walk straight off. `guard` is what makes them solid
  // without costing the route a nav cell — it owns that whole argument.
  //
  // The rail starts where the ramp leaves the ground rather than at its buried
  // foot, and only the OUTER side carries one: the ramp runs up the barn's east
  // wall, which is the other edge.
  const railFootZ = deckS - loftTop / rampGrade;
  const railZ = (deckS + railFootZ) / 2;
  const railX = deckX + deckW / 2;
  b.guard("+x", railX, railZ, deckS - railFootZ, rampTopAt(railZ - rampZ), {
    pitch: rampPitch,
  });
  // Round the deck: the outer edge runs long at both ends, closing the corner
  // against the north rail and meeting the ramp's rail in one line.
  b.guard("+x", railX, loftZ, deckD + GUARD_THICKNESS * 2, loftTop);
  b.guard("+z", loftZ + deckD / 2, deckX, deckW, loftTop);

  // A lantern over the loft door, hung off the wall on a bracket: the same
  // iron arm / tapered housing / capped flame `lamp` is built from, because a
  // bare `glow` is a flame floating in mid-air with nothing holding it. The
  // arm beds into the LINTEL rather than crossing the opening, and the housing
  // hangs clear above the door's head. The farmstead is the darkest district
  // on the map and the ramp is meant to be an exposed approach, which it can
  // only be if the player can see it is there.
  const lampY = loftTop + doorH + 0.5;
  const lampX = w / 2 + t / 2 + 0.7;
  b.box(0.9, 0.1, 0.1, w / 2 + t / 2 + 0.4, lampY + 0.3, loftZ, IRON);
  b.cyl(0.62, 0.42, 0.3, 6, lampX, lampY, loftZ, IRON);
  b.glow(0.3, 0.3, 0.3, lampX, lampY, loftZ, FLAME);
  b.cyl(0.18, 0.1, 0.5, 6, lampX, lampY + 0.4, loftZ, IRON);
  b.light(FLAME, 22, 1.9, 0.28, lampX, lampY, loftZ);

  return b;
}
