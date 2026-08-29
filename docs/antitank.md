# Anti-tank: the third slot, the rocket that flies, and the mine that waits

What the anti-tank kit IS to each subsystem that meets one, why the rocket is
the second thing in this game that is not hitscan, why the mine is not a
projectile at all, and what is deliberately not built. Split out of
[`CLAUDE.md`](../CLAUDE.md), which keeps the summary; this file is the contract
for `src/config/equipment.ts`, `src/entities/equipment.ts`,
`src/entities/RpgModel.ts`, `src/entities/MineModel.ts`,
`src/systems/AntiTankSystem.ts`, and for `Game`'s `fireOrdnance` /
`launchRocket` / `layMine` / `resolveOrdnance` / `armourOffered`.

## The shape of it

The kit is five things and one line of map data:

| the thing | what it owns |
| --- | --- |
| `MapLayout.vehicles` | whether the slot exists at all. A map with no hardstanding has no armour, and a kit with nothing to shoot at does not offer an anti-tank weapon |
| `config/equipment.ts` | the two items: what one is worth, how a rocket flies, how a mine arms, and how each is carried |
| `entities/equipment.ts` | the derivation from that table to a `WeaponSetup` the carry path can hold, and to the `OrdnanceEffect` a detonation is spent through |
| `entities/RpgModel.ts` / `MineModel.ts` | what each looks like at both ends: the thing in the hands and the thing in the world |
| `systems/AntiTankSystem.ts` | the rocket pool, the mine pool, the arm clocks and the trigger test |

`Game` is the only place they meet, exactly as with every other system. It holds
the pick (`Game.equipment`), decides whether there is a slot for it
(`armourOffered`), branches the trigger into `fireOrdnance`, and answers the one
question the system asks about a world it may not know.

**There is no third system-to-system edge.** `AntiTankSystem` has never heard of
a `VehicleSystem`, a `Vehicle`, a `Player` or a `GrenadeSystem`: it asks "is there a
hostile hull within this many metres of this point" through `hullNear` and
announces "this went off, on this" through `onDetonated`, and `Game` wires both.

## One slot, two items, and why they are one decision

`CONFIG.equipment` has two entries and the kit screen offers one row. A launcher
is armour you can chase; a mine is armour you can refuse ground to. A player who
could carry both would simply carry both, and the CHOICE — not the hardware — is
what the slot is for.

**Both are offered only where there is armour**, which today means Coldharbour
or Harrowmead. `Game.armourOffered` is the one term `installMap` already
applies to the hulls themselves: the map states a `vehicles` entry. It used to
carry a second — "and the round is not a netplay one" — and that came off when
armour reached a match, because the two facts were always one fact and it is
`MapLayout.vehicles` that decides it.
On every other map the third slot does not exist — the kit screen
draws no row, `Player.slots` is two long, the HUD's anti-tank line is absent, and
`3` is a key that does nothing. **A slot that is not there is not a slot that is
empty**, and drawing a greyed one would be the kit screen explaining a rule
instead of the map simply not having it.

The PICK survives the maps that do not offer it (`prefs.readEquipment`), because
it is the player's and not the map's: walking off an armoured map and back on
must not have quietly swapped a launcher for a stack of mines.

## An AT item is CARRIED as a weapon and RESOLVED as nothing like one

`equipmentSetup` hands back a plain `WeaponSetup`. That is the whole trick, and
it is what buys the feature for almost nothing: the holster, the draw, the swap,
the viewmodel rig, the camera fit, the ADS blend, the HUD caption and the
trigger's three-way gate all work on an AT item with nothing taught about it.
`WeaponSetup.id` is a `CarriedId` — `WeaponId | EquipmentId` — and
`carriedSetup` is the one function that resolves either.

What is NOT there is every field that would make it a gun, and each constant in
`equipmentSetup` is a statement rather than a placeholder:

- **`damage` and `damageFar` are 0** and the fall-off band is degenerate.
  Nothing here fires a bullet, and nothing here goes through
  `CombatSystem.fire`. What an AT item is worth is `ordnanceEffect`, resolved at
  the detonation.
- **`magSize` IS `carried`.** There is no magazine and no reserve behind it: the
  whole of a life's ammunition is in the hands, refilled by death and by nothing
  else — the economy `CONFIG.grenade.carried` already runs on.
