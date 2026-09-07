# docs/audio.md

The audio pipeline: what a sound costs, what the budget is, and how a recording
gets from a session file into the game. Split out of
[`CLAUDE.md`](../CLAUDE.md), which carries the rules that reach other
subsystems; this file is the contract for `audio/`, `scripts/encode-audio.mjs`,
`scripts/check-audio.mjs` and `src/core/samples.ts` — and, because the budget
below is what decides it, for the world's SUSTAINED synthesized voices as well:
`src/systems/AmbienceSystem.ts` and `Sfx.ambience`.

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
Nothing else in the game is recorded at all.** 61.9 KB downloaded once, 3.78 of
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

**A RECORDING CAN ALSO BE A MODEL RATHER THAN A ROW, and `Sfx.nearMiss` is
the case that says so.** Its five layers were fitted against a recorded flyby
— an untracked reference, so the measurement rather than the file is what is
written down in that method: a whistle swelling for ~55 ms, a snap at 500–1300
Hz under a shelf flat out to 13 kHz, a body around 320 Hz for the 60 ms after
it, and a hiss departing over a further ~200 ms. The summed envelope tracks
that recording within 2–4 dB from the snap to silence, and NOTHING WAS ADDED
TO `audio/` — no seventeenth file, no budget spent, no fallback to argue about.
**Reach for this before reaching for a row**: a cue whose problem is its SHAPE
is a cue synthesis can still answer, and the boundary above only has to be
tested by a sound whose problem is its TIMBRE.

**What it did cost is VOICES, which is the other budget**, and that is why
`audio.nearMissInterval` exists. Five layers over 300 ms is a fifth of
`maxVoices` per round, and a burst walked onto the player is a string of them
— so past that interval the swell, the body and the departure are dropped and
the SNAP always plays. A cue that gets LONGER owes this question; one that
only gets a different filter does not.

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
directory, 0.808 mono-seconds against the eight reports' 1.804 between them —
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
that holds the world. **What the rule above actually bought is one section
down** — the world's own noise is synthesized and held, and what it costs is
slots rather than memory.

### Three rules that keep a library from ballooning

1. **Mono for anything only ever heard through a panner.** A `PannerNode` makes
   the stereo; a stereo source through one is double the RAM for nothing. The
   exception is a short sound the player hears UNPANNED — their own report —
   where the width is audible and the seconds are few.

   **Six of the sixteen rows take that exception and the ten that do not fail
   it three different ways**, which is what makes the rule readable rather
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
   sniper's 3.8 — that is dual-mono with a room mic's worth of drift on it, and
   a second channel would be double the RAM for a difference nothing can hear.
   **The exception is for width that EXISTS**, and measuring the side channel
   is how you find out. On the bolt cycle it is also the difference between
   0.808 mono-seconds and 1.616, which is the largest single row-shape decision
   in this directory.

   **The third way of failing it is the one the assault rifle now fails on, and
   it is a warning about where these measurements live.** That row claimed the
   exception on a master measuring 10.8 dB of peak width with a tail that went
   genuinely wide (r = 0.15 past 150 ms). Its master was later REPLACED, and
   the replacement is dual-mono through the whole of the cut — r = 0.99–1.00,
   side 16.2 dB under the mid at peak and 27.0 in RMS — so the row is mono now
   and the sixteen are seven-nine no longer. Nothing about the game changed and
   nothing about the rule did; what changed is the file the rule was measured
   against. **A row's shape is a claim about ITS master, so a replaced master
   re-opens every one of these questions and not only the trim.**

   **The two BLAST rows fail the exception on WHERE as well, and the tank gun
   is the sharpest case of that test here.** Neither `Sfx.explosion` nor
   `Sfx.cannon` has an unpanned path at all — the shell a player fires from
   their own tank is spatialised exactly like everybody else's — so neither has
   any claim, which is `mountedGun`'s argument twice more. `grenade` would have
   been mono regardless: side 14.6 dB under the mid in RMS with the channels
   0.88–0.99 correlated the whole way through, which is the mechanism rows'
   measurement again. `tankCannon` would NOT — it is the WIDEST master in the
   directory, its side channel only 2.3 dB under the mid against the sniper's
   3.8 — and it is mono anyway, because the exception is
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

## The world's own noise, which is where that rule gets spent

The paragraph above is a claim about a budget; `systems/AmbienceSystem.ts` and
`Sfx.ambience` are what it buys. A burning drum is a SUSTAINED synthesized
voice, there is no file behind it and there is not going to be one, and the
whole design falls out of what the cost actually is once the RAM question is
off the table.

