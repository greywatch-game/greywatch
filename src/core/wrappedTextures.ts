/**
 * wrappedTextures.ts — Babylon's wrapped VIEWS of textures OUR renderer owns
 * (`BABYLON_EXIT.md` rule 5: the side that does not own a texture reads a
 * wrapped view of it, never a copy): a shadow texture's
 * (`wrapShadowTexture`, which `ShadowSystem` and `LocalShadows` hand their
 * readers) and a reflection probe's cube (`wrapCubeTexture`, which
 * `ReflectionSystem` hands the glazing and the water).
 * Owns nothing: each call makes a view, and its caller holds it.
 * Invariants: a view samples as the Babylon texture it stands in for did —
 * its filter, its wrap, its dimension and its mip chain; a wrapped view is
 * disposed only with the texture it wraps, which disposing it DESTROYS
 * (Babylon releases it at the end of its frame).
 * Never: renders; copies a texture.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * In `core/` rather than beside any caller because three systems hand these
 * out, and a system reaching into another is what `Game`'s wiring exists to
 * prevent (`core/shadowWindow.ts`, which held them until X3.6c, is the
 * precedent).
 */
import { BaseTexture, type Scene, Texture, type WebGPUEngine } from "@babylonjs/core";

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
 * Babylon's view of a reflection probe's CUBE our renderer owns
 * (`render/ProbeBake.ts`, `BABYLON_EXIT.md` X3.6c) — what the glazing and the
 * water are handed (Babylon's `ReflectionProbe` cube was, until X3.7c),
 * sampled as that cube was: a cube view over all six layers and the whole mip chain,
 * trilinear, and the coordinates mode Babylon's cube render target takes
 * (`INVCUBIC_MODE`), from which Babylon's bind derives the cube's wrap. Here
 * beside `wrapShadowTexture` because it is the same crossing for a second
 * kind of texture.
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
