// Frame rate, uncapped, at vantages round one placement — run once on the
// change and once on HEAD (git stash) and compare.
//
// usage:
//   node .claude/skills/model-detail/scripts/perf.mjs --map greyfen --at 80,34,0
//     [--r 14]              ring radius for the default vantages
//     [--viewfile v.json]   vantages instead: { "name": { "cam": [..], "tgt": [..] } }
//                           in the placement's local frame, y above its ground
//
// Prints the install time, the scene's vertex count, and per vantage the frame
// rate (4 s warm-up, 8 s counted) and the active mesh count. Run-to-run spread
// on one box is about 3%; a change inside that is no change. Needs a GPU.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const H = await import(pathToFileURL(join(ROOT, "plans/webgpu-ref/harness.mjs")).href);
const { chromium } = await import(pathToFileURL(join(ROOT, "node_modules/playwright/index.mjs")).href);

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? d : args[i + 1];
};
const map = opt("map");
const at = opt("at");
if (!map || !at) {
  console.error("usage: perf.mjs --map <id> --at x,z[,rotY] [--r 14] [--viewfile v.json]");
  process.exit(1);
}
const [px, pz, rot = 0] = at.split(",").map(Number);
const R = Number(opt("r", 14));
const V = opt("viewfile")
  ? JSON.parse(readFileSync(opt("viewfile"), "utf8"))
  : {
      outside: { cam: [0, 1.7, -R], tgt: [0, 1.8, 0] },
      close: { cam: [R * 0.3, 1.7, -R * 0.3], tgt: [0, 1.6, 0] },
      across: { cam: [-R * 0.7, 2.2, R * 0.7], tgt: [0, 1.4, 0] },
    };

const server = await H.startDevServer(ROOT);
const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: ["--enable-unsafe-webgpu", "--disable-frame-rate-limit", "--disable-gpu-vsync"],
});
try {
  const { page } = await H.bootMap(browser, server.url, map);
  const t0 = Date.now();
  await H.installRound(page);
  const installMs = Date.now() - t0;
  await H.waitUntilDrawn(page);
  const verts = await page.evaluate(() => window.__celshock.scene.getTotalVertices());
  console.log(`install ${installMs} ms; scene vertices ${verts}`);
  for (const [name, v] of Object.entries(V)) {
    await page.evaluate(({ px, pz, rot, v }) => {
      const g = window.__celshock;
      for (const bot of g.battle.bots) bot.rig.root.setEnabled(false);
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const W = (p) => [px + p[0] * c + p[2] * s, p[1], pz - p[0] * s + p[2] * c];
      const base = g.map.terrain.heightAt(px, pz);
      const cam = g.cameraSys.camera;
      const Vec3 = cam.position.constructor;
      const [cx, cy, cz] = W(v.cam);
      const [tx, ty, tz] = W(v.tgt);
      cam.position.set(cx, base + cy, cz);
      cam.setTarget(new Vec3(tx, base + ty, tz));
      g.cameraSys.yaw = cam.rotation.y;
      g.cameraSys.pitch = cam.rotation.x;
      g.mats.updateCamera(cam.position);
      g.lighting.update(0.05, cam.position, g.mats);
    }, { px, pz, rot, v });
    const fps = await page.evaluate(async () => {
      const count = (ms) =>
        new Promise((res) => {
          let n = 0;
          const t0 = performance.now();
          const f = () => {
            n++;
            if (performance.now() - t0 < ms) requestAnimationFrame(f);
            else res(n / ((performance.now() - t0) / 1000));
          };
          requestAnimationFrame(f);
        });
      await count(4000);
      return count(8000);
    });
    const active = await page.evaluate(() => window.__celshock.scene.getActiveMeshes().length);
    console.log(`${name.padEnd(10)} fps ${fps.toFixed(1)}  active ${active}`);
  }
} finally {
  await browser.close();
  server.stop();
}
