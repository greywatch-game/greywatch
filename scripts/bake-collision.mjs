/**
 * Bakes each map's collider set to `src/world/<map>/collision.ts`, for the
 * multiplayer server to load.
 *
 * Run with `npm run collision`. Committed output, like `heights.ts` and
 * `public/icons/` — see `docs/multiplayer.md` for why this file exists at all.
 *
 * **Why a bake and not a server-side build.** The server runs the simulation
 * under Babylon's NullEngine, and a NullEngine has no canvas: `DynamicTexture`
 * throws `OffscreenCanvas is not defined`. `MapBuilder` reaches one through
 * `floorMaterial` → `textures.ts`, so the server cannot run a build at all.
 * What it CAN do is reproduce the solid world from the boxes, because
 * `MapBuilder.collider()` is the only place a collider is made and the
 * `WorldBox` it records (`w/h/d`, `cx/cy/cz`, `rotX/rotY`) is everything
 * `MeshBuilder.CreateBox` needs to build the same mesh. So this emits the boxes
 * and the server rebuilds from them — one ray implementation, not two.
 *
 * Only the boxes are baked. Control points and spawns pass straight through
 * from the layout untouched (`MapBuilder.build` assigns `layout.controlPoints`
 * and `layout.spawns` to the `GameMap` verbatim), and the floor comes from
 * `new TerrainField(layout.terrain)`, which is pure arithmetic — so the server
 * reads all three from the layout module directly and they cannot go stale.
 *
 * **Staleness is the one risk, and it is guarded.** The emitted file carries a
 * hash over the map's `layout.ts` and `heights.ts`. The server refuses to start
 * when it does not match, rather than quietly serving a world whose walls are
 * in different places from the clients'.
 *
 * The build runs in a real Chromium against the dev server, not in Node: the
 * point is to capture what the CLIENT actually builds, and the only way to be
 * sure of that is to let the client build it.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { MAPS, root, sourceHash } from "./collision-hash.mjs";
import { startDevServer } from "./dev-server.mjs";

/** The localStorage key `prefs.ts` remembers the chosen map under. */
const MAP_KEY = "hollowmere.map";

/**
 * Builds one map in the browser and hands back its collider boxes.
 *
 * `startRound()` only BOOKS the build — `buildRound` runs two animation frames
 * later (see VERIFYING.md), so this waits on the state reaching `deploy` rather
 * than on the call returning. Reading `g.map` on the next line gets the
 * previous round's map, or none at all.
 */
