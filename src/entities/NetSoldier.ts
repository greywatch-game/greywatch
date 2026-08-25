/**
 * NetSoldier.ts — Somebody else, drawn from the wire.
 * Owns: one `SoldierRig`, the interpolation buffer behind it, and the pose it
 * is put into each frame. Owns NO behaviour: it never thinks, never moves
 * itself, never fires, and never decides it is dead. Everything it shows was
 * decided by the authority.
 * Invariants: a `Combatant`, so `ConquestSystem`, `Minimap` and `ShadowSystem`
 * take it exactly as they take a `Bot`. It is pooled and never disposed — the
 * same rule the bot pool follows and for the same reason, since respawning is
 * continuous. It must never be given a `BattleCtx`; if it ever needs one,
 * something has put AI back on the client.
 *
 * **A bot and a remote human are the same thing here, and that is the point.**
 * The server decides which roster slots are people and which are AI; a client
 * draws sixteen of these either way and never learns the difference. That is
 * what makes "start a match without a full lobby" and "give a leaver's slot
 * back to a bot" the same mechanism instead of two, and it is why there is no
 * spawn or despawn on this path at all — a slot only ever changes who feeds it.
 *
 * Interpolation runs `CONFIG.net.interpDelay` behind the newest snapshot, so
 * every frame is drawn between two samples that have actually arrived. That
 * costs a fixed, honest latency and buys immunity from jitter; extrapolating
 * instead would be smoother on a clean connection and would invent motion that
 * never happened on a bad one.
 */
import { Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { Combatant, Team } from "./Combatant";
import type { DamageKind } from "../systems/CombatSystem";
import {
  animateSoldier,
  buildSoldier,
  resetSoldierPose,
  STRIDE,
  type RagdollSubject,
  type SoldierRig,
} from "./SoldierModel";

/** One received sample, with the server time it describes. */
interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  bodyYaw: number;
  pitch: number;
  moving: number;
  dead: number;
  alive: boolean;
  crouch: number;
}

/** How many samples to keep. Two is the minimum to interpolate; more absorbs jitter. */
const BUFFER = 12;

function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/** Shortest-arc angle lerp. Plain lerp spins the long way round at the ±π seam. */
function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

export class NetSoldier implements Combatant, RagdollSubject {
  readonly rig: SoldierRig;
  readonly position = new Vector3();
  readonly eyePos = new Vector3();
  readonly center = new Vector3();
  hitRadius = CONFIG.bots.hitRadius;
  alive = false;

  /**
   * The killing blow, kept for the pool. Both are armed by the server's `kill`
   * event and spent when the INTERPOLATED death arrives, which is a fraction of
   * a second later — the event is real time and the body is drawn
   * `interpDelay` behind it. Nothing else on this object is allowed that gap,
   * which is why they are a pair of plain fields rather than another sample
   * channel: they describe an instant that has already been decided, not a
   * state to be blended toward.
   *
   * An unarmed death is still a death. `RagdollSystem.applyImpulse` reads a
   * zero-length direction as "straight up", so the body falls over instead of
   * being thrown — which is what a corpse whose `kill` event was lost should
   * look like, and never a body that fails to fall.
   */
  readonly deathFrom = new Vector3();
  deathDamage = 0;
  /**
   * …and what delivered it, armed and spent with the pair above. A frame from
   * a server too old to send one reads as a round, which is what every death
   * looked like before there was anything else it could be.
   */
  deathKind: DamageKind = "bullet";
  /** Set by `RagdollSystem` for as long as it owns the joints. See `update`. */
  ragdolling = false;

  /**
   * Wired by `NetRoster`: a boot went down.
   *
   * DERIVED here rather than sent, and that is the point: the walk cycle is
   * already integrated from ground actually covered (see `update`), so a
   * footfall is a point on it exactly as it is for a `Bot` — the same test on
   * the same phase, because `STRIDE` is shared. A body slowed to a walk steps
   * more slowly for free and a stopped one stops stepping, with nothing on the
   * wire to say any of it.
   *
   * The alternative would be an event per step: sixteen bodies at two or three
   * a second, to say something both ends can already compute, for a sound that
   * is rejected on distance at the far end anyway.
   */
  onStep: () => void = () => {};

  /**
   * Which roster slot this draws. Fixed for the life of the pool entry — the
   * slot's OCCUPANT changes, the slot does not.
   */
  readonly slot: number;
  team: Team;

  /** Ring of received samples, oldest first. */
  private readonly samples: Sample[] = [];
  /** Free-running stride, integrated locally — see `EntityState.moving`. */
  private walkPhase = 0;
  /** Ground distance covered since the last frame, which drives the stride. */
  private stepped = 0;
  /** False until the first sample, so the first frame reports no travel. */
  private hasPosition = false;
  private enabled = false;

