/**
 * render/celVertex.ts — The cel material's VERTEX stage as our renderer
 * declares it: the same body Babylon's `ShaderMaterial` runs (`celVertex`),
 * against explicit bind groups and vertex buffers — once for a surface drawn
 * at one `world` (the blocks) and once for a surface drawn as INSTANCES (the
 * scatter, `BABYLON_EXIT.md` X3.4b).
 * Owns: `CEL_VERTEX_PROGRAM` — the attributes, the frame block (group 0), the
 * draw's `world` (group 2) and the outputs, which are the fragment's
 * `CEL_VARYINGS` — and `celVertex`, one variant of it as a plain WGSL module;
 * `CEL_INSTANCED_VERTEX_PROGRAM` and `celInstancedVertex`, the same with
 * `world` read per instance; and `bufferLayouts`, the vertex buffers an
 * assembled stage is drawn with.
 * Invariants: declares every name the shared body reads, by Babylon's names
 * because the body reads them by name (`CelShader.ts`'s `celVertexShader`);
 * the attributes are Babylon's, under Babylon's guards — `color` and `uv` in
 * every variant, `uv2` under `CEL_PALETTE` — and a mesh missing an
 * unguarded one is drawn with it reading zero, as Babylon's empty buffer
 * reads (`render/WorldBlocks.ts`); group 1 is declared EMPTY here and is the
 * fragment's, so the numbers stay the program's; the instanced program is the
 * plain one with `world` moved from group 2 into a private block its `main`
 * builds from three per-instance columns (`world0..2`, each a column of the
 * matrix with that row of its translation in w — `InstanceCull`'s
 * `placed`), so the body is the same text on both; a vertex attribute is a
 * buffer of its own and every instance attribute shares ONE buffer, packed in
 * list order.
 * Never: imports Babylon; restates a body.
 * Contract: `docs/rendering.md`, "Hand-written WGSL".
 */
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import { CEL_VARYINGS } from "./celFragment";
import { CEL_MESH_BLOCK } from "./celMaterial";
import { FRAME_BLOCK } from "./frame";
import {
  assembleVertex,
  type AssembledVertex,
  type Attribute,
  type StageTarget,
  type VertexProgram,
} from "./wgsl/assemble";

const CEL_ATTRIBUTES: readonly Attribute[] = [
  { name: "position", type: "vec3f" },
  { name: "normal", type: "vec3f" },
  { name: "color", type: "vec4f" },
  { name: "uv", type: "vec2f" },
  { name: "uv2", type: "vec2f", when: ["CEL_PALETTE"] },
];

/** The cel vertex stage, declared for our renderer. */
export const CEL_VERTEX_PROGRAM: VertexProgram = {
  label: "cel-vertex",
  groups: [[FRAME_BLOCK], [], [CEL_MESH_BLOCK]],
  attributes: CEL_ATTRIBUTES,
  varyings: CEL_VARYINGS,
  includes: WGSL_CHUNKS,
  body: "#include<celVertex>",
  entry: "celVertex",
};

/**
 * The same stage drawn as INSTANCES: `world` is per instance, built by
 * `main` from three columns, and group 2 is not bound at all.
 */
export const CEL_INSTANCED_VERTEX_PROGRAM: VertexProgram = {
  ...CEL_VERTEX_PROGRAM,
  label: "cel-vertex-instanced",
  groups: [[FRAME_BLOCK], []],
  attributes: [
    ...CEL_ATTRIBUTES,
    { name: "world0", type: "vec4f", step: "instance" },
    { name: "world1", type: "vec4f", step: "instance" },
    { name: "world2", type: "vec4f", step: "instance" },
  ],
  privates: [{ var: "instance", struct: "CelInstance", fields: [{ name: "world", type: "mat4x4f" }] }],
  prelude: [
    "  let w0 = vertexInputs.world0;",
    "  let w1 = vertexInputs.world1;",
    "  let w2 = vertexInputs.world2;",
    "  instance.world = mat4x4f(",
    "    vec4f(w0.xyz, 0.0), vec4f(w1.xyz, 0.0), vec4f(w2.xyz, 0.0), vec4f(w0.w, w1.w, w2.w, 1.0));",
  ].join("\n"),
};

/** One variant of the cel vertex stage, for a pass of `target`'s kind. */
export function celVertex(defines: Iterable<string>, target: StageTarget): AssembledVertex {
  return assembleVertex(CEL_VERTEX_PROGRAM, defines, target);
}

/** One variant of the instanced cel vertex stage. */
export function celInstancedVertex(defines: Iterable<string>, target: StageTarget): AssembledVertex {
  return assembleVertex(CEL_INSTANCED_VERTEX_PROGRAM, defines, target);
}

/** The floats per vertex of each attribute type, and its vertex format. */
export const ATTRIBUTE_FORMATS: Readonly<Record<string, { readonly floats: number; readonly format: GPUVertexFormat }>> = {
  vec2f: { floats: 2, format: "float32x2" },
  vec3f: { floats: 3, format: "float32x3" },
  vec4f: { floats: 4, format: "float32x4" },
};

/**
 * The vertex buffers `vertex` is drawn with: one a vertex attribute, tightly
 * packed, in the stage's order; then, if it reads any, ONE buffer holding
 * every instance attribute, packed in order and stepped per instance.
 */
export function bufferLayouts(vertex: AssembledVertex): GPUVertexBufferLayout[] {
  const out: GPUVertexBufferLayout[] = [];
  const instanced: GPUVertexAttribute[] = [];
  let stride = 0;
  for (const a of vertex.attributes) {
    const f = ATTRIBUTE_FORMATS[a.type];
    if (a.instance) {
      instanced.push({ shaderLocation: a.location, offset: stride, format: f.format });
      stride += f.floats * 4;
    } else {
      out.push({ arrayStride: f.floats * 4, attributes: [{ shaderLocation: a.location, offset: 0, format: f.format }] });
    }
  }
  if (instanced.length > 0) out.push({ arrayStride: stride, stepMode: "instance", attributes: instanced });
  return out;
}
