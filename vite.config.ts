/**
 * vite.config.ts — Dev-server plumbing for the map editor, and nothing else.
 *
 * NOTE: this file is deliberately kept OUT of tsconfig.json's `include`
 * (which is ["src", "main.ts"]), so `node:fs` here does not have to typecheck
 * against a browser compile. The trade is that this file is not typechecked —
 * so it stays trivial, and all the real logic lives in src/editor/serialize.ts
 * where the compiler does cover it.
 *
 * That guarantee used to rest on @types/node simply not being installed. It is
 * installed now, for `server/`, so the root tsconfig pins `"types": []`
 * instead: the browser compile still sees no Node globals, and the reason is
 * now written down rather than being a happy accident of the dependency list.
 * `server/tsconfig.json` opts back in. See `server/README.md`.
 *
 * The plugin is `apply: "serve"`, so it does not exist in a production build.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * The only files the editor may write, as a LITERAL table — one group per map.
 * Compared, never used to build a path. `layout.ts` is patched line by line and
 * must look like a layout; `heights.ts` is regenerated wholesale by terrain mode
 * and must look like a heightfield; `environment.ts` is patched one key at a
 * time by the floor picker and must look like a spec.
 *
 * Deliberately not derived from a directory listing or matched with a regex,
 * however repetitive three entries per map becomes: path safety here comes from
 * the client's path only ever being LOOKED UP in this object, and anything that
 * computes the set of writable files trades that guarantee for convenience in
 * the one tool here whose whole job is writing to disk. A new map adds three
 * lines.
 */
const WRITABLE = {
  "src/world/hollowmere/layout.ts": {
    min: 4000,
    marker: "export const HollowmereLayout",
  },
  "src/world/hollowmere/heights.ts": {
    min: 500,
    marker: "export const HollowmereHeights",
  },
  "src/world/hollowmere/environment.ts": {
    min: 1200,
    marker: "export const HollowmereEnvironment",
  },
  "src/world/greyfen/layout.ts": {
    min: 4000,
    marker: "export const GreyfenLayout",
  },
  "src/world/greyfen/heights.ts": {
    min: 500,
    marker: "export const GreyfenHeights",
  },
  "src/world/greyfen/environment.ts": {
    min: 1200,
    marker: "export const GreyfenEnvironment",
  },
  "src/world/coldharbour/layout.ts": {
    min: 4000,
    marker: "export const ColdharbourLayout",
  },
  "src/world/coldharbour/heights.ts": {
    min: 500,
    marker: "export const ColdharbourHeights",
  },
  "src/world/coldharbour/environment.ts": {
    min: 1200,
    marker: "export const ColdharbourEnvironment",
  },
  "src/world/harrowmead/layout.ts": {
    min: 4000,
    marker: "export const HarrowmeadLayout",
  },
  "src/world/harrowmead/heights.ts": {
    min: 500,
    marker: "export const HarrowmeadHeights",
  },
  "src/world/harrowmead/environment.ts": {
    min: 1200,
    marker: "export const HarrowmeadEnvironment",
  },
};

/**
 * One spelling for a path, so both sides of `selfWritten` agree.
 *
 * `resolve` returns the platform's own separators — on Windows
 * `C:\...\layout.ts` — while Vite normalises the `ctx.file` it hands
 * `handleHotUpdate` to POSIX ones, `C:/.../layout.ts`. A Set keyed on one and
 * probed with the other never matches, and the swallow below silently stops
 * swallowing: nothing throws, but every Ctrl+S full-reloads the page and takes
 * the editing session, the camera and the selection with it, which reads as the
 * editor crashing on save rather than as a path bug. Normalising BOTH sides
 * rather than adopting Vite's spelling means neither can drift from the other.
 */
const norm = (p: string) => p.replace(/\\/g, "/");

function layoutWriter(): Plugin {
  // Forward slashes reach `node:fs` fine on Windows, so the write path can be
  // the normalised one too and there is only ever one form in flight.
  const absOf = (rel: string) => norm(resolve(process.cwd(), rel));
  const selfWritten = new Set();

  return {
    name: "hollowmere-layout-writer",
    apply: "serve",

    configureServer(server) {
      server.middlewares.use("/__layout", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const { path, source } = JSON.parse(body);
            // Path safety by construction: the client's path is only ever
            // LOOKED UP in a literal table. It never reaches the filesystem as
            // given, so traversal is not possible regardless of what was sent.
            const rule = Object.prototype.hasOwnProperty.call(WRITABLE, path)
              ? WRITABLE[path]
              : null;
            if (!rule) {
              throw new Error(`refusing to write ${path}`);
            }
            // Cheap sanity gates against writing a truncated or wrong file.
            if (typeof source !== "string" || source.length < rule.min) {
              throw new Error(`payload too small to be ${path}`);
            }
            if (!source.includes(rule.marker)) {
              throw new Error(`payload is missing ${rule.marker}`);
            }
            const abs = absOf(path);
            selfWritten.add(abs);
            writeFileSync(abs, source, "utf8");
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, bytes: source.length }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });
    },

    handleHotUpdate(ctx) {
      // None of the three files has import.meta.hot.accept, so an update
      // propagates all the way to main.ts, finds no accepting module, and
      // full-reloads the page — losing the camera, the selection, and the
      // editing session, on every save. Swallow the editor's OWN writes. A
      // manual edit in the editor of your choice still reloads, which is what
      // you want. Both sides go through `norm`; see its note.
      const file = norm(ctx.file);
      if (selfWritten.has(file)) {
        selfWritten.delete(file);
        return [];
      }
    },
  };
}

