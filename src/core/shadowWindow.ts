/**
 * shadowWindow.ts — where a directional shadow camera STANDS, and the texel
 * snap that stops its edges crawling — and the two Babylon textures every
 * shadow reader may be bound to that no generator renders: the LIT texture
 * a map switched off reads (`litShadowTexture`), and Babylon's wrapped VIEW
 * of a shadow texture our renderer owns (`wrapShadowTexture`), which both
 * `ShadowSystem` and `LocalShadows` hand their readers — and its twin for a
 * reflection probe's cube of ours (`wrapCubeTexture`), which
 * `ReflectionSystem` hands the glazing and the water. Owns the light's own
 * cross-axis basis and the last snapped focus; owns no light, no generator
 * and no render target, and never renders anything.
 * Invariants: `place` writes `light.position` and nothing else on the light —
 * the frustum side, the depth range and the refresh schedule all belong to
 * whoever owns the generator; a wrapped view is disposed only with the
 * texture it wraps, which disposing it destroys. Contract:
 * `docs/rendering.md`.
 *
 * **There are THREE shadow maps in this game and this is the arithmetic they
 * share**, which is the whole reason it is a module rather than a method (the
 * third is the foliage's, `ShadowSystem`'s own second window).
 * `ShadowSystem` carries the static world and re-renders only when this says
 * the window moved; `BodyShadows` carries soldiers and hulls and re-renders
 * every frame regardless. They disagree about the refresh, the casters, the map
 * size and the window's side — and agree about exactly this: where the ortho
 * volume is centred, and that it is centred on a whole number of ITS OWN
 * texels. Two copies of that drifting is two maps looking at two places off one
 * focus, and the symptom is a body shaded against a wall it is not standing by.
 *
 * It is in `core/` rather than beside either caller because both callers are
 * systems, and a system reaching into another system is the thing `Game`'s
 * wiring exists to prevent. `core/recoilCurve.ts` is the precedent: a pure
 * module two owners both run, holding the rule neither may restate.
 *
 * **THE SNAP IS THE POINT, and it is in the LIGHT's basis rather than the
 * world's.** Moving the ortho window by a whole number of texels leaves every
 * texel over the same patch of world, so a standing body's shadow edge is
 * resolved identically frame to frame; moving it by a fraction re-quantises
 * every edge in the map and they all shimmer. The DEPTH axis is snapped too,
 * because an unsnapped slide along the light shifts receiver depths against
 * caster depths and the hard edges crawl just the same.
 */
import {
  BaseTexture,
  type DirectionalLight,
  RawTexture,
  type Scene,
  Texture,
  Vector3,
  type WebGPUEngine,
} from "@babylonjs/core";

/**
 * A 1x1 texture that every shadow lookup in the game reads as FULLY LIT — what
 * a map that is switched OFF (`CONFIG.graphics.shadowTiers`) is bound as.
 *
 * **A sampler a material declares must be BOUND** (`SHADOW_SAMPLER_NAMES`), so
 * off cannot be "no texture": it has to be a texture whose every depth is the
 * far plane. An 8-bit 255 reads back as exactly 1.0, which is past every
 * receiver the two-level compare can hold, and it is the FORMAT that matters
 * rather than the value — a 32-bit float is not filterable under WebGPU and
 * fails the bind group the depth maps' filtering sampler asks for.
 *
 * One per scene, and never disposed by a caller: the maps swap it in and out
 * of their bindings, and a map switched back on stops pointing at it rather
 * than freeing it.
 */
export function litShadowTexture(scene: Scene): BaseTexture {
  const held = litByScene.get(scene);
  if (held) return held;
  const tex = RawTexture.CreateRGBATexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    scene,
    false,
    false,
  );
  tex.name = "litShadow";
  litByScene.set(scene, tex);
  return tex;
}
const litByScene = new WeakMap<Scene, BaseTexture>();

/**
 * Babylon's view of a shadow texture OUR renderer owns (`BABYLON_EXIT.md`
 * rule 5: the side that does not own a texture reads a wrapped view of it) —
 * a world map's (`ShadowSystem`) or the lamps' atlas (`LocalShadows`) —
 * sampled as Babylon's own shadow textures were: nearest, clamped. A wrapped
 * texture has no view until it is re-pointed, so it is re-pointed at itself.
 *
 * **Disposing the view DESTROYS the texture it wraps** (Babylon releases it
 * at the end of its frame), so whoever holds one lets it go only with that
 * texture, and re-makes the texture afresh rather than keeping it under a
 * view that is going.
 */
export function wrapShadowTexture(scene: Scene, texture: GPUTexture, name: string): BaseTexture {
  const engine = scene.getEngine() as WebGPUEngine;
  const internal = engine.wrapWebGPUTexture(texture);
  engine.updateWrappedWebGPUTexture(internal, texture);
  engine.updateTextureSamplingMode(Texture.NEAREST_SAMPLINGMODE, internal);
  const wrapped = new BaseTexture(scene, internal);
  wrapped.name = name;
  wrapped.wrapU = Texture.CLAMP_ADDRESSMODE;
  wrapped.wrapV = Texture.CLAMP_ADDRESSMODE;
  return wrapped;
}

/**
 * The near plane of every shadow volume in the game, in metres along the
 * light. Both maps stand their camera `distance` behind the focus and clip at
 * this and at their own `depthRange`, so a volume's depth span is
 * `depthRange - SHADOW_NEAR` — which is what `depthBias` divides by.
 */
export const SHADOW_NEAR = 1;

