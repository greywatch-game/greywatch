/**
 * sweep-check.mjs — holds the body sweep (`src/world/ellipsoidSweep.ts`, run
 * through `src/world/CollisionField.ts`) to Babylon's `moveWithCollisions`:
 * to the BIT where it is the same algorithm over the same triangles, and to a
 * MEASURED, EXPLAINED distance where the world that shipped was not.
 *
 *   node scripts/sweep-check.mjs [map ...] [--mode exact|shipped|walk]
 *                                [--samples N] [--seed S] [--tight]
 *                                [--body player|tank|truck|heli] [--seq I]
 *                                [--trace] [--reference client|server]
 *
 * The three body sweeps — the player on foot, a hull driving, a wreck coasting
 * — left Babylon's collider for a port of it that runs on plain numbers
 * against `WorldBox`es (BABYLON_EXIT.md X2.1, PERF_PLAN.md C2). The port's
 * whole claim is that it is the SAME algorithm, quirks included, because the
 * feel of moving is that algorithm's and everything built over it (the
 * push-outs, the hull's offset sphere, its climb band) was tuned against it. A
 * divergence that starts at the last bit does not stay there: a slide that
 * rounds the other way can pick the other triangle of a tie and go somewhere
 * else. So the first mode compares with `Object.is`, and the other two say
 * how far the production sweep is from what shipped and WHY.
 *
 * Every map is built as the authority builds it (`buildServerWorld` under a
 * `NullEngine`), which hands over the collider boxes, the `RayWorld` whose
 * `bodyNear` every sweep gathers from, the `CollisionField` over it
 * (`map.collidables`), and a scene of collider meshes as the clients had
 * them. The bodies are the player and the three vehicle kinds, their
 * ellipsoids and offsets DERIVED from `CONFIG` as `Player` and `Vehicle`
 * derive them, so a retune is checked without anybody telling this file.
 *
 * ## The modes
 *
 * - **`exact`** (the default) holds the port to the bit. Babylon is given the
 *   world the port was written against — one `CreateBox` collider mesh per
 *   box, as `MapBuilder.collider` made them before the scatter was merged,
 *   created in the CLIENT's collider order (every box no cluster holds, then
 *   the clusters' boxes in `boxGroups` order), which is the rank `RayWorld`
 *   hands a sweep its candidates in — and is started where the port is started: from
 *   `Math.fround(position)` plus the offset, because `moveWithCollisions`
 *   opens from `getAbsolutePosition()`, the float32 world matrix's
 *   translation. Ours is `CollisionField.sweepFrom`, the production gather,
 *   then Babylon's write-back (the move kept only past `COLLISIONS_EPSILON`).
 *   Babylon is run twice: over the whole scene, which is the reference, and
 *   NARROWED to the meshes of the boxes our final gather held — a superset by
 *   `sweepFrom`'s own path check, so it must give the same answer, and it is
 *   the fair timing (it is what `narrowedMove` did). `--tight` runs two
 *   fields with a deliberately short first reach (`GatherKnobs`, see
 *   `TIGHT_KNOBS`), one that re-gathers and one that falls straight through
 *   to the whole map, so both arms of the loop run — which a real sweep
 *   almost never makes them do; both answers must still be identical. Any
 *   difference, ours or narrowed, fails.
 * - **`shipped`** measures production against the world that SHIPPED: the
 *   CLIENT's collider scene — every box no cluster holds as its own mesh, then
 *   each scatter cluster (`boxGroups`) MERGED as `MapBuilder.clusterColliders`
 *   merges it, in that order — and a Babylon move from the float64 position
 *   like any other. Ours is `map.collidables.move` on a plain body, float64
 *   start. Two things differ on purpose (`CollisionField.ts`'s header): the
 *   start (float64 against Babylon's float32), and a merged box's triangles,
 *   which bake the world matrix in before the ellipsoid scale and so round at
 *   the other end. `--reference server` puts the authority's own scene there
 *   instead, which made its clusters FIRST, so it adds tie order as a third
 *   difference. Agreement is a HISTOGRAM, and every sample over
 *   a millimetre is DIAGNOSED: (a) ours again from Babylon's float32 start —
 *   if that agrees to 1e-6 the start was the whole of it ("start"); (b)
 *   Babylon against itself from starts nudged a float32 step either way in x
 *   and in z — if its own answers spread by half the divergence or more, the
 *   sample sat on a knife edge and any rounding would have tipped it ("knife
 *   edge"); (c) the same question BELOW the float32 spacing, which Babylon
 *   cannot be asked because it cannot be started between two float32
 *   positions — so the port, which is its arithmetic from any start, is run
 *   from starts along the segment between the two runs' starts and jittered
 *   1e-7 round ours ("knife edge (sub-f32)"). A start that moved by a few
 *   micrometres and an answer that moved by centimetres is a knife edge by
 *   any definition; (c) is what finds one narrower than (b)'s step. Then
 *   the two deliberate differences, each proven rather than assumed: (d) the
 *   port from Babylon's start over every box in the SHIPPED scene's order —
 *   if that agrees to 1e-6, the tie order was the whole of it ("tie order");
 *   (e) failing that, Babylon over UNMERGED boxes in that same order, which
 *   must equal (d) to the bit (`exact`'s claim, re-checked here), leaving the
 *   merged clusters' vertices as the only difference ("merge"). Tie order
 *   matters because a start already inside two boxes meets both at distance
 *   0, the first one tested wins and its plane sets the slide — it moved
 *   hulls by metres before `RayWorld` ranked its candidates in the client's
 *   order. Against the client's scene that rank IS the reference's order, so
 *   a sample (d) explains is not explained at all: it means the rank is
 *   wrong, and fails ("tie order: RANK WRONG"); against the server's scene it
 *   is the deliberate difference. Anything with no tag is UNEXPLAINED and
 *   fails, and so does a sample of 3 cm or more that only the start explains,
 *   with no knife edge to show for it; a deliberate difference explains a
 *   sample at any size, and is printed either way.
 * - **`walk`** chains sweeps into trajectories, because a sub-micrometre
 *   difference per move is only harmless if it does not COMPOUND. Both sides
 *   start a body at the same open spot near some colliders and feed it the
 *   same input every frame at the fixed step (1/60 s): the player at
 *   `moveSpeed` (sometimes `sprintMult` faster), turning every second or so
 *   toward a collider near the REFERENCE body — so both bodies get one stick
 *   and it steers them into walls, along them and into corners — with
 *   `Player.update`'s vertical model (gravity, the ground probe over the
 *   terrain and `ObstacleField.groundAt`, the grounded step stick, the snap;
 *   no deck, no `freeFromProps`); a hull at its kind's `drive.maxSpeed` on a
 *   seeded, slowly wandering steer within `drive.turnRate`, its offset
 *   re-aimed every frame as `Vehicle.aimCollider` does, its height held at
 *   the terrain plus half the hull. Babylon is the shipped scene as in
 *   `shipped` (`--reference` applies), both sides from float64 state. A THIRD body runs the port
 *   from Babylon's float32 start every frame, which takes the start out:
 *   what it drifts by is the tie order and the merge, and what ours drifts
 *   by beyond that is the start. It reports how far each pair drifted apart
 *   and when; it does not fail, because whether a drift matters is a
 *   judgement and the user's (BABYLON_EXIT.md X2.1). A drift that grows to
 *   metres is not by itself a body through a wall — a hull wedged against a
 *   corner at full speed is chaotic, and the two can each take a path
 *   Babylon itself takes from that state — so replay it before reading it.
 *
 * The starts of `exact` and `shipped` are drawn round a random collider
 * (never a map-sized rim box), in that box's turned frame: mostly at or just
 * short of contact, the tangential coordinate running a little past the face
 * so corners come up, and about a tenth deliberately EMBEDDED, because the
 * ejection path is where this algorithm is strangest. Heights span the box's
 * band plus the ellipsoid's own vertical radius. Steps are a frame's worth,
 * mostly toward the box, one in seven twenty times that so the retries and
 * long slides run, and a tenth with a vertical part. Six synthetic HULLS, two
 * of each kind's box, stand beside random colliders so the movers path —
 * `rays.hulls`, last in the list as a hull built after the map was last in
 * `scene.meshes` — is exercised, and an eighth of the starts are drawn round
 * them.
 *
 * The counts: `blocked` is a sample Babylon did not let go where the step
 * pointed (by more than 1e-6). `embedded` is a start whose ellipsoid overlaps
 * ANY box near it, measured rather than drawn (a pitched box by its unpitched
 * footprint, so a count and not a verdict), and `in anchor` those inside the
 * box the sample was drawn round. Expect `embedded` near half: a building is
 * floor slabs and party walls laid flush, so a start at a random height beside
 * one of them is very often already in the next. `regathered` is a sweep
 * whose path outran its first list, `whole map` one that fell through to every
 * box on the map — both a COST, never a failure.
 *
 * `--body` and `--seq` narrow a run to one body and (in `walk`) one sequence,
 * which with the map and `--seed` is everything needed to replay a case the
 * summary printed; `--trace` then prints every frame of a `walk` where a
 * drift moved by more than 0.1 mm, with all three bodies' positions. Exits 1 on a failure as each mode defines it, or a
 * reference that cannot be trusted. Deleted with Babylon at X6.1, when there
 * is nothing left to compare with.
 */
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const VALUED = new Set(["--samples", "--seed", "--mode", "--body", "--seq", "--reference"]);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const MODE = opt("--mode", "exact");
const SEED = Number(opt("--seed", 1));
const TIGHT = args.includes("--tight");
const ONLY_BODY = opt("--body", null);
const ONLY_SEQ = opt("--seq", null) === null ? null : Number(opt("--seq", null));
const TRACE = args.includes("--trace");
/** `shipped` and `walk`'s Babylon world: the client's collider scene, or the authority's. */
const REFERENCE = opt("--reference", "client");
const named = args.filter((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1]));

