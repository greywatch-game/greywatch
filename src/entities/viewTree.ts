/**
 * viewTree.ts — the player's own viewmodel as JOINTS (`BABYLON_EXIT.md`
 * X4.3b): the tree every rig, optic, arm, fist and flash hangs from, the
 * surfaces drawn off it — SEGMENTS our renderer draws (X4.3c) and the two
 * kinds of mesh Babylon still does — and the render cache its readers answer
 * from.
 * Owns: `ViewSegment` (an opaque viewmodel surface as plain data: a `Part`
 * with the two flags a mesh carried that the frame reads) and the adapters
 * that make one (`toSegment`, `segmentOf`) and measure one (`segmentBounds`);
 * `ViewTree` — the `JointTree` (`rigJoints.ts`; PRIVATE, because its
 * `compute` would rewrite worlds the cache does not know were rewritten),
 * whose root stands for the CAMERA; every viewmodel surface and the joint it
 * is drawn at (`ViewMesh`); the order each joint's children were hung in
 * (what `getChildMeshes` walked); and the per-frame evaluation
 * (`syncSwitches`, `draw`) — the segments it found on handed to our renderer
 * (`evaluated`, read by `Game.drawView`), the meshes handed to Babylon.
 * Invariants:
 * - **The joint list is the node list, in the order the nodes were made**:
 *   every `TransformNode` the viewmodel used to make is a joint made at the
 *   same moment (`joint`), so a reader that digests the tree by order —
 *   `kit:hash --models`, the oracle — reads the same sequence (`jointList`). A
 *   SURFACE is a joint too (`hang`): a leaf whose local is the surface's own,
 *   composed once at `seal` — or, for one other surfaces hang off (the fist's
 *   frag, the bottle's body, neck and cloth) or one whose own transform moves
 *   (the kit card), a joint whose channels the surface's were copied into at
 *   `seal` and which is written from then on. **The surfaces are listed in the
 *   order they were MADE** (`meshes`), which is the order Babylon's scene held
 *   the meshes they were — and so the order its cull offered them and its
 *   queue dispatched them, which `Game.drawView` sorts on.
 * - **Every viewmodel joint has one shape** (`viewJoint`, the moment it is
 *   made), so the compose that a rig and a hull also run meets two hidden
 *   classes, not one per order the fields arrived in.
 * - **Our renderer draws every opaque surface and Babylon is made no mesh of
 *   one** (X4.3c): a `ViewSegment` is the arrays, the transform, the material
 *   and the metadata the mesh was made of — `drawnMesh`'s inputs, which
 *   `kit:hash --models` still makes a mesh of to hash it in the mesh's bytes
 *   — and the two flags the frame reads, `isVisible` and its builder's own
 *   switch. **The two that stay Babylon's** — an optic's glass and the kit
 *   card, the blended ones (X4.3d) — have no parent: `draw` hands each its
 *   joint's world through `freezeWorldMatrix`, and each one's own enabled flag
 *   is its joint chain's, written by `syncSwitches` before the CULL reads it
 *   (an unparented mesh's `isEnabled()` sees no ancestor) and again by `draw`.
 * - **`draw` EVALUATES exactly the set Babylon's render evaluated** — every
 *   surface whose joint chain is switched on and whose own `isVisible` is set,
 *   a segment or a mesh, drawn by either renderer — through the `RenderCache`
 *   as `_evaluateActiveMeshes` computed it, at the provisional id the cache
 *   SETTLES at the render's evaluation id from inside the render
 *   (`onAfterActiveMeshesEvaluationObservable`): so the stamps Babylon's own
 *   evaluation left are the ones the next frame's readers meet, and narrowing
 *   the set to what one renderer draws, or settling at another id, would move
 *   the next frame's `muzzleWorld` and `throwHandWorld` — two command inputs
 *   (X4.3b's review). A mesh is frozen again whenever its joint was
 *   recomposed since it was last handed over (`ViewMesh.handed`), by its own
 *   evaluation, a child's or a reader's; a segment's matrix is its joint's
 *   world as the evaluation left it, read by `Game.drawView` straight after.
 *   The walk from the root never enters a switched-off subtree.
 * - **The readers answer Babylon's answers** (`read`, `world`): the render-id
 *   cache, never a fresh compose — two of them are command inputs. See
 *   `RenderCache`. A script that wants a joint's world composes its own copy
 *   (`VERIFYING.md`): `read` from outside the frame re-stamps the cache.
 * - What `seal` composes at build is each fixed surface's local, and each
 *   MESH's own world once (`computeWorldMatrix(true)`, unparented): that is
 *   what chooses its NONUNIFORMSCALING define, as its node-parented build did
 *   each frame, and a frozen matrix never chooses it again. Nothing else:
 *   until the first `draw` every surface's own flags and channels are what
 *   its builder left, which is what `kit:hash` records.
 * Never: parent a mesh, compose a joint outside the cache, hand Babylon a
 * world it did not compose, make a Babylon mesh of a segment, or read a
 * node's matrix (the camera's world is read through the root).
 */
