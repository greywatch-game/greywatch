// Photograph one placement from vantages in its own frame, and count what a
// builder emits.
//
// usage:
//   node .claude/skills/model-detail/scripts/shots.mjs --map greyfen --at 80,34,0 --out <dir>
//     [--r 14]              ring radius for the default views (metres)
//     [--views sun,shade]   which views to take (default: all)
//     [--viewfile v.json]   extra views: { "name": { "cam": [x,y,z], "tgt": [x,y,z] } }
//                           in the placement's LOCAL frame, y above its ground
//     [--stats kind]        also build `kind` in the page and report parts,
//     [--params '{..}']     vertices and colliders (repeat --params per variant)
//     [--keep-zones]        leave the capture ring and flag drawn
//
// The default views: `sun` stands on the side the key light comes FROM, so
// the faces it shows are lit — the one to judge detail by — and `shade` is
// the opposite side, the one to judge a silhouette by. `ne`/`nw`/`se`/`sw`
// ring the placement, `close` is half the radius on the sun side, and `air`
// is a high oblique. Local +Z is the placement's north before its rotation.
//
// Needs a GPU (see VERIFYING.md). Writes <out>/<view>.jpg.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const H = await import(pathToFileURL(join(ROOT, "plans/webgpu-ref/harness.mjs")).href);

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? d : args[i + 1];
};
const all = (k) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []));
const map = opt("map");
const at = opt("at");
if (!map || !at) {
  console.error("usage: shots.mjs --map <id> --at x,z[,rotY] --out <dir> [...]");
  process.exit(1);
}
const [px, pz, rot = 0] = at.split(",").map(Number);
const out = opt("out", "shots");
const R = Number(opt("r", 14));
mkdirSync(out, { recursive: true });

const extra = opt("viewfile") ? JSON.parse(readFileSync(opt("viewfile"), "utf8")) : {};
const want = opt("views")?.split(",");
const statsKind = opt("stats");
const variants = all("params").map((s) => JSON.parse(s));
if (statsKind && !variants.length) variants.push({});

const server = await H.startDevServer(ROOT);
const browser = await H.launchClient({ headless: true });
try {
  const { page, pageErrors, consoleErrors } = await H.bootMap(browser, server.url, map);
  await H.installRound(page);
  await H.waitUntilDrawn(page);
  await H.settle(page, 10);

  if (statsKind) {
    const stats = await page.evaluate(async ({ kind, variants }) => {
      const g = window.__celshock;
      const kit = await import("/src/world/BuildingKit.ts");
      const out = [];
      for (const p of variants) {
        const s = kit.BUILDERS[kind](g.scene, g.mats, p);
        let verts = 0;
        const colours = new Set();
        for (const m of s.meshes) {
          verts += m.getTotalVertices();
          colours.add(m.material?.name ?? "?");
        }
        out.push({ params: p, parts: s.meshes.length, verts, colours: colours.size, colliders: s.colliders.length, lights: s.lights.length });
        for (const m of s.meshes) m.dispose();
      }
      return out;
    }, { kind: statsKind, variants });
    for (const s of stats) console.log("STATS", JSON.stringify(s));
  }

  // The views, resolved in the page because the sun's bearing lives there.
  const views = await page.evaluate(({ R, extra }) => {
    const g = window.__celshock;
    const sun = g.scene.getLightByName("moonShadow")?.direction;
    // Horizontal bearing the light comes FROM, in world XZ.
    let sx = sun ? -sun.x : 0.7;
    let sz = sun ? -sun.z : 0.7;
    const l = Math.hypot(sx, sz) || 1;
    sx /= l;
    sz /= l;
    return { sun: [sx, sz], extra };
  }, { R, extra });
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // World bearing -> local: MapBuilder turns local +X onto (cos, -sin), +Z onto (sin, cos).
  const toLocal = ([wx, wz]) => [wx * c - wz * s, wx * s + wz * c];
  const [lx, lz] = toLocal(views.sun);
  const T = [0, 1.6, 0];
  const V = {
    sun: { cam: [lx * R, 1.8, lz * R], tgt: T },
    shade: { cam: [-lx * R, 1.8, -lz * R], tgt: T },
    close: { cam: [lx * R * 0.45, 1.7, lz * R * 0.45], tgt: [0, 1.4, 0] },
    ne: { cam: [R * 0.7, 1.8, R * 0.7], tgt: T },
    nw: { cam: [-R * 0.7, 1.8, R * 0.7], tgt: T },
    se: { cam: [R * 0.7, 1.8, -R * 0.7], tgt: T },
    sw: { cam: [-R * 0.7, 1.8, -R * 0.7], tgt: T },
    air: { cam: [lx * R * 1.3, R * 0.8, lz * R * 1.3], tgt: [0, 0.5, 0] },
    ...views.extra,
  };
  const names = want ?? Object.keys(V);
  const keepZones = args.includes("--keep-zones");
  for (const name of names) {
    const v = V[name];
    if (!v) {
      console.log("no view", name);
      continue;
    }
    await page.evaluate(({ px, pz, rot, v, keepZones }) => {
      const g = window.__celshock;
      for (const bot of g.battle.bots) bot.rig.root.setEnabled(false);
      if (!keepZones) g.zones?.dispose?.();
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
      cam.fov = (70 * Math.PI) / 180;
      g.cameraSys.yaw = cam.rotation.y;
      g.cameraSys.pitch = cam.rotation.x;
      g.mats.updateCamera(cam.position);
      g.lighting.update(0.05, cam.position, g.mats);
      g.shadows.invalidate();
      g.shadows.update(cam.position, g.mats);
    }, { px, pz, rot, v, keepZones });
    await H.settle(page, 8);
    await page.evaluate(() => {
      const g = window.__celshock;
      g.shadows.invalidate();
      g.shadows.update(g.cameraSys.camera.position, g.mats);
    });
    await H.settle(page, 4);
    const jpg = await page.screenshot({ type: "jpeg", quality: 88, timeout: 120_000 });
    writeFileSync(join(out, `${name}.jpg`), jpg);
    console.log("shot", name, JSON.stringify(v));
  }
  if (pageErrors.length) console.log("PAGE ERRORS", pageErrors);
  if (consoleErrors.length) console.log("CONSOLE ERRORS", consoleErrors.slice(0, 10));
} finally {
  await browser.close();
  server.stop();
}
