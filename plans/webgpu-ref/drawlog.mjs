/**
 * The DRAW LOG: what BABYLON draws and compiles in every state a session
 * passes through, live — `BABYLON_EXIT.md` X5.3a, the Phase 4 gate's scratch
 * `gate-p4/renderlog.mjs` made an instrument.
 *
 *   node plans/webgpu-ref/drawlog.mjs [map...] [--out=f.json] [--against=f.json]
 *     [--ignore=<regex>] [--no-viewer] [--limit=<seconds>]
 *
 * Owns: nothing but a report and, when asked, one JSON file. It draws nothing
 * and changes no state of the game's but what its script plays.
 *
 * **What it records, by FRAME CLASS** (the game's state at the engine's
 * begin-frame; until `BABYLON_EXIT.md` X5.3c the map editor's state and the
 * building card raised over its build, `loading (from the editor)`, were two
 * classes more):
 * - **`draws`**: every call of the engine's `_draw` — which every Babylon draw
 *   of any kind comes through, a mesh, a post process, a layer, an effect
 *   layer, a utility layer — keyed by what was drawing (inside `Mesh.render`,
 *   the mesh's name with its digits folded to `#`, else the effect's name) and
 *   the render target it drew into.
 * - **`group0`**: Babylon's VISITS of rendering group 0
 *   (`onBeforeRenderingGroupObservable` for group 0), keyed by the target the
 *   visit drew into — the frame (the camera's output target) or another pass's
 *   (the glow's mask; a shadow generator's until X5.3d). No class visits it,
 *   and since X5.3d retired the seam's items 6 and 10 `onMainPass` ASSUMES
 *   none does (`render/babylonSeam.ts`), telling the four points at the draw
 *   phase's end with nothing of Babylon's between them — so a visit is
 *   ASSERTED as the counter below is: a run with one in any class fails
 *   (exit 1), whatever `--against` says.
 * - **`compiles`**: every Babylon EFFECT compiled — `createEffect` adding a key
 *   to the engine's cache, named by its vertex and fragment (an inline source
 *   by a hash) and a hash of its defines — and every compute effect
 *   (`createComputeEffect`) the same. What was compiled before the probe
 *   could hook the engine is `compiledAtBoot`, the cache's keys at that moment.
 * - **`meshes`**: the sizes `scene.meshes` held at a frame's end, and the
 *   folded names of what it held (each name's largest count), read on the
 *   first frame of every visit to the class and on every frame its size
 *   moved — never on a clock, which a two-frame state is hit or missed by as
 *   the machine's pace decides.
 *
 * **And the game's own DEV counter of Babylon effect compiles**
 * (`Game.babylonCompiles`, `src/core/babylonCompiles.ts`, `BABYLON_EXIT.md`
 * X5.3d), read at every frame's end: the values it took in each class, kept
 * beside the classes (`babylonCompiles`) rather than in them, so a parent's
 * log without one compares, and ASSERTED — a run in which it is not 0 in
 * every class fails (exit 1), whatever `--against` says. It counts from the
 * game's construction, so what the engine compiled for itself while it was
 * built (`clearQuad`, the engine's own and in `compiledAtBoot`) is not in it;
 * a tree before X5.3d has no counter, which the report says.
 *
 * **And the scene's RENDERS** (`BABYLON_EXIT.md` X5.4f): every call of
 * `scene.render`, counted per frame, and the counts each class took kept
 * beside the classes (`renders`), never compared — 1 a frame in every class at
 * every parent before X5.4f, which takes the frame from Babylon
 * (`core/SceneFrame.ts`): on a tree with OUR frame (`Game.sceneFrame`) a run
 * in which a class rendered the scene at all fails (exit 1), whatever
 * `--against` says.
 *
 * **And Babylon's BEGIN-FRAMES** (`BABYLON_EXIT.md` X5.4g): every call of the
 * engine's `beginFrame`, counted per frame and folded at its end beside the
 * renders (`begins`), never compared — 1 a frame in every class at every
 * parent before X5.4g, whose render loop was Babylon's — and apart from them
 * the calls made inside the engine's own resize (`_initializeMainAttachments`'
 * begin and end of frame, Babylon's still until X5.4h), counted in a total
 * of their own (`resizeBegins`). On a tree with OUR loop (`Game.frameLoop`) a
 * run in which a class saw a `beginFrame` outside a resize fails (exit 1),
 * whatever `--against` says.
 *
 * **A draw between frames** — issued after one frame's end and before the
 * next's begin, as a render target rendered from a promise would be — is
 * folded into a class of its own, `between frames`, rather than cleared
 * unread; a session that issues none has no such class. (A compile there is
 * filed under the class of the frame before it.)
 *
 * A key's entry is the SET of per-frame counts it took and whether it was
 * there on every frame of the class (`always`) — never a total, which rides
 * how many frames the machine fitted into each state. That is what lets the
 * log be compared with itself across two processes, and with a parent's.
 * Beside it, never compared: the frames of each class, what the round DID
 * (counted at its doors) and the steps the script reached.
 *
 * **The script** (one page a map, the round's seed pinned): the menu at boot,
 * the building card, deploy, the KIT lid over deploy, a life (every primary
 * fired round the compass, a frag, the launcher on an armoured map, a pane
 * broken — by fire, or by `glass.shoot` if no round reaches one — a flying hull
 * pinned on a descent to the ground and back where one exists, then walked at
 * the farthest flag until the authority kills the player: the DEATH CAM),
 * deploy again, a second life with the PAUSE lid raised and lowered, the
 * ROUND-OVER card (`Game.endRound`, the method the wire's `roundover`
 * reaches), the menu, a second round and a short life, and the menu. (Until
 * X5.3c it ended in the map editor — `Shift+F2` from the menu, and back into the
 * round leaving it opened — unless `--no-editor`; the editor's step is retired
 * with the editor, row "X5.3, retire the editor", and `--no-editor` is accepted
 * and does nothing.) **A step it does not reach fails the run** (exit 2): a log
 * missing a state is not a log of it.
 *
 * **The VIEWER** (`BABYLON_EXIT.md` X5.3b, the dev-only map viewer's lid, `F2`
 * since then) is raised three times unless `--no-viewer`: over the first
 * deploy (after the kit lid), over the death cam the first life ends in, and
 * over the second life before its pause — each time flown to a flag, its nav
 * plan and marks shown, its work light taken off and put back, and lowered
 * through `Game.toggleViewer` as `F2` lowers it. Its frames are the class
 * `viewer`. The page's own match is held under it, so the classes around it
 * are the ones a run without it logs, which is how a parent with no viewer is
 * compared: `--ignore='^[a-z]+/viewer(/|$)'`.
 *
 * `--against` compares the recorded classes with an earlier `--out`'s and exits
 * 1 on any difference, naming each by path (`<map>/<class>/<field>/<key>`);
 * `--ignore` takes a regular expression over those paths, for a difference a
 * step names (X5.3c's: the two classes the editor was,
 * `--ignore='^[a-z]+/(editor|loading \(from the editor\))(/|$)'`, against a
 * parent's log that has them).
 *
 * Its log at X5.3a's parent is X5.3's BEFORE: the editor and the card raised
 * over its build were the only classes in which Babylon draws, visits group 0
 * or compiles an effect, and every other state does none of the three — the
 * post chain being ours since X5.2d, so a round's frame holds no Babylon draw
 * at all. Since X5.3c no class here draws, visits group 0 or compiles.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { bootMap, hardLimit, installRound, launchClient, root, startDevServer } from "./harness.mjs";

const args = process.argv.slice(2);
const MAPS = args.filter((a) => !a.startsWith("--"));
if (MAPS.length === 0) MAPS.push("coldharbour");
// `--no-editor` is accepted and does nothing: the editor's step is retired (X5.3c).
const VIEWER = !args.includes("--no-viewer");
const val = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = val("out");
const AGAINST = val("against");
const IGNORE = val("ignore") ? new RegExp(val("ignore")) : null;
/** The round's seed, so which spawn the player takes is a constant. */
const SEED = 5101;
/** How long the script walks at the far flag waiting to be killed. */
const DEATH_WAIT_S = 240;

