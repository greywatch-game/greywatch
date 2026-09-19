/**
 * coldharbour/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, the two vehicle hardstandings, the civic
 * square's lawn and the sea. The floor's shape is generated data and lives in
 * heights.ts.
 * The first map with `vehicles` on it, and the avenues are why: sixteen metres
 * wide, four each way, and one runs the full 320 m. See `vehicles` below.
 * Harrowmead is the other, and it answers the same question with open country
 * rather than with a street.
 * Consumed by MapBuilder; nothing here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls;
 * a control point's pos must NOT sit inside a collider (surfaceAt returns -1);
 * scatter clearance values must match prop collider extents. A second map is
 * one new file shaped like this plus an EnvironmentSpec.
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

/**
 * COLDHARBOUR — the business district, mid-afternoon, with the fighting in the
 * streets.
 *
 * **320 x 320 m**, origin at the map centre, +Z is north. It is the first map
 * that is not 240: `MapLayout.size` states it and everything downstream takes
 * the extent as an argument, so nothing here is a special case. It is also the
 * first that stacks floors, which is what `surfaces: 4` at the bottom pays for
 * — see `MapLayout.surfaces` and the header of `world/kit/city.ts`.
 *
 * ## The plan
 *
 * Four avenues each way, 16 m wide, on centrelines at ±40 and ±120. That cuts
 * the map into a 5 x 5 of blocks: three bands of 64 m and, outside them, two of
 * 32 m against the boundary.
 *
 *      z=+160  +----+------+------+------+----+
 *              | 26 |  ##  |  ##  |  ##  | 26 |
 *      z=+120  ~~~~~~ avenue ~~~~~~~~~~~~~~~~~~
 *              | ## | A ss |  ##  | D ss | ## |     A  the Exchange (office)
 *      z= +40  ~~~~~~ avenue ~~~~~~~~~~~~~~~~~~     D  the Terminal forecourt
 *              | ## |  ##  |  C   |  ##  | ## |     C  the civic square
 *      z= -40  ~~~~~~ avenue ~~~~~~~~~~~~~~~~~~     B  the parkade
 *              | ## |ss dp |  ##  |E ss  | ## |     E  the tower plaza (office)
 *      z=-120  ~~~~~~ avenue ~~~~~~~~~~~~~~~~~~     ss shophouse terrace
 *              | dp |  the quayside, open to the avenues that feed it  |
 *      z=-152  ======================== the quay =========================
 *              ~~~~~~~~~~~~~~~~~~~~~~~~~ THE SEA ~~~~~~~~~~~~~~~~~~~~~~~~~
 *             x=-160  -120   -40    +40   +120  +160
 *
 * The five flags are the centre block and the four blocks diagonally off it, so
 * every one is 113 m from C and 160 m from its neighbours, and the two home
 * yards are the far corner blocks — the NW and SE 32 m squares, left empty
 * because a spawn wants ground rather than a lobby.
 *
 * ## The city is ON a coast now, and that is what the south band is
 *
 * **The map used to be closed on all four sides by a valley rim** — an
 * escarpment drawn over the four boundary boxes, pitched shallow (0.17) because
 * with `fogEnd` at 480 you could see it from anywhere. That was the last rim in
 * the tree and it was the wrong landform twice over: a business district does
 * not sit in a bowl, and a wall thirty metres behind the outer block face is a
 * wall telling a player standing on an avenue that the world stops there.
 *
 * So the boundary is open now (`borderland` at the bottom of this file), and
 * what closes the horizon is two different things on two different bearings:
 * **hills on the north, east and west, and the OPEN SEA on the south**
 * (`ridge.form: "downs"` with a `mouth` across the southern side — see both
 * fields, and `RidgeMouth` for what a mouth is). The two ranges run down into
 * the water at the south-east and south-west corners as headlands, which is
 * what the mouth's `ease` is drawing.
 *
 * **What it cost inside the play square is the southern row of towers, and
 * that is a real change to the map rather than dressing.** Seven of them stood
 * in the outer 32 m band — six across the frontage and the corner tower in the
 * south-west — and that band had 3 m of ground between a tower's back wall and
 * the boundary. There is no way to put a waterfront in three metres, so the
 * row came out and the band is a quayside: 24 m of open ground from the avenue
 * kerb at z = -128 to the quay's own line at z = -152, with a carriageway
 * along it, a goods depot anchoring the west end, and the four north-south
 * avenues running down into it.
 *
 * **What that does to the fight is worth stating, because it is the price.**
 * The south flank was a run of blind tower faces and is now the most OPEN
 * ground on the map after the civic square — crossable, overlooked from every
 * storey of the blocks behind it, and the one place on Coldharbour where
 * nothing breaks a 300 m line except what has been put there on purpose. The
 * barriers, the crates and the parked cars along it are that purpose; they are
 * laid on the bounds an attacker actually uses, the same way the square's
 * furniture is. It is also the approach to B and to team 1's yard, so it is
 * not a backdrop.
 *
 * **Colliders, measured, because `kit/city.ts` owns that budget and says there
 * is not much room left.** What every ray in the game is priced on is the
 * SOLID MESH count, and it goes **807 to 821** — 1.7%, against the 95% the
 * mixed-use stock cost when it went in. The bake moves with it: 768 boxes to
 * **800**, plus 180 strut boxes in 10 groups. Out was seven towers at 3
 * boxes each; in is eight quay runs at two apiece with their bollards merged
 * into one strut mesh each, one `depot`, three barriers, three crate stacks
 * and two cars. **The trees are free** — everything sown in the borderland is
 * non-blocking, so it emits no collider and no `WorldBox` and the bake does
 * not know it exists. A ninth BUILDING here is the thing to think twice about;
 * a tenth barrier is not.
 *
 * ## What each flag is, and why they are four different things
 *
 * - **C, the civic square.** A whole 64 m block of paving with the flag in the
 *   middle of it and a monument off to one side. It is the only objective on
 *   the map that is pure open ground, four streets feed it, and the towers
 *   round it overlook every metre — so it is the one you take last and lose
 *   first. What makes it crossable at all is the furniture: planters, a barrier
 *   run and two cars, laid on the diagonals a crossing actually uses.
 * - **A and E, the offices.** Three walked floors each, two entrances, a stair
 *   at one edge and a window band with chest-high cover round every upper
 *   storey. The flag stands on the GROUND floor, and the capture zone is a
 *   cylinder — so the storeys above it are inside the zone too, and holding one
 *   means holding a building rather than a circle.
 * - **B, the parkade.** The same trick with the roof off: three open decks, two
 *   ramps, and 0.95 m of upstand as the only cover. Every deck is inside the
 *   zone and every deck can shoot every other one, which no other objective in
 *   the game does.
 * - **D, the terminal forecourt.** Open ground under a long low hall, with
 *   planters and a tower for cover and no interior at all. It is the fast flag,
 *   and it is deliberately the one that plays like Hollowmere's square.
 *
 * ## The mixed-use stock, and what it is doing between the towers
 *
 * Eight `shophouse`s in four terraces and two `depot`s, all of them enterable,
 * and three of the towers gave up their plots for them. They are not near a
 * flag by accident and they are not on one either: each pair stands on the
 * block face BESIDE an objective — the two north of A, the two either side of
 * the terminal block, the two east of E, and the terrace and depot south of B —
 * so every flag but C now has a covered bound on its approach that somebody can
 * be holding. C stays open ground on purpose; it is the objective the whole
 * plan turns on being crossable and exposed.
 *
 * The second thing they do is the elevation. A block face of 26 m towers is one
 * building repeated, and a street reads at the scale of its FRONTAGES: a 13 m
 * shopfront with a blind over it and flats above puts a rhythm on the same
 * hundred metres that no arrangement of towers can. The storey count picks the
 * material (see `buildShophouse`), so a terrace written as a run of placements
 * comes out mixed without a layout naming a colour.
 *
 * **What they cost is colliders, and it is the number to check before adding a
 * ninth.** An enterable building is 35–50 boxes against a tower's 3, and these
 * ten took the map from 425 solid meshes to 783 — about +95% on every ray in
 * the game, measured. That is still under Hollowmere's shipped 863, and there
 * is not much room left; see `world/kit/city.ts`'s header, which owns the
 * budget.
 *
 * ## The sightlines, which are the thing this map exists to have
 *
 * An avenue runs the full 320 m and nothing breaks it. That is not an oversight
 * — with the fog wall gone (see `environment.ts`) it is the first map where a
 * weapon's own `range` is the binding constraint rather than the weather, and
 * those numbers are 45 m for the pistol, 70 for the SMG, 120 for the rifle and
 * 180 for the DMR. So a street here is a place where the DMR is finally worth
 * its recoil and everything else has to close. What the parked traffic, the
 * barrier runs and the planters do is break the line at CHEST height at
 * intervals, so closing one is a series of covered bounds rather than a walk.
 *
 * Bots are the other half of it: `bots.perception.engageRange` is 55 m and did
 * not move with the fog, so a bot will not open up down an avenue it can see
 * the whole length of. That is deliberate and it is what keeps the streets
 * crossable at all — the fight happens at the junctions, in the buildings and
 * on the square, and the long lanes belong to the player.
 *
 * ## Layout hygiene (keep to these)
 *
 * - Structures are axis-aligned (`rotY` in multiples of pi/2). The parked cars
 *   are the exception the editor already makes for a cart.
 * - Nothing but kerb furniture stands in a carriageway. A building that reaches
 *   into one seals a route the whole plan depends on.
 * - Scatter regions stay clear of the flags by their own radius plus the prop's
 *   half-length; see the note above `scatter`.
 */

