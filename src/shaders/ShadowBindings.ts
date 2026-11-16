/**
 * ShadowBindings.ts — Every shadow a lit material samples, as our renderer's
 * frame binds it: the world's map, the bodies', the lamps' atlas, the
 * lightning's key and its map, the clouds' field and the foliage's front-face
 * map. `CelMaterialFactory` owns one (`mats.shadows`). The
 * maps are published by the systems that render them (`ShadowSystem`,
 * `BodyShadows`, `LocalShadows`, and `Sky`'s field through `Game`); `Game`
 * also pushes the clouds and the lightning each frame; a reflection bake's frame
 * holds the clouds off on its own
 * (`fillFrame`'s `bake`).
 * Invariants: **every shadow texture our renderer's frame binds is OUR
 * renderer's** (`fillFrameTextures`): a map that is ours as its owner hands it,
 * a map that is OFF as the lit texel (`TextureMaker.lit`), and the clouds' field
 * — `Sky`'s, or until it is handed over a no-cloud texel of this object's own —
 * the last two `TextureMaker`'s since `BABYLON_EXIT.md` X5.4d, made as Babylon's
 * `RawTexture`s were; a frame texture is null only before its owner first
 * publishes it (a frame with one null draws nothing). Every value here is
 * PULLED into the frame once a frame (`fillFrame`, `fillFrameTextures`) off
 * these fields, and nothing is pushed onto a material: a material is a key of
 * ours with no uniform to hold (`MaterialKey.ts`), so a setter stores and
 * walks nothing (it walked the Babylon cel materials until `BABYLON_EXIT.md`
 * X6.1c, none of which drew). Each map is published before the first frame,
 * and the clouds start on a texel of their own.
 * Never: adds, removes or reorders a binding — the bumped ground variant is at
 * 16 of WebGPU's 16 sampled textures per stage since the near cascade
 * (CLAUDE.md), so a seventeenth is a packing first; creates or caches
 * a material. The irradiance volume is NOT here: it stays with the factory
 * (`setGi`), which copies it into the frame beside this.
 */
import { Color3, Matrix, Vector3, Vector4 } from "../math";
import type { FrameTextures, FrameUniforms } from "../render/frame";
import type { OwnTexture } from "../render/HostBindGroup";
import { type MadeTexture, SAMPLING, type TextureMaker } from "../render/TextureMaker";
import { MAX_POINT_LIGHTS } from "./wgsl/celSurface";

export class ShadowBindings {
  /**
   * The world's four maps, the bodies' and the lamps' atlas as OUR renderer
   * binds them (`render/WorldShadows.ts`, `render/BodyShadowMap.ts`,
   * `render/LampAtlas.ts`, `BABYLON_EXIT.md` X3.6a, X4.1c and X3.6b), handed
   * to our frame as themselves — or the lit texel while a map is off (X5.4d).
   * Null only until a map is first published.
   */
  private readonly own: {
    shadowMap: OwnTexture | null;
    nearShadowMap: OwnTexture | null;
    bodyShadowMap: OwnTexture | null;
    flashMap: OwnTexture | null;
    foliageMap: OwnTexture | null;
    localAtlasMap: OwnTexture | null;
  } = {
    shadowMap: null,
    nearShadowMap: null,
    bodyShadowMap: null,
    flashMap: null,
    foliageMap: null,
    localAtlasMap: null,
  };
  // Shadow-map state, copied into the frame (the maps themselves are `own`'s).
  private shadowMatrix = Matrix.Identity();
  private shadowParams = new Vector4(0.0025, 0.15, 0.06, 0);
  // The world's NEAR cascade: the same casters over a small window around
  // the player at a fine texel — see `ShadowSystem`'s near map. x = depth
  // bias, y = its own facet offset in metres.
  private nearShadowMatrix = Matrix.Identity();
  private readonly nearShadowParams = new Vector4(0, 0, 0, 0);
  // The bodies' map, the same three things over again — see
  // the frame's `bodyLightMatrix` for why none of it is shared with the pair above.
  private bodyShadowMatrix = Matrix.Identity();
  private bodyShadowParams = new Vector4(0.0015, 0, 0, 0);
  // The clouds' shadow — see `setCloudShadow`. The texture is this object's
  // own "no cloud anywhere" until `Sky` hands over its field, and `w` = 1 in
  // the area switches the term off whatever the texture holds. Ours, and bound
  // on our frame alone: no Babylon material is handed it.
  private cloudShadowMap: OwnTexture;
  /** That "no cloud anywhere" texel, kept to know it when it is replaced. */
  private readonly noCloudShadow: MadeTexture;
  /** What every map that is off is bound as on our frame: the fully-lit texel. */
  readonly lit: OwnTexture;
  private readonly cloudShadowArea = new Vector4(0, 0, 0, 1);
  private readonly cloudShadowRay = new Vector4(0, 0, 0, 0);
  // What the frame holds: the area as last pushed (`setCloudShadow`). A
  // bake's frame holds it off itself (`fillFrame`).
  private readonly cloudShadowPushed = new Vector4(0, 0, 0, 1);
  // The foliage's front-face map — see `setFoliageMap`. Cel materials only:
  // the water has no translucency and does not declare it.
  private foliageMatrix = Matrix.Identity();
  private foliageParams = new Vector4(0, 0, 0, 0);
  // The lamps' atlas — see `setLocalShadowMap`. The per-slot arrays are this
  // object's own, rewritten in place by `LocalShadows` (`localSlots`) and
  // copied into the frame.
  private readonly pointSpot = new Float32Array(MAX_POINT_LIGHTS * 4).map(
    (_, i) => (i % 4 === 3 ? -2 : 0),
  );
  private readonly pointShade = new Float32Array(MAX_POINT_LIGHTS * 4).map(
    (_, i) => (i % 4 === 1 || i % 4 === 2 ? -1 : 0),
  );
  private readonly localAtlas = new Vector4(1, 1, 1, 1);
  private readonly localParams = new Vector4(0, 0, 0, 0);
  // The LIGHTNING's key — a second directional term with a map of its own,
  // so the moon never moves. Held by reference like the key; `flashColor` is
  // black whenever no flash is up, which is the shader's early-out.
  private readonly flashDir = new Vector3(0, -1, 0);
  private readonly flashColor = new Color3(0, 0, 0);
  private flashMatrix = Matrix.Identity();
  private readonly flashParams = new Vector4(0, 0, 0, 0);

