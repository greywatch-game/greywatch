/**
 * ShadowBindings.ts — Every shadow a lit material samples, bound onto it: the
 * world's map, the bodies', the lamps' atlas, the lightning's key and its map,
 * the clouds' field and the foliage's front-face map, plus the registry of the
 * non-cel materials (grass, water) that read the same `celShadow` include.
 * `CelMaterialFactory` owns one (`mats.shadows`) and lends it its cache. The
 * maps are published by the systems that render them (`ShadowSystem`,
 * `BodyShadows`, `LocalShadows`, and `Sky`'s field through `Game`); `Game`
 * also pushes the clouds and the lightning each frame, `ReflectionSystem`
 * holds the clouds off for a bake, and grass and water register here.
 * Invariants: **every sampler `SHADOW_SAMPLER_NAMES` names, and `foliageMap`
 * on a cel material, is BOUND on every material that declares it, always** — a
 * declared sampler with nothing behind it is a bind group that fails to build
 * and the draw silently lost. So a new material is seeded on the spot
 * (`applyShadow`, called by every creation path in the factory and by
 * `registerShadowConsumer`), each map is published before the first material
 * is asked for, and the clouds start on a texel of their own. The per-frame
 * pushes (the clouds, the lightning, the lamp slots) write into objects every
 * material already holds BY REFERENCE and walk nothing; the other setters
 * walk every reader.
 * Never: adds, removes or reorders a binding — the bumped ground variant is at
 * 16 of WebGPU's 16 sampled textures per stage since the near cascade
 * (CLAUDE.md), so a seventeenth is a packing first; creates or caches
 * a material; holds a consumer past its owner's `dispose`. The irradiance
 * volume is NOT here: it is bound only on cel materials and stays with the
 * factory (`setGi`), which binds it straight after this on creation.
 */
import {
  type BaseTexture,
  Color3,
  Constants,
  Matrix,
  RawTexture,
  type Scene,
  type ShaderMaterial,
  Vector3,
  Vector4,
} from "@babylonjs/core";
import { MAX_LOCAL_SLOTS } from "./wgsl/includes";

export class ShadowBindings {
  // Shadow-map state, pushed onto every cel material as it is created.
  private shadowMap: BaseTexture | null = null;
  private shadowMatrix = Matrix.Identity();
  private shadowParams = new Vector4(0.0025, 0.15, 0.06, 0);
  // The world's NEAR cascade: the same casters over a small window around
  // the player at a fine texel — see `ShadowSystem`'s near map. x = depth
  // bias, y = its own facet offset in metres.
  private nearShadowMap: BaseTexture | null = null;
  private nearShadowMatrix = Matrix.Identity();
  private readonly nearShadowParams = new Vector4(0, 0, 0, 0);
  // The bodies' map, the same three things over again — see
  // `SHADOW_UNIFORM_NAMES` for why none of it is shared with the pair above.
  private bodyShadowMap: BaseTexture | null = null;
  private bodyShadowMatrix = Matrix.Identity();
  private bodyShadowParams = new Vector4(0.0015, 0, 0, 0);
  // The clouds' shadow — see `setCloudShadow`. The texture is this object's
  // own "no cloud anywhere" until `Sky` hands over its field, and `w` = 1 in
  // the area switches the term off whatever the texture holds.
  private cloudShadowMap: BaseTexture;
  /** That "no cloud anywhere" texel, kept to know it when it is replaced. */
  private readonly noCloudShadow: BaseTexture;
  private readonly cloudShadowArea = new Vector4(0, 0, 0, 1);
  private readonly cloudShadowRay = new Vector4(0, 0, 0, 0);
  // What the materials actually hold: the area with `w` forced to 1 while a
  // reflection bake holds the term off — see `holdCloudShadow`.
  private readonly cloudShadowPushed = new Vector4(0, 0, 0, 1);
  private cloudShadowHeld = false;
  // The foliage's front-face map — see `setFoliageMap`. Cel materials only:
  // grass and water have no translucency and do not declare it.
  private foliageMap: BaseTexture | null = null;
  private foliageMatrix = Matrix.Identity();
  private foliageParams = new Vector4(0, 0, 0, 0);
  // The lamps' atlas — see `setLocalShadowMap`. The per-slot arrays are handed
  // to every consumer BY REFERENCE and rewritten in place, so a frame's
  // assignment reaches every material without a walk: a `ShaderMaterial`
  // keeps the array it was given and re-reads it on every bind.
  private localAtlasMap: BaseTexture | null = null;
  private readonly pointSpot = new Float32Array(MAX_LOCAL_SLOTS * 4).map(
    (_, i) => (i % 4 === 3 ? -2 : 0),
  );
  private readonly pointShade = new Float32Array(MAX_LOCAL_SLOTS * 4).map(
    (_, i) => (i % 4 === 1 || i % 4 === 2 ? -1 : 0),
  );
  private readonly localAtlas = new Vector4(1, 1, 1, 1);
  private readonly localParams = new Vector4(0, 0, 0, 0);
  // The LIGHTNING's key — a second directional term with a map of its own,
  // so the moon never moves. Held by reference like the key; `flashColor` is
  // black whenever no flash is up, which is the shader's early-out.
  private readonly flashDir = new Vector3(0, -1, 0);
  private readonly flashColor = new Color3(0, 0, 0);
  private flashMap: BaseTexture | null = null;
  private flashMatrix = Matrix.Identity();
  private readonly flashParams = new Vector4(0, 0, 0, 0);

