# Grenades

One of the two things in this game that are not hitscan (the anti-tank rocket is
the other — see [`antitank.md`](antitank.md)), and everything that follows from
that: the pool, the bounce, the blast, the dust, the throw gesture, the bots'
range band, and the molotov that shares all of it but the ending. Split out of
[`CLAUDE.md`](../CLAUDE.md), which keeps the summary; this file is the contract
for `GrenadeSystem` and both throwers.

Everyone carries two and there is no resupply, so the pouch is refilled by death
and nothing else (`Player.fullReset`, `Bot.spawn`). Two a life makes each throw a
decision rather than a second trigger.

**This is one of the two things in the game that are not hitscan** — the
anti-tank rocket is the other, and it lives in `AntiTankSystem` because it
shares nothing with a grenade but the fact of flying (no fuse, no bounce, no
rest, no tumble). What it DOES share is the first two rules below, copied
deliberately: they are the two things about flying through this world that were
got wrong first. Everything about `src/systems/GrenadeSystem.ts` follows from
being a thrown thing with a clock in it:

- **ONE ray per grenade per frame**, cast along the step and a radius past it so a
  fast grenade cannot tunnel between frames, filtered on `metadata.solid === true`.
  Affordable only because there are at most a handful in the air. A reported normal
  facing *away* from the grenade is flipped before the bounce: a collider's back face
  is what a grenade thrown from inside a doorway finds, and bouncing off one drives
  it straight through the wall it just hit.
- **A slow grenade on a flat surface is parked outright** (`resting`). A body that
  micro-bounces never settles, and one that never settles never stops paying for its
  collision ray.
- **`TerrainField` is a backstop under the colliders, not the floor test.** The
  terrain blocks are `solid` and the ray normally finds them; the clamp catches a
  grenade that slipped past a seam so it does not fall out of the world with a live
  fuse. It uses `heightAt`, so it can sit a fraction under the *drawn* surface — fine
  for a backstop, not for anything that has to line up.
- **The blast resolves against the THROWER's target list**, fetched at detonation
  rather than at the throw — a grenade is in the air for seconds and the roster it
  goes off among is not the one it left the hand among. Friendly fire is excluded by
  construction, exactly as in `CombatSystem.fire`, so a grenade cannot hurt its own
  side including the thrower; the alternative is bots routinely killing their squad.
- **Damage needs line of sight from the blast centre** — one ray per victim already
  inside the radius. Measured: 130 at the epicentre, flat inside 2.6 m, falling
  linearly to 0 at 8.5 m, blocked outright by a wall.
- **That ray is cast from the VICTIM toward the blast and stops `LOS_SKIP`
  (5 cm) short of it**, which reads backwards and is load-bearing. A grenade
  rests a radius proud of the floor, but the other caller is a tank shell, whose
  blast point is `ShotResult.hitPoint` — `origin + dir * distance` for the very
  query that found the face, so it lies exactly ON that face, on whichever side
  float noise puts it. `boxCast` counts `tMin >= 0` and `triCast` counts
  `t >= 0`, so a ray leaving that point hits the surface it is standing on at
  zero distance and every victim reads as being behind a wall. Measured on
  Coldharbour before the fix: **85% of ground impacts and 47% of wall impacts
  blocked their own splash**, and of forty-four shells put into the dirt a metre
  from a bot's boots, forty-four. The DIRECTION is the fix rather than the
  epsilon: a body's chest is in open air, and `boxCast` reports a hit for any
  ray whose origin is inside a box however far in, so the suspect point must be
  the END of the segment — cast outward instead, 5 cm along a ray leaving a
  step's top face at three degrees is still inside the step.
- **The pool REFUSES rather than stealing a live slot**, and both callers spend
  their grenade only after it has accepted — hence `Player`'s split of
  `canThrowGrenade` from `spendGrenade`, and `Bot` decrementing after
  `ctx.throwGrenade` returns true. A count debited for a throw that never arrived is
  the most confusing thing this could hand a player.

## The blast is EIGHT layers, and there is only one blast in this game

