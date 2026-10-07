# ISSUES.md

Refactoring and tidy-up tickets from a read-only engineering review taken at
commit `5053a8e` (2026-10-05). **Line numbers are as of that commit** — search
for the named symbol if they have moved.

Each ticket is meant to be handed to one developer on its own. Before starting
one, read the contract header of every file it touches and the `docs/` companion
named in `CLAUDE.md`'s table for that subsystem — several of these touch rules
those files call load-bearing.

**Priority**

- **P0** — a live bug or a latent one that will bite the first time someone
  touches the area.
- **P1** — one rule written in two or more places, already drifting or certain
  to drift.
- **P2** — structure: a split or extraction that reduces coupling.
- **P3** — hygiene: docs, dead code, comments.

**Verification every ticket owes**: `npm run typecheck`. Anything touching the
world layer also owes `npm run kit:hash -- --against <before>.json` (kit
builders), `npm run collision` + `npm run parity` (anything that can move a
collider or the seeded scatter), and a map regenerated with no diff in its
`layout.ts` (generators). Anything touching `server/` or `src/net/` owes a local
match smoke test (`npm run build:server && npm run server`, two clients).

## Index

| # | Pri | Title |
| --- | --- | --- |
| ~~[1](#1-server-tick-loop-has-no-error-boundary)~~ | P0 — done | Server tick loop has no error boundary |
| ~~[2](#2-cupola-gun-rate-gate-uses-the-retired-minimum-spacing-rule)~~ | P0 — done | Cupola-gun rate gate uses the retired minimum-spacing rule |
| ~~[3](#3-delete-playermods-the-roguelike-leftover)~~ | P0 — done | Delete `PlayerMods`, the roguelike leftover |
| ~~[4](#4-add-exhaustiveness-checks-to-the-three-message-switches)~~ | P0 — done | Add exhaustiveness checks to the three message switches |
| ~~[5](#5-netdamagefrom-is-used-as-scratch-by-arms-that-must-not-touch-it)~~ | P0 — done | `netDamageFrom` is used as scratch by arms that must not touch it |
| ~~[6](#6-share-the-hull-guns-resolveshell--resolvemg-between-client-and-authority)~~ | P1 — done | Share the hull guns between client and authority |
| ~~[7](#7-share-resolveordnance-between-client-and-authority)~~ | P1 — done | Share `resolveOrdnance` between client and authority |
| ~~[8](#8-share-crushsweep--driverof-between-client-and-authority)~~ | P1 — done | Share `crushSweep` / `driverOf` between client and authority |
| ~~[9](#9-share-the-copied-wiring-lambdas-and-the-spawn-scatter)~~ | P1 — done | Share the copied wiring lambdas and the spawn scatter |
| ~~[10](#10-health-regen-is-written-twice-and-caps-at-different-maxima)~~ | P1 — done | Health regen is written twice and caps at different maxima |
| ~~[11](#11-client-and-authority-pick-a-hull-seat-by-different-algorithms)~~ | P1 — done | Client and authority pick a hull seat by different algorithms |
| ~~[12](#12-stance-heights-are-computed-in-three-places)~~ | P1 — done | Stance heights are computed in three places |
| ~~[13](#13-matchts-claim-gates-are-pasted-five-times)~~ | P1 — done | `Match.ts` claim gates are pasted five times |
| ~~[14](#14-matchts-per-slot-state-is-ten-parallel-tables)~~ | P1 — done | `Match.ts` per-slot state is ten parallel tables |
| ~~[15](#15-map-generators-share-no-code)~~ | P1 — done | Map generators share no code |
| ~~[16](#16-one-building-footprint-table-for-every-generator)~~ | P1 — done | One building-footprint table for every generator |
| ~~[17](#17-cannon-and-muzzle-light-effects-duplicated-in-gamets-with-inline-magic-numbers)~~ | P1 — done | Cannon/muzzle-light effects duplicated in `Game.ts` with inline magic numbers |
| ~~[18](#18-small-duplicates-inside-gamets)~~ | P2 — done | Small duplicates inside `Game.ts` |
| ~~[19](#19-extract-the-gamets-clusters-that-pass-docsgamemds-test)~~ | P2 — done | Extract the `Game.ts` clusters that pass `docs/game.md`'s test |
| ~~[20](#20-decompose-the-longest-gamets-methods-in-place)~~ | P2 — done | Decompose the longest `Game.ts` methods in place |
| ~~[21](#21-extend-kithash-to-cover-scatter-builders)~~ | P2 — done | Extend `kit:hash` to cover scatter builders |
| ~~[22](#22-split-worldkitcityts-per-builder)~~ | P2 — done | Split `world/kit/city.ts` per builder |
| ~~[23](#23-split-worldpropsts)~~ | P2 — done | Split `world/Props.ts` |
| ~~[24](#24-split-worldkitharbourts-and-worldkitdesertts)~~ | P2 — done | Split `world/kit/harbour.ts` and `world/kit/desert.ts` |
| ~~[25](#25-mapbuilderts-move-types-and-merge-code-out)~~ | P2 — done | `MapBuilder.ts`: move types and merge code out |
| ~~[26](#26-split-sfxts-engine-voices-and-ambience-into-their-own-classes)~~ | P2 — done | Split `Sfx.ts`: engine voices and ambience |
| ~~[27](#27-vehiclets-extract-hullflex-and-the-flight-model)~~ | P2 — done | `Vehicle.ts`: extract `HullFlex` and the flight model |
| ~~[28](#28-frameprofilets-split-the-recorder-from-the-reporter)~~ | P2 — done | `FrameProfile.ts`: split recorder from reporter |
| ~~[29](#29-vehiclecrewts-extract-the-pilot)~~ | P2 — done | `VehicleCrew.ts`: extract the pilot |
| ~~[30](#30-celshaderts-move-shadow-bindings-out-of-the-material-factory)~~ | P2 — done | `CelShader.ts`: move shadow bindings out of the factory |
| ~~[31](#31-hudts-scoreboard-to-its-own-class-one-1-low)~~ | P2 — done | `HUD.ts`: scoreboard to its own class, one 1% low |
| ~~[32](#32-ui-screens-shared-setinputdevice-and-paintthumb)~~ | P2 — done | UI screens: shared `setInputDevice` and `paintThumb` |
| ~~[33](#33-overlayscreents-extract-menubackdrop)~~ | P2 — done | `OverlayScreen.ts`: extract `MenuBackdrop` |
| ~~[34](#34-vehicle-models-shared-resetrigpose-and-whip)~~ | P2 — done | Vehicle models: shared `resetRigPose` and `whip` |
| ~~[35](#35-decompose-botupdate-viewmodelupdate-and-players-recoil-vector)~~ | P2 — done | Decompose `Bot.update`, `ViewModel.update`, Player's recoil vector |
| ~~[36](#36-vehicle-capability-idioms-three-soft-spots)~~ | P2 — done | Vehicle capability idioms: three soft spots |
| ~~[37](#37-propsts-drop-the-mathrandom-defaults)~~ | P2 — done | `Props.ts`: drop the `Math.random` defaults |
| ~~[38](#38-texturests-has-its-own-prng)~~ | P3 — done | `textures.ts` has its own PRNG |
| ~~[39](#39-frameprofile-depends-on-a-private-babylon-internal)~~ | P3 — done | `FrameProfile` depends on a private Babylon internal |
| ~~[40](#40-claudemd-is-over-its-own-cap)~~ | P3 — done | `CLAUDE.md` is over its own cap |
| ~~[41](#41-filesmd-has-no-scripts-section)~~ | P3 — done | `FILES.md` has no `scripts/` section |
| ~~[42](#42-findingsmd-1-carries-closed-history)~~ | P3 — done | `FINDINGS.md` §1 carries closed history |
| ~~[43](#43-dead-and-over-exported-symbols)~~ | P3 — done | Dead and over-exported symbols |
| ~~[44](#44-stale-comments-in-gamets-and-docsgamemd)~~ | P3 — done | Stale comments in `Game.ts` and `docs/game.md` |
| [45](#45-the-recoil-argument-is-written-in-five-places) | P3 | The recoil argument is written in five places |
| ~~[46](#46-physics-reference-baselines-missing-for-three-maps)~~ | P3 — done | Physics reference baselines missing for three maps |
| ~~[47](#47-most-of-the-footprint-table-understates-its-builders)~~ | P1 — done | Most of the footprint table understates its builders |

---

## P0 — bugs and latent bugs

### 1. Server tick loop has no error boundary

**Resolved.** `Match.start`'s interval body is wrapped in a `try`/`catch` that logs once and calls `abandon`; `abandon` also cancels a pending round-over rotation. Verified with an injected throw in `HeadlessGame.step`: one log line per match, the client got `rejected` and a close, and the process served a fresh match on the next join.

**Area:** `server/Match.ts`, `server/index.ts`

**Problem.** `Match.start` drives the simulation from a `setInterval`
(`Match.ts:1226`) that calls `this.step()` in a `while (carried >= STEP_MS)`
loop with no `try`/`catch`. A throw inside `step()` escapes to the process-level
backstop (`index.ts:76–81`), which only logs. Consequences:

- `carried` has already been decremented, so the next poll tries again — a throw
  that recurs every tick logs at up to 250 Hz.
- Everything in `step()` after the throw point (`lag.record`, the snapshot
  broadcast) never runs, so the match continues half-stepped forever: clients
  stay connected to a world that no longer advances coherently.
- The backstop's own comment (`index.ts:68–69`) says a corrupted match has its
  own way out. Today only a failure in `rotate` reaches `abandon`
  (`Match.ts:~1316`).

**Fix.** Wrap the body of the interval callback (or `step()` itself) in a
`try`/`catch` that logs once with the match id and calls the same `abandon`
path `rotate` uses, then clears the interval. Do not swallow and continue.

**Acceptance.**
- Inject a throw into `HeadlessGame.update` behind a temporary flag: the match
  logs once, is abandoned, its clients are told (whatever `abandon` already
  sends), and the process keeps serving other matches.
- No change to the accumulator's behaviour on the happy path.

### 2. Cupola-gun rate gate uses the retired minimum-spacing rule

**Resolved.** One `RateGate` bucket in `Match.ts` serves the rifle, both hull guns and the AT slot. Fixing the `Match` gate alone was not enough: `Vehicle.fireMg`/`fireGun` were a second spacing with no slack on the 60 Hz tick grid, and on a 144 Hz client they dropped about a third of the cupola gun's rounds with no jitter at all. The authority now asks that clock with 150 ms of tolerance for a person's round (`HULL_EARLY`; longer than the cupola gun's whole interval, short enough that nobody can fire a shell the hull is still reloading), and the bucket is the rate limit. A model of the gates over 60 s: the old gates dropped 87–184 of ~520 rounds, the new gate dropped 0, and a client firing at 2x was held to 9.0/s.

**Area:** `server/Match.ts`

**Problem.** `docs/multiplayer.md` (~line 411) and `CLAUDE.md` ("the fire-rate
gate is a BUCKET rather than a minimum spacing") record that a spacing rule
silently ate honest rifle rounds, because it measures *arrivals* and arrivals
jitter. `onMg` (`Match.ts:2600–2609`) still uses that rule:

```ts
const now = Date.now();
const gap = (1000 / tank.spec.mg.fireRate) * 0.9;
if (now - (this.lastMg[peer.slot] ?? 0) < gap) return;
```

At the cupola gun's 9 rounds/s that is 11 ms of slack, which ordinary network
jitter exceeds, so rounds are dropped with no signal to anyone. `onShell`
(~2555) and `onOrdnance` (~2657) have the same shape; their intervals are long
enough that the risk is low, but they should use the same mechanism.

**Fix.** Use the token bucket the rifle path already uses (find the rifle's
gate in `Match.ts` — `fireGate` — and reuse it, keyed per slot per weapon).
`Vehicle.fireMg` already gates on the simulation clock behind this, so the
bucket only needs to stop a client exceeding the rate *on average*. If ticket
13 lands first, put the bucket in the shared gate module.

**Acceptance.**
- Holding the cupola trigger in a local match with induced jitter (e.g. Chrome
  DevTools throttling, or a `setTimeout` jitter shim on the client send) drops
  no rounds; a client sending at 2x rate is still capped.

### 3. Delete `PlayerMods`, the roguelike leftover

**Resolved.** The type, the field, every read and the reset are gone. Each read now returns the unmodified value, so a round plays exactly as before.

**Area:** `src/entities/Player.ts`, `server/HeadlessGame.ts`

**Problem.** `Player.mods` (`Player.ts:657`) is a `PlayerMods` record from the
original roguelike prototype (`specs/game_design.md`, explicitly historical).
Nothing writes it beyond its default and the reset at `Player.ts:1459`, but it
still feeds:

- magazine size (`:944`, `:970`), max health (`:966`)
- damage, near and far (`:974`, `:991`)
- move speed (`:1813`)

The authority builds `ShotOptions` inline in `HeadlessGame.resolveShot` (~950)
and never reads mods, and `server/NetPlayer.ts` caps health at
`CONFIG.player.maxHealth`. The moment anyone sets a mod, offline play, client
prediction and the server's validation all split. The comment at `:1456`
("permadeath — mods are cleared too") describes a game that no longer exists.

**Fix.** Delete `PlayerMods`, the field, every read (replace with the
unmodified value) and the reset. Search for the type name repo-wide, including
`server/` and `src/ui/` in case the kit screen reads it.

**Acceptance.** Typecheck clean; `grep -rn "mods\b\|PlayerMods" src server`
returns nothing related; a weapon's damage, magazine and the player's speed are
unchanged in a round.

### 4. Add exhaustiveness checks to the three message switches

**Resolved.** `wire.ts` and `onNetEvent` have `never` defaults. `Match.onMessage` is now an exhaustive switch whose round block dispatches through `onRoundMessage`, itself exhaustive over `RoundMessage`. Checked by adding a dummy member to each union: all three sites failed the typecheck.

**Area:** `server/wire.ts`, `server/Match.ts`, `src/core/Game.ts`

**Problem.** Three dispatchers over discriminated unions have no compile-time
exhaustiveness, so a new member compiles and is silently dropped or misrouted:

- `wire.ts`'s `readClientMessage` switch ends `default: return null`
  (`wire.ts:218`). A new `ClientMessage` type with no arm is rejected as
  malformed with no compile error. `CLAUDE.md` says "a new client message type
  owes an arm in its switch" — nothing enforces it.
- `Match.onMessage` (`Match.ts:1766`) routes through a `case` list into an
  `if`/`else` chain ending `else this.onReload(peer)`. **A new type added to the
  `case` list without its own `else if` runs as a reload.**
- `Game.onNetEvent` (`Game.ts:7347`) handles all 18 event kinds today but has no
  `default` guard. Also `case "spawn": break` (~7536) has no comment saying
  `NetSession` routes it elsewhere.

**Fix.**
- `wire.ts`: keep `default: return null` for *unknown wire strings*, but switch
  on a typed value so a union member with no arm fails to compile (e.g. a
  `satisfies Record<ClientMessage["t"], ...>` table of readers, or an
  `assertNever` on the narrowed type in a second switch).
- `Match.onMessage`: replace the `if`/`else` chain with a `switch (msg.t)` with
  one arm per type and `default: { const _: never = msg; }`.
- `onNetEvent`: add the same `never` default, and a one-line comment on the
  `spawn` arm.

**Acceptance.** Temporarily add a dummy member to each union: each site fails
the typecheck.

### 5. `netDamageFrom` is used as scratch by arms that must not touch it

**Resolved.** The `blaze`, `explode`, `glass` and seat arms use `netScratch`. `netDamageFrom` is now written only by `damage` and read only by `died`.

**Area:** `src/core/Game.ts`

**Problem.** `netDamageFrom` (declared ~8004) carries the attacker's position
from a `damage` event to the later `died` event; its comment (~8012) says it
must survive until `died`. But the `blaze`, `explode`, `glass` and seat arms of
`onNetEvent` (~7461, ~7474, ~7528, ~7901) use it as a scratch vector. It is
safe today only because `server/Match.ts:698–744` happens to queue damage,
kill and died back to back. Any reordering on the server — or a blast landing
between them — gives the death cam the wrong killer position.

**Fix.** Give those arms their own scratch `Vector3` (one shared
`netScratch` field is enough) and leave `netDamageFrom` to the damage/died
pair only.

**Acceptance.** `grep -n netDamageFrom src/core/Game.ts` shows only the
declaration, the `damage` write and the `died` read.

---

## P1 — one rule, several copies

### 6. Share the hull guns (`resolveShell` / `resolveMg`) between client and authority

**Resolved.** `src/systems/hullRules.ts` holds `fireHullGun` and `fireHullMg`, run by both sides against a `HullRules` context each builds once; `Game.resolveShell`/`resolveMg` are that call plus the light, report, shake and the player's hitmarker, and `HeadlessGame`'s are that call plus `onCannon`/`onMg`. Every kill door on both sides now goes through `settleKill` (`src/systems/killRules.ts`) against a `KillLedger`, and `Game.creditKill` returns `boolean` like the authority's. `DeathCause` moved to `killRules.ts`. Verified: `npm run simulate` on Coldharbour and Sarab (board balances, every hull door fired); an offline Coldharbour round in a headless client (bot crews' shells and cupola fire, the player's own shell and cupola gun, no errors, deaths = paid kills + crew); a local match with two clients (no errors, board 55 kills / 57 deaths).

**Area:** `src/core/Game.ts`, `server/HeadlessGame.ts`, new file in
`src/systems/`

**Problem.** The main gun is resolved in `Game.resolveShell` (`Game.ts:6262`)
and `HeadlessGame.resolveShell` (`HeadlessGame.ts:1216`); the cupola gun in
`Game.resolveMg` (`:6400`) and `HeadlessGame.resolveMg` (`:1286`). Each pair
has the same rule core: the `fireGun` gate, `combat.fire(muzzle, dir, 0,
g.damage, …, g.range, shellShot)`, `blastAt` with the five `g.blast*` fields,
`creditKill` then an `instanceof Bot` death door, and `hearGunshot`. They have
already drifted: the client's `creditKill` (`Game.ts:9530`) returns `void`,
the server's (`HeadlessGame.ts:1498`) returns `boolean` and files
`cause`/`credited`, so offline play keeps no record of what caused a death.
`Game.ts:~6420` itself says "one of them drifting is how this started".

This is the drift `CLAUDE.md` describes for `ScoreBook` ("the failure of a
second copy is not a crash but a quiet disagreement").

**Fix.** Create e.g. `src/systems/hullGuns.ts` exporting pure-ish functions
`fireHullGun(ctx, tank, by, targets) → ShotResult` and `fireHullMg(...)`, taking
the systems they need as parameters (the `BattleSystem ← CombatSystem`
injection precedent — no system→system import). Both `Game` and
`HeadlessGame` call them; presentation (light pulse, `sfx.cannon`, camera shake)
stays in `Game` and is driven off the result. Align `creditKill`'s return type
on both sides while there.

**Acceptance.** One copy of the rule; offline and online tank fire behave
identically in a smoke test (kill credit, blast damage, friendly-fire
exclusion); `npm run simulate` still runs a round.

### 7. Share `resolveOrdnance` between client and authority

**Resolved.** `resolveOrdnance(hit, blasts)` sits beside `ordnanceEffect` in `entities/equipment.ts`; the client's `onDetonated` keeps its `if (!this.net)` at the call site.

**Area:** `src/core/Game.ts:1640`, `server/HeadlessGame.ts:1319`

**Problem.** The server copy's comment says it is "`Game.resolveOrdnance` to the
line" — and it is byte-identical apart from the client's
`if (this.net) return`. Two copies of the rule that splits an AT hit into
`damage` to the hull and `blast` to everything else (`docs/antitank.md`).

**Fix.** Move the body to one function beside `ordnanceEffect` (wherever that
lives — `grep -rn ordnanceEffect src`), taking what it needs as parameters.
`Game` keeps its `if (this.net) return` guard at the call site.

**Acceptance.** One copy; a rocket on a tank and a mine under one behave as
before, offline and online.

### 8. Share `crushSweep` / `driverOf` between client and authority

**Resolved.** `crushSweep` and `driverOf` are in `hullRules.ts`; each side answers only `personIn` (the client's player, or the authority's peers) and the client's hitmarker rides `onCrushed`. Both calls stay right after `VehicleSystem.update`. The crew's death is `crewLost` beside them. 12 tracks kills in the Coldharbour `simulate` round; no crush kill came up in the offline browser round.

**Area:** `src/core/Game.ts:6495/6555`, `server/HeadlessGame.ts:870/899`

**Problem.** The gates, the armoured/invulnerable skip, the `crushes(...)` test,
`takeDamage(c.damage, …, "crush")` and the kill credit are all written twice.
`Game.ts:~6535` records a past drift (the client used `instanceof Bot` for the
credit; see `paysKiller` in `CLAUDE.md`'s Conquest section).

**Fix.** One `crushSweep(fleet, combatants, credit)` function (e.g. in
`src/systems/` beside the hull guns from ticket 6) plus one `driverOf`. Both
sides call it right after `VehicleSystem.update`, preserving the ordering
`CLAUDE.md`'s vehicles section requires.

**Acceptance.** One copy; running a bot over with a tank kills and credits
identically offline and online.

### 9. Share the copied wiring lambdas and the spawn scatter

**Resolved.** `ConquestSystem.zoneFor`, `scatterSpawn` (exported from `ConquestSystem.ts`), `AntiTankSystem.launchToward` (the `1e-4` threshold, now one site), `crewLost`, and `settleKill` for `onBotKill`/`onBlastHit`/`onBurnHit` and both rifle paths. `throwGrenadeFor`, `hittablesFor` and `planSquads` were one-line forwards and stay where they are.

**Area:** `src/core/Game.ts`, `server/HeadlessGame.ts`

**Problem.** Callbacks wired in both simulations are copied verbatim:

| lambda | `Game.ts` | `HeadlessGame.ts` |
| --- | --- | --- |
| `zoneFor` (hold vs contest — a real rule) | ~1962 | ~744 |
| `fireRocketFor` (same `1e-4` threshold, launch, `hearGunshot`) | ~1877 | ~791 |
| `onCrewLost` | ~1749 | ~839 |
| `throwGrenadeFor`, `hittablesFor`, `planSquads`, `onBlastHit`, `onBurnHit` | wiring block | wiring block |

The spawn scatter is also twice: `Game.scatterFrom` (`Game.ts:5374`) and an
inline copy in `HeadlessGame.spawnPointFor` (`HeadlessGame.ts:1745–1760`, whose
comment says it is "`Game.spawnPointFor`'s logic, including the scatter").

**Fix.**
- `zoneFor` is a conquest rule: make it a method on `ConquestSystem` that both
  sides call.
- The spawn scatter becomes one exported pure function (e.g. in
  `entities/` or `systems/`) both sides call.
- For the remaining lambdas, extract the body into a shared function where it
  carries a rule (thresholds, credit), and leave pure one-line forwarding in
  place. Wiring itself stays in `Game` / `HeadlessGame` — only the logic moves.

**Acceptance.** Each listed rule exists once; `grep` for the `1e-4` rocket
threshold finds one site.

### 10. Health regen is written twice and caps at different maxima

**Resolved.** `entities/HealthRegen.ts` (a lock and `step(health, dt)` capped at `CONFIG.player.maxHealth`) is held by `Player` and `NetPlayer`; neither writes the curve any more. A class rather than the suggested pure function so the lock re-arm is shared too and nothing allocates per step. Offline check: 40 damage, no heal through the lock, then the same values the old code gave. Not observed live in the match (the two players were never hit), so the no-snap claim rests on both sides running one class to one cap.

**Area:** `src/entities/Player.ts:1532`, `server/NetPlayer.ts` (~174 onward)

**Problem.** The client predicts regen in `Player.updateVitals` and the server
is authoritative in `NetPlayer`'s regen. The curve is written twice, and the
caps differ: the client heals to `this.maxHealth` (`CONFIG` plus
`mods.maxHpBonus`), the server to `CONFIG.player.maxHealth`. Ticket 3 removes
the mods difference; the duplication remains.

**Fix.** One pure function `regenStep(health, lockT, dt, max) → { health,
lockT }` (e.g. in `entities/`), called by both. Do ticket 3 first or together.

**Acceptance.** One copy; client-predicted health does not snap when the
server's correction arrives after a regen in a match.

### 11. Client and authority pick a hull seat by different algorithms

**Resolved.** `chooseSeat(driver, gunner, want, only)` in `entities/Vehicle.ts` replaces `VehicleSystem.seatOn` and the server's fall-back chain: the chair asked for if free, the other if free, then the chair asked for if a bot holds it, then the other if a bot holds that. `Game.offeredSeat` asks it for the driver's seat to word the prompt, and `HeadlessGame.seat` asks it with the claimed seat to grant one (`seatHolder` is the authority's view of who sits where). Offline, the two old algorithms already agreed in all nine occupant combinations; the live drift was in a match, where the client read bot crews from its own `VehicleCrew`, which is always empty there, so a full hull with a bot driver was offered as TAKE OVER GUN. It now reads `seatHeldBy`. A crossing is `only`, and `HeadlessGame.seat` checks it *before* releasing the old chair, so a refused swap leaves the player where they were; `Match`'s crossing gate and `Game.canSwapSeat` go through it too. Checked against a real `HeadlessGame` on Coldharbour with bot crews and three `NetPlayer`s: for every combination of empty, bot and person in each chair, the seat offered is the seat granted, and all six crossings land correctly. Not driven by hand in a browser.

**Area:** `src/core/Game.ts:5825` (`offeredSeat`), `server/HeadlessGame.ts:1007`
(`seat`)

**Problem.** The client decides which seat to *offer* with `seatOn`, then
`crewOf(held, DRIVER) ? DRIVER : GUNNER`. The server *grants* a seat with its
own fallback chain: wanted → other → evict a bot from wanted → evict from
other. Because the algorithms differ, the boarding prompt can name a chair the
server then doesn't grant.

**Fix.** One pure `chooseSeat(hull crew state, want) → Seat | null` used by
both: the client to label the prompt, the server to grant. The server keeps
its eviction side effects; only the decision is shared. Check
`docs/vehicles.md`'s seats section for the intended rule before choosing which
side is right.

**Acceptance.** Boarding a hull with each combination of occupants (empty;
bot driver; bot gunner; human driver) offers exactly the seat the server
grants.

### 12. Stance heights are computed in three places

**Resolved.** `entities/stance.ts` — `stanceCentre(standCentre, blend)`, `stanceEye(blend)`, `easeStance(blend, crouching, dt)`. There were five sites, not three: Player, Bot, NetSoldier, server/NetPlayer and the death cam's corpse. Three functions rather than one returning `{ eye, centre }`, so nothing allocates per body per frame. Player, NetPlayer and DeathCam heights are bit-identical. Bot and NetSoldier differ by at most one ulp (6e-14 m over 400k random samples), because `y + c + d` became `y + (c + d)`.

**Area:** `src/entities/Player.ts:2627–2631`, `src/entities/Bot.ts:1955–1970`,
`src/net/NetSoldier.ts:305–311`; easing at `Player.ts:1806–1808`,
`Bot.ts:1010–1012`

**Problem.** `CLAUDE.md` calls it load-bearing that "the eye and the hit sphere
come down together or the stance makes a body easier to kill". The formula for
eye height and body centre from the crouch blend is written three times, and
the crouch easing twice.

**Fix.** One pure `stanceHeights(standCentre, blend) → { eye, centre }` and one
`easeStance(blend, target, dt)` (e.g. `src/entities/stance.ts`), called from all
three.

**Acceptance.** One copy; crouching player, bot and remote soldier have
unchanged eye and hit-sphere heights (log them before and after).

### 13. `Match.ts` claim gates are pasted five times

**Resolved.** `server/claimGates.ts` holds `RateGate` and `SHOT_SLACK` (moved from `Match`), `claimedDir`, `lookDir`, `withinCone`, `withinSlip`, and one `DEGENERATE_DIR` (1e-3). It is not a tunable, so it is not in `src/config/`. The sizes of the cones and slips stay in `Match` with their arguments. Over 300k random claims, the gates agree with the old shell/mg/ordnance inline checks every time. The shot and grenade arms now refuse directions shorter than 1e-3 rather than 1e-6, which nothing honest sends. All the gates now refuse NaN, which the old `<`/`>` comparisons let through.

**Area:** `server/Match.ts` ~2137, ~2216, ~2559, ~2611, ~2674

**Problem.** Each inbound claim (shot, throw, shell, mg, ordnance) recomputes
the look vector from yaw/pitch and checks cone and origin slip inline. The
zero-length threshold differs between copies (`1e-6` vs `1e-3`).

**Fix.** New `server/claimGates.ts` with pure `lookDir(yaw, pitch)`,
`withinCone(look, dir, cos)`, `withinSlip(origin, expected, max)` and the
bucket gate from ticket 2. One threshold constant, in `src/config/` if it is a
tunable.

**Acceptance.** Each handler calls the shared gates; one threshold.

### 14. `Match.ts` per-slot state is ten parallel tables

**Resolved.** `SlotRecord` and `freshSlot()` in `Match.ts`. It is named that because `SlotState` is already the wire's roster row. `Match.slots` is built at `SLOT_COUNT` and holds each slot's loadout, equipment, pouch, the four rate gates, the reload clock and `lastSeen`. `drop` and `admit` are each one assignment. The gates are built eagerly, which is equivalent because a `RateGate` starts full. `firedRounds`/`firedMg` stay as they were: they are per-snapshot accumulators, not occupant state. Tested in a local match on Coldharbour with two clients: shots went through the new gates, the second client left and a third joined the same slot and fired normally, and neither client logged an error.

**Area:** `server/Match.ts:453–534`, `drop` at ~1069–1078

**Problem.** `loadouts`, `equipment`, `throwables`, `fireGate`, `lastReload`,
`lastOrdnance`, `lastShell`, `lastMg`, `lastSeen` and friends are separate
arrays/maps keyed by slot, and `drop` must clear each by hand. A new table that
`drop` forgets leaks one player's state into the next person seated in that
slot.

**Fix.** One `SlotState` record type with a `fresh()` constructor; `Match`
holds `slots: SlotState[]` and `drop` replaces the record. Keep the slot index
as the key (`CLAUDE.md`: "a slot index IS a bot index").

**Acceptance.** `drop` is one assignment; join, leave, rejoin into the same
slot carries nothing over.

### 15. Map generators share no code

**Resolved.** `scripts/lib/mapgen.mjs` (436 lines). Each generator was switched in its own commit (210e0db…55d77fc). The drifted helpers that were merged afterwards each got their own commit too (633535e…f893e2b): `n2`, `centredRectDist`, `makeRelief`, `makeScatter`, `makeClaim`/`makeYard`, `paramText`, `makeEmit`, `makeRectRoad`, `makePathRoad`. Each one was regenerated on every map that uses it. Helpers that differ on purpose stay local: Harrowmead's `emit`, Greyfen's millimetre `emit`/`paramText` and its wooded `yard`, Coldharbour's `footOnRoad`, every `doorway`, and the map design code. The seven generators went from 17,833 to 17,002 lines. All seven regenerate byte-identical `layout.ts` and `heights.ts`, and print the same output under every flag. Sarab already failed to reproduce at 1c3151d: someone hand-added a 3-line comment over the wadi grass rect in its `layout.ts`, and a regeneration drops it. It was compared against its pre-change output instead. `mulberry32` is now defined only in `src/world/rng.ts` and `src/world/textures.ts` (#38). `generate-water-textures.mjs` had a copy too and now imports it, and the foam mask comes out byte-identical.

**Area:** `scripts/generate-{sarab,cinderhaven,kurenai,harrowmead,greyfen,coldharbour,hollowmere}.mjs`
(17,840 lines together)

**Problem.** The only shared imports are `roadNetwork`/`onRoad`/`bendPath` from
`src/world/roadPaths.ts` and `roads.ts`. There is no `scripts/lib/`. About 500
lines are **byte-identical** copies, including:

- `mulberry32` ×7 (sarab:93, cinderhaven:127, kurenai:84, harrowmead:82,
  greyfen:121, coldharbour:89, hollowmere:91)
- `smooth` ×7, `section` ×7, `hash2` ×5, `vnoise` ×5, `n2` ×4, `turnOf` ×4,
  `worldFoot` ×4, `smin` ×3, `segDist` ×2, `frontClear` ×2
- identical in 3–4 of 5: `floorAt`, `overlaps`, `footOnRoad`, `footWet`,
  `rectRegion`, `disc`, `relief`
- the `--probe` grid printer (differs only in `step`; harrowmead:398 vs
  coldharbour:383) and the `--refusals` printer (5 copies)

About 2,500 more lines are same-named helpers that have **drifted**: `claim`,
`place`, `must`, `free`, `grade`, `heightAt`, `land`, `rectDist`, `doorway`,
`yard`, `why`, `emit`, `paramText`, `pathRoad`, `rectRoad`, `groveOk`,
`woodiness`, `turf`, `runnable`, `flush`.

**Fix.**
1. Create `scripts/lib/mapgen.mjs` with the byte-identical helpers, the probe
   grid and the refusal printer. Import `src/world/rng.ts` for the PRNG rather
   than copying it — Node already loads `roadPaths.ts` by type stripping, and
   the same rule applies (`CLAUDE.md`: a value import names its `.ts`, no
   syntax that must be compiled).
2. Switch each generator to it, **one generator per commit**, and regenerate:
   `npm run <map>` must produce no diff in that map's `layout.ts` and heights.
3. Then, separately, look at the drifted helpers one at a time; merge only
   where the difference is accidental, parameterise where it is deliberate.

**Acceptance.** Each generator regenerates byte-identical output; `mulberry32`
exists only in `src/world/rng.ts`.

### 16. One building-footprint table for every generator

**Resolved.** `scripts/lib/footprints.mjs` holds `FOOT`, `DOOR_FACES` (with `DOORS` and `FRONT_PLUS_Z` derived from it), `FRONTS` and `stairRun`. The four generators import it, and the map-layout skill's `footprints.mjs` re-exports it, so there were five copies, not four. There is also a check now: `npm run kit:hash -- --feet` builds every placement of every kind in the table and prints how far the drawing reaches past its row on each side, once for parts below 2 m and once for everything. Drifted values were settled by that measurement. Rule: what stands below head height, plus a building's eaves, but not a canopy a body stands under.
- cottage front `-1.0` (Harrowmead) over `-0.9`: the enterable cottage's eave reaches `-d/2 - 0.92`.
- townhouse front `-1.1` over `-0.7`: the shop variant's let-down board and the eave reach `-d/2 - 1.05`. Coldharbour's `-0.7` was the wall line.
- crates: Harrowmead's. The cask is inside it. The extra Coldharbour gave covered nothing but an open cask's lost hoop, which is litter.
- fishRack: Greyfen's. Coldharbour's understated the ends by 0.08.
- stall: neither. The back is now `+1.45`, for the sacks on the ground behind the counter.
- jetty: neither. `±1.9` for the pile heads, ends `±(L/2 + 0.5)` for the step and the laid ladder.
- careenedHull: neither. `±2.95` for the shores' feet. The ends are Greyfen's `+0.3`, because the stem and stern rise clear of the ground.

Before the corrections were applied, the switch alone regenerated Hollowmere, Greyfen and Harrowmead byte-identical. Harrowmead's field ruins now pass `noDoor`: the shared `DOORS` includes `ruin`, as Hollowmere's always did, but an abandoned steading has no lane. After the corrections, Greyfen's slip boat now samples its shores' feet and was refused at a 0.56 slope. It keeps its place with `flat: 0.6`: this is the ground it has always stood on. Hollowmere, Greyfen and Harrowmead are still byte-identical. Coldharbour moved: its old town's townhouses and cottages stand 0.4 m back from the lane, some seeded widths reshuffled, the counts are unchanged, and one more stack of crates fits (247 → 248 placements). Every door check still passes, and the skill audit reads the same as before on all four maps. Coldharbour was rebaked and `npm run parity` passes on every map. Its menu photograph was not retaken (`npm run shots` needs a GPU); the change is 0.4 m in one quarter.

The same report shows that most of the table understates the builders it describes. That is #47.

**Area:** generators (harrowmead:441, hollowmere:485, coldharbour:438,
greyfen:526)

**Problem.** The `FOOT` table — footprints and door offsets "measured off the
builders" — is restated four times and has already drifted: townhouse front is
`-d/2 - 1.1` in harrowmead but `- 0.7` in coldharbour (:457); cottage front
`-1.0` vs `-0.9` (coldharbour:458). A kit rework silently invalidates up to four
copies, and the door checks that keep front doors opening onto streets read
the wrong numbers.

**Fix.** One `scripts/lib/footprints.mjs` with `FOOT` and `DOORS`. Better:
derive it — `scripts/kit-hash.mjs` already builds every kit kind and can
measure the footprint and the door position from the built geometry; write the
table out as a generated file. Decide which of the drifted values is correct
by measuring the builder, not by picking one.

**Acceptance.** One table; each map regenerated, with any layout diffs
explained by the corrected values and the door checks passing. Owes
`npm run collision -- <map>` and `npm run parity` for any map whose layout
moved.

### 17. Cannon and muzzle-light effects duplicated in `Game.ts` with inline magic numbers

**Resolved.** `Game.drawCannon(tank, muzzle)` is the one cannon presentation: light, report and shake. `resolveShell` and the net `cannon` arm both call it. `Game.flashMuzzle(at, scale?)` is the one muzzle light. It serves the rifle shot, the cupola gun, the bots' budgeted flashes and the two heavier muzzles. Those are now `CONFIG.lighting.launcherFlash` (`{ range: 1.8, life: 2 }`) and `cannonFlash` (`{ range: 2.2, life: 2.5 }`), multiples of the rifle's flash. The blast light's two blend weights are `explosionPowerIntensity` (0.4) and `explosionPowerLife` (0.25). They give the same arithmetic as the old `0.6 + 0.4 * power` and `0.75 + 0.25 * power`. No `lighting.pulse` call in `Game.ts` has a bare multiplier left. Out of scope and still inline: the rumble scales beside them (`shotMs * 2.5`, `* 3`, `0.35, 0.5`).

**Area:** `src/core/Game.ts`

**Problem.** The tank cannon's presentation — light pulse, `sfx.cannon`,
`shakeFromCannon` — is written in `resolveShell` (~6353–6364) and again in the
net `cannon` arm (~7502–7511), with the same unexplained ×2.2 / ×2.5. More
generally `lighting.pulse(lc.muzzle * …)` with inline scales appears at ~5625,
~6160 (×1.8 / ×2), ~6354, ~6440, ~7505 and ~9773. `CLAUDE.md`: "All tunables
live in `src/config/` … no gameplay magic numbers elsewhere."

**Fix.** One private `drawCannon(muzzle, dir)` used by both paths. Move each
pulse scale into the relevant config section (probably `CONFIG.lighting` or the
weapon/vehicle spec it belongs to) with a name saying what it is.

**Acceptance.** One cannon presentation path; no bare numeric multipliers on
`lighting.pulse` calls in `Game.ts`.

---

## P2 — structure

### 18. Small duplicates inside `Game.ts`

**Resolved.** `Game.hitCue(killed, head)` is the marker and its sound. It serves the rifle's own resolve, the authority's `hit`, `hullHitCue` and the crush. The blast and the burn mark without a sound, so they still call `flashHitmarker` alone. The module-level `netWeapon(w)` resolves a wire event's weapon name, `undefined` meaning a bot. `onNetFire` reads its voice and reach from it and the `reload` arm its voice and time; `netVoice` is gone. `netBurst(n)` and `burstSpacing(rounds)` are the burst clamp and spacing for `onNetFire` and `onNetMg`.

**Area:** `src/core/Game.ts`

- **Burst size clamp** (`rounds` / `spacing`) copied at ~7681–7682 and
  ~7772–7773 → one helper.
- **"Named weapon, else bot" fallback** three times: ~7432, ~7699, and in
  `netVoice` ~7914 → one helper.
- **Hit cue** (`flashHitmarker` plus headshot/hit sound) at ~5659–5661 and
  ~7397–7399 → one private `hitCue(head)`.

**Acceptance.** Each exists once.

### 19. Extract the `Game.ts` clusters that pass `docs/game.md`'s test

**Resolved**, one commit per cluster.
1. `core/urlOverrides.ts`: `UrlOverrides` reads `?gi=`, `?shadows=`, `?volumetrics=` and `?nominimap` once. It resolves each against the setting `Game` hands in (`gi`, `shadows`, `volumetrics`, the last being `Game.volumetricsWanted`) and builds the `forced` list once. `urlFlag`/`urlParam` replace `FrameProfile`'s private `hasFlag` and serve `?gpu` and `?profile`.
2. `core/PointerLockChase.ts`: the five lock fields. `changed(locked, now)` answers "is this the player leaving?" and `step(...)` answers "ask now?". `Game` keeps `requestLock`, `pause` and which states a departure pauses.
3. `net/NetShotQueue.ts`: `PendingShot`, the pool, its cap and `queueNetShot`'s argument. `Game` queues from the three events and draws in `drawNetShots`.
4. `LightningStrikes` owns its offline clock (`step(dt, held, authorityNow)`, holding with the world as before) and the map's flash `color`, parsed in `setSpec`. `update` is private now.

`bakeWait` stays, as the ticket says.

**Area:** `src/core/Game.ts`; read `docs/game.md` first. `src/net/RegionBook.ts`
is the worked example.

The test: a cluster of private fields nothing else in `Game.ts` reads, whose
methods touch no system, no mesh and no frame. These qualify:

1. **URL overrides.** `giForced`, `shadowsForced`, `volumetricsForced`,
   `minimapOff` (~540–554, ~674–680), the `forced` list (~2711–2715) and the
   `x ?? settings.x` resolution written three times (~1237, ~2658, ~2712). Read
   once at boot. Move to a module in the shape of `prefs.ts` (the module reads,
   `Game` spends). `FrameProfile.ts:~367` already has a URL-flag helper — reuse
   it.
2. **Pointer-lock retry.** `hadPointerLock`, `lockTakenAt`, `lockPending`/`T`,
   `lockRetryT` (~810–823, ~2064–2091, ~4019–4064). Pure timing over booleans.
   The module answers "request now?" / "should pause?"; `Game` keeps
   `requestLock` and `pause`. Read `docs/states.md`'s pointer-lock section.
3. **Queued net shots.** `netShots`, `netShotCount`, `queueNetShot`'s pool
   (~7729–7756, ~8035, reset ~3352). Same shape as `HitCredits`. The drawing
   stays in `Game`.
4. **`lightningClock` and `flashColor`** (~509–511, ~4505–4508, ~6653–6667)
   belong inside `LightningStrikes` itself.

**Do not extract `bakeWait`**: it doubles as the state machine's
`buildPending` marker (~4150) and is cleared by `go` (~2396).

**Acceptance.** Each extraction is its own commit; `Game.ts` behaviour
unchanged; `FILES.md` gets a line per new file.

### 20. Decompose the longest `Game.ts` methods in place

**Resolved.** `joinMatch`'s session callbacks are `wireNet(net)`, beside `wireBattle` and `wireVehicles`, and are assigned at the same point in the join. `updateOnFoot`'s gun branch is `firePrimary()`, the twin of `fireOrdnance`, and its tail is `updateBoarding()`. In `tick`, the shafts' three shadow pushes moved into `syncVolumetrics`, their only caller. The eye-follow block inside the `culling` span is `followEye(fleetStepped)`. Every `begin`/`end` bracket and every call in `tick` is where it was, in the same order. Checked live: a capture on Hollowmere and Cinderhaven still records every phase an offline round on foot runs (all but `driver` and `net`). A two-client match on a local server seated both clients, and bravo queued and drew alpha's rounds and the bots'.

**Area:** `src/core/Game.ts` — wiring stays in `Game`, these are private-method
extractions only.

- `joinMatch` (`:7053`): ~220 lines of `net.onX = …` callbacks → a
  `wireNet(net)` method beside the existing `wireBattle` / `wireVehicles`.
- `updateOnFoot` (`:5445`): the primary-fire branch → `firePrimary()` (twin of
  the existing `fireOrdnance`); the boarding tail (~5690–5709) → its own method.
- `tick`: the volumetrics block (~3391–3410) can join `syncVolumetrics`; the
  eye-follow block (~3440–3492) → one method. **The order of calls in `tick` and
  the profiler `begin`/`end` brackets must stay in `tick`** (`docs/profiling.md`:
  the phase list IS that order).

**Acceptance.** No reordering of anything in `tick`; a profiler capture still
shows every phase.

### 21. Extend `kit:hash` to cover scatter builders

**Area:** `scripts/kit-hash.mjs`. **Prerequisite for ticket 23.**

**Problem.** `kit:hash` fingerprints `BUILDERS` (structures) only, never
`SCATTER_BUILDERS` (`MapBuilder.ts:~632–666` — the trees, rocks, barrels and
junk in `Props.ts`). So `Props.ts` has no refactor gate except a collision
rebake plus `npm run parity`, which doesn't see visual-only geometry.

**Fix.** Hash each scatter builder over a fixed set of seeds (the builders take
`rng`/`sub` streams) — drawing and colliders hashed apart, as for structures.

**Acceptance.** `npm run kit:hash -- --kinds <scatter kind>` works; a one-vertex
change to a tree changes its hash.

**Done.** Every `SCATTER_BUILDERS` kind is built over eight fixed seeds at each
`CONFIG.graphics.foliage` rung (24 builds a kind, 576 in all). The drawing is
the prop in `MapBuilder.flatten`'s order with metadata included (it is part of
the merge key); the collider half is the kind's `PROP_BODIES` row plus how many
numbers the builder drew from the region's stream, which is what moves a
blocking field's boxes. Checked: a 1 mm nudge to one pine vertex changed all 24
pine drawing hashes and nothing else; one extra `rng()` in `buildPine` changed
all 24 pine collider hashes and no drawing; the whole kit against a HEAD
fingerprint changed no structure build. A whole-kit fingerprint taken before
this change now reports the 576 as `builds added` — take a fresh one.

### 22. Split `world/kit/city.ts` per builder

**Area:** `src/world/kit/city.ts` (7,157 lines). Follow the precedent of the
`japan/`, `buildings/` and `structures/` split (`git log -- src/world/kit/japan`
for how it was done). Gate: `npm run kit:hash`.

Proposed layout under `src/world/kit/city/`:

| file | lines (approx.) | contents |
| --- | --- | --- |
| `shared.ts` | 1–595 | the stacking rules, `STOREY`/`SLAB`/`GRADE`/`LANDING`/`DOORWAY`, `laneFlight` (used by office, shophouse, depot), `towerRoll` (tower + office), `HIDE_TOP` |
| `tower.ts` | 595–2233 | tower, with `drawBrickStock` (tower-only) |
| `office.ts` | 2233–3056 | |
| `shophouse.ts` | 3056–4169 | with `REVEAL` |
| `parkade.ts` | 4169–4840 | |
| `depot.ts` | 4840–5873 | with `stencil` |
| `planter.ts` | 5873–6313 | |
| `street.ts` | 6313–6702 | barrier, quay, car, street light |
| `monument.ts` | 6702–7157 | |
| `index.ts` | — | barrel re-exporting what `BuildingKit.ts:54` imports |

**Acceptance.** Pure move: `kit:hash --against` identical for every city kind;
`FILES.md` updated.

**Done.** `kit/city.ts` is `kit/city/`, laid out as proposed. `index.ts`
carries the set's header, moved as it was, and re-exports the eleven builders,
so `BuildingKit.ts` imports exactly what it did. Two departures from the
table, both by the `japan/` rule that what more than one builder uses is
`shared.ts` and nothing else is: `towerRoll` and `OVER_GLASS` went to
`tower.ts` (the office only names `towerRoll` in a comment), and `SPANDREL`,
`HEAD` and `MULLION_PITCH` to `office.ts`. No builder imports another. It is a
pure move — every body line of the old file lands exactly once, the only code
change being `export` on what `shared.ts` hands out, and the comments that
said "this file" or "the file header" now say the set's. Checked: `kit:hash
--against` a whole-kit fingerprint taken before the move is identical over all
3,722 builds; `npm run build` and `npm run parity` pass. The proving ground's
layout comment named the old path, so its bake was re-stamped (`npm run
collision -- proving`: 5,938 boxes, only the hash line moved).

### 23. Split `world/Props.ts`

**Area:** `src/world/Props.ts` (5,708 lines). **Do ticket 21 first.**

Proposed layout under `src/world/props/`:

- `geometry.ts`: `tri`, the Sheet helpers (`newSheet`/`sheetVert`/`sheetFace`/
  `sheetData` — `sheetVert` is used ~30 times), `withRig`/`rigVerts`,
  `rachis*`, `prism*`, `loft*` (~1631–2276).
- `crown.ts`: `skinBillows`, `crownPart`, `leafStalk`, `leafFaces` (shared by
  ash ~1186 and maple ~5592).
- one file per prop: `deadTree`, `pine`, `ash`, `jungleTree` (+`lianaVeil`),
  `palm`, `maple` (+`bamboo`, `leafLitter`), `fern`, `fireDrum`, `boulder`
  (+`geodesic`/`rockData`), `cask` (barrel + `caskData`).
- grouped: `junk.ts` (skip, bins, pallets, cone, litter), `jungleSmall.ts`
  (stele, log, fungus, gravestone).
- `index.ts` barrel for `MapBuilder`.

Also fixes a layering smell: `kit/structures/small.ts:10` imports `caskData`
from `../../Props`, so a structure depends on the scatter monolith; it should
import `props/cask.ts`.

Optional, separate: `Sheet`/`tri` overlaps `kit/core.ts`'s `Mesher.tri`
(~1914) — two winding-decided triangle builders. Unify only if `kit:hash`
stays identical.

**Constraints.** Keep every builder's RNG draw order exactly (memories note
e.g. "keep 48 rng draws" on the palm) — a reordered draw re-rolls the seeded
scatter and moves colliders.

**Acceptance.** `kit:hash --against` identical for every scatter and structure
kind; `npm run collision` produces no diff; `npm run parity` passes.

**Done.** `Props.ts` is `world/props/`, one file per prop as proposed, with
`index.ts` carrying the set's header, moved as it was, and re-exporting what
`MapBuilder` imports; `kit/structures/small.ts` takes `caskData` from
`props/cask.ts`. Departures, all by the rule ticket 22 followed — what more
than one prop uses is shared and nothing else is: a `palette.ts` holds the
colours two or more props wear plus `RIM_WOOD` (a colour one prop wears went
with it); `rigVerts` went to `crown.ts` beside the rest of the broadleaf crown;
`withRig` and `featherBlade` to `jungleTree.ts` and `pinnateBlade` to `fern.ts`,
their only users; `reach` stayed with the boulder and `geodesic` went to
`geometry.ts`, the crown being its other user. `jungleSmall.ts` is `small.ts`,
since a gravestone, a log and the corpse-fungus are Hollowmere's, and it also
takes the four props the proposal left out — the buttress log, the bramble,
the rubble and the dead `buildLantern`, kept for ticket 43 to delete. No prop
imports another. It is a pure move — every body line of the old file lands
exactly once, the only code change being `export` on what crosses a file, and
comments that said "this file" now say the set's. The optional `Sheet`/`tri`
unification with `Mesher.tri` was not attempted. Checked: `kit:hash --against`
a whole-kit fingerprint taken before the move is identical over all 3,722
builds; `npm run collision` rebaked all eight maps with no diff; `npm run
parity` and `npm run build` pass.

### 24. Split `world/kit/harbour.ts` and `world/kit/desert.ts`

**Area:** `src/world/kit/harbour.ts` (2,311), `src/world/kit/desert.ts` (1,934).
Same pattern and gate as ticket 22.

- **harbour/**: `boarding.ts` (shared words ~778–994: `dressed`, `bar`,
  `sashWindow`, `lapBoard`, `boardedWindow`), `smelter.ts` (~137–433),
  `lighthouse.ts` (~433–778), `crane.ts` (~994–1656), `netLoft.ts`
  (~1843–2270), `small.ts` (fishRack, careenedHull, saltPan).
- **desert/**: `shared.ts` (~1–540: palette, `levels`, `laneGeom`,
  `assertClimbable`, `laneFlight`, `drape`, `parapet`, `windowRow`), one file
  each for adobe, windTower, caravanserai, hammam; `walls.ts` (compound wall,
  blast wall, sandbags, pylon); `mosque.ts` (mosque, minaret, souk + `arcade`).

**Note.** `laneFlight` exists twice with different signatures (city.ts:~391,
desert.ts:~263), and `GRADE` is stated three times (0.35 city, 0.34 desert,
0.34 harbour — harbour's comment says the restatement is deliberate). Keep
them separate, but consider writing each as `MAX_WALKABLE_GRADE - margin` so
the shared bound is visible.

**Acceptance.** `kit:hash --against` identical.

**Done.** `kit/harbour.ts` is `kit/harbour/` and `kit/desert.ts` is
`kit/desert/`. Each `index.ts` carries its set's header, moved as it was, and
re-exports the set's builders, so `BuildingKit.ts` imports exactly what it
did. The split departs from the proposal where ticket 22's rule decides it:
what more than one building uses is shared, and nothing else is.

- **harbour/**: `smelter`, `lighthouse`, `crane`, `netLoft`, and `small.ts`
  for the rack, the hull and the pan. The proposed `boarding.ts` is
  `shared.ts`, because it also holds `bar`, `splitRun`, `TRANSLUCENCY` and
  `NET_PAINTS`, and none of those is boarding. `dressed`, `TO_CORE` and
  `sashWindow` went to the lighthouse, their only user. `GRADE` went to the
  smelter, which has the set's only flight.
- **desert/**: `shared.ts`, then `adobe`, `windTower`, `caravanserai`,
  `hammam`, `walls` and `mosque`. The proposal left out the shelled block and
  the granary, so each got a file of its own. `arcade` went to
  `caravanserai.ts`, its only caller; the souk never used it, so the souk has
  its own file and `mosque.ts` holds just the mosque and the minaret.
  `STOREY_RC` went to `shellBlock.ts`. `parapet`'s doc comment had drifted
  two functions above it, and is back over it.

No builder imports another. It is a pure move: every body line of the old
files lands exactly once. The only code changes are `export` on what crosses
a file and the paths in two DEV-only error strings. Comments that said "this
file" now say "the set". Every outside reference names the file it means,
across the source, the generators, the docs, FILES.md, FINDINGS.md, CLAUDE.md
and the model-detail skill.

The comments in the Coldharbour, Sarab and Cinderhaven layouts named the old
paths, so their bakes were re-stamped; only the hash line moved. Coldharbour
and Cinderhaven regenerate with no other diff. Sarab's generator is missing
the three-line comment over the dry grass patch at (300, −60) that
`layout.ts` carries. That drift was already there before this ticket and was
left alone.

The `MAX_WALKABLE_GRADE - margin` rewrite was not done. `0.4 - 0.05` is
`0.35000000000000003`, so the city's flights would move.

Checked: `kit:hash --against` a whole-kit fingerprint taken before the move
is identical over all 3,722 builds. `npm run parity` and `npm run build`
pass.

### 25. `MapBuilder.ts`: move types and merge code out

**Area:** `src/world/MapBuilder.ts` (3,353 lines)

1. **Types** (~120–627: `ControlPointDef` … `GameMap`, `WorldBox`,
   `EditorIndex`) → `src/world/mapTypes.ts`, re-exported from `MapBuilder` so
   the 41 importers don't change in the same commit. Mechanical.
2. **Merging** (`BlockMerge`, `PaneBlocks`, `flatten`, `mergeByMaterial`,
   `exemptionsOf`, `markSwayMerged`, ~2902–3353) are already free
   functions/classes → `src/world/merge.ts`. Note `BlockMerge.finish` and
   `PaneBlocks.finish` must keep writing `metadata.block` identically
   (`CLAUDE.md` metadata contract).
3. **Scatter** (tables ~641–893; `scatterRegion`, `findSpot`,
   `insideCollider`, the `buries` family ~1881–2200, `scatterScale`,
   `maxScatterClearance`) is a cluster but uses `this.collider` and
   `recordBox`, so it needs a small context object. Optional, after 1 and 2.
4. `build()` (~1105–1600) has labelled phases (valley, placements, scatter,
   bake) → private methods.

**Keep in `MapBuilder`:** `collider()`, `recordBox`, `clusterColliders` —
"`MapBuilder.collider()` is the only place that creates them" is the
invariant.

**Acceptance.** `npm run collision` no diff; `npm run parity` passes;
`kit:hash` identical.

**Done**, steps 1, 2 and 4. `MapBuilder.ts` is 2,506 lines, down from 3,361.

- **`world/mapTypes.ts`** holds every type from `ControlPointDef` to
  `GameMap`, with type-only imports. `MapBuilder` re-exports each one, so none
  of the importers changed.
- **`world/merge.ts`** holds `mergeByMaterial` and its key (`EXEMPTIONS`,
  `exemptionsOf`, `plainCelHex`, `markSwayMerged`, `Palette`), `BlockMerge`,
  `PaneBlocks`, `flatten` and `BLOCK_SIZE`. `MapBuilder` re-exports
  `BLOCK_SIZE` for `GlassSystem`, `PhysicsWorld` and the server. `tag` went
  with them because `PaneBlocks` tags the merged glazing for the editor, and
  `merge.ts` could not take it from `MapBuilder` without a cycle. `CORNERS`
  and `rotateY` stayed, since only `MapBuilder` uses them. Both
  `metadata.block` writes moved unchanged.
- **`build()` is now a list of phases**, one method each: `reset`, `floorFor`,
  `buildValley` (as before), `placeStructures` (with the road merge),
  `placeScatter` (with the collider clustering), `waterAmbience`,
  `mergeBlocks`, `bake` and `derive`. A `BuildRun` carries what they read
  and the lists they fill, `buildValley` included. `reset` calls `release()` and then sets the fields the layout decides.
  Before, a build reset and a teardown cleared the same fourteen fields from
  two lists that had to agree; now there is one list.

**Step 3 was not done.** The scatter code reads `collider()`, `recordBox`,
the box index, `keepClear`, the roads, the prop seed, the foliage, the pending
cluster and the editor item, so its context object would be most of the
builder. The tables could move without one, but a dozen comments across
`props/`, `kit/` and the layouts name `PROP_BODIES` in `MapBuilder.ts`.

It is a pure move apart from four kinds of change: `export` on what crosses a
file, `build`'s body becoming calls, comments that said "below" or "`build`"
now naming the method they mean, and the outside references that named the
old home (`weaponKit.ts`, `CelShader.ts`, `ReflectionSystem.ts`,
`GlassSystem.ts`, `layout.ts`, `kit-hash.mjs`, `docs/world.md`,
`ENGINE_UPGRADE.md`, `FILES.md`). An empty `else {}` the move carried
across, in the editor's road branch, is gone.

Checked: `kit:hash --against` a whole-kit fingerprint taken before the move
is identical over all 3,722 builds. `npm run collision` rebaked all eight maps
with no diff. `npm run parity` and `npm run build` pass.

### 26. Split `Sfx.ts`: engine voices and ambience into their own classes

**Area:** `src/core/Sfx.ts` (4,436 lines). Read `docs/audio.md` first.

**Problem.** Two sustained-voice subsystems share little with the one-shot
sounds: engines (types ~374–504, methods ~2686–3432, ~870 lines) and ambience
(types ~505–785, methods ~3433–3900, ~750 lines). Both use only `ctx`,
`noiseBuffer`, `bus()`, `distanceToListener`, `burst`/`tone` and `paused`.

**Fix.** `EngineVoices` and `AmbienceVoices` classes given a small audio-core
handle exposing those members. `Sfx` keeps its public methods
(`ambience`, `ambienceAllOff`, `enginesOff`, …) as delegates so no caller
changes.

**Constraints.** `Sfx`'s invariant "nothing is scheduled" must hold in each new
file (state it in each header). Mix buses are read into a local by the method
making the sound and **never held in a field** (`CLAUDE.md`, two faders).

**Acceptance.** Engines and fires sound identical in a round; `F4` mixer still
moves both families.

**Done.** `Sfx.ts` is 2,787 lines, down from 4,436.

- **`core/EngineVoices.ts`** holds `EngineKind`, `EngineVoice`,
  `HULL_ENGINE_LEVEL` and the class: the driven hull's voice, the hull map,
  `growlCurve`, and every engine method from `engineOn` to `stopEngine`, plus
  `growlShape`.
- **`core/AmbienceVoices.ts`** holds the `AmbienceId`/`AmbienceKind`/`BandSpec`/
  `SparkSpec` types, the `BREATH_*` and spark constants, `sparkThreshold`,
  `AmbienceVoice` and the class: the emitter map, the spark curves, the breath
  buffer, every ambience method, `sparkShape` and `buildBreathBuffer`. `unlock`
  still builds the breath, in the same place in the order.
- **`core/sfxCore.ts`** holds `AudioCore`, the handle both classes get, plus
  `MixBus`, `BurstSpec` (`burst`'s argument, which was an inline type) and
  `Point`. `AudioCore` has the six things the ticket named: `ctx`,
  `noiseBuffer`, `paused`, `bus`, `distanceToListener` and `burst`/`tone`.
  `Sfx` builds it in its new constructor, using getters so it reads the
  context and the buffer as they are after `unlock`.
- `Sfx` keeps all nine public methods as delegates and re-exports every type
  that used to come from it, so no caller changed. Both new headers state
  the "nothing is scheduled" invariant and the bus-in-a-local rule. Neither
  class holds a bus in a field.

There was one extra thing to handle: `playerHurt` uses the ambience's spark
gate for its grit. It now gets the curve from `AmbienceVoices.sparkShape`,
which is public for that one caller, so there is still one cache.

Apart from that, the move only changed the `this.X` → `this.core.X`
references, some comments, and one name: inside `AmbienceVoices` the emitter
map is `voices`, because `ambienceVoices` is now `Sfx`'s name for the class
itself. Comments that said "this file" now name `Sfx`
where they meant it. References that named the old home are updated in
`docs/audio.md`, `docs/vehicles.md`, `FINDINGS.md`, `FILES.md`,
`config/audio.ts`, `config/vehicles.ts` and `Vehicle.ts`. Two comments in the
moved code were already out of date and are fixed: `MixBus`'s doc named a
`Sfx.setMix` that no longer exists, and the `sparkThreshold` doc was stranded
above `HURT_SWEEP`. Two stranded docs in `Sfx` are back on what they describe:
`LoadedSample`'s had been sitting on `ThunderLayer`, and the class's own had
been sitting on `MixBus`.

Checked: `npm run typecheck` and `npm run build` pass. Equivalence was checked
with an offline render. Both versions of `Sfx` (HEAD's and this one) were
loaded in Chromium through Vite with a seeded `Math.random` and rendered 3 s
into an `OfflineAudioContext`. The cases were: the driven tank, every kind as
a hull engine, the driven rotor, wind-down through `engineOff`/`enginesOff`,
all three ambience kinds, `ambienceOff`/`ambienceAllOff`, `playerHurt`, and
the tank plus a fire with the `tankEngine` and `ambience` faders moved. The
largest sample difference between old and new is 1.5e-5. Rendering the old
`Sfx` against itself differs by up to 2.3e-5, so the remaining difference is
the renderer's own noise. The faders still move both families: the faded
render's energy is 178 against 1,106 unfaded. Nobody has listened in a live
round.

### 27. `Vehicle.ts`: extract `HullFlex` and the flight model

**Area:** `src/entities/Vehicle.ts` (4,192 lines). Read `docs/vehicles.md`.

1. **Suspension/flex** (~3753–4178: `stationTravel`, `springRate`, `gearLoad`,
   `flexSuspension`, `flexHeave`, `flexAntennae`) is purely visual, owns its
   own state (`heave*`, `susp*`, `whip*`, `tip*`) and reads only `rig`, `spec`,
   `windT`, `jolt` → `HullFlex` class.
2. **Flight model** (~1895–2340: `steerAuthority`, `rotorPower`,
   `tiltFromMotion`, `flyStep`) — state mostly `vel`, `yaw`, `tilt*`, `rotor*`.
   Second, harder seam; do it only if it comes out without exposing half of
   `Vehicle`'s fields.

**Constraint.** "No `if` anywhere on the kind" — the extracted classes must be
driven by the nullable spec blocks / `flies`, never a kind name.

**Acceptance.** A hull drives, flexes and flies identically; `npm run
simulate` runs (the authority steps hulls too).

**Done.** `Vehicle.ts` is 3,432 lines, down from 4,253. Both steps were done.

- **`entities/HullFlex.ts`** holds the wind bearing, the suspension's pitch
  and roll springs, the heave, the mast-foot rate, both whips, the wind clock,
  `stationTravel`, `springRate`, `flexSuspension`, `flexHeave` and
  `flexAntennae`. Three methods are new. `reset` is `placeAt`'s share.
  `kick` is the gun's rock and mast crack, taken out of `fireGun` with their
  comments. `lean` is the half of `leanHull` that writes `rig.sprung` and
  works out the mast-foot rate. `Vehicle` keeps the ground half of the
  attitude, because `standOnGround` and the flying branch both write its
  targets. `gearLoad` also stays, because it reads the rotor, and is handed
  in as `load`. `jolt` stays too (`standOnGround` writes it, the crash check
  reads it) and is handed to `flexHeave`.
- **`entities/FlightModel.ts`** holds `REMOTE_ACCEL_RATE`, `tiltFor`, the
  spool and the disc's run, the four attitude angles, the lagged velocity,
  `rotorPower`, `tiltFromMotion`, and `flyStep`'s cyclic, thrust and
  collective as three methods. `spool` is also new: it replaces the two
  copies of the spool-up arithmetic in `flyStep` and `updateRemote`.
  `Vehicle.flyStep` keeps everything that touches the hull itself: the
  pedals (`steerTo` and `steerAuthority`, which the ground path also uses),
  `yaw`, the measured `speed`, the height over the floor, and `lift`.
  `FlightModel` owns no position or velocity. It writes the `vel` it is
  handed (`thrust`) or returns a number (`collective`), so no field of
  `Vehicle` had to be exposed. `Vehicle.flight` is `spec.flight` resolved
  once and is null on the two ground kinds, so nothing branches on a kind.
  `Vehicle` reads four of its fields: `rotor`, `rotorRun`, `tiltPitch` and
  `tiltRoll`.

Apart from that it is a move. The only other changes are `this.X` becoming a
parameter or `fl.spec.X`, the lagged velocity becoming a plain `{x, z}` (the
class has no runtime Babylon import), and comments that named a method by
position ("two hundred lines below") now naming it. One stranded doc was also
fixed: `updateRemote`'s had been sitting on `correctTo`. On review, the
coordinated bank and the roll clamp, which `cyclic` and `tiltFromMotion` each
wrote out in full, became one private `bankInto` and one `drawRoll`, now that
both writers are in one class. References to the old home are updated in
`docs/vehicles.md`, `docs/multiplayer.md`, `config/vehicles.ts`,
`vehicleRig.ts` and FILES.md.

Checked: `npm run typecheck` and `npm run build` pass. `npm run simulate
sarab` ran a full round with crewed hulls (192 machine-gun kills, 8 track
kills, a shell). For equivalence, a NullEngine harness drove every kind
through a scripted run with mixed frame times: a tank and a truck over a kerb,
a car, a wall and a tilted slab and on open relief, firing both guns,
corrected, wrecked and coasting, each with a copy posed off its track through
`updateRemote`; and a helicopter taking off, cruising, strafing, turning,
landing, spooling down, corrected and wrecked, with a remote copy, plus a
second one shot down at altitude. It recorded every rig node's transform, the
collider, the exported points, `powerplant`, `washTo` and the gun state on
every frame. HEAD and this version match byte for byte over all 14,100
frames. Nobody has driven a hull in a live client.

### 28. `FrameProfile.ts`: split the recorder from the reporter

**Area:** `src/core/FrameProfile.ts` (3,155 lines). Read `docs/profiling.md`.

**Problem.** Recording (~1391–2043) must never allocate per frame; reporting
(~2044–2775 plus stats helpers ~3091–3155: `buildReport`, `*Facts`,
`worstHitches`, `trace`, `deviceFacts`) allocates freely. Only comments keep
the two apart.

**Fix.** `FrameProfile.ts` keeps the ring and the brackets; `profileReport.ts`
takes the report builder. Consider lazy-importing the reporter on capture so a
disarmed profiler never loads it.

**Acceptance.** A capture is byte-compatible (same report version); viewer at
`/profile_viewer.html` reads it.

**Done.** `FrameProfile.ts` is 1,743 lines, down from 3,141. It became three
files, not two.

- **`core/profileReport.ts`** holds the report's shape (`ProfileReport`,
  `PhaseStat`, `HitchFrame`, `LoafFrame`, `CreationEvent`,
  `ProfileGraphics`), the constants only a report reads (`CREATED`,
  `DEFINES_CAP`, `LOAF_FLOOR_MS`, `gpuFrameMeasurable`), `buildReport` and
  its `*Facts` helpers, `worstHitches`, `worstLoaf`, `madeAt`/`madeNear`,
  `deviceFacts`, the trace as `buildTrace`, and `stats`/`pick`/
  `onePercentLow`/`round`. They are plain functions over a `ProfileRing`.
- **`ProfileRing`** is what the recorder lends at a capture: its own fields
  under their own names, the typed arrays by reference (no copy), built by a
  new private `FrameProfile.ring()`. Three entries are not fields:
  `gcObserved` (the registry exists), `gpuAvailable` (the engine has a
  main-pass counter, asked by the recorder, which keeps every Babylon internal)
  and `engine`, for the backing store. The header says the reporter never
  writes the ring.
- **`core/profilePhases.ts`** holds `PHASES`, `P`, `SLOTS`, `PARENT_OF`
  and `ROOTS`. The report labels slots and ships the tree, and the recorder
  calls the report, so with the phases in either file the two would import
  each other. `Game` imports `P` from there now.
- **`FrameProfile.ts`** keeps the ring, the brackets, the hooks, the probes,
  `capture` and `last`, and a two-line `trace` that guards and delegates.
  Its public surface is unchanged, so `window.__profile` and the chip work as
  before. `ProfileChip` takes `ProfileReport` from `profileReport.ts`.

**Not lazy-loaded.** `capture` stays synchronous. The chip's VIEW opens the
reader's window inside the tap's user activation, and a smoke script reads
`window.__profile.capture(...)` on one line. Both would break if a dynamic
import came first. The reporter is 8.5 kB minified, 3.5 kB gzipped, against a
9.3 MB main chunk. This is written
in `docs/profiling.md`.

Apart from that it is a move: `this.X` became `r.X`, `worstLoaf`'s loop
variable became `rec`, and three guards that the ring's types make dead were
dropped (`if (this.loafMs)` and `!this.frameAt` in `worstLoaf`, the
`logT` null check). Comments in the moved code that said "the header" or "this
file" now name `FrameProfile`. Three stranded docs are back on their
methods: `hookRender`'s had been sitting on `hookEngine`, and `probeOverhead`'s
and `watchGc`'s had been sitting on `watchLoaf`. References to the old home
are updated in `docs/profiling.md`, `public/profile_viewer.html`'s comments,
`FINDINGS.md` and `FILES.md`.
Two comments that were already wrong are fixed: `markLoaf` said `loafFacts`
sums per row (it has summed once per window since v7), and
`docs/profiling.md` gave `PARENT_OF`'s key type without `"present"`.

Checked: `npm run typecheck` (client and server) and `npm run build` pass.
For equivalence, a Node harness bundled with esbuild drove HEAD's
`FrameProfile` and this one through the same 3,600-frame session with a
seeded clock, a NullEngine scene and fakes for the GPU device, the GPU
counters, the heap and long animation frames. The session laps the ring,
changes graphics settings, creates named and unnamed pipelines, and hits
hitches inside and outside the tick. It recorded every capture (compact and
full, early, mid and end, plus a one-frame and a disarmed capture), five
traces and the getters. The 14.4 MB of output is byte-identical, so the
report version is unchanged and the viewer reads what it read before. Nobody
has taken a capture on a real device.

### 29. `VehicleCrew.ts`: extract the pilot

**Area:** `src/systems/VehicleCrew.ts` (1,608 lines)

The piloting half (~1200–1607: `fly`, `offGraph`, `column`, `holdYaw`,
`collective`, `flyOn`, `pickAloft`, `aloftAlong`) reads only `this.nav` and
itself → `crewPilot.ts`. Ground driving (~970–1199) stays.

**Acceptance.** Bot-flown helicopters on Sarab/Cinderhaven behave as before
over a few minutes of a round.

**Done.** `VehicleCrew.ts` is 1,096 lines, down from 1,609. The pilot is in
`systems/crewPilot.ts` (567 lines).

- **`crewPilot.ts`** holds `fly`, `offGraph`, `column`, `holdYaw`,
  `collective`, `flyOn`, `pickAloft` and `aloftAlong` as module functions,
  plus the constants only they read (`AIR_DEPTHS`, `AIR_LATERAL`,
  `GROUND_COLUMN`) and their scratch (`_aloft`, `_at`, its own `_dir`).
  It owns no state. A pilot's `flyYaw` and `lostT` stay on `Crew`, because
  `take` starts them beside the rest, and the detour, reverse and stuck clocks
  are shared with the ground driver. `fly` takes the crew and the nav graph,
  and `VehicleCrew.stepCrew` calls it on `Vehicle.flies` as before.
- **`route` moved too**, and is exported. Both seats ask it, but its
  `onGround` argument is the pilot's question and `column` is what it turns
  into. Keeping it in `VehicleCrew` would have made the two files import each
  other at runtime. Now `VehicleCrew` imports `fly` and `route`, and
  `crewPilot` imports only the `Crew` type back, which is now exported. `route`
  writes into a vector it is handed instead of `VehicleCrew`'s `_dir`.
- **The header's air section moved verbatim** to `crewPilot.ts`, except
  that "this file" and "the paragraph above" now name `VehicleCrew.ts` and its
  road-graph argument. `VehicleCrew` keeps a summary and a pointer.

Apart from that it is a move. `this.X` became a parameter or a plain call,
and comments that named a ground-driver method now say `VehicleCrew.` in
front of it. One stranded doc was fixed: `_aloft`'s doc had been sitting on
top of `GROUND_COLUMN`'s, with the `let` two declarations below. References
to the old home are updated in `docs/vehicles.md` (the file table, the
contract scope, the crew section's pointer and three method names),
`config/vehicles.ts` and FILES.md.

Checked: `npm run typecheck` (client and server) and `npm run build` pass.
`npm run simulate sarab` ran a full round (9.7 min, 149 machine-gun kills, 6
shells, board balances). For equivalence, a harness built off
`vite.server.config.ts` ran `HeadlessGame` with `Math.random` seeded for
60,000 ticks (16.7 min) on Sarab and on Cinderhaven. It hashed every hull's
position, yaw, drive input and crew flag and every bot's position on every
tick. Both gunships on each map were bot-flown for the whole run. HEAD ran twice
to the same hash, and this version matches it on both maps. Sarab has all three
kinds, so the ground driver's `route` was covered too. Nobody has watched a
bot fly in a live client.

### 30. `CelShader.ts`: move shadow bindings out of the material factory

**Area:** `src/shaders/CelShader.ts` (3,917 lines). Read `docs/rendering.md`.

~450 lines (~3151–3547 plus `applyShadow` ~3670–3705) hold the flash, foliage,
body, local-atlas and cloud shadow setters and the consumer registry → a
`ShadowBindings` object. `CelMaterialFactory` stays a material cache with one
door (`remember`).

**Constraints.** Every cel material binds its samplers always (a declared
sampler must be bound — `CLAUDE.md`); the bumped ground variant is at 15 of 16
sampled textures per stage. Do not change binding order or count.

Moving the WGSL strings out (~332–539, ~550–1663) is a pure move with no
coupling gain — optional.

**Acceptance.** Screenshots of each map identical before/after (needs a GPU box
— see `VERIFYING.md`).

**Done.** `CelShader.ts` is 3,572 lines, down from 3,917. The shadows are in
`shaders/ShadowBindings.ts` (433 lines), reached as `mats.shadows`.

- **`ShadowBindings`** holds every shadow-map field (the world's, the
  bodies', the lamps' atlas with its per-slot arrays, the lightning's key and
  map, the clouds' field and its hold, and the foliage map), the consumer
  registry, every setter over them, `localSlots`, and `applyShadow`. The
  factory lends it its cache as a `ReadonlyMap` at construction, so a
  material minted later is walked by the next push without being told. The
  "no cloud anywhere" texel moved with the clouds. It is created in
  `ShadowBindings`' constructor, which the factory's constructor calls, so it
  still exists before any material does.
- **The irradiance volume stayed in the factory.** It is bound only on cel
  materials and it was never a shadow. The factory keeps a three-line
  `applyShadow` that every creation path still calls: it calls
  `shadows.applyShadow` and then `applyGi`. That is the same calls in the
  same order as before, so binding order and count are unchanged. The GI
  comment moved onto that door.
- **No runtime import cycle.** `ShadowBindings` sizes the lamp arrays off
  `MAX_LOCAL_SLOTS` from `wgsl/includes` instead of importing
  `MAX_POINT_LIGHTS` back from `CelShader`. The arrays are `celShadow`'s
  and are sized off that include's constant anyway, and `CelShader` already
  asserts the two are equal. The name lists (`SHADOW_*_NAMES`,
  `GI_*_NAMES`) stay in `CelShader`, because they describe what the shader
  declares.
- **`readLighting`'s three cloud getters** now read
  `shadows.cloudMap/cloudArea/cloudRay`, which are live references, as
  before.
- **Callers** (`Game`, `ShadowSystem`, `BodyShadows`, `LocalShadows`,
  `ReflectionSystem`, `GrassSystem`, `WaterSystem`) say `mats.shadows.X`
  where they said `mats.X`. No method was renamed. `isSolid` and
  `keyLight` stay on the factory: one is the material registry and the
  other is the environment.

Apart from that it is a move. Besides deletions, the `CelShader` side of the
diff adds only the import, the `shadows` field, the one-line constructor, the
small door, the three `readLighting` getters and `readonly` on the cache. In
the moved text, "the factory's own" now reads "this object's own", and
`this.cache` is now `this.cels`. One stale reference (`setLocalShadows`,
which never existed) now names `setLocalShadowMap`. References updated:
`docs/rendering.md` (the contract scope and four method names), `FILES.md`,
`wgsl/includes.ts`, and comments in `Game.ts`, `ReflectionSystem.ts`,
`CelShader.ts`, `LocalShadows.ts`, `BodyShadows.ts` and `GiVolume.ts` that
still said the factory did what `ShadowBindings` now does. "The three shadow
uploads" in the moved registry docs (and in `docs/rendering.md`) was already
stale before this ticket and now says "the shadow uploads".

Checked: `npm run typecheck` and `npm run build` pass. **Screenshots: all
22 bank vantages on all seven maps, before and after, on the Windows box.**
`plans/webgpu-ref/bank.mjs` could not take the reference. At HEAD every
vantage came back "NOT REPRODUCIBLE": two consecutive grabs of the frozen
frame differ, so the freeze set has fallen behind something that moves in a
held frame. That gap is open and not this ticket's. A scratch script on the
same harness (`bootMap`/`placeVantage`/`freeze`) stopped the engine's
render loop for the grab, which made every frame byte-stable. It shot HEAD
twice and this change once:

- HEAD vs HEAD, the control: mean 0 to 0.135/255 per vantage. The worst was
  Coldharbour's `curtain2`.
- HEAD vs this change: mean 0 to 0.137/255, the same vantages at the same
  sizes, and the worst was again `curtain2`.
- The only reading above its own control was Hollowmere `ashwood` (0.007
  against 0): a faint wash on a cart's shaded side. Two more runs of this
  change on Hollowmere differ from EACH OTHER by that same 0.007, and one of
  them matches HEAD to 0.0006. So it is per-process noise, not the move.

No page or console errors on any map. A lost binding would read as a black
or unshadowed surface at whole-percent means, not hundredths of a level.

### 31. `HUD.ts`: scoreboard to its own class, one 1% low

**Area:** `src/ui/HUD.ts` (2,412 lines)

- The **scoreboard** (~1739–2040) is pushed in every state by
  `Game.pushScoreboard`; its lifetime isn't gameplay chrome, which is all `HUD`
  is meant to own (`CLAUDE.md` UI section). → `Scoreboard` class with its own
  stylesheet import, appended to `#hud` like the other screens.
- The **FPS meter** (~897–1035) computes its own 1% low; `FrameProfile.ts:~3127`
  computes it separately, in different units (fps vs ms). → One shared helper
  in a tiny stats module both import.

**Acceptance.** Tab board looks and behaves the same in every state; FPS
readout's 1% low matches a capture's.

**Done.** `HUD.ts` is 2,007 lines, down from 2,412, and `hud.css` 1,407, down
from 1,766. The board is `ui/Scoreboard.ts` (444 lines) with
`ui/scoreboard.css` (365), and the 1% low is `core/frameStats.ts`.

- **`Scoreboard`** owns `#scoreboard`: `DEEP_ROSTER`, `ScoreboardParts`,
  `ScoreRow` (now exported from here), the frame, the keyed lists and the three
  last-written guards. `setScoreboard` is `Scoreboard.set`, and its inline
  payload type is the exported `ScoreboardView`. Otherwise the methods moved
  as they were: `buildScoreboard` is `build`, `this.scoreboard` is `this.root`,
  and the guards lost their `Scoreboard` prefix. It builds its own root and
  appends it to `#hud`. `Game` constructs it straight after `HUD`, before every
  other screen, so it sits in `#hud` where it used to: after the HUD's own
  markup and before every other root. Stacking is its `z-index: 9`, which did
  not change.
- **`scoreboard.css`** is the old `hud.css` scoreboard section, moved verbatim
  under a header of its own. Two comments in it named `setScoreboard` and now
  name `Scoreboard.set`. Nothing outside the section targeted `#scoreboard`
  except `base.css`'s token list, which only sets custom properties, so moving
  the rules later in the bundle changes no cascade.
- **The 1% low** is `onePercentLow(sorted)` in `core/frameStats.ts`. It is the
  mean of the slowest 1% of an ascending sample in the sample's own units, and
  it allocates nothing. The HUD hands it its ring in seconds and turns the
  answer into a rate (its method is now `lowRate`, so it does not shadow the
  import). `profileReport.ts` hands it the capture's frames in ms, and its
  private copy is gone. The argument for the tail mean over p99 moved from the
  HUD into the new module. An empty sample now reads 0 where the profiler's copy
  would have returned NaN; nothing calls it empty.
- **`HUD`'s header and its guard notes** stop listing the scoreboard. The
  guard note had said four rebuilds clear their own guards, and one of the four
  was the scoreboard. It now names the four that are left: the magazine strip,
  the grenade pips, the anti-tank pips (which were missing from the list) and
  the flag cells. `hud.css`'s header stops claiming the menu, round-over and
  pause cards, which live in `overlay.css`.
- **`Game`**: `pushScoreboard` calls `scoreboard.set`. Its doc comment had come
  loose above `pushTouchControls`'s, and it is back on `pushScoreboard`.

References updated: `docs/ui.md` (the screen list, the board's section, and
"the one markup rebuild left in `HUD`", which also named `Game.updateHud` as
the pusher), `docs/game.md`, `docs/world.md`, `docs/profiling.md`,
`FILES.md` (a `Scoreboard.ts` row and a `frameStats.ts` row), `FINDINGS.md`,
`VERIFYING.md` (whose tip named `updateGameplay` and `hud.setScoreboard`),
`ENGINE_UPGRADE.md`, and a comment in `OverlayScreen.ts`.

Checked: `npm run typecheck` passes. **In the browser, HEAD against this
change**, with Tab held on Hollowmere (16 bodies) and Sarab (48, the deep
board), in `deploy` and in `playing`, at 1920×1080, 844×390 and 390×844. Every
element under `#scoreboard` (162 on Hollowmere, 402 on Sarab) has the same
computed style and the same box. The board's text, its class list and its
parent are the same too, and it goes back to `hidden` on release. No page
errors. **The 1% low:** with `?profile` armed and the readout up for twelve
seconds on Hollowmere, the HUD's ring held 299 frames and read 25.15 ms
(39.76 fps). The capture's `series.frameMs` over the same last 299 frames
gives 25.15 ms too. The capture's own `onePercentLow` matched an independent
recompute over its whole series (838.1 ms, with the install frames in it).

### 32. UI screens: shared `setInputDevice` and `paintThumb`

**Area:** `src/ui/`

- `setInputDevice` is copied verbatim five times: `DeployScreen.ts:~303`,
  `LoadoutScreen.ts:~734`, `LobbyScreen.ts:~511`, `OverlayScreen.ts:~1187`,
  `SettingsScreen.ts:~636`. → one function in `ui/prompts.ts` (which already
  owns the per-device prompt drawing).
- `paintThumb` is a near-duplicate in `LobbyScreen.ts:~1427` and
  `OverlayScreen.ts:~1081`. → one function, parameterised on the difference.

**Acceptance.** Switching mouse → pad → touch flips prompts on every screen.

**Done.** Two functions, each in the module that already owned the thing they
do.

- **`markDevice(root, device)`** in `ui/prompts.ts` writes the `dev-*` class:
  it puts the one for `device` on and takes the other two off. All five
  `setInputDevice`s call it in place of their own loop. Each screen still keeps
  its `device` field and compares against it before calling, because that field
  is the screen's own state: its constructor writes it into the root's first
  class list, and the overlay writes it again whenever it builds a card. So
  `setInputDevice` stays a public method on each screen, and `Game`'s six calls
  to it are unchanged. The overlay still skips the write on a card that draws
  no prompts (the building card, or no card at all).
- **`paintMapThumb(canvas, def, again)`** in `ui/MapThumb.ts`. That file's
  header already said it owned "the fetch-and-upgrade order", but the order was
  written out in the two screens. It reads what has landed of the floor and the
  bake, draws, and books `again` for each half that has not. The difference the
  ticket asked to parameterise is the callback. Each screen's `paintThumb`
  keeps the two things only it knows: where its canvas is, and whether the map
  is still the one under the cursor. The lobby's callback also checks that the
  lobby is still up. The callback re-enters `paintThumb`, so the canvas is
  looked up again after a fetch, as before. The swallowed-rejection reasoning
  and the three-pass argument moved with the code. `OverlayScreen` and
  `LobbyScreen` no longer import `heightsOf`/`collisionOf`/`loadHeights`/
  `loadCollision`.

References updated: `MapThumb.ts`'s header (`drawMapThumb` still takes both
halves as arguments; `paintMapThumb` is now the one place that fetches them),
`prompts.ts`'s header, `docs/ui.md` (the schematic's three passes), `FILES.md`
(both rows; the prompts row had said the menu, the kit and the settings, and
now says the five title screens), a comment in `world/maps.ts` that called
`MapThumb` the bake's caller, and the `ui-screen` skill's primitives table,
which gains a `markDevice` row.

Checked: `npm run typecheck` passes. **In the browser, HEAD against this
change.** The device was driven through `InputManager`'s own last-used stamps,
so the push under test is `Game`'s real per-frame one. The run went kbm → pad →
touch → kbm on the menu, settings, the lobby, the deploy screen, the kit screen
and the pause card. On all six, the root's class followed every step, the
first prompt's label went from key to pad button (`Q`→`LB`, `Esc`→`B`,
`Esc`→`Start`, `R`→`X`), and the prompt was gone under touch. The results were
identical to HEAD's. **The schematics:** the menu's (378×378) and the lobby's
new-match map row (388×310) were each waited until stable with both halves
landed. Their `toDataURL` output is byte-identical between HEAD and this
change. No page errors.

### 33. `OverlayScreen.ts`: extract `MenuBackdrop`

**Area:** `src/ui/OverlayScreen.ts` (~1099–1186: `buildShotLayer`, `setShot`,
`showBackdrop`, `clearShot`)

The lobby drives the menu's photograph *through* the overlay
(`OverlayScreen.showBackdrop`). A `MenuBackdrop` object owning `#menu-shot`
and handed to both screens removes the indirection. Keep `#menu-shot` a root
of its own at z-index 9 (`CLAUDE.md`: a child of `#overlay` would paint over
the scrim).

**Acceptance.** Menu reel and lobby both change the photograph; closing the
lobby restores the menu's map.

**Done.** `OverlayScreen.ts` is 1,972 lines, down from 2,088, and `overlay.css`
is 2,306, down from 2,371. The photograph is `ui/MenuBackdrop.ts` (152 lines)
with `ui/backdrop.css` (73).

- **`MenuBackdrop`** owns `#menu-shot`, its two layers, which layer is in front
  and the URL last asked for. It has three verbs:
  - `show(map)` was `setShot`: the cross-fade on a decode, and the URL guard
    that lets the latest pick win.
  - `showNamed(map)` is the prelude the building card and the round-over card
    each had pasted. A picture the layers do not already hold takes the front
    layer down first, so the last map's photograph never stands behind this
    map's name.
  - `hide()` was `clearShot`, and it takes the container down, not the layers.

  The field docs and the two load-bearing reasons it is a root of its own
  moved into its header. `backdrop.css` is the old `overlay.css` backdrop
  block plus its reduced-motion rule, moved verbatim apart from one comment
  that named `OverlayScreen.shotRoot`. The layer class stays `.ov-shot`, so
  the DOM is unchanged.
- **`Game` builds it** just before `OverlayScreen`, so `#menu-shot` sits in
  the same place as before: after the scoreboard and right before `#overlay`.
  `Game` hands it to `OverlayScreen` and `LobbyScreen` as a constructor
  argument and keeps no reference itself.
- **`OverlayScreen`** calls `backdrop.show` from `showMenu`, `showNamed` from
  `showRoundOver` and `showBuilding`, and `hide` from `showPause` and `hide`.
  `showBackdrop`, `setShot`, `clearShot`, `buildShotLayer` and the four shot
  fields are gone, and so is its `mapShotUrl` import.
- **`LobbyScreen`** puts its own map up. `onBackdrop` and its `Game` wiring
  are gone. The lookup from id to `MapDef` moved into the lobby, which already
  imports `MAPS`. The guard moved with it. `showBackdrop` had refused unless the
  menu card was up; the lobby now pushes only while it is itself visible.
  That is the same condition, because `ScreenSpec` lets the lobby cover the
  menu and nothing else.

References updated: `CLAUDE.md`'s UI section (the lobby drives the photograph
through `MenuBackdrop`, not `OverlayScreen.showBackdrop`), `docs/ui.md` (the
backdrop section names the class, and the lobby's photograph paragraph had
described the old callback hop), `FILES.md` (a `MenuBackdrop.ts` row; the
overlay row stops claiming `#menu-shot`; the lobby row stops naming
`onBackdrop`), `lobby.css`'s header, both file headers, and the `ui-screen`
skill's craft notes.

Checked: `npm run typecheck` and `npm run build` pass. **In the browser, HEAD
against this change**, over one scripted sequence logged at every step: which shot is in
front, both layers' classes and images, `#menu-shot`'s `on`, opacity,
z-index, animation, and its index in `#hud` beside `#overlay`'s. The sequence:
- the menu on Hollowmere, and the reel stepped with the bumper key (to
  Greyfen);
- the lobby opened over it, with a live Sarab match injected;
- the cursor on that match (Sarab), the NEW MATCH page (Greyfen), and back on
  the match (Sarab);
- the lobby closed, which put the menu's map back (Greyfen);
- `startRound`, with the building card up; the deploy screen (photograph
  down); a pause (down); and quit to menu (back up).

All 15 steps are identical between the two runs, with no page errors. The
sequence never put a card up for a map the backdrop was not already showing.
So `showNamed` was checked on its own as well: a different map takes the front
layer down in the same tick and fades in on decode; the same map is a no-op;
and a plain `show` keeps the old picture until the new one decodes.

### 34. Vehicle models: shared `resetRigPose` and `whip`

**Area:** `src/entities/TankModel.ts`, `TruckModel.ts`, `HeliModel.ts`

- `resetTankPose` (`TankModel.ts:~1151`), `resetTruckPose`
  (`TruckModel.ts:~1170`), `resetHeliPose` (`HeliModel.ts:~1329`) are identical
  apart from the spec → one `resetRigPose(rig, mats, spec)` in `vehicleRig.ts`.
- The `whip()` antenna builder is copied with different numbers
  (`TankModel.ts:~1008–1040`, `TruckModel.ts:~1064–1096`) → one builder taking
  those numbers as parameters.

**Acceptance.** A respawned hull of each kind is posed correctly; antennae
look unchanged.

**Done.** The three models lose 26 to 37 lines each (`TankModel.ts` 1,163 →
1,126, `TruckModel.ts` 1,181 → 1,145, `HeliModel.ts` 1,340 → 1,314), and
`vehicleRig.ts` gains the two helpers (479 → 569).

- **`resetRigPose(rig, mats, spec)`** replaces `resetTankPose`,
  `resetTruckPose` and `resetHeliPose`. It reads `spec.antenna.baseShare`,
  the one number that differed. The tank's copy reset `rig.gun` through `?.`
  and the other two did not touch it, because their `gun` is null. The shared
  copy keeps the `?.`, so it does the same thing on all three.
- **`whip(scene, segment, drawing)`** builds one mast: the two nodes, the two
  links and the `Whip` it returns. A `WhipDrawing` carries every number a
  model states: name, parent, foot, length, the longest mast (for `rate`),
  phase, colour, the three diameters of the taper, and an optional `cap`
  (diameter and height, so `vehicleRig.ts` still states no geometry of its
  own). The
  shared comments (the taper, the cap, `1/L^2`) moved onto it. What is about
  one model stayed in that model: the tank's 2.4/3.8 Hz, why the masts are
  where they are, and the clearance under the heli's disc.
- **The heli's loop was a third copy** with different names and no cap, so it
  goes through `whip` too. Its nodes and meshes are renamed to the other two
  kinds' pattern: `heli-whip-base0` is now `heli-whip0`, `heli-whip-tip0` is
  `heli-whip0-tip`, and `heli-whip-lo0` is `heli-whip0-lo`. Nothing reads
  those names.

References updated: the respawn paragraph in `docs/vehicles.md` and the
`buildTank` doc comment, which both named `resetTankPose`, and `FILES.md`'s
`vehicleRig.ts` row, which now lists the two helpers.

Checked: `npm run typecheck`. A scratch script builds every kind for both
teams under a NullEngine and hashes it in three ways: geometry (vertices and
indices), node and mesh names with their parents, and pose (every node's and
mesh's transform and material). It hashes the pose four times: as built,
after one `reset`, after every joint is disturbed (and the running gear run,
the masts bent and the hull charred), and after a second `reset`. **HEAD and
this change give the same geometry and the same four pose hashes on all six
builds**, and the second `reset` matches the first on both. The one
difference is the heli's names hash, from the rename above.

### 35. Decompose `Bot.update`, `ViewModel.update`, and Player's recoil vector

**Area:** `src/entities/Bot.ts`, `ViewModel.ts`, `Player.ts`. Extract-method
only; no file splits.

- `Bot.update` (~751–1215, ~465 lines): the per-state steering switch
  (~797–983), look-target choice (~1085–1133), foot turning (~1134–1176).
- `ViewModel.update` (~1387–1725): break into pose layers; the gesture poses
  (~1726–2126) are already separate.
- `Player`'s recoil-vector code (~1031–1232) touches only kick and string state
  → a pure module beside `core/recoilCurve.ts`. `CLAUDE.md`: "The recoil vector
  is built in `Player.recoilKick`, never at the call site" — keep
  `recoilKick` as the entry point.

**Acceptance.** Bots behave as before (watch a round); recoil traces identical
(log `kickDrift` and the aim offsets over a held string before and after).

**Done.** All three are extract-method only. Every operation is the same
and runs in the same order, so all three traces below are byte-identical to
HEAD.

- **`Bot.update`** goes from 451 lines to 167. Three methods come out of it:
  - `steer(dt, ctx)` is the per-state switch. It writes the heading into
    `_dir` and the crouch wish into `wantCrouch`, and returns the speed. The
    burn reflex and the modifiers that apply to every state stay in `update`,
    after the switch.
  - `faceLook(dt)` picks what to look at and slews the yaw toward it.
  - `turnFeet(dt)` turns the feet and the torso twist.

  The comments moved with their code. The movement integration and the stuck
  watchdog are still inline, because the ticket did not name them.
- **`ViewModel.update`** goes from 327 lines to 61. It works out the gesture
  weights (the reload, the load, the bolt cycle, the aim blend `t`), then
  calls the pose layers in their old order:
  - `poseCarry`, `layerLoad`, `layerCycle`, `layerSwap` and `layerThrowGive`
    (which returns whether a throw is in flight);
  - `layerSway`, `layerBob` and `layerAirborne` (the jump give and the landing
    absorb);
  - `layerKick` and `layerAction`;
  - `applyPose` (the zoom compensation, then the write to the weapon node);
  - `poseHands` (the bolt, the reload or the load, the support arm, and the
    throwing hand). `poseThrowHand` now reads the throw's timings itself, so
    they are derived in one place.

  The order matters, because the layers add into the same vectors and
  floating-point sums depend on order. The new doc on `update` says so.
- **Player's recoil arithmetic** moves to `core/recoilVector.ts`, next to
  `recoilCurve.ts` (274 lines with the arguments that came with it).
  `Player.ts` goes from 2,730 lines to 2,599. The module has `hasString`,
  `firstShotRamp`, `stanceScale`, `aimKick` (the pattern envelope, plus the
  `AimKick` type it returns), `sweepDrift`, `kickWeightOf`, `punchShockOf`,
  `blendKickShape` and `actionJolt`. It holds no state and draws no random
  numbers.
  - `Player` keeps the string state and both draws. `tryShot` still draws the
    sweep direction and then the round's noise, in that order, and hands both
    in.
  - `recoilKick` is still the entry point, and is now a few lines over the
    module.
  - `stringed`, `kickWeight`, `kickShapeAt`, `viewActionJolt` and
    `punchShock` stay as one-line delegates, so nothing that reads them
    changed. The bolt-gun and equipment exemption stays in `viewActionJolt`.
    `recoilRamp` is gone, because `firstShotRamp` replaces it.
  - The doc block for `recoilKick` had been sitting above `kickWeight`. It is
    back on `recoilKick`.

References updated: the `Player.ts` header (the arithmetic is the module's
and the state is Player's), `docs/weapons.md`'s `Player.recoilRamp`, and
`FILES.md`. `FILES.md` gets a `recoilVector.ts` row, plus a `recoilCurve.ts`
row it never had.

Checked: `npm run typecheck` and `npm run build`. Three seeded traces, each
run on HEAD (the change stashed) and on this change:
- **Recoil.** A NullEngine `Player` fires every primary and the pistol in
  every selector position, at three stances (hip, aimed and crouched, and
  half-aimed while moving and airborne), with a held trigger and a tapped one.
  For each fired round it logs `kickDrift`, `recoilKick`'s pitch, yaw and
  `opensString`, `punchShock` and `kickWeight`. Every frame it also logs the
  model's kick value and the action jolt. **8,155 rows, identical.**
- **ViewModel.** A NullEngine `ViewModel` runs every carried item with every
  sight, in tactical and dry runs, over a scripted 520-frame timeline. The
  timeline covers ADS in and out, a sprint, a kick and action string, the bolt
  cycle aimed and at the hip, a swap, a reload, the launcher's load, a jump, a
  landing and a throw. Every frame it hashes every node's transform and
  enabled flag. **126 runs (113 distinct), identical.**
- **Bots.** A headless authority round (`HeadlessGame`) with `Math.random`
  reseeded after the round is built. Every tick it hashes every bot's state,
  position, eye, look and feet yaw, move amount, aim angle, stance, health
  and target. Every tenth tick it also hashes every rig joint. **20,000 ticks
  on Hollowmere (123 kills) and 12,000 on Coldharbour (66), identical.**

One thing the traces turned up: something on the module-loading path draws
from `Math.random`, and adding an import changed how many draws it made. So a
trace seeded once, at process start, moved when nothing it measured had. All
three harnesses reseed after loading, before they fire or step.

### 36. Vehicle capability idioms: three soft spots

**Area:** vehicles

- `Vehicle.ts:~2757` tests `this.spec.flight &&` where `this.flies` exists →
  use `flies`.
- `VehicleCamera.ts:~134, ~144, ~151` initialise from `CONFIG.vehicles.tank` —
  the camera "starts out as a tank". Initialise from neutral values or the
  first hull mounted.
- `CLAUDE.md` says the gun marker and the server's rate gate read
  `Vehicle.armed`; they actually test the nullable spec block (`Game.ts:~6266`,
  `~8903`, `Match.ts:~2552`, `HeadlessGame.ts:~1220`) because TypeScript needs
  the narrowing to reach the gun's numbers. Either amend the doc ("`armed` or
  the `gun` block it was resolved from") or add a typed accessor
  (`Vehicle.gun(): GunSpec | null`) and use that everywhere.

**Acceptance.** No kind-specific defaults; doc matches code.

**Done.**

- **`Vehicle.ts:~2757` was already fixed.** Ticket 27 moved the attitude
  into `FlightModel`, and `settle` now asks `this.flight` (the nullable
  block resolved once). The one `this.spec.flight` read left in `Vehicle.ts`
  is `aloftAt`, which needs the ceiling's numbers. That falls under the third
  bullet's rule, so it stays.
- **`VehicleCamera` no longer starts out as a tank.** `view` and `mount` are
  null until the first `take`, `pitch` starts at 0, and `aim` returns early
  if nothing has been mounted. Nothing could see the old defaults: `aim` is
  only reached from `Game.updateDriver`, `take` always comes first, and every
  read of `yaw`/`pitch` is behind `this.driving`. `take` now reads
  `restPitch` off the hull rather than off the field it just wrote.
- **The doc was amended, not the code.** A `Vehicle.gun()` accessor would
  only rename `spec.gun`. The rule is now written as it is practised: a
  reader that wants a yes or no asks `armed`/`flies`, and a reader that needs
  the numbers (a range, a reload, a ceiling) narrows on the block. That is the
  same fact, and still never a kind. The real `armed` readers are the trigger
  (`gunReady`, `fireGun`, the touch layer's fire button for a driver) and the
  crew's lay-and-fire. The block readers are `loadProgress`, the gun marker,
  `resolveShell` (now in `systems/hullRules.ts`, which is where the
  `HeadlessGame.ts:~1220` site went in ticket 6), a client drawing somebody
  else's `cannon`, and `Match.onShell`. Amended: `CLAUDE.md`'s vehicles
  section, `docs/vehicles.md`'s capability table and its two bullets, the
  `Vehicle.armed` doc comment (which also said `Vehicle` used it in two
  places; it is three) and the `vehicleKinds.ts` header.

Checked: `npm run typecheck` and `npm run build`.

### 37. `Props.ts`: drop the `Math.random` defaults

**Area:** `src/world/Props.ts` (~20 builders, e.g. :189, :616, :944 … :4845;
header ~49 explains why)

Builders default `rng`/`sub` to `Math.random`. Every real call goes through
the typed `SCATTER_BUILDERS` with the seeded stream, so this is a latent trap,
not a bug — but `CLAUDE.md` says "never call `Math.random()` in world-building
code, or the nav graph differs between page loads". Only `MapBuilder` imports
`Props`, so removing the defaults costs nothing and turns a missing seed into a
compile error. Can be folded into ticket 23.

**Acceptance.** No `Math.random` reference in `src/world/` outside comments.

**Done.** Ticket 23 had already split `Props.ts` into `world/props/`, so the
defaults were spread over twelve files there: 28 `rng`/`sub` parameters
defaulting to `Math.random`. All 28 are now required. The three `sub = rng`
defaults (ash, maple, jungle tree) stay, because they fall back to a seeded
stream. Nothing had to change at a call site: `SCATTER_BUILDERS` and
`kit:hash` already pass both streams. The `props/index.ts` header that
explained the default now says why there is none, and the jungle tree's
`sub` note stops promising a two-argument call. `grep Math.random src/world`
finds only comments.

Checked: `npm run typecheck`, `npm run build`, and `npm run kit:hash --
--against` a baseline taken before the change: 3,722 builds of 105 kinds,
**identical** (drawing and colliders).

---

## P3 — hygiene

### 38. `textures.ts` has its own PRNG

**Area:** `src/world/textures.ts:~85`

It defines its own `mulberry32` instead of importing `src/world/rng.ts`, whose
header says it is "the one seeded PRNG". Deterministic, so not a rule
violation — just a copy. Import from `rng.ts`; textures must be byte-identical
(check a texture hash or screenshot).

**Done.** The local copy is deleted and `textures.ts` imports `mulberry32`
from `./rng`. The two function bodies were diffed before the copy went and are
character-for-character the same, so every seed draws the same sequence and
every texture is byte-identical by construction rather than by a screenshot.

Checked: `npm run typecheck` and `npm run build`.

### 39. `FrameProfile` depends on a private Babylon internal

**Area:** `src/core/FrameProfile.ts:~1740–1755`

It wraps `WebGPUCacheRenderPipeline._buildRenderPipelineDescriptor`, a private
Babylon method. The code documents that an upgrade would only cost the
pipeline names, which is acceptable — but it should **fail loudly once** (a
`console.warn` on arm when the method is missing) rather than silently, so a
Babylon bump is noticed. Add a line to `docs/build.md`'s upgrade notes if one
exists.

**Done.** `hookCreation` now `console.warn`s when
`_buildRenderPipelineDescriptor` is missing, once per page through a
module-level flag rather than on every arm, since the method stays gone for the
life of the bundle. The warning says the counts still hold and only the names
are lost, and it points at `docs/profiling.md`. The method's comment says so
too. `docs/build.md` has no upgrade notes section. The upgrade note already
lived in `docs/profiling.md` ("check that a capture reads `pipelines.named:
true`"), so that paragraph gained the line about the warning instead.

Checked: `npm run typecheck` and `npm run build`.

### 40. `CLAUDE.md` is over its own cap

**Area:** `CLAUDE.md` (2,004 lines vs ~1,500 cap). Follow its own rules: move
argument **verbatim** to the companion, then trim what's left to stated rules.

| section | lines | cap | over |
| --- | --- | --- | --- |
| The scene has (almost) no Babylon lights | 224 | 85 (135 at most) | +89–139 |
| The map is data, not code (has the overrides table) | 187 | 135 | +52 |
| Multiplayer | 148 | 85–135 | +13–63 |
| The interface is five screens | 120 | 85 | +35 |
| Measuring a frame | 95 | 85 | +10 |
| First person / loadout | 91 | 85 | +6 |
| Vehicles | 89 | 85 | +4 |
| The four long sections together | 439 | ~340 | +99 (Conventions alone 172) |

Also:
- `## Project overview` (158 lines) escapes the per-section cap by being `##`;
  ~105 of its lines (~94–202) are the audio subsystem's argument (faders, buses,
  ambience slots, water emitters) and belong in `docs/audio.md`. Leave the
  rules a non-audio author could break.
- **Stale:** "Files not to edit" lists `undefined/` as a tracked stray
  directory. It no longer exists and git tracks nothing under it — delete the
  line.

**Acceptance.** Under ~1,500 lines; no rule lost (diff each companion to
confirm the argument arrived verbatim).

**Done.** `CLAUDE.md` is 1,505 lines, down from 2,013. Each over-cap section
was cut by the spine's own rule: argument first, then rules only that
subsystem's author can break. Every cut passage was checked against its
companion. Where the companion already carried it (most of them), the
`CLAUDE.md` copy went. Where it did not, the passage was MOVED verbatim.

| section | before | after |
| --- | --- | --- |
| Project overview | 158 | 65 |
| First person / loadout | 91 | 80 |
| The interface | 120 | 80 |
| The scene has (almost) no Babylon lights | 224 | 125 |
| The map is data, not code | 187 | 107 |
| Visual meshes and collider proxies | 130 | 104 |
| Vehicles | 92 | 80 |
| Measuring a frame | 95 | 65 |
| Multiplayer | 148 | 99 |
| Conventions | 172 | 105 |

The four long sections (wiring, colliders, metadata, conventions) total 346
lines against ~340.

What arrived in the companions verbatim:
- `docs/audio.md`: the VOICE/MOMENT/BEAT/BLAST argument with the
  `report.pitch` inversion, and "nothing in it is scheduled".
- `docs/build.md`: the WebGPU gate's cost in reach (a section of its own),
  the deleted GLB modules, and the seventeen recordings. That last item
  replaces a stale "TEN audio files" paragraph.
- `docs/rendering.md`: the map's grime paragraph whole, `shadowWindow.ts`,
  and the water's "sampled from nothing" lead.
- `docs/world.md`: the shipped maps one line each, Sarab spending the levers,
  the proving ground paragraph, the road depth step, the road-ink rule, and the
  body-at-rest-in-a-collider measurement.
- `docs/weapons.md`: what the SHOVE reaches, the `addFlinch` argument, the
  aim having no shoulder, the SWING/WALK sentence, and `recoverFraction` as
  the first lever back.
- `docs/ui.md`: the row-of-picks argument. The doc cited that rule twice but
  never stated it.
- `docs/vehicles.md`: the unforced-world-matrix sentence.
- `docs/profiling.md`: the phase-list sentence.
- `docs/multiplayer.md` needed nothing. Every cut there was already in it, or
  in `docs/states.md` or `docs/ui.md`.

Each section's pointer paragraph now names what moved.

Fixed along the way:
- The stale `undefined/` line is deleted.
- `docs/vehicles.md`'s capability table said `flies` had nine readers where
  its flight section lists ten. It was missing `gearLoad`.
- Two recoil figures in `CLAUDE.md` disagreed with `docs/weapons.md`:
  - "two rounds in three" against "roughly a third", the latter matching
    `recoil.ts`.
  - 2.9x against a measured 3.03x.

  Neither was carried across. The companion's figures stand.

Left for later:
- `docs/build.md`'s `audio/` bullet still quotes the ten-file kit ("Eight
  reports and one magazine change", "2.45 of 44").
- `docs/world.md`'s road-ink paragraph still argues from the retired
  `addOutline` hull.

Two rules came out in the first pass and were put back on review, because an
author outside the subsystem can break each: the `report.pitch` inversion with
"the ROOM is the game's" (the old overview had said both reach outside
`audio/`), and "each sound cue comes from whichever side actually knows"
(the addressed crack).

Checked: section line counts, and a read-through of every spliced section.
Every bolded claim in the old file was then matched against the new
`CLAUDE.md`, the companions and the source headers, and each one that left
`CLAUDE.md` was found in a companion.

`scripts/check-audio.mjs` pins countable sentences to the file they live in.
Its row for "which is what keeps N files serving" now points at `docs/audio.md`,
where that sentence moved. It also gained two rows for `docs/build.md`'s new
"SEVENTEEN audio files … but for those seventeen", since the unguarded copy
that sentence replaced had drifted to TEN.

Checked: `npm run build`, every gate included.

### 41. `FILES.md` has no `scripts/` section

**Area:** `FILES.md`

No stale entries (all 284 listed files exist), but 25 tracked files are
unmapped:
- all of `scripts/*.mjs` — bake-collision, collision-hash, check-world-parity,
  check-deep-imports, check-audio, kit-hash, loc, the seven generators,
  encode-audio, measure-audio, etc. (`check-proving.mjs` gets only a passing
  mention at ~1084).
- `src/core/recoilCurve.ts` — linked by name from `CLAUDE.md`.
- `src/vite-env.d.ts`.

Add a `scripts/` section, one line per file, in the same style. Add new files
from tickets 15, 16, 19, 22–34 as they land.

**Done.** `FILES.md` has a `scripts/` section after `server/`, one entry per
file for all 27 (the 25 at the top and `lib/mapgen.mjs`, `lib/footprints.mjs`
from tickets 15 and 16). Each entry says what the script does, read off its
header, and which npm script runs it: the four build gates in the order
`npm run build` runs them, the bake and its parity check, the two browser
helpers, `kit:hash`, `loc`, the audio pair and `ffmpeg.mjs`, the icon, foam
and proving-ground generators, the seven map generators with their flags,
and the two `lib/` modules. `src/vite-env.d.ts` is mapped under `src/`. The
two Vite configs are mapped beside `main.ts`, since each carries real code
under a contract header. `recoilCurve.ts` and every file split out by tickets
15, 16, 19 and 22–34 had already been added as those tickets landed. The
passing `check-proving.mjs` mentions under `proving/` stay, because they say
which string each file carries. The file's opening code fence was missing,
so the `server/` block rendered as prose and the fence after it opened the
rest. It now opens before `server/` and closes once at the end.

No stale entries: every listed path exists. 431 tracked files are mapped,
up from 401. The tracked files still unmapped are outside the module map by
its own convention. `public/manifest.webmanifest`, `public/icons/` and
`server/README.md` are named in their directory's line. The rest are config
(`tsconfig.json`s, `package.json`), docs, `audio/`, `shots/`, `textures/`,
and the scripts under `plans/` and `.claude/skills/`, which their own
README and SKILL files map.

Checked: a script that walks `FILES.md`'s tree into full paths and compares
them with `git ls-files`, before and after. Zero unmapped files remain under
`src/`, `server/` (code) and `scripts/`, and zero listed paths are missing.

### 42. `FINDINGS.md` §1 carries closed history

**Area:** `FINDINGS.md` (2,165 lines, 22 entries)

Entries spot-checked (§1, 13, 16, 20, 30, 38, 39) are all genuinely open. The
problem is bulk: §1 is ~470 lines, but the open part is four bullets (a)–(d) at
~25–41. The rest is closed history: "The headless, uncapped GC reading —
OVERTURNED", three "ANSWERED" subsections, "Candidates, as they stood before
the capture", "The instrument bugs… all fixed". Move the measurements that
still justify a rule into `docs/profiling.md` (verbatim), delete the rest
(git keeps it), and leave §1 as its open bullets plus pointers.

**Done.** §1 is 157 lines, down from 469, and `FINDINGS.md` 1,852 from 2,165.
What stayed is what is still open: the status and bullets (a)–(d), the laptop
table and its reading (ask (c)), the second population with its heap correlate
and burst shape (ask (a)), the frame-2291 paragraph (ask (b)), the other
devices' captures, and "How to settle it". A new paragraph lists each
eliminated suspect beside the `docs/profiling.md` section holding its evidence.

What moved to `docs/profiling.md` verbatim, each beside the rule it justifies:
- "Uncapped, the collector reading lies" (new, under "The heap and the
  collector"): the uncapped-allocation warning, the headless GC-frame table,
  the ~50 MB/s on every map, "the other four fifths", and the exoneration
  table.
- "Finding WHO allocates": the sampler's 0.2 against 51.6 MB/s, and per-site
  attribution needing an A/B.
- "The residue splits in two": the `renderStart` table showing a hitch is a
  wait before the rendering steps.
- "The phases": the 18-of-21 / 8-of-9 re-attribution and the 8x-throttle
  check of the pairing fix.
- "GPU time": the 8x `setHardwareScalingLevel` sweep (not fill).
- "Compiles": 29/73 creations in warm-up and 6/2 in play.

Deleted (git keeps it): the vsync-on table, the long-frame table, the v3
real-machine table, "the better hypothesis" (now bullet (d) plus "Compiles"),
the instrument-bug pointer, and the candidate list. Repointed at `docs/profiling.md`: `docs/rendering.md` (three
references), `docs/audio.md` and `audio/manifest.json` (the 157 MB heap), and
`config/profiling.ts` (`creationsKept`'s 6 in 40 s).

Checked: `npm run typecheck`, `node scripts/check-audio.mjs`, and a grep for
every reference to §1 in the tree, each confirmed to land on text that still
exists.

### 43. Dead and over-exported symbols

**Area:** `src/`

- **Dead (zero references anywhere) — delete:** `buildLantern`
  (`src/world/Props.ts:~3390`, ~47 lines), `emptyHeightfield`
  (`src/world/TerrainField.ts:~70`), `isStructural`
  (`src/editor/params.ts:~540`). Check `buildLantern` isn't a scatter kind
  first: removing a scatter builder must not shift seeded draws.
- **Over-exported:** 34 more exported symbols are used only in their own file
  — e.g. `BODY_CEL_NAME`, `CHARRED`, `isFinishId`, `SETTING_DEFAULTS`,
  `VEHICLE_KINDS`, the `ROAD_*` constants in `roadPaths.ts`,
  `MUDBRICK`/`WHITEWASH` in `kit/desert.ts`, `GYRO_MODES`. Drop the `export`
  keyword. To list them all: for each `export (const|function|class)` name in
  `src/`, grep `src/ server/ scripts/` excluding its own file; zero hits = over-
  exported. (Careful with `roadPaths.ts`: Node generators import it by type
  stripping — grep `scripts/` too.)

**Done.** The three dead symbols are deleted. `buildLantern` was in no
scatter table and nothing called it, so no seeded draw could move; `IRON`, the
colour only it wore, went with it. Deleting `isStructural` also removed the
step in `.claude/skills/model-detail/new-model.md` that told a new builder to
register there, since nothing reads it.

51 symbols lost their `export`. The scan was the one proposed, run over
`const`/`function`/`class`/`let`/`enum` in `src/` and `server/`, against
`src/`, `server/`, `scripts/`, the root `.ts` files, `index.html` and
`public/`. Two changes to it:
- It also counted a hit that was only a COMMENT naming the symbol as no hit.
  That found 24 more, among them six of the seven `MapDef` constants in
  `maps.ts` (`CINDERHAVEN` had no hit at all), `WORLD_CEL_NAME`,
  `GI_UNIFORM_NAMES`, `ROAD_BEND_CUT` and `ROAD_RANK_STEP`.
- `server/` was scanned as well, which found `BALLOT_SIZE`.

`MUDBRICK` and `WHITEWASH` are no longer on the list: the desert kit split into
`kit/desert/`, and `adobe.ts` and `caravanserai.ts` import them.

Un-exporting showed three more that nothing read at all, in their own file or
anywhere else:
- `INTERP_DELAY_MS` in `net/protocol.ts`. It has been unread since the initial
  migration, and the client draws at `CONFIG.net.interpDelay`. The five
  comments that named it (`protocol.ts`, `server/lagComp.ts`, `server/Match.ts`,
  `config/net.ts` and `docs/multiplayer.md`) now name `CONFIG.net.interpDelay`.
  The deleted doc claimed the delay and the rewind window were one constant;
  they are not, so `config/net.ts` now says the delay shares
  `REWIND_WINDOW_MS` with the shot's trip to the authority.
- `toLocalXZ` in `boxGeometry.ts`, and with it `intoFootprint`, which only
  `toLocalXZ` called. `intoFootprint`'s doc line moved onto `intoTopFace`. The comments in
  `boxGeometry.ts`, `MapBuilder.ts` and `ObstacleField.ts` that pointed at
  `toLocalXZ` say the same thing without it.

Type and interface exports were left alone: the ticket's scan names
`const|function|class`, and many of those types sit in the signature of an
exported function.

Checked: `npm run typecheck`; `npm run build`, with every gate passing; the scan
re-run, with zero symbols left; and `roadPaths.ts` loaded under Node's type
stripping, which still exports what the generators import (`bendPath`,
`roadNetwork`, `stripSections`).

### 44. Stale comments in `Game.ts` and `docs/game.md`

**Area:** `src/core/Game.ts`, `docs/game.md`

- ~641: orphaned "Moon shafts" doc comment stacked on another one.
- ~~~659–664: the `?volumetrics` doc is stranded above `minimapOff`'s, so
  `volumetricsForced` (~677) has none.~~ Gone with ticket 19: the four
  overrides moved into `core/urlOverrides.ts`, each with its own doc. The
  motion blur's doc, stranded above `volumetricsWanted`, is back on
  `setMotionBlurEnabled`.
- ~911: "Reused each frame: the player plus every bot…" describes
  `combatants` (~963) but sits above `net`.
- ~1468–1473: says "three clients", then "into both… both clients".
- `docs/game.md`'s header "Two things are pushed from `tick`" — `CLAUDE.md`
  says four, and `tick` actually pushes about a dozen. Make the doc list what
  `tick` pushes and why.

**Done.**
- The orphaned "Moon shafts" line is deleted. The shafts' own doc under it was
  already right.
- "Reused each frame…" now sits on `combatants`. It also names the list's two
  other readers, `awardZone` and the grass, and says why no hull is in it.
- The physics comment says three clients throughout.
- `pushHullEngines` had no doc of its own, so `pushAmbience`'s "its neighbour"
  pointed at nothing. It has one now.
- `docs/game.md`'s section is now "What `tick` pushes, not a state's own arm".
  It has a table, in frame order, of every push `tick` makes, what states each
  is owed to and why. The eye and scoreboard arguments stay under it verbatim,
  except the claim that the eye is pushed "last thing before `scene.render()`".
  That stopped being true when it moved into `followEye`, ahead of the GI,
  the audio and the scoreboard. `pushTouchControls` gets a sentence beside
  the scoreboard, since it is the same case.
- `CLAUDE.md`'s "Four things are pushed from `tick`" now says everything owed
  by the states that simulate nothing is pushed from there, that the doc lists
  it, and that these four are the ones a change elsewhere breaks.

Checked: `npm run typecheck`. `CLAUDE.md` stays at 1,505 lines.

### 45. The recoil argument is written in five places

**Area:** `src/config/recoil.ts` (92% comments), `src/core/recoilCurve.ts`,
`src/core/CameraSystem.ts`, `src/entities/Player.ts`, `docs/weapons.md`,
`CLAUDE.md`

"Recoil is not a spring / nothing about a gun wants to be where it started"
appears in `CLAUDE.md` (~1861), `docs/weapons.md` (~1188–1200), the
`recoilCurve.ts` header (~40 lines), `recoil.ts` (~374) and `CameraSystem.ts`
(~136). The "eight to thirteen draws a second" sweep argument appears in
`CLAUDE.md` (~1925), `docs/weapons.md` (~253, ~1403), `recoil.ts` (~206, ~760,
~954, ~970) and `Player.ts` (~2249). Every copy is a place a number can go
stale when a tunable moves.

**Fix.** `docs/weapons.md` holds the argument; source comments state the rule
in a sentence and point there; `recoil.ts` field comments say what the field
does and what it was measured against, not the history of how it got there.
Check while doing it that every number quoted in a comment matches the value
under it.

### 46. Physics reference baselines missing for three maps

**Area:** `plans/physics-ref/ref/` (git-ignored images; `plans/` is tracked)

Baselines exist for only 4 of the 7 shipped maps; Sarab, Cinderhaven and
Kurenai have none. The parallel `webgpu-ref` bank is already admitted stale
(`FINDINGS.md` §20). Either capture the missing three, or note in `plans/`'s
README which maps are covered and that the bank is not a full gate.

**Done.** The missing three are captured. (The banks are tracked JSON resting
sets, not git-ignored images. Only `proving.json` is ignored.) This machine
runs the oracle, so `node plans/physics-ref/drop.mjs sarab cinderhaven kurenai`
banked all three at the default 480 steps:

| map | hash | floor | colliders |
| --- | --- | --- | --- |
| sarab | `a599c829da989591` | 3.0 mm | 3,545 boxes + 116 terrain |
| cinderhaven | `0bc739877ded19b3` | 3.0 mm | 3,857 boxes + 189 terrain |
| kurenai | `9527748c34314092` | 3.0 mm | 764 boxes + 37 terrain |

A `--check` from a fresh process reads `identical` on all three. The four older
banks were re-checked at the same time against HEAD. Coldharbour and Hollowmere
read `identical`, and so does Greyfen at `--steps 2400`. Harrowmead reads
`within tol`, worst 1.1 mm, 0.4 mm of it vertical, under its 8.9 mm floor.

`drop.mjs`'s header now says every shipped map is banked and a new map owes a
bank. `plans/README.md`'s row says the same, plus Greyfen's step count.

### 47. Most of the footprint table understates its builders

**Resolved.** `npm run kit:hash -- --feet` flags no kind. Every flagged row was re-measured as the ENVELOPE of its drawing: each kind was built at 30 to 40 seeded positions and turns per params set the layouts use, because rubble, billets, a ruined cart's wheel and the steps down to a falling floor are drawn off where a placement stands, and the layouts hold only a few seeds. Rows that read a param now read it: `ruined` for the cottage (a fallen gable timber, +X) and the cart (its lost hind wheel and what it spilled). What each overreach was is named beside its row where the builder says what it is.
- manor: the row was an older building's — the service stair once ran south. It is now `[-15.9, 17.75, -12.9, 12.65]`, the portico to the creeper on the north veranda's plinth.
- `LITTER` is new: how far a loose piece may lie past a row, by side, which `--feet` reads. It covers the crates' lost hoop, the planter's knocked-off coping corner and the ruin's scattered stones.
- The ruin's 2.2 m west reach was a BUILDER bug. `rubbleFooting` took `(c, u0, u1, width)` and all four calls passed `(c, width, u0, u1)`, so three footings drew nothing and the fourth was a 3.75 m slab across the west stub. The signature now matches the calls: drawing only, colliders unchanged per `kit:hash`. With it the ruin's row is its solid drawing (`0.7`–`0.8` past the walls) and its scatter is litter.
- Wall and fence rows now claim their end piers and posts. That exposed that every generator's run cutting (three copies) left its 0.5 m joint gap between NOMINAL ends, so the piers stood in each other and in any fence through the joint. It is one `cutRun` in `mapgen.mjs` now, insetting each run by its kind's reach off `FOOT`.

All four maps were re-seeded, with door checks passing, every set piece placed and every map byte-reproducible. Moves forced by real clashes the corrected rows exposed:
- Greyfen: 147 → 147 placements, 43 wall runs. The manor's service track ran across its north veranda's ferns; it now runs at z 10.8, where the causeway stair's landing meets it. The manor terrace's edge went 5 → 8, which the veranda stands past. The processional way ends 0.5 m shorter. The mission and the overseer's house moved 1–1.5 m off the river's bank and the ferry track; the overseer's terrace is 2 m deeper. The sawmill yard's west edge moved 0.5 m, and the crates and two temple-side dressing regions moved off the woodpile and the temple.
- Harrowmead: 249 → 248, 99 field runs. The two field ruins and four props each moved 1–10 m to flatter ground. The cowman's cottage's door, which opened onto a woodpile at HEAD, is clear. The one placement short is a seeded back-plot woodpile.
- Hollowmere: 245 → 243, 54 houses, 23 burnt (55 and 25 at HEAD). The burnt quarter keeps its shape; the difference is seeded row picks. The ruined cart on the square moved 2 m off the south-west lamp. The smokehouse and the net loft moved half a metre to a metre to clear the ruined fisherman's cottage. The boathouse is held 0.6 m off the dock yard it opens onto.
- Coldharbour: 269 → 270, with every tower and shophouse kept. Exchange Square, the station forecourt and the Harbour Board plaza each gave up 0.2–0.4 m to the buildings backing onto them.

Each map was rebaked. `npm run parity` passes on every map, and `buried.mjs` reads 0 on all four. The physics references were re-banked for Greyfen, Hollowmere and Coldharbour, and `physdiff` puts every moved body on a changed collider; Harrowmead's reference still passes. The menu photographs were retaken. Greyfen's framing changed: the re-rolled forest put a trunk near the vantage.

Bot rounds, Valeguard–Redline, now against HEAD (`npm run simulate -- <map> 1 12`):
- Greyfen 5–7 against 3–9, Harrowmead 9–3 and 8–4 against 9–3, Coldharbour 7–5 against 8–4.
- Hollowmere 2–10 and 1–11 against HEAD's 3–9 and 4–8. That is Redline 21–3 against 17–7: the same lean, perhaps stronger, inside the batch noise but owed a per-flag hold count before it is believed either way.

Left alone:
- `mapgen.mjs`'s `makeFootOnRoad` walks from `x0` in metre steps and never samples the far edge of a footprint whose side is not a whole metre. The audit caught two corners it missed (both moved here).
- Two audit errors are at a generator's own limit: Coldharbour's FLAT is 0.32 against the audit's 0.3, and the mission ruin's 0.34 is only under its scattered rubble.
- Hollowmere's pre-existing ruin facing a ruin's back, now at (22.4, -22.1).

**Area:** `scripts/lib/footprints.mjs`; the four generators that read it
(Harrowmead, Hollowmere, Coldharbour, Greyfen)

**Problem.** The table was typed "measured off the builders" when each
generator was written, and most of the kit has been reworked since. Taken
after #16, `npm run kit:hash -- --feet` shows 32 of 52 kinds with parts below
2 m reaching more than 5 cm past their row. The figures are worst-case metres
past the row, `-x +x -z +z`, ground only:

- buildings: ruin `+1.80 +1.34 +1.59 +0.36`, jungleRuin `+1.38 +1.72` on z,
  cottage `+0.75` on +x, mill `+0.42` on +x, kiln `+0.97` on -z, depot
  `+1.25` on -x, tower `+0.35` on -z, templeRuin `+0.87 +0.86 -0.13 +0.83`
- props: cart `+1.01 +0.49 +1.32 +0.29` (the shafts), woodpile `+0.92 +0.89`
  on z, trough `+1.08` on +z (the hitching rail), planter `~+0.5` all round,
  stoneWall `+0.35` on both ends, bridge `+0.31` on both sides
- **manor `+1.37 -0.27 -5.53 +5.20`**: the row claims 5.5 m in front that the
  drawing does not reach, and the drawing reaches 5.2 m past its back. That
  looks like the row's front and back are swapped against the builder. Check
  this one first.

What it costs is what #16 was about. A claim smaller than what is drawn lets
a neighbour stand in a cart's shafts or a ruin's rubble, and a front set at
the wall line puts the door check's ray inside the doorstep.

**Fix.** Re-measure each flagged kind, decide what is deliberate (a
forecourt, a canopy) and say so beside the row, as #16 did for its seven.
Then re-seed every map that places the kind. Correcting the rows moves all
four maps, and the bigger corrections (ruin, cart, manor) will probably
refuse set pieces that fit today. So this is a re-lay done with the
map-layout skill, not a table edit: one map per commit, each with its
collision rebake, `npm run parity`, and `npm run shots`.

**Acceptance.** `npm run kit:hash -- --feet` flags no kind in the ground
columns, or each flagged one has a comment on its row saying why. Every map
regenerates with door checks passing and its set pieces placed.

---

## Suggested order

1. Tickets 1–5 (small, independent, P0).
2. Tickets 6–14 (client/authority sharing), with 3 before 10 and 13 alongside 2.
3. Tickets 15–16 (generators), one map per commit; 47 after them, with the map-layout skill.
4. Ticket 21, then 22–25 (world splits) behind `kit:hash`.
5. Everything else as convenient; 40–45 can go to anyone at any time.
