# Grenades

The one thing in this game that is not hitscan, and everything that follows from
that: the pool, the bounce, the blast, the dust, the throw gesture and the bots'
range band. Split out of [`CLAUDE.md`](../CLAUDE.md), which keeps the summary;
this file is the contract for `GrenadeSystem` and both throwers.

Everyone carries two and there is no resupply, so the pouch is refilled by death
and nothing else (`Player.fullReset`, `Bot.spawn`). Two a life makes each throw a
decision rather than a second trigger.

**This is the only thing in the game that is not hitscan**, and everything about
`src/systems/GrenadeSystem.ts` follows from that:

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

**The blast is a fireball, embers and DUST, and the dust outlives the rest.**
`BlastDust` is a few dozen soft quads expanding, slowing and fading over
`dust.life`, not emissive, `BLENDMODE_STANDARD`, tinted from the map's `mistColor`
toward its key light. **This is the one place a GPU particle system may be spawned
per event** — the rule against it (muzzle smoke, brass) is about per-shot effects at
eighty shots a second; there are seconds between detonations. Four of these six are
Babylon's rather than the game's:

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
  linearly from `color1`/`color2` to `colorDead`, and `dust.opacity` is set for how
  the cloud reads at half life rather than at birth.
- **The cloud is lifted off the detonation** (`dust.lift`). A puff is a billboard
  metres across, so one centred where the grenade went off has its lower half under
  the cobbles and reads as a smear painted on the street. Only the cloud moves —
  damage, light and embers still resolve at the blast.
- **Its colour is the map's, through `installMap`** (`grenades.setEnvironment`) —
  the same place `grenades.reset()` clears the standing clouds and the grenades. A
  fuse that outlived its map would go off over terrain that no longer exists.

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
