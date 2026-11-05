/**
 * WaterSystem.ts — Water surfaces built from the map's WaterRects: stands the
 * one wave grid under the camera and writes what the water's program reads
 * of time, the camera and the point lights every frame. Its PICTURE is
 * `render/WaterDraw.ts` (`BABYLON_EXIT.md` X4.6d): this holds the values as plain
 * arrays, writes them, and names no mesh and no material, in a round and in an
 * editor build alike.
 * Invariants: water is unpickable, non-colliding and no `solid` metadata — no
 * node at all — so ray tests cannot see it. `update` runs after the camera and
 * LightingSystem updates (shares the same 16 light slots). The grid and the quad
 * stand at the ORIGIN with each body's bounds stated by hand: the grid is moved by
 * a uniform and clamped to each rect in the vertex stage, so no vertex ever changes.
 * The one tiling texture left (the foam mask) is loaded once and reused across
 * rebuilds, and it is a texture of Babylon's, read through the seam.
 * A rect without its own `y` floats ankle-deep above the TERRAIN under it, not
 * above absolute zero — that is what lets a pool sit recessed in a dug bed.
 * The BED-DEPTH map is per body and per build — it is baked against the
 * TerrainField this build was handed, so it is as disposable as the body, and a
 * stale one would draw last build's shoreline.
 * `build` calls its `reflect` callback EXACTLY ONCE, on every path including a
 * dry map: it is what queues this build's probes, and it is what hands over the
 * cube every body must be born holding.
 * Contract: `docs/rendering.md`, "The water".
 */
import { type Scene, Texture, Vector3 } from "@babylonjs/core";

import { CONFIG } from "../config";
import { Color3 } from "../math";
import { hostTexture } from "../render/babylonSeam";
import type { HostTexture } from "../render/frameHost";
import type { WaterDraw, WaterMirror, WaterShape, WaterSurface } from "../render/WaterDraw";
import { createWaterBodyValues, createWaterShared, type WaterShared } from "../render/waterProgram";
import { MAX_POINT_LIGHTS, type CelMaterialFactory, type PointLightData } from "../shaders/CelShader";
import { waveTrains } from "../shaders/wgsl/water";
import type { EnvironmentSpec } from "../world/environment";
import type { WaterRect } from "../world/MapBuilder";
import { waterY, type TerrainField } from "../world/TerrainField";
import foamUrl from "../../textures/water-foam.png?url";

interface WaterBody {
  /** What the draw holds of it: which of its two shapes is drawn is written here. */
  surface: WaterSurface;
  /** The rect, for the near/far test. */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
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
 * cell size at that vertex, which the vertex stage reads as its sampling
 * test; the height is the wave field's.
 */
function gridData(
  xs: { at: number[]; cell: number[] },
  zs: { at: number[]; cell: number[] },
): WaterShape {
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
  return { positions, indices };
}

/** What `bakeDepth` works out about one rect. */
interface BedMap {
  /** The bed depth under every point of the rect, one byte a texel, row 0 the min-Z edge. */
  data: Uint8Array<ArrayBuffer>;
  nx: number;
  nz: number;
  /**
   * Where the water in this rect actually is: the centroid of its WET cells,
   * on the surface. A rect is its EXTENT and not its shore (Greyfen's flood is
   * one 250 m rect of which 11% is wet), so this is the only honest point to
   * stand a reflection probe at — see `ReflectionSystem.bakeWater`.
   */
  site: Vector3;
}

/**
 * Owns the water surfaces: builds one body per layout rect, feeds them the map's
 * environment palette and its own reflection probe, and per frame writes time, the
 * camera position, and the same winning point-light set the cel shader gets (so
 * lanterns and muzzle flashes glint off the creek).
 *
 * The planes are drawn and never tested: no node, no `solid` metadata — every ray
 * (hitscan, LOS, ground probes) passes through to the creek bed below. They are
 * also out of the bloom, a body being in no mask of `WaterDraw`'s.
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
  private foamHandle: HostTexture | null = null;
  /** What every body reads alike; null with no water standing. */
  private values: WaterShared | null = null;
  /** The factory's LIVE key, by reference: `commit` copies it, so a flash lights the water in its frame. */
  private key: CelMaterialFactory["keyLight"] | null = null;
  /** The eye the bodies were last stood under — see `follow`. */
  private eye = new Vector3();
  private followed = false;
  private time = 0;
  /**
   * How many wash sites the bodies are currently holding. Held only so a map
   * with no machine over its water costs nothing per frame — see `setWash`.
   * Reset on `build`, because the values it is describing are gone.
   */
  private washCount = 0;
  /** The rotors' live array, read at `commit`: a body holds zeros until the first push with something to say. */
  private washSites: Float32Array | null = null;

