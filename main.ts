/**
 * main.ts — Bootstrap. Creates the Game on #game-canvas after DOMContentLoaded,
 * and owns the boot screen `index.html` puts up before any of this ran.
 * All game wiring lives in src/core/Game.ts; nothing else belongs here.
 *
 * The one thing that is not the Game's is the service worker (src/pwa): it is
 * what the browser offers to install the page as an app from, and it must
 * survive a Game that never gets built on a machine without WebGPU — which is
 * why it is registered here, before the scene is built, rather than from
 * inside it.
 *
 * `base.css` is imported FIRST, and from here rather than from a UI module,
 * for both halves of the word: it carries the document reset every other sheet
 * assumes, and being first on the module graph is what puts it first in the
 * bundled stylesheet, so a screen's own rules can override a shared one at
 * equal specificity. Every other sheet is imported by the module that writes
 * the markup it styles.
 *
 * THE BOOT SCREEN IS THIS FILE'S, and it is the one piece of interface that is
 * not a `src/ui/` module, because it covers the stretch in which no module has
 * evaluated: the bundle is a couple of megabytes gzipped and the constructor
 * builds a scene and every pool in the game, which together is seconds of a
 * black page on a phone. It is markup in `index.html` (see the comment on the
 * `<style>` block there) and this is the only code that ever touches it —
 * told which of its awaits it is waiting on (`bootStage`), faded down after
 * the first rendered frame, or turned into the failure message on a machine
 * that cannot run the game at all. That message is the second half of the
 * same job: without it, "no WebGPU" and "still loading" are the same screen
 * forever. **It comes back ONCE after the boot**, failed with the boot's own
 * "No graphics device" plate: when the graphics device is lost a second time
 * inside a short window (`Game.deviceLost`, `core/deviceLoss.ts`,
 * `BABYLON_EXIT.md` X5.4i) — the first loss reloads the page, and this is
 * what stops a device that dies on every boot looping it (`deviceLostForGood`,
 * handed to `Game`).
 *
 * **There are TWO things the game cannot start without, and they are checked
 * here for the same reason.** The GPU is one; Havok is the other. The physics
 * WASM used to be fetched from inside the `Game` constructor and never awaited,
 * with a collapse tween and a scripted shard arc standing in until it landed —
 * two code paths for every falling thing, exercised only on machines nobody was
 * testing on. It is awaited here now, which costs the boot screen the length of
 * a ~2 MB precached download and buys the entire game the right to assume a
 * solver exists. A rejection is this file's failure message like any other.
 *
 * **The graphics device is the same shape, and that is what the second await
 * is.** An adapter and a device are both promises, so the device is asked for
 * HERE, the canvas's WebGPU context configured on it and the canvas's size
 * taken (`core/CanvasSurface.ts`), and the device and the surface INJECTED,
 * which keeps `Game`'s constructor synchronous and `window.__celshock`
 * non-null the moment it returns (`VERIFYING.md`) — the move `havok` made.
 * They are the GAME's since `BABYLON_EXIT.md` X5.4h, asked for and configured
 * exactly as Babylon's `WebGPUEngine.initAsync` asked for and configured its
 * own (the comment at the request says how); Babylon's engine is not
 * constructed, the scene standing on a `NullEngine` until X6.1
 * (`core/SceneEngine.ts`).
 *
 * **The page's own match host is the third** (`BABYLON_EXIT.md` X2.5c C4):
 * every round that is not a server's is a `Match` the page hosts, in a Worker
 * that has to load and answer before it can be handed one, so
 * `openMatchHost` is awaited here and injected too. A Worker that does not
 * come up does not fail the boot — it falls back to the match on a channel in
 * this thread, and the console line it leaves says which one is running and
 * why — so the one way it fails is that fallback's own module failing to
 * load, when there is no game to boot and the plate says so.
 */
import "./src/ui/base.css";
import { CanvasSurface } from "./src/core/CanvasSurface";
import { FrameClock } from "./src/core/FrameLoop";
import { Game } from "./src/core/Game";
import { loadHavok } from "./src/systems/PhysicsWorld";
import { openMatchHost, type MatchHost } from "./src/net/matchHost";
import { registerServiceWorker } from "./src/pwa/register";

registerServiceWorker();

/**
 * Why the game is not coming, when it is not coming. **The gate answers with a
 * REASON and not a boolean, because two machines that could not be less alike
 * fail it in the same place** — see `checkWebGPU` for which two.
 */
type GpuVerdict = "ok" | "insecure" | "unavailable";