/** How many failing samples are printed in full before the rest are only counted. */
const SHOW = 6;
/** A step this much shorter than asked was blocked, not rounded. */
const BLOCKED = 1e-6;
/**
 * `--tight`'s two gathers, both with a first reach a quarter of the step and
 * no margin. The first re-gathers once at the reach the path needed, which
 * almost always suffices — a re-run over the longer list slides no farther —
 * so it all but never reaches the whole map; the second goes straight there.
 * Between them both arms of `sweepFrom`'s loop run, and both must agree.
 */
const TIGHT_KNOBS = [
  { stepShare: 0.25, margin: 0, regathers: 1 },
  { stepShare: 0.25, margin: 0, regathers: 0 },
];
/** `shipped`'s histogram, upper bounds in metres; the last bucket is the rest. */
const BUCKETS = [
  ["0", 0],
  ["<1e-9", 1e-9],
  ["<1e-6", 1e-6],
  ["<1e-4", 1e-4],
  ["<1mm", 1e-3],
  ["<1cm", 1e-2],
  ["<3cm", 3e-2],
  [">=3cm", Infinity],
];
/** `walk`'s fixed step, and frames a sequence. */
const DT = 1 / 60;
const WALK_FRAMES = { player: 600, tank: 900, truck: 900, heli: 900 };

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
// The bodies, off CONFIG as their owners derive them.

/**
 * The player's capsule (`Player`'s constructor): no offset. The hull's sphere
 * (`Vehicle`'s constructor and `aimCollider`): lifted half the climb band and
 * carried `bias` along the yaw to whichever end leads.
 */
function bodiesOf(CONFIG) {
  const p = CONFIG.player;
  const list = [
    {
      name: "player",
      radii: { x: p.radius, y: p.height / 2 - 0.05, z: p.radius },
      offsetAt: () => [0, 0, 0],
      step: [0.04, 0.12],
    },
  ];
  for (const kind of ["tank", "truck", "heli"]) {
    const t = CONFIG.vehicles[kind];
    const r = t.drive.collideRadius;
    const bias = t.hull.length / 2 - r;
    list.push({
      name: kind,
      spec: t,
      radii: { x: r, y: (t.hull.height - t.drive.climbHeight) / 2, z: r },
      offsetAt: (yaw, lead) => [Math.sin(yaw) * bias * lead, t.drive.climbHeight / 2, Math.cos(yaw) * bias * lead],
      step: [0.05, 0.2],
    });
  }
  return ONLY_BODY ? list.filter((b) => b.name === ONLY_BODY) : list;
}

// ---------------------------------------------------------------------------
// Moving a body, both ways.

/** Babylon's position callback: the displacement kept only past the epsilon. */
function writeBack(env, position, centre, r, to) {
  const dx = r.x - centre[0];
  const dy = r.y - centre[1];
  const dz = r.z - centre[2];
  to.x = position[0];
  to.y = position[1];
  to.z = position[2];
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) > env.COLLISIONS_EPSILON) {
    to.x += dx;
    to.y += dy;
    to.z += dz;
  }
}

/** Ours from Babylon's own start: the float32 position plus the offset. */
function oursFromFloat32(env, field, position, radii, offset, step, to) {
  const c = [
    Math.fround(position[0]) + offset[0],
    Math.fround(position[1]) + offset[1],
    Math.fround(position[2]) + offset[2],
  ];
  const r = field.sweepFrom(c[0], c[1], c[2], radii, { x: step[0], y: step[1], z: step[2] }, null);
  writeBack(env, position, c, r, to);
}

/** Ours as production moves a body: `field.move` on a plain one, float64 throughout. */
function oursMove(field, position, radii, offset, step, to) {
  const body = {
    position: {
      x: position[0],
      y: position[1],
      z: position[2],
      set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
      },
    },
    ellipsoid: radii,
    ellipsoidOffset: { x: offset[0], y: offset[1], z: offset[2] },
  };
  field.move(body, { x: step[0], y: step[1], z: step[2] }, null);
  to.x = body.position.x;
  to.y = body.position.y;
  to.z = body.position.z;
}

