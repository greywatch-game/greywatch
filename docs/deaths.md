# Deaths: the one physics engine, and the death cam

Havok's only appearance in the tree — what a ragdoll may and may not touch, and
why there is nothing standing behind it — and the four seconds after the player
is killed. Split out of [`CLAUDE.md`](../CLAUDE.md), which keeps the summary;
this file is the contract for `PhysicsWorld`, `RagdollSystem`, `DebrisSystem`
and `DeathCam`.

## Havok is required, and the boot screen is where that is enforced

`main.ts` awaits `loadHavok()` and hands the instantiated module to `Game`,
which hands it to `PhysicsWorld`'s constructor. A rejection is a boot-screen
failure message of its own, beside the WebGPU adapter probe's — the game does
not start.
So there is no state anywhere below in which physics has not arrived, and
nothing has to ask.

**It was optional and the optional version is what this replaced.** The WASM was
fetched from inside the `Game` constructor and never awaited, so every falling
thing needed a second way to fall: `Bot`'s collapse tween for a body, a scripted
ballistic arc for a burst of shards, `animateSoldier`'s `dead` arm to pose the
first, `death.collapseTime` to time it, a `ragdolls` setting to choose between
them, and a `PhysicsWorld` that could stand up, tear down and stand back up
mid-round. What it bought was a case that does not happen: the binary is
precached with the rest of the build, and a machine that cannot get 2 MB of
WASM is not going to run a WebGPU shooter either. What it cost was two code
paths for every death, one of them exercised only where nobody was looking.

**Do not reintroduce a fallback.** If the engine is a problem the answer is that
the game does not start, which is a sentence on the boot screen rather than a
second renderer for corpses.

## The engine is a system of its own, and owns no bodies

`src/systems/PhysicsWorld.ts` holds the `HavokPlugin`, the map as one static
body and the fixed-substep clock. It is the only place `@babylonjs/havok` is
reached and the only place `_step` is called. It has three clients —
`RagdollSystem` for corpses, `DebrisSystem` for the shards a broken pane throws,
and `BlastDebrisSystem` for the rubble a blast tears out of the ground — and all
three are handed it by `Game` in their constructor, which is the
`BattleSystem`←`CombatSystem` precedent in `CLAUDE.md`: injected, never imported
system-to-system. **The three pools are one budget** (80 corpse bodies, 48
shards, 30 chunks) and want raising together or not at all.

**It was `RagdollSystem`'s privately, and the split is not tidiness.** Two things
made a second consumer impossible rather than merely awkward, and both would
have failed silently:

- **The step ran only while a corpse slot was unfrozen.** A shard would have sat
  motionless whenever nobody was dying. That test is now a register: each client
  answers `physicsActive()` and the engine advances if anybody says yes, so a
  quiet round still costs nothing at all.
- **The plugin was a private field**, so the alternative was a second
  `enablePhysics` on the same scene, which is not a second world but the same
  one with two owners.

There was a third and it is now moot: the ragdoll SETTING called `clearWorld()`,
so glass would have fallen through the floor for anyone who turned corpses off.
That setting is gone with the fallbacks it chose between, and the teardown it
abused belongs to the map alone — `setMap` is its only caller, which is why the
client hook is named `worldCleared` rather than `physicsStopped`.

Two things stayed with the clients rather than moving. `afterFirstStep` — the
teleport read-in, one substep into a frame and no further — is per client
because each owns its own freshly-spawned bodies. And the pool each builds is
its own, built in its own constructor now that the engine is up before either
system exists, for the reason both are built up front at all: a shape or a
constraint made at the moment it is wanted is a hitch on the worst frame
available.

**Collision groups are allocated in one place.** Bit 0 is the world's; slot `i`
of the ragdoll pool takes `1 << (1 + i % 30)`, so bits 1 through 30; and
`DEBRIS_GROUP` is bit 31, shared by every shard and masked to the world alone —
shards must not shove corpses (a body knocked over by falling glass is a corpse
DECIDING something) and shard-on-shard buys a pile nobody looks at for a solver
cost quadratic in the burst.

## Deaths

