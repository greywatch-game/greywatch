/**
 * kit/desert/caravanserai.ts — buildCaravanserai: the inn built as a fort —
 * four ranges round a courtyard, one gate and a walked terrace over the whole
 * of it — and `arcade`, the punched wall run its inner faces are made of.
 * Part of the desert-town set: follows the contract in kit/core.ts and the
 * set's rules in `./index.ts`. Invariants: colliders in the set's order.
 * Never imports another builder.
 */
import { Scene } from "@babylonjs/core";
import { CONFIG } from "../../../config";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Structure,
} from "../core";
import {
  MUDBRICK,
  MUDBRICK_DARK,
  ROOF_MUD,
  PALM_BEAM,
  PLINTH,
  SLAB,
  STOREY,
  PARAPET,
  PARAPET_T,
  GRADE,
  levels,
  clothHash,
  drape,
  parapet,
  windowRow,
} from "./shared";

/**
 * A wall run punched with evenly spaced openings, along X or along Z.
 *
 * The third form of wall this set needs, and the one `doorWall` cannot be:
 * that one puts ONE gap in the middle of a run along X, which is what a house's
 * front is. An arcade is a row of them, and the building below that has a
 * courtyard is defined by the fact that its inner face is more opening than
 * wall — a range you can enter anywhere is a building a squad flows through,
 * and a range with one door is a building they queue at.
 *
 * The lintels over the gaps are `wall` and not `box`, which is the honest
 * answer for mud brick: a lintel course at head height stops a round fired at
 * the roof line from the far side of the court, and leaving it visual would let
 * one through a wall that visibly has none.
 */
function arcade(
  b: Build,
  alongZ: boolean,
  len: number,
  h: number,
  t: number,
  cx: number,
  y: number,
  cz: number,
  color: string,
  gaps: number,
  gapW = 2.3,
  gapH = 2.35,
): void {
  const seg = (len - gaps * gapW) / (gaps + 1);
  const put = (span: number, height: number, at: number, cy: number): void => {
    if (span <= 0.06 || height <= 0.06) return;
    const x = alongZ ? cx : cx + at;
    const z = alongZ ? cz + at : cz;
    b.wall(alongZ ? t : span, height, alongZ ? span : t, x, cy, z, color);
  };
  for (let i = 0; i <= gaps; i++) {
    put(seg, h, -len / 2 + i * (seg + gapW) + seg / 2, y);
  }
  const lintel = h - gapH;
  for (let i = 0; i < gaps; i++) {
    put(gapW, lintel, -len / 2 + seg + i * (seg + gapW) + gapW / 2, y + h / 2 - lintel / 2);
  }
}

/**
 * The caravanserai: an inn built as a fort — four ranges of rooms round a
 * courtyard, one gate, and a walked terrace over the whole of it.
 *
 * ## What it is FOR, and why a map wants one rather than ten
 *
 * Every other enclosure in this town is a COMPOUND — a wall with one side left
 * open, which the nav graph routes through and a squad walks into without
 * slowing down. This is the opposite object and the only one on the map: a
 * closed rectangle with a single arched passage through it, ranges you fight
 * along, and a terrace all the way round the top that overlooks its own court
 * and the streets outside it in the same breath.
 *
 * So it plays as the one place the fight has a DOOR. Holding the terrace is
 * holding the gate; taking it is either eight metres of arched passage in
 * single file, or getting onto a range roof off a neighbouring house and
 * dropping in. Both are on purpose, and the second is why the terrace is at an
 * ordinary storey rather than two — a fort with no way in but the gate is a
 * fort that is never taken, which is a boring flag.
 *
 * ## The construction, and the two things that are not obvious
 *
 * **The terrace is FOUR slabs and not one.** Two span the full width along ±Z
 * and two fill what is left along ±X, which is what leaves the court open; the
 * corners belong to the ±Z pair, so nothing is drawn twice and nothing is
 * missing. The parapets come in pairs for the same reason: an outer one
 * standing on the outer wall, which costs no walked cell (`parapet`'s
 * argument), and an inner one on the court's edge, which costs one and is worth
 * it — a terrace you can be shot off from inside your own court is not a
 * terrace.
 *
 * **The stair is a straight flight in the court**, `Build.flight` rather than
 * the lane every other climbed building here uses. There is no lane because
 * there is no plate to cut one out of: the walked surface is a RING, and a ring
 * has an inside edge a flight can land on anywhere. It runs along Z because
 * `flight` does.
 *
 * `width` and `depth` are the OUTER footprint and the court is what is left
 * after `RANGE` off each side, so a serai under about 28 m has no court at all
 * and one under about 32 m of depth has no room for its own stair. The DEV
 * throw below says which rather than emitting a solid block with a terrace
 * nothing reaches.
 */
