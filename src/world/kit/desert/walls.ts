/**
 * kit/desert/walls.ts — The runs a desert town is divided by and the hard
 * furniture a contested one grows: buildCompoundWall, buildBlastWall (the
 * T-wall run) and buildSandbags (the emplacement). Part of the desert-town
 * set: follows the contract in kit/core.ts and the set's rules in
 * `./index.ts`. Invariants: variation comes from a builder's params, never
 * `Math.random()`. Never imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  CONCRETE,
  DARK_CONCRETE,
  IRON,
  TEAK,
  TIMBER,
  groundRun,
  type BuildCtx,
  type BuildParams,
  type Structure,
} from "../core";
import {
  MUDBRICK,
  MUDBRICK_DARK,
  SANDBAG,
  clothHash,
  drape,
} from "./shared";

/**
 * A compound wall run along X: the thing a desert town is actually made of.
 *
 * Head-high and opaque, so it breaks a sightline rather than only a walking
 * line — `buildStoneWall`'s argument in a different vernacular, and the reason
 * this is not that builder is that a dry-stone field wall is 1.5 m and this is
 * 2.6: you cannot see over a compound wall, and a town of them is a maze at eye
 * level and a plain from any roof. That relationship IS the map.
 *
 * **Author it in runs with gaps.** A sealed compound is a wall the nav grid
 * routes bots the whole way around, and a layout has no way to say "there is a
 * gate here" other than two runs with a space between them.
 *
 * On a slope it steps between piers, `buildStoneWall`'s way (`groundRun`).
 */
export function buildCompoundWall(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "compound");
  const len = p.length ?? 14;
  const h = p.height ?? 2.6;
  const skin = p.tint ?? MUDBRICK;
  const run = groundRun(ctx, len, { pitch: 5, depth: 0.62, pad: 0.31, between: true });
  for (const s of run.spans) {
    const w = s.x1 - s.x0;
    const x = (s.x0 + s.x1) / 2;
    const top = s.ground + h;
    b.wall(w, top - s.base, 0.4, x, (top + s.base) / 2, 0, skin);
    // The coping, and a pier every few metres. The silhouette is what sells mud
    // brick, since the shader gives it no texture: a wall with a stepped head and
    // buttresses reads as built, and a bare slab reads as a fence.
    b.box(w, 0.16, 0.56, x, top + 0.08, 0, MUDBRICK_DARK);
  }
  const piers = run.joints.length - 1;
  for (const j of run.joints) {
    const top = j.ground + h + 0.3;
    b.box(0.62, top - j.base, 0.62, j.x, (top + j.base) / 2, 0, skin);
  }

  // A rag tied along the head of the wall, on about one run in four.
  //
  // **Sparse on purpose, and the fraction is the whole design.** There are 298
  // of these on Sarab and they are what the town is made of; cloth on all of
  // them would be a texture rather than an event, and the point of a thing that
  // moves on a still map is that your eye goes to it. One in four leaves
  // roughly eighty across nine hundred metres, which is enough that no quarter
  // is without one and few enough that each is worth a glance.
  //
  // It hangs in a BAY rather than anywhere along the run: the piers stand 0.11
  // proud of the wall face, so a sheet placed across one would be half behind
  // it. The top is at `h`, the coping's underside — `drape`'s rule, and here
  // the cap oversails by the same 0.08 the parapet's does.
  //
  // On a stepped run the head has to lie under ONE coping, so a rag whose width
  // would cross a step is not tied at all rather than hung through the wall.
  const tied = clothHash(len, h);
  if (len >= 9 && tied < 0.27) {
    const bay = Math.floor(tied * 3.7 * piers) % piers;
    const w = 0.52 + tied * 0.7;
    const x = -len / 2 + ((bay + 0.5) / piers) * len;
    const reach = (w + 0.12) / 2;
    const under = run.spans.filter((s) => s.x1 > x - reach && s.x0 < x + reach);
    if (under.every((s) => s.ground === under[0].ground)) {
      drape(b, w, 0.72 + tied * 0.5, x, under[0].ground + h, -0.2, -1, tied);
    }
  }
  return b;
}

/**
 * A run of T-walls along X: the concrete a town grows once it is being fought
 * over, and the one piece of cover on this map nobody who lives here built.
 *
 * **One collider for the run, and the panels are visual.** This is the fence's
 * construction with the opposite verdict on `porous`: a T-wall run is three
 * metres of continuous reinforced concrete and a round stops on all of it, so
 * the coarse box is an ordinary collider and there is nothing for `strut` to
 * catch. The panels exist because a T-wall run's silhouette is its whole
 * appearance — the gap at the head between one panel and the next, and the feet
 * — and drawing it as one slab reads as a retaining wall.
 */
export function buildBlastWall(
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(mats, "blastwall");
  const len = p.length ?? 12;
  const h = p.height ?? 3.4;
  const panels = Math.max(2, Math.round(len / 1.6));
  const pitch = len / panels;
  for (let i = 0; i < panels; i++) {
    const x = -len / 2 + (i + 0.5) * pitch;
    // Each panel stands a hair off its neighbour: a T-wall run is placed by
    // crane and never lines up, and the shadow between two panels is the only
    // vertical line a flat grey wall has.
    const jitter = ((i % 3) - 1) * 0.04;
    b.box(pitch - 0.09, h, 0.42, x, h / 2, jitter, CONCRETE, { y: jitter * 0.06 });
    b.box(pitch - 0.02, 0.34, 1.35, x, 0.17, jitter, DARK_CONCRETE);
    b.box(pitch - 0.5, 0.16, 0.55, x, h - 0.08, jitter, DARK_CONCRETE);
  }
  b.block({ w: len, h, d: 0.55, x: 0, y: h / 2, z: 0 });
  return b;
}

/**
 * A sandbag emplacement: staggered courses along X, chest-high to a crouch and
 * hip-high to a stand.
 *
 * Sized against `CoverMap`'s 1.7 m hard-cover line on purpose — it is LOW
 * cover, so a bot behind it crouches and shoots over rather than standing
 * behind it, and a body at one is exposed from the chest up. Anything taller
 * would be a wall, and this map has walls.
 */
export function buildSandbags(
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(mats, "sandbags");
  const len = p.length ?? 6;
  const h = p.height ?? 1.15;
  const courses = Math.max(2, Math.round(h / 0.28));
  for (let c = 0; c < courses; c++) {
    const y = (c + 0.5) * (h / courses);
    const inset = (c / courses) * 0.22;
    const n = Math.max(2, Math.round(len / 0.62));
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + ((i + 0.5) / n) * len + (c % 2 ? 0.14 : 0);
      b.box(len / n - 0.05, h / courses + 0.03, 0.78 - inset, x, y, 0, SANDBAG, {
        y: ((i * 7 + c * 3) % 5) * 0.012,
      });
    }
  }
  b.block({ w: len, h, d: 0.85, x: 0, y: h / 2, z: 0 });
  // The pickets and the wire a position gets once it has been there a while,
  // and the plank somebody put across the top of it to lean a rifle on.
  for (let i = 0; i <= 2; i++) {
    b.strut(0.09, 1.5, 0.09, -len / 2 + (i / 2) * len, h + 0.35, -0.55, IRON);
  }
  b.strut(len, 0.06, 0.06, 0, h + 0.9, -0.55, IRON);
  b.box(len * 0.6, 0.14, 0.4, len * 0.1, h + 0.07, 0.5, TIMBER);
  b.box(1.1, 0.3, 0.7, -len * 0.3, h + 0.15, 0.42, TEAK);
  return b;
}
