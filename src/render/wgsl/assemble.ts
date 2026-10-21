/**
 * render/wgsl/assemble.ts — Our renderer's half of a shared WGSL body: its
 * DECLARATIONS, stated as data, and the one function that turns them and a
 * body into a plain WGSL module with explicit bind groups.
 * Owns: the declaration types (`FragmentProgram`, `VertexProgram`, `Binding`,
 * `UniformField`, `Varying`, `Attribute`, `PrivateBlock`, `Guard`, `StageTarget`);
 * `assembleFragment` and `assembleVertex`, which emit the stage's input and
 * output structs, the uniform structs, every `@group`/`@binding`, the
 * preprocessed body and the entry point — with Babylon's y flip for the kind
 * of pass the module is built for, and for a PULLED vertex stage the reads of
 * its attributes out of storage (`VertexProgram.pull`); and the two rewrites
 * that make a body written for Babylon's accessors read ours —
 * `uniforms.<name>` to the block that declares it, and a strided scalar
 * array's element to its `.el`.
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
 * WHY THE FLIP IS HERE AND NOT IN A BODY. Babylon draws a pass that renders
 * to a TEXTURE upside down, so a later sample reads it the GL way up
 * (`render/targets.ts`), and its shader processor writes that into every
 * module it compiles rather than into the source
 * (`webgpuShaderProcessorsWGSL.pure.js`, `finalizeShaders`): the vertex
 * stage's clip y times `yFactor_`, which is -1 into a texture and 1 onto the
 * canvas; and, in a fragment, every `dpdy` — and the position's y, as
 * `textureOutputHeight_ - y`, where the fragment reads
 * `fragmentInputs.position` — turned around ONTO THE CANVAS, where
 * `yFactor_` is 1. So a fragment built for a texture pass needs nothing, and
 * the vertex stage's flip is written here. A fragment for the CANVAS is
 * REFUSED: its position rule reads the render height, which the engine
 * rewrites on every resize (`_initializeMainAttachments`), and no frame field
 * carries it yet — nothing of ours draws onto the canvas before the game owns
 * the frame (`BABYLON_EXIT.md` X5), and the step that draws there owes the
 * frame that field. The dither keyed on the pixel (`celDither`) and the facet
 * normal off `dpdy` (`celSurface`) are what the rule exists for. The flip is
 * the PASS's, so it is written here, once, and never in a body.
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
import { guardHolds } from "./layout";
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
    }
  | {
      /** A read-only storage buffer — what a pulled attribute is read out of. */
      readonly kind: "storage";
      readonly name: string;
      /** `array<f32>`, `array<vec4f>`, … */
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

/**
 * One vertex attribute, read by a body as `vertexInputs.<name>`. Locations are
 * counted over the attributes the variant HAS, in list order.
 */
export interface Attribute {
  readonly name: string;
  /** `f32`, `vec2f`, `vec3f` or `vec4f` — every attribute here is float. */
  readonly type: string;
  readonly when?: Guard;
  /**
   * In a PULLED stage (`VertexProgram.pull`), the storage binding it is read
   * out of, declared as `PULLED_STORAGE` says its type is stored; a vertex
   * buffer's attribute has none.
   */
  readonly from?: string;
}

/**
 * The storage array a pulled attribute of each type is read out of. A
 * `vec3f` is three floats of an `array<f32>`, because an `array<vec3f>` in
 * storage is strided to 16 bytes and a vertex's arrays are packed tight.
 */
export const PULLED_STORAGE: Readonly<Record<string, string>> = {
  f32: "array<f32>",
  vec2f: "array<vec2f>",
  vec3f: "array<f32>",
  vec4f: "array<vec4f>",
};

/**
 * A block of values a vertex stage's `main` WRITES before calling the body,
 * declared `var<private>` and routed like a uniform block: a body reading
 * `uniforms.<name>` reads it from here. It is how one body is fed a value
 * that is a uniform on one side and per instance on the other — the scatter's
 * `world` (`BABYLON_EXIT.md` X3.4b).
 */
export interface PrivateBlock {
  readonly var: string;
  readonly struct: string;
  readonly fields: readonly UniformField[];
}

