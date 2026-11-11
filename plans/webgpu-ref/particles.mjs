/**
 * The GPU particle fields' CPU half, logged frame by frame in a LIVE frame loop:
 * what `BABYLON_EXIT.md` X4.7c and X4.7d must reproduce bit for bit when the ash
 * and the rotor wash become ours, read off the parent rather than argued.
 *
 * Run with `node plans/webgpu-ref/particles.mjs [map...] [--frames=N] [--out=f.json]
 * [--against=f.json]`. Several maps are played in ONE boot, in the order
 * given, through the menu as a player rotates them (`Game.enterMenu`, `setMap`,
 * `startRound`), so `sarab cinderhaven sarab hollowmere cinderhaven` is the
 * rotation the plan asks about. Nothing in the repository is written but `--out`.
 *
 * **Why a log and not a frame.** No live frame's pixels reproduce (the bank's
 * whole apparatus exists because they do not), but a field's CPU half is a pure
 * function of its numbers and its clock: the emission accumulator, the live
 * count, the circular write pointer, the emit range handed to the update shader,
 * the step, the emitter. The GPU's state is a function of those (the update shader
 * reads its random textures by slot, seed and count), so a port whose CPU half is
 * equal to Babylon's by `Object.is` on every frame, and whose shader is Babylon's
 * as compiled, draws Babylon's field. `--against` makes that comparison, field by
 * field and frame by frame, and names the first number that differs.
 *
 * **What makes two runs comparable.** The clock is a SCHEDULE, not the wall
 * clock: through the window the frame's delta (`getDeltaTime`, the one
 * number `Scene.animate` reads — the engine's, and since `BABYLON_EXIT.md`
 * X5.4g our loop's clock's, which our frame's port of `Scene.animate`'s
 * arithmetic reads, `SceneFrame.animationRatio`) is answered by frame, counted from the window's
 * first, 16.7 ms on most frames, 0.25 ms on the thirtieth of every sixty and
 * 1,500 ms on the sixtieth, and the scene computes its animation ratio off it
 * by its own path — **the 1..1000 ms clamp included** (`Scene.MinDeltaTime`,
 * `MaxDeltaTime`), so the ratio a frame reads is 1.002, 0.06 (clamped up from
 * 0.015) or 60 (clamped down from 90). A port whose clock skips the clamp, or
 * reads a clock of its own, logs another `timeDelta` on those frames. (Until
 * X4.7a's review the window ran under `scene.useConstantAnimationDeltaTime`,
 * which skips the clamp and so could not catch that.) Nothing in `Game` steps
 * by that number: the world is stepped by `FrameCap`'s refresh stamps, the
 * delta read only for the readout. Before the window, waiting for the fields
 * to be ready with the particles off, the scene's constant 16 ms holds. Each
 * map's window opens from a KNOWN state: every field reset (`reset()`, the CPU
 * half zeroed) with the particles off, the camera and the hull pinned, and the
 * window's first frame is the first with every field READY (its effects
 * compiled), so a compile that takes three frames on one run and five on the
 * next moves nothing logged. The
 * world is the deploy screen's, HELD, with `Game.followEye` told the fleet
 * stepped (X4.2d's scratch `x42dr/wash.mjs` did the same): nothing moves the
 * camera, the hull or the eye the ash follows but this file. A map with a
 * flying hull pins its first one hovering 3 m over dry ground (30 m east of its
 * hardstanding) for `frames`, then over the deepest-bedded centre of a water
 * rect for `frames` more, the camera 40 m south of and 12 m above each; a map
 * without one logs the ash alone, the camera at its centre.
 *
 * **Logged beside the fields, every frame:** the rotors' water sites
 * (`RotorWash.sites`, `siteCount`) and what the water holds of them
 * (`WaterSystem.washCount`); and the GPU passes the frame began, in order (a
 * render pass by its first colour attachment's view and its load op, a compute
 * pass as `C`), between the draw phase's start and its end, so a field's
 * dispatch SPLITTING the main pass is counted (`splits`: a render pass on the
 * main pass's view, loaded, right after a compute pass). The particles-off
 * frames before the window are its control.
 *
 * **Logged at each install:** the scene's particle systems in order (the order
 * Babylon draws them in), and the `Math.random` draws each construction made
 * (`Atmosphere.build`, `RotorWash.buildRing`) and each first update after a
 * build or a reset (`_initialize`). (`--editor`, which ended the run with the
 * map editor's build and its rebuilds — X4.7c's flow, X4.7d's oracle at
 * 312dc44 — is retired with the editor at `BABYLON_EXIT.md` X5.3c, row "X5.3,
 * retire the editor", and refused.)
 *
 * Every touch of a field's STATE goes through one adapter (`window.__fields`),
 * which picks per field between `babylon` (Babylon's `GPUParticleSystem`s:
 * every field at a parent before `BABYLON_EXIT.md` X4.7c, the rotor wash at one
 * before X4.7d; none since) and `ours` (`ParticleDraw`'s fields: the ash since
 * X4.7c, the rotor wash too since X4.7d), the same seventeen columns off each;
 * `all` lists ours first, the order the frame draws them, so a BEFORE at the
 * parent runs this file unchanged and logs the same order.
 * **The draw counting is beside it**: the constructions are counted around the
 * game's own doors (`Atmosphere.build`, `RotorWash.buildRing`), whatever they
 * build; a Babylon field's first update by wrapping its `_initialize` on the
 * prototype that holds it, and one of OURS by wrapping
 * `ParticleDraw.initialize`, under the same label, so the two trees' logs name
 * the same entries. A field with neither (no `_initialize` in its chain and not
 * one of ours) is NOT wrapped: it is named in the log's `unwrapped` and on the
 * console, the probe goes on, and its first updates are simply absent — so
 * `--against` fails on them.
 *
 * **`--against`** compares, map by map, the order at deploy, the `Math.random`
 * draws of every construction and every first update (label and count), the
 * fields nobody could count, and then every logged number by `Object.is`. It
 * names the first difference and exits 1; a log with an `editor` record (an
 * older `--editor` run's) has it ignored, said on the console.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { bootMap, hardLimit, installRound, launchClient, root, startDevServer } from "./harness.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const FRAMES = Number(opt("frames", "240"));
const OUT = opt("out", "");
const AGAINST = opt("against", "");
if (args.includes("--editor")) {
  console.error("particles: --editor is retired with the map editor (BABYLON_EXIT.md X5.3c)");
  process.exit(2);
}
const maps = args.filter((a) => !a.startsWith("--"));
if (!maps.length) maps.push("cinderhaven");
hardLimit(600 + maps.length * 300);

const vite = await startDevServer(root);
const browser = await launchClient({ headed: false });
const { page, pageErrors, consoleErrors } = await bootMap(browser, vite.url, maps[0]);

// The GPU passes a frame begins, in order: an init script cannot reach a page
// that has already loaded, so the encoder's prototype is wrapped here, before
// the first round is built — every encoder is made after it.
await page.evaluate(() => {
  const ids = new WeakMap();
  let next = 0;
  const idOf = (v) => {
    if (!v) return "-";
    if (!ids.has(v)) ids.set(v, ++next);
    return ids.get(v);
  };
  window.__passes = [];
  const enc = GPUCommandEncoder.prototype;
  const render = enc.beginRenderPass;
  enc.beginRenderPass = function (desc) {
    const a = desc?.colorAttachments?.[0];
    window.__passes.push(a ? `R${idOf(a.view)}:${a.loadOp}` : `R-:${desc?.depthStencilAttachment?.depthLoadOp ?? "?"}`);
    return render.call(this, desc);
  };
  const compute = enc.beginComputePass;
  enc.beginComputePass = function (desc) {
    window.__passes.push("C");
    return compute.call(this, desc);
  };
});

// The adapter, the counters and the per-frame reader, once a boot.
await page.evaluate(() => {
  const g = window.__celshock;
  /** Babylon's fields: none since X4.7d; the rotor wash at a parent before it, and the ash too before X4.7c. */
  const babylon = {
    all: () => g.scene.particleSystems,
    enable: (on) => {
      g.scene.particlesEnabled = on;
    },
    ready: (f) => f.isReady(),
    reset: (f) => f.reset(),
    name: (f) => f.name,
    /** The CPU half: every number a frame's emission is made of. */
    state: (f) => {
      const e = f.emitter;
      return [
        f.isStarted() ? 1 : 0,
        f.isStopped() ? 1 : 0,
        f._buffer0 ? 1 : 0,
        f.emitRate,
        f._accumulatedCount,
        f._currentActiveCount,
        f._emitIndex,
        f._emitCount,
        f._writePointer,
        f._timeDelta,
        f._targetIndex,
        e.x,
        e.y,
        e.z,
        f.minEmitPower,
        f.maxEmitPower,
        f.updateSpeed,
      ];
    },
  };
  /**
   * OUR fields (`BABYLON_EXIT.md` X4.7c: the ash; X4.7d: the rotor wash —
   * `ParticleField`s that `ParticleDraw` steps and draws, in one list), the
   * same columns under their own names. Absent at a parent before X4.7c, where
   * every field is Babylon's.
   */
  const draw = g.particleDraw ?? null;
  const ours = draw
    ? {
        all: () => draw.fields,
        enable: (on) => {
          draw.enabled = on;
        },
        ready: (f) => draw.isReady(f),
        reset: (f) => draw.reset(f),
        name: (f) => f.name,
        state: (f) => {
          const e = f.emitter;
          return [
            f.isStarted() ? 1 : 0,
            f.isStopped() ? 1 : 0,
            f.initialized ? 1 : 0,
            f.emitRate,
            f.accumulatedCount,
            f.currentActiveCount,
            f.emitIndex,
            f.emitCount,
            f.writePointer,
            f.timeDelta,
            f.targetIndex,
            e.x,
            e.y,
            e.z,
            f.minEmitPower,
            f.maxEmitPower,
            f.updateSpeed,
          ];
        },
      }
    : null;
  const isOurs = (f) => ours !== null && draw.fields.includes(f);
  const pick = (f) => (isOurs(f) ? ours : babylon);
  /**
   * Every field, in the order the frame steps and DRAWS them: ours first (at
   * `"particles"`, ahead of Babylon's group), then Babylon's in its list's order.
   */
  const F = {
    all: () => [...(ours ? ours.all() : []), ...babylon.all()],
    enable: (on) => {
      babylon.enable(on);
      ours?.enable(on);
    },
    ready: (f) => pick(f).ready(f),
    reset: (f) => pick(f).reset(f),
    name: (f) => pick(f).name(f),
    state: (f) => pick(f).state(f),
  };
  window.__fields = F;
  window.__fieldColumns = [
    "started", "stopped", "initialized", "emitRate", "accumulated", "count", "emitIndex", "emitCount",
    "writePointer", "timeDelta", "targetIndex", "emitterX", "emitterY", "emitterZ", "minEmitPower", "maxEmitPower", "updateSpeed",
  ];
  // Math.random draws at each construction and each first update.
  const draws = [];
  window.__draws = draws;
  const counted = (label, fn) => {
    const native = Math.random;
    let n = 0;
    Math.random = () => {
      n++;
      return native();
    };
    try {
      return fn();
    } finally {
      Math.random = native;
      draws.push([label, n]);
    }
  };
  // A first update is Babylon's `_initialize`, wrapped once on the prototype
  // that holds it. A field with no `_initialize` in its chain (not Babylon's)
  // is named here and left alone, never a throw inside the game's build.
  let initWrapped = false;
  window.__unwrapped = [];
  const wrapInit = (f) => {
    if (initWrapped) return;
    let proto = f ? Object.getPrototypeOf(f) : null;
    while (proto && !Object.prototype.hasOwnProperty.call(proto, "_initialize")) proto = Object.getPrototypeOf(proto);
    if (!proto) {
      const what = `${f?.constructor?.name ?? typeof f} ${f?.name ?? ""}`.trim();
      if (!window.__unwrapped.includes(what)) window.__unwrapped.push(what);
      return;
    }
    initWrapped = true;
    const init = proto._initialize;
    proto._initialize = function (force = false) {
      if (this._buffer0 && !force) return init.call(this, force);
      return counted(`_initialize ${this.name} (capacity ${this._capacity})`, () => init.call(this, force));
    };
  };
  // A field of OURS has its first update counted where it is made, around
  // `ParticleDraw.initialize` under Babylon's own label, so the two trees'
  // logs name the same entry; it is never handed to `wrapInit`.
  if (draw) {
    const initialize = draw.initialize;
    draw.initialize = function (slot) {
      if (slot.buffers) return initialize.call(this, slot);
      return counted(`_initialize ${slot.field.name} (capacity ${slot.field.capacity})`, () => initialize.call(this, slot));
    };
  }
  const air = g.atmosphere;
  const build = air.build;
  air.build = function (capacity) {
    const f = counted(`construct motes (capacity ${capacity})`, () => build.call(this, capacity));
    if (!isOurs(f)) wrapInit(f);
    return f;
  };
  const rw = g.rotorWash;
  const ring = rw.buildRing;
  rw.buildRing = function (index, wet) {
    const f = counted(`construct rotor${wet ? "Spray" : "Wash"}${index} (buildRing)`, () => ring.call(this, index, wet));
    if (!isOurs(f)) wrapInit(f);
    return f;
  };
  // Every frame's record, taken after the render.
  window.__frame = () => {
    const rw = g.rotorWash;
    const sites = [];
    for (let i = 0; i < rw.siteCount * 4; i++) sites.push(rw.sites[i]);
    return {
      fields: F.all().map((f) => [F.name(f), ...F.state(f)]),
      siteCount: rw.siteCount,
      sites,
      waterWash: g.water.washCount,
      passes: window.__phasePasses,
      path: window.__path,
    };
  };
  // The passes between the draw phase's start and the frame's end, read after
  // the frame; and WHICH PATH the seam took (`babylonSeam.onMainPass`): group 0
  // of the main pass visited, or not (X4.5a's fallback), by the seam's own test.
  // Babylon's engine, the scene's (`harness.mjs`' `frameAdapter`): `Game.engine` at a parent, a `NullEngine` since X5.4h.
  const e = g.scene.getEngine();
  let target;
  let visited = false;
  // The draw phase through the frame adapter (`harness.mjs`, X5.4f: the
  // scene's observable on Babylon's arm, our frame's on ours).
  window.__refFrame().onDrawPhase(() => {
    window.__phaseStart = window.__passes.length;
    target = e._currentRenderTarget;
    visited = false;
  }, null);
  g.scene.onBeforeRenderingGroupObservable.add((info) => {
    if (info.renderingGroupId === 0 && e._currentRenderTarget === target) visited = true;
  });
  // The frame's draw through the frame adapter (`harness.mjs`, X5.4a).
  window.__refFrame().onDrawn(() => {
    window.__phasePasses = window.__passes.slice(window.__phaseStart ?? 0);
    window.__path = visited ? "group" : "fallback";
    window.__passes.length = 0;
    window.__phaseStart = 0;
  });
});

