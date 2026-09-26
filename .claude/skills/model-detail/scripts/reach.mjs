// Can bots get onto everything a placement lets you stand on? Reads the built
// nav graph over the placement's footprint and reports, per standing height,
// how many surfaces are walkable, how many are standable but SEALED (the flood
// fill never reached them — a deck out of step range, a walled-in yard), and
// how many each flow field (every control point, both home spawns) fails to
// reach. Run it after any change to a builder's COLLIDERS.
//
// usage:
//   node .claude/skills/model-detail/scripts/reach.mjs --map greyfen --at 80,34,0 --half 13,11
//     --half hx,hz   the footprint's half extents in the placement's local frame
//     [--pad 1]      metres added round the footprint
//
// Needs a GPU (it boots the real client).
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const H = await import(pathToFileURL(join(ROOT, "plans/webgpu-ref/harness.mjs")).href);

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? d : args[i + 1];
};
const map = opt("map");
const at = opt("at");
const halfArg = opt("half");
if (!map || !at || !halfArg) {
  console.error("usage: reach.mjs --map <id> --at x,z[,rotY] --half hx,hz [--pad 1]");
  process.exit(1);
}
const [px, pz, rot = 0] = at.split(",").map(Number);
const [hx, hz] = halfArg.split(",").map(Number);
const pad = Number(opt("pad", 1));

const server = await H.startDevServer(ROOT);
const browser = await H.launchClient({ headless: true });
try {
  const { page, pageErrors } = await H.bootMap(browser, server.url, map);
  await H.installRound(page);
  const report = await page.evaluate(({ px, pz, rot, hx, hz, pad }) => {
    const g = window.__celshock;
    const nav = g.map.nav;
    const snap = nav.debugSnapshot();
    const names = [...g.map.controlPoints.map((cp) => cp.id), "home0", "home1"];
    const fields = names.map((n) => [n, nav.field(n)]).filter(([, f]) => f);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const bands = new Map();
    const band = (y) => {
      const k = y.toFixed(1);
      if (!bands.has(k)) bands.set(k, { walkable: 0, sealed: 0, unreached: {} });
      return bands.get(k);
    };
    let cells = 0;
    let full = 0;
    for (let cz = 0; cz < snap.dim; cz++) {
      for (let cx = 0; cx < snap.dim; cx++) {
        const wx = snap.origin + (cx + 0.5) * snap.cellSize;
        const wz = snap.origin + (cz + 0.5) * snap.cellSize;
        const dx = wx - px;
        const dz = wz - pz;
        // World -> local: the inverse of MapBuilder's turn.
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) > hx + pad || Math.abs(lz) > hz + pad) continue;
        cells++;
        const cell = cz * snap.dim + cx;
        if (snap.counts[cell] >= snap.maxSurfaces) full++;
        for (let k = 0; k < snap.counts[cell]; k++) {
          const sid = snap.cellBase[cell] + k;
          if (snap.blocked[sid]) continue;
          const b = band(snap.heights[sid]);
          if (!snap.walkable[sid]) {
            b.sealed++;
            continue;
          }
          b.walkable++;
          for (const [n, f] of fields) {
            if (f.dist[sid] === 0xffff) b.unreached[n] = (b.unreached[n] ?? 0) + 1;
          }
        }
      }
    }
    return {
      cells,
      full,
      maxSurfaces: snap.maxSurfaces,
      fields: fields.map(([n]) => n),
      bands: [...bands.entries()].sort((a, b) => Number(a[0]) - Number(b[0])),
    };
  }, { px, pz, rot, hx, hz, pad });
  console.log(`${report.cells} cells in the footprint; ${report.full} at the ${report.maxSurfaces}-surface ceiling (a candidate past it is DROPPED)`);
  console.log(`fields: ${report.fields.join(", ")}`);
  for (const [y, b] of report.bands) {
    const miss = Object.entries(b.unreached).map(([n, k]) => `${n}:${k}`).join(" ");
    console.log(`y ${y.padStart(7)}  walkable ${String(b.walkable).padStart(4)}  sealed ${String(b.sealed).padStart(3)}  ${miss ? "UNREACHED " + miss : "all fields reach"}`);
  }
  if (pageErrors.length) console.log("PAGE ERRORS", pageErrors);
} finally {
  await browser.close();
  server.stop();
}