- **`reloadTime` is 0 and unreachable.** `Player.startReload` refuses the slot
  outright, and `tryShot` does not auto-start one on an empty magazine. A spent
  launcher is a spent launcher until the next life. That is a statement about
  the AMMUNITION and not about the animation: the launcher does have a load
  gesture, and it runs on the fire cooldown rather than on this — see below.
- **`semiAuto` is true and `burst` is 1.** One pull is one rocket or one mine,
  and a held trigger may never spend the second.
- **The spreads are 0.** A rocket goes where the tube points and a mine goes
  where the hands put it, so there is no cone for the reticle to lie about.

**Three things an AT item does not do, and they are one test in `tryShot`
because they are one fact — it is not a gun**: no brass, because nothing here is
cased; no muzzle strobe, because a launcher's light is the motor leaving and
`Game` puts that at the rocket; and no auto-reload, because there is nothing
behind the last round to load. What happens instead is a **swap back to the
primary once the tube is empty**, which is what every shooter does with a spent
launcher and what stops the slot being a dry click.

### The wheel cycles and the number keys name

`Player.slungSlot` is `(slot + 1) % slots.length`. With two slots that is the
toggle it has always been; with three it is the only shape that works, because a
**phone has no number keys and a pad has no button left for one** — a third slot
reachable only by `3` would be a third slot two of the three input devices could
not get at. It costs a second press to come back to the primary, which is what
every shooter's weapon wheel already costs.

`Player.drawSlot` bounds-checks against the slots that exist rather than
switching on a constant, which is what makes `3` on a map with no armour a key
press that does nothing rather than a special case in `InputManager`.

## What a hit is worth: TWO numbers, and why one will not do

`OrdnanceEffect` carries `damage` — what the thing does to the HULL it struck —
and a `blast` — what it does to everything else. It is the split the tank's own
gun already makes, and it is forced rather than stylistic: **one falloff curve
cannot serve both a seven-metre vehicle and a one-metre body.** A curve wide
enough to reach a hull's centre from its nose kills infantry at eight metres,
and a curve tuned for infantry does a third of its damage to the tank it hit
dead on.

`Game.resolveOrdnance` is the one place both are spent, because the direct hit
is a `Hittable` and the splash is `GrenadeSystem.blastAt` — the one
implementation of an explosion in this game, which the tank shell already goes
through. The two cannot double-count a kill for the reason `fireShell`'s two
resolutions cannot: `hittablesFor` is fetched INSIDE `blastAt`, after the direct
hit has been dealt, so a hull finished by the strike is no longer `alive` and no
longer in the list.

**A hull hit squarely takes the direct number and NOTHING ELSE**, and that is
the one counter-intuitive figure in the table. `blastAt` needs line of sight
from the blast centre to the victim's centre, and a rocket that stopped on a
hull has that hull's own collider between the two. So the splash is what a NEAR
MISS is worth. Measured on a clean strike: 1200 → 580, which is `damage` exactly.

| | direct (`shell`) | splash | what that buys |
| --- | --- | --- | --- |
| rocket | 620 | 220 over 7 m, full inside 2.4 | two rockets — one player's whole launcher — kill a hull. A near miss is ~96 at five metres |
| mine | 800 | 250 over 6 m, full inside 2.6 | one cripples, two kill. Infantry beside the hull are caught by the splash like anything else |

**Friendly fire is excluded by construction on both halves.** The splash is
resolved against the thrower's own target list, exactly as a grenade's is; the
direct hit is excluded by `VehicleSystem.hostileNear`, which answers with the
OTHER side's hulls only. Neither is a team check at a call site.

**A WRECK is not a hull.** `hostileNear` tests `alive`, or a mine would go off
under a burnt-out chassis and spend a player's whole pouch on something already
dead.

## The rocket FLIES, and it is the second thing here that does

`CLAUDE.md`'s rule was that the grenade is the one deliberate exception to
hitscan. There are two now, and the second is a deliberate design decision
rather than a drift: **a hitscan anti-tank round is a hull deleted from wherever
the shooter is standing.** At 45 m/s a rocket takes a second and a half to cross
a Coldharbour avenue, and that second and a half is a driver seeing the motor
and deciding what to do about it. It is also why the launcher is a good answer
to a hull that has stopped and a poor one to a hull that has not: leading a tank
at 11 m/s across sixty metres is a real shot to have to make.

