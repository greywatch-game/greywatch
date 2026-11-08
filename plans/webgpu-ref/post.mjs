/**
 * The post chain, read off the DEVICE pass by pass: what `BABYLON_EXIT.md`
 * X5.2b to X5.2d must reproduce when the chain's passes become our draws, read
 * off the parent rather than argued (X5.2a, which built it and measured with it).
 *
 * Run with `node plans/webgpu-ref/post.mjs [--sizes=desk,phone] [--out=f.json]
 * [--against=f.json] [--no-live]`, or with no browser at all as
 * `node plans/webgpu-ref/post.mjs --compare=a.json --against=b.json`, which
 * compares two logs this file wrote (how the comparison is shown to FAIL on a
 * hand-edited copy). Nothing in the repository is written but `--out`. About
 * six minutes on the Windows box for both sizes.
 *
 * **Why a probe and not only the bank.** Every bank row is 1920x1080 at a
 * scaling level of 1 and a DPR of 1, so the glow blur's kernel text, an odd
 * target size and a floored glow target are unseen; no row holds a frame
 * before readiness, a resize or a rung change in play; and a row is one
 * composited PICTURE, so a pass that moved and a pass after it that hid the
 * move are one result. None of the intermediate targets, the samplers, the
 * pipeline descriptors or the processed WGSL is in a PNG. This file reads
 * every one of them off the device, per pass.
 *
 * **What makes two runs comparable.** The page is booted at a stated SIZE
 * (`desk`, 1920x1080 at 1, the bank's; `phone`, 832x384 at a device scale of
 * 2.8125, the phone `kit-phone` measures and a dense Android panel's density),
 * Hollowmere's round installed (`?seed=` pinned) and held at `deploy`, and
 * each SCENARIO is a row the harness shoots exactly as `bank.mjs` shoots one:
 * `placeVantage` at `lanterns`' eye (the night street: lamps for the bloom, the
 * moon's shafts, contrast for the grain and the AA) with the post settings the
 * scenario states over a stated BASE (render scale 1, glow high, shafts
 * medium, FXAA, the motion blur and the grain on), the chain's own effects
 * waited for (`allReady`: Babylon skips a pass whose effect is still compiling
 * and leaves its target cleared), the convergence settle, `freeze` (the turn
 * and the damage flash a scenario asks for included), the settle after it —
 * and then TWO consecutive frames captured. Each scenario logs whether the two
 * were equal (`steady`) and the second one in full. The scenarios run in one
 * fixed order per boot, so each one's state after the one before is the same
 * every run, as a bank row's is.
 *
 * **What is logged per captured frame**, every render pass in submit order
 * (the upload encoder's, then the render encoder's): its encoder's role, its
 * label (counters stripped), every colour attachment and the depth attachment
 * (the target's NAME, format, size, usage, mip and layer, load and store ops
 * and clear values) and a SHA-256 of what each holds once the pass has ended —
 * read back by a copy recorded on the pass's own encoder straight after its
 * `end`, so a target written twice in a frame is read after each write; depth
 * only for a named target — and the pass's draws: how many, which STAGES drew
 * in it, and for every draw by a named stage everything the draw was handed:
 * the pipeline (both modules by their TOKENS, the entry points, the vertex
 * layout, the topology and index format, cull and front face, the depth and
 * stencil state, every target's format, blend and write mask, the multisample
 * state, and the layout's groups entry by entry), each bind group entry by
 * entry (a SAMPLER by its descriptor, a texture view by its descriptor and the
 * target it views, a buffer by its range and — for anything mirrored — the
 * BYTES bound, as the queue held them at the submit), the vertex and index
 * buffers' bytes, the viewport, scissor, blend constant and stencil reference
 * in force, and the draw call and its arguments (an indirect draw's read off
 * the buffer). Beside each frame, `chain`: the camera's list as Babylon holds
 * it (its NULL holes and indices), each pass's own fields (its sampling mode,
 * sizes, texture type and format, alpha mode, clear, reusability, samples),
 * the glow's targets and rung, the scaling level and the render size,
 * `scene.autoClear`, `scene.autoClearDepthAndStencil`, the clear colour and
 * `scene.imageProcessingConfiguration`. **Once a boot**, the device's limits,
 * the canvas's configuration and preferred format, the engine's driver info,
 * and every shader module a named stage drew with: its processed TEXT, its
 * length and its tokens (comments and whitespace out), keyed by the tokens'
 * hash — which is what a draw names its modules by.
 *
 * **Every naming goes through ONE adapter, `window.__postGpu`**, with three
 * members: `refresh()` (looks the stages up again, so a module made for a
 * stage since — a rung change, a recompiled kernel — is named), `stage(module)`
 * (the stage a GPU shader module was made for, or null) and `target(texture)`
 * (the name of a GPU texture the chain reads or writes, or null), plus
 * `chain()` (the CPU facts above). **BABYLON's arm is the only one today**:
 * the camera's post processes (`ink`, `fxaa`, `shafts`, `blur`, `grain`, by
 * the object `Game` built each as), the glow's box filter and four blurs
 * (`glow.down`, `glow.blur0..3`), each one's effect's two modules
 * (`_pipelineContext.stages`; the glow's four blurs are ONE program, so one
 * stage, `glow.blur`, told apart by the target each draws into), and every
 * target by what WRITES it, the naming both arms can share: `frame` and
 * `frame.depth` (what the scene draws into: Babylon's first live pass's input),
 * `<stage>.out` (what a stage draws into: Babylon's next live pass's input),
 * `canvas` and `canvas.depth` (the engine's own depth, which the canvas's pass
 * carries), and the glow's six (`glow.mask`, `glow.down`, `glow.nearH`,
 * `glow.near`, `glow.wideH`, `glow.wide`). **A sub-step that moves a stage adds OURS**,
 * picked first for that stage, with the same names: a draw of ours is then
 * logged under the name the Babylon draw it replaced was, so `--against` its
 * parent compares the two draw for draw. The GPU side is read the same
 * whoever records: everything below `__postGpu` is the device.
 *
 * **And beside the log, measured once a boot and NOT compared** (they ride the
 * machine's timing): the LIVE frames — from the page's first frame to thirty
 * frames into `deploy`, and thirty frames after each of a shafts rung change,
 * a render-scale change, a glow rung change and (on `desk`) a window resize,
 * all in play — each frame's passes that a named stage drew in or that wrote
 * the canvas, by stage, target and load op, and the frame each stage's
 * pipelines were made on. That is where a pass Babylon SKIPPED while it
 * compiled shows, which no frozen frame can.
 *
 * **`--against`** (or `--compare`) compares size by size, scenario by
 * scenario: every value by `Object.is` (strings, hashes and hex bytes by
 * equality), the module table, and the boot's statics; the live half is
 * printed, not compared. It names the first difference per scenario and exits
 * 1. A lost device ends it (`harness.mjs`'s header, exit 4), and so does a hard
 * limit (exit 3).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { bootMap, freeze, FREEZE_SET, hardLimit, installRound, launchClient, placeVantage, root, settle, startDevServer, thaw, waitUntilDrawn } from "./harness.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = opt("out", "");
const AGAINST = opt("against", "");
const COMPARE = opt("compare", "");
const LIVE = !args.includes("--no-live");
const SIZE_IDS = opt("sizes", "desk,phone").split(",").filter(Boolean);

/** The two pages a scenario is read at: the bank's, and a dense phone's. */
const SIZES = {
  desk: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 832, height: 384 }, deviceScaleFactor: 2.8125 },
};

/** Every scenario starts from these, so a device-derived default reaches none of them. */
const BASE = { renderScale: 1, glow: "high", volumetrics: "medium", fxaa: true, motionBlur: true, paperGrain: true };

/** `lanterns`' eye (`src/bench/vantages.ts`), where every `post-*` row stands. */
const EYE = { pos: [2, 1.7, 18], target: [0, 2.2, -14] };

/**
 * The scenarios, in the one order a boot runs them: every render scale at
 * both glow rungs (the blur's kernel text is a function of the pair), every
 * shafts rung, each tail pass off, every tail pass off, the blur in flight,
 * the damage flash, and the base again (the camera's list after every toggle).
 */