/**
 * **On a laptop with two GPUs, this is what picks the fast one.**
 * `powerPreference` is a HINT and not a request — the browser may hand back
 * whatever it likes — but its default on a hybrid machine is the INTEGRATED
 * adapter, and this frame is draw-call bound on hardware nobody here owns
 * (`docs/rendering.md`, "Why the frame is draw-call bound"). The device's
 * request carries it (as Babylon's engine options did, which it forwarded to
 * `requestAdapter` whole until `BABYLON_EXIT.md` X5.4h); the two bare probes
 * carry it too, because **a probe that
 * asks a DIFFERENT adapter is answering about a GPU the game will not run
 * on** — the boot gate would clear a machine whose other adapter fails, and
 * the `?gpu` feature test would read `timestamp-query` off one device and
 * require it of another.
 *
 * **It is a `let` because the GATE resolves it, and that is the whole guard
 * against the hint costing somebody the game.** A machine with only
 * integrated graphics is NOT supposed to be able to fail this: the hint
 * narrows nothing, and the spec's adapter algorithm returns what the machine
 * has — only `forceFallbackAdapter`, which nothing here passes, can turn a
 * preference into a null. But that is a claim about every browser this ever
 * runs on, the cost of being wrong is a capable machine told it has no
 * WebGPU, and the cost of the guard is one extra `requestAdapter` on a boot
 * that has already failed one. So `checkWebGPU` drops the hint and asks again
 * before it refuses, and what it drops it drops for the REST OF THE BOOT —
 * the probe and the device's request read this variable, so the three cannot
 * end up asking for different adapters, which is the failure this comment
 * opened by describing.
 *
 * **What does NOT guard it is a retry around the device's request**, which is
 * the obvious shape and is worse: the request rejects for every other reason
 * too (no adapter at all, a device lost on creation, a driver that fell over),
 * so a retry pays a second request and puts the SECOND failure on the boot
 * screen for the cases that actually happen, and it would have to restate the
 * device's descriptor, which is how `?gpu` quietly stops measuring anything.
 *
 * What the hint costs is battery on an unplugged laptop, which is the trade a
 * shooter makes.
 */
let power: GPUPowerPreference | undefined = "high-performance";

/**
 * WebGPU or nothing — every draw in the game is our renderer's, on a WebGPU
 * device, and there is no WebGL fallback in the tree.
 *
 * **The throwaway-canvas probe this replaces is GONE, not edited.** WebGL2 had
 * to be asked for on a canvas, so the old gate created one, took a context off
 * it and dropped it immediately (a browser only allows so many live contexts).
 * `requestAdapter()` touches no canvas at all: it asks the browser for a GPU,
 * not for a drawing surface. If you come here looking for the probe canvas, it
 * has no counterpart.
 *
 * **The ORIGIN is checked first and on its own, and it is not a weaker version
 * of the adapter check below — it is a different question wearing the same
 * symptom.** `navigator.gpu` is a SECURE-CONTEXT-only property: it is
 * `undefined` over plain `http://` to anything but localhost, on a machine
 * whose GPU is perfectly capable, so a dev server reached at a LAN address or
 * at a VM hostname reads as "this browser has never heard of WebGPU". That is
 * the worst shape a failure can take here, because the player's next move is
 * to open one of the WebGPU test pages — every one of which is `https://`, and
 * all of which say yes. Two causes, two sentences.
 *
 * The second half stays the ADAPTER and not the namespace: `navigator.gpu` can
 * be present with nothing behind it, and a headless Chrome without
 * `--enable-unsafe-webgpu` is exactly that machine (`VERIFYING.md`). It and a
 * browser with no WebGPU at all share `"unavailable"` and one message, because
 * they share their advice; the insecure origin does not, which is the whole
 * reason it is split out.
 */
