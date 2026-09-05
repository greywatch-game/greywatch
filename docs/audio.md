# docs/audio.md

The audio pipeline: what a sound costs, what the budget is, and how a recording
gets from a session file into the game. Split out of
[`CLAUDE.md`](../CLAUDE.md), which carries the rules that reach other
subsystems; this file is the contract for `audio/`, `scripts/encode-audio.mjs`,
`scripts/check-audio.mjs` and `src/core/samples.ts`.

**Read [`docs/weapons.md`](weapons.md) for what a sample means to a WEAPON**
(`ReportVoice.sample`, the four rules about what it replaces, and why
`report.pitch` is not spent on one), and [`docs/build.md`](build.md) for the
test every asset in the tree has to pass.

## Everything is synthesized, and a recording is laid over the top

`src/core/Sfx.ts` generates every sound in the game from a shared noise buffer,
a handful of filters and one shared convolution reverb. That is not a
constraint anybody is working around — it is why a firefight of eighty rounds a
second costs no memory, why every weapon is a row of eight scalars, and why the
game shipped for its whole life with no audio assets at all.

**Sixteen files sit on top of it: one report per weapon in the kit, the
cupola gun all three hulls mount, the two halves of the player's own magazine
change, the four beats of a bolt cycle and the two BLASTS — the one explosion
this game has and the tank gun that is the same physics at the other end.
Nothing else in the game is recorded at all.** 63.2 KB downloaded once, 3.99 of
the 44 mono-seconds the budget below allows.

**That boundary is a decision and not a waiting list**, and the six mechanism
rows are what makes it readable rather than theoretical. What the arithmetic
below refuses is a LIBRARY — thirty one-shots, five footstep variants per
surface, an ambient bed that alone costs ten times this whole list — not the
idea of a sound that is not a gunshot. The six are 1.244 mono-seconds cut from
TWO masters with no round robin behind either, they are the player's own rather
than every body's, and they pass the admissibility test in full: delete
`audio/` and `Sfx.reload` is the four clacks it always was and `Sfx.boltCycle`
the five clacks and two sweeps it always was. **A footstep still cannot make
that second claim** without bringing a surface table and a variant set with it,
which is the whole argument and is unchanged — and an ambient bed cannot make
it at all.

**The two BLAST rows are the cheapest answer that boundary has ever given to
"one more sound", and they are cheap for a structural reason rather than a
lucky one.** There is ONE blast in this game — `blastAt` takes a `power`, the
grenade passes 1 and the tank shell 1.85 of the same eight layers — so one
recording is every explosion in the game and there is no second one to want.
The cannon is the other half of the same coin: `Sfx.cannon` is the one report
here with no row in `CONFIG.weapons` behind it, so it is one file for a gun the
weapon table has never held. Two rows, two masters, no round robin, and the
admissibility test in full: delete `audio/` and `Sfx.explosion` is the four
layers it always was and `Sfx.cannon` the three it always was.

**And the two mechanisms together are what the boundary is actually made of,
because the second one is where the money went.** The bolt cycle is four rows
where the magazine change is two and it is the most expensive gesture in the
directory, 0.808 mono-seconds against the eight reports' 2.014 between them —
and it is admissible for the same three reasons every other row is, not for
being cheap: one master, no variants, the player's own weapon rather than
sixteen bodies', and a per-BEAT fallback that leaves the method sounding
exactly as it did before the recording existed. **The thing that would break
the boundary is a SECOND performance of the same gesture**, because that is a
round robin with extra steps.

**A sample is a thing laid over that, and it is held as a PREFERENCE.** The
fetch is fire-and-forget off `Sfx.unlock`; a round fired before the decode
lands, or on a device where the fetch failed, or in a browser that cannot
decode the container, is the synthesized report, and no caller anywhere is told
which it got. That is the whole of what makes an authored asset admissible
here: **the game is still whole with every file in `audio/` deleted.** A new
sound that cannot make that claim does not belong in this pipeline.

## The budget is SECONDS, not bytes, and the measurement is why

A decoded `AudioBuffer` costs

```
duration × ctx.sampleRate × channels × 4 bytes
```

and **nothing else**. The container, the bitrate and the file's own sample rate
do not appear. Measured, decoding the same shot four ways in the game's own
browser:

