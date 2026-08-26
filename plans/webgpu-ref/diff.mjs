/**
 * Compares two PNGs and says how much, and where, they differ — as a CLI and
 * as the function `bank.mjs --check` grades itself with.
 *
 * Run with `node plans/webgpu-ref/diff.mjs a.png b.png [--tiles]`.
 *
 * **The bank cannot be used without this.** Byte equality answers "is this
 * frame reproducible", which is the right question when taking a bank and the
 * wrong one when checking against it. A WGSL landing that moves 0.3/255 on 4%
 * of pixels and one that inverts the sky are both "differs"; only a magnitude
 * tells them apart, and `docs/rendering.md` already quotes its regression
 * thresholds in exactly these units.
 *
 * **The browser is the PNG decoder, which is deliberate.** There is no image
 * library in this tree and adding one to compare two screenshots would be a
 * dependency bought for a diff. Chromium is already a devDependency and
 * already decoding these files; loading both as data URLs and reading them
 * back off a 2D canvas costs one page and needs no GPU at all, so unlike
 * everything else beside this file it runs on any machine — the default
 * headless shell included.
 *
 * **`--tiles` is for the case where the number is not the finding.** A mean of
 * 1.7/255 spread evenly over the frame is a dither change; the same mean
 * concentrated in a 16th of the picture is one object drawn wrong. The grid is
 * 16x9 over the frame and prints the worst tiles, which is usually enough to
 * name the thing that moved before opening either image. It is what located
 * the third wind clock: the worst tiles sat on Hollowmere's graveyard grass
 * and Harrowmead's market green, and nowhere else.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

/**
 * How far two grabs of the SAME frozen frame may drift between processes
 * before `bank.mjs --check` calls it a regression, in mean absolute 8-bit
 * channel error over the whole frame.
 *
 * **The floor is ZERO, and it took two goes to get there.** All sixteen banked
 * frames come back byte-identical across processes, on all four maps — the
 * same property the write path already demanded of two grabs inside ONE
 * process. It was not always so, and neither of the two things in the way was
 * a clock: a lantern's flicker PHASE was `Math.random() * 100` per fixture at
 * map build (seeded in `LightingSystem` now), and a cube probe is refresh-ONCE
 * and had already been baked before anything was pinned, so the water and the
 * glazing went on reflecting a world that was never frozen. Measured before those were fixed, the residue
 * was 0.00 on the two maps with no lamps, up to 1.0/255 on a lamp-lit street
 * and 0.72/255 on a marsh that is half water — and the number this constant
 * used to hold, 0.35, was set from the largest of those that had happened to
 * be seen. **A tolerance is what a floor is not**: the earlier one was
 * measuring two bugs and calling them noise, and it passed a bank that was
 * genuinely different every run.
 *
 * **So this is slack and not a floor**, kept small deliberately. It allows
 * about 2% of pixels to move by one LSB, which is where a driver update or a
 * texture-upload race would land, and it sits a full order below the 0.63/255
 * FINDINGS #12 treats as a real picture change. **If it ever starts crying
 * wolf, the answer is to find the unpinned thing and not to raise the number**
 * — that has now been the answer twice.
 */
export const CHECK_TOLERANCE = 0.02;

const asDataUrl = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;

/**
 * Decodes both files and measures the difference.
 *
 * Takes an optional open `browser` so a caller comparing several pairs pays
 * for one launch rather than one per pair.
 */
export async function comparePngs(pathA, pathB, { tiles = false, browser = null } = {}) {
  const own = browser ?? (await chromium.launch({ headless: true }));
  const page = await own.newPage();
  try {
    return await page.evaluate(
      async ([srcA, srcB, wantTiles]) => {
        const load = (src) =>
          new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = () => rej(new Error("could not decode a PNG"));
            img.src = src;
          });
        const [ia, ib] = await Promise.all([load(srcA), load(srcB)]);
        if (ia.width !== ib.width || ia.height !== ib.height) {
          return { sizeMismatch: [ia.width, ia.height, ib.width, ib.height] };
        }
        const pixels = (img) => {
          const c = new OffscreenCanvas(img.width, img.height);
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, img.width, img.height).data;
        };
        const pa = pixels(ia);
        const pb = pixels(ib);
        const w = ia.width;
        const h = ia.height;
        const TX = 16;
        const TY = 9;
        const grid = Array.from({ length: TX * TY }, () => ({ n: 0, sum: 0, px: 0 }));
        let differing = 0;
        let sum = 0;
        let max = 0;
        for (let y = 0; y < h; y++) {
          const ty = Math.min(TY - 1, Math.floor((y * TY) / h));
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const dr = Math.abs(pa[i] - pb[i]);
            const dg = Math.abs(pa[i + 1] - pb[i + 1]);
            const db = Math.abs(pa[i + 2] - pb[i + 2]);
            const cell = grid[ty * TX + Math.min(TX - 1, Math.floor((x * TX) / w))];
            cell.px++;
            if (dr || dg || db) {
              differing++;
              sum += dr + dg + db;
              cell.n++;
              cell.sum += dr + dg + db;
              const worst = Math.max(dr, dg, db);
              if (worst > max) max = worst;
            }
          }
        }
        const total = w * h;
        const out = {
          w,
          h,
          pctPixels: +((differing / total) * 100).toFixed(4),
          meanAbs: +(sum / (total * 3)).toFixed(4),
          max,
        };
        if (wantTiles) {
          out.tiles = grid
            .map((c, i) => ({
              col: i % TX,
              row: Math.floor(i / TX),
              pct: +((c.n / c.px) * 100).toFixed(1),
              mean: +(c.sum / (c.px * 3)).toFixed(3),
            }))
            .filter((t) => t.pct > 0)
            .sort((x, y2) => y2.mean - x.mean)
            .slice(0, 12);
        }
        return out;
      },
      [asDataUrl(pathA), asDataUrl(pathB), tiles],
    );
  } finally {
    await page.close();
    if (!browser) await own.close();
  }
}

// --- CLI -------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const wantTiles = args.includes("--tiles");
  const [a, b] = args.filter((x) => !x.startsWith("--"));
  if (!a || !b) {
    console.error("usage: node plans/webgpu-ref/diff.mjs a.png b.png [--tiles]");
    process.exit(2);
  }
  const out = await comparePngs(a, b, { tiles: wantTiles });
  if (out.sizeMismatch) {
    const [aw, ah, bw, bh] = out.sizeMismatch;
    console.error(`size mismatch: ${aw}x${ah} vs ${bw}x${bh}`);
    process.exit(2);
  }
  console.log(
    `${out.w}x${out.h}  ${out.pctPixels}% of pixels differ  ` +
      `mean ${out.meanAbs}/255  worst channel ${out.max}/255  ` +
      `(tolerance ${CHECK_TOLERANCE})`,
  );
  if (out.tiles) {
    console.log("\nworst tiles (16x9 grid, col/row from top-left):");
    for (const t of out.tiles) {
      console.log(
        `  col ${String(t.col).padStart(2)} row ${t.row}  ` +
          `${String(t.pct).padStart(5)}% of tile  mean ${t.mean}/255`,
      );
    }
  }
  process.exit(out.meanAbs > CHECK_TOLERANCE ? 1 : 0);
}
