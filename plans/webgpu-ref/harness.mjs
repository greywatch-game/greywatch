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
 * there, and it silently photographs a blank canvas here. Since
 * `BABYLON_EXIT.md` X5.2c1 the post chain's stages that are OUR draws are not
 * in it, so the wait asks them beside it (`postAdapter`'s `ready`).
 *
 * **A frozen frame needs EIGHT things held, not the two the plan assumed, and
 * the last two are not clocks at all.** `Game.tick` runs `post.update`,
 * `sky.update`, the light shafts' `update` and `motionBlur.update` in EVERY
 * state, the deploy lid included, and the wind and the GPU particles run off
 * their own clocks beside them. Holding those six makes two consecutive
 * `page.screenshot()`s byte-identical on all four maps, headed and headless.
 * Holding fewer does not: with the post chain alone Greyfen still moves 0.35%
 * of its pixels between consecutive grabs, and with everything but the wind it
 * moves 99.8% of them across a second, because a gust crossed the canopy.
 *
 * **Then two more clocks arrived and the bank stopped reproducing ANY frame**
 * until `BABYLON_EXIT.md` X0.1: the irradiance volume re-traces a rolling
 * slice of itself every frame and converges over sweeps, not frames, and the
 * cloud ring's turn replaced the two scrolling textures the sky used to have.
 * With those and a storm's clock it is TEN — see `FREEZE_SET` and `freeze` —
 * and all of them are re-asked each time something new starts moving by
 * itself.
 *
 * **The volume is held by STUBBING its `update`, and that is a contract the
 * port keeps** (`BABYLON_EXIT.md` X5.1a). `freeze`'s `gi` block reaches only
 * `GiVolume`'s CPU half — `tier`, `cursor`, `warmFrames`, `sweepFrames()` and
 * `update` — which X5.1b keeps line for line, so the block reads the same
 * whoever records the passes; what it relies on is that a frame whose `update`
 * did not run dispatches NOTHING. That is checked: the volume's dispatches are
 * counted through one adapter (`window.__refGiCount`: Babylon's `ComputeShader`s
 * at a parent before X5.1b, OUR arm — `GiCompute.recorded`, picked first — from
 * X5.1b, and checked live against the volume's own pipelines' dispatches
 * counted at the compute pass encoder, X5.1b's review), and `thaw` throws if
 * the count moved while the stub stood. **Its converged frame is what reproduces
 * and nothing before it does**: the trace reads the history other workgroups of
 * the same dispatch are writing, so its colour during convergence differs run to
 * run (X5.1a, `gi.mjs`'s header); eight sweeps leave a held world's drift at most
 * 3.8e-6 a texel, under any 8-bit frame.
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
 *
 * **A LOST DEVICE MUST END THE RUN, and left to itself it never does.** Every
 * wait here is a promise in the page that a rendered frame resolves. When the
 * D3D12 device hangs (`DXGI_ERROR_DEVICE_HUNG`, `FINDINGS.md` 64) Babylon says
 * "context lost ... successfully restored", no frame is drawn again, the frame
 * counter stops, the page goes on answering `evaluate`, and the wait simply
 * never lands: one run sat about 11 hours at no CPU. So there are two stops and
 * both exit the PROCESS, non-zero, naming what happened: `watchDevice`, which
 * every page `bootMap` makes already wears, on the console line (exit 4), and a
 * hard limit (exit 3), on `settle`, `waitUntilDrawn`, `installRound` and
 * `freeze` each and over a tool's whole run (`hardLimit`, `--limit=<seconds>`),
 * for a device that goes without a word. `process.exit` is the door and a
 * rejected promise is not: `browser.close()` can hang on the same GPU, and the
 * browser and the dev server both go on the process's `exit`.
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
 * **`gi` must stay after everything it traces and before `reflections`**,
 * which is the order `freeze` applies them in whatever order this lists them.
 */
export const FREEZE_SET = [
  "post",
  "sky",
  "shafts",
  "blur",
  "wind",
  "particles",
  "lights",
  "lightning",
  "gi",
  "reflections",
];

/**
 * Full sweeps of the irradiance volume traced, at the warm budget, before it is
 * held. See `freeze`: the volume's only motion in a still world is the
 * multi-bounce iteration, which shrinks by the albedo every sweep, so this is
 * how far below a half-float's step the history is taken before it is
 * photographed. Measured: 8 reaches the cross-process floor on every map.
 */
export const GI_SWEEPS = 8;

/** The exit codes of the two stops (the header). */
export const EXIT_HARD_LIMIT = 3;
export const EXIT_DEVICE_LOST = 4;

/**
 * Every console line a lost device has been seen to say, in the order it says
 * them: Dawn's, Babylon's, and Babylon's failing to get it back. Matched on the
 * TEXT, because Dawn's and Babylon's first are `warning`s, so a filter on
 * `error` hears only the last, if that.
 */
const DEVICE_LOST_LINE =
  /DXGI_ERROR_DEVICE_|GetDeviceRemovedReason|WebGPU context lost|Device failed at creation|fatal error occurred during WebGPU/;

/** What the run was last waiting on: said when it is given up on. */
let waitingOn = "the start of the run";

function giveUp(code, message) {
  console.error(`\n${message}\n  waiting on: ${waitingOn}`);
  process.exit(code);
}

/** The console half of the stop, for a page `bootMap` did not make. */
export function watchDevice(page) {
  page.on("console", (m) => {
    const text = m.text();
    if (DEVICE_LOST_LINE.test(text)) {
      giveUp(EXIT_DEVICE_LOST, `DEVICE LOST: no frame will come again. The console said: ${text.slice(0, 240)}`);
    }
  });
  page.on("crash", () => giveUp(EXIT_DEVICE_LOST, "DEVICE LOST: the page crashed, which a hung GPU can do."));
  return page;
}

/**
 * The whole run's limit: `seconds`, unless the command line says `--limit=<s>`.
 * Unref'd, so a run that finishes is not held open by it.
 */
export function hardLimit(seconds) {
  const stated = process.argv.find((a) => a.startsWith("--limit="));
  const limit = stated ? Number(stated.slice("--limit=".length)) : seconds;
  setTimeout(() => {
    giveUp(
      EXIT_HARD_LIMIT,
      `HARD LIMIT: ${limit} s of run and not finished. If the frames have stopped, the device is lost without a console line; if the run is merely long, say --limit=<seconds>.`,
    );
  }, limit * 1000).unref();
}

/** `work`, which frames must land, with a limit in milliseconds on how long it may take. */
function limited(what, ms, work) {
  waitingOn = what;
  const timer = setTimeout(() => {
    giveUp(EXIT_HARD_LIMIT, `HARD LIMIT: ${what} took over ${ms / 1000} s. The frames have stopped, so the device is very likely lost without a console line.`);
  }, ms);
  return work.finally(() => clearTimeout(timer));
}

/** Map ids in the order the shipped registry states them. */
export const MAP_IDS = MAPS.map((m) => m.id);

/**
 * A page with a booted `Game` on the named map, and nothing else done to it.
 *
 * Errors are collected rather than thrown: a boot that fails shows up as
 * `waitForFunction` timing out on the handle, which says nothing about why,
 * and the page error that explains it has already gone past by then.
 *
 * `init` is an init script run in the page before ANY of the game's — a
 * function, or `[function, argument]` as `page.addInitScript` takes them — for
 * a probe that must see what the game builds at boot (the irradiance volume's
 * shader modules, textures and samplers are made inside `Game`'s constructor,
 * `gi.mjs`). Absent by default, so no caller that does not ask is touched.
 *
 * `viewport` and `deviceScaleFactor` stand the page at another size and
 * density than the bank's 1920x1080 at 1 (`post.mjs`'s phone, 832x384 at
 * 2.8125, `BABYLON_EXIT.md` X5.2a); absent, the page is the bank's.
 */
export async function bootMap(browser, url, id, { hideUI = true, init = null, viewport = null, deviceScaleFactor = null } = {}) {
  const page = watchDevice(
    await browser.newPage({
      viewport: viewport ?? { width: WIDTH, height: HEIGHT },
      ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
    }),
  );
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
  if (init) await (Array.isArray(init) ? page.addInitScript(init[0], init[1]) : page.addInitScript(init));
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
 * the limit here is a stop for a lost device, generous on purpose.
 *
 * `bakeFrameMs` is therefore the frame AFTER all of that and is now an
 * ordinary frame on every map. It is kept because a reading that suddenly
 * grows is the tell that something has escaped the wait; it has never been a
 * reliable figure for what a bake costs, and `FINDINGS.md` #10 has the ~1.4 s
 * a forced re-bake measures instead.
 */
export function installRound(page) {
  return limited("installRound", 900_000, page.evaluate(async () => {
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
      // The cubes baked, both pools (`ReflectionSystem.probeCount`) — ours,
      // the only bake since X3.7c.
      probes: g.reflections.probeCount,
      // What of the bake is still outstanding at deploy: 0 once it drained
      // under the card (`ReflectionSystem.bakePending`, which `Game` holds
      // `loading` on). `gate.mjs` asserts it, and that it STAYS 0.
      bakePending: g.reflections.bakePending,
      paneGroups: g.map.paneGroups.length,
    };
  }));
}

/**
 * Waits until the map actually draws, and reports the frame it happened on.
 *
 * See the header: this is `scene.isReady()` and not a settle count. The settle
 * a caller wants AFTER this — the shadow map is stepped and the post chain has
 * state — is its own business and is a few frames.
 */
export function waitUntilDrawn(page, timeoutMs = 120_000) {
  // Its own deadline is read between frames, so it cannot fire when they stop.
  return limited("waitUntilDrawn", timeoutMs + 60_000, page.evaluate(postAdapter).then(() => page.evaluate(async (timeout) => {
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
      // The post chain's stages that are OUR draws are not in
      // `scene.isReady()` (X5.2c1): the adapter's readiness arm asks our
      // pipelines (Babylon's arm, at a parent, answers true).
      if (g.scene.isReady() && window.__refPost().ready()) return { drawnOnFrame: frames };
      if (performance.now() > deadline) throw new Error("scene never became ready");
    }
  }, timeoutMs)));
}

/**
 * Stands the camera at a vantage, poses whatever the row asks to have in front
 * of it, and pushes what `deploy` does not push for itself.
 *
 * The menu vantage is `src/ui/mapShots.ts`'s, which is the table the MENU
 * reads, so a reference frame and a menu backdrop cannot come to hold two
 * ideas of where the camera stands; the rest are `vantages.mjs`'s (the table
 * is `src/bench/vantages.ts`, whose header lists the subjects a row can ask
 * for). `pos.y` is height above the
 * SURFACE — upper envelope, because that is the floor as drawn.
 */
export function placeVantage(page, vantage) {
  return page.evaluate(postAdapter).then(() => page.evaluate(async (v) => {
    const g = window.__celshock;
    // A seeded `Math.random` for the length of `fn` and put back — how a
    // subject whose LAYOUT is drawn at random (a blast, a muzzle flash) is
    // the same picture every run, without touching the game's own draw.
    // **Every touch of a particle field in this file goes through `fields`**
    // (`BABYLON_EXIT.md` X4.7a, X4.7c, X4.7d), one adapter for whose fields
    // they are: since X4.7c the ash is OURS and since X4.7d the rotor wash too
    // (`g.particleDraw`: `ParticleField`s, stepped and drawn by `ParticleDraw`,
    // in one list), where a parent before X4.7d held Babylon's rings
    // (`GPUParticleSystem`s on `g.scene.particleSystems`) and one before X4.7c
    // its ash as well — and each call picks by which list a field is on, so a
    // BEFORE taken at any of those parents runs this file and touches each
    // field where it lies, exactly as the file before X4.7c did there. The names a field is written through (`emitter`,
    // the emit box, `emitRate`, `updateSpeed`, `preWarmStepOffset`, `start`,
    // `stop`, `isStopped`) are the same on both; what differs — the ready test,
    // a reset, a pre-warm step and the switch — goes through `ParticleDraw` for
    // ours. `freeze` and `thaw` switch both lists the same way
    // (`particlesOn`, the same two writes as `enable`).
    const fields = (() => {
      const draw = g.particleDraw ?? null;
      const ours = (f) => draw !== null && draw.fields.includes(f);
      const F = {
        /** Every field of the game's, in the order the frame steps and draws them: ours first, at `"particles"`. */
        all: () => [...(draw ? draw.fields : []), ...g.scene.particleSystems],
        motes: () => g.atmosphere.system,
        /** One hull's rings, dust then spray, as `RotorWash` holds them. */
        ringsOf: (w) => [w.dust, w.spray].filter(Boolean),
        rings: () => g.rotorWash.washes.flatMap((w) => F.ringsOf(w)),
        /** `scene.particlesEnabled`, and ours's twin of it. */
        enable: (on) => {
          g.scene.particlesEnabled = on;
          if (draw) draw.enabled = on;
        },
        ready: (f) => (ours(f) ? draw.isReady(f) : f.isReady()),
        /** Whether `RotorWash.update` left the ring emitting (a rate over zero). */
        emits: (f) => f.emitRate > 0,
        /** A pre-warm step made one fixed frame at an animation ratio of 1. */
        prime: (f) => {
          f.preWarmStepOffset = 1;
        },
        reset: (f) => (ours(f) ? draw.reset(f) : f.reset()),
        empty: (f) => {
          f.stop();
          F.reset(f);
        },
        /** One fixed frame of `f` at an animation ratio of 1, its own pre-warm pair. */
        step: (f) => {
          if (ours(f)) {
            draw.preWarmStep(f);
            return;
          }
          f.animate(true);
          f.render(true, true);
        },
        /** The emitter put at `(x, y, z)`: Babylon's is replaced by a clone of the eye, ours written. */
        placeEmitter: (f, x, y, z) => {
          if (ours(f)) {
            f.emitter.set(x, y, z);
            return;
          }
          f.emitter = g.cameraSys.camera.position.clone();
          f.emitter.set(x, y, z);
        },
        speed: (f) => f.updateSpeed,
        hold: (f) => {
          f.updateSpeed = 0;
        },
        /** A ring as `RotorWash.clear` leaves it at an install, on `speed`. */
        putBack: (f, speed) => {
          F.reset(f);
          f.updateSpeed = speed;
          if (f.isStopped()) f.start();
        },
      };
      return F;
    })();
    const seeded = (seed, fn) => {
      const keep = Math.random;
      let s = seed >>> 0;
      Math.random = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      try {
        fn();
      } finally {
        Math.random = keep;
      }
    };
    // **Every subject a row can ask for is put away first, every time**, so a
    // vantage's frame is a function of its own row and never of the one shot
    // before it in the same boot.
    // The kit screen first, because putting it away hands the weapon back to
    // the carried pose and shows it again (`Game.stowKit`), which the
    // viewmodel's own put-away below then hides. Each of these five (the lid,
    // the bay, the flash, the finishes, the throwable) is done only after a
    // row that raised it, so the rows banked before them run exactly the
    // calls they were banked with. A reload row's ROLL needs no put-away:
    // `setTarget` below writes the camera's `rotation.z` to 0 itself.
    if (g.state === "loadout") g.closeLoadout();
    if (window.__refBay) {
      delete g.loadoutScreen.stageBay;
      window.__refBay = false;
    }
    if (window.__refFlash) {
      g.playerView.cleared();
      window.__refFlash = false;
    }
    if (window.__refFinished) {
      for (const id of window.__refFinished) g.player.view.setFinish(id, "standard");
      window.__refFinished = null;
    }
    if (window.__refThrowable) {
      g.player.view.setThrowable(window.__refThrowable);
      window.__refThrowable = null;
    }
    // The effect pools an `fx` row raised (X4.4a), each put away by its own
    // module's door: the rounds and the marks, every flight and fire (a fire
    // goes out through `Game.fireOut`, its flames, light and voice with it),
    // the wire's mines, rockets and grenades, the shards and the rubble parked
    // and their streams re-seeded, the scorch, the brass — the weapon's
    // stowed state put back as the boot left it — and the fire lights'
    // flicker stream re-seeded. Only after a row that raised them, for the
    // reason above.
    //
    // **What this does NOT put back, so an `fx` row still depends on the
    // `fx` rows shot before it in its boot** (which is why a new one is
    // appended at the END, like every row): Havok's world keeps every body
    // the pools ever made, parked rather than removed, and the order and
    // history of them is the engine's; the lamps' shadow atlas (`LocalShadows`)
    // keeps its tile allocation and its per-fixture caches; and the flights' and fires' ids run on. None
    // moved a pixel between two runs of the same sequence (`bank.mjs`
    // refuses a row whose two grabs differ, and `--check` twice is the
    // proof), but a row shot alone or out of order is not its banked frame.
    if (window.__refFx) {
      // A pane a `breaks` event collapsed (X4.6a) stands again, its vertex
      // range written back as the stash took it, so no row after it stands
      // behind a broken pane: a pane never mends in a round, and this is the
      // bank's own write and nothing the game can do. Through what holds the
      // range since X4.6e: our renderer's glazing (`GlassDraw.writePositions`).
      for (const { surface, first, range } of window.__refFx.collapsed ?? []) {
        g.glassDraw.writePositions(surface, first, range);
      }
      // The blobs a `blob` event placed (X4.6a's review): switched off by the
      // door a teardown takes them by, and only after a row that raised one.
      if (window.__refFx.blobs) g.shadows.hideBlobs();
      g.combatFx.clearTransient();
      g.grenades.reset();
      g.grenadeFx.reset();
      g.antiTank.reset();
      g.antiTankFx.reset();
      g.net?.ordnance?.reset();
      g.net?.grenades?.reset();
      g.debris.reset();
      g.blastDebris.reset();
      g.playerView.cleared();
      g.playerView.stowed(window.__refFx.stowed);
      // The fire lights' flicker phases are drawn from `LightingSystem`'s
      // own stream as each light is added, and nothing in a round re-seeds
      // it but a map build — so it is re-seeded here, and a row's fire is
      // not flickering at a phase the rows before it chose.
      g.lighting.rand = (await import("/src/world/rng.ts")).mulberry32(0x44a);
      window.__refFx = null;
    }
    // The mote field a `motes` row posed (X4.5a): rebuilt as the map states it,
    // its clock and its emit box with it. Every other row is shot with it
    // switched off, so the only thing a later row could see is that it is
    // there; only after a row that raised it, for the reason above.
    if (window.__refMotes) {
      g.atmosphere.capacity = 0;
      g.atmosphere.apply(g.mapDef.environment.particles, g.map.size, g.map.size);
      window.__refMotes = false;
    }
    // The rings a `particles` row posed (X4.7a), and the hull it pinned: every
    // ring emptied and started again, as `RotorWash.clear` leaves them at an
    // install (a ring is started once and never stopped), on its own clock
    // again; the water's hole closed; the hull put back where the install
    // stood it and its picture posed there. Its mote field went with
    // `__refMotes` above. Only after a row that raised them.
    if (window.__refParticles) {
      const P = window.__refParticles;
      const F = P.fields;
      for (const [ring, speed] of P.speeds) F.putBack(ring, speed);
      if (P.wet) g.water.setWash(g.rotorWash.sites, 0);
      if (P.hull) {
        P.hull.pos.set(P.pos[0], P.pos[1], P.pos[2]);
        P.hull.yaw = P.yaw;
        P.hull.flight.rotor = P.rotor;
        g.vehicleViews.update();
      }
      window.__refParticles = null;
    }
    // The place, not the fight: no bodies, no rings, no beacons. The bodies
    // are the round's session's (`g.net.roster` — a client's, offline too),
    // and the roster poses and re-shows every living one off the wire each
    // frame, the deploy screen included, which would undo a hidden body and
    // re-pose a posed one before the frame is drawn. So its per-frame update
    // is HELD for the life of the boot — a bank boot photographs and never
    // plays — and a body is shown or hidden by `NetSoldier.setEnabled`, which
    // then stays as it is put.
    const roster = g.net?.roster;
    if (roster) {
      roster.update = () => {};
      for (const body of roster.soldiers) body.setEnabled(false);
    }
    // HIDDEN rather than disposed, which is what a row asking for them needs:
    // a boot shoots the whole table in order and a disposed ring is gone for
    // every row after the one that took it.
    for (const zone of g.zones.zones) {
      for (const s of zone.ring) s.on = Boolean(v.zones);
      zone.flag.setVisible(Boolean(v.zones));
    }
    // `blasts` since BABYLON_EXIT.md X4.4c (`fx`, private, before it).
    (g.grenadeFx?.blasts ?? g.grenadeFx?.fx)?.reset();
    g.player.view.setVisible(false);
    // The settings a row overrode go back to what the boot chose — this
    // machine's defaults, recorded in `mode.json` beside the browser — before
    // this row states its own. Recorded ONCE, on the first row that touches
    // one, for `freeze`'s stash's reason.
    window.__refSettings ??= { ...g.settings };
    for (const [k, val] of Object.entries(window.__refSettings)) {
      if (g.settings[k] !== val) g.setSetting(k, val);
    }
    for (const [k, val] of Object.entries(v.settings ?? {})) g.setSetting(k, val);
    // The damage flash a row held (`damage`, raised by `freeze` under the
    // stubbed decay) is put out before the next row converges, rather than
    // left to decay by however many frames that takes: none is what every
    // row that does not ask for it is shot at (`postAdapter`).
    window.__refPost().flash(false);

    const cam = g.cameraSys.camera;
    const Vec3 = cam.position.constructor;
    const [x, above, z] = v.pos;
    cam.position.set(x, g.map.terrain.surfaceAt(x, z, true) + above, z);
    const target = new Vec3(...v.target);
    cam.setTarget(target);
    // The game's own hip field unless the row states one, every row: a row's
    // `fov` used to stay on the camera for every row shot after it.
    window.__refFov ??= cam.fov;
    cam.fov = v.fov ? (v.fov * Math.PI) / 180 : window.__refFov;
    // The motion blur pass reprojects against these two, and a camera that
    // teleported without them smears the first frames it stands still for.
    g.cameraSys.yaw = cam.rotation.y;
    g.cameraSys.pitch = cam.rotation.x;
    // The eye the cel shader fogs against — which `deploy` does not push for
    // itself, so a village that has never been played in has its windows dark.
    g.mats.updateCamera(cam.position);

    // A soldier, stood on the floor and posed by the function `Bot` poses it
    // with, so the frame is the rig's own geometry rather than wherever the
    // install's FSM happened to leave its joints. One bot per entry, from the
    // front of the roster — they are hidden again by the next row.
    if (v.rigs) {
      const soldier = await import("/src/entities/SoldierModel.ts");
      const { REST_POSE } = await import("/src/entities/soldierPose.ts");
      v.rigs.forEach((r, i) => {
        const body = roster.soldiers[i];
        const rig = body.rig;
        soldier.resetSoldierPose(rig);
        soldier.animateSoldier(rig, { ...REST_POSE, ...(r.pose ?? {}) });
        const [rx, rz] = r.at;
        rig.root.position.set(rx, g.map.terrain.surfaceAt(rx, rz, true) + rig.centerHeight, rz);
        rig.root.rotation.y = r.yaw ?? 0;
        body.setEnabled(true);
      });
    }

    // A flying hull PINNED HOVERING for a `particles` row's wash (X4.7a), as
    // X4.2d's scratch `x42dr/wash.mjs` pinned one: its position held over the
    // stated point at `clearance` metres of skid clearance over the floor (the
    // water's surface where `onWater` says, the point `Vehicle.washTo` is then
    // asked off), its rotor spooled to 1, and its picture posed there by the
    // door a frame poses it by (`VehicleViews.update`). Before the passes are
    // placed below, so the bodies' shadow map is drawn with it where it hangs.
    // Put back by the put-away above.
    const wash = v.particles?.wash;
    if (wash) {
      const fleet = g.vehicles.hulls.filter((h) => h.flies);
      const hull = fleet[wash.hull ?? 0];
      if (!hull) throw new Error(`no flying hull ${wash.hull ?? 0} on ${g.mapDef.id}`);
      const [hx, hz] = wash.at;
      let floor = g.map.terrain.surfaceAt(hx, hz, true);
      if (wash.onWater) {
        const pool = g.rotorWash.pools.find((p) => hx >= p.minX && hx <= p.maxX && hz >= p.minZ && hz <= p.maxZ);
        if (!pool || floor >= pool.surface) throw new Error(`(${hx}, ${hz}) is over no water`);
        floor = pool.surface;
      }
      window.__refParticles = {
        hull,
        pos: [hull.pos.x, hull.pos.y, hull.pos.z],
        yaw: hull.yaw,
        rotor: hull.flight.rotor,
        wet: Boolean(wash.onWater),
        speeds: [],
        fields: null,
      };
      hull.pos.set(hx, floor + hull.spec.hull.height / 2 + wash.clearance, hz);
      if (wash.yaw !== undefined) hull.yaw = wash.yaw;
      hull.flight.rotor = 1;
      g.vehicleViews.update();
    }

    // **The camera-dependent passes are placed at the vantage**, by the same
    // tail the editor's free camera and the building card's warm-up use, at
    // dt 0 so nothing is stepped: the world's two cascades, the bodies' map,
    // the lamps' atlas and their slots, the water and the grass. Without it
    // they stay wherever the install left them, which on a big map is
    // hundreds of metres from the frame — and a bank that cannot see the
    // shadow window cannot check it. Focus as `updateCameraAndLighting` puts
    // it: ahead of the eye along the view.
    const focus = target.subtract(cam.position).normalize().scaleInPlace(8).addInPlace(cam.position);
    // No bodies argument: the default is the roster's, which is what is drawn.
    g.updateSceneForCamera(0, focus, null, []);

    // The flags FLOWN (X4.6a): the zone system stepped by the door a round steps
    // it by, with the meters the row states, for a fixed count of fixed steps.
    // The cloth is a fixed-step simulation on a clock of its own, seeded per
    // flag, so the sheet is a function of the steps it has had since the build:
    // the sequence's, like every other row's state. **One frame first**: a flag
    // out of the frustum is not stepped (`FlagCloth.inView`, the planes of the
    // LAST render), so a flag must have been drawn from here before it is asked.
    // The zones keep what they were flown to: a later row showing them owes
    // its own `flown`, and no row before these shows them flown.
    if (v.flown) {
      await new Promise((res) => {
        const o = g.scene.onAfterRenderObservable.add(() => {
          g.scene.onAfterRenderObservable.remove(o);
          res();
        });
      });
      const points = g.zones.zones.map((_, i) => ({ meter: v.flown.meters[i] ?? 0 }));
      const steps = Math.round(v.flown.seconds * 60);
      for (let i = 0; i < steps; i++) g.zones.update(1 / 60, points, cam.position);
    }

    // A blast in the air: the real `BlastFx` raised at a point and aged by
    // a fixed number of fixed steps, so it is posed in flight the same way
    // every run. Its layout is drawn from `Math.random`, which is seeded for
    // the length of the pose and put back — the GAME's draw is not touched.
    const blastFx = g.grenadeFx?.blasts ?? g.grenadeFx?.fx;
    if (v.blast && blastFx) {
      const fx = blastFx;
      const [bx, bz] = v.blast.at;
      const at = new Vec3(bx, g.map.terrain.surfaceAt(bx, bz, true), bz);
      seeded(0x5eed1, () => {
        fx.blast(at, v.blast.power ?? 1, g.grenades.probeGround(at));
        const steps = Math.round((v.blast.age ?? 0.5) * 60);
        for (let i = 0; i < steps; i++) fx.update(1 / 60);
      });
    }

    // The player's own weapon, on the camera as it is in a round: fitted,
    // shown, and posed by `ViewModel.update` from rest through enough fixed
    // steps for every spring in it to settle, hip or aimed. An aimed frame
    // takes the optic's own field as well, which is the picture the sight is
    // FOR. `params` is laid over the player's own for every step, which is how
    // a gesture is held mid-phase — each is a function of its phase.
    if (v.view) {
      const view = g.player.view;
      view.setWeapon(v.view.weapon);
      view.setSight(v.view.sight);
      if (v.view.finish) {
        view.setFinish(v.view.weapon, v.view.finish);
        (window.__refFinished ??= []).push(v.view.weapon);
      }
      if (v.view.throwable) {
        window.__refThrowable ??= view.throwKind;
        view.setThrowable(v.view.throwable);
      }
      view.reset();
      view.setVisible(true);
      const p = { ...g.player.viewParams, adsBlend: v.view.aimed ? 1 : 0, ...(v.view.params ?? {}) };
      const pose = () => {
        for (let i = 0; i < 240; i++) view.update(1 / 60, p);
        // **A reload is drawn with the HEAD looking down at it**: `Player`
        // pushes the gesture's look and lean to the camera after the pose
        // (`CameraSystem.setReloadHead`), and the viewmodel's body node takes
        // the same turn back, so the weapon stays in the hands while the
        // world tips. The rendered camera is composed as `CameraSystem`
        // composes it — the look added to the pitch, the lean as the roll
        // (written after `setTarget`, which zeroes it) — and the passes are
        // placed again at the turned eye.
        const headPitch = view.reloadHeadPitch;
        const headRoll = view.reloadHeadRoll;
        if (headPitch !== 0 || headRoll !== 0) {
          const d = target.subtract(cam.position);
          const yaw = Math.atan2(d.x, d.z);
          const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) + headPitch;
          const cp = Math.cos(pitch);
          const look = new Vec3(cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw));
          cam.setTarget(cam.position.add(look));
          cam.rotation.z = headRoll;
          g.cameraSys.yaw = cam.rotation.y;
          g.cameraSys.pitch = cam.rotation.x;
          g.updateSceneForCamera(0, look.scaleInPlace(8).addInPlace(cam.position), null, []);
        }
      };
      pose();
      if (v.view.aimed) cam.fov = view.sight.fovAds;
      // **A held reload is posed off ITS OWN previous frame.** Its gravity is
      // the world's down through the weapon's world matrix
      // (`ViewModel.evaluateReload`), which Babylon answers from its render
      // cache — the matrix the LAST render composed, which straight after the
      // row before is that row's weapon. So one frame is rendered with this
      // pose up (the head turned) and the pose is run again, reading this
      // row's own frame, as a reload held in a round does every frame. The
      // weapon's pose does not depend on the gravity, so one frame is the
      // fixed point. Only a reload reads the cache (`evaluateReload` returns
      // before it otherwise), so no other row renders the extra frame.
      if (p.reloading || p.reloadBlend > 0.001) {
        await new Promise((res) => {
          const o = g.scene.onAfterRenderObservable.add(() => {
            g.scene.onAfterRenderObservable.remove(o);
            res();
          });
        });
        pose();
      }
      // One round fired: the flash's roll and scale are drawn at random, so
      // they are drawn from a seed. It burns down only in a stepped frame,
      // which a bank never runs, so it holds until the next row puts it away.
      if (v.view.flash) {
        seeded(0xf1a5, () => g.playerView.fired());
        window.__refFlash = true;
      }
    }

    // The effect pools (X4.4a): what `fx.events` raises, each through the
    // door the game raises it by, on ONE clock of fixed 1/60 s steps, and
    // every pool stepped in the order a frame steps them (`Game.stepShots`,
    // then `stepAftermath`, then the brass as `Player.update` steps it). The
    // frame is the last step: an event at `at` is `seconds - at` old in it.
    // Nothing else runs between the steps, and no frame is rendered among
    // them, so the pose is a function of the row alone.
    //
    // **Every random a pool draws is a picture's `Math.random`**, seeded
    // here for the whole timeline. The SOUND draws from it too, and gates
    // what it draws on the audio clock and its voice count, which no two
    // runs share — so each `Sfx` call made inside the timeline is handed
    // the real `Math.random` for its length, and the pictures' stream does
    // not move with it. The sound still plays; nothing it does reaches a
    // pixel. The rubble and the shards draw from their own seeded streams
    // (`BlastDebrisSystem.rand`, `DebrisSystem`'s), which the put-away above
    // re-seeds, and their bodies are stepped by Havok at the game's own
    // fixed substep, which carries no remainder from a lull.
    if (v.fx) {
      const fx = v.fx;
      window.__refFx = { stowed: g.playerView.hidden };
      const M = await import("/src/math/index.ts");
      const ROUND_RANGE = (await import("/src/config/index.ts")).CONFIG.weapons.rifle.range;
      const floorAt = (x, z) => g.map.terrain.surfaceAt(x, z, true);
      const feet = floorAt(x, z);
      // The brass leaves the port as the render cache answers it
      // (`ViewModel.ejectPortWorld`) — the matrix the LAST render composed —
      // so a row that throws brass renders one frame with its pose up
      // first, the held reload's reason.
      if (fx.events.some((e) => e.brass)) {
        g.playerView.stowed(false);
        await new Promise((res) => {
          const o = g.scene.onAfterRenderObservable.add(() => {
            g.scene.onAfterRenderObservable.remove(o);
            res();
          });
        });
      }
      const B = (p) => new Vec3(p[0], p[1], p[2]);
      const raise = (e) => {
        if (e.round) {
          // `drawRounds` — the picture of a round with its own wall query,
          // so it stops where a resolved one would and the impact is the
          // surface it stopped on, the mark only on the static world. `to`
          // is what it is AIMED at; it flies on past it to the first thing
          // in its way, out to a rifle's range.
          const from = B(e.round.from);
          const d = B(e.round.to).subtract(from).normalize();
          g.combatFx.drawRounds(from, d, from, ROUND_RANGE, 1, 0);
        } else if (e.throw) {
          const t = e.throw;
          if (!g.grenades.throwAt(new M.Vector3(...t.from), new M.Vector3(...t.to), 0, null, t.kind)) {
            throw new Error("the grenade pool refused a throw");
          }
        } else if (e.rocket) {
          const r = e.rocket;
          if (!g.antiTank.launchToward(new M.Vector3(...r.from), new M.Vector3(...r.to), 0, null)) {
            throw new Error("the rocket pool refused a launch");
          }
        } else if (e.explode) {
          // The wire's `explode` arm: the six drawn layers, the light, the
          // noise, the rubble and the scorch (`Game.onExplosion`).
          g.onNetEvent({ e: "explode", at: [...e.explode.at], power: e.explode.power ?? 1 });
        } else if (e.blaze) {
          // The wire's `blaze` arm: the flames, the ignition, and through
          // `Game.fireLit` the light, the noise and the mark.
          g.onNetEvent({ e: "blaze", at: [...e.blaze.at] });
        } else if (e.shards) {
          // A pane's burst as `GlassSystem.onBreak` hands it over — the
          // sheet left standing, since a broken pane never mends in a round.
          const pane = g.map.panes[e.shards.pane];
          if (!pane) throw new Error(`no pane ${e.shards.pane}`);
          const dir = B(e.shards.dir).normalize();
          if (!g.debris.burst(pane, B(e.shards.at), dir, cam.position)) {
            throw new Error("the pane's burst was refused (past its gate, or the pool full)");
          }
        } else if (e.breaks) {
          // A REAL break's picture, through the two callbacks `Game` wires
          // (`GlassSystem.onBroken`, then `onBreak`, in that order): the range
          // collapsed, the shards, the sound. `g.glass`'s own state is not
          // written, so the pane's box stays in the queries and the nav graph
          // and the put-away can stand the sheet up again; only the picture of
          // a break is under test. The range is stashed before the collapse.
          const pane = g.map.panes[e.breaks.pane];
          if (!pane || pane.group < 0) throw new Error(`no drawn pane ${e.breaks.pane}`);
          const group = g.map.paneGroups[pane.group];
          const surface = g.glassDraw.surfaces.find((s) => s.record === group.record);
          const range = surface ? g.glassDraw.readPositions(surface, pane.vertexStart, pane.vertexCount) : null;
          if (!range) throw new Error(`pane ${e.breaks.pane} has no writable range in the glazing draw`);
          (window.__refFx.collapsed ??= []).push({ surface, first: pane.vertexStart, range });
          g.glass.onBroken(e.breaks.pane);
          g.glass.onBreak(e.breaks.pane, new M.Vector3(...e.breaks.at), new M.Vector3(...e.breaks.dir).normalize());
        } else if (e.blob) {
          // A body's contact shadow placed by the door a frame places one by
          // (`ShadowSystem.updateBlobs`), its fade toward the fog the door's own.
          // No frozen frame reaches that door, so without this no row holds a
          // blob. The body is a stand-in with only what the door reads, kept for
          // the boot so a later row reuses its mesh; `y` is the floor it stands
          // on, and the door lifts the disc off it.
          const bodies = (window.__refBlobBodies ??= []);
          const n = window.__refFx.blobs ?? 0;
          const [bx, by, bz] = e.blob.at;
          // A body's FIRST blob drew 31 numbers off `Math.random` while it was a
          // Babylon mesh (`Geometry.RandomId`, counted at X4.6e's BEFORE: 31 the
          // first time, none after), and a row's pictures run on the seeded
          // stream below, so the marks a later round of the row leaves rolled
          // off where those draws left it. Our renderer's blob is no mesh
          // (`BABYLON_EXIT.md` X4.6e) and draws none, so they are drawn here, in
          // the same place, and the banked frame's marks stay where they were.
          if (!bodies[n]) for (let i = 0; i < 31; i++) Math.random();
          const body = (bodies[n] ??= { alive: true, position: { x: 0, y: 0, z: 0 } });
          body.position.x = bx;
          body.position.y = by;
          body.position.z = bz;
          g.shadows.updateBlobs(body, [], cam.position, by);
          window.__refFx.blobs = n + 1;
        } else if (e.brass) {
          g.playerView.fired();
        } else if (e.drawn) {
          // A round's picture as `CombatSystem.onRound` hands it over: no
          // wall query, the impact at `to` of the stated kind, and no mark.
          const d = e.drawn;
          g.combatFx.drawRound(B(d.from), B(d.to), d.kind, d.normal ? B(d.normal).normalize() : null, false);
        }
      };
      const sfx = g.sfx;
      const native = Math.random;
      g.sfx = new Proxy(sfx, {
        get(target, key) {
          const f = target[key];
          if (typeof f !== "function") return f;
          return (...a) => {
            const pictures = Math.random;
            Math.random = native;
            try {
              return f.apply(target, a);
            } finally {
              Math.random = pictures;
            }
          };
        },
      });
      try {
        seeded(0x44a, () => {
          const steps = Math.round(fx.seconds * 60);
          const due = fx.events.map((e) => Math.round(e.at * 60));
          const dt = 1 / 60;
          for (let i = 0; i < steps; i++) {
            fx.events.forEach((e, k) => {
              if (due[k] === i) raise(e);
            });
            g.combatFx.update(dt);
            g.grenades.update(dt);
            g.grenadeFx.update(dt);
            g.pushFires();
            g.antiTank.update(dt);
            g.antiTankFx.update();
            g.physics.update(dt);
            g.ragdolls.update(dt);
            g.debris.update(dt);
            g.blastDebris.update(dt);
            g.playerView.stepped(dt, feet);
          }
        });
      } finally {
        g.sfx = sfx;
      }
      // A mine is the WIRE's in every round (the page never predicts one),
      // so a laid plate is put down as a `mines` message lays it, its lamp
      // lit or dark as the message says (`NetOrdnance.applyMines`).
      if (fx.mines) {
        g.net.ordnance.applyMines({
          t: "mines",
          mines: fx.mines.map((m, i) => ({ i, p: [...m.at], team: 0, by: -1, armed: m.armed })),
        });
      }
      // The wire's flights (somebody else's grenades and rockets), fed as
      // snapshots carry them and posed at the stated render times — the two
      // calls `NetSession` makes, the first on a snapshot's arrival and the
      // second every frame (which an offline bank boot never runs: the
      // session is held under the deploy card). `-2` is a local slot no
      // flight names, so nothing is skipped as this client's own.
      // Seeded like the clock, for the reason the clock is: a wire grenade
      // claimed by a fresh flight rolls its starting attitude off
      // `Math.random` (`GrenadeBody.begin`), a picture's draw.
      if (fx.wire) seeded(0x44b, () => {
        for (const w of fx.wire.snapshots) {
          const snap = {
            t: "snap",
            now: w.now,
            grenades: (w.grenades ?? []).map((q) => ({ i: q.i, p: [...q.p], by: -1, fuse: q.fuse, ...(q.k ? { k: q.k } : {}) })),
            rockets: (w.rockets ?? []).map((r) => ({ i: r.i, p: [...r.p], dir: [...r.dir], by: -1 })),
          };
          g.net.grenades.applySnapshot(snap, -2);
          g.net.ordnance.applySnapshot(snap, -2);
        }
        for (const t of fx.wire.poses) {
          g.net.grenades.update(t);
          g.net.ordnance.update(t);
        }
      });
    }

    // The MOTE FIELD in the air, which every other row switches off because it
    // runs on the wall clock (`freeze`). Three things make it a fixed picture:
    // the field is rebuilt under a seeded `Math.random`, which is where its
    // random textures come from (`Atmosphere.fit`, `GPUParticleSystem`'s
    // constructor) and, on its first step, its starting buffers; it is stepped
    // by hand through a fixed number of fixed steps inside a frame, Babylon's
    // own pre-warm (`animate(true)`, `render(true, true)`), so nothing reads
    // `getAnimationRatio`; and it is then HELD by a clock of zero, which moves
    // every mote by nothing and emits nothing, so each later frame draws the
    // same buffer. No frame may render it before those steps (a frame would
    // make its first step, unseeded, on the wall clock), so the particles are
    // off from the rebuild until they are done.
    if (v.motes) {
      const spec = g.mapDef.environment.particles;
      if (!spec) throw new Error(`${g.mapDef.id} states no particles`);
      const F = fields;
      F.enable(false);
      const air = g.atmosphere;
      air.capacity = 0;
      seeded(0xa5, () => air.apply(spec, g.map.size, g.map.size));
      air.update(cam.position);
      const ps = F.motes();
      // The field gathered into a box on the eye, at the map's own motes and
      // rate: the disc is a few degrees across and the field a valley, so the
      // map's own density puts about a tenth of a mote in front of it.
      const half = v.motes.box / 2;
      F.placeEmitter(ps, cam.position.x, 0, cam.position.z);
      ps.minEmitBox.x = ps.minEmitBox.z = -half;
      ps.maxEmitBox.x = ps.maxEmitBox.z = half;
      F.prime(ps);
      window.__refMotes = true;
      for (let frames = 0; !F.ready(ps); frames++) {
        if (frames > 1200) throw new Error("the mote field never became ready");
        await new Promise((res) => {
          const o = g.scene.onAfterRenderObservable.add(() => {
            g.scene.onAfterRenderObservable.remove(o);
            res();
          });
        });
      }
      // The step's length is a mote's seconds, and it is stated here rather
      // than in `Atmosphere`: nothing but this row wants the field off its rate.
      ps.updateSpeed = v.motes.step;
      await new Promise((res) => {
        g.scene.onBeforeRenderObservable.addOnce(() => {
          seeded(0xa6, () => {
            for (let i = 0; i < v.motes.steps; i++) F.step(ps);
          });
          F.hold(ps);
          F.enable(true);
          res();
        });
      });
    }

    // THE PARTICLE FIELDS AS THE GAME RUNS THEM (X4.7a): the map's mote field
    // as it states it (its own box on the eye, its own rate, NOT gathered) and
    // a rotor's ring under the hull pinned above, each pinned as `motes` pins
    // the field: REBUILT under a seed, which is where its random textures come
    // from (both are built at an install, off the native stream), stepped by
    // the field's own pre-warm pair through `steps` fixed frames at a ratio of
    // 1 inside one frame under a second seed, which is where its first update
    // draws its slots' seeds, and HELD by a clock of zero. The rings are
    // DRIVEN through the game's own door, `RotorWash.update` told the fleet
    // stepped, before each step as a frame drives them, and the water told the
    // sites as `Game.followEye` tells it. **The particles drawn are exactly
    // the ones the row states**: every other field is held EMPTY (stopped and
    // reset, which stays empty under emit-rate control). The mote field is
    // rebuilt BEFORE the rings, the order an install builds them in
    // (`installMap`: `atmosphere.apply`, then `rotorWash.build`), so the
    // scene's list holds them in the order a shipped flow does.
    //
    // **Every touch of a field in THIS path goes through `fields`** (held as
    // `__refParticles.fields` for the put-away), the one adapter above, as the
    // `motes` row's path and `freeze`'s `particles` switch with its thaw do
    // since X4.7c: on a tree whose fields are ours (the ash since X4.7c, the
    // rings since X4.7d) they step, hold and switch OUR fields (`ParticleDraw`),
    // and at a parent drawing Babylon's they touch Babylon's, as before.
    if (v.particles) {
      const want = v.particles;
      const spec = g.mapDef.environment.particles;
      if (want.ash && !spec) throw new Error(`${g.mapDef.id} states no particles`);
      const F = fields;
      const P = (window.__refParticles ??= { hull: null, wet: false, speeds: [], fields: null });
      P.fields = F;
      F.enable(false);
      const stated = [];
      if (spec) {
        // Whether stated or emptied, the field is the row's: the put-away
        // rebuilds it as the map states it (`__refMotes`).
        window.__refMotes = true;
        if (want.ash) {
          g.atmosphere.capacity = 0;
          seeded(0xa5, () => g.atmosphere.apply(spec, g.map.size, g.map.size));
          g.atmosphere.update(cam.position);
          stated.push(F.motes());
        }
      }
      if (P.hull) {
        // A ring is rebuilt only for a new palette (`RotorWash.build`), so the
        // palette is forgotten and the fleet handed back: every ring disposed
        // and built again, for the map's own colours.
        g.rotorWash.palette = null;
        seeded(0xa7, () => g.rotorWash.build(g.vehicles.hulls, g.map.water, g.map.terrain, g.mapDef.environment));
        g.rotorWash.update(true, g.hullFades);
        const wash = g.rotorWash.washes.find((w) => w.hull === P.hull);
        const ring = F.ringsOf(wash).find(F.emits);
        if (!ring) throw new Error("the pinned hull raises no wash: too high, or over nothing");
        stated.push(ring);
      }
      for (const f of F.all()) {
        if (!stated.includes(f)) F.empty(f);
      }
      for (const ring of F.rings()) P.speeds.push([ring, F.speed(ring)]);
      for (const f of stated) F.prime(f);
      for (let frames = 0; !stated.every(F.ready); frames++) {
        if (frames > 1200) throw new Error("a stated field never became ready");
        await new Promise((res) => {
          const o = g.scene.onAfterRenderObservable.add(() => {
            g.scene.onAfterRenderObservable.remove(o);
            res();
          });
        });
      }
      await new Promise((res) => {
        g.scene.onBeforeRenderObservable.addOnce(() => {
          // In the frame's order: the scene's list, the fields the row states.
          const order = F.all().filter((f) => stated.includes(f));
          seeded(0xa6, () => {
            for (let i = 0; i < want.steps; i++) {
              if (P.hull) g.rotorWash.update(true, g.hullFades);
              for (const f of order) F.step(f);
            }
          });
          for (const f of order) F.hold(f);
          if (P.wet) g.water.setWash(g.rotorWash.sites, g.rotorWash.siteCount);
          F.enable(true);
          res();
        });
      });
    }

    // The kit screen, raised for real over `deploy`: the card, the bench lamps
    // and the glow's stage rule are the lid's, and the weapon is on the
    // turntable at its authored angles, posed every frame by the lid itself
    // (`Game.updateKitStage`). The one thing stated is the BAY, which the DOM
    // measures and this boot has hidden — so `stageBay` is answered with the
    // row's.
    if (v.kit) {
      const view = g.player.view;
      view.setWeapon(v.kit.weapon);
      view.setSight(v.kit.sight);
      if (v.kit.finish) {
        view.setFinish(v.kit.weapon, v.kit.finish);
        (window.__refFinished ??= []).push(v.kit.weapon);
      }
      view.reset();
      const bay = { ...v.kit.bay };
      g.loadoutScreen.stageBay = () => bay;
      window.__refBay = true;
      g.openLoadout();
      if (g.state !== "loadout") throw new Error(`the kit screen would not go up over ${g.state}`);
    }
  }, vantage));
}

