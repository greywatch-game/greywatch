/**
 * render/celDepth.ts — The world's DEPTH program: what a directional shadow
 * map records of a caster, declared for our renderer (`BABYLON_EXIT.md`
 * X3.6a) — Babylon's own `shadowMap` shader for a `ShadowGenerator` as this
 * game configures one, in the cel stage's pulled form.
 * Owns: `DEPTH_BLOCK` (the light's view-projection, group 0), the geometry it
 * reads (group 1, `depthGeometry`: the positions, the instances' transforms,
 * and the scatter's list and source for its scatter twin), and `celDepth`,
 * the program's two modules for the plain stage or the scatter twin; and the
 * program's own bodies and varyings (`DEPTH_VERTEX_BODY`, `DEPTH_VARYINGS`,
 * `depthFragment`), which the bodies' proxies are drawn with too
 * (`render/bodyDepth.ts`, X4.1c).
 * Invariants: it writes what Babylon's wrote, number for number — the clip z
 * of the light's orthographic projection, `(z_view - near) / (far - near)`
 * under WebGPU's half-z range, as the varying Babylon's `vDepthMetricSM` is
 * with `depthValuesSM` (0, 1) and no bias, into the colour's first channel
 * and 1 into the other three (`SHADOW_TARGETS` keeps only the first) — and
 * reads only a vertex's POSITION, so a caster's shadow does not sway, as
 * Babylon's depth pass, which never ran the cel vertex body, never swayed
 * one; the index is decoded and `world` built exactly as the cel stage does
 * (`pulledWorld`), so a scatter vertex lands where the main pass draws it.
 * Never: imports Babylon; restates the cel stage's decode.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import { CEL_SCATTER_LIST, pulledWorld } from "./celVertex";
import { SHADOW_TARGETS } from "./targets";
import {
  assembleFragment,
  assembleVertex,
  type AssembledModule,
  type AssembledVertex,
  type Binding,
  type VertexProgram,
} from "./wgsl/assemble";

/** Group 0 of the depth program: the light's view-projection, as `ShadowSystem` places it. */
export const DEPTH_BLOCK = {
  kind: "uniform",
  var: "light",
  struct: "DepthLight",
  fields: [{ name: "lightViewProjection", type: "mat4x4f" }],
} as const satisfies Binding;

/** Group 1 of the depth program: the positions and the instances' transforms. */
const DEPTH_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "transforms", type: "array<vec4f>" },
] as const satisfies readonly Binding[];

/** Group 1 as a variant built for `stride` binds it: the scatter twin's adds the list and its source. */
export function depthGeometry(stride: number | null): readonly Binding[] {
  return stride === null ? DEPTH_GEOMETRY : [...DEPTH_GEOMETRY, ...CEL_SCATTER_LIST];
}

/** The depth program's one varying: Babylon's metric. */
export const DEPTH_VARYINGS = [{ name: "vDepthMetricSM", type: "f32" }] as const;

/** Babylon's `shadowMap.vertex` with its metric (`shadowMapVertexMetric`), as this game's generators compile it. */
export const DEPTH_VERTEX_BODY = `
fn depthVertex() {
  let worldPos = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = uniforms.lightViewProjection * worldPos;
  vertexOutputs.vDepthMetricSM = vertexOutputs.position.z;
}
`;

/** Babylon's `shadowMap.fragment` (`shadowMapFragment`), likewise. */
const DEPTH_FRAGMENT_BODY = `
fn depthSurface() -> vec4f {
  return vec4f(fragmentInputs.vDepthMetricSM, 1.0, 1.0, 1.0);
}
`;

/** The depth vertex stage, or with the list's `stride` its scatter twin. */
function depthProgram(stride: number | null): VertexProgram {
  return {
    label: stride === null ? "depth-vertex" : "depth-vertex-scatter",
    groups: [[DEPTH_BLOCK], depthGeometry(stride)],
    attributes: [{ name: "position", type: "vec3f", from: "positionData" }],
    varyings: DEPTH_VARYINGS,
    includes: {},
    body: DEPTH_VERTEX_BODY,
    entry: "depthVertex",
    ...pulledWorld(stride),
  };
}

/** Each stride's two modules, assembled once. */
const programs = new Map<string, { vertex: AssembledVertex; fragment: AssembledModule }>();

/** The fragment stage every directional depth program shares, assembled once. */
let fragment: AssembledModule | null = null;

/** Babylon's `shadowMap.fragment` for a directional map's pass (`SHADOW_TARGETS`): the metric into red. */
export function depthFragment(): AssembledModule {
  return (fragment ??= assembleFragment(
    {
      label: "depth-fragment",
      groups: [],
      varyings: DEPTH_VARYINGS,
      includes: {},
      body: DEPTH_FRAGMENT_BODY,
      surface: "depthSurface",
    },
    [],
    SHADOW_TARGETS,
  ));
}

/**
 * The depth program for a world shadow map's pass (`SHADOW_TARGETS`, which
 * every shadow pass is): the plain stage, or the scatter twin for `stride`.
 */
export function celDepth(stride: number | null): { vertex: AssembledVertex; fragment: AssembledModule } {
  const key = String(stride);
  let program = programs.get(key);
  if (!program) {
    program = {
      vertex: assembleVertex(depthProgram(stride), [], SHADOW_TARGETS),
      fragment: depthFragment(),
    };
    programs.set(key, program);
  }
  return program;
}
