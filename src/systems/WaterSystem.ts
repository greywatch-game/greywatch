/**
 * WaterSystem.ts — Water surfaces built from the map's WaterRects; stands the
 * one wave grid under the camera and syncs each water material's
 * time/camera/point-light uniforms every frame.
 * Invariants: water meshes are unpickable, non-colliding, and never carry
 * metadata.solid — ray tests must not see them. update() runs after the camera
 * and LightingSystem updates (shares the same 16 light slots). Meshes are
 * frozen at the ORIGIN with their bounds set by hand: the grid is moved by a
 * uniform and clamped to each rect in the vertex shader, so no world matrix or
 * vertex ever changes. The one tiling texture left (the foam mask) is loaded
 * once and reused across rebuilds.
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
  BoundingInfo,
  Color3,
  Constants,
  Geometry,
  Mesh,
  RawTexture,
  Scene,
  type ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  Vector4,
  VertexData,
} from "@babylonjs/core";

import { CONFIG } from "../config";
import {
  MAX_POINT_LIGHTS,
  type CelMaterialFactory,
  type PointLightData,
  type CubeReflection,
} from "../shaders/CelShader";
import { createWaterMaterial, waveTrains } from "../shaders/WaterShader";
import type { EnvironmentSpec } from "../world/environment";
import type { WaterRect } from "../world/MapBuilder";
import { waterY, type TerrainField } from "../world/TerrainField";
import foamUrl from "../../textures/water-foam.png?url";

interface WaterBody {
  /** The shared wave grid, for when the camera is near enough to see it move. */
  grid: Mesh;
  /** Two triangles over the whole rect, for when it is not. */
  quad: Mesh;
  mat: ShaderMaterial;
  /** Baked against this build's terrain, so it dies with the body. */
  depth: RawTexture;
  /** The rect, for the near/far test. */
  min: Vector2;
  max: Vector2;
}

/**
 * The grid's lines along one axis, as offsets from its origin, and the cell
 * each one bounds — the WIDER of its two neighbours', because that is the one
 * a train drawn at that vertex has to be resolved against.
 *
 * Uniform under the camera and geometric beyond it, closed by one line far
 * enough to reach any rect in the tree. See `CONFIG.water.grid`.
 */
function gridLines(): { at: number[]; cell: number[] } {
  const g = CONFIG.water.grid;
  const half = [0];
  let x = 0;
  while (x + g.cell <= g.near + 1e-6) {
    x += g.cell;
    half.push(x);
  }
  let step: number = g.cell;
  while (x < g.reach) {
    step *= g.growth;
    x += step;
    half.push(x);
  }
  half.push(g.far);
  const at = [
    ...half
      .slice(1)
      .reverse()
      .map((v) => -v),
    ...half,
  ];
  const cell = at.map((v, i) =>
    Math.max(
      i > 0 ? v - at[i - 1] : 0,
      i < at.length - 1 ? at[i + 1] - v : 0,
    ),
  );
  return { at, cell };
}

/**
 * A grid over `xs` by `zs`, laid out and wound exactly as
 * `MeshBuilder.CreateGround` lays out its own, so it faces the way every
 * other floor in the game faces. `position.y` is not a height — it is the
 * cell size at that vertex, which the vertex shader reads as its sampling
 * test; the height is the wave field's.
 */