const SCENARIOS = [
  { id: "base" },
  { id: "scale75", settings: { renderScale: 0.75 } },
  { id: "scale50", settings: { renderScale: 0.5 } },
  { id: "glowlow", settings: { glow: "low" } },
  { id: "glowlow-scale75", settings: { glow: "low", renderScale: 0.75 } },
  { id: "glowlow-scale50", settings: { glow: "low", renderScale: 0.5 } },
  { id: "vol-off", settings: { volumetrics: "off" } },
  { id: "vol-low", settings: { volumetrics: "low" } },
  { id: "vol-high", settings: { volumetrics: "high" } },
  { id: "nofxaa", settings: { fxaa: false } },
  { id: "blur", turn: 0.03 },
  { id: "noblur", settings: { motionBlur: false }, turn: 0.03 },
  { id: "nograin", settings: { paperGrain: false } },
  { id: "alloff", settings: { fxaa: false, volumetrics: "off", motionBlur: false, paperGrain: false } },
  { id: "damage", damage: true },
  { id: "base-again" },
];

/** Frames to converge before the freeze and to settle after it — `bank.mjs`'s. */
const CONVERGE_FRAMES = 30;
const SETTLE_FRAMES = 6;

if (COMPARE) {
  if (!AGAINST) throw new Error("--compare=<a.json> wants --against=<b.json>");
  const failed = compareLogs(JSON.parse(readFileSync(COMPARE, "utf8")), JSON.parse(readFileSync(AGAINST, "utf8")));
  process.exit(failed ? 1 : 0);
}

hardLimit(600 + SIZE_IDS.length * 1200);

/**
 * The device, wrapped before the game's first line (`bootMap`'s `init`).
 * Nothing it records changes what the game draws: the one command it adds to
 * the game's own encoders is a copy OUT of a target, after that target's pass
 * has ended, on a captured frame. The probe's own objects are made under
 * `self` and leave no trace in the log.
 */
