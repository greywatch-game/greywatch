/**
 * What every script beside this file needs to stand a real client in front of
 * a real map, and the four facts about doing that on WebGPU which each of them
 * would otherwise get wrong on its own.
 *
 * It owns no measurement. `gate.mjs` reports what a round costs, `bank.mjs`
 * takes the reference frames and `pipelines.mjs` counts shader compilation;
 * what is here is only the part where all three would have written the same
 * thing and one of them would have written it slightly differently. The
 * browser and the dev server are NOT re-implemented here —
 * `scripts/browser.mjs` and `scripts/dev-server.mjs` own those, and this
 * imports them, because a second copy of the launch flags is exactly the drift
 * those files exist to prevent.
 *
 * **A map is DRAWN when `scene.isReady()` says so, and never after N frames.**
 * WebGPU compiles its pipelines lazily, so a canvas presents nothing at all
 * until they exist, and the frame that first happens on is a property of the
 * MAP and the machine rather than a constant: measured on the Windows box it
 * is frame 67 on Hollowmere, 11 on Greyfen, 14 on Coldharbour and 69 on
 * Harrowmead. `scene.isReady()` flipped on exactly those four frames, so it is
 * the wait. A frame count in its place is a duration wearing a frame count's
 * clothes — it was right on a 2 fps box because six frames was three seconds
 * there, and it silently photographs a blank canvas here.
 *
 * **A frozen frame needs SIX things held, not the two the plan assumed.**
 * `Game.tick` runs `post.update`, `sky.update`, `godRays.update` and
 * `motionBlur.update` in EVERY state, the deploy lid included, and the wind
 * and the GPU particles run off their own clocks beside them. Holding all six
 * makes two consecutive `page.screenshot()`s byte-identical on all four maps,
 * headed and headless — a true 0.000% floor, which is the only thing that
 * makes a later diff mean a shader difference. Holding fewer does not: with
 * the post chain alone Greyfen still moves 0.35% of its pixels between
 * consecutive grabs, and with everything but the wind it moves 99.8% of them
 * across a second, because a gust crossed the canopy.
 *
 * **The picture is taken with `page.screenshot()` and never read back off the
 * canvas.** A `drawImage` readback of the WebGPU canvas comes back fully
 * transparent on Hollowmere — alpha 0, every channel 0 — while the screenshot
 * of the same frame is 3.3 MB of chapel. A readback that returns black is not
 * a frame that is black, and the failure is silent in the worst direction: a
 * diff of two black images passes.
 *
 * **Headed and headless frames are NOT byte-identical**, on three of the four
 * maps. Both are correct and either may be banked; what may not happen is
 * banking in one mode and diffing in the other, which reports a shader
 * regression that is a browser mode. Whatever `bank.mjs` took the reference in
 * is what a comparison has to run in.
 */
import { launchClient } from "../../scripts/browser.mjs";
import { MAPS, root } from "../../scripts/collision-hash.mjs";
import { startDevServer } from "../../scripts/dev-server.mjs";

export { MAPS, root, launchClient, startDevServer };

/** The localStorage key `prefs.ts` remembers the chosen map under. */
export const MAP_KEY = "greywatch.map";

/** What a reference frame is taken at. 16:9, matching `capture-map-shots.mjs`. */
export const WIDTH = 1920;
export const HEIGHT = 1080;

/**
 * Everything that moves in a state that simulates nothing. See the header —
 * this list is the freeze, and shortening it does not reach a zero floor.
 */
export const FREEZE_SET = ["post", "sky", "godrays", "blur", "wind", "particles"];

/** Map ids in the order the shipped registry states them. */
export const MAP_IDS = MAPS.map((m) => m.id);

/**
 * A page with a booted `Game` on the named map, and nothing else done to it.
 *
 * Errors are collected rather than thrown: a boot that fails shows up as
 * `waitForFunction` timing out on the handle, which says nothing about why,
 * and the page error that explains it has already gone past by then.
 */
export async function bootMap(browser, url, id, { hideUI = true } = {}) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  const pageErrors = [];
  const consoleErrors = [];
  const consoleLines = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    consoleLines.push(m.text());
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [MAP_KEY, id]);
  const started = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__celshock), null, { timeout: 180_000 });
  const bootMs = Date.now() - started;
  if (hideUI) {
    await page.addStyleTag({
      content: "#hud{display:none!important}#boot{display:none!important}",
    });
  }
  return { page, bootMs, pageErrors, consoleErrors, consoleLines };
}