| file | download | decoded RAM |
| --- | --- | --- |
| 48 kHz stereo | 17.5 KB | **255 KB** |
| 48 kHz mono | 5.9 KB | **127.5 KB** |
| 22 kHz stereo | 9.2 KB | **255.5 KB** |
| 22 kHz mono | 9.2 KB | **127.7 KB** |

The 22 kHz file was **resampled back up to the context rate on decode** — it
saved 47% of the download and nothing at all of the memory. Halving the
channels halved the memory exactly.

So at 48 kHz, **one second of mono is 187.5 KB and one second of stereo is
375 KB**, whatever you encode it as. `audio/manifest.json` states the ceiling in
that unit: **44 mono-seconds ≈ 8 MB**, about 5% of the 157 MB heap
[`FINDINGS.md`](../FINDINGS.md) §1 measures on Hollowmere. A stereo row spends
two of those seconds per second of audio.

### Three budgets, and a file can pass one while failing another

- **Download** — 12.6 MB is precached at install today, 7.7 MB of it the JS
  entry. Audio is the roomiest of the three, and roomier still because an audio
  file **imports nothing**, so its content hash survives a deploy and is copied
  out of the old cache rather than refetched (see [`docs/pwa.md`](pwa.md): the
  entry re-hashed 43 of 52 asset names on one measured deploy; what survives is
  the ~2.7 MB that imports nothing). An audio download is paid once, ever.
  **This is also why `vite.config.ts` refuses to inline a sound** — see below.
- **RAM** — the binding one, invisible in build output, and the reason for the
  gate.
- **Voices** — `CONFIG.audio.maxVoices` (24), with `impactReserve` (6) held
  back. A voice is counted for as long as it is **scheduled**, so a long sample
  spends more of this budget than the short synthesized layers it replaces;
  `Sfx.botShot`'s comment carries the arithmetic.

## Where the money should go

Price the categories before choosing what to record:

| | decoded RAM |
| --- | --- |
| every weapon in the kit, 0.5 s mono each | ~0.56 MB |
| thirty one-shots (steps, impacts, reloads) at 0.3 s mono | ~1.7 MB |
| **one 30-second ambient loop, mono** | **5.5 MB** |

**One ambient bed costs ten times the entire sampled gun kit**, and the whole
recorded magazine change is a quarter of one of those thirty one-shots. That
gap is the shape of the boundary: what is expensive here is a CATALOGUE, and
the cost of one more sound is almost never the reason to refuse it. Ambience is
exactly where the synthesis is strongest — crickets, wind and fire crackle
genuinely *are* filtered noise and oscillators, which is what `Sfx` is good at,
and a loop point is a defect a one-shot cannot have. **Sample the guns, never
the ambience.** That is the opposite of where the intuition points and it is
most of the budget problem solved.

If a sustained sound ever is sampled, the engine graph is the precedent for
holding one: a `sources` list so teardown cannot leak a voice, and
`Sfx.enginesOff` / `Game.fleetStepped` for the voice left running under a card
that holds the world.

### Three rules that keep a library from ballooning

