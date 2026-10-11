/**
 * src/sim/hostWire.ts — The words the page and the simulation Worker share
 * (`BABYLON_EXIT.md` X2.5b): the control block's layout, the operation codes,
 * and the two message types a round's calls are posted in.
 * Owns: those constants and types and nothing else — a module of its own so
 * the Worker (`simWorker.ts`) and the page's transport (`simHost.ts`) import
 * the same numbers without the Worker importing the module that constructs
 * it (a bundler follows `new Worker(new URL(...))` wherever it is written).
 * Invariants: an Int32 slot is written with `Atomics.store` and read with
 * `Atomics.load` on both sides; the Float64 half (`dt`) is written before
 * the `seq` store that publishes it and read after the load that sees it.
 * Never: hold state.
 */
import type { Team } from "../entities/Combatant";
import type { RoundSpec } from "./SimCore";

/** Int32 slots of the control block. */
export const CTL = {
  /** The page's operation counter: bumped and notified to start one. */
  seq: 0,
  /** The Worker's: the last operation it finished (or failed). */
  done: 1,
  /** What operation `seq` is (`OP`). */
  op: 2,
  /** Float64s of commands in command buffer 0 and 1 for the operation that reads it. */
  cmdLen0: 3,
  cmdLen1: 4,
  /** 1 while the profiler wants the step timed. */
  timed: 5,
  /** Set by the Worker when an operation threw — the page throws it on. */
  failed: 6,
} as const;
/** Byte offset of the Float64 half of the control block. */
export const CTL_F64_AT = 64;
/** Float64 slots: the step's `dt`. */
export const CTL_DT = 0;
export const CTL_BYTES = CTL_F64_AT + 8 * 8;

export const OP = {
  /** Apply the submitted commands, then step by `dt`. */
  step: 1,
  /** Apply the submitted commands and publish — a frame that steps nothing. */
  apply: 2,
  /** Apply the submitted commands, then go back to the event loop for a posted round call. */
  message: 3,
} as const;

/** Messages the page posts — the round's calls, a round's cost. */
export type HostMessage =
  | { t: "init"; ctl: SharedArrayBuffer; cmd: SharedArrayBuffer[]; pub: SharedArrayBuffer[]; timeOrigin: number }
  | { t: "startRound"; spec: Omit<RoundSpec, "def"> & { map: string } }
  | { t: "addPlayer"; slot: number; team: Team }
  | { t: "removePlayer"; slot: number }
  | { t: "releaseWorld" };

/** …and what the Worker posts back: that it is up, or why it is not. */
export type WorkerMessage = { t: "ready" } | { t: "error"; message: string };

