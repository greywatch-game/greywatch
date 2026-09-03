/**
 * generate-cinderhaven.mjs — SEEDS Cinderhaven, the volcanic island town:
 * writes `src/world/cinderhaven/{layout,heights}.ts`.
 *
 * Run with `npm run cinderhaven`. Committed output, like every `heights.ts` and
 * every collision bake, and re-running it with the tree unchanged must produce
 * the same bytes.
 *
 * ## Why this map is seeded and not typed
 *
 * `scripts/generate-sarab.mjs`'s header owns that argument in full and this
 * map is the same argument one size up: a 1,500 m play square is 2.8 times
 * Sarab's area, its floor is sixty-three thousand numbers, and a town that
 * fills a harbour is some hundreds of buildings whose only interesting
 * property is that none of them overlaps another. What is AUTHORED here is the
 * design — the coast, the cone, the bay, the five flags, every set piece and
 * every quarter's recipe — and what is MECHANICAL is the transcription.
 *
 * The output is an ordinary layout file: flat arrays of one-line entries,
 * which is what `src/editor/sourceScan.ts` requires, so F2 opens it and Ctrl+S
 * patches it exactly as it patches Harrowmead's. Re-running this discards
 * those edits, the same warning every `heights.ts` carries.
 *
 * ## The island, and what each part of it is for
 *
 * The header this writes into `layout.ts` carries the map's own argument;
 * repeating it here would give it two places to be wrong. What lives HERE is
 * the construction, and four things about it are worth stating before any
 * code:
 *
 * - **THE FLOOR IS THE MAP.** Every other map in the tree is a town on ground;
 *   this one is ground with a town on it, because an island's whole shape —
 *   what is land, where the water goes, which slopes can be walked and which
 *   cannot — is one continuous function. `heightAt` is five passes laid over
 *   one another in a fixed order and the order is the argument: the coast; the
 *   cone masked by that coast, so it rises out of the water as a sea cliff;
 *   CINDER BAY cut through both of them; CHAPEL ROCK raised in the middle of
 *   the bay AFTER that cut, because a rock raised before it is a rock the cut
 *   flattens; and the districts flattened dead level last. The `pass one` ..
 *   `pass five` banners below are that order, and `baseAt` is the first four
 *   of them in one expression.
 * - **WHAT IS WATER IS DECIDED BY THE FLOOR AND BY NOTHING ELSE.** A
 *   `WaterRect` is an extent rather than a shore (`WaterSystem.bakeDepth`), so
 *   the sea is four rectangles that PARTITION the whole 2,000 m square as a
 *   pinwheel, and the bed under them decides where the coastline is. What
 *   picks that partition is where the PROBES stand and where the SEAMS fall,
 *   never the shape of the water — `WATER` owns that argument, and the survey
 *   proves it over the finished floor rather than leaving it to be read off
 *   the numbers.
 * - **THE SEA IS WADEABLE AND THE CLIFFS ARE NOT.** There is no swimming in
 *   this engine, so a shelf a player walks off into eight metres of water is a
 *   pit with a lid on it. The shelf here is 1.6 to 2.6 m — waist to chest, and
 *   walkable, which makes the harbour flat a route and the strand a flank —
 *   and everything that must NOT be walked is made steep enough to sever its
 *   own nav links instead: the cone above the works, and the north-west sea
 *   cliffs the cone's own coastal mask cuts.
 * - **Nothing overlaps anything, and that is enforced rather than authored.**
 *   Every placement, road, flag ring, spawn and hardstanding claims an
 *   axis-aligned rectangle and a candidate landing on a claimed one is
 *   dropped, so a quarter's recipe may ask for more than fits and get what
 *   fits. Sarab's rule, and its `must()` for the set pieces with it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "src", "world", "cinderhaven");

// --- the extent --------------------------------------------------------------

/** The PLAY square: everything priced on map area is priced on this. */
const PLAY = 1500;
/** Open water past it. Costs terrain and nothing else — see `Borderland`. */
const MARGIN = 250;
/**
 * How far the SEA is drawn, measured from the middle of the map.
 *
 * **This is the map's horizon, and it is the number that retired the rim.**
 * Every other map here closes its boundary with a landform because there is
 * nothing beyond it — an island cannot, because an island is a thing you can
 * see the whole way round and a ring of hills at a kilometre is a bowl however
 * it is broken up. So the sea runs out until it is past `fogEnd` from anywhere
 * anybody can stand, and what closes the horizon is the fog over it.
 *
 * The arithmetic is the boundary colliders plus the fog wall and nothing
 * clever: `PLAY / 2 + MARGIN` is 1,000 m and is the furthest anything in the
 * simulation can physically get, `fogEnd` is 1,250 (see `environment.ts`) and
 * the fog is LINEAR and clamped, so it is exactly `fogColor` at that range —
 * 2,250 m is the first radius at which the far edge of the water cannot be
 * seen from the near edge of the world. 2,300 is that with fifty metres of
 * slack, and the sky dome is flat `fogColor` below the horizon, so the join
 * between the two is a horizon line rather than a seam.
 *
 * **It costs four rectangles and nothing else.** A `WaterRect` is a single
 * quad with an analytic surface on it, the bed under it is a texture rather
 * than geometry (`WaterSystem.bakeDepth`), and at `CONFIG.water.depthMax` of
 * 1.5 m the body is fully opaque — so the floor is NOT tessellated out here
 * and does not need to be. The ground still stops at `MARGIN`, which is what
 * `borderland` says and all a leashed player can reach.
 */
const OCEAN = 2300;
/** Metres per heightfield cell. `CELLS * CELL` must equal `PLAY`. */
const CELL = 6;
const CELLS = PLAY / CELL;
const HALF = PLAY / 2;
/** The steepest gradient the nav graph links across (`nav.stepHeight / cellSize`). */
const MAX_GRADE = 0.4;
/** The water plane. Land is above it; everything below it is sea. */
const SEA = 0;

// --- the seeded stream -------------------------------------------------------

/**
 * One stream for the whole generation, in authored order — the same discipline
 * `MapBuilder` applies to scatter. Deterministic, so the committed file is a
 * function of this script and nothing else.
 */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x43494e44);
/** A float in [lo, hi). */
const rand = (lo, hi) => lo + rng() * (hi - lo);
/** An integer in [lo, hi]. */
const randInt = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
/** One of `list`. */
const pick = (list) => list[Math.floor(rng() * list.length)];
/** True with probability `p`. */
const chance = (p) => rng() < p;
/** A float in [lo, hi), rounded to two places — for a number a layout STATES. */
const rnd = (lo, hi) => Number(rand(lo, hi).toFixed(2));

const smooth = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
/** Move `a` toward `b` by `k`. */
const mix = (a, b, k) => a + (b - a) * k;
/** Signed angular difference, wrapped to (-pi, pi]. */
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

// --- pass one: the coast -----------------------------------------------------

/**
 * The two HEADLANDS, one per home landing.
 *
 * A home yard is 82 m across and has to stand on land with a road out of it,
 * and the harmonic coast below dips to 538 m in places — so the two corners
 * the sides land on are stated rather than hoped for. They are the same reach
 * and the same width on both bearings, which is what makes the two approaches
 * mirror images at the only place on this map where that matters.
 */
const HEADLANDS = [
  { at: Math.atan2(495, -495), reach: 205, width: 0.46 },
  { at: Math.atan2(-475, 475), reach: 205, width: 0.46 },
];

/**
 * How far the shoreline stands from the middle of the map on a bearing.
 *
 * Three harmonics and two headlands. The harmonics are what make a coast read
 * as a coast — three periods that do not divide into one another, so no bay
 * repeats — and they swing 110 m either side of a 648 m base, so the shoreline
 * dips to 538 m where all three agree.
 *
 * **Nothing constrains that dip any more, and it is worth saying so because it
 * used to.** When the sea was a frame of strips around a square hole, water
 * cut inside the hole was water no rect drew — wet ground under a dry sky — so
 * the island had to FILL the hole and the base was set to stand clear of the
 * hole's own diagonal at 509 m. The pinwheel at `WATER` partitions the whole
 * square instead, so a cove may be cut on any bearing and the survey's "wet
 * vertices in no rect" is what says so.
 */
function coastRadius(t) {
  let r =
    648 +
    56 * Math.sin(3 * t + 0.55) +
    33 * Math.sin(5 * t - 1.15) +
    21 * Math.sin(7 * t + 2.35);
  for (const h of HEADLANDS) {
    const d = angDiff(t, h.at) / h.width;
    r += h.reach * Math.exp(-d * d);
  }
  return r;
}

/**
 * The island's own section, as a function of how far inside the coast a point
 * is (`d`, positive on land).
 *
 * **Seaward it is SHALLOW on purpose and that is a gameplay decision, not a
 * limitation.** There is no swimming in this game: a player who walks off a
 * shelf into eight metres of water is under a plane that is back-face culled
 * from below, which is a black pit with a coastline drawn round it. The shelf
 * is 1.6 m at twenty-six metres out and 2.3 at three hundred — waist to chest
 * — so wading the strand round a headland is a flank rather than a fall, bots
 * can use it because the nav graph links across it, and what stops anyone
 * going further is `world/leash.ts` rather than the ground.
 *
 * **Inland it is LOW, and that is set by the BAY rather than by the coast.**
 * Two smoothsteps — 7 m over 280 and 3.5 more over 660, so the interior shelf
 * tops out near 11 m — and what decides both is what a foreshore COSTS. The
 * beach is as long as the ground behind it is high (`FORE_PER_M`), so every
 * metre of shelf is twelve more metres of sand between a town and its own
 * water: at 11 m that is about 120 m of foreshore, and at the 22 m an island
 * this size would naturally carry it is 250 — given up all the way round the
 * inside of the C, which is most of an arm. **Every metre of drama on this
 * island is the CONE's or the PLUG's**, which is what a lava apron round a
 * volcano actually looks like, and it is why the shelf could be given up
 * cheaply.
 */
function shoreProfile(d) {
  if (d >= 0) return 0.8 + 7 * smooth(d / 280) + 3.5 * smooth(d / 660);
  const a = -d;
  return 0.8 - 2.4 * smooth(a / 26) - 0.7 * smooth((a - 60) / 260);
}

// --- pass two: the cone ------------------------------------------------------

/** Where Grimhold stands. */
const V = { x: -400, z: -380 };

/**
 * The cone's radial section, interpolated with a smoothstep between control
 * radii — so what each pair of rows states is an AVERAGE gradient and the
 * steepest the segment reaches is 1.5 times it.
 *
 * **The profile is designed around one line, `MAX_WALKABLE_GRADE` (0.4), and
 * every row outside 168 m is under it while every row inside is over it.**
 * The crater's inner wall peaks at 0.62 and the upper cone between 104 and
 * 168 m at 0.89, so the nav graph severs itself in a ring round the mountain
 * and the summit is ground nothing on this map can reach. That is the whole
 * design of the upper cone: a landmark and a glow rather than a position, so
 * nobody holds the highest point on a 1,500 m map.
 *
 * **Outside 168 m every peak is 0.33 or less and that is TIGHTER than it
 * looks**, because a district flattened on a flank adds its own fill back on
 * top of the natural gradient — the works terrace is on this slope, and what
 * it costs is a 150 m skirt (see `DISTRICTS`).
 *
 * The first row is the CRATER: the rim at 58 m out stands 24 m over the floor
 * inside it, which is a bowl a hundred and sixteen metres across that nothing
 * can climb into and everything can see the glow of.
 */
const CONE = [
  [0, 96],
  [58, 120],
  [104, 106],
  [168, 68],
  [250, 50],
  [350, 32],
  [470, 12],
  [600, 0],
];

function coneAt(r) {
  if (r >= CONE[CONE.length - 1][0]) return 0;
  for (let i = 1; i < CONE.length; i++) {
    const [r0, h0] = CONE[i - 1];
    const [r1, h1] = CONE[i];
    if (r <= r1) return mix(h0, h1, smooth((r - r0) / (r1 - r0)));
  }
  return 0;
}

// --- pass three: the bay -----------------------------------------------------

/**
 * CINDER BAY, and the C the island is bent into around it.
 *
 * **This is the shape of the map and everything else is arranged against it.**
 * What stood here was a reach — a drowned valley 400 m by 280 cut in from the
 * east coast, with the town on its two banks and one ford across it — and it
 * was a river with a harbour on it rather than a harbour. A bay is a different
 * object: it is water you cross rather than water you go round, it has a MOUTH
 * that can be held, and the ground it is cut out of is two arms with a
 * shoreline down both sides of each of them.
 *
 * It is a BASIN and a MOUTH, unioned — the plainest shape that is a C rather
 * than a bite. The basin is a disc 600 m across sitting west of the middle of
 * the map, the mouth is a capsule 260 m across running east-south-east out
 * through the coast, and what is left of the island is a north arm, a south
 * arm and the back the two of them grow out of. **The mouth is a little over
 * two fifths of the basin's width and that ratio is the whole C**: a bay whose
 * mouth is as wide as its basin is a bite, and you can see the whole of it
 * from outside.
 *
 * `bayIn` is signed — metres INSIDE the water's nominal edge, negative on land
 * — and everything downstream reads it: the foreshore, the bed, the two
 * waterfront districts, and every jetty and boat shed on them.
 */
const BAY = { x: 160, z: 95, r: 300 };
/** The mouth, as a capsule: its axis, and how far the water reaches off it. */
const MOUTH = { ax: 160, az: 95, bx: 900, bz: 35, hw: 130 };

/** Distance from a point to a segment — the mouth's own half of `bayIn`. */
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/**
 * How far the bay's own shore stands from the middle of it on a bearing.
 *
 * **Three harmonics, for the reason `coastRadius` has three: a circle reads as
 * a reservoir.** The first version of this bay was `BAY.r` flat, and from any
 * height at all it was plainly a disc somebody had subtracted — the one thing
 * about the map that looked authored rather than eroded. The periods do not
 * divide into one another, so no cove repeats, and the swing is ±50 m at the
 * extremes against a 300 m radius: enough for two points and three bights,
 * small enough that the two waterfront quarters still stand square to the
 * water they were sited against.
 *
 * It costs nothing downstream because nothing downstream reads the nominal
 * edge — `bayShore` MARCHES the finished floor, so the Strand, the sheds, the
 * jetties and the bay road all followed the new coves without a coordinate
 * moving.
 */
function bayRadius(t) {
  return (
    BAY.r +
    26 * Math.sin(3 * t - 0.4) +
    15 * Math.sin(5 * t + 1.9) +
    9 * Math.sin(7 * t + 0.7)
  );
}

function bayIn(x, z) {
  const basin = bayRadius(Math.atan2(z - BAY.z, x - BAY.x)) - Math.hypot(x - BAY.x, z - BAY.z);
  const mouth = MOUTH.hw - segDist(x, z, MOUTH.ax, MOUTH.az, MOUTH.bx, MOUTH.bz);
  return Math.max(basin, mouth);
}

/**
 * How far the FORESHORE reaches inland, how far the beach runs out under the
 * water, and how deep the bay gets.
 *
 * **The three of them are one argument, and it is the same argument the shelf
 * outside the island is drawn from: THE WATER HAS TO BE WADEABLE.** There is
 * no swimming in this engine, so every metre of this bay is ground somebody
 * can stand on — 2.6 m at the deepest, which is exactly what the old reach's
 * mouth already was, so nothing here is a new precedent at a much larger size.
 * What it buys is the thing this map needed before it can ever have a boat on
 * it: the rock in the middle of the bay is a flag you can WALK to, from either
 * shore, today, and a hull fords the shallows at either end. What a boat would
 * add is SPEED AND A GUN, not access — which is the right way round, because a
 * vehicle that is the only way to reach an objective is a vehicle whose loss
 * takes the objective with it.
 *
 * The three numbers are set by `MAX_WALKABLE_GRADE` rather than by taste. The
 * natural interior shelf stands at 10-11 m, so the foreshore has ten metres to
 * give up: 82 m of it is a 0.13 average and a 0.20 peak, which links. Inside
 * the water the bed falls 2.6 m over 260, which is nothing at all — the nav
 * graph runs clean across the whole bay, and that is what makes the wade real
 * rather than a shape on a map.
 */
const FORE = 82;
/**
 * How many metres of beach each metre of land behind it is worth, and the most
 * a beach may be.
 *
 * **The foreshore is as long as the ground behind it is HIGH, and that one
 * line is what let the bay be cut into a volcano.** A fixed 82 m suits the
 * interior shelf, which stands at 10-11 m: it puts a 0.17 peak gradient on the
 * beach and links. The bay's north-west corner is under Grimhold's own apron
 * at 26 m, where the same 82 m is a 0.47 gradient — a severed shore, five
 * hundred cells of it, and a whole quadrant of the bay you could see and never
 * reach. Twelve metres of run per metre of fall holds the peak at 0.13
 * everywhere — the ramp is a smoothstep, so its peak is 1.5 times its average
 * of one in twelve — which puts about 120 m of beach under the town and runs
 * the one under the mountain into the `FORE_MAX` cap below.
 *
 * The cap is what stops that from eating the island: at `FORE_MAX` the rule
 * gives up rather than flattening a mountainside, and the survey is what says
 * so — a shore too high for the cap comes out as a rogue steep edge with a
 * coordinate on it.
 */
const FORE_PER_M = 12;
const FORE_MAX = 300;
const BEACH = 46;
const BED_RUN = 260;
const BED_DEEP = 2.6;
/** The height the foreshore hands over to the water at. */
const WATERLINE_H = 0.9;

/**
 * How fast a district gives up its authority once it is over the water.
 *
 * **A district levels LAND, and the bay is not land** — that is the rule, and
 * this is the only number in it. A core is an axis-aligned rectangle over a
 * town on a curved shore, so several of them reach out over their own harbour;
 * left alone, a skirt fills the bay in, and the works' 48 m terrace a hundred
 * and seventy metres up the mountain reached far enough to put dry ground out
 * in the water.
 *
 * Twenty metres is short enough that the SHORELINE is the FLOOR's and not a
 * district's, which matters more than it sounds: every waterfront on this map
 * is placed off where `bayShore` finds the water, so a shore a district
 * invented moves every jetty standing on it — and moves it again the next time
 * somebody nudges a town centre fifteen metres.
 */
const WET_FADE = 50;

/**
 * Cut the bay through whatever the coast and the cone left.
 *
 * Two ramps meeting at the nominal edge, so the profile is continuous and has
 * no step in it anywhere: OUTSIDE, the natural ground is brought down to
 * `WATERLINE_H` over `FORE` metres; INSIDE, that hands over to the bed. The
 * real waterline is therefore some way inside the nominal edge — about
 * twenty-five metres — which is why nothing downstream authors a shore
 * coordinate and everything asks `bayShore` for one.
 */
function bayCut(h, x, z) {
  const d = bayIn(x, z);
  const fore = Math.min(FORE_MAX, Math.max(FORE, (h - WATERLINE_H) * FORE_PER_M));
  if (d < -fore) return h;
  if (d <= 0) return mix(h, WATERLINE_H, 1 - smooth(-d / fore));
  const bed = -0.3 - (BED_DEEP - 0.3) * smooth(d / BED_RUN);
  return mix(WATERLINE_H, bed, smooth(d / BEACH));
}

// --- pass four: the rock -----------------------------------------------------

/**
 * CHAPEL ROCK: the lava plug standing in the bay, and flag C.
 *
 * It was the bluff on the north shore of the reach and it is the same rock —
 * the same 26 m of it, the same chapel on the crown — with the water brought
 * round it. That is the one thing on this map that could not have been done
 * any other way: a control point in the middle of a bay is what makes the bay
 * a PLACE rather than a gap between two halves of a town, and it is the only
 * flag on the island with no road to it.
 *
 * **It is raised AFTER the bay is cut, and that order is the whole of it.**
 * The bay is a mix toward a bed, so a rock raised before the cut is a rock the
 * cut flattens; raised after, it stands out of the water with its own skirt.
 * The skirt is what the flag rests on: 26 m over a 150 m run is a 0.26 peak
 * gradient, well under `MAX_WALKABLE_GRADE`, so the nav graph climbs it from
 * every bearing and the wade up out of the water is continuous with it.
 *
 * The land that makes is about 215 m across at the waterline, which holds a
 * chapel, a graveyard, four cottages and no sixth thing. That is the size it
 * is meant to be.
 */
const ROCK = { x: 200, z: 10, h: 20, top: 44, run: 80 };

/**
 * The rock's own radial section: a dead-level CROWN and a skirt off it.
 *
 * **It is a plateau rather than a dome, and that is what lets it be the one
 * district on this map that is not in `DISTRICTS`.** A dome levelled by a
 * district core has to give the fill back over a skirt that is already on the
 * dome's own slope, which on something this small is a 0.46 gradient right
 * round the chapel — the churchyard mistake the bluff made, at a quarter of
 * the size. Stating the flat top as part of the profile costs one line and
 * makes the levelling free: 88 m of ground inside 2 cm of level, which is the
 * chapel, the graveyard terrace and four cottages with nothing left over.
 *
 * 20 m over an 80 m run is a 0.375 peak gradient — under `MAX_WALKABLE_GRADE`
 * with the margin the wade needs, since a body coming up out of the water
 * meets this slope with the bed's own fall already under it.
 */
function rockAt(r) {
  if (r <= ROCK.top) return ROCK.h;
  if (r >= ROCK.top + ROCK.run) return 0;
  return ROCK.h * (1 - smooth((r - ROCK.top) / ROCK.run));
}

// --- pass five: the districts ------------------------------------------------

/**
 * Every place that has to be DEAD LEVEL, and how far the flattening blends
 * out.
 *
 * A placement samples the terrain once at its own centre, so a building on a
 * grade floats at one corner and buries itself at the other — which is why
 * this list exists at all and why it is the last pass.
 *
 * **What each one is levelled TO is derived rather than authored**, and that
 * is the single change that made this floor buildable. A hand-written height
 * is a second statement about ground the first four passes have already
 * decided, and it goes stale the moment any of them moves: the bluff was
 * authored at 26.2 against a plug that puts it at 38, which is a twenty-metre
 * cut blended over a sixty-metre skirt and a 0.48 gradient all the way round
 * the churchyard. Taking each core's height from `anchor` — the natural floor
 * at a point the district is MEANT to sit at the height of — makes the skirt
 * absorb only the natural relief across the core, which on a field this smooth
 * is a couple of metres.
 *
 * The `anchor` is the centre unless a district straddles two grounds, and on
 * this map both WATERFRONTS do: the quay and the net sheds each want the
 * height of their own foreshore rather than the shelf behind them, so each is
 * anchored out on the bank it is built over. That is the rule the reach's two
 * banks already needed, and it is more load-bearing here, because a bay's
 * foreshore is a ramp the whole way round rather than a levelled bench.
 */
const DISTRICTS = [
  { n: "quay", x: -106, z: 361, hw: 116, hd: 116, skirt: 62 },
  { n: "oldtown", x: -380, z: 180, hw: 156, hd: 92, skirt: 120 },
  // The works' bench runs 90 m further UP the mountain than the yard needs,
  // and the Cinderworks is why: a smelter is 62 m of hall, furnace and stack
  // and there is no room for one inside a crossroads. The anchor stays at the
  // yard, so what the extra core does is CUT the cone's flank rather than
  // move the level everything else on this flag was built to.
  { n: "works", x: -330, z: -140, hw: 74, hd: 92, skirt: 172, anchor: [-330, -110] },
  { n: "netstrand", x: 420, z: -165, hw: 116, hd: 116, skirt: 62 },
  { n: "home0", x: -495, z: 495, hw: 82, hd: 74, skirt: 56 },
  { n: "home1", x: 475, z: -475, hw: 82, hd: 74, skirt: 56 },
];

/** Distance from a point to the edge of an axis-aligned district core. */
function rectDist(x, z, r) {
  const dx = Math.abs(x - r.x) - r.hw;
  const dz = Math.abs(z - r.z) - r.hd;
  if (dx <= 0 && dz <= 0) return 0;
  return Math.hypot(Math.max(0, dx), Math.max(0, dz));
}

// --- the floor ---------------------------------------------------------------

/**
 * The island before anything is levelled on it: the coast, the cone, the bay
 * and the rock standing in it.
 *
 * The cone is MASKED by the coast rather than added over it, and that one line
 * is what makes this an island instead of a mountain with a beach painted on
 * it: `landMask` is zero six metres offshore and full sixty-four metres in, so
 * the cone's own thirty metres of flank at the north-west shoreline is raised
 * over seventy metres of run — a 0.64 gradient, which severs, which is exactly
 * the sea cliff a lava flow reaching the water makes.
 *
 * **The bay is cut after the cone is masked and before the rock is raised**,
 * and both of those orderings are doing work: cutting after the cone lets the
 * bay eat into the mountain's own apron at its head, and raising the rock
 * after the cut is what stops the cut from levelling it (see `ROCK`).
 *
 * **There is no graded haul road in here and there deliberately is not.** An
 * earlier version cut a level corridor from the town up to the works, on the
 * assumption that the cone's flank was too steep to walk; it is not. The steep
 * band is 104-168 m from the summit and the works stand at 279, so every metre
 * of the route is under 0.33 already — and the corridor's only real effect was
 * to lift the ground under the old town it started in. The haul road is a
 * ROAD, which is a picture, and the mountain is walked as it is.
 */