/** A vertex stage, declared: what a shared vertex body is assembled against. */
export interface VertexProgram {
  /** Names the program in every error and in the module's label. */
  readonly label: string;
  /** The bind groups, in group order. */
  readonly groups: readonly (readonly Binding[])[];
  readonly attributes: readonly Attribute[];
  /**
   * What it hands the fragment after `@builtin(position)`: the fragment
   * program's own `varyings`, the same list, so the locations agree.
   */
  readonly varyings: readonly Varying[];
  /** What `#include` resolves against. */
  readonly includes: Readonly<Record<string, string>>;
  /** The body: directives allowed, declarations not. */
  readonly body: string;
  /** The body's function that fills `vertexOutputs`, called by `main`. */
  readonly entry: string;
  /** Blocks `main` writes before the body runs — see `PrivateBlock`. */
  readonly privates?: readonly PrivateBlock[];
  /**
   * WGSL statements `main` runs after it has copied its inputs into
   * `vertexInputs` and before it calls `entry`: where a `PrivateBlock` is
   * written. In a pulled stage it runs FIRST, and defines the `u32` the
   * attributes are read at when that is not `vertexIndex` itself (`pull`).
   */
  readonly prelude?: string;
  /** WGSL at module scope, after the bind groups: constants the prelude reads. */
  readonly declarations?: string;
  /**
   * Set, the stage is PULLED: `main` takes `@builtin(vertex_index)
   * vertexIndex` and no vertex buffer, and reads every attribute out of its
   * `from` storage binding at the vertex this names — `vertexIndex`, or a
   * `u32` the prelude defines.
   */
  readonly pull?: string;
}

/** What kind of pass a module is built for: the one fact the flip turns on. */
export interface StageTarget {
  /** The pass renders to a texture Babylon flips (`PassTargets.flipY`). */
  readonly flipY: boolean;
}

/** One attribute as a variant resolved it: what its buffer is built and bound from. */
export interface AssembledAttribute {
  readonly name: string;
  readonly type: string;
  /** A vertex buffer's attribute: its location; null in a pulled stage. */
  readonly location: number | null;
  /** A pulled attribute: the storage binding it is read out of; null otherwise. */
  readonly from: string | null;
}

/** A vertex module, and the attributes it reads. */
export interface AssembledVertex extends AssembledModule {
  readonly attributes: readonly AssembledAttribute[];
}

/** One binding as a variant resolved it — what a bind-group layout is built from. */
export interface AssembledBinding {
  readonly group: number;
  readonly binding: number;
  readonly kind: "uniform" | "sampler" | "texture" | "storage";
  readonly name: string;
  /** The WGSL type: the struct's name, `sampler`, the texture type, or the storage array's. */
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
  target: StageTarget,
): AssembledModule {
  const variant = new Set(defines);
  const tag = `${program.label} [${[...variant].sort().join("+")}]`;
  const holds = (when?: Guard): boolean => guardHolds(when, variant);
  if (!target.flipY) {
    throw new Error(
      `${tag}: a fragment for the canvas owes Babylon's position rule the render height, ` +
        "which no frame field carries yet (see the header)",
    );
  }

  const lines: string[] = [];
  for (const d of program.diagnosticsOff ?? []) lines.push(`diagnostic(off, ${d});`);

  lines.push("struct FragmentInputs {", "  @builtin(position) position: vec4f,");
  program.varyings
    .filter((v) => holds(v.when))
    .forEach((v, location) => lines.push(`  @location(${location}) ${v.name}: ${v.type},`));
  lines.push("}", "var<private> fragmentInputs: FragmentInputs;");

  const declared = declareGroups(program.groups, variant, tag);
  lines.push(...declared.lines);

  const body = bindUniforms(
    preprocess(program.body, { defines: variant, includes: program.includes, label: tag }),
    declared.owner,
    declared.strided,
    tag,
  );
  // Into a texture, Babylon's processor leaves the fragment as written.
  lines.push(body);

  lines.push(
    "@fragment",
    "fn main(input: FragmentInputs) -> @location(0) vec4f {",
    "  fragmentInputs = input;",
    `  return ${program.surface}();`,
    "}",
  );
  return { label: tag, code: lines.join("\n"), bindings: declared.bindings };
}