  constructor(private readonly textures: TextureMaker) {
    this.lit = textures.lit;
    // **Bound from the first frame, and it has to be**: the rigs, the capture
    // rings and the viewmodel are all built before `Sky`, and a declared
    // sampler with nothing behind it is a bind group that fails to build. One
    // RG texel of zero is a field with no cloud in it — `rg8unorm`, sampled
    // NEAREST and clamped, as the `RawTexture` it was.
    this.noCloudShadow = textures.raw("no cloud shadow", new Uint8Array(2), 1, 1, "rg8unorm", SAMPLING.nearest);
    this.cloudShadowMap = this.noCloudShadow;
  }

  /**
   * The maps our renderer's frame binds — off the same fields, so a map
   * replaced here is replaced there on the next frame; one never published is
   * null, which draws nothing. Every one is OUR renderer's texture (`own`): a map's own, the
   * lit texel where it is off, the clouds' field.
   */
  fillFrameTextures(out: FrameTextures): void {
    const own = this.own;
    out.shadowMap = own.shadowMap;
    out.nearShadowMap = own.nearShadowMap;
    out.bodyShadowMap = own.bodyShadowMap;
    out.localAtlasMap = own.localAtlasMap;
    out.flashMap = own.flashMap;
    out.cloudShadowMap = this.cloudShadowMap;
    out.foliageMap = own.foliageMap;
  }

  /**
   * Copies every shadow value a cel draw reads into our renderer's frame
   * (`CelMaterialFactory.fillFrame`, which calls this). A pull rather than a
   * push because half of what is here is never pushed: the matrices are the
   * generators' own and are rewritten in place, and the clouds, the flash and
   * the lamps' slots are rewritten in place by their owners — so the only
   * copy that cannot miss a change is one taken off the fields.
   */
  fillFrame(out: FrameUniforms, bake = false): void {
    out.lightMatrix.set(this.shadowMatrix.m);
    this.shadowParams.toArray(out.shadowParams);
    out.nearLightMatrix.set(this.nearShadowMatrix.m);
    this.nearShadowParams.toArray(out.nearShadowParams);
    out.bodyLightMatrix.set(this.bodyShadowMatrix.m);
    this.bodyShadowParams.toArray(out.bodyShadowParams);
    out.foliageLightMatrix.set(this.foliageMatrix.m);
    this.foliageParams.toArray(out.foliageParams);
    // What the frame HOLDS…
    this.cloudShadowPushed.toArray(out.cloudShadow);
    // …held off for a reflection bake (`w` 1): a cube is baked ONCE and the
    // shadow moves, so a cloud's shadow caught in a bake would stay painted
    // into every pane and pond that reflects it for the rest of the round
    // while the real one drifted off. The bake's frame is a frame of its own.
    if (bake) out.cloudShadow[3] = 1;
    this.cloudShadowRay.toArray(out.cloudShadowRay);
    this.flashDir.toArray(out.flashDir);
    this.flashColor.toArray(out.flashColor);
    out.flashLightMatrix.set(this.flashMatrix.m);
    this.flashParams.toArray(out.flashParams);
    out.pointSpot.set(this.pointSpot);
    out.pointShade.set(this.pointShade);
    this.localAtlas.toArray(out.localAtlas);
    this.localParams.toArray(out.localParams);
  }