const placements: Placement[] = [
  // The four avenues each way, one slab apiece. Visual only — nothing stands on
  // a road, and the slab is sunk so its top sits a centimetre proud of the
  // floor. They overlap at the sixteen junctions and must: roads merge into ONE
  // mesh per material, which is what stops a junction z-fighting between two of
  // them.
  //
  // **300 m, not 320, and the twenty metres are load-bearing.** A road whose
  // ground is not level is re-cut against the heightfield by `terrainSlab`, and
  // a re-cut road takes the contoured path — which carries no lane markings,
  // because a dash is a box laid on a plane and a contoured slab is not one.
  // Run one out to the boundary and it catches the 1.2 m skirt in the last
  // eight metres (see heights.ts), so every avenue on the map silently lost its
  // centre line to two vertices at its far end. Stopping at +/-150 keeps all
  // eight on flat ground and on the fast path.
  { kind: "road", x: -120, z: 0, params: { surface: "asphalt", width: 16, length: 300 } },
  { kind: "road", x: -40, z: 0, params: { surface: "asphalt", width: 16, length: 300 } },
  { kind: "road", x: 40, z: 0, params: { surface: "asphalt", width: 16, length: 300 } },
  { kind: "road", x: 120, z: 0, params: { surface: "asphalt", width: 16, length: 300 } },
  { kind: "road", x: 0, z: -120, rotY: Math.PI / 2, params: { surface: "asphalt", width: 16, length: 300 } },
  { kind: "road", x: 0, z: -40, rotY: Math.PI / 2, params: { surface: "asphalt", width: 16, length: 300 } },
  { kind: "road", x: 0, z: 40, rotY: Math.PI / 2, params: { surface: "asphalt", width: 16, length: 300 } },
  { kind: "road", x: 0, z: 120, rotY: Math.PI / 2, params: { surface: "asphalt", width: 16, length: 300 } },

  // **The square is a LAWN with four paths across it, and the paving experiment
  // it replaced is worth stating.** The block was laid as one 64 m cobble slab
  // first, and cobblestone is the kit's one warm texture: a tan floor in the
  // middle of a grey city read as a sandpit and nothing else on the map agreed
  // with it. The lesson there was about AREA, not about the material — 4,096
  // square metres of the one warm thing on the map. So the cobble is back, at
  // a tenth of the coverage and against green instead of grey, as the four
  // paths that lead to the monument. Swapping them to `surface: "asphalt"` is
  // a one-word change per line if that reads better in the end.
  //
  // The grass is the `grass` rects at the bottom of this file, and it grows
  // only where they say: `GrassSystem` is told the rectangles, so the paths
  // and the kerbs stay bare because no rect covers them. It is not a collider
  // and not navigation — a lawn is paint.
  { kind: "monument", x: 0, z: 0, params: { width: 11 } }, // the square's landmark
  // Out of the monument's bottom step (it reaches 5.5 m) to the avenue kerb at
  // 32, so each path is 27 m long and the four of them quarter the block. The
  // lawns are laid to the same lines with 2 m to spare either side.
  { kind: "road", x: 0, z: 18.5, params: { width: 4, length: 27 } },
  { kind: "road", x: 0, z: -18.5, params: { width: 4, length: 27 } },
  { kind: "road", x: 18.5, z: 0, rotY: Math.PI / 2, params: { width: 4, length: 27 } },
  { kind: "road", x: -18.5, z: 0, rotY: Math.PI / 2, params: { width: 4, length: 27 } },

  // --- the built blocks -----------------------------------------------------
  // Towers are solid and carry three colliders each; the two offices and the
  // parkade are the enterable ones. Heights are deliberately uneven and the
  // brick/glass split is derived from height alone (see `buildTower`), so a
  // block reads as having been built over a century rather than at once.
  { kind: "tower", x: -15, z: -95, params: { width: 26, depth: 26, height: 37 } },
  { kind: "tower", x: 15, z: -95, params: { width: 26, depth: 26, height: 22 } },
  { kind: "tower", x: -15, z: -65, params: { width: 26, depth: 26, height: 46 } },
  { kind: "tower", x: 15, z: -65, params: { width: 26, depth: 26, height: 14 } },
  { kind: "tower", x: 0, z: 65, params: { width: 58, depth: 26, height: 41 } },
  { kind: "tower", x: 0, z: 95, params: { width: 58, depth: 26, height: 27 } },
  { kind: "tower", x: -92, z: 0, params: { width: 34, depth: 58, height: 50 } },
  { kind: "tower", x: -63, z: -15, params: { width: 22, depth: 26, height: 16 } },
  { kind: "tower", x: -63, z: 15, params: { width: 22, depth: 26, height: 29 } },
  { kind: "tower", x: 80, z: -22, params: { width: 58, depth: 12, height: 13 } },
  { kind: "tower", x: 80, z: 22, params: { width: 58, depth: 12, height: 15 } },
  { kind: "tower", x: 57, z: 0, params: { width: 12, depth: 30, height: 32 } },
  { kind: "tower", x: 103, z: 0, params: { width: 12, depth: 30, height: 25 } },
  { kind: "office", x: -80, z: 66, params: { width: 30, depth: 24, floors: 3, litWindows: true } }, // A
  { kind: "tower", x: -95, z: 96, params: { width: 34, depth: 26, height: 33 } },
  // A pair of shophouses where a 20 m tower stood: the block face onto the
  // north avenue, at the scale a street is actually read at. See the note
  // above this array on what the mixed-use stock is for.
  { kind: "shophouse", x: -68.5, z: 98, params: { width: 13, depth: 16, floors: 3, tint: "#5c5340", litWindows: true, sign: "#ff5f7a" } },
  { kind: "shophouse", x: -55.5, z: 98, params: { width: 13, depth: 16, floors: 2, tint: "#7c4a3f", sign: "#4fd6ff" } },
  { kind: "parkade", x: -80, z: -78, params: { width: 36, depth: 26, floors: 3 } }, // B
  // The strip between the parkade and the south avenue, built out to the
  // pavement: two shops with flats over them and a goods depot backing onto
  // the car park. It is the densest bit of fabric on the map and it is
  // deliberately the approach to B — a bound of covered interior on the one
  // side of the objective an attacker would otherwise cross in the open.
  { kind: "shophouse", x: -105, z: -56.6, params: { width: 13, depth: 16, floors: 3, tint: "#7c4a3f", litWindows: true, sign: "#ffc63c" } },
  { kind: "shophouse", x: -92, z: -56.6, params: { width: 13, depth: 16, floors: 2, tint: "#4a5a4a", sign: "#7dff9e" } },
  { kind: "depot", x: -70, z: -56.6, params: { width: 28, depth: 16, litWindows: true } },
  { kind: "tower", x: -95, z: -100, params: { width: 34, depth: 14, height: 17 } },
  { kind: "tower", x: -62, z: -100, params: { width: 24, depth: 14, height: 12 } },
  { kind: "tower", x: 80, z: 96, params: { width: 58, depth: 26, height: 15 } },
  // Fronting the avenue at the east end of the terminal block, backs to the
  // yard behind. Turned to face -Z, which is the street here.
  { kind: "shophouse", x: 90.5, z: 62, rotY: Math.PI, params: { width: 11, depth: 16, floors: 3, tint: "#3f4b52", sign: "#ff7a3c" } },
  { kind: "shophouse", x: 101.5, z: 62, rotY: Math.PI, params: { width: 11, depth: 16, floors: 2, tint: "#6b4a2f", litWindows: true, sign: "#c46cff" } },
  { kind: "office", x: 78, z: -66, params: { width: 28, depth: 24, floors: 3, litWindows: true } }, // E
  { kind: "tower", x: 94, z: -98, params: { width: 34, depth: 26, height: 44 } },
  { kind: "depot", x: 62, z: -98, rotY: Math.PI, params: { width: 22, depth: 16, litWindows: true } },
  // East of E, turned to face the avenue at x = +120: the flank a squad
  // holding the office has to watch, and now somewhere to watch it from.
  { kind: "shophouse", x: 103, z: -71.5, rotY: Math.PI / 2, params: { width: 11, depth: 16, floors: 2, tint: "#7c4a3f", sign: "#39e0d0" } },
  { kind: "shophouse", x: 103, z: -60.5, rotY: Math.PI / 2, params: { width: 11, depth: 16, floors: 3, tint: "#4a5a4a", litWindows: true, sign: "#ff4f4f" } },
  // --- the waterfront -------------------------------------------------------
  //
  // **The quay is EIGHT runs of forty metres laid end to end, and the runs
  // touching is the one thing about it that is not a look.** There is no
  // swimming in this game, so a gap in the parapet is a body on the seabed
  // outside the play square with the leash counting down, and it would be
  // found in the first round. They stand at z = -152, which is where the
  // heightfield falls away (see heights.ts): a `quay` hangs DOWN from the
  // ground plane it is placed on, so the street runs out over the drop instead
  // of stopping at a lip, and the 4 m deck plus the parapet outboard of it
  // puts the coping at about z = -156.2 with the water 2.2 m below.
  //
  // The parapet is 1.0 m, which is under `cover.crouchHeight` (1.3) — 320 m of
  // continuous HARD cover along one edge of the map would be a gift to whoever
  // held it. It steers a body and stops nothing, exactly as a parked car does.
  { kind: "quay", x: -140, z: -152, params: { length: 40 } },
  { kind: "quay", x: -100, z: -152, params: { length: 40 } },
  { kind: "quay", x: -60, z: -152, params: { length: 40 } },
  { kind: "quay", x: -20, z: -152, params: { length: 40 } },
  { kind: "quay", x: 20, z: -152, params: { length: 40 } },
  { kind: "quay", x: 60, z: -152, params: { length: 40 } },
  { kind: "quay", x: 100, z: -152, params: { length: 40 } },
  { kind: "quay", x: 140, z: -152, params: { length: 40 } },
  // The quayside carriageway, and it stops at x = -120 rather than running the
  // full width: the depot below is on the last thirty metres, and a road under
  // a building is the one thing this file's own hygiene note forbids. It is
  // asphalt like every other road here, so it merges into the same mesh and
  // the four junctions with the avenues cannot z-fight.
  { kind: "road", x: 15, z: -146.5, rotY: Math.PI / 2, params: { surface: "asphalt", width: 9, length: 270 } },
  // The one building left on the frontage, at the west end where the corner
  // tower was. It is here to do two things the open band cannot: give the
  // quayside a mass to read its length against, and put a covered bound on the
  // approach to B from the south-west — which is the block the parkade's own
  // terrace already does on the other side.
  { kind: "depot", x: -144, z: -138, params: { width: 28, depth: 16, litWindows: true } },
  // Lamps on the quayside kerb, 1.6 m off it like every other column on the
  // map, and all four are LENSES — see the note above on the sixteen-slot
  // budget. Nothing is fought over out here at the range a lamp lights.
  { kind: "streetLight", x: -110.4, z: -140.4, params: { height: 7.5 } },
  { kind: "streetLight", x: -49.6, z: -140.4, params: { height: 7.5 } },
  { kind: "streetLight", x: 30.4, z: -140.4, params: { height: 7.5 } },
  { kind: "streetLight", x: 110.4, z: -140.4, params: { height: 7.5 } },
  // What breaks the frontage at chest height. Laid between the avenue mouths
  // rather than across them, so a bound down an avenue onto the quay is still
  // a bound and not a blocked one.
  { kind: "barrier", x: -86, z: -137, rotY: Math.PI / 2, params: { length: 12 } },
  { kind: "barrier", x: 8, z: -137, rotY: Math.PI / 2, params: { length: 12 } },
  { kind: "barrier", x: 92, z: -137, rotY: Math.PI / 2, params: { length: 12 } },
  // Cargo off the quay, and the only hard cover on it — 2.3 m, so these are
  // what an attacker actually crosses between.
  { kind: "crates", x: -60, z: -138 },
  { kind: "crates", x: 62, z: -137 },
  { kind: "crates", x: 126, z: -139 },
  { kind: "car", x: -24, z: -149.6, params: { tint: "#4a4f45" } },
  { kind: "car", x: 74, z: -149.6, params: { tint: "#6b463a" } },
  { kind: "tower", x: -144, z: -95, params: { width: 26, depth: 26, height: 33 } },
  { kind: "tower", x: -144, z: -65, params: { width: 26, depth: 26, height: 19 } },
  { kind: "tower", x: 144, z: -95, params: { width: 26, depth: 26, height: 26 } },
  { kind: "tower", x: 144, z: -65, params: { width: 26, depth: 26, height: 38 } },
  { kind: "tower", x: -144, z: -15, params: { width: 26, depth: 26, height: 17 } },
  { kind: "tower", x: -144, z: 15, params: { width: 26, depth: 26, height: 23 } },
  { kind: "tower", x: 144, z: -15, params: { width: 26, depth: 26, height: 30 } },
  { kind: "tower", x: 144, z: 15, params: { width: 26, depth: 26, height: 20 } },
  { kind: "tower", x: -144, z: 65, params: { width: 26, depth: 26, height: 34 } },
  { kind: "tower", x: -144, z: 95, params: { width: 26, depth: 26, height: 27 } },
  { kind: "tower", x: 144, z: 65, params: { width: 26, depth: 26, height: 16 } },
  { kind: "tower", x: 144, z: 95, params: { width: 26, depth: 26, height: 29 } },
  { kind: "tower", x: -95, z: 144, params: { width: 26, depth: 26, height: 22 } },
  { kind: "tower", x: -65, z: 144, params: { width: 26, depth: 26, height: 35 } },
  { kind: "tower", x: -15, z: 144, params: { width: 26, depth: 26, height: 18 } },
  { kind: "tower", x: 15, z: 144, params: { width: 26, depth: 26, height: 25 } },
  { kind: "tower", x: 65, z: 144, params: { width: 26, depth: 26, height: 32 } },
  { kind: "tower", x: 95, z: 144, params: { width: 26, depth: 26, height: 24 } },
  { kind: "tower", x: 144, z: 144, params: { width: 26, depth: 26, height: 31 } },

  // --- the street, as furnished ---------------------------------------------
  // All of this is one collider apiece and all of it is cover.
  //
  // **Every lamp carries a LENS and eight of the twenty carry a LIGHT**, and
  // the split is the sixteen-slot budget made concrete rather than a statement
  // about which lamps are switched on — a city's lamps come on together. A
  // lens is `Build.glow` and costs no slot; a light is one of sixteen,
  // uploaded nearest-first, and twenty of them out here would evict the
  // interior fixtures the lit buildings are legible by. So the eight are the
  // ones whose pool of light falls somewhere a player actually stands: the
  // square's own four, and the junction lamp nearest each of A, B, D and E.
  //
  // The eight are also the eight NEAREST THE MIDDLE, because the lamp grid's
  // inner ring is what happens to sit closest to the four diagonal flags — so
  // the worst case is a firefight on the civic square, where all eight can
  // contend at once. `LightingSystem` scores a fixture by `distance - range`
  // and does not cull by range at all, so the four junction lamps 47 m out
  // still take slots ahead of any interior further off; with up to four muzzle
  // flashes (`Game.spendMuzzleLightBudget`) and a grenade taken off the top,
  // that is thirteen of sixteen and three left for interiors nobody standing
  // on the square is inside of. That is the tightest this map gets, and it is
  // the reason the other twelve columns are lenses.
  //
  // This file used to say the lamps carry no light at all, and at three in the
  // afternoon that was right; see coldharbour/environment.ts on the hour.
  { kind: "planter", x: -18, z: 4, params: { width: 2.6, depth: 1.4 } },
  { kind: "planter", x: 16, z: -7, params: { width: 2.6, depth: 1.4 } },
  { kind: "planter", x: 2.5, z: 13.5, rotY: Math.PI / 2, params: { width: 2.6, depth: 1.4 } },
  { kind: "planter", x: 2.5, z: -15.5, rotY: Math.PI / 2, params: { width: 2.6, depth: 1.4 } },
  { kind: "barrier", x: 2, z: -25, params: { length: 8 } },
  { kind: "barrier", x: -24, z: 4, rotY: Math.PI / 2, params: { length: 8 } },
  { kind: "car", x: 24, z: -33.5, params: { tint: "#a8352e" } },
  { kind: "car", x: -34, z: -22, rotY: Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "streetLight", x: -129.6, z: -129.6, params: { height: 7.5 } },
  { kind: "streetLight", x: -129.6, z: -49.6, params: { height: 7.5 } },
  { kind: "streetLight", x: -129.6, z: 30.4, params: { height: 7.5 } },
  { kind: "streetLight", x: -129.6, z: 110.4, params: { height: 7.5 } },
  { kind: "streetLight", x: -49.6, z: -129.6, params: { height: 7.5 } },
  { kind: "streetLight", x: -49.6, z: -49.6, params: { height: 7.5, lit: true } },
  { kind: "streetLight", x: -49.6, z: 30.4, params: { height: 7.5, lit: true } },
  { kind: "streetLight", x: -49.6, z: 110.4, params: { height: 7.5 } },
  { kind: "streetLight", x: 30.4, z: -129.6, params: { height: 7.5 } },
  { kind: "streetLight", x: 30.4, z: -49.6, params: { height: 7.5, lit: true } },
  { kind: "streetLight", x: 30.4, z: 30.4, params: { height: 7.5, lit: true } },
  { kind: "streetLight", x: 30.4, z: 110.4, params: { height: 7.5 } },
  { kind: "streetLight", x: 110.4, z: -129.6, params: { height: 7.5 } },
  { kind: "streetLight", x: 110.4, z: -49.6, params: { height: 7.5 } },
  { kind: "streetLight", x: 110.4, z: 30.4, params: { height: 7.5 } },
  { kind: "streetLight", x: 110.4, z: 110.4, params: { height: 7.5 } },
  { kind: "streetLight", x: -14, z: 4.5, rotY: Math.PI / 2, params: { height: 7.5, lit: true } },
  { kind: "streetLight", x: 12.5, z: -7.5, rotY: -Math.PI / 2, params: { height: 7.5, lit: true } },
  { kind: "streetLight", x: 0, z: -34, params: { height: 7.5, lit: true } },
  { kind: "streetLight", x: 0, z: 34, params: { height: 7.5, lit: true } },
  { kind: "car", x: -46, z: -136, rotY: Math.PI / 2, params: { tint: "#3f4b52" } },
  { kind: "car", x: -46, z: -104, rotY: Math.PI / 2, params: { tint: "#3f4b52" } },
  { kind: "car", x: -46, z: -70, rotY: Math.PI / 2, params: { tint: "#2f5f9c" } },
  { kind: "car", x: -46, z: 70, rotY: Math.PI / 2, params: { tint: "#3f4b52" } },
  { kind: "car", x: -46, z: 104, rotY: Math.PI / 2, params: { tint: "#3f4b52" } },
  { kind: "car", x: -46, z: 136, rotY: Math.PI / 2, params: { tint: "#3f4b52" } },
  { kind: "car", x: 46, z: -118, rotY: Math.PI / 2, params: { tint: "#6b463a" } },
  { kind: "car", x: 46, z: -84, rotY: Math.PI / 2, params: { tint: "#c2762a" } },
  { kind: "car", x: 46, z: -56, rotY: Math.PI / 2, params: { tint: "#6b463a" } },
  { kind: "car", x: 46, z: 56, rotY: Math.PI / 2, params: { tint: "#6b463a" } },
  { kind: "car", x: 46, z: 84, rotY: Math.PI / 2, params: { tint: "#6b463a" } },
  { kind: "car", x: 46, z: 118, rotY: Math.PI / 2, params: { tint: "#6b463a" } },
  { kind: "car", x: -136, z: -46, params: { tint: "#4a4f45" } },
  { kind: "car", x: -104, z: -46, params: { tint: "#4a4f45" } },
  { kind: "car", x: -70, z: -46, params: { tint: "#3f7d5a" } },
  { kind: "car", x: 70, z: -46, params: { tint: "#4a4f45" } },
  { kind: "car", x: 104, z: -46, params: { tint: "#4a4f45" } },
  { kind: "car", x: 136, z: -46, params: { tint: "#4a4f45" } },
  { kind: "car", x: -118, z: 46, params: { tint: "#2f3338" } },
  { kind: "car", x: -84, z: 46, params: { tint: "#8d3f7a" } },
  { kind: "car", x: -56, z: 46, params: { tint: "#2f3338" } },
  { kind: "car", x: 56, z: 46, params: { tint: "#2f3338" } },
  { kind: "car", x: 84, z: 46, params: { tint: "#2f3338" } },
  { kind: "car", x: 118, z: 46, params: { tint: "#b8a63c" } },
  { kind: "barrier", x: -40, z: 90, params: { length: 12 } },
  { kind: "barrier", x: -40, z: -30, params: { length: 12 } },
  { kind: "barrier", x: 40, z: 30, params: { length: 12 } },
  { kind: "barrier", x: 40, z: -90, params: { length: 12 } },
  { kind: "barrier", x: -90, z: -40, rotY: Math.PI / 2, params: { length: 12 } },
  { kind: "barrier", x: 30, z: -40, rotY: Math.PI / 2, params: { length: 12 } },
  { kind: "barrier", x: -30, z: 40, rotY: Math.PI / 2, params: { length: 12 } },
  { kind: "barrier", x: 96, z: 40, rotY: Math.PI / 2, params: { length: 12 } },
  { kind: "planter", x: 58, z: 56, params: { width: 2.6, depth: 1.4 } },
  { kind: "planter", x: 72, z: 50, params: { width: 2.6, depth: 1.4 } },
  { kind: "planter", x: 52, z: 74, params: { width: 2.6, depth: 1.4 } },
  { kind: "planter", x: -98, z: 50, params: { width: 2.6, depth: 1.4 } },
  { kind: "planter", x: -62, z: 50, params: { width: 2.6, depth: 1.4 } },
  { kind: "planter", x: 60, z: -50, params: { width: 2.6, depth: 1.4 } },
  { kind: "planter", x: 92, z: -50, params: { width: 2.6, depth: 1.4 } },
];

