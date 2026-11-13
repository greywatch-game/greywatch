/**
 * render/celFragment.ts — The cel material's fragment as OUR renderer declares
 * it: the shared body (`celSurface`, the one Babylon's `ShaderMaterial` drew
 * until `BABYLON_EXIT.md` X6.1c deleted its declarations), against explicit
 * bind groups.
 * Owns: `CEL_FRAGMENT`, the declarations — the frame's uniforms and textures
 * (group 0, `frame.ts`), a material's (group 1, `celMaterial.ts`) and the
 * interpolated inputs (`CEL_VARYINGS`, which the vertex stage writes) — and
 * `celFragment`, one variant of it as a plain WGSL module.
 * Invariants: declares every name the shared body reads, by the names the
 * body reads them by, and under the guards Babylon's declarations had (until
 * X6.1c) except where the frame's one layout overrides that (below); a
 * texture is declared with its sampler, as Babylon's were; the inputs keep
 * Babylon's order and its locations.
 * Never: imports Babylon; restates a body — what is different on this side is
 * a declaration, and a body edited here would be the second copy the shared
 * chunks exist to prevent.
 * Contract: `docs/rendering.md`, "Hand-written WGSL"; what each name means is
 * written beside its declaration — the frame's (`frame.ts`), a material's
 * (`celMaterial.ts`) and the inputs (below).
 *
 * WHY TWO GROUPS, AND WHICH NAME IS IN WHICH. Group 0 is what
 * `CelMaterialFactory` holds for EVERY cel material as shared state — the
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
 * is one buffer shared by every material: a frame name only some variants
 * read (`skyZenithColor` for glazing, `reliefMarch` for the bumped ground) is
 * declared for all of them, which an unread member costs
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
  // Baked per-vertex world shading. w is ambient occlusion, 1 = unoccluded;
  // y is 1 on map geometry and 0 on everything else; x is the wind weight the
  // vertex stage has already spent. All three defaults come from the missing
  // attribute's default rather than from a uniform — see `color` in
  // `celVertex.ts`.
  { name: "vBaked", type: "vec4f" },
  // The 1-based index of this vertex's albedo in `celPalette`, carried in uv2's
  // x. **It is 1-based so that 0 can mean "not paletted"**, which is what the
  // default gives any mesh that never had the buffer written — the same trick
  // `vBaked` leans on, and what lets one material serve a merge group that a
  // builder did not paletteise.
  //
  // A vertex attribute is INTERPOLATED and an index cannot be, which is safe here
  // for a structural reason rather than by luck: a merge concatenates whole
  // meshes and never re-triangulates, so all three corners of any triangle come
  // from the same source mesh and carry the same index. The fragment stage still
  // rounds, because "safe" and "guaranteed by the hardware" are different things.
  { name: "vPalette", type: "f32", when: ["CEL_PALETTE"] },
];

/** The cel fragment, declared for our renderer. */
export const CEL_FRAGMENT: FragmentProgram = {
  label: "cel",
  // What Babylon's `#define DISABLE_UNIFORMITY_ANALYSIS` became. The
  // derivative users in the body are what was MEANT — a facet normal is a
  // screen-space difference, band()'s width is how fast its index moves per
  // pixel, and the ground albedo, its height map and the reflection cube are
  // the three fetches in this shader whose textures carry a MIP CHAIN, so an
  // implicit LOD is the filtering rather than an oversight. None of them has
  // an explicit-LOD form to reach for, and every one of them sits behind an
  // #ifdef or a loop WGSL's uniformity analysis cannot prove uniform. Every
  // fetch in celShadow is a textureSampleLevel already, because the depth map
  // has no mip chain and an explicit level 0 is what was meant there.
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
