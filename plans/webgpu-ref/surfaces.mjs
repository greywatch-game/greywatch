/**
 * Where each surface `BABYLON_EXIT.md` X4.6 moves sits in Babylon's frame, and
 * how many pixels of each bank row it owns: the record X4.6b-e hang on, MEASURED
 * rather than read off the code (X4.4a's scratch probe, kept this time).
 *
 * Run with `node plans/webgpu-ref/surfaces.mjs [map...] [--rows=<id,...>]
 * [--pixels] [--editor] [--keep=<dir>] [--out=<f.json>]`. Nothing is written but
 * `--out` and `--keep`, and nothing in `ref/` is touched or read.
 *
 * **It shoots a map's sequence exactly as `bank.mjs` does** (`thaw`,
 * `placeVantage`, the wait, the settle, `freeze`, the settle), because a row's
 * frame depends on the rows before it, so what it reads is the frame the bank
 * grades. `--rows` shoots up to its last named row and reports only those.
 *
 * **What it hangs on the frame is three wrappers and no draw that shows.** One
 * is `Mesh.prototype.render`, which every Babylon draw comes through in the
 * order Babylon RECORDS it, and under `compatibilityMode = false` that is the
 * order the pass replays it (`render/babylonSeam.ts`, item 3). One is the host's
 * `queue`, which is how each of our draw points reaches that same list, so a
 * point's place among Babylon's draws is read off the same log and never argued.
 * The third is `Renderer.glowMaskOpened`, which tells the frame's mask apart. A
 * draw point with nothing on it queues nothing, so an empty function is hung on
 * every point: it draws nothing, and its bundle break moves no pixel. `--keep`
 * is how that is checked: it writes each reported row's frame, as the probe saw
 * it, to `<dir>/<map>-<row>.png`, the names `bank.mjs --check --keep` writes, so
 * the two directories compare frame by frame with `diff.mjs`.
 *
 * **The list a mesh is on is read from WHERE it comes in the log**, between the
 * points: ahead of `beforeAlphaTest` is Babylon's opaque list, from there to
 * `opaque` its alpha-tested list, and past `beforeBlended` its transparent list
 * (`Renderer`'s header has the order). A flag that a material carries is
 * recorded beside it, and when the two disagree the log wins, because a
 * material's `needAlphaBlending` is not what puts a mesh with `visibility` under
 * 1 on the transparent list. Beside the list is what the mesh's pipeline holds,
 * read off the engine's pipeline cache as Babylon's `applyStates` leaves it for the draw: its
 * depth write and test, its bias, its cull, its blend and its write mask.
 *
 * **`--pixels` owns a surface by taking it out.** Each class in a row's main pass
 * is skipped at `Mesh.render` for three frames, in every pass, the frame is
 * grabbed and compared with the row's own, and the skip comes off; no `isVisible`
 * or `setEnabled` is written, because `GrassSystem` and `WaterSystem` rewrite
 * those from `tick`. So a class's count is every pixel of the frame that would
 * differ without it, its depth's effect on the ink included. Beside the counts
 * are the OVERLAPS the plan asks about: a pixel both a blended surface and the
 * water own is that surface over the water, and likewise a pane and the water.
 *
 * **Every draw in a frame is reported, `other` included, by the list it is on**:
 * `other[opaque x640, transparent x6]`. `blob` is a body's contact shadow
 * (`ShadowSystem`), and `proxy` is the editor's handles (`editor/proxies.ts`), the
 * `ed-*` meshes, most of them blended. An empty class says only that nothing raised
 * it in THAT frame: a bank row reaches no `updateBlobs`, so only a row with a `blob`
 * event shows one, which is how the blob went unnoticed through X4.6a's first run.
 *
 * `render` only reaches what Babylon draws, so a class stops being reported the
 * moment its step lands (X4.6b the flags and the rings, X4.6c the grass and the
 * turf, X4.6d the water, X4.6e the glazing, the three pools and the blobs), which
 * is how a sub-step proves it took the whole of its surface.
 *
 * **`--editor` asks the same of an editor build**: `F2` from the menu (no round
 * and no freeze), the free camera warped to each distinct eye of the map's rows
 * looking at that row's target, one frame's log at each. Then one water rect and
 * one grass rect are changed in memory, as the panel changes them, through the
 * editor's own rebuild, and the meshes before and after are compared. Nothing is
 * saved: the page is simply closed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  bootMap,
  freeze,
  hardLimit,
  installRound,
  launchClient,
  MAP_IDS,
  placeVantage,
  root,
  settle,
  startDevServer,
  thaw,
  vantages,
  waitUntilDrawn,
} from "./harness.mjs";
import { shotList } from "./vantages.mjs";

const args = process.argv.slice(2);
const PIXELS = args.includes("--pixels");
const EDITOR = args.includes("--editor");
const OUT = args.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "";
const KEEP = args.find((a) => a.startsWith("--keep="))?.slice("--keep=".length) ?? "";
const ROWS = new Set(
  (args.find((a) => a.startsWith("--rows="))?.slice("--rows=".length) ?? "").split(",").filter(Boolean),
);
const maps = args.filter((a) => !a.startsWith("--"));
const targets = maps.length ? maps : MAP_IDS;
hardLimit(3600);

/** The overlaps `--pixels` reports: a blended surface, then what it lies over. */
const OVERLAPS = [
  ["spark", "water"],
  ["spark", "waterFar"],
  ["disc", "water"],
  ["disc", "waterFar"],
  ["scorch", "water"],
  ["blob", "water"],
  ["seeThrough", "water"],
  ["seeThrough", "waterFar"],
  ["seeThrough", "spark"],
  ["seeThrough", "disc"],
  ["seeThrough", "scorch"],
  ["seeThrough", "blob"],
  ["blob", "spark"],
  ["blob", "disc"],
  ["blob", "scorch"],
  ["seeThrough", "turf"],
  ["seeThrough", "grass"],
  ["turf", "water"],
  ["grass", "water"],
  ["grass", "turf"],
];

