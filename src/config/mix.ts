/**
 * config/mix.ts — the mixer: two faders over every sound in the game.
 * Owns: `CONFIG.mix`, the only levels here that are not a claim about what a
 * thing IS, and the CHANNEL/GROUP taxonomy everything downstream is a `Record`
 * over.
 * Invariant: every value is a DEVIATION and 1 is "as built". A sound that is
 * wrong against ITSELF — one layer of a report against another — is wrong in
 * `config/audio.ts` or in `core/Sfx.ts`, and no fader here can say it.
 * Invariant: a CHANNEL is one sound and a GROUP is a family of them, and the
 * two multiply. Neither is the other's shorthand: `CHANNEL_GROUPS` is what
 * says which of a group's faders a channel actually passes through, and a
 * channel may pass through more than one.
 * Gotcha: the dev mixer (F4) PATCHES the value lines in `groups` and
 * `channels` and leaves every other byte alone, the way the editor patches a
 * layout. Hand-edit them freely; what it will not survive is either TABLE
 * being reshaped — one `<key>: <number>,` per line, two spaces of indent
 * (`dev/mixer/source.ts`, which refuses rather than writing a partial file).
 */

/**
 * A FAMILY of sound: the coarse fader, and the one that answers "against the
 * rest of the game".
 *
 * A group is a place a sound is HEARD rather than a thing it is, which is why
 * the player's own report and somebody else's are two groups and a rifle and a
 * pistol are not: "is my gun too loud against the village" is a question no
 * arrangement of per-weapon levels can be turned to face. Which sound it is
 * belongs one tier down.
 */
export type MixGroup =
  /** The weapon in the player's own hands: `Sfx.shoot`, unpanned. */
  | "ownGun"
  /** Every report through a panner — bots, the wire, a hull's cupola, a cannon. */
  | "worldGun"
  /** Reloads, bolt cycles, swaps, the mine's plate, the launcher's load. */
  | "mechanism"
  /** Rounds arriving: sparks, glass, and the crack of one going past. */
  | "impact"
  /** Blasts and the shoulder tube. */
  | "explosion"
  /** Boots, landings and jumps — the player's and everybody else's. */
  | "footstep"
  /** Hulls and rotors, whoever is inside them. */
  | "engine"
  /** The world's sustained beds: what a place sounds like on its own. */
  | "ambience"
  /** Hitmarkers, headshots, kills, pain, pickups — the read, not the world. */
  | "feedback"
  /** The conquest stings: a flag taken, a flag lost. */
  | "objective";

/**
 * ONE SOUND: the fine fader, and the one that answers "against its own
 * neighbours".
 *
 * **This is the tier the group tier could not reach, and the two examples that
 * forced it are the shape of the whole list**: a reload wanting to be louder
 * while the bolt cycle beside it stays where it is, and one weapon in the kit
 * sitting quiet against the other six. Both are questions INSIDE a family, and
 * a family fader moves the answer and the thing it is being compared against
 * by the same amount.
 *
 * A channel is one thing a player would point at. It is deliberately not one
 * per `Sfx` method — the four impact kinds are four channels because a round
 * hitting a man and a round hitting a window are two sounds people have
 * opinions about, while a report's five LAYERS are one channel because nobody
 * has an opinion about the low roll on its own. That line is judgement and
 * always will be; the test is whether you could hear the difference and say
 * what it was.
 */
export type MixChannel =
  // --- the guns. One per `ReportVoice` that anybody can pick out by ear;
  //     stated on the voice itself (`ReportVoice.mix`) so a weapon carries its
  //     own slider wherever it is fired from.
  | "rifle"
  | "carbine"
  | "smg"
  | "dmr"
  | "sniper"
  | "lmg"
  | "pistol"
  /** The cupola gun all three hulls mount — one gun on three mounts. */
  | "mountedGun"
  /** A tank's main gun. No `ReportVoice` behind it; `Sfx.cannon` is the whole of it. */
  | "cannon"
  /**
   * Anything that shoots and has said nothing about which slider it is on —
   * `ReportVoice.mix` is optional for `sample`'s reason, so a weapon added
   * tomorrow is audible, mixable as GUNFIRE, and compiles.
   */
  | "otherGun"

  // --- the mechanism. The reload and the bolt cycle are the two rows this
  //     whole tier was asked for; they are one gesture apart and 0.8 seconds
  //     apart, and nothing above them can tell them apart.
  | "reload"
  | "boltCycle"
  | "swap"
  | "grenadeThrow"
  | "mineSet"
  | "rpgLoad"
  /** Somebody else's reload, out in the village. Three clacks, not four beats. */
  | "botReload"

  // --- rounds arriving. Four surfaces and the one that never lands.
  | "impactFlesh"
  | "impactGround"
  | "impactHard"
  | "impactGlass"
  /** The supersonic crack of a round going PAST — the loudest cue in the game. */
  | "nearMiss"

  // --- ordnance
  /** Every explosion in the game: `blastAt`'s one sound at whatever `power`. */
  | "blast"
  /** The shoulder tube leaving. */
  | "launcher"

  // --- feet
  | "step"
  | "land"
  | "jump"
  /** Somebody else's boot. One layer, not the player's two. */
  | "botStep"

  // --- powerplants, stated on `EngineKind` so a fourth vehicle carries its own
  | "tankEngine"
  | "truckEngine"
  | "heliEngine"

  // --- the world's own noise, stated on `AmbienceKind`
  | "fire"
  | "stream"
  | "shore"

  // --- the read
  | "hitmarker"
  | "headshot"
  | "enemyDie"
  | "playerHurt"
  | "pickup"

  // --- the round
  | "capture"
  | "flagLost";