function baseAt(x, z) {
  const r = Math.hypot(x, z);
  const t = Math.atan2(z, x);
  const d = coastRadius(t) - r;
  let h = shoreProfile(d);

  const landMask = smooth((d + 6) / 70);
  h += coneAt(Math.hypot(x - V.x, z - V.z)) * landMask;

  h = bayCut(h, x, z);

  return h + rockAt(Math.hypot(x - ROCK.x, z - ROCK.z));
}

// Each district's level, taken from the ground it is meant to stand on — see
// `DISTRICTS`. Resolved once, here, because `heightAt` reads it for every one
// of the sixty-three thousand vertices it writes and for every placement test.
for (const dist of DISTRICTS) {
  const [ax, az] = dist.anchor ?? [dist.x, dist.z];
  dist.h = Number(baseAt(ax, az).toFixed(2));
}

/**
 * The last band of the play square, and how deep the floor is by the end of it.
 *
 * **The floor's own outer ring is SEA, and that is a rule about what happens
 * PAST it rather than about the ring.** `TerrainField` clamps every query
 * outside the heightfield to its edge, so whatever stands on the last row of
 * vertices is what runs outward for as far as anything is drawn out there —
 * and the ocean is drawn to `OCEAN` now. Two 60 m stretches of the east
 * coast's foreshore reached the boundary at 0.9 m ABOVE the water, which was a
 * 250 m spit while the sea stopped at the margin and is a kilometre and a half
 * of dead-straight sandbar running to the horizon once it does not.
 *
 * **The depth is set by the bed MAP rather than by the bed**, and it is the one
 * number here worth deriving again if anything moves. `CONFIG.water.depthMax`
 * is 1.5 m, past which the body is saturated: no shoal grading, no foam and no
 * bed showing through. Out in the borderland `TerrainField.borderRoll` swings
 * the clamped edge by half of `roll` — 0.7 m — so the edge has to stand 2.2 m
 * under the surface for the SHALLOWEST thing the roll can make out there still
 * to be open water. Anything less and the ocean grows wandering shoals with
 * foam on them, which is the failure `roll` was kept small for in the first
 * place. -2.6 is that with slack, and it is also the deepest water on the map,
 * which is the right thing for the ground to hand over to.
 *
 * It is a `min`, so it only ever takes ground away and no wet vertex is ever
 * raised; the fall is 3.5 m over 48, which is 0.073 against a `MAX_GRADE` of
 * 0.4, so nothing severs; and everything it can reach is inside the last 48 m
 * of the play square, which is the leash line — ground a player is being
 * killed for standing on and nothing is built on.
 */
const EDGE_BAND = 48;
const EDGE_SEA = -2.6;

/**
 * The finished ground: the island, with the districts levelled into it.
 *
 * **The skirt is a LINEAR ramp and not a smoothstep, and that is the one line
 * in this file that was changed for a measurement rather than for a look.** A
 * smoothstep going 1 to 0 over a skirt has a peak slope of 1.5 times its
 * average — that is what makes it smooth — so a terrace levelled on a hillside
 * adds `1.5 * fill / skirt` to whatever the hillside was already doing. On the
 * works, sitting on a 0.22 flank with fourteen metres of fill under its
 * downhill edge, that put a ring of 0.43 gradient right round the approach at
 * a skirt of a hundred and fifty metres, and widening the skirt is the wrong
 * lever: it is a metre of extra apron for every centimetre. A linear ramp adds
 * exactly `fill / skirt`, which is 0.09 for the same numbers.
 *
 * What it costs is a crease where the core meets the skirt and another where
 * the skirt meets the ground. On a 6 m grid under a cel shader they read as
 * what they are — the edge of a levelled terrace and the toe of its apron —
 * and a hundred and fifty metres of walkable approach is worth both of them.
 */
function heightAt(x, z) {
  let h = baseAt(x, z);
  const wet = smooth(bayIn(x, z) / WET_FADE);
  for (const dist of DISTRICTS) {
    const dd = rectDist(x, z, dist);
    if (dd >= dist.skirt) continue;
    h = mix(h, dist.h, (1 - dd / dist.skirt) * (1 - wet));
  }
  const e = (Math.max(Math.abs(x), Math.abs(z)) - (HALF - EDGE_BAND)) / EDGE_BAND;
  if (e > 0) h = Math.min(h, mix(h, EDGE_SEA, smooth(Math.min(e, 1))));
  return h;
}

/** How steep the ground is at a point, as the larger of the two axial slopes. */
function grade(x, z) {
  const e = 3;
  return Math.max(
    Math.abs(heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e),
    Math.abs(heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e),
  );
}

// --- the shorelines ----------------------------------------------------------

/**
 * Where the water's edge actually is, found by MARCHING the finished floor.
 *
 * **Not the nominal edge `bayIn` draws, and the difference is thirty metres of
 * foreshore — more where the beach is long.** The cut is two ramps meeting at
 * that edge, so the shore is wherever the outer one crosses zero: well inside
 * the nominal bank, moving with every district skirt that reaches the same
 * ground, and moving again with `FORE_PER_M`, which makes the beach under the
 * mountain two and a half times the one under the town. A jetty authored on
 * the nominal bank stands on dry land pointing at water thirty metres away,
 * and there is nothing in a screenshot that says so. **Every waterfront on
 * this map is placed off these two functions and none of it is authored.**
 *
 * **It MARCHES rather than bisecting, and the rock is why.** A bisector needs
 * one wet end and one dry end and assumes a single crossing between them;
 * a bearing out of the middle of this bay crosses water, then the island in
 * it, then water again, then the shore. So the march walks out in four-metre
 * steps and only settles on the FIRST crossing that is not the rock —
 * `inRock` is the whole of that exemption, and it is safe because the rock
 * stands in open water on every bearing, so the water beyond it is always
 * found before the real shore is.
 *
 * `null` on a bearing that runs out of the mouth into the open sea, which is
 * how a caller asks whether there is a shore that way at all.
 */
const inRock = (x, z) => Math.hypot(x - ROCK.x, z - ROCK.z) <= ROCK.top + ROCK.run;

function bayShore(a) {
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  const at = (r) => heightAt(BAY.x + ux * r, BAY.z + uz * r);
  const rMax = BAY.r + FORE_MAX + 90;
  let wet = 20;
  for (let r = 24; r <= rMax; r += 4) {
    const x = BAY.x + ux * r;
    const z = BAY.z + uz * r;
    if (heightAt(x, z) <= SEA || inRock(x, z)) {
      wet = r;
      continue;
    }
    let dry2 = r;
    for (let i = 0; i < 32; i++) {
      const m = (wet + dry2) / 2;
      if (at(m) <= SEA) wet = m;
      else dry2 = m;
    }
    const rr = Number(wet.toFixed(2));
    return { r: rr, x: BAY.x + ux * rr, z: BAY.z + uz * rr, a };
  }
  return null;
}

/** The rock's own shoreline on a bearing off its crown — the march run out. */
function rockShore(a) {
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  const at = (r) => heightAt(ROCK.x + ux * r, ROCK.z + uz * r);
  const rMax = ROCK.top + ROCK.run + 80;
  let dry2 = 0;
  for (let r = 4; r <= rMax; r += 4) {
    if (at(r) > SEA) {
      dry2 = r;
      continue;
    }
    let wet = r;
    for (let i = 0; i < 32; i++) {
      const m = (wet + dry2) / 2;
      if (at(m) <= SEA) wet = m;
      else dry2 = m;
    }
    const rr = Number(wet.toFixed(2));
    return { r: rr, x: ROCK.x + ux * rr, z: ROCK.z + uz * rr, a };
  }
  return null;
}

/**
 * A run of points a fixed distance INLAND of the bay's shore, between two
 * bearings.
 *
 * **The Strand, the net-shed row, every quay wall and both shore roads are
 * laid off this and none of them states a coordinate.** A waterfront authored
 * against a shoreline goes wrong the moment the shoreline moves, and on this
 * map the shoreline moves whenever anything at all changes: the bay's radius,
 * the foreshore's slope, a district's level, even a district's ANCHOR. What is
 * authored here is a bearing and a setback, which are the two things that are
 * actually decisions.
 *
 * `null` bearings are dropped rather than ending the run, so a span that
 * crosses the mouth comes back as the pieces of coast either side of it.
 */
function shoreRun(a0, a1, n, inset) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const s = bayShore(a);
    if (!s) continue;
    pts.push([
      Number((BAY.x + Math.cos(a) * (s.r + inset)).toFixed(2)),
      Number((BAY.z + Math.sin(a) * (s.r + inset)).toFixed(2)),
    ]);
  }
  return pts;
}

/**
 * Where the bay is exactly `depth` deep, coming in off the shore on a bearing.
 *
 * **A jetty is placed by DEPTH and not by distance from the bank**, and that
 * is the whole of what makes one work. `buildJetty` stands its deck 0.57 m
 * over the ground at the placement's own centre and `CONFIG.nav.stepHeight` is
 * 0.6, so a jetty centred in 28 cm of water has a deck 29 cm over the
 * waterline and the bank beside it links to it; centre the same jetty five
 * metres off the bank and the answer depends on how steep the foreshore
 * happens to be there, which round a bay is a different answer on every
 * bearing. `null` where the water never gets that deep within reach.
 */
function bayAtDepth(a, depth) {
  const shore = bayShore(a);
  if (!shore) return null;
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  const at = (r) => heightAt(BAY.x + ux * r, BAY.z + uz * r);
  const rEnd = Math.max(20, shore.r - 160);
  let shallow = shore.r;
  for (let r = shore.r - 4; r >= rEnd; r -= 4) {
    if (at(r) > -depth) {
      shallow = r;
      continue;
    }
    let deep = r;
    for (let i = 0; i < 32; i++) {
      const m = (shallow + deep) / 2;
      if (at(m) > -depth) shallow = m;
      else deep = m;
    }
    const rr = Number(deep.toFixed(2));
    return { r: rr, x: BAY.x + ux * rr, z: BAY.z + uz * rr, a };
  }
  return null;
}

/**
 * `--probe`: print the floor as text and stop, before a single building is
 * placed.
 *
 * **On a map whose thesis is that THE FLOOR IS THE LEVEL there has to be a way
 * to look at the floor, and until this there was not one.** The generator's own
 * checks throw on the way past, the layout it writes says nothing about the
 * ground under it, and the only other way to see a coastline was to bake the
 * collision, boot the game and fly. A shoreline is a shape you iterate on, and
 * iterating on it through a browser is most of how the reach came to be a
 * canal.
 *
 * Two views over the same field — the plan, and a section along the bay's axis
 * — plus the spans between the things a round is made of. It writes nothing.
 */
function probe() {
  const cols = 96;
  const step = PLAY / cols;
  const marks = [
    ...FLAGS.map((f) => [f.x, f.z, f.id]),
    ...HOMES.map((h) => [h.x, h.z, String(h.team)]),
    [V.x, V.z, "^"],
  ];
  const out = [];
  for (let j = 0; j <= cols; j++) {
    const z = -HALF + j * step;
    let line = "";
    for (let i = 0; i <= cols; i++) {
      const x = -HALF + i * step;
      const m = marks.find((k) => Math.abs(k[0] - x) < step && Math.abs(k[1] - z) < step);
      if (m) {
        line += m[2];
        continue;
      }
      const h = heightAt(x, z);
      line +=
        h <= -1.6
          ? "#"
          : h <= -0.6
            ? "~"
            : h <= 0
              ? "-"
              : h < 3
                ? "."
                : h < 12
                  ? ":"
                  : h < 40
                    ? "o"
                    : h < 80
                      ? "O"
                      : "@";
    }
    out.push(line);
  }
  console.log(out.join("\n"));
  console.log("\n  # >1.6m water   ~ >0.6m   - shallow   . <3m   : <12m   o <40m   O <80m   @ high\n");
  const sec = [];
  for (let x = -HALF; x <= HALF; x += 36) sec.push(`${x}:${heightAt(x, BAY.z).toFixed(1)}`);
  console.log("  section z=" + BAY.z + ":  " + sec.join(" "));
  const pts = [...FLAGS, ...HOMES.map((h) => ({ id: `home${h.team}`, x: h.x, z: h.z }))];
  const pairs = [];
  for (let i = 0; i < pts.length; i++) {
    for (let k = i + 1; k < pts.length; k++) {
      pairs.push(
        `${pts[i].id}-${pts[k].id} ${Math.hypot(pts[i].x - pts[k].x, pts[i].z - pts[k].z).toFixed(0)}`,
      );
    }
  }
  console.log("  spans:  " + pairs.join("  "));
  console.log(
    `\n  ground ${lo.toFixed(2)}..${hi.toFixed(2)} m  |  dry ${landKm2.toFixed(2)} km2, ` +
      `sea ${seaKm2.toFixed(2)} km2 of which the bay is ${bayKm2.toFixed(2)}\n` +
      `  steepest LAND step ${worstStep.toFixed(2)} m over ${CELL} m at ${worstAt}\n` +
      `  exempt steep edges: ${EXEMPT.cone} cone, ${EXEMPT.cliff} sea cliff\n` +
      `  ROGUE steep land edges: ${rogue.length}${rogue.length ? " — " + rogue.slice(0, 8).join(", ") : ""}\n` +
      `  unreachable: ${unreachable.length ? unreachable.join(", ") : "none"}` +
      `  |  summit walkable: ${seen[cellOf(V.x, V.z)] ? "YES (bug)" : "no"}\n` +
      `  water: ${overlaps.length} overlaps, ${wetOutside.length} wet vertices in no rect\n` +
      probeSites
        .map((s) => `  probe "${s.n}" at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}) floor ${heightAt(s.x, s.z).toFixed(2)}`)
        .join("\n"),
  );
  for (const d of DISTRICTS) console.log(`  district ${d.n}: level ${d.h} m`);
  const ring = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const s = bayShore(a);
    ring.push(
      s
        ? `${((a * 180) / Math.PI).toFixed(0)}deg (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`
        : `${((a * 180) / Math.PI).toFixed(0)}deg open`,
    );
  }
  console.log("  bay shore:  " + ring.join("  "));
  const rr = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = rockShore(a);
    rr.push(s ? `(${s.x.toFixed(0)}, ${s.z.toFixed(0)})` : "none");
  }
  console.log("  rock shore: " + rr.join("  "));
  process.exit(0);
}

// --- what is already there ---------------------------------------------------

/**
 * Everything that has claimed ground, as ORIENTED rectangles.
 *
 * A placement is refused rather than nudged. Nudging is what turns a street
 * grid into a heap — the candidate that did not fit is one building in a town
 * of several hundred, and the alley it would have been shoved into is the
 * thing that makes the quarter readable.
 *
 * **They are oriented rather than axis-aligned, and the STREETS are why.**
 * Sarab's claim list is axis-aligned because a desert town is laid on the
 * compass; this island's streets follow its coast, and a rectangle's bounding
 * box is a bad approximation of it the moment it is both long and turned. A
 * 200 m street 7 m wide, laid at 0.16 radians off the axis — less than ten
 * degrees — has a bounding box **thirty-nine metres wide**, so every
 * house that ought to stand on the kerb is refused, and a quarter laid along a
 * shoreline comes out as two rows of buildings thirty metres back from a road
 * with nothing on it. The test is a separating-axis test over the two
 * rectangles' four edge normals, with a circle test in front of it so the
 * common case is still one comparison per claim.
 */
const claimed = [];
/** Every candidate the claim list turned down, for the console line at the end. */
const refused = [];

/** One oriented rectangle: centre, half extents, and its own axes. */
function box(x, z, w, d, rot, pad) {
  const hw = w / 2 + pad;
  const hd = d / 2 + pad;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x, z, hw, hd, c, s, r: Math.hypot(hw, hd) };
}

/** Does `a` overlap `b`? Separating axes are the four edge normals. */
function hits(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (dx * dx + dz * dz > (a.r + b.r) * (a.r + b.r)) return false;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ]) {
    // p's own axes: local +X is (cos, -sin) in world and +Z is (sin, cos).
    for (const [ux, uz, half] of [
      [p.c, -p.s, p.hw],
      [p.s, p.c, p.hd],
    ]) {
      const centre = Math.abs(dx * ux + dz * uz);
      const reach =
        half +
        Math.abs((q.c * ux - q.s * uz) * q.hw) +
        Math.abs((q.s * ux + q.c * uz) * q.hd);
      if (centre > reach) return false;
    }
  }
  return true;
}

function free(x, z, w, d, rot = 0, pad = 1.6) {
  const b = box(x, z, w, d, rot, pad);
  // The play square, tested against the rectangle's own extent rather than its
  // circumradius: a 200 m street is nearly all length, and the difference is a
  // hundred metres of waterfront the coast road may not be laid on.
  const ac = Math.abs(b.c);
  const as = Math.abs(b.s);
  if (Math.abs(x) + ac * b.hw + as * b.hd > HALF - 20) return false;
  if (Math.abs(z) + as * b.hw + ac * b.hd > HALF - 20) return false;
  for (const c of claimed) if (hits(c, b)) return false;
  return true;
}

function claim(x, z, w, d, rot = 0, pad = 0, soft = false) {
  // `soft` is a claim by something a body can STAND ON — a carriageway, a
  // square. It refuses a building exactly as any other claim does, and the one
  // question it answers differently is `openGround`'s.
  claimed.push({ ...box(x, z, w, d, rot, pad), soft });
}

/**
 * Is this a place a body may be PUT — clear of every building, and a road or a
 * square is fine?
 *
 * The flag spawns are the only thing that asks, and they ask because they are
 * computed last: unlike everything else with a claim, they are laid over a
 * town that is already built, so a bearing that used to point at open shelf
 * now points at somebody's frontage. A spawn in the middle of the Strand is
 * correct and a spawn inside a house is a body that cannot move.
 *
 * **What is asked for is a BODY's worth of ground and not the spawn's own
 * claim**, which is 8 m square: on a five-metre lane with a row of doors down
 * each side there is no eight-metre square anywhere, and demanding one turns
 * every spawn in the old town away from the street it belongs on.
 */
function openGround(x, z, w, d) {
  const b = box(x, z, w, d, 0, 0.5);
  for (const c of claimed) if (!c.soft && hits(c, b)) return false;
  return true;
}

/**
 * Is this dry ground a body could stand on?
 *
 * **Every placement on this map goes through it, and on no other map in the
 * tree would it need to.** Two thirds of this square is land and the rest is
 * sea; a quarter's recipe walks a rectangle without knowing where the
 * coastline runs through it, so a cottage on the wrong side of the strand is a
 * cottage standing in the water with nothing to say so. `lift` is what a pier
 * or a boathouse is allowed to be built out over — a boathouse straddles its
 * own slipway by design — and everything else asks for real ground.
 */
function dry(x, z, lift = 0.55) {
  return heightAt(x, z) >= SEA + lift;
}

// --- the placement list ------------------------------------------------------

const placements = [];
const scatter = [];

/** Shortest exact decimal for a number a layout states. */
const n2 = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));

/**
 * The `rotY:` clause a placement is written with.
 *
 * Quarter turns are spelled as the `Math.PI` expressions every hand-authored
 * layout in the tree uses, because most of a town IS square and a file full of
 * `1.5708` would be unreadable. Anything else is a decimal: an island's roads
 * and its waterfronts follow a coast rather than a grid, and this is the first
 * map here whose streets are not all axis-aligned.
 */
function rotToken(rot) {
  const q = Math.round(rot / (Math.PI / 2));
  if (Math.abs(rot - q * (Math.PI / 2)) < 1e-6) {
    const k = ((q % 4) + 4) % 4;
    return ["", ", rotY: Math.PI / 2", ", rotY: Math.PI", ", rotY: -Math.PI / 2"][k];
  }
  return `, rotY: ${n2(rot)}`;
}

/**
 * Emit one placement, claiming its footprint first.
 *
 * `w` and `d` are the builder's own local extents and the claim is that
 * rectangle TURNED, which is what stops a 16 m house laid on a 9 m plot from
 * standing in the alley beside it — and, on the streets this map lays along
 * its own coast, what stops a row of houses from being held a bounding box's
 * width off the kerb it is meant to stand on.
 */
function place(kind, x, z, rot, w, d, params, pad = 1.6, lift = 0.55) {
  if (!free(x, z, w, d, rot, pad) || !dry(x, z, lift)) {
    refused.push(`${kind} at (${x.toFixed(0)}, ${z.toFixed(0)})`);
    return false;
  }
  claim(x, z, w, d, rot);
  const ps = params
    ? Object.entries(params)
        .map(([k, v]) => {
          const lit =
            typeof v === "string" ? `"${v}"` : typeof v === "boolean" ? String(v) : n2(v);
          return `${k}: ${lit}`;
        })
        .join(", ")
    : "";
  placements.push(
    `  { kind: "${kind}", x: ${n2(x)}, z: ${n2(z)}${rotToken(rot)}` +
      (ps ? `, params: { ${ps} }` : "") +
      " },",
  );
  return true;
}

/**
 * A named SET PIECE: place it, and refuse to write the map if it did not fit.
 *
 * `REQUIRED` at the bottom of this file catches a missing set piece by KIND,
 * which works for a chapel and does not work for a kind the fabric also makes:
 * a watchtower authored onto a headland and silently dropped for overlapping a
 * road would leave the count right, because the crofts made one somewhere
 * else. So anything placed at a coordinate somebody chose goes through here.
 */
function must(kind, x, z, rot, w, d, params, pad, lift) {
  if (place(kind, x, z, rot, w, d, params, pad, lift)) return;
  // **What refused it, and not merely that something did.** The message alone
  // is "move it and try again", which on a map whose streets are laid before
  // its buildings is a dozen runs of guessing which of two hundred claims is
  // in the way — and the answer is nearly always a carriageway a metre wider
  // than the piece expected. Naming the rectangle turns that into one run.
  const b = box(x, z, w, d, rot, pad ?? 1.6);
  const blockers = claimed
    .filter((c) => hits(c, b))
    .map((c) => `(${c.x.toFixed(0)}, ${c.z.toFixed(0)}) ${(c.hw * 2).toFixed(1)}x${(c.hd * 2).toFixed(1)}`);
  throw new Error(
    `set piece: ${kind} at (${x.toFixed(0)}, ${z.toFixed(0)}) was refused — ` +
      `the ground there is ${heightAt(x, z).toFixed(2)} m and it is claimed by ` +
      `${blockers.length || "nothing, so it is the sea or the map edge"}` +
      (blockers.length ? `: ${blockers.join(", ")}` : "") +
      ". Move the piece; the claim list is in authored order and the streets, " +
      "the roads, the flags, the spawns and the hardstandings claim first.",
  );
}

/** A section heading inside one of the emitted arrays. */
function section(list, title) {
  const bar = "=".repeat(Math.max(4, 74 - title.length));
  list.push(`  // ===== ${title} ${bar}`);
}

// --- the fabric: streets, blocks, and the houses that front them -------------

const QUARTERS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

/**
 * A rotation's own axes in world coordinates: `u` is its local +X and `v` its
 * local +Z, which is the axis every builder in the kit is drawn down.
 *
 * The convention is `rotToken`'s and `roadRun`'s rather than a second one:
 * local +Z maps to `(sin rot, cos rot)`, which is why a road laid from a to b
 * takes `atan2(dx, dz)`.
 */
function local(rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { ux: c, uz: -s, vx: s, vz: c };
}

/**
 * The `rotY` a building needs in order to FRONT the direction `(fx, fz)`.
 *
 * **Everything in the kit that has a front is drawn facing its own local -Z** —
 * the cottage's and the townhouse's door, the tavern's porch and its hanging
 * sign, the smithy's open forge front, the boathouse's slipway, the barn's cart
 * door, the chapel's west end. The two exceptions are the shophouse, whose
 * close door is on +Z (`buildShophouse`), and the depot, whose whole loading
 * elevation is (`buildDepot`) — written down here rather than at each call,
 * because a warehouse with its bays to the wall is the same silent mistake as
 * a house with its door to one.
 *
 * This is most of what makes a street a street rather than a corridor of
 * buildings: a row of houses with their backs to the road is a run of blank
 * plaster, and nothing in a plan view of it says so.
 */
const BACK_TO_FRONT = new Set(["shophouse", "depot"]);
function faceRot(kind, fx, fz) {
  return BACK_TO_FRONT.has(kind) ? Math.atan2(fx, fz) : Math.atan2(-fx, -fz);
}

/** One fisher's or townsman's house, sized and turned for the plot. */
function cottageAt(x, z, rot, o = {}) {
  const w = o.w ?? randInt(6, 9);
  const d = o.d ?? randInt(5, 8);
  const p = { width: w, depth: d, height: o.h ?? rnd(3.1, 3.9) };
  if (o.enterable) p.enterable = true;
  if (o.lit ?? chance(0.42)) p.litWindows = true;
  if (o.ruined) p.ruined = true;
  return place("cottage", x, z, rot, w + 0.8, d + 0.8, p, o.pad ?? 0.35);
}

/** A street silhouette rather than a village one — see `buildTownhouse`. */
function townhouseAt(x, z, rot, o = {}) {
  const w = o.w ?? randInt(6, 8);
  const d = o.d ?? randInt(6, 8);
  const p = { width: w, depth: d, height: o.h ?? rnd(6.2, 7.6) };
  if (o.enterable) p.enterable = true;
  if (o.lit ?? chance(0.5)) p.litWindows = true;
  return place("townhouse", x, z, rot, w + 0.9, d + 0.9, p, o.pad ?? 0.35);
}


/** A run of dry-stone wall along its own local X. */
function wallRun(x, z, rot, len, o = {}) {
  const h = o.h ?? rnd(1.3, 1.8);
  return place("stoneWall", x, z, rot, len, 1.5, { length: len, height: h }, o.pad ?? 1.0);
}