**`blastAt` takes a `power`, the grenade passes 1, and everything else is a
multiple of it.** That is the same bargain the weapon table makes with the
rifle's `report`: one thing is the reference, every number in it is 1, and a
second thing says only how it differs. A tank shell is
`CONFIG.vehicles.tank.gun.blastPower` (1.85) of exactly these eight layers and
declares nothing else about its own explosion — no second fireball, no second
dust cloud, no second set of numbers to keep in step. `CONFIG.grenade`'s "The
blast, as a picture" is the table; six of the layers are drawn from
`GrenadeSystem` and two from `BlastDebrisSystem`.

**The SOUND makes the same bargain, and one recording is every explosion in the
game.** `Sfx.explosion` plays `audio/grenade.webm` — a grenade going off, so
the reference at a `power` of 1 exactly as this table is — and spends `power`
on it as `rate`, which is playback rate and therefore pitch and length
together: a shell comes out a fifth lower and 36% longer, which is what the
four synthesized layers underneath already did by hand. It is a preference like
every sample here, so a blast before the decode lands is those four layers.
See [`docs/audio.md`](audio.md).

| layer | when | what it says | owner |
| --- | --- | --- | --- |
| `flash` | 0 – 0.14 s | something detonated HERE | `GrenadeSystem` |
| `fireball` | 0 – 0.6 s | and it was this big | `GrenadeSystem` |
| `shock` | 0 – 0.34 s | and it reached this far along the ground | `GrenadeSystem` |
| embers | 0 – 0.8 s | and it threw hot metal | `GrenadeSystem` |
| `debris` | 0 – 7 s | out of THIS ground | `BlastDebrisSystem` |
| `dust` | 0 – 2.4 s | which is still hanging in the air | `GrenadeSystem` |
| `smoke` | 0 – 4 s | and is now a column you can see from the flag | `GrenadeSystem` |
| `scorch` | 0 – 15 s | and this is where it happened | `BlastDebrisSystem` |

Four rules hold the picture together, and each of them is a thing that was got
wrong first:

- **The top of the list is SHORT.** The flash and the fireball are over inside
  two-thirds of a second between them. What makes a blast read as violent is
  how fast it arrives and how much is still going on after it has gone, not how
  long the fire lasts — lengthening the fireball is the first thing anybody
  reaches for and the one change that turns the whole thing into a special
  effect.
- **`power` scales SIZE and COUNT, never TIME.** A blast that lasted longer
  because it was bigger would leave the tank's fireball still burning while its
  own smoke column was already up, and the ORDER the layers arrive in is what
  the effect is made of.
