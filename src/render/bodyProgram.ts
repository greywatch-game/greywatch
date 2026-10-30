/**
 * render/bodyProgram.ts — The BODIES' programs: a soldier rig drawn as
 * instances of its kit (`BABYLON_EXIT.md` X4.1d) — the cel stage over the
 * matte segments, the emissive palette's stage over the visor, and the
 * visor's twin in the glow's mask — declared for our renderer, and the
 * three again behind a SCREEN DOOR for a fading body (X4.1e).
 * Owns: `BODY_GEOMETRY` (group 2 of all of them: every attribute's array, the
 * kits' segment ranges and indices, and each instance's kit, segment ORDER
 * and matrices — eight storage arrays, WebGPU's default per-stage ceiling),
 * `BODY_GLOW` (the mask's group 1: each instance's bloom
 * colour), `BODY_FADE` (the faded programs' group 3, their fragment stage's
 * alone: each instance's fade), the screen door, `BODY_CEL_DEFINES`,
 * `BODY_VISOR_DEFINES`, and `bodyPrograms`, the six programs' modules for
 * kits of `segments` segments.
 * Invariants: the vertex BODIES are the cel material's and the emissive
 * palette's own (`celVertex`, `EMISSIVE_WORLD_VERTEX`), never restated — what
 * is a body's here is the DECODE. An instance is a BODY; a draw is one RANK
 * of every body — its `rank`th segment nearest the eye (`bodyOrder`, after
 * the body's kit: the order Babylon's front-to-back queue drew a rig's meshes
 * in, which decides which of two segments wins an equal depth: the later) —
 * and a vertex is a corner of that segment, its index read out of
 * `indexData` through the segment's range in the body's kit, a table at the
 * head of the same array (the matte segments' for the cel program, the
 * visor's alone for the visor's, each at its own offset); the rank is
 * the vertex index's quotient by the program's SPAN (the longest range it
 * draws, which each draw's `firstVertex` steps by), the corner its
 * remainder, and a corner past its segment's range — or of a segment whose
 * matrix is ZERO, the launcher on a body without one — is drawn as nothing,
 * put outside the clip volume before an attribute is read; `world` is that
 * body's matrix for the segment — what Babylon's `freezeWorldMatrix` handed
 * the segment's mesh until X4.1d — read WHOLE, all sixteen floats out of
 * storage as Babylon's uniform held them, so nothing the compiler may fold
 * makes the product differ from the one Babylon's stage computed; the
 * visor's vertex stage is ONE module for the main pass and the mask, which
 * is what the mask's LEQUAL tie rests on, and it hands each pixel its
 * instance (`vBody`, flat) for the mask to read that body's bloom off — the
 * colour `GlowRules` gave the body's visor, written as it was (rgb the
 * colour, a the material's alpha), never faded here. A FADED program is its
 * plain twin's body and pixel unchanged with the door in front — a pixel
 * kept or discarded off the instance's fade against a 4x4 Bayer rank of the
 * pixel, keyed on nothing else, read through the flat `vBody` (the matte
 * stage hands it too, last) — so the visor and its mask, one vertex module,
 * discard the same pixels; the vertex stage gains no storage array (eight is
 * the ceiling).
 * Never: imports Babylon; restates a body; decides what a body is, its
 * order, or which draw.
 * Contract: `docs/rendering.md`, "The bodies, ours" and "Hand-written WGSL".
 */
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import { EMISSIVE_WORLD_SURFACE, EMISSIVE_WORLD_VERTEX } from "../shaders/wgsl/emissiveWorld";
import { CEL_FRAGMENT, CEL_VARYINGS, celFragment } from "./celFragment";
import { CEL_ATTRIBUTES } from "./celVertex";
import { EMISSIVE_ATTRIBUTES, EMISSIVE_BLOCK, EMISSIVE_VARYINGS, emissiveWorld } from "./emissiveWorld";
import { FRAME_BLOCK, FRAME_TEXTURES } from "./frame";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import {
  assembleFragment,
  assembleVertex,
  type AssembledModule,
  type AssembledVertex,
  type Binding,
  type VertexProgram,
} from "./wgsl/assemble";

