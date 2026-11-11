/**
 * CanvasSurface.ts — THE CANVAS as the game's (`BABYLON_EXIT.md` X5.4h): what
 * Babylon's `WebGPUEngine` held for it until then — the WebGPU context the
 * boot configured on the canvas, the backing store's size, and the scaling
 * level that size is read through — PORTED as Babylon 9.28 wrote it, plus what
 * Babylon's engine and its scene's input manager did to the canvas ELEMENT.
 * Owns: `CanvasSurface` — the canvas, its `GPUCanvasContext` and its format
 * (configured by `main.ts`, as `_initializeContextAndSwapChain` configured
 * Babylon's), the scaling level (`setHardwareScalingLevel`, which
 * `Game.applyRenderScale` sets: the render-scale setting's setter), the backing
 * store's size (`resize`, `setSize`) and every answer about it the game asks
 * (`getRenderWidth`, `getRenderHeight`, `getHardwareScalingLevel`,
 * `getAspectRatio`); the points where a size took (`onSized`); and the
 * canvas element's input defaults (`adoptInput`).
 * Invariants:
 * - **`resize` and `setSize` are `AbstractEngine.resize` and `setSize` as
 *   written** (`abstractEngine.pure.js` 1203-1262): the CSS size read off
 *   `clientWidth`/`clientHeight`, else the bounding rect, else the backing
 *   store times the level, else 100 — the bounding rect read FIRST, as Babylon
 *   read it — divided by the level, truncated by `| 0`, and written to the
 *   canvas only when it moved (or `forceSetSize`). The level is 1 until set
 *   (`adaptToDeviceRatio` was never passed, so Babylon's level was 1 and its
 *   device-ratio branch never ran: it is not ported).
 * - **The render size is the canvas's backing store** — what
 *   `WebGPUEngine.getRenderWidth`/`getRenderHeight` answered with no render
 *   target of Babylon's bound, which no frame has had since X5.4f — and the
 *   aspect ratio is `AbstractEngine.getAspectRatio`'s arithmetic over it
 *   (`abstractEngine.dom.pure.js` 28).
 * - **`onSized` is told where `WebGPUEngine.setSize` ran
 *   `_initializeMainAttachments`**: after the canvas took a new size, on every
 *   size that moved and on nothing else. That is where Babylon's performance
 *   monitor took a sample (the `beginFrame` inside it), so the boot hangs the
 *   frame's clock there (`main.ts`, `FrameClock`) and the clock reads Babylon's
 *   samples, sample for sample. What else Babylon did there — flushed its two
 *   encoders, re-made its own main depth and cleared it in a pass on the swap
 *   chain's texture, submitted — went with the engine: the canvas pass's depth
 *   is `ChainPasses`' (X5.4f), and nothing of the game's was on Babylon's
 *   encoders since X5.4g. What `AbstractEngine.setSize` did beside it reached
 *   nothing: it zeroed each camera's `_currentRenderId` (which a `Camera` only
 *   writes) and raised `onResizeObservable` (no observer).
 * - **`adoptInput` is what Babylon's scene input manager did to the canvas**
 *   (`Inputs/scene.inputManager.js`, `DeviceInput/webDeviceInputSystem.js`),
 *   the part the page could feel: the tab index set to 1 where it was -1, a
 *   `pointerdown` and a `pointerup` on the canvas DEFAULT-PREVENTED and the
 *   canvas focused (`preventDefaultOnPointerDown`/`Up`, both on by default: the
 *   first is what keeps the browser's compatibility `mousedown`/`mouseup` off a
 *   press on the canvas, which `InputManager`'s `mouseMask` never saw), and the
 *   pointer CAPTURED by the canvas on a press made without a pointer lock,
 *   released on its `pointerup` or `pointercancel`. **And the release Babylon
 *   SYNTHESIZED** (`DeviceEventFactory`) where a press on the canvas ended
 *   without one — the canvas's `blur` with a press held, a `pointercancel`, a
 *   pen's `pointerleave`, and on macOS Chromium a `lostpointercapture` with
 *   `buttons > 1` (`webDeviceInputSystem.js` 547-625, 664-680): the capture
 *   released, and that release taken through `InputManager._onPointerUp` as a
 *   real one is — the canvas focused (its `preventDefault` a no-op on a made
 *   event) — if the scene had heard the press. Both of Babylon's layers are
 *   kept, because they can disagree: the DEVICE's (`held`: a press it recorded
 *   and no release ended, by pointer, mouse or touch, a pen being a touch) and
 *   the SCENE's (`active`, `_activePointerIds` as written, -1 a free slot); a
 *   mouse's made release carries pointer id 1 (`_CreatePointerEvent`), the
 *   mouse's own on Chromium, so on Firefox (its mouse 0) it focuses nothing
 *   and leaves the scene's slot stale, as Babylon did. Not kept: a CHORD's
 *   buttons (a second button pressed or let go under the first reached the
 *   scene as a `pointermove`, which only focused a canvas the first press had
 *   focused), the touch limit (`_maxTouchPoints`, more touches than a hand
 *   has), and a touch of pointer id 0 left uncaptured (no browser numbers a
 *   touch 0). Its picking, its cursor
 *   (the scene's default, the empty string, written over an empty string) and
 *   its device bookkeeping reached nothing of the game's and are not kept; its
 *   context menu is refused by `InputManager` at the document, and the
 *   engine's own listeners (focus, blur, the pointer leaving, the window's
 *   blur, focus and resize) fed observables nothing observed. The constructor
 *   does what the engine's did to the element: `touch-action: none` as an
 *   attribute and inline, and no tap highlight (`DisableTouchAction`).
 * Never: draws, records or submits (the frame does, `render/ChainPasses.ts`
 * taking the context's texture once a frame); reads the device's pixel ratio
 * (the level is `Game.applyRenderScale`'s, which reads it); allocates on a
 * frame.
 * Contract: `docs/rendering.md` ("Our renderer's frame"), `docs/pwa.md` (the
 * canvas a phone resizes).
 */