  constructor(
    private scene: Scene,
    private mats: CelMaterialFactory,
    private draw: WaterDraw,
  ) {}

  /** The sphere every body is gated and sorted by, and which of its shapes it draws: the draw's, for `Game`. */
  get surfaces(): readonly WaterSurface[] {
    return this.draw.surfaces;
  }

  /**
   * Rebuilds the water bodies for a round. No-ops to a dry map when the
   * layout has no water rects or the environment has no water palette.
   *
   * `reflect` is handed one site per body and gives back one `WaterMirror`
   * per site, in order. **It is called on every path, including the dry one**,
   * so a build's every call reaches the bake the same way.
   */
  build(
    rects: WaterRect[],
    env: EnvironmentSpec,
    terrain: TerrainField,
    reflect: (sites: readonly Vector3[]) => WaterMirror[],
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
      this.foamHandle = hostTexture(this.foam);
    }

    // Pass one: the bed under every rect, and where the water in it is. Both
    // have to be known before a single body exists, because the second is
    // where the mirror is baked from.
    const beds = rects.map((r) => this.bakeDepth(r, waterY(r, terrain), terrain));
    const mirrors = reflect(beds.map((b) => b.site));

    const w = CONFIG.water;
    // The wave grid and the far quad, shared by every body: a grid is the same
    // shape under every rect, because the rect is cut out of it in the vertex
    // stage. Built per build rather than kept, as the rest of this is.
    const lines = gridLines();
    const far = { at: [-w.grid.far, w.grid.far], cell: [1e6, 1e6] };
    const values = createWaterShared();
    this.values = values;
    this.key = this.mats.keyLight;
    fillShared(values, env);
    this.draw.setGeometry(gridData(lines, lines), gridData(far, far), values);
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
      const flowX = r.sound === "stream" && r.width >= r.depth ? w.waves.stream : 0;
      const flowZ = r.sound === "stream" && r.width < r.depth ? w.waves.stream : 0;
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
      const body = createWaterBodyValues();
      body.bounds.set([r.x - hx, r.z - hz, r.x + hx, r.z + hz]);
      body.surfaceY[0] = surfaceY;
      body.trainA.set(trains.a);
      body.trainB.set(trains.b);
      body.trainCount[0] = trains.count;
      body.waveFlow[0] = flowX;
      body.waveFlow[1] = flowZ;
      body.crestFoam[0] = caps;
      body.throughStrength[0] = through;
      // The mirror. No parallax box: the water reads its cube the way a
      // skybox is read, and `celProbeBox` is where that is argued.
      const refl = mirrors[i];
      body.reflectProbe.set([refl.at.x, refl.at.y, refl.at.z, refl.strength * (colors.mirror ?? 1)]);
      // The grid and the quad stand at the origin and never move: the vertex stage
      // puts every vertex where it belongs, so the bounds it is culled against are
      // the rect's, stated by hand, with the tallest crest the field can raise over it.
      const surface = this.draw.addBody(body, bed, this.foamHandle!, refl.cube, [
        r.x - hx,
        surfaceY - trains.crest,
        r.z - hz,
        r.x + hx,
        surfaceY + trains.crest,
        r.z + hz,
      ]);
      this.bodies.push({ surface, minX: r.x - hx, minZ: r.z - hz, maxX: r.x + hx, maxZ: r.z + hz });
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
   * Clamped addressing (`WaterDraw`'s sampler) — a wrapped edge would fold the far
   * bank onto the near.
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
    // A rect with no wet cell at all is a layout mistake rather than a state
    // to handle, but it must not put a probe at NaN: fall back to the centre.
    const site =
      weight > 0
        ? new Vector3(wx / weight, surfaceY, wz / weight)
        : new Vector3(r.x, surfaceY, r.z);
    return { data, nx, nz, site };
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
   * world step and the water is drawn before it. The array is held, not copied:
   * `commit` reads it for the frame it draws.
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
    // Nothing on the water and nothing on it last frame either: the values already
    // hold a zero count, so this is the ordinary frame on the five maps out of six
    // with no helicopter over a harbour.
    if (count === 0 && this.washCount === 0) return;
    this.washCount = count;
    this.washSites = sites;
    if (this.values) this.values.washCount[0] = count;
  }

