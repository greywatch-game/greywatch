/**
 * Starts a Vite dev server for a script to drive a real browser against, and
 * stops it reliably afterwards.
 *
 * Shared by `bake-collision.mjs` and `check-world-parity.mjs`, both of which
 * need a running game to read a built map out of.
 *
 * **Spawns the vite binary directly rather than going through `npx`.** `npx` is
 * a wrapper that execs vite as a CHILD, so killing the handle we hold kills the
 * wrapper and orphans the server: the port stays bound, the script's own
 * process never exits because a live child keeps the event loop open, and what
 * it looks like is the script hanging after printing its results. Skipping the
 * wrapper means the handle we hold IS the server. (`VERIFYING.md` has the
 * matching warning about clearing a stuck port by PID and never with
 * `pkill -f vite`, which matches the calling shell.)
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

/** Boots a dev server on an ephemeral port; resolves with its URL and a stop(). */
export async function startDevServer(root) {
  const bin = join(root, "node_modules", ".bin", "vite");
  const proc = spawn(bin, ["--port", "0"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("vite did not report a URL within 60 s")),
      60_000,
    );
    const scan = (buf) => {
      const m = /(http:\/\/localhost:\d+)/.exec(String(buf));
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    proc.stdout.on("data", scan);
    proc.stderr.on("data", scan);
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
