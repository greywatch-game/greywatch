/**
 * The irradiance volume, logged step by step in a LIVE frame loop: what
 * `BABYLON_EXIT.md` X5.1b must reproduce when the volume's GPU half (its three
 * compute passes, six buffers and seven 3D textures) becomes ours, read off the
 * parent rather than argued (X5.1a, which built it and measured with it).
 *
 * Run with `node plans/webgpu-ref/gi.mjs [map...] [--out=f.json]
 * [--against=f.json] [--no-editor] [--no-states] [--shafts-off]`, or with no
 * browser at all as `node plans/webgpu-ref/gi.mjs --compare=a.json
 * --against=b.json`, which compares two logs this file wrote (how the
 * comparison is shown to FAIL on a hand-edited copy). Several maps are one boot,
 * rotated through the menu as a player rotates them; `hollowmere coldharbour` is
 * the default (the lanterns, then the hulls and a cloud field the trace
 * samples). `--shafts-off` boots with the light shafts off (the one Babylon pass
 * in a round that binds the cloud field, `Volumetrics`, until X5.2), which is
 * the session in which the trace's cloud sampler is not our host's. Nothing in
 * the repository is written but `--out`. About two minutes on the Windows box.
 *
 * **Why a probe and not only the bank.** Every bank row photographs the
 * volume's CONVERGED fixed point with no dispatch in its frame and no pulse
 * light in it (`harness.mjs`'s `freeze` re-sweeps it and stubs `update`), so a
 * wrong slice order, a dropped frame, a vis channel left dirty, the bake and the
 * dispatch recorded in another order, or a fast light that does not die with
 * its flash can all converge to the same bytes. This file watches the volume
 * MOVE: from a fresh history, one `update` at a time, with the seven textures
 * and the six buffers read back off the GPU after each.
 *
 * **THE TRACE RACES, and that decides what can be compared** (X5.1a). The trace
 * lights a hit with the volume's own history, and another workgroup of the
 * SAME dispatch may be rewriting the probe it reads (`giTrace.ts` says so: "may
 * be read before or after its own write; both are history"). So at the game's
 * budget the trace's COLOUR — the SH colour's rgb and direction's xyz in the
 * state, the rgb of `giIrr` and `giDir` — is not a function of its inputs, and
 * no two runs of the same tree agree on it: one step from the same fresh
 * history gave four hashes in four tries. With ONE workgroup a dispatch nothing
 * races, and three tries of forty steps were byte-equal. So every readback of
 * those three resources is hashed TWICE: `name` over the lanes no other
 * workgroup's write can reach (sun, sky, age, validity, column, position; the
 * textures' alpha), `name~` over the colour; and a `serial` scenario (the
 * trace's budget overridden to 1, `P.budget`) is compared on both, every other
 * scenario on the first alone. `giAux`, the vis textures and buffer, and the
 * params, boxes, index and heights buffers are hashed whole and compared
 * everywhere.
 *
 * **What makes two runs comparable.** The round's seed is pinned (`?seed=`, so
 * the player's spawn — and the carried lamp standing at it, a light every
 * channel and fast list sees — is the same), the world is the deploy screen's,
 * HELD (offline the match is held under it), frozen by `freeze` minus `gi` and
 * `reflections` (the volume is what is watched; the bake samples it and changes
 * nothing it reads), the camera at a stated eye. Then the volume is STEPPED:
 * `GiVolume.update` is wrapped so that it runs only on a frame the probe hands a
 * token to, and after each such frame the probe reads the CPU half and copies
 * the GPU half back before handing the next. **That rests on the harness's own
 * contract** (`freeze`'s `gi` block): a frame whose `update` did not run
 * dispatches nothing, so the frames rendered between two steps do not touch the
 * volume, and a port that records its passes in a prepare must record them only
 * on a frame `update` armed. Each scenario starts from a known state: `setMap`
 * (the install's own door) on the standing map, which gives the volume fresh
 * buffers, a cursor of 0 and its two warm sweeps. **The instrument modes write
 * `GiVolume.tier`** (a copy of the tier with both budgets at 1, or at 0 for
 * compose alone), so they rest on `update` reading its budget off `this.tier`,
 * which the CPU half keeps.
 *
 * **Logged every step** (compared by `Object.is`, and the typed arrays by their
 * BYTES): the tier, `cursor`, `warmFrames`, `placed`, the window (`ox`, `oz`,
 * `refY`), `converged`; the binding's five vectors and `slotChannel`; the slow
 * and fast light lists; the channels (dirty, owned, where, and age rather than
 * the absolute frame stamp, which counts from boot); the hull scratch; the whole
 * params array; and the passes the frame dispatched, each by NAME
 * (`gi-trace`/`-compose`/`-vis`, told apart by its module's source, so the count
 * reads the same whoever records them) and workgroup count. **Read back every
 * step**: the seven textures and the six buffers, as above, through one adapter
 * (`window.__giGpu`) that finds them: Babylon's `RawTexture3D`s and
 * `StorageBuffer`s at the parent; **X5.1b adds its arm**, picked first when
 * present (its GPUTextures and GPUBuffers by the same thirteen names, made with
 * `COPY_SRC`, which Babylon's carry and a readback needs; one without it reads
 * `not-copyable` and the comparison fails).
 *
 * **The scenarios**, on each map: `serial` (a fresh history, 96 steps at one
 * workgroup: every byte); `warm` (a fresh history through its two warm sweeps,
 * one steady sweep and eight steps, at the game's budget); `stable` (eight
 * sweeps at the warm budget, as `freeze` takes it, then two steady sweeps: how
 * much a held, converged world still moves); `lampHigh` (a fixture switched on
 * 5 m off the eye, `fast` false, followed for three sweeps against the volume
 * re-converged with it: the share of the eventual change to the irradiance in
 * place after each sweep — the plan's "a lamp reaching the bounce within one
 * sweep" as a number — by magnitude, since it is the trace's colour); `pulse` (a
 * transient flash stepped at 1/60 s until it dies, the flame clock held and the
 * trace's budget at ZERO, beside the same steps with none: compose takes it and
 * gives it back byte for byte); `tiers` (`setQuality` low — `serial`, a warm-up,
 * the lamp — then off and high again); and `samplerSerial` (the cloud field's
 * sampler as Babylon's compute bind makes it, then forced to the other state —
 * null, as no Babylon bind leaves it, or our host's — each from a fresh history
 * through 256 serial steps, compared byte for byte; the four sampling fields
 * pinned as accessors for the second, since the light shafts rewrite them every
 * frame they run).
 *
 * **And beside the log, measured once a run and NOT compared** (they ride the
 * machine's timing): every frame's state, whether the volume dispatched, how
 * many prepares our renderer ran (`FrameHost.prepareEncoder` asked), whether
 * Babylon's dispatch ENDED a render pass (`_endCurrentRenderPass`'s answer
 * inside `_computeDispatch`), which encoder each of the volume's passes went on
 * (read at the pass: both are replaced at every flush) and how many render
 * passes that encoder had begun ahead of it, and Babylon's binds of the seven
 * and the cloud field (`_setTexture`, by texture and sampler name: an editor
 * build's cel materials, the light shafts) — through the building card, deploy,
 * a live round, the round-over card (raised by `Game.endRound`, the method the
 * wire's `roundover` reaches), the menu and an editor build (`F2`, a placement
 * dragged and released and dragged back: `worldMoved` twice); and the frames
 * from each `setMap` and `setQuality` to the volume's first dispatch. Read off
 * the device from the page's first line (`bootMap`'s `init`): the three
 * modules' TOKENS against `giTrace.ts`'s sources (Babylon reflows the text and
 * prepends two comment lines; X5.1a found the tokens equal), the pipelines
 * (sync or async, the layout), the bind groups' entries, the seven textures'
 * descriptors and usage, the buffers' sizes and usage, and every sampler
 * involved: the seven's as our host resolves them, and the cloud field's as the
 * trace binds it and as our host would, fresh, after `F2` and in the round after
 * it.
 *
 * **`--against`** (or `--compare`) compares map by map, scenario by scenario,
 * step by step: every logged number by `Object.is`, every array's bytes, every
 * comparable readback's hash (the race, above), and the static facts (the
 * tokens, descriptors, bind entries, samplers, sizes, the prepare counts) but the
 * frames they were made on; a lamp's `result` is arithmetic on the colour and is
 * printed, not compared. It names the first difference per map and exits 1.
 *
 * A lost device ends it (`harness.mjs`'s header, exit 4), and so does a hard
 * limit (exit 3).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { bootMap, freeze, FREEZE_SET, hardLimit, installRound, launchClient, root, startDevServer, thaw } from "./harness.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = opt("out", "");
const AGAINST = opt("against", "");
const COMPARE = opt("compare", "");
const EDITOR = !args.includes("--no-editor");
const STATES = !args.includes("--no-states");
// A boot with the light shafts OFF: the one Babylon pass in a round that binds
// the cloud field (`Volumetrics`), so its sampler fields are as nothing set them.
const SHAFTS_OFF = args.includes("--shafts-off");
const maps = args.filter((a) => !a.startsWith("--"));
if (!maps.length) maps.push("hollowmere", "coldharbour");

if (COMPARE) {
  if (!AGAINST) throw new Error("--compare=<a.json> wants --against=<b.json>");
  const failed = compareLogs(JSON.parse(readFileSync(COMPARE, "utf8")), JSON.parse(readFileSync(AGAINST, "utf8")));
  process.exit(failed ? 1 : 0);
}

hardLimit(900 + maps.length * 900);

/**
 * The device, wrapped before the game's first line (`bootMap`'s `init`). Only
 * the volume's own objects are described; everything else passes through. The
 * probe's own copies are made under `self` and leave no trace in the log.
 */
