/**
 * parts.ts — PARTS: the `Part` every kit builder, scatter prop and model
 * (weapon, optic, hull, soldier, thrown thing) builds, what a model does to
 * its parts before they are meshes, the two places a part becomes a Babylon
 * mesh, and the Babylon-side part meshes the world's merge still runs on.
 * Owns: `PartNode` (a local transform and a parent — the frame a group of
 * parts is built in) and `Part` (a node with a `GeometryBuffer`, a material
 * and its metadata); `worldMatrixOf`, `detachPart` (`setParent(null)`),
 * `flattenParts` (a prop's parent links resolved into each part's own
 * transform at EMIT time), `mergeParts` (`MergeMeshes`' geometry) and
 * `bakePartTransform` (`bakeCurrentTransformIntoVertices`); the adapters —
 * `partMesh` for the world's merge, `drawnMesh` for a model, `vertexDataOf`
 * for a bare buffer — and the Babylon-side helpers the world's merge runs on:
 * `partSurface`, `uploadPart`, `bakePart`, `setPartVerticesData`.
 * Invariants: a `Part` is plain data — nothing in it has heard of Babylon but
 * the material it carries — and `partMesh` and `drawnMesh` are the ONLY
 * places one becomes a mesh (BABYLON_EXIT.md X1.2, X1.3), handing Babylon
 * exactly the arrays and the transform it held when the builders made meshes
 * themselves, so `kit:hash` (and its `--models` half) and `merge:hash` cannot
 * tell the difference. Every routine that moves a vertex or a transform here
 * is Babylon's, step for step, because those oracles compare bits. A part has
 * no parent by the time it is adapted: `flattenParts` or `detachPart` cuts
 * every link first, and both adapters refuse one that is left. A part MESH carries
 * its vertex data in CPU memory and NOTHING on the device — no vertex buffer,
 * no index buffer, no bounding info, no submesh. So a part mesh may be read,
 * transformed, merged and disposed, and may never be DRAWN, PICKED or
 * COLLIDED WITH. Anything handed to the rest of the world owes `uploadPart`
 * first; a mesh that reaches the scene without it is silently invisible,
 * which is the one failure this module can cause. That is why
 * `mergeByMaterial` uploads on every path out of it rather than only the ones
 * it believes can survive — EXCEPT when its caller says it will merge the
 * result `again` (a placement or scatter field into `BlockMerge`, a road into
 * the road merge), where every path out stays a part on purpose and the final
 * pass is what uploads. `npm run merge:hash` fails on any mesh the world is
 * handed that is still a part.
 *
 * **Why the geometry is ours and the meshes are still Babylon's.** The kit
 * builds `GeometryBuffer`s through `src/geometry/` (Babylon's generators,
 * copied operation for operation and checked by `scripts/geometry-check.mjs`),
 * and the merge still runs on Babylon meshes until X1.4 moves it onto buffers.
 * The adapter is the seam between the two, and it is deliberately dumb: a
 * `Float64Array` goes back as the `number[]` Babylon held, a `Float32Array` as
 * itself, the indices as a plain array — never a `Float64Array` handed to a
 * Babylon buffer, which would upload eight-byte doubles as if they were four.
 *
 * **Part MESHES exist because 87% of a 1500 m build was the placement loop,
 * and the placement loop is not what anybody thought it was.** `ENGINE_UPGRADE.md`
 * wall 4 derived the cost as `Scene.removeMesh`'s `indexOf` over a
 * `scene.meshes` growing to 23,014 — `O(built x live)`, which is the shape the
 * table had. Measured on the 900/300 proving ground it is not: `removeMesh` is
 * called 88,131 times, scans 547 MILLION array elements doing it, and costs
 * **98 ms** of a 6,420 ms loop. V8's `indexOf` over a packed array is 0.18 ns
 * an element, and the derivation was pricing it as a memory access.
 *
 * **Where the time actually goes is `device.createBuffer` and
 * `queue.writeBuffer`.** Every part a builder made — a plank, a mullion, a
 * pane — was a real `Mesh`, and `VertexData.applyToMesh` uploads its positions,
 * normals, UVs and indices to the GPU the instant it is created.
 * `MergeMeshes` then reads them back out of the CPU copies Babylon kept
 * anyway, uploads the merged result, and DISPOSES every source — destroying
 * the buffers it just made. Profiled inside `MapBuilder.build` on the same
 * ground: 1,878 ms in `createBuffer`, 1,692 in `writeBuffer` and 515 in
 * `createVertexBuffer` around them, against an 8,802 ms build. Half the build
 * is uploading geometry that is thrown away before a frame is drawn.
 *
 * **The lever is Babylon's own and it is `Geometry.delayLoadState`, held for
 * exactly one call.** `Geometry.setVerticesData` postpones the device buffer
 * whenever the geometry has no mesh on it yet (`postponeInternalCreation:
 * this._meshes.length === 0`), and `Geometry.applyToMesh` only runs
 * `_applyToMesh` — which is what creates every postponed buffer —
 * `if (this.isReady())`. So building the geometry BEFORE the mesh and applying
 * it while it reads as not-ready gets a mesh holding vertices that has never
 * spoken to the device.
 *
 * **The state is put back IMMEDIATELY, and that is not tidiness.** Every read
 * on a `Geometry` is gated on the same `isReady()` — `getVertexBuffer`,
 * `getVerticesData` and `getTotalVertices` all return null or zero while it is
 * false — so a part left in that state is not an un-uploaded mesh, it is an
 * EMPTY one, and `MergeMeshes` fails it as "Positions are required". The
 * not-ready window is one call wide by construction.
 *
 * **Colliders are deliberately NOT built this way and must not be.**
 * `moveWithCollisions` walks `mesh.subMeshes`, and a part has none — a
 * collider built as a part would stop nothing, silently. `MapBuilder.collider`
 * stays on `MeshBuilder`, and that is a rule rather than an omission.
 */
