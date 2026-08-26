/**
 * The two numbers the DEPTH FORMAT decides, and the rig that takes them.
 *
 * `main.ts` asks for `stencil: false`, which under WebGPU picks `depth32float`
 * rather than `depth24plus-stencil8` — and WebGPU defines `depthBias` in a
 * different unit for a float format (`r = 2^(exponent(the primitive's own
 * depth) - 23)`, against a constant for a normalised one). Everything in this
 * renderer that is stated in polygon-offset UNITS is therefore stated in a unit
 * that moves when that flag moves, and there are exactly two:
 *
 *  - `CelMaterialFactory.GLASS_DEPTH_UNITS` (-16), without which glazing past
 *    the far end of the map is not drawn at all;
 *  - `OutlineRenderer`'s own `setZOffset(-1)` / `setZOffsetUnits(-4)`, which is
 *    Babylon's default and is what both of `docs/rendering.md`'s outline
 *    GEOMETRY rules rest on — a walked surface needing real depth behind its
 *    top face, and nothing being laid on an inked surface.
 *
 * **Run this after anything that changes the depth format, and nothing else
 * re-derives these.** `bank.mjs` will not: a pane that has quietly stopped
 * being drawn at 180 m is not in any banked frame, and neither is a floor
 * seen at the grazing angle the offset is enormous at.
 *
 *     node plans/webgpu-ref/depth.mjs glass   [--units a,b] [--dists a,b] [--headed]
 *     node plans/webgpu-ref/depth.mjs zoffset [--deltas a,b] [--headed]
 *
 * ## What the two modes do, and the traps in each
 *
 * **`glass`** stands on a curtain wall's own normal, holds the on-screen size
 * still by moving `fov` with the distance, and reads how much of the sheet
 * survives the depth test. Three things had to be got right before it said
 * anything:
 *
 *  - **Hide the map down to the pane's OWN BUILDING, not by a radius.** A
 *    radius leaves a second wing of the same tower standing, and a blocked shot
 *    reads exactly like a pane that is not drawn — which is the failure this
 *    whole measurement exists to detect, arriving as a false positive.
 *  - **Tint the glass.** The question is whether the sheet is DRAWN, and a pane
 *    the colour of the concrete behind it answers that in tens of LSB where a
 *    tinted one answers it in hundreds. The reading is then a COUNT of the
 *    tinted pixels rather than a frame diff, which is what makes the far end
 *    legible: a wall at 220 m is either ~72% of the frame or ~0.6% of it.
 *  - **Pick the target by SHEET COUNT and not by a thin bounding box.** A
 *    tower's glazing wraps all four elevations, so the group is not a slab and
 *    a slab filter throws away every curtain wall on the map — it selected a
 *    3.3 m² shopfront and the sweep said nothing at all.
 *
 * **`zoffset`** is a ruler for the offset itself: two decks at a grazing angle,
 * a tinted one carrying the outline pass's exact offsets standing `delta`
 * metres BELOW a plain one. The tinted deck is visible exactly where the offset
 * beats `delta`, so the nearest range it reaches is the offset expressed in
 * world metres. Measured on `depth32float` it is close to linear in range at
 * about a millimetre per metre — 2 mm of separation is beaten from 2.9 m out,
 * 20 mm from 20.6 m, 50 mm from 61.7 m, and 150 mm is never beaten inside
 * 200 m. That single curve is what decides both geometry rules, and it is why
 * they no longer agree with each other: a road marking sits ~20 mm under its
 * slab's ink shell and is swallowed down the whole street, and a board deck's
 * shell sits 185 mm under its own top face and is not swallowed anywhere.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  bootMap,
  freeze,
  installRound,
  launchClient,
  root,
  settle,
  startDevServer,
  waitUntilDrawn,
} from "./harness.mjs";

const argv = process.argv.slice(2);
const MODE = argv.find((a) => !a.startsWith("--")) ?? "glass";
const HEADED = argv.includes("--headed");
const list = (flag, fallback) =>
  argv.includes(flag)
    ? argv[argv.indexOf(flag) + 1].split(",").map(Number)
    : fallback;

/** Frames are written here so a surprising row can be looked at rather than argued about. */
const OUT = join(root, "plans", "webgpu-ref", "ref", `depth-${MODE}`);
mkdirSync(OUT, { recursive: true });

/** Half-height of the framed region in metres — what holds the on-screen size. */
const FRAME_HALF_HEIGHT = 8;
/** Eye height and field of view for the `zoffset` ruler. */
const EYE = 1.65;
const FOV = 60;
const DECK_LEN = 200;

const vite = await startDevServer(root);
const browser = await launchClient({ headed: HEADED });

