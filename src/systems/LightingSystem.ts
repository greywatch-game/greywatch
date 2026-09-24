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
  type ShadowIntent,
  type SpotCone,
} from "../shaders/CelShader";
import { mulberry32 } from "../world/rng";

export interface RoomLight extends PointLightData {
  /** 0 = steady, 1 = wild flicker. */
  flicker: number;
  /** Desyncs the flicker noise between fixtures. */
  phase: number;
  baseIntensity: number;
  /**
   * Whether this light's BOUNCE has to follow it frame by frame — see
   * `GiVolume`'s two layers. A steady lantern is slow: its bounce is traced on
   * the rolling budget and averaged. Anything that burns up, dies down or
   * moves faster than that average can follow (a thrown fire, the carried
   * lamp) is fast, and is re-bounced every frame near the eye.
   *
   * It says nothing about the DIRECT light, which every light gets the same.
   */
  fast: boolean;
}

interface TransientLight extends PointLightData {
  t: number;
  life: number;
  peak: number;
}

/**
 * The flicker's own stream, re-seeded whenever the room is cleared.
 *
 * **A phase is the one thing about a fixture that nothing else states**, so it
 * has to be drawn — and drawing it from `Math.random()` is what this used to
 * do. That is fine in play, where nobody can tell one lantern's flame from the
 * same lantern's flame a boot earlier, and it is not fine for anything that
 * has to reproduce a PICTURE: it is the one term in a frozen frame that no
 * amount of pinning the clock can reach, so two boots of the same village
 * light the same lamp to two different intensities. Measured across two
 * processes with every clock, uniform and camera provably identical, it moved
 * a lamp-lit street by up to 1.0/255 mean channel error — over any tolerance
 * a reference set is worth checking against (`plans/webgpu-ref/`).
 *
 * Seeding it costs nothing and buys the same rule the world layer already
 * keeps for scatter (`world/rng.ts`): the room builds the same way every time.
 * **Re-seeded in `clear`** rather than only at construction, so a fixture's
 * phase is a function of the MAP and its position in the layout — otherwise
 * the second map of a session flickers differently from the same map booted
 * into directly, which is the same bug with a longer fuse.
 */