function deviceProbe(shaftsOff) {
  // `--shafts-off`: the setting written before the game reads it (`settings.ts`).
  if (shaftsOff) window.localStorage.setItem("greywatch.setting.volumetrics", "off");
  const P = (window.__giProbe = {
    self: false,
    frame: 0,
    events: [],
    modules: [],
    pipelines: [],
    bindGroups: {},
    bindCount: {},
    samplerDesc: new WeakMap(),
    textureDesc: new WeakMap(),
    viewOf: new WeakMap(),
    bufferDesc: new WeakMap(),
    moduleName: new WeakMap(),
    pipeName: new WeakMap(),
    layoutName: new WeakMap(),
    encId: new WeakMap(),
    cbEnc: new WeakMap(),
    passOf: new WeakMap(),
    nextEnc: 0,
  });
  const giName = (code) =>
    typeof code !== "string"
      ? null
      : code.includes("fn cloudLitAt(")
        ? "gi-trace"
        : code.includes("var outIrr:")
          ? "gi-compose"
          : code.includes("var outVis0:")
            ? "gi-vis"
            : null;
  const D = window.GPUDevice?.prototype;
  if (!D) return;
  const wrap = (proto, name, fn) => {
    const orig = proto[name];
    if (!orig) return;
    proto[name] = function (...a) {
      return fn.call(this, orig, a);
    };
  };
  wrap(D, "createShaderModule", function (orig, a) {
    const m = orig.apply(this, a);
    const n = P.self ? null : giName(a[0]?.code);
    if (n) {
      P.moduleName.set(m, n);
      P.modules.push({ name: n, frame: P.frame, code: a[0].code });
    }
    return m;
  });
  for (const k of ["createComputePipeline", "createComputePipelineAsync"]) {
    wrap(D, k, function (orig, a) {
      const r = orig.apply(this, a);
      const n = P.moduleName.get(a[0]?.compute?.module);
      if (n) {
        const rec = { name: n, call: k, frame: P.frame, layout: typeof a[0].layout === "string" ? a[0].layout : "explicit", entryPoint: a[0].compute.entryPoint ?? null };
        P.pipelines.push(rec);
        if (r && typeof r.then === "function") r.then((p) => P.pipeName.set(p, n));
        else P.pipeName.set(r, n);
      }
      return r;
    });
  }
  const CP = window.GPUComputePipeline?.prototype;
  if (CP) {
    wrap(CP, "getBindGroupLayout", function (orig, a) {
      const l = orig.apply(this, a);
      const n = P.pipeName.get(this);
      if (n) P.layoutName.set(l, n);
      return l;
    });
  }
  wrap(D, "createSampler", function (orig, a) {
    const s = orig.apply(this, a);
    const d = { ...(a[0] ?? {}) };
    delete d.label;
    P.samplerDesc.set(s, d);
    return s;
  });
  wrap(D, "createTexture", function (orig, a) {
    const t = orig.apply(this, a);
    const d = a[0] ?? {};
    P.textureDesc.set(t, {
      size: Array.isArray(d.size) ? [...d.size] : d.size && typeof d.size === "object" ? [d.size.width, d.size.height ?? 1, d.size.depthOrArrayLayers ?? 1] : d.size,
      format: d.format,
      dimension: d.dimension ?? "2d",
      mipLevelCount: d.mipLevelCount ?? 1,
      sampleCount: d.sampleCount ?? 1,
      usage: d.usage,
      viewFormats: d.viewFormats ? [...d.viewFormats] : [],
    });
    return t;
  });
  const T = window.GPUTexture?.prototype;
  if (T) {
    wrap(T, "createView", function (orig, a) {
      const v = orig.apply(this, a);
      const d = { ...(a[0] ?? {}) };
      delete d.label;
      P.viewOf.set(v, { texture: this, desc: d });
      return v;
    });
  }
  wrap(D, "createBuffer", function (orig, a) {
    const b = orig.apply(this, a);
    if (!P.self) P.bufferDesc.set(b, { size: a[0]?.size, usage: a[0]?.usage });
    return b;
  });
  const describe = (res) => {
    if (!res) return null;
    if (P.samplerDesc.has(res)) return { kind: "sampler", desc: P.samplerDesc.get(res) };
    if (P.viewOf.has(res)) {
      const v = P.viewOf.get(res);
      return { kind: "view", desc: v.desc, texture: P.textureDesc.get(v.texture) ?? null };
    }
    if (res.buffer) return { kind: "buffer", offset: res.offset ?? 0, size: res.size ?? null, buffer: P.bufferDesc.get(res.buffer) ?? null };
    return { kind: "unknown" };
  };
  P.describe = describe;
  wrap(D, "createBindGroup", function (orig, a) {
    const bg = orig.apply(this, a);
    const n = P.layoutName.get(a[0]?.layout);
    if (n) {
      P.bindCount[n] = (P.bindCount[n] ?? 0) + 1;
      P.bindGroups[n] = { frame: P.frame, entries: (a[0].entries ?? []).map((e) => ({ binding: e.binding, ...describe(e.resource) })), raw: a[0].entries };
    }
    return bg;
  });
  const E = window.GPUCommandEncoder?.prototype;
  const encOf = (enc) => {
    if (!P.encId.has(enc)) P.encId.set(enc, ++P.nextEnc);
    return P.encId.get(enc);
  };
  P.encOf = encOf;
  // Which of Babylon's two encoders an event was recorded on, read AT the
  // event: both are replaced at every flush (`flushFramebuffer`).
  const roleOf = (enc) => {
    const e = P.engine;
    return !e ? "?" : enc === e._renderEncoder ? "render" : enc === e._uploadEncoder ? "upload" : "other";
  };
  if (E) {
    wrap(E, "beginComputePass", function (orig, a) {
      const pass = orig.apply(this, a);
      if (!P.self) {
        const ev = { k: "C", enc: encOf(this), role: roleOf(this), name: null, x: null };
        P.events.push(ev);
        P.passOf.set(pass, ev);
      }
      return pass;
    });
    wrap(E, "beginRenderPass", function (orig, a) {
      const pass = orig.apply(this, a);
      if (!P.self) {
        const c = a[0]?.colorAttachments?.[0];
        const ev = { k: "R", enc: encOf(this), role: roleOf(this), load: c ? c.loadOp : a[0]?.depthStencilAttachment?.depthLoadOp ?? "?" };
        P.events.push(ev);
        P.passOf.set(pass, ev);
      }
      return pass;
    });
    wrap(E, "finish", function (orig, a) {
      const cb = orig.apply(this, a);
      P.cbEnc.set(cb, encOf(this));
      return cb;
    });
  }
  const CPE = window.GPUComputePassEncoder?.prototype;
  if (CPE) {
    wrap(CPE, "setPipeline", function (orig, a) {
      const ev = P.passOf.get(this);
      if (ev) ev.name = P.pipeName.get(a[0]) ?? ev.name ?? "other";
      return orig.apply(this, a);
    });
    wrap(CPE, "dispatchWorkgroups", function (orig, a) {
      const ev = P.passOf.get(this);
      if (ev) ev.x = [a[0], a[1] ?? 1, a[2] ?? 1];
      return orig.apply(this, a);
    });
  }
  const RPE = window.GPURenderPassEncoder?.prototype;
  if (RPE) {
    wrap(RPE, "end", function (orig, a) {
      const ev = P.passOf.get(this);
      if (ev && !P.self) P.events.push({ k: "E", enc: ev.enc });
      return orig.apply(this, a);
    });
  }
  const Q = window.GPUQueue?.prototype;
  if (Q) {
    wrap(Q, "submit", function (orig, a) {
      if (!P.self) P.events.push({ k: "S", encs: [...(a[0] ?? [])].map((cb) => P.cbEnc.get(cb) ?? 0) });
      return orig.apply(this, a);
    });
  }
}

const vite = await startDevServer(root);
const browser = await launchClient({ headed: false });
// The round's seed, pinned: which spawn the player is placed at (and so where
// its carried lamp stands, a light every channel and fast list sees) is the
// seed's, and a fresh draw a boot is a different volume a boot.
const SEED = 5101;
const { page, pageErrors, consoleErrors } = await bootMap(browser, `${vite.url}${vite.url.endsWith("/") ? "" : "/"}?seed=${SEED}`, maps[0], {
  init: [deviceProbe, SHAFTS_OFF],
});
page.on("dialog", (d) => void d.accept());

