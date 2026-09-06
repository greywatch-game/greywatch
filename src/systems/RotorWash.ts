/**
 * RotorWash.ts — The dust a helicopter throws up when it comes down: one
 * standing ring of puffs per rotor on the field, driven by how hard that rotor
 * is working the ground under it.
 * Owns: one `GPUParticleSystem` per hull in the fleet that has a rotor, the
 * puff texture they share, and the tint the map gives them. Owns NO vehicle: it
 * holds the fleet the way `RayWorld` holds the hulls — handed the list once per
 * map install by `Game`, and asking each one a single question a frame.
 * Invariants: fixed capacity per emitter, allocated on a map install and never
 * inside a round; nothing per frame but two numbers and a position.
 *
 * ## It is a FOUNTAIN, and that is the whole difference from the blast's dust
 *
 * `GrenadeSystem`'s `BlastDust` is the same idea spent the other way: a pool of
 * clouds, each `manualEmitCount` puffs at once, `emitRate` pinned at zero
 * because a rate is exactly what would turn a burst into a fountain standing
 * wherever the last grenade went off. A downwash IS that fountain — it stands
 * under a machine for as long as the machine is low, and it is the one dust in
 * this game with no event behind it — so this is the class that could not have
 * been the other one with different numbers:
 *
 * - **The rate is the signal.** `Vehicle.washTo` answers 0..1 and it is spent
 *   on `emitRate`, so how much dust there is IS how hard the disc is working
 *   the street. Nothing here decides anything about a helicopter.
 * - **The emitter follows the GROUND, not the hull.** A puff is born on a ring
 *   the width of the disc, on whatever is under the machine — the street, a
 *   roof, a hardstanding — which is what `washTo` hands back with the strength.
 * - **Nothing is scheduled and nothing is spawned.** The systems are started
 *   once and never stopped; a hull that is high, dead, spooled down or has no
 *   rotor at all is one whose emitter is running at a rate of zero. That is
 *   `Sfx`'s own invariant for the held-open ambience voices, and it is here for
 *   the same reason: the cost of a wash must not be paid on the frame a pilot
 *   flares, which is a frame that already has a landing in it.
 *
 * ## What it does not do
 *
 * **Water gets nothing.** A rotor over the bay ought to tear a hole in it and
 * throw spray, and spray is a different sprite, a different colour and a
 * different fade — so what is here is the honest half of the answer: dust comes
 * off dry ground, and a machine over water raises none. Cinderhaven is the map
 * that made that a rule rather than a nicety, being the one with both a harbour
 * and a helicopter on it.
 *
 * **There is no fog on it**, exactly as there is none on the blast's dust: the
 * tint is a map-wide constant off the environment rather than a distance. A
 * wash stands under a machine the player is either flying or being strafed by,
 * so the range at which the approximation would show is a range at which there
 * is no wash to look at.
 *
 * **It never runs on the authority.** Nothing here is simulation — no ray, no
 * damage, no bearing — and it needs both a canvas and a GPU device, which is
 * `BlastDust`'s split (`{ dust: false }`) drawn one system further out: the
 * server does not construct this class at all.
 */
import {
  Color3,
  Color4,
  type CylinderParticleEmitter,
  type DynamicTexture,
  GPUParticleSystem,
  type Scene,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Vehicle } from "../entities/Vehicle";
import type { EnvironmentSpec } from "../world/environment";
import type { WaterRect } from "../world/MapBuilder";
import { waterY, type TerrainField } from "../world/TerrainField";
import { buildPuffTexture } from "./puffTexture";

/** One rotor's ring, and the hull it stands under. */
interface Wash {
  system: GPUParticleSystem;
  /** Null for a slot the current map has no machine for. */
  hull: Vehicle | null;
}

/**
 * A water body flattened to what the suppression test needs: the rect, and the
 * height its surface actually ended up at.
 *
 * Resolved once per map install rather than per frame, which is what lets this
 * file hold no `TerrainField` — `waterY` needs one, and a rect does not move.
 */
interface Pool {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  surface: number;
}