hardLimit(1800 * MAPS.length);

/** Runs IN THE PAGE: the hooks. See the header for what each records. */
function installHooks() {
  const g = window.__celshock;
  // Babylon's engine, the scene's (`harness.mjs`' `frameAdapter`): `Game.engine` at a parent, a `NullEngine` since X5.4h.
  const e = g.scene.getEngine();
  const scene = g.scene;
  const fold = (n) => String(n).replace(/\d+/g, "#");
  const hash = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  // An effect cache key, `vertex+fragment@defines`, made short and stable.
  const effectKey = (key) => {
    const at = key.indexOf("@");
    const base = at < 0 ? key : key.slice(0, at);
    const defines = at < 0 ? "" : key.slice(at + 1);
    const named = base.length > 80 || /[\n;{]/.test(base) ? `inline:${hash(base)}` : base;
    return `${named} #${hash(defines)}`;
  };
  const effName = (eff) => {
    if (!eff) return "(none)";
    const n = eff.name;
    if (typeof n === "string") return n.length > 80 ? `inline:${hash(n)}` : n;
    if (n && typeof n === "object") {
      const s = n.fragment ?? n.fragmentElement ?? n.vertex ?? n.vertexElement;
      if (typeof s === "string") return s;
      return n.fragmentSource ? `inline:${hash(String(n.fragmentSource))}` : JSON.stringify(Object.keys(n));
    }
    return String(n);
  };
  const targetOf = () => {
    const rt = e._currentRenderTarget;
    if (!rt) return "canvas";
    return rt.label || rt.texture?.name || rt._textures?.[0]?.label || "rt";
  };

  const L = (window.__drawLog = {
    classes: {},
    counter: {},
    frames: {},
    cls: null,
    frameNo: 0,
    visit: true,
    lastSize: -1,
    draw: new Map(),
    group0: new Map(),
    meshCtx: null,
    compiledAtBoot: Object.keys(e._compiledEffects ?? {}).map(effectKey).sort(),
    notes: [],
    renders: {},
    renderCalls: 0,
    begins: {},
    beginCalls: 0,
    inResize: 0,
    resizeBegins: 0,
  });
  // The engine's begin-frames (the header): counted per frame, a resize's apart.
  const beginFrame = e.beginFrame;
  e.beginFrame = function (...a) {
    if (L.inResize > 0) L.resizeBegins++;
    else L.beginCalls++;
    return beginFrame.apply(this, a);
  };
  const initMain = e._initializeMainAttachments;
  if (typeof initMain === "function") {
    e._initializeMainAttachments = function (...a) {
      L.inResize++;
      try {
        return initMain.apply(this, a);
      } finally {
        L.inResize--;
      }
    };
  }
  // The scene's renders (the header): counted per frame, folded at its end.
  const render = scene.render;
  scene.render = function (...a) {
    L.renderCalls++;
    return render.apply(this, a);
  };
  const classOf = (c) =>
    (L.classes[c] ??= { draws: {}, group0: {}, compiles: {}, computeCompiles: {}, meshes: { sizes: [], names: {} } });
  /** The class of what was drawn between one frame's end and the next's begin. */
  const BETWEEN = "between frames";

  const classNow = () => g.state;
  // A frame's counts, folded into its class: the SET of per-frame counts each
  // key took, and on how many frames it appeared (`always` at the end).
  const fold1 = (bucket, counts) => {
    for (const [k, n] of counts) {
      const r = (bucket[k] ??= { counts: [], frames: 0 });
      if (!r.counts.includes(n)) r.counts.push(n);
      r.frames++;
    }
  };
  // The frame's begin and end through the frame adapter (`harness.mjs`,
  // X5.4a): Babylon's engine observables at every parent so far.
  const F = window.__refFrame();
  F.onBegin(() => {
    // Whatever was drawn since the last frame ENDED (a render target rendered
    // from a promise, say) is outside every frame: it is folded into a class
    // of its own rather than cleared unread, or it is a draw no log shows.
    if (L.draw.size > 0 || L.group0.size > 0) {
      const b = classOf(BETWEEN);
      L.frames[BETWEEN] = (L.frames[BETWEEN] ?? 0) + 1;
      fold1(b.draws, L.draw);
      fold1(b.group0, L.group0);
      L.draw.clear();
      L.group0.clear();
    }
    const cls = classNow();
    if (cls !== L.cls) L.visit = true;
    L.cls = cls;
    L.frames[L.cls] = (L.frames[L.cls] ?? 0) + 1;
    L.frameNo++;
  });
  F.onSubmitted(() => {
    if (L.cls === null) return;
    const c = classOf(L.cls);
    fold1(c.draws, L.draw);
    fold1(c.group0, L.group0);
    L.draw.clear();
    L.group0.clear();
    const n = scene.meshes.length;
    if (!c.meshes.sizes.includes(n)) c.meshes.sizes.push(n);
    // The names are read on a visit's first frame and on every frame the
    // count moved, never on a clock: a sample keyed to the session's frame
    // number lands in a two-frame state or misses it as the machine's pace
    // decides, and the log stops repeating.
    if (L.visit || n !== L.lastSize) {
      const names = {};
      for (const m of scene.meshes) {
        const k = fold(m.name);
        names[k] = (names[k] ?? 0) + 1;
      }
      for (const [k, v] of Object.entries(names)) c.meshes.names[k] = Math.max(c.meshes.names[k] ?? 0, v);
    }
    L.visit = false;
    L.lastSize = n;
    // The game's own counter (the header), its value at this frame's end.
    const bc = g.babylonCompiles;
    if (bc) {
      const seen = (L.counter[L.cls] ??= []);
      if (!seen.includes(bc.count)) seen.push(bc.count);
    }
    if (!L.meshHooked) hookMeshRender();
    const rs = (L.renders[L.cls] ??= []);
    if (!rs.includes(L.renderCalls)) rs.push(L.renderCalls);
    L.renderCalls = 0;
    const bs = (L.begins[L.cls] ??= []);
    if (!bs.includes(L.beginCalls)) bs.push(L.beginCalls);
    L.beginCalls = 0;
  });

  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  const draw = e._draw;
  e._draw = function (...a) {
    const m = L.meshCtx;
    const eff = effName(this._currentEffect);
    const key = m
      ? `${m.getScene() !== scene ? "utility-mesh" : "mesh"}:${fold(m.name)} [${eff}] -> ${targetOf()}`
      : `effect:${eff} -> ${targetOf()}`;
    bump(L.draw, key);
    return draw.apply(this, a);
  };
  // `Mesh.render`, found on the prototype chain of a mesh the scene holds,
  // so a draw inside it is named by its mesh — any `Mesh` serves, since the
  // hook is on the prototype. At boot the menu has none (no map, and since
  // X5.3d no `localShadowProxy`), and since X5.3e a round holds none either
  // (no collider is a mesh), so the hook waits for the first frame that ends
  // with a mesh in the scene, which may never come: a mesh is drawn only once
  // one exists, so nothing is drawn unnamed but in the frame a first mesh was
  // made and drawn in — and a draw with no mesh hooked is still logged, by
  // its effect.
  L.meshHooked = false;
  function hookMeshRender() {
    const anyMesh = scene.meshes[0];
    if (!anyMesh) return;
    L.meshHooked = true;
    let proto = Object.getPrototypeOf(anyMesh);
    while (proto && !Object.prototype.hasOwnProperty.call(proto, "render")) proto = Object.getPrototypeOf(proto);
    const render = proto.render;
    proto.render = function (...a) {
      const keep = L.meshCtx;
      L.meshCtx = this;
      try {
        return render.apply(this, a);
      } finally {
        L.meshCtx = keep;
      }
    };
  }
  hookMeshRender();
  scene.onBeforeRenderingGroupObservable.add((info) => {
    if (info.renderingGroupId === 0) bump(L.group0, targetOf());
  });
  // Effect compiles: a key `createEffect` ADDS to the engine's cache.
  const createEffect = e.createEffect;
  e.createEffect = function (...a) {
    const before = new Set(Object.keys(this._compiledEffects));
    const effect = createEffect.apply(this, a);
    for (const k of Object.keys(this._compiledEffects)) {
      if (before.has(k)) continue;
      const c = classOf(L.cls ?? "boot").compiles;
      const key = effectKey(k);
      c[key] = (c[key] ?? 0) + 1;
    }
    return effect;
  };
  if (typeof e.createComputeEffect === "function") {
    const seen = new WeakSet();
    const createCompute = e.createComputeEffect;
    e.createComputeEffect = function (base, ...a) {
      const effect = createCompute.call(this, base, ...a);
      if (effect && !seen.has(effect)) {
        seen.add(effect);
        const c = classOf(L.cls ?? "boot").computeCompiles;
        const key = typeof base === "string" ? base : base?.computeElement ?? base?.compute ?? `inline:${hash(String(base?.computeSource ?? ""))}`;
        c[key] = (c[key] ?? 0) + 1;
      }
      return effect;
    };
  }
  // What the round DID, counted at its doors (never compared).
  L.did = {};
  for (const [label, owner, key] of [
    ["rounds", g.combatFx, "drawRound"],
    ["throws", g.grenades, "throwAlong"],
    ["blasts", g.grenadeFx, "blast"],
    ["fires", g.grenadeFx, "ignite"],
    ["rubble", g.blastDebris, "burst"],
    ["rockets", g.antiTank, "launch"],
    ["shards", g.debris, "burst"],
    ["kills", g, "onNetKill"],
  ]) {
    const f = owner?.[key];
    if (typeof f !== "function") {
      L.notes.push(`no door ${label}`);
      continue;
    }
    L.did[label] = 0;
    owner[key] = function (...a) {
      L.did[label]++;
      return f.apply(this, a);
    };
  }
}

/** Runs IN THE PAGE: one life, scripted. `n` 1 is the long one (the header). */
async function life(n) {
  const g = window.__celshock;
  const L = window.__drawLog;
  const { PRIMARY_WEAPON_IDS } = await import("/src/entities/weapons.ts");
  const fr = (k) =>
    new Promise((res) => {
      let i = 0;
      const off = window.__refFrame().onDrawn(() => {
        if (++i < k) return;
        off();
        res();
      });
    });
  const seconds = async (t) => {
    const end = performance.now() + t * 1000;
    while (performance.now() < end) await fr(1);
  };
  const until = async (test, limitS) => {
    const end = performance.now() + limitS * 1000;
    while (!test()) {
      if (performance.now() > end) return false;
      await fr(1);
    }
    return true;
  };
  const drive = { fire: false, grenade: false, moveY: 0, sprint: false };
  for (const [k, get] of [
    ["fire", () => drive.fire],
    ["grenadePressed", () => drive.grenade],
    ["pointerLocked", () => true],
    ["moveY", () => drive.moveY],
    ["sprint", () => drive.sprint],
  ]) Object.defineProperty(g.input, k, { get, set: () => {}, configurable: true });
  const log = [];
  const release = () => {
    for (const k of ["fire", "grenadePressed", "pointerLocked", "moveY", "sprint"]) delete g.input[k];
  };
  g.spawnPlayer();
  if (!(await until(() => g.state === "playing" && g.player.alive, 60))) {
    release();
    return { log: ["no spawn"], reached: { spawn: false } };
  }
  const reached = { spawn: true };
  await fr(30);
  if (n !== 1) {
    // The short life: stand and fire, then hand back to the caller's lids.
    for (let i = 0; i < 60; i++) {
      drive.fire = i % 2 === 0;
      await fr(1);
    }
    drive.fire = false;
    release();
    return { log, reached };
  }
  let yaw = 0;
  const sweep = async (k, pitches) => {
    for (let i = 0; i < k; i++) {
      yaw += 0.02;
      g.cameraSys.yaw = yaw;
      g.cameraSys.pitch = pitches[Math.floor(i / 20) % pitches.length];
      drive.fire = i % 2 === 0;
      await fr(1);
    }
    drive.fire = false;
    await seconds(0.3);
  };
  const drawSlot = async (slot) => {
    g.player.drawSlot(slot);
    await until(() => !g.player.swapping, 10);
    await fr(2);
  };
  for (const id of PRIMARY_WEAPON_IDS) {
    if (!g.player.alive) break;
    g.player.setWeapon(id);
    await fr(2);
    await sweep(120, [-0.35, 0.02, -0.12]);
  }
  if (g.player.alive) {
    await drawSlot(0);
    g.cameraSys.pitch = 0.15;
    drive.grenade = true;
    await fr(1);
    drive.grenade = false;
    await seconds(4);
    log.push("threw a grenade");
  }
  if (g.player.alive && g.armourOffered) {
    await drawSlot(2);
    for (let i = 0; i < 2; i++) {
      g.cameraSys.pitch = 0.02;
      drive.fire = true;
      await fr(1);
      drive.fire = false;
      await seconds(3);
    }
    await drawSlot(0);
    log.push("used the third slot");
  }
  // A pane: fired at first (the real door), glass.shoot if no round broke it.
  if (g.player.alive && g.map.panes.length) {
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
    const before = L.did.shards;
    for (let i = 0; i < 60 && L.did.shards === before; i++) {
      g.cameraSys.yaw = Math.atan2(q.cx - eye.x, q.cz - eye.z);
      g.cameraSys.pitch = Math.atan2(q.cy - eye.y, Math.hypot(q.cx - eye.x, q.cz - eye.z));
      drive.fire = i % 2 === 0;
      await fr(1);
    }
    drive.fire = false;
    if (L.did.shards === before) {
      const alongX = q.w >= q.d;
      const nx = alongX ? Math.sin(q.rotY) : Math.cos(q.rotY);
      const nz = alongX ? Math.cos(q.rotY) : -Math.sin(q.rotY);
      for (const s of [1, -1]) {
        const o = new V(q.cx + nx * 2 * s, q.cy, q.cz + nz * 2 * s);
        if (g.glass.shoot(o, new V(-nx * s, 0, -nz * s), 4, false).length) break;
      }
      await seconds(1);
    }
    await seconds(1);
    log.push(`pane ${best} ${L.did.shards > before ? "broken" : "NOT broken"}`);
  }
  // A flying hull pinned on a descent to the ground and back up, the camera on it.
  const hull = g.vehicles.hulls.find((h) => h.flies);
  if (hull && g.player.alive) {
    const x = hull.pos.x + 30;
    const z = hull.pos.z;
    const floor = g.map.terrain.surfaceAt(x, z, true);
    const keepFe = g.followEye;
    let frame = 0;
    const clr = () => (frame < 240 ? 14 - (13.7 * frame) / 240 : frame < 330 ? 0.3 : 0.3 + ((frame - 330) * 14) / 150);
    g.followEye = function (s) {
      hull.pos.set(x, floor + hull.spec.hull.height / 2 + clr(), z);
      hull.flight.rotor = 1;
      g.vehicleViews.update();
      const cam = g.cameraSys.camera;
      cam.position.set(x, floor + 10, z - 35);
      cam.setTarget(new cam.position.constructor(x, floor + 1, z));
      return keepFe.call(this, s);
    };
    for (; frame < 480; frame++) await fr(1);
    g.followEye = keepFe;
    log.push("a flying hull pinned down and back up");
  }
  // Walk at the farthest flag until the authority kills the player.
  if (g.player.alive) {
    const p = g.player.position;
    let far = null;
    for (const cp of g.map.controlPoints) {
      const d = Math.hypot(cp.pos.x - p.x, cp.pos.z - p.z);
      if (!far || d > far.d) far = { cp, d };
    }
    drive.sprint = true;
    drive.moveY = 1;
    await until(() => {
      const q = g.player.position;
      g.cameraSys.yaw = Math.atan2(far.cp.pos.x - q.x, far.cp.pos.z - q.z);
      g.cameraSys.pitch = 0;
      drive.fire = (L.frameNo & 7) === 0;
      return !g.player.alive || g.state === "dying";
    }, window.__drawLogDeathWait);
    drive.sprint = false;
    drive.moveY = 0;
    drive.fire = false;
  }
  reached.dying = g.state === "dying" || !g.player.alive;
  release();
  return { log, reached };
}

/** Runs IN THE PAGE: waits for `state`, at most `limitS` seconds. */
function waitState([state, limitS]) {
  const g = window.__celshock;
  const end = performance.now() + limitS * 1000;
  return new Promise((res) => {
    const poll = () => {
      if (g.state === state) return res(true);
      if (performance.now() > end) return res(false);
      setTimeout(poll, 20);
    };
    poll();
  });
}

const frames = (page, n) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        let k = 0;
        const off = window.__refFrame().onDrawn(() => {
          if (++k < n) return;
          off();
          res();
        });
      }),
    n,
  );

