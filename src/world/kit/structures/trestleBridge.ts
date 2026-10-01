/**
 * kit/structures/trestleBridge.ts — buildTrestleBridge: the timber trestle on
 * raked bents, and its graded approaches.
 * Part of the structures set: follows the contract in kit/core.ts, and the
 * cover heights and round-collider rule in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Structure,
  CREEPER,
  GUARD_THICKNESS,
  MOSS_STONE,
  PLANK,
  TEAK,
  TIMBER,
} from "../core";

/** Walked height of the trestle deck above LOCAL ZERO, which is bank grade. */
const TRESTLE_DECK = 1.6;
/**
 * Deck slab thickness, placed by its TOP face.
 *
 * The footbridge gets away with 0.28 and the jetty with 0.24; this does not,
 * and the difference is area seen at a grazing angle. `OutlineRenderer` draws
 * the outline shell with a slope-scaled negative depth offset, and the manor's
 * documented failure is a 0.14 m deck over 22 x 15 m coming back painted flat
 * in its own ink. A cart-width deck over a 26 m span is 83 m² walked down its
 * long axis — squarely between the two, and not somewhere to guess.
 *
 * The girder read therefore comes from bracing hung BELOW this box. A plank cap
 * laid on top would put its own top face 0.12 m in front of nothing again;
 * depth behind the WALKED face is the only thing that buys the margin.
 */
const TRESTLE_DECK_T = 0.6;
/** Approach gradient. Inside the 0.4 at which NavGrid.link severs itself. */
const TRESTLE_GRADE = 0.32;
/**
 * How far each ramp foot runs on PAST local zero, to be buried.
 *
 * buildBarn's `rampDrop` and the manor's `SERVICE_DROP` under another name, for
 * the same reason: nothing guarantees the ground at a ramp's foot is exactly
 * the height its structure was sampled at, and a foot even a couple of
 * centimetres over `stepHeight` above the terrain severs everything above it.
 * A `stepHeight` of overrun buries the last stretch instead, where the terrain
 * simply wins the surface and it costs nothing.
 */
const TRESTLE_DROP = 0.6;
/** Metres between pile bents along the span. */
const TRESTLE_BENT = 4.0;

/**
 * A timber trestle carried on raked pile bents, with a graded approach at each
 * end: the plantation road's way over a river, and the piece that makes a
 * colonial valley read as settled rather than merely built on.
 *
 * ## Local zero is BANK grade, not the ground under the centre
 *
 * This is the one thing to get right when placing one. `MapBuilder` samples the
 * terrain ONCE, at the placement's own (x, z), and translates the whole
 * structure by it — and a bridge's centre is over the CHANNEL, so that sample
 * is the river bed. Left alone the whole trestle sinks by the bed's depth and
 * both ramp feet end up floating a metre over the banks, severing everything.
 *
 * The fix is one authored number in the layout: give the placement a `y` equal
 * to minus the bed depth at its centre, so local zero lands back at bank grade
 * and the feet bury themselves by `TRESTLE_DROP` as intended.
 *
 * It could instead read `BuildCtx` and derive that itself. It deliberately does
 * not: that would put it in `CONFORMS_TO_TERRAIN`, whose members the editor
 * REBUILDS rather than translates on every frame of a drag (~570 ms against
 * sub-ms), and a landmark placed once does not need to cost that. If a second
 * trestle ever lands somewhere awkward, this is the thing to change.
 *
 * ## Why the deck is 1.6 m up, which is not a choice
 *
 * A deck low enough to link to a 0-height bank without ramps needs its top at
 * or under `stepHeight` (0.6). A deck high enough for the river bed underneath
 * to stay walkable needs its UNDERSIDE more than `HEADROOM` (1.7) above that
 * bed, or `severLinks` cuts every link crossing it and `clearBlocked` blanks the
 * ground beneath — an invisible wall across the channel, exactly where a player
 * would run under a bridge. Over a 1.34 m bed with a 0.6 m slab those two want
 * `top <= 0.6` and `top > 0.66`. No height does both.
 *
 * So the ramps are not decoration. They are the only way to have a deck you
 * walk over AND a river you can wade under, and at 1.6 m the underside clears
 * the bed by 2.34 m with room to spare.
 *
 * ## It runs along Z, and must
 *
 * `Build.guard` throws in DEV on a pitched run that is not along Z, because a
 * pitched rail turns about X. The ramps are pitched and railed, so the whole
 * structure is built along Z and turned by the placement's `rotY` — the same
 * rule every other pitched slab in the kit follows.
 */
