/**
 * render/bodyDepth.ts — The bodies' DEPTH program: what the moon's body map
 * records of a proxy box, declared for our renderer (`BABYLON_EXIT.md`
 * X4.1c) — Babylon's `shadowMap` shader for the `ShadowGenerator`
 * `BodyShadows` built, over the thin instances of its one unit box, in the
 * pulled form.
 * Owns: `BODY_PROXIES` (group 1: the box's corners and each instance's
 * matrix) and `bodyDepth`, the program's two modules.
 * Invariants: it writes what Babylon's wrote, number for number — the
 * directional depth program's own bodies (`celDepth.ts`: the clip z of the
 * light's orthographic projection under the half-z range, into red), so the
 * world's maps and the bodies' cannot come to disagree about what a depth
 * is; a vertex is a corner of the kit's unit box (`proxyBoxPositions`,
 * Babylon's `CreateBox` number for number, unrolled), and its `world` is its
 * instance's matrix as Babylon laid it out (`Matrix.m`, a column every four
 * floats as WGSL reads it) — what Babylon's thin-instance stage made of the
 * proxy, whose own world was the identity, so the product was the instance's
 * matrix exactly.
 * Never: imports Babylon; restates the depth bodies.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import { DEPTH_BLOCK, DEPTH_VARYINGS, DEPTH_VERTEX_BODY, depthFragment } from "./celDepth";
import { PROXY_CORNERS } from "./lampDepth";
import { SHADOW_TARGETS } from "./targets";
import {
  assembleVertex,
  type AssembledModule,
  type AssembledVertex,
  type Binding,
  type VertexProgram,
} from "./wgsl/assemble";

/** Group 1 of the bodies' program: the box's corners, and each instance's matrix. */
export const BODY_PROXIES = [
  { kind: "storage", name: "boxPositions", type: "array<f32>" },
  { kind: "storage", name: "proxyMatrices", type: "array<vec4f>" },
] as const satisfies readonly Binding[];

/** A corner of the box, at its instance's matrix: the depth vertex body over a proxy. */
const BODY_PROGRAM: VertexProgram = {
  label: "body-depth-vertex",
  groups: [[DEPTH_BLOCK], BODY_PROXIES],
  attributes: [{ name: "position", type: "vec3f", from: "boxPositions" }],
  varyings: DEPTH_VARYINGS,
  includes: {},
  body: DEPTH_VERTEX_BODY,
  entry: "depthVertex",
  privates: [{ var: "instance", struct: "BodyProxy", fields: [{ name: "world", type: "mat4x4f" }] }],
  pull: {
    vertex: "vertex",
    decode: [`  let vertex = vertexIndex % ${PROXY_CORNERS}u;`, `  let drawnAt = vertexIndex / ${PROXY_CORNERS}u;`].join("\n"),
  },
  prelude: [
    "  let m = drawnAt * 4u;",
    "  instance.world = mat4x4f(proxyMatrices[m], proxyMatrices[m + 1u], proxyMatrices[m + 2u], proxyMatrices[m + 3u]);",
  ].join("\n"),
};

/** The vertex module, assembled once. */
let vertex: AssembledVertex | null = null;

/** The bodies' depth program for the body map's pass (`SHADOW_TARGETS`). */
export function bodyDepth(): { vertex: AssembledVertex; fragment: AssembledModule } {
  return { vertex: (vertex ??= assembleVertex(BODY_PROGRAM, [], SHADOW_TARGETS)), fragment: depthFragment() };
}