/** The wrappers, once a boot. See the header. */
function hangProbe(page) {
  return page.evaluate(() => {
    const g = window.__celshock;
    const e = g.engine;
    const scene = g.scene;
    const classOf = (mesh, mat) => {
      const n = mesh.name;
      if (/^zone-.*-flag/.test(n)) return "flag";
      if (/^zone-.*-pole/.test(n)) return "pole";
      if (/^zone-.*-stones-/.test(n)) return "stones";
      if (/^zone-.*-paint/.test(n)) return "paint";
      if (/^grassTurf/.test(n)) return "turf";
      if (/^grass\d/.test(n)) return "grass";
      if (n === "water") return "water";
      if (n === "waterFar") return "waterFar";
      if (n === "blobShadow") return "blob";
      if (/^ed-/.test(n)) return "proxy";
      if (/^spark\d/.test(n)) return "spark";
      if (/^impact\d/.test(n)) return "disc";
      if (mat?.name === "blastScorch") return "scorch";
      if (/^paneblock/.test(n)) return mat?.needAlphaBlending?.() ? "seeThrough" : "backed";
      return "other";
    };
    const s = {
      rec: false,
      log: [],
      hide: null,
      frame: undefined,
      inMask: false,
    };
    window.__surf = s;
    s.classOf = classOf;
    scene.onBeforeDrawPhaseObservable.add(() => {
      s.frame = e._currentRenderTarget;
      s.inMask = false;
      if (s.rec) s.log.push({ mark: "phase" });
    });
    scene.onAfterDrawPhaseObservable.add(
      () => {
        if (s.rec) s.log.push({ mark: "phaseEnd" });
      },
      undefined,
      true,
    );
    let proto = Object.getPrototypeOf(scene.meshes[0]);
    while (!Object.prototype.hasOwnProperty.call(proto, "render")) proto = Object.getPrototypeOf(proto);
    const render = proto.render;
    proto.render = function (...a) {
      const mat = this.material;
      const cls = classOf(this, mat);
      if (s.hide?.has(cls)) return this;
      let entry = null;
      if (s.rec) {
        const eye = scene.activeCamera.globalPosition;
        const c = this.getBoundingInfo().boundingSphere.centerWorld;
        entry = {
          id: this.uniqueId,
          n: this.name,
          cls,
          mat: mat?.name ?? null,
          pass: s.inMask ? "mask" : e._currentRenderTarget === s.frame ? "main" : "target",
          vis: this.visibility,
          alphaIndex: this.alphaIndex,
          group: this.renderingGroupId,
          d: +Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z).toFixed(2),
          at: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
          inst: this.hasThinInstances ? this.thinInstanceCount : 0,
          gpu: null,
        };
        s.log.push(entry);
      }
      s.drawn = null;
      const out = render.apply(this, a);
      if (entry) entry.gpu = s.drawn;
      return out;
    };
    // What the pipeline of a mesh's (first) draw actually has, which is not what
    // a material's flags say: a blended draw's depth write goes off in
    // `setAlphaMode`, whatever `disableDepthWrite` says.
    const cache = e._cacheRenderPipeline;
    const applyStates = e.applyStates;
    e.applyStates = function (...a) {
      const out = applyStates.apply(this, a);
      if (s.rec && !s.drawn) {
        s.drawn = [
          `depthWrite ${cache._depthWriteEnabled ? "on" : "off"}`,
          `depthTest ${cache._depthTestEnabled ? cache._depthCompare : "off"}`,
          `bias ${cache._depthBias}/${+cache._depthBiasSlopeScale.toFixed(3)}`,
          `cull ${cache._cullEnabled ? cache._cullFace : "off"}`,
          `blend ${cache._alphaBlendEnabled[0] ? [...cache._alphaBlendFuncParams].slice(0, 4).join(",") + "/" + [...cache._alphaBlendEqParams].slice(0, 2).join(",") : "off"}`,
          `mask ${cache._writeMask}`,
        ].join(" ");
      }
      return out;
    };
    const r = g.renderer;
    const points = new Map([
      [r.runFirst, "first"],
      [r.runBeforeAlpha, "beforeAlphaTest"],
      [r.runOpaque, "opaque"],
      [r.runBlended, "beforeBlended"],
      [r.runAfter, "afterGroup"],
      [r.runMask, "maskOpen"],
      [r.runMaskLate, "maskLate"],
    ]);
    const queue = r.host.queue;
    r.host.queue = function (run) {
      if (s.rec) s.log.push({ mark: points.get(run) ?? "queued" });
      return queue.call(this, run);
    };
    const opened = r.glowMaskOpened;
    r.glowMaskOpened = function () {
      s.inMask = true;
      if (s.rec) s.log.push({ mark: "maskOpened" });
      return opened.call(this);
    };
    // An empty function on every point, so each is in the log whether or not
    // anything of ours is on it this frame. A map's own draws stay where they
    // are: these are behind them in their lists.
    const nothing = () => {};
    for (const at of ["first", "beforeAlphaTest", "opaque", "beforeBlended", "afterGroup"]) {
      r.add(nothing, at);
    }
  });
}

