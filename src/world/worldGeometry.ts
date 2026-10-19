/**
 * worldGeometry.ts — The WORLD's geometry as a record rather than as meshes:
 * `WorldSurface` (one surface of the world — the floor's patches, the rim's
 * runs, and every merged surface: a `Part`, the map block it was filed under,
 * which layout items its vertex ranges came from, whether its positions must
 * stay writable, when its mesh is BORN, whether it is the LANDFORM, and the
 * editor item it joins),
 * `PaneSurfaceGroup` (a glazing surface and the breakable panes that live in
 * it), `SurfaceRecord` and `WorldGeometry` (what `GameMap.world` keeps of a
 * build once its meshes are made — everything but the arrays), and
 * ADMISSION: the one place a builder's parts enter the merge
 * (`admitStructure`, `admitProp`), each minted a birth and filed under its
 * PIECE; and the piece ranges' arithmetic (`concatPieces`, `assertPieces`).
 *
 * **A PIECE is a LAYOUT ITEM** — one per placement (roads included) and one
 * per scatter region, numbered in that order by `MapBuilder` — and its id is
 * an index into `WorldGeometry.pieces`, which says which item it is in the
 * editor's own shape (`EditorRef`). Every admitted part's surface starts as
 * ONE range of its piece covering the whole of it, and every merge carries
 * the ranges through by running vertex and index offsets in member order,
 * the order the merge concatenates in (`concatPieces`, which `merge.ts`'s
 * `mergeSurfaces` wraps around `mergeParts` so the merge itself stays a
 * verbatim copy of Babylon's) — so after the block merge has made a dozen
 * buildings one mesh, which vertices and which triangles are each building's
 * is still written down. Nothing reads it yet: it is what a DESTRUCTIBLE
 * building needs (collapse, hide or re-upload one placement's span of a
 * block), and it costs a few numbers a surface. The floor and the rim carry
 * none — they are not layout items. **Its extension point is a builder-
 * declared SUB-piece** (a `Part.metadata.piece` saying "this wall is its own
 * piece of the cottage"): admission would file such a part under a new id,
 * and nothing downstream of admission would change.
 * Owns: nothing that outlasts a build but the DEV-only set of admitted
 * arrays. No Babylon — the `Part`, `Structure`, `Material` and `EditorItem`
 * it names are TYPES — so the merge and the bake that run on these
 * (`merge.ts`, `vertexShading.ts`) move nothing on the device and the one
 * adapter that does (`worldMeshes` in `parts.ts`) is the only crossing.
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
 * admission. A surface's piece ranges are CONTIGUOUS, in order, and cover
 * every one of its vertices and indices exactly, and no two adjacent ranges
 * name the same piece; on an editor build each surface is ONE range whose
 * piece is its own `editorRef` (`assertPieces`, DEV, every build).
 * Must NOT hold a mesh, read a scene, or let a part in by any other door.
 */
import type { Material } from "@babylonjs/core";
import { GeometryBuffer } from "../geometry/buffer";
import type { Part, PartMetadata } from "./parts";
import type { Structure } from "./kit/core";
import type { EditorItem, EditorRef } from "./mapTypes";

