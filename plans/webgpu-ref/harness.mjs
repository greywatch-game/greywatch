/**
 * What every script beside this file needs to stand a real client in front of
 * a real map, and the facts about doing that on WebGPU which each of them would
 * otherwise get wrong on its own.
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
 * **A frozen frame needs EIGHT things held, not the two the plan assumed, and
 * the last two are not clocks at all.** `Game.tick` runs `post.update`,
 * `sky.update`, `godRays.update` and `motionBlur.update` in EVERY state, the
 * deploy lid included, and the wind and the GPU particles run off their own
 * clocks beside them. Holding those six makes two consecutive
 * `page.screenshot()`s byte-identical on all four maps, headed and headless.
 * Holding fewer does not: with the post chain alone Greyfen still moves 0.35%
 * of its pixels between consecutive grabs, and with everything but the wind it
 * moves 99.8% of them across a second, because a gust crossed the canopy.
 *
 * **Six reach zero inside ONE process and not across two**, which is the floor
 * that actually matters — a bank is compared against by a later run. The two
 * in the way were a lantern's flicker PHASE, drawn from `Math.random()` per
 * fixture at map build, and a cube probe, which is refresh-ONCE and was baked
 * before any of this was held. Neither is reachable by pinning time and both
 * are invisible on a map with no lamps and no water. The phase is fixed in the
 * GAME (`LightingSystem`'s `FLICKER_SEED`) rather than papered over here, so
 * this file only has to re-bake the probes; with both, all sixteen banked
 * frames come back byte-identical between two processes. See `freeze`.
 *
 * **The picture is taken with `page.screenshot()` and never read back off the
 * canvas.** A `drawImage` readback of the WebGPU canvas comes back fully
 * transparent on Hollowmere — alpha 0, every channel 0 — while the screenshot
 * of the same frame is 3.3 MB of chapel. A readback that returns black is not
 * a frame that is black, and the failure is silent in the worst direction: a
 * diff of two black images passes.
 *
 * **Nothing here may fetch a shader compiler off a CDN, and every page this
 * file opens is wired so that trying is a page error rather than a round
 * trip.** Babylon lazily pulls glslang and twgsl off `cdn.babylonjs.com` the
 * first time a GLSL shader reaches the backend — four files, two of them WASM
 * — which is how the port compiled GLSL under `WebGPUEngine` for five
 * milestones. Every shader in the tree is WGSL now, so a fetch means one of
 * them quietly went back to GLSL, and the cost is `docs/pwa.md`'s offline
 * promise: a game that needs the network on its first draw. `bootMap` aborts
 * the route AND records every request to it as `cdnRequests`, and
 * `assertNoTranspiler` is the other half — see it for why a caller has to fail
 * on both and why one silences the other.
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
export const FREEZE_SET = [
  "post",
  "sky",
  "godrays",
  "blur",
  "wind",
  "particles",
  "lights",
  "reflections",
];

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
  const cdnRequests = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  // The transpiler tripwire's first half — see the header, and
  // `assertNoTranspiler` for why neither half is enough alone. Matched on the
  // DOMAIN and not on a hostname anyone typed from memory: the plan asserted
  // "no CDN fetch during boot" against `preview.babylonjs.com` at M0 and
  // passed while watching a host that is never contacted.
  page.on("request", (r) => {
    if (/\/\/([^/]*\.)?babylonjs\.com\//.test(r.url())) cdnRequests.push(r.url());
  });
  await page.route("**/*.babylonjs.com/**", (r) => r.abort());
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
  return { page, bootMs, pageErrors, consoleErrors, consoleLines, cdnRequests };
}

/**
 * Builds the round and waits for `deploy`, handing back what the build cost.
 *
 * `startRound()` only BOOKS the build — `buildRound` runs two animation frames
 * later — so this waits on the STATE and never on the call.
 *
 * **`installMs` covers the reflection bake as well as the build, and that is
 * the state machine's doing rather than this function's.** Since
 * `ENGINE_UPGRADE.md` S0c the `loading` state is held until the bake has
 * drained (`Game.bakeWait`), so the state flipping to `deploy` is the whole of
 * the install landing — forty cube probes on Coldharbour, 265 on the 900 m
 * proving ground, which is 5.7 s of frames on top of the build. Budget for it:
 * there is no timeout here.
 *
 * `bakeFrameMs` is therefore the frame AFTER all of that and is now an
 * ordinary frame on every map. It is kept because a reading that suddenly
 * grows is the tell that something has escaped the wait; it has never been a
 * reliable figure for what a bake costs, and `FINDINGS.md` #10 has the ~1.4 s
 * a forced re-bake measures instead.
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
 *
 * **The wind's constant is an ARGUMENT because a frame at t = 0 cannot see the
 * sway at all.** At zero every blade and every branch stands where the mesh
 * was authored, so a reference set taken only there diffs clean against a sway
 * term that has been deleted outright. A vantage may therefore ask to be
 * photographed mid-gust; what may not vary is that all three clocks take the
 * SAME constant, because there is one wind.
 *
 * **Each replaced updater is stashed first, so `thaw` can put it back**, which
 * is what lets one boot shoot a map's whole table. Re-freezing after a thaw is
 * safe and re-stashes nothing: the first stash is the one kept, so a second
 * freeze cannot record its own no-ops as the real methods.
 */
