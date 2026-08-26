# VERIFYING.md

How to drive this game from a headless browser, and the quirks that have already
cost time doing it. Split out of [`CLAUDE.md`](CLAUDE.md), which with the
subsystem contracts under [`docs/`](docs/) is still the source of truth for
architecture and invariants — read this when you are writing a smoke test, not
when you are reasoning about a change.

Playwright + Chromium are devDeps for ad-hoc smoke tests; write throwaway scripts
to the scratchpad, not the repo. `Game`'s constructor exposes `window.__celshock`
(`g` below).

**READ THIS FIRST, because the game runs on WebGPU and WHICH MACHINE you are
on decides more than any flag does.** There are two dev machines, they fail in
opposite directions, and a rule measured on one of them is wrong on the other
often enough that they are written down separately below. Establish which one
you are on before you believe anything else in this section.

| | Windows box | Chromebook (Crostini) |
| --- | --- | --- |
| WebGPU adapter | `nvidia/lovelace`, 21 features | `google/swiftshader`, CPU |
| headless presents a canvas | **yes**, via `channel: "chromium"` | **no**, one frame then device loss |
| `--enable-unsafe-webgpu` | no-op | **required**, and its absence is invisible |
| Coldharbour's 40-probe bake | 138 ms, one frame | takes the device |
| a round | 46–176 fps | ~0.5–2 fps |
| the one-second check | — | `ls /dev/dri` |

**What is true on both machines**, and is the part worth learning once:

- **`navigator.gpu` is a SECURE-CONTEXT property, so probe on a real origin.**
  On `about:blank` it is `undefined` and every check downstream reads as "no
  WebGPU here". `http://localhost` and `http://127.0.0.1` both count as secure;
  serve a blank page off a `node:http` server rather than testing on
  `about:blank`.
- **A machine that cannot hand out an adapter is indistinguishable from a
  browser that has never heard of WebGPU**, and that is the shape of nearly
  every failure here. `main.ts`'s boot gate refuses, `Game` is never
  constructed, and the script fails as `waitForFunction` timing out on
  `window.__celshock` — which says nothing about why. `scripts/browser.mjs`
  exists to get this right once; go there before you suspect the game.
- **`scripts/browser.mjs` and `scripts/dev-server.mjs` are the only places a
  launch flag or a server spawn is written**, and the harness under
  `plans/webgpu-ref/` imports both rather than copying either.

### On the Windows box, which is the one with a GPU

- **The BINARY decides whether headless works, and the flag does not.**
  Measured across all four combinations of headless/headed and flag/no-flag: an
  adapter comes back in every one of them that runs the full browser binary,
  and in none that runs Playwright's default `chromium_headless_shell`. That
  shell carries no GPU stack here at all — `requestAdapter()` returns null with
  `--enable-unsafe-webgpu`, without it, and under every ANGLE override tried.
  `channel: "chromium"` is what asks for the full binary, and with it headless
  presents perfectly well: 240 swap-chain frames, no device loss. So the flag
  is dead weight on this machine and the channel is the whole game, which is
  the exact inverse of the Chromebook below.
- **`--use-angle=d3d11` is a trap.** It gets an adapter and then fails
  `requestDevice` with `DynamicLib.Open: dxil.dll Windows Error: 87`. No ANGLE
  override is needed or wanted here.
- **The first seconds of a round are the COMPILER, not the game.** WebGPU
  compiles pipelines lazily. Measured on Coldharbour: 42 shader modules and 25
  render pipelines are created in the first second after the player spawns,
  that second runs at 9 fps, the second at 34, and by the third the round is
  flat at ~48 and creates nothing more. A single figure taken over the first
  five seconds is neither number and is what made a healthy Coldharbour read as
  16 fps against Hollowmere's 103 — a gap FINDINGS #12 puts at about 25%.
  **Warm up for ten seconds before quoting a frame rate**, or use
  `plans/webgpu-ref/gate.mjs`, which reports cold and warm as a pair. The cost
  does not show up in the call it comes from: summed over a whole round,
  `createRenderPipeline` accounts for 0.6 ms, because Dawn compiles behind the
  call and the stall lands on first use.
- **Chromium caps the render loop unless you take the limiter off.** Without
  `--disable-frame-rate-limit --disable-gpu-vsync` Hollowmere reads 103 fps
  because that is the ceiling rather than the cost; with them, 132–176. Say
  which you measured.
- **A map DRAWS when `scene.isReady()` says so, and a frame count is not a
  substitute.** Until the pipelines exist the canvas presents nothing, and the
  frame that first changes is not a constant — across runs it moved between 67
  and 137 on Hollowmere and between 3 and 35 on Greyfen. `scene.isReady()`
  flipped on exactly the frame each map first drew, on all four maps, every
  time. This is not academic: `capture-map-shots.mjs` settled six frames, which
  was three wall-clock seconds on the Chromebook and 45 ms here, and running
  `npm run shots` would have overwritten Hollowmere's and Harrowmead's
  committed backdrops with blank frames.
- **Do NOT read pixels back off the canvas; screenshot the page.** A
  `drawImage` readback of the WebGPU canvas comes back fully transparent on
  Hollowmere — alpha 0, every channel 0 — while `page.screenshot()` of the same
  frame is 3.3 MB of chapel. A readback that returns black is not a frame that
  is black, and it fails in the worst direction: a diff of two black images
  passes.
- **Headed and headless frames are not byte-identical**, on three of the four
  maps. Both are correct. A reference bank must be taken and checked in the
  same mode; `plans/webgpu-ref/bank.mjs` records the mode and refuses a
  mismatch.
- **Coldharbour's shipped forty-probe bake is fine here** — 138 ms in the one
  frame after install, all forty probes, no device loss — and the probes are
  refresh-once, so they are a build cost and never a frame cost. The staggered
  workaround the Chromebook needed has been deleted rather than kept.

### On the Chromebook, which is a Crostini box with no GPU for WebGPU

- **Launch with `--enable-unsafe-webgpu`.** Without it `navigator.gpu` is there
  and `requestAdapter()` returns null — which is the shape of "this browser has
  no WebGPU", so a script with no flag reports a boot-gate failure that is its
  own doing. No other flag is needed: the DEFAULT `chromium_headless_shell`
  carries Dawn's SwiftShader backend, and `channel: "chromium"` buys nothing.
  `--use-angle=swiftshader`, `--use-webgpu-adapter=swiftshader`,
  `--enable-features=Vulkan` and `--enable-unsafe-swiftshader` were each tried
  and changed nothing either way.
- **Anything with a PICTURE in it must run `headless: false`, and on this
  Chromebook that is not a preference — headless cannot present a WebGPU canvas
  at all.** In headless, `getContext("webgpu")` and `configure()` both succeed
  and then the FIRST `getCurrentTexture()` destroys the device: `device.lost`
  resolves `reason: "destroyed"`, Babylon reports "WebGPU context lost", tries
  to restore, and dies with "Could not retrieve a WebGPU adapter". Measured
  across seven flag sets, both browser binaries and all three canvas kinds
  (DOM, detached `OffscreenCanvas`, `transferControlToOffscreen`): **one frame,
  every time.** Headed on `:0` runs indefinitely — 1275 frames of the real game
  at 59 fps — and `page.screenshot()` captures the canvas correctly. Offscreen
  rendering into a `device.createTexture()` colour attachment survives in both,
  so the broken piece is the swap chain in headless specifically.
  - **This is a Crostini box and the GPU is a SETTING.** With Linux GPU support
    off there is no `/dev/dri` at all and even headed dies at frame 2. With it
    on, `/dev/dri/card0` and `renderD128` appear and headed works.
    **`ls /dev/dri` is the one-second check**, and it is the first thing to run
    when a visual script that used to work stops working — the toggle does not
    survive every ChromeOS event.
  - **WebGL2 gets the real GPU and WebGPU does not, and that is not fixable
    here — do not spend the hour again.** WebGL2 reports
    `ANGLE (Mesa/X.org, virgl (Mesa Intel(R) Graphics (MTL)))`; WebGPU's
    adapter reports `google/swiftshader`. Crostini passes through GL (virgl);
    Dawn wants Vulkan, and the Vulkan side needs Venus —
    `libvulkan_virtio.so` + `virtio_icd.x86_64.json` — which Debian 12's mesa
    22.3.6 does not build, no backports is configured, and the ChromeOS feed
    (`cros-packages`) ships no mesa at all. `vulkaninfo --summary` confirms it:
    **one device, `llvmpipe`, `PHYSICAL_DEVICE_TYPE_CPU`.** Two traps in that
    investigation: `vkcube` renders a flawless cube ON THE CPU and reads as a
    pass, and `usermod -aG render` is a no-op because `/dev/dri/renderD128` is
    already mode 666. So **every WebGPU frame here is CPU-rendered — correct,
    and slow.** A round runs at ~16 fps, not 59. Never quote a frame time
    measured here; `FINDINGS.md` numbers need real hardware. Correctness, which
    is what parity diffs are, is unaffected.
  - **And "slow" has a cliff in it: COLDHARBOUR'S REFLECTION BAKE KILLS THE
    DEVICE, headed and with the GPU toggle on.** Forty cube probes is 240 face
    renders over 488 meshes, and the CPU rasteriser does not finish that frame
    before Chromium's watchdog takes the device: `copyExternalImageToTexture`
    fails, "WebGPU context lost" follows, and the round never draws a pixel.
    What it looks like is a WebGPU port bug and it is not one — the same map on
    the same machine bakes all forty probes in ONE frame on WebGL2 and runs at
    ~32 fps, because WebGL2 gets the real GPU and WebGPU gets SwiftShader. **On
    the Windows box the same bake is 138 ms and needs nothing done to it**, so
    what follows is a workaround for this machine and not a property of the
    game. **Three ways round it, and which you want depends on the question**:
    `g.reflections.build = () => {}` before `startRound` gives a Coldharbour
    that renders (99% of pixels lit, everything but the glazing correct), and
    truncating `map.paneGroups` inside a wrapper round `build` keeps a few
    probes so the mirrors are still testable. **The third keeps all forty, and
    it is the one to reach for**: the frame is the problem and the bake is not,
    so PARK the cube targets and release them a few at a time.
    - `build` sets every probe's render list and calls `resetRefreshCounter`,
      and `newProbe` has already pushed each `cubeTexture` into
      `scene.customRenderTargets` — which is the only thing that renders them.
      Filter them back out of that array inside a wrapper round `build`, then
      push four back, wait one `onAfterRenderObservable`, and filter those four
      out again. Measured: **ten frames at ~10 s a batch bakes all forty, no
      device loss, and the round then draws at 99% lit** with the city in its
      glass.
    - **Wait for the round to be UP and every `ShaderMaterial` ready before
      releasing the first batch.** A render target whose meshes are not ready
      renders EMPTY and is still marked rendered, so a version of this that
      pumps from `onBeforeRenderObservable` starting on the install frame hands
      back its first eight probes blank — and blank probes read as a Y-flip
      regression that is not there (coverage 0.586, face 2 at 0.800), because
      every mean is over forty probes of which eight are zero.
    - **It proves the probe PATH and not the shipped bake.** The game still
      queues all forty on one frame; only a GPU can finish that. **Anything
      that needs the one-frame bake itself needs real hardware.**

    Hollowmere, Greyfen and Harrowmead are unaffected — Hollowmere has no
    glazed block at all.
  - **Headless still runs the whole of the DOM and the whole of the
    simulation** — the boot path, `__celshock`, state transitions, the screens,
    rules, damage arithmetic, nav — none of which needs a presented frame, and
    it is much faster to start. Use it for those. It gets two frames in before
    the device goes, so `scene.getFrameId()` stops at 2 and `engine.getFps()`
    reads ~3 forever; do not read either as a stall.