/**
 * What the city has instead of undergrowth: rubble where a facade has come
 * down, oil drums in the back lots, and the dead street trees the square was
 * planted with.
 *
 * It is deliberately thin. A downtown's cover is its ARCHITECTURE — the
 * furniture above is authored one piece at a time because each piece is a
 * decision about a sightline — and a scatter field is the wrong tool for that:
 * it is for dressing you fight around rather than terrain you fight from.
 * Every region here is in a street or a back lot, and every blocking one is
 * placed so its own radius plus the prop's half-length still clears the nearest
 * flag by a wide margin. That check is the Greyfen lesson: a log dropped 0.53 m
 * from flag A made it uncapturable, and nothing in the layout said it would.
 *
 * Note that ADDING A PLACEMENT REROLLS ALL OF THIS. `findSpot` draws from the
 * shared stream once per attempt, accepted or rejected, and placements build
 * before scatter — so a new building anywhere moves every region on the map.
 * Re-walk the flags after touching either array.
 */
const scatter: ScatterSpec[] = [
  { prop: "rubble", x: -120, z: -10, radius: 8, count: 5, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 120, z: 10, radius: 8, count: 5, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -10, z: 120, radius: 7, count: 4, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 10, z: -120, radius: 7, count: 4, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "barrel", x: -46, z: -100, radius: 5, count: 4, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: 46, z: 96, radius: 5, count: 4, blocking: true, clearance: 0.55 },
  // The square's planting: one stand per quarter, inside the lawn and clear of
  // the four paths. **These are the one scatter regions on the map that sit
  // inside a flag's ring, and that is the point of them** — C was the only
  // objective here that was pure open ground, which made it the only one with
  // nothing to fight from. The rule the rest of this list keeps (a region
  // stays clear of a flag by its own radius plus the prop's half-length) is
  // about dressing that would clutter an objective; a planted square is the
  // objective. Each stand still stops 9 m short of the centre on either axis —
  // 12.7 m from the flag on the diagonal, against C's 16 m radius — so the
  // monument and the ground round it stay open and the paths stay walkable end
  // to end.
  //
  // `clearance` is 4 against a 0.62 m trunk — a spacing rule, not a collider
  // (see `ScatterSpec.clearance`). Ten trees over a 20 m square at 4 m apart
  // is an avenue of them rather than a thicket.
  { prop: "pine", x: 19, z: 19, width: 20, depth: 20, count: 10, scale: [0.8, 1.2], blocking: true, clearance: 4 },
  { prop: "pine", x: -19, z: 19, width: 20, depth: 20, count: 10, scale: [0.9, 1.3], blocking: true, clearance: 4 },
  { prop: "pine", x: -19, z: -19, width: 20, depth: 20, count: 10, scale: [0.8, 1.2], blocking: true, clearance: 4 },
  { prop: "pine", x: 19, z: -19, width: 20, depth: 20, count: 10, scale: [0.9, 1.3], blocking: true, clearance: 4 },

  // --- the country outside the city ----------------------------------------
  //
  // **This is the borderland, and it is here because a flat margin reads as a
  // backdrop rather than as distance** — Harrowmead's finding, and this map
  // found the taller half of it. The hills are the horizon, but a `downs` face
  // is ONE unbroken surface a hundred metres tall with nothing on it, and the
  // 180 m of level plain in front of it is another: photographed from the NW
  // yard the two arrived as three flat bands of colour stacked on the sky, and
  // no tone in `environment.ts` was going to fix that because the problem was
  // that there was nothing to cast a shadow or break a silhouette. Trees fix
  // it, and they fix the hill as well as the plain — a treeline sown in FRONT
  // of a slope is what gives the slope a scale.
  //
  // **None of it BLOCKS, and that is a rule rather than a saving.** Out here a
  // collider would be geometry outside the nav grid that the bots can neither
  // see nor route around, and — the sharp one — something to catch a player
  // sprinting home against the leash's countdown. Non-blocking scatter emits
  // no collider and no `WorldBox`, so the baked collision set is unchanged by
  // every tree of this.
  //
  // **It is not a RING**, for Greyfen's reason: a continuous belt round a city
  // is a city in a clearing. Each side gets two or three stands with open
  // ground between them, they start about forty metres past the play square so
  // that leaving the city is still the first thing a player notices about
  // leaving it, and the corners get their own because a stand far enough out
  // to close a diagonal is too far out to close the near half of it. The
  // southern quadrant gets none at all: it is the sea.
  { prop: "pine", x: -232, z: 268, width: 150, depth: 96, count: 80, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: -40, z: 292, width: 170, depth: 84, count: 70, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: 196, z: 276, width: 190, depth: 104, count: 95, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: -288, z: 96, width: 92, depth: 210, count: 85, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: -274, z: -86, width: 110, depth: 106, count: 55, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: 286, z: 30, width: 96, depth: 250, count: 100, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: 268, z: -94, width: 120, depth: 92, count: 50, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: 96, z: 236, radius: 24, count: 15, scale: [0.85, 1.25], clearance: 1.2 },
  { prop: "pine", x: -150, z: 228, radius: 20, count: 11, scale: [0.85, 1.25], clearance: 1.2 },
  // Two stands of the dead ones the city's own back lots are planted with, so
  // the near edge of the country is the same trees that failed inside it.
  { prop: "deadTree", x: -226, z: -30, radius: 30, count: 9, scale: [0.9, 1.3], clearance: 2 },
  { prop: "deadTree", x: 214, z: 150, radius: 32, count: 10, scale: [0.9, 1.3], clearance: 2 },

  // --- the city's own dressing ----------------------------------------------
  //
  // **Appended, never inserted, and that is a rule rather than a style.**
  // `findSpot` draws from the map's single seeded stream once per ATTEMPT, in
  // authored order, so a region added in the middle rerolls every region after
  // it — a diff nobody can read, and a nav graph that quietly moves. Anything
  // further added goes below this block.
  //
  // **The split between what blocks and what does not is the whole design.**
  // A blocking prop emits one collider apiece through `MapBuilder.collider()`,
  // and every solid mesh is on the bill for every ray in the game — the
  // hitscan, both LOS tests, the ground probe, the grenade step. A
  // non-blocking one emits NOTHING: no collider, no `WorldBox`, no nav cell,
  // no cover, nothing in the collision bake. So the ray budget buys cover and
  // the merge buys dressing, and the complaint this answers — that a downtown
  // looked swept — is about dressing.
  //
  // That is what lets the instance count go up by a factor of four while the
  // solid-mesh count moves by a couple of dozen. A literal density match with
  // the valleys would be ~750 instances over this map's open ground; that is
  // deliberately not the target, because a city's cover is its architecture
  // and a scatter field here is for what you fight AROUND rather than from.

  // Skips and bins against the building bases and in the back closes, which is
  // where a city actually accumulates. Clear of every flag by the region's own
  // radius plus the prop's half-length.
  { prop: "skip", x: -62, z: 84, radius: 7, count: 2, scale: [0.9, 1.1], blocking: true, clearance: 2.4 },
  { prop: "skip", x: 96, z: 48, radius: 7, count: 2, scale: [0.9, 1.1], blocking: true, clearance: 2.4 },
  { prop: "skip", x: -98, z: -42, radius: 7, count: 2, scale: [0.9, 1.1], blocking: true, clearance: 2.4 },
  { prop: "skip", x: 58, z: -112, radius: 7, count: 2, scale: [0.9, 1.1], blocking: true, clearance: 2.4 },
  { prop: "binPair", x: -46, z: 112, radius: 6, count: 3, scale: [0.9, 1.15], blocking: true, clearance: 1.4 },
  { prop: "binPair", x: 112, z: -46, radius: 6, count: 3, scale: [0.9, 1.15], blocking: true, clearance: 1.4 },
  { prop: "binPair", x: -112, z: -84, radius: 6, count: 3, scale: [0.9, 1.15], blocking: true, clearance: 1.4 },
  { prop: "binPair", x: 84, z: 108, radius: 6, count: 3, scale: [0.9, 1.15], blocking: true, clearance: 1.4 },
  // The depot and parkade yards, which are the two places a pallet belongs.
  { prop: "palletStack", x: -70, z: -42, radius: 6, count: 3, scale: [0.9, 1.2], blocking: true, clearance: 1.6 },
  { prop: "palletStack", x: 62, z: -112, radius: 6, count: 2, scale: [0.9, 1.2], blocking: true, clearance: 1.6 },
  { prop: "palletStack", x: -92, z: -92, radius: 6, count: 2, scale: [0.9, 1.2], blocking: true, clearance: 1.6 },

  // Cones, in runs down the avenues — roadworks that were, and the only
  // saturated warm thing at ground level on a map made of grey. Non-blocking,
  // so a run of them costs nothing but the merge; laid as rotated rectangles
  // along the carriageway rather than as discs, because a lane closure is a
  // line and a disc of cones is a spill.
  { prop: "trafficCone", x: -40, z: 62, width: 8, depth: 34, count: 9, scale: [0.9, 1.1], clearance: 1.6 },
  { prop: "trafficCone", x: 40, z: -70, width: 8, depth: 30, count: 8, scale: [0.9, 1.1], clearance: 1.6 },
  { prop: "trafficCone", x: 74, z: 40, width: 30, depth: 8, count: 8, scale: [0.9, 1.1], clearance: 1.6 },
  { prop: "trafficCone", x: -86, z: -40, width: 28, depth: 8, count: 7, scale: [0.9, 1.1], clearance: 1.6 },
  { prop: "trafficCone", x: 120, z: 96, width: 8, depth: 26, count: 6, scale: [0.9, 1.1], clearance: 1.6 },
  { prop: "trafficCone", x: -120, z: -104, width: 8, depth: 26, count: 6, scale: [0.9, 1.1], clearance: 1.6 },

  // Litter, and this is where the density actually comes from: 130 instances
  // for no collider, no nav cost and nothing to any ray. Banked against the
  // kerbs and blown into the corners of the square rather than spread evenly —
  // a uniform sprinkle over a 320 m map reads as a texture, not as a place.
  //
  // These are laid straight over the objectives where they fall, which the
  // blocking regions above never are. That is the same distinction the square
  // pines make: dressing that would clutter a flag stays off it, and dressing
  // that cannot be walked into or shot at is not clutter.
  { prop: "litter", x: -40, z: 0, width: 14, depth: 200, count: 22, scale: [0.8, 1.3], clearance: 3.5 },
  { prop: "litter", x: 40, z: 0, width: 14, depth: 200, count: 22, scale: [0.8, 1.3], clearance: 3.5 },
  { prop: "litter", x: 0, z: -40, width: 200, depth: 14, count: 22, scale: [0.8, 1.3], clearance: 3.5 },
  { prop: "litter", x: 0, z: 40, width: 200, depth: 14, count: 22, scale: [0.8, 1.3], clearance: 3.5 },
  { prop: "litter", x: -120, z: 20, width: 14, depth: 150, count: 14, scale: [0.8, 1.3], clearance: 3.5 },
  { prop: "litter", x: 120, z: -20, width: 14, depth: 150, count: 14, scale: [0.8, 1.3], clearance: 3.5 },
  { prop: "litter", x: 0, z: 0, radius: 30, count: 14, scale: [0.8, 1.3], clearance: 3.5 },
];

