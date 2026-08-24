# VERIFYING.md

How to drive this game from a headless browser, and the quirks that have already
cost time doing it. Split out of [`CLAUDE.md`](CLAUDE.md), which with the
subsystem contracts under [`docs/`](docs/) is still the source of truth for
architecture and invariants — read this when you are writing a smoke test, not
when you are reasoning about a change.

Playwright + Chromium are devDeps for ad-hoc smoke tests; write throwaway scripts
to the scratchpad, not the repo. `Game`'s constructor exposes `window.__celshock`
(`g` below). Headless quirks that have already cost time:

- Headless SwiftShader runs at ~2 fps and `dt` is clamped to 0.05, so **game time
  runs at ~25% of wall clock**. Don't wait for bots to cross a map (240 m, or
  Coldharbour's 320) — force a
  skirmish by overriding `battle.spawnPointFor`, or drive rules directly with
  `conquest.update(1/60, fakeCombatants)` in a loop.
- **`window.__celshock` now appears one WASM download later than it used to.**
  `main.ts` awaits `loadHavok()` before constructing `Game`, so a script that
  polls for the handle is waiting on the physics binary as well as on the bundle
  — give `waitForFunction` a generous timeout and do not read the absence of the
  handle as a construction failure. The upside is that `g.physics.plugin` and
  both pools are non-null on the FIRST evaluate, so nothing has to wait for the
  engine separately. To exercise the failure branch, `page.route("**/*.wasm", r
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
  that gets split. To read what the driver actually saw, hook
  `WebGL2RenderingContext.prototype.shaderSource` in an `addInitScript` and keep
  the sources — a failed effect is not in `engine._compiledEffects`, so there is
  nothing to read afterwards.
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
  **Alignment is not occlusion, and only the second needs a picture**: a sight can
  read a perfect zero and still be looking at the weapon's own stock, which is what
  the DMR's irons did. `optics.ts`'s `ironSightFloor` keeps geometry out of the
  aperture; a screenshot at `adsBlend === 1` confirms it.
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
- **The blast DUST is not steppable that way** — the puffs run on the GPU and
  advance on RENDERED frames by `updateSpeed * scene.getAnimationRatio()`, and
  headless that ratio is the real frame delta (~30 at 2 fps, not clamped), so a
  2.4 s cloud is three frames. Override `scene.getAnimationRatio`: 0 freezes the
  dust, and `seconds * 60` for exactly one rendered frame (counted on
  `scene.onAfterRenderObservable`) steps the cloud to a known age and holds it.
  Also: `dust.burst()` needs a real `Vector3` (`copyFrom` reads `_x`/`_y`/`_z`, so
  a plain `{x,y,z}` silently gives a cloud at NaN), and `getActiveCount()` is the
  ring size, not live puffs.
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
  saying no. **`deathCam.start(feet, yaw, eye, forward, from, damage, crouch)` is
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
  `localStorage["hollowmere.map"]` set in an `addInitScript` before the load.** A
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
  is checked. Two readings that mean something: `localStorage["hollowmere.region"]`
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
