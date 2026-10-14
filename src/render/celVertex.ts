/**
 * render/celVertex.ts — The cel material's VERTEX stage as our renderer
 * declares it: the same body Babylon's `ShaderMaterial` runs (`celVertex`),
 * against explicit bind groups and vertex buffers.
 * Owns: `CEL_VERTEX_PROGRAM` — the attributes, the frame block (group 0), the
 * draw's `world` (group 2) and the outputs, which are the fragment's
 * `CEL_VARYINGS` — and `celVertex`, one variant of it as a plain WGSL module.
 * Invariants: declares every name the shared body reads, by Babylon's names
 * because the body reads them by name (`CelShader.ts`'s `celVertexShader`);
 * the attributes are Babylon's, under Babylon's guards — `color` and `uv` in
 * every variant, `uv2` under `CEL_PALETTE` — and a mesh missing an
 * unguarded one is drawn with it reading zero, as Babylon's empty buffer
 * reads (`render/WorldBlocks.ts`); group 1 is declared EMPTY here and is the
 * fragment's, so the numbers stay the program's.
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
  type StageTarget,
  type VertexProgram,
} from "./wgsl/assemble";

/** The cel vertex stage, declared for our renderer. */
export const CEL_VERTEX_PROGRAM: VertexProgram = {
  label: "cel-vertex",
  groups: [[FRAME_BLOCK], [], [CEL_MESH_BLOCK]],
  attributes: [
    { name: "position", type: "vec3f" },
    { name: "normal", type: "vec3f" },
    { name: "color", type: "vec4f" },
    { name: "uv", type: "vec2f" },
    { name: "uv2", type: "vec2f", when: ["CEL_PALETTE"] },
  ],
  varyings: CEL_VARYINGS,
  includes: WGSL_CHUNKS,
  body: "#include<celVertex>",
  entry: "celVertex",
};

/** One variant of the cel vertex stage, for a pass of `target`'s kind. */
export function celVertex(defines: Iterable<string>, target: StageTarget): AssembledVertex {
  return assembleVertex(CEL_VERTEX_PROGRAM, defines, target);
}
