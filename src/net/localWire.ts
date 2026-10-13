/**
 * net/localWire.ts — The words a local match's two halves share: the owner
 * channel's calls and replies, and
 * the one control word a person's port carries besides protocol text.
 * Owns: those types and that constant, and nothing else — `protocol.ts`'s
 * twin for the local match, imported by the page's halves (`LocalMatch.ts`,
 * `transport.ts`) and the host's (`server/localMatch.ts`) alike, so neither
 * side imports the other's code to learn a word.
 * Invariants: pure types and plain constants — no DOM beyond the port types,
 * no class, nothing with a side effect — because a browser Worker, the page
 * and Node all load it.
 * Never: hold a `ClientMessage`. The owner channel is not the protocol: no
 * remote client can say any of this, and `server/wire.ts` never reads it.
 */
import type { StepTiming } from "../sim/stepTiming";

/**
 * Whatever the owner channel runs over: the page's `Worker`, the Worker's own
 * scope, or one end of a `MessageChannel` — the three already share this
 * shape, so nothing is wrapped.
 */
export interface OwnerPort {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}

/** The owner's calls, each answered once (`OwnerReply`), in the order they were posted. */
export type OwnerCall =
  /**
   * Build a match on `map`: owned, so its clock, its rounds and its end are
   * this channel's. `timeOrigin` is the page's `performance.timeOrigin`, so
   * a step's timing reads on the page's clock wherever the host runs.
   * Refused while a match is open: `close` it first.
   */
  | { t: "open"; map: string; timeOrigin: number }
  /** Begin a round — the first or the next — on this seed and difficulty (`Match.begin`). */
  | { t: "begin"; seed: number; difficulty: number }
  /**
   * `dt` seconds onto the match's clock (`Match.advance`), answered with
   * what that stepped. `timed`: time the steps for the profiler's `sim` root.
   */
  | { t: "advance"; dt: number; timed: boolean }
  /**
   * `dt` seconds the owner HELD the world: the match's clock passes and
   * nothing steps — why it is handed over at all is argued at `Match.hold`.
   * Answered `done`, which nobody awaits.
   */
  | { t: "hold"; dt: number }
  /** Nothing, answered once every call before it has run — the settle. */
  | { t: "settle" }
  /** The benchmark's fight starts here: awards and deaths folded from this tick. */
  | { t: "markFight" }
  /** The fight's hash so far, after every call before it. */
  | { t: "fight" }
  /** End the match (`Match.close`): every peer told and let go, the world disposed. */
  | { t: "close" };

/** What crosses the channel to the host: a call, or a person's port. */
export type OwnerMessage =
  | (OwnerCall & { call: number })
  /**
   * A port for one more peer, transferred, its far end the page's
   * (`LocalMatch.dial`). Unanswered. `watch`: the peer WATCHES rather than
   * sits (`Match.watch`) — welcomed at no slot, and nobody in the round. The
   * owner's word alone: it is here and not on the `join`, so no
   * `ClientMessage` can ask for it.
   */
  | { t: "connect"; port: MessagePort; watch: boolean };

/** What `advance` stepped. */
export interface Advanced {
  /** Whole steps this advance took — 0 when it held less than one, or the round is held. */
  steps: number;
  /** The round has a winner: it ended on a step, and nothing steps until the next `begin`. */
  ended: boolean;
  /**
   * Every step this advance took, its phases SUMMED (`addStepTiming`, which
   * says what `start` and `at` mean for a sum), on the page's clock — when
   * they were timed and something stepped; null otherwise.
   */
  timing: StepTiming | null;
}

/** …and what comes back, one per call. */
export type OwnerReply =
  | { t: "done"; call: number }
  | ({ t: "advanced"; call: number } & Advanced)
  | { t: "fight"; call: number; hex: string; events: number }
  | { t: "failed"; call: number; message: string };

/**
 * A person's port's one word that is not protocol text: the connection is
 * over. A WebSocket's closing handshake says it; a closed port tells the far
 * end nothing, so whichever end closes says so first.
 */
export const PORT_CLOSE = 0;