  /**
   * Advances the animation and writes camera/lights. Same frame-order rule
   * as the cel materials: call after the camera and LightingSystem update.
   */
  update(dt: number, camPos: Vector3, lights: readonly PointLightData[]): void {
    const values = this.values;
    if (!values) return;
    this.time += dt;

    const count = Math.min(lights.length, MAX_POINT_LIGHTS);
    const pointPos = values.pointPos;
    const pointColor = values.pointColor;
    const pointRange = values.pointRange;
    for (let i = 0; i < count; i++) {
      const l = lights[i];
      pointPos[i * 3] = l.position.x;
      pointPos[i * 3 + 1] = l.position.y;
      pointPos[i * 3 + 2] = l.position.z;
      pointColor[i * 3] = l.color.r * l.intensity;
      pointColor[i * 3 + 1] = l.color.g * l.intensity;
      pointColor[i * 3 + 2] = l.color.b * l.intensity;
      pointRange[i] = l.range;
    }

    this.follow(camPos);
    values.time[0] = this.time;
    values.pointCount[0] = count;
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
    const values = this.values;
    if (!values) return;
    if (this.followed && this.eye.equalsWithEpsilon(camPos, 1e-4)) return;
    this.followed = true;
    this.eye.copyFrom(camPos);
    // Snapped to one near cell: a near vertex then lands on the same world
    // point every frame and cannot swim through the swell it is sampling.
    const cell = CONFIG.water.grid.cell;
    values.gridOrigin[0] = Math.round(camPos.x / cell) * cell;
    values.gridOrigin[1] = Math.round(camPos.z / cell) * cell;
    const reach = CONFIG.water.grid.quadBeyond;
    for (const body of this.bodies) {
      // A body whose nearest point is past the grid's reach is drawn as its
      // quad: nothing out there is carrying a wave, and the grid's triangles
      // would all be clamped to nothing at the cost of shading their corners.
      const dx = Math.max(body.minX - camPos.x, 0, camPos.x - body.maxX);
      const dz = Math.max(body.minZ - camPos.z, 0, camPos.z - body.maxZ);
      body.surface.near = dx * dx + dz * dz < reach * reach;
    }
    const eye = values.camPos;
    eye[0] = camPos.x;
    eye[1] = camPos.y;
    eye[2] = camPos.z;
  }

  /**
   * This frame draws, each body through the size gate (`Game.drawWater`): the live
   * key, which a lightning flash moves in the frame it lights the ground around it,
   * the rotors' array as it stands, and the draw told.
   */
  commit(): void {
    const values = this.values;
    const key = this.key;
    if (!values || !key) return;
    key.dir.toArray(values.lightDir);
    key.color.toArray(values.lightColor);
    if (this.washSites) values.washSite.set(this.washSites);
    this.draw.commit();
  }

  dispose(): void {
    // The next build's values have never been told where the eye is.
    this.followed = false;
    // The count describes values that are about to stop existing; the next
    // build's are born holding zero, so leaving it set would let `setWash`
    // skip the first push that actually had something to say.
    this.washCount = 0;
    this.washSites = null;
    // The bed-depth maps go with it: baked against the terrain this body was built
    // on, and the next build's is a different shape.
    this.draw.clear();
    this.bodies = [];
    this.values = null;
    this.key = null;
  }
}

/** A colour off a map's hex, scaled, into a tight array. */
function color(out: Float32Array, hex: string, scale = 1): void {
  const c = Color3.FromHexString(hex).scale(scale);
  out[0] = c.r;
  out[1] = c.g;
  out[2] = c.b;
}

