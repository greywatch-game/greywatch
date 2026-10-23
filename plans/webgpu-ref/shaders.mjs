/**
 * Compiles every shader the game has, on every map, and fails if the driver
 * complained about any of them.
 *
 * Run with `node plans/webgpu-ref/shaders.mjs [map...] [--headed] [--list]`.
 * It exits non-zero, so it can stand in front of a merge beside `gate.mjs`.
 *
 * **This is the only thing standing between "typecheck passes" and "the map is
 * invisible".** `tsc` sees a shader as a string; a WGSL error is a runtime
 * event on a device, and a variant nobody happened to draw is a variant nobody
 * compiled. `gate.mjs` next door catches a map that fails to draw at all, and
 * the reference bank catches a picture that changed — neither catches the
 * eighth cel variant failing to compile on the one map that carries it, because
 * a material that never binds costs a draw and no diagnostic.
 *
 * **It compiles the cel material TWICE, once per renderer.** Both bodies,
 * the vertex stage's and the fragment's, are one text each
 * (`shaders/wgsl/chunks.ts`) with two readers, Babylon's material and our own
 * `src/render/`, and each declares what the bodies read its own way — so a
 * shape this page's factory compiled is also assembled by
 * `render/celVertex.ts` and `render/celFragment.ts` and built into a pipeline
 * by our own `PipelineCache` (`oursCheck`). Only the TAKEN surfaces' variants
 * draw with those modules — the shapes a map's blocks wear (`BABYLON_EXIT.md`
 * X3.3c) and since X3.5 its landform, the bumped ground among them — which
 * is exactly why every shape is compiled here: an unused module is one nobody
 * else would ever find broken.
 *
 * **A frame count is not coverage, so this asks the FACTORY rather than the
 * frame.** Every cel material in the game comes from one cache, so the check
 * is: walk it, ask each material for its effect, and assert the effect is ready
 * and carries no compilation error. That reaches the variants a still camera
 * cannot see — a pane on the far side of the map, a ground material under a
 * building — and it reaches them by construction rather than by choosing a
 * vantage that happens to hold them.
 *
 * **The driver is asked separately, and the two answers are not the same
 * question.** `Effect.getCompilationError()` is what Babylon noticed;
 * `GPUShaderModule.getCompilationInfo()` is what Dawn said, against the source
 * this script is holding — which is the only place a line number comes from.
 * Warnings come back through the same call and MOST OF THEM ARE OURS: Dawn
 * emits `'textureSample' must only be called from uniform control flow` for
 * `shadowVisibility` and `band` and for a wall of Babylon's own shaders, which
 * is what a cel shader IS. Filter on `type === "error"` or every run reads as
 * broken.
 *
 * **The player is spawned and a few seconds of round are played**, which is not
 * about the frame rate: the viewmodel, the bot rigs, the ink twins and the
 * effect meshes are the meshes that carry NO vertex colour buffer, and they are
 * the half of the cel shader a frozen reference frame never holds (`bank.mjs`
 * disables every rig before it places a camera). Playing is how they get built.
 */
import {
  assertNoTranspiler,
  bootMap,
  installRound,
  launchClient,
  MAP_IDS,
  root,
  startDevServer,
  waitUntilDrawn,
} from "./harness.mjs";

const args = process.argv.slice(2);
const HEADED = args.includes("--headed");
const LIST = args.includes("--list");
const maps = args.filter((a) => !a.startsWith("--"));
const MAPS = maps.length > 0 ? maps : MAP_IDS;

/**
 * The cel variants the shipped maps must between them compile, keyed by
 * the define set that makes each a separate effect.
 *
 * Seven shapes: matte, glossy and translucent are one compiled effect wearing
 * three sets of uniforms, and the cloth (`CEL_SMOOTH`), the paletted world
 * (`CEL_PALETTE`), the two glazings and the two grounds are each their own.
 * A map missing one of these is not an error — Hollowmere has no glazed
 * block — which is why the requirement is on the UNION over every map asked
 * for, and why a run over a single map only reports.
 *
 * **This list rots the moment a variant is retired and the rot is a FAILING
 * GATE**, which is worth knowing because it has already happened once: the
 * inverted-hull ink went away with `CelInk` (`36855c2`) and `CEL_INK` stayed
 * here, so from that commit to this one the script exited non-zero on every
 * run and could not stand in front of a merge the way its header says it does.
 * A variant deleted from `CelShader` is deleted from here in the same change.
 */
const WANTED = [
  "",
  "CEL_SMOOTH",
  "CEL_PALETTE",
  "CEL_GLASS",
  "CEL_GLASS+CEL_GLASS_BACKED",
  "CEL_GROUND_TEX",
  "CEL_BUMP+CEL_GROUND_TEX",
];

const vite = await startDevServer(root);
const browser = await launchClient({ headed: HEADED });

