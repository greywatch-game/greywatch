/**
 * bench/vantages.ts — Where the reference frames are taken from, beyond the
 * one photograph each map already has, and where the benchmark stands to look
 * (`bench/BenchScript.ts`).
 * Owns: `DIFF_VANTAGES`, the table of poses, and the `Vantage` row shape.
 * Invariants: ERASABLE SYNTAX ONLY and no import that survives compilation —
 * Node loads this file by type stripping (`plans/webgpu-ref/vantages.mjs`
 * re-exports it to `bank.mjs`), exactly as the map generators load
 * `world/roadPaths.ts`. A runtime import here breaks the bank and not the
 * typecheck.
 * Never: imported by anything on the boot path. The one reader in `src/` is
 * the benchmark, which `Game` reaches through a dynamic import behind
 * `?bench`, so the prose below is a chunk nobody downloads to play.
 *
 * **The menu's vantage is the menu's and is NOT stated here.** It is read at
 * runtime out of `src/ui/mapShots.ts` — the table the backdrop itself stands
 * on — so a reference frame and a menu backdrop cannot come to hold two ideas
 * of where the camera stands, and a re-frame stays an edit in one place. What
 * is below is the SECOND table, and the reason there are two is that the two
 * are chosen against different questions: a backdrop is picked to look like
 * the map, and a diff vantage is picked to put a SHADER PATH in frame. Nothing
 * in the game PLAYS from these poses — but the benchmark stands at them, which
 * is why they live in `src/` now and the bank reads them from here: a bank and
 * a benchmark that kept two copies would be measuring two different maps the
 * first time a row was re-posed.
 *
 * **Each row names what it proves, and that field is the whole point of the
 * row.** A reference set is only a defence against
 * `plans/done/webgpu_migration.md`
 * risk 2 — the cel fragment silently wrong in one variant on one map — if
 * every variant is somewhere in it. Four menu photographs are four pretty
 * pictures of a village; between them they hold no backed pane at 2 m, no
 * lamp-lit street, no gust crossing a canopy and no wall far enough away to
 * band. So when a diff comes back dirty, `proves` is what says which of M3–M6
 * just moved, and a row with nothing to put in it should not be banked.
 *
 * **`pos` is `[x, metres ABOVE THE SURFACE, z]` and `target` is absolute**,
 * which is `MapVantage`'s convention and is kept deliberately: two of these
 * maps are heightfields and an absolute eye height buries the camera in a bank
 * the first time the terrain is edited. `fov` is vertical degrees and omitting
 * it means the game's own hip FOV.
 *
 * **`wind` is the one field here that is not a camera.** There is one wind and
 * three clocks reading it, and the freeze pins all three to the same constant
 * — zero unless a row says otherwise. A row that asks for 2.6 is asking to be
 * photographed mid-gust, which is the only way a sway term reaches a reference
 * frame at all: at t = 0 every blade and every branch stands exactly where it
 * was authored, so a set taken only at zero diffs clean against a sway that
 * has been deleted outright.
 *
 * **The rest of the optional fields stand something in front of the camera
 * that the map alone does not have**, because the bank is the look oracle for
 * a renderer being replaced piece by piece, and a
 * table of map views holds none of the pieces after the static world. Each is
 * posed by the game's own code from a fixed starting state through fixed
 * steps, so it is the same picture every run; `placeVantage` in `harness.mjs`
 * puts every one of them away again before the next row.
 *
 * - `rigs: [{ at: [x, z], yaw, pose }]` — soldiers from the front of the
 *   roster, stood on the floor and posed by `animateSoldier` (`pose` is a
 *   partial `SoldierPose` over `REST_POSE`). `yaw` π faces a camera to the
 *   rig's south.
 * - `blast: { at: [x, z], age, power }` — the real `BlastFx`, raised on the
 *   floor at `at` and aged `age` seconds in 1/60 s steps, its layout drawn
 *   under a seeded `Math.random`.
 * - `view: { weapon, sight, aimed, params?, finish?, throwable?, flash? }` —
 *   the player's viewmodel, fitted and posed by `ViewModel.update` until it
 *   settles; aimed takes the optic's own field too. `params` is laid over the
 *   player's own `ViewModelParams` for every step of the pose, which is how a
 *   GESTURE is held mid-phase (a reload's `reloadPhase`, the bolt's
 *   `cyclePhase`, the launcher's `loadPhase`, a throw's `throwTime`): each is a
 *   function of its phase, so a phase held for the settle is the same frame
 *   every run. A reload held there turns the CAMERA by the head's look and
 *   lean as `CameraSystem` would (the body node takes it back), and the
 *   passes are re-placed at the turned eye. `finish` paints the weapon
 *   (`ViewModel.setFinish`), `throwable` puts the frag or the bottle in the
 *   throwing fist, and `flash` fires the muzzle flash once (`PlayerView.fired`)
 *   under a seeded `Math.random`, so its roll and scale are the same strobe
 *   every run. All four are put back before the next row.
 * - `kit: { weapon, sight, finish?, bay }` — the KIT screen: the real lid
 *   raised over `deploy` (`Game.openLoadout` — the card, the bench lamps and
 *   the glow's stage rule, the weapon on the turntable at its authored
 *   angles), with the bay the DOM would measure replaced by the stated one
 *   (`LoadoutScreen.stageBay`; the bank hides the interface, so there is no
 *   DOM bay to measure). The lid comes down again before the next row.
 * - `fx: { seconds, events, mines? }` — the EFFECT POOLS (X4.4a): each event
 *   raised `at` seconds into a clock of fixed 1/60 s steps through the door
 *   the game raises it by — a round by `CombatFx.drawRounds`, a throw by
 *   `GrenadeSystem.throwAt`, a rocket by `AntiTankSystem.launchToward`, a
 *   blast and a molotov by the wire's `explode` and `blaze` arms
 *   (`Game.onNetEvent`), a pane's shards by `DebrisSystem.burst`, a case of
 *   brass by `PlayerView.fired` — and every pool stepped in the frame's own
 *   order to the clock's end, which is the frame. Pictures' randoms are
 *   seeded for the clock (the sound's are not, and do not reach them), the
 *   rubble and the shards run on their own seeded streams under Havok's fixed
 *   step, and `mines` are laid as the wire lays them
 *   (`NetOrdnance.applyMines`). `breaks` is a REAL break's picture, raised by
 *   the two callbacks `Game` wires (`GlassSystem.onBroken`, then `onBreak`):
 *   the pane's range collapsed out of its merged glazing and its shards, with
 *   `g.glass` itself unwritten and the sheet stood up again by the put-away.
 *   `blob` is a body's contact shadow (`ShadowSystem.updateBlobs`, the door a
 *   frame places it by, which no frozen frame reaches): the disc at `at`, whose
 *   `y` is the floor under the body, faded with distance by the door itself and
 *   switched off by the put-away.
 *   `drawn` is a round's PICTURE handed over as
 *   `CombatSystem.onRound` hands it (`CombatFx.drawRound`: no wall query, the
 *   impact at `to` of the stated kind and normal, no mark) — the door the
 *   flesh and glass kinds, and an impact off the static world, come through.
 *   `wire` feeds the wire's flights (`WireFlights`) to the session's
 *   `NetGrenades` and `NetOrdnance` after the clock, then poses both at each
 *   of `poses` in turn (render times, milliseconds). All of it is put away
 *   before the next row.
 * - `zones: true` — the capture rings and their flags, which every other row
 *   hides. Built at the start of a round, so the flag is at the foot of its
 *   pole and the cloth at rest.
 * - `flown: { meters, seconds }` — with `zones`: the flags stepped by
 *   `CaptureZoneSystem.update`, the door a round steps them by, for `seconds`
 *   of 1/60 s steps at the stated `meters` (one per zone, in build order, -1 to
 *   +1; 0 where absent), so a flag is up its pole in its side's colours and the
 *   cloth has had that much air. The zones keep it: a later row showing them
 *   states its own.
 * - `settings: { key: value }` — `Game.setSetting` for this row only, which is
 *   how a post setting is photographed OFF beside the row that has it on.
 * - `turn` — radians: the motion blur held mid-turn rather than at rest (see
 *   `freeze`), since a still camera leaves the pass inert.
 * - `strike` — seconds: a lightning strike in the air, the map's own seeded
 *   schedule read once at that clock (`LightningStrikes.step`), which `freeze`
 *   otherwise holds with nothing up.
 * - `motes: { step, steps, box }` — the map's mote field, which every other
 *   row switches off because it runs on the wall clock: rebuilt under a seed,
 *   gathered into a box `box` metres across on the eye (its own motes at its
 *   own rate, so denser, or the disc would have a tenth of a mote in front of
 *   it), run `steps` fixed steps of `step` seconds and held by a clock of zero.
 *   It is here for the ORDER of the disc against what is in front of it.
 *
 * Positions read like `pos`: `[x, z]` on the floor as drawn.
 */

// Type-only, so erased: Node loads this file by type stripping (the header).
import type { FinishId } from "../entities/finishes";
import type { SightId } from "../entities/sights";
import type { ThrowableId } from "../entities/throwables";
import type { StageBay, ViewModelParams } from "../entities/ViewModel";
import type { CarriedId, PrimaryWeaponId } from "../entities/weapons";
import type { ImpactKind } from "../systems/CombatSystem";

/** A pose: `[x, metres ABOVE THE SURFACE, z]` to look at an absolute point. */
type Pos = readonly [x: number, above: number, z: number];
type Point = readonly [x: number, y: number, z: number];

/**
 * One effect an `fx` row raises, `at` seconds into its clock, through the
 * door the game raises it by (`placeVantage` names each). Every point is
 * ABSOLUTE, unlike `pos`: an effect stands on whatever it was raised on — a
 * quay, a plinth, a sill — and the floor under it is not that.
 */
export type FxEvent =
  | { at: number; round: { from: Point; to: Point } }
  | { at: number; throw: { from: Point; to: Point; kind: ThrowableId } }
  | { at: number; rocket: { from: Point; to: Point } }
  | { at: number; explode: { at: Point; power?: number } }
  | { at: number; blaze: { at: Point } }
  | { at: number; shards: { pane: number; at: Point; dir: Point } }
  | { at: number; breaks: { pane: number; at: Point; dir: Point } }
  | { at: number; brass: true }
  | { at: number; blob: { at: Point } }
  | { at: number; drawn: { from: Point; to: Point; kind: ImpactKind; normal?: Point } };

/**
 * One snapshot's worth of the WIRE's flights, as `NetGrenades.applySnapshot`
 * and `NetOrdnance.applySnapshot` take them: `now` is the server time it
 * describes (milliseconds, the connection's clock), and every flight is
 * somebody else's (`placeVantage` hands both a local slot no flight names).
 */
export interface WireFlights {
  now: number;
  grenades?: readonly { i: number; p: Point; fuse: number; k?: ThrowableId }[];
  rockets?: readonly { i: number; p: Point; dir: Point }[];
}

/**
 * One row. `of` and `proves` are for a person reading a dirty diff; the rest
 * is what `placeVantage` (`plans/webgpu-ref/harness.mjs`) stands in front of
 * the camera. The benchmark reads `pos` and `target` and nothing else.
 */
