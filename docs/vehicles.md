# Vehicles: two kinds, one hull, and everything it is an exception to

What a vehicle IS to each subsystem that meets one, why it is the only moving
`solid` mesh in the game, how a driver's frame differs from a body's, and what
is deliberately not built. Split out of [`CLAUDE.md`](../CLAUDE.md), which keeps
the summary; this file is the contract for `src/entities/Vehicle.ts`,
`src/entities/vehicleRig.ts`, `src/entities/vehicleKinds.ts`,
`src/entities/TankModel.ts`, `src/entities/TruckModel.ts`,
`src/systems/VehicleSystem.ts`, `src/systems/VehicleCamera.ts`,
`src/systems/VehicleCrew.ts` and for `Game`'s `updateDriver` /
`frameVehicleCamera` / `mount` / `dismount` / `clearVehicle` / `resolveShell` /
`offeredSeat`.

**Most of what follows is written about a TANK**, because the tank is what
every rule in it was found on, and because the second kind changed none of
them. Read "tank" as "the hull in front of you" everywhere except where a
difference is called out.

## The shape of it

A vehicle is a block of NUMBERS and a MESH, and everything else is machinery
that reads those two:

| the thing | what it owns |
| --- | --- |
| `MapLayout.vehicles` | where each side's vehicles stand, and WHAT stands there. One `VehicleSpawnDef` per hardstanding; absent on two of the five shipped maps |
| `config/vehicles.ts` | `VehicleSpec` — the shape of one kind — and the two kinds: the TANK and the gun TRUCK |
| `entities/vehicleKinds.ts` | the ONE place a kind becomes a name, a spec and a model, and the one place the default (a tank) is written down |
| `entities/vehicleRig.ts` | what every vehicle's mesh IS: the joints `Vehicle` writes, the three extents the physics needs off the drawing, and the three closures a model hands back |
| `entities/TankModel.ts`, `entities/TruckModel.ts` | the ART, one file per kind — the boxes, the running gear, the whips and the guns as JOINTS over them, and the charred repaint a wreck takes |
| `entities/Vehicle.ts` | one hull of any kind: its collider, its drive, its turret, its two guns' clocks and angles, which of its two seats are filled, its health, and the springs behind its lean and its antennae |
| `systems/VehicleSystem.ts` | the fleet: build, the respawn clock, the wreck clock, which seat a boarder gets, and where a dismount lands |
| `systems/VehicleCamera.ts` | the view from behind a hull, and its pull-in |
| `systems/VehicleCrew.ts` | the bots that crew: which body is in which SEAT of which hull, where it is taking it, and what each of its guns is laid on |

`Game` is the only place they meet, exactly as with every other system: it holds
the two facts the feature turns on (`Game.driving` and `Game.drivingSeat`),
decides who is in what, and wires `VehicleSystem`'s two announcements. Nothing
in `VehicleSystem` has heard of a player, and nothing in `Vehicle` has heard of a
hardstanding.

## Two kinds, and the ONE branch between them

**There are two vehicles and no code that knows it.** `Vehicle` is handed a
`VehicleSpec` and a rig BUILDER by `VehicleSystem` and never learns which kind
it is — `CONFIG.vehicles.tank` used to be read in forty-three places in that
file and every one of them is `this.spec` now. A third kind is a row in
`VEHICLE_KINDS`, a block in `config/vehicles.ts` and a model file, and no `if`
anywhere. **The moment a system asks which kind it is holding, that bargain is
broken.**

The one thing a kind genuinely differs by in code is whether it has a MAIN GUN,
and even that is not asked as a kind:

- `VehicleSpec.gun` is `null` on an unarmed kind, and it is ONE nullable field
  because the mount and the round are one weapon — `turret` nests inside it, so
  a hull with nothing to traverse cannot be handed a traverse rate by accident.
- `Vehicle.armed` is that resolved once, and **it is the only question anything
  else asks.** The trigger (`gunReady`, so `fireGun` and the AI crew's shoot
  both refuse), the HUD's loader row (`loadProgress` is null, so the row is
  ABSENT rather than dimmed), the gun marker (a driver with no gun gets none),
  the crew (`lay` and `shoot` are skipped and the driver acquires as a spotter),
  and the authority's `onShell` rate gate, which refuses a claimed shell from a
  turretless hull outright.
- **An unarmed hull keeps `turretYaw` equal to its own yaw**, which is not a
  special case dressed up. The drawn angle is `turretYaw - yaw`, so a turret
  that tracks the hull draws at a permanent local zero — exactly what a ring
  bolted to a truck's roof should do — and `aimMg`, which writes
  `mgYaw - turretYaw` onto the mount above it, then puts a world-held machine
  gun on a body-mounted ring with no branch of its own. `updateRemote` takes the
  same rule, which is what makes the `tyaw` the wire carries for every hull
  harmless on one that has no turret.

**The rig is CLOSED over its own model**, which is what buys the second kind
without an interface that lies. A tank's running gear is two belts of scrolling
links and a truck's is four wheels that turn and two that steer, and no shape
over both is honest — so `VehicleRig` does not describe running gear at all. It
carries `setRun(left, right, steer)`, a closure the builder made, and `Vehicle`
hands it the two distances and the stick it already has. `reset` and `paint` are
the same bargain for the respawn and the wreck. The three numbers the physics
cannot get anywhere else — `gauge`, `contactReach`, `wheelReach` — are stated on
the rig, which is what stopped `Vehicle` importing from a model file at all.

### What the TRUCK is, and the trade it is

`CONFIG.vehicles.truck` carries the argument in full. In one paragraph: it is
the tank with the cannon taken off and the speed put back. 18 m/s against 11,
accelerating and stopping nearly twice as hard, through a 3.2 m gap against the
tank's 4.4 — and 520 points against 1200 at nine times the small-arms damage,
with no weapon but the machine gun the second man lays. **`climbHeight` is the
rule that keeps it honest**: 0.55 against the tank's 1.25, so the parked car a
tank rides straight over is a car this drives around, and the whole class of
"through the scenery" that armour is allowed is closed off — without a line of
code knowing which kind it is steering.

**The second rule that keeps it honest is that it CANNOT PIVOT, and it is one
more number of the same shape.** `steerAtRest` is how much of `turnRate` a hull
has at a standstill — 1 on the tank, which is a neutral-steer pivot and the
value that leaves the drive's arithmetic exactly where it was, and 0 on the
truck, which has to be ROLLING to point anywhere. Between the two ends
`steerRollSpeed` (4 m/s) ramps the authority up linearly in the hull's own
velocity, and the ramp is SIGNED rather than taken off `travel`: a truck backing
up steers the way a vehicle backing up steers, the stick left swinging the nose
right, and a tank is exempt from that too by construction rather than by a
check. `Vehicle.steerAuthority` is the one place either end is read, and both
the local drive and `updateRemote`'s derived stick go through it — a yaw rate
divided by the authority IS the stick that produced it, so the wheels a watcher
sees are turned as far as the driver has them.

It was `turnRate` flat at every speed until the field existed, and what that
looked like was a five-tonne truck spinning on its own axis in the road.

**And a third number sits between the driver and both of those, because a KEY
IS NOT A STEERING WHEEL.** `InputManager.moveX` is +-1 the instant `A` or `D`
goes down — right on foot, where walking left is a direction and not a
quantity, and in a hull a driver who reaches full lock and centres again inside
one frame. What comes out is a step function of yaw rate, and a step into a
heavy body reads as exactly the jerk it is. `drive.steerRate` is the LINKAGE:
`Vehicle.steerTo` walks the steering toward what is being asked for at that
many stick per second, and the hull turns on what the linkage has got to rather
than on the stick.

A rate limit rather than a smoothing, which is the honest shape twice over — it
is what the mechanism IS (a wheel is wound as fast as hands wind it), and it is
frame-rate exact by construction rather than through the `Math.min(1, dt *
rate)` idiom, which never quite arrives and arrives differently at 30 Hz. It is
deliberately the same three lines as the throttle's walk toward its wanted
speed: both are a control the driver ASKS with and the hull answers at its own
rate. The DRAWN wheels take it too (`steerShown` is fed from the linkage), or a
truck would be telling two stories about one mechanism.

The tank's is 8 — a tenth of a second, a hand pulling a tiller, near enough
instant to leave its handling where it was. The truck's is 3.2, three tenths of
a second to full lock and six to go lock to lock, and it is meant to be felt: a
wheel with turns in it. It costs about 8 degrees of heading against an instant
stick over the first half-second of a corner. **It is also half of why the
springs stopped touching their stop** — `flexSuspension` answers to
`speed * yawRate`, so an instant stick was a step input into a spring and a
step into a spring is an overshoot; ramped, the same corner settles to the same
6.95 degrees without ever arriving on the stop. The two are independent and
neither substitutes for the other: this shapes what the springs are ASKED for,
`suspension.progression` shapes what they do with it.

A bot pays it nothing it was not already paying — a crew's steer is
`err * steerGain` and is continuous, so the limit bites only where a bot's own
heading error saturates the stick.

**A hull that cannot pivot changes what an AI DRIVER can be asked to do**, and
that is the one place the change reached outside the drive. `driveOn` tapers the
throttle away with the heading error so a hull facing the wrong way pivots
rather than driving a long arc into whatever is beside it — which on a wheeled
hull is a deadlock, since no throttle is no steering, no steering is no way to
spend the heading error, and the stuck watchdog stays quiet because it only
counts a hull that is ASKING for speed. `CONFIG.vehicles.crew.turnCrawl` (0.35)
is the floor that fall-off now stops at, scaled by `1 - steerAtRest` so it is
exactly zero on a tank and the line is the one it has always been. What it buys
is a truck that makes a U-turn where a tank spins on the spot.

It stands on Sarab, one a side, behind each team's tank. Two maps have armour of
any kind; only that one has two kinds.

## What it is drawn as, and the tracks that RUN

`entities/TankModel.ts` is ~180 boxes and cylinders and **twenty-six meshes**, and
the number that matters is the second one: the outline pass draws every mesh
twice, so a tank's cost is COLOURS PER SEGMENT and not parts. A greeble in a
colour its segment already carries is free; a sixth colour on the hull is two
more draw calls on every hull on the field. That is the whole budget rule, and
it is why the barrel is round, the road wheels are round and the hub caps are
their own little discs — geometry is not what a mesh costs. Measured on
Coldharbour: 26 meshes a hull, all of them inked, 104 for both hulls against
the 2,262 the map draws.

**A mesh is bought here for exactly one reason and it is never a colour:
something that MOVES differently from everything around it cannot merge with any
of it.** Twelve of the twenty-six are that — six for the tracks, four for the
two antennae and two for the commander's gun on its own ring — and nothing else
in the model has earned one.

**Six of the twenty-six move, and between them they are the tracks.** A belt cannot
be one mesh: the links go round a loop and a rigid mesh only slides. So the band
is static and a strip of raised LINKS is laid along each run and slid by how far
that track has run, modulo the link pitch — which is exactly a scroll, because
the pattern repeats at the pitch. Two strips a side, because the ground run goes
backwards under a hull driving forwards and the return run goes forwards, and
that opposition is most of what makes it read as a belt rather than as a texture
sliding along a box. The sixth and seventh are the drive sprockets, which turn
at `run / END_R` — **the only wheels that turn, because they are the only ones
whose turning can be SEEN**. A road wheel is a disc, and a disc rotating about
its own axis is indistinguishable from a disc at rest; giving each one a node
would be twelve more meshes to animate nothing.

**Two figures go in and they are per TRACK, not per hull.** `Vehicle` keeps
`trackRun[2]`, adds `speed ± yawRate * TRACK_GAUGE / 2` to them each frame and
hands both to `setTrackRun`. That is what makes a neutral-steer pivot — which
this vehicle can do at a standstill — come out as the two tracks running
opposite ways, and it is derived rather than decided: the drive is still one
speed and one yaw rate. Nothing in the game may read it back. A track that has
run further than the hull has moved is a track slipping against a wall, not a
faster tank.

**The seam is hidden rather than solved.** A strip carries one link past each
end of its run and is slid at most one pitch, so the link that overshoots is
inside the sprocket's or the idler's own silhouette — which is why those two
wheels are exactly loop-sized and the road wheels are not. Widen `LINK_PITCH`
or shrink an end wheel and links start appearing out of the air at the ends of
the tracks.

Four things the model may not do, each of which has already been done once:

- **Nothing emissive.** `Game`'s GlowLayer scan is construction-time and a tank
  is built per round, so a bloom-eligible material on one is never excluded by
  the `noGlow` contract and glows for the rest of the round. The headlights are
  boxes.
- **Nothing pickable.** The collider box is the only pickable thing a tank has.
  A pickable visual would put the hitscan's wall ray, the bots' LOS and the
  ground probe on sixty triangles of track link.
- **Nothing above the deck inside the turret's sweep.** The ring is at the deck
  and the turret's underside is 11 cm above it, so a raised engine deck, a
  louvre or a stowed drum within reach of the ring is something a traversing
  turret drives through. What is drawn back there sits behind `z = -2.5`, which
  is past the corner of the turret box.
- **Nothing below the track line at the nose or the tail.** A box cannot have a
  corner taken off it, so the glacis is built UP to its slope — the sponson
  stops short, a step carries the hull out to the nose, and the plate is thick
  enough to overlap the sponson's front face at every height it crosses. The
  version that laid a thin raked plate over a square hull left a wedge of open
  air behind it that read as a triangular hole punched in the front of the tank;
  the version that filled that wedge with a thicker plate reached down through
  the idler. Neither is available. The same staircase makes the tail.

Stowage hangs off the FLANK and never off the fender: the sponson overhangs the
tracks, so a fender's whole depth is under a metre of armour and a bin standing
on one is inside the hull. That costs 30 cm of width the collider does not have,
which is the same kind of overhang the fender lip itself has, and it is what
stops six metres of unbroken plate down each side reading as a shipping
container.

**None of this moved the collider.** `CONFIG.vehicles.tank.hull` is what the
model is built to and the model is what changed: the hull got rounder, better
lit and busier, and the box a round stops on is the box it always was.

### The TRUCK is a CLOSED body, and that is a fix rather than a restyle

`entities/TruckModel.ts` is the same accounting on a smaller machine —
**twenty-two meshes, fourteen of which move** (eight for the wheels, four for
the weapon station, two for the mast) — and it was an open-bedded pickup with a
pintle gun standing on the bed until the thing that was wrong with it turned
out to be something no number could reach.