// The hooks on the game, once a boot: the frame clock, the counters and the
// adapter. Everything is read at the END of a frame (`onEndFrameObservable`,
// after Babylon's submit), so a copy submitted there sees the frame's work.
await page.evaluate(async () => {
  const g = window.__celshock;
  const P = window.__giProbe;
  const e = g.engine;
  const gi = g.gi;
  P.src = await import("/src/shaders/wgsl/giTrace.ts");
  P.records = [];
  P.calls = [];
  P.callsAll = [];
  P.upd = 0;
  P.real = 0;
  P.prep = 0;
  P.vp = 0;
  P.dp = 0;
  P.ended = [];
  P.setTex = 0;
  P.setTexNames = {};
  P.gate = false;
  P.tokens = 0;
  // Babylon's dispatch: did it END a render pass? `_endCurrentRenderPass`
  // answers 0 when none was open (`thinWebGPUEngine.js`).
  const cd = e._computeDispatch;
  e._computeDispatch = function (effect, ...rest) {
    const key = String(effect?._key ?? "");
    const n = key.includes("fn cloudLitAt(") ? "gi-trace" : key.includes("var outIrr:") ? "gi-compose" : key.includes("var outVis0:") ? "gi-vis" : null;
    if (!n) return cd.call(this, effect, ...rest);
    let r = null;
    const end = this._endCurrentRenderPass;
    this._endCurrentRenderPass = function () {
      r = end.call(this);
      return r;
    };
    try {
      return cd.call(this, effect, ...rest);
    } finally {
      delete this._endCurrentRenderPass;
      P.ended.push([n, r]);
    }
  };
  // Our renderer's prepares ran this frame iff the host's encoder was asked.
  const host = g.renderer.host;
  const pe = host.prepareEncoder;
  host.prepareEncoder = function () {
    P.prep++;
    return pe.call(this);
  };
  const vp = host.viewProjection;
  host.viewProjection = function (out) {
    P.vp++;
    return vp.call(this, out);
  };
  g.scene.onBeforeDrawPhaseObservable.add(() => P.dp++);
  // Babylon's materials binding the volume's textures or the cloud field (an
  // editor build): a Babylon draw sampling them, counted at the engine's bind.
  const st = e._setTexture;
  e._setTexture = function (channel, texture, ...rest) {
    const nm = texture?.name ?? "";
    if (nm.startsWith("gi-") || nm === "cloudShadow") {
      P.setTex++;
      const k = `${nm}<-${rest[2] ?? "?"}`;
      P.setTexNames[k] = (P.setTexNames[k] ?? 0) + 1;
    }
    return st.call(this, channel, texture, ...rest);
  };
  // The volume's doors, stamped with the frame and the state.
  for (const k of ["setMap", "setQuality", "clearMap", "worldMoved"]) {
    const f = gi[k];
    gi[k] = function (...a) {
      const c = { call: k, arg: k === "setQuality" ? a[0] : undefined, frame: P.frame, state: g.state, editor: Boolean(g.editor) };
      P.calls.push(c);
      P.callsAll.push(c);
      return f.apply(this, a);
    };
  }
  // The step gate (the header): with `gate` on, `update` runs only on a frame
  // that holds a token.
  const real = Object.getPrototypeOf(gi).update;
  gi.update = function (...a) {
    P.upd++;
    if (P.gate) {
      if (P.tokens <= 0) return;
      P.tokens--;
    }
    P.real++;
    return real.apply(this, a);
  };
  P.engine = e;
  e.onEndFrameObservable.add(() => {
    const ev = P.events;
    P.events = [];
    const giPasses = [];
    // Render passes begun on the same encoder ahead of each of the volume's.
    const before = new Map();
    for (const x of ev) {
      if (x.k === "R") before.set(x.enc, (before.get(x.enc) ?? 0) + 1);
      if (x.k === "C" && x.name && x.name.startsWith("gi-")) {
        giPasses.push([x.name, x.x ? x.x[0] : null, x.role, before.get(x.enc) ?? 0]);
      }
    }
    // Where our prepares' passes sit against the volume's: the first pass on
    // the upload encoder and the first of the volume's on the render encoder,
    // in submit order (upload first).
    const submits = ev.filter((x) => x.k === "S").map((x) => x.encs.length);
    P.records.push({
      f: P.frame,
      state: g.state,
      editor: Boolean(g.editor),
      upd: P.upd,
      real: P.real,
      gi: giPasses,
      ended: P.ended,
      prep: P.prep,
      vp: P.vp,
      dp: P.dp,
      R: ev.filter((x) => x.k === "R").length,
      C: ev.filter((x) => x.k === "C").length,
      setTex: P.setTex,
      setTexNames: P.setTexNames,
      submits,
      uploadPasses: ev.filter((x) => x.role === "upload" && (x.k === "R" || x.k === "C")).length,
      bind: { ...P.bindCount },
    });
    if (P.records.length > 60000) P.records.splice(0, 10000);
    P.frame++;
    P.upd = P.real = P.prep = P.vp = P.dp = P.setTex = 0;
    P.setTexNames = {};
    P.ended = [];
    P.bindCount = {};
  });
  P.nextFrame = () => new Promise((res) => e.onEndFrameObservable.addOnce(() => res()));

  // **The GPU half, through ONE adapter.** Babylon's arm: the seven
  // `RawTexture3D`s' and the six `StorageBuffer`s' GPU objects. X5.1b adds OURS
  // beside it, picked first when present, by the same thirteen names.
  const babylon = {
    texture: (n) => g.gi.textures?.[n]?.getInternalTexture?.()?._hardwareTexture?.underlyingResource ?? null,
    buffer: (n) =>
      ({ params: g.gi.params, state: g.gi.state, vis: g.gi.visState, boxes: g.gi.boxes, index: g.gi.index, heights: g.gi.heights })[n]?.getBuffer?.()?.underlyingResource ?? null,
  };
  window.__giGpu = babylon;
  P.TEXTURES = ["giIrr", "giDir", "giAux", "giVis0", "giVis1", "giVis2", "giVis3"];
  P.BUFFERS = ["params", "state", "vis", "boxes", "index", "heights"];
  // The lanes the trace writes from a HISTORY read (the bounce): another
  // workgroup of the same dispatch may have rewritten that history first, so
  // they are not a function of the inputs (measured: X5.1a). Per probe the
  // state is 16 u32 (SH colour rgb + sun, SH direction xyz + sky, age, valid,
  // column x, z, position xyz, 0); a texel of irr and dir is 4 halves (rgb or
  // xyz, then the floor height or the validity).
  P.RACED = {
    state: { width: 16, raced: [0, 1, 2, 4, 5, 6], exact: [3, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
    giIrr: { width: 4, raced: [0, 1, 2], exact: [3] },
    giDir: { width: 4, raced: [0, 1, 2], exact: [3] },
  };
  /** The trace's budget overridden for an instrument mode (`serial`: 1; compose alone: 0); null puts the tier back. */
  P.budget = (b) => {
    const gi = g.gi;
    P.tierOf ??= new Map();
    if (b === null) {
      if (P.tierOf.has(gi.quality)) gi.tier = P.tierOf.get(gi.quality);
      return;
    }
    if (!P.tierOf.has(gi.quality)) P.tierOf.set(gi.quality, gi.tier);
    const t = P.tierOf.get(gi.quality);
    gi.tier = { ...t, probesPerFrame: b, warmProbesPerFrame: b };
  };

  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const BPP = { rgba16float: 8, rgba8unorm: 4, rg8unorm: 2, rgba32float: 16, r8unorm: 1 };
  /** One resource's bytes, rows unpadded; null when there is none or it cannot be copied. */
  P.read = async (names, keep = []) => {
    const dev = e._device;
    const out = {};
    const jobs = [];
    P.self = true;
    try {
      const enc = dev.createCommandEncoder();
      for (const n of names) {
        const isTex = P.TEXTURES.includes(n);
        const r = isTex ? window.__giGpu.texture(n) : window.__giGpu.buffer(n);
        if (!r) {
          out[n] = "absent";
          continue;
        }
        if (!(r.usage & (isTex ? GPUTextureUsage.COPY_SRC : GPUBufferUsage.COPY_SRC))) {
          out[n] = "not-copyable";
          continue;
        }
        if (isTex) {
          const bpp = BPP[r.format];
          const row = r.width * bpp;
          const pitch = Math.ceil(row / 256) * 256;
          const rows = r.height * r.depthOrArrayLayers;
          const s = dev.createBuffer({ size: pitch * rows, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          enc.copyTextureToBuffer({ texture: r }, { buffer: s, bytesPerRow: pitch, rowsPerImage: r.height }, [r.width, r.height, r.depthOrArrayLayers]);
          jobs.push({ n, s, row, pitch, rows, size: [r.width, r.height, r.depthOrArrayLayers], format: r.format });
        } else {
          const size = Math.ceil(r.size / 4) * 4;
          const s = dev.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          enc.copyBufferToBuffer(r, 0, s, 0, size);
          jobs.push({ n, s, row: size, pitch: size, rows: 1, size: [r.size] });
        }
      }
      dev.queue.submit([enc.finish()]);
    } finally {
      P.self = false;
    }
    await Promise.all(jobs.map((j) => j.s.mapAsync(GPUMapMode.READ)));
    for (const j of jobs) {
      const src = new Uint8Array(j.s.getMappedRange());
      let bytes;
      if (j.pitch === j.row) bytes = src.slice(0, j.row * j.rows);
      else {
        bytes = new Uint8Array(j.row * j.rows);
        for (let i = 0; i < j.rows; i++) bytes.set(src.subarray(i * j.pitch, i * j.pitch + j.row), i * j.row);
      }
      j.s.unmap();
      j.s.destroy();
      const dims = j.size.join("x");
      const split = P.RACED[j.n];
      if (split) {
        // The trace's colour lanes RACE (the header): hashed apart from the
        // lanes no other workgroup's write can reach, so a full-budget step is
        // compared on the second alone and a serial one on both.
        const w = split.width;
        const lanes = (j.n === "state" ? new Uint32Array(bytes.buffer) : new Uint16Array(bytes.buffer));
        const pick = (set) => {
          const o = new (lanes.constructor)((lanes.length / w) * set.length);
          for (let p = 0, k = 0; p < lanes.length; p += w) for (const c of set) o[k++] = lanes[p + c];
          return new Uint8Array(o.buffer);
        };
        out[j.n] = `${dims}:${hex(await crypto.subtle.digest("SHA-256", pick(split.exact)))}`;
        out[`${j.n}~`] = `${dims}:${hex(await crypto.subtle.digest("SHA-256", pick(split.raced)))}`;
      } else {
        out[j.n] = `${dims}:${hex(await crypto.subtle.digest("SHA-256", bytes))}`;
      }
      if (keep.includes(j.n)) (P.kept ??= {})[j.n] = bytes;
    }
    return out;
  };

  /** An rgba16float texture's bytes as its rgb in floats, three a texel. */
  P.halves = (bytes) => {
    const u = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const f = new Float32Array((u.length / 4) * 3);
    for (let t = 0, k = 0; t < u.length; t += 4) {
      for (let c = 0; c < 3; c++) {
        const h = u[t + c];
        const s = h & 0x8000 ? -1 : 1;
        const e = (h >> 10) & 0x1f;
        const m = h & 0x3ff;
        f[k++] = e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + m / 1024);
      }
    }
    return f;
  };
  const b64 = (ta) => {
    const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
    let s = "";
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  };
  const v4 = (v) => [v.x, v.y, v.z, v.w];
  const L = (l) => [l.x, l.y, l.z, l.range, l.r, l.g, l.b, l.score];
  /** The CPU half, as `GiVolume` holds it after the step's `update`. */
  P.snap = () => {
    const v = g.gi;
    const b = v.binding;
    return {
      quality: v.quality,
      tier: v.tier ? [v.tier.columns, v.tier.layers, v.tier.rays] : null,
      cursor: v.cursor,
      warmFrames: v.warmFrames,
      placed: v.placed ? 1 : 0,
      ox: v.ox,
      oz: v.oz,
      refY: v.refY,
      topY: v.topY,
      converged: v.converged ? 1 : 0,
      grid: v4(b.grid),
      window: v4(b.window),
      shade: v4(b.shade),
      band: v4(b.band),
      extra: v4(b.extra),
      slotChannel: b64(b.slotChannel),
      slow: v.slow.map(L),
      fast: v.fast.map(L),
      chanDirty: Array.from(v.chanDirty),
      chanOwned: v.chanLight.map((l) => (l ? 1 : 0)),
      chanAt: b64(v.chanAt),
      chanAge: Array.from(v.chanSeen, (s) => (s === 0 ? -1 : v.frame - s)),
      hullData: b64(v.hullData),
      params: b64(v.paramData),
      sceneRows: b64(v.sceneRows),
      cloud: v.cloudBound ? v.cloudBound.name : null,
    };
  };
  /** One step: a token, the frame it was spent on, the CPU half, the GPU half. */
  P.step = async (read = [...P.TEXTURES, ...P.BUFFERS], keep = []) => {
    P.tokens = 1;
    let rec = null;
    for (let i = 0; i < 600 && !rec; i++) {
      await P.nextFrame();
      const last = P.records[P.records.length - 1];
      if (last.real > 0) rec = last;
    }
    if (!rec) throw new Error("the volume never took its token");
    const snap = P.snap();
    snap.dispatched = rec.gi.map((x) => [x[0], x[1]]);
    snap.read = read.length ? await P.read(read, keep) : {};
    return snap;
  };
});

/** -0 and NaN do not survive JSON; every number is kept as `Object.is` would compare it. */
const enc = (x) =>
  typeof x === "number" ? (Object.is(x, -0) ? "-0" : Number.isNaN(x) ? "NaN" : x === Infinity ? "Inf" : x === -Infinity ? "-Inf" : x) : Array.isArray(x) ? x.map(enc) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, enc(v)])) : x;