**The budget is not RAM and not the one-shot cap — it is SLOTS.** Synthesis
costs no memory, and a held-open graph is not counted against
`CONFIG.audio.maxVoices` for the same reason the engine's is not: that cap is
about eighty gunshots a second competing for a scheduler, and a fire is not
competing with anything. What a fire costs is six buffer sources and about a
dozen filters and gains, held open for as long as it is in earshot, and the two
water kinds cost the same to within a filter — so the thing that has to be
bounded is HOW MANY, and a range test does not bound it. Stand between four
drums and a range test holds four graphs open; dress a burning quarter and it
holds twenty.

**So it is a RANKING, and it is `LightingSystem`'s answer to
`LightingSystem`'s problem.** A shader has sixteen light slots and a village
has more torches than that, so the nearest sixteen win each frame and the rest
are dark; here the nearest `CONFIG.audio.ambience.maxVoices` (3) win a voice
each frame and the rest are silent. What loses is already most of a rolloff
away in both cases. The ceiling is then stated once, in config, and **a layout
can never raise it** — which is the property worth having, because dressing is
exactly the thing that grows without anybody deciding it should.

**An emitter's INDEX is its identity**, because it is the key `Sfx` hangs the
held-open graph on. Two rules follow and both are in the header of that file:
`add` may only append within a map, and a map being torn down owes
`Sfx.ambienceAllOff` *beside* `AmbienceSystem.clear` — a registry emptied
without it leaves a fire crackling at a coordinate on a map that no longer
exists, under whatever the next one builds there.

**The hysteresis is on the RANKING and not on the range**, which is one number
(`swapMargin`, 2.5 m) rather than two that have to agree. An emitter already
holding a voice is scored that much closer than it is, so it is both harder to
displace and kept a little past its own `range`; `Sfx.ambience`'s own 1.15 gate
is deliberately wider and is the general guard for any other caller. Measured
by injecting six emitters 6 m apart and walking 36 m along the line in 1.5 m
steps: **the cap held at 3 at every step, and four voices were dropped over the
whole walk** — one per genuine hand-off, no oscillation. That case is not
reachable on a shipped map, which is the point of having measured it: every
drum on Hollowmere, Sarab and Cinderhaven is more than one `range` from the
next, so in play the ranking has only ever been handed a list of one.

### It is the engine's graph, with the opposite conclusion about a held world

`Sfx.ambience` is `hullEngine` line for line — a graph behind a panner, keyed by
whatever the caller uses to tell one emitter from another, **called every frame
rather than when something starts**, with the range gate and its hysteresis
inside `Sfx` rather than at the call site. What is being tracked is not
somebody lighting a fire; it is a fire being within earshot.

**Where the two part company is what a held world is owed, and the difference
is the whole argument for where the push lives.** `enginesOff` exists because a
hull's voice is driven by a load that a lid freezes — a stopped fleet droning at
a throttle nobody is holding — so `Game.fleetStepped` stands those down and a
frame that did not step the fleet owes them silence. A fire is driven by
nothing at all. It is a property of the map being installed and the ear being
somewhere, and both of those are true of a menu or a deploy card over a live
view. **A village does not go quiet because a kit screen is up**, so
`Game.pushAmbience` runs in every state that renders and `ambienceAllOff` is
owed by exactly one caller, the teardown. The offline pause is the one held
world that reaches it, and not from here: that card suspends the audio context,
which holds the graph exactly as it holds the tail of the last shot.

**That is also what moved `sfx.setListener` out of the world step and into
`tick`.** A listener placed only by the frames that simulate sits wherever the
last live frame stood — the ORIGIN, before there has ever been one — which is
`mats.updateCamera`'s own bug with a different symptom: a fire in the village
panned from the map's corner while the menu is up over it. It still runs after
the camera update and after `lighting.update`; it is now last in the FRAME
rather than last in the world step.

### The fire, and how it was fitted

The first version of this graph sounded like **distant gunfire**, and it was
measured before it was rebuilt. `reference-media/fire.wav` — a 3 s recording of
a real drum fire, gitignored, never shipped, a measuring stick and not an asset
— was analysed for the four things that decide whether a noise reads as fire,
and the synth was rendered offline and put through the same analysis until the
numbers met.

| | reference | first version | shipped |
| --- | --- | --- | --- |
| crest factor | 23.5 dB | 11.1 | **23.0** |
| events over the bed | 9.8 dB | 2.0 | **9.0** |
| bed breathing (env p50/p10) | 2.49x | 1.10 | **2.21** |
| onsets a second | 24.7 | 9.4 | **23.8** |
| inter-onset CV | 0.62 | 0.43 | **0.66** |
| attack, median | 0.15 ms | ~2 ms | **0.08 ms** |
| decay to -20 dB | 3.9 ms | 40 ms | **4.4 ms** |
| event centroid | 7026 Hz | 1500 Hz | **5943 Hz** |
| peak spread p90/p10 | 5.0x | 1.2x | **5.1x** |

