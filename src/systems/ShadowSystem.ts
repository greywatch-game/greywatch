/**
 * ShadowSystem.ts — Owns the moon's shadow camera and the contact shadows
 * under combatants.
 *
 * The scene has NO Babylon light. Each map's light is a plain pair of
 * vectors, its direction and where it stands (`MapLight`, the bodies' map's
 * shape, `core/shadowWindow.ts`' `ShadowLight`), plus the side of its ortho
 * window: it exists purely to define a shadow frustum, and shades nothing.
 * The depth map drawn along it is sampled by the cel fragment shader as a
 * hard two-level shadow term.
 *
 * **The world's maps are OUR renderer's** (`BABYLON_EXIT.md` X3.6a, X3.7b):
 * the handover hands `WorldShadows` the casters on every shadow rung
 * (`WorldShadows.casters`, set by `BlockHandover`), the four maps are
 * textures `render/WorldShadows.ts` owns and draws, and Babylon's readers
 * sample a wrapped view of each (rule 5). Casters ours cannot draw are the
 * world's failure (`BlockHandover`, X3.7b). Until the first map hands ours
 * its casters — the boot, the menu, a first round whose world failed — every
 * map is bound as the lit 1x1 (`litShadowTexture`) and drawn by nobody; once
 * ours holds them it keeps them, a teardown clearing them to lit
 * (`WorldShadows`). Babylon's `ShadowGenerator`s, which drew the maps for the
 * map editor's build alone after X3.7b and stood empty at the boot, were
 * deleted at X5.3d with the `DirectionalLight`s that were their lights.
 *
 * The casters are the handover's, told after every map build (`setCasters`,
 * the map being disposed and rebuilt per round).
 * Characters never cast into the WORLD's maps — their shadow is the bodies'
 * own map (`BodyShadows`) — and each also gets a blob shadow, the contact
 * term: a soft unlit alpha disc that follows the combatant (on the floor the
 * player's ground probe found, the nav-surface height for a bot). A blob is
 * a FADE of its kit (`entities/fades.ts`), drawn by OUR renderer in the one
 * back-to-front run (`render/FarthestRun.ts`, `BABYLON_EXIT.md` X4.6e), where
 * Babylon's transparent list drew its mesh; its map stays a Babylon texture,
 * read through the seam (`blobMap`).
 *
 * Invariants:
 * - The light position is snapped to the shadow map's texel grid as it
 *   tracks the player, so shadow edges stay rock steady instead of crawling.
 * - The depth map re-renders only when the snapped focus moves — and the
 *   focus the two static maps follow is HELD until the live one has drifted
 *   past the rung's `hold` (`held`), because an 8 m lever on the view moves
 *   a texel's worth on nearly every frame of play. Held is never stale: the
 *   snap makes it a window the map would have drawn anyway.
 * - The depth pass draws only the casters standing in the window, through
 *   the GPU cull over the light's frustum (`WorldDepth`).
 * - The depth map records BACK faces (`WorldDepth`'s `"back"`), so every
 *   caster must be a closed shape, and the bias is stated
 *   in metres (`CONFIG.graphics.shadows.bias`, converted by `depthBias`).
 * - A SECOND map, the foliage's, records the FRONT faces of the translucent
 *   solids and nothing else (`CelMaterialFactory.isSolid`), over the same
 *   window (`BlockHandover.passesOf`'s `PASS_SOLID`). It shades nothing: it
 *   is how the translucency term measures how much crown the light crossed,
 *   which a back-face map cannot say.
 * - Meshes with metadata.noShadowCaster (flat ground sheets, roads) must
 *   never be registered — they are receivers, and casting from them is acne.
 * - Blob discs are no mesh, in no pick and no caster list, and out of the
 *   glow's mask (the `noInk` and `noGlow` their meshes carried).
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
 *   consumer declares both samplers. A rung change re-makes a map of ours at
 *   the new size, owed a draw.
 * - The maps' first hand to our renderer re-publishes each to every reader,
 *   and each is drawn on the next frame our renderer prepares from where its
 *   light stands; `ready` says when it has.
 * - The light matrix of a map is Babylon's `ShadowGenerator.getTransformMatrix`
 *   arithmetic, in the same order on the same helpers (`lightTransformToRef`,
 *   the one copy, which the bodies' map reads too), so a reader samples the
 *   texel a generator's matrix named.
 * - updateBlobs takes the player's ground height rather than probing for it:
 *   Player.floorY is that number, already found this frame.
 */
