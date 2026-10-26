/**
 * Fingerprints what a map build MERGES — `npm run merge:hash`.
 *
 * Owns: nothing but a report and, when asked, one JSON file. Every map in the
 * registry (the shipped seven and the DEV-only proving ground) is built by the
 * real client in a real browser, and every surface and mesh the build hands
 * the world is hashed in list order: the world's SURFACES (`GameMap.world`,
 * one a record, each with the mesh `GameMap.visuals` holds of it, if any —
 * see "A surface with no mesh" below), `colliders` and `terrainColliders`
 * — name, material name, metadata, transform, the flags the world layer reads
 * (`isVisible`, `isPickable`, `checkCollisions`, rendering group), vertex,
 * index and submesh counts, `geometry.delayLoadState`, and a hash of every
 * vertex buffer and of the index buffer. Beside them, the plain lists a build
 * derives from its parts: `colliderBoxes`, `colliderAlbedo` and `partBoxes`
 * (hashed), and three that say how the merged meshes are WIRED to the rest of
 * the map (kept as data): `panes` (every `WorldPane` field), `paneGroups` (each
 * as `[surface index, panes, block]`) and `editorItems` (each layout item's
 * `visuals` as surface indices, `null` on a shipped build) — and
 * a fourth, `pieces`: `GameMap.world.pieces`, the PIECE table (each layout
 * item a piece id names, as `[list, index]`).
 *
 * **Each VISUAL also records its piece ranges** (`pieces`, from the record
 * `GameMap.world` keeps beside it: `[piece, vertexStart, vertexCount,
 * indexStart, indexCount]` per range), which say which layout item each span
 * of a merged mesh came from — what a destructible building will need, and
 * what nothing else in this file can see moving (`world/worldGeometry.ts`).
 *
 * **Each VISUAL's ARRAYS are hashed off its RECORD too** (`arrays`, `arrayIndex`
 * — `BABYLON_EXIT.md` X3.7a), through the DEV sink `world/worldGeometry.ts`
 * hands each surface's arrays to as they are released (`SurfaceSink`,
 * `window.__surfaceSink`, installed before the page boots): every attribute
 * under the vertex kind Babylon names it by, in the type Babylon was handed
 * it in — a `Float32Array` as its own bits, anything else as doubles, the
 * indices included — so a surface's record hashes are the very strings its
 * mesh's buffers hash to. **Every run checks the two halves agree** wherever
 * a visual has a mesh's buffers to compare (a failure, named `arrays≠buffers`),
 * against no baseline at all; that is what lets a later baseline lean on the
 * record's hashes alone for a surface no mesh is made of (X3.7b). A visual
 * whose arrays never reached the sink fails the run too, counted apart.
 *
 * **And its record's BOUNDS** (`bounds`: `SurfaceRecord.bounds`' ten numbers,
 * box then sphere, hashed as their f64 bits), which `WorldCulling` grows its
 * cells from. **Every run also checks them against the mesh's own bounding
 * info bit for bit** (`minimumWorld`/`maximumWorld`, `centerWorld`/
 * `radiusWorld`; a failure, named `bounds≠mesh`), over EVERY surface that has
 * a mesh — so `--editor`, whose visuals are placed off identity, puts
 * `boundsOf`'s transformed path under test on every run, which the shipped
 * build's (all at identity but the odd loose mesh) does not.
 *
 * **A surface with no mesh** (`BABYLON_EXIT.md` X3.7b: our renderer draws it
 * in every pass, and Babylon is made none — on a shipped build every surface
 * but the glazing and the fires) is fingerprinted off its RECORD alone: its
 * name, material, metadata, counts, piece ranges, bounds and the arrays the
 * sink hashed, and `mesh: false`; a surface WITH a mesh says `mesh: true`.
 * Compared with a baseline that holds a mesh of it (X3.7a's, which records
 * no `mesh` field), only those fields are compared — the arrays against the
 * baseline's, which X3.7a proved equal to its mesh's buffers — and every
 * mesh field it has no mesh to hold is not a difference; the run says how
 * many surfaces of each map have no mesh rather than failing on them.
 * **Against a baseline that records `mesh` (X3.7b's on), a surface that
 * GAINS or LOSES its mesh is a difference** (`mesh` moved), whatever else
 * matches — a fire made meshless would otherwise pass on its record alone.
 * A surface WITH a mesh is compared field for field as before, its
 * `sceneRank` against the baseline's ranks re-ranked over the surfaces that
 * still have one (and that had one in the scene: a baseline rank of -1 takes
 * no slot).
 *
 * **A map that fails to build is a failure on every run** — whatever any
 * baseline says — and the build is watched for a page error rather than
 * waited out: a surface our renderer cannot hold THROWS in a DEV build
 * (held by `BlockHandover.refuse`, thrown at the install once the world has
 * been failed — a page error out of `buildRound`, the page going on to the
 * menu), so this is what refuses a map that has one.
 * `--foliage <rung>` builds at that crown rung (`Settings.foliage`: `low`,
 * `medium`, `high`), which is how that refusal is asked of every rung.
 *
 * **Four per-mesh fields describe the UPLOAD rather than the geometry**, because
 * a merge that moves onto arrays and uploads at the end can get each wrong
 * without moving a vertex: `sceneRank` (the mesh's rank within its list by its
 * index in `scene.meshes` — creation order, which is the order `WorldCulling`
 * offers candidates in and so reaches the glow mask and the transparent
 * tie-breaks), `positionUpdatable` (whether the position buffer is writable,
 * which `GlassFx` needs on a pane block holding a breakable pane),
 * `hasVertexAlpha` and `frozen` (`isWorldMatrixFrozen`).
 *
 * **It is the other half of `npm run kit:hash`, and the half `FINDINGS.md` 26
 * said did not exist.** `kit:hash` proves a builder emits the same PARTS and
 * by its own header merges nothing. This proves the same parts come out of
 * `mergeByMaterial`, `BlockMerge`, `PaneBlocks`, the vertex-colour bake and
 * the palette as the same meshes — which is what a change to HOW a part is
 * built or merged (`world/parts.ts`, `world/merge.ts`) must not move. `npm run
 * parity` cannot see any of it: it fingerprints the nav graph, and visual
 * geometry is invisible to that by design.
 *
 *   npm run merge:hash -- --out before.json
 *   ...edit...
 *   npm run merge:hash -- --against before.json
 *
 * A pure refactor must come back with nothing changed. **Take the "before" on
 * the same machine and the same Babylon**: the hashes are of floats a browser
 * computed, and nothing promises another GPU vendor's or another engine
 * version's bake reaches the same bits.
 *
 * Flags: `--maps a,b` limits it to those map ids (with `--against`, only those
 * maps of the file are compared); `--editor` fingerprints the EDITOR's build
 * instead (`Game.buildEditorMap`, run over the round's: nothing block-merged,
 * every mesh one layout item's) — the other path out of `mergeByMaterial`,
 * which a shipped build never takes, so it owes a baseline of its own and is
 * never compared with one taken without the flag; `--out file` writes the
 * fingerprint; `--foliage <rung>` (above);
 * `--against file` compares and exits 1 on any difference, naming the list,
 * the index, the mesh and the fields that moved. A map that fails to build is
 * recorded as its error, so a build broken by the change is a difference too.
 * A field or a list the "before" file did not record is not a difference, so an
 * older baseline still compares everything it has. `info` (the scene's mesh and
 * geometry counts) is reported when it moves but never fails the run: it counts
 * what the scene holds besides the map. `--profile` prints the build's phases
 * (`window.__buildProfile()`, `world/buildProfile.ts`) per map — the editor's
 * rebuild under `--editor` — and they are never written or compared: a duration
 * is not a fingerprint.
 *
 * Boots the dev server and the GPU-capable Chromium the other browser scripts
 * use (`dev-server.mjs`, `browser.mjs`) — read `VERIFYING.md` first if it
 * times out at the boot gate.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { launchClient } from "./browser.mjs";
import { DEV_MAPS, MAPS, root } from "./collision-hash.mjs";
import { startDevServer } from "./dev-server.mjs";

const MAP_KEY = "greywatch.map";

/** As `check-world-parity.mjs`: the proving ground takes ~35 s to deploy. */
const DEPLOY_TIMEOUT_MS = 300_000;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const only = arg("--maps")?.split(",");
const editor = process.argv.includes("--editor");
const foliage = arg("--foliage");
const outFile = arg("--out");
const againstFile = arg("--against");
const profile = process.argv.includes("--profile");

