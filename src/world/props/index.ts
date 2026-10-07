/**
 * props/index.ts — Scatter prop factories (trees, gravestones, lanterns,
 * fungus, logs, fire drums, rubble, boulders, brambles, barrels, jungle
 * trees). Pure mesh builders: each assembles at the origin and returns a
 * hierarchy; placement/merging/colliders are the caller's job.
 * Invariants: emissive parts (lantern glow, fire, fungus) MUST set
 * metadata.noInk (and noGlow where they shouldn't feed the bloom).
 * Foliage the wind moves calls `marksSway`, and NOTHING a collider stands in
 * for may (`PROP_BODIES` is the list to check) — see `world/sway.ts`.
 * Never set metadata.solid here — colliders come from MapBuilder only.
 * Never call rng() here — the per-prop jitter that makes a stand of
 * trees look like a stand of trees comes from the caller's seeded `rng`, so the
 * same layout builds the same world on every boot (see world/rng.ts).
 * One builder here is NOT a scatter prop and may not become one: the liana
 * veil is built by `buildJungleTree` and parented to its trunk, because a
 * curtain has to hang from a crown and scatter placement is what pushed it
 * away from every crown on the map. Its own header carries the measurement.
 *
 * This file is the set's contract and its barrel: `MapBuilder` imports the
 * builders and `RIM_WOOD` from here. Each prop is a file of its own beside it
 * — `deadTree`, `pine`, `ash`, `jungleTree` (with the liana veil), `palm`,
 * `fern`, `fireDrum`, `boulder` and `cask` — with the few-dozen-line ones
 * together in `small.ts`, the city's dressing in `junk.ts` and the temple
 * valley's three in `maple.ts`. What more than one of them is built from is
 * `geometry.ts` (the shapes), `crown.ts` (the broadleaf crown the ash and the
 * maple share) and `palette.ts` (the shared colours). A prop never imports
 * another prop.
 *
 * Scatter props for Hollowmere — the loose dressing that fills space between
 * the authored buildings. Harvested from the retired room themes; each builder
 * takes `(scene, mats)` — plus an `rng` where the prop is randomised —
 * assembles a parented primitive hierarchy at the origin, and returns the root.
 * Emissive children are tagged `noInk` so the outline shell doesn't swallow
 * their glow.
 *
 * Placement (position, rotation, scale) is the caller's business — unlike the
 * old `PropSpec`, these carry no counts and no transform of their own.
 *
 * **`rng` and `sub` have no default, and must not get one back.** They used
 * to default to `Math.random`, so a caller that forgot a seed built a nav
 * graph that differed between page loads; now it fails to compile. MapBuilder
 * passes the map's seeded streams and `kit:hash` passes fixed ones. A `sub`
 * that defaults to `rng` is still seeded, and is fine.
 */
export { RIM_WOOD } from "./palette";
export { buildDeadTree } from "./deadTree";
export { buildPine } from "./pine";
export { buildAshTree } from "./ash";
export { buildJungleTree } from "./jungleTree";
export { buildFernClump } from "./fern";
export {
  buildButtressLog,
  buildCarvedStele,
  buildGravestone,
  buildFungus,
  buildLog,
  buildBramble,
  buildRubble,
} from "./small";
export { buildFireDrum } from "./fireDrum";
export { buildBoulder } from "./boulder";
export { buildBarrel } from "./cask";
export {
  buildSkip,
  buildBinPair,
  buildPalletStack,
  buildTrafficCone,
  buildLitter,
} from "./junk";
export { buildPalm } from "./palm";
export { buildMaple, buildLeafLitter, buildBamboo } from "./maple";