export interface Vantage {
  id: string;
  of: string;
  proves: string;
  pos: Pos;
  target: Point;
  fov?: number;
  wind?: number;
  rigs?: readonly {
    at: readonly [x: number, z: number];
    yaw?: number;
    pose?: Readonly<Record<string, number>>;
  }[];
  blast?: { at: readonly [x: number, z: number]; age?: number; power?: number };
  view?: {
    weapon: CarriedId;
    sight: SightId;
    aimed: boolean;
    params?: Readonly<Partial<ViewModelParams>>;
    finish?: FinishId;
    throwable?: ThrowableId;
    flash?: boolean;
  };
  kit?: { weapon: PrimaryWeaponId; sight: SightId; finish?: FinishId; bay: Readonly<StageBay> };
  fx?: {
    seconds: number;
    events: readonly FxEvent[];
    mines?: readonly { at: Point; armed: boolean }[];
    wire?: { snapshots: readonly WireFlights[]; poses: readonly number[] };
  };
  zones?: boolean;
  flown?: { meters: readonly number[]; seconds: number };
  settings?: Readonly<Record<string, string | boolean | number>>;
  turn?: number;
  strike?: number;
  motes?: { step: number; steps: number; box: number };
}

/**
 * The diff vantages, keyed by map id, in the order they are banked.
 *
 * A map with no entry here is not an error — it banks its menu vantage alone,
 * exactly as a map with no row in `mapShots.ts` is skipped rather than broken.
 */