export function buildCaravanserai(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "serai");
  const w = p.width ?? 44;
  const d = p.depth ?? 38;
  const skin = p.tint ?? MUDBRICK;
  /** How deep a range of rooms is. One number: the four ranges are the same. */
  const RANGE = 7.5;
  const t = 0.55;
  const ys = levels(1, STOREY);
  const roofY = ys[1];
  const wallTop = roofY - SLAB;
  const courtW = w - 2 * RANGE;
  const courtD = d - 2 * RANGE;
  const rise = roofY - ys[0];
  const run = rise / GRADE;

  if (import.meta.env.DEV && (courtW < 9 || courtD < run + 3)) {
    throw new Error(
      `caravanserai: ${w} x ${d} leaves a ${courtW.toFixed(1)} x ${courtD.toFixed(1)} m ` +
        `court, which cannot hold the ${run.toFixed(1)} m flight up to its own ` +
        "terrace. Widen it; see kit/desert/caravanserai.ts.",
    );
  }

  // 1 — the plinth: the whole footprint, gate passage included.
  b.box(w + 0.6, PLINTH, d + 0.6, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  b.block({ w: w + 0.6, h: PLINTH, d: d + 0.6, x: 0, y: PLINTH / 2, z: 0 });

  // 2 — the flight, in the court, landing on the +Z range's inner edge.
  b.flight({
    x: -courtW * 0.22,
    w: 3.0,
    topZ: courtD / 2,
    topY: roofY,
    run,
    rise,
    dir: 1,
    steps: Math.max(10, Math.round(rise / 0.19)),
    color: PALM_BEAM,
  });

  // 4 — the walls. Outer first, then the four inner faces onto the court.
  const h = wallTop - PLINTH;
  const mid = PLINTH + h / 2;
  // The gate: one arched passage through the -Z range, and the only way in.
  // `doorWall` leaves a lintel course over it, which is what the terrace slab
  // above lands on.
  b.doorWall(w, h, t, 0, mid, -(d - t) / 2, skin, 4.6, 3.0);
  b.wall(w, h, t, 0, mid, (d - t) / 2, skin);
  for (const sx of [-1, 1] as const) {
    b.wall(t, h, d - 2 * t, (sx * (w - t)) / 2, mid, 0, skin);
  }
  // The passage's own two walls, which is what makes it a passage rather than a
  // hole: seven metres of blind corridor with the court at the end of it.
  for (const sx of [-1, 1] as const) {
    b.wall(t, h, RANGE, sx * 2.85, mid, -(d - RANGE) / 2, skin);
  }
  // The inner faces. The long ranges are arcades — a range you enter anywhere —
  // and the -Z one is punched less because the passage is already through it.
  arcade(b, false, courtW + 2 * t, h, t, 0, mid, (courtD + t) / 2, skin, 3);
  arcade(b, false, courtW + 2 * t, h, t, 0, mid, -(courtD + t) / 2, skin, 2);
  for (const sx of [-1, 1] as const) {
    arcade(b, true, courtD, h, t, (sx * (courtW + t)) / 2, mid, 0, skin, 3);
  }
  // The cross walls that make the side ranges into ROOMS rather than one
  // corridor each. Two per range, so a body can still get down one.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      b.wall(RANGE - t, h, t, (sx * (w - RANGE)) / 2, mid, (sz * courtD) / 3, skin);
    }
  }
  b.box(w + 0.4, 0.18, d + 0.4, 0, wallTop - 0.09, 0, MUDBRICK_DARK);

  // The elevation: small high openings and nothing else. This is a building
  // whose windows face inward, which is most of what a caravanserai is.
  for (const sz of [-1, 1] as const) {
    windowRow(b, w - 8, wallTop - 1.05, (sz * d) / 2 + sz * 0.02, false, Math.round(w / 7));
  }
  for (const sx of [-1, 1] as const) {
    windowRow(b, d - 8, wallTop - 1.05, (sx * w) / 2 + sx * 0.02, true, Math.round(d / 7));
  }

  // 5 — the terrace, four slabs. See `buildCaravanserai`'s header.
  for (const sz of [-1, 1] as const) {
    b.box(w, SLAB, RANGE, 0, roofY - SLAB / 2, (sz * (d - RANGE)) / 2, ROOF_MUD);
    b.block({ w, h: SLAB, d: RANGE, x: 0, y: roofY - SLAB / 2, z: (sz * (d - RANGE)) / 2 });
  }
  for (const sx of [-1, 1] as const) {
    b.box(RANGE, SLAB, courtD, (sx * (w - RANGE)) / 2, roofY - SLAB / 2, 0, ROOF_MUD);
    b.block({
      w: RANGE,
      h: SLAB,
      d: courtD,
      x: (sx * (w - RANGE)) / 2,
      y: roofY - SLAB / 2,
      z: 0,
    });
  }

  // 6 — the parapets, outer then inner.
  parapet(b, w, d, roofY, skin, MUDBRICK_DARK);
  for (const sz of [-1, 1] as const) {
    const z = (sz * (courtD + PARAPET_T)) / 2;
    b.wall(courtW, PARAPET, PARAPET_T, 0, roofY + PARAPET / 2, z, skin);
    b.box(courtW + 0.16, 0.14, PARAPET_T + 0.16, 0, roofY + PARAPET + 0.07, z, MUDBRICK_DARK);
  }
  for (const sx of [-1, 1] as const) {
    const x = (sx * (courtW + PARAPET_T)) / 2;
    b.wall(PARAPET_T, PARAPET, courtD, x, roofY + PARAPET / 2, 0, skin);
    b.box(PARAPET_T + 0.16, 0.14, courtD, x, roofY + PARAPET + 0.07, 0, MUDBRICK_DARK);
  }

  // 7 — the two gate towers, flanking the passage and standing off the terrace.
  // They are the silhouette from outside and the strongest position on it from
  // inside: everything else up here is chest cover, and these are a wall.
  for (const sx of [-1, 1] as const) {
    const x = sx * 5.8;
    const z = -(d - RANGE) / 2;
    const th = 2.9;
    b.box(3.5, th, 3.5, x, roofY + th / 2, z, skin);
    b.block({ w: 3.5, h: th, d: 3.5, x, y: roofY + th / 2, z });
    b.box(3.9, 0.2, 3.9, x, roofY + th + 0.1, z, MUDBRICK_DARK);
    for (let i = 0; i < 3; i++) {
      b.box(0.5, 0.55, 0.5, x + sx * 1.5, roofY + th + 0.48, z - 1.4 + i * 1.4, skin);
    }
  }

  // The court's arcade: piers in front of the two side ranges carrying a beam,
  // with the awnings strung between them. `buildSouk`'s construction, and the
  // reuse is deliberate — the two are the same street furniture in different
  // plans, and it is what makes a quarter of these read as one town.
  const bays = Math.max(3, Math.round(courtD / 4.2));
  for (const sx of [-1, 1] as const) {
    const px = (sx * (courtW - 1.6)) / 2;
    for (let i = 0; i <= bays; i++) {
      b.wall(0.7, 2.5, 0.7, px, PLINTH + 1.25, -courtD / 2 + (i / bays) * courtD, MUDBRICK);
    }
    b.box(0.9, 0.4, courtD, px, PLINTH + 2.7, 0, PALM_BEAM);
    for (let i = 0; i < bays; i++) {
      b.translucentBox(
        1.9,
        0.08,
        courtD / bays - 0.5,
        px - sx * 1.35,
        PLINTH + 2.42,
        -courtD / 2 + ((i + 0.5) / bays) * courtD,
        i % 2 === 0 ? "#a8703f" : "#8d6a4a",
        CONFIG.graphics.translucency.awning,
        { z: -sx * 0.11 },
      );
    }
  }

  // The washing over the court, on the -Z range's inner parapet. ONE drape and
  // not a line of them: this is the biggest thing in the town and the point of
  // cloth on it is that the eye finds the one thing moving, which a row of six
  // is not.
  const hung = clothHash(w, d);
  drape(b, 0.9 + hung * 0.4, 1.0, courtW * 0.2, roofY + PARAPET, -(courtD + PARAPET_T) / 2, -1, hung);
  return b;
}
