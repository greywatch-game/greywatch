/**
 * kit/structures.ts — Small standalone structures and cover: silo, well,
 * stall, fence, stone wall, bridge, trestle bridge, temple ruin, haystack,
 * lamp post, cart, crates, woodpile, shed, trough, shrine, kiln. All follow
 * the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata).
 *
 * Cover vocabulary, so a layout can pick the right height deliberately. A
 * prop's COLLIDER height is the whole of it, and `CONFIG.bots.cover` draws
 * three lines through the range: 0.9 (`softHeight` — a steering hint and
 * nothing more), 1.3 (`crouchHeight` — stops a round at a body that gets DOWN
 * behind it, and only within `crouchProbe` of it), and 1.7 (`hardHeight` —
 * stops one at a body standing up). Trough (1.0) and the fence's run (1.4, and
 * `porous`, so in no mask at all) are *low*: a step over with the eyes, not
 * the body. Cart (1.7), woodpile (1.9), haystack (2.2) and crates (2.3) are
 * all at or over the hard line — cover you stand and shoot from, not cover you
 * duck behind. Stone wall, shed, silo and kiln break sightlines outright. The
 * fence is the one thing here that is cover from nothing but its own timber —
 * its coarse box is `porous` and its posts and rails are `strut`s, so it turns
 * a route without turning a sightline, and stops only what actually hits wood.
 *
 * **A ROUND prop's collider is its body at the height rounds arrive at, not a
 * square drawn round its widest circle.** `b.cyl`'s diameter is a
 * CIRCUMdiameter — the polygon's vertices touch it and its silhouette does not
 * — so a box taking that number is already wider than what you can see, and a
 * box taking it at the widest course and then holding it to the top is wider
 * again everywhere the prop tapers. That is what the haystack and the kiln both
 * did, and it measured as rounds stopping on open air a metre off the drawn
 * surface. Size these off the silhouette across the middle of the solid part
 * and leave the cap, the neck and any hoop banding outside it — the same trade
 * `PROP_BODIES` in MapBuilder.ts argues for scatter, where too small costs a
 * round clipping a silhouette and too large costs shots that visibly should
 * have landed. The silo has always done this (its box is the nominal `dia`,
 * not the 1.06 it splays to at the foot); it is the pattern to copy.
 *
 * Two things here are walked ON rather than hidden behind — the two bridges and
 * the temple — so they additionally owe what kit/terrain.ts's header states:
 * collider top faces within CONFIG.nav.stepHeight of adjacent ground, and rotX
 * on the COLLIDER of anything pitched, not just on the visual.
 */
import { Scene } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Structure,
  BRICK,
  CREEPER,
  DARK_STONE,
  EMBER,
  FLAME,
  GUARD_THICKNESS,
  IRON,
  MOSS_STONE,
  PLANK,
  STONE,
  TEAK,
  THATCH,
  TIMBER,
  SLATE,
} from "./core";

const TRANSLUCENCY = CONFIG.graphics.translucency;

/** Grain silo: a tall corrugated cylinder. Pure cover, not enterable. */
export function buildSilo(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "silo");
  const h = 12;
  const dia = 6;
  b.cyl(h, dia, dia * 1.06, 10, 0, h / 2, 0, DARK_STONE);
  for (let i = 1; i < 5; i++) {
    b.cyl(0.25, dia * 1.05, dia * 1.05, 10, 0, (i * h) / 5, 0, IRON);
  }
  b.cyl(2.4, 0.6, dia * 1.02, 10, 0, h + 1.2, 0, SLATE);
  b.block({ w: dia, h, d: dia, x: 0, y: h / 2, z: 0 });
  return b;
}

/** Stone well — the Square's centrepiece and flag C's anchor. */
export function buildWell(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "well");
  b.cyl(1.5, 3.2, 3.4, 10, 0, 0.75, 0, STONE);
  b.cyl(0.3, 2.6, 2.6, 10, 0, 1.5, 0, DARK_STONE);
  b.block({ w: 3.4, h: 1.5, d: 3.4, x: 0, y: 0.75, z: 0 });
  for (const sx of [-1, 1]) {
    b.box(0.28, 3.2, 0.28, sx * 1.3, 2.9, 0, TIMBER);
  }
  b.box(3.4, 0.3, 0.9, 0, 4.4, 0, PLANK); // roof over the shaft
  b.cyl(2.4, 0.4, 0.4, 6, 0, 3.8, 0, TIMBER, { z: Math.PI / 2 }); // windlass
  return b;
}

