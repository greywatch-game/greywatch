/**
 * render/blastProgram.ts — The blast's BILLOW program as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.4c): a unit icosphere drawn as instances, one a
 * billow, into the frame's main pass, and its twin into the glow's mask —
 * what `BlastShader.ts`'s `ShaderMaterial` and its mask material drew as
 * thin instances until X4.4c, over the same bodies (`shaders/wgsl/blast.ts`).
 * Owns: `BLAST_BLOCK` (group 1: the billow's own values — the mesh's `world`,
 * the clock, the drawing, the inks, the soot and the dust), `BLAST_GEOMETRY`
 * (group 2: the two icospheres' positions and indices, and each instance's
 * matrix, `billow`, `warmth` and bloom), `BLAST_VARYINGS`, `BlastRecipe` (what
 * the billow is drawn WITH, as plain data) and `blastPrograms`, the two
 * pipelines' modules.
 * Invariants: the vertex stage is ONE module for the main pass and the mask —
 * which is what the mask's LEQUAL tie rests on — and the pixel is the body's
 * (`BLAST_SURFACE`); a vertex is the index the draw's `firstVertex` steps
 * into (`indexData`, the two icospheres' indices rebased onto their positions
 * end to end), and an instance is a billow, its matrix read WHOLE — the four
 * columns Babylon's thin-instance `world0..3` held, as `BillowBatch` wrote
 * them — times the block's `world`, the identity the mesh was frozen at; the
 * frame's light, eye, fog and opaque alpha are the FRAME's (`render/frame.ts`:
 * the very fields `CelMaterialFactory` pushed onto the material) and the rest
 * the block's, so no name is declared twice; group 0 is the cel FRAGMENT's
 * whole group, so the frame's one bind group serves these pipelines as it
 * serves every cel one; the bloom is the instance's (`vGlow`, flat) — the
 * colour `GlowRules` gave its batch, as the mask material's `glowColor` was.
 * Never: imports Babylon; restates the body.
 * Contract: `docs/rendering.md`, "The pools, ours", and `docs/grenades.md`.
 */
import { BLAST_SHARED, BLAST_SURFACE, BLAST_VERTEX } from "../shaders/wgsl/blast";
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
 * Group 1: the billow's OWN values — everything `BlastMaterial` held that the
 * frame does not (the frame holds its key, ambient, sky fill, mist, eye, fog
 * and opaque alpha, and `CelMaterialFactory` pushed the same objects onto
 * both). `world` is the identity the thin-instanced mesh was frozen at, kept
 * so the product is the one Babylon's stage computed.
 */
export const BLAST_BLOCK = {
  kind: "uniform",
  var: "blast",
  struct: "BlastMaterial",
  fields: [
    { name: "world", type: "mat4x4f" },
    { name: "shape", type: "vec4f" },
    { name: "field", type: "vec4f" },
    { name: "charColor", type: "vec3f" },
    { name: "time", type: "f32" },
    { name: "deepColor", type: "vec3f" },
    { name: "air", type: "f32" },
    { name: "midColor", type: "vec3f" },
    { name: "rim", type: "f32" },
    { name: "hotColor", type: "vec3f" },
    { name: "coreColor", type: "vec3f" },
    { name: "sootColor", type: "vec3f" },
    { name: "dustColor", type: "vec3f" },
  ],
} as const satisfies Binding;

/** A field of `BLAST_BLOCK`, by the name the body reads it as. */
export type BlastField = (typeof BLAST_BLOCK.fields)[number]["name"];

/**
 * Group 2, the vertex stage's: the icospheres' positions and their indices
 * (rebased onto the positions end to end); per instance — a billow — its
 * matrix (four `vec4f` columns, `Matrix.m`'s layout), its `billow` (heat,
 * dissolve, seed, dust), its `warmth`, and its bloom (rgb, alpha).
 */
