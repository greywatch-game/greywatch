/**
 * kit/terrain.ts — Ground-shaping builders: terrace, ramp, road, jetty,
 * boardwalk, stairs.
 * All follow the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata).
 * Extra care here: these are walkable surfaces, so their collider top faces
 * must stay within CONFIG.nav.stepHeight of adjacent ground and ramps need
 * rotX on the COLLIDER, not just the visual.
 */
import { Scene } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { ROAD_LENGTH, ROAD_WIDTH } from "../roads";
import { terrainSlab } from "../TerrainField";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  ASPHALT,
  CREEPER,
  DARK_STONE,
  DIRT,
  GUARD_THICKNESS,
  PLANK,
  ROAD_PAINT,
  TEAK,
  TIMBER,
} from "./core";

/**
 * A raised earth terrace with a ramp on one side. Used for the chapel's
 * graveyard platform; the top face and the ramp are both walkable colliders.
 */
export function buildTerrace(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "terrace");
  const w = p.width ?? 30;
  const d = p.depth ?? 26;
  const h = p.height ?? 2;
  const side = p.rampSide ?? -1;

  b.box(w, h, d, 0, h / 2, 0, DIRT);
  b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  // Retaining wall, so the terrace edge reads as built rather than extruded.
  for (const sx of [-1, 1]) {
    b.box(0.4, h + 0.3, d, (sx * w) / 2, (h + 0.3) / 2, 0, DARK_STONE);
  }
  b.box(w, h + 0.3, 0.4, 0, (h + 0.3) / 2, (-side * d) / 2, DARK_STONE);

  // Ramp up the chosen face.
  const rampLen = h * 5;
  const pitch = Math.atan2(h, rampLen);
  const rz = (side * (d + rampLen)) / 2;
  b.box(7, 0.3, rampLen, 0, h / 2, rz, DIRT, { x: side * pitch });
  b.block({ w: 7, h: 0.3, d: rampLen, x: 0, y: h / 2, z: rz, rotX: side * pitch });
  return b;
}

/**
 * A standalone earth ramp, rising from -Z to +Z over `length`. Used to get in
 * and out of the creek at more than one point — a sunken lane with a single
 * exit is a trap, and the nav grid needs somewhere to route bots through.
 */
export function buildRamp(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "ramp");
  const w = p.width ?? 5;
  const len = p.length ?? 8;
  const h = p.height ?? 1.5;
  const pitch = Math.atan2(h, len);
  b.box(w, 0.3, len, 0, h / 2, 0, DIRT, { x: -pitch });
  b.block({ w, h: 0.3, d: len, x: 0, y: h / 2, z: 0, rotX: -pitch });
  // Kerb stones, so the ramp reads as built rather than as a floating slab.
  for (const sx of [-1, 1]) {
    b.box(0.4, h + 0.3, len, (sx * w) / 2, h / 2 - 0.2, 0, DARK_STONE, {
      x: -pitch,
    });
  }
  return b;
}

/**
 * Road surface. Visual only — it sits on the ground, so nothing ever stands on
 * the slab itself: feet rest on the floor from the ground probe and the nav
 * grid. The slab is therefore sunk so its top sits only a centimetre proud —
 * enough to avoid z-fighting the floor, but not enough to swallow a
 * character's ankles. Cobblestone by default; `surface: "dirt"` gives the flat
 * track for farm lanes and `surface: "asphalt"` the blacktop a city street is.
 *
 * The two flat surfaces are one branch because they differ only in colour: the
 * cobble path carries a world-mapped texture, a per-sett bump map and the wet
 * sheen `groundSpec` tunes, and none of that is anything a road wants when it
 * is meant to read as poured. Adding a third tone here is a colour, not a code
 * path.
 *
 * It is the one builder whose shape depends on where it is going. MapBuilder
 * samples the floor once, at a placement's own centre, and translates the whole
 * structure by it — fine for a cottage, wrong for 130 m of street, which used
 * to float at one end and bury itself at the other over sculpted ground. So the
 * slab is re-cut against the heightfield by `terrainSlab`, which returns null
 * over level ground and leaves the single box the road has always been. That
 * fast path is why a flat map costs exactly what it used to.
 */