/**
 * Which group fader each channel passes through — and it is a LIST, because
 * the two tiers are not a strict tree.
 *
 * **A weapon is heard two ways and is one slider.** "The sniper is too quiet"
 * is a fact about the sniper wherever it is fired; "everybody else's guns are
 * too loud" is a fact about the far field. Those are different axes, so a
 * weapon channel names both gun groups and `Sfx` builds it a bus under each —
 * one fader value, two places in the graph. Everything else names exactly one.
 *
 * A `Record` over the channel union, so a new channel does not compile until
 * it has said where it is heard, and `Sfx` builds buses from THIS rather than
 * from a guess: a pair nobody declared is a pair nothing can play through.
 */
export const CHANNEL_GROUPS = {
  rifle: ["ownGun", "worldGun"],
  carbine: ["ownGun", "worldGun"],
  smg: ["ownGun", "worldGun"],
  dmr: ["ownGun", "worldGun"],
  sniper: ["ownGun", "worldGun"],
  lmg: ["ownGun", "worldGun"],
  pistol: ["ownGun", "worldGun"],
  // Never unpanned, either of them, and both for the same reason. `Game
  // .resolveMg` reaches `Sfx.botShot` on purpose — in a chase view the cupola
  // is twelve metres from the listener — and a cannon has no unpanned path
  // even for the crew firing it. See `docs/audio.md`'s mono rule.
  mountedGun: ["worldGun"],
  cannon: ["worldGun"],
  otherGun: ["ownGun", "worldGun"],

  reload: ["mechanism"],
  boltCycle: ["mechanism"],
  swap: ["mechanism"],
  grenadeThrow: ["mechanism"],
  mineSet: ["mechanism"],
  rpgLoad: ["mechanism"],
  botReload: ["mechanism"],

  impactFlesh: ["impact"],
  impactGround: ["impact"],
  impactHard: ["impact"],
  impactGlass: ["impact"],
  nearMiss: ["impact"],

  blast: ["explosion"],
  launcher: ["explosion"],

  step: ["footstep"],
  land: ["footstep"],
  jump: ["footstep"],
  botStep: ["footstep"],

  tankEngine: ["engine"],
  truckEngine: ["engine"],
  heliEngine: ["engine"],

  fire: ["ambience"],
  stream: ["ambience"],
  shore: ["ambience"],

  hitmarker: ["feedback"],
  headshot: ["feedback"],
  enemyDie: ["feedback"],
  playerHurt: ["feedback"],
  pickup: ["feedback"],

  capture: ["objective"],
  flagLost: ["objective"],
} as const satisfies Record<MixChannel, readonly MixGroup[]>;

/**
 * The coarse faders, against 1.
 *
 * **Read a number here as a mix decision that could not be made anywhere
 * else.** A gunshot's five layers are argued against each other in `Sfx.shoot`
 * and a fire's bands against each other in `CONFIG.audio.ambience.fire`; what
 * neither file can see is the OTHER family, because neither is ever in the
 * room with it.
 */
export const groups = {
  ownGun: 1,
  worldGun: 1,
  mechanism: 1,
  impact: 1,
  explosion: 1,
  footstep: 1,
  engine: 1,
  ambience: 1,
  feedback: 1,
  objective: 1,
} as const satisfies Record<MixGroup, number>;

/**
 * The fine faders, against 1.
 *
 * **A number here is a sound against its NEIGHBOURS**, which is the comparison
 * that only exists once both are in the same round: the reload against the
 * bolt cycle, the sniper against the carbine, a round on glass against a round
 * on stone. It multiplies the group's, so a channel at 1 under a group at 0.8
 * is heard at 0.8 and neither number has to know about the other.
 *
 * **A gun's channel is NOT `ReportVoice.level` restated.** That scalar is one
 * of the eight DEVIATIONS from the reference report and is a claim about the
 * weapon — bore, charge, what the thing is — carried on the row beside `pitch`
 * and `weight` and read by the synthesis and the sample alike. This is the
 * mix: what that gun turned out to be worth against the other six once you
 * had all of them in a firefight. They are set from different evidence and the
 * one here is the one to move by ear.
 */
export const channels = {
  rifle: 1,
  carbine: 1,
  smg: 1,
  dmr: 1,
  sniper: 1,
  lmg: 1,
  pistol: 1,
  mountedGun: 1,
  cannon: 1,
  otherGun: 1,
  reload: 1,
  boltCycle: 1,
  swap: 1,
  grenadeThrow: 1,
  mineSet: 1,
  rpgLoad: 1,
  botReload: 1,
  impactFlesh: 1,
  impactGround: 1,
  impactHard: 1,
  impactGlass: 1,
  nearMiss: 1,
  blast: 1,
  launcher: 1,
  step: 1,
  land: 1,
  jump: 1,
  botStep: 1,
  tankEngine: 1,
  truckEngine: 1,
  heliEngine: 1,
  fire: 1,
  stream: 1,
  shore: 1,
  hitmarker: 1,
  headshot: 1,
  enemyDie: 1,
  playerHurt: 1,
  pickup: 1,
  capture: 1,
  flagLost: 1,
} as const satisfies Record<MixChannel, number>;

export const mix = { groups, channels } as const;

/**
 * Both taxonomies as lists to walk.
 *
 * Derived from the tables rather than written out beside them, so the buses in
 * `Sfx`, the rows on the mixer panel and the file the mixer writes back can
 * none of them be one entry short of the others. `Object.keys` is exact here
 * because both are literals with no optional members.
 */
export const MIX_GROUPS = Object.keys(groups) as readonly MixGroup[];
export const MIX_CHANNELS = Object.keys(channels) as readonly MixChannel[];
