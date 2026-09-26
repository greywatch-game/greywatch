/**
 * GrassSystem.ts — The grass field: a mask baked per round from the map's
 * GrassRects, a handful of PATCH meshes of blade seeds and of turf, and per
 * frame the patches around the eye that are in view, each drawn from the
 * smallest mesh that still holds everything it wants — plus the uploads of
 * time, camera, point lights and pushers to the two field materials.
 * Invariants: grass is VISUAL ONLY — unpickable, non-colliding, never
 * metadata.solid, no glow; ray tests and bots must not see it. The CPU's
 * `keep` is the shader's `keepShare`, number for number: the mesh a patch is
 * drawn from is chosen off it, and a patch drawn from a mesh holding fewer
 * blades than the shader keeps is a patch with a hole in it. Every blade
 * patch mesh holds a PREFIX of one blade order, so a blade's place in the
 * patch is the same whichever mesh draws it. A patch mesh with no patches
 * this frame is made INVISIBLE, never merely emptied: Babylon draws a
 * thin-instanced mesh at a count of zero as one plain copy at its own origin.
 * `follow` is pushed from `tick` in every state; `update` is the camera tail
 * and runs after the camera and LightingSystem updates (shares the same 16
 * light slots) — same frame-order rule as WaterSystem.
 * Contract: `docs/rendering.md`.
 *
 * WHY A FIELD AROUND THE EYE. The field used to be every tuft on the map, one
 * thin instance each, drawn every frame from one bounding box over the whole
 * valley — so a map paid for its grass by AREA and every layout carried a
 * tuft budget spread as thin as its ground was wide. Now the blades are
 * placed on the GPU (`GrassShader`) and only the patches the eye can see are
 * drawn, dense near and thinning as `(near / d)^2` beyond, which is a
 * constant number of blades per unit of SCREEN. A hillside costs what can be
 * seen of it, and a map may state as much grass as it likes.
 */