/**
 * Runs IN THE PAGE. Kept free of closures over this module, because
 * Playwright serialises it as source.
 */
function fingerprintMap() {
  const g = window.__celshock;
  const map = g.map;

  // Two 32-bit lanes over the buffer's WORDS: FNV-1a and a second multiplier,
  // so two different buffers colliding on both is not a thing to worry about.
  const hashWords = (words) => {
    let a = 0x811c9dc5;
    let b = 0x9747b28c;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      a = Math.imul(a ^ w, 0x01000193);
      b = Math.imul(b ^ w, 0x5bd1e995) ^ (b >>> 13);
    }
    return (
      (a >>> 0).toString(16).padStart(8, "0") +
      (b >>> 0).toString(16).padStart(8, "0") +
      ":" +
      words.length
    );
  };
  // A buffer exactly as stored: a Float32Array hashed as its own bits, a plain
  // array as f64 bits so nothing is rounded on the way in.
  const hashArray = (arr) => {
    if (!arr) return null;
    if (ArrayBuffer.isView(arr)) {
      if (arr.byteLength % 4 === 0) {
        return hashWords(new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4));
      }
      return hashWords(Uint32Array.from(arr));
    }
    const f = Float64Array.from(arr);
    return "f64:" + hashWords(new Uint32Array(f.buffer));
  };
  const num = (x) => (x === undefined || x === null ? null : +x.toFixed(9));
  // A record's bounds in one order, box then sphere, and their f64 bits' hash.
  const boundsWords = (b) => [
    b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.centerX, b.centerY, b.centerZ, b.radius,
  ];
  const hashBounds = (words) => hashArray(Float64Array.from(words));
  const vec = (v) => (v ? [num(v.x), num(v.y), num(v.z)] : null);
  // Metadata as stable JSON: keys sorted, anything that is not plain data
  // (a Mesh, a function) named by its type rather than walked.
  const plain = (v, depth = 0) => {
    if (v === null || typeof v !== "object") return typeof v === "function" ? "<fn>" : v;
    if (depth > 4) return "<deep>";
    if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1));
    if (v.getClassName) return `<${v.getClassName()}:${v.name ?? ""}>`;
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = plain(v[k], depth + 1);
    return out;
  };

  // Where each mesh stands in the scene's list — its creation order, since
  // `removeMesh` splices and so keeps the survivors' order. A Map, because an
  // `indexOf` per mesh is quadratic over an editor build's thousands.
  const sceneIndex = new Map();
  g.scene.meshes.forEach((m, i) => sceneIndex.set(m, i));
  // A mesh's rank within its own LIST by that index: which of the list's
  // meshes was made before which, without the absolute index that every pool
  // or sky mesh made earlier would shift. -1 for a mesh not in the scene.
  const sceneRanks = (list) => {
    const at = list.map((m) => sceneIndex.get(m) ?? -1);
    const order = at
      .map((v, i) => [v, i])
      .filter(([v]) => v >= 0)
      .sort((x, y) => x[0] - y[0]);
    const rank = at.map(() => -1);
    order.forEach(([, i], r) => (rank[i] = r));
    return rank;
  };

  const meshRecord = (m, sceneRank) => {
    const geo = m.geometry;
    const kinds = m.getVerticesDataKinds ? [...m.getVerticesDataKinds()].sort() : [];
    const buffers = {};
    for (const k of kinds) buffers[k] = hashArray(m.getVerticesData(k, false, true));
    const q = m.rotationQuaternion;
    return {
      name: m.name,
      cls: m.getClassName(),
      material: m.material ? m.material.name : null,
      metadata: JSON.stringify(plain(m.metadata ?? null)),
      position: vec(m.position),
      rotation: vec(m.rotation),
      quaternion: q ? [num(q.x), num(q.y), num(q.z), num(q.w)] : null,
      scaling: vec(m.scaling),
      parent: m.parent ? m.parent.name : null,
      isVisible: m.isVisible,
      isPickable: m.isPickable,
      checkCollisions: m.checkCollisions,
      enabled: m.isEnabled(false),
      renderingGroupId: m.renderingGroupId,
      vertices: m.getTotalVertices(),
      indices: m.getTotalIndices(),
      subMeshes: m.subMeshes ? m.subMeshes.length : 0,
      delayLoadState: geo ? geo.delayLoadState : null,
      // Whether the mesh is on the DEVICE. A mesh whose buffers were
      // postponed and never created draws
      // nothing and throws nothing, so this is checked on its own below,
      // against no baseline at all.
      onDevice: Boolean(geo?.getVertexBuffer("position")?.getBuffer()),
      sceneRank,
      positionUpdatable: geo?.getVertexBuffer("position")?.isUpdatable() ?? null,
      hasVertexAlpha: m.hasVertexAlpha,
      frozen: m.isWorldMatrixFrozen,
      buffers,
      index: hashArray(m.getIndices(false, true)),
    };
  };

  const boxes = (list) =>
    list
      ? hashArray(
          Float64Array.from(
            list.flatMap((b) => [
              b.w, b.h, b.d, b.cx, b.cy, b.cz, b.rotX ?? 0, b.rotY ?? 0,
              b.porous ? 1 : 0, b.glass ? 1 : 0,
            ]),
          ),
        )
      : null;

  const records = (list) => {
    const rank = sceneRanks(list);
    return list.map((m, i) => meshRecord(m, rank[i]));
  };
  // One entry a SURFACE, in list order: its mesh's record where it has one
  // (`SurfaceRecord.visual`), its own record's fields where it has none —
  // and every surface's piece ranges, bounds and the arrays' hashes, off the
  // sink (`installSink`) — each absent on a build older than it. A build
  // older than X3.7b names no visual: its records are aligned with
  // `visuals`, one for one.
  const surfaces = map.world?.surfaces;
  const sunk = window.__surfaceHashes;
  const visualOf = (r, i) => (r && typeof r.visual === "number" ? r.visual : i);
  const meshRecords = records(map.visuals);
  const visuals = (surfaces ?? map.visuals).map((s, i) => {
    const v = surfaces ? visualOf(s, i) : i;
    const out =
      v >= 0
        ? { ...meshRecords[v], mesh: true }
        : {
            name: s.name,
            material: s.material ? s.material.name : null,
            metadata: JSON.stringify(plain(s.metadata ?? null)),
            vertices: s.vertexCount,
            indices: s.indexCount,
            mesh: false,
          };
    if (surfaces) {
      out.pieces = s.pieces.map((p) => [
        p.piece, p.vertexStart, p.vertexCount, p.indexStart, p.indexCount,
      ]);
    }
    if (sunk) {
      out.arrays = sunk[i]?.arrays ?? null;
      out.arrayIndex = sunk[i]?.index ?? null;
    }
    const b = surfaces?.[i]?.bounds;
    if (b) out.bounds = hashBounds(boundsWords(b));
    return out;
  });
  // The record's bounds against the mesh's bounding info, bit for bit — a
  // check rather than a fingerprint, so kept out of `visuals` (no baseline
  // ever records the mesh's half): see the header.
  const boundsCheck = { compared: 0, offIdentity: 0, unequal: [] };
  if (surfaces) {
    surfaces.forEach((s, i) => {
      const v = visualOf(s, i);
      const m = v >= 0 ? map.visuals[v] : null;
      const b = s.bounds;
      if (!b || !m) return;
      const info = m.getBoundingInfo();
      const box = info.boundingBox;
      const sphere = info.boundingSphere;
      const mine = [
        box.minimumWorld.x, box.minimumWorld.y, box.minimumWorld.z,
        box.maximumWorld.x, box.maximumWorld.y, box.maximumWorld.z,
        sphere.centerWorld.x, sphere.centerWorld.y, sphere.centerWorld.z,
        sphere.radiusWorld,
      ];
      boundsCheck.compared++;
      if (!m.getWorldMatrix().isIdentity()) boundsCheck.offIdentity++;
      const theirs = boundsWords(b);
      if (!mine.every((x, k) => Object.is(x, theirs[k]))) boundsCheck.unequal.push([i, m.name]);
    });
  }
  // A mesh's SURFACE index, by identity — the index its entry in `visuals`
  // above has: -1 is a mesh no surface's record names.
  const visualIndex = new Map();
  if (surfaces) surfaces.forEach((s, i) => {
    const v = visualOf(s, i);
    if (v >= 0) visualIndex.set(map.visuals[v], i);
  });
  else map.visuals.forEach((m, i) => visualIndex.set(m, i));
  const indexOfVisual = (m) => visualIndex.get(m) ?? -1;
  const itemVisuals = (items) => items.map((item) => item.visuals.map(indexOfVisual));

  return {
    visuals,
    colliders: records(map.colliders),
    terrainColliders: records(map.terrainColliders),
    lists: {
      colliderBoxes: boxes(map.colliderBoxes),
      colliderAlbedo: hashArray(map.colliderAlbedo ?? null),
      partBoxes: boxes(map.partBoxes ?? null),
      // Kept as DATA rather than hashed: short, and a difference is worth
      // reading. Every field of a pane, in its own order.
      panes: (map.panes ?? []).map((p) => [
        p.w, p.h, p.d, p.cx, p.cy, p.cz, p.rotY,
        p.vertexStart, p.vertexCount, p.group, p.box,
      ]),
      paneGroups: (map.paneGroups ?? []).map((pg) => [
        indexOfVisual(pg.mesh), [...pg.panes], pg.block,
      ]),
      editorItems: map.editor
        ? {
            placements: itemVisuals(map.editor.placements),
            scatter: itemVisuals(map.editor.scatter),
          }
        : null,
      pieces: map.world ? map.world.pieces.map((p) => [p.list, p.index]) : null,
    },
    // Not compared: what the scene holds besides the map (pools, the sky,
    // the viewmodel) is not this script's business, but a change that leaks
    // meshes or geometries out of the merge shows up here first.
    info: {
      sceneMeshes: g.scene.meshes.length,
      sceneGeometries: g.scene.geometries.length,
    },
    boundsCheck,
  };
}