/**
 * Emits `dist/sw.js` from the template at `src/pwa/sw.js`, with `__PRECACHE__`
 * replaced by a manifest of everything the build produced.
 *
 * It runs in `writeBundle` and walks `dist/` on disk rather than reading the
 * Rollup bundle, for two reasons: `index.html` and the copied `public/` files
 * are not both reliably in the bundle object at any one hook, and what the
 * worker must precache is exactly "the files that were deployed".
 *
 * The version is a hash of every file's NAME AND CONTENTS. Hashing the names
 * alone looks sufficient — Vite content-hashes the asset filenames — but
 * `index.html` is the one unhashed file, and this project keeps the whole HUD
 * stylesheet inside it. A change there would otherwise leave the worker's
 * bytes identical, and a byte-identical worker is one the browser never
 * updates: the old HUD would be served from cache forever.
 *
 * **The manifest is split in TWO, and the split is what the worker's install is
 * built on.** `immutable` is everything Vite content-hashed into `/assets/`, so
 * a URL there names its own bytes and a copy already sitting in any cache — the
 * standing build's, or an interrupted install's — is by construction the right
 * one and is copied rather than downloaded. `mutable` is the handful of files
 * whose URL is a contract with something outside the build and says nothing
 * about their contents (`index.html`, the manifest, the icons), which are
 * always refetched. Emitting the two lists here rather than testing the prefix
 * in `sw.js` keeps the knowledge of where Vite puts hashed output in the file
 * that configures Vite. See the install handler in `src/pwa/sw.js`.
 *
 * `regions.json` is emitted by the build and deliberately NOT precached: the
 * worker's fetch handler is network-only for it (a deployer edits it on the box
 * to drain a region), so a precached copy is an entry nothing can ever read. It
 * still counts toward the version hash, which is a claim about the build's
 * output rather than about the precache.
 */
function serviceWorker(): Plugin {
  const walk = (dir: string, root: string) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) return walk(abs, root);
      return [relative(root, abs).split("\\").join("/")];
    });

  return {
    name: "hollowmere-service-worker",
    apply: "build",

    writeBundle(options) {
      const outDir = options.dir ?? resolve(process.cwd(), "dist");
      // Source maps are a debugging aid nobody loads offline, and the worker
      // itself is not something the worker caches.
      const files = walk(outDir, outDir)
        .filter((f) => f !== "sw.js" && !f.endsWith(".map"))
        .sort();

      const hash = createHash("sha256");
      for (const file of files) {
        hash.update(file);
        hash.update(readFileSync(join(outDir, file)));
      }

      // Vite's own `build.assetsDir`, which is where the content hashes are.
      const HASHED = "assets/";
      const cached = files.filter((f) => f !== "regions.json");

      const manifest = {
        version: hash.digest("hex").slice(0, 12),
        immutable: cached.filter((f) => f.startsWith(HASHED)).map((f) => `/${f}`),
        // "/" is the URL a launch actually asks for; index.html is the same
        // bytes under the name the deploy wrote. The worker's navigation
        // handler looks up "/", so it has to be a precached key in its own
        // right rather than a redirect the cache knows nothing about.
        mutable: [
          "/",
          ...cached.filter((f) => !f.startsWith(HASHED)).map((f) => `/${f}`),
        ],
      };

      const template = readFileSync(
        resolve(process.cwd(), "src/pwa/sw.js"),
        "utf8",
      );
      // The whole declaration is the anchor, not the placeholder alone: the
      // file's header comment names the placeholder too, and a plain string
      // replace substitutes the manifest into the prose instead of the code.
      const decl = /^const PRECACHE = __PRECACHE__;$/m;
      if (!decl.test(template)) {
        throw new Error("src/pwa/sw.js is missing its PRECACHE declaration");
      }
      writeFileSync(
        join(outDir, "sw.js"),
        template.replace(
          decl,
          `const PRECACHE = ${JSON.stringify(manifest, null, 2)};`,
        ),
        "utf8",
      );
    },
  };
}

export default defineConfig({
  plugins: [layoutWriter(), serviceWorker()],

  optimizeDeps: {
    // Havok's glue loads its .wasm from a URL resolved against its OWN
    // module location. The dep optimizer rewrites that location — it copies
    // the glue into node_modules/.vite/deps/ and leaves the 2 MB binary
    // behind — so the URL 404s, the dev server's SPA fallback answers with
    // index.html, and the loader gets a page where it wanted a module.
    //
    // The symptom names the wrong culprit twice over: first "Incorrect
    // response MIME type. Expected 'application/wasm'" (it is text/html),
    // then "expected magic word 00 61 73 6d, found 3c 21 64 6f" — which is
    // `<!do`, the start of the HTML. Neither is a MIME configuration problem
    // and no amount of server MIME tuning fixes it.
    //
    // Excluding it leaves the glue served from its real node_modules path,
    // where the .wasm is its actual sibling. DEV ONLY: a production build
    // resolves the asset itself and content-hashes it into dist/assets, which
    // is why `vite preview` works with or without this and testing there
    // alone will not catch a regression here.
    exclude: ["@babylonjs/havok"],
  },
});
