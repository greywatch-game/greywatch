/**
 * recoilVector.ts — what ONE ROUND does to the aim and to the weapon on
 * screen, as arithmetic.
 * Owns: the terms the recoil vector is built from — whether a fire-mode
 * position has a string (`hasString`), the first-round ramp
 * (`firstShotRamp`), the stance (`stanceScale`), the pattern envelope
 * (`aimKick`), the lateral sweep a string walks (`sweepDrift`) — and the
 * three things the weapon's linear impulse is compressed into: the model's
 * kick weight (`kickWeightOf`), the view punch's shock (`punchShockOf`) and
 * the action's two beats (`actionJolt`), plus the kick shape for a stance
 * (`blendKickShape`).
 * Owns NO state. `Player` holds the string (`stringShots`, `sinceShot`,
 * `kickDrift`, the sweep's direction) and the stance blends and hands them
 * in, and `Player.recoilKick` is still the one place the aim kick is built:
 * this is the arithmetic under it, not a second door to it.
 * Never: draws a random number. The draws are `Player.tryShot`'s and are
 * passed in, so every function here is a pure function of its arguments.
 */
import { CONFIG } from "../config";
import { impulse, smoothstep } from "./math";
import type { RecoilShape } from "./recoilCurve";

/** The aim kick one round owes the camera — see `Player.recoilKick`. */
export interface AimKick {
  pitch: number;
  yaw: number;
  /**
   * Whether this round OPENS a string, which the camera spends twice: an
   * opening round disturbs the shooter's hold (`CONFIG.recoil.shake`) and
   * every round behind it has the haul lean in (`settle.reachAds`). A weapon
   * with no string opens one on every round, so the DMR, the pistol and the
   * bolt gun disturb on each and never lean — exactly as they always did.
   */
  opensString: boolean;
}

/**
 * Whether a fire-mode POSITION has a string — whether there is such a thing
 * as being in the middle of a cycle on it. `!semiAuto` is a held trigger and
 * `burst > 1` is one pull that climbs as a single motion; a position that is
 * neither is the DMR, the pistol, or the rifle switched to `semi`, where the
 * trigger comes up between every round and every round is a first round.
 *
 * **It is the position's question and not the weapon's**, which is most of
 * what a rifle switched to `semi` actually buys: the string terms below stop
 * applying, so every round is fired at full `firstShotMult` climb and
 * minimum drift rather than into a pattern. That is a tighter group per
 * round and a worse one per second, which is the trade the selector is for.
 *
 * **Both string-shaped terms share this test**, and they have to: applied to
 * a string of one, `pattern`'s taper is a discount only a player firing a
 * precision weapon at its rate limit would collect (`docs/weapons.md`).
 * Excluded, those weapons fire shot one every time.
 */
export function hasString(mode: {
  readonly semiAuto: boolean;
  readonly burst: number;
}): boolean {
  return !mode.semiAuto || mode.burst > 1;
}

/**
 * The whole of `recoil.firstShotMult`: what the round about to leave
 * multiplies its kick by, given whether its position has a string and how
 * far into one it is (`stringShots`, already raised by this round).
 *
 * **It is 1 on a weapon that is a string of one**: there every shot is a
 * first shot, so the multiplier would be a flat recoil increase rather than
 * texture, and their `recoilMult` already carries the punch.
 *
 * The carbine's `burst` position is semi-automatic too and is deliberately
 * included: one pull is three rounds that climb as one motion, which is
 * exactly the thing that has a first round in it.
 */
export function firstShotRamp(stringed: boolean, stringShots: number): number {
  if (!stringed) return 1;
  return stringShots === 1 ? CONFIG.recoil.firstShotMult : 1;
}

/**
 * What the BODY under the weapon does to its kick. ADS is a blend because the
 * sight comes up over time; crouch and movement are blends for the same reason
 * and are already eased by `Player.update`. Airborne is the one step function
 * here — feet are on the ground or they are not — but it rides `airBlend` so a
 * hop does not switch the weapon's character on and off between two frames.
 */
