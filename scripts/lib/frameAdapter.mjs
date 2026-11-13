/**
 * frameAdapter.mjs — the ONE frame adapter every browser-driven script asks
 * its questions about the page's frame through (`window.__refFrame()`): the
 * reference harness's probes (`plans/webgpu-ref/`, whose `harness.mjs`
 * re-exports both exports here), the permanent npm scripts that drive a page
 * (`npm run parity`, `npm run shots`, `npm run merge:hash`) and the skills'
 * scripts. It lives here rather than in the harness so that nothing permanent
 * imports from `plans/` (`BABYLON_EXIT.md` X6.1a's review, the owner's
 * decision of 2026-11-12).
 *
 * Owns: `frameAdapter`, the page-side function (installed as an init script,
 * or `page.evaluate`d; idempotent), and `installFrameAdapter(page)`, the one
 * door a Node script installs it through — which also carries `REF_NO_SCENE=1`
 * (the environment) into the page as `window.__refNoScene = true`, so EVERY
 * script that installs it honours it alike (X6.1a's review: `bootMap` alone
 * did).
 *
 * Invariants:
 * - `frameAdapter` is SERIALISED into the page (`addInitScript` and `evaluate`
 *   take its source), so it closes over nothing of this module's: every name
 *   it reads is the page's.
 * - It reads the game only when a question is asked, so installing it ahead
 *   of the game's first script changes nothing the game does.
 * - An arm answers what the read it replaced answered, at the same point of a
 *   frame, proven at a parent on the same frames before any probe leans on it
 *   (the header below says which arm proves what, and what is UNPROVEN).
 *
 * Must never: write to the game (it reads; `particles(on)`, `constantDelta(on)`
 * and `scheduleDelta` are the probes' own switches, asked for by name);
 * re-derive in the page an answer the GAME computes (a value restated here
 * proves nothing about the game's own arithmetic, and would pass a wrong port
 * of it — X6.1a's review, the frustum planes); import anything.
 */

