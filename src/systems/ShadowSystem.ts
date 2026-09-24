/**
 * ShadowSystem.ts — Owns the moon's shadow camera and the contact shadows
 * under combatants.
 *
 * The DirectionalLight here is the scene's ONLY Babylon light, and it exists
 * purely to define the shadow frustum: no material reads scene lights (cel
 * materials carry their own uniforms, effect materials are unlit), so it
 * shades nothing directly. Its ShadowGenerator renders a depth map that the
 * cel fragment shader samples as a hard two-level shadow term.
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
 * - The depth map re-renders only when the snapped focus moves.
 * - The depth pass draws only the casters standing in the window (see
 *   getCustomRenderList) — Babylon culls nothing off an explicit renderList.
 * - The depth map records BACK faces (`forceBackFacesOnly`), so every caster
 *   must be a closed shape, and the bias is stated in metres
 *   (`CONFIG.graphics.shadows.bias`, converted by `depthBias`).
 * - A SECOND map, the foliage's, records the FRONT faces of the translucent
 *   solids and nothing else (`CelMaterialFactory.isSolid`), over the same
 *   window. It shades nothing: it is how the translucency term measures how
 *   much crown the light crossed, which a back-face map cannot say.
 * - Meshes with metadata.noShadowCaster (flat ground sheets, roads) must
 *   never be registered — they are receivers, and casting from them is acne.
 * - Blob discs are isPickable=false, metadata.noInk, and never casters.
 * - A THIRD directional map is the LIGHTNING's (`flash`): the world's casters
 *   drawn once along a strike, on the frame it starts, so the moon's two maps
 *   never move for a flash. Render-once, back faces, its own window.
 * - Either map may be OFF (`CONFIG.graphics.shadowTiers`), and off is a bound
 *   1x1 lit texture (`litShadowTexture`) rather than an absent one: every
 *   consumer declares both samplers. A rung change rebuilds a generator at the
 *   new size and re-adds the casters `setCasters` last handed over.
 * - updateBlobs takes the player's ground height rather than probing for it:
 *   Player.floorY is that number, already found this frame.
 */
