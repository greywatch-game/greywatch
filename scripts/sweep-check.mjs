/**
 * sweep-check.mjs — proves `src/world/ellipsoidSweep.ts` moves a body where
 * Babylon's `moveWithCollisions` moved it, BIT FOR BIT.
 *
 *   node scripts/sweep-check.mjs [map ...] [--samples 2000] [--seed 1] [--mode exact]
 *
 * The three body sweeps — the player on foot, a hull driving, a wreck coasting
 * — are leaving Babylon's collider for a port of it that runs on plain numbers
 * against `WorldBox`es (BABYLON_EXIT.md X2.1, PERF_PLAN.md C2). The port's
 * whole claim is that it is the SAME algorithm, quirks included, because the
 * feel of moving is that algorithm's and everything built over it (the
 * push-outs, the hull's offset sphere, its climb band) was tuned against it. A
 * sweep that is merely close is a different game to drive, and a divergence
 * that starts at the last bit does not stay there: a slide that rounds the
 * other way picks the other triangle of a tie and goes somewhere else. So this
 * compares with `Object.is` and "close" is a failure.
 *
 * Every map is built as the authority builds it (`buildServerWorld` under a
 * `NullEngine`), which hands over the collider boxes and the `RayWorld` whose
 * `bodyNear` the production sweep gathers its candidates from. Each sample is
 * then moved twice, from one start by one step: once by a probe mesh's own
 * `moveWithCollisions` in a REFERENCE scene, once by `sweepMove` below — which
 * is what `CollisionField.move` does, gather included, and is kept that small
 * on purpose so the two cannot drift. The bodies are the player and the three
 * vehicle kinds, their ellipsoids and offsets DERIVED from `CONFIG` exactly as
 * `Player` and `Vehicle` derive them, so a retune is checked without anybody
 * remembering to tell this file.
 *
 * ## The modes
 *
 * A mode is a choice of REFERENCE and of what counts as agreement, and each is
 * a row in `MODES`. Only `exact` is built:
 *
 * - **`exact`** (the default) holds the port to the bit, and so has to give
 *   Babylon the world the port was written against — one `CreateBox` collider
 *   mesh per box, in `colliderBoxes` order, which is what `MapBuilder.collider`
 *   made before the scatter was merged. The shipped world MERGES each scatter
 *   cluster (`boxGroups`) into one mesh, and the merge bakes the world matrix
 *   into the vertices before the ellipsoid scale where a mesh of its own
 *   composes the two first; that rounds at the other end, so a merged box's
 *   triangles agree only to the last bit or so. That is a different claim, and
 *   it gets a mode of its own rather than a tolerance here.
 *
 * Two things the reference needs that the shipped world gives for free, and
 * which are checked rather than assumed:
 *
 * - **The start is read out of a FLOAT32 matrix.** `moveWithCollisions`
 *   opens from `getAbsolutePosition()`, which is the world matrix's
 *   translation, so the sweep starts from `Math.fround(position)` plus the
 *   offset. The write-back adds the sweep's displacement to the float64
 *   position, gated on `COLLISIONS_EPSILON`, exactly as Babylon's position
 *   callback does.
 * - **Back faces are tested only because a default material exists.** The
 *   port tests every face because `subMesh.getMaterial()` hands Babylon the
 *   scene's default material (see `ellipsoidSweep.ts`). A reference scene
 *   without one would cull faces the game never culled, so this FAILS on it
 *   rather than comparing against the wrong algorithm.
 *
 * ## What is sampled
 *
 * Starts are drawn round a random collider (never a map-sized rim box), in
 * that box's own turned frame: mostly at or just short of contact, with the
 * tangential coordinate running a little past the face so corners come up,
 * and about a tenth deliberately EMBEDDED — the ellipsoid already overlapping
 * the box — because the ejection path is where this algorithm is strangest.
 * Heights span the box's band plus the ellipsoid's own vertical radius. Steps
 * are a frame's worth, mostly toward the box, with one in seven twenty times
 * that so the retries and long slides run, and a tenth with a vertical part
 * for the general case. Six synthetic HULLS, two of each kind's box, stand
 * beside random colliders so the movers path — `rays.hulls`, last in the list
 * as a hull built after the map was last in `scene.meshes` — is exercised, and
 * a share of the starts are drawn round them.
 *
 * The counts: `blocked` is a sample Babylon did not let go where the step
 * pointed (by more than 1e-6). `embedded` is a start whose ellipsoid overlaps
 * ANY of its candidate boxes, measured rather than drawn (a pitched box is
 * measured by its unpitched footprint, which is a count and not a verdict),
 * and `in anchor` the share of those inside the box the sample was drawn
 * round. Expect `embedded` near half: a building is floor slabs and party
 * walls laid flush, so a start at a random height beside one of them is very
 * often already in the next — which is no bad thing for a test of the
 * ejection path. `redo` is a sweep whose path outran its candidate list and
 * was re-run over the whole map, which production does too and which is a
 * COST, not a failure. The timing is ours, gather included, beside Babylon's own over the
 * reference world — which walks one mesh per box where the shipped world
 * walked one per cluster, so it flatters the port.
 *
 * Exits 1 on any non-identical sample or a reference that cannot be trusted.
 * Deleted with Babylon at X6.1, when there is nothing left to compare with.
 */
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const FLAGS = new Set(["--samples", "--seed", "--mode"]);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const SAMPLES = Number(opt("--samples", 2000));
const SEED = Number(opt("--seed", 1));
const MODE = opt("--mode", "exact");
const named = args.filter((a, i) => !a.startsWith("--") && !FLAGS.has(args[i - 1]));