1. **Mono for anything only ever heard through a panner.** A `PannerNode` makes
   the stereo; a stereo source through one is double the RAM for nothing. The
   exception is a short sound the player hears UNPANNED — their own report —
   where the width is audible and the seconds are few.

   **Seven of the sixteen rows take that exception and the nine that do not
   fail it two different ways**, which is what makes the rule readable rather
   than theoretical. `mountedGun` fails it on WHERE, and the test there is not
   what the sound IS but where it is heard:
   `Game.resolveMg` reaches `Sfx.botShot` and never `shoot`, deliberately and
   with the argument on the line — in a chase view the gun is twelve metres
   from the listener — so the player firing a hull's own machine gun hears it
   panned exactly as a bot's is. No unpanned path, no exception, mono. It
   costs 0.112 mono-seconds where the same cut in stereo would cost 0.224.

   **The six MECHANISM rows are heard exactly where the exception applies and
   are mono anyway, because there is no width in either master to keep.** The
   side channel peaks 21.6 dB under the mid on the magazine change and 13.7 to
   23.3 dB under on the bolt cycle's four (RMS 22 and 15.9–19.6), against the
   assault rifle's 10.8 and the sniper's 3.8 — that is dual-mono with a room
   mic's worth of drift on it, and a second channel would be double the RAM for
   a difference nothing can hear. **The exception is for width that EXISTS**,
   and measuring the side channel is how you find out, exactly as the assault
   rifle's row measured it to claim the exception in the first place. On the
   bolt cycle it is also the difference between 0.808 mono-seconds and 1.616,
   which is the largest single row-shape decision in this directory.

   **The two BLAST rows fail the exception on WHERE as well, and the tank gun
   is the sharpest case of that test here.** Neither `Sfx.explosion` nor
   `Sfx.cannon` has an unpanned path at all — the shell a player fires from
   their own tank is spatialised exactly like everybody else's — so neither has
   any claim, which is `mountedGun`'s argument twice more. `grenade` would have
   been mono regardless: side 14.6 dB under the mid in RMS with the channels
   0.88–0.99 correlated the whole way through, which is the mechanism rows'
   measurement again. `tankCannon` would NOT — it is the WIDEST master in the
   directory, its side channel only 2.3 dB under the mid against the sniper's
   3.8 and the rifle's 10.8 — and it is mono anyway, because the exception is
   for width heard UNPANNED rather than for width.

   **And the downmix then found something no envelope in that file shows.**
   Past 230 ms its two channels go NEGATIVELY correlated (r = −0.84 at 240), so
   from there the mono sum does not narrow the master, it CANCELS it: anything
   cut past that point would arrive thinner in the game than it measures on
   disk. That is where the row's cut ends, and the general rule is that **a
   stereo master is measured for what the SUM does to it as well as for what
   the width is worth** — a second measurement that only matters to a row the
   first one has already sent to mono, which is every row heard through a
   panner.
2. **No round-robin files.** Libraries balloon on five footstep variants per
   surface. Variation here comes from the graph: `playbackRate` jitter (already
   in `Sfx.sample`), the shared noise buffer, and layering.
3. **Sample the transient, synthesize the body.** A 60 ms recorded crack is
   11 KB of RAM and the existing filtered-noise layers carry the tail *and* the
   per-shot variation for free. Recording a whole sound is paying RAM for
   variation you then have to buy back with more files.

## The pipeline

```
reference-media/          gitignored — raw session recordings, local only
audio/
  src/<name>.wav          committed MASTER: 48 kHz, 16-bit PCM, as delivered
  <name>.webm             committed OUTPUT of `npm run audio`
  manifest.json           what to cut, from what, to what — and the budget
src/core/samples.ts       the id union and the url table the game imports
```

**A master is not a file, it is a SOURCE**: eleven masters carry sixteen rows,
because `reload.wav` is cut twice and `bolt-cycle.wav` four times. `sourceHash`
is per ROW rather than per file, so the two performances have the same hash
repeated across their rows and editing either master restages every cut off it.

**The CUT lives in the manifest, never in the master.** A master is the
recording as delivered; what ships is a `trim` of start, end and fade stated as
numbers a reviewer reads in a diff. A trim baked into a binary is a decision
nobody can see, re-run or argue with — and the trims here are load-bearing.

`npm run audio` cuts and encodes every row and writes `sourceHash` and
`decoded` back. `npm run build` runs `scripts/check-audio.mjs`, which refuses:

- a master edited without re-encoding (**the build would ship the old sound and
  the diff would look right**) — the same guard `check-collision.mjs` puts on a
  bake older than its layout;
- a total over the manifest's ceiling;
- an encoded file `samples.ts` does not import, or an import with no row behind
  it — either direction means a shipped sound with no generator, which is the
  problem the pipeline exists to retire.

### The seek has to be an INPUT seek, and it shipped wrong

`-ss` goes BEFORE `-i` in `encode-audio.mjs`, and that is load-bearing rather
than a style. An output seek discards frames AFTER the filter graph has run, so
the graph still sees the master's own timeline while `afade`'s `st` is measured
from the start of the CUT — the fade therefore lands `start` seconds early and
takes everything after it to **digital silence**.