  /**
   * The materials the CACHE holds — `CelMaterialFactory`'s own map, lent by
   * reference so a material it mints later is walked by the next push without
   * being told. Read, never written: the factory is the one door into it.
   */
  private readonly cels: ReadonlyMap<string, ShaderMaterial>;

  constructor(scene: Scene, cels: ReadonlyMap<string, ShaderMaterial>) {
    this.cels = cels;
    // **Bound from the first material, and it has to be**: the rigs, the
    // capture rings and the viewmodel are all built before `Sky`, and a
    // declared sampler with nothing behind it is a bind group that fails to
    // build. One RG texel of zero is a field with no cloud in it.
    this.noCloudShadow = new RawTexture(
      new Uint8Array(2),
      1,
      1,
      Constants.TEXTUREFORMAT_RG,
      scene,
      false,
      false,
      Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    );
    this.noCloudShadow.name = "noCloudShadow";
    this.cloudShadowMap = this.noCloudShadow;
  }

  /**
   * Materials that sample the depth map but are not cel materials — the grass
   * and the water, each of which reproduces the cel lighting model in its own
   * shader (see `celShadow`).
   *
   * They cannot live in the factory's cache: that map is keyed by colour and
   * its entries are shared, permanent and created on demand, while these are
   * one per map build and disposed with the map. So they are a second list
   * that only the shadow setters walk — the same shape as the factory's
   * `specs`, which holds foreign material references for the same reason.
   *
   * **Registering is the consumer's half of the contract and unregistering is
   * the other half.** Grass and water are rebuilt every round; a material left
   * here after its `dispose()` takes a `setMatrix` per frame for the rest of
   * the session.
   */
  private readonly shadowConsumers = new Set<ShaderMaterial>();

  /** Adds a non-cel material to the shadow uploads, and seeds it now. */
  registerShadowConsumer(mat: ShaderMaterial): void {
    this.shadowConsumers.add(mat);
    this.applyShadow(mat);
  }

  /** Drops a consumer. Call from the owner's `dispose`, without exception. */
  unregisterShadowConsumer(mat: ShaderMaterial): void {
    this.shadowConsumers.delete(mat);
  }

  /** Every material that samples the depth map, cel or not. */
  private eachShadowReader(fn: (mat: ShaderMaterial) => void): void {
    this.cels.forEach(fn);
    this.shadowConsumers.forEach(fn);
  }

  /**
   * The clouds' shadow field (`Sky.cloudShadowMap`), bound to every material
   * that reads the key's shadow. Called once, after `Sky` exists — the texture
   * object is stable even though its contents are rewritten as the ring drifts.
   */
  setCloudShadowMap(map: BaseTexture): void {
    const was = this.cloudShadowMap;
    this.cloudShadowMap = map;
    this.eachShadowReader((mat) => mat.setTexture("cloudShadowMap", map));
    // This object's own "no cloud" texel is nobody's once every reader holds
    // the field. `Game` swaps it in its constructor, before any frame — the
    // only other holder, the irradiance volume, binds per frame off `lit`.
    if (was !== map && was === this.noCloudShadow) was.dispose();
  }

  /**
   * Where the clouds' shadow field lies and how it is read this frame — see
   * `celCloud` for what each component is. Pushed from `tick` in EVERY state,
   * after `Sky.update`, because the crossfade moves with the drift and the
   * drift does not stop for a menu.
   *
   * **It walks no material**: `applyShadow` hands every reader
   * `cloudShadowPushed` and `cloudShadowRay` BY REFERENCE, as `pointSpot` is
   * handed, and a `ShaderMaterial` re-reads the object it was given on every
   * bind, so rewriting the two in place is the whole of the push. The crossfade
   * moves every frame the clouds drift, so a walk here was a walk every frame —
   * two uniform-list scans a material across the whole cache, to hand each one
   * the object it already held.
   */
  setCloudShadow(area: Vector4, ray: Vector4): void {
    this.cloudShadowArea.copyFrom(area);
    this.cloudShadowRay.copyFrom(ray);
    this.pushCloudShadow();
  }

