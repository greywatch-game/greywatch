/**
 * editor/params.ts — Which BuildParams each builder actually reads, and what
 * it defaults to.
 * Owns: the descriptor table the inspector builds its controls from.
 *
 * This table has to be hand-maintained, and there is no way around it:
 * `BuildParams` (world/kit/core.ts) is deliberately ONE flat bag shared by
 * every builder — "builders ignore what they don't use" — so nothing at
 * runtime can say which fields `cottage` cares about and which it drops on the
 * floor. Showing all ten controls for every kind would be worse than useless:
 * most would do nothing, and there would be no way to tell which.
 *
 * **When you add a builder or teach an existing one a new param, add it here.**
 * The values below are read off the builders themselves; a default that drifts
 * shows the wrong number in the inspector but cannot corrupt a layout, because
 * a control the user never touches is never written.
 */
import type { BuilderKind } from "../world/BuildingKit";
import type { BuildParams } from "../world/kit/core";
import type { ScatterCircle, ScatterSpec } from "../world/layout";

/** One editable field. `step` is the drag/nudge granularity for numbers. */
export type ParamSpec =
  | { key: keyof BuildParams; type: "number"; label: string; def: number; min: number; max: number; step: number }
  | { key: keyof BuildParams; type: "boolean"; label: string; def: boolean }
  | {
      key: keyof BuildParams;
      type: "choice";
      label: string;
      def: string;
      options: string[];
      /**
       * The stored value is a number, not the option string. `rampSide` is
       * `-1 | 1`; writing "-1" into the layout would typecheck nowhere and
       * would reach the builder as a string.
       */
      numeric?: boolean;
    };

const num = (
  key: keyof BuildParams,
  label: string,
  def: number,
  min: number,
  max: number,
  step = 0.5,
): ParamSpec => ({ key, type: "number", label, def, min, max, step });

const bool = (key: keyof BuildParams, label: string, def = false): ParamSpec => ({
  key,
  type: "boolean",
  label,
  def,
});

/** Footprint triple shared by most enclosed buildings. */
const wdh = (w: number, d: number, h: number): ParamSpec[] => [
  num("width", "width", w, 2, 40),
  num("depth", "depth", d, 2, 40),
  num("height", "height", h, 1.5, 20),
];

/**
 * Every builder kind, mapped to the params it reads. An empty array means the
 * builder takes no params at all — it is placed as-is and only moved/rotated.
 */