import {
  Constants,
  Geometry,
  Mesh,
  Quaternion as BabylonQuaternion,
  VertexBuffer,
  type Material,
  type Scene,
  Vector3 as BabylonVector3,
  VertexData,
} from "@babylonjs/core";
import { mergeTransformed, type FloatArray, type GeometryBuffer } from "../geometry/buffer";
import { Matrix, Quaternion, Vector3 } from "../math";

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
function babylonFloats(a: FloatArray): number[] | Float32Array {
  return a instanceof Float32Array ? a : plainArray(a);
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
 * A buffer as the `VertexData` Babylon would have built: every array in the
 * type Babylon held (see the header) and every one a COPY but a
 * `Float32Array`'s, so nothing Babylon does to its own arrays in place — a
 * merge extends its first member's indices — reaches a buffer through them.
 */
export function vertexDataOf(buffer: GeometryBuffer): VertexData {
  const data = new VertexData();
  data.positions = babylonFloats(buffer.positions);
  if (buffer.normals) data.normals = babylonFloats(buffer.normals);
  if (buffer.uvs) data.uvs = babylonFloats(buffer.uvs);
  if (buffer.uvs2) data.uvs2 = babylonFloats(buffer.uvs2);
  if (buffer.colors) data.colors = babylonFloats(buffer.colors);
  data.indices = plainArray(buffer.indices);
  return data;
}

/**
 * The one place a `Part` becomes a Babylon mesh for the WORLD's merge: a part
 * MESH (`partSurface`, nothing on the device) carrying the part's arrays,
 * transform, material and metadata — the mesh the kit used to build itself,
 * member for member.
 *
 * Refuses a part that still has a parent: the link is `flattenParts`'s to cut,
 * and a mesh made without it would stand where its builder put it in its
 * parent's frame, not where its parent put it.
 */
export function partMesh(part: Part, scene: Scene): Mesh {
  if (part.parent) {
    throw new Error(`partMesh: "${part.name}" still has a parent — flattenParts first`);
  }
  return dress(partSurface(part.name, vertexDataOf(part.geometry), scene), part);
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
export function drawnMesh(part: Part, scene: Scene): Mesh;
export function drawnMesh(name: string, buffer: GeometryBuffer, scene: Scene): Mesh;
export function drawnMesh(a: Part | string, b: Scene | GeometryBuffer, c?: Scene): Mesh {
  if (a instanceof Part) {
    if (a.parent) throw new Error(`drawnMesh: "${a.name}" still has a parent — detach or bake it first`);
    const mesh = new Mesh(a.name, b as Scene);
    vertexDataOf(a.geometry).applyToMesh(mesh);
    return dress(mesh, a);
  }
  const mesh = new Mesh(a, c!);
  vertexDataOf(b as GeometryBuffer).applyToMesh(mesh);
  return mesh;
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

/**
 * A mesh carrying `data` with nothing on the device.
 *
 * The order is the whole of it: the `Geometry` is built with no mesh on it, so
 * every buffer it is given is postponed; it is marked NOTLOADED for the one
 * call that would create them; and it is ready again before anybody reads it.
 */
export function partSurface(
  name: string,
  data: VertexData,
  scene: Scene,
): Mesh {
  const mesh = new Mesh(name, scene);
  const geometry = new Geometry(Geometry.RandomId(), scene);
  geometry.setAllVerticesData(data, false);
  geometry.delayLoadState = Constants.DELAYLOADSTATE_NOTLOADED;
  geometry.applyToMesh(mesh);
  geometry.delayLoadState = Constants.DELAYLOADSTATE_NONE;
  return mesh;
}

/**
 * Puts a part on the normal path: device buffers created, bounding info built,
 * global submesh made — everything `applyToMesh` skipped.
 *
 * **Every path out of a merge owes this**, including the ones that look like
 * they cannot be reached: the group-of-one hand-bake, which keeps its source
 * rather than making a new mesh, and the material-less mesh both merges skip.
 * A part that reaches the scene without it draws nothing at all and throws
 * nothing at all.
 *
 * A part is recognised by having vertices and no device buffer under them,
 * which is the condition itself rather than a flag standing in for it. That is
 * what lets this be called blind — `mergeByMaterial` runs over already-merged
 * meshes twice (`BlockMerge`, the road pass) and cannot tell which kind it has
 * — and it is why nothing here has to be kept in step with `partSurface`.
 *
 * The release-and-reapply is not a trick: `applyToMesh` returns immediately
 * when the mesh already carries the geometry, so the only way to ask for the
 * work it skipped is to hand the geometry back and give it again.
 */
export function uploadPart(mesh: Mesh): Mesh {
  const geometry = mesh.geometry;
  if (!geometry) return mesh;
  const positions = geometry.getVertexBuffer(VertexBuffer.PositionKind);
  if (!positions || positions.getBuffer()) return mesh;
  geometry.releaseForMesh(mesh, false);
  geometry.applyToMesh(mesh);
  return mesh;
}

/**
 * `mesh.setVerticesData(kind, data, false)`, except that a part stays a part.
 *
 * Babylon creates a buffer's device copy at once whenever its geometry
 * already has a mesh on it, which a part's always does — so a buffer ADDED to
 * a part (the palette's `uv2`, written as a group goes into `BlockMerge`)
 * landed on the device a moment before the merge threw it away, and left the
 * part half uploaded. This postpones that buffer as `partSurface` postpones
 * the rest, and `uploadPart` creates it with them. A mesh already on the
 * device takes Babylon's own call.
 */
export function setPartVerticesData(
  mesh: Mesh,
  kind: string,
  data: Float32Array | number[],
): void {
  const geometry = mesh.geometry;
  const positions = geometry?.getVertexBuffer(VertexBuffer.PositionKind);
  if (!geometry || !positions || positions.getBuffer()) {
    mesh.setVerticesData(kind, data, false);
    return;
  }
  // `Geometry.setVerticesData`'s own buffer, with the postponement it gives
  // a geometry that has no mesh yet.
  geometry.setVerticesBuffer(
    new VertexBuffer(mesh.getEngine(), data, kind, {
      updatable: false,
      postponeInternalCreation: true,
      label: `Geometry_${geometry.id}_${kind}`,
    }),
  );
}

/**
 * `uploadPart(mesh).bakeCurrentTransformIntoVertices()` with ONE upload, or
 * none at all when `upload` is false — the merge's group-of-one path, which a
 * lone colour in a building or a block takes.
 *
 * **That chain uploaded twice**: `uploadPart` creates every device buffer, and
 * the bake then writes new positions and normals through `setVerticesData`,
 * which creates their buffers AGAIN and drops the first pair. And where the
 * result is going to be merged again (`mergeByMaterial`'s `again`), neither
 * upload was ever drawn.
 *
 * **It is Babylon's bake on the part's own arrays**: the world matrix computed
 * the same way, the same arrays read through the same `getVerticesData`, each
 * vertex through the same `TransformCoordinatesFromFloatsToRef` and each
 * normal through `TransformNormalFromFloatsToRef` and `normalize` — then the
 * arrays put on a fresh part geometry rather than uploaded one kind at a
 * time, and the local matrix reset exactly as `bakeCurrentTransformIntoVertices`
 * resets it. The mesh keeps its identity, name and metadata.
 *
 * **A mirrored transform and a mesh with tangents go the old way**: Babylon
 * flips the winding through a re-application this does not reproduce, and no
 * part in the kit has either — the fallback is exactness, not speed.
 */
export function bakePart(mesh: Mesh, upload: boolean): Mesh {
  const geometry = mesh.geometry;
  const world = mesh.computeWorldMatrix(true);
  const positionBuffer = geometry?.getVertexBuffer(VertexBuffer.PositionKind);
  if (
    !geometry ||
    !positionBuffer ||
    positionBuffer.getBuffer() ||
    world.determinant() < 0 ||
    mesh.isVerticesDataPresent(VertexBuffer.TangentKind)
  ) {
    return uploadPart(mesh).bakeCurrentTransformIntoVertices();
  }
  const data = new VertexData();
  for (const kind of geometry.getVerticesDataKinds()) {
    const stored = geometry.getVertexBuffer(kind)?.getData();
    if (stored) data.set(stored as number[], kind);
  }
  const temp = BabylonVector3.Zero();
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < positions.length; i += 3) {
    BabylonVector3.TransformCoordinatesFromFloatsToRef(
      positions[i], positions[i + 1], positions[i + 2], world, temp,
    ).toArray(positions, i);
  }
  data.positions = positions;
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (normals) {
    for (let i = 0; i < normals.length; i += 3) {
      BabylonVector3.TransformNormalFromFloatsToRef(
        normals[i], normals[i + 1], normals[i + 2], world, temp,
      )
        .normalize()
        .toArray(normals, i);
    }
    data.normals = normals;
  }
  data.indices = geometry.getIndices(false, false);
  geometry.releaseForMesh(mesh, true);
  const fresh = new Geometry(Geometry.RandomId(), mesh.getScene());
  fresh.setAllVerticesData(data, false);
  fresh.delayLoadState = Constants.DELAYLOADSTATE_NOTLOADED;
  fresh.applyToMesh(mesh);
  fresh.delayLoadState = Constants.DELAYLOADSTATE_NONE;
  mesh.resetLocalMatrix(true);
  return upload ? uploadPart(mesh) : mesh;
}
