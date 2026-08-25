# Grenades

One of the two things in this game that are not hitscan (the anti-tank rocket is
the other — see [`antitank.md`](antitank.md)), and everything that follows from
that: the pool, the bounce, the blast, the dust, the throw gesture and the bots'
range band. Split out of [`CLAUDE.md`](../CLAUDE.md), which keeps the summary;
this file is the contract for `GrenadeSystem` and both throwers.

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
  casts a single downward ray, `OPAQUE_ONLY` (debris comes off things that stop
  rounds, so a fence's coarse run is not one), and reads the same
  `metadata.surface` a bullet's impact reads. The answer is a `BlastGround` —
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
