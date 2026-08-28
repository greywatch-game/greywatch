/**
 * generate-proving-ground.mjs — writes the PROVING GROUND, the dev-only map
 * `ENGINE_UPGRADE.md` S0 exists to measure against.
 *
 * Run with `npm run proving -- [--play 900] [--margin 300]`. Committed output,
 * like `heights.ts` and the collision bakes: it is generated so that the map is
 * REPRODUCIBLE rather than authored, and regenerating it with the same
 * arguments must produce the same bytes.
 *
 * **It is not a level and it must never become one.** `ENGINE_UPGRADE.md` says
 * the desert city is S11 and deliberately last, because authoring content
 * against an engine that cannot hold it is how you end up unable to tell a
 * layout problem from an engine one. What this is instead is a REPRESENTATIVE
 * load: a city block grid at roughly Coldharbour's collider density (768 boxes
 * over 320 m, or 0.0075 per square metre) carried out to a play square several
 * times the size, so that the six things under `src/world/` that scale with map
 * AREA are asked the question at the scale the ask is about.
 *
 * **The two variants are the decision, and the script takes them as arguments
 * because that is what S0 has to settle.** `MapLayout.size` is the PLAY square
 * and `Borderland.margin` is ground that costs terrain and nothing else, so
 * 1500 m of ground is far cheaper than 1500 m of play. `--play 1500 --margin 0`
 * and `--play 900 --margin 300` are both 1500 m of ground across; what differs
 * is everything priced on the square — the nav grid, the flow fields, the cover
 * masks, the obstacle field, and every structure on the map. Only ONE variant
 * lives in the tree at a time; the committed one is whichever the measurement
 * chose, and the other is one command away.
 *
 * ## What it lays down, and why each part is shaped the way it is
 *
 * - **A block grid on an 80 m pitch**, avenues 16 m wide between 64 m block
 *   cores, exactly Coldharbour's street geometry. Roads stop 10 m short of the
 *   boundary at each end: a road whose ground is not level is re-cut against
 *   the heightfield and loses its lane markings, and on a rim-closed map the
 *   last 8 m to the boundary is the skirt (see the heightfield below).
 * - **Eight block recipes, cycled by a stable hash of the block's own indices**
 *   so the mix does not move when the grid grows — a block at (3, 4) gets the
 *   same recipe whatever the play square is, which is what makes the two
 *   variants the same city at two extents rather than merely both large.
 * - **Five control points and both home spawns stand on EMPTY blocks.** A flag
 *   inside a collider cannot be captured (`surfaceAt` returns -1) and sinks its
 *   own flow field, so the blocks they land on emit no placements at all.
 * - **One scatter region per built block**, cycled the same way, three of the
 *   five props blocking. Blocking scatter is what `MapBuilder.clusterColliders`
 *   merges by locality, and a map with none of it would not exercise that pass.
 *
 * ## The heightfield, and why it is nearly level
 *
 * `terrain.size * terrain.cell` must equal the play square, and the cell is 4 m
 * — Coldharbour's, and the coarsest the grid may be (see `MapLayout.size`,
 * which says the grid grows with the square rather than getting coarser).
 *
 * The floor is LEVEL under the built area for the reason Coldharbour's is: a
 * placement's height is sampled once at its own centre, so a tower on a grade
 * floats at one corner and buries itself at the other. What relief there is
 * depends on how the map is closed, and the two cases are opposites:
 *
 * - **Closed by the rim** (`--margin 0`): a 1.2 m skirt over the last 8 m,
 *   which tucks the ground into the escarpment's foot instead of meeting it at
 *   a right angle. Its gradient is 0.15 against `MAX_WALKABLE_GRADE`'s 0.4, so
 *   it can sever no link.
 * - **Open** (`--margin > 0`): dead flat to the edge, because `TerrainField`
 *   continues the field's own outer ring into the borderland and rolls it. A
 *   skirt here would be a 1.2 m step in the middle of open country.
 *
 * ## What it deliberately does NOT carry
 *
 * No water, no grass, no vehicles and no lamps. Each would measure a system
 * that is not one of the four walls, and the point of a proving ground is that
 * a number taken off it is attributable. Armour at 1500 m is S10's question.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "src", "world", "proving");

// --- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : fallback;
};

/** The PLAY square: everything priced on area is priced on this. */
const PLAY = arg("play", 900);
/** Ground past the play square. Costs terrain and nothing else. */
const MARGIN = arg("margin", 300);

