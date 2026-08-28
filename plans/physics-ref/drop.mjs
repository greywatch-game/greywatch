/**
 * The physics oracle: a fixed set of bodies dropped from fixed transforms onto
 * the static world, a fixed number of substeps, and a hash of where they came
 * to rest.
 *
 * Run with `node plans/physics-ref/drop.mjs [map...]`, `--check` to grade
 * against what is banked rather than replacing it, `--steps N` to lengthen the
 * settle. Resting sets land in `plans/physics-ref/ref/<map>.json`.
 *
 * **It exists because a physics change is the one class of change this tree had
 * no way to check.** `npm run parity` fingerprints the NAV GRAPH, and physics
 * is not in it; `plans/webgpu-ref/bank.mjs` diffs PIXELS, and nothing under
 * Havok is drawn in a frozen frame. So a change to `PhysicsWorld` — how the
 * map's colliders are grouped into shapes, which body they hang off, what order
 * they go in — could only ever be checked by looking at a corpse and deciding
 * it looked right. `ENGINE_UPGRADE.md` S5b is the change that made that
 * unacceptable: bucketing the static compound moves every collider in the world
 * into a different container, and "it looks the same" is not a test of what a
 * body rests ON.
 *
 * **The instrument is Havok's own determinism, and every run MEASURES how far
 * that goes rather than assuming it.** Given the same shapes in the same order,
 * the same bodies created in the same order and the same fixed step, the engine
 * produces the same floats: measured, the same drop repeated in a second
 * process comes back with an identical hash. What it does NOT survive is
 * repetition inside ONE process, where the engine already has the first drop's
 * history in it — so the write path runs the whole drop twice, prints how far
 * the two disagree as the run's own FLOOR, and refuses to bank a set whose
 * floor is over `REPRO_POS`. `bank.mjs` makes the same refusal about a frame
 * and for the same reason. An oracle that is not reproducible measures noise,
 * and every later change then reads as a regression.
 *
 * **A RESTING transform is the measurement, and that is what makes this robust
 * to the solver rather than a test of it.** A body in flight is chaotic — a
 * contact resolved in a different order sends it a different way, and a
 * regrouped compound legitimately changes contact order — so a hash taken mid
 * tumble would fail on a change that is entirely correct. A body at rest is at
 * the bottom of a well: it is lying on a particular face of a particular
 * collider, and no reordering inside the solver takes it off that face. So the
 * run settles first and asserts it settled, and the check path grades by
 * MAGNITUDE with the hash quoted beside it: an identical hash is proof nothing
 * moved at all, and a body within tolerance is proof it rests where it did.
 *
 * **What "within tolerance" means is mostly the HEIGHT**, which is the split
 * `compare` makes and the reason this is a test of anything. A collider that
 * left the world, arrived somewhere else or came across at the wrong size shows
 * up as a body resting at a different height — it drops to whatever is under
 * the thing that went missing. Sliding two centimetres along the same shelf
 * shows up laterally and is the solver: measured across the S5b bucketing, the
 * worst body on five maps moved 3.8 cm with under a millimetre of it vertical.
 *
 * **What it drops, and why it is dropped from where it is.** Sixty-four boxes
 * on a lattice over the play square, each offset inside its own cell by a
 * SEEDED hash rather than `Math.random()` — the same rule the world layer obeys
 * — because an unjittered lattice over a city grid lands every body on the same
 * relative spot of a block and tests one geometry sixty-four times. Each is
 * dropped 1.2 m above whatever `RayWorld.castBody` says is under it, which is a
 * roof as readily as the street: high enough to fall, land and topple, low
 * enough that it cannot arrive at a speed that makes the landing chaotic, and
 * never spawned inside a collider, which is the one start condition Havok does
 * not come out of the same way twice.
 *
 * **It reads `CONFIG.bots.death` for the step and the surface**, so it steps the
 * world exactly as a corpse does. That is deliberate coupling: retune the
 * substep, the gravity, the friction or the damping and this bank is stale and
 * must be re-taken, which is honest, because what those numbers describe is
 * what the bank is a picture of.
 *
 * **It also reports what the STEP costs with the pile alive**, which is the
 * other half of what S5b owes. Bucketing the static world trades one static
 * body for one per map block, and the plugin's per-step sync walks bodies — so
 * the number to watch is `step N ms total`, which is the whole settle with
 * sixty-four bodies falling and colliding, and the `us/step at rest` pair
 * beside it, which is the same walk with nothing moving in it at all. The pair
 * is the two runs, printed rather than averaged: the scatter between them is
 * the error bar on a figure the clock can barely see.
 *
 * **A bank is RE-TAKEN when the static world's construction legitimately moves,
 * and at no other time.** These four sets were re-taken on the far side of S5b
 * — the change was graded against the bank taken before it, which is what the
 * evidence is, and then the bank was replaced so the next change starts from
 * `identical` again rather than inheriting S5b's residue forever. Re-taking one
 * to make a failing check pass is the same mistake as re-taking a reference
 * frame from the shader under test: it is a test of nothing. Say so in the
 * commit, as `bank.mjs` asks.
 *
 * **The proving ground is not banked and `ref/.gitignore` says so.** Its extent
 * is an argument to `npm run proving`, so a ref taken at one regeneration is
 * meaningless at the next; run it there for a matched pair inside one session
 * and let the file stay untracked.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAP_IDS,
  bootMap,
  installRound,
  launchClient,
  root,
  startDevServer,
} from "../webgpu-ref/harness.mjs";

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const stepArg = args.indexOf("--steps");
const STEPS = stepArg >= 0 ? Number(args[stepArg + 1]) : 480;
const maps = args.filter(
  (a, i) => !a.startsWith("--") && !(stepArg >= 0 && i === stepArg + 1),
);
const targets = maps.length ? maps : MAP_IDS;

/** The lattice is `GRID x GRID` bodies over the play square. */
const GRID = 8;
/** How far above the surface under it each body starts. See the header. */
const DROP_HEIGHT = 1.2;
/**
 * How far a body at rest may still travel over the LAST TENTH of the run — a
 * millimetre over most of a second, which is a body that has stopped rather
 * than one that is creeping down a grade. See the rest test in `run`: it is a
 * displacement and not a velocity, and the comment there says why.
 */