/** Market stall: a plank counter under a sagging awning. Waist-high cover. */
export function buildStall(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "stall");
  b.wall(3.4, 1.1, 1.5, 0, 0.55, 0, PLANK);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.16, 2.6, 0.16, sx * 1.6, 1.3, sz * 0.7, TIMBER);
    }
  }
  // The awning is canvas, and the only thing standing between a player in the
  // Square and the moon: translucent, so from underneath it lights up rather
  // than reading as a black lid. It is also the one surface here anyone
  // routinely stands beneath, which is what makes the stall the right place
  // for the term and a roof the wrong one.
  b.translucentBox(4, 0.14, 2.2, 0, 2.6, 0, THATCH, TRANSLUCENCY.awning, {
    x: 0.14,
  });
  return b;
}

/**
 * Post-and-rail fence run along X. Blocks movement, not sight, and stops a
 * round on its timber and nowhere else.
 *
 * **The body and the round are described separately, and that is the whole of
 * it.** The `block` at the bottom is the fence to a BODY: 1.4 m of it, the
 * length of the run, `porous`, so the nav graph severs across it and a player
 * walks into it while no round ever stops on it. The posts and rails are
 * `strut`s, so a ROUND stops exactly where the timber is drawn and passes
 * through the gaps — which is most of a fence, and was the whole of it before
 * the slab was told to stop pretending.
 *
 * Neither half works alone: without the block a fence is walked through, and
 * without the struts it is a wall you can see your target through.
 */
export function buildFence(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "fence");
  const len = p.length ?? 10;
  const posts = Math.max(2, Math.round(len / 2.5));
  for (let i = 0; i <= posts; i++) {
    const x = -len / 2 + (i / posts) * len;
    b.strut(0.18, 1.5, 0.18, x, 0.75, 0, TIMBER);
  }
  b.strut(len, 0.12, 0.1, 0, 1.2, 0, TIMBER);
  b.strut(len, 0.12, 0.1, 0, 0.6, 0, TIMBER);
  b.block({ w: len, h: 1.4, d: 0.4, x: 0, y: 0.7, z: 0, porous: true });
  return b;
}

/**
 * Dry-stone field wall run along X. Unlike `fence` this is chest-high and
 * opaque: it breaks a sightline rather than just a walking line, which is what
 * turns open ground into a fight instead of a shooting gallery. Author it in
 * runs with gaps — a sealed field is a wall the nav grid routes bots all the
 * way around.
 */
export function buildStoneWall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "stonewall");
  const len = p.length ?? 12;
  const h = p.height ?? 1.5;
  b.wall(len, h, 0.5, 0, h / 2, 0, MOSS_STONE);
  // Capstones, and a stouter pier every few metres: the silhouette is what
  // sells dry stone, since the shader gives it no texture.
  b.box(len, 0.18, 0.66, 0, h + 0.09, 0, DARK_STONE);
  const piers = Math.max(1, Math.round(len / 5));
  for (let i = 0; i <= piers; i++) {
    const x = -len / 2 + (i / piers) * len;
    b.box(0.7, h + 0.35, 0.72, x, (h + 0.35) / 2, 0, MOSS_STONE);
  }
  return b;
}

/**
 * Plank footbridge over the creek, running along Z. The deck is a walkable
 * collider, so the ground probe finds it.
 *
 * **The handrails are `guard`s**, which they were not — they were bare `box`es,
 * so a bridge whose whole reason to exist is that the creek runs 1.5 m below
 * the banks either side had two sides you could simply walk out of.
 * `Build.guard` is what makes them solid without costing the deck a nav cell.
 */