/**
 * **The FRAME, reached through ONE adapter** (`window.__refFrame()`,
 * `BABYLON_EXIT.md` X5.4a; `postAdapter`'s precedent): every question a script
 * here asks about the page's frame — rather than about what the frame drew —
 * answered off whichever host the page has, so a sub-step of X5.4 that takes
 * one of them from Babylon adds OUR arm here, picked first, and no probe has to
 * be taught. The questions:
 *
 * - `drawn()`: a promise of the next frame's DRAW having happened (the scene's
 *   render returned), and `onDrawn(fn)` for every one until the remover it
 *   hands back is called;
 * - `beforeDraw(fn)`: `fn` once, in the next frame, before its draw (the
 *   scene's before-render: AFTER the frame's camera updates — the game's in
 *   `Game.tick` and Babylon's `activeCamera.update()`, which `_renderFrame`
 *   calls just before raising it, `scene.pure.js` 4522-4545 — and BEFORE the
 *   frame's render targets, its view and projection and the scene's transform
 *   matrix, which `_renderForCamera` computes later off the pose as it stands,
 *   so a pose written here is the one the frame is drawn from), and
 *   `onBeforeDraw(fn)` in every one until the remover it hands back is called;
 * - `submitted()`: a promise of the next frame's work having been SUBMITTED
 *   (the engine's end of frame; our loop's since X5.4g), `onSubmitted(fn)`
 *   for every one, and `onBegin(fn)` for the opening of every frame (the
 *   engine's begin; our loop's);
 * - `index()`: the frame's index (the scene's frame id), `ready()` whether
 *   the scene's every draw can be made this frame (`scene.isReady()`; the post
 *   chain's stages that are ours are `postAdapter`'s `ready`, asked beside it);
 * - `device()`, `canvas()` and `canvasDepth()`: the `GPUDevice` every draw is
 *   made on, the canvas and the canvas pass's depth texture;
 * - `encoderRole(encoder)`: which of the frame's command encoders that is
 *   (`"render"`, `"upload"` — Babylon's two — `"frame"`, our loop's one since
 *   X5.4g, `"other"`);
 * - `onDrawPhase(begin, end, endFirst)`: `begin` as the frame camera's draw
 *   phase opens and `end` as it closes, every frame, until the remover it
 *   hands back is called — `end` inserted FIRST at the close with `endFirst`
 *   (ahead of our renderer's main pass, as `surfaces.mjs` and `census.mjs`
 *   insert theirs), else last; either may be null;
 * - `scheduleDelta(fn)`: the frame's DELTA (the milliseconds the scene's own
 *   step reads, `getDeltaTime` — the engine's, our loop's clock's since X5.4g,
 *   which the frame's animation ratio reads) answered from now on by `fn(k)`,
 *   `k` the frames since the call (`particles.mjs`' schedule), and
 *   `scheduleDelta(null)` handing it back to the frame's own clock;
 * - `host()`: what owns the frame, for a report (the engine's class, and
 *   whose frame: `babylon`'s render or `ours`).
 *
 * **Babylon's arm alone at X5.4a**, and it answers exactly what the reads it
 * replaced answered (the same observable, the same add-and-remove, the same
 * field), so moving a probe onto it moved nothing. Installed on every page
 * `bootMap` opens (an init script, ahead of a caller's own: it reads the game
 * only when asked) and by the first call that needs it on any other;
 * idempotent. `window.__refFrame()` is asked FRESH at every use, as
 * `__refPost()` is, so an arm a sub-step adds can depend on the moment.
 *
 * **OUR arm since X5.4f, picked first** (`Game.sceneFrame`,
 * `src/core/SceneFrame.ts`): the scene is never rendered, so the questions a
 * scene's render answered are answered off our frame's points, each named for
 * the scene observable it replaces and raised where Babylon raised that one —
 * `drawn`/`onDrawn` off its `onAfterRenderObservable`, `beforeDraw`/
 * `onBeforeDraw` off its `onBeforeRenderObservable` (after the camera's
 * update, before its matrices), `onDrawPhase` off its two draw-phase
 * observables, the index off its own count (what `scene.getFrameId()` was),
 * and the canvas pass's depth off our pass owner (`Game.chainPasses`). The
 * engine's questions — begin, submit, the device, the encoders, the delta —
 * stayed Babylon's at X5.4f. Both arms answer every question the same way at
 * the same point of a frame: a probe reads the same on a parent and after
 * (X5.4f's record: the probes run at 221abf1 under both).
 *
 * **And OUR LOOP's arm since X5.4g, picked over Babylon's engine questions**
 * (`Game.frameLoop`, `src/core/FrameLoop.ts`): the loop is the game's, so
 * `onBegin` is its `onBeginFrameObservable` (after the clock's sample, before
 * `tick`, where the engine's `beginFrame` raised its own), `submitted`/
 * `onSubmitted` its `onEndFrameObservable` (after its ONE submit and the
 * frame id's move, where `endFrame` raised the engine's), `scheduleDelta` its
 * clock's `getDeltaTime` keyed on its `frameId` (the engine's
 * `getDeltaTime`/`frameId` before), and `encoderRole` names the frame's one
 * encoder `"frame"` (`FrameSubmit.encoder`), Babylon's two keeping their
 * names — they hold nothing of ours and are submitted only by the engine's
 * own resize. The begin and the end fire on our frames alone: Babylon's
 * resize frames (its own `beginFrame`/`endFrame` inside
 * `_initializeMainAttachments`) raised them at a parent and raise nothing of
 * ours.
 *
 * **And OUR DEVICE's arm since X5.4h, picked over Babylon's device and
 * canvas** (`Game.surface`, `src/core/CanvasSurface.ts`): Babylon's
 * `WebGPUEngine` is not constructed, so `device` is the game's own (the
 * renderer's, `Game.renderer.device`, which `main.ts` asked for), `canvas`
 * the surface's, and `host` names the scene's engine (a `NullEngine`,
 * `SceneEngine`) beside a `webgpu` that says whether the frame's device is a
 * `GPUDevice`. "Babylon's engine" everywhere in this adapter and in the
 * probes is THE SCENE'S (`scene.getEngine()`) — at a parent the
 * `WebGPUEngine` the game held as `Game.engine`, the same object — so a probe
 * hooking Babylon's begin-frames, draws or compiles hooks the `NullEngine`
 * after X5.4h and reads the 0 Babylon does there.
 *
 * **And it answers with NO SCENE since X6.1a** (`BABYLON_EXIT.md` X6.1a, for
 * X6.1h, which deletes `Game.scene`): **Babylon's arm is built only where
 * `g.scene` exists**, and every question a probe here asks of the scene or its
 * engine is a member of this adapter, so no probe names `g.scene`. Each
 * member answers off the scene while there is one and off the GAME's own
 * objects where there is not — or, where what it read was Babylon's own
 * business, says so by answering `null` (RETIRED: there is no Babylon left to
 * ask):
 *
 * - `ready()` with no scene: the game's PENDING DATA, read off the objects
 *   that hold it — the water's foam mask while it decodes (`WaterSystem`'s
 *   `foam`, a `MadeTexture` whose `texture` lands in the same task as the
 *   scene's `removePendingData`), the one thing the game hands the scene's
 *   `addPendingData` (X5.4d). A foam whose decode FAILED reads not ready for
 *   good here, where the scene's went ready on the error (the console says
 *   so, and every probe fails on a console error). X6.1h owes the game a
 *   readiness of its own, and this arm reads it then.
 * - `camera()`: the frame camera's matrices as the LAST render computed them
 *   (read it after a draw) — `{ camera, view, projection, transform, planes,
 *   globalPosition, renderWidth, renderHeight, aspect }`, the three matrices
 *   their sixteen float32s, `planes` the six frustum planes as
 *   `[nx, ny, nz, d]` doubles in Babylon's order (near, far, left, right,
 *   top, bottom). The camera is the game's (`g.cameraSys.camera`) on both
 *   arms, and so are its view and projection. Babylon's arm reads the scene's
 *   transform (`getTransformMatrix`), its `frustumPlanes` and the scene
 *   engine's render size and aspect; the game's reads the transform off the
 *   frame host (`SceneFrame.host.viewProjection`, what every draw of ours is
 *   handed) and the size and the aspect off the surface (`Game.surface`).
 *   **`planes` is READ, never re-derived** (X6.1a's review): with no scene it
 *   is the GAME's own plane array — the very array its culls read, which is
 *   `scene.frustumPlanes` today (`Game.ts`' four readers and `Sky.ts`'s) —
 *   reached as `Game.frustumPlanes`, six planes each `{ normal: { x, y, z },
 *   d }` as Babylon's `Plane` is, in the order above. **No tree has that
 *   field before X6.1f**, which ports `Frustum.GetPlanesToRef` and owes it
 *   (or names where its array lives and moves this arm onto it in the same
 *   commit); until then the no-scene arm answers `planes: null` — UNPROVEN,
 *   which `readers.mjs`' camera log spells `"unproven"` and says aloud, so a
 *   comparison against a scene's log FAILS on it unless `--ignore` names it.
 *   Planes restated here off `transform` would be a second copy of the
 *   arithmetic the port is meant to be held to, and would pass a wrong port.
 *   X6.1f ports the camera, and every member here reads ours then.
 * - `fields()` and `particles(on)`: every particle field (ours first, as the
 *   frame steps and draws them, then the scene's `particleSystems`), and the
 *   switch over both (`scene.particlesEnabled` and its twin
 *   `ParticleDraw.enabled`) — ours alone with no scene. `constantDelta(on)`:
 *   the frame's constant 16 ms (`scene.useConstantAnimationDeltaTime`, which
 *   `SceneFrame` reads); with no scene it THROWS, until X6.1h gives the frame
 *   its own.
 * - `counts()`: what the scene holds — `{ meshes, geometries, materials,
 *   activeMeshes }` — and `null` with no scene: Babylon holds nothing.
 * - `materials()`: every material on the page — every one the FACTORY holds
 *   (`CelMaterialFactory`: its cache, its emissives, its palette, its fire and
 *   its blast's paint), on both arms since `BABYLON_EXIT.md` X6.1c, when a
 *   material became a key of ours that the scene's list never holds (the
 *   scene's list until then, on a page with a scene).
 * - `transpilers()`: the scene engine's two GLSL fields (`_glslang`,
 *   `_tintWASM`; `assertNoTranspiler`), and `null` with no scene: no GLSL can
 *   reach a backend that does not exist. `compiles()`: the game's DEV counter
 *   of Babylon effect compiles (`Game.babylonCompiles`), `null` where the game
 *   has none (a production build, a tree before X5.3d, and every tree from
 *   X6.1c on, which deleted it with the cel program's Babylon declarations —
 *   RETIRED there, and a probe that reads it logs nothing of it).
 * - `clearColor()`: the frame's clear colour `{ r, g, b, a }` — the scene's
 *   (`world/environment.ts` writes it), or with no scene the frame host's
 *   (`SceneFrame.host.clearColor`, what our passes clear to).
 * - `pictureKey()`: what the kit's pictures are cached under
 *   (`world/textures.ts`' `WeakMap`, which a builder's `Scene` parameter
 *   reaches): the scene, or with no scene the factory — X6.1d caches them per
 *   factory (or renderer) and owes the probes that pass one its own.
 * - `babylon()`: `{ scene, engine }` while there is a scene, else `null` — for
 *   the probes that MEASURE Babylon itself (its `_draw`s, its rendering
 *   groups, its effects, its pipeline contexts): what they hook is RETIRED
 *   with it, and each says so when this answers `null`.
 *
 * `window.__refFrame({ scene: false })` builds the adapter as a page with no
 * scene would have it, on a page that has one: how each arm off the game's
 * objects is proven to answer what the Babylon read it replaces answers, on
 * the same frame (X6.1a's check). And `window.__refNoScene = true` (an init
 * script's, or `REF_NO_SCENE=1` in the environment, which `bootMap` turns
 * into one) makes EVERY adapter the page asks for that one — how a probe runs
 * as it will once X6.1h has deleted the scene, on a tree that still has one.
 */
