// Photograph a map in a live round from standing height — the check a plan
// cannot make: whether a street reads as a street, a hill as a hill, and
// whether a flag's approaches are what the layout meant.
//
// usage:
//   node .claude/skills/map-layout/scripts/views.mjs <map> --out <dir>
//     [--flags]            each flag from its own spawn and from 35 m on four bearings
//     [--viewfile v.json]  { "name": { "pos": [x, above, z], "target": [x, y, z], "fov": 75 } }
//                          `above` is metres over the floor at (x, z); `target` is absolute
//     [--only a,b]         just these names
//     [--bots]             leave the bots in (default: hidden, so the place is what is seen)
//
// With neither --flags nor --viewfile it takes --flags. Writes <dir>/<name>.jpg
// at 1280x720. Needs a GPU (see VERIFYING.md for this machine). The capture
// rings stay drawn on purpose: they are where the fight is.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadMap } from "./load.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? d : args[i + 1];
};
const id = args[0];
const outDir = opt("out");
if (!id || id.startsWith("--") || !outDir) {
  console.error("usage: views.mjs <map> --out <dir> [--flags] [--viewfile v.json] [--only a,b] [--bots]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const views = {};
if (opt("viewfile")) Object.assign(views, JSON.parse(readFileSync(opt("viewfile"), "utf8")));
if (args.includes("--flags") || !opt("viewfile")) {
  const { layout, floorAt } = await loadMap(id);
  for (const f of layout.controlPoints) {
    const aim = [f.pos.x, floorAt(f.pos.x, f.pos.z) + 2, f.pos.z];
    const own = layout.spawns.find((s) => s.controlPoint === f.id);
    if (own) views[`${f.id}-from-spawn`] = { pos: [own.pos.x, 1.7, own.pos.z], target: aim };
    for (const [name, dx, dz] of [["n", 0, 35], ["e", 35, 0], ["s", 0, -35], ["w", -35, 0]]) {
      views[`${f.id}-from-${name}`] = { pos: [f.pos.x + dx, 1.7, f.pos.z + dz], target: aim };
    }
  }
}
const only = opt("only") ? new Set(opt("only").split(",")) : null;

const { launchClient } = await import(pathToFileURL(join(ROOT, "scripts/browser.mjs")).href);
const { startDevServer } = await import(pathToFileURL(join(ROOT, "scripts/dev-server.mjs")).href);
const vite = await startDevServer(ROOT);
const browser = await launchClient({ headed: false });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.error(`  [page] ${e.message}`));
  await page.addInitScript((m) => window.localStorage.setItem("greywatch.map", m), id);
  await page.goto(vite.url, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "#hud{display:none!important}#boot{display:none!important}" });
  await page.waitForFunction(() => Boolean(window.__celshock), null, { timeout: 120_000 });
  await page.evaluate(async (bots) => {
    const g = window.__celshock;
    g.startRound();
    // `startRound` books the build two frames later; wait on the state.
    await new Promise((r) => {
      const poll = () => (g.state === "deploy" ? r() : setTimeout(poll, 50));
      poll();
    });
    if (!bots) for (const b of g.battle.bots) b.rig.root.setEnabled(false);
  }, args.includes("--bots"));
  for (const [name, v] of Object.entries(views)) {
    if (only && !only.has(name)) continue;
    await page.evaluate(async (v) => {
      const g = window.__celshock;
      const cam = g.cameraSys.camera;
      const V = cam.position.constructor;
      const [x, above, z] = v.pos;
      cam.position.set(x, g.map.terrain.surfaceAt(x, z, true) + above, z);
      cam.setTarget(new V(...v.target));
      cam.fov = ((v.fov ?? 75) * Math.PI) / 180;
      // The motion blur reprojects against these, and the deploy state pushes
      // neither the shader's eye nor the light slots for itself.
      g.cameraSys.yaw = cam.rotation.y;
      g.cameraSys.pitch = cam.rotation.x;
      g.mats.updateCamera(cam.position);
      g.lighting.update(0.05, cam.position, g.mats);
      // Ready first (WebGPU compiles pipelines lazily and presents nothing
      // until they exist), then a few frames for the shadow map and the post
      // chain to settle — capture-map-shots.mjs has the measurement.
      const until = (done) =>
        new Promise((res) => {
          const o = g.scene.onAfterRenderObservable.add(() => {
            if (!done()) return;
            g.scene.onAfterRenderObservable.remove(o);
            res();
          });
        });
      const giveUp = performance.now() + 120_000;
      await until(() => g.scene.isReady() || performance.now() > giveUp);
      let n = 0;
      await until(() => ++n >= 8);
    }, v);
    writeFileSync(join(outDir, `${name}.jpg`), await page.screenshot({ type: "jpeg", quality: 85 }));
    console.log(`  ${name}`);
  }
} finally {
  await browser.close();
  process.exit(0);
}