/** -0 and NaN do not survive JSON; every number is kept as `Object.is` would compare it. */
const enc = (x) =>
  typeof x === "number" ? (Object.is(x, -0) ? "-0" : Number.isNaN(x) ? "NaN" : x === Infinity ? "Inf" : x === -Infinity ? "-Inf" : x) : x;

/** Splits: a render pass on the main pass's view, LOADED, straight after a compute pass. */
function splits(passes) {
  const first = passes.find((p) => p.startsWith("R"));
  if (!first) return { renderPasses: 0, computePasses: 0, splits: 0, main: null };
  // The main pass is the view drawn most within the phase.
  const views = {};
  for (const p of passes) if (p.startsWith("R")) views[p.split(":")[0]] = (views[p.split(":")[0]] ?? 0) + 1;
  const main = Object.entries(views).sort((a, b) => b[1] - a[1])[0][0];
  let n = 0;
  for (let i = 1; i < passes.length; i++) {
    if (passes[i - 1] === "C" && passes[i] === `${main}:load`) n++;
  }
  return {
    renderPasses: passes.filter((p) => p.startsWith("R")).length,
    computePasses: passes.filter((p) => p === "C").length,
    splits: n,
    main,
  };
}

const report = { frames: FRAMES, maps: [] };
const MAP_IDS = (await page.evaluate(async () => (await import("/src/world/maps.ts")).MAPS.map((m) => m.id)));
let first = true;
for (const id of maps) {
  if (!first) {
    // Rotated as a player rotates it: to the menu, the map picked, a round.
    await page.evaluate((i) => {
      const g = window.__celshock;
      g.enterMenu();
      g.setMap(i);
      if (g.mapDef.id === undefined) throw new Error("no map");
    }, MAP_IDS.indexOf(id));
  }
  first = false;
  const before = await page.evaluate(() => window.__draws.length);
  const install = await installRound(page);
  const at = await page.evaluate(async ([F_FRAMES, drawsFrom]) => {
    const g = window.__celshock;
    const F = window.__fields;
    const order = F.all().map(F.name);
    const draws = window.__draws.slice(drawsFrom);
    const frame = () => window.__refFrame().drawn();
    // The constant 16 ms until the window opens; the schedule through it (the header).
    g.scene.useConstantAnimationDeltaTime = true;
    const cam = g.cameraSys.camera;
    const V = cam.position.constructor;
    const hull = g.vehicles.hulls.find((h) => h.flies) ?? null;
    // The world held as the deploy screen holds it; the wash told the fleet stepped.
    window.__fe ??= g.followEye;
    g.followEye = function () {
      return window.__fe.call(this, Boolean(hull));
    };
    const places = [];
    if (hull) {
      const pad = { x: hull.pos.x, z: hull.pos.z };
      places.push({ phase: "dry", x: pad.x + 30, z: pad.z, floor: g.map.terrain.surfaceAt(pad.x + 30, pad.z, true) });
      let wet = null;
      for (const p of g.rotorWash.pools) {
        const x = (p.minX + p.maxX) / 2;
        const z = (p.minZ + p.maxZ) / 2;
        const bed = g.map.terrain.surfaceAt(x, z, true);
        if (bed < p.surface - 0.5 && (!wet || p.surface - bed > wet.depth)) wet = { x, z, floor: p.surface, depth: p.surface - bed };
      }
      if (wet) places.push({ phase: "wet", ...wet });
    } else {
      places.push({ phase: "ash", x: 0, z: 0, floor: g.map.terrain.surfaceAt(0, 0, true) });
    }
    const keep = hull ? { pos: hull.pos.clone(), rotor: hull.flight.rotor } : null;
    const pin = (p) => {
      if (hull) {
        hull.pos.set(p.x, p.floor + hull.spec.hull.height / 2 + 3, p.z);
        hull.flight.rotor = 1;
        g.vehicleViews.update();
      }
      cam.position.set(p.x, p.floor + 12, p.z - 40);
      cam.setTarget(new V(p.x, p.floor + 2, p.z));
    };
    // The known state: particles off, every field reset, pinned, ready.
    F.enable(false);
    pin(places[0]);
    for (const f of F.all()) F.reset(f);
    const control = [];
    const controlPaths = [];
    for (let i = 0; ; i++) {
      if (i > 1200) throw new Error("a field never became ready");
      await frame();
      if (control.length < 8) control.push(window.__phasePasses);
      if (controlPaths.length < 8) controlPaths.push(window.__path);
      if (F.all().every(F.ready)) break;
    }
    F.enable(true);
    // The window's clock: the frame's delta answered by frame, counted from
    // the window's first, and the scene's own clamp left to read it — through
    // the frame adapter (`harness.mjs`, X5.4a: the engine's `getDeltaTime`;
    // our loop's clock's since X5.4g).
    window.__refFrame().scheduleDelta((k) => (k % 60 === 29 ? 0.25 : k % 60 === 59 ? 1500 : 16.7));
    g.scene.useConstantAnimationDeltaTime = false;
    const log = [];
    for (const p of places) {
      pin(p);
      for (let i = 0; i < F_FRAMES; i++) {
        await frame();
        log.push({ phase: p.phase, ...window.__frame() });
      }
    }
    F.enable(true);
    g.followEye = window.__fe;
    window.__refFrame().scheduleDelta(null);
    g.scene.useConstantAnimationDeltaTime = false;
    if (keep) {
      hull.pos.copyFrom(keep.pos);
      hull.flight.rotor = keep.rotor;
      g.vehicleViews.update();
    }
    return { order, draws, places, control, controlPaths, log, drawsAfter: window.__draws.slice(drawsFrom + draws.length) };
  }, [FRAMES, before]);
  const passStats = at.log.map((f) => splits(f.passes ?? []));
  const controlStats = at.control.map((p) => splits(p ?? []));
  const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
  const entry = {
    map: id,
    installMs: install.installMs,
    order: at.order,
    constructions: at.draws,
    firstUpdates: at.drawsAfter,
    places: at.places,
    columns: await page.evaluate(() => window.__fieldColumns),
    unwrapped: await page.evaluate(() => [...window.__unwrapped]),
    log: at.log.map((f) => ({ ...f, fields: f.fields.map((r) => r.map(enc)), sites: f.sites.map(enc), passes: undefined })),
    passes: {
      control: controlStats,
      perFrame: passStats,
      meanRender: +(sum(passStats, "renderPasses") / passStats.length).toFixed(2),
      meanCompute: +(sum(passStats, "computePasses") / passStats.length).toFixed(2),
      meanSplits: +(sum(passStats, "splits") / passStats.length).toFixed(2),
      sample: at.log.slice(-1)[0]?.passes,
    },
  };
  report.maps.push(entry);
  console.log(`${id}  installMs ${install.installMs}`);
  console.log(`  order at deploy: ${entry.order.join(", ")}`);
  for (const [label, n] of entry.constructions) console.log(`  random draws: ${label}: ${n}`);
  for (const [label, n] of entry.firstUpdates) console.log(`  random draws in the window: ${label}: ${n}`);
  if (entry.unwrapped.length) console.log(`  NOT COUNTED (no _initialize to wrap): ${entry.unwrapped.join(", ")}`);
  console.log(
    `  passes in the draw phase, particles off (control): ${controlStats.map((s) => `${s.renderPasses}R/${s.computePasses}C/${s.splits}S`).join(" ")}; seam path ${[...new Set(at.controlPaths)].join("/")}`,
  );
  entry.paths = { control: at.controlPaths, window: [...new Set(at.log.map((f) => f.path))] };
  for (const ph of new Set(at.log.map((f) => f.phase))) {
    const idx = at.log.map((f, i) => (f.phase === ph ? i : -1)).filter((i) => i >= 0);
    const st = idx.map((i) => passStats[i]);
    const last = at.log[idx[idx.length - 1]];
    console.log(
      `  ${ph}: ${idx.length} frames; passes a frame ${Math.min(...st.map((s) => s.renderPasses))}-${Math.max(...st.map((s) => s.renderPasses))} render, ` +
        `${Math.min(...st.map((s) => s.computePasses))}-${Math.max(...st.map((s) => s.computePasses))} compute, splits ${Math.min(...st.map((s) => s.splits))}-${Math.max(...st.map((s) => s.splits))}; ` +
        `seam path ${[...new Set(idx.map((i) => at.log[i].path))].join("/")}`,
    );
    console.log(`    last frame's passes: ${(last.passes ?? []).join(" ")}`);
    for (const r of last.fields) {
      console.log(
        `    ${String(r[0]).padEnd(12)} rate ${(+r[4]).toFixed(3)} acc ${(+r[5]).toFixed(4)} count ${r[6]} emit ${r[7]}+${r[8]} ptr ${r[9]} dt ${r[10]}`,
      );
    }
    console.log(`    sites ${last.siteCount} [${last.sites.map((x) => (+x).toFixed(3)).join(", ")}], water holds ${last.waterWash}`);
  }
}