- **The engine fetches glslang and twgsl from `cdn.babylonjs.com`, so match
  `**/*.babylonjs.com/**` and never a hostname from memory.** Four files —
  `v9.19.1/glslang/glslang.{js,wasm}` and `v9.19.1/twgsl/twgsl.{js,wasm}` —
  pulled the first time a GLSL shader reaches the backend, which is what every
  shader still is until the WGSL port finishes. **This has already produced a
  false PASS**: a gate asserting "no CDN fetch during boot" against
  `preview.babylonjs.com` passed while watching a host that is never contacted.
  Two further traps in the same check — booting only to the menu compiles no
  shader and therefore fetches nothing, and a route filter proves only what was
  *requested*, so the real invariant is `engine._glslang === undefined &&
  engine._tintWASM === undefined` after a sweep that actually drew every map.

Quirks that have already cost time. **Most of them are the SLOW machine's**,
because a script that is wrong about time is only wrong where time is scarce.
Everything below phrased as "at 2 fps", "at 0.1 fps" or "a couple of frames a
second" is the CHROMEBOOK and is not a claim about the Windows box, where the
frame rate usually makes the problem disappear rather than change shape. The
advice is still the right advice on both — stepping a system directly is a
better test than waiting for it wherever you are — it is only the urgency that
is one machine's:

- **On the Chromebook**, headless SwiftShader runs at ~2 fps and `dt` is clamped
  to 0.05, so **game time runs at ~25% of wall clock**. Don't wait for bots to cross a map (240 m, or
  Coldharbour's 320) — force a
  skirmish by overriding `battle.spawnPointFor`, or drive rules directly with
  `conquest.update(1/60, fakeCombatants)` in a loop.
- **`window.__celshock` now appears TWO awaits later than it used to.**
  `main.ts` awaits an adapter and a device (`hasWebGPU`, then
  `new WebGPUEngine(...)` + `initAsync()`) and then `loadHavok()` before
  constructing `Game`, so a script that polls for the handle is waiting on a GPU
  device and a ~2 MB physics binary as well as on the bundle — give
  `waitForFunction` a generous timeout and do not read the absence of the handle
  as a construction failure. The upside is unchanged and is the whole point of
  keeping the constructor synchronous: `g.engine`, `g.physics.plugin` and both
  pools are non-null on the FIRST evaluate, so nothing has to wait for anything
  separately. To exercise the failure branch, `page.route("**/*.wasm", r
  => r.abort())` before `goto` and assert on `#boot.failed`'s message; the game
  is never constructed, so there is no handle at all on that path.
- **`page.screenshot()` waits for the load event, so it cannot photograph the
  boot screen.** Hold the entry chunk back with `page.route` and the shot comes
  back showing the menu, taken seconds later once the hold expired — the DOM
  assertions in the same script are correct and the picture disagrees with all
  of them. `Page.captureScreenshot` over a raw CDP session grabs the frame as it
  stands.
- **To photograph the SCENE, hide `#hud` and screenshot the PAGE.** An element
  screenshot of the canvas is not the canvas — it is the page clipped to that
  box, so every screen standing over it is in the shot; and
  `locator.screenshot()` waits for the element to be *stable* across two frames,
  which at a couple of frames a second times out before the game has drawn
  anything. `page.addStyleTag({ content: "#hud{display:none!important}" })` plus
  `page.screenshot()` is what `scripts/capture-map-shots.mjs` does, and it is the
  recipe for any "what does this map look like" question.
- **A CSS transition's computed value lags the class by SECONDS here, so assert
  the class.** At ~5 fps a 0.4 s opacity fade still reads `opacity: 0` with its
  animation `playState: "running"` a full second after the class went on, and
  settles somewhere before three. The menu backdrop's cross-fade is the worked
  example: `classList.contains("on")` and the layer's `style.backgroundImage` are
  the facts, `getComputedStyle(...).opacity` is a frame-rate reading dressed up
  as one. The same slowness makes a menu key press need a LONG hold — and a hold
  of much over a second steps the row TWICE, because `stepNav`'s repeat has come
  round.
- **A DOM assertion cannot prove a PAINT, and anything that covers a freeze
  needs the second one.** The building card was once booked one
  `requestAnimationFrame` ahead of the build instead of two, which is early
  enough to be in the DOM and too early to be on the glass — every markup check
  passed while the player still watched the old screen freeze. What catches it
  is a CDP screencast (`Page.startScreencast`, ack each `Page.screencastFrame`)
  taken across the stall: with the main thread blocked, whatever frame is being
  held IS what the player sees. Use node-side receipt time to find the stall;
  `metadata.timestamp` is not a Unix epoch and will not line up with
  `Date.now()`. The cheaper standing check is to no-op the blocking call and
  screenshot the moment before it would have run.
- **To prove something still MOVES under a block, count distinct frames — and
  hide everything else that animates first.** Replace the blocking call with a
  spin of a known length, screencast across it, and compare frame payloads:
  anything that differs moved without the main thread. Hide the other animated
  elements with an injected `visibility: hidden` before triggering, or the
  pulsing prompt keeps every frame distinct on its own and the test passes
  whatever the thing under test does. Frames sampled at the very edges of the
  block can come from the teardown either side of it and show the card
  half-dismantled; take the middle 80% and let PNG payload size stand in for
  "did this frame contain the bright thing" across the lot.
- **A tank is easiest to test by stepping the fleet directly, and the camera is
  the trap.** `g.vehicles.tanks` is the fleet, `g.mount(tank)` takes the seat and
  `g.vehicles.update(dt, g.vehicleOrders)` is the real drive path with no
  rendering in it — sixty calls at `1/20` is three seconds of driving in one
  synchronous `evaluate`, which is the only way to move a vehicle at 0.1 fps.
  **The signature takes a LOOKUP rather than a hull and a stick**, because a bot
  crew can be driving one hull while the player drives another: write the sticks
  into `g.drive` for the hull `g.driving` points at, and everything else is
  answered by `g.crew`. Two things that have already cost time: **do not read `speed` after
  a phase with the throttle at zero** (the brake is 9 m/s², so a second of
  turning takes 11 down to 2 and it looks like a stall that is not there), and
  **do not call `spawnPlayer()` if you are placing the camera by hand** —
  `playing` runs `updateCameraAndLighting`, which puts the eye back in the
  player's head every frame and points your carefully aimed shot at the rim.
  Photograph a vehicle from `deploy`, exactly as `capture-map-shots.mjs` does.
- **The TRACKS are read off the rig, not off a screenshot.** At 2 fps two
  photographs of a moving strip prove nothing about which way it went;
  `tank.rig.tracks[i]` is `{lower, upper, sprocket}` per side, and the three
  numbers that settle it are `lower.position.z` (in `(-LINK_PITCH, 0]`),
  `upper.position.z` (its mirror) and `sprocket.rotation.x`. Drive a straight
  run and the two sprockets step together; drive `steer: 1` at `throttle: 0`
  and their deltas are equal and opposite — a track runs
  `turnRate * TRACK_GAUGE / 2` (1.179 m/s on the shipped numbers) and the
  sprocket turns that over `END_R`, so half a second of pivot is 1.179 rad
  each way. **Take that delta modulo 2 pi before believing it**: the angle is
  wrapped, so a track running backwards reads as a large positive step (5.104
  is -1.179) rather than as a negative one.
- **The ANTI-TANK kit is easiest to drive through `g.antiTank`, and the trap is
  the SAME world-matrix one the fleet has.** `g.antiTank.launch(from, dir, team,
  by)` and `g.antiTank.place(at, team, by)` are the real entry points, and
  `g.antiTank.update(1/60)` in a `while (rockets.some(r => r.live))` loop flies a
  rocket home inside one synchronous `evaluate`. But a rocket's step ray is a
  `pickWithRay` against the hull's collider, and that collider's absolute
  position is `(0,0,0)` until something computes its world matrix — so the FIRST
  script run after a build reports a rocket flying straight through a tank and
  every run after it reports a hit. Check `tank.body.getAbsolutePosition()` before
  believing a miss, or drive a frame first. Measured on Coldharbour once the
  matrix is current: 1200 → 580 on a clean strike, which is `damage` exactly and
  no splash — `blastAt` needs line of sight to the hull's centre and the hull is
  in the way.
- **A BOT CREW is stepped with `g.crew.update(dt)` immediately before the
  fleet**, in that order and never the other way round — it writes the drive
  input `vehicles.update` then consumes, exactly as `updateDriver` writes the
  player's. Four things that have already cost time:
  - **Boarding is on its own 1.5 s clock** (`crew.boardDelay`), so a script that
    spawns a bot beside a hardstanding and steps two frames sees nothing. Step
    ~2 s of game time, or read `g.crew.crews.length` rather than asserting on
    the first tick. The bot has to be ALIVE, of its hull's own team, within
    `crew.boardRadius` and not `g.battle.aside(...)` — and `seatPlayer` has
    already benched the lowest slot on the player's side, so picking
    `bots.find(b => b.team === 0)` hands you a benched body that can never crew.
  - **A driver steers on `Bot.objective`, which is a squad ORDER and is empty
    until `battle.update` has planned one.** A crew with no objective holds
    station and fights, which is correct and looks exactly like a driver that is
    broken. Set `bot.objective = g.conquest.points[i].def.id` by hand (it is
    `def.id`, not `id`) or step `battle.update` for a second first.
  - **Ask line of sight through the crew's own door, not `battle.losBetween`.** A
    hull's cupola sits five centimetres above the top of its own collider, so
    every sightline to anything shorter dives back into the box: the raw call
    reports no visibility in any direction and looks like a broken map.
    `g.crew.ctx.visibleFrom(tank, point)` is the one that takes the hull out of
    the pick.
  - `g.crew.clearAlong(tank, yaw)` and `g.crew.pickBearing(tank, wantYaw)` are
    the whiskers, and sweeping 24 bearings through the first is the fastest way
    to see what a stuck driver thinks the world looks like. A hull with the
    throttle at 1.0 and `travel` near zero is `moveWithCollisions` refusing —
    which means the whiskers said clear and were wrong, and the sweep is where
    that shows.
