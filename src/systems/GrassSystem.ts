/**
 * GrassSystem.ts — The grass field: a mask baked per round from the map's
 * GrassRects, a handful of PATCH meshes of blade seeds and of turf, and per
 * frame the patches around the eye that are in view, each drawn from the
 * smallest mesh that still holds everything it wants — plus the values of
 * time, camera, point lights and pushers the two programs read. Its PICTURE is
 * `render/GrassDraw.ts` (`BABYLON_EXIT.md` X4.6c): this holds the runs and the
 * block's values as plain arrays, writes them, and names no mesh and no material.
 * Invariants: grass is VISUAL ONLY — no node, no collider, in no bake, no shadow
 * map and no glow's mask; ray tests and bots must not see it. The CPU's
 * `keep` is the shader's `keepShare`, number for number: the mesh a patch is
 * drawn from is chosen off it, and a patch drawn from a mesh holding fewer
 * blades than the shader keeps is a patch with a hole in it. Every blade
 * patch mesh is a PREFIX of one blade order, so a blade's place in the
 * patch is the same whichever mesh draws it. A run with no patches this frame
 * is not drawn at all.
 * `follow` is pushed from `tick` in every state; `update` is the camera tail
 * and runs after the camera and LightingSystem updates (shares the same 16
 * light slots) — same frame-order rule as WaterSystem.
 * Contract: `docs/rendering.md`.
 *
 * WHY A FIELD AROUND THE EYE. The field used to be every tuft on the map, one
 * thin instance each, drawn every frame from one bounding box over the whole
 * valley — so a map paid for its grass by AREA and every layout carried a
 * tuft budget spread as thin as its ground was wide. Now the blades are
 * placed on the GPU (`shaders/wgsl/grass.ts`) and only the patches the eye can see are
 * drawn, dense near and thinning as `(near / d)^2` beyond, which is a
 * constant number of blades per unit of SCREEN. A hillside costs what can be
 * seen of it, and a map may state as much grass as it likes.
 */
import { Frustum, Matrix, type Plane, type TargetCamera, type Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { GrassQuality } from "../core/settings";
import type { Combatant } from "../entities/Combatant";
import { Color3 } from "../math";
import type { GrassDraw, GrassRun } from "../render/GrassDraw";
import { createGrassValues, PATCH_FLOATS, type GrassValues } from "../render/grassProgram";
import { MAX_POINT_LIGHTS, type CelMaterialFactory, type PointLightData } from "../shaders/CelShader";
import { TURF_LODS } from "../shaders/wgsl/grass";
import type { EnvironmentSpec } from "../world/environment";
import { bakeGrassMask, type GrassMask, MAX_HEIGHT_SCALE } from "../world/grassMask";
import type { GrassRect, WaterRect, WorldBox } from "../world/MapBuilder";
import type { RoadFootprint } from "../world/roads";
import type { TerrainField } from "../world/TerrainField";
import { mulberry32 } from "../world/rng";

const MAX_PUSHERS = CONFIG.grass.maxPushers;

/**
 * The heights along a blade its vertices stand at: three pairs and a tip. Four
 * joints is what lets the vertex-stage bend read as a CURVE; the tip is one
 * vertex, so a blade is five triangles (a far one is one — `SIMPLE_SHARE`).
 */
const JOINTS = [0, 0.38, 0.72] as const;

/** The fewest blades a patch mesh is cut down to; below this a LOD saves nothing. */
const MIN_LOD_BLADES = 24;

/**
 * Each patch mesh holds this share of the one before it. A patch is drawn
 * from the smallest mesh still holding every blade it keeps, so the step is
 * the most vertex work a patch can waste on blades the shader then collapses:
 * a halving wastes up to half, this up to 29%. It is paid for in draw calls —
 * one per mesh that has a patch in view — and there are a dozen.
 */
const LOD_STEP = Math.SQRT1_2;

/**
 * At or below this share a patch mesh's blades are a single TRIANGLE — root
 * pair and tip — rather than five. A mesh this thin is only ever chosen for
 * a patch far enough out that the field has thinned to an eighth, thirty
 * metres at the least, where a blade is a few pixels wide and its curve is
 * not a thing anyone can see; and those far patches are most of the patches.
 */
const SIMPLE_SHARE = 0.126;

/** Patches per side of the coarse block the walk culls first. */
const BLOCK = 4;


/**
 * The order blades are drawn in within a patch: `n` roots in the unit square,
 * such that EVERY PREFIX of the list is spread evenly over it — which is what
 * lets a far patch be drawn from the first quarter of the blades and still
 * look like the same field, only thinner.
 *
 * It is a jittered grid read in bit-reversed quadtree order, with the order of
 * each node's four children SHUFFLED. Plain bit reversal puts the first 4^j
 * points in the same corner of every block — a regular lattice, which a field
 * of grass shows at a glance as rows; shuffling each node means the first
 * 4^j points are one per block at a RANDOM place in it, a stratified sample at
 * every prefix length. Toroidal by construction, so patches tile without a
 * seam.
 */
function bladeOrder(n: number, rng: () => number): Float32Array {
  let levels = 0;
  while (4 ** levels < n) levels++;
  const side = 2 ** levels;
  // One shuffle of the four children per quadtree node, drawn lazily.
  const perms = new Map<number, number[]>();
  const permOf = (node: number): number[] => {
    let p = perms.get(node);
    if (!p) {
      p = [0, 1, 2, 3];
      for (let i = 3; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
      }
      perms.set(node, p);
    }
    return p;
  };
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    let node = 1;
    let x = 0;
    let y = 0;
    let rest = i;
    for (let l = 0; l < levels; l++) {
      // Least significant digit first: the first four blades pick one child of
      // the ROOT each, the next twelve fill the grandchildren, and so on.
      const c = permOf(node)[rest & 3];
      rest >>= 2;
      node = node * 4 + c;
      x = x * 2 + (c & 1);
      y = y * 2 + (c >> 1);
    }
    out[i * 2] = (x + rng()) / side;
    out[i * 2 + 1] = (y + rng()) / side;
  }
  return out;
}