/** Runs IN THE PAGE: flies a raised viewer to a flag and shows what it has. */
async function viewerLook() {
  const g = window.__celshock;
  const v = g.viewer;
  if (!v) return false;
  const fr = (k) =>
    new Promise((res) => {
      let i = 0;
      const off = window.__refFrame().onDrawn(() => {
        if (++i < k) return;
        off();
        res();
      });
    });
  await fr(30);
  const cp = g.map.controlPoints[0];
  v.flyTo(cp.pos.x, g.map.terrain.heightAt(cp.pos.x, cp.pos.z), cp.pos.z);
  v.setNav(true);
  await fr(30);
  v.setWorkLight(false);
  await fr(30);
  v.setWorkLight(true);
  await fr(30);
  return true;
}

async function logMap(browser, url, map) {
  const sep = url.endsWith("/") ? "" : "/";
  const { page, pageErrors, consoleErrors, consoleLines } = await bootMap(browser, `${url}${sep}?seed=${SEED}`, map, {
    hideUI: false,
  });
  page.on("dialog", (d) => void d.accept());
  await page.evaluate(installHooks);
  await page.evaluate((s) => (window.__drawLogDeathWait = s), DEATH_WAIT_S);
  const steps = [];
  const missed = [];
  const need = (ok, what) => {
    steps.push(`${what}: ${ok ? "yes" : "NO"}`);
    if (!ok) missed.push(what);
  };
  const state = () => page.evaluate(() => window.__celshock.state);
  // The viewer's lid over `under`, raised and lowered as `F2` does it.
  const viewerOver = async (under) => {
    if (!VIEWER) return;
    await page.evaluate(() => window.__celshock.toggleViewer());
    need((await state()) === "viewer", `F2, the viewer over ${under}`);
    need(await page.evaluate(viewerLook), `the viewer flown and its plan shown over ${under}`);
    await page.evaluate(() => window.__celshock.toggleViewer());
    need((await state()) === under, `the viewer lowered back to ${under}`);
    await frames(page, 30);
  };

  await frames(page, 60); // the menu at boot
  await installRound(page);
  need((await state()) === "deploy", "round 1 to deploy");
  await frames(page, 60);
  await page.evaluate(() => window.__celshock.openLoadout());
  need((await state()) === "loadout", "the kit lid over deploy");
  await frames(page, 60);
  await page.evaluate(() => window.__celshock.closeLoadout());
  need((await state()) === "deploy", "the kit lid lowered");
  await frames(page, 30);
  await viewerOver("deploy");
  let l = await page.evaluate(life, 1);
  steps.push(`life 1: ${l.log.join("; ")}`);
  need(l.reached.spawn, "life 1 spawned");
  need(l.reached.dying, "life 1 killed (the death cam)");
  if ((await state()) === "dying") await viewerOver("dying");
  else if (VIEWER) need(false, "the death cam still up for the viewer");
  need(await page.evaluate(waitState, ["deploy", 60]), "deploy after the death cam");
  await frames(page, 60);
  l = await page.evaluate(life, 2);
  need(l.reached.spawn, "life 2 spawned");
  await viewerOver("playing");
  await page.evaluate(() => window.__celshock.pause());
  need((await state()) === "paused", "the pause lid over playing");
  await frames(page, 60);
  await page.evaluate(() => window.__celshock.resume());
  need((await state()) === "playing", "the pause lid lowered");
  await frames(page, 60);
  await page.evaluate(() => window.__celshock.endRound(0));
  need((await state()) === "roundover", "the round-over card");
  await frames(page, 120);
  await page.evaluate(() => window.__celshock.enterMenu());
  need((await state()) === "menu", "the menu");
  await frames(page, 90);
  await installRound(page);
  need((await state()) === "deploy", "round 2 to deploy");
  l = await page.evaluate(life, 2);
  need(l.reached.spawn, "round 2 spawned");
  await frames(page, 240);
  await page.evaluate(() => window.__celshock.enterMenu());
  need((await state()) === "menu", "the menu again");
  await frames(page, 60);
  const rec = await page.evaluate(() => {
    const L = window.__drawLog;
    const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const keyed = (bucket, frames) =>
      sortObj(
        Object.fromEntries(
          Object.entries(bucket).map(([k, r]) => [k, { counts: [...r.counts].sort((a, b) => a - b), always: r.frames === frames }]),
        ),
      );
    const classes = {};
    for (const [c, v] of Object.entries(L.classes)) {
      const n = L.frames[c] ?? 0;
      classes[c] = {
        draws: keyed(v.draws, n),
        group0: keyed(v.group0, n),
        compiles: sortObj(v.compiles),
        computeCompiles: sortObj(v.computeCompiles),
        meshes: { sizes: [...v.meshes.sizes].sort((a, b) => a - b), names: sortObj(v.meshes.names) },
      };
    }
    const bc = window.__celshock.babylonCompiles;
    return {
      renders: sortObj(Object.fromEntries(Object.entries(L.renders).map(([c, v]) => [c, [...v].sort((a, b) => a - b)]))),
      ours: Boolean(window.__celshock.sceneFrame),
      begins: sortObj(Object.fromEntries(Object.entries(L.begins).map(([c, v]) => [c, [...v].sort((a, b) => a - b)]))),
      loop: Boolean(window.__celshock.frameLoop),
      resizeBegins: L.resizeBegins,
      classes: sortObj(classes),
      compiledAtBoot: L.compiledAtBoot,
      babylonCompiles: bc ? { byClass: sortObj(Object.fromEntries(Object.entries(L.counter).map(([c, v]) => [c, [...v].sort((a, b) => a - b)]))), count: bc.count, names: [...bc.names] } : null,
      frames: L.frames,
      did: L.did,
      notes: L.notes,
    };
  });
  const warns = consoleLines.filter((x) => /\[pipelines\]/.test(x));
  await page.close();
  return {
    map,
    seed: SEED,
    classes: rec.classes,
    compiledAtBoot: rec.compiledAtBoot,
    babylonCompiles: rec.babylonCompiles,
    renders: { byClass: rec.renders, ours: rec.ours },
    begins: { byClass: rec.begins, ours: rec.loop, resize: rec.resizeBegins },
    info: { frames: rec.frames, did: rec.did, notes: rec.notes, steps, missed },
    errors: { page: pageErrors, console: consoleErrors, pipelines: warns },
  };
}