- **A NETPLAY tank is driven the same way, and three things about the harness
  bite before the feature does.** Point the page at `?mp=ws://host:port/ws`, set
  `localStorage["greywatch.map"]` in an `addInitScript` (the map a match is
  created on is the one the JOINING client asks for, and there is no URL
  parameter for it), and deploy with `g.net.sendDeploy(i)` where `i` indexes
  `g.map.spawns` — the deploy screen's own list is derived and is not that
  index. Then:
  - **`g.mount()` is not the way in.** In a match the seat is an ask:
    `g.net.sendMount(hullIndex)` and then `waitForFunction(() => !!g.driving)`.
    The authority refuses it unless the body IT holds is inside `enterRadius`,
    so the player has to genuinely walk there.
  - **Walking there fights the movement validator, and the frame rate is what
    makes it fight.** `placeAt` in a loop is fine at ~3 m a step, but at 2 fps a
    loop with a 100 ms wait runs several steps between frames — the uploads
    then carry the whole jump, get refused, and the player is snapped back with
    nothing on screen to say why. Wait ~500 ms per step, or accept that the
    walk never arrives.
  - **Sixty synchronous `vehicles.update` calls will be REFUSED.** The
    offline recipe above drives three seconds inside one `evaluate`; a netplay
    driver reporting that jump has covered 19 m since its last accepted sample
    and `validateDrive` allows about 7. Drive in bursts of ~4 steps with a frame
    in between, which is what a real driver's reports look like.
  - **After a dismount, `g.net.vehicles.stateFor(i)` is the authority's own copy
    of the hull** — the client's samples for a hull it was driving are skipped
    while it drives it, so this is the only way to see whether the drive was
    accepted at all. Agreement to within a metre is a pass; a hull still sitting
    where it started means every report was refused.
- **A remote hull's derived `speed` is a frame-rate reading and is CLAMPED.**
  `Tank.updateRemote` measures speed from the ground covered over a clamped
  `dt`, so at 2 fps the interpolator's catch-up divides out at 80 m/s. It is
  bounded to the hull's own top speed, which means a headless run reads exactly
  `drive.maxSpeed` while driving — treat that as "moving", not as a measurement.
- **A stepped mine has to be told the hull moved.** The trigger is
  `hullNear(at, contactRadius, team)`, which reads `tank.center`; teleporting a
  hull by writing `.x` moves the centre and the collider agrees only at the next
  render, which is fine for the mine (no ray) and not for anything else in the
  same script.
- **`Player.tryShot` refuses in `deploy` for a reason that looks like a bug.**
  `drawSlot` starts a swap and only `Player.update` lands it, so a script that
  calls `drawSlot(2)` then `completeSwap()` still has `swapping` true and every
  trigger pull returns false. Set `swapT = -1` and `swapPending = false` by hand
  after `completeSwap`, and clear `fireCooldown`/`triggerHeld` between shots —
  the AT items are semi-automatic, so a held trigger is refused on purpose.
- **A bot's launcher is a per-tick CHANCE, so call `considerRocket` in a loop.**
  `bot.rocketT = 0` before each call or the cooldown eats the run;
  `bot.target = tank` is what the decision is about, and it will never fire at a
  body however long the loop runs — that is the rule, not a flaky test.
- **The ANTENNAE are read off the rig too, and the number you want is the SUM of
  two nodes.** `tank.rig.antennae[i]` is `{base, tip}`, and the tip's rotation is
  LOCAL — the mast's actual angle is `base.rotation.x + tip.rotation.x` (and the
  same in `z`), so reading either alone reports a bend that is not there. Two
  more things that have already cost time: the terms are in the TURRET's frame,
  so a script that has been steering for a while is reading a hull rock in `z`
  rather than in `x` and has found nothing wrong; and **the whips answer to a
  shot in two stages** — `fireGun` kicks them forward, and the drive braking the
  recoil shove out over the next quarter second lays them back, so a script that
  samples one frame after the shot gets a number roughly a third of the peak.
  Sample the whole two seconds. Because the world is frozen in `deploy`, a pose
  stepped by hand STAYS on the hull, which is what makes photographing one
  possible at all.
- **The CLIMB is read off `tank.position.y` and the hull node's pitch, and the
  contacts are readable too.** `tank.contacts` is the ten track-contact surface
  heights in `standOnGround`'s order (fore to aft, right belt then left within
  each row), which is what tells you whether a stumble is the ground query or
  the rate limit. Broadside over a parked car on Coldharbour at road speed, the
  shape to expect is monotonic: `position.y` 0 → 0.55 → 1.1, about 6.8
  degrees nose-up going on and 6.4 nose-down coming off, over 1.1 s. **Coming
  off is a FALL and not the climb mirrored** — `tank.grounded` goes false for
  about 18 frames and `position.y` drops under gravity — so a script asserting
  a symmetric shape is reading the fix as a bug. **The SUSPENSION is
  `tank.heave`, which is `tank.rig.sprung.position.y`**: negative is
  compressed, it bottoms out at `suspension.heaveBump` landing off the car, and
  it is the one part of the vehicle whose Y moves against tracks that do not. A
  `heave` that never leaves zero on a drive usually means `standOnGround` found
  nothing — read `tank.floorY` before believing the springs are broken. **Find
  the car by its collider rather than by eye** — it is the only 4.4 x 1.1 x 1.86
  box on the map — and check the run-up is clear of everything else solid, or
  you are photographing the tank riding a planter it met first. **Both belts
  have to CROSS it**: `w`/`d` are the box's LOCAL extents and most cars are
  turned a quarter turn, so an approach picked off those two without `rotY`
  runs the hull down the car's long axis, where the belts (2.62 m apart)
  straddle a 1.86 m body and the tank drives over nothing at all with `floorY`
  flat at 0 the whole way. Take the world extents
  (`|cos rotY| * w + |sin rotY| * d`, and its mirror) and drive across the
  SHORTER one.
- **Where a tank STOPS is the hull's nose, not its centre.** The collision
  sphere rides at the leading end (`Tank.aimCollider`), so a hull driven at a
  wall parks with `position.z + 3.6` a couple of centimetres off the face. A
  script that checks `position` against the wall and expects `collideRadius`
  will report a bug that is the fix.
- **A stepped fleet COLLIDES WITH NOTHING unless you compute the world matrix
  yourself**, and it fails silently in the direction that looks like a finding.
  `moveWithCollisions` starts from `getAbsolutePosition()`, which only catches up
  with `position` when something computes the world matrix — a render, and there
  is not one inside a synchronous `evaluate`. So every step after the first
  collides from where the hull stood at the last drawn frame: the hull advances,
  nothing is ever in the way, and a script "proves" a tank drives through the
  rim, through a barrier and out of the map. Put
  `tank.body.computeWorldMatrix(true)` immediately before each
  `vehicles.update`, which is what the render loop was doing for you. Anything
  driving another `moveWithCollisions` body in a tight loop owes the same call.
- **`startRound()` does not build the map — it books it.** The state goes to
  `loading` and `buildRound()` runs two animation frames later, so a script that
  calls it and reads the world on the next line gets last round's (or nothing at
  all). Wait for `state === "deploy"` rather than for the call to return, and
  time the build around `buildRound` if that is what you are measuring. To hold
  the building card still for a screenshot, replace `g.buildRound` with a no-op
  before calling `startRound`.
- Getting into `playing` takes an indeterminate number of Enter presses (the menu
  gates confirm on `overlayT > 0.5`), so press until `state === "playing"`. A LONG
  PRESS is what registers — `keyboard.press()` can fit the down and up inside one
  ~0.5 s frame gap, leaving the key set empty on every `input.update()`. A long
  wait after getting in gets the player killed (state drops to `deploy`, pose
  freezes) — override `player.takeDamage` to stand still.
- **The touch controls need a touch CONTEXT and CDP, not `page.touchscreen`.**
  `browser.newContext({ hasTouch: true })` is what makes Chromium raise
  `pointerType: "touch"` at all, and `page.touchscreen.tap()` can only tap — a
  stick push and a look drag are multi-finger drags, so drive them with
  `Input.dispatchTouchEvent` over a CDP session, one `id` per finger, and hold
  the ids apart (the stick, the look drag and the fire button are three
  simultaneous roles). The controls are `display: none` until touch is the
  device in hand, and **`boundingBox()` returns null for a hidden element**, so
  a `.tb-fire` lookup that reads as "the button is missing" usually means
  `input.touchActive` is false — check that first.
- **Getting into a round by finger** is a tap on `#overlay .ov-start` and then on
  `#deploy-go`, with a wait between: the same `overlayT > 0.5` gate the keyboard
  path has applies, so tap until `state === "playing"`.
- **A locked pointer emits a zero-delta `pointermove` every frame in headless**,
  which is what the movement gate in `InputManager`'s handler exists for. If you
  are testing device arbitration, that stream is the thing most likely to be
  handing the round back to a mouse that is not there — log
  `input.lastKbmAt`/`lastTouchAt` rather than guessing.
- **A trailing `//` comment inside a GLSL string may not contain a semicolon.**
  Babylon's shader processor splits statements at every `;` and puts the
  remainder on its own line, so the tail of the comment lands as code. What you
  get is `FRAGMENT SHADER ERROR: 0:56: 'water' : syntax error` — a word from the
  middle of your prose, at a line number offset from the file by Babylon's own
  prologue. A comment on a line of its OWN is fine; it is only the trailing kind
  that gets split. **Whether this still bites on the WGSL path is not yet
  settled** — the shaders it was measured on were GLSL, and Babylon's WGSL
  processor is a different one; re-derive it rather than assuming either way.
- **To read what the driver actually saw, hook
  `GPUDevice.prototype.createShaderModule` in an `addInitScript` and keep
  `descriptor.code`** — a failed effect is not in `engine._compiledEffects`, so
  there is nothing to read afterwards. This is strictly better than the
  `WebGL2RenderingContext.prototype.shaderSource` hook it replaces, and not only
  because the backend moved: the module you captured answers
  `getCompilationInfo()`, which returns `{type, lineNum, linePos, message}`
  against the very source you are holding. Do not reimplement the old one.
  Warnings come back through the same call, and Dawn emits a wall of
  `'textureSample' must only be called from uniform control flow` — filter on
  `type === "error"` or every run reads as broken. **Most of that wall is OURS
  and it is not a symptom of anything**: `shadowVisibility` samples the depth
  map inside a branch and `band` takes an `fwidth`, which is what a cel shader
  is, and `glslScaffold` turns the diagnostic off for exactly that reason. A
  run in which those messages arrive as `type === "error"` instead means the
  scaffold did not install — that is the thing to check, not the shader.
- Assigning `input.ads` or `cameraSys.adsBlend` does not stick;
  `InputManager.update()` rewrites the flag every tick. Redefine instead —
  `Object.defineProperty(g.input, "ads", { get: () => true, set: () => {} })` —
  and let `CameraSystem` converge.