export const DIFF_VANTAGES: Readonly<Record<string, readonly Vantage[]>> = {
  hollowmere: [
    {
      id: "lanterns",
      of: "the square from the north road: four lamps on the crossroads, lit windows either side, the well and the stalls under them",
      proves:
        "point lights — the packed uniform array and its range term — plus CEL_BUMP on the plaster and the emissive pass on every lit window in frame",
      pos: [2, 1.7, 18],
      target: [0, 2.2, -14],
    },
    {
      id: "ashwood",
      of: "the Ashwood clearing east of the logging lane, dead trees standing out of the grass field",
      proves:
        "the grass field (M4) at low density, the ink on a stand of fine branches, and the vertex colour's sway weight on both — taken mid-gust so the sway is in the picture",
      pos: [33, 2.5, 70],
      target: [50, 7, 100],
      wind: 2.6,
    },
    {
      id: "wall40",
      of: "a cottage's moonlit east face, square on down the lane from 40 m (re-posed for the re-laid village: the old pose stood in a street a metre off a dark wall)",
      proves:
        "the dither, which is the one thing in the shader whose failure is a BAND rather than a colour — a flat lit surface far enough away for the ramp to quantise",
      pos: [62.6, 1.7, 6.6],
      target: [22.6, 3, 6.6],
    },
    {
      id: "ring",
      of: "the square from above its north side, the capture ring's paint across the cobbles and the flag's pole by the well",
      proves:
        "the capture ring and the flag (X4.6), which every other row hides — the paint on made ground and the cloth at rest at the foot of its pole",
      pos: [4, 9, 32],
      target: [0, 0.6, -3],
      zones: true,
    },
    // The post chain, one setting at a time. `lanterns` above is every one of
    // them ON at this machine's defaults; each row below is the same frame with
    // ONE taken off, so a pass that stops attaching — or attaches and changes
    // what the others draw — moves exactly one pair. The night street is the
    // frame for it because it has lit windows for the bloom, the moon's shafts
    // and enough contrast for the grain and the AA to read.
    {
      id: "post-blur",
      of: "`lanterns`, the motion blur held mid-turn",
      proves:
        "the motion blur pass IN FLIGHT — at rest it is inert, so every other row would diff clean against a blur that had been deleted",
      pos: [2, 1.7, 18],
      target: [0, 2.2, -14],
      turn: 0.03,
    },
    {
      id: "post-noblur",
      of: "`post-blur` with the motion blur setting off",
      proves: "the chain with the blur pass detached, and that taking it off leaves the grade at the tail",
      pos: [2, 1.7, 18],
      target: [0, 2.2, -14],
      turn: 0.03,
      settings: { motionBlur: false },
    },
    {
      id: "post-nograin",
      of: "`lanterns` with the paper grain off",
      proves: "the chain without the grade pass",
      pos: [2, 1.7, 18],
      target: [0, 2.2, -14],
      settings: { paperGrain: false },
    },
    {
      id: "post-nofxaa",
      of: "`lanterns` with FXAA off",
      proves: "the chain without the anti-aliasing pass",
      pos: [2, 1.7, 18],
      target: [0, 2.2, -14],
      settings: { fxaa: false },
    },
    {
      id: "post-novol",
      of: "`lanterns` with the light shafts off",
      proves: "the chain without the volumetric shafts, which move ~90% of this frame's pixels when on",
      pos: [2, 1.7, 18],
      target: [0, 2.2, -14],
      settings: { volumetrics: "off" },
    },
    {
      id: "post-glowlow",
      of: "`lanterns` with the bloom at its low rung",
      proves: "the bloom's other downsample — the glow has no off, so its two rungs are the pair",
      pos: [2, 1.7, 18],
      target: [0, 2.2, -14],
      settings: { glow: "low" },
    },
    {
      id: "ground",
      of: "the eye 35 cm off the bare floor by the farm lane, looking south-east to the farmstead's paddock, the field's grass and turf behind the rails and the floor running out into the fog on the right",
      proves:
        "the floor's bumped ground variant at grazing incidence under a night key — the relief read edge-on, where a lost tangent frame or a flipped bump shows first — and the turf's edge against bare floor, which must still draw over the floor it lies on (X3.5)",
      pos: [52, 0.35, 62],
      target: [104, 2.89, 22],
    },
    {
      id: "crossing",
      of: "High Street east's cobbled junction from six metres over it, lamp-lit, where the farm lane (dirt) leaves it northward between the floor and the field grass",
      proves:
        "a cobble road's junction patch and its kerb against a DIRT road — `ROAD_RANK` 1 against 0 — and both against the floor beside them: the road depth bias (`ROAD_DEPTH_UNITS`, -8) and the rank ladder that X3.5 moves into our renderer",
      pos: [61, 6.5, -7],
      target: [64, 1.01, 7],
    },
    // Appended for X4.5a, so every row above carries the state it was banked
    // with (`bank.mjs --rows`), and at the `ground` row's eye, so the benchmark
    // gains no stop.
    {
      id: "sky-moon",
      of: "the full moon straight overhead of the frame's middle from the farm lane, its halo and the stars round it, the farmstead's roof against the bottom of the sky — the one disc in the set with no cloud on the map to cross it",
      proves:
        "the MOON (X4.5c): the blended disc on its painted emissive and opacity texture and its boost, the dome's painted halo at the matching uv, and the disc's BLOOM through the glow (no fog fade: its mask draw states none, `SkyDraw`) against a roof's depth, at a `fogEnd` of 78 where any fade would delete it",
      pos: [52, 0.35, 62],
      target: [98, 62.35, -2],
    },
    {
      id: "sky-motes",
      of: "the same moon closed up, ash in the air all round and in front of it (the map's mote field gathered into 24 m on the eye and held)",
      proves:
        "the moon's ORDER against the particles (X4.5c): Babylon draws a group's particles BEFORE its blended meshes, so a mote in front of the disc is painted over by it and one beside it is not — the order X4.5c must keep from a point after the particles, or take as a recorded change",
      pos: [52, 0.35, 62],
      target: [98, 62.35, -2],
      fov: 24,
      motes: { step: 0.1, steps: 200, box: 24 },
    },
    // Appended for X4.6a, after every row above, at `ring`'s eye so the
    // benchmark gains no stop.
    {
      id: "ring-flown",
      of: "the square's flag run to the top of its pole in the Valeguard's tan, from the same eye as `ring`, the field closed to 22° on the top of the pole",
      proves:
        "the CLOTH (X4.6b) up its pole in the wind: the NEAR sheet (16x10, the eye ~35 m off, inside `LOD_FAR`) after six seconds of its own fixed-step air, the hoist band and the field in their two materials, backlit by the night's sky, its folds in the positions and normals the sheet last wrote — where `ring`'s flag is at rest at the foot of the pole, behind the well",
      pos: [4, 9, 32],
      target: [0, 9, -3],
      fov: 22,
      zones: true,
      flown: { meters: [0, 0, -1, 0, 0], seconds: 6 },
    },
  ],
  greyfen: [
    {
      id: "treeline",
      of: "the forest floor south of the manor, looking down the valley with the trunks receding into the fog",
      proves:
        "the OUTLINE across the whole fog band — the regression `docs/rendering.md` records, where a per-mesh ink fade leaves the far half of a merged block in clear ink. Greyfen because a BRIGHT fog is what makes an un-attenuated pass obvious; the identical failure is invisible on Hollowmere",
      pos: [-6, 2.4, -18],
      target: [-6, 5, -108],
    },
    {
      id: "canopy",
      of: "the forest floor south of the manor, looking up into the closed canopy, mid-gust",
      proves:
        "the sway under a real gust on the one map whose foliage is nine metres up, and the fog on geometry that is overhead rather than downrange",
      pos: [-6, 2.0, -18],
      target: [2, 20, -36],
      wind: 2.6,
    },
    {
      id: "marsh",
      of: "standing in the deep channel looking west across it, the causeway and its stilt huts on the far bank",
      proves:
        "the WATER (M6) — the wave trains, the mirror and the dark body under it — against the reed beds standing in it, which is the one place the grass field and the water surface share pixels",
      pos: [22, 1.6, 38],
      target: [-12, 0.8, 34],
    },
    {
      id: "ground",
      of: "the eye 35 cm off the forest floor south-west of the manor, under the canopy, looking north across sun-flecks to where the valley's thin cover meets a dense stand of grass, trunks receding into the fog",
      proves:
        "the floor's bumped ground variant at grazing incidence in the canopy's shadow and its sun-flecks, and the edge where the thin cover (no turf) meets a dense field (turf) — the turf must still draw over the floor (X3.5)",
      pos: [-34, 0.35, -40],
      target: [-26, -0.94, 20],
    },
    {
      id: "crossing",
      of: "the one place a cobbled path meets a dirt track, east of the manor, from six metres up: the cobbles, the track running in, the floor and the grass round them",
      proves:
        "the map's only crossing of two ranks — cobble against dirt, `ROAD_RANK` 1 against 0 — with the cobble's kerb and the floor and grass beside it: the road depth bias (`ROAD_DEPTH_UNITS`, -8) and the rank ladder that X3.5 moves into our renderer",
      pos: [82, 6, 23],
      target: [72, 1.93, 12],
    },
    // Appended for X4.6a: the field at each row of `CONFIG.grass.tiers`, from
    // `crossing`'s pose so the benchmark gains no stop and the road the mask
    // rejects and the channel it stops at are both in frame. `high` is this
    // machine's default and is last, so it is also the proof the two before it
    // put back what they changed.
    ...grassRows(),
    // Appended for X4.6c, at `crossing`'s eye so the benchmark gains no stop.
    {
      id: "shore-ahead",
      of: "the channel and the far bank's reeds through the trunks, mid-gust, through a 15° field from `crossing`'s eye, blades standing in the water on both banks",
      proves:
        "blades AHEAD of the water they stand in (X4.6c): the field's centre is nearer this eye than the water's by a hand's width, so Babylon's opaque list drew the blades first and the water takes every tie along each waterline. Drawn behind the water, 355 pixels move by up to 60/255; `harrowmead-shore-behind` is the other way round, which is why no one draw point holds both",
      pos: [82, 6, 23],
      target: [69.25, -0.09, -19.75],
      fov: 15.3,
      wind: 2.6,
    },
  ],
  coldharbour: [
    // Re-posed for the bay (6e848a1): the curtain walls now front the street
    // north of the square, at z ~43, and the old poses filmed a podium, a
    // corner and the side of a building. The distances are the old ones.
    {
      id: "curtain2",
      of: "a curtain-walled tower north of the square, 3 m off its glazing a storey above its stone podium, square on",
      proves:
        "CEL_GLASS_BACKED at the range where the composite IS the picture — the arithmetic standing in for the mass behind the sheet, and the depth write that pays for it",
      pos: [-16, 12, 41],
      target: [-16, 14, 44],
    },
    {
      id: "curtain40",
      of: "the same curtain wall from over the civic square's trees, 40 m out",
      proves:
        "the same pane with fog and the front-to-back opaque sort in front of it — the near half of the `GLASS_DEPTH_UNITS` question, which is a NUMBER taken by M7's own rig and a picture here",
      pos: [-16, 8, 3],
      target: [-16, 10, 43],
    },
    {
      id: "curtain90",
      of: "the same curtain wall from south of the square, 90 m out",
      proves:
        "that distant glazing is DRAWN AT ALL — the failure `GLASS_DEPTH_UNITS` exists for is a pane losing the depth test past ~100 m, which is a sheet that silently is not there rather than one that looks wrong",
      pos: [-16, 8, -47],
      target: [-16, 12, 43],
    },
    {
      id: "avenue",
      of: "the town end to end from twelve metres over its west edge, roofs and towers stepping away to the harbour cranes 300 m off",
      proves:
        "the front-to-back opaque sort over the deepest sightline on the map, the fog on a map with no wall, and the shadow window — placed at this eye by `placeVantage` — against what lies past it",
      pos: [-150, 12, -26],
      target: [150, 6, -26],
    },
    {
      id: "shopfront",
      of: "a shop window from the pavement, 5 m off, the shop's lamps behind the glass",
      proves:
        "SEE-THROUGH glazing (`getGlass` over its block's cube) — a breakable pane with a room behind it, the kind the curtain walls are not — and the probe it samples",
      pos: [61.3, 1.7, 38.7],
      target: [61.3, 2.3, 33.7],
    },
    {
      id: "blast",
      of: "a grenade's blast on the square's lawn half a second after it went off, the war memorial behind",
      proves:
        "`BlastFx` and `BlastShader` (X4.4) — the lit billows hot and cooling, the streamers and the surge — which no map view holds, since the pool idles switched off",
      pos: [-16, 1.7, -12],
      target: [-4, 3, -3],
      blast: { at: [-4, -3], age: 0.5 },
    },
    {
      id: "ground",
      of: "the eye 35 cm off the civic square's floor at its south-west corner, sunlit, looking north-east past the clean-cut lawns to the war memorial",
      proves:
        "the floor's bumped ground variant at grazing incidence in full sun, where the relief reads hardest, and a turf edge cut CLEAN (`GrassRect.edge` 0) against bare floor — the turf must still draw over the floor (X3.5)",
      pos: [-25, 0.35, -19],
      target: [26, 1, 26],
    },
    {
      id: "crossing",
      of: "the asphalt avenue's junction at the town's west side from six metres up, where a cobbled lane runs into it, the floor beside both",
      proves:
        "ASPHALT meeting COBBLE — `ROAD_RANK` 2 against 1, the top of the ladder — and both against the floor: the road depth bias (`ROAD_DEPTH_UNITS`, -8) and the rank ladder that X3.5 moves into our renderer",
      pos: [-41, 6, -41],
      target: [-51, 0.02, -51],
    },
    // Appended for X4.4a, so every row above carries the state it was banked
    // with (`bank.mjs --rows`).
    ...effectRows(),
    // Appended for X4.5a, after every row above, at the `avenue` row's eye so
    // the benchmark gains no stop.
    {
      id: "sky-disc",
      of: "the low sun over the sea from twelve metres above the town's west edge, its halo and bloom in a bright sky, clouds beside it and the wooded headland under it",
      proves:
        "the disc and its bloom on a DAY map (X4.5c), where the dome is bright and the disc's boost is what still reads against it, and the ring's lit undersides beside it (X4.5b)",
      pos: [-150, 12, -26],
      target: [-214.6, 52.7, -90.6],
    },
    {
      id: "sky-ring",
      of: "the cloud ring over the town from the same eye, looking east along the avenue, banks standing on the horizon behind the roofs and the harbour cranes",
      proves:
        "the CLOUDS on a day map (X4.5b): lit and shaded facets against the dome down to the horizon, every roof in front of them by the 7 km depth they write, and their order against the opaque world",
      pos: [-150, 12, -26],
      target: [150, 50, -26],
    },
    // Appended for X4.6a, after every row above, at eyes the rows above stand at.
    {
      id: "ring-stones",
      of: "the civic square's capture ring from eight metres over its south side: limed stones in a line across the crazy paving and the lawn, the paint taking over across the cobbled pad, the flag at rest behind the memorial at the frame's left edge",
      proves:
        "a ring's STONES on open ground (X4.6b), both tones' batches, bedded in the floor and inked — `ring` holds only paint, its square being all made ground — and the point where the stones stop and the paint takes over",
      pos: [-16, 8, 3],
      target: [-6, 0.5, -6],
      zones: true,
    },
    {
      id: "ring-flown-far",
      of: "the same square's flag run up in the Redline's colours from south of the square, ~53 m off, through a 14° field, against the tower behind the memorial",
      proves:
        "the cloth's FAR sheet (11x7, past `LOD_FAR`) in the other side's colours, its handover resampled off the near sheet (X4.6b): the second of the two sheets and the second pair of the four surfaces a flag has",
      pos: [-16, 8, -47],
      target: [2.5, 8, 2.5],
      fov: 14,
      zones: true,
      flown: { meters: [0, 0, 1, 0, 0], seconds: 6 },
    },
    {
      id: "fx-water-fade",
      of: "two rounds' sparks and discs mid-fade over the harbour's water from eight metres above it, a third round's tracer on its way through the surface into the bed, a moored boat at the top of the frame",
      proves:
        "a FADE over WATER (X4.6d, X4.6e): two `hard` impacts as `onRound` hands over a round stopped on a hull (`drawn`, no mark), their sparks and discs blended over the water's grid, the water having written depth and colour first — and a round through the surface (`round`, `drawRounds`' own wall query, which no water is in) whose `ground` disc is on the bed, 0.7 m under the surface, and rejected by the water's depth: its draw is in the log and it owns no pixel",
      pos: [-16, 8, -47],
      target: [-16, -2.2, -60],
      fov: 40,
      fx: {
        seconds: 0.3,
        events: [
          { at: 0.18, drawn: { from: [-16, 6, -48], to: [-18, -1.9, -58], kind: "hard", normal: [0, 1, 0.2] } },
          { at: 0.22, drawn: { from: [-16, 6, -48], to: [-14, -1.9, -61], kind: "hard", normal: [0, 1, 0.2] } },
          { at: 0.25, round: { from: [-16, 6, -48], to: [-12, -6, -60] } },
        ],
      },
    },
    {
      id: "fx-glass-broken",
      of: "the square's west shopfront with pane 0 BROKEN, 0.9 s on: the shop's empty room through the hole, the street's reflection gone with the glass, the transom lights with it (they are one sheet behind the bars), the shards on the pavement in front and the left-hand window untouched",
      proves:
        "a REAL break's picture (X4.6e): `GlassFx.collapse` writing the pane's vertex range out of its merged block's position buffer, raised by the two callbacks `Game` wires, beside the glazing the same block still draws — what `fx-shards` says it is not. The put-away stands the sheet up again, so a row after it has a window to look at",
      pos: [-16, 1.7, -12],
      target: [-23.8, 2, -6.65],
      fx: { seconds: 0.9, events: [{ at: 0, breaks: { pane: 0, at: [-23.8, 2, -6], dir: [1, -0.1, 0] } }] },
    },
    // Appended by X4.6a's review, after every row above, at an eye they stand at.
    {
      id: "fx-blob-sort",
      of: "the square's west shopfront with four bodies' contact shadows: three on stated floors above the eye — behind the glass under the far impact, in front of the glass behind the near impact, in front of both — standing in for decks nothing is built under here, which show nothing from below, and a fourth on the pavement below the eye, seen from above",
      proves:
        "the BLOB's FACING (X4.6e's picture change, the owner's decision of 2026-11-05): a disc faces UP on a back-culled pipeline, so the one on the pavement below the eye is drawn and the three above it, seen from below, own no pixel — the guard on anything that gets the facing or the cull wrong. Until that change the facing was the other way and the three above showed, which is how this row held the blob's place in the back-to-front run among the panes and the fades (farthest first: the panes, the far spark and disc, 12.58 and 12.57, a blob, 11.3, pane 0's block, 8.35, a blob, 7.76, the near spark and disc, 7.14 and 7.12, a blob, 6.21); a blob seen from above between two glass layers is a row no table holds yet",
      pos: [-16, 1.7, -12],
      target: [-23.8, 2, -6.65],
      fx: {
        seconds: 0.3,
        events: [
          { at: 0, blob: { at: [-24.79, 2.94, -4.9] } },
          { at: 0, blob: { at: [-22.74, 2.9, -8.2] } },
          { at: 0, blob: { at: [-21.4, 2.85, -9] } },
          { at: 0, blob: { at: [-21.5, 0.6, -8] } },
          { at: 0.2, round: { from: [-17, 2, -11], to: [-25.769, 3.051, -4.11] } },
          { at: 0.23, drawn: { from: [-17, 2, -11], to: [-22.2, 2.89, -8.5], kind: "hard", normal: [7.8, 0.8, -4.4] } },
        ],
      },
    },
    {
      id: "fx-scorch-glass",
      of: "the same shopfront with two scorch marks, the fires long out, faintly darkening the bottom of both windows: one on the shop's floor behind the glass, 9 s old at full, and one on a ledge 1.2 m short of it, 11.5 s old and fading, overhanging through the glass",
      proves:
        "the SCORCH THROUGH GLASS (X4.6e), which `fx-scorch` and every other scorch row lack: a mark sorted BEHIND pane 0's block (12.83 against 8.35), so the glass is blended over it, and one sorted IN FRONT of the block (7.75) whose far half lies behind the sheet and is blended over it all the same: both orders of a decal with no depth write on a pipeline of its own (bias -4, slope -2, no cull), each sharing thousands of pixels with the panes and with the other mark",
      pos: [-16, 1.7, -12],
      target: [-23.8, 2, -6.65],
      fx: { seconds: 11.5, events: [{ at: 0, blaze: { at: [-22.6, 1.6, -8] } }, { at: 2.5, blaze: { at: [-27.5, 0.8, -6.5] } }] },
    },
    {
      id: "ring-behind-field",
      of: "the square's lawns and the memorial through a 12° field, from the crossing's eye south-west of it, the limed stones crossing the far lawn and the cobbles behind the tree, two parked cars in front",
      proves:
        "a ring FARTHER than its field's blades (X4.6b): Babylon's opaque list drew such a surface behind the blades, which all sort at their field's centre, and a tie between a blade and a stone is real, so it falls behind them in the one run (`NearestRun`, X4.6d) where `ring-stones`' falls ahead: drawn ahead of them, 54 pixels of this frame move by up to 113/255, within floor at `--check`",
      pos: [-41, 6, -41],
      target: [-7.5, 0.4, -10],
      fov: 12,
      zones: true,
    },
  ],
  harrowmead: [
    {
      id: "millpond",
      of: "the millpond from its west shore, and the mill and its wheel downstream past its east lip",
      proves:
        "the water on the map where it is a POND rather than a sheet over everything — a reflected mass with a shore round it, plus the water meadows' grass at the edge",
      pos: [-160, 1.6, 102],
      target: [-108, 3, 70],
    },
    {
      id: "borderland",
      of: "the south borderland from just inside the play square, the floor carrying on past it",
      proves:
        "the terrain and the fog with NO WALL and no rim in the way — the one vantage in the set where what is drawn at the far end is the map continuing rather than a boundary box",
      pos: [24, 6, -178],
      target: [10, 12, -260],
    },
    ...viewRows(),
    {
      id: "ground",
      of: "the eye 35 cm off the floor behind the high street's south row, against the evening light, looking west along the strip between the houses and the field, the grass's edge on the left",
      proves:
        "the floor's bumped ground variant at grazing incidence, backlit, and the edge where the field's turf stops at the bare strip — the turf must still draw over the floor (X3.5)",
      pos: [-12, 0.35, -36],
      target: [-75, 1.15, -39],
    },
    {
      id: "crossing",
      of: "the dirt lane running into the cobbled high street, from nine metres over it, the street's kerbs, the floor either side and the market green beyond",
      proves:
        "DIRT meeting COBBLE at the cobble's kerb — `ROAD_RANK` 0 against 1, a path road against a rectangle — and both against the floor and the green's turf: the road depth bias (`ROAD_DEPTH_UNITS`, -8) and the rank ladder that X3.5 moves into our renderer",
      pos: [0.5, 9, -29],
      target: [0, 0.8, -16],
    },
    // Appended for X4.3a, so every row above carries the state it was banked
    // with (`bank.mjs --rows`).
    ...viewmodelRows(),
    ...kitRows(),
    // Appended for X4.3a's review, after the kit rows for the same reason.
    ...reviewRows(),
    // Appended for X4.6c, at `millpond`'s eye and the menu's, so the benchmark
    // gains no stop.
    {
      id: "shore-behind",
      of: "the millpond's bank a dozen metres off along the water's edge, mid-gust, a stress row at an 8° field, narrower than any sight in the game (the 6x's is about 9.8°): the swell and the blades standing in it",
      proves:
        "blades BEHIND the water they stand in (X4.6c): the water's centre is nearer this eye than the field's, so Babylon's opaque list drew the water first and the blades take every tie along the waterline. Drawn ahead of the water, 58 pixels move by up to 76/255",
      pos: [-160, 1.6, 102],
      target: [-161.37, 0.14, 88.95],
      fov: 8,
      wind: 2.6,
    },
    {
      id: "shore-ahead",
      of: "the far bank of the mill stream over a shed roof, mid-gust, a stress row at a 4° field from the menu's eye, far narrower than any sight in the game (the 6x's is about 9.8°): the water, and a wall of meadow standing at the end of it",
      proves:
        "blades AHEAD of the water at range (X4.6c): the field's centre is nearer this eye than the water's and a depth step here is centimetres, so the ties run the length of the bank. Drawn behind the water, 251 pixels move by up to 154/255",
      pos: [32, 12, -10],
      target: [200.04, -0.08, 13.01],
      fov: 4.05,
      wind: 2.6,
    },
  ],
  sarab: [
    {
      id: "alley",
      of: "an alley in the old town at eye height, mud-brick walls either side and a courtyard house's parapet over them",
      proves:
        "the cel fragment on the map's own vernacular at close range — CEL_BUMP on the sand at a grazing angle, the ink on a parapet's coping, and the FOG doing nothing at all, which is the arm of the fog term no other vantage in this bank photographs (every other map's is at or past its own diagonal)",
      pos: [20, 1.7, 120],
      target: [92, 3, 130],
    },
    {
      id: "shelf",
      of: "the whole town from the Martyrs' shelf, seven metres up and four hundred metres of it in frame",
      proves:
        "the fog wall INSIDE the play square — the one thing no other banked frame has, since this is the only map whose `fogEnd` is short of its own diagonal — plus `WorldCulling`'s block half, which is inert everywhere else, and the shadow window over a whole town. **The window is in it now**: for a while this note had to say it was not, because a bank is frozen in `deploy`, where nothing places the shadow maps, and they stayed wherever the install left them — 260 m from here. `placeVantage` places them at each row's eye since X0.1",
      pos: [228, 20, 132],
      target: [-120, 2, 96],
      fov: 58,
    },
    {
      id: "wadi",
      of: "the west ford looking down the wadi, the palm grove standing in the bed",
      proves:
        "the sway term on a crown of long thin fronds — the shape `world/sway.ts` says a vertex ramp draws worst — and the terrain at the steepest gradient on the map, taken mid-gust so the sway is in the picture",
      pos: [-66, 5, -10],
      target: [-66, -4, -96],
      wind: 2.6,
    },
    // One hull of each kind, on the west base's three hardstandings, parked as
    // a round builds them. Three-quarter views, so a hull is its silhouette
    // and two of its faces.
    {
      id: "tank",
      of: "the west base's tank broadside on, 10 m off",
      proves: "a TANK's hull model and its cel paths (X4.2) — the one kind every armoured map has",
      pos: [-284, 2.5, -324],
      target: [-292, -1.4, -316],
    },
    {
      id: "truck",
      of: "the west base's truck from its front quarter, 11 m off",
      proves: "a TRUCK's hull model (X4.2)",
      pos: [-314, 2.5, -314],
      target: [-322, -1.4, -306],
    },
    {
      id: "heli",
      of: "the west base's helicopter broadside on, on its pad",
      proves: "a HELICOPTER's hull model, rotor at rest (X4.2) — the kind with the most thin parts for the ink",
      pos: [-302, 3, -341],
      target: [-312, -0.6, -332],
    },
    // Bodies. Sarab because its `bodyDrawDistance` (300) is the one a body at
    // 250 m is inside on a straight road, and that gate is what X4.1 moves.
    {
      id: "rig-near",
      of: "a soldier mid-stride on the west highway, 6 m off, facing the camera",
      proves:
        "a RIG (X4.1): an instance of its side's kit, drawn a rank at a time (X4.1d), the kit palette in `uv2.x`, the team colour worn, and its shadow in the bodies' map — the half of the cel shader no map view reaches",
      pos: [-66, 1.7, 0],
      target: [-66, 1.1, 6],
      rigs: [{ at: [-66, 6], yaw: Math.PI - 0.6, pose: { moving: 1, phase: 1, run: 0.3, stride: 0.35 } }],
    },
    {
      id: "rig-far",
      of: "a soldier standing on the same highway 250 m off, through a 10° field",
      proves:
        "that a body inside `bodyDrawDistance` is DRAWN at range — the culling, the LOD and the fog on a rig — which is the regression that is a body silently not there",
      pos: [-66, 1.7, 0],
      target: [-66, 1, 250],
      fov: 10,
      rigs: [{ at: [-66, 250], yaw: Math.PI }],
    },
    {
      id: "ground",
      of: "the eye 35 cm off the sand on the oasis's east bank, looking south-west over the ripples to the edge of the grass by the pool, and the walls past it",
      proves:
        "the floor's bumped ground variant at grazing incidence on the map's sand, whose ripples are the deepest relief in the set, and a dense grass rect's edge against bare sand — the turf must still draw over the floor (X3.5)",
      pos: [-157, 0.35, 66],
      target: [-205, 0.4, 40],
    },
    {
      id: "crossing",
      of: "the west highway (asphalt) crossing the northern track (dirt) from seven metres up, cones on the verge, the sand in all four corners",
      proves:
        "two RECTANGLE roads crossing as coplanar sheets, asphalt over dirt (`ROAD_RANK` 2 against 0) — the case the rank ladder exists for, with no junction patch to hide it — and both against the sand: the road depth bias (`ROAD_DEPTH_UNITS`, -8) and the rank ladder that X3.5 moves into our renderer",
      pos: [-55, 7, 197],
      target: [-66, 0, 208],
    },
    // Appended for X4.6a, at the menu's eye so the benchmark gains no stop: the
    // one sight line from any eye in the table that reaches water through glass.
    {
      id: "pane-water",
      of: "the car drowned to its sills in the east pool, ~187 m from the menu's eye through a 1° field, the pool's water seen through its windows",
      proves:
        "WATER THROUGH A PANE (X4.6d, X4.6e): see-through glazing blended over water that was drawn first, the pool's far quad at this range (no body is both inside `quadBeyond` and behind glass from any eye in the table). A pane drawn before the water would be painted over by it, and the glass would read as dry",
      pos: [96, 9, 30],
      target: [268.27, -6.3, -39.8],
      fov: 1,
    },
    // Appended for X4.6c's review, at `shelf`'s eye so the benchmark gains no stop.
    {
      id: "shore-flip",
      of: "the far pool's bank 474 m off across the town from the Martyrs' shelf, mid-gust, at a 13.75° field, between the 3.5x's and the 6x's: blades standing in the west pool, with the middle pool's reeds in the same frame on the other side of the sort",
      proves:
        "the ONE PICTURE DIFFERENCE X4.6c left, the owner's of 2026-11-04, and ended at X4.6d: this eye has the middle pool nearer than the field's centre and the west pool farther, so Babylon's opaque list drew the blades BETWEEN them, which the one run does again (`NearestRun`) and two points around that list could not. Its truth is Babylon's order, banked at 21839d1; from X4.6c to X4.6d the blades took ties the farther water should win, 27 pixels by 54/255",
      pos: [228, 20, 132],
      target: [-190.75, -6.31, -90.75],
      fov: 13.75,
      wind: 2.6,
    },
  ],
  cinderhaven: [
    {
      id: "town",
      of: "the harbour town's cobbled square at night, the memorial, lit windows, street lamps and the lighthouse",
      proves:
        "the night map at street level — a moonless violet key, the lamps and the emissive palette carrying the frame — where its menu row is a far shot of the island",
      pos: [-90, 1.7, 300],
      target: [-60, 8.4, 340],
    },
    {
      id: "ground",
      of: "the eye 35 cm off the floor north-east of the town, at night, looking east along it to the farm walls, a field's grass at the left edge and the floor running out to the horizon",
      proves:
        "the floor's bumped ground variant at grazing incidence under the moonless key, out to the horizon of the largest floor in the set, and a turf edge against bare floor — the turf must still draw over the floor (X3.5)",
      pos: [250, 0.35, 404],
      target: [330, 2.29, 412],
    },
    {
      id: "crossing",
      of: "a cobbled junction in the old town at night, from six metres up, where a dirt lane comes in beside it, the floor between the houses",
      proves:
        "COBBLE meeting DIRT on a PATH network — `roadPaths.ts`'s junction patch and its kerb, `ROAD_RANK` 1 against 0 — and both against the floor on a slope: the road depth bias (`ROAD_DEPTH_UNITS`, -8) and the rank ladder that X3.5 moves into our renderer",
      pos: [-150, 6, 262],
      target: [-159, 9.29, 273],
    },
    // Appended for X4.2c, so every row above carries the state it was banked
    // with (`bank.mjs --rows`).
    {
      id: "tank-far",
      of: "the west yard's tank from 415 m south-south-west, over the town's roofs at night, at the hip field — its whole measure ~30.5 px across on the bank's 1080 rows",
      proves:
        "the hull DETAIL TIER (X4.2c): the tank just past its 32 px swap (`CONFIG.graphics.culling.hullDetail`), drawn as its REDUCED set — no links, road wheels or cupola ring — 29% of the way along Cinderhaven's fog ramp, under ~8% of its fog (the shader mixes in the ramp's square). The tier is ~55 pixels of this frame, far under `CHECK_TOLERANCE`'s mean, so only a PIXEL comparison of two `--keep` directories sees it, never `--check`'s grade. X4.2d's fade at `hullDrawDistance` reaches this row when a scratch layout sets the distance between its floor (`hullDrawFloor`, ~419.4 m) and ~460 m — the fade measured to the measure's centre and ending AT the distance, so the tank fades over 415-461 m (X4.2d's own check set 440: fade 0.57)",
      pos: [-581, 15, 73],
      target: [-473, 8.5, 473],
    },
    // Appended for X4.4a, after `tank-far` for the reason that row gives.
    ...fireRows(),
    // Appended by the commit after X4.4b that took the pieces' stale-sphere
    // latch out, after every row above (`farPieceRows`).
    ...farPieceRows(),
    // Appended by the commit after X4.4c that took the debris's latch out,
    // after every row above (`farShardRows`).
    ...farShardRows(),
    // Appended for X4.5a, after every row above, at eyes the rows above stand
    // at, so the benchmark gains no stop. `sky-flash` LAST: it reads the storm's
    // schedule at a clock of its own, and any row after it would step on from
    // there.
    {
      id: "sky-cloud-moon",
      of: "the crater's disc going behind a cumulus over the sea at night, from the west shore with the field closed to 30°, its bloom cut along the cloud's top",
      proves:
        "a cloud crossing the disc (X4.5b, X4.5c): the disc stands at 9 km behind the 7 km depth a cloud writes, so it is rejected through one and un-bloomed through one, the bloom being occluded by depth alone. It needs no turn of the ring: at the freeze's 0 this eye lines them up",
      pos: [-581, 15, 73],
      target: [-649, 49, 8],
      fov: 30,
    },
    {
      id: "sky-ring",
      of: "the cloud ring at night from 35 cm off the floor north-east of the town: lit heaps on the horizon behind the lighthouse and the island's far ridge, the disc clear above them",
      proves:
        "the CLOUDS on the night map (X4.5b): the crater's light on one side of every heap against a violet dome, standing on a horizon ~1 km off",
      pos: [250, 0.35, 404],
      target: [-200, 60, -100],
    },
    {
      id: "sky-far",
      of: "the mountain's ridge from the town's quay, 680 to 740 m off, its top against the dome behind a crane and a boathouse",
      proves:
        "something past 600 m against the sky (X4.5c): the dome stands at `domeRadius` 600 m with the eye and writes no depth, so it is right only because it is drawn BEFORE this ridge — drawn after it, the dome passes the depth test and paints over it",
      pos: [-90, 1.7, 300],
      target: [-160, 40, -300],
    },
    {
      id: "sky-flash",
      of: "the same horizon as `sky-ring` under a lightning flash near its peak, the dome and the clouds lifted, every ridge and lighthouse black against them",
      proves:
        "the flash on the dome (X4.5c: `Sky.setFlash` through the dome's emissive colour, which `wgsl/sky.ts` adds over its texture, as a `StandardMaterial` did) and through the clouds' two lit tones (X4.5b) — the map's own seeded strike, read off its schedule at a clock of 28.484 s",
      pos: [250, 0.35, 404],
      target: [-200, 60, -100],
      strike: 28.484,
    },
  ],
  kurenai: [
    {
      id: "ground",
      of: "the eye 35 cm off the mossy floor south-west of the town, fallen leaves on it, looking west under a maple to the storehouses and the edge of the field's grass",
      proves:
        "the floor's bumped ground variant at grazing incidence with its wear and moss, and the field's turf edge against bare floor — the turf must still draw over the floor (X3.5)",
      pos: [-20, 0.35, -74],
      target: [-60, 0.9, -90],
    },
    {
      id: "crossing",
      of: "the dirt lane coming between two rows of houses to the cobbled street's end, from seven metres up, where the cross lane runs past it",
      proves:
        "DIRT meeting COBBLE across a rectangle road's end, at its kerb — `ROAD_RANK` 0 against 1 — and the floor on the verges: the road depth bias (`ROAD_DEPTH_UNITS`, -8) and the rank ladder that X3.5 moves into our renderer",
      pos: [0, 7, -70],
      target: [0, 0.01, -52],
    },
  ],
};

