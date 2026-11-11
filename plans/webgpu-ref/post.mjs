/**
 * The post chain, read off the DEVICE pass by pass: what `BABYLON_EXIT.md`
 * X5.2b to X5.2d must reproduce when the chain's passes become our draws, read
 * off the parent rather than argued (X5.2a, which built it and measured with it).
 *
 * Run with `node plans/webgpu-ref/post.mjs [--sizes=desk,phone] [--out=f.json]
 * [--against=f.json] [--ignore=pattern,…|@file] [--max-diffs=40] [--no-live]`,
 * or with no browser at all as `node plans/webgpu-ref/post.mjs
 * --compare=a.json --against=b.json [--ignore=…]`, which compares two logs
 * this file wrote (how the comparison is shown to FAIL on a hand-edited copy).
 * Nothing in the repository is written but `--out`. About 25 minutes on the
 * Windows box for both sizes, the live half's second page included.
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
 * BYTES bound, as the queue held them at the submit; the binding copied as it
 * was handed, since Babylon rewrites the object for its next group — X5.2b), the vertex and index
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
 * `chain()` (the CPU facts above). **BABYLON's arm**, and since X5.2b OURS
 * for the glow's box filter and four blurs (`Game.glowBlur`,
 * `render/GlowBlur.ts`: its modules named off the labels our pipeline cache
 * gave them, `glow down: …` and `glow blur <width>: …`, the kernel and the
 * readiness `chain()` reports off `GlowPass.blurKernel` and the blur's own
 * asks; the targets are still `GlowPass`'s, which binds each pass). Babylon's:
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
 * `glow.near`, `glow.wideH`, `glow.wide`). The INPUTS a stage reads and no
 * stage writes are named by their producer, so a change in how a stage
 * reaches one (X5.2c2's `own ?? hostTexture`) is compared by name rather than
 * by format and size: the shafts' `shadow.world` and `shadow.bodies` and
 * Sky's `cloud.field` (`input(texture)` says a name is one of these, which
 * the live half does not count as a chain pass). **A sub-step that moves a
 * stage adds OURS**, picked first for that stage, with the same names: a draw
 * of ours is then logged under the name the Babylon draw it replaced was, so
 * `--against` its parent compares the two draw for draw. The GPU side is read
 * the same whoever records: everything below `__postGpu` is the device.
 * **`harness.mjs` has an adapter of the same name and shape**
 * (`postAdapter`, `window.__refPost`): the chain's CPU half the bank's
 * `freeze` holds. The two are separate on purpose (this one exists only on a
 * probe's page) and a sub-step that moves a stage adds ours to BOTH (this one
 * from X5.2b, that one from X5.2c1). **Since X5.2c1 ours names the GRADE**
 * (`grain`, a stage of `Game.postChain`, `render/PostChain.ts`): its modules off
 * the labels our cache gave them (`paperGrain: …`), its readiness off
 * `PostChain.drawsReady`, and the target it reads — the prefix's output,
 * `PostPasses.prefixTarget`, which Babylon's last live pass writes — named
 * `<that pass>.out`, as that pass's next input was. **Since X5.2c2 it names
 * the SHAFTS and the BLUR too** (`shafts`, one stage a rung, its modules
 * `volumetrics_<rung>: …`; `blur`, `motionBlur: …`), and every target of
 * the chain's POOL by the stage that writes it this frame (`<stage>.out`,
 * `PostPasses.poolTarget`: one target a pass position, so each has one writer).
 * **Since X5.2d it names the INK** (`ink`, the chain's first stage, its
 * modules `celInk: …`) and the FRAME (`frame` and `frame.depth`: the render
 * target the scene draws into, the camera's `outputRenderTarget`,
 * `PostPasses.frameTarget`), so no Babylon pass is left for Babylon's arm to
 * name but the glow's mask's targets, which are `GlowPass`' own. **Since
 * X5.4e those are OURS too** — the frame, its depth and the glow's six
 * (`Game.renderer.targets`, `render/FrameTargets.ts`), named by their GPU
 * textures under the same names — and their passes are recorded on Babylon's
 * UPLOAD encoder (their `role`), and `chain()` reads ours where Babylon's
 * render targets were (the glow's target sizes, the frame's depth), null for
 * the three Babylon sampling fields ours has no counterpart of. **Since X5.4f
 * the POOL and the canvas's pass are ours** (`Game.chainPasses`,
 * `render/ChainPasses.ts`): a pool target named by its GPU texture (its
 * `texture`, where Babylon's was its render target's internal texture), the
 * canvas's depth through the frame adapter's `canvasDepth` (our pass owner's,
 * where it was the engine's), and every chain pass recorded on the UPLOAD
 * encoder too — the render encoder holds nothing.
 *
 * **Since X5.4a the log holds the WHOLE frame** (X5.4e's to X5.4h's BEFORE),
 * beside the passes above and without moving them: each scenario's `whole` is
 * the second captured frame in SUBMIT order — every `queue.submit`, its command
 * buffers in order, each one's encoder's role (`encoderRole`, the frame
 * adapter's) and label, and on each, in recording order, every render pass (its
 * index in `passes`, its timestamp writes), every COMPUTE pass (its label, its
 * timestamp writes and its dispatches, by pipeline — its module's label and
 * entry point, counters folded — and workgroups) and every encoder-level copy,
 * clear, resolve or timestamp, by what it names; and the queue's writes counted
 * before each submit. `wholeSteady` says whether it held across the two captured
 * frames, apart from `steady`, so a parent's log still compares. The frame's
 * opening clear pass, the glow mask's clear and its depth attachment are passes
 * of `passes` already. And `statics.boot`, once a boot: every `requestAdapter`'s
 * options, every `requestDevice`'s descriptor (the features, the limits and the
 * label asked), every `GPUCanvasContext.configure`'s argument, and the label and
 * features of the device the frame is drawn on. A parent's log lacks the three:
 * `--ignore=**.whole,**.wholeSteady,*.statics.boot` names them. **The frame's
 * clock goes through the frame adapter** (`harness.mjs`' `frameAdapter`: its
 * begin, its submit, the device, the canvas and its depth), so a sub-step that
 * takes one of them from Babylon adds its arm there and this file reads it.
 *
 * **And beside the log, measured and NOT compared** (they ride the machine's
 * timing): the LIVE frames — from the scenarios' page's first frame to thirty
 * frames into `deploy` (`boot`), and on a SECOND, FRESH page at the same size
 * its own boot (`boot-2`), then thirty frames after each of: the settings put
 * to the base (`to-base`, nothing to do where the boot already stands
 * there), a render-scale change to 0.75, a glow rung change to `low`, a
 * shafts rung change (`low`, then `high` a frame later) and (on `desk`) a
 * window resize, all in play. **The changes are on a fresh page because the
 * scenarios draw every one of them first**: after them every glow kernel
 * text and every pipeline is cached and a change could never show a compile;
 * on the fresh page each change is one the page has never drawn. Each frame's
 * passes that a named stage drew in, that wrote a chain target or that wrote
 * the canvas, by stage, target and load op (a pass with no stage's draw shows
 * as `-`), and the frame each stage's pipelines were made on, counted from the
 * same `+0` (a pass begun or a pipeline made between two engine frames is
 * marked `~`); under each, the chain passes that drew nothing (`drawless`).
 * That is where a pass Babylon SKIPPED while it compiled shows, which no
 * frozen frame can.
 *
 * **`--against`** (or `--compare`) compares size by size, scenario by
 * scenario: every value by `Object.is` (strings, hashes and hex bytes by
 * equality), the module table, and the boot's statics; the live half is
 * printed, not compared. It names EVERY differing path a scenario has (up to
 * `--max-diffs` each, then the count), a long value from its first differing
 * character, and excuses only what `--ignore` names (`compareLogs`: a later
 * sub-step states its expected differences there, never by reading past
 * them — committed in `post-expected.txt`, a section a sub-step, keyed on the
 * draws' STAGES), and exits 1 on any difference left. A lost device ends it
 * (`harness.mjs`'s header, exit 4), and so does a hard limit (exit 3).
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
/** The paths `--against` excuses (`compareLogs`): `--ignore=a,b` (repeatable), or `--ignore=@file`. */
const IGNORE = args
  .filter((a) => a.startsWith("--ignore="))
  .flatMap((a) => a.slice("--ignore=".length).split(","))
  .flatMap((p) => (p.startsWith("@") ? readFileSync(p.slice(1), "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "")) : [p]))
  .map((p) => p.trim())
  .filter(Boolean);
const MAX_DIFFS = Number(opt("max-diffs", "40"));
/** What a dot in a stage's name is in a match path (`compareLogs`); no log holds it. */
const STAGE_DOT = "\u0001";

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
 * the damage flash, and the base again (the camera's list after every toggle)
 * — then FXAA ALONE (every other tail pass off: FXAA drawn straight into the
 * canvas), appended by X5.2c2's review at the END so every scenario before it
 * stands where it did, and a log without it differs only by that scenario.
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
  { id: "fxaa-alone", settings: { volumetrics: "off", motionBlur: false, paperGrain: false } },
];

/** Frames to converge before the freeze and to settle after it — `bank.mjs`'s. */
const CONVERGE_FRAMES = 30;
const SETTLE_FRAMES = 6;

if (COMPARE) {
  if (!AGAINST) throw new Error("--compare=<a.json> wants --against=<b.json>");
  const failed = compareLogs(JSON.parse(readFileSync(COMPARE, "utf8")), JSON.parse(readFileSync(AGAINST, "utf8")));
  process.exit(failed ? 1 : 0);
}

hardLimit(600 + SIZE_IDS.length * 1500);

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
    inFrame: false,
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
    // The WHOLE frame (X5.4a): every pass of either kind and every
    // encoder-level command, per encoder in recording order, and the submits.
    encItems: new WeakMap(),
    encRoles: new WeakMap(),
    encLabels: new WeakMap(),
    cpasses: new WeakMap(),
    computePipes: new WeakMap(),
    frameSubmits: [],
    writes: null,
    // Once a boot (X5.4a): what the adapter and the device were asked with,
    // and every configure of a canvas context.
    boot: { adapterOptions: [], deviceDescriptors: [], configures: [] },
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
  // What the boot ASKS for, once a boot (X5.4a: X5.4h's BEFORE): every
  // `requestAdapter`'s options, every `requestDevice`'s descriptor (the
  // features, the limits and the label asked), and below every
  // `GPUCanvasContext.configure`'s argument whole.
  wrap(window.GPU?.prototype, "requestAdapter", function (orig, a) {
    const o = a[0];
    P.boot.adapterOptions.push(o === undefined ? "none" : { ...o });
    return orig.apply(this, a);
  });
  wrap(window.GPUAdapter?.prototype, "requestDevice", function (orig, a) {
    const d = a[0];
    P.boot.deviceDescriptors.push(
      d === undefined
        ? "none"
        : {
            label: d.label ?? null,
            requiredFeatures: d.requiredFeatures ? [...d.requiredFeatures] : null,
            requiredLimits: d.requiredLimits ? { ...d.requiredLimits } : null,
            defaultQueue: d.defaultQueue ? { ...d.defaultQueue } : null,
            keys: Object.keys(d).sort(),
          },
    );
    return orig.apply(this, a);
  });
  wrap(D, "createShaderModule", function (orig, a) {
    const m = orig.apply(this, a);
    if (!P.self) {
      const rec = { code: String(a[0]?.code ?? ""), label: String(a[0]?.label ?? ""), frame: P.frame };
      P.modules.set(m, rec);
      P.moduleList.push([m, rec]);
    }
    return m;
  });
  for (const k of ["createRenderPipeline", "createRenderPipelineAsync"]) {
    wrap(D, k, function (orig, a) {
      const r = orig.apply(this, a);
      if (!P.self) {
        const rec = { desc: a[0], call: k, frame: P.frame, inFrame: P.inFrame };
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
  // A buffer binding is COPIED as it is handed over, never kept by reference:
  // Babylon reuses its `{ buffer, offset, size }` objects and rewrites them for
  // the next bind group (`webgpuCacheBindGroups.js`), so a kept reference names
  // the buffer of the LAST group made with that object — X5.2b found the glow's
  // four blurs logged as one buffer holding the wide pass's delta, where the
  // device bound four, each its own.
  wrap(D, "createBindGroup", function (orig, a) {
    const bg = orig.apply(this, a);
    P.bindGroups.set(bg, (a[0]?.entries ?? []).map((e) => ({ binding: e.binding, resource: e.resource?.buffer ? { ...e.resource } : e.resource })));
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
    if (P.writes && !P.self) {
      P.writes.writeBuffer++;
      const el = data?.BYTES_PER_ELEMENT ?? 1;
      P.writes.bytes += size !== undefined ? size * el : (data?.byteLength ?? 0) - dataOffset * el;
    }
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
  for (const k of ["writeTexture", "copyExternalImageToTexture"]) {
    wrap(Q, k, function (orig, a) {
      if (P.writes && !P.self) P.writes[k]++;
      return orig.apply(this, a);
    });
  }
  const C = window.GPUCanvasContext?.prototype;
  wrap(C, "configure", function (orig, a) {
    const d = a[0] ?? {};
    P.boot.configures.push({
      format: d.format ?? null,
      usage: d.usage ?? null,
      alphaMode: d.alphaMode ?? null,
      colorSpace: d.colorSpace ?? null,
      toneMapping: d.toneMapping ? { ...d.toneMapping } : null,
      viewFormats: d.viewFormats ? [...d.viewFormats] : null,
      deviceLabel: d.device?.label ?? null,
      keys: Object.keys(d).sort(),
    });
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
  // Which of the frame's encoders, through the frame adapter (`harness.mjs`,
  // X5.4a) once the game's hooks are on.
  const roleOf = (enc) => (!P.engine ? "?" : window.__refFrame().encoderRole(enc));
  // An encoder's items, in recording order, for the whole-frame log; its role
  // read at its FIRST item (Babylon replaces its two at every flush).
  const item = (enc, it) => {
    if (!P.encItems.has(enc)) {
      P.encItems.set(enc, []);
      P.encRoles.set(enc, roleOf(enc));
    }
    P.encItems.get(enc).push(it);
  };
  wrap(E, "beginRenderPass", function (orig, a) {
    const pass = orig.apply(this, a);
    if (P.self || !(P.capture || P.live)) return pass;
    const d = a[0] ?? {};
    const rec = {
      seq: P.begun++,
      enc: this,
      role: roleOf(this),
      inFrame: P.inFrame,
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
    if (P.capture) item(this, { kind: "render", rec, timestampWrites: d.timestampWrites ? { begin: d.timestampWrites.beginningOfPassWriteIndex ?? null, end: d.timestampWrites.endOfPassWriteIndex ?? null } : null, occlusion: Boolean(d.occlusionQuerySet) });
    return pass;
  });
  // The COMPUTE passes and the encoder-level commands of a captured frame
  // (X5.4a): each pass's label, timestamp writes and dispatches (by pipeline,
  // its module's label and entry point, the counters folded out of both), and
  // each copy, clear, resolve or timestamp by what it names.
  const fold = (t) => String(t ?? "").replace(/\d+/g, "#");
  for (const k of ["createComputePipeline", "createComputePipelineAsync"]) {
    wrap(D, k, function (orig, a) {
      const r = orig.apply(this, a);
      const d = a[0] ?? {};
      const mod = P.modules.get(d.compute?.module);
      const name = `${fold(d.label || mod?.label || "?")}:${d.compute?.entryPoint ?? "main"}`;
      if (r && typeof r.then === "function") r.then((p) => P.computePipes.set(p, name));
      else P.computePipes.set(r, name);
      return r;
    });
  }
  wrap(E, "beginComputePass", function (orig, a) {
    const pass = orig.apply(this, a);
    if (P.self || !P.capture) return pass;
    const d = a[0] ?? {};
    const rec = { label: fold(d.label ?? ""), inFrame: P.inFrame, timestampWrites: d.timestampWrites ? { begin: d.timestampWrites.beginningOfPassWriteIndex ?? null, end: d.timestampWrites.endOfPassWriteIndex ?? null } : null, pipe: null, dispatches: [] };
    P.cpasses.set(pass, rec);
    item(this, { kind: "compute", rec });
    return pass;
  });
  const CPE = window.GPUComputePassEncoder?.prototype;
  wrap(CPE, "setPipeline", function (orig, a) {
    const rec = P.cpasses.get(this);
    if (rec) rec.pipe = a[0];
    return orig.apply(this, a);
  });
  for (const k of ["dispatchWorkgroups", "dispatchWorkgroupsIndirect"]) {
    wrap(CPE, k, function (orig, a) {
      const rec = P.cpasses.get(this);
      if (rec) rec.dispatches.push({ pipeline: P.computePipes.get(rec.pipe) ?? "unwrapped", call: k, args: k === "dispatchWorkgroups" ? [a[0], a[1] ?? 1, a[2] ?? 1] : [a[1] ?? 0] });
      return orig.apply(this, a);
    });
  }
  const texName = (t) => (t ? (window.__postGpu?.target(t) ?? (P.canvas.has(t) ? "canvas" : `-${t.format} ${t.width}x${t.height}`)) : null);
  const copyEnd = (x) => (x?.texture ? { texture: texName(x.texture), mip: x.mipLevel ?? 0 } : x?.buffer ? { buffer: x.buffer.size, offset: x.offset ?? 0 } : null);
  const ext = (sz) => (Array.isArray(sz) ? [sz[0], sz[1] ?? 1, sz[2] ?? 1] : sz && typeof sz === "object" ? [sz.width, sz.height ?? 1, sz.depthOrArrayLayers ?? 1] : sz);
  for (const [k, desc] of [
    ["copyBufferToBuffer", (a) => ({ src: a[0]?.size ?? null, dst: a[2]?.size ?? null, bytes: a[4] ?? null })],
    ["copyBufferToTexture", (a) => ({ src: copyEnd(a[0]), dst: copyEnd(a[1]), size: ext(a[2]) })],
    ["copyTextureToBuffer", (a) => ({ src: copyEnd(a[0]), dst: copyEnd(a[1]), size: ext(a[2]) })],
    ["copyTextureToTexture", (a) => ({ src: copyEnd(a[0]), dst: copyEnd(a[1]), size: ext(a[2]) })],
    ["clearBuffer", (a) => ({ buffer: a[0]?.size ?? null, offset: a[1] ?? 0, bytes: a[2] ?? null })],
    ["resolveQuerySet", (a) => ({ first: a[1], count: a[2] })],
    ["writeTimestamp", (a) => ({ index: a[1] })],
  ]) {
    wrap(E, k, function (orig, a) {
      if (P.capture && !P.self) item(this, { kind: "cmd", cmd: { call: k, ...desc(a) } });
      return orig.apply(this, a);
    });
  }
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
    rec.enc.copyTextureToBuffer(
      { texture: tex, mipLevel: mip, origin: { x: 0, y: 0, z: layer }, aspect: depth ? "depth-only" : "all" },
      { buffer, offset: 0, bytesPerRow: bpr, rowsPerImage: h },
      { width: w, height: h, depthOrArrayLayers: 1 },
    );
    P.self = false;
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
  wrap(D, "createCommandEncoder", function (orig, a) {
    const enc = orig.apply(this, a);
    P.encLabels.set(enc, a[0]?.label ?? "");
    return enc;
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
    // A captured frame's SUBMIT BOUNDARIES (X5.4a): each submit, its command
    // buffers in order, each one's encoder's role and label and everything
    // recorded on it, and the queue's writes made since the submit before.
    if (P.capture && !P.self) {
      P.frameSubmits.push({
        inFrame: P.inFrame,
        writes: P.writes,
        buffers: cbs.map((cb) => {
          const enc = P.cbEnc.get(cb);
          return { role: enc ? (P.encRoles.get(enc) ?? roleOf(enc)) : "unwrapped", label: fold(P.encLabels.get(enc) ?? ""), items: (enc && P.encItems.get(enc)) ?? [] };
        }),
      });
      P.writes = { writeBuffer: 0, bytes: 0, writeTexture: 0, copyExternalImageToTexture: 0 };
    }
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
      // Babylon's engine, the scene's (`harness.mjs`' `frameAdapter`) — read
      // when the game is handed over, before its scene exists, so it is
      // `Game.engine` at a parent and a mark that the hooks are on since X5.4h.
      P.engine = g.engine ?? g.surface ?? null;
      // The frame's begin and end through the frame adapter (`harness.mjs`,
      // X5.4a): Babylon's engine observables at every parent so far.
      const F = window.__refFrame();
      F.onBegin(() => {
        P.frame++;
        P.inFrame = true;
        if (P.arm > 0) {
          P.arm--;
          P.capture = true;
          P.frameRec = { frame: P.frame, passes: [] };
          P.frameSubmits.length = 0;
          P.writes = { writeBuffer: 0, bytes: 0, writeTexture: 0, copyExternalImageToTexture: 0 };
        }
      });
      F.onSubmitted(() => {
        window.__postGpu?.refresh();
        if (P.capture) {
          P.frameRec.submits = P.frameSubmits.splice(0);
          P.frameRec.writesAfter = P.writes;
          P.writes = null;
          P.frameRec.passes = P.frameOrder.splice(0);
          P.captured.push(P.frameRec);
          P.capture = false;
          P.frameRec = null;
        } else if (P.live) {
          const kept = [];
          for (const rec of P.frameOrder.splice(0)) {
            const stages = [...new Set(rec.pipes.map((p) => P.stageOfPipe(p)).filter(Boolean))];
            // A chain target: one a stage writes, not an input it only reads
            // (the shafts' shadow maps and cloud field, whose own passes are
            // not the chain's).
            const named = rec.color.some((c) => {
              const t = P.views.get(c?.view)?.texture;
              return t && window.__postGpu?.target(t) && !window.__postGpu?.input(t);
            });
            const canvasOut = rec.color.some((c) => c && P.canvas.has(P.views.get(c.view)?.texture));
            if (stages.length || canvasOut || named) {
              kept.push({
                between: !rec.inFrame,
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
        P.inFrame = false;
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
 *
 * **Not `harness.mjs`'s `postAdapter`**, which shares the name and the shape:
 * that one (`window.__refPost`) is the chain's CPU half for `freeze`, `thaw`
 * and `placeVantage` (the grade, the shafts and the blur objects whose
 * `update`s a hold replaces); this one (`window.__postGpu`) names the GPU's
 * modules and textures for this probe. Each has Babylon's arm alone today,
 * and a later sub-step adds OURS to BOTH, picked first, under the same names:
 * this one for each stage it moves (X5.2b on: the glow's blur; X5.2c1: the
 * grade), that one since the grade moved (X5.2c1).
 */
function postAdapter() {
  const g = window.__celshock;
  const P = window.__postProbe;
  // OURS, picked first for each stage it holds, under Babylon's names. X5.2b:
  // the glow's box filter and four blurs (`Game.glowBlur`, `render/GlowBlur.ts`),
  // whose modules our pipeline cache made and labelled (`glow down: …`,
  // `glow blur <width>: …`) — named off the label, the four blurs one stage as
  // Babylon's were, told apart by the target each draws into. The targets are
  // still `GlowPass`'s own (`glow.*`, below), which binds each pass.
  // X5.2c1: the GRADE, a stage of our post chain (`Game.postChain`,
  // `render/PostChain.ts`), its modules labelled `paperGrain: …` by our
  // pipeline cache and named `grain` as Babylon's were; the target it reads
  // — the prefix's output, `PostPasses.prefixTarget` — is named by what
  // WRITES it, Babylon's last live pass (below), as that pass's next input
  // was; and the canvas it draws into is the canvas.
  // X5.2c2: the SHAFTS (one stage a rung, `volumetrics_<rung>: …`) and the
  // BLUR (`motionBlur: …`) are stages of the same chain, named `shafts` and
  // `blur` as Babylon's were; a target of the chain's POOL (one a pass
  // position, `PostPasses.poolTarget`) is named by the stage that WRITES it
  // this frame, `<stage>.out`, as Babylon's next pass's input was.
  // X5.2d: the INK (`celInk: …`) is the chain's first stage, named `ink` as
  // Babylon's was, and the target the scene draws into — the camera's
  // `outputRenderTarget`, `PostPasses.frameTarget` — is `frame`, its depth
  // `frame.depth`, as Babylon's first live pass's input and its depth were.
  // X5.4e: the FRAME, its depth and the glow's six are OUR renderer's
  // (`Game.renderer.targets`, `render/FrameTargets.ts`), each a GPU texture of
  // its own, named `frame`, `frame.depth` and `glow.<k>` as Babylon's were.
  const OURS = [
    ["paperGrain: ", "grain"],
    ["volumetrics_", "shafts"],
    ["motionBlur: ", "blur"],
    ["fxaa: ", "fxaa"],
    ["celInk: ", "ink"],
  ];
  const ours = {
    glow: () => Boolean(g.glowBlur),
    grain: () => Boolean(g.postChain),
    /** Which of the chain's stage names are ours on this tree. */
    names: () => new Set((g.postChain?.stages ?? []).map((st) => st.name)),
    name() {
      const mine = ours.names();
      for (const [m, rec] of P.moduleList) {
        if (P.stageOf.has(m)) continue;
        if (ours.glow() && rec.label.startsWith("glow down: ")) P.stageOf.set(m, "glow.down");
        else if (ours.glow() && rec.label.startsWith("glow blur ")) P.stageOf.set(m, "glow.blur");
        else {
          const hit = OURS.find(([prefix, name]) => mine.has(name) && rec.label.startsWith(prefix));
          if (hit) P.stageOf.set(m, hit[1]);
        }
      }
    },
    stages() {
      const out = [];
      if (ours.glow()) {
        out.push(
          { name: "glow.down", ready: g.glowBlur.downReady(), off: false },
          { name: "glow.blur", ready: g.glowBlur.blurReady(g.glow.blurKernel), off: false },
        );
      }
      if (ours.grain()) {
        // One entry a NAME (the shafts' three rungs are one), ready as the
        // chain's every active stage is, off while none of that name is active.
        const ready = g.postChain.drawsReady();
        const byName = new Map();
        for (const st of g.postChain.stages) byName.set(st.name, (byName.get(st.name) ?? false) || st.active());
        for (const [name, on] of byName) out.push({ name, ready, off: !on });
      }
      return out;
    },
    /** Our renderer's frame targets (X5.4e), or null on a tree before them. */
    frameTargets: () => g.renderer?.targets ?? null,
    /** This frame's pool targets by writer: the k-th active stage but the last writes slot k. */
    pool() {
      const m = new Map();
      if (!ours.grain()) return m;
      const active = g.postChain.stages.filter((st) => st.active());
      // The pool's owner: OURS since X5.4f (`Game.chainPasses`, a target's GPU
      // texture its own `texture`), `PostPasses`' Babylon render target before.
      const owner = g.chainPasses ?? g.postPasses;
      for (let k = 0; k < active.length - 1; k++) {
        const pt = owner.poolTarget(k);
        const t = pt?.getInternalTexture ? hw(pt.getInternalTexture()) : (pt?.texture ?? null);
        if (t) m.set(t, `${active[k].name}.out`);
      }
      return m;
    },
  };
  // A Babylon texture's GPU texture: its hardware texture's resource, or the
  // texture its view was made on (a texture of ours wrapped through the seam).
  const hw = (t) => t?._hardwareTexture?.underlyingResource ?? P.views.get(t?._hardwareTexture?.view)?.texture ?? null;
  const babylon = {
    arm: "babylon",
    /** The chain's stages, each with what it draws with and into: the camera's list, then the glow's. */
    stages() {
      const cam = g.cameraSys.camera;
      const named = new Map([
        [g.celInk?.pass, "ink"],
        // `g.fxaa` is Babylon's pass on a tree before X5.2c2's FXAA and OUR
        // stage's CPU half after it, which is no pass: only a pass is named here.
        [g.fxaa?.getEffect ? g.fxaa : null, "fxaa"],
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
      // Babylon's glow blur (a parent before X5.2b): ours below is picked first.
      if (glow && !ours.glow()) {
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
      // Ours (X5.2c1): the prefix's output, which the last live Babylon pass
      // writes and our first stage reads, is that pass's `.out`.
      const prefix = ours.grain() ? hw(g.postPasses?.prefixTarget?.getInternalTexture?.()) : null;
      if (prefix && live.length) m.set(prefix, `${live[live.length - 1].name}.out`);
      // Ours (X5.2c2): the pool, each target by the stage writing it.
      for (const [t, name] of ours.pool()) m.set(t, name);
      // Ours (X5.2d): the frame, which the scene draws into and the ink reads
      // — `PostPasses`' Babylon target until X5.4e, OUR renderer's after it.
      const ownTargets = ours.frameTargets();
      const frame = g.postPasses?.frameTarget;
      if (ownTargets) {
        if (ownTargets.frame.texture) m.set(ownTargets.frame.texture, "frame");
        if (ownTargets.depth.texture) m.set(ownTargets.depth.texture, "frame.depth");
      } else if (frame) {
        const t = hw(frame.getInternalTexture?.());
        if (t) m.set(t, "frame");
        const d = hw(frame.renderTarget?._depthStencilTexture);
        if (d) m.set(d, "frame.depth");
      }
      const canvasDepth = window.__refFrame().canvasDepth();
      if (canvasDepth) m.set(canvasDepth, "canvas.depth");
      const glow = g.glow;
      for (const k of ["mask", "down", "nearH", "near", "wideH", "wide"]) {
        // Ours (X5.4e) by its GPU texture; Babylon's render target's before.
        const t = ownTargets ? ownTargets[k].texture : hw(glow?.[k]?.renderTarget?.texture);
        if (t) m.set(t, `glow.${k}`);
      }
      // The INPUTS no stage writes, named by their producer rather than
      // matched by format and size: the shafts' two shadow maps (the world's
      // and the bodies', ours or Babylon's generators') and Sky's cloud
      // field, so a sub-step that swaps how they are reached (X5.2c2's
      // `own ?? hostTexture`) is compared by name. Read off the pass, or —
      // while the shafts are off or not yet built — off what `Game` hands
      // it (`syncVolumetrics`), so the name does not depend on the setting.
      inputs.clear();
      const vol = g.volumetrics;
      const handed = { shadowMap: g.shadows?.depthMap, bodyShadowMap: g.bodyShadows?.depthMap, cloudShadowMap: g.sky?.cloudShadowMap };
      for (const [k, name] of [["shadowMap", "shadow.world"], ["bodyShadowMap", "shadow.bodies"], ["cloudShadowMap", "cloud.field"]]) {
        // A Babylon texture (a parent before X5.4d: the maps' wrapped views and
        // the lit texel, the cloud field) by its hardware texture; one of OUR
        // renderer's (an `OwnTexture`, X5.4d on) by the texture its view is of.
        const x = vol?.[k] ?? handed[k];
        const t = hw(x?.getInternalTexture?.()) ?? (x?.view ? (P.views.get(x.view)?.texture ?? null) : null);
        if (t && !m.has(t)) {
          m.set(t, name);
          inputs.add(t);
        }
      }
      return m;
    },
    /** The CPU facts a pass's draw does not show: Babylon's own fields. */
    chain() {
      const cam = g.cameraSys.camera;
      const scene = g.scene;
      // The canvas's size and scaling level: the game's surface since X5.4h
      // (`core/CanvasSurface.ts`), Babylon's engine before.
      const e = g.surface ?? g.engine;
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
      const ownTargets = ours.frameTargets();
      // A glow target's size, and Babylon's render target's sampling fields
      // where it is Babylon's: ours (X5.4e) has none — its sampler is a
      // descriptor, compared draw by draw in every bind group that reads it —
      // so those three are null on ours, a difference named in
      // `post-expected.txt`'s X5.4e section.
      const rt = (t, k) =>
        ownTargets
          ? { width: ownTargets[k].width, height: ownTargets[k].height, samplingMode: null, wrapU: null, wrapV: null }
          : t
            ? { width: t.getSize().width, height: t.getSize().height, samplingMode: t.samplingMode, wrapU: t.wrapU, wrapV: t.wrapV }
            : null;
      // The blur's kernel as each of the four held it, and whether each pass
      // and the box filter could draw: Babylon's `ThinBlurPostProcess`es, or
      // ours (X5.2b), `GlowPass.blurKernel` the same ideal width four times.
      const blurs = ours.glow()
        ? { kernel: [0, 1, 2, 3].map(() => glow.blurKernel), blurReady: [0, 1, 2, 3].map(() => g.glowBlur.blurReady(glow.blurKernel)), downReady: g.glowBlur.downReady() }
        : glow
          ? { kernel: (glow.blurs ?? []).map((b) => b.kernel), blurReady: (glow.blurs ?? []).map((b) => b.isReady?.() ?? null), downReady: glow.downsample?.isReady?.() ?? null }
          : null;
      return {
        list: (cam._postProcesses ?? []).map((pp, i) => (pp ? { index: i, ...pass(pp) } : { index: i, hole: true })),
        off: [g.fxaa?.getEffect ? g.fxaa : null, g.volumetrics?.pass, g.motionBlur?.pass, g.post?.post].filter((pp) => pp && !(cam._postProcesses ?? []).includes(pp)).map(pass),
        // The shafts' slot is gone since X5.2c2 (their switch is their stage's
        // `active()`), so it is not logged: a log before it holds `shafts`,
        // one after it none (post-expected.txt's `**.chain.slots.shafts`) — and
        // FXAA's slot and attach since its move (`**.chain.slots.fxaa*`).
        slots: { shaftsAttached: g.volumetricsAttached, blurEnabled: g.motionBlur?.isEnabled, grade: { enabled: g.post?.enabled, attached: g.post?.attached, damage: g.post?.damage } },
        shaftsRung: g.volumetricsRung ?? null,
        glow: glow
          ? {
              rung: glow.rung,
              kernel: blurs.kernel,
              blurReady: blurs.blurReady,
              downReady: blurs.downReady,
              targets: Object.fromEntries(["mask", "down", "nearH", "near", "wideH", "wide"].map((k) => [k, rt(glow[k], k)])),
            }
          : null,
        hardwareScalingLevel: e.getHardwareScalingLevel(),
        renderSize: [e.getRenderWidth(), e.getRenderHeight()],
        renderSizeTrue: [e.getRenderWidth(true), e.getRenderHeight(true)],
        canvasSize: [window.__refFrame().canvas()?.width ?? null, window.__refFrame().canvas()?.height ?? null],
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
        // The depth every stage reads, and whether it is the frame's own: Babylon's
        // `FrameDepth` capture of the frame target's depth until X5.4e; ours
        // after it, `FrameTargets.depth`, the frame's own depth by construction
        // (the main pass attaches it and every stage binds the same object).
        frameDepth: ownTargets
          ? ownTargets.depth.view
            ? { width: ownTargets.depth.width, height: ownTargets.depth.height, isInkDepth: true }
            : null
          : g.frameDepth?.texture
            ? { width: g.frameDepth.texture.getSize?.().width ?? null, height: g.frameDepth.texture.getSize?.().height ?? null, isInkDepth: g.frameDepth.source === (g.postPasses?.frameTarget?.renderTarget?._depthStencilTexture ?? g.celInk?.pass?.inputTexture?._depthStencilTexture) }
            : null,
      };
    },
  };
  // The one map the probe asks, rebuilt at every refresh: a module named once
  // keeps its name, so a stage whose effect was replaced (a recompiled kernel)
  // still names the draws its old module made.
  let targets = new Map();
  const inputs = new Set();
  window.__postGpu = {
    arm: ours.grain() ? `ours:glow,${[...ours.names()].join(",")}` : ours.glow() ? "ours:glow" : babylon.arm,
    refresh() {
      for (const s of babylon.stages()) {
        const st = s.effect?._pipelineContext?.stages;
        if (st?.vertexStage?.module) P.stageOf.set(st.vertexStage.module, s.name);
        if (st?.fragmentStage?.module) P.stageOf.set(st.fragmentStage.module, s.name);
      }
      ours.name();
      targets = babylon.targets();
    },
    stage: (m) => P.stageOf.get(m) ?? null,
    target: (t) => targets.get(t) ?? null,
    input: (t) => inputs.has(t),
    chain: () => babylon.chain(),
    stages: () => [
      ...babylon.stages().map((s) => ({ name: s.name, ready: s.effect?.isReady?.() ?? false, off: Boolean(s.off) })),
      ...ours.stages(),
    ],
  };
  window.__postGpu.refresh();
}

const vite = await startDevServer(root);
const browser = await launchClient({ headed: false });
const SEED = 5101;
const enc = (x) =>
  typeof x === "number" ? (Object.is(x, -0) ? "-0" : Number.isNaN(x) ? "NaN" : x === Infinity ? "Inf" : x === -Infinity ? "-Inf" : x) : Array.isArray(x) ? x.map(enc) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, enc(v)])) : x;

const report = { seed: SEED, map: "hollowmere", base: BASE, sizes: {} };

for (const sizeId of SIZE_IDS) {
  const size = SIZES[sizeId];
  if (!size) throw new Error(`no size "${sizeId}" (${Object.keys(SIZES).join(", ")})`);
  const out = { size, statics: null, scenarios: {}, live: {} };
  report.sizes[sizeId] = out;
  const errors = { page: [], console: [] };

  // The SCENARIOS' page: the boot's live frames, then every scenario in its
  // one order, then the statics.
  const page = await openPage(sizeId, size, errors);
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
    // The whole frame beside the passes (X5.4a), and whether IT was steady
    // across the two captured frames, said apart so a parent's log compares.
    out.scenarios[sc.id] = { steady, chain: b.chain, passes: b.frame.passes, whole: b.whole, wholeSteady: JSON.stringify(a.whole) === JSON.stringify(b.whole) };
    const canvas = b.frame.passes.flatMap((p) => p.out).filter((o) => o.target === "canvas").pop();
    console.log(`${sizeId.padEnd(5)} ${sc.id.padEnd(16)} ${steady ? "steady" : "NOT STEADY"}  ${b.frame.passes.length} passes, canvas ${canvas?.hash?.slice(0, 16) ?? "?"}  chain [${b.chain.list.map((x) => (x.hole ? "_" : x.stage)).join(" ")}]`);
  }
  out.statics = await statics(page);
  await page.close();

  if (LIVE) {
    // The changes in play, on a FRESH page: on the scenarios' page every
    // render scale, glow rung and shafts rung has already been drawn, so the
    // glow blur's kernel texts and every pipeline are cached and a change
    // there could never show a pass skipped for a compile. Here the boot's
    // settings are put to BASE first (its own frames, a step like the
    // others), then each change is one this page has never drawn: render
    // scale 0.75 (a new glow kernel text at `high`), the glow to `low` (a
    // new kernel at 0.75, and the box filter's first draw), the shafts
    // `low` then `high` (two new rungs) and, on `desk`, a resize. Thirty
    // frames after each, in the held deploy world.
    const live = await openPage(sizeId, size, errors);
    await installRound(live);
    console.error(`[${sizeId}] live: deploy`);
    await settleLive(live, 30);
    out.live["boot-2"] = await takeLive(live);
    const change = async (label, fn, arg) => {
      await live.evaluate(() => (window.__postProbe.liveFrames.length = 0));
      const said = await live.evaluate(fn, arg);
      await settleLive(live, 30);
      out.live[label] = { ...(await takeLive(live)), ...(said ? { said } : {}) };
      console.error(`[${sizeId}] live: ${label}`);
    };
    await change(
      "to-base",
      (base) => {
        const g = window.__celshock;
        const moved = {};
        for (const [k, v] of Object.entries(base)) {
          if (g.settings[k] === v) continue;
          moved[k] = [g.settings[k], v];
          g.setSetting(k, v);
        }
        return moved;
      },
      BASE,
    );
    await change("scale-to-75", () => void window.__celshock.setSetting("renderScale", 0.75));
    await change("glow-to-low", () => void window.__celshock.setSetting("glow", "low"));
    await change("shafts-low-to-high", () => {
      const g = window.__celshock;
      g.setSetting("volumetrics", "low");
      return new Promise((r) => {
        const off = window.__refFrame().onSubmitted(() => {
          off();
          r(void g.setSetting("volumetrics", "high"));
        });
      });
    });
    if (sizeId === "desk") {
      await live.evaluate(() => (window.__postProbe.liveFrames.length = 0));
      await live.setViewportSize({ width: 1280, height: 721 });
      await settleLive(live, 30);
      out.live["resize-1280x721"] = await takeLive(live);
    }
    await live.close();
  }
  const pageErrors = errors.page.flat();
  const consoleErrors = errors.console.flat();
  if (pageErrors.length) out.pageErrors = pageErrors.slice(0, 5);
  if (consoleErrors.length) out.consoleErrors = consoleErrors.slice(0, 5);
}

printReport(report);
// Through JSON, so the log compared here is the one `--out` writes (an
// `undefined` field is absent in both) and the counts match `--compare`'s.
const clean = JSON.parse(JSON.stringify(enc(report)));
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

/** A page booted at `size` with the device wrapped from its first line, and the adapter installed. */
async function openPage(sizeId, size, errors) {
  const booted = await bootMap(browser, `${vite.url}${vite.url.endsWith("/") ? "" : "/"}?seed=${SEED}`, "hollowmere", {
    init: deviceProbe,
    viewport: size.viewport,
    deviceScaleFactor: size.deviceScaleFactor,
  });
  const { page } = booted;
  // The harness's own lists, which it keeps filling for the page's life,
  // read once the size is done (a live page's errors fail the run as a
  // scenario page's do).
  errors.page.push(booted.pageErrors);
  errors.console.push(booted.consoleErrors);
  page.on("pageerror", (e) => console.error(`[${sizeId}] page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && console.error(`[${sizeId}] console: ${m.text().slice(0, 300)}`));
  page.on("dialog", (d) => void d.accept());
  console.error(`[${sizeId}] booted`);
  await page.evaluate(postAdapter);
  return page;
}

/** Lets `n` frames pass with the render loop running (the live half's clock). */
function settleLive(page, n) {
  return page.evaluate(
    (n) =>
      new Promise((res) => {
        let seen = 0;
        const off = window.__refFrame().onSubmitted(() => {
          if (++seen < n) return;
          off();
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
        let n = 0;
        const check = () => {
          window.__postGpu.refresh();
          if (window.__postGpu.stages().every((s) => s.ready || s.off)) return res(n);
          if (++n > 1200) return rej(new Error(`post stages never ready: ${JSON.stringify(window.__postGpu.stages())}`));
          const off = window.__refFrame().onSubmitted(() => {
            off();
            check();
          });
        };
        check();
      }),
  );
}

/**
 * The live frames recorded since the last take, named, and the pipelines made
 * in them, both counted from the take's first frame (`+0`): a frame's `f` and
 * a pipeline's `at` are the same count, so "made on +4 and drawn on +4" is
 * read off one number. A pass begun, or a pipeline made, OUTSIDE the engine's
 * frame (after one frame's end and before the next's begin) is marked `~`
 * and `between`, and counts with the frame that ended before it.
 */
function takeLive(page) {
  return page.evaluate(() => {
    const P = window.__postProbe;
    window.__postGpu.refresh();
    const frames = P.liveFrames.splice(0);
    const first = frames[0]?.f ?? 0;
    const pipes = P.pipelineList
      .filter((r) => r.frame >= first)
      .map((r) => ({ at: r.frame - first, frame: r.frame, between: !r.inFrame, call: r.call, stage: (r.desc?.fragment?.module && window.__postGpu.stage(r.desc.fragment.module)) ?? null }))
      .filter((r) => r.stage);
    return {
      from: first,
      frames: frames.map((f) => ({ f: f.f - first, state: f.state, passes: f.passes.map((p) => `${p.between ? "~" : ""}${p.stages.join("+") || "-"}>${p.out.join(",")}${p.load.includes("clear") ? "/clear" : ""}`) })),
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
      const off = window.__refFrame().onSubmitted(() => {
        if (P.captured.length < n) return;
        off();
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
      // The WHOLE frame (X5.4a), in submit order: each submit, its command
      // buffers, and each one's items in recording order — a render pass by
      // its index in `passes` (whose own record is there), a compute pass and
      // an encoder-level command whole — with the queue's writes before it.
      const at = new Map(recs.map((rec, i) => [rec, i]));
      const whole = {
        submits: (fr.submits ?? []).map((sub) => ({
          inFrame: sub.inFrame,
          writes: sub.writes,
          buffers: sub.buffers.map((b) => ({
            role: b.role,
            label: b.label,
            items: b.items.map((it) =>
              it.kind === "render"
                ? { render: at.get(it.rec) ?? null, timestampWrites: it.timestampWrites, occlusion: it.occlusion }
                : it.kind === "compute"
                  ? { compute: { label: it.rec.label, inFrame: it.rec.inFrame, timestampWrites: it.rec.timestampWrites, dispatches: it.rec.dispatches } }
                  : it,
            ),
          })),
        })),
        writesAfter: fr.writesAfter ?? null,
      };
      return { passes: fill(passes), whole };
    };
    const frames = [];
    for (const fr of P.captured.splice(0)) frames.push(await summarise(fr));
    const chain = window.__postGpu.chain();
    return frames.map(({ whole, ...frame }) => ({ frame, whole, chain }));
  }, n);
}

/** Once a boot: the device, the canvas, the engine, and the module table. */
function statics(page) {
  return page.evaluate(async () => {
    const P = window.__postProbe;
    const g = window.__celshock;
    const dev = window.__refFrame().device();
    const lim = {};
    for (const k of ["maxInterStageShaderVariables", "maxInterStageShaderComponents", "maxColorAttachments", "maxSampledTexturesPerShaderStage", "maxSamplersPerShaderStage", "maxUniformBufferBindingSize", "maxTextureDimension2D", "maxBindGroups"]) lim[k] = dev.limits?.[k] ?? null;
    // What Babylon's FXAA reads to decide its `MALI` define
    // (`ThinFXAAPostProcess._GetDefines`): the engine's driver info — since
    // X5.4h, with no `WebGPUEngine`, what its `extractDriverInfo` always
    // answered: the empty string (`webgpuEngine.pure.js` 2370).
    let driverInfo = null;
    try {
      driverInfo = g.engine ? (g.engine.extractDriverInfo?.() ?? null) : "";
    } catch (e) {
      driverInfo = `throws: ${e.message}`;
    }
    return {
      limits: lim,
      preferredCanvasFormat: navigator.gpu.getPreferredCanvasFormat(),
      context: P.context,
      driverInfo,
      // Babylon's engine's (no engine since X5.4h: null, and the canvas pass's
      // depth is `ChainPasses`' — the format its pass attaches).
      compatibilityMode: g.engine ? g.engine.compatibilityMode : null,
      depthFormat: g.engine ? (g.engine._mainRenderPassWrapper?.depthTextureFormat ?? null) : (g.chainPasses?.canvasDepthTexture?.format ?? null),
      modules: P.moduleTable ?? {},
      // What the boot asked for (X5.4a): the adapter's options, the device's
      // descriptor, every canvas configure; and what the device it got holds.
      boot: { ...P.boot, deviceLabel: dev.label ?? null, deviceFeatures: [...(dev.features ?? [])].sort() },
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
      console.log(`-- live ${k}: ${l.frames.length} frames from ${l.from}${l.said && Object.keys(l.said).length ? `, moved ${JSON.stringify(l.said)}` : ""}`);
      let last = null;
      for (const f of l.frames) {
        const line = `${f.state} ${f.passes.join(" | ")}`;
        if (line !== last) console.log(`   +${f.f}: ${line}`);
        last = line;
      }
      console.log(`   pipelines made: ${l.pipelines.length ? l.pipelines.map((p) => `${p.stage} +${p.at}${p.between ? "~" : ""}`).join(", ") : "none"}`);
      // A pass a stage owed and did not draw: a chain target written by a
      // pass with no stage's draw in it (the scene's frame and the glow's mask
      // are drawn by no stage, and the canvas's opening pass is drawless by
      // design, so neither is counted).
      const skipped = [];
      for (const f of l.frames) {
        for (const p of f.passes) {
          const m = /^~?->([^/]+)/.exec(p);
          if (m && m[1] !== "canvas" && m[1] !== "frame" && m[1] !== "glow.mask") skipped.push(`+${f.f} ${m[1]}`);
        }
      }
      console.log(`   drawless chain passes: ${skipped.length ? skipped.join(", ") : "none"}`);
    }
  }
}

/**
 * Two logs, compared: every size's statics and every scenario's chain and
 * passes, by `Object.is` on numbers and equality on strings. The live half
 * rides the machine's timing and is printed, not compared. Returns true on a
 * difference.
 *
 * **Every differing path is named**, not the first one a scenario meets —
 * a sub-step that moves a stage changes Babylon's own fields in `chain` by
 * design, and a walk that stopped there would never reach a pass or a draw —
 * up to `--max-diffs` a scenario (40 by default), with the count past it. A
 * long value (a uniform buffer's hex, a hash, a module's text) is shown from
 * its FIRST DIFFERING CHARACTER, with the byte that is for a hex string, so
 * two values that agree for their first 120 characters still print apart.
 * An array of two lengths is named once and its common prefix still walked.
 *
 * **`--ignore` names the differences a step EXPECTS**, so none is excused by
 * reading past it: a comma list of PATH patterns (or `@file`, one a line,
 * `#` comments), `*` any run within one segment (`passes[*]` any index) and
 * `**` any run of segments, matched against the whole path from the size on
 * (`desk.base.passes[7].draws[0].pipeline.call`) or any prefix of it, so
 * `**.chain.glow.kernel` excuses the kernel on every scenario and
 * `**.statics.modules.*.text` every module's text. **An index may name the
 * element's STAGE instead** (`[stage=glob]`, its `*` any run within the
 * stage's name, dots included): `**.draws[stage=glow.*].viewport` excuses the
 * viewport of every draw whose `stage` is `glow.down` or `glow.blur` and of no
 * other draw, at whatever pass index it lands — so a sub-step's expected
 * differences are keyed on the draws it MOVED, and cannot excuse the same
 * field on another stage's draw that sits at that index on some scenario. An
 * element carries a stage only when both logs give it the same one (a draw
 * whose stage differs is named, never excused by stage), and a plain index
 * still matches it. What was excused is counted per size, and a pattern that
 * excused nothing is said, because a difference a step named and did not
 * make is a finding too.
 */
function compareLogs(a, b) {
  let failed = false;
  const say = (m) => {
    console.log(`against: ${m}`);
    failed = true;
  };
  // A pattern is tested against a MATCH path: the shown path with a staged
  // element's index written `[i|stage=name]`, the dots in the name made
  // STAGE_DOT, so a segment's `*` never runs into or out of it.
  const escape = (t) => t.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const token = (t) => {
    if (t === "**") return ".*";
    if (t === "*") return "[^.]*";
    const staged = /^\[stage=([^\]]*)\]$/.exec(t);
    if (staged) {
      const glob = staged[1].split(/(\*)/).map((g) => (g === "*" ? "[^.\\]]*" : escape(g.replaceAll(".", STAGE_DOT)))).join("");
      return `\\[\\d+\\|stage=${glob}\\]`;
    }
    const index = /^\[(\d+)\]$/.exec(t);
    if (index) return `\\[${index[1]}(?:\\|stage=[^.\\]]*)?\\]`;
    return escape(t);
  };
  const ignores = IGNORE.map((pattern) => ({
    pattern,
    re: new RegExp(`^${pattern.split(/(\[stage=[^\]]*\]|\[\d+\]|\*\*|\*)/).map(token).join("")}$`),
    hits: 0,
  }));
  const count = (v) => (Array.isArray(v) ? v.reduce((s, e) => s + count(e), 0) : v && typeof v === "object" ? Object.values(v).reduce((s, e) => s + count(e), 0) : 1);
  // A value as it differs: whole when short, else from its first differing
  // character (and, for two hex strings, the byte that character is in).
  const show = (x, y) => {
    const sx = x === undefined ? "absent" : JSON.stringify(x);
    const sy = y === undefined ? "absent" : JSON.stringify(y);
    if (sx.length <= 100 && sy.length <= 100) return `${sx} here and ${sy} there`;
    let i = 0;
    while (i < sx.length && i < sy.length && sx[i] === sy[i]) i++;
    const cut = (t) => `${i > 16 ? "…" : ""}${t.slice(Math.max(0, i - 16), i + 48)}${t.length > i + 48 ? "…" : ""}`;
    const hex = typeof x === "string" && typeof y === "string" && /^[0-9a-f]+$/.test(x) && /^[0-9a-f]+$/.test(y);
    return `${cut(sx)} here and ${cut(sy)} there (${sx.length} and ${sy.length} characters, first differing at ${i}${hex ? `, byte ${Math.floor((i - 1) / 2)}` : ""})`;
  };
  // Every difference under `path`, into `acc` (`diffs`, `equal`, `ignored`);
  // `match` is the path the patterns are tested against (above).
  const walk = (x, y, path, acc, match = path) => {
    const ig = ignores.find((r) => r.re.test(match));
    if (ig) {
      ig.hits++;
      acc.ignored += Math.max(count(x), count(y));
      return;
    }
    const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
    if (kind(x) !== kind(y)) {
      acc.diffs.push(`${path} is ${show(x, y)}`);
      return;
    }
    if (Array.isArray(x)) {
      if (x.length !== y.length) acc.diffs.push(`${path} has length ${x.length} here and ${y.length} there`);
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const sx = x[i]?.stage;
        const staged = typeof sx === "string" && sx === y[i]?.stage ? `|stage=${sx.replaceAll(".", STAGE_DOT)}` : "";
        walk(x[i], y[i], `${path}[${i}]`, acc, `${match}[${i}${staged}]`);
      }
      return;
    }
    if (x && typeof x === "object") {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${path}.${k}`, acc, `${match}.${k}`);
      return;
    }
    if (Object.is(x, y)) acc.equal++;
    else acc.diffs.push(`${path} is ${show(x, y)}`);
  };
  const report = (acc, where) => {
    for (const d of acc.diffs.slice(0, MAX_DIFFS)) say(d);
    if (acc.diffs.length > MAX_DIFFS) say(`… and ${acc.diffs.length - MAX_DIFFS} more differences under ${where} (--max-diffs)`);
  };
  if (a.seed !== b.seed || a.map !== b.map) say(`logged on ${a.map} under seed ${a.seed} here, ${b.map} and ${b.seed} there`);
  const top = { diffs: [], equal: 0, ignored: 0 };
  walk(a.base, b.base, "base", top);
  report(top, "base");
  for (const id of new Set([...Object.keys(a.sizes), ...Object.keys(b.sizes)])) {
    const x = a.sizes[id];
    const y = b.sizes[id];
    if (!x || !y) {
      say(`size ${id} is logged on one side only`);
      continue;
    }
    let equal = 0;
    let ignored = 0;
    const differing = [];
    const one = (u, v, where) => {
      const acc = { diffs: [], equal: 0, ignored: 0 };
      walk(u, v, where, acc);
      report(acc, where);
      equal += acc.equal;
      ignored += acc.ignored;
      if (acc.diffs.length) differing.push(`${where.slice(id.length + 1)} ${acc.diffs.length}`);
    };
    one(x.statics, y.statics, `${id}.statics`);
    for (const k of new Set([...Object.keys(x.scenarios), ...Object.keys(y.scenarios)])) one(x.scenarios[k], y.scenarios[k], `${id}.${k}`);
    const tail = `${equal} values equal over its statics and every scenario's passes${ignored ? `, ${ignored} excused by --ignore` : ""}`;
    console.log(`against ${id}: ${differing.length ? `DIFFERS (above; differences per part: ${differing.join(", ")}), ` : "equal, "}${tail}`);
  }
  for (const r of ignores) console.log(`against: --ignore ${r.pattern} ${r.hits ? `excused ${r.hits} path${r.hits === 1 ? "" : "s"}` : "matched NOTHING"}`);
  if (!failed) console.log("against: equal");
  return failed;
}