export function buildBridge(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "bridge");
  const len = p.length ?? 12;
  const w = p.width ?? 3.2;
  const deckT = 0.28;
  /** Walkable height of the deck: the surface, not the slab's centre. */
  const top = deckT / 2;
  b.box(w, deckT, len, 0, 0, 0, PLANK);
  b.block({ w, h: deckT, d: len, x: 0, y: 0, z: 0 });
  for (const side of ["-x", "+x"] as const) {
    const sx = side === "+x" ? 1 : -1;
    b.guard(side, (sx * w) / 2, 0, len, top);
    // Posts on the rail's own centreline, which is half a thickness outboard.
    const postX = (sx * (w + GUARD_THICKNESS)) / 2;
    const posts = Math.round(len / 3);
    for (let i = 0; i <= posts; i++) {
      b.box(0.2, 1.2, 0.2, postX, top + 0.6, -len / 2 + (i / posts) * len, TIMBER);
    }
  }
  return b;
}

// --- the trestle -----------------------------------------------------------

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

// --- the temple ------------------------------------------------------------

/**
 * Rise per tier. It has to clear `NavGrid`'s HEIGHT_EPS (0.35) or `addSurface`
 * merges two tiers into one surface and the climb stops existing; and it has to
 * stay under CONFIG.nav.stepHeight (0.6) or a tier is a wall the flood fill
 * refuses. That is a 0.25 m window, and this sits near its middle — the slack
 * over 0.5 is what pays for the terrain varying across a 26 m footprint that
 * MapBuilder height-samples at ONE point.
 */
const TIER_RISE = 0.45;
/** How far each tier steps in from the one below, on every side. */
const TIER_INSET = 3.2;
/** How far the tiers are sunk below the placement's own ground. */
const TIER_BURY = 0.4;

/**
 * A stepped stone platform with the jungle growing over it: three tiers, a
 * broken sanctuary wall across the top, stelae at the corners and a toppled
 * column lying where it fell.
 *
 * ## What it is for
 *
 * It is the only elevation in the kit that needs no ramp, no stair and no
 * doorway. Every tier is a step inside `stepHeight`, so it is walked up from
 * any bearing by anything with feet — which makes it high ground a bot can hold
 * without the pathing having to be clever, and high ground a player can be
 * pushed off from four sides at once. The watchtower and the barn loft are
 * verticality with ONE way up; this is the opposite of that on purpose.
 *
 * There is deliberately no `guard` anywhere on it. A rail would turn a platform
 * you can leave in any direction into a fortress with one entrance, and would
 * cost a nav cell on every face.
 *
 * ## The colliders are RINGS, and the whole thing turns on it
 *
 * The obvious build is three nested solid boxes. It looks right, it walks right
 * in the editor, and it silently loses its top tier. `NavGrid` keeps
 * MAX_SURFACES = 3 per cell and `addSurface` RETURNS when it is full — so trace
 * a cell at the centre: terrain goes in, tier 1's top goes in, tier 2's top goes
 * in, and tier 3's top — the summit, the only part anyone climbs for — is
 * dropped. Nothing throws, nothing draws differently, and the flag on top is
 * unstandable.
 *
 * So each tier's COLLIDER is only the ring of tread it actually exposes.
 * `topFaceHeight` returns null outside a box's own XZ footprint and
 * `NavGrid.rasterize` skips on null, so a cell centre lands inside exactly one
 * ring and every cell carries two surfaces instead of four.
 *
 * The VISUALS stay three nested solid boxes, and that is what satisfies the
 * thick-box rule: every walked tread is the top face of a 0.85–1.75 m block, so
 * the outline shell has real depth behind it and cannot paint the tread flat in
 * its own ink. They are also all one colour, so they merge into a single mesh
 * and their buried coplanar faces cannot be a depth-test tie.
 *
 * ## The nav budget, which is the thing to preserve
 *
 * | cell | surfaces |
 * | --- | --- |
 * | off the temple | terrain |
 * | on any tread | terrain (blocked) + that tread |
 * | under a stele, the wall, or the column | terrain + tread + that thing's top |
 *
 * Never four. So: no fourth tier, no nested solid COLLIDERS, and nothing new
 * standing in a cell that already carries two treads.
 */