/** Babylon's, by a probe mesh; `near` narrows the walk, null walks the scene. */
function babylonMove(env, probe, position, radii, offset, step, near, to) {
  const { B } = env;
  probe.ellipsoid = new B.Vector3(radii.x, radii.y, radii.z);
  probe.ellipsoidOffset = new B.Vector3(...offset);
  probe.position.set(...position);
  probe.surroundingMeshes = near;
  probe.computeWorldMatrix(true);
  probe.moveWithCollisions(new B.Vector3(...step));
  to.x = probe.position.x;
  to.y = probe.position.y;
  to.z = probe.position.z;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const same = (a, b) => Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z);

// ---------------------------------------------------------------------------
// The worlds.

async function buildWorld(env, def) {
  const engine = new env.B.NullEngine();
  const scene = new env.B.Scene(engine);
  const map = await env.buildServerWorld(scene, def);
  if (map.rays.hulls.length !== 0) {
    throw new Error(`${def.id}: the server world arrived with ${map.rays.hulls.length} hulls; the reference has none`);
  }
  const anchors = map.colliderBoxes.filter((b) => !(b.w > 200 || b.d > 200));
  return { engine, scene, map, anchors };
}

/**
 * Every mesh a sweep walks must answer `getMaterial()` with something, or
 * Babylon culls back faces the port tests (`ellipsoidSweep.ts`). In this game
 * that is the scene's default material; checked per mesh, so a reference built
 * some other way fails here rather than comparing against another algorithm.
 */
function checkMaterials(scene, label) {
  let walked = 0;
  for (const mesh of scene.meshes) {
    if (!mesh.checkCollisions) continue;
    walked++;
    for (const sub of mesh.subMeshes ?? []) {
      if (sub.getMaterial() == null) {
        throw new Error(`${label}: collider mesh ${mesh.name} has no material, so Babylon would cull its back faces`);
      }
    }
  }
  if (!walked) throw new Error(`${label}: the reference scene has no collider meshes`);
}

/** `exact`'s reference: a box as `MapBuilder.collider` made one before the merge. */
/**
 * The order the CLIENT made its collider meshes in, as box indices: every box
 * no scatter cluster holds, in collider order, then each `boxGroups` cluster's
 * boxes, cluster by cluster (`MapBuilder.clusterColliders` runs once, after
 * every region, and nothing makes a collider after it). It is the order
 * `RayWorld` ranks a sweep's candidates by, so a reference built in it breaks
 * ties as the port does.
 */
function clientOrder(map) {
  const grouped = new Set(map.boxGroups.flat());
  return [...map.colliderBoxes.keys()].filter((i) => !grouped.has(i)).concat(map.boxGroups.flat());
}

/** The AUTHORITY's under Babylon (`buildServerWorld`): every cluster first, then the rest. */
function serverOrder(map) {
  const grouped = new Set(map.boxGroups.flat());
  return map.boxGroups.flat().concat([...map.colliderBoxes.keys()].filter((i) => !grouped.has(i)));
}

/** A box's own collider mesh, as `MapBuilder.boxMesh` and `collider()` made it. */
function boxMesh(B, scene, name, box) {
  const mesh = B.MeshBuilder.CreateBox(name, { width: box.w, height: box.h, depth: box.d }, scene);
  mesh.position.set(box.cx, box.cy, box.cz);
  mesh.rotation.set(box.rotX, box.rotY, 0);
  mesh.isVisible = false;
  mesh.checkCollisions = true;
  return mesh;
}

/** `exact`'s reference, and (e)'s: one mesh per box, created in the order `ids` gives. */
function oneMeshPerBox(env, engine, map, ids) {
  const { B } = env;
  const scene = new B.Scene(engine);
  const meshOf = new Map();
  for (const i of ids) {
    const box = map.colliderBoxes[i];
    const mesh = boxMesh(B, scene, `c${i}`, box);
    mesh.freezeWorldMatrix();
    meshOf.set(box, mesh);
  }
  return { scene, meshOf };
}

/**
 * The CLIENT's shipped collider scene: every box no cluster holds as its own
 * mesh, in collider order, then each cluster MERGED as
 * `MapBuilder.clusterColliders` merges it — a cluster of one kept as its mesh —
 * in `boxGroups` order.
 */
function clientScene(env, engine, map) {
  const { B } = env;
  const scene = new B.Scene(engine);
  const grouped = new Set(map.boxGroups.flat());
  map.colliderBoxes.forEach((box, i) => {
    if (!grouped.has(i)) boxMesh(B, scene, `c${i}`, box).freezeWorldMatrix();
  });
  map.boxGroups.forEach((group, g) => {
    const parts = group.map((i, j) => boxMesh(B, scene, `cluster${g}-${j}`, map.colliderBoxes[i]));
    const mesh = parts.length === 1 ? parts[0] : B.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!mesh) throw new Error(`cluster ${g} failed to merge`);
    mesh.name = `cluster${g}`;
    mesh.isVisible = false;
    mesh.checkCollisions = true;
    mesh.freezeWorldMatrix();
  });
  return scene;
}

/**
 * `shipped` and `walk`'s Babylon world. The client's is the default, because
 * it is the scene the feel was tuned in and the order `RayWorld` ranks by; the
 * server's (`--reference server`) is the authority's own, clusters first.
 */
function shippedReference(env, engine, serverScene, map) {
  if (REFERENCE === "server") return { scene: serverScene, ids: serverOrder(map) };
  return { scene: clientScene(env, engine, map), ids: clientOrder(map) };
}

/**
 * Six hull boxes, two of each kind, each standing on the floor beside a random
 * collider at a random yaw. Babylon gets them as meshes built after the map;
 * ours as `RayHull`s in `rays.hulls`, which `bodyNear` hands over last.
 */
function addHulls(env, scene, map, rand, anchors, meshOf) {
  const { B, CONFIG } = env;
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
    const mesh = B.MeshBuilder.CreateBox(`hull${hulls.length}`, { width: box.w, height: box.h, depth: box.d }, scene);
    mesh.position.set(box.cx, box.cy, box.cz);
    mesh.rotation.y = box.rotY;
    mesh.checkCollisions = true;
    mesh.computeWorldMatrix(true);
    map.rays.hulls.push({ rayBox: () => box });
    meshOf?.set(box, mesh);
    hulls.push(box);
  }
  return hulls;
}

/**
 * A `RayWorld` as far as `CollisionField` can tell, counting what it is asked:
 * how often the gather fell through to the whole map, and the list the last
 * sweep was run over (the field's own array, refilled in place).
 */
function countingRays(rays) {
  return {
    whole: 0,
    last: null,
    bodyNear(x, z, reach, skip, out) {
      if (reach === Infinity) this.whole++;
      this.last = out;
      return rays.bodyNear(x, z, reach, skip, out);
    },
  };
}

// ---------------------------------------------------------------------------
// Sampling single moves (`exact`, `shipped`).

/**
 * One start and one step round `box`, in its turned frame. The ellipsoid's
 * CENTRE is drawn and the body's position backed out of it, so the offset
 * sphere of a hull is what touches the box.
 */