**The diagnosis was in the octave bands, and it is the thing to know before
touching any of this.** A fire's long-term spectrum is TWO HUMPS with a hole
between them — 63 Hz -4.1 dB, 125 -5.2, 250 -10.2, **500 -21.2, 1k -19.5**, 2k
-14.8, 4k -11.8, 8k -11.5, 16k -17.3 — and the first version put its crackles at
1500 Hz, directly in the hole, with a soft attack and a fixed pitch at an even
rate. **That is not a near-miss for a crackle; it is a good imitation of a rifle
two streets away**, because a soft-attacked mid-band transient is exactly what
distance does to a report. The graph was building the wrong thing twice over.

| layer | what it is for |
| --- | --- |
| roar — lowpassed noise | the column of air the drum is moving |
| bands — humps on their own source; a fire needs ONE | sap, ash and small stuff |
| breath — a slow modulator on all of them, at their own depths | a fire is not steady |
| sparks — impulses ringing resonators | the crackles |

**A CRACKLE IS AN IMPULSE RINGING A RESONATOR**, which is what a snapping fibre
physically is, and replacing the gate with that is the fix rather than a tuning
of it. The shared noise buffer is thresholded sample by sample with no filter in
front of it, so a single sample survives as a single-sample impulse; that train
excites a bandpass whose ring is the decay. The attack is then exact by
construction, and the impulse heights are uniform on (0, 1], which is where the
14 dB of level spread comes from without a term for it.

#### Four things that were only found by rendering it

1. **A spark row's `rate` must be a negative power of two, or the row is
   SILENT.** A threshold within a thousandth of full scale selects isolated
   single samples, and a read position that does not land on the sample grid
   interpolates between an extreme sample and an ordinary neighbour — always
   under the threshold. Measured, one row stated at 15 events a second gave
   107% of that at rate 1 and 110% at 0.5, then 57% at 0.2, 44% at 1/7, 21% at
   1/3, and **nothing at all at 0.37 or 0.61.** 1/3 is not exactly 0.333… in a
   float, so the position drifts off the grid. A cut of this graph shipped with
   its second row at 0.61 — that row was silent, the fire was one pitch
   repeated, and the numbers still measured well because the surviving row was
   carrying them. `buildAmbience` warns about it in a DEV build.
2. **`loop` is what stops a row repeating.** The buffer is one second, so a row
   at rate 1 replays its whole pattern of crackles every second, which is a
   rhythm. Each row reads a different whole number of SAMPLES — a fractional
   loop leaves the read position on a fraction after its first wrap, which is
   failure 1 arriving by another door — so the rows cycle at 1.94, 3.56 and
   5.68 s and the composite at about fourteen hours.
3. **A modulator spent on one layer cannot move the mix.** The breath was on
   the sizzle alone, and taking its depth from 0.8 to 1.4 moved the bed's
   envelope ratio from 1.69 to 1.74 — the roar carries most of the energy, so
   the sum barely noticed. It is spent on both now, at different depths,
   because they are different quantities.
4. **A number that is not normalised is not a level.** A single-sample impulse
   into a bandpass comes out at `alpha / (1 + alpha)` of its height — about
   0.036 at 7 kHz and Q 11 — so a stated level of 0.5 put the crackles 12 dB
   UNDER the bed. Both the spark gain and the breath depth divide their own
   transfer back out now, so the config numbers mean what they say and retuning
   a resonance or a modulator's corner does not silently retune the mix.

#### Two deliberate departures from the reference

**The roar is about 4 dB under it** (63 Hz lands at -8 against -4). Nearly four
fifths of that recording's power is below 250 Hz, which is partly the fire and
partly a close mic, and the game plays this through a panner at a distance on
laptop and phone speakers where 63 Hz does not exist. Matching it exactly ships
a drum that is a boom on headphones and silence on a phone, and spends the
headroom the crackles need.

**And most of the mid-high energy is EVENTS rather than bed**, which is the
most transferable thing here. Matching the reference's 2k-8k octaves with the
sizzle gets the bands right and the crest badly wrong — that version rendered at
17.6 dB against 23.5 — because in a real fire that energy is the crackles.
Moving it out of the bed and into `sparks` fixes both numbers at once, and it is
the difference between a fire and a hiss with ticks over it.

**The tools are throwaway and the numbers are not.** The analysis, the offline
render and the sweep harness were written to the scratchpad, not the repo; what
is worth keeping is in the table above and in `CONFIG.audio.ambience.fire`,
which carries the argument for every value beside it. A rebuild that changes the
mechanism owes the same table, measured the same way.

