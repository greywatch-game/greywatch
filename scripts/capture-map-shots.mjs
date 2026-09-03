/**
 * Photographs each map from the vantage `src/ui/mapShots.ts` states for it, and
 * writes the result to `shots/<id>.jpg` — the backdrop the main menu stands on.
 *
 * Run with `npm run shots`. Committed output, like `public/icons/` and the
 * water textures: the game is built from primitives at runtime and ships no
 * authored art, so the only honest way to have a picture of a map is to take
 * one of the real thing.
 *
 * **The pose is not here.** `MAP_SHOTS` in `src/ui/mapShots.ts` carries the
 * vantage beside the image it produced, so a re-frame is an edit to the table
 * the menu already reads and never to this file; what is here is only how a
 * browser is made to stand there. A map with no row in that table is not
 * photographed and is not an error — its menu falls back to the plain veil.
 *
 * **It runs in a real Chromium against the dev server** for the reason the
 * collision bake does: the point is a picture of what the CLIENT actually
 * builds, and the only way to be sure of that is to let the client build it.
 *
 * **It needs a machine with a GPU, and that is a REQUIREMENT of this generator
 * rather than an inconvenience of testing it.** The game runs on WebGPU, so a
 * box that cannot hand out an adapter never constructs `Game` at all and the
 * script fails as `waitForFunction` timing out on a map that cannot be
 * photographed. `docs/build.md` carries this as part of the four generated
 * assets' contract: a shot exists because it has a generator, and this is what
 * that generator now costs to run.
 *
 * **It launches HEADED, and on one of the two dev machines that is the
 * difference between a picture and nothing.** A headless Chromium on the
 * Chromebook cannot present a WebGPU canvas at all — the first
 * `getCurrentTexture()` destroys the device. On the Windows box headless
 * presents perfectly well and this would run either way, but headed is the
 * form that works on both and this script runs rarely enough that the seconds
 * do not buy anything. The other two browser-driven scripts stay headless
 * because neither of them wants a picture.
 *
 * Four things have to be true of the frame before it is worth keeping, and all
 * four are arranged below rather than assumed:
 *
 * - **No interface.** A page screenshot is the whole window, not the canvas
 *   element, so the deploy screen the round drops us on would be in the shot.
 *   `#hud` is hidden outright.
 * - **No bodies and no flags.** Sixteen bots spawn with the round and the
 *   capture zones draw a ring and a beacon at every control point — the
 *   brightest thing on a night map, and annotation rather than world. Both are
 *   taken out, so what is left is the place.
 * - **The lamps are lit.** Dynamic light is uploaded by `LightingSystem` from
 *   `Game.updateGameplay`, which does not run in `deploy` — so a village that
 *   has never been played in has its windows dark. The script pushes one
 *   update itself, from the camera it just moved.
 * - **The scene is READY, and then several frames, not one.** The shadow map is
 *   stepped and the post chain has state, so the first frame after a teleport
 *   is not the picture — that is what `SETTLE_FRAMES` is for. But a settle
 *   count is not what makes a map DRAW, and on fast hardware the two came
 *   apart: WebGPU compiles its pipelines lazily, and until they exist the
 *   canvas presents nothing. Measured on the Windows box, the frame each map
 *   FIRST draws anything on is 67 (Hollowmere), 11 (Greyfen), 14 (Coldharbour)
 *   and 69 (Harrowmead) — so six frames is two blank backdrops, silently
 *   written over two good committed ones. `scene.isReady()` flips on exactly
 *   the frame the map first draws, on all four, so the wait is that and never
 *   a number. Six frames was never wrong on the Chromebook, where six frames
 *   is three wall-clock seconds; it was a duration wearing a frame count's
 *   clothes.
 *
 * A re-run is a NEW picture rather than the same bytes: the sky drifts with
 * real time and the frame is whatever the machine had rendered when the
 * screenshot was taken. Re-run it when a map or a vantage has actually moved,
 * not as housekeeping.
 *
 * **Which is why it takes map ids on the command line** — `npm run shots --
 * cinderhaven` — and why that is a feature rather than a convenience. One map
 * moving is the ordinary case, and a full run would rewrite five committed
 * pictures that nothing has happened to with five different ones, in a diff
 * where the sixth is the only one anybody meant. With no ids it does the lot,
 * which is what a fresh checkout and a palette change both want.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchClient } from "./browser.mjs";
import { root } from "./collision-hash.mjs";
import { startDevServer } from "./dev-server.mjs";

/** The localStorage key `prefs.ts` remembers the chosen map under. */
const MAP_KEY = "greywatch.map";
/** What a backdrop is shot at. 16:9, and every viewport scales it to fill. */
const WIDTH = 1920;
const HEIGHT = 1080;
/** JPEG quality. 82 puts these at ~200-270 KB each; the veil hides the rest. */
const QUALITY = 82;
/** Rendered frames to let settle AFTER the scene is ready. See the header. */
const SETTLE_FRAMES = 6;
/** How long to wait for a map to compile its pipelines and draw. See the header. */
const READY_TIMEOUT_MS = 120_000;