It shipped that way and the failure was invisible, because **a row starting at 0
is unaffected**: five of the first eight rows start at 0 and were always
correct, and the three with a lead were all truncated. The LMG lost the worst of
it — its row above argues for the direct sound running to ~140 ms and a fade
over the next 30, and the file was silent from 90, so 40 of its 130 ms were
gone. The carbine lost its last 20 ms and the mounted gun its last 34. Nothing
in the manifest, the budget or `check-audio.mjs` could see it: the numbers a
reviewer reads are the INPUT, and a diff of the trims looked exactly right.

Input seeking is exact on PCM — there are no keyframes in a WAV — so the fix
costs nothing. **There is no gate on this**, which is the honest state of it: a
filter chain that quietly eats part of a cut is caught today only by decoding
the output and comparing it to the master, which the pipeline does not do.

**`npm run audio` needs ffmpeg and ffprobe on PATH; the build does not.**
`/tools/` is gitignored, so the binaries on one machine are not in the repo.
That is the same bargain `npm run shots` makes by needing a real GPU and a
display: a requirement of the GENERATOR, and a clean checkout never runs it
because the output is committed.

### Never inline a sound

`vite.config.ts` sets `build.assetsInlineLimit` to refuse anything under
`audio/`. Vite's default base64s any asset under 4 kB into the importing chunk,
and the rifle's 3.4 kB report silently landed inside the 7.7 MB entry bundle as
a `data:video/webm` string instead of being emitted as its own hashed file.

That is the wrong side of the distinction the download budget above rests on.
Inlined, every sound is re-downloaded whenever the game's code changes, and
base64 charges 33% on top. At seven files that is 29 kB of nothing; at forty it is
half a megabyte moved from the cache-forever pile to the
re-download-every-deploy pile, for no benefit at all.

### Master conventions

- **48 kHz, 16-bit PCM**, enforced by the generator. Mono or stereo is the
  row's choice. This is checked rather than trusted because git never forgets a
  binary: a 96 kHz 24-bit master is six times the bytes for information
  `decodeAudioData` discards on the way to the context rate, and by the time
  anybody notices it is in the history for good.
- **Normalized to peak near 0 dBFS.** `Sfx`'s `SAMPLE_LEVEL` is the single
  place a recording is levelled against the synthesis, and one number can only
  serve every sample if they all arrive at a comparable level. The fix for a
  quiet recording is the recording.
- **Leave ~1 dB of headroom if you can.** A lossy encoder overshoots: the
  rifle's master peaks at −0.03 dBFS and its Opus decodes at **1.056**. WebAudio
  is float and the master soft clip absorbs it, so this is a note rather than a
  rule.
- Downmixing is `pan=mono|c0=0.5*c0+0.5*c1`, not `-ac 1` — ffmpeg's own matrix
  can sum correlated channels past full scale, and a gunshot's two channels are
  highly correlated.

### Container

**WebM/Opus, 96k**, set in the manifest's `defaults`. Measured on the same mono
shot: Opus 8.0 KB, Vorbis 8.8, AAC 9.3, MP3 11.7 — and identical decoded RAM for
all of them, so this is a download-only decision. All eight formats tried
decoded in Chromium, none with any leading padding.

The container is a cheap bet precisely because of the preference rule above: a
browser that cannot decode it falls back to the synthesized report, which is the
game as it shipped. If iOS is ever confirmed as a target, AAC `.m4a` is
universally supported, 26% larger, and one manifest field away.

**A global lever that is deliberately not pulled**: constructing the
`AudioContext` at 32 kHz would cut every decoded buffer and the graph's CPU by a
third, and the synthesis (which tops out near 5.2 kHz) would not notice — but a
recorded gunshot's crack lives at 15–20 kHz, which is the thing samples are
bought for.

## What each trim is, and why they are all that short

Eleven masters and sixteen cuts. Ten of the masters are 1.0 s of 48 kHz stereo
as delivered: eight are reports and their cuts run 96 to 180 ms, and two are
BLASTS, cut to 210 and 520 ms for a reason of their own below. The two 3.0 s
files are `reload.wav`, which two rows are cut from, and `bolt-cycle.wav`,
which four are. **Between 48 and 95% of every master is discarded**, and the
discarded part is almost always the same thing: a baked room this engine
already has one of. The two PERFORMANCES and the grenade are the exceptions,
and all three are instructive rather than a lapse — see below.

### The assault rifle, which is the reference

The master is 1.0 s. **The shipped cut is 150 ms**, and the 850 ms discarded is
a baked room, not the shot:

