/**
 * render/wgsl/assemble.ts — Our renderer's half of a shared WGSL body: its
 * DECLARATIONS, stated as data, and the one function that turns them and a
 * body into a plain WGSL module with explicit bind groups.
 * Owns: the declaration types (`FragmentProgram`, `Binding`, `UniformField`,
 * `Varying`, `Guard`); `assembleFragment`, which emits the inputs struct, the
 * uniform structs, every `@group`/`@binding`, the preprocessed body and the
 * entry point; and the two rewrites that make a body written for Babylon's
 * accessors read ours — `uniforms.<name>` to the block that declares it, and a
 * strided scalar array's element to its `.el`.
 * Invariants: a binding's number is its place in its group's list, counted
 * over every entry whatever the variant (a texture entry takes two: its
 * sampler, then itself), so a binding keeps its number in every variant of a
 * program; a body that reads `uniforms.<name>` with no active field of that
 * name FAILS here, naming the program, the field and the variant; the output
 * is plain WGSL — no directive, no `uniform`/`varying`, nothing a driver needs
 * Babylon to read.
 * Never: imports Babylon; reads a body to decide what to declare — the
 * declarations are the program's to state and the body's to be checked
 * against.
 * Contract: `docs/rendering.md`, "Hand-written WGSL".
 *
 * WHY DATA RATHER THAN DECLARATION TEXT. The same list that writes the WGSL
 * is what the pipeline's bind-group layouts and the uniform uploads will be
 * built from (`BABYLON_EXIT.md` X3.2), and a list is a thing those can read;
 * a struct written as text is a second statement of the same layout. What it
 * hands back beside the code (`bindings`) is that list resolved for one
 * variant.
 *
 * WHY THE REWRITE. A shared body is written against Babylon's spelling, which
 * puts every uniform of a shader in ONE struct called `uniforms` — the one
 * spelling a body can have that both sides honour. Ours splits them by how
 * often they change (a frame's against a material's), so `uniforms.lightDir`
 * becomes `frame.lightDir`; the body does not know or care which block a name
 * is in, and moving a field between blocks moves no body.
 *
 * WHY `.el`. A uniform-address-space array must have a 16-byte stride, so an
 * `array<f32, N>` cannot be declared there. Babylon lays such an array out as
 * an array of one-member structs padded to 16 bytes and rewrites each index
 * `name[i]` to `name[i].el`; this does the same, which is what keeps one body
 * reading `uniforms.pointRange[i]` on both sides. Unlike Babylon's regex the
 * bracket is MATCHED here rather than taken non-greedily, so an index that
 * itself contains a `]` is safe on this side — but a body still may not
 * write one, because the same text goes through Babylon's
 * (`docs/rendering.md` has the trap).
 */
import { preprocess } from "./preprocess";

/**
 * When a declaration is part of a variant: every entry holds, each a define
 * that must be present (`"CEL_BUMP"`) or absent (`"!CEL_GROUND_TEX"`). Absent
 * or empty is every variant.
 */
export type Guard = readonly string[];

/** One member of a uniform block. `count` makes it an array of that many. */
export interface UniformField {
  readonly name: string;
  /** The element's WGSL type: `f32`, `vec3f`, `mat4x4f`, … */
  readonly type: string;
  readonly count?: number;
  readonly when?: Guard;
}

/**
 * One entry in a bind group. A `sampled` texture is declared as the pair a
 * body names it by — `<name>Sampler` and `<name>` — at two consecutive
 * bindings, which is the convention every shared body is written to.
 */
export type Binding =
  | {
      readonly kind: "uniform";
      /** The variable a body's `uniforms.<field>` is routed to. */
      readonly var: string;
      readonly struct: string;
      readonly fields: readonly UniformField[];
      readonly when?: Guard;
    }
  | {
      readonly kind: "sampled";
      readonly name: string;
      /** `texture_2d<f32>`, `texture_3d<f32>`, `texture_cube<f32>`, … */
      readonly type: string;
      readonly when?: Guard;
    };

/**
 * One interpolated input. Locations are counted over the inputs the variant
 * HAS, in list order — Babylon's rule, so a guarded input is best kept last.
 */
export interface Varying {
  readonly name: string;
  readonly type: string;
  readonly when?: Guard;
}

/** A fragment stage, declared: what a shared body is assembled against. */
export interface FragmentProgram {
  /** Names the program in every error and in the module's label. */
  readonly label: string;
  /** Diagnostics turned off for the whole module, e.g. `derivative_uniformity`. */
  readonly diagnosticsOff?: readonly string[];
  /** The bind groups, in group order. */
  readonly groups: readonly (readonly Binding[])[];
  /** Fragment inputs after `@builtin(position) position`, which is always first. */
  readonly varyings: readonly Varying[];
  /** What `#include` resolves against. */
  readonly includes: Readonly<Record<string, string>>;
  /** The body: directives allowed, declarations not. */
  readonly body: string;
  /** The body's function that returns the pixel's colour, called by `main`. */
  readonly surface: string;
}

/** One binding as a variant resolved it — what a bind-group layout is built from. */
export interface AssembledBinding {
  readonly group: number;
  readonly binding: number;
  readonly kind: "uniform" | "sampler" | "texture";
  readonly name: string;
  /** The WGSL type: the struct's name, `sampler`, or the texture type. */
  readonly type: string;
}

/** A module ready for `createShaderModule`, and what it binds. */
export interface AssembledModule {
  readonly label: string;
  readonly code: string;
  readonly bindings: readonly AssembledBinding[];
}

/**
 * The stride each array element type a uniform block may hold takes in an
 * array, for the one question asked of it: is it already the multiple of 16 a
 * uniform array needs. A `vec3f` is 12 bytes and aligned to 16, so it is.
 * A type missing here may not be an array member.
 */