function deviceProbe() {
  const P = (window.__postProbe = {
    self: false,
    capture: false,
    arm: 0,
    live: true,
    frame: 0,
    begun: 0,
    modules: new WeakMap(),
    moduleList: [],
    pipelines: new WeakMap(),
    pipelineList: [],
    bgls: new WeakMap(),
    layouts: new WeakMap(),
    bindGroups: new WeakMap(),
    samplers: new WeakMap(),
    views: new WeakMap(),
    mirrors: new WeakMap(),
    bufIds: new WeakMap(),
    nextBuf: 0,
    bundleEncs: new WeakMap(),
    bundles: new WeakMap(),
    passes: new WeakMap(),
    encPasses: new WeakMap(),
    encOrder: new WeakMap(),
    cbEnc: new WeakMap(),
    canvas: new WeakSet(),
    context: null,
    frameRec: null,
    captured: [],
    pending: [],
    liveFrames: [],
    stageOf: new WeakMap(),
  });
  const wrap = (proto, name, fn) => {
    const orig = proto?.[name];
    if (!orig) return;
    proto[name] = function (...a) {
      return fn.call(this, orig, a);
    };
  };
  const D = window.GPUDevice?.prototype;
  if (!D) return;
  wrap(D, "createShaderModule", function (orig, a) {
    const m = orig.apply(this, a);
    if (!P.self) {
      const rec = { code: String(a[0]?.code ?? ""), frame: P.frame };
      P.modules.set(m, rec);
      P.moduleList.push([m, rec]);
    }
    return m;
  });
  for (const k of ["createRenderPipeline", "createRenderPipelineAsync"]) {
    wrap(D, k, function (orig, a) {
      const r = orig.apply(this, a);
      if (!P.self) {
        const rec = { desc: a[0], call: k, frame: P.frame };
        P.pipelineList.push(rec);
        if (r && typeof r.then === "function") r.then((p) => P.pipelines.set(p, rec));
        else P.pipelines.set(r, rec);
      }
      return r;
    });
  }
  wrap(D, "createBindGroupLayout", function (orig, a) {
    const l = orig.apply(this, a);
    P.bgls.set(l, (a[0]?.entries ?? []).map((e) => ({ ...e })));
    return l;
  });
  wrap(D, "createPipelineLayout", function (orig, a) {
    const l = orig.apply(this, a);
    P.layouts.set(l, [...(a[0]?.bindGroupLayouts ?? [])]);
    return l;
  });
  wrap(D, "createBindGroup", function (orig, a) {
    const bg = orig.apply(this, a);
    P.bindGroups.set(bg, (a[0]?.entries ?? []).map((e) => ({ binding: e.binding, resource: e.resource })));
    return bg;
  });
  wrap(D, "createSampler", function (orig, a) {
    const s = orig.apply(this, a);
    P.samplers.set(s, { ...(a[0] ?? {}) });
    return s;
  });
  const T = window.GPUTexture?.prototype;
  wrap(T, "createView", function (orig, a) {
    const v = orig.apply(this, a);
    const d = { ...(a[0] ?? {}) };
    delete d.label;
    P.views.set(v, { texture: this, desc: d });
    return v;
  });
  // The bytes a buffer holds as the QUEUE has them: every `writeBuffer` and
  // every range mapped at creation, mirrored for the buffers a draw reads its
  // constants, vertices, indices or indirect arguments from.
  const MIRRORED = 0x10 | 0x20 | 0x40 | 0x100;
  wrap(D, "createBuffer", function (orig, a) {
    const b = orig.apply(this, a);
    if (P.self) return b;
    const d = a[0] ?? {};
    if ((d.usage & MIRRORED) && d.size <= 1 << 20) {
      const mirror = new Uint8Array(d.size);
      P.mirrors.set(b, mirror);
      if (d.mappedAtCreation) {
        const ranges = [];
        const gmr = b.getMappedRange;
        const unmap = b.unmap;
        b.getMappedRange = function (off = 0, size) {
          const r = gmr.call(this, off, size);
          ranges.push([off, r]);
          return r;
        };
        b.unmap = function () {
          for (const [off, r] of ranges) mirror.set(new Uint8Array(r).subarray(0, Math.max(0, mirror.length - off)), off);
          ranges.length = 0;
          return unmap.call(this);
        };
      }
    }
    return b;
  });
  const Q = window.GPUQueue?.prototype;
  wrap(Q, "writeBuffer", function (orig, a) {
    const [buffer, off, data, dataOffset = 0, size] = a;
    const mirror = P.mirrors.get(buffer);
    if (mirror) {
      let bytes;
      if (data instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && data instanceof SharedArrayBuffer)) {
        bytes = new Uint8Array(data, dataOffset, size ?? data.byteLength - dataOffset);
      } else {
        const el = data.BYTES_PER_ELEMENT ?? 1;
        const count = size ?? (data.byteLength / el - dataOffset);
        bytes = new Uint8Array(data.buffer, data.byteOffset + dataOffset * el, count * el);
      }
      mirror.set(bytes, off);
    }
    return orig.apply(this, a);
  });
  const C = window.GPUCanvasContext?.prototype;
  wrap(C, "configure", function (orig, a) {
    const d = a[0] ?? {};
    P.context = { format: d.format, usage: d.usage, alphaMode: d.alphaMode ?? "opaque", colorSpace: d.colorSpace ?? "srgb", toneMapping: d.toneMapping?.mode ?? "standard", viewFormats: [...(d.viewFormats ?? [])] };
    return orig.apply(this, a);
  });
  wrap(C, "getCurrentTexture", function (orig, a) {
    const t = orig.apply(this, a);
    P.canvas.add(t);
    return t;
  });

  // Draws are recorded into the pass they run in, bundles included (under
  // `compatibilityMode = false` Babylon draws into render BUNDLES, cached across
  // frames, and replays them when the pass ends: a bundle is recorded whenever
  // it is made, and resolved when a captured pass executes it).
  const CMDS = ["setPipeline", "setBindGroup", "setVertexBuffer", "setIndexBuffer", "draw", "drawIndexed", "drawIndirect", "drawIndexedIndirect", "setViewport", "setScissorRect", "setBlendConstant", "setStencilReference", "executeBundles"];
  const record = (list, k, a) => {
    if (k === "setBindGroup") {
      const [i, bg, offs, start, len] = a;
      const dyn = offs ? (start !== undefined ? Array.from(offs).slice(start, start + len) : Array.from(offs)) : [];
      list.push([k, i, bg, dyn]);
    } else if (k === "executeBundles") {
      list.push([k, [...a[0]]]);
    } else if (k === "setBlendConstant") {
      const c = a[0];
      list.push([k, Array.isArray(c) ? [...c] : [c.r, c.g, c.b, c.a]]);
    } else list.push([k, ...a]);
  };
  wrap(D, "createRenderBundleEncoder", function (orig, a) {
    const e = orig.apply(this, a);
    const d = a[0] ?? {};
    P.bundleEncs.set(e, { desc: { colorFormats: [...(d.colorFormats ?? [])], depthStencilFormat: d.depthStencilFormat ?? null, sampleCount: d.sampleCount ?? 1 }, cmds: [] });
    return e;
  });
  const RBE = window.GPURenderBundleEncoder?.prototype;
  for (const k of CMDS) {
    if (k === "executeBundles") continue;
    wrap(RBE, k, function (orig, a) {
      const r = P.bundleEncs.get(this);
      if (r) record(r.cmds, k, a);
      return orig.apply(this, a);
    });
  }
  wrap(RBE, "finish", function (orig, a) {
    const b = orig.apply(this, a);
    const r = P.bundleEncs.get(this);
    if (r) P.bundles.set(b, r);
    return b;
  });

  const E = window.GPUCommandEncoder?.prototype;
  const roleOf = (enc) => {
    const e = P.engine;
    return !e ? "?" : enc === e._renderEncoder ? "render" : enc === e._uploadEncoder ? "upload" : "other";
  };
  wrap(E, "beginRenderPass", function (orig, a) {
    const pass = orig.apply(this, a);
    if (P.self || !(P.capture || P.live)) return pass;
    const d = a[0] ?? {};
    const rec = {
      seq: P.begun++,
      enc: this,
      role: roleOf(this),
      label: d.label ?? "",
      color: (d.colorAttachments ?? []).map((c) =>
        c ? { view: c.view, resolve: c.resolveTarget ?? null, loadOp: c.loadOp, storeOp: c.storeOp, clear: c.clearValue === undefined ? null : Array.isArray(c.clearValue) ? [...c.clearValue] : [c.clearValue.r, c.clearValue.g, c.clearValue.b, c.clearValue.a], depthSlice: c.depthSlice ?? null } : null,
      ),
      depth: d.depthStencilAttachment
        ? (({ view, ...rest }) => ({ view, ...rest }))({ ...d.depthStencilAttachment })
        : null,
      full: P.capture,
      cmds: [],
      pipes: [],
      reads: [],
      snap: new Map(),
    };
    P.passes.set(pass, rec);
    if (!P.encPasses.has(this)) P.encPasses.set(this, []);
    P.encPasses.get(this).push(rec);
    return pass;
  });
  const RPE = window.GPURenderPassEncoder?.prototype;
  for (const k of CMDS) {
    wrap(RPE, k, function (orig, a) {
      const r = P.passes.get(this);
      if (r) {
        if (r.full) record(r.cmds, k, a);
        if (k === "setPipeline") r.pipes.push(a[0]);
        else if (k === "executeBundles") for (const b of a[0]) for (const c of P.bundles.get(b)?.cmds ?? []) if (c[0] === "setPipeline") r.pipes.push(c[1]);
      }
      return orig.apply(this, a);
    });
  }
  // The bytes per texel of every format a target here can have.
  const TEXEL = { r8unorm: 1, rg8unorm: 2, rgba8unorm: 4, "rgba8unorm-srgb": 4, bgra8unorm: 4, "bgra8unorm-srgb": 4, r16float: 2, rg16float: 4, rgba16float: 8, r32float: 4, rg32float: 8, rgba32float: 16, rgb10a2unorm: 4, rg11b10ufloat: 4, depth32float: 4, depth16unorm: 2 };
  const readBack = (rec, view, which) => {
    const v = P.views.get(view);
    const tex = v?.texture ?? null;
    if (!tex) return { which, skip: "unwrapped view" };
    const name = window.__postGpu?.target(tex) ?? (P.canvas.has(tex) ? "canvas" : null);
    const depth = tex.format.startsWith("depth");
    if (depth && !name) return null;
    const bpt = TEXEL[tex.format];
    if (!bpt) return { which, skip: `format ${tex.format}` };
    if (!(tex.usage & 1)) return { which, skip: "no COPY_SRC" };
    if (tex.sampleCount > 1) return { which, skip: "multisampled" };
    if (depth && tex.format !== "depth32float" && tex.format !== "depth16unorm") return { which, skip: `format ${tex.format}` };
    const mip = v.desc.baseMipLevel ?? 0;
    const layer = v.desc.baseArrayLayer ?? 0;
    const w = Math.max(1, tex.width >> mip);
    const h = Math.max(1, tex.height >> mip);
    const bpr = Math.ceil((w * bpt) / 256) * 256;
    const dev = tex.__dev ?? P.device;
    if (!dev) return { which, skip: "no device" };
    P.self = true;
    const buffer = dev.createBuffer({ size: bpr * h, usage: 1 | 8 });
    P.self = false;
    rec.enc.copyTextureToBuffer(
      { texture: tex, mipLevel: mip, origin: { x: 0, y: 0, z: layer }, aspect: depth ? "depth-only" : "all" },
      { buffer, offset: 0, bytesPerRow: bpr, rowsPerImage: h },
      { width: w, height: h, depthOrArrayLayers: 1 },
    );
    return { which, buffer, w, h, bpr, bpt, hash: null };
  };
  wrap(RPE, "end", function (orig, a) {
    const r = orig.apply(this, a);
    const rec = P.passes.get(this);
    if (rec && rec.full) {
      rec.color.forEach((c, i) => {
        if (!c) return;
        const x = readBack(rec, c.view, `color${i}`);
        if (x) rec.reads.push(x);
      });
      if (rec.depth?.view) {
        const x = readBack(rec, rec.depth.view, "depth");
        if (x) rec.reads.push(x);
      }
    }
    return r;
  });
  // Every texture knows the device it came from, which is what a readback
  // buffer is made on.
  wrap(D, "createTexture", function (orig, a) {
    const t = orig.apply(this, a);
    t.__dev = this;
    return t;
  });
  wrap(C, "configure", function (orig, a) {
    P.device = a[0]?.device ?? null;
    return orig.apply(this, a);
  });
  wrap(E, "finish", function (orig, a) {
    const cb = orig.apply(this, a);
    P.cbEnc.set(cb, this);
    return cb;
  });
  const bufId = (b) => {
    if (!P.bufIds.has(b)) P.bufIds.set(b, ++P.nextBuf);
    return P.bufIds.get(b);
  };
  // At the SUBMIT, the bytes every captured draw reads are what the queue holds:
  // every write the frame made is queued ahead of the command buffer.
  const snapRange = (rec, buffer, off, size) => {
    const m = P.mirrors.get(buffer);
    const key = `${bufId(buffer)}:${off}:${size ?? "*"}`;
    if (rec.snap.has(key)) return;
    if (!m) {
      rec.snap.set(key, null);
      return;
    }
    const end = size === undefined || size === null ? m.length : Math.min(m.length, off + size);
    rec.snap.set(key, m.slice(off, end));
  };
  const snapCmds = (rec, cmds) => {
    for (const c of cmds) {
      if (c[0] === "setBindGroup") {
        for (const e of P.bindGroups.get(c[2]) ?? []) {
          const res = e.resource;
          if (res && res.buffer) snapRange(rec, res.buffer, res.offset ?? 0, res.size);
          else if (res instanceof GPUBuffer) snapRange(rec, res, 0, undefined);
        }
      } else if (c[0] === "setVertexBuffer") {
        if (c[2]) snapRange(rec, c[2], c[3] ?? 0, c[4]);
      } else if (c[0] === "setIndexBuffer") {
        snapRange(rec, c[1], c[3] ?? 0, c[4]);
      } else if (c[0] === "drawIndirect" || c[0] === "drawIndexedIndirect") {
        snapRange(rec, c[1], c[2] ?? 0, c[0] === "drawIndirect" ? 16 : 20);
      } else if (c[0] === "executeBundles") {
        for (const b of c[1]) snapCmds(rec, P.bundles.get(b)?.cmds ?? []);
      }
    }
  };
  const hex = (buf) => {
    let s = "";
    for (let i = 0; i < buf.length; i++) s += buf[i].toString(16).padStart(2, "0");
    return s;
  };
  P.hex = hex;
  const sha = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  P.sha = sha;
  wrap(Q, "submit", function (orig, a) {
    const cbs = [...(a[0] ?? [])];
    const recs = [];
    for (const cb of cbs) {
      const enc = P.cbEnc.get(cb);
      if (enc && !P.encOrder.has(enc)) P.encOrder.set(enc, P.begun++);
      for (const rec of (enc && P.encPasses.get(enc)) ?? []) {
        rec.submitted = P.encOrder.get(enc);
        if (rec.full) {
          snapCmds(rec, rec.cmds);
          recs.push(rec);
        }
      }
    }
    const r = orig.apply(this, a);
    for (const rec of recs) {
      for (const x of rec.reads) {
        if (!x.buffer) continue;
        P.pending.push(
          x.buffer.mapAsync(1).then(async () => {
            const src = new Uint8Array(x.buffer.getMappedRange());
            const row = x.w * x.bpt;
            const tight = new Uint8Array(row * x.h);
            for (let y = 0; y < x.h; y++) tight.set(src.subarray(y * x.bpr, y * x.bpr + row), y * row);
            x.buffer.unmap();
            x.buffer.destroy();
            x.buffer = null;
            x.hash = await sha(tight);
          }),
        );
      }
    }
    return r;
  });

  // The frame: armed by the Node side for a capture, recorded live from the
  // first frame until the Node side says otherwise. Hooked the moment `Game`
  // publishes itself, which is after its post chain is built and before its
  // first frame.
  let game;
  Object.defineProperty(window, "__celshock", {
    configurable: true,
    get: () => game,
    set: (g) => {
      game = g;
      const e = g.engine;
      P.engine = e;
      e.onBeginFrameObservable.add(() => {
        P.frame++;
        if (P.arm > 0) {
          P.arm--;
          P.capture = true;
          P.frameRec = { frame: P.frame, passes: [] };
        }
      });
      e.onEndFrameObservable.add(() => {
        window.__postGpu?.refresh();
        if (P.capture) {
          P.frameRec.passes = P.frameOrder.splice(0);
          P.captured.push(P.frameRec);
          P.capture = false;
          P.frameRec = null;
        } else if (P.live) {
          const kept = [];
          for (const rec of P.frameOrder.splice(0)) {
            const stages = [...new Set(rec.pipes.map((p) => P.stageOfPipe(p)).filter(Boolean))];
            const named = rec.color.some((c) => c && window.__postGpu?.target(P.views.get(c.view)?.texture));
            const canvasOut = rec.color.some((c) => c && P.canvas.has(P.views.get(c.view)?.texture));
            if (stages.length || canvasOut || named) {
              kept.push({
                stages,
                out: rec.color.map((c) => (c ? P.nameOf(P.views.get(c.view)?.texture) : null)),
                load: rec.color.map((c) => (c ? c.loadOp : null)),
              });
            }
          }
          P.liveFrames.push({ f: P.frame, state: g.state, passes: kept });
          if (P.liveFrames.length > 4000) P.liveFrames.splice(0, 1000);
        } else {
          P.frameOrder.length = 0;
        }
      });
    },
  });
  P.frameOrder = [];
  // Passes join the frame's list as they begin; the list is put in submit
  // order at the capture's summary (`submitted`, then `seq`).
  const beginRenderPass = E.beginRenderPass;
  E.beginRenderPass = function (...a) {
    const pass = beginRenderPass.apply(this, a);
    const rec = P.passes.get(pass);
    if (rec) P.frameOrder.push(rec);
    return pass;
  };
  P.stageOfPipe = (p) => {
    const rec = P.pipelines.get(p);
    if (!rec) return null;
    const f = rec.desc?.fragment?.module;
    const v = rec.desc?.vertex?.module;
    return (f && window.__postGpu?.stage(f)) ?? (v && window.__postGpu?.stage(v)) ?? null;
  };
  P.nameOf = (t) => (!t ? null : window.__postGpu?.target(t) ?? (P.canvas.has(t) ? "canvas" : `-${t.format}`));
}