import { Matrix as BabylonMatrix, type Mesh, type Scene } from "@babylonjs/core";
import type { GeometryBuffer } from "../geometry/buffer";
import { Quaternion, Vector3 } from "../math";
import { Part } from "../world/parts";
import { fixLocal, Joint, JointTree, RenderCache, viewJoint } from "./rigJoints";

/**
 * One opaque surface of the viewmodel, drawn by OUR renderer
 * (`render/ViewDraw.ts`, `BABYLON_EXIT.md` X4.3c) — what a Babylon mesh was
 * until then: a `Part` (its arrays, its transform, its material, its
 * metadata — exactly `drawnMesh`'s inputs), with no parent once it is hung,
 * and the two flags of the mesh the frame reads.
 */
export class ViewSegment extends Part {
  /** The mesh's `isVisible`: `ViewModel.applyMeshVisibility`'s, read by the evaluation. */
  isVisible = true;
  /**
   * Its OWN switch as its builder left it — the mesh's `isEnabled(false)`,
   * which `kit:hash` records. The frame reads the joint chain's.
   */
  enabled = true;
}

/** A surface of the viewmodel: a segment our renderer draws, or a mesh Babylon draws (a glass, the card). */
export type ViewSurface = Mesh | ViewSegment;

/**
 * A part as the segment `drawnMesh` would have made a mesh of: its arrays,
 * transform, material and metadata carried over — `dress`'s copy — and a
 * part that still has a parent refused, as `drawnMesh` refuses one.
 */
export function toSegment(part: Part): ViewSegment {
  if (part.parent) throw new Error(`toSegment: "${part.name}" still has a parent — detach or bake it first`);
  const s = new ViewSegment(part.name, part.geometry);
  s.position.copyFrom(part.position);
  s.rotation.copyFrom(part.rotation);
  s.scaling.copyFrom(part.scaling);
  const q = part.rotationQuaternion;
  if (q) s.rotationQuaternion = new Quaternion(q.x, q.y, q.z, q.w);
  s.material = part.material;
  if (part.metadata) s.metadata = part.metadata;
  return s;
}

/** A bare buffer as a segment at identity — `drawnMesh(name, buffer)`'s. */
export function segmentOf(name: string, buffer: GeometryBuffer): ViewSegment {
  return new ViewSegment(name, buffer);
}

/**
 * A segment's LOCAL bounds as Babylon's mesh held them
 * (`extractMinAndMax` over the positions it was handed, comparison for
 * comparison from `Number.MAX_VALUE`) — what `getBoundingInfo().boundingBox`
 * answered of the mesh, which the reload's magazine pivots and the bloom's
 * fade are measured off.
 */
export function segmentBounds(s: ViewSegment): { minimum: Vector3; maximum: Vector3 } {
  const p = s.geometry.positions;
  const min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  const max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    if (x < min.x) min.x = x;
    if (y < min.y) min.y = y;
    if (z < min.z) min.z = z;
    if (x > max.x) max.x = x;
    if (y > max.y) max.y = y;
    if (z > max.z) max.z = z;
  }
  return { minimum: min, maximum: max };
}

/** One surface the viewmodel draws, and the joint whose world it is drawn at. */
export interface ViewMesh {
  readonly surface: ViewSurface;
  /** Babylon's mesh, for a surface Babylon draws; null for a segment. */
  readonly mesh: Mesh | null;
  /** The segment, for a surface our renderer draws; null for a mesh. */
  readonly segment: ViewSegment | null;
  /** The surface's OWN joint — see the header. */
  readonly joint: Joint;
  /** Whether its transform moves after the build (its joint is written) or is fixed at `seal`. */
  readonly moves: boolean;
  /** The Babylon matrix a mesh is frozen at, written in place; null for a segment. */
  readonly drawn: BabylonMatrix | null;
  /** Its own enabled flag, as last written. */
  on: boolean;
  /** Whether Babylon has been handed a matrix for it yet. */
  frozen: boolean;
  /** Its joint's `childUpdate` when it was last handed over: a recompose since means a fresh freeze. */
  handed: number;
  /** The `syncSwitches` pass that last found it on. */
  seen: number;
  /** A segment's place in the kit our renderer draws (`Game` numbers them); -1 for a mesh. */
  slot: number;
}

