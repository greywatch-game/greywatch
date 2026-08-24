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
    },
  },
});