/** Hooks the device before the page has one, and keeps every module's source. */
const HOOK = () => {
  window.__modules = [];
  const proto = window.GPUDevice?.prototype;
  if (!proto?.createShaderModule) return;
  const orig = proto.createShaderModule;
  proto.createShaderModule = function patched(desc) {
    const module = orig.call(this, desc);
    window.__modules.push({ label: desc.label ?? "", code: desc.code, module });
    return module;
  };
};

/**
 * OUR renderer's half of the same shapes (`BABYLON_EXIT.md` X3.1, X3.3a):
 * every cel shape this page's factory compiled, assembled by
 * `render/celVertex.ts` and `render/celFragment.ts` into plain WGSL with
 * explicit bind groups and built into a real pipeline by our own
 * `PipelineCache` — the call `render/WorldBlocks.ts` makes, against
 * `FRAME_TARGETS` — on a device of its own so nothing of Babylon's stands
 * between the modules and the driver.
 *
 * **The layout is EXPLICIT, made from the bindings the assembly reports**,
 * not `"auto"`: an auto layout keeps only what the body happens to use, so it
 * would pass a declaration list that disagrees with the module, and it would
 * count against the per-stage limits only what is used rather than what is
 * bound. The bumped ground is at 16 of 16 sampled textures and 16 of 16
 * samplers; one more on either side of the split fails here, by name. There
 * is no vertex buffer: since X3.5b the stage PULLS its attributes out of
 * storage, so its six storage arrays count against the vertex stage's limit,
 * on this device's DEFAULT limits.
 *
 * **And the compute cull those draws read (X3.3b)**: `render/wgsl/
 * clusterCull.ts` compiled and each of its three entry points built into a
 * compute pipeline on an `"auto"` layout — on the device here, not through
 * the cache, but as `PipelineCache.compute` builds them for the cull — one
 * more row, the same on every map. The instance cull's four entry points
 * (`render/wgsl/instanceCull.ts`, X3.4b, expanded at X3.5b) are a row of
 * their own beside the cluster cull's. Since X3.5b one vertex stage draws
 * the blocks and the scatter alike, so each shape is built once — and once
 * more as its SCATTER twin, which a group drawing scatter wears, binding the
 * instance cull's list and source beside the arrays (eight storage buffers
 * in a palette variant, the default limit).
 *
 * **And the pipeline STATES the world draws them in (X3.5).** A pipeline is
 * its fixed-function state as well as its modules, and `WorldBlocks` asks for
 * a recipe's with its `depthBias` — the ROADS' (`ROAD_DEPTH_UNITS`), since
 * X3.5 took the landform, and anything else this page's factory made with a
 * `zOffsetUnits`. So every (shape, bias) a cel material that keeps a recipe
 * carries is built once more with that bias as `WorldBlocks`
 * states it — or the first frame to draw a road is the first to try it.
 */