/**
 * A walled yard with one side left open, laid round a plot.
 *
 * **The gap is not decoration.** `NavGrid.severLinks` honours a thin wall, so
 * a sealed yard is a plot the flood fill never enters and a bot routed the
 * whole way round — which on a map with two hundred of them is a town that
 * reads as solid.
 */
function yardWall(cx, cz, hw, hd, rot, open) {
  const sides = [
    { dx: 0, dz: -hd, len: hw * 2, a: 0 },
    { dx: hw, dz: 0, len: hd * 2, a: Math.PI / 2 },
    { dx: 0, dz: hd, len: hw * 2, a: 0 },
    { dx: -hw, dz: 0, len: hd * 2, a: Math.PI / 2 },
  ];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i < 4; i++) {
    if (i === open) continue;
    const sd = sides[i];
    const x = cx + sd.dx * c - sd.dz * s;
    const z = cz + sd.dx * s + sd.dz * c;
    wallRun(x, z, rot + sd.a, sd.len, { pad: 0.6 });
  }
}

// --- the streets -------------------------------------------------------------

/**
 * A QUARTER: a rotated rectangle cut into BLOCKS by its own streets.
 *
 * **This is what the map was missing, and it is a mechanism rather than a few
 * more hand-authored roads because the two halves have to be generated
 * together.** What stood here was a `quarter()` that walked a lattice and
 * dropped a house somewhere inside each cell — which produces the right NUMBER
 * of buildings on the right ground and no town at all: nothing lines up,
 * nothing fronts anything, no line through it takes you anywhere, and the gap
 * between two plots is the same width as the gap inside one. A town is not a
 * density of houses. It is a network you move along with the houses arranged
 * against it — and the streets have to claim their ground before anything is
 * built, while the houses have to know where the street is in order to turn
 * their doors toward it.
 *
 * So a quarter is laid in one call, in this order:
 *
 * 1. the STREETS, emitted as ordinary `road` placements and claimed, so every
 *    later candidate — the set pieces, the yards, the crofts, the scatter —
 *    dodges them for free;
 * 2. the BLOCKS between them, handed back as rotated rectangles;
 * 3. and then, per block, a row of houses round its edge (`fillBlock`), each
 *    turned to face the street it stands on, with the yards behind them.
 *
 * `edges` says which of the four sides of the quarter LAYS a street of its own
 * and `fronts` which of them HAS one: a quarter set against the Strand or a
 * shore road already has a carriageway on that side, and a second one two
 * metres from the first is a coplanar sheet fighting it for every pixel they
 * share — but the houses along it still face the road that is there.
 *
 * The quarter is dimensioned from its BLOCKS out (`cols` x `rows` plots of
 * `plot`) rather than by fitting blocks into an extent, because what has to
 * land on an exact spot is the middle of it: an odd `cols` and `rows` put the
 * centre block on the quarter's own centre, which is how a flag comes to stand
 * in a square with the town's streets running out of its four corners.
 */
function quarterStreets(o) {
  const { x, z, cols, rows } = o;
  const rot = o.rot ?? 0;
  const width = o.width ?? 6.5;
  // A quarter may be ringed by something wider than its own lanes: the old
  // town's alleys are 2.8 m and what runs round the outside of it is 7, which
  // is the whole of how a hull is kept out of a quarter without a single rule
  // that knows a vehicle exists.
  const edgeWidth = o.edgeWidth ?? width;
  const surface = o.surface ?? "dirt";
  const [bu, bv] = o.plot ?? [42, 30];
  const edges = o.edges ?? [true, true, true, true];
  const fronts = o.fronts ?? edges;
  const L = local(rot);
  const at = (u, v) => [x + u * L.ux + v * L.vx, z + u * L.uz + v * L.vz];

  const nu = cols;
  const nv = rows;
  const hw = (nu * bu + (nu - 1) * width) / 2;
  const hd = (nv * bv + (nv - 1) * width) / 2;
  const spanU = hw * 2;
  const spanV = hd * 2;

  // The cross streets, running along local Z, and the long ones along local X.
  // An outer line is laid half a carriageway OUTSIDE the quarter, so the blocks
  // inside it keep the size they were dimensioned at.
  // An outer line is laid so that its INNER edge is the quarter's boundary,
  // whatever it is carrying: a ring road that ate into the outer blocks would
  // take the frontage they were dimensioned for.
  const lineU = [];
  for (let i = 0; i <= nu; i++) {
    if (i === 0 && !edges[3]) continue;
    if (i === nu && !edges[1]) continue;
    const outer = i === 0 ? -1 : i === nu ? 1 : 0;
    const w = outer ? edgeWidth : width;
    lineU.push([-hw - width / 2 + i * (bu + width) + outer * (w - width) / 2, w]);
  }
  const lineV = [];
  for (let j = 0; j <= nv; j++) {
    if (j === 0 && !edges[0]) continue;
    if (j === nv && !edges[2]) continue;
    const outer = j === 0 ? -1 : j === nv ? 1 : 0;
    const w = outer ? edgeWidth : width;
    lineV.push([-hd - width / 2 + j * (bv + width) + outer * (w - width) / 2, w]);
  }
  // Long enough to meet the perimeter streets at both ends, so a junction is a
  // crossing rather than two carriageways stopping short of each other.
  const runU = spanV + edgeWidth * 2;
  const runV = spanU + edgeWidth * 2;
  for (const [u, w] of lineU) {
    const [sx, sz] = at(u, 0);
    roadSlab(sx, sz, rot, runU, w, surface, 0.1);
  }
  for (const [v, w] of lineV) {
    const [sx, sz] = at(0, v);
    roadSlab(sx, sz, rot + Math.PI / 2, runV, w, surface, 0.1);
  }

  const blocks = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const u = -hw + bu / 2 + i * (bu + width);
      const v = -hd + bv / 2 + j * (bv + width);
      const [bx, bz] = at(u, v);
      blocks.push({
        x: bx,
        z: bz,
        hw: bu / 2,
        hd: bv / 2,
        rot,
        i,
        j,
        // Which of its own sides face a carriageway. A block on the edge of the
        // quarter with no street outside it has a BACK, and that is where the
        // yards, the walls and the woodpiles go.
        sides: [
          j > 0 || fronts[0],
          i < nu - 1 || fronts[1],
          j < nv - 1 || fronts[2],
          i > 0 || fronts[3],
        ],
      });
    }
  }
  return {
    blocks,
    cols: nu,
    rows: nv,
    width,
    hw,
    hd,
    at,
    /** One block by its column and row, from the -U/-V corner. */
    block: (i, j) => blocks[j * nu + i],
    /** The middle block — the square, on a quarter with odd counts. */
    middle: () => blocks[((nv - 1) / 2 | 0) * nu + ((nu - 1) / 2 | 0)],
  };
}

/**
 * One side of a block, as the frontage a row is laid along: the outward normal
 * (which is the way the doors face), the tangent the row runs down, and how
 * much room there is behind it.
 */
function blockSide(b, k) {
  const L = local(b.rot);
  return [
    { nx: -L.vx, nz: -L.vz, tx: L.ux, tz: L.uz, half: b.hw, deep: b.hd },
    { nx: L.ux, nz: L.uz, tx: L.vx, tz: L.vz, half: b.hd, deep: b.hw },
    { nx: L.vx, nz: L.vz, tx: -L.ux, tz: -L.uz, half: b.hw, deep: b.hd },
    { nx: -L.ux, nz: -L.uz, tx: -L.vx, tz: -L.vz, half: b.hd, deep: b.hw },
  ][k];
}

/**
 * Fill one block: a row of houses along every side that faces a street, and
 * whatever the recipe wants in the yard they leave in the middle.
 *
 * `o.house(x, z, rot, w, nx, nz)` is the recipe — it is handed a plot on the
 * kerb, the bearing that faces the street, how much frontage it has to spend
 * and which way the street lies — and says whether it took it. A refusal is
 * ordinary: the corner of a block belongs to whichever row reached it first,
 * and a gap where a house did not fit is a yard gate.
 *
 * **The rows on the short sides are INSET by a house's depth**, because the two
 * long rows already own the corners. Without it every block turns candidates
 * away in the same four places, which is a town whose every corner plot is
 * empty.
 */
function fillBlock(b, o) {
  const gap = o.gap ?? 1.8;
  const inset = o.inset ?? 9;
  // How far the WALL stands back from the kerb. It has to clear the street's
  // own claim (0.1) plus the house's (`place`'s pad, 0.35 for a frontage), or
  // every candidate in the town is refused by the road it is meant to front —
  // and the CLEAR width of a street is this twice over plus the carriageway,
  // which is the number the old town's alleys are cut to.
  const setback = o.setback ?? FRONT_SETBACK;
  let built = 0;
  for (let k = 0; k < 4; k++) {
    if (!b.sides[k]) continue;
    const s = blockSide(b, k);
    const end = s.half - (k % 2 === 1 ? inset : 0);
    let t = -end;
    while (t < end - 4) {
      // Both extents are drawn HERE rather than in the recipe, because the
      // plot is what decides where the house stands: the wall goes on the
      // frontage line and the building is set back from it by its own half
      // depth, which is a number the recipe would otherwise have to hand back
      // before it could be asked where to build.
      const [w, d] = o.size ? o.size() : [randInt(6, 9), randInt(6, 8)];
      if (t + w > end) break;
      const mid = t + w / 2;
      const back = s.deep - setback - d / 2;
      const x = b.x + s.nx * back + s.tx * mid;
      const z = b.z + s.nz * back + s.tz * mid;
      if (o.house(x, z, faceRot("cottage", s.nx, s.nz), w, d)) built++;
      t += w + rand(gap * 0.6, gap * 1.4);
    }
  }
  if (o.yard) o.yard(b, built);
  return built;
}

/**
 * The yard behind a row: a wall, a woodpile, a shed — what a house has out the
 * back, laid on the BLOCK's own axes rather than on the compass, which is what
 * keeps a back garden reading as part of its own plot on a street running at
 * fifteen degrees to the grid.
 */
function backYard(b, o = {}) {
  const L = local(b.rot);
  const n = o.count ?? randInt(1, 3);
  for (let i = 0; i < n; i++) {
    const u = rand(-b.hw, b.hw) * 0.66;
    const v = rand(-b.hd, b.hd) * 0.66;
    const x = b.x + u * L.ux + v * L.vx;
    const z = b.z + u * L.uz + v * L.vz;
    const rot = b.rot + pick(QUARTERS);
    const roll = rng();
    if (roll < 0.26) place("shed", x, z, rot, 4.4, 3.8, undefined, 1.0);
    else if (roll < 0.52) place("woodpile", x, z, rot, 6, 2.2, { length: 5 }, 0.9);
    else if (roll < 0.66) place("crates", x, z, rot, 4, 3.4, undefined, 0.9);
    else if (roll < 0.76) place("trough", x, z, rot, 4, 4.2, undefined, 0.9);
    else if (roll < 0.9) wallRun(x, z, rot, randInt(8, 14), { pad: 0.6 });
    else place("haystack", x, z, rot, 4.2, 4.2, undefined, 0.9);
  }
}

/**
 * A PLAZA: the open square a quarter is built around.
 *
 * It is drawn with the builder a street is drawn with, because a road here is
 * a slab of paving and nothing else — no collider, nothing in any baked
 * structure — and an open paved place with four rows of doors round it is what
 * turns a flag from the gap between two houses into somewhere.
 *
 * **It is paved WIDER than its own block and it claims nothing**, which is the
 * pair of decisions that make it work. The paving grows by the width of the
 * streets that bound it, so the square swallows its own four carriageways and
 * stops exactly at the far kerbs — one place rather than a patch with four
 * roads through it. And what keeps the middle of it clear is the FLAG's own
 * 30 m claim, which is already there and already means "a body can stand
 * here": a claim of its own would only forbid the stalls and the lamps that
 * make a market square a market.
 */
function plaza(x, z, w, d, rot, surface = "cobble") {
  roadSlab(x, z, rot, d, w, surface, null);
  return { x, z, hw: w / 2, hd: d / 2, rot };
}

/**
 * Furnish a square: lamps at its four corners and market stalls down its two
 * long sides, all of it laid on the paving OUTSIDE the flag's own clear ring.
 *
 * The arithmetic is the only interesting part and it is why this is a function
 * rather than eight authored coordinates per square: everything here has to
 * miss a claim it did not choose — the flag's 24 m ring in the middle, the
 * streets that bound the paving, and on the quay an arterial road down one
 * side of it — so a stall goes in the strip between the ring and the kerb,
 * which is four metres wide and is the only place on a square anything can
 * stand. A refusal is silent and expected: a square with three stalls on it
 * because the fourth met a road is a market, and a square with a stall standing
 * in the carriageway is not.
 */
function furnish(x, z, hw, hd, rot, o = {}) {
  const L = local(rot);
  const at = (u, v) => [x + u * L.ux + v * L.vx, z + u * L.uz + v * L.vz];
  // Everything stands on the LONG axis, out at the block's own edge. The strip
  // across the short axis is `SQUARE_CLEAR` on one side and the lane on the
  // other, and on the smallest square here that strip is three metres wide —
  // so a corner is the only place a lamp fits on all four of them.
  const u = hw - 3.5;
  // The well and the shrine go down FIRST and the stalls fill in round them: a
  // market moves its barrows for the pump rather than the other way about, and
  // the claim list has no other way to say which of two things wanted the
  // corner more.
  if (o.well) place("well", ...at(o.well[0] * (hw - 4), o.well[1] * (hd - 4)), 0, 5, 5, undefined, 0.8);
  if (o.shrine) {
    place("shrine", ...at(o.shrine[0] * (hw - 3), o.shrine[1] * (hd - 3)), rot + Math.PI, 3, 3, undefined, 0.8);
  }
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      place("lamp", ...at(su * u, sv * (hd - 3.5)), 0, 2.2, 2.2, undefined, 0.8);
    }
  }
  const stalls = o.stalls ?? 3;
  for (const su of [-1, 1]) {
    for (let i = 0; i < stalls; i++) {
      const v = (i - (stalls - 1) / 2) * 8;
      place("stall", ...at(su * u, v), rot + su * (Math.PI / 2), 5, 3.6, undefined, 0.6);
    }
  }
}

/**
 * How much ground a flag claims for itself, and why it is smaller than it was.
 *
 * 30 m was the number when a flag stood in whatever gap the fabric left it.
 * Now four of the five stand in the middle of a paved square, and the claim is
 * the only thing keeping that square open — so what it has to be is big enough
 * that the capture point is clear ground with room to fight over, and small
 * enough that the stalls, the lamps and the well that make a market a market
 * still fit on the paving round it. Nine metres of clear ground in every
 * direction from the point, inside a capture radius of seventeen — and the
 * strip between that ring and the kerb is where `furnish` puts them.
 */
const SQUARE_CLEAR = 18;

/**
 * A spot on the far side of the street from block `b`'s side `k`, turned to
 * face back across it.
 *
 * This is how a set piece is put ON a square rather than near one: the tavern
 * on the market's east side, the chapel at the head of its green, the customs
 * row along the Strand. `along` runs down the street from the middle of that
 * side, `street` is the carriageway being crossed, and `deep` is the piece's
 * own HALF DEPTH — the frontage setback `fillBlock` uses is added here, so a
 * set piece stands in the same line as the houses either side of it rather
 * than a metre proud of them.
 */
const FRONT_SETBACK = 1.2;
function facing(b, k, street, along, deep, kind = "cottage") {
  const s = blockSide(b, k);
  const out = s.deep + street + FRONT_SETBACK + deep;
  return {
    x: b.x + s.nx * out + s.tx * along,
    z: b.z + s.nz * out + s.tz * along,
    rot: faceRot(kind, -s.nx, -s.nz),
  };
}

/**
 * A spot in block `b`'s OWN frontage on side `k`, turned to face the street it
 * stands on — `facing`'s mirror, and the one to use for a set piece that
 * belongs to the row rather than across from it.
 *
 * `deep` is again the piece's own half depth, so its wall lands on the same
 * line as the houses either side of it: a warehouse standing proud of its own
 * terrace is as wrong as one standing back from it.
 */
function onFront(b, k, along, deep, kind = "cottage") {
  const s = blockSide(b, k);
  const back = s.deep - FRONT_SETBACK - deep;
  return {
    x: b.x + s.nx * back + s.tx * along,
    z: b.z + s.nz * back + s.tz * along,
    rot: faceRot(kind, s.nx, s.nz),
  };
}
/**
 * A croft: a house, its yard and the field walls round it.
 *
 * **The walls are what makes it a farm rather than a house in a field**, and
 * they are the cheapest thing on this map by a distance — a `stoneWall` run is
 * one box, and four of them at the edge of a bare shelf turn a hundred metres
 * of nothing into enclosed ground. They are laid on the croft's own bearing
 * rather than the compass, so a farm beside a road that runs south-west has
 * its walls along the road.
 */
function croft(cx, cz, rot = rand(0, Math.PI * 2)) {
  const L = local(rot);
  const at = (u, v) => [cx + u * L.ux + v * L.vx, cz + u * L.uz + v * L.vz];
  cottageAt(...at(0, 0), rot, {
    w: randInt(6, 9),
    d: randInt(5, 7),
    h: rnd(3.0, 3.6),
    ruined: chance(0.15),
    pad: 1.2,
  });
  if (chance(0.7)) place("shed", ...at(rand(9, 15), rand(-8, 8)), rot, 4.4, 3.8, undefined, 1.0);
  if (chance(0.6)) place("woodpile", ...at(rand(-14, -8), rand(-9, 9)), rot, 6, 2.2, { length: 5 }, 1.0);
  if (chance(0.35)) place("trough", ...at(rand(-12, 12), rand(10, 16)), rot, 4, 4.2, undefined, 1.0);
  if (chance(0.3)) place("haystack", ...at(rand(-16, 16), rand(-18, -12)), rot, 4.2, 4.2, undefined, 1.0);
  // The field walls: two long runs down the sides of the holding and a shorter
  // one across the top, each with the gate left as the gap between them.
  for (const su of [-1, 1]) {
    const len = randInt(20, 34);
    wallRun(...at(su * rand(24, 32), rand(-8, 8)), rot + Math.PI / 2, len, { pad: 0.8 });
  }
  if (chance(0.6)) wallRun(...at(rand(-6, 6), rand(24, 32)), rot, randInt(18, 30), { pad: 0.8 });
}

// =============================================================================
// The map, laid out in the order it is emitted.
// =============================================================================

/** The five objectives, and the island's own names for them. */
const FLAGS = [
  { id: "A", name: "The Quay", x: -96, z: 323, r: 18 },
  { id: "B", name: "Cinder Steps", x: -380, z: 180, r: 18 },
  { id: "C", name: "Chapel Rock", x: ROCK.x, z: ROCK.z, r: 17 },
  { id: "D", name: "The Ashworks", x: -330, z: -110, r: 17 },
  { id: "E", name: "Netstrand", x: 420, z: -165, r: 18 },
];
const [A, B, C, D, E] = FLAGS;

/**
 * The two landings, on the two headlands the coast was given for them.
 *
 * `u` is the unit vector from the yard toward the middle of the island: every
 * offset in the yard is written against it, which is what makes the two yards
 * mirror images rather than two hand-placed arrangements that happen to look
 * alike. It is also what makes them equally LEVEL — both stand on a district
 * flattened to the same 9.4 m.
 */
const HOMES = [
  { team: 0, x: -495, z: 495, color: "#c8873a" },
  { team: 1, x: 475, z: -475, color: "#3f7f9c" },
].map((h) => {
  const len = Math.hypot(h.x, h.z);
  return { ...h, ux: -h.x / len, uz: -h.z / len, yaw: Math.atan2(-h.x, -h.z) };
});


// --- the sea, as rectangles ---------------------------------------------------

/**
 * The sea, as EIGHT rectangles that TILE everything out to the horizon — a
 * pinwheel inside a pinwheel, not a frame round a hole.
 *
 * The inner four are the map's own water and the outer four are the OCEAN,
 * which is what closes this map instead of a rim — see `OCEAN`, and
 * `RidgeSpec.form`'s `none`. Everything below is about the inner four, because
 * the ring has no shore in it and nothing to get wrong.
 *
 * **A `WaterRect` is an extent and the BED decides where the shore is**
 * (`WaterSystem.bakeDepth`), so any partition of the square draws exactly the
 * same coastline and the only thing that varies between partitions is where
 * the REFLECTION PROBES end up: one per rect, at the depth-weighted centroid
 * of that rect's own wet cells. So the partition is chosen for the probes, and
 * two rules decide it.
 *
 * **Every probe has to stand in WATER.** One rect over the whole map puts its
 * centroid in the middle of the island, which is a cube baked from inside a
 * mountain and a sea that mirrors the inside of a hill. That is what the old
 * frame-round-a-hole was for, and it worked.
 *
 * **And a SEAM must not fall where anybody is looking across it.** That is the
 * rule the bay added, and it is what retired the frame: two rects at one height
 * sharing an edge is a seam nothing can see in the geometry, but they carry two
 * different probes, so the mirror CHANGES across the line. Over four hundred
 * metres of open harbour with a lit town on one side of it that is a visible
 * join in the water, and the old layout would have put one straight down the
 * middle of the bay.
 *
 * A pinwheel answers both: the bay, its mouth and the whole eastern sea are ONE
 * rect with one probe standing in the throat of the mouth, so there is no seam
 * anywhere a player can see across the harbour; the three that carry the open
 * sea meet each other only out past the coast, where both sides of every seam
 * are empty water under the same sky. The tiling is exact and
 * `assertWaterTiles` proves it — every wet vertex in exactly one rect, and no
 * two rects overlapping — rather than leaving it to be read off the numbers.
 */
const OUTER = HALF + MARGIN;
/** How far off the map's centre line the bay's own band reaches. */
const BAY_BAND = 380;
/** Where the three open-sea rects hand over to it. */
const BAY_WEST = -380;
const WATER = [
  {
    n: "the bay, its mouth and the sea east of the island",
    x: (BAY_WEST + OUTER) / 2,
    z: 0,
    width: OUTER - BAY_WEST,
    depth: BAY_BAND * 2,
  },
  { n: "the western sea", x: (-OUTER + BAY_WEST) / 2, z: 0, width: BAY_WEST + OUTER, depth: OUTER * 2 },
  {
    n: "the northern sea",
    x: (BAY_WEST + OUTER) / 2,
    z: -(BAY_BAND + OUTER) / 2,
    width: OUTER - BAY_WEST,
    depth: OUTER - BAY_BAND,
  },
  {
    n: "the southern sea",
    x: (BAY_WEST + OUTER) / 2,
    z: (BAY_BAND + OUTER) / 2,
    width: OUTER - BAY_WEST,
    depth: OUTER - BAY_BAND,
  },
  // --- the open ocean, past the ground ---------------------------------------
  // A SECOND pinwheel round the first, out to `OCEAN`. It is four rects rather
  // than one because a ring is not a rectangle and two coplanar planes at one
  // height are a per-pixel tie; it is a ring rather than a wider version of the
  // four above because those four carry the island's own shoreline and a rect's
  // bed map is a fixed 512 texels a side (`CONFIG.water.depthTexelsMax`) —
  // widening the western sea to the horizon would have spent a quarter of the
  // west coast's waterline on empty ocean. Nothing here has a shore in it, so
  // its own bed map is one saturated value and its probe stands in open water
  // with the map's own sky over it, which is what a mirror out here should
  // return. Every seam is at least 250 m outside the play square and both sides
  // of each is the same fogged water.
  {
    n: "the western ocean",
    x: -(OCEAN + OUTER) / 2,
    z: -(OCEAN - OUTER) / 2,
    width: OCEAN - OUTER,
    depth: OCEAN + OUTER,
  },
  {
    n: "the northern ocean",
    x: (OCEAN - OUTER) / 2,
    z: -(OCEAN + OUTER) / 2,
    width: OCEAN + OUTER,
    depth: OCEAN - OUTER,
  },
  {
    n: "the eastern ocean",
    x: (OCEAN + OUTER) / 2,
    z: (OCEAN - OUTER) / 2,
    width: OCEAN - OUTER,
    depth: OCEAN + OUTER,
  },
  {
    n: "the southern ocean",
    x: -(OCEAN - OUTER) / 2,
    z: (OCEAN + OUTER) / 2,
    width: OCEAN + OUTER,
    depth: OCEAN - OUTER,
  },
];

// --- the heightfield, and the survey over it ---------------------------------

/**
 * The floor is BUILT AND PROVED BEFORE ANYTHING IS PLACED ON IT.
 *
 * That order is deliberate and it was the other way round until this map grew a
 * bay. A generator that lays two hundred buildings and then discovers its own
 * ground is unwalkable reports the first SET PIECE that could not find dry
 * ground, which is a sentence about a chapel when the fact is a coastline —
 * and on a map where the floor IS the level, that is the wrong end of every
 * iteration. Everything below is a statement about the ground and nothing
 * below reads a placement, so it belongs here.
 */
const row = CELLS + 1;
const heights = new Float64Array(row * row);
for (let j = 0; j < row; j++) {
  for (let i = 0; i < row; i++) {
    heights[j * row + i] = heightAt(-HALF + i * CELL, -HALF + j * CELL);
  }
}
// Rounded before the checks, because rounded is what ships: a gradient that
// passes at full precision and fails at two decimals is a map that fails.
const q = new Float64Array(row * row);
for (let k = 0; k < q.length; k++) q[k] = Math.round(heights[k] * 100) / 100;