It is in `AntiTankSystem` rather than in `GrenadeSystem` because it shares
nothing with a grenade but the fact of flying — no fuse, no bounce, no rest, no
tumble, and a contact detonation instead of a clock. What it DOES share is
copied deliberately, because both are things that were got wrong first:

- **One ray per rocket per frame**, cast along the step and a radius past it so
  a fast body cannot tunnel between frames, through `RayWorld.castRound`.
- **`TerrainField` as a backstop under the colliders**, not as the floor test —
  a rocket that slipped past a seam has to go off on the ground rather than fly
  on under the map.

Three things are the rocket's own:

- **The detonation is backed off along the flight by a radius**, so the blast
  centre is on the face rather than a hair inside it. A centre inside a wall has
  that wall between it and everything it should have hurt, and `blastAt`'s
  line-of-sight ray would answer for all of them.
- **`armDistance` (3 m).** A rocket that has not flown far enough is a DUD: it
  stops and nothing happens. The blast excludes the shooter's own side by
  construction but not the doorframe they are standing in.
- **`life` (3.5 s) is a backstop, not a range limit.** 157 m is past the fog
  wall on every map that has armour, so a self-destruct is only ever a rocket
  fired at the sky.

**The pool REFUSES rather than stealing a live slot**, and a refusal gives the
rocket back (`Player.returnRound`). That is the grenade pool's contract arrived
at from the other direction: a throw is two calls a frame apart so the pool can
be asked before the count is debited, and a trigger is one call so the count
goes first. The COOLDOWN is deliberately not refunded — the weapon did cycle,
and the alternative is a trigger that can be held against a full pool at the
frame rate. With eight slots and at most five possible shooters it cannot
happen; what matters is that if it ever does it costs a cooldown and not a
rocket.

**From the MUZZLE and ALONG the aim**, which are two different things and
deliberately not reconciled. A rocket that appeared on the camera axis would
read as coming out of the middle of the screen — the failure `releaseGrenade`
documents from the other side — and one aimed from the muzzle at a converging
angle would put the reticle a hair off the flight at every range but one.
Launched from the muzzle along the aim it flies parallel to the line the reticle
draws, a hand's breadth under it, which is what a launcher held below the eye
actually does. `launchAhead` is a floor on that point, for `releaseGrenade`'s
reason: a shot taken with a wall at your shoulder must not spawn the warhead
inside it.

## The mine is not a projectile at all

It is a position, a clock and a distance test, and it costs one comparison per
live mine per frame against one callback answer. **Nothing about it is a
collider**: a hull drives THROUGH the mesh, and what sets it off is `hullNear`.

**Only a hull sets one off.** That is the name of the weapon and it is the only
rule a player has to be told, because it is what makes a mine safe to lay across
your own team's route. A body walking over one is not enough pressure and is not
asked about. The blast that follows is a blast, and it hurts whoever is standing
beside the tank exactly as a rocket's would.

**`armTime` (1.6 s) is what stops a mine being a grenade you throw at your
feet**, and the lamp is the visible half of it: dark while arming, lit once
live. So a mine you can SEE is a mine that would go off, which is the right way
round — the same argument the grenade's pip makes.

**A mine outlives the man who laid it**, which is what makes it area denial
rather than a slow grenade. The cap is what keeps that honest: a layer may only
have `carried` alive at once, and laying past that RETIRES their oldest rather
than refusing the new one. Without the cap a player who died twice would have
six on the field, and a pouch refilled by death would be an ammunition supply
rather than a fresh start. Refusing instead would be the game telling somebody
backing away from a tank to go and find their own mine first.

**It is never refused for want of somewhere to put it.** `layMine` tries the
spot ahead and falls back to the player's own feet, because a trigger pull that
spends a mine and produces nothing is the worst thing this could hand somebody
under fire. `dropMax` is what rules the spot ahead out — a mine laid over the
edge of a terrace has to land on the terrace.

## The load, and why a weapon with no reload has one

`carry.fireRate` is 0.5, and the comment on it has always said what that number
is: *"rounds per second, which on a two-shot weapon is the loader"*. Two seconds
between rockets is not a rate of fire — it is the time it takes to put the next
one in the tube. It was also, for a while, the only wait in the kit with nothing
on screen to be: the tube sat still, the warhead never left it, and the second
rocket appeared out of a weapon that had visibly never been touched.