/**
 * The viewmodel, hip and aimed, one weapon per optic: each optic on the
 * weapon it reads best on, so five weapon models are in the set as well as
 * five sights. Harrowmead's millpond is behind them because it is daylight
 * with water, foliage and a lit building in one direction.
 */
function viewRows(): Vantage[] {
  const fits: [sight: SightId, weapon: CarriedId][] = [
    ["reflex", "smg"],
    ["iron", "rifle"],
    ["holo", "carbine"],
    ["prism", "lmg"],
    ["scope", "sniper"],
  ];
  return fits.flatMap(([sight, weapon]) =>
    [false, true].map((aimed) => ({
      id: `view-${sight}-${aimed ? "aim" : "hip"}`,
      of: `the ${weapon} with the ${sight} sight, ${aimed ? "aimed" : "at the hip"}, over the millpond`,
      proves: aimed
        ? "the aimed pose `applyFit` derives (the sight centred on the axis) and the optic's own field — the picture the reticle cannot lie in (X4.3)"
        : "the viewmodel's rendering group — drawn into the world's depth, which is not cleared for it — its ink band, the weapon model and the sight (X4.3)",
      pos: [-160, 1.6, 102],
      target: [-108, 3, 70],
      view: { weapon, sight, aimed },
    })),
  );
}