export function buildTempleRuin(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "temple");
  const w = p.width ?? 26;
  const d = p.depth ?? 22;
  // Keep the top tier from inverting on a small footprint: three tiers need six
  // insets out of the shorter half-span and something left to stand on.
  const inset = Math.min(TIER_INSET, (Math.min(w, d) / 2 - 2.2) / 2);
  const half = [
    { x: w / 2, z: d / 2 },
    { x: w / 2 - inset, z: d / 2 - inset },
    { x: w / 2 - inset * 2, z: d / 2 - inset * 2 },
  ];
  /** Walked height of tier `i`. */
  const top = (i: number): number => (i + 1) * TIER_RISE;

  // The visuals: three nested solid boxes, each placed by its TOP face, each
  // reaching down to the same buried base.
  for (let i = 0; i < 3; i++) {
    const h = top(i) + TIER_BURY;
    b.box(half[i].x * 2, h, half[i].z * 2, 0, top(i) - h / 2, 0, MOSS_STONE);
  }

  // The colliders: for tiers 0 and 1, the exposed ring only. The ±X runs take
  // the corners and the ±Z runs stop short of them, so the four abut without
  // overlapping and no cell centre falls in two.
  for (let i = 0; i < 2; i++) {
    const h = top(i) + TIER_BURY;
    const y = top(i) - h / 2;
    const band = half[i].x - half[i + 1].x;
    for (const s of [-1, 1]) {
      b.block({ w: band, h, d: half[i].z * 2, x: s * (half[i].x - band / 2), y, z: 0 });
      b.block({ w: half[i + 1].x * 2, h, d: band, x: 0, y, z: s * (half[i].z - band / 2) });
    }
  }
  // The summit is the one tier that can be a single solid box: nothing steps in
  // above it, so its cells carry terrain and one tread and no more.
  {
    const h = top(2) + TIER_BURY;
    b.block({ w: half[2].x * 2, h, d: half[2].z * 2, x: 0, y: top(2) - h / 2, z: 0 });
  }

  // Drip courses: a shadow line along each riser. Their tops sit BELOW the tread
  // above them, so nothing here is a thin slab anyone stands on.
  for (let i = 0; i < 3; i++) {
    const y = top(i) - 0.08;
    for (const s of [-1, 1]) {
      b.box(0.16, 0.12, half[i].z * 2 + 0.3, s * (half[i].x + 0.07), y, 0, DARK_STONE);
      b.box(half[i].x * 2 + 0.3, 0.12, 0.16, 0, y, s * (half[i].z + 0.07), DARK_STONE);
    }
  }

  // The sanctuary wall across the summit's north edge — the height the tiers
  // deliberately do not provide, and hard cover for whoever holds the top.
  const sanctH = p.ruined ? 1.3 : 2.9;
  if (p.ruined) {
    b.wall(half[2].x * 1.1, sanctH, 0.5, -half[2].x * 0.4, top(2) + sanctH / 2, half[2].z - 0.25, MOSS_STONE);
  } else {
    b.doorWall(half[2].x * 2, sanctH, 0.5, 0, top(2) + sanctH / 2, half[2].z - 0.25, MOSS_STONE, 1.8, 2.0);
  }

  // Stelae on the middle tread's corners — not the summit's, which the wall
  // already spends cells on.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (half[2].x + (half[1].x - half[2].x) / 2);
      const z = sz * (half[2].z + (half[1].z - half[2].z) / 2);
      b.wall(0.9, 2.6, 0.9, x, top(1) + 1.3, z, MOSS_STONE);
      b.box(1.06, 0.18, 1.06, x, top(1) + 2.69, z, DARK_STONE);
    }
  }

  // A toppled column on the lowest tread: waist-high cover on the climb, which
  // is what stops the bottom tier being a shooting gallery.
  const colX = half[1].x + (half[0].x - half[1].x) / 2;
  const colY = top(0) + 0.39;
  b.cyl(5.0, 0.7, 0.78, 7, colX, colY, d * 0.1, MOSS_STONE, { x: Math.PI / 2 });
  b.block({ w: 0.78, h: 0.78, d: 5.0, x: colX, y: colY, z: d * 0.1 });

  // What the forest has taken. Mats are sunk into the treads and stand a
  // fraction proud — a mat flush with the stone is two up-facing faces in
  // different colour groups sharing a plane, which strobes.
  for (let i = 0; i < 3; i++) {
    for (const s of [-1, 1]) {
      b.box(half[i].x * 0.5, 0.36, 1.1, s * half[i].x * 0.45, top(i) + 0.03 - 0.18, s * (half[i].z - 0.9), CREEPER);
      b.box(0.1, TIER_RISE * 0.9, 0.8, s * (half[i].x + 0.05), top(i) - TIER_RISE * 0.45, -s * half[i].z * 0.4, CREEPER);
    }
  }
  return b;
}

