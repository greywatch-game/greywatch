/**
 * WaterSystem.ts — Water surfaces built from the map's WaterRects; syncs each
 * water material's time/camera/point-light uniforms every frame.
 * Invariants: water meshes are unpickable, non-colliding, and never carry
 * metadata.solid — ray tests must not see them. update() runs after the camera
 * and LightingSystem updates (shares the same 16 light slots). Meshes are
 * frozen; the one tiling texture left (the foam mask) is loaded once and
 * reused across rebuilds.
 * A rect without its own `y` floats ankle-deep above the TERRAIN under it, not
 * above absolute zero — that is what lets a pool sit recessed in a dug bed.
 * The BED-DEPTH map is per body and per build — it is baked against the
 * TerrainField this build was handed, so it is exactly as disposable as the
 * mesh, and a stale one would draw last build's shoreline.
 * `build` calls its `reflect` callback EXACTLY ONCE, on every path including a
 * dry map: it is what parks last build's probes, and it is what binds the cube
 * every material must be born holding.
 */
import {
  Color3,
  Constants,
  type GlowLayer,
  Mesh,
  MeshBuilder,
  RawTexture,
  Scene,
  type ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from "@babylonjs/core";

import { CONFIG } from "../config";
import {
  MAX_POINT_LIGHTS,
  type CelMaterialFactory,
  type PointLightData,
  type CubeReflection,
} from "../shaders/CelShader";
import { createWaterMaterial } from "../shaders/WaterShader";
import type { EnvironmentSpec } from "../world/environment";
import type { WaterRect } from "../world/MapBuilder";
import { waterY, type TerrainField } from "../world/TerrainField";
import foamUrl from "../../textures/water-foam.png?url";

interface WaterBody {
  mesh: Mesh;
  mat: ShaderMaterial;
  /** Baked against this build's terrain, so it dies with the body. */
  depth: RawTexture;
}

/** What `bakeDepth` works out about one rect. */
interface BedMap {
  /** The bed depth under every point of the rect, as a single channel. */
  tex: RawTexture;
  /**
   * Where the water in this rect actually is: the centroid of its WET cells,
   * on the surface. A rect is its EXTENT and not its shore (Greyfen's flood is
   * one 250 m rect of which 11% is wet), so this is the only honest point to
   * stand a reflection probe at — see `ReflectionSystem.bakeWater`.
   */
  site: Vector3;
}

/**
 * Owns the water surfaces: builds one ground plane per layout rect, feeds them
 * the map's environment palette and its own reflection probe, and per frame
 * pushes time, the camera position, and the same winning point-light set the
 * cel shader gets (so lanterns and muzzle flashes glint off the creek).
 *
 * The planes are drawn and never tested: unpickable, non-colliding, no
 * `solid` metadata — every ray (hitscan, LOS, ground probes) passes through
 * to the creek bed below. They are also excluded from the GlowLayer and the
 * outline pass per the metadata contract.
 *
 * **Water is a mirror, so this system has a second input nothing else here
 * has**: a cube per body, baked by `ReflectionSystem` from the finished map.
 * It arrives through a callback `Game` wires rather than an import, and it
 * arrives INSIDE `build` rather than after it, because the probe has to stand
 * where the water is and only the bed-depth bake below knows where that is.
 */
export class WaterSystem {
  private bodies: WaterBody[] = [];
  private foam: Texture | null = null;
  private time = 0;

  // Packed point-light uniforms, reused every frame to avoid allocation.
  private pointPos = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointColor = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointRange = new Float32Array(MAX_POINT_LIGHTS);

  constructor(
    private scene: Scene,
    private glow: GlowLayer,
    private mats: CelMaterialFactory,
  ) {}

  /**
   * Rebuilds the water bodies for a round. No-ops to a dry map when the
   * layout has no water rects or the environment has no water palette.
   *
   * `reflect` is handed one site per body and gives back one `ProbeReflection`
   * per site, in order. **It is called on every path, including the dry one**,
   * because parking last build's probes is its job too.
   */
  build(
    rects: WaterRect[],
    env: EnvironmentSpec,
    terrain: TerrainField,
    reflect: (sites: readonly Vector3[]) => CubeReflection[],
  ): void {
    this.dispose();
    const colors = env.water;
    if (rects.length === 0 || !colors) {
      reflect([]);
      return;
    }

    if (!this.foam) {
      // Plain trilinear, deliberately. Anisotropy is the obvious reach for a
      // surface seen this close to edge-on, and it was in here — but the one
      // tiled image left is a shoreline mask read through a `smoothstep`, and
      // the surface it used to be needed for is summed rather than sampled.
      this.foam = new Texture(foamUrl, this.scene);
    }

    // Pass one: the bed under every rect, and where the water in it is. Both
    // have to be known before a single material exists, because the second is
    // where the mirror is baked from.
    const beds = rects.map((r) => this.bakeDepth(r, waterY(r, terrain), terrain));
    const mirrors = reflect(beds.map((b) => b.site));

    const w = CONFIG.water;
    const lit = env.lighting;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const bed = beds[i];
      const mesh = MeshBuilder.CreateGround(
        "water",
        { width: r.width, height: r.depth },
        this.scene,
      );
      // Ankle-deep over the bed, not over absolute zero. Dig a basin under a
      // pool and the surface drops with it, so the water reads as sitting IN
      // the ground with a bank around it rather than hovering over a flat
      // plane. On a flat map the bed is 0 and this is the old behaviour.
      const surfaceY = waterY(r, terrain);
      mesh.position.set(r.x, surfaceY, r.z);
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.metadata = { noGlow: true, noOutline: true };
      mesh.freezeWorldMatrix();
      // Built after Game's construction-time glow scan, so exclude by hand.
      this.glow.addExcludedMesh(mesh);

      const hx = r.width / 2;
      const hz = r.depth / 2;
      const mat = createWaterMaterial(
        this.scene,
        "water",
        { foam: this.foam, depth: bed.tex },
        new Vector4(r.x - hx, r.z - hz, r.x + hx, r.z + hz),
      );
      mat.setVector3("lightDir", new Vector3(...lit.direction).normalize());
      mat.setColor3(
        "lightColor",
        Color3.FromHexString(lit.color).scale(lit.intensity),
      );
      mat.setColor3(
        "ambientColor",
        Color3.FromHexString(lit.ambientColor).scale(lit.ambientIntensity),
      );
      mat.setColor3(
        "skyLightColor",
        Color3.FromHexString(lit.skyLightColor).scale(lit.skyLightIntensity),
      );
      mat.setColor3("fogColor", Color3.FromHexString(env.fogColor));
      mat.setVector2("fogParams", new Vector2(env.fogStart, env.fogEnd));
      mat.setColor3("mistColor", Color3.FromHexString(env.mistColor));
      mat.setVector2("mistParams", new Vector2(env.mistHeight, env.mistStrength));
      // The top of the dome the mirror returns, taken exactly where the
      // glazing takes it (`applyEnvironment`) so two mirrors on one map cannot
      // describe two different skies.
      mat.setColor3(
        "skyZenithColor",
        Color3.FromHexString(env.sky?.zenithColor ?? env.skyColor),
      );
      // And the band under it, which is what a horizontal mirror mostly
      // returns. A map with no sky spec has no dome either, so both ends of
      // the gradient fall back to the flat sky colour and `domeAt` degrades
      // to what the glazing has always drawn.
      mat.setColor3(
        "skyHorizonColor",
        Color3.FromHexString(env.sky?.horizonColor ?? env.skyColor),
      );
      mat.setColor3("deepColor", Color3.FromHexString(colors.deepColor));
      mat.setColor3("shallowColor", Color3.FromHexString(colors.shallowColor));
      // The bed is the map's own floor unless it says otherwise, which is what
      // makes a waterline grade into the bank it is cut in on every map for
      // free — see `WaterEnvSpec.bedColor`.
      mat.setColor3(
        "bedColor",
        Color3.FromHexString(colors.bedColor ?? env.floorColor),
      );
      mat.setColor3("foamColor", Color3.FromHexString(colors.foamColor));
      // The one wave tunable a map gets a say in — see WaterEnvSpec.glint.
      mat.setFloat("specStrength", w.specStrength * (colors.glint ?? 1));

      // The mirror. No parallax box: the water reads its cube the way a
      // skybox is read, and `PROBE_BOX_GLSL` is where that is argued.
      const refl = mirrors[i];
      mat.setTexture("reflectionCube", refl.cube);
      mat.setVector4(
        "reflectProbe",
        new Vector4(
          refl.at.x,
          refl.at.y,
          refl.at.z,
          refl.strength * (colors.mirror ?? 1),
        ),
      );

      // The depth map, its matrix and its params come from the factory, which
      // is the one publisher of all three. Unregistered, the shader would
      // sample an unbound sampler and the body would sit in permanent shadow.
      this.mats.registerShadowConsumer(mat);

      mesh.material = mat;
      this.bodies.push({ mesh, mat, depth: bed.tex });
    }
  }

  /**
   * Bakes how deep the bed is under every point of a rect, as a single-channel
   * texture the shader reads to find the waterline — and, on the way, works
   * out where the water in that rect actually is.
   *
   * **This is the only thing that knows where a body of water ends.** A rect's
   * bounds are its extent, not its shore: Greyfen's flood is one 250 m rect
   * over the whole valley and its edges are out past the ridge, so a shoreline
   * drawn from the bounds is drawn nowhere the player can stand. Depth is also
   * what grades the body colour from a channel to a shoal, and what decides
   * where the bed starts showing through.
   *
   * Sampled with `surfaceAt` rather than `heightAt` for the same reason a road
   * is: the shoreline is drawn against the floor's TRIANGLES, and on a twisted
   * cell the smooth field is a quarter-twist away from them.
   *
   * Resolution is `depthTexels` per metre, capped: a map-wide rect would
   * otherwise ask for a quarter-million samples per hundred metres of side.
   * Clamped addressing — a wrapped edge would fold the far bank onto the near.
   */
  private bakeDepth(
    r: WaterRect,
    surfaceY: number,
    terrain: TerrainField,
  ): BedMap {
    const w = CONFIG.water;
    const res = (extent: number) =>
      Math.max(2, Math.min(w.depthTexelsMax, Math.round(extent * w.depthTexels)));
    const nx = res(r.width);
    const nz = res(r.depth);
    const data = new Uint8Array(nx * nz);
    // The wet centroid, weighted by depth so a mudflat at the margin does not
    // drag the probe off the channel it should be standing in.
    let wx = 0;
    let wz = 0;
    let weight = 0;
    for (let j = 0; j < nz; j++) {
      const z = r.z - r.depth / 2 + (r.depth * (j + 0.5)) / nz;
      for (let i = 0; i < nx; i++) {
        const x = r.x - r.width / 2 + (r.width * (i + 0.5)) / nx;
        const d = (surfaceY - terrain.surfaceAt(x, z, false)) / w.depthMax;
        data[j * nx + i] = d <= 0 ? 0 : d >= 1 ? 255 : Math.round(d * 255);
        if (d > 0) {
          const g = Math.min(d, 1);
          wx += x * g;
          wz += z * g;
          weight += g;
        }
      }
    }
    // invertY false: row 0 is the min-Z edge, which is what the shader's
    // `(posW.xz - bounds.xy) / size` puts at v = 0.
    const tex = RawTexture.CreateRTexture(
      data,
      nx,
      nz,
      this.scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    );
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    // A rect with no wet cell at all is a layout mistake rather than a state
    // to handle, but it must not put a probe at NaN: fall back to the centre.
    const site =
      weight > 0
        ? new Vector3(wx / weight, surfaceY, wz / weight)
        : new Vector3(r.x, surfaceY, r.z);
    return { tex, site };
  }

  /**
   * Advances the animation and uploads camera/lights. Same frame-order rule
   * as the cel materials: call after the camera and LightingSystem update.
   */
  update(dt: number, camPos: Vector3, lights: readonly PointLightData[]): void {
    if (this.bodies.length === 0) return;
    this.time += dt;

    const count = Math.min(lights.length, MAX_POINT_LIGHTS);
    for (let i = 0; i < count; i++) {
      const l = lights[i];
      this.pointPos[i * 3] = l.position.x;
      this.pointPos[i * 3 + 1] = l.position.y;
      this.pointPos[i * 3 + 2] = l.position.z;
      this.pointColor[i * 3] = l.color.r * l.intensity;
      this.pointColor[i * 3 + 1] = l.color.g * l.intensity;
      this.pointColor[i * 3 + 2] = l.color.b * l.intensity;
      this.pointRange[i] = l.range;
    }

    for (const { mat } of this.bodies) {
      mat.setFloat("time", this.time);
      mat.setVector3("camPos", camPos);
      mat.setArray3("pointPos", this.pointPos as unknown as number[]);
      mat.setArray3("pointColor", this.pointColor as unknown as number[]);
      mat.setFloats("pointRange", this.pointRange as unknown as number[]);
      mat.setFloat("pointCount", count);
    }
  }

  dispose(): void {
    for (const { mesh, mat, depth } of this.bodies) {
      // Before the dispose, not after: the factory would otherwise keep writing
      // three uniforms a frame into a dead material for the rest of the session.
      this.mats.unregisterShadowConsumer(mat);
      mesh.dispose();
      mat.dispose();
      // Baked against the terrain this body was built on; the next build's is
      // a different shape, so this one goes with the mesh rather than caching.
      depth.dispose();
    }
    this.bodies = [];
  }
}