**So the gesture runs on the FIRE COOLDOWN, and it is the only clock it needs.**
`Player.loadProgress` is that cooldown read as a fraction, `ViewModel` plays
`CONFIG.viewmodel.load` off it, and `Sfx.rpgLoad` lays its four events across the
same duration (`Player.loadTime`, so the picture and the sound cannot be given
different numbers). Nothing goes near `startReload`: the rule above stands
exactly as written — there is no reserve, no magazine and no reload on this slot
— and what this animates is a rocket that was already in the pouch going into a
tube it was always going to go into.

**That buys the whole feature with no state.** A reload needs a blend beside its
phase because it can be CANCELLED — a swap or a death leaves the gesture
stranded halfway and something has to ease the pose back off. A load cannot be:
the clock it reads starts at rest, ends at rest, is dropped to zero by
`completeSwap` and by every path that puts a fresh weapon in the hands, and is
gated on there being a round left to load at all. So there is no `loadBlend`, no
frozen phase, no cancel path, and a weapon with nothing to load reads 1 for the
whole round and costs one comparison a frame.

### It is a MUZZLE load, and every beat is that fact

A rifle's magazine is released, falls out of the well under gravity with no hand
on it, clears the frame, and a second one comes up from underneath. **None of
that is available here**, and the reason is not stylistic: what left this weapon
left it at 45 m/s and is a hundred metres away. There is nothing to drop,
nothing to catch, and no fall to animate. What there is instead is a REACH —
the hand goes out of frame after the next rocket and comes back with it — and
then the one motion the gesture exists to show, the round offered to the mouth
of the bore and pushed back down it.

| beat | fraction | what happens |
| --- | --- | --- |
| the shot | 0 | the round node is DISABLED. The tube is empty, and that is the picture for the next third of a second |
| the tip | `tiltIn` | the launcher comes down off the shoulder under `loadPos`/`loadRot`, and the support hand leaves the heat shield |
| the reach | `[0, offerFrom]` | the hand goes down out of frame. Nothing is drawn; the empty tube is the whole of it |
| the offer | `[offerFrom, alignAt]` | the round rises back into frame WITH the hand and turns onto the bore |
| the slide | `[alignAt, seat]` | it goes home down the bore, distance-to-go falling as `1 - x²` so it is at its fastest on the frame it arrives |
| the seat | `seat` | home. `seatKick` is the weapon taking it, and the index turn finishes unwinding |
| the cock | `cock` | the hammer thumbed back. `cockKick`, and the launcher's answer to a bolt going forward — an RPG is cocked by hand, so this is the beat that says the weapon will fire |

Five things are load-bearing:

- **The SUSTAINER is what makes the load read, and it is invisible the rest of
  the time.** The round's motor tube is 0.33 of weapon length behind the
  warhead, under the bore's own diameter, so when the round is seated the whole
  of it is inside a solid cylinder and the depth buffer eats it — the carried
  weapon is pixel for pixel what it was. Pulled out for a load it is a third of
  a metre of motor leaving the tube, which is the difference between a rocket
  being LOADED and a warhead wobbling about in front of a muzzle that never
  changed. `alignDist` is sized off it and not off the head: the tail is 0.35
  behind the muzzle when seated, so anything under that is a round that never
  actually came out.
- **`offerPos` is deep for the reason `reload.insertDist` is.** One node stands
  in for the round that left and the round that comes back, so the frame it
  reappears on is a jump from nothing to there, and it has to happen far enough
  under the bottom edge that neither the bob nor the tube's own tip can bring
  it into view.
- **The hand rides the round exactly**, from `offerFrom` to the seat, offset by
  `loadHand` — where a hand sits on a rocket rather than on a handguard. Before
  `offerFrom` the two are the same trip anyway, because the hand is going to
  fetch the thing rather than following it, which is what lets the reach and
  the offer meet with no seam to key.
- **`aimBreak` is 0.9, higher than the rifle's**, and the reason is this
  weapon's own geometry: the optic is a 2x prism standing off the LEFT of the
  tube, so the aimed pose already swings the bore across the middle of the
  screen — and the load happens at the MUZZLE, the far end of the thing that
  would be lying over the picture. It is not 1, on `reload.aimBreak`'s
  argument.