**There is no player model in this game, so a gun that visibly needs a man
behind it is a gun with nobody behind it.** A pintle, a shield and a pair of
spade grips are three separate promises that somebody is standing there, and
the empty bed under them is the floor that says nobody is — every frame, from
every angle, on the one vehicle in the game a player spends whole minutes
looking at from twelve metres back in the chase camera. It is the exact
counterpart of the rule the soldier kit is written under: what a player reads
off a body at range is its silhouette, and this silhouette was making a claim
the game cannot honour.

An armoured 4x4 estate makes the same absence read correctly instead. The crew
are INSIDE, behind a 40 cm glazing slot over 70 cm of plate — too shallow and
too dark to resolve anybody through, which is the proportion that says
"armoured" before any other detail on the vehicle has landed — and what is on
the roof is a REMOTE station: a cradle, an armoured shield, an optic head and a
barrel, with no pintle, no grips and nowhere for a body to stand. The gun
traverses because the man at the screen below it traversed it. What used to
look broken now looks like the point, and `Vehicle.aimMg`'s world-held angle
did not move a line to get there — a station is exactly as much of a
body-mounted ring as a pintle was.

Three things fell out of it and none was the reason:

- **The arc is 360 degrees by construction.** The pintle's whole geometry
  problem was that it had to shoot over its own cab, which is what the 1.14 m
  pedestal under it existed for and what made the ring's height the tightest
  number in the old file. A station on the ROOF is above everything the vehicle
  has. What is left is one clearance and it points DOWNWARD: at `mg.pitchMin`
  the muzzle passes 6.7 cm over a roof at 1.96 — measured, not derived — and
  that is now the number to re-derive if the roof, the ring height, the barrel
  or that limit moves.
- **Nothing may stand on the roof**, which is the pickup's bed rule moved up a
  storey and tightened. The muzzle reaches 1.46 m past the trunnion and the
  station turns a full circle, so a rack, a light bar or a rolled tarp anywhere
  inside that radius is something a traversing gun drives through. The roof is
  therefore BARE and the stowage is on the rear door, on the flanks and forward
  of the windscreen — which is where it is on the vehicles this is drawn from
  anyway, the spare going on the door precisely because there is no bed to put
  it in.
- **A body riding on the hull stands 50 cm over the roof instead of 1.7 m over
  the bed.** `Vehicle.deckAt` answers with the COLLIDER's top face, which is
  2.5 m up on both designs, so a rider on the pickup floated well clear of the
  floor he looked like he was standing on.

**It carries about twice the parts for one fewer mesh than the pickup had**
(22 against 23), and that is the budget rule doing exactly what it is for: a
greeble in a colour its segment already carries is free. The chassis grew a
second differential, a transfer case, two propeller shafts, a fuel tank and
four shock cans, and cost nothing, because the frame was already one mesh and
a player nosed into a ditch sees the underside. The wheels grew eight tread
lugs and six hub bolts and cost nothing, because a lug is the tyre's colour and
a bolt is the hub's — and between them they are two rotation cues rather than
one, at the silhouette and at the face. The one colour that was ADDED is not a
colour: `hub` became `metal`, the same value doing the same job on the wheel
and picking out the four fittings a player might otherwise never find — the
winch, the snorkel head, the exhaust tip and the station's optic, which is the
only pale thing above the roof line and is therefore what the eye uses to read
where the gun is looking.

**The three numbers the physics reads off the drawing did not move.** `gauge`,
`contactReach` and `wheelReach` are the pickup's to the centimetre, because the
wheels are where they were: a redesign of the BODY has no business touching the
axles, and leaving them alone is what makes this a repaint rather than a retune
of the suspension, the lean and the ten ground contacts. Neither did the
collider — `CONFIG.vehicles.truck.hull` is what the model is built to, and the
box a round stops on is the box it always was.

## The hull LEANS, and it leans TWICE

A tank that stayed perfectly level was the tell that it was a box being SLID
rather than a mass being driven — the tracks ran, the hull moved, and nothing
about it had any weight. What fixed it is not animation: the drive already
knows the acceleration it achieved and the yaw rate it turned at, and weight
transfer is those two numbers and a spring.

The hull's attitude is two halves, written in exactly one place
(`Vehicle.leanHull`), never mixed — and **written to two different NODES, which is
the whole of the difference between a tank on a suspension and a tank being
tilted**:

| half | what it answers to | how it moves | what it turns |
| --- | --- | --- | --- |
| the GROUND (`leanToGround`) | the slope the ten track contacts are standing on, measured by `standOnGround` against the collider boxes AND the terrain | a frame-lerp at `drive.tiltRate` toward a fact, which cannot overshoot | `VehicleRig.hull` — the WHOLE vehicle, tracks and all |
| the SUSPENSION (`flexSuspension`) | the hull's own mass: `accel` along its forward, and `speed * yawRate` across it | a damped spring at `suspension.stiffness`, which MUST overshoot, stiffening with the travel it has spent (`suspension.progression`) | `VehicleRig.sprung` — the BODY, against running gear that stays put |

**Summing them onto the hull node was a bug and it is the one this section was
rewritten around.** A vehicle standing on a slope stands on it tracks and all,
so the ground half belongs on the node the running gear hangs off. A body
diving under the brake is a body moving against tracks that stay where the
ground put them — that is what a suspension IS — so the suspension half belongs
on `sprung` beside the heave. Added together on one node, a nose-down dive
rotated the belts with the body and drove the leading end of the vehicle under
the road `standOnGround` had just finished standing it on: the deeper the
weight transfer, the further the tank sank into the ground at whichever end was
loaded. **A real tracked suspension is exactly this split** — the road wheels
are the unsprung mass, each on its own arm with its own travel, and the hull
rides above them on the bars.

The sprocket and the idler are on the unsprung side here and are sprung on a
real tank, being bolted to the hull rather than hung on arms. That is a
deliberate simplification: what their travel would show is track sag over the
return run, and the belt is one static mesh that does not sag.

**The acceleration is measured, not asked for.** `Vehicle.update` snapshots
`speed` at the top and reads the difference at the bottom, because the three
things that decelerate a hull are not all the throttle's: letting go of it,
braking against it, and driving into a building. A ram spends most of road
speed in one frame, which is several hundred m/s^2 and would ask for a
somersault — so the INPUT is clamped (`accelLimit`) as well as the output (by
the stops below), and what a collision looks like is a full dive.

**Roll is `speed * yawRate` and not the steer**, which is what makes a
neutral-steer pivot at a standstill lean nothing at all: the hull is rotating,
not cornering, and there is no lateral acceleration for it to lean against.

**How far either may go is a TRAVEL and not an angle, and there is no
`pitchLimit` and no `rollLimit` any more.** A real suspension runs out where a
road-wheel arm meets its bump stop, so the bound is how much travel is left at
the outermost station over how far out that station is —
`TankModel.WHEEL_REACH` (2.11 m) for the pitch and the narrower half-gauge
(1.31 m) for the roll. And it is the SAME travel the heave is spending, so the
three axes draw on one budget (`suspension.heaveBump`/`heaveDroop`) rather than
on three clamps that could each be legal and jointly put the belly through the
road. A tilt extends one end as far as it compresses the other, so what binds
it is the smaller stop — `heaveDroop`, at 12 cm — which works out at ~3.3 deg
of pitch and ~5.2 deg of roll. A hull already leaning hard has less dive left
in it, and a hull that has landed on its bump stops has none at all and goes
flat, which is what bottoming out does to a body.

**The gains are sized so that the stops are reached by EVENTS and not by
driving**, which is the other half of the same argument: a suspension whose
every input saturates its travel has one picture for the brake, the gun and the
ram, and the whole point of weight transfer is that they differ.

**And the springs are PROGRESSIVE, which is what makes that rule keepable on a
vehicle whose gains cannot be sized to it.** `suspension.progression` hardens a
spring's RESTORE with the fraction of its travel already spent —
`1 + progression * f^2`, one rate shared by the two tilt axes because they
spend one budget, and the heave taking the same treatment on its own two stops.
The DRIVE term is untouched, so what changes is the angle a steady acceleration
SETTLES at: it solves `x * rate(x) = want` instead of `x = want`, and lands
inside the travel where the linear answer was on the stop.

It exists because of the truck. Full lock at road speed is `18 * 0.897` =
16 m/s^2 across the hull, which at its `rollPerAccel` asks the springs for
19.4 degrees against a budget worth 8.2 — so the body went over, sat on its
stops for as long as the wheel was turned with its velocity killed there, and
**half the steering range produced the same lean as the other half**. Measured
in degrees of settled lean at road speed:

```
  lock:    10%   20%   30%   40%   50%   70%  100%
  linear:  1.94  3.89  5.83  7.77  8.21  8.21  8.21   <- on the stop
  at 2.5:  1.74  2.94  3.79  4.46  5.02  5.91  6.95
```

The cost is about a fifth of the lean through the middle of the range and the
gain is a curve that is still answering at the top of it. Turn-in overshoots far
enough to touch the stop for a frame and come off it, and a hard brake dives
3.1 degrees where it used to peg at 5.3.

**The damper hardens with the spring**, as the square root of the rate, so the
damping ratio the two figures were tuned to holds at every point of the travel —
a suspension that rang at full lean and not at rest would be two vehicles. What
is left over (the spring's tangent rate climbs faster than the secant one the
restore is written in) leaves a hull a little livelier the harder it is leaning,
which is the direction a truck should err in.

**The stops are not what this replaces.** They are still there and still spend
one budget, so a hull that has spent its travel on one axis has none left for
the other. What changes is who arrives at them: the tilt now touches a stop on
turn-in and comes off it where it used to lie against one, and on the truck the
HEAVE stops arriving at all — the hardest jolt there is puts a linear body of
that rate on the stop and a progressive one 15.3 cm down of the 19.

**That is a reserve and not dead space, and the tank's rule that a stop must be
REACHED is a rule about a linear spring.** The last four centimetres are spent
every frame the body is compressed, because the pair is the TILT's budget too:
`room` is `heaveBump + heave` on a hull down on its springs, so a truck landing
mid-corner has 3.7 cm of station travel for its lean rather than 15 and goes
flat under itself. The tank is linear and still bottoms out on the same jolt,
which is the heaviest thing it does.

**The tank states 0 and its arithmetic is untouched, exactly rather than
approximately.** A torsion bar is very nearly linear right up to the rubber its
arm meets, which is the stop and not a rate that has been climbing toward it —
and it is load-bearing for `gunKick` that this is so, since the gun is sized to
be the one input that reaches the stop and a spring hardening on the way there
would take that away from it. It is `gunKick: 0` on the truck, the other way
round.

**The gun is the one input that does not come through the acceleration term,
and it must not.** `gun.recoilSpeed` shoves the hull backwards and is spent
against the drive over the next second; read as an acceleration that is a
brake, and a brake dives the nose. A gun's recoil is a rearward force well
above the tracks, and what that does to a body standing on them is lift the
FRONT. So `fireGun` kicks the tilt springs' velocity directly
(`suspension.gunKick`), nose up, and the shove reaches the spring not at all —
it is applied outside `update`, so the snapshot never sees it.

**And the direction of all of it is the GUN's, not the hull's.** The turret
traverses and the hull does not follow it, so `fireGun` resolves one recoil
vector onto three axes by the turret's local bearing: the share along the
heading onto `speed` (nothing at all when the gun is abeam — `speed` is a
scalar on the tracks and there is nowhere for a lateral velocity to go), the
same bearing splitting `suspension.gunKick` between the pitch and the ROLL
spring, so a shot over the left track stands the right side up and one over the
tail dips the nose. Written along the hull's axis instead — which it was — a
tank rocked backwards whichever way its gun was laid, a body that had decided
what a shot did to it before the gun was pointed. Elevation is deliberately not
in the split: the gun's arc is -8 to +18 degrees, so the horizontal share never
falls below 95%, and the vertical remainder would be a heave the couple above
says a body on tracks does not feel.

Measured on Coldharbour: 1.5 degrees of squat under full power, 3.0 of dive on
the brake, 3.5 of lean into a turn at road speed, and 3.2 of nose-up rock when
the gun fires — the gun being the one input sized to reach the stop, so firing
bottoms the rear stations for a moment and rings off them. A ram arrives at
`accelLimit` and goes straight onto them.

The figures are roughly half what the authored limits allowed before, and the
old ones were the unrealistic pair: 6 degrees of nose-up needs 22 cm of travel
at the rear road wheel, which is more droop than a real MBT has. **`hull`'s own
rotation now reads 0.0 on flat ground under every one of these**, which is the
regression test for the split — anything that puts weight transfer back on that
node buries an end of the vehicle again. On Harrowmead's rolling ground the two
separate cleanly: the hull node swings +/-14 degrees following the terrain with
its tracks while the body works 1.5 degrees and a few centimetres against it.

**None of it moves anything.** The collider box never tilts, and the gun is
aimed in WORLD angles (`turretYaw`, `gunPitch`) off a turret that hangs from
this node — so a leaning hull cannot carry the gun off the aim, and the promise
the gun marker makes is untouched. It also means the numbers may be tuned by
eye: being wrong costs a look and never a fight.

## The BODY is sprung and the tracks are not

The two leans above answer to the drive, so a tank that was neither
accelerating nor cornering had nothing to say — and driving over a car is
exactly that. The hull went up, came back down, and never once looked like it
weighed sixty tonnes, because the only thing that had moved was the whole
vehicle, rigidly, exactly as far as the ground told it to. **A vehicle with no
vertical travel at all is the same tell a perfectly level one was.**

So there is a third axis, it is a distance rather than an angle, and it is the
one that carries the weight. `VehicleRig.sprung` is everything the springs carry —
the tub, the sponson, the stowage, the marking and the whole turret with the
gun and the masts on it — and it hangs off `VehicleRig.hull` with the RUNNING GEAR
left behind on the hull node: the belts, the road wheels, the idlers, the
sprockets and the link strips. `Vehicle.flexHeave` moves it in Y and never rotates
it, so a compressing hull compresses along its own up axis rather than the
world's.

**Splitting it off the running gear is the whole of what makes the travel
visible.** A body that took its tracks down with it would drive them through
the road on every landing, which is a worse artefact than the stiffness it
cures; a body that moves against tracks lying still on the ground they are
standing on is a tank settling onto its torsion bars, and the fender lip
closing on the belt is where the eye reads it.

**What it answers to is one number and it is not a new measurement.**
`standOnGround` already knows what the ground did to the hull's own vertical
motion, and **when the ground under a vehicle changes speed the body does not**
— the difference IS the deflection. So a landing spends the closing speed into
the spring, mounting a kerb spends the rise, the top of a car spends that same
rise back the other way, and a hull in the air spends gravity itself and droops
onto its stops. One term, four events, and nothing anywhere that knows which of
them is happening.