- 0–130 ms — the report, −4 to +1.5 dB RMS.
- 130–135 ms — a 15 dB cliff. The report ends.
- 135–385 ms — a nearly flat plateau at −18 to −24 dB.
- 385 ms–1.0 s — a slow decay to −68 dB.

Measured before cutting: the 130–400 ms band has a **crest factor of 6 dB with
no window 5 dB above it** — dense noise with no discrete reflection and no
mechanism in it, so there is nothing in there to lose.

Shipping that tail would have been wrong four ways, and all four are about this
engine rather than about the recording. `Sfx` already answers every gunshot with
a **shared `ConvolverNode` on a send**, which costs no voice and no per-shot
memory. A baked room would double-reverb the shot; put one fixed room on six
maps that include a desert town and a harbour at night; defeat `botShot`'s
reverb send climbing with distance, which is what makes a shot across the valley
"nearly all tail"; and hold a voice for 865 ms instead of 150, at up to eighty
shots a second.

**The general rule: a sample is the DIRECT sound. The room is the game's.**

### The other six, and the three rules they added

The rifle's cut needed one test — where does the report end — because its
master handed one over: a 15 dB cliff at 130 ms with a flat plateau after it.
The six that followed each broke that in a different way, and each break is a
rule rather than a detail of one file.

| id | weapon | cut | of master | what the trim is fighting |
| --- | --- | --- | --- | --- |
| `assaultRifle` | rifle | 0 – 150 ms | 15% | a baked room after a clean cliff |
| `burstRifle` | carbine | 24 – 120 ms | 10% | **a second and third ROUND**, and a 32 ms lead |
| `smg` | SMG | 0 – 140 ms | 14% | a discrete arrival at 152 ms |
| `dmr` | DMR | 0 – 180 ms | 18% | an early field from 160, a late arrival at 224 |
| `sniperRifle` | sniper | 0 – 130 ms | 13% | **no cliff anywhere in the file** |
| `lmg` | LMG | 40 – 170 ms | 13% | a 50 ms lead, then low roll the room was holding |
| `pistol` | sidearm | 0 – 125 ms | 13% | a floor from 130, a late arrival at 220 |
| `mountedGun` | all three hulls' `mg` | 34 – 146 ms | 11% | a 28 ms mechanical lead, then room |
| `magOut` | every weapon's reload | 172 – 334 ms | 5% | **a second gesture 140 ms in front of it** |
| `magIn` | every weapon's reload | 2712 – 2986 ms | 9% | nothing — the master was already dry |
| `boltLift` | the bolt gun's cycle | 56 – 292 ms | 8% | **the beat in front of it**, which is 0.16 of a shot |
| `boltBack` | the bolt gun's cycle | 476 – 686 ms | 7% | nothing — it is one gesture, ends and all |
| `boltHome` | the bolt gun's cycle | 2544 – 2758 ms | 7% | nothing |
| `boltLock` | the bolt gun's cycle | 2814 – 2962 ms | 5% | nothing |
| `grenade` | **every blast there is** | 0 – 520 ms | 52% | nothing — a step at 520 |
| `tankCannon` | the tank's main gun | 0 – 210 ms | 21% | **the MONO SUM**, and an arrival at 220 |

**1. A master of a BURST weapon is a burst.** `Sfx.shoot` is called once per
ROUND — the carbine's three leave 50 ms apart and each one is its own call — so
a sample carrying the burst fires nine shots for every three. The carbine's
second round is on its master at 216 ms at −4 dB and a third rides the tail out
past 330; the cut ends at 120 and none of that is a matter of taste. This is
the one rule here that is about CORRECTNESS rather than about a room, and it
generalises: what a sample may contain is one call's worth of sound.

**2. A mechanism on the tape is cut whichever end it is on, and the front end
is the expensive one.** Three of the eight masters lead with one. The carbine's
report starts 32 ms into its master, the LMG's 50 ms into its, and the mounted
gun's 40 ms into its — that last is the plainest of the three, a discrete clack
at 8–16 ms (−6 dB above 4 kHz) followed by near-silence to −61 before the
report arrives. Everything before an onset is −23 to −61 dB of pre-noise.
Shipped whole that is 32 and 50 ms of latency between the trigger and the
sound — a third of the carbine's whole burst, half the LMG's cycle — and it
cannot be recovered downstream, because `Sfx`'s own `trimSample` only skips
what is under −54 dBFS and this is far louder than that. **Both start points
sit in a TROUGH rather than hard against the onset** (−41 dB at 24 ms, −50 at
40), which is what lets the pipeline stay a start/end/fade with no fade-in in
it: a cut made at a trough cannot click, and the transient keeps a foot.

