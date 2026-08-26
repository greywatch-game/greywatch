# Multiplayer

The contract for `server/`, `src/net/`, and the parts of `Game`, `BattleSystem`
and `CombatSystem` that a networked round changes. Read it before touching any
of them. [`CLAUDE.md`](../CLAUDE.md) keeps the summary — what a reader must not
violate even if they never open this file; everything below is the argument
under it.

The shape in one sentence: **a dedicated Node server runs the real simulation
under Babylon's NullEngine, clients render it, and a roster slot is a slot
whether a person or a bot is in it.**

**The WebGPU port did not touch any of it, and that is the first thing the next
reader wants to know.** `NullEngine` has no backend to swap: it draws nothing,
compiles nothing and never asked which shading language the tree is written in,
so `server/HeadlessGame.ts`, `server/parity.ts`, `npm run parity` and
`npm run simulate` all came through the migration unedited. What the client is
gated on — an adapter, a device, the two WASMs it must never fetch — is the
client's alone. The one place the two sides still have to agree is the world
they pick against, and that is `collision.ts` and `src/world/solid.ts` below,
neither of which is a rendering question.

## The three decisions everything else follows from

**The server is the authority.** Bots, flags, tickets and damage are decided in
one process that no player controls. It is not a relay and there is no host
client — matches are public, played with strangers, and an unpoliced player
would be one with a permanent advantage.

**The authority re-runs the ray.** A shooter fires locally and flashes a
hitmarker; that marker is a *guess*. The round is reported, every target is
rewound to the instant the shooter was looking at, `CombatSystem.fire` is called
again on the server, and only that result deals damage. A client's claim is a
hint, never a fact.

**Movement is client-simulated and server-validated.** Each client runs its own
`Player` exactly as it does offline and reports where it ended up; the server
rejects what is physically impossible. This was chosen over replaying inputs
because `Player.update` reads `InputManager` and `CameraSystem` directly and
mutates some forty fields, and making it a replayable pure step is a refactor of
the largest entity file in the game. The price is stated plainly below.

**And on a map with no wall, WHERE a player is allowed to be is two questions
rather than one.** `MapLayout.borderland` (Harrowmead; see
[`docs/world.md`](world.md)) carries the floor a margin past the play square,
and standing out there is ordinary rather than a cheat — so `validate.ts`
measures its extent against `map.size / 2 + map.margin`, and what runs a player
back in is `src/world/leash.ts` instead. **The authority holds the one that
counts**: `NetPlayer` owns a `Leash`, `HeadlessGame` steps it against the last
position that player reported and kills through `takeDamage` like any other
death, which is also what makes a player who walks out and then stops sending
anything die out there rather than wait it out. **The client runs the same clock
and only draws it** — the countdown has to be on screen the instant the line is
crossed rather than a round trip later, and being a pure function of movement it
is prediction of exactly the kind this model already allows. **The leash costs
the wire nothing**: no message, no field, no event — one existing field changes
MEANING and that is all. `kill` carries the killer's TEAM and derives it as
`1 - victim.team`, because friendly fire is excluded by construction and so the
side that killed a person is always the other one; a leash death is the one that
breaks that premise rather than the derivation, and it sends **`killer: -1`** so
that sixteen killfeeds say `OUT OF BOUNDS` instead of blaming the enemy. A
client must guard before indexing `CONFIG.teams` with it.

## What is NOT defended against

Worth being honest about, because a reader who assumes otherwise will build on
sand.

- **Aimbots.** An aimbot is unusually good input and nothing can distinguish it.
  The shot cone bounds the lie to something a real player could have aimed at,
  and that is all it does.
- **Wallhacks.** Every client is sent every body's position because it has to
  draw them. A dedicated server does not change this; only per-viewer culling
  would, and that is not built.
- **Cheating inside the movement tolerance.** Someone moving at 1.19× sprint
  forever is invisible to the validator. The margin leans deliberately toward
  letting a laggy honest player through, because a legitimate player yanked
  backwards has a worse experience than everyone has from a cheat worth 19%
  speed.
- **A player who reloads quietly.** The `reload` message is the one thing a
  client tells the authority about itself that nothing can check, so a client
  that simply never sends one changes its magazine in silence and loses the cue
  that says "push me now". It is worth exactly what it costs to take: the
  server would have to own every player's ammunition to close it, and what a
  cheat buys is that fifteen people do not hear a noise.
- **A flood from many addresses at once.** The bounds below are per socket and
  per address, so what they stop is one host spending this process; a thousand
  hosts sending one connection each is a network-layer problem and there is
  nothing in Node that answers it. What the bounds do buy against that is that
  the cost per connection is bounded and known, rather than being whatever the
  attacker chose to send.

## The roster is the feature

`server/Roster.ts` holds **sixteen slots, built once, never resized or
reordered.** A slot is never created or destroyed — only who feeds it changes.

- A match starts as soon as one person is present. Every unfilled slot is a bot.
- A human joining takes the lowest-numbered bot slot on the thinner team; the
  bot there is **benched**.
- A human leaving un-benches it, and the bot rejoins through the ordinary
  respawn queue with its skill and squad intact.

**Benching is not killing, and this matters.** Joining a match must not charge a
team a reinforcement, and neither must leaving, so neither path touches tickets.
`BattleSystem.setBenched` takes the bot off the field without a death.

The bench lives in `BattleSystem`, as a `Set<Bot>`, and **not as a flag on
`Bot`**: which slots hold people is a fact about the roster, and `Bot` is an AI
combatant that has no business knowing a lobby exists. Every loop over `bots` in
that file must skip the bench — respawn, the think budget, `hittablesAgainst`,
`acquire`, `separation`, `hearGunshot` and the squad centroids all do.

**A slot index IS a bot index**, by construction: `Roster` lays slots out team 0
then team 1, `BattleSystem` builds its pool the same way, and both are sized
from `CONFIG.bots.perTeam`. Keep that true or benching needs a mapping that can
disagree with itself.

Team balance is corrected by *arrivals*, never by moving anybody. Being
reassigned mid-round is disorienting; `Roster.claim` always takes the thinner
side, so an imbalance left by departures heals on its own.

**Which side the local player is on comes from the welcome and from nowhere
else.** That balance rule puts the SECOND person into a match on team 1, so a
client holding a hardcoded 0 reads every mine/theirs question in the game
backwards at once — the ticket strip, the flag colours, the minimap, the spawns
the deploy screen offers, the killfeed's "was that us", and the colours its own
body falls in. `Game.applyPlayerTeam` is the single funnel, and it is called
from **both ends of the race the welcome is in**: `joinMatch` books the local
round before the socket is open, so `buildRound` reads `NetSession.team` when
the welcome was early and `NetSession.onSeated` applies it when it was late.
What the funnel is for is the short list of things painted ONCE in a side's
colours — the death cam's stand-in body, the minimap backdrop, the HUD strip
outside `playing`, the deploy screen's spawn list. Everything else reads
`player.team` live every frame and needs nothing.

## On the client, a bot and a person are the same thing

`NetSoldier` is a `Combatant` with a `SoldierRig`, posed from snapshots. It never
thinks, never moves itself, never fires and never decides it is dead.
`NetRoster` pools sixteen of them, indexed by slot, built once and never
disposed.

The client is **not told** which slots are people. That is what makes "start
without a full lobby" and "give a leaver's slot back to a bot" one mechanism
instead of two: a slot changing hands touches no mesh, no pool entry and no
index.

Two consequences to preserve:

- **`STRIDE` is shared** (`SoldierModel.ts`). Both `Bot` and `NetSoldier`
  advance their walk cycle by distance travelled over the same divisor. If they
  differed, a bot and a person walking side by side at the same speed would
  swing their legs at different rates — which is precisely the tell that would
  give away which bodies are AI.
- **The walk weight is derived server-side**, from ground actually covered, not
  reported by the client. An animation flag a client sets is one it can lie
  about.
- **A person's body falls over on the same field a bot's does.**
  `NetPlayer.deathProgress` is `Bot.deathProgress` derived from the respawn
  clock, and it rides `EntityState.dead`. Both are keyed to `death.hideTime`, and
  what a client does with the field is hide a body when it reaches 1 — so sending
  a bare `1` instead, which is what it did, makes a killed player VANISH on the
  tick they die, and takes the ragdoll with them because the rig is gone before
  the pool is offered it.
- **A stance is a stance whoever is in it.** `animateSoldier` takes a blend and
  three things pass one — a person's key, a bot behind cover (`Bot.stance`), and
  the death cam's stand-in — so one rig and one code path draw all of them, and
  `Match` puts a bot's on the wire in the same field as a person's. See below for
  why the stance is a number rather than the boolean the client sends up; every
  word of it applies to the bot, whose blend the authority is likewise the only
  thing that eases.

## A stance is drawn where the authority has it, or it is worse than not drawn

The client sends `crouching` as a boolean, the authority eases it into
`NetPlayer.crouchBlend`, and **the SNAPSHOT carries the blend** — not the
boolean, and not nothing.

Not nothing, because a drawn body that does not crouch is an invisible
advantage. The authority drops a crouching body's eye to `crouchEyeHeight` and
its hit sphere to `crouchCenterHeight`, half a metre each — a player's in
`NetPlayer`, a bot's in `Bot.syncTransform`, and the two run the same
arithmetic; an observer drawing
them upright aims at a helmet the sphere no longer reaches, and the round the
shooter watched land is a miss the server never saw a reason for. The same body
is also drawn head-up over a wall it is genuinely hidden behind. Both are the
`visible but unhittable` failure `config/player.ts` argues at length, arriving
over a wire instead of out of a config.

Not the boolean, because a client cannot ease it. `NetPlayer` runs the same
`crouchBlendSpeed` ease `Player.syncCombatant` runs, so the eye and the sphere
take a quarter of a second to travel — and a client running its own ease against
that one would disagree with it for that whole window, by up to the same half
metre it was sent to fix. Sending the number the authority actually used makes
the disagreement unrepresentable: `NetSoldier` interpolates it between samples
like every other field, poses the rig from it, and derives its own copies of the
centre and the eye from it, so what a shooter aims at and what `LagComp` rewinds
are the same shape at the same instant.

The pose is derived rather than authored for the same reason (`SoldierModel`).
`CROUCH_DROP` is read from `camera.eyeHeight - player.crouchEyeHeight`, the legs
are folded by inverse kinematics to carry the hips exactly that far down with
the boots planted, and the spine's own lean is subtracted from the drop it
buys — so the drawn head lands on the eye the authority is using, at every point
of the blend and not only at its ends. Retune the crouch in `CONFIG` and the
drawing follows; author the pose by hand instead and the two drift apart the
first time anybody does.

`EntityState.crouch` is optional and absent means standing, so it is additive in
the same way `fired` and `present` are and needs no `PROTOCOL_VERSION` bump. It
is omitted while a body is standing, which is most bodies most of the time and
was every bot in the game before one could take the stance.

## Coming into the world is an ASK, and it is the only one

A person chooses where they drop in, in a match exactly as offline: the deploy
screen is the same screen, offering the same list, and the difference is only
who acts on the choice. The client sends `deploy` and the authority puts the
body somewhere; **nothing on the client may place it.** That is the same rule
the rest of this document argues for a bullet, applied to the one question a
shooter cannot afford two opinions about — where somebody is.

**A person is deployed only when they have BOTH waited and asked.** The
reinforcement clock in `HeadlessGame.step` says when and `NetPlayer.deployRequest`
says where, and neither is enough alone. There is deliberately no timeout into
the world: a player looking at the map is doing the thing the screen is for, and
the alternative is yanking them out of it mid-decision. A slot whose person is
still choosing is simply a slot with nobody on the field — which is what it was
while they were dead anyway.

**The index on the wire is into the MAP's spawn table, not into the offer.**
The offer — `ConquestSystem.deployOptions` — is derived from flag ownership and
re-derived every frame, so its indices renumber the moment a flag changes hands
and the same number means two different places on two machines a round trip
apart. `GameMap.spawns` is the layout module both sides build from and never
moves. `spawnIndex` is the client's half and `deployAt` is the authority's, and
the authority's half is the check: a spawn is honoured only if it is in the list
that team would be offered *now*. The enemy's gatehouse, a flag lost while the
message was in flight and an index that is not a spawn at all are all refused by
that one lookup.

**A refusal costs the position and never the reinforcement.** `spawnPointFor`
falls through to the pick a bot would get, because the player asked to come back
and coming back is not the part they are asking permission for. A refusal that
left them dead would be a client desync — a list a tick out of date — punished
as though it were a cheat.

**The request stands until it is answered, on both sides.** `NetSession` holds
it and re-sends on the next welcome, because the two moments a client is seated
without being in the world are exactly the two where a dropped request strands
somebody: a confirm made before the welcome lands (the local round is booked
before the socket opens), and a reconnect, which seats this client into a fresh
body that is dead until it asks. The server holds an EARLY ask rather than
refusing it, for the mirror reason: the client's countdown is the one the player
watches and it legitimately reaches zero a trip ahead of the server's.

