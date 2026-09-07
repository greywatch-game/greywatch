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

/**
 * How long a map gets to finish compiling before the readiness check gives up.
 *
 * Generous on purpose: the whole point is to fail on a scene that can NEVER be
 * ready rather than on a slow one, and the failure path is the only one that
 * spends this. Measured on the Windows box, every shipped map is ready inside
 * a couple of seconds of the round appearing.
 */
const READY_TIMEOUT_MS = 30_000;

/**
 * What a browser has to say about one map: the nav-graph fingerprint, and
 * whether the scene ever finished compiling.
 *
 * **The second question is a rider on this script rather than a script of its
 * own, and the reason is that a browser is the expensive part.** `npm run
 * build` must never need a GPU — `npm run shots` is deliberately the only thing
 * here that does — so the build cannot ask, and this is the one gate that is
 * run as a matter of routine AND already boots a real client and builds every
 * map in the registry, dev maps included. Asking costs a few hundred
 * milliseconds on top of a page that is open anyway.
 *
 * **What it is guarding is `scene.isReady()`, which is load-bearing for
 * TOOLING and for nothing else.** Nothing in `src/` asks it; what does is
 * `capture-map-shots.mjs`, because WebGPU compiles pipelines lazily and a
 * settled frame count cannot tell a compiled map from a blank canvas. So a
 * scene that can never be ready is a `npm run shots` that can never succeed —
 * and it has happened, silently, for a day: an emissive `DynamicTexture` that
 * nothing had ever `update()`d kept `StandardMaterial.isReadyForSubMesh`
 * returning false on ONE disabled mesh, on every map, with the picture
 * perfectly correct throughout. `VERIFYING.md` has the hunt.
 *
 * **Be honest about its reach**: this fires for anyone who runs parity, and
 * `CLAUDE.md` asks for that after a change to the WORLD layer — which the
 * change that broke it was not. It is a net rather than a proof, and it is
 * worth having because the alternative net is somebody running `npm run shots`
 * a month later and waiting two minutes for a message that names nothing.
 *
 * **It ASKS EVERY FRAME rather than once, and that is not politeness.**
 * `Scene.isReady` walks every mesh, and asking is what starts a material
 * compiling — the colliders and the effect pools carry no material of their
 * own, so they answer false on the first call and clear themselves on later
 * ones. A single call names hundreds of innocent meshes; the poll names the
 * one that is actually stuck, which is what the failure report prints.
 */
async function inspectClient(browser, url, id) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error(`  [page] ${e.message}`));
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [MAP_KEY, id],
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__celshock), null, { timeout: 60_000 });

  const fingerprint = await page.evaluate(async () => {
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

  const readiness = await page.evaluate(
    (deadlineMs) =>
      new Promise((resolve) => {
        const s = window.__celshock.scene;
        const until = performance.now() + deadlineMs;
        let frames = 0;
        const seen = s.onAfterRenderObservable.add(() => {
          frames++;
          if (s.isReady()) {
            s.onAfterRenderObservable.remove(seen);
            resolve({ ready: true, frames });
            return;
          }
          if (performance.now() < until) return;
          s.onAfterRenderObservable.remove(seen);
          // Name the offenders, with the material each one's first submesh
          // actually resolves to — a mesh carrying none answers with the
          // scene's default, and which of the two it is decides where to look.
          resolve({
            ready: false,
            frames,
            blocking: s.meshes
              .filter((m) => m.subMeshes && m.subMeshes.length && !m.isReady(true))
              .slice(0, 8)
              .map((m) => {
                const mat = m.subMeshes[0].getMaterial();
                return `${m.name} [${m.material ? mat.name : `default: ${mat?.name}`}]`;
              }),
          });
        });
      }),
    READY_TIMEOUT_MS,
  );

  await page.close();
  return { fingerprint, readiness };
}

// ---------------------------------------------------------------------------

const server = serverFingerprints();

const vite = await startDevServer(root);

let browser;
let failures = 0;
let unready = 0;
try {
  browser = await launchClient();

  for (const { id } of [...MAPS, ...DEV_MAPS]) {
    const { fingerprint: client, readiness } = await inspectClient(
      browser,
      vite.url,
      id,
    );
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

    // Counted separately from the parity verdict, because they are separate
    // claims about the same page: one is whether the SERVER agrees about this
    // world, the other whether the CLIENT ever finished compiling it.
    if (readiness.ready) {
      console.log(`      scene ready after ${readiness.frames} frames`);
    } else {
      unready++;
      console.error(
        `FAIL  ${id}: scene never became ready (${readiness.frames} frames, ` +
          `${READY_TIMEOUT_MS / 1000} s)`,
      );
      for (const m of readiness.blocking) console.error(`        ${m}`);
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
}
if (unready > 0) {
  console.error(
    "\nA scene that never becomes ready breaks `npm run shots`, which has no\n" +
      "other way to tell a compiled map from a blank canvas — and nothing in\n" +
      "`src/` asks it, so there is no symptom in the game at all. The usual\n" +
      "cause is a `DynamicTexture` on a material nothing has ever `update()`d;\n" +
      "the meshes named above are where to look, and VERIFYING.md has the hunt.\n",
  );
}
if (failures > 0 || unready > 0) process.exit(1);
console.log("\nserver and client agree on every map, and every scene compiles\n");
