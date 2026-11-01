/**
 * Counts WebGPU shader modules and render pipelines against the frame clock,
 * which is how you tell a slow map from a map that is still compiling.
 *
 * Run with `node plans/webgpu-ref/pipelines.mjs [map] [--seconds N]`.
 *
 * **This is the replacement for the WebGL2 debug hook `VERIFYING.md` used to
 * describe.** That one patched `WebGL2RenderingContext.prototype.shaderSource`
 * to catch shader text on its way to the driver. The WebGPU equivalent is
 * `GPUDevice.prototype.createShaderModule` in an `addInitScript`, and it is
 * strictly better: hold `descriptor.code` and the module's own
 * `getCompilationInfo()` hands back `{lineNum, linePos, message}` against the
 * source you are holding.
 *
 * **What it was written to settle is a number that looked like a bug.**
 * Coldharbour measured 16 fps on a machine where Hollowmere measured 103, and
 * an earlier WebGL2 sweep said the gap should be about 25%. It is not a gap: 42 shader
 * modules and 25 render pipelines are created in the FIRST SECOND after the
 * player spawns, that second runs at 9 fps, the second runs at 33, and by the
 * third the round is flat at ~49 and creates nothing further. The map was
 * never slow; the instrument was pointed at the compiler.
 *
 * **The cost does NOT show up in the call it comes from, and that is the trap
 * this file exists to keep someone out of.** Summed across a whole round,
 * `createRenderPipeline` accounts for 0.7 ms — near enough to nothing. Dawn
 * compiles behind the call and the stall lands on first USE, so timing the
 * creation functions proves only that they were called. Read the `+pipelines`
 * column against the `fps` column beside it; the correlation is the evidence,
 * and the `ms` column is there to show you it is not the explanation.
 *
 * **`--round` plays a scripted ROUND instead of standing still**
 * (`BABYLON_EXIT.md` X4.4a): two lives on an armoured map, each deployed with
 * its kit through the real deploy, every primary and the sidearm fired at the
 * floor and round the compass, a frag and the launcher the first life and a
 * molotov and a mine the second — thrown, launched and laid through the real
 * input (`g.input`'s trigger and throw are held by the script, which is all
 * of the game it writes but the kit) — and one pane broken by a round's path
 * through it (`GlassSystem.shoot`, the predicted door a shot takes). It
 * counts what is created from each spawn — the deploy-to-playing step is a
 * phase of its own, `life N: spawn` — to the end of that life, both installs
 * left out (each reported apart), names each action's share, and files every
 * creation in play under the Babylon mesh being drawn when it was made. The
 * camera's path is a function of FRAMES, not of wall clock, and it is turned
 * onto the pane before the pane breaks, so what is in the frustum when an
 * effect is first drawn does not depend on the machine's frame rate; the
 * pane phase says how many shard draws the main pass made (zero means its
 * shards were never on screen — past `glass.shardDistance` or the size gate —
 * and so compiled nothing either way). The spawn itself is the round seed's
 * (a fresh draw), so which pane is nearest varies from run to run. Our
 * renderer's pipelines (`createRenderPipelineAsync`,
 * `createComputePipelineAsync`, off the frame) are counted beside Babylon's
 * synchronous ones, in both modes. That total is what X4.4e's declared list
 * must take to zero.
 */
import {
  bootMap,
  launchClient,
  startDevServer,
  root,
} from "./harness.mjs";

const args = process.argv.slice(2);
const MAP = args.find((a) => !a.startsWith("--")) ?? "coldharbour";
const secondsArg = args.indexOf("--seconds");
const SECONDS = secondsArg >= 0 ? Number(args[secondsArg + 1]) : 16;
const ROUND = args.includes("--round");