### Water, which is the fire's spectrum turned inside out

`reference-media/water.wav` is 2 s of running water and the same measuring
stick — gitignored, never shipped — and the first thing it said was that the
two ambiences in this game occupy **complementary octaves**.

| octave | 63 | 125 | 250 | 500 | 1k | 2k | 4k | 8k | 16k |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fire | -4.8 | -5.4 | -9.9 | **-20.2** | **-17.9** | -13.4 | -10.6 | -10.3 | -16.1 |
| water | -25.3 | -33.2 | -28.1 | -10.5 | **-2.9** | -5.3 | -12.9 | -15.4 | -16.9 |

A fire is two humps with a fifteen-decibel hole at 500 Hz–1 kHz. **Water is one
hump sitting exactly in that hole**, with nothing at either end. So a burning
drum on a quayside does not mask the sea beside it; and the trap that made the
first fire read as a rifle — a soft mid-band transient at an even rate — is not
available to water at all, because for water that band is the whole point.

**Those figures are normalised over the AUDIBLE band, and doing that is not
tidying.** **41.6% of the water reference's power is below 20 Hz** and none of
it is water — it is a microphone in the open air. Normalised against total
power every band reads 2.4 dB lower, which is 2.4 dB of systematic error handed
to a fit that has nothing subsonic in it to compare. The synth reproduces none
of that rumble, deliberately, for the reason the fire's roar is 4 dB under its
own reference: it would spend the emitter's whole headroom on something a
laptop speaker cannot make. (The fire's reference has 43.5% below 20 Hz too,
and its octave figures above are re-normalised the same way — they are the
numbers in `CONFIG.audio.ambience.fire`'s prose shifted by that constant, not a
retuning.)

#### A HUMP IS A ROW, and that is what the second kind actually cost

The graph needed no new layer for water and one new piece of STRUCTURE:
`AmbienceKind.bands` is a list where `sizzleHz`/`sizzleQ`/`sizzleLevel` used to
be three fields. The fire is one row and unchanged — proved by rendering the
old graph and the new one over the same noise buffer, **worst sample difference
6e-8, 139 dB below peak**, which is float32 addition order and not a sound.

**Two things forced the list, and both were measured rather than foreseen.**

1. **A brook has two humps.** Its rush is at 1 kHz and there is a second, much
   flatter shelf running 2.5–16 kHz that a single bandpass cannot reach from
   there. The first fit tried to carry that shelf on dense SPARK rows instead,
   which is the fire's own lesson ("most of the mid-high energy is events")
   applied in the wrong direction. It cannot work: an impulse train dense
   enough to read as a bed is no longer isolated impulses — the threshold that
   selects them widens into clusters, and the buffer those clusters are cut
   from is band-limited by its own playback rate. Rendered, the top three
   octaves came in **4 to 8 dB under** a fit whose arithmetic said they were
   right. Adding a second `BandSpec` took the whole curve from **2.9 dB rms
   error to 1.1**.
2. **A brook's skirts are ASYMMETRIC**, about 18 dB an octave below 500 Hz and
   7 above 2 kHz, and a single biquad's is 6 dB an octave whatever its Q — Q
   buys a narrow PEAK, never a steep skirt. So a band states `stages`, how many
   of itself in series. Fitted at third-octave resolution: **one stage 0.88 dB
   rms out, two 0.31, three 0.27.** Two is the knee, and what the single stage
   buys its accuracy with is a Q of 2.9 poking an audible tone through the
   middle of the plateau.

**Water inverts the fire's own headline finding, and the pair is the useful
part.** In a fire most of the mid-high energy is EVENTS: crackles stand 14.7 dB
over the bed at a crest of 23.5. In water it is almost all BED: gurgles stand
9.3 dB over at a crest of 17.4, which is barely above modulated noise. Carrying
water's energy the fire's way rendered events **15.8 dB over the bed at a crest
of 25.3** — a brook that ticks. The mechanism is identical either way; what
differs is which side of it the energy sits on, and the reference says which.

#### The brook, fitted

| | reference | shipped |
| --- | --- | --- |
| third-octave, 198 Hz–16 kHz | — | **1.15 dB rms** (worst +2.3 at 315 Hz) |
| crest factor (2 s windows) | 17.4 dB | **18.3** |
| bed breathing (env p50/p10) | 1.48x | **1.49** |
| events a second (2.5x bed) | 12.5 | **11.3** |
| events over the bed | 9.3 dB | **9.2** |
| event spread p10..p90 | 3.1 dB | **2.7** |

**Its gurgles are the fire's crackles' mechanism spent on different physics.**
A bubble in water is a resonator struck once and left to ring, exactly as a
snapping fibre is, so the rows differ from the fire's in nothing but where they
ring and how often. The ringdowns are Minnaert's — a bubble's note is about
`3.26 / r` — so the plop row at 560 Hz and Q 14 is a 6 mm bubble ringing for
18 ms.

