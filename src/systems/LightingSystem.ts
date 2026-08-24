/**
 * LightingSystem.ts — Sole owner of ALL dynamic light. The scene has no
 * Babylon lights; this uploads the winning slots to the cel materials (and
 * water) once per frame via setPointLights().
 * Invariants: MAX_POINT_LIGHTS (16) is an absolute shader cap. Transient
 * pulses (muzzle flash) and carried lights (player lamp) always get a slot;
 * static fixtures compete nearest-first — so fixtures must be hand-placed
 * SPATIALLY SPREAD, and any new per-bot transient light must be budgeted
 * through Game.spendMuzzleLightBudget. update() runs after the camera update
 * (slot selection keys off camera position). Adding a PointLight or
 * HemisphericLight to the scene does nothing to cel-shaded meshes — don't.
 */
import { Color3, Vector3 } from "@babylonjs/core";
import {
  CelMaterialFactory,
  MAX_POINT_LIGHTS,
  type PointLightData,
} from "../shaders/CelShader";

interface RoomLight extends PointLightData {
  /** 0 = steady, 1 = wild flicker. */
  flicker: number;
  /** Desyncs the flicker noise between fixtures. */
  phase: number;
  baseIntensity: number;
}

interface TransientLight extends PointLightData {
  t: number;
  life: number;
  peak: number;
}

/**
 * Owns every dynamic light in the room and feeds the cel shader.
 *
 * The shader has a fixed number of light slots, but a large arena holds far
 * more torches than that — so each frame the nearest `MAX_POINT_LIGHTS` to
 * the camera win, which is imperceptible in practice because distant lights
 * are already swallowed by fog. Transient flashes (muzzle, explosions) are
 * scored close to the camera on purpose so they never lose a slot.
 */
export class LightingSystem {
  private lights: RoomLight[] = [];
  private transient: TransientLight[] = [];
  private carried = new Map<string, RoomLight>();
  private active: PointLightData[] = [];
  private t = 0;

  /** Registers a static fixture light for the current room. */
  add(
    position: Vector3,
    colorHex: string,
    range: number,
    intensity: number,
    flicker: number,
  ): void {
    this.lights.push({
      position: position.clone(),
      color: Color3.FromHexString(colorHex),
      range,
      intensity,
      baseIntensity: intensity,
      flicker,
      phase: Math.random() * 100,
    });
  }

  /** Fires a short-lived light (muzzle flash, shockwave, impact). */
  pulse(
    position: Vector3,
    colorHex: string,
    range: number,
    intensity: number,
    life: number,
  ): void {
    this.transient.push({
      position: position.clone(),
      color: Color3.FromHexString(colorHex),
      range,
      intensity,
      peak: intensity,
      t: 0,
      life,
    });
  }

  /**
   * Creates or moves a light attached to something that moves (the player's
   * shoulder lamp, a boss's aura). Carried lights never lose their slot —
   * they are the ones the player is actually reading the room by.
   */
  setCarried(
    id: string,
    position: Vector3,
    colorHex: string,
    range: number,
    intensity: number,
    flicker = 0,
  ): void {
    let light = this.carried.get(id);
    if (!light) {
      light = {
        position: position.clone(),
        color: Color3.FromHexString(colorHex),
        range,
        intensity,
        baseIntensity: intensity,
        flicker,
        phase: Math.random() * 100,
      };
      this.carried.set(id, light);
      return;
    }
    light.position.copyFrom(position);
    light.range = range;
    light.baseIntensity = intensity;
  }

  removeCarried(id: string): void {
    this.carried.delete(id);
  }

  /** Drops every room light; carried lights survive between rooms. */
  clear(): void {
    this.lights.length = 0;
    this.transient.length = 0;
  }

  /**
   * Every registered static fixture, in registration order — not the slots
   * that won this frame (that is `activeLights`).
   *
   * Exists for the map editor's light-cluster check: the shader cap is
   * absolute, fixtures compete nearest-first, so a cluster of lanterns wastes
   * slots and flattens the darkness around it. Read-only — mutating a fixture
   * behind LightingSystem's back desyncs `baseIntensity` from the flicker.
   */
  get fixtures(): readonly RoomLight[] {
    return this.lights;
  }

  /**
   * The lights that won shader slots in the last `update`, nearest-first by
   * construction. Other uniform-lit materials (water) read the same set so
   * every surface agrees about which lights exist.
   */
  get activeLights(): readonly PointLightData[] {
    return this.active;
  }

  /** One fixture's flicker for this frame. Steady fixtures sit at their base. */
  private tickFlicker(l: RoomLight): void {
    l.intensity =
      l.flicker > 0
        ? l.baseIntensity * flame(this.t, l.phase, l.flicker)
        : l.baseIntensity;
  }

  /**
   * Advances flicker/decay and uploads the winning lights to every cel
   * material. Call once per frame, after the camera has been updated.
   */
  update(dt: number, viewPos: Vector3, mats: CelMaterialFactory): void {
    this.t += dt;

    // Written out twice rather than through a closure defined per frame: this
    // runs on every frame in every state, and the two shapes it has to walk
    // (an array and a Map) do not share an iteration protocol worth a lambda.
    for (const l of this.lights) this.tickFlicker(l);
    for (const l of this.carried.values()) this.tickFlicker(l);

    for (let i = this.transient.length - 1; i >= 0; i--) {
      const f = this.transient[i];
      f.t += dt;
      if (f.t >= f.life) {
        this.transient.splice(i, 1);
        continue;
      }
      // Fast attack, quadratic falloff — reads as a snap of light.
      const k = 1 - f.t / f.life;
      f.intensity = f.peak * k * k;
    }

    this.active.length = 0;
    for (const f of this.transient) this.active.push(f);
    for (const l of this.carried.values()) this.active.push(l);

    if (this.lights.length <= MAX_POINT_LIGHTS - this.active.length) {
      for (const l of this.lights) this.active.push(l);
    } else {
      // Partial selection: repeatedly take the nearest not-yet-taken light.
      // Cheaper than sorting the whole list and the counts here are small.
      const slots = MAX_POINT_LIGHTS - this.active.length;
      const taken = new Set<number>();
      for (let s = 0; s < slots; s++) {
        let best = -1;
        let bestScore = Infinity;
        for (let i = 0; i < this.lights.length; i++) {
          if (taken.has(i)) continue;
          const l = this.lights[i];
          // Distance beyond the light's own reach — a big bright fixture
          // outranks a dim one at the same distance.
          const score = Vector3.Distance(viewPos, l.position) - l.range;
          if (score < bestScore) {
            bestScore = score;
            best = i;
          }
        }
        if (best < 0) break;
        taken.add(best);
        this.active.push(this.lights[best]);
      }
    }

    mats.setPointLights(this.active);
  }
}

/**
 * Cheap flame noise: two out-of-phase sines plus a sharper tremor, clamped
 * so a fixture never fully blacks out. `amount` blends between steady and
 * frantic (broken neon).
 */
function flame(t: number, phase: number, amount: number): number {
  const wobble =
    Math.sin(t * 11.3 + phase) * 0.5 +
    Math.sin(t * 27.7 + phase * 1.7) * 0.3 +
    Math.sin(t * 43.1 + phase * 0.6) * 0.2;
  return Math.max(0.15, 1 + wobble * amount * 0.55);
}
