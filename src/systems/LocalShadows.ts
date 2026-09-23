/**
 * LocalShadows.ts — shadows from the POINT and SPOT lights: one depth atlas,
 * which lights get tiles in it, and the passes that fill them.
 * Owns the atlas render target, its tile allocation, the static cache per
 * fixture, the proxy mesh every moving shadow is drawn as, and the per-slot
 * cone/tile arrays the shaders read (written into `CelMaterialFactory`'s own
 * arrays, which every `celShadow` consumer holds by reference). Owns no light
 * — `LightingSystem` decides which lights exist and which won a slot, and this
 * decides only which of THOSE cast.
 * Invariants:
 * - A tile holds the RADIAL distance to the nearest caster over the light's
 *   range, from BACK faces (the moon map's rule, for its reason), and
 *   `celShadow`'s `localLayer` is the reader. The face order (+X -X +Y -Y +Z
 *   -Z) and each face's frame (`faceFrame`) are stated twice, here and there,
 *   and must agree.
 * - A slot's layers are published to the shader only once they are drawn: a
 *   static layer after every face has been baked, a dynamic one after its
 *   first pass. Until then the slot keeps the volume's visibility.
 * - Nothing here draws into the frame. The proxy and the clear sheet carry
 *   `LAYER`, which no camera sees, and are drawn by explicit lists only.
 * - Every pass renders INTO the atlas without clearing it — a static tile
 *   survives the frames it is not redrawn on — so every tile a pass writes is
 *   cleared first, by the clear sheet, in a pass of its own.
 * Contract: `docs/rendering.md`.
 *
 * ## WHY ONE ATLAS
 *
 * The cel shader binds fourteen textures against WebGPU's default sixteen, so a
 * map per light was never available: every shadowed lamp in the frame has to
 * be reachable through ONE binding. A cube face is a square tile, a spot is
 * one more, and the lookup picks the tile off the slot's base and the face
 * the receiver is on.
 *
 * ## SPLIT BY REFRESH RATE
 *
 * The moon's shadows are two maps because the world is static and the bodies
 * are not, and a lamp's are split the same way. A FIXTURE's world geometry is
 * drawn once into a STATIC tile and kept for as long as the light holds its
 * tiles; the bodies and hulls within its reach go into a DYNAMIC tile redrawn
 * every frame, and the shader takes the `min`. A light that MOVES has nothing
 * static to keep, so the whole of it — the collider boxes it can see as well
 * as the bodies — is dynamic, and it is affordable because a moving light's
 * casters are PROXIES: thin instances of one unit box. Every dynamic tile in
 * the frame is ONE draw call, whatever it holds.
 *
 * A fixture's static tile is the REAL geometry (on the rungs with `meshes`),
 * and it can be because it is drawn once: a block-merged face is a handful of
 * draws, spent over `staticFacesPerFrame` faces a frame so walking into a lit
 * street is a queue rather than a hitch. On the phone rung it is proxies too.
 *
 * ## ONE PASS, MANY TILES
 *
 * A render target draws its list once per pass, through one projection, and a
 * cube is six. So the projection is not Babylon's: the vertex stage computes
 * the face's own perspective and then SCALES AND OFFSETS clip space into that
 * face's tile of the atlas — an affine map, so it commutes with the divide —
 * and the fragment stage discards whatever fell outside the face's frustum,
 * which is the clipping the hardware can no longer do per tile. A proxy's
 * instance names its tile, so one draw covers every face of every moving
 * light. A mesh cannot carry an instance attribute, so a static bake is a pass
 * per face with the tile as a uniform — one material per face in flight, so
 * no uniform buffer is rewritten between two passes of the same frame.
 */