/** One class of `summarise`'s as a line prints it, a count per list. */
function classLine(k, c, px) {
  const on = Object.entries(c.lists).map(([list, n]) => `${list} x${n}`).join(", ");
  return `${k}[${on}${px ? ` ${px.pixels}px mean ${px.mean}` : ""}]`;
}

/** One rendered frame's log. */
function recordFrame(page) {
  return page.evaluate(async () => {
    const g = window.__celshock;
    const s = window.__surf;
    return new Promise((res) => {
      g.scene.onBeforeRenderObservable.addOnce(() => {
        s.log = [];
        s.rec = true;
        g.scene.onAfterRenderObservable.addOnce(() => {
          s.rec = false;
          // What the frustum kept and nothing drew: the size gate's (`WorldCulling.offer`).
          const drawn = new Set(s.log.filter((it) => it.pass === "main").map((it) => it.id));
          const planes = g.scene.frustumPlanes;
          const gated = {};
          for (const m of g.scene.meshes) {
            const cls = s.classOf(m, m.material);
            if (cls === "other" || drawn.has(m.uniqueId) || !m.isEnabled() || !m.isVisible || !m.visibility) continue;
            if (!m.alwaysSelectAsActiveMesh && !m.isInFrustum(planes)) continue;
            gated[cls] = (gated[cls] ?? 0) + 1;
          }
          res({ log: s.log, gated });
          s.log = [];
        });
      });
    });
  });
}

