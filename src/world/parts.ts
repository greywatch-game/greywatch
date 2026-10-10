/**
 * parts.ts — PARTS: the `Part` every kit builder, scatter prop and model
 * (weapon, optic, hull, soldier, thrown thing) builds, what a model and the
 * world's merge do to parts before they are meshes, and the places a part
 * becomes a Babylon mesh.
 * Owns: `PartNode` (a local transform and a parent — the frame a group of
 * parts is built in) and `Part` (a node with a `GeometryBuffer`, a material
 * and its metadata); `worldMatrixOf`, `detachPart` (`setParent(null)`),
 * `flattenParts` (a prop's parent links resolved into each part's own
 * transform at EMIT time), `mergeParts` (`MergeMeshes`' geometry) and
 * `bakePartTransform` (`bakeCurrentTransformIntoVertices`); the adapters —
 * `drawnMesh` for a model, `worldMeshes` for the world's surfaces (the
 * floor, the rim and every merged surface, each surface's arrays released as
 * its mesh takes them), `vertexDataOf` for a bare buffer (through a build's
 * `PlainArrays` memo where two meshes must share one copy).
 * Invariants: a `Part` is plain data — nothing in it has heard of Babylon but
 * the material it carries — and `drawnMesh` is the ONE place one becomes a
 * mesh (`worldMeshes` makes every world mesh through it), handing Babylon
 * exactly the arrays and the transform it held when the builders and the
 * merges made meshes themselves, so `kit:hash` (and its `--models` half) and
 * `merge:hash` cannot tell the difference. Every routine that moves a vertex
 * or a transform here is Babylon's, step for step, because those oracles
 * compare bits. A part has no parent by the time it is adapted:
 * `flattenParts` or `detachPart` cuts every link first, and every adapter
 * refuses one that is left. `worldMeshes` makes the world's meshes in BIRTH
 * order (`WorldSurface.born`, `worldGeometry.ts`), which is the scene order
 * they had when the merge ran on meshes, and hands them back in list order.
 *
 * **Why the geometry is ours and the meshes are still Babylon's.** The kit
 * builds `GeometryBuffer`s through `src/geometry/` (Babylon's generators,
 * copied operation for operation and checked by `scripts/geometry-check.mjs`),
 * every merge runs on those buffers, and Babylon draws the result until the
 * renderer is ours. The adapter is the seam between the two, and it is
 * deliberately dumb: a `Float64Array` goes back as the `number[]` Babylon
 * held, a `Float32Array` as itself, the indices as a plain array — never a
 * `Float64Array` handed to a Babylon buffer, which would upload eight-byte
 * doubles as if they were four.
 *
 * **Why nothing is a mesh until the end: 87% of a 1500 m build was the
 * placement loop, and the placement loop is not what anybody thought it was.**
 * `ENGINE_UPGRADE.md` wall 4 derived the cost as `Scene.removeMesh`'s
 * `indexOf` over a `scene.meshes` growing to 23,014 — `O(built x live)`, which
 * is the shape the table had. Measured on the 900/300 proving ground it is
 * not: `removeMesh` is called 88,131 times, scans 547 MILLION array elements
 * doing it, and costs **98 ms** of a 6,420 ms loop. V8's `indexOf` over a
 * packed array is 0.18 ns an element, and the derivation was pricing it as a
 * memory access.
 *
 * **Where the time actually went was `device.createBuffer` and
 * `queue.writeBuffer`.** Every part a builder made — a plank, a mullion, a
 * pane — was a real `Mesh`, and `VertexData.applyToMesh` uploads its
 * positions, normals, UVs and indices to the GPU the instant it is created.
 * `MergeMeshes` then read them back out of the CPU copies Babylon kept
 * anyway, uploaded the merged result, and DISPOSED every source — destroying
 * the buffers it had just made. Profiled inside `MapBuilder.build` on the same
 * ground: 1,878 ms in `createBuffer`, 1,692 in `writeBuffer` and 515 in
 * `createVertexBuffer` around them, against an 8,802 ms build. Half the build
 * was uploading geometry that was thrown away before a frame was drawn.
 *
 * The first answer was the part MESH: a mesh holding vertices with nothing on
 * the device, by holding `Geometry.delayLoadState` at NOTLOADED for the one
 * call that would have created its buffers — a Babylon internal leaned on —
 * and an upload every path out of a merge owed. The second, BABYLON_EXIT.md
 * X1.4's, is that there is no mesh at all until the merges and the vertex
 * bake are done: they run on parts, and `worldMeshes` uploads each surface the
 * world keeps, once, through public API. The part mesh, and every helper that
 * kept it honest, is deleted.
 *
 * **Colliders are deliberately NOT parts.** The editor's centre-screen pick
 * walks `mesh.subMeshes`, and a collider built without them would be one it
 * could never select. Nothing that moves or shoots reads the meshes any more
 * — the rays and the sweeps both answer off the `WorldBox`es (`RayWorld`,
 * `CollisionField`) — so `MapBuilder.collider` staying on `MeshBuilder` is the
 * editor's, and goes when the editor stops picking meshes.
 */