/**
 * One blade patch mesh: the first `count` of `total` blades, as seeds.
 * `position` is (u, t, v) — the root in the patch and the height along the
 * blade — and `blade` is (side, rank, s0, s1). The shader builds every blade
 * from these; nothing here knows how tall a blade is or which way it faces.
 */
function bladeVertexData(
  roots: Float32Array,
  seeds: Float32Array,
  count: number,
  total: number,
  simple: boolean,
): { positions: Float32Array; blade: Float32Array; indices: Uint32Array } {
  const joints: readonly number[] = simple ? [0] : JOINTS;
  const perBlade = joints.length * 2 + 1;
  const positions = new Float32Array(count * perBlade * 3);
  const blade = new Float32Array(count * perBlade * 4);
  const indices = new Uint32Array(count * (perBlade - 2) * 3);
  let v = 0;
  let ix = 0;
  for (let b = 0; b < count; b++) {
    const u = roots[b * 2];
    const w = roots[b * 2 + 1];
    const rank = b / total;
    const s0 = seeds[b * 2];
    const s1 = seeds[b * 2 + 1];
    const base = v;
    const put = (t: number, side: number): void => {
      positions[v * 3] = u;
      positions[v * 3 + 1] = t;
      positions[v * 3 + 2] = w;
      blade[v * 4] = side;
      blade[v * 4 + 1] = rank;
      blade[v * 4 + 2] = s0;
      blade[v * 4 + 3] = s1;
      v++;
    };
    for (const t of joints) {
      put(t, -1);
      put(t, 1);
    }
    put(1, 0);
    // Pairs (0,1) (2,3) (4,5), tip 6: a strip up the blade and a fan at the top.
    for (let j = 0; j < joints.length - 1; j++) {
      const a = base + j * 2;
      indices[ix++] = a;
      indices[ix++] = a + 1;
      indices[ix++] = a + 2;
      indices[ix++] = a + 2;
      indices[ix++] = a + 1;
      indices[ix++] = a + 3;
    }
    const top = base + (joints.length - 1) * 2;
    indices[ix++] = top;
    indices[ix++] = top + 1;
    indices[ix++] = top + 2;
  }
  return { positions, blade, indices };
}

/**
 * One turf patch mesh, appended to its kind's arrays: an `n` x `n` grid over the
 * unit square. `position` is (u, 0, v); the shader puts it on the ground, and
 * puts a vertex on an EDGE where the coarser patch beside it draws that edge.
 */
function turfGrid(n: number, positions: number[], indices: number[], base: number): void {
  const at = (i: number, j: number): number => base + j * (n + 1) + i;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) positions.push(i / n, 0, j / n);
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j + 1);
      indices.push(a, c, b, b, c, d);
    }
  }
}

