# FILES.md

The module map, one line per file, stating what it owns. Split out of
[`CLAUDE.md`](CLAUDE.md), which is still the source of truth — it and the
subsystem contracts under [`docs/`](docs/) that it points to carry the rules
these modules obey; this file is for finding your way to the right one.

```
server/               # The authoritative match server. Node, NullEngine, no
  index.ts            #   rendering and no canvas — see server/README.md.
                      #   Process entry: /health, /matches, the ws listener and
                      #   the match registry — which IS the lobby, because
                      #   matches live in this process. Routes a join (named,
                      #   create, or wherever there is room), caps how many
                      #   matches exist, and holds the pong deadline every
                      #   socket in the process is swept against. Owns no
                      #   game rules
  Match.ts            #   One match: fixed-step loop, snapshots, the gates on
                      #   what a client may claim, round rotation
  claimGates.ts       #   HOW a claimed round is gated — the RateGate bucket,
                      #   the look vector, the cone, the origin slip and the
                      #   one zero-length threshold. Match's five claim arms
                      #   all call it; the SIZE of each gate stays in Match
  Roster.ts           #   The 48 slots, 16 seats, team balance, human<->bot handover
  MapVote.ts          #   The ballot for the next map: the candidates, the
                      #   per-slot tally, the tie-break. Its first candidate is
                      #   what the rotation would have picked, which is also
                      #   what an empty ballot and a tie resolve to. Owns no
                      #   transport and no timer
  HeadlessGame.ts     #   The simulation: the server's answer to core/Game.ts,
                      #   wired by the same rules. Owns the armour too — the
                      #   fleet, the bot crews and the AT kit — plus `seat`,
                      #   which is `Game.mount`/`clearVehicle` as one method
  NetPlayer.ts        #   A connected human as the simulation sees one — the
                      #   only position anything on the server trusts
  world.ts            #   Rebuilds the solid world from the baked boxes: the
                      #   collider half of MapBuilder and nothing else
  lagComp.ts          #   Position history + the rewind around a shot. `resolve`
                      #   takes a callback so the restore cannot be skipped
  wire.ts             #   Is a client message shaped like what it claims to be?
                      #   The one door a frame becomes a ClientMessage through,
                      #   so no handler past it re-checks a field
  validate.ts         #   Is a reported step physically possible? speed, ground,
                      #   solid — and nothing else. `validateDrive` beside it is
                      #   the same question for a HULL: the tank's speed bound,
                      #   and neither of the other two (see its header)
  simulate.ts         #   `npm run simulate`: a whole round, headless, no clients
                      #   — and the instrument for the TICK, which is the only
                      #   budget this process has. Times every step, files them
                      #   by bots in contact, and names the spikes
  parity.ts           #   Fingerprint dump for `npm run parity`
scripts/                      # Node tooling, run by hand or by `npm run build`,
                              #   never shipped. Plain .mjs outside both
                              #   tsconfigs. The game's own code is reached
                              #   through Vite (a dev server, a browser, or
                              #   ssrLoadModule), except the few .ts files
                              #   imported by name under Node's type stripping
                              #   (roadPaths.ts, roads.ts, rng.ts), which
                              #   therefore hold only erasable syntax. Each
                              #   header carries its argument, and package.json
                              #   says which npm script runs which file
  check-collision.mjs         # BUILD GATE, first: refuses a map whose
                              #   collision bake is older than its layout and
                              #   heights (collision-hash.mjs's hash), the
                              #   DEV-only maps included
  check-deep-imports.mjs      # BUILD GATE: refuses a deep static import into
                              #   @babylonjs/core under src/ and main.ts — the
                              #   one absolute rule tsc cannot see. server/ is
                              #   outside it on purpose
  check-audio.mjs             # BUILD GATE: audio/ stale against its masters,
                              #   over its mono-seconds budget, an encoded file
                              #   samples.ts does not load (or a url it loads
                              #   with no row), a missing output, or a doc's
                              #   count of the sounds disagreeing with the
                              #   manifest. Needs no ffmpeg
  check-proving.mjs           # BUILD GATE, last: greps dist/ and dist-server/
                              #   for the four proving-ground sentinels, so the
                              #   DEV-only map provably did not ship. Never
                              #   scans dist-server-dev/, where it belongs
  collision-hash.mjs          # The map table (MAPS, and DEV_MAPS kept apart)
                              #   and the source hash, shared by the bake and
                              #   its check so the two cannot hash different
                              #   files. A new map adds its row here
  bake-collision.mjs          # `npm run collision [-- <map>]`: builds each map
                              #   in a real Chromium against the dev server and
                              #   writes src/world/<map>/collision.ts — the
                              #   boxes the authority rebuilds its world from,
                              #   stamped with the hash the gate checks
  check-world-parity.mjs      # `npm run parity`: the world the server rebuilds
                              #   from the bake against the one a browser
                              #   builds, compared by NAV GRAPH
                              #   (world/fingerprint.ts) rather than by box. The
                              #   DEV-only maps cost a second, dev-mode server
                              #   build
  capture-map-shots.mjs       # `npm run shots`: photographs each map from its
                              #   ui/mapShots.ts vantage into shots/<id>.avif,
                              #   the menu's backdrop — no HUD, no bodies, the
                              #   lamps lit, the scene READY. HEADED, and needs
                              #   a real GPU
  dev-server.mjs              # Starts a Vite dev server for the browser-driven
                              #   scripts (and plans/webgpu-ref/) and reliably
                              #   stops it: node on vite.js, never npx or the
                              #   .bin shim, which orphan the server
  browser.mjs                 # launchClient — the Chromium those scripts
                              #   drive, and the two WebGPU facts a bare launch
                              #   gets wrong (the flag, and the full binary
                              #   rather than the headless shell). A script
                              #   timing out on window.__celshock is read here
                              #   first
  kit-hash.mjs                # `npm run kit:hash`: fingerprints every kit
                              #   builder over every placement, and every
                              #   scatter prop over fixed seeds and foliage
                              #   rungs, under a NullEngine — the DRAWING and
                              #   the COLLIDERS hashed apart, so a refactor
                              #   proves it moved nothing. `--feet` measures the
                              #   kinds against lib/footprints.mjs. Not a gate
  loc.mjs                     # `npm run loc`: how big the project is, off `git
                              #   ls-files` — hand-written code split into
                              #   code, comment and blank, apart from the map
                              #   data, the generated bakes and the docs. Not a
                              #   gate
  encode-audio.mjs            # `npm run audio`: cuts and encodes every master
                              #   in audio/manifest.json, writing back the two
                              #   fields check-audio.mjs reads (sourceHash,
                              #   decoded). The cut is the manifest's, never
                              #   the master's. Needs ffmpeg
  measure-audio.mjs           # `npm run audio:measure`: where the numbers in a
                              #   trim come from — envelope, bands, width, sum,
                              #   onset, room, over the CUT — and `--decode`,
                              #   which boots the game and asks whether every
                              #   row decoded. Decides nothing
  ffmpeg.mjs                  # The one place ffmpeg is found and run, and
                              #   MASTER, the rate and depth audio/src/ claims —
                              #   shared by the two audio scripts
  generate-icons.mjs          # `npm run icons`: the PWA icons in public/icons/,
                              #   the HUD's flag hexagon in amber, PNGs encoded
                              #   by hand with zlib. Deterministic
  generate-water-textures.mjs # `npm run textures`: the water's foam mask,
                              #   textures/water-foam.png, seeded through
                              #   world/rng.ts. The normal map is not coming
                              #   back
  generate-proving-ground.mjs # `npm run proving`: the DEV-only proving ground
                              #   (src/world/proving/), ENGINE_UPGRADE.md S0's
                              #   load. `--play`/`--margin` pick the variant.
                              #   Not a level
  generate-hollowmere.mjs     # `npm run hollowmere`: SEEDS the night village's
                              #   layout.ts and heights.ts — the design
                              #   authored, the transcription CHECKED (nothing
                              #   in the water, on a road or on a slope, every
                              #   door onto somewhere). Re-running discards
                              #   editor edits, and owes the collision rebake
                              #   of that map and `npm run parity`. `--probe`,
                              #   `--refusals`, `--claims`, `--dry`
  generate-greyfen.mjs        # `npm run greyfen`: the same for the jungle
                              #   valley, plus `--at`/`--point` (the floor over
                              #   a box or at one spot) and `--stands` (how the
                              #   forest fitted)
  generate-coldharbour.mjs    # `npm run coldharbour`: the same for the town on
                              #   the bay. `--probe`, `--refusals`, `--claims`,
                              #   `--dry`
  generate-harrowmead.mjs     # `npm run harrowmead`: the same for the farming
                              #   vale, a road crossing the brook only where it
                              #   fords. `--probe`, `--refusals`, `--claims`
  generate-sarab.mjs          # `npm run sarab`: SEEDS the desert town — dunes,
                              #   the districts flattened, the wadi cut. Its
                              #   header argues why a map is seeded at all
  generate-cinderhaven.mjs    # `npm run cinderhaven`: SEEDS the volcanic
                              #   island, where the FLOOR is the level — five
                              #   passes in order, the waterfront derived from
                              #   where the ground meets the sea. `--probe`,
                              #   `--roads`
  generate-kurenai.mjs        # `npm run kurenai`: SEEDS the temple valley,
                              #   240 m. `--probe`, `--plan`, `--refusals`
  lib/mapgen.mjs              # What the seven generators share: the seeded
                              #   stream (world/rng.ts's mulberry32), the
                              #   floor's noise, the placement arithmetic, the
                              #   text a layout is written in, and the two
                              #   printers. A helper needing a generator's state
                              #   is a FACTORY; a change owes every map
                              #   regenerated byte-identical
  lib/footprints.mjs          # FOOT, LITTER, DOOR_FACES/FRONTS and stairRun:
                              #   the ground each kit kind takes and its ways
                              #   in, for every generator and the map-layout
                              #   skill. MEASURED off the builder by
                              #   `npm run kit:hash -- --feet`, and an edit
                              #   re-seeds every map it moves
index.html          # The head, and NO interface CSS beyond the two things shown
                    #   while there IS no interface: a black background (so a
                    #   dev reload does not flash white) and the boot screen —
                    #   a title screen for the game in the menu's frame, its
                    #   unit and plates COPIED from base.css/overlay.css, on
                    #   the interface's own glows (no picture: the map shots
                    #   are hashed, and a drawn one read as clip art).
main.ts             # Bootstrap. Imports src/ui/base.css FIRST. Awaits the two
                    #   things the game cannot start without — the WebGPU device
                    #   and the Havok WASM — then builds the Game, which takes
                    #   both as arguments. Owns the boot screen: names each
                    #   await on its load plate, paints before the constructor,
                    #   fades it on the first drawn frame, or fills plate and
                    #   note with one of the four failures.
vite.config.ts      # The client build, and the two plugins only it can hold:
                    #   the DEV-only layout writer the editor saves through
                    #   (WRITABLE, the literal table of files it may write —
                    #   three per map) and the build-only service worker
                    #   substitution (src/pwa/sw.js's PRECACHE, split
                    #   immutable/mutable, into dist/sw.js). Also: never
                    #   inline a sound, and optimizeDeps.exclude for Havok.
                    #   Outside tsconfig's include, so it stays thin
vite.server.config.ts # Builds server/ into dist-server/, for
                    #   `npm run build:server` and `simulate` — and with
                    #   `--mode development` into dist-server-dev/ with
                    #   import.meta.env.DEV forced true, the only way the
                    #   authority runs the proving ground (`simulate:dev`)
public/             # Copied to dist/ VERBATIM — unhashed URLs named by hand
                    #   (manifest.webmanifest, icons/ from `npm run icons`).
  profile_viewer.html # Where a frame-profiler capture is READ: paste or drop a
                    #   KEEP/SAVE report or a TRACE and get the phase
                    #   attribution, the heap and collector, and a verdict on
                    #   every slow frame. Served from the game's own origin so
                    #   the loop closes on the DEVICE that is slow. One file,
                    #   no imports, no network, never typechecked — the sw.js
                    #   arrangement. It is the SECOND navigable document, so
                    #   its path is in sw.js's DOCS or it becomes the game
                    #   offline. docs/profiling.md is the contract
  regions.json      # Which match servers this deployment offers, by host. The
                    #   one file a deployer edits on the box: adding, moving or
                    #   draining a region is not a rebuild. no-cache in nginx
                    #   and exempt in the service worker, for that reason.
                    #   docker-compose.prod.yml bind-mounts the box's own copy
                    #   over this one, which is what makes "on the box" true