/**
 * Every value the bodies read alike that holds still, off the map's environment
 * and `CONFIG.water`. **Add a field to `WATER_SHARED` and it owes a line here or a
 * writer**: `foamParams` was once declared, read and never uploaded, which silently
 * zeroed the foam on every map. A body is born with no rotor over it, which is every
 * body on every map until one flies out there (`setWash`), and with no lamp.
 */
function fillShared(values: WaterShared, env: EnvironmentSpec): void {
  const w = CONFIG.water;
  const lit = env.lighting;
  const colors = env.water!;
  const deg = Math.PI / 180;
  color(values.ambientColor, lit.ambientColor, lit.ambientIntensity);
  color(values.skyLightColor, lit.skyLightColor, lit.skyLightIntensity);
  color(values.fogColor, env.fogColor);
  values.fogParams[0] = env.fogStart;
  values.fogParams[1] = env.fogEnd;
  color(values.mistColor, env.mistColor);
  values.mistParams[0] = env.mistHeight;
  values.mistParams[1] = env.mistStrength;
  // The top of the dome the mirror returns, taken exactly where the
  // glazing takes it (`applyEnvironment`) so two mirrors on one map cannot
  // describe two different skies.
  color(values.skyZenithColor, env.sky?.zenithColor ?? env.skyColor);
  // And the band under it, which is what a horizontal mirror mostly
  // returns. A map with no sky spec has no dome either, so both ends of
  // the gradient fall back to the flat sky colour and `domeAt` degrades
  // to what the glazing has always drawn.
  color(values.skyHorizonColor, env.sky?.horizonColor ?? env.skyColor);
  color(values.deepColor, colors.deepColor);
  color(values.shallowColor, colors.shallowColor);
  // The bed is the map's own floor unless it says otherwise, which is what
  // makes a waterline grade into the bank it is cut in on every map for
  // free — see `WaterEnvSpec.bedColor`.
  color(values.bedColor, colors.bedColor ?? env.floorColor);
  color(values.foamColor, colors.foamColor);
  // How bright the light on the waves is — see WaterEnvSpec.glint.
  const glint = colors.glint ?? 1;
  values.glintStrength[0] = w.light.glint.strength * glint;
  values.sheenStrength[0] = w.light.sheen.strength * glint;
  values.waveDrag[0] = w.waves.drag;
  values.waveBreak[0] = w.waves.break;
  values.waveLap[0] = w.waves.lap;
  values.waveDetail[0] = w.waves.detail;
  values.gridDetail[0] = w.grid.detail[0];
  values.gridDetail[1] = w.grid.detail[1];
  values.reflectance[0] = w.reflectance;
  values.fresnelPower[0] = w.fresnelPower;
  values.sunHalo[0] = w.sunHalo;
  values.haloStrength[0] = w.haloStrength;
  values.mirrorBlur[0] = w.mirrorBlur;
  values.mirrorChop[0] = w.mirrorChop;
  values.glintCut[0] = w.light.glint.degrees * deg;
  values.sheenCut[0] = w.light.sheen.degrees * deg;
  values.lampCut[0] = w.light.lamp[0] * deg;
  values.lampCut[1] = w.light.lamp[1] * deg;
  values.throughCrest[0] = w.light.through.crest;
  values.depthMax[0] = w.depthMax;
  values.depthDry[0] = w.depthDry;
  values.depthFade[0] = w.depthFade;
  values.bedDepth[0] = w.bedDepth;
  values.bedShow[0] = w.bedShow;
  values.caustics[0] = w.caustics;
  values.scatter[0] = w.scatter;
  values.foamWidth[0] = w.foamWidth;
  values.foamScale[0] = w.foamScale;
  values.foamSpeed[0] = w.foamSpeed;
  values.foamSlope[0] = w.foamSlope;
  values.capLevel[0] = w.caps.level;
  values.fleckStrength[0] = w.fleckStrength;
  values.washReach[0] = w.wash.reach;
  values.washFlatten[0] = w.wash.flatten;
  values.washBlur[0] = w.wash.blur;
  values.washFoam[0] = w.wash.foam;
  values.washHeight[0] = w.wash.height;
  values.washLength[0] = w.wash.length;
  values.washSpeed[0] = w.wash.speed;
}