import {
  type AbstractMesh,
  type BaseTexture,
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
  Vector3,
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
import type { CelMaterialFactory } from "../shaders/CelShader";

/**
 * The layer the foliage light is pinned to, which no mesh carries — so the
 * light defines a shadow frustum and lights nothing. Distinct from
 * `BodyShadows`' proxy layer, which a mesh DOES carry.
 */
const FOLIAGE_LAYER = 0x20000000;

/** The lightning light's layer, for the same reason: it lights nothing. */
const FLASH_LAYER = 0x40000000;

/**
 * The lightning map's largest side. A strike lasts half a second and is
 * judged by the SHAPE of what it throws, so it never needs the moon's full
 * resolution — and it is a whole world depth pass, once per strike.
 */
const FLASH_MAP_MAX = 1024;

export class ShadowSystem {
  private readonly light: DirectionalLight;
  /** The world's generator, or null while the rung has the moon's map OFF. */
  private generator: ShadowGenerator | null = null;
  /** Its resolution under the current rung; 0 is off, -1 not yet set. */
  private mapSize = -1;
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
  /**
   * Where this window stands: the light's cross-axis basis and the last
   * texel-snapped focus, both kept after `place` so the render-list cull can
   * project casters into the same basis. `BodyShadows` holds one of its own —
   * see that module for why the arithmetic is shared and the instance is not.
   */
  private readonly win = new ShadowWindow();
  /** Scratch for the cull, rebuilt on the frames the depth pass re-renders. */
  private readonly windowCasters: AbstractMesh[] = [];
  /**
   * The FOLIAGE's front-face map: its own light (a generator is one per light),
   * its own window (the snap is in texels of ITS size) and its own cull
   * scratch, over the same focus, direction and side as the world's.
   *
   * **Why it exists.** The world map records back faces so that a lit surface
   * is compared against the far side of its own wall rather than against
   * itself, which is what let its bias drop from 63 cm to 5. That same choice
   * makes a face turned AWAY from the key its own recorded surface, so the map
   * can no longer say how much of a pine's crown the light crossed on the way
   * to it — and the translucency term needs exactly that to light a crown at
   * its thin rim and not across its whole shaded side. This map is the front
   * half of that measurement, drawn from the translucent solids alone, so it
   * costs a handful of merged foliage draws rather than a second world.
   */
  private readonly foliageLight: DirectionalLight;
  private foliageGen: ShadowGenerator | null = null;
  private foliageSize = -1;
  /** The lightning's own map — see `flash`. Null while the rung has no sun map. */
  private readonly flashLight: DirectionalLight;
  private flashGen: ShadowGenerator | null = null;
  private flashSize = -1;
  private readonly flashWin = new ShadowWindow();
  private readonly flashCasters: AbstractMesh[] = [];
  private readonly foliageWin = new ShadowWindow();
  private readonly foliageCasters: AbstractMesh[] = [];
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

  /**
   * The moon's depth map, for a reader that is not a material.
   *
   * `mats` gets this pushed at startup and never again — the texture object is
   * stable while its contents re-render — so a second reader that is not in
   * the factory's lists (the volumetric pass, which is a `PostProcess` and not
   * a `ShaderMaterial`) has to come and ask. It is the same texture, not a copy.
   */
  get depthMap(): BaseTexture | null {
    return this.generator?.getShadowMap() ?? litShadowTexture(this.scene);
  }

  /**
   * The light's view*projection, for the same reader and with one caveat worth
   * stating: `getTransformMatrix` returns a matrix the generator MUTATES IN
   * PLACE, so what a caller holds tracks the shadow camera whether or not it
   * asks again. That is an implementation detail of Babylon's rather than a
   * promise — the same one `update` declines to lean on below — so a caller
   * that can afford to re-read every frame should.
   */
  get lightMatrix(): Matrix {
    return this.generator?.getTransformMatrix() ?? this.offMatrix;
  }

  constructor(
    private scene: Scene,
    private readonly mats: CelMaterialFactory,
    quality: ShadowQuality,
  ) {
    const c = CONFIG.graphics.shadows;
    this.light = new DirectionalLight(
      "moonShadow",
      new Vector3(-0.3, -0.85, 0.42).normalize(),
      scene,
    );
    // Fixed square ortho window; auto-extends against the render list would
    // stretch the window to the whole 240 m map and halve the texel density.
    this.light.shadowFrustumSize = this.window;
    this.light.shadowMinZ = SHADOW_NEAR;
    this.light.shadowMaxZ = c.depthRange;
    this.light.autoUpdateExtends = false;

    // The foliage's front-face map. A light of its own, because a shadow
    // generator is one per light; pinned to a layer no mesh carries, so it can
    // never become a lighting light for a StandardMaterial (BodyShadows' rule).
    this.foliageLight = new DirectionalLight("foliageDepth", this.light.direction.clone(), scene);
    this.foliageLight.includeOnlyWithLayerMask = FOLIAGE_LAYER;
    this.foliageLight.shadowFrustumSize = this.window;
    this.foliageLight.shadowMinZ = SHADOW_NEAR;
    this.foliageLight.shadowMaxZ = c.depthRange;
    this.foliageLight.autoUpdateExtends = false;
    // The lightning's light: pinned to a layer nothing carries, aimed per
    // strike by `flash`, and otherwise the moon's volume exactly.
    this.flashLight = new DirectionalLight("flashDepth", new Vector3(0, -1, 0), scene);
    this.flashLight.includeOnlyWithLayerMask = FLASH_LAYER;
    this.flashLight.shadowFrustumSize = this.window;
    this.flashLight.shadowMinZ = SHADOW_NEAR;
    this.flashLight.shadowMaxZ = c.depthRange;
    this.flashLight.autoUpdateExtends = false;

    // The generators are built here, once all three lights exist.
    this.setQuality(quality);

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
   * Stands both maps up at a rung's sizes (`CONFIG.graphics.shadowTiers`),
   * and binds each one's texture and parameters to every consumer.
   *
   * A map whose size did not move is left exactly as it was — the same
   * generator, the same caster list, no re-render. One that did is rebuilt
   * from nothing: a `ShadowGenerator`'s size is fixed at construction, so a
   * new resolution is a new generator, and the casters come back from
   * `casters`. The windows are invalidated with it, because the texel snap is
   * in texels of a size that just changed.
   */
  setQuality(quality: ShadowQuality): void {
    const c = CONFIG.graphics.shadows;
    const tier = CONFIG.graphics.shadowTiers[quality];
    if (tier.sun !== this.mapSize) {
      this.generator?.dispose();
      this.generator = tier.sun > 0 ? this.buildWorld(tier.sun) : null;
      this.mapSize = tier.sun;
      this.win.invalidate();
      this.mats.setShadowMap(this.generator?.getShadowMap() ?? litShadowTexture(this.scene));
      // The map's size goes with them: the consumer's kernel offsets are in UV,
      // and a texel of UV is 1 / mapSize. This is the only place that number is
      // known, so it is handed over rather than restated in the shader.
      this.mats.setShadowParams(
        depthBias(c.bias, c.depthRange),
        c.darkness,
        c.normalBias,
        Math.max(1, this.mapSize),
      );
      this.mats.setShadowMatrix(this.lightMatrix);
    }
    const flashSize = Math.min(tier.sun, FLASH_MAP_MAX);
    if (flashSize !== this.flashSize) {
      this.flashGen?.dispose();
      this.flashGen = flashSize > 0 ? this.buildFlash(flashSize) : null;
      this.flashSize = flashSize;
      this.flashWin.invalidate();
      this.mats.setFlashMap(this.flashGen?.getShadowMap() ?? litShadowTexture(this.scene));
      this.mats.setFlashParams(
        depthBias(c.bias, c.depthRange),
        c.pcfRadiusTexels / Math.max(1, flashSize),
      );
    }
    if (tier.foliage !== this.foliageSize) {
      this.foliageGen?.dispose();
      this.foliageGen = tier.foliage > 0 ? this.buildFoliage(tier.foliage) : null;
      this.foliageSize = tier.foliage;
      this.foliageWin.invalidate();
      this.mats.setFoliageMap(
        this.foliageGen?.getShadowMap() ?? litShadowTexture(this.scene),
      );
      this.mats.setFoliageParams(
        c.pcfRadiusTexels / Math.max(1, this.foliageSize),
        depthBias(1, c.depthRange),
      );
    }
  }

  /** The world's generator at `size`, holding the casters already handed over. */
  private buildWorld(size: number): ShadowGenerator {
    const gen = new ShadowGenerator(size, this.light);
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
    // would record only the side facing away and cast from there.
    gen.forceBackFacesOnly = true;
    const map = gen.getShadowMap();
    if (map) {
      // Re-render only when told to (resetRefreshCounter in update/setCasters)
      // — the world is static, so the depth pass is wasted on frames where
      // the texel-snapped light window didn't move.
      map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      map.resetRefreshCounter();
      // Draw only what stands in the window. Babylon culls NOTHING off an
      // explicit renderList — `ObjectRenderer._prepareRenderingManager`
      // dispatches every mesh that is enabled and visible — so without this
      // the depth pass submits the whole village on every re-render: measured
      // at 314 casters and 79k triangles, against ~150 that can reach the
      // window. It is called only on the frames that actually re-render,
      // which is why the cull is computed here rather than kept up to date in
      // `update`.
      map.getCustomRenderList = () =>
        this.cullToWindow(map.renderList ?? [], this.win, this.light, this.windowCasters);
    }
    for (const m of this.casters) {
      if (!m.metadata?.noShadowCaster) gen.addShadowCaster(m, false);
    }
    return gen;
  }

  /**
   * The lightning's generator at `size`: the world's casters, back faces,
   * render-once and culled to its own window — `buildWorld` with a different
   * light, because it is the same question asked from somewhere else.
   */
  private buildFlash(size: number): ShadowGenerator {
    const gen = new ShadowGenerator(size, this.flashLight);
    gen.bias = 0;
    gen.forceBackFacesOnly = true;
    const map = gen.getShadowMap();
    if (map) {
      map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      map.getCustomRenderList = () =>
        this.cullToWindow(map.renderList ?? [], this.flashWin, this.flashLight, this.flashCasters);
    }
    for (const m of this.casters) {
      if (!m.metadata?.noShadowCaster) gen.addShadowCaster(m, false);
    }
    return gen;
  }

  /**
   * Aims the lightning's map along a strike and draws it ONCE, around the same
   * focus the moon's window follows. Called on the frame a strike starts and
   * at no other time: a strike is half a second, and a player who crosses a
   * texel in that time is not going to see the shadow lag him.
   *
   * The matrix goes to every material here, and the map renders inside this
   * frame's `scene.render()`, before the main pass that samples it.
   */
  flash(direction: Vector3, focus: Vector3): void {
    const gen = this.flashGen;
    if (!gen) return;
    this.flashLight.direction.copyFrom(direction).normalize();
    this.flashLight.shadowFrustumSize = this.window;
    this.flashWin.invalidate();
    this.flashWin.place(
      this.flashLight,
      focus,
      this.window,
      this.flashSize,
      CONFIG.graphics.shadows.distance,
    );
    gen.getShadowMap()?.resetRefreshCounter();
    this.mats.setFlashMatrix(gen.getTransformMatrix());
  }

  /** The foliage's front-face generator at `size`, with its solids. */
  private buildFoliage(size: number): ShadowGenerator {
    const gen = new ShadowGenerator(size, this.foliageLight);
    gen.bias = 0;
    const fmap = gen.getShadowMap();
    if (fmap) {
      fmap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      fmap.resetRefreshCounter();
      fmap.getCustomRenderList = () =>
        this.cullToWindow(
          fmap.renderList ?? [],
          this.foliageWin,
          this.foliageLight,
          this.foliageCasters,
        );
    }
    for (const m of this.casters) {
      if (!m.metadata?.noShadowCaster && this.mats.isSolid(m.material)) {
        gen.addShadowCaster(m, false);
      }
    }
    return gen;
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
    this.light.shadowFrustumSize = metres;
    this.foliageLight.shadowFrustumSize = metres;
    this.win.invalidate();
    this.foliageWin.invalidate();
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
    this.foliageLight.direction = this.light.direction.clone();
    // Invalidate the snapped focus so the light re-centres on next update.
    this.win.invalidate();
    this.foliageWin.invalidate();
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
   */
  setCasters(meshes: readonly Mesh[]): void {
    this.casters = meshes;
    const gen = this.generator;
    const map = gen?.getShadowMap();
    if (gen && map?.renderList) {
      for (const m of map.renderList.slice()) gen.removeShadowCaster(m, false);
    }
    const fgen = this.foliageGen;
    const fmap = fgen?.getShadowMap();
    if (fgen && fmap?.renderList) {
      for (const m of fmap.renderList.slice()) fgen.removeShadowCaster(m, false);
    }
    const lgen = this.flashGen;
    const lmap = lgen?.getShadowMap();
    if (lgen && lmap?.renderList) {
      for (const m of lmap.renderList.slice()) lgen.removeShadowCaster(m, false);
    }
    for (const m of meshes) {
      if (m.metadata?.noShadowCaster) continue;
      gen?.addShadowCaster(m, false);
      lgen?.addShadowCaster(m, false);
      // A translucent SOLID goes in both: the world's map for what it hides,
      // and the foliage's for how thick it is.
      if (this.mats.isSolid(m.material)) fgen?.addShadowCaster(m, false);
    }
    map?.resetRefreshCounter();
    fmap?.resetRefreshCounter();
  }

  /**
   * The casters that can write into the current shadow window.
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
  private cullToWindow(
    all: readonly AbstractMesh[],
    win: ShadowWindow,
    light: DirectionalLight,
    list: AbstractMesh[],
  ): AbstractMesh[] {
    const c = CONFIG.graphics.shadows;
    const half = this.window / 2;
    const dir = light.direction;
    const ax = win.axisX;
    const ay = win.axisY;
    // Where the light's camera sits along its own view axis. The window's
    // near and far planes are measured from there.
    const camDepth = win.snapped.z - c.distance;
    const near = camDepth + light.shadowMinZ;
    const far = camDepth + light.shadowMaxZ;
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
    this.generator?.getShadowMap()?.resetRefreshCounter();
    this.foliageGen?.getShadowMap()?.resetRefreshCounter();
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
    const gen = this.generator;
    if (gen && this.win.place(this.light, focus, this.window, this.mapSize, c.distance)) {
      gen.getShadowMap()?.resetRefreshCounter();
      // Inside the guard, where it belongs: this is the branch that just
      // decided the shadow camera moved, and the matrix is a function of
      // nothing else. Outside it, every frame paid a `setMatrix` on every cel
      // material plus the grass and the water to re-hand them a matrix that
      // had not changed — and the contract line above already claimed
      // otherwise.
      //
      // It is cheap even when it does run, and cheaper than it looks to skip:
      // `getTransformMatrix` returns a matrix it mutates in place and
      // `ShaderMaterial.setMatrix` stores the REFERENCE, so what the materials
      // hold tracks the generator whether or not this line runs again. That is
      // an implementation detail of Babylon's rather than a promise, which is
      // why this stays a real re-upload on the frames the window moves instead
      // of being deleted outright.
      mats.setShadowMatrix(gen.getTransformMatrix());
    }
    // The foliage's window, off the same focus on its own texel grid. A
    // separate test because the two grids are different sizes: one moving
    // does not mean the other has.
    const fgen = this.foliageGen;
    if (
      fgen &&
      this.foliageWin.place(this.foliageLight, focus, this.window, this.foliageSize, c.distance)
    ) {
      fgen.getShadowMap()?.resetRefreshCounter();
      mats.setFoliageMatrix(fgen.getTransformMatrix());
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
