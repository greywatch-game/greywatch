/**
 * The physics CLIENTS' oracle: a fixed script of deaths, broken panes and
 * blasts played through `RagdollSystem`, `DebrisSystem` and
 * `BlastDebrisSystem` on the real static world, stepped by hand, with every
 * live body's pose hashed as Havok holds it — in flight, at rest, and on the
 * frame each one is put away.
 *
 * Run with `node plans/physics-ref/clients.mjs [map...]`; `--check` grades
 * against `plans/physics-ref/ref/clients-<map>.json` rather than replacing
 * it. A plain run re-banks, exactly as `drop.mjs` does.
 *
 * **It exists because `drop.mjs` grades the static world and nothing that
 * moves in it.** Sixty-four free boxes say whether `PhysicsWorld` built the
 * ground right, and say nothing about a constraint, an impulse, a teleport, a
 * re-shaped shard, an evicted corpse or a parked body — which is the whole of
 * what `BABYLON_EXIT.md` X2.4 moves off Babylon's plugin onto Havok's raw API.
 * A port that is call-for-call the plugin's is bit-for-bit the plugin's, so
 * the bar here is BITS: two runs of this script in two processes come back
 * with the same hash, and a change that must move nothing has to as well.
 *
 * **What it plays**, frame by frame at the game's 1/60 (`SCRIPT` below):
 * nine stand-in corpses (`buildSoldier` rigs, posed at rest on a ring round
 * the map's first flag) killed by rounds, a frag and a shell — one corpse
 * more than the pool holds, so the ninth EVICTS the oldest — and one retired
 * early as the death cam retires its own; five glass bursts cut from the
 * nearest breakable panes, the fifth stealing a landed burst's slot and every
 * one of them re-shaping its shards (`DebrisSystem.cut`); four rubble bursts
 * on earth and on stone, the fourth stealing a landed one's slot; two
 * half-frames that take NO substep straight after a spawn, so a teleport is
 * held pending across a frame, and two double frames, so `afterFirstStep`
 * runs between two substeps of one frame. Then it runs on until every pool
 * has parked everything it threw.
 *
 * **What it hashes**, all through `HP_Body_GetQTransform` (`lib.mjs`), so the
 * fingerprint is the engine's and survives whatever the clients' own nodes
 * become:
 *   - a SNAPSHOT of every live (DYNAMIC) body at `SNAPSHOTS` — in the air,
 *     landing, around the eviction, and at the end, where nothing may be live;
 *   - the REST list: each body's last pose before the frame it went static,
 *     which is where a frozen corpse, a sunk shard and a parked chunk were
 *     lying when the pool took them back.
 * Each snapshot keeps its own hash, so a check that fails says WHICH frame
 * first disagreed, and the run's hash is over all of them.
 *
 * **It also probes one thing it does not grade** (`probe` in the bank): the
 * chest's angular velocity the instant a corpse is offered, before any step.
 * `RagdollSystem.applyImpulse` applies the killing impulse at the joint's
 * WORLD position while the body is still parked at `PARKED_Y`, because the
 * teleport that brings it to the joint only lands on the next substep — so
 * the impulse's lever arm is measured from 1 km under the map. See
 * `FINDINGS.md` for what that reading says.
 *
 * **Why it is reproducible, which the bank refuses to assume.** Every input is
 * fixed: the round is built with nothing allowed into the engine (the game's
 * own step and every way into the three pools are held off until the script
 * starts — a bot killed under the deploy screen would otherwise have thrown a
 * corpse into the world first), the render loop is stopped, each pool's
 * jitter stream is re-seeded by its own `reset`, and every spawn, burst and
 * step is the script's. What is left is Havok's determinism given identical
 * calls, which is the instrument `drop.mjs` measured.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bootMap, launchClient, root, startDevServer } from "../webgpu-ref/harness.mjs";
import { pageHelpers, sha } from "./lib.mjs";

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const named = args.filter((a) => !a.startsWith("--"));
/**
 * The two maps with breakable glass — only the city kit's office and
 * shophouse glaze a way through (`PaneSpec.breakable`), and they stand on
 * Coldharbour's streets and Cinderhaven's harbour front, the second on its
 * 24-a-side roster — and a market town with none, which plays the script
 * without its glass. Any other map runs on request.
 */
const DEFAULT_MAPS = ["coldharbour", "cinderhaven", "harrowmead"];
const targets = named.length ? named : DEFAULT_MAPS;

/** Frames played, at the game's 1/60 unless `DT` says otherwise. */
const FRAMES = 600;
/** The frames whose live bodies are hashed — see the header. */
const SNAPSHOTS = [1, 2, 6, 14, 15, 30, 49, 50, 51, 72, 120, 121, 151, 240, 420, 600];

