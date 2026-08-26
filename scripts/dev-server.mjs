/**
 * Starts a Vite dev server for a script to drive a real browser against, and
 * stops it reliably afterwards.
 *
 * Shared by `bake-collision.mjs`, `check-world-parity.mjs`,
 * `capture-map-shots.mjs` and the WebGPU harness under `plans/webgpu-ref/`,
 * all of which need a running game to read a built map out of.
 *
 * **Spawns NODE on vite's own entry rather than going through `npx` or the
 * `.bin` shim, and the two reasons are different.** `npx` is a wrapper that
 * execs vite as a CHILD, so killing the handle we hold kills the wrapper and
 * orphans the server: the port stays bound, the script's own process never
 * exits because a live child keeps the event loop open, and what it looks like
 * is the script hanging after printing its results. (`VERIFYING.md` has the
 * matching warning about clearing a stuck port by PID and never with
 * `pkill -f vite`, which matches the calling shell.)
 *
 * **`node_modules/.bin/vite` has the same problem and one more on Windows.**
 * The extensionless file there is a shell script, which `spawn` cannot exec at
 * all — the whole of this repo's browser tooling failed as `spawn ... ENOENT`
 * on the first Windows checkout. The `.cmd` shim next to it runs, but it runs
 * vite as a child of `cmd.exe`, which is the orphaning above wearing a
 * different hat. Spawning `process.execPath` on `vite.js` is the only form
 * where the handle we hold IS the server, and it is that on every platform.
 *
 * **The URL is scanned with the ANSI stripped first, and that is not
 * cosmetic.** Vite colours its banner, and the colouring lands INSIDE the URL
 * — `http://localhost:` in cyan, then the port in bold — so a regex looking
 * for `localhost:\d+` matches the raw bytes on a machine where vite decided
 * not to colour and misses on one where it did. What that failure looks like
 * is this function timing out after sixty seconds against a dev server that
 * started perfectly and is printing its URL to a pipe nobody could parse.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

/** Everything between an ESC and its terminating `m`, which is what vite colours with. */
const ANSI = /\u001b\[[0-9;]*m/g;

/** Boots a dev server on an ephemeral port; resolves with its URL and a stop(). */
export async function startDevServer(root) {
  const entry = join(root, "node_modules", "vite", "bin", "vite.js");
  const proc = spawn(process.execPath, [entry, "--port", "0"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("vite did not report a URL within 60 s")),
      60_000,
    );
    const scan = (buf) => {
      const m = /(http:\/\/localhost:\d+)/.exec(String(buf).replace(ANSI, ""));
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    proc.stdout.on("data", scan);
    proc.stderr.on("data", scan);
    proc.on("error", reject);
    proc.on("exit", (code) =>
      reject(new Error(`vite exited with ${code} before serving`)),
    );
  });

  return {
    url,
    stop() {
      proc.kill("SIGTERM");
    },
  };
}
