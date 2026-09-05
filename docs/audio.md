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

**Seven files sit on top of it: one report per weapon in the kit, and nothing
else in the game is recorded at all.** 21.8 KB downloaded once, 1.9 of the 44
mono-seconds the budget below allows. **That boundary is a decision and not a
waiting list** — a footstep, an impact, a reload or an ambient bed is a
different argument, and the section on where the money should go is where it is
made.

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

**One ambient bed costs ten times the entire sampled gun kit**, and ambience is
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

Seven masters, every one of them 1.0 s of 48 kHz stereo as delivered, and the
seven shipped cuts run 96 to 180 ms. **Between 82 and 90% of every master is
discarded**, and the discarded part is almost always the same thing: a baked
room this engine already has one of.

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

**1. A master of a BURST weapon is a burst.** `Sfx.shoot` is called once per
ROUND — the carbine's three leave 50 ms apart and each one is its own call — so
a sample carrying the burst fires nine shots for every three. The carbine's
second round is on its master at 216 ms at −4 dB and a third rides the tail out
past 330; the cut ends at 120 and none of that is a matter of taste. This is
the one rule here that is about CORRECTNESS rather than about a room, and it
generalises: what a sample may contain is one call's worth of sound.

**2. A mechanism on the tape is cut whichever end it is on, and the front end
is the expensive one.** The carbine's report starts 32 ms into its master and
the LMG's 50 ms into its; everything before is −23 to −57 dB of pre-noise.
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
