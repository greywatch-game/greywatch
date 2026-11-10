/**
 * wrappedTextures.ts — Babylon's wrapped VIEWS of textures OUR renderer owns
 * (`BABYLON_EXIT.md` rule 5: the side that does not own a texture reads a
 * wrapped view of it, never a copy): a shadow texture's
 * (`wrapShadowTexture`, which `ShadowSystem`, `BodyShadows` and
 * `LocalShadows` hand their readers). Since X5.4d their one reader is the
 * Babylon cel materials (`ShadowBindings`), which neither draw nor compile in
 * any state and stay declared until X6.1: every draw of ours binds the shadow
 * texture itself, and a map that is off is the lit texel of OUR renderer's
 * (`TextureMaker.lit`), which no Babylon reader is handed. What a view still
 * does is HOLD its texture's life (below). A reflection probe's cube had one too
 * (`wrapCubeTexture`, the DEFAULT cube a Babylon glazing material was born
 * holding), deleted at `BABYLON_EXIT.md` X5.3d with the map editor's glazing
 * that sampled it: the water reads its cube directly since X4.6d and a
 * round's glazing since X4.6e.
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
 * a world map's (`ShadowSystem`), the bodies' map (`BodyShadows`, since
 * X4.1c) or the lamps' atlas (`LocalShadows`) —
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