A killed bot falls under that engine (`src/systems/RagdollSystem.ts`), and so does
the stand-in body the death cam stands up. It buys nothing but the fall:
**nothing here feeds navigation, cover or hit detection.** A corpse is not in
`NavGrid`, not in `ObstacleField`, not in `hittablesAgainst`; bots walk through
bodies and rounds pass through them. Do not "fix" that by feeding corpses into
`ObstacleField`, whose buckets are baked at map load and change for exactly one
reason that is not this one (see `BoxSpec.glass`).

**There were five refusals and there is ONE.** The WASM not having loaded, the
WASM having failed and the setting being off are all answered by the boot gate
above; a full pool no longer refuses but evicts (see below). What is left is a
death past `death.maxDistance`, and that number has to be exactly where a rig
stops being drawn rather than merely near it — because a body refused inside the
fog would stand where it died until `death.hideTime`, with the tween that used to
lay it down gone. `Bot.update`'s dead branch is what remains: while a ragdoll owns
the joints it stands aside, and otherwise it hides the rig on the clock and poses
nothing.

That tween was exempt from the pose-freeze LOD *because it was five property
writes*; **a ragdoll needs no such exemption**, because it poses through the proxy
nodes its joints are parented to and the solver writes those whatever the LOD says.
Reading those two as one fact is what pinned `maxDistance` to `lodFreezeDistance`
(35) and stopped anything dying across the square from falling over at all — a
marksman rifle's whole range. The two are still not the same question, and the
distinction is why `maxDistance` may only ever be `lodDisableDistance`.

**A crouch was a sixth refusal and is not one any more, and what bought it back is
the bone table.** A leg was ONE rigid 0.72 m bone oriented by the hip joint, which a
folded leg is nowhere near, so a body caught mid-crouch had to be refused and take
the tween that then existed — which meant the one stance a player holds while being
shot at was also the one stance that could not fall over. There was no pose that
fixed it either:
straight legs under lowered hips reach through the floor, and lifting the hips to
meet them is half a metre of pop on the frame of death. So the leg became three
bones — thigh, shin and boot, hung off the same hip, knee and ankle the crouch bends
— and the proxies take whatever pose the rig is already in. Measured on a body
killed at a full crouch: the knee is thrown holding its drawn 2.58 rad fold, keeps
it through the first steps rather than being snapped straight, and the corpse settles
on its side still curled. A standing body is unchanged — every joint within 0.06 m of
the floor's height, legs straight to 0.05 rad. Three things go with it and are the
part that is easy to get wrong:

- **A joint limit must CONTAIN the pose a body can be thrown in.** The standing pose
  is the zero of all three angular axes, and the knee reaches 2.58 rad from there;
  a range that stopped short would have the solver straightening a leg on the frame
  of death, which is the pop this feature exists to remove arriving through the fix
  for it. The ankle's -1.39 rad is likewise the DRAWN crouch's and not anatomy's.
- **A bone hangs off its parent bone, not off the chest.** `BoneLink.parent` is what
  says so and the pivot is in that parent's frame. Pinning a shin to the torso
  instead holds it at a fixed offset from the ribs and lets it swing there — a corpse
  whose knee is a second hip.
- **A corpse does not collide with itself**, because a folded leg lays the shin along
  the thigh and puts the boot inside it, and a body that shoved its own limbs apart
  on the frame it was thrown is worse than one that clips. Each pooled slot owns its
  bone shapes in its own collision group (bit 0 is the world's, slot `i` takes bit
  `i + 1`) — which is also why the shapes are per slot rather than one set shared by
  every corpse: the mask lives on the SHAPE, so sharing them could only turn every
  body's self-collision off together with every corpse-against-corpse one. Two
  corpses landing on each other still collide.

The four extra bones cost nothing measurable. One harness, run either side of the
split — a whole death's 150 substeps timed end to end, median of seven trials —
gave eight falling corpses 0.279 ms/step at six bones and 0.290 at ten, inside a
trial spread of 0.24-0.42. Those absolutes do not line up with the ones
`maxConcurrent` carries below and are not meant to: different harness, different
session, and headless absolutes are inflated anyway. The PAIR is the measurement.

**The gate is the FOG WALL, and it is one number for everything that stops at it
— the MAP's number.** Three systems gate on the same distance for the same
reason (there is nothing to see past it): `BattleSystem`, where a rig stops being
drawn; `NetRoster`, the same call for a body coming off the wire; and
`death.maxDistance` here, one metre past which the solver would be tumbling
something nobody can see. `BattleSystem` wrote its own `78` out by hand before
any of this, which is how the ragdoll gate came to be keyed off an unrelated LOD.

