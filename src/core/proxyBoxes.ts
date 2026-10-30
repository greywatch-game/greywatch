/**
 * proxyBoxes.ts — what a SOLDIER and a HULL are to a shadow: boxes, as
 * unit-box-to-world matrices packed into an instance buffer.
 * Owns the bone table composed into matrices and the per-kind hull scales;
 * owns no mesh, no generator and no buffer, and never renders anything.
 * Invariants: a soldier is `RAGDOLL_BONES` and a hull is its collider box
 * padded by `CONFIG.graphics.bodyShadows.hullPad` — whichever map draws them;
 * a hull's box is composed off the HULL's own fields (`pos`, `yaw`,
 * `present`; `entities/hullFrame.ts`' `hullBodyToRef`), never off a mesh, so
 * nothing about how a hull is DRAWN reaches its shadow (`BABYLON_EXIT.md`
 * X4.1c); every matrix is composed FRESH, in `src/math`'s copies of Babylon's
 * arithmetic, the bits Babylon's own composition gave.
 * Never: imports Babylon (`scripts/check-babylon-free.mjs` holds it as a root;
 * the bone table is `entities/soldierBones.ts`', not the rig's); reads a node
 * or a mesh.
 *
 * **Two shadow systems draw bodies, and this is the shape they share**:
 * `BodyShadows` for the moon and `LocalShadows` for the lamps. It is in
 * `core/` for `core/shadowWindow.ts`'s reason — both callers are systems, and a
 * system reaching into another system is the thing `Game`'s wiring exists to
 * prevent. Two copies of it drifting is a soldier throwing one silhouette under
 * the moon and another under a lantern.
 *
 * `BodyShadows`' header argues why a body is its ragdoll boxes and a hull its
 * collider, and none of that argument is restated here.
 */
import { CONFIG } from "../config";
import { hullBodyToRef } from "../entities/hullFrame";
import type { SoldierRig } from "../entities/SoldierModel";
import { RAGDOLL_BONES } from "../entities/soldierBones";
import type { Joint } from "../entities/rigJoints";
import { Matrix, Quaternion, Vector3, type Vector3Like, type Vector3Ref } from "../math";

/**
 * What a shadow needs of a soldier: a rig to read joints off. A body off the
 * wire (`NetSoldier`) satisfies it — a `Bot` itself has no rig.
 */
export interface ShadowBody {
  readonly rig: SoldierRig;
}

/**
 * What a shadow needs of a vehicle: where its collider box stands, how it is
 * turned, whether it is on the field, and the box's size. `Vehicle` satisfies
 * it structurally — its own fields, the ones every ray and sweep reads — so a
 * hull's shadow is its collider and never its drawing. See `BodyShadows` for
 * why the COLLIDER rather than the drawn rig.
 */
export interface ShadowHull {
  /** The collider box's CENTRE. */
  readonly pos: Vector3Like;
  readonly yaw: number;
  /** On the field at all (`Vehicle.present`): a hull that is not casts nothing. */
  readonly present: boolean;
  readonly spec: {
    readonly hull: {
      readonly length: number;
      readonly width: number;
      readonly height: number;
    };
  };
}

export class ProxyBoxes {
  /** Instances one soldier costs. */
  readonly perBody = RAGDOLL_BONES.length;
  /**
   * `RAGDOLL_BONES` as "unit box -> this bone's box in its joint's frame",
   * composed once because none of it varies — in `src/math`, the rig's
   * joints' own (Babylon's bits; `rigJoints.ts`).
   */
  private readonly boneLocal: Matrix[] = RAGDOLL_BONES.map((b) =>
    Matrix.Compose(
      new Vector3(b.size[0], b.size[1], b.size[2]),
      Quaternion.Identity(),
      new Vector3(b.center[0], b.center[1], b.center[2]),
    ),
  );
  /** The joint each entry of `boneLocal` hangs off, by rig field name. */
  private readonly boneJoint = RAGDOLL_BONES.map((b) => b.joint);
  /** Hull scales, one per kind met, keyed on the spec's own box. */
  private readonly hullLocal = new Map<ShadowHull["spec"]["hull"], Matrix>();
  private readonly scratch = new Matrix();
  private readonly hullFrame = new Matrix();

  /**
   * One rig's boxes, each at its joint's current world transform, written at
   * instance `at` of `out`. Returns how many it wrote (`perBody`).
   *
   * The rig is composed FRESH first (`JointTree.compute`), so these are THIS
   * frame's poses, including for a body off screen whose meshes nothing will
   * draw.
   */
  writeRig(rig: SoldierRig, out: Float32Array, at: number): number {
    rig.tree.compute();
    for (let i = 0; i < this.boneLocal.length; i++) {
      const joint: Joint = rig[this.boneJoint[i]];
      this.boneLocal[i].multiplyToRef(joint.world, this.scratch);
      this.scratch.copyToArray(out, (at + i) * 16);
    }
    return this.boneLocal.length;
  }

  /**
   * One hull's box at instance `at` of `out`: its kind's scale times the
   * collider's frame, composed off the hull's own fields (`hullBodyToRef`) —
   * the matrix the body node the rig hangs off composed, never read off it.
   */
  writeHull(hull: ShadowHull, out: Float32Array, at: number): void {
    const p = hull.pos;
    hullBodyToRef(p.x, p.y, p.z, hull.yaw, this.hullFrame);
    this.hullBox(hull).multiplyToRef(this.hullFrame, this.scratch);
    this.scratch.copyToArray(out, at * 16);
  }

  /**
   * Where `hull`'s box stands, into `out`: the collider's frame's translation
   * row, which `ComposeToRef` writes as each coordinate of `pos` rounded to
   * float32 — so this is that rounding, and no compose.
   */
  hullCentreToRef<T extends Vector3Ref>(hull: ShadowHull, out: T): T {
    const p = hull.pos;
    out.set(Math.fround(p.x), Math.fround(p.y), Math.fround(p.z));
    return out;
  }

  /**
   * The unit-box-to-hull scale for one kind, cached on the kind's own `hull`
   * block — the kind's identity, without this having to ask which kind it is
   * holding, and without a string key minted per hull per frame, which is
   * what keying on the dimensions cost (both shadow maps ask every frame).
   */
  private hullBox(hull: ShadowHull): Matrix {
    const h = hull.spec.hull;
    let m = this.hullLocal.get(h);
    if (!m) {
      const pad = CONFIG.graphics.bodyShadows.hullPad;
      m = Matrix.Compose(
        new Vector3(h.width + pad, h.height + pad, h.length + pad),
        Quaternion.Identity(),
        Vector3.Zero(),
      );
      this.hullLocal.set(h, m);
    }
    return m;
  }
}
