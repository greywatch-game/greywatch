/**
 * X4.3b's READERS' ORACLE, committed (`BABYLON_EXIT.md` X5.4a), and the CAMERA
 * LOG beside it: what X5.4b, X5.4e, X5.4f and X5.4g must hold bit for bit while
 * they move the frame's order and the render id out from under the viewmodel.
 *
 * ```
 * node plans/webgpu-ref/readers.mjs record --out=rec.json [--map=harrowmead] [--frames=1500]
 * node plans/webgpu-ref/readers.mjs replay --log=rec.json [--out=rep.json] [--against=rep0.json] [--ignore=pattern,…|@file]
 * node plans/webgpu-ref/readers.mjs camera [--out=cam.json] [--against=cam0.json] [--ignore=…]
 * node plans/webgpu-ref/readers.mjs --compare=a.json --against=b.json [--ignore=…]
 * ```
 *
 * **Why.** Four answers about the player's own weapon are read out of the
 * viewmodel's RENDER CACHE (`rigJoints.ts`' `RenderCache`, `viewTree.ts`) rather
 * than composed fresh, because two of them are COMMAND INPUTS (`FINDINGS.md` 55,
 * the owner's decision of 2026-10-31: bit for bit): `muzzleWorld` (a rocket's
 * start, `OrdnanceCommand.origin`), `throwHandWorld` (a grenade's,
 * `GrenadeCommand.origin`), `ejectPortWorld` (the brass; the plan's "eye port")
 * and the reload's gravity, taken through the inverse of the weapon root's world
 * (`ViewModel.evaluateReload`, "the root's inverse"). The cache was keyed on
 * Babylon's RENDER ID and settled from inside Babylon's render, both of which
 * X5.4 takes away (since X5.4b it is keyed on a counter of OURS moved where
 * Babylon's moved, `src/core/renderId.ts`, a DEV shadow holding the two a
 * constant apart); so this is the BEFORE every sub-step that moves either is
 * graded against.
 *
 * **`record`** plays a LIVE offline round on Harrowmead (an armoured map, so the
 * third slot is offered): the rifle fired from the hip and aimed, a sprint, a
 * tactical reload, the magazine emptied and a dry reload, a frag thrown, the
 * pistol, the launcher with its load and a rocket, aimed, the rifle again, a
 * molotov thrown — X4.3b's schedule, driven through `g.input` after the real
 * input update. It logs every call into `ViewModel` and `PlayerView` with its
 * arguments and the camera at it (the call log `replay` re-issues), the camera
 * at each frame's hand-over, every reader's answer as float64 bits, and every
 * `GrenadeCommand`/`OrdnanceCommand` origin the page submitted. A live round
 * rides the machine's timing, so a record is not compared across processes: it
 * is the INPUT, made once at the parent and replayed on both trees.
 *
 * **`replay`** re-issues a record's calls frame for frame in `deploy` (the world
 * held, the round's seed pinned), from `Game.followEye` — a hook every frame
 * passes before it is drawn — with the camera put back at each call and at each
 * hand-over and `Math.random` seeded for the flash and the brass, and logs: every
 * reader's answer as float64 bits (the muzzle and the hand as the record's calls
 * read them, the port as `PlayerView.fired` reads it, the root's inverse and the
 * gravity as `evaluateReload` leaves them); a digest of every viewmodel joint the
 * frame EVALUATED (`ViewTree.evaluated`, each joint's world read where it lies,
 * never through the cache, which a read would re-stamp); and the three ORIGINS
 * the record submitted, recomputed from the replay's own answers by `Game`'s
 * floors (`releaseGrenade`'s `handAhead`, `launchRocket`'s `launchAhead`) and
 * checked against the live page's bit for bit — which is what says the replay is
 * faithful to the round it replays. A replay IS compared across processes and
 * across trees (`--against`): that is the oracle.
 *
 * **Every change of Babylon's render id, and the site that made it**, is logged
 * per frame in both modes (while there is a scene: through the frame adapter's
 * `babylon()`, X6.1a, and with none the log is empty — RETIRED): the scene's `_renderId` is made an accessor on the
 * instance (reads and writes the same number; nothing else changes), and each
 * write is filed under the stack that made it — the CAMERA's render
 * (`_renderForCamera`), a render target's render (`RenderTargetTexture`; the
 * glow's MASK when `GlowPass` is on the stack), the READINESS timer
 * (`executeWhenReady`'s `setTimeout`, outside any frame) or the stack's top
 * frames verbatim — with whether it was inside a frame (between the frame
 * adapter's begin and its submit). The id itself is logged relative to the
 * replay's first frame (the boot's own count differs run to run). The
 * `RenderCache` compares ids for equality only, so a counter of ours "with the
 * same meaning" (X5.4b) is one that moves at every one of these sites a round
 * reaches.
 *
 * **`camera`** is the camera log (X5.4f's and X5.4h's BEFORE): Hollowmere, the
 * seed pinned, through the menu, the building card, deploy, the kit lid, a life,
 * a render-scale change, a resize, the pause lid, the round-over card and the
 * menu again, N frames of each logged. The camera's pose is PINNED every frame at
 * the frame adapter's `onBeforeDraw` (the scene's before-render), as a function of
 * the step and its frame. That runs AFTER the frame's camera updates — the game's
 * own, in `Game.tick`, and Babylon's `activeCamera.update()`, which `_renderFrame`
 * calls just before raising it (`scene.pure.js` 4522-4545) — and BEFORE any matrix
 * is computed: `_renderForCamera` computes the view, the projection and the
 * scene's transform matrix later in the same render, off the pose as it stands.
 * So the pin overwrites whatever either update left, every matrix logged is
 * computed off the pinned pose, and what is logged is the camera's arithmetic and
 * nothing of the game's timing (the inputs, read at the draw, are the pose the
 * matrices were computed from): per frame the inputs
 * (position and rotation as float64 bits, the field of view, the clip planes,
 * the mode, the render size and the aspect the engine handed the camera) and the
 * outputs Babylon computed (the view, the projection and the scene's transform
 * matrix as float32 bits, `globalPosition` as float64 bits). It is compared
 * across processes and trees (`--against`).
 *
 * **Since X6.1a it is X6.1f's BEFORE too**: the camera is read through the
 * frame adapter (`camera()`, `scripts/lib/frameAdapter.mjs`, which answers
 * with no scene), and
 * each frame also logs the six FRUSTUM PLANES (`planes`, float64 bits, in
 * `Frustum.GetPlanesToRef`'s order) and the GUN MARKER (`marker`): what the
 * frame pushed to the HUD — `"unpushed"` where nothing updated it, `null` for
 * no marker, else the point it projected (`Game.markerAt`), the projection's
 * output (`Game.markerOut`) and the fractions `HUD.setGunMarker` was handed, as
 * float64 bits. **The planes are READ off the game's own array, never restated
 * off the transform** (X6.1a's review): where the adapter has none to read
 * (with no scene, before X6.1f gives the game `Game.frustumPlanes`) a frame's
 * `planes` is `"unproven"`, the summary says so aloud, and a comparison with a
 * scene's log differs on it unless `--ignore` names `log[*].planes`. On a map
 * with a gunned hull (`--map=coldharbour`) four steps follow `resumed`: the
 * hull BOARDED BY HAND (`Game.mount`, a picture of boarding, which is all a
 * marker needs) as the driver and then the gunner, then (X6.1a's review, for
 * X6.1f's Verify) the driver at render scale 0.75 and the gunner after a
 * resize at that scale — those two posed past every step X6.1a logged
 * (`step`'s `index`), so its log's frames all stand unmoved in this one (a
 * log taken before them holds two steps fewer on such a map, so it is
 * compared step by step rather than by `log[k]`) —
 * with the chase camera's place (its eye and look the pose's, roll 0, so the
 * camera's focal distance is a constant), both guns' muzzles (a few metres
 * ahead of the eye) and both bearings (the pose's own) pinned as functions of
 * the pose — so the marker is the camera's arithmetic and nothing of the
 * drive's — and taken off after (`Game.clearVehicle`), back at size and
 * scale. The marker projects
 * through the PREVIOUS frame's transform, so between steps the pose holds the
 * step's last frame (`n`) rather than counting on past it by however many
 * frames the round trip to Node took; no logged frame's pose moved by that.
 * The default map stays Hollowmere, whose log is the old one's with `planes`
 * and `marker` beside it.
 *
 * **What makes two runs comparable**: a replay's frames are its record's, the
 * camera log's its steps', and neither depends on how fast the machine ran.
 * `--compare` compares two logs with no browser. A lost device ends a run
 * (`harness.mjs`, exit 4), and so does a hard limit (exit 3).
 *
 * **What fails a run** (exit 1): a page or console error; in `replay`, any of
 * the record's origins not recomputed to the live page's bits, or FEWER live
 * answers reproduced than the record holds (`faithful.matched` short of
 * `faithful.live`: the replay is not the round it replays, whatever `--against`
 * says); and any difference `--against` or `--compare` finds that `--ignore`
 * does not name.
 *
 * **`--ignore` names the differences a sub-step EXPECTS** (`post.mjs`' shape),
 * so none is excused by reading past it: a comma list of PATH patterns
 * (repeatable, or `@file`, one a line, `#` comments), `*` any run within one
 * segment (`ids[*]` any index) and `**` any run of segments, matched against
 * the whole path (`ids[12].site`, `log[40].projection`) or any prefix of it —
 * so `ids` excuses the render-id log whole, as X5.4f owes it now Babylon's
 * id has stopped moving, and `**.top` one field on every element.
 *
 * **And OUR render id's advances** (`ours`, X5.4f): every call of
 * `Game.renderId.advance` (`core/renderId.ts`), per frame and whether it was
 * inside one, logged beside Babylon's — the counter the viewmodel's cache is
 * keyed on, moved off the scene's observables until X5.4f and by our frame
 * (`core/SceneFrame.ts`) after it. It reads the same on both sides of that
 * step, which is what says the counter moved at the same points once
 * Babylon's id, which the DEV shadow held it against, no longer moves. What each pattern
 * excused is counted and said, and a pattern that excused nothing is said too,
 * because a difference a step named and did not make is a finding.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { bootMap, hardLimit, HEIGHT, installRound, launchClient, root, startDevServer, WIDTH } from "./harness.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const MODE = args.find((a) => !a.startsWith("--")) ?? null;
const OUT = opt("out", "");
const AGAINST = opt("against", "");
const COMPARE = opt("compare", "");
const LOG = opt("log", "");
const MAP = opt("map", MODE === "camera" ? "hollowmere" : "harrowmead");
const FRAMES = Number(opt("frames", "1500"));
const SEED = 5101;
/** The paths `--against` excuses (`compare`): `--ignore=a,b` (repeatable), or `--ignore=@file`. */
const IGNORE = args
  .filter((a) => a.startsWith("--ignore="))
  .flatMap((a) => a.slice("--ignore=".length).split(","))
  .flatMap((p) => (p.startsWith("@") ? readFileSync(p.slice(1), "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "")) : [p]))
  .map((p) => p.trim())
  .filter(Boolean);

if (COMPARE) {
  if (!AGAINST) throw new Error("--compare=<a.json> wants --against=<b.json>");
  process.exit(compare(JSON.parse(readFileSync(COMPARE, "utf8")), JSON.parse(readFileSync(AGAINST, "utf8"))) ? 1 : 0);
}
if (!["record", "replay", "camera"].includes(MODE)) throw new Error("readers.mjs record|replay|camera (the header)");
if (MODE === "record" && !OUT) throw new Error("record wants --out=<f.json>: it is the replay's input");
if (MODE === "replay" && !LOG) throw new Error("replay wants --log=<record.json>");

hardLimit(1200);

const vite = await startDevServer(root);
const browser = await launchClient({ headed: false });
let result;
try {
  const sep = vite.url.endsWith("/") ? "" : "/";
  const { page, pageErrors, consoleErrors } = await bootMap(browser, `${vite.url}${sep}?seed=${SEED}`, MAP, { hideUI: MODE !== "camera" });
  page.on("dialog", (d) => void d.accept());
  await page.evaluate(installIds);
  if (MODE === "camera") {
    result = await cameraLog(page);
  } else {
    await installRound(page);
    await page.evaluate(() => window.__refFrame().drawn().then(() => window.__refFrame().drawn()));
    await page.evaluate(installReaders);
    result = MODE === "record" ? await page.evaluate(record, FRAMES) : await page.evaluate(replay, JSON.parse(readFileSync(LOG, "utf8")));
  }
  result.mode = MODE;
  result.map = MAP;
  result.seed = SEED;
  result.errors = { page: pageErrors, console: consoleErrors };
} finally {
  await browser.close();
  vite.stop();
}
summarise(result);
if (OUT) writeFileSync(OUT, JSON.stringify(result));
let failed = result.errors.page.length > 0 || result.errors.console.length > 0 || (result.originsChecked && result.originsChecked.some((o) => !o.same));
// A replay that reproduced fewer live answers than its record holds is not the
// round it replays, and grades nothing (the header's "What fails a run").
if (result.faithful && result.faithful.matched < result.faithful.live) failed = true;
if (AGAINST) failed = compare(result, JSON.parse(readFileSync(AGAINST, "utf8"))) || failed;
process.exit(failed ? 1 : 0);

// ---------------------------------------------------------------------------

/**
 * Runs IN THE PAGE, once: the frame counter and the render id's watcher. The
 * counter moves at the frame adapter's DRAW (the scene's render returned), as
 * X4.3b's did; `inFrame` is between the adapter's begin and its submit.
 */
function installIds() {
  const g = window.__celshock;
  const F = window.__refFrame();
  // Babylon's scene through the frame adapter (`harness.mjs`, X6.1a): with
  // none, its render id is RETIRED and `ids` logs nothing.
  const scene = F.babylon()?.scene ?? null;
  const X = (window.__rd = { frame: 0, inFrame: false, ids: [], ours: [], base: null });
  // OUR render id (X5.4f): each advance, wrapped on the instance.
  const rid = g.renderId;
  if (rid) {
    const adv = rid.advance;
    rid.advance = function () {
      X.ours.push({ f: X.frame, inFrame: X.inFrame });
      if (X.ours.length > 200000) X.ours.splice(0, 50000);
      return adv.call(this);
    };
  }
  F.onBegin(() => (X.inFrame = true));
  F.onSubmitted(() => (X.inFrame = false));
  F.onDrawn(() => X.frame++);
  // The site a write came from: the stack's function names, the watcher's own
  // frames and the increment's out, classified where it is one of the three
  // the plan names.
  const siteOf = () => {
    const names = (new Error().stack ?? "")
      .split("\n")
      .slice(1)
      .map((l) => {
        const m = /^\s*at (?:async )?([^\s(]+)?\s*\(?/.exec(l);
        return m?.[1] ?? "(anonymous)";
      })
      .filter((n) => !/__rdSet|set _renderId|Object\.set|incrementRenderId|siteOf/.test(n));
    const top = names.slice(0, 4).join(" < ");
    const all = names.join(" ");
    const first = names[0] ?? "";
    if (/GlowPass/.test(all)) return { site: "the mask's render", top };
    if (/_renderForCamera/.test(first)) return { site: "the camera's render", top };
    if (/RenderTargetTexture|_renderRenderTarget/.test(first)) return { site: "a render target's render", top };
    if (/Scene\._renderFrame$|Scene\.render$/.test(first)) return { site: "the scene's render", top };
    if (!/Scene\.render|_renderLoop|tick/.test(all)) return { site: "the readiness timer", top };
    return { site: "other", top };
  };
  if (!scene) return;
  let id = scene._renderId;
  Object.defineProperty(scene, "_renderId", {
    configurable: true,
    enumerable: true,
    get: () => id,
    set: function __rdSet(v) {
      if (v !== id) {
        const s = siteOf();
        X.ids.push({ f: X.frame, inFrame: X.inFrame, by: v - id, site: s.site, top: s.top });
        if (X.ids.length > 200000) X.ids.splice(0, 50000);
      }
      id = v;
    },
  });
}

/** Runs IN THE PAGE, once a round is installed: what both modes share. */
function installReaders() {
  const g = window.__celshock;
  const X = window.__rd;
  const view = g.playerView.model;
  if (!view.tree) throw new Error("readers.mjs: the viewmodel has no joint tree (a tree before X4.3b)");
  X.view = view;
  const f64 = new Float64Array(1);
  const u8 = new Uint8Array(f64.buffer);
  const bits = (x) => {
    f64[0] = x;
    let s = "";
    for (let i = 7; i >= 0; i--) s += u8[i].toString(16).padStart(2, "0");
    return s;
  };
  X.bits = bits;
  X.vec = (v) => [v.x, v.y, v.z];
  X.vecBits = (v) => [bits(v.x), bits(v.y), bits(v.z)];
  X.matBits = (m) => Array.from(m, bits);
  // FNV-1a over a string, two lanes: a digest, not a security hash.
  X.hash = (s) => {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13);
    }
    return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  };
  X.readers = [];
  X.digests = [];
  // The four readers, as the GAME's own calls are answered: each wrapped on the
  // instance, its answer copied out, nothing else done. The muzzle and the
  // hand are recorded here only when a record's own call or a replayed one
  // asks (`X.readCalls`), the port and the inverse whenever the game asks.
  X.depth = 0;
  for (const [fn, k] of [
    ["muzzleWorld", "muzzle"],
    ["throwHandWorld", "hand"],
  ]) {
    const orig = view[fn];
    view[fn] = function (...a) {
      const r = orig.apply(this, a);
      X.readers.push({ f: X.frame, k, v: X.vec(r), bits: X.vecBits(r) });
      return r;
    };
  }
  const port = view.ejectPortWorld;
  view.ejectPortWorld = function (out) {
    const r = port.call(this, out);
    X.readers.push({ f: X.frame, k: "port", bits: X.matBits(r.m) });
    return r;
  };
  const evalReload = view.evaluateReload;
  view.evaluateReload = function (...a) {
    const r = evalReload.apply(this, a);
    if (r) {
      X.readers.push({ f: X.frame, k: "inverse", bits: X.matBits(this.invWorld.m) });
      X.readers.push({ f: X.frame, k: "fall", bits: X.vecBits(this.reloadInput.fall) });
    }
    return r;
  };
  // What the frame EVALUATED: each joint's world where it lies (a read through
  // the cache would re-stamp it), digested, right after `Game.drawView`.
  const drawView = g.drawView;
  g.drawView = function (...a) {
    const r = drawView.apply(this, a);
    const t = view.tree;
    const parts = [];
    for (let i = 0; i < t.evaluatedCount; i++) {
      const v = t.evaluated[i];
      parts.push(`${v.segment.name}:${X.matBits(v.joint.world.m).join("")}`);
    }
    X.digests.push({ f: X.frame, n: parts.length, h: X.hash(parts.join("|")) });
    if (X.digests.length > 100000) X.digests.splice(0, 20000);
    return r;
  };
}

/** Runs IN THE PAGE: the live round (the header). */
async function record(FRAMES) {
  const g = window.__celshock;
  const X = window.__rd;
  const view = X.view;
  const pv = g.playerView;
  const cam = g.cameraSys.camera;
  const camState = () => ({ p: [cam.position.x, cam.position.y, cam.position.z], r: [cam.rotation.x, cam.rotation.y, cam.rotation.z], fov: cam.fov });
  const events = [];
  let depth = 0;
  // Every call into the viewmodel and its view, outermost only, with its
  // arguments copied and the camera at it.
  const wrap = (obj, fn, copyArgs) => {
    const orig = obj[fn];
    if (typeof orig !== "function") throw new Error(`readers.mjs: no ${fn} to record`);
    obj[fn] = function (...a) {
      const top = depth === 0;
      depth++;
      if (top) events.push({ f: X.frame, fn, args: copyArgs ? copyArgs(a) : [], cam: camState() });
      try {
        return orig.apply(this, a);
      } finally {
        depth--;
      }
    };
  };
  wrap(view, "update", (a) => [a[0], { ...a[1] }]);
  for (const fn of ["setWeapon", "setSight", "setFinish", "setThrowable", "setVisible", "reset", "beginInspect", "endInspect", "spinInspect"]) wrap(view, fn, (a) => [...a]);
  wrap(view, "updateInspect", (a) => [{ fovY: a[0].fovY, aspect: a[0].aspect, bay: { ...a[0].bay } }]);
  wrap(view, "muzzleWorld", null);
  wrap(view, "throwHandWorld", null);
  for (const fn of ["fired", "cleared", "stowed", "stepped"]) wrap(pv, fn, (a) => [...a]);
  // The origins the page submitted, as they went.
  const origins = [];
  for (const fn of ["sendGrenade", "sendOrdnance"]) {
    const o = g.net[fn].bind(g.net);
    g.net[fn] = (at, dir) => {
      origins.push({ f: X.frame, k: fn, at: X.vecBits(at), dir: X.vec(dir), eye: X.vec(cam.position) });
      return o(at, dir);
    };
  }
  // X4.3b's schedule, after the real input update.
  const sched = (f) => {
    const s = { fire: false, ads: false, sprint: false, moveY: 0, look: Math.sin(f / 37) * 6, lookY: Math.sin(f / 53) * 2, reload: false, grenade: false, slot: -1 };
    if (f >= 60 && f < 200) s.fire = f % 10 < 5;
    if (f >= 200 && f < 330) {
      s.ads = true;
      s.fire = f % 16 < 6;
    }
    if (f >= 330 && f < 430) {
      s.sprint = true;
      s.moveY = 1;
    }
    if (f === 440) s.reload = true;
    if (f >= 540 && f < 700) s.fire = f % 4 < 2;
    if (f === 760) s.grenade = true;
    if (f === 860) s.slot = 1;
    if (f >= 900 && f < 980) s.fire = f % 6 < 3;
    if (f === 1040) s.slot = 2;
    if (f >= 1110 && f < 1114) s.fire = true;
    if (f >= 1180 && f < 1260) s.ads = true;
    if (f >= 1230 && f < 1234) s.fire = true;
    if (f === 1300) s.slot = 0;
    if (f === 1380) s.grenade = true;
    return s;
  };
  let pf = 0;
  const inp = g.input;
  const update = inp.update.bind(inp);
  inp.update = () => {
    update();
    const s = sched(pf++);
    inp.pointerLocked = true;
    inp.fire = s.fire;
    inp.ads = s.ads;
    inp.sprint = s.sprint;
    inp.moveY = s.moveY;
    inp.mouseLookX = s.look;
    inp.mouseLookY = s.lookY;
    inp.reloadPressed = s.reload;
    inp.grenadePressed = s.grenade;
    inp.slotPressed = s.slot;
    if (pf === 1350) g.player.setThrowable("molotov");
  };
  // The camera at each frame's hand-over (the frame passes `followEye`
  // before it draws; `stageWarmFrame`, the hook until BABYLON_EXIT.md X5.4c
  // deleted it, ran straight before it with nothing between).
  const frameCams = [];
  const stage = g.followEye;
  g.followEye = function (...a) {
    frameCams.push({ f: X.frame, cam: camState() });
    return stage.apply(this, a);
  };
  g.setWeapon("rifle");
  g.setSight("holo");
  g.setEquipment("rpg");
  g.setThrowable("frag");
  const readersFrom = X.readers.length;
  const idsFrom = X.ids.length;
  const oursFrom = X.ours.length;
  g.spawnPlayer();
  await new Promise((res) => {
    const p = () => (g.state === "playing" ? res() : setTimeout(p, 5));
    p();
  });
  pf = 0;
  const start = X.frame;
  await new Promise((res) => {
    const off = window.__refFrame().onDrawn(() => {
      if (X.frame - start < FRAMES) return;
      off();
      res();
    });
  });
  inp.update = update;
  g.followEye = stage;
  return {
    events,
    frameCams,
    readers: X.readers.slice(readersFrom),
    origins,
    ids: X.ids.slice(idsFrom),
    ours: X.ours.slice(oursFrom),
    frames: X.frame - start,
    state: g.state,
    alive: g.player.alive,
    config: { handAhead: (await import("/src/config/index.ts")).CONFIG.grenade.handAhead, launchAhead: (await import("/src/config/index.ts")).CONFIG.equipment.rpg.rocket.launchAhead },
  };
}

/** Runs IN THE PAGE: a record replayed in `deploy` (the header). */
async function replay(log) {
  const g = window.__celshock;
  const X = window.__rd;
  const view = X.view;
  const pv = g.playerView;
  const cam = g.cameraSys.camera;
  const setCam = (c) => {
    cam.position.set(c.p[0], c.p[1], c.p[2]);
    cam.rotation.set(c.r[0], c.r[1], c.r[2]);
    cam.fov = c.fov;
  };
  // A frame's calls, grouped by the record's frame and renumbered from the first.
  const byFrame = new Map();
  const f0 = log.events.length ? log.events[0].f : 0;
  for (const e of log.events) {
    const k = e.f - f0;
    if (!byFrame.has(k)) byFrame.set(k, []);
    byFrame.get(k).push(e);
  }
  const last = Math.max(...byFrame.keys());
  const frameCam = new Map();
  for (const c of log.frameCams) frameCam.set(c.f - f0, c.cam);
  // Seeded `Math.random` for the flash and the brass, both trees alike.
  let seed = 0x1234567;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let fr = -1;
  const stage = g.followEye;
  let done;
  const finished = new Promise((r) => (done = r));
  const readersFrom = X.readers.length;
  const idsFrom = X.ids.length;
  const oursFrom = X.ours.length;
  const digestsFrom = X.digests.length;
  const frameAt = new Map();
  g.followEye = function (...a) {
    if (fr >= 0 && fr <= last) {
      frameAt.set(X.frame, fr);
      for (const e of byFrame.get(fr) ?? []) {
        if (e.cam) setCam(e.cam);
        if (e.fn === "update") view.update(e.args[0], e.args[1]);
        else if (e.fn === "muzzleWorld") view.muzzleWorld();
        else if (e.fn === "throwHandWorld") view.throwHandWorld();
        else if (e.fn === "fired") {
          const keep = Math.random;
          Math.random = rnd;
          try {
            pv.fired();
          } finally {
            Math.random = keep;
          }
        } else if (e.fn === "stepped" || e.fn === "cleared" || e.fn === "stowed") pv[e.fn](...e.args);
        else view[e.fn](...e.args);
      }
      const c = frameCam.get(fr);
      if (c) setCam(c);
    }
    return stage.apply(this, a);
  };
  const off = window.__refFrame().onDrawn(() => {
    fr++;
    if (fr > last + 2) {
      off();
      done();
    }
  });
  await finished;
  g.followEye = stage;
  // Renumbered onto the record's frames: a replay frame's events ran at
  // `followEye`, before that frame's draw moved `X.frame`.
  const at = (f) => frameAt.get(f) ?? null;
  const readers = X.readers.slice(readersFrom).map((r) => ({ ...r, f: at(r.f) }));
  const ids = X.ids.slice(idsFrom).map((r) => ({ ...r, f: at(r.f) }));
  const ours = X.ours.slice(oursFrom).map((r) => ({ ...r, f: at(r.f) }));
  const digests = X.digests.slice(digestsFrom).map((d) => ({ ...d, f: at(d.f) }));
  // The origins the record submitted, recomputed from THIS replay's answers by
  // `Game`'s own floors, operation for operation (a Vector3's arithmetic is
  // plain doubles), and held to the live page's bits.
  const fromBits = (h) => {
    const b = new Uint8Array(8);
    for (let i = 0; i < 8; i++) b[7 - i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return new Float64Array(b.buffer)[0];
  };
  const originsChecked = log.origins.map((o) => {
    const k = o.k === "sendGrenade" ? "hand" : "muzzle";
    const r = readers.filter((x) => x.k === k && x.f === o.f - f0).pop();
    if (!r) return { k: o.k, f: o.f - f0, same: false, why: "no reader answer on that frame" };
    const p = r.bits.map(fromBits);
    const [ex, ey, ez] = o.eye;
    const [fx, fy, fz] = o.dir;
    const ahead = (p[0] - ex) * fx + (p[1] - ey) * fy + (p[2] - ez) * fz;
    if (k === "hand") {
      const h = log.config.handAhead;
      if (ahead < h) {
        const d = h - ahead;
        p[0] += fx * d;
        p[1] += fy * d;
        p[2] += fz * d;
      }
    } else {
      const l = log.config.launchAhead;
      if (ahead < l) {
        p[0] = ex + fx * l;
        p[1] = ey + fy * l;
        p[2] = ez + fz * l;
      }
    }
    const got = p.map(X.bits);
    return { k: o.k, f: o.f - f0, same: got.every((b, i) => b === o.at[i]), live: o.at, replayed: got };
  });
  // The live record's own answers against this replay's, frame for frame (the
  // harness's faithfulness, as X4.3b's parent run showed it).
  const liveReaders = log.readers.map((r) => ({ ...r, f: r.f - f0 }));
  const key = (r) => `${r.f}:${r.k}:${r.bits.join(",")}`;
  const liveSet = new Map();
  for (const r of liveReaders) liveSet.set(key(r), (liveSet.get(key(r)) ?? 0) + 1);
  let matched = 0;
  for (const r of readers) {
    const n = liveSet.get(key(r)) ?? 0;
    if (n > 0) {
      matched++;
      liveSet.set(key(r), n - 1);
    }
  }
  return {
    frames: last + 1,
    readers,
    digests,
    ids: ids.map(({ top, ...rest }) => rest),
    ours,
    idSites: [...new Set(X.ids.slice(idsFrom).map((r) => `${r.site} <- ${r.top}`))],
    originsChecked,
    faithful: { live: liveReaders.length, replayed: readers.length, matched },
  };
}

/**
 * The camera log (the header): a step a state, its frames logged with the pose
 * pinned. Runs from Node, the page driven through the game's own doors.
 */
async function cameraLog(page) {
  const N = 8;
  await page.evaluate((n) => {
    const g = window.__celshock;
    const F = window.__refFrame();
    const cam = g.cameraSys.camera;
    const f64 = new Float64Array(1);
    const u8 = new Uint8Array(f64.buffer);
    const b64 = (x) => {
      f64[0] = x;
      let s = "";
      for (let i = 7; i >= 0; i--) s += u8[i].toString(16).padStart(2, "0");
      return s;
    };
    const f32 = new Float32Array(1);
    const u8b = new Uint8Array(f32.buffer);
    const b32 = (x) => {
      f32[0] = x;
      let s = "";
      for (let i = 3; i >= 0; i--) s += u8b[i].toString(16).padStart(2, "0");
      return s;
    };
    const C = (window.__cam = { step: null, k: 0, n, log: [], pins: 0, marker: "unpushed" });
    // The pose, pinned at the frame's own update: a function of the step and
    // its frame alone — the frame held at the step's last (`n`) between steps,
    // where a step's count runs on past it by however many frames the round
    // trip to Node took (X6.1a: the gun marker reads the frame BEFORE's matrices).
    const poseOf = () => {
      const s = C.stepIndex ?? 0;
      const k = Math.min(C.k, C.n);
      return {
        x: 3 + s * 0.37 + k * 0.011,
        y: 2.1 + s * 0.05,
        z: -7 + k * 0.023,
        pitch: 0.05 + k * 0.004,
        yaw: 0.3 + s * 0.21 + k * 0.009,
      };
    };
    const pin = () => {
      const q = poseOf();
      cam.position.set(q.x, q.y, q.z);
      cam.rotation.set(q.pitch, q.yaw, 0);
    };
    window.__camPose = poseOf;
    F.onBeforeDraw(() => {
      pin();
      C.pins++;
    });
    // The gun marker (X6.1a, X6.1f's BEFORE): what the frame pushed to the HUD
    // — `"unpushed"` on a frame whose HUD was not updated, `null` for no marker,
    // else the point it projected (`Game.markerAt`), the projection's output
    // (`Game.markerOut`) and the fractions the HUD was handed, as float64 bits.
    F.onBegin(() => (C.marker = "unpushed"));
    const setGunMarker = g.hud.setGunMarker;
    g.hud.setGunMarker = function (x, y) {
      C.marker =
        x === null || x === undefined
          ? null
          : {
              at: [g.markerAt.x, g.markerAt.y, g.markerAt.z].map(b64),
              out: [g.markerOut.x, g.markerOut.y, g.markerOut.z].map(b64),
              screen: [x, y].map(b64),
            };
      return setGunMarker.call(this, x, y);
    };
    // A HULL (X6.1a, on a map with a gunned one: the gun marker's frames).
    // Boarded by hand — a picture of boarding, which is all a marker needs
    // (`VERIFYING.md`: the authority never seats it, and refuses every drive
    // the page reports) — and everything the marker reads PINNED as the pose
    // is: the chase camera's place (its eye and look the pose's, so the
    // camera's focal distance is a constant), the gun's and the cupola gun's
    // muzzles a little ahead of the eye and their bearings the pose's own, so
    // the marker is a function of the step and its frame alone.
    const V = cam.position.constructor;
    const aim = () => {
      const q = poseOf();
      const d = { x: Math.sin(q.yaw) * Math.cos(q.pitch), y: -Math.sin(q.pitch), z: Math.cos(q.yaw) * Math.cos(q.pitch) };
      return { q, d };
    };
    window.__camHull = (i, seat) => {
      const tank = g.vehicles.hulls[i];
      if (!C.hull) {
        C.hull = { tank };
        g.cameraSys.place = function (_eye, _look, fov) {
          const { q, d } = aim();
          return Object.getPrototypeOf(this).place.call(this, new V(q.x, q.y, q.z), new V(q.x + d.x * 10, q.y + d.y * 10, q.z + d.z * 10), fov, 0);
        };
        const muzzle = (ahead, drop) => (out) => {
          const { q, d } = aim();
          return out.set(q.x + d.x * ahead, q.y + d.y * ahead - drop, q.z + d.z * ahead);
        };
        const bearing = (out) => {
          const { d } = aim();
          return out.set(d.x, d.y, d.z);
        };
        tank.muzzleToRef = muzzle(5, 0.5);
        tank.gunDirToRef = bearing;
        tank.mgMuzzleToRef = muzzle(3, 0.25);
        tank.mgDirToRef = bearing;
      }
      if (g.driving) g.clearVehicle();
      g.mount(tank, seat);
    };
    window.__camHullOff = () => {
      if (!C.hull) return;
      g.clearVehicle();
      for (const k of ["muzzleToRef", "gunDirToRef", "mgMuzzleToRef", "mgDirToRef"]) delete C.hull.tank[k];
      delete g.cameraSys.place;
      C.hull = null;
    };
    F.onDrawn(() => {
      if (C.step && C.k < C.n && g.state === C.want) {
        // The camera through the frame adapter (`harness.mjs`, X6.1a): its
        // matrices as this frame computed them, the render size and the aspect
        // the engine handed it, and the frustum planes.
        const c = F.camera();
        C.log.push({
          step: C.step,
          k: C.k,
          state: g.state,
          inputs: {
            position: [cam.position.x, cam.position.y, cam.position.z].map(b64),
            rotation: [cam.rotation.x, cam.rotation.y, cam.rotation.z].map(b64),
            fov: b64(cam.fov),
            minZ: b64(cam.minZ),
            maxZ: b64(cam.maxZ),
            mode: cam.mode,
            fovMode: cam.fovMode,
            renderSize: [c.renderWidth, c.renderHeight],
            aspect: b64(c.aspect),
          },
          view: Array.from(c.view, b32).join(""),
          projection: Array.from(c.projection, b32).join(""),
          transform: Array.from(c.transform, b32).join(""),
          globalPosition: c.globalPosition.map(b64),
          // `"unproven"` where the adapter has no plane array of the game's
          // to read (`scripts/lib/frameAdapter.mjs`: with no scene before
          // X6.1f) — never planes restated off the transform.
          planes: c.planes ? c.planes.map((q) => q.map(b64)) : "unproven",
          marker: C.marker,
        });
      }
      if (C.step && g.state === C.want) C.k++;
    });
  }, N);
  const steps = [];
  // Each step's act, then — but for the building card, which is logged from its
  // first frames — the state reached and SETTLE frames let pass, so a resize,
  // a render scale or a lid that lands a frame or two late on one run is
  // logged settled on every run.
  const SETTLE = 20;
  // `index` is the step's place in the POSE (`poseOf`): by default the next
  // of the steps X6.1a logged, in order. A step added after X6.1a's review
  // names one past all of them and takes none of their places, so no step
  // X6.1a logged moved its pose and its frames still compare with that log's.
  let nextIndex = 0;
  const step = async (name, want, act, settle = SETTLE, index = nextIndex++) => {
    if (act) await act();
    if (settle > 0) {
      await page.evaluate(
        ([want, n]) =>
          new Promise((res, rej) => {
            let k = 0;
            const t0 = performance.now();
            const off = window.__refFrame().onDrawn(() => {
              if (window.__celshock.state === want) k++;
              if (k >= n) {
                off();
                res();
              } else if (performance.now() - t0 > 120_000) {
                off();
                rej(new Error(`camera: ${want} not reached`));
              }
            });
          }),
        [want, settle],
      );
    }
    await page.evaluate(([name, want, i]) => {
      const C = window.__cam;
      C.step = name;
      C.want = want;
      C.stepIndex = i;
      C.k = 0;
    }, [name, want, index]);
    const reached = await page.evaluate(
      (want) =>
        new Promise((res) => {
          const C = window.__cam;
          const t0 = performance.now();
          const off = window.__refFrame().onDrawn(() => {
            if (C.k >= C.n) {
              off();
              res(true);
            } else if (performance.now() - t0 > 120_000) {
              off();
              res(false);
            }
          });
        }),
      want,
    );
    steps.push(`${name} (${want}): ${reached ? "logged" : "NOT REACHED"}`);
    await page.evaluate(() => (window.__cam.step = null));
  };
  const g = (fn, arg) => page.evaluate(fn, arg);
  await step("menu", "menu");
  await step("loading", "loading", () => g(() => window.__celshock.startRound()), 0);
  await g(() => new Promise((res) => {
    const p = () => (window.__celshock.state === "deploy" ? res() : setTimeout(p, 10));
    p();
  }));
  await step("deploy", "deploy");
  await step("kit", "loadout", () => g(() => window.__celshock.openLoadout()));
  await step("deploy again", "deploy", () => g(() => window.__celshock.closeLoadout()));
  await step("a life", "playing", () => g(() => window.__celshock.spawnPlayer()));
  await step("render scale 0.75", "playing", () => g(() => window.__celshock.setSetting("renderScale", 0.75)));
  await step("a resize", "playing", () => page.setViewportSize({ width: 1280, height: 721 }));
  await step("back to size", "playing", async () => {
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await g(() => window.__celshock.setSetting("renderScale", 1));
  });
  await step("the pause", "paused", () => g(() => window.__celshock.pause()));
  await step("resumed", "playing", () => g(() => window.__celshock.resume()));
  // A gunned hull, where the map has one (X6.1a): the driver's marker, then the gunner's.
  const hull = await g(() => window.__celshock.vehicles.hulls.findIndex((h) => Boolean(h.spec.gun)));
  if (hull >= 0) {
    await step("a hull, the driver", "playing", () => g((i) => window.__camHull(i, 0), hull));
    await step("a hull, the gunner", "playing", () => g((i) => window.__camHull(i, 1), hull));
    // The marker at another render scale and another size (X6.1a's review, for
    // X6.1f's Verify): the driver at render scale 0.75, then the gunner after
    // a resize at that scale — posed one and two past X6.1a's last step (its
    // 15 on a map with a hull, 0 to 14), so every step it logged keeps its
    // pose and its frames — then back to size.
    await step("a hull at render scale 0.75, the driver", "playing", async () => {
      await g(() => window.__celshock.setSetting("renderScale", 0.75));
      await g((i) => window.__camHull(i, 0), hull);
    }, SETTLE, 15);
    await step("a hull after a resize, the gunner", "playing", async () => {
      await page.setViewportSize({ width: 1280, height: 721 });
      await g((i) => window.__camHull(i, 1), hull);
    }, SETTLE, 16);
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await g(() => window.__celshock.setSetting("renderScale", 1));
    await g(() => window.__camHullOff());
  }
  await step("the round over", "roundover", () => g(() => window.__celshock.endRound(0)));
  await step("the menu again", "menu", () => g(() => window.__celshock.enterMenu()));
  const log = await page.evaluate(() => window.__cam.log);
  return { steps, log };
}

/** What a reader looks at first. */
function summarise(r) {
  console.log(`readers.mjs ${r.mode} on ${r.map}, seed ${r.seed}`);
  if (r.mode === "record") {
    const n = (k) => r.readers.filter((x) => x.k === k).length;
    console.log(`  ${r.frames} frames, ${r.events.length} calls, readers: muzzle ${n("muzzle")}, hand ${n("hand")}, port ${n("port")}, inverse ${n("inverse")}, fall ${n("fall")}; origins ${r.origins.map((o) => o.k).join(", ") || "none"}; ended ${r.state}${r.alive ? "" : " (dead)"}`);
  }
  if (r.ids) {
    const bySite = {};
    for (const x of r.ids) bySite[`${x.site}${x.inFrame ? "" : " (between frames)"}`] = (bySite[`${x.site}${x.inFrame ? "" : " (between frames)"}`] ?? 0) + 1;
    console.log(`  render id changes: ${JSON.stringify(bySite)}`);
  }
  if (r.idSites) for (const s of r.idSites) console.log(`    site ${s}`);
  if (r.ours) {
    const per = new Map();
    for (const x of r.ours) per.set(x.f, (per.get(x.f) ?? 0) + 1);
    const counts = {};
    for (const n of per.values()) counts[n] = (counts[n] ?? 0) + 1;
    console.log(`  our render id: ${r.ours.length} advances over ${per.size} frames (advances a frame: ${JSON.stringify(counts)}; ${r.ours.filter((x) => !x.inFrame).length} between frames)`);
  }
  if (r.mode === "replay") {
    const n = (k) => r.readers.filter((x) => x.k === k).length;
    console.log(`  ${r.frames} frames replayed, ${r.digests.length} evaluations digested, readers: muzzle ${n("muzzle")}, hand ${n("hand")}, port ${n("port")}, inverse ${n("inverse")}, fall ${n("fall")}`);
    console.log(`  faithful: ${r.faithful.matched} of ${r.faithful.live} live answers reproduced (${r.faithful.replayed} replayed)${r.faithful.matched < r.faithful.live ? " — NOT FAITHFUL: the run fails" : ""}`);
    for (const o of r.originsChecked) console.log(`  origin ${o.k} on frame ${o.f}: ${o.same ? "IDENTICAL to the live page's" : `DIFFERS (${o.why ?? JSON.stringify(o)})`}`);
  }
  if (r.mode === "camera") {
    for (const s of r.steps) console.log(`  ${s}`);
    console.log(`  ${r.log.length} frames logged`);
    const unproven = r.log.filter((x) => x.planes === "unproven").length;
    if (unproven) {
      console.log(`  FRUSTUM PLANES UNPROVEN on ${unproven} of ${r.log.length} frames: no plane array of the game's to read (no scene, and no Game.frustumPlanes before X6.1f) — a comparison with a scene's log differs on them unless --ignore names log[*].planes`);
    }
  }
  if (r.errors.page.length || r.errors.console.length) {
    console.log(`  ${r.errors.page.length} page errors, ${r.errors.console.length} console errors`);
    for (const e of [...r.errors.page, ...r.errors.console].slice(0, 5)) console.log(`    ${String(e).slice(0, 300)}`);
  }
}

/**
 * Two logs of one mode, compared value by value; true on a difference that
 * `--ignore` does not name (the header). A pattern is anchored at both ends and
 * tested at every node of the walk, so one matching a prefix of a path excuses
 * everything under it.
 */
function compare(a, b) {
  if (a.mode !== b.mode) {
    console.log(`against: a ${a.mode} log here and a ${b.mode} log there`);
    return true;
  }
  const parts = a.mode === "camera" ? ["steps", "log"] : a.mode === "replay" ? ["frames", "readers", "digests", "ids", "ours", "originsChecked"] : ["readers", "origins", "ids", "ours"];
  const escape = (t) => t.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const token = (t) => (t === "**" ? ".*" : t === "*" ? "[^.]*" : escape(t));
  const ignores = IGNORE.map((pattern) => ({ pattern, re: new RegExp(`^${pattern.split(/(\*\*|\*)/).map(token).join("")}$`), hits: 0, values: 0 }));
  const count = (v) => (Array.isArray(v) ? v.reduce((s, e) => s + count(e), 0) : v && typeof v === "object" ? Object.values(v).reduce((s, e) => s + count(e), 0) : 1);
  let diffs = 0;
  const say = (m) => {
    if (diffs++ < 40) console.log(`against: ${m}`);
  };
  const walk = (x, y, path) => {
    const ig = ignores.find((r) => r.re.test(path));
    if (ig) {
      ig.hits++;
      ig.values += Math.max(count(x), count(y));
      return;
    }
    const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
    if (kind(x) !== kind(y)) return say(`${path} is ${JSON.stringify(x)?.slice(0, 120)} here and ${JSON.stringify(y)?.slice(0, 120)} there`);
    if (Array.isArray(x)) {
      if (x.length !== y.length) say(`${path} has length ${x.length} here and ${y.length} there`);
      for (let i = 0; i < Math.min(x.length, y.length); i++) walk(x[i], y[i], `${path}[${i}]`);
      return;
    }
    if (x && typeof x === "object") {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${path}.${k}`);
      return;
    }
    if (!Object.is(x, y)) say(`${path} is ${JSON.stringify(x)} here and ${JSON.stringify(y)} there`);
  };
  for (const p of parts) walk(a[p], b[p], p);
  if (diffs > 40) console.log(`against: … and ${diffs - 40} more`);
  for (const r of ignores) console.log(`against: --ignore ${r.pattern} ${r.hits ? `excused ${r.hits} path${r.hits === 1 ? "" : "s"} (${r.values} values)` : "matched NOTHING"}`);
  console.log(diffs ? `against: DIFFERS (${diffs})` : `against: equal (${parts.join(", ")})`);
  return diffs > 0;
}