**A reconnect puts the deploy screen back up, over whatever was on it.**
`Game`'s `onSeated` does that from `playing` and `dying` — the client's old slot
is gone, its new one is dead, and every movement sample it sends is dropped as
"a dead player reports nothing worth keeping", so a client that carried on
playing would be a ghost nobody can see or shoot. It deliberately does NOT do it
from `deploy`, where the screen is already up and re-showing it would reset a
selection the player is in the middle of making.

**The deploy screen keeps its place by IDENTITY.** Its list is live in a
netplay round — a flag falling two hundred metres away removes a row — so a
carried index would quietly become a different position under a hand already on
Enter. This is the same rule the lobby follows, arrived at from the other
direction.

**`PROTOCOL_VERSION` is 3 for this**, and it earns the bump: the change is to
who acts first, so a version-2 client against a version-3 server would sit dead
in a live match forever, alive on its own screen and absent from everyone
else's. Refused at the handshake, it is a sentence the lobby prints instead.

**The deploy screen and every lid over it step the netplay frame, and there is
no state left that draws a live round without stepping it.**
`Game.updateNetWorld` is called from `updateWorld` for the states inside the
round and from `updateNetUnderCard` for the ones that are outside it, because a
player waiting to come back — or sitting in a menu — is watching a fight that
has not stopped for them: unstepped, sixteen bodies stand frozen behind the card
and snap on the frame they leave it, the ticket strip under it shows the round
they died in, and the flags the deploy offer is derived from never arrive at all
before the first deploy, so a player joining a match in progress is offered their
home spawn and nothing else. `RagdollSystem` is in that method for a sharper
reason than symmetry: `updateNet` is what raises an interpolated death, and a
death raised while the pool is not stepped is a corpse that takes a rig and hangs
in the air for the rest of the round. It stays out of `menu`, which is a round
that is not running — and `menu` needs no test of its own, because `enterMenu`
calls `leaveMatch` and `this.net` is null in every state that reads back as one.
A `paused` netplay round IS running, which is the whole difference between a lid
here and a lid offline.

**The scoreboard is up on that screen too, and it is a match feature more than
an offline one.** Offline the deploy screen is a couple of seconds; in a match it
is where a player spends every reinforcement clock of every death, watching a
round they are not in — the exact moment "how is this going" is worth asking.
`Game.pushScoreboard` runs from `tick` for `playing`, `dying` and `deploy`
alike, so the panel follows the round rather than the weapon in your hands.

**So a networked lid covers the local half of a frame and nothing else**, and
the things a pause normally freezes alongside the world have to be let go with
it. The HUD keeps its real `dt` — a killfeed held at zero stacks the kills that
arrive while the card is up and fades the lot on the resume. The reinforcement
countdown keeps running, because it is the server's `NetPlayer.respawnT` that
gates the deploy and the local copy is a number on a card plus the gate on its
own button: a lid that stops it makes a player wait out time the authority has
already given back. The audio clock is left running, which is the least obvious
of the three: `hit`, `damage` and `explode` sound straight from the message
handler in whatever state the client is in, and against a suspended
`AudioContext` they neither play nor reach `onended`, so each holds a voice
against the cap until the resume and then they all fire on the same instant.

**Four lids — `paused`, `settings`, `loadout` and `lobby` — and `settings` is the
one that can be raised over another**, so what a frame owes cannot be read off
`Game.state` alone: `ScreenStack.under` looks through the stack for the step at
the bottom of it, and `worldHeld` asks the only question the HUD's clock cares
about. **No lid decides any of this for itself.** Each declares `roundBehind` in
`SCREENS` ([`docs/states.md`](states.md)) and `Game.updateRoundBehind` — one call,
from `tick`, for whatever is on screen — is what steps it, so a fifth screen
cannot be written without an answer. It used to be a call each screen had to
remember, under a comment saying the next one owed the same; the kit screen is
the one where that was easiest to skip and worst to skip, its scrim being opaque
but for the stage the weapon turns on, so the freeze behind it is nearly
invisible and the snap on the way out is unattributable.

What a lid still covers is everything that would be a decision — the player does
not move, shoot or upload; `updateNet` asks for `state === "playing"` before it
sends a move sample, so a paused client is already indistinguishable on the wire
from one standing still. **That is the cost of the feature and it is not a
bug**: the body stays in the world, breathing and shootable, for as long as the
menu is up.

## A death, on the side that only watches

The authority decides who died and has already charged the ticket, written the
killfeed line and started the respawn clock before a client hears about it. What
is left is a body falling over, and that is the client's alone — the same
`RagdollSystem` pool and the same single refusal (past the fog wall) as offline,
with the same eviction of the oldest corpse when the pool is full. Three things
make that work and each has a way of failing quietly.

**The trigger is the interpolated death, not the `kill` event.** `NetRoster`
reads the `alive` edge either side of the one call that can move it and raises
`onDeath`; `Game` wires that to `ragdolls.spawn` exactly as `onBotKill` is
wired to `registerBotKill`. Two reasons it is not the event. The event arrives in
real time and the body is drawn `interpDelay` behind it, so spawning from the
event throws a corpse a tenth of a second before the round that killed it appears
to land. And every death is in the snapshot stream by construction, whereas an
event is a message a reconnect can drop — a missed killfeed line is a missed
line, but a missed corpse is a body that never falls.

**The `kill` event still has to arrive, because it carries the throw.** `from`,
`amount` and `kind` are the killing blow's origin, size and nature — the triple
`damage` already carried, and the triple `RagdollSystem.applyImpulse` needs — so
the event ARMS a soldier and the interpolated death SPENDS it. An unarmed death
is still a death: a zero-length direction reads as "straight up" and a missing
`kind` reads as a round, so the body falls over where it stood instead of being
thrown, which is what a lost `kill` should look like and is never a body that
fails to fall. **`kind` is OPTIONAL on both events and absent means `bullet`**,
which is what a server built before a blast could throw a body sends and what
every death on this wire used to mean.

**A person reads their OWN death off `damage`, and somebody else's off `kill`.**
That is why the kind is on both: the pair `damage`/`died` is the only thing a
client is told about its own body going down (`kill` names the victim but the
local player has no roster soldier to arm), and `Game` holds the triple in
`netDamageFrom`/`netDamageAmount`/`netDamageKind` from the `damage` until the
`died` that spends it on the death cam.

**One `kill` event per death, and the server has two doors onto that.**
`onKillEvent` sees every bot go down and `onPlayerDamaged` sees every person,
whoever dealt it — a rifle, a blast, another client's round. `Match.onShot` must
raise only the `hit`: a second `kill` from there would put two lines in the
killfeed for one body, and it is the poorer of the two anyway, because it does
not know where a bot's killing blow came from. The killer's team on a person's
death is DERIVED (`1 - victim.team`) rather than carried, because friendly fire
is excluded by construction everywhere in this game.

**`HeadlessGame.resolveShot` is the third way a bot can die, and it is the one
that was not charging for it.** `BattleSystem.onBotKill` fires for a bot shot
by another bot and the grenade handler fires for a blast, but a person's round
reaches `CombatSystem.fire` through `resolveShot` and touches neither — so every
bot a human killed cost that team no reinforcement at all, and the only thing
draining their tickets was the flag bleed. It is charged there now, one line
after the resolve, exactly where the client's `Game` charges the same kill
through `registerBotKill`. The failure mode is worth remembering because it is
silent in both directions: rounds simply ran long, which reads as mistuned
config rather than a missing call.

**While the pool owns a rig, `NetSoldier.update` stands aside entirely** — the
same one-line answer `Bot.update` gives in its own dead branch, and for the same
reason: the solver writes proxy nodes the joints hang off, and a second writer on
those nodes is two things posing one body. `alive` is still read from the samples
ahead of that guard, because it is the pool's own self-defence — a slot whose
subject came back to life releases it on the next step, and it can only know that
from the wire.

**The local player's own death is the death cam, and it runs here too.** The
`died` event routes to `enterDying` rather than straight to the deploy screen: a
death cam decides nothing, so nothing about it belongs to the authority except
the clock, which arrives on the event as `respawnIn`. The bearing and size of the
blow come from the `damage` event the server queues immediately ahead of it —
`died` carries a slot and a clock and nothing to throw a body with. And because
`dying` is a STEP and not a lid, `updateNet` is called from `updateWorld` rather
than from `updateGameplay`: on the other side of that split, the four seconds
spent watching your own body fall were four seconds during which nobody else on
the map moved.

## The client runs none of the simulation and all of its own dressing

`Game.updateWorld` returns early in a netplay round, and the line it draws is
"decides an outcome", not "moves something". Conquest and the bots are the
authority's and are skipped. **`CombatSystem`, `GrenadeSystem` and
`RagdollSystem` are still stepped**, because what they hold between frames is
this client's own effects and nobody else advances them.

**A ragdoll is on the near side of that line, and reading it as simulation is
what left multiplayer with no ragdolls at all.** A corpse decides nothing: it is
not in `NavGrid`, not in `ObstacleField`, not in `hittablesAgainst`, and the
authority has already spent the ticket and the kill by the time the news
arrives. Skipping the physics step does not merely stop bodies falling — it
stops them *finishing*, so a body the pool did take would hang mid-tumble for
the rest of the round with its joints parented to proxies nothing is writing.
The rule is the same one the tracer teaches next door: what this client owns
between frames, this client has to advance.