/**
 * Haystack — soft cover in the paddocks.
 *
 * **The box is the rick's width at the height a round arrives at, not the
 * circle it is drawn inside.** The drum is a heptagon tapering 3.2 -> 2.6 over
 * its 2.2 m, and 3.2 is a CIRCUMdiameter: seven vertices touch it and the
 * silhouette between them never does, so a 3.2 box was a square drawn around
 * the widest circle and then held at that width all the way up. Measured, it
 * stopped rounds through 1.0 m of open air abreast of the rick and through
 * 1.5 m at the corners, and above 0.6 m there were bearings where it stopped
 * a round with nothing drawn on that line at all.
 *
 * 2.8 is the drawn silhouette across the middle of the drum (circumdiameter
 * 2.90 there, and a heptagon is about 0.95 of its own circumdiameter however
 * you stand to it). This is `PROP_BODIES`' rule in `MapBuilder.ts` — the trunk
 * at chest height rather than the flare it stands on — and the same rule the
 * silo next door already follows by taking its nominal `dia` rather than the
 * 1.06 it splays to at the foot. It errs small by about 4 cm abreast, which is
 * the cheap side of that file's trade: too small costs a round clipping a
 * silhouette, too large costs shots that visibly should have landed.
 *
 * The cap stays outside the collider, as it was: it is 1.4 m of hay starting
 * at 2.2, which is over every head in the game, and a box that held it would
 * be another square around another cone.
 */
export function buildHaystack(
  scene: Scene,
  mats: CelMaterialFactory,
): Structure {
  const b = new Build(scene, mats, "haystack");
  b.cyl(2.2, 2.6, 3.2, 7, 0, 1.1, 0, THATCH);
  b.cyl(1.4, 0.2, 2.6, 7, 0, 2.9, 0, THATCH);
  b.block({ w: 2.8, h: 2.2, d: 2.8, x: 0, y: 1.1, z: 0 });
  return b;
}

/** Iron lamp post, the village's standard fixture. Carries a light. */
export function buildLampPost(
  scene: Scene,
  mats: CelMaterialFactory,
): Structure {
  const b = new Build(scene, mats, "lamp");
  b.cyl(4, 0.14, 0.26, 6, 0, 2, 0, IRON);
  b.box(0.9, 0.1, 0.1, 0.35, 3.75, 0, IRON);
  b.cyl(0.62, 0.42, 0.3, 6, 0.75, 3.45, 0, IRON);
  b.glow(0.3, 0.3, 0.3, 0.75, 3.45, 0, FLAME);
  b.cyl(0.18, 0.1, 0.5, 6, 0.75, 3.85, 0, IRON);
  b.block({ w: 0.5, h: 4, d: 0.5, x: 0, y: 2, z: 0 });
  b.light(FLAME, 22, 2.2, 0.35, 0.75, 3.45, 0);
  return b;
}

/**
 * Farm cart, bed along X. Chest-high cover with a readable silhouette — the
 * staves and the raised shafts break up the box so it never reads as a crate.
 * `ruined` drops it on a broken axle, for ground that has already been fought
 * over.
 */
