/**
 * pieces.ts — The things the effect pools put in the WORLD as OUR renderer
 * draws them (`BABYLON_EXIT.md` X4.4b): a tracer streak, a spent case, a
 * thrown frag or bottle, a rocket in flight, a laid mine — each a PIECE, an
 * instance of its KIT — and a bullet mark's kit beside them.
 * Owns: `PieceKit` and `PieceSegment` (a kit's surfaces, each the mesh it was
 * until X4.4b: its arrays, its paint — a cel colour or an unlit one — its
 * LOCAL bounding sphere, its transform as built and the segment it hung
 * from), `PiecePart` (what a model's builder hands over to make one),
 * `pieceKit`, `PieceNode` (one segment's live channels, switch and world),
 * `Piece`, `composePiece`, `worldSphere` (shared with the posed pieces,
 * `systems/poseView.ts`) and `writePieceDrawing`.
 * Invariants:
 * - **A piece's node is the MESH it replaced, channel for channel**: its
 *   local composed from its Euler through a yaw-pitch-roll quaternion — or
 *   its own quaternion while one is set — into a float32 `Matrix`
 *   (`ComposeToRef`), times its parent's world: `TransformNode
 *   .computeWorldMatrix`, bit for bit, as `rigJoints.ts` composes a joint
 *   (`src/math`, `scripts/math-check.mjs`). Parents come before children in
 *   `nodes`, which is the order the meshes were made in, and that order is
 *   also the tie-break of the segments' draw order (`Game.piecePull`).
 * - **A segment is drawn while its node is `visible` and its piece is
 *   `enabled`** — `isVisible` and the subtree's `setEnabled`, which every
 *   pool already wrote — and a CEL segment only while the size gate keeps
 *   its world sphere composed THIS frame (`WorldCulling.keepsSphere`), the
 *   hulls' rule (X4.2b). An UNLIT segment is exempt, as an emissive mesh was
 *   (`WorldCulling`'s `glows`).
 * - **The gate reads the sphere it draws, so no drop can latch.** Babylon's
 *   gate read a mesh's sphere as of the last frame it COMPUTED that mesh's
 *   world, so a case first thrown far from the origin was dropped on its
 *   never-computed sphere and never drawn; X4.4b kept that, and the owner's
 *   decision of 2026-11-01 dropped it on purpose (`docs/rendering.md`, "The
 *   pools, ours").
 * - **A world sphere is `BoundingSphere._update`'s, operation for
 *   operation**: the local centre carried by the world, the radius scaled by
 *   the largest absolute component of the world's (1, 1, 1) normal — and
 *   the local sphere `BoundingSphere.reConstruct`'s, off the extent of the
 *   positions as the mesh was handed them (`extractMinAndMax`).
 * Never: imports Babylon (`src/math` only, and `Part` as a TYPE); draws;
 * decides where a piece is.
 * Contract: `docs/rendering.md`, "The pools, ours".
 */
import type { GeometryBuffer } from "../geometry/buffer";
import { Matrix, Quaternion, Vector3 } from "../math";
import type { Part } from "../world/parts";

/** One surface of a kit: one mesh a pool made of it until `BABYLON_EXIT.md` X4.4b. */
export interface PieceSegment {
  /** As the mesh was named (the first piece's), for a reader that digests a kit by name. */
  readonly name: string;
  readonly geometry: GeometryBuffer;
  /** The cel paint (`CelMaterialFactory.get`'s hex), or null for an unlit segment. */
  readonly cel: string | null;
  /** The unlit paint (`getEmissive`'s hex), or null for a cel segment. */
  readonly unlit: string | null;
  /** Its local bounding sphere: the centre, and the radius. */
  readonly centre: Vector3;
  readonly radius: number;
  /** Its transform as built — what the mesh was dressed with (`parts.ts`' `dress`). */
  readonly position: Vector3;
  readonly rotation: Vector3;
  readonly scaling: Vector3;
  readonly quaternion: Quaternion | null;
  /** The segment it hangs from, earlier in the kit; -1 for a root. */
  readonly parent: number;
}

/** One kind of piece: its segments, in the order the meshes were made. */
export interface PieceKit {
  readonly name: string;
  readonly segments: readonly PieceSegment[];
}