/**
 * The adapter (see the header), installed once the game is up. Babylon's arm:
 * the stages `Game` built, by object, and the targets they read and write.
 */
function postAdapter() {
  const g = window.__celshock;
  const P = window.__postProbe;
  const hw = (t) => t?._hardwareTexture?.underlyingResource ?? null;
  const babylon = {
    arm: "babylon",
    /** The chain's stages, each with what it draws with and into: the camera's list, then the glow's. */
    stages() {
      const cam = g.cameraSys.camera;
      const named = new Map([
        [g.celInk?.pass, "ink"],
        [g.fxaa, "fxaa"],
        [g.volumetrics?.pass, "shafts"],
        [g.motionBlur?.pass, "blur"],
        [g.post?.post, "grain"],
      ]);
      const out = [];
      const list = cam._postProcesses ?? [];
      for (const pp of list) {
        if (!pp) continue;
        out.push({ name: named.get(pp) ?? `pp:${pp.name}`, effect: pp.getEffect?.() ?? null, input: pp.inputTexture ?? null, pp });
      }
      // A pass built and not on the list (the shafts before their inputs
      // exist, a pass the player turned off) still has modules to name.
      for (const [pp, name] of named) {
        if (pp && !list.includes(pp)) out.push({ name, effect: pp.getEffect?.() ?? null, input: pp.inputTexture ?? null, pp, off: true });
      }
      const glow = g.glow;
      if (glow) {
        out.push({ name: "glow.down", effect: glow.downsample?.effect ?? null });
        // The four blurs are ONE program (the direction and the texel step are
        // uniforms; Babylon's effect cache hands all four the same effect), so
        // they are one stage, told apart by the target each draws into.
        for (const b of glow.blurs ?? []) out.push({ name: "glow.blur", effect: b.effect ?? null });
      }
      return out;
    },
    /**
     * Every target by what WRITES it, which is the one naming both arms can
     * share: `frame` (and `frame.depth`) is what the scene draws into — the
     * first live pass's input, in Babylon's chain — and `<stage>.out` is what a
     * stage draws into, Babylon's NEXT live pass's input; the last live
     * stage's out is the canvas (`canvas`, its depth the engine's own,
     * `canvas.depth`). The glow's are its own six.
     */
    targets() {
      const m = new Map();
      const live = babylon.stages().filter((s) => s.pp && !s.off);
      live.forEach((s, i) => {
        const t = hw(s.input?.texture);
        if (t) m.set(t, i === 0 ? "frame" : `${live[i - 1].name}.out`);
        const d = hw(s.input?._depthStencilTexture);
        if (d) m.set(d, i === 0 ? "frame.depth" : `${live[i - 1].name}.out.depth`);
      });
      if (g.engine._depthTexture) m.set(g.engine._depthTexture, "canvas.depth");
      const glow = g.glow;
      if (glow) {
        for (const k of ["mask", "down", "nearH", "near", "wideH", "wide"]) {
          const t = hw(glow[k]?.renderTarget?.texture);
          if (t) m.set(t, `glow.${k}`);
        }
      }
      return m;
    },
    /** The CPU facts a pass's draw does not show: Babylon's own fields. */
    chain() {
      const cam = g.cameraSys.camera;
      const scene = g.scene;
      const e = g.engine;
      const ipc = scene.imageProcessingConfiguration;
      const names = new Map(babylon.stages().filter((s) => s.pp).map((s) => [s.pp, s.name]));
      const pass = (pp) => ({
        stage: names.get(pp) ?? null,
        name: pp.name,
        width: pp.width,
        height: pp.height,
        samplingMode: pp.renderTargetSamplingMode,
        textureType: pp._textureType,
        textureFormat: pp._textureFormat,
        alphaMode: pp.alphaMode,
        autoClear: pp.autoClear,
        clearColor: pp.clearColor ? [pp.clearColor.r, pp.clearColor.g, pp.clearColor.b, pp.clearColor.a] : null,
        reusable: pp._reusable,
        samples: pp._samples ?? pp.samples,
        size: pp._options,
        scaleMode: pp.scaleMode,
        alwaysForcePOT: pp.alwaysForcePOT,
        pixelPerfect: pp.enablePixelPerfectMode,
        fullscreenViewport: pp.forceFullscreenViewport,
        textures: pp._textures?.length ?? null,
        input: pp.inputTexture ? { width: pp.inputTexture.width, height: pp.inputTexture.height, depth: Boolean(pp.inputTexture._depthStencilTexture) } : null,
        ready: pp.isReady?.() ?? null,
      });
      const glow = g.glow;
      const rt = (t) => (t ? { width: t.getSize().width, height: t.getSize().height, samplingMode: t.samplingMode, wrapU: t.wrapU, wrapV: t.wrapV } : null);
      return {
        list: (cam._postProcesses ?? []).map((pp, i) => (pp ? { index: i, ...pass(pp) } : { index: i, hole: true })),
        off: [g.fxaa, g.volumetrics?.pass, g.motionBlur?.pass, g.post?.post].filter((pp) => pp && !(cam._postProcesses ?? []).includes(pp)).map(pass),
        slots: { fxaa: g.fxaaSlot, shafts: g.volumetricsSlot, shaftsAttached: g.volumetricsAttached, fxaaAttached: g.fxaaAttached, blurEnabled: g.motionBlur?.isEnabled, grade: { enabled: g.post?.enabled, attached: g.post?.attached, damage: g.post?.damage } },
        shaftsRung: g.volumetricsRung ?? null,
        glow: glow
          ? {
              rung: glow.rung,
              kernel: (glow.blurs ?? []).map((b) => b.kernel),
              blurReady: (glow.blurs ?? []).map((b) => b.isReady?.() ?? null),
              downReady: glow.downsample?.isReady?.() ?? null,
              targets: Object.fromEntries(["mask", "down", "nearH", "near", "wideH", "wide"].map((k) => [k, rt(glow[k])])),
            }
          : null,
        hardwareScalingLevel: e.getHardwareScalingLevel(),
        renderSize: [e.getRenderWidth(), e.getRenderHeight()],
        renderSizeTrue: [e.getRenderWidth(true), e.getRenderHeight(true)],
        canvasSize: [g.engine.getRenderingCanvas()?.width ?? null, g.engine.getRenderingCanvas()?.height ?? null],
        devicePixelRatio: window.devicePixelRatio,
        autoClear: scene.autoClear,
        autoClearDepthAndStencil: scene.autoClearDepthAndStencil,
        clearColor: [scene.clearColor.r, scene.clearColor.g, scene.clearColor.b, scene.clearColor.a],
        imageProcessing: ipc
          ? {
              isEnabled: ipc.isEnabled,
              applyByPostProcess: ipc.applyByPostProcess,
              exposure: ipc.exposure,
              contrast: ipc.contrast,
              toneMappingEnabled: ipc.toneMappingEnabled,
              toneMappingType: ipc.toneMappingType,
              vignetteEnabled: ipc.vignetteEnabled,
              colorCurvesEnabled: ipc.colorCurvesEnabled,
              colorGradingEnabled: ipc.colorGradingEnabled,
              ditheringEnabled: ipc.ditheringEnabled,
              skipFinalColorClamp: ipc.skipFinalColorClamp,
            }
          : null,
        frameDepth: g.frameDepth?.texture ? { width: g.frameDepth.texture.getSize?.().width ?? null, height: g.frameDepth.texture.getSize?.().height ?? null, isInkDepth: g.frameDepth.source === g.celInk?.pass?.inputTexture?._depthStencilTexture } : null,
      };
    },
  };
  // The one map the probe asks, rebuilt at every refresh: a module named once
  // keeps its name, so a stage whose effect was replaced (a recompiled kernel)
  // still names the draws its old module made.
  let targets = new Map();
  window.__postGpu = {
    arm: babylon.arm,
    refresh() {
      for (const s of babylon.stages()) {
        const st = s.effect?._pipelineContext?.stages;
        if (st?.vertexStage?.module) P.stageOf.set(st.vertexStage.module, s.name);
        if (st?.fragmentStage?.module) P.stageOf.set(st.fragmentStage.module, s.name);
      }
      targets = babylon.targets();
    },
    stage: (m) => P.stageOf.get(m) ?? null,
    target: (t) => targets.get(t) ?? null,
    chain: () => babylon.chain(),
    stages: () => babylon.stages().map((s) => ({ name: s.name, ready: s.effect?.isReady?.() ?? false, off: Boolean(s.off) })),
  };
  window.__postGpu.refresh();
}