The back end is the same rule and is cheaper to get wrong. The SMG's master has
a bolt-shaped event at 152 ms, 40 dB up on the trough in front of it; that
weapon's `actionVol` is **1.55, the highest in the kit**, precisely because a
blowback SMG is mostly the sound of its own bolt — so shipping the recorded one
plays the mechanism twice. Cut at 140.

**3. A master with no cliff is cut with a FADE, and the fade is measured off
the HIGH BAND.** The sniper's file is one long boom: still only 6 dB down at
296 ms, with no step anywhere and no straight-line decay until ~400. There is
no moment to cut on, so the cut has to be made, and its `fadeOut` is 40 ms —
nearly a third of its length, against the 15–25 ms every other row uses.

**Where to put it is a question the broadband envelope cannot answer and the
band above 4 kHz can.** A shot's high band DECAYS; a room's early field
PLATEAUS. Measured on the seven, that single test placed every cut in this
table:

- the sniper's band is over by ~90 ms and then sits at −21 dB ±2 for the next
  hundred milliseconds — dense early field, so the shot is 0–90 and the fade
  spends 90–130 handing it to the convolver;
- the DMR's stays live between −9 and −20 dB all the way to 156 ms before
  dropping to −26 and going flat, so that report genuinely IS the longest here
  and 180 ms is the master earning it rather than the weapon being indulged;
- the LMG's falls cleanly from −7 dB at 116 ms to −55 by 180 while the
  broadband is still −13, because what is left is low roll — which is
  `report.weight` and `length`'s job, and the shot is not owed it twice.

**The corollary is that a long cut has to be read against the weapon's RATE.**
The rifle ships 150 ms against a 106 ms gap, so two rounds always overlap; the
SMG's 140 against 77 is the same ratio; the carbine's 96 ms is the shortest in
the table because three of its rounds leave in 0.1 s, which is the same
argument `report.length: 0.75` already makes for it in `config/weapons.ts`. A
cut that runs past the next round is a burst you cannot count.

**4. A master that is a PERFORMANCE is cut to the game's BEATS, and the thing
being fought is not a room.** `reload.wav` and `bolt-cycle.wav` are the two
masters here that are not one event, and between them they carry six of the
sixteen rows. Neither has a tail to hand to the convolver: the first arrived
GATED to digital silence between its gestures, and the second decays 55 to
63 dB monotonically with no plateau anywhere in it over a −72 dB preamp floor,
which is the same test that placed the eight reports saying the same thing. So
both are already the direct sound, and what has to be discarded is TIME.

For the reload that is 2.4 seconds of a hand FETCHING a magazine, which is real
and is not the game's: `Sfx.reload` places four beats as FRACTIONS of a
weapon's `reloadTime`, from a 1.05 s sidearm to a 3.4 s machine gun, and no
take is the length of all seven.

The same argument cuts inside the removal. That gesture is two events 140 ms
apart with a −65 to −71 dB trough between them — the catch pressed and the
magazine rocking loose at 24–135 ms, then it stripped clear at 175–330, ending
on the master's loudest moment at 0 dBFS at 249. **Shipped together they would
agree at exactly one reload speed**: the pair is a fixed 140 ms apart while the
beats they answer to are 189 ms apart on the sidearm and 612 on the LMG. So the
catch is cut and stays the clack it always was, and `magOut` is one beat's
worth of sound — which is the burst rifle's rule (`what a sample may contain is
one call's worth of sound`) read one level down.

**And `magIn` is the row that made PEAK scheduling the rule for a mechanism.**
A magazine going home is an ARRIVAL, with 188 ms of it rising and rocking into
the well ahead of the slap, and `CONFIG.viewmodel.reload` draws exactly that
approach between `insertFrom` and `magSeat`. `Sfx` starts the file
`MAG_IN_PEAK / actionPitch` before the beat so the recorded slap lands on the
drawn one; scheduled by its start it would arrive 188 ms late. **Those offsets
are measured off the trims in this table**, which makes a `trim.start` here and
a constant in `Sfx.ts` one decision in two files — the same contract the beats
already have with `CONFIG.viewmodel.reload`.