const REST_DRIFT = 0.001;
/**
 * Substeps timed after everything has settled, to price the per-step walk.
 *
 * Long, because the number is small and the clock is coarse: 600 steps of a
 * ~30 us walk is 18 ms against a 100 us quantum, where a window of fifty
 * cannot tell 25 us from 55.
 */
const REST_WINDOW = 600;
/**
 * What a banked body may have moved before this is a regression: `TOL_Y`
 * vertically, `TOL_POS` in total, `TOL_ROT` on the unit quaternion (0.1 is
 * ~11.5 degrees).
 *
 * **The vertical bound is the strict one and it is the one that means
 * something.** A collider that left the world, arrived somewhere else or came
 * across at the wrong size shows up as a body resting at a different HEIGHT —
 * it drops to whatever is under the thing that went missing. A body that slid
 * a couple of centimetres along the same shelf shows up laterally and is the
 * solver, not the world: a regrouped compound resolves the same contacts in
 * another order, and measured across the S5b bucketing the worst body on the
 * five maps moved 3.8 cm with under a millimetre of it vertical. So the lateral
 * bound is a body's own longest dimension, which is the distance it would have
 * to travel to be resting on something else at the same height, and the
 * vertical one is five centimetres.
 */
const TOL_Y = 0.05;
const TOL_POS = 0.7;
const TOL_ROT = 0.1;
/**
 * The floor: how far two runs of the same drop, in the same process, against
 * the same static world, are allowed to disagree.
 *
 * It is not zero, and finding out what it is rather than assuming it is what
 * this pair of runs is for. Havok is deterministic given the same input, and a
 * second drop is not the same input — the engine has the first drop's history
 * in it, the shapes come back on different handles, and the solver's islands
 * are not the ones it started with.
 *
 * Measured, and the reading MOVED with S5b, which is itself the useful fact.
 * Against a single-container world three of the four shipped maps reproduced
 * to every decimal recorded and Harrowmead settled one body 2.8 mm apart
 * vertically;
 * against the bucketed world the same runs scatter up to a centimetre
 * laterally, because there are now a thousand static bodies whose contacts the
 * solver may take in a different order. What did NOT move is the height: the
 * vertical residue stays under a millimetre either way, which is exactly the
 * split `compare` grades on.
 */