export const PARAMS: Record<BuilderKind, ParamSpec[]> = {
  cottage: [
    ...wdh(7, 6, 3.4),
    bool("enterable", "enterable"),
    bool("ruined", "ruined"),
    bool("litWindows", "lit windows"),
  ],
  townhouse: [
    ...wdh(6.5, 6.5, 6.8),
    bool("enterable", "enterable"),
    bool("litWindows", "lit windows"),
  ],
  // Fixed footprint, for the reason buildJungleManor's header gives: the plan,
  // both stair runs, the stairwell void and the colonnade's bays are solved
  // against one another, so a width spinner would break three of them.
  manor: [bool("litWindows", "lit windows")],
  ruin: [num("width", "width", 10, 3, 40), num("depth", "depth", 8, 3, 40)],
  // Enterable by DEFAULT, unlike the cottage: a stilt hut's walls stand on a
  // platform that is already a walked surface, so the interior costs the nav
  // grid nothing extra and the doorway is what makes it worth approaching.
  stiltHut: [
    ...wdh(6.4, 5.2, 2.8),
    bool("enterable", "enterable", true),
    bool("ruined", "ruined"),
    bool("litWindows", "lit windows"),
  ],
  jungleRuin: [
    num("width", "width", 12, 5, 30),
    num("depth", "depth", 9, 4, 24),
    num("height", "height", 3.6, 2, 8, 0.2),
  ],
  gatehouse: [
    { key: "teamColor", type: "choice", label: "team", def: "#c9a15e", options: ["#c9a15e", "#ff3b3b"] },
  ],
  shed: wdh(3.4, 2.8, 2.6),
  fence: [num("length", "length", 10, 2, 60, 1)],
  stoneWall: [
    num("length", "length", 12, 2, 60, 1),
    num("height", "height", 1.5, 0.5, 4, 0.25),
  ],
  bridge: [
    num("length", "length", 12, 4, 40, 1),
    num("width", "width", 3.2, 1.5, 12, 0.2),
  ],
  // `length` is the WATER span. Each approach ramp adds another 6.9 m at the
  // shipped deck height, so the placed structure is ~14 m longer than this says.
  trestleBridge: [
    num("length", "length", 26, 8, 60, 1),
    num("width", "width", 3.2, 2, 8, 0.2),
  ],
  templeRuin: [
    num("width", "width", 26, 10, 48, 1),
    num("depth", "depth", 22, 8, 44, 1),
    bool("ruined", "ruined"),
  ],
  woodpile: [num("length", "length", 5, 1, 20, 0.5)],
  cart: [bool("ruined", "ruined")],
  terrace: [
    num("width", "width", 30, 4, 80, 1),
    num("depth", "depth", 26, 4, 80, 1),
    num("height", "height", 2, 0.5, 8, 0.25),
    // -1 / +1 rather than a number box: it names a face, not a distance.
    {
      key: "rampSide",
      type: "choice",
      label: "ramp side",
      def: "-1",
      options: ["-1", "1"],
      numeric: true,
    },
  ],
  ramp: [
    num("width", "width", 5, 1.5, 20),
    num("length", "length", 8, 2, 40, 1),
    num("height", "height", 1.5, 0.25, 8, 0.25),
  ],
  road: [
    num("width", "width", 8, 2, 20, 0.5),
    num("length", "length", 40, 4, 160, 1),
    { key: "surface", type: "choice", label: "surface", def: "cobble", options: ["cobble", "dirt", "asphalt"] },
  ],
  jetty: [num("length", "length", 18, 4, 60, 1)],
  boardwalk: [
    num("length", "length", 14, 4, 40, 1),
    num("width", "width", 2.4, 1.5, 6, 0.2),
    // A plain choice, NOT numeric: unlike rampSide the stored value genuinely
    // is the string the builder switches on.
    {
      key: "railSide",
      type: "choice",
      label: "rails",
      def: "both",
      options: ["both", "none", "-x", "+x"],
    },
  ],
  // NO length control, and that is the builder's design rather than an
  // oversight: a stair's run is its rise over a fixed grade, because a flight
  // steeper than MAX_WALKABLE_GRADE severs its own nav links and says nothing.
  // See buildStairs. `height` is the deck it has to reach.
  stairs: [
    num("height", "rise", 2.5, 0.6, 8, 0.25),
    num("width", "width", 2.4, 1.6, 6, 0.2),
    {
      key: "railSide",
      type: "choice",
      label: "rails",
      def: "both",
      options: ["both", "none", "-x", "+x"],
    },
  ],

  // --- the downtown set (world/kit/city.ts) --------------------------------
  // `floors` is a COUNT of walked levels rather than a height, for the reason
  // BuildParams gives: a storey's height is fixed by what a flight at
  // MAX_WALKABLE_GRADE can climb inside the footprint. The ceiling of 4 is not
  // arbitrary either — every level costs a NavGrid surface slot across the
  // whole footprint, and a map's `surfaces` is what pays for it.
  tower: [
    num("width", "width", 18, 6, 40),
    num("depth", "depth", 16, 6, 40),
    // The one place the height range is wide: this is the skyline.
    num("height", "height", 34, 6, 70, 1),
  ],
  office: [
    // Minimum 14 on the depth is the flight: a storey is 10.3 m of run, and a
    // building shallower than that has nowhere to put one.
    num("width", "width", 22, 14, 44),
    num("depth", "depth", 18, 14, 44),
    num("floors", "floors", 3, 2, 4, 1),
    bool("litWindows", "lit windows"),
  ],
  shophouse: [
    // The width floor is the stair lane plus a shopfront worth glazing; the
    // depth floor is `laneFlight`'s check, which throws in DEV below ~15.5 for
    // a three-storey unit. 16 is the shipped default and leaves 0.26 m of it.
    num("width", "width", 13, 10, 24),
    num("depth", "depth", 16, 16, 30),
    num("floors", "floors", 3, 2, 4, 1),
    bool("litWindows", "lit windows"),
    {
      key: "tint",
      type: "choice",
      label: "blind",
      def: "#7c4a3f",
      options: ["#7c4a3f", "#4a5a4a", "#5c5340", "#3f4b52", "#6b4a2f"],
    },
    {
      key: "sign",
      type: "choice",
      label: "sign",
      def: "#ff5f7a",
      options: [
        "#ff5f7a", "#4fd6ff", "#ffc63c", "#7dff9e",
        "#ff7a3c", "#c46cff", "#39e0d0", "#ff4f4f",
      ],
    },
  ],
  depot: [
    // The depth floor is the gallery plus the flight up to it — DEV throws
    // under about 15. Height is the eaves, not the ridge: the sawtooth stands
    // another 1.9 m over it.
    num("width", "width", 28, 16, 48),
    num("depth", "depth", 16, 15, 32),
    num("height", "height", 8, 6.5, 12, 0.5),
    bool("litWindows", "lit windows"),
  ],
  parkade: [
    num("width", "width", 32, 20, 56),
    num("depth", "depth", 24, 14, 48),
    num("floors", "floors", 3, 2, 4, 1),
  ],
  planter: [
    num("width", "width", 2.6, 1, 8, 0.2),
    num("depth", "depth", 1.4, 0.8, 6, 0.2),
  ],
  barrier: [num("length", "length", 6, 3, 40, 1)],
  streetLight: [num("height", "height", 7.5, 4, 12, 0.5), bool("lit", "lit")],
  monument: [num("width", "width", 11, 5, 20, 0.5)],
  car: [
    {
      key: "tint",
      type: "choice",
      label: "paint",
      def: "#3f4b52",
      // The five muted body colours the fleet is made of, then the six accents
      // — six of twenty-six on Coldharbour, kept a minority on purpose so they
      // read as accents rather than as a paint chart.
      options: [
        "#3f4b52", "#5d4a3a", "#4a4f45", "#6b463a", "#2f3338",
        "#a8352e", "#2f5f9c", "#c2762a", "#3f7d5a", "#8d3f7a", "#b8a63c",
      ],
    },
  ],

  // --- the desert-town set (world/kit/desert.ts) ---------------------------
  // The depth floors here are `assertClimbable`, which throws in a DEV build
  // rather than letting a layout ask for a stair the nav graph will decline to
  // link: a mud-brick storey is 10.0 m of run plus a 1.8 m landing inside the
  // walls, and a concrete one is 10.9. `floors` is a COUNT of walked levels for
  // the downtown set's reason, and every level costs a NavGrid surface slot
  // across the whole footprint.
  adobeHouse: [
    num("width", "width", 10, 6, 30),
    num("depth", "depth", 13, 13, 30),
    num("floors", "floors", 1, 1, 2, 1),
    bool("enterable", "enterable"),
    bool("ruined", "ruined"),
    // Which Z end the lowest flight's FOOT is at — and, because the builder
    // reads its PRESENCE rather than its value, the control that decides
    // whether the house has roof access at all.
    {
      key: "rampSide",
      type: "choice",
      label: "stair foot",
      def: "-1",
      options: ["-1", "1"],
      numeric: true,
    },
    {
      key: "tint",
      type: "choice",
      label: "render",
      def: "#8d7757",
      options: ["#8d7757", "#b6a68f", "#7b6a51", "#6d5b41"],
    },
  ],
  shellBlock: [
    num("width", "width", 20, 12, 40),
    num("depth", "depth", 15, 14, 34),
    num("floors", "floors", 3, 2, 4, 1),
    {
      key: "rampSide",
      type: "choice",
      label: "stair foot",
      def: "-1",
      options: ["-1", "1"],
      numeric: true,
    },
  ],
  souk: [
    num("length", "length", 30, 14, 60, 1),
    num("width", "width", 11, 8, 18),
    {
      key: "rampSide",
      type: "choice",
      label: "stair foot",
      def: "-1",
      options: ["-1", "1"],
      numeric: true,
    },
  ],
  mosque: [...wdh(26, 20, 7.4)],
  minaret: [num("height", "height", 26, 12, 40, 1)],
  // The wind tower reads `height` as the BARJEEL's rise above its own roof, not
  // as how tall the building is — it is a house plus a shaft, and the house's
  // height is `floors` like every other one here.
  windTower: [
    num("width", "width", 13, 9, 26),
    num("depth", "depth", 14, 13, 30),
    num("height", "tower", 6.4, 3, 11),
    num("floors", "floors", 1, 1, 2, 1),
    bool("enterable", "enterable"),
    {
      key: "rampSide",
      type: "choice",
      label: "stair foot",
      def: "-1",
      options: ["-1", "1"],
      numeric: true,
    },
    {
      key: "tint",
      type: "choice",
      label: "render",
      def: "#8d7757",
      options: ["#8d7757", "#b6a68f", "#7b6a51", "#6d5b41"],
    },
  ],
  // The two floors here are the DEV throw in the builder rather than
  // `assertClimbable`: the court has to hold a 10 m flight up to its own
  // terrace, and the ranges take 7.5 m off each side before the court starts.
  caravanserai: [
    num("width", "width", 44, 28, 70, 1),
    num("depth", "depth", 38, 32, 70, 1),
    {
      key: "tint",
      type: "choice",
      label: "render",
      def: "#8d7757",
      options: ["#8d7757", "#b6a68f", "#6d5b41"],
    },
  ],
  hammam: [
    num("width", "width", 18, 12, 30),
    num("depth", "depth", 14, 13, 26),
    {
      key: "rampSide",
      type: "choice",
      label: "stair foot",
      def: "-1",
      options: ["-1", "1"],
      numeric: true,
    },
    {
      key: "tint",
      type: "choice",
      label: "render",
      def: "#b6a98f",
      options: ["#b6a98f", "#8d7757", "#6d5b41"],
    },
  ],
  granary: [
    num("width", "width", 8, 4, 16),
    num("depth", "depth", 7, 4, 16),
    num("height", "height", 5.2, 2.5, 9),
    {
      key: "tint",
      type: "choice",
      label: "render",
      def: "#8d7757",
      options: ["#8d7757", "#b6a68f", "#6d5b41"],
    },
  ],
  compoundWall: [
    num("length", "length", 14, 4, 48, 1),
    num("height", "height", 2.6, 1.2, 4, 0.2),
    {
      key: "tint",
      type: "choice",
      label: "render",
      def: "#8d7757",
      options: ["#8d7757", "#b6a68f", "#6d5b41"],
    },
  ],
  blastWall: [
    num("length", "length", 12, 3, 60, 1),
    num("height", "height", 3.4, 2, 5, 0.2),
  ],
  sandbags: [
    num("length", "length", 6, 2, 24, 0.5),
    num("height", "height", 1.15, 0.6, 1.6, 0.05),
  ],
  // `length` is the SPAN to the next pole rather than this one's own extent —
  // see `buildPylon`, which carries the wire ahead of it. 0 ends a run.
  pylon: [
    num("length", "span", 0, 0, 90, 1),
    num("height", "height", 8.4, 5, 13, 0.2),
  ],

  // Fixed-geometry kinds: placed, rotated, and otherwise not configurable.
  tavern: [],
  smithy: [],
  watchtower: [],
  chapel: [],
  barn: [],
  silo: [],
  mill: [],
  boathouse: [],
  well: [],
  stall: [],
  haystack: [],
  lamp: [],
  crates: [],
  trough: [],
  shrine: [],
  kiln: [],
};

