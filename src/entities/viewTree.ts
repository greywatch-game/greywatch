/**
 * viewTree.ts — the player's own viewmodel as JOINTS (`BABYLON_EXIT.md`
 * X4.3b): the tree every rig, optic, arm, fist and flash hangs from, the meshes
 * Babylon still draws off it, and the render cache its readers answer from.
 * Owns: `ViewTree` — the `JointTree` (`rigJoints.ts`; PRIVATE, because its
 * `compute` would rewrite worlds the cache does not know were rewritten),
 * whose root stands for the CAMERA; every viewmodel mesh and the joint it is
 * drawn at (`ViewMesh`); the order each joint's children were hung in (what
 * `getChildMeshes` walked); and the per-frame hand-over to Babylon
 * (`syncSwitches`, `draw`).
 * Invariants:
 * - **The joint list is the node list, in the order the nodes were made**:
 *   every `TransformNode` the viewmodel used to make is a joint made at the
 *   same moment (`joint`), so a reader that digests the tree by order —
 *   `kit:hash --models`, the oracle — reads the same sequence (`jointList`). A
 *   MESH is a joint too (`hang`): a leaf whose local is the mesh's own,
 *   composed once at `seal` — or, for a mesh other meshes hang off (the fist's
 *   grenade, the bottle's neck and cloth) or one whose own transform moves (the
 *   kit card), a joint whose channels the mesh's were copied into at `seal` and
 *   which is written from then on.
 * - **Every viewmodel joint has one shape** (`viewJoint`, the moment it is
 *   made), so the compose that a rig and a hull also run meets two hidden
 *   classes, not one per order the fields arrived in.
 * - **Babylon draws every mesh and none has a parent**: `draw`, once a frame
 *   in every state immediately before `scene.render` (`Game.tick`), hands each
 *   switched-on, visible mesh its joint's world through `freezeWorldMatrix`,
 *   exactly the set `_evaluateActiveMeshes` took off `WorldCulling`'s list
 *   (on and visible) — and evaluates each through the `RenderCache` as that
 *   walk computed it, so the stamps Babylon's own evaluation left are the
 *   ones the next frame's readers meet. A mesh is frozen again whenever its
 *   joint was recomposed since it was last handed over (`ViewMesh.handed`),
 *   by its own evaluation, a child's or a reader's. Each mesh's own enabled
 *   flag is its joint chain's, written by `syncSwitches` before the CULL reads
 *   it (an unparented mesh's `isEnabled()` sees no ancestor) and again by
 *   `draw` — a walk from the root that never enters a switched-off subtree.
 * - **The readers answer Babylon's answers** (`read`, `world`): the render-id
 *   cache, never a fresh compose — two of them are command inputs. See
 *   `RenderCache`. A script that wants a joint's world composes its own copy
 *   (`VERIFYING.md`): `read` from outside the frame re-stamps the cache.
 * - What `seal` composes at build is each fixed mesh's local, and each mesh's
 *   OWN world once (`computeWorldMatrix(true)`, unparented): that is what
 *   chooses its NONUNIFORMSCALING define, as its node-parented build did each
 *   frame (the bottle's wick is scaled on one axis), and a frozen matrix never
 *   chooses it again. Nothing else: until the first `draw` every mesh's own
 *   flags and channels are what its builder left, which is what `kit:hash`
 *   records.
 * Never: parent a mesh, compose a joint outside the cache, hand Babylon a
 * world it did not compose, or read a node's matrix (the camera's world is
 * read through the root).
 */
import { Matrix as BabylonMatrix, type Mesh, type Scene } from "@babylonjs/core";
import { Quaternion } from "../math";
import { fixLocal, Joint, JointTree, RenderCache, viewJoint } from "./rigJoints";

/** One mesh the viewmodel draws, and the joint whose world it is drawn at. */
export interface ViewMesh {
  readonly mesh: Mesh;
  /** The mesh's OWN joint — see the header. */
  readonly joint: Joint;
  /** Whether its transform moves after the build (its joint is written) or is fixed at `seal`. */
  readonly moves: boolean;
  /** The Babylon matrix it is frozen at, written in place. */
  readonly drawn: BabylonMatrix;
  /** Its own enabled flag, as last written. */
  on: boolean;
  /** Whether Babylon has been handed a matrix for it yet. */
  frozen: boolean;
  /** Its joint's `childUpdate` when it was last handed over: a recompose since means a fresh freeze. */
  handed: number;
  /** The `syncSwitches` pass that last found it on. */
  seen: number;
}