const ELEMENT_STRIDE: Readonly<Record<string, number>> = {
  f32: 4,
  i32: 4,
  u32: 4,
  vec2f: 8,
  vec3f: 16,
  vec4f: 16,
  mat4x4f: 64,
};

/** The variant `defines` assembled: one module, every directive resolved. */
export function assembleFragment(
  program: FragmentProgram,
  defines: Iterable<string>,
): AssembledModule {
  const variant = new Set(defines);
  const tag = `${program.label} [${[...variant].sort().join("+")}]`;
  const holds = (when?: Guard): boolean =>
    (when ?? []).every((d) =>
      d.startsWith("!") ? !variant.has(d.slice(1)) : variant.has(d),
    );

  const lines: string[] = [];
  for (const d of program.diagnosticsOff ?? []) lines.push(`diagnostic(off, ${d});`);

  lines.push("struct FragmentInputs {", "  @builtin(position) position: vec4f,");
  program.varyings
    .filter((v) => holds(v.when))
    .forEach((v, location) => lines.push(`  @location(${location}) ${v.name}: ${v.type},`));
  lines.push("}", "var<private> fragmentInputs: FragmentInputs;");

  const owner = new Map<string, string>();
  const strided = new Set<string>();
  const wrappers = new Set<string>();
  const bindings: AssembledBinding[] = [];
  const declare: string[] = [];

  program.groups.forEach((entries, group) => {
    let binding = 0;
    for (const entry of entries) {
      const at = binding;
      binding += entry.kind === "sampled" ? 2 : 1;
      if (!holds(entry.when)) continue;
      const prefix = `@group(${group}) @binding(${at})`;
      if (entry.kind === "sampled") {
        const sampler = `${entry.name}Sampler`;
        declare.push(`${prefix} var ${sampler}: sampler;`);
        declare.push(`@group(${group}) @binding(${at + 1}) var ${entry.name}: ${entry.type};`);
        bindings.push({ group, binding: at, kind: "sampler", name: sampler, type: "sampler" });
        bindings.push({ group, binding: at + 1, kind: "texture", name: entry.name, type: entry.type });
        continue;
      }
      const members: string[] = [];
      for (const f of entry.fields) {
        if (!holds(f.when)) continue;
        if (owner.has(f.name)) {
          throw new Error(`${tag}: uniform "${f.name}" is declared twice`);
        }
        owner.set(f.name, entry.var);
        members.push(`  ${f.name}: ${fieldType(f, tag, strided, wrappers)},`);
      }
      // A struct may not be empty; a block the variant leaves nothing in is
      // not bound, and keeps its number for the variants that do bind it.
      if (members.length === 0) continue;
      declare.push(`struct ${entry.struct} {`, ...members, "}");
      declare.push(`${prefix} var<uniform> ${entry.var}: ${entry.struct};`);
      bindings.push({ group, binding: at, kind: "uniform", name: entry.var, type: entry.struct });
    }
  });

  for (const type of wrappers) lines.push(`struct ${stridedName(type)} { @size(16) el: ${type} }`);
  lines.push(...declare);

  const body = preprocess(program.body, {
    defines: variant,
    includes: program.includes,
    label: tag,
  });
  lines.push(bindUniforms(body, owner, strided, tag));

  lines.push(
    "@fragment",
    "fn main(input: FragmentInputs) -> @location(0) vec4f {",
    "  fragmentInputs = input;",
    `  return ${program.surface}();`,
    "}",
  );
  return { label: tag, code: lines.join("\n"), bindings };
}

/** A field's WGSL type, wrapping an array element whose stride is not 16. */
function fieldType(
  f: UniformField,
  tag: string,
  strided: Set<string>,
  wrappers: Set<string>,
): string {
  if (f.count === undefined) return f.type;
  const stride = ELEMENT_STRIDE[f.type];
  if (stride === undefined) {
    throw new Error(`${tag}: "${f.name}" is an array of ${f.type}, which has no stride rule`);
  }
  if (stride % 16 === 0) return `array<${f.type}, ${f.count}>`;
  strided.add(f.name);
  wrappers.add(f.type);
  return `array<${stridedName(f.type)}, ${f.count}>`;
}

function stridedName(type: string): string {
  return `Strided_${type}`;
}

/**
 * The body with every `uniforms.<name>` routed to the block that declares
 * `name`, and a strided array's indexed element read through `.el`.
 */
function bindUniforms(
  src: string,
  owner: ReadonlyMap<string, string>,
  strided: ReadonlySet<string>,
  tag: string,
): string {
  const ref = /\buniforms\.([A-Za-z_]\w*)/g;
  let out = "";
  let from = 0;
  for (let m = ref.exec(src); m !== null; m = ref.exec(src)) {
    const name = m[1];
    const block = owner.get(name);
    if (block === undefined) {
      throw new Error(`${tag}: the body reads uniforms.${name}, which no binding declares`);
    }
    out += `${src.slice(from, m.index)}${block}.${name}`;
    from = m.index + m[0].length;
    if (!strided.has(name)) continue;
    let open = from;
    while (/\s/.test(src[open] ?? "")) open++;
    if (src[open] !== "[") {
      throw new Error(`${tag}: ${name} is a strided array and is read whole`);
    }
    let close = open;
    for (let depth = 0; close < src.length; close++) {
      if (src[close] === "[") depth++;
      else if (src[close] === "]" && --depth === 0) break;
    }
    if (close >= src.length) throw new Error(`${tag}: ${name}[ is never closed`);
    out += `${src.slice(from, open + 1)}${bindUniforms(src.slice(open + 1, close), owner, strided, tag)}].el`;
    from = close + 1;
    ref.lastIndex = from;
  }
  return out + src.slice(from);
}
