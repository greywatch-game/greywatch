/**
 * render/celFragment.ts — The cel material's fragment as OUR renderer declares
 * it: the same body Babylon's `ShaderMaterial` draws (`celSurface`), against
 * explicit bind groups.
 * Owns: `CEL_FRAGMENT`, the declarations — the frame's uniforms and textures
 * (group 0, `frame.ts`), a material's (group 1, `celMaterial.ts`) and the
 * interpolated inputs (`CEL_VARYINGS`, which the vertex stage writes) — and
 * `celFragment`, one variant of it as a plain WGSL module.
 * Invariants: declares every name the shared body reads, by Babylon's names
 * because the body reads them by name, and under Babylon's guards
 * (`CelShader.ts`'s `celFragmentShader`, `shaders/wgsl/includes.ts`) except
 * where the frame's one layout overrides that (below); a texture is declared
 * with its sampler, as Babylon's are; the inputs keep Babylon's order and its
 * locations.
 * Never: imports Babylon; restates a body — what is different on this side is
 * a declaration, and a body edited here would be the second copy the shared
 * chunks exist to prevent.
 * Contract: `docs/rendering.md`, "Hand-written WGSL"; what each name means is
 * written beside its Babylon declaration.
 *
 * WHY TWO GROUPS, AND WHICH NAME IS IN WHICH. Group 0 is what
 * `CelMaterialFactory` pushes onto EVERY cel material as shared state — the
 * environment, the camera, the point lights, every shadow, the irradiance
 * volume, the map's palette, the Ground relief setting — and group 1 is what
 * a material is born with from its own spec: its albedo, its ground texture
 * and relief depth, its gloss, translucency and glazing, and a pane's own
 * probe. That is the split the factory already makes, read off the code
 * rather than chosen. The frame's block is `render/frame.ts`'s `FRAME_BLOCK`,
 * one declaration every program binds at group 0, binding 0, so a name can
 * move between the two without touching a body.
 *
 * **The frame is ONE layout in every variant but the last field**, because it
 * is one buffer shared by every material: a frame name Babylon declares only
 * for some variants (`skyZenithColor` for glazing, `reliefMarch` for the
 * bumped ground) is declared for all of them, which an unread member costs
 * nothing, and the one that cannot be — the 2 KB palette — is guarded and
 * LAST, so the variants that have it read the same offsets as the rest and a
 * longer buffer (`frame.ts` states it; `FrameUniformBuffer` writes it).
 */
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import { CEL_MATERIAL_BLOCK, CEL_MATERIAL_TEXTURES } from "./celMaterial";
import { FRAME_BLOCK, FRAME_TEXTURES } from "./frame";
import {
  assembleFragment,
  type AssembledModule,
  type FragmentProgram,
  type StageTarget,
  type Varying,
} from "./wgsl/assemble";

/**
 * What the cel vertex stage hands the fragment, in Babylon's order and so at
 * Babylon's locations — one list, read by both programs.
 */
export const CEL_VARYINGS: readonly Varying[] = [
  { name: "vNormalW", type: "vec3f" },
  { name: "vPosW", type: "vec3f" },
  { name: "vBaked", type: "vec4f" },
  { name: "vPalette", type: "f32", when: ["CEL_PALETTE"] },
];

/** The cel fragment, declared for our renderer. */
export const CEL_FRAGMENT: FragmentProgram = {
  label: "cel",
  // What Babylon's `#define DISABLE_UNIFORMITY_ANALYSIS` becomes: the
  // derivatives and the mip-chained fetches in the body are what was MEANT
  // (`CelShader.ts` says why beside that define).
  diagnosticsOff: ["derivative_uniformity"],
  groups: [
    [FRAME_BLOCK, ...FRAME_TEXTURES],
    [CEL_MATERIAL_BLOCK, ...CEL_MATERIAL_TEXTURES],
  ],
  varyings: CEL_VARYINGS,
  includes: WGSL_CHUNKS,
  body: "#include<celSurface>",
  surface: "celSurface",
};

/** One variant of the cel fragment — a define set Babylon's materials compile — for a pass of `target`'s kind. */
export function celFragment(defines: Iterable<string>, target: StageTarget): AssembledModule {
  return assembleFragment(CEL_FRAGMENT, defines, target);
}