/**
 * Runs IN THE PAGE before it boots: the DEV sink every surface's arrays pass
 * through as they are released (`SurfaceSink`), hashed there and then — the
 * arrays are not kept — into `window.__surfaceHashes`, by the surface's index
 * in its build's list (`GameMap.world.surfaces` order). The hashing is
 * `fingerprintMap`'s `hashArray`, applied to what the adapter hands Babylon
 * (`world/parts.ts`'s `vertexDataOf`) — or would, for a surface it makes no
 * mesh of: a `Float32Array` as itself, any other array as the doubles of the
 * plain array Babylon held.
 */
function installSink() {
  const hashWords = (words) => {
    let a = 0x811c9dc5;
    let b = 0x9747b28c;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      a = Math.imul(a ^ w, 0x01000193);
      b = Math.imul(b ^ w, 0x5bd1e995) ^ (b >>> 13);
    }
    return (
      (a >>> 0).toString(16).padStart(8, "0") +
      (b >>> 0).toString(16).padStart(8, "0") +
      ":" +
      words.length
    );
  };
  const asBabylon = (arr) => {
    if (!arr) return null;
    if (arr instanceof Float32Array) {
      return hashWords(new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4));
    }
    const f = arr instanceof Float64Array ? arr : Float64Array.from(arr);
    return "f64:" + hashWords(new Uint32Array(f.buffer, f.byteOffset, f.byteLength / 4));
  };
  // Babylon's vertex kinds, by the buffer field each is uploaded from.
  const KINDS = [
    ["position", "positions"],
    ["normal", "normals"],
    ["uv", "uvs"],
    ["uv2", "uvs2"],
    ["color", "colors"],
  ];
  window.__surfaceHashes = [];
  window.__surfaceSink = (index, geometry) => {
    const arrays = {};
    for (const [kind, field] of KINDS) {
      if (geometry[field]) arrays[kind] = asBabylon(geometry[field]);
    }
    window.__surfaceHashes[index] = { arrays, index: asBabylon(geometry.indices) };
  };
}

