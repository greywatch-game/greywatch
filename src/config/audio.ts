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
  /** Distance at which a world sound plays at full volume. */
  refDistance: 8,
  /** Distance at which it falls silent. Matched roughly to the fog. */
  maxDistance: 70,
  /**
   * Metres per second. A shot across the map arrives ~0.2 s after its muzzle
   * flash, which is the cue that tells the ear how far away a firefight is
   * far more strongly than volume does.
   */
  speedOfSound: 343,
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