/**
 * The five objectives.
 *
 * A, B and E stand INSIDE a building at ground-floor height, which is new and
 * is the point of them: capture is horizontal only, so the cylinder reaches
 * every storey above the flag and holding one means holding the whole
 * structure. `pos.y` is what the flag marker and the deploy map draw at and
 * what the capture ring is laid against, so it is the walked height of the
 * floor the flag is on rather than zero.
 *
 * Each of the three was checked against the builder's own geometry: none sits
 * in a service core, a stair lane or a car-park column, because a control point
 * inside a collider makes `surfaceAt` return -1 there and the flag becomes
 * uncapturable with nothing to see.
 *
 * **C is the fourth case, and it is that same rule with the monument standing
 * on the origin.** The statue is the square's focal point and the four paths
 * lead to it, so it wants the exact centre — and a flag at the exact centre is
 * then inside the shaft, which is precisely what `buildMonument` warns about
 * and what the editor's validator reports as "flag C centre is not standable".
 * Measured, not assumed: the monument at (0, 0) with C at the origin fails
 * that check and takes C's reachability from both homes down with it.
 *
 * So C stands ON the monument, at the top of its three steps — 3.5 m out from
 * the shaft, clear of the 2.4 m plinth, on a tier top that `buildMonument`
 * keeps at 0.34 m a step precisely so a body can walk up it from any bearing.
 * `pos.y` is that tier's height for the same reason A, B and E carry a storey
 * height.
 *
 * **The offset costs nothing, because it is along x = z.** The two homes are
 * at (-144, 144) and (144, -144), so every point with x = z is equidistant
 * from both — the same arithmetic the spawn list below spends a paragraph on.
 * Moving C 3.5 m along that line leaves both walks identical, which no other
 * bearing off the origin would have done.
 *
 * Capture is unaffected by the height: occupancy is a horizontal distance test
 * (`ConquestSystem.pointAt`), so the cylinder still covers the whole square
 * from the ground, and the ring is sampled per segment around its own
 * circumference rather than from the flag, so it lies on the lawn rather than
 * floating at plinth height.
 */
