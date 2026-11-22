/**
 * kit/desert/graves.ts — buildGraves: one ROW of Muslim graves lying side by
 * side along local X, each a low kerbed mound with a stele at its head and a
 * smaller one at its foot. Part of the desert-town set: follows the contract
 * in kit/core.ts and the set's rules in `./index.ts`. Invariants: every grave
 * stands on its own ground sample and the row's one collider steps with the
 * ground (`groundRun`); seeded off where it stands (`streetSeed`), never
 * `Math.random()`. Never imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  groundRun,
  streetSeed,
  type BuildCtx,
  type BuildParams,
  type Structure,
} from "../core";
import {
  MUDBRICK,
  MUDBRICK_DARK,
  ROOF_MUD,
  SANDBAG,
  WHITEWASH,
} from "./shared";

/** One grave's width across the row, and the gap a mourner walks down. */
const PITCH = 1.15;
/** A grave's length, head to foot, along local Z. */
const LONG = 2.0;
/** The row's collider: a body steps onto it (`stepHeight` 0.6) and it hides nobody. */
const ROW_H = 0.5;

/**
 * A row of graves, the unit a burial ground is laid in.
 *
 * ## What it is FOR
 *
 * **Order is the read.** The scattered `gravestone` prop is a churchyard's:
 * upright headstones at odd angles, each where a family could afford the
 * ground. A Muslim burial ground is laid in ROWS, every grave on the same
 * bearing because every body lies on its right side facing Mecca, the mound
 * low and kerbed and the marker a narrow stele at the head — so a cemetery
 * here is lines of low mounds you can see over, and one built of headstones
 * dropped at random reads as somebody else's dead. A row is the smallest
 * thing that carries the bearing, so it is the kind.
 *
 * In play a row is NOT cover: its one collider is half a metre high, under
 * `stepHeight`, so a body walks over the graves and the nav graph links
 * across them. The steles stand over it as drawing only — a round passes
 * a 0.8 m stone — which is the same bargain the bramble makes, and the
 * honest one for a field of things a hand's breadth thick.
 *
 * ## What varies, and how
 *
 * Seeded off where the row stands (`streetSeed`): each grave's kerb height,
 * whether it is plastered or bare mud, whitewashed or not, whether its head
 * stele is a plain slab, a pointed one or an old turbaned one, how far it
 * leans, and whether it has broken or gone. Now and then two or three graves
 * share a low walled family plot.
 *
 * ## The ground
 *
 * Each grave samples the floor under its own centre and stands on it, its
 * kerb carried down under the lower end; the row's collider is cut into
 * level spans by `groundRun`, as a compound wall's is.
 */