What each of the three now holds is a FIELD that `Game.installMap` pushes
`EnvironmentSpec.fogEnd` into, and `FOG_WALL` in `config/fogWall.ts` is what they
carry before a map is installed. It used to be the answer, with a dev warning
when a map's `fogEnd` disagreed — and the disagreement is now the point:
Coldharbour has no fog wall at all, sees 480 m, and a body vanishing at 78 there
would vanish in plain sight. `config/fogWall.ts` is still its own module for the
original reason (`config/bots.ts` reads it, and taking it from `index.ts` would
be an import cycle).

**A full pool EVICTS rather than refusing, and `takeSlot` is three tiers deep**: a
free slot, then a sinking one, then the OLDEST corpse. Only the last costs anything,
and it is the corpse nearest its own sink and so the one with least left to lose.

This was the death cam's private exception, passed as a `priority` flag from the one
wiring site allowed to pass it. A bot's corpse is one of sixteen; the player's is the
sole subject of a four-second shot, and a slot is held for the whole `sinkStart`
(5 s), so a handful of nearby deaths inside five seconds — which is what a firefight
the player lost looks like — locked the pool and spent that shot on a body standing
to attention. Measured at the time: a corpse 0.65 m from the camera refused outright,
and accepted on the same offer once the four bot corpses had aged past `sinkStart`.

**It is everyone's now because a refusal has nothing to fall back to**, and taking
the OLDEST is what keeps that safe rather than arbitrary — it protects the death
cam's body for free, since that body is the freshest in the pool for the whole four
seconds the camera is on it and is therefore the last one an eviction can reach. What
this gives up is `GrenadeSystem`'s "refuse rather than steal a live slot", and it
gives it up knowingly: a corpse yanked mid-tumble is a pop, but so is a corpse that
never fell, and under a pool eight deep only the second one actually happened.
`DebrisSystem` still keeps the old rule, because a burst that never played is a
window that broke without a flourish and nobody can point at it afterwards.

**`maxConcurrent` is what bounds the cost, and it is measured, not reasoned.** Eight
falling corpses are 0.121 ms/frame against the whole roster's AI at 0.39–0.42 ms in
the same run — taken on the six-bone body, and the leg split that followed did not
move it; a settled one is 0.0004 ms because the engine is not stepped at all, and
unused slots are free (four corpses cost the same in a pool of four and a pool of
eight). Raising the DISTANCE is what makes the pool busier — raise the two together.
FINDINGS #8's older 1.37 ms for four does not reproduce; see the note there.

- **`scene.physicsEnabled` is FALSE and must stay false.** Babylon steps physics
  from `scene.animate()` on every RENDERED frame, and this game renders in every state
  — so a scene-driven step would leave corpses tumbling under the pause card, under the
  deploy map and behind the menu. `PhysicsWorld.update` steps the world by hand and
  is called only from `Game.updateGameplay` and `updateNetWorld`, which is what a
  pause already stops. Measured: bit-identical body position across 12 rendered
  frames while paused, corpses and shards alike.
- **Havok never touches a rig node.** It writes pool-owned PROXY `TransformNode`s
  and the rig's joints are parented to those. Havok's sync calls
  `decomposeToTransformNode` on any node with a parent, which force-creates a
  `rotationQuaternion` — and while one is set Babylon ignores `rotation`, which is what
  `animateSoldier` writes. One leaked quaternion is a bot that respawns frozen
  mid-tumble for the rest of the round with its position still updating underneath.
  `setParent` is safe in both directions (verified: it writes Euler when there is no
  quaternion), which is what makes the hand-off and hand-back clean.
- **`resetSoldierPose` is the authoritative restore, and `animateSoldier(rig,
  0,0,0,0, 0)` is not a substitute.** That call writes ten Euler channels; the rig has
  far more, and never a `parent`, a `rotationQuaternion`, a `scaling` or anything on
  `gun`. `Bot.spawn` calls the former. Verified across three lives on one rig — a leak
  shows on life 2.