function drawSample(rand, box, body) {
  const rx = body.radii.x;
  const ry = body.radii.y;
  const offset = body.offsetAt(rand() * Math.PI * 2, rand() < 0.5 ? 1 : -1);
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

/** Whether a start is embedded in anything near it, and in its own anchor. */
function embedding(map, smp, body, anchor, scratch) {
  const r = body.radii.x;
  const ry = body.radii.y;
  map.rays.bodyNear(smp.centre[0], smp.centre[2], r + 1, null, scratch);
  return {
    any: scratch.some((b) => overlaps(smp.centre, r, ry, b)),
    anchor: overlaps(smp.centre, r, ry, anchor),
  };
}

/** A small stable hash, so a stream does not depend on which maps were named. */
function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
const streamSeed = (key) => (Math.imul(SEED, 0x9e3779b1) ^ hashOf(key)) >>> 0;

/** The anchor of the next sample: a synthetic hull an eighth of the time. */
const anchorOf = (rand, hulls, anchors) =>
  rand() < 0.12 ? hulls[Math.floor(rand() * hulls.length)] : anchors[Math.floor(rand() * anchors.length)];

const reproduce = (def, body, n, smp) =>
  `  replay   node scripts/sweep-check.mjs ${def.id} --mode ${MODE} --seed ${SEED} --body ${body.name}${TIGHT ? " --tight" : ""} (sample ${n})\n` +
  `  radii    ${JSON.stringify([body.radii.x, body.radii.y, body.radii.z])}\n` +
  `  position ${JSON.stringify(smp.position)}\n` +
  `  offset   ${JSON.stringify(smp.offset)}\n` +
  `  step     ${JSON.stringify(smp.step)}`;

const fmt = (v) => (v === 0 ? "0" : v.toExponential(2));

// ---------------------------------------------------------------------------
// `exact`

async function runExact(env, def, state) {
  const { B, CONFIG, CollisionField, mulberry32 } = env;
  const { engine, scene: serverScene, map, anchors } = await buildWorld(env, def);
  const { scene, meshOf } = oneMeshPerBox(env, engine, map, clientOrder(map));
  const rand = mulberry32(streamSeed(def.id));
  const hulls = addHulls(env, scene, map, rand, anchors, meshOf);
  checkMaterials(scene, def.id);
  const probe = new B.Mesh("probe", scene);
  const fields = (TIGHT ? TIGHT_KNOBS : [{}]).map((knobs) => {
    const counting = countingRays(map.rays);
    return { counting, field: new CollisionField(counting, knobs), ours: { x: 0, y: 0, z: 0 } };
  });
  const regathers = () => fields.reduce((a, f) => a + f.field.regathered, 0);
  const wholes = () => fields.reduce((a, f) => a + f.counting.whole, 0);
  const near = [];
  const scratch = [];
  const theirs = { x: 0, y: 0, z: 0 };
  const narrowed = { x: 0, y: 0, z: 0 };
  for (const body of bodiesOf(CONFIG)) {
    const row = {
      map: def.id, body: body.name, samples: 0, blocked: 0, embedded: 0, inAnchor: 0,
      regathered: 0, whole: 0, identical: 0, oursMs: 0, narrowMs: 0, wholeMs: 0,
    };
    const regathered0 = regathers();
    const whole0 = wholes();
    for (let n = 0; n < state.samples; n++) {
      const anchor = anchorOf(rand, hulls, anchors);
      const smp = drawSample(rand, anchor, body);
      let t = performance.now();
      oursFromFloat32(env, fields[0].field, smp.position, body.radii, smp.offset, smp.step, fields[0].ours);
      row.oursMs += performance.now() - t;
      // The list our final gather held, as the reference's meshes, in its order.
      near.length = 0;
      for (const box of fields[0].counting.last) near.push(meshOf.get(box));
      for (let i = 1; i < fields.length; i++) {
        oursFromFloat32(env, fields[i].field, smp.position, body.radii, smp.offset, smp.step, fields[i].ours);
      }
      t = performance.now();
      babylonMove(env, probe, smp.position, body.radii, smp.offset, smp.step, near, narrowed);
      row.narrowMs += performance.now() - t;
      t = performance.now();
      babylonMove(env, probe, smp.position, body.radii, smp.offset, smp.step, null, theirs);
      row.wholeMs += performance.now() - t;

      row.samples++;
      const emb = embedding(map, smp, body, anchor, scratch);
      if (emb.any) row.embedded++;
      if (emb.anchor) row.inAnchor++;
      const free = Math.hypot(
        theirs.x - smp.position[0] - smp.step[0],
        theirs.y - smp.position[1] - smp.step[1],
        theirs.z - smp.position[2] - smp.step[2],
      );
      if (free > BLOCKED) row.blocked++;
      const okOurs = fields.every((f) => same(f.ours, theirs));
      const okNarrow = same(narrowed, theirs);
      if (okOurs && okNarrow) {
        row.identical++;
        continue;
      }
      state.failures++;
      if (state.failures <= SHOW) {
        console.log(
          `DIFF ${def.id} ${body.name} sample ${n}${okNarrow ? "" : " (Babylon NARROWED disagrees with Babylon whole: the gather was not a superset)"}\n` +
            `${reproduce(def, body, n, smp)}\n` +
            `  babylon  ${JSON.stringify([theirs.x, theirs.y, theirs.z])}\n` +
            `  narrowed ${JSON.stringify([narrowed.x, narrowed.y, narrowed.z])}\n` +
            fields
              .map(
                ({ ours }, i) =>
                  `  ours${fields.length > 1 ? ` (gather ${i})` : ""} ${JSON.stringify([ours.x, ours.y, ours.z])}, ` +
                  `ours - babylon ${JSON.stringify([ours.x - theirs.x, ours.y - theirs.y, ours.z - theirs.z])}`,
              )
              .join("\n"),
        );
      }
    }
    row.regathered = regathers() - regathered0;
    row.whole = wholes() - whole0;
    state.rows.push(row);
  }
  scene.dispose();
  serverScene.dispose();
  engine.dispose();
  return map.colliderBoxes.length;
}

function reportExact(state) {
  const us = (ms, n) => ((ms * 1000) / n).toFixed(1);
  table(
    ["map", "body", "samples", "blocked", "embedded", "in anchor", "regathered", "whole map", "identical", "µs ours", "µs babylon", "µs whole"],
    state.rows.map((r) => [
      r.map, r.body, r.samples, r.blocked, r.embedded, r.inAnchor, r.regathered, r.whole, r.identical,
      us(r.oursMs, r.samples), us(r.narrowMs, r.samples), us(r.wholeMs, r.samples),
    ]),
  );
  const samples = sum(state.rows, "samples");
  const identical = sum(state.rows, "identical");
  console.log(
    `\n${identical} of ${samples} identical${TIGHT ? ` with --tight (${sum(state.rows, "regathered")} re-gathered, ${sum(state.rows, "whole")} fell through to the whole map)` : ""}.` +
      " µs babylon is Babylon narrowed to our final gather; µs whole is its walk of the whole reference scene.",
  );
  if (state.failures) console.log(`FAILED: ${state.failures} samples differ${state.failures > SHOW ? ` (the first ${SHOW} printed)` : ""}`);
  return state.failures > 0;
}

// ---------------------------------------------------------------------------
// `shipped`

async function runShipped(env, def, state) {
  const { B, CONFIG, mulberry32 } = env;
  const { engine, scene: serverScene, map, anchors } = await buildWorld(env, def);
  const { scene, ids } = shippedReference(env, engine, serverScene, map);
  const rand = mulberry32(streamSeed(def.id));
  const hulls = addHulls(env, scene, map, rand, anchors, null);
  checkMaterials(scene, def.id);
  const probe = new B.Mesh("probe", scene);
  const field = map.collidables;
  const order = shippedOrder(map, hulls, ids);
  // Built on the first sample that needs it: unmerged boxes in the shipped
  // scene's order, which is (e)'s reference.
  let unmerged = null;
  const scratch = [];
  const ours = { x: 0, y: 0, z: 0 };
  const theirs = { x: 0, y: 0, z: 0 };
  const fromF32 = { x: 0, y: 0, z: 0 };
  const nudged = { x: 0, y: 0, z: 0 };
  const inOrder = { x: 0, y: 0, z: 0 };
  const unmergedAns = { x: 0, y: 0, z: 0 };
  for (const body of bodiesOf(CONFIG)) {
    const row = {
      map: def.id, body: body.name, samples: 0, blocked: 0, embedded: 0, inAnchor: 0,
      hist: BUCKETS.map(() => 0), worst: 0, oursMs: 0, babylonMs: 0,
      start: 0, ties: 0, merge: 0, knife: 0, unexplained: 0,
    };
    for (let n = 0; n < state.samples; n++) {
      const anchor = anchorOf(rand, hulls, anchors);
      const smp = drawSample(rand, anchor, body);
      let t = performance.now();
      oursMove(field, smp.position, body.radii, smp.offset, smp.step, ours);
      row.oursMs += performance.now() - t;
      t = performance.now();
      babylonMove(env, probe, smp.position, body.radii, smp.offset, smp.step, null, theirs);
      row.babylonMs += performance.now() - t;

      row.samples++;
      const emb = embedding(map, smp, body, anchor, scratch);
      if (emb.any) row.embedded++;
      if (emb.anchor) row.inAnchor++;
      const free = Math.hypot(
        theirs.x - smp.position[0] - smp.step[0],
        theirs.y - smp.position[1] - smp.step[1],
        theirs.z - smp.position[2] - smp.step[2],
      );
      if (free > BLOCKED) row.blocked++;
      const d = same(ours, theirs) ? 0 : dist(ours, theirs);
      row.worst = Math.max(row.worst, d);
      row.hist[d === 0 ? 0 : BUCKETS.findIndex(([, top], i) => i > 0 && d < top)]++;
      if (d <= 1e-3) continue;

      // (a) The start: ours again from Babylon's float32 start.
      oursFromFloat32(env, field, smp.position, body.radii, smp.offset, smp.step, fromF32);
      const da = dist(fromF32, theirs);
      // (b) Babylon against itself, from starts a float32 step to either side.
      // A nudge smaller than the float32 spacing at that coordinate would be
      // rounded away by the very matrix Babylon reads its start from, so the
      // nudge is that spacing, never under a micrometre.
      let spread = 0;
      const answers = [{ ...theirs }];
      for (const [axis, sign] of [[0, 1], [0, -1], [2, 1], [2, -1]]) {
        const p = [...smp.position];
        p[axis] += sign * nudgeAt(p[axis]);
        babylonMove(env, probe, p, body.radii, smp.offset, smp.step, null, nudged);
        for (const a of answers) spread = Math.max(spread, dist(a, nudged));
        answers.push({ ...nudged });
      }
      // (c) The same question below the float32 spacing, which (b) cannot ask:
      // Babylon cannot be STARTED between two float32 positions, but the port
      // is Babylon's arithmetic from any start (`exact`), so it can. Starts
      // along the segment between our float64 centre and Babylon's float32
      // one — the only difference between the two runs — and a 1e-7 jitter on
      // each axis round ours.
      const fine = fineSpread(env, field, smp, body);
      // (d) Tie order: the port from Babylon's float32 start over every box
      // in the REFERENCE scene's own mesh order (`ids`: the client's by
      // default, clusters first under `--reference server`) rather than
      // `RayWorld`'s rank. A start already inside two
      // boxes meets both at distance 0, the first one tested wins and its
      // plane sets the slide, so the order is the answer there.
      orderedSweep(env, order, smp, body, inOrder);
      const dd = dist(inOrder, theirs);
      // (e) The merge: if the scene order did not account for it, Babylon over
      // UNMERGED boxes in that same order. It equals (d) by `exact`'s proof,
      // so what is left between it and the shipped answer is the merged
      // clusters' baked vertices.
      let de = Infinity;
      if (da >= 1e-6 && dd >= 1e-6) {
        unmerged ??= unmergedInOrder(env, engine, map, hulls, ids);
        babylonMove(env, unmerged.probe, smp.position, body.radii, smp.offset, smp.step, null, unmergedAns);
        if (same(unmergedAns, inOrder)) de = dist(unmergedAns, theirs);
        else {
          state.failures++;
          console.log(`FAIL ${def.id} ${body.name} sample ${n}: Babylon over unmerged boxes in scene order disagrees with the port in that order`);
        }
      }
      const knife = spread >= d / 2;
      const fineKnife = fine >= d / 2;
      const tags = [];
      if (da < 1e-6) tags.push("start");
      else if (dd < 1e-6) tags.push("tie order");
      else if (de < Infinity) tags.push("merge");
      if (knife) tags.push("knife edge");
      else if (fineKnife) tags.push("knife edge (sub-f32)");
      // Against the CLIENT's scene the port ranks exactly as the reference was
      // built, so a sample only the order explains means the rank is WRONG —
      // not an explanation but the bug (d) is there to catch. Against the
      // server's scene, clusters first, it is the deliberate difference.
      const rankWrong = REFERENCE === "client" && tags.includes("tie order");
      const shown = rankWrong ? ["tie order: RANK WRONG"] : tags;
      const explained = shown.length > 0 && !rankWrong;
      const verdict = shown.length ? shown.join(" + ") : "UNEXPLAINED";
      if (!explained) row.unexplained++;
      else if (knife || fineKnife) row.knife++;
      else if (shown.includes("tie order")) row.ties++;
      else if (shown.includes("merge")) row.merge++;
      else row.start++;
      // A deliberate difference is an explanation at any size — but only for
      // the share of the divergence it accounts for. (d) and (e) are proven
      // from Babylon's float32 start, so what separates OUR answer from that
      // start's is the start alone, and it must be the smaller share or the
      // sample is a start divergence wearing a merge's tag. A start that
      // explains 3 cm without a knife edge to show for it is not explained.
      const startShare = dist(ours, fromF32);
      const deliberate =
        (shown.includes("tie order") || shown.includes("merge")) && startShare < d / 2;
      const fails = !explained || (d >= 3e-2 && !knife && !fineKnife && !deliberate);
      if (fails) state.failures++;
      console.log(
        `${fails ? "FAIL" : "over 1mm"} ${def.id} ${body.name} sample ${n}: ${verdict} — ` +
          `|ours - babylon| ${fmt(d)}, from the float32 start ${fmt(da)}, in scene order ${fmt(dd)}, ` +
          `${de < Infinity ? `unmerged in scene order ${fmt(de)}, ` : ""}` +
          `Babylon's own spread ${fmt(spread)}, the port's below float32 ${fmt(fine)}${emb.any ? ", embedded" : ""}`,
      );
      if (fails || state.verbose) {
        console.log(
          `${reproduce(def, body, n, smp)}\n` +
            `  babylon  ${JSON.stringify([theirs.x, theirs.y, theirs.z])}\n` +
            `  ours     ${JSON.stringify([ours.x, ours.y, ours.z])}\n` +
            `  ours f32 ${JSON.stringify([fromF32.x, fromF32.y, fromF32.z])}`,
        );
      }
    }
    state.rows.push(row);
  }
  unmerged?.scene.dispose();
  scene.dispose();
  if (scene !== serverScene) serverScene.dispose();
  engine.dispose();
  return map.colliderBoxes.length;
}

/**
 * Where each box stands in the REFERENCE scene's mesh order — `ids`, which is
 * the client's (single boxes in collider order, then each cluster in
 * `boxGroups` order) by default and the authority's (clusters first) under
 * `--reference server` — then the hulls as `addHulls` built them.
 */
function shippedOrder(map, hulls, ids) {
  const rank = new Map();
  for (const i of ids) rank.set(map.colliderBoxes[i], rank.size);
  for (const box of hulls) rank.set(box, rank.size);
  return { map, rank, list: [], sweep: null, res: { x: 0, y: 0, z: 0, path: 0 } };
}

/** The port from Babylon's float32 start, over every body box in the shipped scene's order. */
function orderedSweep(env, order, smp, body, to) {
  const { map, rank, list, res } = order;
  map.rays.bodyNear(smp.centre[0], smp.centre[2], Infinity, null, list);
  list.sort((a, b) => rank.get(a) - rank.get(b));
  order.sweep ??= new env.EllipsoidSweep();
  const p = smp.position;
  const o = smp.offset;
  const c = [Math.fround(p[0]) + o[0], Math.fround(p[1]) + o[1], Math.fround(p[2]) + o[2]];
  order.sweep.begin(body.radii.x, body.radii.y, body.radii.z);
  for (const box of list) order.sweep.addBox(box);
  order.sweep.run(c[0], c[1], c[2], smp.step[0], smp.step[1], smp.step[2], res);
  writeBack(env, p, c, res, to);
}

/** One mesh per box, in the shipped scene's order, and the same hulls after them. */
function unmergedInOrder(env, engine, map, hulls, ids) {
  const { B } = env;
  const { scene } = oneMeshPerBox(env, engine, map, ids);
  for (const [i, box] of hulls.entries()) {
    const mesh = B.MeshBuilder.CreateBox(`uhull${i}`, { width: box.w, height: box.h, depth: box.d }, scene);
    mesh.position.set(box.cx, box.cy, box.cz);
    mesh.rotation.y = box.rotY;
    mesh.checkCollisions = true;
    mesh.computeWorldMatrix(true);
  }
  checkMaterials(scene, "unmerged reference");
  return { scene, probe: new B.Mesh("probe", scene) };
}

/**
 * The spread of the port's answers from starts below the float32 spacing:
 * along the segment from the float64 centre to the float32 one, and a 1e-7
 * jitter on each axis of the float64 centre. Each answer is written back onto
 * the sample's position, so they compare as `move` results do.
 */
function fineSpread(env, field, smp, body) {
  const p = smp.position;
  const o = smp.offset;
  const c64 = [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  const c32 = [Math.fround(p[0]) + o[0], Math.fround(p[1]) + o[1], Math.fround(p[2]) + o[2]];
  const starts = [];
  for (const t of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
    starts.push(c64.map((v, i) => v + (c32[i] - v) * t));
  }
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [1, -1]) {
      const c = [...c64];
      c[axis] += sign * 1e-7;
      starts.push(c);
    }
  }
  const step = { x: smp.step[0], y: smp.step[1], z: smp.step[2] };
  const answers = starts.map((c) => {
    const r = field.sweepFrom(c[0], c[1], c[2], body.radii, step, null);
    const to = { x: 0, y: 0, z: 0 };
    writeBack(env, p, c, r, to);
    return to;
  });
  let spread = 0;
  for (let i = 0; i < answers.length; i++) {
    for (let j = i + 1; j < answers.length; j++) spread = Math.max(spread, dist(answers[i], answers[j]));
  }
  return spread;
}