/**
 * A depth bias stated in METRES along the light, as the shader's normalised
 * depth over a volume `depthRange` deep.
 *
 * **The config states metres and the shader compares normalised depth, and
 * this is the one place the two meet.** Under WebGPU a caster's stored depth is
 * the raw ortho clip z, linear over `[SHADOW_NEAR, depthRange]`, so a
 * normalised bias means a different distance in every volume: 0.0035 was 63 cm
 * on the world's 180 m one, a number nobody would have chosen in metres, and a
 * deeper volume would have silently widened it further.
 */
export function depthBias(metres: number, depthRange: number): number {
  return metres / (depthRange - SHADOW_NEAR);
}

/**
 * The basis and the snapped focus for one shadow window.
 *
 * One instance per map — they are not interchangeable and must not be shared:
 * the snap is in texels of a particular map size, so two maps at two
 * resolutions land on two different grids off the same focus.
 */
export class ShadowWindow {
  /**
   * The two cross-axes of the light's own basis, kept after `place` so a
   * caller can project into it — `ShadowSystem`'s render-list cull does. The
   * third axis is the light's direction, which `DirectionalLight` already
   * holds.
   */
  readonly axisX = new Vector3(1, 0, 0);
  readonly axisY = new Vector3(0, 1, 0);
  /**
   * The last focus, snapped, in that basis: x and y across the window and z
   * along the light. Infinite to begin with, which is what forces the first
   * `place` to report a move.
   */
  readonly snapped = new Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );

  /**
   * Forgets where the window was, so the next `place` reports a move whatever
   * the focus did.
   *
   * Owed by anything that changes the SHAPE of the volume rather than its
   * centre — a new light direction or a new window side — because the snap
   * compares coordinates in a basis those change out from under.
   */
  invalidate(): void {
    this.snapped.setAll(Number.POSITIVE_INFINITY);
  }

  /**
   * Centres the window on `focus`, snapped to whole texels, and writes the
   * light's position. Returns whether it actually moved — which is what a
   * caller gates a re-render and a matrix re-upload on.
   *
   * `metres` is the ortho window's side, `mapSize` the depth map's resolution
   * (the two together are the texel) and `distance` how far back along the
   * light the camera stands from the focus.
   */
  place(
    light: DirectionalLight,
    focus: Vector3,
    metres: number,
    mapSize: number,
    distance: number,
  ): boolean {
    const dir = light.direction;
    const texel = metres / mapSize;
    // LookAtLH basis: x = normalize(cross(up, z)), y = cross(z, x).
    const x = this.axisX;
    const y = this.axisY;
    Vector3.CrossToRef(Vector3.UpReadOnly, dir, x);
    // A light pointing straight up or straight down leaves that cross product
    // at zero, and `normalize` on a zero vector is three NaNs — which propagate
    // into the snap, the light's position and every shadow in the frame, with
    // nothing anywhere reporting an error. No shipped map states such a
    // direction and none is likely to: a sun at the zenith casts nothing
    // sideways and is the one elevation with no shadows to place. But it is a
    // number a map may write, so the degenerate case picks an arbitrary
    // perpendicular rather than poisoning the frame.
    if (x.lengthSquared() < 1e-8) x.set(1, 0, 0);
    x.normalize();
    Vector3.CrossToRef(dir, x, y);
    y.normalize();
    const sx = Math.round(Vector3.Dot(focus, x) / texel) * texel;
    const sy = Math.round(Vector3.Dot(focus, y) / texel) * texel;
    const sz = Math.round(Vector3.Dot(focus, dir) / texel) * texel;
    if (sx === this.snapped.x && sy === this.snapped.y && sz === this.snapped.z) {
      return false;
    }
    this.snapped.set(sx, sy, sz);
    const depth = sz - distance;
    light.position.set(
      x.x * sx + y.x * sy + dir.x * depth,
      x.y * sx + y.y * sy + dir.y * depth,
      x.z * sx + y.z * sy + dir.z * depth,
    );
    return true;
  }
}

/**
 * Babylon's view of a reflection probe's CUBE our renderer owns
 * (`render/ProbeBake.ts`, `BABYLON_EXIT.md` X3.6c) — what the glazing and the
 * water are handed in place of a `ReflectionProbe`'s cube, sampled as that
 * cube was: a cube view over all six layers and the whole mip chain,
 * trilinear, and the coordinates mode Babylon's cube render target takes
 * (`INVCUBIC_MODE`), from which Babylon's bind derives the cube's wrap. Here
 * beside `wrapShadowTexture` because it is the same crossing for a second
 * kind of texture, and `shadowWindow.ts` is where the game's wrapped views
 * are made.
 *
 * **Disposing it DESTROYS the cube**, as `wrapShadowTexture`'s does: the cube
 * pool is never disposed, and neither is a view of it.
 */
export function wrapCubeTexture(scene: Scene, texture: GPUTexture, name: string): BaseTexture {
  const engine = scene.getEngine() as WebGPUEngine;
  const internal = engine.wrapWebGPUTexture(texture);
  // Read by the re-point below, which makes the view a cube's and gives it
  // every level.
  internal.isCube = true;
  internal.generateMipMaps = texture.mipLevelCount > 1;
  engine.updateWrappedWebGPUTexture(internal, texture);
  engine.updateTextureSamplingMode(Texture.TRILINEAR_SAMPLINGMODE, internal);
  const wrapped = new BaseTexture(scene, internal);
  wrapped.name = name;
  wrapped.coordinatesMode = Texture.INVCUBIC_MODE;
  return wrapped;
}