export const BLAST_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "indexData", type: "array<u32>" },
  { kind: "storage", name: "blastMatrices", type: "array<vec4f>" },
  { kind: "storage", name: "blastBillows", type: "array<vec4f>" },
  { kind: "storage", name: "blastWarmth", type: "array<f32>" },
  { kind: "storage", name: "blastGlow", type: "array<vec4f>" },
] as const satisfies readonly Binding[];

/** What the vertex stage hands the pixel: the material's six, then the instance's bloom. */
export const BLAST_VARYINGS = [
  { name: "vPosW", type: "vec3f" },
  { name: "vNormalW", type: "vec3f" },
  { name: "vRoundW", type: "vec3f" },
  { name: "vLocal", type: "vec3f" },
  { name: "vBillow", type: "vec4f" },
  { name: "vWarmth", type: "f32" },
  { name: "vGlow", type: "vec4f", interpolate: "flat" },
] as const;

/**
 * What the billow is drawn with, as the factory states it (`BlastPaint`):
 * each field of `BLAST_BLOCK` a `Float32Array` written in place, so a reader
 * holding it sees every later write.
 */
export interface BlastRecipe {
  readonly values: Readonly<Record<BlastField, Float32Array>>;
}

/** The frame's palette is declared, so group 0 is laid out as every cel program's is. */
const DEFINES = ["CEL_PALETTE"];
/** The mask's fragment: the same, and the body's `GLOW_MASK` arm. */
const GLOW_DEFINES = ["CEL_PALETTE", "GLOW_MASK"];

/** The two pipelines' modules: the main pass's, and the mask's (the SAME vertex module). */
export interface BlastPrograms {
  readonly main: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
  readonly mask: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
}

let built: BlastPrograms | null = null;

/** The billow's programs, assembled once. */
export function blastPrograms(): BlastPrograms {
  if (built) return built;
  if (FRAME_TARGETS.flipY !== GLOW_TARGETS.flipY) {
    // One vertex module for both passes is the mask's tie (the header).
    throw new Error("blastPrograms: the main pass and the glow's mask flip differently; one billow stage cannot serve both");
  }
  const vertex = assembleVertex(
    {
      label: "blast-vertex",
      groups: [[FRAME_BLOCK], [BLAST_BLOCK], BLAST_GEOMETRY],
      attributes: [{ name: "position", type: "vec3f", from: "positionData" }],
      varyings: BLAST_VARYINGS,
      includes: {},
      body: `${BLAST_SHARED}\n${BLAST_VERTEX}`,
      entry: "blastVertex",
      privates: [
        {
          var: "billowInstance",
          struct: "BillowInstance",
          fields: [
            { name: "instanceWorld", type: "mat4x4f" },
            { name: "billow", type: "vec4f" },
            { name: "warmth", type: "f32" },
            { name: "glow", type: "vec4f" },
          ],
        },
      ],
      instanced: true,
      pull: { vertex: "vertex", decode: "  let vertex = indexData[vertexIndex];" },
      prelude: [
        "  let at = instanceIndex * 4u;",
        "  billowInstance.instanceWorld = mat4x4f(blastMatrices[at], blastMatrices[at + 1u], blastMatrices[at + 2u], blastMatrices[at + 3u]);",
        "  billowInstance.billow = blastBillows[instanceIndex];",
        "  billowInstance.warmth = blastWarmth[instanceIndex];",
        "  billowInstance.glow = blastGlow[instanceIndex];",
      ].join("\n"),
    },
    DEFINES,
    FRAME_TARGETS,
  );
  const fragment = (glow: boolean): AssembledModule =>
    assembleFragment(
      {
        label: glow ? "blast-glow-fragment" : "blast-fragment",
        groups: [[FRAME_BLOCK, ...FRAME_TEXTURES], [BLAST_BLOCK]],
        varyings: BLAST_VARYINGS,
        includes: {},
        body: `${BLAST_SHARED}\n${BLAST_SURFACE}`,
        surface: "blastSurface",
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