/** Which list each main-pass draw is on, by its place between the points. */
function readOrder(log) {
  const out = [];
  let list = "opaque";
  let seenFirst = false;
  for (const it of log) {
    if (it.mark) {
      if (it.mark === "first") seenFirst = true;
      if (it.mark === "beforeAlphaTest") list = "alphaTest";
      if (it.mark === "opaque") list = "afterAlphaTest";
      if (it.mark === "beforeBlended") list = "transparent";
      if (it.mark === "afterGroup") list = "afterGroup";
      if (it.mark === "maskOpened") list = "mask";
      out.push({ mark: it.mark, seenFirst });
    } else {
      out.push({ ...it, list });
    }
  }
  return out;
}

/** What one row's frame holds, a class at a time. */
function summarise(order) {
  const classes = {};
  for (const it of order) {
    if (it.mark || it.pass === "target") continue;
    const key = it.pass === "mask" ? `${it.cls}@mask` : it.cls;
    const c = (classes[key] ??= { lists: {}, n: 0, near: Infinity, far: 0, gpu: new Set(), vis: new Set() });
    c.lists[it.list] = (c.lists[it.list] ?? 0) + 1;
    c.n++;
    c.near = Math.min(c.near, it.d);
    c.far = Math.max(c.far, it.d);
    c.gpu.add(it.gpu);
    c.vis.add(+it.vis.toFixed(2));
  }
  for (const c of Object.values(classes)) {
    c.list = Object.keys(c.lists);
    c.gpu = [...c.gpu];
    c.vis = [...c.vis];
  }
  return classes;
}

const vite = await startDevServer(root);
const browser = await launchClient({ headed: false });
const decoder = PIXELS ? await (await import("playwright")).chromium.launch({ headless: true }) : null;
const canvasPage = decoder ? await decoder.newPage() : null;
const VANTAGES = await vantages(browser, vite.url);

/** Which pixels differ from `base`, as a mask held in the decoder's page under `key`. */
async function maskOf(baseB64, otherB64, key) {
  return canvasPage.evaluate(
    async ([a, b, k]) => {
      const load = async (src) => {
        const i = new Image();
        i.src = `data:image/png;base64,${src}`;
        await i.decode();
        const c = document.createElement("canvas");
        c.width = i.width;
        c.height = i.height;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.drawImage(i, 0, 0);
        return x.getImageData(0, 0, i.width, i.height).data;
      };
      const [p, q] = await Promise.all([load(a), load(b)]);
      const mask = new Uint8Array(p.length / 4);
      let n = 0;
      let worst = 0;
      let sum = 0;
      const w = 1920;
      const box = [w, 1080, -1, -1];
      for (let i = 0, j = 0; i < p.length; i += 4, j++) {
        const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
        sum += (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2])) / 3;
        if (d > 0) {
          mask[j] = 1;
          n++;
          if (d > worst) worst = d;
          const x = j % w;
          const y = (j / w) | 0;
          if (x < box[0]) box[0] = x;
          if (y < box[1]) box[1] = y;
          if (x > box[2]) box[2] = x;
          if (y > box[3]) box[3] = y;
        }
      }
      (window.__masks ??= {})[k] = mask;
      // `mean` is `diff.mjs`'s, over the whole frame: what `bank.mjs --check` would
      // grade this class's removal at against its tolerance.
      return { pixels: n, worst, box, mean: +(sum / mask.length).toFixed(4) };
    },
    [baseB64, otherB64, key],
  );
}

