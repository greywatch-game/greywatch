/**
 * OutlineFog.ts — Per-pixel distance fog for Babylon's outline pass.
 * Owns: the patched `outlineVertexShader`/`outlinePixelShader` sources, and the
 * one place in this tree that reaches into Babylon's compiled-effect cache.
 * Invariants: the fog it bakes must be the SAME fog the cel shader is given —
 * `CelMaterialFactory.setEnvironment` is the only caller, so the ink and the
 * surface under it cannot describe different weather. Patching is anchored on
 * Babylon's own `#define CUSTOM_*` markers and throws in dev if one is missing,
 * because the failure mode of a silent miss is the bug this exists to fix.
 *
 * WHY THIS IS NOT DONE THE OBVIOUS WAY. An outline is a back-face shell drawn
 * by Babylon's `OutlineRenderer`, whose entire fragment shader is
 * `fragmentOutputs.color = uniforms.color` — a flat per-MESH colour, no fog and
 * no depth. Fading that colour on the CPU (which `updateOutlineScales` did
 * first, and still does for width) can only ever be per mesh, and per mesh is
 * not enough here:
 * `BlockMerge` collapses the map into one mesh per 48 m block per material, so
 * a single mesh routinely spans the whole fog band. Measured on Greyfen: of 687
 * outlined meshes, 50 had fog 0.0 at their near edge and 1.0 at their far edge.
 * Those 50 are the village. The symptom is ink hanging in clear black lines
 * over walls that have already dissolved into the fog wall.
 *
 * THE TWO THINGS THAT MAKE A PER-PIXEL FADE POSSIBLE WITHOUT A UNIFORM.
 * `OutlineRenderer` builds its effect with a hardcoded `uniformsNames` list and
 * offers no hook to extend it, so a new uniform cannot be bound at all — every
 * value the fade needs has to be recovered from what is already there:
 *
 * - **Distance** comes from `viewProjection`. Rows 0, 1 and 3 of a perspective
 *   view-projection are `P00 * right`, `P11 * up` and `forward`; the view
 *   rotation is orthonormal, so `forward` is unit length and the other two
 *   normalise by their own length. The eye is the one point whose clip x, y and
 *   w all vanish, which those three rows give directly — **no matrix inverse,
 *   and the reason that matters has changed rather than gone away**. It used to
 *   be that a WebGL2 context runs these shaders in GLSL ES 1.00 mode, where
 *   `inverse` does not exist. It is now that **WGSL has `transpose()` and no
 *   `inverse()` at all**, in any version — so the rows trick is not a
 *   workaround for an old dialect that a newer one would let us drop, it is the
 *   only way to recover an eye here, and undoing it has nothing to fall back
 *   on. The result is
 *   `length(worldPos - eye)`, the SAME radial distance the cel shader fogs by.
 *   Using `gl_Position.w` instead would have been free, but planar depth
 *   disagrees with radial by up to 1.4x at the corners of a 54 deg FOV, and an
 *   outline that fogs differently from its own surface is this bug again.
 * - **Fog colour and range** are baked into the source as literals, because
 *   there is nowhere to put them. That is what `setOutlineFog` re-bakes, and
 *   why it has to drop the compiled programs.
 *
 * WHAT THE INVALIDATION COSTS. `Engine.createEffect` caches on shader NAME plus
 * defines, never on source, so a re-bake is invisible to it and the stale
 * program would be handed back forever — and `OutlineRenderer` compounds it by
 * asking the cache for an effect only when its DEFINES change, which is never.
 * `dropCompiled` is what forces the recompile, and every one of its rules was
 * paid for in a bug — see it.
 *
 * WHICH STORE, AND WHY THERE IS NO CHOICE ABOUT IT. `OutlineRenderer` sets
 * `_shaderLanguage = GLSL` in its constructor and then overwrites it with WGSL
 * whenever `engine.isWebGPU`, with no flag between and no override anywhere —
 * unlike `StandardMaterial`, which has `ForceGLSL`. So the pass reads
 * `ShadersStoreWGSL` and this file writes it, and the two halves of that
 * sentence have to move together: writing the other store is not a compile
 * error, it is a patch that silently does nothing, which is the ORIGINAL bug
 * arriving by a different route. It is SILENT on Hollowmere and loud on
 * Greyfen for the reason it was the first time — near-black ink on a near-black
 * fog is invisible — so a sweep starting on the night village reports clean.
 *
 * THE ONE THING THIS FILE MUST NEVER DO is statically import a Babylon shader
 * module to get at its source. See `applyWanted`. It cost a whole debugging
 * session: the symptom is not in the renderer at all.
 */
import { Color3, ShaderStore, type Scene } from "@babylonjs/core";

const VERTEX = "outlineVertexShader";
const FRAGMENT = "outlinePixelShader";