/**
 * The walkability survey.
 *
 * **It is a survey and not the flat assertion Sarab's generator makes, and
 * that difference is this map.** A desert town owes a floor it can walk
 * everywhere; an island owes two things that are steeper than
 * `MAX_WALKABLE_GRADE` ON PURPOSE — the cone above the works, which is what
 * keeps the highest ground on the map out of the round, and the sea cliffs the
 * cone's own coastal mask cuts. So what is checked is that every steep land
 * edge is inside one of those two, and that everything that has to be REACHED
 * still is (the flood fill below).
 */
const EXEMPT = { cone: 0, cliff: 0 };
const rogue = [];
let worstStep = 0;
let worstAt = "";
for (let j = 0; j < row; j++) {
  for (let i = 0; i < row; i++) {
    const x = -HALF + i * CELL;
    const z = -HALF + j * CELL;
    const h = q[j * row + i];
    for (const [di, dj] of [
      [1, 0],
      [0, 1],
    ]) {
      const ii = i + di;
      const jj = j + dj;
      if (ii >= row || jj >= row) continue;
      const h2 = q[jj * row + ii];
      // Only LAND is walked. A shelf under two metres of water is severed or
      // not on its own terms and nothing routes over it either way.
      if (h <= SEA + 0.4 || h2 <= SEA + 0.4) continue;
      const step = Math.abs(h2 - h);
      if (step > worstStep) {
        worstStep = step;
        worstAt = `(${x}, ${z}) along ${di ? "X" : "Z"}`;
      }
      if (step / CELL <= MAX_GRADE) continue;
      const rv = Math.hypot(x - V.x, z - V.z);
      const d = coastRadius(Math.atan2(z, x)) - Math.hypot(x, z);
      if (rv < 280) EXEMPT.cone++;
      else if (d < 90) EXEMPT.cliff++;
      else rogue.push(`(${x}, ${z}) grade ${(step / CELL).toFixed(2)}`);
    }
  }
}

/**
 * Everything that has to be REACHABLE, proved rather than assumed.
 *
 * A flood fill at 3 m over the finished floor, linking neighbours within
 * `MAX_WALKABLE_GRADE` — which is `NavGrid.link`'s rule at twice its cell size,
 * close enough on a field this smooth. **It is the check the exemptions above
 * make necessary**: the moment a map is allowed to have ground it cannot walk,
 * the failure it can have is a flag on the wrong side of it, and that failure
 * is completely silent — the flag simply never gets captured because no flow
 * field ever reaches its goal.
 *
 * **On this map it is also the proof that the BAY IS WADEABLE**, which is the
 * one claim the whole layout rests on: the fill does not know what water is,
 * so a flag on a rock in the middle of a bay is reached only if the bed under
 * the water really does link, all the way from the strand to the crown. C is
 * in the list below for exactly that reason, and it is the reason the bed is
 * shallow and its slopes are gentle rather than dramatic.
 */
const STEP = 3;
const N = Math.round(PLAY / STEP) + 1;
const field = new Float32Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    field[j * N + i] = heightAt(-HALF + i * STEP, -HALF + j * STEP);
  }
}
const seen = new Uint8Array(N * N);
const cellOf = (x, z) =>
  Math.round((z + HALF) / STEP) * N + Math.round((x + HALF) / STEP);
{
  const start = cellOf(A.x, A.z);
  const stack = [start];
  seen[start] = 1;
  const limit = MAX_GRADE * STEP;
  while (stack.length) {
    const c = stack.pop();
    const i = c % N;
    const j = (c - i) / N;
    const h = field[c];
    if (i > 0 && !seen[c - 1] && Math.abs(field[c - 1] - h) <= limit) (seen[c - 1] = 1), stack.push(c - 1);
    if (i < N - 1 && !seen[c + 1] && Math.abs(field[c + 1] - h) <= limit) (seen[c + 1] = 1), stack.push(c + 1);
    if (j > 0 && !seen[c - N] && Math.abs(field[c - N] - h) <= limit) (seen[c - N] = 1), stack.push(c - N);
    if (j < N - 1 && !seen[c + N] && Math.abs(field[c + N] - h) <= limit) (seen[c + N] = 1), stack.push(c + N);
  }
}
const unreachable = [];
for (const f of FLAGS) if (!seen[cellOf(f.x, f.z)]) unreachable.push(f.id);
for (const h of HOMES) if (!seen[cellOf(h.x, h.z)]) unreachable.push(`home${h.team}`);

/**
 * The sea's rectangles TILE, and every probe stands in water — both proved
 * over the finished floor rather than read off the numbers. See `WATER`.
 */
const wetOutside = [];
const overlaps = [];
const inRect = (r, x, z) =>
  x >= r.x - r.width / 2 && x <= r.x + r.width / 2 && z >= r.z - r.depth / 2 && z <= r.z + r.depth / 2;
for (let a = 0; a < WATER.length; a++) {
  for (let b = a + 1; b < WATER.length; b++) {
    const p = WATER[a];
    const s = WATER[b];
    if (
      Math.abs(p.x - s.x) < (p.width + s.width) / 2 - 0.5 &&
      Math.abs(p.z - s.z) < (p.depth + s.depth) / 2 - 0.5
    ) {
      overlaps.push(`${p.n} / ${s.n}`);
    }
  }
}
for (let j = 0; j < row; j++) {
  for (let i = 0; i < row; i++) {
    if (q[j * row + i] > SEA) continue;
    const x = -HALF + i * CELL;
    const z = -HALF + j * CELL;
    if (WATER.filter((r) => inRect(r, x, z)).length !== 1) wetOutside.push(`(${x}, ${z})`);
  }
}
// The probe site each rect will actually get — `WaterSystem.bakeDepth`'s own
// weighting, at a coarser stride, which is enough to catch the failure this
// exists for: a probe standing on the island in the middle of its own sea.
const probeSites = WATER.map((r) => {
  let wx = 0;
  let wz = 0;
  let weight = 0;
  const n = 96;
  for (let j = 0; j < n; j++) {
    const z = r.z - r.depth / 2 + (r.depth * (j + 0.5)) / n;
    for (let i = 0; i < n; i++) {
      const x = r.x - r.width / 2 + (r.width * (i + 0.5)) / n;
      const d = (SEA - heightAt(x, z)) / 1.5;
      if (d <= 0) continue;
      const g = Math.min(d, 1);
      wx += x * g;
      wz += z * g;
      weight += g;
    }
  }
  return { n: r.n, x: weight ? wx / weight : r.x, z: weight ? wz / weight : r.z, weight };
});
const drySites = probeSites.filter((s) => !s.weight || heightAt(s.x, s.z) > SEA);

let lo = Infinity;
let hi = -Infinity;
let landVerts = 0;
for (const v of q) {
  if (v < lo) lo = v;
  if (v > hi) hi = v;
  if (v > SEA) landVerts++;
}
const landKm2 = (landVerts * CELL * CELL) / 1e6;
/** How much of the play square is navigable water — the number a boat is for. */
let wetVerts = 0;
for (let j = 0; j < row; j++) {
  for (let i = 0; i < row; i++) {
    if (q[j * row + i] <= SEA) wetVerts++;
  }
}
const seaKm2 = (wetVerts * CELL * CELL) / 1e6;
/** …and how much of THAT is the bay rather than the open sea outside the coast. */
let bayVerts = 0;
for (let j = 0; j < row; j++) {
  for (let i = 0; i < row; i++) {
    const x = -HALF + i * CELL;
    const z = -HALF + j * CELL;
    if (q[j * row + i] <= SEA && bayIn(x, z) > 0) bayVerts++;
  }
}
const bayKm2 = (bayVerts * CELL * CELL) / 1e6;

// The floor, before a single thing is built on it — see `probe`. It exits.
if (process.argv.includes("--probe")) probe();

if (rogue.length) {
  throw new Error(
    `terrain: ${rogue.length} land edges are steeper than MAX_WALKABLE_GRADE ` +
      `${MAX_GRADE} and are neither on the cone nor on a sea cliff — the nav ` +
      "graph severs there and strands whatever is beyond it. First few: " +
      rogue.slice(0, 6).join(", "),
  );
}
if (unreachable.length) {
  throw new Error(
    `terrain: ${unreachable.join(", ")} cannot be walked to from the quay. A ` +
      "flag on the far side of severed ground is never captured and its flow " +
      "field's goal sits in a cell nothing can reach, with nothing to see. If " +
      "it is C, the bay has stopped being wadeable — see FORE/BEACH/BED_DEEP.",
  );
}
if (seen[cellOf(V.x, V.z)]) {
  throw new Error(
    "terrain: the summit of Grimhold is walkable from the town. The upper " +
      "cone is meant to sever itself (see CONE) so that nobody holds the " +
      "highest ground on a 1,500 m map — check the 104-168 m band.",
  );
}
if (overlaps.length) {
  throw new Error(
    `water: these rects overlap — ${overlaps.join(", ")}. Two coplanar planes ` +
      "at one height are a per-pixel tie that nothing can settle; the sea is a " +
      "partition of the square and must stay one.",
  );
}
if (wetOutside.length) {
  throw new Error(
    `water: ${wetOutside.length} vertices under sea level are in no rect (or ` +
      "in two) — wet ground with a dry sky over it, or a fighting overlap. " +
      `First few: ${wetOutside.slice(0, 6).join(", ")}`,
  );
}
if (drySites.length) {
  throw new Error(
    `water: the reflection probe for ${drySites.map((s) => s.n).join(", ")} ` +
      "stands on dry land. A cube baked from inside a hill is what the whole " +
      "of that body of water then mirrors — repartition the sea (see WATER) " +
      "or move what is standing in the middle of it.",
  );
}

const heightRows = [];
for (let j = 0; j < row; j++) {
  const line = [];
  for (let i = 0; i < row; i++) line.push(String(q[j * row + i]));
  heightRows.push("    " + line.join(",") + ",");
}


// --- the roads, first, because everything else dodges them -------------------

section(placements, "the roads and the streets");
placements.push(
  "  // Visual only: a road carries no collider, stops no round and is in no",
  "  // baked structure. The one thing it rejects is something ROOTED sown on",
  "  // top of it (see `world/roads.ts`), and every quarter, every set piece",
  "  // and every scatter region below was generated against the rectangles",
  "  // these claim.",
  "  //",
  "  // **THE NETWORK IS THE TOWN, AND THE HOUSES ARE ARRANGED AGAINST IT.**",
  "  // Eight arterials carry the island — the Strand along the harbour, the",
  "  // Steps up to the old town, the BAY ROAD right round the inside of the C,",
  "  // the haul road, the coast road along the southern shelf, the shore lane",
  "  // round the north arm and one road out of each landing — and every",
  "  // quarter below is a grid of its own streets hung off one of them, laid",
  "  // BEFORE the buildings so that each house can be turned to face the",
  "  // carriageway it stands on. A street is a `road` placement like any",
  "  // other; what makes it a street rather than a road is that there is a row",
  "  // of doors down both sides of it.",
  "  //",
  "  // **EVERY LEG THAT TOUCHES THE WATER IS DERIVED FROM THE WATERLINE.** The",
  "  // Strand and the bay road are not polylines somebody typed: the generator",
  "  // marches the finished floor outward from the middle of the bay, finds",
  "  // where the ground actually crosses the sea on each bearing, and lays the",
  "  // carriageway a stated distance inland of THAT. So does every jetty, boat",
  "  // shed, quay wall and lamp on both waterfronts. What is authored is an arc",
  "  // and a setback; the shore itself moves whenever the floor does, and a",
  "  // road authored against it would be quietly wrong after every such change.",
);

let roadLegs = 0;

/**
 * One slab of carriageway: the whole of what a road IS here.
 *
 * `buildRoad` runs its slab along local +Z, so the yaw is `atan2(dx, dz)` for
 * a road going somewhere and the rotation of the grid for a street.
 *
 * **The PAD is the difference between a road and a street** and it is the
 * number the whole fabric is dimensioned against. An arterial claims a metre
 * and a half of verge either side, because nothing should be built into a road
 * crossing open country. A STREET claims a tenth of a metre, because a
 * frontage stands ON the kerb: the block edge IS the carriageway edge, and
 * what holds a house off the road is `fillBlock`'s setback rather than the
 * claim. Give a street the verge and every frontage in the town is refused;
 * give a house the pad it would want in open country and the same happens.
 */
/**
 * Every carriageway on the island, as the oriented rectangle it covers.
 *
 * **A road nobody can reach is the failure this list exists to catch**, and it
 * is a failure with no symptom: a quarter laid two hundred metres off the
 * network still builds, still looks like a town in a screenshot and is still a
 * place a player arrives at across open ground wondering what it is for. The
 * old map shipped with exactly that — four arterials and a shelf of crofts
 * with no lane anywhere near them — so the coverage is MEASURED here
 * (`roadDist`, and the `--roads` probe that prints it) and then ASSERTED at
 * the bottom of this file, rather than being something somebody re-checks by
 * flying over it.
 */
const ROADS = [];

/**
 * How far a thing people LIVE in may stand from a carriageway.
 *
 * It is a hundred and fifty metres because that is roughly the longest track
 * anybody puts in to a farm and still calls it a farm, and because the thing
 * it is guarding against is not sixty metres — it is the three hundred that
 * the old lattice was putting holdings at, out on ground with no lane within
 * sight of it in any direction.
 */
const ROAD_REACH = 150;

/** How far `(x, z)` is from the nearest carriageway EDGE. 0 means on one. */
function roadDist(x, z) {
  let best = Infinity;
  for (const r of ROADS) {
    // Into the slab's own frame, exactly as `hits` does it: local +X is
    // (cos, -sin) in world and +Z is (sin, cos).
    const dx = x - r.x;
    const dz = z - r.z;
    const u = Math.abs(dx * r.c - dz * r.s) - r.hw;
    const v = Math.abs(dx * r.s + dz * r.c) - r.hd;
    const d = u <= 0 && v <= 0 ? 0 : Math.hypot(Math.max(0, u), Math.max(0, v));
    if (d < best) best = d;
  }
  return best;
}

function roadSlab(x, z, rot, len, w, surface, pad = 1.4) {
  ROADS.push({
    x,
    z,
    hw: w / 2,
    hd: len / 2,
    c: Math.cos(rot),
    s: Math.sin(rot),
  });
  // `null` claims nothing at all, which is what a SQUARE is: its paving is
  // laid over the streets that bound it and over the ground the stalls, the
  // lamps and the memorial stand on, and the only thing keeping the middle of
  // it clear is the flag's own ring (`SQUARE_CLEAR`).
  if (pad !== null) claim(x, z, w, len, rot, pad, true);
  placements.push(
    `  { kind: "road", x: ${n2(x)}, z: ${n2(z)}${rotToken(rot)}, ` +
      `params: { length: ${n2(len)}, width: ${n2(w)}, surface: "${surface}" } },`,
  );
  roadLegs++;
}

/**
 * A road as a POLYLINE, emitted one slab per leg.
 *
 * Legs overlap by half a width at each joint: two slabs meeting at an angle
 * leave a wedge of bare ground between them otherwise, and a road is the one
 * thing here whose seams are at eye height on the way past. Two slabs of the
 * SAME surface overlapping is a tie between two coplanar sheets that nothing
 * can see — one colour, one merged mesh — which is why a junction only needs
 * deciding (`ROAD_RANK`) when the two surfaces differ.
 */
/** Every arterial, kept so that the outskirts can be laid ALONG the roads. */
const TRACKS = [];
function roadRun(pts, w, surface) {
  TRACKS.push(pts);
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const dx = bx - ax;
    const dz = bz - az;
    roadSlab(
      (ax + bx) / 2,
      (az + bz) / 2,
      Math.atan2(dx, dz),
      Math.hypot(dx, dz) + w,
      w,
      surface,
    );
  }
}

// --- the arterials -----------------------------------------------------------

/**
 * **EVERY ROAD THAT TOUCHES THE BAY IS DERIVED FROM THE WATERLINE**, and none
 * of them states a coordinate on the shore.
 *
 * `shoreRun` walks a span of bearings out of the middle of the bay, asks
 * `bayShore` where the water actually stops on each one, and hands back the
 * points a fixed distance inland of it. So the Strand follows the harbour and
 * the bay road follows the north shore because that is what they ARE, not
 * because somebody typed a polyline that happened to fit — and when the bay's
 * radius, the foreshore's slope or a district's level moves, they follow. A
 * waterfront authored against a shoreline is a waterfront that is wrong after
 * the next change to the floor, and there is nothing in a screenshot that says
 * which one.
 *
 * What is authored is the two things that are actually decisions: WHICH ARC of
 * the shore a road runs along, and HOW FAR BACK from the water it stands.
 */

/**
 * The STRAND: the harbour's waterfront, along the bay's south-western shore,
 * and the only cobbles on the island outside the two squares.
 *
 * **It stands on the lip of the quay wall rather than back on the flat.** The
 * quay is levelled to 6.4 m and the water is thirty-odd metres away and six
 * metres below, so the bank between them is where the slips, the sheds and
 * the jetties are, the town is behind the road, and the road is the join.
 */
roadRun(shoreRun(1.92, 2.79, 8, 34), 11, "cobble");

/**
 * The STEPS: west out of the harbour and up the ramp to the old town.
 *
 * Six metres of climb over a hundred and seventy, which is the only connection
 * between the two levelled benches this island's town stands on and the reason
 * B is three hundred metres from A up a road rather than across a field.
 */
roadRun([[-126, 199], [-186, 190], [-248, 182], [-300, 180]], 8, "cobble");

/**
 * The BAY ROAD: the inside of the C, from the head of the harbour round the
 * western head and along the whole north shore to Netstrand.
 *
 * **This is the road the map is built around and it is the one the old map did
 * not have.** Cinder Reach divided the island in two and had exactly one ford
 * across it, so half the layout existed to make that ford matter. A bay does
 * not divide anything: it is a hole with a rim, the rim is continuous, and the
 * road round it is seven hundred metres of shoreline with the water on one
 * side and the mountain on the other. What crosses the middle is the WADE — or
 * the aircraft, or, one day, a boat.
 */
roadRun(shoreRun(2.97, 5.41, 16, 36), 9, "dirt");

/** The haul road, the works' one way down to the water. */
roadRun([[-330, -56], [-284, -20], [-212, -4], [-146, 12]], 9, "dirt");

/** Team 0's road off the south-west headland, into the old town. */
roadRun([[-495, 440], [-465, 380], [-436, 306], [-406, 232]], 7, "dirt");

/** Team 1's road off the north-east headland, into Netstrand. */
roadRun([[475, -420], [470, -358], [460, -288], [450, -212]], 7, "dirt");

/**
 * The COAST ROAD, along the southern shelf.
 *
 * **A road that goes nowhere is what the outskirts had**: four ways out of the
 * town and open ground with none. The shelf south of the bay is the widest
 * walkable ground on the island and carried nothing but scattered crofts; the
 * coast road is what makes those crofts roadside farms, what gives a hull a
 * line between the harbour and the mouth that does not go up a street, and
 * what a player crossing four hundred metres of moor at night has to steer by.
 * Every metre of it is under a 0.10 gradient on the finished floor.
 */
roadRun(
  [
    [-495, 440],
    [-462, 472],
    [-390, 478],
    [-320, 472],
    [-240, 470],
    [-90, 495],
    [100, 505],
    [290, 470],
    [430, 395],
    [512, 306],
  ],
  7,
  "dirt",
);

/** …and its lane out to the south cape and the light on the mouth. */
roadRun([[512, 306], [556, 246], [580, 186]], 6, "dirt");

/**
 * The SHORE LANE: Netstrand out round the north-east coast onto team 1's road,
 * which is what turns the north arm from a spur into a circuit.
 */
roadRun([[452, -208], [516, -262], [546, -344], [516, -430]], 7, "dirt");

/**
 * The NORTH SHORE TRACK: off the bay road at the top of the harbour, over the
 * north arm and along the outer coast onto team 1's road.
 *
 * The arm is 250 m of walkable ground between the bay road on its inside and
 * the open sea on its outside, and until this it had nothing on it at all —
 * `--roads` put the whole of it past 150 m. What the track buys is a route
 * from the middle of the map onto team 1's approach that does not go through
 * Netstrand, which is the one flank the north half of the island did not have.
 */
roadRun(
  [[160, -247], [130, -330], [162, -418], [256, -452], [356, -420], [430, -350], [460, -288]],
  6,
  "dirt",
);

/**
 * The MOOR LANE: the old town's west gate, out across the western moor and
 * back down to where team 0's road meets the coast road.
 *
 * **`--roads` is what says this has to exist**, and it is the reason that
 * probe was written: the whole western third of the island — a quarter of the
 * dry ground on the map — was over a hundred and fifty metres from any
 * carriageway, which is a fifth of a 1,500 m square that a player crosses
 * wondering whether they have left the level. The lane costs four slabs and
 * turns it into the long way round between B and team 0's landing, which is a
 * route a truck can take and the Steps are not.
 *
 * Every leg of it is proved dry and under a 0.25 gradient by `assertRoadsDry`
 * below, because a lane authored across a moor nobody had walked is exactly
 * the thing that comes out lying in the sea or up a cliff.
 */
roadRun([[-476, 186], [-560, 232], [-598, 318], [-566, 400], [-495, 440]], 6, "dirt");

/**
 * The ASH TRACK: off the middle of the haul road, along the mountain's toe and
 * down to the old town's north gate.
 *
 * It is the poorest road on the map on purpose — five metres of dirt with
 * nothing lit on it and nothing built along it but ruins — because what it
 * crosses is the ash. What it BUYS is that the works is no longer a dead end
 * reached only by the haul road: D has a second approach, from the side the
 * mountain is on, and holding the crossroads no longer holds the flag.
 */
roadRun([[-284, -20], [-330, 34], [-400, 60], [-458, 90], [-476, 132]], 5, "dirt");

// --- the quarters, and the streets inside them -------------------------------

/**
 * The QUAY: five blocks along the Strand and three deep, TURNED TO THE SHORE.
 *
 * **This is the first quarter in the tree that is not on the compass, and a
 * bay is why.** The old map's quarters were all axis-aligned because the reach
 * ran east-west and its two banks did too; a harbour on the inside of a curve
 * has no square to be square to. The grid is laid on the shore's own tangent
 * (a quarter turn off the 135-degree bearing the quay sits on), so the front
 * row stands ON the Strand along its whole length instead of meeting it at an
 * angle and leaving a wedge of nothing at one end.
 *
 * The square is the middle of the front row, which puts flag A in an open
 * paved place with the harbour across the road and the town's own streets
 * running out of its other two corners. Cobbled, because this is the one
 * quarter on the island that was ever paid for.
 */
const QUAY = quarterStreets({
  x: -106,
  z: 361,
  rot: -Math.PI / 4,
  cols: 5,
  rows: 3,
  plot: [34, 28],
  width: 6,
  surface: "cobble",
  // No street of its own on the water side: the Strand is already there, and
  // two carriageways two metres apart are one sheet fighting the other for
  // every pixel. The houses still front it — see `fronts`.
  edges: [false, true, true, true],
});
/**
 * The harbour square: TWO blocks of the front row paved as one open place,
 * with the flag between them.
 *
 * One block was not enough and the reason is the arithmetic every square on
 * this map is cut to: the flag keeps 18 m of ground clear (`SQUARE_CLEAR`) and
 * a 34 m block paved out to its own kerbs leaves an eight-metre ring round
 * that — a square with nothing in it, no stall on it and no room for the thing
 * the harbour is remembering. Two blocks and the lane between them is 74 m of
 * paving, and the far half of it is a place.
 */
const QUAY_SQUARE = (() => {
  const a = QUAY.block(1, 0);
  const b = QUAY.block(2, 0);
  return plaza((a.x + b.x) / 2, (a.z + b.z) / 2, a.hw * 4 + 12, a.hd * 2 + 12, a.rot, "cobble");
})();
const QUAY_PAVED = new Set([QUAY.block(1, 0), QUAY.block(2, 0)]);

/**
 * The NETLOFTS: the poorer quarter on the ramp between the harbour bench and
 * the old town's shelf, with the Steps running past its door.
 */
const LOFTS = quarterStreets({
  x: -214,
  z: 246,
  rot: -0.24,
  cols: 3,
  rows: 2,
  plot: [34, 28],
  width: 6,
  surface: "dirt",
  edges: [true, true, true, true],
});

/**
 * CINDER STEPS: the old town on the shelf, and the tightest streets on the
 * island.
 *
 * **The lanes are 2.8 m and the houses stand on them**, which leaves 5.2 m
 * between the two rows of doors — measured rather than asserted, because it is
 * the one number on this map a vehicle reads: `drive.collideRadius` is 2.2 for
 * the tank and 1.6 for the gun truck, so a truck takes these lanes at speed
 * and a tank does not fit down one at all. What the tank has instead is the
 * seven-metre ring road round the outside (`edgeWidth`) and the two streets
 * that cross the quarter, which is the whole trade the old town exists for on
 * a map with armour on it — and it is bought with a street width rather than
 * with any rule that knows a vehicle exists.
 */
const OLDTOWN = quarterStreets({
  x: B.x,
  z: B.z,
  cols: 5,
  rows: 3,
  plot: [34, 26],
  width: 2.8,
  edgeWidth: 7,
  surface: "cobble",
});
const MARKET_BLOCK = OLDTOWN.middle();
const MARKET = plaza(
  MARKET_BLOCK.x,
  MARKET_BLOCK.z,
  MARKET_BLOCK.hw * 2 + 5.6,
  MARKET_BLOCK.hd * 2 + 5.6,
  MARKET_BLOCK.rot,
  "cobble",
);

