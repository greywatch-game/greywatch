/**
 * parts.ts — PARTS: the `Part` every kit builder, scatter prop and model
 * (weapon, optic, hull, soldier, thrown thing) builds, what a model and the
 * world's merge do to parts, and where the world's surfaces become RECORDS.
 * Owns: `PartNode` (a local transform and a parent — the frame a group of
 * parts is built in) and `Part` (a node with a `GeometryBuffer`, a material
 * and its metadata); `worldMatrixOf`, `detachPart` (`setParent(null)`),
 * `flattenParts` (a prop's parent links resolved into each part's own
 * transform at EMIT time), `mergeParts` (`MergeMeshes`' geometry) and
 * `bakePartTransform` (`bakeCurrentTransformIntoVertices`); `worldRecords`,
 * the world's surfaces (the floor, the rim and every merged surface) turned
 * into the records `GameMap.world` keeps, each handed to our renderer on the
 * way past and its arrays released; and `plainGeometryOf` for the floor's
 * positions and indices alone.
 * Invariants: a `Part` is plain data — nothing in it has heard of Babylon,
 * and nothing here makes a mesh (`BABYLON_EXIT.md` X6.1g deleted the last
 * arm that did, `drawnMesh`, with `vertexDataOf`). Every routine that moves a
 * vertex or a transform here is Babylon's, step for step, because `kit:hash`
 * (and its `--models` half) and `merge:hash` compare bits. A part has no
 * parent by the time it is recorded: `flattenParts` or `detachPart` cuts
 * every link first. `worldRecords` walks the world's surfaces in BIRTH order
 * (`WorldSurface.born`, `worldGeometry.ts`), which is the order Babylon made
 * their meshes in while the merge still ran on meshes, and so the order our
 * renderer is handed them in (`BuildOptions.onSurface`), and hands the
 * records back in list order.
 *
 * **Why the geometry is ours.** The kit builds `GeometryBuffer`s through
 * `src/geometry/` (Babylon's generators, copied operation for operation and
 * checked by `scripts/geometry-check.mjs`), every merge runs on those
 * buffers, and our renderer uploads the result itself (`BlockHandover`):
 * until `BABYLON_EXIT.md` X6.1g a surface it refused was made a Babylon mesh
 * here, in a world that failed anyway (X3.7c), and since then a refusal is
 * the world's failure alone.
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
 * and an upload every path out of a merge owed. The second is that there is
 * no mesh at all until the merges and the vertex
 * bake are done: they run on parts, and each surface the world keeps is
 * uploaded once, by our renderer, as `worldRecords` hands it over. The part
 * mesh, and every helper that kept it honest, is deleted.
 *
 * **Colliders are not parts, and not meshes.** A collider is a `WorldBox`
 * (`MapBuilder.collider`), a strut group or the floor's own arrays, and
 * nothing that moves or shoots reads anything else (`RayWorld`,
 * `CollisionField`); the meshes the map editor's centre-screen pick walked
 * went with their last reader (`BABYLON_EXIT.md` X5.3c, X5.3e).
 */
import { mergeTransformed, type FloatArray, type GeometryBuffer } from "../geometry/buffer";
import { Matrix, Quaternion, Vector3 } from "../math";
import type { MaterialKey } from "../shaders/MaterialKey";
import { recordOf, releaseArrays, type SurfaceRecord, type WorldSurface } from "./worldGeometry";

/** A part's metadata bag, which is what the merge and the bake read flags off. */
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
  material: MaterialKey | null = null;
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
/** `worldRecords`' scratch: each surface's world matrix, which its record's bounds are taken under. */
const TMP_WORLD = new Matrix();

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
 * What the merge did besides the geometry is its caller's: the part or the
 * segment made of it is named, painted and hung as the merged mesh was.
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
 * runs once per attribute of every floor block in a map.
 */
function plainArray(a: ArrayLike<number>): number[] {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  return out;
}

/**
 * A buffer's positions and indices alone, in the types Babylon was handed
 * them in when a clone of the floor block was a collider mesh — doubles as a
 * `number[]`, float32 as itself, the indices as a plain array — so
 * `GameMap.terrainGeometry` (`PhysicsWorld`'s floor) holds the very values,
 * in the very types, it held then (`BABYLON_EXIT.md` X5.3e took the collider
 * mesh away, and X6.1g the floor mesh whose arrays these were shared with
 * through a build's memo). Copies but a `Float32Array`'s, so nothing done to
 * the buffer later reaches them.
 */
export function plainGeometryOf(buffer: GeometryBuffer): { positions: number[] | Float32Array; indices: number[] } {
  return { positions: babylonFloats(buffer.positions), indices: plainArray(buffer.indices) };
}

/**
 * The one place the WORLD's surfaces become what the map keeps — the floor,
 * the rim, and every structure, scatter field, road and glazing block a map
 * build merged (`merge.ts`) and baked (`vertexShading.ts`): a RECORD each
 * (`recordOf`, `GameMap.world`), carrying its part's material and metadata
 * object unchanged, and NO mesh (`BABYLON_EXIT.md` X6.1g; on a shipped build
 * none was made since X4.6e). `onSurface` (`BuildOptions.onSurface`,
 * `BlockHandover`) is handed each surface and its index in the list at its
 * turn, while its ARRAYS can still be read, and takes what our renderer draws;
 * one it answers `false` for it has REFUSED, and the refusal fails the world
 * at the install (`BlockHandover.refuse`, `Game.worldFailed`) — nothing here
 * draws it instead. A build handed no `onSurface` keeps the records and
 * nothing draws the world.
 *
 * **The surfaces are WALKED in birth order (`WorldSurface.born`) and the
 * records RETURNED in list order**, and the two are not the same: a surface's
 * birth is when Babylon made its mesh while the merge still ran on meshes,
 * which was Babylon's candidate order, and it is the order `onSurface` is
 * handed them in — the order our renderer takes the glazing and the fires in,
 * and so what breaks a tie in their sorts.
 *
 * **A surface's ARRAYS are released at its turn** (`releaseArrays`): the
 * record is everything else, so the CPU holds the world's geometry once — in
 * our renderer's buffers — rather than twice. The record's BOUNDS are taken
 * off the arrays under the part's own world matrix (`worldMatrixOf`), first,
 * as Babylon's bounding info was for the mesh made of it — which `npm run
 * merge:hash` held them to while a mesh was made, and `scripts/bounds-check.mjs`
 * holds `boundsOf` to at every off-identity transform.
 */
export function worldRecords(
  surfaces: readonly WorldSurface[],
  onSurface?: (surface: WorldSurface, index: number) => boolean,
): SurfaceRecord[] {
  const order = surfaces.map((_, i) => i).sort((a, b) => surfaces[a].born - surfaces[b].born);
  if (import.meta.env.DEV) {
    for (let k = 1; k < order.length; k++) {
      if (surfaces[order[k]].born === surfaces[order[k - 1]].born) {
        throw new Error(
          `worldRecords: "${surfaces[order[k]].part.name}" and "${surfaces[order[k - 1]].part.name}" ` +
            `share birth ${surfaces[order[k]].born} — one surface reached the world twice`,
        );
      }
    }
  }
  const records = new Array<SurfaceRecord>(surfaces.length);
  for (const i of order) {
    const surface = surfaces[i];
    records[i] = recordOf(surface, worldMatrixOf(surface.part, TMP_WORLD));
    // Ours, or refused: asked before the release, so our renderer takes the
    // arrays while they can still be read.
    onSurface?.(surface, i);
    releaseArrays(surface.part, i);
  }
  return records;
}