/** The variant `defines` of a vertex stage, for a pass of `target`'s kind. */
export function assembleVertex(
  program: VertexProgram,
  defines: Iterable<string>,
  target: StageTarget,
): AssembledVertex {
  const variant = new Set(defines);
  const tag = `${program.label} [${[...variant].sort().join("+")}]`;
  const holds = (when?: Guard): boolean => guardHolds(when, variant);
  const pull = program.pull;

  const attributes: AssembledAttribute[] = program.attributes
    .filter((a) => holds(a.when))
    .map((a, location) => {
      if ((pull === undefined) !== (a.from === undefined)) {
        throw new Error(`${tag}: "${a.name}" names its storage when, and only when, the stage is pulled`);
      }
      return { name: a.name, type: a.type, location: pull === undefined ? location : null, from: a.from ?? null };
    });
  const lines = ["struct VertexInputs {"];
  for (const a of attributes) {
    lines.push(a.location === null ? `  ${a.name}: ${a.type},` : `  @location(${a.location}) ${a.name}: ${a.type},`);
  }
  lines.push("}", "var<private> vertexInputs: VertexInputs;");

  lines.push("struct FragmentInputs {", "  @builtin(position) position: vec4f,");
  program.varyings
    .filter((v) => holds(v.when))
    .forEach((v, location) => lines.push(`  @location(${location}) ${v.name}: ${v.type},`));
  lines.push("}", "var<private> vertexOutputs: FragmentInputs;");

  const declared = declareGroups(program.groups, variant, tag);
  lines.push(...declared.lines);
  const owner = new Map(declared.owner);
  for (const block of program.privates ?? []) {
    const members: string[] = [];
    for (const f of block.fields) {
      if (!guardHolds(f.when, variant)) continue;
      if (owner.has(f.name)) throw new Error(`${tag}: uniform "${f.name}" is declared twice`);
      if (f.count !== undefined) throw new Error(`${tag}: private "${f.name}" may not be an array`);
      owner.set(f.name, block.var);
      members.push(`  ${f.name}: ${f.type},`);
    }
    if (members.length === 0) continue;
    lines.push(`struct ${block.struct} {`, ...members, "}", `var<private> ${block.var}: ${block.struct};`);
  }
  if (program.declarations) lines.push(program.declarations);
  lines.push(
    bindUniforms(
      preprocess(program.body, { defines: variant, includes: program.includes, label: tag }),
      owner,
      declared.strided,
      tag,
    ),
  );
  const prelude = program.prelude ? [program.prelude] : [];
  const inputs =
    pull === undefined
      ? ["fn main(input: VertexInputs) -> FragmentInputs {", "  vertexInputs = input;", ...prelude]
      : [
          "fn main(@builtin(vertex_index) vertexIndex: u32) -> FragmentInputs {",
          ...prelude,
          ...attributes.map((a) => `  vertexInputs.${a.name} = ${pullRead(a, pull, declared.bindings, tag)};`),
        ];
  lines.push(
    "@vertex",
    ...inputs,
    `  ${program.entry}();`,
    // Babylon's own line, with the factor its internals buffer holds for a
    // texture pass (the header).
    ...(target.flipY ? ["  vertexOutputs.position.y = vertexOutputs.position.y * -1.0;"] : []),
    "  return vertexOutputs;",
    "}",
  );
  return { label: tag, code: lines.join("\n"), bindings: declared.bindings, attributes };
}

/**
 * The expression a pulled attribute is read with at vertex `index`, out of
 * its storage binding — which the variant must bind, stored as
 * `PULLED_STORAGE` says an attribute of its type is.
 */
function pullRead(a: AssembledAttribute, index: string, bindings: readonly AssembledBinding[], tag: string): string {
  const from = a.from!;
  const want = PULLED_STORAGE[a.type];
  const storage = bindings.find((b) => b.kind === "storage" && b.name === from);
  if (!want || !storage || storage.type !== want) {
    throw new Error(`${tag}: "${a.name}" is read out of "${from}", which this variant does not bind as ${want}`);
  }
  if (a.type !== "vec3f") return `${from}[${index}]`;
  return `vec3f(${from}[${index} * 3u], ${from}[${index} * 3u + 1u], ${from}[${index} * 3u + 2u])`;
}

/** What `declareGroups` hands back: the WGSL, what it binds, and how a body's names route. */
export interface Declared {
  /** The `Strided_` wrappers, then every struct and `@group`/`@binding` line. */
  readonly lines: readonly string[];
  readonly bindings: readonly AssembledBinding[];
  /** A uniform's name to the variable of the block that declares it. */
  readonly owner: ReadonlyMap<string, string>;
  /** The uniforms laid out as `Strided_` arrays, read through `.el`. */
  readonly strided: ReadonlySet<string>;
}