/** A smoothstep, the shader's, for `keep`. */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** One blade patch mesh: its run, and the blades it holds as a share of the full patch. */
interface PatchLod extends GrassRun {
  share: number;
}

/** A run with room for a round's patches: big enough that a round rarely outgrows it (`place`). */
function newRun(firstIndex: number, indexCount: number, baseVertex: number): GrassRun {
  return { firstIndex, indexCount, baseVertex, patches: new Float32Array(PATCH_FLOATS * 512), count: 0, firstInstance: 0 };
}

/** Per BLOCK of patches, what the walk needs to skip the whole block at once. */
interface Blocks {
  nx: number;
  nz: number;
  cover: Float32Array;
  yLo: Float32Array;
  yHi: Float32Array;
}

/**
 * Owns the grass field: bakes the mask per round, builds the patch meshes per
 * quality rung, and per frame chooses the patches in view and writes time,
 * camera, the winning point-light set and the nearest combatants as pushers.
 *
 * The field is drawn and never tested: it is no node and no collider — every ray
 * (hitscan, LOS, ground probes) passes through it, and bots neither path around
 * nor trip over it.
 */
export class GrassSystem {
  private lods: PatchLod[] = [];
  private turfLods: GrassRun[] = [];
  /** The block's values, the standing field's: `time` is read by the bank's pin too. */
  values: GrassValues | null = null;
  private mask: GrassMask | null = null;
  private blocks: Blocks | null = null;
  private quality: GrassQuality = "high";
  /** The map's fog end: nothing past it is worth drawing. */
  private fogEnd = Infinity;
  private time = 0;

  // Scratch, reused every frame to avoid allocation.
  private bestD2 = new Float32Array(MAX_PUSHERS);
  private planes: Plane[] = Frustum.GetPlanes(Matrix.Identity());
  /** The factory's LIVE key, by reference: `commit` copies it, so an environment pushed lights the field in its frame. */
  private key: CelMaterialFactory["keyLight"] | null = null;
  /** The whole field's bounding sphere, or null with no field: the size gate's and the sort key's. */
  sphere: { readonly x: number; readonly y: number; readonly z: number; readonly radius: number } | null = null;
  /**
   * Per patch, the `TURF_LODS` row it draws its turf at this walk (-1 for
   * none), filled only as the walk asks, and the walk that filled it. See
   * `turfRow`: a patch's edges are stitched off its NEIGHBOURS' rows, so a row
   * is asked up to nine times a walk.
   */
  private rowOf = new Int8Array(0);
  private rowWalk = new Uint32Array(0);
  private walkId = 0;
  /** What `turfRow` measures from, written at the top of each walk. */
  private readonly walkAt = {
    ex: 0,
    ey: 0,
    ez: 0,
    lodScale: 1,
    reach: 0,
    floor: 0,
    bladeTop: 0,
  };
  /** What the field drew last frame, for anyone measuring it. */
  readonly stats = { patches: 0, blades: 0, turf: 0 };

  constructor(
    private draw: GrassDraw,
    private mats: CelMaterialFactory,
  ) {}

