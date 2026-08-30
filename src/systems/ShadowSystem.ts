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
 * - Meshes with metadata.noShadowCaster (flat ground sheets, roads) must
 *   never be registered — they are receivers, and casting from them is acne.
 * - Blob discs are isPickable=false, metadata.noOutline, and never casters.
 * - updateBlobs takes the player's ground height rather than probing for it:
 *   Player.floorY is that number, already found this frame.
 */
import {
  type AbstractMesh,
  Color3,
  DirectionalLight,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  RenderTargetTexture,
  type Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Combatant } from "../entities/Combatant";
import type { CelMaterialFactory } from "../shaders/CelShader";

export class ShadowSystem {
  private readonly light: DirectionalLight;
  private readonly generator: ShadowGenerator;
  private readonly blobMaterial: StandardMaterial;
  private readonly blobs = new Map<Combatant, Mesh>();
  /**
   * Wired by `Game`: where a downed body's shadow goes, into `out`, and how
   * strong (0..1). 0 means "nothing to shade", which is every corpse nobody
   * has claimed — so the default below is exactly the old behaviour.
   *
   * `out.y` is the FLOOR the body came to rest on, not the body's own height:
   * a corpse moves after it dies, so neither its height nor the one it was
   * standing at when it was shot is the answer. `Game` resolves it the same
   * way `CaptureZoneSystem` lays a ring — the nav surface nearest the body,
   * falling back to the drawn terrain — because a body on a deck and a body
   * in a basin both have to be shaded.
   *
   * A callback rather than an import, because a system reaching into another
   * system is the thing `Game`'s wiring exists to prevent.
   */
  corpseShadow: (cbt: Combatant, out: Vector3) => number = () => 0;
  /** Scratch for that callback — no per-frame allocation. */
  private readonly corpseAt = new Vector3();
  /** Last texel-snapped focus; forces a first update. */
  private readonly snappedFocus = new Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );
  /**
   * The two cross-axes of the light's own basis, kept from `update` so the
   * render-list cull can project casters into it. The third is the light's
   * direction, which `DirectionalLight` already holds.
   */
  private readonly xAxis = new Vector3(1, 0, 0);
  private readonly yAxis = new Vector3(0, 1, 0);
  /** Scratch for the cull, rebuilt on the frames the depth pass re-renders. */
  private readonly windowCasters: AbstractMesh[] = [];
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

  constructor(private scene: Scene, mats: CelMaterialFactory) {
    const c = CONFIG.graphics.shadows;
    this.light = new DirectionalLight(
      "moonShadow",
      new Vector3(-0.3, -0.85, 0.42).normalize(),
      scene,
    );
    // Fixed square ortho window; auto-extends against the render list would
    // stretch the window to the whole 240 m map and halve the texel density.
    this.light.shadowFrustumSize = this.window;
    this.light.shadowMinZ = 1;
    this.light.shadowMaxZ = c.depthRange;
    this.light.autoUpdateExtends = false;

    this.generator = new ShadowGenerator(c.mapSize, this.light);
    // Bias lives consumer-side in the cel shader (shadowParams), where the
    // facet normal is known — not baked into the caster depths.
    this.generator.bias = 0;
    const map = this.generator.getShadowMap();
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
      map.getCustomRenderList = () => this.cullToWindow(map.renderList ?? []);
    }
    mats.setShadowMap(this.generator.getShadowMap()!);
    // The map's size goes with them: the consumer's kernel offsets are in UV,
    // and a texel of UV is 1 / mapSize. This is the only place that number is
    // known, so it is handed over rather than restated in the shader.
    mats.setShadowParams(c.bias, c.darkness, c.normalBias, c.mapSize);

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
   * `depthRange` to push past that is not free: `shadowParams.x` is a
   * NORMALISED bias, so a deeper volume rescales what it means in metres and
   * the failure is peter-panning at the foot of a wall.
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
    this.snappedFocus.setAll(Number.POSITIVE_INFINITY);
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
    // Invalidate the snapped focus so the light re-centres on next update.
    this.snappedFocus.setAll(Number.POSITIVE_INFINITY);
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
    const map = this.generator.getShadowMap();
    const list = map?.renderList;
    if (list) {
      for (const m of list.slice()) this.generator.removeShadowCaster(m, false);
    }
    for (const m of meshes) {
      if (m.metadata?.noShadowCaster) continue;
      this.generator.addShadowCaster(m, false);
    }
    map?.resetRefreshCounter();
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
  private cullToWindow(all: readonly AbstractMesh[]): AbstractMesh[] {
    const c = CONFIG.graphics.shadows;
    const half = this.window / 2;
    const dir = this.light.direction;
    const ax = this.xAxis;
    const ay = this.yAxis;
    // Where the light's camera sits along its own view axis. The window's
    // near and far planes are measured from there.
    const camDepth = this.snappedFocus.z - c.distance;
    const near = camDepth + this.light.shadowMinZ;
    const far = camDepth + this.light.shadowMaxZ;
    const list = this.windowCasters;
    list.length = 0;
    for (const mesh of all) {
      const box = mesh.getBoundingInfo().boundingBox;
      const p = box.centerWorld;
      const e = box.extendSizeWorld;
      const u = p.x * ax.x + p.y * ax.y + p.z * ax.z;
      const ru = Math.abs(e.x * ax.x) + Math.abs(e.y * ax.y) + Math.abs(e.z * ax.z);
      if (Math.abs(u - this.snappedFocus.x) > half + ru) continue;
      const v = p.x * ay.x + p.y * ay.y + p.z * ay.z;
      const rv = Math.abs(e.x * ay.x) + Math.abs(e.y * ay.y) + Math.abs(e.z * ay.z);
      if (Math.abs(v - this.snappedFocus.y) > half + rv) continue;
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
    this.generator.getShadowMap()?.resetRefreshCounter();
  }

  /**
   * Recentres the shadow window on the focus (the player, biased a little
   * along the camera's view) and re-uploads the light matrix. The recenter
   * is snapped to whole shadow-map texels in the light's own view basis:
   * moving the window by an integer number of texels leaves every texel on
   * the same world spot, so edges never crawl. The depth pass re-renders
   * only when the snapped focus actually changed.
   */
  update(focus: Vector3, mats: CelMaterialFactory): void {
    const c = CONFIG.graphics.shadows;
    const dir = this.light.direction;
    const texel = this.window / c.mapSize;
    // LookAtLH basis: x = normalize(cross(up, z)), y = cross(z, x). Kept on
    // the instance rather than in locals because the render-list cull projects
    // into the same basis, and because this runs every frame — the ToRef forms
    // are what stop it allocating four vectors to do it.
    const xAxis = this.xAxis;
    const yAxis = this.yAxis;
    Vector3.CrossToRef(Vector3.UpReadOnly, dir, xAxis);
    xAxis.normalize();
    Vector3.CrossToRef(dir, xAxis, yAxis);
    yAxis.normalize();
    const sx = Math.round(Vector3.Dot(focus, xAxis) / texel) * texel;
    const sy = Math.round(Vector3.Dot(focus, yAxis) / texel) * texel;
    // The depth axis is snapped too: an unsnapped window sliding along the
    // light direction shifts receiver depths against caster depths and the
    // hard edges crawl just the same.
    const sz = Math.round(Vector3.Dot(focus, dir) / texel) * texel;
    if (
      sx !== this.snappedFocus.x ||
      sy !== this.snappedFocus.y ||
      sz !== this.snappedFocus.z
    ) {
      this.snappedFocus.set(sx, sy, sz);
      const depth = sz - c.distance;
      this.light.position.set(
        xAxis.x * sx + yAxis.x * sy + dir.x * depth,
        xAxis.y * sx + yAxis.y * sy + dir.y * depth,
        xAxis.z * sx + yAxis.z * sy + dir.z * depth,
      );
      this.generator.getShadowMap()?.resetRefreshCounter();
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
      mats.setShadowMatrix(this.generator.getTransformMatrix());
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
      blob.metadata = { noOutline: true, noGlow: true };
      this.blobs.set(cbt, blob);
    }
    return blob;
  }
}