import {
  Mesh,
  Quaternion as BabylonQuaternion,
  VertexBuffer,
  type Material,
  type Scene,
  VertexData,
} from "@babylonjs/core";
import { mergeTransformed, type FloatArray, type GeometryBuffer } from "../geometry/buffer";
import { Matrix, Quaternion, Vector3 } from "../math";
import { recordOf, releaseArrays, type SurfaceRecord, type WorldSurface } from "./worldGeometry";

/** A mesh's metadata bag, which is what the merge and the bake read flags off. */
export type PartMetadata = { [flag: string]: unknown };

/**
 * A node of a part tree: where something stands in its builder's frame, and
 * what it hangs from. On its own it draws nothing — it is the frame a model
 * builds a group of parts in (a raked grip, a rail's run of teeth, a hand's
 * frame), standing where a `TransformNode` stood when the builders made
 * meshes, and gone once its parts are merged.
 *
 * **Mesh-shaped on purpose.** It carries the members a builder ever touched on
 * the Babylon node it replaces — `position`, `rotation`, `scaling`,
 * `rotationQuaternion`, `parent` — under the same names and with the same
 * meaning, Euler order included (Babylon turns a node by Z, then X, then Y),
 * so a builder written against a node reads the same against this, and the
 * adapters below are copies rather than translations.
 *
 * **`parent` is how a builder says where a part goes, never where it IS.** It
 * keeps Babylon's child order — a node joins the END of its new parent's
 * `children` and leaves its old one's — because that order is the order
 * `flattenParts` emits them in, and the order a merge concatenates is the
 * vertex order of the world.
 */
export class PartNode {
  readonly position = new Vector3();
  readonly rotation = new Vector3();
  readonly scaling = new Vector3(1, 1, 1);
  rotationQuaternion: Quaternion | null = null;
  /** In the order they were parented, as Babylon's `_children`. */
  readonly children: PartNode[] = [];
  private parentNode: PartNode | null = null;
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  get parent(): PartNode | null {
    return this.parentNode;
  }

  /** Babylon's `Node.parent` setter, minus everything about a scene. */
  set parent(parent: PartNode | null) {
    if (this.parentNode === parent) return;
    if (this.parentNode) {
      const index = this.parentNode.children.indexOf(this);
      if (index !== -1) this.parentNode.children.splice(index, 1);
    }
    this.parentNode = parent;
    if (parent) parent.children.push(this);
  }
}

/**
 * One part of a structure, a prop or a model: a surface, where it stands in
 * its builder's frame, and what it is painted with — a `PartNode` that draws.
 */
export class Part extends PartNode {
  material: Material | null = null;
  metadata: PartMetadata | null = null;
  geometry: GeometryBuffer;

  constructor(name: string, geometry: GeometryBuffer) {
    super(name);
    this.geometry = geometry;
  }
}

const TMP_SCALE = new Vector3();
const TMP_ROTATION = new Quaternion();
const TMP_DECOMPOSED = new Quaternion();
const TMP_COMPOSED = new Matrix();
const TMP_DETACHED_SCALE = new Vector3();
const TMP_DETACHED_POSITION = new Vector3();

/**
 * `TransformNode.computeWorldMatrix` for a part: its local matrix, times its
 * parent's world matrix when it has one — in float32, as Babylon's is.
 */