/**
 * Group 2 of every body program: the kits' arrays (by the names the cel
 * stage's attributes are read out of); `indexData`, each kit's segment
 * ranges as each program draws them (first index, count — the matte table,
 * then the visor's, each `kits * segments` pairs) and then the indices,
 * rebased onto the arrays; per instance — a body — its kit and then its
 * segments in the order they are drawn (`bodyOrder`, `segments + 1` a body);
 * and its matrices, one `mat4x4f` a segment, four `vec4f` columns as
 * Babylon's `Matrix.m` lays them. EIGHT storage arrays, which is WebGPU's
 * default `maxStorageBuffersPerShaderStage` — a ninth fails the layout.
 */
export const BODY_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "normalData", type: "array<f32>" },
  { kind: "storage", name: "colorData", type: "array<vec4f>" },
  { kind: "storage", name: "uvData", type: "array<vec2f>" },
  { kind: "storage", name: "uv2Data", type: "array<vec2f>" },
  { kind: "storage", name: "indexData", type: "array<u32>" },
  { kind: "storage", name: "bodyOrder", type: "array<u32>" },
  { kind: "storage", name: "bodyMatrices", type: "array<vec4f>" },
] as const satisfies readonly Binding[];

/** The mask's group 1: each instance's bloom colour, rgb the colour and a the alpha. */
export const BODY_GLOW = [{ kind: "storage", name: "bodyGlow", type: "array<vec4f>" }] as const satisfies readonly Binding[];

/**
 * Group 3 of the three DITHERED programs, their fragment stage's alone (X4.1e):
 * each instance's FADE, the share of its pixels drawn. In the fragment stage
 * because the vertex stage is at its ceiling of eight storage arrays
 * (`BODY_GEOMETRY`), and a group of its own so one bind group serves all
 * three — the matte segments, the visor and the visor's mask — under one
 * layout.
 */
export const BODY_FADE = [{ kind: "storage", name: "bodyFade", type: "array<f32>" }] as const satisfies readonly Binding[];

/** The matte segments' variant: the kit palette, a material's OWN (`celMaterial.ts`). */
export const BODY_CEL_DEFINES = ["CEL_PALETTE", "CEL_OWN_PALETTE"] as const;

/** The visor's: the emissive palette's own, so group 0 is laid out as every cel program's is. */
export const BODY_VISOR_DEFINES = ["CEL_PALETTE"] as const;

/** What the visor's stage hands its pixel: the palette's two, then the body it belongs to. */
const VISOR_VARYINGS = [...EMISSIVE_VARYINGS, { name: "vBody", type: "u32", interpolate: "flat" }] as const;

/**
 * What a FADING body's matte stage hands its pixel: the cel material's, then
 * the body (X4.1e) — last, after the guarded `vPalette`, which every body
 * variant has, so the cel inputs keep their locations.
 */
const CEL_FADED_VARYINGS = [...CEL_VARYINGS, { name: "vBody", type: "u32", interpolate: "flat" }] as const;

/** The mask's pixel: that body's bloom, as `GlowPass`'s mask material wrote a mesh's `glowColor`. */
const BODY_GLOW_SURFACE = /* wgsl */ `
fn bodyGlowSurface() -> vec4f {
  return bodyGlow[fragmentInputs.vBody];
}
`;

/**
 * THE SCREEN DOOR (X4.1e): a fading body's pixel is drawn while its fade is
 * above the pixel's place in a 4x4 Bayer matrix and discarded otherwise —
 * so a fade of f keeps round(16 f) of every 4x4 tile, the kept set only
 * ever shrinking as f falls. Keyed on the PIXEL and nothing else: no clock,
 * no frame count, so a still body under a still camera keeps the same
 * pixels every frame. The matrix is the bit pattern of `x ^ y` and `y`
 * interleaved and reversed (row y: 0 8 2 10 / 12 4 14 6 / 3 11 1 9 /
 * 15 7 13 5). Every pass a body draws into is full-size, so the main pass's
 * visor and its mask twin, one vertex module, drop the SAME pixels: a
 * discarded pixel never blooms.
 */
const SCREEN_DOOR = /* wgsl */ `
fn bodyScreenDoor() {
  let p = vec2u(fragmentInputs.position.xy) & vec2u(3u);
  let z = p.x ^ p.y;
  let rank = ((z & 1u) << 3u) | ((p.y & 1u) << 2u) | (z & 2u) | ((p.y & 2u) >> 1u);
  if (bodyFade[fragmentInputs.vBody] * 16.0 - 0.5 <= f32(rank)) {
    discard;
  }
}
`;