/**
 * The bind groups of a program, declared for one variant — what
 * `assembleFragment` and `assembleVertex` write above their bodies, so the
 * frame block is one declaration whichever stage reads it.
 */
export function declareGroups(
  groups: readonly (readonly Binding[])[],
  variant: ReadonlySet<string>,
  tag: string,
): Declared {
  const holds = (when?: Guard): boolean => guardHolds(when, variant);
  const owner = new Map<string, string>();
  const strided = new Set<string>();
  const wrappers = new Set<string>();
  const bindings: AssembledBinding[] = [];
  const declare: string[] = [];

  groups.forEach((entries, group) => {
    const first = firstBindings(entries);
    entries.forEach((entry, e) => {
      const at = first[e];
      if (!holds(entry.when)) return;
      const prefix = `@group(${group}) @binding(${at})`;
      if (entry.kind === "storage") {
        declare.push(`${prefix} var<storage, read> ${entry.name}: ${entry.type};`);
        bindings.push({ group, binding: at, kind: "storage", name: entry.name, type: entry.type });
        return;
      }
      if (entry.kind === "sampled") {
        const sampler = `${entry.name}Sampler`;
        declare.push(`${prefix} var ${sampler}: sampler;`);
        declare.push(`@group(${group}) @binding(${at + 1}) var ${entry.name}: ${entry.type};`);
        bindings.push({ group, binding: at, kind: "sampler", name: sampler, type: "sampler" });
        bindings.push({ group, binding: at + 1, kind: "texture", name: entry.name, type: entry.type });
        return;
      }
      const members: string[] = [];
      for (const f of entry.fields) {
        if (!holds(f.when)) continue;
        if (owner.has(f.name)) {
          throw new Error(`${tag}: uniform "${f.name}" is declared twice`);
        }
        owner.set(f.name, entry.var);
        members.push(`  ${memberDecl(f, tag, strided, wrappers)},`);
      }
      // A struct may not be empty; a block the variant leaves nothing in is
      // not bound, and keeps its number for the variants that do bind it.
      if (members.length === 0) return;
      declare.push(`struct ${entry.struct} {`, ...members, "}");
      declare.push(`${prefix} var<uniform> ${entry.var}: ${entry.struct};`);
      bindings.push({ group, binding: at, kind: "uniform", name: entry.var, type: entry.struct });
    });
  });

  const lines = [
    ...[...wrappers].map((t) => `struct ${stridedName(t)} { @size(16) el: ${t} }`),
    ...declare,
  ];
  return { lines, bindings, owner, strided };
}

/**
 * The binding number each entry of a group starts at: its place in the list,
 * counted over EVERY entry whatever the variant, a `sampled` one taking two
 * (its sampler, then itself) — so an entry keeps its number in every variant,
 * and a bind group is built from the same numbers the WGSL is declared with.
 */
export function firstBindings(entries: readonly Binding[]): number[] {
  const out: number[] = [];
  let binding = 0;
  for (const entry of entries) {
    out.push(binding);
    binding += entry.kind === "sampled" ? 2 : 1;
  }
  return out;
}

/** A member's declaration: an array's `@align` goes before its NAME, not its type. */
function memberDecl(
  f: UniformField,
  tag: string,
  strided: Set<string>,
  wrappers: Set<string>,
): string {
  const type = fieldType(f, tag, strided, wrappers);
  const align = "@align(16) ";
  return type.startsWith(align) ? `${align}${f.name}: ${type.slice(align.length)}` : `${f.name}: ${type}`;
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
  // `@align(16)` because the uniform address space REQUIRES an array at a
  // multiple of 16 and WGSL does not put it there: a `Strided_f32` array is
  // aligned like an `f32`, so after a member ending off a 16-byte boundary
  // the module is rejected. Where it is already aligned this is a no-op, and
  // `layout.ts` places every array at 16 either way.
  if (stride % 16 === 0) return `@align(16) array<${f.type}, ${f.count}>`;
  strided.add(f.name);
  wrappers.add(f.type);
  return `@align(16) array<${stridedName(f.type)}, ${f.count}>`;
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