  /**
   * Rebuilds the field for a round. No-ops to a bald map when the layout has
   * no grass rects or the environment has no grass palette. `boxes` are the
   * map's colliders, `parts` its structures' drawn parts near the ground
   * (`GameMap.partBoxes`) and `roads` its carriageways: grass is ROOTED, and
   * grows in none of them; under `water` it grows as reeds (see
   * `bakeGrassMask`).
   */
  build(
    rects: readonly GrassRect[],
    water: readonly WaterRect[],
    env: EnvironmentSpec,
    boxes: readonly WorldBox[],
    parts: readonly WorldBox[],
    roads: RoadFootprint,
    terrain: TerrainField,
    /** The map's extent, and how far its ground runs past it. */
    size: number,
    margin: number,
  ): void {
    this.dispose();
    if (rects.length === 0 || !env.grass) return;
    this.time = 0;
    this.fogEnd = env.fogEnd;

    const mask = bakeGrassMask(rects, water, boxes, parts, roads, terrain, size / 2 + margin);
    if (!mask) return;
    this.mask = mask;
    this.blocks = summariseBlocks(mask);
    this.rowOf = new Int8Array(mask.patches.nx * mask.patches.nz);
    this.rowWalk = new Uint32Array(mask.patches.nx * mask.patches.nz);

    this.sphere = fieldSphere(mask);
    this.key = this.mats.keyLight;

    const values = createGrassValues();
    this.values = values;
    const lit = env.lighting;
    const color = (out: Float32Array, hex: string, scale = 1): void => {
      const c = Color3.FromHexString(hex).scale(scale);
      out[0] = c.r;
      out[1] = c.g;
      out[2] = c.b;
    };
    values.keyWrap[0] = lit.keyWrap ?? 0;
    color(values.ambientColor, lit.ambientColor, lit.ambientIntensity);
    color(values.fogColor, env.fogColor);
    values.fogParams[0] = env.fogStart;
    values.fogParams[1] = env.fogEnd;
    color(values.mistColor, env.mistColor);
    values.mistParams[0] = env.mistHeight;
    values.mistParams[1] = env.mistStrength;
    color(values.rootColor, env.grass.rootColor);
    color(values.tipColor, env.grass.tipColor);
    color(values.rimColor, lit.rimColor, lit.rimIntensity);
    values.maskOrigin[0] = mask.x0;
    values.maskOrigin[1] = mask.z0;
    values.maskOrigin[2] = mask.texel;
    values.maskSize[0] = mask.nx;
    values.maskSize[1] = mask.nz;
    values.maskHeight[0] = mask.yMin;
    values.maskHeight[1] = mask.yMax;
    // The bearing is the valley's, not the field's — `CONFIG.wind` is shared with
    // the foliage the same air moves, and a field leaning one way under a canopy
    // leaning another is two animations rather than a breeze.
    const w = CONFIG.wind;
    const windLength = Math.sqrt(w.dir[0] * w.dir[0] + w.dir[1] * w.dir[1]);
    values.windDir[0] = w.dir[0] * (1 / windLength);
    values.windDir[1] = w.dir[1] * (1 / windLength);
    values.windParams[0] = w.grass.travel;
    values.windParams[1] = w.grass.speed;
    values.gustParams[0] = 1 / w.grass.gust;
    values.gustParams[1] = w.grass.gustSpeed;
    values.gustParams[2] = w.grass.gustLean;
    values.gustParams[3] = w.grass.flutter;
    values.sheen[0] = w.grass.sheen;
    values.pushParams[0] = CONFIG.grass.pushRadius;
    values.pushParams[1] = CONFIG.grass.pushStrength;
    // What a field is drawn with before its first `follow` and `update`.
    values.lodScale[0] = 1;
    values.fieldParams.fill(1);
    this.draw.setField(values, mask.data as Uint8Array<ArrayBuffer>, mask.nx, mask.nz);

    this.buildLods();
    this.buildTurf();
  }

  /**
   * The quality rung: how dense the near field is and how far the field
   * reaches. Rebuilds the blade meshes and nothing else — the mask is the
   * map's and does not move with it, and the turf is the same at every rung.
   */
  setQuality(q: GrassQuality): void {
    if (q === this.quality) return;
    this.quality = q;
    if (this.values) this.buildLods();
  }

  /**
   * The blade patch meshes for the current rung: the full patch and every
   * `LOD_STEP` of it down to `MIN_LOD_BLADES`, each a prefix of the same order.
   */
  private buildLods(): void {
    this.lods = [];
    if (!this.mask || !this.values) return;
    const g = CONFIG.grass;
    const tier = g.tiers[this.quality];
    const total = Math.max(MIN_LOD_BLADES, Math.round(tier.density * g.patch * g.patch));
    // Seeded, so every client grows the same field — and seeded apart from the
    // mask, which is not random at all.
    const rng = mulberry32(0x6a55);
    const roots = bladeOrder(total, rng);
    const seeds = new Float32Array(total * 2);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rng();

    // Each mesh is a prefix of one of two sets of seeds, the five-triangle blades
    // and the one-triangle ones: a run of a set's indices, its blades' first.
    const steps: { share: number; count: number; simple: boolean }[] = [];
    let simpleMost = 0;
    for (let share = 1; ; share *= LOD_STEP) {
      const count = Math.ceil(total * share);
      if (count < MIN_LOD_BLADES && share < 1) break;
      const simple = share <= SIMPLE_SHARE;
      steps.push({ share, count, simple });
      if (simple) simpleMost = Math.max(simpleMost, count);
    }
    const full = bladeVertexData(roots, seeds, total, total, false);
    const thin = bladeVertexData(roots, seeds, simpleMost, total, true);
    const positions = new Float32Array(full.positions.length + thin.positions.length);
    positions.set(full.positions);
    positions.set(thin.positions, full.positions.length);
    const blade = new Float32Array(full.blade.length + thin.blade.length);
    blade.set(full.blade);
    blade.set(thin.blade, full.blade.length);
    const indices = new Uint32Array(full.indices.length + thin.indices.length);
    indices.set(full.indices);
    indices.set(thin.indices, full.indices.length);
    const fullVertices = full.positions.length / 3;
    for (const { share, count, simple } of steps) {
      const run = simple
        ? newRun(full.indices.length, count * 3, fullVertices)
        : newRun(0, count * 15, 0);
      this.lods.push(Object.assign(run, { share }));
    }
    this.draw.setBlades({ positions, blade, indices }, this.lods);
  }