/** A surface `name` behind the screen door: the door first, then the body's own pixel, unchanged. */
function doored(name: string): string {
  return `${SCREEN_DOOR}
fn ${name}Doored() -> vec4f {
  bodyScreenDoor();
  return ${name}();
}
`;
}

/**
 * `main`'s decode: the rank and the corner off the vertex index, the
 * segment the body draws at that rank, and the vertex its range names — or,
 * for a corner past the range or a segment switched off (a zero matrix),
 * nothing: its corner outside the x plane, clipped under either depth
 * convention, before an attribute is read.
 */
function decode(segments: number, span: number, ranges: number): string {
  return [
    `  let rank = vertexIndex / ${span}u;`,
    `  let corner = vertexIndex % ${span}u;`,
    `  let kit = bodyOrder[instanceIndex * ${segments + 1}u];`,
    `  let seg = bodyOrder[instanceIndex * ${segments + 1}u + 1u + rank];`,
    `  let range = ${ranges}u + (kit * ${segments}u + seg) * 2u;`,
    `  let at = (instanceIndex * ${segments}u + seg) * 4u;`,
    "  if (corner >= indexData[range + 1u] || bodyMatrices[at + 3u].w == 0.0) {",
    "    vertexOutputs.position = vec4f(2.0, 2.0, 2.0, 1.0);",
    "    return vertexOutputs;",
    "  }",
    "  let vertex = indexData[indexData[range] + corner];",
  ].join("\n");
}

/** `main`'s prelude: `world`, the body's segment matrix, every column read whole. */
const WORLD_PRELUDE = "  instance.world = mat4x4f(bodyMatrices[at], bodyMatrices[at + 1u], bodyMatrices[at + 2u], bodyMatrices[at + 3u]);";

/** The same, and the pixel handed its body (`vBody`): the visor's prelude, and a fading body's. */
const VISOR_PRELUDE = [WORLD_PRELUDE, "  vertexOutputs.vBody = instanceIndex;"].join("\n");

/** The private block both stages' `uniforms.world` is routed to. */
const WORLD_PRIVATE = { var: "instance", struct: "BodyInstance", fields: [{ name: "world", type: "mat4x4f" }] } as const;

/** The programs — three plain, three faded — ready for `PipelineCache`. */
export interface BodyPrograms {
  /** The matte segments, in the main pass. */
  readonly cel: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
  /** The visor, in the main pass: the emissive palette's own pixel. */
  readonly visor: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
  /** The visor in the glow's mask: the SAME vertex module, and the body's bloom. */
  readonly mask: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
  /**
   * The three again for a FADING body, behind the screen door (X4.1e): the
   * same bodies and the same pixel, the door in front of it, and each
   * instance's fade read in the fragment (`BODY_FADE`, group 3). The matte
   * segments' vertex stage is the plain one handing the pixel its body
   * (`vBody`) as well; the visor's is the plain one's own module, which
   * already does, so the four visor pipelines are one vertex module.
   */
  readonly faded: {
    readonly cel: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
    readonly visor: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
    readonly mask: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
  };
}

/** Programs by their shape, assembled once a shape. */
const built = new Map<string, BodyPrograms>();

/**
 * The six programs (three plain, three faded) for `kits` kits of `segments`
 * segments, the matte draw's
 * corners `celSpan` a rank and the visor's `visorSpan` (each the longest
 * range that program draws).
 */
