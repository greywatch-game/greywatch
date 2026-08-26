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
 * The cel variants the four shipped maps must between them compile, keyed by
 * the define set that makes each a separate effect.
 *
 * Eight materials and six shapes: matte, glossy and translucent are one
 * compiled effect wearing three sets of uniforms, and the other five are each
 * their own. A map missing one of these is not an error — Hollowmere has no
 * glazed block — which is why the requirement is on the UNION over every map
 * asked for, and why a run over a single map only reports.
 */
const WANTED = [
  "",
  "CEL_INK",
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

const seen = new Set();
const failures = [];

for (const id of MAPS) {
  const { page, pageErrors, consoleErrors } = await bootMap(browser, vite.url, id);
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
    for (const mat of shaders) {
      const effect = mat.getEffect?.();
      const defines = mat._options.defines
        .map((d) => String(d).replace("#define ", "").trim())
        .filter(Boolean)
        .sort();
      const isCel = mat.name.startsWith("cel-");
      if (isCel) cel.add(defines.join("+"));
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
    return { materials, cel: [...cel].sort(), modules, moduleCount: window.__modules.length };
  });

  for (const v of out.cel) seen.add(v);

  const badMats = out.materials.filter((m) => !m.ready || m.error);
  const celCount = out.materials.filter((m) => m.cel).length;
  const status = badMats.length === 0 && out.modules.length === 0 ? "ok" : "FAIL";
  console.log(
    `${id.padEnd(13)} ${String(celCount).padStart(3)} cel materials  ` +
      `${String(out.moduleCount).padStart(3)} modules  ` +
      `${out.cel.length} variants  ${status}`,
  );
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