/**
 * The ASHWORKS: two by two blocks of yard on a crossroads, and the flag at the
 * crossing.
 *
 * A works is a road layout rather than a street layout — what it is arranged
 * around is the haul road and the loading platform — so its blocks are twice a
 * town's and what stands round their edges is sheds, kilns and stacked spoil
 * rather than doors.
 */
const WORKS = quarterStreets({
  x: D.x,
  z: D.z,
  cols: 2,
  rows: 2,
  plot: [56, 44],
  width: 7,
  surface: "dirt",
});

/**
 * NETSTRAND: the fishing hamlet on the bay's north-eastern shore, five blocks
 * by three between the bay road and the beach.
 *
 * Turned to its own shore exactly as the quay is, and to the OTHER quarter
 * turn — the two waterfronts face each other across five hundred metres of
 * open water with the rock in the middle of it, which is the view this map was
 * rebuilt to have.
 */
const NETSTRAND = quarterStreets({
  x: E.x,
  z: E.z,
  rot: (3 * Math.PI) / 4,
  cols: 5,
  rows: 3,
  plot: [38, 26],
  width: 6,
  surface: "dirt",
  edges: [false, true, true, true],
});
const FISH_BLOCK = NETSTRAND.middle();
const FISHMARKET = plaza(
  FISH_BLOCK.x,
  FISH_BLOCK.z,
  FISH_BLOCK.hw * 2 + 12,
  FISH_BLOCK.hd * 2 + 12,
  FISH_BLOCK.rot,
  "dirt",
);

/**
 * SALTHOUSES: the salt hamlet on the southern strand, three blocks by two on
 * the coast road, with its pans on the flat between it and the sea.
 *
 * **The southern shelf is the biggest single piece of ground on this island
 * and it carried a road and nothing else.** Four hundred metres of level
 * strand between the quay and the cape, on the flank every route from team 0's
 * landing toward E crosses, with a dozen scattered crofts on it — which is the
 * shape of a place a player walks over rather than through.
 *
 * What makes it a settlement rather than more crofts is that it has a REASON.
 * There is no river on a lava island and nothing on the shelf to farm, so what
 * flat ground behind a strand is for is taking salt out of the sea: the pans
 * are laid seaward of the road on the wettest, lowest ground, the store and
 * the racks are on the road, and the houses are behind them. That is the third
 * industry on the map — after the fish and the sulphur — and it is the one
 * that explains a village standing where nothing grows.
 *
 * No street on its seaward side (`edges[2]`), because the coast road already
 * runs along it: the Quay's rule, and the houses still front it.
 */
const SALT = quarterStreets({
  x: 60,
  z: 469,
  rot: -0.053,
  cols: 3,
  rows: 2,
  plot: [32, 26],
  width: 6,
  surface: "dirt",
  edges: [true, true, false, true],
  fronts: [true, true, true, true],
});

// The flags, the yards and the hardstandings claim their ground before any
// building does. `MapBuilder.keepClear` holds SCATTER off them and nothing
// holds a placement off, so a flag standing inside a collider is this script's
// to prevent — a flag nothing can stand on cannot be captured and sinks its
// own flow field.
//
// **The ring claimed is the capture point and not the zone around it.** What
// `surfaceAt` needs is that the flag's own position is not inside a collider;
// what the ROUND needs is that the middle of a capture zone is ground rather
// than building. It leaves the rest of the zone free for the stalls, the lamps
// and the wells that make a flag a place. Four of the five stand in the middle
// of a paved square laid a few lines above, which is the same rule with the
// reason showing: the square is not claimed at all, because THIS is what keeps
// the middle of it open.
for (const f of FLAGS) claim(f.x, f.z, SQUARE_CLEAR, SQUARE_CLEAR);

// The spawns and the hardstandings, computed here rather than at the end,
// because they have to claim their ground before the yard is dressed around
// them. A shed on a spawn is a body deploying inside a collider.
const spawns = [];
const vehicles = [];
const spawnLine = (team, x, z, yaw) =>
  `  { team: ${team}, pos: new Vector3(${n2(x)}, ` +
  `${n2(Number(heightAt(x, z).toFixed(2)))}, ${n2(z)}), yaw: ${n2(yaw)} },`;

for (const h of HOMES) {
  // Perpendicular to the way out, so the three infantry spawns stand abreast
  // rather than in a column: a column deploys the second man inside the first.
  const px = -h.uz;
  const pz = h.ux;
  for (let i = 0; i < 3; i++) {
    const x = h.x - h.ux * (16 + i * 4) + px * ((i - 1) * 12);
    const z = h.z - h.uz * (16 + i * 4) + pz * ((i - 1) * 12);
    claim(x, z, 8, 8);
    spawns.push(spawnLine(h.team, x, z, h.yaw));
  }
  // The TANK, on the inner edge of the yard, pointing at the town.
  const tx = h.x + h.ux * 30;
  const tz = h.z + h.uz * 30;
  claim(tx, tz, 16, 16);
  vehicles.push(
    `  { team: ${h.team}, pos: new Vector3(${n2(tx)}, ` +
      `${n2(Number(heightAt(tx, tz).toFixed(2)))}, ${n2(tz)}), yaw: ${n2(h.yaw)} },`,
  );
  // The gun TRUCK, and **where it stands was decided by `crew.boardRadius`
  // rather than by the geometry**. A bot is never given a vehicle as a
  // destination — its crew is whoever walks past — so a hardstanding nobody
  // walks within 18 m of never gets crewed at all.
  const kx = h.x + h.ux * 6 + px * -18;
  const kz = h.z + h.uz * 6 + pz * -18;
  claim(kx, kz, 12, 12);
  vehicles.push(
    `  { team: ${h.team}, pos: new Vector3(${n2(kx)}, ` +
      `${n2(Number(heightAt(kx, kz).toFixed(2)))}, ${n2(kz)}), ` +
      `yaw: ${n2(h.yaw)}, kind: "truck" },`,
  );
  // The HELIPAD, across the yard from both. It owes nothing to the departure
  // corridor the other two owe — a helicopter leaves straight up — and what
  // replaces that is overhead clearance and the 10.4 m rotor disc, which is
  // why its claim is the largest of the three.
  const gx = h.x - h.ux * 8 + px * 20;
  const gz = h.z - h.uz * 8 + pz * 20;
  claim(gx, gz, 20, 20);
  vehicles.push(
    `  { team: ${h.team}, pos: new Vector3(${n2(gx)}, ` +
      `${n2(Number(heightAt(gx, gz).toFixed(2)))}, ${n2(gz)}), ` +
      `yaw: ${n2(h.yaw)}, kind: "heli" },`,
  );
}

// --- A — the Quay ------------------------------------------------------------

section(placements, "A - the Quay");

/**
 * The quay's own waterfront furniture, all of it on BEARINGS rather than
 * coordinates.
 *
 * A bearing out of the middle of the bay and a setback off the water is the
 * only pair of numbers that survives a change to the floor — see the arterials
 * above for the argument, which is the same one.
 */
const QUAY_ARC = [1.95, 2.76];
/** A bearing `t` of the way along an arc. */
const along = (arc, t) => arc[0] + (arc[1] - arc[0]) * t;
/** A point `inset` metres inland of the bay's shore on a bearing. */
function inland(a, inset) {
  const s = bayShore(a);
  if (!s) return null;
  return [
    Number((BAY.x + Math.cos(a) * (s.r + inset)).toFixed(2)),
    Number((BAY.z + Math.sin(a) * (s.r + inset)).toFixed(2)),
  ];
}
/** …and the `rotY` a thing on the shore needs in order to FACE the water. */
const faceWater = (kind, a) => faceRot(kind, -Math.cos(a), -Math.sin(a));

// The harbour's memorial, at the inland end of the square's paving. It is
// beside the capture point rather than on it because a flag's own ring is
// claimed before any building: what `surfaceAt` needs is that the point itself
// is not inside a collider.
{
  const L = local(QUAY_SQUARE.rot);
  must(
    "monument",
    QUAY_SQUARE.x + L.ux * 24,
    QUAY_SQUARE.z + L.uz * 24,
    0,
    12,
    12,
    { width: 11 },
    1.2,
  );
}

// The bonded warehouse at the east end of the Strand's frontage, with its
// loading elevation ON the road (`BACK_TO_FRONT`). `depot` is the biggest
// thing on the waterfront and is what makes the quay read as working rather
// than picturesque.
{
  const p = onFront(QUAY.block(4, 0), 0, 0, 9, "depot");
  must("depot", p.x, p.z, p.rot, 30, 18, { width: 28, depth: 16, height: 8 }, 0.3);
}

// The customs row: shophouses along the Strand, and the only breakable glass
// on the island. `PaneSpec.breakable` is a claim about ENTERABLE SPACE behind
// the sheet, which is exactly what a shopfront on a quay has.
for (const i of [0, 3]) {
  const b = QUAY.block(i, 0);
  for (const t of [-8, 8]) {
    // **16 m of depth, which is the BUILDING's constraint and not the plot's.**
    // `laneFlight` refuses a plate that cannot hold a storey's flight plus the
    // 2.4 m landing at the top of it, and a three-floor shophouse's upper
    // flight is a 10.3 m run — so the plate has to be 15.4 m before anything is
    // drawn on it. A shophouse trimmed by an author to fit a frontage throws in
    // a DEV build and draws nothing at all in a production one.
    const p = onFront(b, 0, t, 8.5, "shophouse");
    must(
      "shophouse",
      p.x,
      p.z,
      p.rot,
      11,
      17,
      {
        width: 10,
        depth: 16,
        floors: 3,
        tint: pick(["#7c4a35", "#3f5b52", "#5a4a6b", "#6b5a2e"]),
        sign: pick(["#ffb257", "#7fe0a0", "#ff8a5a"]),
      },
      0.3,
    );
  }
}

// The boat sheds, standing on the bank with their slipways running down into
// the water. **They face the bay**: a boathouse is drawn open on its own -Z
// (`buildBoathouse`, and `faceRot` for the rule), so a row of them turned the
// other way is a row of blank gable ends with the slips behind them.
for (const t of [0.12, 0.34, 0.56, 0.78]) {
  const a = along(QUAY_ARC, t);
  const p = inland(a, 10);
  if (p) must("boathouse", p[0], p[1], faceWater("boathouse", a), 12, 14, undefined, 1.6);
}

// The two quay cranes, at the head of the middle jetties. **A quay without
// one is a promenade** — every cargo on this island arrived over a gunwale and
// until `buildHarbourCrane` nothing in the kit could lift it — and they are
// the only tall thin silhouettes on five hundred metres of shed roof.
for (const t of [0.23, 0.67]) {
  const a = along(QUAY_ARC, t);
  const p = inland(a, 14);
  // **The claim is the BASE and not the reach**: a jib eleven metres up over
  // the bank is not a conflict with anything standing on the bank, and a
  // rectangle covering it holds the crane a jib's length off the water it is
  // meant to be lifting out of.
  if (p) must("crane", p[0], p[1], faceWater("crane", a), 10, 12, undefined, 1.0);
}

// Two hulls up on the hard, laid along the bank. They are the answer to a
// question the whole waterfront was raising and none of it answered: eleven
// boat sheds, eight jetties and nothing anywhere that had ever been in the
// water. They are also the only hard cover on an open quay.
// At the ENDS of the arc rather than in the middle of it, and that is the
// waterfront's own arithmetic rather than a preference: the bank is banded —
// the quay wall at four metres inland, the sheds at ten, the cranes at
// fourteen, the lamps at twenty-one, the Strand at thirty-four — and a hull is
// seven metres deep, so there is no radial gap anywhere between them that one
// fits into. What there IS is room at either end of the row.
for (const t of [0.02, 0.9]) {
  const a = along(QUAY_ARC, t);
  const p = inland(a, 13);
  if (p) place("careenedHull", p[0], p[1], a + Math.PI / 2, 5, 13, { length: 11 }, 1.0);
}

// The jetties, reaching out over the flat.
//
// **This is what a wadeable bay pays for.** `buildJetty`'s deck stands 0.57 m
// over the ground under it and `CONFIG.nav.stepHeight` is 0.6, so a jetty over
// water 28 cm deep links to the bank along its whole length and needs no stair
// at all — and a jetty over the 2.6 m in the middle of the bay would be a
// surface in the air, walkable, reachable from nowhere and silent about it.
// Every one of them is found by DEPTH (`bayAtDepth`), and `lift` is what lets
// them stand in water their own deck clears.
for (const t of [0.22, 0.45, 0.68]) {
  const a = along(QUAY_ARC, t);
  const p = bayAtDepth(a, 0.28);
  if (p) must("jetty", p.x, p.z, a + Math.PI / 2, 4, 24, { length: 22 }, 1.2, -0.34);
}

// The quay wall, in runs with the slipways left open between them.
for (const t of [0.05, 0.28, 0.5, 0.72, 0.94]) {
  const a = along(QUAY_ARC, t);
  const p = inland(a, 4);
  if (p) wallRun(p[0], p[1], a + Math.PI / 2, 16, { h: 1.4, pad: 0.8 });
}

// The lamps along the Strand. **Every one is a light slot** — sixteen, chosen
// nearest-first — so what is lit here is the quay, the square and the head of
// the bay, and the rest of the island is lamps you can see rather than lamps
// that light you. `buildLampPost` carries its own `LocalLight`; there is no
// flag for it.
for (let i = 0; i < 7; i++) {
  const a = along(QUAY_ARC, i / 6);
  const p = inland(a, 21);
  if (p) place("lamp", p[0], p[1], 0, 2.2, 2.2, undefined, 0.8);
}
// The square is two blocks long, so what `furnish` is handed is the paving
// MINUS the two lanes it swallowed: a stall laid out to the plaza half-width
// stands in the carriageway at the far kerb and is refused, silently, four
// times out of five.
furnish(A.x, A.z, 34, 14, QUAY_SQUARE.rot, { stalls: 4, well: [1, 1] });

// The working clutter along the bank.
for (let i = 0; i < 12; i++) {
  const a = along(QUAY_ARC, rng());
  const p = inland(a, rand(7, 22));
  if (p) place("crates", p[0], p[1], rand(0, Math.PI * 2), 4, 3.6, undefined, 1.2);
}
place("kiln", -150, 214, 0, 5.2, 5.2, undefined, 1.6);
place("cart", -104, 300, 0.4, 4.6, 3.2, undefined, 1.2);
place("cart", -34, 372, -0.3, 4.6, 3.2, { ruined: true }, 1.2);

// THE HARBOUR LIGHT, on the point south-east of the quay where the shore
// turns. A `lighthouse` rather than the `watchtower` that used to stand in for
// one: a timber lookout says somebody is watching, and a light says this water
// is dangerous and people come here anyway — which is the read a harbour cut
// into a lava island wants, and the thing a player wading the bay at night
// steers by. Its keeper's cottage is on the -Z face, so it is turned to put
// that INLAND.
{
  const a = 1.78;
  const p = inland(a, 20);
  if (p) {
    must("lighthouse", p[0], p[1], faceRot("lighthouse", Math.cos(a), Math.sin(a)), 13, 24, undefined, 2);
  }
}

// The tavern on the inland side of the harbour square: the one thing the quay
// had none of and the old town did, on a waterfront with four hundred people
// working it. `facing` puts it ACROSS the lane from the paving, so what
// encloses the square is a front.
{
  const t = facing(QUAY_SQUARE, 2, QUAY.width, -14, 6.5, "tavern");
  must("tavern", t.x, t.z, t.rot, 14.5, 12, undefined, 0.3);
}

/**
 * The quay's own streets, behind the frontage.
 *
 * The Strand's block is shops and warehouses over the harbour and townhouses
 * behind; the two rows behind it are the town. What decides which is the ROW
 * rather than a die: a waterfront that is sometimes three storeys and
 * sometimes a cottage is a waterfront nobody built.
 */
for (const b of QUAY.blocks) {
  if (QUAY_PAVED.has(b)) continue;
  fillBlock(b, {
    gap: 1.6,
    inset: 10,
    size: () => [randInt(7, 9), randInt(7, 9)],
    house: (x, z, rot, w, d) =>
      b.j === 0 || chance(0.55)
        ? townhouseAt(x, z, rot, { w, d })
        : cottageAt(x, z, rot, { w, d }),
    yard: (blk) => backYard(blk, { count: randInt(1, 3) }),
  });
}

// The netlofts on the ramp: lower, poorer, and the last of the town before the
// Steps climb out of it.
//
// **It is now built out of the building it is named after.** The quarter has
// been called the Netlofts since it was laid and was made entirely of
// cottages, which is a name for something the map did not have. A `netLoft` is
// an open undercroft on stone piers with the gear kept dry over it, so a
// street of them has sightlines a street of cottages does not — you see a
// body's legs under one at forty metres and cannot shoot through it at chest
// height — and that is the one thing this quarter has that the old town's
// alleys do not.
for (const b of LOFTS.blocks) {
  fillBlock(b, {
    gap: 2.2,
    inset: 9,
    size: () => [randInt(7, 9), randInt(6, 7)],
    house: (x, z, rot, w, d) => {
      if (chance(0.42)) {
        return place("netLoft", x, z, rot, w + 1, d + 0.9, {
          width: w,
          depth: d,
          litWindows: chance(0.5),
        }, 0.35);
      }
      return chance(0.86) && cottageAt(x, z, rot, { w, d, h: rnd(2.9, 3.5) });
    },
    yard: (blk) => backYard(blk, { count: randInt(1, 2) }),
  });
}

// --- B — Cinder Steps --------------------------------------------------------

section(placements, "B - Cinder Steps");

// The market square's four sides: the tavern on the east, the smithy on the
// west, the well and the shrine at the ends. Each is placed ACROSS a lane from
// the square (`facing`), so what encloses the square is fronts.
{
  const t = facing(MARKET, 1, 0, -2, 6, "tavern");
  must("tavern", t.x, t.z, t.rot, 14.5, 12, undefined, 0.3);
  const s = facing(MARKET, 3, 0, 4, 4.5, "smithy");
  must("smithy", s.x, s.z, s.rot, 10, 9, undefined, 0.3);
  furnish(B.x, B.z, MARKET_BLOCK.hw, MARKET_BLOCK.hd, MARKET_BLOCK.rot, { stalls: 3, well: [-1, -1], shrine: [1, 1] });
}

// The mill, on the shelf north-west of the town where the wind is — and now
// beside the ash track rather than in the middle of a field, which is the
// `croft` rule applied to a set piece: a mill is a place people bring grain
// to, so it stands on a road or it stands nowhere.
must("mill", B.x - 138, B.z - 76, 0.35, 13, 12, undefined, 2.4);

/**
 * The old town's blocks: townhouses on the lane, cottages behind, and a walled
 * yard in the middle of every second one.
 *
 * This is the densest fabric on the island and it is meant to be: two rows of
 * two-storey fronts five metres apart is the one place on a 1,500 m map where
 * a fight is at ten metres, and it is the counterweight to a bay you can see
 * half a kilometre across.
 */
for (const b of OLDTOWN.blocks) {
  if (b === MARKET_BLOCK) continue;
  fillBlock(b, {
    gap: 1.2,
    inset: 9,
    size: () => [randInt(6, 8), randInt(6, 8)],
    house: (x, z, rot, w, d) =>
      chance(0.94) &&
      (chance(0.62)
        ? townhouseAt(x, z, rot, { w, d })
        : cottageAt(x, z, rot, { w, d })),
    yard: (blk) => {
      if (chance(0.45)) yardWall(blk.x, blk.z, blk.hw - 8, blk.hd - 8, blk.rot, randInt(0, 3));
      backYard(blk, { count: randInt(1, 2) });
    },
  });
}

// --- C — Chapel Rock ---------------------------------------------------------

section(placements, "C - Chapel Rock");
placements.push(
  "  // THE ISLAND IN THE MIDDLE OF THE BAY, and the only flag here with no",
  "  // road to it. Everything on it is hand-placed and there is no quarter:",
  "  // the crown is 88 m of dead-level ground (`rockAt` states the plateau",
  "  // rather than levelling a dome with a district) and what that holds is a",
  "  // chapel, a graveyard terrace, a ruin and four cottages, with the slip on",
  "  // the lee side. It is reached by WADING today — the bay is 2.6 m at its",
  "  // deepest and the generator's flood fill proves the crown links to both",
  "  // shores — and it is the obvious place for a boat to matter later.",
);

// The chapel on the crown, facing down the green toward the harbour. It is the
// tallest thing in the middle of the map and what the bay is navigated by.
must("chapel", ROCK.x, ROCK.z - 34, Math.PI, 14, 27, undefined, 0.4);
// The graveyard terrace beside it, and the retaining wall that makes the rock
// read as a bluff rather than a hill. `buildTerrace` carries a walkable top
// face and a ramp on the side named by `rampSide`.
must("terrace", ROCK.x - 36, ROCK.z + 2, 0, 30, 26, { width: 28, depth: 24, height: 2, rampSide: 1 }, 0.6);
must("ruin", ROCK.x + 36, ROCK.z - 6, -Math.PI / 2, 11, 9, { width: 10, depth: 8 }, 0.6);
// THE ROCK LIGHT on the crown's seaward lip: the light in the middle of the
// bay, the one thing on this map that can see both waterfronts, and — with
// the chapel beside it — what makes the island in the harbour read as a place
// from either shore. Turned so its keeper's cottage faces back up the green.
must("lighthouse", ROCK.x + 6, ROCK.z + 32, 0, 13, 24, undefined, 2);
place("well", ROCK.x - 4, ROCK.z + 20, 0, 5, 5, undefined, 1.4);
place("shrine", ROCK.x + 20, ROCK.z + 22, Math.PI, 3, 3, undefined, 0.8);
place("lamp", ROCK.x - 16, ROCK.z + 14, 0, 2.2, 2.2, undefined, 0.8);

// The four cottages of the rock, round the edge of the crown and each turned
// to the middle of it — there is no street here, so what a door faces is the
// green.
for (const a of [0.6, 1.9, 3.5, 4.9]) {
  const x = ROCK.x + Math.cos(a) * 38;
  const z = ROCK.z + Math.sin(a) * 38;
  cottageAt(x, z, faceRot("cottage", -Math.cos(a), -Math.sin(a)), {
    w: randInt(6, 8),
    d: randInt(5, 7),
    h: rnd(3.0, 3.6),
    pad: 1.0,
  });
}

// The slip on the lee shore, and the boat drawn up beside it. `rockShore` is
// the same march the bay's own waterfront is placed off, run the other way.
{
  const s = rockShore(Math.PI);
  if (s) {
    must("boathouse", ROCK.x + Math.cos(Math.PI) * (s.r - 11), ROCK.z, 0, 12, 14, undefined, 1.6);
    place("crates", ROCK.x - s.r + 26, ROCK.z + 16, 0.3, 4, 3.6, undefined, 1.2);
  }
}

// The dry-stone walls holding the crown's edge, in runs with gaps.
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2 + 0.3;
  wallRun(ROCK.x + Math.cos(a) * 56, ROCK.z + Math.sin(a) * 56, a + Math.PI / 2, 24, { h: 1.6, pad: 1.0 });
}

// --- D — the Ashworks --------------------------------------------------------

section(placements, "D - the Ashworks");
placements.push(
  "  // **THE CINDERWORKS IS THE MAP'S LANDMARK**, and it stands ninety metres",
  "  // up the works' own north street rather than on the flag, so that the",
  "  // stack is what closes the view from the crossroads. It is a hollow hall",
  "  // with a cart arch wide enough to drive a tank through, a solid furnace",
  "  // block carrying the one light on this hillside, a forty-metre stack, and",
  "  // a charging deck six metres over the yard reached by one stone flight.",
  "  // `kit/harbour.ts` owns the argument for all four.",
);

/**
 * The smelter, on the bench the works district was extended north to hold.
 *
 * **A landmark on a 1,500 m map is a thing you steer by before you have
 * learned the streets**, and until this one there was nothing on the island
 * over 26 m but the mountain itself — so from the quay, from Netstrand and
 * from the middle of the bay, the whole northern half of the map was a
 * silhouette with no features in it at all. What the stack does at that
 * distance is say where D is; what the hall does at ten metres is give the
 * flag an interior, which the Ashworks was the only quarter without.
 *
 * `rotY: PI` puts the cart arch on the yard and the charging deck uphill,
 * which is the way round a works is actually built — the ore comes down off
 * the mountain onto the deck and the metal goes out through the arch onto the
 * haul road.
 */
const WORKS_N = -200;
must("smelter", D.x, WORKS_N, Math.PI, 62, 32, undefined, 1.0);
// The spur off the works' north ring to the arch. Without it the landmark is
// the one building on the island that no road goes to, which is the mistake
// `--roads` exists to catch.
roadRun([[D.x, -161], [D.x, WORKS_N + 18]], 7, "dirt");