const vite = await startDevServer(root);
const { chromium } = await import("playwright");
// Uncapped, because the point is what the frame rate does over the first few
// seconds and a limiter flattens exactly the recovery being measured.
const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: ["--enable-unsafe-webgpu", "--disable-frame-rate-limit", "--disable-gpu-vsync"],
});

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript((mapId) => {
  window.localStorage.setItem("greywatch.map", mapId);
  window.__gpuLog = { modules: [], pipelines: [], ours: [], moduleMs: 0, pipelineMs: 0 };
  // What `--round` is doing when a creation lands, filed beside it.
  window.__gpuPhase = "boot";
  const proto = window.GPUDevice?.prototype;
  if (!proto) return;
  for (const [name, bucket] of [
    ["createShaderModule", "modules"],
    ["createRenderPipeline", "pipelines"],
    ["createComputePipeline", "pipelines"],
    // Our renderer's, built off the frame (`render/PipelineCache.ts`).
    ["createRenderPipelineAsync", "ours"],
    ["createComputePipelineAsync", "ours"],
  ]) {
    const orig = proto[name];
    if (!orig) continue;
    proto[name] = function patched(...a) {
      const t0 = performance.now();
      const result = orig.apply(this, a);
      const dt = performance.now() - t0;
      window.__gpuLog[bucket].push({ t: +t0.toFixed(1), ms: +dt.toFixed(2), phase: window.__gpuPhase, mesh: window.__gpuMesh });
      if (bucket === "pipelines") window.__gpuLog.pipelineMs += dt;
      else if (bucket === "modules") window.__gpuLog.moduleMs += dt;
      return result;
    };
  }
}, MAP);
await page.goto(vite.url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__celshock), null, { timeout: 180_000 });

if (ROUND) {
  await playRound(page);
  await browser.close();
  vite.stop();
  process.exit(0);
}

const out = await page.evaluate(async (seconds) => {
  const g = window.__celshock;
  const L = window.__gpuLog;
  const atBoot = { modules: L.modules.length, pipelines: L.pipelines.length };
  g.startRound();
  await new Promise((res) => {
    const poll = () => (g.state === "deploy" ? res() : setTimeout(poll, 10));
    poll();
  });
  const atInstall = { modules: L.modules.length, pipelines: L.pipelines.length };
  g.spawnPlayer();
  const buckets = [];
  for (let s = 0; s < seconds; s++) {
    const f = g.scene.getFrameId();
    const m = L.modules.length;
    const p = L.pipelines.length;
    const pm = L.pipelineMs;
    await new Promise((res) => setTimeout(res, 1000));
    buckets.push({
      sec: s + 1,
      fps: g.scene.getFrameId() - f,
      newModules: L.modules.length - m,
      newPipelines: L.pipelines.length - p,
      pipelineMs: +(L.pipelineMs - pm).toFixed(1),
    });
  }
  return {
    atBoot,
    atInstall,
    totals: {
      modules: L.modules.length,
      pipelines: L.pipelines.length,
      ours: L.ours.length,
      moduleMs: +L.moduleMs.toFixed(1),
      pipelineMs: +L.pipelineMs.toFixed(1),
    },
    buckets,
  };
}, SECONDS);

console.log(`map ${MAP}`);
console.log(`  at boot:    ${JSON.stringify(out.atBoot)}`);
console.log(`  at install: ${JSON.stringify(out.atInstall)}`);
console.log(`  totals:     ${JSON.stringify(out.totals)}`);
console.log("\nsec   fps  +modules  +pipelines  pipelineMs");
for (const b of out.buckets) {
  console.log(
    `${String(b.sec).padStart(3)} ${String(b.fps).padStart(5)} ` +
      `${String(b.newModules).padStart(9)} ${String(b.newPipelines).padStart(11)} ` +
      `${String(b.pipelineMs).padStart(11)}`,
  );
}
await browser.close();
vite.stop();

/**
 * `--round`: the scripted round, two lives, and what each action created.
 * See the header. Throws if the map offers no third slot, since half the
 * round would then be missing without a word.
 */