- Recoil/spread measured headless is wrong (fewer frames per shot means less
  spring-back) — never tune from it. **What headless CAN settle is the
  arithmetic**, and that is where the recoil pattern is checked:
  `player.recoilKick(adsBlend)` is a pure function of the string counter, the
  drift and the stance blends, so zeroing `fireCooldown` between `tryShot`
  calls drives a whole magazine in one `page.evaluate` and the envelope, the
  ceilings and the walk come out exact. Write the stance in by hand
  (`Object.assign(player, { crouchBlend: 1, moveBlend: 0, airBlend: 0 })`) —
  those are eased in `update` and will not hold otherwise. The viewmodel's kick
  spring is steppable the same way, and being closed-form it gives the same
  answer at any `dt`, which is the one recoil number a headless run may be
  trusted on.
- `Game.updateGameplay` pushes HUD state every frame, so `hud.setScoreboard(...)`
  by hand is overwritten next tick. Drive the input (`page.keyboard.down("Tab")`).
- **`moveWithCollisions` is inert headless, so a "does this stop a body" test
  cannot be written that way.** Set `scene.collisionsEnabled`, give the mover an
  `ellipsoid` and push it 10 m into a `checkCollisions` box and it travels the
  full 10 — and it does so for a plain `MeshBuilder.CreateBox` as readily as for
  anything the map built, which is the tell that the harness is what is missing
  rather than the geometry. What that costs is real: the merged scatter
  colliders (`MapBuilder.clusterColliders`) were verified for RAYS directly (200
  shots fired at trunks from 6 m, 200 stopped) and for BODIES only by
  equivalence — a merged mesh and a loose one behave identically in the same
  harness, and so do the same map before and after the merge. Prefer a
  `pickWithRay` assertion, which works, and say plainly when the body half rests
  on equivalence.
- **A canopy is checked by firing rays at the sky, not by looking at a
  screenshot.** Make the visual meshes pickable (they are `isPickable = false`
  by default), sample a grid of ground points inside the stand, cast straight up
  with a predicate that rejects `metadata.solid`, and the hit fraction is the
  closure. Pair it with the local stem density off `map.colliderBoxes` and the
  two give the crown's effective area: for randomly placed crowns
  `closure = 1 - exp(-rho * Aeff)`, so `Aeff = -ln(1 - closure) / rho` — which is
  what makes "is a bigger crown worth more than another frond" a measurement
  instead of an argument. Greyfen's canopy tree reads ~60-100 m2. A picture
  cannot tell you any of this: 24% closure and 90% closure both photograph as
  "trees with sky behind them" depending on where you stand.
- **Bot BEHAVIOUR is measured in the headless simulation, not in the browser.**
  At ~2 fps nothing crosses a map, so anything about squads, spacing, cover or
  state occupancy wants `HeadlessGame` instead: build a throwaway entry against
  it with `vite build` (copy `vite.server.config.ts`, point `input` at a
  scratchpad file, and either write the bundle inside the repo or set
  `ssr: { noExternal: true }` — a bundle outside the tree cannot resolve
  `@babylonjs/core`), then step `game.step(1/TICK_HZ)` and sample
  `game.battle.bots`. Two things make it a comparison rather than a number:
  `CONFIG` is `as const` to the typechecker and a plain object at runtime, so a
  probe can override any tunable from an env var and ablate one change at a
  time; and `git worktree add <tmp> HEAD` with `node_modules` symlinked in gives
  a BEFORE build to run against the same probe. **Rounds are not deterministic**
  — `ConquestSystem.spawnFor` picks with `Math.random()` — so take three rounds
  a side and compare means; single rounds move by half the effect size.
- Free a stuck vite port by PID from `ss -tlnp`. Never `pkill -f vite` — it
  matches the calling shell.
- **Do not edit anything under `src/` while a script is driving the page.** Vite
  pushes an HMR update, the module graph has no accept handler, and the page
  does a FULL RELOAD — which drops `window.__celshock` and every
  `Object.defineProperty` override and `window.__*` helper the script installed.
  What it looks like is a `TypeError: window.__x is not a function` tens of
  seconds after the last line that used the same helper successfully. Worse than
  the crash is the case where it does not crash: readings taken either side of
  the reload are against DIFFERENT source, silently. At ~2 fps a sweep runs for
  minutes, which is exactly long enough to be tempted. Finish the run, or copy
  the tree.
- The muzzle flash is unhittable at 2 fps (`gunfeel.flashTime` 0.05 s); force it
  with `player.flashRoot.setEnabled(true)`.
- **A soldier is judged in a picture, and the rig can be photographed without
  fighting a round for it.** `await import("/src/entities/SoldierModel.ts")`
  inside `page.evaluate` hands back the real module — the same URL Vite already
  resolved, so it is the same instance the game is using — and
  `buildSoldier(g.scene, g.mats, team)` builds one of each side to park wherever
  you like. An `onBeforeRenderObservable` that puts them a few metres along
  `scene.activeCamera.getDirection(...)` keeps them in shot whatever the camera
  does, `deploy` is the cheapest state to do it in (the map is up and nothing is
  shooting), an injected `#hud{display:none}` takes the interface off the glass,
  `animateSoldier` poses them and writing `rig.root.rotation.y` turns them for a
  turntable. Two traps: there is no `BABYLON` global, so build a vector with
  `new (cam.position.constructor)(x, y, z)`; and **the team read has to be
  checked at RANGE, not only in the close-up** — park the same pair 25–30 m out,
  where a body is ~40 px tall, which is the size at which a kit that only works
  in a portrait stops telling you anything.