const refDir = join(root, "plans", "physics-ref", "ref");
mkdirSync(refDir, { recursive: true });

/**
 * Builds the round with nothing let into the physics engine, and stops the
 * clock. See the header: the game's step and the three pools' doors are held
 * off from before `startRound` until the script takes over.
 */
function quietRound(page) {
  return page.evaluate(async () => {
    const g = window.__celshock;
    g.physics.update = () => {};
    g.ragdolls.spawn = () => false;
    g.debris.burst = () => false;
    g.blastDebris.burst = () => false;
    g.startRound();
    await new Promise((res) => {
      const poll = () => (g.state === "deploy" ? res() : setTimeout(poll, 10));
      poll();
    });
    g.engine.stopRenderLoop();
  });
}

/** The whole script, in the page. */
function play(page, opts) {
  return page.evaluate(
    async ([FRAMES, SNAPSHOTS]) => {
      const g = window.__celshock;
      const ref = window.__physref;
      // The doors back: own properties shadowing the prototypes' methods.
      delete g.physics.update;
      delete g.ragdolls.spawn;
      delete g.debris.burst;
      delete g.blastDebris.burst;
      const M = await import("/src/math/index.ts");
      const { toBabylon } = await import("/src/math/babylon.ts");
      const SM = await import("/src/entities/SoldierModel.ts");
      // A Babylon vector from the GAME's copy of Babylon: `toBabylon` is a
      // game module, so Vite hands this page the instance the game holds.
      // The two burst entry points take Babylon's vectors and read `_x`.
      const B3 = (x, y, z) => toBabylon(new M.Vector3(x, y, z));
      if (B3(0, 0, 0).constructor !== g.cameraSys.camera.position.constructor) {
        throw new Error("not the game's copy of @babylonjs/core");
      }
      const { HK } = ref.hp(g);
      const bodies = ref.clientBodies(g);

      // Every pool's jitter from its seed, and nothing left in any of them.
      g.ragdolls.reset();
      g.debris.reset();
      g.blastDebris.reset();

      // --- the stage ------------------------------------------------------
      const hit = {
        distance: 0,
        point: new M.Vector3(),
        normal: new M.Vector3(0, 1, 0),
        surface: "hard",
        hull: null,
      };
      const down = new M.Vector3(0, -1, 0);
      const groundAt = (x, z) =>
        g.map.rays.castBody(new M.Vector3(x, 300, z), down, 600, hit)
          ? hit.point.y
          : g.map.terrain.heightAt(x, z);
      const flag = g.map.controlPoints[0].pos;

      // Nine stand-ins on a 4 m ring round the flag, each on whatever the
      // world says is under it, facing in toward the flag.
      class Corpse {
        constructor(rig, feet) {
          this.rig = rig;
          this.position = feet;
          this.center = new M.Vector3(feet.x, feet.y + rig.centerHeight, feet.z);
          this.deathFrom = new M.Vector3();
          this.deathDamage = 0;
          this.deathKind = "bullet";
          this.ragdolling = false;
          this.alive = false;
        }
        setEnabled(on) {
          this.rig.root.setEnabled(on);
        }
      }
      const corpses = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const x = flag.x + Math.cos(a) * 4;
        const z = flag.z + Math.sin(a) * 4;
        const rig = SM.buildSoldier(g.scene, g.mats, i % 2);
        const feet = new M.Vector3(x, groundAt(x, z), z);
        rig.root.position.set(feet.x, feet.y, feet.z);
        rig.root.rotation.y = a + Math.PI / 2;
        rig.root.setEnabled(false);
        corpses.push(new Corpse(rig, feet));
      }
      const kill = (i, kind, damage, fx, fy, fz) => {
        const c = corpses[i];
        c.deathKind = kind;
        c.deathDamage = damage;
        c.deathFrom.set(c.position.x + fx, c.position.y + fy, c.position.z + fz);
        return g.ragdolls.spawn(c, B3(c.position.x, c.position.y + 1.6, c.position.z));
      };

      // The breakable panes nearest the flag, in a fixed order.
      const panes = g.map.panes
        .map((p, i) => [Math.hypot(p.cx - flag.x, p.cz - flag.z), i])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])
        .slice(0, 4)
        .map(([, i]) => g.map.panes[i]);
      const shatter = (n, du, dv) => {
        if (panes.length === 0) return null;
        const p = panes[n % panes.length];
        // Across the face and up it from the centre, along the face's own
        // axis — `DebrisSystem.burst`'s convention for which way is across.
        const c = Math.cos(p.rotY);
        const s = Math.sin(p.rotY);
        const alongX = p.w >= p.d;
        const nx = alongX ? s : c;
        const nz = alongX ? c : -s;
        const at = B3(p.cx + du * nz, p.cy + dv, p.cz - du * nx);
        // In through the face, a little off square.
        const dir = B3(nx + 0.2 * nz, -0.05, nz - 0.2 * nx).normalize();
        return g.debris.burst(p, at, dir, at.clone());
      };
      const blast = (dx, dz, power, surface) => {
        const x = flag.x + dx;
        const z = flag.z + dz;
        const at = B3(x, groundAt(x, z) + 0.1, z);
        return g.blastDebris.burst(
          at,
          power,
          { surface, normal: B3(0, 1, 0) },
          at.clone(),
        );
      };

      // --- the probe --------------------------------------------------------
      // What Havok holds for a freshly offered corpse's chest, BEFORE any
      // step: where the body is and how fast it is turning. Not graded.
      const probe = {};
      const chestOf = () => {
        // The one torso that went live on this offer.
        for (const [label, id] of bodies) {
          if (label.endsWith(".torso") && ref.live(HK, id) && !probe.seen?.has(label)) {
            return [label, id];
          }
        }
        return null;
      };
      const readChest = (key, offerResult) => {
        probe.seen ??= new Set();
        const found = chestOf();
        if (!found) return offerResult;
        const [label, id] = found;
        probe.seen.add(label);
        const w = HK.HP_Body_GetAngularVelocity(id)[1];
        const v = HK.HP_Body_GetLinearVelocity(id)[1];
        probe[key] = {
          offered: offerResult,
          body: label,
          bodyAt: ref.pose(HK, id).slice(0, 3).map((n) => +n.toFixed(3)),
          angular: w.map((n) => +n.toFixed(3)),
          spin: +Math.hypot(...w).toFixed(3),
          linear: v.map((n) => +n.toFixed(3)),
          id,
        };
        return offerResult;
      };

      // --- the script ---------------------------------------------------------
      const DT = { 13: 1 / 120, 14: 1 / 120, 70: 1 / 30, 71: 1 / 30 };
      const SCRIPT = {
        0: () => [
          readChest("bullet", kill(0, "bullet", 34, -8, 1.6, -3)),
          readChest("blast", kill(1, "blast", 70, 1.5, 0.1, 0.8)),
          shatter(0, 0, 0),
          blast(6, 2, 1, "ground"),
        ],
        6: () => [shatter(1, 0.3, 0.2), blast(-5, 4, 1.85, "hard")],
        12: () => kill(2, "bullet", 34, 6, 2.5, 6),
        // Offered on a frame that takes NO substep: its teleport is pending
        // until frame 14's.
        13: () => kill(3, "shell", 120, -1, 0.3, -1.5),
        18: () => kill(4, "bullet", 60, 0, 1.6, 9),
        24: () => kill(5, "blast", 40, -2, 0.2, 0),
        30: () => kill(6, "bullet", 34, 9, 1.6, 0),
        36: () => kill(7, "blast", 90, 0.5, 0.1, -1),
        // The ninth: the pool holds eight, none is sinking, so the OLDEST goes.
        50: () => kill(8, "bullet", 34, -6, 1.6, 5),
        60: () => shatter(2, -0.2, -0.1),
        66: () => shatter(3, 0.1, 0.3),
        // Every slot holds glass; the oldest has landed (2 s against the 1.6
        // s `shardSteal`), so it is stolen.
        120: () => shatter(0, -0.4, 0.1),
        130: () => blast(3, -6, 1, "ground"),
        // Every slot holds rubble; the oldest has landed (2.5 s), so it goes.
        150: () => blast(-4, -3, 1, "hard"),
        // The death cam's early retire, on a corpse that has frozen.
        200: () => g.ragdolls.retire(corpses[5]) ?? "retired",
      };
      // Read after the frame's events and steps, to say the script did what it
      // says: which corpses the pool still holds, and how many shard shapes
      // the cuts have asked for (more than the pool's one means `cut`
      // re-shaped a body).
      const AUDIT = {
        49: "before the ninth",
        51: "after the ninth",
        201: "after the retire",
      };
      const audit = [];

      const wanted = new Set(SNAPSHOTS);
      const snapshots = [];
      const rest = [];
      const lastPose = new Map();
      const wasLive = new Set();
      const accepted = [];
      for (let f = 0; f <= FRAMES; f++) {
        const event = SCRIPT[f];
        if (event) accepted.push([f, event() ?? null]);
        const dt = DT[f] ?? 1 / 60;
        // `Game.stepAftermath`'s order: the engine, then its three clients.
        g.physics.update(dt);
        g.ragdolls.update(dt);
        g.debris.update(dt);
        g.blastDebris.update(dt);

        const live = [];
        for (const [label, id] of bodies) {
          if (ref.live(HK, id)) {
            const pose = ref.pose(HK, id);
            lastPose.set(label, pose);
            wasLive.add(label);
            live.push([label, pose]);
          } else if (wasLive.has(label)) {
            // Put away this frame: where it was lying is the REST pose.
            wasLive.delete(label);
            rest.push([label, f, lastPose.get(label)]);
          }
        }
        if (AUDIT[f]) {
          audit.push([f, AUDIT[f], corpses.map((c) => (c.ragdolling ? 1 : 0)).join("")]);
        }
        if (wanted.has(f)) {
          snapshots.push({
            frame: f,
            live: live.length,
            corpses: g.ragdolls.activeCount,
            shards: g.debris.activeCount,
            rubble: g.blastDebris.activeCount,
            bodies: live,
          });
        }
      }
      delete probe.seen;
      for (const k of Object.keys(probe)) delete probe[k].id;
      return {
        snapshots,
        rest,
        probe,
        accepted,
        audit,
        shardShapes: g.debris.shapes.size,
        panes: panes.length,
        bodies: bodies.length,
      };
    },
    [opts.frames, opts.snapshots],
  );
}