const report = { seed: SEED, shaftsOff: SHAFTS_OFF, maps: [], states: null, statics: {}, editor: null, firstDispatch: [] };

/** Frames recorded since `from`, summarised per state. */
async function stateSummary(from) {
  return page.evaluate((from) => {
    const P = window.__giProbe;
    const out = {};
    for (const r of P.records.filter((r) => r.f >= from)) {
      const k = r.editor ? `editor (${r.state})` : r.state;
      const s = (out[k] ??= { frames: 0, dispatched: 0, dispatchedNoPrepare: 0, dispatchedNoBegin: 0, endedPass: 0, renderPassBefore: 0, onRender: 0, onUpload: 0, other: 0, R: [Infinity, 0, 0], C: [Infinity, 0, 0], giPasses: [Infinity, 0], noPrepare: 0, setTex: 0, traceBinds: 0 });
      s.frames++;
      const d = r.gi.length > 0;
      if (d) s.dispatched++;
      if (d && r.prep === 0) s.dispatchedNoPrepare++;
      if (d && r.vp === 0) s.dispatchedNoBegin++;
      if (r.prep === 0) s.noPrepare++;
      if (r.ended.some((x) => x[1])) s.endedPass++;
      for (const x of r.gi) {
        if (x[3] > 0) s.renderPassBefore++;
        if (x[2] === "render") s.onRender++;
        else if (x[2] === "upload") s.onUpload++;
        else s.other++;
      }
      s.R = [Math.min(s.R[0], r.R), Math.max(s.R[1], r.R), s.R[2] + r.R];
      s.C = [Math.min(s.C[0], r.C), Math.max(s.C[1], r.C), s.C[2] + r.C];
      s.giPasses = [Math.min(s.giPasses[0], r.gi.length), Math.max(s.giPasses[1], r.gi.length)];
      s.setTex += r.setTex;
      for (const [k, n] of Object.entries(r.setTexNames ?? {})) (s.setTexNames ??= {})[k] = (s.setTexNames[k] ?? 0) + n;
      s.traceBinds += r.bind["gi-trace"] ?? 0;
    }
    for (const s of Object.values(out)) {
      s.R = { min: s.R[0], max: s.R[1], mean: +(s.R[2] / s.frames).toFixed(2) };
      s.C = { min: s.C[0], max: s.C[1], mean: +(s.C[2] / s.frames).toFixed(2) };
    }
    return out;
  }, from);
}

const frameNow = () => page.evaluate(() => window.__giProbe.frame);
const frames = (n) =>
  page.evaluate(async (n) => {
    const P = window.__giProbe;
    for (let i = 0; i < n; i++) await P.nextFrame();
  }, n);

/** The cloud field's sampler: the trace's bind group's, and what our host resolves for the same texture. */
const samplers = () =>
  page.evaluate(() => {
    const g = window.__celshock;
    const P = window.__giProbe;
    const cloud = g.mats.readLighting().cloudMap;
    const internal = cloud.getInternalTexture();
    const bg = P.bindGroups["gi-trace"];
    const traceSampler = bg?.raw?.find((x) => x.binding === 5)?.resource ?? null;
    const out = { view: null, sampler: null };
    g.renderer.host.bind(cloud, out);
    const lit = g.mats.readLighting();
    return {
      cloud: cloud.name,
      internalCached: {
        wrapU: internal._cachedWrapU,
        wrapV: internal._cachedWrapV,
        wrapR: internal._cachedWrapR,
        anisotropy: internal._cachedAnisotropicFilteringLevel,
        samplingMode: internal.samplingMode,
        useMipMaps: internal.useMipMaps,
      },
      texture: { wrapU: cloud.wrapU, wrapV: cloud.wrapV, wrapR: cloud.wrapR, anisotropy: cloud.anisotropicFilteringLevel },
      trace: traceSampler ? P.samplerDesc.get(traceSampler) ?? "undescribed" : null,
      host: out.sampler ? P.samplerDesc.get(out.sampler) ?? "undescribed" : null,
      same: Boolean(traceSampler) && traceSampler === out.sampler,
      traceBoundOnFrame: bg?.frame ?? null,
      cloudArea: [lit.cloudArea.x, lit.cloudArea.y, lit.cloudArea.z, lit.cloudArea.w],
    };
  });

const statesFrom = await frameNow();
const first = { map: maps[0], states: {} };
// THE FIRST MAP, LIVE: the building card, deploy, a round, the round-over card, the menu.
const install = await installRound(page);
first.installMs = install.installMs;
if (STATES) {
  await frames(60);
  await page.evaluate(async () => {
    const g = window.__celshock;
    g.spawnPlayer();
    for (let i = 0; i < 2400 && g.state !== "playing"; i++) await window.__giProbe.nextFrame();
    if (g.state !== "playing") throw new Error(`no spawn: ${g.state}`);
  });
  await frames(240);
  await page.evaluate(() => window.__celshock.endRound(0));
  await frames(60);
  await page.evaluate(() => window.__celshock.enterMenu());
  await frames(30);
  report.states = await stateSummary(statesFrom);
  await page.evaluate(() => window.__celshock.startRound());
  await page.evaluate(async () => {
    const g = window.__celshock;
    for (let i = 0; i < 20000 && g.state !== "deploy"; i++) await window.__giProbe.nextFrame();
  });
}