const vite = await startDevServer(root);
const browser = await launchClient({ headed: false });
const SEED = 5101;
const enc = (x) =>
  typeof x === "number" ? (Object.is(x, -0) ? "-0" : Number.isNaN(x) ? "NaN" : x === Infinity ? "Inf" : x === -Infinity ? "-Inf" : x) : Array.isArray(x) ? x.map(enc) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, enc(v)])) : x;

const report = { seed: SEED, map: "hollowmere", base: BASE, sizes: {} };
let pageErrors = [];
let consoleErrors = [];

for (const sizeId of SIZE_IDS) {
  const size = SIZES[sizeId];
  if (!size) throw new Error(`no size "${sizeId}" (${Object.keys(SIZES).join(", ")})`);
  const booted = await bootMap(browser, `${vite.url}${vite.url.endsWith("/") ? "" : "/"}?seed=${SEED}`, "hollowmere", {
    init: deviceProbe,
    viewport: size.viewport,
    deviceScaleFactor: size.deviceScaleFactor,
  });
  const { page } = booted;
  pageErrors = booted.pageErrors;
  consoleErrors = booted.consoleErrors;
  page.on("dialog", (d) => void d.accept());
  page.on("pageerror", (e) => console.error(`[${sizeId}] page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && console.error(`[${sizeId}] console: ${m.text().slice(0, 300)}`));
  console.error(`[${sizeId}] booted`);
  await page.evaluate(postAdapter);
  const out = { size, statics: null, scenarios: {}, live: {} };
  report.sizes[sizeId] = out;

  await installRound(page);
  console.error(`[${sizeId}] deploy`);
  await settleLive(page, 30);
  if (LIVE) out.live.boot = await takeLive(page);

  for (const sc of SCENARIOS) {
    await thaw(page);
    console.error(`[${sizeId}] ${sc.id}: place`);
    await placeVantage(page, { id: `probe-${sc.id}`, ...EYE, settings: { ...BASE, ...(sc.settings ?? {}) } });
    await waitUntilDrawn(page);
    console.error(`[${sizeId}] ${sc.id}: drawn`);
    await allReady(page);
    console.error(`[${sizeId}] ${sc.id}: ready`);
    await settle(page, CONVERGE_FRAMES);
    await freeze(page, FREEZE_SET, { turn: sc.turn ?? 0, damage: sc.damage ?? false });
    await settle(page, SETTLE_FRAMES);
    console.error(`[${sizeId}] ${sc.id}: frozen`);
    const [a, b] = await capture(page, 2);
    const steady = JSON.stringify(a.frame) === JSON.stringify(b.frame);
    out.scenarios[sc.id] = { steady, chain: b.chain, passes: b.frame.passes };
    const canvas = b.frame.passes.flatMap((p) => p.out).filter((o) => o.target === "canvas").pop();
    console.log(`${sizeId.padEnd(5)} ${sc.id.padEnd(16)} ${steady ? "steady" : "NOT STEADY"}  ${b.frame.passes.length} passes, canvas ${canvas?.hash?.slice(0, 16) ?? "?"}  chain [${b.chain.list.map((x) => (x.hole ? "_" : x.stage)).join(" ")}]`);
  }
  out.statics = await statics(page);
  await thaw(page);

  if (LIVE) {
    // In play: a shafts rung change, a render-scale change, a glow rung change
    // and a resize, thirty frames after each, in the held deploy world.
    const change = async (label, fn) => {
      await page.evaluate(() => (window.__postProbe.liveFrames.length = 0));
      await page.evaluate(fn);
      await settleLive(page, 30);
      out.live[label] = await takeLive(page);
    };
    await page.evaluate(() => {
      const P = window.__postProbe;
      P.live = true;
      P.liveFrames.length = 0;
    });
    await change("shafts-low-to-high", () => {
      const g = window.__celshock;
      g.setSetting("volumetrics", "low");
      return new Promise((r) => g.engine.onEndFrameObservable.addOnce(() => r(g.setSetting("volumetrics", "high"))));
    });
    await change("scale-to-75", () => window.__celshock.setSetting("renderScale", 0.75));
    await change("glow-to-low", () => window.__celshock.setSetting("glow", "low"));
    if (sizeId === "desk") {
      await page.evaluate(() => (window.__postProbe.liveFrames.length = 0));
      await page.setViewportSize({ width: 1280, height: 721 });
      await settleLive(page, 30);
      out.live["resize-1280x721"] = await takeLive(page);
    }
  }
  if (pageErrors.length) out.pageErrors = pageErrors.slice(0, 5);
  if (consoleErrors.length) out.consoleErrors = consoleErrors.slice(0, 5);
  await page.close();
}

printReport(report);
const clean = enc(report);
if (OUT) writeFileSync(OUT, JSON.stringify(clean));
let failed = false;
if (AGAINST) failed = compareLogs(clean, JSON.parse(readFileSync(AGAINST, "utf8")));
for (const [id, s] of Object.entries(report.sizes)) {
  if (s.pageErrors || s.consoleErrors) {
    console.log(`${id}: ${s.pageErrors?.length ?? 0} page errors, ${s.consoleErrors?.length ?? 0} console errors`);
    for (const e of [...(s.pageErrors ?? []), ...(s.consoleErrors ?? [])]) console.log(`  ${String(e).slice(0, 300)}`);
    failed = true;
  }
  for (const [k, sc] of Object.entries(s.scenarios)) if (!sc.steady) {
    console.log(`${id}/${k}: the two captured frames differ`);
    failed = true;
  }
}
await browser.close();
vite.stop();
process.exit(failed ? 1 : 0);

/** Lets `n` frames pass with the render loop running (the live half's clock). */
function settleLive(page, n) {
  return page.evaluate(
    (n) =>
      new Promise((res) => {
        const e = window.__celshock.engine;
        let seen = 0;
        const o = e.onEndFrameObservable.add(() => {
          if (++seen < n) return;
          e.onEndFrameObservable.remove(o);
          res();
        });
      }),
    n,
  );
}

/** Every stage's effect compiled — Babylon skips a pass that is not, leaving its target cleared. */
function allReady(page) {
  return page.evaluate(
    () =>
      new Promise((res, rej) => {
        const e = window.__celshock.engine;
        let n = 0;
        const check = () => {
          window.__postGpu.refresh();
          if (window.__postGpu.stages().every((s) => s.ready || s.off)) return res(n);
          if (++n > 1200) return rej(new Error(`post stages never ready: ${JSON.stringify(window.__postGpu.stages())}`));
          e.onEndFrameObservable.addOnce(check);
        };
        check();
      }),
  );
}

/** The live frames recorded since the last take, named, and the pipelines made in them. */
function takeLive(page) {
  return page.evaluate(() => {
    const P = window.__postProbe;
    window.__postGpu.refresh();
    const frames = P.liveFrames.splice(0);
    const from = frames[0]?.f ?? 0;
    const pipes = P.pipelineList.filter((r) => r.frame >= from).map((r) => ({ frame: r.frame, call: r.call, stage: (r.desc?.fragment?.module && window.__postGpu.stage(r.desc.fragment.module)) ?? null })).filter((r) => r.stage);
    const first = frames[0]?.f ?? 0;
    return {
      from: first,
      frames: frames.map((f) => ({ f: f.f - first, state: f.state, passes: f.passes.map((p) => `${p.stages.join("+") || "-"}>${p.out.join(",")}${p.load.includes("clear") ? "/clear" : ""}`) })),
      pipelines: pipes,
    };
  });
}

/** Arms `n` consecutive frames, waits for them and their readbacks, and summarises each. */
async function capture(page, n) {
  return page.evaluate(async (n) => {
    const P = window.__postProbe;
    const g = window.__celshock;
    const live = P.live;
    P.live = false;
    P.captured.length = 0;
    P.arm = n;
    await new Promise((res) => {
      const o = g.engine.onEndFrameObservable.add(() => {
        if (P.captured.length < n) return;
        g.engine.onEndFrameObservable.remove(o);
        res();
      });
    });
    await Promise.all(P.pending.splice(0));
    P.live = live;
    window.__postGpu.refresh();
    const tokens = (c) => c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").match(/[A-Za-z_][A-Za-z0-9_]*|[0-9][0-9A-Za-z_.]*|\S/g) ?? [];
    const enc = new TextEncoder();
    P.moduleKeys ??= new WeakMap();
    P.moduleTable ??= {};
    const moduleKey = async (m) => {
      if (!m) return null;
      if (P.moduleKeys.has(m)) return P.moduleKeys.get(m);
      const rec = P.modules.get(m);
      if (!rec) return "unwrapped";
      const t = tokens(rec.code);
      const key = (await P.sha(enc.encode(t.join(" ")))).slice(0, 24);
      P.moduleKeys.set(m, key);
      P.moduleTable[key] ??= { stage: window.__postGpu.stage(m), tokens: t.length, length: rec.code.length, textHash: (await P.sha(enc.encode(rec.code))).slice(0, 24), text: rec.code };
      return key;
    };
    const texDesc = (t) => (t ? { target: P.nameOf(t), format: t.format, size: [t.width, t.height, t.depthOrArrayLayers], mips: t.mipLevelCount, samples: t.sampleCount, dimension: t.dimension, usage: t.usage } : null);
    const viewDesc = (view) => {
      const v = P.views.get(view);
      if (!v) return { unwrapped: true };
      const t = v.texture;
      const d = v.desc;
      return {
        ...texDesc(t),
        view: { format: d.format ?? t.format, dimension: d.dimension ?? null, aspect: d.aspect ?? "all", baseMipLevel: d.baseMipLevel ?? 0, mipLevelCount: d.mipLevelCount ?? null, baseArrayLayer: d.baseArrayLayer ?? 0, arrayLayerCount: d.arrayLayerCount ?? null },
      };
    };
    const SAMPLER_DEFAULTS = { addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", addressModeW: "clamp-to-edge", magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest", lodMinClamp: 0, lodMaxClamp: 32, compare: null, maxAnisotropy: 1 };
    const samplerDesc = (s) => {
      const d = P.samplers.get(s);
      if (!d) return { unwrapped: true };
      const o = {};
      for (const [k, def] of Object.entries(SAMPLER_DEFAULTS)) o[k] = d[k] ?? def;
      return o;
    };
    const bufDesc = (rec, b, off, size) => {
      const key = `${P.bufIds.get(b) ?? "?"}:${off}:${size ?? "*"}`;
      const bytes = rec.snap.get(key);
      return { offset: off, size: size ?? null, bufferSize: b.size, usage: b.usage, bytes: bytes === undefined ? "unsnapped" : bytes === null ? "unmirrored" : bytes.length <= 2048 ? P.hex(bytes) : `sha:${(await0(bytes))}` };
    };
    // Large mirrored ranges are hashed; small ones are written out byte for byte.
    const bigs = [];
    const await0 = (bytes) => {
      const i = bigs.length;
      bigs.push(bytes);
      return `#${i}`;
    };
    const layoutDesc = (layout) => {
      if (layout === "auto" || layout === undefined) return "auto";
      const groups = P.layouts.get(layout);
      if (!groups) return "unwrapped";
      return groups.map((bgl) =>
        (P.bgls.get(bgl) ?? []).map((e) => ({
          binding: e.binding,
          visibility: e.visibility,
          buffer: e.buffer ? { type: e.buffer.type ?? "uniform", hasDynamicOffset: e.buffer.hasDynamicOffset ?? false, minBindingSize: e.buffer.minBindingSize ?? 0 } : undefined,
          sampler: e.sampler ? { type: e.sampler.type ?? "filtering" } : undefined,
          texture: e.texture ? { sampleType: e.texture.sampleType ?? "float", viewDimension: e.texture.viewDimension ?? "2d", multisampled: e.texture.multisampled ?? false } : undefined,
          storageTexture: e.storageTexture ? { access: e.storageTexture.access ?? "write-only", format: e.storageTexture.format, viewDimension: e.storageTexture.viewDimension ?? "2d" } : undefined,
        })),
      );
    };
    const pipelineDesc = async (p) => {
      const r = P.pipelines.get(p);
      if (!r) return { unwrapped: true };
      const d = r.desc;
      const prim = d.primitive ?? {};
      const ds = d.depthStencil;
      const ms = d.multisample ?? {};
      const face = (f) => (f ? { compare: f.compare ?? "always", failOp: f.failOp ?? "keep", depthFailOp: f.depthFailOp ?? "keep", passOp: f.passOp ?? "keep" } : null);
      return {
        call: r.call,
        vertex: {
          module: await moduleKey(d.vertex?.module),
          entryPoint: d.vertex?.entryPoint ?? null,
          constants: d.vertex?.constants ?? null,
          buffers: (d.vertex?.buffers ?? []).map((b) => (b ? { arrayStride: b.arrayStride, stepMode: b.stepMode ?? "vertex", attributes: (b.attributes ?? []).map((a) => ({ format: a.format, offset: a.offset, shaderLocation: a.shaderLocation })) } : null)),
        },
        fragment: d.fragment
          ? {
              module: await moduleKey(d.fragment.module),
              entryPoint: d.fragment.entryPoint ?? null,
              constants: d.fragment.constants ?? null,
              targets: (d.fragment.targets ?? []).map((t) => (t ? { format: t.format, blend: t.blend ?? null, writeMask: t.writeMask ?? 0xf } : null)),
            }
          : null,
        primitive: { topology: prim.topology ?? "triangle-list", stripIndexFormat: prim.stripIndexFormat ?? null, frontFace: prim.frontFace ?? "ccw", cullMode: prim.cullMode ?? "none", unclippedDepth: prim.unclippedDepth ?? false },
        depthStencil: ds
          ? { format: ds.format, depthWriteEnabled: ds.depthWriteEnabled ?? null, depthCompare: ds.depthCompare ?? null, stencilFront: face(ds.stencilFront), stencilBack: face(ds.stencilBack), stencilReadMask: ds.stencilReadMask ?? 0xffffffff, stencilWriteMask: ds.stencilWriteMask ?? 0xffffffff, depthBias: ds.depthBias ?? 0, depthBiasSlopeScale: ds.depthBiasSlopeScale ?? 0, depthBiasClamp: ds.depthBiasClamp ?? 0 }
          : null,
        multisample: { count: ms.count ?? 1, mask: ms.mask ?? 0xffffffff, alphaToCoverageEnabled: ms.alphaToCoverageEnabled ?? false },
        layout: layoutDesc(d.layout),
      };
    };
    const summarise = async (fr) => {
      bigs.length = 0;
      const recs = [...fr.passes].sort((a, b) => (a.submitted ?? 1e9) - (b.submitted ?? 1e9) || a.seq - b.seq);
      const passes = [];
      for (const rec of recs) {
        const draws = [];
        const stages = new Set();
        let total = 0;
        // Replayed in the order the GPU sees: the pass's own commands, a
        // bundle's in place where the pass executes it (state is reset at a
        // bundle's start and end, as WebGPU resets it).
        const walk = async (cmds, st) => {
          for (const c of cmds) {
            const k = c[0];
            if (k === "setPipeline") st.pipeline = c[1];
            else if (k === "setBindGroup") st.groups[c[1]] = [c[2], c[3]];
            else if (k === "setVertexBuffer") st.vbs[c[1]] = [c[2], c[3] ?? 0, c[4]];
            else if (k === "setIndexBuffer") st.ib = [c[1], c[2], c[3] ?? 0, c[4]];
            else if (k === "setViewport") st.viewport = c.slice(1);
            else if (k === "setScissorRect") st.scissor = c.slice(1);
            else if (k === "setBlendConstant") st.blend = c[1];
            else if (k === "setStencilReference") st.stencil = c[1];
            else if (k === "executeBundles") {
              for (const b of c[1]) {
                const br = P.bundles.get(b);
                if (!br) {
                  draws.push({ unwrappedBundle: true });
                  continue;
                }
                await walk(br.cmds, { pipeline: null, groups: [], vbs: [], ib: null, viewport: st.viewport, scissor: st.scissor, blend: st.blend, stencil: st.stencil, bundle: br.desc });
              }
            } else if (k.startsWith("draw")) {
              total++;
              const stage = P.stageOfPipe(st.pipeline);
              stages.add(stage ?? "-");
              if (!stage) continue;
              const groups = [];
              for (let i = 0; i < st.groups.length; i++) {
                const gr = st.groups[i];
                if (!gr) continue;
                const entries = [];
                for (const e of P.bindGroups.get(gr[0]) ?? []) {
                  const res = e.resource;
                  if (P.samplers.has(res)) entries.push({ binding: e.binding, sampler: samplerDesc(res) });
                  else if (P.views.has(res)) entries.push({ binding: e.binding, view: viewDesc(res) });
                  else if (res && res.buffer) entries.push({ binding: e.binding, buffer: bufDesc(rec, res.buffer, res.offset ?? 0, res.size) });
                  else if (res instanceof GPUBuffer) entries.push({ binding: e.binding, buffer: bufDesc(rec, res, 0, undefined) });
                  else if (res instanceof GPUTexture) entries.push({ binding: e.binding, texture: texDesc(res) });
                  else entries.push({ binding: e.binding, unknown: String(res) });
                }
                groups.push({ index: i, dynamicOffsets: gr[1], entries });
              }
              const ind = k.endsWith("Indirect") ? bufDesc(rec, c[1], c[2] ?? 0, k === "drawIndirect" ? 16 : 20) : null;
              draws.push({
                stage,
                pipeline: await pipelineDesc(st.pipeline),
                bindGroups: groups,
                vertexBuffers: st.vbs.map((v, i) => (v ? { slot: i, ...bufDesc(rec, v[0], v[1], v[2]) } : null)),
                index: st.ib ? { format: st.ib[1], ...bufDesc(rec, st.ib[0], st.ib[2], st.ib[3]) } : null,
                viewport: st.viewport ?? null,
                scissor: st.scissor ?? null,
                blendConstant: st.blend ?? null,
                stencilReference: st.stencil ?? null,
                bundle: st.bundle ?? null,
                draw: { call: k, args: ind ? ind.bytes : c.slice(1) },
              });
            }
          }
        };
        await walk(rec.cmds, { pipeline: null, groups: [], vbs: [], ib: null, viewport: null, scissor: null, blend: null, stencil: null, bundle: null });
        const att = (view) => viewDesc(view);
        passes.push({
          role: rec.role,
          label: String(rec.label).replace(/^\[[^\]]*\]\s*-\s*/, "").replace(/\d+/g, "#"),
          color: rec.color.map((c) => (c ? { ...att(c.view), loadOp: c.loadOp, storeOp: c.storeOp, clear: c.clear, resolve: c.resolve ? att(c.resolve) : null, depthSlice: c.depthSlice } : null)),
          depth: rec.depth
            ? {
                ...att(rec.depth.view),
                depthLoadOp: rec.depth.depthLoadOp ?? null,
                depthStoreOp: rec.depth.depthStoreOp ?? null,
                depthClearValue: rec.depth.depthClearValue ?? null,
                depthReadOnly: rec.depth.depthReadOnly ?? false,
                stencilLoadOp: rec.depth.stencilLoadOp ?? null,
                stencilStoreOp: rec.depth.stencilStoreOp ?? null,
                stencilClearValue: rec.depth.stencilClearValue ?? null,
                stencilReadOnly: rec.depth.stencilReadOnly ?? false,
              }
            : null,
          drawCount: total,
          stages: [...stages],
          out: rec.reads.map((x) => ({ which: x.which, target: x.skip ? null : P.nameOf(P.views.get(x.which === "depth" ? rec.depth.view : rec.color[Number(x.which.slice(5))].view)?.texture), size: x.skip ? null : [x.w, x.h], hash: x.skip ? `skip:${x.skip}` : x.hash })),
          draws,
        });
      }
      // The big ranges' hashes, filled in where each was named.
      const hashes = await Promise.all(bigs.map((b) => P.sha(b)));
      const fill = (o) => {
        if (Array.isArray(o)) return o.map(fill);
        if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fill(v)]));
        if (typeof o === "string" && /^sha:#\d+$/.test(o)) return `sha:${hashes[Number(o.slice(5))]}`;
        return o;
      };
      return { passes: fill(passes) };
    };
    const frames = [];
    for (const fr of P.captured.splice(0)) frames.push(await summarise(fr));
    const chain = window.__postGpu.chain();
    return frames.map((frame) => ({ frame, chain }));
  }, n);
}

