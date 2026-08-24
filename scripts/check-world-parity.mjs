/**
 * Checks that the world the multiplayer server rebuilds from the collision bake
 * is the world a real browser builds.
 *
 * Run with `npm run parity`. This is the guard on the load-bearing claim of the
 * whole server design: the server has no canvas, cannot run `MapBuilder`, and
 * so reconstructs the solid world from `<map>/collision.ts`. If that
 * reconstruction is wrong, nothing throws — shots land on walls for the shooter
 * and pass through for everyone else, and bots path through houses that are
 * solid on screen.
 *
 * It compares the NAV GRAPH rather than the boxes. A box count would match
 * while every box sat a metre to the left; the graph is downstream of every
 * box's position, size and rotation, so a matching graph means the geometry
 * matched. See `src/world/fingerprint.ts`.
 */
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { MAPS, root } from "./collision-hash.mjs";
import { startDevServer } from "./dev-server.mjs";

const MAP_KEY = "hollowmere.map";

/** The server's fingerprints, via the built `parity` entry. */
function serverFingerprints() {
  const build = spawnSync("npx", ["vite", "build", "-c", "vite.server.config.ts"], {
    cwd: root,
    encoding: "utf8",
  });
  if (build.status !== 0) throw new Error(`server build failed:\n${build.stderr}`);

  const run = spawnSync("node", ["dist-server/parity.js"], {
    cwd: root,
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`parity entry failed:\n${run.stderr}`);

  const line = run.stdout.split("\n").find((l) => l.startsWith("__PARITY__"));
  if (!line) throw new Error(`parity entry printed no result:\n${run.stdout}`);
  return JSON.parse(line.slice("__PARITY__".length));
}

/** The browser's fingerprint for one map, from a real `MapBuilder` build. */
async function clientFingerprint(browser, url, id) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error(`  [page] ${e.message}`));
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [MAP_KEY, id],
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__celshock), null, { timeout: 60_000 });

  const fp = await page.evaluate(async () => {
    const g = window.__celshock;
    g.startRound();
    await new Promise((resolve) => {
      const poll = () => (g.state === "deploy" ? resolve() : setTimeout(poll, 50));
      poll();
    });
    // Imported through the app's own module graph so the browser and the server
    // run the SAME fingerprint function — two copies of it could agree with
    // each other while both were wrong about the map.
    const { worldFingerprint } = await import("/src/world/fingerprint.ts");
    return worldFingerprint(g.map);
  });

  await page.close();
  return fp;
}

// ---------------------------------------------------------------------------

const server = serverFingerprints();

const vite = await startDevServer(root);

let browser;
let failures = 0;
try {
  browser = await chromium.launch();

  for (const { id } of MAPS) {
    const client = await clientFingerprint(browser, vite.url, id);
    const mine = server[id];
    const keys = Object.keys(client);
    const bad = keys.filter((k) => String(client[k]) !== String(mine?.[k]));

    if (bad.length === 0) {
      console.log(
        `PASS  ${id}: ${client.boxes} boxes, ${client.surfaces} surfaces, ` +
          `${client.walkable} walkable — server matches on all ${keys.length} fields`,
      );
    } else {
      failures++;
      console.error(`FAIL  ${id}: ${bad.length} of ${keys.length} fields differ`);
      for (const k of bad) {
        console.error(`        ${k}: client ${client[k]} vs server ${mine?.[k]}`);
      }
    }
  }
} finally {
  await browser?.close();
  vite.stop();
}

if (failures > 0) {
  console.error(
    "\nThe server is not rebuilding the same world the client builds.\n" +
      "Usually this means the bake is stale (`npm run collision`) or that\n" +
      "`server/world.ts` has drifted from `MapBuilder`'s collider half.\n",
  );
  process.exit(1);
}
console.log("\nserver and client agree on every map\n");