**One deliberate departure, and it is the fire's departure again in a different
octave.** The top two thirds are about 2 dB under the reference, because that
recording is a close mic on a brook and the game plays this at five to thirty
metres through a panner with no air-absorption term anywhere. 16 kHz loses a
decibel or two over that distance in real air.

#### The shore, which is DERIVED and says so

There is one water master and it is running water, so the still-water kind has
no recording behind it. What it has instead is an argument, stated here so what
the numbers are worth is the same as what the argument is worth.

**The spectrum is the brook's moved down 0.85 of an octave.** Minnaert again: a
brook entrains air around 3 mm across and a wave folding onto a shore entrains
a great deal more, so the whole bubble population shifts down together and the
hump lands near 600 Hz. Fitted against that shifted curve the graph lands
**1.56 dB rms from 198 Hz up**, with the two departures named — +3.9 dB at
198 Hz, which is the surf rumble below, and -3.1 at 6.35 kHz.

**The time structure is where it actually differs, and it is the SWASH.** A
brook is steady; a shore ARRIVES.

| | brook | shore |
| --- | --- | --- |
| hump | 1090 Hz | 600 Hz |
| crest factor | 18.3 dB | **20.4** |
| bed breathing | 1.49x | **2.86** |
| breath peaks at | 0.78 Hz | **0.39 Hz** (a swell every 2.6 s) |
| bottom (`roarLevel`) | 0.0125 | **0.030** |

Three of those are one decision. `breathHz` drops to 0.28, the depths roughly
triple, and — the part worth carrying elsewhere — **the two depths come within
a third of each other where the fire's differ by 3.4x**, because a wave moves
the whole body of water at once while a fire's draught moves the small stuff
and the column of air barely notices. **How far apart a kind's breath depths
are is itself a claim about what the sound is.** And unlike the brook a shore
has a BOTTOM, which is the one number here that is about mechanics rather than
bubbles: a wave is a mass of water moving and a brook is only its own surface.

#### And the swell is BAKED, because 0.28 Hz is past what a biquad can hold

**The shore's `breathHz` is the number that broke this graph in a shipped
build, and the failure was numerical rather than musical.** The breath was a
`BiquadFilterNode` lowpass on the shared noise, one per voice, running at the
context's own rate. At 0.28 Hz against 48 kHz both poles sit within 3.7e-5 of
z = 1 — a double integrator with float32 rounding going into it — so the state
performs a random walk with almost no restoring force. Measured over
300-second renders of that filter ALONE, **three of six diverged**: a DC
offset that appears after ten or fifteen seconds and then climbs without
bound, past ±4 by the end. Neither the fire's 1.2 Hz nor the brook's 1.8 did
it in six renders each, and 0.6 Hz was already clear.

**What it cost is the makeup gain, which is the whole reason a DC offset here
is not a small thing.** The breath is spent on the band and roar gains as
`depth / rms`, 26x on the shore's swash, so a DC of 4 arrives as a band gain
of 105 against a nominal 0.46: the water comes up some 40 dB hot and goes on
rising for as long as the voice is held. **And this is the ONE voice in the
game that can hold long enough**, which is why it took a match to see it — a
fire is torn down and rebuilt as you walk past it, resetting the filter, while
a waterline emitter on a marsh map never loses its slot. Measured on Greyfen,
**67% of the play square is inside `shore`'s 46 m range and 9% is at its
plateau**, against 15–30% and 1–2% on every other map with water.

So the wander is built ONCE, in doubles, and read as a BUFFER
(`Sfx.buildBreathBuffer`): two one-pole passes, which is exactly what the
biquad was (a lowpass at Q 0.5 is two coincident real poles), run cyclically
so the loop has no seam. `breathHz` is the source's playback rate now — the
same trick the bed plays on the shared noise buffer — and a rate is nothing a
buffer can be unstable about. Twelve 300-second renders of the shipped code at
48 and 44.1 kHz hold their level end to end.

Two things fell out of it and both are improvements. **`breathRate` is gone**:
the loop is `BREATH_SECONDS / (breathHz / BREATH_WANDER_HZ)`, so the fire's
1.2 keeps its twenty seconds and a slower swell repeats proportionally later,
which is the right way round. And the makeup no longer divides by an ESTIMATE
of the filter's noise bandwidth (4–10% out where it was measured) — the buffer
is normalised to unit RMS, so `BandSpec.breath` and `breathRoarDepth` are
exactly the fraction of their own level that they claim to be.

#### Where water is HEARD, which is not where the rect is

