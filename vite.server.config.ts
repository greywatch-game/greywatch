/**
 * vite.server.config.ts — Builds `server/` into `dist-server/`.
 *
 * Vite rather than `tsc` emitting to disk, because the shared `src/` tree does
 * not survive bare Node resolution: it imports without extensions,
 * `TerrainField.ts` reads `import.meta.env.DEV` (a Vite substitution that is
 * `undefined` under Node), and a map's collision bake and floor are lazy
 * `import()`s that are worth a chunk each.
 *
 * **The bundle carries no Babylon and loads none** (`BABYLON_EXIT.md` X2.3).
 * It used to import `@babylonjs/core` and `Engines/nullEngine.js` at runtime —
 * an SSR build leaves a dependency external — for a scene whose collider
 * meshes nothing read. The source gate is `scripts/check-babylon-free.mjs`,
 * run by `npm run build`; the `no-babylon` plugin below is the same rule at
 * the BUNDLER, so `npm run build:server` and `npm run simulate` refuse too.
 * It sees only what esbuild left after stripping types, so it is the runtime
 * truth where the gate is the stricter syntactic one.
 *
 * **There are TWO builds out of this file and the second one is a measuring
 * instrument.** `--mode development` emits to `dist-server-dev/` with
 * `import.meta.env.DEV` true, which is the only way the AUTHORITY can be run
 * on the DEV-only proving ground — `ENGINE_UPGRADE.md` S9, and
 * `npm run simulate:dev`. That directory is gitignored, is never deployed, and
 * is the one artefact directory `scripts/check-proving.mjs` does not scan.
 *
 * **`--mode development` alone does not do it, and the way it fails is silent.**
 * Vite pins `NODE_ENV` to `production` for every `build`, and it is NODE_ENV
 * rather than the mode that `isProduction` — and so `import.meta.env.DEV` — is
 * resolved from. The flag on its own gives a bundle that announces itself as a
 * development build, folds the DEV ternary in `src/world/maps.ts` to false all
 * the same, and answers a script that has just been told to run the proving
 * ground with "no map". The `define` below is what actually turns the flag
 * over, and the outDir moves with it so the two artefacts cannot be mistaken
 * for one another.
 *
 * Like `vite.config.ts`, this file is kept out of tsconfig's `include`.
 */
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [
    {
      name: "no-babylon",
      // Before Vite's own resolver, which marks a dependency EXTERNAL in an SSR
      // build without asking any later plugin.
      enforce: "pre" as const,
      resolveId(id: string, importer?: string) {
        if (/^@babylonjs\/core(?:\/|$)/.test(id)) {
          this.error(
            `${importer ?? "?"} imports "${id}": the authority imports no Babylon ` +
              "(BABYLON_EXIT.md X2.3). Run node scripts/check-babylon-free.mjs for the chain.",
          );
        }
        return null;
      },
    },
  ],
  // Written as a replacement rather than left to the mode, for the reason in
  // the header: `vite build` pins NODE_ENV to production and `isProduction`
  // reads that and not `mode`. `PROD` moves with it, so nothing downstream can
  // read the two and get opposite answers.
  define:
    mode === "development"
      ? { "import.meta.env.DEV": "true", "import.meta.env.PROD": "false" }
      : {},
  build: {
    ssr: true,
    outDir: mode === "development" ? "dist-server-dev" : "dist-server",
    emptyOutDir: true,
    target: "node20",
    minify: false,
    // Sourcemaps matter more here than in the client: a stack trace from a
    // bundled 5 MB server file is otherwise unreadable.
    sourcemap: true,
    rollupOptions: {
      // Four entries: the server proper, the headless round runner that is the
      // only way to watch the simulation with nobody connected to it, the
      // fingerprint dump that `npm run parity` diffs against a real browser
      // build, and `npm run corecheck` — the scoring rules asserted off the
      // core's events, offline and through `Match` (X2.5a C3). Only `index`
      // is deployed; the other three are instruments.
      input: {
        index: "server/index.ts",
        simulate: "server/simulate.ts",
        parity: "server/parity.ts",
        corecheck: "server/corecheck.ts",
      },
      // Runtime dependencies stay external; everything in `src/` is bundled so
      // the resolution problems above are settled at build time rather than at
      // import time. There is no Babylon to decide about (see the header).
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
}));
