/**
 * bench/vantages.ts — Where the reference frames are taken from, beyond the
 * one photograph each map already has, and where the benchmark stands to look
 * (`bench/BenchScript.ts`, `BABYLON_EXIT.md` X0.3).
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
 * a renderer being replaced piece by piece (`BABYLON_EXIT.md` X0.1) and a
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
 * - `view: { weapon, sight, aimed }` — the player's viewmodel, fitted and
 *   posed by `ViewModel.update` until it settles; aimed takes the optic's own
 *   field too.
 * - `zones: true` — the capture rings and their flags, which every other row
 *   hides. Built at the start of a round, so the flag is at the foot of its
 *   pole and the cloth at rest.
 * - `settings: { key: value }` — `Game.setSetting` for this row only, which is
 *   how a post setting is photographed OFF beside the row that has it on.
 * - `turn` — radians: the motion blur held mid-turn rather than at rest (see
 *   `freeze`), since a still camera leaves the pass inert.
 *
 * Positions read like `pos`: `[x, z]` on the floor as drawn.
 */

/** A pose: `[x, metres ABOVE THE SURFACE, z]` to look at an absolute point. */
type Pos = readonly [x: number, above: number, z: number];
type Point = readonly [x: number, y: number, z: number];

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
  view?: { weapon: string; sight: string; aimed: boolean };
  zones?: boolean;
  settings?: Readonly<Record<string, string | boolean | number>>;
  turn?: number;
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
        "a RIG (X4.1): fourteen merged meshes, the kit palette in `uv2.x`, the team colour worn, and its shadow in the bodies' map — the half of the cel shader no map view reaches",
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
  ],
};

/**
 * The viewmodel, hip and aimed, one weapon per optic: each optic on the
 * weapon it reads best on, so five weapon models are in the set as well as
 * five sights. Harrowmead's millpond is behind them because it is daylight
 * with water, foliage and a lit building in one direction.
 */
function viewRows(): Vantage[] {
  const fits: [sight: string, weapon: string][] = [
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
        : "the viewmodel's rendering group, its depth clear and its ink band, the weapon model and the sight (X4.3)",
      pos: [-160, 1.6, 102],
      target: [-108, 3, 70],
      view: { weapon, sight, aimed },
    })),
  );
}