function gridData(
  xs: { at: number[]; cell: number[] },
  zs: { at: number[]; cell: number[] },
): VertexData {
  const nx = xs.at.length;
  const nz = zs.at.length;
  const positions = new Float32Array(nx * nz * 3);
  for (let row = 0; row < nz; row++) {
    // CreateGround's row 0 is its FAR edge (max z), and the winding below
    // assumes it.
    const j = nz - 1 - row;
    for (let col = 0; col < nx; col++) {
      const o = (row * nx + col) * 3;
      positions[o] = xs.at[col];
      positions[o + 1] = Math.max(xs.cell[col], zs.cell[j]);
      positions[o + 2] = zs.at[j];
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let row = 0; row < nz - 1; row++) {
    for (let col = 0; col < nx - 1; col++) {
      indices[k++] = col + 1 + (row + 1) * nx;
      indices[k++] = col + 1 + row * nx;
      indices[k++] = col + row * nx;
      indices[k++] = col + (row + 1) * nx;
      indices[k++] = col + 1 + (row + 1) * nx;
      indices[k++] = col + row * nx;
    }
  }
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  return data;
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
 * to the creek bed below. They are also out of the bloom (`noGlow`) and the
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
  private origin = new Vector2();
  /** The eye the bodies were last stood under — see `follow`. */
  private eye = new Vector3();
  private followed = false;
  private time = 0;
  /**
   * How many wash sites the bodies are currently holding. Held only so a map
   * with no machine over its water costs nothing per frame — see `setWash`.
   * Reset on `build`, because the materials it is describing are gone.
   */
  private washCount = 0;

  // Packed point-light uniforms, reused every frame to avoid allocation.
  private pointPos = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointColor = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointRange = new Float32Array(MAX_POINT_LIGHTS);

  constructor(
    private scene: Scene,
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
    // The wave grid and the far quad, shared by every body's two meshes: a
    // grid is the same shape under every rect, because the rect is cut out of
    // it in the vertex shader. Built per build rather than kept, because a
    // Geometry is disposed with the last mesh wearing it.
    const lines = gridLines();
    const gridGeom = new Geometry("waterGrid", this.scene, gridData(lines, lines));
    const far = { at: [-w.grid.far, w.grid.far], cell: [1e6, 1e6] };
    const quadGeom = new Geometry("waterQuad", this.scene, gridData(far, far));
    // The open water's swell is the map's; everything finer follows from it.
    const mapSwell = colors.swell ?? w.waves.swell;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const bed = beds[i];
      // Ankle-deep over the bed, not over absolute zero. Dig a basin under a
      // pool and the surface drops with it, so the water reads as sitting IN
      // the ground with a bank around it rather than hovering over a flat
      // plane. On a flat map the bed is 0 and this is the old behaviour.
      const surfaceY = waterY(r, terrain);
      const hx = r.width / 2;
      const hz = r.depth / 2;
      // A narrow rect cannot raise the map's swell — see `waves.fetch`.
      const swell = Math.min(mapSwell, w.waves.fetch * Math.min(r.width, r.depth));
      const trains = waveTrains(swell);
      // A stream runs along its long side; the sign is arbitrary and nothing
      // downstream of it can tell.
      const flow =
        r.sound === "stream"
          ? r.width >= r.depth
            ? new Vector2(w.waves.stream, 0)
            : new Vector2(0, w.waves.stream)
          : Vector2.Zero();
      const caps =
        w.crestFoam *
        Math.min(
          Math.max((swell - w.caps.swell[0]) / (w.caps.swell[1] - w.caps.swell[0]), 0),
          1,
        );
      // Light through a crest needs a crest thick enough to be seen from the
      // side; on a pond's ripple it drew flat pale coins.
      const through =
        w.light.through.strength *
        Math.min(
          Math.max(
            (swell - w.light.through.swell[0]) /
              (w.light.through.swell[1] - w.light.through.swell[0]),
            0,
          ),
          1,
        );
      const mat = createWaterMaterial(
        this.scene,
        "water",
        { foam: this.foam, depth: bed.tex },
        new Vector4(r.x - hx, r.z - hz, r.x + hx, r.z + hz),
        { y: surfaceY, trains, flow, caps, through },
      );
      // Both meshes stand at the origin and never move: the vertex shader
      // puts every vertex where it belongs, so the bounds Babylon culls
      // against are the rect's, stated by hand, with the tallest crest the
      // field can raise over it.
      const lo = new Vector3(r.x - hx, surfaceY - trains.crest, r.z - hz);
      const hi = new Vector3(r.x + hx, surfaceY + trains.crest, r.z + hz);
      const make = (geom: Geometry, name: string): Mesh => {
        const mesh = new Mesh(name, this.scene);
        geom.applyToMesh(mesh);
        mesh.setBoundingInfo(new BoundingInfo(lo, hi));
        mesh.doNotSyncBoundingInfo = true;
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.metadata = { noGlow: true };
        mesh.material = mat;
        mesh.freezeWorldMatrix();
        return mesh;
      };
      const grid = make(gridGeom, "water");
      const quad = make(quadGeom, "waterFar");
      quad.isVisible = false;
      // The factory's LIVE key, by reference — see GrassSystem.
      const key = this.mats.keyLight;
      mat.setVector3("lightDir", key.dir);
      mat.setColor3("lightColor", key.color);
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
      // How bright the light on the waves is — see WaterEnvSpec.glint.
      const glint = colors.glint ?? 1;
      mat.setFloat("glintStrength", w.light.glint.strength * glint);
      mat.setFloat("sheenStrength", w.light.sheen.strength * glint);

      // The mirror. No parallax box: the water reads its cube the way a
      // skybox is read, and `celProbeBox` is where that is argued.
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

      this.bodies.push({
        grid,
        quad,
        mat,
        depth: bed.tex,
        min: new Vector2(r.x - hx, r.z - hz),
        max: new Vector2(r.x + hx, r.z + hz),
      });
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
        // SIGNED: the bank above the surface is negative depth, so the
        // filtered zero is where the ground actually crosses the water rather
        // than half a texel up the bank under it. See `CONFIG.water.depthDry`.
        const d = (surfaceY - terrain.surfaceAt(x, z, false)) / w.depthMax;
        const e = (d * w.depthMax + w.depthDry) / (w.depthMax + w.depthDry);
        data[j * nx + i] = e <= 0 ? 0 : e >= 1 ? 255 : Math.round(e * 255);
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
   * The rotors currently working this map's water, packed as the shader wants
   * them: four floats a site — x, z, the ring's radius and how hard, 0..1.
   *
   * **It is a push of its own rather than an argument to `update`, and the
   * reason is WHERE each of the two is called from.** `update` runs in the
   * frame's camera tail, which only the states that simulate reach; this is
   * pushed from `tick` beside the dust the same sites are driving, where
   * `RotorWash` has just asked every machine on the field. Handed to `update`
   * it would be one frame stale, because the wash is worked out after the
   * world step and the water is drawn before it.
   *
   * **`Game` gates it on `fleetStepped`, and that gate is what freezes the
   * hole rather than closing it.** A held world is a machine hanging
   * motionless over the bay: `RotorWash` answers 0 for it (nothing is being
   * pushed), and pushing that 0 would heal the water under a deploy card while
   * the swell around it stays stopped mid-crest — the surface's own `time` is
   * not advancing either. Not pushing leaves the whole picture stopped
   * together, which is what a lid means.
   */
  setWash(sites: Float32Array, count: number): void {
    // Nothing on the water and nothing on it last frame either: every material
    // is already holding a zero count, so this is the ordinary frame on the
    // five maps out of six with no helicopter over a harbour.
    if (count === 0 && this.washCount === 0) return;
    this.washCount = count;
    for (const { mat } of this.bodies) {
      mat.setArray4("washSite", sites as unknown as number[]);
      mat.setFloat("washCount", count);
    }
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

    this.follow(camPos);
    for (const { mat } of this.bodies) {
      mat.setFloat("time", this.time);
      mat.setArray3("pointPos", this.pointPos as unknown as number[]);
      mat.setArray3("pointColor", this.pointColor as unknown as number[]);
      mat.setFloats("pointRange", this.pointRange as unknown as number[]);
      mat.setFloat("pointCount", count);
    }
  }

  /**
   * Stands the wave grid under the eye and tells every body where the eye is.
   *
   * **Pushed from `tick` in EVERY state, beside the cull and the mote field,
   * and called by `update` as well.** `update` is the camera tail, which only
   * the states that simulate reach, and the scene renders behind the deploy
   * screen and the kit turntable too: a grid left standing wherever the last
   * live frame stood is a sea that heaves over there and lies flat under the
   * eye, with its Fresnel asked of the wrong vantage. Nothing here advances
   * the water's clock, so a held world stays held. Guarded on the position,
   * so the second call in a live frame costs one comparison.
   */
  follow(camPos: Vector3): void {
    if (this.bodies.length === 0) return;
    if (this.followed && this.eye.equalsWithEpsilon(camPos, 1e-4)) return;
    this.followed = true;
    this.eye.copyFrom(camPos);
    // Snapped to one near cell: a near vertex then lands on the same world
    // point every frame and cannot swim through the swell it is sampling.
    const cell = CONFIG.water.grid.cell;
    this.origin.set(
      Math.round(camPos.x / cell) * cell,
      Math.round(camPos.z / cell) * cell,
    );
    const reach = CONFIG.water.grid.quadBeyond;
    for (const body of this.bodies) {
      // A body whose nearest point is past the grid's reach is drawn as its
      // quad: nothing out there is carrying a wave, and the grid's triangles
      // would all be clamped to nothing at the cost of shading their corners.
      const dx = Math.max(body.min.x - camPos.x, 0, camPos.x - body.max.x);
      const dz = Math.max(body.min.y - camPos.z, 0, camPos.z - body.max.y);
      const near = dx * dx + dz * dz < reach * reach;
      body.grid.isVisible = near;
      body.quad.isVisible = !near;
      body.mat.setVector3("camPos", this.eye);
      body.mat.setVector2("gridOrigin", this.origin);
    }
  }

  dispose(): void {
    // The next build's materials have never been told where the eye is.
    this.followed = false;
    // The count describes materials that are about to stop existing; the next
    // build's are born holding zero, so leaving it set would let `setWash`
    // skip the first push that actually had something to say.
    this.washCount = 0;
    for (const { grid, quad, mat, depth } of this.bodies) {
      // Before the dispose, not after: the factory would otherwise keep writing
      // three uniforms a frame into a dead material for the rest of the session.
      this.mats.unregisterShadowConsumer(mat);
      // The shared grid and quad go with the last body wearing them.
      grid.dispose();
      quad.dispose();
      mat.dispose();
      // Baked against the terrain this body was built on; the next build's is
      // a different shape, so this one goes with the mesh rather than caching.
      depth.dispose();
    }
    this.bodies = [];
  }
}