// The static facts: WGSL against the sources, the pipelines, the textures, the buffers.
async function statics() {
  return page.evaluate(() => {
    const g = window.__celshock;
    const P = window.__giProbe;
    const tier = g.gi.tier;
    const src = {
      "gi-trace": (t) => P.src.giTraceSource(t.rays),
      "gi-compose": (t) => P.src.giComposeSource(t.fastRays),
      "gi-vis": () => P.src.giVisSource(),
    };
    // Each module against every tier's source, as TOKENS: Babylon's processor
    // reflows the text (indentation dropped, a one-line body split at its
    // braces) and prepends two comment lines (its defines), so the text is
    // never equal and the program is the same exactly when the token streams
    // are (comments out, every identifier, number and symbol in order).
    const tokens = (c) => c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").match(/[A-Za-z_][A-Za-z0-9_]*|[0-9][0-9A-Za-z_.]*|\S/g) ?? [];
    const wgsl = P.modules.map((m) => {
      const a = tokens(m.code);
      const prefix = m.code.split(String.fromCharCode(10)).filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith("//#define")));
      const per = Object.values(window.__giTierTable).map((t) => {
        const b = tokens(src[m.name](t));
        let k = 0;
        while (k < a.length && a[k] === b[k]) k++;
        return { rays: t.rays, fastRays: t.fastRays, equal: a.length === b.length && k === a.length, at: k, module: a.slice(k, k + 8).join(" "), source: b.slice(k, k + 8).join(" ") };
      });
      const eq = per.find((x) => x.equal);
      return { name: m.name, frame: m.frame, length: m.code.length, tokens: a.length, prefix, tokensEqualTo: eq ? { rays: eq.rays, fastRays: eq.fastRays } : null, parts: eq ? undefined : per };
    });
    const tex = {};
    for (const n of P.TEXTURES) {
      const t = window.__giGpu.texture(n);
      const host = { view: null, sampler: null };
      g.renderer.host.bind(g.gi.textures[n], host);
      tex[n] = t
        ? {
            gpu: { width: t.width, height: t.height, depth: t.depthOrArrayLayers, format: t.format, dimension: t.dimension, mipLevelCount: t.mipLevelCount, usage: t.usage },
            created: P.textureDesc.get(t) ?? null,
            hostSampler: host.sampler ? P.samplerDesc.get(host.sampler) ?? "undescribed" : null,
            hostViewIsBabylons: host.view === g.gi.textures[n].getInternalTexture()._hardwareTexture.view,
          }
        : null;
    }
    const buf = {};
    for (const n of P.BUFFERS) {
      const b = window.__giGpu.buffer(n);
      buf[n] = b ? { size: b.size, usage: b.usage } : null;
    }
    const binds = {};
    for (const [n, bg] of Object.entries(P.bindGroups)) binds[n] = bg.entries;
    return {
      tier: tier ? tier.columns : null,
      wgsl,
      pipelines: P.pipelines,
      textures: tex,
      buffers: buf,
      bindGroups: binds,
      late: g.renderer.latePrepares.length,
      prepares: g.renderer.prepares.length,
    };
  });
}
await page.evaluate(async () => {
  window.__giTierTable = (await import("/src/config/gi.ts")).gi.tiers;
});

const MAP_IDS = await page.evaluate(async () => (await import("/src/world/maps.ts")).MAPS.map((m) => m.id));

/** The eye each map is watched from: Hollowmere's `lanterns`, a hull's flank, or the map's centre. */
async function placeEye(id) {
  return page.evaluate((id) => {
    const g = window.__celshock;
    const cam = g.cameraSys.camera;
    const V = cam.position.constructor;
    let x = 2;
    let z = 18;
    let h = 1.7;
    let tx = 0;
    let tz = -14;
    const hull = g.vehicles.hulls[0];
    if (id !== "hollowmere" && hull) {
      x = hull.pos.x + 9;
      z = hull.pos.z - 9;
      h = 2.5;
      tx = hull.pos.x;
      tz = hull.pos.z;
    } else if (id !== "hollowmere") {
      x = 0;
      z = 0;
      tx = 0;
      tz = -20;
    }
    const y = g.map.terrain.surfaceAt(x, z, true) + h;
    cam.position.set(x, y, z);
    cam.setTarget(new V(tx, y, tz));
    return [x, y, z];
  }, id);
}

/** A fresh history through the install's own door. */
const fresh = () =>
  page.evaluate(() => {
    const g = window.__celshock;
    const before = g.gi.floorAlbedo.toHexString();
    g.gi.setMap(g.map, before);
    if (g.gi.floorAlbedo.toHexString() !== before) throw new Error("the floor colour moved under setMap");
  });

/** `n` steps, each read back in full unless `read` says otherwise. */
const steps = (n, read) =>
  page.evaluate(
    async ([n, read]) => {
      const P = window.__giProbe;
      const out = [];
      for (let i = 0; i < n; i++) out.push(await P.step(read ?? undefined));
      return out;
    },
    [n, read ?? null],
  );

const sweepOf = () =>
  page.evaluate(() => {
    const t = window.__celshock.gi.tier;
    if (!t) return null;
    const total = t.columns * t.columns * t.layers;
    return { total, steady: Math.ceil(total / t.probesPerFrame), warm: Math.ceil(total / t.warmProbesPerFrame) };
  });

/** Eight sweeps at the warm budget, as `freeze` takes them, read at the end. */
async function converge() {
  return page.evaluate(async () => {
    const P = window.__giProbe;
    const gi = window.__celshock.gi;
    const t = gi.tier;
    const total = t.columns * t.columns * t.layers;
    gi.warmFrames = gi.sweepFrames(t, total) * 8;
    let n = 0;
    while (gi.warmFrames > 0) {
      await P.step([]);
      if (++n > 2000) throw new Error("never converged");
    }
    return { steps: n, read: await P.read([...P.TEXTURES, ...P.BUFFERS]) };
  });
}

/**
 * A fixture switched on near the eye at full budget, followed texel by texel
 * through `sweeps` steady sweeps, against the volume re-converged with it
 * (eight warm sweeps): how much of the bounce it will add is in place after
 * each sweep. The trace races, so the comparison is by MAGNITUDE (the
 * irradiance's rgb, L1), against the drift the same held world shows with no
 * lamp (`drift`'s `noise`): a texel counts as changed by the lamp when its
 * eventual change is over the largest drift any texel showed. Then switched
 * off and re-converged.
 */
async function lamp(noise, sweeps = 3) {
  const sw = await sweepOf();
  return page.evaluate(
    async ([K, sweep, noise]) => {
      const g = window.__celshock;
      const P = window.__giProbe;
      const gi = g.gi;
      const eye = g.cameraSys.camera.position;
      const irr = () => P.halves(P.kept.giIrr);
      const l1 = (a, b, t) => Math.abs(a[t * 3] - b[t * 3]) + Math.abs(a[t * 3 + 1] - b[t * 3 + 1]) + Math.abs(a[t * 3 + 2] - b[t * 3 + 2]);
      await P.read(["giIrr"], ["giIrr"]);
      const S0 = irr();
      const V = eye.constructor;
      const pos = new V(eye.x + 5, eye.y + 1.2, eye.z + 5);
      const light = g.lighting.add(pos, "#ffc070", 14, 2.5, 0, false, { shadow: "none" });
      g.lighting.update(0, eye, g.mats);
      const log = [];
      const at = {};
      for (let k = 1; k <= K * sweep; k++) {
        log.push(await P.step(undefined, ["giIrr"]));
        if (k % sweep === 0) at[k / sweep] = irr();
      }
      const t = gi.tier;
      gi.warmFrames = gi.sweepFrames(t, t.columns * t.columns * t.layers) * 8;
      while (gi.warmFrames > 0) await P.step([]);
      await P.read(["giIrr"], ["giIrr"]);
      const INF = irr();
      const n = S0.length / 3;
      let total = 0;
      const affected = [];
      for (let x = 0; x < n; x++) {
        const d = l1(INF, S0, x);
        if (d > noise.max) {
          affected.push(x);
          total += d;
        }
      }
      const share = {};
      const within = {};
      for (const [s, A] of Object.entries(at)) {
        let left = 0;
        let r = 0;
        for (const x of affected) {
          const rest = l1(INF, A, x);
          left += rest;
          if (rest <= 0.1 * l1(INF, S0, x)) r++;
        }
        share[s] = total > 0 ? +(1 - left / total).toFixed(6) : null;
        within[s] = affected.length ? +(r / affected.length).toFixed(6) : null;
      }
      g.lighting.remove(light);
      g.lighting.update(0, eye, g.mats);
      gi.warmFrames = gi.sweepFrames(t, t.columns * t.columns * t.layers) * 8;
      while (gi.warmFrames > 0) await P.step([]);
      return {
        log,
        result: {
          sweep,
          light: [pos.x, pos.y, pos.z],
          texels: n,
          affected: affected.length,
          eventualL1: +total.toFixed(6),
          noiseMax: noise.max,
          noiseL1: noise.sum,
          shareOfChangeAfterSweep: share,
          texelsWithin10PercentAfterSweep: within,
        },
      };
    },
    [sweeps, sw.steady, noise],
  );
}

