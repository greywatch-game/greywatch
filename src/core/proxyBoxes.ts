/**
 * proxyBoxes.ts — what a SOLDIER and a HULL are to a shadow: boxes, as
 * unit-box-to-world matrices packed into a thin-instance buffer.
 * Owns the bone table composed into matrices and the per-kind hull scales;
 * owns no mesh, no generator and no buffer, and never renders anything.
 * Invariants: a soldier is `RAGDOLL_BONES` and a hull is its collider box
 * padded by `CONFIG.graphics.bodyShadows.hullPad` — whichever map draws them.
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
import { Matrix, Quaternion, Vector3, type Mesh } from "@babylonjs/core";
import { CONFIG } from "../config";
import { RAGDOLL_BONES, type SoldierRig } from "../entities/SoldierModel";

/** What a shadow needs of a soldier: a rig to read joints off. `Bot` satisfies it. */
export interface ShadowBody {
  readonly rig: SoldierRig;
}

/**
 * What a shadow needs of a vehicle: its collider box and that box's size.
 * `Vehicle` satisfies this structurally. See `BodyShadows` for why the
 * COLLIDER rather than the drawn rig.
 */
export interface ShadowHull {
  readonly body: Mesh;
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
   * composed once because none of it varies.
   */
  private readonly boneLocal: Matrix[] = RAGDOLL_BONES.map((b) =>
    Matrix.Compose(
      new Vector3(b.size[0], b.size[1], b.size[2]),
      Quaternion.Identity(),
      new Vector3(b.center[0], b.center[1], b.center[2]),
    ),
  );
  /** The joint each entry of `boneLocal` hangs off, by rig field name. */
  private readonly boneJoint = RAGDOLL_BONES.map((b) => b.joint as keyof SoldierRig);
  /** Hull scales, one per kind met, keyed on the spec's own box. */
  private readonly hullLocal = new Map<ShadowHull["spec"]["hull"], Matrix>();
  private readonly scratch = Matrix.Identity();

  /**
   * One rig's boxes, each at its joint's current world transform, written at
   * instance `at` of `out`. Returns how many it wrote (`perBody`).
   *
   * `getWorldMatrix` recomputes when the node's render id is stale, which on
   * the frame this is called it always is — so these are THIS frame's poses,
   * including for a body off screen whose meshes the render walk will never
   * activate.
   */
  writeRig(rig: SoldierRig, out: Float32Array, at: number): number {
    for (let i = 0; i < this.boneLocal.length; i++) {
      const joint = rig[this.boneJoint[i]] as { getWorldMatrix(): Matrix };
      this.boneLocal[i].multiplyToRef(joint.getWorldMatrix(), this.scratch);
      this.scratch.copyToArray(out, (at + i) * 16);
    }
    return this.boneLocal.length;
  }

  /** One hull's box at instance `at` of `out`. */
  writeHull(hull: ShadowHull, out: Float32Array, at: number): void {
    this.hullBox(hull).multiplyToRef(hull.body.getWorldMatrix(), this.scratch);
    this.scratch.copyToArray(out, at * 16);
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