/**
 * Builds the round and waits for `deploy`, handing back what the build cost.
 *
 * `startRound()` only BOOKS the build — `buildRound` runs two animation frames
 * later — so this waits on the STATE and never on the call. `bakeFrameMs` is
 * the single frame after the install, which is where the reflection bake
 * lands: forty cube probes on Coldharbour, measured at 138 ms on a real GPU
 * and fatal to the device on a CPU rasteriser.
 */
export function installRound(page) {
  return page.evaluate(async () => {
    const g = window.__celshock;
    const t0 = performance.now();
    g.startRound();
    await new Promise((res) => {
      const poll = () => (g.state === "deploy" ? res() : setTimeout(poll, 10));
      poll();
    });
    const installMs = Math.round(performance.now() - t0);
    const frameStart = performance.now();
    await new Promise((res) => {
      const seen = g.scene.onAfterRenderObservable.add(() => {
        g.scene.onAfterRenderObservable.remove(seen);
        res();
      });
    });
    return {
      installMs,
      bakeFrameMs: Math.round(performance.now() - frameStart),
      probes: g.scene.customRenderTargets.length,
      probesRenderOnce: g.scene.customRenderTargets.every((rt) => rt.refreshRate === 0),
      paneGroups: g.map.paneGroups.length,
    };
  });
}

/**
 * Waits until the map actually draws, and reports the frame it happened on.
 *
 * See the header: this is `scene.isReady()` and not a settle count. The settle
 * a caller wants AFTER this — the shadow map is stepped and the post chain has
 * state — is its own business and is a few frames.
 */
export function waitUntilDrawn(page, timeoutMs = 120_000) {
  return page.evaluate(async (timeout) => {
    const g = window.__celshock;
    const deadline = performance.now() + timeout;
    let frames = 0;
    for (;;) {
      await new Promise((res) => {
        const seen = g.scene.onAfterRenderObservable.add(() => {
          g.scene.onAfterRenderObservable.remove(seen);
          res();
        });
      });
      frames++;
      if (g.scene.isReady()) return { drawnOnFrame: frames };
      if (performance.now() > deadline) throw new Error("scene never became ready");
    }
  }, timeoutMs);
}

/**
 * Stands the camera at a map's committed vantage and pushes what `deploy` does
 * not push for itself.
 *
 * The vantage is `src/ui/mapShots.ts`'s, which is the table the MENU reads, so
 * a reference frame and a menu backdrop cannot come to hold two ideas of where
 * the camera stands. `pos.y` is height above the SURFACE — upper envelope,
 * because that is the floor as drawn.
 */
export function placeVantage(page, vantage) {
  return page.evaluate(async (v) => {
    const g = window.__celshock;
    // The place, not the fight: no bodies, no rings, no beacons.
    for (const bot of g.battle.bots) bot.rig.root.setEnabled(false);
    g.zones.dispose();
    const cam = g.cameraSys.camera;
    const Vec3 = cam.position.constructor;
    const [x, above, z] = v.pos;
    cam.position.set(x, g.map.terrain.surfaceAt(x, z, true) + above, z);
    cam.setTarget(new Vec3(...v.target));
    if (v.fov) cam.fov = (v.fov * Math.PI) / 180;
    // The motion blur pass reprojects against these two, and a camera that
    // teleported without them smears the first frames it stands still for.
    g.cameraSys.yaw = cam.rotation.y;
    g.cameraSys.pitch = cam.rotation.x;
    // The eye the cel shader fogs against and the light slots — neither of
    // which `deploy` pushes for itself, so a village that has never been
    // played in has its windows dark.
    g.mats.updateCamera(cam.position);
    g.lighting.update(0.05, cam.position, g.mats);
  }, vantage);
}

