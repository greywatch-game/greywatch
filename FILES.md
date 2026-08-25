# FILES.md

The module map, one line per file, stating what it owns. Split out of
[`CLAUDE.md`](CLAUDE.md), which is still the source of truth — it and the
subsystem contracts under [`docs/`](docs/) that it points to carry the rules
these modules obey; this file is for finding your way to the right one.

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
  Roster.ts           #   The sixteen slots, team balance, human<->bot handover
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
  parity.ts           #   Fingerprint dump for `npm run parity`
```
index.html          # The head, and NO interface CSS beyond the two things shown
                    #   while there IS no interface: a black background (so a
                    #   dev reload does not flash white) and the boot screen.
main.ts             # Bootstrap. Imports src/ui/base.css FIRST. Awaits the two
                    #   things the game cannot start without — WebGL2 and the
                    #   Havok WASM — then builds the Game. Owns the boot
                    #   screen: down on the first drawn frame, or one of the
                    #   three failure messages.
public/             # Copied to dist/ VERBATIM — unhashed URLs named by hand
                    #   (manifest.webmanifest, icons/ from `npm run icons`).
  regions.json      # Which match servers this deployment offers, by host. The
                    #   one file a deployer edits on the box: adding, moving or
                    #   draining a region is not a rebuild. no-cache in nginx
                    #   and exempt in the service worker, for that reason.
                    #   docker-compose.prod.yml bind-mounts the box's own copy
                    #   over this one, which is what makes "on the box" true
src/
  config/           # ALL tunable constants (no magic numbers in code).
                    #   One module per subsystem; import `CONFIG` from "…/config"
    index.ts            # Composes CONFIG from the sections. The ONLY importer of
                        #   them. A new tunable goes in a section, not here
    fogWall.ts          # FOG_WALL alone — bots.ts reads it, so it cannot live in
                        #   index.ts without an import cycle. The DEFAULT view
                        #   distance now: a map's own `fogEnd` overrides it, and
                        #   Game.installMap pushes that into the three systems
    conquest.ts         # Flags, capture meter, tickets, bleed
    score.ts            # What a kill, a bonus and a flag are worth on the
                        #   board. Spent by both simulations, so a value here
                        #   moves the offline round and the authority together
    bots.ts             # Bot AI + the nav grid (bots, nav)
    player.ts           # Movement, crouch, ground probe, vitals
    weapons.ts          # The weapon table, the round, gunfeel (weapons, combat,
                        #   gunfeel)
    recoil.ts           # What a shot does to the aim: the per-shot kick, the
                        #   string's two envelopes, recovery, stance
    sights.ts           # The optic table — its ORDER is the loadout row
    viewmodel.ts        # Where the weapon sits in front of the camera
    glass.ts            # Breakable glazing: the sweep's cap, the shard pool,
                        #   the size band a piece is cut to and how far one is
                        #   worth simulating
    grenade.ts          # The throw, bounce, fuse and blast — including the
                        #   eight layers the blast is DRAWN as, quoted for the
                        #   grenade, which every other explosion scales off
    equipment.ts        # The anti-tank slot: the launcher, the mines, and the
                        #   bots' launcher band. Two numbers per item — what
                        #   the HULL it struck takes, and the blast for
                        #   everything else — because one falloff cannot serve
                        #   a seven-metre vehicle and a one-metre body
    camera.ts           # Look, FOV, view punch, shake
    aimAssist.ts        # Controller aim assist and its three invariants
    input.ts            # Deadzones, curves, haptics — pad and phone alike
                        #   (input, rumble)
    touch.ts            # The on-screen controls: the stick's shape, what a drag
                        #   does to the aim, and how long a synthesized mouse
                        #   event is disbelieved after a finger
    audio.ts            # Levels, distances, rolloff for the synthesized mix
    graphics.ts         # Render pipeline knobs + pooled effects (graphics,
                        #   effects)
    hud.ts              # Minimap and damage arcs (minimap, damageIndicator)
    lighting.ts         # The dynamic light budget (uniforms, not Babylon lights)
    world.ts            # Map extents, occlusion, water, grass (map, ao, water,
                        #   grass)
    sky.ts              # The painted sky and moon shafts (sky, godRays)
    wind.ts             # The one wind: a shared bearing, and what the grass
                        #   field and the world's foliage each do with it
    teams.ts            # The two sides; index 0 is the player's
    vehicles.ts         # The one vehicle: its hull, drive, turret, gun, camera
                        #   — `climbHeight`, the one number deciding what a tank
                        #   drives over and what stops it — and `resist`, which
                        #   is where what each kind of damage is worth against
                        #   armour is written down (a rifle 0.05, a blast 0.3,
                        #   a shell 1 — and the AT kit fires shells)
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
                        #   and the clock that says which device is in hand
    CameraSystem.ts     # First-person cam at the eye; ADS zooms and slows by
                        #   the fitted optic, at the weapon's own rate
    Sfx.ts              # Procedural WebAudio, spatialised, voice-capped
    prefs.ts            # Remembered difficulty, map and loadout: the
                        #   localStorage round trip only. Ids that index a table
                        #   are validated, never trusted
    settings.ts         # Settings shape, defaults, localStorage. Applies
                        #   nothing — that is Game.applySettings, the ONLY
                        #   place a setting reaches whatever owns it
  entities/
    Player.ts           # Movement, sprint, crouch, jump, weapon state
    ViewModel.ts        # The first-person weapon: carried gun + gloved arms on
                        #   the camera, hip/ADS/sprint/reload/muzzle-load, sway,
                        #   bob, and
                        #   the kit turntable with the dark card behind it.
                        #   Builds every weapon, enables one
    weaponKit.ts        # The build accumulator every weapon model is written
                        #   in + WeaponParts and WeaponSights (rail, or fixed),
                        #   and the five colour groups a weapon merges into —
                        #   which are also what a finish repaints
    RifleModel.ts       # Low-poly SCAR-pattern battle rifle
    CarbineModel.ts     # Low-poly FAMAS-pattern bullpup burst carbine —
                        #   magazine behind the grip, carry-handle blade,
                        #   full-hand trigger guard, folded bipod
    SmgModel.ts         # Low-poly compact SMG — same contract
    DmrModel.ts         # Low-poly semi-auto marksman rifle
    LmgModel.ts         # Low-poly belt-fed light machine gun — feed cover and
                        #   split rail, box under the receiver, the exposed
                        #   brass belt, side-folded carry handle
    PistolModel.ts      # 1911 sidearm — the one weapon that does not call
                        #   optics.ts: no rail, so its notch and blade are its
                        #   own and are all it ever wears
    optics.ts           # The five optic assemblies, built onto whichever
                        #   weapon's OpticMount asked for them
    weapons.ts          # WeaponId + WeaponSetup, + SIDEARM/PRIMARY_WEAPON_IDS
    sights.ts           # SightId + magnification -> FOV, sensitivity, zoomComp
    equipment.ts        # EquipmentId + the resolution of an AT item into an
                        #   ordinary WeaponSetup (no fall-off, no spread, no
                        #   reload, `magSize` IS a life's ammunition) and into
                        #   the OrdnanceEffect a detonation is spent through
    finishes.ts         # FinishId + the four colour schemes each weapon is
                        #   offered, and the repaint over its colour groups.
                        #   The one kit table that decides nothing
    Combatant.ts        # Team + the shared shootable/shooter interface
    Tank.ts             # The one vehicle: the hull's collider (the only MOVING
                        #   `solid` mesh in the game, and invisible to the nav
                        #   graph for the reason a corpse is), the drive, the
                        #   ten TRACK CONTACTS it stands on and the rate-limited
                        #   climb that rides it over a car, the leading-end
                        #   collision sphere, the turret's slew, the gun's
                        #   clock, the springs behind its lean, its SPRUNG
                        #   body and its two whips, `rideableAt` (the climb band
                        #   spent on where the hull is ABOUT to be, which is the
                        #   whole of an AI driver's road graph), and what a
                        #   hull feels of each DamageKind. Knows nothing about
                        #   a player
    TankModel.ts        # ~180 boxes and cylinders merged to twenty-four, with a
                        #   SPRUNG body over running gear that is not, a
                        #   turret and a gun that turn, two link strips and a
                        #   toothed sprocket a side that RUN, two whip antennae
                        #   that BOW, and the charred repaint a wreck takes.
                        #   Art only — the extents that are RULES are CONFIG's
    callsigns.ts        # What to call an AI on the scoreboard: roster index ->
                        #   phonetic name, derived on both sides, never sent
    Bot.ts              # Bot FSM (advance/hunt/engage/takeCover/suppressed/
                        #   retreat/capture) + movement, aim, magazine, peek
    BotMemory.ts        # One bot's decaying picture of the fight
    SquadRadio.ts       # One TEAM's board: its squads' contact calls and the
                        #   marks its own deaths leave. Cues, never targets
    BotSkill.ts         # skill scalar -> BotProfile; difficulty tiers
    SoldierModel.ts     # Merged bot rig + the per-team kit it is painted and
                        #   shaped in + procedural animation (walk, aim, twist,
                        #   crouch), and the RagdollSubject interface
    NetSoldier.ts       # Somebody else, drawn from the wire: one rig, the
                        #   interpolation buffer behind it, the gait its boots
                        #   are heard off, no behaviour at all
    GrenadeModel.ts     # What a grenade looks like — body, fuse pip, and the
                        #   blink that reads the fuse. Built by the system that
                        #   simulates them and by the one that only draws them
    RpgModel.ts         # The launcher on the shoulder and the rocket that
                        #   leaves it. Built from its VENTURI, not its middle,
                        #   the one weapon with a `hipYaw` of its own, and the
                        #   one whose loaded ROUND is a node that comes out
    MineModel.ts        # The mine in the hands and the plate in the road. The
                        #   one thing in the kit that is not a weapon at all
  systems/
    BattleSystem.ts     # Bot pool, AI scheduling, LOS, distance LOD
    ConquestSystem.ts   # Flags, meters, tickets, bleed, spawns, planSquads
    ScoreBook.ts        # The round's board: points, kills and deaths, one row
                        #   per roster SLOT. A ledger, not a system — no update,
                        #   reaches nothing. One per simulation (Game offline,
                        #   HeadlessGame on the authority) and `awardKill` is
                        #   the one place a payout's shape is decided
    CaptureZoneSystem.ts# Flags drawn in the world: ring, skirt, beacon
    CombatSystem.ts     # Hitscan, fall-off, the head zone; pooled tracers, sparks, impacts
    GrenadeSystem.ts    # The one thing that isn't hitscan, and six of the
                        #   eight layers a blast is drawn as: the flash, the
                        #   fireball's lobes, the shock ring, the embers, and
                        #   BlastDust built TWICE — the low dust and the smoke
                        #   column. `blastAt` is the one blast in the game and
                        #   `drawBlast` the one place one is drawn
    AntiTankSystem.ts   # The AT kit in the world: the rocket pool (the SECOND
                        #   thing that isn't hitscan), the mine pool, the arm
                        #   clocks and the hull trigger. Owns no blast and has
                        #   never heard of a tank — it asks `hullNear` and
                        #   announces `onDetonated`, and Game spends both
    GlassSystem.ts      # Breakable panes: the segment sweep, the break, and
                        #   the amortised flow-field rebuild it owes. The one
                        #   mutable thing in the world, and monotonically so
    PhysicsWorld.ts     # The ONLY Havok in the game: the plugin, the map as
                        #   one static body, and the fixed-step clock. Owns no
                        #   bodies — its two clients do. Exports loadHavok(),
                        #   which main.ts awaits before there is a Game
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
    DeathCam.ts         # The player's own death; the only occlusion pick
                        #   outside combat
    VehicleSystem.ts    # The armour on the field: one hull per hardstanding, the
                        #   wreck clock and the respawn clock (two, so a side can
                        #   never field both), and where a dismount lands. Owns
                        #   no player and no AI — `update` asks a `VehicleOrders`
                        #   what is inside each hull and where the ones somebody
                        #   ELSE is driving got to, and `Game`/`HeadlessGame` are
                        #   the only things that can answer. A `predicted` fleet
                        #   is a netplay client's: both clocks stand down
    VehicleCamera.ts    # The view from twelve metres behind a hull: its own yaw
                        #   and pitch, its occlusion pull-in, and the gun's kick.
                        #   `DeathCam`'s shape — it produces an eye and a look
                        #   and `Game` hands both to CameraSystem.place. `aim`
                        #   and `place` straddle the world step on purpose
    TankCrew.ts         # The bots that drive: which body is in which hull, and
                        #   what it asks the hull to do. A crewed bot leaves
                        #   `Bot`'s FSM entirely (`BattleSystem.aside`) and
                        #   keeps its life, its position and its squad's order.
                        #   Steers on the body flow field for a BEARING and on
                        #   `Tank.rideableAt` for what is a wall; `evict` is
                        #   what stops the AI holding a side's only armour
    AimAssistSystem.ts  # Gamepad-only: outer bubble slows the stick, inner one
                        #   rotates. Bounded by the player's own turn rate
    LightingSystem.ts   # Dynamic point lights: fixtures, flashes, lamps
    ShadowSystem.ts     # Moon shadow map (stepped) + blob shadows
    ReflectionSystem.ts # The world as glass sees it: one cube per GLAZED
                        #   BLOCK, baked from the map's own geometry per
                        #   install with whatever encloses the probe left out,
                        #   and the box the shader parallax-corrects the
                        #   mirrored ray against. The only render target here
                        #   besides the shadow map
    Atmosphere.ts       # Ash field on the GPU. No CPU fallback — WebGL2 is a
                        #   hard requirement and guarantees it
    Sky.ts              # Generated dome, textured moon, fBm cloud decks
    WaterSystem.ts      # Water surfaces from map WaterRects; bakes their bed depth
    GrassSystem.ts      # Grass fields as one thin-instanced draw; tufts inside a
                        #   collider are rejected at scatter time
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
    mutate.ts           #   Layout writes: transform, fields, add/delete
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
                        #   map-data vocabulary, map-agnostic
    TerrainField.ts     # The floor's height and the ONLY place that knows it:
                        #   heightAt() + per-block VertexData + terrainSlab(),
                        #   and the BORDERLAND past the authored grid on a map
                        #   whose boundary is open
    Ridge.ts            # The valley rim, in two forms — an escarpment and the
                        #   downs. Shape only: no collider, nothing inside the
                        #   boundary it is handed
    leash.ts            # What stops a player leaving a map that has no wall:
                        #   one clock per body, and the verdict it reaches.
                        #   Pure — the caller does the killing, and offline that
                        #   is Game while in a match it is HeadlessGame
    rng.ts              # mulberry32 — the seeded PRNG world-building uses
    MapBuilder.ts       # Builds the map; merges visuals, emits colliders
    solid.ts            # SOLID_ONLY and OPAQUE_ONLY — the two pick predicates
                        #   every ray test in the game filters with, and the
                        #   read side of the flags MapBuilder writes. Where may
                        #   a body be, vs what stops a round or a look; the
                        #   three-way table of what a collider answers is here
    vertexShading.ts    # The world's baked vertex-colour buffer, written after
                        #   every merge: AO in the ALPHA, the world mark in the
                        #   GREEN, the wind's sway weight in the RED
    sway.ts             # Which foliage the wind moves and how much of it moves
                        #   at a given height. Marks, layers, the weight ramp.
                        #   A marked group leaves Babylon's outline pass and
                        #   gets an ink twin (MapBuilder.inkTwin) instead
    BuildingKit.ts      # Facade: shared types + BUILDERS registry
    kit/core.ts         #   Build accumulator (box/wall/guard/flight/...),
                        #   palette, builder contract
    kit/buildings.ts    #   cottage, townhouse, tavern, smithy, ruin,
                        #   watchtower, chapel, barn, mill, boathouse,
                        #   gatehouse, stiltHut, jungleRuin
    kit/manor.ts        #   manor — the two-storey colonial house with the
                        #   wrap-around gallery. Its own file: bigger than the
                        #   rest of buildings.ts together
    kit/structures.ts   #   silo, well, stall, fence, stoneWall, bridge,
                        #   trestleBridge, templeRuin, haystack, lamp, cart,
                        #   crates, woodpile, shed, trough, shrine, kiln
    kit/terrain.ts      #   terrace, ramp, road, jetty, boardwalk, stairs
    kit/city.ts         #   tower, office, shophouse, depot, parkade, planter,
                        #   barrier, car, streetLight, monument — the downtown
                        #   set, and the only builders that stack WALKED floors.
                        #   Its header owns the four rules that makes necessary,
                        #   what each of the five buildings is FOR, and the
                        #   collider budget an enterable one is spending
    NavGrid.ts          # Walkable-surface graph + precomputed flow fields
    CoverMap.ts         # Baked per-surface directional cover masks
    boxGeometry.ts      # Analytic WorldBox primitives, shared by NavGrid /
                        #   ObstacleField / CoverMap
    ObstacleField.ts    # Sub-cell collision push-out for thin props, and two
                        #   bucketed queries over the same boxes: `groundAt`,
                        #   what a track contact stands on (the player's probe
                        #   is still a ray — see FINDINGS.md 6), and `wallAt`,
                        #   its mirror — what is IN THE WAY, which is what an
                        #   AI driver's whiskers ask
    boxIndex.ts         # The build-time uniform grid over collider boxes, so
                        #   scatter placement and the occlusion bake stop
                        #   walking all of them
    Props.ts            # Scatter props: trees, graves, rubble, braziers,
                        #   boulders, brambles, barrels, and the understory —
                        #   ferns, fallen buttress logs, carved stelae — plus
                        #   the mid-story, the liana veil, which is NOT a
                        #   scatter prop: the jungle tree hangs it off its own
                        #   fronds, because scatter placement is what pushed it
                        #   away from every crown on the map
    textures.ts         # Generated canvas textures: the cobbles, and the floor
                        #   surfaces — noise fields posterized onto a ramp of
                        #   the map's floorColor, albedo and height in one pass
    floorSurfaces.ts    # What the valley floor is MADE of: the surface roster
                        #   and the ONE place a floor material is built
    environment.ts      # EnvironmentSpec + applyEnvironment
    maps.ts             # MapDef + the MAPS registry. The only EXISTING file a
                        #   new map has to touch (plus vite.config's WRITABLE)
    collision.ts        # MapCollision: the shape of a baked collider set, and
                        #   the tuple->WorldBox expansion the server rebuilds
                        #   from. Names no map; reached via MapDef.collision,
                        #   which is a LAZY import so the client never ships it
    fingerprint.ts      # A comparable summary of a built world — the nav graph,
                        #   not the boxes. What `npm run parity` diffs
    hollowmere/layout.ts      # A MAP — every placement, flag and spawn
    hollowmere/heights.ts     # GENERATED floor heights (editor terrain mode)
    hollowmere/environment.ts # Palette, fog, mist, particles — night
    hollowmere/collision.ts   # GENERATED collider boxes (`npm run collision`)
    greyfen/layout.ts         # The second map, being built: the jungle manor
                              #   on C, a stilt-hut settlement and a temple on
                              #   the other flags, and the trestle over the river
    greyfen/heights.ts        # GENERATED floor heights — a Y-shaped river,
                              #   wadeable everywhere (banks grade at 0.22)
    greyfen/environment.ts    # Palette, fog, sun, sky, shafts — a jungle
                              #   morning two hours after sunrise
    greyfen/collision.ts      # GENERATED collider boxes (`npm run collision`)
    coldharbour/layout.ts     # The third map: a city's business district. The
                              #   first that is not 240 m (`size: 320`), the
                              #   first that stacks floors (`surfaces: 4`) and
                              #   the only one with `vehicles` on it
    coldharbour/heights.ts    # GENERATED floor heights — dead level under the
                              #   city, a 1.2 m skirt into the rim outside it
    coldharbour/environment.ts# Palette, sun, sky — a clear afternoon, and the
                              #   first map with no fog wall (`fogEnd: 480`)
    coldharbour/collision.ts  # GENERATED collider boxes (`npm run collision`)
    harrowmead/layout.ts      # The fourth map: a farming town in a green
                              #   vale. The largest yet (`size: 400`) — five
                              #   farmyard flags in rolling, hedged country,
                              #   and the second map with armour on it
    harrowmead/heights.ts     # GENERATED floor heights — rolling hills and a
                              #   stream carved to a constant wadeable bed
    harrowmead/environment.ts # Palette, sun, sky — high summer, late
                              #   morning, no fog wall (`fogEnd: 520`)
    harrowmead/collision.ts   # GENERATED collider boxes (`npm run collision`)
  ui/                   # One .css beside each module that writes markup
    base.css            #   Reset, canvas, #hud root, and ONLY primitives two
                        #   or more screens share — including THE SHELL every
                        #   screen between the title and the world is framed
                        #   in: .ui-screen (head / body / foot, edge-anchored,
                        #   fluid), .ui-veil (+.ui-solid over another screen),
                        #   .ui-rail, .ui-panel, .ui-facts, .ui-foot.
                        #   Imported by main.ts
    HUD.ts/hud.css      # Gameplay chrome ONLY: tickets, flags, capture panel,
                        #   vitals, ammo, the stowed slot, crosshair, killfeed,
                        #   score feed, scoreboard, damage arcs, +
                        #   .paused/.editing/.dying
    OverlayScreen.ts    # The four cards — menu, round-over, pause, building —
      overlay.css       #   the .overlaid class they raise, and #menu-shot, the
                        #   map photograph the menu stands on: a second root of
                        #   its own so it survives the card being rewritten and
                        #   stays UNDER the veil. The menu is a
                        #   LIST: MENU_ITEMS is the cursor's whole world, drawn
                        #   as a rail with a PANEL beside it describing the row
                        #   the cursor is on. The pause is the one card that
                        #   does not take the screen — left-anchored over a
                        #   round that is still worth seeing
    MapThumb.ts         # The menu panel's map schematic, drawn from a map's
                        #   LAYOUT (heightfield relief, water, scatter masses,
                        #   placements, lettered flags) and coloured from its
                        #   EnvironmentSpec. Never touches a built GameMap —
                        #   the menu is the one screen where there is none.
                        #   A water rect is an extent, not a shape: the
                        #   waterline is baked from the heightfield here the
                        #   same way the real bed depth is
    mapShots.ts         # The PHOTOGRAPH behind the menu: one shot per map
                        #   (shots/<id>.jpg, imported ?url) and the VANTAGE it
                        #   was taken from, which is what lets `npm run shots`
                        #   retake it rather than hunt for the frame again. A
                        #   map with no row here simply has no backdrop. Not a
                        #   field on MapDef, because the SERVER imports those
    DeployScreen.ts     # Top-down deploy map, with the orders panel beside it
      deploy.css        #   rather than under it. The offer is live, so the
                        #   highlight is held by IDENTITY; in a netplay round a
                        #   confirm is a REQUEST and says so
    LoadoutScreen.ts    # Kit screen: two slots, a stat chart derived from
      loadout.css       #   CONFIG.weapons, and the turntable stage
    SettingsScreen.ts   # Controls built from a ROW TABLE, in PAGES — a button
      settings.css      #   group, or a slider where the ladder is too long for
                        #   one (the thumb picks an option INDEX, so both are
                        #   the same choice). Row 0 is the page selector, which
                        #   is why tabs need no key of their own; the Controls
                        #   page carries the key-cap table the menu used to.
                        #   Owns no setting: picks leave through onChange and
                        #   return as setValues
    LobbyScreen.ts      # The match browser: every region's matches in one list
      lobby.css         #   with a region column and a ping per row, plus
                        #   region/map/new/refresh/back. Rows are DERIVED from
                        #   the results, and everything off a network is written
                        #   with textContent. Fetches nothing — Game hands it a
                        #   region list and each region's answer as it lands,
                        #   and takes onJoin/onCreate/onPickRegion/onPickMap
                        #   back. A match row is a REGION and an id (ids are
                        #   minted per process, so every region has an m1). The
                        #   Region and Map rows are what a match CREATED here
                        #   starts in and on; joining one takes that match's
                        #   server and map, and onJoin carries both. One region
                        #   collapses it to the three-column screen it was
    Minimap.ts          # Corner minimap, player-centred and heading-up: flags,
      minimap.css       #   friendlies, firing enemies, and a rim marker for
                        #   every control point the zoomed view does not reach
    TouchControls.ts    # The on-screen controls a phone plays with: a FLOATING
      touch.css         #   movement stick in the left zone, a look DRAG in the
                        #   right one, and the button cluster over both. A
                        #   DEVICE, not a screen that acts — InputManager polls
                        #   it (setTouchSource) exactly as it polls a gamepad,
                        #   so nothing in gameplay has heard of it. The one
                        #   thing on it that is not input is the pause button,
                        #   which a phone has no Escape key for. Game pushes the
                        #   two states it draws but cannot know (crouched, and
                        #   the magazine wanting attention) and decides when it
                        #   is up: `playing`, and only while touch is the
                        #   device in hand
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
                      #   HARDSTANDING, feeding Tank.updateRemote. Owns no hull
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
    CelShader.ts        # Custom cel ShaderMaterial + outline helper
    OutlineFog.ts       # Bakes the map's fog into Babylon's outline pass, so
                        #   ink fades per PIXEL instead of per merged mesh
    EmissiveFog.ts      # The same fog as a material plugin on every unlit
                        #   emissive material — windows, flames, tracers
    Dither.ts           # One LSB of triangular noise, pasted into the three
                        #   surface shaders. Fixes 8-bit banding in the fog
    WaterShader.ts      # Water ShaderMaterial: analytic wave trains, Fresnel mirror
    GrassShader.ts      # The blade bend: wind, and combatants pushing through
    GodRays.ts          # Moon shafts: screen-space radial blur
    MotionBlur.ts       # Camera-rotation smear, reprojected from the aim angles
    HorrorPost.ts       # Vignette / grain / aberration / damage flash
    glslScaffold.ts     # SCAFFOLDING for the WebGPU port, and all of it: the
                        #   three things that are only true while the engine is
                        #   WebGPU and every shader here is still GLSL. Deleted
                        #   whole when the last one is ported
```