/** Metres per heightfield cell. Coldharbour's, and the coarsest allowed. */
const CELL = 4;
/** Street pitch: 64 m of block core plus a 16 m avenue. */
const PITCH = 80;
const AVENUE = 16;

if (!Number.isInteger(PLAY / CELL)) {
  throw new Error(`--play ${PLAY} is not a whole number of ${CELL} m cells`);
}
if (PLAY < PITCH * 4) throw new Error(`--play ${PLAY} is too small to grid`);

// --- the seeded stream -------------------------------------------------------

/**
 * A stable 32-bit hash of two block indices. Deliberately NOT a stream: a
 * running generator would reroll every block when the grid grew, and the two
 * variants have to be the same city at two extents for their numbers to be
 * comparable at all.
 */
function hash2(i, j) {
  let h = (Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 0..1 from a hash and a salt, so one block can draw several numbers. */
const unit = (i, j, salt) => hash2(i * 73 + salt, j * 31 + salt) / 0x100000000;

// --- the grid ----------------------------------------------------------------

/** Blocks across the play square. */
const N = Math.floor(PLAY / PITCH);
const CENTRE = (k) => (k + 0.5 - N / 2) * PITCH;

/** Which blocks carry an objective or a home spawn, and so stay empty. */
const ci = Math.floor(N / 2);
const off = Math.max(2, Math.round(N / 4));
const FLAG_BLOCKS = [
  ["C", ci, ci],
  ["A", ci - off, ci + off],
  ["B", ci - off, ci - off],
  ["D", ci + off, ci + off],
  ["E", ci + off, ci - off],
];
const HOME_BLOCKS = [
  [0, 0, 0],
  [1, N - 1, N - 1],
];
const empty = new Set([
  ...FLAG_BLOCKS.map(([, i, j]) => `${i},${j}`),
  ...HOME_BLOCKS.map(([, i, j]) => `${i},${j}`),
]);

/**
 * The eight recipes, as quadrant slots inside a block's 64 m core. Quadrant
 * centres are at (+/-16, +/-16) from the block centre, which is what keeps
 * every footprint clear of the avenue and of its neighbours.
 *
 * The figure beside each is the DECLARED collider count from `kit/city.ts`'s
 * header — tower 3, office ~50, shophouse ~42, depot ~35, parkade ~35 — and is
 * what the density target above was struck against. It is a nominal: what the
 * map actually bakes is `GameMap.colliderBoxes.length`, and that is the number
 * to quote.
 */
const Q = [
  [-16, -16],
  [16, -16],
  [-16, 16],
  [16, 16],
];
const RECIPES = [
  // 0 — four towers. The stock the skyline is made of. ~12 boxes.
  [
    { k: "tower", q: 0 },
    { k: "tower", q: 1 },
    { k: "tower", q: 2 },
    { k: "tower", q: 3 },
  ],
  // 1 — an office and two towers. ~56.
  [
    { k: "office", q: 0 },
    { k: "tower", q: 1 },
    { k: "tower", q: 3 },
  ],
  // 2 — a terrace pair and two towers. ~90.
  [
    { k: "shophouse", q: 0 },
    { k: "shophouse", q: 1 },
    { k: "tower", q: 2 },
    { k: "tower", q: 3 },
  ],
  // 3 — a depot and three towers. ~44.
  [
    { k: "depot", q: 0 },
    { k: "tower", q: 1 },
    { k: "tower", q: 2 },
    { k: "tower", q: 3 },
  ],
  // 4 — a parkade and two towers. ~41.
  [
    { k: "parkade", q: 0 },
    { k: "tower", q: 2 },
    { k: "tower", q: 3 },
  ],
  // 5 — the dense one: an office, a shophouse and a tower. ~95.
  [
    { k: "office", q: 0 },
    { k: "shophouse", q: 1 },
    { k: "tower", q: 3 },
  ],
  // 6 — the sparse one, so a street has somewhere to see across. ~9.
  [
    { k: "tower", q: 0 },
    { k: "tower", q: 1 },
    { k: "tower", q: 3 },
  ],
  // 7 — a shophouse, a depot and a tower. ~80.
  [
    { k: "shophouse", q: 0 },
    { k: "depot", q: 2 },
    { k: "tower", q: 3 },
  ],
];

/** Footprints that fit a 32 m quadrant with a metre to spare on every side. */
const FOOTPRINT = {
  tower: { width: 26, depth: 26 },
  office: { width: 22, depth: 18, floors: 3 },
  shophouse: { width: 13, depth: 16, floors: 3 },
  depot: { width: 28, depth: 16 },
  parkade: { width: 30, depth: 22, floors: 3 },
};

/** Nominal declared boxes per kind, from `kit/city.ts`'s header. */
const NOMINAL = { tower: 3, office: 50, shophouse: 42, depot: 35, parkade: 35 };

/** Scatter props, cycled per block. Three of the five carry a collider. */
const SCATTER = [
  { prop: "litter", blocking: false, clearance: 1.2 },
  { prop: "trafficCone", blocking: false, clearance: 1.2 },
  { prop: "binPair", blocking: true, clearance: 2.4 },
  { prop: "palletStack", blocking: true, clearance: 2.4 },
  { prop: "skip", blocking: true, clearance: 3.4 },
];

// --- the layout --------------------------------------------------------------

/** Shortest exact decimal for a number the layout states. */
const n2 = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));