/** Babylon's own sources, captured before the first patch overwrites them. */
let pristineVertex = "";
let pristineFragment = "";

/** The varying, declared in BOTH stages — see `patch`. */
const VARYING = "varying vCelFogDist: f32;";

/**
 * Recovers the eye from `viewProjection` and hands the fragment shader the same
 * radial distance the cel shader measures. `worldPos` is the EXTRUDED shell
 * vertex, which is what should be fogged — it is the thing being drawn.
 *
 * Degenerates under an orthographic projection, which has no eye point. Nothing
 * here draws outlines through one: the shadow pass renders depth only.
 *
 * A WGSL matrix indexes as `m[column][row]`, which is GLSL's convention too, so
 * the six reads below name the same six numbers they always did. What changed
 * is spelling: the uniform is reached through `uniforms.`, `worldPos` is still
 * a local of Babylon's own `main` and the varying is written through
 * `vertexOutputs.`.
 */
const VERTEX_BODY = `
let celFogRight = vec3f(uniforms.viewProjection[0][0], uniforms.viewProjection[1][0], uniforms.viewProjection[2][0]);
let celFogUp = vec3f(uniforms.viewProjection[0][1], uniforms.viewProjection[1][1], uniforms.viewProjection[2][1]);
let celFogFwd = vec3f(uniforms.viewProjection[0][3], uniforms.viewProjection[1][3], uniforms.viewProjection[2][3]);
let celFogEye = -celFogRight * (uniforms.viewProjection[3][0] / dot(celFogRight, celFogRight))
  - celFogUp * (uniforms.viewProjection[3][1] / dot(celFogUp, celFogUp))
  - celFogFwd * (uniforms.viewProjection[3][3] / dot(celFogFwd, celFogFwd));
vertexOutputs.vCelFogDist = distance(worldPos.xyz, celFogEye);
`;

/**
 * A float as WGSL will take it. An integer-valued literal has to carry its
 * point: WGSL infers an integer type for `78` and rejects the subtraction it
 * lands in, where GLSL ES would have promoted it.
 */