/** `--editor`: one map's editor build, as the header says. */
async function editorBuild(id) {
  const { page, pageErrors, consoleErrors } = await bootMap(browser, vite.url, id);
  await page.evaluate(async () => {
    const g = window.__celshock;
    await g.toggleEditor();
    if (!g.editor) throw new Error("the editor did not open");
  });
  await settle(page, 30);
  await hangProbe(page);
  const rows = {};
  const seen = new Set();
  console.log(`${id} (editor build)`);
  for (const v of shotList(id, VANTAGES[id])) {
    const key = v.pos.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    await page.evaluate((r) => {
      const g = window.__celshock;
      const [x, above, z] = r.pos;
      const y = g.map.terrain.surfaceAt(x, z, true) + above;
      const d = [r.target[0] - x, r.target[1] - y, r.target[2] - z];
      const yaw = Math.atan2(d[0], d[2]);
      const pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
      const P = g.cameraSys.camera.position.constructor;
      g.editor.warpTo(new P(x, y, z), yaw, pitch);
    }, v);
    await settle(page, 10);
    const { log, gated } = await recordFrame(page);
    const classes = summarise(readOrder(log));
    rows[v.id] = { classes, gated };
    const line = Object.entries(classes)
      .map(([k, c]) => classLine(k, c))
      .join(" ");
    console.log(`  ${v.id.padEnd(26)} ${line}`);
  }
  const before = await page.evaluate(() => {
    const g = window.__celshock;
    const counts = {};
    for (const m of g.scene.meshes) {
      const n = m.name;
      const k = /^ed-/.test(n)
        ? "ed-*"
        : /^zone-/.test(n)
        ? "zone-*"
        : /^grassTurf/.test(n)
          ? "grassTurf*"
          : /^grass\d/.test(n)
            ? "grass*"
            : /^water/.test(n)
              ? n
              : /glass/.test(m.material?.name ?? "")
                ? "glazing"
                : /^spark\d/.test(n)
                  ? "spark*"
                  : /^impact\d/.test(n)
                    ? "impact*"
                    : m.material?.name === "blastScorch"
                      ? "scorch*"
                      : n === "blobShadow"
                        ? "blob*"
                        : null;
      if (k) counts[k] = (counts[k] ?? 0) + 1;
    }
    return {
      counts,
      bodies: g.water.bodies.length,
      zones: g.zones.zones.length,
      panes: g.map.panes.length,
      paneGroups: g.map.paneGroups.length,
      // `PaneBlocks` splits an owner's glazing by material, so a group is not a
      // placement: on an editor build its owner is one (`item<n>`).
      paneOwners: new Set(g.map.paneGroups.map((p) => p.block)).size,
      paneMaterials: new Set(g.map.paneGroups.map((p) => p.mesh.material)).size,
      probes: g.reflections.probeCount,
    };
  });
  console.log(`  standing: ${JSON.stringify(before)}`);
  const edited = await page.evaluate(async () => {
    const g = window.__celshock;
    const layout = g.mapDef.layout;
    const stamp = () => ({
      water: g.water.bodies.map((b) => b.grid.uniqueId),
      // No mesh since X4.6c: the field's mask, which a rebuild bakes anew.
      grass: g.grass.mask,
    });
    const a = stamp();
    if (layout.water?.[0]) layout.water[0].width += 2;
    if (layout.grass?.[0]) layout.grass[0].width += 2;
    g.editor.rebuildGeometry(null);
    await new Promise((res) => g.scene.onAfterRenderObservable.addOnce(res));
    const b = stamp();
    if (layout.water?.[0]) layout.water[0].width -= 2;
    if (layout.grass?.[0]) layout.grass[0].width -= 2;
    return {
      waterRemade: a.water.length > 0 && a.water.every((u) => !b.water.includes(u)),
      grassRemade: a.grass !== null && a.grass !== b.grass && b.grass !== null,
      grassDrawn: { ...g.grassDraw.stats },
      grassMeshes: g.scene.meshes.filter((m) => /^grass/.test(m.name)).length,
    };
  });
  console.log(`  a water rect and a grass rect edited: ${JSON.stringify(edited)}`);
  if (pageErrors.length || consoleErrors.length) {
    console.log(`  ${pageErrors.length} page errors, ${consoleErrors.length} console errors`);
    for (const e of [...pageErrors, ...consoleErrors].slice(0, 5)) console.log(`    ${String(e).slice(0, 300)}`);
  }
  await page.close();
  return { rows, before, edited };
}