// TWO sulphur kilns at the yard's north corners rather than four. Each carries
// a `LocalLight` and the smelter's furnace now carries another, so what was a
// spend of four of the sixteen slots on one flag is three — and the two that
// are left stand where the light is between the crossroads and the hall,
// which is the ground people actually cross.
for (const [dx, dz] of [[-18, -16], [18, -16]]) {
  must("kiln", D.x + dx, D.z + dz, 0, 5.2, 5.2, undefined, 0.6);
}
// The loading platform, the bonded store and the ore barn, each on the outside
// of the yard where the haul road and the tracks reach them.
{
  // The loading platform, moved off the yard's north side because that is the
  // smelter's ground now: it stands on the EAST instead, where the tramway
  // would have come down to the haul road, and the four set pieces round the
  // yard are now one on each of its four sides rather than three on two.
  const t = facing(WORKS.block(1, 0), 1, WORKS.width, 0, 12, "terrace");
  must("terrace", t.x, t.z, t.rot, 30, 24, { width: 28, depth: 22, height: 2.2, rampSide: -1 }, 0.6);
  const d = facing(WORKS.block(0, 0), 3, WORKS.width, 0, 9, "depot");
  must("depot", d.x, d.z, d.rot, 30, 18, { width: 28, depth: 16, height: 8 }, 0.3);
  const n = facing(WORKS.block(0, 1), 2, WORKS.width, 0, 11.5, "barn");
  must("barn", n.x, n.z, n.rot, 18, 23, undefined, 0.3);
}
for (const [sx, sz] of [[-408, -84], [-408, -52], [-246, -180], [-218, -180]]) {
  must("silo", sx, sz, 0, 7, 7, undefined, 1.6);
}
must("watchtower", D.x - 86, D.z - 74, 0, 7, 7, undefined, 2);

// The yard itself: sheds, kilns and stacked spoil round the four blocks.
for (const b of WORKS.blocks) {
  fillBlock(b, {
    gap: 3.4,
    inset: 12,
    size: () => [randInt(7, 10), randInt(6, 8)],
    house: (x, z, rot, w, d) => {
      const roll = rng();
      if (roll < 0.24) return place("shed", x, z, rot, 4.4, 3.8, undefined, 0.6);
      if (roll < 0.36) return place("silo", x, z, rot, 7, 7, undefined, 0.6);
      if (roll < 0.48) return place("kiln", x, z, rot, 5.2, 5.2, undefined, 0.6);
      if (roll < 0.62) return place("crates", x, z, rot, 4, 3.4, undefined, 0.6);
      if (roll < 0.74) return cottageAt(x, z, rot, { w, d, lit: false });
      return false;
    },
    yard: (blk) => backYard(blk, { count: randInt(0, 2) }),
  });
}

// --- E — Netstrand -----------------------------------------------------------

section(placements, "E - Netstrand");

const NET_ARC = [5.15, 5.85];

// The fish market: the smithy and the barn across the street from the square,
// the well and the stalls on its paving.
{
  const s = facing(FISHMARKET, 3, 0, 0, 4.5, "smithy");
  must("smithy", s.x, s.z, s.rot, 10, 9, undefined, 0.3);
  const n = facing(FISHMARKET, 1, 0, 0, 8.5, "barn");
  must("barn", n.x, n.z, n.rot, 23, 17, undefined, 0.3);
  furnish(E.x, E.z, FISH_BLOCK.hw, FISH_BLOCK.hd, FISH_BLOCK.rot, { stalls: 3, well: [-1, -1] });
}

// The net sheds and the slips, along the bay's north-eastern shore, all of them
// OPEN to the water — see the quay's row for the rule.
for (const t of [0.14, 0.38, 0.62, 0.86]) {
  const a = along(NET_ARC, t);
  const p = inland(a, 10);
  if (p) must("boathouse", p[0], p[1], faceWater("boathouse", a), 12, 14, undefined, 1.6);
}
for (const t of [0.26, 0.5, 0.74]) {
  const a = along(NET_ARC, t);
  const p = bayAtDepth(a, 0.28);
  if (p) must("jetty", p.x, p.z, a + Math.PI / 2, 4, 22, { length: 20 }, 1.2, -0.34);
}
// THE DRYING RACKS between the beach and the bay road, and they are racks now
// rather than a run of `woodpile`s standing in for one. A woodpile is a solid
// 1.9 m block, which is exactly the wrong shape for the job: a rack is a thing
// you see a body THROUGH at forty metres and cannot walk through at two, which
// is the `porous` + `strut` pair `buildFishRack` is built out of.
for (let i = 0; i < 9; i++) {
  const a = along(NET_ARC, i / 8);
  const p = inland(a, 22);
  if (p) place("fishRack", p[0], p[1], a, 11, 2.4, { length: 10 }, 1.0);
}
// The hamlet's own crane, on the slip. One, and a small one: Netstrand lands
// fish and the Quay lands cargo, and the difference between the two
// waterfronts should be legible without a caption.
{
  const a = along(NET_ARC, 0.5);
  const p = inland(a, 12);
  if (p) must("crane", p[0], p[1], faceWater("crane", a), 10, 12, undefined, 1.0);
}
// Two hulls drawn up at the ends of the beach — the quay's arithmetic again,
// on a shorter row with the same bands in it.
for (const t of [0.02, 0.98]) {
  const a = along(NET_ARC, t);
  const p = inland(a, 12);
  if (p) place("careenedHull", p[0], p[1], a + Math.PI / 2, 5, 12, { length: 10 }, 1.0);
}
place("kiln", 300, -168, 0, 5.2, 5.2, undefined, 1.6);
place("kiln", 480, -84, 0, 5.2, 5.2, undefined, 1.6);

// The hamlet itself: single-storey, every door on a street, and a net loft on
// about a quarter of the plots — fewer than the Netlofts quarter, because this
// is where the boats are kept and that is where the gear is.
for (const b of NETSTRAND.blocks) {
  if (b === FISH_BLOCK) continue;
  fillBlock(b, {
    gap: 2,
    inset: 9,
    size: () => [randInt(7, 9), randInt(6, 8)],
    house: (x, z, rot, w, d) => {
      if (chance(0.24)) {
        return place("netLoft", x, z, rot, w + 1, d + 0.9, {
          width: w,
          depth: d,
          litWindows: chance(0.4),
        }, 0.35);
      }
      return chance(0.88) && cottageAt(x, z, rot, { w, d, h: rnd(2.9, 3.6) });
    },
    yard: (blk) => backYard(blk, { count: randInt(1, 3) }),
  });
}

// --- Salthouses --------------------------------------------------------------

section(placements, "Salthouses - the salt hamlet on the southern strand");
placements.push(
  "  // Not a flag: the sixth settlement, on the coast road halfway between the",
  "  // quay and the cape. It is what the southern shelf — the largest single",
  "  // piece of level ground on the island — had instead of a reason to be",
  "  // crossed. The PANS are the point: no river and nothing to farm means the",
  "  // flat behind a strand is worth having for the salt, and everything else",
  "  // here is arranged around them.",
);

// The salt store on the coast-road frontage, and the smithy across from it.
{
  const b = SALT.block(1, 1);
  const p = onFront(b, 2, 0, 8.5, "barn");
  must("barn", p.x, p.z, p.rot, 23, 17, undefined, 0.3);
  const q = onFront(SALT.block(0, 1), 2, 0, 4.5, "smithy");
  place("smithy", q.x, q.z, q.rot, 10, 9, undefined, 0.3);
}
// The well, on the west block's yard rather than at the crossing: a street
// claims its ground and a pump standing in a carriageway is refused, silently.
place("well", SALT.block(0, 0).x, SALT.block(0, 0).z, 0, 5, 5, undefined, 1.0);

/**
 * The pans, on the low flat between the road and the sea.
 *
 * They are laid where the ground is one to three metres — the wettest walkable
 * ground on the island outside the bay — because that is where a pan goes and
 * because it is the one part of this shelf that never had anything on it.
 * `buildSaltPan`'s coping is drawn and not collided, so a field of them is as
 * free to the ray budget as a field of road slabs; what they cost is the
 * grass, which is why the shelf's grass rects were cut round them.
 */
for (const [px, pz, pw, pd] of [
  [-26, 524, 30, 18],
  [14, 526, 30, 18],
  [54, 528, 30, 18],
  [94, 530, 26, 16],
  [-6, 552, 26, 16],
  [66, 554, 26, 16],
]) {
  place("saltPan", px, pz, -0.053, pw + 2, pd + 2, { width: pw, depth: pd }, 1.2);
}
// The salt sheds and the racks on the pans' own bank, between them and the
// road: a pan needs somewhere dry to put what comes out of it.
// Everything here stands SEAWARD of the coast road's own claim (the
// carriageway is at z ~502 and claims 5 m of verge either side), which is the
// one number this block is cut to.
for (const [sx, sz] of [[-46, 514], [22, 516], [88, 518]]) {
  place("shed", sx, sz, -0.053, 4.4, 3.8, undefined, 1.0);
}
// The racks go in the four-metre lane between the road's verge and the first
// row of pans, which is the only strip on this flat that is neither
// carriageway nor brine.
for (const [rx, rz] of [[-84, 510], [-12, 510], [52, 510], [118, 510]]) {
  place("fishRack", rx, rz, -0.053, 11, 2.4, { length: 10 }, 1.0);
}
place("careenedHull", -84, 532, 1.52, 5, 12, { length: 10 }, 1.0);
place("crates", -66, 516, 0.2, 4, 3.6, undefined, 1.2);
place("cart", 34, 512, -0.4, 4.6, 3.2, undefined, 1.2);
place("lamp", 92, 494, 0, 2.2, 2.2, undefined, 0.8);

// The houses: single-storey, cheap, and turned to whichever street they stand
// on. A net loft here and there, because half of Salthouses fishes too.
for (const b of SALT.blocks) {
  fillBlock(b, {
    gap: 2.2,
    inset: 9,
    size: () => [randInt(6, 9), randInt(5, 7)],
    house: (x, z, rot, w, d) => {
      if (chance(0.18)) {
        return place("netLoft", x, z, rot, w + 1, d + 0.9, { width: w, depth: d }, 0.35);
      }
      return chance(0.85) && cottageAt(x, z, rot, { w, d, h: rnd(2.9, 3.5) });
    },
    yard: (blk) => backYard(blk, { count: randInt(1, 2) }),
  });
}

// --- the landings ------------------------------------------------------------

section(placements, "the two landings");

for (const h of HOMES) {
  const px = -h.uz;
  const pz = h.ux;
  // The gate, on the way out toward the island. Its banner is the one place a
  // team colour is BUILT into the world rather than worn on a body.
  must(
    "gatehouse",
    h.x + h.ux * 62,
    h.z + h.uz * 62,
    h.yaw + Math.PI / 2,
    20,
    12,
    { teamColor: h.color },
    2,
  );
  // The stores, and the sheds behind them.
  place("depot", h.x - h.ux * 40 + px * -34, h.z - h.uz * 40 + pz * -34, h.yaw, 29, 17, { width: 28, depth: 16, height: 8 }, 2);
  for (let i = 0; i < 4; i++) {
    place(
      "shed",
      h.x - h.ux * (30 + i * 9) + px * (28 + (i % 2) * 10),
      h.z - h.uz * (30 + i * 9) + pz * (28 + (i % 2) * 10),
      h.yaw,
      4.4,
      3.8,
      undefined,
      1.4,
    );
  }
  // The perimeter: sandbagged emplacements facing the island, T-wall behind.
  for (let i = 0; i < 5; i++) {
    const t = (i - 2) * 22;
    place("sandbags", h.x + h.ux * 46 + px * t, h.z + h.uz * 46 + pz * t, h.yaw + Math.PI / 2, 8, 2.4, { length: 7 }, 1.0);
  }
  for (let i = 0; i < 4; i++) {
    const t = (i - 1.5) * 26;
    place("blastWall", h.x - h.ux * 58 + px * t, h.z - h.uz * 58 + pz * t, h.yaw + Math.PI / 2, 14, 2.2, { length: 12 }, 1.2);
  }
  must("watchtower", h.x + h.ux * 22 + px * -44, h.z + h.uz * 22 + pz * -44, 0, 7, 7, undefined, 2);
  for (let i = 0; i < 6; i++) {
    place("crates", h.x + rand(-58, 58), h.z + rand(-52, 52), rand(0, Math.PI * 2), 4, 3.6, undefined, 1.2);
  }
  for (let i = 0; i < 3; i++) {
    place("barrier", h.x + h.ux * 74 + px * ((i - 1) * 9), h.z + h.uz * 74 + pz * ((i - 1) * 9), h.yaw, 7, 2, { length: 6 }, 1.0);
  }
  place("lamp", h.x + h.ux * 40 + px * 16, h.z + h.uz * 40 + pz * 16, 0, 2.2, 2.2, undefined, 1.0);
}

/**
 * Where the OUTER coast's waterline is on a bearing out of the middle of the
 * map, and how deep it is a given distance further out.
 *
 * `coastRadius` is the nominal shore and the real one is about ten metres
 * outside it, because `shoreProfile` hands over at 0.8 m rather than at zero —
 * the same twenty-five-metre lie `bayShore` exists to correct, one third the
 * size. Two functions rather than one because a slipway wants both: the shed
 * stands on the strand and the jetty stands in the water.
 */
function coastShore(t) {
  const ux = Math.cos(t);
  const uz = Math.sin(t);
  const at = (r) => heightAt(ux * r, uz * r);
  let wet = coastRadius(t) + 120;
  let dry2 = Math.max(40, coastRadius(t) - 200);
  if (at(wet) > SEA || at(dry2) <= SEA) return null;
  for (let i = 0; i < 40; i++) {
    const m = (wet + dry2) / 2;
    if (at(m) <= SEA) wet = m;
    else dry2 = m;
  }
  return { r: wet, x: ux * wet, z: uz * wet, t };
}

// --- the landings' slipways --------------------------------------------------

section(placements, "the two slipways");
placements.push(
  "  // A boat shed, a jetty and a hand winch on the strand below each landing,",
  "  // reached down the beach from the yard behind it.",
  "  //",
  "  // **THERE IS NO BOAT IN THIS GAME AND THESE ARE NOT WAITING FOR ONE.** A",
  "  // slipway is what a landing on a coast has, in the same way the gatehouse",
  "  // and the blast walls are what a landing on a road has, and both yards had",
  "  // their backs to the sea without one. What it also does — and this is the",
  "  // reason it is worth writing down — is put the QUESTION a boat would have",
  "  // to answer somewhere a reader can see it: each of these stands about a",
  "  // hundred and thirty metres off its own yard on open water, team 1 is",
  "  // seven hundred metres up the coast from the mouth of the bay and team 0",
  "  // is most of the way round the island from it. That asymmetry is real and",
  "  // it is the first thing a gunboat would have to be laid out against.",
);
for (const h of HOMES) {
  const t = Math.atan2(h.z, h.x);
  const shore = coastShore(t);
  if (!shore) continue;
  const ux = Math.cos(t);
  const uz = Math.sin(t);
  const seaward = faceRot("boathouse", ux, uz);
  const sx = ux * (shore.r - 13);
  const sz = uz * (shore.r - 13);
  place("boathouse", sx, sz, seaward, 12, 14, undefined, 1.6);
  // The jetty by DEPTH, exactly as the harbour's are: `buildJetty` stands its
  // deck 0.57 m over the ground under it and `CONFIG.nav.stepHeight` is 0.6, so
  // a jetty over 28 cm of water links to the strand along its whole length and
  // one three metres further out is a surface in the air. Bisected rather than
  // stepped, because the outer shelf falls fast enough that a 3 m stride
  // overshoots the band `lift` will accept.
  let shallow = 0;
  let deep = 60;
  for (let i = 0; i < 32; i++) {
    const m = (shallow + deep) / 2;
    if (heightAt(ux * (shore.r + m), uz * (shore.r + m)) > -0.28) shallow = m;
    else deep = m;
  }
  place("jetty", ux * (shore.r + deep), uz * (shore.r + deep), t + Math.PI / 2, 4, 24, { length: 22 }, 1.2, -0.34);
  place("crates", ux * (shore.r - 26) - uz * 12, uz * (shore.r - 26) + ux * 12, t, 4, 3.6, undefined, 1.2);
  place("woodpile", ux * (shore.r - 24) + uz * 14, uz * (shore.r - 24) - ux * 14, t, 6, 2.2, { length: 5 }, 1.0);
  // A hull on the hard beside each slip, which is what says the shed is a shed
  // and not a hut with a ramp in front of it.
  place(
    "careenedHull",
    ux * (shore.r - 20) - uz * 24,
    uz * (shore.r - 20) + ux * 24,
    t + Math.PI / 2,
    5,
    13,
    { length: 11 },
    1.0,
  );
}

// --- the outskirts -----------------------------------------------------------

section(placements, "the outskirts");
placements.push(
  "  // Crofts, ruins and two lights, thinning out toward the coast. It is",
  "  // deliberately BARER than the middle: what the thinning buys is a cue",
  "  // the HUD cannot give, because the dressing running out is the first",
  "  // thing you notice about leaving, a beat before the leash starts",
  "  // counting. Nothing at all is authored outside the play square.",
);

/** A point `inset` metres inside the OUTER shoreline on a bearing. */
function onCoast(t, inset) {
  const r = coastRadius(t) - inset;
  return [Math.cos(t) * r, Math.sin(t) * r];
}

// Two lights on two seaward points, which are what a boat coming in would
// steer by and what a player crossing the open shelf navigates by at night.
// Their positions are taken FROM the coast function rather than authored
// against it: a landmark whose whole job is to stand at the water's edge is
// one that has to move when the water's edge does.
must("watchtower", ...onCoast(1.62, 40), 0, 7, 7, undefined, 2);
must("watchtower", ...onCoast(Math.PI * 0.94, 34), 0, 7, 7, undefined, 2);

/**
 * THE MOUTH LIGHT, on the south cape at the end of the cape lane.
 *
 * **The cape lane already went to "the light on the mouth" and there was no
 * light on the mouth** — the comment on that road has said so since it was
 * written and what stood there was one more timber watchtower. This is the
 * one, and it is the piece that makes the whole southern half of the map
 * legible at night: the bay's entrance is 260 m wide and unmarked, and from
 * anywhere on the shelf or the water the only thing telling you where the
 * island ends was the fog.
 *
 * Placed FROM the coast function rather than against it, the rule the two
 * watchtowers above already obey: a landmark whose whole job is to stand at
 * the water's edge has to move when the water's edge does.
 */
{
  const t = 0.31;
  must(
    "lighthouse",
    ...onCoast(t, 30),
    faceRot("lighthouse", -Math.cos(t), -Math.sin(t)),
    13,
    24,
    undefined,
    2,
  );
}

/**
 * The roadside farms.
 *
 * **A croft is put where a road goes past it**, which is the one rule that
 * turns scattered dressing into country. What stood here was a jittered
 * lattice over the whole shelf: the right NUMBER of buildings, none of them
 * connected to anything, and four hundred metres of road with nothing along
 * it — the same mistake the town centre was making, one scale up. Each
 * arterial is walked at a stride, a holding is set back off it on alternating
 * sides, and the lattice below is left to do what it is actually good at,
 * which is thinning out toward the coast.
 */
let crofts = 0;
for (const pts of TRACKS) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    // Closer together than they were. What used to fill the country between
    // the holdings was the free lattice below, and the lattice now needs a
    // lane within `ROAD_REACH` — so a road that carries more of them is the
    // honest way to keep the outskirts populated, and it puts what it carries
    // where somebody walking the road will actually pass it.
    for (let t = 40; t < len - 30; t += rand(46, 80)) {
      const side = chance(0.5) ? 1 : -1;
      const off = rand(30, 44) * side;
      const x = ax + ux * t - uz * off;
      const z = az + uz * t + ux * off;
      if (!dry(x, z, 1.6)) continue;
      if (grade(x, z) > 0.15) continue;
      if (!free(x, z, 34, 34, 4)) continue;
      // Square to the road, and facing it: a farm on a road has its door on
      // the road, exactly as a house on a street does.
      croft(x, z, Math.atan2(side * uz, side * ux) + Math.PI / 2);
      crofts++;
    }
  }
}

// …and the lattice, out where there is no road at all. It is thinner than it
// was and it is what the thinning CUE is made of — the dressing running out is
// the first thing you notice about leaving, a beat before the leash starts
// counting.
for (let gz = -648; gz <= 648; gz += 56) {
  for (let gx = -648; gx <= 648; gx += 56) {
    const x = gx + rand(-22, 22);
    const z = gz + rand(-22, 22);
    if (!dry(x, z, 1.6)) continue;
    if (grade(x, z) > 0.16) continue;
    if (Math.hypot(x - BAY.x, z - BAY.z) < 420) continue;
    // **A HOLDING WITH NO LANE TO IT IS NOT A HOLDING.** The lattice used to
    // sow the whole outer shelf regardless, which put nine houses on the north
    // coast and the cone's apron three hundred metres from any carriageway —
    // the exact failure the assertion at the bottom of this file now refuses
    // to write. Testing it HERE rather than only asserting it is what makes
    // the thinning cue honest: the dressing runs out where the roads do.
    if (roadDist(x, z) > ROAD_REACH) continue;
    if (!chance(0.62)) continue;
    if (!free(x, z, 30, 30, 4)) continue;
    croft(x, z);
    crofts++;
  }
}

// The ruined crofts on the cone's own flank: the ash got here first, and this
// is the ground the map is named for.
for (let i = 0; i < 14; i++) {
  const a = rand(0, Math.PI * 2);
  const r = rand(300, 470);
  const x = V.x + Math.cos(a) * r;
  const z = V.z + Math.sin(a) * r;
  if (!dry(x, z, 1.6) || grade(x, z) > 0.3) continue;
  place("ruin", x, z, rand(0, Math.PI * 2), 11, 9, { width: randInt(8, 12), depth: randInt(7, 9) }, 2.4);
}

// --- the scatter -------------------------------------------------------------

/**
 * One region of dressing.
 *
 * **The ORDER of this array is load-bearing.** Every region draws from one
 * seeded stream in array order (`MapBuilder.scatterRegion`), so a region added
 * anywhere but the end re-rolls every field below it — which is a visible
 * change to the level with nothing in the diff to point at it.
 */
function scat(prop, x, z, count, o = {}) {
  const bits = [`prop: "${prop}"`, `x: ${n2(x)}`, `z: ${n2(z)}`];
  if (o.radius !== undefined) bits.push(`radius: ${n2(o.radius)}`);
  else {
    bits.push(`width: ${n2(o.width)}`, `depth: ${n2(o.depth)}`);
    if (o.rotY !== undefined) bits.push(`rotY: ${n2(o.rotY)}`);
  }
  bits.push(`count: ${count}`);
  if (o.scale) bits.push(`scale: [${n2(o.scale[0])}, ${n2(o.scale[1])}]`);
  if (o.clearance !== undefined) bits.push(`clearance: ${n2(o.clearance)}`);
  if (o.blocking) bits.push("blocking: true");
  scatter.push(`  { ${bits.join(", ")} },`);
}

section(scatter, "the lava field - the cone's own flank");
scatter.push(
  "  // Blocks and clinker over the mountain's skirt, thickest where the flow",
  "  // stopped. `boulder` is the only prop in the table sized UP — a 2.26 m",
  "  // shape before the builder's own stretch — which is what makes a field",
  "  // of them cover a body rather than a boot.",
);
for (let i = 0; i < 6; i++) {
  const a = -1.05 + i * 0.4;
  const bx = V.x + Math.cos(a) * 330;
  const bz = V.z + Math.sin(a) * 330;
  // The north-west flank runs into the sea as a cliff, so a field laid at a
  // fixed radius off the summit puts its western end in the water. It always
  // did, on every version of this map; nothing said so until the dry test at
  // the bottom of this section.
  if (!dry(bx, bz, 1.2)) continue;
  scat("boulder", bx, bz, 34, {
    radius: 92,
    scale: [0.7, 1.5],
    clearance: 6.5,
    blocking: true,
  });
}
scat("rubble", V.x + 170, V.z + 250, 60, { radius: 130, scale: [0.8, 1.5], clearance: 4.2, blocking: true });
scat("rubble", V.x + 250, V.z + 60, 48, { radius: 110, scale: [0.8, 1.4], clearance: 4.2, blocking: true });

section(scatter, "the ash moor - dead ground between the works and the bay");
for (const [mx, mz, cnt, rad] of [
  [-250, 60, 30, 110],
  [-300, -180, 26, 100],
  [-210, -70, 24, 96],
  [-500, 150, 28, 104],
]) {
  scat("deadTree", mx, mz, cnt, { radius: rad, scale: [0.8, 1.3], clearance: 8, blocking: true });
}
for (const [mx, mz, cnt, rad] of [
  [-230, 150, 40, 118],
  [-330, -30, 36, 112],
  [-160, -190, 34, 100],
  [-560, 260, 30, 100],
]) {
  scat("bramble", mx, mz, cnt, { radius: rad, scale: [0.8, 1.4], clearance: 3.2 });
}

section(scatter, "the wind-bent pines of the two arms");
// **Not on the salt flat.** The belt that used to stand at (60, 510) is now
// SALTHOUSES' pans, and a scatter region is an extent: what it produced was
// nine wind-bent pines growing out of a brine pond, which is the same class of
// mistake `assertScatterDry` catches one step further out to sea.
for (const [px2, pz2] of [[-380, 470], [-206, 462], [212, 452], [330, 500], [470, 400]]) {
  scat("pine", px2, pz2, 28, { radius: 96, scale: [0.7, 1.15], clearance: 9, blocking: true });
}
scat("pine", 540, -230, 24, { radius: 90, scale: [0.7, 1.1], clearance: 9, blocking: true });
scat("pine", 300, -420, 26, { radius: 94, scale: [0.7, 1.1], clearance: 9, blocking: true });