export function worldMatrixOf(part: PartNode, out: Matrix): Matrix {
  // Babylon multiplies the scaling by `scalingDeterminant` (1) first: `x * 1`
  // is `x` for every float, the sign of a zero included.
  TMP_SCALE.copyFromFloats(part.scaling.x * 1, part.scaling.y * 1, part.scaling.z * 1);
  const rotation =
    part.rotationQuaternion ??
    Quaternion.RotationYawPitchRollToRef(part.rotation.y, part.rotation.x, part.rotation.z, TMP_ROTATION);
  Matrix.ComposeToRef(TMP_SCALE, rotation, part.position, out);
  if (part.parent) out.multiplyToRef(worldMatrixOf(part.parent, new Matrix()), out);
  return out;
}

/**
 * `TransformNode.setParent(null)` on one node, step for step, because what
 * reads the result compares bits: its own matrix composed (unscaled by the
 * determinant, as `setParent` composes it), times its parent's world matrix,
 * decomposed into a scaling, a rotation — written back as Euler angles unless
 * the node carries a quaternion — and a position, and the link cut. A node
 * with no parent is left alone, as Babylon leaves it.
 */
export function detachPart(part: PartNode): void {
  const parent = part.parent;
  if (!parent) return;
  const rotation =
    part.rotationQuaternion ??
    Quaternion.RotationYawPitchRollToRef(part.rotation.y, part.rotation.x, part.rotation.z, TMP_ROTATION);
  Matrix.ComposeToRef(part.scaling, rotation, part.position, TMP_COMPOSED);
  TMP_COMPOSED.multiplyToRef(worldMatrixOf(parent, new Matrix()), TMP_COMPOSED);
  TMP_COMPOSED.decompose(TMP_DETACHED_SCALE, TMP_DECOMPOSED, TMP_DETACHED_POSITION);
  if (part.rotationQuaternion) part.rotationQuaternion.copyFrom(TMP_DECOMPOSED);
  else TMP_DECOMPOSED.toEulerAnglesToRef(part.rotation);
  part.scaling.copyFrom(TMP_DETACHED_SCALE);
  part.position.copyFrom(TMP_DETACHED_POSITION);
  part.parent = null;
}

/**
 * A prop's parts, its parent links resolved: the root, then every descendant
 * with its parent's transform composed into its own and the link cut — the
 * transform applied at EMIT time that a `.parent =` used to leave to the merge.
 *
 * **It is Babylon's `TransformNode.setParent(null)` (`detachPart`), run over
 * the tree in `getChildMeshes` order**, because the merge after it reads what
 * this writes and `merge:hash` compares bits. The order is the whole tree's,
 * taken BEFORE any link is cut, and a grandchild is composed with its parent
 * AFTER that parent was flattened — which is not the same float32 matrix as
 * before it was, and is what Babylon did. A `PartNode` that draws nothing is
 * walked through and left standing, as `getChildMeshes` walks through a
 * `TransformNode` without returning it.
 *
 * Why at all, rather than keeping the links: the placement is set on the ROOT
 * after the builder returns (`MapBuilder.scatterRegion`), so this is the first
 * moment the whole transform is known, and after it nothing downstream has to
 * know a part can have a parent.
 */
export function flattenParts(root: Part): Part[] {
  const order: Part[] = [];
  const walk = (node: PartNode): void => {
    for (const child of node.children) {
      if (child instanceof Part) order.push(child);
      walk(child);
    }
  };
  walk(root);
  for (const part of order) detachPart(part);
  return [root, ...order];
}

/**
 * The geometry `Mesh.MergeMeshes(parts, true, true)` made of a model's parts:
 * each one under its own world matrix (`worldMatrixOf`, the
 * `computeWorldMatrix(true)` the merge asks each mesh for), merged by
 * `mergeTransformed` in the order given — the first part's precision being
 * the merge's. A new buffer; no part's geometry is touched.
 *
 * What the merge did besides the geometry is its caller's: the mesh it made
 * is `drawnMesh`'s, named, painted and parented as the merged mesh was.
 */
export function mergeParts(parts: readonly Part[]): GeometryBuffer {
  if (parts.length === 0) throw new Error("mergeParts: nothing to merge");
  const members = parts.map((part) => ({
    buffer: part.geometry,
    transform: worldMatrixOf(part, new Matrix()),
  }));
  return mergeTransformed(members[0], members.slice(1));
}