Getting that line wrong does not look like a missing effect, it looks like a
haunting. A tracer is spawned AT the muzzle a hundredth of a metre long and
`update` is what flies it out to the impact and hides it again — so a round
fired without that step leaves a lit dot floating where the muzzle was, one per
shot, forever. The impact spark, its dust and its sound ride the same clock (they
are spawned when the streak's head arrives, not when the ray resolved), so they
never happen at all; and a thrown grenade hangs at the release point with a fuse
that never runs down.

**The dressing needs targets, and they come from `NetRoster`, never from
`BattleSystem`.** `Game.enemyTargets` is the one place that choice is made, and
both callers that need it — the local shot resolve and the gamepad aim assist —
go through it, because an assist that holds an aim on a body the rounds cannot
find is worse than no assist. Asking `battle` there does not merely return the
wrong list, it returns an EMPTY one that no team check exposes: `buildRound`
calls `battle.reset()`, which leaves every bot in the local pool dead, and
`updateWorld` returns before `battle.update` could ever respawn one, so the only
combatant that side still knows about is the local player — whom the team check
drops. The symptom is a shooter's own screen going quiet: sparks on the wall
behind the man who was hit, no hitmarker until the `hit` event has made the
round trip, and aim assist inert. What the roster hands back are `NetSoldier`s
whose `takeDamage` returns false, so this is a PREDICTION and nothing else —
the authority re-resolves the same round against its own rewound copy, and only
that result deals damage.

**The minimap reads the same substitution, and it is the second place that
empty list had gone unnoticed.** `Game.mapBodies` is where the choice is made —
the bot pool offline, `NetRoster.soldiers` in a match — and without it a netplay
round drew no blips at all: the panel was up, the backdrop was right and the
flags moved on it, so what was missing did not read as a broken list so much as
a map of an empty village. Unlike `enemyTargets` this is a plain READ, so it
hands back both teams and the array as it stands, and the minimap decides for
itself which half it may draw. The local player's own slot is in that array and
is left dead for the life of the session — `NetRoster.applyRoster` resets it and
`applySnapshot` skips it — which is what keeps a friendly blip from sitting
under the arrow that already stands for them.

**Gunfire gives an enemy away, and in a match only the authority can say so.**
Offline that rule is `wireBattle` reading `BattleSystem.onBotFired`; here no
client runs the AI that pulled the trigger and none of them hears another
person's, so the server raises a public `fire` event carrying a slot and nothing
else. A position on it would be a second copy of one the snapshot has already
delivered, on a different clock, and could only disagree with the body being
drawn. `Match.noteFire` is the one door — `onBotFired` for a bot, an accepted
`shot` message for a person, so neither this side nor the far side can tell the
two apart — and it is noted BEFORE the ray is re-run, because a miss gives a
shooter away exactly as loudly as a hit. It is **one event per slot per
snapshot, carrying the rounds that slot spent in the interval**: the message
count is bounded by the roster rather than by the rate of fire (sixteen
automatic weapons at 600 rpm would otherwise be ten times the traffic), while
the count is what keeps the report honest — see the next section, which is the
other half of what this event is for. Nothing is given away by making it public
that the snapshot has not already handed over — every position is in there, and
what the minimap withholds it withholds by choice rather than by ignorance.

**Both ends have an opinion about the same bullet, and it is announced once.**
The local resolve cues the marker and the tick the instant the trigger goes; the
server's `hit` arrives a round trip later saying whether it agrees. Cueing both
does not read as an echo — the gap is far too long — it reads as two hits, which
makes the marker worth less than it was. So a prediction leaves a credit
(`Game.creditPredictedHit`), the event claims it (`claimPredictedHit`), and the
event is silent unless it carries something the prediction could not: a KILL,
which the local resolve can never report and which is the marker that means stop
shooting, or a headshot where this client scored a body hit — the bodies here
are `interpDelay` behind, so the two do not always test the same head zone. The
opposite correction, a predicted headshot the server scored as a body hit, is
deliberately silent: it is a hit either way and the marker is already up.
Credits are a FIFO queue because rounds are re-resolved and reported in the
order they were fired, which pairs them without a shot id on the wire, and they
expire (`CONFIG.net.hitCreditWindow`) because a round the authority scored as a
miss is never followed by any event at all — an unclaimed credit that never went
away would swallow the next genuine correction.

A grenade is deliberately NOT given that list. `hittablesFor` stays wired to
`battle` and so finds nobody, which is right rather than merely harmless: a
bullet owes the shooter a tracer that stops in a body and an immediate marker,
while a blast owes nothing local at all — its light, noise and concussion arrive
on the server's `explode` event — so pointing it at the roster would buy a
line-of-sight ray per body inside the radius and no cue.

The blast is the one place the local copy and the authority both have an opinion,
and the authority wins: **`onExploded` is suppressed in a netplay round**. Every
client — the thrower included — gets the explosion from the server's `explode`
event, so firing the local one as well would flash, bang and shake twice, a
round trip apart, at two points that agree only to within that trip.

## The sound of somebody else

**Offline, everything a body gives off is a callback on `BattleSystem`, and in a
match not one of those callbacks fires.** No client runs the AI that pulled a
trigger and no client hears another person's, so a networked round was silent in
four ways at once: nobody else's weapon, nobody else's boots, nobody else's
magazine, and — the one that decides fights — no crack past your own ear. The
four are answered by whichever side actually knows, and that is deliberately not
the same side in each case. Two flatter cues were missing beside them and are
covered at the end.

**A shot is the authority's, and it rides the `fire` event the minimap reveal
was already getting.** The client plays `Sfx.botShot` at the shooter's own
`eyePos` — the body it is already drawing, which is why no position belongs on
the wire: a report from anywhere else would come from somewhere the rifle
visibly is not. Its own slot is skipped, because `sfx.shoot` played that round at
the player's own ear the frame the trigger went, and the roster's copy of the
local body is never sampled. Both teams are audible and only the enemy is
revealed, which is the split `wireBattle` already makes offline.

**The count on that event is what stops coalescing costing the report its
rate.** A reveal is a timer being refreshed, so one event is as good as three; a
string of shots is three rounds and has to sound like three. So `n` rides along
and the client lays the rounds back out across the snapshot interval it covers,
on the audio clock — a burst played on one instant is one louder shot, and the
rate is most of what says which weapon is being fired at you. It cannot exceed
`TICK_HZ / SNAPSHOT_HZ` by construction, since a slot fires at most once a tick;
the client bounds it there anyway, because the number came off a socket.

**The WEAPON rides along too, and it is the one thing on the wire that says what
somebody is carrying before they hit you with it.** `Sfx.botShot` takes a
`ReportVoice`, so the client voices the shot through `CONFIG.weapons[w].report`
and a DMR two streets away does not sound like the SMG beside you — which is the
same read the report was rebuilt to give offline (see `docs/weapons.md`). The
`reload` carries it for the sharper version of the cue it already was: what a
listener DOES with a magazine change is decide whether to push, and the answer
differs by three seconds between a pistol and an LMG.

Three details make it free. It is read at snapshot time from `Match.loadouts`
rather than remembered at the trigger, because the authority owns the loadout and
it cannot change under a seated player mid-interval. It is a STRING resolved
against the client's own weapon table exactly as `Join.weapon` is resolved
against the server's, so an id one side has never heard of degrades rather than
indexing a table with it. And it is absent for a bot — which is also what an
older server means by it, and what a slot that left between the trigger and the
snapshot leaves behind — so all three land on the flat round every bot fires off
the same rig, without a second branch anywhere. Additive in both directions, so
no `PROTOCOL_VERSION` bump.

**A footfall is nobody's news — it is DERIVED, on the machine that draws it.**
`NetSoldier` already integrates its walk cycle from ground actually covered
(that is what `EntityState.moving` is for), so a stride crossing is exactly the
test `Bot` makes on its own phase, against the same shared `STRIDE`. Sending
steps instead would be sixteen bodies' worth of event at two or three a second
to say something both ends can already compute, for a sound the far end rejects
on distance anyway. The one thing it needs is that a corpse's position is not
somewhere the next frame may measure travel FROM: a body that died at one flag
and respawned at another would otherwise spend the whole distance on its walk
cycle in a single frame, which was a phantom bootfall as well as a half second
of sprinting animation.

**A magazine is the shooter's own, and it is the only thing in this protocol a
client announces about itself.** A bot's reload is the authority's
(`BattleSystem.onBotReloaded`, which only the server runs), but a person's
happens entirely on their own machine — the server counts grenades and not
rounds — so there is nothing for it to re-derive and the client sends a
`reload`. That is acceptable HERE and would not be anywhere else, because a
reload decides nothing: it cannot buy the sender a round, a position or a hit,
and the worst a lie does is make a noise. What is gated is the noise —
`Match.onReload` allows one per shortest reload the peer could plausibly be
performing, primary or sidearm — so a client cannot turn a magazine catch into a
forty-a-second rattle in fifteen people's ears. `Player.onReload` is the one
door on the client, and it exists because a reload begins two ways (the key, and
the last round leaving the magazine inside `tryShot`) and the second is exactly
the one a call site forgets.

**A round going past you is ADDRESSED to you, and the authority is the only
thing that can see one.** Offline the crack is `CombatSystem.onNearMiss` finding
the player inside the target loop of somebody else's shot; in a match no client
resolves anybody else's rounds at all, so `HeadlessGame` wires that callback and
`Match` sends a `nearmiss` to the one person it happened to. It carries the
point of CLOSEST APPROACH and no victim field — the only client it is ever sent
to is the one it is about — and the client spends it on both halves of the
offline handler, the crack and `Player.suppress`. Broadcasting it would say in
public that a named player was very nearly hit, which is the read a wallhack
wants; a filter on the far side would be a promise about the client rather than
a property of the server, which is the argument `hit` and `damage` already make
next door.

**Two flat cues were missing for the plainer reason that the events carrying
them were already arriving.** Offline, `registerBotKill` plays `enemyDie` for
every body that goes down and `wireConquest` plays `capture`/`flagLost` when a
flag changes hands; in a match neither of those callbacks runs, because no
client registers a kill or steps a `ConquestSystem`. Both now hang off the
authority's own `kill` and `captured` events, which were already on screen as a
killfeed line and a banner. The local player's own death is the one exception,
exactly as offline: that is the death cam and `playerHurt`, not somebody else
falling over.

**Two things were missing on the server side of the near-miss path as well, and
neither was about sound.** `HeadlessGame` never wired `onNearMiss` at all, so
the sixteen bots in a match were the only ones in the game that could be sprayed
all day and never flinch — `BattleSystem.suppress` had no caller. And a person's
round reached `CombatSystem.fire` through `resolveShot`, which never called
`hearGunshot`, so bots were deaf to human gunfire specifically: you could empty
a magazine into a squad's backs and nothing would look for you. Both are one
line, both are what the client's `wireBattle` has always done, and both are
invisible until you go looking for them — a bot that does not flinch reads as a
bot that is good.

## Interpolation, and the clock underneath it

Remote bodies are drawn `CONFIG.net.interpDelay` behind the newest snapshot, so
every frame is between two samples that have arrived. Before the oldest and
after the newest it **clamps rather than extrapolating**: a body that keeps
walking because its packets stopped is one that has to be yanked back when they
resume.

The clock offset is load-bearing and easy to get backwards. One sample is
`serverNow - localNow` measured when the message is *handled*, which is
`trueOffset - delay` for a delay that is never negative. So every sample
**understates** the offset and the best estimate in a window is the **maximum**.
Taking the minimum picks the worst-delayed sample and drags render time that
much further behind; it read as a 342 ms skew between a server and a client on
the same machine.

`TICK_HZ` must be divisible by `SNAPSHOT_HZ`. A fractional ratio makes the
broadcast alternate between two spacings and a client interpolating on an even
cadence renders it as a limp.

## Lag compensation

`server/lagComp.ts` keeps `REWIND_WINDOW_MS` of every body's `center` and
`eyePos` and moves them back around a shot.

**`resolve` takes a callback and restores in a `finally`, and it must stay that
way.** A `rewind()`/`restore()` pair is a thing somebody forgets to balance, and
a throw between them leaves sixteen bodies permanently displaced with nothing to
report it — every later shot, LOS test and capture-zone check would silently use
ghost positions. There is a test that throws inside the callback.

The shooter is never rewound: they are resolving their own shot from where they
say they are now.

The window is clamped, not trusted. Unbounded rewind is a licence to shoot at
where somebody stood a second ago.

## What crosses the wire, and what does not

**Never on the wire:** damage numbers, weapon statistics, health arithmetic, map
geometry. A client names a *weapon id* at join; the server validates it against
the real table and looks up everything it means. The map is built locally on
both sides from the same layout module.

**A broken pane is the one exception to that last clause, and it is an INDEX
rather than geometry.** `glass` carries positions in a list both sides already
hold; nothing about where a pane is, how big it is or what it is made of ever
crosses. That is the same trade the weapon id makes: a name into a table the
authority owns, never the table.

**An event with one audience is ADDRESSED, not broadcast and filtered.** Most of
what `Match` queues is public by nature — a flag changed hands, a body went
down, a grenade went off, a weapon fired — and every client needs it to draw the
same round.
Two are not, and both were broadcast with the client filtering them on arrival:

- **`hit`, to the shooter.** Feedback about one person's trigger. Broadcast, it
  told every client in the match who was hitting whom and, through `killed`,
  that a body was going down a tick before the snapshot would honestly show it.
- **`damage`, to the victim.** The sharper of the two, because it is the only
  message in the protocol carrying a health at all — so every client held every
  player's exact pool, live, with the bearing they were shot from beside it.
  That pair is precisely the read a wallhack is after.

**Two more are addressed and were never anything else**, which is what the
mechanism is for once it exists: `nearmiss`, which says a named player was very
nearly hit, and `score`, which says what one player was just paid and for what.
Neither carries a slot at all — the only client either is ever sent to is the
one it happened to, so there is nothing for a guard to compare.

A filter on the far side does not fix either, because it is a promise about the
client rather than a property of the server, and the payload is on the wire
regardless for anything reading the socket. So `PendingEvent` carries the
audience — a slot, or `ALL_PEERS` — and `flushEvents` builds a per-peer payload
on the ticks that have something addressed on them; a tick without one is the
single encoded broadcast it always was.

**The `kill` beside that `damage` stays public, and the pair is where the line
is.** That somebody DIED is everyone's business: the killfeed line and the
corpse are on every screen, and `from`/`amount` ride along because that is what
each client throws the body with. How close they were to dying before it
happened is nobody's business but theirs. `died` is broadcast too and could
equally be addressed to its slot — the client already gates it — but it adds
nothing to what its `kill` has just said in public except a respawn clock.

Two things about that queue are load-bearing. The audience rides on the SAME
list as the events, because a client reads one ordered stream: hit credits are
paired off it FIFO with no shot id on the wire, and `died` is read against the
bearing the `damage` immediately ahead of it left behind. A second list flushed
alongside the first would slide a tick's shared events wholly before or wholly
after that client's own and break both. And the client's `event.shooter ===
net.slot` / `event.victim === net.slot` tests stay, demoted from filters to
guards: client and server ship as separate images, so a rolling deploy can put a
new client in front of a server that still broadcasts, and neither event's shape
changed, so the handshake's version check would not catch it.

**The scoreboard is STATE and is sent as state, not added up from events.** The
authority keeps one line per slot — `HeadlessGame.scores`, a `ScoreBook` of
points, kills and deaths — and `Match` broadcasts all three columns whole as a
`scores` message on the ticks it has moved, which it learns by comparing the
book's `version` against what it last sent. A client that instead counted the
`kill` events it saw would be wrong three ways at once: events are a queue a
reconnect drops, a joiner has missed every one of them that happened before they
arrived, and `kill` names the killer's *team* rather than the body, because the
killfeed only ever needed a side. As state it self-corrects — a lost message is
superseded by the next — and a joiner is handed the table on admission, which is
a message to one peer for the same reason `hit` is.

**`points` is optional on that message and the column it fills is not.** It
arrived after the message did, and the two images deploy separately, so a client
in front of a server that predates it shows kills and deaths that are right and
a score column of zeros — a board missing a column rather than one that is
wrong. Bumping `PROTOCOL_VERSION` for it would have refused the match outright
over a number nothing in the simulation reads.

**What each award WAS is a separate, addressed event, and it exists because a
client cannot infer one.** `score` carries a kind and a number to the one slot
that earned it, and it is what the HUD's feed is made of. The board would give a
client the total a moment later, and diffing it would get the number right and
the reason wrong — "+150" once, where the authority paid a kill and then the
attack bonus the flag under the body earned. Addressed rather than broadcast on
`hit` and `nearmiss`'s rule: it is feedback about one person's own round, and
sixteen clients hearing every award anybody earns is a live feed of who is doing
what and where. `Match` queues it only for a slot a person is actually sitting
in — bots earn all round with nobody behind them to show a feed to, and queueing
theirs would push every tick with a bot kill on it onto the per-peer flush path
for an event no client would be sent.

**A flag pays the bodies standing on it, so `ConquestSystem`'s two callbacks are
the SIMULATION's and not `Match`'s.** They used to be wired straight to the
event queue; a callback has one owner, and the owner has to be the side that
decides something. `HeadlessGame.wire` takes both, pays everyone of the
capturing side inside the ring (`awardZone`, the same `pointAt` that moved the
meter), and hands the news back out through `onCapturedEvent` /
`onNeutralisedEvent` for `Match` to put on the wire — the shape `onKillEvent`
already had. `npm run simulate` is the worked example of why that matters: it
took `conquest.onCaptured` for its own tally and would have silently turned the
capture awards off in the one tool that can check them.

**A kill is counted at the KILLER's door and a death at the VICTIM's, once
each.** They are separate facts with separate witnesses: every death in the game
already arrives somewhere (`onKill` for a bot, `NetPlayer.onDamaged` for a
person) while who fired is known only to whatever pulled the trigger, so a
single door would mean one path inventing the half it cannot see. That is what
`HeadlessGame.creditKill` is, and it is why `BattleSystem.onBotKill` hands over
the shooting BOT and any victim rather than the falling bot and a team — the
older shape dropped every kill whose victim was a person, which on a server is
half the roster. The client's `Game` runs the identical pair offline.

**What a kill is WORTH is decided in one place for both sides.**
`ScoreBook.awardKill` is a free function over the book, the killer's team, the
control point the VICTIM was standing in and whether it was a headshot, and both
`Game.creditKill` and `HeadlessGame.creditKill` reach it with those four facts.
The failure it prevents is not a crash but a quiet disagreement: a player who
learns in a single-player round that clearing attackers off a flag pays extra,
taking that into a match where it does not. Keyed on the victim rather than the
killer, and that is the whole of the attack/defend rule — a marksman clearing
attackers off their own flag from the next street is defending it, however far
outside the ring they are standing.

**A team's totals are SUMMED from the rows and stored nowhere.** Two counters
for one fact is two counters that can disagree, and the one that would be wrong
is the one nothing on screen can check. `HeadlessGame.teamScore` is that sum on
the server (`npm run simulate` prints it); `Game.updateHud` does the same on the
client, over the same rows the columns under it are drawn from.

**Flag OCCUPANCY travels beside the meter, because nothing steps
`ConquestSystem` on a client.** `ControlPoint.present` — bodies in the zone this
tick, per team — is written by the occupancy pass at the top of `update`, and in
a netplay round that pass never runs: `updateWorld` hands the frame to
`updateNetWorld` and returns above it. So the pair sat at the `[0, 0]` that
`start` left there while three things read it, and each of them drew a fact the
meter next to it could have contradicted: the capture panel's enemy count — a
contest announced against *nobody*, which is what this was found as — the
CAPTURING/LOSING word under it, since `0 >= 0` reads as "mine" and a flag being
taken off you claimed you were taking it, and the ring's capturing pulse, which
simply never lit. `Match` puts the counts in `PointState` and `applyPoints`
mirrors them exactly where it mirrors `owner`, `meter` and `contested`.

**The authority counts them, for the same reason it holds the stopwatch.** A
client could run the same `pointAt` over the bodies it is drawing, and it would
be counting a picture `INTERP_DELAY_MS` behind the tick that decided
`contested` — so its tally and that flag would disagree in exactly the frames
the panel exists to explain. Nor is it a new leak: `contested` already says both
sides are standing on that flag, and a snapshot puts every body's position on
every screen regardless. Additive on the wire, like `fire` and `grenades`, so it
carries no version bump — a client that has never heard of the field ignores it,
and a new client against an older server counts the zero it counted before.

**The client sends** its position at `INPUT_HZ`, and — per event — the round it
fired, the grenade it threw, the spawn it picked and the reload it started.
Every one of those is gated before it is acted on. The reload is the only one
the authority cannot re-derive and the only one that decides nothing; see "The
sound of somebody else" for why those two facts are the same fact. The shot's `dir` is the direction the round *actually* flew, spread already
applied, because `CombatSystem.fire` jitters internally and the server has to
re-resolve that bullet rather than a differently jittered one.

**Health REGENERATES on the server, and the client predicts the curve.** Regen
is a rule about a number the authority owns, so `NetPlayer.regen` runs it off the
same `regenDelay` and `regenRate` `Player.update` uses offline — a networked
round whose pool never refilled would be precisely the respawn queue
`config/player.ts` calls that rule load-bearing against, with the twist that only
the multiplayer half of the game had it. Nothing on the wire announces a healed
point: a `damage` event is the only message carrying a health at all, and it is
enough, because a hit is the only thing that can put the client's copy out by
more than a trip's worth of regen. So the client arms its own lock from that
event — `Player.applyServerHealth` is the assignment and the lock together — and
runs the identical curve locally. The drift that leaves is one round trip of
healing and it is on the CLIENT's side: a player may briefly believe they have
less health than the authority says, never more.

**Assigning that health without the lock is the bug the method exists for.** The
client healed straight back to full underneath a server that had never healed it
at all, so the HUD read 100 while the authority held 75 — and nothing looked
wrong until the next round landed and knocked the bar down to where it had
always been. A health that only ever *falls* to the truth is the shape of this
failure, and the cause is a client running half of a two-part rule.

**A position on the wire is the FEET**, and the whole of a body is built up from
it on the far side: the validator asks what is solid at that height, `NetPlayer`
raises the eye and the hit sphere off it, and `NetSoldier` stands a rig on it.
Nothing sends a height twice and nothing sends a height for a part of a body, so
a `y` that means anything else is wrong in three places at once and looks like
one bug in none of them. It has been wrong once: the client uploaded
`Player.root.position` — the collider capsule's CENTRE, half a body higher — and
so remote players floated 0.9 m off the ground, their hit spheres floated with
them, and the movement validator asked whether there was room for someone
standing 0.9 m in the air, which is how a **door lintel became a wall** and a
player got stuck walking through cottage doorways. That is why `Player.position`
is the feet and `Combatant` says so: it is a rule about a whole game's worth of
geometry, not a detail of one entity.

**The two ends of a body must agree about its middle, too.** A standing hit
sphere is centred at `height / 2` (0.9), which is what puts its top the 0.05 m
above the eye that `config/player.ts` argues for — and `SoldierModel`'s rig
centre, `Player.center` and `NetPlayer.center` are all that same number. Deriving
it from `eyeHeight` instead is the near miss: it is the *top* of the sphere that
the eye is 0.05 below, not the centre, and reading that comment as a centre put
the authority's idea of a player 0.6 m up their own chest — so the client drew a
body where the server had none and hitmarkers stopped meaning anything.

## The ping column, and who is holding the stopwatch

**A ping is the authority's MEASUREMENT and not a client's report, for the
reason the scoreboard beside it is state rather than events.** A client can time
its own round trip and has no way whatsoever to learn anybody else's, so the
column a client measures for itself is one row filled in and fifteen blanks —
while the server is on both ends of all sixteen connections and already knows
every one of them. `PingsMessage` is that table, broadcast whole: a number per
slot in slot order, and **-1 wherever there is nobody on a connection**, which
is every bot and a peer whose first ping has not come back. Never 0 for a bot: a
zero is the best connection on the board, and a body that has none should not be
sitting at the top of a column measuring them.

**It is measured with the WebSocket's own ping/pong frames, which is why it
costs no protocol surface at all.** Nothing is added to `ClientMessage` — there
is no ping for a client to send wrong, to flood with, or to answer dishonestly,
and nothing new for `server/wire.ts` to gate. It also measures the better thing:
a browser writes the pong from its network stack without waking its JavaScript,
which is the property `server/index.ts`'s liveness sweep already rests on, so
the number is about the CONNECTION rather than about how busy the far end's page
is. Nothing downstream reads it — every round is still re-resolved against
rewound bodies whatever the column says.

Three details in `Match` are load-bearing, and each is a way of not lying:

- **The ping carries a token and the pong is matched against it.** The
  process-wide sweep in `server/index.ts` pings the very same sockets on its own
  fifteen-second clock, and its pongs arrive at this handler too — untokened,
  this class would time its own ping against somebody else's answer. A pong
  echoes the payload of the ping that caused it (RFC 6455), so the token is the
  whole of the test, and the sweep's own pongs (which carry none) are ignored
  here and still clear its deadline where they are read.
- **One outstanding ping per peer, and a peer that has not answered is not
  re-pinged.** Re-pinging would restart the clock on exactly the connection
  worth showing. Instead `pingFor` reports the WAIT once it passes the last
  estimate, so a peer halfway through a four-second stall reads as four seconds
  and climbing rather than as the 38 ms it last managed. A peer that never
  answers again is dropped by that same process-wide deadline, which is the one
  thing on this server that terminates a socket.
- **The estimate is smoothed by half a sample and the table goes out on a
  CADENCE.** One round trip is one packet that queued behind whatever was in
  front of it, and a display fed the raw number swings between 40 and 180 on a
  connection that is fine. The cadence is the opposite of `scores` and for the
  opposite reason: a score moves a few times a minute, and a latency moves on
  every sample, so "only when it changes" would mean every time.

**The lobby's ping is a different measurement of the same thing, because there
is no socket yet.** `fetchMatches` times its own request — same host, same path,
and an endpoint that does nothing but stringify a Map of at most a handful of
matches. It is taken from the transport's own resource timing
(`responseStart - requestStart`) and falls back to a clock either side of the
`fetch`, and that is not fussiness: the FIRST list a player asks for is the
request that pays for DNS, TCP and TLS, so a naive reading reports three round
trips as one on the one look that forms their impression of the server, and a
third of it on every Refresh after.

**Where it goes is decided by whether the player has a choice to make.** With one
region there is one server behind every row, so the reading belongs to the screen
and sits on the status line — the same number printed four times would read as
though picking a row picked a connection. With more than one that inverts
exactly: the number differs per row, choosing a row IS choosing a connection, and
the reading moves into the list where two of them can be compared. Both forms are
`pingQuality`'s bands, for the reason `ui/ping.ts` exists at all. What the
cross-origin case then costs is a header and a cleared buffer — see "Regions".

## The world the server stands in

The server has no canvas. `DynamicTexture.getContext()` throws
`OffscreenCanvas is not defined` and `GPUParticleSystem.IsSupported` is false,
so **`MapBuilder` cannot run there at all** — it reaches a texture through
`floorMaterial`.

It rebuilds the solid world instead, from `src/world/<map>/collision.ts`
(generated; see `scripts/bake-collision.mjs`). That is sound because
`MapBuilder.collider()` is the only place a collider is made and the `WorldBox`
it records is everything `MeshBuilder.CreateBox` needs. Both sides then pick
against that geometry with the same predicates from `src/world/solid.ts` — one
ray implementation, not two.

**A baked box carries its `porous` flag as a ninth tuple entry, and the bake
carries a second list beside `boxes` for the `rayOnly` geometry.** Both are what
the shot ray adds up to (`OPAQUE_ONLY`; see the collider section of
`CLAUDE.md`): a server whose fences are solid eats rounds the shooter watched go
between the rails, and a server with no fence timber gives up hits the shooter
watched stop on a post. Either way it disagrees in the direction that is hardest
to report, because the client drew the outcome and the authority is the only
side that counts.

`rayGroups` stays **grouped as the client merged it**, one inner array per
collider mesh, and the server merges the same way — `strutMesh` is the one merge
in `server/world.ts`, and it is allowed there because it produces geometry to
pick against rather than anything to draw. The grouping is not cosmetic: merged
per fence, the timber costs a shot 0.2%; merged into one mesh for the map it
would wrap a single bounding box around every fence in the village and charge
every ray for all of them; not merged at all it costs ~17% on every ray in the
process.

**The bake carries a third list, and it is a third VIEW of `boxes` rather than
new geometry.** `boxGroups` is which of them the client merged into one collider
mesh each — indices, not boxes, because these ARE the solid world and are
already in `boxes`, so the nav grid, the cover bake and the obstacle field on
both sides still read every one of them separately. What the grouping decides is
only how many bounding tests a ray pays to meet them, and `clusterMesh` is the
second merge in `server/world.ts` for exactly the reason `strutMesh` is the
first: this process resolves every shot in every match it is running. Greyfen's
jungle is ~1,390 one-metre trunks and its scatter comes to ~180 cluster meshes;
unmerged that would be more collider meshes than the rest of the map put
together, and the authority would pay a bounding test for each on every rewound
round. Anything named in a group is left out of the one-mesh-per-box pass, so a
box belongs to exactly one mesh either way — and nothing porous or glass is ever
grouped, because one mesh cannot carry two answers about porosity and a pane has
to stay addressable a sheet at a time.

**The bake carries a fourth list, and it is the one with an ORDER that matters.**
`panes` is the glass a round can take AWAY — seven numbers and an index each,
the index being the pane's own position in `boxes`. Not the map's glazing, which
is most of the glass drawn and none of it breakable: a sheet with something
solid behind it opens nothing, so it is not in `GameMap.panes` on either side
and the bake never mentions it (see `PaneSpec.breakable`). Coldharbour draws
6,139 sheets and bakes twenty-four. The authority needs those for two reasons,
and the second is the one with teeth: it resolves every shot, so it has to know
which windows a round crossed; and `validateMove` rejects a client standing
inside `map.obstacles`, so a player who shot out a shopfront and walked through
it is snapped back into the street unless this side broke the same pane.

**A pane's index in that array is its NAME on the wire**, so the array's order is
load-bearing in a way `boxes`' is not merely by convention: both processes build
the list in the same order — placements in layout order, each placement's panes
in the order its builder declared them — and a disagreement means two sides
breaking different windows while every other check passes.

`worldFingerprint` carries `porousBoxes`, `rayGroups`, `rayBoxes`, a hash over
the ray geometry, `boxGroups`/`boxGroupHash`, and `panes`/`paneHash`, because
**the nav graph is blind to all of it** — every other field in that comparison would match while the two
sides resolved different shots. The pane hash includes each pane's `box`,
because a pane pointing at a different collider is two sides agreeing about the
window and not about the wall. The box-group hash is the extreme case of the
same argument: a server that ignored `boxGroups` would agree with the client
about every box on the map and quietly do a hundred times the picking work per
shot, with nothing visible on either side to say so. Note also that the bake's `sourceHash` covers a map's
`layout.ts` and `heights.ts` — **a `porous` flag, a `strut` and a `pane` all live
in a BUILDER, so changing one is a bake the staleness guard will not notice.
Re-run `npm run collision` by hand after touching a collider's flags, a
builder's collider set, or its glazing.**

**`npm run parity` is the guard on that claim** and should be run after anything
that touches the world layer. It compares the nav GRAPH, not the boxes: a box
count matches while every box sits a metre to the left, whereas the graph is
downstream of every box's position, size and rotation. It has already caught one
real fault — micrometre rounding in the bake moved 15 cells in and out of the
walkable set, because the nav grid rasterizes box tops into surface heights and
compares neighbours against `stepHeight`, so *any* perturbation flips whatever
was sitting exactly on a boundary. The bake emits full precision for that reason;
do not "tidy" it.

`npm run build` refuses to proceed when a bake is older than the layout it came
from. A stale bake is a server whose walls stand somewhere else from its
clients', and it is invisible until somebody is shot through a house.

## Glass

**A pane going in is the only thing a client may DECIDE about the world, and it
may only decide half of it.** The split is the point:

- The **visual** is predicted. `CombatSystem.onShotPath` runs on the client's own
  shot and `GlassSystem.shoot(..., authoritative = false)` collapses the pane and
  throws the shards on the spot. There is nothing to be wrong about: a sheet that
  vanished on the shooter's screen and not on the server's is pixels, and a
  window that shatters a round trip after the round went through it is a window
  that reads as broken by somebody else.
- The **collider** is not, and every pane has one — a pane that breaks is a pane
  with a room behind it. It keeps blocking a body until the authority's `glass`
  event says otherwise, which is the one round trip that matters: it is not long
  enough to walk through a shopfront, and it is the difference between an early
  break and a client standing where the server still has a wall. `validateMove`
  is the thing that would report it, by snapping the player back into the
  street.

**The event carries the panes, the crossing point and the direction**, because
the shards are thrown from the last two and the authority is the only side that
knows where the round actually was. It is an ARRAY: a round crosses everything in
its path, so a shot along a frontage breaks several bays at once and they share
a direction by construction. `at` is the FIRST crossing, so the panes behind it
throw their glass from a point a few metres off — a wrongness measured in metres,
on an effect lasting a second and a half, against a message per pane.

**A joiner is caught up by STATE, and it is the `scores` argument again.**
Broken glass is cumulative and permanent within a round, so a client five
minutes late has missed every event and would see intact shopfronts the rest of
the match walks through. `Welcome.brokenPanes` is the list, omitted when
empty, and deliberately NOT on `RoundStart` — a rotation rebuilds the map and
puts every pane back, so the empty list is the only correct answer there and
saying nothing is how it is said.

**`NetSession.brokenPanes` is the running list for the whole round, not a
snapshot of the welcome**, and that closes a real race. `?mp` books the round
before the socket is open, so the welcome and `buildRound` arrive in either
order — and every `installMap` resets `GlassSystem`, because a fresh build puts
every pane back. An event landing in the gap was applied to a map about to be
replaced and then lost, which is a client showing intact windows with nothing
wrong anywhere. Every `glass` event appends to that list as well as being shown,
`Game.buildRound` and `onSeated` both call `GlassSystem.catchUp`, and `catchUp`
is idempotent — so exactly one of the two does the work and neither has to know
which. Measured before the fix: two clients in one match disagreeing by fourteen
panes.

## Grenades

Ballistics and damage are the server's; the dust is not. `GrenadeSystem` takes
`{ dust: false }` there, because `BlastDust` builds a `DynamicTexture` and a
`GPUParticleSystem` and neither exists without GL. Everything else in that file
is spheres and materials, which are inert without a renderer.

The pouch is the server's count. There is no resupply in this game — death is
the only refill — so the ammunition IS the limit, and a client tracking its own
would throw as many as it liked.

**A grenade in the air is STATE on the wire, not a throw announced once.** It is
the only object in this game that takes seconds to arrive, and it is the one a
player is owed the sight of: an explosion that appears with no warning is a
different game from one you watched bounce off a wall toward you. So every live
flight rides the snapshot — `Snapshot.grenades`, a `GrenadeState` per grenade,
attached only on the ticks something is flying — and every client interpolates
it on exactly the clock the bodies are drawn on.

Announcing the throw instead and re-simulating it on each client is the design
that does not work, and it fails for a reason worth stating: the flight is
integrated per frame against a frame time nobody shares, and a bounce
multiplies that disagreement rather than damping it. The grenade would come to
rest at your feet on your screen and go off three metres away, because the
blast is the authority's and always has been. Sixteen ballistic solves off one
message is also sixteen chances for one of them to be somewhere no client can
correct.

**The thrower draws their own and the wire's copy of it is skipped**, which is
what `GrenadeState.by` is for. `Game.releaseGrenade` puts a real grenade in the
local `GrenadeSystem` on the frame the hand opens — that is what the thrower
watches arc, with no round trip in it — and the authority's copy of the same
throw comes back a round trip later with their slot on it. Drawing both is two
grenades for one throw. It is the same skip `NetRoster` makes for the local
player's own body, for the same reason and at the same seam.

**Everybody else's are `net/NetGrenades`**, which is `NetSoldier`'s job done
for the one thing on the map that is not a body: a fixed pool the size of the
authority's own, one interpolation buffer per flight, and no ballistics at all.
Two details in it are load-bearing.

- **A flight is named by a monotonic id, never by a pool slot.** A slot is
  reclaimed the instant the grenade in it went off, so a client keying on the
  index takes the next grenade's samples as a continuation of the last one's
  and draws a streak from the detonation to somebody's hand. `GrenadeSystem`
  stamps `Grenade.id` at the throw and never reuses one.
- **A ghost is shown on the frame it is POSED, not the frame it is claimed.**
  The claim happens on a socket callback and the pose on the next frame, so a
  mesh shown at the claim is drawn once at wherever the pool last left it — the
  origin for a slot nobody has used, and the previous grenade's detonation
  point for one that has. Measured in a browser against a live match: every
  first-drawn position was a metre or two off a hand before the fix and the
  map's origin or a dead grenade's grave before it.

A flight that stops appearing in snapshots has gone off, and it is hidden on
the snapshot that drops it rather than played out to the end of its buffer.
`Match` flushes the `explode` event on the same broadcast, so the two arrive
together and the grenade vanishes on the frame the fireball appears. The cost
is the last `interpDelay` of arc, which is nothing for the ordinary detonation
— a grenade that has already come to rest — and a stride for one caught still
bouncing. Playing the tail out instead would draw a grenade flying through the
middle of its own explosion.

## Armour, and the one other thing a person can be inside

Hulls, mines and rockets cross the wire, and the whole design is one sentence:
**the person driving a tank is trusted about it exactly as far as a person
walking is trusted about their own legs, and about nothing else.** The full
argument is in [`docs/vehicles.md`](vehicles.md) under "Armour in a match"; what
belongs here is the wire's half of it.

`PROTOCOL_VERSION` went to 4 for this, and it is worth being clear about why,
because every field added was additive in the ordinary sense. A version-3
client would ignore `Snapshot.vehicles`, draw no hulls and send no `mount` —
and what it would be ignoring is a seven-metre SOLID object the authority is
driving across the map, shooting people with, and stopping rounds on. It would
be killed by a shell out of an empty street and watch its own bullets stop in
mid-air. That is not a degraded picture, it is a different game, so the
handshake refuses it.

**What travels, and on which channel, is decided by how often it CHANGES**, and
armour needed all three answers this protocol already has:

| | shape | cadence | why |
| --- | --- | --- | --- |
| hulls | `Snapshot.vehicles` | every snapshot, whole | a driven one changes every tick, and a map states two |
| rockets | `Snapshot.rockets` | every snapshot, absent when empty | `GrenadeState`'s case exactly — it takes a second and a half to arrive |
| mines | `MinesMessage` | when the SET changes | a mine never moves; twenty copies a second of an unchanging table is the one shape this wire should not take |

The mine table is `ScoresMessage`'s trade made again, down to the version
counter (`AntiTankSystem.version`) and to being sent WHOLE: a dropped message
is corrected by the next one, and a client joining mid-round is right on
arrival rather than blind to every mine laid before it connected — which on
that particular object is not a cosmetic difference.

**A driver reports a HULL instead of a body.** `DriveMessage` replaces
`MoveMessage` for as long as the seat is held, because a driver has no body of
their own to report: the tank carries them, and both sides slave
`Player.position` / `NetPlayer.position` to it. `Match.onMove` refuses a seated
player for exactly that reason, and `onShot` and `onGrenade` refuse one for a
plainer one — there is no rifle in a driver's hands.

**`validateDrive` is the speed bound that knows what a player is sitting in.**
Running a tank through `validateMove` would reject every honest driver at a
stroke: the bound there is a sprint and a hull at road speed covers three times
it. What it keeps is the speed and the map's extent; what it drops is the
ground test (the authority stands the reported hull on its own ten track
contacts, so a claimed height is never taken) and the solid test (a hull
legitimately stands inside `map.obstacles` — it drives OVER what a body walks
around). A refused step is not corrected, either: a `correct` message moves the
local BODY, and a client told to put its feet somewhere while nothing is said
about its tank is worse off than one whose report was simply not applied.

**Getting in and getting out are asks the authority answers.** `mount` names a
hardstanding and `HeadlessGame.seatOffered` re-derives the whole offer against
its own copy of the hull, the team, the distance and the crew; `dismount` names
nothing, because the server knows which seat a peer is in. Both are answered
with a `seat` event addressed to the asker — including a refusal, which answers
"you are on foot", and including the seat change nobody asked for, which is the
hull burning underneath them. Where a dismount lands rides on that event: a
client could compute it, but it is a POSITION, and a position is the
authority's for the reason a spawn's is.

**Occupancy is stated once, on the hull.** `VehicleState.by` answers both
questions a client has — may I get into that one, and is the man in that slot
drawn standing up — and carrying it on `EntityState` as well would be two
copies of one fact with the stale one deciding whether a body is on screen.
`NetRoster.setRiding` also takes a riding body out of `hittablesAgainst`, for
the reason a mounted player is invulnerable: the tank is what is being shot at,
and a soldier left in the list would stop every predicted round on an invisible
man at the hull's centre.

**One health on the wire is public, and it is the hull's.** `damage` is
addressed to its victim because knowing who is hurt is the read a wallhack
wants; `VehicleState.hp` is broadcast because everybody can already see the
tank burning, it is the gauge on the driver's own HUD, and how many more
rockets it will take is a decision the fight is supposed to be able to make.

**The shell and the AT kit are re-resolved, never trusted.** `ShellMessage`
takes `onShot`'s three gates and then uses none of the claim — the round goes
down the authority's own gun, from its own muzzle, at its own reload — and its
cone is measured against the driver's reported LOOK rather than the gun,
because the gun's bearing is the thing being claimed. `OrdnanceMessage` is ONE
ask for both AT items, because the third slot is one slot and which item is in
it is a fact the server already holds off `Join.equipment`; the pouch is the
server's count exactly as the grenade pouch is.

**What a client predicts, and what it does not, is decided per object.** A
rocket is predicted (a warhead appearing six metres downrange a round trip
later reads as a misfire) and a mine is not (it is laid at the feet and never
moves, so the trip is invisible and a local copy would be a second plate to
reconcile). A shell's tracer is predicted and its BLAST is not, which is where
it parts company with a thrown grenade: a grenade's local copy goes off within
centimetres of the authority's, and a shell's would go off wherever this
client's own ray happened to land — a body the server rewound elsewhere, a pane
it has already broken — which can be a street away.

**`explode` carries a `power` now.** It is the only field on that event that
says what went off, and absent still reads as 1 — which is what every server
before armour meant by it, and what the only blast in the game then was.

## The lobby, and why there is no central registry

**The registry in `server/index.ts` IS the lobby.** Matches live in that
process's memory, so the list it serves on `GET /matches` is authoritative for
itself: there is nothing for a match server to check in WITH, because it already
knows everything there is to know about the only matches anyone can ask it for.
A master server — the thing dedicated servers heartbeat into so clients can be
handed a list of addresses — solves a problem this deployment does not have, and
building one would be a second source of truth about matches that one process
owns.

**That survived a second server, which is the part worth understanding.** There
are regions now, and there is still nothing central: what a master server would
have held is a list of ADDRESSES, and a deployment already knows its own
addresses — so the client is handed them in a file (`public/regions.json`) and
asks each server directly. Every server is still the only authority on its own
matches, nothing has to be kept in step, and a region that is down is a row that
says so rather than a registry serving stale rows about it. See the section
below.

The ceiling that made a second process necessary is CPU: Node is
single-threaded, so every match in a process shares one core. `MAX_MATCHES`
(env, default 4) is what bounds it, and it exists so that "New match" is a safe
button — a create path with nothing behind it is a way for anyone to spend the
server's memory from a menu.

Three pieces, and the shape is the same one every screen here follows:

- **`GET /matches`** returns a `MatchList`: the protocol version, whether the
  server will create any more, and a `MatchSummary` per match. The version is on
  it because this is the FIRST thing a client asks, so it is the cheapest place
  to find out the server is running a newer build.
- **`Join.matchId`** names a match, and a named match is **never substituted**.
  A peer that asked for `m3` and could be seated in `m4` is refused with a reason
  rather than moved, because it picked that row for something on it and being
  quietly relocated is indistinguishable from the lobby being wrong. An UNNAMED
  join still fills whatever has room — that is `?mp` and every client that
  predates this, neither of which expressed a preference to betray.
- **`LobbyScreen`** renders what `Game` hands it and fetches nothing, the split
  `SettingsScreen` already keeps.

**The reconnect is why `Connection.pinMatch` exists.** A retry re-sends the
original join, so a client that opened with `create: true` would stand up a NEW
match on every dropped socket — abandoning the one it was playing in and walking
through the match cap in a bad minute. `NetSession` reads the match out of the
welcome and pins the connection to it, which also turns a reconnect into a real
rejoin rather than a fresh roll of the dice.

**The name is the one client string other people's screens render**, so it is
bounded on arrival (`cleanName` in `Match.ts`) exactly as the weapon id is
resolved there: truncated to `MAX_NAME_LENGTH`, stripped of the control
characters that hide the rest of a string, and never escaped — escaping belongs
to whatever renders it, and every screen writes a name with `textContent`.

### Regions: the client holds the list, and every server still speaks for itself

**A region is a match server with a hostname, and the client is told about it in
a file.** `public/regions.json` names each one — an id, a short display name, and
the match server's HOST — and `net/regions.ts` reads it once per page and turns
each entry into a resolved `Region`. It is a deploy-time file rather than a table
in the bundle because a region's address is a fact about where the game is
hosted, not a constant about how it plays: adding one, moving one, or taking an
unhealthy one out of the list is then editing a file on the box rather than
shipping a build, which matters most in exactly the case you would least like to
be slow about.

**A `Region` carries BOTH of its urls, resolved together, and that is the whole
of the old `Game.netUrl` invariant.** The socket and the match list are proxied
independently and agree only by convention, so both are named outright from the
host (`wss://host/ws`, `https://host/matches`) in one function. Nothing
downstream derives one from the other, and nothing else holds an address —
which is what keeps "the list I am reading" and "the server I am joining" the
same machine. The SCHEME is the page's, never the file's: an entry states an
authority and nothing more, so a file cannot ask an https page to open a plain
socket (the browser would refuse it as mixed content, and the failure would
arrive as a socket that closes with nothing in it).

**A match id is minted per process, so a row is a REGION and an id.** Every
region has an `m1`; an id alone would send a join to whichever server the client
last spoke to, which would usually find a match of that name and drop the player
into a completely different round on another continent. `LobbyScreen` carries the
region on every row, `onJoin` passes it to `joinMatch`, `sameRow` compares it,
and the "joining" highlight matches on both. `RegionBook.resolve` is the single
funnel: a row's own region, else the standing pick, else the first the file
names.

**The ping is the list fetch, and there is no second endpoint.** Every region is
asked on every refresh, the requests go out together and each row lands when it
lands — so the screen shows what each server is running and how far away it is
from one round trip, and a region that is down costs the others nothing but its
own timeout. Two details are load-bearing and both are about not lying:

- **`timing-allow-origin: *` on `/matches`.** The reading is the transport's own
  `responseStart - requestStart`, which excludes the DNS, TCP and TLS that a
  first request pays for — and cross-origin a browser zeroes those fields unless
  the server allows the reading. A region is by definition cross-origin, so
  without that header every server a player has not fetched from yet reads as
  slower than it is, on the one screen built for comparing them.
- **The resource timing buffer holds 250 entries and then silently stops
  recording**, and a page that has loaded a game spent them all long before the
  lobby opened — the bundle's chunks, the textures, and on an installed build
  the service worker's `cache.addAll` over the whole precache. So the reading
  falls through to a wall clock that measures how busy the main thread was.
  `clearRequestTimings` is called once before each fan-out (once, not per
  request — the regions are asked together, and a clear inside each would drop
  whichever answered first). Measured headless: 683 ms reported for a 3 ms round
  trip to localhost.

**The chosen region is a preference, and not choosing is the interesting case.**
`readRegion`/`writeRegion` remember a pick exactly as the map is remembered.
Nothing remembered means the fastest region that ANSWERS is preselected, on every
visit, and the moment the player steps that row it becomes their pick and is
never moved for them again — `RegionBook.note` is the one place that
distinction is spent, and it deliberately does not persist what it chooses,
because being seated somewhere by a measurement is not a decision to remember.

**All of that lives in `net/RegionBook.ts` and none of it in `Game`.** The list,
the one read of it, the player's pick, the automatic one, the pings it ranks by
and a `?server=` override are a cluster that answers only to itself — no system,
no mesh, no frame — which is what let it out of the orchestrator when the
netplay wiring beside it may not go. Two halves stay behind on purpose, and they
are the two the book is not allowed to do: `writeRegion` is `prefs.ts`'s to
store and `Game.setRegion`'s to spend, and every push at `LobbyScreen` is made
from `Game`. So `choose` and `note` HAND BACK the row to light up rather than
lighting it — a book that could draw would be a second thing writing that
screen, and the screen's whole rule is that it never writes its own state.

**The region row is what a match this client CREATES goes in, and nothing more**
— the same relationship the Map row has to `Join.map`. Joining a listed match
plays where that match is running and does not move the pick, because a round
somebody else started says nothing about where this player wants to start one.

**One region collapses the screen to what it was.** The region column, the ping
column and the region row appear only when the file names more than one, so an
untouched `regions.json` — a single-box deployment, and every dev client running
`?server=` — gets the three-column lobby with one reading on its status line,
which is the screen this all replaced.

**What regions do NOT buy is two processes behind one hostname.** That is still
the thing that would break: matches live in memory, so a load balancer in front
of two match servers puts players who joined "the same" match into two different
worlds, and each replica would serve its own half of `/matches` as though it were
all of them. A region is the opposite arrangement — one hostname, one process,
and the client choosing between hostnames — which is why it needs no registry
and no shared state at all.

### The map belongs to the match, and a client never picks it

**A match is played on the map the authority is running, and joining one takes
that map whatever the menu had selected.** This is not a preference the client
gets to hold: the world is built LOCALLY on both sides and no geometry crosses
the wire, so a client on a different map is not playing the same game — its
walls, its flags and its spawns are somewhere else, and every position that
arrives is nonsense in the world it is drawn into. It read exactly like a
multiplayer bug of the ordinary kind: pick Greyfen in the menu, join a match
running Hollowmere, and the round comes up in Greyfen with bodies walking
through hillsides.

The map is stated in the `welcome` and again in every `roundstart`, and
`Game.applyMatchMap` is the single funnel that spends either. It answers three
things, because there are three:

- **`same`** — the ordinary case, and what the lobby's row buys. `LobbyScreen`
  hands the row's `mapId` down with its id (`onJoin`), so `joinMatch` applies it
  BEFORE booking the round and the first build is already the right world.
- **`changed`** — the caller owes a build, and there are three callers.
  `buildRound` reads it when the welcome beat the build (the same two-sided race
  the team has, and settled the same way); `NetSession.onSeated` rebuilds when
  the welcome lost, which is an unnamed `?mp` join or a match that rotated
  between the list and the pick; `onRoundStart` rebuilds on every rotation.
- **`unknown`** — an id this build does not have, from a server one version
  ahead. There is no world to build, so there is no round to play: the session is
  dropped and the player is put back in the lobby with the reason, the same three
  moves a `rejected` makes.

**Rotation was the case that proved the rule was missing.** The client used to
route it through `Game.setMap`, which refuses to run outside the menu — and a
rotation arrives in `roundover`, so *every* map change on the server left the
client rebuilding the map it was already on. `applyMatchMap` may write `mapDef`
from any state precisely because every caller builds within the same frame;
`setMap` keeps the menu guard, because it is the player choosing.

**`setMap` is the PREFERENCE and is remembered; a match's map is neither.**
Nothing on the netplay path calls `writeMap`, and `enterMenu` puts `mapDef` back
to `readMap()` on the way out of a match — so the menu offers what you chose,
not the map of whatever round you last dropped into.

**Creating a match is the one join that carries a map**, as `Join.map`. It is a
REQUEST: the server spends it only on a match this join actually builds (both
create paths in `routeJoin`, including the fallthrough where nothing had room)
and ignores it entirely when the peer lands in an existing match — a preference
cannot move a round sixteen people are already standing in. `Match`'s constructor
resolves it against the real `MAPS` table exactly as `admit` resolves the weapon
id, so an unknown id falls back to the default rather than standing up a match
naming a world the server does not have. Additive on the wire: a client that
sends no `map` gets the default, which is what every client got before the field
existed. The lobby's own Map row is where a player sets it, and it is the same
pick the menu shows — one choice, two places it is on screen.

## A match builds one world, and every guard for it sits behind an await

**`Match` does asynchronous work — building a world — while sockets keep
arriving and rounds keep ending.** That is the one seam in the server where two
things genuinely happen at once, and every rule here exists because a test
written on the near side of an `await` and acted on from the far side is not a
guard: the loop turns in between, and whoever else is waiting runs the same test
against the same unchanged state.

**`ensureRunning` hands every concurrent caller the SAME promise, and must go on
doing so.** It is deliberately not `async`: an async wrapper around the same body
gives each caller a fresh promise over a fresh build, which is the thing it
exists to prevent. Two peers landing in an empty match inside the build — one
lobby row two people click on, or a restart everybody reconnects to — each found
`timer` and `map` null and each went on to build a world and start a loop over
it. The failure is not a match that runs slowly: the second assignment to
`timer` orphans the first interval, so `stop` can never clear it, the match
steps twice per tick for the rest of its life, and the orphan goes on calling
`step` after `retire` has disposed the scene — a throw inside a timer callback,
which takes every other match in the process down with it. `starting` is cleared
in a `finally`, so a build that FAILED is retried by the next arrival rather
than remembered as permanently in progress.

**`admit` asks whether its peer is still connected on the far side of the
await.** The socket's `close` handler is wired before the build, so a peer that
drops during one has already been through `drop`, which released its roster slot
and put the bot back — and seating it anyway puts a `NetPlayer` nobody owns into
`players` and into the rewind history, with the bot in that slot benched for the
life of the match. Nothing can ever remove either, because the removal has been
and gone. The peer map is the test, because that map is what `drop` empties and
what everything else in the file reads to mean "still connected".

**`rotating` is what says the world is not the match's to touch**, and it gates
`step` as well as the three client messages that reach into it — `move`, `shot`
and `grenade`. For the length of `rotate`'s rebuild, `HeadlessGame.map` points
at the map `startRound` has already disposed. That has never crashed, and the
reason is worth naming rather than resting on: `conquest.winner` is still set
from the round that ended, so the step returns before it reaches `battle` — a
safety that holds only while a second flag agrees with the first, and that ends
the day anything resets `winner` earlier. `deploy` is deliberately not gated. It
touches no geometry, it writes an integer a later tick spends, and refusing it
would drop a request the client has no reason to send twice.

**A rotation that throws abandons the match rather than freezing it.** That gate
makes `rotating` load-bearing in both directions, since only a completed
rotation clears it: an unhandled build failure would leave sixteen people in a
round that renders and never advances, and an unhandled rejection out of a
`setTimeout` would take the process. `abandon` closes every socket with a reason
instead, and each client's own reconnect puts it in a fresh match a second
later — which is honest, where a live-looking round that never moves is
indistinguishable from a server gone quiet.

**None of this reproduces against the server as it stands, and that is the
reason to write it down rather than to relax about it.** The only yield between
`admit` and its guards is the collision module's dynamic `import()`, which does
not reliably turn the I/O phase, so neither race fires on the build path today;
both were confirmed by forcing the window open with a temporary await inside
`buildServerWorld`, which produced two worlds and a match running at 120.8 ticks
a second, and a peer seated into a slot its own departure had already released.
**Anything that adds a genuinely asynchronous step to a build — a larger map, a
bake read off disk, a fetch — opens that window for free**, and these rules are
what stop it being rediscovered from the symptoms.

## What a socket may SAY, before any handler reads it

**`decode` is not a validator and the `ClientMessage` type is not a fact.** It
answers "is this JSON with a string `t` on it" and then asserts the result to
the union, so every field a handler reads off a client message is a field a
socket chose — the same thing `cleanName`'s `typeof` guard says about a name,
generalised to the whole protocol. `server/wire.ts` is where that is made true
instead of assumed, and **it is the only thing on the server that turns a frame
into a `ClientMessage`**: both callers — the handshake and `Match`'s per-peer
listener — go through `readClientMessage`, so a handler past it can destructure
a `Vec3` without asking, and a fifth message type added to the protocol owes an
arm in that switch rather than a check in its own handler.

**A missing array was a remote kill switch for the whole process.** `onMove`,
`onShot` and `onGrenade` each destructure a `Vec3` straight off the message, and
destructuring `undefined` THROWS — out of the socket's `message` listener,
through ws's receiver, and out of the process, taking every other match in it
down mid-round. `{"t":"move"}` is thirty bytes and needs nothing but a seat.
Only reachable once alive, which is what kept it hidden: a freshly joined player
is dead and all three handlers return early, so it never fires in ordinary
testing. With `restart: unless-stopped` in front of it the result is not an
outage but a repeatable one — one message every few seconds holds the server
down for as long as somebody cares to.

**A non-numeric field was worse, because nothing refused it.** `pos:
["x","y","z"]` passes the whole of `validate.ts`: every test there is a
comparison and every comparison against `NaN` is false, so speed, bounds, ground
and solid all fall through, no `correct` is sent, and the strings are broadcast
to all sixteen clients. It bypasses the shot origin gate for the same reason —
`Math.hypot(NaN, ...) > MAX_ORIGIN_SLIP` is false — so a client that has
poisoned its own position fires accepted rounds from anywhere on the map.
**`Number.isFinite` and never the global `isFinite`**, which coerces: `"3"` is
finite to the global, which would leave the gate open to exactly the strings it
was built to stop.

**The line is drawn at what can crash or poison arithmetic**, which is why that
file checks numbers and arrays and leaves the strings and the booleans alone.
Those already have doors, and a second opinion beside a rule with one owner is
how the two drift: `cleanName` bounds the name, `weaponSetup` and the `MAPS`
lookup resolve an id against a real table, and `crouching`/`sprinting` are only
ever read as the condition of a ternary, so nothing a socket puts in either
reaches arithmetic at all.

**A malformed message is dropped silently and the peer is not punished.** The
token bucket has already charged for the frame, so a flood of unparseable bytes
costs this thread what a flood of `move` does and is closed out by the same
rule — while a log line per bad message hands any socket an unbounded write to
the server's stdout.

**Under all of it, `server/index.ts` installs an `uncaughtException` and
`unhandledRejection` backstop, and it is not a substitute for a single check
above.** Every throw it catches is a bug with a real fix elsewhere; what it
bounds is the blast radius of the next one, because Node's default is to exit
and since 15.x an unhandled rejection is an uncaught exception — so one bad
frame from one socket, or one rejected promise in one timer, drops every match
in the process. It logs loudly rather than swallowing: a server that survives
these quietly is one where the next bug of this shape is invisible.

## What a socket may spend before it has proved anything

**One core runs every match on the box**, which is the sentence the whole of
this section follows from: a connection that can make this thread work without
limit is not a problem for its own match, it is a problem for all four. So
everything an unproven socket can spend is bounded, and the bounds live where
the socket does — `server/index.ts` for the anonymous half, `Match` for the
seated one. They read as a list of unrelated small rules and they are not: each
one is a different way of asking the same question, which is what this
connection can cost before it has proved it is a player.

**Every socket gets an `error` listener the instant it connects, and this one
is not a bound but a crash.** A `ws` WebSocket is an EventEmitter, so an
`error` with no listener is *thrown* — out of ws's own callback, taking the
process and every match in it. `Match.admit` wires one, but an anonymous socket
never reaches `admit`, so until it joined there was nothing listening: one
malformed frame — `RSV1 must be clear`, six bytes, no handshake needed beyond
the upgrade — killed the server. Confirmed by repro against the old listener
set, and against the current one, which survives it. ws raises that event for
an oversized frame (1009), a malformed one and a reset connection alike, and
`close` follows every one of them, so the listener has nothing to do except
exist.

**`maxPayload` is 4 KB, against ws's default of 100 MB.** The largest message
in this protocol is a `join` carrying a display name and the most frequent is a
movement sample of a couple of hundred bytes, so the default is not a generous
ceiling, it is an invitation: buffer a hundred megabytes and hand it to
`JSON.parse`, from a socket that has not yet said who it is. A name longer than
the frame limit takes the socket rather than being truncated, and that is the
right way round — `cleanName` bounds what a name may *contain*, and a kilobyte
of one is not a name that got away from somebody.

**An anonymous socket is on a ten-second clock.** A client sends `join` from
its own `open` handler, so the honest case is one round trip; what the clock
bounds is the socket that connects and then says nothing, which holds no slot
and no match and is therefore the cheapest thing there is to hold open in bulk.
Nothing else in the process would ever close it. The timer is cleared by the
join and by the close, and a socket that got through the handshake is never
touched by it.

**The handshake listener is removed on the way through, not merely stood
down.** It used to fall through its own `if (!joined)` guard, which meant every
`move` and every `shot` for the life of a connection was decoded twice: once
there to discover it was not a `join`, and once by the handler that acts on it.

**A seated peer has an inbound message allowance, and `onShot`'s rate limit was
never it.** A weapon's rate of fire bounds the rounds a client may fire; it says
nothing about how fast the socket may talk, and `move` had no bound at all —
which is the expensive one, because `onMove` spends a nav-graph lookup and an
obstacle resolve per sample and answers a rejected one with a `correct` message
BACK, so an unbounded inbound rate was an unbounded outbound rate too. The
allowance is a token bucket at `(INPUT_HZ + fastest weapon's fireRate) × 2` a
second with a second's worth of burst, and both halves are DERIVED — a weapon
added at thirty rounds a second must not make everyone carrying it look like a
flooder. It is charged per MESSAGE rather than per kind, because what is being
bounded is the socket: the parse comes first, the type is not known until after
it, and a flood of unparseable bytes costs this thread exactly what a flood of
`move` does. The per-kind gates downstream are about the game and all still
apply.

**Over-budget drops the message; five seconds of over-budget drops the peer.**
The ordinary cause of a burst is a connection that bunched rather than a client
misbehaving, and a laggy player who loses a movement sample loses nothing the
next one does not correct — so debt is allowed to accumulate rather than being
clamped at zero, which is what makes "over for a moment" and "over for five
seconds" different states instead of the same one. A peer that reaches the debt
limit is told why, closed, and `drop`ped by hand rather than left to its own
`close` — that arrives a turn later, and until it does every buffered message
comes back through the same door and is refused and logged again.

**The per-address cap counts sockets, defaults to 16, and keys on what a
trusted proxy says.** A forwarded header (`x-real-ip`, then the first
`x-forwarded-for` entry) is read only when the socket's own peer is loopback or
a private address — which is every deployment described here, since the shipped
compose file puts nginx and this process on one bridge network and an edge proxy
reaches it over 127.0.0.1. A socket arriving from a *public* address is a
browser talking to this port directly, and a browser's own claim about where it
is is worth nothing. `TRUST_PROXY=1`/`0` forces the question for a proxy that
is not on this machine. **The cap is the one bound here that can be turned into
a bug by a misconfiguration**: behind a proxy that forwards no client address
at all, every player is one key and the seventeenth is refused — so both
headers are set in `docker/default.conf.template` off an address that survived
TWO proxies (see the edge-proxy block at the bottom of this document, which is
the half that is easy to get wrong), the refusal names the address it counted,
and `MAX_SOCKETS_PER_IP=0` turns it off outright.

**Counts from the environment go through `envCount`.** `Number(process.env.X ??
4)` reads `MAX_MATCHES=four` as `NaN`, and every comparison against `NaN` is
false — so a typo in a compose file does not fall back to the default, it
deletes the cap and leaves a server that builds matches until it runs out of
memory. A bound a typo can delete is not a bound.

### The pong deadline, which is the one thing here that is not about spending

**Every open socket is pinged every fifteen seconds and terminated on the sweep
after the one it did not answer**, so a connection has between one and two
intervals to prove it is still there. Everything else in this section bounds
what a socket may *cost*; this is the only thing that notices a socket that has
stopped existing without saying so.

**Nothing else ever would.** A slot is released by `Match.drop`, which runs off
the socket's `close` or `error`, and both of those need the far end or the
kernel to speak. A laptop lid, a phone leaving wifi, a NAT that dropped the
mapping: none of them says anything at all, and what eventually notices is TCP
keepalive, which Node leaves at the OS default — **two hours** on Linux before
the first probe. Until then that peer's roster slot is held, the bot that would
have backfilled it stays benched (so its team plays the round with a statue in
it), `HeadlessGame` keeps a `NetPlayer` nobody owns in the rewind history, and
the socket counts against `MAX_SOCKETS_PER_IP` for the very address the player
is reconnecting from. `IDLE_DISPOSE_MS` does not help: the match is not idle,
it has a peer in it as far as anything there can tell.

**It is one timer for the process, and deliberately not split the way the
bounds above are.** Those live half in `server/index.ts` and half in `Match`
because an anonymous socket and a seated one can spend different things; a dead
connection is the same dead connection either side of the handshake, and
`wss.clients` is the only place that holds every socket in the process. What
terminating one releases *is* split, and needs no new code on either side: the
roster slot goes back through `Match.drop`, already wired to `close`, and the
per-address quota through the `close` handler that charged it.
**`terminate`, not `close`** — `close` opens a handshake with a far end that has
just proved it is not answering, and ws would hold the socket for its own
thirty-second closing timeout before destroying it anyway.

**The client owes nothing, and could not help if it wanted to.** Browser
JavaScript cannot send a ping frame or write a pong; the browser answers below
the page, which is what makes this the one liveness mechanism that needed
neither a protocol version nor a line in `src/net/`.

**What the deadline actually measures is whether the far end is still READING
its socket**, and that is worth knowing exactly, because the obvious guess —
"a pong comes from the network stack, so anything short of an unplugged cable
answers it" — is only half true. Measured against headless Chromium, with a
bare ws server pinging every three seconds and the page's main thread blocked
solid for twenty:

| the page's socket | pongs during the block |
| --- | --- |
| quiet (no data frames) | every one, on time |
| fed 20 messages a second | on time until ~17 s in, then none until the block ended |

So Chromium does answer from its network service — but only while the renderer
is draining the pipe. A page that has stopped consuming back-pressures the
read, the ping is never taken off the wire, and nothing answers it. A match
socket carries twenty snapshots a second, so "stopped consuming" arrives within
seconds of the page stalling: a real client blocked for thirty-five seconds
against this server was dropped, and a client left alone rode out four sweeps
untouched.

That is the right question rather than a compromise on it. A client that is not
reading snapshots is not drawing the round, whoever is at fault; a client that
is merely paused, hidden or unfocused keeps reading, because `Game` steps the
netplay frame under every lid (see "Pausing" in `CLAUDE.md`) and even a client
that did not would still drain its socket. Fifteen seconds is picked against
that: it is far past any hitch a page recovers from and far short of the two
hours the alternative costs.

## What is not built yet

Stated so nobody assumes otherwise:

- **Choosing your name.** It is `?name=` and a default, because the menu has no
  text entry anywhere in it: a focused input has to be kept from feeding the
  game's own key handling, and neither that nor a pad path exists. `Game.playerName`
  is where it lands.
- **A muzzle flash on somebody else's weapon.** The `fire` event is enough to
  hear a shot and to light the minimap with it, and `EntityState.fired` is
  still the unspent field a remote flash would ride — but a flash is a light
  and a pose on a rig that is drawn `interpDelay` behind the event, so it is a
  question about which clock it belongs on rather than about the wire.
- **Reconnect into your own slot.** A dropped player rejoins as a new peer and
  takes whatever slot is free — on either team, and into a body that is dead
  until it asks, which is why the deploy screen goes back up on a re-seat. The
  match keeps its world for a minute, so the round survives; the seat is not
  reserved, and neither is the position you were standing in.
- **A kill ASSIST.** The board pays the body that landed the last round and
  nothing to whoever put the first eighty damage into it, which is the one part
  of Battlefield's scoring the score system deliberately left out. It is not a
  wire question: `Hittable.takeDamage` takes an amount and an origin and never
  the shooter, so crediting an assist means threading an attacker through the
  hottest path in the game and keeping a per-victim damage ledger that a respawn
  has to clear. Worth doing, and worth doing as its own change.
- **Moving a player between regions, or matching them across regions.** A region
  is chosen before the socket opens and holds for the round: there is no "your
  friends are in US East, come over", no cross-region party, and nothing that
  looks at the two lists together and suggests one. The lobby shows both and the
  player decides.
- **Two match server processes behind ONE hostname.** Regions did not make this
  work and were the way around it — see "Regions" above. Matches live in memory,
  so two replicas behind one proxy put players who joined "the same" match into
  two different worlds, and each would serve its own half of `/matches` as
  though it were all of them. The fix for THAT is a central registry; the fix
  for capacity is another region, or a bigger `MAX_MATCHES` on a bigger box.

## Deploying it

`docker compose up --build` is the whole of it on a development machine: `web`
is nginx serving `dist/` and `match-server` is this process, deliberately
unpublished so the only route in is the proxy. On a server,
`docker-compose.prod.yml` is the same two services from the images CI pushes —
`ghcr.io/greywatch-game/greywatch` and `ghcr.io/greywatch-game/greywatch-server`,
**two images from one Dockerfile, and the workflow needs `target:` on each**;
without it Docker builds the last stage in the file, which is `web`, and the
server image silently never exists.

**The registry is GHCR, which is why the workflow holds no credential**:
`GITHUB_TOKEN` and `packages: write` are the whole of the push, so there is
nothing to rotate and nothing to leak. The price is paid once, by hand, and it is
the thing most likely to make a first deploy fail: **a GHCR package is created
PRIVATE even from a public repository**, so until each of the two is set Public
in its own package settings, `docker compose -f docker-compose.prod.yml pull`
answers `denied` — which reads like a misspelt image name rather than a
permission, and which fails on every region box as well, since each one pulls
both images for itself. Kept private on purpose, the alternative is a
`read:packages` token and a `docker login ghcr.io` on every box, forever.

**Both `/ws` and `/matches` need a `location` block** — anything nginx does not
name falls through to the static root and comes back as a 404, and that failure
is a nasty one because the lobby works perfectly against `npm run server` on a
dev machine, where the client reaches the match server directly and nginx is not
in the picture at all.

### A second region is the same deployment, again, with a name of its own

**There is no separate "region build" and no region-aware server.** A region is
this same pair of containers on a box in that region, behind a hostname that
resolves there. Nothing in `server/` knows which region it is — it does not need
to, because a client picks a hostname and everything past that is one server
talking to the clients that chose it.

1. **Bring the stack up on the new box**, exactly as above. `MATCH_SERVER` and
   `MAX_MATCHES` are per-box settings; give a smaller box a smaller cap.
2. **Point a hostname at it and terminate TLS** — `us-east-1.example.com` — with
   the same `/ws` Upgrade forwarding the main domain needs. Everything under
   "the edge proxy" applies to every region host, because for the players who
   pick it, it *is* the edge.
3. **Add it to the `regions.json` on the box that serves the page**, with `host`
   set to that authority and no scheme:
   ```json
   {
     "regions": [
       { "id": "us-west-1", "name": "US West", "host": "us-west-1.example.com" },
       { "id": "us-east-1", "name": "US East", "host": "us-east-1.example.com" }
     ]
   }
   ```
   That file is `public/regions.json` in the tree and it is baked into the `web`
   image, which is why `docker-compose.prod.yml` **bind-mounts a copy from beside
   itself** over the built one: without the mount there is no box copy to edit,
   and an edit made inside the container dies on the next `pull && up -d`.
   **Create the file before the first `up`** — a bind mount whose source is
   missing makes Docker create a *directory* at that path, which is the one
   reliable way to make this URL fail. With the mount there, no rebuild: it is
   `no-cache` in nginx and network-only in the service worker, so an edit is live
   on the next page load. **Edit it, do not delete it** — it is in the precache
   manifest, and `cache.addAll` fails whole if any precached URL 404s, which
   would leave the worker unable to install at all.
4. **Serve the game from ONE of them.** It is static; the region hosts answer
   `/ws` and `/matches` and nothing about a region has to be the origin the page
   came from. A region that also serves the bundle (which the `web` container
   does anyway) is fine and costs nothing — the worked layout at the end of this
   section is exactly that. What the origin's hostname must not resolve to is
   more than one box, and that is what the layout is mostly about.

**The `/matches` response carries two headers a region depends on**, both from
`server/index.ts`, and an edge proxy that strips response headers will break the
lobby in two different ways: `access-control-allow-origin: *` (without it the
fetch is refused outright, and every region but the one serving the page reads as
unreachable) and `timing-allow-origin: *` (without it the fetch works but its
ping is inflated by a whole connection setup, which is worse — it is wrong rather
than absent).

**A region that goes down needs nothing done to it.** The lobby renders it as a
row that says so, the other regions are unaffected, and a player whose remembered
pick is the dead one is put back on it when it returns. Taking it out of
`regions.json` is for when it is going to stay down.

**The upstream must be reached through a VARIABLE, and this is not a style
choice.** A literal `proxy_pass http://match-server:8080` is resolved when nginx
loads its config, so a `web` container with no match server beside it does not
serve a 502 — it exits, with `host not found in upstream "match-server"`, and
takes the single-player game down with it. That is the deployment this repo had
for most of its life and the one every reader assumes still works. Through
`set $match_server "${MATCH_SERVER}"` the lookup moves to request time, which
is also what makes the address a deploy-time setting; a named upstream then
needs a `resolver`, and `docker/14-resolvers.envsh` is what fills one in with a
fallback so that no DNS is still not a config error.

**The edge proxy in front of the domain needs to know about the WebSocket.** A
site that has only ever served files has never had to forward an Upgrade, and
the symptom when it does not is a socket that opens and closes immediately with
nothing worth reading in it. For nginx:

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    # Which client this is. See below: this is the FIRST of two hops that has
    # to say so, and it is the one the other cannot work out for itself.
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 1h;
}
```

Caddy needs nothing said: `reverse_proxy 127.0.0.1:8080` carries WebSockets on
its own, and sets `X-Forwarded-For` without being asked. Measured on 2.11: a
browser that sends its own `X-Forwarded-For` has it REPLACED rather than
appended to, because the peer is not in `trusted_proxies`, so what arrives is
Caddy's own observation and not a value anyone chose. (A CDN in front of Caddy
is where `servers { trusted_proxies }` goes; nothing downstream of Caddy can
work that out.)

**What neither form gets for free is the SECOND hop, and it is the one that
eats the header.** The edge proxy forwards to the `web` container's published
port on the host's loopback, and Docker rewrites the source of that connection —
so inside that container `$remote_addr` is the bridge gateway for every player
on the box, and the `proxy_set_header X-Real-IP $remote_addr` on its way to the
match server would overwrite the edge's word with the gateway's. Measured
through the real chain, an edge that forwarded `203.0.113.9` reached the server
as `x-real-ip: 172.20.0.1` — a correctly configured edge proxy and a match
server that counts every player as one person. `docker/default.conf.template`
closes it with `real_ip_header X-Forwarded-For` over the private ranges, which
moves the forwarded address into `$remote_addr` itself; the two `proxy_pass`
blocks then send the browser's address without knowing anything changed, and
the access log stops naming the gateway too. **An edge proxy that sets only
`X-Real-IP` is therefore not enough** — that header is overwritten downstream,
and `X-Forwarded-For` is what the container reads.

**Capacity is one core per process, and it is not the constraint people expect.**
Measured on one container: four concurrent matches — sixty-four bodies, sixteen
of them under a nav graph and a think budget each — cost 13–25% of a core and
278 MB together; one match costs ~9% and 154 MB. `MAX_MATCHES` is what bounds
it, and the interesting limit is memory per match rather than CPU per tick.

In DEV the two are on different origins, which is what `?server=ws://host:port/ws`
is for and why `/matches` answers with `access-control-allow-origin: *`. The
list is public and read-only — it is the same information anyone gets by
connecting — so there is nothing there for an origin check to protect.

