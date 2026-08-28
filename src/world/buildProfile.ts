/**
 * buildProfile.ts — where the time behind the loading card went, per phase.
 * Owns: a list of (label, milliseconds) for one `MapBuilder.build`, and the
 * `window.__buildProfile` handle a smoke script reads it off.
 * Invariants: DEV ONLY and a no-op otherwise — `record` calls its callback
 * straight through under `vite build`, so nothing here costs a production
 * frame or a production byte. It measures and never decides: no caller may read
 * a phase back to change what it does.
 *
 * **It exists because wall 4 is the one wall nobody can see.** `ENGINE_UPGRADE.md`
 * splits `MapBuilder`'s build by what each step scales with — box count times
 * footprint for `severLinks`, `clearBlocked`, `CoverMap.bake`, `vertexShading`
 * and `findSpot`; map AREA for `linkCells`, the flood fill, `terrainPatches`,
 * the AO bake and every flow field — and derives 30-60 s behind the card at
 * 1500 m from maps a quarter the size. A derivation is not a measurement, and
 * the phases are inside one synchronous call where no profiler outside the page
 * can reach them, so the instrument has to be in the tree.
 *
 * **The whole build is one label and each phase is another, deliberately
 * overlapping.** A phase list that summed to the total would need every line of
 * `build` inside a phase, which is a refactor of the file this is supposed to
 * be measuring; instead `build:total` is the truth and the phases under it are
 * the parts worth naming, with the remainder — geometry, merges, materials —
 * being what is left over. Read it as an attribution, not a partition.
 *
 * The one existing timer this generalises is `MapBuilder`'s `[bake]` line,
 * which logged the AO bake's vertex count and milliseconds under the same DEV
 * gate. That line stays, because the vertex count is not a duration and is
 * worth having beside it.
 */

/** One named span of a map build. */
export interface BuildPhase {
  label: string;
  ms: number;
}

/**
 * The phases of the LAST build, oldest first. Replaced wholesale by `begin`,
 * so a reader always sees one build rather than an accumulation across the
 * editor's rebuilds.
 */
let phases: BuildPhase[] = [];

/**
 * Published under DEV so a Playwright script can read the split without the
 * page having to log it. Deliberately a function rather than the array: the
 * array is replaced per build, and a handle captured once would go stale on the
 * first rebuild.
 */
if (import.meta.env.DEV) {
  (globalThis as unknown as { __buildProfile: () => BuildPhase[] }).__buildProfile =
    () => phases.slice();
}

/** Starts a fresh build's list. Called once, at the top of `MapBuilder.build`. */
export function begin(): void {
  if (import.meta.env.DEV) phases = [];
}

/**
 * Runs `fn`, and under DEV records how long it took.
 *
 * Returns whatever `fn` returns, so a call site wraps an existing expression
 * rather than growing a temporary around it — which is what keeps this readable
 * at the six places it is used.
 */
export function record<T>(label: string, fn: () => T): T {
  if (!import.meta.env.DEV) return fn();
  const t0 = performance.now();
  const out = fn();
  phases.push({ label, ms: performance.now() - t0 });
  return out;
}

/** Records a span that was timed by hand, for a call site `record` cannot wrap. */
export function since(label: string, t0: number): void {
  if (import.meta.env.DEV) phases.push({ label, ms: performance.now() - t0 });
}
