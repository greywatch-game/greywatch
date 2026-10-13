/**
 * net/LocalOwner.ts — The page's OWNERSHIP of its own match: which host it is
 * on, whether the round on it has begun, the frame's clock handed over as
 * stepped or held, the step timing waiting to be filed, and a lost host
 * replaced.
 * Owns: the `MatchHost` (read off here every time, never held elsewhere,
 * because a lost one is REPLACED), the begun line, the three per-frame
 * counters behind `step`/`pass`, the summed timing row and its skip count,
 * and the host's state with its replacement count. Owns no session, no
 * screen and no profiler — it answers through the four `LocalOwnerHooks`
 * `Game` hands it, which are where a failure is SAID and a timing FILED.
 * Invariants:
 * - **`step` is the one door the match's clock is advanced through**, and a
 *   frame that did not call it HELD the world: `pass` hands the match the
 *   rest of the frame as held time and drops the timing still to file, so a
 *   pause's steps are never charged to the frame after it.
 * - **Only what fits under `CONFIG.net.localSlack` is stepped**, unless the
 *   caller says the frame is fixed (the benchmark, which posts one `advance`
 *   per step and holds nothing back).
 * - **The begun line is what makes an answer THIS round's.** The owner's port
 *   answers in posting order, so everything answered before the round's
 *   `begin` is the last match's and is ignored; a skip count off
 *   `LocalMatch.owed` drops answers posted before a hold or a benchmark
 *   segment (`dropTiming`).
 * - **The recording path allocates nothing**: one timing row for the life of
 *   the page, summed in place and emptied by the filing.
 * Never: import `core/` (a `net/` module that did would be the first edge of
 * its kind — `RegionBook`'s header), read a session, or decide what a failed
 * round does to the screen.
 */
import { CONFIG } from "../config";
import { addStepTiming, clearStepTiming, newStepTiming, type StepTiming } from "../sim/stepTiming";
import type { LocalMatch } from "./LocalMatch";
import type { MatchHost } from "./matchHost";

/** Whether the host can take a round — see `LocalOwner.state`. */
export type LocalHostState = "up" | "restarting" | "gone";

/** What the owner tells `Game`: all four are wired once, at construction. */
export interface LocalOwnerHooks {
  /**
   * The summed timing of every step reported since the last filing, filed
   * as this frame's `sim` root. Called from `step`, before it advances; the
   * row is emptied after it returns, so it may not be held.
   */
  fileTiming(timing: StepTiming): void;
  /** A posted call failed on the round that has BEGUN on this host. */
  roundFailed(reason: string): void;
  /**
   * The host is gone. `state` already says whether it is being replaced, so
   * the round on it can say so as it ends; the replacement starts after.
   */
  hostLost(reason: string): void;
  /** A lost host's replacement is up, and every call goes to it now. */
  replaced(host: MatchHost): void;
}

export class LocalOwner {
  private host: MatchHost;
  /**
   * The match has answered this round's `begin` — so every `advanced` answer
   * from here on is about THIS round. Anything before it is the last
   * match's (`wire`).
   */
  private begun = false;
  /**
   * Every timed step the match has reported and this page has not filed yet
   * (`Advanced.timing`), SUMMED into one row on this page's clock — empty
   * while `total` < 0. An answer arrives BETWEEN frames, where the profiler
   * files nothing, so it waits here for the next frame that steps; a frame
   * whose posts were answered twice before it (a benchmark's lead-in posts
   * one `advance` per step) files them all.
   */
  private readonly timing = newStepTiming();
  /**
   * How many `advance` answers still to come were posted BEFORE the world
   * was last held (`pass`) or a benchmark segment last began: their timing
   * is dropped as it arrives, since filing it on the first frame after a
   * pause would charge that frame with steps taken seconds earlier, and on a
   * segment's first frame would charge the segment with the last one's.
   */
  private timingSkip = 0;
  /** `step` ran this frame — read and reset by `pass`. */
  private ran = false;
  /** Seconds of this frame handed over as STEPPED, so `pass` holds the rest. */
  private stepped = 0;
  /**
   * `up`; `restarting` — lost, and its replacement still coming up, so a
   * round asked for now fails at once on the lost one; or `gone` — lost past
   * `CONFIG.net.localRehosts`, or its replacement failed to open, for the
   * life of the page.
   */
  private hostState: LocalHostState = "up";
  /** How many times this page has replaced its host. */
  private rehosts = 0;

  constructor(
    host: MatchHost,
    private readonly hooks: LocalOwnerHooks,
  ) {
    this.host = host;
    this.wire();
  }

  /**
   * The owner's channel to the match. Read off the host every time — a round
   * captures the one it opened on, and nothing else may keep one.
   */
  get match(): LocalMatch {
    return this.host.match;
  }

  /** Where the host runs: a Worker, or this thread. */
  get mode(): MatchHost["mode"] {
    return this.host.mode;
  }

  /** Whether the host can take a round. */
  get state(): LocalHostState {
    return this.hostState;
  }