/**
 * Where every viewmodel row stands: `viewRows`' millpond. A function rather
 * than a constant, because `DIFF_VANTAGES` above is built when the module
 * loads and a `const` down here is not yet initialised then.
 */
function millpond(): Pick<Vantage, "pos" | "target"> {
  return { pos: [-160, 1.6, 102], target: [-108, 3, 70] };
}

/** A viewmodel row at the millpond. */
function viewRow(
  id: string,
  of: string,
  proves: string,
  view: NonNullable<Vantage["view"]>,
): Vantage {
  return { id: `view-${id}`, of, proves, ...millpond(), view };
}

/**
 * A reload held at `reloadPhase`: live, the gate full, over the weapon's own
 * `reloadTime` (`seconds`), dry or tactical.
 *
 * **A row holding a reload is posed off ITS OWN previous frame** (`harness.mjs`'
 * `placeVantage`): the gesture's gravity is the world's down put through the
 * weapon's world matrix (`ViewModel.evaluateReload`), which Babylon answers
 * from its render cache — the matrix the LAST RENDER composed. Posed straight
 * after the row before it, that would be the previous row's weapon; so the
 * pose is run, one frame is rendered with it up, and the pose is run again,
 * which is what a reload held in a round reads every frame (the weapon's pose
 * does not depend on the gravity, so one frame reaches the fixed point).
 */
function reloadParams(reloadPhase: number, seconds: number, dry: boolean): Partial<ViewModelParams> {
  return { reloading: true, reloadBlend: 1, reloadPhase, reloadTime: seconds, reloadDry: dry };
}

/**
 * What the ten rows above cannot see and `BABYLON_EXIT.md` X4.3b-d move: the
 * two optics they leave out, the three rigs with a sight of their own (the
 * pistol's notch at its own eye relief, the launcher's prism, the mine), one
 * finish on each rung of the gloss ladder above matte, and every gesture held
 * mid-phase — each a function of its phase (`Vantage.view`), so the frame is
 * the same every run. Appended after the ten rather than among them, so that
 * none of them is shot after a state it was not banked with.
 */