/** How many failing samples are printed in full before the rest are only counted. */
const SHOW = 6;
/** A step this much shorter than asked was blocked, not rounded. */
const BLOCKED = 1e-6;

function vite() {
  return createServer({
    root: ROOT,
    configFile: false,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
  });
}

// ---------------------------------------------------------------------------
// The modes. Each names its reference world and judges a pair of answers; the
// driver below is shared. `shipped` (the merged world, to a tolerance) and
// `walk` (trajectories rather than single steps) are the next two rows.

const MODES = {
  exact: {
    help: "one collider mesh per box; every coordinate Object.is-equal",
    reference: oneMeshPerBox,
    agree: (ours, theirs) =>
      Object.is(ours.x, theirs.x) && Object.is(ours.y, theirs.y) && Object.is(ours.z, theirs.z),
  },
};

// ---------------------------------------------------------------------------
// The bodies, off CONFIG as their owners derive them.

/**
 * The player's capsule (`Player`'s constructor): no offset. The hull's sphere
 * (`Vehicle`'s constructor and `aimCollider`): lifted half the climb band and
 * carried to whichever end leads, along a yaw the sample draws.
 */
function bodiesOf(CONFIG) {
  const p = CONFIG.player;
  const list = [
    {
      name: "player",
      radii: [p.radius, p.height / 2 - 0.05, p.radius],
      offset: () => [0, 0, 0],
      step: [0.04, 0.12],
    },
  ];
  for (const kind of ["tank", "truck", "heli"]) {
    const t = CONFIG.vehicles[kind];
    const r = t.drive.collideRadius;
    list.push({
      name: kind,
      radii: [r, (t.hull.height - t.drive.climbHeight) / 2, r],
      offset: (rand) => {
        const yaw = rand() * Math.PI * 2;
        const bias = (t.hull.length / 2 - r) * (rand() < 0.5 ? 1 : -1);
        return [Math.sin(yaw) * bias, t.drive.climbHeight / 2, Math.cos(yaw) * bias];
      },
      step: [0.05, 0.2],
    });
  }
  return list;
}