export function buildRoad(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "road");
  const top = 0.01;
  const h = 0.08;
  // The two defaults are `roads.ts`'s, not this builder's: the footprint
  // `roadRects` derives has to be the slab that gets drawn, and two roads in
  // the shipped layouts state a length and no width.
  const w = p.width ?? ROAD_WIDTH;
  const len = p.length ?? ROAD_LENGTH;
  // Which flat tone this road is, or null for the textured cobble.
  const flat =
    p.surface === "dirt" ? DIRT : p.surface === "asphalt" ? ASPHALT : null;

  const contoured =
    ctx &&
    terrainSlab(ctx.terrain, {
      w,
      len,
      x: ctx.x,
      z: ctx.z,
      rotY: ctx.rotY,
      originY: ctx.y,
      top,
      thickness: h,
    });
  // Kept only on the one path that can carry markings — the flat box. What the
  // paint below needs from it is its ink, and only that.
  let slab: Mesh | null = null;
  if (contoured) b.surface(contoured, flat ?? undefined);
  else if (flat) slab = b.box(w, h, len, 0, top - h / 2, 0, flat);
  else b.groundBox(w, h, len, 0, top - h / 2, 0);

  // Blacktop gets a broken centre line, and it is not decoration: an asphalt
  // road is the one surface in the kit with no texture and no bump, so a 16 m
  // carriageway is otherwise the largest untextured area anywhere in the game
  // and reads as a hole in the map rather than as a street. The dashes give it
  // a scale, a direction and something for the eye to measure distance along.
  //
  // Only on the FLAT path. A dash is a box laid on a plane and the contoured
  // path is not one — over sculpted ground each would float or bury itself,
  // which is the whole problem `terrainSlab` exists to solve for the slab
  // itself and cannot solve for something laid on top of it.
  if (p.surface === "asphalt" && !contoured && slab) {
    // **A marked road is not inked, and this is the whole reason the slab is
    // held onto above.** `addOutline` draws Babylon's inverted-hull outline,
    // and the half of that which matters here is invisible: after the mesh is
    // drawn, the shell is drawn AGAIN with colour write off and depth write
    // ON, so the hull's own depth — the slab's top face pushed 5 cm up its
    // normals, and pushed further toward the eye by the renderer's
    // slope-scaled offset — is what stands in the depth buffer over the whole
    // carriageway. Anything laid on the road then fails the depth test against
    // a surface 5 cm above the road that nobody can see. Paint 4 cm proud
    // simply was not there in play, and no clearance fixes it: the slope-scaled
    // half of the offset grows with the grazing angle, so measured down an
    // avenue at eye height, ink thinned to 1 cm still swallowed every dash
    // past ~35 m. What made this expensive to find is that it did not happen
    // in the EDITOR, where roads are already left uninked for a different
    // reason (see MapBuilder) — the markings were on screen the whole time
    // they were being authored.
    //
    // A flat sheet lying on the ground has no silhouette to ink in the first
    // place, which is the same thing `noShadowCaster` says about it one line
    // later in MapBuilder. What is given up is a 5 cm ink line where the
    // carriageway meets the pavement, against markings that are load-bearing
    // for this surface — see the note above. Roads that carry no paint are
    // untouched and keep their ink: cobble and dirt read against grass by that
    // line, and it is the merge key (`EXEMPTIONS`) that keeps the two kinds in
    // separate merged meshes rather than making one of them wrong.
    slab.metadata = { ...(slab.metadata ?? {}), noOutline: true };
    // Clear of the slab's own top by more than the centimetre it stands proud
    // of the floor: coplanar faces in two meshes are a depth-test tie broken
    // per pixel, which strobes into a line as you walk (see buildTavern).
    const paintY = top + 0.02;
    const dash = 3.2;
    const gap = 3.2;
    const n = Math.floor((len + gap) / (dash + gap));
    const run = n * (dash + gap) - gap;
    for (let i = 0; i < n; i++) {
      const z = -run / 2 + i * (dash + gap) + dash / 2;
      // `noOutline`, and it is not a nicety. A dash is 4 cm tall and the ink
      // shell `addOutline` wraps it in is 5 cm of expansion along its own
      // normals — bigger than the thing it is outlining — so every marking came
      // out as a dark scratch rather than a pale one, which is the same
      // thin-slab failure the SLAB note in kit/city.ts describes from the other
      // end. Paint has no silhouette to ink; it is a colour on a surface.
      b.box(0.26, 0.04, dash, 0, paintY, z, ROAD_PAINT).metadata = {
        noOutline: true,
      };
    }
  }
  return b;
}