function viewmodelRows(): Vantage[] {
  const row = viewRow;
  // A dry reload of the rifle, `reloadTime` its own (1.4 s). Posed off its
  // OWN previous frame, never the row before's: its gravity reads the weapon's
  // world matrix out of Babylon's render cache (`reloadParams` has the rule,
  // and `placeVantage` renders the frame).
  const dry = (reloadPhase: number) => reloadParams(reloadPhase, 1.4, true);
  return [
    row(
      "greendot-hip",
      "the rifle with the green dot, at the hip, over the millpond",
      "the GREEN DOT optic's housing and dot on a rail weapon — one of the two optics the ten rows above leave out (X4.3)",
      { weapon: "rifle", sight: "greenDot", aimed: false },
    ),
    row(
      "greendot-aim",
      "the rifle with the green dot, aimed",
      "the green dot's aimed pose derived by `applyFit` and its own field — the dot on the axis (X4.3)",
      { weapon: "rifle", sight: "greenDot", aimed: true },
    ),
    row(
      "longscope-hip",
      "the DMR with the long scope, at the hip",
      "the DMR's model, which the ten rows above leave out, and the LONG SCOPE's housing (X4.3)",
      { weapon: "dmr", sight: "longScope", aimed: false },
    ),
    row(
      "longscope-aim",
      "the DMR with the long scope, aimed",
      "the long scope aimed — the highest magnification in the kit, its eye relief the longest in the table, held clear of the near plane (X4.3)",
      { weapon: "dmr", sight: "longScope", aimed: true },
    ),
    row(
      "pistol-aim",
      "the pistol, aimed down its own sights",
      "the one FIXED sight a weapon is held at by its OWN eye relief (`WeaponSights.eyeRelief`, not the iron's) — the notch and blade on the slide, the aimed pose derived off them (X4.3)",
      { weapon: "pistol", sight: "iron", aimed: true },
    ),
    row(
      "rpg-aim",
      "the launcher on the shoulder, aimed through its own prism",
      "the launcher's model and its fixed prism (`RpgModel`) aimed through — the chevron on the axis — the one rig whose optic is part of the weapon rather than on a rail (X4.3)",
      { weapon: "rpg", sight: "iron", aimed: true },
    ),
    row(
      "mine-hip",
      "the mine in the hands, at the hip",
      "the mine's model, the fourth rig the ten rows above leave out (X4.3)",
      { weapon: "mine", sight: "iron", aimed: false },
    ),
    row(
      "finish-satin",
      "the rifle with the iron sights in Oxblood, at the hip",
      "the gloss ladder's SATIN rung on the body and the fittings (`spec.rifleSatin`) — a finish is a material write on the weapon's colour groups and nothing else (X4.3)",
      { weapon: "rifle", sight: "iron", aimed: false, finish: "oxblood" },
    ),
    row(
      "finish-glint",
      "the rifle with the iron sights in Signal, at the hip",
      "the gloss ladder's middle rung (`spec.rifle`) on the fittings, under a repainted body and furniture (X4.3)",
      { weapon: "rifle", sight: "iron", aimed: false, finish: "signal" },
    ),
    row(
      "finish-mirror",
      "the rifle with the iron sights in Quicksilver, at the hip",
      "the gloss ladder's MIRROR rung (`spec.rifleChrome`), the top one, which reflects the room rather than adding a highlight (X4.3)",
      { weapon: "rifle", sight: "iron", aimed: false, finish: "quicksilver" },
    ),
    row(
      "reload-drop",
      "the rifle's dry reload held just after the magazine left the well: the spent magazine falling below it, the support hand gone to the pouch, the head looking down and leaning",
      "the SPENT magazine (the clone) falling on its pivot, the support arm off the handguard, and the body node turned against the head's look — the camera tipped and leaning as `CameraSystem` turns it, the weapon left in the hands (X4.3)",
      { weapon: "rifle", sight: "iron", aimed: false, params: dry(0.26) },
    ),
    row(
      "reload-seat",
      "the same reload held as the fresh magazine is offered to the well",
      "the FRESH magazine (the weapon's own node) on its pivot in the support hand at the well, both arms on their pivots, the weapon canted to meet it about the firing hand and the firing wrist's quaternion taking some of the turn back (X4.3)",
      { weapon: "rifle", sight: "iron", aimed: false, params: dry(0.5) },
    ),
    row(
      "bolt",
      "the sniper rifle's bolt cycle held with the bolt drawn back",
      "the bolt cycle at the hip: the rifle rolled out of the carry, the BOLT node turned up and drawn to its stop, and the trigger arm gone off the grip to work it (below the frame here) (X4.3)",
      { weapon: "sniper", sight: "scope", aimed: false, params: { cyclePhase: 0.42 } },
    ),
    row(
      "load",
      "the launcher's load held as the fresh rocket goes back down the bore, the hand behind it",
      "the WARHEAD node off its seat and turned onto the bore on its pivot, the support arm riding it, and the tube come down off the shoulder (X4.3)",
      { weapon: "rpg", sight: "iron", aimed: false, params: { loadPhase: 0.6 } },
    ),
    row(
      "throw-frag",
      "the rifle in the firing hand while the other hand cocks a frag back",
      "the THROWING arm, the fist and its frag with the pip on it (a mesh parenting a mesh), the support arm switched off for it and the weapon's give (X4.3)",
      { weapon: "rifle", sight: "iron", aimed: false, throwable: "frag", params: { throwTime: 0.14 } },
    ),
    row(
      "throw-molotov",
      "the same throw with the bottle in the fist",
      "the molotov in the fist — the bottle and its neck, cloth and wick hung off it, the wick emissive (X4.3)",
      { weapon: "rifle", sight: "iron", aimed: false, throwable: "molotov", params: { throwTime: 0.14 } },
    ),
    row(
      "flash",
      "the rifle at the hip on the frame it fires, the muzzle flash on the muzzle",
      "the muzzle FLASH's three emissive petals on the viewmodel's muzzle node, on a seeded strobe, and their bloom (X4.3)",
      { weapon: "rifle", sight: "iron", aimed: false, flash: true },
    ),
  ];
}

/**
 * The kit screen, at the bay `LoadoutScreen.stageBay` measures over the
 * bank's own 1920x1080 frame and at the one it measures on an 832x384 phone,
 * both shot at the bank's size — the second puts the weapon right of centre
 * and the card's pool of light with it (`paintKitPool`).
 */
function kitRows(): Vantage[] {
  const row = (id: string, of: string, kit: NonNullable<Vantage["kit"]>): Vantage => ({
    id: `kit-${id}`,
    of,
    proves:
      "the KIT SCREEN's stage: the card (blended, depth `always` and written, last of group 0), the weapon on the turntable in front of it with no arms, the bench lamps, and the glow's stage rule — only the weapon may bloom (X4.3)",
    ...millpond(),
    kit,
  });
  return [
    row("desktop", "the kit screen over the millpond at a desktop's bay: the carbine with the holo on the turntable", {
      weapon: "carbine",
      sight: "holo",
      bay: { x: -0.0104, y: -0.0617, width: 0.4549, height: 0.5346 },
    }),
    row("phone", "the kit screen at a phone's bay: the SMG with the reflex in Bullion on the turntable, right of centre", {
      weapon: "smg",
      sight: "reflex",
      finish: "bullion",
      bay: { x: 0.324, y: -0.0083, width: 0.608, height: 0.4761 },
    }),
  ];
}

/**
 * What X4.3a's review found the rows above still could not see: the pistol's
 * SLIDE, which moves only in its dry reload; the bolt cycle AIMED, where the
 * bolt moves and the reticle must not; and a TACTICAL reload, whose spent
 * magazine is stripped out into the hand rather than dropped.
 */
function reviewRows(): Vantage[] {
  return [
    viewRow(
      "pistol-reload",
      "the pistol's dry reload held as the fresh magazine goes up into the grip, the slide locked back",
      "the pistol's SLIDE node locked back on its stop, the barrel bare ahead of it (`WeaponParts.slide`, which moves in no other gesture), the pistol turned in about the firing hand, and the fresh magazine going up into the grip in the support hand (X4.3)",
      { weapon: "pistol", sight: "iron", aimed: false, params: reloadParams(0.6, 1.05, true) },
    ),
    viewRow(
      "bolt-aim",
      "the sniper rifle's bolt cycle held aimed, the bolt drawn back, the scope on the eye",
      "the bolt cycle AIMED, the one gesture that keeps the sight picture: nothing rolled and the reticle on the axis, in the same pixels as at rest, while the bolt is drawn — the bolt itself is behind the eyepiece at this magnification, and the cycle's wobble on the aim is `CameraSystem`'s and not posed (X4.3)",
      { weapon: "sniper", sight: "scope", aimed: true, params: { cyclePhase: 0.42 } },
    ),
    viewRow(
      "reload-tactical",
      "the rifle's tactical reload held as the spent magazine is stripped out of the well into the support hand",
      "the TACTICAL reload's spent magazine (the clone) stripped down the well in the support hand (`ReloadGesture.strippedAt`) rather than dropped, on its pivot, the head looking down (X4.3)",
      { weapon: "rifle", sight: "iron", aimed: false, params: reloadParams(0.22, 1.4, false) },
    ),
  ];
}

/**
 * The effect pools `BABYLON_EXIT.md` X4.4b-d take off Babylon's scene, each
 * raised through the door the game raises it by and posed on a stated clock
 * (`Vantage.fx`): a round's tracer, spark, dust disc and mark; the thrown and
 * laid bodies (a frag, a bottle, a rocket, a mine); the brass; the blast at
 * three ages on both surfaces, with its rubble and its scorch; a scorch
 * fading; a molotov burning; a pane's shards; and fading effects behind and
 * in front of see-through glazing — and, appended by X4.4a's review, a blast
 * at power 2, the wire's flying bodies, the flesh and glass sparks, and a
 * fade squarely behind a pane and one squarely in front of it. Coldharbour, because it has three things
 * these need in one boot: see-through glazing (`map.panes`, the square's
 * shopfronts), both ground kinds side by side (the quay's deck and walls
 * answer `hard`, the floor beside them `ground`), and armour, so the third
 * slot is in its kit. What it lacks is a world fire in the open, which
 * `fireRows` takes on Cinderhaven.
 *
 * **Every row stands where an earlier row of its map already stands**
 * (`curtain90`, `crossing`, `blast`, `avenue`) and only turns or narrows the
 * camera there: the benchmark takes one stop per POSITION (`BenchScript`), so
 * these add no stop to it and change nothing it plays. `fov` is what brings a
 * small thing up to size from a stop chosen for something else.
 */
