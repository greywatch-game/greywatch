/**
 * RotorWash.ts — What a helicopter does to the ground when it comes down: one
 * standing ring of puffs per rotor on the field, driven by how hard that rotor
 * is working the surface under it, and made of whatever that surface is.
 * Owns: two `GPUParticleSystem`s per hull in the fleet that has a rotor — the
 * dust ring and the spray ring — the puff texture they share, the colours the
 * map gives them, and the list of sites the WATER's own shader draws its half
 * from. Owns NO vehicle: it holds the fleet the way `RayWorld` holds the hulls
 * — handed the list once per map install by `Game`, and asking each one a
 * single question a frame.
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
 *   roof, a hardstanding, the bay — which is what `washTo` hands back with the
 *   strength.
 * - **Nothing is scheduled and nothing is spawned.** The systems are started
 *   once and never stopped; a hull that is high, dead, spooled down or has no
 *   rotor at all is one whose emitters are running at a rate of zero. That is
 *   `Sfx`'s own invariant for the held-open ambience voices, and it is here for
 *   the same reason: the cost of a wash must not be paid on the frame a pilot
 *   flares, which is a frame that already has a landing in it.
 *
 * ## Water is a SECOND RING, and the surface picks which one is running
 *
 * A rotor over the bay tears a hole in it and throws SPRAY, which is a
 * different material and therefore a different sprite's worth of numbers: it
 * goes out harder, lives about half as long, grows about half as much, is
 * brighter, and FALLS rather than rising. So a machine gets TWO rings built on
 * the same map install, exactly one of them is ever emitting, and which one is
 * the surface's answer rather than a decision — `surfaceOver` asks the map's
 * `WaterRect`s where the landing point is, and everything downstream of that
 * follows from `washTo` being asked a second time with the water's own height
 * as its floor.
 *
 * **That second call is what stops a hover over a harbour reading as a hover
 * over a mudflat.** Water is not in the terrain field and not in the obstacle
 * field, so the skyline under a machine over the bay is the BED — on
 * Cinderhaven that is two and a half metres of error in the one number the
 * whole effect is a function of. The floor is raised to the surface and the
 * hull is asked again, which keeps the fall-off curve, the rotor power and the
 * skid clearance inside `Vehicle` where the rest of the machine already is.
 *
 * The HEIGHT half of the water test is what makes it a test rather than a
 * footprint: a jetty, a quay wall or a beached hull inside a rect stands above
 * the surface, and a machine over one of those is over something dry and gets
 * the dust.
 *
 * ## The RIPPLE is the water's, and this file only says where
 *
 * The other half of a downwash on water is not a particle at all — it is the
 * surface itself going matte, foaming and throwing a wake — and that is drawn
 * by `WaterShader`, because it is made of the same normal, the same mirror and
 * the same foam mix the surface already has. What this class publishes is the
 * SITE (`sites`/`siteCount`: x, z, the ring's radius and how hard, per rotor),
 * and it publishes it because it is already asking each machine the only
 * question the shader needs. `Game` hands it to `WaterSystem.setWash` on the
 * line under `update`, which is what keeps the two halves of one wash from
 * being a frame apart.
 *
 * ## What it does not do
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

/** One rotor's two rings, and the hull they stand under. */
interface Wash {
  /** Dry ground. Always built: every map has some. */
  dust: GPUParticleSystem;
  /**
   * Water. Null on a map with no `WaterEnvSpec` — there is nothing to colour
   * it from and no surface for it to be thrown off, so it is not built at all
   * rather than built and left silent.
   */
  spray: GPUParticleSystem | null;
  /** Null for a slot the current map has no machine for. */
  hull: Vehicle | null;
  /**
   * The ring's radius: the disc's own, and the same number the water's ripple
   * is handed, so the rim of the hole and the ring of particles standing on it
   * are one circle rather than two that agree.
   */
  radius: number;
}

/**
 * A water body flattened to what the surface test needs: the rect, and the
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

/**
 * What a map's rings are made of. Both pairs, because both are fixed when a
 * ring is BUILT — see `paint` — so this is what `build` compares to decide
 * whether the fleet's rings can be kept.
 */
interface Palette {
  dust: Color3;
  /**
   * Whitewater over the body of the bay, or null on a map with no water
   * palette at all. Its presence is what decides whether spray rings exist,
   * which is why it is part of the comparison and not merely part of the
   * colour: a dry map's rings and a wet map's rings are different objects.
   */
  spray: [light: Color3, dark: Color3] | null;
}