  /**
   * Holds the clouds' shadow OFF for a reflection bake, and lets it go again.
   *
   * **A cube is baked once and the shadow moves**, so a cloud's shadow caught
   * in a bake would stay painted into every pane and pond that reflects it for
   * the rest of the round while the real one drifted off. `ReflectionSystem`
   * holds it on the hook that moves the eye into the probe and lets it go on
   * the one that moves it back, so the main pass of the same frame finds it
   * as it was. One write into the vector every reader holds (see
   * `setCloudShadow`), so it walks nothing either.
   */
  holdCloudShadow(held: boolean): void {
    if (held === this.cloudShadowHeld) return;
    this.cloudShadowHeld = held;
    this.pushCloudShadow();
  }

  /** Rewrites what every reader holds by reference — see `setCloudShadow`. */
  private pushCloudShadow(): void {
    this.cloudShadowPushed.copyFrom(this.cloudShadowArea);
    if (this.cloudShadowHeld) this.cloudShadowPushed.w = 1;
  }

  /**
   * Binds the ShadowSystem's depth map to every cel material. Called once at
   * startup — the texture object is stable even though its contents re-render.
   */
  setShadowMap(map: BaseTexture): void {
    this.shadowMap = map;
    this.eachShadowReader((mat) => mat.setTexture("shadowMap", map));
  }

  /** The light's view*projection; re-uploaded when the shadow camera moves. */
  setShadowMatrix(matrix: Matrix): void {
    this.shadowMatrix = matrix;
    this.eachShadowReader((mat) => mat.setMatrix("lightMatrix", matrix));
  }

  /**
   * The world's NEAR cascade, bound once per rung like the far map — the lit
   * 1x1 on a rung without one, read through a matrix that puts every receiver
   * OUTSIDE its window so the far map answers alone.
   */
  setNearShadowMap(map: BaseTexture): void {
    this.nearShadowMap = map;
    this.eachShadowReader((mat) => mat.setTexture("nearShadowMap", map));
  }

  /** The near light's view*projection; re-uploaded when its window moves. */
  setNearShadowMatrix(matrix: Matrix): void {
    this.nearShadowMatrix = matrix;
    this.eachShadowReader((mat) => mat.setMatrix("nearLightMatrix", matrix));
  }

  /**
   * Its depth bias (normalised) and its OWN facet offset in metres — the
   * offset is sized to a texel, and this one is finer.
   */
  setNearShadowParams(bias: number, normalBias: number): void {
    this.nearShadowParams.set(bias, normalBias, 0, 0);
    this.eachShadowReader((mat) => mat.setVector4("nearShadowParams", this.nearShadowParams));
  }

  /**
   * The BODIES' map, bound once at startup for the same reason the world's is:
   * the texture object is stable while its contents re-render.
   *
   * Unlike the world's it re-renders EVERY frame, and nothing here has to know
   * that — a texture is a texture. What does change is that this one can never
   * be skipped: it is in `SHADOW_SAMPLER_NAMES`, so a material that lists it and
   * never receives it loses every draw.
   */
  setBodyShadowMap(map: BaseTexture): void {
    this.bodyShadowMap = map;
    this.eachShadowReader((mat) => mat.setTexture("bodyShadowMap", map));
  }

  /** The bodies' light view*projection; re-uploaded when THAT window moves. */
  setBodyShadowMatrix(matrix: Matrix): void {
    this.bodyShadowMatrix = matrix;
    this.eachShadowReader((mat) => mat.setMatrix("bodyLightMatrix", matrix));
  }

  /**
   * The bodies' depth bias. One value rather than four: the darkness and the
   * facet offset are the RECEIVER's and are already in `shadowParams`, so
   * restating them here would be two places to set one look.
   */
  setBodyShadowParams(bias: number): void {
    this.bodyShadowParams.set(bias, 0, 0, 0);
    this.eachShadowReader((mat) =>
      mat.setVector4("bodyShadowParams", this.bodyShadowParams),
    );
  }

  /**
   * This frame's lightning: where it comes from and how bright it is now, or
   * `amount` 0 for none. Written into the objects every material holds, so
   * nothing is walked.
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

  /** The lightning's own depth map, bound once per rung like the others. */
  setFlashMap(map: BaseTexture): void {
    this.flashMap = map;
    this.eachShadowReader((mat) => mat.setTexture("flashMap", map));
  }

  /** That map's view*projection, re-uploaded when a strike re-aims it. */
  setFlashMatrix(matrix: Matrix): void {
    this.flashMatrix = matrix;
    this.eachShadowReader((mat) => mat.setMatrix("flashLightMatrix", matrix));
  }

  /** Its depth bias (normalised). */
  setFlashParams(bias: number): void {
    this.flashParams.set(bias, 0, 0, 0);
  }

