/**
 * RoundRandom.ts — The ROUND's seed, and every random stream that decides an
 * outcome in the simulation, reseeded from it when a round starts.
 * Owns: the round seed (`seed`), the registry of outcome streams keyed by what
 * each is FOR (`STREAM`) and whose it is, deriving each stream's seed from the
 * round's, drawing a fresh round seed, and reading one off text a person
 * typed (`parseSeed`). Owns no system and decides no outcome: a system asks it
 * for a stream once, when it builds the thing that draws, and keeps it.
 *
 * **Why outcomes are seeded at all** (`BABYLON_EXIT.md` X0.2, `PERF_PLAN.md`
 * C1): `Math.random` decided where every round went inside its cone, which
 * spawn a body took and where in it, and how far off a tank crew laid its gun.
 * A round could therefore never be played twice, so a bug in one could never
 * be watched again and a benchmark's fight was a different fight every run.
 * Now a round is a function of its map, its difficulty and ONE number — and
 * that number is per ROUND rather than per build, because a game whose every
 * round fought out identically would be a worse game. Normal play draws a
 * fresh one (`freshSeed`); a benchmark, a replay or a bug report passes one
 * (`?seed=`, `npm run simulate`'s fourth argument).
 *
 * **One stream per SHOOTER, not one for the round**, so that what one shooter
 * does cannot move another's draws. A shared stream is reproducible only while
 * every draw arrives in the same order, and on the authority a person's
 * trigger arrives whenever the network delivers it; with a stream each, a
 * person firing an extra round changes their own next cone and nobody else's.
 * Keyed by the authority's SLOT for a bot and the hardstanding index for a
 * hull, so a stream is the same stream on every pool size and both sides of
 * the wire.
 *
 * **The round seed is the WHOLE of a round's randomness**, which needed one
 * thing outside this file: the bots' movement streams, deliberately on
 * constant seeds (`BattleSystem.buildPool`, and whether they should take this
 * seed instead is left open in `BABYLON_EXIT.md`'s "Decisions that are
 * yours"), used to run on from one round into the next, so a seed reproduced
 * a round only if it was the first of its session. `BattleSystem.reset`
 * restarts them on those same constants now, as `RagdollSystem.reset` already
 * restarted its own.
 *
 * Invariants:
 *  - **Reseeding is in place.** A holder keeps the function it was handed for
 *    the life of the thing that draws; `seedRound` rewinds what is behind it,
 *    so nothing has to be told a round started but this registry.
 *  - **A key is an identity, so `STREAM`'s values are append-only**: a value
 *    reused or renumbered silently re-rolls every round anybody wrote down.
 *  - Asking twice for one key hands back the SAME stream, so a pool rebuilt
 *    mid-session (`BattleSystem.setRoster`) picks up where its slots were.
 *  - One `RoundRandom` per simulation — `Game` offline, `HeadlessGame` on the
 *    authority — and each calls `seedRound` once per round, AFTER everything
 *    that draws has been built and BEFORE the first body spawns.
 * Never: be drawn from by anything that only makes a PICTURE or a SOUND (the
 * casings, the blast's billows, a voice's pitch) — those stay on
 * `Math.random`, and a picture drawing from an outcome stream would make the
 * fight depend on the camera. Never seeded from the wall clock or a frame
 * count.
 */
import { mulberry32 } from "../world/rng";

/** A draw in [0, 1), the shape `Math.random` and `mulberry32` both have. */
export type Rand = () => number;

/**
 * What each outcome stream is FOR. The value is part of every seed derived
 * from it — see the header on why it is append-only.
 */
export const STREAM = {
  /** `ConquestSystem`: which spawn a body takes, and where in it. */
  spawn: 1,
  /** A bot's spread cone, by the authority's slot. */
  botShot: 2,
  /**
   * The offline player's shooting: the spread cone, the recoil's drift and
   * the flinch on taking a hit — everything random about where their rounds go.
   */
  player: 3,
  /** A hull's cupola gun's cone, by hardstanding index. */
  hullShot: 4,
  /** `VehicleCrew`: a crew's ranging error. */
  crewLay: 5,
} as const;

/** What `STREAM` names. */
export type StreamKind = (typeof STREAM)[keyof typeof STREAM];

/**
 * A rand handed to a shot that DECLARES no spread — the tank's main gun, and
 * the authority re-resolving a person's round on the direction they already
 * rolled. `CombatSystem.fire` draws nothing at a spread of zero, so this is
 * never called; if it ever is, a zero-spread caller started spending
 * randomness it was never given a stream for, and that is a bug to hear about.
 */
export const UNDRAWN: Rand = () => {
  throw new Error("RoundRandom: a shot declared no spread and then drew one");
};

/** One registered stream: whose it is, and where it has got to. */
interface Entry {
  readonly kind: StreamKind;
  readonly index: number;
  draw: Rand;
}

export class RoundRandom {
  private round = 0;
  /** Keyed `kind * 65536 + index`: a slot or a hardstanding is far below that. */
  private readonly entries = new Map<number, Entry>();

  /** The seed the round now running was started from. */
  get seed(): number {
    return this.round;
  }

  /**
   * The stream for one shooter or one decision, derived from the round's seed.
   * `index` names whose it is where there is more than one (a slot, a
   * hardstanding); omit it for a stream the whole simulation shares.
   */
  stream(kind: StreamKind, index = 0): Rand {
    const key = kind * 65536 + index;
    let e = this.entries.get(key);
    if (!e) {
      e = { kind, index, draw: mulberry32(deriveSeed(this.round, kind, index)) };
      this.entries.set(key, e);
    }
    const held = e;
    // A closure over the ENTRY rather than over its generator, which is what
    // lets `seedRound` swap the generator under every holder at once.
    return () => held.draw();
  }

  /** Starts a round: every stream, held anywhere, rewinds to its start for `seed`. */
  seedRound(seed: number): void {
    this.round = seed >>> 0;
    for (const e of this.entries.values()) {
      e.draw = mulberry32(deriveSeed(this.round, e.kind, e.index));
    }
  }
}

/**
 * One stream's seed out of the round's. A hash rather than a sum, so that
 * neighbouring slots and neighbouring round seeds land on unrelated streams —
 * `mulberry32` seeded with `n` and `n + 1` starts out correlated. The mix is
 * MurmurHash3's finaliser.
 */
export function deriveSeed(round: number, kind: number, index: number): number {
  let h = (round ^ Math.imul(kind, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * A round seed for a round nobody asked to repeat. The ONE outcome-deciding
 * `Math.random` left in the simulation, and it is the one that is supposed to
 * be there: it is what makes two rounds different.
 */
export function freshSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/**
 * A seed as a person wrote it — on a URL, on a command line — or null when it
 * is not one. Decimal, as every surface that SHOWS a seed prints it, and
 * within 32 bits, so the seed read back is the seed that was typed.
 */
export function parseSeed(text: string | null | undefined): number | null {
  if (text == null || !/^\d{1,10}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n <= 0xffffffff ? n : null;
}