  constructor(
    scene: Scene,
    mats: CelMaterialFactory,
    slot: number,
    team: Team,
  ) {
    this.slot = slot;
    this.team = team;
    this.rig = buildSoldier(scene, mats, team);
    this.setEnabled(false);
  }

  /** Takes one snapshot sample. `t` is the server time the sample describes. */
  receive(
    t: number,
    p: readonly [number, number, number],
    yaw: number,
    bodyYaw: number,
    pitch: number,
    moving: number,
    dead: number,
    alive: boolean,
    crouch: number,
  ): void {
    // Out-of-order arrival: UDP-like reordering does not happen over a
    // WebSocket, but a reconnect can replay an older tick and one stale sample
    // dropped in the middle of the buffer would drag a body backwards.
    const newest = this.samples[this.samples.length - 1];
    if (newest && t <= newest.t) return;

    this.samples.push({ t, x: p[0], y: p[1], z: p[2], yaw, bodyYaw, pitch, moving, dead, alive, crouch });
    if (this.samples.length > BUFFER) this.samples.shift();
  }

  /**
   * Poses the rig for `renderTime` — a server-clock instant, already put behind
   * the newest sample by the caller.
   *
   * Holding still is the correct answer to a gap in the samples, and this does
   * it in both directions: before the oldest and after the newest it clamps
   * rather than extrapolating. A body that keeps walking because its packets
   * stopped is a body that has to be yanked back when they resume.
   *
   * Takes NO `dt`, which is worth stating because every other `update` in the
   * game does. Nothing here integrates against time: the pose is a function of
   * `renderTime` alone, and the one accumulator — the walk cycle — is advanced
   * by distance covered, which already carries the time. A `dt` in this
   * signature would be an invitation to make something here frame-dependent,
   * and a body drawn from the wire must look the same at 30 fps and 144.
   */
  update(renderTime: number): void {
    if (this.samples.length === 0) return;

    const [a, b, blend] = this.bracket(renderTime);

    // Taken before the guard below, and deliberately: `alive` is the pool's own
    // self-defence — a slot whose subject has come back to life releases it on
    // the next step rather than re-parenting a living body's joints for the
    // rest of the round. Stop maintaining it here and that guard can never
    // fire, because the samples are the only thing that knows.
    this.alive = b.alive;

    // While the pool owns this rig it owns the joints AND the root, and it
    // poses through proxy nodes the solver writes. Everything below is a second
    // writer on the same nodes — the trap `Bot.update` stands aside from in its
    // own dead branch, for the same reason and with the same one-line answer.
    //
    // `hasPosition` goes with it so the frame the rig comes back reports no
    // travel: `position` froze where the body died and the respawn is somewhere
    // else entirely, and the difference between the two would otherwise be
    // spent on the walk cycle in a single frame.
    if (this.ragdolling) {
      this.hasPosition = false;
      return;
    }

    const x = a.x + (b.x - a.x) * blend;
    const y = a.y + (b.y - a.y) * blend;
    const z = a.z + (b.z - a.z) * blend;
    const yaw = lerpAngle(a.yaw, b.yaw, blend);
    const bodyYaw = lerpAngle(a.bodyYaw, b.bodyYaw, blend);
    const pitch = a.pitch + (b.pitch - a.pitch) * blend;
    const moving = a.moving + (b.moving - a.moving) * blend;
    const dead = a.dead + (b.dead - a.dead) * blend;
    // Interpolated like everything else here rather than eased locally: this is
    // the AUTHORITY's stance blend, already the shape it will be, and running a
    // second ease over it would draw a body the server never had.
    const crouch = a.crouch + (b.crouch - a.crouch) * blend;

    // Ground distance covered since the last frame, for the walk cycle. Taken
    // before `position` is overwritten, and horizontal only — a body walking
    // down a slope is not taking longer strides.
    this.stepped = this.hasPosition
      ? Math.hypot(x - this.position.x, z - this.position.z)
      : 0;
    // Only a LIVING body's position is one the next frame may measure travel
    // from. A corpse's is wherever it fell and its respawn is somewhere else
    // entirely, so carrying the flag across a death spends the whole distance
    // between the two on the walk cycle in a single frame — which is a
    // half-second of sprinting animation and, now that a stride crossing makes
    // a noise, a phantom bootfall at the far end of the map. The same reason
    // the ragdoll branch above clears it, arrived at from the other side.
    this.hasPosition = this.alive;
    this.position.set(x, y, z);

    // `centerHeight` and `eyeHeight` resolved the same way `Bot.syncTransform`
    // resolves them, so a net body's centre and eye — which is what the head
    // zone is centred on and what LOS is tested against — sit where a bot's do.
    //
    // The stance moves both, down the same half metre and off the same blend
    // the authority derived ITS pair from (`NetPlayer.apply`), so the sphere a
    // shooter's own hitmarker is guessed against is the sphere the server will
    // rewind. It is the `player` numbers on both sides even though this body
    // may be a bot, and that is not an inconsistency: the crouch is one stance
    // with one geometry, and a bot that takes it is the same shape as a person
    // who does. A body that is standing resolves to `centerHeight` and
    // `eyeHeight` exactly as it always has.
    //
    // The ROOT does not move. The crouch lives inside the rig — `animateSoldier`
    // drops the body node and folds the legs under it — so the rig still hangs
    // from the standing body centre and the boots stay on the ground.
    const p = CONFIG.player;
    const c = this.rig.centerHeight;
    this.rig.root.position.set(x, y + c, z);
    this.rig.root.rotation.y = bodyYaw;
    this.center.set(x, y + c + (p.crouchCenterHeight - c) * crouch, z);
    this.eyePos.set(
      x,
      y +
        CONFIG.camera.eyeHeight +
        (p.crouchEyeHeight - CONFIG.camera.eyeHeight) * crouch,
      z,
    );

    if (!this.alive && dead >= 1 && this.enabled) {
      // Fully collapsed and still. Nothing more to draw until it respawns.
      this.setEnabled(false);
      return;
    }
    if (this.alive && !this.enabled) this.setEnabled(true);
    if (!this.enabled) return;

    if (dead > 0) {
      // A body the pool took is handled above and never reaches here, so this
      // is a death the client refused — one past the view distance, which is
      // where the rig has already stopped being drawn. There is nothing to
      // pose: it keeps the stance it was hit in until `dead` reaches 1 and the
      // branch above hides it. What ran here was the collapse tween, and it
      // went with the rest of them.
      return;
    }

    // The stride is integrated from the distance this body actually covered
    // between frames, which is the same rule `Bot` follows (`STRIDE` is shared
    // for exactly that reason) — so a bot and a remote human moving at the same
    // speed swing their legs at the same rate, and nothing on screen gives away
    // which slots are AI. `dt` is unused here on purpose: distance already
    // carries the time.
    //
    // A footfall is a point on that cycle and never a timer, which is `Bot`'s
    // test copied exactly: the legs swing as sin(walkPhase), so a foot is
    // planted forward at each half turn — pi/2 and 3pi/2, every pi offset by
    // pi/2. Sharing the phase is what keeps the boots in step with the legs
    // that are drawn, and sharing the test is what keeps a remote human's gait
    // from sounding different from a bot's.
    const wasStride = Math.floor((this.walkPhase - Math.PI / 2) / Math.PI);
    this.walkPhase += this.stepped / STRIDE;
    if (Math.floor((this.walkPhase - Math.PI / 2) / Math.PI) !== wasStride) {
      this.onStep();
    }
    animateSoldier(
      this.rig,
      this.walkPhase,
      moving,
      pitch,
      wrapAngle(yaw - bodyYaw),
      crouch,
    );
  }

