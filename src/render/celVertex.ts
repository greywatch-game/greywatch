/**
 * render/celVertex.ts — The cel material's VERTEX stage as our renderer
 * declares it: the same body Babylon's `ShaderMaterial` runs (`celVertex`),
 * against explicit bind groups, its attributes PULLED out of storage, so one
 * stage draws the world's whole stream — the blocks and the landform at
 * identity and the scatter at its instances (`BABYLON_EXIT.md` X3.5b, the
 * fold).
 * Owns: `CEL_VERTEX_PROGRAM` — the attributes, the frame block (group 0), the
 * draw's geometry (group 2, `CEL_GEOMETRY`) and the outputs, which are the
 * fragment's `CEL_VARYINGS` — its `?scatterlist` twin, which reads a scatter
 * vertex through the survivors' list (`CEL_SCATTER_LIST`, `celGeometry`),
 * and `celVertex`, one variant of either as a plain WGSL module; the layout
 * of an instance's transform in `transforms` (`TRANSFORM_WORDS`,
 * `writeTransform`), which the instance cull's records carry the same way.
 * Invariants: declares every name the shared body reads, by Babylon's names
 * because the body reads them by name (`CelShader.ts`'s `celVertexShader`);
 * the attributes are Babylon's, under Babylon's guards — `color` and `uv` in
 * every variant, `uv2` under `CEL_PALETTE` — each read out of its own array
 * in group 2 at the vertex the stream index names (`streamIndex.ts`), and a
 * mesh missing an unguarded one is drawn with it reading zero, as Babylon's
 * empty buffer reads (`render/WorldBlocks.ts`); `world` is a private block
 * `main` writes before the body runs — identity for an index with the
 * scatter bit clear, else the instance's transform out of `transforms`, three
 * columns of the matrix each with that row of its translation in w (in list
 * mode the index names a survivor's entry and a corner of its cluster, and
 * the entry the instance, the source index and the part, a corner past the
 * cluster's last repeating it so a short run ends in triangles of no
 * area) — so the body is the same text as Babylon's; group 1 is declared
 * EMPTY here and is the fragment's, so the numbers stay the program's.
 * Never: imports Babylon; restates a body.
 * Contract: `docs/rendering.md`, "Hand-written WGSL".
 *
 * WHY GROUP 2 IS THE GEOMETRY. One material draws a group's whole stream,
 * blocks and scatter at once, so what differs between two draws of one
 * recipe — the blocks' layer and the landform's — is the arrays the stream
 * indexes; and the vertex an index names is not the index itself once it
 * carries an instance, so the input assembler cannot fetch it. The arrays
 * are storage, read at the decoded vertex, and the transforms beside them.
 */
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import { CEL_VARYINGS } from "./celFragment";
import { FRAME_BLOCK } from "./frame";
import { scatterListWgsl, STREAM_INDEX_WGSL } from "./streamIndex";
import {
  assembleVertex,
  type AssembledVertex,
  type Attribute,
  type Binding,
  type StageTarget,
  type VertexProgram,
} from "./wgsl/assemble";
import { sourceIndexWgsl } from "./wgsl/instanceCull";

/** Group 2 of the cel program: every attribute's array, then the instances' transforms. */
export const CEL_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "normalData", type: "array<f32>" },
  { kind: "storage", name: "colorData", type: "array<vec4f>" },
  { kind: "storage", name: "uvData", type: "array<vec2f>" },
  { kind: "storage", name: "uv2Data", type: "array<vec2f>", when: ["CEL_PALETTE"] },
  { kind: "storage", name: "transforms", type: "array<vec4f>" },
] as const satisfies readonly Binding[];

/**
 * Group 2's two more in list mode (`?scatterlist`): the instance cull's list
 * of survivors' entries (`streamIndex.ts`'s `LIST_WORDS`) and the 16-bit
 * source they index (`wgsl/instanceCull.ts`).
 */
export const CEL_SCATTER_LIST = [
  { kind: "storage", name: "scatterList", type: "array<vec4u>" },
  { kind: "storage", name: "scatterSource", type: "array<u32>" },
] as const satisfies readonly Binding[];

/** Group 2 as a variant built for `listStride` binds it: `CEL_GEOMETRY`, and the list's two in list mode. */
export function celGeometry(listStride: number | null): readonly Binding[] {
  return listStride === null ? CEL_GEOMETRY : [...CEL_GEOMETRY, ...CEL_SCATTER_LIST];
}

const CEL_ATTRIBUTES: readonly Attribute[] = [
  { name: "position", type: "vec3f", from: "positionData" },
  { name: "normal", type: "vec3f", from: "normalData" },
  { name: "color", type: "vec4f", from: "colorData" },
  { name: "uv", type: "vec2f", from: "uvData" },
  { name: "uv2", type: "vec2f", when: ["CEL_PALETTE"], from: "uv2Data" },
];

