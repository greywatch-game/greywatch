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
import { Matrix, Quaternion, Scene, Vector3, type Mesh } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import {
  Build,
  groundRun,
  type BuildCtx,
  type BuildParams,
  type Structure,
  streetSeed,
  BRICK,
  CREEPER,
  DARK_STONE,
  EMBER,
  ENAMEL,
  FLAME,
  GUARD_THICKNESS,
  IRON,
  MOSS_STONE,
  PITCH,
  PLANK,
  SAILCLOTH,
  STONE,
  STRAW,
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
 *
 * On a slope it steps (`groundRun`) and only ever AT A POST, since a rail has
 * to end on something: where the ground wants a step between two posts, the
 * run gets another post instead.
 */
export function buildFence(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "fence");
  const len = p.length ?? 10;
  const run = groundRun(ctx, len, {
    pitch: 2.5,
    minGaps: 2,
    depth: 0.4,
    pad: 0.09,
    between: false,
  });
  for (const j of run.joints) {
    const top = j.ground + 1.5;
    b.strut(0.18, top - j.base, 0.18, j.x, (top + j.base) / 2, 0, TIMBER);
  }
  for (const s of run.spans) {
    const w = s.x1 - s.x0;
    const x = (s.x0 + s.x1) / 2;
    b.strut(w, 0.12, 0.1, x, s.ground + 1.2, 0, TIMBER);
    b.strut(w, 0.12, 0.1, x, s.ground + 0.6, 0, TIMBER);
  }
  for (const s of run.spans) {
    // Down to the footing, so a body cannot pass under the run where the floor
    // falls away beneath its ground line.
    const top = s.ground + 1.4;
    b.block({
      w: s.x1 - s.x0,
      h: top - s.base,
      d: 0.4,
      x: (s.x0 + s.x1) / 2,
      y: (top + s.base) / 2,
      z: 0,
      porous: true,
    });
  }
  return b;
}

/**
 * Dry-stone field wall run along X. Unlike `fence` this is chest-high and
 * opaque: it breaks a sightline rather than just a walking line, which is what
 * turns open ground into a fight instead of a shooting gallery. Author it in
 * runs with gaps — a sealed field is a wall the nav grid routes bots all the
 * way around.
 *
 * On a slope it STEPS (`groundRun`): each span stands its full height on its
 * own ground line with its footing under the floor, the coping steps with it,
 * and a step may fall between piers because that is how dry stone is laid up
 * a hill.
 */