export function freeze(page, set = FREEZE_SET, { windTime = 0 } = {}) {
  return page.evaluate(([f, wind]) => {
    const g = window.__celshock;
    // The real updaters, recorded ONCE. See `thaw`.
    window.__refThaw ??= {
      post: g.post.update,
      sky: g.sky.update,
      godRays: g.godRays.update,
      blur: g.motionBlur.update,
      wind: g.mats.updateWind,
      grass: g.grass?.update,
      water: g.water?.update,
    };
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
      g.mats.windTime = wind;
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
        g.grass.time = wind;
        g.grass.mat?.setFloat("time", wind);
        g.grass.update = () => {};
      }
      if (g.water) {
        // **A `WaterBody` is `{ mesh, mat, depth }` and the field is `mat`.**
        // Written as `body.material` this whole line is an optional chain onto
        // `undefined` — it throws nothing, reports nothing and pins nothing,
        // leaving the water HALTED at whatever clock the run booted with,
        // which is the exact trap the paragraph above exists to name. It
        // survived because the four menu vantages barely have water in them;
        // the millpond and the marsh are in the set so that it cannot again.
        g.water.time = wind;
        for (const body of g.water.bodies ?? []) body.mat?.setFloat?.("time", wind);
        g.water.update = () => {};
      }
    }
    if (f.includes("particles")) g.scene.particlesEnabled = false;
    if (f.includes("lights")) {
      // A lantern's flame is a clock like any other and is pinned like one.
      // **What is deliberately NOT touched here is the flicker PHASE.** It
      // used to be `Math.random() * 100` per fixture at map build — not a
      // clock, so no amount of pinning time reached it, and two boots of the
      // same village lit the same lamp to two different intensities. It is
      // seeded in `LightingSystem` now (`FLICKER_SEED`), which is why this
      // block is three lines rather than a reassignment: **a bank taken over
      // the game's own phases fails loudly if anyone unseeds them again**,
      // where a harness that overwrote them would go on passing.
      g.lighting.t = 0;
      // A muzzle flash or a blast is a light with its own life on it, and a
      // frozen frame has no business holding one.
      g.lighting.transient.length = 0;
      // Pushed at dt = 0 so the clock stays where it was just put.
      g.lighting.update(0, g.cameraSys.camera.position, g.mats);
    }
    if (f.includes("reflections")) {
      // **A cube probe is refresh-ONCE, and it was baked before any of this
      // was pinned** — in the frame after `installMap`, with the grass and the
      // canopy at whatever the wind clock had reached by then and the cloud
      // decks wherever they had scrolled to. The water and the glazing then
      // sample that cube for the rest of the process, so a frozen frame whose
      // subject is a REFLECTION is a picture of an unfrozen world however
      // completely the world in front of it has been held. It is the loudest
      // on Greyfen's marsh, where the water is half the frame: 0.72/255 mean
      // across two runs with every clock and every phase already identical,
      // which is what said the difference could not be in the uniforms.
      // Resetting the counter re-bakes on the next frame, so the caller's
      // settle after the freeze is what makes it land. **This must come last**
      // — a re-bake before the clocks are pinned re-bakes the same problem.
      for (const p of g.reflections.probes ?? []) p.cubeTexture.resetRefreshCounter();
      for (const p of g.reflections.waterProbes ?? []) p.cubeTexture.resetRefreshCounter();
    }
  }, [set, windTime]);
}

/**
 * Puts every updater the freeze replaced back, so the next vantage in the same
 * boot can converge before it is frozen again.
 *
 * The clocks are NOT restored to where they were, and that is correct: each is
 * re-pinned to its constant by the next freeze, and a frame is a function of
 * the constant rather than of how it got there.
 */
export function thaw(page) {
  return page.evaluate(() => {
    const s = window.__refThaw;
    if (!s) return;
    const g = window.__celshock;
    g.post.update = s.post;
    g.sky.update = s.sky;
    g.godRays.update = s.godRays;
    g.motionBlur.update = s.blur;
    g.mats.updateWind = s.wind;
    if (g.grass && s.grass) g.grass.update = s.grass;
    if (g.water && s.water) g.water.update = s.water;
    g.scene.particlesEnabled = true;
  });
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

/**
 * The transpiler tripwire's second half: the ENGINE's own state, asked after a
 * sweep that really did reach every shader.
 *
 * `WebGPUEngine` builds `_glslang` and `_tintWASM` lazily inside
 * `prepareGlslangAndTintAsync`, which `_preparePipelineContextAsync` awaits
 * only when the source it is about to convert is GLSL. So either being set is
 * the stronger statement than "something was downloaded": it says a GLSL
 * shader reached the backend of this process.
 *
 * **NEITHER HALF IS ENOUGH ALONE, and they fail in opposite directions.** A
 * route filter only proves what was REQUESTED, and a shader nobody compiled
 * requests nothing — which is what this exists for. But `bootMap` ABORTS that
 * route, and an aborted fetch leaves both fields null forever, so on a page
 * with the abort in place this assertion cannot fire at all. Measured, with a
 * one-line GLSL `ShaderMaterial` compiled by hand: without the abort, all four
 * CDN files are fetched and both fields are set; with it, one request is made,
 * both fields stay null and the material simply never becomes ready. So a
 * caller must fail on `cdnRequests` as well, and `bootMap` collects them.
 *
 * **They are `null` and not `undefined`** — `WebGPUEngine`'s constructor sets
 * both — so the plan's literal `=== undefined` would have passed forever. Both
 * are tested here.
 *
 * Returns a list of failures so a caller can push them onto its own.
 */
export function assertNoTranspiler(page) {
  return page.evaluate(() => {
    const e = window.__celshock.engine;
    const bad = [];
    for (const k of ["_glslang", "_tintWASM"]) {
      if (e[k] !== undefined && e[k] !== null) {
        bad.push(`engine.${k} exists — a GLSL shader reached the backend`);
      }
    }
    return bad;
  });
}