/** What the root reads: anything with a world matrix (the camera, or a stand-in). */
export interface ViewCamera {
  readonly name: string;
  getWorldMatrix(): { readonly m: ArrayLike<number> };
}

function isSegment(s: ViewSurface): s is ViewSegment {
  return s instanceof ViewSegment;
}

export class ViewTree {
  /** Private: see the header. A digest reads the list through `jointList`. */
  private readonly joints = new JointTree();
  readonly cache: RenderCache;
  /**
   * The camera's stand-in: a root held off its world — or null for a tree with
   * no camera, which only builds (a weapon built alone, as `kit:hash` builds
   * one) and is never drawn or read.
   */
  readonly root: Joint | null;
  /** Every surface, in the order it was hung — the order it was made. */
  readonly meshes: ViewMesh[] = [];
  /** The joints that stand for a surface, keyed back to it. */
  readonly meshOf = new Map<Joint, ViewSurface>();
  /**
   * The segments the last `draw` evaluated, in tree order — `evaluatedCount`
   * of them; the array is reused, so read it before the next `draw`.
   */
  readonly evaluated: ViewMesh[] = [];
  evaluatedCount = 0;
  /** Each surface's entry, by its joint. */
  private readonly entryOf = new Map<Joint, ViewMesh>();
  /** Each joint's children, in the order they were hung from it (null: the top level). */
  private readonly kids = new Map<Joint | null, Joint[]>();
  private sealed = 0;
  /** The surfaces on after the last `syncSwitches`, and the list it swaps with. */
  private onList: ViewMesh[] = [];
  private spare: ViewMesh[] = [];
  /** False until a pass has looked at every surface: the first one walks all of them. */
  private primed = false;
  private pass = 0;

  constructor(
    scene: Scene,
    readonly camera: ViewCamera | null,
  ) {
    this.cache = new RenderCache(() => scene.getRenderId());
    if (camera) {
      const root = this.add(camera.name, null);
      root.outside = () => camera.getWorldMatrix();
      // The top of `syncSwitches`' walk.
      this.childOf(null, root);
      this.root = root;
    } else {
      this.root = null;
    }
    // Inside the render, once Babylon has moved the id it evaluated at —
    // whatever Babylon itself draws of the viewmodel, or nothing.
    scene.onAfterActiveMeshesEvaluationObservable.add(() => {
      this.cache.settle(scene.getRenderId());
    });
  }

  /** Every joint, in the order made — what a digest of the tree reads (`kit:hash`). */
  get jointList(): readonly Joint[] {
    return this.joints.joints;
  }

  /** A joint where a `TransformNode` used to be made, hung from `parent` (none: a top-level joint). */
  joint(name: string, parent: Joint | null): Joint {
    const j = this.add(name, parent);
    this.childOf(parent, j);
    return j;
  }

  /**
   * Hangs a surface from `on` and returns its own joint. A surface with
   * surfaces of its own — a segment whose part tree has children (the bottle,
   * `MolotovModel`), or a mesh with child meshes — becomes a joint they hang
   * under, each unparented, in the order they were parented; `moves` says the
   * surface's own transform is written after the build.
   */
  hang(surface: ViewSurface, on: Joint, moves = false): Joint {
    const children: ViewSurface[] = isSegment(surface)
      ? surface.children.filter((c): c is ViewSegment => c instanceof ViewSegment)
      : (surface.getChildMeshes(true) as Mesh[]);
    const j = this.add(surface.name, on);
    this.childOf(on, j);
    this.meshOf.set(j, surface);
    const segment = isSegment(surface) ? surface : null;
    const mesh = segment ? null : (surface as Mesh);
    // A surface switched off by its builder (the kit card) is switched by its
    // joint from now on.
    const enabled = segment ? segment.enabled : mesh!.isEnabled(false);
    j.enabled = enabled;
    const v: ViewMesh = {
      surface,
      mesh,
      segment,
      joint: j,
      moves: moves || children.length > 0,
      drawn: mesh ? new BabylonMatrix() : null,
      on: enabled,
      frozen: false,
      handed: -1,
      seen: 0,
      slot: -1,
    };
    this.meshes.push(v);
    this.entryOf.set(j, v);
    this.primed = false;
    surface.parent = null;
    for (const c of children) {
      c.parent = null;
      this.hang(c, j);
    }
    return j;
  }