async function checkWebGPU(): Promise<GpuVerdict> {
  if (!window.isSecureContext) return "insecure";
  try {
    if (await navigator.gpu?.requestAdapter({ powerPreference: power })) {
      return "ok";
    }
    // Not expected to be reachable — see `power` — so the hint goes and does
    // not come back rather than being retried per site.
    power = undefined;
    return (await navigator.gpu?.requestAdapter()) ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Writes one of the boot screen's four ids, if the screen is still up. */
function bootText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * Names the step the boot screen's load plate is waiting on. A NAME and never
 * a figure: each step is one await or one synchronous block, and nothing in
 * any of them reports how far through it is (the bar's own argument, in
 * `index.html`).
 */
function bootStage(stage: string): void {
  bootText("boot-stage", stage);
}

/**
 * Leaves the boot screen up and says why the game is not coming: the load
 * plate names the CAUSE in a few words and the note beside it carries the
 * sentence, which is the part a player can act on.
 */
function bootFailed(cause: string, message: string): void {
  const boot = document.getElementById("boot");
  if (!boot) return;
  boot.classList.add("failed");
  bootText("boot-word", "Cannot start");
  bootStage(cause);
  bootText("boot-cap", "Why");
  bootText("boot-msg", message);
}

/**
 * The third failure: the adapter said yes and no graphics device could be had
 * — at the boot (the device's request), or, put back up by `Game`, a device
 * lost a second time inside `CONFIG.graphics.deviceLossWindow`
 * (`BABYLON_EXIT.md` X5.4i, `core/deviceLoss.ts`), which the page answers with
 * this plate rather than another reload. One text, so the two read alike.
 */
function deviceFailed(): void {
  bootFailed(
    "No graphics device",
    "This browser has WebGPU but could not start a graphics device, so the " +
      "game cannot run. Check that hardware acceleration is switched on and " +
      "that the graphics driver is up to date.",
  );
}

/**
 * The boot screen, held from the boot on: `bootDone` takes it out of the
 * document, and a device lost for good (`deviceLostForGood`) puts it back.
 */
let bootScreen: HTMLElement | null = null;

/**
 * `deviceFailed` over a page that has booted (`Game`'s second answer to a lost
 * device): the boot screen put back as it was taken off — in the document,
 * its fade undone — and then failed as the boot fails it.
 */
function deviceLostForGood(): void {
  const boot = bootScreen;
  if (boot) {
    boot.classList.remove("done");
    if (!boot.isConnected) document.body.appendChild(boot);
  }
  deviceFailed();
}

/**
 * Resolves once the page has PAINTED what was written before it. A rAF
 * callback runs before the frame it belongs to is drawn, so the timeout after
 * it is what lands on the far side of that paint. The constructor is one
 * synchronous block of seconds on a phone, and a stage name written just
 * before it would otherwise never reach the glass.
 */
function painted(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );
}

/**
 * Takes the boot screen down, after a frame has actually been drawn.
 *
 * NOT when the constructor returns: it ends by starting the frame loop, so
 * at that moment the canvas is still the empty black rectangle it was created
 * as, and removing the cover there trades a boot screen for a black flash.
 * Two frames of grace — the loop queues its first frame from inside the
 * constructor (`core/FrameLoop.ts`), so it is already ahead of the first
 * callback below, and the second is there so this never rests on that
 * ordering.
 *
 * Then a FADE rather than a cut (`#boot.done`, which also stops it taking the
 * pointer at once), so the menu's own entrance is what the eye lands on. The
 * removal is on a timer rather than `transitionend`, which never fires under
 * `prefers-reduced-motion` where the transition is switched off.
 */
function bootDone(): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const boot = document.getElementById("boot");
      // Never over a failure: a device lost for good before these two frames
      // (`deviceLostForGood`) has put the plate up, and it stays up.
      if (!boot || boot.classList.contains("failed")) return;
      boot.classList.add("done");
      // …nor if it failed inside the fade, which `deviceLostForGood` undid.
      setTimeout(() => {
        if (!boot.classList.contains("failed")) boot.remove();
      }, 350);
    }),
  );
}