export function buildCart(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "cart");
  const tilt = p.ruined ? 0.22 : 0;
  const bedY = p.ruined ? 0.85 : 1.0;
  b.box(3.2, 0.3, 1.6, 0, bedY, 0, PLANK, { z: tilt });
  // Side and end boards.
  for (const sz of [-1, 1]) {
    b.box(3.2, 0.75, 0.14, 0, bedY + 0.5, sz * 0.8, PLANK, { z: tilt });
  }
  b.box(0.14, 0.75, 1.6, -1.6, bedY + 0.5, 0, PLANK, { z: tilt });
  // Wheels: flat discs on an axle, the cheapest thing that reads as a cart.
  // The bed runs along X, so a wheel rolls along X and its axis lies along Z —
  // that is `x: PI/2`, not `z`, which would stand the discs across the bed.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const broken = p.ruined && sx < 0 && sz < 0;
      b.cyl(
        0.18,
        broken ? 0.5 : 1.15,
        broken ? 0.5 : 1.15,
        broken ? 6 : 9,
        sx * 1.1,
        broken ? 0.25 : 0.6,
        sz * 0.9,
        TIMBER,
        { x: Math.PI / 2, z: broken ? 0.9 : 0 },
      );
    }
  }
  // One axle per wheel pair, spanning the width to meet them.
  for (const sx of [-1, 1]) {
    b.cyl(2.0, 0.16, 0.16, 6, sx * 1.1, 0.6, 0, IRON, { x: Math.PI / 2 });
  }
  // Shafts, raised as if the horse were unhitched in a hurry.
  for (const sz of [-1, 1]) {
    b.box(2.4, 0.14, 0.14, 2.5, bedY + 0.55, sz * 0.55, TIMBER, { z: 0.28 });
  }
  b.block({ w: 3.4, h: 1.7, d: 2.0, x: 0, y: 0.85, z: 0 });
  return b;
}

/** Stack of crates and barrels — waist-to-chest cover for yards and docks. */
export function buildCrates(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "crates");
  b.box(1.5, 1.2, 1.4, -0.6, 0.6, 0, PLANK);
  b.box(1.3, 1.1, 1.3, 0.8, 0.55, 0.3, TIMBER);
  b.box(1.2, 1.0, 1.1, -0.35, 1.7, -0.15, TIMBER, { y: 0.4 });
  // Barrel leaning against the stack.
  b.cyl(1.3, 0.85, 0.95, 8, 0.9, 0.65, -0.9, PLANK);
  for (const y of [0.35, 0.95]) {
    b.cyl(0.12, 0.99, 0.99, 8, 0.9, y, -0.9, IRON);
  }
  b.block({ w: 3.2, h: 2.3, d: 2.6, x: 0.1, y: 1.15, z: 0 });
  return b;
}

/** Split logs stacked between end posts. Long, low, and cheap to author. */
export function buildWoodpile(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "woodpile");
  const len = p.length ?? 5;
  const rows = 3;
  for (let row = 0; row < rows; row++) {
    const y = 0.35 + row * 0.62;
    // Alternate the stagger per row so the stack doesn't read as a grid.
    for (const sz of [-1, 1]) {
      b.cyl(len - row * 0.4, 0.6, 0.62, 7, 0, y, sz * 0.36, TIMBER, {
        z: Math.PI / 2,
      });
    }
  }
  for (const sx of [-1, 1]) {
    b.box(0.2, 2.4, 0.2, (sx * len) / 2, 1.2, 0, PLANK);
  }
  b.block({ w: len, h: 1.9, d: 1.3, x: 0, y: 0.95, z: 0 });
  return b;
}

/** Lean-to shed: a plank shack with a mono-pitch roof. Solid, never enterable. */
export function buildShed(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "shed");
  const w = p.width ?? 3.4;
  const d = p.depth ?? 2.8;
  const h = p.height ?? 2.6;
  b.box(w, h, d, 0, h / 2, 0, PLANK);
  b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.2, h, 0.2, (sx * w) / 2, h / 2, (sz * d) / 2, TIMBER);
    }
  }
  // Mono-pitch roof, falling towards -Z.
  const rise = 0.7;
  const slope = Math.atan2(rise, d);
  b.box(w + 0.5, 0.16, d / Math.cos(slope) + 0.5, 0, h + rise / 2, 0, THATCH, {
    x: -slope,
  });
  b.box(w * 0.45, h * 0.7, 0.1, 0, h * 0.4, -d / 2 - 0.06, TIMBER); // door
  return b;
}

