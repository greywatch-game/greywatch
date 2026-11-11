/**
 * Atmosphere.ts — One shared drifting-particle system (ash/embers/motes),
 * reconfigured per environment via apply(ParticleSpec). Texture is generated
 * at runtime. apply(undefined) stops the emitter.
 *
 * **The buffer is sized to the field, not the field clamped to the buffer.**
 * A GPU particle system's capacity is fixed at construction, so `fit()`
 * rebuilds the system whenever the spec asks for a different number of slots.
 * That is what keeps the recycling invariant below exact — the alternative,
 * running every map against one standing pool, is what made an overflowing
 * map pop its motes out instead of fading them.
 *
 * The simulation runs ON THE GPU, which is what makes a field of tens of
 * thousands cost what a thousand cost on the CPU — and since `BABYLON_EXIT.md`
 * X4.7c it is OUR renderer's (`render/ParticleDraw.ts`): a compute update and an
 * instanced draw, Babylon 9.28's `GPUParticleSystem` on
 * `ComputeShaderParticleSystem` ported exactly, its shaders as compiled, its
 * random textures and seeds, its clock (the animation ratio, `scene.getAnimationRatio()`'s
 * arithmetic on our frame since X5.4g) and its
 * emission. This file DECIDES the field — its box, its colours, its rate, its
 * lives, its blend — and never draws it; the field is a `ParticleField`, whose
 * names are Babylon's, so the arithmetic below did not move. Its mote TEXTURE is
 * ours too since X5.4d: a canvas painted here as the `DynamicTexture` it was
 * painted on, made our texture as Babylon made that one
 * (`TextureMaker.picture`).
 *
 * There is no CPU fallback and there is deliberately no capability check: the
 * game is WebGPU or nothing — `main.ts` gates the boot on `navigator.gpu` AND
 * an adapter, and registers the service worker before the `Game` precisely so
 * the install survives a machine where the scene throws. A branch that cannot
 * execute on any browser that can run this game is a branch nothing will ever
 * exercise, so it would rot.
 */