const outDir = join(root, "shots");
const shotPath = (id) => join(outDir, `${id}.jpg`);

/**
 * A 16x9 JPEG of the interface's own near-black, as bytes.
 *
 * It exists for the bootstrap `bake-collision.mjs` solves with an empty stub:
 * `mapShots.ts` imports every one of these files, `OverlayScreen` imports that
 * module and `Game` imports that — so a missing shot is a dev server that 500s
 * and a script that cannot run until its own output already exists. A fresh
 * checkout has the committed images; a checkout that has lost one gets a black
 * rectangle for as long as it takes this script to replace it.
 */
const PLACEHOLDER = Buffer.from(
  "/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhl" +
    "bXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8" +
    "fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAAJABADASIAAhEBAxEB/8QA" +
    "FQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAA" +
    "AAAAAAAAAAAAAAH/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCPAUf/2Q==",
  "base64",
);

/**
 * Which files `mapShots.ts` imports, read out of its own import lines.
 *
 * The map REGISTRY is the wrong list to take this from: a map is allowed to
 * have no backdrop, and writing a placeholder for one would leave a black
 * rectangle in the tree that nothing references. What has to exist is exactly
 * what that module names.
 */
function importedShots() {
  const src = readFileSync(join(root, "src", "ui", "mapShots.ts"), "utf8");
  return [...src.matchAll(/shots\/([A-Za-z0-9_-]+)\.jpg/g)].map((m) => m[1]);
}