  /** The turf patch meshes, one per row of `TURF_LODS`: a run each of one set of grids. */
  private buildTurf(): void {
    if (!this.mask) return;
    const positions: number[] = [];
    const indices: number[] = [];
    this.turfLods = TURF_LODS.map((row) => {
      const first = indices.length;
      turfGrid(row.cells, positions, indices, positions.length / 3);
      return newRun(first, indices.length - first, 0);
    });
    this.draw.setTurf({ positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }, this.turfLods);
  }

  /**
   * The share of a patch's blades kept at distance `d` — `keepShare` in the
   * shader, number for number.
   */
  private keep(d: number, near: number, reach: number): number {
    const g = CONFIG.grass;
    const thin = Math.min(1, Math.max(g.thinFloor, (near * near) / Math.max(d * d, 1e-4)));
    return thin * (1 - smoothstep(reach * (1 - g.fade), reach, d));
  }

  /**
   * Advances the animation and uploads lights and pushers. Pushers are the
   * `maxPushers` combatants nearest the eye — beyond that a bend is outside
   * reading distance, and the shader's falloff would zero it anyway. Same
   * frame-order rule as the lights and the fog: call after the camera update.
   * WHERE the field stands is `follow`'s, which every state owes.
   */
  update(
    dt: number,
    camPos: Vector3,
    lights: readonly PointLightData[],
    combatants: readonly Combatant[],
  ): void {
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

    // Insertion-select the nearest MAX_PUSHERS combatants (a sort would
    // allocate per frame for nothing).
    this.bestD2.fill(Infinity);
    const p = values.pushers;
    let pusherCount = 0;
    for (const c of combatants) {
      const dx = c.position.x - camPos.x;
      const dz = c.position.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= this.bestD2[MAX_PUSHERS - 1]) continue;
      let i = MAX_PUSHERS - 1;
      while (i > 0 && this.bestD2[i - 1] > d2) {
        this.bestD2[i] = this.bestD2[i - 1];
        p[i * 3] = p[(i - 1) * 3];
        p[i * 3 + 1] = p[(i - 1) * 3 + 1];
        p[i * 3 + 2] = p[(i - 1) * 3 + 2];
        i--;
      }
      this.bestD2[i] = d2;
      p[i * 3] = c.position.x;
      p[i * 3 + 1] = c.position.y;
      p[i * 3 + 2] = c.position.z;
      pusherCount = Math.min(pusherCount + 1, MAX_PUSHERS);
    }

