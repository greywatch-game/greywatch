# Bots: navigation, scaling, perception and squads

The nav graph and its silent caps, the three things carrying the frame budget,
what a bot notices without a ray, what a squad tells itself, and how squads
choose. Split out of [`CLAUDE.md`](../CLAUDE.md), which keeps the summary; this
file is the contract for `NavGrid`, `ObstacleField`, `CoverMap`, `SquadRadio`,
`Bot` and `BattleSystem`.

## Navigation

`NavGrid` is built from the finished collider set at map load. The graph node is a
**surface** — a (cell, height) pair — not a cell, because one cell can hold the creek
floor and the bridge deck above it, or the barn floor and its hayloft.
The cap is `CONFIG.nav.maxSurfaces` (3) unless the map raises it
(`MapLayout.surfaces`) — Coldharbour, whose buildings have three walked floors
in them, states 4.

**The cap fails SILENTLY, and anything stacked has to be built
around it whatever the number is.** `addSurface` returns when the list is full,
so the next candidate in
a cell is discarded with nothing thrown and nothing to see. Terrain always takes one
slot, which leaves two at the default.

**The discard is in ARRIVAL order, not by height, and that is the lever.**
`addSurface` inserts sorted but refuses once the count is reached, so which
surfaces a crowded cell keeps is decided by the order the BUILDER pushed its
colliders — which makes emission order part of a builder's design rather than an
implementation detail. The rule is: **walked surfaces first, cover and parapets
next, roofs last.** `kit/manor.ts` states it for one building ("Roofs are emitted
LAST"); `kit/city.ts` generalises it, because a three-storey office stacks a
ground floor, two slabs, two window spandrels, three wall heads and a roof into
one perimeter column — nine candidates for four slots. Measured on Coldharbour
with a route probe from both home spawns: with that order, even the default 3
keeps every walked storey reachable, and it is the spandrels and the roof that
fall off the end. Get the order wrong instead and a floor leaves the graph with
the slab still drawn, the stair still climbable and nothing in the console. A stepped structure built the obvious way — nested solid
colliders, one per tier — spends a slot per tier in the cells at its centre and
therefore loses its TOP tier, the one thing anyone climbs it for. The fix is that
**each tier's collider is only the RING of tread it actually exposes**, so a cell
centre falls inside exactly one: `topFaceHeight` returns null outside a box's own
XZ footprint and `rasterize` skips on null. The visuals stay nested solid boxes,
which is also what satisfies the thick-box rule. `buildTempleRuin` in
`kit/structures.ts` is the worked example and carries the per-cell budget as a
table; `buildStiltHut` is the other end of it, sitting at exactly three (terrain,
platform, roof block) and forbidding a second floor slab in its header.

Every cell's *base* surface comes from `TerrainField.heightAt` at the cell centre.
Heights above the base come from evaluating each collider's top-face *plane* at the
cell centre, not from its bounding box: a pitched ramp's AABB reports its peak
across the whole footprint and would read as a wall. If you touch `topFaceHeight`,
note the half-thickness is `h/2/cos(rotX)` and the slope is `tan(rotX)` — writing it
as `h/2*cos` and `-tan` is the easy sign error, and it silently makes every ramp
unwalkable.

**A surface id is a COMPACTED index, and every array is allocated over the
surfaces that actually EXIST.** `cellBase[cell]` is a cell's first id and its
surfaces run to `cellBase[cell] + counts[cell] - 1`; `surfaceCell` is the way
back, and both are on `debugSnapshot`. It used to be `cell * maxSurfaces +
slot`, which reserved every slot in every cell whether anything stood there or
not — measured occupancy is **1.58 surfaces per cell on Coldharbour, 1.02 on
Harrowmead and 1.47 on the proving ground** — so the graph, the seven flow
fields and the cover bake were all paying 2.3x to 2.6x over for padding that
every read already walked `counts` to skip. Nothing outside `NavGrid`,
`CoverMap` and the editor has ever held a surface id, and all three must index
through `cellBase`: `CoverMap` borrows the graph's own array rather than
re-deriving the arithmetic, because a second copy of it can drift and address
the wrong spots with nothing to see.

The rasteriser still fills a `cells * maxSurfaces` **scratch** — a sorted insert
cannot know its own length before it has run — and that scratch is `.fill(-1)`
to pad the slots no surface takes. It is thrown away in the constructor, and the
-1 is **not** a "below ground" sentinel: every read walks `counts[cell]`, which
is what lets sunken terrain hold ordinary negative heights. Any new consumer must
bound on `counts` rather than testing `y < 0` — and the one place that was
testing it, the editor's island finder, was reading the padding rather than the
ground and is now bounded properly.

Reachability is a flood fill from the map's outer ring. That is what keeps bots off
rooftops: a roof is a perfectly good standable surface, but nothing beside it is
within a step. It also assumes that ring is open ground, which is why a terrain
patch putting a *wall* edge out at the ridge is flagged.

**A link is cut when the segment between two cell centres crosses a solid box**
(`severLinks`). Sampling one column per cell centre means a wall thinner than a cell
— every fence, dry-stone field wall, ruin wall and gravestone — can sit *between*
centres, leaving the cells either side both standable and linked; the flow field then
points straight through the wall and the bot walks into it for the rest of the round
(`ObstacleField` keeps the body out of the stone but cannot change where the field
says to go). Testing the segment rather than blocking whole cells is what keeps the
1.6 m cottage doorways passable. A box only counts as a barrier where it stands more
than `stepHeight` above both ends of the link, so decks, kerbs and the terrace's top
face don't cut the links leading onto them.

**That barrier test is evaluated from the top-face PLANE at the crossing, which is
what lets a PITCHED box through the same gate as an upright one** — and it must,
because "pitched" does not mean "ramp". A ramp spares itself: its slab at the
crossing is within a step of the surfaces at either end of a link running up it,
exactly as the terrace's top face is, and its underside spares the ground beneath
it by `HEADROOM`. A stair's *parapet* is pitched too, only because it rails a
pitched flight, and it stands a metre over the treads — so it severs, as it should.
`severLinks` used to skip every `rotX !== 0` box outright on the reasoning that
ramps are surfaces rather than barriers, and the manor's grand stair is what that
cost: the parapet severed nothing, so the graph offered diagonal links straight
*through* the handrail, every flow field preferred that shortcut to the flight's own
foot, and `ObstacleField` — which reads the same box correctly — pushed each bot
back out. Measured on Greyfen, a bot climbing from the great hall took **9.7 s with
four watchdog detours and ~3 s of grinding against the rail, against 4.6 s and none
once the link is cut**; the stuck watchdog is the only reason it was slow rather
than stranded. Severing them changes no connectivity anywhere — walkable surface
count and all seven flow fields' reach are identical on both maps — because a rail
only ever cut the shortcut, never the route. `segmentHitsBox` answers for pitched
boxes for the same reason: a footprint test says where a box *is*, and whether it is
a barrier belongs to the caller. `CoverMap` still skips them, for a reason of its
own that its comment carries.

**A surface keeps ONE link per direction — the nearest STANDABLE neighbour — and
that is why `clearBlocked` runs before `link`.** A surface with no headroom can
never be stood on, so letting one win the single slot spends the link on a dead end.
It is not a rounding error: it made every ramp on the map a coin toss. The ground
*under* a ramp is blocked while the slab is within `HEADROOM` of it, while the
ramp's own top face is a separate surface only once it stands more than `HEIGHT_EPS`
(0.35 m) above that ground — below which `addSurface` merges the two and the climb
is free. Between 0.35 m and the `stepHeight` at which the buried ground drops out of
range there is a band where both are candidates and the blocked one is nearer, and
whether a ramp's cell centres land in that band is decided by the placement's world
position. The barn's loft ramp landed in it and the hayloft was unreachable by every
bot on the map.

**A ramp must also run on PAST the ground rather than stopping level with its own
structure's floor.** Nothing guarantees a placement's `y` is zero or the floor under
it level, and a foot even a couple of centimetres over `stepHeight` above the
terrain severs everything above it — Hollowmere's second barn carries `y: 0.33` and
did exactly that. A `stepHeight` of overrun buries the last stretch instead, where
the terrain simply wins the surface and it costs nothing. `buildBarn`'s `rampDrop`
is the worked example.

One flow field per objective (5 flags + 2 home spawns) is precomputed at load; the
map is static so nothing is ever recomputed. Bots read `nav.steer()` and never run
their own pathfinding. **A field is a `Uint16Array` of BFS STEP COUNTS over the
graph's surface ids, never a distance and never a float** — `FLOW_UNREACHED` is
the top of the type and stands for ground the goal cannot reach, so it loses
every `<` a steer makes exactly as `Infinity` used to. Seven of them over a
1500 m map is the reason the width is a rule rather than a detail
(`ENGINE_UPGRADE.md` S4); anything that wants a real cost or a real distance per
surface belongs in an array beside this one. **Bots do not use `moveWithCollisions`** — a cell being
walkable *is* the collision test, and it already accounts for headroom and step
height; 16 agents walking the collidable mesh list every frame is not affordable.

**The grid is too coarse to be the whole collision test, though.** One column per
cell *centre* means a collider narrower than 1.5 m — every scattered tree (1.1 m),
gravestone, fire drum — can sit between centres and leave every cell around it
walkable. `ObstacleField` is the sub-cell half: collider boxes bucketed at load,
queried per step to push a body clear of anything it overlaps. `Bot.stepTo` consults
it, then asks the grid; `Bot.tryMove` retries each axis alone so a blocked step
slides instead of freezing. Two rules keep the push-out from causing the problem it
fixes: it is a *preference*, never a veto (if the pushed-clear spot is somewhere the
graph rejects, the bot takes the overlapping one — frozen is worse than clipping),
and two fruitless sidesteps in a row set `squeezeT`, which drops the push-out for a
second so a bot wedged in a gap narrower than its own body gets out.

This is why bots stuck in props were also unshootable: `CombatSystem.fire` caps a
shot at the first `solid` hit and only counts a target sphere closer than that, so
the prop ate every round aimed at the body inside it. The two symptoms are one bug.

## Bot scaling

Three things carry the frame budget; undoing any costs ~10× draw calls or a
permanent hitch:

- **The rig pool is built once and never disposed.** Death hides a rig, respawn
  re-poses it. `new Bot()` allocates a dozen meshes and their GL buffers, and Conquest
  respawns continuously.
- **Bot rigs are nineteen merged meshes** (`SoldierModel`) — forty-odd boxes
  merged one mesh per colour per segment. The outline pass draws everything
  twice, so fidelity is ~2× draw calls per bot per mesh, and **what a rig costs
  is COLOURS PER SEGMENT rather than boxes**: a pouch, a kneepad or an antenna
  in a colour that segment already carries is free, while a fifth colour on the
  torso is 32 draw calls across a full roster. The one mesh this rig spends on
  looks alone is the helmet band, because the head is what clears cover first.
- **AI is staggered at `CONFIG.bots.thinkRate`**, round-robin across frames.
  `acquire()` gathers candidates by distance and ray-tests them in ascending order,
  returning the first visible one — testing all of them fires up to 30 picks per think.
  Two things keep that honest: the view cone rejects most candidates *before* any ray,
  and `CONFIG.bots.acquireRayBudget` caps how many survivors get tested. A dead bot
  must also not consume a think slot, or the living half of a roster thinks at half
  the advertised rate.

Bots hold a target until it dies, breaks LOS, or leaves range. Without that
hysteresis, "nearest visible enemy" flips every tick in a crowd, which resets `aimT`
so bots essentially never finish their reaction wind-up and fire — this looked
exactly like "bots don't shoot". It is also why losing a target does not simply null
it: `BotMemory.lastAimed` outlives `target`, and re-acquiring the same enemy resumes
at `profile.reacquireDelay` instead of from zero.

## Bot perception, cover and skill

**Everything a bot notices without seeing it is ray-free by construction** — the LOS
budget is the one thing here that does not scale.

- **Field of view.** `acquire()` gates on a cone around `Bot.facing` before it
  ray-tests (bots used to see 360° instantly out to 55 m). Two exemptions:
  `peripheralRange`, and a widened cone while a threat cue is live. It gates
  *acquisition* only — a bot faces its target once it has one, so you can flank an
  unaware bot, never a fighting one.
- **Damage direction is free** — `CombatSystem.fire` has always passed the shooter's
  origin into `takeDamage`.
- **Hearing** is a squared-distance sweep inside `BattleSystem.botFire`, with a
  jittered position so bots converge on the *sound*, not the shooter. `Game` calls
  `hearGunshot` for the player's own fire.
- **Near misses** ride the target loop `CombatSystem.fire` already runs: one extra
  sphere test at `hitRadius + suppressRadius`, reported via `onNearMiss`. It carries
  the round's point of closest approach as well, which is the same event the
  player's suppression and their directional crack are built on — the player is
  suppressed by exactly the thing that suppresses everyone else.
- **Lost line of sight costs no ray either** — `fire()` already pays for a wall pick,
  and a run of `losBrokenShots` blocked rounds drops the target.

**A bot's round falls off with range, and bots have no head zone.** Both are
deliberate and they pull in opposite directions, so read them together.

Bots carry no weapon from `CONFIG.weapons` — they fire one flat round — so
`bots.damageFar`/`falloffNear`/`falloffFar` are the whole of their damage curve.
It is fitted to the band they actually shoot in rather than to `range`: they
will not open fire past `engageRange` (55) and back off inside `minEngageRange`
(6), so a ramp ending at 70 would spend most of itself where nothing is ever
fired. 25 falling to 17 over 18 → 50 m makes them a four-shot kill inside 18 m,
five to 38, and six beyond. **This is a real difficulty reduction and the main
thing to feel-test**; it is also the point, since sixteen bots hitting for 25 at
any distance mean a crossed square is a coin toss no movement can improve.
`bots.damageFar: 25` restores the old behaviour exactly.

The head zone runs the other way, and its absence here is load-bearing rather
than an omission — see [`weapons.md`](weapons.md). Bots aim at `t.eyePos`, the
very point the zone is centred on, so a head sphere their rounds could reach
would make every accurate bot shot a headshot. Because the gate is
`ShotOptions.headMult` and they pass none, the sphere is never even ray-tested
on their path: sixteen shooters pay nothing for a feature they do not have.

**Cover is baked, never probed** (`world/CoverMap.ts`): one bit per direction per
surface, 16 directions, three masks — the same reasoning that makes `NavGrid` bake
seven flow fields. A cover query costs a bit test, and because the masks NEST it
answers with a `CoverKind` (`hard` / `crouch` / `none`) rather than a boolean.

- **Hard cover is 1.7 m — the hit sphere's top, not the 1.55 m eye height.** LOS is
  tested from the eyes but hits are tested against the sphere (`center.y + hitRadius`
  = 1.65). Bake at eye height and a bot behind a 1.6 m wall is *visible but
  unhittable*, which reads as broken netcode.
- **Crouch cover is 1.3 m, and it is 1.15 plus a measured margin.** 1.15 is the
  same derivation one stance down — `player.crouchCenterHeight` (0.4) plus
  `hitRadius` — and on its own it is a lie. A shooter's eye stands at 1.55,
  *above* a waist-high wall, so the round comes DOWN over it and can still find
  a ducked body behind it; hard cover escapes this because the wall stands over
  the shooter's eye as well, and no line between two points below it clears it.
  Ray-tested against real geometry with the game's own round question,
  a 1.15 m bake left the crouched sphere exposed on **20% of Hollowmere's
  crouch-only bearings and 48% of Coldharbour's**; at 1.3 m with the short probe
  below, **182 of 182 sampled bearings on Hollowmere block the crouched sphere
  and 135 of them leave the standing one exposed** — which is the whole claim
  the stance makes, measured.
- **Crouch cover is CLOSE cover** (`cover.crouchProbe`, 2 m, against
  `probeDistance`'s 4.5 for the other two). The margin above is proportional to
  how far the wall stands from the body — a low wall you are pressed against
  covers you and the same wall four metres back is one the round clears on the
  way in. Stretching the probe to 4.5 would need 1.45 m of wall to stay honest
  at `minEngageRange`, which is most of the way to hard cover and would leave
  the mask nearly empty. It also matches what a bot does with the spot: it hugs
  it and peeks UP, rather than stepping out.
- **Soft cover (0.9 m) is a steering preference and nothing else**, and it is now
  the only one of the three that is: it biases movement toward walls and away
  from open ground, and a bot behind something between 0.9 and 1.3 is exactly as
  shootable as one in the open however low it gets. Never treat it as protection.
- **The three nest by construction** — 1.7 > 1.3 > 0.9, and the bake sets the
  shorter masks whenever it sets a taller one. That is what lets `kindAt` be two
  bit tests, and it is why `hard` never has to be checked as "hard but not
  crouch".
- What it buys, measured on Hollowmere: 23,817 walkable surfaces × 16 bearings,
  of which 35,310 pairs are hard cover and **4,516 more are crouch-only** — a
  ~13% increase in the ground that offers a bot real protection, and a `findCover`
  that answers `crouch` on ~8% of searches. Greyfen has almost none (its trees
  are hard cover and its ferns are nothing); the band is thin on purpose, because
  everything in it had to earn the 1.3 m line.

**The stance itself is `Bot.crouchBlend`, and every consequence rides the BLEND
rather than the decision.** `wantCrouch` is re-decided from scratch every frame —
standing is what a state gets by saying nothing — and the ease is
`player.crouchBlendSpeed`, the player's own number, because it is how fast a body
folds rather than a property of whoever asked. Off the blend come the eye, the hit
sphere, the pose, the speed (`cover.crouchMoveMult`) and the spread
(`cover.crouchSpreadMult`), so a stance caught halfway is as correct as one at
rest. **The eye and the hit sphere must come down together** — `syncTransform`
runs the same arithmetic `NetSoldier` runs for a remote body — or crouching makes
a bot easier to kill rather than harder, every incoming round aimed at the middle
of an unmoved sphere instead of grazing its top.

Four things take it, and nothing else may:

- **The tucked-in half of a peek at crouch cover.** What a peek IS depends on the
  kind, and the two are the same cycle on the same clock because they are the same
  decision — be shootable for a moment, then not. Round a corner the bot steps out
  sideways and stays standing; behind a low wall there is nowhere to step to, so
  the peek is standing UP in place and the stance is the whole of the exposure.
- **A reload behind cover**, of either kind.
- **`suppressed`**, unconditionally: it is the one state where the bot is not
  trying to do anything else with its body, and a corner does not stop a burst
  already walking along the wall. This is also the state that finally has
  something to *show* — "hunkered down" used to have to read as "not moving".
- **A defender holding a covered vantage on its own flag**, while alerted.

**Losing sight of the enemy from behind your own cover is what cover DOES, and it
must not drop the anchor.** The old `think` dropped it on the first tick with no
visible target and fell through to the search cue, so a bot that took cover forgot
why, stood up out of it and walked off to look for whoever had been shooting at
it — which is also why a crouch could not have worked at all, since the stance
breaks the sightline by construction and the ducking bot was always the one that
lost its target. A bot at its anchor with `memory.lastAimed` still live stays in
`engage` (or `suppressed`, which that branch is what made reachable — the whole
decision tree above it needs a visible target), and the peek cycle runs on the
remembered bearing until it stands the bot back up. Measured over three rounds a
side: the fraction of the roster in `engage` went 0.093 → 0.204 on Hollowmere,
0.089 → 0.154 on Greyfen and 0.365 → 0.421 on Coldharbour, with `hunt` falling
to match. Bots hold a fight instead of losing it and going looking.
- **A `porous` box is neither mask, and a `strut` is in no mask at all.** The
  bake skips the porous box outright: rounds go through it (that is what the
  flag means), so it cannot be hard cover for the reason above — and it cannot
  be soft either, because soft exists to steer bots toward walls and away from
  open ground, and a fence line *is* open ground with a rail across it. The
  timber that DOES stop rounds is `rayOnly` and emits no `WorldBox`, so it never
  reaches this bake either, which is right: a 0.18 m post is a thing a round
  hits, not a thing a body hides behind. (It does reach the ray queries, as
  `GameMap.rayGroups` — see `RayWorld`.) The same split is why a bot's LOS runs
  across a fence — `BattleSystem.visible` is `RayWorld.blocked`, so a bot sees
  exactly as far as its rounds reach, timber included.
- **It is a preference, not a commitment** — the same rule as `ObstacleField`'s
  push-out. A spot not reached within `cover.abandonTime` is dropped, and a cooldown
  stops the search instantly re-picking it. A bot moving to cover still shoots; only
  the tucked-in half of the peek cycle holds fire. Without both, bots walked into walls
  holding fire for the whole round.

## A bot in a tank is not a bot

On a map with armour a bot can climb into a hull — **into either of its two
seats, and two bots can be in one tank** — and when it does it leaves this file
entirely. Every part of the FSM above — cover, the peek cycle, the
crouch, the separation pass, the flow field walked a cell at a time — is about a
body standing up, and none of it survives contact with a seven-metre vehicle. So
a crewed bot is taken OUT of the fight exactly as a mounted player is, and
`systems/TankCrew.ts` is the second brain that drives in its place.

What this file owes it is two things:

- **`BattleSystem.aside` is the one skip test, and every loop over `bots` owes
  it.** `crewed` is a second `Set<Bot>` beside `benched` — the same exclusions
  (not respawned, not thought for, not a target, not drawn, not in a formation)
  for a different reason, and written only through `setCrewed`. Never test
  `benched.has` directly: two reasons is exactly the number at which a third one
  gets added at one call site and missed at eighteen.
- **A driver still gets its squad's ORDER.** `update` runs `applyOrder` over the
  crewed set explicitly, because a driver skips the think pass that would
  otherwise refresh `Bot.objective` — and that field is what the tank steers on.
  The armour goes where its crewman's squad was going, which is why there is no
  second objective planner and no way for the two to disagree.

Unlike a benched bot a crewman is still ALIVE: it holds its ticket, its
scoreboard row and its position, which the crew slaves to the hull with
`Bot.nudgeTo`. The GUNNER's `objective` is refreshed the same way and steers
nothing — he lays the cupola gun and has no route at all, which is why only the
driver reads it. See [`vehicles.md`](vehicles.md) for the rest — the two seats,
how each crew is picked, why a tank is never a destination, why the gunner sees
infantry only, and why the player can always turn a bot out of a seat.

## Squads and objectives

**Squad orders are planned as a group** (`ConquestSystem.planSquads`), on their own
2 Hz timer rather than per bot per think. What it replaced was `ranked[squad %
ranked.length]`: squad N took the Nth-best flag, so a team with two squads only ever
pursued its top two objectives, could never choose to defend (an owned flag scored a
flat −30 however close it was to being lost), and re-sorted the point list 80 times a
second to do it.

- A claimed point is **penalised, not excluded**. When the round hinges on one flag,
  two squads stacking on it is correct; forced spreading is what sent bots wandering
  away from the fight that decided the game.
- **`ControlPoint.present[]` is finally read** — an owned flag with enemies on it
  scores a defence bonus scaled by how far the meter has slipped.
- **Distance is a fraction of the MAP, not a rate per metre.** The penalty is
  `distance / diagonal * squad.distancePenalty` (85), which is exactly what the
  retired flat 0.25/m was worth across a 240 m map and therefore leaves the two
  valleys where they were. Written the old way it was a statement about a map
  size that the four scores it is weighed against — a neutral flag's +40, an
  enemy's +70, a contest's +50, `switchMargin`'s +30 — do not make: on Sarab's
  900 m square it was worth 300 points across the map, so no tactical term could
  outvote it. Every squad took the flag nearest its own centroid, `defend`
  follows from owning what you picked, and `hold` is a covered vantage — so a
  squad that captured its home flag stood on it for the rest of the round.
  Measured headlessly over 400 s: **36.5% of live-bot samples stationary with
  33.0 points of that defending nothing, and 23.6% of bot-time in `capture`
  against Hollowmere's 1.5%**; normalised, 9.2% stationary, none of it
  defending, 3.1% in `capture`, and the round's flag captures went 8 to 16.
  Anything above ~110 puts distance back in sole charge at every scale.
- **Defending is a posture, not a destination.** `Bot.think` takes a `BotZone` (`none`
  / `contest` / `hold`): `contest` keeps the old drift, since bodies in the circle are
  what move the meter, while `hold` takes a covered vantage and watches. **`hold` is
  checked before the search cue** — a defender that hears a shot and walks off to
  investigate has abandoned the only thing it was there to do.

## What a team tells itself, and what it remembers

`SquadRadio` is one board per team, held by `BattleSystem`, cleared on
`reset` — a team's memory is a ROUND's memory, and last round's marks would
float over geometry that no longer exists. Bots reach it only through
`BattleCtx`. It carries two things and both are **cues, never knowledge**:
neither is allowed into `BotMemory`, because everything in there feeds `hasCue`
and would turn a cue into a SEARCH.

**A contact call is a LOOK.** A bot with eyes on an enemy calls it to its own
squad — the squad and not the team, since a team-wide broadcast turns one
sighting into sixteen bots converging on one grid reference, which is the herd
rather than the fix for it. A squadmate acts on it only when it has nothing of
its own to look at and only inside `engageRange`, and what it does is turn its
head and widen its cone. Against a directional acquisition cone that is most of
what being warned is worth: the enemy who walked past an unaware bot is now
walking into one that is pointed at them. **Making it a destination instead was
measured and rejected** — it put Greyfen's roster in `hunt` 63% of the time
against 39%, halved the time spent fighting, and cost the flags the difference.
Where to walk is the squad's objective, and a SHOT is what changes it, which
`hearGunshot` already does.

**A hazard mark is where this team keeps dying.** `Bot.onDied` — a callback,
because there are three kill paths and exactly one death — puts the body's
position and the bearing it fell to (`deathFrom`, which the ragdoll already
needs) on the board. Deaths inside `hazardMerge` reinforce the existing mark
instead of adding one, which is what turns four bodies on a street corner into
one strong mark and keeps `hazardMax` from being spent by a single firefight;
marks fade over `hazardMemory`. Inside `hazardRadius` a bot does three things
at once, and they are one behaviour: it drops the sprint to a walk
(`hazardCaution`), it looks at the bearing the fire came from, and
`smoothHeading` bends its route AROUND the mark rather than through it
(`hazardSwerve`, a lateral push exactly like `wallHug`, never a retreat — a bot
pushed straight back would stop advancing).

**That swerve is the whole of "come in a different way".** There is one route
graph and no second one to pick, so the alternative is made by bending the only
route there is: a squad cut down crossing the square comes round the edge of it
next time, slower, looking at whatever did the cutting.

Both are ray-free and allocation-free, like the rest of perception, and every
position on the board is jittered per LISTENER rather than per call — the same
fix `hearGunshot`'s jitter needed, and for the same reason.

## Squads walk as a line, not a column

**Herding is made in three places and each needed its own answer.** Measured as
the fraction of living bots with a friendly inside 3 m, averaged over 240 s
rounds:

| map | before | after |
| --- | --- | --- |
| Hollowmere | 0.321 | 0.130 |
| Greyfen | 0.251 | 0.082 |
| Coldharbour | 0.334 | 0.150 |

Three 240 s rounds a side per map at `Regular`, through `HeadlessGame` — the
harness `npm run simulate` drives. Read it beside the engage fractions above
rather than on its own: the point is a squad that spreads without fighting less.

- **`movement.spacing` (5 m) is the formation, and it is the dominant term** —
  ablating it alone puts Coldharbour back to 0.385 and Hollowmere to 0.288.
  It is NOT `bots.separation` (1.5), which is de-penetration: two bodies' width,
  all this used to be, and the reason four bots on one flow field marched down a
  single line two metres apart. Both fall out of the same pairwise pass, the wide
  one is deliberately the weaker (`spacingWeight`), and a corridor narrower than
  the spacing simply wins once `tryMove` slides the push along the wall.
  De-penetration is owed to everybody; the formation is owed only to our own
  side, because an enemy at four metres is a fight and not a queue.
- **`spawnJitter` (1.5 s) breaks up the wave.** `conquest.respawnDelay` is one
  number for everybody, so a squad wiped together walked out of the gatehouse
  together. It only ever ADDS, which keeps the corpse's sink margin intact.
- **The hazard swerve stops a team re-forming on the same line into the same
  killing ground**, which is a different thing from spacing and does not show up
  in the 3 m metric — it shows up in where the route goes.
- **Cover anchors are claimed.** The bake is a lookup over a static map, so four
  bots under fire from one bearing were handed the same corner. `findCover` skips
  any cell within `cover.claimRadius` of a squadmate's anchor, and the claim IS
  the anchor rather than a reservation kept beside it — so nothing has to be
  released and nothing can go stale.

## Movement texture and skill

**None of this moved the AI's frame cost anywhere it matters.** `battle.update`
for the whole roster, timed inside the same rounds: Hollowmere 0.282 → 0.317 ms,
Coldharbour 0.276 → 0.341 ms, Greyfen 0.476 → 0.458 ms. The new per-frame work
is the wider separation term and the radio's decay; everything else — the claim
scan, the hazard and contact lookups — is on the think tick, which is budgeted.
What the remaining delta mostly buys is fighting: a roster that holds contact
fires more rays than one that keeps losing it, which is why the engage fraction
belongs beside any timing taken here. Judge a change against the pair, or the AI
getting BETTER reads as the AI getting slower.

**Movement texture is heading, speed and facing only.** Two measured results worth
keeping: `NavGrid.steerAhead` plus heading smoothing cut mean path curvature by ~27%
(`steer` returns the direction to the next 8-neighbour cell *centre*, which is why
bots walked flow fields as a visible 1.5 m zigzag); and the per-bot lateral weave
spreads a squad (+95% mean separation) but is itself a source of curvature — at a 5 s
period it put back *exactly* the wobble the smoothing removed, and 11 s keeps the
spread and the straightness both. Retune one, re-measure the other. Smoothing runs
**before** separation and the stuck watchdog, deliberately: the watchdog's sidestep
is what frees a bot wedged behind a tree.

**`Bot.yaw` is where a bot LOOKS; `Bot.bodyYaw` is where its feet point.** The rig
hangs off a single root yaw, so before the split a bot aimed its whole body at
whatever it was tracking and one strafing across a doorway walked visibly sideways.
`animateSoldier` takes a `twist` for the difference, applied at `torso` with the head
taking a share on top; the legs are `torso`'s siblings under `body`, so they are
untouched. It costs one `rotation.y` write and fixes the walk cycle for free. Three
rules: the twist is **clamped** to `CONFIG.bots.movement.maxTorsoTwist` and past it
the hips come round with it, or the shoulders end up on backwards; a **stationary**
bot's feet converge on its look direction; and **perception reads `yaw`, never
`bodyYaw`** — `BattleSystem.inView` keys off `Bot.facing`, and where a bot points its
feet must not change what it can see. This is still not a lean — the crouch is a stance
of its own and lives with the cover it is taken behind, above.

**Skill is one scalar per bot** (`BotSkill.profileFor`), resolved into a `BotProfile`
once at assignment and never per frame — `CONFIG` is `as const`, so lerping at each
use site would need an annotation everywhere. It is drawn **per squad** from a seeded
generator, because an elite squad and a green squad is something a player can read
where salt-and-pepper skill inside a squad is noise. Difficulty tiers slide the
distribution's centre and hold its width, so every tier still contains aces and
rookies.