- **What the blast went off ON is answered once.** `GrenadeSystem.probeGround`
  casts a single downward `RayWorld.castRound` (debris comes off things that
  stop rounds, so a fence's coarse run is not one), and reads the same
  `RayHit.surface` a bullet's impact reads. The answer is a `BlastGround` —
  the surface kind and its normal — and it is the SYSTEM's scratch: valid for
  the length of the call and no longer, exactly as `forEachLive`'s position is.
  A blast in open air finds nothing and is told it is over level earth, which is
  the right answer for both consumers.
- **`drawBlast` is public, because there are two ways a blast can happen and
  only one of them is a rule.** Offline `blastAt` resolves the damage and then
  draws. In a netplay round the damage is the authority's and arrives as an
  `explode` event with nothing but a position on it, so `Game` calls `drawBlast`
  directly — which is also what put a fireball on somebody ELSE's grenade, an
  event that used to arrive as a light and a bang with nothing burning in the
  middle of it.

### The fireball is a CLUSTER, and its colour is a ladder of shared materials

One expanding sphere is a balloon: perfectly round, growing at one rate, and the
eye reads the silhouette as the primitive it is. `fireball.lobes` spheres churn
instead — each with its own bearing off the golden angle, its own size, its own
reach and its own start delay inside `stagger`, so the outline changes shape
while it grows.

**A lobe's arrangement is decided at CONSTRUCTION and not at the detonation.**
Four slots is four arrangements, which is more variety than an eye gets out of
an event lasting half a second, and it means a burst is property writes and no
arithmetic. It is also what keeps the server honest: nothing in that
constructor calls `Math.random()`.

**Colour is four SHARED materials rather than one animated one**, and that is
`CelMaterialFactory.getEmissive`'s doing rather than a saving — it hands out one
material per colour to the whole game, so a lobe writing its own `emissiveColor`
would repaint every brazier flame, tracer and lit window that happened to share
the hex. `FIRE_LADDER` is white for the first eighth (a real fireball is only
white in the frames the eye cannot resolve), then the orange it is mostly seen
as, then the deep red of it going out, then the char that hands over to the
smoke. A lobe steps down the ladder and fades on `mesh.visibility`, which IS per
mesh.

**The shock ring is the only layer that says how far the blast REACHED**, and it
is a ground-plane cue on purpose: the fireball and the smoke are both read
against the sky, so neither tells a player standing thirty metres away whether
they were inside it. It is a torus built at diameter 2 so a uniform scale of `r`
IS a ring of radius `r`, with its tube quoted as a fraction of that — so the band
widens in proportion as the ring runs out, which is what a wave front does —
turned onto the surface normal, and easing out so most of the distance is
covered in the first third. `squash` is the one axis that does not scale with the
rest, and is what keeps it lying on the ground rather than standing up. `shock.radius` is deliberately under `blastRadius`:
it is where the ring has faded to nothing, not where the damage stops, and a
ring drawn at the true 8.5 m is a promise the falloff does not keep. **`peak` is
a cap and not a taste**: it is unlit emissive inside the glow layer, and at full
alpha it blooms into a solid band of light lying on the street.

### The dust and the smoke are the same class twice

**`BlastDust` is built twice with different numbers**, and what makes one of
them smoke is entirely in those numbers: fewer puffs, much bigger, much
longer-lived, a real `rise` instead of a nudge, and a `lit` near zero so it
reads as the dark side of the fire rather than as more of the ground. A second
implementation would be a second place the four Babylon constraints below have
to be remembered, and they are the whole of what is hard about this.

**They are drawn together and not instead of one another**: the dust is what a
body standing next to the blast sees and the smoke is what everybody else does.
As fill it is the cheaper of the two — fourteen puffs against thirty-four.

**This is the one place a GPU particle system may be spawned per event** — the
rule against it (muzzle smoke, brass) is about per-shot effects at eighty shots
a second; there are seconds between detonations. Four of these six are Babylon's
rather than the game's:

- **It is a POOL of GPU systems, one per concurrent cloud.** In
  emit-rate-controlled mode a `GPUParticleSystem` re-emits into a ring of
  `max(emitRate * maxLifeTime, this frame's emission)` slots from a circular write
  pointer. `emitRate` is zero here — that is what makes it a burst — so the ring is
  exactly one `manualEmitCount`, and a second blast inside the first cloud's life
  would overwrite its slots and pop a standing cloud off the screen. `Atmosphere`
  documents the other side of this invariant.
- **A stopped system refuses manual emissions too** (the update shader gates its
  emit branch on `stopFactor != 0`), so `stop()` is not a way to hold a burst system
  idle. Each is started once and left started; with `emitRate` zero an idle one emits
  nothing and costs nothing.
- **`updateSpeed` is `1/60`**, which is what makes the numbers mean what they say:
  the GPU clock advances by `updateSpeed * scene.getAnimationRatio()` and that ratio
  is `dt * 60`, so a lifetime is seconds and an emit power is m/s. (`Atmosphere`'s
  0.012 is deliberately not that.)
- **The fade cannot be curved.** `addColorGradient` on a GPU system in Babylon
  9.19.1 throws on the next render and takes the whole scene's rendering down with it
  — a black frame, not a fallback. Size and velocity gradients are fine. So alpha runs
  linearly from `color1`/`color2` to `colorDead`, and `opacity` is set for how
  the cloud reads at half life rather than at birth.
- **The cloud is lifted off the detonation** (`lift`). A puff is a billboard
  metres across, so one centred where the grenade went off has its lower half under
  the cobbles and reads as a smear painted on the street. Only the cloud moves —
  damage, light and embers still resolve at the blast.
- **Its colour is the map's, through `installMap`** (`grenades.setEnvironment`) —
  the same place `grenades.reset()` clears the standing clouds and the grenades. A
  fuse that outlived its map would go off over terrain that no longer exists.

**`power` reaches a cloud through the three properties the update shader reads
inside its EMISSION branch** — `scaleRange` (`minScaleX`/`maxScaleX`/…),
`emitPower`, and the emitter's own radius and height — and that branch runs only
for a particle being born. So a burst may change them freely: the puffs already
in the ring were sized when they were emitted and are not resized under a later
blast. A size GRADIENT could not do this, because gradients are baked at
`start()` and shared by everything in the ring.

**The player's throw is a GESTURE with a release inside it**, which is what stops
it reading as a second trigger. It was once an event — the button spent a grenade,
the body appeared on the camera axis that frame, the weapon dipped on a bell curve
— and all three are what a muzzle does, so players read it as the rifle firing the
grenade. It is now a timeline (`CONFIG.viewmodel.throw`) owned as a clock by
`Player`, counting up from the button:

- The **off hand comes into frame holding the frag** — the throwing arm is
  `ViewModel`'s, one rig shared by every weapon, parented to the camera (the weapon
  is tipping out of the way at the time) and disabled whenever no throw is in flight.
  Seeing what is about to be thrown is the whole job of the wind-up.
