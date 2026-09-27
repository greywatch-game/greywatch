// Count blocking scatter props baked INSIDE a structure's collider — a prop
// the eye sees poking out of a wall, and a box the nav graph and every round
// treat as part of the wall.
//
// usage:
//   node .claude/skills/map-layout/scripts/buried.mjs <map|--all> [--rev <git rev>]
//
// Reads the collision bake (`src/world/<map>/collision.ts`, so run `npm run
// collision -- <map>` first); `--rev` also counts the bake at that revision,
// for a before/after. `boxGroups` in the bake is exactly the scatter's boxes,
// so the split between prop and structure is the bake's own. Should be 0 on
// every map: `MapBuilder.insideCollider` refuses such a spot, and a non-zero
// count means that test is being defeated (it was, on hills, until 76013c9).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, mapIds } from "./load.mjs";

const args = process.argv.slice(2);
const rev = args.includes("--rev") ? args[args.indexOf("--rev") + 1] : null;
const ids = args.includes("--all") ? mapIds() : args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--rev");
if (!ids.length) {
  console.error("usage: buried.mjs <map|--all> [--rev <git rev>]");
  process.exit(1);
}

const grab = (src, name) => {
  const i = src.indexOf(`  ${name}: [`);
  if (i < 0) return [];
  let depth = 0;
  let j = src.indexOf("[", i);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === "[") depth++;
    else if (src[j] === "]" && --depth === 0) break;
  }
  return JSON.parse(src.slice(start, j + 1).replace(/,\s*\]/g, "]"));
};

/** A box as `[w, h, d, cx, cy, cz, rotX, rotY]` — see `CollisionBox`. */
const corners = (b) => {
  const [w, , d, cx, , cz, , ry] = b;
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
};
const axes = (b) => [[Math.cos(b[7]), -Math.sin(b[7])], [Math.sin(b[7]), Math.cos(b[7])]];
/** Separating-axis overlap of two footprints, by at least `pen` on every axis. */
function overlap(a, b, pen) {
  const ca = corners(a);
  const cb = corners(b);
  for (const ax of [...axes(a), ...axes(b)]) {
    const pa = ca.map(([x, z]) => x * ax[0] + z * ax[1]);
    const pb = cb.map(([x, z]) => x * ax[0] + z * ax[1]);
    if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) < pen) return false;
  }
  return true;
}
const band = (b) => {
  let h = b[1] / 2;
  if (b[6]) h += (Math.abs(Math.sin(b[6])) * b[2]) / 2;
  return [b[4] - h, b[4] + h];
};

function count(src) {
  const boxes = grab(src, "boxes");
  const scatter = new Set(grab(src, "boxGroups").flat());
  const where = [];
  for (const i of scatter) {
    const a = boxes[i];
    const [a0, a1] = band(a);
    for (let k = 0; k < boxes.length; k++) {
      if (scatter.has(k)) continue;
      const b = boxes[k];
      if (b[0] > 200 || b[2] > 200) continue; // the boundary boxes
      const [b0, b1] = band(b);
      if (Math.min(a1, b1) - Math.max(a0, b0) < 0.15) continue;
      if (!overlap(a, b, 0.15)) continue;
      where.push(`(${a[3].toFixed(1)}, ${a[4].toFixed(1)}, ${a[5].toFixed(1)})`);
      break;
    }
  }
  return { props: scatter.size, where };
}

let bad = 0;
for (const id of ids) {
  const now = count(readFileSync(join(ROOT, "src", "world", id, "collision.ts"), "utf8"));
  let line = `${id.padEnd(12)} ${String(now.where.length).padStart(3)} of ${now.props} scatter colliders inside a structure's`;
  if (rev) {
    const then = count(execFileSync("git", ["show", `${rev}:src/world/${id}/collision.ts`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }));
    line += `   (at ${rev}: ${then.where.length} of ${then.props})`;
  }
  console.log(line);
  if (now.where.length) console.log(`             at ${now.where.slice(0, 8).join(" ")}${now.where.length > 8 ? " …" : ""}`);
  bad += now.where.length;
}
process.exit(bad ? 1 : 0);