import {
  type AbstractMesh,
  Color4,
  Constants,
  Mesh,
  type Observer,
  MeshBuilder,
  Matrix,
  Quaternion,
  RenderTargetTexture,
  type Scene,
  ShaderLanguage,
  ShaderMaterial,
  ShaderStore,
  Vector3,
  Vector4,
  VertexData,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { ProxyBoxes, type ShadowBody, type ShadowHull } from "../core/proxyBoxes";
import type { ShadowQuality } from "../core/settings";
import { litShadowTexture } from "../core/shadowWindow";
import {
  type CelMaterialFactory,
  MAX_POINT_LIGHTS,
  type PointLightData,
} from "../shaders/CelShader";
import { BOX_BUCKET, buildBoxIndex, type BoxIndex } from "../world/boxIndex";
import type { WorldBox } from "../world/MapBuilder";

/**
 * The layer the proxy and the clear sheet wear: at or above `0x10000000` no
 * camera draws it, and an explicit render list does not check. `BodyShadows`'
 * header states the mechanism.
 */
const LAYER = 0x10000000;

/**
 * The most tiles any rung's atlas holds. It sizes two uniform arrays, so it is
 * a compile-time literal; the constructor checks every rung fits.
 */
const MAX_TILES = 64;

/** The cube's faces, in the order `celShadow`'s `localLayer` numbers them. */
const CUBE: readonly Vector3[] = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

/**
 * A face's right and up off its forward — `celShadow`'s `localUp` rule:
 * built on world up, unless the face looks straight up or down.
 */
function faceFrame(f: Vector3, right: Vector3, up: Vector3): void {
  const u = Math.abs(f.y) > 0.99 ? Vector3.Forward() : Vector3.Up();
  Vector3.CrossToRef(u, f, right);
  right.normalize();
  Vector3.CrossToRef(f, right, up);
}

ShaderStore.ShadersStoreWGSL["localShadowDepthVertexShader"] = `
attribute position: vec3f;
#include<celInstancesDeclaration>
#ifdef PROXY
// The tile this instance is drawn into — which also names its face record.
attribute tileId: f32;
#else
uniform faceTile: f32;
#endif

// Four vec4s per TILE: (light, range), (forward, tan of half the field),
// (right, tile index), (up, near plane).
uniform faces: array<vec4f, ${MAX_TILES * 4}>;
// x = tiles per atlas row, y = one tile's side in UV
uniform atlasShape: vec4f;

varying vFace: vec3f;
varying vPosW: vec3f;
varying vLight: vec4f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  #include<celInstancesVertex>
  let wp = finalWorld * vec4f(vertexInputs.position, 1.0);
  #ifdef PROXY
  let k = i32(vertexInputs.tileId + 0.5) * 4;
  #else
  let k = i32(uniforms.faceTile + 0.5) * 4;
  #endif
  let l = uniforms.faces[k];
  let f = uniforms.faces[k + 1];
  let r = uniforms.faces[k + 2];
  let u = uniforms.faces[k + 3];
  let d = wp.xyz - l.xyz;
  // The face's own perspective: x and y over w are the face coordinates, and
  // the depth runs 0..1 from the near plane to the light's range.
  let x = dot(d, r.xyz) / f.w;
  let y = dot(d, u.xyz) / f.w;
  let w = dot(d, f.xyz);
  let z = (w - u.w) * l.w / (l.w - u.w);
  // Scaled and offset into the tile: clip = (origin * 2 - 1 + side) * w +
  // face * side, which is the tile's UV rectangle read as clip space.
  let row = floor(r.w / uniforms.atlasShape.x);
  let col = r.w - row * uniforms.atlasShape.x;
  let side = uniforms.atlasShape.y;
  let o = vec2f(col, row) * side;
  vertexOutputs.position = vec4f(
    (o.x * 2.0 - 1.0 + side) * w + x * side,
    (o.y * 2.0 - 1.0 + side) * w + y * side,
    z,
    w);
  vertexOutputs.vFace = vec3f(x, y, w);
  vertexOutputs.vPosW = wp.xyz;
  vertexOutputs.vLight = l;
}
`;

ShaderStore.ShadersStoreWGSL["localShadowDepthFragmentShader"] = `
varying vFace: vec3f;
varying vPosW: vec3f;
varying vLight: vec4f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  // Outside this face's frustum is another face's tile: the per-tile clip the
  // hardware cannot do once six faces share one render target.
  let f = fragmentInputs.vFace;
  if (abs(f.x) > f.z || abs(f.y) > f.z) {
    discard;
  }
  let dist = length(fragmentInputs.vPosW - fragmentInputs.vLight.xyz);
  fragmentOutputs.color = vec4f(dist / fragmentInputs.vLight.w, 0.0, 0.0, 1.0);
}
`;

ShaderStore.ShadersStoreWGSL["localShadowClearVertexShader"] = `
// xy is the tile's corner in clip space, z the tile's index.
attribute position: vec3f;
// One flag per tile, four to a vec4: 1 clears it this pass.
uniform clearFlags: array<vec4f, ${MAX_TILES / 4}>;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let t = i32(vertexInputs.position.z + 0.5);
  let on = uniforms.clearFlags[t / 4][t % 4] > 0.5;
  // A tile not being cleared collapses to a point outside the target.
  vertexOutputs.position = select(
    vec4f(2.0, 2.0, 0.5, 1.0),
    vec4f(vertexInputs.position.xy, 1.0, 1.0),
    on);
}
`;

ShaderStore.ShadersStoreWGSL["localShadowClearFragmentShader"] = `
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  // The far end of the range: nothing in the way.
  fragmentOutputs.color = vec4f(1.0, 1.0, 1.0, 1.0);
}
`;

/** One candidate in `choose`'s ranking. */
interface Ranked {
  e: PointLightData;
  score: number;
  moving: boolean;
}

function byRankScore(a: Ranked, b: Ranked): number {
  return a.score - b.score;
}

/** One light holding tiles. Keyed by the light object's identity. */
interface Entry {
  light: PointLightData;
  /** All of it redrawn every frame from proxies; else a baked fixture. */
  moving: boolean;
  /** 6 for a point light, 1 for a spot. */
  faces: number;
  staticBase: number;
  dynBase: number;
  /** Static faces baked so far; the layer is published at `faces`. */
  baked: number;
  /** Whether the dynamic layer has been drawn at least once. */
  dynDrawn: boolean;
  /** Where the static layer and the face records were taken. */
  at: Vector3;
  range: number;
  axis: Vector3;
  cosOuter: number;
  /** Collider boxes gathered for a moving light, and where. */
  boxes: number[];
  gatheredAt: Vector3;
  gatheredRange: number;
  /** The last frame this light had a body in reach — its dynamic tile's lease. */
  bodiesSeen: number;
}

export class LocalShadows {
  private atlas: RenderTargetTexture | null = null;
  private tier: (typeof CONFIG.graphics.localShadows.tiers)[ShadowQuality] =
    CONFIG.graphics.localShadows.tiers.off;
  private tilesPerRow = 0;
  private tileCount = 0;
  /** Which entry owns each tile, or null. */
  private owner: (Entry | null)[] = [];
  private readonly entries = new Map<PointLightData, Entry>();
  private frame = 0;
  /** A full clear owed on the next pass — a new atlas holds garbage. */
  private fullClear = false;

  /** The face records, `MAX_TILES * 16` floats, shared by every depth material. */
  private readonly faces = new Float32Array(MAX_TILES * 16);
  private readonly clearFlags = new Float32Array(MAX_TILES);
  private readonly atlasShape = new Vector4(1, 1, 0, 0);

  private readonly proxy: Mesh;
  private readonly proxyMat: ShaderMaterial;
  private readonly proxyMatrices: Float32Array;
  private readonly proxyTiles: Float32Array;
  private proxyCount = 0;
  private clearSheet: Mesh | null = null;
  private readonly clearMat: ShaderMaterial;
  /** One per static face in flight this frame. See the header. */
  private readonly bakeMats: ShaderMaterial[] = [];

  /** The collider boxes a moving light can see, and each as a matrix. */
  private boxes: readonly WorldBox[] = [];
  private boxMatrices = new Float32Array(0);
  /** Each box's world AABB: centre xyz, half-extent xyz. */
  private boxBounds = new Float32Array(0);
  private index: BoxIndex | null = null;
  private readonly boxStamp: number[] = [];
  private stamp = 0;
  /** The map's visual meshes — what a fixture's static tile is baked from. */
  private visuals: readonly AbstractMesh[] = [];

  private readonly bodyBoxes = new ProxyBoxes();
  /** This frame's body matrices, packed once and copied per face. */
  private readonly bodyMatrices: Float32Array;
  private readonly bodyAt: Vector3[] = [];
  /** Nearest-a-light selection scratch, reused frame to frame. See `packBodies`. */
  private readonly pickedBodies: (ShadowBody | null)[] = [];
  private readonly pickedGap: number[] = [];
  /** Boxes in each packed slot: a soldier's bones, or a hull's one. */
  private readonly bodyBoxCount: number[] = [];
  private bodyCount = 0;

  /** This frame's work, built in `update` and drawn in `render`. */
  private bakeQueue: { entry: Entry; face: number }[] = [];
  private bakeLists: AbstractMesh[][] = [];
  private drawDynamic = false;
  private readonly proxyList: AbstractMesh[] = [];
  private readonly clearList: AbstractMesh[] = [];
  private list: AbstractMesh[] = [];

  private readonly scratchR = new Vector3();
  private readonly scratchU = new Vector3();

  /** `render`'s hook on the scene, for `dispose`. */
  private readonly renderObserver: Observer<Scene>;

  constructor(
    private readonly scene: Scene,
    private readonly mats: CelMaterialFactory,
    quality: ShadowQuality,
  ) {
    const c = CONFIG.graphics.localShadows;
    for (const t of Object.values(c.tiers)) {
      if (t.atlas > 0 && (t.atlas / t.tile) ** 2 > MAX_TILES) {
        throw new Error(`LocalShadows: a ${t.atlas}/${t.tile} atlas is past ${MAX_TILES} tiles`);
      }
    }

    this.proxy = MeshBuilder.CreateBox("localShadowProxy", { size: 1 }, scene);
    this.proxy.layerMask = LAYER;
    this.proxy.isPickable = false;
    this.proxy.metadata = { noInk: true, noGlow: true, noShadowCaster: true };
    this.proxy.alwaysSelectAsActiveMesh = true;
    this.proxyMatrices = new Float32Array(c.maxProxies * 16);
    this.proxyTiles = new Float32Array(c.maxProxies);
    this.proxy.thinInstanceSetBuffer("matrix", this.proxyMatrices, 16, false);
    this.proxy.thinInstanceSetBuffer("tileId", this.proxyTiles, 1, false);
    this.proxy.thinInstanceCount = 0;
    this.proxyMat = this.depthMaterial("localShadowProxy", true);
    this.proxyList.push(this.proxy);

    this.clearMat = new ShaderMaterial(
      "localShadowClear",
      scene,
      { vertex: "localShadowClear", fragment: "localShadowClear" },
      {
        attributes: ["position"],
        uniforms: ["clearFlags"],
        shaderLanguage: ShaderLanguage.WGSL,
      },
    );
    this.clearMat.backFaceCulling = false;
    this.clearMat.depthFunction = Constants.ALWAYS;
    this.clearMat.setArray4("clearFlags", this.clearFlags as unknown as number[]);

    for (let i = 0; i < c.staticFacesPerFrame; i++) {
      this.bakeMats.push(this.depthMaterial(`localShadowBake${i}`, false));
      this.bakeLists.push([]);
    }

    const bodies = CONFIG.graphics.bodyShadows.maxBodies + CONFIG.graphics.bodyShadows.maxHulls;
    this.bodyMatrices = new Float32Array(bodies * this.bodyBoxes.perBody * 16);

    // Drawn inside the scene's render, before its own targets: nothing is
    // bound yet, and the main pass that samples the atlas comes after.
    this.renderObserver = scene.onBeforeRenderTargetsRenderObservable.add(() =>
      this.render(),
    );

    this.setQuality(quality);
  }

  /** One depth material: the proxy's (instanced, tile per instance) or a bake's. */
  private depthMaterial(name: string, proxy: boolean): ShaderMaterial {
    const mat = new ShaderMaterial(
      name,
      this.scene,
      { vertex: "localShadowDepth", fragment: "localShadowDepth" },
      {
        attributes: proxy ? ["position", "tileId"] : ["position"],
        uniforms: proxy
          ? ["world", "faces", "atlasShape"]
          : ["world", "faces", "atlasShape", "faceTile"],
        defines: proxy ? ["#define PROXY"] : [],
        shaderLanguage: ShaderLanguage.WGSL,
      },
    );
    // BACK faces, for the moon map's reason: a lit face is compared against
    // the far side of its own wall, so the bias is centimetres and no lit
    // surface is its own occluder. `cullBackFaces = false` culls the FRONT.
    mat.backFaceCulling = true;
    mat.cullBackFaces = false;
    mat.setArray4("faces", this.faces as unknown as number[]);
    mat.setVector4("atlasShape", this.atlasShape);
    mat.setFloat("faceTile", 0);
    return mat;
  }

  /**
   * Stands the atlas up at a rung's size, or takes it down. Every light loses
   * its tiles, because a tile's index means a different rectangle at a
   * different size.
   */
  setQuality(quality: ShadowQuality): void {
    const tier = CONFIG.graphics.localShadows.tiers[quality];
    const same =
      tier.atlas === this.tier.atlas && tier.tile === this.tier.tile && this.atlas !== null;
    this.tier = tier;
    if (same) return;
    this.releaseAll();
    this.atlas?.dispose();
    this.atlas = null;
    this.clearSheet?.dispose();
    this.clearSheet = null;
    this.tilesPerRow = 0;
    this.tileCount = 0;
    this.owner = [];
    if (tier.atlas > 0) {
      this.tilesPerRow = Math.floor(tier.atlas / tier.tile);
      this.tileCount = this.tilesPerRow * this.tilesPerRow;
      this.owner = new Array(this.tileCount).fill(null);
      this.atlas = this.buildAtlas(tier.atlas);
      this.clearSheet = this.buildClearSheet();
      this.fullClear = true;
    }
    const side = 1 / Math.max(1, this.tilesPerRow);
    this.atlasShape.set(Math.max(1, this.tilesPerRow), side, 0, 0);
    const slots = this.mats.localSlots;
    slots.atlas.set(
      Math.max(1, this.tilesPerRow),
      side,
      1 / Math.max(1, tier.atlas),
      tier.taps,
    );
    const c = CONFIG.graphics.localShadows;
    slots.params.set(c.bias, c.normalBias, 0, 0);
    this.mats.setLocalShadowMap(this.atlas ?? litShadowTexture(this.scene));
    this.publish([]);
  }

  private buildAtlas(size: number): RenderTargetTexture {
    const rtt = new RenderTargetTexture(
      "localShadowAtlas",
      { width: size, height: size },
      this.scene,
      {
        generateMipMaps: false,
        type: Constants.TEXTURETYPE_HALF_FLOAT,
        format: Constants.TEXTUREFORMAT_R,
        samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
        generateDepthBuffer: true,
        generateStencilBuffer: false,
      },
    );
    rtt.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    rtt.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    rtt.renderParticles = false;
    rtt.renderSprites = false;
    rtt.renderList = [];
    rtt.getCustomRenderList = () => this.list;
    // NEVER cleared by Babylon: a static tile has to survive the passes that
    // do not redraw it. The one full clear is a new target's, which holds
    // whatever the allocator left in it.
    rtt.onClearObservable.add((engine) => {
      if (!this.fullClear) return;
      this.fullClear = false;
      engine.clear(new Color4(1, 1, 1, 1), true, true, false);
    });
    this.proxy.layerMask = LAYER;
    rtt.setMaterialForRendering(this.proxy, this.proxyMat);
    return rtt;
  }

  /** One quad per tile, in clip space, its index in z. See the clear shader. */
  private buildClearSheet(): Mesh {
    const n = this.tilesPerRow;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let t = 0; t < this.tileCount; t++) {
      const row = Math.floor(t / n);
      const col = t - row * n;
      const x0 = (col / n) * 2 - 1;
      const x1 = ((col + 1) / n) * 2 - 1;
      const y0 = (row / n) * 2 - 1;
      const y1 = ((row + 1) / n) * 2 - 1;
      const b = t * 4;
      positions.push(x0, y0, t, x1, y0, t, x1, y1, t, x0, y1, t);
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const mesh = new Mesh("localShadowClear", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.applyToMesh(mesh, false);
    mesh.layerMask = LAYER;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.metadata = { noInk: true, noGlow: true, noShadowCaster: true };
    // The positions are clip space already, so no bounding box means anything
    // and nothing may cull on one.
    mesh.doNotSyncBoundingInfo = true;
    this.atlas?.setMaterialForRendering(mesh, this.clearMat);
    this.clearList.length = 0;
    this.clearList.push(mesh);
    return mesh;
  }

  /**
   * The map's collider boxes and visual meshes, from `installMap`. The boxes
   * a moving light can see are indexed once here — glass and porous boxes out,
   * as a round sees them — and each is composed into its matrix once.
   */
  setWorld(
    size: number,
    boxes: readonly WorldBox[],
    rayGroups: readonly (readonly WorldBox[])[],
    visuals: readonly AbstractMesh[],
  ): void {
    this.releaseAll();
    const kept: WorldBox[] = [];
    for (const b of boxes) if (!b.glass && !b.porous) kept.push(b);
    for (const g of rayGroups) for (const b of g) kept.push(b);
    this.index = buildBoxIndex(kept, size, 0);
    this.boxes = this.index.boxes;
    const n = this.boxes.length;
    this.boxMatrices = new Float32Array(n * 16);
    this.boxBounds = new Float32Array(n * 6);
    this.boxStamp.length = n;
    this.boxStamp.fill(0);
    const m = new Matrix();
    const q = new Quaternion();
    const scale = new Vector3();
    const at = new Vector3();
    for (let i = 0; i < n; i++) {
      const b = this.boxes[i];
      // The collider's own transform: pitched about X, then yawed about Y —
      // `RayWorld.boxCast` inverts exactly this.
      Quaternion.RotationYawPitchRollToRef(b.rotY, b.rotX, 0, q);
      scale.set(b.w, b.h, b.d);
      at.set(b.cx, b.cy, b.cz);
      Matrix.ComposeToRef(scale, q, at, m);
      m.copyToArray(this.boxMatrices, i * 16);
      // The AABB of the rotated box, off the matrix's absolute rows.
      const r = m.m;
      for (let a = 0; a < 3; a++) {
        const e =
          0.5 * (Math.abs(r[a]) + Math.abs(r[4 + a]) + Math.abs(r[8 + a]));
        this.boxBounds[i * 6 + a] = r[12 + a];
        this.boxBounds[i * 6 + 3 + a] = e;
      }
    }
    this.visuals = visuals.filter((v) => !v.metadata?.noShadowCaster);
  }

  /**
   * Chooses this frame's shadowed lights, lays out their tiles and packs what
   * the passes will draw. Runs after `LightingSystem.update`, whose winning
   * slots are `active`; the draw itself is `render`, from the scene.
   */
  update(
    active: readonly PointLightData[],
    eye: Vector3,
    bodies: readonly ShadowBody[],
    hulls: readonly ShadowHull[],
  ): void {
    this.frame++;
    this.bakeQueue.length = 0;
    this.drawDynamic = false;
    this.proxyCount = 0;
    this.clearFlags.fill(0);
    const tier = this.tier;
    if (!this.atlas || tier.lights === 0 || !this.index || !this.ready()) {
      this.releaseAll();
      this.publish(active);
      return;
    }

    const chosen = this.choose(active, eye, tier);

    this.packBodies(bodies, hulls);
    const c = CONFIG.graphics.localShadows;
    const dynamicFrame = this.frame % tier.every === 0;
    let bakeBudget = c.staticFacesPerFrame;
    for (const e of chosen) {
      this.refresh(e);
      const reach = e.range + 1.5;
      const nearBody = this.anyBodyWithin(e.at, reach);
      if (nearBody) e.bodiesSeen = this.frame;
      if (!e.moving) {
        // The static layer, a face at a time off the frame's budget.
        while (e.baked < e.faces && bakeBudget > 0) {
          this.bakeQueue.push({ entry: e, face: e.baked });
          this.clearFlags[e.staticBase + e.baked] = 1;
          e.baked++;
          bakeBudget--;
        }
        // A dynamic tile only while a body is near, held for a second past
        // the last one so a soldier crossing the edge of the reach does not
        // allocate and free it every other frame.
        const wantDyn = this.frame - e.bodiesSeen < 60;
        if (wantDyn && e.dynBase < 0) {
          e.dynBase = this.alloc(e.faces, e);
          e.dynDrawn = false;
          if (e.dynBase >= 0) this.writeFaces(e, e.dynBase);
        } else if (!wantDyn && e.dynBase >= 0) {
          this.freeBlock(e.dynBase, e.faces);
          e.dynBase = -1;
        }
      }
      if (e.dynBase >= 0 && (dynamicFrame || !e.dynDrawn)) {
        this.packDynamic(e);
        for (let f = 0; f < e.faces; f++) this.clearFlags[e.dynBase + f] = 1;
        e.dynDrawn = true;
        this.drawDynamic = true;
      }
    }
    this.proxy.thinInstanceCount = this.proxyCount;
    if (this.proxyCount > 0) {
      this.proxy.thinInstanceBufferUpdated("matrix");
      this.proxy.thinInstanceBufferUpdated("tileId");
    }
    this.publish(active);
  }

  /** Whether every material this draws with has compiled. */
  private ready(): boolean {
    return (
      this.proxyMat.isReady(this.proxy) &&
      (this.clearSheet ? this.clearMat.isReady(this.clearSheet) : false)
    );
  }

  /**
   * The lights that get tiles: what may cast, ranked MOVING before FIXTURE
   * (a moving shadow is the one the player is looking at, and the cheaper
   * one to lose is the fixture's), then by distance past the light's own
   * reach, with a light already holding tiles given `keepMargin`.
   */
  private readonly ranked: Ranked[] = [];
  /** The records behind `ranked`, reused frame to frame. */
  private readonly rankPool: Ranked[] = [];
  private readonly chosen: Entry[] = [];
  /** Every light gives its tiles back. */
  private releaseAll(): void {
    // Skipped when empty, which is every frame on the `off` rung.
    if (this.entries.size === 0) return;
    this.entries.forEach(this.releaseOne);
    this.entries.clear();
  }
  private readonly releaseOne = (e: Entry): void => this.release(e);
  /** `choose`'s release walk, bound once rather than a closure per frame. */
  private readonly dropUnwanted = (e: Entry, light: PointLightData): void => {
    if (this.wanted.has(light)) return;
    this.release(e);
    this.entries.delete(light);
  };
  /** The top of `ranked` this frame, by light — reused, never reallocated. */
  private readonly wanted = new Set<PointLightData>();
  private choose(
    active: readonly PointLightData[],
    eye: Vector3,
    tier: (typeof CONFIG.graphics.localShadows.tiers)[ShadowQuality],
  ): Entry[] {
    const c = CONFIG.graphics.localShadows;
    const ranked = this.ranked;
    ranked.length = 0;
    const slots = Math.min(active.length, MAX_POINT_LIGHTS);
    for (let i = 0; i < slots; i++) {
      const l = active[i];
      const intent = l.shadow ?? "none";
      if (intent === "none") continue;
      if (intent === "blast" && !tier.transients) continue;
      const moving = intent !== "fixture" || !tier.meshes;
      let score = Vector3.Distance(eye, l.position) - l.range;
      if (this.entries.has(l)) score -= c.keepMargin;
      if (!moving) score += 1e4;
      const r = (this.rankPool[ranked.length] ??= { e: l, score, moving });
      r.e = l;
      r.score = score;
      r.moving = moving;
      ranked.push(r);
    }
    ranked.sort(byRankScore);
    const want = Math.min(ranked.length, tier.lights);
    // Everything outside the top `want` gives its tiles back — its static
    // cache with them, which is what `keepMargin` exists to make rare — and
    // BEFORE anything is admitted. Admitting first let a light that had lost its place keep
    // its tiles through the frame a better one asked for them — and a blast,
    // which lives a third of a second, never found room at all.
    const wanted = this.wanted;
    wanted.clear();
    for (let i = 0; i < want; i++) wanted.add(ranked[i].e);
    // `forEach` rather than `for…of`: no iterator, and no [key, value]
    // tuple per entry, on a walk that runs every frame. Deleting the entry
    // being visited is safe in a Map's `forEach`.
    this.entries.forEach(this.dropUnwanted);
    const chosen = this.chosen;
    chosen.length = 0;
    for (let i = 0; i < want; i++) {
      const r = ranked[i];
      let e: Entry | null | undefined = this.entries.get(r.e);
      if (e && e.moving !== r.moving) {
        this.release(e);
        this.entries.delete(r.e);
        e = undefined;
      }
      if (!e) {
        e = this.admit(r.e, r.moving);
        // Still no room — six cube faces is a big run, and the fixtures'
        // dynamic tiles hold the rest: the LOWEST-ranked holder below this
        // light gives its tiles up, one at a time, until it fits. Only ever
        // downward, so no light evicts one that outranks it.
        for (let j = want - 1; !e && j > i; j--) {
          const victim = this.entries.get(ranked[j].e);
          if (!victim) continue;
          this.release(victim);
          this.entries.delete(ranked[j].e);
          e = this.admit(r.e, r.moving);
        }
        if (!e) continue;
        this.entries.set(r.e, e);
      }
      chosen.push(e);
    }
    return chosen;
  }

  /** A new entry with its first tiles, or null when the atlas has no room. */
  private admit(light: PointLightData, moving: boolean): Entry | null {
    const faces = light.spot ? 1 : 6;
    const e: Entry = {
      light,
      moving,
      faces,
      staticBase: -1,
      dynBase: -1,
      baked: 0,
      dynDrawn: false,
      at: light.position.clone(),
      range: light.range,
      axis: light.spot ? light.spot.dir.clone() : new Vector3(0, 0, 1),
      cosOuter: light.spot?.cosOuter ?? -2,
      boxes: [],
      gatheredAt: new Vector3(Infinity, 0, 0),
      gatheredRange: 0,
      bodiesSeen: -1e9,
    };
    if (moving) {
      e.dynBase = this.alloc(faces, e);
      if (e.dynBase < 0) return null;
      this.writeFaces(e, e.dynBase);
    } else {
      e.staticBase = this.alloc(faces, e);
      if (e.staticBase < 0) return null;
      this.writeFaces(e, e.staticBase);
    }
    return e;
  }

  /**
   * Follows a light that moved. A moving one re-writes its face records every
   * frame; a fixture that moved (the editor's drag) re-bakes from scratch.
   */
  private refresh(e: Entry): void {
    const l = e.light;
    const spot = l.spot;
    const moved =
      Vector3.DistanceSquared(l.position, e.at) > 0.0025 ||
      Math.abs(l.range - e.range) > 0.05 ||
      (spot !== undefined &&
        (Vector3.DistanceSquared(spot.dir, e.axis) > 1e-5 ||
          spot.cosOuter !== e.cosOuter));
    if (!moved) return;
    e.at.copyFrom(l.position);
    e.range = l.range;
    if (spot) {
      e.axis.copyFrom(spot.dir);
      e.cosOuter = spot.cosOuter;
    }
    if (e.staticBase >= 0) {
      e.baked = 0;
      this.writeFaces(e, e.staticBase);
    }
    if (e.dynBase >= 0) this.writeFaces(e, e.dynBase);
  }

  /** The four face records for one block of tiles. */
  private writeFaces(e: Entry, base: number): void {
    const near = CONFIG.graphics.localShadows.nearClear;
    const r = this.scratchR;
    const u = this.scratchU;
    for (let f = 0; f < e.faces; f++) {
      const fwd = e.light.spot ? e.axis : CUBE[f];
      let tanHalf = 1;
      if (e.light.spot) {
        const c = Math.min(Math.max(e.cosOuter, 0.2), 0.9999);
        tanHalf = Math.sqrt(1 - c * c) / c;
      }
      faceFrame(fwd, r, u);
      const t = base + f;
      const o = t * 16;
      const rec = this.faces;
      rec[o] = e.at.x;
      rec[o + 1] = e.at.y;
      rec[o + 2] = e.at.z;
      rec[o + 3] = e.range;
      rec[o + 4] = fwd.x;
      rec[o + 5] = fwd.y;
      rec[o + 6] = fwd.z;
      rec[o + 7] = tanHalf;
      rec[o + 8] = r.x;
      rec[o + 9] = r.y;
      rec[o + 10] = r.z;
      rec[o + 11] = t;
      rec[o + 12] = u.x;
      rec[o + 13] = u.y;
      rec[o + 14] = u.z;
      rec[o + 15] = Math.min(near, e.range * 0.5);
    }
  }

  /**
   * Whether an axis-aligned box (centre, half extents) can reach a tile's
   * face: inside the light's range and inside the face's four side planes,
   * each tested as a half-space through the light.
   */
  private reaches(t: number, cx: number, cy: number, cz: number, ex: number, ey: number, ez: number): boolean {
    const o = t * 16;
    const f = this.faces;
    const lx = cx - f[o];
    const ly = cy - f[o + 1];
    const lz = cz - f[o + 2];
    const range = f[o + 3];
    const rad = Math.hypot(ex, ey, ez);
    if (lx * lx + ly * ly + lz * lz > (range + rad) ** 2) return false;
    const th = f[o + 7];
    // Side planes: forward * tanHalf +/- right, forward * tanHalf +/- up.
    for (let s = 0; s < 4; s++) {
      const a = s < 2 ? 8 : 12;
      const sign = s % 2 === 0 ? 1 : -1;
      const nx = f[o + 4] * th + sign * f[o + a];
      const ny = f[o + 5] * th + sign * f[o + a + 1];
      const nz = f[o + 6] * th + sign * f[o + a + 2];
      const d = lx * nx + ly * ny + lz * nz;
      const reach = ex * Math.abs(nx) + ey * Math.abs(ny) + ez * Math.abs(nz);
      if (d + reach < 0) return false;
    }
    return true;
  }

  /**
   * This frame's soldiers and hulls, packed once — the ones NEAREST a
   * shadowed light, not the first to arrive. A body is worth a slot only
   * while it stands inside some chosen light's reach, and on a map fielding
   * twenty-four a side more than `maxBodies` can be; so a full frame keeps the
   * bodies deepest inside a light, by the same replace-the-worst selection
   * `BodyShadows` spends its budget with, and the common frame compares
   * nothing. Hulls have their own `maxHulls` slots, as in `BodyShadows`: they
   * came after the soldiers in one shared budget and never got one.
   */
  private packBodies(
    bodies: readonly ShadowBody[],
    hulls: readonly ShadowHull[],
  ): void {
    this.bodyCount = 0;
    if (this.chosen.length === 0) return;
    const c = CONFIG.graphics.bodyShadows;
    const per = this.bodyBoxes.perBody;
    const picked = this.pickedBodies;
    const gap = this.pickedGap;
    let m = 0;
    for (const b of bodies) {
      const root = b.rig.root;
      if (!root.isEnabled()) continue;
      // The body box is 1.3 m either way of its root — see `packDynamic`.
      const g = this.lightGap(root.absolutePosition);
      if (g > 1.5) continue;
      if (m < c.maxBodies) {
        picked[m] = b;
        gap[m] = g;
        m++;
        continue;
      }
      let worst = 0;
      for (let i = 1; i < m; i++) if (gap[i] > gap[worst]) worst = i;
      if (g >= gap[worst]) continue;
      picked[worst] = b;
      gap[worst] = g;
    }
    let n = 0;
    for (let i = 0; i < m; i++) {
      const rig = picked[i]!.rig;
      this.bodyBoxes.writeRig(rig, this.bodyMatrices, n * per);
      this.bodyBoxCount[n] = per;
      (this.bodyAt[n] ??= new Vector3()).copyFrom(rig.root.absolutePosition);
      n++;
      // Dropped so a pooled rig cannot be held alive by this list.
      picked[i] = null;
    }
    // A hull takes a soldier's slot and uses one box of it, so the two
    // index alike; `bodyMatrices` is sized for both budgets.
    let hullsIn = 0;
    for (const h of hulls) {
      if (hullsIn >= c.maxHulls) break;
      if (!h.body.isEnabled()) continue;
      const at = h.body.getAbsolutePosition();
      // A hull's box is 4 m either way.
      if (this.lightGap(at) > 4) continue;
      this.bodyBoxes.writeHull(h, this.bodyMatrices, n * per);
      this.bodyBoxCount[n] = 1;
      (this.bodyAt[n] ??= new Vector3()).copyFrom(at);
      n++;
      hullsIn++;
    }
    this.bodyCount = n;
  }

  /** How far `p` stands outside the nearest chosen light's reach (negative inside). */
  private lightGap(p: Vector3): number {
    let best = Infinity;
    for (const e of this.chosen) {
      best = Math.min(best, Vector3.Distance(p, e.at) - e.range);
    }
    return best;
  }

  private anyBodyWithin(at: Vector3, reach: number): boolean {
    const r2 = reach * reach;
    for (let i = 0; i < this.bodyCount; i++) {
      if (Vector3.DistanceSquared(this.bodyAt[i], at) < r2) return true;
    }
    return false;
  }

  /** One light's dynamic layer into the proxy buffer. */
  private packDynamic(e: Entry): void {
    if (e.moving) {
      this.gather(e);
      const bb = this.boxBounds;
      for (const i of e.boxes) {
        const o = i * 6;
        for (let f = 0; f < e.faces; f++) {
          const t = e.dynBase + f;
          if (!this.reaches(t, bb[o], bb[o + 1], bb[o + 2], bb[o + 3], bb[o + 4], bb[o + 5])) continue;
          if (!this.emit(this.boxMatrices, i, t)) return;
        }
      }
    }
    const per = this.bodyBoxes.perBody;
    for (let b = 0; b < this.bodyCount; b++) {
      const p = this.bodyAt[b];
      for (let f = 0; f < e.faces; f++) {
        const t = e.dynBase + f;
        // A body as a box of 1.3 m either way of its root — a hull as 4 —
        // generous, and the fragment stage clips whatever lands outside.
        const size = this.bodyBoxCount[b] === 1 ? 4 : 1.3;
        if (!this.reaches(t, p.x, p.y, p.z, size, size, size)) continue;
        for (let k = 0; k < this.bodyBoxCount[b]; k++) {
          if (!this.emit(this.bodyMatrices, b * per + k, t)) return;
        }
      }
    }
  }

  /** Copies one matrix into the proxy buffer for tile `t`. False when full. */
  private emit(src: Float32Array, i: number, t: number): boolean {
    if (this.proxyCount >= this.proxyTiles.length) return false;
    this.proxyMatrices.set(src.subarray(i * 16, i * 16 + 16), this.proxyCount * 16);
    this.proxyTiles[this.proxyCount] = t;
    this.proxyCount++;
    return true;
  }

  /**
   * The collider boxes within a moving light's reach, re-gathered only when
   * it has moved a metre — the list is a superset by that margin, and the
   * per-face test does the rest.
   */
  private gather(e: Entry): void {
    const index = this.index;
    if (!index) return;
    const slack = 1;
    if (
      Vector3.DistanceSquared(e.gatheredAt, e.at) < slack * slack &&
      e.gatheredRange >= e.range
    ) {
      return;
    }
    e.gatheredAt.copyFrom(e.at);
    e.gatheredRange = e.range;
    e.boxes.length = 0;
    const reach = e.range + slack;
    const stamp = ++this.stamp;
    const { dim, origin, cells } = index;
    const cell = (v: number) =>
      Math.max(0, Math.min(dim - 1, Math.floor((v - origin) / BOX_BUCKET)));
    const x0 = cell(e.at.x - reach);
    const x1 = cell(e.at.x + reach);
    const z0 = cell(e.at.z - reach);
    const z1 = cell(e.at.z + reach);
    const bb = this.boxBounds;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = cells[cz * dim + cx];
        if (!list) continue;
        for (const i of list) {
          if (this.boxStamp[i] === stamp) continue;
          this.boxStamp[i] = stamp;
          const o = i * 6;
          // A box the light stands INSIDE is its own housing, and would put
          // the whole light out — `nearClear`'s reason, for the proxies.
          if (
            Math.abs(e.at.x - bb[o]) < bb[o + 3] &&
            Math.abs(e.at.y - bb[o + 1]) < bb[o + 4] &&
            Math.abs(e.at.z - bb[o + 2]) < bb[o + 5]
          ) {
            continue;
          }
          const dx = bb[o] - e.at.x;
          const dy = bb[o + 1] - e.at.y;
          const dz = bb[o + 2] - e.at.z;
          const rad = Math.hypot(bb[o + 3], bb[o + 4], bb[o + 5]);
          if (dx * dx + dy * dy + dz * dz > (reach + rad) ** 2) continue;
          e.boxes.push(i);
        }
      }
    }
  }

  /**
   * Re-deals the published tiles onto slots `LightingSystem` has just
   * re-ordered, for a frame that re-ran the light choice without running
   * `update` — the kit stage, whose lamps take the first slots. The tiles are
   * keyed by LIGHT, so a lantern still in the list keeps its own in its new
   * slot and a kit lamp gets none; without this, a slot keeps the tiles of
   * whichever light held it last and is shadowed against the wrong position.
   * Allocates, bakes and draws nothing.
   */
  reslot(active: readonly PointLightData[]): void {
    this.publish(active);
  }

  /**
   * Writes every slot's cone and tiles into the factory's arrays — every
   * slot, shadowed or not, because a spot's CONE is owed whatever the rung.
   */
  private publish(active: readonly PointLightData[]): void {
    const { spot, shade } = this.mats.localSlots;
    const n = Math.min(active.length, MAX_POINT_LIGHTS);
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const o = i * 4;
      const l = i < n ? active[i] : null;
      const cone = l?.spot;
      if (cone) {
        spot[o] = cone.dir.x;
        spot[o + 1] = cone.dir.y;
        spot[o + 2] = cone.dir.z;
        spot[o + 3] = cone.cosOuter;
        shade[o] = cone.cosInner;
      } else {
        spot[o] = 0;
        spot[o + 1] = 0;
        spot[o + 2] = 0;
        spot[o + 3] = -2;
        shade[o] = 1;
      }
      const e = l ? this.entries.get(l) : undefined;
      // A static layer is live once its last face is QUEUED: the queue is
      // drawn in this frame's render, which runs after this and before the
      // main pass that reads it.
      shade[o + 1] = e && e.staticBase >= 0 && e.baked >= e.faces ? e.staticBase : -1;
      shade[o + 2] = e && e.dynBase >= 0 && e.dynDrawn ? e.dynBase : -1;
    }
  }

  /** First-fit run of `n` free tiles, or -1. */
  private alloc(n: number, e: Entry): number {
    for (let base = 0; base + n <= this.tileCount; base++) {
      let free = true;
      for (let k = 0; k < n; k++) {
        if (this.owner[base + k]) {
          free = false;
          base += k;
          break;
        }
      }
      if (!free) continue;
      for (let k = 0; k < n; k++) this.owner[base + k] = e;
      return base;
    }
    return -1;
  }

  private freeBlock(base: number, n: number): void {
    for (let k = 0; k < n; k++) this.owner[base + k] = null;
  }

  private release(e: Entry): void {
    if (e.staticBase >= 0) this.freeBlock(e.staticBase, e.faces);
    if (e.dynBase >= 0) this.freeBlock(e.dynBase, e.faces);
    e.staticBase = -1;
    e.dynBase = -1;
  }

  /**
   * This frame's passes: the clears, a pass per static face in the queue,
   * then one for every dynamic tile. Nothing is drawn on a frame with no work.
   */
  private render(): void {
    const atlas = this.atlas;
    if (!atlas || !this.clearSheet) return;
    let any = this.fullClear;
    for (let t = 0; t < this.tileCount && !any; t++) any = this.clearFlags[t] > 0;
    if (!any && !this.drawDynamic && this.bakeQueue.length === 0) return;

    if (any) this.pass(atlas, this.clearList);

    const bake = this.bakeQueue;
    for (let j = 0; j < bake.length; j++) {
      const { entry, face } = bake[j];
      const tile = entry.staticBase + face;
      const mat = this.bakeMats[j];
      mat.setFloat("faceTile", tile);
      const meshes = this.bakeLists[j];
      meshes.length = 0;
      if (this.tier.meshes) {
        for (const m of this.visuals) {
          if (!m.isEnabled() || !m.isVisible) continue;
          const bb = m.getBoundingInfo().boundingBox;
          const c = bb.centerWorld;
          const x = bb.extendSizeWorld;
          if (!this.reaches(tile, c.x, c.y, c.z, x.x, x.y, x.z)) continue;
          meshes.push(m);
        }
        atlas.setMaterialForRendering(meshes, mat);
        // A pass drawn before its effect has compiled draws NOTHING — the
        // mesh skips an unready material — over a tile the clear has already
        // reset to lit, and `update` has already counted the face. So a face
        // whose pass is not ready is handed back to be baked again, rather
        // than being published empty for as long as the light holds its tiles.
        if (!this.compiled(atlas, mat, meshes)) {
          entry.baked = Math.min(entry.baked, face);
          continue;
        }
      }
      this.pass(atlas, meshes);
    }

    if (this.drawDynamic && this.proxyCount > 0) this.pass(atlas, this.proxyList);

    // CONSUMED: a frame whose state runs no `update` (the menu, a lid) must
    // not redraw the last one's work — its static bakes would clear and bake
    // again every frame, and its dynamic tiles would hold stale bodies anyway.
    this.bakeQueue.length = 0;
    this.clearFlags.fill(0);
    this.drawDynamic = false;
  }

  /**
   * Whether `mat` has compiled for every mesh it is about to bake, asked in
   * the ATLAS's render pass — the per-pass draw wrapper is what the pass will
   * draw with, and asking in any other pass warms a different one. Every mesh
   * is asked, not just until the first refusal, so they all start compiling
   * together.
   */
  private compiled(
    atlas: RenderTargetTexture,
    mat: ShaderMaterial,
    meshes: readonly AbstractMesh[],
  ): boolean {
    const engine = this.scene.getEngine();
    const was = engine.currentRenderPassId;
    engine.currentRenderPassId = atlas.renderPassId;
    const instanced = engine.getCaps().instancedArrays;
    let ok = true;
    for (const m of meshes) {
      const subs = m.subMeshes;
      if (!subs) continue;
      const mesh = m as Mesh;
      const useInstances =
        instanced && ((mesh.instances?.length ?? 0) > 0 || mesh.hasThinInstances === true);
      for (const sm of subs) {
        if (!mat.isReadyForSubMesh(m, sm, useInstances)) ok = false;
      }
    }
    engine.currentRenderPassId = was;
    return ok;
  }

  private pass(atlas: RenderTargetTexture, list: AbstractMesh[]): void {
    this.list = list;
    atlas.render();
    this.scene.incrementRenderId();
    this.scene.resetCachedMaterial();
    this.list = [];
  }

  /** The atlas, for a reader that is not a material (none yet). */
  get depthMap(): RenderTargetTexture | null {
    return this.atlas;
  }

  dispose(): void {
    this.scene.onBeforeRenderTargetsRenderObservable.remove(this.renderObserver);
    this.atlas?.dispose();
    this.atlas = null;
    this.clearSheet?.dispose();
    this.proxy.dispose();
    this.proxyMat.dispose();
    this.clearMat.dispose();
    for (const m of this.bakeMats) m.dispose();
  }

  /** How many tiles are held, for the profiler and the debug overlay. */
  get tilesHeld(): number {
    let n = 0;
    for (const o of this.owner) if (o) n++;
    return n;
  }
}