    values.time[0] = this.time;
    values.pusherCount[0] = pusherCount;
    values.pointCount[0] = count;
  }

  /**
   * The patches in view this frame: each blade patch filed under the smallest
   * mesh that holds every blade the shader will keep in it, and each turf patch
   * under the mesh its distance calls for.
   *
   * **Pushed from `tick` in EVERY state, beside the water's `follow`**, and
   * for its reason: every state renders and only some of them simulate, so a
   * field chosen only in the camera tail is a deploy screen looking out over
   * whatever the last live frame could see — which on a fresh boot is nothing
   * at all. Nothing here advances the field's clock, so a held world stays
   * held. Not guarded on the position: the frustum turns with the view.
   *
   * **Distances are scaled by the SIGHT**: with a scope up the far field is on
   * screen at the size a near one was, so `lodScale` — the zoom — divides
   * every distance here and in the shader alike, and the field reaches further
   * while the sight is up. Capped at the map's fog end, past which nothing is
   * drawn at all.
   *
   * The walk is two-level: BLOCKs of patches are culled first, so the turf's
   * few-hundred-metre reach is a few hundred blocks rather than ten thousand
   * patches.
   */
  follow(camera: TargetCamera): void {
    const mask = this.mask;
    const blocks = this.blocks;
    const values = this.values;
    if (!mask || !blocks || !values) return;
    const g = CONFIG.grass;
    const P = g.patch;
    const tier = g.tiers[this.quality];
    const near = tier.near;
    const reach = tier.reach;
    const zoom = Math.tan(camera.fov / 2) / Math.tan(CONFIG.camera.fovHip / 2);
    const lodScale = Math.min(1, Math.max(0.05, zoom));
    const turfReach = Math.min(tier.turf, this.fogEnd);
    // The density below which the turf's ramp covers nothing even at the top
    // of its wobble: a patch no denser than this would draw only discards.
    const turfFloor = g.turf.from - g.turf.feather - g.turf.wobble / 2;
    // Past which neither a blade nor the turf is drawn, in unscaled metres.
    const radius = Math.min(Math.max(reach / lodScale, turfReach), this.fogEnd);

    // This frame's frustum, not last frame's: the grass runs after the camera
    // has moved, and a flick drawn off stale planes shows its edge. Each call
    // recomputes only if its camera moved since it was last asked.
    camera.getViewMatrix();
    camera.getProjectionMatrix();
    Frustum.GetPlanesToRef(camera.getTransformationMatrix(), this.planes);
    const planes = this.planes;

    const eye = camera.globalPosition;
    const ex = eye.x;
    const ey = eye.y;
    const ez = eye.z;
    const pt = mask.patches;
    const B = BLOCK * P;
    const b0x = Math.max(0, Math.floor((ex - radius - mask.x0) / B));
    const b1x = Math.min(blocks.nx - 1, Math.floor((ex + radius - mask.x0) / B));
    const b0z = Math.max(0, Math.floor((ez - radius - mask.z0) / B));
    const b1z = Math.min(blocks.nz - 1, Math.floor((ez + radius - mask.z0) / B));

    const lods = this.lods;
    const turfs = this.turfLods;
    for (const l of lods) l.count = 0;
    for (const l of turfs) l.count = 0;
    let blades = 0;
    // How far a tip can travel past its patch, and how tall a blade can stand.
    const sway = g.heightMax * MAX_HEIGHT_SCALE * 0.9;
    const bladeTop = g.heightMax * (1 + g.clump.amount);
    const at = this.walkAt;
    at.ex = ex;
    at.ey = ey;
    at.ez = ez;
    at.lodScale = lodScale;
    at.reach = turfReach;
    at.floor = turfFloor;
    at.bladeTop = bladeTop;
    this.walkId++;
    for (let bj = b0z; bj <= b1z; bj++) {
      const bz0 = mask.z0 + bj * B;
      for (let bi = b0x; bi <= b1x; bi++) {
        const bk = bj * blocks.nx + bi;
        if (blocks.cover[bk] <= 0) continue;
        const bx0 = mask.x0 + bi * B;
        const bLo = blocks.yLo[bk] - 1;
        const bHi = blocks.yHi[bk] + bladeTop * MAX_HEIGHT_SCALE + 1;
        if (boxDistance(ex, ey, ez, bx0, bLo, bz0, bx0 + B, bHi, bz0 + B) >= radius) continue;
        if (!inFrustum(planes, bx0 - sway, bLo, bz0 - sway, bx0 + B + sway, bHi, bz0 + B + sway)) continue;
        const i0 = bi * BLOCK;
        const j0 = bj * BLOCK;
        const i1 = Math.min(pt.nx, i0 + BLOCK);
        const j1 = Math.min(pt.nz, j0 + BLOCK);
        for (let j = j0; j < j1; j++) {
          const z0 = mask.z0 + j * P;
          for (let i = i0; i < i1; i++) {
            const k = j * pt.nx + i;
            const cover = pt.cover[k];
            if (cover <= 0) continue;
            const x0 = mask.x0 + i * P;
            const yLo = pt.yLo[k] - 0.1;
            const yHi = pt.yHi[k] + bladeTop * pt.tall[k] + 0.2;
            const dm = boxDistance(ex, ey, ez, x0, yLo, z0, x0 + P, yHi, z0 + P);
            if (dm >= radius) continue;
            if (!inFrustum(planes, x0 - sway, yLo, z0 - sway, x0 + P + sway, yHi, z0 + P + sway)) continue;
            const d = dm * lodScale;
            // The turf, out to its own reach, where the shader's ramp reaches.
            const t = this.turfRow(i, j);
            if (t >= 0) this.placeTurf(turfs[t], i, j, t, x0, z0, P);
            // The blades, out to theirs.
            if (d >= reach) continue;
            const need = this.keep(d, near, reach) * cover;
            if (need <= 0) continue;
            // The smallest mesh still holding every blade the shader keeps here.
            let pick = 0;
            while (pick + 1 < lods.length && lods[pick + 1].share >= need) pick++;
            const lod = lods[pick];
            this.place(lod, x0, z0, P, 0);
            blades += Math.ceil(lod.share * tier.density * P * P);
          }
        }
      }
    }
    let patches = 0;
    let turfPatches = 0;
    for (const l of lods) patches += l.count;
    for (const l of turfs) turfPatches += l.count;
    this.stats.patches = patches;
    this.stats.blades = blades;
    this.stats.turf = turfPatches;

    const fieldParams = values.fieldParams;
    fieldParams[0] = near;
    fieldParams[1] = reach;
    fieldParams[2] = g.thinFloor;
    fieldParams[3] = g.widenMax;
    values.lodScale[0] = lodScale;
    // The shaders measure from the same eye the patches were chosen from.
    const camPos = values.camPos;
    camPos[0] = ex;
    camPos[1] = ey;
    camPos[2] = ez;
  }

  /**
   * This frame draws, the field through the size gate (`Game.drawGrass`): the live
   * key, which `setEnvironment` alone writes (a lightning flash is a second light, read
   * off the frame, and moves no key), and the draw told.
   */
  commit(): void {
    const values = this.values;
    const key = this.key;
    if (!values || !key) return;
    key.dir.toArray(values.lightDir);
    key.color.toArray(values.lightColor);
    this.draw.commit();
  }

  /**
   * Appends one patch to a run: its side, its min corner and — read only by the
   * turf — its lift. Returns the offset it wrote at.
   */
  private place(lod: GrassRun, x0: number, z0: number, side: number, lift: number): number {
    if ((lod.count + 1) * PATCH_FLOATS > lod.patches.length) grow(lod);
    const m = lod.patches;
    const o = lod.count * PATCH_FLOATS;
    m[o] = side;
    m[o + 1] = lift;
    m[o + 2] = x0;
    m[o + 3] = z0;
    lod.count++;
    return o;
  }

  /**
   * Appends one turf patch at `TURF_LODS` row `t`, STITCHED to the patches
   * round it: each edge is drawn at the coarser of the two rows either side of
   * it and each corner lifted by the coarsest of the four patches meeting
   * there, packed as base-4 digits into the patch's second half — edges
   * W, E, S, N and corners SW, SE, NW, NE, where W is `i - 1` and S `j - 1`.
   * Both patches either side of a seam work the seam out from the same rows,
   * so both draw it through the same points. A neighbour with no turf of its
   * own (-1) stitches nothing.
   */
  private placeTurf(
    lod: GrassRun,
    i: number,
    j: number,
    t: number,
    x0: number,
    z0: number,
    side: number,
  ): void {
    const o = this.place(lod, x0, z0, side, TURF_LODS[t].lift);
    const w = Math.max(t, this.turfRow(i - 1, j));
    const e = Math.max(t, this.turfRow(i + 1, j));
    const s = Math.max(t, this.turfRow(i, j - 1));
    const n = Math.max(t, this.turfRow(i, j + 1));
    const sw = Math.max(w, s, this.turfRow(i - 1, j - 1));
    const se = Math.max(e, s, this.turfRow(i + 1, j - 1));
    const nw = Math.max(w, n, this.turfRow(i - 1, j + 1));
    const ne = Math.max(e, n, this.turfRow(i + 1, j + 1));
    const m = lod.patches;
    m[o + 4] = w + 4 * e + 16 * s + 64 * n;
    m[o + 5] = sw + 4 * se + 16 * nw + 64 * ne;
  }

  /**
   * The `TURF_LODS` row patch (i, j) draws its turf at this walk, or -1 where
   * it draws none — off the grid, too thin for the ramp to cover anything, or
   * past the turf's reach. The walk asks it of every patch it draws AND of
   * that patch's eight neighbours, which is why it is a pure function of the
   * patch and the eye rather than of what the walk happened to draw: a
   * neighbour culled by the frustum still has to be stitched to as the row it
   * WOULD be drawn at, or a seam half on screen opens. Cached per walk.
   */
  private turfRow(i: number, j: number): number {
    const mask = this.mask;
    if (!mask) return -1;
    const pt = mask.patches;
    if (i < 0 || j < 0 || i >= pt.nx || j >= pt.nz) return -1;
    const k = j * pt.nx + i;
    if (this.rowWalk[k] === this.walkId) return this.rowOf[k];
    const at = this.walkAt;
    const P = CONFIG.grass.patch;
    let row = -1;
    if (pt.cover[k] > at.floor) {
      const x0 = mask.x0 + i * P;
      const z0 = mask.z0 + j * P;
      const yLo = pt.yLo[k] - 0.1;
      const yHi = pt.yHi[k] + at.bladeTop * pt.tall[k] + 0.2;
      const dm = boxDistance(at.ex, at.ey, at.ez, x0, yLo, z0, x0 + P, yHi, z0 + P);
      if (dm < at.reach) {
        const d = dm * at.lodScale;
        row = 0;
        while (d >= TURF_LODS[row].within) row++;
      }
    }
    this.rowOf[k] = row;
    this.rowWalk[k] = this.walkId;
    return row;
  }

  dispose(): void {
    this.draw.clear();
    this.lods = [];
    this.turfLods = [];
    this.values = null;
    this.mask = null;
    this.blocks = null;
    this.sphere = null;
  }
}