function wgsl(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

/**
 * Rewrites both shader sources with this fog baked in. Anchors are Babylon's
 * `#define CUSTOM_*` markers, which are its documented injection points and the
 * only thing here that is not a plain uniform contract.
 *
 * **The varying is declared in BOTH stages and the anchors are what keep its
 * location in step.** Babylon numbers a stage's varyings in declaration order,
 * so the two lists have to agree; `CUSTOM_VERTEX_DEFINITIONS` and
 * `CUSTOM_FRAGMENT_DEFINITIONS` both sit after everything either stage
 * declares — the clip plane, the log depth and `ALPHATEST`'s `vUV` — so ours
 * is last in both whatever defines a given mesh compiles with. That was true
 * under GLSL as well and cost nothing to notice; under WGSL a mismatch is a
 * `@location` mismatch and the pipeline does not build at all.
 */
function patch(color: Color3, start: number, end: number): void {
  const anchor = (src: string, marker: string, add: string, what: string) => {
    if (import.meta.env.DEV && !src.includes(marker)) {
      throw new Error(`OutlineFog: no ${marker} in ${what}; outlines will not fog`);
    }
    return src.replace(marker, `${marker}\n${add}`);
  };

  ShaderStore.ShadersStoreWGSL[VERTEX] = anchor(
    anchor(
      pristineVertex,
      "#define CUSTOM_VERTEX_DEFINITIONS",
      VARYING,
      "outline vertex",
    ),
    // Sits after `worldPos` and `vertexOutputs.position` are assigned, so both
    // are live.
    "#include<clipPlaneVertex>",
    VERTEX_BODY,
    "outline vertex",
  );

  const span = Math.max(0.001, end - start);
  ShaderStore.ShadersStoreWGSL[FRAGMENT] = anchor(
    anchor(
      pristineFragment,
      "#define CUSTOM_FRAGMENT_DEFINITIONS",
      VARYING,
      "outline fragment",
    ),
    // Immediately after `fragmentOutputs.color = uniforms.color;`, so this fogs
    // the ink Babylon just wrote rather than replacing the whole shader's job.
    // Reading `fragmentOutputs` back is legal: the processor declares it as a
    // `var` in `main` and appends the `return` itself.
    "#define CUSTOM_FRAGMENT_MAIN_END",
    `let celFogT = clamp((fragmentInputs.vCelFogDist - ${wgsl(start)}) / ${wgsl(span)}, 0.0, 1.0);
fragmentOutputs.color = vec4f(mix(fragmentOutputs.color.rgb, vec3f(${wgsl(color.r)}, ${wgsl(color.g)}, ${wgsl(color.b)}), celFogT * celFogT), fragmentOutputs.color.a);`,
    "outline fragment",
  );
}

/**
 * The four render passes `OutlineRenderer` keeps a draw wrapper per — outline
 * and overlay, each in its before- and after-mesh half.
 *
 * Naming them is what keeps `dropCompiled` from resetting the draw cache of
 * every PASS as well as every mesh. An unscoped reset also disposes each
 * material's wrapper, and disposing is a ref release: with nothing else holding
 * them, the cel materials, the sky and the post-process chain all lose their
 * programs and recompile on the next frame. Measured on a map change: 15
 * recompiles unscoped against the 1 these passes owe — the outline itself.
 *
 * Returns null rather than guessing if Babylon ever stops keeping them here;
 * the caller falls back to the unscoped reset, which is slower and correct.
 */
function outlinePassIds(scene: Scene): number[] | null {
  const ids = (
    scene.getOutlineRenderer() as unknown as { _passIdForDrawWrapper?: unknown }
  )._passIdForDrawWrapper;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return ids.every((id) => typeof id === "number") ? (ids as number[]) : null;
}

/**
 * Forgets every compiled outline program so the next draw compiles the re-baked
 * source, and drops the draw wrappers still pointing at the old one. The cache
 * is keyed `"<vertex>+<fragment>@<defines>"` and the outline pass names both
 * halves `outline`, so that prefix takes this shader's variants (skinned,
 * instanced) and nothing else — the alternative, `releaseEffects()`, would
 * recompile the cel materials, the post-process chain and the sky on every
 * round start.
 *
 * **`_releaseEffect` is still not the way to do it.** It deletes the GL program
 * on the spot, and a draw wrapper holding that `Effect` then draws with a
 * deleted program — undefined behaviour, and the sort that shows up as damage to
 * whatever renders next rather than to the outline. Clearing the wrappers first
 * and letting the count fall is the same freeing done in the one order where
 * nothing is left pointing at it; see the note on immediacy below, which is the
 * bug that taught this file the difference.
 *
 * **The reset is what actually re-bakes anything; the cache delete alone does
 * nothing.** `OutlineRenderer.isReady` asks the engine for an effect only when
 * its DEFINES string changes — `if (cachedDefines !== join)` — and the outline
 * pass's defines never change for a given mesh. So a draw wrapper that already
 * holds an effect will never consult the cache again however many entries are
 * forgotten. Clearing the wrapper is the only way to make it ask, and the delete
 * exists so that what it then asks for is compiled from the re-baked source.
 *
 * **It walks EVERY mesh, and must not be filtered on `renderOutline`.** That
 * looks like the right set — it is the set the outline pass draws — but the flag
 * is a RUNTIME TOGGLE: `Bot.setOutlines` clears it past `lodOutlineDistance`
 * (20 m), so at any instant most bot rigs have it off, and bot rigs are POOLED —
 * built once, never disposed, alive across every map change. A rig that drew
 * under the old bake and was LOD'd out at the moment of the new one kept its
 * wrapper and went on drawing the previous map's fog for the rest of the
 * session. Measured on greyfen -> hollowmere: 148 wrappers still mixing ink to
 * Greyfen's `#c2ccd4`, which at the fog wall IS the ink — a bot's nine merged
 * meshes read as a scatter of white slivers over the village. Filtering on the
 * outline REGISTRY was the same mistake one layer along: it misses `ViewModel`'s
 * ~40 meshes, which set `renderOutline` by hand and never register (distance
 * thinning is meaningless 0.5 m from the lens). There is no cheap set that is
 * right, because anything may have the flag flipped on later; the whole scene is
 * the honest answer, and it is affordable: 4.9 ms for Hollowmere's 1,910 meshes
 * across the four outline passes, once per fog change, against the ~570 ms the
 * map build beside it costs. Only the outline keys are dropped, so everything
 * else re-fetches its effect from the cache on the next frame rather than
 * recompiling.
 *
 * **The reset must be IMMEDIATE, and it must come BEFORE the cache delete.**
 * `resetDrawCache()` defaults to `immediate = false`, which does not merely
 * forget each discarded wrapper — it QUEUES that wrapper's `Effect.dispose()` on
 * the engine's `endFrame` observable, and a dispose is a REF RELEASE: Babylon
 * ref-counts an effect by how many wrappers asked `createEffect` for it, and the
 * one that takes the count to zero deletes the GL program and removes the cache
 * entry itself. Deleting the entry by hand first is what desynchronises that
 * count. The bake happens inside `startRound`, so the order used to be: forget
 * the entry, clear ~500 wrappers with their releases still pending, build and
 * render the new map — which compiles a fresh effect (the entry is gone) and
 * hands it to every wrapper the frame rebuilds — and only THEN, at `endFrame`,
 * do the queued releases land and drive a live generation's count to zero. Its
 * program is deleted under the wrappers still pointing at it, which is precisely
 * the undefined behaviour this comment used to promise `delete` avoided.
 *
 * What it looks like is the whole point: the map is rebuilt after the bake, so
 * its meshes are innocent, and the damage lands only on the geometry that
 * SURVIVES a map change — the pooled bot rigs and the viewmodel. Their outline
 * shells draw from a deleted program as garbage that swallows the body it
 * belongs to, so on Greyfen's pale fog a squad reads as flat yellow cut-outs of
 * itself (measured: 534 of 642 outline wrappers holding a freed effect one
 * switch in, and it compounds with every further switch). On Hollowmere the same
 * garbage is near-black against near-black and invisible, which is why this
 * survived a whole map.
 *
 * Resetting immediately puts the releases back inside the bake, where the last
 * one frees the effect while nothing holds it and Babylon drops its own cache
 * entry. The delete that follows is a backstop for the case where some ref
 * outlives the walk: by then no wrapper points at the effect, so forgetting it
 * strands nobody and costs at worst a leaked program.
 *
 * This is the only place the game touches Babylon's effect cache. There is no
 * public equivalent: `createEffect` never consults the source it caches.
 */
function dropCompiled(scene: Scene): void {
  const passes = outlinePassIds(scene);
  for (const mesh of scene.meshes) {
    if (passes) for (const pass of passes) mesh.resetDrawCache(pass, true);
    else mesh.resetDrawCache(undefined, true);
  }
  const cache = (
    scene.getEngine() as unknown as { _compiledEffects?: Record<string, unknown> }
  )._compiledEffects;
  if (cache) {
    for (const key of Object.keys(cache)) {
      if (key.startsWith("outline+outline@")) delete cache[key];
    }
  }
}

let bakedKey = "";
let wanted: { color: Color3; start: number; end: number } | null = null;

/**
 * Bakes the wanted fog if Babylon has registered the outline shaders yet.
 *
 * **The wait is why there is no
 * `import "@babylonjs/core/ShadersWGSL/outline.vertex"` here, and there must
 * never be one.** `OutlineRenderer` pulls both shaders in
 * through a dynamic `import()`, so the store is empty until something is first
 * outlined — but importing them statically to fix that adds a deep entry to
 * `@babylonjs/core`, which the tree now has NONE of and which
 * `scripts/check-deep-imports.mjs` fails the build over. It also makes Vite
 * re-optimize the dependency mid-session. The
 * chunks Babylon's OWN dynamic imports resolve against are rewritten by that
 * pass, and the ones already loaded 404: `glowMapGeneration.vertex` and
 * `default.vertex` were the casualties, which is the glow layer and every
 * StandardMaterial in the game. The symptom is that everything that glows stops
 * glowing, with nothing wrong in the renderer at all — see the `optimizeDeps`
 * warning in CLAUDE.md, which is the same trap from the other end. Waiting for
 * Babylon to import them itself costs one frame of un-fogged outlines and
 * touches nothing the optimizer can see.
 */
function applyWanted(scene: Scene): void {
  if (!wanted) return;
  const vertex = ShaderStore.ShadersStoreWGSL[VERTEX];
  const fragment = ShaderStore.ShadersStoreWGSL[FRAGMENT];
  if (!vertex || !fragment) return;
  if (!pristineVertex) {
    pristineVertex = vertex;
    pristineFragment = fragment;
  }
  patch(wanted.color, wanted.start, wanted.end);
  dropCompiled(scene);
  wanted = null;
}

/**
 * Installs this fog into the outline pass, recompiling only if it changed.
 * Called from `CelMaterialFactory.setEnvironment` — the same call that pushes
 * the fog onto the cel materials, so the two can never drift apart.
 *
 * Invalidation is entirely this function's, deliberately: the first cut left it
 * to the caller and the caller used the outline REGISTRY, which does not contain
 * the viewmodel. Nothing about a fog change should require a second party to
 * remember a second list.
 */
export function setOutlineFog(
  scene: Scene,
  color: Color3,
  start: number,
  end: number,
): void {
  const key = `${color.r},${color.g},${color.b},${start},${end}`;
  if (key === bakedKey) return;
  bakedKey = key;
  wanted = { color: color.clone(), start, end };
  applyWanted(scene);
}

/**
 * Retries a bake that arrived before Babylon had imported the outline shaders.
 * A no-op on every frame but the one or two after a fog change, and called from
 * `CelMaterialFactory.updateCamera` so nothing else has to remember it — which
 * is once per frame in every state, so a bake raised under a menu lands there
 * rather than waiting for a round.
 */
export function refreshOutlineFog(scene: Scene): void {
  if (wanted) applyWanted(scene);
}