// --- the boardwalk --------------------------------------------------------

/**
 * Walked height of a boardwalk deck. Inside CONFIG.nav.stepHeight (0.6), which
 * is the whole design: every cell of the deck links to the ground beside it, so
 * a walk has no ramps and you step on and off it anywhere along its length.
 */
const WALK_DECK = 0.5;
/**
 * The deck slab's thickness, placed by its TOP face so the walked surface is
 * WALK_DECK however this changes.
 *
 * It is deliberately deeper than the height it stands at. `OutlineRenderer`
 * draws the outline shell with a slope-scaled negative depth offset, and at the
 * grazing angle you see a walked surface from, the shell's underside wins the
 * depth test unless there is real depth behind the top face — which paints the
 * deck flat in its own ink. The manor's 0.14 m board deck is the worked failure
 * (see CLAUDE.md); `boardDeck` in kit/manor.ts is the worked fix. Everything
 * else the boardwalk draws hangs BELOW this box, because a batten laid on top
 * of the walked surface would be a thin slab again with nothing behind it.
 */
const WALK_DECK_T = 0.64;
/** Metres between pile bents. */
const WALK_BENT = 3.5;

/**
 * A plank causeway on piles: the connective tissue between stilt huts, and the
 * way across marsh that is too shallow to be worth a bridge.
 *
 * ## Why this is not the trestle bridge with a height spinner
 *
 * The two have opposite navigation contracts, and it is geometry rather than a
 * parameter. A boardwalk's deck is under `stepHeight` above its own ground, so
 * it links along its whole length and needs no ramps; its underside is a
 * handspan off the ground, so `severLinks` cuts every link that crosses it and
 * `clearBlocked` blanks the ground beneath. It is a CAUSEWAY — you walk on it,
 * never under it, and that is correct. A trestle's deck is 1.6 m up: it links
 * only at its two ramped ends, and its underside clears `HEADROOM`, so the bed
 * stays walkable and you wade underneath. One builder with a `height` spinner
 * would cross 0.6 somewhere in the middle of its range and silently disconnect
 * itself from the map, with nothing to see and nothing thrown.
 *
 * ## Author it as a chain
 *
 * `MapBuilder` samples the terrain ONCE, at a placement's own centre, so a long
 * walk over anything but level ground floats at one end and buries itself at
 * the other — the problem `terrainSlab` solves for roads, which is not
 * available here because a boardwalk is a collider and a road is not. The fix
 * is authoring: lay a run as two or three 9–16 m placements so each samples its
 * own ground. Adjacent decks whose heights differ by less than `HEIGHT_EPS`
 * merge into one nav surface, so the joints cost nothing.
 *
 * ## Raising one with a layout `y` is a different building
 *
 * Nothing stops a placement lifting a walk a storey — Greyfen's treeline hamlet
 * does exactly that — but it spends the causeway contract above: past
 * `stepHeight` the deck stops linking to the ground anywhere along its length,
 * and past `HEADROOM` the ground underneath comes back as an approach you can
 * fight along. That is a fine thing to build ON PURPOSE, and `buildStairs` is
 * then not decoration but the only way up. There is nothing in between: a walk
 * lifted into the dead band between the two is a deck nothing can reach and
 * nothing can pass under.
 */