async function oursCheck({ shapes, biased }) {
  const { celFragment } = await import("/src/render/celFragment.ts");
  const { celVertex } = await import("/src/render/celVertex.ts");
  const { PipelineCache } = await import("/src/render/PipelineCache.ts");
  const { FRAME_TARGETS } = await import("/src/render/targets.ts");
  const { CONFIG } = await import("/src/config/index.ts");
  const { listStride } = await import("/src/render/scatterList.ts");
  // The scatter list's stride, as `WorldBlocks` takes it.
  const stride = listStride(CONFIG.graphics.clusters.triangles);
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const cache = new PipelineCache(device);
  const out = [];
  // Every shape at no bias, then each biased (shape, bias) the page carries,
  // then every shape's scatter twin.
  const builds = [
    ...shapes.map((shape) => ({ shape, depthBias: 0, scatter: null })),
    ...biased.map(({ shape, depthBias }) => ({ shape, depthBias, scatter: null })),
    ...shapes.map((shape) => ({ shape, depthBias: 0, scatter: stride })),
  ];
  for (const { shape, depthBias, scatter } of builds) {
    const kind = `${scatter === null ? "" : "scatter "}${depthBias === 0 ? "" : `bias ${depthBias} `}`;
    const defines = shape ? shape.split("+") : [];
    let vm;
    let fm;
    try {
      vm = celVertex(defines, FRAME_TARGETS, scatter);
      fm = celFragment(defines, FRAME_TARGETS);
    } catch (e) {
      out.push({ error: `${kind}${String(e?.message ?? e)}`, source: "" });
      continue;
    }
    device.pushErrorScope("validation");
    let built = "";
    try {
      await cache.get({
        vertex: vm,
        vertexEntry: "main",
        fragment: fm,
        fragmentEntry: "main",
        targets: FRAME_TARGETS,
        // As `WorldBlocks.ask` states it: no state at all for no bias.
        state: depthBias === 0 ? undefined : { depthBias },
      });
    } catch (e) {
      built = String(e?.message ?? e);
    }
    const scope = await device.popErrorScope();
    const errorsOf = async (m, code) => {
      const info = await device.createShaderModule({ label: m.label, code }).getCompilationInfo();
      return [...info.messages]
        .filter((x) => x.type === "error")
        .map((e) => `${m.label} ${e.lineNum}:${e.linePos} ${e.message}`);
    };
    const vErrors = await errorsOf(vm, vm.code);
    const fErrors = await errorsOf(fm, fm.code);
    const all = [...vErrors, ...fErrors, built, scope?.message].filter(Boolean);
    out.push({
      error: all.length > 0 ? `${kind}${fm.label}: ${all.join("; ")}` : "",
      source: [vErrors.length > 0 ? vm.code : "", fErrors.length > 0 ? fm.code : ""]
        .filter(Boolean)
        .join("\n// ---- fragment ----\n"),
    });
  }
  const { CLUSTER_CULL_WGSL } = await import("/src/render/wgsl/clusterCull.ts");
  const { instanceCullWgsl } = await import("/src/render/wgsl/instanceCull.ts");
  const instanceEntries = ["cullInstances", "cullRecords", "prefix", "expand"];
  const culls = [
    ["cluster cull", CLUSTER_CULL_WGSL, ["cullClusters", "prefix", "scatter"]],
    ["instance cull", instanceCullWgsl(stride), instanceEntries],
  ];
  for (const [label, code, entries] of culls) {
    device.pushErrorScope("validation");
    const module = device.createShaderModule({ label, code });
    const info = await module.getCompilationInfo();
    const errors = [...info.messages]
      .filter((x) => x.type === "error")
      .map((e) => `${e.lineNum}:${e.linePos} ${e.message}`);
    for (const entryPoint of entries) {
      try {
        await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint } });
      } catch (e) {
        errors.push(`${entryPoint}: ${String(e?.message ?? e)}`);
      }
    }
    const scope = await device.popErrorScope();
    if (scope) errors.push(scope.message);
    out.push({
      error: errors.length > 0 ? `[${label}]: ${errors.join("; ")}` : "",
      source: errors.length > 0 ? code : "",
    });
  }
  device.destroy();
  return out;
}

const seen = new Set();
const failures = [];