  /**
   * The clouds' shadow field (`Sky.cloudShadowMap`), bound on our frame from
   * the next one on. Called once, after `Sky` exists — the texture object is
   * stable even though its contents are rewritten as the ring drifts.
   */
  setCloudShadowMap(map: OwnTexture): void {
    const was = this.cloudShadowMap;
    this.cloudShadowMap = map;
    // This object's own "no cloud" texel is nobody's once the frame holds the
    // field. `Game` swaps it in its constructor, before any frame — the only
    // other holder, the irradiance volume, binds per frame off `lit`.
    if (was !== map && was === this.noCloudShadow) this.textures.release(this.noCloudShadow);
  }

  /**
   * Where the clouds' shadow field lies and how it is read this frame — see
   * `celCloud` for what each component is. Pushed from `tick` in EVERY state,
   * after `Sky.update`, because the crossfade moves with the drift and the
   * drift does not stop for a menu.
   *
   * It walks no material: the frame copies the two off these fields.
   */
  setCloudShadow(area: Vector4, ray: Vector4): void {
    this.cloudShadowArea.copyFrom(area);
    this.cloudShadowRay.copyFrom(ray);
    this.pushCloudShadow();
  }

  /** Rewrites what the frame copies — see `setCloudShadow`. */
  private pushCloudShadow(): void {
    this.cloudShadowPushed.copyFrom(this.cloudShadowArea);
  }

  /**
   * Binds the ShadowSystem's depth map — once a rung, and once each time the
   * map changes hands; the texture object is stable while its contents
   * re-render. `own` is the texture as our renderer holds it, which our
   * frame binds; null while the map is off, which our frame binds as the lit
   * texel (`TextureMaker.lit`).
   */
  setShadowMap(own: OwnTexture | null): void {
    this.own.shadowMap = own ?? this.lit;
  }

  /** The light's view*projection; re-uploaded when the shadow camera moves. */
  setShadowMatrix(matrix: Matrix): void {
    this.shadowMatrix = matrix;
  }

  /**
   * The world's NEAR cascade, bound once per rung like the far map — the lit
   * 1x1 on a rung without one, read through a matrix that puts every receiver
   * OUTSIDE its window so the far map answers alone.
   */
  setNearShadowMap(own: OwnTexture | null): void {
    this.own.nearShadowMap = own ?? this.lit;
  }

  /** The near light's view*projection; re-uploaded when its window moves. */
  setNearShadowMatrix(matrix: Matrix): void {
    this.nearShadowMatrix = matrix;
  }

  /**
   * Its depth bias (normalised) and its OWN facet offset in metres — the
   * offset is sized to a texel, and this one is finer.
   */
  setNearShadowParams(bias: number, normalBias: number): void {
    this.nearShadowParams.set(bias, normalBias, 0, 0);
  }

  /**
   * The BODIES' map, bound once a rung for the same reason the world's is:
   * the texture object is stable while its contents re-render. `own` as
   * `setShadowMap`'s (`render/BodyShadowMap.ts`, ours since X4.1c), null on a
   * rung that has none.
   *
   * Unlike the world's it re-renders EVERY frame, and nothing here has to know
   * that — a texture is a texture. What does change is that this one can never
   * be skipped: it is in the frame's textures (`FRAME_TEXTURES`), so a frame
   * that never receives it draws nothing.
   */
  setBodyShadowMap(own: OwnTexture | null): void {
    this.own.bodyShadowMap = own ?? this.lit;
  }

  /** The bodies' light view*projection; re-uploaded when THAT window moves. */
  setBodyShadowMatrix(matrix: Matrix): void {
    this.bodyShadowMatrix = matrix;
  }