/** Photographs one map, and hands back the JPEG. */
async function captureMap(browser, url, id, vantage) {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
  });
  // Without these a failure to boot shows up only as `waitForFunction` timing
  // out on `__celshock`, which says nothing about why — the same reason
  // `bake-collision.mjs` listens.
  page.on("pageerror", (e) => console.error(`  [page] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.error(`  [console] ${m.text()}`);
  });
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [MAP_KEY, id],
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // The whole window is what a page screenshot takes, so the interface has to
  // go — the round below leaves the deploy screen up over the view.
  await page.addStyleTag({
    content: "#hud{display:none!important}#boot{display:none!important}",
  });
  await page.waitForFunction(() => Boolean(window.__celshock), null, {
    timeout: 120_000,
  });

  await page.evaluate(
    async ([vantage, frames, readyTimeout]) => {
      const g = window.__celshock;
      // `startRound()` only BOOKS the build — `buildRound` runs two animation
      // frames later, so this waits on the state rather than on the call (see
      // VERIFYING.md).
      g.startRound();
      await new Promise((resolve) => {
        const poll = () => (g.state === "deploy" ? resolve() : setTimeout(poll, 50));
        poll();
      });
      // The place, not the fight: no bodies, no rings, no beacons.
      for (const bot of g.battle.bots) bot.rig.root.setEnabled(false);
      g.zones.dispose();

      const cam = g.cameraSys.camera;
      const Vec3 = cam.position.constructor;
      const [x, above, z] = vantage.pos;
      // `pos.y` is height above the SURFACE here — see `MapVantage`. The upper
      // envelope (`true`), because that is the floor as drawn.
      cam.position.set(x, g.map.terrain.surfaceAt(x, z, true) + above, z);
      cam.setTarget(new Vec3(...vantage.target));
      if (vantage.fov) cam.fov = (vantage.fov * Math.PI) / 180;
      // The motion blur pass reprojects against these two, and a camera that
      // teleported without them smears the first frames it stands still for.
      g.cameraSys.yaw = cam.rotation.y;
      g.cameraSys.pitch = cam.rotation.x;
      // The eye the cel shader fogs against, and the light slots — neither of
      // which the `deploy` state pushes for itself. See the header.
      g.mats.updateCamera(cam.position);
      g.lighting.update(0.05, cam.position, g.mats);

      // Readiness first and the settle after it, for the reason in the header:
      // a frame count cannot stand in for a map having compiled its shaders,
      // and the frame that answers that question is `scene.isReady()`.
      const readyBy = performance.now() + readyTimeout;
      await new Promise((resolve, reject) => {
        const seen = g.scene.onAfterRenderObservable.add(() => {
          if (!g.scene.isReady()) {
            if (performance.now() < readyBy) return;
            g.scene.onAfterRenderObservable.remove(seen);
            reject(new Error("scene never became ready"));
            return;
          }
          g.scene.onAfterRenderObservable.remove(seen);
          resolve();
        });
      });
      await new Promise((resolve) => {
        let n = 0;
        const seen = g.scene.onAfterRenderObservable.add(() => {
          if (++n < frames) return;
          g.scene.onAfterRenderObservable.remove(seen);
          resolve();
        });
      });
    },
    [vantage, SETTLE_FRAMES, READY_TIMEOUT_MS],
  );

  // The PAGE rather than the canvas element: an element screenshot waits for
  // the box to be stable, and at a couple of frames a second under SwiftShader
  // that check times out before the game has drawn anything.
  const jpeg = await page.screenshot({
    type: "jpeg",
    quality: QUALITY,
    timeout: 180_000,
  });
  await page.close();
  return jpeg;
}

// ---------------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });
for (const id of importedShots()) {
  if (existsSync(shotPath(id))) continue;
  writeFileSync(shotPath(id), PLACEHOLDER);
  console.log(`${id}: wrote placeholder to bootstrap`);
}

const vite = await startDevServer(root);
console.log(`dev server on ${vite.url}`);

let browser;
try {
  browser = await launchClient({ headed: true });

  // The vantages come from the module the MENU reads, fetched through the dev
  // server so this script and the game cannot hold two ideas of where the
  // camera stands. `?url` imports resolve here exactly as they do in the app.
  const page = await browser.newPage();
  await page.goto(vite.url, { waitUntil: "domcontentloaded" });
  const shots = await page.evaluate(async () => {
    const mod = await import("/src/ui/mapShots.ts");
    return Object.entries(mod.MAP_SHOTS).map(([id, s]) => [id, s.vantage]);
  });
  await page.close();

  const only = new Set(process.argv.slice(2));
  if (only.size) {
    const known = new Set(shots.map(([id]) => id));
    const stray = [...only].filter((id) => !known.has(id));
    if (stray.length) {
      throw new Error(
        `no vantage for ${stray.join(", ")} — the ids are ` +
          `${[...known].join(", ")} (see src/ui/mapShots.ts)`,
      );
    }
  }

  for (const [id, vantage] of shots) {
    if (only.size && !only.has(id)) continue;
    const started = Date.now();
    const jpeg = await captureMap(browser, vite.url, id, vantage);
    writeFileSync(shotPath(id), jpeg);
    console.log(
      `${id}: ${WIDTH}x${HEIGHT}, ${(jpeg.length / 1024).toFixed(0)} KB -> ` +
        `${shotPath(id)} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
  }
} finally {
  await browser?.close();
  vite.stop();
}