  /**
   * The surfaces under `j`, as `getChildMeshes` walked them: its own children
   * in the order they were hung, and with `deep`, each one's descendants after
   * it.
   */
  meshesOn(j: Joint | null, deep = false, out: ViewSurface[] = []): ViewSurface[] {
    for (const c of this.kids.get(j) ?? []) {
      const surface = this.meshOf.get(c);
      if (surface) out.push(surface);
      if (deep) this.meshesOn(c, true, out);
    }
    return out;
  }

  /** The surface `j` stands for, or null for a node's joint. */
  meshFor(j: Joint): ViewSurface | null {
    return this.meshOf.get(j) ?? null;
  }

  /** Every segment, in the order hung — the kit our renderer draws, `ViewMesh.slot` its index. */
  segments(): ViewMesh[] {
    return this.meshes.filter((v) => v.segment !== null);
  }

  /**
   * Takes every surface hung since the last call off its builder's hands: its
   * channels copied into its joint, a fixed one's local composed once, and a
   * mesh's own world composed once (the header: NONUNIFORMSCALING). Run when
   * the builds are done — `ViewModel`'s constructor, and the flash's.
   */
  seal(): void {
    for (; this.sealed < this.meshes.length; this.sealed++) {
      const v = this.meshes[this.sealed];
      const j = v.joint;
      const m = v.surface;
      j.position.copyFrom(m.position);
      j.rotation.copyFrom(m.rotation);
      j.scaling.copyFrom(m.scaling);
      const q = m.rotationQuaternion;
      if (q) j.quaternion = new Quaternion(q.x, q.y, q.z, q.w);
      if (!v.moves) fixLocal(j);
      v.mesh?.computeWorldMatrix(true);
    }
  }

  /**
   * Each surface's own enabled flag, written to its joint chain's — before
   * the cull reads a mesh's. A walk from the root that never enters a
   * switched-off subtree: every surface it reaches is on, and one on after
   * the last pass that it did not reach is switched off.
   */
  syncSwitches(): void {
    const prev = this.primed ? this.onList : this.meshes;
    const next = this.spare;
    next.length = 0;
    const pass = ++this.pass;
    const tops = this.kids.get(null);
    if (tops) for (const j of tops) if (j.enabled) this.walkOn(j, next, pass);
    for (const v of prev) {
      if (v.seen !== pass && v.on) {
        v.on = false;
        v.mesh?.setEnabled(false);
      }
    }
    this.spare = this.primed ? prev : [];
    this.onList = next;
    this.primed = true;
  }

  private walkOn(j: Joint, next: ViewMesh[], pass: number): void {
    const v = this.entryOf.get(j);
    if (v) {
      v.seen = pass;
      next.push(v);
      if (!v.on) {
        v.on = true;
        v.mesh?.setEnabled(true);
      }
    }
    const kids = this.kids.get(j);
    if (kids) for (const c of kids) if (c.enabled) this.walkOn(c, next, pass);
  }

  /**
   * The frame's evaluation, immediately before `scene.render`: every surface
   * the render took — on and visible — evaluated as Babylon evaluated it; a
   * mesh handed its joint's world whenever that was recomposed since it was
   * last handed over, and a segment listed in `evaluated` for our renderer.
   */
  draw(): void {
    this.syncSwitches();
    this.cache.beginEvaluation();
    const out = this.evaluated;
    let n = 0;
    for (const v of this.onList) {
      if (!v.surface.isVisible) continue;
      this.cache.evaluate(v.joint);
      const mesh = v.mesh;
      if (mesh) {
        const update = v.joint.memo!.childUpdate;
        if (update !== v.handed || !v.frozen) {
          BabylonMatrix.FromArrayToRef(v.joint.world.m, 0, v.drawn!);
          mesh.freezeWorldMatrix(v.drawn!);
          v.handed = update;
          v.frozen = true;
        }
      } else {
        out[n++] = v;
      }
    }
    this.evaluatedCount = n;
  }

  /** `getAbsolutePosition`'s world for a joint: Babylon's render cache. */
  read(j: Joint) {
    return this.cache.read(j);
  }

  /** `getWorldMatrix` for a joint: Babylon's render cache. */
  world(j: Joint) {
    return this.cache.world(j);
  }

  /** A joint in the tree, given the viewmodel's one shape before anything else touches it. */
  private add(name: string, parent: Joint | null): Joint {
    return viewJoint(this.joints.add(name, parent));
  }

  private childOf(parent: Joint | null, child: Joint): void {
    const list = this.kids.get(parent);
    if (list) list.push(child);
    else this.kids.set(parent, [child]);
  }
}