- **The map is registered as ONE static body** — a `PhysicsShapeContainer` of the
  ~733 collider boxes plus the 25 terrain blocks as mesh shapes (the floor has no
  `WorldBox`, hence `GameMap.terrainColliders`). Built in `installMap`, skipped on
  editor builds, and torn down leaf by leaf or the WASM heap grows one map build at a
  time. Measured 33–50 ms headless, and 25 bodies flat across three rounds. **A
  pane of glass is in it like any other collider and stays in it after it
  breaks**: this body is what a corpse and a shard land on, and neither decides
  anything, so a shard resting against glass a round took out is a cosmetic
  wrongness lasting a second — against rebuilding a 33–50 ms compound on the
  frame somebody shot a window.
- **The knee and the ankle are bones and the rifle is not**, which is the same
  question answered twice: a bone is worth having where the RIG can already put the
  joint somewhere the one box could not follow. The crouch bends knees and ankles, so
  they earn one each.
- **The rifle is not a bone.** It stays parented to `torso` and rides that body.
  Giving it one drops it out of hands that cannot open — the arm is a single welded
  segment with no elbow, wrist or finger — so the weapon falls away while two fists
  stay cupped around nothing.
- **A corpse sinks; it cannot fade.** The cel shader writes alpha 1.0 outright and
  its materials are shared per COLOUR by `CelMaterialFactory`, so an alpha write would
  dim every bot on the map.

The bone table, pivots and joint limits live in `SoldierModel.ts` with the boxes
they are measured from; `CONFIG.bots.death` owns the sim (impulse, gravity, damping,
corpse life). The impulse needs no new plumbing: `takeDamage` is already handed the
shooter's origin (or the blast centre) and what delivered it, so `Bot` captures
`deathFrom`/`deathDamage`/`deathKind` there and `Game.registerBotKill` offers the
body to the pool.

## The throw is TWO throws, and a round is not an explosion

**A round is a BLOW and an explosion is a VELOCITY.** That is the whole of the
split in `RagdollSystem.applyImpulse`, and it is why `CONFIG.bots.death.impulse`
has a second row rather than a multiplier on its first. A rifle round arrives at
a point: the top-level figures are a newton-second on the CHEST, applied `lift`
above its centre of mass so the fold falls out of the geometry, and the nine
other bones follow because they hang off it — a body dropped where it stood. A
blast arrives on all of a body at once, so `impulse.blast` is a SPEED, spent as
`speed * mass` on every bone at its own origin. Every bone leaves at the same
velocity and nothing is dragged through a joint to catch up.

**Putting a blast's whole throw on the chest instead is a body coming apart, not
a body thrown**, and that is the trap worth naming: 34 kg of torso leaving at 12
m/s with nine limbs on constraints behind it is a corpse with its legs trailing
a metre back. The units differ between the two rows for the same reason and the
config says so — do not read `blast.max` as another 22.

**How far it flies is `deathDamage`, and nothing had to be plumbed to make that
true.** `GrenadeSystem.blastAt` scales its damage by the falloff before
`takeDamage` ever sees it, so what a corpse recorded is already the strength of
the explosion AT THE PLACE THE BODY WAS STANDING. A frag at the feet throws
further than one across the street, a rocket further than the frag and a tank
shell further than either, with no second number to keep in step with `power` —
which stays what it has always been, the SIZE OF THE PICTURE and nothing else.

**`rise` is added to the UNIT direction**, so it means an angle and not a
distance. Without it a charge going off level with a body — on a windowsill, on
a parapet, against the far wall of a room — skids it along the floor, and what a
blast does to a man is take him off it.

Measured on Hollowmere's open ground, a body killed standing with the blast two
metres away at ankle height, horizontal distance travelled before the corpse
freezes:

| what killed it | damage recorded | flew |
| --- | --- | --- |
| rifle round | 34 | 0.12 m (it folds where it stood) |
| a frag's fringe | 30 | 1.6 m |
| a frag at the feet | 130 | 4.2 m |
| a rocket's splash | 220 | 7.2 m |
| a tank shell | 350 / 600 | 8.6 m (both at `blast.max`) |

A grenade that goes off directly UNDERNEATH a body is the one case that reads as
no throw at all, and it is right: the direction is straight up, the body is
lifted about a metre and a half and comes down on the spot it stood on.

