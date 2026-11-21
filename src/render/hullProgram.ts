/**
 * render/hullProgram.ts — The HULLS' program: every hull drawn as an
 * instance of its kind's kit (`BABYLON_EXIT.md` X4.2b) — the cel stage over
 * its segments, the kit palette its own — declared for our renderer.
 * X4.1d's body program, the decode its own: a hull has no visor and nothing
 * in the glow's mask, and is painted CHARRED by a flag rather than by a
 * second kit — and the same program again behind the bodies' SCREEN DOOR for
 * a hull fading out at its map's draw distance (X4.2d).
 * Owns: `HULL_CHARRED` (the kit word's bit that says so), `HULL_CEL_DEFINES`,
 * and `hullPrograms`, the two programs' modules (plain and faded) for kits
 * of `segments` segments.
 * Invariants: the vertex and pixel BODIES are the cel material's own
 * (`celVertex`, `celFragment`), never restated, and the bind groups are the
 * bodies' (`BODY_GEOMETRY`, eight storage arrays, WebGPU's default per-stage
 * ceiling) — what is a hull's here is the DECODE. An instance is a HULL; a
 * draw is one RANK of every hull — its `rank`th segment nearest the eye
 * (`bodyOrder`, after the hull's kit word: the order Babylon's front-to-back
 * queue drew a hull's meshes in, which decides which of two segments wins an
 * equal depth: the later) — and a vertex is a corner of that segment, its
 * index read out of `indexData` through the segment's range in the hull's
 * kit, a table at the head of the same array; the rank is the vertex index's
 * quotient by the SPAN (the longest range drawn, which each draw's
 * `firstVertex` steps by), the corner its remainder, and a corner past its
 * segment's range — or of a segment whose matrix is ZERO, past a narrower
 * kind's own segments, dropped by the size gate, or a DETAIL segment of a hull
 * the detail tier draws reduced (X4.2c) — is drawn as nothing, put
 * outside the clip volume before an attribute is read; `world` is that hull's
 * matrix for the segment — what Babylon's `freezeWorldMatrix` handed the
 * segment's mesh until X4.2b — read WHOLE, all sixteen floats out of storage
 * as Babylon's uniform held them; and a hull whose kit word carries
 * `HULL_CHARRED` reads the charred slot in `uv2.x` in place of its segment's
 * own, every corner of it — what a mesh repainted in the one charred material
 * drew. The FADED program is the plain one's vertex stage handing the pixel
 * its instance (`vBody`, flat, last) and the one faded cel pixel bodies are
 * drawn with too (`bodyProgram.fadedCelFragment`: the cel pixel behind the
 * screen door, the fade read in the fragment's group 3, `BODY_FADE`) — so
 * the vertex stage gains no storage array (eight is the ceiling), the door
 * is the bodies' to the bit, and nothing of the pixel is restated.
 * Never: imports Babylon; restates a body, the cel pixel or the door;
 * decides what a hull is, its order, its paint, its fade, or which draw.
 * Contract: `docs/rendering.md`, "The hulls, ours" and "Hand-written WGSL".
 */
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import { BODY_CEL_DEFINES, BODY_GEOMETRY, CEL_FADED_VARYINGS, fadedCelFragment } from "./bodyProgram";
import { CEL_VARYINGS, celFragment } from "./celFragment";
import { CEL_ATTRIBUTES } from "./celVertex";
import { FRAME_BLOCK } from "./frame";
import { FRAME_TARGETS } from "./targets";
import { assembleVertex, type AssembledModule, type AssembledVertex, type VertexProgram } from "./wgsl/assemble";

/** The kit word's top bit: the hull is drawn in the charred paint. The rest of the word is the kit. */
export const HULL_CHARRED = 0x80000000;

/** The segments' variant: the kit palette, a material's OWN (`celMaterial.ts`), as a body's matte segments'. */
export const HULL_CEL_DEFINES = BODY_CEL_DEFINES;

/**
 * `main`'s decode: the rank and the corner off the vertex index, the hull's
 * kit word (its kit, and whether it is charred), the segment it draws at that
 * rank, and the vertex its range names — or, for a corner past the range or
 * a segment switched off (a zero matrix), nothing: its corner outside the x
 * plane, clipped under either depth convention, before an attribute is read.
 */
