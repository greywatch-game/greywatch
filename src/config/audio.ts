/**
 * config/audio.ts — the synthesized mix.
 * Owns: levels, distances and rolloff for `core/Sfx.ts`.
 * Gotcha: there are zero audio files in this project. Every sound is built
 * from WebAudio primitives, so a level here is a gain node, not a file.
 */

export const audio = {
  /**
   * Concurrent one-shots. Sixteen bots firing is ~80 shots a second; past
   * this many voices the ear can't separate them and the scheduler can't keep
   * up, so extras are dropped rather than queued.
   */
  maxVoices: 24,
  /**
   * The plateau: how close a world one-shot has to be before getting closer
   * stops making it louder. A point source's level is only defined outside
   * its own size, and a rifle is a point — three metres is arm's length,
   * which is where "beside me" genuinely stops being a distance.
   *
   * **It was 8 m under a LINEAR rolloff and between them that was the whole
   * of the near-field mix**, which is to say there wasn't one: everything
   * inside a room played at unity and linear over 62 m took a shot at 16 m
   * down by 1 dB. So a bot firing ten metres away arrived within 2 dB of the
   * player's own report, which is neither what a game wants nor what the
   * world does — measured, an SA80 is 161 dB(C) at the shooter's ear and
   * 128 at 32 m. See `rolloff`; the pair is one decision.
   *
   * A hull's engine has a plateau of its own (`engineRef`) because a tank is
   * not a point.
   */
  refDistance: 3,
  /**
   * How hard a world one-shot falls off past that plateau, under an INVERSE
   * model — `1` is the physical 6 dB per doubling of distance and this is
   * deliberately under it.
   *
   * Physics alone is not playable here: 6 dB a doubling puts a rifle at ten
   * metres 24 dB under your own, which is right at the ear and useless as
   * situational awareness in a game where the whole read is where the fight
   * is. 0.7 is about 4.2 dB a doubling — steep enough that the near field
   * finally reads (a shot at 10 m lands ~10 dB under your own report, one at
   * 20 m ~16), shallow enough that the far field survives.
   *
   * **What pays for the far field is that the reverb send is PRE-panner and
   * climbs with distance** (`reverbDistanceSend`), so none of this touches
   * it. A shot across the valley was always mostly tail; now it is mostly
   * tail against a direct sound that has actually got out of its way.
   */
  rolloff: 0.7,
  /**
   * The GATE: past this a world one-shot is not built at all. Matched roughly
   * to the fog.
   *
   * It was the far end of the linear rolloff as well, which meant it cost
   * nothing to enforce — the curve was already at zero there. Under `rolloff`
   * it is a budget decision again: 70 m is ~24 dB down and inaudible under a
   * firefight, and what the gate buys is the voice. It also stops binding the
   * few sounds whose own reach is longer (a blast gates at 1.6-2.2x this),
   * which under the linear model were built and then multiplied by exactly
   * zero.
   */
  maxDistance: 70,
  /**
   * Metres per second. A shot across the map arrives ~0.2 s after its muzzle
   * flash, which is the cue that tells the ear how far away a firefight is
   * far more strongly than volume does.
   */
  speedOfSound: 343,
  /**
   * How far AHEAD of the frame the player's own report is scheduled, in
   * seconds — one 60 Hz frame.
   *
   * A round is due partway through a frame and can only be FIRED on the
   * boundary; `Player.tryShot` carries that sub-frame debt so the simulated
   * cadence is exact, but a sound cannot be scheduled in the PAST, so the
   * report still lands on the boundary and inherits the whole of the frame's
   * jitter. At 566 rpm that is a nominal 106 ms gap arriving as anything from
   * 95 to 122, which is ~12% of the interval against an ear that resolves
   * irregularity in a click train at about 3%.
   *
   * So every report is shifted by this CONSTANT and each one gives back the
   * part of it the round had already used (`Player.reportDelay`). A constant
   * shift is inaudible — it moves the whole string, so no interval inside it
   * changes — and what it buys is that the intervals become exactly what the
   * weapon table says.
   *
   * **The cost is real and it is absolute latency**: the first round of a
   * string cracks one frame after its own muzzle flash. That is the right way
   * round — sound lags light in the world, and audiovisual simultaneity holds
   * to far more than a frame — and it is dwarfed by WebAudio's own output
   * latency, which is tens of milliseconds before this is added. The RELATIVE
   * timing this protects is the half the ear actually resolves.
   *
   * Set to 0 to schedule every report on the frame boundary exactly as before.
   * Raising it past a frame buys nothing: `reportDelay` is already clamped at
   * 0, so a longer frame than this simply gets less of the correction rather
   * than a report scheduled early.
   */
  shotLookahead: 0.017,
  /**
   * The village answering a gunshot: one shared convolution reverb every shot
   * sends into. Length is the decay of the diffuse tail; a report outdoors is
   * a short transient followed by a few hundred milliseconds of stone and
   * timber, and it is that tail, not the report, that reads as "real gun".
   */
  reverbSeconds: 0.9,
  /** Wet level of that shared bus. */
  reverbMix: 0.5,
  /**
   * Extra reverb send per unit of `maxDistance`. Reverberant energy falls off
   * far more slowly than the direct sound, so a distant shot is mostly tail
   * and a close one is mostly crack.
   */
  reverbDistanceSend: 1.6,
  /**
   * Rounds arriving. **All three of these are the voice cap**, and they exist
   * because impacts are the one sound in the game that is generated at the
   * same rate as gunfire and matters less than it: sixteen bots is ~80 rounds
   * a second and almost every one lands on something.
   *
   * `impactRange` is how far one carries — far shorter than `maxDistance`,
   * because an impact whose dust you cannot see is not information, and 80 a
   * second from across the valley would spend the voices on nothing.
   *
   * `impactInterval` is the floor between two of them (~22 a second). Past
   * that the ear cannot separate the transients anyway, so the ones dropped
   * cost nothing that was being heard.
   *
   * `impactReserve` is voices held BACK from impacts, and it is the only
   * priority scheme in this class. The cap is first-come-first-served and an
   * impact arrives in the same millisecond as the shot that caused it, so
   * without a reserve the least important sound in the game can starve the
   * most important one. Refusing early against `maxVoices - impactReserve` is
   * the whole of it.
   */
  impactRange: 30,
  impactInterval: 0.045,
  impactReserve: 6,
  /**
   * The floor between two FULL near misses, and it is the same argument as
   * `impactInterval` with the priorities inverted.
   *
   * A near miss is five layers over 300 ms now that it is modelled on a
   * recorded flyby (`Sfx.nearMiss`), and a burst walked across the player is a
   * string of them — at eight a second that is more held voices than
   * `maxVoices`, and `burst` refuses at the cap, so the crack itself would be
   * the thing that went missing. Past this the swell, the body and the
   * departure are dropped and the SNAP always plays: overlapping approaches
   * and tails are mud, and the snaps are what the ear separates in a string
   * anyway.
   *
   * Longer than `impactInterval` by four times because the cue is four times
   * longer, not because it matters less. Roughly five full flybys a second.
   */
  nearMissInterval: 0.2,

  /**
   * How close somebody else's weapon has to be for its low roll to be built at
   * all — the third layer of `Sfx.botShot`, and the one that makes a rifle
   * going off across the street a physical event rather than a noise.
   *
   * Its own gate rather than a fade over `maxDistance`, and for the same two
   * reasons `impactRange` is one. It is the layer the far field has no use
   * for: the panner has a 60 m shot's low end down to nothing worth a voice,
   * and what that listener is actually reading — the flight time, the missing
   * top end, the rising tail — is in the two layers that always play. And it
   * is generated at gunfire's rate, so a roll for every one of sixteen bots
   * would be the largest single line in the voice budget for the least of it.
   *
   * Roughly half `maxDistance`, which is a street rather than a valley, and
   * comfortably inside `impactRange` (30) — so anything close enough for its
   * roll to reach you is close enough for the round's arrival to as well.
   */
  thumpRange: 32,

  /**
   * How far a window going in carries.
   *
   * Its own number, and larger than `impactRange`, because a break is not an
   * impact at an impact's rate: a pane can only break once, so there is no
   * stream of them to bound, and it is the only world sound that says somebody
   * has just come through somewhere. Sixty metres is inside `audio.maxDistance`
   * (70) and comfortably past `bots.perception.engageRange` (55), so a break
   * you hear is a fight you could already be in.
   */
  glassRange: 60,

  /**
   * How far a HULL's engine carries — `Sfx.hullEngine`, the voice belonging to
   * a tank the player is NOT sitting in.
   *
   * Its own number and by far the largest in this file, because a diesel under
   * load is not a rifle. It is the loudest thing on the map, it runs
   * continuously rather than in transients, and what it tells you is not that
   * something happened but that armour is somewhere behind you — a cue that is
   * only worth anything if it arrives well before the tank does. At 150 m it
   * reaches across the whole of the three small maps, which is the intent.
   *
   * It is a HARD gate rather than a fade: past it the voice is not built at
   * all. That costs nothing audible at the boundary because the rolloff there
   * is INVERSE rather than the linear one every one-shot in this file uses,
   * and inverse has already taken 150 m down to about a twentieth — there is
   * no cliff to hear, only a six-source graph not worth holding open.
   */
  engineRange: 150,

  /**
   * The engine voice's own plateau, and it is a separate number from
   * `refDistance` because a hull is not a point source — a tank is seven
   * metres long, so there is no useful sense in which you are "3 m from the
   * engine". Eight metres is roughly the machine.
   *
   * It carries the engine's LEVEL as much as its curve (`HULL_ENGINE_LEVEL`
   * is tuned against it), which is the reason it did not move when
   * `refDistance` did.
   */
  engineRef: 8,

  /**
   * The world's SUSTAINED voices — a fire in a drum, and whatever is added
   * beside it. Nothing here is a recording and nothing here ever will be:
   * `docs/audio.md` prices one 30-second ambient loop at 5.5 MB decoded,
   * which is ten times the entire sampled gun kit, and a fire crackle
   * genuinely IS filtered noise. **Sample the guns, never the ambience.**
   *
   * What this costs instead is CPU and slots, which is what `maxVoices`
   * below is for, and it is a completely separate budget from the one-shot
   * cap: a held-open graph is not counted against `CONFIG.audio.maxVoices`,
   * exactly as the engine's is not.
   */
  ambience: {
    /**
     * How many sustained emitters are held open at once, whatever the map
     * placed.
     *
     * This is `LightingSystem`'s problem with a different budget and it gets
     * `LightingSystem`'s answer: a village may hold twenty burning drums and
     * the nearest few win, because past two or three overlapping crackles
     * the ear reads one fire anyway. Three at ~3 sources each is nine held
     * sources — beside the tank engine's six, and against a one-shot cap of
     * 24 that none of them touch.
     */
    maxVoices: 3,
    /**
     * Metres a SLOT is worth defending by. An emitter already holding a slot
     * is scored this much closer than it is, so two fires either side of a
     * street do not trade the slot back and forth every few frames as the
     * player walks the line between them — the same job `hullEngine`'s 1.15
     * does for the range gate, asked of the RANKING instead.
     */
    swapMargin: 2.5,
    /**
     * Metres between the points a body of water's WATERLINE is sampled at.
     *
     * An audio number rather than a world one, because what it decides is how
     * closely one emitter can follow a shore — see `AmbienceSystem`, where a
     * run of points is one emitter that moves rather than many that compete.
     * At 6 m the nearest sampled point is at worst 3 m along the shore from
     * the true one, which at any distance the sound is audible from is a
     * fraction of a decibel; halving it doubles a coastline's per-frame cost
     * for nothing. `MapBuilder.waterEmitters` is what spends it, once, at
     * build time.
     */
    shorelineStep: 6,
    /**
     * A BURNING DRUM. The first of three kinds, and still the reference the
     * other two were fitted against — they are its graph with its terms
     * pointed somewhere else, and there is no branch between them anywhere.
     *
     * Held as a spec rather than as numbers in `Sfx` for the reason
     * `EngineKind` is: what a thing sounds like is a row, and a second kind
     * should be a second row and never a branch. What the water rows below
     * then proved is where the LIMIT of that is — a second kind is a second
     * row, but a second HUMP had to become a row of its own too, which is
     * what `AmbienceKind.bands` is.
     */
    fire: {
      /**
       * Metres. Past this the graph is not built at all, with hysteresis on
       * the way back out — `Sfx.ambience`.
       *
       * A burning barrel is not a landmark you navigate by; it is something
       * you notice when you are in the street with it. 24 m is about that,
       * and it is deliberately far short of `maxDistance` (70) so that a
       * village's worth of drums cannot crowd the ranking from across the
       * map.
       */
      range: 24,
      /**
       * The plateau, metres — `refDistance`'s question asked of a fire. A
       * drum is a metre across and you can stand next to it, so this is
       * smaller than the gunshot's 3 and much smaller than a hull's 8.
       */
      refDistance: 1.6,
      /**
       * Steeper than a gunshot's 0.7 on purpose. That number is bent under
       * the physical 1 so a firefight stays readable across a valley, which
       * is a claim about SITUATIONAL AWARENESS; a fire is the opposite kind
       * of sound — it says "you are beside it" and nothing at all about
       * where the fight is — so it gets the physical curve and a little
       * over. At `refDistance` 1.6 this puts the far end of `range` about
       * 26 dB down, which is under the wind.
       */
      rolloff: 1.2,
      /**
       * Overall level at the plateau, and **the one number in this block
       * that is a mix decision rather than a fit.** Everything else here was
       * measured against a reference recording; nothing can measure how loud
       * a fire should be against a firefight.
       *
       * It is set for HEADROOM rather than presence, because this graph has
       * a crest factor of 23 dB — the crackles peak far above the bed by
       * design, which is most of what makes them crackles — so a level
       * chosen by the bed's loudness puts the peaks near full scale on their
       * own. At 0.09 the emitter renders at about 0.037 RMS and peaks near
       * 0.54, which is present at arm's length, well under a report, and
       * still inside the master soft clip when a firefight is stacked on top
       * of it.
       */
      level: 0.09,

      /**
       * THE BED, and its shape is the single most surprising thing the
       * reference recording said.
       *
       * A real drum fire's long-term spectrum is TWO HUMPS with a hole
       * between them — measured in octave bands relative to total power:
       * 63 Hz -4.1 dB, 125 -5.2, 250 -10.2, **500 -21.2, 1k -19.5**, 2k
       * -14.8, 4k -11.8, 8k -11.5, 16k -17.3. So a fire is a low roar and a
       * high sizzle with almost nothing in the middle, and the first version
       * of this graph put its crackles at 1500 Hz — directly in the hole.
       * That is most of why it read as distant gunfire rather than as fire:
       * a soft-attacked mid-band transient is what DISTANCE does to a rifle
       * report, so the graph was building the wrong thing twice over.
       *
       * The hole is not authored. Two filters with nothing between them —
       * a 12 dB/octave lowpass at `roarHz` and a bandpass whose lower skirt
       * starts well above it — leave it there for free, which is why there
       * is no midrange term anywhere in this block.
       *
       * **The shipped roar is about 4 dB under the reference's** (63 Hz
       * lands at -8 against its -4) and that is deliberate. Nearly four
       * fifths of that recording's power is below 250 Hz, which is partly
       * the fire and partly a close mic; the game plays this through a
       * panner, at a distance, on laptop and phone speakers where 63 Hz does
       * not exist at all. Matching it exactly ships a drum that is a boom on
       * headphones and silence on a phone, and spends the headroom the
       * crackles need.
       */
      roarHz: 150,
      roarLevel: 3.2,
      /**
       * The sizzle, and a fire is the one kind here that needs only ONE hump.
       *
       * A BROAD one, not a band — Q 0.35 is about two octaves either side of
       * 5.2 kHz, which covers the reference's 2k/4k/8k plateau with one
       * filter, and `stages: 1` because nothing about a fire's spectrum wants
       * a steep skirt: what is below this is the hole, and the hole is the
       * feature.
       *
       * **It is much quieter than the first fit made it, and the reason is
       * the most useful thing this exercise turned up.** Trying to match the
       * reference's 2k-8k energy with the BED gets the octave bands right
       * and the crest factor badly wrong — rendered, that version measured
       * 17.6 dB of crest against the reference's 23.5 — because in a real
       * fire most of the mid-high energy is not a bed at all, it is the
       * CRACKLES. Moving that energy out of this term and into `sparks`
       * fixes both numbers at once, and it is the difference between a fire
       * and a hiss with ticks over it. **Water inverts that exactly**, which
       * is why `stream` below spends most of its energy on `bands` and only
       * a garnish on events.
       */
      bands: [{ hz: 5200, q: 0.35, stages: 1, level: 0.13, breath: 1.1 }],
      /**
       * THE BREATH. A real fire's bed is not steady — measured on the
       * reference, the 5 ms envelope's median is 2.49x its 10th percentile,
       * so the bed itself swells and falls by about 8 dB. The shipped graph
       * renders 2.22.
       *
       * It is a source of its own rather than a tap off the bed's noise,
       * because the bed is read at 0.33 against a one-second buffer and a
       * modulator taken from it would repeat every three seconds — which is
       * the same trap `SparkSpec.loop` exists for. At 0.05 this cycles every
       * twenty seconds instead.
       *
       * **`breathRate` and `breathHz` are not the same question and reading
       * them as one is how a swell gets tuned by accident.** `breathHz` is
       * how FAST the modulator wanders, and it is the only one that reaches
       * the sound: the shore below sets it to 0.28 and swells every two and
       * a half seconds, the brook to 1.8 and shimmers. `breathRate` is only
       * how long the modulator takes to REPEAT — one second of buffer at
       * 0.05 is twenty — and every kind here holds it there, because there
       * is no reason for any of them to loop sooner and every reason not to.
       *
       * **A depth per term, because one did not work.** Spent on the sizzle
       * alone the whole mix would not move: rendered, taking the fire's hump
       * depth from 0.8 to 1.4 changed the bed's envelope ratio from 1.69 to
       * 1.74. The roar carries most of the energy, so modulating only the
       * hump cannot swing the sum however hard it is driven. They stay
       * different numbers because they are different quantities — the small
       * stuff answers a gust and the column of air barely notices, and
       * moving both by the same fraction reads as somebody turning a volume
       * knob. **How far apart they are is itself a claim about the sound**:
       * the fire's differ by 3.4x, and the shore's below are within a third
       * of each other, because a wave moves the whole body of water at once.
       */
      breathRate: 0.05,
      breathHz: 1.2,
      breathRoarDepth: 0.32,

      /**
       * THE CRACKLES, and the mechanism is completely different from the
       * first version — which is the fix rather than a tuning of it.
       *
       * That version gated a continuous resonant band with a lowpassed
       * noise. A gate built out of a band-limited signal opens as slowly as
       * its own bandwidth, so every event had a soft attack (milliseconds),
       * the same duration, the same pitch and nearly the same level: 9.4
       * events a second, all alike, at 1500 Hz. Measured against the
       * reference that is wrong in every term — real crackles arrive at
       * **24.7 a second, attack in 0.15 ms, decay to -20 dB in 3.9 ms**, and
       * their peaks are spread over 13.9 dB.
       *
       * So a crackle is an IMPULSE RINGING A RESONATOR, which is what a
       * snapping fibre physically is. The shared noise buffer is thresholded
       * sample by sample by a waveshaper — no filter in front of it, so a
       * single sample survives as a single-sample impulse with a
       * sub-microsecond attack — and that impulse train excites a bandpass.
       * The attack is then exact by construction rather than tuned, the
       * decay is the resonator's own ring, and the height of each impulse is
       * `(|sample| - threshold) / (1 - threshold)`, which is UNIFORM on
       * (0, 1] and gives the level spread for free.
       *
       * **`hz` is events a second and means it**: the threshold is derived
       * at build time from the context's own sample rate and this row's
       * playback rate, so a row gives the same rate at 44.1 and 48 kHz
       * rather than a threshold that quietly means something different on
       * each. Rendered, a row stated at 15 delivers 16 to 18.
       *
       * **`rate` must be a negative power of two and `loop` is what stops
       * the row repeating** — both are documented on `SparkSpec`, and both
       * are silent failures rather than loud ones.
       *
       * **THREE rows, because one is a single pitch** and a single pitch
       * repeated is the other half of why the first version sounded like
       * gunfire. A fourth is a fourth entry here and no code at all.
       */
      sparks: [
        /** The tick: most of the events, and where the reference's top end is. */
        { hz: 11, rate: 0.5, loop: 0.97, ringHz: 8600, ringQ: 7, level: 3.36 },
        /** The snap: fewer, lower, longer — the reference's p10 end. */
        { hz: 7, rate: 0.25, loop: 0.89, ringHz: 3600, ringQ: 6, level: 2.9 },
        /**
         * The pop: rare, and the only thing here anywhere near the spectral
         * hole. It is safe DOWN there for the reason the first version was
         * not: a 0.08 ms attack at four a second among eighteen brighter
         * ones is a log settling, where a soft-attacked 1500 Hz ring nine
         * times a second on its own was a rifle two streets away.
         */
        { hz: 4, rate: 0.125, loop: 0.71, ringHz: 1900, ringQ: 5, level: 2.2 },
      ],
    },

    /**
     * RUNNING WATER, and the first thing its reference recording said is that
     * it is the fire's spectrum turned inside out.
     *
     * A fire is two humps with a fifteen-decibel hole at 500 Hz–1 kHz. A brook
     * measures **63 Hz -25.3 dB, 125 -33.2, 250 -28.1, 500 -10.5, 1k -2.9,
     * 2k -5.3, 4k -12.9, 8k -15.4, 16k -16.9** — one hump, sitting exactly in
     * that hole, with nothing at either end. So the two ambiences in this file
     * occupy complementary octaves, a burning drum on a quay does not mask the
     * water beside it, and the trap the fire's crackles fell into (a mid-band
     * transient reads as a rifle two streets away) simply does not exist here,
     * because for water that band is the whole point.
     *
     * **Those figures are normalised over the AUDIBLE band and that is not a
     * detail.** 41.6% of the recording's power is below 20 Hz and none of it
     * is water — it is a mic in the open air. Normalising against it puts
     * every band 2.4 dB under where a fit has to land, and reproducing it
     * would spend the whole emitter's headroom on a rumble no laptop speaker
     * can make. `roarLevel` here is therefore nearly nothing, and it is the
     * one place a brook and a shore genuinely disagree about the bottom.
     *
     * Rendered against the recording: **third-octave 1.15 dB rms from 198 Hz
     * to 16 kHz** (worst +2.3 at 315 Hz), crest 18.3 dB against 17.4, the
     * 5 ms envelope swelling 1.49x against 1.48, and 11.3 events a second
     * standing 9.2 dB over the bed with 2.7 dB of spread, against 12.5 at
     * 9.3 and 3.1.
     */
    stream: {
      /**
       * Metres. A brook is not a landmark either, but it carries further than
       * a burning barrel and it is a LINE rather than a point — see `rolloff`.
       */
      range: 34,
      /**
       * The plateau. Bigger than the fire's 1.6 because the emitter stands
       * in for a stretch of water rather than for an object: the nearest
       * point of a waterline is never the whole of what you are hearing, so
       * a plateau shorter than the run itself is a lie about where it is.
       */
      refDistance: 3,
      /**
       * **Deliberately under the physical 1, and for a different reason than
       * the gunshot's 0.7 is.** That number is bent for READABILITY — a
       * firefight has to stay legible across a valley. This one is bent
       * because the source is the wrong SHAPE: a point source falls 6 dB a
       * doubling and a line source falls 3, and what is behind this panner is
       * a run of water some tens of metres long. 0.75 splits the difference
       * and still has `range` about 21 dB down, which is under the wind.
       */
      rolloff: 0.75,
      /**
       * Renders 0.0201 rms and peaks 0.189, against the fire's 0.036 and
       * 0.543 — and like the fire's, this is the one number here that is a
       * MIX decision rather than a fit, because nothing can measure how loud
       * a stream should be against a firefight.
       *
       * It is set about 5 dB under the fire in rms and 9 under it in peak,
       * which is further under than a brook stands next to a burning barrel
       * in life. Two reasons, both about this game rather than about water. A
       * fire is a LANDMARK you notice and walk past; water is a bed that is
       * there the whole time you are near it, and the ear integrates a steady
       * bed far more readily than it does crackles. And a coastal map can put
       * three water emitters inside the ranking at once, which is 4.8 dB on
       * top of whatever one of them costs.
       */
      level: 0.4,
      /**
       * Barely anything, and that is the measurement rather than taste: a
       * brook has NO BASS. Once the recording's subsonic rumble is taken out
       * (see above) its 125 Hz octave sits 30 dB under its 1 kHz one. What
       * this term is doing is putting a floor under the hump's low skirt, not
       * giving the water a body — the body is the shore's, one row down.
       */
      roarHz: 175,
      roarLevel: 0.0125,
      /**
       * **THE RUSH AND THE SPRAY**, and two rows rather than one is the whole
       * reason `AmbienceKind.bands` is a list.
       *
       * The rush is `stages: 2` because a brook's spectrum is ASYMMETRIC —
       * about 18 dB an octave below 500 Hz and only 7 above 2 kHz — and a
       * single biquad's skirt is 6 dB an octave whatever its Q. Fitted at
       * third-octave resolution, one stage lands 0.88 dB rms out, two 0.31
       * and three 0.27: two is the knee, and what the single stage buys its
       * accuracy with is a Q of 2.9 poking an audible tone through the middle
       * of the plateau.
       *
       * The spray is one wide stage carrying 2.5–16 kHz, and it exists
       * because the FIRST fit tried to carry that shelf on dense spark rows
       * instead. That is the fire's own lesson applied backwards and it
       * cannot work: an impulse train dense enough to read as a bed is no
       * longer isolated impulses. Measured, the top three octaves came in 4
       * to 8 dB under a fit whose arithmetic said they were right, and adding
       * this row took the whole curve from 2.9 dB rms error to 1.1.
       */
      bands: [
        { hz: 1090, q: 0.9, stages: 2, level: 0.4, breath: 0.21 },
        { hz: 6000, q: 0.56, stages: 1, level: 0.037, breath: 0.18 },
      ],
      /**
       * A brook is STEADY — the reference's 5 ms envelope swells only 1.49x
       * against a fire's 2.48 — so the depths here are a quarter of the
       * fire's and `breathHz` is set from the measured envelope, whose
       * modulation spectrum peaks around 2 Hz with a long tail. This is a
       * shimmer, not a swell; the swell is the shore's.
       */
      breathRate: 0.05,
      breathHz: 1.8,
      breathRoarDepth: 0.23,
      /**
       * **THE GURGLES, and they are the fire's crackles' mechanism spent on
       * different physics.** A bubble in water is a resonator struck once and
       * left to ring, exactly as a snapping fibre is, so these rows differ
       * from the fire's in nothing but where they ring and how often. The
       * ringdowns are Minnaert's: a bubble's note is about `3.26 / r`, so
       * 560 Hz is a 6 mm bubble and its Q of 14 is an 18 ms ring.
       *
       * **They are a GARNISH here where the fire's are the main event**, and
       * that inversion is the measurement: a fire's events stand 14.7 dB over
       * its bed and water's only 9.3, at a crest of 17.4 dB against 23.5. So
       * these carry a tenth of what the fire's rows do, and what would happen
       * if they carried more is known — the first cut put the events 15.8 dB
       * over the bed at a crest of 25.3, which is a brook that ticks.
       */
      sparks: [
        /** The spatter: the fine, fast stuff breaking on the bed. */
        { hz: 80, rate: 0.5, loop: 0.97, ringHz: 4350, ringQ: 4.8, level: 0.076 },
        /** The chuckle: the audible one, and what says this is water and not rain. */
        { hz: 23, rate: 0.25, loop: 0.89, ringHz: 2600, ringQ: 4.1, level: 0.21 },
        /** The plop: rare, deep, and rung long — one big bubble letting go. */
        { hz: 9, rate: 0.125, loop: 0.71, ringHz: 560, ringQ: 14, level: 0.072 },
      ],
    },

    /**
     * STILL WATER, heard where it meets the land — a lake's edge, a millpond,
     * a harbour, an ocean.
     *
     * **It has no recording behind it and that is stated rather than hidden.**
     * There is one water master in `reference-media/` and it is running water;
     * everything here is DERIVED from it by an argument about bubbles, plus a
     * time structure that is designed rather than measured. What the numbers
     * are worth is exactly what that argument is worth, so here it is.
     *
     * **The spectrum is the brook's moved down 0.85 of an octave.** A bubble's
     * note is `3.26 / r` (Minnaert), a brook entrains air around 3 mm across
     * and a wave folding onto a shore entrains a great deal more, so the whole
     * population shifts down together and the hump lands near 600 Hz. Fitted
     * against that shifted curve the graph lands **1.56 dB rms from 198 Hz
     * up**, and the two departures are named: +3.9 dB at 198 Hz, which is the
     * surf rumble below, and -3.1 at 6.35 kHz.
     *
     * **The time structure is where it actually differs, and it is the SWASH.**
     * A brook is steady; a shore arrives. So `breathHz` drops to 0.28 — a
     * swell every two and a half seconds — the depths go up threefold, and
     * the two of them come within a third of each other, because a wave moves
     * the whole body of water at once where a fire's draught moves the small
     * stuff and the column barely notices. Rendered: crest 20.4 dB against
     * the brook's 18.3, the 5 ms envelope swelling 2.54x against 1.49, and
     * the modulation spectrum peaking at 0.39 Hz against 0.78.
     *
     * **And unlike the brook it has a BOTTOM.** `roarLevel` is 2.4x the
     * stream's, because a wave is a mass of water moving and a brook is only
     * its own surface — which is the one thing in this pair that is a claim
     * about mechanics rather than about bubbles.
     */
    shore: {
      /**
       * Further than the brook's, because there is more of it: a harbour or a
       * lake edge is a line hundreds of metres long, and `AmbienceSystem` is
       * standing one emitter in for the whole of it. Still well inside
       * `maxDistance` (70) so a coast cannot crowd the ranking from inland.
       */
      range: 46,
      /** The plateau — longer than the brook's for the same reason again. */
      refDistance: 4,
      /**
       * Flatter than the brook's for the LINE-SOURCE reason given there, and
       * flatter still because this line is longer. At `refDistance` 4 it puts
       * `range` about 20 dB down.
       */
      rolloff: 0.7,
      /**
       * Renders 0.0205 rms and peaks 0.268 — the same bed loudness as the
       * brook, with more peak, which is the swash arriving. A mix decision
       * like the brook's and set beside it deliberately: nothing in the game
       * should make a player think a lake is louder than a river.
       */
      level: 0.35,
      /** The surf rumble. See the header: this is the half a brook has not got. */
      roarHz: 95,
      roarLevel: 0.03,
      /**
       * The swash and the foam over it. The same two-row shape as the brook's
       * with both rows moved down — 600 Hz for the water folding over, 2250
       * for the sheet of foam running up the shingle — and the foam's `breath`
       * is nearly double the swash's, because between waves the foam is what
       * actually stops.
       */
      bands: [
        { hz: 600, q: 0.62, stages: 2, level: 0.46, breath: 0.63 },
        { hz: 2250, q: 0.7, stages: 1, level: 0.054, breath: 1.0 },
      ],
      /**
       * THE WAVE. `breathHz` is the whole of what makes this a shore rather
       * than a quiet brook, and 0.28 is a swell every two and a half seconds.
       * `breathRate` stays at the fire's 0.05 for the fire's reason — it is
       * the LOOP, not the rate, and twenty seconds of it is long enough that
       * nothing hears the pattern come round.
       */
      breathRate: 0.05,
      breathHz: 0.28,
      breathRoarDepth: 0.57,
      /**
       * Sparse and low, which is the other half of the difference. A brook
       * gurgles continuously; a shore knocks now and then — a stone turning,
       * a bubble under a jetty — and the fizz of the foam is carried by the
       * band above rather than by a row here, because foam is continuous
       * while a wave is on it.
       */
      sparks: [
        /** The fizz that is discrete enough to be an event. */
        { hz: 14, rate: 0.5, loop: 0.97, ringHz: 2200, ringQ: 5, level: 0.125 },
        /** The knock: water folding on itself under the swash. */
        { hz: 5, rate: 0.25, loop: 0.89, ringHz: 1150, ringQ: 4.1, level: 0.4 },
        /** The deep one — the big slow bubble a lake makes and a brook cannot. */
        { hz: 2, rate: 0.125, loop: 0.71, ringHz: 355, ringQ: 14, level: 0.14 },
      ],
    },
  },

  /**
   * Footsteps. The player's are triggered by the camera's bob phase rather
   * than by a timer of their own — a step you hear off the beat of the dip
   * you see is worse than no step at all — so there is no interval here.
   * What is here is how loud each stance is, and how far a bot's boots
   * carry.
   */
  footstep: {
    /** Walking, sprinting, and how much of that a crouch keeps. */
    walkVol: 0.5,
    sprintVol: 1,
    /**
     * Crouching is already slower and lower (the bob drive is damped by
     * `camera.bobCrouchMult`), so this only has to finish the job. It does
     * NOT make you quieter to the enemy: bots hear gunshots, never feet.
     */
    crouchMult: 0.3,
    /**
     * Impact speed (m/s) below which touching down is just walking, and the
     * speed at which a landing is as loud as it gets. A step off a kerb is
     * a footstep; a drop off the mill roof is not.
     */
    landMinSpeed: 3,
    landFullSpeed: 11,
    /**
     * How far a bot's footfalls carry, well inside `maxDistance` (70). Boots
     * are not rifles: at 70 m they would be inaudible in the mix and would
     * only spend voices the gunfire needs — 16 bots stepping twice a second
     * is 32 one-shots a second on its own. Short range keeps the cue
     * meaningful (someone is close, and roughly there) and the cost small.
     */
    botRange: 20,
  },
} as const;