**A lake makes no noise in the middle of itself**, so a `WaterRect` cannot hang
an emitter at its own centre. On Cinderhaven that is wrong twice over: the bay
rect is 1,380 m across, its centre is four hundred metres of open water from
any beach, and it CONTAINS the island — so a listener in the middle of the town
would be at zero distance from the sea. Both failures are one failure: a rect is
an EXTENT and the edge is not in it anywhere.

**So `MapBuilder.waterAmbience` derives the waterline from the FLOOR**, which
is the rule `docs/world.md` already states for Cinderhaven's own generator. It
marches each rect on a `shorelineStep` (6 m) grid and keeps a flooded cell with
an unflooded four-neighbour. Three rules, and each was found by getting it
wrong:

- **Flooded is asked of the whole LIST, not of one rect.** Asked of the terrain
  alone, a pool whose surrounding moor lies below its own surface has no edge
  anywhere and falls silent — Hollowmere's mire did. Asked of one rect's
  bounds, the seam between two rects of one sea reads as a shore, and
  Cinderhaven's water is a pinwheel of eight whose inner four meet in open
  water. Water is the UNION of the rects.
- **Past the floor there is no edge, only the end of the world.** Beyond the
  play square plus its borderland an unflooded neighbour is not a shore, it is
  a query `TerrainField` answered by clamping. Without that rule Cinderhaven's
  outer ring of ocean — which exists only to put a horizon past the fog —
  contributes ~1,300 points of waterline at 2,300 m from anything that can
  hear, to be scanned every frame for the life of the map.
- **A BODY of water is a connected group of rects, not a rect.** How water is
  drawn and what it IS are different questions: the sea is eight rects because
  a rect's bed map is 512 texels a side however big it is and because each one
  stands a reflection probe. Left as eight it would also be RANKED as eight —
  two or three of them win slots together near the island's west coast, where
  their edges meet, and a brazier on the quay behind you loses to a second copy
  of the same water. Rects join when they touch *and* agree what they sound
  like, so a mill race running into a pond stays two things you can hear at
  once.

**Then a body is ONE emitter that MOVES.** `AmbienceSystem`'s emitter is a run
of points rather than a place, it scores itself on the nearest one and hands
`Sfx` that point — a fire is a place and a shore is a line, and the honest way
to hear a line is from whichever part of it is nearest. The nearest point can
jump, and the only place it can is where two points are exactly equidistant, so
the level is continuous across the swap and only the bearing moves.

What the maps actually carry, and what it costs:

| map | bodies | waterline points | `AmbienceSystem.update` | build |
| --- | --- | --- | --- | --- |
| Hollowmere | 3 (creek, bog, mire) | 47 | 0.70 us | — |
| Harrowmead | 1 (the stream) | 147 | 1.60 us | — |
| Sarab | 4 (three wadi pools, the birkat) | 81 | 1.40 us | 0.5 ms |
| Cinderhaven | 1 (the sea) | 1,161 | 2.25 us | 18.2 ms of a 2,230 ms build |

The whole scan is in squared metres with the root taken once per emitter that
survives the reach test, which is what makes 1,161 candidates cost two
microseconds in a frame that also runs in every menu.

**Which of the two a map gets is DECLARED, because flow is not a shape.**
`WaterRect.sound` defaults to `"shore"` — the one optional field on a layout
whose default is not "unaffected", since silent water is a bug and not a
neutral choice — and a map states `"stream"` for water that runs. Geometry
cannot decide it: Hollowmere's creek is 6.6 m wide and Sarab's birkat is 54,
but Sarab's wadi pools are 75 m of standing water and a mountain beck would be
narrower than either. Hollowmere's creek and Harrowmead's stream are the two
that say so.

### What a prop owes, and what a second kind would

**Three things can carry a sound, and two of them say so beside the LIGHT they
already carry.** A scatter prop names one in `SCATTER_AMBIENCE` — a table keyed
by prop kind, directly beside `SCATTER_LIGHTS` and the same shape (`fireDrum`
is its only row) — and a STRUCTURE names one with `Build.sound(...)`,
`Build.light`'s twin, which puts a `LocalSound` on the structure exactly as
`light` puts a `LocalLight`. `MapBuilder` walks `s.sounds` through the same
rotation and the same origin as `s.lights`, because a placement can be turned
and the brazier on the far side of a watchtower has to end up on the far side
of it.

**The third is a `WaterRect`, and it is the one that names WHAT without naming
WHERE.** Every other carrier is a thing at a point, so stating the id is the
whole of it; a body of water is an area whose audible part is its edge, and
where that edge runs is a question only the floor can answer. So `sound` is on
the rect and the position is not — see below.