export function buildBoardwalk(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "boardwalk");
  const len = p.length ?? 14;
  const w = p.width ?? 2.4;
  const rails = p.railSide ?? "both";

  // The deck: visual and collider in one box, placed by its top face.
  b.wall(w, WALK_DECK_T, len, 0, WALK_DECK - WALK_DECK_T / 2, 0, PLANK);

  const under = WALK_DECK - WALK_DECK_T;
  const bents = Math.max(1, Math.round(len / WALK_BENT));
  for (let i = 0; i <= bents; i++) {
    const z = -len / 2 + (i / bents) * len;
    // Cross-bearer, tucked directly under the deck so the slab reads as boards
    // carried on timber rather than as one extruded block.
    b.box(w + 0.24, 0.18, 0.22, 0, under - 0.09, z, TEAK);
    for (const sx of [-1, 1]) {
      // Piles. Visual only, and they must stay that way: a collider here would
      // sever the links under the walk, spend a nav surface below the deck, and
      // give bots something to wedge on. buildJetty makes the same call.
      b.cyl(1.5, 0.2, 0.26, 5, (sx * w) / 2.6, under - 0.18 - 0.75, z, TEAK);
    }
    // Creeper down alternate outer piles — the jungle read, and the reason a
    // boardwalk over a channel does not look like decking.
    if (i % 2 === 1) {
      b.box(0.07, 0.9, 0.16, (-w) / 2.6 - 0.13, under - 0.55, z, CREEPER);
    }
  }

  // Rails. `guard` stands them OUTBOARD of the deck edge — a rail sitting on the
  // walked surface would steal whichever 1.5 m nav cell its sample lands in.
  for (const side of ["-x", "+x"] as const) {
    if (rails !== "both" && rails !== side) continue;
    const sx = side === "+x" ? 1 : -1;
    b.guard(side, (sx * w) / 2, 0, len, WALK_DECK, { color: TEAK });
    // Posts on the rail's own centreline, which is half a thickness outboard —
    // drawn at the deck edge they would be inside the guard box and invisible.
    const postX = (sx * (w + GUARD_THICKNESS)) / 2;
    for (let i = 0; i <= bents; i++) {
      const z = -len / 2 + (i / bents) * len;
      b.box(0.17, 1.1, 0.17, postX, WALK_DECK + 0.55, z, TIMBER);
    }
  }
  return b;
}

// --- the stair -------------------------------------------------------------

/**
 * Rise per metre of run, for every stair the layout places.
 *
 * It is a CONSTANT and not a parameter, and that is the whole safety of this
 * builder. `NavGrid.link` connects neighbouring surfaces only within
 * `stepHeight`, so at `cellSize` 1.5 anything steeper than `MAX_WALKABLE_GRADE`
 * (0.4) severs its own links — a flight over that line is a ladder nothing can
 * climb, with nothing thrown and nothing to see. 0.35 is the manor's service
 * stair: the steepest the kit runs, and a cell of margin under the limit for
 * the ground the foot lands on to be a little off level. A `length` spinner
 * beside a `height` one would be exactly the "crosses 0.6 somewhere in the
 * middle of its range" trap `buildBoardwalk` refuses for the same reason.
 */
const STAIR_GRADE = 0.35;
/** Riser aimed for. The count is rounded off it, so treads come out even. */
const STAIR_RISER = 0.18;
/**
 * How far the flight runs on PAST its own foot, to be buried.
 *
 * `MapBuilder` samples the terrain once, at the placement's CENTRE, and the
 * foot is half a run away from that — so on anything but level ground the
 * bottom step lands in the air or in the soil. The overrun is the manor's
 * `SERVICE_DROP`: `Build.flight` skips every tread below the local ground line,
 * so what is buried costs nothing and what is exposed is a step more of stair.
 */
const STAIR_OVERRUN = 0.6;
/** Metres between the trestles under the flight. */
const STAIR_BENT = 2.2;

/**
 * A free-standing flight of stairs: the way up to anything the kit raises past
 * a single step.
 *
 * ## What it is for
 *
 * `buildBoardwalk` puts its deck inside `stepHeight` so a causeway links to the
 * ground along its whole length and needs no access at all. Author the same
 * walk with a `y` in the layout — a village raised over marsh, a deck along a
 * bank — and every one of those links is gone: the deck is a surface in the air
 * with `HEADROOM` under it, walkable, reachable from nowhere, and silent about
 * it. This is the piece that reconnects it, and it serves a terrace lip, a
 * jetty over a cut bank or a hut platform on a rise just as well.
 *
 * ## How to place one
 *
 * It climbs toward **+Z**, like `buildRamp`, and the placement point is the
 * MIDDLE of the run — so the treads arrive at `length / 2` ahead of it, where
 * `length` is `height / STAIR_GRADE` and is derived rather than authored (see
 * that constant). Butt that arrival against the deck's own edge and the joint
 * costs nothing: the last stair cell and the first deck cell are neighbours
 * within a step, and `NavGrid`'s `HEIGHT_EPS` merges them where they coincide.
 *
 * Two things to keep to. **Both ends want ground the placement's own centre
 * sample is honest about** — a flight is 7 m long at a 2.5 m rise and one
 * height sample serves all of it, which is the authoring rule the boardwalk's
 * header states from the other side. And **do not run one narrower than about
 * 1.6 m**: the nav grid samples one point per 1.5 m cell, so a narrow flight is
 * a chain of surfaces the sampler misses between, and it stops linking to
 * itself before it stops looking like a stair.
 */
