/**
 * babylonCompiles.ts — the DEV counter of BABYLON EFFECT COMPILES, which must
 * read 0 in every state (`BABYLON_EXIT.md` X5.3d, "Left for X6.1, guarded").
 * Owns: one count per engine and the set of effects it has already counted.
 * Invariants: counts only after `watchBabylonCompiles` — which `Game` calls
 * first thing in its constructor, on the scene's engine as it is built (a
 * `NullEngine` since `BABYLON_EXIT.md` X5.4h, `core/SceneEngine.ts`, which
 * compiles nothing for itself; Babylon's `WebGPUEngine` until then, whose
 * `initAsync` compiled `clearQuad` before the watch and kept it for the
 * engine's life). Every compile after that is a Babylon MATERIAL being drawn,
 * or about to be, and none may be: no
 * Babylon mesh is drawn and no Babylon material compiles in any state since
 * the map editor went (X5.3c), our renderer drawing everything off recipes,
 * and the cel program's Babylon declarations and the factory's per-frame
 * pushes into Babylon materials stand until X6.1 only as long as this says
 * nothing is compiled from them. Public API alone: `createEffect` and
 * `createComputeEffect` are wrapped on the INSTANCE, and an effect is counted
 * the first time either hands it back — Babylon hands back the effect it
 * already holds for a source and defines it has compiled, so a new object is
 * a compile. (An effect compiled BEFORE the watch and asked for again after
 * it would be counted too, there being no public way to list the engine's
 * cache: none is compiled before it on a `NullEngine`.) **There is one door
 * it does not see**: an `EffectWrapper` built with
 * `useShaderStore` false, Babylon's default, makes its `Effect` with `new`
 * rather than through `createEffect` (`Materials/effectRenderer.pure.js`), so
 * a wrapper built that way (an `EffectRenderer`'s pass, say) would compile
 * uncounted; a `PostProcess` sets `useShaderStore` and is seen. Nothing in
 * `src/` builds a wrapper — the post chain and the glow's blur are ours since
 * X5.2 — so a new one owes this watch that door before it lands, or the
 * counter reads 0 while it compiles.
 * Never: runs in a production build (the caller's `import.meta.env.DEV`);
 * changes what either call does or returns.
 * Contract: `docs/rendering.md`, "Our renderer's frame"; the draw log
 * (`plans/webgpu-ref/drawlog.mjs`) reads `count` in every state and fails a
 * run where it is not 0.
 *
 * **It WARNS rather than errs, because an instrument compiles on purpose**:
 * `shaders.mjs` compiles every Babylon cel variant by design, which is what it
 * checks, and a console error would fail it on its own instrument; the game
 * never asks. (There were two until `BABYLON_EXIT.md` X5.3e: the harness's
 * readiness wait — `waitUntilDrawn`'s `scene.isReady()`, which the bank,
 * `gate.mjs`, `post.mjs` and `surfaces.mjs` stand on — asks every mesh's
 * material, and the collider meshes wore none, so it compiled Babylon's
 * `default` `StandardMaterial` once a page. No collider is a mesh now, a
 * round's scene holds none of the world's, and the wait compiles nothing.)
 */
import type { AbstractEngine } from "@babylonjs/core";

/** What `Game` holds and the draw log reads (`window.__celshock.babylonCompiles`). */
export interface BabylonCompiles {
  /** Babylon effects compiled since the watch began. Must be 0. */
  readonly count: number;
  /** Their names, in the order they were compiled. */
  readonly names: readonly string[];
}

/** An effect as far as this reads it: its name, a string or a stage map. */
interface Named {
  readonly name: unknown;
}

function nameOf(effect: Named): string {
  const n = effect.name;
  if (typeof n === "string") return n.length > 80 ? `${n.slice(0, 77)}...` : n;
  if (n && typeof n === "object") {
    const stages = n as Record<string, unknown>;
    const s = stages.vertex ?? stages.vertexElement ?? stages.compute ?? stages.computeElement;
    if (typeof s === "string") return s.length > 80 ? `${s.slice(0, 77)}...` : s;
  }
  return "(inline)";
}

/**
 * Starts counting `engine`'s effect compiles. Each one is said on the console
 * as a WARNING, once (the header says why not an error); the draw log is what
 * fails on one.
 */
export function watchBabylonCompiles(engine: AbstractEngine): BabylonCompiles {
  const seen = new WeakSet<object>();
  const names: string[] = [];
  const state = { count: 0, names };
  const counted = <T>(effect: T): T => {
    if (effect && typeof effect === "object" && !seen.has(effect)) {
      seen.add(effect);
      state.count++;
      const name = nameOf(effect as unknown as Named);
      names.push(name);
      console.warn(
        `[babylon] an effect was compiled (${name}): no Babylon material may compile in any state (BABYLON_EXIT.md X5.3d)`,
      );
    }
    return effect;
  };
  type Create = (...args: unknown[]) => unknown;
  const host = engine as unknown as { createEffect: Create; createComputeEffect?: Create };
  const effect = host.createEffect;
  host.createEffect = function (this: unknown, ...args: unknown[]) {
    return counted(effect.apply(this, args));
  };
  const compute = host.createComputeEffect;
  if (compute) {
    host.createComputeEffect = function (this: unknown, ...args: unknown[]) {
      return counted(compute.apply(this, args));
    };
  }
  return state;
}