function effectRows(): Vantage[] {
  /** `curtain90`'s eye: 8 m over the harbour, facing the quay's wall. */
  const harbour: Pos = [-16, 8, -47];
  /** `crossing`'s eye: 6 m over the junction at the quay's west end. */
  const quay: Pos = [-41, 6, -41];
  /** `blast`'s eye: on the square's lawn, by the shopfronts. */
  const square: Pos = [-16, 1.7, -12];
  /** `avenue`'s eye: 12 m over the town's west edge. */
  const avenue: Pos = [-150, 12, -26];
  const S = 1 / 60;
  /** Rounds from one shooter, each landing `age` seconds before the end of a `seconds`-long clock (less its flight). */
  const rounds = (seconds: number, from: Point, hits: readonly (readonly [to: Point, age: number])[]): FxEvent[] =>
    hits.map(([to, age]) => ({ at: seconds - age, round: { from, to } }));
  /** A blast `age` seconds old, raised as the wire's `explode` raises one — a frag's unless `power` says otherwise. */
  const blast = (id: string, on: "hard" | "ground", age: number, of: string, proves: string, power?: number): Vantage => {
    const at: Point = on === "hard" ? [-16, 0.05, -37.6] : [-16, 0.06, -31];
    return {
      id: `fx-blast-${on}-${id}`,
      of,
      proves,
      pos: harbour,
      target: [at[0], 1.5, at[2]],
      fx: { seconds: age, events: [{ at: 0, explode: power === undefined ? { at } : { at, power } }] },
    };
  };
  // A wall of marks: a jittered grid on the quay's harbour face, and on the
  // west face of a brick block 58 m down the avenue. The jitter is a fixed
  // table, not a random — the rows are data.
  const jitter = [0.11, -0.17, 0.05, 0.19, -0.08, -0.2, 0.14, -0.03, 0.08, -0.13, 0.17, -0.06];
  const near: (readonly [Point, number])[] = [];
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 4; j++) {
      const k = i * 4 + j;
      near.push([[-17.8 + i * 0.6 + jitter[k % 12], -1.9 + j * 0.55 + jitter[(k + 5) % 12], -40.5], 1.2 - k * 0.012]);
    }
  }
  const far: (readonly [Point, number])[] = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 5; j++) {
      const k = i * 5 + j;
      far.push([[-91, 8.2 + j * 0.5 + jitter[k % 12], -21.6 + i * 0.5 + jitter[(k + 7) % 12]], 1.2 - k * 0.012]);
    }
  }
  return [
    {
      id: "fx-tracer",
      of: "three rounds crossing in front of the quay's harbour wall from either side, their tracers in flight",
      proves:
        "TRACERS IN FLIGHT (`CombatFx`, X4.4b): the emissive streak stretched along its flight — a non-uniform scale — at three points of it, flown by `CombatFx.update` off `drawRounds`",
      pos: harbour,
      target: [-16, 0, -38],
      fx: {
        seconds: 0.2,
        events: [
          { at: 0.2 - 2 * S, round: { from: [-26, 3, -46], to: [-10, -0.5, -40.5] } },
          { at: 0.2 - S, round: { from: [-26, 3.5, -46], to: [-8, 0, -40.5] } },
          { at: 0.2 - 3 * S, round: { from: [-6, 3.2, -46], to: [-22, -1, -40.5] } },
        ],
      },
    },
    {
      id: "fx-impact-hard",
      of: "rounds landing on the quay's stone deck from the promenade, seen from above, the impacts at five ages",
      proves:
        "a HARD impact mid-fade (`CombatFx`, X4.4b): the spark and the dust disc at several `visibility`s under 1 — the BLENDED pipeline beside the opaque one — and the chips they leave (`BulletMarks`)",
      pos: quay,
      target: [-29.5, 0, -38],
      fov: 25,
      fx: {
        seconds: 0.5,
        events: rounds(0.5, [-36, 1.6, -33], [
          [[-31, 0, -37.4], 0.04],
          [[-29.6, 0, -38.6], 0.09],
          [[-28.2, 0, -37.6], 0.14],
          [[-30.4, 0, -38.9], 0.19],
          [[-27.8, 0, -38.8], 0.3],
        ]),
      },
    },
    {
      id: "fx-impact-ground",
      of: "rounds landing on the road beside the promenade (the floor, `ground`), seen from above, at five ages",
      proves:
        "a GROUND impact mid-fade (`CombatFx`, X4.4b): no spark, the brown dust disc opening and fading under 1 (blended), and the divots (`BulletMarks`) in the ground's own colour",
      pos: quay,
      target: [-29.5, 0, -30],
      fov: 25,
      fx: {
        seconds: 0.5,
        events: rounds(0.5, [-36, 1.6, -26], [
          [[-31, 0, -29.3], 0.04],
          [[-29.4, 0, -30.2], 0.09],
          [[-28, 0, -29], 0.14],
          [[-30.4, 0, -30.6], 0.19],
          [[-28.4, 0, -30.8], 0.3],
        ]),
      },
    },
    {
      id: "fx-marks-near",
      of: "a wall of bullet marks on the quay's harbour face, close, the rounds that made them long gone",
      proves:
        "the MARK pool near (`BulletMarks`, X4.4b): cel decals on their own depth bias (`MARK_DEPTH_UNITS`), each its own roll and size, standing on the static world after the spark and the dust have gone",
      pos: harbour,
      target: [-16, -1, -40.16],
      fov: 30,
      fx: { seconds: 1.2, events: rounds(1.2, [-16, 4.6, -46], near) },
    },
    {
      id: "fx-marks-far",
      of: "a wall of bullet marks on the west face of a brick block 58 m down the avenue, through a 47° field",
      proves:
        "the marks at the SIZE GATE's edge (`WorldCulling`'s `minPixels`, which X4.4b replaces with a size test of its own): about half of them project under 3 px and are not drawn, the rest a few pixels across",
      pos: avenue,
      target: [-91, 9.2, -19.9],
      fov: 47,
      fx: { seconds: 1.2, events: rounds(1.2, [-150, 13, -26], far) },
    },
    {
      id: "fx-grenade",
      of: "a frag at rest on the quay's deck, a second in flight over it, and a bottle in flight beside that",
      proves:
        "the THROWN bodies (`GrenadeFx`'s `GrenadeBody`, X4.4b): the frag's cel body and its emissive fuse pip, lit in flight and at rest, and the bottle with its lit wick — tumbled by `GrenadeFx.update` off `GrenadeSystem.throwAt`",
      pos: quay,
      target: [-29, 0.3, -37.8],
      fov: 25,
      fx: {
        seconds: 1.6,
        events: [
          { at: 0, throw: { from: [-36, 1.2, -38], to: [-31, 0.1, -38], kind: "frag" } },
          { at: 1.3, throw: { from: [-24, 1.5, -31], to: [-29, 0.1, -38.5], kind: "frag" } },
          { at: 1.4, throw: { from: [-23.5, 1.2, -35], to: [-33, 0.1, -39], kind: "molotov" } },
        ],
      },
    },
    {
      id: "fx-rocket",
      of: "a rocket a quarter of a second out of the tube, crossing the promenade toward the harbour",
      proves:
        "the ROCKET body (`AntiTankFx`'s `RocketBody`, X4.4b): cel, pointed down its flight, with its emissive motor guttering off the distance flown",
      pos: quay,
      target: [-28, 1.2, -36],
      fov: 35,
      fx: { seconds: 0.25, events: [{ at: 0, rocket: { from: [-28, 1.4, -24], to: [-28, 1.2, -48] } }] },
    },
    {
      id: "fx-mine",
      of: "two mines laid on the quay's deck, one armed and one still arming",
      proves:
        "the MINE body (`MineBody`, X4.4b): the cel plate, and its fuze lamp lit on the armed one and dark on the other — put down as the wire lays one (`NetOrdnance.applyMines`), the only way a mine is drawn in a round",
      pos: quay,
      target: [-30, 0, -37.8],
      fov: 18,
      fx: {
        seconds: 0,
        events: [],
        mines: [
          { at: [-31, 0, -37.6], armed: true },
          { at: [-29, 0, -38.2], armed: false },
        ],
      },
    },
    {
      id: "fx-brass",
      of: "the rifle at the hip on the square, firing: brass in the air off the ejection port, the flash on the muzzle",
      proves:
        "the BRASS (`PlayerView`'s casing pool, X4.4b): cel cases thrown into the world off the ejection port as the render cache answers it (the row renders one frame with its pose up first), tumbling at several points of their arc",
      pos: square,
      target: [-16, 0.5, -40],
      view: { weapon: "rifle", sight: "iron", aimed: false },
      fx: { seconds: 0.38, events: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35].map((at) => ({ at, brass: true as const })) },
    },
    blast(
      "fireball",
      "hard",
      0.08,
      "a frag's blast on the quay's stone deck 0.08 s after it went off: the flash and the fireball",
      "the BLAST at its first age on HARD (`BlastFx`/`BlastShader`, X4.4c): the flash and the fireball's lobes at their hottest, the sparks leaving, the chunks born (`BlastDebrisSystem`) and the scorch laid at full",
    ),
    blast(
      "billows",
      "hard",
      0.6,
      "the same blast at 0.6 s: the billows cooling, the streamers out and the surge rolled over the deck",
      "the BLAST's billows on HARD (X4.4c): the lit billows hot and cooling, the burning fragments' trails, the surge flat to the deck, and the rubble — fewer, bigger, paler pieces — in the air",
    ),
    blast(
      "smoke",
      "hard",
      1.8,
      "the same blast at 1.8 s: the column of smoke dissolving, the rubble down",
      "the BLAST's late smoke on HARD (X4.4c): the column's dissolve, and the rubble at rest on the deck beside its scorch",
    ),
    blast(
      "fireball",
      "ground",
      0.08,
      "a frag's blast on the floor at the road's edge by the promenade (`ground`) 0.08 s after it went off",
      "the BLAST at its first age on GROUND (X4.4c): the flash and the fireball, and the ground's own rubble born. Its scorch is laid at full (`ScorchMarks.mark`) and drawn, but the book stall and the fireball stand between this eye and the mark, so only a sliver of it reaches the frame (measured with the mark hidden and shown) — a whole scorch on the floor is `fx-molotov`'s",
    ),
    blast(
      "billows",
      "ground",
      0.6,
      "the same blast at 0.6 s, its dust the map's floor colour",
      "the BLAST's billows on GROUND (X4.4c): the surge's dust in the floor's colour, and the ground's rubble — more, smaller, earth-coloured pieces — in the air",
    ),
    blast(
      "smoke",
      "ground",
      1.8,
      "the same blast at 1.8 s: the column dissolving, the rubble down",
      "the BLAST's late smoke on GROUND (X4.4c): the column's dissolve, and the earth rubble at rest",
    ),
    {
      id: "fx-scorch",
      of: "two molotovs' scorch marks on the quay's deck, the fires long out: one 9 s old at full (right), one 11.5 s old and fading (left)",
      proves:
        "the SCORCH (`ScorchMarks`, a `StandardMaterial` decal, X4.4c): black, alpha-blended, no depth write, on its polygon offset, at full opacity and part-way down its fade (`visibility`)",
      pos: quay,
      target: [-29.5, 0, -37.8],
      fov: 32,
      fx: { seconds: 11.5, events: [{ at: 0, blaze: { at: [-31.5, 0, -37.8] } }, { at: 2.5, blaze: { at: [-26.5, 0, -37.8] } }] },
    },
    {
      id: "fx-molotov",
      of: "a molotov burning on the promenade 1.5 s after it went up, its ignition's smoke rising",
      proves:
        "the molotov's FLAMES (`GrenadeFx`'s flames, our renderer's since X4.4d: `FlameDraw` on `FlameMaterial`'s values) at full height, each stood on its own floor, with the ignition's billows (`BlastFx`), its light, and its scorch on the FLOOR (`ScorchMarks`, X4.4c) — drawn whole under the flames and faint, as it is meant to be: a black decal at 0.4 is a proportional darkening, and the floor under it is fire-lit (measured with the mark hidden and shown: the whole disc moves)",
      pos: quay,
      target: [-30, 0.8, -31],
      fov: 35,
      fx: { seconds: 1.5, events: [{ at: 0, blaze: { at: [-30, 0.02, -31] } }] },
    },
    {
      id: "fx-shards",
      of: "a shopfront's pane on the square bursting outward, its shards falling 0.3 s after",
      proves:
        "the SHARD POOL (`DebrisSystem`, X4.4c) and NOT a real break's picture: cel slivers cut from pane 0 and posed off Havok's step (`poseView`), falling — in front of a sheet left STANDING, a state the game never draws (a real break takes the glazing out through `GlassFx`: `fx-glass-broken`)",
      pos: square,
      target: [-23.8, 2, -7.5],
      fx: { seconds: 0.3, events: [{ at: 0, shards: { pane: 0, at: [-23.8, 2, -6], dir: [1, -0.1, 0] } }] },
    },
    {
      id: "fx-glass",
      of: "the same shopfront: rounds through its window into the shop's side wall, and two on the pier beside it, the impacts mid-fade",
      proves:
        "a FADING effect seen THROUGH see-through glazing (X4.4b's sort question): sparks and discs under 1 behind the pane and in front of it, blended against the glazing's own blend",
      pos: square,
      target: [-23.8, 2, -6.65],
      fx: {
        seconds: 0.5,
        events: rounds(0.5, [-17, 2, -11], [
          [[-27, 2, -4.2], 0.09],
          [[-26.5, 1.4, -4.2], 0.14],
          [[-23.6, 1.75, -8.79], 0.04],
          [[-23.91, 1.47, -9.3], 0.1],
        ]),
      },
    },
    // Appended by X4.4a's post-commit review, after every row above.
    blast(
      "power2-billows",
      "hard",
      0.6,
      "a blast of power 2 (a mine's) on the quay's stone deck at 0.6 s, from the same eye as the frag's",
      "the BLAST at a POWER other than 1 (X4.4c): `power` scales the billows' size and count, the rubble and the scorch, never the time — beside `fx-blast-hard-billows`, the same age at power 1",
      2,
    ),
    {
      id: "fx-wire",
      of: "somebody else's rocket crossing the promenade, and their frag and bottle in flight over the quay's deck, drawn off the wire",
      proves:
        "the WIRE's flying bodies (`NetOrdnance`'s and `NetGrenades`' pools, X4.4b): the same `RocketBody` and `GrenadeBody` kits fed two snapshots and posed at a render time between them — the rocket pointed down the direction the wire sent, its motor at its built size (the wire's rocket never gutters: `NetOrdnance.update` calls no `flicker`), the frag's pip off the wire's fuse, the bottle's wick lit, both tumbled off the ground covered between two poses",
      pos: quay,
      target: [-29, 1.2, -33],
      fov: 30,
      fx: {
        seconds: 0,
        events: [],
        wire: {
          snapshots: [
            {
              now: 100000,
              rockets: [{ i: 3, p: [-28, 1.35, -29], dir: [0, -0.02, -1] }],
              grenades: [
                { i: 7, p: [-31, 1.6, -33], fuse: 2 },
                { i: 8, p: [-26.5, 1.4, -35.5], fuse: 3, k: "molotov" },
              ],
            },
            {
              now: 100050,
              rockets: [{ i: 3, p: [-28, 1.3, -32], dir: [0, -0.02, -1] }],
              grenades: [
                { i: 7, p: [-30.6, 1.5, -33.3], fuse: 1.95 },
                { i: 8, p: [-26.9, 1.3, -35.7], fuse: 2.95, k: "molotov" },
              ],
            },
          ],
          poses: [100020, 100030],
        },
      },
    },
    {
      id: "fx-impact-kinds",
      of: "rounds striking bodies and glass over the quay's deck: the flesh and the glass sparks, at two ages each, standing in the air where the body or the pane was",
      proves:
        "the two impact kinds with NO dust (`IMPACTS.flesh` and `.glass`, `CombatFx`, X4.4b): the warm flesh spark and the cold glass spark mid-fade (blended), handed over as `onRound` hands them (`drawRound`) — flesh is every round on a body; NO caller raises `glass` today (`CombatSystem` names flesh, `hard` or `ground`; a pane's break is a sound and shards), so its row is the table's colour and nothing the game draws",
      pos: quay,
      target: [-29.5, 1, -38],
      fov: 25,
      fx: {
        seconds: 0.3,
        events: [
          { at: 0.25, drawn: { from: [-36, 1.6, -33], to: [-31, 1.2, -37.6], kind: "flesh" } },
          { at: 0.2, drawn: { from: [-36, 1.6, -33], to: [-29.6, 1, -38.4], kind: "flesh" } },
          { at: 0.24, drawn: { from: [-36, 1.6, -33], to: [-28.2, 1.3, -37.8], kind: "glass" } },
          { at: 0.18, drawn: { from: [-36, 1.6, -33], to: [-30.3, 1.4, -38.8], kind: "glass" } },
        ],
      },
    },
    {
      id: "fx-glass-sort",
      of: "the square's west shopfront, pane 0: one impact on the shop's side wall seen squarely THROUGH the glass, and one standing squarely IN FRONT of it, both mid-fade",
      proves:
        "X4.4b's sort question with an unambiguous BEFORE: a `hard` spark and dust disc BEHIND pane 0 (a round through the window onto the shop's side wall, `drawRounds`, ~12.5 m from the eye) and a `hard` spark and disc IN FRONT of it (`drawRound`, as `onRound` hands a round stopped on a HULL: hard, no mark — no hull drawn, the impact standing 1.5 m short of the glass, ~7.2 m from the eye, its disc facing the eye), each projecting wholly onto the glass (projected in the X4.4a fix record). Nothing on this map stands in front of that glass for a round to strike: a pavement impact projects below the pane, and the piers beside it project onto its edge (`fx-glass`)",
      pos: square,
      target: [-23.8, 2, -6.65],
      fx: {
        seconds: 0.3,
        events: [
          { at: 0.2, round: { from: [-17, 2, -11], to: [-25.769, 3.051, -4.11] } },
          { at: 0.23, drawn: { from: [-17, 2, -11], to: [-22.24, 1.66, -8.48], kind: "hard", normal: [7.8, 0.8, -4.4] } },
        ],
      },
    },
    // Appended by the commit after X4.4b that took the pieces' stale-sphere
    // latch out (`docs/rendering.md`, "The pools, ours"), after every row above.
    {
      id: "fx-brass-far",
      of: "the rifle at the hip 12 m over the avenue's west end, ~152 m from the world origin, firing: brass in the air off the ejection port",
      proves:
        "the BRASS gated on THIS frame's sphere (`pieces.writePieceDrawing`): Babylon's gate read a case's never-computed sphere at the world ORIGIN, under 3 px from this eye, so until the fix no case was drawn here at all (`fx-brass` stands ~20 m from the origin, where that stale sphere still passed)",
      pos: avenue,
      target: [-100, 8, -26],
      view: { weapon: "rifle", sight: "iron", aimed: false },
      fx: { seconds: 0.38, events: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35].map((at) => ({ at, brass: true as const })) },
    },
  ];
}