/**
 * `mesh.bakeCurrentTransformIntoVertices()` for a part: its world matrix baked
 * into its geometry IN PLACE (`GeometryBuffer.bake` — normals renormalised,
 * unlike a merge's) and its local transform reset to identity, a quaternion
 * kept as the identity quaternion as `resetLocalMatrix` keeps one. The parent
 * link stays, as Babylon's does, which is why every caller detaches first.
 * Refuses a part with children: `resetLocalMatrix` would re-seat them, and
 * no caller has any.
 */
export function bakePartTransform(part: Part): Part {
  if (part.children.length) {
    throw new Error(`bakePartTransform: "${part.name}" has children`);
  }
  part.geometry.bake(worldMatrixOf(part, new Matrix()));
  part.scaling.copyFromFloats(1, 1, 1);
  part.position.copyFromFloats(0, 0, 0);
  part.rotation.copyFromFloats(0, 0, 0);
  if (part.rotationQuaternion) part.rotationQuaternion = Quaternion.Identity();
  return part;
}

/** A float attribute as Babylon held it: doubles as a `number[]`, float32 as itself. */
function babylonFloats(a: FloatArray, plain?: PlainArrays): number[] | Float32Array {
  return a instanceof Float32Array ? a : plainOnce(a, plain);
}

/** `plainArray`, through the build's memo when there is one. */
function plainOnce(a: Float64Array | Uint32Array, plain?: PlainArrays): number[] {
  if (!plain) return plainArray(a);
  let out = plain.get(a);
  if (!out) plain.set(a, (out = plainArray(a)));
  return out;
}

/**
 * A typed array's values as a plain array, by a loop: `Array.from` walks a
 * typed array through its iterator, ~28 times slower measured here, and this
 * runs once per attribute of every part in a map.
 */
function plainArray(a: ArrayLike<number>): number[] {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  return out;
}

/**
 * The plain arrays one build has already made of a buffer's typed arrays,
 * keyed by the typed array — so two meshes made of ONE buffer (the floor and
 * its collider clone, `MapBuilder.buildValley`) hold one `number[]` between
 * them, as they did when both were applied from one `VertexData`. Per build,
 * and weak, so it holds nothing once the build's buffers are gone.
 */
export type PlainArrays = WeakMap<object, number[]>;

/**
 * A buffer as the `VertexData` Babylon would have built: every array in the
 * type Babylon held (see the header) and every one a COPY but a
 * `Float32Array`'s, so nothing Babylon does to its own arrays in place — a
 * merge extends its first member's indices — reaches a buffer through them.
 *
 * Given `plain`, a typed array this build has already copied comes back as the
 * SAME copy rather than a second one — see `PlainArrays`.
 */
export function vertexDataOf(buffer: GeometryBuffer, plain?: PlainArrays): VertexData {
  const data = new VertexData();
  data.positions = babylonFloats(buffer.positions, plain);
  if (buffer.normals) data.normals = babylonFloats(buffer.normals, plain);
  if (buffer.uvs) data.uvs = babylonFloats(buffer.uvs, plain);
  if (buffer.uvs2) data.uvs2 = babylonFloats(buffer.uvs2, plain);
  if (buffer.colors) data.colors = babylonFloats(buffer.colors, plain);
  data.indices = plainOnce(buffer.indices, plain);
  return data;
}

/**
 * The one place a MODEL's surface becomes a Babylon mesh — a weapon's, an
 * optic's, a hull's, a soldier's, a thrown thing's: an ordinary mesh with its
 * buffers on the device, ready to draw, hang off a live joint and move. It is
 * what `MeshBuilder` and `Mesh.MergeMeshes` handed the models when they built
 * meshes themselves — `applyToMesh` on a fresh mesh, with the arrays in the
 * types Babylon held.
 *
 * Given a `Part`, it carries the part's transform, material and metadata too,
 * and refuses one that still has a parent: a model's live joints are
 * Babylon's, so a part's build-time frame is detached or baked before it is a
 * mesh. Given a bare buffer (a merge's), the mesh stands at identity.
 */
