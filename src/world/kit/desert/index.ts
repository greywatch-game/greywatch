/**
 * kit/desert/index.ts — The desert-town builders: the flat-roofed courtyard
 * house, the compound wall, the shelled apartment block, the mosque and its
 * minaret, the souk arcade, the four pieces that give a quarter a face — the
 * wind-tower house, the caravanserai, the hammam and the granary — and the two
 * pieces of hard furniture a contested town grows, the T-wall run and the
 * sandbag emplacement.
 * All follow the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata, colliders declared not created) and the
 * four rules in kit/city/index.ts's header about buildings that stack walked
 * floors.
 *
 * This file is the set's contract and its barrel: `BuildingKit.ts` imports
 * the thirteen builders from here, and each building is a file of its own
 * beside it (`adobe.ts`, `shellBlock.ts`, `souk.ts`, `windTower.ts`,
 * `caravanserai.ts`, `hammam.ts`, `granary.ts`), with the mosque and its
 * minaret together in `mosque.ts` and the runs and furniture — the compound
 * wall, the T-wall run, the sandbags and the power pole — in `walls.ts`. What
 * more than one of them is measured or dressed by — the palette, the wall,
 * the slab, the storey, the stair lane and its helpers, the parapets, the
 * window row and the cloth — is `shared.ts`. A builder never imports another
 * builder.
 *
 * ## Why a set rather than parameters on the village kit
 *
 * The kit had three vernaculars in it — a wet northern village, a jungle and a
 * downtown — and a fifth map wanted a fourth. Every one of the existing
 * builders is a shape as much as a palette: a `cottage` is a pitched roof over
 * a rectangle and a `townhouse` is two of them, and no colour makes either read
 * as a courtyard house on a hot plain. What actually distinguishes this
 * vernacular is the ROOF: it is flat, it is WALKED, and it is where half the
 * town lives. Nothing else in the kit has a walked roof at all.
 *
 * So the set exists for one geometric reason and the rest follows from it. A
 * flat roof is a second storey of ground; a parapet is the cover on it; a stair
 * is what makes it reachable; and a town of them is a second surface over the
 * whole map that a fight moves through vertically as well as along.
 *
 * ## The four that are not the workhorse, and what each one argues with
 *
 * `adobeHouse` is nine buildings in ten and that is correct — a town is
 * repetition — but a quarter built out of nothing else is a quarter with no
 * face. The other four are each one DISAGREEMENT with the paragraph above,
 * which is what keeps them from being decoration:
 *
 * - **`windTower`** puts something on the deck. Every other piece of cover in
 *   this set is on the ground or is a roof's own edge, so two squads on the
 *   roofscape is two lines of men against opposite parapets; the barjeel is
 *   2.8 m of solid brick standing in the middle of one.
 * - **`caravanserai`** closes. Every other enclosure here is a compound with a
 *   side left open, which a squad walks into without slowing; this is the one
 *   place on the map the fight has a door.
 * - **`hammam`** breaks the deck. Its roof is walked and has five domes
 *   standing on it, so it is the one terrace you pick your way across instead
 *   of sprinting down.
 * - **`granary`** breaks the alley. Not a building at all — five metres of
 *   solid mud in a footprint you can walk past, which is what an alley of
 *   nothing but walls needs standing in it.
 *
 * ## THE STAIR LANE, which is the one thing to understand before editing
 *
 * `kit/city/` derives it and this set uses it unchanged: a flight is
 * `rise / MAX_WALKABLE_GRADE` long, the slab it climbs to may not cover it, and
 * cutting a void around each flight is worse than leaving a LANE out of the
 * slab. So every building here that is climbed has a lane down its +X edge, the
 * full depth of the footprint and `LANE` wide; the slab above stops short of
 * it; and the flight and its landing live in it.
 *
 * **The lane is why these buildings are DEEP.** A flight is `rise / GRADE` —
 * 10.0 m for a mud-brick storey and 10.9 for a concrete one — and the landing
 * at its head is another `LANDING`. `assertClimbable` throws in a DEV build
 * rather than letting a layout ask for a house too short to get onto its own
 * roof: the failure otherwise is a flight the nav graph declines to link, which
 * reads as bots ignoring a roof rather than as a geometry error.
 *
 * **A single lane is enough for two storeys**, which the office's alternating
 * pair is not needed for here: consecutive flights run in OPPOSITE directions
 * inside the same lane, and the lane has no slab over it at any level, so the
 * whole of it is one open shaft from the ground to the sky. That is what a
 * courtyard house's stair well is, and it costs one rectangle of roof.
 *
 * ## The collider order, which is the design and not the tidying
 *
 * `NavGrid` keeps `MapLayout.surfaces` surfaces per cell and DROPS the overflow
 * in arrival order, so every builder here emits in this order and must go on
 * doing so: **plinth, flights and landings, floor slabs, walls, roof,
 * parapet.** The roof is a walked surface and comes before the parapet standing
 * on it; the parapet is cover and comes last. A ruin's roof is the one
 * exception and it is the rule restated — it is unreachable, so it is emitted
 * after everything a body can stand on.
 *
 * ## The palette
 *
 * Ten colours, and the count is the point. A map's albedo palette is 128
 * entries shared with every other builder it uses, and a vernacular that reads
 * needs a small number of tones differing in VALUE rather than a large number
 * differing in hue: mud brick, its own shade, its limewashed variant, a roof, a
 * beam, a window with nothing behind it, poured concrete's two greys borrowed
 * from `kit/core.ts`, sandbag hessian, scorch, bleached cloth — and one
 * saturated accent, the dome, which is the only chroma on the map and the thing
 * you navigate by from four hundred metres.
 *
 * **The tenth is `CLOTH` and it is the only one that MOVES**, which is why it
 * is a colour of its own rather than a reuse: it is the whole of what the wind
 * reaches in this town, it merges into one group per block because every drape
 * in the set shares it, and it is pale and unsaturated for the two reasons on
 * the constant itself.
 */
export { buildAdobeHouse } from "./adobe";
export { buildCompoundWall, buildBlastWall, buildSandbags, buildPylon } from "./walls";
export { buildShellBlock } from "./shellBlock";
export { buildMosque, buildMinaret } from "./mosque";
export { buildSouk } from "./souk";
export { buildWindTower } from "./windTower";
export { buildCaravanserai } from "./caravanserai";
export { buildHammam } from "./hammam";
export { buildGranary } from "./granary";