/** The float32 spacing at `v`, floored at a micrometre. */
function nudgeAt(v) {
  const f = Math.fround(v);
  const up = Math.fround(f + Math.max(Math.abs(f) * 2 ** -23, 2 ** -149));
  return Math.max(1e-6, Math.abs(up - f));
}

function reportShipped(state) {
  const us = (ms, n) => ((ms * 1000) / n).toFixed(1);
  table(
    ["map", "body", "samples", "blocked", "embedded", ...BUCKETS.map(([k]) => k), "worst", "start", "ties", "merge", "knife", "unexpl.", "µs ours", "µs babylon"],
    state.rows.map((r) => [
      r.map, r.body, r.samples, r.blocked, r.embedded, ...r.hist, fmt(r.worst), r.start, r.ties, r.merge, r.knife, r.unexplained,
      us(r.oursMs, r.samples), us(r.babylonMs, r.samples),
    ]),
  );
  const total = BUCKETS.map((_, i) => state.rows.reduce((a, r) => a + r.hist[i], 0));
  console.log(`\nall: ${BUCKETS.map(([k], i) => `${k} ${total[i]}`).join(", ")}`);
  console.log(
    `over 1 mm: ${sum(state.rows, "start")} start, ${sum(state.rows, "ties")} tie order, ${sum(state.rows, "merge")} merge, ` +
      `${sum(state.rows, "knife")} knife edge, ${sum(state.rows, "unexplained")} UNEXPLAINED (a sample is counted once, knife edge first).` +
      " µs babylon is the shipped scene's whole walk (no narrowing), µs ours the production move.",
  );
  if (state.failures) console.log(`FAILED: ${state.failures} samples UNEXPLAINED, or 3 cm and more explained by the start alone`);
  return state.failures > 0;
}