- **Measured at 1280x720** (posed by hand — see `VERIFYING.md`), which is what
  the two depth figures above are tuned against. The round's nose is at
  **(554, 851)** on the last frame it is hidden and **(594, 807)** on the first
  frame it is drawn, so it appears 87 px under the bottom edge rather than the
  35 px an earlier `offerPos` left — inside the bob, and the same failure
  `reload.insertDist` records at 40 px. It is fully in frame by `0.48`, on the
  bore at **(514, 512)** with its tail at the mouth, and seated its nose lands
  on **(585, 502)** against the launcher's own muzzle landmark at (579, 500).
  Nothing crosses the middle of the screen at any point.
- **The slide reads as DEPTH rather than as travel, and that is the geometry
  being honest.** A tube's mouth is its FAR end and the venturi is at the
  shoulder, so a rocket going in is a rocket coming toward the eye: over the
  whole slide the nose moves 10 px, while the round's on-screen length goes
  from 117 px to 235 px and the motor's tail sweeps down-right past the tube
  mouth and is swallowed by it. That growth is the animation. It is also why
  the sustainer had to exist — without it the only thing moving is a warhead in
  front of a muzzle that never changes, at almost no apparent speed.
- **It blocks the SPRINT, exactly as a reload does**, through `Player.loading`
  — one question ("is ammunition going in?") rather than two gates that could
  drift apart. A body cannot run with both hands on the front of a launcher,
  and a launcher that could be loaded at a sprint would be the one weapon in
  the kit whose reload is free. Firing needs no term added for it:
  `tryShot` is already refused by `fireCooldown`, which for this weapon IS the
  gesture's clock. A SPENT tube does not block it either — `loadProgress` is
  gated on there being a round left, so the two seconds after the last rocket
  are a swap and not a load.
- **`muzzleLoad` is what tells the two items apart, and it had to be said.**
  Both run a cooldown and they mean opposite things: the launcher's is a rocket
  going down a tube, the mine's is "as fast as a man can set one down and stand
  up". Read as one, the mine would pin a player for half a second with no
  gesture on screen to explain it, at the exact moment `layMine` already
  refuses to punish — somebody backing away from a hull. So the flag lives on
  the ITEM, beside `carried`, and the mine states `false` rather than omitting
  it: the consequence is movement, which is too far from this table to leave to
  a default. Its counterpart at the model's end is `WeaponParts.warhead` — one
  says the cooldown is a load, the other draws it.
- **A THROW takes the round with the hand.** The throwing hand is the support
  hand, so the arm is switched off for the gesture — and a round left drawn is
  a rocket hanging in mid-air with nothing holding it. The magazine next door
  gets away with staying put because it spends a throw below the frame; this is
  a warhead in the middle of one. Both come back on the same frame and still
  together, because the hand's position is the round's plus a constant.
- **A swap does not cheat it and does not need a rule to stop it.**
  `completeSwap` drops the fire cooldown with the weapon that earned it, so a
  launcher put away mid-load comes back loaded — which is the existing rule for
  every weapon in the game (a swap has already cost more time than the cooldown
  it drops), and the round trip costs two draws of a 1.4 m tube. `stow()` puts
  the round back in the tube on the way, so nothing is left hanging.

## A launcher bot per squad, and the one thing it is allowed to do

`CONFIG.antiTankBots` is the band, and `BattleSystem` writes `Bot.launcher` on
the squad's FIRST body when it cuts the squads — a fixed slot rather than a roll,
so a team fields exactly `perSquad` of them however the pool is seeded. It rides
the pool slot the way the skill seed does, so it survives a bench, a respawn and
a round.

**A bot's launcher is for ARMOUR and nothing else**, and that test is the first
line of `considerRocket` rather than a band or a chance, because it is the rule
and the rest is tuning. A rocket is a one-shot kill on a body with five metres of
splash around it; sixteen bots that could reach for one would turn every
firefight in the game into indirect fire. The launcher exists so that driving is
a decision rather than a free ride, and it is allowed to do that and nothing
else.

**It fires at where the hull IS, with no lead at all**, and that is the
counterplay rather than an approximation. A rocket takes over a second to cross
an avenue and a tank does 11 m/s, so a hull that keeps moving is caught by the
splash at worst and a hull that stops to line up its own shot is hit squarely.
That is exactly the trade a driver should be making, and a bot that solved for
the intercept would take it away.

Skill scales the CHANCE and not the accuracy — `considerGrenade`'s argument, at
the same 9-second cooldown scale. Scatter is pro rata with range, because the
splash means a near miss is still worth firing.