const REPRO_Y = 0.005;
const REPRO_POS = 0.05;
const REPRO_ROT = 0.05;

const refDir = join(root, "plans", "physics-ref", "ref");
mkdirSync(refDir, { recursive: true });

/**
 * Everything that happens inside the page, as one function, because every part
 * of it has to see the same bodies: the drop builds them, the run steps them
 * and the read hands back where they stopped.
 */
function drop(page, opts) {
  return page.evaluate(
    async ([GRID, DROP_HEIGHT, STEPS, REST_DRIFT, REST_WINDOW]) => {
      const g = window.__celshock;
      // **The module the GAME loaded, found by asking the browser which URL
      // that was, because every other spelling is a SECOND copy.** Vite
      // pre-bundles `@babylonjs/core` into `/node_modules/.vite/deps/` under a
      // content hash that moves with the lockfile, and importing the package
      // by its own path (`/node_modules/@babylonjs/core/index.js`) or through
      // `/@id/` evaluates the library again: the second graph has its own
      // classes, so a shape built from it is registered against a plugin this
      // scene has never heard of, and `/@id/` does not even get that far — it
      // throws redefining Babylon's own observables. The resource timeline is
      // the one place the real URL, hash and all, is written down.
      const src = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => /@babylonjs_core\.js/.test(n));
      if (!src) throw new Error("cannot find the page's own @babylonjs/core");
      const B = await import(/* @vite-ignore */ src);
      if (B.Vector3 !== g.cameraSys.camera.position.constructor) {
        throw new Error("imported a second copy of @babylonjs/core");
      }
      const { CONFIG } = await import("/src/config/index.ts");
      const d = CONFIG.bots.death;
      const scene = g.scene;
      const engine = scene.getPhysicsEngine();

      // The game's own step must not run while this one does. Nothing is
      // registered as a client with anything moving, so `update` is already a
      // no-op — but a corpse arriving from anywhere would step the same world
      // between two of the steps below, and the run would not be reproducible.
      const realUpdate = g.physics.update;
      g.physics.update = () => {};
      // **The render loop is stopped for the length of the run, and it is the
      // TIMING that needs it rather than the physics.** Nothing about a
      // rendered frame reaches an explicitly stepped engine — the hashes are
      // identical with the loop running and stopped, which is what says so —
      // but a deploy screen over a live view is a frame's worth of CPU landing
      // in the middle of the step being measured, and the per-step figures
      // scattered by a factor of two before this line. The page is closed
      // immediately after the run, so the loop is not started again.
      g.engine.stopRenderLoop();

      // --- where the bodies go ----------------------------------------------
      // Seeded, never `Math.random()`: the world layer's rule, and here it is
      // what makes two processes drop into the same places.
      let seed = 0x9e3779b9;
      const rand = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const half = g.map.size / 2;
      const cell = g.map.size / GRID;
      const hit = {
        distance: 0,
        point: new B.Vector3(),
        normal: new B.Vector3(0, 1, 0),
        surface: "hard",
      };
      const down = new B.Vector3(0, -1, 0);
      const from = new B.Vector3();
      const sites = [];
      for (let iz = 0; iz < GRID; iz++) {
        for (let ix = 0; ix < GRID; ix++) {
          // Inset so no site sits on the boundary boxes, and jittered inside
          // what is left. Every draw happens for every site in a fixed order,
          // so the lattice is a function of the seed and of nothing else.
          const jx = 0.15 + rand() * 0.7;
          const jz = 0.15 + rand() * 0.7;
          const yaw = rand() * Math.PI * 2;
          const pitch = (rand() - 0.5) * 0.6;
          const roll = (rand() - 0.5) * 0.6;
          const x = -half + (ix + jx) * cell;
          const z = -half + (iz + jz) * cell;
          // What is under this point — a roof as readily as the street. Cast
          // from above everything the maps build; `castBody` is the same
          // question the death cam asks, and is untouched by what S5b changes.
          from.set(x, 300, z);
          const ground = g.map.rays.castBody(from, down, 600, hit)
            ? hit.point.y
            : g.map.terrain.heightAt(x, z);
          sites.push({ x, y: ground + DROP_HEIGHT, z, yaw, pitch, roll });
        }
      }

      /** One whole drop: build, settle, read, tear down. */
      const run = () => {
        const nodes = [];
        const shapes = [];
        const bodies = [];
        for (const [i, s] of sites.entries()) {
          const node = new B.TransformNode(`drop-${i}`, scene);
          node.position.set(s.x, s.y, s.z);
          node.rotationQuaternion = B.Quaternion.RotationYawPitchRoll(
            s.yaw,
            s.pitch,
            s.roll,
          );
          const shape = new B.PhysicsShapeBox(
            B.Vector3.Zero(),
            B.Quaternion.Identity(),
            new B.Vector3(0.5, 0.35, 0.7),
            scene,
          );
          // A corpse's surface, so that what this rests like is what a corpse
          // rests like. See the header on why that coupling is wanted.
          shape.material = { friction: d.friction, restitution: d.restitution };
          const body = new B.PhysicsBody(
            node,
            B.PhysicsMotionType.DYNAMIC,
            false,
            scene,
          );
          body.shape = shape;
          body.setMassProperties({ mass: 12 });
          body.setLinearDamping(d.linearDamping);
          body.setAngularDamping(d.angularDamping);
          // The two-phase teleport `RagdollSystem` does: one step reads the
          // node into the sim, and from there the sim owns it.
          body.disablePreStep = false;
          nodes.push(node);
          shapes.push(shape);
          bodies.push(body);
        }

        // **Every figure is ONE bracket around many steps, never a bracket per
        // step.** `performance.now()` is clamped to 100 us in a page that is
        // not cross-origin-isolated, and a step here is 30, so a per-step
        // reading is 0 or 100 and the mean of a few dozen of them lands on a
        // multiple of 2.08 us however long the step really is. That is what
        // `VERIFYING.md` says about timing a single ray, and it is the same
        // clock.
        const driftSteps = Math.floor(STEPS / 10);
        const started = performance.now();
        // Where everything stood a second before the end. **The rest test is
        // this and not a velocity**, because Havok DEACTIVATES a settled body
        // and freezes whatever velocity it held at the moment it went to
        // sleep: measured on Harrowmead, one box reported 0.02267 m/s at 480
        // substeps and the identical 0.02267 at 1200, which is a number that
        // has stopped being read rather than a body that is still moving. What
        // a resting transform needs proved about it is that it stopped MOVING,
        // so the instrument measures the movement.
        let pre = null;
        for (let i = 0; i < STEPS; i++) {
          engine._step(d.substep);
          if (i === 0) for (const b of bodies) b.disablePreStep = true;
          // The last tenth of the run, by which everything has stopped: the
          // same per-step walk with nothing moving in it.
          if (i === STEPS - driftSteps) pre = nodes.map((n) => n.position.clone());
        }
        const stepMs = performance.now() - started;

        let moving = 0;
        let fell = 0;
        let worstDrift = 0;
        const rows = [];
        for (const [i, body] of bodies.entries()) {
          const p = nodes[i].position;
          const q = nodes[i].rotationQuaternion;
          const drift = B.Vector3.Distance(p, pre[i]);
          worstDrift = Math.max(worstDrift, drift);
          if (drift > REST_DRIFT) moving++;
          // Under the floor is the failure this whole instrument is for: a
          // collider that stopped being in the world is a body that keeps
          // going. Two metres of tolerance because the floor is a heightfield
          // and a body may legitimately be lying in a dip.
          if (p.y < g.map.terrain.heightAt(p.x, p.z) - 2) fell++;
          rows.push([
            +p.x.toFixed(4),
            +p.y.toFixed(4),
            +p.z.toFixed(4),
            +q.x.toFixed(4),
            +q.y.toFixed(4),
            +q.z.toFixed(4),
            +q.w.toFixed(4),
          ]);
        }

        // **The step cost with the pile alive, measured AFTER the transforms
        // have been read**, so nothing this window does can reach the bank —
        // everything is at rest by here and a few hundred more steps move it
        // by nothing, but the reading and the timing are still kept in that
        // order deliberately. It is a long window because the figure it is
        // after is small: what the per-step walk costs is tens of
        // microseconds, and a bracket around fifty steps cannot see that
        // through a 100 us clock.
        const restStart = performance.now();
        for (let i = 0; i < REST_WINDOW; i++) engine._step(d.substep);
        const restMs = performance.now() - restStart;

        for (const b of bodies) b.dispose();
        for (const s of shapes) s.dispose();
        for (const n of nodes) n.dispose();
        return {
          rows,
          moving,
          fell,
          worstDrift: +worstDrift.toFixed(5),
          stepMs: +stepMs.toFixed(1),
          restStepUs: +((restMs * 1000) / REST_WINDOW).toFixed(1),
        };
      };

      const first = run();
      const second = run();
      g.physics.update = realUpdate;
      return {
        first,
        second,
        bodies: sites.length,
        colliderBoxes: g.map.colliderBoxes.length,
        terrainColliders: g.map.terrainColliders.length,
        // What the world was actually built as, which is the fact S5b moves.
        staticBodies: engine
          .getBodies()
          .filter((b) => b.getMotionType() === B.PhysicsMotionType.STATIC)
          .length,
        size: g.map.size,
      };
    },
    [opts.grid, opts.dropHeight, opts.steps, opts.restDrift, opts.restWindow],
  );
}