/** Once a boot: the device, the canvas, the engine, and the module table. */
function statics(page) {
  return page.evaluate(async () => {
    const P = window.__postProbe;
    const g = window.__celshock;
    const dev = g.engine._device;
    const lim = {};
    for (const k of ["maxInterStageShaderVariables", "maxInterStageShaderComponents", "maxColorAttachments", "maxSampledTexturesPerShaderStage", "maxSamplersPerShaderStage", "maxUniformBufferBindingSize", "maxTextureDimension2D", "maxBindGroups"]) lim[k] = dev.limits?.[k] ?? null;
    // What Babylon's FXAA reads to decide its `MALI` define
    // (`ThinFXAAPostProcess._GetDefines`): the engine's driver info.
    let driverInfo = null;
    try {
      driverInfo = g.engine.extractDriverInfo?.() ?? null;
    } catch (e) {
      driverInfo = `throws: ${e.message}`;
    }
    return {
      limits: lim,
      preferredCanvasFormat: navigator.gpu.getPreferredCanvasFormat(),
      context: P.context,
      driverInfo,
      compatibilityMode: g.engine.compatibilityMode,
      depthFormat: g.engine._mainRenderPassWrapper?.depthTextureFormat ?? null,
      modules: P.moduleTable ?? {},
    };
  });
}