async function buildOne(browser, url, id, editor) {
  const page = await browser.newPage();
  try {
    page.on("pageerror", (e) => console.error(`  [page] ${e.message}`));
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [MAP_KEY, id],
    );
    if (foliage) {
      await page.addInitScript((rung) => window.localStorage.setItem("greywatch.setting.foliage", rung), foliage);
    }
    // A build that throws — a surface our renderer cannot hold, in a DEV
    // build (`BlockHandover.install`) — is a failure at once, not a wait.
    await page.addInitScript(() => {
      window.__buildErrors = [];
      window.addEventListener("error", (e) => window.__buildErrors.push(String(e.message)));
      window.addEventListener("unhandledrejection", (e) =>
        window.__buildErrors.push(String(e.reason?.message ?? e.reason)),
      );
    });
    await page.addInitScript(installSink);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.__celshock), null, { timeout: 60_000 });
    await page.evaluate(async (deadlineMs) => {
      const g = window.__celshock;
      g.startRound();
      const until = performance.now() + deadlineMs;
      await new Promise((resolve, reject) => {
        const poll = () => {
          if (g.state === "deploy") return resolve();
          if (window.__buildErrors.length > 0) return reject(new Error(window.__buildErrors[0]));
          if (performance.now() > until) {
            return reject(new Error(`never reached deploy (state "${g.state}")`));
          }
          setTimeout(poll, 50);
        };
        poll();
      });
    }, DEPLOY_TIMEOUT_MS);
    if (editor) {
      // The editor's own rebuild, over the floor the round just fetched — the
      // same synchronous `installMap({ editor: true })` F2 ends in, without
      // the editor's UI. Private, and reached anyway: this is a DEV page.
      // Braced so it returns nothing: the `GameMap` it hands back is a scene
      // graph, and Playwright would try to serialise it.
      // The sink's hashes start again: they are the editor build's from here.
      await page.evaluate(() => {
        window.__surfaceHashes = [];
        window.__celshock.buildEditorMap();
      });
    }
    const print = await page.evaluate(fingerprintMap);
    print.editor = editor;
    if (profile) {
      // Printed now and never stored: see the header.
      const phases = await page.evaluate(() => window.__buildProfile?.() ?? []);
      for (const p of phases) {
        console.log(`  ${id} ${p.label.padEnd(24)} ${p.ms.toFixed(1).padStart(9)} ms`);
      }
    }
    return print;
  } catch (e) {
    return { error: String(e.message ?? e).split("\n")[0], editor };
  } finally {
    await page.close();
  }
}