export class RotorWash {
  private readonly washes: Wash[] = [];
  private readonly pools: Pool[] = [];
  private texture: DynamicTexture | null = null;
  /**
   * The map's colours, and the reason they are held rather than pushed.
   *
   * **A ring's colour is fixed when it is BUILT and may never be written
   * again** — see `buildRing`, where the fade is a colour GRADIENT and a
   * gradient is only safe before a system's first render. So this is compared
   * on every `build` and a map whose dust or whose water is a different colour
   * gets fresh rings, which is the one thing that ever disposes one inside a
   * session. Null until the first map has landed.
   */
  private palette: Palette | null = null;

  /** Where `washTo` puts the surface under a hull. One scratch, reused. */
  private readonly at = new Vector3();

  /**
   * The rotors currently working water, packed as `WaterShader` wants them —
   * four floats a site, x/z/radius/strength — and read by `Game` on the line
   * under `update`. Fixed length, filled from the front, valid up to
   * `siteCount`; the tail is stale and the shader never looks at it.
   */
  private readonly washSites = new Float32Array(CONFIG.water.wash.sites * 4);
  private washCount = 0;

  constructor(private readonly scene: Scene) {}

  /** The packed sites. Valid up to `siteCount`; see `washSites`. */
  get sites(): Float32Array {
    return this.washSites;
  }