/** Counts a frame's tinted pixels — the tint is pure red, nothing else is. */
async function tintedShare(page, path) {
  writeFileSync(path, await page.screenshot({ type: "png" }));
  return path;
}

/** Decodes the written frames and reports each one's tinted share. */
async function gradeTinted(paths) {
  const grader = await chromium.launch({ headless: true });
  const page = await grader.newPage();
  const out = [];
  for (const { key, path } of paths) {
    const pct = await page.evaluate(async (src) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = src;
      });
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] - Math.max(d[i + 1], d[i + 2]) > 25) n++;
      }
      return +((n / (img.width * img.height)) * 100).toFixed(2);
    }, `data:image/png;base64,${readFileSync(path).toString("base64")}`);
    out.push({ ...key, pct });
  }
  await grader.close();
  return out;
}

if (MODE === "glass") {
  const UNITS = list("--units", [0, -4, -8, -12, -16, -24, -64]);
  const DISTS = list("--dists", [40, 90, 130, 180, 220, 260]);
  const { page, pageErrors, consoleErrors } = await bootMap(
    browser,
    vite.url,
    "coldharbour",
  );
  await installRound(page);
  await waitUntilDrawn(page);
  await settle(page, 6);
  await freeze(page);
  await settle(page, 6);

  // The biggest sheet count on the map, which is a tower's whole curtain wall.
  const target = await page.evaluate(() => {
    const g = window.__celshock;
    const rows = g.map.paneGroups.map((grp, i) => {
      const m = grp.mesh;
      m.computeWorldMatrix(true);
      const b = m.getBoundingInfo().boundingBox;
      return {
        i,
        mat: m.material.name,
        min: [b.minimumWorld.x, b.minimumWorld.y, b.minimumWorld.z],
        max: [b.maximumWorld.x, b.maximumWorld.y, b.maximumWorld.z],
        sheets: m.getTotalVertices() / 24,
      };
    });
    rows.sort((a, b) => b.sheets - a.sheets);
    return rows[0];
  });
  console.log(`target: ${target.mat} — ${target.sheets} sheets\n`);

  // Its own building and nothing else, tinted, with the open side found.
  const setup = await page.evaluate(
    ([gi, min, max]) => {
      const g = window.__celshock;
      const pane = g.map.paneGroups[gi].mesh;
      const pad = 3;
      const overlaps = (m) => {
        const b = m.getBoundingInfo().boundingBox;
        return (
          b.minimumWorld.x <= max[0] + pad &&
          b.maximumWorld.x >= min[0] - pad &&
          b.minimumWorld.y <= max[1] + pad &&
          b.maximumWorld.y >= min[1] - pad &&
          b.minimumWorld.z <= max[2] + pad &&
          b.maximumWorld.z >= min[2] - pad
        );
      };
      for (const m of g.map.visuals) m.setEnabled(m === pane || overlaps(m));
      for (const grp of g.map.paneGroups) {
        if (grp.mesh !== pane) grp.mesh.setEnabled(false);
      }
      const Colour = g.scene.ambientColor.constructor;
      pane.material.setColor3("baseColor", new Colour(1, 0, 0));
      if (pane.material.name.includes("-on-")) {
        pane.material.setColor3("glassBackdrop", new Colour(1, 0, 0));
      }
      const c = [
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2,
      ];
      const dirs = [
        [0, 0, 1],
        [0, 0, -1],
        [1, 0, 0],
        [-1, 0, 0],
      ];
      const blocked = dirs.map((n) => {
        let count = 0;
        for (const b of g.map.colliderBoxes) {
          const dx = b.x - c[0];
          const dz = b.z - c[2];
          const along = dx * n[0] + dz * n[2];
          const across = Math.abs(dx * n[2] - dz * n[0]);
          if (along > 2 && along < 60 && across < 10) count++;
        }
        return count;
      });
      return { centre: c, normal: dirs[blocked.indexOf(Math.min(...blocked))] };
    },
    [target.i, target.min, target.max],
  );

  const frames = [];
  for (const units of UNITS) {
    await page.evaluate(
      ([gi, u]) => {
        window.__celshock.map.paneGroups[gi].mesh.material.zOffsetUnits = u;
      },
      [target.i, units],
    );
    for (const dist of DISTS) {
      await page.evaluate(
        ([c, n, d, k]) => {
          const g = window.__celshock;
          const cam = g.cameraSys.camera;
          const Vec3 = cam.position.constructor;
          cam.position.set(c[0] + n[0] * d, c[1], c[2] + n[2] * d);
          cam.setTarget(new Vec3(c[0], c[1], c[2]));
          cam.fov = 2 * Math.atan(k / d);
          g.cameraSys.yaw = cam.rotation.y;
          g.cameraSys.pitch = cam.rotation.x;
          g.mats.updateCamera(cam.position);
          g.lighting.update(0.05, cam.position, g.mats);
        },
        [setup.centre, setup.normal, dist, FRAME_HALF_HEIGHT],
      );
      await waitUntilDrawn(page);
      await settle(page, 4);
      frames.push({
        key: { units, dist },
        path: await tintedShare(page, join(OUT, `u${units}-d${dist}.png`)),
      });
    }
  }
  console.log("pageErrors", pageErrors.length, "consoleErrors", consoleErrors.length);
  await browser.close();
  await vite.stop();

  const graded = await gradeTinted(frames);
  console.log("the pane's own share of the frame, %\n");
  console.log("units " + DISTS.map((d) => `${d} m`.padStart(8)).join(""));
  for (const u of UNITS) {
    const row = DISTS.map((d) => {
      const hit = graded.find((r) => r.units === u && r.dist === d);
      return String(hit ? hit.pct : "-").padStart(8);
    });
    console.log(String(u).padStart(5) + row.join(""));
  }
} else if (MODE === "zoffset") {
  const DELTAS = list("--deltas", [0.002, 0.005, 0.02, 0.05, 0.15, 0.5]);
  const { page } = await bootMap(browser, vite.url, "hollowmere");
  await installRound(page);
  await waitUntilDrawn(page);
  await settle(page, 6);
  await freeze(page);
  await settle(page, 6);
  // The app's OWN Babylon, by the url it was already loaded from — a second
  // copy mints classes the materials reject (`VERIFYING.md`).
  const babylon = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((n) => /babylonjs_core/i.test(n)),
  );

  const frames = [];
  for (const delta of DELTAS) {
    await page.evaluate(
      async ([url, d, len, eye, fov]) => {
        const B = await import(url);
        const g = window.__celshock;
        window.__depthRig?.forEach((m) => m.dispose());
        const top = 60;
        const src = g.scene.materials.find((m) => /^cel-#/.test(m.name));
        const deck = (name, y, colour, biased) => {
          const box = B.MeshBuilder.CreateBox(
            name,
            { width: 60, height: 2, depth: len },
            g.scene,
          );
          box.position.set(0, y - 1, len / 2 - 4);
          box.isPickable = false;
          box.material = src.clone(`${name}-mat`);
          box.material.setColor3("baseColor", colour);
          if (biased) {
            // Exactly what `OutlineRenderer.render` sets before its own draw.
            box.material.zOffset = -1;
            box.material.zOffsetUnits = -4;
          }
          return box;
        };
        window.__depthRig = [
          deck("depth-plain", top, new B.Color3(0.35, 0.35, 0.38), false),
          deck("depth-biased", top - d, new B.Color3(1, 0, 0), true),
        ];
        const cam = g.cameraSys.camera;
        cam.position.set(0, top + eye, -4);
        cam.setTarget(new B.Vector3(0, top, len));
        cam.fov = (fov * Math.PI) / 180;
        g.cameraSys.yaw = cam.rotation.y;
        g.cameraSys.pitch = cam.rotation.x;
        g.mats.updateCamera(cam.position);
        g.lighting.update(0.05, cam.position, g.mats);
      },
      [babylon, delta, DECK_LEN, EYE, FOV],
    );
    await waitUntilDrawn(page);
    await settle(page, 4);
    const path = join(OUT, `delta-${String(delta).replace(".", "_")}.png`);
    writeFileSync(path, await page.screenshot({ type: "png" }));
    frames.push({ delta, path });
  }
  await browser.close();
  await vite.stop();

  const grader = await chromium.launch({ headless: true });
  const gp = await grader.newPage();
  const H = 1080;
  const distForRow = (y) => {
    const t = ((y - H / 2) / (H / 2)) * Math.tan((FOV * Math.PI) / 360);
    return t <= 0 ? Infinity : EYE / t;
  };
  console.log("separation   the offset wins from\n");
  for (const f of frames) {
    const rows = await gp.evaluate(async (src) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = src;
      });
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      const out = new Array(img.height).fill(0);
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (d[i] - Math.max(d[i + 1], d[i + 2]) > 40) out[y]++;
        }
      }
      return out;
    }, `data:image/png;base64,${readFileSync(f.path).toString("base64")}`);
    let near = -1;
    for (let y = H - 1; y >= 0; y--) {
      if (rows[y] > 200) {
        near = y;
        break;
      }
    }
    console.log(
      `${String(f.delta).padStart(8)} m   ` +
        `${near < 0 ? `never, inside ${DECK_LEN} m` : `${distForRow(near).toFixed(1)} m`}`,
    );
  }
  await grader.close();
} else {
  console.error(`depth.mjs: unknown mode "${MODE}" — glass or zoffset`);
  await browser.close();
  await vite.stop();
  process.exitCode = 1;
}