const controlPoints: ControlPointDef[] = [
  { id: "A", name: "Alpha", pos: new Vector3(-80, 0.2, 66), radius: 15 },
  { id: "B", name: "Bravo", pos: new Vector3(-80, 0.2, -78), radius: 14 },
  { id: "C", name: "Charlie", pos: new Vector3(2.5, 1.02, 2.5), radius: 16 },
  { id: "D", name: "Delta", pos: new Vector3(64, 0, 64), radius: 14 },
  { id: "E", name: "Echo", pos: new Vector3(78, 0.2, -66), radius: 15 },
];

/**
 * Home spawns are uncapturable and sit in the two far corner blocks, which are
 * left empty for them. Every control point also carries a spawn just outside
 * its capture zone — on the avenue that serves it, so deploying onto a flag you
 * hold puts you a bound away from it rather than on top of whoever is
 * contesting it.
 */
const spawns: SpawnPointDef[] = [
  { team: 0, pos: new Vector3(-144, 0, 144), yaw: (Math.PI * 3) / 4 },
  { team: 0, pos: new Vector3(-152, 0, 136), yaw: (Math.PI * 3) / 4 },
  { team: 0, pos: new Vector3(-136, 0, 152), yaw: (Math.PI * 3) / 4 },
  { team: 1, pos: new Vector3(144, 0, -144), yaw: -Math.PI / 4 },
  { team: 1, pos: new Vector3(152, 0, -136), yaw: -Math.PI / 4 },
  // Was at z = -152, which is the quay's own line now — six metres back so a
  // body deploys onto the quayside rather than into the parapet.
  { team: 1, pos: new Vector3(136, 0, -146), yaw: -Math.PI / 4 },
  { team: null, controlPoint: "A", pos: new Vector3(-80, 0, 46), yaw: 0 },
  { team: null, controlPoint: "B", pos: new Vector3(-80, 0, -46), yaw: Math.PI },
  // C's spawn is on the line x = z, and that is arithmetic rather than taste.
  // The two homes are at (-144, 144) and (144, -144), so the points equidistant
  // from both are exactly those with x = z — anywhere else and the flag every
  // round turns on hands one side a shorter walk back to it than the other.
  // 41 m out, which clears the 16 m ring with room, and inside the square's own
  // block so a squad deploys under cover of the buildings round it.
  { team: null, controlPoint: "C", pos: new Vector3(-2.466, 0, 8.14), yaw: (-Math.PI * 3) / 4 },
  { team: null, controlPoint: "D", pos: new Vector3(52, 0, 44), yaw: 0.54 },
  { team: null, controlPoint: "E", pos: new Vector3(78, 0, -44), yaw: Math.PI },
];

