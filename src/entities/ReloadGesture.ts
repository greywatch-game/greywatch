/**
 * ReloadGesture.ts — The first-person magazine change, as a pure function of
 * where the reload is: what the weapon does, where both hands are, where both
 * magazines are and what the action is doing, every frame.
 * Owns: the reload's choreography — its curves and its physics — and NOTHING
 * that is a scene object. `ViewModel` owns the nodes and writes what this
 * hands back onto them, the same split `Player` and the per-shot kick already
 * make: one side decides the motion, the other draws it.
 *
 * Invariants:
 * - Everything is a function of (phase, seconds, dry) and of nothing it
 *   remembers. A reload is cancelled by a swap, a death or the kit screen at
 *   any frame, and a gesture with state is one something can strand halfway;
 *   this one has none to strand. It is frame-rate independent by
 *   construction, which an integrator stepped here would not be.
 * - The CHOREOGRAPHY is in fractions of `reloadTime` and the PHYSICS is in
 *   seconds. A hand's path stretches with the gesture; how a weapon rings when
 *   a magazine is slapped into it, how long a spring takes to run a slide home
 *   and how fast a dropped magazine falls do not.
 * - Every channel is CONTINUOUS. A position, a rotation or a magazine that
 *   jumps between two frames is the robotic thing this replaced, and the one
 *   place anything jumps — the spent magazine traded for the fresh one in the
 *   hand — happens below the frame, at the pouch.
 * - The aim is not this file's. `work` is a weight `ViewModel` breaks the aim
 *   with, and the head it decides (`headPitch`/`headRoll`) goes on the
 *   RENDERED camera only; nothing here touches `aimPitch`, the bullets or the
 *   trigger. The head's look-down is the one exception to the held-trigger
 *   rule (`docs/weapons.md`), and it is level again before the reload ends.
 * - It allocates nothing per frame. Every vector is a field, and the keyed
 *   tracks and impact lists are built once per style and ending, the first
 *   time each is played.
 */