### The bolt cycle: one performance, four rows, and where the travel went

`bolt-cycle.wav` is that same argument at four beats instead of two, and it is
the one place a recording replaces a gesture's TRAVEL rather than only its
arrivals. The take is four gestures in two pairs — the handle lifted
(12–292 ms) and the bolt drawn to its stop (476–688), then **1.86 seconds of
the action held open**, then it driven home (2548–2750) and the handle turned
down (2820–2960) — which is `CONFIG.viewmodel.cycle`'s `lift`, `back`, `home`
and `lock` in the order the viewmodel draws them. Four beats, four rows, 0.808
mono-seconds.

**Why four and not one** is `magOut`'s rule with more to lose. `Sfx.boltCycle`
places its beats as fractions of `shotInterval`, and the take's own beats are a
fixed number of milliseconds apart: shipped whole it would agree with the drawn
gesture at exactly one `fireRate` and at no other, and its 1.86 s hold is not
any weapon's. Cut into four it agrees at every rate, because each row is landed
on its own beat by its own peak.

**The two synthesized SLIDES retire into two of those rows rather than playing
under them**, which is the SMG's rule read from the other end — a mechanism must
not be played twice, whichever half of it is the recording. `boltBack` carries
115 ms of the bolt travelling ahead of the rear stop and `boltHome` 133 ms of it
running forward over the magazine, so each sweep now lives inside its beat's
fallback arm. The recorded pair also does for free what the synthesized pair was
shaped to do: the opening one brightens to 46% of its energy above 8 kHz at the
stop, the closing one arrives at a 5.1 kHz centroid, because one ends on air and
the other on a locked breech.

**`boltBack` also swallows the CASE**, which is a fifth synthesized event and
not a fourth beat. The synthesis puts the stop at 0.42 and the brass at 0.47
because filtered noise cannot be steel and a cartridge case at once; on the tape
they are the same millisecond, and that 46% above 8 kHz is what the brass is.

**`BOLT_LIFT_PEAK` is the tightest scheduling constraint in the directory**, and
it is what set that row's trim. `mechanism` starts a file `peak / actionPitch`
before its beat, so a beat at `f × duration` fits only while
`f × duration ≥ peak / actionPitch` — and `cycle.lift` is 0.16, the shortest
window either gesture has. Cut at the master's own 12 ms onset the approach is
153 ms against the 200 available at the sniper's 0.68 and 0.8/s: nine
milliseconds of room, and any raise to `fireRate` would clamp it and put the
lugs late. The trim starts 44 ms further in, at the −46 dB trough between the
take's first tick and its first hit, which buys 40 ms and holds to a
`fireRate` of 1.0/s. The other five mechanism rows have between two and eight
times that room.

**The four cover the wait, which is what `boltCycle` exists to do.** At the
sniper's rate they play 40–361, 356–632, 654–926 and 852–1035 ms of a 1250 ms
cycle: one 22 ms gap in the whole gesture, and that gap is the bolt sitting at
the rear stop — the one moment in a cycle that genuinely is silent. Everything
is off 165 ms before `cycle.tiltOut[1]` finishes the picture and 215 before the
trigger is live again.

**`mountedGun` is where the rate DECIDED the cut rather than merely bounding
it.** Its 112 ms is the tank cupola's own 111 ms gap at `fireRate: 9` to within
a millisecond, so one round finishes as the next leaves and no two ever stack —
which is the claim `report.length: 0.72` already makes for that gun in
`config/vehicles.ts` ("almost no ring, because the next one is 110 ms away").
The truck's 133 ms gap and the gunship's 118 are looser still, so the tightest
of the three sized it and the other two are free.

### The two blasts: one file for every explosion, and the cut a downmix made

`grenade.wav` and `tank-cannon.wav` are the last two masters and the first that
are not a gun in anybody's hands. Both are 1.0 s of 48 kHz stereo like the
eight reports, both are essentially instantaneous (onsets at 4–5 ms, peaks
within 16 ms of the head), and both are cut from 0 — so neither has a lead to
recover and neither meets the input-seek trap above.