// ---------------------------------------------------------------------------
// The two moves.

/**
 * Ours, as `CollisionField.move` does it: gather the boxes within the radius
 * plus the step plus a metre, sweep, and if the path outran that, gather the
 * whole map and sweep again. Then Babylon's write-back. `position` is the
 * body's own (float64) position and is not written; the answer goes in `to`.
 */
function sweepMove(ctx, position, radii, offset, step, to) {
  const { rays, sweep, list, res, COLLISIONS_EPSILON } = ctx;
  const [rx, ry, rz] = radii;
  const cx = Math.fround(position[0]) + offset[0];
  const cy = Math.fround(position[1]) + offset[1];
  const cz = Math.fround(position[2]) + offset[2];
  const len = Math.hypot(step[0], step[1], step[2]);
  let reach = Math.max(rx, rz) + len + 1;
  let redo = false;
  for (;;) {
    rays.bodyNear(cx, cz, reach, null, list);
    sweep.begin(rx, ry, rz);
    for (const box of list) sweep.addBox(box);
    sweep.run(cx, cy, cz, step[0], step[1], step[2], res);
    if (res.path <= len + 1 || reach === Infinity) break;
    reach = Infinity;
    redo = true;
  }
  const dx = res.x - cx;
  const dy = res.y - cy;
  const dz = res.z - cz;
  to.x = position[0];
  to.y = position[1];
  to.z = position[2];
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) > COLLISIONS_EPSILON) {
    to.x += dx;
    to.y += dy;
    to.z += dz;
  }
  return redo;
}

/** Babylon's, by a probe mesh in the reference scene. */
function babylonMove(ctx, position, radii, offset, step, to) {
  const { B, probe } = ctx;
  probe.ellipsoid = new B.Vector3(...radii);
  probe.ellipsoidOffset = new B.Vector3(...offset);
  probe.position.set(...position);
  probe.surroundingMeshes = null;
  probe.computeWorldMatrix(true);
  probe.moveWithCollisions(new B.Vector3(...step));
  to.x = probe.position.x;
  to.y = probe.position.y;
  to.z = probe.position.z;
}

// ---------------------------------------------------------------------------
// The reference worlds.

/** A box as `MapBuilder.collider` made one before the merge. */
function colliderMesh(B, scene, name, box, freeze) {
  const mesh = B.MeshBuilder.CreateBox(name, { width: box.w, height: box.h, depth: box.d }, scene);
  mesh.position.set(box.cx, box.cy, box.cz);
  mesh.rotation.set(box.rotX, box.rotY, 0);
  mesh.isVisible = false;
  mesh.checkCollisions = true;
  if (freeze) mesh.freezeWorldMatrix();
  else mesh.computeWorldMatrix(true);
  return mesh;
}

function oneMeshPerBox(B, engine, map) {
  const scene = new B.Scene(engine);
  map.colliderBoxes.forEach((box, i) => colliderMesh(B, scene, `c${i}`, box, true));
  return scene;
}

/**
 * Six hull boxes, two of each kind, each standing on the floor beside a random
 * collider at a random yaw. Babylon gets them as meshes built after the map;
 * ours as `RayHull`s in `rays.hulls`, which `bodyNear` hands over last.
 */