for (const id of MAPS) {
  const { page, pageErrors, consoleErrors, cdnRequests } = await bootMap(browser, vite.url, id);
  await page.addInitScript(HOOK);
  // The hook has to be in place before the device exists, and `bootMap` has
  // already navigated — so reload once with the script installed rather than
  // re-implementing the boot.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__celshock), null, { timeout: 180_000 });
  await installRound(page);
  await waitUntilDrawn(page);

  const out = await page.evaluate(async () => {
    const g = window.__celshock;
    const frame = () =>
      new Promise((res) => {
        const seen = g.scene.onAfterRenderObservable.add(() => {
          g.scene.onAfterRenderObservable.remove(seen);
          res();
        });
      });
    // Everything that carries no vertex colour buffer is built by PLAYING:
    // the viewmodel, the rigs, the ink twins and the effect meshes.
    g.spawnPlayer();
    await new Promise((res) => setTimeout(res, 2500));

    // Any mesh currently drawn with a cel material stands in for all of them.
    // Every cel variant is built from the same attribute list, so one mesh is
    // enough to ASK any of them to compile — which is the whole point: the
    // factory outlives a mesh, and a pooled rig that never deployed leaves its
    // paint in the cache with no draw behind it to have compiled it.
    const probe = g.scene.meshes.find(
      (m) =>
        m.material &&
        m.material.name.startsWith("cel-") &&
        m.getTotalVertices() > 0,
    );
    if (!probe) throw new Error("no cel-material mesh to compile against");

    // The one variant no shipped map mints: a ground albedo with no height map
    // beside it. Both call sites pass a bump today, so `CEL_GROUND_TEX` alone
    // would go uncompiled for the life of the project and rot unnoticed — the
    // exact failure this script exists for. Minting it here is a page that is
    // about to be thrown away asking the factory a question.
    const anyGround = [...g.mats.cache.values()].find((m) =>
      m.name.startsWith("cel-ground-"),
    );
    if (anyGround) {
      g.mats.getGroundTextured(
        "smoke-flat",
        anyGround._textures.baseColorTex,
        1,
      );
    }

    const shaders = [...g.scene.materials].filter(
      (m) => m._options && Array.isArray(m._options.defines),
    );
    // WebGPU compiles a pipeline asynchronously, so readiness is polled rather
    // than read: `isReady` is what ASKS for the compile as well as what reports
    // it, and the first call on a variant nothing has drawn always says no.
    let pending = shaders;
    for (let i = 0; i < 240 && pending.length > 0; i++) {
      pending = pending.filter((m) => !m.isReady(probe));
      if (pending.length > 0) await frame();
    }

    const materials = [];
    const cel = new Set();
    // Each (shape, bias) a material our renderer could draw carries — a recipe
    // with a depth bias (X3.5's roads) — for `oursCheck`'s pipeline states.
    const biased = new Map();
    for (const mat of shaders) {
      const effect = mat.getEffect?.();
      const defines = mat._options.defines
        .map((d) => String(d).replace("#define ", "").trim())
        .filter(Boolean)
        .sort();
      const isCel = mat.name.startsWith("cel-");
      if (isCel) cel.add(defines.join("+"));
      const recipe = g.mats.celRecipe(mat);
      if (recipe && recipe.depthBias !== 0) {
        // In the recipe's own order, as `WorldBlocks` assembles it.
        const shape = recipe.defines.join("+");
        biased.set(`${shape}|${recipe.depthBias}`, { shape, depthBias: recipe.depthBias });
      }
      materials.push({
        name: mat.name,
        defines: defines.join("+"),
        cel: isCel,
        ready: !pending.includes(mat),
        error: effect?.getCompilationError?.() || "",
      });
    }

    // What Dawn said, against the source this page is holding. Warnings are
    // dropped on purpose — see the header.
    const modules = [];
    for (const m of window.__modules) {
      const info = await m.module.getCompilationInfo();
      const errors = [...info.messages].filter((x) => x.type === "error");
      if (errors.length > 0) {
        modules.push({
          label: m.label,
          errors: errors.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`),
          source: m.code,
        });
      }
    }
    return {
      materials,
      cel: [...cel].sort(),
      biased: [...biased.values()],
      modules,
      moduleCount: window.__modules.length,
    };
  });

  for (const v of out.cel) seen.add(v);
  const ours = await page.evaluate(oursCheck, { shapes: out.cel, biased: out.biased });
  const badOurs = ours.filter((o) => o.error);

  const badMats = out.materials.filter((m) => !m.ready || m.error);
  const celCount = out.materials.filter((m) => m.cel).length;
  const status =
    badMats.length === 0 && out.modules.length === 0 && badOurs.length === 0 ? "ok" : "FAIL";
  console.log(
    `${id.padEnd(13)} ${String(celCount).padStart(3)} cel materials  ` +
      `${String(out.moduleCount).padStart(3)} modules  ` +
      `${out.cel.length} variants  ${ours.length - badOurs.length}/${ours.length} ours  ${status}`,
  );
  for (const o of badOurs) {
    failures.push(`${id}: ours ${o.error}`);
    if (o.source) {
      const line = Number(/\]: (\d+):/.exec(o.error)?.[1] ?? 0);
      const numbered = o.source.split("\n").map((l, i) => `${String(i + 1).padStart(4)}  ${l}`);
      failures.push(numbered.slice(Math.max(0, line - 3), line + 2).join("\n"));
    }
  }
  if (LIST) {
    for (const v of out.cel) console.log(`    [${v || "(no defines)"}]`);
  }
  for (const m of badMats) {
    failures.push(`${id}: ${m.name} [${m.defines}] ${m.error || "not ready"}`);
  }
  for (const m of out.modules) {
    const numbered = m.source
      .split("\n")
      .map((l, i) => `${String(i + 1).padStart(4)}  ${l}`);
    for (const e of m.errors) {
      const line = Number(e.split(":")[0]);
      failures.push(
        `${id}: module "${m.label}" ${e}\n` +
          numbered.slice(Math.max(0, line - 3), line + 2).join("\n"),
      );
    }
  }
  // The transpiler tripwire, both halves. This is the strongest place in the
  // tree to ask it: the sweep above forces every CACHED material to compile, so
  // a shader no camera is pointed at is still one this page tried to build.
  // See `assertNoTranspiler` for why neither half is enough alone.
  for (const u of cdnRequests) failures.push(`${id}: requested ${u}`);
  for (const bad of await assertNoTranspiler(page)) failures.push(`${id}: ${bad}`);
  for (const e of pageErrors) failures.push(`${id}: page error: ${e}`);
  for (const e of consoleErrors) failures.push(`${id}: console error: ${e}`);
  await page.close();
}

await browser.close();
vite.stop();

// The coverage half, and it is only meaningful over the whole set: a single
// map is asked to compile what it has, not what the game has.
if (MAPS.length === MAP_IDS.length) {
  const missing = WANTED.filter((v) => !seen.has(v));
  if (missing.length > 0) {
    failures.push(
      `cel variants never compiled on any map: ${missing
        .map((v) => `[${v || "(no defines)"}]`)
        .join(", ")}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log(`\nevery shader compiled clean on ${MAPS.length} map(s)`);