**A deploy that moves `PROTOCOL_VERSION` breaks returning players for exactly
one launch, and that is the service worker rather than a bug.** Caching is
cache-first, so a player who already has the app runs the PREVIOUS build once
while the new one installs behind them — against a server that has already
moved. They are refused at the handshake with the server's own words (`protocol
2 but this server speaks 3`), the lobby puts the reason on screen, and a reload
fixes it. Worth knowing before bumping the constant for something cosmetic;
worth saying out loud when you bump it for something real.

**The service worker will eat the lobby if it is let to.** In a deployed build
`/matches` is same-origin, `sw.js` is cache-first over everything same-origin,
and the Cache API ignores `no-store` on both the request and the response — so
the list is served from cache forever after the first fetch. `sw.js` exempts
`/matches` and `/health` by path. It reproduces on the live site only: there is
no worker in dev and none on a first load.

### Two boxes, one origin: the worked layout

**Every box runs BOTH containers, and which one serves the page is a DNS fact
rather than a different deployment.** `web` is not just the bundle — it is the
nginx that proxies `/ws` and `/matches` to the match server beside it, which is
published nowhere else — so a box that only hosts a region needs it exactly as
much as the box the page comes from. Two boxes, one in Oregon and one in
Virginia:

```
greywatch.example.com            → Oregon     the page, and regions.json
us-west-1.greywatch.example.com  → Oregon     same box, same two containers
us-east-1.greywatch.example.com  → Virginia
```

Oregon answers to two names and does double duty; Virginia serves a copy of the
bundle that nobody loads. That copy is not waste, it is the failover: if Oregon
goes down the origin's name moves to Virginia and the page is back, no image to
and nothing to rebuild. Which is the reason to mount `regions.json` on **both**
boxes even though only the origin one is ever asked for it — a failover should
not also be a hunt for what that file said.

**Point the origin hostname at ONE box, not at both.** Round-robin across the
two is the arrangement that suggests itself, and it costs three things that a
single origin simply does not have:

- **The fallback becomes the forbidden arrangement.** `loadRegions` answers
  every failure — a missing file, a half-edited one, a proxy that 200s the wrong
  thing — with `originRegion()`, which is this page's own origin for BOTH urls.
  Behind a round-robin origin that is two match servers behind one hostname: the
  lobby lists one box's matches and the join lands on the other's. It is the one
  case where a `regions.json` mistake gets *worse* instead of degrading.
- **Build skew during a rolling deploy.** A client can take `index.html` from one
  box and then ask the other for an `/assets/<hash>.js` it has not got yet. On a
  content-hashed URL that is a 404, so it fails `cache.addAll` too and the worker
  cannot install. It heals on the next load and it is still an evening.
- **ACME on a name with two A records.** An HTTP-01 challenge is validated
  against whichever address the CA picks, so a renewal driven from one box fails
  when the CA reaches the other. DNS-01 is the way around it; one origin is the
  way around needing DNS-01.

**Make the origin a CNAME to the region host it lives on** —
`greywatch.example.com CNAME us-west-1.greywatch.example.com`. Both names are
then one certificate on one box, moving the page to the other box later is a
one-line DNS change, and the `originRegion()` fallback lands on a single process
BY CONSTRUCTION rather than by nobody having exercised it.

**What one origin costs is that the page has one box under it, and it is worth
being exact about how much that is.** Round-robin only fails over when a box is
properly dead — browsers do retry the other address on a refused connection, but
a box answering slowly, or with 502s, keeps getting picked — so what is traded
away is partial and unreliable failover, in exchange for a DNS flip. And a
returning player with the app installed does not touch the origin to launch at
all: the precache is cache-first and a navigation is answered from the shell, so
the origin is what an UPDATE needs rather than what a launch needs.

**Which box serves the page does not distort the lobby.** The ping is
`responseStart - requestStart` and excludes the DNS, TCP and TLS a first request
pays for (see "The ping is the list fetch"), so a player far from the origin
still reads both regions honestly — being far from the origin costs them one
bundle download per build and nothing at all on the screen built for comparing
servers. Two hostnames on one address under one certificate will have their
HTTP/2 connections coalesced by the browser, and that is fine for the same
reason: the reading starts after the connection either way.

**A release that moves `PROTOCOL_VERSION` wants both match servers moved first,
or in the same breath.** With one origin the new bundle is live the moment that
box's `web` container updates, and a client holding it is refused by any region
still speaking the old number — including the one on the very box that served
it. The refusal is legible and a reload fixes it once the servers are level (see
above), but the width of that window should be something somebody chose.
