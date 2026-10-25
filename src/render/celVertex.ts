/**
 * render/celVertex.ts — The cel material's VERTEX stage as our renderer
 * declares it: the same body Babylon's `ShaderMaterial` runs (`celVertex`),
 * against explicit bind groups, its attributes PULLED out of storage, so one
 * stage draws the world whole — the blocks and the landform at identity and
 * the scatter at its instances (`BABYLON_EXIT.md` X3.5b, the fold).
 * Owns: `CEL_VERTEX_PROGRAM` — the attributes, the frame block (group 0), the
 * draw's geometry (group 2, `CEL_GEOMETRY`) and the outputs, which are the
 * fragment's `CEL_VARYINGS` — its SCATTER twin, for a group that draws
 * scatter, which reads a scatter vertex through the survivors' list
 * (`CEL_SCATTER_LIST`, `celGeometry`), and `celVertex`, one variant of
 * either as a plain WGSL module; `pulledWorld`, how either reads its vertex
 * and builds `world`, which the depth twin shares (`render/celDepth.ts`);
 * the layout
 * of an instance's transform in `transforms` (`TRANSFORM_WORDS`,
 * `writeTransform`), which the instance cull's records carry the same way.
 * Invariants: declares every name the shared body reads, by Babylon's names
 * because the body reads them by name (`CelShader.ts`'s `celVertexShader`);
 * the attributes are Babylon's, under Babylon's guards — `color` and `uv` in
 * every variant, `uv2` under `CEL_PALETTE` — each read out of its own array
 * in group 2 at the vertex the index names (`scatterList.ts`), and a
 * mesh missing an unguarded one is drawn with it reading zero, as Babylon's
 * empty buffer reads (`render/WorldBlocks.ts`); `world` is a private block
 * `main` writes before the body runs — identity for an index with the
 * scatter bit clear, else the instance's transform out of `transforms`, three
 * columns of the matrix each with that row of its translation in w (the
 * index names a survivor's entry and a corner of its cluster, and the entry
 * the instance, the source index and the part, a corner past the cluster's
 * last repeating it so a short run ends in triangles of no area) — so the
 * body is the same text as Babylon's; a ZERO entry, a slot of the list past
 * what the cull wrote (the plain draw runs to a bound, `InstanceCull`), is
 * drawn as nothing — its corner put outside the clip volume and returned
 * before an attribute is read, which an entry the cull wrote (a cluster of
 * at least one index) never is — in every stage that spreads this decode
 * (the cel stage, `celDepth`, `lampDepth`); the plain stage reads every index as
 * a plain vertex, since a group without scatter binds no list; group 1 is declared
 * EMPTY here and is the fragment's, so the numbers stay the program's.
 * Never: imports Babylon; restates a body.
 * Contract: `docs/rendering.md`, "Hand-written WGSL".
 *
 * WHY GROUP 2 IS THE GEOMETRY. One material draws a group's blocks and its
 * scatter through one pipeline, so what differs between two draws of one
 * recipe — the blocks' layer and the landform's — is the arrays its indices
 * read; and the vertex a scatter index names is not the index itself, so the
 * input assembler cannot fetch it. The arrays
 * are storage, read at the decoded vertex, and the transforms beside them.
 */
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import { CEL_VARYINGS } from "./celFragment";
import { FRAME_BLOCK } from "./frame";
import { scatterListWgsl, sourceIndexWgsl } from "./scatterList";
import {
  assembleVertex,
  type AssembledVertex,
  type Attribute,
  type Binding,
  type StageTarget,
  type VertexProgram,
} from "./wgsl/assemble";

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
 * Group 2's two more for a group that draws scatter: the instance cull's list
 * of survivors' entries and the 16-bit source they index (`scatterList.ts`).
 */
export const CEL_SCATTER_LIST = [
  { kind: "storage", name: "scatterList", type: "array<vec4u>" },
  { kind: "storage", name: "scatterSource", type: "array<u32>" },
] as const satisfies readonly Binding[];

/** Group 2 as a variant built for `stride` binds it: `CEL_GEOMETRY`, and the list's two for the scatter twin. */
export function celGeometry(stride: number | null): readonly Binding[] {
  return stride === null ? CEL_GEOMETRY : [...CEL_GEOMETRY, ...CEL_SCATTER_LIST];
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

/** `main`'s decode in the plain stage: every index is a plain vertex, drawn at identity. */
const PLAIN_DECODE = [
  "  let scattered = false;",
  "  let vertex = vertexIndex;",
  "  let drawnAt = 0u;",
].join("\n");

/**
 * The scatter twin's: whether the index is the scatter's, the vertex it names
 * — through the survivor's entry, the corner's source index clamped to its
 * cluster — and the instance it is drawn at (`drawnAt`, read only when
 * scattered). A zero entry — no cluster, a slot past the cull's count —
 * returns at once, its corner outside the x plane, so it is clipped under
 * either depth convention and costs one read of the list.
 */
const SCATTER_DECODE = [
  "  let scattered = isScatter(vertexIndex);",
  "  var vertex = vertexIndex;",
  "  var drawnAt = 0u;",
  "  if (scattered) {",
  "    let entry = scatterList[listSlot(vertexIndex)];",
  "    if (entry.z == 0u) {",
  "      vertexOutputs.position = vec4f(2.0, 2.0, 2.0, 1.0);",
  "      return vertexOutputs;",
  "    }",
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

/** The cel vertex stage — or with the list's `stride`, its scatter twin — declared for our renderer. */
function celProgram(stride: number | null): VertexProgram {
  return {
    label: stride === null ? "cel-vertex" : "cel-vertex-scatter",
    groups: [[FRAME_BLOCK], [], celGeometry(stride)],
    attributes: CEL_ATTRIBUTES,
    varyings: CEL_VARYINGS,
    includes: WGSL_CHUNKS,
    body: "#include<celVertex>",
    entry: "celVertex",
    ...pulledWorld(stride),
  };
}

/**
 * How a stage over the world's arrays reads its vertex and builds `world` —
 * the plain stage's, or with the list's `stride` the scatter twin's: one
 * statement the cel stage and its depth twin (`render/celDepth.ts`) both
 * spread into their programs, so the two decode an index alike.
 */
export function pulledWorld(stride: number | null): Pick<VertexProgram, "privates" | "declarations" | "pull" | "prelude"> {
  return {
    privates: [{ var: "instance", struct: "CelInstance", fields: [{ name: "world", type: "mat4x4f" }] }],
    declarations: stride === null ? "" : [scatterListWgsl(stride), sourceIndexWgsl("scatterSource")].join("\n"),
    pull: { vertex: "vertex", decode: stride === null ? PLAIN_DECODE : SCATTER_DECODE },
    prelude: CEL_PRELUDE,
  };
}

/** The cel vertex stage, declared for our renderer. */
export const CEL_VERTEX_PROGRAM: VertexProgram = celProgram(null);

/** Its scatter twins, one a stride (there is one: the map's cluster size). */
const scatterPrograms = new Map<number, VertexProgram>();

/**
 * One variant of the cel vertex stage, for a pass of `target`'s kind — the
 * scatter twin when the list's `stride` is given.
 */
export function celVertex(defines: Iterable<string>, target: StageTarget, stride: number | null = null): AssembledVertex {
  if (stride === null) return assembleVertex(CEL_VERTEX_PROGRAM, defines, target);
  let program = scatterPrograms.get(stride);
  if (!program) scatterPrograms.set(stride, (program = celProgram(stride)));
  return assembleVertex(program, defines, target);
}