/** What a reader looks at first: per scenario, the passes the chain drew and their outputs. */
function printReport(r) {
  for (const [id, s] of Object.entries(r.sizes)) {
    console.log(`\n== ${id} (${s.size.viewport.width}x${s.size.viewport.height} at ${s.size.deviceScaleFactor}) ==`);
    const st = s.statics;
    if (st) {
      console.log(`device: maxInterStageShaderVariables ${st.limits.maxInterStageShaderVariables}, canvas ${JSON.stringify(st.context)}, preferred ${st.preferredCanvasFormat}, depth ${st.depthFormat}, driver info ${JSON.stringify(st.driverInfo)}`);
      for (const [k, m] of Object.entries(st.modules)) console.log(`  module ${k} ${m.stage}: ${m.tokens} tokens, ${m.length} chars`);
    }
    for (const [k, sc] of Object.entries(s.scenarios)) {
      const c = sc.chain;
      console.log(`-- ${k}: level ${c.hardwareScalingLevel}, render ${c.renderSize.join("x")}, autoClear ${c.autoClear}, chain [${c.list.map((x) => (x.hole ? "_" : `${x.index}:${x.stage}`)).join(" ")}]${c.glow ? `, glow ${c.glow.rung} kernel ${c.glow.kernel.join("/")}` : ""}`);
      for (const p of sc.passes) {
        if (p.stages.every((x) => x === "-") && !p.out.some((o) => o.target === "canvas" || (o.target && o.target !== "canvas" && !o.target.startsWith("-")))) continue;
        const col = p.color.map((c) => (c ? `${c.target}(${c.format} ${c.size[0]}x${c.size[1]} ${c.loadOp}${c.clear ? `[${c.clear.join(",")}]` : ""})` : "-")).join(" ");
        const dep = p.depth ? ` depth ${p.depth.target}(${p.depth.format} ${p.depth.depthLoadOp ?? "-"}/${p.depth.depthStoreOp ?? "-"}${p.depth.depthReadOnly ? " ro" : ""})` : "";
        console.log(`   ${p.role} [${p.stages.join("+")}] ${p.drawCount} draws -> ${col}${dep}`);
        for (const d of p.draws) {
          const samp = d.bindGroups.flatMap((gr) => gr.entries.filter((e) => e.sampler).map((e) => `${gr.index}.${e.binding}:${e.sampler.minFilter}/${e.sampler.magFilter}/${e.sampler.addressModeU}`));
          console.log(`      ${d.stage}: ${d.draw.call}(${JSON.stringify(d.draw.args)}) cull ${d.pipeline.primitive.cullMode} ${d.pipeline.primitive.frontFace} depth ${d.pipeline.depthStencil ? `${d.pipeline.depthStencil.format} w${d.pipeline.depthStencil.depthWriteEnabled} ${d.pipeline.depthStencil.depthCompare}` : "none"} blend ${JSON.stringify(d.pipeline.fragment?.targets?.[0]?.blend ?? null)} samplers ${samp.join(" ")}`);
        }
      }
    }
    for (const [k, l] of Object.entries(s.live ?? {})) {
      console.log(`-- live ${k}: ${l.frames.length} frames from ${l.from}`);
      let last = null;
      for (const f of l.frames) {
        const line = `${f.state} ${f.passes.join(" | ")}`;
        if (line !== last) console.log(`   +${f.f}: ${line}`);
        last = line;
      }
    }
  }
}

