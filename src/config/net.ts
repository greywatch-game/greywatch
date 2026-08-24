/**
 * config/net.ts — Multiplayer tunables that are the CLIENT's to choose.
 * Owns: how far behind the server a client renders, how it reconnects, and how
 * far its own body may be out before a correction is obeyed rather than eased.
 * Gotcha: the rates both sides must AGREE on — tick, snapshot and input
 * frequency, and the rewind window — are NOT here. They live in
 * `src/net/protocol.ts`, because a value the server also reads cannot sit in a
 * table the client is free to retune; two ends disagreeing about the snapshot
 * interval is a limp that looks like packet loss.
 */

export const net = {
  /** Where to reach the match server. Same-origin `/ws` in a deployed build. */
  url: "/ws",

  /**
   * How far behind the newest snapshot other bodies are drawn, in seconds.
   *
   * Interpolation needs a sample either side of the render time, so this must
   * exceed one snapshot interval or a perfect connection still extrapolates.
   * `PROTOCOL.INTERP_DELAY_MS` is the shared default; this is the client's own
   * knob for spending more latency to ride out worse jitter.
   */
  interpDelay: 0.1,

  /**
   * Seconds of clock samples to keep when estimating the offset to server time.
   * The estimate is a minimum-latency filter over these, not an average — the
   * fastest round trip in a window is the one least polluted by queueing.
   */
  clockWindow: 5,

  /** Backoff between reconnection attempts, in seconds, and how many to make. */
  reconnectDelay: 1,
  reconnectMax: 8,

  /**
   * How long a hitmarker this client PREDICTED stands in for the authority's
   * `hit`, in seconds.
   *
   * A landed round is cued twice by construction — once locally the instant it
   * was fired, once when the server has re-resolved it — and the second one is
   * only worth showing when it says something the first did not. So a
   * prediction is remembered for this long, and the event that claims it is
   * silent unless it disagrees. The window has to cover the round trip plus the
   * server's event batching, which is why it is generously over a playable
   * ping: too short and the doubled marker comes back on exactly the connection
   * that can least afford the confusion. Too long costs at most one missing
   * correction, in the rare case where a mispredicted round's credit is still
   * standing when a genuinely surprising hit lands — the cheaper of the two
   * mistakes, which is what sets the direction of this number.
   */
  hitCreditWindow: 0.5,

  /**
   * Where a round trip stops reading as fine, and where it starts reading as a
   * problem, in milliseconds.
   *
   * Presentation and nothing else: the two thresholds colour the ping in the
   * lobby and on the scoreboard and change no rule in the game — every shot is
   * re-resolved against rewound bodies whatever the connection is doing. They
   * are here rather than in either screen because BOTH screens read them, and
   * two colours disagreeing about one number is worse than either.
   *
   * `pingFair` is a little above `interpDelay`'s hundred milliseconds, which is
   * the point at which the round trip is no longer hidden by the delay other
   * bodies are already drawn behind. `pingPoor` is where a duel stops being
   * winnable rather than where a connection stops working.
   */
  pingFair: 120,
  pingPoor: 220,

  /**
   * How far the local body may be from the server's idea of it before a
   * correction snaps rather than eases (metres).
   *
   * Movement is client-simulated and validated, so a correction means the
   * validator actually rejected something. Small disagreements are eased away
   * so an occasional rejection is not a visible jerk; a large one is a genuine
   * desync and easing it would mean spending seconds visibly in the wrong place.
   */
  correctionSnap: 2,
} as const;