/**
 * The post chain's CPU half, reached through ONE adapter (`window.__refPost`,
 * `BABYLON_EXIT.md` X5.2a), so `freeze`, `thaw` and `placeVantage` name no
 * field of `Game`'s for it: the GRADE (`PaperGrain`: its `update` decays the
 * damage flash, and it has no clock — the `g.post.time = 0` this file used to
 * write was a stale no-op, X5.2a), the SHAFTS (`Volumetrics`, null while the
 * setting is off; its `update` is a pure read of the camera) and the BLUR
 * (`MotionBlur`: its `update` is the CPU history it reprojects against), and
 * the damage FLASH a row may hold (`flash`), and whether the chain's every
 * pass can draw (`ready`, asked by `waitUntilDrawn` beside `scene.isReady()`).
 * **OURS is picked first since X5.2c1** (`g.postChain`: the grade is a stage
 * of our post chain, its pipelines' readiness `PostChain.drawsReady`, its CPU
 * half still `g.post`), BABYLON's arm at a parent before it; since X5.2c2
 * the shafts and the blur are stages of the same chain, reached with the same
 * members — each part an object whose `update` the freeze replaces and the
 * thaw puts back on that SAME object — so the freeze reads the same whoever
 * draws.
 * **A part is read FRESH at every call and may be a different object at the
 * next**: the shafts are rebuilt on every rung change and on every off to on
 * (`Game.setVolumetrics`), so nothing here or in its callers may hold one
 * across a freeze (`freeze`'s `__refPostStubs`, X5.2a's held finding F1).
 * Installed by the first call that needs it; idempotent.
 *
 * **Not `post.mjs`'s `postAdapter`**, which shares the name and the shape:
 * that one (`window.__postGpu`, on a probe's page only) names the chain's
 * GPU modules and textures for `post.mjs`'s log; this one is the CPU half the
 * bank holds. Each has OURS, picked first, under the same names as
 * Babylon's: that one for each stage a sub-step moved (the glow's blur from
 * X5.2b, the grade from X5.2c1), this one since the grade moved (X5.2c1,
 * above).
 */
