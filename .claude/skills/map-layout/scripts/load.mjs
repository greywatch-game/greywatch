// Load one map's layout, floor, water and road network in Node — the shared
// half of audit.mjs and plan.mjs. No browser, no GPU.
//
// `layout.ts` and `heights.ts` are imported straight out of `src/` by type
// stripping (Node 24), which is why this works on every map: each layout's only
// value import is `Vector3`. The road network is the game's own
// (`src/world/roadPaths.ts`), so "on a road" means what it means in a round.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const src = (...p) => pathToFileURL(join(ROOT, "src", ...p)).href;

/** Map ids with a layout on disk (the dev-only proving ground included). */
export function mapIds() {
  return readdirSync(join(ROOT, "src", "world"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "kit")
    .map((d) => d.name)
    .filter((id) => {
      try {
        return readdirSync(join(ROOT, "src", "world", id)).includes("layout.ts");
      } catch {
        return false;
      }
    });
}

/** Default surface of a `WaterRect` that states no `y` (`CONFIG.water.surfaceY`). */
const WATER_SURFACE = 0.32;

export async function loadMap(id) {
  const layoutMod = await import(src("world", id, "layout.ts"));
  const layout = Object.entries(layoutMod).find(([k]) => k.endsWith("Layout"))?.[1];
  if (!layout) throw new Error(`no *Layout export in src/world/${id}/layout.ts`);
  const heightsMod = await import(src("world", id, "heights.ts"));
  const field = heightsMod.default;
  const { roadNetwork } = await import(src("world", "roadPaths.ts"));
  const { onRoad } = await import(src("world", "roads.ts"));

  const n = field.size;
  const cell = field.cell;
  const size = n * cell;
  const half = size / 2;
  const row = n + 1;
  const h = field.heights;
  /** The floor as the game draws it: bilinear over the grid, clamped at the edge. */
  const floorAt = (x, z) => {
    const fx = Math.max(0, Math.min(n - 1e-9, (x + half) / cell));
    const fz = Math.max(0, Math.min(n - 1e-9, (z + half) / cell));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const v = (a, c) => h[c * row + a];
    return (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - tz) + (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * tz;
  };
  const grade = (x, z, e = 1.5) =>
    Math.max(
      Math.abs(floorAt(x + e, z) - floorAt(x - e, z)) / (2 * e),
      Math.abs(floorAt(x, z + e) - floorAt(x, z - e)) / (2 * e),
    );
  const water = (layout.water ?? []).map((w) => ({ ...w, y: w.y ?? WATER_SURFACE }));
  /** Under a water rect's surface, or within `margin` of it — the generators' convention, a bank margin. */
  const wet = (x, z, margin = 0) =>
    water.some((w) => Math.abs(x - w.x) <= w.width / 2 && Math.abs(z - w.z) <= w.depth / 2 && floorAt(x, z) < w.y + margin);
  const network = roadNetwork(layout.placements);
  const onRoadAt = (x, z, pad = 0) => onRoad(network.footprint, x, z, pad);

  return { id, layout, field, size, half, floorAt, grade, water, wet, network, onRoadAt };
}