export function buildTrestleBridge(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "trestle");
  /** The WATER span. The two approaches are extra, and considerable. */
  const len = p.length ?? 26;
  const w = p.width ?? 3.2;
  const rise = TRESTLE_DECK + TRESTLE_DROP;
  const run = rise / TRESTLE_GRADE;
  // Pitch from the RUN, never from the slab's own length: conflating the two is
  // what left buildBarn's ramp 0.3 m short of the loft and 1.5 m past the barn.
  const pitch = Math.atan(TRESTLE_GRADE);
  const slab = Math.hypot(run, rise);
  const rampT = 0.5;
  const under = TRESTLE_DECK - TRESTLE_DECK_T;

  // The deck: visual and collider in one box, placed by its top face.
  b.wall(w, TRESTLE_DECK_T, len, 0, TRESTLE_DECK - TRESTLE_DECK_T / 2, 0, PLANK);
  // Longitudinal girders under it — the read the deck slab cannot carry itself.
  for (const sx of [-1, 1]) {
    b.box(0.3, 0.5, len, (sx * (w - 0.5)) / 2, under - 0.25, 0, TEAK);
  }

  // The two approaches, mirrored. `s` is +1 for the one running out to +Z.
  for (const s of [-1, 1]) {
    const midZ = s * (len / 2 + run / 2);
    // Walked height at the run's centre: half the rise below the deck.
    const surface = TRESTLE_DECK - rise / 2;
    // Placed by its TOP face; the half-thickness is measured VERTICALLY, so
    // that term is h/2/cos, not h/2*cos.
    const y = surface - rampT / 2 / Math.cos(pitch);
    b.box(w, rampT, slab, 0, y, midZ, PLANK, { x: s * pitch });
    b.block({ w, h: rampT, d: slab, x: 0, y, z: midZ, rotX: s * pitch });
    // Abutment where the ramp meets the deck, and a sleeper wall at the foot.
    b.box(w + 1.0, 1.1, 1.2, 0, TRESTLE_DECK - 0.75, s * (len / 2 + 0.5), MOSS_STONE);
    b.box(w + 0.6, 0.7, 0.8, 0, -0.45, s * (len / 2 + run - 0.3), MOSS_STONE);
  }

  // Pile bents. All visual: a collider on a pile would sever the bed links this
  // bridge exists to leave alone, and give bots something to wedge on mid-river.
  const bents = Math.max(2, Math.round(len / TRESTLE_BENT));
  for (let i = 0; i <= bents; i++) {
    const z = -len / 2 + (i / bents) * len;
    for (const sx of [-1, 1]) {
      // Raked so the bent is wider at the mud than at the cap.
      b.cyl(3.4, 0.32, 0.42, 6, (sx * (w - 0.6)) / 2, under - 1.7, z, TEAK, {
        z: sx * 0.1,
      });
    }
    // Cap beam and a cross brace: what makes a row of posts read as a trestle.
    b.box(w + 0.7, 0.26, 0.34, 0, under - 0.13, z, TEAK);
    for (const sd of [-1, 1]) {
      b.box(w + 0.5, 0.16, 0.18, 0, under - 1.3, z, TEAK, { z: sd * 0.55 });
    }
    // Creeper up two of them — enough to say the forest is winning, not enough
    // to say the bridge is derelict.
    if (i === 1 || i === bents - 1) {
      b.box(0.12, 1.6, 0.12, (w - 0.6) / 2, under - 0.9, z + 0.2, CREEPER);
    }
  }

  // Rails, along the deck and both approaches. `guard`'s `pitch` is positive for
  // a run RISING toward +Z, which is the opposite sign to the slab's own rotX,
  // and its `length` is the RUN rather than the slab — it cuts the section by
  // cos itself so a ramp's rail meets the deck's in one line.
  for (const side of ["-x", "+x"] as const) {
    const sx = side === "+x" ? 1 : -1;
    const edge = (sx * w) / 2;
    b.guard(side, edge, 0, len, TRESTLE_DECK, { color: TEAK });
    for (const s of [-1, 1]) {
      b.guard(side, edge, s * (len / 2 + run / 2), run, TRESTLE_DECK - rise / 2, {
        pitch: -s * pitch,
        color: TEAK,
      });
    }
    // Posts on the rail's own centreline, half a thickness outboard — drawn at
    // the deck edge they would be inside the guard box and invisible.
    const postX = (sx * (w + GUARD_THICKNESS)) / 2;
    for (let i = 0; i <= bents; i++) {
      const z = -len / 2 + (i / bents) * len;
      b.box(0.2, 1.3, 0.2, postX, TRESTLE_DECK + 0.65, z, TIMBER);
    }
  }
  return b;
}