/**
 * One hardstanding per side, in the corner yard that side already deploys into.
 *
 * **The yards are the only two 32 m squares on the map with nothing in them**,
 * which is why the home spawns are there and why the armour is: everywhere else
 * on Coldharbour is either a 26 m tower footprint or a 16 m avenue, and a
 * seven-metre hull needs somewhere to be that is neither. The NE and SW corners
 * carry towers (`x: -144, z: -144` and `x: 144, z: 144` in the placements
 * above); these two do not.
 *
 * Each stands at the INNER corner of its yard rather than in the middle of it,
 * eight-ish metres off the three infantry spawns, so a hull arriving on the
 * respawn timer cannot be sitting where somebody just deployed — and so the
 * first thing a driver does is roll onto an avenue rather than a three-point
 * turn against the boundary. The heading is the yard's own: 3pi/4 is
 * south-east out of the north-west corner, which is the same bearing the
 * infantry spawns face, and the pair of avenues at `x = -120` and `z = +120`
 * are both one hull-length away.
 *
 * **Two, and exactly two.** The respawn is per hardstanding, so the number of
 * entries here IS how many tanks a side can ever have on the field at once.
 */
const vehicles: VehicleSpawnDef[] = [
  { team: 0, pos: new Vector3(-138, 0, 136), yaw: (Math.PI * 3) / 4 },
  { team: 1, pos: new Vector3(138, 0, -136), yaw: -Math.PI / 4 },
];

