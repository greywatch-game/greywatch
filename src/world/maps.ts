/**
 * maps.ts — The playable maps, as data: what a map IS, and which ones exist.
 * Owns: the `MapDef` pairing of a layout with the environment it is lit and
 * fogged by, and the registry `Game` picks one out of.
 * Invariants: the two halves travel together. A layout is placements and a
 * heightfield; an `EnvironmentSpec` is the palette, fog, sky and particles it
 * is meant to be seen under, and building one against the other's environment
 * gives a night village in daylight fog. Pairing them here is what stops the
 * orchestrator from having to know either name.
 *
 * This is the file a second map is added to, and — with its own `layout.ts`,
 * `heights.ts` and `environment.ts` under a directory of its own — the ONLY
 * existing file it has to touch. Nothing downstream may import a map's modules
 * directly: `Game` holds a `MapDef`, `MapBuilder.build` takes both halves as
 * arguments, and neither special-cases any particular map.
 */
import type { MapCollision } from "./collision";
import type { EnvironmentSpec } from "./environment";
import type { MapLayout } from "./layout";
import { ColdharbourEnvironment } from "./coldharbour/environment";
import { ColdharbourLayout } from "./coldharbour/layout";
import { GreyfenEnvironment } from "./greyfen/environment";
import { GreyfenLayout } from "./greyfen/layout";
import { HarrowmeadEnvironment } from "./harrowmead/environment";
import { HarrowmeadLayout } from "./harrowmead/layout";
import { HollowmereEnvironment } from "./hollowmere/environment";
import { HollowmereLayout } from "./hollowmere/layout";
import { ProvingEnvironment } from "./proving/environment";
import { ProvingLayout } from "./proving/layout";

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
   * The baked collider set, for the multiplayer server — which has no canvas
   * and so cannot run `MapBuilder` at all (see `world/collision.ts`).
   *
   * A LAZY import, and that is the whole reason it is a function. The data is
   * hundreds of kilobytes per map and the browser has no use for it: a client
   * builds the real colliders. Behind `import()` Vite splits it into a chunk
   * nothing in the game ever asks for, so the third half of a map travels with
   * the other two here without riding along in the bundle.
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
    "A business district an hour before dusk. Three floors to hold, glass " +
    "to break, and no fog at all to be missed in.",
  layout: ColdharbourLayout,
  environment: ColdharbourEnvironment,
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
  collision: () => import("./harrowmead/collision"),
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
 * `dist/` AND `dist-server/` for two strings that exist only past this gate.
 *
 * **The two builds do not shake alike, and the server one had to be told.**
 * Vite sets `moduleSideEffects: "no-external"` for the client and leaves
 * Rollup's default for SSR, so `dist-server` kept this layout's control points
 * — `new Vector3` at module scope, which Rollup cannot prove is nothing — until
 * `vite.server.config.ts` named the directory as side-effect-free. See the
 * comment there.
 *
 * It is also absent from `scripts/collision-hash.mjs`'s `MAPS`, so it has no
 * collision bake, cannot be played in a match, and is not one of the sixteen
 * banked frames `plans/webgpu-ref` gates on.
 *
 * `collision` therefore REJECTS rather than importing anything. A map with no
 * bake cannot be a match's map, and the honest way to say so is to fail when
 * asked instead of shipping a stub the server would build a silent, empty world
 * from.
 */
const PROVING: MapDef = {
  id: "proving",
  name: "Proving Ground",
  blurb:
    "Not a level. A generated block grid at city density, for measuring what " +
    "a map several times the size of Harrowmead costs to build and to draw.",
  layout: ProvingLayout,
  environment: ProvingEnvironment,
  collision: () =>
    Promise.reject(
      new Error("the proving ground has no collision bake and cannot be hosted"),
    ),
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
  ? [HOLLOWMERE, GREYFEN, COLDHARBOUR, HARROWMEAD, PROVING]
  : [HOLLOWMERE, GREYFEN, COLDHARBOUR, HARROWMEAD];

/** What a round starts on with nothing chosen. */
export const DEFAULT_MAP: MapDef = HOLLOWMERE;