- **Sight alignment is checkable without a picture**, and should be after anything
  touching the viewmodel or camera — for **every** optic, since each carries its
  own eye reference. Take
  `scene.getTransformNodeByName("view_<weapon>_<sight>_sightCenter")
  .getAbsolutePosition()` (all twenty-five of
  `rifle`/`carbine`/`smg`/`dmr`/`lmg` × `reflex`/`iron`/`holo`/`prism`/`scope`, since
  a weapon change moves the optic too, plus `view_pistol_iron_sightCenter`) and put it
  in the CAMERA's frame — `computeWorldMatrix(true)` on both, then transform the
  point by `cameraSys.camera.getWorldMatrix().clone().invert()` (the camera is the
  CameraSystem's, not a field on `Game`). At `adsBlend === 1` the answer is
  `(0, 0, eyeRelief × zoomComp)` for that sight; measured across all
  twenty-five, the worst cross-axis component is **6 µm**, so anything above a
  few thousandths of a millimetre is real. Prefer this to projecting the
  world-space offset onto a hand-built basis: the camera's own matrix already
  IS the basis, it needs no argument about which yaw to use, and it hands you
  the expected value instead of a pair of numbers that should be zero.
  - **Waiting three frames is necessary and is not always sufficient — check
    `view.swayX`/`view.swayYaw` have actually decayed.** The viewmodel's own
    sway trails the camera's look rates, and the aimed hold sway keeps the
    camera turning forever, so a reading taken while it is still settling is
    off by tens of microns. Measured: the first optic sampled after entering a
    round read **38 µm** of cross-axis error at four frames and **4.8 µm** at
    forty-four, with `swayX` falling from 1.3e-4 to 1.2e-13 across the same
    span. Every other optic in the same run was under 10 µm, which is the tell
    — one outlier that is also the first sample is a transient, not geometry.
  - Projecting by hand still works, but **not through `flatRight`** — that is
    deliberately the un-recoiled and un-swayed yaw (see `camera.aimSway`), so it
    is not perpendicular to `forward` while either is live and a correct sight
    reads millimetres off. Build the right vector from `cameraSys.aimYaw`:
    `(cos(aimYaw), 0, -sin(aimYaw))`.
  - **WAIT ON RENDERED FRAMES, NOT ON THE SPRINGS** — this is the one that
    produces a confident wrong answer. `Game.setWeapon`/`setSight` apply a kit
    **synchronously and without a swap** (the path is written for the menu,
    where the gun is already put away), so `applyFit` moves `adsPos` on the spot
    while `swapT`, `adsBlend`, `swayX` and `swayPitch` are all still carrying the
    PREVIOUS combination's settled values. A predicate over those is true before
    a single frame has re-posed anything, and what you then measure is the old
    weapon's pose against the new weapon's sight node. Count
    `scene.onAfterRenderObservable` and wait three frames past the fit change; at
    2 fps that is a real wait, and the tell that you skipped it is
    `view.weapon.position` reading **identical across combinations** while
    `view.adsPos` varies. Read the two side by side and they must be equal.
    Measured wrong this way, twenty-three of twenty-five optics come back 1–22 mm
    low or high, in a pattern that correlates neatly with the sight and looks
    exactly like a real geometry bug; measured right, all twenty-five are zero.
  - **The kick's NEAR-PLANE clearance is a second reading off the same node,
    and it needs the two magnified optics specifically.** The per-shot kick
    travels the weapon toward the eye, so on the prism and the scope it can
    drive the sight through `camera.minZ`. Freeze the spring
    (`Object.defineProperty(g.player, "kickDisp", { get: () => 1.35 })`, the
    stacked-burst worst case, plus `kickDrift` pinned so the roll is in it too),
    force ADS, and read the same `sightCenter` z: it must exceed `minZ` for
    every weapon on both optics. **Do not derive this instead of measuring it.**
    The bound in `ViewModel` is computed on the weapon NODE's travel while what
    has to clear the plane is the SIGHT, which the kick's pitch and roll swing
    by another ~4 mm — derived, the DMR with the prism reads 6.2 cm and
    measures 3.8.
  **Alignment is not occlusion, and the second is a MEASUREMENT and not a
  picture**: a sight can read a perfect zero and still be looking at the
  weapon's own stock, which is what the DMR's irons did. `optics.ts`'s
  `ironSightFloor` keeps geometry out of the aperture; what proves it is a grid
  of rays down the sight's own cone, and that needs no round and no map at all —
  every weapon and every optic is built in `Game`'s constructor, so the rigs are
  in the scene while the MENU is up. Take the weapon's root
  (`view_<weapon>_<weapon>`) and its `sightCenter`, put the eye on the sight
  axis at `eyeRelief / viewmodel.scale` behind the centre IN THE WEAPON'S OWN
  FRAME, and fire a disc of rays at the cone's rim plane one unit ahead —
  `scene.pickWithRay(ray, m => own.includes(m))`, whose custom predicate is what
  gets you past `isPickable === false` without touching the meshes. Two things
  make it a diagnosis rather than a number: the hit MESH names the group that is
  in the way (the sight's own housing, the weapon under it, the reticle), and
  the hit point transformed back through the root's inverse world matrix says
  WHERE along the weapon it stands, which is how a bracket at z = 0.4 is told
  apart from a heat shield at z = 0.6. The launcher's optic read 0 clear of 313
  as a solid body and 270 of 313 as a tube; a `Ray` constructor with no import
  is `scene.createPickingRay(0, 0, null, scene.activeCamera).constructor`. A
  screenshot at `adsBlend === 1` is worth taking afterwards, and it is the
  slower half: a launcher's swap is over a second of GAME time, which is ~40 s
  of wall clock at 2 fps, and reading `player.swapping` too early shows the
  previous weapon still in the hands.
- **A viewmodel GESTURE is checked by posing the weapon yourself, and none of it
  needs a round.** `ViewModel.update(dt, params)` is a pure function of a
  sixteen-field `ViewModelParams`, and the rigs exist from `Game`'s constructor
  — so a whole timeline is a loop that builds the params by hand, calls
  `update` twenty or thirty times to let the sway settle, and reads or
  photographs the result. Three things make it worth doing this way rather than
  entering a round and driving the real clock:
  - **Build a map but stop in `deploy`.** The lid holds the world, so
    `updateGameplay` never runs and nothing overwrites the pose you pushed —
    while the map is still standing, which is what LIGHTS the weapon. Posed
    from the `menu` instead the rigs are there but the environment is not, and
    every shot comes back too dark to read.
    `player.view.setVisible(true)` after the lid is up is what puts the weapon
    on screen.
  - **It is minutes rather than half an hour.** Driving the real clock costs a
    launcher swap (~40 s of wall clock), a live round at 2 fps and three
    rendered frames per sample; two attempts at it timed out or lost the
    browser outright. The same sweep posed by hand ran in about two minutes.
  - **`drawSlot` is refused while a swap is in flight**, and the deploy's own
    `applyLoadout` starts one — so a script that confirms the deploy and asks
    for the third slot on the next line is refused silently and then waits
    forever on a predicate that can never come true. Poll and re-ask rather
    than calling it once.

  What to READ is the landmark projected to pixels: `Vector3.Project(p,
  Matrix.Identity(), scene.getTransformMatrix(), viewport)`, with the point
  built by `Vector3.TransformCoordinates(local, node.getWorldMatrix())` so a
  weapon's own coordinates can be named directly (the muzzle at z 1.24, the
  round's nose at 1.2, its motor's tail at 0.44). There is no `BABYLON` global:
  take the classes off live objects (`cameraSys.camera.position.constructor`,
  `scene.getTransformMatrix().constructor`). The support hand
  (`local(supportArm, -0.01, -0.16, 0.64)`) is the self-check — it reads
  **(725, 634)** at rest, which is the figure `docs/antitank.md` recorded when
  the launcher's carry was first framed, so a harness that disagrees with it is
  wrong before anything else it says is worth reading.

  **Photograph the CROP, not the frame.** The weapon lives in the lower middle
  and right of a 1280x720 picture, so `page.screenshot({ clip })` around
  roughly `{x: 340, y: 300, width: 720, height: 420}` is the difference between
  a legible gesture and a dark smudge — the first pass at this was judged from
  full frames and a sleeve was mistaken for the rocket.
- **A fire mode is a synchronous test, and the burst has to be one.** Its rounds
  are 0.05 s apart and headless frames are 0.5 s, so nothing about it is
  observable by holding a key down. `player.tryShot(trigger)` is a pure state
  machine over `fireCooldown`/`triggerHeld`/`burstLeft`: zero the cooldown by
  hand between calls and a whole burst, a refused held trigger and an abandoned
  remainder are one `page.evaluate`. What to assert is the pair the mode is made
  of — `tryShot(false)` returning **true** while rounds are owed, and
  `tryShot(true)` returning **false** on a trigger that was never released.
- **Grenades are testable without waiting for a round**: `g.grenades` takes
  `throwAlong`/`throwAt` and `g.grenades.update(1/60)` steps the flight, so a whole
  detonation is a synchronous loop in one `page.evaluate`. A bot moved by hand must
  be put back to `alive = true` between blasts — `takeDamage` kills it and
  `hittablesAgainst` then leaves it out, which reads exactly like broken falloff.
  "0 damage" at a plausible range is usually the LOS ray finding a wall: sample the
  same distance in all four compass directions before believing it.
- **A whole BLAST is one synchronous evaluate, and `blastAt` is the door.**
  `g.grenades.blastAt(at, team, by, {radius, inner, damage, kind, power})` runs
  the damage and the six drawn layers; `g.grenades.drawBlast(at, power)` runs the
  picture alone and hands back the `BlastGround` the ground probe found. Neither
  fires the light, the sound, the shake or the two Havok layers — those are
  `Game`'s, so a script that wants the whole thing calls
  `g.onExplosion(at, power, g.grenades.probeGround(at))` after it. Step it with
  `grenades.update(dt)`, then `physics.update(dt)`, then `blastDebris.update(dt)`,
  in that order, exactly as a frame does.
- **Every layer is readable rather than photographable, which matters at 2 fps.**
  `g.grenades.blasts[i]` is `{t, power, flash, lobes[], ring}` — a lobe's `rung`
  is its rung of `FIRE_LADDER` and `-1` means parked, so the colour ramp is an
  assertion and not a screenshot. `g.blastDebris.activeCount` is live bursts and
  `g.blastDebris.bursts[i].chunks[j].mesh.position` is where a chunk actually
  went; `g.blastDebris.scorch.marks` is the decal pool. **Put the blast on OPEN
  GROUND**: a control point on Coldharbour is a monument, and a mark laid on its
  plinth is inside the plinth.
- **The blast DUST is not steppable that way** — the puffs run on the GPU and
  advance on RENDERED frames by `updateSpeed * scene.getAnimationRatio()`, and
  headless that ratio is the real frame delta (~30 at 2 fps, not clamped), so a
  2.4 s cloud is three frames. Override `scene.getAnimationRatio`: 0 freezes the
  dust, and `seconds * 60` for exactly one rendered frame (counted on
  `scene.onAfterRenderObservable`) steps the cloud to a known age and holds it.
  Also: `dust.burst()` needs a real `Vector3` (`copyFrom` reads `_x`/`_y`/`_z`, so
  a plain `{x,y,z}` silently gives a cloud at NaN), and `getActiveCount()` is the
  ring size, not live puffs. **There are TWO of these pools now** —
  `g.grenades.dust` and `g.grenades.smoke`, the same class with different
  numbers — and the freeze has to cover both, because they share the one clock.
- **`Game.setMap` takes the INDEX into `MAPS`, not a `MapDef` and not an id.**
  A script that hands it the def gets `Cannot read properties of undefined
  (reading 'id')` from inside `setMap`, which reads like the map is missing. The
  list itself is reachable in dev with `await import("/src/world/maps.ts")` —
  Vite serves the module — so `MAPS.findIndex((d) => d.id === "coldharbour")` is
  the whole of it.
- **The throw and swap ANIMATIONS are still-frame jobs**, and 2 fps is plenty.
  Redefine the clock each is posed from — `Object.defineProperty(g.player,
  "throwT", { get: () => 0.145 })` with `throwPending = false` so the frozen frame
  does not also throw a real grenade; `swapPending = false` first (or
  `completeSwap` fires every frame) then `swapT` pinned to `0.34 * 0.42` for the
  peak. Live-tune the hand by writing `g.player.view.throwKeys[i].pos/rot` —
  resolved from `CONFIG` once at construction, so poses are editable in place while
  timing and give are not. The swap's transient will fool the sight check: taken
  just before a reading it leaves the weapon halfway up and measures as a sight
  ~0.22 m low, so watch `player.swapT` reach -1 AND the sway decay first.
- **Glass is testable without firing a shot, and the sweep is a pure function.**
  `g.glass.sweep(origin, dir, maxDist)` returns the panes a segment crosses,
  nearest first, and `g.glass.shoot(origin, dir, maxDist, true)` breaks them and
  returns which. Both take real `Vector3`s — there is no `BABYLON` global on the
  page (ES modules), so build them from `g.player.position.constructor`. Four
  things that have already cost time:
  - **Aim from a pane's own normal, not from the camera.** A `WorldPane` is an
    oriented box; step out along its thin axis rotated by `rotY` (local +z is
    world `(sin, cos)`) and the segment crosses exactly that pane. Aiming
    sideways along a tower's face legitimately crosses two, which reads like a
    bug and is not.
  - **A muzzle INSIDE a pane is not a crossing.** `segmentHitsPane` requires
    `t0 > 0`, so a script whose origin lands in the 0.12 m sheet gets nothing
    back and should not read that as a broken sweep. It was reachable by
    standing against any tower when the curtain walls were panes; today it takes
    `ObstacleField`'s push-out losing an argument, and the measurement is from
    then — a brute-force control over 600 shots disagreed with the sweep on this
    case and no other.
  - **The break is idempotent and a second shot down the same line returns an
    empty array** — assert on that rather than on a count, or a re-run of the
    same script reads as a broken sweep.
  - **A pane's normal has no preferred SIGN.** `+z` local is one face and the
    shooter is as likely to belong on the other, so a script that stands off
    `+n` unconditionally fires from inside the shop it meant to shoot into. Pick
    the side that is open air first: a point-in-box test over
    `map.colliderBoxes` is four lines and settles it.
  - **`map.panes` is the glass that BREAKS and not the glass that is drawn.**
    Coldharbour lists twenty-four — the two offices' and the eight shophouses'
    shopfront bays — against 6,061
    sheets in `map.paneGroups`, whose vertex count over 24 is the sheet count.
    A curtain wall, a punched window and a windscreen are glazing: `sweep` will
    never report one, and a test that aims at a tower expecting a break is
    testing the rule rather than finding a bug.
  - **The BODY half is testable on any pane, because every pane has a
    collider.** `map.obstacles.resolve(x, y, z, CONFIG.nav.bodyRadius, out)`
    reports a push-out at an intact one and nothing at a broken one; that pair is
    the assertion, not a screenshot.
- **How the glazing LOOKS cannot be judged from one screenshot, and that is the
  feature rather than a testing problem.** It is a Fresnel between the tint of
  what is behind the pane and a reflection of the sky, so square-on and down the
  street are two different materials to the eye: shoot both, or a value tuned on
  one will be wrong on the other. Two standing checks are cheap and are worth
  asserting instead of eyeballing — `map.paneGroups.every(g =>
  !g.mesh.renderOutline)` and no pane mesh in
  `g.shadows.generator.getShadowMap().renderList` (40 pane meshes against 316
  casters on Coldharbour). A pane that gains either is drawn as a dark plate or
  lays a hard shadow through clear glass.
- **What a pane REFLECTS is checkable without a screenshot, and the CUBE is the
  place to check it.** There is one probe per glazed map block —
  `g.reflections.probes[slot]` against `g.map.paneGroups[slot]`, 40 of each on
  Coldharbour — and `probe.cubeTexture.readPixels(face)` gives one baked face:
  alpha over 128 is world, everything else is the sky the shader fills in. Three
  standing checks:
  - **Coverage says the enclosure rule fired.** Mean coverage over all six faces
    is 0.711 across the 40 probes as shipped. Put the enclosing meshes back
    (`probe.cubeTexture.renderList = allOpaque; probe.cubeTexture.render()`) and
    a tower's goes 0.57 → 0.84 and **a parked car's 0.68 → 0.99** — a probe
    inside its own bodywork, which is the failure the rule exists for.
  - **Face 2 is 100% and face 3 is 0**, and that pair is the Y-flip contract
    rather than a curiosity: face 2 is `POSITIVE_Y` and it holds the DOWNWARD
    view, which is why the shader samples the cube with `-y`. A bake that lost
    the flip reads as glass that is simply too dark.
  - **A material per probe, and no extra draw.** `new
    Set(g.map.paneGroups.map(p => p.mesh.material.name)).size` is the probe
    count, while the mesh count is unchanged — that is the whole affordability
    argument, and a regression here shows up as one name for all 37.
- **The eye is the thing a bake can leak.** `g.mats.camPos` must equal
  `g.cameraSys.camera.position` on any frame after an install; if it equals one
  of `g.reflections.probes[i].position` instead, the bake put the eye back
  wrong and the install frame fogged the whole map from a point inside it. It
  self-corrects on the next frame, so this is only ever visible as an
  assertion — read it in the same `evaluate` that starts the round.
- **Whether the glazing is DRAWN at all is a separate question from how it
  looks, it is a number, and it has to be asked at RANGE** — that is where
  glass past ~100 m was found not to be drawn at all
  (`CelMaterialFactory.GLASS_DEPTH_UNITS`). The reading is the pane's own
  contribution: grab a patch, `paneGroups[i].mesh.setEnabled(false)`, grab
  again, and difference the two. Zero means the pane lost the depth test, not
  that it is subtle. Three things make the sweep say something:
  - **Hold the incidence angle and the on-screen size still, or the answer is
    about the Fresnel instead.** Stand on the pane's own normal at its own
    height (a `WorldPane`'s local +z is world `(sin rotY, cos rotY)`) and set
    `cam.fov = 2 * atan(k / dist)`, so the only thing changing down the sweep
    is the distance.
  - **Hide the rest of the map rather than hunting for a clear sightline** —
    `map.visuals`, `setEnabled` on a radius around the target. Above ~100 m
    every line across Coldharbour crosses something, and a blocked shot reads
    exactly like a pane that is not drawn.
  - **`markVisual` freezes the world matrices**, so moving a pane group to test
    a standoff silently does nothing: `unfreezeWorldMatrix()` and
    `computeWorldMatrix(true)` first. Measured that way, a pane at 220 m needs
    ~0.2 m of clear air in front of the wall before the depth buffer can
    separate the two, against the 0.04 m the builder gives it.
- **Placing a camera on Coldharbour by hand lands it inside a building far more
  often than it looks like it should.** The towers sit on a 30 m grid and are 26 m
  across, so the gaps are metres; the four avenues (`x` and `z` at ±40 and ±120)
  and the central square are the reliably open ground. Standing in a tower reads
  as a black frame with a sliver of city in it and looks like a render bug.
  **The square is open ground but it is PLANTED** — four 20 x 20 m stands of
  pines at (+/-19, +/-19) — so an eye-height camera anywhere out toward its
  corners is inside a tree, and the tree fills the frame looking exactly like a
  piece of the map gone wrong. Within ~15 m of the centre, or on an avenue, is
  clear; and the monument at the origin reaches ~10 m, so a camera placed above
  the square looks down at the top of it and not at the floor.
- **The flow-field rebuild is what a break costs, and it is measurable in one
  line**: `map.nav.rebuildField(name)` for each of `map.nav.fieldNames`.
  Measured headless on Coldharbour — 4.7 ms for one and 15.9 ms for all seven,
  over 183k surfaces — which is why `GlassSystem.update` drains one per frame
  rather than all of them on the frame a window goes in.
- **Shards step like a ragdoll, and the ENGINE steps separately from its
  clients**: `g.physics.update(1/60)` then `g.debris.update(1/60)` in a loop,
  in that order. `g.debris.burst(pane, at, dir, camPos)` takes the `WorldPane`
  itself — the burst is CUT from that face — and returns whether it was
  accepted: false past the distance gate, and false while every slot holds a
  burst younger than `CONFIG.glass.shardSteal`. Both still leave the pane
  broken, because the break is the world changing and the shards are only what
  it looked like. There is no fallback to reach: Havok is required, so every
  burst is under the solver or is not drawn. Four things worth asserting rather
  than eyeballing, all of them off `g.debris.bursts[i].shards[j].mesh`:
  - **The pieces start ON the pane.** Project each shard onto the face and both
    coordinates are inside the pane's own half-extents, with the out-of-plane
    offset a standoff and nothing more. The across-axis to project onto is
    `(nz, -nx)` from the pane's own normal and NOT its long axis: the two agree
    for a sheet whose width is its `w` and differ by a sign for one whose width
    is its `d`, which reads as a burst mirrored about the pane's centre. **The
    convention-free version of that check is the one to write**, because a test
    that projects with the same axis the code did cannot fail: aim at a point
    well off the pane's centre and assert the burst's centre of MASS lands near
    the crossing point in world space. Over all 24 of Coldharbour's panes (yaws
    of 0, π/2 and π, so both the `w`-wide and `d`-wide cases) that drift is
    ≤ 0.26 m, where a mirrored axis puts it at twice the hit's own offset —
    around 2 m on a shopfront bay.
  - **The pieces are cut to the pane, and `mesh.scaling` is not where to look —
    it is 1 on every shard.** A piece is a polygon and its outline is in the
    VERTICES: read `mesh.getVerticesData("position")` (48 of them, 84 indices,
    on every shard forever) or `getBoundingInfo().boundingBox.extendSize`. The
    first eight vertices are the front face, so distinct `(x, y)` pairs among
    them is the corner count and a shoelace over them is the piece's own area.
    Measured on Coldharbour's 4.3 x 2.9 m bay: twelve pieces of 0.10–1.46 m²,
    four to six corners each, 63% of the pane's area. **A burst is not always
    twelve pieces** — a pattern clipped hard by the frame hands back fewer, so
    assert on `burst.live` or on enabled meshes rather than on `glass.shards`.
  - **The standoff is one number for every piece in the burst** (~0.175 m along
    the pane's own normal, most of it the two colliders' thickness), because the
    tilt is bounded by what it may REACH rather than by an angle. A shard
    standing further off than its neighbours means `LEAN` is being spent as an
    angle again, which is what put a 2 m panel a quarter of a metre inside the
    shop.
  - **The gate is an apparent size, not a distance**: `shardDistance` is quoted
    for a piece of `shardMax`, so a pane cracked at a smaller pitch is refused
    at a range a shopfront's is accepted at. Test it with the pane, not with a
    number.
- **The crack pattern needs no browser at all, and that is where to test it.**
  `src/systems/glassFracture.ts` imports nothing — `npx esbuild
  src/systems/glassFracture.ts --format=esm --outfile=/tmp/f.mjs` and call
  `fracture(makePieces(12), faceW, faceH, hitU, hitV, reach, pack, rand)` from
  node. Four things it settles in one run, none of which a screenshot can:
  every piece convex and wound counter-clockwise (a negative shoelace is the
  winding bug, and it hands back zero pieces rather than mirrored ones), every
  piece inside the pane's own half-extents, the corner-count spread, and the
  covered fraction. Feed it a hit at the centre AND one a handful of
  centimetres from a corner: the second is the case the reach retry exists
  for.
- **A THROWN corpse is measured off the PROXY and only until it FREEZES**, and
  both halves have already cost time. `slot.bones[i].proxy.position` is the
  corpse while the solver owns it — a root node, so the local position IS the
  world one and no `computeWorldMatrix` is owed. But `freeze` bakes the pose
  back into the rig and parks the bodies, and a parked proxy sits at the ORIGIN:
  keep sampling past that and a corpse on Hollowmere's north spawn reads as
  having flown 138.62 m, which is exactly the distance from that spawn to
  (0, 0, 0) and is the tell. Break on `slot.subject !== bot || slot.frozen`.
  Two more that look like the throw not working: a body placed by hand needs
  `rig.root` at `position.y + rig.centerHeight` and NOT at the feet (the root is
  the body's middle, so feet-aligning it buries the corpse to the hip and the
  floor eats the whole impulse), and `ragdolls.spawn(subject, camPos)` takes a
  CAMERA position — pass the body's own if the camera is still at the map centre,
  or every offer past the fog wall comes back refused. Measured with all three
  right, a body killed standing with the blast 2 m away at ankle height: a rifle
  round 0.12 m, a frag 4.2 m, a rocket 7.2 m, a tank shell 8.6 m — and a charge
  directly UNDERNEATH throws it straight up and puts it back on the same spot,
  which is correct rather than a failure.
- **A ragdoll is steppable synchronously, like a grenade, and must be**:
  `g.ragdolls.update(1/60)` in a loop runs a whole tumble, settle, sink and retire
  in a fraction of a second. Move a bot, `bot.takeDamage(999, shooterOrigin)`, then
  `g.ragdolls.spawn(bot, camPos)`, which returns whether it was accepted — and
  the only thing that makes it false is the view distance, since a full pool
  evicts its oldest corpse rather than refusing. (A useful shape for that: offer
  a dozen staged bodies in a row, stepping once between each so none is merely
  sinking, and assert every one comes back true.) Four traps. **Reading a rig joint's world position needs `computeWorldMatrix(true)`
  first** — outside the render loop `getAbsolutePosition()` is a stale cache, and a
  joint that looks pinned while its proxy falls is that, not a broken hand-off. **A
  bot reused between takes needs `alive = true` and `hp` restored.** **The camera's
  pitch is negative for down** (`forward.y = sin(pitch)`), so placing bodies along
  `cameraSys.forward` while pitched throws them into the air — build a horizontal
  basis from `aimYaw`. And **the settled pose is a numeric question first**: the
  joints' height spread says face-down (all within ~0.01 m) or on its side
  (~0.5 m), which a headless screenshot at this scale will not.
- **A CROUCHED death is one line of setup and is worth checking after anything that
  touches the bone table**: `Object.assign(g.player, { crouchBlend: 1 })` then
  `g.player.takeDamage(999, from)` in the SAME `page.evaluate` — the blend is eased
  every tick and will not survive a round trip, and `enterDying` reads it
  synchronously off `player.stance`. Then step `g.ragdolls.update(1/60)` in a loop as
  above; the death cam's own clock is not involved. **The reading that means
  something is the knee's fold angle**, and it is an angle between world positions
  rather than a local rotation — the joints belong to the solver's proxies while it
  owns them, so `kneeL.rotation.x` is not the pose. Take
  `acos(normalise(knee - hip) · normalise(ankle - knee))` with
  `computeWorldMatrix(true)` on all three: 2.58 rad is the drawn full crouch, and a
  leg that reads ~0 within a step or two of the throw is a joint limit that does not
  contain its own spawn pose. A standing body settles with every joint inside 0.06 m
  of the floor; a crouched one settles on its side and stays curled, so the
  face-down height-spread test above is the wrong assertion for it.
- **The death cam is the one thing NOT steppable synchronously**, by design: it is
  a game state, so it advances only from `tick` — ~80 s of wall clock for its 4 s.
  SAMPLE `g.deathCam.elapsed` rather than sleeping a fixed wait. Everything else is
  forceable: `g.player.takeDamage(999, from)` enters it with a known impact
  bearing, `g.deathCam.corpse` is the stand-in body (`.rig`, `.ragdolling`), and
  `g.deathCam.stop()` + `g.state = "playing"` + `g.player.fullReset()` gets back
  out. The corpse rig is built ONCE per process and never rebuilt, so a leak is
  permanent: assert `rotationQuaternion === null` on all nine posed joints
  afterwards, plus each one's parent and local position against `rig.rest`. There
  is no fallback path left to reach — the body is at the camera, so the distance
  gate cannot refuse it, and a full pool evicts its oldest corpse instead of
  saying no. **`deathCam.start(feet, yaw, eye, forward, from, damage, kind, crouch)` is
  callable directly**, which gets the whole ragdoll-and-restore check (including a
  crouched death: pass `crouch: 1`) without spending 80 s of wall clock on the
  cam's own clock. Step `g.physics.update(1/60)` + `g.ragdolls.update(1/60)` in a
  loop, then `g.deathCam.stop()` and assert on `rig.rest`.
- **A pixel diff needs the frame FROZEN, and three separate things move it.**
  Measured noise floor between two consecutive grabs with nothing changed at all:
  **42-47% of pixels**, which swamps anything being looked for. The grade's grain
  is by far the largest — it is re-hashed every frame at ~14 LSB, so
  `g.post.setEnabled(false)` on its own takes the floor to **0.00%**. The ash is
  next (see below), and `g.sky.update = () => {}` pins the cloud decks, which
  drift even under the pause lid because `sky.update` is called from `tick`
  OUTSIDE `updateGameplay`. Check the floor by grabbing twice and diffing before
  trusting any measurement; a method that cannot reach zero is not measuring what
  you think.
  - **Turning the post chain OFF is the blunt version, and pinning the grain's
    CLOCK is the one to use.** `Object.defineProperty(g.post, "time", { get: ()
    => 0 })` kills the re-hash and leaves the vignette, the desaturation, the
    aberration, the god rays and the motion blur in the picture — measured
    under WebGPU, the floor still reaches **0.000%** that way. What it buys is
    that the three post fragments are IN the frame, so a reference set taken
    this way can diff them; one taken with `setEnabled(false)` cannot.
  - The 42–47% figure above is the WebGL2 floor. **It was re-derived under
    WebGPU rather than assumed to have followed** — same three movers, same
    zero.
  - **Three movers reach zero inside ONE process and NOT across two, and the
    two that stand between is neither of them a clock.** A lantern's flicker
    PHASE is `Math.random() * 100` per fixture at map build, so a lamp-lit
    frame cannot agree with itself between two boots however carefully time is
    pinned; and a cube probe is refresh-ONCE, baked in the frame after
    `installMap`, so the water and the glazing go on reflecting a world with
    the wind and the cloud decks wherever that particular boot had left them.
    Measured before both were held: 0.00/255 on the two maps with no lamps, up
    to 1.0 on a lamp-lit street and 0.72 across a marsh that is half water —
    with every clock, phase and uniform already provably identical, which is
    what said the difference could not be in the uniforms. **The phase is
    seeded in `LightingSystem` now** (`FLICKER_SEED`, re-seeded in `clear`), so
    a script inherits that one and does not have to reach for it; what a script
    still owes is `resetRefreshCounter()` on both probe pools AFTER pinning the
    clocks, then a few frames. That reaches byte-identity across processes.
    `plans/webgpu-ref/harness.mjs`'s `freeze` is the worked version and carries
    the whole argument.
- **The pause lid is a free camera**, and it is raised with `g.raiseLid("paused")`
  — **`g.state` is a getter and assigning it throws**, since nothing in the
  codebase assigns a state (see `Game`'s three moves). The lid stops
  `updateGameplay` while the scene still renders, so nothing overwrites
  `cameraSys.camera` and it can be placed by hand — `cam.position.set(...)` plus
  `cam.setTarget(...)` frames a roofline or a shadow edge from anywhere, which
  beats hunting for a vantage by walking the player. The shader's eye follows:
  `mats.updateCamera` is pushed from `tick` in every state, so the fog, mist,
  rim and the glazing's reflection are all computed from where the camera
  actually is. One caveat left: the HUD does not appear in a canvas grab, so the
  pause card is invisible to `readPixels` even though a Playwright
  `screenshot()` shows it.
- **One vantage per process run when the numbers matter.** Cycling
  `paused → playing → paused` between vantages lets a frame of gameplay run, and
  the player moves, falls or gets shoved in it. The same measurement taken as the
  second of two vantages read 55 runs against 30 for the first — enough to invent
  a result. Relaunch per vantage.
- **A "does this surface do X" diff needs a MASK of that surface**, or it is
  measuring whatever else is on those pixels. Build it by toggling the thing off:
  grab, `mesh.setEnabled(false)`, grab, and the pixels that changed are its. That
  is what separates "the grass now takes shadows" from "the ground under the grass
  always did" — and at a downsampled resolution it does NOT work, because every
  blade pixel is a blend of grass and ground. Grab at full canvas size.
- **A generated texture is inspectable in a second, without booting the game**,
  and the ground surfaces should be looked at both ways. Bundle
  `src/world/textures.ts` with esbuild against a **stub `@babylonjs/core`**
  (`--alias:@babylonjs/core=...`) exporting a `DynamicTexture` that wraps a real
  `<canvas>` and answers `getContext()`/`update()`, load the bundle into an
  `about:blank` page with `addScriptTag`, and `toDataURL()` whatever the module
  hands back — the REAL recipes, no engine, no map build, ~1 s for every surface
  at every tint. Draw them 4x4 as well: a tile that looks right on its own can
  still carry a blotch big enough to advertise its own period, and that is only
  visible repeated. Counting distinct colours in the result is the cheap check
  that a posterized ramp is actually being used — a surface spending 98% of its
  texels on two of six levels has five-sixths of a palette and one of a look.
  **Neither view replaces standing on it**: the shader's quantized bands over the
  height map are most of what the player sees, so finish in-engine, looking down
  (`cameraSys.pitch` is NEGATIVE downward) with `player.view` disabled — and
  point a run at the surfaces no map ships, since `turf` rotted precisely because
  nothing ever selected it.
- **The mote field is frozen for a pixel diff with `stop()` + `reset()`** on
  `g.atmosphere.system`. That works on `GPUParticleSystem` only because
  `Atmosphere` constructs it with `emitRateControl: true`; Babylon's legacy GPU
  mode keeps accumulating while stopped and refills the sky a second later — do not
  change that option. The field takes `maxLifeTime` to reach steady state, so let
  `getActiveCount()` settle first. Read `system` through the handle each time: a
  *different* `ParticleSpec` replaces the whole system. **Two maps have one now**
  — Hollowmere's falling ash and Coldharbour's rising dust — so a script that
  froze the field on one map and not the other no longer covers both.
- **The wind is an A/B, not a wait.** Foliage sway is a per-vertex displacement
  in the cel shader driven by one clock, and that clock advances in
  `updateCameraAndLighting` — so at ~2 fps with `dt` clamped it creeps at a
  quarter of wall clock and a canopy photographed two seconds apart has barely
  moved. Drive it: `g.mats.updateWind(2.6)` jumps the clock by two and a half
  seconds of world time and pushes it onto every cel material, so a shot either
  side of that call is a clean before/after of half a gust. Freeze everything
  else first (`g.updateWorld`, `g.updateCameraAndLighting` and
  `g.atmosphere.apply(undefined)`), or the motes and the bots move too and the
  diff proves nothing. To check a mesh is actually PLUMBED rather than merely
  drawn, read the buffer instead of the pixels:
  `m.getVerticesData("color")` on a mesh with `m.metadata.sway` should hold a
  non-zero red on the vertices high off the ground and near zero at its foot.
- **The swaying foliage's ink is a MESH, not `renderOutline`, so counting the
  one will not find the other.** Every mesh with `metadata.sway` has
  `renderOutline` false and a twin beside it whose material name starts
  `cel-ink-`; the pair that proves the wiring is `swayMeshes === inkTwins`, plus
  every twin's colour buffer holding a non-zero RED (otherwise the twin is
  there and standing still while its leaf moves, which no still screenshot
  shows). Check `metadata.noShadowCaster` on them in the same pass — a hull in
  the shadow map lays a fattened copy of the canopy on the floor, and it is a
  quiet enough artefact to survive a review.
- **A source edit reloads the page and destroys the handle mid-run.** The dev
  server hot-reloads on any file in the module graph, and the symptom is
  `page.evaluate: Execution context was destroyed` or a bare `undefined` where
  `window.__celshock` was — several minutes into a run that had already got into
  a round. Finish editing before starting a long script, or drive `npm run
  preview` instead.
- **`godRays.isLive` is set by the PREVIOUS frame's `update`, so reading it in
  the same `evaluate()` that moves the camera always answers about where the
  camera WAS.** It reads `false` from a vantage plainly pointed at the sun, which
  looks exactly like the pass being broken. Move the camera, wait, then read.
  The same is true of anything else derived in `Game.tick` rather than assigned
  where you set it.
- **A heavy frame outruns Playwright's default 30 s `page.screenshot` deadline**,
  and the error names the screenshot rather than the cause. Coldharbour with the
  shafts attached, ~15k GPU particles and 37 reflection probes does it every
  time under swiftshader. Pass an explicit `timeout:`, and expect a single
  vantage on that map to take several minutes end to end — most of it in the
  map build, not the capture.
- **Water needs a vantage computed, not guessed, and the map picker is
  `localStorage["greywatch.map"]` set in an `addInitScript` before the load.** A
  `WaterRect` is not where the water is (see [`docs/world.md`](docs/world.md)): on
  Greyfen one rect covers the map and only 11% of it is wet, so scan for cells where
  `surfaceAt(x, z) < surfaceY` and aim along the longest wet run from one. Three
  things will otherwise fill the frame with something that is not water and does not
  look like a mistake — the viewmodel (`player.view.weapon.setEnabled(false)`), the
  capture skirt, which you are always inside of near a flag (`g.zones.dispose()`),
  and the **fog**: Greyfen's `fogEnd` is 78 m, so a look down a long reach is a
  uniform wall of fog colour that reads exactly like being stuck inside a mesh. Put
  the camera within ~30 m of what you are judging. **Every water tunable is a
  NAMED float uniform**, so `g.water.bodies[i].mat.setFloat("foamDepth", 0.05)` (and
  `setColor3` for the palette, off the app's own `Color3` — import
  `@babylonjs_core.js` by the url in `performance.getEntriesByType("resource")` or
  you get a second Babylon and a class the materials reject) sweeps a whole
  parameter space in one page session with no rebuild. Two readings that mean
  something when the water looks wrong: `g.reflections.waterProbes[0].cubeTexture`
  answers `readPixels(face)` — face 2 is the DOWN view and face 3 the sky, because
  a cube rendered into is stored mirrored about the horizon — and a water surface
  that comes back as one flat colour at every angle is almost always the cube's
  average, i.e. the mip level, rather than a broken bake.
- The kit turntable needs no clicking: `g.openLoadout()` reaches it from `menu` or
  `deploy` (assign `g.state = "deploy"` first from a live round). The pose is
  readable (`player.view.inspectYaw`/`inspectPitch`), and
  `view.weapon.rotationQuaternion` must be **null** again after the screen closes
  or the carried pose never comes back — re-run the sight-alignment check after a
  session on it, since a leaked quaternion or scale shows up there and nowhere
  else.

- **Multiplayer needs a server, and the client reaches it with `?mp`.** Build and
  start it (`npm run build:server`, then `PORT=8097 node dist-server/index.js`)
  and load the page as `?mp=ws://localhost:8097/ws` to skip the menu and join
  straight in, or `?server=ws://localhost:8097/ws` to aim the LOBBY at it and
  drive the menu. Three things about driving it that have already cost time. **A test cannot place a player anywhere** —
  the validator refuses it as a teleport, correctly — so a script that wants two
  players near each other has to WALK them, and one that dead-reckons from the
  server's last reported position never advances, because that report lags the
  sends by up to a snapshot. Track the position locally and take only `y` from
  the server. **A walker has no ground probe** (the real client runs `Player`'s),
  so it stops dead at the first rise unless it raises `y` on a `ground`
  rejection. And **the straight line between two home spawns runs through the
  village**: walk to the map centre instead, which is the control point every
  road leads to.
- **To drive the REGION lobby, edit `public/regions.json` — and put it back.**
  It is a plain static file the dev server hands over unhashed, so two or three
  entries pointed at `localhost:8097`, `:8098` and a port with nothing on it
  cover the whole screen: the merged list, a ping per region, the note row a
  dead one leaves, and the picker. `?server=`/`?mp=<url>` REPLACE that list with
  one synthetic region, which is also how the single-region form of the screen
  is checked. Two readings that mean something: `localStorage["greywatch.region"]`
  is written only by a real pick (a preselection by ping deliberately is not),
  and `g.net.conn.socket.url` after a join is the proof that the row's region
  and not the standing one is what opened the socket.
- **The lobby's four-second list timeout is WALL clock, so a headless page that
  has built a map can miss it against a server on the same machine.** Every
  region then renders as "could not reach the match server" with nothing wrong
  anywhere — the fetch resolves late because the main thread is at ~2 fps, and
  `AbortSignal.timeout` does not care that the thread was busy. Open the lobby
  before building a round when you can; when the test needs a round first, allow
  a couple of refreshes rather than reading one failed fan-out as a result. The
  pings on a fresh page are honest (1–8 ms to localhost) and are the ones to
  assert on.
- **`?mp` no longer lands you in the world — it lands you on the deploy
  screen.** A netplay round deploys nobody unasked, so a script that waits for
  `state === "playing"` after joining waits forever. Confirm first
  (`g.deployScreen.confirm()`), optionally after steering the pick
  (`g.deployScreen.selected` / `selectedSpawn`, which is the list's identity and
  has to move with it), and the state changes when the SERVER's spawn event
  lands rather than on the call. Client-side clocks are the ones the ~2 fps
  budget wrecks: the local reinforcement countdown takes ~80 s of wall clock to
  run out, so force `g.respawnT = 0` rather than waiting for it. The server's
  clock is real and is the one that actually gates the deploy.
- **To stage a map change, push the MESSAGE, not the callback.** `g.net.onRoundStart("greyfen")`
  looks like a rotation and is not one: `NetSession.mapId` is written by `receive`,
  so calling the callback directly leaves the session still naming the old map and
  `buildRound` — which reads it as the authority's answer — quietly puts the map
  back on the way through. `g.net.conn.onMessage({t:"roundstart", mapId, now:
  Date.now()})` goes through the real path, and the same trick stages a reconnect
  onto a rotated match with a `welcome`. Both are the only way to see a rotation at
  all without playing a round out: `ROUND_OVER_MS` is 8 s on top of a full ticket
  bleed. To record which world each build actually got, wrap `g.installMap` and push
  `g.mapDef.id` — the end state alone cannot tell one build from two.
- **The whole of spawn selection is testable without a browser, and two of the
  three ways are faster than one.** `dist-server/assets/HeadlessGame-*.js`
  exports the simulation (`H`) and the world chunk exports `MAPS`/`CONFIG`
  (`M`/`C`), so a scratch `.mjs` can `addPlayer`, set `deployRequest`, step at
  `1/60` and assert on the clock in milliseconds of wall time — including
  `takeDamage(999)` for a death the rules actually dealt. A raw `ws` client
  covers the protocol half (join, refuse, fall back) with no rendering at all.
  Keep the browser for what only it has: the screen, the offer and the state
  machine. Note that a scratch script outside the repo cannot `import "ws"` or
  `"playwright"` by name — resolve them by absolute path into `node_modules`.
- **A stationary body at a REAR flag is not killed, and that reads exactly like
  a broken death path.** Four minutes at the chapel spawn drew nothing; the
  square kills one in about forty seconds, which `does-a-human-die`-style
  stepping of a `HeadlessGame` will tell you in three. Bots do engage a person
  — check where you parked before believing anything else.
- **`page.waitForFunction(fn, { timeout })` silently uses the DEFAULT 30 s.**
  The second parameter is the argument passed INTO the page function; options
  are third. Every wait written that way expires in thirty seconds however large
  the number reads, which turns "the bots never killed us" and "the round never
  ended" into confident, wrong conclusions about the game.
- **To stage a remote body's death, seize its sample buffer with a FUTURE
  timestamp.** `NetSoldier.receive` drops anything not newer than its newest
  sample and `bracket` clamps below its oldest, so one sample at
  `Date.now() + 1e9` both freezes the slot against the live stream and becomes
  the pose. Put the body where you want it alive, call `s.update(t)` to place
  the rig, then `s.samples.length = 0` and push a single dead sample at `t + 1`
  — the roster's own `alive` edge does the rest, so what is under test is the
  real wiring rather than a hand-called `spawn`. The timestamp must beat the
  SERVER's clock (`snap.now` is `Date.now()` on its box, ~1.7e12): a round
  number like `1e12` is *below* it, every real sample keeps landing, and the
  body simply walks away while the test reports nothing ragdolled.
- **A ragdoll refused in a netplay round is usually the fog gate, not the fix.**
  The gate is the MAP's `fogEnd`, pushed into `RagdollSystem` by `installMap`
  (`FOG_WALL`, 78 m, is only the default and only until a map is installed) — so
  on either valley a client sitting at its home
  spawn is further than that from every death in the village — so a run can
  report a dozen death edges, all correctly armed, and zero corpses. Assert on
  the edge count and the offer separately, or stage the body near the camera.
- **Restart the match server between runs, and do not trust a hang.** Matches
  outlive the client that made them by a minute (`IDLE_DISPOSE_MS`), so a script
  run three times leaves three worlds simulating at 60 Hz on the box that is
  also running SwiftShader — and the symptom is not a slow test but a handshake
  that never completes, which reads exactly like a broken join. A `curl
  localhost:PORT/matches` before the run tells you whether the registry is
  clean. It also breaks any assertion of the form "there is exactly one match".
- **Playwright's `click()` does not reach the interface: the canvas fills the
  viewport and is read as intercepting**, even though `#hud` is
  `pointer-events: none` and each control opts back in. Every button that leaves
  a screen binds `onpointerdown`, so `locator.dispatchEvent("pointerdown")` is
  both the reliable path and the true one.
- **Do not monkey-patch `window.WebSocket` without carrying its statics.**
  `Connection.send` compares `readyState` against `WebSocket.OPEN`, so a wrapper
  function without `OPEN` on it makes every send a silent no-op — the socket
  opens, the state reads `open`, and the join is never sent. It costs an hour
  because everything looks connected.
- **`npm run simulate` is the fastest way to see the rules work at all** — a
  whole round with no clients and no rendering, in seconds of wall clock. It is
  not a balance oracle: sixteen bots is not eight bots and eight people.
- **Assertions about hits are worthless until one lands.** A "shot fired
  backwards is refused" check passes trivially when nothing is hitting anything,
  and so does a rate limit. Order them after a passing hit, or they are
  measuring silence.

- **A service-worker update cannot be tested from one build.** It takes two
  `dist/`s and a server you can point at either one: build, copy `dist/` aside,
  change something, build again, and swap which directory is served. Serve it
  with the cache headers `docker/default.conf.template` sets — `no-cache` on
  `/`, `/index.html`, `/sw.js`, a year on `/assets/` — because getting those
  wrong moves the bug to the HTTP layer and you will debug the wrong file. A
  marker that survives minification is worth planting: a `<meta name="build">`
  in `index.html` says which shell rendered, and the hashed entry `<script src>`
  says which bundle it pulled.
- **A page reload does NOT make the browser check for a new worker.** Measured
  in headless Chromium: reloading across a deploy asked for `/sw.js` zero times
  and the precache stayed on the previous build indefinitely, because
  `register()` on an already-registered script resolves without checking and the
  navigation's soft update is throttled. Calling `registration.update()` by hand
  installs, activates and prunes within a second. If a worker change appears to
  do nothing, this is why — check whether `/sw.js` was even requested before
  suspecting the worker.
- **To prove a cache actually holds what it promised**, read it rather than
  trusting install to have finished: `caches.keys()`, then `cache.keys()` mapped
  to pathnames, compared against the `PRECACHE` manifest baked into that build's
  `dist/sw.js`. An install that half-succeeded and a complete one look identical
  from the page.
- **Simulating a bad network needs a server that ACCEPTS and then says nothing**
  — a handler that returns without writing a response. `setOffline(true)` is the
  easy case and the one that already worked: an offline fetch rejects at once, so
  it never exercises a timeout. The stall is what found the socket leak, and it
  is also a trap of its own: those sockets are never released, so anything
  measured after a stall is measured through a starved connection pool.

To inspect a model in isolation, drop a throwaway `modelviewer.html` + `.ts` at
the repo root (Vite serves it as a second page) with an `ArcRotateCamera` driven
by `camera.setPosition`.