function addHulls(ctx, map, rand, anchors) {
  const { B, CONFIG, refScene } = ctx;
  if (map.rays.hulls.length !== 0) {
    throw new Error(`the server world arrived with ${map.rays.hulls.length} hulls; the reference has none`);
  }
  const hulls = [];
  for (const kind of ["tank", "truck", "heli", "tank", "truck", "heli"]) {
    const h = CONFIG.vehicles[kind].hull;
    const a = anchors[Math.floor(rand() * anchors.length)];
    const dir = rand() * Math.PI * 2;
    const far = Math.max(a.w, a.d) / 2 + Math.max(h.width, h.length) / 2 + 0.5 + rand() * 2;
    const cx = a.cx + Math.cos(dir) * far;
    const cz = a.cz + Math.sin(dir) * far;
    const box = {
      w: h.width,
      h: h.height,
      d: h.length,
      cx,
      cy: map.terrain.heightAt(cx, cz) + h.height / 2,
      cz,
      rotX: 0,
      rotY: rand() * Math.PI * 2,
    };
    const mesh = B.MeshBuilder.CreateBox(`hull${hulls.length}`, { width: box.w, height: box.h, depth: box.d }, refScene);
    mesh.position.set(box.cx, box.cy, box.cz);
    mesh.rotation.y = box.rotY;
    mesh.checkCollisions = true;
    mesh.computeWorldMatrix(true);
    map.rays.hulls.push({ rayBox: () => box });
    hulls.push(box);
  }
  return hulls;
}

// ---------------------------------------------------------------------------
// Sampling.

/**
 * One start and one step round `box`, in its turned frame. The ellipsoid's
 * CENTRE is drawn and the body's position backed out of it, so the offset
 * sphere of a hull is what touches the box.
 */
function drawSample(rand, box, body) {
  const [rx, ry] = body.radii;
  const offset = body.offset(rand);
  const [s0, s1] = body.step;
  let len = s0 + rand() * (s1 - s0);
  if (rand() < 1 / 7) len *= 20;
  const hw = (box.w || 1) / 2;
  const hd = (box.d || 1) / 2;
  let u;
  let v;
  let nx = 0;
  let nz = 0;
  if (rand() < 0.1) {
    // Embedded: the centre anywhere in the box grown by half a radius.
    u = (rand() * 2 - 1) * (hw + rx * 0.5);
    v = (rand() * 2 - 1) * (hd + rx * 0.5);
  } else {
    // Off one face: a little past either end of it tangentially, and from
    // touching to a radius clear of it — most within the step's reach.
    const clear = rand() < 0.65 ? rand() * len * 1.3 : rand() * rx;
    const side = rand() < 0.5 ? -1 : 1;
    if (rand() < 0.5) {
      u = side * (hw + rx + clear);
      v = (rand() * 2 - 1) * hd * 1.15;
      nx = side;
    } else {
      u = (rand() * 2 - 1) * hw * 1.15;
      v = side * (hd + rx + clear);
      nz = side;
    }
  }
  // The box's yaw, as `RotationYawPitchRoll` turns its local x and z.
  const c = Math.cos(box.rotY);
  const s = Math.sin(box.rotY);
  const ex = box.cx + u * c + v * s;
  const ez = box.cz - u * s + v * c;
  const ey = box.cy + (rand() * 2 - 1) * (box.h / 2 + ry);
  // Toward the box within seventy degrees of its face, or anywhere at all.
  let dir;
  if ((nx || nz) && rand() < 0.7) {
    const wx = -(nx * c + nz * s);
    const wz = -(-nx * s + nz * c);
    dir = Math.atan2(wz, wx) + (rand() * 2 - 1) * (Math.PI * 7) / 18;
  } else {
    dir = rand() * Math.PI * 2;
  }
  const step = [Math.cos(dir) * len, 0, Math.sin(dir) * len];
  if (rand() < 0.1) step[1] = len * (rand() * 2 - 1) * 0.5;
  const position = [ex - offset[0], ey - offset[1], ez - offset[2]];
  return { position, offset, step, centre: [ex, ey, ez] };
}

/**
 * Whether an ellipsoid with radii (r, ry, r) at `p` overlaps `box`. Round the
 * vertical axis it is a circle, so in the box's yaw frame with y scaled by
 * r / ry it is a sphere against an axis-aligned box — exact for an unpitched
 * box, and the unpitched footprint's answer for a pitched one.
 */