async function playRound(page) {
  const out = await page.evaluate(async () => {
    const g = window.__celshock;
    const L = window.__gpuLog;
    const { PRIMARY_WEAPON_IDS } = await import("/src/entities/weapons.ts");
    const frames = (n) =>
      new Promise((res) => {
        let k = 0;
        const o = g.scene.onAfterRenderObservable.add(() => {
          if (++k < n) return;
          g.scene.onAfterRenderObservable.remove(o);
          res();
        });
      });
    // Waits in SECONDS of wall clock rather than frames: the frame rate is
    // the machine's, and a frag's fuse is not. Nothing moves the camera
    // during one of these; where the camera points is a function of FRAMES
    // (`sweep`), so what is in the frustum when something is first drawn does
    // not depend on how fast this machine ran.
    const seconds = async (t) => {
      const end = performance.now() + t * 1000;
      while (performance.now() < end) await frames(1);
    };
    const until = async (test, what, limit = 1800) => {
      for (let i = 0; !test(); i++) {
        if (i > limit) throw new Error(`timed out waiting for ${what}`);
        await frames(1);
      }
    };
    // The trigger, the throw and the pointer lock the trigger is gated on —
    // held by the script. `InputManager.update` rewrites the fields every
    // tick, so they are redefined rather than assigned (`VERIFYING.md`).
    const drive = { fire: false, grenade: false };
    for (const [k, get] of [
      ["fire", () => drive.fire],
      ["grenadePressed", () => drive.grenade],
      ["pointerLocked", () => true],
    ]) {
      Object.defineProperty(g.input, k, { get, set: () => {}, configurable: true });
    }
    // What each action actually DID, so a phase that created nothing can be
    // told from one that did nothing: each door counted as it is called.
    const did = {};
    for (const [label, owner, key] of [
      ["rounds", g.combatFx, "drawRound"],
      ["flashes", g.playerView, "fired"],
      ["throws", g.grenades, "throwAlong"],
      ["blasts", g.grenadeFx, "blast"],
      ["fires", g.grenadeFx, "ignite"],
      ["rubble", g.blastDebris, "burst"],
      ["rockets", g.antiTank, "launch"],
      // The session is the round's, so its class rather than an instance.
      ["mineTables", (await import("/src/net/NetOrdnance.ts")).NetOrdnance.prototype, "applyMines"],
      ["shards", g.debris, "burst"],
    ]) {
      const f = owner[key];
      did[label] = 0;
      owner[key] = function (...a) {
        did[label]++;
        return f.apply(this, a);
      };
    }
    // The Babylon mesh being drawn when a pipeline is made is the one that
    // needed it (`VERIFYING.md`): each creation in play is filed with its name.
    // The pane's shards are counted as they are DRAWN as well (frames with a
    // shard in the main pass), so a pane phase that created nothing can be
    // told from one whose shards were never on screen to compile anything.
    const meshProto = Object.getPrototypeOf(g.combatFx.sparks[0].mesh);
    const render = meshProto.render;
    let shardDraws = 0;
    meshProto.render = function (...a) {
      if (this.name.startsWith("shard")) shardDraws++;
      window.__gpuMesh = this.name;
      try {
        return render.apply(this, a);
      } finally {
        window.__gpuMesh = undefined;
      }
    };
    const count = () => ({ babylon: L.pipelines.length, ours: L.ours.length, modules: L.modules.length, did: { ...did } });
    const phases = [];
    let mark = count();
    // Closes the open phase (its counts are what was created since it
    // opened) and opens `name`, or none for `null` — and a closed phase is
    // never re-opened: what happens between two lives (the second install)
    // is the installs' and is counted there, not added to the last phase.
    let open = false;
    const phase = (name) => {
      const now = count();
      if (open) {
        const p = phases[phases.length - 1];
        p.babylon = now.babylon - mark.babylon;
        p.ours = now.ours - mark.ours;
        p.modules = now.modules - mark.modules;
        p.did = Object.entries(now.did)
          .map(([k, v]) => [k, v - mark.did[k]])
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ");
      }
      mark = now;
      open = Boolean(name);
      if (name) phases.push({ name });
      window.__gpuPhase = name ?? "between lives";
    };
    let yaw = 0;
    // `n` frames of the trigger worked on and off, turning round the compass
    // and dipping to the floor between bursts. FRAMES, not seconds: the
    // camera's path is then the same on every run and every machine (the
    // rounds fired per frame are not — a weapon's rate is its clock's).
    const sweep = async (n, pitches) => {
      for (let i = 0; i < n; i++) {
        yaw += 0.02;
        g.cameraSys.yaw = yaw;
        g.cameraSys.pitch = pitches[Math.floor(i / 20) % pitches.length];
        drive.fire = i % 2 === 0;
        await frames(1);
      }
      drive.fire = false;
      await seconds(0.5);
    };
    const draw = async (slot) => {
      g.player.drawSlot(slot);
      await until(() => !g.player.swapping, "the swap");
      await frames(2);
    };
    const life = async (n, kit) => {
      if (!g.armourOffered) throw new Error("this map offers no third slot — run --round on an armoured map");
      // The kit rides the deploy (`docs/multiplayer.md`), so it is set where
      // the deploy screen sets it before the ask.
      g.weapon = kit.weapon;
      g.equipment = kit.equipment;
      g.throwable = kit.throwable;
      g.player.setThrowable(kit.throwable);
      g.player.setEquipment(kit.equipment);
      g.player.setWeapon(kit.weapon);
      // The spawn is PLAY: whatever the deploy -> playing step, the first
      // frames of a life and the kit's first draw create is the round's.
      phase(`life ${n}: spawn`);
      yaw = 0;
      g.spawnPlayer();
      await until(() => g.state === "playing" && g.player.alive, "the spawn");
      await frames(30);
      // Every primary in the hands: the page's prediction draws each one's
      // rounds, flash and brass whatever the authority resolves.
      for (const id of PRIMARY_WEAPON_IDS) {
        phase(`life ${n}: ${id}`);
        g.player.setWeapon(id);
        await frames(2);
        await sweep(320, [-0.35, 0.02, -0.12]);
      }
      g.player.setWeapon(kit.weapon);
      phase(`life ${n}: pistol`);
      await draw(1);
      await sweep(160, [-0.3, 0.0]);
      await draw(0);
      phase(`life ${n}: ${kit.throwable}`);
      g.cameraSys.pitch = 0.15;
      drive.grenade = true;
      await frames(1);
      drive.grenade = false;
      await seconds(6);
      phase(`life ${n}: ${kit.equipment}`);
      await draw(2);
      for (let i = 0; i < 2; i++) {
        g.cameraSys.pitch = kit.equipment === "rpg" ? 0.02 : -0.4;
        drive.fire = true;
        await frames(1);
        drive.fire = false;
        await seconds(4);
      }
      await draw(0);
      if (n === 1) {
        // One pane, broken by a round's path through it: the nearest
        // breakable pane, crossed along its own normal from either side —
        // with the camera turned onto it first, so its shards are in the
        // frustum on every run rather than wherever the sweep left the view.
        phase(`life ${n}: a pane`);
        const V = g.player.position.constructor;
        const p = g.player.position;
        let best = -1;
        let bd = Infinity;
        g.map.panes.forEach((q, i) => {
          const d = Math.hypot(q.cx - p.x, q.cz - p.z);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        const q = g.map.panes[best];
        const eye = g.cameraSys.camera.position;
        g.cameraSys.yaw = Math.atan2(q.cx - eye.x, q.cz - eye.z);
        g.cameraSys.pitch = Math.atan2(q.cy - eye.y, Math.hypot(q.cx - eye.x, q.cz - eye.z));
        await frames(10);
        const drawnBefore = shardDraws;
        const alongX = q.w >= q.d;
        const nx = alongX ? Math.sin(q.rotY) : Math.cos(q.rotY);
        const nz = alongX ? Math.cos(q.rotY) : -Math.sin(q.rotY);
        const broke = [];
        for (const s of [1, -1]) {
          const o = new V(q.cx + nx * 2 * s, q.cy, q.cz + nz * 2 * s);
          broke.push(...g.glass.shoot(o, new V(-nx * s, 0, -nz * s), 4, false));
          if (broke.length) break;
        }
        await seconds(2);
        phases[phases.length - 1].pane = { index: best, metres: +bd.toFixed(1), broke: broke.length, shardDraws: shardDraws - drawnBefore };
      }
      phase(null);
    };
    // Each install's OWN creations (startRound to deploy), left out of play.
    const installs = [];
    const install = async () => {
      const before = count();
      window.__gpuPhase = "install";
      g.startRound();
      await until(() => g.state === "deploy", "deploy", 100000);
      const after = count();
      installs.push({ babylon: after.babylon - before.babylon, ours: after.ours - before.ours, modules: after.modules - before.modules });
    };
    await install();
    await life(1, { weapon: "rifle", equipment: "rpg", throwable: "frag" });
    await install();
    await life(2, { weapon: "carbine", equipment: "mine", throwable: "molotov" });
    const sum = (k) => phases.reduce((a, p) => a + p[k], 0);
    const made = L.pipelines.filter((x) => x.phase.startsWith("life")).map((x) => `${x.phase}: ${x.mesh ?? "(no Babylon mesh drawing)"}`);
    return { made, phases, installs, did, total: { babylon: sum("babylon"), ours: sum("ours"), modules: sum("modules") } };
  });
  console.log(`map ${MAP} --round`);
  console.log(`  created by each install (left out): ${JSON.stringify(out.installs)}`);
  console.log("\n  phase                         babylon  ours  modules");
  for (const p of out.phases) {
    console.log(
      `  ${p.name.padEnd(28)} ${String(p.babylon).padStart(7)} ${String(p.ours).padStart(5)} ${String(p.modules).padStart(8)}` +
        `   ${p.did || "nothing happened"}` +
        (p.pane ? `; pane ${p.pane.index} at ${p.pane.metres} m, ${p.pane.broke} broken, ${p.pane.shardDraws} shard draws` : ""),
    );
  }
  console.log(`\n  in play, both lives: ${JSON.stringify(out.total)}`);
  console.log(`  what was done, both rounds: ${JSON.stringify(out.did)}`);
  for (const m of out.made) console.log(`  made in play — ${m}`);
}