/**
 * A flash raised and stepped at 1/60 s until it dies, the flame clock held,
 * with the trace's budget at ZERO (compose and vis run, the history does not
 * move), beside the same steps with no flash: compose takes it and gives it
 * back, byte for byte, or it does not.
 */
async function pulse() {
  return page.evaluate(async () => {
    const g = window.__celshock;
    const P = window.__giProbe;
    const real = window.__refThaw.lighting;
    const eye = g.cameraSys.camera.position;
    const tick = () => {
      g.lighting.t = 0;
      real.call(g.lighting, 1 / 60, eye, g.mats);
    };
    const C = ["giIrr", "giDir", "giAux", "giVis0", "giVis1", "giVis2", "giVis3", "state", "vis"];
    P.budget(0);
    const run = async (flash) => {
      const log = [];
      tick();
      log.push(await P.step(C));
      if (flash) {
        const V = eye.constructor;
        g.lighting.pulse(new V(eye.x + 3, eye.y + 0.5, eye.z + 3), "#ffd9a0", 12, 3, 0.25);
      }
      for (let k = 0; k < 24; k++) {
        tick();
        log.push(await P.step(C));
      }
      return log;
    };
    const control = await run(false);
    const flash = await run(true);
    P.budget(null);
    // Back to the held world's slots and its clock.
    g.lighting.t = 0;
    g.lighting.update(0, eye, g.mats);
    return { control, flash };
  });
}

/** `n` steps with the trace's budget at one workgroup: no two probes in one dispatch, so nothing races. */
const serial = (n, read) =>
  page.evaluate(
    async ([n, read]) => {
      const P = window.__giProbe;
      P.budget(1);
      const out = [];
      for (let i = 0; i < n; i++) out.push(await P.step(read ?? undefined));
      P.budget(null);
      return out;
    },
    [n, read ?? null],
  );

/** The largest per-texel drift of the irradiance (rgb, L1) over `n` full-budget steps of a converged, held world. */
const drift = (n) =>
  page.evaluate(async (n) => {
    const P = window.__giProbe;
    await P.read(["giIrr"], ["giIrr"]);
    const a = P.halves(P.kept.giIrr);
    const log = [];
    for (let i = 0; i < n; i++) log.push(await P.step(["giIrr", "giDir", "giAux", "giVis0", "giVis1", "giVis2", "giVis3", "state", "vis"], ["giIrr"]));
    const b = P.halves(P.kept.giIrr);
    let max = 0;
    let sum = 0;
    let moved = 0;
    for (let t = 0; t < a.length; t += 3) {
      const d = Math.abs(a[t] - b[t]) + Math.abs(a[t + 1] - b[t + 1]) + Math.abs(a[t + 2] - b[t + 2]);
      if (d > 0) moved++;
      max = Math.max(max, d);
      sum += d;
    }
    return { log, noise: { max, sum: +sum.toFixed(6), moved } };
  }, n);

/**
 * The cloud field's sampler, both ways, each from a fresh history through the
 * same `n` serial steps: as Babylon's compute bind makes it out of the
 * internal texture's cached sampling fields (filled by whichever Babylon
 * material or pass bound the texture last: the light shafts' in a round, an
 * editor build's cel materials), and with those fields as a session where
 * nothing of Babylon's ever bound it leaves them (null: the light shafts off
 * from boot); and our frame host's for the same texture beside both.
 */
async function samplerAB(n) {
  return page.evaluate(async (n) => {
    const g = window.__celshock;
    const P = window.__giProbe;
    const cloud = g.mats.readLighting().cloudMap;
    const it = cloud.getInternalTexture();
    const found = { u: it._cachedWrapU, v: it._cachedWrapV, r: it._cachedWrapR, a: it._cachedAnisotropicFilteringLevel };
    const host = { view: null, sampler: null };
    g.renderer.host.bind(cloud, host);
    const bound = () => P.bindGroups["gi-trace"].raw.find((x) => x.binding === 5).resource;
    const run = async () => {
      g.gi.setMap(g.map, g.gi.floorAlbedo.toHexString());
      P.budget(1);
      const log = [];
      for (let i = 0; i < n; i++) log.push(await P.step(["state", "giIrr", "giDir", "giAux"]));
      P.budget(null);
      const s = bound();
      return { log, sampler: P.samplerDesc.get(s) ?? "undescribed", isHosts: s === host.sampler };
    };
    const a = await run();
    // The OTHER state, held for the run: a Babylon bind that comes along
    // (the light shafts', every frame they are on) writes these four fields,
    // so they are pinned as accessors that answer the forced value and
    // swallow the write, and taken off again after.
    const filled = found.u !== null && found.u !== undefined;
    const forced = filled
      ? { _cachedWrapU: null, _cachedWrapV: null, _cachedWrapR: null, _cachedAnisotropicFilteringLevel: null }
      : { _cachedWrapU: cloud.wrapU, _cachedWrapV: cloud.wrapV, _cachedWrapR: cloud.wrapR, _cachedAnisotropicFilteringLevel: Math.min(cloud.anisotropicFilteringLevel, g.engine.getCaps().maxAnisotropy) };
    for (const [k, v] of Object.entries(forced)) Object.defineProperty(it, k, { configurable: true, get: () => v, set: () => {} });
    const b = await run();
    for (const k of Object.keys(forced)) delete it[k];
    it._cachedWrapU = found.u;
    it._cachedWrapV = found.v;
    it._cachedWrapR = found.r;
    it._cachedAnisotropicFilteringLevel = found.a;
    g.gi.setMap(g.map, g.gi.floorAlbedo.toHexString());
    await P.step([]);
    const restored = P.samplerDesc.get(bound());
    let differ = 0;
    let first = null;
    for (let i = 0; i < n; i++) {
      const x = a.log[i].read;
      const y = b.log[i].read;
      const d = Object.keys(x).filter((k) => x[k] !== y[k]);
      if (d.length) {
        differ++;
        first ??= { step: i, resources: d };
      }
    }
    return {
      found: { wrapU: found.u, wrapV: found.v, wrapR: found.r, anisotropy: found.a },
      forced: filled ? "null (nothing of Babylon's bound it)" : "our host's (a Babylon bind with the texture's own wrap and anisotropy)",
      asFound: { sampler: a.sampler, isHosts: a.isHosts, log: a.log },
      unbound: { sampler: b.sampler, isHosts: b.isHosts, log: b.log },
      host: P.samplerDesc.get(host.sampler) ?? "undescribed",
      restored,
      steps: n,
      stepsDiffering: differ,
      firstDiff: first,
    };
  }, n);
}

for (let mi = 0; mi < maps.length; mi++) {
  const id = maps[mi];
  if (mi > 0) {
    await page.evaluate((i) => {
      const g = window.__celshock;
      g.enterMenu();
      g.setMap(i);
    }, MAP_IDS.indexOf(id));
    const from = await frameNow();
    const inst = await installRound(page);
    report.maps.push({ map: id, installMs: inst.installMs, installStates: await stateSummary(from) });
  } else {
    report.maps.push({ map: id, installMs: first.installMs });
  }
  const M = report.maps[mi];
  M.eye = await placeEye(id);
  await freeze(page, FREEZE_SET.filter((k) => k !== "gi" && k !== "reflections"));
  await page.evaluate(() => {
    window.__giProbe.gate = true;
  });
  M.samplersFresh = await samplers();
  M.statics = await statics();
  M.scenarios = {};
  const sw = await sweepOf();
  M.sweep = sw;
  // From a fresh history, one workgroup a step: every byte a function of the inputs.
  await fresh();
  M.scenarios.serial = await serial(96);
  // The game's own budget from a fresh history: the warm-up, a steady sweep.
  await fresh();
  M.scenarios.warm = await steps(2 * sw.warm + sw.steady + 8);
  const conv = await converge();
  const d = await drift(2 * sw.steady);
  M.scenarios.stable = { converge: conv, log: d.log };
  M.noise = d.noise;
  M.scenarios.lampHigh = await lamp(d.noise);
  M.scenarios.pulse = await pulse();
  // The tiers. The first `low` of a boot compiles its pipelines, so it is taken
  // once, unlogged, and its frames to a first dispatch kept as a measurement.
  if (mi === 0) {
    const t0 = await frameNow();
    await page.evaluate(async () => {
      const g = window.__celshock;
      const P = window.__giProbe;
      P.gate = false;
      g.gi.setQuality("low");
      for (let i = 0; i < 600; i++) {
        await P.nextFrame();
        if (P.records[P.records.length - 1].gi.length) break;
      }
      g.gi.setQuality("high");
      for (let i = 0; i < 600; i++) {
        await P.nextFrame();
        if (P.records[P.records.length - 1].gi.length) break;
      }
      P.gate = true;
    });
    report.firstDispatch.push({ what: "the first setQuality(low) of the boot, and back to high", records: await page.evaluate((t0) => window.__giProbe.records.filter((r) => r.f >= t0).map((r) => [r.f - t0, r.state, r.gi.length]), t0) });
  }
  const tiers = {};
  await page.evaluate(() => window.__celshock.gi.setQuality("low"));
  const swLow = await sweepOf();
  tiers.lowSweep = swLow;
  tiers.serialLow = await serial(64);
  await fresh();
  tiers.low = await steps(2 * swLow.warm + swLow.steady + 8);
  tiers.lowConverge = await converge();
  const dl = await drift(2 * swLow.steady);
  tiers.lowStable = dl.log;
  M.noiseLow = dl.noise;
  tiers.lampLow = await lamp(dl.noise);
  await page.evaluate(() => window.__celshock.gi.setQuality("off"));
  tiers.off = await steps(10, ["giIrr", "giDir", "giAux", "giVis0", "giVis1", "giVis2", "giVis3"]);
  await page.evaluate(() => window.__celshock.gi.setQuality("high"));
  tiers.high = await steps(2 * sw.warm + sw.steady + 8);
  M.scenarios.tiers = tiers;
  M.scenarios.samplerSerial = await samplerAB(256);
  // Back to a known state for the next map: the gate off, the freeze thawed.
  await page.evaluate(() => {
    window.__giProbe.gate = false;
  });
  await thaw(page);
  M.calls = await page.evaluate(() => window.__giProbe.calls.splice(0));
  console.log(`${id}: eye ${M.eye.map((v) => v.toFixed(2)).join(", ")}; sweep ${sw.steady} steady / ${sw.warm} warm (${sw.total} probes), low ${swLow.steady} / ${swLow.warm} (${swLow.total})`);
}


