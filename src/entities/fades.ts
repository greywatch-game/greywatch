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
 * its `visibility` and the paint it wears).
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
import { PieceNode } from "./pieces";

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

  constructor(readonly kit: FadeKitId) {}
}
