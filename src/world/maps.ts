/**
 * maps.ts — The playable maps, as data: what a map IS, and which ones exist.
 * Owns: the `MapDef` pairing of a layout with the environment it is lit and
 * fogged by and the two bulk halves it is fetched with, plus the registry
 * `Game` picks one out of and the loader that answers for a map's floor.
 * Invariants: the halves travel together. A layout is placements; a
 * `Heightfield` is the ground under them; an `EnvironmentSpec` is the palette,
 * fog, sky and particles it is meant to be seen under, and building one
 * against the other's environment gives a night village in daylight fog.
 * Pairing them here is what stops the orchestrator from having to know any of
 * their names.
 *
 * This is the file a second map is added to, and — with its own `layout.ts`,
 * `heights.ts` and `environment.ts` under a directory of its own — the ONLY
 * existing file it has to touch. Two of those three are named here as LAZY
 * imports rather than pulled in at the top: the heightfield and the collision
 * bake are the two halves of a map that are bulk rather than authorship, and
 * neither belongs in a bundle a player parses before they have chosen anything
 * (`MapDef.heights`, `MapDef.collision`). Nothing downstream may import a map's modules
 * directly: `Game` holds a `MapDef`, `MapBuilder.build` takes both halves as
 * arguments, and neither special-cases any particular map.
 */
import type { MapCollision } from "./collision";
import type { EnvironmentSpec } from "./environment";
import type { Heightfield, MapLayout } from "./layout";
import { CinderhavenEnvironment } from "./cinderhaven/environment";
import { CinderhavenLayout } from "./cinderhaven/layout";
import { ColdharbourEnvironment } from "./coldharbour/environment";
import { ColdharbourLayout } from "./coldharbour/layout";
import { GreyfenEnvironment } from "./greyfen/environment";
import { GreyfenLayout } from "./greyfen/layout";
import { HarrowmeadEnvironment } from "./harrowmead/environment";
import { HarrowmeadLayout } from "./harrowmead/layout";
import { HollowmereEnvironment } from "./hollowmere/environment";
import { HollowmereLayout } from "./hollowmere/layout";
import { KurenaiEnvironment } from "./kurenai/environment";
import { KurenaiLayout } from "./kurenai/layout";
import { ProvingEnvironment } from "./proving/environment";
import { ProvingLayout } from "./proving/layout";
import { SarabEnvironment } from "./sarab/environment";
import { SarabLayout } from "./sarab/layout";

/**
 * A map: the level data, the conditions it is seen under, and what to call it
 * on a scoreboard.
 *
 * Held by identity, not by id — `Game.applySky` skips repainting eight
 * megapixels of dome when the environment object is unchanged, and the
 * cheapest way to know that is that it is the same object. So a `MapDef` must
 * be a module-level constant, never rebuilt per round.
 */
export interface MapDef {
  /** Stable key. What a saved preference or a URL would name. */
  id: string;
  /** Shown to the player — the scoreboard's header and the round-over card. */
  name: string;
  /**
   * One line about what it is like to fight here, for the menu's map panel.
   *
   * It lives here rather than in a table under `src/ui/` for the reason `name`
   * does: a map's own file is the only place that cannot fall out of step with
   * the map, and a fourth map added to this registry should not compile to a
   * front end with a blank panel in it. Prose, not a stat line — everything
   * countable on that panel (the flags, the extent, the view distance) is read
   * off the layout and the environment beside it, and repeating any of it here
   * is how the two come to disagree.
   */
  blurb: string;
  layout: MapLayout;
  environment: EnvironmentSpec;
  /**
   * The floor's shape — the third half of a map, and a LAZY import for
   * `collision`'s reason rather than a field on the layout beside the
   * placements it belongs with.
   *
   * A heightfield is one number per grid vertex and grows with the SQUARE of
   * the map: 51 KB of JS number literals for Harrowmead's 100 x 100, and about
   * 700 KB for the 375 x 375 that a 1500 m map at the same 4 m cell needs.
   * Imported by `layout.ts` it was in the main chunk — every map's, parsed on
   * every boot, for the one map a session actually builds. Behind `import()`
   * Vite splits each into a chunk of its own, and the one that is fetched is
   * the one being played. See ENGINE_UPGRADE.md S7.
   *
   * Absent means a level floor, exactly as an absent `MapLayout.terrain` used
   * to: `TerrainField` with no field returns 0 everywhere. Nothing ships that
   * way today.
   *
   * **The resolved object is the map's, not a copy**, because the module cache
   * hands back the same one every time — which is what lets the editor's
   * terrain brush write through it and the next rebuild read the edits back.
   * Go through `loadHeights` rather than calling this directly; it is what
   * `heightsOf` can answer synchronously afterwards.
   */
  heights?: () => Promise<{ default: Heightfield }>;
  /**
   * The baked collider set — for the multiplayer server, which has no canvas
   * and so cannot run `MapBuilder` at all (see `world/collision.ts`), and now
   * for the MENU as well.
   *
   * A LAZY import, and that is the whole reason it is a function. The data is
   * hundreds of kilobytes per map, and behind `import()` Vite splits it into a
   * chunk of its own, so the third half of a map travels with the other two
   * here without riding along in either bundle.
   *
   * **What changed is who asks.** This was "the browser has no use for it: a
   * client builds the real colliders", and that is still true of the ROUND —
   * but the menu's dossier draws a schematic of a map nothing has built yet,
   * and this is the only description of that map's BUILDINGS that exists
   * outside a built world (a `Placement` is a point and a kit name; the
   * footprint is the builder's). So a map row under the cursor now fetches
   * this beside the floor, and the schematic is the same drawing the deploy
   * screen will make of the same place. Go through `loadCollision` rather
   * than calling this directly, as with `heights`.
   */
  collision: () => Promise<{ default: MapCollision }>;
}