// ---------------------------------------------------------------------------
// `walk`

/** `Player.probeGround` with no deck: the terrain, and the boxes in the band. */
function probeGround(env, map, pos) {
  const p = env.CONFIG.player;
  const ceiling = pos.y - p.height / 2 + p.stepHeight + 0.05;
  const floor = ceiling - p.groundProbeLength;
  let best = map.terrain.surfaceAt(pos.x, pos.z);
  const box = map.obstacles.groundAt(pos.x, pos.z, ceiling, floor);
  if (box !== null && box > best) best = box;
  return best;
}

/** `Player.update`'s vertical half after the sweep: gravity, the probe, the stick, the snap. */
function settle(env, map, s) {
  const p = env.CONFIG.player;
  s.velY -= p.gravity * DT;
  s.pos.y += s.velY * DT;
  const floorY = probeGround(env, map, s.pos);
  const foot = s.pos.y - p.height / 2;
  const stick = s.grounded ? p.stepHeight : 0;
  if (foot <= floorY + stick) {
    s.pos.y = floorY + p.height / 2;
    s.velY = 0;
    s.grounded = true;
  } else {
    s.grounded = false;
  }
}

/**
 * An open spot near a collider for this body: its ellipsoid overlapping
 * nothing, standing on the floor, facing the collider it was drawn beside.
 */