const vite = await startDevServer(root);
const browser = await launchClient();
console.log(`clients: ${FRAMES} frames @ ${vite.url}${CHECK ? "  (check only)" : ""}\n`);

const problems = [];
for (const id of targets) {
  const out = join(refDir, `clients-${id}.json`);
  const banked = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
  const { page, pageErrors } = await bootMap(browser, vite.url, id);
  await quietRound(page);
  await page.evaluate(pageHelpers);
  const r = await play(page, { frames: FRAMES, snapshots: SNAPSHOTS });
  await page.close();

  const snaps = r.snapshots.map((s) => ({
    frame: s.frame,
    live: s.live,
    hash: sha(s.bodies),
  }));
  const restHash = sha(r.rest);
  const hash = sha({ snaps: snaps.map((s) => s.hash), rest: restHash });
  const label = id.padEnd(12);
  const pad = " ".repeat(12);
  const last = r.snapshots[r.snapshots.length - 1];
  const summary =
    `${r.bodies} pooled bodies, ${r.panes} panes, ${r.shardShapes} shard shapes, ` +
    `${r.rest.length} put away, ` +
    `peak ${Math.max(...snaps.map((s) => s.live))} live`;
  if (last.live) problems.push(`${id}: ${last.live} bodies still live at frame ${last.frame}`);
  if (pageErrors.length) problems.push(`${id}: ${pageErrors.length} page errors: ${pageErrors[0]}`);

  if (CHECK) {
    if (!banked) {
      problems.push(`${id}: nothing banked to compare against`);
      console.log(`${label} no reference on disk  ${hash}`);
    } else if (banked.frames !== FRAMES) {
      problems.push(`${id}: banked over ${banked.frames} frames, ran ${FRAMES}`);
      console.log(`${label} NOT GRADED — a different script`);
    } else if (banked.hash === hash) {
      console.log(`${label} identical  ${hash}  ${summary}`);
    } else {
      const first = snaps.find((s, i) => banked.snapshots[i]?.hash !== s.hash);
      const where = first
        ? `first at frame ${first.frame} (${first.live} live, banked ${banked.snapshots.find((b) => b.frame === first.frame)?.live})`
        : `in the rest list (${r.rest.length} against ${banked.rest.count})`;
      problems.push(`${id}: bits moved, ${where}`);
      console.log(`${label} MOVED      ${hash} (banked ${banked.hash}), ${where}`);
    }
  } else {
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          map: id,
          frames: FRAMES,
          hash,
          snapshots: snaps,
          rest: { count: r.rest.length, hash: restHash },
          accepted: r.accepted,
          audit: r.audit,
          shardShapes: r.shardShapes,
          probe: r.probe,
        },
        null,
        1,
      )}\n`,
    );
    console.log(`${label} banked ${hash}  ${summary}`);
  }
  console.log(
    `${pad} snapshots ${snaps.map((s) => `${s.frame}:${s.live}`).join(" ")}`,
  );
  console.log(
    `${pad} offers ${r.accepted.map(([f, v]) => `${f}:${JSON.stringify(v)}`).join(" ")}`,
  );
  console.log(`${pad} corpses held ${r.audit.map(([f, , held]) => `${f}:${held}`).join(" ")}`);
  for (const [k, p] of Object.entries(r.probe)) {
    console.log(
      `${pad} probe ${k}: ${p.body} at [${p.bodyAt}] spinning ${p.spin} rad/s ` +
        `[${p.angular}], moving [${p.linear}] m/s`,
    );
  }
}

await browser.close();
vite.stop();

if (problems.length) {
  console.log("");
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