export const HOLLOWMERE: MapDef = {
  id: "hollowmere",
  name: "Hollowmere",
  blurb:
    "A drowned village under a night fog. Lanes and walled yards make every " +
    "flag a short fight, and the mist closes the long ones down.",
  layout: HollowmereLayout,
  environment: HollowmereEnvironment,
  heights: () => import("./hollowmere/heights"),
  collision: () => import("./hollowmere/collision"),
};

/**
 * Greyfen: the same valley on a jungle morning, two hours after sunrise, with
 * the sun coming down through the canopy in shafts. Its layout was forked from
 * Hollowmere's and is diverging; the two share no module and must not.
 */
export const GREYFEN: MapDef = {
  id: "greyfen",
  name: "Greyfen",
  blurb:
    "The same valley two hours after sunrise, gone to jungle. The canopy " +
    "takes the sightlines and gives them back in shafts.",
  layout: GreyfenLayout,
  environment: GreyfenEnvironment,
  heights: () => import("./greyfen/heights"),
  collision: () => import("./greyfen/collision"),
};

/**
 * Coldharbour: a city's business district on a clear afternoon. The first map
 * that is neither 240 m nor fogged — it states its own `size` (320) and its own
 * `surfaces` (5, for the buildings you can climb inside), and its `fogEnd` is
 * what `Game.installMap` pushes into the three systems that used to read
 * `FOG_WALL`. It shares no module with either valley and must not.
 */
export const COLDHARBOUR: MapDef = {
  id: "coldharbour",
  name: "Coldharbour",
  blurb:
    "A business district an hour before dusk, with the sea at the end of " +
    "every avenue. Three floors to hold, glass to break, and no fog at all " +
    "to be missed in.",
  layout: ColdharbourLayout,
  environment: ColdharbourEnvironment,
  heights: () => import("./coldharbour/heights"),
  collision: () => import("./coldharbour/collision"),
};

/**
 * Harrowmead: a farming town in a broad green vale, the last hour of a
 * high-summer day. The largest
 * map yet — it states `size: 400` and, like Coldharbour, a `fogEnd` past its
 * own diagonal — and the first whose ground does the sightline work: rolling
 * hills, a wadeable mill stream, and hedged fields between five farmyard
 * flags. It shares no module with the other three and must not.
 */
export const HARROWMEAD: MapDef = {
  id: "harrowmead",
  name: "Harrowmead",
  blurb:
    "A farming vale at sunset in high summer. Hedgerows and rolling ground " +
    "cut the long lanes into bounds, and the hilltops see everything.",
  layout: HarrowmeadLayout,
  environment: HarrowmeadEnvironment,
  heights: () => import("./harrowmead/heights"),
  collision: () => import("./harrowmead/collision"),
};

