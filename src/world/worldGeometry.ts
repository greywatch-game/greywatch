/**
 * worldGeometry.ts — The WORLD's geometry as a record rather than as meshes:
 * `WorldSurface` (one merged surface — a `Part`, the map block it was filed
 * under, which layout items its vertex ranges came from, whether its
 * positions must stay writable, when its mesh is BORN, and the editor item it
 * joins), `PaneSurfaceGroup` (a glazing surface and the breakable panes that
 * live in it), `WorldGeometry` (the list a build ends in), and ADMISSION: the
 * one place a builder's parts enter the merge (`admitStructure`,
 * `admitProp`), each minted a birth.
 * Owns: nothing that outlasts a build but the DEV-only set of admitted
 * arrays. No Babylon — the `Part`, `Structure` and `EditorItem` it names are
 * TYPES — so the merge that runs on these (`merge.ts`) moves nothing on the
 * device and the one adapter that does (`worldMeshes` in `parts.ts`) is the
 * only crossing.
 * Invariants: `born` is the SCENE ORDER the surface's mesh must be created in
 * — the order Babylon made it when the merge still ran on meshes — and it is
 * minted from ONE counter per build, at the points Babylon used to create a
 * mesh: every admitted part (a structure's `meshes` then its `paneMeshes`, a
 * prop's parts in `flattenParts` order) and every merge of two or more. A
 * merge of ONE keeps its member's birth, because it keeps its member. No two
 * surfaces a build hands the adapter share a birth (`worldMeshes` asserts it
 * in DEV). An admitted part's buffer and arrays belong to that part ALONE:
 * the merge bakes a lone part's transform into its own arrays IN PLACE, so a
 * buffer two parts shared would be moved twice, silently — DEV refuses one at
 * admission.
 * Must NOT hold a mesh, read a scene, or let a part in by any other door.
 */
import type { Part } from "./parts";
import type { Structure } from "./kit/core";
import type { EditorItem, EditorRef } from "./mapTypes";

/**
 * A span of a surface's vertices and indices that came from one PIECE — a
 * layout item (`WorldGeometry.pieces`). Carried through the merge by running
 * offsets, so a placement stays recoverable after the block merge made it one
 * mesh with its neighbours. Empty until the piece ids land (BABYLON_EXIT.md
 * X1.4); the field is here so nothing that builds a surface has to change
 * when they do.
 */
export interface PieceRange {
  piece: number;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
}

/**
 * One merged world surface: what becomes ONE mesh in `GameMap.visuals`.
 *
 * `part` carries the geometry, the transform (identity once block-merged; a
 * placement's own on an editor build and on a pane block of one), the
 * material, and the METADATA — the contract `CLAUDE.md` names (`block`,
 * `noShadowCaster`, `noGlow`, `noInk`, `sway`, `editorRef`), which the adapter
 * hands the mesh unchanged and by identity.
 */
export interface WorldSurface {
  part: Part;
  /** Mirrors `part.metadata.block`; null on roads, the editor's surfaces, and anything not block-merged. */
  block: string | null;
  /** See `PieceRange`. */
  pieces: PieceRange[];
  /**
   * The position buffer must be uploaded WRITABLE: a pane block holding a
   * breakable pane, which `GlassSystem` collapses in place.
   */
  updatable: boolean;
  /** Where its mesh stands in the scene's creation order. See the header. */
  born: number;
  /** The editor item whose `visuals` its mesh joins; null on a shipped build. */
  owner: EditorItem | null;
}

/**
 * A glazing surface and the breakable panes whose vertex ranges live in it —
 * `PaneGroup` before its surface is a mesh. `panes` index `GameMap.panes`.
 */
export interface PaneSurfaceGroup {
  surface: WorldSurface;
  panes: number[];
  /** The block it was filed under; "" until `PaneBlocks.finish` decides. */
  block: string;
}

/** What a build's merges end in: every surface in `visuals` order, and what a piece id names. */
export interface WorldGeometry {
  surfaces: WorldSurface[];
  /** Piece id -> the layout item it is. */
  pieces: EditorRef[];
}

/** One build's birth counter: each call is the next mesh the scene would have made. */
export type Mint = () => number;

/** A fresh counter, for one build. */
export function mintFrom(start = 0): Mint {
  let next = start;
  return () => next++;
}

/** A surface for `part`, born `born`, filed nowhere yet. */
export function surfaceOf(part: Part, born: number): WorldSurface {
  return { part, block: null, pieces: [], updatable: false, born, owner: null };
}

/**
 * A built structure's parts, admitted: `meshes` then `paneMeshes`, each
 * minted a birth in that order — the order `structureMeshes` made their part
 * meshes in.
 */
export function admitStructure(
  built: Structure,
  mint: Mint,
): { meshes: WorldSurface[]; panes: WorldSurface[] } {
  const meshes = built.meshes.map((p) => admit(p, mint));
  const panes = built.paneMeshes.map((p) => admit(p, mint));
  return { meshes, panes };
}

/**
 * A scatter prop's parts, already flattened (`flattenParts`) and admitted in
 * that order — the root, then every descendant.
 */
export function admitProp(parts: readonly Part[], mint: Mint): WorldSurface[] {
  return parts.map((p) => admit(p, mint));
}

function admit(part: Part, mint: Mint): WorldSurface {
  if (part.parent) {
    throw new Error(`admit: "${part.name}" still has a parent — flattenParts first`);
  }
  if (import.meta.env.DEV) refuseShared(part);
  return surfaceOf(part, mint());
}

/**
 * Every buffer and array admitted since the page loaded, in DEV — so a
 * builder that hands two parts one array, or keeps one across builds (a
 * memoised shape), is refused where it enters rather than found as a wall
 * moved twice.
 */
let admitted: WeakSet<object> | null = null;

function refuseShared(part: Part): void {
  admitted ??= new WeakSet();
  const g = part.geometry;
  const owned: [string, object | null][] = [
    ["buffer", g],
    ["positions", g.positions],
    ["normals", g.normals],
    ["uvs", g.uvs],
    ["uvs2", g.uvs2],
    ["colors", g.colors],
    ["indices", g.indices],
  ];
  for (const [what, o] of owned) {
    if (!o) continue;
    if (admitted.has(o)) {
      throw new Error(
        `admit: "${part.name}" shares its ${what} with a part admitted before it — ` +
          `the merge bakes a lone part in place, so give it its own (GeometryBuffer.clone)`,
      );
    }
    admitted.add(o);
  }
}