section(scatter, "the strand - drift, boulders and wrack");
scatter.push(
  "  // Laid along the OUTER coast rather than over it: a region is filed under",
  "  // the map block its CENTRE falls in, so a belt longer than the fog wall is",
  "  // broken into pieces. These sit on the strand, which is the one metre of",
  "  // ground between the shelf's edge and the shore — and each one is DRY-",
  "  // TESTED, because the mouth of the bay is open coast for sixty degrees",
  "  // and a bearing that lands in it is a field of boulders at sea.",
);
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  const r = coastRadius(a) - 30;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  if (!dry(x, z, 0.4)) continue;
  scat("boulder", x, z, 14, { radius: 56, scale: [0.6, 1.25], clearance: 6, blocking: true });
}
for (let i = 0; i < 10; i++) {
  const a = 0.31 + (i / 10) * Math.PI * 2;
  const r = coastRadius(a) - 34;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  if (!dry(x, z, 0.4)) continue;
  scat("log", x, z, 12, { radius: 60, scale: [0.7, 1.2], clearance: 4 });
}

section(scatter, "the harbour and the works - what people left");
scatter.push(
  "  // The quay's own working ground is the BANK between the Strand and the",
  "  // water — the slips, the sheds and the wall are on it — so that is where",
  "  // the barrels and the pallets are, in a belt along it rather than over",
  "  // the streets behind. What is on the streets is litter. Both belts are",
  "  // placed off `inland`, exactly as the sheds and the lamps are.",
);
for (const [t, prop, n, w] of [
  [0.25, "barrel", 12, 130],
  [0.7, "barrel", 12, 130],
  [0.35, "palletStack", 8, 110],
  [0.66, "palletStack", 8, 110],
]) {
  const a = along(QUAY_ARC, t);
  const p = inland(a, 14);
  if (p) scat(prop, p[0], p[1], n, { width: w, depth: 20, rotY: a, clearance: prop === "barrel" ? 2.4 : 3 });
}
{
  const p = inland(along(QUAY_ARC, 0.5), 46);
  if (p) scat("litter", p[0], p[1], 40, { width: 240, depth: 70, rotY: along(QUAY_ARC, 0.5), clearance: 1.4 });
}
scat("barrel", D.x, D.z, 18, { radius: 78, clearance: 2.6 });
scat("rubble", D.x + 40, D.z - 30, 22, { radius: 74, scale: [0.7, 1.2], clearance: 4, blocking: true });
// The smelter's own spoil, banked along the flank of the hall. A works throws
// away more than it makes and that is most of what makes one look like a works
// rather than a big shed.
scat("rubble", D.x + 46, WORKS_N + 6, 26, { radius: 46, scale: [0.8, 1.4], clearance: 4, blocking: true });
scat("barrel", D.x - 44, WORKS_N - 4, 12, { radius: 34, clearance: 2.6 });
scat("palletStack", D.x + 6, WORKS_N + 26, 10, { radius: 30, clearance: 3.4 });
scat("litter", E.x, E.z, 26, { radius: 92, clearance: 1.6 });
// SALTHOUSES: the working ground round the pans, and the litter of the hamlet
// behind them. `crates` and `barrel` because what a salt works ships is dry
// goods in casks, and a bare flat with nothing on it reads as unfinished
// ground rather than as somewhere people work.
scat("barrel", 30, 512, 14, { width: 210, depth: 22, rotY: -0.053, clearance: 2.4 });
scat("palletStack", -60, 540, 8, { radius: 30, clearance: 3.4 });
scat("litter", 60, 470, 22, { radius: 76, clearance: 1.6 });
{
  const p = inland(along(NET_ARC, 0.5), 16);
  if (p) scat("barrel", p[0], p[1], 16, { radius: 84, clearance: 2.4 });
}

section(scatter, "the fire drums - four lights and no more");
scatter.push(
  "  // A `fireDrum` carries a `LocalLight` (`SCATTER_LIGHTS`), so a field of",
  "  // them is a field of shader slots. Four regions of one each: two on the",
  "  // quay, one on the bay road at the head of the harbour and one on the",
  "  // works' platform. Everything else that glows on this map is emissive",
  "  // geometry, which costs nothing and lights nothing.",
);
for (const [t, i] of [[0.1, 20], [0.9, 20]]) {
  const p = inland(along(QUAY_ARC, t), i);
  if (p) scat("fireDrum", p[0], p[1], 1, { radius: 5, clearance: 3 });
}
{
  const p = inland(3.14, 26);
  if (p) scat("fireDrum", p[0], p[1], 1, { radius: 5, clearance: 3 });
}
scat("fireDrum", D.x + 46, D.z - 6, 1, { radius: 5, clearance: 3 });

section(scatter, "the churchyard on the rock, and the stones on the moor");
// On the TERRACE and the ground round it, which is where the graveyard is. A
// churchyard scattered down a street is a churchyard nobody buried anyone in.
scat("gravestone", ROCK.x - 36, ROCK.z + 2, 30, { width: 26, depth: 22, clearance: 2.2, blocking: true });
scat("gravestone", ROCK.x - 56, ROCK.z - 24, 16, { radius: 20, clearance: 2.4, blocking: true });
// These used to include one at (180, 180), which is now the middle of the bay:
// a scatter region is an extent and nothing in `findSpot` has heard of the
// sea, so seven standing stones stood up to their waists in the harbour. That
// is what `assertScatterDry` below exists to catch.
for (const [sx2, sz2] of [[-470, -260], [-540, 100], [430, -430]]) {
  scat("carvedStele", sx2, sz2, 7, { radius: 46, scale: [0.9, 1.4], clearance: 11, blocking: true });
}

/**
 * **NOTHING IS SOWN IN THE SEA**, proved rather than eyeballed.
 *
 * A `ScatterSpec` is an extent and `MapBuilder.findSpot` has never heard of a
 * coastline, so a region whose centre drifted over the water sows props on the
 * sea bed — standing in it up to their waists, drawn, collidable, and silent
 * about it. On a map that is 40% water and whose shoreline moves whenever the
 * floor does, that is not a mistake you make once.
 *
 * The threshold is a FRACTION rather than zero because several of these belts
 * are meant to hug the shore: the strand's drift is laid along the coast on
 * purpose and a third of a circle centred on the waterline is water by
 * construction. Half is the line between "a beach" and "a mistake".
 */
const soggy = [];
for (const line of scatter) {
  const m = /prop: "(\w+)", x: (-?[\d.]+), z: (-?[\d.]+)(?:, radius: ([\d.]+))?(?:, width: ([\d.]+), depth: ([\d.]+))?/.exec(line);
  if (!m) continue;
  const [, prop, sx, sz, rad, w, d] = m;
  const cx = Number(sx);
  const cz = Number(sz);
  let wet = 0;
  let n = 0;
  for (let j = -3; j <= 3; j++) {
    for (let i = -3; i <= 3; i++) {
      const x = cx + (rad ? (Number(rad) * i) / 3 : (Number(w ?? 0) * i) / 6);
      const z = cz + (rad ? (Number(rad) * j) / 3 : (Number(d ?? 0) * j) / 6);
      if (rad && Math.hypot(x - cx, z - cz) > Number(rad)) continue;
      n++;
      if (heightAt(x, z) <= SEA) wet++;
    }
  }
  if (n && wet / n > 0.5) soggy.push(`${prop} at (${cx}, ${cz}) is ${Math.round((100 * wet) / n)}% under water`);
}
if (soggy.length) {
  throw new Error(
    `scatter: ${soggy.length} regions are mostly sea — ${soggy.join("; ")}. A ` +
      "region is an extent and `findSpot` has never heard of the coastline, so " +
      "what these sow is props standing in the water.",
  );
}

/** The sea's rects, as the lines the layout states them on. See `WATER`. */
const waterLines = WATER.map(
  (r) =>
    `  // ${r.n}.\n  { x: ${n2(r.x)}, z: ${n2(r.z)}, width: ${n2(r.width)}, ` +
    `depth: ${n2(r.depth)}, y: 0 },`,
);

const grass = [
  "  // The southern shelf, out of the wind and off the ash — in two pieces",
  "  // with SALTHOUSES' pans between them, because a salt flat with grass",
  "  // growing through it is a salt flat nobody works. `buildSaltPan`'s coping",
  "  // is drawn and not collided, so nothing else on this map holds a tuft off",
  "  // one: the gap in this list is the whole of the mechanism.",
  "  { x: -170, z: 495, width: 250, depth: 125, density: 0.14 },",
  "  { x: 300, z: 470, width: 250, depth: 120, density: 0.12 },",
  "  // The western moor, and the ash ground between the works and the bay.",
  "  { x: -540, z: 140, width: 190, depth: 240, density: 0.1 },",
  "  { x: -260, z: 40, width: 170, depth: 150, density: 0.07 },",
  "  // The north arm, under the pines.",
  "  { x: 380, z: -340, width: 220, depth: 170, density: 0.09 },",
  "  // The churchyard on the rock, which is the one place on this island that",
  "  // anything is kept.",
  `  { x: ${n2(ROCK.x - 36)}, z: ${n2(ROCK.z + 2)}, width: 76, depth: 64, density: 0.3 },`,
];

// --- the flags and their spawns ----------------------------------------------

const NAMED = FLAGS.map(
  (f) =>
    `  { id: "${f.id}", name: "${f.name}", ` +
    `pos: new Vector3(${n2(f.x)}, ${n2(Number(heightAt(f.x, f.z).toFixed(2)))}, ${n2(f.z)}), ` +
    `radius: ${f.r} },`,
);

/**
 * A spawn just outside each capture zone, so deploying onto a flag you hold
 * does not drop you on top of whoever is contesting it.
 *
 * The bearing is authored per flag rather than derived: it faces the way the
 * ground is, not the way the middle of the map is — off the rock toward its
 * own slip, off the works down the haul road, off the quay along the Strand.
 *
 * **Both refusals name the bearings that WOULD have worked**, which turns what
 * used to be a dozen runs of guessing into one. These are computed LAST, so
 * unlike every other claimed thing on this map they are laid over a town that
 * is already built: a bearing that pointed at open shelf when it was written
 * points at somebody's frontage now, and neither the sea nor a house says so
 * in a screenshot.
 */
const FLAG_SPAWN_DIRS = {
  A: 2.36,
  B: 1.57,
  // Turned off due south when the rock light replaced the watchtower: a
  // lighthouse has a keeper's cottage at its foot and a bigger base under it,
  // and the old bearing put the spawn inside both.
  C: 2.36,
  D: 0,
  E: 1.57,
};
/** Every bearing that would place `f`'s spawn on open dry ground. */
function spawnBearings(f) {
  const ok = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2 - Math.PI;
    const x = f.x + Math.cos(a) * (f.r + 12);
    const z = f.z + Math.sin(a) * (f.r + 12);
    if (dry(x, z, 0.6) && openGround(x, z, 4, 4)) ok.push(a.toFixed(2));
  }
  return ok.length ? ok.join(", ") : "NONE — the flag has no clear ground round it at all";
}
const FLAG_SPAWNS = FLAGS.map((f) => {
  const a = FLAG_SPAWN_DIRS[f.id];
  const x = f.x + Math.cos(a) * (f.r + 12);
  const z = f.z + Math.sin(a) * (f.r + 12);
  if (!dry(x, z, 0.6)) {
    throw new Error(
      `flag spawn: ${f.id}'s spawn at (${x.toFixed(0)}, ${z.toFixed(0)}) is in ` +
        `${(SEA - heightAt(x, z)).toFixed(2)} m of water. Turn FLAG_SPAWN_DIRS.${f.id} ` +
        `to one of: ${spawnBearings(f)}`,
    );
  }
  // **And that it is not inside a HOUSE**, which is a check these spawns did
  // not have and now need. They are computed last, so unlike every other
  // claimed thing on this map they are laid over a town that is already built:
  // a bearing that used to point at open ground now points at a frontage, and
  // a body deploying inside a collider is a body that cannot move.
  if (!openGround(x, z, 4, 4)) {
    throw new Error(
      `flag spawn: ${f.id}'s spawn at (${x.toFixed(0)}, ${z.toFixed(0)}) stands ` +
        "in something already built. A street or a square is right (they claim " +
        `SOFT) and a house is a body deployed inside a collider. Turn ` +
        `FLAG_SPAWN_DIRS.${f.id} to one of: ${spawnBearings(f)}`,
    );
  }
  claim(x, z, 8, 8);
  return (
    `  { team: null, controlPoint: "${f.id}", ` +
    `pos: new Vector3(${n2(x)}, ${n2(Number(heightAt(x, z).toFixed(2)))}, ${n2(z)}), ` +
    `yaw: ${n2(Math.atan2(f.x - x, f.z - z))} },`
  );
});

// --- emit --------------------------------------------------------------------

mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "heights.ts"),
  `/**
 * cinderhaven/heights.ts — GENERATED by \`scripts/generate-cinderhaven.mjs\`
 * (\`npm run cinderhaven\`), and editable afterwards with the map editor's
 * terrain mode (F2, then T). Do not hand-edit: both the script and the editor
 * rewrite this file wholesale.
 *
 * The floor of the volcanic island — one height per grid vertex, row-major
 * from the -X/-Z corner. It lives apart from \`layout.ts\` on purpose: that
 * file is authored and patched line by line by the editor, and sixty-three
 * thousand bare numbers have no business in it. It does not TRAVEL with it
 * either — \`MapDef.heights\` is a lazy \`import()\` beside \`MapDef.collision\`,
 * so this file is a chunk of its own and reaches a browser only when this map
 * is built. At this extent that is the whole reason S7 exists: ${row}x${row}
 * vertices is the largest floor in the tree.
 *
 * ${CELLS}x${CELLS} cells of ${CELL} m over the ${PLAY} m play square, so ${row}x${row} vertices.
 * \`size * cell\` must equal \`MapLayout.size\`; see \`Heightfield.cell\`.
 *
 * **ON THIS MAP THE FLOOR IS THE LEVEL, which is true of no other map here.**
 * Everywhere else the ground is what a town stands on; here it decides what is
 * land at all, where the sea goes, which slopes can be walked and which sever
 * themselves. It is five passes laid over one another IN ORDER (\`heightAt\` in
 * the generator, where the order is the argument): the COAST, a harmonic
 * shoreline with a headland at each landing and a wadeable shelf outside it;
 * the CONE, added under a mask cut by that same coast, so Grimhold rises
 * straight out of the water as a sea cliff on the north-west; CINDER BAY cut
 * through both of them — a basin 600 m across and a mouth half that, which is
 * what bends the island into a C; CHAPEL ROCK raised in the middle of the bay
 * AFTER the cut, because a rock raised before it is a rock the cut flattens;
 * and the districts and two landings flattened DEAD LEVEL inside their own
 * cores, because a placement samples the ground once at its centre and a
 * building on a grade floats at one corner.
 *
 * **THE WHOLE BAY IS WADEABLE — 2.6 m at its deepest** — and that is a design
 * decision rather than a limitation of the terrain. There is no swimming in
 * this engine, so a shelf a player walks off into eight metres of water is a
 * pit with a back-face-culled lid on it; at chest height the bay is a slow,
 * exposed four-hundred-metre crossing instead, the nav graph links clean
 * across it, and the flag on the rock in the middle can be reached on foot
 * from either shore. The generator proves that last part rather than asserting
 * it: the flood fill has never heard of water, so C being reachable IS the
 * proof that the bed links.
 *
 * **THE FORESHORE IS AS LONG AS THE GROUND BEHIND IT IS HIGH** (\`FORE_PER_M\`),
 * which is the one line that let a bay be cut into a volcano. Eighty metres of
 * beach suits the 10 m interior shelf; the same eighty under Grimhold's 26 m
 * apron is a 0.47 gradient and five hundred cells of severed shoreline. Twelve
 * metres of run per metre of fall holds the peak at 0.13 everywhere — the ramp
 * is a smoothstep, so its peak is 1.5 times its average of one in twelve — so
 * the town gets about 120 m of beach and the mountain runs into the
 * \`FORE_MAX\` cap.
 *
 * **Two bands of this grid are steeper than \`MAX_WALKABLE_GRADE\` and both are
 * deliberate** — the cone above the works, so that nobody holds the highest
 * ground on a 1,500 m map, and the north-west sea cliffs. The generator proves
 * that every OTHER steep land edge is a bug and refuses to write one, and then
 * floods the finished floor to prove that all five flags and both landings can
 * still be walked to and that the summit cannot.
 *
 * **The shorelines are what \`MapLayout.water\` is measured against**, so a hand
 * edit here moves every coast on the island: \`WaterSystem\` bakes its bed-depth
 * map off this grid and off nothing else — and on this map it moves the TOWN
 * too, because every jetty, boat shed, quay wall and waterfront road is placed
 * by asking the floor where the water stopped.
 *
 * The steepest single-cell step on LAND is ${worstStep.toFixed(2)} m over ${CELL} m. The ground
 * runs from ${lo.toFixed(2)} m on the sea floor to ${hi.toFixed(2)} m on Grimhold's rim;
 * ${landKm2.toFixed(2)} km² of it is dry and ${seaKm2.toFixed(2)} km² is navigable water, of which
 * ${bayKm2.toFixed(2)} km² is the bay itself.
 */
import type { Heightfield } from "../layout";

export const CinderhavenHeights: Heightfield = {
  size: ${CELLS},
  cell: ${CELL},
  // Row-major, +Z per row.
  heights: [
${heightRows.join("\n")}
  ],
};

// Default too, because \`MapDef.heights\` is a lazy \`import()\` and a default is
// the one export name a generic signature can be written against.
export default CinderhavenHeights;
`,
);

const placementCount = placements.filter((l) => l.includes("{ kind:")).length;
const scatterCount = scatter.filter((l) => l.includes("{ prop:")).length;