/**
 * Sarab: a town in a desert basin, an hour before noon, some months into being
 * fought over. **900 m of play inside 1,500 m of ground** — 5.1 times
 * Harrowmead's playable area, and by a wide margin the biggest map in the tree.
 *
 * It is the map `ENGINE_UPGRADE.md` exists for and the one every lever in that
 * document was bought to make possible, so it is also the first map here to
 * SPEND several of them: `blockSize` and `terrainBlock` at 96 (S6), a `fogEnd`
 * well inside its own diagonal so that block visibility finally has something
 * to cull (S1 and S8), and a `bodyDrawDistance` inside THAT (S8's landed
 * field, and no other map in the tree states one).
 *
 * Its layout was SEEDED by `scripts/generate-sarab.mjs` rather than typed —
 * `sarab/layout.ts`'s header carries that argument — and it is an ordinary
 * layout file in every other way: the editor opens it, patches it and saves it
 * exactly as it does Harrowmead's. It shares no module with the other four and
 * must not.
 */
export const SARAB: MapDef = {
  id: "sarab",
  name: "Sarab",
  blurb:
    "A desert town an hour before noon, months into being fought over. " +
    "Alleys you cannot see over, roofs you can, and a kilometre of open sand.",
  layout: SarabLayout,
  environment: SarabEnvironment,
  heights: () => import("./sarab/heights"),
  collision: () => import("./sarab/collision"),
};

/**
 * Cinderhaven: a harbour town on a volcanic island, at night. **The biggest map
 * in the tree — 1,500 m of play inside 2,000 m of ground**, 2.8 times Sarab's
 * playable area and 14 times Hollowmere's.
 *
 * **What keeps it a fight rather than a walk is that only 1.38 km² of that
 * square is dry.** The other 0.88 km² is CINDER BAY and the open sea, so the
 * twenty-four bodies a side this map fields — `MapLayout.perTeam` at
 * `CONFIG.bots.maxPerTeam`, as Sarab's is — are spread over land rather than
 * over the extent. That is the figure to compare against Sarab's 0.81 km², and
 * it is why a map nearly three times the play square asks for the same roster.
 *
 * **The island is a C and the bay is what bends it**: a basin six hundred
 * metres across with a mouth half that, two arms of land curling round it, a
 * town on two of its shores and a control point on the rock in the middle. The
 * whole of it is 2.6 m deep at worst, so the middle flag is WADEABLE from
 * either side — a slow, exposed, four-hundred-metre crossing with no cover on
 * it. Nothing in the layout needs a boat; what a boat would add is speed and a
 * gun, not access.
 *
 * Two things about it are new here rather than borrowed. **The FLOOR is the
 * level**: an island's shape decides what is land at all, where the water
 * goes, and which slopes sever their own nav links — so `heightAt` in the
 * generator is the map, and the town is what stands on the answer, down to the
 * quays, which are placed by MARCHING the finished floor for the waterline
 * rather than by authoring a coordinate on it. And **the key light comes out
 * of the mountain**, which puts the sky's one bright disc and every shaft the
 * air scatters over the crater, and splits the palette by surface NORMAL
 * rather than by hue: warm on everything facing the cone, cold starlight on
 * everything facing up. `cinderhaven/environment.ts` owns that argument.
 *
 * Its layout was SEEDED by `scripts/generate-cinderhaven.mjs` on Sarab's
 * precedent, and it is an ordinary layout file in every other way. It shares
 * no module with the other five and must not.
 */
export const CINDERHAVEN: MapDef = {
  id: "cinderhaven",
  name: "Cinderhaven",
  blurb:
    "A harbour town on a volcanic island, under a burning mountain. A bay you " +
    "wade to reach the chapel on the rock, and the dark to cross it in.",
  layout: CinderhavenLayout,
  environment: CinderhavenEnvironment,
  heights: () => import("./cinderhaven/heights"),
  collision: () => import("./cinderhaven/collision"),
};

/**
 * Kurenai: a temple town in a mountain valley, in the last week of the maples,
 * forty minutes before sunset. **750 m of play inside 950 m of ground**, with
 * all three kinds of vehicle and twenty bodies a side.
 *
 * It is the first map built against a REFERENCE FRAME rather than against a
 * place (`reference-media/new-map.jpg`): a stone path under red maples, a
 * torii, a stone lantern and a paper-walled hall glowing in a peach haze. What
 * it needed for that is a kit of its own (`kit/japan.ts`, whose curved roof is
 * the one new shape) and three props (`buildMaple`, `buildLeafLitter`,
 * `buildBamboo`), and nothing else about the engine.
 *
 * Its layout was SEEDED by `scripts/generate-kurenai.mjs` on Sarab's
 * precedent, and it is an ordinary layout file in every other way. It shares
 * no module with the other six and must not.
 */