/**
 * Holds everything that moves in a state that simulates nothing, and PINS the
 * three things that are clocks rather than switches.
 *
 * Applied by REPLACING the update rather than by disabling the effect, which
 * is what keeps the post chain, the god rays and the blur in the picture — a
 * reference set taken with them switched off could not diff the three post
 * fragments, and those are the work this bank exists to check.
 *
 * **Stopping a clock is not the same as setting it, and the difference is the
 * whole of cross-run reproducibility.** `post.time`, each cloud deck's
 * `uOffset` and `mats.windTime` are accumulators: they advance by `dt` every
 * frame from the moment the page loads, so halting them leaves each one
 * holding however much wall clock that particular run happened to spend
 * booting. Two consecutive grabs inside one process then agree perfectly —
 * which is what made the first version of this look correct — and a bank taken
 * on Tuesday differs from the same bank taken on Wednesday in every pixel of
 * sky. Measured: with the clocks merely halted, all four maps reported
 * "differs from the banked frame" against a bank taken minutes earlier in the
 * same mode. So each one is assigned a CONSTANT and then stopped, and the
 * constant is zero because a reference frame only has to be the same picture
 * every time, not a particular one.
 *
 * **The god rays and the motion blur are pinned by the CAMERA instead**, which
 * is why they are only halted here. Both derive from where the eye is and
 * where it was, so with a camera that has been standing still they have
 * already converged to the same state in any run — provided they were allowed
 * to converge. That is why a caller settles BEFORE freezing and not after.
 */
export function freeze(page, set = FREEZE_SET) {
  return page.evaluate((f) => {
    const g = window.__celshock;
    if (f.includes("post")) {
      g.post.time = 0;
      g.post.update = () => {};
    }
    if (f.includes("sky")) {
      // The decks scroll azimuthally off their own speeds; the offset is the
      // phase, and it is the only state `Sky.update` carries.
      for (const tex of g.sky.cloudTextures ?? []) tex.uOffset = 0;
      g.sky.update = () => {};
    }
    if (f.includes("godrays")) g.godRays.update = () => {};
    if (f.includes("blur")) g.motionBlur.update = () => {};
    if (f.includes("wind")) {
      // Assigned and then pushed through the real updater, because the clock
      // lives on the factory and the value lives on every material in its
      // cache — writing one without the other freezes half the world.
      g.mats.windTime = 0;
      g.mats.updateWind(0);
      g.mats.updateWind = () => {};
      // **There is one wind and THREE clocks reading it**, which is the trap
      // that made a pinned bank still differ run to run. `CONFIG.wind` is one
      // field, but the cel factory, the grass field and the water body each
      // carry their own accumulator and each pushes its own `time` uniform, so
      // pinning the factory alone leaves the grass swaying and the water
      // running. Located by diffing two banks and reading the worst tiles: the
      // graveyard grass on Hollowmere and the market green on Harrowmead, which
      // is exactly where the two maps disagreed.
      if (g.grass) {
        g.grass.time = 0;
        g.grass.mat?.setFloat("time", 0);
        g.grass.update = () => {};
      }
      if (g.water) {
        g.water.time = 0;
        for (const body of g.water.bodies ?? []) body.material?.setFloat?.("time", 0);
        g.water.update = () => {};
      }
    }
    if (f.includes("particles")) g.scene.particlesEnabled = false;
  }, set);
}

/** Lets `n` rendered frames pass. The settle AFTER readiness, never instead of it. */
export function settle(page, n = 6) {
  return page.evaluate(async (frames) => {
    const g = window.__celshock;
    let seen = 0;
    await new Promise((res) => {
      const o = g.scene.onAfterRenderObservable.add(() => {
        if (++seen < frames) return;
        g.scene.onAfterRenderObservable.remove(o);
        res();
      });
    });
  }, n);
}

/**
 * The vantages, read out of the module the menu itself reads.
 *
 * Fetched through the dev server rather than parsed off disk, so `?url`
 * imports resolve exactly as they do in the app.
 */
export async function vantages(browser, url) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const rows = await page.evaluate(async () => {
    const mod = await import("/src/ui/mapShots.ts");
    return Object.entries(mod.MAP_SHOTS).map(([id, s]) => [id, s.vantage]);
  });
  await page.close();
  return Object.fromEntries(rows);
}

/** Frames per second over a wall-clock window, measured off the scene's own counter. */
export function fps(page, ms) {
  return page.evaluate(async (windowMs) => {
    const g = window.__celshock;
    const f0 = g.scene.getFrameId();
    const t0 = performance.now();
    await new Promise((res) => setTimeout(res, windowMs));
    return +((g.scene.getFrameId() - f0) / ((performance.now() - t0) / 1000)).toFixed(1);
  }, ms);
}
