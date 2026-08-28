/**
 * vite.server.config.ts — Builds `server/` into `dist-server/`.
 *
 * Vite rather than `tsc` emitting to disk, because three things in the shared
 * `src/` tree do not survive bare Node resolution and all three are Vite's job:
 *
 *   1. `CelShader.ts` imports
 *      `@babylonjs/core/Shaders/ShadersInclude/bonesDeclaration` with no file
 *      extension. `@babylonjs/core` declares no `exports` map, so Node treats
 *      the specifier as a literal path and cannot find it. Those two imports
 *      are load-bearing (see CLAUDE.md) and are not to be edited for this.
 *   2. `TerrainField.ts` reads `import.meta.env.DEV`, a Vite substitution that
 *      is `undefined` under Node.
 *   3. Babylon is ~7 MB and the server reaches a fraction of it.
 *
 * Note this is the opposite side of CLAUDE.md's rule about never adding deep
 * `@babylonjs/core` subpath imports: that rule is about Vite's DEV dep
 * optimizer rewriting chunks out from under a running page. Nothing here runs
 * in a browser and nothing is optimized, so the server may import
 * `Engines/nullEngine` — which it must, since the engine is not in the barrel.
 *
 * Like `vite.config.ts`, this file is kept out of tsconfig's `include`.
 */
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: true,
    outDir: "dist-server",
    emptyOutDir: true,
    target: "node20",
    minify: false,
    // Sourcemaps matter more here than in the client: a stack trace from a
    // bundled 5 MB server file is otherwise unreadable.
    sourcemap: true,
    rollupOptions: {
      // Three entries: the server proper, the headless round runner that is the
      // only way to watch the simulation with nobody connected to it, and the
      // fingerprint dump that `npm run parity` diffs against a real browser
      // build.
      input: {
        index: "server/index.ts",
        simulate: "server/simulate.ts",
        parity: "server/parity.ts",
      },
      // Runtime dependencies stay external; everything in `src/` and Babylon is
      // bundled so the three resolution problems above are settled at build
      // time rather than at import time.
      external: ["ws", /^node:/],
      output: { entryFileNames: "[name].js" },
      /**
       * The DEV-only proving ground is the one thing in `src/` this build has
       * to be TOLD is droppable, and it is worth knowing why rather than
       * copying the line.
       *
       * `src/world/maps.ts` states the proving entry inside an
       * `import.meta.env.DEV` ternary. Vite folds that to `false` here as it
       * does in the client build, so the `MapDef` goes — but the LAYOUT module
       * behind it stays, because Rollup's default is that every module has
       * side effects and `proving/layout.ts` builds its control points with
       * `new Vector3(...)` at module scope, which Rollup cannot prove is
       * nothing. The client build shakes it away only because Vite sets
       * `moduleSideEffects: "no-external"` there and does not set it here.
       *
       * Measured: without this, `dist-server` carried the proving ground's
       * control points and spawns — the two arrays whose elements are
       * `new Vector3`, about 1 kB. The 1500 m map's other 420 kB (its 1,108
       * placements and its 141,376-vertex heightfield) is plain object and
       * number literals and was already shaken. So the leak is small and the
       * rule is not: a production artefact carrying a dev-only map's flags is
       * the shake having stopped working, and the next thing added to that
       * directory will not be so cheap.
       *
       * Named as a PREDICATE over these two generated files rather than as
       * `"no-external"` for the whole tree: the blanket setting would be a
       * claim about every module under `src/`, made to fix one that is not
       * shipped at all, and the failure it would buy is a module quietly
       * dropped on the authority with the client still carrying it.
       */
      treeshake: {
        moduleSideEffects: (id) =>
          !/[\\/]src[\\/]world[\\/]proving[\\/]/.test(id),
      },
    },
  },
});