export const KURENAI: MapDef = {
  id: "kurenai",
  name: "Kurenai",
  blurb:
    "A temple town in a mountain valley as the maples turn, an hour before " +
    "dusk. A river through the middle, a pagoda on the hill, and a shrine " +
    "at the top of a thousand vermilion gates.",
  layout: KurenaiLayout,
  environment: KurenaiEnvironment,
  heights: () => import("./kurenai/heights"),
  collision: () => import("./kurenai/collision"),
};

/**
 * The proving ground: not a level, and DEV ONLY.
 *
 * `ENGINE_UPGRADE.md` S0 is what it exists for — a generated city block grid at
 * roughly Coldharbour's collider density carried out to a play square several
 * times the size, so that the six things under `src/world/` priced on map AREA
 * can be measured at the scale a 1500 m map asks for rather than projected from
 * maps a quarter of it. Its layout and heightfield are written wholesale by
 * `scripts/generate-proving-ground.mjs`; only the environment beside them is
 * hand-written.
 *
 * **It must never reach a production bundle.** It is behind
 * `import.meta.env.DEV` in `MAPS` below, which is the only place it is
 * referenced, so a production build folds the ternary and tree-shakes the two
 * generated modules — 150 to 400 kB of them, depending on the extent it was
 * generated at — out. That is enforced rather than trusted:
 * `scripts/check-proving.mjs` runs on the end of `npm run build` and greps
 * `dist/` AND `dist-server/` for three strings that exist only past this gate.
 *
 * **The third of those is new with `heights`, and so is the reason for it.**
 * `proving/heights.ts` used to be reachable only through `proving/layout.ts`,
 * so the layout's sentinel covered it; a lazy `import()` makes it a chunk root
 * of its own, which Rollup emits unless the arrow naming it is itself shaken
 * away with `PROVING`. It is — the same way `collision` below is — but that is
 * a property of how this const is written and not a promise, which is exactly
 * the class of thing this file's gate exists to prove rather than assume. See
 * `PROVING_HEIGHTS_MARK` in that module.
 *
 * **The two builds do not shake alike, and the server one had to be told.**
 * Vite sets `moduleSideEffects: "no-external"` for the client and leaves
 * Rollup's default for SSR, so `dist-server` kept this layout's control points
 * — `new Vector3` at module scope, which Rollup cannot prove is nothing — until
 * `vite.server.config.ts` named the directory as side-effect-free. See the
 * comment there.
 *
 * It is not one of the sixteen banked frames `plans/webgpu-ref` gates on, and
 * it is not in `scripts/collision-hash.mjs`'s `MAPS` — but it IS in the
 * `DEV_MAPS` beside it, which is new with `ENGINE_UPGRADE.md` S9 and is what
 * gives it the fourth thing a map has: a collision bake.
 *
 * **It has one because the AUTHORITY is a thing that has to be measured too.**
 * Everything S0 through S8 priced was a client frame; a match server steps the
 * same simulation for sixteen slots at a fixed 60 Hz under NullEngine, has no
 * canvas and so cannot run `MapBuilder`, and rebuilds the solid world from this
 * bake and nothing else (`server/world.ts`). Without one, the one process whose
 * budget is a TICK could be run on every map in the tree except the only one
 * the size of the map this document exists for. `npm run simulate:dev proving`
 * is what that bought.
 *
 * **The bake is the biggest of the three generated modules and the strictest
 * about not shipping**, so it carries a sentinel of its own — `PG-Boxes`, the
 * fourth string `scripts/check-proving.mjs` greps `dist/` and `dist-server/`
 * for. `PROVING_HEIGHTS_MARK`'s reason exactly, one file over: six thousand
 * rows of numbers carry no other string that could give them away.
 *
 * It still cannot be a MATCH's map, and nothing about this changes that: it is
 * absent from the production `MAPS` above, so `Match` can never be handed it
 * and no rotation can reach it. What it can be is the authority's proving
 * ground, which is the same thing it already was for the client.
 */
const PROVING: MapDef = {
  id: "proving",
  name: "Proving Ground",
  blurb:
    "Not a level. A generated block grid at city density, for measuring what " +
    "a map several times the size of Harrowmead costs to build and to draw.",
  layout: ProvingLayout,
  environment: ProvingEnvironment,
  heights: () => import("./proving/heights"),
  collision: () => import("./proving/collision"),
};