/**
 * The civic square's lawn: one rect per quarter of the block, laid to the same
 * lines as the four paths and stopping 2 m short of them on each side.
 *
 * The only grass on the map, and the only reason `coldharbour/environment.ts`
 * carries a `GrassEnvSpec` at all — a rect with no palette grows nothing, and
 * `GrassSystem.build` returns early rather than complaining about it.
 *
 * Purely visual. No collider, no nav cost, no `WorldBox`: a tuft that lands
 * inside a collider is dropped at build time, so the four stands of pines
 * above cut their own holes in this without either list knowing about the
 * other. The bare 2 m at the kerb and along each path is what makes the paths
 * read as paths.
 *
 * **`density` is 5 against the 1.1 default, and the default is what a FIELD
 * wants rather than what a lawn does.** At 1.1 tufts per square metre the
 * square came out as weeds standing in gravel — right for Hollowmere's dead
 * pasture, wrong for the one tended place in a city, and from above it did not
 * read as green at all. Five is where the tufts close up into a surface from
 * standing height without going solid enough to hide a prone body. It costs
 * ~13,500 tufts over the four rects, which is one thin-instanced draw call and
 * a build-time scatter, not a per-frame cost.
 */
/**
 * THE SEA, as four rectangles, and what it is FOR is the horizon rather than
 * the drawing.
 *
 * This map states `ridge.mouth` across its southern side, which means it draws
 * no landform there at all — and `Ridge.ts` allows that only where the map has
 * already laid something out past its own `fogEnd` on those bearings, because
 * the sky dome is flat `fogColor` below the horizon and `Sky` culls the lowest
 * 7.2 degrees of stars. This is that something. `fogEnd` is 480, so the water
 * runs to 2,700 m: far enough that its own far edge arrives as exactly
 * `fogColor` from anywhere a living player can stand, which is the play square
 * plus the borderland the leash lets them into.
 *
 * **A `WaterRect` is an extent and the BED decides where the shore is**, so
 * any partition of the same area draws the same coastline. What varies is
 * where the reflection PROBES stand — one per rect, at the depth-weighted
 * centroid of that rect's own wet cells — and two rules pick this partition,
 * both of them Cinderhaven's.
 *
 * **Every probe has to stand in water.** All four centroids are open sea; the
 * nearest thing to any of them is the western headland, whose back toe stops
 * at x = -650 against that rect's centre at -1,700.
 *
 * **And a SEAM must not fall where anybody is looking across it**, because two
 * rects at one height share an invisible edge and carry two different mirrors.
 * The frontage is ONE rect out to x = +/-700 and z = -700, and those numbers
 * are `fogEnd` measured from the nearest place a player can be rather than
 * round figures: the quay is at z = -152 and the play square's side at
 * x = +/-160, so the three seams stand 540 to 548 m off, past the 480 m at
 * which everything is `fogColor` anyway. Bring any of them in and the mirror
 * changes along a line drawn across the water in full view of the quay.
 *
 * **The frontage rect is not widened to reach the horizon, and that is the one
 * thing to keep if this is ever repartitioned.** A rect's bed map is a fixed
 * 512 texels a side (`CONFIG.water.depthTexelsMax`) however big the rect is,
 * and this is the only one of the four with a shoreline in it — the waterline,
 * the foam and the shoal grading are all read off that texture. At 1,400 m
 * that is 2.7 m a texel along the coast; at 5,400 it would be ten.
 *
 * `y` is -2.2 on all four and they must go on agreeing, for the drawing and
 * for the sound: `MapBuilder.waterAmbience` joins rects into one BODY when
 * they touch AND agree about what they are, and one harbour that shelved into
 * four seas would be four emitters contending for the same voices.
 */
const water: WaterRect[] = [
  // The harbour: the frontage, both headlands and the water between them.
  { x: 0, z: -420, width: 1400, depth: 560, y: -2.2 },
  // The western and eastern seas, meeting the harbour out past the headlands.
  { x: -1700, z: -420, width: 2000, depth: 560, y: -2.2 },
  { x: 1700, z: -420, width: 2000, depth: 560, y: -2.2 },
  // The ocean, which is what the southern horizon actually is.
  { x: 0, z: -1700, width: 5400, depth: 2000, y: -2.2 },
];

const grass: GrassRect[] = [
  { x: 17, z: 17, width: 26, depth: 26, density: 5 },
  { x: -17, z: 17, width: 26, depth: 26, density: 5 },
  { x: -17, z: -17, width: 26, depth: 26, density: 5 },
  { x: 17, z: -17, width: 26, depth: 26, density: 5 },
];