import { Color4, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { ParticleDraw } from "../render/ParticleDraw";
import type { ParticleField } from "../render/ParticleField";
import { type MadeTexture, newCanvas, SAMPLING, type TextureMaker } from "../render/TextureMaker";
import type { ParticleSpec } from "../world/environment";

/**
 * How long a mote lives. Named because the buffer is sized against the upper
 * bound: in emit-rate-controlled mode the system settles at
 * `emitRate * maxLifeTime` live slots.
 *
 * The two are also a SHAPE rather than two independent numbers. When the VRAM
 * ceiling bounds the buffer, `apply` shortens both by the same factor so the
 * spread of lives — and so how ragged the field's fading looks — survives; it
 * is `MIN_LIFE / MAX_LIFE` that is preserved, never `MIN_LIFE` itself.
 */
const MIN_LIFE = 6;
const MAX_LIFE = 14;

/**
 * Drifting motes filling the volume of the current room — spores, falling
 * ash, rising embers. It is what makes a big dark arena feel like it has air
 * in it rather than being a vacuum with walls, and at the ~650 motes the CPU
 * pool could hold it read as specks in the air rather than as air.
 *
 * One system is reused across rooms; the per-theme spec is re-applied on
 * every room build and the emitter box is resized to the new arena.
 */
export class Atmosphere {
  private system: ParticleField | null = null;
  /**
   * The standing system's capacity. Zero until the first spec arrives, which
   * is also what makes "no system yet" and "wrong size" one branch in `fit`.
   */
  private capacity = 0;
  /**
   * Half the side of the camera-local emit box, or null when the field is
   * emitted into the map as a whole.
   *
   * Held rather than re-read because `apply` runs once per `installMap` and
   * `update` runs every frame in every state: the per-frame half has to be a
   * field test and no spec lookup at all.
   */
  private follow: number | null = null;
  private texture: MadeTexture;

  constructor(
    /** Our renderer's particle fields, which step and draw the one built here. */
    private readonly draw: ParticleDraw,
    /** Our renderer's maker of the textures the game paints: the mote's. */
    private readonly textures: TextureMaker,
  ) {
    // Soft round mote, generated so the game still ships no image files.
    const size = 64;
    const canvas = newCanvas(size, size);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    // Flipped, no mips, sampled flat: `DynamicTexture.update()`'s defaults.
    this.texture = textures.picture({ label: "mote", canvas, flipY: true, mips: false, sampling: SAMPLING.flat });
  }

  /**
   * Builds the emitter at a given buffer size.
   *
   * `emitRateControl` is not a detail. In that mode the system holds
   * `emitRate * maxLifeTime` live slots and recycles them in a circular
   * buffer, which is the CPU class's own behaviour — and, load-bearingly, it
   * is the only mode in which a stopped system stops accumulating emissions.
   * Babylon's legacy GPU mode adds to the emit accumulator whether or not the
   * system is stopped, so `stop()` + `reset()` would empty the field and then
   * refill it over the next second. That pair is how a headless harness pins
   * the ash for a stable pixel diff (see `CLAUDE.md`), so the freeze has to
   * keep working: with emit-rate control the field goes empty and stays
   * empty, exactly as it did on the CPU path.
   */
  private build(capacity: number): ParticleField {
    // Its emitter is the origin until `apply` moves it, as `Vector3.Zero()` was.
    return this.draw.create("motes", { capacity }, this.texture);
  }

  /**
   * Returns a system whose buffer is exactly the size this field needs,
   * rebuilding the standing one if it is the wrong size.
   *
   * Capacity is fixed at construction, so a rebuild is the only way to have
   * one that matches — and it is affordable because it is **stable under an
   * unchanged spec by construction, not by care**: a map's `ParticleSpec` is a
   * module constant, so `wanted` comes out the same integer on every
   * `installMap`. Only a genuine
   * change of map or of the ceiling reaches the rebuild, where the world is
   * being rebuilt around it anyway and a field that refills over `MAX_LIFE`
   * seconds costs nothing anybody is looking at. (`applySky`'s identity check
   * rests on the same property of a map's environment.)
   *
   * Shrinking is the half that is easy to miss. Babylon only ever GROWS
   * `_currentActiveCount` and drops it on `reset()`, so without a rebuild a
   * sparser second map would emit at its own low rate while going on stepping
   * and drawing the dense map's slots for the rest of the session.
   */
  private fit(emitRate: number): ParticleField {
    const wanted = Math.min(
      Math.ceil(emitRate * MAX_LIFE),
      CONFIG.graphics.particlePoolCeiling,
    );
    if (this.system && this.capacity === wanted) return this.system;
    // The texture is this class's, generated once and shared by every field it
    // builds: the field's disposal releases its own buffers and nothing else.
    if (this.system) this.draw.dispose(this.system);
    this.capacity = wanted;
    this.system = this.build(wanted);
    return this.system;
  }

  /**
   * Rebuilds the mote field for a room; `undefined` (or a count of zero)
   * disables it.
   */
  apply(spec: ParticleSpec | undefined, width: number, depth: number): void {
    if (!spec || spec.count <= 0) {
      this.system?.stop();
      return;
    }

    // `count` is a density dial rather than a headcount. A mote lives ~10 s on
    // average, so a third of it per second holds about 3.3x it in the air at
    // once; what the buffer is sized against is the other product,
    // `emitRate * MAX_LIFE`, which is every slot a life can still be running in.
    const emitRate = spec.count / 3;
    const ps = this.fit(emitRate);

    // The emit box, and which of the two shapes it is.
    //
    // **The default is the map, and it is the shape that stopped scaling.**
    // A field emitted into `map.size` squared holds `count` motes over an area
    // that grew fourteen times between the first map and the current largest,
    // so the same number is two different densities and the big one is air
    // nobody can see. `ParticleSpec.volume` is the other shape: a box centred
    // on the eye, which spends the whole budget inside the view and makes
    // `count` mean motes per cubic metre on every map. See that field.
    //
    // The height band is world-absolute either way and deliberately does NOT
    // follow the camera. Dust sits in a layer over the ground; a band that
    // rode the eye would put motes level with a roof the moment somebody
    // climbed onto one, and none under them.
    const span = spec.volume === undefined ? 0 : Math.min(spec.volume, width);
    this.follow = span > 0 ? span / 2 : null;
    const hx = this.follow ?? width / 2 - 1;
    const hz = this.follow ?? depth / 2 - 1;
    ps.minEmitBox.set(-hx, 0.2, -hz);
    ps.maxEmitBox.set(hx, 11, hz);
    // A field that is NOT following goes back to the origin, or a map with no
    // volume inherits wherever the last map's eye left the emitter — the
    // system is reused across installs and only rebuilt when the buffer size
    // moves.
    if (this.follow === null) ps.emitter.set(0, 0, 0);

    const c = Color4.FromHexString(spec.color.padEnd(9, "f"));
    putColor(ps.color1, c.r, c.g, c.b, spec.emissive ? 0.85 : 0.5);
    putColor(ps.color2, c.r * 0.7, c.g * 0.7, c.b * 0.7, 0.3);
    putColor(ps.colorDead, c.r, c.g, c.b, 0);

    ps.minSize = spec.size * 0.6;
    ps.maxSize = spec.size * 1.8;
    ps.emitRate = emitRate;
    // **The wrap invariant.** Emit-rate control advances a circular write
    // pointer at `emitRate` over `capacity` slots, so it comes round every
    // `capacity / emitRate` seconds and a mote living longer than that is
    // re-emitted while still visible — popping out mid-fade. `fit` normally
    // makes that period exactly `MAX_LIFE`; when the VRAM ceiling bounded the
    // buffer instead, the lives come down to meet the buffer. Either way the
    // longest life a mote can draw and the wrap period are the same number.
    const maxLife = Math.min(MAX_LIFE, this.capacity / emitRate);
    ps.minLifeTime = MIN_LIFE * (maxLife / MAX_LIFE);
    ps.maxLifeTime = maxLife;
    warnIfCeilingClamped(emitRate, maxLife);
    // Embers add into the dark; ash and dust just occlude — Babylon's
    // `BLENDMODE_ADD` and `BLENDMODE_STANDARD`, the two a field of ours takes.
    ps.blendMode = spec.emissive ? "add" : "standard";

    // Slow lateral drift plus the theme's vertical motion.
    //
    // With no `drift` the two bounds are symmetric about zero, so a mote takes
    // a random lateral velocity and the field mills in place — still air. A
    // `drift` offsets both bounds by the same amount, which keeps the SPREAD
    // (the ±0.35 that makes a field look like separate specks rather than a
    // sheet) while moving the mean, so the whole field travels without any two
    // motes agreeing exactly. Turning it into a mean rather than a floor is
    // what stops a wind from also making the dust uniform.
    const rise = spec.riseSpeed;
    const [dx, dz] = spec.drift ?? [0, 0];
    ps.direction1.set(dx - 0.35, rise * 0.6, dz - 0.35);
    ps.direction2.set(dx + 0.35, rise * 1.4, dz + 0.35);
    ps.gravity.set(0, rise * 0.15, 0);
    ps.minEmitPower = 0.2;
    ps.maxEmitPower = 0.6;
    ps.updateSpeed = 0.012;

    ps.start();
  }

  /**
   * Centres a camera-local field on the eye. A no-op for a field emitted into
   * the map, which is every map that states no `volume`.
   *
   * **Called every frame in every state**, beside `mats.updateCamera` and
   * `culling.update` and for their reason: every state renders and only some
   * of them simulate, so a menu or a deploy screen with a live view behind it
   * would otherwise be offered whatever air the last live frame stood in —
   * which on a map big enough to need this is a hole where the dust is.
   *
   * Only X and Z. The height band is the ground's, not the eye's — see
   * `apply`.
   */
  update(eye: Vector3): void {
    if (this.follow === null || !this.system) return;
    const at = this.system.emitter;
    at.x = eye.x;
    at.z = eye.z;
  }

  dispose(): void {
    if (this.system) this.draw.dispose(this.system);
    this.system = null;
    this.capacity = 0;
    this.follow = null;
    this.textures.release(this.texture);
  }
}

/** A colour's four numbers into a field's `Color4`-shaped array, as the `Color4` Babylon's held. */
function putColor(out: number[], r: number, g: number, b: number, a: number): void {
  out[0] = r;
  out[1] = g;
  out[2] = b;
  out[3] = a;
}

/**
 * A map asking for more slots than the VRAM ceiling allows still gets a field
 * that fades correctly — `apply` shortens the lives to keep the wrap invariant
 * — but it is not the field that was asked for, and nothing on screen says so.
 * Shorter lives mean a shorter drift and fewer motes aloft, which reads as
 * thinner air with no cause attached to it.
 *
 * This is the one place the trade is announced. It is a dev-only warning
 * rather than a silent clamp because the density is the map author's decision:
 * the numbers below are what they actually got and both ways back to what they
 * asked for.
 */
function warnIfCeilingClamped(emitRate: number, maxLife: number): void {
  if (!import.meta.env.DEV) return;
  if (maxLife >= MAX_LIFE) return;
  const ceiling = CONFIG.graphics.particlePoolCeiling;
  const wanted = Math.ceil(emitRate * MAX_LIFE);
  const minLife = MIN_LIFE * (maxLife / MAX_LIFE);
  const aloft = Math.round((emitRate * (minLife + maxLife)) / 2);
  console.warn(
    `Atmosphere: the mote field wants ${wanted} slots and the ceiling allows ` +
      `${ceiling}. Mote lives are shortened from ${MIN_LIFE}-${MAX_LIFE} s to ` +
      `${minLife.toFixed(1)}-${maxLife.toFixed(1)} s to keep them fading ` +
      `rather than popping, so the field holds about ${aloft} motes instead ` +
      `of ${Math.round((emitRate * (MIN_LIFE + MAX_LIFE)) / 2)}. Lower the ` +
      `map's ParticleSpec.count (below ` +
      `${Math.floor((ceiling / MAX_LIFE) * 3)}) or raise ` +
      `CONFIG.graphics.particlePoolCeiling.`,
  );
}
