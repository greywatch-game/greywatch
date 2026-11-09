/**
 * render/flameProgram.ts — The FIRE's program as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.4d): a fire's surface — a world fire's block merge,
 * or the molotov's one flame — drawn as an instance under its matrix into the
 * frame's main pass, and its twin into the glow's mask — what
 * `FlameShader.ts`'s `ShaderMaterial` and its mask material drew through
 * Babylon until X4.4d, over the same bodies (`shaders/wgsl/flame.ts`, which
 * `FlameShader`'s Babylon stages assemble too until X5.3d).
 * Owns: `FLAME_BLOCK` (group 1: the fire's own values — the clock, the
 * motion, the curl, the embers, the boil and the five inks), `FLAME_GEOMETRY`
 * (group 2: every fire surface's positions, normals and uvs end to end, their
 * indices rebased onto them, and each instance's matrix and bloom),
 * `FLAME_VARYINGS`, `FlameRecipe` (what a fire is drawn WITH, as plain data)
 * and `flamePrograms`, the two pipelines' modules.
 * Invariants: the vertex stage is ONE module for the main pass and the mask —
 * which is what the mask's LEQUAL tie rests on — and the pixel is the body's
 * (`FLAME_SURFACE`, under `FLAME_INSTANCED`: the bloom off the instance); a
 * vertex is the index the draw's `firstVertex` steps into (`indexData`), and
 * an instance is one fire surface, its matrix read WHOLE — the four columns
 * Babylon's `world` uniform held for its mesh, as `computeWorldMatrix`
 * composed it — into the private block the body reads as `uniforms.world`;
 * the frame's eye, wind bearing, fog and opaque alpha are the FRAME's
 * (`render/frame.ts`: the very fields `CelMaterialFactory` pushed onto the
 * material) and the rest the block's, so no name is declared twice; group 0
 * is the cel FRAGMENT's whole group, so the frame's one bind group serves
 * these pipelines as it serves every cel one; the bloom is the instance's
 * (`vGlow`, flat) — the colour `GlowRules` gave its mesh, as the mask
 * material's `glowColor` was.
 * Never: imports Babylon; restates the body.
 * Contract: `docs/rendering.md`, "The fire", and `docs/grenades.md`.
 */
import { FLAME_SHARED, FLAME_SURFACE, FLAME_VERTEX } from "../shaders/wgsl/flame";
import { FRAME_BLOCK, FRAME_TEXTURES } from "./frame";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import {
  assembleFragment,
  assembleVertex,
  type AssembledModule,
  type AssembledVertex,
  type Binding,
} from "./wgsl/assemble";

/**
 * Group 1: the fire's OWN values — everything `FlameMaterial` holds that the
 * frame does not (the frame holds its eye, the wind's bearing, the fog and
 * the opaque alpha, and `CelMaterialFactory` pushes the same numbers onto
 * both).
 */
export const FLAME_BLOCK = {
  kind: "uniform",
  var: "flame",
  struct: "FlameMaterial",
  fields: [
    { name: "motion", type: "vec4f" },
    { name: "embers", type: "vec4f" },
    { name: "boil", type: "vec3f" },
    { name: "time", type: "f32" },
    { name: "curl", type: "vec2f" },
    { name: "charColor", type: "vec3f" },
    { name: "deepColor", type: "vec3f" },
    { name: "midColor", type: "vec3f" },
    { name: "hotColor", type: "vec3f" },
    { name: "coreColor", type: "vec3f" },
  ],
} as const satisfies Binding;

/** A field of `FLAME_BLOCK`, by the name the body reads it as. */
export type FlameField = (typeof FLAME_BLOCK.fields)[number]["name"];

/**
 * Group 2, the vertex stage's: every fire surface's positions, normals and
 * uvs end to end, and their indices (rebased onto them); per instance — one
 * fire surface drawn — its matrix (four `vec4f` columns, `Matrix.m`'s layout)
 * and its bloom (rgb, alpha).
 */