- The **support hand goes with it** — it is the same hand, so leaving it on the
  handguard puts two left arms on screen; hiding it is what motivates the weapon's
  give, held for as long as the hand is away rather than arcing back like an impulse.
- **The grenade leaves the HAND**, at `throw.windup`, from
  `ViewModel.throwHandWorld()`. `grenade.handAhead` survives only as a floor on that
  point (a throw with a wall at your shoulder must not spawn inside it);
  `handSide`/`handUp` are gone, because a point measured off the eye is exactly what
  read as a muzzle.
- `Player.beginThrow` books the ARM (the cooldown) and `spendGrenade` books the
  grenade at the release, so a pool refusal costs a cooldown and never a count.
  `throwReleaseDue` is the single consumed edge saying the hand got there, and is
  false if the player died mid-wind-up.
- The eye's follow-through goes through `CameraSystem.land` — the same spring as a
  landing and a blast concussion. One integrator, three callers.

Two things about the arm are learned rather than authored, recorded on
`viewmodel.throw` and `THROW_ELBOW`: **the elbow must leave the frame at every
pose** (a forearm's flat cut end in open screen is a floating log, not an arm), and
**the hand cannot be posed where a real one would be** — at 0.35 m the fist and frag
fill a quarter of the screen.

**The player throws where they are looking; a bot says where it wants the grenade
to land** — `throwAlong` / `throwAt`, ballistics behind both. `throwAt` is the low
arc of the standard solve and returns false when the throw cannot be made at
`throwSpeed`, which is what an AI needs to hear. Two consequences:

- **`throwSpeed` is bounded from below by the bots, not the player.** Flat range is
  `v^2 / g`, so 24 against a gravity of 18 reaches 32 m and `grenade.bot.maxRange`
  (30) has to fit inside that or every AI throw is refused. Measured: 8/12/20/28 m
  solve, 34 m refuses.
- **A solved throw lands slightly long**, because the fuse outlives the flight and
  the grenade rolls; `friction` is tuned against that rather than against the bounce.
  Measured flat: 0.7–1.8 m past the aim point across the whole 11–30 m band, well
  inside the bots' own scatter (at the 0.5 it started on, 4–6 m).

**The range band IS the bots' self-preservation.** A bot has no idea how far its own
blast reaches — no self-damage to teach it, no rig pose that could sell taking cover
from its own frag — so it is never allowed to throw at anything nearer than
`minRange`. Skill scales the *chance*, not the accuracy: an ace throwing wildly is
indistinguishable from a rookie, while an ace throwing more often is a squad that
starts using grenades once it has been held up.

Three things elsewhere are part of this: **the blast light is deliberately outside
`spendMuzzleLightBudget`** (transients always win a slot, and there are seconds
between blasts); **the camera's concussion reuses `CameraSystem.land()`**, since a
shake of its own would be a second integrator writing the same offset; and **a
blast kills through `Game.registerBotKill`**, the one place a bot's death reaches
the scoreboard, tickets and killfeed from all three causes (the hitmarker and rumble
stay with the weapon, being about the shot that landed rather than the body).

**What a grenade LOOKS like is `entities/GrenadeModel.ts` and not this system**,
for the reason the bot rig is `SoldierModel`: two things build one now. This
system builds the pool it simulates, and `net/NetGrenades` builds the ones a
client only draws, from positions the multiplayer authority sent. Both the
meshes and the pip's blink live there — the blink because it is the only warning
a grenade gives and it must read the same whoever threw it, so both sides run
`pipLit` over the same remaining fraction rather than each describing the
pattern. Three things about the meshes are load-bearing and stay in that file:
the pip must stand proud of the body's outline shell or the ink swallows it, the
body is inked at all because a dark green sphere at night is invisible against
the ground it is rolling across, and neither mesh is a collider — no `solid`, no
`WorldBox`, not pickable. A grenade is dressing with a timer.

**A grenade in the air is replicated as STATE in a networked round**, on the
snapshot with the bodies and interpolated on their clock, and `Grenade.id` is
what names one flight across frames: monotonic, never reused, because a client
keying on a pool index would take the next grenade's samples as a continuation
of the last one's. `forEachLive` is the whole of what leaves this system for
that, and `docs/multiplayer.md` is where the argument lives — including why the
thrower goes on drawing their own local copy and skips the wire's.

**A grenade carries its THROWER, not a flag about them.** The slot holds a
`Combatant` (`by`), which is what a kill is credited to at either end of the
wire, and it replaced a `byPlayer` boolean that was this system answering a
question about `Game`'s own `Player` — a thing it has never had any way to ask.
The consumer compares `by` against whatever it considers "us" and gets the same
answer for the hitmarker. **Its team is never read here**: the target list is
still fetched against the slot's own `team` at detonation, so this file keeps
knowing nothing about sides, and friendly fire stays excluded by construction
rather than by a check. `reset` drops the reference, because a pooled slot is
the one thing in here that would otherwise outlive the round its thrower fought
in.

## The molotov: the same flight and a different ending

**The throwable slot holds a frag OR a molotov, never both** — the anti-tank
slot's bargain made about the off hand, because a player who could carry both
would never have to decide which one a doorway wants. `entities/throwables.ts`
is the union, the kit order, the default and the pouch size, and nothing else
may decide how many a life carries: the player, the bots and the authority all
ask `throwableCarried`. It is a kit row on EVERY map (`LoadoutScreen`'s
`throwable` slot), remembered in `prefs` like the rest, pushed to `Player` by
`Game.applyLoadout`, and sent to the authority on the join and on every deploy
exactly as the weapon is (`Join.throwable`, `DeployMessage.throwable`) —
`Match` resolves it against its own table and throws what IT recorded, never
anything a `grenade` message says.

**Where the frag is a moment, the molotov is a PLACE**, and that is the whole
trade: it does almost nothing at the instant it lands and everything over the
eight seconds after. `CONFIG.molotov` is its table.

### It is the frag's flight, on purpose

**A bottle is a slot in the same pool, thrown on the same arc and stepped by
the same ray.** Every slot carries both bodies and `Grenade.kind` says which one
is out, so the pool keeps ONE refusal rule. `CONFIG.molotov` states no
`throwSpeed`, `throwLift` or `gravity` of its own: the bots' ballistic solve
and its measured 8–30 m band were fitted against the frag's three, a bottle on
its own arc would need that band re-measured, and a player would have two arcs
to learn for one gesture.

**It BREAKS on the first thing it touches** — a collider face the ray finds or
the terrain backstop — with no bounce, no rest and no pip. A bottle that could
roll through a doorway is a frag. `maxFlight` is a backstop for a bottle thrown
at nothing, not a fuse, and it rides the slot's `fuse` field so the wire needs
no second one.

### The fire is on the FLOOR under the break

A bottle thrown into a wall breaks at head height and the petrol runs down it,
so `shatter` steps the break point off the face and `floorUnder` looks straight
down (`dropReach`) — the colliders first, then the terrain as the backstop
under them, the same pair the flight lands on — and never returns a floor
ABOVE the break, because a ray starting inside a box reports its far face and a
fire lifted onto a ceiling is a fire in the air.

Each flame then finds its OWN floor, once, at the ignition, so a fire across a
kerb or a slope is not half buried and half floating. **A flame the fire's
middle cannot see is not lit at all**: petrol runs across a floor and not
through a wall, so a bottle broken against the outside of a house burns the
street and leaves the parlour alone — which is exactly where the burn's own
line of sight stops too, so the picture and the rule end at the same wall.

### The fire pool

`Fire` is the second pool in `GrenadeSystem`, and **it is a place with a clock
where a blast is an event with a picture**, so everything a blast resolves once
a fire resolves every `tick` for as long as it burns:

- **The THROWER's target list, fetched on every tick** — the blast's rule made
  eight seconds long, because the roster a fire burns among is not the one it
  started among. Friendly fire is excluded by construction, the thrower
  included.
- **A disc and a BAND**: a victim's centre inside `fire.radius` horizontally and
  between `below` and `above` the fire's floor, so a body on the landing over a
  burning stairwell is not in it.
- **One line-of-sight ray per victim inside that**, from `losLift` above the
  floor (a ray along the ground grazes every kerb it crosses) and through the
  same `visible` the blast uses, `LOS_SKIP` and all.
- **A hull is skipped outright** (`armoured`). A tank parked in petrol is the
  one target this cannot touch; the anti-tank slot is where that question is
  answered.
- **It stops hurting as it starts to die down** — no burn inside the last
  `fade` — because a fire still burning people while visibly guttering is the
  picture lying about the rule.

**The pool puts out the OLDEST rather than refusing**, the dust's rule and not
the grenade pool's: the bottle is already spent and broken by the time a slot
is wanted, so there is no count to protect, and a bottle that broke and burned
nothing is the worse lie. The fire it takes goes out through `putOut`, which
raises `onBurntOut`, so its light and sound cannot outlive it. `reset` puts
every fire out through the same door.

**`Fire.id` is monotonic and never reused**, for `Grenade.id`'s reason: `Game`
keys each fire's LIGHT (`fireLights`) and its held-open SOUND on it from
`onIgnited` to `onBurntOut`, and a key on the slot would let the old fire's
burn-out take the new fire's light away.

### What it looks like, sounds like and lights

- **The flames are the world's one fire material** (`FlameMaterial` over
  `world/flame.ts`), `CONFIG.molotov.flames` of them per fire, cloned off one
  geometry and spread over the disc on the golden angle at construction — no
  random in a constructor the server also runs. They grow out of the ground
  wider-first and sink back into it (`fireStrength`, one curve that the flames,
  the light and the sound all ride), because the material is hard-banded and
  has no alpha to fade. **Ten, not seven**: photographed from twenty metres,
  seven drew a cluster in the middle and not the rim — and the rim is what
  tells a player where they may walk. **They are built only where something
  draws** (`dust !== false`): the authority has no device to compile the WGSL
  on, and the fire's SLOTS, which are rules, exist on both sides.