/**
 * Every kit a pool draws in the world, each built ONCE by the view that made
 * the first of its meshes (`CombatFx`'s tracer, `PlayerView`'s case,
 * `GrenadeFx`'s frag and bottle, `AntiTankFx`'s rocket and mine) — so each
 * material is asked of the factory where it always was — and shared with the
 * wire's pools (`net/NetGrenades`, `net/NetOrdnance`), whose pieces are the
 * same objects.
 */
export interface PieceKits {
  readonly tracer: PieceKit;
  readonly casing: PieceKit;
  readonly frag: PieceKit;
  readonly bottle: PieceKit;
  readonly rocket: PieceKit;
  readonly mine: PieceKit;
}

/**
 * One surface as a model's builder hands it over: the part (its arrays, its
 * transform, its material and metadata — what `drawnMesh` made a mesh of),
 * its paint, and the part it hangs from.
 */
export interface PiecePart {
  readonly part: Part;
  readonly cel: string | null;
  readonly unlit: string | null;
  /** Its index in the list it is handed in: an earlier part, or -1. */
  readonly parent: number;
}

/**
 * A kit off a builder's parts, each surface's local bounding sphere measured
 * off its positions (`extractMinAndMax` from `Number.MAX_VALUE`, then
 * `BoundingSphere.reConstruct`). A part must hang from an EARLIER one, and be
 * painted exactly one way.
 */
export function pieceKit(name: string, parts: readonly PiecePart[]): PieceKit {
  // A piece's drawn segments are a bit mask (`writePieceDrawing`).
  if (parts.length > 30) throw new Error(`pieceKit ${name}: ${parts.length} parts, past the 30 a piece may have`);
  const segments = parts.map((p, i): PieceSegment => {
    if (p.parent >= i) throw new Error(`pieceKit ${name}: "${p.part.name}" hangs from a part made after it`);
    if ((p.cel === null) === (p.unlit === null)) {
      throw new Error(`pieceKit ${name}: "${p.part.name}" must be painted cel or unlit, and not both`);
    }
    const pos = p.part.geometry.positions;
    const min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    const max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
    for (let k = 0; k < pos.length; k += 3) {
      min.minimizeInPlaceFromFloats(pos[k], pos[k + 1], pos[k + 2]);
      max.maximizeInPlaceFromFloats(pos[k], pos[k + 1], pos[k + 2]);
    }
    const q = p.part.rotationQuaternion;
    return {
      name: p.part.name,
      geometry: p.part.geometry,
      cel: p.cel,
      unlit: p.unlit,
      centre: max.add(min).scaleInPlace(0.5),
      radius: Vector3.Distance(min, max) * 0.5,
      position: p.part.position.clone(),
      rotation: p.part.rotation.clone(),
      scaling: p.part.scaling.clone(),
      quaternion: q ? new Quaternion(q.x, q.y, q.z, q.w) : null,
      parent: p.parent,
    };
  });
  return { name, segments };
}

/** One segment of a piece: the mesh's channels, its own switch, and its world as last composed. */
export class PieceNode {
  readonly position = new Vector3();
  readonly rotation = new Vector3();
  readonly scaling = new Vector3(1, 1, 1);
  /** The quaternion that overrides `rotation` while set — `rotationQuaternion`. */
  quaternion: Quaternion | null = null;
  /** `isVisible`: drawn while the piece is enabled. */
  visible = false;
  /** Its world, as `composePiece` last left it. */
  readonly world = new Matrix();
  /** This frame's world sphere, which the size gate reads and the draw keeps (`writePieceDrawing`'s scratch). */
  readonly sphere = { x: 0, y: 0, z: 0, radius: 0 };

  constructor(readonly parent: PieceNode | null) {}
}

/** One piece in a pool: its kit, and a node a segment. */
export class Piece {
  /** A node a segment, in the kit's order — parents first. */
  readonly nodes: readonly PieceNode[];
  /** The whole piece on or off — the root's `setEnabled`, which took the subtree. */
  enabled = true;

  constructor(readonly kit: PieceKit) {
    const nodes: PieceNode[] = [];
    for (const s of kit.segments) {
      const n = new PieceNode(s.parent >= 0 ? nodes[s.parent] : null);
      n.position.copyFrom(s.position);
      n.rotation.copyFrom(s.rotation);
      n.scaling.copyFrom(s.scaling);
      if (s.quaternion) n.quaternion = new Quaternion(s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w);
      nodes.push(n);
    }
    this.nodes = nodes;
  }