const sha = (rows) =>
  createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);

/**
 * The worst body: how far it moved, how far it moved VERTICALLY, and how far
 * it turned.
 *
 * **The height is separated out because it is the component that answers the
 * question this oracle exists to ask.** What a body rests ON is what a change
 * to the static world can break, and a body resting on a different thing rests
 * at a different HEIGHT; sliding a couple of centimetres along the same shelf
 * is the solver resolving the same contacts in another order, which a
 * regrouped compound legitimately does. So `maxY` is graded tightly and
 * `maxPos` loosely — see `TOL_Y`.
 */
function compare(a, b) {
  let maxPos = 0;
  let maxY = 0;
  let maxRot = 0;
  for (const [i, row] of a.entries()) {
    const o = b[i];
    maxPos = Math.max(
      maxPos,
      Math.hypot(row[0] - o[0], row[1] - o[1], row[2] - o[2]),
    );
    maxY = Math.max(maxY, Math.abs(row[1] - o[1]));
    for (let k = 3; k < 7; k++) maxRot = Math.max(maxRot, Math.abs(row[k] - o[k]));
  }
  return { maxPos, maxY, maxRot };
}

const vite = await startDevServer(root);
const browser = await launchClient();

console.log(
  `drop: ${STEPS} substeps @ ${vite.url}${CHECK ? "  (check only)" : ""}\n`,
);
const problems = [];
for (const id of targets) {
  const { page, pageErrors } = await bootMap(browser, vite.url, id);
  await installRound(page);
  const r = await drop(page, {
    grid: GRID,
    dropHeight: DROP_HEIGHT,
    steps: STEPS,
    restDrift: REST_DRIFT,
    restWindow: REST_WINDOW,
  });
  const { first, second } = r;
  const hash = sha(first.rows);
  const label = id.padEnd(12);
  const pad = " ".repeat(12);
  // The static count is the ENGINE's, pooled corpses and all, because reading
  // the world's own bodies means naming a field inside the class under test.
  // It is a constant plus the world, so the DELTA across a change is the
  // grouping, which is the fact S5b moves.
  const shape =
    `${r.bodies} bodies, ${r.colliderBoxes} boxes + ${r.terrainColliders} ` +
    `terrain, ${r.staticBodies} static bodies in the engine`;
  // The engine's own arithmetic, measured rather than assumed — see REPRO_POS.
  const repro = compare(first.rows, second.rows);
  const cost =
    `step ${first.stepMs} ms total, ${first.restStepUs}/${second.restStepUs} ` +
    `us/step at rest, ` +
    `floor ${repro.maxPos.toFixed(4)} m (${repro.maxY.toFixed(4)} up), ` +
    `${repro.maxRot.toFixed(4)} q`;
  if (first.moving) {
    problems.push(
      `${id}: ${first.moving} bodies still moving after ${STEPS} substeps ` +
        `(worst ${first.worstDrift} m over the last ${Math.floor(STEPS / 10)})`,
    );
    console.log(`${label} NOT SETTLED — ${first.moving} still moving. ${shape}`);
    await page.close();
    continue;
  }
  if (
    repro.maxY > REPRO_Y ||
    repro.maxPos > REPRO_POS ||
    repro.maxRot > REPRO_ROT
  ) {
    problems.push(
      `${id}: two runs in one process disagree by ${repro.maxPos.toFixed(4)} m ` +
        `(${repro.maxY.toFixed(4)} of it vertical) / ${repro.maxRot.toFixed(4)} q ` +
        `— the oracle is measuring noise`,
    );
    console.log(`${label} NOT REPRODUCIBLE — nothing written. ${shape}`);
    await page.close();
    continue;
  }
  if (first.fell) {
    problems.push(`${id}: ${first.fell} bodies came to rest under the floor`);
  }

  const out = join(refDir, `${id}.json`);
  if (CHECK) {
    if (!existsSync(out)) {
      problems.push(`${id}: nothing banked to compare against`);
      console.log(`${label} no reference on disk. ${shape}`);
    } else {
      const banked = JSON.parse(readFileSync(out, "utf8"));
      if (banked.rows.length !== first.rows.length) {
        problems.push(
          `${id}: banked ${banked.rows.length} bodies, ran ${first.rows.length}`,
        );
        console.log(`${label} BANK IS FOR A DIFFERENT DROP. ${shape}`);
      } else {
        const { maxPos, maxY, maxRot } = compare(first.rows, banked.rows);
        const bad = maxY > TOL_Y || maxPos > TOL_POS || maxRot > TOL_ROT;
        if (bad) {
          problems.push(
            `${id}: worst body moved ${maxPos.toFixed(3)} m, ${maxY.toFixed(3)} of ` +
              `it vertically, and turned ${maxRot.toFixed(3)} q — against ` +
              `tolerances ${TOL_POS} / ${TOL_Y} / ${TOL_ROT}`,
          );
        }
        const verdict = bad
          ? "REGRESSION"
          : hash === banked.hash
            ? "identical "
            : "within tol";
        console.log(
          `${label} ${verdict}  worst ${maxPos.toFixed(4)} m ` +
            `(${maxY.toFixed(4)} up), ${maxRot.toFixed(4)} q  ${hash}  ${shape}`,
        );
        console.log(`${pad} ${cost}`);
      }
    }
  } else {
    writeFileSync(
      out,
      `${JSON.stringify({ map: id, steps: STEPS, grid: GRID, hash, rows: first.rows }, null, 1)}\n`,
    );
    console.log(`${label} banked ${hash}  ${shape}`);
    console.log(`${pad} ${cost}`);
  }
  if (first.fell) console.log(`${pad} ${first.fell} BELOW THE FLOOR`);
  if (pageErrors.length) problems.push(`${id}: ${pageErrors.length} page errors`);
  await page.close();
}

await browser.close();
vite.stop();

if (problems.length) {
  console.log("");
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
