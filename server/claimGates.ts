/**
 * server/claimGates.ts — The gates a claimed round is put through before the
 * authority will resolve it: the RATE, the DIRECTION and the ORIGIN.
 *
 * Owns: `RateGate` (the one bucket every claimed round spends from) and
 * `SHOT_SLACK`, and four pure checks — `claimedDir`, `lookDir`, `withinCone`,
 * `withinSlip` — plus the one zero-length threshold they share.
 *
 * Why a file: `Match` takes five kinds of claimed round (a rifle shot, a
 * grenade, a shell, a cupola-gun round and a rocket or mine), and each handler
 * worked out the look vector from yaw and pitch and the cone and the slip
 * inline. Five copies had already drifted — two refused a direction shorter
 * than 1e-6 and three one shorter than 1e-3 — and a sixth claim would have
 * been a sixth chance. WHAT each gate is sized at stays in `Match`, beside the
 * argument for it, because that is policy about one weapon; HOW a claim is
 * measured against a size is here, once.
 *
 * Invariants:
 * - **Every gate bounds a LIE rather than measuring an aim.** The cones are
 *   generous on purpose (see `Match`'s constants) and nothing here may be
 *   tightened toward a weapon's real spread.
 * - The look vector is `CameraSystem`'s convention: yaw is atan2(x, z), pitch
 *   is negative-for-down. A body's reported look is what a claim is measured
 *   against, never the direction it claims.
 *
 * Must never: allocate (a firefight calls these per round), read anything but
 * its arguments, or decide a policy — a size, a weapon, a seat.
 */
import { Vector3 } from "@babylonjs/core";
import type { Vec3 } from "../src/net/protocol";

/**
 * How far ahead of its own rate a client's fire may bank, in ms.
 *
 * **The rate gate measures ARRIVALS, and a client does not control when its
 * rounds arrive.** It was a minimum SPACING — no accepted round within 90% of
 * the weapon's `shotInterval` of the last one — and 10% of an interval is
 * five milliseconds on the carbine, eight on the SMG and ten on the LMG, which
 * is less than the jitter of an ordinary wireless connection. A burst fired at
 * exactly the right cadence and delivered a few milliseconds tight lost rounds
 * SILENTLY: no correction, no event, nothing on either screen except a body
 * that did not fall. Three carbine rounds are a kill and two are 68, so the
 * symptom is the weapon quietly not doing what the table says it does.
 *
 * A bucket bounds the same thing without reading the network's timing as the
 * player's: credit accrues in real time, a round spends one interval of it,
 * and the cap is one interval plus this — so the SUSTAINED rate is exactly the
 * weapon's, and what a stall may hand back is 150 ms of rounds and no more.
 * On the carbine that is a burst arriving in one packet, which is the case it
 * is for; on the sniper it is one round 150 ms early after a pause, on an
 * interval of 1250.
 *
 * It leans toward letting a laggy honest player through, exactly as the
 * movement tolerance does and for the same reason — see
 * `docs/multiplayer.md`. A cheat worth 150 ms of banked fire, once per pause,
 * is worth less than the honest rounds the tight rule was eating.
 */
export const SHOT_SLACK = 150;

/**
 * One rate limit over a peer's claimed rounds — the bucket `SHOT_SLACK`
 * argues for, and the ONE implementation of it: the rifle, both hull guns and
 * the AT slot all spend from one of these, because a minimum spacing written
 * at any of them eats honest rounds for the same reason it did at the rifle.
 *
 * Credit accrues in real time and is capped at one interval plus `SHOT_SLACK`,
 * so the SUSTAINED rate is exactly the weapon's. `ready` and `spend` are two
 * calls so a caller may refuse a round for some other reason after asking
 * and keep the credit; `ready` banks the elapsed time either way, or a client
 * firing into a closed gate would never accumulate anything.
 */
export class RateGate {
  /** Credit banked, in ms. Starts full, so nobody's first round is refused. */
  private credit = Infinity;
  /** When `credit` was last brought up to date. */
  private at = 0;

  /** Brings the credit up to `now`; whether it holds one `interval` of it. */
  ready(now: number, interval: number): boolean {
    this.credit = Math.min(interval + SHOT_SLACK, this.credit + (now - this.at));
    this.at = now;
    return this.credit >= interval;
  }

  /** Spends one interval. Only after a `ready` that said yes. */
  spend(interval: number): void {
    this.credit -= interval;
  }

  /** Back to full, for a weapon just drawn — see `Match.onShot`. */
  fill(): void {
    this.credit = Infinity;
  }
}

/**
 * The shortest claimed direction that is a direction at all. A client sends a
 * unit vector, so anything near this is a malformed claim rather than an aim,
 * and normalising it would hand the authority a bearing made of rounding error.
 * Not a tunable — nothing honest comes within three orders of magnitude of it.
 */
const DEGENERATE_DIR = 1e-3;

/**
 * A claimed direction normalised into `out`, or false for one too short to
 * have a bearing (`out` is then left unspecified).
 */
export function claimedDir(dir: Vec3, out: Vector3): boolean {
  const [x, y, z] = dir;
  const len = Math.hypot(x, y, z);
  if (!(len >= DEGENERATE_DIR)) return false;
  out.set(x / len, y / len, z / len);
  return true;
}

/** The unit look vector for a reported `yaw` and `pitch`, written into `out`. */
export function lookDir(yaw: number, pitch: number, out: Vector3): Vector3 {
  const cp = Math.cos(pitch);
  return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
}

/** Whether unit `dir` leaves within the cone of half-angle cosine `cos` about unit `look`. */
export function withinCone(look: Vector3, dir: Vector3, cos: number): boolean {
  return Vector3.Dot(look, dir) >= cos;
}

/** Whether a claimed `origin` is within `max` metres of where the authority holds it. */
export function withinSlip(origin: Vec3, expected: Vector3, max: number): boolean {
  const [x, y, z] = origin;
  return Math.hypot(x - expected.x, y - expected.y, z - expected.z) <= max;
}