  /** The root's node: what a pool moves. */
  get root(): PieceNode {
    return this.nodes[0];
  }
}

// Scratch: every drawn piece is composed every frame.
const _q = new Quaternion();
const _local = new Matrix();
const _centre = new Vector3();
const _scale = new Vector3();

/** One node's world off its parent's, which must be current: `computeWorldMatrix`'s arithmetic. */
function composeNode(n: PieceNode): void {
  const q = n.quaternion ?? Quaternion.RotationYawPitchRollToRef(n.rotation.y, n.rotation.x, n.rotation.z, _q);
  Matrix.ComposeToRef(n.scaling, q, n.position, _local);
  if (n.parent) _local.multiplyToRef(n.parent.world, n.world);
  else n.world.copyFrom(_local);
}

/** Every node's world, parents first. */
export function composePiece(p: Piece): void {
  const nodes = p.nodes;
  for (let i = 0; i < nodes.length; i++) composeNode(nodes[i]);
}

/** Whether the size gate keeps a world sphere this frame (`WorldCulling.keepsSphere`). */
export type PieceGate = (x: number, y: number, z: number, radius: number) => boolean;

/**
 * `BoundingSphere._update`: a local sphere (`centre`, `radius`) carried by
 * `world`, into `out` — a kit segment's here, a posed piece's in
 * `systems/poseView.ts`.
 */
export function worldSphere(
  centre: Vector3,
  radius: number,
  world: Matrix,
  out: { x: number; y: number; z: number; radius: number },
): void {
  if (world.isIdentity()) {
    out.x = centre.x;
    out.y = centre.y;
    out.z = centre.z;
    out.radius = radius;
    return;
  }
  Vector3.TransformCoordinatesToRef(centre, world, _centre);
  Vector3.TransformNormalFromFloatsToRef(1.0, 1.0, 1.0, world, _scale);
  out.x = _centre.x;
  out.y = _centre.y;
  out.z = _centre.z;
  out.radius = Math.max(Math.abs(_scale.x), Math.abs(_scale.y), Math.abs(_scale.z)) * radius;
}

/**
 * One piece's drawing, written as an instance of its kit: composed fresh,
 * each segment's world sphere measured, and each segment the gate lets
 * through (a switched-on unlit one, or a switched-on cel one whose world
 * sphere, this frame's, it keeps) drawn — its world into
 * `out` at `at + s * 16`, all zero for one not drawn (or a pad past a
 * narrower kit's last, up to `stride`), and its world sphere into `spheres`
 * at `spheresAt + s * 4` (x, y, z, radius; NaN for one not drawn), which the
 * draw's order and the bloom are measured off. Returns whether any segment
 * is drawn.
 */
export function writePieceDrawing(
  p: Piece,
  out: Float32Array,
  at: number,
  stride: number,
  keeps: PieceGate,
  spheres: Float64Array,
  spheresAt: number,
): boolean {
  composePiece(p);
  const kit = p.kit.segments;
  const nodes = p.nodes;
  for (let s = 0; s < kit.length; s++) worldSphere(kit[s].centre, kit[s].radius, nodes[s].world, nodes[s].sphere);
  let drawn = 0;
  for (let s = 0; s < kit.length; s++) {
    const n = nodes[s];
    if (!p.enabled || !n.visible) continue;
    if (kit[s].unlit === null && !keeps(n.sphere.x, n.sphere.y, n.sphere.z, n.sphere.radius)) continue;
    drawn |= 1 << s;
  }
  for (let s = 0; s < stride; s++) {
    const o = at + s * 16;
    const c = spheresAt + s * 4;
    if (s < kit.length && drawn & (1 << s)) {
      const n = nodes[s];
      out.set(n.world.m, o);
      spheres[c] = n.sphere.x;
      spheres[c + 1] = n.sphere.y;
      spheres[c + 2] = n.sphere.z;
      spheres[c + 3] = n.sphere.radius;
      continue;
    }
    out.fill(0, o, o + 16);
    spheres[c] = spheres[c + 1] = spheres[c + 2] = spheres[c + 3] = Number.NaN;
  }
  return drawn !== 0;
}