const placements = [];

// The avenues, one slab per centreline each way. Visual only. They stop 10 m
// short of the boundary at each end for the reason Coldharbour's do.
const ROAD_LEN = PLAY - 20;
for (let k = 0; k <= N; k++) {
  const c = (k - N / 2) * PITCH;
  placements.push(
    `  { kind: "road", x: ${n2(c)}, z: 0, params: { surface: "asphalt", width: ${AVENUE}, length: ${ROAD_LEN} } },`,
  );
  placements.push(
    `  { kind: "road", x: 0, z: ${n2(c)}, rotY: Math.PI / 2, params: { surface: "asphalt", width: ${AVENUE}, length: ${ROAD_LEN} } },`,
  );
}

const scatter = [];
let nominalBoxes = 4; // the rim's four boundary boxes

for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    if (empty.has(`${i},${j}`)) continue;
    const bx = CENTRE(i);
    const bz = CENTRE(j);
    const recipe = RECIPES[hash2(i, j) % RECIPES.length];
    for (const slot of recipe) {
      const [qx, qz] = Q[slot.q];
      const params = { ...FOOTPRINT[slot.k] };
      if (slot.k === "tower") {
        // Uneven on purpose: a block face of one height reads as one building
        // repeated, and `buildTower` derives its brick/glass split from height
        // alone, so the variety costs the layout nothing to state.
        params.height = 14 + Math.round(unit(i, j, slot.q) * 36);
      }
      const rot = unit(i, j, slot.q + 11) < 0.5 ? "" : ", rotY: Math.PI / 2";
      const ps = Object.entries(params)
        .map(([key, v]) => `${key}: ${n2(v)}`)
        .join(", ");
      placements.push(
        `  { kind: "${slot.k}", x: ${n2(bx + qx)}, z: ${n2(bz + qz)}${rot}, params: { ${ps} } },`,
      );
      nominalBoxes += NOMINAL[slot.k];
    }
    const s = SCATTER[hash2(i + 7, j + 13) % SCATTER.length];
    scatter.push(
      `  { prop: "${s.prop}", x: ${n2(bx)}, z: ${n2(bz)}, radius: 26, count: 5, ` +
        `clearance: ${n2(s.clearance)}${s.blocking ? ", blocking: true" : ""} },`,
    );
    if (s.blocking) nominalBoxes += 5;
  }
}