if (pageErrors.length || consoleErrors.length) {
  console.log(`${pageErrors.length} page errors, ${consoleErrors.length} console errors`);
  for (const e of [...pageErrors, ...consoleErrors].slice(0, 5)) console.log(`  ${String(e).slice(0, 300)}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(report));

/** The first difference between two lists of `[label, count]` (or of names), or null. */
function drawsDiffer(here, there) {
  for (let i = 0; i < Math.max(here.length, there.length); i++) {
    const a = JSON.stringify(here[i]);
    const b = JSON.stringify(there[i]);
    if (a !== b) return `entry ${i} is ${a ?? "absent"} here and ${b ?? "absent"} there`;
  }
  return null;
}

let failed = false;
if (AGAINST) {
  const ref = JSON.parse(readFileSync(AGAINST, "utf8"));
  if (ref.frames !== report.frames) console.log(`--against was logged at ${ref.frames} frames a place, this at ${report.frames}`);
  report.maps.forEach((m, k) => {
    const r = ref.maps[k];
    if (!r || r.map !== m.map) {
      console.log(`against: map ${k} is ${m.map} here and ${r?.map} there`);
      failed = true;
      return;
    }
    if (JSON.stringify(r.order) !== JSON.stringify(m.order)) {
      console.log(`against: ${m.map}'s order differs: ${r.order.join(",")} there`);
      failed = true;
    }
    // The random draws, label and count: a port that skips a draw (a ring's
    // seeds at rest after a reset) moves no logged number, so this is its test.
    for (const key of ["constructions", "firstUpdates", "unwrapped"]) {
      const d = drawsDiffer(m[key] ?? [], r[key] ?? []);
      if (d) {
        console.log(`against ${m.map}: ${key} DIFFER — ${d}`);
        failed = true;
      }
    }
    let first = null;
    let compared = 0;
    for (let i = 0; i < Math.max(m.log.length, r.log.length) && !first; i++) {
      const a = m.log[i];
      const b = r.log[i];
      if (!a || !b) {
        first = `frame ${i} is on one side only`;
        break;
      }
      const rows = [
        ...a.fields.map((row, j) => [`field ${row[0]}`, row, b.fields[j]]),
        ["sites", a.sites, b.sites],
        ["siteCount", [a.siteCount], [b.siteCount]],
        ["waterWash", [a.waterWash], [b.waterWash]],
      ];
      for (const [what, x, y] of rows) {
        if (!y || x.length !== y.length) {
          first = `frame ${i} (${a.phase}): ${what} has another shape`;
          break;
        }
        for (let c = 0; c < x.length; c++) {
          compared++;
          if (!Object.is(x[c], y[c])) {
            const col = what.startsWith("field") ? m.columns[c - 1] ?? "name" : `[${c}]`;
            first = `frame ${i} (${a.phase}): ${what} ${col} is ${x[c]} here and ${y[c]} there`;
            break;
          }
        }
        if (first) break;
      }
    }
    if (first) failed = true;
    console.log(`against ${m.map}: ${first ? `DIFFERS — ${first}` : `equal by Object.is, ${compared} numbers over ${m.log.length} frames`}`);
  });
  if (ref.maps.length !== report.maps.length) {
    console.log(`against: ${report.maps.length} maps here and ${ref.maps.length} there`);
    failed = true;
  }
  if (ref.editor) console.log("against: the other log's --editor record is not compared (retired at X5.3c)");
}
await browser.close();
vite.stop();
process.exit(failed ? 1 : 0);