src/
  vite-env.d.ts     # `/// <reference types="vite/client" />` and nothing else:
                    #   what types import.meta.env and Vite's asset imports
  config/           # ALL tunable constants (no magic numbers in code).
                    #   One module per subsystem; import `CONFIG` from "…/config"
    index.ts            # Composes CONFIG from the sections. The ONLY importer of
                        #   them. A new tunable goes in a section, not here
    fogWall.ts          # FOG_WALL alone — bots.ts reads it, so it cannot live in
                        #   index.ts without an import cycle. The DEFAULT view
                        #   distance now: a map's `fogEnd`, or its
                        #   `bodyDrawDistance`, overrides it, and Game.installMap
                        #   resolves ONE number into the three body gates
    conquest.ts         # Flags, capture meter, tickets, bleed
    score.ts            # What a kill, a bonus and a flag are worth on the
                        #   board. Spent by both simulations, so a value here
                        #   moves the offline round and the authority together
    bots.ts             # Bot AI + the nav grid (bots, nav)
    player.ts           # Movement, crouch, ground probe, vitals
    weapons.ts          # The weapon table, the round, gunfeel (weapons, combat,
                        #   gunfeel). `boltCycle` is the one field here that
                        #   decides a GESTURE rather than a rule; `modes` is
                        #   the fire selector and `modes[0]` is what every
                        #   figure in the table is quoted in
    recoil.ts           # What a shot does to the aim: the per-shot kick, the
                        #   string's envelope and sweep, recovery, stance
    sights.ts           # The optic table — its ORDER is the loadout row, and
                        #   `eyeRelief` has to RISE with magnification or the
                        #   camera's near plane clips the eyepiece open
    viewmodel.ts        # Where the weapon sits in front of the camera
    glass.ts            # Breakable glazing: the sweep's cap, the shard pool,
                        #   the size band a piece is cut to and how far one is
                        #   worth simulating
    grenade.ts          # The throw, bounce, fuse and blast — including the
                        #   eight layers the blast is DRAWN as, quoted for the
                        #   grenade, which every other explosion scales off
    molotov.ts          # The other throwable: the break, the fire it leaves
                        #   (radius, life, burn), how it is drawn, lit and
                        #   heard, and which bots carry one. Thrown on the
                        #   frag's arc and states none of its own
    equipment.ts        # The anti-tank slot: the launcher, the mines, and the
                        #   bots' launcher band. Two numbers per item — what
                        #   the HULL it struck takes, and the blast for
                        #   everything else — because one falloff cannot serve
                        #   a seven-metre vehicle and a one-metre body
    camera.ts           # Look, FOV, view punch, shake
    aimAssist.ts        # Controller aim assist and its three invariants
    input.ts            # Deadzones, curves, haptics — pad and phone alike
                        #   (input, rumble)
    touch.ts            # The on-screen controls: the stick's shape and a fixed
                        #   stick's reach, what a drag does to the aim,
                        #   aim-on-fire's two numbers, the gyro's gain and
                        #   filters, and how long a
                        #   synthesized mouse event is disbelieved after a finger
    audio.ts            # Levels, distances, rolloff for the synthesized mix
    mix.ts              # The mixer, in two tiers that MULTIPLY: ten FAMILY
                        #   faders (MixGroup) and 41 SOUND faders (MixChannel),
                        #   every one 1 — a deviation, never a balance. Plus
                        #   CHANNEL_GROUPS, which is why the two are not a tree:
                        #   a weapon is ONE fader heard under both gun families.
                        #   The one config file a tool rewrites (F4)
    graphics.ts         # Render pipeline knobs + pooled effects (graphics,
                        #   effects)
    hud.ts              # Minimap, damage arcs and the pause card's refresh
                        #   in a match (minimap, damageIndicator, pauseCard)
    net.ts              # The wire's own numbers: the socket path, the
                        #   interpolation delay and clock window, the reconnect
                        #   backoff, the hit-credit window, the ping bands the
                        #   lobby colours by, and the correction snap
    profiling.ts        # The frame profiler's ring size, hitch threshold and
                        #   probe depths. Nothing here decides anything about
                        #   the game — FrameProfile is the only reader
    lighting.ts         # The dynamic light budget (uniforms, not Babylon lights)
    gi.ts               # The irradiance volume's tiers (grid, rays, budget),
                        #   the fast layer's caps and how the traced light is
                        #   banded back into the cel shader's indirect term
    world.ts            # Map extents, occlusion, water, grass (map, ao, water,
                        #   grass)
    sky.ts              # The sky (sky): the dome, the stars, the disc, and the
                        #   cloud ring's count, spread, shape and drift
    wind.ts             # The one wind: a shared bearing, and what the grass
                        #   field and the world's foliage each do with it
    teams.ts            # The two sides; index 0 is the player's
    vehicles.ts         # `VehicleSpec` — the SHAPE of one kind — plus the three
                        #   kinds themselves: the TANK, the gun TRUCK and the
                        #   HELICOPTER. Each states its hull, drive, suspension,
                        #   guns, camera and engine voice; `gun: null` and
                        #   `flight: null` are the two optional blocks, and are
                        #   what `Vehicle.armed` and `Vehicle.flies` read.
                        #   `climbHeight` decides what a vehicle drives
                        #   over and what stops it (1.25 for the tank, 0.55 for
                        #   the truck), and `resist` is where what each kind of
                        #   damage is worth is written down — a rifle 0.05
                        #   against armour and 0.45 against a soft skin, a
                        #   blast 0.3/0.7, a shell 1 either way. The fleet-wide
                        #   figures (the enter radius, the exit offset, the
                        #   respawn and wreck clocks, the AI crew) sit above
                        #   both
  core/
    Game.ts             # Orchestrator + main loop + all cross-system wiring.
                        #   Constructor is construction only; wiring is
                        #   wireSystems (+ four subject methods),
                        #   installDomListeners, wireScreens; tick dispatches
                        #   one method per screen. Holds ONE ScreenStack and
                        #   never assigns a state — go/raiseLid/lowerLid, and
                        #   takeDown for what a screen means on screen
    ScreenStack.ts      # The state machine's shape as data: GameState, the
                        #   SCREENS table (what a lid covers, what holds the
                        #   world offline, what owes the netplay frame, what is
                        #   owed the scoreboard), and the raised-lid stack. A
                        #   new state does not compile without a row
    InputManager.ts     # Keyboard/mouse + gamepad + TOUCH state, and rumble.
                        #   Three sources, one composition, one set of fields —
                        #   and the clock that says which device is in hand.
                        #   The gyro is polled here too, into its own look path
    GyroInput.ts        # Gyro aiming's sensor: devicemotion, iOS's permission
                        #   (asked from a gesture, retried on the next tap),
                        #   screen-orientation axes and PLAYER SPACE yaw off a
                        #   gravity estimate. Reports the sensor's real state
                        #   for the settings row; applies nothing
    CameraSystem.ts     # First-person cam at the eye; ADS zooms and slows by
                        #   the fitted optic, at the weapon's own rate
    cameraShake.ts      # The concussion rattle: a two-pole envelope over
                        #   smooth noise, three COSMETIC angles. One each in
                        #   CameraSystem and VehicleCamera; Game.shakeFrom
                        #   feeds whichever is running
    Sfx.ts              # Procedural WebAudio, spatialised, voice-capped —
                        #   plus SIXTEEN RECORDINGS: eight standing in for a
                        #   report, six for a mechanism the player works with
                        #   their own hands, and two for a blast, all a
                        #   preference and never a requirement. Two kinds of
                        #   SUSTAINED voice hang off the same rules and neither
                        #   is ever recorded; each is a class of its own below,
                        #   built here and reached only through Sfx's delegates
                        #   (engineOn…enginesOff, ambience…ambienceAllOff).
                        #   Owns the mixer's buses too: a dry tap into the
                        #   master and a wet tap into the convolver, per family
                        #   and again per (channel, family) PAIR, handed to
                        #   every layer helper as its FIRST argument — so a
                        #   fader reaches a sound's tail as well as its direct
                        #   sound, and moves a voice already sounding
    sfxCore.ts          # AudioCore: the whole of what Sfx lends its two voice
                        #   classes (context, noise buffer, buses, listener
                        #   distance, burst/tone, the pause flag), read live.
                        #   Plus MixBus, BurstSpec and Point. Types only
    EngineVoices.ts     # The hulls' engines: the driven hull's unpanned voice
                        #   and everybody else's in earshot, one graph
                        #   (buildEngine) for two powerplants, forked in
                        #   driveEngine because a rotor's note is GOVERNED
    AmbienceVoices.ts   # A place that makes a noise on its own (buildAmbience:
                        #   a roar, a LIST of humps, a breath and one
                        #   impulse-excited resonator per event row — nothing
                        #   scheduled, THREE kinds and no branch, and each
                        #   FITTED to a recording rather than tuned. A fire is
                        #   one hump with the events carrying the top; water is
                        #   two humps in the octaves the fire leaves empty,
                        #   with the events a garnish. docs/audio.md has both
                        #   tables). Owns the breath buffer and the spark
                        #   curves, which Sfx.playerHurt borrows
    samples.ts          # The recorded sounds: an id union and a url table,
                        #   nothing else. A weapon names a report row through
                        #   ReportVoice.sample, and so do all three hulls'
                        #   mg blocks; the reload's two, the bolt cycle's four
                        #   and the two blasts are named by Sfx itself, since
                        #   they belong to a moment, a beat or a blast rather
                        #   than to any weapon. Every url here is the OUTPUT of
                        #   `npm run audio`, and check-audio.mjs fails the build
                        #   if this file and audio/manifest.json disagree
    prefs.ts            # Remembered difficulty, map and loadout: the
                        #   localStorage round trip only. Ids that index a table
                        #   are validated, never trusted
    settings.ts         # Settings shape, defaults, localStorage. Applies
                        #   nothing — that is Game.applySettings, the ONLY
                        #   place a setting reaches whatever owns it
    PointerLockChase.ts # The pointer lock's TIMING: whether a lost lock is
                        #   the player leaving (a transition out, past
                        #   lockGrace) and when a resume's owed lock asks again.
                        #   Answers only — Game keeps requestLock and pause
    urlOverrides.ts     # The URL's session overrides of a display setting
                        #   (?gi= ?shadows= ?volumetrics= ?nominimap), read
                        #   ONCE and resolved against the setting Game hands
                        #   in; the `forced` list a capture files. Also the
                        #   URL-flag reader (?profile, ?gpu). Applies nothing
    shadowWindow.ts     # Where a directional shadow camera STANDS, and the
                        #   texel snap that stops its edges crawling. Both maps
                        #   place themselves with it — ShadowSystem's and
                        #   BodyShadows' — which is the point: two copies would
                        #   be two windows off one focus. One instance each,
                        #   never shared, since the snap is in ITS map's texels.
                        #   Also the 1x1 LIT texture a shadow map switched OFF
                        #   is bound as (a declared sampler must be bound)
    proxyBoxes.ts       # What a soldier and a hull ARE to a shadow: boxes,
                        #   packed as thin-instance matrices. RAGDOLL_BONES and
                        #   the collider, shared by BodyShadows and LocalShadows
                        #   so a body throws one silhouette under every light
    webgpuLeaks.ts      # What Babylon's WebGPU arm never gives back of a map:
                        #   a released effect's uniform-buffer pools (patched
                        #   onto the engine once, in main.ts) and the bind-group
                        #   cache (flushed by Game.teardownMap). ~30 MB heap +
                        #   ~28 MB GPU a Coldharbour build, kept for the life
                        #   of the tab before these
    teamView.ts         # Which side the player is LOOKING from: the one remap
                        #   between the authority's team INDEX and the team a
                        #   body is DRAWN and NAMED as, so every player sees
                        #   their own side as amber Valeguard. PRESENTATION
                        #   only — combat, conquest, the score and the wire
                        #   never ask. Written by Game.buildRound BEFORE
                        #   anything is built, because a kit is chosen when a
                        #   rig is merged and cannot be repainted after
    FrameProfile.ts     # Where a frame's milliseconds went, recorded
                        #   CONTINUOUSLY into a ring and captured BACKWARDS —
                        #   you feel the hitch, then press the button. SHIPS,
                        #   armed by a setting or ?profile, and costs nothing
                        #   at all while it is off. Allocates nothing while
                        #   recording (GC is what it exists to catch). Game
                        #   brackets the phases it already sequences; no system
                        #   has heard of it. Handle: `window.__profile`.
                        #   The RECORDER only: lends the ring to profileReport
                        #   at a capture
    profilePhases.ts    # The profiler's phase list (PHASES, the slot ids P
                        #   and SLOTS) and the tree it nests in (PARENT_OF,
                        #   ROOTS). Both halves read it, which is why it is
                        #   neither's — kept in either, they would be a cycle
    profileReport.ts    # What a capture SAYS: the ProfileReport shape (the
                        #   JSON the viewer reads), buildReport, buildTrace and
                        #   the stats. Allocates freely and never writes the
                        #   ProfileRing it is lent
    PipelineWarmup.ts   # Where the building card stands the camera while the
                        #   round's render pipelines are compiled, and when it
                        #   may stop: the vantages (home spawns and flags), the
                        #   quiet-frame count off Babylon's pipeline-cache miss
                        #   counter, and the cap. Decides WHEN; Game stages
                        #   each frame (WorldCulling.setWarm, the pools' warm)
    FrameCap.ts         # The frame-rate cap (Settings.fpsCap): the engine's
                        #   frame REQUESTER, refusing a refresh before the
                        #   next frame is DUE. A deadline, not Babylon's
                        #   maxFPS accumulator, which turns a 30 cap into 20
                        #   on a panel a hair over 60 Hz. Rate 0 admits every
                        #   refresh. Also the SIMULATION's clock: `elapsed` is
                        #   the gap between the refreshes that took two frames,
                        #   which Game.tick steps the world by
    frameStats.ts       # The 1% low — the mean of the slowest 1% of a sorted
                        #   sample, unit-blind and allocation-free — so the
                        #   HUD's fps readout and a profiler capture state one
                        #   statistic. Imports nothing
    math.ts             # The scalar helpers more than one file needs: clamp,
                        #   clamp01, hermite, smoothstep, angleDelta. Imports
                        #   NOTHING, which is what makes it safe to import from
                        #   anywhere — a leaf, not a path into core/. config/
                        #   holds NUMBERS a designer tunes; this holds FUNCTIONS
                        #   with none in them. `hermite` is the raw polynomial
                        #   and `smoothstep` is the GLSL one that clamps — named
                        #   apart rather than by a suffix, because `01` cannot
                        #   mean an output range, an input clamp and a
                        #   precondition at once. Nothing with a single caller
                        #   belongs here
    recoilCurve.ts      # How a shot moves a thing: RecoilShape, RecoilAxis and
                        #   recoilGain — the arrest, the haul and the shoulder
                        #   the aim and the weapon on screen both run on.
                        #   Imports nothing but math.ts
    recoilVector.ts     # What ONE ROUND does, as arithmetic: hasString, the
                        #   first-shot ramp, the stance scale, the pattern
                        #   envelope (aimKick), the lateral sweep (sweepDrift),
                        #   the kick weight, the punch shock, the kick shape
                        #   for a stance and the action's two beats. No state
                        #   and no random draws — Player holds the string and
                        #   draws, and Player.recoilKick is still the one door
  entities/
    Player.ts           # Movement, sprint, crouch, jump, weapon state
    HealthRegen.ts      # A person's regen: the lock after a hit and the curve
                        #   back to full. One held by Player (predicting) and
                        #   one by server/NetPlayer (authoritative), so the two
                        #   heal to the same cap at the same rate
    stance.ts           # The crouch's geometry: the eye and the hit sphere's
                        #   centre above the feet for a blend, and the blend's
                        #   easing. One copy for all five bodies that crouch
                        #   (Player, Bot, NetSoldier, server/NetPlayer, the
                        #   death cam's corpse), so the eye and the sphere
                        #   cannot come down apart
    ViewModel.ts        # The first-person weapon: carried gun + gloved arms
                        #   (faceted, in the viewer's own kit) on the camera, hip/ADS/sprint/reload/muzzle-load, sway,
                        #   bob, and
                        #   the kit turntable with the dark card behind it,
                        #   fitted to the BAY the kit screen reports.
                        #   Builds every weapon, enables one
    ReloadGesture.ts    # The reload decided, not drawn: a pure function of
                        #   phase, seconds and dry/tactical giving the weapon's
                        #   curve and its impact rings, both hands, both
                        #   magazines (the spent one a clone), the bolt or
                        #   slide, and the head looking down at the work.
                        #   ViewModel draws it on a BODY node that takes
                        #   the inverse of that look
    weaponKit.ts        # The build accumulator every weapon model is written
                        #   in + WeaponParts and WeaponSights (rail, or fixed),
                        #   the ReloadSpec a model declares (its pose, and the
                        #   catch/handle/bolt/slide a dry reload closes),
                        #   and the five colour groups a weapon merges into —
                        #   which are also what a finish repaints — and the
                        #   primitives: box, slab, upright, picatinny, shell
    RifleModel.ts       # Low-poly SCAR-H battle rifle — the first
                        #   weapon SCULPTED rather than stacked: bevelled
                        #   profile slabs and contoured lofts, the design
                        #   language the rest of the kit is to follow
    CarbineModel.ts     # Bullpup burst carbine, a FAMAS drawn from photos
                        #   in the rifle's design language — magazine behind
                        #   the grip, the rail on top of the carry handle over
                        #   an OPEN window, a scalloped handguard, a grenade-
                        #   sleeve muzzle. The second model whose BORE is not
                        #   y = 0: the barrel is screwed into the chamber the
                        #   ejection port is cut in
    SmgModel.ts         # The SMG, a SIG MPX drawn from photos in the
                        #   rifle's design language — AR flat-top, M-LOK
                        #   handguard to the hider, flared magwell ahead of
                        #   the guard, slim 9mm magazine, and SIG's long
                        #   minimalist folding stock (reference-media/smg.png)
    DmrModel.ts         # Semi-auto marksman rifle, an HK G28 / M110A1 drawn
                        #   from photos in the rifle's design language — long
                        #   slotted handguard, exposed buffer tube, tall stock
                        #   with a cheek flap, windowed straight magazine
    SniperModel.ts      # Bolt-action sniper rifle, an Accuracy International
                        #   AXMC drawn from photos in the rifle's design
                        #   language — an action wrapped around the BORE, a
                        #   drilled forend, a triangulated folding stock, and
                        #   the BOLT in a node of its own so the cycle works it
    LmgModel.ts         # Belt-fed light machine gun, an FN M249 / Minimi
                        #   drawn from photos in the rifle's design language —
                        #   stamped riveted receiver, feed cover and split
                        #   rail, deep ribbed handguard, fixed humped stock,
                        #   200-round box with the brass belt, folded handle
    PistolModel.ts      # Sidearm, a Colt M45A1 (the modern 1911) drawn from
                        #   photos in the rifle's design language — the one
                        #   weapon that does not call optics.ts: its notch and
                        #   blade are its own and are all it ever wears, on a
                        #   slide that is a node of its own so a dry reload
                        #   can hold it back on the stop
    optics.ts           # Every optic assembly, built onto whichever weapon's
                        #   OpticMount asked for them. Past ~4x the cone is
                        #   bounded by the SCREEN rather than by the rail, which
                        #   inverts how a new one is solved
    weapons.ts          # WeaponId + WeaponSetup + FireMode (the fire selector
                        #   resolved), + SIDEARM/PRIMARY_WEAPON_IDS
    sights.ts           # SightId + magnification -> FOV, sensitivity, zoomComp
    equipment.ts        # EquipmentId + the resolution of an AT item into an
                        #   ordinary WeaponSetup (no fall-off, no spread, no
                        #   reload, `magSize` IS a life's ammunition) and into
                        #   the OrdnanceEffect a detonation is spent through —
                        #   and `resolveOrdnance`, the one place it is spent,
                        #   called by both simulations
    throwables.ts       # ThrowableId (frag | molotov), the kit order, and the
                        #   pouch size every side asks — the throwable slot's
                        #   `equipment.ts`, with no WeaponSetup behind it
    finishes.ts         # FinishId + the sixteen colour schemes, every one of
                        #   them offered on every weapon, and the repaint over
                        #   its colour groups. The one kit table that decides
                        #   nothing
    Combatant.ts        # Team + the shared shootable/shooter interface
    Vehicle.ts          # ONE hull of any KIND: the collider (the only MOVING
                        #   `solid` mesh in the game, and invisible to the nav
                        #   graph for the reason a corpse is), the drive, the
                        #   ten GROUND CONTACTS it stands on and the
                        #   rate-limited climb that rides it over a car, the
                        #   leading-end collision sphere, the turret's slew,
                        #   BOTH guns' clocks and angles (the second seat's gun
                        #   holds a WORLD bearing exactly as the turret does,
                        #   which is what lets the two seats aim
                        #   independently), which of its two SEATS are filled
                        #   and `chooseSeat` (which one a person gets — the
                        #   driver's first, one rule for both processes),
                        #   the ground half of its lean, `rideableAt` (the
                        #   climb band spent on
                        #   where the hull is ABOUT to be, which is the whole
                        #   of an AI driver's road graph), and what a hull
                        #   feels of each DamageKind. Takes a `VehicleSpec` and
                        #   a rig BUILDER and knows no kinds; `armed` and
                        #   `flies` are the only two questions anything asks
                        #   about one. It also FLIES, on a hull that states a
                        #   `flight` block — and `standOnGround` has never heard
                        #   of that: what a rotor does to the ground model is
                        #   `lift`, an addend that is 0 on anything else, so a
                        #   hover is an equality and the plank is a landing
                        #   floor. Knows nothing about a player
    HullFlex.ts         # What a hull's own mass does to its DRAWING: the
                        #   sprung body's pitch, roll and heave springs on one
                        #   travel budget, the rate the mast feet turn at, and
                        #   the two whips in the wind. Writes `rig.sprung` and
                        #   the antennae and nothing else; handed the drive's
                        #   acceleration, the ground's jolt and the gear's load
    FlightModel.ts      # The rotor, for a hull whose spec states `flight`:
                        #   the spool, the disc's commanded attitude, the
                        #   cyclic, thrust and collective, and the attitude a
                        #   hull on the wire is drawn at, worked back out of
                        #   its motion. Owns no position or velocity — those
                        #   stay `Vehicle`'s and are handed in
    vehicleKinds.ts     # The list of kinds that exist, and the ONE place a
                        #   kind becomes a name, a spec and a model. A map's
                        #   `VehicleSpawnDef.kind` is resolved here, and the
                        #   default (a tank) is written down once
    vehicleRig.ts       # What every vehicle's MESH is: the joints `Vehicle`
                        #   writes, the three extents the physics needs off the
                        #   drawing (gauge, contact reach, wheel reach), and
                        #   the three CLOSURES a model hands back — `setRun`,
                        #   `reset`, `paint`. `setRun`'s FOURTH argument is the
                        #   rotor, for the reason its third is the steer: a
                        #   tracked hull's powerplant is already in the first
                        #   two figures and a rotor is not. Plus `Box`/`Cyl`,
                        #   the per-colour merge and the outline pass every
                        #   model draws with, the one whip builder (`whip`)
                        #   and the one `reset` (`resetRigPose`) all three
                        #   kinds share. No geometry and no numbers
    TankModel.ts        # ~180 boxes and cylinders merged to twenty-five, with
                        #   a SPRUNG body over running gear that is not, a
                        #   turret and a gun that turn, a CUPOLA gun on a ring
                        #   that turns independently of both, two link strips
                        #   and a toothed sprocket a side that RUN, two whip
                        #   antennae that BOW, and the charred repaint a wreck
                        #   takes.
                        #   Art only — the extents that are RULES are CONFIG's
    TruckModel.ts       # The gun truck: a CLOSED armoured 4x4 drawn off the
                        #   Oshkosh JLTV — arches cut out of an extruded body,
                        #   a clamshell hood, a V belly over four independent
                        #   corners, a framed split windscreen, a tarped bed —
                        #   with a REMOTE weapon station on its roof (a sensor
                        #   head and a chute; no pintle, no grips, nowhere to
                        #   stand — there is no player model to put there),
                        #   four wheels that TURN and two that STEER, two long
                        #   whips on the bed's rear posts, and the same charred
                        #   repaint. Nothing may stand on the roof inside the
                        #   station's sweep; the muzzle clears it by 6.7 cm at
                        #   full depression.
                        #   NO main gun — `VehicleRig.gun`/`muzzle` are null,
                        #   which is what `Vehicle.armed` reads. Art only
    HeliModel.ts        # The helicopter: a tandem attack helicopter on skids
                        #   drawn off the AH-1Z Viper — a lofted fuselage, a
                        #   framed stepped canopy, the nose sensor ball, the
                        #   doghouse, two nacelles into IR suppressors, stub
                        #   wings with a rocket pod and a Sidewinder each, and
                        #   a CHIN turret rather than a door gun (the truck's
                        #   rule — nothing may promise a body standing at it).
                        #   Two whips on the boom are its one non-rigid part.
                        #   `gun`/`muzzle` null and `turret` an INERT node,
                        #   so `aimMg` needs no branch. Both discs turn off
                        #   `setRun`'s FOURTH argument, and the transmission's
                        #   gear ratio lives here because it is a drawing
                        #   decision. No tip-path ring: `inkRig` makes anything
                        #   that thin nearly all ink, and a hoop round a parked
                        #   aircraft reads as a cage. Art only
    callsigns.ts        # What to call an AI on the scoreboard: roster index ->
                        #   phonetic name, derived on both sides, never sent
    Bot.ts              # Bot FSM (advance/hunt/engage/takeCover/suppressed/
                        #   retreat/capture) + movement, aim, magazine, peek
    BotMemory.ts        # One bot's decaying picture of the fight
    SquadRadio.ts       # One TEAM's board: its squads' contact calls and the
                        #   marks its own deaths leave. Cues, never targets
    BotSkill.ts         # skill scalar -> BotProfile; difficulty tiers
    SoldierModel.ts     # Merged bot rig + the per-team kit it is painted and
                        #   shaped in + the procedural poser (a SoldierPose:
                        #   gait any way, aim, twist, crouch, the rifle's kick,
                        #   carry and reload, arms IK'd onto it), and the
                        #   RagdollSubject interface
    SoldierMotion.ts    # One body's motion turned into a SoldierPose: gait
                        #   phase and stepLength, velocity in the feet's frame,
                        #   kick, reload, ready. Bot and NetSoldier drive the
                        #   same one the same way
    facet.ts            # The faceted LOFT (chamfered cross-sections joined;
                        #   `loftAlongZ` lays one down a fuselage), the
                        #   bevelled SLAB (a side profile extruded, concave
                        #   allowed), the convex SOLID between two faces and a
                        #   ROD laid at any angle, all shaded flat and merged
                        #   beside boxes. The soldier and its rifle are cut
                        #   from the loft, the first-person rifle from both;
                        #   the slung launcher is still boxes
    NetSoldier.ts       # Somebody else, drawn from the wire: one rig, the
                        #   interpolation buffer behind it, the gait its boots
                        #   are heard off, no behaviour at all
    GrenadeModel.ts     # What a grenade looks like — body, fuse pip, and the
                        #   blink that reads the fuse. Built by the system that
                        #   simulates them and by the one that only draws them
    MolotovModel.ts     # What a molotov looks like — bottle, neck, and the lit
                        #   rag that is its tell. Built three ways: the pool, the
                        #   wire's ghosts, and the viewmodel's fist
    RpgModel.ts         # The launcher on the shoulder and the rocket that
                        #   leaves it. Built from its VENTURI, not its middle,
                        #   the one weapon with a `hipYaw` of its own, and the
                        #   one whose loaded ROUND is a node that comes out
    MineModel.ts        # The mine in the hands and the plate in the road. The
                        #   one thing in the kit that is not a weapon at all
  systems/
    BattleSystem.ts     # Bot pool, AI scheduling, LOS, distance LOD
    ConquestSystem.ts   # Flags, meters, tickets, bleed, spawns, planSquads,
                        #   what a bot's flag means to it (`zoneFor`), and
                        #   `scatterSpawn` — both simulations ask all three
    ScoreBook.ts        # The round's board: points, kills and deaths, one row
                        #   per roster SLOT. A ledger, not a system — no update,
                        #   reaches nothing. One per simulation (Game offline,
                        #   HeadlessGame on the authority), and `awardKill` and
                        #   `awardZone` are the one place each that a payout's
                        #   shape is decided — both sides call the same two
    killRules.ts        # `settleKill`: the killer's row, then the victim's door
                        #   if a bot fell. Every door onto a kill, both sides,
                        #   goes through it, against each side's `KillLedger`.
                        #   Also `DeathCause`, the vocabulary simulate files
    hullRules.ts        # What a hull does, once for both simulations: the main
                        #   gun, the cupola gun, the tracks (`crushSweep`), the
                        #   driver a crush is credited to, and a crew's death.
                        #   No picture — Game draws off what the guns return;
                        #   each side hands in a `HullRules` context
    CaptureZoneSystem.ts# Flags drawn in the world: ring, skirt, flag on its pole
    FlagCloth.ts        # One flag: the pole and a Verlet cloth flown in the wind
    BulletMarks.ts      # The holes a round leaves behind: a ring of pooled decal
                        #   quads, cel-lit so a mark belongs to the wall on
                        #   every map, and stood on the STATIC world only
    CombatSystem.ts     # Hitscan, fall-off, the head zone; pooled tracers, sparks, impacts
    GrenadeSystem.ts    # The one thing that isn't hitscan: the flight, the
                        #   fuse, the molotov's fire, and the ground probe
                        #   under a blast. `blastAt` is the one blast in the
                        #   game and `drawBlast` the one place one is drawn
    BlastFx.ts          # Six of a blast's eight layers, DRAWN: flash,
                        #   fireball, surge, sparks, burning trails and column,
                        #   every one a billow in BlastShader. One thin-instanced
                        #   mesh per blast, motion in closed form. Client only
    AntiTankSystem.ts   # The AT kit in the world: the rocket pool (the SECOND
                        #   thing that isn't hitscan), the mine pool, the arm
                        #   clocks and the hull trigger. Owns no blast and has
                        #   never heard of a tank — it asks `hullNear` and
                        #   announces `onDetonated`, and Game spends both.
                        #   `launchToward` is a bot's rocket at a POINT
    GlassSystem.ts      # Breakable panes: the segment sweep and the break —
                        #   the visual, the collider, and the nav graph with
                        #   the fields over it, all on the frame it happens.
                        #   The one mutable thing in the world, monotonically
                        #   so, and every CLEARED pane comes out of the list
                        #   `openBox` re-severs against or a second break puts
                        #   the first one's wall back
    PhysicsWorld.ts     # The ONLY Havok in the game: the plugin, the map as
                        #   one static body per 48 m block (a single compound is
                        #   quadratic in its shapes), and the fixed-step clock.
                        #   Owns no bodies — its three clients do. Exports
                        #   loadHavok(), which main.ts awaits before there is a
                        #   Game
    RagdollSystem.ts    # Corpses under that engine. One refusal left (past the
                        #   fog wall); a full pool evicts its oldest. Cannot
                        #   tell a dead bot from the player's stand-in
    DebrisSystem.ts     # Glass shards under it. A burst is CUT from the pane's
                        #   own face along the cracks a round put in it; refuses
                        #   past its own apparent-size gate, and evicts only a
                        #   burst that has already landed
    BlastDebrisSystem.ts# The two blast layers that outlive the fire, and the
                        #   THIRD Havok client: the rubble a detonation throws —
                        #   keyed on what it went off ON, so a crater turns up
                        #   that map's own subsoil or pale stone — and the
                        #   scorch it leaves, a decal that MULTIPLIES the ground
                        #   rather than painting a colour onto it. A chunk's
                        #   size and shape are decided at construction, so a
                        #   burst never touches the WASM heap
    glassFracture.ts    # The crack pattern itself: radials out of the hole,
                        #   concentrics across them, clipped to the frame. Pure
                        #   arithmetic — no Babylon, no state
    puffTexture.ts      # The one puff in the game, drawn at runtime: three
                        #   overlapping gradients, no image file. The rotor's
                        #   ring is its one user now the blast is billows.
                        #   Needs a canvas, so nothing on the server reaches it
    RotorWash.ts        # What a helicopter does to the surface when it comes
                        #   down: TWO standing GPU emitters per rotor on the
                        #   field — dust and SPRAY — with `emitRate` driven off
                        #   `Vehicle.washTo`, the disc's power against its skid
                        #   clearance, and 0 for anything that does not fly.
                        #   BlastDust's fountain twin: nothing is spawned,
                        #   nothing is scheduled, and a machine that is high,
                        #   dead or spooled down is one emitting at a rate of
                        #   zero. WATER picks which ring runs rather than
                        #   silencing both, and `washTo` is asked a SECOND time
                        #   with the surface as its floor, because the skyline
                        #   under a machine over a bay is the bed. It also
                        #   publishes the wash SITES the water's own shader
                        #   draws the hole and the rings from. A puff fades IN
                        #   as well as out, which is a colour GRADIENT and is
                        #   why a ring is coloured when it is BUILT — see
                        #   `paint` for the before-the-first-render rule that
                        #   makes that safe here and not in BlastDust, and for
                        #   why the spray's pair is LIT on the way in and the
                        #   dust's is not. Client only
    DeathCam.ts         # The player's own death; the only occlusion pick
                        #   outside combat
    VehicleSystem.ts    # The armour on the field: one hull per hardstanding, the
                        #   wreck clock and the respawn clock (two, so a side can
                        #   never field both), which hull a boarder may get
                        #   into, and where a dismount lands. Owns
                        #   no player and no AI — `update` asks a `VehicleOrders`
                        #   four questions per hull: who is at the sticks, who
                        #   is on the cupola gun, and which of the two somebody
                        #   ELSE is deciding. `Game`/`HeadlessGame` are
                        #   the only things that can answer. A `predicted` fleet
                        #   is a netplay client's: both clocks stand down
    VehicleCamera.ts    # The view from twelve metres behind a hull: its own yaw
                        #   and pitch, its occlusion pull-in, and the gun's kick.
                        #   `DeathCam`'s shape — it produces an eye and a look
                        #   and `Game` hands both to CameraSystem.place. `aim`
                        #   and `place` straddle the world step on purpose
    VehicleCrew.ts      # The bots that crew: which body is in which SEAT of
                        #   which hull, and what it asks of the thing in its
                        #   hands. TWO per hull — a driver and a gunner, two
                        #   brains with two target sets, the gunner seeing
                        #   INFANTRY only and firing in bursts because a
                        #   machine gun cannot hurt armour. A crewed bot leaves
                        #   `Bot`'s FSM entirely (`BattleSystem.aside`) and
                        #   keeps its life, its position and its squad's order.
                        #   Steers on the body flow field for a BEARING and on
                        #   `Vehicle.rideableAt` for what is a wall; a PILOT is
                        #   that sentence one axis up (crewPilot.ts). `evict`
                        #   is what stops the AI holding a side's only armour
    crewPilot.ts        # The bot at the sticks of a hull that flies: a bearing
                        #   off the same flow field (`route`, both seats ask
                        #   it) and a HEIGHT off `Vehicle.aloftAt`, out of one
                        #   fan walk. Answers an obstacle by climbing before it
                        #   answers by turning; holds its heading at a rate.
                        #   No state of its own — it lives on the `Crew`
    AimAssistSystem.ts  # Gamepad-only: outer bubble slows the stick, inner one
                        #   rotates. Bounded by the player's own turn rate
    LightingSystem.ts   # Dynamic point lights: fixtures, flashes, lamps. A
                        #   light is FAST (its bounce re-traced every frame)
                        #   or slow (averaged) — see GiVolume
    GiVolume.ts         # The irradiance volume: bounce light, sky occlusion
                        #   and lamps that stop at walls. A camera-centred,
                        #   toroidally scrolled window of probes traced in
                        #   compute against the colliders; seven 3D textures
                        #   every cel material binds, always. No draw calls.
                        #   Same ray set every update, so a still scene
                        #   converges to a fixed point instead of crawling
    AmbienceSystem.ts   # Where the world makes a noise on its own: the emitter
                        #   registry MapBuilder fills, and the nearest-first
                        #   ranking that spends CONFIG.audio.ambience.maxVoices
                        #   on it. LightingSystem's problem in a different
                        #   currency. An emitter is a PLACE or a RUN of them
                        #   scored on whichever is nearest — a fire is a point
                        #   and a shore is a line — and its INDEX is the key
                        #   Sfx holds a graph on, so add()/addRun() only append
                        #   and clear() is the only thing that renumbers
    ShadowSystem.ts     # Moon shadow map (stepped) + blob shadows. The STATIC
                        #   world's casters, re-rendered only when the
                        #   texel-snapped focus moves
    BodyShadows.ts      # The BODIES' shadow map: soldiers and hulls and nothing
                        #   static, re-rendered every frame, its own tighter
                        #   window (4.7 cm texels against the world's 5.4).
                        #   Every proxy is a thin instance of ONE unit box — a
                        #   soldier is RAGDOLL_BONES, a hull is its collider —
                        #   so the pass is one draw whatever the roster. Back
                        #   faces only, or a body is drawn inside its own
                        #   caster. Read by celShadow and by the volumetric
                        #   march, which is what makes a soldier cut a beam
    LocalShadows.ts     # The LAMPS' shadows: one depth atlas, six cube-face
                        #   tiles per point light and one per spot, reached by
                        #   every cel/grass/water material through ONE binding.
                        #   A fixture's world meshes are baked once into a
                        #   static tile; bodies, hulls and every MOVING light's
                        #   colliders are box proxies redrawn each frame in one
                        #   draw. The vertex stage maps each face into its own
                        #   tile, so one pass fills many
    LightningStrikes.ts # When lightning strikes, from where, how bright: a
                        #   seeded SCHEDULE read off a clock (the authority's
                        #   in a match; offline its own, which holds with the
                        #   world), never a timer. Owns the map's flash colour.
                        #   Game spends the flash
                        #   on its own key term and shadow map (drawn once per
                        #   strike), the sky and the volume's sky fill; onStrike
                        #   is the thunder
    ReflectionSystem.ts # The world as glass sees it: one cube per GLAZED
                        #   BLOCK, baked from the map's own geometry per
                        #   install with whatever encloses the probe left out,
                        #   and the box the shader parallax-corrects the
                        #   mirrored ray against. The only render target here
                        #   besides the shadow map. The bake is spent a budget
                        #   of draws per FRAME, under the loading card, and
                        #   each face draws only what that face can SEE
    Atmosphere.ts       # Ash field on the GPU, simulated by a compute shader.
                        #   No CPU fallback — WebGPU is a hard requirement and
                        #   guarantees it
    Sky.ts              # Generated dome, textured moon, and the cloud RING —
                        #   one merged mesh of faceted masses standing in the
                        #   world over the map, drawn back to front at one
                        #   shared depth 7 km out (the disc stands at 9 km)
    cloudMasses.ts      # The cloud ring's SHAPE: cumulus heaps, banks and
                        #   puffs of round lobes on flat bellies, buried facets
                        #   dropped, as one triangle soup carrying the facet
                        #   normal and a smooth one blended toward the whole
                        #   cloud's dome. Pure arithmetic — no Babylon, no state
    cloudShadow.ts      # The clouds' SHADOW on the ground: each lobe cast along
                        #   the key onto one plane in KEY space, written as a
                        #   field a slice at a time for Sky to crossfade and
                        #   celCloud to cut. Pure arithmetic — no Babylon
    WorldCulling.ts     # How much of the map the frame's own mesh walk is
                        #   offered. Replaces scene.getActiveMeshCandidates and
                        #   writes NOTHING onto a mesh, which is what leaves
                        #   every ray, the shadow map, every cube probe and
                        #   moveWithCollisions unable to tell it ran. A collider
                        #   is never a candidate, a mesh carrying metadata.block
                        #   is one inside the map's fogEnd, everything else
                        #   always is
    WaterSystem.ts      # Water surfaces from map WaterRects; bakes their bed depth
                        #   and stands the one wave GRID under the eye (`follow`,
                        #   pushed from `tick` in every state). `setWash` is the
                        #   rotor sites, pushed from `tick` and not from the
                        #   camera tail — see it for why
    GrassSystem.ts      # The grass field stood around the EYE: patches of
                        #   blade seeds chosen per frame in view (`follow`,
                        #   pushed from `tick` in every state), each drawn from
                        #   the smallest prefix mesh that holds the blades it
                        #   keeps, and the TURF sheet under them. Cost is what
                        #   is in view, never the map's grass area
  dev/                  # Dev-only tools that are not the editor. Same rule:
    mixer/              #   dynamically imported, never on the static graph
      index.ts          #   The F4 audio mixer: a slider per family and per
                        #     sound, live, over a round that carries on
                        #     underneath. Owns the collapse state, the
                        #     auditions, and mute/solo — which are per TIER,
                        #     and the PANEL's rather than the file's
      source.ts         #   Reads config/mix.ts off /__layout, patches the
                        #     value lines inside each table's own block, posts
                        #     it back. Refuses rather than writing partially
      mixer.css         #   Imported by index.ts so it rides the same chunk
  editor/               # Dev-only map editor (F2). Dynamically imported —
    index.ts            #   never statically imported from anywhere, or it
    EditorCamera.ts     #   lands in the production bundle
    EditorPanel.ts
    panel.css           #   Imported by EditorPanel so it rides the dynamic
                        #   chunk. Never link it from HTML
    workLight.ts        #   Brightened EnvironmentSpec for authoring
    selection.ts        #   SelectionRef, predicate pick, highlight
    proxies.ts          #   Stand-ins for flags/spawns/scatter/water/grass
    gizmos.ts           #   Move + Y-rotate handles, snapping
    pathHandles.ts      #   A path road's point/insert/extend handles and the
                        #     bendPath preview a point drag reads against
    mutate.ts           #   Layout writes: transform, fields, add/delete, and a
                        #     path road's points (move/insert/delete/recentre)
    fields.ts           #   FieldSpec + the key conventions inspect, the panel
                        #   and mutate all have to agree on
    inspect.ts/params.ts#   Inspector read model + per-kind param table
    sourceScan.ts       #   layout.ts as text: regions, entries, tokens
    validate.ts         #   Pre-save checks against the layout being emitted
    navOverlay.ts       #   Draws the nav graph over the scene for authoring
    terrainBrush.ts     #   Terrain mode: hover highlight + sculpt stroke
    serialize.ts/save.ts#   Minimal-diff emit + POST to the dev server
    saveEnvironment.ts  #   environment.ts patched one top-level KEY at a time
                        #     — what the floor picker writes
    tuning.ts           #   Tool constants (NOT src/config/ — not gameplay)
  world/
    layout.ts           # Placement/ScatterSpec/Heightfield/MapLayout — the
                        #   map-data vocabulary, map-agnostic. The floor is
                        #   NOT a field on MapLayout: see MapDef.heights
    TerrainField.ts     # The floor's height and the ONLY place that knows it:
                        #   heightAt() + per-block VertexData + terrainSlab(),
                        #   terrainRibbon()/terrainFan() for a PATH road's strip
                        #   and junction patch, and the BORDERLAND past the
                        #   authored grid on a map whose boundary is open
    Ridge.ts            # The valley rim, in two forms — an escarpment and the
                        #   downs — and, on a `rolling` downs, the summits,
                        #   knolls and the woods sown on it. Shape only: no
                        #   collider, nothing inside the boundary it is handed
    leash.ts            # What stops a player leaving a map that has no wall:
                        #   one clock per body, and the verdict it reaches.
                        #   Pure — the caller does the killing, and offline that
                        #   is Game while in a match it is HeadlessGame
    roads.ts            # The road FOOTPRINT — rectangles, plus the convex
                        #   pieces a path resolves to — and the two questions
                        #   it answers: is this ground PAVED, and where two
                        #   cross, which one IS the ground (ROAD_RANK — dirt
                        #   under cobble under asphalt, 2 mm apart). A
                        #   road still stops no round and no body — what it
                        #   rejects is something ROOTED sown on it, which is
                        #   trees and scrub (PropBody.rooted) and every blade
                        #   of grass. `pieceCorners` is the inverse of how a
                        #   piece is stored, for the one reader that has to
                        #   DRAW a carriageway rather than test a point in one
    roadPaths.ts        # A road laid along a PATH: its corners drawn as arcs
                        #   (bendPath, which the map generators import) and
                        #   the network's JUNCTIONS found and resolved — an end
                        #   on another road, ends on each other, a crossing —
                        #   into cuts and filleted patches. Pure; the client
                        #   and the authority resolve the same one
    grassMask.ts        # Where grass grows, baked once per map into one
                        #   RGBA8 grid: the ground's height, density, height
                        #   multiplier and the WET bit. Owns the refusals (a
                        #   road, a collider, a structure's drawn part on the
                        #   ground, water makes reeds) and the
                        #   field's frayed EDGE, and the per-patch summary the
                        #   GrassSystem culls with. Pure — no scene
    rng.ts              # mulberry32 — the seeded PRNG world-building uses,
                        #   and the map generators' too: Node loads it by type
                        #   stripping through scripts/lib/mapgen.mjs, the
                        #   helpers the seven generate-<map>.mjs share
    MapBuilder.ts       # Builds the map; merges visuals, emits colliders.
                        #   build() is a list of phases, one method each
    mapTypes.ts         # GameMap, WorldBox, WorldPane, PaneGroup, the layout's
                        #   flag/spawn/water/grass shapes and the editor index.
                        #   Types only; MapBuilder re-exports every one
    merge.ts            # The visual merges: mergeByMaterial, then BlockMerge
                        #   and PaneBlocks per map block (one key, one
                        #   metadata.block), flatten, tag, BLOCK_SIZE
    solid.ts            # SOLID_ONLY — the one mesh pick predicate left, and the
                        #   editor's alone. The three-way table of what a
                        #   collider answers a body and a round is still here
    RayWorld.ts         # The segment query every ray in the game asks, off the
                        #   collider boxes, the strut groups and the terrain
                        #   rather than off scene.meshes. castBody / castRound /
                        #   blocked, the grid behind them, and the hulls, which
                        #   are the one solid thing that moves. It is what
                        #   retired scene.pickWithRay at all eight sites
    CollisionField.ts   # RayWorld's counterpart for the one whole-scene walk a
                        #   ray query could not replace: the collider MESHES
                        #   bucketed, so moveWithCollisions is handed a street
                        #   through Babylon's own surroundingMeshes instead of
                        #   walking the map. `narrowedMove` is the whole of how
                        #   a body sweeps — a hull's and the player's, the only
                        #   two in the game, and it forces the mover's world
                        #   matrix because the AUTHORITY never renders one.
                        #   Superset or nothing — read it
    vertexShading.ts    # The world's baked vertex-colour buffer, written after
                        #   every merge: AO in the ALPHA, the world mark in the
                        #   GREEN, the wind's sway weight in the RED
    sway.ts             # Which foliage the wind moves and how much of it moves
                        #   at a given height. Marks, layers, the weight ramp.
                        #   A marked group leaves Babylon's outline pass and
                        #   gets an ink twin (MapBuilder.inkTwin) instead
    flame.ts            # An open fire's geometry — outer tongues wound inside
                        #   out, a core, embers, a bounds marker — in one vertex
                        #   block whose UVs FlameShader decodes. flamePart for
                        #   the kit's Build.flame
    parts.ts            # A structure's PART meshes, built without ever reaching
                        #   the GPU: uploading geometry that a merge throws away
                        #   was half of a 1500 m build. partBox / partCylinder /
                        #   partSurface, and uploadPart, which every path out of
                        #   a merge owes. Colliders are NOT parts — a part has no
                        #   submeshes and would stop nothing
    BuildingKit.ts      # Facade: shared types + BUILDERS registry
    kit/core.ts         #   Build accumulator (box/wall/guard/flight/...),
                        #   palette, builder contract, and the forest's
                        #   drawing words (limb/rope/slab/fern/curtain) the
                        #   jungle ruin, the temple and the manor grow from;
                        #   `StoneBatch` and `Mesher`, one surface per colour
    kit/buildings/      #   the big enterable and landmark buildings: one file
                        #   per builder, and one per set of drawing words
      index.ts          #   The set's header and barrel
      village.ts        #   The elevations' members (offFace, casement,
                        #   doorway, framing, boardUp), the lamplit colours, and
                        #   the thatch/slate pitches and weatherboard the houses
                        #   share. Visual only
      rubble.ts         #   The burnt cottage's words: coursed rubble over a
                        #   set-back core, ashlar, wall heads, heap, ivy
      gothic.ts         #   The chapel's words: face points and polygons, the
                        #   pointed arch, the lancet, the buttress, the spire's
                        #   pyramid, and `inside`, which the stilt hut borrows
      render.ts         #   The jungle ruin's words: render over brick, spalls,
                        #   wall heads, toothing, quoins
      cottage.ts        #   buildCottage — the thatched timber-framed house
      townhouse.ts      #   buildTownhouse — jettied, slate, brick stack; its
                        #   header owns the masses-carry-the-colliders rule
      tavern.ts         #   buildTavern — the coaching inn, floored and furnished
      smithy.ts         #   buildSmithy — the open stone shop and its forge
      ruin.ts           #   buildRuin — the stone cottage that burnt
      watchtower.ts     #   buildWatchtower — the timber lookout and its ramp
      chapel.ts         #   buildChapel — the parish church, tower and spire
      barn.ts           #   buildBarn — the open barn and its ramped hayloft
      mill.ts           #   buildMill — stone under weatherboard under slate
      boathouse.ts      #   buildBoathouse — the tarred shed on piles
      gatehouse.ts      #   buildGatehouse — the home-spawn arch
      stiltHut.ts       #   buildStiltHut — Greyfen's dwelling on its platform
      jungleRuin.ts     #   buildJungleRuin — the house the forest took back
      manor.ts          #   buildJungleManor — the two-storey colonial house
                        #   with the wrap-around gallery, the kit's largest
    kit/structures/     #   small standalone structures and cover: a file per
                        #   builder big enough to argue for itself
      index.ts          #   The set's header and barrel: the cover heights a
                        #   layout picks from, and a ROUND prop's collider sized
                        #   off its silhouette rather than its circumdiameter
      small.ts          #   silo, fence, stoneWall, haystack, lamp, crates,
                        #   trough, shrine — a few dozen lines apiece
      cartParts.ts      #   reframe/about, and the cart's wheel, sack, fork and
                        #   cask; the stall borrows the sack and reframe
      templeStone.ts    #   The temple ruin's sandstone and laterite, and its
                        #   words: flat, courses, hang, moss, fallen, devata
      well.ts           #   buildWell — the draw-well and its head frame
      stall.ts          #   buildStall — the market stall and its wares
      bridge.ts         #   buildBridge — the pile-and-stringer footbridge
      trestleBridge.ts  #   buildTrestleBridge — the trestle and its approaches
      templeRuin.ts     #   buildTempleRuin — the stepped platform; carries the
                        #   per-cell nav budget table docs/bots.md points at
      cart.ts           #   buildCart — the farm wagon, whole or ruined
      woodpile.ts       #   buildWoodpile — a cord of split firewood
      shed.ts           #   buildShed — the boarded pent shed
      kiln.ts           #   buildKiln — the brick bottle kiln
    kit/terrain.ts      #   terrace, ramp, road (and a cobbled street's kerb
                        #   course), jetty, boardwalk, stairs
    kit/harbour/        #   the volcanic-coast set, and the only one in the kit
                        #   built for a map that already shipped: one file per
                        #   building, the three small waterfront pieces together
      index.ts          #   The set's header and barrel: why a place is the
                        #   buildings that place would have built, the three
                        #   materials the whole set is made of, and why nothing
                        #   tall in it is climbable but the smelter's deck
      shared.ts         #   What more than one building is drawn with: `bar`,
                        #   `splitRun`, the tarred lapped boarding and the
                        #   window cut into it, `NET_PAINTS`, `TRANSLUCENCY`
      smelter.ts        #   buildSmelter — the tree's one LANDMARK: a hollow
                        #   ore hall with an arch armour drives through, a
                        #   furnace block carrying the light, a 40 m stack and a
                        #   walked charging deck one flight up. Its header owns
                        #   why a landmark has to be worth walking INTO
      lighthouse.ts     #   buildLighthouse — the rock tower, its lantern and
                        #   the keeper's cottage
      crane.ts          #   buildHarbourCrane — the quay crane and its winch house
      netLoft.ts        #   buildNetLoft — the tarred loft on basalt piers
      small.ts          #   buildFishRack, buildCareenedHull, buildSaltPan
    kit/japan/          #   the temple-town set, built for Kurenai: one file
                        #   per builder, and one per word two builders share
      index.ts          #   The set's header and barrel: why it is a set, the
                        #   curved roof's argument, and the rules it adds to
                        #   the kit contract — vermilion on the sacred and the
                        #   crossed alone, walked-first collider order, nothing
                        #   tall climbable
      palette.ts        #   The five materials and the one accent, the paper's
                        #   glows, and the two fallen-leaf colours
      roof.ts           #   The kit's one CURVED ROOF: `curvedRoof`
                        #   (rings from eave to ridge on a power curve, corners
                        #   swept up, a closed solid) and `roofHeight`
      lapidary.ts       #   `Lapidary`, the mason the toro, the stone pagoda,
                        #   the bell tower and the bridge carve with
      joinery.ts        #   `Joinery`, the carpentry under a tiled hip the
                        #   temple gate and the bell tower build with
      torii.ts          #   buildTorii — the myōjin gate and the votive gate
      toro.ts           #   buildToro — the Kasuga stone lantern
      stonePagoda.ts    #   buildStonePagoda — the granite gojū-sekitō
      machiya.ts        #   buildMachiya — the lattice-fronted townhouse, in
                        #   the three lattices a street really had
      minka.ts          #   buildMinka — the thatched farmhouse
      kura.ts           #   buildKura — the storehouse, and `KURA_CRESTS`, the
                        #   merchant's marks two other noren borrow
      teahouse.ts       #   buildTeahouse — the sukiya teahouse on its engawa
      templeHall.ts     #   buildTempleHall — the hondō
      pagoda.ts         #   buildPagoda — the painted five-storey landmark
      templeGate.ts     #   buildTempleGate — the shikyakumon, and `TERA`
      bellTower.ts      #   buildBellTower — the shōrō
      gardenWall.ts     #   buildGardenWall — the tsuijibei
      archBridge.ts     #   buildArchBridge — the vermilion taikobashi
    kit/city/           #   the downtown set, built for Coldharbour, and the
                        #   first builders that stack WALKED floors: one file
                        #   per building, the street furniture together
      index.ts          #   The set's header and barrel: the four rules
                        #   stacking floors makes necessary, what each of the
                        #   five buildings is FOR, the collider budget an
                        #   enterable one is spending, the glass, and the
                        #   light budget
      shared.ts         #   What a stacked building is measured by: STOREY,
                        #   SLAB, GRADE, LANDING, DOORWAY, `levelY`, and
                        #   `laneFlight`, the stair lane the office and the
                        #   shophouse climb on
      tower.ts          #   buildTower — the solid stock of the skyline, its
                        #   curtain-wall and brick skins, and `towerRoll`. Its
                        #   header owns the opposite budget: what a building
                        #   nobody may enter can be given without a fourth
                        #   collider
      office.ts         #   buildOffice — the plate you fight across
      shophouse.ts      #   buildShophouse — a shop with flats over it
      parkade.ts        #   buildParkade — three open decks
      depot.ts          #   buildDepot — the goods shed and its gallery
      planter.ts        #   buildPlanter — the precast council trough
      street.ts         #   buildBarrier, buildQuay, buildCar, buildStreetLight
      monument.ts       #   buildMonument — the war memorial
    kit/desert/         #   the desert-town set, and the first vernacular here
                        #   whose ROOF is walked, which is what it exists for: a
                        #   flat roof is a second storey of ground and a parapet
                        #   is the cover on it. One file per building, the runs
                        #   and the furniture together
      index.ts          #   The set's header and barrel: the STAIR LANE every
                        #   climbed building in it is built around, the
                        #   collider ORDER the nav grid's silent overflow makes
                        #   load-bearing, and the ten-colour palette's argument
      shared.ts         #   What a building is measured and dressed by: the
                        #   palette, T, PLINTH, SLAB, STOREY, the lane, PARAPET,
                        #   GRADE, `laneFlight` and `assertClimbable`,
                        #   `clothHash` and `drape`, the parapets, `windowRow`
      adobe.ts          #   buildAdobeHouse — the courtyard house, nine in ten
      shellBlock.ts     #   buildShellBlock — the shelled concrete slab
      mosque.ts         #   buildMosque, buildMinaret — the dome and the shaft
                        #   nobody climbs
      souk.ts           #   buildSouk — the colonnade with a walked roof
      windTower.ts      #   buildWindTower — the house with a barjeel on its deck
      caravanserai.ts   #   buildCaravanserai — the inn built as a fort, and
                        #   `arcade`, its punched inner walls
      hammam.ts         #   buildHammam — the bathhouse and its domed deck
      granary.ts        #   buildGranary — the mud silos in the alley
      walls.ts          #   buildCompoundWall, buildBlastWall, buildSandbags,
                        #   buildPylon. `pylon` is the odd one: a power pole
                        #   that carries the SPAN of wire ahead of it
                        #   (`length`), so a chain of them draws one line across
                        #   ground a placement cannot otherwise reach off the
                        #   end of, and it samples `BuildCtx.terrain` for the
                        #   far end's height
    NavGrid.ts          # Walkable-surface graph + precomputed flow fields
    CoverMap.ts         # Baked per-surface directional cover masks
    boxGeometry.ts      # Analytic WorldBox primitives, shared by NavGrid /
                        #   ObstacleField / CoverMap
    ObstacleField.ts    # Sub-cell collision push-out for thin props, and two
                        #   bucketed queries over the same boxes: `groundAt`,
                        #   what a track contact — and now a body's feet —
                        #   stands on, and `wallAt`,
                        #   its mirror — what is IN THE WAY, which is what an
                        #   AI driver's whiskers ask
    boxIndex.ts         # The build-time uniform grid over collider boxes, so
                        #   scatter placement and the occlusion bake stop
                        #   walking all of them
    props/              # Scatter props: trees, graves, rubble, braziers,
                        #   boulders, brambles, barrels, and the understory —
                        #   ferns, fallen buttress logs, carved stelae — plus
                        #   the mid-story, the liana veil, which is NOT a
                        #   scatter prop: the jungle tree hangs it off its own
                        #   fronds, because scatter placement is what pushed it
                        #   away from every crown on the map. One file per
                        #   prop; a prop never imports another
      index.ts          #   The set's header and barrel: the contract every
                        #   builder obeys, and what `MapBuilder` imports
      palette.ts        #   The colours more than one prop wears, and
                        #   `RIM_WOOD`, the paint a rolling rim's woods wear
      geometry.ts       #   The shapes more than one prop is built from: `tri`,
                        #   the `V3` arithmetic, the `Sheet` a fine leaf is laid
                        #   on, a rachis's frames, `prism`, `loft`, `geodesic`
      crown.ts          #   The broadleaf crown of billows the ash and the
                        #   maple share: `skinBillows`, a leaf's stalk and
                        #   faces, `crownPart`, `rigVerts`
      deadTree.ts       #   buildDeadTree — the stag-headed snag
      pine.ts           #   buildPine — the spruce-habit conifer
      ash.ts            #   buildAshTree — the hedgerow ash and its leaf cluster
      jungleTree.ts     #   buildJungleTree and buildLianaVeil — the feather-
                        #   frond palm and the curtain it hangs from its crown
      fern.ts           #   buildFernClump — the shuttlecock fern
      palm.ts           #   buildPalm — the date palm
      maple.ts          #   buildMaple, buildLeafLitter, buildBamboo — the
                        #   temple valley's three, the only props built from
                        #   upload-free PARTS, because a map sows thousands
      fireDrum.ts       #   buildFireDrum — the open burn barrel
      boulder.ts        #   buildBoulder — the glacial erratic and `rockData`
      cask.ts           #   buildBarrel and `caskData`, the coopered cask the
                        #   structure kit's crate stack borrows
      small.ts          #   The few-dozen-line props: buttress log, stele,
                        #   gravestone, lantern, fungus, log, bramble, rubble
      junk.ts           #   The city's own dressing: skip, bins, pallets, cone,
                        #   litter
    textures.ts         # Generated canvas textures: the cobbles, and the floor
                        #   surfaces — noise fields posterized onto a ramp of
                        #   the map's floorColor, albedo and height in one pass
    floorSurfaces.ts    # What the valley floor is MADE of: the surface roster
                        #   and the ONE place a floor material is built
    environment.ts      # EnvironmentSpec + applyEnvironment, and
                        #   bodyDrawDistanceOf — the one reader of a map's body
                        #   draw distance, capped at its own fogEnd
    maps.ts             # MapDef + the MAPS registry. The only EXISTING file a
                        #   new map has to touch (plus vite.config's WRITABLE).
                        #   `MAPS` is an `import.meta.env.DEV` ternary and must
                        #   stay one — that fold is what keeps the proving
                        #   ground out of both bundles. Also loadHeights/
                        #   heightsOf and loadCollision/collisionOf: a map's
                        #   floor and its collider bake are both LAZY imports,
                        #   and this is where they are asked for and remembered
    buildProfile.ts     # Where the time behind the loading card went, per
                        #   phase. DEV ONLY and a no-op otherwise; the handle
                        #   is `window.__buildProfile()`
    collision.ts        # MapCollision: the shape of a baked collider set, and
                        #   the tuple->WorldBox expansion the server rebuilds
                        #   from. Names no map; reached via MapDef.collision,
                        #   a LAZY import, so neither bundle carries one. The
                        #   server is no longer its only reader — the menu's
                        #   schematic draws a map nothing has built yet, and
                        #   this is the only description of its buildings that
                        #   exists outside a built world
    fingerprint.ts      # A comparable summary of a built world — the nav graph,
                        #   not the boxes. What `npm run parity` diffs
    hollowmere/layout.ts      # A MAP — every placement, flag and spawn
    hollowmere/heights.ts     # GENERATED floor heights (editor terrain mode).
                              #   Reached via MapDef.heights, a LAZY import —
                              #   a map's grid is not in the main bundle
    hollowmere/environment.ts # Palette, fog, mist, particles — night
    hollowmere/collision.ts   # GENERATED collider boxes (`npm run collision`)
    greyfen/layout.ts         # The second map: a jungle valley with a
                              #   plantation at its heart — the manor on C, a
                              #   stilt village, the ferry, the temple on its
                              #   hill, a dug-in camp, and the landing, the
                              #   sawmill and the old city between them.
                              #   SEEDED by `npm run greyfen` and owned by the
                              #   editor after
    greyfen/heights.ts        # GENERATED floor heights (`npm run greyfen`) —
                              #   a Y-shaped river wadeable everywhere, the
                              #   temple's hill, the spine, the old city's
                              #   hollow and the lagoon. LAZY
    greyfen/environment.ts    # Palette, fog, sun, sky, shafts — a jungle
                              #   morning two hours after sunrise
    greyfen/collision.ts      # GENERATED collider boxes (`npm run collision`)
    coldharbour/layout.ts     # The third map: a harbour town on a bay. The
                              #   first that is not 240 m (`size: 320`) and the
                              #   first that stacks floors (`surfaces: 4`).
                              #   GENERATED by `npm run coldharbour`
    coldharbour/heights.ts    # GENERATED floor heights — the town in level
                              #   terraces round a low-water harbour cut to a
                              #   wadeable bed. LAZY, like every heights.ts
    coldharbour/environment.ts# Palette, sun, sky — a clear afternoon, and the
                              #   first map with no fog wall (`fogEnd: 480`)
    coldharbour/collision.ts  # GENERATED collider boxes (`npm run collision`)
    harrowmead/layout.ts      # The fourth map: a farming village in a green
                              #   vale (`size: 400`) — a green with the church
                              #   and the inn, five flags in rolling, hedged
                              #   country, and the second map with armour.
                              #   SEEDED by `npm run harrowmead` and owned by
                              #   the editor after
    harrowmead/heights.ts     # GENERATED floor heights (`npm run harrowmead`)
                              #   — rolling hills, level plots and a brook cut
                              #   to a constant wadeable bed. LAZY
    harrowmead/environment.ts # Palette, sun, sky — high summer, late
                              #   morning, no fog wall (`fogEnd: 520`)
    harrowmead/collision.ts   # GENERATED collider boxes (`npm run collision`)
    sarab/layout.ts           # The fifth map, and the one ENGINE_UPGRADE.md
                              #   exists for: a desert town, 900 m of play
                              #   inside 1500 m of ground. SEEDED by
                              #   `npm run sarab` and owned by the editor after
                              #   that — its header carries the argument. The
                              #   first map to state `blockSize`/`terrainBlock`
                              #   and the first whose `fogEnd` is inside its own
                              #   diagonal
    sarab/heights.ts          # GENERATED with it — dunes, each quarter
                              #   flattened dead level, and a wadi cut through
                              #   all of it. 226x226 vertices, the biggest in
                              #   the tree by an order of magnitude, and LAZY
    sarab/environment.ts      # Palette, high sun, dust — an hour before noon,
                              #   and the first spec written for a map that can
                              #   be FOGGED (`fogEnd: 560` inside a 1273 m
                              #   diagonal) and the first to state a
                              #   `bodyDrawDistance`
    sarab/collision.ts        # GENERATED collider boxes (`npm run collision`)
    cinderhaven/layout.ts     # The sixth map and the biggest: a harbour town on
                              #   a volcanic island at night, 1500 m of play
                              #   inside 2000 m of ground. SEEDED by
                              #   `npm run cinderhaven` on Sarab's precedent.
                              #   The first map whose FLOOR is the level — what
                              #   is land, where the sea goes and which slopes
                              #   sever are one function — and the first whose
                              #   town is generated as a STREET NETWORK with
                              #   the houses turned to face it. A C-shaped
                              #   island round a wadeable bay, with a control
                              #   point on the rock in the middle of it and
                              #   every waterfront DERIVED from where the floor
                              #   crosses the sea rather than authored
    cinderhaven/heights.ts    # GENERATED with it — a harmonic coast, a 120 m
                              #   cone masked by it, CINDER BAY cut through
                              #   both, and Chapel Rock raised in the middle of
                              #   the bay after the cut. 251x251 vertices, the
                              #   biggest in the tree, and LAZY
    cinderhaven/environment.ts# Palette, sky and light — and the one map lit
                              #   from the MOUNTAIN rather than from a moon, so
                              #   the disc, the halo and every god ray hang
                              #   over the crater
    cinderhaven/collision.ts  # GENERATED collider boxes (`npm run collision`)
    kurenai/layout.ts         # The seventh map: a temple town in a mountain
                              #   valley as the maples turn, 240 m of play
                              #   inside 440 m of ground, infantry only, 8 a
                              #   side. SEEDED by `npm run kurenai` on Sarab's
                              #   precedent, against a REFERENCE FRAME
                              #   (`reference-media/new-map.jpg`): a river
                              #   through the town under an arched bridge, a
                              #   pagoda precinct on a terrace, a shrine at the
                              #   top of a tunnel of torii
    kurenai/heights.ts        # GENERATED with it — rolling ground, two hills,
                              #   the districts levelled by a weighted average,
                              #   the river's corridor, then the channel, the
                              #   koi pond and the hot spring cut. LAZY
    kurenai/environment.ts    # Palette, sky and light: a 14.5-degree gold sun in
                              #   the north-west (Harrowmead's derivation), a
                              #   peach haze that starts close, mauve cloud, and
                              #   falling red leaves as the particle field
    kurenai/collision.ts      # GENERATED collider boxes (`npm run collision`)
    proving/layout.ts         # DEV ONLY, and NOT a level: the proving ground
                              #   ENGINE_UPGRADE.md S0 measures against. A city
                              #   block grid at Coldharbour's collider density
                              #   over a play square several times the size.
                              #   GENERATED (`npm run proving`), gated out of
                              #   every bundle by `scripts/check-proving.mjs`
    proving/heights.ts        # GENERATED with it — level under the streets, and
                              #   the third string check-proving.mjs greps for
    proving/collision.ts      # GENERATED with them, by `npm run collision --
                              #   proving`, and the only reason the AUTHORITY can
                              #   be run on this map (ENGINE_UPGRADE.md S9). The
                              #   fourth string check-proving.mjs greps for
    proving/environment.ts    # The one hand-written file there. A dry noon
                              #   with `fogEnd` past the map's own diagonal, so
                              #   nothing measured on it is hidden by weather
  ui/                   # One .css beside each module that writes markup
    base.css            #   Reset, canvas, #hud root, and ONLY primitives two
                        #   or more screens share — the tokens, .ui-eyebrow and
                        #   .ui-facts (all that is left of the retired SHELL),
                        #   and THE FRONT END's unit (`--u`, the `--t-*` scale)
                        #   and prompt glyphs, shared by every title screen.
                        #   Imported by main.ts
    HUD.ts/hud.css      # Gameplay chrome ONLY: tickets, flags, capture panel,
                        #   vitals, ammo, the stowed slot, hitmarker, killfeed,
                        #   score feed, damage arcs, +
                        #   .paused/.editing/.dying. NO crosshair: the fitted
                        #   sight is the only aim mark in the game
    Scoreboard.ts       # The Tab board, a screen whose lifetime is the ROUND's
      scoreboard.css    #   (pushed from tick on playing, dying and deploy), set
                        #   on the FRONT END's unit: the two reinforcement
                        #   counts facing each other as its title, each side's
                        #   list the round-over card's board line for line.
                        #   Built straight after HUD; z-index 9 puts it over
                        #   the deploy screen
    MenuBackdrop.ts     # #menu-shot, the map photograph the front end stands
      backdrop.css      #   on: a root of its own so it survives a card being
                        #   rewritten and stays UNDER the scrim, drifting, two
                        #   layers cross-fading on a decode. Built by Game just
                        #   before the overlay and handed to it and to the
                        #   lobby, so there is one picture
    OverlayScreen.ts    # The four cards — menu, round-over, pause, building —
      overlay.css       #   the .overlaid class they raise, and which map the
                        #   MenuBackdrop it is handed shows. The menu is a
                        #   title screen on its own grid of named areas (four templates, one unit,
                        #   `--u`), the map's name as the hero, a column of the
                        #   round's decisions — a REEL of map photographs, the
                        #   enemy, the kit, Deploy — a system bar, and an INTEL
                        #   plate on whatever the cursor rests on. MENU_ITEMS
                        #   is a RING; prompts are per DEVICE (`dev-*`); the
                        #   card is BUILT on a raise and PATCHED after. The
                        #   BUILDING card stands in the menu's frame: the same
                        #   hero and photograph, a load plate where Deploy was,
                        #   a briefing plate and a field note — and nothing
                        #   that needs a frame after the build starts. The
                        #   ROUND-OVER card stands in it too: the RESULT as the
                        #   title in the winner's colour over the map's
                        #   photograph, a column of the reinforcements, your
                        #   own round and Another round (a ballot of map
                        #   plates, or a wait plate, in a match), the top of
                        #   the board as the intel, and Main menu / Leave
                        #   match in the system corner. The
                        #   PAUSE is a title screen for the round it holds and
                        #   the one card that does not take the screen: the
                        #   map's name as the title (Paused / Match live), your
                        #   round so far, and a column of plates — Resume the
                        #   hot one, the way back — anchored left over the round
    fieldNotes.ts       # The building card's one line of advice: a table of
                        #   notes about how this game plays, numbers read off
                        #   CONFIG, armour notes only on armoured maps, never
                        #   the one told last time, and no key named
    mapPlan.ts          # WHAT all three of this interface's maps draw, as one
                        #   description: the floor, the water, the
                        #   carriageways and the masses standing on them — and
                        #   nothing about a round. Two adapters make one,
                        #   `planFromWorld` off a built GameMap (the deploy
                        #   screen, the minimap) and `planFromLayout` off a
                        #   MapDef plus whichever of its two lazy halves have
                        #   landed (the menu, where nothing is built). A mass
                        #   is filed by its LONG RUN and not by its area: a
                        #   building is walls, and a wall is 0.25 m thick
    mapPaint.ts         # The LOOK of one, for all three: paper, hillshade,
                        #   contours at an interval chosen so they never crowd,
                        #   the derived waterline, the carriageways, the fences
                        #   and the built mass — closed into silhouettes and
                        #   laddered by height — then the survey grid. Plus the
                        #   two marks all three share, a control point's zone
                        #   and the hexagon `hud.css` names it with. Colour
                        #   means OWNERSHIP here and nothing else does
    MapThumb.ts         # The menu intel's map schematic: the projection into
                        #   the intel plate's canvas, and the flags and home gates
                        #   over the plan. Never touches a built GameMap — the
                        #   menu is the one screen where there is none — so it
                        #   takes the FLOOR and the COLLIDER BAKE as arguments
                        #   that may be absent and draws what it has, in up to
                        #   three passes as they land. `paintMapThumb` is that
                        #   fetch-and-repaint, shared by the menu and the lobby
    mapShots.ts         # The PHOTOGRAPH behind the menu: one shot per map
                        #   (shots/<id>.avif, imported ?url) and the VANTAGE it
                        #   was taken from, which is what lets `npm run shots`
                        #   retake it rather than hunt for the frame again. A
                        #   map with no row here simply has no backdrop. Not a
                        #   field on MapDef, because the SERVER imports those.
                        #   Also the menu reel's THUMBNAILS, downscaled once a
                        #   session on the client rather than committed — which
                        #   the lobby's match plates wear too
    DeployScreen.ts     # The between-lives screen, a TITLE SCREEN for the
      deploy.css        #   POSITION the cursor is on: its name set large over
                        #   the round's tickets and flags, a column of position
                        #   plates, the kit plate (L/Y) and a Deploy plate that
                        #   fills over the reinforcement clock, the map's PLAN
                        #   as the stage, an intel plate (the position and the
                        #   round), Pause in the system corner. The plan is
                        #   mapPaint's, PRERENDERED once per map and blitted —
                        #   this screen redraws every frame and Cinderhaven is
                        #   3,700 colliders — and the one of the three that
                        #   letters its grid. The offer is live, so the cursor
                        #   is held by IDENTITY; a plate or a marker PICKS and
                        #   Deploy fires; #hud.deploying takes the HUD's chrome
                        #   off; in a netplay round a confirm is a REQUEST and
                        #   says so
    LoadoutScreen.ts    # Kit screen, laid out as the MENU is and consistent
      loadout.css       #   with it alone: the weapon's name as the title, a
                        #   bottom-anchored column of SLOT plates (up/down),
                        #   a RAIL of the cursor slot's options under the
                        #   weapon (left/right, applied), the bumpers turning
                        #   the weapon from anywhere, an INTEL plate with the
                        #   chart DERIVED from CONFIG.weapons, Back in the
                        #   system corner. Built once, PATCHED after; the bay
                        #   the turntable stands in is MEASURED every frame
                        #   (stageBay), so nothing sharing its column may
                        #   change height. Four templates; phones are LANDSCAPE
    prompts.ts          # The prompt drawn ON a control for the device in hand
                        #   (`glyph`, `InputDevice`, `guessDevice`, and
                        #   `markDevice`, the `dev-*` class write) — shared by
                        #   the five title screens; the kbd.gl rules and the
                        #   shared `--u` unit are base.css's
    SettingsScreen.ts   # A title screen for the PAGE of settings, laid out as
      settings.css      #   the menu and the kit are: the page's name is the
                        #   title, the pages a tab strip the bumpers turn, the
                        #   rows plates built from a ROW TABLE — a stepper, or
                        #   a slider where the ladder is too long for one (the
                        #   thumb picks an option INDEX, so both are the same
                        #   choice) — an intel plate, Back in the corner. Row 0
                        #   is the tab strip, so a pad reaches every page
                        #   through the list; the Input page carries the
                        #   bindings for the device in hand. Laid over the
                        #   scene: #hud.setting hides every other screen.
                        #   Owns no setting: picks leave through onChange and
                        #   return as setValues
    LobbyScreen.ts      # The match browser, a TITLE SCREEN for the match the
      lobby.css         #   cursor is on: its map's name over its photograph
                        #   (the menu's MenuBackdrop, handed in), two pages
                        #   on a tab strip the bumpers turn — JOIN (a plate per
                        #   match, with a slice of its map's picture) and NEW
                        #   MATCH (region/map/bots steppers and Start match) —
                        #   an intel plate with the seats and the map's plan,
                        #   Refresh (R/X) and Back in the system corner. Rows
                        #   are DERIVED from the results and kept by IDENTITY;
                        #   everything off a network is written with
                        #   textContent (`Fill`). Fetches nothing — Game hands
                        #   it the regions and each answer as it lands. A match
                        #   row is a REGION and an id (every region has an m1).
                        #   The pickers are what a match CREATED here is built
                        #   with; joining takes that match's server and map.
                        #   One region drops the region column and picker.
                        #   #hud.lobbying takes the menu off the glass
    Minimap.ts          # Corner minimap, player-centred and heading-up: flags,
      minimap.css       #   friendlies, firing enemies, and a rim marker for
                        #   every control point the zoomed view does not reach.
                        #   Its backdrop is mapPaint's plan, prerendered north-
                        #   up at the live scale and turned under the player;
                        #   the plate's translucency is one alpha on that BLIT.
                        #   The one canvas that RESIZES itself: the box is
                        #   --hud-map and the backing store follows it
    ProfileChip.ts      # The frame profiler's corner of the HUD: what the ring
      profile.css       #   is holding, and the four buttons that get a capture
                        #   off the device or into the reader. A DEVICE on #hud
                        #   like TouchControls, not a screen. The buttons exist
                        #   because the pointer is LOCKED — F3 is the desktop
                        #   path to KEEP, and a phone has only the buttons.
                        #   VIEW hands the full report to
                        #   public/profile_viewer.html through localStorage,
                        #   which works only because the reader is on the game's
                        #   OWN ORIGIN; VIEWER_PATH here is one of the three
                        #   places that path is spelled. Delivery (clipboard,
                        #   then execCommand, then download) is this file's;
                        #   the ring is never reached for
    TouchControls.ts    # The on-screen controls a phone plays with: a FLOATING
      touch.css         #   (or, by setting, FIXED) movement stick in the left
                        #   zone, a look DRAG in the right one, and the button
                        #   cluster over both. A
                        #   DEVICE, not a screen that acts — InputManager polls
                        #   it (setTouchSource) exactly as it polls a gamepad,
                        #   so nothing in gameplay has heard of it. The one
                        #   thing on it that is not input is the pause button,
                        #   which a phone has no Escape key for. Game pushes the
                        #   states it draws or acts on but cannot know
                        #   (crouched, the magazine wanting attention, whether
                        #   aim-on-fire applies and the sight is up yet, the two
                        #   vehicle verbs, and WHAT THE THUMBS ARE ON — a body's
                        #   controls or a crewed hull's, setMode, a button
                        #   outside them being off the glass rather than dimmed)
                        #   and decides when it is up: `playing`, and only while
                        #   touch is the device in hand
    ping.ts             # What a latency LOOKS like — the text and the quality
                        #   band, shared by the scoreboard's column and the
                        #   lobby's reading so the two cannot disagree. No
                        #   markup and no stylesheet of its own
  net/                # Multiplayer, client side. Nothing here is constructed
    protocol.ts       #   in an offline round.
                      #   The wire format — the ONLY module the server also
                      #   imports. Pure types + the rates both ends must agree
                      #   on. No Babylon, no DOM, no CONFIG
    Connection.ts     #   Socket lifetime, reconnect, and the server-clock
                      #   offset every interpolated body is drawn against
    NetSession.ts     #   One networked round: the seam between Game and the
                      #   wire. Game gains a field and a branch, not a protocol
    NetRoster.ts      #   The pool of NetSoldiers + mirrored flags/tickets.
                      #   The client's stand-in for BattleSystem: same job on
                      #   screen, none of the job underneath
    NetGrenades.ts    #   Everybody else's grenades in the air, interpolated on
                      #   the same clock as the bodies. The thrower's own is
                      #   skipped — they are watching their local copy
    NetVehicles.ts    #   Somebody else's armour: one interpolation buffer per
                      #   HARDSTANDING, feeding Vehicle.updateRemote. Owns no hull
                      #   — the fleet is VehicleSystem's on both sides — and the
                      #   hull the local player is driving is skipped, because
                      #   they are simulating it
    NetOrdnance.ts    #   The AT kit off the wire: rockets interpolated like
                      #   grenades, mines applied whole from the versioned
                      #   `mines` table. The shooter's own rocket is skipped;
                      #   their own mine is NOT, because it is never predicted
    lobby.ts          #   GET /matches for ONE region. The only part of
                      #   multiplayer that is not the WebSocket. Times its own
                      #   request, which is the ping shown beside that region —
                      #   and owns clearRequestTimings, without which that
                      #   timing is not recorded at all
    regions.ts        #   Which match servers exist: the read of
                      #   public/regions.json, and the arithmetic that turns a
                      #   region's HOST into its socket and its list URL. Both
                      #   are resolved together, so browsing one server and
                      #   joining another is not representable
    HitCredits.ts     #   Rounds this client already cued a hitmarker for, and
                      #   the rule that a landed round is announced ONCE: a
                      #   FIFO queue of predicted hits the authority's verdict
                      #   claims. Expiring, so a round the server scored as a
                      #   miss leaves nothing standing. Cues nothing itself
    NetShotQueue.ts   #   Other people's rounds off the wire, waiting for the
                      #   netplay frame that draws them: an event is not a
                      #   frame, and a tracer spawned outside one HAUNTS. A
                      #   pooled, capped queue of SLOTS; draws nothing
    RegionBook.ts     #   WHICH region this client browses and joins: the list
                      #   once read, the player's pick, the fastest-answering
                      #   pick for one who has none, and ?server=. resolve() is
                      #   the funnel every socket and every list goes through.
                      #   Draws nothing and stores nothing — choose()/note()
                      #   hand back the row for Game to light up
  pwa/
    register.ts         # SW registration, the update check that is the only
                        #   thing that ever looks for a new build, and the
                        #   touch fullscreen gesture.
                        #   Knows nothing about the game
    sw.js               # The service worker, as a TEMPLATE — not typechecked,
                        #   never imported; vite.config.ts emits dist/sw.js.
                        #   Network-first for the navigation, cache-first for
                        #   the content-hashed rest
  shaders/
    CelShader.ts        # Custom cel ShaderMaterial. Both stages WGSL; six
                        #   defines, six UBO layouts
    ShadowBindings.ts   # Every shadow a lit material samples (world, bodies,
                        #   lamps' atlas, lightning, clouds, foliage) bound
                        #   onto the factory's cache and the grass/water
                        #   consumers. `mats.shadows`; GI stays in the factory
    CelInk.ts           # THE INK: one full-screen edge over the depth the
                        #   frame already wrote. Replaced Babylon's outline
                        #   hull AND MapBuilder's ink twins — Coldharbour
                        #   +32%, Harrowmead +51%. Only ever DARKENS
    GlowPass.ts         # THE BLOOM, owned end to end: an emissive-only mask
                        #   drawn against the FRAME's depth (shared, sized in
                        #   the same function that draws it), Babylon's kernel
                        #   blur at half and quarter resolution (quarter and
                        #   eighth off a box downsample on the Glow setting's
                        #   `low`), and an additive
                        #   compose the ink runs as its last line (a WGSL
                        #   snippet, not a pass). Public API only;
                        #   `Game` supplies the rules (what blooms, how bright)
    Fxaa.ts             # FXAA's fragment shader, registered under the name
                        #   Babylon's pass looks up so it runs this text: the
                        #   same shader with CONFIG.graphics.fxaa's three
                        #   constants (sub-pixel blend 0.25 where Babylon's 1.0
                        #   blurred the frame). Owns no pass
    FrameDepth.ts       # The frame's own depth attachment, captured once and
                        #   wrapped for the two passes that sample it (the ink's
                        #   edges, the blur's weapon mask). Renders and copies
                        #   nothing; owns no pass
    EmissiveFog.ts      # The same fog as a material plugin on every unlit
                        #   emissive material — windows, flames, tracers. WGSL
                        #   only, which is what isCompatible states
    Dither.ts           # One LSB of triangular noise, in the three surface
                        #   shaders. Fixes 8-bit banding in the fog. Owns the
                        #   ARGUMENT and the WGSL; wgsl/includes.ts registers
                        #   it as celDither
    wgsl/
      includes.ts       # The shader text every surface shares, as Babylon WGSL
                        #   includes: celBand, celShadow, celGi, celProbe,
                        #   celProbeBox, celDither and our own celInstances
                        #   pair. Registered
                        #   at import, so a consumer imports it for the side
                        #   effect
      giTrace.ts        # The irradiance volume's three COMPUTE passes (trace,
                        #   compose, vis) and the params layout they share
                        #   with GiVolume. RayWorld's box and floor queries,
                        #   ported: the volume traces the COLLIDERS, never a
                        #   mesh
    WaterShader.ts      # Water ShaderMaterial: analytic wave trains DISPLACING
                        #   the grid and lighting it from one function, Fresnel
                        #   mirror, light cut hard on the waves, and the hole a
                        #   rotor tears in it. WGSL
    GrassShader.ts      # Blades BUILT in the vertex stage off the mask: the
                        #   keep threshold over rank, the lean, the gusts carried
                        #   downwind, bodies pushing through; and the turf's
                        #   material — a density RAMP blended over the floor,
                        #   its patches stitched edge to edge (`TURF_LODS`).
                        #   One lighting function for both. WGSL
    FlameShader.ts      # THE FIRE: every open flame's one material. Tongues
                        #   that boil on twos in hard bands, embers on the
                        #   smooth clock, and the glow-mask TWIN that runs the
                        #   same vertex stage so the bloom ties its depth. WGSL
    BlastShader.ts      # A BLAST's billow: lumpy (billow noise) sphere that is
                        #   fire in the flame's inks while hot, eaten from its
                        #   rim by LIT smoke as it cools, dissolved into wisps
                        #   at the end. Opaque, so the ink draws between
                        #   billows; thin-instanced; own glow-mask twin. WGSL
    Volumetrics.ts      # Light shafts: raymarched through the shadow volume,
                        #   capped at the light's colour and SCREENED onto the
                        #   frame so a thick map's glare stays gold. WGSL
    CloudShader.ts      # The cloud masses in cel TONES: lit mostly off the
                        #   lump's smooth normal so a terminator is one cut
                        #   line, shade pulled toward the dome's gradient behind
                        #   it, a highlight cut, a belly, a rim-only lining and
                        #   the dome's haze. WGSL
    MotionBlur.ts       # Camera-rotation smear, reprojected from the aim
                        #   angles. The viewmodel is held out of it by DEPTH —
                        #   masked shift AND weighted taps — because a gun
                        #   parented to the camera never moves in screen space.
                        #   WGSL
    PaperGrain.ts       # Vignette / aberration / damage flash, and a PAPER
                        #   grain pinned to the world through the frame's
                        #   depth: octaves fixed in world space, weighted by
                        #   distance. The player's setting is still stored as
                        #   `filmGrain`, which is what it used to be. WGSL
```