**The jolt is spent on the spring's VELOCITY and never on its position**, for
the reason `fireGun` kicks the pitch spring's: it is an impulse, so it is
frame-rate free — what a fall hands over does not depend on how many frames the
fall took, where an acceleration read off it and clamped would hand a 30 Hz
frame twice the landing of a 60 Hz one. `suspension.joltLimit` is
`accelLimit`'s counterpart and is there for the identical reason: the plank is
sampled at ten places and steps a quarter of a metre at a time as each contact
arrives, which is 16 m/s of ground that nothing physical is doing.

**What leaves a frame is the rate the hull is now MOVING at, never the
fraction of it that frame happened to spend**, and the difference is the whole
of a landing. A hull dropping at 11 m/s onto a plank 16 cm below it covers that
16 cm and stops: read as an achieved rate the frame reports 9.5 and hands the
springs a jolt of 1.5, and the other 9.5 is never handed over at all — the hull
is settled by then, `needsGround` has gone false, and the frame that would have
said so never runs. Measured before it was fixed: a wreck dropped three metres
compressed its springs 3 cm where driving off a car compressed 7, which is the
wrong way round and is the shape of this mistake if it comes back.

**The two stops are not the same number, they are not this axis' alone, and
`heaveBump` is not a taste.** It is sized so that it can be REACHED, which is
the one thing a stop has to be: the most the ground can ever hand the springs
is `joltLimit * heaveResponse`, by construction and whether it came off the
edge of a car or out of a three-metre fall, and into this spring that is about
15 cm of travel. Set above that, nothing bottoms out and the number is dead
space. Reaching it stops the travel dead and the spring pushes back out, which
is what bottoming out is and is the heaviest thing this vehicle does.

That is short of a real MBT's ~25 cm of bump and deliberately so — what bounds
it here is the impulse path rather than the geometry — but it is more than
TWICE the 7 cm it replaced, and the 7 was **a belly clearance mistaken for a
spring**. `TankModel.BELLY` was 8 cm, so any travel worth seeing put the hull
through the road, so the travel was clamped to where it could not be seen, and
what was left over went into tilting the whole vehicle instead. A real tank
sits on 0.48 m of clearance; this one now sits on 0.34, which is where the
travel and the tilt both fit with room over and is still invisible from
anywhere a player stands — the tracks hide it from the side and the chase
camera is two metres up.

`heaveDroop` is sized against the LOOK instead — an extending body simply lifts
off its running gear, and past about 12 cm the road wheels stand clear above
the fender line and the hull reads as levitating rather than as unloaded. It is
the SMALLER of the two, so it is also what bounds the tilt next door: a
nose-down dive is a tail-up extension, and the end going up runs out first.

Measured on Coldharbour: a hull dropped three metres sits on the droop stop
through the fall, arrives with the full `joltLimit`, compresses 14.6 cm onto
the 15 the stop allows and rings out inside a second; dropped 30 cm it takes 12
and never reaches the stop. On Harrowmead's rolling ground at road speed the
whole travel is 3 cm of compression and 6 of droop over the crests — a hull
crossing a field rather than a hull being animated — and a parked one does not
move at all.

**The lowest point of the sprung body was measured against the running gear
across all of it**, because that is the failure this section exists to prevent:
the worst case over hard driving on Coldharbour leaves 14 cm of the belly's 34
still clear, and crossing Harrowmead leaves 31.

**None of it moves anything either.** This block reaches one `TransformNode`'s
Y. The collider does not travel with it, the gun is aimed in world angles off a
turret that rides on it, and the reticle still cannot lie.

## The antennae bow, and there is no Havok in them

The two whips are the third picture on this vehicle and the furthest out from
the drive. A mast is a thin cantilever bolted to the turret roof, and the three
things that bend one are all numbers this class already has: the acceleration
the drive achieved, how fast the hull node the foot is bolted to is ROTATING,
and the wind. So it is two damped springs a mast (`Vehicle.flexAntennae`), and it
was asked whether it should be a physics chain instead. It should not, and the
reasons are worth writing down because the question will come back:

- **The engine in this tree is for the DEAD.** `PhysicsWorld` steps corpses and
  glass shards — things nothing reads back, nothing steers and nothing aims. An
  antenna is on a live vehicle, and `CLAUDE.md`'s standing rule is that Havok
  never touches a rig node.
- **A hull TELEPORTS as far as a solver is concerned.** It is moved by
  `moveWithCollisions` and ridden up over a kerb by `standOnGround`, neither of
  which is a velocity. A jointed chain hung off an anchor that jumps
  0.9 m in a frame cracks every time a tank climbs a kerb, and the fix for that
  is to feed the solver a velocity the hull does not have.
- **It would cost per link what the spring costs per mast.** Four bodies and
  four constraints a whip, sixteen of each on a two-hull map, stepped every
  frame of the round — plus a transform read back per link, which is a mesh,
  which is two draw calls. Against four springs and two lag filters.
- **A spring can be CLAMPED and a solver cannot.** `bendLimit` is what stops a
  ram folding a mast through the turret roof, and it is one `Math.min`.

What the springs answer to, all four terms taken in the TURRET's frame rather
than the hull's — a hull diving under a turret traversed ninety degrees bends
its whips SIDEWAYS, and a term written in the hull's axes would lay them back
along a tank that was stopping beside them:

| term | what it is | measured |
| --- | --- | --- |
| the drive's acceleration | the suspension's own input, clamped by the same `suspension.accelLimit` for the same one-frame reason. A whip trails what is thrown at it, so the tip goes the OPPOSITE way | 9 deg back under power, 21 deg forward under the brake |
| sideways | `speed * yawRate`, as the hull's roll is — so a neutral-steer pivot whips nothing sideways | 11 deg out of a turn at road speed |
| the base's rotation RATE | the term that makes the hull's own motion visible at the top of the mast. Read off the SUM of the ground lean and the suspension, so a kerb cracks the whips exactly as the gun does | — |
| the wind | bearing from `CONFIG.wind.dir`, because there is one wind; amplitude and speed its own, because a mast is not a blade of grass | 2 deg of stir on a parked hull |

**The gun is stated in its own right, and it is the second half of
`suspension.gunKick`'s argument.** The recoil is spent on `speed` outside
`Vehicle.update`, so the only thing the drive terms ever see of a shot is the
quarter second AFTERWARDS, where the tracks brake the shove out — an
acceleration forwards, which lays the masts back. Measured, that came within a
couple of degrees of cancelling the base-rotation term exactly: the hull rocked
six degrees nose-up and the antennae stood still through the loudest event on
the vehicle, then swung on the rebound. So `fireGun` kicks both whips' springs
directly, out along the gun, and the drag that follows is left alone: 10 degrees
of crack out ahead of the muzzle within a sixth of a second, 15 back, and rung
out inside two. This is the one gun term that takes no bearing and never needed
one: a mast hangs off the turret and so does the gun, so traversing cannot turn
it — the bend is the turret's own +Z whatever the hull is doing.

**A whip is drawn as TWO links because one is a lever.** The lower turns at the
mast foot and takes `antenna.baseShare` of the bend — a cantilever's curvature
is greatest at the root — and the upper takes what is left over, which is where
the shape comes from. The angle handed to the upper link is a LAGGED copy of the
spring's, so while the mast is moving the leftover goes negative and the two
links bend against each other into an S, and when it settles they agree and it
is one smooth bow. `setAntennaBend` is the whole of that, and `Vehicle` owns the
numbers exactly as it owns `trackRun`.

**The two masts are one spring scaled by their own lengths.** A cantilever's
natural frequency goes as 1/L^2, so `ANTENNA_LENGTHS` (1.5 and 1.2) is exported
on `TRACK_GAUGE`'s precedent and `WHIP_RATE` turns it into a stiffness and a
damping per mast, keeping the damping RATIO equal — 2.4 Hz and 3.8 Hz. That is
the whole reason two masts on one turret never swing in step, and a pair that
did would read as one animation playing twice.

Stepped semi-implicit Euler like the suspension. `dt` is clamped at 0.05 and the
faster mast runs at 3.8 Hz, which is `w * dt` of 1.2 against Euler's ceiling of
2 — what would break it is a stiffer spring, not a slower frame. And like every
other picture on this vehicle it moves nothing: a mast has no collider, is not
pickable, is in nobody's hit sphere, and a whip laid flat under braking cannot
carry the gun a pixel off the marker.

## A hull is the one moving `solid` mesh, and it is the ragdoll's rule

`CLAUDE.md`'s world-layer rule is that `MapBuilder.collider()` is the only place
a collider proxy is made, and geometry added by any other path is invisible to
navigation. **A tank's hull is exactly that geometry, deliberately.** It is not
an exception to the rule so much as an instance of the one the ragdolls already
established: things that MOVE cannot be in structures that are BAKED.

What the hull's collider box is:

- `metadata.solid`, and neither `porous` nor `rayOnly`. Those two describe a
  fence — a thing that is a wall to a body and mostly air to a bullet, or the
  reverse. A tank is both to both, which is the plain case. So it answers both
  of `RayWorld`'s questions: a round stops on it and a sightline breaks on it.
  It reaches those queries as `RayWorld.hulls` — a list `VehicleSystem` keeps
  and every cast walks — because it is in no baked structure and could not
  reach them any other way. `Vehicle.rayBox` is the one method that hands it over,
  and `deckAt` reads the same scratch box through the same gate. **A player can climb onto the deck, and that no longer follows from the
  metadata** — the ground probe is analytic and reads baked boxes, which a hull
  is deliberately not in, so the deck is a query of its own (`Vehicle.deckAt`,
  fanned over the fleet by `VehicleSystem.deckAt` and wired to the player by
  `Game`). Verified against the ray it replaced over 1,617 points on and around
  a parked hull: no disagreement anywhere, and a body dropped over the turret
  settles on the deck.
- `checkCollisions`, so `moveWithCollisions` — the player's, and the other
  tank's — is held out of it. It is also the mesh that *moves*, which is what
  makes that safe: Babylon excludes the mover from its own collision test.
- **No `WorldBox`.** `NavGrid`, `CoverMap`, `ObstacleField`, the AO bake and the
  collision bake are all built once from the finished collider set at map load,
  and a thing that moves cannot be in any of them.

**And the drive is the last thing in the game that walks the whole scene.**
`moveWithCollisions` costs per collidable MESH in the map, which is what every
ray in this tree stopped doing when `RayWorld` replaced the picks
(`ENGINE_UPGRADE.md` wall 2) — a hull was left behind because it MOVES a body
rather than asking a question about one. Measured on the authority, one hull
stepped 2,000 times: **0.039 ms a call against Coldharbour’s 754 collider
meshes and 0.402 against a 1500 m map’s 5,904** (`FINDINGS.md` 31). It runs
only while `|speed| > 1e-3`, so a parked fleet costs nothing — but it is why
the two maps with armour are the two most expensive server ticks in the tree,
and it is the one term in that tick which grows with map AREA. At sixteen slots
and two hardstandings it is 4.8% of a 60 Hz step at 1500 m, which is affordable
and is not free.

The consequence is stated rather than hidden: **bots walk through a parked
tank.** They walk through corpses too, for the identical reason, and both are in
the README's known limitations. What a tank IS to a bot is a target and a wall
its rounds stop on — which is most of what matters, and is why a hull parked
across a street still breaks the fight there even though the flow field runs
straight through it.

**The box covers the turret, not just the hull.** A box that stopped at the deck
let every round aimed at the turret — the tallest part, and the part with the
gun on it — pass over the collider; the hit sphere still took the damage, so
what was missing was the SPARK, and a round that hurts a vehicle without marking
it reads as a miss that happened to work.

### Three queries leave the hull out of their own answer

The chase camera's pull-in is a `RayWorld.castBody` and the nearest solid thing
to its origin is the hull's own, so the hull is passed as that call's `skip`. It
was two writes to `body.isPickable` around a `scene.pickWithRay` until the
queries stopped picking meshes, and it is an argument now — the rule is kept
either way: nothing is allocated per call, and **the other tank stays in the
answer throughout**, which is what makes one hull block another's camera. The
dismount's floor test does the same thing for the same reason. The crew's
sightline is the second and is `Game`'s `CrewCtx.visibleFrom` — see the two
bugs the AI crew found, below.