export function drawnMesh(part: Part, scene: Scene, plain?: PlainArrays): Mesh;
export function drawnMesh(name: string, buffer: GeometryBuffer, scene: Scene): Mesh;
export function drawnMesh(
  a: Part | string,
  b: Scene | GeometryBuffer,
  c?: Scene | PlainArrays,
): Mesh {
  if (a instanceof Part) {
    if (a.parent) throw new Error(`drawnMesh: "${a.name}" still has a parent — detach or bake it first`);
    const mesh = new Mesh(a.name, b as Scene);
    vertexDataOf(a.geometry, c as PlainArrays | undefined).applyToMesh(mesh);
    return dress(mesh, a);
  }
  const mesh = new Mesh(a, c as Scene);
  vertexDataOf(b as GeometryBuffer).applyToMesh(mesh);
  return mesh;
}

/**
 * The one place the WORLD's surfaces become Babylon meshes — the floor, the
 * rim, and every structure, scatter field, road and glazing block a map build
 * merged (`merge.ts`) and baked (`vertexShading.ts`), each through
 * `drawnMesh`, carrying its part's transform, material and metadata object
 * unchanged. A surface the bake gave colours is given `hasVertexAlpha =
 * false`, as the bake gave its mesh: the alpha is a lighting term, and the
 * world is opaque.
 *
 * **The meshes are CREATED in birth order (`WorldSurface.born`) and RETURNED
 * in list order**, and the two are not the same: a surface's birth is when
 * Babylon made its mesh while the merge still ran on meshes, and that is the
 * order `scene.meshes` holds them in — the order `WorldCulling` offers
 * candidates in, which reaches the glow mask and the transparent tie-breaks.
 * The list order is `GameMap.visuals`'.
 *
 * A surface whose positions must stay writable (`updatable`, a pane block
 * holding a breakable pane) gets them through `Mesh.setVerticesData(…, true)`,
 * the call that made them writable before. Each editor surface's mesh joins
 * its item's `visuals`, in list order: a placement's merged surfaces, then its
 * glazing.
 *
 * **A surface's ARRAYS are released as its mesh is made** (`releaseArrays`):
 * the record the map keeps (`SurfaceRecord`, `GameMap.world`) is everything
 * else, so the CPU holds the world's geometry once — in the arrays Babylon
 * keeps — rather than twice. `plain` is the build's `PlainArrays`, which is
 * how the floor's mesh comes out holding the arrays its collider clone was
 * already made of.
 */
export function worldMeshes(
  surfaces: readonly WorldSurface[],
  scene: Scene,
  plain: PlainArrays,
): { meshes: Mesh[]; records: SurfaceRecord[] } {
  const order = surfaces.map((_, i) => i).sort((a, b) => surfaces[a].born - surfaces[b].born);
  if (import.meta.env.DEV) {
    for (let k = 1; k < order.length; k++) {
      if (surfaces[order[k]].born === surfaces[order[k - 1]].born) {
        throw new Error(
          `worldMeshes: "${surfaces[order[k]].part.name}" and "${surfaces[order[k - 1]].part.name}" ` +
            `share birth ${surfaces[order[k]].born} — one surface reached the world twice`,
        );
      }
    }
  }
  const meshes = new Array<Mesh>(surfaces.length);
  const records = new Array<SurfaceRecord>(surfaces.length);
  for (const i of order) {
    const surface = surfaces[i];
    const mesh = drawnMesh(surface.part, scene, plain);
    if (surface.part.geometry.colors) mesh.hasVertexAlpha = false;
    if (surface.updatable) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (positions) mesh.setVerticesData(VertexBuffer.PositionKind, positions, true);
    }
    meshes[i] = mesh;
    records[i] = recordOf(surface);
    releaseArrays(surface.part);
  }
  surfaces.forEach((surface, i) => surface.owner?.visuals.push(meshes[i]));
  return { meshes, records };
}

/** A part's transform, material and metadata onto the mesh made of it. */
function dress(mesh: Mesh, part: Part): Mesh {
  mesh.position.set(part.position.x, part.position.y, part.position.z);
  mesh.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z);
  mesh.scaling.set(part.scaling.x, part.scaling.y, part.scaling.z);
  const q = part.rotationQuaternion;
  if (q) mesh.rotationQuaternion = new BabylonQuaternion(q.x, q.y, q.z, q.w);
  mesh.material = part.material;
  if (part.metadata) mesh.metadata = part.metadata;
  return mesh;
}
