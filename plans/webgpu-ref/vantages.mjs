/**
 * Where the reference frames are taken from, beyond the one photograph each
 * map already has.
 *
 * **The menu's vantage is the menu's and is NOT stated here.** It is read at
 * runtime out of `src/ui/mapShots.ts` — the table the backdrop itself stands
 * on — so a reference frame and a menu backdrop cannot come to hold two ideas
 * of where the camera stands, and a re-frame stays an edit in one place. What
 * is below is the SECOND table, and the reason there are two is that the two
 * are chosen against different questions: a backdrop is picked to look like
 * the map, and a diff vantage is picked to put a SHADER PATH in frame. Nothing
 * in the game wants these poses, which is why they live beside the harness
 * rather than in `src/`.
 *
 * **Each row names what it proves, and that field is the whole point of the
 * row.** A reference set is only a defence against `plans/webgpu_migration.md`
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
 */

/**
 * The diff vantages, keyed by map id, in the order they are banked.
 *
 * A map with no entry here is not an error — it banks its menu vantage alone,
 * exactly as a map with no row in `mapShots.ts` is skipped rather than broken.
 */
export const DIFF_VANTAGES = {
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
      of: "the farmstead barn's west gable, square on down the east road, at 40 m",
      proves:
        "the dither, which is the one thing in the shader whose failure is a BAND rather than a colour — a flat lit surface far enough away for the ramp to quantise",
      pos: [28, 1.7, 30],
      target: [68, 5, 30],
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
    {
      id: "curtain2",
      of: "the north tower's curtain wall at 2 m, square on and level with the glazing",
      proves:
        "CEL_GLASS_BACKED at the range where the composite IS the picture — the arithmetic standing in for the mass behind the sheet, and the depth write that pays for it",
      pos: [0, 5, 50],
      target: [0, 13, 62],
    },
    {
      id: "curtain40",
      of: "the same curtain wall from the middle of the civic square, 40 m out",
      proves:
        "the same pane with fog and the front-to-back opaque sort in front of it — the near half of the `GLASS_DEPTH_UNITS` question, which is a NUMBER taken by M7's own rig and a picture here",
      pos: [0, 8, 12],
      target: [0, 8, 65],
    },
    {
      id: "curtain90",
      of: "the same curtain wall from the south avenue kerb, 90 m out",
      proves:
        "that distant glazing is DRAWN AT ALL — the failure `GLASS_DEPTH_UNITS` exists for is a pane losing the depth test past ~100 m, which is a sheet that silently is not there rather than one that looks wrong",
      pos: [0, 8, -38],
      target: [0, 8, 65],
    },
    {
      id: "avenue",
      of: "the south avenue end to end, 320 m of street with the towers stepping away down both sides",
      proves:
        "the front-to-back opaque sort over the deepest sightline in the game, the fog on a map with no wall, and the shadow window at the far end of it",
      pos: [-150, 2, -40],
      target: [150, 10, -40],
    },
  ],
  harrowmead: [
    {
      id: "millpond",
      of: "the millpond from its west shore, the mill and its wheel on the far lip",
      proves:
        "the water on the map where it is a POND rather than a sheet over everything — a reflected mass with a shore round it, plus the water meadows' grass at the edge",
      pos: [-136, 1.6, 64],
      target: [-106, 3, 44],
    },
    {
      id: "borderland",
      of: "the south borderland from just inside the play square, the floor carrying on past it",
      proves:
        "the terrain and the fog with NO WALL and no rim in the way — the one vantage in the set where what is drawn at the far end is the map continuing rather than a boundary box",
      pos: [24, 6, -178],
      target: [10, 12, -260],
    },
  ],
};

/**
 * The full ordered shot list for a map: its menu vantage first, then its diff
 * vantages.
 *
 * The menu one leads because it is the only frame a human can check against
 * something — the committed backdrop is a photograph of it — so a bank whose
 * first frame is wrong is wrong in a way somebody can see without a differ.
 */
export function shotList(id, menuVantage) {
  const rows = [];
  if (menuVantage) {
    rows.push({
      id: "menu",
      of: "the committed menu backdrop's own vantage, read out of src/ui/mapShots.ts",
      proves: "the one frame that can be checked by eye against shots/<map>.jpg",
      ...menuVantage,
    });
  }
  return rows.concat(DIFF_VANTAGES[id] ?? []);
}