import {
  type BaseTexture,
  DynamicTexture,
  Matrix,
  type Scene,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { BLOB, Fade, fadeKit, type FadeKit } from "../entities/fades";
import { createDisc } from "../geometry/primitives";
import { Vector3 as MathVector3 } from "../math";
import { hostTexture } from "../render/babylonSeam";
import type { HostTexture } from "../render/frameHost";
import type { OwnTexture } from "../render/HostBindGroup";
import {
  depthBias,
  lightTransformToRef,
  litShadowTexture,
  SHADOW_NEAR,
  type ShadowLight,
  ShadowWindow,
} from "../core/shadowWindow";
import { wrapShadowTexture } from "../core/wrappedTextures";
import type { ShadowQuality } from "../core/settings";
import type { Combatant } from "../entities/Combatant";
import { WORLD_SHADOW_MAPS, type WorldShadowMap, type WorldShadows } from "../render/WorldShadows";
import type { CelMaterialFactory } from "../shaders/CelShader";

/**
 * The lightning map's largest side. A strike lasts half a second and is
 * judged by the SHAPE of what it throws, so it never needs the moon's full
 * resolution — and it is a whole world depth pass, once per strike.
 */
const FLASH_MAP_MAX = 1024;

/**
 * A map's light: where it points and where it stands — what a window places
 * and the transform reads (`ShadowLight`) — and the side of its ortho window.
 * The fields a Babylon `DirectionalLight` held for its generator until
 * `BABYLON_EXIT.md` X5.3d, made as it made them: the direction the very
 * vector it was handed, the position minus it, until a window places it.
 */
interface MapLight extends ShadowLight {
  direction: Vector3;
  /** The ortho window's side, in metres (the light's `shadowFrustumSize`). */
  side: number;
}

/** A light along `direction`, standing at minus it, as `DirectionalLight`'s constructor stood one. */
function mapLight(direction: Vector3, side: number): MapLight {
  return { direction, position: direction.scale(-1.0), side };
}

/**
 * One world map: its light, its window (the snap is in texels of ITS size),
 * its resolution under the current rung, our texture's wrapped view while it
 * is ours, and the matrix it is drawn and read with.
 */
interface WorldMap {
  readonly name: WorldShadowMap;
  readonly light: MapLight;
  readonly win: ShadowWindow;
  /** 0 is off, -1 not yet set — see `docs/rendering.md`, "The shadow rungs". */
  size: number;
  /** Babylon's view of our texture, while the map is ours and has one. */
  wrapped: BaseTexture | null;
  /** The light's view-projection while the map is ours, rewritten in place. */
  readonly matrix: Matrix;
}

export class ShadowSystem {
  /** The moon's light: the far cascade's, which the other three copy their direction from. */
  private readonly light: MapLight;
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
   * Whether the world's maps are OUR renderer's (`WorldShadows`): false only
   * until the first map hands ours its casters, every map bound lit until
   * then — see the header.
   */
  private ours = false;
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
  /**
   * Every combatant's blob, made the first time it is placed: what our
   * renderer draws. `blobFades` is the same fades in the order they were
   * made, the order their meshes stood in the scene.
   */
  private readonly blobs = new Map<Combatant, Fade>();
  readonly blobFades: Fade[] = [];
  /** The arrays `MeshBuilder.CreateDisc` made every blob's mesh of. */
  readonly blobKit: FadeKit = fadeKit(
    createDisc({ radius: CONFIG.graphics.shadows.blobRadius, tessellation: 32 }),
  );
  /** The radial gradient every blob is cut by, a Babylon texture through the seam (rule 5). */
  readonly blobMap: HostTexture;
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
   * factory's lists (the volumetric pass, a stage of our post chain and no
   * material) has to come and ask. It is the same texture, not a copy.
   */
  get depthMap(): BaseTexture {
    return this.mapTexture(this.maps.far);
  }

  /**
   * The same map as OUR renderer holds it while it is ours
   * (`render/WorldShadows.ts`), or null while it is not ours or off —
   * what the shafts bind in place of Babylon's wrapped view, as
   * `ShadowBindings` hands our frame (`BABYLON_EXIT.md` X5.2c2).
   */
  get ownDepthMap(): OwnTexture | null {
    return this.ours && this.maps.far.wrapped ? this.world.own("far") : null;
  }

  /**
   * The light's view*projection, for the same reader and with one caveat worth
   * stating: the matrix is MUTATED IN PLACE (`lightTransform`) — so what a
   * caller holds tracks the shadow camera
   * whether or not it asks again. That is an implementation detail rather
   * than a promise — the same one `update` declines to lean on below — so a
   * caller that can afford to re-read every frame should.
   */
  get lightMatrix(): Matrix {
    return this.matrixOf(this.maps.far) ?? this.offMatrix;
  }

  /**
   * Whether every map is drawn for the casters `setCasters` last read: at
   * once with none of ours (every map lit), and once `WorldShadows` has drawn
   * every map owed with them. What a reader that samples a map once and keeps
   * the answer waits on — the probes' bake.
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
    // A fixed square ortho window each: one fitted to the casters would
    // stretch to the whole 240 m map and halve the texel density.
    this.light = mapLight(new Vector3(-0.3, -0.85, 0.42).normalize(), this.window);
    const map = (name: WorldShadowMap, light: MapLight): WorldMap => ({
      name,
      light,
      win: new ShadowWindow(),
      size: -1,
      wrapped: null,
      matrix: new Matrix(),
    });
    this.maps = {
      far: map("far", this.light),
      // The near cascade: the moon's volume over the near window.
      near: map("near", mapLight(this.light.direction.clone(), c.nearWindow)),
      foliage: map("foliage", mapLight(this.light.direction.clone(), this.window)),
      // The lightning's light: aimed per strike by `flash`, and otherwise the
      // moon's volume exactly.
      flash: map("flash", mapLight(new Vector3(0, -1, 0), this.window)),
    };

    // The maps are made here, once all four lights exist.
    this.setQuality(quality);

    // Blob shadow: a radial-gradient disc, unlit black, depth-write off so it
    // layers over the ground without z-fighting (`render/FadeDraw.ts` holds
    // the state its material had).
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
    this.blobMap = hostTexture(tex);
  }

  /**
   * Stands every map up at a rung's sizes (`CONFIG.graphics.shadowTiers`),
   * and binds each one's texture and parameters to every consumer.
   *
   * A map whose size did not move is left exactly as it was — the same
   * texture, no re-draw. One that did is, while the maps are ours, a new
   * texture, owed a draw. Its window is invalidated with it, because the
   * texel snap is in texels of a size that just changed.
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
    for (const name of WORLD_SHADOW_MAPS) {
      const map = this.maps[name];
      if (sizes[name] === map.size) continue;
      map.size = sizes[name];
      if (this.ours) {
        this.remakeOurs(map);
        // Drawn from where its light stands — a draw the next placement may
        // well repeat, but a pause menu's rung change places nothing until
        // play resumes, and the map must not stand empty behind it.
        if (name !== "flash") this.drawOurs(map);
      }
      map.win.invalidate();
      // The flash follows no held focus: it is placed per strike.
      if (name !== "flash") this.held.setAll(Infinity);
      this.publish(map);
    }
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

  /** Babylon's view of our `name` texture, sampled as a generator's map was (`wrapShadowTexture`). */
  private wrap(name: WorldShadowMap): BaseTexture | null {
    const texture = this.world.texture(name);
    return texture ? wrapShadowTexture(this.scene, texture, `${name}Shadow`) : null;
  }

  /**
   * Hands the world's maps to our renderer (`ours`), once: every map made on
   * it at the rung's sizes and published. Its draws are owed by whoever
   * handed them over (`setCasters`). Nothing once ours holds them.
   */
  private takeOver(): void {
    if (this.ours) return;
    this.ours = true;
    for (const name of WORLD_SHADOW_MAPS) {
      const map = this.maps[name];
      this.remakeOurs(map);
      this.publish(map);
    }
  }

  /** What `map` is bound as: our texture, or the lit 1x1 while it has none. */
  private mapTexture(map: WorldMap): BaseTexture {
    const texture = this.ours ? map.wrapped : null;
    return texture ?? litShadowTexture(this.scene);
  }

  /** `map`'s light matrix as ours draws it — null while it is off or not ours. */
  private matrixOf(map: WorldMap): Matrix | null {
    return this.ours && map.size > 0 ? map.matrix : null;
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
   * `ShadowGenerator.getTransformMatrix` computes it — `core/shadowWindow.ts`'s
   * `lightTransformToRef`, over the light's window side and the depth range.
   */
  private lightTransform(map: WorldMap): void {
    const light = map.light;
    lightTransformToRef(
      light,
      light.side,
      SHADOW_NEAR,
      CONFIG.graphics.shadows.depthRange,
      this.scene.getEngine().isNDCHalfZRange,
      map.matrix,
    );
  }

  /** `map`, ours, drawn from where its light stands on the next frame our renderer prepares. */
  private drawOurs(map: WorldMap): void {
    if (map.size <= 0) return;
    this.lightTransform(map);
    map.light.position.toArray(this.lightEye);
    this.world.draw(map.name, map.matrix.m, this.lightEye);
  }

  /** `map` re-drawn, while ours holds it: owed a draw. */
  private redraw(map: WorldMap): void {
    if (this.ours) this.drawOurs(map);
  }

  /**
   * Aims the lightning's map along a strike and draws it ONCE, around the same
   * focus the moon's window follows. Called on the frame a strike starts and
   * at no other time: a strike is half a second, and a player who crosses a
   * texel in that time is not going to see the shadow lag him.
   *
   * The matrix goes to every material here, and the map is drawn in the
   * encoder submitted ahead of this frame's draws, before the main pass that
   * samples it.
   */
  flash(direction: Vector3, focus: Vector3): void {
    const map = this.maps.flash;
    if (map.size <= 0) return;
    const light = map.light;
    light.direction.copyFrom(direction).normalize();
    light.side = this.window;
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
      map.light.side = metres;
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
      c.distance - SHADOW_NEAR,
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
   * The casters changed: read off `WorldShadows`, after every map build and
   * at `Game.teardownMap`.
   *
   * **And it is where the maps come to our renderer**: after
   * `BlockHandover.install`, which hands `WorldShadows` the casters on every
   * map of ours, so the world's shadows are ours from the first map that did
   * (`takeOver`) and drawn again for the new casters — the flash per strike
   * and at no other time. NO casters of ours (`Game.teardownMap`, or a world
   * the handover refused) keeps everything as it is: there is nothing to
   * cast, and `WorldShadows` has already cleared ours to lit.
   */
  setCasters(): void {
    if (this.world.casters === null) return;
    this.takeOver();
    for (const map of [this.maps.far, this.maps.near, this.maps.foliage]) this.redraw(map);
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
      // material to re-hand them a matrix that
      // had not changed — and the contract line above already claimed
      // otherwise.
      //
      // It is cheap even when it does run, and cheaper than it looks to skip:
      // the matrix is mutated in place (`lightTransform`) and
      // `ShaderMaterial.setMatrix` stores the
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
    for (const blob of this.blobFades) blob.node.visible = false;
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
        blob.node.visible = false;
        return;
      }
    }
    blob.node.visible = true;
    const at = blob.node.position;
    if (corpse > 0) {
      // All three axes from the corpse, `groundY` included — it is the height
      // the body DIED at, and a corpse is the one thing here that moves after
      // that. A body thrown down a bank or off a deck otherwise leaves its
      // shadow hanging at the height it was shot at. Whoever answers the
      // callback owes the floor under the body, not the body's own height.
      at.set(this.corpseAt.x, this.corpseAt.y + 0.04, this.corpseAt.z);
    } else {
      at.set(cbt.position.x, groundY + 0.04, cbt.position.z);
    }
    // Off the math's statics, which read a vector by its fields: the
    // blob's node is `src/math`'s, which Babylon's read as `_x`.
    const dist = MathVector3.Distance(camPos, at);
    const fade = Math.min(
      1,
      Math.max(0, 1 - (dist - this.fogStart) / (this.fogEnd - this.fogStart)),
    );
    blob.visibility =
      CONFIG.graphics.shadows.blobOpacity * fade * (corpse > 0 ? corpse : 1);
  }

  private blobFor(cbt: Combatant): Fade {
    let blob = this.blobs.get(cbt);
    if (!blob) {
      blob = new Fade(BLOB);
      // `CreateDisc`'s FRONT is its -Z, not its +Z, and its pipeline culls
      // back faces: this turn sends local -Z UP, so the disc faces up and is
      // seen from above, the floor's side, and from below it draws nothing.
      // It turned the other way, face down, until the owner's decision of
      // 2026-11-05 (`BABYLON_EXIT.md` X4.6e, "Decisions"): the contact term
      // was drawn under every body to nobody standing above it.
      blob.node.rotation.x = Math.PI / 2;
      this.blobs.set(cbt, blob);
      this.blobFades.push(blob);
    }
    return blob;
  }
}