- **The ignition is the one blast's own flash and lobes** at
  `molotov.ignition` of a frag, with its embers and the smoke column — and no
  ring and no ground dust, because petrol going up is a whoosh and not a
  pressure wave. `Blast.shock` is what leaves the ring off; `spawnBlast` is now
  `startFireball` + the two clouds + `throwEmbers`, so the ignition reuses the
  parts rather than restating them.
- **The light is a FIXTURE added and removed** — `LightingSystem.add`/`remove`,
  whose own notes were written for "a thrown fire" — `fast` because it burns up
  and dies down faster than the irradiance volume's sweep, added at zero and
  eased to `light.intensity` on `fireStrength` by `Game.pushFires`. Checked in a
  live round against the same frame with the light held at zero: it is what
  puts the orange on the bodies standing round it and the wall beside it.
- **The mark is `BlastDebrisSystem.scorchAt`** — the scorch without the rubble,
  because petrol does not dig — at `molotov.scorch` of a frag's.
- **The sound is two things.** The break is `Sfx.molotov` on its own mixer
  channel (`molotov`, in the explosion family): a glass crack, then a whoosh
  that SWELLS — the second caller of `burst`'s `rise`, which is for things that
  arrive. The burning is the drum's ambience graph with three terms restated
  (`molotov.sound`), pushed every frame it burns under a **NEGATIVE key**
  (`Game.fireSoundKey`), because `AmbienceSystem` spends 0 and up on the map's
  own emitters and an emitter's index is its identity for the life of the map.
  It is outside the ambience RANKING on purpose: there are at most
  `molotov.fires` of them and each lasts eight seconds.
