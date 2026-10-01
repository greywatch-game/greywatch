/**
 * kit/buildings/chapel.ts — buildChapel: the stone parish church with its west
 * tower and spire.
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
  convexSolid,
  onFace,
  type Side,
  CASEMENT,
  ASHLAR,
  DARK_STONE,
  FLAME,
  IRON,
  LAMP_RED,
  MOSS_STONE,
  PITCH,
  PLANK,
  SAILCLOTH,
  SLATE,
  STONE,
  SULPHUR,
  TIMBER,
} from "../core";
import {
  facePoint,
  facePoly,
  offFacePoly,
  faceBlock,
  inside,
  pyramid,
  fold,
  archRing,
  lancet,
  buttress,
} from "./gothic";
import { offFace } from "./village";

/**
 * A church roof's pitch: steeper than `ROOF_PITCH`, because what a village
 * reads a church by at three hundred metres is the height of its roof as much
 * as its tower, and a nave under the tavern's pitch is a long barn.
 */
const CHAPEL_PITCH = 0.8;
/**
 * Candlelight through leaded glass, from outside. Dark for `ROOM_GLOW`'s
 * reason — what an emissive may be is set by its AREA, and thirteen lancets
 * glow in this building — and warm because the nave is lit by candles.
 */
const CHAPEL_GLASS = "#8a5a2e";
/** Limewash over the rubble inside: a room lit by candles is lit off its walls. */
const LIMEWASH = "#77705f";

/**
 * The chapel: a stone parish church you can fight inside, with a west tower
 * and spire that stand over the north half of the map. Flag A sits in the
 * nave on Hollowmere; Harrowmead and Cinderhaven stand one in the village.
 *
 * **What was wrong was that it read as a warehouse.** A 20 m box of flat stone
 * under a shallow slate lid, three glowing cyan bars down each side, ten
 * "buttresses" drawn INSIDE the walls, a tower that was a square chimney
 * standing 1.6 m clear of the nave with a four-sided cone on it, and inside,
 * nothing — a dark shed with grass growing through the floor (and on
 * Harrowmead, the stream: the nave stands across it and its floor was drawn
 * under the water). It is now the things a village church is recognised by:
 *
 * - **Buttressed bays.** Three stepped buttresses a side and a pair at every
 *   corner, each weathered back twice, standing on a plinth that runs round
 *   the whole building; a string course under the sills; an eaves course on a
 *   corbel table; and a lancet in every bay with dressed jambs, a pointed ring
 *   and a hood mould, glazed in leaded quarries with the candlelight behind.
 * - **A steep slate roof** (`CHAPEL_PITCH`, cut plumb, the smithy's
 *   construction) between COPED gables, with a cross on the front one. The
 *   front gable is a doorway in a gabled surround with a niche over it, three
 *   stepped lancets and an oculus, and a lantern hangs beside the door.
 *   **The chapel carries ONE light, as it always has**: the old one was a
 *   lamp in the tower lighting the churchyard, and the new one is a corona
 *   lighting the nave — a light costs every pixel in its range, and each of
 *   the two more this building was first drawn with measured 0.1-0.2 ms.
 * - **A west tower** built against the back gable rather than beside it: three
 *   stages between string courses, angle buttresses at its free corners, a
 *   clock on each flank, two-light louvred belfry openings, a battlemented
 *   parapet with a pinnacle at each corner and a spout below each, and an
 *   octagonal spire with lucarnes, a gilded ball and a weathercock.
 * - **A nave that is a church**: flagged floor with a stone aisle, pews on
 *   their boarded platforms, a font by the door, a pulpit under its sounding
 *   board, a lectern, a chancel step, an altar rail, an altar in its frontal
 *   before a panelled reredos with candles and a cross, memorials on
 *   limewashed walls, a corona of candles, and an open roof of arch-braced
 *   collar trusses over it all.
 *
 * **The shell's colliders are the ones it has always had, in the order it has
 * always emitted them** — the doorway, three walls, and the flat slab at the
 * eaves `gableRoof` used to lay, now stated by hand because the roof drawn over
 * it is this builder's own. The tower's four are after them as they always
 * were, **moved 2.2 m south so the tower stands against the gable**: its
 * south wall is the nave's back gable above the eaves, and the slot a body
 * could once walk into between the two is gone. Everything else follows, so
 * the bake's prefix is the shell's:
 *
 * - **The walked floor** (the tavern's, for its reasons) and the chancel
 *   platform on it, and the step at the door.
 * - **The masonry that stands off the walls**: the doorway's surround and
 *   every buttress, two boxes each — on a flank, a 0.85 m buttress a body or
 *   a round went through was the whole elevation lying. And the belfry, the
 *   one stage of the tower over its walls, as one block.
 * - **The furniture that is cover**: the two blocks of pews (one box each;
 *   the 0.45 m between two rows is a shape the nav grid cannot hold and no body
 *   fits), the font, the pulpit and the altar. Soft cover, under `CoverMap`'s
 *   lines, as the tavern's tables are; the aisle from the door to the altar
 *   and both side aisles are kept clear. The rail, the lectern and the bench
 *   round the walls are drawing.
 *
 * **The floor follows the ground, and that is what the `BuildCtx` is for.** A
 * church is built LEVEL whatever it stands on: the floor is laid a step above
 * the highest ground under the nave and the plinth is carried down to the
 * lowest under the whole footprint, so Harrowmead's nave stands dry over its
 * stream on a footing the water laps, and Cinderhaven's tower no longer shows
 * daylight under its north wall. Everything inside is measured from that
 * floor. A lifted placement — Hollowmere's, on its terrace — is standing on
 * something MapBuilder does not know about and is built level (`groundRun`'s
 * rule), which is what puts `chapel` in `CONFORMS_TO_TERRAIN`.
 *
 * **Hollowmere's flag flies from the ridge**, which is `flagMount` finding the
 * eaves slab and `poleLift` carrying it to the drawn roof: a steeper roof is a
 * taller lift, and the layout owns that number.
 */
