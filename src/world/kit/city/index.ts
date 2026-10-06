/**
 * kit/city/index.ts — The downtown builders: tower, office, shophouse, depot,
 * parkade, and the street furniture that makes a roadway read as one.
 * All follow the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata, colliders declared not created).
 *
 * This file is the set's contract and its barrel: `BuildingKit.ts` imports
 * the eleven builders from here, and each building is a file of its own
 * beside it (`tower.ts`, `office.ts`, `shophouse.ts`, `parkade.ts`,
 * `depot.ts`, `planter.ts`, `monument.ts`), with the street furniture
 * together in `street.ts`. What more than one of them is measured by — the
 * storey, the slab, the grade, the landing, the doorway and the stair lane —
 * is `shared.ts`. A builder never imports another builder.
 *
 * ## The five buildings, and what each one is FOR
 *
 * A downtown that is all one kind of building is a downtown with one kind of
 * fight in it, so each of these answers a different question and none of them
 * is a variation on another:
 *
 * - **`tower`** — not enterable, and the stock the skyline is made of. What it
 *   contributes is silhouette and a wall to a sightline, and both are three
 *   colliders. The others are worth entering partly because it is not. **What
 *   it is NOT allowed to be is a box with windows**, and its header is mostly
 *   about how a building that nothing may go into is given a front door, a
 *   lobby, a service bay and a crown without a fourth collider: a recess is
 *   free, a projection over reach is free, and a lens is free.
 * - **`office`** — a plate you fight ACROSS: one room per storey, cover in the
 *   middle of it, a window band on three bearings.
 * - **`shophouse`** — the opposite at a quarter of the footprint. A shop with
 *   one glazed wall, flats over it cut into rooms, and a passage beside the
 *   shop with a street door of its own. Doorway-scale, and a terrace of them
 *   gives a block face a grain a row of 26 m towers cannot.
 * - **`depot`** — one volume with a gallery round the back of it, so the whole
 *   interior is visible from the whole interior and the only thing that
 *   changes is whether you are four metres up.
 * - **`parkade`** — the same trick with the walls off: three open decks that
 *   all shoot each other.
 *
 * ## What is different about a city block, and why it is a set of its own
 *
 * Everything else in the kit is ONE walked surface with a roof over it. A
 * downtown is the first thing here that stacks them — three floors and a stair
 * between each pair — and stacking is where the world layer's quiet limits
 * live. Four rules come out of it, and every builder below obeys all four:
 *
 * - **A walked surface costs a `NavGrid` slot in every cell of its footprint**,
 *   and the grid keeps `maxSurfaces` of them per cell with the overflow
 *   DROPPED rather than sorted in. So the order colliders are declared in is
 *   part of the design: floors and ramps first, cover and parapets next, roofs
 *   LAST. That is `kit/buildings/manor.ts`'s rule generalised — it emits its roofs last
 *   for exactly this reason — and it is what lets a three-storey block keep all
 *   three of its storeys in the graph while spending its last slot on a
 *   spandrel rather than on a roof nothing can reach. Measured on Coldharbour:
 *   with this order the default 3 already keeps every storey, and the map
 *   states 4 for a slot of margin rather than out of need — see
 *   `MapLayout.surfaces` there. Get the order wrong and the map loses a floor
 *   with the slab still drawn and the stair still climbable.
 * - **A flight is 3.6 m of rise at `MAX_WALKABLE_GRADE`, so it is ten metres
 *   long**, and the slab it climbs to may not cover it — the ceiling would
 *   blank the flight out of the graph and strand the storey. Rather than cut a
 *   void around each flight, every building here puts its flights in a LANE at
 *   one edge and leaves that whole lane out of the slab above: the void is then
 *   one rectangle, the slab is one box, and the lane ALTERNATES between the
 *   two edges storey by storey, so the two voids never stack. The head end of
 *   the lane is floored back to the elevation, which is the LANDING and is what
 *   keeps a flight from arriving at a drop; the void is what is left behind it.
 *   What you get for free is an offset atrium on each side — a hole to shoot up
 *   and down through, which is most of what makes a building worth entering.
 * - **A walked slab needs real depth behind its top face.** `renderOutline`
 *   draws its shell with a slope-scaled negative depth offset, and at the
 *   grazing angle a floor is seen from, a thin slab's shell wins the depth test
 *   and paints the whole floor in its own ink. `SLAB` is 0.5 m for the reason
 *   `WALK_DECK_T` is 0.64 and the manor's board deck was raised off 0.14.
 * - **Mullions and railings are `strut`s, not walls.** A 0.24 m fin is a shape
 *   `NavGrid` can only get wrong, and it is exactly the fence's problem: it has
 *   to stop a round where it is drawn and be no body at all. `MapBuilder`
 *   merges a placement's struts into one collider mesh, which is what makes a
 *   glazed elevation affordable.
 *
 * ## What an enterable building COSTS, which is the budget for the next one
 *
 * **What follows is HISTORY**: no ray picks a mesh any more — `RayWorld`
 * answers every one analytically off the boxes — so the per-mesh bill it
 * argues is what rays used to pay, kept for the reasoning behind the budget.
 *
 * Colliders, and they are paid by every ray in the game. A pick costs per MESH
 * — predicate, matrix inverse, bounding test — so the whole solid set is on the
 * bill for `CombatSystem.fire` on every shot, for sixteen bots' LOS, and for
 * every other pick in the game, wherever on the map the ray is (see
 * `MapBuilder.struts`'s header, which measured 161 loose boxes at ~17% of every
 * ray on Hollowmere). The measurements below were taken with the GROUND PROBE as
 * the instrument, because it was the cheapest whole-scene ray to trigger on
 * demand; it has since stopped being a ray, which retires the instrument and
 * changes nothing about what it measured — the cost is per mesh per pick, and
 * the shot path still pays it.
 *
 * A tower is 3 boxes. `office` is ~50, `parkade` ~35, `shophouse` ~42 and
 * `depot` ~35 — an order of magnitude each, and that is the trade an interior
 * IS. Measured on Coldharbour when the eight shophouses and two depots went in:
 * the map went from **425 solid meshes to 783**, and an A/B in one session
 * (flipping `metadata.solid` on the new meshes, which is the only way to take
 * one out of the loop — Babylon skips its own enabled/visible checks whenever a
 * pick predicate is supplied) put a whole-scene ray at **91 to 180 µs** and a
 * 120 m shot at **93 to 180 µs** over the same 196-ray spray. Call it +95% on
 * every ray, exactly linear in the mesh count.
 *
 * **The ceiling that buys is Hollowmere's 863**, which is what ships.
 * Coldharbour at 783 is
 * still under it, so this changed how expensive the cheap map is and not how
 * expensive the game's worst map is. Another two of these would not be, and
 * that is the number to check before adding them rather than the building count.
 *
 * ## The glass, and where it is allowed to matter
 *
 * Six thousand sheets are drawn here and TWENTY-FOUR of them break, and which
 * twenty-four is answered by what is behind the glass rather than by what is in
 * front of it: a pane is `breakable` where there is enterable space behind it,
 * and is glazing everywhere else.
 *
 * **Glass hung on a solid mass is decoration, and breaking decoration is worse
 * than leaving it alone.** A tower's curtain wall hangs 4 cm off a solid shaft,
 * so a round has always stopped on the concrete behind it, and the brick
 * variant's punched windows are drawn on that shaft too. Shooting either out
 * changes nothing you can play with and costs the elevation its word: a
 * street-level shopfront that shatters into a blank grey shaft is a building
 * admitting it is a box. So it stays whole, the round sparks on the concrete
 * 4 cm behind it, and the sheet is never in `GameMap.panes`, the sweep, the
 * collision bake or the wire at all — see `PaneSpec.breakable`.
 *
 * **One sheet on a tower is see-through and still does not break, and it is
 * the exception that keeps the rule readable.** `buildTower`'s lobby front has
 * a drawn room behind it rather than a shaft, so it is not `backed` — the room
 * is what it is there to show. It is not `breakable` either, because the test
 * has never been whether you can SEE something behind the glass: it is whether
 * you can GET there, and nothing can. A round stops on the podium's own box
 * where the sheet is drawn, exactly as it does on the curtain wall above.
 *
 * The places glass is the ONLY thing in the way are the two SHOPFRONTS —
 * `buildOffice`'s +Z elevation and `buildShophouse`'s, twelve bays each across
 * the map. Both are a wall until somebody shoots them and a way in afterwards,
 * which is why both face the street and why the doorways are on the other
 * sides: a squad holding the doors has an opening they can hear go in behind
 * them. Piers between the bays are ordinary `wall`s so the corners are never
 * glass and the elevation still reads as a building, and each bay is its own
 * pane so one round takes out a bay rather than a frontage.
 *
 * The shophouse cuts its frontage into ONE bay or two depending on its width,
 * which keeps a narrow unit off a sheet too small to be worth a pane and a wide
 * one off a sheet a burst of twelve shards cannot cover: its bays measure 7.8
 * and 11.6 m² against the offices' 11.5 and 12.5. It also holds the line on the
 * count — a terrace of eight added twelve breakable sheets and not twenty-four.
 *
 * The tower's glazing is one sheet per storey per side, and what divides it
 * is DRAWN: the mullions, fins and column covers of its curtain-wall system
 * stand over the sheet, so the elevation reads as panels in a frame rather
 * than as one mirror hung on a block. It was a sheet per bay before the
 * system was drawn, and that bought nothing but sheets — the same triangles
 * either way, every one of them merged into the same mesh.
 *
 * ## The light budget, which is what decides what is drawn here
 *
 * **A LENS is free and a LIGHT is one of sixteen, and almost everything in this
 * file follows from that.** `Build.glow` is an emissive box: it takes the
 * glow's bloom and `EmissiveFog`'s per-pixel fade for nothing and spends
 * no shader slot at all. `Build.light` spends one, `LightingSystem` uploads the
 * sixteen nearest, and there is no arbitration beyond distance — so an
 * unbudgeted fixture is not a fixture that costs a little, it is an interior
 * somewhere going dark.
 *
 * This set used to say there were no street fixtures at all, and under the
 * afternoon sun the map shipped with that was right: a lamp had nothing to do.
 * The map moved its hour (see `coldharbour/environment.ts`) and the rule became
 * a split rather than a refusal — **every street light carries a lens and only
 * the ones a layout marks `lit` carry a light**, which on Coldharbour is eight
 * of twenty. Shop signs are lenses only, for the same arithmetic: a `flicker`
 * is visible on a light and not on an emissive, so `LightSpec`'s anticipated
 * "neon ~.9" stays unused until something can afford a slot for it.
 *
 * `litWindows` is the other spender, and every enterable building here takes
 * it: two lights for an office or a depot, three for a shophouse, and one for
 * a tower's lobby — which is the one that is NOT an interior and is here
 * because thirty-seven towers could never each have had one. No placement
 * states it on a tower; what a tower's own floors are lit by is `Build.glow`,
 * which spends no slot at all. **An interior
 * on a daylit map is lit by the ambient and the sky term, and the sky term is
 * applied by `n.y`** — so it lands in full on a floor and not at all on a
 * ceiling, and a room with no fixture in it comes out as a bright plate under a
 * black lid. That is also why the depot's hall lamp hangs
 * at the girders rather than at head height, and why its gallery's hangs
 * mid-span: everything above and beyond a point light in an enclosed room is on
 * the ambient term alone, because the key is shadowed out by the roof.
 *
 * The count is the thing to watch rather than any one lamp. Coldharbour carries
 * about two dozen interior fixtures and eight outdoor ones against the shader's
 * sixteen slots. **`LightingSystem` scores by `distance - range` and never
 * culls by range**, so a fixture well out of its own reach still takes a slot
 * ahead of a nearer-to-nothing one — which means the budget is about where
 * fixtures are CLUSTERED, not how many there are. Coldharbour's worst case is
 * a firefight on the civic square with all eight lamps in contention, four
 * muzzle flashes and a grenade: thirteen of sixteen. Lighting all twenty
 * columns is what the budget refuses, not lighting any.
 */
export { buildTower } from "./tower";
export { buildOffice } from "./office";
export { buildShophouse } from "./shophouse";
export { buildParkade } from "./parkade";
export { buildDepot } from "./depot";
export { buildPlanter } from "./planter";
export { buildBarrier, buildQuay, buildCar, buildStreetLight } from "./street";
export { buildMonument } from "./monument";
