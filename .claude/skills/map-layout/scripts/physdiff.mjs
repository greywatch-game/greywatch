// When `node plans/physics-ref/drop.mjs --check <map>` fails after a map
// change: is it the map, or the physics? Re-bank the map first (`drop.mjs
// <map>`, which overwrites plans/physics-ref/ref/<map>.json), then run this to
// diff every body against the committed reference and name what each moved
// body rested on then and now.
//
// usage:
//   node .claude/skills/map-layout/scripts/physdiff.mjs <map> [--rev HEAD]
//
// Every body that moved should have a CHANGED COLLIDER under it — a roof that
// is gone, a tree that was re-rolled — and every other body should be within
// the 0.7 m tolerance. That is a stale reference: commit the re-bank. A body
// that moved with the same collider under it, or a low run-twice floor that
// `drop.mjs` refuses, is the physics: `git checkout` the reference and look at
// `src/systems/PhysicsWorld.ts` and `CONFIG.bots.death` instead.
//
// "then" is the bake as of the commit that last banked the reference, since
// that is the world the old bodies fell onto.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./load.mjs";

const args = process.argv.slice(2);
const id = args[0];
const rev = args.includes("--rev") ? args[args.indexOf("--rev") + 1] : "HEAD";
if (!id || id.startsWith("--")) {
  console.error("usage: physdiff.mjs <map> [--rev HEAD]");
  process.exit(1);
}
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const refPath = `plans/physics-ref/ref/${id}.json`;
const banked = git("log", "-1", "--format=%h", rev, "--", refPath).trim();
if (!banked) throw new Error(`${refPath} has no history at ${rev}`);
const oldRows = JSON.parse(git("show", `${rev}:${refPath}`)).rows;
const newRows = JSON.parse(readFileSync(join(ROOT, refPath), "utf8")).rows;

const grab = (src, name) => {
  const i = src.indexOf(`  ${name}: [`);
  if (i < 0) return [];
  let d = 0;
  let j = src.indexOf("[", i);
  const s = j;
  for (; j < src.length; j++) {
    if (src[j] === "[") d++;
    else if (src[j] === "]" && --d === 0) break;
  }
  return JSON.parse(src.slice(s, j + 1).replace(/,\s*\]/g, "]"));
};
const world = (src) => ({ boxes: grab(src, "boxes"), scatter: new Set(grab(src, "boxGroups").flat()) });
const then = world(git("show", `${banked}:src/world/${id}/collision.ts`));
const now = world(readFileSync(join(ROOT, "src", "world", id, "collision.ts"), "utf8"));

const within = (b, x, z) => {
  const [w, , d, cx, , cz, , ry] = b;
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const dx = x - cx;
  const dz = z - cz;
  return Math.abs(dx * c - dz * s) <= w / 2 && Math.abs(dx * s + dz * c) <= d / 2;
};
const label = (W, k) => `${W.scatter.has(k) ? "a scatter prop" : "a structure"} (top ${(W.boxes[k][4] + W.boxes[k][1] / 2).toFixed(1)} m)`;
/** What a body resting at (x, y, z) lies on: a box whose top is just under it, or the ground. */
const restsOn = (W, x, y, z) => {
  const k = W.boxes.findIndex((b) => b[0] <= 200 && b[2] <= 200 && Math.abs(b[4] + b[1] / 2 - (y - 0.175)) < 0.35 && within(b, x, z));
  return k < 0 ? "the ground" : label(W, k);
};
/** The tallest thing standing at (x, z). */
const tallest = (W, x, z) => {
  let best = -1;
  W.boxes.forEach((b, k) => {
    if (b[0] > 200 || b[2] > 200 || !within(b, x, z)) return;
    if (best < 0 || b[4] + b[1] / 2 > W.boxes[best][4] + W.boxes[best][1] / 2) best = k;
  });
  return best < 0 ? "nothing" : label(W, best);
};

let moved = 0;
let worstStill = 0;
for (const [i, a] of oldRows.entries()) {
  const b = newRows[i];
  const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (dist <= 0.7) {
    worstStill = Math.max(worstStill, dist);
    continue;
  }
  moved++;
  console.log(`#${String(i).padStart(2)} (${a[0].toFixed(1)}, ${a[2].toFixed(1)}): moved ${dist.toFixed(1)} m, ${(b[1] - a[1]).toFixed(2)} vertical`);
  console.log(`      then on ${restsOn(then, a[0], a[1], a[2])}; standing there now: ${tallest(now, a[0], a[2])}`);
  console.log(`      now  on ${restsOn(now, b[0], b[1], b[2])}; standing there then: ${tallest(then, b[0], b[2])}`);
}
console.log(`${id}: ${moved} of ${oldRows.length} bodies moved more than 0.7 m; the rest within ${worstStill.toFixed(3)} m (reference banked at ${banked})`);
