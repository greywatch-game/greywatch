/**
 * fades.ts — The four things in the world that FADE as OUR renderer draws
 * them (`BABYLON_EXIT.md` X4.6e): an impact's spark, its dust disc, a blast's
 * scorch and a body's blob shadow — each a `Fade`, one instance of its pool's
 * KIT, blended in the one back-to-front run (`render/FarthestRun.ts`) where
 * Babylon's transparent list drew their meshes until X4.6e.
 * Owns: `FadeKitId` and `FADE_KITS` (the four kits, in the order their pools'
 * meshes were first made: the sparks and the discs by `CombatFx`, the scorch
 * by `BlastDebrisSystem`, the blobs by `ShadowSystem`), `FadeKit` (a kit's
 * arrays and its LOCAL bounding sphere) and `fadeKit`, and `Fade` (one
 * member's node — its transform, its switch and its world as last composed —
 * its `visibility`, the paint it wears and, for a scorch and a blob, the
 * sphere the size gate reads, `gate`, which latches as Babylon's did).
 * Invariants:
 * - **A fade's node is the MESH it replaced, channel for channel**
 *   (`PieceNode`, `composeNode`: `computeWorldMatrix`, bit for bit), and its
 *   `visibility` is the mesh's, which the standard material multiplied into
 *   its alpha last — so a member is drawn while it is `visible` and its
 *   visibility is over 0, as `_evaluateActiveMeshes` drew a mesh.
 * - **Its paint is a SLOT**: 1-based into the emissive table the sparks' and
 *   the discs' colours were handed in (`CombatFx.FADE_COLOURS`), or 0 for the
 *   two that are black (the scorch, the blob), as `getEmissive`'s and the two
 *   black `StandardMaterial`s' `emissiveColor` were.
 * - A kit's local sphere is `BoundingSphere.reConstruct`'s off the extent of
 *   its positions (`extractMinAndMax` from `Number.MAX_VALUE`), as
 *   `pieceKit` measures a segment's.
 * Never: imports Babylon; draws; decides where a fade is.
 * Contract: `docs/rendering.md`, "The pools, ours".
 */
import type { GeometryBuffer } from "../geometry/buffer";
import { Vector3 } from "../math";
import { PieceNode, composeNode, worldSphere } from "./pieces";

/** The four kits, in the order their pools' meshes were made. */
export const FADE_KITS = ["spark", "disc", "scorch", "blob"] as const;

/** A kit's index in `FADE_KITS`. */
export type FadeKitId = 0 | 1 | 2 | 3;

export const SPARK: FadeKitId = 0;
export const DISC: FadeKitId = 1;
export const SCORCH: FadeKitId = 2;
export const BLOB: FadeKitId = 3;

/** One kit: the arrays its meshes were made of, and its local bounding sphere. */
export interface FadeKit {
  readonly geometry: GeometryBuffer;
  readonly centre: Vector3;
  readonly radius: number;
}

/** A kit off the arrays its meshes were made of, its local sphere measured as `pieceKit` measures one. */
export function fadeKit(geometry: GeometryBuffer): FadeKit {
  const pos = geometry.positions;
  const min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  const max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
  for (let k = 0; k < pos.length; k += 3) {
    min.minimizeInPlaceFromFloats(pos[k], pos[k + 1], pos[k + 2]);
    max.maximizeInPlaceFromFloats(pos[k], pos[k + 1], pos[k + 2]);
  }
  return { geometry, centre: max.add(min).scaleInPlace(0.5), radius: Vector3.Distance(min, max) * 0.5 };
}

/** One member of a fading pool: its mesh's channels, its fade, and its paint. */
export class Fade {
  /** Its transform and switch (`visible`, the mesh's `isVisible` and `setEnabled` together), and its world. */
  readonly node = new PieceNode(null);
  /** The mesh's `visibility`: what the alpha is multiplied by last. */
  visibility = 1;
  /** Its paint, a 1-based slot into the emissive table, or 0 for black. */
  slot = 0;
  /**
   * The world sphere Babylon's size gate read off the mesh — a scorch's and
   * a blob's, the two the gate could drop: its bounds as of the last time
   * its world was COMPUTED, which `_evaluateActiveMeshes` did only for a
   * candidate the gate let through (`WorldCulling.offer`), and before that
   * the kit's local sphere under the identity a mesh is built at. So a
   * member first switched on far from where it was last computed is
   * measured from THERE — the world origin, for one never computed — and a
   * drop LATCHES until the eye comes within reach of that stale sphere.
   * Ported exactly (`BABYLON_EXIT.md` X4.6e, its review, the owner's
   * decision of 2026-11-06); `Game.farthestPull` reads and writes it.
   */
  readonly gate = { x: 0, y: 0, z: 0, radius: 0 };

  /** `shape`, the kit's arrays and sphere, seeds `gate` for a gated member: its mesh's bounds as built. */
  constructor(readonly kit: FadeKitId, shape?: FadeKit) {
    if (shape) {
      this.gate.x = shape.centre.x;
      this.gate.y = shape.centre.y;
      this.gate.z = shape.centre.z;
      this.gate.radius = shape.radius;
    }
  }

  /**
   * Its mesh's world COMPUTED as it stands — the node composed and `shape`'s
   * sphere carried into `gate` — where something other than the frame's gate
   * computed it: the warm-up's frame, which drew it gate or no gate
   * (`Game.stageWarmFrame`), and a harness's `scene.isReady()`.
   */
  compute(shape: FadeKit): void {
    composeNode(this.node);
    worldSphere(shape.centre, shape.radius, this.node.world, this.gate);
  }
}