const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
const controlPoints = FLAG_BLOCKS.map(
  ([id, i, j], n) =>
    `  { id: "${id}", name: "PG-${NAMES[n]}", ` +
    `pos: new Vector3(${n2(CENTRE(i))}, 0, ${n2(CENTRE(j))}), radius: 16 },`,
);

// Home spawns in the two opposite corner blocks, and one spawn per objective on
// the avenue that serves it — 40 m from the flag, which is the block core's
// edge plus the kerb, so it is open road rather than a lobby.
const spawns = [
  ...HOME_BLOCKS.map(
    ([team, i, j]) =>
      `  { team: ${team}, pos: new Vector3(${n2(CENTRE(i))}, 0, ${n2(CENTRE(j))}), ` +
      `yaw: ${team === 0 ? "(Math.PI * 3) / 4" : "-Math.PI / 4"} },`,
  ),
  ...FLAG_BLOCKS.map(
    ([id, i, j]) =>
      `  { team: null, controlPoint: "${id}", ` +
      `pos: new Vector3(${n2(CENTRE(i) + PITCH / 2)}, 0, ${n2(CENTRE(j))}), yaw: -Math.PI / 2 },`,
  ),
];

// --- the heightfield ---------------------------------------------------------

const HC = PLAY / CELL;
const row = HC + 1;
const heights = new Array(row * row).fill(0);
if (MARGIN === 0) {
  // The skirt: 1.2 m at the boundary ring, 0.6 m one ring in, level from there.
  // Gradient 0.15 against MAX_WALKABLE_GRADE's 0.4, so it severs no link.
  for (let j = 0; j < row; j++) {
    for (let i = 0; i < row; i++) {
      const ring = Math.min(i, j, HC - i, HC - j);
      heights[j * row + i] = ring === 0 ? 1.2 : ring === 1 ? 0.6 : 0;
    }
  }
}
const heightRows = [];
for (let j = 0; j < row; j++) {
  heightRows.push("    " + heights.slice(j * row, j * row + row).join(",") + ",");
}

// --- emit --------------------------------------------------------------------

const stamp =
  "Generated by `scripts/generate-proving-ground.mjs` at " +
  `--play ${PLAY} --margin ${MARGIN}. Do not hand-edit: regenerate.`;

const skirtNote =
  MARGIN === 0
    ? `Level under the built area with a 1.2 m skirt over the last 8 m, which
 * tucks the ground into the rim's foot instead of meeting it at a right angle.`
    : `Dead flat: this variant is closed by a borderland, and \`TerrainField\`
 * continues the field's own outer ring into the margin and rolls it. A skirt
 * here would be a 1.2 m step in the middle of open country.`;

const extentNote =
  MARGIN > 0
    ? `**${PLAY} m of play inside ${PLAY + 2 * MARGIN} m of ground.** \`MapLayout.size\` is the play
 * square — the nav grid, the flow fields, the cover masks, the obstacle field,
 * scatter placement and the flags are all built and authored inside it — and
 * the ${MARGIN} m margin is ground that costs terrain and nothing else. That split is
 * the free variable S0 exists to price; regenerate with different arguments to
 * move it.`
    : `**${PLAY} m of play, and no margin at all.** The whole extent is the PLAY
 * square, so every one of the six things priced on map AREA is priced on all
 * ${(PLAY * PLAY).toLocaleString("en-US")} square metres of it. This is the expensive half of the split S0
 * exists to price; regenerate with \`--play 900 --margin 300\` for the other.`;

const closure =
  MARGIN > 0
    ? `  // Open boundary: what stops a player leaving is the leash, not a box. The
  // rim is \`downs\` because an escarpment's basal band is a vertical face flush
  // with the collider plane, and out here that plane is a margin away from
  // anywhere a living player stands.
  borderland: { margin: ${MARGIN} },
  ridge: { form: "downs", slope: 0.12, seed: 0x50475244 },
`
    : `  ridge: { slope: 0.14, seed: 0x50475244 },
`;

mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "heights.ts"),
  `/**
 * proving/heights.ts — GENERATED. ${stamp}
 *
 * ${HC}x${HC} cells of ${CELL} m over the ${PLAY} m play square, so ${row}x${row} vertices.
 * \`size * cell\` must equal \`MapLayout.size\`; see \`Heightfield.cell\`.
 *
 * Reached through \`MapDef.heights\`, a lazy \`import()\` beside
 * \`MapDef.collision\` — so this file is a chunk of its own, and the DEV gate
 * \`MAPS\` puts in front of the proving ground is now the only thing keeping
 * 100 kB of dead flat ground out of the production bundle. That is what
 * \`PG-Level\` below is for; see \`scripts/check-proving.mjs\`.
 *
 * ${skirtNote}
 *
 * Level under the streets for Coldharbour's reason: a placement's height is
 * sampled ONCE at its own centre, so a fifty-metre tower on a grade floats at
 * one corner and buries itself at the other.
 */
import type { Heightfield } from "../layout";

export const ProvingHeights: Heightfield = {
  size: ${HC},
  cell: ${CELL},
  // Row-major, +Z per row.
  heights: [
${heightRows.join("\n")}
  ],
};

/**
 * The string \`scripts/check-proving.mjs\` greps the production bundle for.
 *
 * This file used to be reachable only through \`proving/layout.ts\`, so the
 * sentinel in THAT module covered it for free. \`MapDef.heights\` made it an
 * \`import()\` target of its own, and an unreferenced export of a dynamically
 * imported module is one Rollup keeps — which is exactly what makes this a
 * usable marker and exactly why one is now needed. A string and not an
 * identifier, because identifiers do not survive minification.
 */
export const PROVING_HEIGHTS_MARK = "PG-Level";

// Default too, because \`MapDef.heights\` is a lazy \`import()\` and a default
// is the one export name a generic signature can be written against.
export default ProvingHeights;
`,
);

writeFileSync(
  join(out, "layout.ts"),
  `/**
 * proving/layout.ts — GENERATED. ${stamp}
 *
 * THE PROVING GROUND — the dev-only load \`ENGINE_UPGRADE.md\` S0 measures
 * against, and NOT a level. It is registered in \`maps.ts\` behind
 * \`import.meta.env.DEV\` and must never reach a production bundle;
 * \`scripts/check-proving.mjs\` is what enforces that after every build.
 *
 * ${extentNote}
 *
 * ${N}x${N} blocks on an 80 m pitch, 16 m avenues between 64 m cores, eight
 * recipes cycled by a stable hash of each block's own indices so that the same
 * block carries the same buildings at either extent. Five objectives and both
 * home spawns stand on blocks left empty: a flag inside a collider cannot be
 * captured and sinks its own flow field.
 *
 * Nominal collider count at these arguments: **~${nominalBoxes.toLocaleString("en-US")} boxes**, struck
 * against Coldharbour's density of 768 over 320 m. It is a nominal drawn from
 * \`kit/city.ts\`'s per-builder figures; what the map actually bakes is
 * \`GameMap.colliderBoxes.length\`, and that is the number to quote.
 */
import { Vector3 } from "@babylonjs/core";
import type {
  ControlPointDef,
  MapLayout,
  Placement,
  ScatterSpec,
  SpawnPointDef,
} from "../layout";

const placements: Placement[] = [
${placements.join("\n")}
];

const scatter: ScatterSpec[] = [
${scatter.join("\n")}
];

const controlPoints: ControlPointDef[] = [
${controlPoints.join("\n")}
];

const spawns: SpawnPointDef[] = [
${spawns.join("\n")}
];

export const ProvingLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  size: ${PLAY},
  // Three walked floors, a roof, a spandrel at every window and a wall head
  // under every ceiling — Coldharbour's stack, and Coldharbour's answer.
  surfaces: 4,
${closure}  seed: 0x50475345,
};
`,
);

console.log(
  `proving ground: ${PLAY} m play + ${MARGIN} m margin = ${PLAY + 2 * MARGIN} m across\n` +
    `  ${N}x${N} blocks, ${placements.length} placements, ${scatter.length} scatter regions\n` +
    `  ${row}x${row} height vertices, nominal ~${nominalBoxes.toLocaleString("en-US")} collider boxes\n` +
    `  wrote src/world/proving/{layout,heights}.ts`,
);