import { Quaternion, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { clamp01 } from "../core/math";
import type { ReloadAction, ReloadStyleId } from "./weaponKit";

/** A plain triple, which is how every pose in CONFIG is written. */
type XYZ = { readonly x: number; readonly y: number; readonly z: number };

/**
 * What the gesture needs to know about the weapon in the hands. Resolved once
 * per rig by `ViewModel` from the model's landmarks; every position is
 * weapon-local, in model units.
 */
export interface ReloadRig {
  style: ReloadStyleId;
  action: ReloadAction | null;
  /** The support hand at rest on the handguard — and its arm's pivot. */
  support: Vector3;
  /** Unit vector from the support hand up its forearm, for turning the wrist. */
  supportForearm: Vector3;
  /** The firing hand at rest on the grip — its arm's pivot, and the weapon's. */
  grip: Vector3;
  /** From the support hand's rest to its grip on a SEATED magazine. */
  magHand: Vector3;
  /** The line a magazine leaves its well along. */
  magDrop: Vector3;
  /** The fresh magazine's pivot: its top, at the mouth of the well. */
  magMouth: Vector3;
  /** The spent magazine's pivot: its middle, which it tumbles about. */
  magCenter: Vector3;
}

/** What the gesture is asked about this frame. */
export interface ReloadInput {
  /** 0..1 through the reload, frozen where a cancelled one left it. */
  phase: number;
  /** The eased gate — what takes a cancelled reload's pose back off. */
  blend: number;
  /** `reloadTime`, which turns a fraction into seconds for the physics. */
  seconds: number;
  /** Whether a reload is actually in flight; the parts key off this. */
  live: boolean;
  /** Whether it ran the weapon DRY, so the action has to be closed. */
  dry: boolean;
  /**
   * Gravity in the frame the magazines live in — the weapon's own, in model
   * units per second squared. `ViewModel` converts the world's down every
   * frame, so a dropped magazine falls the way the ground says.
   */
  fall: Vector3;
}

/** Everything the gesture has decided this frame. Owned by the gesture. */
export class ReloadPose {
  /** Camera-local offsets laid on the weapon, the rotation about `pivot`. */
  readonly weaponPos = new Vector3();
  readonly weaponRot = new Vector3();
  /** Weapon-local point the weapon is turned about — the firing hand. */
  readonly pivot = new Vector3();
  /** How far into the work the weapon is, 0..1 — what breaks the aim. */
  work = 0;
  /**
   * The HEAD, in radians on the rendered camera: looking DOWN at the work
   * (`headPitch`, negative is down, the camera's own convention) and leaning
   * a little with the cant (`headRoll`), both taking a little of every impact
   * the weapon takes — a slap that moves a rifle moves the shoulders it is held
   * against. `ViewModel` counter-rotates the weapon by the same amounts, so the
   * head moves and the hands do not.
   */
  headPitch = 0;
  headRoll = 0;

  /** The support arm: offset from its rest, and turn about its own hand. */
  readonly supportPos = new Vector3();
  readonly supportRot = new Quaternion();
  /** The firing arm, likewise. */
  readonly triggerPos = new Vector3();
  readonly triggerRot = new Quaternion();

  /**
   * The weapon's own magazine node: in the well until the old magazine moves,
   * gone while the hand is at the pouch, and the FRESH magazine from the
   * moment it is in the hand. Offsets from seated, rotation about its mouth.
   */
  magShown = true;
  readonly magPos = new Vector3();
  readonly magRot = new Vector3();
  /** Whether that fresh magazine is in the support hand right now. */
  magInHand = false;
  /** The spent magazine's clone: falling or stripped, rotation about its middle. */
  spentShown = false;
  readonly spentPos = new Vector3();
  readonly spentRot = new Vector3();

  /** Whether the reload is working the bolt, and how far: draw along -z, turn. */
  boltLive = false;
  boltDraw = 0;
  boltTurn = 0;
  /** The slide's offset along z — negative is back. */
  slide = 0;
}

/**
 * A keyed track: times and values, played as a cubic through every key with
 * Catmull-Rom tangents, zero at both ends. The curve flows THROUGH a key
 * rather than stopping at it, which is what makes a run of poses read as one
 * motion with the weight carried from each into the next.
 */
interface Track {
  t: number[];
  v: Vector3[];
  /** Tangents, per unit of phase. */
  m: Vector3[];
}

type JoltSpec = (typeof CONFIG.viewmodel.reload.jolts)[keyof typeof CONFIG.viewmodel.reload.jolts];

/** One impact on the timeline: which ring, on which beat, and how hard. */
interface Jolt {
  spec: JoltSpec;
  at: number;
  gain: number;
}

/**
 * The minimum-jerk profile, `10x³ - 15x⁴ + 6x⁵`: zero speed AND zero
 * acceleration at both ends and a bell of speed between. It is what a
 * practised hand's reach to a target measures as, and it is why a reach here
 * neither lurches off its mark nor slams into the next one — where `hermite`
 * starts and stops with a finite acceleration, which reads as a motor.
 */
function mj(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * x * (10 + x * (6 * x - 15));
}

/** `mj` over a window of the timeline. */
function win(ph: number, w: readonly number[]): number {
  return mj((ph - w[0]) / (w[1] - w[0]));
}

/**
 * Out and back over a window, reaching 1 at `peak` of it: an out-stroke and a
 * return, each minimum-jerk. A tug is quick out and eased back, so its peak
 * sits early.
 */
function bump(ph: number, a: number, b: number, peak: number): number {
  const x = (ph - a) / (b - a);
  if (x <= 0 || x >= 1) return 0;
  return x < peak ? mj(x / peak) : 1 - mj((x - peak) / (1 - peak));
}

/**
 * The quadratic Bézier from `a` to `c`, pulled toward `b`, into `out`. Every
 * argument is read before `out` is written, so `out` may be one of them.
 */
function bez(out: Vector3, a: Vector3, b: Vector3, c: Vector3, s: number): Vector3 {
  const u = 1 - s;
  const ka = u * u;
  const kb = 2 * u * s;
  const kc = s * s;
  return out.set(
    a.x * ka + b.x * kb + c.x * kc,
    a.y * ka + b.y * kb + c.y * kc,
    a.z * ka + b.z * kb + c.z * kc,
  );
}

/** A plain triple into a vector, scaled. `copyFrom` reads `_x`, so it cannot. */
function put(out: Vector3, v: XYZ, k = 1): Vector3 {
  return out.set(v.x * k, v.y * k, v.z * k);
}

/** `out += v * k` for a plain triple. */
function addXYZ(out: Vector3, v: XYZ, k: number): void {
  out.x += v.x * k;
  out.y += v.y * k;
  out.z += v.z * k;
}

/**
 * The damped ring a mass on a spring answers an impulse with, normalised so
 * its first swing peaks at about 1: `e^(-t/decay) sin(2πf t)`. Zero before
 * the impact and zero ON it — an impact hands the weapon a speed, never a
 * displacement — eased in over `rise` seconds, the time the force takes to
 * arrive, and cut at `6 * decay`, where it is under a quarter of a percent.
 */
function ring(tau: number, hz: number, decay: number, rise: number): number {
  if (tau <= 0 || tau > decay * 6) return 0;
  const w = 2 * Math.PI * hz;
  const tp = Math.atan(w * decay) / w;
  const peak = Math.exp(-tp / decay) * Math.sin(w * tp);
  const onset = tau < rise ? mj(tau / rise) : 1;
  return (onset * Math.exp(-tau / decay) * Math.sin(w * tau)) / peak;
}

/** Samples a keyed track at `ph` into `out`: a cubic Hermite between keys. */
function sample(tr: Track, ph: number, out: Vector3): Vector3 {
  const t = tr.t;
  const n = t.length;
  if (ph <= t[0]) return out.copyFrom(tr.v[0]);
  if (ph >= t[n - 1]) return out.copyFrom(tr.v[n - 1]);
  let i = 0;
  while (i < n - 2 && ph >= t[i + 1]) i++;
  const dt = t[i + 1] - t[i];
  const x = (ph - t[i]) / dt;
  const x2 = x * x;
  const x3 = x2 * x;
  const h00 = 2 * x3 - 3 * x2 + 1;
  const h10 = (x3 - 2 * x2 + x) * dt;
  const h01 = -2 * x3 + 3 * x2;
  const h11 = (x3 - x2) * dt;
  const a = tr.v[i];
  const b = tr.v[i + 1];
  const ma = tr.m[i];
  const mb = tr.m[i + 1];
  return out.set(
    a.x * h00 + ma.x * h10 + b.x * h01 + mb.x * h11,
    a.y * h00 + ma.y * h10 + b.y * h01 + mb.y * h11,
    a.z * h00 + ma.z * h10 + b.z * h01 + mb.z * h11,
  );
}

/**
 * How far the ROTATION leads the translation, as a share of the gesture. A
 * wrist turns the weapon before the arm carries it, so the cant is already
 * arriving as the weapon starts to come up and is the first thing to leave on
 * the way back. A few hundredths is a few tens of milliseconds — overlap, not
 * a second event.
 */
const ROT_LEAD = 0.025;

export class ReloadGesture {
  readonly out = new ReloadPose();
  /** Keyed by style, ending and channel; built the first time each is played. */
  private readonly tracks = new Map<string, Track>();
  /** Keyed by ending and action; built likewise. */
  private readonly joltLists = new Map<string, Jolt[]>();

  /** Never written: the arm's own rest, as an offset. */
  private readonly zero = Vector3.Zero();
  private readonly qIdentity = Quaternion.Identity();
  // Scratch, partitioned so no helper can write a vector its caller is
  // holding: the callers use a/b/c, `freshAt` and `strippedAt` their own,
  // `holding` its own.
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();
  private readonly f1 = new Vector3();
  private readonly f2 = new Vector3();
  private readonly f3 = new Vector3();
  private readonly s1 = new Vector3();
  private readonly s2 = new Vector3();
  private readonly sq = new Quaternion();
  private readonly h1 = new Vector3();
  private readonly h2 = new Vector3();
  private readonly fetchPos = new Vector3();
  private readonly fetchRot = new Vector3();
  private readonly fetchArm = new Vector3();
  private readonly fetchQ = new Quaternion();

  /**
   * Evaluates the whole gesture into `out` and returns it. When no reload is
   * in flight and none is easing out the caller does not call it at all.
   */
  evaluate(rig: ReloadRig, inp: ReloadInput): ReloadPose {
    const r = CONFIG.viewmodel.reload;
    const o = this.out;
    const ph = clamp01(inp.phase);
    const w = inp.blend;
    const action = inp.dry ? rig.action : null;
    const dryEnd = action !== null;

    // --- the weapon: a curve through the style's poses, turned in the hand ---
    sample(this.track(rig.style, dryEnd, false), ph, o.weaponPos);
    // The lead grows in over the first tenth rather than being there on the
    // first frame: sampled ahead at phase 0 it would hand a reload begun under
    // the tail of the last one a turn it had not yet made.
    const lead = ROT_LEAD * Math.min(1, ph / 0.1);
    sample(this.track(rig.style, dryEnd, true), Math.min(1, ph + lead), o.weaponRot);
    o.weaponPos.scaleInPlace(w);
    o.weaponRot.scaleInPlace(w);
    o.pivot.copyFrom(rig.grip);

    // The impacts on top, each a ring in SECONDS from its own beat.
    const rate = 1 / Math.sqrt(r.styles[rig.style].heft);
    let joltRoll = 0;
    let joltPitch = 0;
    const cant = o.weaponRot.z;
    for (const j of this.jolts(inp.dry, action)) {
      const tau = (ph - j.at) * inp.seconds;
      const k = ring(tau, j.spec.hz * rate, j.spec.decay, j.spec.rise) * j.gain * rate * w;
      if (k === 0) continue;
      addXYZ(o.weaponPos, j.spec.pos, k);
      addXYZ(o.weaponRot, j.spec.rot, k);
      joltRoll += j.spec.rot.z * k;
      joltPitch += j.spec.rot.x * k;
    }

    const back = dryEnd ? r.tiltOut : r.tacticalOut;
    o.work = w * mj(ph / r.tiltIn) * (1 - mj((ph - back[0]) / (back[1] - back[0])));

    // --- the head: down to the work, a little further for the insert ---
    // The look comes in with the weapon and leaves AHEAD of it — the eyes go
    // back to the fight as the rifle is still coming up into the shoulder —
    // and dwells a little deeper while the fresh magazine is found and driven
    // home, which is the one part of a reload a practised hand still watches.
    // A weapon thrown up by a slap throws the shoulders and the head with it:
    // its nose coming up (negative `rot.x`) lifts the head (positive).
    const h = r.head;
    const away = dryEnd ? h.lookOut : h.lookOutTactical;
    const look =
      mj((ph - h.lookIn[0]) / (h.lookIn[1] - h.lookIn[0])) *
      (1 - mj((ph - away[0]) / (away[1] - away[0]))) *
      (1 + h.watch * bump(ph, r.fresh.from, r.tug.at[1], 0.5));
    o.headPitch = -h.look * look * w - h.nod * joltPitch;
    o.headRoll = h.follow * cant + h.jolt * joltRoll;

    this.poseMagazines(rig, inp, ph);

    this.poseSupport(rig, ph, inp.dry, action);
    this.poseTrigger(rig, ph, inp.dry, action);
    o.supportPos.scaleInPlace(w);
    o.triggerPos.scaleInPlace(w);
    if (w < 1) {
      Quaternion.SlerpToRef(this.qIdentity, o.supportRot, w, o.supportRot);
      Quaternion.SlerpToRef(this.qIdentity, o.triggerRot, w, o.triggerRot);
    }

    this.poseAction(inp, ph, action);
    return o;
  }

  /**
   * The style's keyed track for one ending and one channel, built the first
   * time it is asked for.
   *
   * The keys are the style's four deviations laid on the gesture's beats: in
   * to the work with the roll overshooting it, settled, sagging while the hand
   * is away, turned to meet the magazine, recovering from the seat — and then
   * one of two endings, the dry one turning to present the action before the
   * weapon goes home. Both go home a little PAST the carry and back, which is
   * a weapon arriving in a shoulder rather than being parked in one.
   */
  private track(style: ReloadStyleId, dry: boolean, rot: boolean): Track {
    const key = `${style}/${dry ? "dry" : "tac"}/${rot ? "rot" : "pos"}`;
    const hit = this.tracks.get(key);
    if (hit) return hit;
    const s = CONFIG.viewmodel.reload.styles[style];
    const pick = (p: { pos: XYZ; rot: XYZ }) => (rot ? p.rot : p.pos);
    const W = pick(s.work);
    const S = pick(s.sag);
    const M = pick(s.meet);
    const P = pick(s.present);
    const v = (wk: number, sg = 0, mt = 0, pr = 0) =>
      new Vector3(
        W.x * wk + S.x * sg + M.x * mt + P.x * pr,
        W.y * wk + S.y * sg + M.y * mt + P.y * pr,
        W.z * wk + S.z * sg + M.z * mt + P.z * pr,
      );
    const t: number[] = [0, 0.09, 0.16, 0.25, 0.38, 0.47, 0.58];
    const vals: Vector3[] = [v(0), v(0.82), v(1.07), v(1), v(1, 1), v(1, 0.2, 1), v(1, 0, 0.35)];
    if (dry) {
      t.push(0.68, 0.78, 0.87, 0.95, 1);
      vals.push(v(1, 0, 0.1, 0.85), v(1, 0, 0, 1), v(0.32, 0, 0, 0.32), v(-0.025), v(0));
    } else {
      t.push(0.68, 0.8, 0.9, 1);
      vals.push(v(0.97), v(0.4), v(-0.025), v(0));
    }
    const m = vals.map((_, i) =>
      i === 0 || i === vals.length - 1
        ? Vector3.Zero()
        : vals[i + 1].subtract(vals[i - 1]).scaleInPlace(1 / (t[i + 1] - t[i - 1])),
    );
    const built = { t, v: vals, m };
    this.tracks.set(key, built);
    return built;
  }

  /** The impacts of one ending, in timeline order, built once. */
  private jolts(dry: boolean, action: ReloadAction | null): Jolt[] {
    const key = `${dry ? "dry" : "tac"}/${action ? action.kind : "-"}`;
    const hit = this.joltLists.get(key);
    if (hit) return hit;
    const r = CONFIG.viewmodel.reload;
    const j = r.jolts;
    const list: Jolt[] = [];
    const push = (spec: JoltSpec, at: number, gain = 1) => list.push({ spec, at, gain });
    if (dry) push(j.release, r.magOut);
    else push(j.strip, r.strip.at[0] + 0.02);
    push(j.seat, r.magSeat);
    push(j.tug, r.tug.at[0]);
    switch (action?.kind) {
      case "catch":
        push(j.strike, r.bolt);
        push(j.slam, r.bolt + 0.01, 0.6);
        break;
      case "handle":
        push(j.yank, r.handle.pull[0]);
        push(j.slam, r.bolt);
        break;
      case "bolt":
        // The bolt fetching up on its rear stop throws the rifle forward, and
        // running it home on a round throws it back — the cycle's own pair.
        push(j.slam, r.boltWork.open.draw[1], 0.5);
        push(j.yank, r.boltWork.close.push[1], 0.8);
        break;
      case "slide":
        push(j.slam, r.bolt);
        break;
    }
    // The butt finding the shoulder pocket, a little ahead of the end: a ring
    // is measured from the phase, and the phase stops at 1, so one still
    // swinging when the reload ends is held mid-swing while the blend fades
    // it rather than ringing out.
    push(j.shoulder, (action ? r.tiltOut : r.tacticalOut)[1] - 0.08);
    this.joltLists.set(key, list);
    return list;
  }

  /**
   * Both magazines. The weapon's own node is the one in the well and then the
   * FRESH one; the clone is the SPENT one, dropped free on a dry reload or
   * stripped out in the hand on a tactical one. They trade places on the frame
   * the old magazine first moves, where the two are identical and in the same
   * place, so the trade cannot be seen.
   */
  private poseMagazines(rig: ReloadRig, inp: ReloadInput, ph: number): void {
    const r = CONFIG.viewmodel.reload;
    const o = this.out;
    o.magPos.setAll(0);
    o.magRot.setAll(0);
    o.spentPos.setAll(0);
    o.spentRot.setAll(0);
    o.magInHand = false;
    o.spentShown = false;
    if (!inp.live) {
      o.magShown = true;
      return;
    }
    const leaves = inp.dry ? r.magOut : r.strip.at[0];
    if (ph < leaves) {
      o.magShown = true;
      return;
    }
    // The fresh one: gone while the hand is at the pouch, in it from `from`.
    o.magShown = ph >= r.fresh.from;
    if (o.magShown) {
      o.magInHand = ph < r.magSeat;
      this.freshAt(rig, ph, o.magPos, o.magRot);
    }

    // The spent one. Stripped, it is in the hand until the fresh one is — the
    // two trade at the pouch, coincident.
    if (!inp.dry) {
      if (ph < r.fresh.from) {
        o.spentShown = true;
        this.strippedAt(rig, Math.min(ph, r.strip.at[1]), o.spentPos, o.spentRot);
      }
      return;
    }
    const s = r.spent;
    const tau = (ph - r.magOut) * inp.seconds;
    if (tau > s.life) return;
    o.spentShown = true;
    // Off the catch already moving, out of the well at a fraction of g with
    // the well's friction still on it, and then free: carrying the speed it
    // left with, plus a shove, plus the world's gravity.
    const a = Math.max(1e-3, inp.fall.length() * s.grip);
    const v0 = s.eject;
    const t1 = (Math.sqrt(v0 * v0 + 2 * a * s.slide) - v0) / a;
    if (tau < t1) {
      o.spentPos.copyFrom(rig.magDrop).scaleInPlace(v0 * tau + 0.5 * a * tau * tau);
      return;
    }
    const u = tau - t1;
    o.spentPos.copyFrom(rig.magDrop).scaleInPlace(s.slide + (v0 + a * t1) * u);
    addXYZ(o.spentPos, s.shove, u);
    o.spentPos.addInPlace(this.c.copyFrom(inp.fall).scaleInPlace(0.5 * u * u));
    put(o.spentRot, s.spin, u);
  }

  /**
   * The fresh magazine's offset from seated and its rotation about its mouth,
   * from the pouch to the well. `fresh` in the config has the shape. Uses only
   * `f1`/`f2`/`f3`, so `pos` and `rot` may be any of the caller's vectors.
   */
  private freshAt(rig: ReloadRig, ph: number, pos: Vector3, rot: Vector3): void {
    const r = CONFIG.viewmodel.reload;
    const f = r.fresh;
    if (ph >= r.magSeat) {
      pos.setAll(0);
      rot.setAll(0);
      return;
    }
    const idx = this.f1.copyFrom(rig.magDrop).scaleInPlace(f.indexDist);
    addXYZ(idx, f.indexSide, 1);
    if (ph < f.index) {
      const x = Math.max(0, (ph - f.from) / (f.index - f.from));
      const via = this.f2.copyFrom(rig.magDrop).scaleInPlace(f.arc.drop).addInPlace(idx);
      via.x += f.arc.side;
      bez(pos, put(this.f3, f.fetch.pos), via, idx, mj(x));
      // Turned upright a little ahead of arriving, so the last of the approach
      // is a magazine already lined up with the well.
      const sr = mj(Math.min(1, x * 1.18));
      const a = f.fetch.rot;
      const b = f.indexRot;
      rot.set(a.x + (b.x - a.x) * sr, a.y + (b.y - a.y) * sr, a.z + (b.z - a.z) * sr);
      return;
    }
    // Driven home: the distance to go falls as 1 - x², so it is at its
    // fastest on the frame it seats.
    const x = (ph - f.index) / (r.magSeat - f.index);
    const k = 1 - x * x;
    pos.copyFrom(idx).scaleInPlace(k);
    put(rot, f.indexRot, k * k);
  }

  /**
   * The tactically stripped magazine: straight out down its own axis first —
   * it is still in the well — and then away below the frame, to EXACTLY where
   * the fresh one is picked up (`fresh.fetch`). That is the dump pouch and the
   * magazine pouch being one reach apart, and it is what lets the hand's path
   * run on without a break: the two magazines are identical and in one place
   * on the frame they trade, so the hand carrying one is the hand carrying the
   * other. The clone turns about its MIDDLE and the fresh one about its MOUTH,
   * so the same placement is a different offset for each:
   * `d = R (centre - mouth) + mouth - centre + fetch`. Uses only `s1`/`s2`/`sq`.
   */
  private strippedAt(rig: ReloadRig, ph: number, pos: Vector3, rot: Vector3): void {
    const r = CONFIG.viewmodel.reload;
    const st = r.strip;
    const fetch = r.fresh.fetch;
    const s = mj((ph - st.at[0]) / (st.at[1] - st.at[0]));
    Quaternion.RotationYawPitchRollToRef(fetch.rot.y, fetch.rot.x, fetch.rot.z, this.sq);
    const end = this.s2.copyFrom(rig.magCenter).subtractInPlace(rig.magMouth);
    end.rotateByQuaternionToRef(this.sq, end);
    end.addInPlace(rig.magMouth).subtractInPlace(rig.magCenter);
    addXYZ(end, fetch.pos, 1);
    const via = this.s1.copyFrom(rig.magDrop).scaleInPlace(0.22);
    bez(pos, this.zero, via, end, s);
    put(rot, fetch.rot, s * s);
  }

  /**
   * Where the support arm is when its hand holds a magazine: the magazine's
   * own transform applied to the hand's grip on it. `pivot` is what the
   * magazine turns about, `d`/`e` its offset and Euler rotation. Writes the
   * arm's offset into `pos` and its turn about its own hand into `q`:
   * `pos = R (S + o - P) + P + d - S`.
   */
  private holding(
    rig: ReloadRig,
    pivot: Vector3,
    d: Vector3,
    e: Vector3,
    pos: Vector3,
    q: Quaternion,
  ): void {
    Quaternion.RotationYawPitchRollToRef(e.y, e.x, e.z, q);
    const v = this.h1.copyFrom(rig.support).addInPlace(rig.magHand).subtractInPlace(pivot);
    v.rotateByQuaternionToRef(q, this.h2);
    pos.copyFrom(this.h2).addInPlace(pivot).addInPlace(d).subtractInPlace(rig.support);
  }

  /** The support hand: the magazine change, and on a dry reload the action. */
  private poseSupport(
    rig: ReloadRig,
    ph: number,
    dry: boolean,
    action: ReloadAction | null,
  ): void {
    const r = CONFIG.viewmodel.reload;
    const o = this.out;
    const pos = o.supportPos;
    const q = o.supportRot;
    const mh = rig.magHand;
    q.copyFrom(this.qIdentity);

    if (ph < r.fresh.from) {
      if (dry) {
        // Off the handguard and down to the pouch: falling away first, then
        // in toward the body — to where the fresh magazine will be in it.
        this.freshAt(rig, r.fresh.from, this.fetchPos, this.fetchRot);
        this.holding(rig, rig.magMouth, this.fetchPos, this.fetchRot, this.fetchArm, this.fetchQ);
        const end = this.fetchArm;
        const s = win(ph, r.away);
        const via = this.a.set(end.x * 0.15, end.y * r.dip, end.z * 0.1);
        bez(pos, this.zero, via, end, s);
        Quaternion.SlerpToRef(this.qIdentity, this.fetchQ, s, q);
        return;
      }
      const st = r.strip;
      if (ph < st.at[0]) {
        // To the magazine still in the well, ducking under the handguard.
        const via = this.a.set(mh.x * 0.5 - 0.02, Math.min(0, mh.y) - 0.04, mh.z * 0.5);
        bez(pos, this.zero, via, mh, win(ph, st.reach));
        return;
      }
      // Carrying it out: the hand is wherever the stripped magazine is.
      this.strippedAt(rig, Math.min(ph, st.at[1]), this.a, this.b);
      this.holding(rig, rig.magCenter, this.a, this.b, pos, q);
      return;
    }

    const tug = r.tug;
    if (ph < tug.at[1]) {
      // Carrying the fresh one, and once it is home, pulling on it.
      this.freshAt(rig, ph, this.a, this.b);
      this.holding(rig, rig.magMouth, this.a, this.b, pos, q);
      const k = bump(ph, tug.at[0], tug.at[1], tug.peak) * tug.dist;
      if (k !== 0) pos.addInPlace(this.c.copyFrom(rig.magDrop).scaleInPlace(k));
      return;
    }

    // The ending, from the hand on the seated magazine with no turn on it.
    if (action?.kind === "catch") {
      const c = r.catch;
      const contact = this.b.copyFrom(action.hand).subtractInPlace(rig.support);
      const stand = this.c.copyFrom(contact).subtractInPlace(action.strike);
      if (ph < c.reach[1]) {
        // Up the left flank to stand off the catch, swung wide of the receiver.
        const via = this.a.set(
          Math.min(mh.x, stand.x) - 0.05,
          Math.max(mh.y, stand.y),
          (mh.z + stand.z) / 2,
        );
        bez(pos, mh, via, stand, win(ph, c.reach));
      } else if (ph < r.bolt) {
        // Driven in, accelerating — a strike, not a placement.
        const x = (ph - c.reach[1]) / (r.bolt - c.reach[1]);
        pos.copyFrom(action.strike).scaleInPlace(x * x).addInPlace(stand);
      } else {
        // Off the catch the way it bounced, and home to the handguard.
        const via = this.a.set(contact.x - 0.05, contact.y - 0.02, contact.z * 0.5);
        bez(pos, contact, via, this.zero, win(ph, c.home));
      }
      const twist = c.twist * win(ph, c.reach) * (1 - win(ph, c.home));
      if (twist !== 0) Quaternion.RotationAxisToRef(rig.supportForearm, twist, q);
      return;
    }
    if (action?.kind === "handle" && action.arm === "support") {
      this.handlePath(ph, action, rig.support, mh, pos);
      return;
    }
    // Nothing else for this hand to do: home to the handguard, dropping a
    // little as it leaves the magazine and sweeping up to where it holds.
    const via = this.a.set(mh.x * 0.6 - 0.03, mh.y - 0.03, mh.z * 0.45);
    bez(pos, mh, via, this.zero, win(ph, r.home));
  }

  /**
   * A charging handle, worked by whichever hand the model names: to the knob,
   * yanked the length of its slot, let fly, and home. `rest` is that arm's
   * rest and `from` where the hand starts, as an offset from it.
   */
  private handlePath(
    ph: number,
    action: Extract<ReloadAction, { kind: "handle" }>,
    rest: Vector3,
    from: Vector3,
    pos: Vector3,
  ): void {
    const r = CONFIG.viewmodel.reload;
    const h = r.handle;
    const grab = this.b.copyFrom(action.hand).subtractInPlace(rest);
    if (ph < h.reach[0]) {
      pos.copyFrom(from);
    } else if (ph < h.pull[0]) {
      // Wide of the weapon on whichever side the handle is, and over it.
      const via = this.a.set(
        action.hand.x < 0 ? Math.min(from.x, grab.x) - 0.06 : Math.max(from.x, grab.x) + 0.04,
        Math.max(from.y, grab.y) + 0.02,
        (from.z + grab.z) / 2,
      );
      bez(pos, from, via, grab, win(ph, h.reach));
    } else if (ph < r.bolt) {
      pos.copyFrom(action.pull).scaleInPlace(win(ph, h.pull)).addInPlace(grab);
    } else {
      // Let go: the hand carries on back past where it let the handle fly,
      // and then comes home.
      const pulled = this.c.copyFrom(grab).addInPlace(action.pull);
      const via = this.a.copyFrom(action.pull).scaleInPlace(h.follow * 2).addInPlace(pulled);
      via.y -= 0.02;
      bez(pos, pulled, via, this.zero, win(ph, h.home));
    }
  }

  /**
   * The firing hand: a twitch as it drops the magazine, and on a dry reload
   * whatever the action asks of it — a bolt worked, a handle charged, a slide
   * stop thumbed down. Otherwise it never leaves the grip, because it is what
   * the weapon is being held by.
   */
  private poseTrigger(
    rig: ReloadRig,
    ph: number,
    dry: boolean,
    action: ReloadAction | null,
  ): void {
    const r = CONFIG.viewmodel.reload;
    const o = this.out;
    const pos = o.triggerPos;
    pos.setAll(0);
    o.triggerRot.copyFrom(this.qIdentity);

    // The release: pressed just ahead of the magazine moving, let go as it does.
    const leaves = dry ? r.magOut : r.strip.at[0];
    let press = bump(ph, leaves - r.press.len + 0.02, leaves + 0.02, 0.45);
    // A slide stop is thumbed down onto the beat, the same small press.
    if (action?.kind === "slide") {
      press += 0.8 * bump(ph, r.bolt - r.slide.thumb, r.bolt + 0.01, 0.7);
    }
    if (press !== 0) {
      const pr = r.press.rot;
      Quaternion.RotationYawPitchRollToRef(pr.y * press, pr.x * press, pr.z * press, o.triggerRot);
    }

    if (action?.kind === "handle" && action.arm === "trigger") {
      this.handlePath(ph, action, rig.grip, this.zero, pos);
    } else if (action?.kind === "bolt") {
      // On the knob, riding it — the cycle's `cycleHand` plus the draw — for
      // as long as the hand is there, and back on the grip in between while
      // the bolt stays open.
      const b = r.boltWork;
      const onKnob =
        ph < b.close.reach[0]
          ? win(ph, b.open.reach) * (1 - win(ph, b.open.home))
          : win(ph, b.close.reach) * (1 - win(ph, b.close.home));
      put(pos, CONFIG.viewmodel.cycle.cycleHand, onKnob);
      pos.z -= boltDrawAt(ph) * onKnob;
    }
  }

  /** The bolt and the slide — the action's own parts, which key off `live`. */
  private poseAction(inp: ReloadInput, ph: number, action: ReloadAction | null): void {
    const r = CONFIG.viewmodel.reload;
    const o = this.out;
    o.boltLive = false;
    o.boltDraw = 0;
    o.boltTurn = 0;
    o.slide = 0;
    if (!inp.live || !action) return;
    if (action.kind === "bolt") {
      const b = r.boltWork;
      const lift = CONFIG.viewmodel.cycle.liftTurn;
      o.boltLive = true;
      o.boltDraw = boltDrawAt(ph);
      o.boltTurn =
        ph < b.close.reach[0] ? lift * win(ph, b.open.lift) : lift * (1 - win(ph, b.close.turn));
    } else if (action.kind === "slide") {
      // Back on the stop from the last round, and home off it on the beat
      // under the spring — accelerating, so it arrives at its fastest.
      const x = ((ph - r.bolt) * inp.seconds) / r.slide.close;
      o.slide = x <= 0 ? -action.travel : x >= 1 ? 0 : -action.travel * (1 - x * x);
    }
  }
}

/** How far back a bolt gun's bolt is drawn at `ph` of a dry reload. */
function boltDrawAt(ph: number): number {
  const b = CONFIG.viewmodel.reload.boltWork;
  const draw = CONFIG.viewmodel.cycle.draw;
  return ph < b.close.reach[0]
    ? draw * win(ph, b.open.draw)
    : draw * (1 - win(ph, b.close.push));
}