**A sound is named by ID, never by reaching for the audio config.** `AmbienceId`
is the union and `MapBuilder`'s `AMBIENCE_KINDS` is a `Record` over it — the
`WEAPON_BUILDERS` pattern, so a second kind does not compile half-added — and
it is the ONE place the world layer and `CONFIG.audio.ambience` meet. That is
what lets a building kit write `b.sound("fire", x, y, z)` beside its `b.glow`
and its `b.light` without knowing the audio config exists: **what is drawn as
burning is heard burning, in three lines that are one object.** The watchtower's
signal brazier is the first structure in the tree to take it.

**The position is taken at BUILD time or not at all.** `MapBuilder` flattens a
scatter prop's placement into its vertices and the merge then takes the mesh
away entirely, so there is no per-prop node left at runtime to hang an emitter
on — the registration is one line beside the light's, and an emitter not
recorded there has no second chance to be. A `LocalSound` also reaches nothing
else: the collision bake has never heard of it, because the server has no ears.

**THE RANKING IS REACHED NOW AND STILL NEVER EXCEEDED, and water is what
changed that.** With drums alone it was never handed a list of one: Hollowmere's
closest two emitters were 56.8 m apart against a `range` of 24. Water is a much
bigger object with a longer reach, so it competes for real. Sampled every 4 m
over each map's playable ground, counting emitters in range at once:

| map | ground within earshot | most at once | share at the cap |
| --- | --- | --- | --- |
| Hollowmere | 56.5% | **3** | 0.75% |
| Greyfen | 65.9% | 1 | — |
| Harrowmead | 23.1% | 2 | — |
| Sarab | 6.7% | 1 | — |
| Cinderhaven | 30.0% | 2 | 0.33% at two |

So the cap of three is TOUCHED on one map and exceeded on none, which is the
answer worth having in both directions: the ranking is exercised in play rather
than only by the synthetic walk above, and no shipped map is losing a sound to
it. The number to watch if a map dresses more water is that Hollowmere column —
and the reason it is 3 rather than 5 is `waterAmbience` joining touching rects
into one body, without which Cinderhaven's sea alone would put two or three
copies of itself in every one of those counts.

**A second KIND is a row in `CONFIG.audio.ambience` and no code, and water
found where the LIMIT of that is.** The kind is still a row — `stream` and
`shore` add no branch anywhere, and `buildAmbience` is one method for a
diesel-and-turbine reason, so the moment it grows an `if` asking which kind it
is holding, that is broken. What the old version of this paragraph got wrong is
what a row can be made of. It said a stream was "the same three layers with the
crackle gate wound shut", and both halves are false: a stream's gurgles are the
crackle mechanism working exactly as designed, and its second hump is a thing
three fixed fields could not express. A second KIND is a row; a second HUMP had
to become a row too.