/** Every path at which two logs differ, `<map>/<class>/<field>/<key>`, with what moved. */
function differences(before, after) {
  const out = [];
  const walk = (path, a, b) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const plain = (x) => x && typeof x === "object" && !Array.isArray(x);
    if (plain(a) && plain(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(`${path}/${k}`, a[k], b[k]);
      return;
    }
    out.push({ path, text: `${path}: ${JSON.stringify(a) ?? "(absent)"} -> ${JSON.stringify(b) ?? "(absent)"}` });
  };
  for (const map of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!before[map] || !after[map]) {
      out.push({ path: map, text: `${map}: logged on one side only` });
      continue;
    }
    walk(`${map}/compiledAtBoot`, before[map].compiledAtBoot, after[map].compiledAtBoot);
    walk(map, before[map].classes, after[map].classes);
  }
  return out;
}

function report(r) {
  console.log(`\n${r.map} (seed ${r.seed})`);
  for (const s of r.info.steps) console.log(`  ${s}`);
  console.log(`  did: ${JSON.stringify(r.info.did)}${r.info.notes.length ? `  notes: ${r.info.notes.join("; ")}` : ""}`);
  console.log(`  frames by class: ${JSON.stringify(r.info.frames)}`);
  console.log(`  Babylon effects compiled before the probe hooked the engine: ${r.compiledAtBoot.length} (${r.compiledAtBoot.join(", ")})`);
  const bc = r.babylonCompiles;
  console.log(
    bc
      ? `  the game's counter of Babylon effect compiles: ${bc.count}${bc.names.length ? ` (${bc.names.join(", ")})` : ""}; by class ${JSON.stringify(bc.byClass)}`
      : "  the game's counter of Babylon effect compiles: none in this tree (before BABYLON_EXIT.md X5.3d)",
  );
  console.log(`  scene.render calls a frame, by class (${r.renders.ours ? "our frame" : "Babylon's render"}): ${JSON.stringify(r.renders.byClass)}`);
  if (r.begins) console.log(`  engine.beginFrame calls a frame outside a resize, by class (${r.begins.ours ? "our loop" : "Babylon's loop"}): ${JSON.stringify(r.begins.byClass)}; inside a resize ${r.begins.resize}`);
  for (const [cls, c] of Object.entries(r.classes)) {
    const draws = Object.entries(c.draws);
    const meshKeys = draws.filter(([k]) => k.includes("mesh:"));
    const effectKeys = draws.filter(([k]) => !k.includes("mesh:"));
    console.log(`\n  [${cls}] ${r.info.frames[cls] ?? 0} frames`);
    console.log(`    Babylon draws: ${draws.length ? `${effectKeys.length} effect keys, ${meshKeys.length} mesh keys` : "none"}`);
    for (const [k, v] of effectKeys) console.log(`      ${k}  x${v.counts.join("/")} a frame${v.always ? "" : " (not every frame)"}`);
    for (const [k, v] of meshKeys.slice(0, 12)) console.log(`      ${k}  x${v.counts.join("/")} a frame${v.always ? "" : " (not every frame)"}`);
    if (meshKeys.length > 12) console.log(`      ...and ${meshKeys.length - 12} more mesh keys`);
    const visits = Object.entries(c.group0);
    console.log(`    group 0 visits: ${visits.length ? visits.map(([t, v]) => `${t} x${v.counts.join("/")}`).join(", ") : "none"}`);
    const compiles = Object.entries(c.compiles);
    const compute = Object.entries(c.computeCompiles);
    console.log(`    Babylon effect compiles: ${compiles.length ? compiles.reduce((s, [, n]) => s + n, 0) : 0}${compute.length ? `; compute ${compute.length}` : ""}`);
    for (const [k, n] of compiles.slice(0, 8)) console.log(`      ${k}${n > 1 ? ` x${n}` : ""}`);
    if (compiles.length > 8) console.log(`      ...and ${compiles.length - 8} more`);
    console.log(`    scene.meshes: ${c.meshes.sizes.join(", ")} (${Object.keys(c.meshes.names).length} folded names)`);
  }
  const e = r.errors;
  console.log(`\n  ${e.page.length} page errors, ${e.console.length} console errors, ${e.pipelines.length} [pipelines] lines`, [...e.page, ...e.console, ...e.pipelines].slice(0, 6));
}

