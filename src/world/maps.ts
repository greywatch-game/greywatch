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

/** Every map that can be played, in the order a picker would show them. */
export const MAPS: readonly MapDef[] = [
  HOLLOWMERE,
  GREYFEN,
  COLDHARBOUR,
  HARROWMEAD,
];

/** What a round starts on with nothing chosen. */
export const DEFAULT_MAP: MapDef = HOLLOWMERE;