function overlaps(p, r, ry, box) {
  const c = Math.cos(box.rotY);
  const s = Math.sin(box.rotY);
  const dx = p[0] - box.cx;
  const dz = p[2] - box.cz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ly = ((p[1] - box.cy) * r) / ry;
  const qx = Math.max(Math.abs(lx) - (box.w || 1) / 2, 0);
  const qz = Math.max(Math.abs(lz) - (box.d || 1) / 2, 0);
  const qy = Math.max(Math.abs(ly) - (((box.h || 1) / 2) * r) / ry, 0);
  return qx * qx + qy * qy + qz * qz < r * r;
}

/** A small stable hash, so a map's stream does not depend on which maps were named. */
function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// The driver.

async function checkMap(env, def, mode, failures) {
  const { B, CONFIG, buildServerWorld, EllipsoidSweep, mulberry32, COLLISIONS_EPSILON } = env;
  const engine = new B.NullEngine();
  const serverScene = new B.Scene(engine);
  const map = await buildServerWorld(serverScene, def);
  const refScene = mode.reference(B, engine, map);
  if (refScene._hasDefaultMaterial !== true) {
    throw new Error(
      `${def.id}: the reference scene has no default material, so Babylon would cull back faces the port tests`,
    );
  }
  const rand = mulberry32((SEED * 0x9e3779b1) ^ hashOf(def.id));
  const anchors = map.colliderBoxes.filter((b) => !(b.w > 200 || b.d > 200));
  const ctx = {
    B,
    CONFIG,
    refScene,
    rays: map.rays,
    sweep: new EllipsoidSweep(),
    list: [],
    res: { x: 0, y: 0, z: 0, path: 0 },
    COLLISIONS_EPSILON,
  };
  const hulls = addHulls(ctx, map, rand, anchors);
  ctx.probe = new B.Mesh("probe", refScene);

  const rows = [];
  const ours = { x: 0, y: 0, z: 0 };
  const theirs = { x: 0, y: 0, z: 0 };
  for (const body of bodiesOf(CONFIG)) {
    const row = { map: def.id, body: body.name, samples: 0, blocked: 0, embedded: 0, inAnchor: 0, redo: 0, identical: 0, oursMs: 0, babylonMs: 0 };
    const [rx, ry] = body.radii;
    for (let n = 0; n < SAMPLES; n++) {
      const box = rand() < 0.12 ? hulls[Math.floor(rand() * hulls.length)] : anchors[Math.floor(rand() * anchors.length)];
      const smp = drawSample(rand, box, body);
      let t = performance.now();
      babylonMove(ctx, smp.position, body.radii, smp.offset, smp.step, theirs);
      row.babylonMs += performance.now() - t;
      t = performance.now();
      const redo = sweepMove(ctx, smp.position, body.radii, smp.offset, smp.step, ours);
      row.oursMs += performance.now() - t;

      row.samples++;
      if (redo) row.redo++;
      // `list` still holds the last gather, which covers the start.
      if (overlaps(smp.centre, rx, ry, box)) row.inAnchor++;
      if (ctx.list.some((b) => overlaps(smp.centre, rx, ry, b))) row.embedded++;
      const free = Math.hypot(
        theirs.x - smp.position[0] - smp.step[0],
        theirs.y - smp.position[1] - smp.step[1],
        theirs.z - smp.position[2] - smp.step[2],
      );
      if (free > BLOCKED) row.blocked++;
      if (mode.agree(ours, theirs)) {
        row.identical++;
        continue;
      }
      failures.count++;
      if (failures.count <= SHOW) {
        console.log(
          `DIFF ${def.id} ${body.name} sample ${n}\n` +
            `  radii    ${JSON.stringify(body.radii)}\n` +
            `  position ${JSON.stringify(smp.position)}\n` +
            `  offset   ${JSON.stringify(smp.offset)}\n` +
            `  step     ${JSON.stringify(smp.step)}\n` +
            `  babylon  ${JSON.stringify([theirs.x, theirs.y, theirs.z])}\n` +
            `  ours     ${JSON.stringify([ours.x, ours.y, ours.z])}${redo ? " (after a redo)" : ""}\n` +
            `  ours - babylon ${JSON.stringify([ours.x - theirs.x, ours.y - theirs.y, ours.z - theirs.z])}`,
        );
      }
    }
    rows.push(row);
  }
  refScene.dispose();
  serverScene.dispose();
  engine.dispose();
  return { rows, boxes: map.colliderBoxes.length };
}