**`DamageKind` is the vocabulary and the test is "not a bullet"**, never a list
of the kinds that are explosions — a new one is thrown without this file having
to be told about it. `blast` is the grenade's, `shell` is the tank's gun, its
splash, both anti-tank items and a HULL BREWING UP with somebody inside it
(`docs/vehicles.md`, "four ways out"), and only `bullet` folds.

**The pool holds `RagdollSubject`s and cannot tell the two kinds apart.** That
interface lives in `SoldierModel.ts`, beside the rig and bone table it is a fact
about — not in `RagdollSystem`, because `DeathCam` needs it too and a system may not
import another one. `Bot` satisfies it structurally and imports nothing, which keeps
`Bot.ts` free of any knowledge that a physics engine exists. `retire(subject)` is
the one thing the player's corpse needs that a bot's does not: a bot's body outlives
the death cam's window and goes on its own clock, while the player's has to be gone
before the deploy screen comes up over it.

## Glass shards

`DebrisSystem` is the engine's second client and follows every rule above, with
four differences worth stating because each one is the corpse rule NOT applying.

**A shard is a fraction of its PANE, and that is the whole feature.** It threw
twelve 16 cm chips into an 0.8 m cube at the crossing point, whatever it had
just broken — which reads against a small punched window and is absurd against a
shopfront: several square metres of glass vanish in one frame and a handful of
gravel appears where the round went in, so the eye reads the pane as deleted
rather than broken. So `burst` takes the `WorldPane` and cuts the burst from it:
`glass.shards` pieces out of the sheet's own face, laid out ON it, in its plane,
before they are thrown, so at t=0 the burst is very nearly the sheet that was
standing there and the next quarter second is it coming apart. Where a pane is
bigger than a burst the pattern is centred on the hole and clipped to the face
rather than spread thin across it — twelve pieces over ninety square metres is
confetti — and **the right fix for a pane that big is a smaller pane**: see
`kit/city.ts`, whose shopfront breaks a bay at a time, the unit its own piers
divide the elevation into.

**The pieces are CUT, and a cut is not a grid.** They were rectangles first: the
face divided into cells of `sqrt(area / shards)`, a piece filling `shardPack` of
each, twelve of one size square to the frame in rows. Every rule around it was
already the right one and a shatter still read as a mosaic sliding out of a
wall, because a sheet does not fail on a grid — it fails from the point the load
went into it, along RADIALS out of the hole crossed by CONCENTRIC rings, and
what falls out is wedges. `src/systems/glassFracture.ts` is that pattern and
nothing else: `sectors` radials, `rings` concentrics, both jittered, and the
piece between each crossing. Four details carry it — the corners are SHARED so
the pieces tile (draw each its own and the jitter that makes them irregular
opens gaps between them, which at t=0 is a heap rather than a cracked pane);
there is an unbroken HOLE at the impact, which is the part of a real sheet that
leaves as dust; the pattern is CLIPPED to the frame rather than fitted to it, so
a piece may have five corners or eight and a burst near a mullion has a straight
edge down its side; and `shardPack` shrinks each piece about its own centroid,
which is what opens the cracks themselves. Measured on Coldharbour's 4.3 x 2.9 m
bay: twelve pieces of 0.10–1.46 m², four to six corners each, 63% of the pane's
own area, and the pitch they are cut at is still `sqrt(area / shards)` clamped
to `[shardMin, shardMax]`.

**A pattern that hangs off the frame reaches further rather than losing its
budget.** A round through the corner of a bay puts most of a centred disc
outside the glass and the clipped pieces are gone from the burst — eight over a
quarter of the sheet, where a round through the middle throws twelve over two
thirds of it. Cracks do not stop because the sheet is not centred on them, so a
short burst is re-cut with the reach it needed, twice at most. It is also why
`fracture` may hand back fewer pieces than the budget and the caller must ask
how many rather than assume.

**A sheet leaves its frame along its own NORMAL**, and the round drags glass
along its own path only WITHIN the plane. That is not only how a pane fails, it
is what keeps the pieces off the frame and the piers either side of them. Which
side it leaves BY needs no question asked, because every pane that breaks is a
way THROUGH (see `PaneSpec.breakable`): the glass goes the way the round went,
into the room the shot has just opened. It was a question once, when the city's
decorative glazing broke too — a sheet hanging 4 cm off a solid shaft had to
throw its pieces back toward the shooter, the one side provably open, or Havok
spent the first frames shoving bodies out of the concrete they were spawned
inside. That glass no longer breaks, so the case is gone rather than handled.