  /**
   * The bodies' depth bias. One value rather than four: the darkness and the
   * facet offset are the RECEIVER's and are already in `shadowParams`, so
   * restating them here would be two places to set one look.
   */
  setBodyShadowParams(bias: number): void {
    this.bodyShadowParams.set(bias, 0, 0, 0);
  }

  /**
   * This frame's lightning: where it comes from and how bright it is now, or
   * `amount` 0 for none. Written into the objects the frame copies.
   *
   * **A SECOND key rather than the moon's, and that is the fix, not a
   * refinement.** The flash used to take the key's direction for its length
   * and re-aim the moon's maps along the strike, which meant a re-render each
   * way and a moon lit from the wrong side for the whole of the envelope's
   * tail — seen as the shadows snapping back well after the flash was gone.
   * With a term and a map of its own (`ShadowSystem.flash`) the moon never
   * moves, and a flash that has decayed to nothing is simply no light.
   */
  setFlash(dir: Vector3, color: Color3, amount: number): void {
    this.flashDir.copyFrom(dir).normalize();
    this.flashColor.copyFrom(color).scaleInPlace(Math.max(0, amount));
  }

  /** The lightning's own depth map, bound once per rung like the others, and `own` as `setShadowMap`'s. */
  setFlashMap(own: OwnTexture | null): void {
    this.own.flashMap = own ?? this.lit;
  }

  /** That map's view*projection, re-uploaded when a strike re-aims it. */
  setFlashMatrix(matrix: Matrix): void {
    this.flashMatrix = matrix;
  }

  /** Its depth bias (normalised). */
  setFlashParams(bias: number): void {
    this.flashParams.set(bias, 0, 0, 0);
  }

  /**
   * The lamps' atlas and its shape (`systems/LocalShadows.ts`), and `own` as
   * `setShadowMap`'s; the two vectors are rewritten in place.
   */
  setLocalShadowMap(own: OwnTexture | null): void {
    this.own.localAtlasMap = own ?? this.lit;
  }

  /**
   * The per-slot cone and tile arrays, and the atlas's two vectors — this
   * object's OWN, which `LocalShadows` writes into every frame.
   * Returned rather than copied so there is one set of numbers and one owner
   * writing them.
   */
  get localSlots(): {
    readonly spot: Float32Array;
    readonly shade: Float32Array;
    readonly atlas: Vector4;
    readonly params: Vector4;
  } {
    return this.localSlotsView;
  }
  /**
   * `localSlots`' answer, built ONCE: `LocalShadows.publish` asks for it
   * every frame, and a fresh literal per ask is garbage per frame. Every
   * field it points at is `readonly`, so the view can never go stale.
   */
  private readonly localSlotsView = {
    spot: this.pointSpot,
    shade: this.pointShade,
    atlas: this.localAtlas,
    params: this.localParams,
  } as const;

  /**
   * The FOLIAGE's depth map: front faces of the translucent solids, and
   * nothing else, which is what gives the translucency term a thickness to
   * measure (see `TranslucencySpec.depth`). Bound once at startup, before the
   * first frame, for `setBodyShadowMap`'s reason — every cel program declares
   * it, so there is no state in which it may be absent.
   */
  setFoliageMap(own: OwnTexture | null): void {
    this.own.foliageMap = own ?? this.lit;
  }

  /** The foliage light's view*projection; re-uploaded when its window moves. */
  setFoliageMatrix(matrix: Matrix): void {
    this.foliageMatrix = matrix;
  }

  /**
   * The reciprocal of the foliage map's depth span in metres, which is what
   * turns a material's `depth` into that map's normalised depth in the
   * shader. In `y`, where it has always been read.
   */
  setFoliageParams(perMetre: number): void {
    this.foliageParams.set(0, perMetre, 0, 0);
  }

  /**
   * Depth bias, in-shadow darkness and facet-normal offset. The lookup's
   * footprint is in TEXELS of whatever map it reads (`shadowCubic` asks the
   * texture its own size), so no map size is handed over any more.
   */
  setShadowParams(bias: number, darkness: number, normalBias: number): void {
    this.shadowParams.set(bias, darkness, normalBias, 0);
  }

  /**
   * The clouds' field, for `CelMaterialFactory.readLighting` to hand on to the
   * irradiance volume. Live references: read, never write.
   */
  get cloudMap(): OwnTexture {
    return this.cloudShadowMap;
  }
  get cloudArea(): Vector4 {
    return this.cloudShadowArea;
  }
  get cloudRay(): Vector4 {
    return this.cloudShadowRay;
  }
}