writeFileSync(
  join(out, "layout.ts"),
  `/**
 * cinderhaven/layout.ts — GENERATED by \`scripts/generate-cinderhaven.mjs\`
 * (\`npm run cinderhaven\`), then owned by the editor exactly as every other
 * layout in the tree is: flat arrays of one-line entries, which is what
 * \`src/editor/sourceScan.ts\` requires, so F2 opens it and Ctrl+S patches an
 * entry in place. **Re-running the generator discards those edits.**
 *
 * ## Cinderhaven: a harbour town on a volcanic island, at night
 *
 * **The biggest map in the tree — a ${PLAY} m play square inside ${PLAY + 2 * MARGIN} m of ground and
 * ${OCEAN * 2} m of sea**, ${(((PLAY * PLAY) / (900 * 900))).toFixed(1)} times Sarab's playable area. What keeps it a FIGHT rather than a
 * walk is that only ${landKm2.toFixed(2)} km² of it is dry: ${seaKm2.toFixed(2)} km² of the square is
 * water, so the ${24 * 2} bodies on the field are spread over land, not over the
 * square. That is the number to compare against Sarab's 0.81 km², and the
 * reason this map states \`perTeam: 24\` for the same reason Sarab does — a
 * round is made of CONTACT, and contact is bodies per square metre of the
 * ground people can actually stand on.
 *
 * ### The island is a C, and CINDER BAY is what bends it
 *
 * **${bayKm2.toFixed(2)} km² of sheltered water inside the island**, a basin six hundred
 * metres across with a mouth 260 m wide, and two arms of land
 * curling round it: the north arm from Grimhold's flank out to team 1's
 * headland, the south arm along the shelf to the cape and the light. The mouth
 * is what makes it a C rather than a bite — a bay as open as it is deep is a
 * shape you can see the whole of from outside, and this one you have to go
 * into.
 *
 * **What stood here was a REACH** — a drowned valley 400 m by 280 cut in from
 * the east coast, with the town on its two banks and exactly one ford across
 * it — and it was a river with a harbour on it rather than a harbour. Half the
 * old layout existed to make that ford matter: the north half and the south
 * half of the island met at one place on foot and nowhere at all in the seven
 * hundred metres between it and the sea. A bay divides nothing. It is a hole
 * with a continuous rim, the rim is the bay road, and what crosses the middle
 * is the WADE.
 *
 * **THE WHOLE BAY IS WADEABLE — 2.6 m at the deepest** — and that is the
 * decision the rest of the map is built on. There is no swimming in this
 * engine, so a shelf you walk off into eight metres of water is a pit with a
 * lid on it; at chest height the bay is a slow, exposed, four-hundred-metre
 * crossing with no cover on it at all, the nav graph links clean across, and
 * the flag in the middle of it can be taken on foot from either shore today.
 * The generator proves that rather than asserting it — its flood fill has
 * never heard of water, so C being REACHABLE is the proof that the bed links.
 *
 * ### The five flags
 *
 * - **A, The Quay** — the working waterfront on the bay's south-western shore.
 *   The Strand runs along the lip of the quay wall with the slips, the sheds
 *   and the jetties on the bank below it; behind it are five blocks by three of
 *   cobbled streets **turned to the shore rather than to the compass**, which
 *   is the first quarter in the tree that is. The harbour square is the middle
 *   of the front row, so the flag stands on paving with the water across the
 *   road. Bonded warehouses, a customs row with the only breakable glass on the
 *   island, the tavern and TWO QUAY CRANES stand on the Strand, with two hulls
 *   up on the hard at either end of the bank.
 * - **B, Cinder Steps** — the old town on the shelf, up the Steps road from the
 *   harbour. **Its lanes are 2.8 m and the houses stand on them**, which leaves
 *   5.2 m between two rows of doors: a gun truck takes that at speed
 *   (\`drive.collideRadius\` 1.6) and a tank does not fit down it at all (2.2),
 *   so the trade the two hulls exist for is bought with a street width rather
 *   than with any rule that knows a vehicle exists. What the tank has is the
 *   7 m ring road round the outside and the two cross streets.
 * - **C, Chapel Rock** — **the island in the middle of the bay**, and the only
 *   flag here with no road to it. A lava plug with an 88 m dead-level crown
 *   carrying a chapel, a graveyard terrace, a ruin, four cottages and the ROCK
 *   LIGHT — a lighthouse rather than the watchtower that used to stand in for
 *   one, and the only thing on this map able to see both waterfronts. It is
 *   reached by wading, from either shore, about a hundred and seventy metres of
 *   open water each way — and it is the obvious thing for a boat to change.
 * - **D, The Ashworks** — four yards on a crossroads high on Grimhold's flank,
 *   with the flag at the crossing, and **THE CINDERWORKS standing over it**.
 *   The smelter is the map's landmark: a hollow ore hall with a cart arch a
 *   tank drives through, a furnace block whose three tap arches are the one
 *   light on this hillside, a FORTY-METRE STACK — the tallest thing on the
 *   island by fourteen metres, and what the northern half of the map is
 *   navigated by from anywhere on the water — and a charging deck six metres
 *   over the yard, reached by one stone flight and railed on the outboard
 *   edge. It stands ninety metres up the works' own north street rather than
 *   on the flag, so that the stack is what closes the view from the crossing.
 *   Round it: two sulphur kilns, silos, the bonded store, the ore barn and the
 *   loading platform at the head of the haul road, and the ASH TRACK, which is
 *   the second way in and the reason holding the crossroads is no longer
 *   holding the flag.
 * - **E, Netstrand** — the fishing hamlet on the bay's north-eastern shore,
 *   turned to its own water the other quarter-turn from the quay, so the two
 *   waterfronts face each other across five hundred metres of open harbour with
 *   the rock in the middle of it. Its net sheds, its slip crane, its two hulls
 *   and its DRYING RACKS are on the beach; a quarter of the hamlet is net
 *   lofts, which is the building the whole waterfront is kept in.
 *
 * ### …and the sixth settlement, which is not a flag
 *
 * **SALTHOUSES**, on the coast road halfway between the quay and the cape.
 * The southern shelf is the largest single piece of level ground on the island
 * and it carried a road, a dozen scattered crofts and nothing else — which is
 * the shape of somewhere a player walks OVER rather than through. What makes
 * this a place rather than more crofts is that it has a reason: there is no
 * river on a lava island and nothing on the shelf to farm, so what flat ground
 * behind a strand is worth having is the salt. Six pans on the low flat
 * seaward of the road, the racks and the sheds in the lane between, the store
 * and the smithy on the frontage, three by two blocks of houses behind. It is
 * the third industry on this map after the fish and the sulphur, and the only
 * one that explains a village standing where nothing grows.
 *
 * ### The town is a NETWORK, and the houses are arranged against it
 *
 * Eleven arterials carry the island — the Strand along the harbour, the Steps
 * up to the old town, the BAY ROAD right round the inside of the C, the haul
 * road, the coast road along the whole southern shelf, the shore lane round the
 * north arm, the NORTH SHORE TRACK over the arm's outside, the MOOR LANE round
 * the western moor, the ASH TRACK along the mountain's toe, the cape lane and
 * one road out of each landing — and every quarter is a grid of its own streets
 * hung off one of them.
 *
 * **The last four of those exist because the coverage was MEASURED.**
 * \`npm run cinderhaven -- --roads\` prints a plan of how far every square of
 * dry, in-play ground is from a carriageway, and it said that the whole western
 * third of the island and the outside of the north arm — a quarter of the land
 * on the map — were over a hundred and fifty metres from any road at all. The
 * generator now REFUSES to write a layout with a dwelling that far off the
 * network, and the free lattice of crofts on the outskirts tests the same
 * distance before it sows one, so the dressing runs out where the roads do
 * rather than nine houses further on. It also refuses a carriageway laid in
 * the sea or up a slope the nav graph severs, which is the same class of bug
 * one layer down: a road is a picture, and it draws over water and over a
 * cliff exactly as happily as over ground. The streets are laid BEFORE the buildings and
 * claim their ground first, so each house can be turned to face the carriageway
 * it stands on: **every door in this town is on a street**, and the yards, the
 * walls and the woodpiles are behind them in the middle of the block.
 *
 * **EVERY ROAD, JETTY, BOAT SHED, QUAY WALL AND LAMP THAT TOUCHES THE WATER IS
 * DERIVED FROM THE WATERLINE**, and none of them states a coordinate on the
 * shore. The generator marches the finished floor outward from the middle of
 * the bay, finds where the ground actually crosses the sea on each bearing, and
 * places against THAT. What is authored is a bearing and a setback, which are
 * the two things that are decisions; the shoreline itself moves whenever the
 * bay's radius, the foreshore's slope or a district's level does, and a
 * waterfront authored against it would be quietly wrong after every one of
 * those changes with nothing in a screenshot to say which.
 *
 * ### Authoring rules this file was written under
 *
 * - **Every placement stands on DRY GROUND**, checked against the floor rather
 *   than eyeballed — the one rule no other layout in the tree needs, because
 *   no other layout has a coastline running through its quarters. The scatter
 *   is checked too, and by area rather than at its centre: a region is an
 *   extent and \`MapBuilder.findSpot\` has never heard of the sea.
 * - **Everything that has a front FACES something.** The kit is drawn facing
 *   its own local -Z (the shophouse and the depot are the two exceptions and
 *   face +Z), so a row with the wrong \`rotY\` on it is a run of blank plaster
 *   or a warehouse with its loading bays to a wall — and nothing in a
 *   screenshot says so.
 * - **Two quarters are turned off the compass** — the quay and Netstrand, each
 *   to its own shore. The claim list holds ORIENTED rectangles, which is what
 *   makes that possible at all: a 200 m street laid along a coast has a
 *   bounding box thirty-nine metres wide and would refuse every house meant to
 *   stand on it.
 * - A SQUARE claims nothing. Its paving is laid over the streets that bound it
 *   and what keeps the middle of it clear is the flag's own ring, which is
 *   what leaves room for the stalls, the lamps and the well.
 * - Compound walls are authored in runs with GAPS. A sealed yard is a plot the
 *   nav flood fill never enters.
 * - Lamps, shrines, kilns, fire drums, the smelter's furnace and each of the
 *   three lighthouse lanterns carry a \`LocalLight\`, and there are sixteen
 *   slots uploaded nearest-first. What is lit is the Strand, the two market
 *   squares, the works and the three headlands; everything else that glows —
 *   the smelter's clerestory and ridge lantern, the ring under its crown, a
 *   net loft's shutters, every lit window in the town — is emissive geometry,
 *   which costs nothing and lights nothing. The works gave up two of its four
 *   kilns to pay for the furnace, and that is the shape of the budget:
 *   anything new that LIGHTS has to say what it is taking the slot from.
 * - The ORDER of the scatter array is load-bearing: every region draws from one
 *   seeded stream, so a region added anywhere but the end re-rolls every field
 *   below it.
 *
 * ${placementCount} placements, ${scatterCount} scatter regions.
 */
import { Vector3 } from "@babylonjs/core";
import type {
  ControlPointDef,
  GrassRect,
  MapLayout,
  Placement,
  ScatterSpec,
  SpawnPointDef,
  VehicleSpawnDef,
  WaterRect,
} from "../layout";

const placements: Placement[] = [
${placements.join("\n")}
];

/**
 * Dressing. A road rejects only what is ROOTED (\`world/roads.ts\`), and the
 * barrels, pallets and litter along the Strand are exactly what belongs on
 * one. Blocking props are held off every flag, spawn and hardstanding by
 * \`MapBuilder.keepClear\`, and the collider each one gets comes from
 * \`PROP_BODIES\` rather than from the clearances here.
 *
 * Nothing on this island is green except the moss. The trees are dead where
 * the ash reached them and wind-bent pines where it did not, and everything
 * else standing up out here is rock the mountain put there.
 */
const scatter: ScatterSpec[] = [
${scatter.join("\n")}
];

const controlPoints: ControlPointDef[] = [
${NAMED.join("\n")}
];

/**
 * Home spawns are uncapturable. Every control point also carries a spawn just
 * outside its capture zone, so deploying onto a flag you hold does not drop
 * you on top of whoever is contesting it. The two landings face each other
 * down the NE-SW diagonal, each on a headland the coast was given for it.
 */
const spawns: SpawnPointDef[] = [
${spawns.join("\n")}
${FLAG_SPAWNS.join("\n")}
];

/**
 * THREE hardstandings a side — a tank, a gun truck and a helicopter — which is
 * also what turns the kit's third slot on (\`Game.armourOffered\`), so this is
 * the map's launcher-and-mine map as well as its vehicle one.
 *
 * **The helicopter is the answer to the BAY.** Five hundred metres of open
 * water separate the two waterfronts and the rock sits in the middle of it: a
 * hull that wants to cross drives most of the way round the bay road, and a
 * body on foot wades it at chest height in the open with no cover at all for
 * four hundred metres. An aircraft goes straight over at 32 m/s and can put
 * two men on the rock. What it pays is what a fast thing always pays: no
 * cannon, a rifle doing 70% of its damage to it against a tank's 5%, a 10.4 m
 * rotor disc that closes the old town's 9 m alleys outright, and a 40 m
 * ceiling that keeps it inside the bots' own 55 m engagement range.
 *
 * **There is no boat here yet and the map is laid out as though there will
 * be.** The bay, its mouth and the sea round the island are ${seaKm2.toFixed(2)} km² of
 * navigable water inside the play square — ${bayKm2.toFixed(2)} km² of it sheltered —
 * with a town on two shores of it, a flag in the middle and a mouth that can
 * be held. Nothing in the layout depends on a boat existing: C is wadeable
 * today, and what a gunboat would add is speed and a gun, not access. That is
 * the right way round — a vehicle that is the only route to an objective is a
 * vehicle whose loss takes the objective with it.
 *
 * The tank is the map's armour and the truck is the trade — 65 km/h against
 * 40 through a 3.2 m gap against 4.4 — and the old town at B is where that
 * trade is spent: a truck takes the lanes a tank has to go round.
 *
 * Every pad stands on a district flattened to 9.4 m, and the two yards are
 * mirror images written against one unit vector (see \`HOMES\` in the
 * generator), which is what makes them equally level rather than equally
 * intended to be.
 */
const vehicles: VehicleSpawnDef[] = [
${vehicles.join("\n")}
];

/**
 * The sea, as EIGHT rectangles that TILE everything out to the horizon — a
 * pinwheel inside a pinwheel rather than a frame round a hole — and the reason
 * they tile is the reflection probe rather than the drawing.
 *
 * **The outer four are the OCEAN and they are what closes this map**, which is
 * the job a rim does everywhere else and the reason this is the one layout in
 * the tree with \`ridge: { form: "none" }\` on it. They run to ${OCEAN} m, which is
 * past \`fogEnd\` from the furthest point anything can reach, so the water's own
 * far edge is exactly \`fogColor\` and the sky above it is a horizon rather than
 * a seam. They cost four quads and four bed textures: no floor is tessellated
 * out there, because at \`CONFIG.water.depthMax\` (1.5 m) the body is opaque and
 * there is nothing under it to see.
 *
 * A \`WaterRect\` is an extent and the BED decides where the shore is, so any
 * partition of the square draws exactly the same coastline. What varies is
 * where the PROBES stand: one per rect, at the depth-weighted centroid of that
 * rect's own wet cells. Two rules pick the partition. **Every probe has to
 * stand in water** — one rect over the whole map plants its centroid in the
 * middle of the island, which is a cube baked from inside a mountain. And **a
 * SEAM must not fall where anybody is looking across it**: two rects at one
 * height sharing an edge are invisible in the geometry but carry two different
 * probes, so the mirror CHANGES across the line — and the frame-round-a-hole
 * this replaced would have put one straight down the middle of the bay.
 *
 * A pinwheel answers both. The bay, its mouth and the whole eastern sea are
 * ONE rect with one probe standing in the throat of the mouth, so there is no
 * seam anywhere a player can see across the harbour; the three that carry the
 * open sea meet only out past the coast, where both sides of every seam are
 * empty water under the same sky. The outer four meet those at the boundary,
 * 250 m further out again, where the same is true twice over. The generator
 * PROVES the partition rather than leaving it to be read off the numbers —
 * every wet vertex in exactly one rect, no two rects overlapping, and every
 * probe site standing in water.
 *
 * **The inner four are not widened to reach the horizon, and that is the one
 * thing to keep if this is ever repartitioned.** A rect's bed map is a fixed
 * 512 texels a side (\`CONFIG.water.depthTexelsMax\`) however big the rect is,
 * and three of these four carry the island's own shoreline — the waterline,
 * the foam and the shoal grading are all read off that texture, so stretching
 * the western sea out to ${OCEAN} m would have spent three quarters of the west
 * coast's shoreline resolution on empty ocean. The ring has no shore in it and
 * can be as coarse as it likes.
 */
const water: WaterRect[] = [
${waterLines.join("\n")}
];

const grass: GrassRect[] = [
${grass.join("\n")}
];

export const CinderhavenLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  vehicles,
  water,
  grass,
  /**
   * The play square, and the biggest in the tree. \`heights.size *
   * heights.cell\` equals it (${CELLS} x ${CELL}), the rim's boundary boxes are
   * ${PLAY + 2 * MARGIN + 4} m long and so stay well over the 200 m the seven sites that
   * identify the boundary key on, and the heightfield grew with the square
   * rather than getting coarser — the three things \`MapLayout.size\` says a
   * larger map owes.
   */
  size: ${PLAY},
  /**
   * Twenty-four a side, and the field is ${landKm2.toFixed(2)} km² of dry land rather than
   * the ${((PLAY * PLAY) / 1e6).toFixed(2)} km² of the square — see the header. \`CONFIG.bots.maxPerTeam\`
   * is the ceiling and this is at it, so there is no lever left if this is not
   * enough.
   *
   * **Measured on \`server/simulate.ts\`, which is the one tool that asks for a
   * map's own number**: four rounds of 12.2, 12.0, 9.0 and 21.1 minutes,
   * decided every time with tickets left on the winner's side — once by three
   * of them — with 6 to 19 flag captures apiece and a peak contact of 16 to 19
   * of the 48 bodies on the field. **19-32% of ticks had nobody engaged at
   * all**, which is the figure to hold this map to: it was 35-45% when the same
   * square was cut by a reach instead of a bay, and the difference is what a
   * body of water with a flag in the middle of it and a town on both shores
   * does to where people go. It is still not Sarab's density (S10 measured 17%
   * there), and that is the honest cost of a play square 2.8 times the size
   * under the same roster ceiling. The round WORKS, which is what S10 was
   * actually measuring: the failure it found on a too-empty map was five rounds
   * in eleven running the full 45-minute cap with tickets left on BOTH sides,
   * and none of these came anywhere near it.
   */
  perTeam: 24,
  /**
   * Four, because this island stacks less than a city and more than a desert:
   * the ground, a warehouse or terrace floor over it, a watchtower deck, and
   * one slot of margin. Overflow is a SILENT drop in arrival order.
   */
  surfaces: 4,
  /**
   * **The two S6 numbers.** At the default 48 m a ${PLAY + 2 * MARGIN} m map is a 42 x 42 grid
   * of merge blocks — 1,764 meshes for \`_evaluateActiveMeshes\` to walk and
   * \`WorldCulling\` to file a cell for. 120 makes it 17 x 17. What it costs is
   * cull granularity, and on a town whose buildings are six to fourteen metres
   * across a 120 m block is still a whole quarter rather than one house. See
   * \`FINDINGS.md\` 29 and Sarab, which states 96 at 900 m.
   *
   * \`terrainBlock\` matches it because ${120 / CELL} terrain cells is the right patch on a
   * ${CELL} m heightfield — it owes a whole number of cells and nothing checks — but
   * they are two fields because they answer two questions, and a map that
   * widens its merge has said nothing about its floor.
   */
  blockSize: 120,
  terrainBlock: 120,
  /**
   * **No wall: this map is closed by the sea and by the leash.** The sea floor
   * carries on for ${MARGIN} m past the play square and what stops you is a countdown
   * rather than a shape (\`Borderland\`, and \`world/leash.ts\` for the rule).
   *
   * ${MARGIN} m is sized by the LEASH and nothing else now, which is Harrowmead's
   * argument rather than Sarab's: ten seconds at a sprint is 69 m, so the
   * boundary colliders stand three times that beyond anywhere a living player
   * is. It used to be sized by the horizon as well — the ground had to reach
   * far enough out that the fog wall stood over open water rather than over the
   * edge of a plate — and it does not any more, because the WATER goes on
   * without it: a rect is a quad with a texture for a bed, so the sea is drawn
   * to \`OCEAN\` (${OCEAN} m) over no floor at all. What the margin still owes is
   * the shelf a leashed player wades out onto, and 250 m of it is that.
   *
   * \`roll\` is small because this is WATER: the borderland is the shelf
   * continuing, and a swell in ground nobody will ever stand on would only
   * show as a shoal in the middle of the sea.
   */
  borderland: { margin: ${MARGIN}, roll: 1.4 },
  /**
   * **\`form: "none"\`: THE HORIZON IS THE SEA, and this is the only map in the
   * tree with no landform on its boundary at all.**
   *
   * What stood here was the rest of the archipelago — the far walls of the same
   * caldera, a ring of downs ${PLAY / 2 + MARGIN} m out drawn almost entirely in \`fogColor\`.
   * Every argument for it was about the SKY: the dome is flat \`fogColor\` below
   * the horizon and \`Sky\` culls its stars out of the lowest 7.2 deg, so a
   * boundary with nothing over it is a dead band under a starless one, and a
   * rim is the cheapest thing that covers it. On an island it is also the one
   * thing that cannot be true, and no amount of breaking it up fixes that: a
   * ring of hills at a kilometre is a bowl seen from anywhere in the middle of
   * it, and this is a map you are meant to be able to see the whole way round.
   *
   * What covers the band instead is WATER — \`OCEAN\` in the generator, ${OCEAN} m
   * of it, which is past \`fogEnd\` (1,250) from the furthest point anything in
   * the simulation can reach (the boundary colliders, at ${PLAY / 2 + MARGIN}). The lowest
   * degrees of the frame are therefore fogged sea rather than empty dome on
   * every bearing, the star field's own \`altFade\` had already faded to nothing
   * by the cull line, and the sea meets the sky in a horizon rather than in a
   * seam. That is the condition \`RidgeSpec.form\`'s \`none\` states, and this map
   * is what it was added for.
   */
  ridge: { form: "none" },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x43494e44,
};
`,
);

/**
 * **IS EVERY PART OF THE ISLAND ON THE NETWORK?** — measured over the finished
 * roads and the finished floor, and printed as a plan by `--roads`.
 *
 * The failure this catches has no symptom in a screenshot, which is why it is
 * a test and not a review: a quarter or a run of holdings laid off the network
 * still builds, still reads as a town from above and is still somewhere a
 * player arrives at across four hundred metres of open moor wondering what it
 * is for. The old layout shipped with a shelf of crofts in exactly that state,
 * and what said so in the end was somebody walking it.
 *
 * What is measured is the DRY, IN-PLAY ground, and the bar is `ROAD_REACH`.
 * The two exemptions are deliberate and are named rather than tuned away: the
 * ROCK has no road by design (it is the one flag reached by wading), and the
 * cone above the works is ground the map has already decided nobody holds.
 */
function roadCoverage() {
  const cells = [];
  const step = 25;
  for (let z = -HALF + step; z < HALF; z += step) {
    for (let x = -HALF + step; x < HALF; x += step) {
      if (!dry(x, z, 0.8)) continue;
      // The rock is meant to have no road on it, and the cone is meant to have
      // nobody on it: both are stated in the layout and neither is a hole.
      if (Math.hypot(x - ROCK.x, z - ROCK.z) < ROCK.top + ROCK.run) continue;
      if (Math.hypot(x - V.x, z - V.z) < 300) continue;
      cells.push({ x, z, d: roadDist(x, z) });
    }
  }
  return cells;
}

/**
 * **NO CARRIAGEWAY IS LAID IN THE SEA OR UP A CLIFF**, proved rather than
 * eyeballed — `assertScatterDry`'s argument, applied to the one other thing on
 * this map authored as bare coordinates.
 *
 * A `road` is visual-only: it carries no collider, stops no round and is in no
 * baked structure, so a leg laid across forty metres of water is DRAWN, is
 * walked straight through, and says nothing at all. And a leg laid up a slope
 * past `MAX_WALKABLE_GRADE` is worse than a missing road, because it is a route
 * drawn on the ground that the nav graph has severed: bots decline to use it
 * and a player following it walks into a wall of hillside.
 *
 * The bar is 0.35 rather than the graph's own 0.4, for `GRADE`'s reason one
 * layer out: a road sampled every eight metres over a floor sampled every six
 * is an average, and an average AT the limit is a link that fails somewhere
 * along it. The steepest carriageway on the finished map is printed in the
 * summary — it is the bay road climbing off the head of the harbour, at 0.33 —
 * so the margin here is thin on purpose: what this is meant to catch is a leg
 * up a sea cliff, which is 0.6 and over, and a bar loose enough to be
 * comfortable would catch nothing at all.
 */
const ROAD_GRADE = 0.35;
let worstRoadGrade = 0;
{
  const bad = [];
  for (const pts of TRACKS) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 8));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const z = az + ((bz - az) * k) / n;
        worstRoadGrade = Math.max(worstRoadGrade, grade(x, z));
        if (!dry(x, z, 0.35)) {
          bad.push(`(${x.toFixed(0)}, ${z.toFixed(0)}) is in ${(SEA - heightAt(x, z)).toFixed(2)} m of water`);
        } else if (grade(x, z) > ROAD_GRADE) {
          bad.push(`(${x.toFixed(0)}, ${z.toFixed(0)}) is a ${grade(x, z).toFixed(2)} gradient`);
        }
      }
    }
  }
  if (bad.length) {
    throw new Error(
      `roads: ${bad.length} sample(s) on an arterial are unwalkable — ` +
        `${bad.slice(0, 6).join("; ")}${bad.length > 6 ? ", ..." : ""}. A road is a ` +
        "picture: it is drawn over the sea and up a cliff exactly as happily as " +
        "over ground, and nothing downstream says so.",
    );
  }
}

/**
 * **EVERY DWELLING ON THE ISLAND IS ON THE NETWORK**, proved rather than flown
 * over.
 *
 * This is the test and `roadCoverage` above is the tool: the coverage plan
 * shows where the ROADS are thin, which on an island whose outer ring is
 * deliberately bare is a design question rather than a bug, and this asks the
 * question that actually has one right answer — is there anywhere somebody
 * LIVES that has no way in? A quarter or a run of holdings laid off the
 * network still builds and still reads as a town from above, and the only
 * thing that ever said so was somebody walking it.
 *
 * What is measured is the kinds that are PLACES — a house, a hall, a store, a
 * works — and not the kinds that are deliberately reached on foot or not at
 * all: a jetty is over water, a boat shed is on a bank, a lighthouse is on a
 * headland, a stone wall is a field boundary running out from a croft, and
 * everything on CHAPEL ROCK is the one flag on this map with no road to it by
 * design. Those are named rather than tuned away.
 */
const ON_THE_NETWORK = new Set([
  "cottage",
  "townhouse",
  "netLoft",
  "tavern",
  "smithy",
  "barn",
  "mill",
  "depot",
  "shophouse",
  "chapel",
  "smelter",
  "saltPan",
  "gatehouse",
]);
{
  const stranded = [];
  for (const line of placements) {
    const m = /kind: "(\w+)", x: (-?[\d.]+), z: (-?[\d.]+)/.exec(line);
    if (!m || !ON_THE_NETWORK.has(m[1])) continue;
    const x = Number(m[2]);
    const z = Number(m[3]);
    if (Math.hypot(x - ROCK.x, z - ROCK.z) < ROCK.top + ROCK.run) continue;
    const d = roadDist(x, z);
    if (d > ROAD_REACH) stranded.push(`${m[1]} at (${x.toFixed(0)}, ${z.toFixed(0)}) is ${d.toFixed(0)} m from one`);
  }
  if (stranded.length) {
    throw new Error(
      `roads: ${stranded.length} building(s) are off the network — ` +
        `${stranded.slice(0, 8).join("; ")}${stranded.length > 8 ? ", ..." : ""}. ` +
        "Run `npm run cinderhaven -- --roads` for the coverage plan, then add a " +
        "lane rather than moving the building: a house with no way to it is a " +
        "house somebody put in a field.",
    );
  }
}

const coverage = roadCoverage();
if (process.argv.includes("--roads")) {
  const step = 25;
  const glyph = (d) => (d < 30 ? "." : d < 70 ? ":" : d < ROAD_REACH ? "o" : "#");
  for (let z = -HALF + step; z < HALF; z += step) {
    let row = "";
    for (let x = -HALF + step; x < HALF; x += step) {
      const c = coverage.find((k) => k.x === x && k.z === z);
      row += c ? glyph(c.d) : " ";
    }
    console.log(row);
  }
  console.log(`
  (blank) sea, the rock or the cone   . <30 m   : <70 m   o <${ROAD_REACH} m   # OFF THE NETWORK`);
}

/**
 * The set pieces that MUST have found their ground, and how many of each.
 *
 * A refusal is normal and expected in the hundreds — a quarter's recipe asks
 * for more than fits on purpose, and on this map it also asks for ground that
 * turns out to be sea. What is not survivable is a SET PIECE quietly refused:
 * a chapel that did not place is a flag standing on bare rock, and nothing
 * downstream says so.
 */
const REQUIRED = {
  chapel: 1,
  tavern: 2,
  monument: 1,
  gatehouse: 2,
  mill: 1,
  // The LANDMARK. One, and its absence would be a flag standing in an empty
  // yard with a road running to nothing — which is the loudest thing on this
  // map and the quietest possible failure.
  smelter: 1,
  // The three lights: the rock, the harbour point and the mouth of the bay.
  lighthouse: 3,
  // The two big cranes on the Quay and the small one at Netstrand.
  crane: 3,
  road: roadLegs,
};

/**
 * The kinds the FABRIC makes as well as the set pieces, and the fewest of each
 * the map is still the map with.
 *
 * They cannot go in `REQUIRED` because their count is not authored: a block
 * recipe asks for a kiln on a fraction of the plots it can hold one on, and
 * how many it gets depends on what else claimed the ground and on where the
 * coastline ran through the quarter. What matters is not the number but that
 * the number is not SMALL — eight boathouses is a working harbour and two is a
 * shed by some water, and the way that turns into two is somebody moving a
 * road, which is a change with no visible connection to the waterfront it
 * emptied.
 */
const AT_LEAST = {
  boathouse: 6,
  jetty: 6,
  silo: 5,
  kiln: 4,
  // Five rather than seven: the rock's and the harbour point's are lighthouses
  // now, which is what they were always standing in for.
  watchtower: 5,
  cottage: 130,
  // The three pieces the new waterfront is made of. Each is placed in a run
  // whose count depends on where the coastline came out, so what is asserted
  // is that the run is a RUN — four hulls on an island this size is a fishing
  // town and one is a boat somebody left.
  careenedHull: 6,
  fishRack: 9,
  netLoft: 24,
  saltPan: 5,
};

const byKind = {};
for (const l of placements) {
  const m = /kind: "([a-zA-Z]+)"/.exec(l);
  if (m) byKind[m[1]] = (byKind[m[1]] ?? 0) + 1;
}
const refusedByKind = {};
for (const r of refused) {
  const k = r.split(" ")[0];
  refusedByKind[k] = (refusedByKind[k] ?? 0) + 1;
}
console.log("  placed:  " + JSON.stringify(byKind));
console.log("  refused: " + JSON.stringify(refusedByKind));

for (const [kind, want] of Object.entries(REQUIRED)) {
  const got = byKind[kind] ?? 0;
  if (got !== want) {
    throw new Error(
      `set piece: ${want} x ${kind} asked for and ${got} placed. Something ` +
        "already on the ground refused one — see the refusal counts above, and " +
        "move the piece rather than the thing it collided with.",
    );
  }
}
for (const [kind, least] of Object.entries(AT_LEAST)) {
  const got = byKind[kind] ?? 0;
  if (got < least) {
    throw new Error(
      `fabric: ${got} x ${kind} placed against a floor of ${least}. Something ` +
        "upstream is taking the plots this kind needs — either a road moved or " +
        "the coast did.",
    );
  }
}

console.log(
  `cinderhaven: ${PLAY} m play + ${MARGIN} m margin = ${PLAY + 2 * MARGIN} m across\n` +
    `  ${placementCount} placements, ${scatterCount} scatter regions, ${claimed.length} claims\n` +
    `  ${crofts} crofts on the outskirts, ${refused.length} candidates refused\n` +
    `  ${row}x${row} height vertices, ground ${lo.toFixed(2)}..${hi.toFixed(2)} m, ` +
    `${landKm2.toFixed(2)} km2 dry, ${seaKm2.toFixed(2)} water (bay ${bayKm2.toFixed(2)}) of ` +
    `${((PLAY * PLAY) / 1e6).toFixed(2)}
` +
    `  ${roadLegs} road slabs, steepest carriageway ${worstRoadGrade.toFixed(2)} against a bar of ${ROAD_GRADE}; every dwelling within ${ROAD_REACH} m of one
` +
    `  steepest LAND step ${worstStep.toFixed(2)} m at ${worstAt}\n` +
    `  steep land edges exempted: ${EXEMPT.cone} on the cone, ${EXEMPT.cliff} on sea cliffs\n` +
    `  wrote src/world/cinderhaven/{layout,heights}.ts`,
);