/**
 * A span of a surface's vertices and indices that came from one PIECE — a
 * layout item (`WorldGeometry.pieces`; see the header). Carried through the
 * merge by running offsets, so a placement stays recoverable after the block
 * merge made it one mesh with its neighbours. `indexStart`/`indexCount` count
 * INDICES (three a triangle), and the vertices a range's triangles name are
 * its own vertices: a merge offsets each member's indices by the vertices
 * ahead of it, and turning a mirrored member's winding only reorders a
 * triangle's three.
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
  /**
   * The LANDFORM: the floor's patches (the borderland's included), the rim's
   * runs, and on a shipped build the map-wide road merge — the surfaces that
   * are no block and no scatter, that our renderer draws ahead of rendering
   * group 0's alpha-tested meshes (`BlockHandover`, `WorldBlocks`), and whose
   * reach is none. Marked by the BUILD (`MapBuilder`) where it makes them,
   * never guessed from a name or a missing block. On the RECORD only and
   * never in `part.metadata`, so it reaches no mesh and nothing `merge:hash`
   * fingerprints; an editor build's roads are its items' and not landform.
   */
  landform: boolean;
  /** See `PieceRange`. */
  pieces: PieceRange[];
  /**
   * The position buffer must be uploaded WRITABLE: a pane block holding a
   * breakable pane, which `GlassFx` collapses in place.
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

/**
 * What the map KEEPS of a surface once its mesh is made (`GameMap.world`):
 * its name, its material, its METADATA (the very object its mesh carries —
 * `block`, the exemptions, `sway`, `editorRef`), its block, its piece ranges,
 * whether its positions are writable, and how many vertices and indices it
 * holds — which is the merge's KEY (block, material, sway, exemptions) and
 * everything a piece range is measured against.
 *
 * **Never the vertex ARRAYS.** Those are the device's, in the arrays Babylon
 * keeps for the mesh; holding them here as well would hold the world's
 * geometry twice on the CPU (Greyfen is ~6 M vertices), and nothing reads
 * them back. `worldMeshes` releases each surface's arrays as it uploads them
 * (`releaseArrays`). A renderer of our own that draws a surface takes its
 * arrays on the way past instead (`BuildOptions.onSurface`, just before the
 * release), so they are never kept here either.
 */
export interface SurfaceRecord {
  name: string;
  /**
   * The material the BUILD gave it, and the merge keyed it on. Not
   * necessarily the mesh's for the life of the map: `ReflectionSystem` hands
   * each glazing block a probe material of its own once its cube is baked.
   */
  material: Material | null;
  metadata: PartMetadata | null;
  block: string | null;
  pieces: PieceRange[];
  updatable: boolean;
  vertexCount: number;
  indexCount: number;
}

/**
 * What a build ends in (`GameMap.world`): a record per surface, ALIGNED with
 * `GameMap.visuals` (the floor's patches, the rim, then every merged surface),
 * and what a piece id names. Empty on the authority, which draws nothing.
 */
export interface WorldGeometry {
  surfaces: SurfaceRecord[];
  /** Piece id -> the layout item it is. */
  pieces: EditorRef[];
}

/** A surface's record — see `SurfaceRecord`. Taken BEFORE its arrays are released. */
export function recordOf(surface: WorldSurface): SurfaceRecord {
  const { part } = surface;
  return {
    name: part.name,
    material: part.material,
    metadata: part.metadata,
    block: surface.block,
    pieces: surface.pieces,
    updatable: surface.updatable,
    vertexCount: part.geometry.vertexCount,
    indexCount: part.geometry.indices.length,
  };
}

/**
 * The buffer a part holds once its arrays are on the device: empty, and
 * FROZEN, so a late write through it throws rather than vanishing.
 */
const RELEASED = Object.freeze(new GeometryBuffer({ positions: [], indices: [] }));

/** Drops a part's arrays — see `SurfaceRecord`. */
export function releaseArrays(part: Part): void {
  part.geometry = RELEASED;
}

/** One build's birth counter: each call is the next mesh the scene would have made. */
export type Mint = () => number;

/** A fresh counter, for one build. */
export function mintFrom(start = 0): Mint {
  let next = start;
  return () => next++;
}

/** A surface for `part`, born `born`, filed nowhere yet, of no piece and no landform. */
export function surfaceOf(part: Part, born: number): WorldSurface {
  return { part, block: null, landform: false, pieces: [], updatable: false, born, owner: null };
}

/**
 * A built structure's parts, admitted as `piece`: `meshes` then `paneMeshes`,
 * each minted a birth in that order — the order `MapBuilder` made their part
 * meshes in while the merge still ran on meshes.
 */
export function admitStructure(
  built: Structure,
  piece: number,
  mint: Mint,
): { meshes: WorldSurface[]; panes: WorldSurface[] } {
  const meshes = built.meshes.map((p) => admit(p, piece, mint));
  const panes = built.paneMeshes.map((p) => admit(p, piece, mint));
  return { meshes, panes };
}