export function buildStoneWall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "stonewall");
  const len = p.length ?? 12;
  const h = p.height ?? 1.5;
  const run = groundRun(ctx, len, { pitch: 5, depth: 0.72, pad: 0.35, between: true });
  for (const s of run.spans) {
    const w = s.x1 - s.x0;
    const x = (s.x0 + s.x1) / 2;
    const top = s.ground + h;
    b.wall(w, top - s.base, 0.5, x, (top + s.base) / 2, 0, MOSS_STONE);
    // Capstones, and a stouter pier every few metres: the silhouette is what
    // sells dry stone, since the shader gives it no texture.
    b.box(w, 0.18, 0.66, x, top + 0.09, 0, DARK_STONE);
  }
  for (const j of run.joints) {
    const top = j.ground + h + 0.35;
    b.box(0.7, top - j.base, 0.72, j.x, (top + j.base) / 2, 0, MOSS_STONE);
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
 * Moves parts that have already been built as though the frame they were drawn
 * in had moved: `m` is applied AFTER each part's own transform, so a wheel is
 * built round its own nave and then carried to its axle, and a front carriage
 * is built square and then turned on its kingpin. The result is written back
 * as an ordinary position, rotation and scaling — never as a quaternion, which
 * `MapBuilder` would then have to know to compose its own `rotation.y` with.
 */
function reframe(meshes: readonly Mesh[], m: Matrix): void {
  const s = new Vector3();
  const q = new Quaternion();
  const t = new Vector3();
  for (const mesh of meshes) {
    Matrix.Compose(mesh.scaling, Quaternion.FromEulerVector(mesh.rotation), mesh.position)
      .multiply(m)
      .decompose(s, q, t);
    mesh.scaling.copyFrom(s);
    mesh.rotation.copyFrom(q.toEulerAngles());
    mesh.position.copyFrom(t);
  }
}

/** A rotation `r` about the point (x, y, z) rather than about the origin. */
function about(x: number, y: number, z: number, r: Matrix): Matrix {
  return Matrix.Translation(-x, -y, -z).multiply(r).multiply(Matrix.Translation(x, y, z));
}

/**
 * One cart wheel, built round its own nave with the axle along Z and the
 * linchpin side at +Z: an iron tyre shrunk onto a ring of felloes, spokes
 * morticed into a hooped nave, and the axle's end and pin standing out of it.
 *
 * **Every member is its own part, because the spokes ARE the wheel.** A disc is
 * what the cart was, and a disc reads as a millstone or a barrel end at any
 * range the ink can draw it; what says wheel is the light between the spokes,
 * and that only exists if they are separate.
 *
 * `broken` is a wheel that has come off: no pin, two spokes snapped out, one
 * felloe gone and the tyre sprung off over that quarter.
 */
function cartWheel(
  b: Build,
  R: number,
  spokes: number,
  color: string,
  phase: number,
  broken = false,
): Mesh[] {
  const from = b.meshes.length;
  /** Tyre and felloe segments: enough that the rim reads round at arm's length. */
  const segs = spokes + 6;
  const step = (2 * Math.PI) / segs;
  const chord = (r: number): number => 2 * r * Math.sin(step / 2) + 0.012;
  const tyreT = 0.028;
  const felloeD = 0.08;
  const hubR = R * 0.22;
  const hubLen = R * 0.55;
  const hubZ = -0.04;
  /** Where each member sits on the circle: its own +Y points out along `a`. */
  const at = (r: number, a: number): [number, number] => [-Math.sin(a) * r, Math.cos(a) * r];
  for (let i = 0; i < segs; i++) {
    // The gap in a broken wheel is one felloe's worth, and the tyre that ran
    // over it has sprung clear of the three either side.
    const lost = broken && i >= 2 && i <= 4;
    const a = phase + i * step;
    if (!lost || i === 3) {
      if (!(broken && i === 3)) {
        const rf = R - tyreT - felloeD / 2;
        const [fx, fy] = at(rf, a);
        b.box(chord(rf), felloeD, 0.075, fx, fy, 0, color, { z: a });
      }
    }
    if (!lost) {
      const rt = R - tyreT / 2;
      const [tx, ty] = at(rt, a);
      b.box(chord(rt), tyreT, 0.088, tx, ty, 0, IRON, { z: a });
    }
  }
  const r0 = hubR * 0.9;
  const r1 = R - tyreT - felloeD + 0.02;
  for (let i = 0; i < spokes; i++) {
    if (broken && (i === 1 || i === 2)) continue;
    const a = phase + (i + 0.5) * ((2 * Math.PI) / spokes);
    const [sx, sy] = at((r0 + r1) / 2, a);
    b.box(0.048, r1 - r0, 0.038, sx, sy, 0, color, { z: a });
  }
  // The nave: fatter where the spokes go in, tapering to both ends, hooped at
  // each. `x: PI/2` stands a cylinder's top on +Z.
  const half = hubLen / 2;
  b.cyl(half, hubR * 1.7, hubR * 2, 10, 0, 0, hubZ + half / 2, color, { x: Math.PI / 2 });
  b.cyl(half, hubR * 2, hubR * 1.8, 10, 0, 0, hubZ - half / 2, color, { x: Math.PI / 2 });
  for (const k of [-1, 1]) {
    const d = k > 0 ? hubR * 1.78 : hubR * 1.88;
    b.cyl(0.03, d, d, 10, 0, 0, hubZ + k * (half - 0.03), IRON, { x: Math.PI / 2 });
  }
  if (!broken) {
    // The axle's end through the nave, and the linchpin through the axle.
    b.cyl(0.07, 0.075, 0.075, 8, 0, 0, hubZ + half + 0.03, IRON, { x: Math.PI / 2 });
    b.box(0.022, 0.13, 0.022, 0, 0.005, hubZ + half + 0.045, IRON);
  }
  return b.meshes.slice(from);
}

/**
 * A full hessian sack lying along X, tied at +X, built on its own belly.
 *
 * **It is SOFT, and that is the whole of what separates it from a bottle**: a
 * straight prism with a neck on it is one, however it is coloured. So the belly
 * swells between a bottom end that is gathered rather than cut flat and a
 * shoulder that slumps down into the tie, and the whole of it is squashed
 * flatter than it is wide, the way a full sack settles on a floor.
 */
function cartSack(b: Build): Mesh[] {
  const from = b.meshes.length;
  // Each piece is a cylinder laid along X (`z: PI/2` puts its top at -X, and
  // `-PI/2` at +X) and squashed upright, its own X being what stands after
  // the turn — so the squash is `scaling.x`, and the belly sits at `Y`.
  const Y = 0.14;
  const piece = (h: number, dTop: number, dBot: number, x: number, toward: 1 | -1): void => {
    b.cyl(h, dTop, dBot, 8, x, Y, 0, SAILCLOTH, { z: (-toward * Math.PI) / 2 }).scaling.x = 0.6;
  };
  piece(0.1, 0.28, 0.46, -0.32, -1);
  piece(0.4, 0.46, 0.42, -0.07, -1);
  piece(0.22, 0.2, 0.46, 0.24, 1);
  b.cyl(0.035, 0.1, 0.1, 6, 0.37, Y + 0.01, 0, PITCH, { z: -Math.PI / 2 });
  b.cyl(0.09, 0.16, 0.07, 6, 0.42, Y + 0.02, 0, SAILCLOTH, { z: -Math.PI / 2 + 0.25 });
  return b.meshes.slice(from);
}

/** A hay fork lying along X, tines at +X, on its own shaft. */
function cartFork(b: Build): Mesh[] {
  const from = b.meshes.length;
  b.cyl(1.5, 0.035, 0.04, 6, 0, 0, 0, TIMBER, { z: Math.PI / 2 });
  b.box(0.1, 0.035, 0.035, 0.78, 0, 0, IRON);
  b.box(0.035, 0.03, 0.24, 0.84, 0, 0, IRON);
  for (const z of [-0.11, 0, 0.11]) b.box(0.34, 0.016, 0.016, 1.0, 0.01, z, IRON, { z: 0.08 });
  return b.meshes.slice(from);
}

/** A cask standing on end, its foot at y = 0. */
function cartCask(b: Build, h: number, d: number): Mesh[] {
  const from = b.meshes.length;
  b.cyl(h / 2, d, d * 0.86, 10, 0, h / 4, 0, PLANK);
  b.cyl(h / 2, d * 0.86, d, 10, 0, (h * 3) / 4, 0, PLANK);
  for (const y of [0.08, 0.3, 0.7, 0.92]) {
    const k = 1 - Math.abs(y - 0.5) * 0.28;
    b.cyl(0.035, d * k + 0.02, d * k + 0.02, 10, 0, h * y, 0, IRON);
  }
  b.cyl(0.02, d * 0.8, d * 0.8, 10, 0, h - 0.005, 0, TIMBER);
  return b.meshes.slice(from);
}

/**
 * Farm wagon, bed along X, shafts to +X. Chest-high cover with a readable
 * silhouette — spoked wheels, a flared box on a turned front carriage, and the
 * shafts run out along the ground — so it never reads as a crate. `ruined`
 * has lost its near hind wheel and sits down on that corner, for ground that
 * has already been fought over.
 *
 * **It is built the way one is built, and that is the whole of the brief.**
 * The cart it replaces was a plank box on four discs with its shafts hanging in
 * the air, and every one of those three was a thing a player standing beside it
 * could see was not a cart. So: big wheels behind and small ones in front, the
 * front pair on a turntable under the bed so they can lock round, and locked
 * round a little, because nobody leaves a wagon with its wheels dead straight;
 * a perch coupling the two axles, hounds bracing each; a floor of boards on
 * bearers between two sills; sides that flare outward on staked standards
 * to a rave; a headboard and a pinned tailboard on chains; and the shafts,
 * unhitched, resting their tips on the ground — which is where a pair of
 * timbers pinned at one end goes when the horse walks out of them.
 *
 * **Everything that is not the collider is drawing**, and the collider is the
 * one box it has always been: 3.4 x 1.7 x 2.0, hard cover, in the same order.
 * The shafts, the naves, a load heaped over the rave and anything spilled on
 * the ground stand outside it, as the old shafts did — a round through a
 * shaft's tip or a tuft of hay is a round through dressing.
 *
 * **What it carries, and how it is kept, are seeded off where it stands**
 * (`streetSeed`), which is what puts it in `CONFORMS_TO_TERRAIN`: loose straw
 * and a fork, sacks, a heaped load of hay or casks; bare weathered timber or
 * the painted body and red running gear a wagon was sold in; which way the
 * front wheels are locked; and whether a chock sits behind a hind wheel. And it
 * SITS on the ground under its four wheels rather than on the one sample under
 * its middle — pitched and rolled to it, within reason — so a wagon on a slope
 * has all four tyres on the road.
 */
export function buildCart(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "cart");
  const ruined = p.ruined ?? false;
  const seed = streetSeed(3.4, 2.0, 1.7, ctx);
  /**
   * Painted — a blue body over red-oxide running gear, faded to what the
   * palette already has — or bare timber gone grey.
   */
  const painted = !ruined && (seed >>> 3) % 3 === 0;
  const BODY = painted ? ENAMEL : PLANK;
  const GEAR = painted ? BRICK : TIMBER;
  /** 0 straw and a fork, 1 sacks, 2 a load of hay, 3 casks. */
  const load = (seed >>> 7) % 4;
  /** Which way, and how far, the front wheels are locked. */
  const lock = (((seed >>> 11) & 1) === 0 ? -1 : 1) * (0.1 + ((seed >>> 12) % 5) * 0.035);
  const chocked = ((seed >>> 17) & 1) === 0;

  // ---- the numbers everything hangs off. Bed along X, shafts to +X.
  /** Hind and fore axle stations, and their wheels' radii — the hind pair big. */
  const XR = -0.95;
  const XF = 1.05;
  const RR = 0.66;
  const RF = 0.5;
  /** Where the wheels' planes stand either side of the centreline. */
  const TRACK = 0.9;
  /** The sills' underside, the floor's top, and the body's length. */
  const SILL = 0.84;
  const SILL_TOP = SILL + 0.14;
  const FLOOR = SILL_TOP + 0.035;
  const L = 3.1;
  const HL = L / 2;
  /**
   * The sides: they rise from the floor's edge at `SIDE_Z` and lean OUT by
   * `LEAN` for `SLANT` metres, to a rave at about the collider's top. The flare
   * is what a wagon box is — it is also what keeps the hind wheels, which stand
   * above the floor, clear of the boarding.
   */
  const SIDE_Z = 0.63;
  const LEAN = 0.24;
  const SLANT = 0.7;
  const cosL = Math.cos(LEAN);
  const sinL = Math.sin(LEAN);
  /** A point `s` up the slope of the side at `sz`, stood `n` off its outer face. */
  const onSide = (sz: number, s: number, n: number): [number, number] => [
    SILL_TOP + s * cosL - n * sinL,
    sz * (SIDE_Z + s * sinL + n * cosL),
  ];

  /**
   * The floor under a local point, as a local height, or 0 with nothing to
   * read — and 0 for a placement lifted onto something `MapBuilder` does not
   * know about (see `BuildCtx.floor`). `MapBuilder`'s rotation: local +X lands
   * on (cos, -sin), +Z on (sin, cos).
   */
  const ground = (lx: number, lz: number): number => {
    if (!ctx || Math.abs(ctx.y - ctx.floor) > 0.05) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    const h = ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
    return Math.max(-0.4, Math.min(0.4, h));
  };

  // ================================================================ the body
  // Built level, on its own frame; the ruin sits it down afterwards.
  const bodyFrom = b.meshes.length;
  // Two sills the length of the bed, and the end rails and bearers between.
  for (const sz of [-1, 1]) b.box(L + 0.06, 0.14, 0.1, 0, SILL + 0.07, sz * 0.58, GEAR);
  for (const sx of [-1, 1]) b.box(0.1, 0.14, 1.26, sx * (HL - 0.05), SILL + 0.07, 0, GEAR);
  for (const x of [-0.95, -0.3, 0.35, 1.0]) b.box(0.08, 0.1, 1.06, x, SILL + 0.09, 0, GEAR);
  // The floor: six boards, a finger's gap apart.
  {
    const bw = 0.2;
    const gap = 0.012;
    for (let i = 0; i < 6; i++) {
      const z = -0.63 + bw / 2 + i * (bw + gap);
      b.box(L - 0.02 - (i % 2) * 0.03, 0.035, bw, (i % 2) * 0.015, SILL_TOP + 0.0175, z, BODY);
    }
  }
  // The sides: three boards up the flare, each leaned out by `LEAN`.
  //
  // **The boards LAP rather than butt**: each overlaps the one under it and
  // the middle one stands `LAP` proud, so every joint is a step the ink finds
  // on both faces. A gap between square boards drew the same line and let a
  // lit window across the street shine through the cart.
  const BOARD = 0.237;
  const LAP = 0.007;
  const boardS = (i: number): number => BOARD / 2 + i * BOARD;
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const [y, z] = onSide(sz, boardS(i), 0.0175 + (i % 2) * LAP);
      b.box(L - 0.04, BOARD + 0.012, 0.035, 0, y, z, BODY, { x: sz * LEAN });
    }
    // Standards on the outer face, from the sill to the rave, with an iron
    // knee where each one meets the sill.
    for (const x of [-(HL - 0.05), -0.78, 0, 0.78, HL - 0.05]) {
      const [y, z] = onSide(sz, 0.29, 0.06);
      b.box(0.075, 0.86, 0.05, x, y, z, GEAR, { x: sz * LEAN });
      const [ky, kz] = onSide(sz, 0.02, 0.09);
      b.box(0.09, 0.14, 0.012, x, ky, kz, IRON, { x: sz * LEAN });
    }
    // The rave along the top, standing a little proud of the standards.
    {
      const [y, z] = onSide(sz, SLANT + 0.035, 0.035);
      b.box(L + 0.14, 0.075, 0.09, 0, y, z, GEAR, { x: sz * LEAN });
      // An iron cap over each end of it.
      for (const sx of [-1, 1]) {
        b.box(0.1, 0.085, 0.1, sx * (HL + 0.02), y, z, IRON, { x: sz * LEAN });
      }
    }
  }
  /** The body's half-width across the inside of its sides, at slope `s`. */
  const across = (s: number): number => 2 * (SIDE_Z + s * sinL);
  // The headboard, capped with a rail level with the raves. Its boards are
  // as tall as the sides' in plan, so their joints line through the corner.
  for (let i = 0; i < 3; i++) {
    const s = boardS(i);
    b.box(0.035, BOARD * cosL + 0.012, across(s), HL - 0.02 + (i % 2) * LAP, SILL_TOP + s * cosL, 0, BODY);
  }
  b.box(0.07, 0.07, across(SLANT) + 0.04, HL, SILL_TOP + 3 * BOARD * cosL + 0.02, 0, GEAR);
  for (const sz of [-1, 1]) {
    // Its two uprights, from the sill to the cap.
    b.box(0.075, 0.86, 0.05, HL + 0.035, SILL_TOP + 0.28, sz * 0.5, GEAR);
  }
  // The tailboard is its own piece: it comes out. On a ruin it has.
  const tailFrom = b.meshes.length;
  for (let i = 0; i < 3; i++) {
    const s = boardS(i);
    b.box(0.035, BOARD * cosL + 0.012, across(s) - 0.02, -(i % 2) * LAP, SILL_TOP + s * cosL, 0, BODY);
  }
  for (const sz of [-1, 1]) {
    b.box(0.012, 0.66, 0.06, -0.03, SILL_TOP + 0.34, sz * 0.4, IRON);
  }
  const tail = b.meshes.slice(tailFrom);
  if (!ruined) {
    reframe(tail, Matrix.Translation(-(HL - 0.02), 0, 0));
    // Pinned through the end standards, a chain from each top corner.
    for (const sz of [-1, 1]) {
      const [y, z] = onSide(sz, 0.62, 0.02);
      b.box(0.14, 0.022, 0.022, -(HL + 0.03), y, z, IRON);
      for (let k = 0; k < 4; k++) {
        b.box(0.02, 0.06, 0.035, -(HL + 0.06), y - 0.05 - k * 0.05, z - sz * 0.02 * k, IRON, {
          y: k % 2 ? Math.PI / 2 : 0,
        });
      }
    }
  }

  // ---- the hind carriage: fixed to the body, so it goes where the body goes.
  b.box(0.14, 0.14, 1.36, XR, RR, 0, GEAR);
  b.box(0.15, SILL - (RR + 0.07), 1.3, XR, (SILL + RR + 0.07) / 2, 0, GEAR);
  for (const sz of [-1, 1]) {
    b.box(0.17, 0.26, 0.03, XR, RR + 0.06, sz * 0.46, IRON);
  }
  // The perch, coupling the hind axle to the fore, and the hounds bracing it.
  b.box(XF - XR + 0.3, 0.09, 0.1, (XF + XR) / 2 + 0.05, RR - 0.08, 0, GEAR);
  {
    const x0 = XR;
    const x1 = XR + 0.95;
    const z0 = 0.42;
    const len = Math.hypot(x1 - x0, z0);
    for (const sz of [-1, 1]) {
      b.box(len, 0.07, 0.07, (x0 + x1) / 2, RR - 0.08, (sz * z0) / 2, GEAR, {
        y: sz * Math.atan2(z0, x1 - x0),
      });
    }
  }
  // The fore bolster under the body, and the turntable ring it bears on.
  b.box(0.14, 0.1, 1.2, XF, SILL - 0.05, 0, GEAR);
  b.cyl(0.03, 0.8, 0.8, 14, XF, SILL - 0.115, 0, IRON);
  // The hind wheels.
  for (const sz of [-1, 1]) {
    if (ruined && sz < 0) continue;
    const w = cartWheel(b, RR, 12, GEAR, 0.13 * sz + ((seed >>> 20) % 7) * 0.07);
    const flip = sz < 0 ? Matrix.RotationY(Math.PI) : Matrix.Identity();
    reframe(w, flip.multiply(Matrix.Translation(XR, RR, sz * TRACK)));
  }
  // A drag shoe hung on its chain from the near sill, ahead of the hind wheel,
  // as every wagon that ever went down a hill carried one.
  if (!ruined) {
    const x = XR + RR + 0.12;
    for (let k = 0; k < 5; k++) {
      b.box(0.035, 0.07, 0.02, x, SILL - 0.04 - k * 0.065, -0.66, IRON, { y: k % 2 ? Math.PI / 2 : 0 });
    }
    b.box(0.34, 0.05, 0.1, x - 0.1, SILL - 0.4, -0.66, IRON, { z: 0.35 });
    b.box(0.04, 0.1, 0.1, x - 0.26, SILL - 0.37, -0.66, IRON, { z: 0.35 });
  }
  // A step iron hung off the off-side sill by the front.
  b.box(0.03, 0.26, 0.03, XF - 0.45, SILL - 0.1, 0.66, IRON);
  b.box(0.18, 0.025, 0.1, XF - 0.45, SILL - 0.23, 0.69, IRON);

  // ---- the load, on the floor.
  const loadFrom = b.meshes.length;
  const onFloor = (meshes: Mesh[], x: number, z: number, yaw: number, lift = 0, roll = 0): void =>
    reframe(
      meshes,
      Matrix.RotationX(roll).multiply(Matrix.RotationY(yaw)).multiply(Matrix.Translation(x, FLOOR + lift, z)),
    );
  if (ruined) {
    // What is left of the sacks has slid to the low corner.
    onFloor(cartSack(b), -0.95, -0.22, 0.15, 0, -0.1);
    onFloor(cartSack(b), 0.1, -0.24, -0.1);
  } else if (load === 0) {
    // Loose straw left in drifts over the boards — low cones squashed flat,
    // since a slab of it is a plank — and a fork thrown in on top.
    for (const [x, z, d, h, sx] of [
      [-0.85, 0.15, 0.95, 0.16, 1.5],
      [0.25, -0.22, 0.8, 0.12, 1.7],
      [1.0, 0.25, 0.6, 0.1, 1.2],
      [-0.2, 0.3, 0.5, 0.08, 1.4],
    ] as const) {
      b.cyl(h, d * 0.3, d, 6, x, FLOOR + h / 2 - 0.01, z, STRAW, { y: x }).scaling.x = sx;
    }
    onFloor(cartFork(b), -0.7, -0.1, -0.35, 0.07, 0.05);
  } else if (load === 1) {
    // Sacks, laid two ways as they were thrown up.
    const SACKS: [number, number, number, number][] = [
      [-1.05, -0.3, 0.1, 0],
      [-1.05, 0.28, -0.05, 0],
      [-0.25, -0.28, 0.0, 0],
      [-0.25, 0.3, 0.12, 0],
      [0.6, -0.1, 1.5, 0],
      [-0.65, 0.0, 0.08, 0.24],
      [0.15, 0.02, -0.1, 0.24],
    ];
    for (const [x, z, yaw, lift] of SACKS) {
      if (lift > 0 && ((seed >>> 22) & 1) === 0 && x > 0) continue;
      onFloor(cartSack(b), x, z, yaw, lift);
    }
  } else if (load === 2) {
    // A load of hay heaped over the rave. The box fills the bed to the rave and
    // is all but hidden by it; what shows is a row of heaps over it, each a
    // shoulder and a crown stacked as the haystack's cap is, overlapping into
    // one ridge that rises and falls, and spread past the rave on both sides
    // the way a load is built. A single loaf drawn with seven facets read as a
    // lid; hanging wisps and loose stalks read as flaps and slots.
    b.box(L - 0.12, 0.62, 1.34, 0, FLOOR + 0.3, 0, STRAW);
    const HAY = FLOOR + 0.56;
    for (const [x, h, yaw] of [
      [-1.2, 0.34, 0.2],
      [-0.62, 0.48, 1.1],
      [-0.05, 0.42, 0.5],
      [0.5, 0.5, 1.6],
      [0.9, 0.32, 0.9],
    ] as const) {
      const sh = h * 0.5;
      b.cyl(sh, 1.3, 1.62, 7, x, HAY + sh / 2, 0, STRAW, { y: yaw }).scaling.x = 0.72;
      b.cyl(h - sh, 0.4, 1.3, 7, x, HAY + sh + (h - sh) / 2, 0, STRAW, { y: yaw + 0.45 }).scaling.x = 0.72;
    }
    const fork = cartFork(b);
    reframe(
      fork,
      Matrix.RotationZ(-0.75).multiply(Matrix.RotationY(0.5)).multiply(Matrix.Translation(-0.35, FLOOR + 1.02, 0.15)),
    );
  } else {
    // Casks stood on end and a crate, with a sack wedged against them.
    onFloor(cartCask(b, 0.78, 0.56), -0.95, -0.26, 0);
    onFloor(cartCask(b, 0.78, 0.56), -0.95, 0.3, 0.7);
    onFloor(cartCask(b, 0.62, 0.46), -0.3, 0.3, 0.2);
    b.box(0.7, 0.5, 0.56, 0.45, FLOOR + 0.25, -0.2, TIMBER, { y: 0.15 });
    for (const dx of [-0.33, 0.33]) {
      b.box(0.06, 0.52, 0.6, 0.45 + dx * Math.cos(0.15), FLOOR + 0.26, -0.2 - dx * Math.sin(0.15), PLANK, { y: 0.15 });
    }
    onFloor(cartSack(b), 0.45, 0.35, 0.1);
  }
  const loadMeshes = b.meshes.slice(loadFrom);
  const body = b.meshes.slice(bodyFrom, loadFrom).filter((m) => !tail.includes(m) || !ruined);

  // ====================================================== the fore carriage
  // Built square on its own axle, then turned on the kingpin by `lock`.
  const foreFrom = b.meshes.length;
  b.box(0.13, 0.13, 1.44, XF, RF, 0, GEAR);
  b.box(0.14, SILL - 0.13 - (RF + 0.065), 1.16, XF, (SILL - 0.13 + RF + 0.065) / 2, 0, GEAR);
  b.cyl(0.46, 0.05, 0.05, 6, XF, SILL - 0.16, 0, IRON);
  for (const sz of [-1, 1]) b.box(0.16, 0.24, 0.03, XF, RF + 0.05, sz * 0.44, IRON);
  // The fore hounds, from a slider bar under the perch out to the shaft pins.
  /** Where each shaft is pinned, and the height it is pinned at. */
  const PX = XF + 0.5;
  const PZ = 0.36;
  const PY = RF + 0.02;
  {
    const x0 = XF - 0.55;
    const z0 = 0.12;
    const len = Math.hypot(PX - x0, PZ - z0);
    for (const sz of [-1, 1]) {
      b.box(len, 0.075, 0.07, (x0 + PX) / 2, PY, (sz * (z0 + PZ)) / 2, GEAR, {
        y: -sz * Math.atan2(PZ - z0, PX - x0),
      });
    }
    b.box(0.07, 0.06, 0.5, x0, RR - 0.15, 0, GEAR);
  }
  for (const sz of [-1, 1]) {
    const w = cartWheel(b, RF, 10, GEAR, 0.21 * sz + ((seed >>> 24) % 5) * 0.09);
    const flip = sz < 0 ? Matrix.RotationY(Math.PI) : Matrix.Identity();
    reframe(w, flip.multiply(Matrix.Translation(XF, RF, sz * TRACK)));
  }
  // The shafts, unhitched: pinned at the hounds and resting their tips on the
  // ground ahead, which is where they fall when the horse walks out of them.
  // The ruin has snapped one and the rest of it lies where it fell.
  const SHAFT = 2.75;
  const tip = 0.05;
  const pitch = -Math.asin((PY - tip) / SHAFT);
  const along = (d: number): [number, number] => [PX + Math.cos(pitch) * d, PY + Math.sin(pitch) * d];
  for (const sz of [-1, 1]) {
    const snapped = ruined && sz > 0;
    const len = snapped ? 1.25 : SHAFT;
    const [x, y] = along(len / 2);
    b.box(len, 0.085, 0.07, x, y, sz * PZ, GEAR, { z: pitch });
    b.box(0.1, 0.11, 0.09, PX, PY, sz * PZ, IRON);
    if (!snapped) {
      const [tx, ty] = along(SHAFT - 0.05);
      b.box(0.1, 0.1, 0.085, tx, ty, sz * PZ, IRON, { z: pitch });
      const [hx, hy] = along(1.55);
      b.box(0.12, 0.05, 0.03, hx, hy + 0.05, sz * (PZ + 0.05), IRON, { z: pitch });
      b.box(0.03, 0.08, 0.03, hx + 0.05, hy + 0.08, sz * (PZ + 0.05), IRON, { z: pitch });
    }
  }
  {
    const [x, y] = along(0.35);
    b.box(0.07, 0.07, 2 * PZ + 0.1, x, y + 0.01, 0, GEAR, { z: pitch });
  }
  const fore = b.meshes.slice(foreFrom);
  reframe(fore, about(XF, 0, 0, Matrix.RotationY(lock)));

  // ================================================================ the ruin
  // The near hind wheel is off and the body has come down on that corner,
  // pitched back and rolled toward it about the turntable, with the axle's end
  // propped on a log somebody got under it.
  const loose: Mesh[] = [];
  if (ruined) {
    const sit = about(XF, SILL - 0.1, 0, Matrix.RotationZ(0.12).multiply(Matrix.RotationX(-0.26)));
    reframe([...body, ...loadMeshes], sit);
    // A log rolled under the axle-tree's end, wherever the sit put it.
    const stub = Vector3.TransformCoordinates(new Vector3(XR, RR, -0.62), sit);
    const propD = Math.max(0.12, stub.y - 0.07);
    b.cyl(0.6, propD, propD * 1.08, 7, stub.x, propD / 2, stub.z, TIMBER, { x: Math.PI / 2, y: 0.3 });
    // The wheel, face down where it came off and canted up on its nave.
    const w = cartWheel(b, RR, 12, GEAR, 0.4, true);
    reframe(
      w,
      Matrix.RotationX(Math.PI / 2)
        .multiply(Matrix.RotationZ(0.14))
        .multiply(Matrix.RotationY(0.6))
        .multiply(Matrix.Translation(XR - 0.35, 0.17 + ground(XR - 0.35, -1.75), -1.75)),
    );
    loose.push(...w);
    // The tailboard, flat on the ground behind, irons up.
    reframe(
      tail,
      Matrix.Translation(0, -(SILL_TOP + 0.35), 0)
        .multiply(Matrix.RotationZ(-Math.PI / 2))
        .multiply(Matrix.RotationY(0.25))
        .multiply(Matrix.Translation(-HL - 0.75, 0.02 + ground(-HL - 0.75, 0.2), 0.2)),
    );
    loose.push(...tail);
    // The broken half of the shaft, and a sack that went over the side.
    const brokenFrom = b.meshes.length;
    b.box(1.45, 0.085, 0.07, 0, 0.04, 0, GEAR);
    b.box(0.1, 0.1, 0.085, 0.68, 0.045, 0, IRON);
    reframe(
      b.meshes.slice(brokenFrom),
      Matrix.RotationY(-0.5).multiply(Matrix.Translation(PX + 2.0, ground(PX + 2.0, 1.0), 1.0)),
    );
    loose.push(...b.meshes.slice(brokenFrom));
    const sack = cartSack(b);
    reframe(
      sack,
      Matrix.RotationX(0.2).multiply(Matrix.RotationY(1.2)).multiply(Matrix.Translation(-0.6, ground(-0.6, -1.35), -1.35)),
    );
    loose.push(...sack);
  } else if (chocked) {
    // A chock behind a hind wheel.
    const x = XR - 0.34;
    const from = b.meshes.length;
    b.box(0.24, 0.13, 0.14, x, 0.05 + ground(x, TRACK), TRACK, TIMBER, { z: -0.3 });
    loose.push(...b.meshes.slice(from));
  }

  // ============================================================ the ground
  // Sit the whole cart down on the ground under its four wheels: the pitch
  // between the axles, the roll across them, and the lift that puts all four
  // tyres on the floor. Anything already lying on the ground found its own.
  const gF = (ground(XF, TRACK) + ground(XF, -TRACK)) / 2;
  const gR = (ground(XR, TRACK) + ground(XR, -TRACK)) / 2;
  const gP = (ground(XF, TRACK) + ground(XR, TRACK)) / 2;
  const gN = (ground(XF, -TRACK) + ground(XR, -TRACK)) / 2;
  const clamp = (v: number): number => Math.max(-0.18, Math.min(0.18, v));
  const pitchG = clamp(Math.atan2(gF - gR, XF - XR));
  const rollG = clamp(Math.atan2(gP - gN, 2 * TRACK));
  const lift = (gF + gR) / 2 - ((XF + XR) / 2) * Math.tan(pitchG);
  if (pitchG !== 0 || rollG !== 0 || lift !== 0) {
    const standing = b.meshes.filter((m) => !loose.includes(m));
    reframe(
      standing,
      Matrix.RotationZ(pitchG).multiply(Matrix.RotationX(-rollG)).multiply(Matrix.Translation(0, lift, 0)),
    );
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
