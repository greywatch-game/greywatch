// Every placement of a builder kind, on every map, as the `--map`/`--at`
// arguments shots.mjs and perf.mjs take — and the detail tier the count
// suggests (SKILL.md, "Decide the detail tier"). The count that decides is
// the BUSIEST MAP's, since each map is its own scene; it sets a ceiling
// and the model's role decides within it (a small prop is dressing however
// few there are).
//
// usage: node .claude/skills/model-detail/scripts/find.mjs <kind>
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const kind = process.argv[2];
if (!kind) {
  console.error("usage: find.mjs <kind>");
  process.exit(1);
}
const WORLD = join(ROOT, "src/world");
const num = (s, key) => {
  const m = s.match(new RegExp(`\\b${key}: (-?[\\d.]+(?:e-?\\d+)?|-?Math\\.PI(?: \\/ \\d+)?|Math\\.PI \\* [\\d.]+)`));
  if (!m) return 0;
  // rotY is written as a number or as a simple fraction of Math.PI.
  return Function(`return (${m[1]});`)();
};
let n = 0;
const perMap = {};
for (const map of readdirSync(WORLD, { withFileTypes: true })) {
  if (!map.isDirectory()) continue;
  const file = join(WORLD, map.name, "layout.ts");
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!line.includes(`kind: "${kind}"`)) return;
    const x = num(line, "x");
    const z = num(line, "z");
    const rot = num(line, "rotY");
    const params = line.match(/params: (\{.*\})/)?.[1] ?? "";
    console.log(`--map ${map.name} --at ${x},${z},${+rot.toFixed(4)}   # ${map.name}/layout.ts:${i + 1} ${params}`);
    n++;
    perMap[map.name] = (perMap[map.name] ?? 0) + 1;
  });
}
if (!n) {
  console.log(`no placement of "${kind}" in any layout`);
} else {
  const [busiest, most] = Object.entries(perMap).sort((a, b) => b[1] - a[1])[0];
  const tier =
    most <= 3 ? "landmark (50-90k vertices)" : most <= 30 ? "building (15-40k)" : most <= 250 ? "structure (4-10k)" : "dressing (0.5-3k)";
  const maps = Object.entries(perMap).map(([m, k]) => `${m} ${k}`).join(", ");
  console.log(`
${n} placement(s): ${maps}`);
  console.log(`busiest map ${busiest} (${most}) -> at most tier: ${tier}; the model's role decides within it`);
}