export function buildGraves(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "graves");
  const len = p.length ?? 12;
  const kerbTint = p.tint ?? MUDBRICK_DARK;
  const rnd = mulberry32(streetSeed(len, LONG, ROW_H, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };

  // --- the collider: the row's one low block, stepped with the ground ----------
  const run = groundRun(ctx, len, { pitch: 2.4, depth: LONG + 0.2, pad: 0, between: true });
  for (const s of run.spans) {
    const top = s.ground + ROW_H;
    b.block({ w: s.x1 - s.x0, h: top - s.base, d: LONG + 0.2, x: (s.x0 + s.x1) / 2, y: (top + s.base) / 2, z: 0 });
  }

  // --- the graves ------------------------------------------------------------
  const n = Math.max(1, Math.floor(len / PITCH));
  const pitch = len / n;
  // A family plot: a run of two or three graves inside a low wall of their
  // own, chosen once per row and only on a long enough one.
  const plotAt = n >= 5 && rnd() < 0.35 ? Math.floor(rnd() * (n - 3)) : -1;
  const plotN = 2 + (rnd() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * pitch;
    // A gap in the row: somebody was moved, or the ground was never used.
    if (rnd() < 0.06) continue;
    const gHead = ground(x, LONG / 2 - 0.2);
    const gFoot = ground(x, -LONG / 2 + 0.2);
    const g = Math.max(gHead, gFoot);
    const lo = Math.min(gHead, gFoot) - 0.08;
    const wide = 0.62 + rnd() * 0.22;
    const long = LONG - 0.15 - rnd() * 0.3;
    const kerb = 0.14 + rnd() * 0.16;
    const plastered = rnd() < 0.55;
    const kc = plastered ? (rnd() < 0.3 ? WHITEWASH : kerbTint) : MUDBRICK;
    // The kerb: four stones round the mound, set down to the lower ground so
    // a grave on a slope shows its kerb rather than the sand under it.
    const kh = g + kerb - lo;
    const ky = (g + kerb + lo) / 2;
    for (const s of [-1, 1]) {
      b.box(0.1, kh, long, x + s * (wide / 2 - 0.05), ky, 0, kc);
      b.box(wide - 0.2, kh, 0.1, x, ky, s * (long / 2 - 0.05), kc);
    }
    // The mound inside it, heaped and rounded: two layers, the upper one
    // narrower, in packed earth a shade lighter than the mud — blown dust is
    // lighter than the wall it settles on (the set's rule).
    const mh = kerb * 0.7 + 0.05;
    b.box(wide - 0.2, mh, long - 0.2, x, g + mh / 2, 0, SANDBAG);
    b.box(wide * 0.45, 0.08, long - 0.5, x, g + mh + 0.04, 0, SANDBAG);

    // The head stele, at +Z: a narrow slab, by kind.
    const lean = (rnd() - 0.5) * 0.22;
    const twist = (rnd() - 0.5) * 0.2;
    const sc = rnd() < 0.3 ? WHITEWASH : rnd() < 0.6 ? ROOF_MUD : MUDBRICK_DARK;
    const kind = rnd();
    const broken = rnd() < 0.12;
    const hz = long / 2 - 0.1;
    const hgt = broken ? 0.18 + rnd() * 0.2 : 0.5 + rnd() * 0.4;
    const sw = 0.3 + rnd() * 0.16;
    const base = g + kerb * 0.5;
    if (rnd() > 0.05) {
      b.box(sw, hgt, 0.1, x, base + hgt / 2, hz, sc, { x: lean, y: twist });
      const tipY = base + hgt * Math.cos(lean);
      const tipZ = hz - Math.sin(lean) * hgt;
      if (!broken && kind < 0.35) {
        // Pointed: a square on its corner, half sunk in the slab's head.
        const q = sw / Math.SQRT2;
        b.box(q, q, 0.1, x, tipY, tipZ, sc, { x: lean, y: twist, z: Math.PI / 4 });
      } else if (!broken && kind < 0.55) {
        // The old turbaned stele: a neck and a wound cap, the tombstone of a
        // man who mattered a century ago.
        b.cyl(0.07, 0.09, 0.11, 8, x, tipY + 0.035, tipZ, sc, { x: lean });
        b.cyl(0.12, 0.15, 0.19, 8, x, tipY + 0.12, tipZ, sc, { x: lean });
        b.cyl(0.05, 0.06, 0.15, 8, x, tipY + 0.205, tipZ, sc, { x: lean });
      } else if (!broken) {
        // Rounded: a short drum laid across the head.
        b.cyl(0.1, sw, sw, 10, x, tipY, tipZ, sc, { z: Math.PI / 2, x: lean });
      } else {
        // The piece that came off, lying on the mound.
        b.box(sw * 0.9, 0.08, 0.3, x + (rnd() - 0.5) * 0.2, g + mh + 0.1, hz - 0.45, sc, { y: rnd() * 1.2 });
      }
    }
    // The foot stele, smaller, at -Z.
    if (rnd() < 0.7) {
      const fh = 0.25 + rnd() * 0.2;
      b.box(sw * 0.75, fh, 0.08, x, base + fh / 2, -hz, sc, { x: -lean * 0.6, y: twist });
    }
    // A clay water dish at the head, which the custom fills for the birds.
    if (rnd() < 0.18) b.cyl(0.06, 0.2, 0.14, 8, x + wide * 0.22, g + mh + 0.03, hz - 0.3, ROOF_MUD);
  }

  // The family plot's wall: low, plastered, round two or three graves.
  if (plotAt >= 0) {
    const x0 = -len / 2 + plotAt * pitch;
    const x1 = Math.min(len / 2, x0 + plotN * pitch);
    const wh = 0.42;
    const g0 = Math.max(ground(x0, 0), ground(x1, 0), ground((x0 + x1) / 2, LONG / 2), ground((x0 + x1) / 2, -LONG / 2));
    const lo = Math.min(ground(x0, -LONG / 2), ground(x1, LONG / 2), ground(x0, LONG / 2), ground(x1, -LONG / 2)) - 0.08;
    const zh = LONG / 2 + 0.05;
    const h = g0 + wh - lo;
    const y = (g0 + wh + lo) / 2;
    for (const s of [-1, 1]) {
      b.box(x1 - x0, h, 0.16, (x0 + x1) / 2, y, s * zh, WHITEWASH);
      b.box(0.16, h, 2 * zh, s < 0 ? x0 + 0.08 : x1 - 0.08, y, 0, WHITEWASH);
    }
    // Its coping, in the wall's own shade.
    for (const s of [-1, 1]) {
      b.box(x1 - x0 + 0.06, 0.06, 0.22, (x0 + x1) / 2, g0 + wh + 0.03, s * zh, MUDBRICK_DARK);
    }
  }
  return b;
}
