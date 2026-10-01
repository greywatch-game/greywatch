/**
 * kit/buildings/watchtower.ts — buildWatchtower: the timber lookout tower and
 * its ramp.
 * Part of the buildings set: follows the contract in kit/core.ts; the set's
 * files are listed in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BoxSpec,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Structure,
  streetSeed,
  carve,
  guardSpec,
  onFace,
  outward,
  runsAlongX,
  type Side,
  limb,
  slab,
  EMBER,
  GUARD_HEIGHT,
  GUARD_THICKNESS,
  IRON,
  PITCH,
  PLANK,
  STONE,
  TIMBER,
} from "../core";

/**
 * A timber LOOKOUT TOWER: a railed platform 4.75 m up, reached by an external
 * ramp. The only piece of verticality outside the barn loft and the chapel
 * tower, and deliberately exposed on the way up.
 *
 * It is drawn as the frame it is built as:
 *
 * - **Four square legs on stone pads**, each pad and leg carried down to the
 *   ground under it. A girt runs round them at head height and the stage over
 *   it is braced, two crosses to a face either side of a stud; the storey under
 *   the girt is OPEN, because the colliders leave it open and a body walks
 *   under the deck — the braces that used to run from the ground up through
 *   it were timber you walked through.
 * - **Bearers on the leg heads, joists on the bearers, boards on the joists**:
 *   the deck is its collider slab boarded over, and what hangs under it is
 *   overhead of anyone standing there.
 * - **A boarded breastwork** on the rail colliders the deck always had — they
 *   are solid, so the drawing is too: boards outside hung down over the deck's
 *   edge, lapped boards and studs inside, a cap rail, a post at each face's
 *   middle and a newel either side of where the ramp arrives.
 * - **A steep roof on four corner posts** standing on the breastwork rather
 *   than in the middle of the deck: plates and ties, a board ceiling, rafter
 *   tails, lapped courses of tarred board, a ridge roll, bargeboards and
 *   finials, and boarded gables with a louvre. A bell hangs off the north
 *   gable, outboard, on a rope to the rail.
 * - **The fire basket stands on legs on an iron plate**, where it was a bucket
 *   hovering over the boards; a few billets lie by the east rail.
 * - **The ramp is a boarded walk on stringers**, boarded up both sides over its
 *   own rail colliders with posts, a cap and a handrail, standing on two
 *   trestle bents cut to the ground and braced as far as a body could not walk
 *   under them anyway.
 *
 * **The ramp follows `buildBarn`'s worked example**, because it previously
 * made both of the mistakes that comment exists to name, and each one showed
 * up as the climb needing a jump:
 *
 * - **The pitch is derived from the RUN and the slab is cut to the SLOPE.**
 *   `atan2(rise, slabLength)` conflates the two, which left the walked surface
 *   ending 0.40 m short of the deck at 0.14 m below it — a hole with the
 *   platform's own south face standing in it, so arriving at the top of the
 *   climb dropped you off the end or stopped you against a wall.
 * - **The foot runs on PAST the ground** (`rampDrop`) rather than stopping
 *   level with the tower's own floor, where it left 0.31 m of end grain. The
 *   ground probe would have stepped up that happily; `moveWithCollisions` is
 *   what refuses, because the collision capsule's ellipsoid bottoms out 0.05 m
 *   above the feet and a 0.31 m face is a wall to it. Hence "I have to jump".
 *
 * The rails are `guardSpec`s — `Build.guard`'s collider without its slab —
 * which is what makes them solid and stands them off the deck and the ramp;
 * `guard` owns why both halves of that matter. The one thing local to here is
 * the SOUTH side, which is two stubs cut to the deck's overhang either side of
 * the ramp — so the opening is the ramp's own width and always holds two
 * nav-cell centres however the tower is turned.
 *
 * **Every collider is the one the tower has always had, in the order it has
 * always declared them**, restated in one block at the top; everything after
 * it is drawing, and each drawn part is flat on a collider's face, stands on
 * one, lies low enough to walk over, or is overhead. The board ends, the
 * joints, the missing ramp board and the billets are seeded off where it
 * stands, and the pads, legs and bents are cut to the ground under them, which
 * is what puts `watchtower` in `CONFORMS_TO_TERRAIN`.
 */