export function frameAdapter() {
  window.__refFrame ??= (opts = {}) => {
    const g = window.__celshock;
    const scene = opts.scene === false || window.__refNoScene ? null : (g.scene ?? null);
    // Babylon's engine: the SCENE's (the header) — `Game.engine` at a parent.
    const e = scene ? scene.getEngine() : null;
    const none = (what) => () => {
      throw new Error(`frame adapter: ${what} has no arm with no scene and no frame of the game's`);
    };
    const babylon = scene
      ? {
          arm: "babylon",
          drawn: () =>
            new Promise((res) => {
              const o = scene.onAfterRenderObservable.add(() => {
                scene.onAfterRenderObservable.remove(o);
                res();
              });
            }),
          onDrawn: (fn) => {
            const o = scene.onAfterRenderObservable.add(fn);
            return () => scene.onAfterRenderObservable.remove(o);
          },
          beforeDraw: (fn) => void scene.onBeforeRenderObservable.addOnce(fn),
          onBeforeDraw: (fn) => {
            const o = scene.onBeforeRenderObservable.add(fn);
            return () => scene.onBeforeRenderObservable.remove(o);
          },
          submitted: () => new Promise((res) => void e.onEndFrameObservable.addOnce(() => res())),
          onSubmitted: (fn) => {
            const o = e.onEndFrameObservable.add(fn);
            return () => e.onEndFrameObservable.remove(o);
          },
          onBegin: (fn) => {
            const o = e.onBeginFrameObservable.add(fn);
            return () => e.onBeginFrameObservable.remove(o);
          },
          index: () => scene.getFrameId(),
          device: () => e._device ?? null,
          canvas: () => e.getRenderingCanvas(),
          canvasDepth: () => e._depthTexture ?? null,
          scheduleDelta: (fn) => {
            if (fn === null) {
              delete e.getDeltaTime;
              return;
            }
            const frame0 = e.frameId;
            e.getDeltaTime = () => fn(e.frameId - frame0);
          },
          encoderRole: (enc) => (enc === e._renderEncoder ? "render" : enc === e._uploadEncoder ? "upload" : "other"),
          onDrawPhase: (begin, end, endFirst = false) => {
            const b = begin ? scene.onBeforeDrawPhaseObservable.add(begin) : null;
            const a = end ? scene.onAfterDrawPhaseObservable.add(end, undefined, endFirst) : null;
            return () => {
              if (b) scene.onBeforeDrawPhaseObservable.remove(b);
              if (a) scene.onAfterDrawPhaseObservable.remove(a);
            };
          },
          host: () => ({ engine: e.constructor.name, webgpu: Boolean(e.isWebGPU), frame: "babylon" }),
        }
      : {
          // No scene and no frame of the game's yet: nothing to answer with.
          arm: "none",
          drawn: none("drawn"),
          onDrawn: none("onDrawn"),
          beforeDraw: none("beforeDraw"),
          onBeforeDraw: none("onBeforeDraw"),
          submitted: none("submitted"),
          onSubmitted: none("onSubmitted"),
          onBegin: none("onBegin"),
          index: none("index"),
          device: none("device"),
          canvas: none("canvas"),
          canvasDepth: none("canvasDepth"),
          scheduleDelta: none("scheduleDelta"),
          encoderRole: () => "other",
          onDrawPhase: none("onDrawPhase"),
          host: () => ({ engine: null, webgpu: false, frame: "none" }),
        };
    // Babylon's own two encoders, while it has an engine with any.
    const babylonRole = (enc) =>
      e && enc === e._renderEncoder ? "render" : e && enc === e._uploadEncoder ? "upload" : "other";
    // A plane array as `[nx, ny, nz, d]` doubles, read off whoever holds it.
    const planesOf = (list) => list.map((p) => [p.normal.x, p.normal.y, p.normal.z, p.d]);
    // Every material the factory holds (the header), in the order it keeps them.
    const factoryMaterials = () => {
      const m = g.mats;
      const out = [...m.cache.values(), ...m.emissiveCache.values()];
      for (const w of m.emissiveWorld ?? []) if (w && !out.includes(w)) out.push(w);
      for (const w of m.emissiveRecipes?.keys() ?? []) if (!out.includes(w)) out.push(w);
      if (m.flame) out.push(m.flame);
      if (m.blast) out.push(m.blast);
      return out;
    };
    const questions = {
      ready: scene
        ? () => scene.isReady()
        : () => {
            // The game's pending data (the header): the foam mask, while it decodes.
            const foam = g.water?.foam ?? null;
            return foam === null || foam.texture !== null;
          },
      camera: () => {
        const cam = g.cameraSys.camera;
        let transform;
        let planes;
        let renderWidth;
        let renderHeight;
        let aspect;
        if (scene) {
          transform = Float32Array.from(scene.getTransformMatrix().m);
          planes = planesOf(scene.frustumPlanes);
          renderWidth = e.getRenderWidth();
          renderHeight = e.getRenderHeight();
          aspect = e.getAspectRatio(cam);
        } else {
          transform = new Float32Array(16);
          g.sceneFrame.host.viewProjection(transform);
          // The GAME's own array (the header), never a restatement: null —
          // UNPROVEN — on every tree before X6.1f gives the game one.
          planes = g.frustumPlanes ? planesOf(g.frustumPlanes) : null;
          renderWidth = g.surface.getRenderWidth();
          renderHeight = g.surface.getRenderHeight();
          aspect = g.surface.getAspectRatio(cam);
        }
        const gp = cam.globalPosition;
        return {
          camera: cam,
          view: Float32Array.from(cam.getViewMatrix().m),
          projection: Float32Array.from(cam.getProjectionMatrix().m),
          transform,
          planes,
          globalPosition: [gp.x, gp.y, gp.z],
          renderWidth,
          renderHeight,
          aspect,
        };
      },
      fields: () => [...(g.particleDraw ? g.particleDraw.fields : []), ...(scene ? scene.particleSystems : [])],
      particles: (on) => {
        if (scene) scene.particlesEnabled = on;
        if (g.particleDraw) g.particleDraw.enabled = on;
      },
      constantDelta: (on) => {
        if (!scene) {
          throw new Error("frame adapter: the frame's constant delta has no arm with no scene (X6.1h owes the frame its own)");
        }
        scene.useConstantAnimationDeltaTime = on;
      },
      counts: () =>
        scene
          ? {
              meshes: scene.meshes.length,
              geometries: scene.geometries.length,
              materials: scene.materials.length,
              activeMeshes: scene.getActiveMeshes().length,
            }
          : null,
      // The factory's on both arms: no material is the scene's since X6.1c (the header).
      materials: () => factoryMaterials(),
      transpilers: () => (e ? { _glslang: e._glslang, _tintWASM: e._tintWASM } : null),
      compiles: () => (g.babylonCompiles ? g.babylonCompiles.count : null),
      babylon: () => (scene ? { scene, engine: e } : null),
      pictureKey: () => scene ?? g.mats,
      clearColor: () => {
        if (scene) {
          const c = scene.clearColor;
          return { r: c.r, g: c.g, b: c.b, a: c.a };
        }
        const out = { r: 0, g: 0, b: 0, a: 0 };
        g.sceneFrame.host.clearColor(out);
        return out;
      },
    };
    const base = { ...babylon, ...questions };
    // OURS (X5.4f): the frame is the game's (`Game.sceneFrame`), its points
    // Babylon's observables of its own, named for the scene's they replace.
    const f = g.sceneFrame;
    if (!f) return base;
    const ours = {
      ...base,
      arm: "ours",
      drawn: () =>
        new Promise((res) => {
          const o = f.onAfterRenderObservable.add(() => {
            f.onAfterRenderObservable.remove(o);
            res();
          });
        }),
      onDrawn: (fn) => {
        const o = f.onAfterRenderObservable.add(fn);
        return () => f.onAfterRenderObservable.remove(o);
      },
      beforeDraw: (fn) => void f.onBeforeRenderObservable.addOnce(fn),
      onBeforeDraw: (fn) => {
        const o = f.onBeforeRenderObservable.add(fn);
        return () => f.onBeforeRenderObservable.remove(o);
      },
      index: () => f.index,
      canvasDepth: () => g.chainPasses?.canvasDepthTexture ?? null,
      onDrawPhase: (begin, end, endFirst = false) => {
        const b = begin ? f.onBeforeDrawPhaseObservable.add(begin) : null;
        const a = end ? f.onAfterDrawPhaseObservable.add(end, undefined, endFirst) : null;
        return () => {
          if (b) f.onBeforeDrawPhaseObservable.remove(b);
          if (a) f.onAfterDrawPhaseObservable.remove(a);
        };
      },
      host: () => ({ engine: e ? e.constructor.name : null, webgpu: Boolean(e?.isWebGPU), frame: "ours" }),
    };
    // OUR LOOP (X5.4g): the frame's begin, its submit, its delta and its one
    // encoder are the game's (`Game.frameLoop`).
    const l = g.frameLoop;
    if (!l) return ours;
    const loop = {
      ...ours,
      submitted: () => new Promise((res) => void l.onEndFrameObservable.addOnce(() => res())),
      onSubmitted: (fn) => {
        const o = l.onEndFrameObservable.add(fn);
        return () => l.onEndFrameObservable.remove(o);
      },
      onBegin: (fn) => {
        const o = l.onBeginFrameObservable.add(fn);
        return () => l.onBeginFrameObservable.remove(o);
      },
      scheduleDelta: (fn) => {
        if (fn === null) {
          delete l.clock.getDeltaTime;
          return;
        }
        const frame0 = l.frameId;
        l.clock.getDeltaTime = () => fn(l.frameId - frame0);
      },
      encoderRole: (enc) => (enc === l.submit.encoder ? "frame" : babylonRole(enc)),
    };
    // OUR DEVICE (X5.4h): the device and the canvas are the game's
    // (`Game.surface`); Babylon's engine is the scene's `NullEngine`.
    const s = g.surface;
    if (!s) return loop;
    return {
      ...loop,
      device: () => g.renderer.device,
      canvas: () => s.canvas,
      host: () => ({
        engine: e ? e.constructor.name : null,
        webgpu: typeof GPUDevice !== "undefined" && g.renderer.device instanceof GPUDevice,
        frame: "ours",
      }),
    };
  };
}

/**
 * Installs the adapter on a page as an init script (the header) — ahead of
 * whatever init the caller adds after, so that init may ask it from the
 * game's first frame — and, under `REF_NO_SCENE=1` in this process's
 * environment, `window.__refNoScene = true` before it, so every adapter the
 * page builds is the no-scene one. Every script that opens a page of its own
 * installs it through here rather than calling `addInitScript(frameAdapter)`.
 */
export async function installFrameAdapter(page) {
  if (process.env.REF_NO_SCENE === "1") await page.addInitScript(() => (window.__refNoScene = true));
  await page.addInitScript(frameAdapter);
}