export const FLAME_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "normalData", type: "array<f32>" },
  { kind: "storage", name: "uvData", type: "array<vec2f>" },
  { kind: "storage", name: "indexData", type: "array<u32>" },
  { kind: "storage", name: "flameMatrices", type: "array<vec4f>" },
  { kind: "storage", name: "flameGlow", type: "array<vec4f>" },
] as const satisfies readonly Binding[];

/** What the vertex stage hands the pixel: the material's five, then the instance's bloom. */
export const FLAME_VARYINGS = [
  { name: "vPosW", type: "vec3f" },
  { name: "vNormalW", type: "vec3f" },
  { name: "vT", type: "f32" },
  { name: "vLayer", type: "f32" },
  { name: "vField", type: "vec3f" },
  { name: "vGlow", type: "vec4f", interpolate: "flat" },
] as const;

/**
 * What a fire is drawn with, as the factory states it (`FlameMaterial`):
 * each field of `FLAME_BLOCK` a `Float32Array` written in place, so a reader
 * holding it sees every later write.
 */
export interface FlameRecipe {
  readonly values: Readonly<Record<FlameField, Float32Array>>;
}

/**
 * The frame's palette is declared, so group 0 is laid out as every cel
 * program's is; and the bloom is the instance's (`FLAME_INSTANCED`).
 */
const DEFINES = ["CEL_PALETTE", "FLAME_INSTANCED"];
/** The mask's fragment: the same, and the body's `GLOW_MASK` arm. */
const GLOW_DEFINES = ["CEL_PALETTE", "FLAME_INSTANCED", "GLOW_MASK"];

/** The two pipelines' modules: the main pass's, and the mask's (the SAME vertex module). */
export interface FlamePrograms {
  readonly main: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
  readonly mask: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
}

let built: FlamePrograms | null = null;

/** The fire's programs, assembled once. */
export function flamePrograms(): FlamePrograms {
  if (built) return built;
  if (FRAME_TARGETS.flipY !== GLOW_TARGETS.flipY) {
    // One vertex module for both passes is the mask's tie (the header).
    throw new Error("flamePrograms: the main pass and the glow's mask flip differently; one fire stage cannot serve both");
  }
  const vertex = assembleVertex(
    {
      label: "flame-vertex",
      groups: [[FRAME_BLOCK], [FLAME_BLOCK], FLAME_GEOMETRY],
      attributes: [
        { name: "position", type: "vec3f", from: "positionData" },
        { name: "normal", type: "vec3f", from: "normalData" },
        { name: "uv", type: "vec2f", from: "uvData" },
      ],
      varyings: FLAME_VARYINGS,
      includes: {},
      body: `${FLAME_SHARED}\n${FLAME_VERTEX}`,
      entry: "flameVertex",
      privates: [{ var: "flameInstance", struct: "FlameInstance", fields: [{ name: "world", type: "mat4x4f" }] }],
      instanced: true,
      pull: { vertex: "vertex", decode: "  let vertex = indexData[vertexIndex];" },
      prelude: [
        "  let at = instanceIndex * 4u;",
        "  flameInstance.world = mat4x4f(flameMatrices[at], flameMatrices[at + 1u], flameMatrices[at + 2u], flameMatrices[at + 3u]);",
        // The body writes every output but this one, which is the instance's.
        "  vertexOutputs.vGlow = flameGlow[instanceIndex];",
      ].join("\n"),
    },
    DEFINES,
    FRAME_TARGETS,
  );
  const fragment = (glow: boolean): AssembledModule =>
    assembleFragment(
      {
        label: glow ? "flame-glow-fragment" : "flame-fragment",
        groups: [[FRAME_BLOCK, ...FRAME_TEXTURES], [FLAME_BLOCK]],
        varyings: FLAME_VARYINGS,
        includes: {},
        body: `${FLAME_SHARED}\n${FLAME_SURFACE}`,
        surface: "flameSurface",
      },
      glow ? GLOW_DEFINES : DEFINES,
      glow ? GLOW_TARGETS : FRAME_TARGETS,
    );
  built = {
    main: { vertex, fragment: fragment(false) },
    mask: { vertex, fragment: fragment(true) },
  };
  return built;
}