/** Doubles a run's patches, keeping what is already written. */
function grow(lod: GrassRun): void {
  const next = new Float32Array(lod.patches.length * 2);
  next.set(lod.patches);
  lod.patches = next;
}

/**
 * The field's bounding sphere, off its box as a mesh's was: the patches are placed
 * by the walk, so nothing could be derived from them, and it is what the size gate
 * and the order of what still sorts against the blades read (`BoundingSphere.reConstruct`).
 */
function fieldSphere(mask: GrassMask): NonNullable<GrassSystem["sphere"]> {
  const g = CONFIG.grass;
  const x0 = mask.x0;
  const y0 = mask.yMin - 1;
  const z0 = mask.z0;
  const x1 = mask.x0 + mask.patches.nx * g.patch;
  const y1 = mask.yMax + g.heightMax * MAX_HEIGHT_SCALE + 1;
  const z1 = mask.z0 + mask.patches.nz * g.patch;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  return {
    x: (x1 + x0) * 0.5,
    y: (y1 + y0) * 0.5,
    z: (z1 + z0) * 0.5,
    radius: Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5,
  };
}

/** The mask's patches summarised per BLOCK, so the walk can skip a block whole. */
function summariseBlocks(mask: GrassMask): Blocks {
  const pt = mask.patches;
  const nx = Math.ceil(pt.nx / BLOCK);
  const nz = Math.ceil(pt.nz / BLOCK);
  const cover = new Float32Array(nx * nz);
  const yLo = new Float32Array(nx * nz).fill(Infinity);
  const yHi = new Float32Array(nx * nz).fill(-Infinity);
  for (let j = 0; j < pt.nz; j++) {
    for (let i = 0; i < pt.nx; i++) {
      const k = j * pt.nx + i;
      if (pt.cover[k] <= 0) continue;
      const b = Math.floor(j / BLOCK) * nx + Math.floor(i / BLOCK);
      cover[b] = Math.max(cover[b], pt.cover[k]);
      yLo[b] = Math.min(yLo[b], pt.yLo[k]);
      yHi[b] = Math.max(yHi[b], pt.yHi[k]);
    }
  }
  return { nx, nz, cover, yLo, yHi };
}

/** Distance from a point to the nearest point of an axis-aligned box. */
function boxDistance(
  x: number,
  y: number,
  z: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number {
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** An axis-aligned box against the frustum: out only if wholly behind a plane. */
function inFrustum(
  planes: Plane[],
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): boolean {
  for (let p = 0; p < 6; p++) {
    const n = planes[p].normal;
    const x = n.x >= 0 ? maxX : minX;
    const y = n.y >= 0 ? maxY : minY;
    const z = n.z >= 0 ? maxZ : minZ;
    if (n.x * x + n.y * y + n.z * z + planes[p].d < 0) return false;
  }
  return true;
}