**The tube is WORN, not held.** `SoldierParts.launcher` is a fourth segment
across the rig's back, disabled on every rig until a bot is told it carries one.
An AT gunner carries a rifle and a tube, and the tube is over their shoulder
until there is armour to point it at — which is the honest shape as well as the
cheap one. What it buys is the thing a player in a hull actually needs: being
able to tell WHICH body in a squad is the one that can hurt them, from the side,
at range, in one silhouette. `Bot.launcher` is a property rather than a field so
that the write and the mesh are one statement.

**On the server this runs exactly as it does offline**, and it has to: the bots
in a match are simulated there and nowhere else, so a `HeadlessGame` that wired
nothing would field the only squads in the game with no answer to a tank.
`HeadlessGame.wire` installs the same `fireRocketFor` `Game` does, less the
sound — which is the authority's to ANNOUNCE (`hearGunshot`, and the `fire`
event `Match.onOrdnance` raises) rather than to play.

## The models, and the one pose knob they needed

Both builders return `WeaponParts` exactly as the six guns do, and both also
build the WORLD object their weapon puts into it — `RpgModel` the rocket,
`MineModel` the laid plate — for the reason `GrenadeModel` is one file: what the
thing looks like and what put it there are the same object seen twice.

Four things are load-bearing:

- **The launcher's optic is a HOLLOW TUBE, and every radius on it is solved
  rather than authored.** An optic is only ever looked THROUGH, so the one
  thing it owes is a clear bore around the cone from the eye — and this one was
  a stack of solid boxes, which measured 0 rays clear of 313 across the sight
  picture: the whole aimed view was the inside of a 5 cm block, and the only
  reason it did not read as a bug on sight is that a launcher is not a weapon
  you aim first. It is now the prism's own construction — a staircase of
  `shell()` sections each carrying the bore its FAR rim needs, so the housing
  circumscribes the cone — and it borrows `PRISM_CONE` exactly as it already
  borrows `CONFIG.sights.prism`: same eye relief, same magnification, so
  anything but the same cone would be a different picture through the same
  glass. What it does NOT borrow is where the eye reference sits. The prism
  puts it on its ocular rim; this one keeps it at the body's centre, and that
  is what holds a launcher's optic to something slimmer than its own launch
  tube, since the cone spreads with distance from the eye. Two consequences
  worth knowing before touching it: `WeaponBuild.shell` grew an `x` for this,
  the one housing in the kit not built around the bore; and **the mount under
  it is capped by the optic rather than sized by hand** — the arm and the clamp
  both stop below the HOUSING's underside at their own front face, where the
  staircase is lowest, because the post they replaced stood 2 mm inside the
  picture and put a bracket in the bottom of every aimed shot. Measured after:
  270 of 313 clear, the rest being the chevron, the housing's own rim, and the
  tube and heat shield low and right — which is the launcher in its own sight
  picture and is the point of mounting the optic off the side.
- **The launcher's origin is at the VENTURI, not at its middle.** Every gun in
  the kit is built around its receiver, because that is roughly where a rifle
  balances and the hip pose puts the origin a comfortable distance from the eye.
  A launcher is fired off the SHOULDER, so built the same way the bell ends up
  half a metre from the lens filling a third of the frame with the warhead off
  the right edge.
- **The carry is that origin put where the SHOULDER is, and it is `hipZ` that
  does it.** The origin being the venturi is only half the arrangement; the
  other half is that the venturi belongs BEHIND the lens. Carried at the shared
  stand-off the weapon pivots half a metre in front of the chest, and what that
  looks like is a plank held level in two hands with the bell broadside in the
  middle of the frame — the thing everybody who has seen it describes as being
  held out in front. -0.36 takes the bell's rear rim off the right edge (px
  1332 at 1280x720) 0.21 m from the eye and leaves the tube crossing the lower
  right: chamber (994, 680), optic (723, 523), warhead (659, 495), the support
  hand at (725, 634) and the trigger hand off the bottom, which is where a hand
  on a launcher's grip actually is. **The muzzle stays past
  `rocket.launchAhead`** (1.04 m against 0.7), so pulling the weapon in did not
  quietly move where a rocket is born from the muzzle to that clamp — a carry
  pulled much further in would.
