/**
 * render/fadeProgram.ts — The FADING pools' program as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.6e): a spark, a dust disc, a scorch and a blob shadow,
 * each one draw of one instance of its kit, into the frame's main pass in the
 * one back-to-front run (`FarthestRun`), and a spark's twin into the glow's
 * mask — what their unlit `StandardMaterial`s and `GlowPass`'s mask material
 * drew until X4.6e, over the bodies in `shaders/wgsl/fade.ts`.
 * Owns: `FADE_BLOCK` (group 1: the sparks' and the discs' colours and the fog
 * band), `FADE_TEXTURES` (group 1's opacity map, the scorch's and the blob's),
 * `FADE_GEOMETRY` (group 2: the kits' positions and uvs, and each drawn
 * fade's world, look and bloom), `FADE_VARYINGS`, `FadeVariant` and
 * `fadePrograms`, each variant's two modules.
 * Invariants: the pixel is the body's (`FADE_SURFACE`); a vertex is the
 * index the draw names plus its base vertex, read out of the kits' arrays;
 * an instance is a drawn fade — its world the matrix its mesh's `world`
 * uniform held, whole (`Matrix.m`'s sixteen), its look (slot, visibility) and
 * its bloom (rgb, alpha) handed to the pixel FLAT, so each reaches it as the
 * number it was; the frame's eye, fog colour and view-projection are the
 * FRAME's (`render/frame.ts`: the scene's `vEyePosition` and the colour
 * `EmissiveFog` was handed are the same objects `CelMaterialFactory` fills it
 * from) and the colours and the band group 1's; group 0 is the cel FRAGMENT's
 * whole group, so the frame's one bind group serves these pipelines as it
 * serves every cel one.
 * Never: imports Babylon; restates the body.
 * Contract: `docs/rendering.md`, "The pools, ours".
 */
import { MAX_EMISSIVE_PALETTE } from "../shaders/wgsl/emissiveWorld";
import { FADE_SURFACE, FADE_VERTEX } from "../shaders/wgsl/fade";
import { FRAME_BLOCK, FRAME_TEXTURES } from "./frame";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import { assembleFragment, assembleVertex, type AssembledModule, type AssembledVertex, type Binding } from "./wgsl/assemble";

/** Group 1: the emissive colours a fade's slot names, and the fog band they fade on. */
export const FADE_BLOCK = {
  kind: "uniform",
  var: "fade",
  struct: "FadeMaterial",
  fields: [
    { name: "emissivePalette", type: "vec3f", count: MAX_EMISSIVE_PALETTE },
    { name: "fogRange", type: "vec2f" },
  ],
} as const satisfies Binding;

/** Group 1's texture: the opacity map, for the variants that read one. */
export const FADE_TEXTURES = [
  { kind: "sampled", name: "opacityTex", type: "texture_2d<f32>", when: ["FADE_OPACITY"] },
] as const satisfies readonly Binding[];

/** Group 2: the kits' positions and uvs end to end, then each drawn fade's world, look and bloom. */
export const FADE_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "uvData", type: "array<vec2f>" },
  { kind: "storage", name: "fadeWorld", type: "array<vec4f>" },
  { kind: "storage", name: "fadeLook", type: "array<vec4f>" },
  { kind: "storage", name: "fadeGlow", type: "array<vec4f>" },
] as const satisfies readonly Binding[];

/** What the vertex stage hands the pixel. */
export const FADE_VARYINGS = [
  { name: "vPosW", type: "vec3f" },
  { name: "vUV", type: "vec2f", when: ["FADE_OPACITY"] },
  { name: "vLook", type: "vec4f", interpolate: "flat" },
  { name: "vGlow", type: "vec4f", interpolate: "flat" },
] as const;

/**
 * The four variants: a spark's and a disc's (fogged, no map), the scorch's
 * (fogged, its map), the blob's (its map, no fog) and the spark's mask twin.
 */
export type FadeVariant = "emissive" | "scorch" | "blob" | "mask";

/** Each variant's defines beyond the frame's palette, which lays group 0 out as every cel program's is. */
const DEFINES: Readonly<Record<FadeVariant, readonly string[]>> = {
  emissive: ["CEL_PALETTE", "FADE_FOG"],
  scorch: ["CEL_PALETTE", "FADE_FOG", "FADE_OPACITY"],
  blob: ["CEL_PALETTE", "FADE_OPACITY"],
  mask: ["CEL_PALETTE", "GLOW_MASK"],
};

/** A variant's defines, for its group 1. */
export function fadeDefines(variant: FadeVariant): readonly string[] {
  return DEFINES[variant];
}

const built = new Map<FadeVariant, { vertex: AssembledVertex; fragment: AssembledModule }>();

/** One variant's two modules, assembled once: the mask's for the glow's mask, the rest for the main pass. */
export function fadePrograms(variant: FadeVariant): { vertex: AssembledVertex; fragment: AssembledModule } {
  let program = built.get(variant);
  if (program) return program;
  const target = variant === "mask" ? GLOW_TARGETS : FRAME_TARGETS;
  const defines = DEFINES[variant];
  program = {
    vertex: assembleVertex(
      {
        label: `fade-vertex-${variant}`,
        groups: [[FRAME_BLOCK], [], FADE_GEOMETRY],
        attributes: [
          { name: "position", type: "vec3f", from: "positionData" },
          { name: "uv", type: "vec2f", when: ["FADE_OPACITY"], from: "uvData" },
        ],
        varyings: FADE_VARYINGS,
        includes: {},
        body: FADE_VERTEX,
        entry: "fadeVertex",
        privates: [
          {
            var: "fadeItem",
            struct: "FadeItem",
            fields: [
              { name: "world", type: "mat4x4f" },
              { name: "look", type: "vec4f" },
              { name: "glow", type: "vec4f" },
            ],
          },
        ],
        instanced: true,
        pull: { vertex: "vertexIndex" },
        // The matrix read WHOLE, as the mesh's `world` uniform held it: no
        // column built from a literal, so the product compiles as the
        // uniform's did (`celVertex.ts`' placed stage says what three columns
        // and a constant row moved).
        prelude: [
          "  let t = instanceIndex * 4u;",
          "  fadeItem.world = mat4x4f(fadeWorld[t], fadeWorld[t + 1u], fadeWorld[t + 2u], fadeWorld[t + 3u]);",
          "  fadeItem.look = fadeLook[instanceIndex];",
          "  fadeItem.glow = fadeGlow[instanceIndex];",
        ].join("\n"),
      },
      defines,
      target,
    ),
    fragment: assembleFragment(
      {
        label: `fade-fragment-${variant}`,
        groups: [[FRAME_BLOCK, ...FRAME_TEXTURES], [FADE_BLOCK, ...FADE_TEXTURES]],
        varyings: FADE_VARYINGS,
        includes: {},
        body: FADE_SURFACE,
        surface: "fadeSurface",
      },
      defines,
      target,
    ),
  };
  built.set(variant, program);
  return program;
}