function decode(segments: number, span: number): string {
  return [
    `  let rank = vertexIndex / ${span}u;`,
    `  let corner = vertexIndex % ${span}u;`,
    `  let word = bodyOrder[instanceIndex * ${segments + 1}u];`,
    `  let kit = word & ${(~HULL_CHARRED >>> 0).toString()}u;`,
    `  let seg = bodyOrder[instanceIndex * ${segments + 1}u + 1u + rank];`,
    `  let range = (kit * ${segments}u + seg) * 2u;`,
    `  let at = (instanceIndex * ${segments}u + seg) * 4u;`,
    "  if (corner >= indexData[range + 1u] || bodyMatrices[at + 3u].w == 0.0) {",
    "    vertexOutputs.position = vec4f(2.0, 2.0, 2.0, 1.0);",
    "    return vertexOutputs;",
    "  }",
    "  let vertex = indexData[indexData[range] + corner];",
  ].join("\n");
}

/**
 * `main`'s prelude: `world`, the hull's segment matrix, every column read
 * whole; and for a CHARRED hull the charred slot in place of the segment's
 * own — a whole number, as every slot is, which the pixel rounds.
 */
function prelude(charredSlot: number): string {
  return [
    "  instance.world = mat4x4f(bodyMatrices[at], bodyMatrices[at + 1u], bodyMatrices[at + 2u], bodyMatrices[at + 3u]);",
    `  if ((word & ${HULL_CHARRED}u) != 0u) {`,
    `    vertexInputs.uv2 = vec2f(${charredSlot.toFixed(1)}, 0.0);`,
    "  }",
  ].join("\n");
}

/** The private block both stages' `uniforms.world` is routed to. */
const WORLD_PRIVATE = { var: "instance", struct: "HullInstance", fields: [{ name: "world", type: "mat4x4f" }] } as const;

/** The programs — plain and faded — ready for `PipelineCache`. */
export interface HullPrograms {
  /** Every segment, in the main pass. */
  readonly cel: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
  /**
   * The same for a FADING hull (X4.2d): the plain vertex stage handing the
   * pixel its instance (`vBody`), and the cel pixel behind the bodies' screen
   * door, its fade read in group 3 (`BODY_FADE`).
   */
  readonly faded: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule };
}

/** Programs by their shape, assembled once a shape. */
const built = new Map<string, HullPrograms>();

/**
 * The program for kits of `segments` segments, its corners `span` a rank (the
 * longest range drawn), the charred paint `charredSlot` in the kit palette.
 */
export function hullPrograms(segments: number, span: number, charredSlot: number): HullPrograms {
  const key = `${segments}|${span}|${charredSlot}`;
  let programs = built.get(key);
  if (programs) return programs;
  if (!Number.isInteger(charredSlot) || charredSlot < 1) {
    throw new Error(`hullPrograms: the charred slot must be a 1-based palette slot, not ${charredSlot}`);
  }
  const cel: VertexProgram = {
    label: "hull-cel-vertex",
    groups: [[FRAME_BLOCK], [], BODY_GEOMETRY],
    attributes: CEL_ATTRIBUTES,
    varyings: CEL_VARYINGS,
    includes: WGSL_CHUNKS,
    body: "#include<celVertex>",
    entry: "celVertex",
    privates: [WORLD_PRIVATE],
    instanced: true,
    pull: { vertex: "vertex", decode: decode(segments, Math.max(1, span)) },
    prelude: prelude(charredSlot),
  };
  programs = {
    cel: {
      vertex: assembleVertex(cel, HULL_CEL_DEFINES, FRAME_TARGETS),
      fragment: celFragment(HULL_CEL_DEFINES, FRAME_TARGETS),
    },
    faded: {
      vertex: assembleVertex(
        {
          ...cel,
          label: "hull-cel-faded-vertex",
          varyings: CEL_FADED_VARYINGS,
          // The pixel's instance, for the fade: as a fading body's stage hands it.
          prelude: `${prelude(charredSlot)}
  vertexOutputs.vBody = instanceIndex;`,
        },
        HULL_CEL_DEFINES,
        FRAME_TARGETS,
      ),
      // `HULL_CEL_DEFINES` is `BODY_CEL_DEFINES`, the one shape that pixel is.
      fragment: fadedCelFragment(),
    },
  };
  built.set(key, programs);
  return programs;
}