/** What `getAspectRatio` reads off a camera: its viewport, as fractions of the canvas. */
export interface ViewportOwner {
  readonly viewport: { readonly width: number; readonly height: number };
}

export class CanvasSurface {
  /** `_hardwareScalingLevel`: 1 until set, as Babylon's was without `adaptToDeviceRatio`. */
  private level = 1;
  /** Told after a size took (`setSize`), where `_initializeMainAttachments` ran. */
  private readonly sized: (() => void)[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    /** The context the boot configured on `canvas` (`main.ts`): a canvas has one `webgpu` context. */
    readonly context: GPUCanvasContext,
    /** The format it was configured with: the preferred canvas format. */
    readonly format: GPUTextureFormat,
  ) {
    // `DisableTouchAction`, as Babylon's engine ran it on the canvas it was
    // built on (`engine.common.js`): the attribute and the two inline styles.
    // `base.css` states the same on the canvas and the page; this keeps the
    // element as the engine left it.
    canvas.setAttribute("touch-action", "none");
    canvas.style.touchAction = "none";
    (canvas.style as CSSStyleDeclaration & { webkitTapHighlightColor: string }).webkitTapHighlightColor = "transparent";
  }

  /**
   * Calls `fn` after every size that took (`setSize`), where Babylon's
   * `setSize` ran `_initializeMainAttachments` — the boot's clock sample.
   */
  onSized(fn: () => void): void {
    this.sized.push(fn);
  }

  /** `AbstractEngine.setHardwareScalingLevel`: the level, then a resize. */
  setHardwareScalingLevel(level: number): void {
    this.level = level;
    this.resize();
  }

  /** `getHardwareScalingLevel`: backing-store pixels are CSS pixels over this. */
  getHardwareScalingLevel(): number {
    return this.level;
  }

  /** `AbstractEngine.resize`, the page's branch (the header). */
  resize(forceSetSize = false): void {
    const canvas = this.canvas;
    const boundingRect = canvas.getBoundingClientRect?.();
    const width = canvas.clientWidth || boundingRect?.width || canvas.width * this.level || 100;
    const height = canvas.clientHeight || boundingRect?.height || canvas.height * this.level || 100;
    this.setSize(width / this.level, height / this.level, forceSetSize);
  }

  /**
   * `AbstractEngine.setSize` and `WebGPUEngine.setSize`: the size truncated,
   * written only when it moved, and `onSized` told (the header). True when it
   * moved.
   */
  setSize(width: number, height: number, forceSetSize = false): boolean {
    const canvas = this.canvas;
    width = width | 0;
    height = height | 0;
    if (!forceSetSize && canvas.width === width && canvas.height === height) {
      return false;
    }
    canvas.width = width;
    canvas.height = height;
    for (const fn of this.sized) fn();
    return true;
  }