/**
 * A world fire in the open, and fading effects in front of and behind it:
 * Cinderhaven's fire drum on the bay road, at night, through a 9° field from
 * `crossing`'s eye 40 m off (so, like `effectRows`, no new benchmark stop).
 * Coldharbour's only fires are a tavern's hearths and a chapel's candles,
 * indoors.
 */
function fireRows(): Vantage[] {
  const pos: Pos = [-150, 6, 262];
  const target: Point = [-121.1, 5.4, 239.5];
  return [
    {
      id: "fx-fire",
      of: "the fire drum on the bay road at night, by the careened boat, through a 9° field",
      proves:
        "a WORLD FIRE (`world/flame.ts` merged into its block on `FlameMaterial`, our renderer's since X4.4d: `FlameDraw`): the tongues, the core and the embers, drawn while its block's cell is offered, at the bank's pinned clock",
      pos,
      target,
      fov: 9,
    },
    {
      id: "fx-fire-fade",
      of: "the same drum with rounds landing on the boat's hull behind its flames and on the cobbles in front of it, mid-fade",
      proves:
        "FADING effects against a world fire (X4.4b's sort question): a spark and a disc under 1 behind the flames and dust discs in front of them, sorted against the fire's draw",
      pos,
      target,
      fov: 9,
      fx: {
        seconds: 0.5,
        events: [
          { at: 0.45, round: { from: [-128, 9.5, 246], to: [-115.21, 3.7, 234.92] } },
          { at: 0.4, round: { from: [-128, 9.5, 246], to: [-115.22, 4.1, 234.91] } },
          { at: 0.46, round: { from: [-130, 6.8, 248], to: [-123, 5.3, 241.3] } },
          { at: 0.38, round: { from: [-130, 6.8, 248], to: [-124.2, 5.6, 242.3] } },
        ],
      },
    },
  ];
}

function grassRows(): Vantage[] {
  const pos: Pos = [82, 6, 23];
  const target: Point = [72, 1.93, 12];
  const row = (grass: "low" | "medium" | "high", density: number, near: number): Vantage => ({
    id: `grass-${grass}`,
    of: `\`crossing\`'s frame at the ${grass} rung, mid-gust: the field round the cobbled path and the graves, the channel past the trunks`,
    proves: `the GRASS at \`CONFIG.grass.tiers.${grass}\` (X4.6c): ${density} blades a square metre inside ${near} m, the patch meshes that rung rebuilds (\`GrassSystem.buildLods\`), the turf under them, the blades' sway, and the mask's rejection of the road and the water`,
    pos,
    target,
    wind: 2.6,
    settings: { grass },
  });
  return [row("low", 28, 7), row("medium", 52, 9), row("high", 90, 11)];
}

/**
 * A laid mine and a rocket in flight ~300 m from the world origin, at
 * `fx-fire`'s eye on Cinderhaven (so no new benchmark stop) and at the game's
 * own hip field: far enough that the sphere Babylon's gate read for a part it
 * had never COMPUTED — its local sphere, at the origin — projects under the
 * gate's 3 px, so until the commit after X4.4b a mine's pressure plate (and
 * the whole of an unarmed mine) and a rocket's tail were never drawn here.
 * Both are now gated on the sphere they are drawn with (`docs/rendering.md`,
 * "The pools, ours"). A narrowed `fov` would defeat the row: it raises the
 * stale sphere over the gate as well.
 */
function farPieceRows(): Vantage[] {
  const pos: Pos = [-150, 6, 262];
  return [
    {
      id: "fx-mine-far",
      of: "two mines laid on the cobbles ~11 m below and ahead of the fire drum's eye, one armed and one still arming, ~300 m from the world origin",
      proves:
        "the MINE gated on THIS frame's sphere (`pieces.writePieceDrawing`): the armed mine's pressure plate and the whole of the arming one, each of which Babylon's gate measured at the world origin and dropped from this eye — laid as the wire lays them (`NetOrdnance.applyMines`)",
      pos,
      target: [-142.5, 8.4, 256.2],
      fx: {
        seconds: 0,
        events: [],
        mines: [
          { at: [-143, 8.448, 256.5], armed: true },
          { at: [-142.1, 8.402, 255.85], armed: false },
        ],
      },
    },
    {
      id: "fx-rocket-far",
      of: "a rocket a quarter of a second out of the tube crossing ~11 m in front of the fire drum's eye, ~300 m from the world origin",
      proves:
        "the ROCKET gated on THIS frame's sphere (`pieces.writePieceDrawing`): its tail (the boom and the fins), which hangs from the head and which Babylon's gate measured at the world origin and dropped from this eye, while the unlit motor refreshed only the head",
      pos,
      target: [-142.1, 10.5, 255.85],
      fx: { seconds: 0.25, events: [{ at: 0, rocket: { from: [-145.54, 10.6, 251.43], to: [-129.8, 10.3, 271.65] } }] },
    },
  ];
}

/**
 * A shopfront's pane south-west of the town square bursting ~42 m from
 * `town`'s eye on Cinderhaven (so no new benchmark stop), ~313 m from the
 * world origin, at the game's own hip field. Until the commit after X4.4c a
 * glass shard was size-gated on a sphere every cut rebuilt under the
 * IDENTITY — at the world ORIGIN — and never moved until the gate let it
 * through, so from this eye every piece whose radius is under ~0.41 m (the
 * gate's 3 px at ~313 m) was dropped for the whole burst: six of this pane's
 * twelve shards. Now every piece is gated on the sphere it is drawn with
 * (`poseView.writePosedDrawing`, `docs/rendering.md`, "The pools, ours"). A
 * narrowed `fov` would defeat the row: it raises the stale sphere over the
 * gate as well.
 */
function farShardRows(): Vantage[] {
  return [
    {
      id: "fx-shards-far",
      of: "a shopfront south-west of the town square, ~42 m off and ~313 m from the world origin, its pane bursting outward into the street, the shards 0.3 s out",
      proves:
        "the SHARDS gated on THIS frame's sphere (`poseView.writePosedDrawing`): the smaller half of a pane this far from the origin, which Babylon's gate measured from the eye to the world origin once a burst and dropped for good (X4.4c kept that latch; `fx-shards`' pane, ~25 m from the origin, is too near for it to bite) — in front of a sheet left STANDING, as `fx-shards` is",
      pos: [-90, 1.7, 300],
      target: [-124.55, 9.37, 276.98],
      fx: { seconds: 0.3, events: [{ at: 0, shards: { pane: 1, at: [-124.55, 9.37, 276.98], dir: [0.7, -0.1, -0.7] } }] },
    },
  ];
}