// ---------------------------------------------------------------------------

const mode = MODES[MODE];
if (!mode) {
  console.log(`unknown --mode ${MODE}; the modes are:`);
  for (const [k, m] of Object.entries(MODES)) console.log(`  ${k.padEnd(8)} ${m.help}`);
  process.exit(1);
}

const started = performance.now();
const server = await vite();
let exitCode = 0;
try {
  const B = await server.ssrLoadModule("@babylonjs/core");
  B.Logger.LogLevels = B.Logger.NoneLogLevel;
  const env = {
    B,
    CONFIG: (await server.ssrLoadModule("/src/config/index.ts")).CONFIG,
    buildServerWorld: (await server.ssrLoadModule("/server/world.ts")).buildServerWorld,
    mulberry32: (await server.ssrLoadModule("/src/world/rng.ts")).mulberry32,
    ...(await server.ssrLoadModule("/src/world/ellipsoidSweep.ts")),
  };
  const { MAPS } = await server.ssrLoadModule("/src/world/maps.ts");
  // The proving ground is DEV-only and not a level: checked when named.
  const defs = named.length ? named.map((id) => MAPS.find((m) => m.id === id) ?? id) : MAPS.filter((m) => m.id !== "proving");
  const unknown = defs.filter((d) => typeof d === "string");
  if (unknown.length) throw new Error(`no such map: ${unknown.join(", ")} (the maps are ${MAPS.map((m) => m.id).join(", ")})`);

  console.log(`sweep-check --mode ${MODE} (${mode.help}), ${SAMPLES} samples a body, seed ${SEED}`);
  const failures = { count: 0 };
  const all = [];
  for (const def of defs) {
    const t = performance.now();
    const { rows, boxes } = await checkMap(env, def, mode, failures);
    all.push(...rows);
    console.log(`  ${def.id}: ${boxes} boxes, ${((performance.now() - t) / 1000).toFixed(1)} s`);
  }

  const head = ["map", "body", "samples", "blocked", "embedded", "in anchor", "redo", "identical", "µs ours", "µs babylon"];
  const table = all.map((r) => [
    r.map,
    r.body,
    r.samples,
    r.blocked,
    r.embedded,
    r.inAnchor,
    r.redo,
    r.identical,
    ((r.oursMs * 1000) / r.samples).toFixed(1),
    ((r.babylonMs * 1000) / r.samples).toFixed(1),
  ]);
  const width = head.map((h, i) => Math.max(h.length, ...table.map((row) => String(row[i]).length)));
  const line = (row) => row.map((c, i) => (i < 2 ? String(c).padEnd(width[i]) : String(c).padStart(width[i]))).join("  ");
  console.log(`\n${line(head)}`);
  for (const row of table) console.log(line(row));

  const samples = all.reduce((a, r) => a + r.samples, 0);
  const identical = all.reduce((a, r) => a + r.identical, 0);
  console.log(
    `\nsweep-check: ${identical} of ${samples} identical over ${defs.length} map(s) in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
  if (failures.count) {
    console.log(`FAILED: ${failures.count} samples differ${failures.count > SHOW ? ` (the first ${SHOW} printed)` : ""}`);
    exitCode = 1;
  }
} catch (e) {
  console.log(`sweep-check: ${e?.stack ?? e}`);
  exitCode = 1;
} finally {
  await server.close();
}
process.exit(exitCode);
