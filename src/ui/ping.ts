/**
 * ui/ping.ts — What a latency LOOKS like, in the two places one is shown.
 * Owns: turning a round trip in milliseconds into the text on screen and the
 * quality band its colour comes from. Owns no markup, no stylesheet and no
 * element — each screen writes its own cell and colours the band with its own
 * rules, because a scoreboard row and a lobby header are not the same object
 * even when they say the same thing.
 * Invariants: -1 (and anything that is not a finite number) means "there is no
 * ping here" and must never render as a fast one — a bot has no connection and
 * a peer that has not answered yet has no measurement, and both would otherwise
 * read as the best connection on the board.
 *
 * It is a module of two functions rather than a method on either screen because
 * the lobby and the scoreboard MUST agree: the same connection is measured in
 * both (once over HTTP before there is a socket, once by the authority during
 * the round), and a player who reads "fine" on one screen and "poor" on the
 * other at the same number learns to trust neither.
 */
import { CONFIG } from "../config";

/** Which band a ping falls in, which is the whole of what a colour says. */
export type PingQuality = "none" | "good" | "fair" | "poor";

export function pingQuality(ms: number): PingQuality {
  if (!Number.isFinite(ms) || ms < 0) return "none";
  if (ms >= CONFIG.net.pingPoor) return "poor";
  if (ms >= CONFIG.net.pingFair) return "fair";
  return "good";
}

/**
 * The cell's text. An em dash for a row with no connection behind it, which is
 * every bot on the board and every offline round.
 */
export function pingText(ms: number): string {
  return pingQuality(ms) === "none" ? "—" : String(Math.round(ms));
}