  /** How many of `sites` this frame filled. */
  get siteCount(): number {
    return this.washCount;
  }

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
    // **The colours arrive with the fleet rather than in a call of their own**,
    // and that is the gradient's doing: a ring cannot be re-coloured after it
    // has drawn a frame (`buildRing`), so the only safe moment to decide what
    // this map's dust and spray are made of is the moment its rings are made.
    // A map with the same floor, the same key light and the same water keeps
    // the rings it had.
    const palette = this.paletteFor(env);
    if (!this.samePalette(palette)) {
      this.disposeRings();
      this.palette = palette;
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
      this.silence(wash);
      wash.dust.reset();
      wash.spray?.reset();
    }
    this.washCount = 0;
    let i = 0;
    for (const hull of hulls) {
      // **`flies` and not a wash-shaped flag of its own.** A rotor is what
      // holds a flying hull up and what moves the air under it, so the
      // capability the rest of the game already asks about is exactly the one
      // that answers here — `Vehicle.washTo` returns 0 for everything else, and
      // a second boolean would only be a way for the two to disagree.
      if (!hull.flies) continue;
      if (i === this.washes.length) {
        this.washes.push({
          dust: this.buildRing(i, false),
          spray: palette.spray ? this.buildRing(i, true) : null,
          hull: null,
          radius: 0,
        });
      }
      const wash = this.washes[i++];
      wash.hull = hull;
      // The ring is the DISC, which is the number the world already reads off
      // this drawing (`drive.collideRadius`, and see its note). `spread` is how
      // far past the edge of it the dust is by the time it is lit.
      wash.radius = hull.spec.drive.collideRadius * CONFIG.vehicles.wash.spread;
      (wash.dust.particleEmitterType as CylinderParticleEmitter).radius =
        wash.radius;
      if (wash.spray) {
        (wash.spray.particleEmitterType as CylinderParticleEmitter).radius =
          wash.radius;
      }
    }
  }

  /**
   * One frame: every ring told how hard its machine is working the surface
   * under it, and the water told where the holes are.
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
    let sites = 0;
    for (const wash of this.washes) {
      const hull = wash.hull;
      const strength = stepped && hull ? hull.washTo(this.at) : 0;
      if (!hull || strength <= 0) {
        this.silence(wash);
        continue;
      }
      // The one question that decides which material this wash is made of.
      // NaN — deliberately, rather than a sentinel height — because there is
      // no number that means "there is no water here" on a map whose sea can
      // sit below zero.
      const surface = this.surfaceOver();
      if (Number.isNaN(surface) || !wash.spray) {
        this.silence(wash);
        this.drive(wash.dust, strength, w.rate, w.speed);
        continue;
      }
      // Asked a SECOND time with the water's own height as the floor, which
      // re-places `at` on the surface and re-reads the fall-off against the
      // clearance a pilot can actually see. See `Vehicle.washTo`.
      const wet = hull.washTo(this.at, surface);
      this.silence(wash);
      if (wet <= 0) continue;
      this.drive(wash.spray, wet, w.spray.rate, w.spray.speed);
      // And the surface's own half of it. The list is filled from the front
      // and bounded by the shader's array: on every shipped map that is two
      // machines against four slots, and a map that fielded more would drop
      // the ones it could not draw rather than corrupting the ones it can.
      if (sites < CONFIG.water.wash.sites) {
        const at = sites * 4;
        this.washSites[at] = this.at.x;
        this.washSites[at + 1] = this.at.z;
        this.washSites[at + 2] = wash.radius;
        this.washSites[at + 3] = wet;
        sites++;
      }
    }
    this.washCount = sites;
  }

  /**
   * Both of a wash's rings at a rate of zero. It is called on the way in to
   * every arm rather than in the arms that need it, because the two rings are
   * EXCLUSIVE and the failure of forgetting one is a machine dragging a ring
   * of dust across the bay behind its spray.
   */
  private silence(wash: Wash): void {
    wash.dust.emitRate = 0;
    if (wash.spray) wash.spray.emitRate = 0;
  }

  /**
   * One ring, told how hard it is being worked.
   *
   * Harder down, harder out. The ring a machine settling onto its skids throws
   * is not the one a hover-taxi drags along the street, and the rate alone says
   * only that there is more of it.
   */
  private drive(
    system: GPUParticleSystem,
    strength: number,
    rate: number,
    speed: number,
  ): void {
    (system.emitter as Vector3).copyFrom(this.at).y +=
      CONFIG.vehicles.wash.lift;
    system.emitRate = rate * strength;
    const out = speed * (0.35 + 0.65 * strength);
    system.minEmitPower = out * 0.45;
    system.maxEmitPower = out;
  }

  /**
   * The height of the water over the point `washTo` just found, or NaN when
   * that point is dry.
   *
   * The HEIGHT half is what makes it a test rather than a footprint: a jetty, a
   * quay wall or a beached hull inside a rect stands above the surface, and a
   * machine over one of those is over something dry. A loop over the rects
   * because there are eight of them on the biggest map in the tree and at most
   * two of these questions a frame.
   */
  private surfaceOver(): number {
    for (const p of this.pools) {
      if (this.at.x < p.minX || this.at.x > p.maxX) continue;
      if (this.at.z < p.minZ || this.at.z > p.maxZ) continue;
      if (this.at.y < p.surface) return p.surface;
    }
    return NaN;
  }

  /**
   * What this map's rings would be made of.
   *
   * Dust is the map's FLOOR lifted toward its key light, because a wash is the
   * ground itself four metres from the eye — `BlastDebrisSystem`'s own call for
   * the rubble a blast tears out, and NOT `BlastDust`'s mist, which is what a
   * cloud is by the time it is read at a distance.
   *
   * Spray is that sentence one map layer over: it is the WATER it came off, so
   * the pair is the map's whitewater over the body of its bay. `foamColor` is
   * exactly what the surface's own crests and shoreline are drawn in, so the
   * sheet a rotor throws and the froth it is tearing out of cannot disagree;
   * the dark half is that lifted halfway from `shallowColor`, which is the
   * shoal a rotor is standing over rather than the channel it is beside.
   *
   * **And the water's pair is LIT on the way in where the dust's is not,
   * which is a fact about foam rather than an inconsistency.** A particle is
   * unlit — nothing in either ring reads a light — so whatever colour it is
   * handed is the colour it is on screen, and a colour taken off an
   * `EnvironmentSpec` is an ALBEDO the cel shader would have multiplied by the
   * map's own light. The dust gets away with ignoring that because
   * `floorColor` carries most of a map's darkness with it: a night map's
   * ground is authored dark and its dust comes out dark. **`foamColor` is
   * near-white on every map by construction**, because that is what froth is,
   * so it carries none of it — raw, a rotor over Cinderhaven's bay at night
   * threw a ring of daylight-white spray onto a surface whose own foam was
   * being drawn at about half that. `surfaceLight` is the correction and it is
   * the water shader's own three terms.
   */
  private paletteFor(env: EnvironmentSpec): Palette {
    const w = CONFIG.vehicles.wash;
    const dust = Color3.Lerp(
      Color3.FromHexString(env.floorColor),
      Color3.FromHexString(env.lighting.color),
      w.lit,
    );
    const water = env.water;
    if (!water) return { dust, spray: null };
    const lit = this.surfaceLight(env);
    const foam = Color3.FromHexString(water.foamColor).multiply(lit);
    const body = Color3.FromHexString(water.shallowColor).multiply(lit);
    return { dust, spray: [foam, Color3.Lerp(body, foam, 0.5)] };
  }

  /**
   * What the map's light does to a HORIZONTAL surface, as one multiplier.
   *
   * It is `WaterShader`'s own three terms with the two banded ones taken at
   * the value a flat surface gets: the ambient whole, the sky fill whole —
   * that shader's note, "water is the most up-facing surface on any map, so it
   * takes essentially all of it" — and the key by how far above the horizon it
   * is, which is `-direction.y` because `lighting.direction` is where the
   * light TRAVELS. The bands themselves are deliberately not reproduced: a
   * quantised step is a thing a lit SURFACE does, and a puff of spray is not
   * one.
   *
   * Clamped, because a bright map's sum passes 1 and a colour cannot.
   */
  private surfaceLight(env: EnvironmentSpec): Color3 {
    const l = env.lighting;
    const lit = Color3.FromHexString(l.ambientColor).scale(l.ambientIntensity);
    lit.addInPlace(
      Color3.FromHexString(l.skyLightColor).scale(l.skyLightIntensity),
    );
    const up = Math.max(0, -l.direction[1]);
    lit.addInPlace(Color3.FromHexString(l.color).scale(l.intensity * up));
    lit.r = Math.min(1, lit.r);
    lit.g = Math.min(1, lit.g);
    lit.b = Math.min(1, lit.b);
    return lit;
  }

  /** Whether the standing rings were built for this map's colours. */
  private samePalette(next: Palette): boolean {
    const held = this.palette;
    if (!held || !held.dust.equals(next.dust)) return false;
    if (!held.spray || !next.spray) return held.spray === next.spray;
    return (
      held.spray[0].equals(next.spray[0]) && held.spray[1].equals(next.spray[1])
    );
  }

  /**
   * One ring: a flat cylinder of puffs thrown radially outward, started here
   * and never stopped.
   *
   * `wet` is the whole of what a spray ring is: `CONFIG.vehicles.wash.spray`
   * carries the six numbers that are about the MATERIAL — how much, how long,
   * how fast, which way, how big, how bright — and everything else in this
   * method is about the shape of a rotor ring and is therefore the same for
   * both. See that block for why those six and no others.
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
  private buildRing(index: number, wet: boolean): GPUParticleSystem {
    const w = CONFIG.vehicles.wash;
    const s = w.spray;
    const life = wet ? s.life : w.life;
    const system = new GPUParticleSystem(
      `rotor${wet ? "Spray" : "Wash"}${index}`,
      {
        capacity: Math.ceil((wet ? s.rate : w.rate) * life),
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
    system.minLifeTime = life * 0.7;
    system.maxLifeTime = life;
    // A flat RING rather than a filled disc: `radiusRange` 0.5 puts every puff
    // in the outer half of the circle, which is where the air leaving a rotor
    // meets the surface. The radius itself is per hull and is set in `build`.
    system.createCylinderEmitter(1, 0.4, 0.5, 0.4);
    // Dust rises because it is fine enough for the outflow's curl to carry it;
    // spray is thrown and then falls, which is the one number in the pair with
    // an opposite SIGN rather than a different size.
    system.gravity = new Vector3(0, wet ? s.rise : w.rise, 0);
    // Thrown out hard and slowing, but never to nothing — the disc over it is
    // still pushing, which is the blast dust's `settle` read for a source that
    // has not gone away.
    system.addVelocityGradient(0, 1);
    system.addVelocityGradient(0.4, 0.6);
    system.addVelocityGradient(1, w.settle);
    const from = wet ? s.sizeStart : w.sizeStart;
    const to = wet ? s.sizeEnd : w.sizeEnd;
    system.addSizeGradient(0, from, from * (1 + w.sizeSpread));
    system.addSizeGradient(1, to, to * (1 + w.sizeSpread));
    system.minInitialRotation = 0;
    system.maxInitialRotation = Math.PI * 2;
    system.minAngularSpeed = -0.5;
    system.maxAngularSpeed = 0.5;
    this.paint(system, wet);
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
   * offered to a frame — and a map whose colours are different gets NEW rings
   * rather than a repaint, which is what `build` compares the palette for.
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
   *
   * The two-tone pair is the same idea on both materials and is arrived at two
   * ways: dust darkens its own tint, because a cloud of one substance is the
   * lit and unlit sides of itself, and spray is handed a pair by the map,
   * because what the unlit side of whitewater is showing is the water under it.
   */
  private paint(system: GPUParticleSystem, wet: boolean): void {
    const w = CONFIG.vehicles.wash;
    const spray = wet ? this.palette?.spray : null;
    const t = this.palette?.dust ?? new Color3(0.6, 0.58, 0.54);
    const lightRgb = spray ? spray[0] : t;
    const darkRgb = spray
      ? spray[1]
      : new Color3(t.r * 0.5, t.g * 0.5, t.b * 0.58);
    const peak = wet ? w.spray.opacity : w.opacity;
    const light = (a: number) =>
      new Color4(lightRgb.r, lightRgb.g, lightRgb.b, a);
    const dark = (a: number) => new Color4(darkRgb.r, darkRgb.g, darkRgb.b, a);
    system.addColorGradient(0, light(0), dark(0));
    system.addColorGradient(w.fadeIn, light(peak), dark(peak * 0.72));
    system.addColorGradient(1, light(0), dark(0));
  }

  private disposeRings(): void {
    for (const wash of this.washes) {
      wash.dust.dispose(false);
      wash.spray?.dispose(false);
    }
    this.washes.length = 0;
  }

  dispose(): void {
    this.disposeRings();
    this.pools.length = 0;
    this.washCount = 0;
    this.texture?.dispose();
    this.texture = null;
  }
}