export const ColdharbourLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  vehicles,
  water,
  grass,
  /**
   * The first map that is not `CONFIG.map.size`. Everything downstream takes
   * the extent as an argument and carries it on `GameMap.size`; what a larger
   * map owes is stated on `MapLayout.size`, and the one that bites is that
   * `terrain.size * terrain.cell` must equal this — 80 x 4.
   */
  size: 320,
  /**
   * Three floors, a roof, a spandrel at every window and a wall head under
   * every ceiling stack six or seven candidates into one perimeter cell, and
   * `NavGrid` DROPS the overflow rather than sorting it in.
   *
   * **Four is a MEASURED number and the measurement is the interesting part.**
   * Probing every walked level of both offices, all three parkade decks, all
   * eight shophouses and both depots — every stair landing included — for
   * "is it a surface, did the flood fill reach it, can both home fields route
   * to it", the answer is the same at 3, 4 and 5: **34,150 / 34,163 / 34,163
   * walkable surfaces, every level reachable at all three**. The thirteen
   * surfaces between them are prop tops, not floors. Three is enough — because the
   * builders emit walked
   * surfaces FIRST (see `world/kit/city.ts`), so the floors fill the slots and
   * it is the spandrels, the wall heads and the roof that get dropped, which is
   * exactly the right thing to lose.
   *
   * That was re-derived rather than assumed when the mixed-use stock went in,
   * and it had to be: a shophouse stacks a partition head and a shell-wall head
   * into the same cells its three floors are in, which is exactly the kind of
   * thing that spends the last slot on the wrong candidate.
   *
   * So this is one slot of margin over a value that already works, and it is
   * bought for a reason rather than for comfort: the guarantee rests entirely
   * on emission order inside a builder, and the failure when that order slips
   * is a storey quietly missing from the graph with the floor still drawn and
   * the stair still climbable. At 4 a slip costs a spandrel. Five buys nothing
   * measurable and costs another 1.5 MB of link table and 1.3 MB of flow field
   * on a grid this size.
   */
  surfaces: 4,
  /**
   * Twice the default, and it is the `borderland` below that asks for it —
   * Harrowmead's argument, run on this map's numbers.
   *
   * The floor is cut into patches of this and the borderland's own blocks are
   * FOUR times it, so with 180 m of ground on every side the default 48 cuts
   * this map's ground into **61** patches against the 49 it had when the
   * boundary was a wall — and every one of them is walked by the frame at
   * every distance, because the floor carries no `metadata.block` and
   * `WorldCulling` therefore files no cull cell for it. At 96 it is **24**: 16
   * for the play square and 8 for the borderland, which is half what the map
   * shipped with and is a saving rather than a cost. (Counted in MESHES, which
   * is what the frame pays, those are 122, 98 and 48 — the floor carries an
   * invisible collider clone of every patch.)
   *
   * What it spends is frustum granularity on the ground that is fought over,
   * and on a 320 m map stating `fogEnd: 480` that is very nearly nothing —
   * the whole floor is inside the view from the civic square whichever way it
   * is cut. It also suits the shape of this particular floor: the city is dead
   * level, so `uniformHeight` collapses most of these patches to a single quad
   * and a bigger patch is a bigger saving.
   */
  terrainBlock: 96,
  /**
   * **No wall, and no rim under it either — this was the last map in the tree
   * closed by one.** The ground carries on for three hundred metres past the
   * play square on every side and what stops a player leaving is the leash, a
   * countdown rather than a face of rock. See `Borderland`, and
   * `world/leash.ts` for the rule.
   *
   * **The margin is the LANDFORM's here, which is a third reason to size one
   * and is this map's own.** Hollowmere and Greyfen size theirs by the fog and
   * Harrowmead by the horizon; those three draw nothing at their boundary, so
   * the margin has to BE the distance. This map draws hills (see `ridge`), and
   * a hill closes a horizon whatever the margin is — so what a margin buys
   * here is not closure but DISTANCE, and it is bounded at BOTH ends.
   *
   * **It was 300 first and the fog ate them.** `fogColor` arrives in full at
   * `fogEnd`, which is 480 on this map and does not move (see
   * `environment.ts`): at a 300 m margin the hills' toe stands 460 m from the
   * middle of the map and their crest 610, so from the civic square the whole
   * range sat inside the last 4% of its own colour and from the southern half
   * of the city it was not there at all. Photographed rather than reasoned
   * about — the range came out as a faint crease in an otherwise blank sky.
   *
   * 180 is the other end of it. The toe stands 180 m past the play edge — six
   * times the 30 m the old escarpment stood at, and more than half the map's
   * own width, so nothing about it reads as a wall behind the last block —
   * and the crest is 330 m from the nearest street at 93 m high, which is 16
   * degrees of hillside at a bit over half fog. What it costs is the middle of
   * the map, where the crest still fades out around `fogEnd`; that is aerial
   * perspective rather than a seam, because the colour it fades to is the
   * colour the sky above it already is.
   *
   * It is also two and a half times the leash's own 69 m, so nothing alive
   * gets within 110 m of the boundary boxes.
   *
   * **The roll is low for a reason that is not about the look: a third of this
   * borderland is SEABED.** The ground past the southern boundary is the bed
   * of the sea above (see `water` and heights.ts), and `borderRoll` swings the
   * floor by `roll / 2` either way — so at the 2.6 default the bed's high
   * points come up to -3.7 against a surface at -2.2, which is 1.5 m of water
   * and exactly where `CONFIG.water.depthMax` stops being opaque. That is a
   * shoal showing through the open sea. At 1.8 the worst case is -4.1 and the
   * body stays solid everywhere; the swell that is lost is on ground no one
   * can reach, and the land half of the borderland reads the same either way.
   *
   * `ease` is 30 for Harrowmead's reason rather than the default third: a
   * third of 180 is 60, which is most of the way to the leash's own 69, so the
   * ramp would spend nearly the whole strip a player can cross flattening it.
   * The test is whichever of the leash (69) and `fogEnd` (480) is SHORTER, and
   * here that is the leash — the same number and the same arithmetic
   * Hollowmere and Greyfen arrive at from the other side.
   */
  borderland: { margin: 180, roll: 1.8, ease: 30 },
  /**
   * **HILLS on three sides and the OPEN SEA on the fourth**, which is the one
   * thing about this map's edge that is not a default.
   *
   * What was here was an `escarpment` at `slope: 0.17` with two passes notched
   * in it where the central avenues left town — the last rim in the tree, and
   * deliberately shallow because `fogEnd` is 480 and you could see it from
   * anywhere. Shallow was the right answer to the wrong question. A rim thirty
   * metres behind the outer block face is a wall whatever its pitch, and a
   * ring of it is a bowl; the passes were two holes in a wall rather than two
   * ways out of a valley.
   *
   * `downs` is the other landform and the only one a `borderland` may take
   * (see `RidgeSpec.form`): no basal band, a shoulder rather than a step, and
   * a crest 150 m out that rounds over instead of capping. At `slope: 0.19`
   * against the boundary's own radius that is about 93 m on the sides and 120
   * at the corners — hills at 180 m and not a wall at 30 — and
   * `slopeVariance` is up from the 0.04 default so the skyline wanders rather
   * than running level round three sides of a square.
   *
   * **The `mouth` is the sea, and it is the field this map exists to have
   * added.** It takes the landform away outright across the whole southern
   * side and both southern corners, which is `form: "none"` asked of one arc —
   * and it is allowed for exactly the reason the whole-ring form is: there IS
   * something out there past `fogEnd` on those bearings. See `water`.
   *
   * **The width is arithmetic and not a figure anybody eyeballed.** A mouth is
   * measured along the CREST's own curve, which is the boundary square offset
   * outward by `crestOut` — so a corner contributes a quarter circle rather
   * than a corner. The boundary is 320 + 2 * 180 = 680 m a side and the downs
   * put their crest 150 m out, so the southern side is 680 and each corner fan
   * is 150 * pi / 2 = 235.6: fully open across both corners is
   * 680 + 2 * 235.6 = 1151.
   *
   * The `ease` is what a headland IS. Over 300 m of that same curve the crest,
   * the reach and the shoulder come back up together, so each range grows out
   * of the sea at its corner and reaches full height 300 m up its own side —
   * at z = -40, which is the middle of the map. What that draws is the thing a
   * coast actually does: the highest ground in the north, falling south, and
   * two headlands standing in the water either side of an open bay. Shorten it
   * and the hills end in a cliff face standing in the sea; lengthen it and the
   * range never gets tall before it runs out of side.
   */
  ridge: {
    form: "downs",
    slope: 0.19,
    slopeVariance: 0.06,
    mouth: [{ x: 0, z: -340, width: 1151, ease: 300 }],
    /**
     * **Rolling country rather than one swell, and woods on it.** The downs
     * alone are a single swept profile, so the three sides arrived as one
     * smooth bank with a level skyline — a backdrop, whatever colour it was
     * painted. This breaks the skyline into separate tops with saddles
     * between them, puts knolls and hollows across the face, and sows stands
     * of broadleaf low and pine high with pasture between them, which is what
     * finally gives the hill a SCALE: the eye measures a hillside by the
     * trees on it. The woods are the borderland pines' own paint, so the
     * stands on the plain run up into the ones on the slope as one wood.
     *
     * All of it is visual and the rim's: no collider, nothing in the bake,
     * and nothing drawn from the map's seeded stream. `shore` keeps the
     * headlands' trees out of the sea at -2.2.
     */
    rolling: {
      relief: 0.3,
      summits: 16,
      knolls: 0.14,
      knollSize: 110,
      woods: 0.6,
      shore: 0.5,
    },
    seed: 0x43484252,
  },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x434f4c44,
};