/** One instance's transform in `transforms`, in 32-bit words: three `vec4f` columns. */
export const TRANSFORM_WORDS = 12;

/**
 * A world matrix laid out as WGSL's `mat4x4f` reads it (`m`, 16 floats) as
 * a transform: each of its first three columns, with that row of its
 * translation in w — into `out[at..at + TRANSFORM_WORDS)`. The last row of
 * a placement's matrix is (0, 0, 0, 1), so nothing is lost.
 */
export function writeTransform(m: ArrayLike<number>, out: Float32Array, at: number): void {
  for (let c = 0; c < 3; c++) {
    out[at + c * 4] = m[c * 4];
    out[at + c * 4 + 1] = m[c * 4 + 1];
    out[at + c * 4 + 2] = m[c * 4 + 2];
    out[at + c * 4 + 3] = m[12 + c];
  }
}

/**
 * `main`'s decode: whether the index is the scatter's, the vertex it names
 * and the instance it is drawn at (`drawnAt`, read only when scattered).
 */
const STREAM_DECODE = [
  "  let scattered = isScatter(vertexIndex);",
  "  let vertex = select(vertexIndex, scatterVertex(vertexIndex), scattered);",
  "  let drawnAt = scatterInstance(vertexIndex);",
].join("\n");

/** The same out of the list: the survivor's entry, and the corner's source index clamped to its cluster. */
const LIST_DECODE = [
  "  let scattered = isScatter(vertexIndex);",
  "  var vertex = vertexIndex;",
  "  var drawnAt = 0u;",
  "  if (scattered) {",
  "    let entry = scatterList[listSlot(vertexIndex)];",
  "    vertex = entry.w + sourceIndex(entry.y + min(listCorner(vertexIndex), entry.z - 1u));",
  "    drawnAt = entry.x;",
  "  }",
].join("\n");

/** `main`'s prelude: `world`, identity or the instance's transform. */
const CEL_PRELUDE = [
  "  instance.world = mat4x4f(",
  "    vec4f(1.0, 0.0, 0.0, 0.0), vec4f(0.0, 1.0, 0.0, 0.0), vec4f(0.0, 0.0, 1.0, 0.0), vec4f(0.0, 0.0, 0.0, 1.0));",
  "  if (scattered) {",
  `    let t = drawnAt * ${TRANSFORM_WORDS / 4}u;`,
  "    let w0 = transforms[t];",
  "    let w1 = transforms[t + 1u];",
  "    let w2 = transforms[t + 2u];",
  "    instance.world = mat4x4f(",
  "      vec4f(w0.xyz, 0.0), vec4f(w1.xyz, 0.0), vec4f(w2.xyz, 0.0), vec4f(w0.w, w1.w, w2.w, 1.0));",
  "  }",
].join("\n");

/** The cel vertex stage — or with `listStride`, its list-mode twin — declared for our renderer. */
function celProgram(listStride: number | null): VertexProgram {
  const list = listStride !== null;
  return {
    label: list ? "cel-vertex-list" : "cel-vertex",
    groups: [[FRAME_BLOCK], [], celGeometry(listStride)],
    attributes: CEL_ATTRIBUTES,
    varyings: CEL_VARYINGS,
    includes: WGSL_CHUNKS,
    body: "#include<celVertex>",
    entry: "celVertex",
    privates: [{ var: "instance", struct: "CelInstance", fields: [{ name: "world", type: "mat4x4f" }] }],
    declarations: list
      ? [STREAM_INDEX_WGSL, scatterListWgsl(listStride), sourceIndexWgsl("scatterSource")].join("\n")
      : STREAM_INDEX_WGSL,
    pull: { vertex: "vertex", decode: list ? LIST_DECODE : STREAM_DECODE },
    prelude: CEL_PRELUDE,
  };
}

/** The cel vertex stage, declared for our renderer. */
export const CEL_VERTEX_PROGRAM: VertexProgram = celProgram(null);

/** Its list-mode twins, one a stride (there is one: the map's cluster size). */
const listPrograms = new Map<number, VertexProgram>();

/**
 * One variant of the cel vertex stage, for a pass of `target`'s kind — the
 * list-mode twin when `listStride` is given (`?scatterlist`).
 */
export function celVertex(defines: Iterable<string>, target: StageTarget, listStride: number | null = null): AssembledVertex {
  if (listStride === null) return assembleVertex(CEL_VERTEX_PROGRAM, defines, target);
  let program = listPrograms.get(listStride);
  if (!program) listPrograms.set(listStride, (program = celProgram(listStride)));
  return assembleVertex(program, defines, target);
}