  /**
   * The lamps' atlas and its shape (`systems/LocalShadows.ts`). Walks the
   * shadow readers only when the TEXTURE changes, which is a rung change;
   * the two vectors are held by reference and are rewritten in place.
   */
  setLocalShadowMap(map: BaseTexture): void {
    this.localAtlasMap = map;
    this.eachShadowReader((mat) => mat.setTexture("localAtlasMap", map));
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
   * measure (see `TranslucencySpec.depth`). Bound once at startup, before any
   * material exists, for `setBodyShadowMap`'s reason — every cel material
   * declares the sampler, so there is no state in which it may be absent.
   *
   * Pushed over the CACHE and not over `eachShadowReader`: grass and water
   * carry no translucency and do not declare it.
   */
  setFoliageMap(map: BaseTexture): void {
    this.foliageMap = map;
    this.cels.forEach((mat) => mat.setTexture("foliageMap", map));
  }

  /** The foliage light's view*projection; re-uploaded when its window moves. */
  setFoliageMatrix(matrix: Matrix): void {
    this.foliageMatrix = matrix;
    this.cels.forEach((mat) => mat.setMatrix("foliageLightMatrix", matrix));
  }

  /**
   * The reciprocal of the foliage map's depth span in metres, which is what
   * turns a material's `depth` into that map's normalised depth in the
   * shader. In `y`, where it has always been read.
   */
  setFoliageParams(perMetre: number): void {
    this.foliageParams.set(0, perMetre, 0, 0);
    this.cels.forEach((mat) => mat.setVector4("foliageParams", this.foliageParams));
  }

  /**
   * Depth bias, in-shadow darkness and facet-normal offset. The lookup's
   * footprint is in TEXELS of whatever map it reads (`shadowCubic` asks the
   * texture its own size), so no map size is handed over any more.
   */
  setShadowParams(bias: number, darkness: number, normalBias: number): void {
    this.shadowParams.set(bias, darkness, normalBias, 0);
    this.eachShadowReader((mat) =>
      mat.setVector4("shadowParams", this.shadowParams),
    );
  }

  /**
   * The clouds' field, for `CelMaterialFactory.readLighting` to hand on to the
   * irradiance volume. Live references: read, never write.
   */
  get cloudMap(): BaseTexture {
    return this.cloudShadowMap;
  }
  get cloudArea(): Vector4 {
    return this.cloudShadowArea;
  }
  get cloudRay(): Vector4 {
    return this.cloudShadowRay;
  }

  /**
   * Seeds a material with every shadow it samples: a consumer from
   * `registerShadowConsumer`, and a cel material from every one of the
   * factory's creation paths, which binds the irradiance volume straight
   * after it.
   */
  applyShadow(mat: ShaderMaterial): void {
    if (this.shadowMap) mat.setTexture("shadowMap", this.shadowMap);
    mat.setTexture("cloudShadowMap", this.cloudShadowMap);
    mat.setVector4("cloudShadow", this.cloudShadowPushed);
    mat.setVector4("cloudShadowRay", this.cloudShadowRay);
    mat.setMatrix("lightMatrix", this.shadowMatrix);
    mat.setVector4("shadowParams", this.shadowParams);
    if (this.nearShadowMap) mat.setTexture("nearShadowMap", this.nearShadowMap);
    mat.setMatrix("nearLightMatrix", this.nearShadowMatrix);
    mat.setVector4("nearShadowParams", this.nearShadowParams);
    if (this.bodyShadowMap) {
      mat.setTexture("bodyShadowMap", this.bodyShadowMap);
    }
    mat.setMatrix("bodyLightMatrix", this.bodyShadowMatrix);
    mat.setVector4("bodyShadowParams", this.bodyShadowParams);
    if (this.localAtlasMap) mat.setTexture("localAtlasMap", this.localAtlasMap);
    mat.setArray4("pointSpot", this.pointSpot as unknown as number[]);
    mat.setArray4("pointShade", this.pointShade as unknown as number[]);
    mat.setVector4("localAtlas", this.localAtlas);
    mat.setVector4("localParams", this.localParams);
    if (this.flashMap) mat.setTexture("flashMap", this.flashMap);
    mat.setMatrix("flashLightMatrix", this.flashMatrix);
    mat.setVector4("flashParams", this.flashParams);
    mat.setVector3("flashDir", this.flashDir);
    mat.setColor3("flashColor", this.flashColor);
    // A grass or water consumer is registered BEFORE this runs, which is how
    // this tells the two apart: only a cel material declares the foliage map.
    if (!this.shadowConsumers.has(mat)) {
      if (this.foliageMap) mat.setTexture("foliageMap", this.foliageMap);
      mat.setMatrix("foliageLightMatrix", this.foliageMatrix);
      mat.setVector4("foliageParams", this.foliageParams);
    }
  }
}