export function buildChapel(
  scene: Scene,
  mats: CelMaterialFactory,
  _p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "chapel");
  const w = 12;
  const d = 20;
  const h = 7;
  const t = 0.6;
  /** The tower: between its walls' centres, and to their tops. */
  const tw = 5;
  const th = 15;
  /** The tower's south wall stands in the back gable, its north one `tw` on. */
  const tz0 = d / 2;
  const tz1 = tz0 + tw;
  const tzc = (tz0 + tz1) / 2;

  // ------------------------------------------------------------ the masses
  //
  // Every collider the shell has, in the order it has always had them. See
  // the header before adding to it.
  b.doorWall(w, h, t, 0, h / 2, -d / 2, STONE, 2.6, 3.4);
  b.wall(w, h, t, 0, h / 2, d / 2, STONE);
  b.wall(t, h, d, -w / 2, h / 2, 0, STONE);
  b.wall(t, h, d, w / 2, h / 2, 0, STONE);
  // The roof's collider: exactly the slab `gableRoof` laid at the eaves.
  b.block({ w: w + 0.7, h: 0.3, d: d + 0.7, x: 0, y: h, z: 0 });
  // The tower: its south wall is the gable over the nave's back wall, and the
  // north one closes both corners the side walls leave.
  b.wall(tw + t, th - h, t, 0, (th + h) / 2, tz0, STONE);
  b.wall(tw + t, th, t, 0, th / 2, tz1, STONE);
  b.wall(t, th, tw, -tw / 2, th / 2, tzc, STONE);
  b.wall(t, th, tw, tw / 2, th / 2, tzc, STONE);

  // ------------------------------------------------------------ the ground
  //
  // See the header: the floor a step over the highest ground under the nave,
  // the footings down to the lowest under everything.
  let F = 0.3;
  let base = 0;
  if (ctx && !ctx.terrain.flat && Math.abs(ctx.y - ctx.floor) < 1e-6) {
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    const at = (lx: number, lz: number): [number, number] => [ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos];
    let high = -Infinity;
    let low = Infinity;
    for (let lx = -7.4; lx <= 7.41; lx += 0.74) {
      for (let lz = -11.4; lz <= tz1 + 1.21; lz += 0.75) {
        const [x, z] = at(lx, lz);
        low = Math.min(low, ctx.terrain.surfaceAt(x, z) - ctx.y);
        if (Math.abs(lx) <= w / 2 + t && lz <= d / 2 + t / 2) high = Math.max(high, ctx.terrain.heightAt(x, z) - ctx.y);
      }
    }
    F = Math.max(0.3, Math.ceil((high + 0.2) * 20) / 20);
    base = low < -0.02 ? low - 0.12 : 0;
  }
  /** Where every footing stops, and every collider standing on one starts. */
  const y0 = Math.min(0, base);

  /** The nave's outer faces, and its inner ones. */
  const gx = w / 2 + t / 2;
  const gz = d / 2 + t / 2;
  const ix = w / 2 - t / 2;
  const iz = d / 2 - t / 2;
  /** The tower's outer faces. */
  const tx = tw / 2 + t / 2;
  const tzN = tz1 + t / 2;
  /** The tower's south face, over the ridge: a face at +z looking -z. */
  const tzS = -(tz0 - t / 2);
  /** The doorway, as the walls leave it. */
  const doorW = 2.6;
  const doorH = 3.4;
  /** The chancel: its step, and the floor on it. */
  const chancelZ = 4.6;
  const FC = F + 0.15;

  // ---- the walked floor: the tavern's collider under the flags, through the
  // doorway, and the step out of it; the chancel platform stands on it.
  b.block({ w: 2 * ix, h: F - y0 + 1.3, d: d, x: 0, y: (F + y0 - 1.3) / 2, z: -t / 2 });
  b.block({ w: 2 * ix, h: 0.4, d: iz - chancelZ, x: 0, y: FC - 0.2, z: (iz + chancelZ) / 2 });
  b.block({ w: 3.4, h: F - y0 + 0.3, d: 0.9, x: 0, y: (F + y0 - 0.3) / 2, z: -gz - 0.45 });

  // ---- the doorway's surround: two piers standing off the face with a
  // gablet over them. The piers are masonry a body walks into.
  const pierIn = doorW / 2;
  const pierOut = 2.15;
  const pierH = 4.0;
  const pierOff = 0.32;
  for (const k of [-1, 1]) {
    faceBlock(b, "-z", gz, (k * (pierIn + pierOut)) / 2, (y0 + pierH) / 2, pierOut - pierIn, pierH - y0, pierOff, pierOff / 2);
  }

  // ---- the buttresses: three a side between the bays, a pair at every free
  // corner of the nave and of the tower. Two boxes each.
  const bayZ = [-5, 0, 5];
  const naveBut = { y0, step: F + 2.9, top: F + 5.1, wide: 0.72, deep0: 0.85, deep1: 0.55, collide: true };
  for (const s of ["-x", "+x"] as const) {
    for (const z of bayZ) buttress(b, s, gx, z, naveBut);
    for (const k of [-1, 1]) buttress(b, s, gx, k * (gz - 0.36), naveBut);
  }
  for (const s of ["-z", "+z"] as const) {
    for (const k of [-1, 1]) buttress(b, s, gz, k * (gx - 0.36), naveBut);
  }
  const towerBut = { y0, step: F + 5.2, top: F + 11.6, wide: 0.66, deep0: 0.8, deep1: 0.5, collide: true };
  for (const k of [-1, 1]) {
    buttress(b, "+z", tzN, k * (tx - 0.33), towerBut);
    buttress(b, k < 0 ? "-x" : "+x", tx, tzN - 0.33, towerBut);
  }

  // ---- the belfry: the stage over the tower's walls, one mass to a round.
  const belfryTop = th + 4.5;
  b.wall(2 * tx, belfryTop - th, 2 * tx, 0, (th + belfryTop) / 2, tzc, STONE);

  // ---- the furniture that is cover. Every height is off the floor.
  const pewX0 = 1.1;
  const pewX1 = 4.1;
  const pewZ0 = -7.6;
  const pewZ1 = 3.2;
  for (const k of [-1, 1]) {
    b.block({ w: pewX1 - pewX0, h: 1.0, d: pewZ1 - pewZ0, x: (k * (pewX0 + pewX1)) / 2, y: F + 0.5, z: (pewZ0 + pewZ1) / 2 });
  }
  const fontX = -3.4;
  const fontZ = -8.2;
  b.block({ w: 1.0, h: 1.05, d: 1.0, x: fontX, y: F + 0.525, z: fontZ });
  // The pulpit stands on the chancel rather than across the end of the side
  // aisle: the 0.65 m it left against the wall is no gap on a 1.5 m grid, and
  // with the font pinching the other end the aisle was sealed on Cinderhaven.
  const pulpitX = -4.45;
  const pulpitZ = 5.3;
  b.block({ w: 1.2, h: 2.3, d: 1.2, x: pulpitX, y: F + 1.15, z: pulpitZ });
  const altarZ = 8.75;
  b.block({ w: 2.5, h: 1.05, d: 1.0, x: 0, y: FC + 0.525, z: altarZ });

  // ----------------------------------------------------------- the drawing
  //
  // Nothing below adds a collider.

  // ---- the plinth: a footing course from the lowest ground to a chamfer
  // half a metre over the floor, round the nave and the three free faces of
  // the tower, stopped at the doorway and where the tower meets the gable.
  const plinthTop = F + 0.45;
  const plinth = (s: Side, plane: number, a: number, c: number): void => {
    if (c - a < 0.05) return;
    onFace(b, s, plane, (a + c) / 2, (y0 + plinthTop) / 2, c - a, plinthTop - y0, 0.3, 0.15, DARK_STONE);
    offFacePoly(b, s, plane, [[0, plinthTop], [0.3, plinthTop], [0, plinthTop + 0.26]], a, c, MOSS_STONE);
  };
  plinth("-z", gz, -gx - 0.3, -doorW / 2 - 0.02);
  plinth("-z", gz, doorW / 2 + 0.02, gx + 0.3);
  plinth("+z", gz, -gx - 0.3, -tx);
  plinth("+z", gz, tx, gx + 0.3);
  for (const s of ["-x", "+x"] as const) plinth(s, gx, -gz - 0.3, gz + 0.3);
  plinth("+z", tzN, -tx - 0.3, tx + 0.3);
  for (const s of ["-x", "+x"] as const) plinth(s, tx, gz, tzN + 0.3);

  // ---- quoins where the nave's corners show between their buttresses, and
  // up the tower's.
  const quoins = (sx: number, sz: number, xc: number, zc: number, ya: number, yb: number): void => {
    const n = Math.max(2, Math.round((yb - ya) / 0.42));
    const qh = (yb - ya) / n;
    for (let i = 0; i < n; i++) {
      const [lx, lz] = i % 2 === 0 ? [0.55, 0.34] : [0.34, 0.55];
      b.box(lx, qh - 0.01, lz, sx * (xc + 0.05 - lx / 2), ya + (i + 0.5) * qh, sz * (zc + 0.05 - lz / 2), DARK_STONE);
    }
  };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) quoins(sx, sz, gx, gz, plinthTop + 0.26, h);
    quoins(sx, 1, tx, tzN, plinthTop + 0.26, belfryTop);
  }

  // ---- a string course under the sills of the side windows, and round the
  // tower at the eaves and under the belfry; the eaves course over a corbel
  // table down each flank, under the slate.
  const winSill = F + 2.3;
  const course = (s: Side, plane: number, a: number, c: number, y: number): void => {
    onFace(b, s, plane, (a + c) / 2, y, c - a, 0.16, 0.16, 0.08, DARK_STONE);
    offFacePoly(b, s, plane, [[0.02, y + 0.08], [0.16, y + 0.08], [0.02, y + 0.17]], a, c, DARK_STONE);
  };
  for (const s of ["-x", "+x"] as const) {
    course(s, gx, -gz, gz, winSill - 0.3);
    onFace(b, s, gx, 0, h - 0.1, 2 * gz + 0.1, 0.2, 0.3, 0.15, DARK_STONE);
    for (let z = -gz + 0.45; z < gz - 0.3; z += 0.62) {
      onFace(b, s, gx, z, h - 0.34, 0.2, 0.26, 0.22, 0.11, DARK_STONE);
    }
  }
  for (const y of [h + 0.2, th]) {
    course("+z", tzN, -tx - 0.02, tx + 0.02, y);
    for (const s of ["-x", "+x"] as const) course(s, tx, gz, tzN + 0.02, y);
  }
  course("-z", tzS, -tx - 0.02, tx + 0.02, th);

  // ---- the side windows: a lancet in every bay, lit, and its splay within.
  const bays = [-7.45, -2.5, 2.5, 7.45];
  for (const s of ["-x", "+x"] as const) {
    for (const z of bays) {
      lancet(b, s, gx, z, winSill, 0.8, 2.2, 0.8, { lit: CHAPEL_GLASS, fill: STONE, dress: DARK_STONE, hood: true, cames: true });
      lancet(b, inside(s), -ix, z, winSill, 0.8, 2.2, 0.8, { fill: LIMEWASH, dress: STONE });
    }
  }
  // Two in the back gable, flanking the tower, which light the altar.
  for (const k of [-1, 1]) {
    lancet(b, "+z", gz, k * 4.25, winSill + 0.2, 0.62, 2.0, 0.62, { lit: CHAPEL_GLASS, fill: STONE, dress: DARK_STONE, hood: true, cames: true });
    lancet(b, "-z", -iz, k * 4.25, winSill + 0.2, 0.62, 2.0, 0.62, { fill: LIMEWASH, dress: STONE });
  }

  // ---- the front: the doorway in its gabled surround, a niche over it, a
  // stepped triplet of lancets, an oculus in the apex of the gable.
  /** A pointed head over the opening's full width: see `archArc` on why it is never flatter. */
  const doorRise = 1.45;
  const doorSpring = doorH - doorRise;
  {
    // The head of the opening, through the wall's thickness, and its jambs
    // dressed through it — the smithy's reveal.
    for (const k of [-1, 1]) {
      const p0: Point3 = [k * (doorW / 2 + 0.03), doorSpring - 0.01, -gz - 0.02];
      const p1: Point3 = [k * (doorW / 2 + 0.03), doorH + 0.03, -gz - 0.02];
      const p2: Point3 = [0, doorH + 0.03, -gz - 0.02];
      convexSolid(b, [p0, p1, p2], [p0, p1, p2].map(([x, y, z]): Point3 => [x, y, z + t + 0.04]), STONE);
      const n = Math.max(3, Math.round((doorSpring - F) / 0.42));
      const jh = (doorSpring - F) / n;
      for (let i = 0; i < n; i++) {
        const lx = i % 2 === 0 ? 0.5 : 0.3;
        b.box(lx, jh - 0.01, t + 0.06, k * (doorW / 2 + lx / 2 - 0.03), F + (i + 0.5) * jh, -d / 2, DARK_STONE);
      }
    }
    // The surround: two piers, the spandrels over the arch, a gablet, a
    // moulded ring round the opening and a hood over it.
    const P = gz;
    for (const k of [-1, 1]) {
      onFace(b, "-z", P, (k * (pierIn + pierOut)) / 2, (y0 + pierH) / 2, pierOut - pierIn, pierH - y0, pierOff, pierOff / 2, STONE);
      facePoly(b, "-z", P, [[k * pierIn, doorSpring - 0.01], [0, doorH], [0, pierH], [k * pierIn, pierH]], 0, pierOff, STONE);
      // Its base, a weathered offset like the buttresses', and a shaft on the
      // outer order with a capital at the springing.
      offFacePoly(b, "-z", P, [[pierOff, F + 0.45], [pierOff + 0.08, F + 0.45], [pierOff + 0.08, y0], [pierOff, y0]], k * pierIn, k * pierOut, DARK_STONE);
      onFace(b, "-z", P, k * (pierIn + 0.14), (F + doorSpring) / 2, 0.16, doorSpring - F, 0.16, pierOff + 0.04, DARK_STONE);
      onFace(b, "-z", P, k * (pierIn + 0.14), doorSpring + 0.07, 0.3, 0.14, 0.24, pierOff + 0.05, DARK_STONE);
    }
    archRing(b, "-z", P, 0, doorSpring, doorW, doorRise, 0.13, 0.26, 0.14, pierOff + 0.03, DARK_STONE);
    archRing(b, "-z", P, 0, doorSpring, doorW, doorRise, 0.36, 0.1, 0.2, pierOff + 0.06, DARK_STONE);
    const gTopY = pierH + 1.45;
    facePoly(b, "-z", P, [[-pierOut - 0.05, pierH], [pierOut + 0.05, pierH], [0, gTopY]], 0, pierOff, STONE);
    const rake = Math.atan2(gTopY - pierH, pierOut + 0.05);
    for (const k of [-1, 1]) {
      const len = Math.hypot(gTopY - pierH, pierOut + 0.05);
      onFace(b, "-z", P, (k * (pierOut + 0.05)) / 2, (pierH + gTopY) / 2 + 0.1, len + 0.2, 0.16, pierOff + 0.14, pierOff / 2, DARK_STONE, -k * rake);
    }
    onFace(b, "-z", P, 0, pierH - 0.06, 2 * pierOut + 0.3, 0.12, pierOff + 0.12, pierOff / 2, DARK_STONE);
    // The cross on its apex, and the niche in its face.
    onFace(b, "-z", P, 0, gTopY + 0.38, 0.1, 0.62, 0.1, pierOff / 2, DARK_STONE);
    onFace(b, "-z", P, 0, gTopY + 0.5, 0.36, 0.1, 0.1, pierOff / 2, DARK_STONE);
    lancet(b, "-z", P + pierOff, 0, pierH + 0.2, 0.34, 0.45, 0.28, { fill: STONE, dress: DARK_STONE });
  }
  // The threshold and the step, and the leaves thrown back inside.
  onFace(b, "-z", gz, 0, (y0 + F) / 2, 3.4, F - y0, 0.9, 0.45, DARK_STONE);
  onFace(b, "-z", gz, 0, F - 0.02, doorW - 0.05, 0.06, t + 0.02, -t / 2, DARK_STONE);
  for (const k of [-1, 1]) {
    const u = k * (doorW / 2 + 0.7);
    const top = doorSpring + doorRise * 0.4;
    const mid = (F + 0.05 + top) / 2;
    onFace(b, "+z", -iz, u, mid, 1.3, top - F - 0.05, 0.09, 0.08, TIMBER);
    for (let j = 1; j < 5; j++) onFace(b, "+z", -iz, u - 0.65 + j * 0.26, mid, 0.025, top - F - 0.1, 0.02, 0.13, PLANK);
    for (const y of [F + 0.5, top - 0.5]) onFace(b, "+z", -iz, u + k * 0.1, y, 1.1, 0.08, 0.02, 0.135, IRON);
    onFace(b, "+z", -iz, u - k * 0.45, F + 1.2, 0.14, 0.14, 0.04, 0.14, IRON);
  }
  // The lantern beside the door on an iron arm — a lamp you see rather than
  // one that lights you (`BuildParams.lit`'s split): a light here measured
  // ~0.12 ms of the frame facing the front, and the chapel spends its one on
  // the nave. And the noticeboard.
  {
    const lu = 2.95;
    const ly = F + 3.0;
    offFace(b, "-z", gz, lu, 0.05, ly + 0.35, ly + 0.35, 0, 0.62, 0.05, IRON);
    offFace(b, "-z", gz, lu, 0.04, ly - 0.1, ly + 0.33, 0, 0.45, 0.04, IRON);
    const [lx, , lz] = facePoint("-z", gz, lu, 0, 0.6);
    b.box(0.018, 0.2, 0.018, lx, ly + 0.25, lz, IRON);
    b.glow(0.16, 0.24, 0.16, lx, ly, lz, FLAME);
    for (const a of [-1, 1]) for (const c of [-1, 1]) b.box(0.025, 0.3, 0.025, lx + a * 0.1, ly, lz + c * 0.1, IRON);
    b.box(0.26, 0.04, 0.26, lx, ly - 0.16, lz, IRON);
    pyramid(b, 4, 0.2, 0.02, ly + 0.14, ly + 0.3, lx, lz, IRON);

    const nu = -3.35;
    const ny = F + 1.7;
    onFace(b, "-z", gz, nu, ny, 0.95, 0.75, 0.06, 0.04, PLANK);
    for (const k of [-1, 1]) onFace(b, "-z", gz, nu + k * 0.5, ny - 0.1, 0.07, 0.95, 0.08, 0.05, TIMBER);
    onFace(b, "-z", gz, nu, ny + 0.41, 1.12, 0.07, 0.1, 0.05, TIMBER);
    offFace(b, "-z", gz, nu, 1.24, ny + 0.62, ny + 0.5, 0, 0.3, 0.04, SLATE);
    onFace(b, "-z", gz, nu - 0.2, ny + 0.05, 0.32, 0.42, 0.01, 0.075, SAILCLOTH, 0.04);
    onFace(b, "-z", gz, nu + 0.2, ny - 0.02, 0.28, 0.36, 0.01, 0.075, ASHLAR, -0.05);
  }
  // The triplet over the doorway, the centre light tallest, and the oculus.
  {
    const sill = 6.4;
    lancet(b, "-z", gz, 0, sill, 0.78, 1.95, 0.8, { lit: CHAPEL_GLASS, fill: STONE, dress: DARK_STONE, hood: true, cames: true });
    lancet(b, "+z", -iz, 0, sill, 0.78, 1.95, 0.8, { fill: LIMEWASH, dress: STONE });
    for (const k of [-1, 1]) {
      lancet(b, "-z", gz, k * 1.3, sill, 0.6, 1.45, 0.6, { lit: CHAPEL_GLASS, fill: STONE, dress: DARK_STONE, hood: true, cames: true });
      lancet(b, "+z", -iz, k * 1.3, sill, 0.6, 1.45, 0.6, { fill: LIMEWASH, dress: STONE });
    }
    const oy = 10.35;
    const [ox, , oz] = facePoint("-z", gz, 0, 0, 0.05);
    b.cyl(0.1, 1.25, 1.25, 16, ox, oy, oz, DARK_STONE, { x: Math.PI / 2 });
    b.cyl(0.1, 0.8, 0.8, 16, ox, oy, oz - 0.02, CASEMENT, { x: Math.PI / 2 });
    // Four spokes of tracery in it.
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      b.box(0.36, 0.05, 0.06, ox + 0.2 * Math.cos(a), oy + 0.2 * Math.sin(a), oz - 0.08, DARK_STONE, { z: a });
    }
    b.cyl(0.08, 0.95, 0.95, 16, 0, oy, -iz + 0.03, STONE, { x: Math.PI / 2 });
    b.cyl(0.06, 0.66, 0.66, 16, 0, oy, -iz + 0.06, CASEMENT, { x: Math.PI / 2 });
  }

  // ---- the roof, described by its UNDERSIDE — the smithy's construction,
  // steeper, and running into coped gables at both ends.
  const k = CHAPEL_PITCH;
  const pitch = Math.atan(k);
  const cosP = Math.cos(pitch);
  const T = 0.24;
  /** The eave's tip, horizontally from the ridge. */
  const xe = gx + 0.42;
  const under = (x: number): number => h - 0.02 + (gx - x) * k;
  const topAt = (x: number): number => under(x) + T / cosP;
  const ridgeTop = topAt(0);
  const slope = (sx: number, x0: number, x1: number, o0: number, o1: number, z0: number, z1: number, color: string): void => {
    const section = (z: number): Point3[] => [
      [sx * x0, under(x0) + o0 / cosP, z],
      [sx * x1, under(x1) + o0 / cosP, z],
      [sx * x1, under(x1) + o1 / cosP, z],
      [sx * x0, under(x0) + o1 / cosP, z],
    ];
    convexSolid(b, section(z0), section(z1), color);
  };
  for (const sx of [-1, 1]) {
    slope(sx, 0, xe, 0, T, -d / 2, d / 2, SLATE);
    for (const f of [0.16, 0.3, 0.44, 0.58, 0.72, 0.86]) {
      const xc = xe * f;
      slope(sx, xc - 0.04, xc + 0.04, T - 0.01, T + 0.035, -iz, iz, IRON);
    }
    b.box(0.05, 0.22, d, sx * (xe + 0.025), under(xe) + 0.07, 0, TIMBER);
  }
  b.box(0.3, 0.3, 2 * iz, 0, ridgeTop + 0.02, 0, DARK_STONE, { z: Math.PI / 4 });

  // The gables: stone carried past the slate, a coping up each rake and a
  // kneeler at each eave. The back one is cut where the tower stands in it.
  const parapet = 0.1;
  const COPE = 0.18;
  const gTop = (x: number): number => topAt(x) + parapet;
  const kx = gx - 0.22;
  for (const sz of [-1, 1]) {
    const zc = (sz * d) / 2;
    const cut = sz > 0 ? tx : 0;
    for (const sx of [-1, 1]) {
      const face = (z: number): Point3[] => [
        [sx * cut, h - 0.02, z],
        [sx * gx, h - 0.02, z],
        [sx * gx, gTop(gx), z],
        [sx * cut, gTop(cut), z],
      ];
      convexSolid(b, face(zc - t / 2), face(zc + t / 2), STONE);
      const cope = (z: number): Point3[] => [
        [sx * cut, gTop(cut), z],
        [sx * (gx - 0.2), gTop(gx - 0.2), z],
        [sx * (gx - 0.2), gTop(gx - 0.2) + COPE / cosP, z],
        [sx * cut, gTop(cut) + COPE / cosP, z],
      ];
      convexSolid(b, cope(zc - t / 2 - 0.07), cope(zc + t / 2 + 0.07), DARK_STONE);
      const ky0 = h - 0.08;
      const ky1 = gTop(kx) + COPE / cosP;
      b.box(xe + 0.05 - kx, ky1 - ky0, t + 0.12, (sx * (kx + xe + 0.05)) / 2, (ky0 + ky1) / 2, zc, DARK_STONE);
    }
  }
  {
    // A cross on the front apex, on a moulded base.
    const cy = gTop(0) + COPE / cosP;
    b.box(0.46, 0.22, t + 0.2, 0, cy + 0.08, -d / 2, DARK_STONE);
    b.box(0.16, 1.15, 0.16, 0, cy + 0.72, -d / 2, DARK_STONE);
    b.box(0.72, 0.16, 0.16, 0, cy + 0.92, -d / 2, DARK_STONE);
  }

  // ------------------------------------------------------------- the tower
  //
  // Three stages: the ground stage with a door into its base and a light over
  // it, the ringing stage with a clock on each flank, and the belfry with two
  // louvred lights a face. Over them a battlemented parapet, pinnacles, and
  // the spire.
  {
    // A door into the tower's base, shut, and a slit light over it.
    const dSill = Math.max(y0, F - 0.3);
    lancet(b, "+z", tzN, 0, dSill, 1.05, 1.95, 0.62, { fill: STONE, dress: DARK_STONE, hood: true });
    onFace(b, "+z", tzN, 0, dSill + 0.975, 1.0, 1.95, 0.06, 0.04, TIMBER);
    for (let j = 1; j < 4; j++) onFace(b, "+z", tzN, -0.5 + j * 0.25, dSill + 0.97, 0.025, 1.88, 0.02, 0.08, PLANK);
    for (const y of [dSill + 0.5, dSill + 1.65]) onFace(b, "+z", tzN, -0.1, y, 0.8, 0.07, 0.02, 0.085, IRON);
    onFace(b, "+z", tzN, 0.36, dSill + 1.0, 0.07, 0.14, 0.04, 0.09, IRON);
    onFace(b, "+z", tzN, 0, (y0 + dSill) / 2, 1.5, dSill - y0 + 0.02, 0.5, 0.25, DARK_STONE);
    lancet(b, "+z", tzN, 0, F + 5.0, 0.36, 1.2, 0.36, { fill: STONE, dress: DARK_STONE, hood: true });
    lancet(b, "+z", tzN, 0, F + 9.2, 0.36, 1.1, 0.36, { fill: STONE, dress: DARK_STONE, hood: true });

    // The clocks: a black dial in a stone ring, gilt marks and hands.
    for (const s of ["-x", "+x"] as const) {
      const cy = 12.35;
      const R = 0.78;
      const [cx, , cz] = facePoint(s, tx, tzc, 0, 0.04);
      const n = s === "+x" ? 1 : -1;
      b.cyl(0.08, 2 * R + 0.36, 2 * R + 0.36, 20, cx, cy, cz, DARK_STONE, { z: Math.PI / 2 });
      b.cyl(0.1, 2 * R, 2 * R, 20, cx + n * 0.03, cy, cz, PITCH, { z: Math.PI / 2 });
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        const long = i % 3 === 0;
        const r = R - (long ? 0.14 : 0.1);
        onFace(b, s, tx, tzc + r * Math.cos(a), cy + r * Math.sin(a), long ? 0.2 : 0.12, long ? 0.06 : 0.04, 0.02, 0.135, SULPHUR, a);
      }
      const hand = (a: number, len: number, wide: number): void => {
        onFace(b, s, tx, tzc + (len / 2 - 0.05) * Math.cos(a), cy + (len / 2 - 0.05) * Math.sin(a), len, wide, 0.02, 0.15, SULPHUR, a);
      };
      hand((5 * Math.PI) / 6, R * 0.55, 0.06);
      hand(Math.PI / 3, R * 0.82, 0.04);
      onFace(b, s, tx, tzc, cy, 0.09, 0.09, 0.03, 0.165, SULPHUR);
    }

    // The belfry openings: two lights a face under one hood, louvred.
    const bSill = th + 1.0;
    for (const [s, plane, uc] of [
      ["-z", tzS, 0],
      ["+z", tzN, 0],
      ["-x", tx, tzc],
      ["+x", tx, tzc],
    ] as const) {
      for (const kk of [-1, 1]) {
        const u = uc + kk * 0.62;
        lancet(b, s, plane, u, bSill, 0.72, 1.75, 0.55, { fill: STONE, dress: DARK_STONE });
        for (let i = 0; i < 6; i++) {
          const y = bSill + 0.18 + i * 0.27;
          onFace(b, s, plane, u, y, 0.74, 0.05, 0.2, 0.06, TIMBER);
        }
      }
      onFace(b, s, plane, uc, bSill + 0.9, 0.18, 1.8, 0.2, 0.08, DARK_STONE);
      archRing(b, s, plane, uc, bSill + 1.75, 2.24, 1.2, 0.05, 0.1, 0.2, 0.08, DARK_STONE);
    }

    // The cornice, a spout at each corner, the parapet and its merlons.
    const cy = belfryTop;
    for (const [s, plane, uc] of [
      ["-z", tzS, 0],
      ["+z", tzN, 0],
      ["-x", tx, tzc],
      ["+x", tx, tzc],
    ] as const) {
      onFace(b, s, plane, uc, cy - 0.12, 2 * tx + 0.36, 0.24, 0.34, 0.17, DARK_STONE);
    }
    const pw = 0.36;
    const pTop = cy + 0.8;
    for (const sx of [-1, 1]) {
      b.box(pw, 0.8, 2 * tx, sx * (tx - pw / 2), cy + 0.4, tzc, STONE);
      b.box(2 * tx, 0.8, pw, 0, cy + 0.4, tzc + sx * (tx - pw / 2), STONE);
    }
    for (const sx of [-1, 1]) {
      for (const f of [-0.33, 0.33]) {
        b.box(pw + 0.06, 0.62, 0.8, sx * (tx - pw / 2), pTop + 0.31, tzc + f * 2 * tx, STONE);
        b.box(0.8, 0.62, pw + 0.06, f * 2 * tx, pTop + 0.31, tzc + sx * (tx - pw / 2), STONE);
        b.box(pw + 0.16, 0.1, 0.9, sx * (tx - pw / 2), pTop + 0.67, tzc + f * 2 * tx, DARK_STONE);
        b.box(0.9, 0.1, pw + 0.16, f * 2 * tx, pTop + 0.67, tzc + sx * (tx - pw / 2), DARK_STONE);
      }
      b.box(pw + 0.12, 0.08, 2 * tx + 0.12, sx * (tx - pw / 2), pTop + 0.04, tzc, DARK_STONE);
      b.box(2 * tx + 0.12, 0.08, pw + 0.12, 0, pTop + 0.04, tzc + sx * (tx - pw / 2), DARK_STONE);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (tx - 0.25);
        const z = tzc + sz * (tx - 0.25);
        // The pinnacle: a shaft, a gabletted band and a crocketless cap.
        b.box(0.5, 1.3, 0.5, x, pTop + 0.65, z, STONE);
        b.box(0.6, 0.1, 0.6, x, pTop + 1.3, z, DARK_STONE);
        pyramid(b, 4, 0.36, 0.02, pTop + 1.35, pTop + 2.5, x, z, STONE);
        b.box(0.08, 0.2, 0.08, x, pTop + 2.55, z, DARK_STONE);
        // The spout, thrown out at the diagonal.
        const a = Math.atan2(sz, sx);
        b.box(0.75, 0.2, 0.22, x + 0.45 * Math.cos(a), cy - 0.3, z + 0.45 * Math.sin(a), DARK_STONE, { y: -a });
      }
    }

    // The spire: an octagon from inside the parapet, bands where it is
    // re-slated, lucarnes on the four cardinal faces, and the ball, the cross
    // arms and the cock on its rod.
    const s0 = cy + 0.1;
    const sTop = s0 + 9.6;
    const flat0 = 2.1;
    const r0 = flat0 / Math.cos(Math.PI / 8);
    pyramid(b, 8, r0, 0.03, s0, sTop, 0, tzc, SLATE);
    const flatAt = (y: number): number => flat0 * (1 - (y - s0) / (sTop - s0));
    for (const y of [s0 + 3.4, s0 + 6.3]) {
      pyramid(b, 8, (flatAt(y) + 0.03) / Math.cos(Math.PI / 8), (flatAt(y + 0.1) + 0.03) / Math.cos(Math.PI / 8), y, y + 0.1, 0, tzc, IRON);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const ly0 = s0 + 1.7;
      const ly1 = ly0 + 0.9;
      const dist = flatAt(ly0) - 0.05;
      const cx = dist * Math.cos(a);
      const cz = tzc + dist * Math.sin(a);
      const fx = Math.cos(a);
      const fz = Math.sin(a);
      b.box(0.72, ly1 - ly0, 0.72, cx, (ly0 + ly1) / 2, cz, SLATE, { y: -a });
      b.box(0.04, 0.62, 0.44, cx + fx * 0.37, ly0 + 0.4, cz + fz * 0.37, CASEMENT, { y: -a });
      for (let j = 0; j < 3; j++) {
        b.box(0.05, 0.05, 0.46, cx + fx * 0.4, ly0 + 0.2 + j * 0.2, cz + fz * 0.4, TIMBER, { y: -a });
      }
      // Its gablet, square to the face.
      const px = -fz;
      const pz = fx;
      const rim = (o: number): Point3[] => [
        [cx + fx * o + px * 0.42, ly1, cz + fz * o + pz * 0.42],
        [cx + fx * o - px * 0.42, ly1, cz + fz * o - pz * 0.42],
        [cx + fx * o, ly1 + 0.5, cz + fz * o],
      ];
      convexSolid(b, rim(-0.35), rim(0.42), SLATE);
    }
    const vy = sTop;
    b.cyl(0.24, 0.26, 0.26, 10, 0, vy + 0.08, tzc, SULPHUR);
    b.cyl(1.6, 0.05, 0.05, 6, 0, vy + 0.9, tzc, IRON);
    b.box(0.9, 0.035, 0.035, 0, vy + 0.95, tzc, IRON);
    b.box(0.035, 0.035, 0.9, 0, vy + 0.95, tzc, IRON);
    // The cock: tail, body and head in one silhouette, vane to the wind.
    b.box(0.03, 0.2, 0.46, 0, vy + 1.52, tzc + 0.05, SULPHUR);
    b.box(0.03, 0.34, 0.14, 0, vy + 1.62, tzc - 0.22, SULPHUR, { x: 0.35 });
    b.box(0.03, 0.14, 0.12, 0, vy + 1.72, tzc + 0.25, SULPHUR);
    b.box(0.03, 0.1, 0.06, 0, vy + 1.8, tzc + 0.3, LAMP_RED);
  }

  // -------------------------------------------------------------- the nave
  //
  // Limewash to the wall plate, a stone bench round the walls, a flagged
  // floor with an aisle down it, and the fittings from the font by the door
  // to the altar under its reredos.
  {
    const lw = 0.02;
    const top = h - 0.02;
    const wash = (s: Side, plane: number, a: number, c: number, y0w: number, y1w: number): void => {
      onFace(b, s, plane, (a + c) / 2, (y0w + y1w) / 2, c - a, y1w - y0w, lw, lw / 2, LIMEWASH);
    };
    for (const s of ["-x", "+x"] as const) wash(inside(s), -ix, -iz, iz, F, top);
    wash("-z", -iz, -ix, ix, F, top);
    wash("+z", -iz, -ix, -doorW / 2, F, top);
    wash("+z", -iz, doorW / 2, ix, F, top);
    wash("+z", -iz, -doorW / 2, doorW / 2, doorH, top);
    // The stone bench, and a skirting of the wall's own stone under the wash.
    for (const s of ["-x", "+x"] as const) {
      onFace(b, inside(s), -ix, 0, F + 0.21, 2 * iz - 0.2, 0.42, 0.34, 0.17, STONE);
      onFace(b, inside(s), -ix, 0, F + 0.43, 2 * iz - 0.1, 0.05, 0.4, 0.2, DARK_STONE);
    }

    // The floor: flags, an aisle of paler stone with a ledger in it, and the
    // chancel's step.
    b.box(2 * ix, F - y0, d - 0.02, 0, (F + y0) / 2, -t / 2, DARK_STONE);
    b.box(2.0, 0.02, chancelZ + iz - 0.05, 0, F + 0.01, (chancelZ - iz) / 2, STONE);
    for (let z = -iz + 0.9; z < chancelZ - 0.2; z += 0.9) b.box(2.0, 0.028, 0.03, 0, F + 0.014, z, DARK_STONE);
    b.box(0.03, 0.028, chancelZ + iz - 0.05, 0, F + 0.014, (chancelZ - iz) / 2, DARK_STONE);
    b.box(0.8, 0.035, 1.7, 0.45, F + 0.0175, -1.2, ASHLAR);
    b.box(2 * ix, FC - F, iz - chancelZ, 0, (F + FC) / 2, (iz + chancelZ) / 2, STONE);
    b.box(2 * ix, 0.05, 0.12, 0, FC - 0.02, chancelZ + 0.03, DARK_STONE);
    for (let z = chancelZ + 1.0; z < iz; z += 1.0) b.box(2 * ix, 0.012, 0.03, 0, FC + 0.006, z, DARK_STONE);

    // The pews, facing the altar on boarded platforms: a seat, a back with a
    // book ledge behind it, and a bench end at each end of the row.
    const pitchZ = (pewZ1 - pewZ0) / 10;
    for (const sx of [-1, 1]) {
      const xc = (sx * (pewX0 + pewX1)) / 2;
      const len = pewX1 - pewX0;
      b.box(len + 0.1, 0.1, pewZ1 - pewZ0 + 0.1, xc, F + 0.05, (pewZ0 + pewZ1) / 2, PLANK);
      for (let i = 0; i < 10; i++) {
        const z0 = pewZ0 + i * pitchZ;
        const seatZ = z0 + 0.36;
        b.box(len - 0.1, 0.05, 0.4, xc, F + 0.5, seatZ, PLANK);
        b.box(len - 0.1, 0.52, 0.045, xc, F + 0.74, z0 + 0.13, PLANK, { x: -0.1 });
        b.box(len - 0.1, 0.03, 0.14, xc, F + 0.98, z0 + 0.03, TIMBER);
        b.box(len - 0.1, 0.06, 0.05, xc, F + 0.24, seatZ, TIMBER);
        for (const end of [pewX0, pewX1]) {
          const x = sx * (end - (end === pewX0 ? -0.04 : 0.04));
          b.box(0.07, 0.92, pitchZ - 0.08, x, F + 0.56, z0 + pitchZ / 2 - 0.04, TIMBER);
          if (end === pewX0) b.box(0.11, 0.1, 0.16, x, F + 1.05, z0 + 0.16, TIMBER);
        }
      }
      // The front of the first row, a desk facing the chancel.
      b.box(len, 0.9, 0.05, xc, F + 0.55, pewZ1 - 0.02, PLANK);
      b.box(len, 0.04, 0.26, xc, F + 1.0, pewZ1 - 0.12, TIMBER);
    }

    // The font by the door: an octagonal bowl on a shaft, on a step, under a
    // timber cover with a spirelet.
    {
      const x = fontX;
      const z = fontZ;
      b.cyl(0.14, 1.14, 1.14, 8, x, F + 0.07, z, DARK_STONE);
      b.cyl(0.46, 0.34, 0.42, 8, x, F + 0.37, z, STONE);
      b.cyl(0.36, 0.84, 0.6, 8, x, F + 0.78, z, STONE);
      b.cyl(0.05, 0.88, 0.88, 8, x, F + 0.95, z, DARK_STONE);
      b.cyl(0.07, 0.8, 0.8, 8, x, F + 1.0, z, TIMBER);
      pyramid(b, 8, 0.36, 0.02, F + 1.03, F + 1.5, x, z, TIMBER);
      b.box(0.05, 0.1, 0.05, x, F + 1.53, z, IRON);
    }

    // The pulpit: an octagonal drum on a stem, its stair along the wall from
    // the nave, and the sounding board over it hung off a back board.
    {
      const x = pulpitX;
      const z = pulpitZ;
      const fl = F + 1.25;
      b.cyl(fl - FC, 0.3, 0.5, 8, x, (FC + fl) / 2, z, TIMBER);
      b.cyl(1.05, 1.1, 1.0, 8, x, fl + 0.45, z, TIMBER);
      b.cyl(0.06, 1.18, 1.18, 8, x, fl + 1.0, z, PLANK);
      b.cyl(0.06, 1.04, 1.04, 8, x, fl - 0.05, z, PLANK);
      for (let i = 0; i < 4; i++) {
        const sy = F + (i + 1) * ((fl - F) / 4);
        const sz = z - 1.5 + i * 0.28;
        b.box(0.62, 0.06, 0.3, -ix + 0.38, sy - 0.03, sz, TIMBER);
        b.box(0.62, sy - 0.06 - F, 0.04, -ix + 0.38, (F + sy - 0.06) / 2, sz + 0.13, PLANK);
      }
      onFace(b, "+x", -ix, z, fl + 1.35, 0.9, 1.7, 0.06, 0.05, PLANK);
      b.cyl(0.1, 1.5, 1.5, 8, x + 0.1, fl + 2.35, z, TIMBER);
      b.cyl(0.08, 1.3, 1.3, 8, x + 0.1, fl + 2.46, z, PLANK);
      // A Bible on its desk.
      b.box(0.34, 0.04, 0.26, x + 0.4, fl + 1.03, z, LAMP_RED, { z: -0.25 });
    }

    // The lectern: a desk on a turned post, the book open on it.
    {
      const x = 3.7;
      const z = 4.15;
      b.box(0.6, 0.06, 0.1, x, F + 0.03, z, TIMBER);
      b.box(0.1, 0.06, 0.6, x, F + 0.03, z, TIMBER);
      b.cyl(1.05, 0.08, 0.12, 8, x, F + 0.56, z, TIMBER);
      b.box(0.56, 0.05, 0.42, x, F + 1.15, z - 0.02, TIMBER, { x: 0.35 });
      for (const kk of [-1, 1]) b.box(0.22, 0.02, 0.3, x + kk * 0.12, F + 1.19, z - 0.02, SAILCLOTH, { x: 0.35, z: kk * 0.06 });
    }

    // The altar rail with its kneeler, open in the middle.
    {
      const z = 6.3;
      for (const sx of [-1, 1]) {
        const a = 0.7;
        const c = ix - 0.45;
        const xc = (sx * (a + c)) / 2;
        b.box(c - a, 0.07, 0.14, xc, FC + 0.84, z, TIMBER);
        b.box(c - a, 0.05, 0.1, xc, FC + 0.1, z, TIMBER);
        for (let x = a + 0.12; x < c; x += 0.26) b.box(0.05, 0.72, 0.05, sx * x, FC + 0.46, z, TIMBER);
        for (const x of [a, c]) b.box(0.12, 0.92, 0.12, sx * x, FC + 0.46, z, TIMBER);
        b.box(c - a, 0.1, 0.34, xc, FC + 0.05, z - 0.36, LAMP_RED);
      }
    }

    // The altar in its frontal and linen, candles and a cross, before a
    // panelled reredos with a blind arcade and a cresting.
    {
      const z = altarZ;
      const top = FC + 1.0;
      b.box(2.2, 0.96, 0.82, 0, FC + 0.48, z, TIMBER);
      b.box(2.32, 0.8, 0.9, 0, FC + 0.58, z - 0.01, LAMP_RED);
      b.box(2.36, 0.1, 0.92, 0, FC + 0.97, z - 0.01, SULPHUR);
      b.box(2.5, 0.03, 0.96, 0, top + 0.015, z, SAILCLOTH);
      for (const kk of [-1, 1]) b.box(0.03, 0.34, 0.96, kk * 1.25, top - 0.15, z, SAILCLOTH);
      b.box(0.2, 0.62, 0.02, 0, FC + 0.58, z - 0.47, SULPHUR);
      for (const kk of [-1, 1]) {
        const x = kk * 0.78;
        b.cyl(0.05, 0.2, 0.2, 8, x, top + 0.05, z + 0.15, SULPHUR);
        b.cyl(0.36, 0.05, 0.08, 6, x, top + 0.25, z + 0.15, SULPHUR);
        b.cyl(0.03, 0.14, 0.14, 8, x, top + 0.44, z + 0.15, SULPHUR);
        b.cyl(0.26, 0.05, 0.05, 6, x, top + 0.58, z + 0.15, SAILCLOTH);
        b.flame(0.018, 0.075, x, top + 0.71, z + 0.15, 0);
      }
      b.box(0.28, 0.08, 0.16, 0, top + 0.04, z + 0.22, SULPHUR);
      b.box(0.05, 0.58, 0.05, 0, top + 0.37, z + 0.22, SULPHUR);
      b.box(0.3, 0.05, 0.05, 0, top + 0.52, z + 0.22, SULPHUR);

      const ru = 3.4;
      const r0 = top + 0.05;
      const r1 = top + 2.1;
      onFace(b, "-z", -iz, 0, (r0 + r1) / 2, ru, r1 - r0, 0.08, 0.04, TIMBER);
      for (let i = 0; i < 5; i++) {
        const u = -ru / 2 + (i + 0.5) * (ru / 5);
        onFace(b, "-z", -iz, u, r0 + 0.8, 0.46, 1.3, 0.02, 0.09, PITCH);
        archRing(b, "-z", -iz, u, r0 + 1.45, 0.46, 0.34, 0.03, 0.06, 0.04, 0.1, SULPHUR);
        for (const kk of [-1, 1]) onFace(b, "-z", -iz, u + kk * 0.28, r0 + 0.8, 0.08, 1.4, 0.05, 0.1, TIMBER);
      }
      onFace(b, "-z", -iz, 0, r0 + 0.08, ru + 0.1, 0.12, 0.14, 0.1, TIMBER);
      onFace(b, "-z", -iz, 0, r1, ru + 0.2, 0.14, 0.16, 0.1, TIMBER);
      for (let i = 0; i < 11; i++) {
        const u = -ru / 2 + 0.05 + (i * (ru - 0.1)) / 10;
        facePoly(b, "-z", -iz, [[u - 0.1, r1 + 0.07], [u + 0.1, r1 + 0.07], [u, r1 + 0.26]], 0.04, 0.12, TIMBER);
      }
    }

    // Memorials on the walls between the lights, and the hymn board.
    for (const [s, z, big] of [
      ["+x", -5, false],
      ["+x", 0, true],
      ["-x", -5, true],
      ["-x", 0, false],
    ] as const) {
      const si = inside(s);
      const y = F + (big ? 2.9 : 2.7);
      const ww = big ? 0.9 : 0.62;
      const hh = big ? 1.05 : 0.72;
      onFace(b, si, -ix, z, y, ww, hh, 0.06, 0.05, ASHLAR);
      onFace(b, si, -ix, z, y - hh / 2 - 0.05, ww + 0.14, 0.1, 0.12, 0.07, DARK_STONE);
      onFace(b, si, -ix, z, y + hh / 2 + 0.04, ww + 0.1, 0.08, 0.1, 0.06, DARK_STONE);
      facePoly(b, si, -ix, [[z - ww / 2 - 0.05, y + hh / 2 + 0.08], [z + ww / 2 + 0.05, y + hh / 2 + 0.08], [z, y + hh / 2 + (big ? 0.38 : 0.26)]], 0.02, 0.1, DARK_STONE);
      for (let j = 0; j < (big ? 4 : 3); j++) onFace(b, si, -ix, z, y + hh * 0.25 - j * 0.14, ww * 0.62, 0.025, 0.01, 0.085, DARK_STONE);
      onFace(b, si, -ix, z, y - hh / 2 - 0.2, 0.14, 0.2, 0.1, 0.07, DARK_STONE);
    }
    {
      const u = 1.35;
      const y = F + 1.7;
      onFace(b, "+x", -ix, u, y, 0.6, 0.8, 0.04, 0.04, TIMBER);
      facePoly(b, "+x", -ix, [[u - 0.34, y + 0.4], [u + 0.34, y + 0.4], [u, y + 0.62]], 0.02, 0.07, TIMBER);
      for (let j = 0; j < 4; j++) onFace(b, "+x", -ix, u, y + 0.27 - j * 0.18, 0.4, 0.1, 0.01, 0.065, SAILCLOTH);
    }

    // A parish chest in the corner behind the pews.
    {
      const x = 4.55;
      const z = -8.55;
      b.box(1.3, 0.55, 0.56, x, F + 0.275, z, TIMBER);
      b.box(1.36, 0.08, 0.62, x, F + 0.58, z, PLANK);
      for (const kk of [-0.4, 0, 0.4]) b.box(0.06, 0.6, 0.6, x + kk, F + 0.3, z, IRON);
    }
  }

  // ---- the roof inside: boarding under the slate, common rafters, purlins,
  // wall plates, and an arch-braced collar truss at each buttress on wall
  // posts that stand on corbels.
  {
    for (const sx of [-1, 1]) {
      slope(sx, 0, gx, -0.03, 0, -iz, iz, PLANK);
      b.box(0.36, 0.26, 2 * iz, sx * (ix + 0.1), h + 0.1, 0, TIMBER);
      for (let z = -iz + 0.3; z < iz - 0.1; z += 0.55) {
        if (bayZ.some((bz) => Math.abs(bz - z) < 0.2)) continue;
        slope(sx, 0.08, gx - 0.05, -0.17, -0.03, z - 0.045, z + 0.045, TIMBER);
      }
      for (const px of [1.9, 4.0]) slope(sx, px - 0.12, px + 0.12, -0.38, -0.17, -iz, iz, TIMBER);
    }
    b.box(0.16, 0.3, 2 * iz, 0, under(0) - 0.2, 0, TIMBER);
    const ycol = 9.6;
    const xc = gx - (ycol + 0.45 - (h - 0.02)) / k;
    const post0 = h - 1.8;
    for (const z of bayZ) {
      for (const sx of [-1, 1]) {
        slope(sx, 0.1, ix + 0.2, -0.4, -0.03, z - 0.11, z + 0.11, TIMBER);
        b.box(0.22, 1.95, 0.22, sx * (ix - 0.12), post0 + 0.975, z, TIMBER);
        b.box(0.34, 0.26, 0.36, sx * (ix - 0.14), post0 - 0.13, z, DARK_STONE);
        b.box(0.26, 0.12, 0.3, sx * (ix - 0.1), post0 - 0.32, z, DARK_STONE);
        // The arch brace: a quarter of an ellipse from the post's foot to the
        // collar's end, in three straight lengths.
        const ax = ix - 0.24;
        const cyE = post0 + 0.1;
        const e = Math.min(0.97, xc / ax);
        const ay = (ycol - 0.13 - cyE) / Math.sqrt(1 - e * e);
        const phiEnd = Math.acos(e);
        const pts: [number, number][] = [];
        for (let i = 0; i <= 3; i++) {
          const phi = (phiEnd * i) / 3;
          pts.push([ax * Math.cos(phi), cyE + ay * Math.sin(phi)]);
        }
        for (let i = 0; i < 3; i++) {
          const [xa, ya] = pts[i];
          const [xb, yb] = pts[i + 1];
          const len = Math.hypot(xb - xa, yb - ya);
          const ang = Math.atan2(yb - ya, sx * (xb - xa));
          b.box(len + 0.05, 0.17, 0.16, (sx * (xa + xb)) / 2, (ya + yb) / 2, z, TIMBER, { z: fold(ang) });
        }
      }
      b.box(2 * xc + 0.2, 0.26, 0.22, 0, ycol, z, TIMBER);
    }

    // The corona over the aisle, hung from the middle collar: an iron ring
    // with candles round it, and the light the nave is read by — the chapel's
    // ONLY light, as the old tower lamp was its only one, reaching the altar
    // as well. A light costs every pixel in its range and a visibility channel
    // in the GI, ~0.1-0.2 ms each facing the chapel, so the altar candles and
    // the door lantern are flames and glass and nothing more.
    const cy = F + 4.1;
    b.box(0.02, ycol - cy - 0.9, 0.02, 0, (ycol + cy + 0.8) / 2, 0, IRON);
    b.cyl(0.05, 0.1, 0.1, 8, 0, cy + 0.8, 0, IRON);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = 0.56;
      b.box(0.44, 0.05, 0.035, r * Math.cos(a + Math.PI / 8), cy, r * Math.sin(a + Math.PI / 8), IRON, { y: -(a + Math.PI / 8) - Math.PI / 2 });
      if (i % 2 === 0) {
        // A chain from the ring up to the hook, leaning in.
        b.box(0.02, 1.0, 0.02, 0.3 * Math.cos(a), cy + 0.4, 0.3 * Math.sin(a), IRON, { z: Math.cos(a) * 0.64, x: -Math.sin(a) * 0.64 });
      }
      const x = 0.6 * Math.cos(a);
      const z = 0.6 * Math.sin(a);
      b.cyl(0.03, 0.09, 0.09, 6, x, cy + 0.04, z, IRON);
      b.cyl(0.16, 0.04, 0.04, 6, x, cy + 0.13, z, SAILCLOTH);
      b.flame(0.014, 0.055, x, cy + 0.21, z, 0);
    }
    // Its range reaches every corner of the nave, gable apexes included: the
    // edge of a range is a BAND edge in the cel shader, and one that fell on
    // the back wall drew a hard arc across it.
    b.light(FLAME, 13.5, 1.8, 0.3, 0, cy + 0.2, 0.5);
  }

  return b;
}
