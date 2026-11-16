/**
 * The two numbers the DEPTH FORMAT decides, and the rig that takes them.
 *
 * `main.ts` asks for `stencil: false`, which under WebGPU picks `depth32float`
 * rather than `depth24plus-stencil8` — and WebGPU defines `depthBias` in a
 * different unit for a float format (`r = 2^(exponent(the primitive's own
 * depth) - 23)`, against a constant for a normalised one). Everything in this
 * renderer that is stated in polygon-offset UNITS is therefore stated in a unit
 * that moves when that flag moves, and there were exactly two:
 *
 *  - `CelMaterialFactory.GLASS_DEPTH_UNITS` (-16), without which glazing past
 *    the far end of the map is not drawn at all;
 *  - `OutlineRenderer`'s own `setZOffset(-1)` / `setZOffsetUnits(-4)`, which was
 *    Babylon's default and was what both of `docs/rendering.md`'s outline
 *    GEOMETRY rules rested on — a walked surface needing real depth behind its
 *    top face, and nothing being laid on an inked surface. No pass of this
 *    game draws at those offsets any more (the ink is a full-screen pass over
 *    the depth buffer, and the scene has not rendered since `BABYLON_EXIT.md`
 *    X5.4f), so the `zoffset` mode that measured them is RETIRED (below).
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
 *
 * **Both modes are Babylon meshes, and RETIRED with no scene** (X6.1a): the scene
 * is asked of the frame adapter (`harness.mjs`' `babylon()`), and a page with
 * none fails each mode with a sentence saying so; `glass` already owes a port
 * (a round's glazing is our renderer's since X4.6e, `FINDINGS.md` 69).
 * **`zoffset` is RETIRED outright** (X6.1c's review): its subject, the offsets
 * Babylon's `OutlineRenderer` drew the ink hull at, is no pass of this game
 * since the scene stopped rendering (X5.4f), and its rig cloned a cel
 * material, which is a `MaterialKey` of ours since X6.1c (no `clone`, no
 * `setColor3`). It throws before it starts anything, naming why. Its body —
 * the ruler the table above was taken with, Babylon meshes off the page's
 * copy of the package — went with the package (X6.1i); it stands at any tree
 * before it.
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
if (MODE === "zoffset") {
  throw new Error(
    "depth.mjs zoffset: RETIRED (BABYLON_EXIT.md X6.1c's review) — it measured the offsets Babylon's OutlineRenderer drew the ink hull at, which no pass of this game draws since the scene stopped rendering (X5.4f), and its rig clones a Babylon cel material, which is a MaterialKey of ours since X6.1c",
  );
}
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
  // **This mode reads Babylon's glazing MESHES, and a round has none since
  // `BABYLON_EXIT.md` X4.6e**: its panes are our renderer's (`GlassDraw`),
  // their bias pipeline state (`GLASS_DEPTH_BIAS`) and their walls ours since
  // X3.7b (which `map.visuals` no longer holds). It owes a port; until then it
  // says so rather than measuring nothing.
  const target = await page.evaluate(() => {
    const g = window.__celshock;
    if (g.map.paneGroups.some((grp) => !grp.mesh)) {
      throw new Error("depth.mjs glass: a round's glazing is our renderer's since BABYLON_EXIT.md X4.6e, and this mode reads Babylon's meshes — it owes a port");
    }
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
      // Babylon's scene through the frame adapter (`harness.mjs`, X6.1a): this
      // mode is Babylon's meshes, RETIRED with no scene.
      const B = window.__refFrame().babylon();
      if (!B) throw new Error("depth.mjs glass: no scene — this mode reads Babylon's meshes (retired, BABYLON_EXIT.md X6.1a)");
      const Colour = B.scene.ambientColor.constructor;
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
} else {
  console.error(`depth.mjs: unknown mode "${MODE}" — glass or zoffset`);
  await browser.close();
  await vite.stop();
  process.exitCode = 1;
}