async function bakeMap(browser, url, id) {
  const page = await browser.newPage();
  // Without these a failure to boot shows up only as `waitForFunction` timing
  // out on `__celshock`, which says nothing about why. The first time this
  // script ran, the real cause was a 500 from the dev server and the only
  // evidence was a blank sixty-second wait.
  page.on("pageerror", (e) => console.error(`  [page] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.error(`  [console] ${m.text()}`);
  });
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [MAP_KEY, id],
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__celshock), null, {
    timeout: 60_000,
  });

  const boxes = await page.evaluate(async () => {
    const g = window.__celshock;
    g.startRound();
    await new Promise((resolve) => {
      const poll = () =>
        g.state === "deploy" ? resolve() : setTimeout(poll, 50);
      poll();
    });
    // FULL PRECISION, deliberately. An earlier version rounded to the
    // micrometre to keep the generated file tidy, on the reasoning that the low
    // bits of a double are float noise nobody could observe. They are
    // observable: the nav grid rasterizes box tops into surface heights and
    // then compares neighbours against `stepHeight`, so a perturbation of any
    // size flips whichever comparisons were sitting exactly on a boundary.
    // Hollowmere is authored on round numbers and is therefore full of exact
    // ties — micrometre rounding moved 15 cells in and out of the walkable set
    // and changed the nav graph the server steers bots along. `npm run parity`
    // is what caught it.
    //
    // JS prints the shortest round-trippable form, so authored values like 0.6
    // still emit as `0.6`; only genuinely irrational results get long, and
    // those are the ones that must not be touched.
    //
    // The ninth entry is `porous` and is written only when true — a box that
    // stops a body and not a round (see `BoxSpec.porous`). It has to be baked
    // because the server resolves every shot, and it is omitted elsewhere
    // because a column of zeroes on 800 rows is noise in the diff this file is
    // reviewed as.
    const row = (b) => {
      const out = [
        b.w, b.h, b.d,
        b.cx, b.cy, b.cz,
        b.rotX, b.rotY,
      ];
      if (b.porous) out.push(1);
      return out;
    };
    // `rayGroups` stays GROUPED: each inner array is one merged collider mesh,
    // and the server merges the same way. Flattening it would leave the server
    // guessing where one fence ends and the next begins, and the wrong guess
    // (one mesh for the map) puts a bounding box around the whole village.
    // Panes, in build order — which is what makes the index into this array a
    // name the client and the authority both know a pane by. Seven numbers and
    // an index: no `rotX` (nothing in the kit tilts a sheet), and `box` is the
    // pane's own position in `boxes`. Only the BREAKABLE glass is in
    // `map.panes` at all; the city's decorative glazing is drawn and nothing
    // else, so there is nothing here for the authority to know about it.
    const pane = (p) => [p.w, p.h, p.d, p.cx, p.cy, p.cz, p.rotY, p.box];
    return {
      boxes: g.map.colliderBoxes.map(row),
      rayGroups: g.map.rayGroups.map((group) => group.map(row)),
      // `boxGroups` is INDICES rather than boxes, because unlike `rayGroups`
      // these boxes are already in `boxes` — they are the solid world and the
      // nav grid reads every one of them. What is baked is only which of them
      // the client merged into one mesh, so the server can meet the same
      // geometry with the same number of bounding tests.
      boxGroups: g.map.boxGroups,
      panes: g.map.panes.map(pane),
    };
  });

  await page.close();
  return boxes;
}

/** The generated module, as text. */
function emit(id, constant, baked, hash) {
  const { boxes, rayGroups, boxGroups, panes } = baked;
  const rows = boxes.map((b) => `  [${b.join(",")}],`).join("\n");
  const paneRows = panes.map((p) => `  [${p.join(",")}],`).join("\n");
  const rayRows = rayGroups
    .map((group) => `  [${group.map((b) => `[${b.join(",")}]`).join(",")}],`)
    .join("\n");
  const rayBoxes = rayGroups.reduce((n, group) => n + group.length, 0);
  const groupRows = boxGroups.map((g) => `  [${g.join(",")}],`).join("\n");
  const grouped = boxGroups.reduce((n, g) => n + g.length, 0);
  return `/**
 * ${id}/collision.ts — GENERATED by \`npm run collision\`. Do not hand-edit.
 *
 * The map's collider boxes, for the multiplayer server: it has no canvas and so
 * cannot run \`MapBuilder\` (see \`scripts/bake-collision.mjs\`), and rebuilds the
 * solid world from these instead. Every entry is one \`WorldBox\` as
 * \`[w, h, d, cx, cy, cz, rotX, rotY]\` — a tuple rather than an object because
 * there are ${boxes.length} of them and the field names would be ${boxes.length * 7} repetitions
 * of the same eight words. A ninth entry of \`1\` marks a \`porous\` box: solid
 * to a body, air to a round, so a round crosses a fence rather than stopping in
 * a gap between its rails.
 *
 * \`rayGroups\` is the other half of that: ${rayBoxes} \`strut\` boxes in
 * ${rayGroups.length} groups — the timber a round DOES stop on, with no body
 * behind it. One group per collider mesh, because the server merges each group
 * the way the client does. They are not in \`boxes\` because nothing derived
 * from geometry may see them: a 0.1 m rail is a shape the nav grid can only get
 * wrong.
 *
 * \`boxGroups\` is a third view of the SAME boxes: ${grouped} of them, in
 * ${boxGroups.length} groups, that the client merged into one collider mesh
 * each because they are a scatter region's props and a pick costs per mesh.
 * Indices into \`boxes\`, not boxes — everything derived from geometry still
 * reads them one at a time. Anything named here is not also given a mesh of
 * its own.
 *
 * \`panes\` is the glass a round can take away: ${panes.length} sheets, each with a
 * collider in \`boxes\` (the eighth entry is its index there) holding a body out
 * of the opening until it goes. Not the city's glazing, which is most of the
 * glass drawn and none of it breakable — a sheet with something solid behind it
 * opens nothing, so the authority is told nothing about it. The ones here are
 * needed because it resolves every shot and because its move validator has to
 * agree about which shopfront somebody has just walked through — see
 * \`systems/GlassSystem.ts\`. The index into this array is the pane's identity on
 * the wire, so its ORDER is load-bearing and is the client's build order.
 *
 * \`sourceHash\` covers this map's \`layout.ts\` and \`heights.ts\`. The server
 * checks it at startup and refuses to run when it does not match, because a
 * stale bake is a server whose walls are somewhere else from its clients' — a
 * failure that is invisible until someone is shot through a house.
 */
import type { MapCollision } from "../collision";

export const ${constant}: MapCollision = {
  sourceHash: "${hash}",
  boxes: [
${rows}
  ],
  rayGroups: [
${rayRows}
  ],
  boxGroups: [
${groupRows}
  ],
  panes: [
${paneRows}
  ],
};

// Default too, because \`MapDef.collision\` is a lazy \`import()\` and a default
// is the one export name a generic signature can be written against.
export default ${constant};
`;
}

/** Path of a map's generated module. */
const outPath = (id) => join(root, "src", "world", id, "collision.ts");

/**
 * Writes an empty bake for any map that has none yet.
 *
 * The bake reads the collider set out of a running game, and `maps.ts` imports
 * every map's `collision.ts` — so without this the script cannot run until its
 * own output already exists, and a fresh checkout that is missing one can never
 * regenerate it. The stub is deliberately hash-less: `check-collision.mjs` sees
 * an empty string, disagrees with the real hash, and fails the build, so a stub
 * left behind by an interrupted run cannot be mistaken for a bake.
 */
function ensureStub(id, constant) {
  if (existsSync(outPath(id))) return false;
  writeFileSync(
    outPath(id),
    emit(id, constant, { boxes: [], rayGroups: [], boxGroups: [], panes: [] }, ""),
  );
  return true;
}

// ---------------------------------------------------------------------------

for (const { id, constant } of MAPS) {
  if (ensureStub(id, constant)) console.log(`${id}: wrote empty stub to bootstrap`);
}

const vite = await startDevServer(root);
console.log(`dev server on ${vite.url}`);

let browser;
try {
  browser = await chromium.launch();

  for (const { id, constant } of MAPS) {
    const baked = await bakeMap(browser, vite.url, id);
    const hash = sourceHash(id);
    writeFileSync(outPath(id), emit(id, constant, baked, hash));
    const rayBoxes = baked.rayGroups.reduce((n, group) => n + group.length, 0);
    console.log(
      `${id}: ${baked.boxes.length} boxes, ${rayBoxes} strut boxes in ` +
        `${baked.rayGroups.length} groups -> ${outPath(id)} (${hash})`,
    );
  }
} finally {
  await browser?.close();
  vite.stop();
}