/** Stone water trough and hitching rail. Low cover — cross it, don't hide. */
export function buildTrough(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "trough");
  b.box(3.0, 0.7, 1.1, 0, 0.35, 0, STONE);
  for (const sx of [-1, 1]) {
    b.box(0.18, 0.34, 1.1, (sx * 3.0) / 2, 0.87, 0, STONE);
  }
  for (const sz of [-1, 1]) {
    b.box(3.0, 0.34, 0.18, 0, 0.87, (sz * 1.1) / 2, STONE);
  }
  b.box(2.6, 0.06, 0.8, 0, 0.88, 0, DARK_STONE); // standing water
  b.block({ w: 3.0, h: 1.0, d: 1.1, x: 0, y: 0.5, z: 0 });
  // Hitching rail behind it.
  for (const sx of [-1, 1]) {
    b.box(0.16, 1.4, 0.16, sx * 1.3, 0.7, 1.6, TIMBER);
  }
  b.box(3.0, 0.14, 0.12, 0, 1.25, 1.6, TIMBER);
  b.block({ w: 3.0, h: 1.4, d: 0.4, x: 0, y: 0.7, z: 1.6 });
  return b;
}

/**
 * Roadside shrine: a stone pillar with a lit niche. Carries a small light, so
 * keep them spread — every one competes for a shader slot with the lamps.
 */
export function buildShrine(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "shrine");
  b.box(1.5, 0.4, 1.5, 0, 0.2, 0, DARK_STONE);
  b.box(1.0, 1.8, 1.0, 0, 1.3, 0, MOSS_STONE);
  // The niche: a shallow recess read as two jambs and a hood.
  for (const sx of [-1, 1]) {
    b.box(0.28, 0.8, 0.2, sx * 0.36, 1.9, -0.5, MOSS_STONE);
  }
  b.box(1.1, 0.22, 0.34, 0, 2.35, -0.45, DARK_STONE);
  b.glow(0.34, 0.5, 0.12, 0, 1.85, -0.52, FLAME);
  b.cyl(0.7, 0.28, 0.9, 4, 0, 2.55, 0, SLATE); // capstone
  b.block({ w: 1.5, h: 2.6, d: 1.5, x: 0, y: 1.3, z: 0 });
  b.light(FLAME, 12, 1.3, 0.5, 0, 1.9, -0.6);
  return b;
}

/**
 * Charcoal kiln: a squat brick dome with its mouth still burning. A landmark
 * for the woods, and one of the few warm lights outside the village.
 *
 * **The box is the DRUM, at its middle width.** It carried the haystack's bug
 * twice over: 3.8 is the circumdiameter of a nine-sided drum at its foot, and
 * the box held that width for 3.6 m — a metre past where the drum stops and
 * the neck starts narrowing to 1.3. Measured at 3.4 m up, where the kiln is a
 * chimney, the box stopped rounds on nothing at every bearing tested off the
 * axis.
 *
 * So it is 3.4 across (the drum's silhouette at 1.3 m, its half height) and
 * 2.6 tall (the drum, and nothing above it). The iron bands are outside it on
 * purpose at 3.6: they are 0.16 m rings standing 2 cm proud, and `PROP_BODIES`
 * is explicit that you do not lose a round to a piece of wire. The neck and the
 * chimney collar are outside it for the reason the haystack's cap is — they
 * start at 2.6 m, which clears a standing hit sphere by nearly a metre, so
 * nothing shelters there and the only cost is a round clipping brick on its way
 * over the top.
 */
export function buildKiln(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "kiln");
  b.cyl(2.6, 3.0, 3.8, 9, 0, 1.3, 0, BRICK);
  b.cyl(1.1, 1.3, 3.0, 9, 0, 3.15, 0, BRICK);
  for (const y of [0.8, 1.9]) {
    b.cyl(0.16, 3.6, 3.6, 9, 0, y, 0, IRON);
  }
  b.cyl(0.5, 1.5, 1.1, 8, 0, 3.9, 0, IRON); // chimney collar
  // Stoke hole, facing -Z.
  b.box(1.0, 1.0, 0.3, 0, 0.55, -1.65, DARK_STONE);
  b.glow(0.62, 0.62, 0.14, 0, 0.55, -1.78, EMBER);
  b.block({ w: 3.4, h: 2.6, d: 3.4, x: 0, y: 1.3, z: 0 });
  b.light(EMBER, 17, 1.9, 0.42, 0, 0.8, -2.0);
  return b;
}