window.addEventListener("DOMContentLoaded", async () => {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  bootScreen = document.getElementById("boot");
  /** The game, once built: what the device's error listener reads its frame off. */
  let game: Game | null = null;
  // FIRST, and before the physics download: a machine with no WebGPU should
  // not spend 2 MB to be told no. It is also the cheapest of the three checks
  // — no canvas, no file, one round trip to the browser's own GPU service.
  bootStage("Finding a GPU");
  const verdict = await checkWebGPU();
  if (verdict !== "ok") {
    bootFailed(
      verdict === "insecure" ? "Not a secure origin" : "No WebGPU",
      verdict === "insecure"
        ? "This page is not on a secure origin, so the browser will not offer " +
            "WebGPU to it — and the game needs WebGPU. The machine is probably " +
            "fine. Load the page over HTTPS, or as http://localhost; a LAN " +
            "address or any other hostname over plain http will not do, " +
            "however capable the graphics are."
        : "This game needs WebGPU, and this browser does not have it. " +
            "Try a current Chrome or Edge, Safari 18 or later, or Firefox on " +
            "Windows — and if you are on a desktop, check that hardware " +
            "acceleration is switched on.",
    );
    return;
  }
  // The physics engine, and the one thing the boot screen genuinely waits on.
  // Its own failure message rather than the constructor's: a 404 or a bad MIME
  // type on the WASM is a deployment fault with a known shape (see the
  // `optimizeDeps.exclude` note in CLAUDE.md), and telling the player to reload
  // would be advice that cannot work.
  let havok;
  bootStage("Physics engine");
  try {
    havok = await loadHavok();
  } catch (err) {
    bootFailed(
      "No physics engine",
      "The physics engine could not be loaded, so the game cannot start. " +
        "Check the connection and reload; if it keeps happening, the build is " +
        "missing a file.",
    );
    throw err;
  }
  // **A THIRD failure branch, and it is new in kind**: the adapter above said
  // yes and the device request still failed. That is a driver the browser has
  // blocklisted, a GPU already out of memory, or a device lost between the two
  // calls — none of which the gate can see, and none of which a reload fixes
  // any more reliably than the physics 404 does. It gets its own message for
  // the same reason the Havok one has one: the generic catch below says
  // "reloading may fix it", which here is advice that mostly cannot work.
  //
  // **THE DEVICE AND THE CANVAS ARE THE GAME'S** (`BABYLON_EXIT.md` X5.4h):
  // asked for and configured below EXACTLY as Babylon's `WebGPUEngine.initAsync`
  // asked for and configured its own (Babylon 9.28, `webgpuEngine.pure.js`
  // 412-553 and 785-790), because a shader moves if they are not — the glow
  // blur's text is built at the device's `maxInterStageShaderVariables`
  // (`render/GlowBlur.ts`). So: the adapter with this boot's `powerPreference`
  // (all of Babylon's engine options that WebGPU reads); a device asked for NO
  // limits and no feature but `timestamp-query`, and that one only under
  // `?gpu` and only where the adapter has it (Babylon filtered its required
  // features against the adapter's); the context configured with the
  // preferred canvas format, `RENDER_ATTACHMENT | COPY_SRC` and premultiplied
  // alpha. Only the device's LABEL is ours. Babylon's engine is not
  // constructed: the scene stands on a `NullEngine` until X6.1
  // (`core/SceneEngine.ts`, row "X5.4, Babylon's engine").
  //
  // **No MSAA, and that is a saving rather than a downgrade.** The canvas's
  // texture is written by one full-screen quad a frame (the post chain's last
  // stage, `render/ChainPasses.ts`), so a multisampled one would antialias the
  // edges of one quad, of which there are none, for a resolve every frame and
  // ~30 MB at 720p. FXAA does the antialiasing. Nor a stencil: nothing uses
  // one, and the canvas pass's depth is a `depth32float` (`ChainPasses`), as
  // Babylon's engine made its own with `stencil: false`.
  //
  // The scaling level is 1 until `Game.applyRenderScale` sets it from the
  // first `applySettings` (`core/CanvasSurface.ts`): the resolution is a
  // player setting, and Babylon's `adaptToDeviceRatio` was never passed.
  //
  // **`?gpu` is the one thing about this device that a SETTING could never
  // turn on**, which is why it is a boot flag and not a row in the settings
  // screen. Every phase the frame profiler records is CPU: they time the
  // RECORDING of the frame's commands into its one encoder
  // (`render/FrameSubmit.ts`), and `queue.submit` queues rather than blocks,
  // so a GPU that is behind is invisible to all of them — which is exactly
  // where `FINDINGS.md` §1 ended up after everything on the CPU side had been
  // eliminated. Our timestamp queries read it (`render/FrameTimer.ts`'s
  // `gpu.frame`, `render/PassTimer.ts`'s `gpu.cull`; Babylon's
  // `gpuTimeInFrameForMainPass` until `BABYLON_EXIT.md` X5.4g), but only if
  // `timestamp-query` is a REQUIRED FEATURE of the device, and a device's
  // features are fixed when it is created. So this costs a reload, and it is
  // off for everybody who has not asked.
  //
  // **The adapter is asked FIRST, because a required feature it does not have
  // makes `requestDevice` REJECT** — and that would turn a diagnostic flag
  // into a boot failure on exactly the machines least able to spare one. When
  // the adapter says no the game boots normally and the capture says
  // `gpu.requested` with `gpu.available` false, which is the honest answer
  // rather than a silent zero.
  const wantGpuTiming = new URLSearchParams(location.search).has("gpu");
  let gpuTimingOk = false;
  if (wantGpuTiming) {
    try {
      const probe = await navigator.gpu?.requestAdapter({
        powerPreference: power,
      });
      gpuTimingOk = !!probe?.features.has("timestamp-query");
    } catch {
      gpuTimingOk = false;
    }
  }

  let device: GPUDevice;
  let surface: CanvasSurface;
  // THE FRAME'S CLOCK (`core/FrameLoop.ts`'s `FrameClock`, `BABYLON_EXIT.md`
  // X5.4g): Babylon's `getDeltaTime` and `getFps` ported, sampled where the
  // engine's performance monitor was — at every frame of our loop, and at
  // every `beginFrame` Babylon's engine ran of its own, which since X5.4g was
  // the one inside `_initializeMainAttachments`: once as `initAsync` ended,
  // whatever the size, and again at every size that took. Since X5.4h those
  // points are ours: the sample right after the context is configured, and
  // the surface's `onSized` (`core/CanvasSurface.ts`) — so the first frame
  // reads the gap Babylon's did, sample for sample.
  const clock = new FrameClock();
  bootStage("Graphics device");
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: power });
    if (!adapter) {
      throw new Error("Could not retrieve a WebGPU adapter (adapter is null or undefined).");
    }
    const descriptor: GPUDeviceDescriptor = {};
    if (gpuTimingOk) {
      descriptor.requiredFeatures = (["timestamp-query"] as const).filter((f) => adapter.features.has(f));
    }
    descriptor.label = "GreywatchDevice";
    device = await adapter.requestDevice(descriptor);
    // Babylon's first device listener, as `initAsync` added it: the first
    // twenty uncaptured errors said on the console with the frame they came
    // in (Dawn's own report of each is the browser's). Its second, the LOST
    // device, is `Game`'s (`Game.deviceLost`, `BABYLON_EXIT.md` X5.4i): the
    // page reloads to the menu, so this listener needs nothing on a loss —
    // the document goes with it.
    let uncaptured = -1;
    device.addEventListener("uncapturederror", (event) => {
      const error = (event as GPUUncapturedErrorEvent).error;
      const frame = game?.frameLoop.frameId ?? 0;
      if (++uncaptured < 20) {
        console.warn(`[Frame ${frame}] WebGPU uncaptured error (${uncaptured + 1}): ${error} - ${error.message}`);
      } else if (uncaptured++ === 20) {
        console.warn(
          `[Frame ${frame}] WebGPU uncaptured error: too many warnings (20), no more warnings will be reported to the console for this device.`,
        );
      }
    });
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("The canvas has no WebGPU context.");
    const format = navigator.gpu.getPreferredCanvasFormat();
    // `_configureContext`: RENDER_ATTACHMENT | COPY_SRC, premultiplied (the
    // engine's `premultipliedAlpha`, true by default).
    context.configure({ device, format, usage: 16 | 1, alphaMode: "premultiplied" });
    surface = new CanvasSurface(canvas, context, format);
    // `initAsync`'s `_initializeMainAttachments`, then its `resize()`: the
    // first sample whatever the size, then one more for every size that takes
    // from here on, the boot's first `resize` among them.
    clock.sample();
    surface.onSized(() => clock.sample());
    surface.resize();
  } catch (err) {
    deviceFailed();
    throw err;
  }
  // **Where the page's own match runs** (`BABYLON_EXIT.md` X2.5c C4): in a
  // Worker, or on a channel in this thread under `?simpage` and whenever the
  // Worker cannot be had — chosen here, awaited (a Worker's module has to load
  // and answer) and INJECTED like the device, so the constructor stays
  // synchronous. A Worker that will not come up never fails the boot — the
  // page hosts the match instead, and the console says which and why — but
  // the in-page host is a module fetched on demand (`server/localMatch.ts`,
  // through `matchHost.ts`'s one dynamic import), and the fetch that failed
  // the Worker can fail it too: then there is no game
  // to boot, and the plate says so rather than hanging on this stage.
  bootStage("Starting the simulation");
  const query = new URLSearchParams(location.search);
  let local: MatchHost;
  try {
    local = await openMatchHost({ simpage: query.has("simpage") });
  } catch (err) {
    bootFailed(
      "Could not start",
      "The game's simulation could not be loaded. Check the connection and reload.",
    );
    throw err;
  }
  console.info(
    `[sim] the simulation runs in ${local.mode === "worker" ? "a Worker" : "the page"}: ${local.why}`,
  );
  // The constructor is the longest step on a phone and a single synchronous
  // block, so its name has to be PAINTED before it starts or it is never seen:
  // the plate would say "graphics device" through seconds of building a world.
  bootStage("Building the world");
  await painted();
  try {
    game = new Game(canvas, havok, device, surface, local, clock, deviceLostForGood);
  } catch (err) {
    // Re-thrown: the message is for the player, the console is for whoever
    // has to work out which of a hundred systems failed to construct.
    bootFailed(
      "Start-up failed",
      "Something went wrong starting the game. Reloading may fix it.",
    );
    throw err;
  }
  bootDone();
});