- **In the fist it is a third of the thrown bottle's size** (`THROW_BOTTLE` in
  `ViewModel`), for `THROW_BALL`'s reason and harder: at 0.9 the cocked bottle
  ran from the fist to the top of the frame.

### A burn is `"fire"`, and it drops a body

`DamageKind` gained `"fire"`, and it is the second kind that DROPS a body rather
than throwing it — `RagdollSystem`'s test is "not a bullet or a burn", because a
corpse flung out of a patch of burning road reads as an explosion nobody saw.
The authority files it as its own `DeathCause`. A burn owes the thrower a
different callback from a blast (`onBurnHit`, not `onBlastHit`): it arrives four
times a second for as long as somebody stands in it, so `Game` flashes the
hitmarker on the KILL and not on every tick.

### The bots: who carries one, and the one reflex no state decides

**The LAST `molotov.bot.perSquad` bodies of each squad carry bottles** — the
launcher's fixed-slot rule from the other end of the squad, set by
`BattleSystem.buildPool`, so the two never land on one body and a team fields
the same kit every round on both sides of the wire. They throw on the frag's
decision (`CONFIG.grenade.bot`) and only the scatter is their own: a fire has no
falloff to be generous with, only an edge.

**Every bot runs out of a fire**, whatever it carries. A burn in `Bot.takeDamage`
is NOT filed as a threat — the middle of a fire is not a shooter, and filing it
turned bots to face the flames and hold their ground in them — and sets
`burnT` instead, which `update` spends as a run straight away from the fire's
middle, overriding whatever the state wanted and steered directly on
`tryMove`'s sliding the way `takeCover`'s short hops are. It sits BEFORE the
stance is eased, so the stand-up lands the same frame (a bot pinned in a crouch
unfolds at the ordinary blend speed, which is most of what a burn still costs
it), it cancels a corner stop, and a burn sets no flinch — a stumble at 60%
speed through the one thing a bot must run out of is the wrong reflex.
Measured on the authority (`npm run simulate`, Hollowmere): before the reflex,
36 bottles in a fourteen-minute round killed 26; with it, 29–39 bottles a round
kill 7–9 — about a quarter of a kill a bottle against a frag's half. That is the
intended item — it takes ground away and softens whoever crosses it — and the
figure to re-measure if the burn numbers move.

### On the wire

A bottle in the air is a `GrenadeState` with `k: "molotov"` (absent is a frag,
which is what every grenade on the wire was before), drawn by the same
`NetGrenades` ghost with a bottle in place of the frag. **The fire is the
AUTHORITY's**: `HeadlessGame` raises `onBlaze` from `onIgnited`, `Match` queues
a `blaze` event with a position and nothing else, and every client — the
thrower included — draws it through `drawFire`, a fire with no rules. The
thrower's own local bottle still flies (it is what they watched leave their
hand) and lights nothing, because `Game.installMap` sets
`GrenadeSystem.predicted` in a match. The burn reaches a person as `damage`
like any other hit. A client that joins while a fire is burning does not see
it; eight seconds is not worth a table.