/**
 * A scatter prop's parts, already flattened (`flattenParts`) and admitted in
 * that order — the root, then every descendant — as `piece`, its REGION's.
 */
export function admitProp(parts: readonly Part[], piece: number, mint: Mint): WorldSurface[] {
  return parts.map((p) => admit(p, piece, mint));
}

function admit(part: Part, piece: number, mint: Mint): WorldSurface {
  if (part.parent) {
    throw new Error(`admit: "${part.name}" still has a parent — flattenParts first`);
  }
  if (import.meta.env.DEV) refuseShared(part);
  const surface = surfaceOf(part, mint());
  surface.pieces = [
    {
      piece,
      vertexStart: 0,
      vertexCount: part.geometry.vertexCount,
      indexStart: 0,
      indexCount: part.geometry.indices.length,
    },
  ];
  return surface;
}

/**
 * The piece ranges of a merge of `members`, in the order given — which must
 * be the order the merge concatenates them in (`mergeTransformed`: the first
 * member, then each other). Each member's ranges shift by the vertices and
 * indices of every member ahead of it; a range that continues the one before
 * it in the same piece is folded into it. Read off the members' geometry, so
 * call it while they still hold their arrays.
 */
export function concatPieces(members: readonly WorldSurface[]): PieceRange[] {
  const out: PieceRange[] = [];
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const member of members) {
    for (const r of member.pieces) {
      const last = out[out.length - 1];
      if (last && last.piece === r.piece) {
        last.vertexCount += r.vertexCount;
        last.indexCount += r.indexCount;
      } else {
        out.push({
          piece: r.piece,
          vertexStart: r.vertexStart + vertexOffset,
          vertexCount: r.vertexCount,
          indexStart: r.indexStart + indexOffset,
          indexCount: r.indexCount,
        });
      }
    }
    vertexOffset += member.part.geometry.vertexCount;
    indexOffset += member.part.geometry.indices.length;
  }
  return out;
}

/**
 * DEV: the piece ranges of a finished build are what the header promises.
 * The first `unpieced` records (the floor and the rim) carry none; every
 * other one is covered exactly — contiguous from 0, in order, no two adjacent
 * ranges of one piece, every vertex and every index — by ranges whose ids are
 * in the table. On an `editor` build each surface is ONE range, and its piece
 * is the item its `editorRef` names.
 */
export function assertPieces(world: WorldGeometry, unpieced: number, editor: boolean): void {
  const fail = (r: SurfaceRecord, why: string): never => {
    throw new Error(`assertPieces: "${r.name}" ${why}`);
  };
  world.surfaces.forEach((r, i) => {
    if (i < unpieced) {
      if (r.pieces.length > 0) fail(r, "is the floor or the rim and carries a piece");
      return;
    }
    if (r.pieces.length === 0) fail(r, "carries no piece");
    let v = 0;
    let x = 0;
    r.pieces.forEach((p, k) => {
      if (p.vertexStart !== v || p.indexStart !== x) fail(r, `range ${k} does not start where ${k - 1} ended`);
      if (p.vertexCount < 0 || p.indexCount < 0) fail(r, `range ${k} is negative`);
      if (k > 0 && r.pieces[k - 1].piece === p.piece) fail(r, `ranges ${k - 1} and ${k} are one piece`);
      if (!world.pieces[p.piece]) fail(r, `range ${k} names piece ${p.piece}, which is not in the table`);
      v += p.vertexCount;
      x += p.indexCount;
    });
    if (v !== r.vertexCount || x !== r.indexCount) {
      fail(r, `ranges cover ${v}/${x} of ${r.vertexCount} vertices / ${r.indexCount} indices`);
    }
    if (editor) {
      if (r.pieces.length !== 1) fail(r, `is ${r.pieces.length} pieces on an editor build`);
      const ref = r.metadata?.editorRef as EditorRef | undefined;
      const piece = world.pieces[r.pieces[0].piece];
      if (!ref || ref.list !== piece.list || ref.index !== piece.index) {
        fail(r, `is piece ${JSON.stringify(piece)} but its editorRef is ${JSON.stringify(ref)}`);
      }
    }
  });
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
