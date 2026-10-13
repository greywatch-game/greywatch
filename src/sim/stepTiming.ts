/**
 * src/sim/stepTiming.ts — How long the simulation core's last step took, phase
 * by phase: `SIM_PHASES`, the phases `SimCore.step` times, and `StepTiming`,
 * the row it writes them into (`SimCore.timing`).
 * Owns: the phase list and its order, and the row's shape.
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
 */
export interface StepTiming {
  /** The clock as the step began; meaningful only while `total >= 0`. */
  start: number;
  /**
   * The whole step, or -1 when the last step was not timed (no clock, timing
   * off, or never stepped).
   */
  total: number;
  /** Per `SIM_PHASES` entry: ms after `start` it began, or -1 when that step never reached it. */
  at: Float64Array;
  /** …and how long it ran, ms (0 when it did not run). */
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