/**
 * `before`'s scene ranks over the first `n` entries, re-ranked among those
 * `after` still holds a mesh of (`mesh !== false`) and that were in the
 * scene before (a rank of -1, which takes no slot), in the same order — or
 * null when every one still has a mesh. A surface with none ranks -1.
 */
function reRanked(before, after, n) {
  if (!after.some((m) => m.mesh === false)) return null;
  const kept = [];
  for (let i = 0; i < n; i++) if (after[i].mesh !== false && before[i].sceneRank >= 0) kept.push(i);
  kept.sort((x, y) => before[x].sceneRank - before[y].sceneRank);
  const out = new Array(n).fill(-1);
  kept.forEach((i, r) => (out[i] = r));
  return out;
}

/**
 * The fields of two mesh records that differ, by name. An `after` with no
 * mesh (`mesh: false`) is compared on the fields it holds alone — its
 * record's — and its arrays against the baseline's (see the header); `mesh`
 * itself is compared wherever both sides record it, so a surface that
 * gained or lost its mesh is a difference.
 */
function fieldsThatMoved(a, b) {
  const moved = [];
  const meshless = b.mesh === false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    // A field an older fingerprint did not record is not a difference.
    if (!(k in a)) continue;
    // Nor is a mesh field a surface with no mesh cannot hold.
    if (meshless && !(k in b)) continue;
    if (k === "buffers" || (k === "arrays" && a.arrays && b.arrays)) {
      for (const kind of new Set([...Object.keys(a[k]), ...Object.keys(b[k])])) {
        if (a[k][kind] !== b[k][kind]) moved.push(`${k === "buffers" ? "buffer" : "array"}:${kind}`);
      }
    } else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      moved.push(k);
    }
  }
  return moved;
}