/** What the root reads: anything with a world matrix (the camera, or a stand-in). */
export interface ViewCamera {
  readonly name: string;
  getWorldMatrix(): { readonly m: ArrayLike<number> };
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
  /** Every mesh, in the order it was hung. */
  readonly meshes: ViewMesh[] = [];
  /** The joints that stand for a mesh, keyed back to it. */
  readonly meshOf = new Map<Joint, Mesh>();
  /** Each mesh's entry, by its joint. */
  private readonly entryOf = new Map<Joint, ViewMesh>();
  /** Each joint's children, in the order they were hung from it (null: the top level). */
  private readonly kids = new Map<Joint | null, Joint[]>();
  private sealed = 0;
  /** The meshes on after the last `syncSwitches`, and the list it swaps with. */
  private onList: ViewMesh[] = [];
  private spare: ViewMesh[] = [];
  /** False until a pass has looked at every mesh: the first one walks all of them. */
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
    // Inside the render, once Babylon has moved the id it evaluated at.
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
   * Hangs a mesh from `on` and returns its own joint. A mesh with meshes of
   * its own (a builder shared with a world pool may hand back such a tree)
   * becomes a joint they hang under, each unparented; `moves` says the mesh's
   * own transform is written after the build.
   */
  hang(mesh: Mesh, on: Joint, moves = false): Joint {
    const children = mesh.getChildMeshes(true) as Mesh[];
    const j = this.add(mesh.name, on);
    this.childOf(on, j);
    this.meshOf.set(j, mesh);
    // A mesh switched off by its builder (the kit card) is switched by its
    // joint from now on.
    j.enabled = mesh.isEnabled(false);
    const v: ViewMesh = {
      mesh,
      joint: j,
      moves: moves || children.length > 0,
      drawn: new BabylonMatrix(),
      on: mesh.isEnabled(false),
      frozen: false,
      handed: -1,
      seen: 0,
    };
    this.meshes.push(v);
    this.entryOf.set(j, v);
    this.primed = false;
    mesh.parent = null;
    for (const c of children) this.hang(c, j);
    return j;
  }

  /**
   * The meshes under `j`, as `getChildMeshes` walked them: its own children in
   * the order they were hung, and with `deep`, each one's descendants after it.
   */
  meshesOn(j: Joint | null, deep = false, out: Mesh[] = []): Mesh[] {
    for (const c of this.kids.get(j) ?? []) {
      const mesh = this.meshOf.get(c);
      if (mesh) out.push(mesh);
      if (deep) this.meshesOn(c, true, out);
    }
    return out;
  }

  /** The mesh `j` stands for, or null for a node's joint. */
  meshFor(j: Joint): Mesh | null {
    return this.meshOf.get(j) ?? null;
  }

  /**
   * Takes every mesh hung since the last call off its builder's hands: its
   * channels copied into its joint, a fixed one's local composed once, and its
   * own world composed once (the header: NONUNIFORMSCALING). Run when the
   * builds are done — `ViewModel`'s constructor, and the flash's.
   */
  seal(): void {
    for (; this.sealed < this.meshes.length; this.sealed++) {
      const v = this.meshes[this.sealed];
      const j = v.joint;
      const m = v.mesh;
      j.position.copyFrom(m.position);
      j.rotation.copyFrom(m.rotation);
      j.scaling.copyFrom(m.scaling);
      const q = m.rotationQuaternion;
      if (q) j.quaternion = new Quaternion(q.x, q.y, q.z, q.w);
      if (!v.moves) fixLocal(j);
      m.computeWorldMatrix(true);
    }
  }

  /**
   * Each mesh's own enabled flag, written to its joint chain's — before the
   * cull reads it. A walk from the root that never enters a switched-off
   * subtree: every mesh it reaches is on, and one on after the last pass that
   * it did not reach is switched off.
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
        v.mesh.setEnabled(false);
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
        v.mesh.setEnabled(true);
      }
    }
    const kids = this.kids.get(j);
    if (kids) for (const c of kids) if (c.enabled) this.walkOn(c, next, pass);
  }

  /**
   * The frame's hand-over, immediately before `scene.render`: every mesh the
   * render will take — on and visible — evaluated as Babylon evaluated it, and
   * handed its joint's world whenever that was recomposed since the mesh was
   * last handed over.
   */
  draw(): void {
    this.syncSwitches();
    this.cache.beginEvaluation();
    for (const v of this.onList) {
      if (!v.mesh.isVisible) continue;
      this.cache.evaluate(v.joint);
      const update = v.joint.memo!.childUpdate;
      if (update !== v.handed || !v.frozen) {
        BabylonMatrix.FromArrayToRef(v.joint.world.m, 0, v.drawn);
        v.mesh.freezeWorldMatrix(v.drawn);
        v.handed = update;
        v.frozen = true;
      }
    }
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