function postAdapter() {
  window.__refPost ??= () => {
    const g = window.__celshock;
    // OURS, picked first (X5.2c1): the grade is a stage of our post chain
    // (`g.postChain`, `render/PostChain.ts`), its CPU half still `g.post`
    // (`PaperGrain`: the same `update`, `flashDamage` and `damage`), and the
    // chain's readiness is OUR pipelines', which `scene.isReady()` no longer
    // covers (`ready`, asked by `waitUntilDrawn`). Since X5.2c2 the shafts
    // and the blur are stages of the same chain, their CPU halves the same
    // objects as before (`g.volumetrics`, rebuilt on a rung change, and
    // `g.motionBlur`), with the same `update`s, so ours reaches them as
    // Babylon's arm did; `ready` covers their pipelines with the grade's.
    if (g.postChain) {
      return {
        arm: `ours:${[...new Set(g.postChain.stages.map((st) => st.name))].join(",")}`,
        grade: g.post,
        shafts: g.volumetrics ?? null,
        blur: g.motionBlur,
        flash: (on) => {
          if (on) g.post.flashDamage();
          else if (g.post.damage !== 0) g.post.damage = 0;
        },
        ready: () => g.postChain.drawsReady(),
      };
    }
    return {
      arm: "babylon",
      grade: g.post,
      shafts: g.volumetrics ?? null,
      blur: g.motionBlur,
      // The red edge flash (`PaperGrain.flashDamage`) held at its kick, or
      // put back to none. Only a row that asks writes it on: none is the
      // value every state that simulates nothing already has.
      flash: (on) => {
        if (on) g.post.flashDamage();
        else if (g.post.damage !== 0) g.post.damage = 0;
      },
      // Every Babylon pass's effect is in `scene.isReady()` (the camera's
      // post-processes), which `waitUntilDrawn` asks beside this.
      ready: () => true,
    };
  };
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
 * whole of cross-run reproducibility.** The sky's turn and `mats.windTime`
 * (and, when this was written, the grade's `time` and each cloud deck's
 * `uOffset`, all three gone since) are accumulators: they advance by `dt` every
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
 * freeze cannot record its own no-ops as the real methods. That stash is ONCE
 * PER PAGE, so it may hold only objects that live as long as the page does.
 *
 * **The post chain's three are reached through `postAdapter`, and are NOT in
 * that stash**: each part this freeze stubs is recorded at THIS freeze, with
 * the real updater read off that same part before its stub
 * (`__refPostStubs`), and `thaw` restores every part recorded. The stash used
 * to hold them, once per page, with the object each came off, and the thaw
 * restored a part only while it was still that object — but the shafts are
 * REBUILT on every rung change and every off to on (`Game.setVolumetrics`),
 * so after the first one the live pass was stubbed by a freeze and never
 * given its `update` back: every later row converged with
 * `syncVolumetrics`'s `vol.update()` doing nothing, its shafts drawn with the
 * basis and the FOV of the last row whose pass was fresh, and a page whose
 * first freeze found the shafts off never restored them at all
 * (`BABYLON_EXIT.md` X5.2a's held finding F1). The grade and the blur are
 * built once per page today and were never hit; they are held the same way,
 * so a port that rebuilds either is no different. `damage` (a row's
 * `damage`) holds the grade's flash at its kick under the stubbed decay,
 * raised here, after the settle and not before it, because the real `update`
 * decays it by the frame's `dt` (`BABYLON_EXIT.md` X5.2a).
 */
export function freeze(page, set = FREEZE_SET, { windTime = 0, turn = 0, strike = null, damage = false } = {}) {
  // Its sweeps' own cap counts frames, so it cannot fire when they stop.
  return limited("freeze", 1_800_000, page.evaluate(postAdapter).then(() => page.evaluate(async ([f, wind, blurTurn, sweeps, strikeAt, flash]) => {
    const g = window.__celshock;
    const post = window.__refPost();
    // The real updaters, recorded ONCE per page — so only of objects the page
    // keeps for its whole life, which the post chain's are not. See `thaw`.
    window.__refThaw ??= {
      sky: g.sky.update,
      lightning: g.lightning.step,
      lighting: g.lighting.update,
      gi: g.gi.update,
      wind: g.mats.updateWind,
      grass: g.grass?.update,
      water: g.water?.update,
    };
    // The post chain's parts, recorded at EVERY freeze rather than once a
    // page (the header's F1): each part stubbed, keyed by the object itself,
    // with the real updater read off THAT object before its stub and whether
    // it was the object's own property or its class's. A part already stubbed
    // (a second freeze with no thaw between) keeps its first record, so a
    // stub is never recorded as the real method. `thaw` restores every part
    // here, the live one or one the game has since replaced, and empties it.
    window.__refPostStubs ??= new Map();
    const stubs = window.__refPostStubs;
    const realOf = (part) => stubs.get(part)?.fn ?? part.update;
    const stub = (part) => {
      if (!stubs.has(part)) stubs.set(part, { own: Object.hasOwn(part, "update"), fn: part.update });
      part.update = () => {};
    };
    // The irradiance volume's dispatches, counted through ONE adapter
    // (`BABYLON_EXIT.md` X5.1a; the `gi` block below and `thaw` read it).
    // BABYLON's arm: every `ComputeShader` named `gi-*` (`GiVolume`'s three)
    // counted at its `dispatch`, wrapped once on the class's prototype, which
    // is reached off a live one — none exists at `off`, where nothing
    // dispatches and the `gi` block does not run. **The arm answers only for
    // Babylon's own objects**: every one of `trace`, `compose` and `vis` that
    // is set must be a `ComputeShader` (its `getClassName()`), named `gi-*`,
    // whose prototype has a `dispatch` of its own; anything else in any of
    // the three — a port that kept a `trace` field holding its own pipeline —
    // answers null, as no arm at all does. **OURS is picked first** (X5.1b):
    // `g.gi.gpu.recorded`, the frames `GiCompute`'s late prepare recorded the
    // volume's passes on — counted where they are RECORDED, so a dispatch
    // armed under the stub and recorded would move it too. The freeze throws
    // on null, so a port that forgets its arm fails at the first row rather
    // than counting a dispatch nobody makes and holding every row vacuously.
    // **Ours is not TRUSTED, it is checked LIVE** (X5.1b's review): a
    // regression that stopped incrementing `recorded` would read a constant
    // and hold every row vacuously, the hole X5.1a's review closed for
    // Babylon's arm. So the arm counts the volume's passes a second way —
    // `GPUComputePassEncoder`'s `setPipeline` and `dispatchWorkgroups`
    // wrapped once on the prototype, a dispatch counted when its pass's
    // pipeline is one of `GiCompute`'s own (`traces`, `composes`,
    // `visPipeline`: the trace, compose and vis) — and THROWS unless every
    // call finds trace, compose and vis each dispatched exactly as many times
    // as `recorded` moved since the arm's first call. It answers null when
    // those three fields are not there to identify the passes by, which the
    // freeze turns into a throw like any missing arm. Nothing under `src/`
    // is touched: the wrap sees the calls the page makes and passes them on.
    window.__refGiCount ??= () => {
      const ours = g.gi.gpu;
      if (ours && typeof ours.recorded === "number") {
        const CPE = window.GPUComputePassEncoder?.prototype;
        if (!CPE || !(ours.traces instanceof Map) || !(ours.composes instanceof Map) || !("visPipeline" in ours)) {
          return null;
        }
        if (!CPE.__refGiOurs) {
          const setPipeline = CPE.setPipeline;
          const dispatchWorkgroups = CPE.dispatchWorkgroups;
          const pipelineOf = new WeakMap();
          CPE.setPipeline = function (...a) {
            pipelineOf.set(this, a[0]);
            return setPipeline.apply(this, a);
          };
          CPE.dispatchWorkgroups = function (...a) {
            const c = window.__refGiOurs;
            const p = pipelineOf.get(this);
            if (c && p) {
              const gpu = c.gpu;
              if (p === gpu.visPipeline) c.vis++;
              else if ([...gpu.traces.values()].includes(p)) c.trace++;
              else if ([...gpu.composes.values()].includes(p)) c.compose++;
            }
            return dispatchWorkgroups.apply(this, a);
          };
          CPE.__refGiOurs = true;
        }
        let c = window.__refGiOurs;
        if (!c || c.gpu !== ours) {
          c = window.__refGiOurs = { gpu: ours, base: ours.recorded, trace: 0, compose: 0, vis: 0 };
        }
        const moved = ours.recorded - c.base;
        if (c.trace !== moved || c.compose !== moved || c.vis !== moved) {
          throw new Error(
            `__refGiCount: GiCompute.recorded moved ${moved} while the volume's passes were dispatched ` +
              `trace ${c.trace}, compose ${c.compose}, vis ${c.vis} times — the count is not live`,
          );
        }
        return ours.recorded;
      }
      const set = [g.gi.trace, g.gi.compose, g.gi.vis].filter((x) => x !== null && x !== undefined);
      const babylons = (cs) =>
        typeof cs.getClassName === "function" &&
        cs.getClassName() === "ComputeShader" &&
        String(cs.name).startsWith("gi-") &&
        typeof Object.getPrototypeOf(cs).dispatch === "function";
      if (!set.length || !set.every(babylons)) return null;
      const cs = set[0];
      const proto = Object.getPrototypeOf(cs);
      if (!proto.__refGiCounted) {
        const dispatch = proto.dispatch;
        proto.dispatch = function (...a) {
          if (String(this.name).startsWith("gi-")) window.__refGiDispatches = (window.__refGiDispatches ?? 0) + 1;
          return dispatch.apply(this, a);
        };
        proto.__refGiCounted = true;
      }
      return window.__refGiDispatches ?? 0;
    };
    if (f.includes("post")) {
      // The grade has NO clock (its paper is pinned to the world, not to a
      // time), so holding it is stopping the damage flash's decay — and a row
      // that asks for the flash has it raised here, under the stub.
      stub(post.grade);
      if (flash) post.flash(true);
    }
    if (f.includes("sky")) {
      // **The cloud ring's TURN is the sky's clock** — `Sky.update`
      // accumulates it from boot offline, and the clouds' shadow on the ground
      // is stepped off it — so it is a constant like the others, pushed once
      // through the real updater before it is halted. The shadow's fields are
      // re-primed at that turn rather than left mid-crossfade, and the lumps
      // re-sorted for it. (This line used to zero two cloud textures' scroll
      // offsets, which no longer exist: the clouds became a ring of masses
      // standing in the world, the bank was not re-taken, and the turn went
      // unpinned.)
      g.sky.turn = 0;
      g.sky.shadowPrimed = false;
      g.sky.sortedTurn = Infinity;
      window.__refThaw.sky.call(g.sky, 0, g.cameraSys.camera.position, null);
      g.sky.update = () => {};
    }
    // Belt and braces rather than a clock: `Volumetrics.update` is a pure read
    // of the camera's basis and FOV and carries no state of its own, so a held
    // camera already holds it. It stays in the set because the set is "what
    // `tick` runs", and a pass that is exempt today is one somebody gives a
    // clock to tomorrow.
    if (f.includes("shafts") && post.shafts) stub(post.shafts);
    if (f.includes("blur")) {
      // A row may ask for the blur IN FLIGHT: the real updater shown the aim
      // `turn` radians to the left and then where it is, which is one frame of
      // a head turning at that rate, and then held — so the pass's matrix is
      // a function of the row and not of a camera nobody can make move
      // between two grabs. At 0 it is held at rest, which is inert.
      //
      // **At rest it is still shown the aim ONCE at a stated 1/60 s**
      // (`BABYLON_EXIT.md` X5.2a): the pass's `maxShift` uniform is the
      // config's rate times the `dt` of the last real `update`, which is the
      // machine's frame time, so a held pass otherwise carried a uniform no
      // two processes agree on (`post.mjs` found it, 0.01896 against 0.0192).
      // It moves no pixel — at rest the strength is 0 and the pass is a
      // straight copy — but it is a byte the pass is handed. A camera that
      // has stood still through the settle sweeps nothing, so the strength
      // stays 0.
      const yaw = g.cameraSys.aimYaw;
      const pitch = g.cameraSys.aimPitch;
      if (blurTurn) {
        realOf(post.blur).call(post.blur, yaw - blurTurn, pitch, 1 / 60);
        realOf(post.blur).call(post.blur, yaw, pitch, 1 / 60);
      } else {
        realOf(post.blur).call(post.blur, yaw, pitch, 1 / 60);
      }
      stub(post.blur);
    }
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
        if (g.grass.values) g.grass.values.time[0] = wind;
        g.grass.update = () => {};
      }
      if (g.water) {
        // **The clock is the shared block's since X4.6d, and it was a material's
        // field before it.** Written once as `body.material` this line was an
        // optional chain onto `undefined` — it threw nothing, reported nothing and
        // pinned nothing, leaving the water HALTED at whatever clock the run booted
        // with, which is the exact trap the paragraph above exists to name. It
        // survived because the four menu vantages barely have water in them;
        // the millpond and the marsh are in the set so that it cannot again. The
        // chain stays for a BEFORE taken at a tree whose water is Babylon's.
        g.water.time = wind;
        for (const body of g.water.bodies ?? []) body.mat?.setFloat?.("time", wind);
        if (g.water.values) g.water.values.time[0] = wind;
        g.water.update = () => {};
      }
    }
    // A row asking for the motes, or for the fields as the game runs them
    // (`particles`), has them posed and held by now (`placeVantage`). The
    // switch is both lists' (`placeVantage`'s `fields.enable`): Babylon's
    // `scene.particlesEnabled`, and since X4.7c ours beside it
    // (`ParticleDraw.enabled`), the same at the thaw.
    if (f.includes("particles")) {
      const on = Boolean(window.__refMotes || window.__refParticles);
      g.scene.particlesEnabled = on;
      if (g.particleDraw) g.particleDraw.enabled = on;
    }
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
      // …and HELD there. No frame of `deploy` updates the lights, but the kit
      // screen does, every frame (`Game.updateKitStage`, which is how its
      // bench lamps get their slots), and each of those would step the flame
      // clock on by `dt`. So while frozen every update is handed a dt of 0:
      // the slots are still dealt, and the clock does not move.
      g.lighting.update = (dt, eye, mats) => window.__refThaw.lighting.call(g.lighting, 0, eye, mats);
    }
    if (f.includes("lightning")) {
      // A storm's clock runs in `deploy` — `worldHeld` is false there offline,
      // since nothing is behind the card to hold — so a strike could land
      // between two grabs. Held with NO strike in the air rather than at a
      // constant time, because a frame lit by a flash is a frame of one
      // sixtieth of a second nobody else can reproduce at a different phase.
      g.lightning.active = false;
      g.lightning.flash = 0;
      // A row may ask for a strike IN THE AIR (`strike`): the map's own
      // schedule read once at that clock, which is a pure function of the map's
      // seed and the clock, and held there. Its map is drawn here because
      // `pushLightning` draws it on the frame a strike starts, and the frames
      // that follow this one see a strike already up. Asked of the eye so the
      // map falls where the row looks rather than where the install stood.
      if (strikeAt !== null) {
        window.__refThaw.lightning.call(g.lightning, 0, false, strikeAt);
        if (!g.lightning.active) throw new Error(`no strike is in the air at ${strikeAt}`);
        g.shadows.flash(g.lightning.direction, g.cameraSys.camera.position);
      }
      g.lightning.step = () => {};
    }
    if (f.includes("gi") && g.gi.tier) {
      // **The irradiance volume re-traces a rolling slice of itself every
      // frame, and that was the clock nobody had pinned** — what stopped the
      // bank reproducing any frame at all until `BABYLON_EXIT.md` X0.1. Its
      // ray set is fixed, so a still world converges to a fixed point; but the
      // multi-bounce term gets there a factor of the albedo per SWEEP, a sweep
      // is ~72 frames at the steady budget, and a frame shot thirty-six frames
      // after a teleport was photographed half way through one: 7% of
      // Greyfen's pixels, up to 78/255, between two consecutive grabs.
      // So the volume is re-swept at its WARM budget from a cursor of zero,
      // `GI_SWEEPS` times — after everything it traces has been pinned, so it
      // converges onto the frame being photographed — and then held. A
      // converged history is a function of the world and not of how it got
      // there, which is what makes it the same across processes.
      const gi = g.gi;
      const total = gi.tier.columns * gi.tier.columns * gi.tier.layers;
      gi.cursor = 0;
      gi.warmFrames = gi.sweepFrames(gi.tier, total) * sweeps;
      const cap = gi.warmFrames * 4 + 120;
      let frames = 0;
      while (gi.warmFrames > 0) {
        if (++frames > cap) throw new Error("the irradiance volume never finished its sweeps");
        await new Promise((res) => {
          const o = g.scene.onAfterRenderObservable.add(() => {
            g.scene.onAfterRenderObservable.remove(o);
            res();
          });
        });
      }
      gi.update = () => {};
      // **THE HOLD IS THE STUB, and that is a contract the port keeps**
      // (`BABYLON_EXIT.md` X5.1a). This block touches the volume through the
      // fields `GiVolume`'s CPU half owns — `tier`, `cursor`, `warmFrames`,
      // `sweepFrames()` and `update` — and nothing GPU-side, so it reads the
      // same whoever records the volume's passes. What it RELIES on is that a
      // frame whose `update` did not run dispatches nothing: today the three
      // dispatches are inside `update` (Babylon's `ComputeShader.dispatch`);
      // a port that records them anywhere else (a prepare of ours) records
      // them only on a frame `update` ARMED. That is checked, not assumed:
      // the volume's dispatches are counted through one adapter and the count
      // taken here must still stand at the thaw (`thaw`).
      window.__refGiHeld = window.__refGiCount();
      if (window.__refGiHeld === null) {
        throw new Error("freeze: no adapter counts the irradiance volume's dispatches (window.__refGiCount)");
      }
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
      //
      // Since X3.6c a map's bake may be our renderer's, spent over frames
      // (`CONFIG.graphics.reflection.probesPerFrame`), so the install's probes
      // are queued again on whichever path the bake took and waited out here
      // rather than left to the caller's settle (`ReflectionSystem.rebake`).
      const r = g.reflections;
      if (r.rebake) {
        r.rebake();
        for (let frames = 0; r.bakePending > 0; frames++) {
          if (frames > 600) throw new Error("the re-bake never drained");
          await new Promise((res) => {
            const o = g.scene.onAfterRenderObservable.add(() => {
              g.scene.onAfterRenderObservable.remove(o);
              res();
            });
          });
        }
      } else {
        for (const p of r.probes ?? []) p.cubeTexture.resetRefreshCounter();
        for (const p of r.waterProbes ?? []) p.cubeTexture.resetRefreshCounter();
      }
    }
  }, [set, windTime, turn, GI_SWEEPS, strike, damage])));
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
    // The volume held by the stub dispatched nothing while it was held (the
    // `gi` block's contract). Read before `update` is put back.
    if (window.__refGiHeld !== undefined) {
      const held = window.__refGiHeld;
      delete window.__refGiHeld;
      const now = window.__refGiCount();
      if (now === null) {
        throw new Error("thaw: no adapter counts the irradiance volume's dispatches any more (window.__refGiCount)");
      }
      if (now !== held) {
        throw new Error(`thaw: the irradiance volume dispatched ${now - held} times while its update was stubbed`);
      }
    }
    // The post chain's parts: every one the freezes since the last thaw
    // stubbed, each given back the updater read off IT — the live part, or
    // one the game has replaced since, which is harmless — and then
    // forgotten, so a part the game rebuilds is one the next freeze records
    // afresh (`freeze`'s header, F1). Restored exactly: a class's method by
    // deleting the stub so it shows through, an own property assigned back.
    for (const [part, real] of window.__refPostStubs ?? []) {
      if (real.own) part.update = real.fn;
      else delete part.update;
    }
    window.__refPostStubs?.clear();
    g.sky.update = s.sky;
    g.lightning.step = s.lightning;
    g.lighting.update = s.lighting;
    g.gi.update = s.gi;
    g.mats.updateWind = s.wind;
    if (g.grass && s.grass) g.grass.update = s.grass;
    if (g.water && s.water) g.water.update = s.water;
    g.scene.particlesEnabled = true;
    if (g.particleDraw) g.particleDraw.enabled = true;
  });
}

