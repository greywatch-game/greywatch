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
 *
 * **The DEV-only maps are checked too, and they cost a second server build.**
 * The proving ground is folded out of a production bundle
 * (`import.meta.env.DEV` in `src/world/maps.ts`), so the authority can only be
 * asked about it by the dev-mode build — which is the build
 * `ENGINE_UPGRADE.md` S9 measures the tick on. Nothing would otherwise check
 * that the world S9 measured is the world the client builds, and a 1500 m map
 * whose server nav graph quietly disagreed with its client would make every
 * number taken on it a measurement of the wrong thing. See `DEV_MAPS` in
 * `collision-hash.mjs`.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { launchClient } from "./browser.mjs";
import { DEV_MAPS, MAPS, root } from "./collision-hash.mjs";
import { startDevServer } from "./dev-server.mjs";

const MAP_KEY = "greywatch.map";

/**
 * The server's fingerprints, via the built `parity` entry.
 *
 * Run twice: once for the production bundle, which is the artefact a match
 * server actually is, and once for the dev-mode one, which is the only build
 * that has heard of the maps in `DEV_MAPS`. The production answers are merged
 * OVER the dev ones, so a map that exists in both is judged on the artefact
 * that ships.
 */
function serverFingerprints() {
  // `node` on vite's own entry rather than `npx`, for the Windows half of the
  // reason `dev-server.mjs` spawns it that way: `npx` is `npx.cmd` there and
  // `spawnSync` cannot exec it, so the build fails with a null status and this
  // reports "server build failed:" followed by nothing at all.
  const vite = join(root, "node_modules", "vite", "bin", "vite.js");
  const one = (args, entry, label) => {
    const build = spawnSync(process.execPath, [vite, "build", ...args], {
      cwd: root,
      encoding: "utf8",
    });
    if (build.status !== 0) throw new Error(`${label} build failed:\n${build.stderr}`);

    const run = spawnSync(process.execPath, [entry], { cwd: root, encoding: "utf8" });
    if (run.status !== 0) throw new Error(`${label} entry failed:\n${run.stderr}`);

    const line = run.stdout.split("\n").find((l) => l.startsWith("__PARITY__"));
    if (!line) throw new Error(`${label} entry printed no result:\n${run.stdout}`);
    return JSON.parse(line.slice("__PARITY__".length));
  };
  // The dev build first and merged under, so that if a map is somehow in both
  // it is the shipping artefact that is judged.
  const dev = DEV_MAPS.length
    ? one(
        ["-c", "vite.server.config.ts", "--mode", "development"],
        "dist-server-dev/parity.js",
        "dev server",
      )
    : {};
  const prod = one(["-c", "vite.server.config.ts"], "dist-server/parity.js", "server");
  return { ...dev, ...prod };
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
  browser = await launchClient();

  for (const { id } of [...MAPS, ...DEV_MAPS]) {
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
