/**
 * ShadowSystem.ts — Owns the moon's shadow camera and the contact shadows
 * under combatants.
 *
 * The DirectionalLight here is the scene's ONLY Babylon light, and it exists
 * purely to define the shadow frustum: no material reads scene lights (cel
 * materials carry their own uniforms, effect materials are unlit), so it
 * shades nothing directly. The depth map drawn along it is sampled by the cel
 * fragment shader as a hard two-level shadow term.
 *
 * **WHO DRAWS THE WORLD'S MAPS is decided per map install, and since X3.6a it
 * is normally OUR renderer** (`BABYLON_EXIT.md`): when the handover holds
 * every caster the map has (`WorldShadows.casters`, set by `BlockHandover`),
 * the four maps are textures `render/WorldShadows.ts` owns and draws, and
 * Babylon's readers sample a wrapped view of each (rule 5); otherwise — an
 * editor build, `?babylonworld`, a caster the handover could not take, or
 * casters it LOSES mid-map (`WorldShadows.onLost`) — they are this file's
 * `ShadowGenerator`s, as before. Everything else here is the same for both:
 * the lights, the windows, the snap, the hold and when a map is redrawn.
 *
 * Casters are the merged static world meshes, re-registered via setCasters()
 * after every map build (the map is disposed and rebuilt per round).
 * Characters never cast into the map — the player rig is ~60 meshes and each
 * bot 9, so per-frame caster cost would dwarf the ~40 merged static draws.
 * They get blob shadows instead: soft unlit alpha discs that follow each
 * combatant (raycast to the ground for the airborne-capable player, the
 * nav-surface height for always-grounded bots).
 *
 * Invariants:
 * - The light position is snapped to the shadow map's texel grid as it
 *   tracks the player, so shadow edges stay rock steady instead of crawling.
 * - The depth map re-renders only when the snapped focus moves — and the
 *   focus the two static maps follow is HELD until the live one has drifted
 *   past the rung's `hold` (`held`), because an 8 m lever on the view moves
 *   a texel's worth on nearly every frame of play. Held is never stale: the
 *   snap makes it a window the map would have drawn anyway.
 * - The depth pass draws only the casters standing in the window: a
 *   generator's through `getCustomRenderList` (Babylon culls nothing off an
 *   explicit renderList), ours through the GPU cull over the light's frustum.
 * - The depth map records BACK faces (`forceBackFacesOnly`, or `WorldDepth`'s
 *   `"back"`), so every caster must be a closed shape, and the bias is stated
 *   in metres (`CONFIG.graphics.shadows.bias`, converted by `depthBias`).
 * - A SECOND map, the foliage's, records the FRONT faces of the translucent
 *   solids and nothing else (`CelMaterialFactory.isSolid`), over the same
 *   window. It shades nothing: it is how the translucency term measures how
 *   much crown the light crossed, which a back-face map cannot say.
 * - Meshes with metadata.noShadowCaster (flat ground sheets, roads) must
 *   never be registered — they are receivers, and casting from them is acne.
 * - Blob discs are isPickable=false, metadata.noInk, and never casters.
 * - The world's casters are drawn TWICE, as two cascades off the one focus: the
 *   far map over the map's own `shadowWindow`, and the NEAR map over
 *   `CONFIG.graphics.shadows.nearWindow` at the rung's `near` resolution,
 *   which is what resolves an edge on a wall the low sun rakes. Same casters,
 *   same back faces, same bias in metres, same hold; the shader blends the
 *   near one into the far one over its last `edgeFade` (`shadowVisibility`).
 *   A rung without it binds the lit 1x1 through `nearOffMatrix`, which puts
 *   every receiver OUTSIDE its window so the far map answers alone.
 * - A THIRD directional map is the LIGHTNING's (`flash`): the world's casters
 *   drawn once along a strike, on the frame it starts, so the moon's maps
 *   never move for a flash. Render-once, back faces, its own window.
 * - Either map may be OFF (`CONFIG.graphics.shadowTiers`), and off is a bound
 *   1x1 lit texture (`litShadowTexture`) rather than an absent one: every
 *   consumer declares both samplers. A rung change re-makes a map at the new
 *   size — a generator re-adding the casters `setCasters` last handed over,
 *   or our texture, owed a draw.
 * - A map that changes hands is re-published to every reader and drawn by its
 *   new owner from where its light stands, as a fresh generator renders on
 *   its first frame; ours draws on the next frame our renderer prepares, and
 *   `ready` says when it has.
 * - The light matrix of a map of ours is `getTransformMatrix`'s arithmetic,
 *   in the same order on the same helpers (`lightTransform`), so a reader
 *   samples the texel the generator's matrix named.
 * - updateBlobs takes the player's ground height rather than probing for it:
 *   Player.floorY is that number, already found this frame.
 */