function openSpot(env, map, anchors, rand, body) {
  const r = body.radii.x;
  const near = [];
  for (let tries = 0; tries < 200; tries++) {
    const a = anchors[Math.floor(rand() * anchors.length)];
    const dir = rand() * Math.PI * 2;
    const far = Math.max(a.w, a.d) / 2 + r + 0.5 + rand() * 4;
    const x = a.cx + Math.cos(dir) * far;
    const z = a.cz + Math.sin(dir) * far;
    const yaw = Math.atan2(a.cx - x, a.cz - z);
    let y;
    if (body.spec) {
      y = map.terrain.heightAt(x, z) + body.spec.hull.height / 2;
    } else {
      const feet = map.terrain.surfaceAt(x, z);
      y = probeGround(env, map, { x, y: feet + env.CONFIG.player.height / 2, z }) + env.CONFIG.player.height / 2;
    }
    const off = body.offsetAt(yaw, 1);
    const c = [x + off[0], y + off[1], z + off[2]];
    map.rays.bodyNear(c[0], c[2], r + 1, null, near);
    if (near.some((b) => overlaps(c, r, body.radii.y, b))) continue;
    return { x, y, z, yaw };
  }
  return null;
}

/** Both sides' state for one body, and the one input stream they share. */
function walkSequence(env, map, anchors, probe, body, seq, defId) {
  const seed = streamSeed(`${defId}:${body.name}:${seq}`);
  const rand = env.mulberry32(seed);
  const spot = openSpot(env, map, anchors, rand, body);
  if (!spot) return null;
  const frames = WALK_FRAMES[body.name];
  const P = env.CONFIG.player;
  const mk = () => ({ pos: { x: spot.x, y: spot.y, z: spot.z }, velY: 0, grounded: true });
  // A third body runs ours from Babylon's float32 start, which takes the
  // start out of the comparison: what it drifts by is the merged triangles
  // and the tie order, and what `ours` drifts by beyond that is the start.
  const sides = { ours: mk(), theirs: mk(), f32: mk() };
  const near = [];
  const out = { x: 0, y: 0, z: 0 };
  const res = {
    seed, frames, blocked: 0, max: 0, max32: 0, last: 0, last32: 0, first: { 1e-3: -1, 1e-2: -1, 3e-2: -1 }, final: 0, oursMs: 0, babylonMs: 0,
  };
  let heading = spot.yaw;
  let sprint = false;
  let retarget = 0;
  let yaw = spot.yaw;
  let steer = 0;
  for (let f = 0; f < frames; f++) {
    let step;
    let offset;
    if (!body.spec) {
      // The stick: every second or so, toward a collider near the REFERENCE
      // body, so one input steers both into walls and corners.
      if (f >= retarget) {
        retarget = f + 40 + Math.floor(rand() * 40);
        const t = sides.theirs.pos;
        map.rays.bodyNear(t.x, t.z, 12, null, near);
        const pick = near.filter((b) => !(b.w > 200 || b.d > 200));
        const jitter = (rand() * 2 - 1) * 0.4;
        if (pick.length) {
          const b = pick[Math.floor(rand() * pick.length)];
          heading = Math.atan2(b.cx - t.x, b.cz - t.z) + jitter;
        } else {
          heading = rand() * Math.PI * 2;
        }
        sprint = rand() < 0.3;
      }
      const speed = P.moveSpeed * (sprint ? P.sprintMult : 1) * DT;
      step = [Math.sin(heading) * speed, 0, Math.cos(heading) * speed];
      offset = [0, 0, 0];
    } else {
      // The steer: a seeded wander, eased, inside the kind's turn rate.
      if (f % 30 === 0) steer = Math.max(-1, Math.min(1, steer * 0.5 + (rand() * 2 - 1)));
      yaw += steer * body.spec.drive.turnRate * DT;
      const v = body.spec.drive.maxSpeed * DT;
      step = [Math.sin(yaw) * v, 0, Math.cos(yaw) * v];
      offset = body.offsetAt(yaw, 1);
    }
    for (const side of ["ours", "theirs", "f32"]) {
      const s = sides[side];
      const before = [s.pos.x, s.pos.y, s.pos.z];
      const t = performance.now();
      if (side === "ours") oursMove(map.collidables, before, body.radii, offset, step, out);
      else if (side === "theirs") babylonMove(env, probe, before, body.radii, offset, step, null, out);
      else oursFromFloat32(env, map.collidables, before, body.radii, offset, step, out);
      const ms = performance.now() - t;
      if (side === "ours") {
        res.oursMs += ms;
        const asked = Math.hypot(out.x - before[0] - step[0], out.y - before[1] - step[1], out.z - before[2] - step[2]);
        if (asked > BLOCKED) res.blocked++;
      } else if (side === "theirs") {
        res.babylonMs += ms;
      }
      s.pos.x = out.x;
      s.pos.y = out.y;
      s.pos.z = out.z;
      if (body.spec) s.pos.y = map.terrain.heightAt(s.pos.x, s.pos.z) + body.spec.hull.height / 2;
      else settle(env, map, s);
    }
    const d = dist(sides.ours.pos, sides.theirs.pos);
    const d32 = dist(sides.f32.pos, sides.theirs.pos);
    if (TRACE && (Math.abs(d - res.last) > 1e-4 || Math.abs(d32 - res.last32) > 1e-4)) {
      const o = sides.ours.pos;
      const t = sides.theirs.pos;
      const g = sides.f32.pos;
      console.log(
        `  frame ${f}: drift ${fmt(res.last)} -> ${fmt(d)}, from float32 ${fmt(res.last32)} -> ${fmt(d32)}
` +
          `    ours    ${JSON.stringify([o.x, o.y, o.z])}
    babylon ${JSON.stringify([t.x, t.y, t.z])}
` +
          `    f32     ${JSON.stringify([g.x, g.y, g.z])}
    step ${JSON.stringify(step)}, offset ${JSON.stringify(offset)}`,
      );
    }
    res.last = d;
    res.last32 = d32;
    res.max = Math.max(res.max, d);
    for (const k of Object.keys(res.first)) if (res.first[k] < 0 && d > Number(k)) res.first[k] = f;
    res.final = d;
    res.max32 = Math.max(res.max32, d32);
  }
  return res;
}