if (EDITOR) {
  const from = await frameNow();
  report.editor = await page.evaluate(async () => {
    const g = window.__celshock;
    const P = window.__giProbe;
    const out = {};
    g.enterMenu();
    for (let i = 0; i < 10; i++) await P.nextFrame();
    await g.toggleEditor();
    if (!g.editor) throw new Error("the editor did not open");
    for (let i = 0; i < 60; i++) await P.nextFrame();
    const cloud = g.mats.readLighting().cloudMap;
    const it = cloud.getInternalTexture();
    const giIt = g.gi.textures.giIrr.getInternalTexture();
    const trace = () => {
      const bg = P.bindGroups["gi-trace"];
      const s = bg?.raw?.find((x) => x.binding === 5)?.resource;
      return s ? P.samplerDesc.get(s) ?? "undescribed" : null;
    };
    out.built = {
      cloudInternal: { wrapU: it._cachedWrapU, wrapV: it._cachedWrapV, wrapR: it._cachedWrapR, anisotropy: it._cachedAnisotropicFilteringLevel },
      giIrrInternal: { wrapU: giIt._cachedWrapU, wrapV: giIt._cachedWrapV, wrapR: giIt._cachedWrapR, anisotropy: giIt._cachedAnisotropicFilteringLevel },
      traceSampler: trace(),
    };
    // A drag released: a placement moved through the editor's own handlers.
    const ed = g.editor;
    let moved = null;
    const layout = ed.deps.layout;
    for (let i = 0; i < layout.placements.length && !moved; i++) {
      ed.select({ list: "placements", index: i });
      if (ed.draggedConformingKind()) continue;
      const p = layout.placements[i];
      const terrain = g.map.terrain;
      const x0 = p.x;
      const rot = p.rotY ?? 0;
      const lift = p.y ?? 0;
      const at = (x) => ({ x, y: terrain.heightAt(x, p.z) + lift, z: p.z });
      ed.onDrag(at(x0 + 2), rot);
      ed.onDragEnd();
      for (let k = 0; k < 30; k++) await P.nextFrame();
      // …and back, so the round after the editor stands on the layout it shipped with.
      ed.onDrag(at(x0), rot);
      ed.onDragEnd();
      moved = { index: i, kind: p.kind };
    }
    out.drag = moved;
    for (let i = 0; i < 30; i++) await P.nextFrame();
    out.calls = P.calls.splice(0);
    await g.toggleEditor();
    for (let i = 0; i < 20000 && g.state !== "deploy"; i++) await P.nextFrame();
    for (let i = 0; i < 30; i++) await P.nextFrame();
    out.roundAfter = {
      cloudInternal: { wrapU: it._cachedWrapU, wrapV: it._cachedWrapV, wrapR: it._cachedWrapR, anisotropy: it._cachedAnisotropicFilteringLevel },
      traceSampler: trace(),
    };
    out.callsAfter = P.calls.splice(0);
    return out;
  });
  report.editor.states = await stateSummary(from);
  report.editor.samplersAfter = await samplers();
}

// Every door's first dispatch after it, read off the whole run's records.
{
  const { records, calls } = await page.evaluate(() => {
    const P = window.__giProbe;
    return { records: P.records.map((r) => [r.f, r.state, r.gi.some((x) => x[0] === "gi-trace") ? 1 : 0, r.editor ? 1 : 0]), calls: P.callsAll };
  });
  for (const c of calls) {
    if (c.call !== "setMap" && c.call !== "setQuality" && c.call !== "worldMoved") continue;
    if (c.arg === "off") {
      report.firstDispatch.push({ what: `setQuality(off) at frame ${c.frame} in ${c.state}`, frames: null, state: "none: nothing dispatches at off" });
      continue;
    }
    const r = records.find((x) => x[0] >= c.frame && x[2]);
    report.firstDispatch.push({ what: `${c.call}${c.arg ? `(${c.arg})` : ""} at frame ${c.frame} in ${c.state}`, frames: r ? r[0] - c.frame : null, state: r ? r[1] : null, editor: r ? r[3] : null });
  }
}

report.errors = { page: pageErrors.length, console: consoleErrors.length, first: [...pageErrors, ...consoleErrors].slice(0, 5) };

