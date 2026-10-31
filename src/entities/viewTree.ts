/**
 * viewTree.ts — the player's own viewmodel as JOINTS (`BABYLON_EXIT.md`
 * X4.3b): the tree every rig, optic, arm, fist and flash hangs from, the meshes
 * Babylon still draws off it, and the render cache its readers answer from.
 * Owns: `ViewTree` — the `JointTree` (`rigJoints.ts`), whose root stands for
 * the CAMERA; every viewmodel mesh and the joint it is drawn at (`ViewMesh`);
 * the order each joint's children were hung in (what `getChildMeshes` walked);
 * and the per-frame hand-over to Babylon (`syncSwitches`, `draw`).
 * Invariants:
 * - **The joint list is the node list, in the order the nodes were made**:
 *   every `TransformNode` the viewmodel used to make is a joint made at the
 *   same moment (`joint`), so a reader that digests the tree by order —
 *   `kit:hash --models`, the oracle — reads the same sequence. A MESH is a
 *   joint too (`hang`): a leaf whose local is the mesh's own, composed once at
 *   `seal` — or, for a mesh other meshes hang off (the fist's grenade, the
 *   bottle's neck and cloth) or one whose own transform moves (the kit card),
 *   a joint whose channels the mesh's were copied into at `seal` and which is
 *   written from then on.
 * - **Babylon draws every mesh and none has a parent**: `draw`, once a frame
 *   in every state immediately before `scene.render` (`Game.tick`), hands each
 *   switched-on, visible mesh its joint's world through `freezeWorldMatrix`,
 *   exactly the set `_evaluateActiveMeshes` took off `WorldCulling`'s list
 *   (on and visible) — and evaluates each through the `RenderCache` as that
 *   walk computed it, so the stamps Babylon's own evaluation left are the
 *   ones the next frame's readers meet. Each mesh's own enabled flag is its
 *   joint chain's, written by `syncSwitches` before the CULL reads it (an
 *   unparented mesh's `isEnabled()` sees no ancestor) and again by `draw`.
 * - **The readers answer Babylon's answers** (`read`, `world`): the render-id
 *   cache, never a fresh compose — two of them are command inputs. See
 *   `RenderCache`.
 * - Nothing is composed at build: until the first `draw` every mesh's own
 *   flags and channels are what its builder left, which is what `kit:hash`
 *   records.
 * Never: parent a mesh, hand Babylon a joint it did not compose this frame,
 * or read a node's matrix (the camera's world is read through the root).
 */
import { Matrix as BabylonMatrix, type Mesh, type Scene } from "@babylonjs/core";
import { Quaternion } from "../math";
import { fixLocal, Joint, JointTree, RenderCache } from "./rigJoints";

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
}

/** What the root reads: anything with a world matrix (the camera, or a stand-in). */
export interface ViewCamera {
  readonly name: string;
  getWorldMatrix(): { readonly m: ArrayLike<number> };
}

/** Whether a joint and every ancestor are switched on — what `isEnabled()` walked. */
function chainOn(j: Joint): boolean {
  for (let at: Joint | null = j; at; at = at.parent) if (!at.enabled) return false;
  return true;
}

export class ViewTree {
  readonly joints = new JointTree();
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
  /** Each joint's children, in the order they were hung from it (null: the top level). */
  private readonly kids = new Map<Joint | null, Joint[]>();
  private sealed = 0;

  constructor(
    scene: Scene,
    readonly camera: ViewCamera | null,
  ) {
    this.cache = new RenderCache(() => scene.getRenderId());
    if (camera) {
      const root = this.joints.add(camera.name, null);
      root.outside = () => camera.getWorldMatrix();
      this.root = root;
    } else {
      this.root = null;
    }
    // Inside the render, once Babylon has moved the id it evaluated at.
    scene.onAfterActiveMeshesEvaluationObservable.add(() => {
      this.cache.settle(scene.getRenderId());
    });
  }

  /** A joint where a `TransformNode` used to be made, hung from `parent` (none: a top-level joint). */
  joint(name: string, parent: Joint | null): Joint {
    const j = this.joints.add(name, parent);
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
    const j = this.joints.add(mesh.name, on);
    this.childOf(on, j);
    this.meshOf.set(j, mesh);
    // A mesh switched off by its builder (the kit card) is switched by its
    // joint from now on.
    j.enabled = mesh.isEnabled(false);
    this.meshes.push({
      mesh,
      joint: j,
      moves: moves || children.length > 0,
      drawn: new BabylonMatrix(),
      on: mesh.isEnabled(false),
      frozen: false,
    });
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
   * channels copied into its joint, and a fixed one's local composed once.
   * Run when the builds are done — `ViewModel`'s constructor, and the flash's.
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
    }
  }

  /** Each mesh's own enabled flag, written to its joint chain's — before the cull reads it. */
  syncSwitches(): void {
    for (const v of this.meshes) {
      const on = chainOn(v.joint);
      if (on !== v.on) {
        v.on = on;
        v.mesh.setEnabled(on);
      }
    }
  }

  /**
   * The frame's hand-over, immediately before `scene.render`: every mesh the
   * render will take — on and visible — evaluated as Babylon evaluated it, and
   * handed the world that answered.
   */
  draw(): void {
    this.syncSwitches();
    this.cache.beginEvaluation();
    for (const v of this.meshes) {
      if (!v.on || !v.mesh.isVisible) continue;
      if (this.cache.evaluate(v.joint) || !v.frozen) {
        BabylonMatrix.FromArrayToRef(v.joint.world.m, 0, v.drawn);
        v.mesh.freezeWorldMatrix(v.drawn);
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

  private childOf(parent: Joint | null, child: Joint): void {
    const list = this.kids.get(parent);
    if (list) list.push(child);
    else this.kids.set(parent, [child]);
  }
}