export class RotorWash {
  private readonly washes: Wash[] = [];
  private readonly pools: Pool[] = [];
  private texture: DynamicTexture | null = null;
  /**
   * The map's dust colour, and the reason it is held rather than pushed.
   *
   * **A ring's colour is fixed when it is BUILT and may never be written
   * again** — see `buildRing`, where the fade is a colour GRADIENT and a
   * gradient is only safe before a system's first render. So this is compared
   * on every `build` and a map whose dust is a different colour gets fresh
   * rings, which is the one thing that ever disposes one inside a session.
   * Null until the first map has landed.
   */
  private tint: Color3 | null = null;

  /** Where `washTo` puts the ground under a hull. One scratch, reused. */
  private readonly at = new Vector3();

  constructor(private readonly scene: Scene) {}

  /**
   * Points the rings at a freshly built fleet.
   *
   * The pool GROWS and never shrinks: an emitter is generic — its capacity, its
   * life and its gradients are `CONFIG.vehicles.wash`'s and the same on every
   * kind — so the only thing a map install changes is which hull each one
   * follows and how wide its ring is. That is the opposite of `Atmosphere.fit`'s
   * rebuild, and it is the opposite because the reason there was a per-map
   * CAPACITY: here the size is a constant and a rebuild would buy nothing but
   * the churn.
   *
   * Every ring is reset whichever way the count went, for `BlastDust.reset`'s
   * reason: a cloud left standing over terrain that no longer exists is what an
   * editor rebuild would otherwise hang in the air.
   */
  build(
    hulls: readonly Vehicle[],
    water: readonly WaterRect[],
    terrain: TerrainField,
    env: EnvironmentSpec,
  ): void {
    // **The colour arrives with the fleet rather than in a call of its own**,
    // and that is the gradient's doing: a ring cannot be re-coloured after it
    // has drawn a frame (`buildRing`), so the only safe moment to decide what
    // this map's dust is made of is the moment its rings are made. A map with
    // the same floor and the same key light keeps the rings it had.
    const tint = Color3.Lerp(
      Color3.FromHexString(env.floorColor),
      Color3.FromHexString(env.lighting.color),
      CONFIG.vehicles.wash.lit,
    );
    if (!this.tint || !this.tint.equals(tint)) {
      for (const wash of this.washes) wash.system.dispose(false);
      this.washes.length = 0;
      this.tint = tint;
    }
    this.pools.length = 0;
    for (const r of water) {
      this.pools.push({
        minX: r.x - r.width / 2,
        maxX: r.x + r.width / 2,
        minZ: r.z - r.depth / 2,
        maxZ: r.z + r.depth / 2,
        surface: waterY(r, terrain),
      });
    }

    for (const wash of this.washes) {
      wash.hull = null;
      wash.system.emitRate = 0;
      wash.system.reset();
    }
    let i = 0;
    for (const hull of hulls) {
      // **`flies` and not a wash-shaped flag of its own.** A rotor is what
      // holds a flying hull up and what moves the air under it, so the
      // capability the rest of the game already asks about is exactly the one
      // that answers here — `Vehicle.washTo` returns 0 for everything else, and
      // a second boolean would only be a way for the two to disagree.
      if (!hull.flies) continue;
      if (i === this.washes.length) {
        this.washes.push({ system: this.buildRing(i), hull: null });
      }
      const wash = this.washes[i++];
      wash.hull = hull;
      // The ring is the DISC, which is the number the world already reads off
      // this drawing (`drive.collideRadius`, and see its note). `spread` is how
      // far past the edge of it the dust is by the time it is lit.
      const shape = wash.system.particleEmitterType as CylinderParticleEmitter;
      shape.radius =
        hull.spec.drive.collideRadius * CONFIG.vehicles.wash.spread;
    }
  }

