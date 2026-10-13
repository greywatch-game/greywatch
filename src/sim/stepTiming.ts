/**
 * src/sim/stepTiming.ts — How long the simulation core's last step took, phase
 * by phase: `SIM_PHASES`, the phases `SimCore.step` times, and `StepTiming`,
 * the row it writes them into (`SimCore.timing`).
 * Owns: the phase list and its order, the row's shape, and how rows SUM
 * (`addStepTiming`) when one reading covers several steps.
 * Invariants:
 * - **MEASUREMENT, never state.** A core given a clock
 *   (`SimCoreOptions.timing`) and told to use it (`SimCore.timeSteps`) stamps
 *   the row as `step` runs; nothing in the simulation reads it back and no
 *   outcome depends on it, so a timed step and an untimed one are the same
 *   step.
 * - **`SIM_PHASES` is the order the step runs them in**, and the index into
 *   `at` and `ms`; a host that files the row (the profiler's `sim` phase,
 *   `simulate --phases`) maps each name to its own slot.
 * Never: import Babylon, or anything that decides. A file of types and one
 * allocator, so every host — `Match` (remote, or the page's own local match),
 * `simulate` and the page that files the reading — reads it alike.
 */

/**
 * The phases of `SimCore.step` the profiler files under its `sim` phase
 * (`BABYLON_EXIT.md` X2.5a C6), in the order the step runs them — the index
 * into `StepTiming.at` and `StepTiming.ms`. `conquest` is the combatant list
 * and the flags; `vehicles` the crews, the hulls, a person's reported crashes,
 * the tracks and the riders; `bots` `BattleSystem.update`; `grenades` and
 * `antiTank` their pools. What the step does outside them — the persons'
 * regen, leash and deploy and the rewind's record — is the `sim` span's
 * unattributed remainder.
 */
export const SIM_PHASES = ["conquest", "vehicles", "bots", "grenades", "antiTank"] as const;
export type SimPhase = (typeof SIM_PHASES)[number];

/**
 * The last timed step, as the core's clock read it. Milliseconds, in the
 * units of the clock the HOST handed the core (`SimCoreOptions.timing`).
 *
 * **A row may also be a SUM of several steps** (`addStepTiming`) — the local
 * match's answer to one `advance` that stepped more than once, and the page's
 * held row of every answer one frame files. A summed row reads as one span
 * made of pieces, the way the profiler files a slot entered twice in a frame
 * (`FrameProfile.fileTiming`): `start` is the FIRST step's, `total` and each
 * `ms` the sum over every step, and `at` the offset from `start` at which the
 * phase FIRST began — so `at + ms` is not where a summed phase ended, only
 * where its first piece began and how long its pieces took together.
 */
export interface StepTiming {
  /** The clock as the (first) step began; meaningful only while `total >= 0`. */
  start: number;
  /**
   * The whole step (or the sum of the steps), or -1 when the row holds no
   * timed step (no clock, timing off, never stepped, or cleared).
   */
  total: number;
  /** Per `SIM_PHASES` entry: ms after `start` it (first) began, or -1 when no step reached it. */
  at: Float64Array;
  /** …and how long it ran, ms, summed over the steps (0 when it did not run). */
  ms: Float64Array;
}

/** A timing row no step has written. */
export function newStepTiming(): StepTiming {
  return {
    start: 0,
    total: -1,
    at: new Float64Array(SIM_PHASES.length).fill(-1),
    ms: new Float64Array(SIM_PHASES.length),
  };
}

/** Empties a row in place — `newStepTiming`'s state, nothing allocated. */
export function clearStepTiming(t: StepTiming): void {
  t.start = 0;
  t.total = -1;
  t.at.fill(-1);
  t.ms.fill(0);
}

/**
 * Adds `from` — one step's row, or a sum of steps on the same clock — into
 * `into`, in place: `total` and each `ms` summed, `start` and each `at` kept
 * from whichever piece came first (see `StepTiming`). An untimed `from`
 * (`total` < 0) adds nothing; an empty `into` becomes a copy of it. Allocates
 * nothing, so a host may run it every step and the page every answer.
 */
export function addStepTiming(into: StepTiming, from: StepTiming): void {
  if (from.total < 0) return;
  if (into.total < 0) {
    into.start = from.start;
    into.total = from.total;
    into.at.set(from.at);
    into.ms.set(from.ms);
    return;
  }
  into.total += from.total;
  const shift = from.start - into.start;
  for (let i = 0; i < into.at.length; i++) {
    if (from.at[i] < 0) continue;
    if (into.at[i] < 0) into.at[i] = from.at[i] + shift;
    into.ms[i] += from.ms[i];
  }
}