function compare(before, after) {
  const lines = [];
  for (const id of Object.keys(after)) {
    const a = before[id];
    const b = after[id];
    if (!a) {
      lines.push(`${id}: not in the "before" file`);
      continue;
    }
    if (Boolean(a.editor) !== Boolean(b.editor)) {
      lines.push(`${id}: an ${a.editor ? "editor" : "shipped"} build against an ${b.editor ? "editor" : "shipped"} one`);
      continue;
    }
    if (a.error || b.error) {
      if (a.error !== b.error) lines.push(`${id}: build ${a.error ?? "ok"} -> ${b.error ?? "ok"}`);
      continue;
    }
    for (const list of ["visuals", "colliders", "terrainColliders"]) {
      if (a[list].length !== b[list].length) {
        lines.push(`${id}.${list}: ${a[list].length} meshes -> ${b[list].length}`);
      }
      const n = Math.min(a[list].length, b[list].length);
      // The baseline's scene ranks, re-ranked over the surfaces that still
      // have a mesh — the ones `b`'s ranks are among (see the header).
      const ranks = list === "visuals" ? reRanked(a[list], b[list], n) : null;
      let shown = 0;
      let differing = 0;
      for (let i = 0; i < n; i++) {
        const before = ranks && b[list][i].mesh !== false ? { ...a[list][i], sceneRank: ranks[i] } : a[list][i];
        const moved = fieldsThatMoved(before, b[list][i]);
        if (moved.length === 0) continue;
        differing++;
        if (shown < 8) {
          shown++;
          lines.push(`${id}.${list}[${i}] ${b[list][i].name}: ${moved.join(", ")}`);
        }
      }
      if (differing > shown) lines.push(`${id}.${list}: ...and ${differing - shown} more`);
    }
    for (const k of Object.keys(b.lists)) {
      // A list an older fingerprint did not record is not a difference.
      if (!(k in a.lists)) continue;
      if (JSON.stringify(a.lists[k]) !== JSON.stringify(b.lists[k])) {
        lines.push(`${id}.${k}: changed`);
      }
    }
  }
  return lines;
}