import {
  BoundingInfo,
  Color3,
  Constants,
  Frustum,
  Matrix,
  Mesh,
  type Plane,
  RawTexture,
  Scene,
  type ShaderMaterial,
  Texture,
  type TargetCamera,
  Vector2,
  Vector3,
  Vector4,
  VertexData,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { GrassQuality } from "../core/settings";
import type { Combatant } from "../entities/Combatant";
import {
  MAX_POINT_LIGHTS,
  type CelMaterialFactory,
  type PointLightData,
} from "../shaders/CelShader";
import { createGrassMaterial, createTurfMaterial } from "../shaders/GrassShader";
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

/**
 * The turf's patch meshes: cells a side, the distance (already scaled by the
 * sight) inside which each is used, how far it is lifted off the ground it
 * samples, and how far its skirt hangs.
 *
 * The lift is what a coarse sheet owes the floor it lies on: the terrain is
 * flat triangles three to six metres across and the turf samples it only at
 * its own vertices, so a cell that spans a fold in the ground cuts under it by
 * up to half the fold. A metre cell spans almost none and lies on the floor
 * to the millimetre; four metres at eighty metres out is lifted a hand's
 * width, which nobody standing that far away can see. The SKIRT closes the
 * seam where a fine patch meets a coarse one — the two edges sample the ground
 * at different points, and without it the floor shows through the crack.
 */
const TURF_LODS = [
  { cells: 8, within: 24, lift: 0.006, skirt: 0.2 },
  { cells: 4, within: 80, lift: 0.04, skirt: 0.4 },
  { cells: 2, within: Infinity, lift: 0.12, skirt: 0.9 },
] as const;

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
 * One turf patch mesh: an `n` x `n` grid over the unit square, and a skirt
 * hung from its four edges. `position` is (u, skirt, v); the shader puts it on
 * the ground and hangs the skirt vertices below it.
 */
function turfVertexData(n: number): VertexData {
  const positions: number[] = [];
  const indices: number[] = [];
  const at = (i: number, j: number): number => j * (n + 1) + i;
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
  // The skirt: the perimeter walked once, each edge vertex dropped below itself.
  const ring: number[] = [];
  for (let i = 0; i < n; i++) ring.push(at(i, 0));
  for (let j = 0; j < n; j++) ring.push(at(n, j));
  for (let i = n; i > 0; i--) ring.push(at(i, n));
  for (let j = n; j > 0; j--) ring.push(at(0, j));
  const first = positions.length / 3;
  for (const k of ring) positions.push(positions[k * 3], 1, positions[k * 3 + 2]);
  for (let r = 0; r < ring.length; r++) {
    const a = ring[r];
    const b = ring[(r + 1) % ring.length];
    const a2 = first + r;
    const b2 = first + ((r + 1) % ring.length);
    indices.push(a, b, a2, b, b2, a2);
  }
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  return data;
}

/** A smoothstep, the shader's, for `keep`. */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** One patch mesh and the instance buffer it draws from this frame. */
interface PatchLod {
  mesh: Mesh;
  /** Blades it holds, as a share of the full patch (1 for the turf). */
  share: number;
  matrices: Float32Array;
  count: number;
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
 * quality rung, and per frame chooses the patches in view and uploads time,
 * camera, the winning point-light set and the nearest combatants as pushers.
 *
 * The field is drawn and never tested: unpickable, non-colliding, no `solid`
 * metadata — every ray (hitscan, LOS, ground probes) passes through it, and
 * bots neither path around nor trip over it.
 */
export class GrassSystem {
  private lods: PatchLod[] = [];
  private turfLods: PatchLod[] = [];
  private mat: ShaderMaterial | null = null;
  private turfMat: ShaderMaterial | null = null;
  private tex: RawTexture | null = null;
  private mask: GrassMask | null = null;
  private blocks: Blocks | null = null;
  private quality: GrassQuality = "high";
  /** The map's fog end: nothing past it is worth drawing. */
  private fogEnd = Infinity;
  private time = 0;

  // Packed uniforms and scratch, reused every frame to avoid allocation.
  private pointPos = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointColor = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointRange = new Float32Array(MAX_POINT_LIGHTS);
  private pushers = new Float32Array(MAX_PUSHERS * 3);
  private bestD2 = new Float32Array(MAX_PUSHERS);
  private planes: Plane[] = Frustum.GetPlanes(Matrix.Identity());
  private fieldParams = new Vector4();
  private camScratch = new Vector3();
  /** What the field drew last frame, for anyone measuring it. */
  readonly stats = { patches: 0, blades: 0, turf: 0 };

  constructor(
    private scene: Scene,
    private mats: CelMaterialFactory,
  ) {}

  /**
   * Rebuilds the field for a round. No-ops to a bald map when the layout has
   * no grass rects or the environment has no grass palette. `boxes` are the
   * map's colliders and `roads` its carriageways: grass is ROOTED, and grows
   * in neither; under `water` it grows as reeds (see `bakeGrassMask`).
   */
  build(
    rects: readonly GrassRect[],
    water: readonly WaterRect[],
    env: EnvironmentSpec,
    boxes: readonly WorldBox[],
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

    const mask = bakeGrassMask(rects, water, boxes, roads, terrain, size / 2 + margin);
    if (!mask) return;
    this.mask = mask;
    this.blocks = summariseBlocks(mask);

    // invertY false: row 0 is the min-Z edge, which is what the shader's
    // `(xz - origin) / texel` puts at row 0. Every read is a textureLoad, but a
    // declared sampler must still be bound, so the texture carries one.
    const tex = RawTexture.CreateRGBATexture(
      mask.data,
      mask.nx,
      mask.nz,
      this.scene,
      false,
      false,
      Texture.NEAREST_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    );
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.tex = tex;

    const lit = env.lighting;
    // The factory's LIVE key, by reference, so a lightning flash lights the
    // field in the same frame it lights the ground under it.
    const key = this.mats.keyLight;
    const mat = createGrassMaterial(this.scene, "grass");
    const turf = createTurfMaterial(this.scene, "grassTurf");
    for (const m of [mat, turf]) {
      m.setVector3("lightDir", key.dir);
      m.setColor3("lightColor", key.color);
      m.setFloat("keyWrap", lit.keyWrap ?? 0);
      m.setColor3(
        "ambientColor",
        Color3.FromHexString(lit.ambientColor).scale(lit.ambientIntensity),
      );
      m.setColor3("fogColor", Color3.FromHexString(env.fogColor));
      m.setVector2("fogParams", new Vector2(env.fogStart, env.fogEnd));
      m.setColor3("mistColor", Color3.FromHexString(env.mistColor));
      m.setVector2("mistParams", new Vector2(env.mistHeight, env.mistStrength));
      m.setColor3("rootColor", Color3.FromHexString(env.grass.rootColor));
      m.setColor3("tipColor", Color3.FromHexString(env.grass.tipColor));
      m.setTexture("maskTex", tex);
      m.setVector4("maskOrigin", new Vector4(mask.x0, mask.z0, mask.texel, 0));
      m.setVector2("maskSize", new Vector2(mask.nx, mask.nz));
      m.setVector2("maskHeight", new Vector2(mask.yMin, mask.yMax));
      // The depth map, its matrix and its params come from the factory, which
      // is the one publisher of all three. Unregistered, the shader would
      // sample an unbound sampler and the field would stand in permanent shadow.
      this.mats.registerShadowConsumer(m);
    }
    mat.setColor3("rimColor", Color3.FromHexString(lit.rimColor).scale(lit.rimIntensity));
    this.mat = mat;
    this.turfMat = turf;

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
    if (this.mat) this.buildLods();
  }

  /** The bounds WorldCulling's size gate reads: the whole field. */
  private fieldBounds(): BoundingInfo {
    const mask = this.mask!;
    const g = CONFIG.grass;
    // The patches are placed by instance matrices over a unit square, so
    // nothing Babylon could derive would be the field's extent, and the
    // frustum test is this system's own (`alwaysSelectAsActiveMesh`).
    return new BoundingInfo(
      new Vector3(mask.x0, mask.yMin - 1, mask.z0),
      new Vector3(
        mask.x0 + mask.patches.nx * g.patch,
        mask.yMax + g.heightMax * MAX_HEIGHT_SCALE + 1,
        mask.z0 + mask.patches.nz * g.patch,
      ),
    );
  }

  /** A patch mesh wearing `mat`, set up the way every one of them must be. */
  private patchMesh(name: string, mat: ShaderMaterial): PatchLod {
    const mesh = new Mesh(name, this.scene);
    // Big enough that a round rarely outgrows it; see `grow` for what that costs.
    const matrices = new Float32Array(16 * 512);
    // The bounds are the FIELD's, set once — Babylon would otherwise rebuild
    // them from the patch matrices on every buffer it is handed.
    mesh.doNotSyncBoundingInfo = true;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.metadata = { noGlow: true, noShadowCaster: true };
    mesh.material = mat;
    return { mesh, share: 1, matrices, count: 0 };
  }

  /** Hands a filled patch mesh its instance buffer, bounds and frozen matrix. */
  private finishPatch(lod: PatchLod, bounds: BoundingInfo): void {
    lod.mesh.thinInstanceSetBuffer("matrix", lod.matrices, 16, false);
    lod.mesh.thinInstanceCount = 0;
    lod.mesh.isVisible = false;
    lod.mesh.setBoundingInfo(bounds);
    lod.mesh.freezeWorldMatrix();
  }

  /**
   * The blade patch meshes for the current rung: the full patch and every
   * `LOD_STEP` of it down to `MIN_LOD_BLADES`, each a prefix of the same order.
   */
  private buildLods(): void {
    for (const l of this.lods) l.mesh.dispose();
    this.lods = [];
    const mat = this.mat;
    if (!this.mask || !mat) return;
    const g = CONFIG.grass;
    const tier = g.tiers[this.quality];
    const total = Math.max(MIN_LOD_BLADES, Math.round(tier.density * g.patch * g.patch));
    // Seeded, so every client grows the same field — and seeded apart from the
    // mask, which is not random at all.
    const rng = mulberry32(0x6a55);
    const roots = bladeOrder(total, rng);
    const seeds = new Float32Array(total * 2);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rng();
    const bounds = this.fieldBounds();

    for (let share = 1; ; share *= LOD_STEP) {
      const count = Math.ceil(total * share);
      if (count < MIN_LOD_BLADES && share < 1) break;
      const vd = bladeVertexData(roots, seeds, count, total, share <= SIMPLE_SHARE);
      const lod = this.patchMesh(`grass${this.lods.length}`, mat);
      const data = new VertexData();
      data.positions = vd.positions;
      data.indices = vd.indices;
      data.applyToMesh(lod.mesh);
      lod.mesh.setVerticesData("blade", vd.blade, false, 4);
      lod.share = share;
      this.finishPatch(lod, bounds);
      this.lods.push(lod);
    }
  }

  /** The turf patch meshes, one per row of `TURF_LODS`. */
  private buildTurf(): void {
    const mat = this.turfMat;
    if (!this.mask || !mat) return;
    const bounds = this.fieldBounds();
    for (const row of TURF_LODS) {
      const lod = this.patchMesh(`grassTurf${row.cells}`, mat);
      turfVertexData(row.cells).applyToMesh(lod.mesh);
      this.finishPatch(lod, bounds);
      this.turfLods.push(lod);
    }
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
    const mat = this.mat;
    const turf = this.turfMat;
    if (!mat || !turf) return;
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

    // Insertion-select the nearest MAX_PUSHERS combatants (a sort would
    // allocate per frame for nothing).
    this.bestD2.fill(Infinity);
    const p = this.pushers;
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

    mat.setFloat("time", this.time);
    mat.setArray3("pushers", p as unknown as number[]);
    mat.setFloat("pusherCount", pusherCount);
    for (const m of [mat, turf]) {
      m.setArray3("pointPos", this.pointPos as unknown as number[]);
      m.setArray3("pointColor", this.pointColor as unknown as number[]);
      m.setFloats("pointRange", this.pointRange as unknown as number[]);
      m.setFloat("pointCount", count);
    }
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
    const mat = this.mat;
    const turf = this.turfMat;
    if (!mask || !blocks || !mat || !turf) return;
    const g = CONFIG.grass;
    const P = g.patch;
    const tier = g.tiers[this.quality];
    const near = tier.near;
    const reach = tier.reach;
    const zoom = Math.tan(camera.fov / 2) / Math.tan(CONFIG.camera.fovHip / 2);
    const lodScale = Math.min(1, Math.max(0.05, zoom));
    const turfReach = Math.min(tier.turf, this.fogEnd);
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
            // The turf, out to its own reach.
            if (dm < turfReach) {
              let t = 0;
              while (d >= TURF_LODS[t].within) t++;
              const lod = turfs[t];
              this.place(lod, x0, z0, P, TURF_LODS[t].lift, TURF_LODS[t].skirt);
            }
            // The blades, out to theirs.
            if (d >= reach) continue;
            const need = this.keep(d, near, reach) * cover;
            if (need <= 0) continue;
            // The smallest mesh still holding every blade the shader keeps here.
            let pick = 0;
            while (pick + 1 < lods.length && lods[pick + 1].share >= need) pick++;
            const lod = lods[pick];
            this.place(lod, x0, z0, P, 0, 1);
            blades += Math.ceil(lod.share * tier.density * P * P);
          }
        }
      }
    }
    let patches = 0;
    let turfPatches = 0;
    for (const l of lods) patches += this.publish(l);
    for (const l of turfs) turfPatches += this.publish(l);
    this.stats.patches = patches;
    this.stats.blades = blades;
    this.stats.turf = turfPatches;

    this.fieldParams.set(near, reach, g.thinFloor, g.widenMax);
    // The shaders measure from the same eye the patches were chosen from.
    this.camScratch.copyFrom(eye);
    for (const m of [mat, turf]) {
      m.setVector4("fieldParams", this.fieldParams);
      m.setFloat("lodScale", lodScale);
      m.setVector3("camPos", this.camScratch);
    }
  }

  /**
   * Appends one patch to a mesh's instance list: X scale the side, the
   * translation its min corner, and — read only by the turf — Y translation
   * its lift and Y scale its skirt's drop.
   */
  private place(lod: PatchLod, x0: number, z0: number, side: number, lift: number, drop: number): void {
    if ((lod.count + 1) * 16 > lod.matrices.length) this.grow(lod);
    const m = lod.matrices;
    const o = lod.count * 16;
    m[o] = side;
    m[o + 5] = drop;
    m[o + 10] = side;
    m[o + 12] = x0;
    m[o + 13] = lift;
    m[o + 14] = z0;
    m[o + 15] = 1;
    lod.count++;
  }

  /** Hands a mesh this frame's count; hides it outright when that is zero. */
  private publish(l: PatchLod): number {
    l.mesh.thinInstanceCount = l.count;
    l.mesh.isVisible = l.count > 0;
    if (l.count > 0) l.mesh.thinInstanceBufferUpdated("matrix");
    return l.count;
  }

  /**
   * Doubles a mesh's instance buffer, keeping what is already written.
   *
   * **The draw cache is reset with it, and that is not optional.** Handing a
   * mesh a new buffer DESTROYS the old one, and under `compatibilityMode =
   * false` the mesh's cached draw still names the old buffer: every frame after
   * is a submit of a destroyed buffer, which WebGPU refuses whole — the entire
   * frame, not just the grass, comes out black.
   */
  private grow(lod: PatchLod): void {
    const next = new Float32Array(lod.matrices.length * 2);
    next.set(lod.matrices);
    lod.matrices = next;
    // Only the live count is ever drawn or uploaded.
    lod.mesh.thinInstanceSetBuffer("matrix", next, 16, false);
    lod.mesh.resetDrawCache();
  }

  dispose(): void {
    // Before the dispose, not after: the factory would otherwise keep writing
    // three uniforms a frame into a dead material for the rest of the session.
    if (this.mat) this.mats.unregisterShadowConsumer(this.mat);
    if (this.turfMat) this.mats.unregisterShadowConsumer(this.turfMat);
    for (const l of this.lods) l.mesh.dispose();
    for (const l of this.turfLods) l.mesh.dispose();
    this.lods = [];
    this.turfLods = [];
    this.mat?.dispose();
    this.turfMat?.dispose();
    this.tex?.dispose();
    this.mat = null;
    this.turfMat = null;
    this.tex = null;
    this.mask = null;
    this.blocks = null;
  }
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