/**
 * Every map that can be played, in the order a picker would show them.
 *
 * The ternary is load-bearing and not a style: `import.meta.env.DEV` folds to a
 * literal at build time, which is what lets Rollup drop `PROVING` and, with it,
 * the two generated modules behind it. Pushing onto this array afterwards, or
 * filtering it at runtime, would keep both in the bundle.
 */
export const MAPS: readonly MapDef[] = import.meta.env.DEV
  ? [HOLLOWMERE, GREYFEN, COLDHARBOUR, HARROWMEAD, SARAB, CINDERHAVEN, KURENAI, PROVING]
  : [HOLLOWMERE, GREYFEN, COLDHARBOUR, HARROWMEAD, SARAB, CINDERHAVEN, KURENAI];

/** What a round starts on with nothing chosen. */
export const DEFAULT_MAP: MapDef = HOLLOWMERE;

/**
 * A map's floor, fetched.
 *
 * `MapDef.heights` is an `import()`, so the module system already caches it and
 * a second call is free — what this adds is the RESOLVED object under the
 * `MapDef` that named it, so that the three callers who cannot wait for a
 * promise can ask for it synchronously afterwards (`heightsOf`).
 *
 * A map with no `heights` resolves to `null` rather than throwing: an absent
 * heightfield is a level floor, which is what `TerrainField` builds from
 * `undefined` and what every map in the tree had before Hollowmere grew a
 * creek. A FAILED fetch is not that and is left to throw — a floor the network
 * ate is a map whose ground is somewhere else, and the callers turn it into a
 * refusal to build rather than a village on a flat plane.
 */
export async function loadHeights(def: MapDef): Promise<Heightfield | null> {
  const held = FLOORS.get(def);
  if (held !== undefined) return held;
  const field = def.heights ? (await def.heights()).default : null;
  FLOORS.set(def, field);
  return field;
}

/**
 * The same floor, if `loadHeights` has already been through for this map.
 * `undefined` means NOT YET — which is a different answer from `null`, a map
 * that is level, and the two must not be collapsed: one is worth waiting for
 * and the other is the finished answer.
 *
 * For the callers that are handed a paint or a build rather than a turn of
 * their own: the menu's schematic, which draws the row under the cursor now
 * and is repainted when the floor lands, and `Game`, which holds the standing
 * map's so that `installMap` stays the one synchronous turn it has to be.
 */
export function heightsOf(def: MapDef): Heightfield | null | undefined {
  return FLOORS.get(def);
}

/**
 * A map's baked collider set, fetched — `loadHeights`' twin, and new with the
 * interface's three maps becoming one drawing.
 *
 * **The bake is no longer the server's alone**, which is the one thing to know
 * before reading `MapDef.collision`'s note above: the menu's dossier draws a
 * schematic of a map nothing has built yet, and the only description of that
 * map's BUILDINGS that exists outside a built world is this. It is a lazy
 * import for exactly the reason it always was — hundreds of kilobytes per map,
 * and a chunk nobody who never opens the map row ever asks for — and the
 * client still builds the real colliders when it builds the world. See
 * `src/ui/MapThumb.ts`, which is the caller and takes the answer as an
 * argument rather than reaching for it.
 *
 * A FAILED fetch is left to throw, as the floor's is, and the caller turns it
 * into a schematic without masses rather than a broken menu: a picture of the
 * ground is a worse map, and no map at all is a hole in the screen.
 */
export async function loadCollision(def: MapDef): Promise<MapCollision> {
  const held = BAKES.get(def);
  if (held) return held;
  const bake = (await def.collision()).default;
  BAKES.set(def, bake);
  return bake;
}

/**
 * The same bake, if `loadCollision` has already been through for this map.
 * `undefined` means NOT YET, exactly as `heightsOf`'s does — with the one
 * difference that there is no "this map has none": every map in the registry
 * names a bake, because the authority cannot run without one.
 */
export function collisionOf(def: MapDef): MapCollision | undefined {
  return BAKES.get(def);
}

/** What `loadCollision` has resolved, per map. Weak for `FLOORS`' reason. */
const BAKES = new WeakMap<MapDef, MapCollision>();

/**
 * What `loadHeights` has resolved, per map.
 *
 * Keyed on the `MapDef` because that is the identity everything else here is
 * held by (see the interface's note), and weak because a def that has gone out
 * of the registry — the DEV proving ground, in a build that folded it away —
 * should take its 100 kB of ground with it.
 */
const FLOORS = new WeakMap<MapDef, Heightfield | null>();