export function bodyPrograms(kits: number, segments: number, celSpan: number, visorSpan: number): BodyPrograms {
  const key = `${kits}|${segments}|${celSpan}|${visorSpan}`;
  let programs = built.get(key);
  if (programs) return programs;
  if (FRAME_TARGETS.flipY !== GLOW_TARGETS.flipY) {
    // One vertex module for both passes is the mask's tie (the header).
    throw new Error("bodyPrograms: the main pass and the glow's mask flip differently; one visor stage cannot serve both");
  }
  const cel: VertexProgram = {
    label: "body-cel-vertex",
    groups: [[FRAME_BLOCK], [], BODY_GEOMETRY],
    attributes: CEL_ATTRIBUTES,
    varyings: CEL_VARYINGS,
    includes: WGSL_CHUNKS,
    body: "#include<celVertex>",
    entry: "celVertex",
    privates: [WORLD_PRIVATE],
    instanced: true,
    pull: { vertex: "vertex", decode: decode(segments, celSpan, 0) },
    prelude: WORLD_PRELUDE,
  };
  const visor: VertexProgram = {
    label: "body-visor-vertex",
    groups: [[FRAME_BLOCK], [], BODY_GEOMETRY],
    attributes: EMISSIVE_ATTRIBUTES,
    varyings: VISOR_VARYINGS,
    includes: {},
    body: EMISSIVE_WORLD_VERTEX,
    entry: "emissiveWorldVertex",
    privates: [WORLD_PRIVATE],
    instanced: true,
    pull: { vertex: "vertex", decode: decode(segments, visorSpan, kits * segments * 2) },
    prelude: VISOR_PRELUDE,
  };
  const visorVertex = assembleVertex(visor, BODY_VISOR_DEFINES, FRAME_TARGETS);
  // The faded programs: a fragment group 3 of their own, an empty group 2
  // in the fragment (the geometry is the vertex stage's), and the door.
  const fadedGroups = (fragmentGroups: readonly (readonly Binding[])[]): readonly (readonly Binding[])[] => {
    const groups: (readonly Binding[])[] = [...fragmentGroups];
    while (groups.length < 3) groups.push([]);
    groups.push(BODY_FADE);
    return groups;
  };
  const glowGroups = [[FRAME_BLOCK, ...FRAME_TEXTURES], BODY_GLOW] as const;
  programs = {
    cel: {
      vertex: assembleVertex(cel, BODY_CEL_DEFINES, FRAME_TARGETS),
      fragment: celFragment(BODY_CEL_DEFINES, FRAME_TARGETS),
    },
    visor: { vertex: visorVertex, fragment: emissiveWorld(FRAME_TARGETS).fragment },
    mask: {
      vertex: visorVertex,
      fragment: assembleFragment(
        {
          label: "body-glow-fragment",
          // Group 0 is the cel fragment's whole group, unread, so the frame's
          // one bind group serves this pipeline as it serves the main pass's.
          groups: glowGroups,
          varyings: VISOR_VARYINGS,
          includes: {},
          body: BODY_GLOW_SURFACE,
          surface: "bodyGlowSurface",
        },
        BODY_VISOR_DEFINES,
        GLOW_TARGETS,
      ),
    },
    faded: {
      cel: {
        vertex: assembleVertex(
          {
            ...cel,
            label: "body-cel-faded-vertex",
            varyings: CEL_FADED_VARYINGS,
            prelude: VISOR_PRELUDE,
          },
          BODY_CEL_DEFINES,
          FRAME_TARGETS,
        ),
        fragment: assembleFragment(
          {
            ...CEL_FRAGMENT,
            label: "body-cel-faded",
            groups: fadedGroups(CEL_FRAGMENT.groups),
            varyings: CEL_FADED_VARYINGS,
            body: `${CEL_FRAGMENT.body}
${doored(CEL_FRAGMENT.surface)}`,
            surface: `${CEL_FRAGMENT.surface}Doored`,
          },
          BODY_CEL_DEFINES,
          FRAME_TARGETS,
        ),
      },
      visor: {
        vertex: visorVertex,
        fragment: assembleFragment(
          {
            // The palette's main-pass fragment (`emissiveWorld`), declared
            // again only to bind the fade and read the body.
            label: "body-visor-faded",
            groups: fadedGroups([[FRAME_BLOCK, ...FRAME_TEXTURES], [EMISSIVE_BLOCK]]),
            varyings: VISOR_VARYINGS,
            includes: {},
            body: `${EMISSIVE_WORLD_SURFACE}
${doored("emissiveWorldSurface")}`,
            surface: "emissiveWorldSurfaceDoored",
          },
          BODY_VISOR_DEFINES,
          FRAME_TARGETS,
        ),
      },
      mask: {
        vertex: visorVertex,
        fragment: assembleFragment(
          {
            label: "body-glow-faded",
            groups: fadedGroups(glowGroups),
            varyings: VISOR_VARYINGS,
            includes: {},
            body: `${BODY_GLOW_SURFACE}
${doored("bodyGlowSurface")}`,
            surface: "bodyGlowSurfaceDoored",
          },
          BODY_VISOR_DEFINES,
          GLOW_TARGETS,
        ),
      },
    },
  };
  built.set(key, programs);
  return programs;
}