  /**
   * The two samples `t` falls between, and how far between them it is.
   *
   * Clamps at both ends rather than extrapolating — see `update`.
   */
  private bracket(t: number): [Sample, Sample, number] {
    const s = this.samples;
    if (t <= s[0].t) return [s[0], s[0], 0];
    const last = s[s.length - 1];
    if (t >= last.t) return [last, last, 0];
    for (let i = 0; i < s.length - 1; i++) {
      if (t <= s[i + 1].t) {
        const span = s[i + 1].t - s[i].t;
        return [s[i], s[i + 1], span > 0 ? (t - s[i].t) / span : 0];
      }
    }
    return [last, last, 0];
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.rig.root.setEnabled(on);
    for (const mesh of this.rig.meshes) mesh.setEnabled(on);
  }

  /** Matches `Bot.setOutlines` — every emissive part opts out via `noOutline`. */
  setOutlines(on: boolean): void {
    for (const mesh of this.rig.meshes) {
      if (!mesh.metadata?.noOutline) mesh.renderOutline = on;
    }
  }

  /**
   * A net body is shot at like any other, but the DAMAGE is not decided here.
   *
   * The authority owns health, so this reports the hit and changes nothing. It
   * exists because `Hittable` requires it and because the local player's own
   * `CombatSystem.fire` needs something to find — the hitmarker it flashes is a
   * prediction that the server will agree, which it usually does and sometimes
   * does not. Returning false means "not killed", and only the server may say
   * otherwise.
   */
  takeDamage(): boolean {
    return false;
  }

  /** Puts the rig back to its rest pose. Called when a slot's occupant changes. */
  reset(): void {
    this.samples.length = 0;
    this.walkPhase = 0;
    this.hasPosition = false;
    this.alive = false;
    this.deathDamage = 0;
    this.deathKind = "bullet";
    // Belt to `RagdollSystem.release`'s braces, exactly as `Bot.spawn` clears
    // it: a rig handed back late must never come up with a live body still
    // claiming its joints.
    this.ragdolling = false;
    resetSoldierPose(this.rig);
    this.setEnabled(false);
  }

  dispose(): void {
    this.rig.root.dispose();
    for (const mesh of this.rig.meshes) mesh.dispose();
  }
}