/**
 * Two logs, compared: every size's statics and every scenario's chain and
 * passes, by `Object.is` on numbers and equality on strings. The live half
 * rides the machine's timing and is printed, not compared. Returns true on a
 * difference.
 */
function compareLogs(a, b) {
  let failed = false;
  const say = (m) => {
    console.log(`against: ${m}`);
    failed = true;
  };
  const walk = (x, y, path) => {
    if (typeof x !== typeof y) return `${path} is ${JSON.stringify(x)?.slice(0, 120)} here and ${JSON.stringify(y)?.slice(0, 120)} there`;
    if (Array.isArray(x)) {
      if (!Array.isArray(y) || x.length !== y.length) return `${path} has length ${x.length} here and ${y?.length} there`;
      for (let i = 0; i < x.length; i++) {
        const d = walk(x[i], y[i], `${path}[${i}]`);
        if (d) return d;
      }
      return null;
    }
    if (x && typeof x === "object") {
      const keys = new Set([...Object.keys(x), ...Object.keys(y ?? {})]);
      for (const k of keys) {
        const d = walk(x[k], y?.[k], `${path}.${k}`);
        if (d) return d;
      }
      return null;
    }
    return Object.is(x, y) ? null : `${path} is ${JSON.stringify(x)?.slice(0, 120)} here and ${JSON.stringify(y)?.slice(0, 120)} there`;
  };
  const count = (v) => (Array.isArray(v) ? v.reduce((s, e) => s + count(e), 0) : v && typeof v === "object" ? Object.values(v).reduce((s, e) => s + count(e), 0) : 1);
  if (a.seed !== b.seed || a.map !== b.map) say(`logged on ${a.map} under seed ${a.seed} here, ${b.map} and ${b.seed} there`);
  const d0 = walk(a.base, b.base, "base");
  if (d0) say(d0);
  for (const id of new Set([...Object.keys(a.sizes), ...Object.keys(b.sizes)])) {
    const x = a.sizes[id];
    const y = b.sizes[id];
    if (!x || !y) {
      say(`size ${id} is logged on one side only`);
      continue;
    }
    const before = failed;
    failed = false;
    let compared = 0;
    const statics = (s) => ({ ...s.statics, modules: Object.fromEntries(Object.entries(s.statics?.modules ?? {}).map(([k, m]) => [k, { ...m }])) });
    const ds = walk(statics(x), statics(y), `${id}.statics`);
    if (ds) say(ds);
    else compared += count(statics(x));
    for (const k of new Set([...Object.keys(x.scenarios), ...Object.keys(y.scenarios)])) {
      const e = walk(x.scenarios[k], y.scenarios[k], `${id}.${k}`);
      if (e) say(e);
      else compared += count(x.scenarios[k]);
    }
    console.log(`against ${id}: ${failed ? "DIFFERS (above)" : `equal, ${compared} values over its statics and every scenario's passes`}`);
    failed = failed || before;
  }
  if (!failed) console.log("against: equal");
  return failed;
}