**What does NOT belong here is the other shape of ambient sound: the random
one-shot** — a frog, a dog, a creaking sign. Those are not a sustained voice and
must not become one. They are one-shots fired by a countdown in the CALLER, the
rule footsteps already obey (`Sfx`'s header: *"footsteps are one-shots fired by
the caller's own gait phase… never by a timer in here"*), and the countdown has
to be in seconds rather than a per-frame probability — a per-frame chance fires
eight times as often at 240 Hz as at 30.

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
as delivered: eight are reports and their cuts run 90 to 180 ms, and two are
BLASTS, cut to 210 and 520 ms for a reason of their own below. The two 3.0 s
files are `reload.wav`, which two rows are cut from, and `bolt-cycle.wav`,
which four are. **Between 48 and 95% of every master is discarded**, and the
discarded part is almost always the same thing: a baked room this engine
already has one of. The two PERFORMANCES and the grenade are the exceptions,
and all three are instructive rather than a lapse — see below.

### The assault rifle, which is the reference

The master is 1.0 s. **The shipped cut is 90 ms**, from 21 to 111, and what the
other 910 ms is has changed once already — which is the most useful thing about
this row.

**The master this row was written for** was one round with a room on it: the
report to 130 ms, a 15 dB cliff, a nearly flat plateau at −18 to −24 dB out to
385, then a slow decay to −68. That tail measured a **crest factor of 6 dB with
no window 5 dB above it** — dense noise, no discrete reflection, no mechanism —
so cutting at 150 lost nothing, and shipping it would have been wrong four ways,
all four about this engine rather than about the recording. `Sfx` already
answers every gunshot with a **shared `ConvolverNode` on a send**, which costs
no voice and no per-shot memory. A baked room would double-reverb the shot; put
one fixed room on six maps that include a desert town and a harbour at night;
defeat `botShot`'s reverb send climbing with distance, which is what makes a
shot across the valley "nearly all tail"; and hold a voice for 865 ms instead of
150, at up to eighty shots a second.

**The master that is in the tree now is a BURST**, and it takes three of the
four rules below at once rather than founding one:

- 0–12 ms — digital silence.
- 14–21 ms — a mechanical tick, −50 dB absolute and all of it 2–5 kHz.
- 23 ms — the first round. Full scale to ~102 ms.
- 111 ms — the trough. Above 4 kHz the report has decayed to −18.6 dB here.
- 113 ms — **the second round**, stepping that band 15 dB in 2 ms.
- 204 ms — **the third**, 91 ms after the second.

Three rounds 90 and 91 ms apart, the second only 3.4 dB under the first
broadband and 3.8 dB under it above 4 kHz. That is a shot and not a reflection:
a 31 m return does not come back that bright, and a slapback does not repeat
evenly. `Sfx.shoot` is called once per ROUND, so the whole of it fires three
rounds for every trigger pull — the carbine's rule, arriving on the reference
gun. There is no room to cut off this master at all, because the first round's
own tail is still running when the second lands, so the 89% discarded here is
not the 85% of baked room the old one discarded. The cut is 21 (the trough in
front of the first round, dropping a 23 ms lead) to 111 (the trough in front of
the second), and its level lands where the old cut's did: 0.500 RMS mono
against 0.475, through 60% of the length.

**The general rule survived the replacement and the row's own numbers did not:
a sample is the DIRECT sound, the room is the game's, and what a sample may
contain is one call's worth of sound.** A master is a fact about a file rather
than about a weapon, so a replaced one re-opens the trim, the channel count and
the level together — this row went from stereo to mono on the same swap, for
the reason under rule 1 above.

### The other six, and the three rules they added

The rifle's ORIGINAL cut needed one test — where does the report end — because
that master handed one over: a 15 dB cliff at 130 ms with a flat plateau after
it. The six that followed each broke that in a different way, and each break is
a rule rather than a detail of one file. (The rifle's replacement master then
broke two of the three itself, which is why its row above reads like theirs.)

| id | weapon | cut | of master | what the trim is fighting |
| --- | --- | --- | --- | --- |
| `assaultRifle` | rifle | 21 – 111 ms | 9% | **a second and third ROUND**, and a 23 ms lead |
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

**1. A master of a BURST weapon is a burst — and so, it turns out, is a master
of an automatic one.** `Sfx.shoot` is called once per ROUND — the carbine's
three leave 50 ms apart and each one is its own call — so a sample carrying the
burst fires nine shots for every three. The carbine's second round is on its
master at 216 ms at −4 dB and a third rides the tail out past 330; the cut ends
at 120 and none of that is a matter of taste. **Two rows take this rule now**:
the assault rifle's replacement master carries three rounds 90 ms apart, which
is the same arithmetic on a weapon whose trigger is not the reason for it. This
is the one rule here that is about CORRECTNESS rather than about a room, and it
generalises: what a sample may contain is one call's worth of sound.

**2. A mechanism on the tape is cut whichever end it is on, and the front end
is the expensive one.** Four of the eight masters lead with one. The carbine's
report starts 32 ms into its master, the assault rifle's 23 ms into its, the
LMG's 50 ms into its, and the mounted
gun's 40 ms into its — that last is the plainest of the three, a discrete clack
at 8–16 ms (−6 dB above 4 kHz) followed by near-silence to −61 before the
report arrives. Everything before an onset is −23 to −61 dB of pre-noise.
Shipped whole that is 23 to 50 ms of latency between the trigger and the
sound — a third of the carbine's whole burst, half the LMG's cycle, a fifth of
the rifle's gap between rounds — and it cannot be recovered downstream, because
`Sfx`'s own `trimSample` only skips what is under −54 dBFS and every one of
these is far louder than that. **Every start point sits in a TROUGH rather than
hard against the onset** (−41 dB at 24 ms on the carbine, −46 at 21 on the
rifle, −50 at 40 on the mounted gun), which is what lets the pipeline stay a
start/end/fade with no fade-in in it: a cut made at a trough cannot click, and
the transient keeps a foot.

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
The SMG ships 140 ms against a 77 ms gap, so two rounds always overlap; the
carbine's 96 ms is the shortest but one in the table because three of its rounds
leave in 0.1 s, which is the same argument `report.length: 0.75` already makes
for it in `config/weapons.ts`. A cut that runs past the next round is a burst
you cannot count. **The rifle is the case where the MASTER decided this instead
of the weapon**: 90 ms against a 106 ms gap is the only report row that does not
overlap its own next round, because the recording's second round is where the
cut had to end. Sustained fire is therefore the one place the two masters read
differently, and what fills the gap is the convolver's tail off `report.tail` —
the game's room rather than the recording's.

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