async function runWalk(env, def, state) {
  const { B, CONFIG } = env;
  const { engine, scene: serverScene, map, anchors } = await buildWorld(env, def);
  const { scene } = shippedReference(env, engine, serverScene, map);
  checkMaterials(scene, def.id);
  const probe = new B.Mesh("probe", scene);
  for (const body of bodiesOf(CONFIG)) {
    const count = body.spec ? Math.max(1, Math.round(state.samples / 2)) : state.samples;
    const row = {
      map: def.id, body: body.name, sequences: 0, frames: 0, blocked: 0, max: 0,
      max32: 0, over32: 0, over: { 1e-3: 0, 1e-2: 0, 3e-2: 0 }, worstSeq: -1, worstFirst: -1, oursMs: 0, babylonMs: 0, skipped: 0,
    };
    for (let seq = 0; seq < count; seq++) {
      if (ONLY_SEQ !== null && seq !== ONLY_SEQ) continue;
      const res = walkSequence(env, map, anchors, probe, body, seq, def.id);
      if (!res) {
        row.skipped++;
        continue;
      }
      row.sequences++;
      row.frames += res.frames;
      row.blocked += res.blocked;
      row.oursMs += res.oursMs;
      row.babylonMs += res.babylonMs;
      row.max32 = Math.max(row.max32, res.max32);
      if (res.max32 > 1e-3) row.over32++;
      for (const k of Object.keys(row.over)) if (res.first[k] >= 0) row.over[k]++;
      if (res.max > row.max || row.worstSeq < 0) {
        row.max = res.max;
        row.worstSeq = seq;
        row.worstFirst = res.first[1e-3];
      }
      state.sequences.push({ map: def.id, body: body.name, seq, ...res });
    }
    state.rows.push(row);
  }
  scene.dispose();
  if (scene !== serverScene) serverScene.dispose();
  engine.dispose();
  return map.colliderBoxes.length;
}

function reportWalk(state) {
  const us = (ms, n) => (n ? ((ms * 1000) / n).toFixed(1) : "-");
  table(
    ["map", "body", "sequences", "frames", "blocked", "max drift", ">1mm", ">1cm", ">3cm", "worst seq", "its 1st >1mm", "f32 drift", "f32 >1mm", "µs ours", "µs babylon"],
    state.rows.map((r) => [
      r.map, r.body, r.sequences + (r.skipped ? ` (-${r.skipped})` : ""), r.frames, r.blocked, fmt(r.max),
      r.over[1e-3], r.over[1e-2], r.over[3e-2], r.worstSeq, r.worstFirst < 0 ? "-" : r.worstFirst, fmt(r.max32), r.over32,
      us(r.oursMs, r.frames), us(r.babylonMs, r.frames),
    ]),
  );
  const seqs = state.sequences;
  const n = seqs.length;
  const over = (k) => seqs.filter((s) => s.first[k] >= 0).length;
  console.log(
    `\n${n} sequences, ${sum(state.rows, "frames")} frames a side at dt 1/60: ` +
      `${over(1e-3)} ever drifted past 1 mm, ${over(1e-2)} past 1 cm, ${over(3e-2)} past 3 cm.` +
      ` From Babylon's float32 start, ${seqs.filter((s) => s.max32 > 1e-3).length} drifted past 1 mm (worst ${fmt(Math.max(0, ...seqs.map((s) => s.max32)))}).` +
      " blocked counts our frames whose sweep did not go where the step pointed.",
  );
  const worst = [...seqs].sort((a, b) => b.max - a.max).slice(0, SHOW).filter((s) => s.max > 0);
  if (worst.length) {
    console.log("\nthe worst sequences:");
    for (const s of worst) {
      console.log(
        `  ${s.map} ${s.body} seq ${s.seq} (stream ${s.seed}): max ${fmt(s.max)}, final ${fmt(s.final)}, from float32 ${fmt(s.max32)}, ` +
          `first past 1mm/1cm/3cm at frame ${s.first[1e-3]}/${s.first[1e-2]}/${s.first[3e-2]} of ${s.frames}\n` +
          `    replay: node scripts/sweep-check.mjs ${s.map} --mode walk --seed ${SEED} --body ${s.body} --seq ${s.seq}`,
      );
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The modes. Each runs a map into `state` and then reports it, returning
// whether the run failed.

const MODES = {
  exact: {
    help: "one collider mesh per box, Babylon's float32 start; every coordinate Object.is-equal",
    samples: 2000,
    run: runExact,
    report: reportExact,
  },
  shipped: {
    help: "the shipped merged scene against production's move; a histogram, every sample over 1 mm diagnosed",
    samples: 2000,
    run: runShipped,
    report: reportShipped,
  },
  walk: {
    help: "chained sweeps at dt 1/60 against the shipped merged scene; how far each pair drifts (samples = player sequences, hulls half)",
    samples: 40,
    run: runWalk,
    report: reportWalk,
  },
};

const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
function table(head, rows) {
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
  const line = (row) => row.map((c, i) => (i < 2 ? String(c).padEnd(width[i]) : String(c).padStart(width[i]))).join("  ");
  console.log(`\n${line(head)}`);
  for (const row of rows) console.log(line(row));
}

// ---------------------------------------------------------------------------

const mode = MODES[MODE];
if (!mode) {
  console.log(`unknown --mode ${MODE}; the modes are:`);
  for (const [k, m] of Object.entries(MODES)) console.log(`  ${k.padEnd(8)} ${m.help}`);
  process.exit(1);
}
if (TIGHT && MODE !== "exact") {
  console.log("--tight is exact's: shipped and walk run the production gather as it ships");
  process.exit(1);
}
if (REFERENCE !== "client" && REFERENCE !== "server") {
  console.log(`unknown --reference ${REFERENCE}: client (the default) or server`);
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
    ...(await server.ssrLoadModule("/src/world/CollisionField.ts")),
    EllipsoidSweep: (await server.ssrLoadModule("/src/world/ellipsoidSweep.ts")).EllipsoidSweep,
  };
  const { MAPS } = await server.ssrLoadModule("/src/world/maps.ts");
  // The proving ground is DEV-only and not a level: checked when named.
  const defs = named.length ? named.map((id) => MAPS.find((m) => m.id === id) ?? id) : MAPS.filter((m) => m.id !== "proving");
  const unknown = defs.filter((d) => typeof d === "string");
  if (unknown.length) throw new Error(`no such map: ${unknown.join(", ")} (the maps are ${MAPS.map((m) => m.id).join(", ")})`);
  if (ONLY_BODY && !bodiesOf(env.CONFIG).length) throw new Error(`no such body: ${ONLY_BODY}`);

  const samples = Number(opt("--samples", mode.samples));
  const ref = MODE === "exact" ? "" : ` --reference ${REFERENCE}`;
  console.log(`sweep-check --mode ${MODE}${TIGHT ? " --tight" : ""}${ref} (${mode.help}), --samples ${samples}, seed ${SEED}`);
  const state = { samples, rows: [], failures: 0, sequences: [] };
  for (const def of defs) {
    const t = performance.now();
    const boxes = await mode.run(env, def, state);
    console.log(`  ${def.id}: ${boxes} boxes, ${((performance.now() - t) / 1000).toFixed(1)} s`);
  }
  if (mode.report(state)) exitCode = 1;
  console.log(`\nsweep-check: ${defs.length} map(s) in ${((performance.now() - started) / 1000).toFixed(1)} s`);
} catch (e) {
  console.log(`sweep-check: ${e?.stack ?? e}`);
  exitCode = 1;
} finally {
  await server.close();
}
process.exit(exitCode);