// --- print ---------------------------------------------------------------
const shortSampler = (s) => (s && typeof s === "object" ? `${s.addressModeU}/${s.addressModeV}/${s.addressModeW} ${s.magFilter}/${s.minFilter}/${s.mipmapFilter} lod ${s.lodMinClamp ?? "-"}..${s.lodMaxClamp ?? "-"} aniso ${s.maxAnisotropy ?? 1}` : String(s));
if (report.states) {
  console.log(`states (${maps[0]}, live):`);
  for (const [k, s] of Object.entries(report.states)) {
    console.log(
      `  ${k.padEnd(20)} ${String(s.frames).padStart(5)} frames, dispatched on ${s.dispatched}, of them with NO prepare of ours ${s.dispatchedNoPrepare} (no begin ${s.dispatchedNoBegin}); ` +
        `frames with no prepare ${s.noPrepare}; a dispatch ended a render pass on ${s.endedPass}; gi passes after a render pass began on their encoder ${s.renderPassBefore}; ` +
        `on render/upload/other ${s.onRender}/${s.onUpload}/${s.other}; R ${s.R.min}-${s.R.max} (${s.R.mean}), C ${s.C.min}-${s.C.max} (${s.C.mean}); trace bind groups made ${s.traceBinds}`,
    );
  }
}
for (const M of report.maps) {
  console.log(`${M.map}:`);
  if (M.installStates) for (const [k, s] of Object.entries(M.installStates)) console.log(`  install ${k}: ${s.frames} frames, dispatched ${s.dispatched}, no prepare ${s.dispatchedNoPrepare}, ended a pass ${s.endedPass}, gi passes on render/upload/other ${s.onRender}/${s.onUpload}/${s.other}`);
  const F = M.samplersFresh;
  console.log(`  cloud field: trace ${shortSampler(F.trace)}; host ${shortSampler(F.host)}; same object ${F.same}; internal ${JSON.stringify(F.internalCached)}; area ${F.cloudArea.map((v) => +v.toFixed(4)).join(", ")}`);
  const sc = M.scenarios.samplerSerial;
  console.log(`  sampler A/B (${sc.steps} serial steps from fresh): as found ${shortSampler(sc.asFound.sampler)} (host's: ${sc.asFound.isHosts}) vs forced to ${sc.forced}: ${shortSampler(sc.unbound.sampler)} (host's: ${sc.unbound.isHosts}); ${sc.stepsDiffering} steps differ${sc.firstDiff ? `, first at ${sc.firstDiff.step} in ${sc.firstDiff.resources.join(",")}` : ""}; restored ${shortSampler(sc.restored)}`);
  const changes = (L, keys) => Object.fromEntries(keys.map((k) => [k, L.filter((s, i) => i > 0 && s.read[k] !== L[i - 1].read[k]).length]));
  const RK = ["giIrr", "giIrr~", "giDir", "giDir~", "giAux", "giVis0", "giVis3", "state", "state~", "vis"];
  console.log(`  stable (converged in ${M.scenarios.stable.converge.steps} warm steps, then ${M.scenarios.stable.log.length} steady): steps changing each readback ${JSON.stringify(changes(M.scenarios.stable.log, RK))}; irradiance drift max ${M.noise.max.toExponential(3)} L1 ${M.noise.sum} over ${M.noise.moved} texels`);
  const ser = M.scenarios.serial;
  console.log(`  serial: ${ser.length} steps, dispatched ${[...new Set(ser.map((s) => JSON.stringify(s.dispatched)))].join(" | ")}`);
  for (const [k, L] of [["high", M.scenarios.lampHigh], ["low", M.scenarios.tiers.lampLow]]) {
    const r = L.result;
    console.log(`  lamp at ${k} (sweep ${r.sweep} frames): ${r.affected} of ${r.texels} texels over the drift (${r.noiseMax.toExponential(2)}); share of the eventual change in place after sweep ${JSON.stringify(r.shareOfChangeAfterSweep)}; texels within 10% ${JSON.stringify(r.texelsWithin10PercentAfterSweep)}; eventual L1 ${r.eventualL1} against the held world's drift L1 ${r.noiseL1}`);
  }
  const pl = M.scenarios.pulse;
  const vs = (k) => pl.flash.map((s, i) => (s.read[k] !== pl.control[i].read[k] ? 1 : 0)).join("");
  console.log(`  pulse (budget 0): fast lights per step ${pl.flash.map((s) => s.fast.length).join(" ")} (control ${[...new Set(pl.control.map((s) => s.fast.length))].join("/")}); against the control, per step: irr~ ${vs("giIrr~")} dir~ ${vs("giDir~")} aux ${vs("giAux")} vis0 ${vs("giVis0")} vis3 ${vs("giVis3")} state ${vs("state")} state~ ${vs("state~")}; control moved ${[...new Set(pl.control.map((s) => s.read["giIrr~"]))].length - 1}`);
  const w = M.scenarios.warm;
  console.log(`  warm: dispatched per step ${[...new Set(w.map((s) => JSON.stringify(s.dispatched)))].join(" | ")}; converged at step ${w.findIndex((s) => s.converged) + 1}`);
  console.log(`  tiers: low ${JSON.stringify(M.scenarios.tiers.lowSweep)}; low dispatches ${[...new Set(M.scenarios.tiers.low.map((s) => JSON.stringify(s.dispatched)))].join(" | ")}; off ${[...new Set(M.scenarios.tiers.off.map((s) => JSON.stringify(s.dispatched)))].join(" | ")} textures ${[...new Set(M.scenarios.tiers.off.map((s) => s.read.giIrr.split(":")[0]))].join("/")}`);
  for (const m of M.statics.wgsl) {
    console.log(`  wgsl ${m.name}@${m.frame} (${m.length} chars, ${m.tokens} tokens): ${m.tokensEqualTo ? `the source's tokens exactly (rays ${m.tokensEqualTo.rays}, fastRays ${m.tokensEqualTo.fastRays}), behind ${JSON.stringify(m.prefix)}` : `PARTS from every source: ${JSON.stringify(m.parts)}`}`);
  }
  console.log(`  pipelines: ${M.statics.pipelines.map((p) => `${p.name} ${p.call} layout ${p.layout} @${p.frame}`).join("; ")}`);
  for (const [n, t] of Object.entries(M.statics.textures)) console.log(`  ${n}: ${t ? `${t.gpu.width}x${t.gpu.height}x${t.gpu.depth} ${t.gpu.format} ${t.gpu.dimension} mips ${t.gpu.mipLevelCount} usage ${t.gpu.usage}; created ${JSON.stringify(t.created)}; host sampler ${shortSampler(t.hostSampler)}; host view is Babylon's ${t.hostViewIsBabylons}` : "none"}`);
  console.log(`  buffers: ${Object.entries(M.statics.buffers).map(([n, b]) => `${n} ${b ? `${b.size} B usage ${b.usage}` : "none"}`).join("; ")}`);
  for (const [n, es] of Object.entries(M.statics.bindGroups)) console.log(`  bind ${n}: ${es.map((e) => `${e.binding}:${e.kind}${e.kind === "buffer" ? `(${e.size ?? "whole"} of ${e.buffer?.size})` : e.kind === "view" ? `(${e.texture?.format} ${JSON.stringify(e.desc)})` : e.kind === "sampler" ? `(${shortSampler(e.desc)})` : ""}`).join(" ")}`);
  console.log(`  prepares ${M.statics.prepares}, late ${M.statics.late}; calls ${M.calls.map((c) => `${c.call}${c.arg ? `(${c.arg})` : ""}@${c.frame}:${c.state}`).join(" ")}`);
}
if (report.editor) {
  const E = report.editor;
  console.log("editor:");
  console.log(`  built: cloud internal ${JSON.stringify(E.built.cloudInternal)}; giIrr internal ${JSON.stringify(E.built.giIrrInternal)}; trace sampler ${shortSampler(E.built.traceSampler)}`);
  console.log(`  drag: ${JSON.stringify(E.drag)}; calls ${E.calls.map((c) => `${c.call}@${c.frame}:${c.state}`).join(" ")}`);
  console.log(`  the round after: cloud internal ${JSON.stringify(E.roundAfter.cloudInternal)}; trace sampler ${shortSampler(E.roundAfter.traceSampler)}; host ${shortSampler(E.samplersAfter.host)}; same object ${E.samplersAfter.same}`);
  for (const [k, s] of Object.entries(E.states)) console.log(`  ${k.padEnd(22)} ${s.frames} frames, dispatched ${s.dispatched}, NO prepare ${s.dispatchedNoPrepare}, ended a pass ${s.endedPass}, Babylon binds of gi-*/cloudShadow ${s.setTex} ${JSON.stringify(s.setTexNames ?? {})}`);
}
for (const f of report.firstDispatch) console.log(`first dispatch: ${f.what}: ${f.records ? JSON.stringify(f.records.slice(0, 12)) : `${f.frames} frames on, in ${f.state}${f.editor ? " (editor)" : ""}`}`);
console.log(`${report.errors.page} page errors, ${report.errors.console} console errors`);
for (const x of report.errors.first) console.log(`  ${String(x).slice(0, 300)}`);

const clean = enc(stripObjects(report));
if (OUT) writeFileSync(OUT, JSON.stringify(clean));
let failed = false;
if (AGAINST) failed = compareLogs(clean, JSON.parse(readFileSync(AGAINST, "utf8")));
await browser.close();
vite.stop();
process.exit(failed ? 1 : 0);

/** Drops what JSON cannot carry (a GPU object kept for an identity test). */
function stripObjects(x) {
  if (Array.isArray(x)) return x.map(stripObjects);
  if (x && typeof x === "object") {
    const o = {};
    for (const [k, v] of Object.entries(x)) if (k !== "samplerObject" && k !== "raw") o[k] = stripObjects(v);
    return o;
  }
  return x;
}

/**
 * Two logs, compared: the deterministic half only — each map's statics and
 * every scenario's steps — by `Object.is` on numbers and equality on strings
 * (the arrays' bytes and the readbacks' hashes are strings). The live half
 * (states, installs, first dispatches, the editor's frames) rides the
 * machine's timing and is printed, not compared. Returns true on a difference.
 */
function compareLogs(a, b) {
  let failed = false;
  const say = (m) => {
    console.log(`against: ${m}`);
    failed = true;
  };
  const walk = (x, y, path) => {
    if (typeof x !== typeof y) return `${path} is ${JSON.stringify(x)?.slice(0, 80)} here and ${JSON.stringify(y)?.slice(0, 80)} there`;
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
    return Object.is(x, y) ? null : `${path} is ${JSON.stringify(x)} here and ${JSON.stringify(y)} there`;
  };
  if (a.maps.length !== b.maps.length) say(`${a.maps.length} maps here and ${b.maps.length} there`);
  if (a.seed !== b.seed || a.shaftsOff !== b.shaftsOff) say(`logged under seed ${a.seed} and shafts off ${a.shaftsOff} here, ${b.seed} and ${b.shaftsOff} there`);
  for (let i = 0; i < Math.min(a.maps.length, b.maps.length); i++) {
    const before = failed;
    failed = false;
    const x = a.maps[i];
    const y = b.maps[i];
    if (x.map !== y.map) {
      say(`map ${i} is ${x.map} here and ${y.map} there`);
      continue;
    }
    const facts = (m) => ({
      eye: m.eye,
      sweep: m.sweep,
      samplersFresh: { ...m.samplersFresh, traceBoundOnFrame: undefined },
      wgsl: m.statics.wgsl.map((w) => ({ ...w, frame: undefined })),
      pipelines: m.statics.pipelines.map((p) => ({ ...p, frame: undefined })),
      textures: m.statics.textures,
      buffers: m.statics.buffers,
      bindGroups: m.statics.bindGroups,
      late: m.statics.late,
      prepares: m.statics.prepares,
    });
    const d = walk(JSON.parse(JSON.stringify(facts(x))), JSON.parse(JSON.stringify(facts(y))), `${x.map}.statics`);
    if (d) say(d);
    let compared = 0;
    const count = (v) => (Array.isArray(v) ? v.reduce((s, e) => s + count(e), 0) : v && typeof v === "object" ? Object.values(v).reduce((s, e) => s + count(e), 0) : 1);
    // The trace's RACED lanes (`name~`, the header) are a function of the
    // inputs only where no two probes share a dispatch — a `serial` scenario
    // from a fresh history — so everywhere else they are left out, and so is
    // a lamp's `result`, which is arithmetic on them.
    const comparable = (v, keep) => {
      if (Array.isArray(v)) return v.map((e) => comparable(e, keep));
      if (v && typeof v === "object") {
        const o = {};
        for (const [k, e] of Object.entries(v)) {
          if (!keep && k.endsWith("~")) continue;
          if (k === "result" && v.log) continue;
          o[k] = comparable(e, keep || /serial/i.test(k));
        }
        return o;
      }
      return v;
    };
    const X = comparable(x.scenarios, false);
    const Y = comparable(y.scenarios, false);
    for (const k of new Set([...Object.keys(X), ...Object.keys(Y)])) {
      const e = walk(X[k], Y[k], `${x.map}.${k}`);
      if (e) say(e);
      else compared += count(X[k]);
    }
    console.log(`against ${x.map}: ${failed ? "DIFFERS (above)" : `equal, ${compared} values over every scenario's steps`}`);
    failed = failed || before;
  }
  if (!failed) console.log("against: equal");
  return failed;
}