**The collision box is thicker than the piece it stands for**
(`glass.shardCollide`, 0.09 against a 0.02 m sheet). The floor is a mesh shape
per terrain block and a 2 cm body slips through the seams between them: measured,
one or two pieces of every twelve landed, slid, and then sank through the road
for the rest of the burst. The cost is a piece lying ~3 cm proud of what it
landed on, which nothing about a dark plate on a dark road shows.

**A shard's body is on the MESH, with no proxy node.** A ragdoll needs proxies
because Havok's sync force-creates a `rotationQuaternion` on any node with a
parent and the rig is posed through Euler channels; a shard is parented to
nothing, posed by nobody and handed back to nothing, so the quaternion Havok
writes is the only thing that ever orients it.

**The outline is in the VERTICES, and the topology is fixed even though the
outline is not.** The mesh was a unit box with `mesh.scaling` for a size, which
that same sync makes safe — it writes position and orientation onto an
unparented node and leaves scaling alone — but a scaling cannot express a
polygon. So every shard mesh is an eight-cornered prism built once (the bound is
exact: a convex quad clipped against four half-planes gains at most one corner
per plane), and a burst rewrites its 48 vertices in a buffer the mesh already
owns. A piece with fewer corners repeats its last one, which leaves the spare
triangles degenerate — the same trick `GlassSystem.collapse` takes a broken pane
off the screen with. Each shard owns its own position and normal arrays rather
than sharing a scratch pair, because Babylon keeps the array it was handed as
the mesh's CPU-side copy. The body is still sized by its SHAPE, cached by
rounded extents, and the step is 0.1 m: a cut makes every piece a different size
where the grid made twelve of one, so the rounding is coarse on purpose against
a cache that would otherwise grow all round.

**The distance gate is its own number, not the fog wall — and it is an apparent
size.** The three systems that share `EnvironmentSpec.fogEnd` are asking "can
anything be seen at all", and on Coldharbour that is 480 m. A 16 cm chip is a
pixel at sixty metres and a 1 m panel is not, so `CONFIG.glass.shardDistance`
(150) is quoted for a piece of `shardMax` and everything smaller gates nearer in
proportion — 0.35 m pieces stop at ~44 m. **The BREAK is not gated
by it**: the pane goes at any range, because that is the world changing rather
than an effect playing.

**The pool EVICTS, but only what has already landed.** It refused outright
first, on `GrenadeSystem`'s rule — but a refused burst is a window that came out
of a building with no glass in it, which is the mismatch this system exists to
stop. `glass.shardSteal` (1.6 s) is the compromise: a burst still in the air is
never stolen, because glass that vanishes mid-fall is worse than glass that never
flew, while one lying on the pavement is fair game.

The budget is one budget with the corpses'. `glass.shards` (12) times
`glass.maxConcurrent` (4) is 48 bodies, about five corpses — against eight
corpses (80 bodies) measured at 0.121 ms/frame with the whole roster's AI at
0.39–0.42 ms in the same run. Raise either and raise the other knowingly.

**The pool is one phase, and it used to be two.** The meshes were built in the
constructor and `attachBodies` hung rigid bodies on them from a `physicsStarted`
callback, so a window broken before the WASM landed still threw shards on a
scripted ballistic arc with the terrain as a floor. The engine is up before this
system is constructed now, so `buildPool` makes the mesh and its body together
and a shard has never existed without one. It is still not built on the frame a
window breaks: 48 meshes, their GL buffers and their shapes are not a cost to pay
on the frame somebody pulled a trigger, which is `DeathCam`'s reason for
building its stand-in rig at `startRound`. What a burst DOES pay for on that
frame is a `cut` per piece — a rewrite of vertices the mesh already has, and
never a geometry, an index buffer or, once a size has been seen, a shape.

## The death cam

`Game` goes `playing -> dying` before the deploy map: a body is stood up where the
player fell, thrown by the round that did it, and the camera leaves the head to
watch it land (`src/systems/DeathCam.ts`, `CONFIG.player.deathCam`).