/** Kinds whose rotation should snap to the axis-aligned layout rule. */
export function isStructural(kind: BuilderKind): boolean {
  return (
    kind !== "cart" &&
    kind !== "crates" &&
    kind !== "woodpile" &&
    // A parked car is dressing, not architecture: it sits at whatever angle it
    // was left at, the same licence the cart has.
    kind !== "car"
  );
}

/**
 * Every builder kind, alphabetically — the add menu and the kind picker.
 *
 * Derived from PARAMS rather than listed again, so a builder added to
 * BuildingKit and to the table above cannot be missing from the menu.
 */
export const BUILDER_KINDS: readonly BuilderKind[] = (
  Object.keys(PARAMS) as BuilderKind[]
).sort();

/** The params one kind reads, as a set, for pruning after a kind change. */
export function paramKeys(kind: BuilderKind): Set<string> {
  return new Set(PARAMS[kind].map((s) => s.key as string));
}

type ScatterProp = ScatterSpec["prop"];

/**
 * What a fresh scatter region of each prop starts as. Circular: a disc is the
 * shape you can judge from a single click, and the shape control turns it into
 * a rectangle around the same footprint.
 */
type ScatterDefaults = Omit<ScatterCircle, "prop" | "x" | "z">;

/**
 * Starting values for a newly added scatter region, per prop.
 *
 * Read off the regions Hollowmere already uses rather than invented: a boulder
 * field wants 1.0 m of clearance and a gravestone 0.6, and a bramble patch is
 * non-blocking on purpose — you walk through brambles. Getting these wrong
 * would not corrupt anything, but every new region would need the same four
 * corrections by hand.
 *
 * A Record over the prop union, so a new scatter prop is a compile error here.
 */