  /** A round is opening on the host: nothing answered from here until `began` is its. */
  reset(): void {
    this.begun = false;
    clearStepTiming(this.timing);
  }

  /** The round's `begin` has been answered. */
  began(): void {
    this.begun = true;
  }

  /**
   * The round is left: the match closed, posted behind everything the round
   * said, so the owner's port runs it after the last `advance`. A host
   * already lost refuses it, and that was said when it was lost.
   */
  close(): void {
    this.begun = false;
    this.match.close().catch(() => {});
  }

  /**
   * One frame's step of the match — the one door its clock is advanced
   * through. Files the timing that has arrived (`hooks.fileTiming`), then
   * posts as much of `dt` as keeps the match's unanswered time under
   * `CONFIG.net.localSlack`, or all of it when the frame is `fixed`; the
   * rest is held by `pass`. Posted and never awaited.
   */
  step(dt: number, fixed: boolean, timed: boolean): void {
    this.ran = true;
    if (this.timing.total >= 0) {
      this.hooks.fileTiming(this.timing);
      clearStepTiming(this.timing);
    }
    const step = fixed ? dt : Math.min(dt, CONFIG.net.localSlack - this.match.behind);
    if (step > 0) {
      this.match.advance(step, timed);
      this.stepped += step;
    }
  }

  /**
   * Hands the match the rest of this frame's clock: whatever of the `seen`
   * seconds since the last frame `step` did not post, as time the match HELD
   * (`LocalMatch.hold`) — its clock passes and nothing steps. A pause, the
   * deploy screen, the part of a long frame `tick`'s `dt` clamp cut off and a
   * benchmark's vantages are all that. Why the clock must pass at all is
   * `Match.hold`'s to argue.
   *
   * `round` is whether the standing round is this host's; `seated` whether
   * its session has been welcomed — before that there is no round on the host
   * to hold, and the clock is anchored at the end of its build anyway.
   *
   * **A frame that did not `step` HELD the world**, and the timing still to
   * file — or still to be answered for an `advance` posted before it — is
   * dropped.
   */
  pass(seen: number, round: boolean, seated: boolean): void {
    const stepped = this.stepped;
    const ran = this.ran;
    this.stepped = 0;
    this.ran = false;
    if (!round) return;
    if (!ran) this.dropTiming();
    if (!seated) return;
    const held = seen - stepped;
    if (held > 0) this.match.hold(held);
  }

  /**
   * Drops the step timing not yet filed — what has arrived and every answer
   * still owed for an `advance` already posted — because the frame that
   * would file it is not the frame those steps belong to: the first after a
   * HELD world (`pass`), or the first of a new benchmark segment.
   */
  dropTiming(): void {
    clearStepTiming(this.timing);
    this.timingSkip = this.match.owed;
  }

  /**
   * What the host's own channel says that is not an answer to a call: a
   * step's report, a call nobody awaited that failed, and the host gone.
   * Wired once per HOST — a host outlives every round on it.
   */
  private wire(): void {
    // A new host owes nothing posted to the one it replaced.
    this.timingSkip = 0;
    this.match.onAdvanced = (advanced) => {
      // Posted before the world was last held — counted off first, whichever
      // match it was posted to, since `LocalMatch.owed` counted it.
      if (this.timingSkip > 0) {
        this.timingSkip--;
        return;
      }
      if (!this.begun) return;
      if (advanced.timing) addStepTiming(this.timing, advanced.timing);
    };
    // Gated as `onAdvanced` is, because the last match's last `advance` can
    // be answered after this round opened, and a failure there is about a
    // match already closed.
    this.match.onFailed = (message) => {
      console.error(`[local match] ${message}`);
      if (this.begun) this.hooks.roundFailed(message);
    };
    // Final for THIS host: `LocalMatch` refuses every call after it. The
    // round on it ends, since its whole fight lived over there, and then the
    // host is replaced — unless this page has replaced it as often as it may.
    this.match.onLost = (reason) => {
      console.error(`[local match] lost: ${reason}`);
      this.hostState = this.rehosts < CONFIG.net.localRehosts ? "restarting" : "gone";
      this.hooks.hostLost(reason);
      if (this.hostState === "restarting") this.rehost();
    };
  }

  /**
   * Replaces a LOST host (`MatchHost.replace`): the old one torn down, a new
   * one opened the boot's way and wired in its place. The round that was on
   * the old one is already over — there is nothing to carry across, since
   * the fight lived in the host that died.
   */
  private rehost(): void {
    this.rehosts++;
    this.host.replace().then(
      (host) => {
        this.host = host;
        this.hooks.replaced(host);
        this.wire();
        this.hostState = "up";
        console.info(
          `[local match] replaced; the simulation runs in ${host.mode === "worker" ? "a Worker" : "the page"}: ${host.why}`,
        );
      },
      (err: unknown) => {
        console.error("[local match] could not be replaced:", err);
        this.hostState = "gone";
      },
    );
  }
}