  /**
   * One frame: every ring told how hard its machine is working the ground.
   *
   * `stepped` is `Game.fleetStepped` — did anything actually move the fleet
   * this frame — and it is here for `pushHullEngines`'s reason rather than by
   * analogy with it. A held world is a fleet frozen mid-air, and a machine
   * hanging motionless over a street it is still boiling is the same lie the
   * droning engine under the deploy card was. What is already ALOFT is left to
   * drift and fade on the GPU's own clock, which is what the mote field does
   * under the same card and is the honest half: dust that has left the ring is
   * no longer being pushed by anything.
   *
   * The emitter properties written here are the three the GPU update shader
   * reads inside its EMISSION branch, so they may move freely from frame to
   * frame — see `BlastDust.burst`, which rests on exactly that: the puffs
   * already in the air were sized and thrown when they were born and are not
   * re-thrown under a machine that has since climbed away.
   */
  update(stepped: boolean): void {
    const w = CONFIG.vehicles.wash;
    for (const wash of this.washes) {
      const hull = wash.hull;
      const strength = stepped && hull ? hull.washTo(this.at) : 0;
      if (strength <= 0 || this.overWater()) {
        wash.system.emitRate = 0;
        continue;
      }
      (wash.system.emitter as Vector3).copyFrom(this.at).y += w.lift;
      wash.system.emitRate = w.rate * strength;
      // Harder down, harder out. The ring a machine settling onto its skids
      // throws is not the one a hover-taxi drags along the street, and the rate
      // alone says only that there is more of it.
      const speed = w.speed * (0.35 + 0.65 * strength);
      wash.system.minEmitPower = speed * 0.45;
      wash.system.maxEmitPower = speed;
    }
  }

  /**
   * Is the ground `washTo` just found under water? See the header: dust comes
   * off dry ground and spray is not built.
   *
   * The HEIGHT half is what makes it a test rather than a footprint: a jetty, a
   * quay wall or a beached hull inside a rect stands above the surface, and a
   * machine over one of those is over something dry. A loop over the rects
   * because there are eight of them on the biggest map in the tree and at most
   * two of these questions a frame.
   */
  private overWater(): boolean {
    for (const p of this.pools) {
      if (this.at.x < p.minX || this.at.x > p.maxX) continue;
      if (this.at.z < p.minZ || this.at.z > p.maxZ) continue;
      if (this.at.y < p.surface) return true;
    }
    return false;
  }

  /**
   * One ring: a flat cylinder of puffs thrown radially outward, started here
   * and never stopped.
   *
   * `emitRateControl` for `Atmosphere.fit`'s reason, and it is the mode this
   * class could not do without: it is the only one in which the emission
   * accumulator answers to `emitRate` frame by frame, so a rate driven to zero
   * by a machine climbing away actually stops rather than banking up emissions
   * to spend the moment it comes back down.
   *
   * The capacity is `rate * life` — every slot a life can still be running in
   * at the highest rate this ring will ever be asked for — so the recycle comes
   * round exactly as the oldest puff fades, which is the wrap invariant that
   * file spells out. Below full strength the pointer comes round SLOWER than a
   * life, which is the safe side of it.
   */
  private buildRing(index: number): GPUParticleSystem {
    const w = CONFIG.vehicles.wash;
    const system = new GPUParticleSystem(
      `rotorWash${index}`,
      {
        capacity: Math.ceil(w.rate * w.life),
        emitRateControl: true,
        // `BlastDust`'s note: the default is the engine's max texture size,
        // which is half a megabyte of VRAM and ~131,000 `Math.random()` calls
        // to seed a hundred puffs.
        randomTextureSize: 4096,
      },
      this.scene,
    );
    this.texture ??= buildPuffTexture(this.scene, "rotorWash");
    system.particleTexture = this.texture;
    system.emitter = new Vector3();
    system.blendMode = GPUParticleSystem.BLENDMODE_STANDARD;
    system.updateSpeed = 1 / 60;
    system.emitRate = 0;
    system.minLifeTime = w.life * 0.7;
    system.maxLifeTime = w.life;
    // A flat RING rather than a filled disc: `radiusRange` 0.5 puts every puff
    // in the outer half of the circle, which is where the air leaving a rotor
    // meets the ground. The radius itself is per hull and is set in `build`.
    system.createCylinderEmitter(1, 0.4, 0.5, 0.4);
    system.gravity = new Vector3(0, w.rise, 0);
    // Thrown out hard and slowing, but never to nothing — the disc over it is
    // still pushing, which is the blast dust's `settle` read for a source that
    // has not gone away.
    system.addVelocityGradient(0, 1);
    system.addVelocityGradient(0.4, 0.6);
    system.addVelocityGradient(1, w.settle);
    system.addSizeGradient(0, w.sizeStart, w.sizeStart * (1 + w.sizeSpread));
    system.addSizeGradient(1, w.sizeEnd, w.sizeEnd * (1 + w.sizeSpread));
    system.minInitialRotation = 0;
    system.maxInitialRotation = Math.PI * 2;
    system.minAngularSpeed = -0.5;
    system.maxAngularSpeed = 0.5;
    this.paint(system);
    system.start();
    return system;
  }