export function stanceScale(
  ads: number,
  crouch: number,
  move: number,
  air: number,
): number {
  const r = CONFIG.recoil;
  return (
    (1 - (1 - r.adsMult) * ads) *
    (1 - (1 - r.crouchMult) * crouch) *
    (1 + (r.moveMult - 1) * move) *
    (1 + (r.airMult - 1) * air)
  );
}

/**
 * The aim kick of the round just fired, given its string and everything else
 * that scales it already multiplied into `kickMult`, and the lateral it drew
 * (`drift`, `sweepDrift`'s answer).
 *
 * Five things scale it and they are deliberately separate questions: how hard
 * the weapon kicks (`recoilMult`), whether this is a first round
 * (`firstShotRamp`), how far into a string it is (`pattern`, here), whether
 * the weapon is braced against a shoulder (`adsMult`), and what the body
 * under it is doing (`crouchMult`/`moveMult`/`airMult`) — the last two are
 * `stanceScale`.
 */
export function aimKick(
  stringed: boolean,
  stringShots: number,
  kickMult: number,
  drift: number,
): AimKick {
  const r = CONFIG.recoil;
  const pat = r.pattern;
  // How far into the string this round is, 0 on the first and 1 once the
  // pattern has settled. `stringShots` was raised by the shot this is for, so
  // round one reads exactly 0 and both envelopes are at their opening value.
  // A weapon with no string is pinned there — see `hasString`, which is also
  // what excludes those weapons from `firstShotMult`.
  const into =
    !stringed || pat.patternShots <= 1
      ? 0
      : Math.min(1, (stringShots - 1) / (pat.patternShots - 1));
  // ONE envelope over both axes, so a string changes how HARD the weapon
  // kicks and never which WAY. The lateral used to ramp up on an envelope of
  // its own while this one tapered down, which rotated the kick vector
  // through the opening of every string — see `pattern`.
  const env = 1 + (pat.pitchSettled - 1) * into;
  return {
    pitch: r.pitchPerShot * env * kickMult,
    yaw: drift * r.yawPerShot * env * kickMult,
    opensString: !stringed || stringShots === 1,
  };
}

/**
 * Which way a round goes, -1..+1: the number `Player.kickDrift` holds, read
 * by both the aim and the model. `sweep` is the string's direction (+1 or
 * -1, drawn on its opening round) and `noise` a fresh draw in -1..+1; both
 * are `Player.tryShot`'s.
 *
 * The bias is the CENTRE of the draw and `sweepSpan` is how far off it a
 * round may land, clamped so the total stays inside -1..+1 whatever the bias
 * is — which is what keeps every ceiling documented for `maxYaw` true. The
 * span used to be `1 - |bias|`, which made a weapon's spread a consequence of
 * its pull and put the rifle's worst round at three times its own mean.
 *
 * **It is a SWEEP over the string and never an independent draw per round**
 * (`pattern.sweepShots`; `docs/weapons.md` has the argument). The direction
 * of the sweep is the only thing drawn per STRING, and the sine starts at
 * zero so a string opens on the weapon's own bias with nothing added to it.
 * The band about that bias (`sweepSpan`) is narrow enough never to rotate
 * the kick, which is `pattern`'s rule.
 */
export function sweepDrift(
  stringShots: number,
  sweep: number,
  yawBias: number,
  noise: number,
): number {
  const pat = CONFIG.recoil.pattern;
  const walk =
    Math.sin(((stringShots - 1) * Math.PI * 2) / pat.sweepShots) * sweep;
  const wander = walk * (1 - pat.sweepNoise) + noise * pat.sweepNoise;
  return Math.max(-1, Math.min(1, yawBias + wander * pat.sweepSpan));
}

