/**
 * parts.ts — A structure's PART meshes, built without ever reaching the GPU.
 * Owns: the three factories `kit/core.ts` builds visual geometry with, and the
 * one call that puts a part back on the normal path when it turns out to be
 * the thing that survives.
 * Invariants: a part carries its vertex data in CPU memory and NOTHING on the
 * device — no vertex buffer, no index buffer, no bounding info, no submesh. So
 * a part may be read, transformed, merged and disposed, and may never be
 * DRAWN, PICKED or COLLIDED WITH. Anything that survives a merge owes
 * `uploadPart` before it is handed to the rest of the world; a mesh that
 * reaches the scene without it is silently invisible, which is the one failure
 * this module can cause and the reason `mergeByMaterial` calls `uploadPart` on
 * every path out of it rather than only the ones it believes can survive.
 *
 * **It exists because 87% of a 1500 m build was the placement loop, and the
 * placement loop is not what anybody thought it was.** `ENGINE_UPGRADE.md`
 * wall 4 derived the cost as `Scene.removeMesh`'s `indexOf` over a
 * `scene.meshes` growing to 23,014 — `O(built x live)`, which is the shape the
 * table had. Measured on the 900/300 proving ground it is not: `removeMesh` is
 * called 88,131 times, scans 547 MILLION array elements doing it, and costs
 * **98 ms** of a 6,420 ms loop. V8's `indexOf` over a packed array is 0.18 ns
 * an element, and the derivation was pricing it as a memory access.
 *
 * **Where the time actually goes is `device.createBuffer` and
 * `queue.writeBuffer`.** Every part a builder makes — a plank, a mullion, a
 * pane — is a real `Mesh`, and `VertexData.applyToMesh` uploads its positions,
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
  CreateBoxVertexData,
  CreateCylinderVertexData,
  Geometry,
  Mesh,
  VertexBuffer,
  type Scene,
  type VertexData,
} from "@babylonjs/core";

/** The options `MeshBuilder.CreateBox` takes, minus the ones a part cannot use. */
type BoxOptions = Parameters<typeof CreateBoxVertexData>[0];
/** The same for `MeshBuilder.CreateCylinder`. */
type CylinderOptions = Parameters<typeof CreateCylinderVertexData>[0];

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
 * `MeshBuilder.CreateBox` without the upload.
 *
 * `sideOrientation` is left alone on purpose. `CreateBox` writes
 * `Mesh._GetDefaultSideOrientation(undefined)` onto both the options and
 * `_originalBuilderSideOrientation`, and both of those are `FRONTSIDE`, which
 * is what `CreateBoxVertexData` reads from an absent one and what the `Mesh`
 * constructor already put there. Setting it would be writing back what is
 * there — and `MergeMeshes` refuses a group whose members disagree, so a
 * divergence here would be loud rather than subtle.
 */
export function partBox(name: string, options: BoxOptions, scene: Scene): Mesh {
  return partSurface(name, CreateBoxVertexData(options), scene);
}

/** `MeshBuilder.CreateCylinder` without the upload. See `partBox`. */
export function partCylinder(
  name: string,
  options: CylinderOptions,
  scene: Scene,
): Mesh {
  return partSurface(name, CreateCylinderVertexData(options), scene);
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