export function buildStairs(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "stairs");
  const w = p.width ?? 2.4;
  const rise = p.height ?? 2.5;
  const rails = p.railSide ?? "both";
  const run = rise / STAIR_GRADE;
  const pitch = Math.atan(STAIR_GRADE);
  const topZ = run / 2;
  /** The walked surface at any point on the run. Zero at the foot. */
  const surfaceAt = (z: number): number => rise - (topZ - z) * STAIR_GRADE;

  // The flight, overrunning its foot into the ground. One pitched collider
  // slab: treads are visual, per Build.flight.
  b.flight({
    x: 0,
    w,
    topZ,
    topY: rise,
    run: run + STAIR_OVERRUN,
    rise: rise + STAIR_OVERRUN * STAIR_GRADE,
    dir: 1,
    steps: Math.max(2, Math.round(rise / STAIR_RISER)),
    color: PLANK,
  });

  // Trestles carrying the span, and a pair of stringer piles at the head where
  // it meets the deck. Visual only — the same call `buildBoardwalk` and
  // `buildJetty` make about their piles, and here it also keeps the space under
  // a stair open, which is what stops the flight severing the links beside it.
  const bents = Math.max(1, Math.round(run / STAIR_BENT));
  for (let i = 1; i <= bents; i++) {
    const z = -run / 2 + (i / bents) * run;
    const head = surfaceAt(z) - 0.34;
    if (head < 0.5) continue;
    b.box(w + 0.2, 0.16, 0.2, 0, head, z, TEAK);
    for (const sx of [-1, 1]) {
      b.cyl(head + 0.5, 0.2, 0.26, 5, (sx * w) / 2.6, (head - 0.5) / 2, z, TEAK);
    }
    // Creeper up alternate legs. The jungle read the boardwalk already carries,
    // so a flight up to one does not arrive as fresh carpentry.
    if (i % 2 === 0) {
      b.box(0.07, Math.min(1.1, head), 0.16, -w / 2.6 - 0.13, head / 2, z, CREEPER);
    }
  }

  // Rails, standing OUTBOARD of the treads: `guard` owns that argument, and a
  // pitched run is why it takes a pitch at all. The walked height at the run's
  // centre is half the rise, since the flight passes through the ground line at
  // its foot.
  for (const side of ["-x", "+x"] as const) {
    if (rails !== "both" && rails !== side) continue;
    const sx = side === "+x" ? 1 : -1;
    b.guard(side, (sx * w) / 2, 0, run, rise / 2, { pitch, color: TEAK });
    // Newels at the foot and the head, on the rail's own centreline — drawn at
    // the tread edge they would be inside the guard box and invisible.
    const postX = (sx * (w + GUARD_THICKNESS)) / 2;
    for (const z of [-run / 2, topZ]) {
      b.box(0.17, 1.3, 0.17, postX, surfaceAt(z) + 0.65, z, TIMBER);
    }
  }
  return b;
}

/** Rotting jetty over the bog, running along Z. */
export function buildJetty(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "jetty");
  const len = p.length ?? 18;
  const w = 3;
  // Deck top must stay under CONFIG.nav.stepHeight above the mud, or the
  // flood fill never reaches it and bots treat the jetty as a wall.
  b.box(w, 0.24, len, 0, 0.45, 0, PLANK);
  b.block({ w, h: 0.24, d: len, x: 0, y: 0.45, z: 0 });
  const posts = Math.round(len / 3);
  for (let i = 0; i <= posts; i++) {
    const z = -len / 2 + (i / posts) * len;
    for (const sx of [-1, 1]) {
      b.cyl(1.3, 0.26, 0.32, 5, (sx * w) / 2.5, 0.05, z, TIMBER);
    }
  }
  return b;
}
