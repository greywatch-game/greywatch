/**
 * BotSkill.ts — The `skill` scalar to concrete-numbers mapping, and nothing
 * else. Owns: BotProfile and the lerp that produces one.
 * Invariants: a profile is built ONCE per bot (pool construction, and again on
 * reset) and then read — never rebuild one per frame or per think. Every number
 * comes from a `{ rookie, ace }` pair in CONFIG.bots.skill; nothing is hardcoded
 * here. Pure functions and one plain object: no Babylon, no state, no rays.
 */
import { CONFIG } from "../config";
import { clamp01 } from "../core/math";
import { mulberry32 } from "../world/rng";

/**
 * One bot's concrete numbers, resolved from its skill.
 *
 * Why a resolved object rather than reading CONFIG at each use site: `CONFIG`
 * is `as const`, so every field has a *literal* type and lerping against it
 * needs an annotation at every call. Resolving once into a plain mutable object
 * keeps the hot paths readable and makes "skill affects this" a single grep.
 */
export interface BotProfile {
  /** Seconds between acquiring a target and the first shot. */
  reactionTime: number;
  /** Seconds of wind-up still owed when re-acquiring a remembered enemy. */
  reacquireDelay: number;
  /** Multiplies the distance-lerped spread cone. */
  spreadMult: number;
  /** How fast the aim point chases the target, per second. */
  trackRate: number;
  /** Yaw slew, per second. */
  turnRate: number;
  burstSize: number;
  burstPause: number;
  reloadTime: number;
  /** Cosine of the vision cone's half-angle — compared against a dot product. */
  fovCos: number;
  /** The same cone widened by `alertFovBonus`, used while a threat cue is live. */
  alertFovCos: number;
  /** Inside this, an enemy is noticed regardless of facing. */
  peripheralRange: number;
  /** Health fraction below which a bot under fire breaks contact. */
  retreatHealthFrac: number;
  /** 0..1 willingness to break for cover rather than stand and trade. */
  coverUse: number;
  /** Seconds spent leaned out shooting before pulling back behind cover. */
  peekOutTime: number;
}

interface Band {
  rookie: number;
  ace: number;
}

function lerp(band: Band, skill: number): number {
  return band.rookie + (band.ace - band.rookie) * skill;
}

/** Difficulty tier names, in order, for the menu. */
export function difficultyNames(): readonly string[] {
  return CONFIG.bots.skill.difficulties.map((d) => d.name);
}

/**
 * The tiers as the menu's panel reads them: a name, the line that says what
 * the tier is like, and the skill centre it is — which the panel draws as a
 * meter, so the rungs are spaced by the numbers the bots are actually given
 * rather than by their position in the list.
 */
export function difficultyTiers(): readonly {
  name: string;
  blurb: string;
  centre: number;
}[] {
  return CONFIG.bots.skill.difficulties;
}

/**
 * Draws a skill for every bot from the tier's distribution and resolves each
 * one's profile.
 *
 * Per squad, not per bot: a squad centre from the tier's band, plus a small
 * jitter inside it. An elite squad and a green squad is a thing the player can
 * notice and play around; sixteen independent draws just average out.
 *
 * Re-runnable — called on every round start, so changing difficulty in the menu
 * takes effect without rebuilding the pool.
 */
export function assignSkills(
  bots: { team: number; squad: number; skill: number; profile: BotProfile }[],
  difficulty: number,
): void {
  const k = CONFIG.bots.skill;
  const tier = k.difficulties[clamp01Index(difficulty, k.difficulties.length)];
  const rand = mulberry32(k.seed + difficulty * 977);

  // One centre per (team, squad) pair, drawn up front so bot order cannot
  // change the result.
  const centres = new Map<string, number>();
  for (const bot of bots) {
    const key = `${bot.team}:${bot.squad}`;
    if (!centres.has(key)) {
      centres.set(key, tier.centre + (rand() * 2 - 1) * k.squadSpread);
    }
  }

  for (const bot of bots) {
    const centre = centres.get(`${bot.team}:${bot.squad}`) ?? tier.centre;
    bot.skill = clamp01(centre + (rand() * 2 - 1) * k.botSpread);
    bot.profile = profileFor(bot.skill);
  }
}

function clamp01Index(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : Math.floor(i);
}

/** Resolves a skill in 0..1 into the numbers a bot actually runs on. */
export function profileFor(skill: number): BotProfile {
  const s = clamp01(skill);
  const k = CONFIG.bots.skill;
  const reactionTime = lerp(k.reactionTime, s);
  const fov = lerp(k.fov, s);
  return {
    reactionTime,
    reacquireDelay: reactionTime * lerp(k.reacquireCredit, s),
    spreadMult: lerp(k.spreadMult, s),
    trackRate: lerp(k.trackRate, s),
    turnRate: lerp(k.turnRate, s),
    // Burst size is a count of rounds, so it has to land on a whole number.
    burstSize: Math.max(1, Math.round(lerp(k.burstSize, s))),
    burstPause: lerp(k.burstPause, s),
    reloadTime: lerp(k.reloadTime, s),
    fovCos: Math.cos(fov),
    alertFovCos: Math.cos(Math.min(Math.PI, fov + CONFIG.bots.combat.alertFovBonus)),
    peripheralRange: lerp(k.peripheralRange, s),
    retreatHealthFrac: lerp(k.retreatHealthFrac, s),
    coverUse: lerp(k.coverUse, s),
    peekOutTime: lerp(k.peekOutTime, s),
  };
}