export function buildWatchtower(
  scene: Scene,
  mats: CelMaterialFactory,
  _p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "watchtower");
  const legs = 1.9;
  const deck = 5.0;
  const deckT = 0.3;
  /** Walkable height of the platform — the surface, not the slab's centre. */
  const deckTop = 4.75;
  const deckY = deckTop - deckT / 2;

  // Access ramp, running up from -Z to the deck's south edge. Everything about
  // the platform's rails is cut against its width, so it is derived first.
  const rampW = 3;
  const rampT = 0.3;
  /** Rise over run. 0.35 sits inside the nav graph's 0.4 slope limit. */
  const rampGrade = 0.35;
  /** How far below the tower's own floor the ramp keeps going; see the header. */
  const rampDrop = 0.6;
  const rampRise = deckTop + rampDrop;
  const rampRun = rampRise / rampGrade;
  const rampPitch = Math.atan2(rampRise, rampRun);
  const cosP = Math.cos(rampPitch);
  /** The slab's own length: it spans the run only once it is tilted. */
  const rampLen = Math.hypot(rampRun, rampRise);
  /** Where the walked surface meets the deck: its south edge, at deck height. */
  const rampTopZ = -deck / 2;
  /** The walked surface at a world Z — one plane, through the deck's edge. */
  const rampSurfaceAt = (z: number): number =>
    deckTop - (rampTopZ - z) * rampGrade;
  const rampZ = rampTopZ - rampRun / 2;
  // Placed by its TOP face: that surface has to meet the deck at one end and
  // pass through the ground at the other. A pitched slab's half-thickness is
  // measured VERTICALLY, so the term is h/2/cos, not h/2*cos.
  const rampY = rampSurfaceAt(rampZ) - rampT / 2 / Math.cos(rampPitch);
  // Trestle bents under the span: 15 m of plank standing on nothing was the
  // other half of what read as wrong here. Colliders, because the upper one is
  // in ground a body can cross — above the ramp's midpoint the slab clears the
  // floor by more than HEADROOM, so the nav graph leaves that ground open and a
  // bot will route straight under it.
  const bents = [1, 2]
    .map((i) => {
      const z = rampTopZ - (i * rampRun) / 3;
      return { z, h: rampSurfaceAt(z) - rampT / Math.cos(rampPitch) };
    })
    .filter((bent) => bent.h >= 0.4);
  const bentX = rampW / 2 - 0.2;
  // Handrails up both sides of the ramp, starting where it comes out of the
  // ground rather than at its buried foot, then round the platform — whose -Z
  // side is where the ramp arrives, so it is two stubs and an opening the
  // ramp's own width.
  const railFootZ = rampTopZ - deckTop / rampGrade;
  const rampRailZ = (rampTopZ + railFootZ) / 2;
  const sideRun = deck + GUARD_THICKNESS * 2; // closes the corners
  const stub = (deck - rampW) / 2;
  const rampRails = ([-1, 1] as const).map((sx) =>
    guardSpec(sx > 0 ? "+x" : "-x", (sx * rampW) / 2, rampRailZ, rampTopZ - railFootZ, rampSurfaceAt(rampRailZ), {
      pitch: rampPitch,
    }),
  );
  const deckRails: [Side, BoxSpec][] = [
    ["-x", guardSpec("-x", -deck / 2, 0, sideRun, deckTop)],
    ["+x", guardSpec("+x", deck / 2, 0, sideRun, deckTop)],
    ["+z", guardSpec("+z", deck / 2, 0, deck, deckTop)],
    ...([-1, 1] as const).map((sx): [Side, BoxSpec] => [
      "-z",
      guardSpec("-z", -deck / 2, (sx * (deck - stub)) / 2, stub, deckTop),
    ]),
  ];
  /** The roof's collider: `gableRoof`'s flat slab at the eaves of a 5.6 m roof overhanging 0.4. */
  const eaveY = deckTop + 2.4;

  // ---- the colliders: every one this tower has ever had, in the order it
  // has always declared them.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.block({ w: 0.5, h: deckY, d: 0.5, x: sx * legs, y: deckY / 2, z: sz * legs });
    }
  }
  b.block({ w: deck, h: deckT, d: deck, x: 0, y: deckY, z: 0 });
  b.block({ w: rampW, h: rampT, d: rampLen, x: 0, y: rampY, z: rampZ, rotX: -rampPitch });
  for (const bent of bents) {
    for (const sx of [-1, 1]) {
      b.block({ w: 0.34, h: bent.h, d: 0.34, x: sx * bentX, y: bent.h / 2, z: bent.z });
    }
  }
  for (const r of rampRails) b.block(r);
  for (const [, r] of deckRails) b.block(r);
  b.block({ w: deck + 0.6 + 0.4 * 2, h: 0.3, d: deck + 0.6 + 0.4 * 2, x: 0, y: eaveY, z: 0 });

  // ---- everything below is drawing.
  const rnd = mulberry32(streetSeed(deck, deck, deckTop, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const SIDES: readonly Side[] = ["-z", "+z", "-x", "+x"];

  // ---- the legs: square posts on stone pads, a girt at head height and a
  // braced stage over it.
  const post = 0.42;
  const legFace = legs + post / 2;
  const headBot = 3.75;
  const bearerBot = 3.95;
  const bearerTop = 4.25;
  let highFoot = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const [x, z] = [sx * legs, sz * legs];
      const under = [-1, 1].flatMap((i) => [-1, 1].map((k) => ground(x + i * 0.33, z + k * 0.33)));
      const lo = Math.min(...under);
      const hi = Math.max(...under);
      const padTop = hi + 0.14;
      b.box(post, bearerBot - padTop, post, x, (bearerBot + padTop) / 2, z, TIMBER);
      b.box(0.66, padTop - lo + 0.25, 0.66, x, (padTop + lo - 0.25) / 2, z, STONE);
      highFoot = Math.max(highFoot, hi);
    }
  }
  /** The girt's underside: head height over the highest ground the legs stand on. */
  const girtBot = Math.max(2.5, highFoot + 2.4);
  const girtTop = girtBot + 0.2;
  const inner = legs - post / 2;
  for (const s of SIDES) {
    // The ±X faces' members run on past the corners, so the two meet lapped.
    const run = 2 * legFace + (runsAlongX(s) ? 0 : 0.24);
    onFace(b, s, legFace, 0, (girtBot + girtTop) / 2, run, girtTop - girtBot, 0.12, 0.06, TIMBER);
    onFace(b, s, legFace, 0, (headBot + bearerBot) / 2, run, bearerBot - headBot, 0.12, 0.06, TIMBER);
    if (headBot - girtTop < 0.5) continue;
    onFace(b, s, legFace, 0, (girtTop + headBot) / 2, 0.16, headBot - girtTop, 0.12, 0.06, TIMBER);
    const c = outward(s) * (legFace + 0.16);
    const at = (u: number, y: number): Point3 => (runsAlongX(s) ? [u, y, c] : [c, y, u]);
    for (const side of [-1, 1]) {
      const [u0, u1] = side < 0 ? [-inner, -0.08] : [0.08, inner];
      slab(b, at(u0, girtTop), at(u1, headBot), 0.08, 0.15, TIMBER);
      slab(b, at(u0, headBot), at(u1, girtTop), 0.08, 0.15, TIMBER);
      onFace(b, s, legFace, (u0 + u1) / 2, (girtTop + headBot) / 2, 0.09, 0.09, 0.03, 0.215, IRON);
    }
    for (const u of [-legs, legs]) {
      for (const y of [(girtBot + girtTop) / 2, (headBot + bearerBot) / 2]) {
        onFace(b, s, legFace, u, y, 0.07, 0.07, 0.03, 0.135, IRON);
      }
    }
  }
  // Bearers on the leg heads, joists on the bearers. Overhead: the joists'
  // undersides are 4.25 m up, and the deck's own collider is what they hang
  // under.
  for (const sz of [-1, 1]) {
    b.box(deck + 0.1, bearerTop - bearerBot, 0.28, 0, (bearerBot + bearerTop) / 2, sz * legs, TIMBER);
  }
  const joists = 10;
  for (let i = 0; i < joists; i++) {
    const x = -deck / 2 + 0.25 + (i * (deck - 0.5)) / (joists - 1);
    b.box(0.1, deckY - deckT / 2 - bearerTop, deck, x, (bearerTop + deckY - deckT / 2) / 2, 0, TIMBER);
  }

  // ---- the deck: its collider slab boarded over, board tops ON the slab's
  // top, and the core under them emitted after them.
  const board = 0.04;
  const boards = 23;
  const pitchZ = deck / boards;
  for (let i = 0; i < boards; i++) {
    const z = -deck / 2 + (i + 0.5) * pitchZ;
    const x0 = -deck / 2 - 0.03 + (rnd() - 0.5) * 0.03;
    const x1 = deck / 2 + 0.03 + (rnd() - 0.5) * 0.03;
    // Some boards are two lengths butted over a joist.
    const cuts: [number, number][] = [];
    if (rnd() < 0.45) {
      const j = -deck / 2 + 0.25 + (Math.floor(1 + rnd() * (joists - 2)) * (deck - 0.5)) / (joists - 1);
      cuts.push([j - 0.008, j + 0.008]);
    }
    for (const [a, c] of carve(x0, x1, cuts)) {
      b.box(c - a, board, pitchZ - 0.022, (a + c) / 2, deckTop - board / 2, z, PLANK);
    }
  }
  b.box(deck, deckT - board, deck, 0, deckY - board / 2, 0, TIMBER);

  // ---- the breastwork: boarded over the rails' colliders, which are solid,
  // so the drawing is too. The outer boards hang on down over the deck's edge.
  const t = GUARD_THICKNESS;
  const railMid = deck / 2 + t / 2;
  const railTop = deckTop + GUARD_HEIGHT;
  const hemY = deckY - deckT / 2;
  for (const [s, r] of deckRails) {
    const along = runsAlongX(s) ? r.w : r.d;
    const uc = runsAlongX(s) ? r.x : r.z;
    const [u0, u1] = [uc - along / 2, uc + along / 2];
    // Outer boards, upright, their feet sawn by hand.
    const n = Math.max(1, Math.round(along / 0.19));
    for (let i = 0; i < n; i++) {
      const u = u0 + ((i + 0.5) * along) / n;
      const foot = hemY - rnd() * 0.05;
      onFace(b, s, railMid, u, (foot + railTop) / 2, along / n - 0.02, railTop - foot, 0.03, t / 2 + 0.01, PLANK);
    }
    // Inside: three lapped courses to the deck's own corners, studs over them.
    const [i0, i1] = [Math.max(u0, -deck / 2), Math.min(u1, deck / 2)];
    for (let k = 0; k < 3; k++) {
      const y0 = deckTop + 0.02 + k * 0.36;
      onFace(b, s, railMid, (i0 + i1) / 2, y0 + 0.17, i1 - i0, 0.34, 0.03, -(t / 2 + 0.01), PLANK);
    }
    const studs = Math.max(1, Math.round((i1 - i0) / 1.25));
    for (let i = 0; i <= studs; i++) {
      const u = i0 + 0.06 + (i * (i1 - i0 - 0.12)) / studs;
      onFace(b, s, railMid, u, (deckTop + railTop) / 2, 0.1, GUARD_HEIGHT, 0.05, -(t / 2 + 0.045), TIMBER);
    }
    // The cap, standing on the collider's top and lapping both faces.
    onFace(b, s, railMid, uc, railTop + 0.035, along + (runsAlongX(s) ? 0 : 0.1), 0.07, t + 0.1, 0, TIMBER);
    onFace(b, s, railMid, uc, (hemY + railTop) / 2 - 0.005, along, railTop - hemY - 0.01, t - 0.03, 0, TIMBER);
  }
  // A post at the middle of each whole face, on the boarding.
  for (const s of ["-x", "+x", "+z"] as const) {
    onFace(b, s, railMid, 0, (hemY - 0.1 + railTop) / 2, 0.14, railTop - hemY + 0.1, 0.08, t / 2 + 0.06, TIMBER);
  }
  // Newels either side of the opening, inside the stubs' own footprint.
  for (const sx of [-1, 1]) {
    const x = sx * (rampW / 2 + 0.1);
    b.box(0.2, 6.2 - hemY, t, x, (6.2 + hemY) / 2, -railMid, TIMBER);
    b.box(0.26, 0.06, t + 0.06, x, 6.23, -railMid, TIMBER);
  }

  // ---- the roof, on four corner posts that stand on the breastwork.
  const cp = deck / 2 + 0.1;
  const plateTop = eaveY + 0.05;
  const plateBot = plateTop - 0.2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.2, plateBot - hemY + 0.1, 0.2, sx * cp, (plateBot + hemY - 0.1) / 2, sz * cp, TIMBER);
      // Knee braces into both plates, over the rail rather than the deck.
      slab(b, [sx * cp, plateBot - 0.6, sz * cp], [sx * (cp - 0.6), plateBot, sz * cp], 0.12, 0.12, TIMBER);
      slab(b, [sx * cp, plateBot - 0.6, sz * cp], [sx * cp, plateBot, sz * (cp - 0.6)], 0.12, 0.12, TIMBER);
    }
  }
  for (const s of [-1, 1]) {
    b.box(2 * cp + 0.2, 0.2, 0.2, 0, plateBot + 0.1, s * cp, TIMBER);
    b.box(0.2, 0.2, 2 * cp - 0.2, s * cp, plateBot + 0.1, 0, TIMBER);
  }
  for (const z of [-1.3, 0, 1.3]) b.box(2 * cp, 0.2, 0.16, 0, plateBot + 0.1, z, TIMBER);
  // A ceiling of boards on the ties: the roof collider is a slab at the
  // eaves, and a ceiling there is what a round fired up into it stops on.
  const ceil = 24;
  for (let i = 0; i < ceil; i++) {
    const x = -cp + ((i + 0.5) * 2 * cp) / ceil;
    b.box((2 * cp) / ceil - 0.02, 0.03, 2 * cp + 0.2, x, plateTop + 0.015, 0, PLANK);
  }
  // The roof itself: a steep pitch, so the silhouette is a roof and not a lid.
  const halfSpan = cp + 0.1;
  const rise = 1.8;
  const eaveU = (deck + 0.6) / 2 + 0.4;
  const halfLen = eaveU;
  const theta = Math.atan2(rise, halfSpan);
  const [sinT, cosT] = [Math.sin(theta), Math.cos(theta)];
  const sark = 0.06;
  /** The top of the sarking at a distance `u` out from the ridge. */
  const sarkTop = (u: number): number => plateTop + rise - (u * rise) / halfSpan + sark / cosT;
  const slopeLen = eaveU / cosT;
  const course = 0.36;
  const lap = 0.07;
  const courseT = 0.035;
  for (const s of [-1, 1]) {
    // Lapped courses of tarred board, each resting on the one below.
    for (let q = 0; q < slopeLen - 0.05; q += course - lap) {
      const qTop = Math.min(q + course, slopeLen);
      const loU = eaveU - q * cosT;
      const hiU = eaveU - qTop * cosT;
      const lo: [number, number] = [loU + sinT * courseT, sarkTop(loU) + cosT * courseT];
      const hi: [number, number] = [hiU, sarkTop(hiU)];
      const phi = Math.atan2(hi[1] - lo[1], lo[0] - hi[0]);
      const w = Math.hypot(hi[1] - lo[1], lo[0] - hi[0]);
      const cu = (lo[0] + hi[0]) / 2 + (Math.sin(phi) * courseT) / 2;
      const cy = (lo[1] + hi[1]) / 2 + (Math.cos(phi) * courseT) / 2;
      b.box(w, courseT, 2 * halfLen + 0.04, s * cu, cy, 0, PITCH, { z: -s * phi });
    }
    // The sarking under them, emitted after what hides it.
    const mu = eaveU / 2;
    b.box(slopeLen, sark, 2 * halfLen, s * (mu + (sinT * sark) / 2), sarkTop(mu) - sark / cosT + (cosT * sark) / 2, 0, TIMBER, {
      z: -s * theta,
    });
    // Rafter tails from the plate out to the eave, and the fascia across them.
    for (let i = 0; i <= 8; i++) {
      const z = -halfLen + 0.2 + (i * (2 * halfLen - 0.4)) / 8;
      const [ua, uc] = [cp - 0.15, eaveU - 0.04];
      slab(b, [s * ua, sarkTop(ua) - sark / cosT - 0.07, z], [s * uc, sarkTop(uc) - sark / cosT - 0.07, z], 0.1, 0.14, TIMBER);
    }
    b.box(0.04, 0.22, 2 * halfLen + 0.05, s * (eaveU + 0.02), sarkTop(eaveU) - 0.08, 0, TIMBER);
    // Bargeboards up both verges, and a finial where they meet.
    for (const sz of [-1, 1]) {
      slab(b, [s * (eaveU + 0.04), sarkTop(eaveU + 0.04) - 0.02, sz * (halfLen + 0.045)], [0, sarkTop(0) - 0.02, sz * (halfLen + 0.045)], 0.05, 0.26, TIMBER);
    }
  }
  b.box(0.2, 0.2, 2 * halfLen + 0.1, 0, sarkTop(0) + courseT + 0.02, 0, TIMBER, { z: Math.PI / 4 });
  for (const sz of [-1, 1]) {
    b.box(0.12, 0.6, 0.12, 0, sarkTop(0) + 0.15, sz * (halfLen + 0.07), TIMBER);
    b.box(0.18, 0.05, 0.18, 0, sarkTop(0) + 0.47, sz * (halfLen + 0.07), TIMBER);
  }
  // The gables: boarded upright over a backing set in under the overhang,
  // each board's top cut into the roof above it, and a louvre in each.
  const gableZ = cp + 0.1;
  for (const sz of [-1, 1]) {
    b.gableEnd(2 * halfSpan, rise, 0.06, 0, plateTop, sz * (gableZ - 0.04), TIMBER);
    const n = 28;
    for (let i = 0; i < n; i++) {
      const x = -halfSpan + ((i + 0.5) * 2 * halfSpan) / n;
      const top = plateTop + rise - ((Math.abs(x) - halfSpan / n) * rise) / halfSpan;
      const foot = plateBot - 0.02;
      b.box((2 * halfSpan) / n - 0.018, Math.min(top, plateTop + rise) - foot, 0.03, x, (Math.min(top, plateTop + rise) + foot) / 2, sz * (gableZ + 0.015), PLANK);
    }
    const vy = plateTop + rise * 0.42;
    const vz = sz * (gableZ + 0.04);
    b.box(0.5, 0.4, 0.02, 0, vy, vz, IRON);
    for (const dx of [-0.28, 0.28]) b.box(0.07, 0.54, 0.05, dx, vy, vz + sz * 0.01, TIMBER);
    for (const dy of [-0.23, 0.23]) b.box(0.62, 0.07, 0.05, 0, vy + dy, vz + sz * 0.01, TIMBER);
    for (const dy of [-0.12, 0, 0.12]) b.box(0.5, 0.03, 0.08, 0, vy + dy, vz + sz * 0.02, TIMBER, { x: sz * 0.6 });
  }
  // The alarm bell, on a bracket off the north gable: outboard of the rail,
  // over nothing, with its rope down to a cleat on the cap.
  {
    const bx = -1.1;
    const bz = gableZ + 0.42;
    const armY = plateBot - 0.05;
    b.box(0.1, 0.12, bz - gableZ + 0.1, bx, armY, (bz + gableZ) / 2 + 0.05, TIMBER);
    slab(b, [bx, armY - 0.55, gableZ + 0.04], [bx, armY - 0.04, bz - 0.05], 0.08, 0.08, TIMBER);
    b.cyl(0.1, 0.06, 0.06, 6, bx, armY - 0.11, bz, IRON);
    b.cyl(0.3, 0.16, 0.32, 8, bx, armY - 0.31, bz, IRON);
    b.cyl(0.04, 0.36, 0.36, 8, bx, armY - 0.48, bz, IRON);
    b.box(0.05, 0.12, 0.05, bx, armY - 0.52, bz, IRON);
    const cleatZ = railMid + t / 2 + 0.05;
    limb(b, [bx + 0.12, armY - 0.2, bz - 0.02], [bx + 0.1, railTop - 0.08, cleatZ], 0.025, 0.025, PLANK, 5);
    b.box(0.22, 0.05, 0.05, bx + 0.1, railTop - 0.1, cleatZ, TIMBER);
  }

  // ---- the fire basket, on legs on an iron plate, and billets by the rail.
  // Still lit — and the first structure in the tree that is HEARD as well as
  // seen. The three lines at the end are one object: the light it throws and
  // the noise it makes, at the flame rather than at the basket.
  const [fx, fz] = [1.4, 1.4];
  b.box(1.2, 0.02, 1.2, fx, deckTop + 0.01, fz, IRON);
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3 + 0.3;
    limb(b, [fx + Math.cos(a) * 0.46, deckTop + 0.02, fz + Math.sin(a) * 0.46], [fx + Math.cos(a) * 0.26, deckTop + 0.46, fz + Math.sin(a) * 0.26], 0.05, 0.04, IRON, 5);
  }
  b.cyl(0.22, 0.8, 0.46, 8, fx, deckTop + 0.55, fz, IRON);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    limb(b, [fx + Math.cos(a) * 0.39, deckTop + 0.64, fz + Math.sin(a) * 0.39], [fx + Math.cos(a) * 0.45, deckTop + 0.88, fz + Math.sin(a) * 0.45], 0.035, 0.035, IRON, 4);
    const m = a + Math.PI / 8;
    b.box(0.37, 0.03, 0.03, fx + Math.cos(m) * 0.425, deckTop + 0.87, fz + Math.sin(m) * 0.425, IRON, { y: -m + Math.PI / 2 });
  }
  b.glow(0.56, 0.08, 0.56, fx, deckTop + 0.84, fz, EMBER);
  b.flame(0.3, 0.85, fx, deckTop + 0.82, fz);
  b.light(EMBER, 22, 2.0, 0.4, fx, deckTop + 0.95, fz);
  b.sound("fire", fx, deckTop + 0.9, fz);
  {
    const logs = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < logs; i++) {
      const row = i < 3 ? 0 : 1;
      const k = row === 0 ? i : i - 2.5;
      const d = 0.11 + rnd() * 0.04;
      b.cyl(0.5 + rnd() * 0.15, d, d, 6, deck / 2 - 0.18 - k * 0.13, deckTop + d / 2 + row * 0.11, -0.2 + (rnd() - 0.5) * 0.1, TIMBER, {
        x: Math.PI / 2,
        y: (rnd() - 0.5) * 0.2,
      });
    }
  }

  // ---- the ramp: a boarded walk on its collider slab, board tops ON the
  // slab's top, stringers down its edges, and the core emitted last.
  const boardAlong = 0.3;
  const missing = rnd() < 0.6 ? 12 + Math.floor(rnd() * 40) : -1;
  for (let i = 0, q = boardAlong / 2; q < rampLen; i++, q += boardAlong) {
    const z = rampTopZ - q * cosP;
    if (i === missing || rampSurfaceAt(z) < ground(0, z) - 0.04) continue;
    b.box(rampW - (rnd() < 0.3 ? 0.04 : 0), board, boardAlong - 0.022, (rnd() - 0.5) * 0.02, rampSurfaceAt(z) - board / 2 / cosP, z, PLANK, {
      x: -rampPitch,
    });
  }
  // Cleats across it. 15 m of bare plank at this pitch reads as a chute; these
  // are what say it is climbed. Nothing below the ground line — the foot of
  // the slab is buried, which is the whole point of `rampDrop`.
  for (let i = -5; i <= 5; i++) {
    const z = rampZ + (i * rampRun) / 12;
    const surface = rampSurfaceAt(z);
    if (surface - ground(0, z) < 0.12) continue;
    b.box(rampW - 0.3, 0.08, 0.14, 0, surface + 0.04 / cosP, z, TIMBER, { x: -rampPitch });
  }
  /** A member running up the ramp between `z0` and `z1`, spanning `v0..v1` above the walked surface. */
  const upRamp = (w: number, v0: number, v1: number, x: number, z0: number, z1: number, color: string): void => {
    const zc = (z0 + z1) / 2;
    b.box(w, (v1 - v0) * cosP, (z1 - z0) / cosP, x, rampSurfaceAt(zc) + (v0 + v1) / 2, zc, color, { x: -rampPitch });
  };
  for (const sx of [-1, 1]) upRamp(0.08, -0.44, -0.02, sx * (rampW / 2 + 0.04), railFootZ - 0.3, rampTopZ, TIMBER);
  upRamp(rampW, -rampT / cosP, -board / cosP, 0, rampTopZ - rampRun, rampTopZ, TIMBER);

  // ---- the ramp's sides, boarded over their rails' colliders: courses
  // along the run butted on posts outside, the same inside under a handrail.
  const posts: number[] = [];
  for (let z = rampTopZ - 0.25; z > railFootZ + 0.4; z -= 2.2) posts.push(z);
  for (const [i, r] of rampRails.entries()) {
    const sx = i === 0 ? -1 : 1;
    const out = sx * (rampW / 2 + t);
    const inn = sx * (rampW / 2);
    const bands: [number, number][] = [
      [-0.3, 0.07],
      [0.09, 0.41],
      [0.43, 0.75],
      [0.77, GUARD_HEIGHT],
    ];
    for (const [v0, v1] of bands) {
      // Each course is two or three lengths butted at posts.
      const joints = posts.filter(() => rnd() < 0.35).map((z): [number, number] => [z - 0.008, z + 0.008]);
      for (const [z0, z1] of carve(railFootZ + 0.02, rampTopZ - 0.02, joints)) {
        upRamp(0.03, v0, v1, out + sx * 0.012, z0, z1, PLANK);
        if (v1 > 0.1) upRamp(0.03, Math.max(v0, 0.02), v1, inn - sx * 0.012, z0, z1, PLANK);
      }
    }
    upRamp(t + 0.1, GUARD_HEIGHT, GUARD_HEIGHT + 0.07, r.x, railFootZ, rampTopZ, TIMBER);
    upRamp(t - 0.03, -0.3, GUARD_HEIGHT - 0.01, r.x, railFootZ, rampTopZ, TIMBER);
    for (const z of posts) {
      const s0 = rampSurfaceAt(z);
      b.box(0.08, GUARD_HEIGHT + 0.45, 0.13, out + sx * 0.065, s0 + (GUARD_HEIGHT - 0.35) / 2 - 0.05, z, TIMBER);
      b.box(0.05, GUARD_HEIGHT - 0.04, 0.1, inn - sx * 0.05, s0 + GUARD_HEIGHT / 2 + 0.02, z, TIMBER);
      b.box(0.1, 0.05, 0.05, inn - sx * 0.1, s0 + 0.88, z, TIMBER);
    }
    const hx = inn - sx * 0.13;
    const [h0, h1] = [railFootZ + 0.5, rampTopZ - 0.15];
    limb(b, [hx, rampSurfaceAt(h0) + 0.93, h0], [hx, rampSurfaceAt(h1) + 0.93, h1], 0.06, 0.06, TIMBER, 6);
  }

  // ---- the trestle bents, on pads cut to the ground: knee braces where a
  // body walks under, a cross where nothing can.
  for (const bent of bents) {
    const capBot = bent.h - 0.18;
    for (const sx of [-1, 1]) {
      const x = sx * bentX;
      const g = ground(x, bent.z);
      b.box(0.3, capBot - g + 0.05, 0.3, x, (capBot + g - 0.05) / 2, bent.z, TIMBER);
      b.box(0.46, 0.34, 0.46, x, g - 0.05, bent.z, STONE);
      if (bent.h >= 2.2) {
        slab(b, [sx * (bentX - 0.15), capBot - 0.62, bent.z], [sx * (bentX - 0.7), capBot, bent.z], 0.1, 0.12, TIMBER);
      }
    }
    b.box(rampW, 0.18, 0.18, 0, bent.h - 0.09, bent.z, TIMBER);
    if (bent.h < 2.2) {
      for (const sx of [-1, 1]) {
        const zf = bent.z + sx * 0.2;
        const ga = ground(-sx * (bentX - 0.15), bent.z);
        slab(b, [-sx * (bentX - 0.15), ga + 0.15, zf], [sx * (bentX - 0.15), capBot - 0.05, zf], 0.08, 0.14, TIMBER);
      }
    }
  }
  // Stones kicked up either side of where the walk comes out of the ground.
  for (const sx of [-1, 1]) {
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const x = sx * (rampW / 2 + 0.35 + rnd() * 0.4);
      const z = railFootZ + 0.3 + rnd() * 1.4;
      const h = 0.14 + rnd() * 0.1;
      b.box(0.3 + rnd() * 0.25, h, 0.25 + rnd() * 0.2, x, ground(x, z) + h / 2 - 0.05, z, STONE, { y: rnd() * Math.PI });
    }
  }

  return b;
}