const FLICKER_SEED = 0x1a3f;

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
  /**
   * Bumped whenever the fixture SET changes — an add, a remove, a clear — so a
   * reader that caches a choice over `fixtures` can ask whether it is stale.
   * A count cannot: a fire burning out on the frame another is lit leaves it
   * where it was.
   */
  private fixtureSet = 0;
  private transient: TransientLight[] = [];
  private carried = new Map<string, RoomLight>();
  /**
   * `carried`'s values as a plain list, in the same order — kept beside it so
   * the per-frame walks (here and in `GiVolume`) iterate an array rather than
   * minting a Map iterator each.
   */
  private readonly carriedList: RoomLight[] = [];
  private active: PointLightData[] = [];
  /**
   * `update`'s nearest-first pick: a fixture is taken this frame when its
   * entry equals `takenFrame`, so nothing is cleared or allocated per frame.
   * Holes read `undefined`, which no stamp equals.
   */
  private readonly takenStamp: number[] = [];
  private takenFrame = 0;
  private t = 0;
  /** The flicker phases. See `FLICKER_SEED`. */
  private rand: () => number = mulberry32(FLICKER_SEED);

  /**
   * Registers a fixture light for the current room. `fast` is for a light
   * whose bounce must follow it frame by frame rather than be averaged — see
   * `RoomLight.fast`; a lantern on a wall is not one.
   *
   * A fixture CASTS by default (`shadow: "fixture"`): it stands still, which
   * is what lets `LocalShadows` bake its world once. A light that is placed
   * like a fixture and then moved — a thrown fire — says `moving`; one that
   * should cast nothing says `none`. `spot` gives it a cone.
   */
  add(
    position: Vector3,
    colorHex: string,
    range: number,
    intensity: number,
    flicker: number,
    fast = false,
    opts: { shadow?: ShadowIntent; spot?: SpotCone } = {},
  ): RoomLight {
    const light: RoomLight = {
      position: position.clone(),
      color: Color3.FromHexString(colorHex),
      range,
      intensity,
      baseIntensity: intensity,
      flicker,
      phase: this.rand() * 100,
      fast,
      shadow: opts.shadow ?? "fixture",
      spot: opts.spot,
    };
    this.lights.push(light);
    this.fixtureSet++;
    return light;
  }

  /**
   * Takes one fixture out of the room — a thrown fire burning out. The light
   * is the object `add` returned; nothing else about it is looked up.
   */
  remove(light: RoomLight): void {
    const at = this.lights.indexOf(light);
    if (at >= 0) {
      this.lights.splice(at, 1);
      this.fixtureSet++;
    }
  }

  /**
   * Fires a short-lived light (muzzle flash, shockwave, impact). It casts
   * nothing unless `shadow` says so — a blast says `blast`, which the rungs
   * that shadow a transient at all honour.
   */
  pulse(
    position: Vector3,
    colorHex: string,
    range: number,
    intensity: number,
    life: number,
    shadow: ShadowIntent = "none",
  ): void {
    this.transient.push({
      position: position.clone(),
      color: Color3.FromHexString(colorHex),
      range,
      intensity,
      peak: intensity,
      t: 0,
      life,
      shadow,
    });
  }

  /**
   * Creates or moves a light attached to something that moves (the player's
   * shoulder lamp, a boss's aura). Carried lights never lose their slot —
   * they are the ones the player is actually reading the room by.
   *
   * Casts NOTHING by default: the two carried lights that exist ride the eye
   * (the shoulder lamp, the kit bench), and a light at the eye throws every
   * shadow directly behind what it lights. A torch held out front says
   * `moving`, and `spot` gives it its cone — the cone's axis is held by
   * reference, so a caller aims it by writing into its own vector.
   */
  setCarried(
    id: string,
    position: Vector3,
    colorHex: string,
    range: number,
    intensity: number,
    flicker = 0,
    // Optional rather than defaulted to `{}`: the kit stage calls this every
    // frame, and a default object literal is one minted per call.
    opts?: { shadow?: ShadowIntent; spot?: SpotCone },
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
        phase: this.rand() * 100,
        // Carried means it moves with a body, which is the definition.
        fast: true,
        shadow: opts?.shadow ?? "none",
        spot: opts?.spot,
      };
      this.carried.set(id, light);
      this.carriedList.push(light);
      return;
    }
    light.position.copyFrom(position);
    light.range = range;
    light.baseIntensity = intensity;
    if (opts?.shadow) light.shadow = opts.shadow;
    if (opts?.spot) light.spot = opts.spot;
  }

  removeCarried(id: string): void {
    const light = this.carried.get(id);
    if (!light) return;
    this.carried.delete(id);
    this.carriedList.splice(this.carriedList.indexOf(light), 1);
  }

  /**
   * Drops every room light; carried lights survive between rooms.
   *
   * Re-seeds the flicker with it, for the reason `FLICKER_SEED` gives: a
   * fixture's phase is then a function of the map and its place in the layout,
   * rather than of how many rooms this process has already built.
   */
  clear(): void {
    this.lights.length = 0;
    this.fixtureSet++;
    this.transient.length = 0;
    this.rand = mulberry32(FLICKER_SEED);
  }

  /** See `fixtureSet`: changes whenever `fixtures` gains or loses a light. */
  get fixtureVersion(): number {
    return this.fixtureSet;
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

  /**
   * The live transient pulses — muzzle flashes, blasts — at this frame's
   * decayed intensity. For `GiVolume`'s fast layer, which bounces them;
   * read-only for the reason `fixtures` is.
   */
  get transients(): readonly PointLightData[] {
    return this.transient;
  }

  /** The carried lights, for the same reader. */
  get carriedLights(): readonly RoomLight[] {
    return this.carriedList;
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
    for (const l of this.carriedList) this.tickFlicker(l);

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
    for (const l of this.carriedList) this.active.push(l);

    if (this.lights.length <= MAX_POINT_LIGHTS - this.active.length) {
      for (const l of this.lights) this.active.push(l);
    } else {
      // Partial selection: repeatedly take the nearest not-yet-taken light.
      // Cheaper than sorting the whole list and the counts here are small.
      // `taken` is a STAMP per fixture rather than a Set built per frame: this
      // branch runs every frame on any map with more fixtures than free slots.
      const slots = MAX_POINT_LIGHTS - this.active.length;
      const taken = this.takenStamp;
      const stamp = ++this.takenFrame;
      for (let s = 0; s < slots; s++) {
        let best = -1;
        let bestScore = Infinity;
        for (let i = 0; i < this.lights.length; i++) {
          if (taken[i] === stamp) continue;
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
        taken[best] = stamp;
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