- **`WeaponSetup.hipYaw`, and its sign.** With the bell behind the lens the yaw
  is no longer about getting the eye off the bore; it is about the tube being
  READABLE. Pointed straight down the line of sight a tube foreshortens into
  nothing — at a yaw of 0 the warhead and the optic land 40 px apart and the
  launcher reads as a length of pipe with a sight on it. Turning it across the
  view opens the length out: -0.18 on the shared `hipRot.y` is 15 degrees and
  spreads the chamber, shield, optic and warhead over 340 px. **The sign is the
  counter-intuitive one** — the weapon is held to the right of the eye
  (`hipPos.x` is 0.184), so turning the muzzle OUTBOARD swings the bore onto the
  line of sight and collapses it further; inboard opens it. Only the hip pose
  takes it. The AIMED pose is derived from the sight, and a yaw baked into that
  would swing the reticle off the axis the rockets fly down.
- **A parked rocket or mine is DISABLED, not invisible.** Babylon's `isVisible`
  hides the mesh it is set on and nothing under it, so a pool of eight hidden
  rockets leaves eight sets of fins and eight motors standing at the world
  origin. `setEnabled` takes the subtree. (`GrenadeModel` gets away with
  `isVisible` only because it toggles its pip by hand.)

The launcher takes `prism`'s entry in `CONFIG.sights` rather than declaring one
of its own — 2x is what a launcher's optic is for — and the mine's "sight" is a
point a hand's breadth above the fuze, which exists only because `applyFit`
derives an aimed pose from one. What aiming a mine does is hold it up in front
of your face, which is both the honest animation and what falls out of the
derivation.

## What the HUD says

One row, the same instrument as the frag pouch and one line under it: pips for
what is left in the hands. Two independent pouches, so spending one is not
spending the other.

The caption is composed by `Game` rather than derived in the HUD, because what
it has to say differs per item and only one side knows each half: the name is
the kit's and the laid count is `AntiTankSystem`'s. A mine row reads
`MINES · 2 SET`, and it matters, because the cap means laying a third LIFTS the
first.

A kit with no third slot pushes null and the row is not drawn at all.

## Not built, on purpose

- **~~Netplay.~~ Built**, alongside the hulls, because a tank with no counter
  is not a feature. The shapes it needed are the ones this entry predicted:
  `RocketState` on the snapshot with a heading on it, `MinesMessage` as a
  versioned table the authority owns, and one arm in `server/wire.ts` — plus
  `OrdnanceMessage`, which is ONE ask for both items because the third slot is
  one slot and which item is in it is a fact the authority already holds off
  the join. See `docs/multiplayer.md`.

  **The two halves are drawn differently and the difference is what they are.**
  A rocket is PREDICTED locally exactly as a thrown grenade is — a warhead that
  appeared six metres downrange a round trip later would read as a misfire —
  and the authority's copy comes back filtered out by `RocketState.by`. A mine
  is not predicted at all: it is laid at the feet and never moves, so the round
  trip is invisible and a local copy would be a second plate to reconcile
  against the table for the rest of the round. The local rocket decides
  nothing on either side of that — `Game.resolveOrdnance` returns immediately
  in a match, so there is no second blast a street from the first.
- **Resupply.** Two a life and no ammunition crate. It is the grenade pouch's
  economy and it is what makes each shot a decision.
- **A rocket that can be shot down.** The body is dressing: no `solid`, no
  `WorldBox`, not pickable. The only thing that stops one is the step ray.
- **Mines against infantry.** Vehicles only, which is the name of the weapon.
  This used to come with a caveat that the weapon had nothing to catch: with no
  AI drivers, the only hull that could ever set one off was one a player was
  sitting in. **Bots drive now** — see `docs/vehicles.md` — so a mine laid on a
  street the enemy's armour uses is a weapon with a customer, and laying one is
  a decision about where the other side's tank is going rather than a bet on
  where a person will drive one.
- **A reload.** The gesture above is a LOAD and the distinction is the whole of
  the slot's economy: nothing is conjured, the pouch is still two rockets a
  life, and an empty tube stays empty. What was added is the two seconds
  between the first rocket and the second having something in them.
- **A launcher on the bot's HANDS.** The tube is slung across the back and the
  rifle stays in the hands, so a rocket visibly leaves a body holding a rifle.
  At the range this happens at, the flame is the read and the slung tube is the
  identification; putting the launcher in the hands means a second held weapon
  per rig and an animation to swap between them.
- **A backblast.** A launcher fired with a wall behind you should hurt. It would
  be a second blast at a second position with a rule about what is behind the
  shooter, and the arm distance already covers the case that actually kills
  people.