**It is a step in the state machine, not a lid, and that is the whole feature.**
`updateWorld` — objectives, bots, rounds in the air, bodies on the ground — runs in
full underneath it, so the tickets bleed, a squad takes the flag you died on, and
your killer walks past while you watch. A death cam over a frozen world is a
screenshot. `updateWorld` was split out of `updateGameplay` for exactly this: the
cam needs every line of it and not one line of what surrounds it.

**It costs no time.** `enterDeploy` is opened with `respawnDelay` MINUS the time
already spent, so a life is still eight seconds end to end. Lengthening `time`
without that subtract turns feedback into a punishment.

- **The body is the BOT rig**, which is why the retired GLB player body could be
  deleted outright: it hands to the pool with nothing adapted and is already what
  `RAGDOLL_BONES` is measured against. It is built at `startRound`, not at the moment
  of death — nineteen merged meshes and their GL buffers is not a cost to pay on
  the frame the player is killed on.
- **It is a stand-in, not the player.** `Player` has no rig and never grows one: it
  is a capsule, a viewmodel and an eye. The corpse is a separate object stood up at
  `Player.floorY` (the FEET — `Player.position` is the middle of the collider capsule)
  and hidden again at the end, so nothing in movement, collision or hit detection ever
  gains a mesh to disagree with.
- **It is stood up in the STANCE they died in**, off `Player.stance` — the eased
  blend, not the `crouching` intent, which would round a body a third of the way into
  a crouch up to a full one and spend half a metre of pop on the one body the camera
  is about to point at for four seconds. Two things follow the blend and they are not
  the same thing: the rig is posed by `animateSoldier`, which drops the hips and leaves
  the boots planted, and `RagdollSubject.center` comes down to `crouchCenterHeight`
  because that is where the round landed and what the throw is aimed away from. The
  ROOT does not move — the crouch lives inside the rig, so a root pulled down with it
  puts the feet through the floor. It is the same split `NetPlayer` draws for a remote
  body.
- **The camera leaves the head through `CameraSystem.place`, the one exception to
  that system's own invariant**, and `update` is simply not called in that window — so
  no look input, ADS blend, recoil, bob or landing spring advances, and the aim is
  exactly where it was left when the round comes back. `place` writes the roll and the
  FOV explicitly, or a camera handed over mid-landing would watch the body through a
  tilted, zoomed frame for four seconds.
- **The pull-in is the only occlusion pick in the game outside combat**, and it is
  cast from the BODY outward, never from the camera in — a ray the other way starts
  inside whatever the camera has already backed into and reports the far face of it,
  walking the camera further into the stone. Its origin is the body's own chest rather
  than the look point, which during the rise can be inside a wall the player died
  facing. Measured against the valley rim: the camera stops 0.22–0.27 m short of the
  collider face and never crosses it. It was affordable because
  `Player.probeGround` is not running while the player is dead; now that the
  probe is analytic it is affordable outright, and it is the only whole-scene
  pick left in the death cam.
- **The frame is anchored on the corpse's own chest joint**, smoothed at
  `followRate`, which makes one set of numbers work at both ends of the fall: a
  standing body puts the chest at ~1.1 m and a fallen one at ~0.3 m. The joint is read
  with `computeWorldMatrix(true)` first — while the ragdoll owns it, its parent is a
  proxy node the solver moved this frame.
- **This body is never refused, and it needs no exception to say so.** It is at the
  camera, so the distance gate — the pool's one remaining refusal — cannot reach it,
  and a full pool evicts its oldest corpse, which for the whole four seconds is never
  this one. The cam used to carry a `priority` flag for that half and a copy of `Bot`'s
  collapse tween for the other; both are gone, and with them the difference the tween
  had here (no hide at `hideTime`, because a body that vanishes two thirds of a second
  into a four-second shot of it is what this state exists to remove).
- **The pointer lock is deliberately KEPT.** There is nothing to click, and dropping
  it would trip the lock-loss pause on the very frame the shot begins. `enterDeploy`
  releases it one state later — and it is also the single funnel for retiring the body,
  so every path out (the clock, the round ending, F2) hands the rig back.

`HUD.setDeathCam` raises `.dying`, which hides the same four things `.paused` does
and is a class of its own anyway: a pause hides them because the world stopped; this
hides them because the world did *not* and the player is no longer in it. The gauges
stay for the mirror-image reason — they are live and true, and watching the tickets
run while you wait is half of why the cam is worth showing.