const report = {};
for (const id of targets) {
  if (EDITOR) {
    report[id] = await editorBuild(id);
    continue;
  }
  let shots = shotList(id, VANTAGES[id]);
  if (!shots.length) continue;
  if (ROWS.size) {
    const last = shots.findLastIndex((v) => ROWS.has(v.id));
    if (last < 0) continue;
    shots = shots.slice(0, last + 1);
  }
  const { page, pageErrors, consoleErrors } = await bootMap(browser, vite.url, id);
  await installRound(page);
  await hangProbe(page);
  report[id] = {};
  console.log(id);
  for (const v of shots) {
    await thaw(page);
    await placeVantage(page, v);
    await waitUntilDrawn(page);
    await settle(page, 30);
    await freeze(page, undefined, { windTime: v.wind ?? 0, turn: v.turn ?? 0, strike: v.strike ?? null });
    await settle(page, 6);
    if (ROWS.size && !ROWS.has(v.id)) continue;

    const { log, gated } = await recordFrame(page);
    const order = readOrder(log);
    const classes = summarise(order);
    const row = { classes, order, gated };
    let base = "";
    if (PIXELS || KEEP) {
      base = (await page.screenshot({ type: "png", timeout: 120_000 })).toString("base64");
      if (KEEP) {
        mkdirSync(KEEP, { recursive: true });
        writeFileSync(join(KEEP, `${id}-${v.id}.png`), Buffer.from(base, "base64"));
      }
    }
    if (PIXELS) {
      await canvasPage.evaluate(() => {
        window.__masks = {};
      });
      const owned = {};
      const hidable = Object.keys(classes).filter((k) => !k.includes("@") && k !== "other");
      for (const cls of hidable) {
        await page.evaluate((c) => {
          window.__surf.hide = new Set([c]);
        }, cls);
        await settle(page, 3);
        const off = (await page.screenshot({ type: "png", timeout: 120_000 })).toString("base64");
        await page.evaluate(() => {
          window.__surf.hide = null;
        });
        await settle(page, 3);
        owned[cls] = await maskOf(base, off, cls);
      }
      const overlaps = {};
      for (const [a, b] of OVERLAPS) {
        if (!owned[a] || !owned[b]) continue;
        const both = await canvasPage.evaluate(
          ([p, q]) => {
            const m = window.__masks[p];
            const o = window.__masks[q];
            let n = 0;
            const box = [1920, 1080, -1, -1];
            for (let i = 0; i < m.length; i++) {
              if (!m[i] || !o[i]) continue;
              n++;
              const x = i % 1920;
              const y = (i / 1920) | 0;
              if (x < box[0]) box[0] = x;
              if (y < box[1]) box[1] = y;
              if (x > box[2]) box[2] = x;
              if (y > box[3]) box[3] = y;
            }
            return { n, box };
          },
          [a, b],
        );
        overlaps[`${a}&${b}`] = both.n;
        (row.overlapBoxes ??= {})[`${a}&${b}`] = both.box;
      }
      row.owned = owned;
      row.overlaps = overlaps;
    }
    report[id][v.id] = row;
    const line = Object.entries(classes)
      .map(([k, c]) => classLine(k, c, row.owned?.[k]))
      .join(" ");
    const over = Object.entries(row.overlaps ?? {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(" ");
    console.log(`  ${v.id.padEnd(26)} ${line}${over ? `  || ${over}` : ""}`);
  }
  if (pageErrors.length || consoleErrors.length) {
    console.log(`  ${pageErrors.length} page errors, ${consoleErrors.length} console errors`);
    for (const e of [...pageErrors, ...consoleErrors].slice(0, 5)) console.log(`    ${String(e).slice(0, 300)}`);
  }
  await page.close();
}
if (OUT) writeFileSync(OUT, JSON.stringify(report));
await browser.close();
await decoder?.close();
vite.stop();
