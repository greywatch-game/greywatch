/**
 * Where each surface `BABYLON_EXIT.md` X4.6 moves sits in Babylon's frame, and
 * how many pixels of each bank row it owns: the record X4.6b-e hang on, MEASURED
 * rather than read off the code (X4.4a's scratch probe, kept this time).
 *
 * Run with `node plans/webgpu-ref/surfaces.mjs [map...] [--rows=<id,...>]
 * [--pixels] [--keep=<dir>] [--out=<f.json>]`. Nothing is written but
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
 * **A fourth wrapper hears what no `Mesh.render` carries** (Phase 4's gate): the
 * engine's `_draw`, which every Babylon draw of any kind reaches, logged when no
 * mesh or field is rendering — the post chain's passes, and anything else Babylon
 * might draw on its own (a layer, an effect layer, a sprite) — as `effect ->
 * target`, printed under a row when it differs from the row before and totalled
 * over the run at the end. It draws nothing and changes no state.
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
 * or `setEnabled` is written, because the systems drawing them rewrote those from
 * `tick`. So a class's count is every pixel of the frame that would
 * differ without it, its depth's effect on the ink included. Beside the counts
 * are the OVERLAPS the plan asks about: a pixel both a blended surface and the
 * water own is that surface over the water, and likewise a pane and the water.
 *
 * **Every draw in a frame is reported, `other` included, by the list it is on**:
 * `other[opaque x640, transparent x6]`. `blob` is a body's contact shadow
 * (`ShadowSystem`). (A `proxy` class, the map editor's `ed-*` handles, was
 * retired with the editor at `BABYLON_EXIT.md` X5.3c.) An empty class says
 * only that nothing raised it in THAT frame: a bank row reaches no
 * `updateBlobs`, so only a row with a `blob` event shows one, which is how
 * the blob went unnoticed through X4.6a's first run.
 *
 * `render` only reaches what Babylon draws, so a class stops being reported the
 * moment its step lands (X4.6b the flags and the rings, X4.6c the grass and the
 * turf, X4.6d the water, X4.6e the glazing, the three pools and the blobs), which
 * is how a sub-step proves it took the whole of its surface.
 *
 * **`--editor`**, which asked the same of the map editor's build, is retired
 * with the editor (`BABYLON_EXIT.md` X5.3c, row "X5.3, retire the editor") and
 * refused.
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
if (args.includes("--editor")) {
  console.error("surfaces: --editor is retired with the map editor (BABYLON_EXIT.md X5.3c)");
  process.exit(2);
}
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
  // X4.7a: the ORDER between two fields, which only a pixel both own can show.
  ["motes", "rotorWash"],
  ["motes", "rotorSpray"],
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
      if (/^spark\d/.test(n)) return "spark";
      if (/^impact\d/.test(n)) return "disc";
      if (mat?.name === "blastScorch") return "scorch";
      if (/^paneblock/.test(n)) return mat?.needAlphaBlending?.() ? "seeThrough" : "backed";
      return "other";
    };
    const s = {
      rec: false,
      /** Inside a `Mesh.render` or a field's `render` (the engine-level log skips those). */
      inMesh: 0,
      /** Babylon's draws this frame that came through NO `Mesh.render`, `effect -> target`. */
      engine: [],
      log: [],
      hide: null,
      frame: undefined,
      inMask: false,
    };
    window.__surf = s;
    s.classOf = classOf;
    // The draw phase's two ends through the frame adapter (`harness.mjs`,
    // X5.4f: the scene's observables on Babylon's arm, our frame's on ours),
    // the end inserted FIRST as it was on the scene's.
    const F = window.__refFrame();
    F.onDrawPhase(() => {
      s.frame = e._currentRenderTarget;
      s.inMask = false;
      s.visited = false;
      if (s.rec) s.log.push({ mark: "phase" });
    }, null);
    // WHICH PATH the seam took this phase (`render/babylonSeam.ts`, `onMainPass`):
    // group 0 of the main pass visited, so our points were told inside it, or
    // not, so they were told at the phase's end (X4.5a's fallback). Read off the
    // same public observable the seam reads, the same test.
    scene.onBeforeRenderingGroupObservable.add((info) => {
      if (info.renderingGroupId === 0 && s.frame !== undefined && e._currentRenderTarget === s.frame) s.visited = true;
    });
    F.onDrawPhase(
      null,
      () => {
        if (s.rec) s.log.push({ mark: "phaseEnd", path: s.visited ? "group" : "fallback" });
      },
      true,
    );
    // `Mesh.render`, found on the prototype chain of a mesh — any `Mesh`
    // serves. Since BABYLON_EXIT.md X5.3e a round's scene may hold none (no
    // collider is a mesh, and nothing of the world is Babylon's), so the hook
    // is installed on the first mesh the scene is handed, before it can draw,
    // where there is none yet — as the draw log's and `pipelines.mjs`' are.
    const hookMesh = (anyMesh) => {
      let proto = Object.getPrototypeOf(anyMesh);
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
        s.inMesh++;
        let out;
        try {
          out = render.apply(this, a);
        } finally {
          s.inMesh--;
        }
        if (entry) entry.gpu = s.drawn;
        return out;
      };
    };
    if (scene.meshes[0]) hookMesh(scene.meshes[0]);
    else {
      const added = scene.onNewMeshAddedObservable.add((mesh) => {
        scene.onNewMeshAddedObservable.remove(added);
        hookMesh(mesh);
      });
    }
    // **The PARTICLES (X4.7a) come through no `Mesh.render`**: each started
    // field is drawn by `RenderingGroup._renderParticles`, in the scene's list
    // order, as its own `render()`, which dispatches its update and then draws.
    // So the class is hung on the field's own `render`, and a field is a class
    // by its name with the index taken off (`motes`, `rotorWash`, `rotorSpray`).
    // An entry is logged only for a call that DREW (a field at a count of zero,
    // or not ready, returns before either), with the pipeline its draw left,
    // its blend mode, its live count and the defines of its compiled update
    // (`_cachedUpdateDefines`) and render effect. `--pixels` skips the whole
    // call, which on a held field (a clock of zero) moves nothing it would not
    // move again.
    const field = scene.particleSystems[0];
    if (field) {
      let fproto = Object.getPrototypeOf(field);
      while (!Object.prototype.hasOwnProperty.call(fproto, "render")) fproto = Object.getPrototypeOf(fproto);
      const fieldRender = fproto.render;
      fproto.render = function (preWarm = false, forceUpdateOnly = false) {
        const cls = this.name.replace(/\d+$/, "");
        if (!preWarm && !forceUpdateOnly && s.hide?.has(cls)) return 0;
        const pass = s.inMask ? "mask" : e._currentRenderTarget === s.frame ? "main" : "target";
        s.drawn = null;
        s.inMesh++;
        let out;
        try {
          out = fieldRender.call(this, preWarm, forceUpdateOnly);
        } finally {
          s.inMesh--;
        }
        if (s.rec && !preWarm && out > 0) {
          const eye = scene.activeCamera.globalPosition;
          const c = this.emitter;
          let renderDefines = null;
          try {
            renderDefines = this._getWrapper(this.blendMode).effect.defines;
          } catch {
            renderDefines = "(unread)";
          }
          s.log.push({
            id: `field${this.uniqueId}`,
            n: this.name,
            cls,
            mat: null,
            pass,
            vis: 1,
            alphaIndex: 0,
            group: this.renderingGroupId,
            d: +Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z).toFixed(2),
            at: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
            inst: out,
            gpu: s.drawn,
            field: {
              blendMode: this.blendMode,
              count: this._currentActiveCount,
              capacity: this._capacity,
              randomTextureSize: this._randomTextureSize,
              updateDefines: (this._cachedUpdateDefines ?? "").split("\n").filter(Boolean),
              renderDefines: String(renderDefines).split("\n").filter(Boolean),
            },
          });
        }
        return out;
      };
    }
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
    // **Every Babylon draw that comes through NO `Mesh.render`** (Phase 4's gate,
    // `BABYLON_EXIT.md`): the engine's `_draw`, which every draw of Babylon's of
    // any kind reaches, logged when no mesh or field is rendering — the post
    // chain's passes, and anything else Babylon draws on its own (a layer, an
    // effect layer, a sprite). By its effect's name and the target it drew into
    // (`canvas` for the swap chain). Our renderer's draws never reach it.
    const effName = (eff) => {
      const n = eff?.name;
      if (typeof n === "string") return n;
      if (n && typeof n === "object") return n.fragment ?? n.fragmentElement ?? n.vertex ?? n.vertexElement ?? "(inline)";
      return "(none)";
    };
    const drawOf = e._draw;
    e._draw = function (...a) {
      if (s.rec && !s.inMesh) {
        const rt = this._currentRenderTarget;
        s.engine.push(`${effName(this._currentEffect)} -> ${rt ? rt.label || rt.texture?.name || "target" : "canvas"}`);
      }
      return drawOf.apply(this, a);
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
    if (typeof r.recordGlowMask === "function") {
      // OURS (`BABYLON_EXIT.md` X5.4e): the main pass, the mask and the blur
      // are the renderer's own passes, their draws RECORDED rather than queued
      // into Babylon's — so each point's list is marked as the renderer runs
      // it (it asks each through its own field), the mask where its pass is
      // recorded (`recordGlowMask`, the open's place), and a blur pass as the
      // `queued` mark its queue made. The marks keep their names and order but
      // one: `first` now lands at the phase's end with the rest, where the
      // seam queued it as the phase began (it RAN with the rest there).
      for (const [run, mark] of points) {
        const key = Object.keys(r).find((k) => r[k] === run);
        if (!key) continue;
        r[key] = function (pass) {
          if (s.rec) s.log.push({ mark });
          return run.call(this, pass);
        };
      }
      const recordMask = r.recordGlowMask;
      r.recordGlowMask = function () {
        s.inMask = true;
        if (s.rec) s.log.push({ mark: "maskOpened" });
        return recordMask.call(this);
      };
      const blurPass = r.glowBlurPass;
      r.glowBlurPass = function (target, run) {
        if (s.rec) s.log.push({ mark: "queued" });
        return blurPass.call(this, target, run);
      };
    } else {
      const opened = r.glowMaskOpened;
      r.glowMaskOpened = function () {
        s.inMask = true;
        if (s.rec) s.log.push({ mark: "maskOpened" });
        return opened.call(this);
      };
    }
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
    // The frame through the frame adapter (`harness.mjs`, X5.4a): from before
    // its draw to the draw's end, both read synchronously as the frame raises them.
    const F = window.__refFrame();
    return new Promise((res) => {
      F.beforeDraw(() => {
        s.log = [];
        s.engine = [];
        s.rec = true;
        const off = F.onDrawn(() => {
          off();
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
          res({ log: s.log, gated, engine: s.engine });
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

const report = {};
/** Each engine-level draw (`effect -> target`) and the rows it was in. */
const engineRows = {};
let lastEngine = null;
/** A frame's engine-level draws as one line: each in order of first draw, with its count. */
function engineLine(engine) {
  const n = new Map();
  for (const d of engine) n.set(d, (n.get(d) ?? 0) + 1);
  return [...n].map(([d, k]) => `${d}${k > 1 ? ` x${k}` : ""}`).join(", ");
}
for (const id of targets) {
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

    const { log, gated, engine } = await recordFrame(page);
    const order = readOrder(log);
    const classes = summarise(order);
    const row = { classes, order, gated, engine };
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
    row.paths = log.filter((it) => it.mark === "phaseEnd").map((it) => it.path);
    report[id][v.id] = row;
    const line = Object.entries(classes)
      .map(([k, c]) => classLine(k, c, row.owned?.[k]))
      .join(" ");
    const over = Object.entries(row.overlaps ?? {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(" ");
    console.log(`  ${v.id.padEnd(26)} [seam: ${row.paths.join("/") || "no phase"}] ${line}${over ? `  || ${over}` : ""}`);
    // The engine-level draws, printed when they differ from the row before.
    const sig = engineLine(engine);
    if (sig !== lastEngine) console.log(`      babylon, through no Mesh.render: ${sig || "nothing"}`);
    lastEngine = sig;
    for (const d of new Set(engine)) (engineRows[d] ??= new Set()).add(`${id}-${v.id}`);
    for (const it of order) {
      if (!it.field) continue;
      console.log(
        `      ${it.n}: ${it.list}, ${it.inst} drawn of ${it.field.count} (capacity ${it.field.capacity}), blend mode ${it.field.blendMode}, random texture ${it.field.randomTextureSize}; ${it.gpu}`,
      );
      console.log(`        update defines: ${it.field.updateDefines.join(" ")}`);
      console.log(`        render defines: ${it.field.renderDefines.join(" ")}`);
    }
  }
  if (pageErrors.length || consoleErrors.length) {
    console.log(`  ${pageErrors.length} page errors, ${consoleErrors.length} console errors`);
    for (const e of [...pageErrors, ...consoleErrors].slice(0, 5)) console.log(`    ${String(e).slice(0, 300)}`);
  }
  await page.close();
}
const engineKeys = Object.keys(engineRows);
if (engineKeys.length) {
  const rows = Object.values(report).reduce((a, m) => a + Object.keys(m).length, 0);
  console.log(`
Babylon's draws through no Mesh.render, over ${rows} rows:`);
  for (const d of engineKeys) console.log(`  ${d}: ${engineRows[d].size} rows`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(report));
await browser.close();
await decoder?.close();
vite.stop();