export const SCATTER_DEFAULTS: Record<ScatterProp, ScatterDefaults> = {
  deadTree: { radius: 11, count: 10, scale: [0.8, 1.4], blocking: true, clearance: 0.55 },
  // Wider clearance than the dead tree and a tighter scale range: the crown is
  // 3.3 m across at scale 1, so the dead tree's 0.55 grows a stand of pines
  // into one solid green mass.
  pine: { radius: 12, count: 9, scale: [0.9, 1.3], blocking: true, clearance: 1.2 },
  // Wider again than the pine, because the crown is: 6.8 m across at scale 1
  // against the pine's 3.3. At 2.0 the trunks stand 5.2 m apart (the rejection
  // adds its own 1.2 m to the pair of clearances), which is where the crowns
  // overlap by a metre and a half — a hedgerow line rather than a row of
  // lollipops, and still open enough to walk and shoot between. The scale
  // range is narrow and its floor is 0.8 for a reason worth knowing about:
  // the skirt's lowest leaf hangs at `3.9 * scale`, so a region dragged under
  // ~0.45 puts foliage into the 1.7 m hit sphere the collider does not cover.
  ashTree: { radius: 14, count: 7, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  // Wider again: the canopy reaches ~4.4 m at scale 1, and a clearance of 2.2
  // puts the trunks 5.6 m apart, where the frond tips interlock and the trunks
  // are still a stand you can walk and shoot between. Tighter and it merges
  // into one green ceiling with no reason to be a scatter field at all.
  //
  // **The scale floor is 0.85 and it is a CONTRACT, not a taste.** Some of
  // these trees carry the belt's mid-story, and a liana veil's hem lands at
  // `(9.75 - drop) * scale` — so the 2.4 m the whole design rests on survives
  // only above that floor. A region dragged lower in the editor hangs vines
  // through the hit sphere and nothing throws. See `buildLianaVeil`.
  // Forest density rather than belt density: `clearance` 0.95 is what puts
  // trunks 3 m apart, and a count of 60 over a 18 m disc is roughly what
  // Greyfen's deep forest runs at. Both were 2.2 and 22 when a tree region was
  // a belt of columns — see that map's layout for why they moved.
  jungleTree: { radius: 18, count: 60, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // The understory. A fern is NON-BLOCKING for the same reason a bramble is,
  // and here it is load-bearing rather than incidental: a canopy belt's whole
  // promise is that the foliage starts nine metres up and the sight lines under
  // it stay open, and a bullet-stopping box at chest height in every gap
  // between the trunks would take that back. Dense count, because you walk
  // through them.
  fernClump: { radius: 12, count: 20, scale: [0.8, 1.4] },
  // Against the temperate log's 1.4, for a trunk nearly twice as long.
  buttressLog: { radius: 14, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  carvedStele: { radius: 9, count: 5, scale: [0.85, 1.25], blocking: true, clearance: 0.7 },
  gravestone: { radius: 5, count: 8, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  log: { radius: 12, count: 5, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  fungus: { radius: 14, count: 5, scale: [0.8, 1.4] },
  rubble: { radius: 8, count: 4, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  fireDrum: { radius: 2, count: 1, blocking: true, clearance: 0.6 },
  boulder: { radius: 10, count: 5, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  bramble: { radius: 12, count: 7, scale: [0.8, 1.4] },
  barrel: { radius: 6, count: 3, blocking: true, clearance: 0.55 },
  // The city's, and the two halves of it want opposite defaults.
  //
  // The three that carry a body are SPARSE and generously spaced: they are
  // cover, every one costs a solid mesh against the map's collider budget, and
  // a heap of them in a back lot is a wall nobody meant to build. Clearance is
  // the prop's own footprint plus room to walk between two of them.
  skip: { radius: 6, count: 2, scale: [0.9, 1.1], blocking: true, clearance: 2.4 },
  binPair: { radius: 5, count: 3, scale: [0.9, 1.15], blocking: true, clearance: 1.4 },
  palletStack: { radius: 5, count: 2, scale: [0.9, 1.2], blocking: true, clearance: 1.6 },
  // The two that carry nothing are DENSE, and can be, because a non-blocking
  // prop emits no collider and costs no ray anything. These are what close a
  // twelve-fold dressing gap that the ray budget could never have bought in
  // cover — see coldharbour/layout.ts.
  trafficCone: { radius: 5, count: 6, scale: [0.9, 1.1], clearance: 1.1 },
  litter: { radius: 9, count: 14, scale: [0.8, 1.3], clearance: 1.2 },
  // The desert's. Clearance is set from the CROWN and not from the bole, the
  // ash's rule: fronds reach ~4.0 m from the axis at scale 1, so 2.6 puts two
  // boles 6.4 m apart, where the crowns just touch. A grove tighter than that
  // is one green ceiling, which is the one thing a palm grove must not be —
  // the whole point of it is that you can see through it at head height and
  // not from above. Count is low for the same reason: a grove is a screen you
  // walk in among, not a wood.
  palm: { radius: 14, count: 8, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
};

export const SCATTER_PROPS = Object.keys(SCATTER_DEFAULTS).sort() as ScatterProp[];