const vite = await startDevServer(root);
const browser = await launchClient({ headed: false });
const result = {};
let incomplete = false;
for (const map of MAPS) {
  result[map] = await logMap(browser, vite.url, map);
  report(result[map]);
  if (result[map].info.missed.length) incomplete = true;
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log(`\nwrote ${OUT}`);
}
let code = 0;
// No class may visit group 0: `onMainPass` assumes it (the header).
const visited = Object.values(result).flatMap((r) =>
  Object.entries(r.classes)
    .filter(([, c]) => Object.keys(c.group0).length > 0)
    .map(([cls, c]) => `${r.map}/${cls} (${Object.keys(c.group0).join(", ")})`),
);
if (visited.length) {
  console.log(`\nGROUP 0 VISITED: Babylon visited rendering group 0, which the seam's onMainPass assumes it never does, on ${visited.join("; ")}`);
  code = 1;
}
// The game's counter must read 0 in every class (the header).
const counted = Object.values(result).filter((r) => r.babylonCompiles && (r.babylonCompiles.count !== 0 || Object.values(r.babylonCompiles.byClass).some((v) => v.some((n) => n !== 0))));
if (counted.length) {
  console.log(`\nBABYLON COMPILED: the game's counter is not 0 on ${counted.map((r) => `${r.map} (${r.babylonCompiles.count}: ${r.babylonCompiles.names.join(", ")})`).join("; ")}`);
  code = 1;
}
// With our frame (X5.4f), no class may render the scene (the header).
const rendered = Object.values(result).filter((r) => r.renders.ours && Object.values(r.renders.byClass).some((v) => v.some((n) => n !== 0)));
if (rendered.length) {
  console.log(`
SCENE RENDERED: scene.render was called under our frame on ${rendered.map((r) => `${r.map} (${JSON.stringify(r.renders.byClass)})`).join("; ")}`);
  code = 1;
}
// With our loop (X5.4g), no class may see Babylon's beginFrame outside a resize (the header).
const begun = Object.values(result).filter((r) => r.begins?.ours && Object.values(r.begins.byClass).some((v) => v.some((n) => n !== 0)));
if (begun.length) {
  console.log(`\nBABYLON BEGAN A FRAME: engine.beginFrame was called outside a resize under our loop on ${begun.map((r) => `${r.map} (${JSON.stringify(r.begins.byClass)})`).join("; ")}`);
  code = 1;
}
if (incomplete) {
  console.log(`\nINCOMPLETE: a step was not reached (${Object.values(result).flatMap((r) => r.info.missed).join("; ")})`);
  code = 2;
}
if (AGAINST) {
  const before = JSON.parse(readFileSync(AGAINST, "utf8"));
  const subset = Object.fromEntries(Object.keys(result).map((m) => [m, before[m]]));
  const all = differences(subset, result);
  const shown = all.filter((d) => !(IGNORE && IGNORE.test(d.path)));
  if (shown.length === 0) {
    console.log(`\nequal to ${AGAINST} on ${MAPS.join(", ")}${all.length ? ` (${all.length} ignored by --ignore)` : ""}`);
  } else {
    console.log(`\n${shown.length} differences against ${AGAINST}${all.length > shown.length ? ` (${all.length - shown.length} more ignored)` : ""}:`);
    for (const d of shown.slice(0, 60)) console.log(`  ${d.text}`);
    if (shown.length > 60) console.log(`  ...and ${shown.length - 60} more`);
    code = code || 1;
  }
}
process.exit(code);