/**
 * How much of a weapon's kick reaches the MODEL, as opposed to the aim. A
 * compression, and the compression is the point: the DMR's 2.4 is a
 * defensible statement about a settle time and an indefensible thing to do to
 * a pose measured in centimetres.
 *
 * **It reads `recoilImpulse` and not `recoilMult`, and that is the honest one
 * of the two.** The kick's largest term by a distance is `kickBack`, travel
 * straight along the bore toward the eye — which is the LINEAR impulse and
 * nothing to do with how far the muzzle tips. At `kick.compress` 0.6 the
 * rifle is 1.00, the DMR 1.69, the bolt gun 2.16 and the SMG 0.66.
 */
export function kickWeightOf(recoilImpulse: number): number {
  return Math.pow(recoilImpulse, CONFIG.recoil.kick.compress);
}

/**
 * How hard a weapon SHOCKS the frame — `CameraSystem.addPunch`'s scale,
 * compressed out of the same impulse for the reason `kickWeightOf` is.
 */
export function punchShockOf(recoilImpulse: number): number {
  return Math.pow(recoilImpulse, CONFIG.recoil.punchCompress);
}

/**
 * A weapon's recoil constants for the stance it is actually held in, into
 * `out`. `riseTurns` and `easeBand` do not blend — they are the SHAPE of the
 * response rather than its speed, and the same at both ends.
 *
 * The SHOULDER does not blend either, and it is the one field here that is
 * not a constant: it is `kick.stackCap` of the weapon's own travel (`weight`,
 * `kickWeightOf`), so the stop a string runs into is proportional to what one
 * of its rounds does rather than an absolute that would clip the bolt gun's
 * single shot. Stance has nothing to say about it — the butt is in the same
 * shoulder either way.
 */
export function blendKickShape(
  out: RecoilShape,
  hip: RecoilShape,
  ads: RecoilShape,
  blend: number,
  weight: number,
): RecoilShape {
  out.grip = hip.grip + (ads.grip - hip.grip) * blend;
  out.haul = hip.haul + (ads.haul - hip.haul) * blend;
  out.riseTurns = hip.riseTurns;
  out.haulRamp = hip.haulRamp;
  out.easeBand = hip.easeBand;
  out.cap = weight * CONFIG.recoil.kick.stackCap;
  return out;
}

/**
 * The ACTION, as one signed number on the shot clock: the carrier reaching
 * the back of its travel and then slamming into battery. `sinceShot` is the
 * string counter's clock and `weight` is `kickWeightOf`'s.
 *
 * **This is what makes a self-loader read as a machine.** The charge is not
 * the only impulse a shooter feels and a rifle does not make one smooth
 * excursion per round — there is the shot, then a mass stopping hard against
 * the buffer some milliseconds later, then the same mass arriving in
 * battery. The two beats are OPPOSITE in sign, which is the whole of why the
 * pair reads as a mechanism cycling rather than as a second recoil: mass
 * travelling rearward drives the weapon back into the shoulder, and the same
 * mass arriving forward pulls it out and dips the muzzle.
 *
 * It costs no state at all. `sinceShot` is already `Player`'s — raised by a
 * shot and dropped by anything that takes the weapon away — and `impulse` is
 * already the shape of an arrival, all attack and no ease-in. Past the last
 * beat both terms are zero and this is 0 without a test.
 *
 * Which weapons have an action at all is the caller's question
 * (`Player.viewActionJolt`): this is the beat, not the exemption.
 */
export function actionJolt(sinceShot: number, weight: number): number {
  const a = CONFIG.recoil.kick.action;
  const t = sinceShot;
  if (t > a.home + a.fall) return 0;
  // Each beat ARRIVES over `rise` and dies away over `fall`. `impulse` is
  // the decay — all attack and no ease-in, which is what an arrival is —
  // and the leading smoothstep is what stops that attack being a STEP in
  // the pose. The two meet at 1 on the beat, so the pair is continuous.
  const beat = (at: number): number =>
    t < at ? smoothstep(at - a.rise, at, t) : impulse(t, at, a.fall);
  return (a.backKick * beat(a.back) + a.homeKick * beat(a.home)) * weight;
}