  /** The backing store's width: `getRenderWidth`, either way it was asked. */
  getRenderWidth(_useScreen = false): number {
    return this.canvas.width ?? 0;
  }

  /** The backing store's height: `getRenderHeight`, either way it was asked. */
  getRenderHeight(_useScreen = false): number {
    return this.canvas.height ?? 0;
  }

  /** `AbstractEngine.getAspectRatio`: the render size over `owner`'s viewport. */
  getAspectRatio(owner: ViewportOwner, useScreen = false): number {
    const viewport = owner.viewport;
    return (this.getRenderWidth(useScreen) * viewport.width) / (this.getRenderHeight(useScreen) * viewport.height);
  }

  /**
   * The canvas element's input defaults, as Babylon's scene input manager set
   * them (the header). Once, where the scene attached its input — the `Scene`'s
   * construction (`Game`).
   */
  adoptInput(): void {
    const canvas = this.canvas;
    // `WebDeviceInputSystem._enableEvents`: the engine's `canvasTabIndex`, 1.
    if (canvas.tabIndex === -1) canvas.tabIndex = 1;
    // The DEVICE's layer (`WebDeviceInputSystem`'s `_inputs` and
    // `_activeTouchIds`): each pointer a press on the canvas began and no
    // release has ended, and its kind (`_getPointerType`: a pen is a touch).
    const held = new Map<number, "mouse" | "touch">();
    // The SCENE's (`InputManager._activePointerIds`, -1 a free slot): the id
    // each press it heard carried. A release is the scene's only after its
    // press was.
    const active: number[] = [];
    // `InputManager._onPointerUp`: the slot freed, then — on a real release —
    // the event default-prevented, and the canvas focused.
    const sceneUp = (pointerId: number, evt: PointerEvent | null): void => {
      const slot = active.indexOf(pointerId);
      if (slot === -1) return;
      active[slot] = -1;
      evt?.preventDefault();
      canvas.focus();
    };
    // The release Babylon MADE for a press that ended without one (the
    // header): the capture released, then — if the device held the press —
    // the made `pointerup` taken by the scene, a mouse's carrying pointer id
    // 1 (`DeviceEventFactory._CreatePointerEvent`), a touch's its own.
    const letGo = (pointerId: number): void => {
      if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
      const kind = held.get(pointerId);
      if (kind === undefined) return;
      held.delete(pointerId);
      sceneUp(kind === "mouse" ? 1 : pointerId, null);
    };
    canvas.addEventListener("pointerdown", (evt) => {
      // `_pointerDownEvent`: the canvas captures the pointer unless it is locked.
      if (!document.pointerLockElement) {
        try {
          canvas.setPointerCapture(evt.pointerId);
        } catch {
          // DO NOTHING, as Babylon did.
        }
      }
      held.set(evt.pointerId, evt.pointerType === "touch" || evt.pointerType === "pen" ? "touch" : "mouse");
      // `InputManager._onPointerDown`.
      const free = active.indexOf(-1);
      if (free === -1) active.push(evt.pointerId);
      else active[free] = evt.pointerId;
      evt.preventDefault();
      canvas.focus();
    });
    canvas.addEventListener("pointerup", (evt) => {
      if (canvas.hasPointerCapture?.(evt.pointerId)) canvas.releasePointerCapture(evt.pointerId);
      // `_pointerUpEvent`: a release the device holds no press for is dropped.
      if (!held.delete(evt.pointerId)) return;
      sceneUp(evt.pointerId, evt);
    });
    // `_pointerCancelEvent` (a mouse's, and `_pointerCancelTouch`).
    canvas.addEventListener("pointercancel", (evt) => letGo(evt.pointerId));
    // `_pointerLeaveEvent`: a pen leaving the range the hardware can see.
    canvas.addEventListener("pointerleave", (evt) => {
      if (evt.pointerType === "pen") letGo(evt.pointerId);
    });
    // `_pointerBlurEvent`: every press held when the canvas loses focus.
    canvas.addEventListener("blur", () => {
      for (const pointerId of [...held.keys()]) letGo(pointerId);
    });
    // `_pointerMacOsChromeOutEvent`, Babylon's workaround for a capture
    // Chromium on macOS loses: tested as Babylon tested it, once.
    if (/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform) && navigator.userAgent.indexOf("Chrome") !== -1) {
      canvas.addEventListener("lostpointercapture", (evt) => {
        if (evt.buttons > 1) letGo(evt.pointerId);
      });
    }
  }
}