/**
 * Lets `n` rendered frames pass. The settle AFTER readiness, never instead of it.
 * The limit is the header's, roomy enough for a Chromebook's half a frame a second.
 */
export function settle(page, n = 6, limitMs = Math.max(120_000, n * 5_000)) {
  return limited(`settle(${n})`, limitMs, page.evaluate(async (frames) => {
    const g = window.__celshock;
    let seen = 0;
    await new Promise((res) => {
      const o = g.scene.onAfterRenderObservable.add(() => {
        if (++seen < frames) return;
        g.scene.onAfterRenderObservable.remove(o);
        res();
      });
    });
  }, n));
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

/**
 * What a picture taken here was taken ON: the Chromium build, the Playwright
 * that drove it, the adapter WebGPU handed out, and the GPU driver where the
 * machine will say. `bank.mjs` writes it into `ref/mode.json` beside the mode,
 * so a bank that goes red after an update says which update.
 *
 * The adapter is asked on the dev server's origin, because `navigator.gpu` is
 * a secure-context property and `about:blank` has none (`VERIFYING.md`). The
 * driver is asked of `nvidia-smi`, the only vendor tool any machine here has
 * had, and is null where it is absent — a Chromebook's SwiftShader has no
 * driver to name, and the adapter row already says so.
 */
export async function describeStack(browser, url) {
  const { createRequire } = await import("node:module");
  const { execFileSync } = await import("node:child_process");
  const require = createRequire(import.meta.url);
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter();
    if (!a) return null;
    const i = a.info ?? {};
    return {
      vendor: i.vendor ?? "",
      architecture: i.architecture ?? "",
      device: i.device ?? "",
      description: i.description ?? "",
    };
  });
  await page.close();
  let gpuDriver = null;
  try {
    gpuDriver = execFileSync("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // No such tool on this machine: see the doc comment.
  }
  return {
    chromium: browser.version(),
    playwright: require("playwright/package.json").version,
    adapter,
    gpuDriver,
  };
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