  /**
   * The colour of one ring, as a three-stop GRADIENT over a puff's life: up
   * from nothing, then down to nothing.
   *
   * ## The fade IN is why this is a gradient at all
   *
   * `color1`/`color2` are a puff's colour AT BIRTH and the only fade they can
   * buy is linear from there to `colorDead` — so a puff arrives at full
   * opacity and every one of the ninety a second SWITCHES ON in the air. On a
   * burst that is invisible, because everything is born on one frame and what
   * a viewer reads is the cloud; on a fountain it is the whole texture of the
   * effect, and it read as the dust popping in.
   *
   * ## Which is safe here and is NOT safe on the blast's clouds
   *
   * `BlastDust` states that `addColorGradient` on a GPU system takes the whole
   * scene's rendering down on the next frame, and it is right about what it
   * measured — but the rule underneath it is narrower, and it is the rule that
   * lets this file have what that one cannot. **A gradient texture changes the
   * VERTEX BUFFER LAYOUT**: with one, the per-particle `color` attribute is
   * gone and the shader samples the gradient instead
   * (`gpuParticleSystem.pure.js`, `_GetAttributeNamesOrOptions` and the
   * `!this._colorGradientsTexture` guards around the buffer build). Those
   * buffers are built by `_initialize()` on the system's FIRST RENDER and
   * never again, while the gradient texture is created whenever the update
   * effect is next recreated. So a gradient added to a system that has already
   * drawn leaves the buffers and the effect disagreeing about the vertex
   * format, which on WebGPU is not a wrong colour but a dead scene.
   *
   * **So the rule is "before the first render", not "never"**, and everything
   * about the way this class is wired is that rule: gradients are added here,
   * inside the constructor path, before `start()` and before the ring has been
   * offered to a frame — and a map whose dust is a different colour gets NEW
   * rings rather than a repaint, which is what `build` compares the tint for.
   * `BlastDust` re-tints per install on systems that have been drawing since
   * the `Game` was constructed, so for that class the conclusion stands
   * unchanged.
   *
   * ## What the stops are
   *
   * Two per stop, because the gradient texture carries the light and the dark
   * halves of the pair as two rows and the shader lerps them by the particle's
   * own seed — so the per-puff variation `color1`/`color2` used to give is
   * kept exactly, ramp and all. RGB is the same at every stop and only the
   * alpha moves: a puff that changed COLOUR as it faded would be dust turning
   * into something else. `colorDead` is deliberately not set — with a gradient
   * texture the shader never reads it.
   */
  private paint(system: GPUParticleSystem): void {
    const w = CONFIG.vehicles.wash;
    const t = this.tint ?? new Color3(0.6, 0.58, 0.54);
    const light = (a: number) => new Color4(t.r, t.g, t.b, a);
    const dark = (a: number) => new Color4(t.r * 0.5, t.g * 0.5, t.b * 0.58, a);
    system.addColorGradient(0, light(0), dark(0));
    system.addColorGradient(w.fadeIn, light(w.opacity), dark(w.opacity * 0.72));
    system.addColorGradient(1, light(0), dark(0));
  }

  dispose(): void {
    for (const wash of this.washes) wash.system.dispose(false);
    this.washes.length = 0;
    this.pools.length = 0;
    this.texture?.dispose();
    this.texture = null;
  }
}