**The third is the hitscan's own wall cap, and it is the same mistake seen from
the other end: a hull's guns are DRAWN on the hull, so a muzzle is regularly
inside the box the hull is answered by.** `boxCast` hands a ray that started
inside a box its FAR face — deliberately, and two callers flip that normal — so
a round leaving such a muzzle stopped on the vehicle that fired it, at whatever
distance the exit face happened to be. It did no damage (the shooter's own hull
is not in the shooter's own target list, so `hitTarget` stayed null) and simply
went nowhere.

**The gun truck had it from the day it existed and it was invisible until the
body closed**, because what it looks like is a gun that works on some bearings.
Measured on Sarab, both the open-bedded version and the armoured one: the
station is 2.26 above the tracks and 0.79 behind the hull's centre inside a
5.4 x 2.5 x 2.5 collider, so a round laid dead ahead died **2.03 m** out and one
laid astern **0.33 m** (2.25 and 0.15 on the pickup) — while the same gun
trained abeam worked perfectly, the muzzle swinging out to 1.46 in x against the
box's 1.25. **The tank escapes it by geometry rather than by rule**, which is
why nothing had ever caught it: its cupola gun is 3.39 up against a 2.9 m box,
and its barrel reaches past the hull at every bearing the turret has.

The skip is `ShotOptions.fromHull`, and it is on the GUN rather than at the
trigger for `shellShotFor`'s reason — there are two triggers and they are in
different processes, so `Game` and `HeadlessGame` are fixed by one field. It is
also what stops a third gun bolted to a hull reintroducing this: the options
object belongs to the hull, so it carries the hull. **The hitscan is the only
path that needed it**, because `updateDriver` REPLACES `updateOnFoot` — the
grenade and the launcher are on the frame a mounted player does not run, so no
other `castRound` in the game ever starts inside a hull.

Measured after: the station reaches 64-141 m on all eight bearings where two of
them died inside the vehicle, kills a body stood 30 m down the barrel on every
one of the eight, and **a round fired at the enemy tank parked 20 m ahead still
stops on it** for 2.75 of 55 — `resist.bullet` at 0.05, which is the trade that
keeps this gun useless against armour.

**`isPickable` is still read, and it is still load-bearing.** `Vehicle.rayBox`
gates on `isEnabled() && isPickable` exactly as `SOLID_ONLY` does, so `hide`
takes a wreck that has been carried away out of every ray in one write.
**The bug that found that term was the ground probe's**, back
when the ground was a ray: it started INSIDE the box it was meant to ignore,
found the hull's own underside, pinned `floorY` to whatever height the tracks
already had, and a hull lifted by anything — Babylon's own collision response
climbing a barrier — stayed there for the rest of the round and could not fall.
That probe is gone (see below) and the term it argued for is still load-bearing.
Do not take it back out of `world/solid.ts`.

## Driving OVER things: the ten contacts and the climb

A tank that stops dead against a parked car is not a tank, and until the hull
stood on its tracks that is what one did — the ground was a single ray cast down
from the hull's CENTRE, so a car went unseen until it was under the turret and
the hull then teleported onto its roof. What replaced it is three decisions and
one number, and they hold together only as a set.

### The support is a plank on ten contacts

`Vehicle.standOnGround` samples the surface at `CONTACT_ROWS` places along each
belt — five a side, 1.5 m apart, spanning `TRACK_REACH` fore and aft — and rests
the hull on the rigid plank they hold up. It is solved in TWO PASSES and the
order of them is the whole trick:

1. **The attitude**, from the ends against each other: nose-up is the rise from
   the aft pair to the fore pair over the wheelbase, roll is the same across the
   gauge, and both are clamped to `drive.tiltLimit`.
2. **The height**, as the lowest plane at that attitude with no contact poking
   through it. Every contact says what the hull's centre would have to be for
   the plane to clear it; the plank takes the largest.

**Height first and lean second is what a single centre probe effectively did,
and it is why a car used to launch a tank**: with no pitch in hand, a plane
clearing a 1.1 m nose contact is a hull sitting a metre up in the air, level,
with its tail off the ground. Pitch first and the same contact asks for 0.55 and
ten degrees of nose-up, which is a tank tipped up over a car.

It also gets a LEDGE right for free, which averaging the two ends would not: a
hull with its nose over a drop has a fore contact far below and an aft one still
on the deck, the aft constraint is the binding one, and the hull hangs on its
tail at the lip and tips rather than floating out over the middle of the gap.

**Five rows a side rather than three, because a track is a BELT and not a set of
feet.** At three the contacts are 3 m apart — wider than a car is deep — so the
fore contact climbed the car and dropped off its far side before the middle one
arrived, and the hull sagged 13 cm in the middle of the obstacle. Measured, and
it read as the tank stumbling over the thing rather than riding it. At five the
spacing is 1.5 m and nothing on Coldharbour a tank drives over falls between
two.

### The rise is rate-limited, and the limit is a SLOPE

A contact crossing the edge of a car steps a metre between one frame and the
next, so the plank's answer is a step function and taking it literally is a
teleport. `drive.climbSlope` (0.6, about 31 degrees) bounds the rise by the
ground the hull has actually covered — nothing climbs faster than the steepest
grade it can hold — which turns the step into a slope the tank drives up.

That formulation is why terrain costs nothing: a hill asks for exactly
`speed * grade`, which is inside the limit for every slope on any shipped map,
so the limiter never touches a tank driving over ground and only ever bites on a
STEP. `drive.climbFloor` is the rise a stopped hull is still allowed, so ground
that came up under a parked one — a pane breaking, the editor rebuilding — does
not strand it. Falling is left to gravity and has no limit at all: a hull driven
off a roof is supposed to drop like one.

`drive.climbDrag` is what the climb costs the drive, and it is what stops a tank
riding over a car at an unchanged 40 km/h as though the car were made of paper.
Deliberately mild — it reaches the suspension as a deceleration and dives the
nose, against the ten degrees of nose-up the ground lean is asking for at the
same moment.

### Gravity is asked FIRST, and it is asked whatever the hull is doing

Where the hull would be with nothing under it is what decides whether there IS
anything under it, so the free-fall step is taken before the plank is consulted
rather than in an `else` after it. A plank dropping away slower than gravity is
still ground and the hull rides it down; one dropping away faster is a hull
that has driven off something.

What that replaced was a height test on the plank alone, which fell for a
frame, landed, zeroed the velocity and fell again — a tenth of a metre of
chatter down every slope on the map. It was invisible while a hull was rigid.
It is not invisible now: **every one of those landings is an impact the springs
answer to**, and a tank driving downhill would have sat on its bump stop the
whole way. A hull that is merely FOLLOWING the ground down carries the ground's
own rate and lands exactly once, when there is finally nothing there.

The same restructuring is what lets a hull carry a rise. **What it carries off
the end of something is the GROUND's rate and never the limiter's**, and the
two are only the same number once the tracks have caught up with what they are
standing on: a hull still owing a climb is being SHOVED, which is a constraint
and has no momentum in it, where a hull riding the ground up a grade genuinely
has the rise in hand and takes it over the crest. `drive.launchSpeed` caps what
is left, because the plank steps a quarter of a metre at a time as each contact
arrives and one frame of that reads as 16 m/s of rise. Get either half wrong
and every kerb in the city throws the tank into the air — which is what the
first version did, launching a hull 14 cm off the roof of the car it was
climbing.

**A hull in the air keeps the attitude it left with.** The ground lean is
measured against the ground BELOW the hull, which a falling tank is nowhere
near, so `drive.airTiltRate` all but stops the lerp while `grounded` is false:
a tank that drove off a ledge nose-down lands nose-down and takes the ground's
angle once its tracks are back on something. At the ground rate it levelled
itself out on the way down, which is the tell that a drop is a lift being
lowered rather than a mass in free flight.

Measured on Coldharbour, broadside over a parked car at road speed: the hull
lifts 0 → 0.55 → 1.1 m with no sag and no snap, peaks at 6.8 degrees
nose-up going on and 6.4 nose-down coming off, loses about 0.25 m/s, and the
whole encounter takes 1.1 seconds. **Coming off is not the same shape as going
on and is not meant to be**: the last pair of contacts leaves the roof with
nothing under the hull at all, so what follows is three tenths of a second of
free fall and a landing, and the springs are what that arrives as. See the
sprung body above.

### `climbHeight` decides BOTH questions, and that is the invariant

`CONFIG.vehicles.tank.drive.climbHeight` (1.25) is spent twice and the two
halves must not drift apart:

- Horizontally it is **where the collision ellipsoid's floor sits**
  (`ellipsoidOffset.y`), so anything shorter is simply not in the hull's way.
  `moveWithCollisions` has no notion of climbing and slides along a vertical
  face whatever its height, so without the lift the ground query never gets a
  chance and a tank is stopped dead by a 0.3 m kerb.
- Vertically it is **the ceiling of the band a contact will accept a surface
  from**. A top face inside the band is floor; one above it is not ground at
  all.

Get them out of step and the vehicle contradicts itself: a ceiling below the
ellipsoid's floor drives the hull through the bottom of things it then refuses
to stand on, and one above it stops the hull against a box it has already
decided is a step. 1.25 is chosen against the tallest thing on the map a tank
should plainly go over rather than round — a parked car, whose collider is the
BODY at 1.1 m.

What it costs is that the bottom `climbHeight` of the hull is not a collider: a
tank shoulders through the bottom of a barrier for the few frames it takes to
climb it. Against being stopped by kerbs and cars, that is the trade. On
Coldharbour it makes 151 of 764 collider boxes newly climbable — the 26 cars,
and the metre-high parapets, planters, benches and railings that were never
meant to stop armour.

### The sphere rides at the LEADING end

The other half of "stops dead after half the tank is inside it" was WHERE the
collision sphere sat. A 2.2 m circle on the hull's centre stops the tank when
its centre is 2.2 m off a wall, and the hull is 3.6 m long — so 1.4 m of nose
was inside the shopfront every time.

`Vehicle.aimCollider` offsets `ellipsoidOffset` by `hull.length / 2 -
collideRadius` along the hull's forward, signed by the direction of TRAVEL, so
the sphere's leading edge is the hull's own nose. Measured: the nose now stops
2 cm off the wall face, against 1.4 m inside it.

Three things about that offset, all of them load-bearing:

- **It is world-space and Babylon does not rotate it**, so it is rebuilt every
  frame the hull STIRS — moves or turns — rather than set once in the
  constructor. Turning is half of that and it was missing; see below.
- **The sign flips only while the speed passes through zero**, which is the only
  way the drive ever changes it. The flip teleports the reference point the
  length of the hull, and the end it teleports to is the end the tank has just
  driven away from — open air, every time. Verified: a hull nose-to-a-wall backs
  straight out.
- **The trailing half of the hull is not collided while the hull is moving** —
  the sphere spans -0.8 to +3.6 driving ahead. That is affordable because the
  YAW is not collided either (a hull pivots through whatever it is beside, and
  always has), so the tail was never guarded during the only manoeuvre that
  swings it. Verified: a hull parked against a wall pivots 206 degrees on the
  spot and drives away clean.

### And the arm that offset hangs on is what got the hull stuck

The 1.4 m offset is the fix above and it is also a lever. `moveWithCollisions`
sweeps a TRANSLATION and nothing else, so a hull's YAW carries the sphere round
on that arm — at `turnRate * 1.4`, 1.26 m/s at full stick — through anything the
tank is parked beside, with no test of any kind. Two things followed, and the
second is the one players reported.

**The swing used to be BANKED and spent at once.** `aimCollider` was called only
on a frame the hull was moving, so a tank that pivoted while stopped carried an
offset drawn for a heading it no longer had, and the frame the throttle was
finally touched the sphere arrived at its true place in one step. Measured: a
115 deg neutral-steer pivot at a standstill moved the sphere not at all, and
then **2.37 m in a single frame**. It is aimed on a turn as well now, which
makes the same swing the continuous 1.26 m/s above.

**And Babylon cannot get out of a sphere that is inside a box.** Its
swept-ellipsoid response ejects one by `CollisionsEpsilon * 10` per frame in the
space it has SCALED by the ellipsoid — 0.022 m of world at this radius, measured
as exactly that constant on every frame of every hang, whatever displacement was
asked of it. Against a drive pushing back in at up to 11 m/s the hull simply sat
there. From one captured pose, each input held 1.5 s: the same stick moved it
0.02 m, letting go moved it 0.00, **pressing the same stick again moved it
0.00** — and firing the GUN moved it 2.78 m, because `fireGun` writes a velocity
straight into `speed` and clears the 0.022 in one frame. A bug that reports
itself as a workaround, and the shape of the original report: *"I stop moving and
I can't start again; shooting the cannon gets me going."*

`Vehicle.freeFromWalls` is the answer and it is `ObstacleField.resolve` — the same
bucketed push-out that keeps a bot out of a tree, asked with the HULL's band
(`drive.climbHeight` above the tracks to the top of its own box, which is
`rideableAt`'s pair, so what the tank is ejected from and what it steers around
cannot come apart). Spent at `drive.freeRate`, 4 m/s: a rate rather than a snap
for `climbSlope`'s reason one axis over, and three times the fastest a pivot can
drive the sphere in, which is what makes the state unreachable rather than
merely survivable. It touches no speed — being pushed out of a wall is a
correction to a position the drive should never have reached, not a force the
tracks felt.

**Two things had to move with it.**

- **The blocked check reads PROGRESS and not distance.** `update` docks the
  speed to a third when a frame achieves less than half what it asked, which is
  the engine note for a tank pressed against a wall. As a bare magnitude it
  could not tell that from a hull being EJECTED — ground covered, every metre of
  it the wrong way — and the frames it called blocked docked the drive exactly
  when the hull needed the speed to leave. It is the achieved move projected on
  the asked direction now, and a negative one is not blocked.
- **`ObstacleField` had to be shown the RIM.** Its constructor drops boxes over
  200 m because they are bucketed by the circle of their own half-diagonal and a
  324 x 2 slab would claim 162 m of cells. They are kept on a separate list that
  only `resolve` walks: `groundAt` and `wallAt` ask what a hull stands on and
  what is in front of it, and a boundary is neither — but it is very much
  something a seven-metre vehicle can be inside. It was **445 of the 451
  remaining deep frames** once the rest of this landed.

Measured over four random-drive trajectories on Coldharbour, 32.6k frames each
side, counting frames with the sphere more than 0.5 m inside geometry:

| | before | after |
| --- | --- | --- |
| frames embedded | 8.88% | **0%** |
| deepest | 2.04 m of a 2.2 m radius — centre inside the box | **0.00 m** |
| longest unbroken spell | 13.31 s | **0 s** |

Zero on Harrowmead (22.8k frames) and Sarab (35.7k) as well. Containment is
unchanged: eight full-speed rams into a 34 x 58 building from eight bearings
tunnelled none, and 5.3k frames of wandering never left the play square.

### And a second hang under it, on OPEN ground, that the first one was hiding

The push-out above is about walls. This one has no wall in it at all, and it is
the one that reads as *"I come to a stop, press W, and it chugs for four or five
seconds before it starts moving."*

`moveWithCollisions` writes the position back **only when the move it worked out
exceeds `CollisionsEpsilon`** — one millimetre — and otherwise returns the mesh
exactly where it was, quietly. From a standstill the first frame asks for
`accel * dt^2`, which is a third of a millimetre at 120 fps. So the hull did not
move; the blocked check read that as walked-into-something and docked the speed
to a third; and the two found a fixed point:

```
s = 0.35 * (s + accel * dt)      →  s = 0.021 m/s at dt = 8.3 ms
```

Measured at exactly 0.021 m/s, on open ground, throttle wide open, hull
stationary — **11 of 12 trials, six of which never moved two metres inside eight
seconds.** The only way out was a frame long enough for `speed * dt` to clear the
millimetre, which is why it reads as a stutter that eventually gives, and why it
is **worse the better the machine**: nothing at all below about 40 fps, seconds
of it at 120.

The gate on the move is therefore the DISTANCE the frame asks for and not the
speed, because the engine's own gate is a distance. Asking below the engine's
threshold is asking for nothing, so those frames are skipped outright and
`speed` goes on building at the throttle's rate; the hull is moving inside three
frames. Nothing is lost by not asking — those frames never moved it anyway.

| pulling away from a dead stop, 12 spots of vetted open ground | before | after |
| --- | --- | --- |
| trials that stalled | 11 of 12 | **0 of 12** |
| speed while stalled | 0.017–0.023 m/s | — |
| time to 1 m/s | 2.2 s to never | **222 ms**, which is `1 / accel` |
| time to cover 2 m | 2.9 s to never | **933 ms**, which is `sqrt(2 * 2 / accel)` |

**Why it went unseen for so long is worth keeping.** A hull embedded in a wall is
ejected 0.022 m every frame by the engine, which is far over the millimetre — so
for as long as the tank spent its life stuck in geometry, the thing that was
stuck was also the thing quietly rescuing every low-speed start. Fixing the
walls is what let this one show.

### The ground costs a six-hundredth of what it did, and the camera followed

`Player.probeGround` used to be the most expensive thing the game does per frame
(0.483 ms on real hardware, a third of the game's own JS) because
`scene.pickWithRay` with a predicate walks every mesh in the scene.
`Vehicle.applyGround` used to cast the same shape of ray and cost the same, and a
driver therefore paid TWO of the frame's most expensive pick where a body on
foot paid one — the hull's ground and the chase camera's pull-in. **Neither is
a pick any more**, and the second went with every other ray in the game at
`ENGINE_UPGRADE.md` wall 2.

The hull's is now analytic: `ObstacleField.groundAt` is a bucket lookup over the
collider boxes, and the terrain is `TerrainField.surfaceAt`, which is
arithmetic. Measured in one headless session on Coldharbour, ten contacts cost
**0.0009 ms** against **0.567 ms** for the single whole-scene ray they replace —
about a six-hundredth, which is what makes the number of contacts a design
decision instead of a budget one. **A driver now pays one pick, the camera's,
and a body on foot still pays one.**

`FINDINGS.md` had already measured the analytic query against the ray and named
a VEHICLE as its better first customer: the one failure it was known to have — a
thin box pitched a few degrees claiming ground beside itself — stands a BODY on
air, and merely rocks a seven-metre hull that is riding a rate limit anyway.
**That failure is fixed** (`boxGeometry`'s `topFaceHalfDepth` — the top-face
plane is now bounded by the top FACE) **and the body followed the hull**, so the
frame's most expensive pick was gone and a driver paid only the camera's — which
is itself a box query now (`RayWorld.castBody`), so a driver pays no whole-scene
pick at all. The
hull's own two queries are unchanged by it: `groundAt` and `wallAt` answered
correctly for a tank before and answer correctly now.

The terrain is the other half of the answer rather than a fallback: the
heightfield has no collider box standing in for it (`CLAUDE.md`'s one documented
exception), so every contact takes the higher of the two.

**The two are still never both paid for.** A mounted player is not stepped at
all — `Game.updateDriver` calls `Player.updateVitals` and nothing else — so the
hull's ground takes the place of the body's.

## What a hit is worth: `DamageKind`

`Hittable.takeDamage(amount, from?, kind?)` grew a third parameter, and a tank is
the only thing in the game that reads it. `CONFIG.vehicles.tank.resist` scales
what arrives by what delivered it: `bullet` 0.05, `blast` 0.3, `shell` 1.

There is a fourth kind, `crush`, and it is the one no ROUND carries: nothing
fires it, and a tank is never in the list it is swept against, so its arm in
`Vehicle.takeDamage` is a dead branch that falls to `bullet`. It is in the
vocabulary for the reader on the other side — `RagdollSystem.applyImpulse` asks
"is this a bullet", and naming the blow is the whole of what tells it to throw
a crushed body clear of the hull. See the section below.

**This is where what each kind of damage is worth against armour is written
down**, rather than it being an emergent property of numbers scattered across
the weapon table. The alternative was giving a hull an armour figure large
enough to shrug off a rifle and then inflating every anti-tank number in the
game to get back through it.

**The AT launcher and the mine arrived and nothing here changed**, which was the
whole bet: both are `shell`-kind, both go through `Hittable.takeDamage` like
everything else, and the only line either of them added to this file is this
paragraph. See [`docs/antitank.md`](antitank.md).

The figures are chosen so the loop is REACHABLE rather than merely resisted: a
full rifle magazine does 39 of 1200, so a whole team's sustained fire kills a
hull in about a minute of nothing else happening. That is ineffective without
being a lie about the round landing — and it is what makes the destruction and
the respawn something a player can watch rather than reason about.

`bullet` is the default and nothing writes it: `CombatSystem.fire` says it for
every round in the game unless the shooter's `ShotOptions.damageKind` says
otherwise, so the sixteen shooters with nothing to declare declare nothing.

**A hull is the one target answered by its COLLIDER and not by a sphere**, and
that is a correctness rule rather than a refinement. `hitRadius` is 3.2 about the
centre against a half-length of 3.6, so a round arriving within ~32 deg of the
nose or the tail met the collider FIRST — and `CombatSystem.fire` rejects any
target sphere farther than the first opaque hit, because a body behind a wall is
not shootable. The sphere lost to its own tank. A shell laid dead on another
tank's front plate sparked off the glacis and did nothing, over 36% of all
approach bearings, and so did every rifle round `resist.bullet` is written for.

Widening the sphere to swallow the box was the other way out and is the worse
one: it would put three and a half metres of live air off each end, which is
exactly where the infantry beside the tank are standing. So `RayHit.hull` says
which hull a cast stopped on, `fire` takes armour out of the sphere sweep
entirely, and the shape a round is tested against is the shape that is drawn.
`Vehicle.hitRadius` remains only because `Hittable` requires one; nothing reads it.

## The TRACKS, and the one thing armour does that is not a weapon

**A hull kills what it drives through.** `Game.crushSweep` runs immediately
after `VehicleSystem.update`, once per frame per moving hull, and puts down
every enemy body the collider is standing in.

**It exists because of a rule this game states twice and cannot bend.** A tank
is in no baked structure — `NavGrid`, `CoverMap`, `ObstacleField`, the AO bake
and the collision bake are all built once from the finished collider set, and a
thing that MOVES cannot be in any of them. That is the ragdoll's rule and the
hull is an instance of it rather than an exception to it, and the consequence
is stated everywhere it lands: **bots walk through a parked tank exactly as
they walk through a corpse.** `moveWithCollisions` is no answer either — it
sweeps the HULL out of the world's boxes, and a body is not one of them. So
before this, a driver could put eleven metres a second through a squad standing
in the road and the squad stood there unmoved. Everything else on this vehicle
treats a body as something to shoot; this is the one that treats it as
something in the way.

### The geometry is `Vehicle.crushes`, and it asks the two heights different questions

Horizontally it is the body's hit SPHERE against the hull's footprint, in the
box's own frame through `boxGeometry.rotateToLocalXZ` — the same shape a round
is tested against, so a tank kills whom it visibly hits and the man half a
stride outside the tracks lives.

Vertically it is the FEET, and the split is not tidiness. A body's sphere is
about 1.5 m tall against a 2.9 m box, so a man CROUCHING on the deck still has
his chest inside the hull and a sphere-only test runs him over with the tank he
is standing on. His feet cannot be anywhere but on top of it or under it, so
they are what is asked: **below the deck is under the tracks, on it is riding,
and riding on a hull is the one thing a crush must not take away.** The far end
of the band is the sphere again, and it is what spares a man in the street
under a bridge a tank is crossing — nothing at all of him is inside the box.

`rotX` is 0 on this box and stays 0 (`rayBox` writes it once; the collider never
tilts, only the picture leans), which is what lets both height terms be
unrotated. The enabled/pickable gate is `rayBox`'s, so a hull that has been
taken away crushes nothing; a WRECK still could, and never does, because
nothing moves one.

### The three gates, and what each is holding back

| gate | what it stops |
| --- | --- |
| `tank.alive` | a wreck mowing down whatever it was rolling toward when it died — nothing moves one, but dying does not zero `speed` |
| `speed >= crush.minSpeed` (1.5 m/s) | a hardstanding becoming a mincer. Bots walk into parked armour all round, for the reason at the top of this section, and a hull with no speed gate would fill its own side's ticket count while sitting still |
| a DRIVER | crediting a kill to nobody. It is barely a rule — an empty hull is also one that is not moving — but `by` is what a kill is filed against, and `Game.driverOf` is where the player's seat and the bot crew are asked in `VehicleSystem`'s own order |

The gunner is never the killer: the man on the cupola gun moves nothing.

**Friendly fire is excluded by construction rather than by a team check**, as
everywhere else in this game — the list is `BattleSystem.hittablesAgainst(tank.team)`,
which is the hull's own side's enemies. Two more are skipped inside it. **A
HULL**, because armour does not run armour over: two hulls have colliders and
stop each other, and `takeDamage` on one would spend `resist.bullet` on a
body-shaped blow. **And a body riding in one**, which is `GrenadeSystem.blastAt`'s
guard for its reason: while a person is inside armour the ARMOUR is what is
being hit, and this is a path that reaches `takeDamage` directly rather than
through the one door — `CombatSystem.fire` — that already asks. Without it, two
hulls shoving each other (which their colliders permit, the ellipsoid being
narrower than the box) would kill the driver inside the one that got shoved.

### What a crushed body is worth, and where it goes

`CONFIG.vehicles.tank.crush.damage` (400) is a figure large enough to be lethal
through anything the game can put on a person rather than one balanced against
health — the same statement `onCrewLost` makes by passing a victim's whole
remaining health, made as a constant because the sweep is handed `Combatant`s
and a `Combatant` does not publish how much life is left in it. Nothing else
reads it: the corpse's departure is `deathDamage`-scaled and clamped at
`bots.death.impulse.blast.max` long before 400, so raising it changes nothing.

`tank.center` is passed as where the blow came from, and it is doing three jobs
at once — the same three `Game.wireVehicles` argues for a hull brewing up. The
corpse is thrown CLEAR of the tracks instead of folding under them, the damage
arc points at the thing that killed you, and the killfeed's enemy team is
derived from the bearing, which is right by the same derivation every other
death uses.

The kill itself takes the ordinary doors: `creditKill` files the row (keyed on
the flag the VICTIM fell in, like every other kill), `registerBotKill` charges
the ticket and offers the corpse to the pool, and a player victim needs neither
because `takeDamage` is the one door a death offline takes. A player DRIVER
gets the hitmarker and its note, on the same terms a shell's direct hit gets
them; a bot crew gets none of it.

### In a match it is the authority's, and a driven hull is swept like any other

`Game.crushSweep` is offline by construction and is never guarded for:
`updateWorld` returns at its first line in a match. The twin is
`HeadlessGame.crushSweep`, and the one way it differs is that it sweeps **every**
hull on the field, the ones a PERSON is driving included. Those are posed on
that side from the wire — but `Vehicle.updateRemote` measures `speed` out of the
ground the hull covered, precisely so everything downstream reads a remote hull
the way it reads a local one, so a person running a squad over resolves there
exactly as a bot crew's hull does. Nothing about it is predicted on the client:
the driver learns of the kill when the killfeed says so, which is the same round
trip a shell's blast already takes.

## Two seats, and what each of them is

**A hull holds two people and they do two different jobs.** `Vehicle.seats` is a
pair of booleans indexed by `DRIVER` (0) and `GUNNER` (1), and the split is:

| seat | sticks | weapon | camera |
| --- | --- | --- | --- |
| `DRIVER` | yes — throttle, steer | the main gun, laid by walking the turret to the chase camera's order | the chase camera |
| `GUNNER` | **no** | the CUPOLA machine gun, laid by walking its ring to the same camera's order | the same chase camera |

**The first person aboard drives**, and that rule is stated in exactly one
place — `VehicleSystem.seatOn`, which both `Game.offeredSeat` and
`HeadlessGame.seat` ask. A tank with a man on the cupola gun and nobody at the
sticks is a pillbox; a tank with a driver and an empty cupola is a tank, so the
driver's chair is always filled first, by a player boarding and by the bot
crews' own sweep alike.

**A hull with ONE seat left is `enterable`, and only a FULL one is an
eviction.** That is the difference the second seat makes to the "a bot crew
never denies the player their own armour" rule: the ordinary case on a map with
one hardstanding a side is a hull a bot is already driving, and the right answer
is for the player to climb onto the gun beside him rather than to throw him out
of it. `occupiedNear` now means "both chairs taken", and only that reaches
`VehicleCrew.evict`.

**Crossing between them is a THIRD verb.**
`InputManager.seatPressed` is `F`, the pad's Y and the touch layer's swap
button — the last two shared outright with `swapPressed`, which is safe for
`usePressed`'s reason: those two change WEAPONS, a driver has none, and there
is no state in which a body is both holding a rifle and sitting in a tank.
`Game.canSwapSeat` is the one place that decides whether it may happen, and
both the key and the prompt beside the crew line read it, so they cannot
disagree. Offline it is `Game.swapSeat`, which is
deliberately not `clearVehicle` + `mount`: that pair would put the player back
into the fight and take them out again inside one frame, hand the camera back
to a head that is inside a tank, and stop and restart the engine. Two seat
writes and a field is the whole of it.

**A crossing turns a BOT out of the chair it crosses into, and this rule was
the other way round until it was measured against the game.** The chair had to
be EMPTY, on the argument that a swap is not an eviction and that turning a
crewman out from inside the hull would be a second eviction path with no prompt
in front of it. What that bought was a seat the player could not sit in: the
boarding sweep fills a free chair within seconds of a mount — a hardstanding is
beside a spawn, and the crew is whoever walks past — so a player who took an
empty hull was a driver with a bot gunner before he left the yard, `F` did
nothing from then on, and there was no way round it. **Getting out and back in
does not work either**, which is the part that makes it a hole rather than a
preference: `VehicleSystem.seatOn` hands a boarder the FIRST free chair, and
the first free chair is the one just vacated.

So the crossing takes the boarding rule rather than an exception to it — **a
bot crew never denies the player their own armour** — and the objection is
answered rather than dropped: the eviction has a PROMPT in front of it now, in
the words the ground offer already uses (`TAKE OVER TANK`, `TAKE OVER GUN`
against a bot; `SWAP SEAT` into an empty chair). A PERSON is never moved, on
either side: `Game.seatHeldBy` is what tells the three kinds apart — offline
through `VehicleCrew.crewOf`, in a match through `VehicleState.by`/`by2` against
the roster, which is `crewedByBot`'s exception to "a client never learns which
slots are bots", made for the same reason (this draws a PROMPT).

**The authority makes the same move and needed a line of its own for it.**
`HeadlessGame.seat` is one method for mounting and crossing, and its fall-back
when the chair asked for is taken is *the other chair* — which on a crossing is
the chair the player just left, so a swap against a bot gunner silently put
them back where they started. The eviction below it was unreachable from that
path, because after the release a crossing never sees both chairs taken. One
`if (crossing && tank.seats[want])` is the whole of the fix.

**The HUD draws the CREW, not only your own chair.** The two seats have
different controls and a different weapon under the trigger, so a player who
cannot tell which one they took is a player pressing a throttle that steers
nothing — but the older line said only that, and the swap prompt beside it went
away when the other chair was held. **Absence is not a statement**: a hull whose
gun a bot had taken looked exactly like a vehicle with one seat, so the key that
appeared to do nothing had nothing on screen explaining it. It is now one chip
per chair under the two bars — the job, and `YOU` / `BOT` / `PLAYER` / `EMPTY`
under it, your own in the hot colour — **built from `SEATS`** (which moved to
`entities/Vehicle.ts` for this, since it is what a vehicle HAS rather than what
the AI does with one) so a vehicle with a different number of chairs draws the
chairs it has. The main gun's loader row is still DIMMED rather than removed
for a gunner: he cannot fire it, and how long until the hull can is exactly
what a man on the cupola wants to know.

## The seat

`Game.driving` is the single fact, and it is on `Game` because `Player` is a body
that knows nothing about vehicles and `VehicleSystem` owns hulls and knows
nothing about players. **`mount` and `clearVehicle` are meant to be read side by
side** — a state set in one and not cleared in the other is a player who never
really got out:

| on mount | why |
| --- | --- |
| `setBodyHidden(true)` | there is no rifle in a driver's hands, and the viewmodel is parented to a camera that is now twelve metres behind a tank |
| `player.invulnerable = true` | the HULL is what is being shot at. This stops rounds LANDING |
| `battle.removeHuman(player)` | …and this stops bots AIMING. Both are needed: a bot that could still acquire an unkillable target would stand there firing at it for the rest of the round |
| `vehicleCam.take(tank)` | the view opens down the hull's own heading |
| `sfx.engineOn()` | the one sustained voice in `Sfx` |
| `vehicles.setOccupied(tank, seat, true)` | written on the TRANSITION, never derived in `update` — derived, `enterable` would offer a chair somebody is already sitting in for the rest of the frame they got into it |

**The verb is one input field and THREE devices, and the third one had to be
built.** `InputManager.usePressed` is `E`, the pad's d-pad north, and — since a
phone could otherwise walk up to its own armour and stand there — a button
`TouchControls` puts on the glass. That last one is the only control on the layer
that comes and goes, and it has to: a key and a d-pad direction are things a
player presses to find out what they do, while a thumb has nothing to press until
something is drawn under it. `Game.offerUse` is the one door — it writes the
HUD's prompt and the field the touch layer is pushed from a frame later, so the
sentence on the button and the sentence over the crosshair are the same sentence
by construction. Two things follow from that door existing:

- **The prompt speaks the device's own language.** `E` on a keyboard, `D-PAD ↑`
  when `input.padInHand` says a pad is what is in the player's hands, and NOTHING
  on glass — the button already carries the words and is the thing being pressed,
  so a caption over it is one instruction twice. `padInHand` is `touchActive`'s
  arithmetic exactly (the most recent of the three device stamps wins) and is a
  different question from `gamepadConnected`, which is what the trigger gates
  ask: a machine with a pad plugged in and a hand on the mouse answers the two
  differently, which is the whole reason both exist.
- **A driver is told the way out.** `updateDriver` offers `EXIT TANK` every frame.
  A driver used to be told nothing at all, which is survivable on a keyboard —
  the same key got you in a moment ago — and on glass is the difference between a
  hull you can leave and one you are stuck in until it burns.

**Four ways out, and only one of them moves the body.** `dismount` (the player
asked) puts them down beside the hull and hands the camera back with
`cameraSys.reset(vehicleCam.yaw)` — the first-person camera has not been updated
for the whole drive, so its yaw is wherever the player was looking when they
walked up to the tank, and resetting to the chase camera's own yaw is the only
answer that keeps them facing what they were facing. The other three —
`onDestroyed` (the hull burned, and the crew dies with it), `enterDeploy` (any
end of a life), and `installMap` (the map is being rebuilt) — call
`clearVehicle` alone, which deliberately does not move anything.

`installMap`'s is the sharp one: without it `driving` would be a live pointer
into a disposed `Vehicle`, which is not the stale-picture failure the funnel usually
prevents but a crash the next time the camera framed it.

**A HULL BREWING UP is an explosion, and the two people it can kill must be told
the same thing about it.** `onDestroyed` kills the player and `onCrewLost` kills
a bot crewman, both through `takeDamage`, and both now pass the wreck's own
centre as the bearing and `"shell"` as the kind. It takes BOTH to get the one
reading that is not a man lying down beside a burning tank: the bearing throws
the body away from the wreck, and the kind is what makes it a throw at all —
`RagdollSystem` DROPS a body killed by a round and THROWS one killed by an
explosion (see [`deaths.md`](deaths.md)). Measured on Coldharbour: 3.3 m for the
player, 4.2 m for a crewman.

**The bearing also fixed a killfeed line that blamed the map.** `onPlayerDamaged`
derives the killer from `from` — friendly fire is excluded by construction, so
whoever it was is the other side — and treats a MISSING origin as "nobody killed
you", which is the leash and is meant to be only the leash. Burning inside a hull
passed none, so a death the enemy had earned announced itself as `OUT OF BOUNDS
killed YOU`. Nobody can destroy their own side's armour (every list a shell, a
rocket and a mine resolve against is the other team's), so the derivation is
sound here for the same reason it is everywhere else — it was only ever missing
its input.

**The body rides the hull.** `updateDriver` calls `player.nudgeTo(tank.position)`
every frame, so the conquest occupancy count, the minimap arrow, the audio
listener's fallback and the leash all keep answering "where is the player" with
"in that tank". A consequence worth naming: **a tank parked on a flag captures
it**, because the crew inside it counts exactly as a body standing there would.
The TANK is not in `Game.combatants` and never captures anything on its own.

## The turret is a MASS, and a rate limit alone could not say so

The gun does not go where the driver's look goes; the look is an ORDER and the
turret walks to it. For a long time "walks" meant one line — step the angle by
`min(|error|, traverseRate * dt)` — and that line has two silences in it, both of
which the player feels as jitter:

- **It says nothing about anything under the limit.** An order moving slower
  than 40 deg/s is copied EXACTLY, and an order moving slower than 40 deg/s is
  most aiming. What reaches one frame from a hand is not what the hand is doing:
  mouse reports arrive unevenly against a fixed step, so the per-frame delta
  wobbles by most of its own size however steadily the wrist moves, and every
  bit of that went onto the barrel. Measured on a steady drag: 2.31 rad/s^2 of
  jerk rms on a gun the hand was asking to move at a constant rate.
- **It arrests as hard as it starts.** The last frame of every sweep went from
  full traverse to nothing: 35 rad/s^2, sixty tonnes of turret stopped inside a
  sixtieth of a second, with the marker snapping onto the reticle instead of
  settling onto it.

So the axis carries a RATE (`Vehicle.turretRate` / `gunRate`, private, and nothing
outside asks anything but where the gun POINTS), and `slewRate` decides what that
rate is asked to be. Three terms, each a different question, smallest wins:

| term | the question | what it protects |
| --- | --- | --- |
| `maxRate` | what is the traverse | `traverseRate` is still exact, so a full traverse still takes nine seconds and being flanked still matters |
| `sqrt(2 * accel * \|err\|)`, with a frame's correction | how fast could it still STOP inside what is left | the arrest becomes a deceleration, and an axis that can always stop can never overshoot — which an aim a marker is drawn from may not do |
| `\|err\| / settleTime` | how is the LAST of it closed | the term above is still exact at a hundredth of a degree, where it wants a rate no frame can resolve and the axis chatters on and off the order; this closes the last degree on a time constant instead |

The rate then moves toward that by at most `accel * dt`, which is the drive's own
speed limiter in a different unit. **Nothing on the barrel can exceed
`traverseAccel` now — it IS the ceiling on the gun's jerk** — where the bare
limit's own ceiling was whatever the last frame happened to need.

**The frame's correction inside the stopping term is load-bearing and is not a
fudge.** Following that curve costs exactly `accel`, so a rate limiter stepping
along it has no margin at all and the discretisation spends the difference PAST
the order: measured at a third of a degree at 60 Hz and most of one at 20, which
is a marker drawn at the gun's range sliding through the reticle and coming back
— and frame-rate dependent, which this project does not accept in anything that
moves where rounds go. Carrying half a frame of deceleration inside the root
(`sqrt(2*a*e + h^2) - h`) leaves the axis one step in hand where it is braking
hard and vanishes as the error does, so it never becomes a floor under the last
of the movement. Measured after: a 90 degree lay takes 2.44 s at 60, 30 and 20 Hz
alike, overshoots by under a twentieth of a degree at the worst of the three,
and converges to the order exactly.

**What this costs is a LAG while the gun is TRACKING, the cost is the point, and
it is bounded from the other side of the config.** An axis that follows a noisy
order with no lag has not rejected the noise — it has passed it on; that is what
the old line did, and the steady-state error while tracking at `v` is exactly
`v * settleTime`. The bound is `crew.fireCone` (0.02 rad), the gate an AI crew's
trigger sits behind: **a turret whose tracking lag exceeds it stops firing at
anything that MOVES**, which is a bot crew silently disarmed against enemy armour
by a number in a different block. At `settleTime` 0.06 a target crossing at
0.3 rad/s — a tank at road speed inside 40 m — leaves 0.016 and the crew still
shoots; at 0.12 the same target leaves the crew outside its own cone. That is the
whole reason the settle is the shorter of the two values that were measured, and
it still leaves a quarter of the barrel jitter the bare limit passed through.

Measured on Coldharbour, at 60 Hz: a steady drag puts 0.54 rad/s^2 of jerk rms on
the gun where it used to put 2.31; a half-degree correction lands in 0.12 s and a
five-degree one in 0.35; nothing anywhere exceeds 2.4 rad/s^2.

## The CUPOLA gun, and why it is a second world angle

The commander's machine gun on its ring is the whole of what the second seat
is for, and everything about it is the turret's argument made once more, one
node further out.

**Its bearing is a WORLD angle, and that is the single decision the feature
rests on.** `Vehicle.mgYaw`/`mgPitch` are held in the world exactly as
`turretYaw`/`gunPitch` are, and `Vehicle.aimMg` writes the DIFFERENCE onto
`rig.mgMount`. The mount is parented to the turret, so a bearing held
*relative* to it would be dragged round by every traverse the driver asked
for — a gunner laid on a doorway would be swept off it the moment the main gun
moved, which is the same failure a hull turning under a held turret would be
if `turretYaw` were the hull's.

**With nobody on it the rule INVERTS, and that is right rather than an
exception.** An unmanned gun holds its LOCAL bearing and goes round with the
ring it is bolted to, because that is what a lump of steel bolted to a turret
does. `Vehicle.mgRideYaw` is the previous frame's turret bearing, and the delta
between it and this frame's is what the stowed gun is given.

**It is stepped from `VehicleSystem` rather than from `Vehicle.update`**, through
`aimMg` (walk toward an order) or `setMg` (a remote gunner's report), and that
separation is not tidiness. The two guns on one hull can have two owners of
different KINDS: a person can drive a hull posed off the wire while a bot lays
its cupola gun on the authority, or the reverse. Folded into `update` the
machine gun would only be laid on hulls somebody was DRIVING; folded into
`updateRemote` it would only ever be posed. Asked as its own question it is
answered the same way on every machine for every hull — which is why
`VehicleOrders` has four methods and not two.

The slew is `slewRate` unchanged, at `CONFIG.vehicles.tank.mg`'s own numbers:
about five times the turret's rates, because what is being swung is a gun on a
ring rather than sixty tonnes of casting, and a gunner tracking a running man
has to be able to keep up with one. The reticle rule is kept from the same end
the turret's is — `#gun-marker` is drawn from whichever gun THIS player holds,
at that gun's own range, because a gunner shown where the cannon points would
be shown a reticle for somebody else's weapon.

**What it cannot do is hurt armour, and that is the trade rather than a
limitation.** The round is a `bullet`, so `resist.bullet` (0.05) applies and a
whole belt into a hull is worth about a rifle magazine. A second gun that could
kill tanks would make the first one decoration; what this one answers is the
thing armour could not touch before, which is infantry inside the main gun's
3.6-second reload.

## The camera, and why the reticle can still not lie

`CameraSystem`'s contract is a camera that sits at the player's eye and never
leaves the head; every piece of its state is about a body standing up. So
`VehicleCamera` takes the documented hand-off (`place()`) exactly as `DeathCam`
does, and owns the two things a third-person view needs that a first-person one
never had: a distance, and something to do when there is a wall in it. The
pull-in is `DeathCam.pullIn`'s shape — one ray, cast from the anchor OUTWARD, so
the origin is always in open space.

**`docs/weapons.md`'s rule is that an aimed weapon's picture and its axis are the
same fact, and a tank breaks the usual way of keeping it**: the gun is not on the
camera, it is on a turret traversing at 40 deg/s. The promise is kept from the
other end instead —

1. the look input moves `VehicleCamera.yaw/pitch`, which are an ORDER;
2. `Vehicle` walks the gun toward them at the turret's own rate and its own
   acceleration (above);
3. `Game.fireShell` fires down the **gun's** axis, never the camera's;
4. `HUD.setGunMarker` draws `#gun-marker` where the barrel points, and
   `#hud.mounted` takes the crosshair away.

So the middle of the screen is where the driver is asking to shoot and the
marker is where the shell will go, and the two visibly converge as the turret
catches up. The marker is projected at the gun's own RANGE rather than at the
muzzle — a point on a ray projects to the same pixel wherever it is taken from,
and the muzzle is close enough to the camera to fall off the edge of the frame
at full traverse. It is hidden outright when the gun points behind the camera,
because `Vector3.Project` will happily return a mirrored point for one.

**`aim` and `place` are two calls with the world step between them.** The hull
moves in `updateWorld`; framing this frame's camera against last frame's tank is
a fifth of a metre of lag at road speed, in a shot that is nothing but a vehicle.

## The shell

Hitscan, like every other round in the game — the grenade remains the one
deliberate exception. `SHELL_SHOT` in `Game.ts` says what a shell IS: no
fall-off (a shell is a shell at any distance a 320 m map contains), no
`headMult` (the head zone is an upgrade to a body hit, and a shell has already
spent several times a headshot's worth on anything it landed on), and
`damageKind: "shell"`.

The splash goes through **`GrenadeSystem.blastAt`**, which is the one
implementation of a blast in the game; `detonate` is the other caller and passes
`CONFIG.grenade`'s own numbers. That is a real coupling and it is the lesser
evil: written again in the vehicle system it would have been a second copy of a
falloff and a per-victim line-of-sight ray, and this codebase has already paid
once for two copies of something drifting apart. `GrenadeSystem` keeps its name
because everything else in it is about the one thing that FLIES, and a shell does
not fly — only its arrival comes there.

**What the shell says about its own explosion is ONE NUMBER**, and it is
`gun.blastPower` (1.85). The blast is eight layers — a flash, a fireball of
churning lobes, a shock ring along the ground, embers, the rubble it tears out of
whatever it landed on, a low dust cloud, a smoke column and a scorch mark — and
every one of them is written for the GRENADE, which passes 1 and is the
reference exactly as the rifle is the reference for a weapon's `report`. Power
scales SIZE and COUNT and never TIME, and it reaches the light, the camera shake
and the report as well as the picture, so raising it raises all of them together.

**It is deliberately not derived from `blastRadius`,** which at 7 is SMALLER than
a frag's 8.5: a shell reaches less far and hurts far more inside where it does,
so a picture scaled off the radius would draw the heavier weapon as the smaller
bang. See `CONFIG.grenade`'s "The blast, as a picture" for the layers themselves
and [`docs/grenades.md`](grenades.md) for the machinery.

The direct hit and the splash cannot double-count a kill: `hittablesFor` is
fetched inside `blastAt`, after the direct damage, and a body killed by it is no
longer `alive` and no longer in the list. Blast kills are credited by
`wireGrenades`' existing `onBlastHit`, which needed no arm for this.

## Three states and two clocks

A hardstanding's hull is LIVE, a WRECK, or GONE:

- **`Vehicle.wreckT`** — how long the burnt-out hull stands where it died. It keeps
  its collider for all of it, so **a wreck is cover**. That is the whole reason
  destruction is not `setEnabled(false)`.
- **`respawnIn`** — how long until a fresh hull is on the hardstanding. It starts
  on the same frame and runs longer, which is what guarantees a side never
  fields two.

**A respawn is never refused.** A hardstanding is in `MapBuilder.keepClear`, so
nothing is ever built on one, and the only thing that could be standing there is
a body — which resolves itself, because `moveWithCollisions` pushes them out on
their next frame. Refusing would mean a side losing its armour for the rest of
the round because a bot was loitering, which is far worse than a shove.

The hull is POOLED: `Vehicle.placeAt` puts a destroyed one back rather than building
a new one, and `resetTankPose` is what guarantees nothing survives the round it
died in. Nothing is disposed inside a round.

## The engine, and the two voices it is

A hull makes a noise whoever is in it. There are **two kinds of voice and one
graph**, and the graph is `Sfx.buildEngine` — six sources held open, five layers
hanging off one gain swinging at the firing rate, and the whole of the argument
for what a diesel sounds like is on that method.

| voice | who | how it is heard |
| --- | --- | --- |
| `engineOn` / `engineDrive` / `engineOff` | the hull the PLAYER is sitting in | unpanned and uncapped, for the reason the player's own report is: it is not a sound in the world, it is the vehicle you are in |
| `hullEngine` / `hullEngineOff` / `enginesOff` | every OTHER occupied hull | a `PannerNode`, at `Vehicle.center`, gated at `CONFIG.audio.engineRange` |

**The second one is driven per FRAME rather than opened on a mount**, and that
is the difference the rest of it follows from. What is being tracked is not
somebody getting in, it is a tank being within earshot — so `Game.pushHullEngines`
walks the fleet every frame and the voice is built when a hull comes into range
and wound down when it leaves. Three things silence one: it is the hull the
player is inside (which has the unpanned voice already, and would otherwise be
heard twice), it is a wreck, or `Vehicle.occupied` is false — **a hull parked on its
hardstanding is silent until somebody climbs aboard**, which is the same one fact
stated on the hull that the boarding sweep and the wreck clock read, and which a
match writes off the snapshot.

**There is no CATCH on a hull voice**, and that is not an oversight. The three
one-shots `engineOn` fires are a starter motor turning over; fired on a range
crossing they would be a tank starting up once a street.

**`load` and `speed` are both the hull's own speed.** The throttle belongs to
whoever is holding the stick and nobody outside the hull can see it — the same
call `Game.frameVehicleCamera` already makes for a GUNNER, who is sitting in the
thing and still has no business revving it.

**The rolloff is INVERSE, alone in `Sfx.ts`.** Every one-shot in that file is
linear over `maxDistance`, which reaches exactly nothing at its own gate and
needs no more thought. An engine has to carry four times as far, and linear over
150 m is a machine as loud at fifty metres as at ten. Inverse is what a point
source does, and it is what makes an engine GROW as the thing arrives. It also
costs `HULL_ENGINE_LEVEL`: the rolloff bites from `refDistance` (8 m), so levels
tuned for a graph sitting in your head with nothing in front of it come out as a
tank you cannot hear.

**A frame that did not step the fleet owes `enginesOff`.** `Game.fleetStepped` is
raised by `updateWorld` and by `updateNetWorld` and spent by `pushHullEngines`,
which is a flag rather than a test on the state because the state does not answer
it: offline the world is held under the deploy card and the pause card and
stepped under the death cam, and in a netplay round it is stepped under all
three. A held world is a fleet whose speeds are frozen, so a voice left running
is a tank droning in a street where nothing moves. The offline PAUSE is the one
held world `enginesOff` refuses, and it refuses because the pause card suspends
the audio context — which is already holding these voices exactly as it holds
the tail of the last shot, and stopping them as well would put a half-second
wind-down under the fresh voice the resume rebuilds. It is also what makes a map
rebuild safe without knowing anything about one — the key is the hull's index in
the fleet, and `installMap` runs from `loading` and from the editor, neither of
which steps a fleet.

## What a map owes

`MapLayout.vehicles` is absent on Hollowmere and Greyfen, and a map that says
nothing is unaffected — `VehicleSystem` builds nothing, costs nothing and is
never asked anything. Coldharbour and Harrowmead state two each, one per team;
Sarab states FOUR, a tank and a truck a side. What a map owes to be able to:

- **Ground a seven-metre hull can get off.** On Coldharbour the two corner yards
  are the only 32 m squares on the map with nothing in them, which is also why
  the home spawns are there; everywhere else is a 26 m tower footprint or a 16 m
  avenue. On Harrowmead it is the flat pad each home yard was already levelled
  to — 2.2 over x -172..-140, z -172..-140 in the south-west and 2.0 over the
  mirrored square in the north-east — which is what makes a hull arrive with its
  ten track contacts inside 8 cm of one plane instead of standing on a slope.
- **A place clear of the infantry spawns.** A hull arriving on the respawn timer
  must not be sitting where somebody just deployed. `keepClear` guarantees no
  PROP is built there; the spacing from the spawn points is the layout's job.
  Eight metres to the nearest, on both maps.
- **Room to turn, and it is the KIND's number.** `collideRadius` sets the
  narrowest gap a vehicle can drive through at twice itself — the sphere rides
  at the leading end but keeps its radius — which is 4.4 m for the tank and
  3.2 m for the truck. Coldharbour's avenues are 16; Sarab's old-town alleys
  are seven, which is what makes them a truck's ground and not a tank's.
- **Somewhere to GO, which the city answered with a road and the vale cannot.**
  Coldharbour's heading points a fresh hull down an avenue; Harrowmead has no
  avenue, so what was checked instead is the GROUND along the bearing. Both its
  departures climb — the knoll north-east of the south-west yard at a 0.28
  gradient, the orchard hill's shoulder south-west of the north-east yard at
  0.24 — and both are well inside the band `climbHeight` accepts a surface from,
  which is the query that decides whether a rise is ground or a wall. A bearing
  laid over ground a hull cannot take is the one way this entry is wrong while
  still looking right in the layout, and it is the one thing here that no
  amount of clearance checking finds.

  Sarab's two truck pads were checked exactly this way and the numbers are in
  its layout: dead level over the whole footprint, 22 m to the nearest
  structure over 35 cm, 20.8 m to the nearest infantry spawn, and a departure
  bearing that runs 80 m out of the yard through a corridor never narrower than
  9.1 m at a gradient never over 0.071. The first candidate — on the yard's own
  diagonal — was rejected because the bearing ran into a shed at 36 m, which is
  what the corridor check is for.

Adding a hardstanding changes the layout hash, so `npm run collision` has to be
re-run — the entries join `MapBuilder.keepClear`, which is an input to scatter
placement and therefore to the nav graph. **`keepClear`'s radius is the
vehicle's OWN half-length plus 1.5**, so a truck's pad is cleared to a truck
rather than to a tank: deriving it from the biggest kind would reject scatter
candidates a small vehicle has no reason to, and on a seeded field one extra
rejection re-rolls every prop drawn after it. On all three maps nothing
actually moved and only the hash did — on Harrowmead and Sarab that was
arranged rather than lucky, because every spot stands more than `keepClear`'s
radius clear of every blocking scatter region. `npm run parity` still passes.

**A map's own GENERATOR owes the entries too, where it has one.** Sarab's
layout is emitted by `npm run sarab`, which claims each hardstanding's ground
before the yard is dressed around it — so a pad added to `layout.ts` and not to
the generator is a pad the next regeneration puts a shed on. The order the
entries are emitted in matters as well: an entry's INDEX is a hull's identity on
the wire (`VehicleState.i`), so a hand-authored list that regenerates in a
different order is two builds that disagree about which hull is which.

## Bots drive, and the road graph turned out not to be the blocker

This entry used to be in the list below, and the reason it gave was: *"an AI
driver needs a road graph the nav grid does not have — `NavGrid`'s node is a
body's standing surface, and a 7.2 m hull cannot use one."* That is still true
about `NavGrid`. It was wrong about what a driver needs.

**A driver does not need a route. It needs a bearing and an answer to "is that
way a wall".** The first is what a body's flow field already gives at map
scale — Coldharbour's avenues are 16 m wide and the field runs down the middle
of them; what it gets wrong is the last few metres, where it offers a 1.6 m
doorway. The second is `Vehicle.rideableAt`, which is the analytic climb-band query
this vehicle has been answering ten times a frame since it learned to stand on
its tracks, spent on where the hull is ABOUT to be instead of where it is. A fan
of whiskers over that turns the body's bearing into a hull's, and between them
they are a road graph evaluated locally and never baked — which is the only kind
a moving thing could have been in anyway, for the same reason a hull is in no
other baked structure.

`systems/VehicleCrew.ts` is the whole of it and its header carries the argument.
What belongs here is what a crew is to the rest of the vehicle.

### A crewed bot is out of the fight, exactly as a mounted player is

`Game.mount` hides the player's body, makes it invulnerable and takes it out of
`BattleSystem`'s human list. A bot goes the same way, and the machinery is the
BENCH's twin: `BattleSystem.crewed` is a second `Set<Bot>`, written only through
`setCrewed`, and **`BattleSystem.aside` is the one test every loop over `bots`
now owes** — never `benched.has` directly. Two sets rather than one because they
are cleared by different things, and one predicate over them because a third
reason must not be addable at eighteen call sites and missable at seventeen.

Three things a driver keeps that a benched bot does not:

- **Its life.** Still `alive`, still holding its roster slot and its scoreboard
  row. Burning the hull kills the crew and charges the ticket, through the
  ordinary door — `Bot.takeDamage` then `Game.registerBotKill`, with the hull's
  own centre as the bearing the blow came from, so the corpse is thrown clear of
  the wreck rather than lying down beside it.
- **Its position**, slaved to the hull every frame by `Bot.nudgeTo` —
  `Player.nudgeTo`'s twin, added for this. So the conquest occupancy count, the
  minimap blip and the squad centroid all go on answering "where is that body"
  with "in that tank", which means **a bot-crewed tank parked on a flag captures
  it**, exactly as the player's does and for the identical reason.
- **Its squad's order.** `BattleSystem.update` applies `applyOrder` to the crewed
  set explicitly, because a driver skips the think pass that would otherwise
  refresh it. **The tank goes where its crewman's squad was going**, so armour
  needs no objective planner of its own and cannot disagree with the one the
  round already has.

### Two bots, two jobs

A hull's boarding sweep fills BOTH chairs, driver first, and the two crewmen
are two different bodies with two different brains — `VehicleCrew.Crew` carries a
`seat`, and `stepCrew` branches on it after the think clock and the held target,
which are one crewman's whichever job he is doing.

**The gunner is looking for something else entirely**, and that one line is
what makes him worth a roster slot: a machine gun cannot hurt armour, so a
gunner who acquired the enemy hull the way the driver does would spend the fight
rattling rounds off it while the squad that arrived with it walked past. So he
sees INFANTRY only (`crew.mgRange`, 70 m), lays his gun off the muzzle exactly
as the driver lays his, and fires in BURSTS (`mgLayTime`, `mgBurst`, `mgPause`)
— because a gun with no magazine and no reload, held down, is a hosepipe that
never stops, which is both unfair and unreadable. The gap is a gap a man can
cross the street in.

He also has no ranging error of his own: `drawLay` zeroes his aim point,
because his inaccuracy lives in the CONE (`mg.spread`) and giving him both
would be counting the same miss twice.

**A gunner with no target holds his lay** rather than returning to the hull's
heading, which is the opposite of what the driver's gun does and is right both
ways round: a tank that arrives in a street with its main armament already
pointing down it is worth a lot, and a machine gun that swings off the last
thing it saw is worth nothing.

### Who gets in, and who gets it back

**A tank is never a DESTINATION.** No flow field leads to one, no squad is
ordered to man it, nothing pulls a bot off the fight to fetch armour — the crew
is whoever walks past inside `crew.boardRadius`. On both maps that is every
reinforcement, because the hardstandings are in the same yards as the home
spawns — Coldharbour's are eight-ish metres off, Harrowmead's are 8, 13 and 17,
and all of it is inside the 18 the sweep reaches. That is what a hardstanding in
the home yard BUYS, and a map that parked its armour somewhere scenic instead
would have a tank nobody ever gets into. Making it a destination would be the
contact call's rejected mistake at a larger scale: a squad that walks to the
tank is a squad not walking to the flag.

**A bot crew never denies the player their own armour.** A map states one
hardstanding a side, so a crew that held its seat for the life of the hull would
make whether the player ever drives a race to the yard.
`VehicleSystem.occupiedNear` is `enterable`'s mirror, `Game.offeredSeat` prefers
an empty hull and falls back to a crewed one, the prompt says `TAKE OVER TANK`,
and pressing it runs `VehicleCrew.evict` and `mount` on the same frame — one gesture,
because a seat given up and not immediately taken is one the boarding sweep can
re-crew. Armour is something the AI uses while nobody else wants it.

**A crew never gets out on its own** and never steals the other side's hull. The
first is deliberate: knowing when a tank is a liability is a judgement no number
here could make honestly. The second is `enterable`'s team lock, for `enterable`'s
reason.

### The gun

`Game.resolveShell` is the one implementation of a round out of a tank gun, and
`fireShell` is now the player's two lines on top of it — the camera kick and the
rumble. Everything else, damage included, is shared, because the player's tank
and a bot's are the same vehicle and two copies of a damage figure are two things
that drift. The target list is `hittablesAgainst(tank.team)`, keyed on the HULL's
side rather than the player's, and `hearGunshot` says the hull's side too.

Three rules the crew's gunnery answers to:

- **Armour outranks infantry.** A tank's gun is the only thing on the field that
  reliably kills another tank, and a crew that shot at whichever body was nearest
  while an enemy hull manoeuvred past it would be spending the one weapon that
  mattered on the one target that did not. It is the `Combatant.armoured` bit
  again, read from the other end of the duel `Bot.considerRocket` reads it from.
- **The error is on the AIM POINT, not on the barrel.** `crew.scatter` is a
  ranging mistake drawn ONCE per lay and held — redrawn per tick it is wider than
  `fireCone` at any useful range, so the gun never settles and the trigger never
  goes. It is `CONFIG.antiTankBots.scatter`'s counterpart, and unlike a cone it is
  something the driver being shot at can watch the gun make.
- **`layTime` is `Bot.aimT`.** A turret that fired on the frame it arrived would
  be indistinguishable from one that had been laid there all along.

### Two bugs this found, both of them the hull's own geometry

Both were measured on Coldharbour and both are fixed; they are written down
because each will be re-introduced by anything that adds a second vehicle.

- **A hull blocks its own line of sight.** `Vehicle.eyePos` is the cupola, five
  centimetres above the top of its own collider box, so a sightline to anything
  shorter than 2.95 m dives straight back into the box within the hull's own
  length. Measured: no line of sight to a body standing in the open at 20, 25,
  30, 40 or 50 m dead ahead. The fix is the chase camera's — take the hull out of
  the pick for the length of the ray, two property writes and no allocation, made
  by the CALLER because `world/solid.ts` forbids minting a predicate that closes
  over a mesh. `Game`'s `CrewCtx.visibleFrom` is where it lives.
- **A whisker fan must reach the nose, and must be denser than the narrowest
  thing it may not hit.** With the probes spread evenly from a third of the reach,
  anything closer than four metres was invisible — which never showed on a
  straight approach and showed the instant the hull TURNED, swinging a bearing
  whose near field had never been probed onto a wall already alongside. And at
  three points across the beam the samples are 1.7 m apart, so Coldharbour's
  shopfront colonnades — 0.6 m pillars on a 3.3 m pitch — fell between them and a
  driver read a building frontage as open street. Four depths starting at the nose
  and seven laterals at 0.57 m is what holds; `WHISKER_DEPTHS` and
  `WHISKER_LATERAL` carry the measurements.

There is a third failure that is neither of those and is the reason
`crew.detourTime` exists: **a fan alone cannot commit.** The whiskers are
re-evaluated from a hull that has just turned, so the bearings that were blocked
a moment ago open as the nose swings and the one being followed closes. Measured,
a driver that re-picked freely sat at one corner for fourteen seconds with the
stick hard over each way in turn and the hull going nowhere. Holding the chosen
bearing for a few seconds is `Bot.detourT`'s answer to the identical problem, and
the commitment is dropped early the moment that bearing stops being clear.

Measured with all three in: a crew boarded from its own spawn closes from 191 m
to 44 m of Coldharbour's central flag in 24 seconds, at road speed, with no
reversals and no grinding. Before the fan was widened it stalled at 122 m and
sawed against one colonnade for the rest of the run.

## Armour in a match

**A hull exists on the authority and on every client, and the one question is
who decides where it is.** The answer is the same one `docs/multiplayer.md`
gives for a body, applied to the one other thing a person can be inside: the
person holding the sticks simulates their own tank exactly as they simulate
their own legs and REPORTS it (`DriveMessage`), the server validates the step
and relays it, and everybody else draws the relay. Every other hull on the
field — parked, wrecked, or driven by a bot crew — is simulated on the
authority and posed from the wire.

That splits cleanly across the two `VehicleOrders` questions, and the two sides
are mirror images of each other:

| | `driveFor` answers for | `remoteFor` answers for |
| --- | --- | --- |
| **client** | the one hull this player is DRIVING | every other hull |
| **authority** | every bot-driven hull | the hulls with a person at the sticks |

**The second seat is a second pair of questions and NOT a mode on the first**,
because the two chairs in one hull can be filled by two different kinds of
thing at once. `gunFor` and `remoteGunFor` split exactly as the pair above
does, and a client whose player is DRIVING still asks `remoteGunFor` (somebody
else is on that gun) while a client whose player is GUNNING asks `remoteFor`
(somebody else has the sticks). All four combinations are ordinary and none of
them is representable through one lookup.

The consequence lands in `NetVehicles`: it used to DROP the whole sample for
the hull carrying the local slot, which was right while a hull held one person
— whatever was in that frame was that person's own work. It is wrong now, so
**every sample is kept and the refusal moved to the READ**: `stateFor` and
`mgFor` are declined independently by `Game.vehicleOrders`, which is the only
layer that knows which chair this player is in.

**What travels is six numbers and two flags**, and what does not is the whole
picture: no pitch, no roll, no heave, no track run, no antenna bend. Every one
of those is a fact about the ground a hull is standing on, and every machine in
the match holds the identical collider world and heightfield — so
`Vehicle.updateRemote` re-derives them locally off the position that did arrive.
That is cheaper than sending them AND more stable than interpolating them, and
it is why **the height is the local probe's rather than the wire's**: an
interpolated `y` would be in a permanent argument with the plank the springs
are measured against. The wire's `y` is kept for the RESYNC alone — more than
`REMOTE_RESYNC_Y` (1 m) of disagreement is not float noise, it is a hull that
has driven off something or been put back on its pad, and the local guess has
to be abandoned rather than climbed out of at the kerb rate.

**`speed` is MEASURED from the ground covered and then BOUNDED by what a hull
can do.** Measured, because it is what the belts, the climb limiter and the
suspension's acceleration all read and a driver reporting it could report
anything; bounded, because a frame that runs long advances the render clock
further than its clamped `dt` says, and the ground covered over that step
divides out at several times road speed. One long frame would otherwise slam
the springs onto their stops and run the tracks like a conveyor for a hull that
was driving perfectly steadily.

**A hull in a match refuses local damage.** `Vehicle.predicted` is
`NetSoldier.takeDamage`'s rule for the one target on a client that is a real
simulated object rather than a pooled ghost — without it a client could kill a
tank on its own screen, open the street, burn the crew, and then have the next
snapshot put a healthy hull back in the middle of it. It also stands both
hardstanding clocks down: when a wreck is taken away and when a fresh hull
arrives are the authority's, and `Game.syncNetVehicles` applies all three
transitions as edges off the snapshot.

**A GUNNER reports one bearing and nothing else.** `GunnerMessage` is
`DriveMessage` for the other chair and it carries an angle where that carries a
position, for the one reason that matters: a gunner moves nothing. He has no
body of his own (the hull carries him, exactly as it carries the driver) and no
hull of his own (somebody else may be driving it, or nobody), so the only thing
about the world he decides is where one gun points — and he sends this INSTEAD
of `move`, exactly as a driver sends `drive` instead of it.

There is nothing to validate, and that is the whole difference from the hull
next door. A position is a claim about the world and goes through
`validateDrive`; a bearing claims nothing at all, and the worst a lying client
can do is point a machine gun somewhere a ring could not have swung it — which
buys nothing, because the ROUND is re-resolved on the authority against the
same cone check every other shot takes. `MgMessage` is that round, and it is a
separate verb from `ShellMessage` because the server's gate for each is the
CHAIR rather than the weapon: a `shell` from the gunner's seat and an `mg` from
the driver's are both refused.

**Getting in and getting out are ASKS.** `MountMessage` names a hardstanding
and — optionally — a seat, and the authority re-derives every term of the offer
against its own copy: the hull's team, its life, the distance to the body it
holds, which chairs are actually free, and whether a bot in one of them may be
turned out. It answers with a `seat` event addressed to the asker, carrying
WHICH chair was granted. The seat field is a PREFERENCE and never a claim —
asked for one that is taken, the other is granted if it is free — which is what
makes "the first man aboard drives" a fact about the server's own copy of the
fleet at the instant the ask arrives rather than something a client decided.

**A SEAT SWAP is the same message**, from a peer already in that hull naming
the other chair, and it goes through the same `HeadlessGame.seat`: the chair
under them is released and the new one taken on the same frame, while
everything a body owes while it is aboard — the invulnerability, the absence
from every bot's target list — is left standing, because none of it was ever
about which chair. It is granted only when the chair asked for is EMPTY: a swap
is not an eviction, and turning a PERSON out is a thing no key in this game
does.

`DismountMessage` names nothing, because the server knows which seat a peer is
in, and the position the body lands at comes back on the same event: where a
dismount goes is geometry a client could compute, but it is a POSITION, and a
position is the authority's for the reason a spawn's is.

**Occupancy is stated once, on the hull — twice over.** `VehicleState.by` and
`by2` are the roster slots in the two chairs, and every question a client asks
is answered from that pair: may I get into that one, may I cross to the other
chair, and is the man in that slot drawn standing up. Two fields rather than an
array for the reason `CrewSeat` is two constants: the chairs are not
interchangeable, and every question names one of them. Carried on
`EntityState` as well it would be two copies of one fact, and the copy that
went stale would be the one deciding whether a body is on screen — a crewman
drawn in the road at his own tank's position, moving at his own tank's speed,
which reads as a man being dragged under the tracks. `NetRoster.setRiding` is
where it lands, and it takes a riding body out of `hittablesAgainst` too, for
the reason `Game.mount` makes the player invulnerable: the TANK is what is
being shot at.

**A driver reports a hull INSTEAD of a body, not beside one.** `DriveMessage`
replaces `MoveMessage` for as long as the seat is held, because a driver has no
body of their own — `Game.updateDriver` slaves `Player.position` to the hull
and `HeadlessGame.step` does the same on the far side. A client sending both
would be reporting one person in two places, and `Match.onMove` refuses a
seated player for exactly that reason (as `onShot` and `onGrenade` refuse one:
there is no rifle in a driver's hands).

**The speed bound knows what a player is sitting in.** `validateDrive` is
`validateMove` with the tank's ceiling and without the other two checks, and
each omission is a decision rather than a saving: there is no ground test
because `Vehicle.updateRemote` stands the reported hull on its own ten track
contacts on the authority's side, so a claimed height is never taken; and there
is no solid test because a hull legitimately stands inside `map.obstacles` — it
drives OVER the things a body walks around, which is what `climbHeight` is for.

**A driver is never leashed**, which is the rule armour already followed
offline and one with teeth on Harrowmead, the single map with both an open
boundary and a hardstanding. Without it the first driver to take the long way
round a flank is counted out and burned in his own tank by a countdown he was
never shown.

**The shell is re-fired rather than rewound.** `ShellMessage` takes `onShot`'s
gates — a rate, a cone and an origin — and then uses none of the claim: the
round goes down the authority's own gun, from its own muzzle, at its own
reload. The cone is measured against the driver's reported LOOK rather than
against the gun, because the gun's bearing is the thing being claimed, and it
is WIDER than a rifle's (50 degrees) because the turret is walking toward the
look at its own rate and the two legitimately disagree by most of a traverse.
There is no rewind and none is owed: a shell is `blastRadius` wide and slow to
reload, so the metre a rewind would recover is inside its own splash.

**A client predicts the shell's tracer and not its blast.** The local ray
buys the shooter what they are owed the frame the trigger goes — the tracer,
the impact, the report and the light — and the splash is skipped outright,
which is where this differs from a thrown grenade. A grenade's local copy is
the ARC the thrower watched and its blast goes off within centimetres of the
authority's; a shell's local blast would go off at whatever this client's own
ray happened to find, which can be a street away.

## Not built, on purpose

- **~~Netplay.~~ Built** — see "Armour in a match" above, which is where this
  entry used to say a hull could not cross the wire.
- **~~One kind.~~ Two** — see "Two kinds, and the ONE branch between them"
  above. The entry that used to stand here said that nothing in the code was
  special-cased to a tank but that nothing had been designed for two either,
  and that "the plural in these file names is aspirational as to KINDS". It is
  not any more: `Tank.ts` is `Vehicle.ts`, `TankCrew.ts` is `VehicleCrew.ts`,
  the rig moved to `vehicleRig.ts`, and what a kind IS lives in
  `vehicleKinds.ts`. The prediction was right about the cost — a second kind
  was a second model and a second `CONFIG` block — and wrong about one thing:
  the forty-three reads of `CONFIG.vehicles.tank` inside the hull had to become
  reads of a spec first.
- **~~One seat.~~ Two** — see "Two seats, and what each of them is" above. The
  entry that used to stand here argued that a commander/gunner split bought
  only "a turret that searches while the hull drives somewhere else", which the
  turret already gave for free by not being tied to the heading. That was true
  of a split over ONE gun; what the second seat actually buys is a SECOND gun,
  aimed somewhere the first is not, against the targets the first cannot spend
  a shell on.
- **There is no third seat and no loader**, and no kind has a seat count of
  its own. Two chairs are two jobs; a third would be a body with nothing to do,
  which is why `CrewSeat` is a pair of constants rather than an enum that can
  grow. The HUD's crew line is nonetheless built from `SEATS` rather than from
  two hardcoded chips, so a kind that one day has one or three draws what it
  has.
- **A kind cannot state its own seats, its own enter radius or its own exit
  offset.** `CONFIG.vehicles`' fleet-wide block holds those three, and they are
  sized against the TANK — 6.5 m to be offered a way in and 3.4 m to be put
  down beside it. Both are generous for a smaller vehicle rather than wrong for
  one, which is why they were left shared: a truck's boarding circle reaching
  4 m past its nose costs nothing, and a dismount landing a metre further out
  than it needs to is a step, not a bug.
- **A passenger cannot ride on the hull.** Infantry can stand on the deck —
  `Vehicle.deckAt` says so — but standing on a moving tank is standing on a
  teleporting collider, and nothing carries them.
- **Bots do not drive the hull they cannot use.** They still walk through a
  parked one, for the ragdoll's reason above, and one per squad still shoots
  ROCKETS at it. What they DO do now is crew it — see the section above, which
  is where this entry used to say they never would.
- **The editor builds none.** A vehicle is not level data to be authored — the
  hardstanding is, and that is a layout entry. A solid, pickable mesh with no
  `SelectionRef` behind it is also something the centre-screen pick can land on
  and fail to resolve.
- **No shadow.** A hull is not registered with `ShadowSystem`, for the reason
  characters are not: the depth map re-renders only when the texel-snapped focus
  moves, so a tank driving past a stationary observer would drag a stale shadow.
  Characters get blob discs instead; a vehicle gets nothing yet.
- **No third kind, and in particular nothing that FLIES or FLOATS.** Both
  existing kinds stand on ground contacts against `TerrainField` and the
  collider boxes, and `standOnGround` is the whole of what a vehicle's
  relationship with the world is. A helicopter is not a `VehicleSpec` with
  different numbers in it.
- **Team-locked.** `VehicleSystem.enterable` refuses the other side's armour.
  Stealing it is a real design choice and a good one in some shooters, but made
  by accident it would mean a hardstanding's respawn timer feeding the wrong team
  for the rest of the round.