/** `info` lines that moved: reported, never a failure (see the header). */
function infoThatMoved(before, after) {
  const lines = [];
  for (const id of Object.keys(after)) {
    const a = before[id]?.info;
    const b = after[id]?.info;
    if (!a || !b) continue;
    for (const k of Object.keys(b)) {
      if (k in a && a[k] !== b[k]) lines.push(`${id}.info.${k}: ${a[k]} -> ${b[k]} (not a failure)`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------

const ids = [...MAPS, ...DEV_MAPS].map((m) => m.id).filter((id) => !only || only.includes(id));
const vite = await startDevServer(root);
const result = {};
let browser;
try {
  browser = await launchClient();
  for (const id of ids) {
    const t0 = Date.now();
    result[id] = await buildOne(browser, vite.url, id, editor);
    const r = result[id];
    console.log(
      r.error
        ? `${id}: FAILED — ${r.error}`
        : `${id}: ${r.visuals.length} surfaces (${r.visuals.filter((m) => m.mesh !== false).length} meshes), ${r.colliders.length} colliders, ` +
            `${r.terrainColliders.length} terrain (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
    );
  }
} finally {
  await browser?.close();
  await vite.stop();
}

// A map that did not build is a failure whatever any baseline says: a
// surface our renderer cannot hold throws in a DEV build, and this is where
// that refuses the map (see the header).
for (const [id, r] of Object.entries(result)) {
  if (!r.error) continue;
  console.log(`${id}: REFUSED — the build failed: ${r.error}`);
  process.exitCode = 1;
}

// The surfaces each map made no mesh of — our renderer's, whole — said, not
// failed on.
for (const [id, r] of Object.entries(result)) {
  if (r.error) continue;
  const meshless = r.visuals.filter((m) => m.mesh === false).length;
  if (meshless > 0) {
    console.log(`${id}: ${meshless} of ${r.visuals.length} surfaces have no mesh (our renderer's) — compared off their records`);
  }
}

// Every mesh handed to the world must be on the device, whatever any baseline
// says — the one failure the hashes above cannot see. A surface with no mesh
// at all is not one: it is our renderer's.
let stranded = 0;
for (const [id, r] of Object.entries(result)) {
  if (r.error) continue;
  for (const list of ["visuals", "colliders", "terrainColliders"]) {
    const parts = r[list].filter((m) => m.mesh !== false && m.vertices > 0 && !m.onDevice);
    stranded += parts.length;
    for (const m of parts.slice(0, 5)) {
      console.log(`${id}.${list}: ${m.name} is a PART — it will draw nothing`);
    }
  }
}
if (stranded > 0) process.exitCode = 1;

// Every visual's record hashes must be its mesh's buffers' — the same arrays,
// read before the release and after the upload — whatever any baseline says.
// A visual with no arrays at all is counted apart: it was never compared.
let unequal = 0;
let compared = 0;
let missing = 0;
for (const [id, r] of Object.entries(result)) {
  if (r.error) continue;
  r.visuals.forEach((m, i) => {
    if (!m.arrays) {
      missing++;
      if (missing <= 5) console.log(`${id}.visuals[${i}] ${m.name}: no arrays reached the sink`);
      return;
    }
    // A surface with no mesh has no buffers to compare: its arrays are
    // compared with a baseline's instead (see the header).
    if (m.mesh === false || !m.onDevice) return;
    compared++;
    const kinds = new Set([...Object.keys(m.arrays), ...Object.keys(m.buffers)]);
    const moved = [...kinds].filter((k) => m.arrays[k] !== m.buffers[k]);
    if (m.arrayIndex !== m.index) moved.push("index");
    if (moved.length === 0) return;
    unequal++;
    if (unequal <= 5) console.log(`${id}.visuals[${i}] ${m.name}: arrays≠buffers (${moved.join(", ")})`);
  });
}
console.log(
  `record arrays: ${compared - unequal} of ${compared} visuals equal to their mesh's buffers` +
    (missing > 0 ? `; ${missing} visuals had no arrays reach the sink` : ""),
);
if (unequal > 0 || missing > 0) process.exitCode = 1;

// Every visual's record bounds must be its mesh's bounding info, bit for bit,
// whatever any baseline says — the transformed path included (see the header).
let boundsCompared = 0;
let boundsOff = 0;
let boundsUnequal = 0;
for (const [id, r] of Object.entries(result)) {
  if (r.error || !r.boundsCheck) continue;
  boundsCompared += r.boundsCheck.compared;
  boundsOff += r.boundsCheck.offIdentity;
  for (const [i, name] of r.boundsCheck.unequal) {
    boundsUnequal++;
    if (boundsUnequal <= 5) console.log(`${id}.visuals[${i}] ${name}: bounds≠mesh`);
  }
}
console.log(
  `record bounds: ${boundsCompared - boundsUnequal} of ${boundsCompared} visuals equal to their mesh's ` +
    `bounding info (${boundsOff} off identity)`,
);
if (boundsUnequal > 0) process.exitCode = 1;

if (outFile) {
  writeFileSync(outFile, JSON.stringify(result));
  console.log(`wrote ${outFile}`);
}
if (againstFile) {
  const before = JSON.parse(readFileSync(againstFile, "utf8"));
  const lines = compare(before, result);
  for (const l of infoThatMoved(before, result)) console.log(l);
  if (lines.length === 0) {
    console.log(`identical to ${againstFile} on ${ids.join(", ")}`);
  } else {
    for (const l of lines) console.log(l);
    process.exitCode = 1;
  }
}