import {
  type AbstractMesh,
  BaseTexture,
  Color3,
  DirectionalLight,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  RenderTargetTexture,
  type Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  Vector3,
  type WebGPUEngine,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import {
  depthBias,
  litShadowTexture,
  SHADOW_NEAR,
  ShadowWindow,
} from "../core/shadowWindow";
import type { ShadowQuality } from "../core/settings";
import type { Combatant } from "../entities/Combatant";
import { WORLD_SHADOW_MAPS, type WorldShadowMap, type WorldShadows } from "../render/WorldShadows";
import type { CelMaterialFactory } from "../shaders/CelShader";

/**
 * The layer the foliage light is pinned to, which no mesh carries — so the
 * light defines a shadow frustum and lights nothing. Distinct from
 * `BodyShadows`' proxy layer, which a mesh DOES carry.
 */
const FOLIAGE_LAYER = 0x20000000;

/** The lightning light's layer, for the same reason: it lights nothing. */
const FLASH_LAYER = 0x40000000;

/** The near cascade's light's layer, for the same reason again. */
const NEAR_LAYER = 0x80000000;

/**
 * The lightning map's largest side. A strike lasts half a second and is
 * judged by the SHAPE of what it throws, so it never needs the moon's full
 * resolution — and it is a whole world depth pass, once per strike.
 */
const FLASH_MAP_MAX = 1024;

/**
 * One world map: its light (a generator is one per light), its window (the
 * snap is in texels of ITS size), its resolution under the current rung,
 * Babylon's generator while the map is Babylon's, our texture's wrapped view
 * while it is ours, the matrix ours is drawn and read with, and its cull
 * scratch.
 */
interface WorldMap {
  readonly name: WorldShadowMap;
  readonly light: DirectionalLight;
  readonly win: ShadowWindow;
  /** 0 is off, -1 not yet set — see `docs/rendering.md`, "The shadow rungs". */
  size: number;
  generator: ShadowGenerator | null;
  /** Babylon's view of our texture, while the map is ours and has one. */
  wrapped: BaseTexture | null;
  /** The light's view-projection while the map is ours, rewritten in place. */
  readonly matrix: Matrix;
  /** The generator's render-list cull, rebuilt on the frames it re-renders. */
  readonly casters: AbstractMesh[];
}

export class ShadowSystem {
  /** The moon's light: the far cascade's, which the other three copy their direction from. */
  private readonly light: DirectionalLight;
  /**
   * The four maps, by name.
   *
   * **Why the foliage has a map of its own.** The world map records back faces
   * so that a lit surface is compared against the far side of its own wall
   * rather than against itself, which is what let its bias drop from 63 cm to
   * 5. That same choice makes a face turned AWAY from the key its own recorded
   * surface, so the map can no longer say how much of a pine's crown the light
   * crossed on the way to it — and the translucency term needs exactly that to
   * light a crown at its thin rim and not across its whole shaded side. The
   * foliage's map is the front half of that measurement, drawn from the
   * translucent solids alone, so it costs a handful of merged foliage draws
   * rather than a second world. It shares the far map's focus, direction and
   * side; its window is its own because the snap is in texels of ITS size.
   */
  private readonly maps: Record<WorldShadowMap, WorldMap>;
  /**
   * Whether the world's maps are OUR renderer's this map (`WorldShadows`) or
   * the generators' — see the header.
   */
  private ours = false;
  /**
   * What `setCasters` was last handed, kept so a rung change can rebuild a
   * generator at a new size and give it the same casters back. The meshes are
   * the map's and are disposed with it; `setCasters` replaces this with the
   * next map's before anything could draw a stale one.
   */
  private casters: readonly Mesh[] = [];
  /**
   * What `lightMatrix` answers while the map is off: EVERY point to the MIDDLE
   * of the volume, (0.5, 0.5) at depth 0.5, so every reader samples the lit
   * 1x1 texel as fully KNOWN. It is not the identity because it IS read then —
   * `giFarShadow` hands a receiver outside the window to the volume's coarse
   * sun test, and the identity's window is a 2 m box at the world origin, so
   * shadows OFF drew the probes' blocky sun shadow everywhere but there.
   */
  private readonly offMatrix = Matrix.FromValues(
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0.5, 1,
  );
  /**
   * What the near matrix answers while that map is OFF: every receiver at
   * uv (-1, -1), outside the window, so the cascade blend gives the far map
   * all of it. Not `offMatrix`'s middle of the volume, which would read as a
   * near map saying "lit" over everything the far map shades.
   */
  private readonly nearOffMatrix = Matrix.FromValues(
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    -3, -3, 0.5, 1,
  );
  /** Where a map's light stands, as `WorldShadows.draw` takes it. */
  private readonly lightEye = new Float32Array(3);
  /** `lightTransform`'s scratch. */
  private readonly lightView = new Matrix();
  private readonly lightProjection = new Matrix();
  private readonly lightDir = new Vector3();
  private readonly lightTarget = new Vector3();
  private readonly blobMaterial: StandardMaterial;
  private readonly blobs = new Map<Combatant, Mesh>();
  /**
   * Wired by `Game`: where a downed body's shadow goes, into `out`, and how
   * strong (0..1). 0 means "nothing to shade", which is every corpse nobody
   * has claimed — so the default below is exactly the old behaviour.
   *
   * `out.y` is the FLOOR the body came to rest on, not the body's own height:
   * a corpse moves after it dies, so neither its height nor the one it was
   * standing at when it was shot is the answer. `Game` resolves it off the
   * nav surface nearest the body, falling back to the drawn terrain, because
   * a body on a deck and a body in a basin both have to be shaded.
   *
   * A callback rather than an import, because a system reaching into another
   * system is the thing `Game`'s wiring exists to prevent.
   */
  corpseShadow: (cbt: Combatant, out: Vector3) => number = () => 0;
  /** Scratch for that callback — no per-frame allocation. */
  private readonly corpseAt = new Vector3();
  private fogStart = 24;
  private fogEnd = 78;
  /**
   * The ortho window's side, in metres — `CONFIG.graphics.shadows.frustumSize`
   * until a map states its own (`EnvironmentSpec.lighting.shadowWindow`).
   *
   * It is the map's for the reason `fogEnd` is: how far a shadow REACHES is a
   * function of the key light's elevation and of how tall the map builds, and
   * the two shipped valleys agree about neither with a downtown. A 40 m tower
   * throws 25 m at Coldharbour's old 58 deg sun and 90 m at the 24 it has now,
   * so a window sized for the first truncates the second across open ground.
   *
   * **How FAR the boundary is, and never how it reads.** The last
   * `CONFIG.graphics.shadows.edgeFade` of the volume ramps the shadow term
   * back to fully lit, so what a player crosses is a gradient — but a gradient
   * on ground with nothing between it and the eye is still a transition in the
   * open, which is why Sarab needed 240 as well as the ramp.
   */
  private window: number = CONFIG.graphics.shadows.frustumSize;
  /** The rung's `hold`, in metres — see `held`. */
  private hold = 0;
  /**
   * The focus the two static maps are actually centred on: the live one,
   * re-taken only once it has drifted more than `hold` from here. Infinite
   * means "take the next focus whatever it is", which is how a window that
   * was invalidated re-centres at once rather than up to `hold` late.
   */
  private readonly held = new Vector3(Infinity, Infinity, Infinity);

  /**
   * The moon's depth map, for a reader that is not a material.
   *
   * `mats` gets this pushed when it changes, and the texture object is stable
   * while its contents re-render — so a second reader that is not in the
   * factory's lists (the volumetric pass, which is a `PostProcess` and not a
   * `ShaderMaterial`) has to come and ask. It is the same texture, not a copy.
   */
  get depthMap(): BaseTexture {
    return this.mapTexture(this.maps.far);
  }

  /**
   * The light's view*projection, for the same reader and with one caveat worth
   * stating: the matrix is MUTATED IN PLACE — a generator's by Babylon, ours
   * by `lightTransform` — so what a caller holds tracks the shadow camera
   * whether or not it asks again. That is an implementation detail rather
   * than a promise — the same one `update` declines to lean on below — so a
   * caller that can afford to re-read every frame should.
   */
  get lightMatrix(): Matrix {
    return this.matrixOf(this.maps.far) ?? this.offMatrix;
  }

  /**
   * Whether every map is drawn for the casters `setCasters` last handed over:
   * at once for a generator, which renders inside the frame that samples it,
   * and for ours once `WorldShadows` has drawn every map owed. What a reader
   * that samples a map once and keeps the answer waits on — the probes' bake.
   */
  get ready(): boolean {
    return !this.ours || this.world.settled;
  }

  constructor(
    private scene: Scene,
    private readonly mats: CelMaterialFactory,
    quality: ShadowQuality,
    /** Our renderer's maps: who draws the world's shadows whenever the handover holds every caster. */
    private readonly world: WorldShadows,
  ) {
    const c = CONFIG.graphics.shadows;
    const lightOf = (name: string, dir: Vector3, side: number, layer: number | null): DirectionalLight => {
      const light = new DirectionalLight(name, dir, scene);
      // Pinned to a layer no mesh carries, so it can never become a lighting
      // light for a StandardMaterial (BodyShadows' rule) — all but the moon's.
      if (layer !== null) light.includeOnlyWithLayerMask = layer;
      // Fixed square ortho window; auto-extends against the render list would
      // stretch the window to the whole 240 m map and halve the texel density.
      light.shadowFrustumSize = side;
      light.shadowMinZ = SHADOW_NEAR;
      light.shadowMaxZ = c.depthRange;
      light.autoUpdateExtends = false;
      return light;
    };
    this.light = lightOf("moonShadow", new Vector3(-0.3, -0.85, 0.42).normalize(), this.window, null);
    const map = (name: WorldShadowMap, light: DirectionalLight): WorldMap => ({
      name,
      light,
      win: new ShadowWindow(),
      size: -1,
      generator: null,
      wrapped: null,
      matrix: new Matrix(),
      casters: [],
    });
    this.maps = {
      far: map("far", this.light),
      // The near cascade: the moon's volume over the near window.
      near: map("near", lightOf("nearShadow", this.light.direction.clone(), c.nearWindow, NEAR_LAYER)),
      foliage: map("foliage", lightOf("foliageDepth", this.light.direction.clone(), this.window, FOLIAGE_LAYER)),
      // The lightning's light: aimed per strike by `flash`, and otherwise the
      // moon's volume exactly.
      flash: map("flash", lightOf("flashDepth", new Vector3(0, -1, 0), this.window, FLASH_LAYER)),
    };

    // The maps are made here, once all four lights exist.
    this.setQuality(quality);
    // Our casters going back to Babylon mid-map: the world's shadows are the
    // generators' again from the next frame.
    world.onLost(() => this.handOver(false));

    // Blob shadow: a radial-gradient disc, unlit black, depth-write off so it
    // layers over the ground without z-fighting.
    const tex = new DynamicTexture(
      "blobShadowTex",
      { width: 128, height: 128 },
      scene,
      false,
    );
    const ctx = tex.getContext();
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.55)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    tex.update();
    this.blobMaterial = new StandardMaterial("blobShadow", scene);
    this.blobMaterial.emissiveColor = Color3.Black();
    this.blobMaterial.diffuseColor = Color3.Black();
    this.blobMaterial.specularColor = Color3.Black();
    this.blobMaterial.disableLighting = true;
    this.blobMaterial.opacityTexture = tex;
    this.blobMaterial.disableDepthWrite = true;
  }

  /**
   * Stands every map up at a rung's sizes (`CONFIG.graphics.shadowTiers`),
   * and binds each one's texture and parameters to every consumer.
   *
   * A map whose size did not move is left exactly as it was — the same
   * generator or texture, the same caster list, no re-render. One that did is
   * re-made from nothing: a `ShadowGenerator`'s size is fixed at construction,
   * so a new resolution is a new generator, and the casters come back from
   * `casters` — or, while the maps are ours, a new texture, owed a draw. Its
   * window is invalidated with it, because the texel snap is in texels of a
   * size that just changed.
   */
  setQuality(quality: ShadowQuality): void {
    const tier = CONFIG.graphics.shadowTiers[quality];
    this.hold = tier.hold;
    const sizes: Record<WorldShadowMap, number> = {
      far: tier.sun,
      // The near cascade only ever sits INSIDE a far map, so a rung with the
      // sun off has none whatever its row says.
      near: tier.sun > 0 ? tier.near : 0,
      foliage: tier.foliage,
      flash: Math.min(tier.sun, FLASH_MAP_MAX),
    };
    this.world.rungDraws = WORLD_SHADOW_MAPS.some((name) => sizes[name] > 0);
    for (const name of WORLD_SHADOW_MAPS) {
      const map = this.maps[name];
      if (sizes[name] === map.size) continue;
      map.size = sizes[name];
      if (this.ours) this.remakeOurs(map);
      else this.remakeGenerator(map);
      // A fresh generator renders on its first frame from where its light
      // stands; ours is owed the same — a draw the next placement may well
      // repeat, but a pause menu's rung change places nothing until play
      // resumes, and the map must not stand empty behind it.
      if (this.ours && name !== "flash") this.drawOurs(map);
      map.win.invalidate();
      // The flash follows no held focus: it is placed per strike.
      if (name !== "flash") this.held.setAll(Infinity);
      this.publish(map);
    }
  }

  /**
   * `map`'s generator at its size, holding the casters already handed over —
   * none at size 0.
   */
  private remakeGenerator(map: WorldMap): void {
    map.generator?.dispose();
    map.generator = map.size > 0 ? this.buildGenerator(map) : null;
  }

  /** A generator for `map` at its size, holding its share of `casters`. */
  private buildGenerator(map: WorldMap): ShadowGenerator {
    const gen = new ShadowGenerator(map.size, map.light);
    // Bias lives consumer-side in the cel shader (shadowParams), where the
    // facet normal is known — not baked into the caster depths.
    gen.bias = 0;
    // The FAR side of every caster, which is what lets the bias be
    // centimetres rather than the 63 cm a front-face map needed. A lit face is
    // then compared against the back of its own wall or roof — a thickness
    // behind it — rather than against itself, so there is no acne to hide and
    // no bias-sized band of light where an eave meets the wall under it. What
    // it asks of the casters is that they are CLOSED, which every piece the
    // kit builds is (boxes, capped cylinders, the gable prism): an open sheet
    // would record only the side facing away and cast from there. The
    // foliage's map is the one that records the near side (see the header).
    gen.forceBackFacesOnly = map.name !== "foliage";
    const rtt = gen.getShadowMap();
    if (rtt) {
      // Re-render only when told to (resetRefreshCounter in update/setCasters)
      // — the world is static, so the depth pass is wasted on frames where
      // the texel-snapped light window didn't move.
      rtt.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      rtt.resetRefreshCounter();
      // Draw only what stands in the window. Babylon culls NOTHING off an
      // explicit renderList — `ObjectRenderer._prepareRenderingManager`
      // dispatches every mesh that is enabled and visible — so without this
      // the depth pass submits the whole village on every re-render: measured
      // at 314 casters and 79k triangles, against ~150 that can reach the
      // window. It is called only on the frames that actually re-render,
      // which is why the cull is computed here rather than kept up to date in
      // `update`.
      rtt.getCustomRenderList = () => this.cullToWindow(rtt.renderList ?? [], map);
    }
    for (const m of this.casters) if (this.casts(map, m)) gen.addShadowCaster(m, false);
    return gen;
  }

  /**
   * Whether `mesh` is one of `map`'s generator's casters: every caster, or for
   * the foliage's the translucent solids alone. Our side's statement of the
   * same rule is `BlockHandover.passesOf`, which also states the blend test a
   * generator makes for itself: the two must agree.
   */
  private casts(map: WorldMap, mesh: Mesh): boolean {
    if (mesh.metadata?.noShadowCaster) return false;
    // A translucent SOLID goes in both: the world's maps for what it hides,
    // and the foliage's for how thick it is.
    return map.name !== "foliage" || this.mats.isSolid(mesh.material);
  }

  /**
   * `map`'s texture of ours re-made at its size — cleared to lit — and
   * Babylon's view of it with it. Disposing the old view destroys the texture
   * it wraps (Babylon releases it at the end of its frame), so the texture is
   * made AFRESH whatever its size, never kept under a view that is going.
   */
  private remakeOurs(map: WorldMap): void {
    map.wrapped?.dispose();
    map.wrapped = null;
    this.world.setSize(map.name, 0);
    this.world.setSize(map.name, map.size);
    map.wrapped = this.wrap(map.name);
  }

  /**
   * Babylon's view of our `name` texture (`BABYLON_EXIT.md` rule 5: the side
   * that does not own a texture reads a wrapped view of it), sampled as the
   * generator's was — nearest, clamped. A wrapped texture has no view until
   * it is re-pointed, so it is re-pointed at itself.
   */
  private wrap(name: WorldShadowMap): BaseTexture | null {
    const texture = this.world.texture(name);
    if (!texture) return null;
    const engine = this.scene.getEngine() as WebGPUEngine;
    const internal = engine.wrapWebGPUTexture(texture);
    engine.updateWrappedWebGPUTexture(internal, texture);
    engine.updateTextureSamplingMode(Texture.NEAREST_SAMPLINGMODE, internal);
    const wrapped = new BaseTexture(this.scene, internal);
    wrapped.name = `${name}Shadow`;
    wrapped.wrapU = Texture.CLAMP_ADDRESSMODE;
    wrapped.wrapV = Texture.CLAMP_ADDRESSMODE;
    return wrapped;
  }

  /**
   * Hands the world's maps to our renderer (`ours`) or to the generators,
   * re-making every map on its new owner at the rung's sizes and publishing
   * it. A fresh generator renders on its first frame; ours are owed their
   * draws by whoever handed them over (`setCasters`). A hand to the side
   * that already holds them is nothing.
   */
  private handOver(ours: boolean): void {
    if (ours === this.ours) return;
    this.ours = ours;
    for (const name of WORLD_SHADOW_MAPS) {
      const map = this.maps[name];
      if (ours) {
        map.generator?.dispose();
        map.generator = null;
        this.remakeOurs(map);
      } else {
        map.wrapped?.dispose();
        map.wrapped = null;
        this.world.setSize(name, 0);
        this.remakeGenerator(map);
      }
      this.publish(map);
    }
  }

  /** What `map` is bound as: its owner's texture, or the lit 1x1 while it has none. */
  private mapTexture(map: WorldMap): BaseTexture {
    const texture = this.ours ? map.wrapped : map.generator?.getShadowMap();
    return texture ?? litShadowTexture(this.scene);
  }

  /** `map`'s light matrix as its owner draws it — null while it is off. */
  private matrixOf(map: WorldMap): Matrix | null {
    if (this.ours) return map.size > 0 ? map.matrix : null;
    return map.generator?.getTransformMatrix() ?? null;
  }

  /**
   * `map`'s texture and parameters, bound to every consumer — and our own
   * texture beside it to our renderer's frame, while the map is ours.
   */
  private publish(map: WorldMap): void {
    const c = CONFIG.graphics.shadows;
    const shadows = this.mats.shadows;
    const texture = this.mapTexture(map);
    const own = this.ours && map.wrapped ? this.world.own(map.name) : null;
    switch (map.name) {
      case "far":
        shadows.setShadowMap(texture, own);
        shadows.setShadowParams(depthBias(c.bias, c.depthRange), c.darkness, c.normalBias);
        shadows.setShadowMatrix(this.lightMatrix);
        return;
      case "near":
        shadows.setNearShadowMap(texture, own);
        shadows.setNearShadowParams(
          depthBias(c.bias, c.depthRange),
          (c.nearNormalBiasTexels * c.nearWindow) / Math.max(1, map.size),
        );
        shadows.setNearShadowMatrix(this.matrixOf(map) ?? this.nearOffMatrix);
        return;
      case "flash": {
        shadows.setFlashMap(texture, own);
        shadows.setFlashParams(depthBias(c.bias, c.depthRange));
        const matrix = this.matrixOf(map);
        if (matrix) shadows.setFlashMatrix(matrix);
        return;
      }
      case "foliage": {
        shadows.setFoliageMap(texture, own);
        shadows.setFoliageParams(depthBias(1, c.depthRange));
        const matrix = this.matrixOf(map);
        if (matrix) shadows.setFoliageMatrix(matrix);
        return;
      }
    }
  }

  /**
   * `map`'s light view-projection into `map.matrix`, as Babylon's
   * `ShadowGenerator.getTransformMatrix` computes it for a `DirectionalLight`
   * with a fixed frustum and no parent — the same helpers in the same order,
   * so the same float32 numbers: a look-at from the light's position along
   * its direction, nudged off the vertical, and `OrthoLH` over the frustum's
   * side and the light's depth range in the engine's half-z range.
   */
  private lightTransform(map: WorldMap): void {
    const light = map.light;
    const dir = this.lightDir;
    Vector3.NormalizeToRef(light.direction, dir);
    // `UpReadOnly` where Babylon makes a fresh `Up()`: the same numbers, no garbage.
    if (Math.abs(Vector3.Dot(dir, Vector3.UpReadOnly)) === 1.0) dir.z = 0.0000000000001;
    light.position.addToRef(dir, this.lightTarget);
    Matrix.LookAtLHToRef(light.position, this.lightTarget, Vector3.UpReadOnly, this.lightView);
    Matrix.OrthoLHToRef(
      light.shadowFrustumSize,
      light.shadowFrustumSize,
      light.shadowMinZ,
      light.shadowMaxZ,
      this.lightProjection,
      this.scene.getEngine().isNDCHalfZRange,
    );
    this.lightView.multiplyToRef(this.lightProjection, map.matrix);
  }

  /** `map`, ours, drawn from where its light stands on the next frame our renderer prepares. */
  private drawOurs(map: WorldMap): void {
    if (map.size <= 0) return;
    this.lightTransform(map);
    map.light.position.toArray(this.lightEye);
    this.world.draw(map.name, map.matrix.m, this.lightEye);
  }

  /** `map` re-drawn by its owner: the generator's counter re-armed, or ours owed a draw. */
  private redraw(map: WorldMap): void {
    if (this.ours) this.drawOurs(map);
    else map.generator?.getShadowMap()?.resetRefreshCounter();
  }

  /**
   * Aims the lightning's map along a strike and draws it ONCE, around the same
   * focus the moon's window follows. Called on the frame a strike starts and
   * at no other time: a strike is half a second, and a player who crosses a
   * texel in that time is not going to see the shadow lag him.
   *
   * The matrix goes to every material here, and the map renders inside this
   * frame's `scene.render()` — or, ours, in the encoder submitted ahead of it
   * — before the main pass that samples it.
   */
  flash(direction: Vector3, focus: Vector3): void {
    const map = this.maps.flash;
    if (map.size <= 0) return;
    const light = map.light;
    light.direction.copyFrom(direction).normalize();
    light.shadowFrustumSize = this.window;
    map.win.invalidate();
    map.win.place(light, focus, this.window, map.size, CONFIG.graphics.shadows.distance);
    this.redraw(map);
    const matrix = this.matrixOf(map);
    if (matrix) this.mats.shadows.setFlashMatrix(matrix);
  }

  /**
   * Resizes the ortho window to the map's own (`EnvironmentSpec.lighting.shadowWindow`).
   *
   * **The window is bounded by two different things and only one of them is
   * this.** It is a square perpendicular to the light, so its footprint on the
   * ground stretches by `1/sin(elevation)` along the sun's azimuth — and along
   * THAT axis it is `depthRange` that binds, not this. Which one is the
   * constraint is therefore a function of the map's hour: at Hollowmere's 38
   * degrees the two are close, and at a low sun the along-sun reach comes for
   * free while the across-sun reach is all this buys.
   *
   * So a map that lowers its sun raises this to match, and there is a ceiling
   * past which it buys nothing: the depth volume reaches `shadowMaxZ` either
   * side of the light camera, which lands on the ground along the sun as
   * `2 * halfDepth / cos(elevation)`. With the shipped `distance` 90 and
   * `depthRange` 180 that half-depth is 89.5 m, so at 24 degrees the along-sun
   * reach is +/-98 m and matching it across-sun wants ~196. Widening
   * `depthRange` to push past that no longer moves the bias — it is stated in
   * metres and converted against the volume (`depthBias`) — but it does cost
   * depth precision: the map is half-float, so its rounding in metres grows
   * with the volume, and the bias has to stay above it.
   *
   * Invalidating the snapped focus is not optional. The texel quantum is
   * `window / mapSize`, so changing the window changes the grid the focus is
   * rounded to, and a focus still snapped to the old quantum is stale — which
   * shows up as the crawling edges the snapping exists to prevent.
   */
  setShadowWindow(metres: number): void {
    // Before the early-out, because the DIRECTION may have moved while the
    // number stayed put — a map rotation is `setLightDirection` then this, and
    // which of the two bounds binds is a function of the elevation.
    if (import.meta.env.DEV) this.warnIfWindowIsWasted(metres);
    if (metres === this.window) return;
    this.window = metres;
    for (const map of [this.maps.far, this.maps.foliage]) {
      map.light.shadowFrustumSize = metres;
      map.win.invalidate();
    }
    this.held.setAll(Infinity);
  }
  /**
   * The ceiling the doc above derives, checked instead of trusted.
   *
   * A map raises its window because its shadows are longer than 110 m, and the
   * failure it is trying to fix is the shadows stopping on ground the player
   * can see — a gradient since `CONFIG.graphics.shadows.edgeFade`, a hard line
   * before it, and in the wrong place either way — so it is a number chosen by
   * looking, and there is no feedback at all when it is chosen too big: the depth volume binds along the sun's own azimuth, the
   * line stays exactly where it was on that axis, and the extra metres are
   * paid for in texel density (`window / mapSize`, 5.4 cm at 110 and 9.8 at
   * 200) and in casters. `ENGINE_UPGRADE.md` S8 is where this cost a map.
   *
   * DEV-only and a warning rather than a clamp, for `MapBuilder`'s reason:
   * the window is still the author's, and a map may want the across-sun reach
   * knowing the along-sun one cannot follow. What it may not do is want it by
   * accident.
   *
   * **The four shipped maps are the evidence that the ceiling is the right
   * one, and none of them trips this**: Harrowmead states 185 against a 183.8
   * ceiling at its 14.5-degree sun and Coldharbour 200 against 194.9 at 24, so
   * both were authored by eye onto within a couple of metres of a number
   * neither file names. Greyfen (140 of 201.6) and Hollowmere (110 of 226.5)
   * are well inside it, and the proving ground's near-overhead noon has a
   * ceiling of 433.
   */
  private warnIfWindowIsWasted(metres: number): void {
    const c = CONFIG.graphics.shadows;
    const d = this.light.direction;
    // cos(elevation) — the direction is normalised by `setLightDirection` and
    // by the constructor, so this is the horizontal component outright. A sun
    // straight overhead casts nothing sideways and has no such ceiling.
    const horiz = Math.hypot(d.x, d.z);
    if (horiz < 1e-3) return;
    // The volume runs from `shadowMinZ - distance` to `depthRange - distance`
    // either side of the focus; the shorter half is the one that binds.
    const halfDepth = Math.min(
      c.distance - this.light.shadowMinZ,
      c.depthRange - c.distance,
    );
    // Where that half lands on the GROUND along the sun's azimuth, doubled to
    // put it in the same units as the window's own side.
    const ceiling = (2 * halfDepth) / horiz;
    // A tenth of slack: the two bounds are different shapes (a square against
    // a slab) and being within a few metres of the ceiling is a map that has
    // sized it correctly, not one that has overshot.
    if (metres <= ceiling * 1.1) return;
    const elevation = Math.round((Math.asin(-d.y) * 180) / Math.PI);
    console.warn(
      `[shadows] shadowWindow ${metres} m is past what depthRange can carry` +
        ` at ${elevation} deg: the along-sun reach stops at ~${Math.round(ceiling)} m` +
        " whatever this says, so the rest is texel density spent for nothing.",
    );
  }

  /** Points the shadow camera along the environment's key light. */
  setLightDirection(direction: readonly [number, number, number]): void {
    this.light.direction = new Vector3(
      direction[0],
      direction[1],
      direction[2],
    ).normalize();
    this.maps.foliage.light.direction = this.light.direction.clone();
    this.maps.near.light.direction = this.light.direction.clone();
    // Invalidate the snapped focus so the light re-centres on next update.
    this.maps.far.win.invalidate();
    this.maps.foliage.win.invalidate();
    this.maps.near.win.invalidate();
    this.held.setAll(Infinity);
  }

  /** Blob shadows fade with the same fog wall that hides distant geometry. */
  setFogRange(start: number, end: number): void {
    this.fogStart = start;
    this.fogEnd = end;
  }

  /**
   * Replaces the caster set with the freshly built map's visual meshes.
   * Called after every MapBuilder.build() — the previous round's meshes are
   * disposed, and a stale renderList entry would break the depth pass.
   *
   * **And it is where the maps change hands**: after `BlockHandover.install`,
   * which hands `WorldShadows` the casters when it holds every one, so the
   * world's shadows are ours from here when it did and the generators'
   * when it did not. An EMPTY set (`Game.teardownMap`) keeps whoever holds
   * them — there is nothing to cast either way, and `WorldShadows` has
   * already cleared ours to lit — so a round does not rebuild four
   * generators on its way out.
   */
  setCasters(meshes: readonly Mesh[]): void {
    this.casters = meshes;
    if (meshes.length > 0) this.handOver(this.world.casters !== null);
    for (const name of WORLD_SHADOW_MAPS) {
      const map = this.maps[name];
      const gen = map.generator;
      const rtt = gen?.getShadowMap();
      if (!gen || !rtt) continue;
      if (rtt.renderList) for (const m of rtt.renderList.slice()) gen.removeShadowCaster(m, false);
      for (const m of meshes) if (this.casts(map, m)) gen.addShadowCaster(m, false);
    }
    // Drawn again for the new casters — the flash per strike and at no other
    // time — by whoever holds them.
    if (meshes.length > 0) for (const map of [this.maps.far, this.maps.near, this.maps.foliage]) this.redraw(map);
  }

  /**
   * The casters of a GENERATOR that can write into its window — ours are
   * culled on the GPU (`WorldDepth`).
   *
   * The light is ORTHOGRAPHIC, so a caster's shadow lands at its own position
   * in the light's plane — depth slides it along the view axis and never
   * sideways. That is what makes this exact rather than a guess: testing a
   * caster's bounds against the window in that plane cannot drop anything that
   * could have darkened a texel, so the depth map is identical to the one the
   * full list produces. A cull that had to allow for shadows cast in from
   * outside would need the window extended along the light, and this one does
   * not.
   *
   * The caster is measured as its world BOX rather than its bounding sphere —
   * the |e·a| half-extent projection, exact for an AABB — because a block
   * merge produces meshes that are wide and flat, and a sphere around one has
   * a 34 m radius where the block is four metres tall. Measured on Hollowmere:
   * 314 casters to 153 through the sphere, to ~150 through the box.
   *
   * **What bounds this is the granularity of a caster, not the test.** Every
   * caster is one `BlockMerge` mesh — one per 48 m map block per colour, ~12
   * to a block — so a 110 m window straddling four blocks each way admits
   * everything in sixteen of them however tight the arithmetic. Splitting them
   * finer would cull better and cost the main pass the draw calls the merge
   * exists to save, which is a bad trade in the other direction.
   *
   * Every caster's world matrix is frozen, so this is a handful of dot
   * products per caster on the frames that re-render.
   */
  private cullToWindow(all: readonly AbstractMesh[], map: WorldMap): AbstractMesh[] {
    const c = CONFIG.graphics.shadows;
    const { light, win } = map;
    const half = light.shadowFrustumSize / 2;
    const dir = light.direction;
    const ax = win.axisX;
    const ay = win.axisY;
    // Where the light's camera sits along its own view axis. The window's
    // near and far planes are measured from there.
    const camDepth = win.snapped.z - c.distance;
    const near = camDepth + light.shadowMinZ;
    const far = camDepth + light.shadowMaxZ;
    const list = map.casters;
    list.length = 0;
    for (const mesh of all) {
      const box = mesh.getBoundingInfo().boundingBox;
      const p = box.centerWorld;
      const e = box.extendSizeWorld;
      const u = p.x * ax.x + p.y * ax.y + p.z * ax.z;
      const ru = Math.abs(e.x * ax.x) + Math.abs(e.y * ax.y) + Math.abs(e.z * ax.z);
      if (Math.abs(u - win.snapped.x) > half + ru) continue;
      const v = p.x * ay.x + p.y * ay.y + p.z * ay.z;
      const rv = Math.abs(e.x * ay.x) + Math.abs(e.y * ay.y) + Math.abs(e.z * ay.z);
      if (Math.abs(v - win.snapped.y) > half + rv) continue;
      const w = p.x * dir.x + p.y * dir.y + p.z * dir.z;
      const rw =
        Math.abs(e.x * dir.x) + Math.abs(e.y * dir.y) + Math.abs(e.z * dir.z);
      if (w + rw < near || w - rw > far) continue;
      list.push(mesh);
    }
    return list;
  }

  /**
   * Forces the depth pass to re-render next frame even though the snapped
   * focus has not moved. `update()` skips the render when the window has not
   * shifted, which is right in play — the map is static — but wrong when a
   * caster itself moves, as it does under the map editor's drag.
   */
  invalidate(): void {
    this.redraw(this.maps.far);
    this.redraw(this.maps.near);
    this.redraw(this.maps.foliage);
  }

  /**
   * Recentres the shadow window on the focus (the player, biased a little
   * along the camera's view) and re-uploads the light matrix. The recentre is
   * snapped to whole shadow-map texels in the light's own view basis, which
   * `core/shadowWindow.ts` owns and argues — this file's business with it is
   * only what a MOVE costs: the depth pass re-renders, and the matrix goes out
   * to every material, on the frames the snapped focus actually changed and on
   * no others.
   */
  update(focus: Vector3, mats: CelMaterialFactory): void {
    const c = CONFIG.graphics.shadows;
    // The snap itself is `core/shadowWindow.ts`, shared with `BodyShadows`
    // rather than written twice — two maps that disagreed about where one
    // focus lands would shade a body against a wall it is not standing by.
    const held = this.held;
    if (Vector3.DistanceSquared(focus, held) > this.hold * this.hold) held.copyFrom(focus);
    const { far, near, foliage } = this.maps;
    if (far.size > 0 && far.win.place(far.light, held, this.window, far.size, c.distance)) {
      this.redraw(far);
      // Inside the guard, where it belongs: this is the branch that just
      // decided the shadow camera moved, and the matrix is a function of
      // nothing else. Outside it, every frame paid a `setMatrix` on every cel
      // material plus the grass and the water to re-hand them a matrix that
      // had not changed — and the contract line above already claimed
      // otherwise.
      //
      // It is cheap even when it does run, and cheaper than it looks to skip:
      // the matrix is mutated in place (a generator's by Babylon, ours by
      // `lightTransform`) and `ShaderMaterial.setMatrix` stores the
      // REFERENCE, so what the materials hold tracks it whether or not this
      // line runs again. That is an implementation detail rather than a
      // promise, which is why this stays a real re-upload on the frames the
      // window moves instead of being deleted outright.
      mats.shadows.setShadowMatrix(this.lightMatrix);
    }
    // The near cascade, off the same held focus on its own (finer) grid.
    if (near.size > 0 && near.win.place(near.light, held, c.nearWindow, near.size, c.distance)) {
      this.redraw(near);
      mats.shadows.setNearShadowMatrix(this.matrixOf(near) ?? this.nearOffMatrix);
    }
    // The foliage's window, off the same focus on its own texel grid. A
    // separate test because the two grids are different sizes: one moving
    // does not mean the other has.
    if (foliage.size > 0 && foliage.win.place(foliage.light, held, this.window, foliage.size, c.distance)) {
      this.redraw(foliage);
      const matrix = this.matrixOf(foliage);
      if (matrix) mats.shadows.setFoliageMatrix(matrix);
    }
  }

  /**
   * Moves every combatant's blob to their feet. Bots' `position.y` IS the nav
   * surface they stand on; the player can be airborne, so their blob needs the
   * floor found under them rather than their own height.
   *
   * That floor is PASSED IN, and it is `Player.floorY` — the number
   * `Player.probeGround` found on this same frame, a few calls earlier in
   * `updateGameplay`. This used to cast its own downward ray for it, which was
   * the identical probe against the identical collider set for the identical
   * body: measured at 1.45 ms a frame, because `scene.pickWithRay` with a
   * predicate walks all 1,775 meshes and ray-tests all 758 solid colliders.
   * Two whole-scene picks a frame where the game only ever needed one.
   *
   * **The probe is analytic now and this still passes the number rather than
   * asking again.** What made it wrong was never the price: two answers to
   * "where is the floor under this body" is two answers, and a blob under the
   * feet is exactly where the shadow has to be.
   *
   * Blobs fade out toward the fog wall.
   */
  updateBlobs(
    player: Combatant,
    bots: readonly Combatant[],
    camPos: Vector3,
    playerGroundY: number,
  ): void {
    this.updateBlob(player, camPos, playerGroundY);
    for (const bot of bots) this.updateBlob(bot, camPos, bot.position.y);
  }

  /**
   * Switches every blob off, keeping them: `Game.teardownMap`. A blob is only
   * placed by a frame that simulates, so without this each one stays lit at
   * the feet of a body on a floor that no longer exists. The next
   * `updateBlobs` puts back whichever are owed.
   */
  hideBlobs(): void {
    for (const blob of this.blobs.values()) blob.setEnabled(false);
  }

  /**
   * `cbt`'s blob switched on at its standing opacity, or back off, for the
   * frames of the building card's pipeline warm-up (`core/PipelineWarmup.ts`)
   * — so the frame a body first stands on the floor does not also compile the
   * blob's blended pipeline. It is the player's blob that `Game` asks for,
   * which the first `updateBlobs` of the round would build anyway. A blob some
   * frame has already switched on is left alone, and only the one this switched
   * on is switched off.
   */
  warmBlob(on: boolean, cbt: Combatant): void {
    if (!on) {
      if (this.warmedBlob) this.warmedBlob.setEnabled(false);
      this.warmedBlob = null;
      return;
    }
    const fresh = !this.blobs.has(cbt);
    const blob = this.blobFor(cbt);
    if (!fresh && blob.isEnabled(false)) return;
    blob.visibility = CONFIG.graphics.shadows.blobOpacity;
    blob.setEnabled(true);
    this.warmedBlob = blob;
  }
  private warmedBlob: Mesh | null = null;

  private updateBlob(cbt: Combatant, camPos: Vector3, groundY: number): void {
    const blob = this.blobFor(cbt);
    // A dead combatant normally has no shadow, and for the 0.9 s the collapse
    // tween takes that was never visible enough to matter. A ragdoll lies
    // there for six seconds, and a body with nothing under it reads as a
    // decal painted on the street — so whoever owns the corpse gets to say
    // where its shadow is and how strong. Returning 0 is the shipped
    // behaviour, which is what an unwired system keeps doing.
    let corpse = 0;
    if (!cbt.alive) {
      corpse = this.corpseShadow(cbt, this.corpseAt);
      if (corpse <= 0) {
        blob.setEnabled(false);
        return;
      }
    }
    blob.setEnabled(true);
    if (corpse > 0) {
      // All three axes from the corpse, `groundY` included — it is the height
      // the body DIED at, and a corpse is the one thing here that moves after
      // that. A body thrown down a bank or off a deck otherwise leaves its
      // shadow hanging at the height it was shot at. Whoever answers the
      // callback owes the floor under the body, not the body's own height.
      blob.position.set(this.corpseAt.x, this.corpseAt.y + 0.04, this.corpseAt.z);
    } else {
      blob.position.set(cbt.position.x, groundY + 0.04, cbt.position.z);
    }
    const dist = Vector3.Distance(camPos, blob.position);
    const fade = Math.min(
      1,
      Math.max(0, 1 - (dist - this.fogStart) / (this.fogEnd - this.fogStart)),
    );
    blob.visibility =
      CONFIG.graphics.shadows.blobOpacity * fade * (corpse > 0 ? corpse : 1);
  }

  private blobFor(cbt: Combatant): Mesh {
    let blob = this.blobs.get(cbt);
    if (!blob) {
      blob = MeshBuilder.CreateDisc(
        "blobShadow",
        { radius: CONFIG.graphics.shadows.blobRadius, tessellation: 32 },
        this.scene,
      );
      blob.rotation.x = -Math.PI / 2; // CreateDisc faces +Z; tip it face-up
      blob.material = this.blobMaterial;
      blob.isPickable = false;
      blob.metadata = { noInk: true, noGlow: true };
      this.blobs.set(cbt, blob);
    }
    return blob;
  }
}