**`grenade` is the third reading of "a sample belongs to a ⟨thing⟩", and here
the thing is a BLAST — of which this game has exactly one.** `blastAt` takes a
`power`, the grenade passes 1 and is the reference exactly as the rifle is for
a report, and the tank shell is 1.85 of the same eight layers. So one recording
is every explosion in the game, and `power` is therefore spent ON the file —
`Sfx.explosion` divides `rate` by `sqrt(power)`, which is playbackRate and so
pitch and length together, and which is precisely what the synthesis does by
hand to its own layers. That is `magOut`'s inversion for `magOut`'s reason: a
per-weapon report has already made its deviation, and a shared recording has
said nothing at all about which blast it is going into.

**Its 520 ms is the longest cut in this directory by nearly double, and the
reason is that a blast is not a transient.** The crack is over at 40 ms — the
centroid falls 882 → 82 Hz and every band above 1.2 kHz drops 19 dB inside it —
and what follows is a sustained roll: 20–120 Hz holding −14 to −22 dB all the
way to 515 with the mid bands plateauing on top of it, then a 5 dB step down at
520 into a slower tail that reaches −67 by 990. The cut ends on that step, with
a 70 ms fade over live material because there is no cliff to cut on (the
sniper's rule, spent on 13% of the file rather than 31% of it).

**The plateau under it is NOT the baked room the eight reports were cut to
escape, and the test that says so is the STEREO one rather than the high
band's.** A room's late field DECORRELATES; this file's two channels stay
0.88–0.99 correlated across the whole plateau, and its 50 ms crest factor sits
at 5.7–8.9 dB with no discrete arrival anywhere in it. So there is nothing in
there for the shared convolver to fight — what the convolver adds is the
valley, at a send of 1.3 — and the roll is kept because it HAS to be: a sample
stands in for all four layers of `Sfx.explosion` and there is no `ReportVoice`
behind this sound to hand a roll back to, which is the one thing separating it
from the LMG's row. The last 300 ms is also what stands in for the synthesized
DEBRIS layer, which goes with the other three; `BlastDebrisSystem` still draws
the rubble.

**`tankCannon` is the other half of the same coin: `Sfx.cannon` is the one
report in the game with no row in `CONFIG.weapons` behind it**, no magazine and
no `ReportVoice`, so this is the one sample here that is a deviation from
nothing at all. Its direct blast runs 0–120 ms with every band live at a
centroid of 150–270 Hz; from 130 it is pure low roll (everything above 400 Hz
falls 12–17 dB by 160 while 20–120 Hz holds −16 to −21 out to 210, centroid
93–120); and at 220–235 there is a discrete arrival, the band above 3.5 kHz
14 dB up on the trough in front of it with nothing under 120 Hz in it — a hard
reflection off something about 37 m away, which is the room. Its roll is kept
for the grenade's reason and cut at 210, in the trough 10 ms in front of that
arrival, with a 35 ms fade. Nothing bounds it from the other end: the gun fires
every few seconds, so the rate argument that sized `mountedGun` has no work to
do here.

**And the mono downmix is what actually set that end**, which is the rule this
pair added to the directory. See the width note under rule 1 above: past 230 ms
the master's channels go negatively correlated (r = −0.84 at 240), so the sum
cancels rather than narrows, and a longer cut would have arrived thinner in the
game than it measures on disk. **A stereo master is measured for what the SUM
does to it as well as for what the width is worth.**

**What levels them is `BLAST_LEVEL` (0.9) rather than `SAMPLE_LEVEL`**, and the
third constant is there for `MECHANISM_LEVEL`'s reason: a blast is not a report
and the two families do not sit at the same place. Measured against the
synthesis these files replace — the crack's highpass passes nearly all of a
noise slice and lands near 0.66, the body's lowpass at 900 Hz leaves about 0.11
RMS of its 1.0, and the chest thump is a sine that peaks at its gain exactly —
a close blast sums to roughly 0.5 RMS at the crack, where a full-scale master
measures 0.4 through its own loud half. So a recorded blast sits just under
unity where a recorded report sits at half. `explosion`'s own `gain` is still
spent on top of it, because how much bigger a shell is than a grenade is the
game's claim and not the recording's.
