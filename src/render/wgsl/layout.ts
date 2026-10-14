/**
 * render/wgsl/layout.ts — Where each member of a uniform block sits in its
 * buffer, by WGSL's rules for the uniform address space: the one statement of
 * the byte layout the declarations in `assemble.ts` compile to.
 * Owns: `blockLayout` — a uniform `Binding`'s fields resolved for one variant
 * into offsets, strides and a size — and the alignment and size table it is
 * computed from (`TYPES`).
 * Invariants: the layout is the one `assemble.ts` emits for the same variant,
 * member for member: the same fields in the same order under the same guards,
 * and an array whose element is not 16 bytes apart laid out as the `Strided_`
 * wrapper it is declared as — so a value written at `offset + i * stride` is
 * the one the shader reads at `name[i]`; a type missing from the table FAILS
 * rather than being guessed at.
 * Never: imports Babylon; reads a WGSL string — it is computed from the same
 * data the WGSL is written from, which is what keeps the two one statement.
 * Contract: `docs/rendering.md`, "Hand-written WGSL"; the rules are the WGSL
 * spec's "Memory Layout" (AlignOf, SizeOf, and the uniform address space's
 * roundUp(16) on an array and a struct member).
 *
 * WHY NOT BABYLON'S LAYOUT. Babylon packs a `ShaderMaterial`'s uniforms by its
 * own `UniformBuffer` rules, which happen to agree with WGSL's for what it
 * declares; ours are declared as data (`assemble.ts`) and uploaded by us
 * (`FrameUniformBuffer`), so the rule that places them is WGSL's and nothing
 * else's. Nothing here ever has to agree with a Babylon buffer, because no
 * buffer is shared: the frame's block is written from `FrameUniforms`, a plain
 * struct, never copied from a material.
 */
import type { Binding, Guard, UniformField } from "./assemble";

/** WGSL's AlignOf and SizeOf for each type a uniform member may be. */
const TYPES: Readonly<Record<string, { readonly align: number; readonly size: number }>> = {
  f32: { align: 4, size: 4 },
  i32: { align: 4, size: 4 },
  u32: { align: 4, size: 4 },
  vec2f: { align: 8, size: 8 },
  vec3f: { align: 16, size: 12 },
  vec4f: { align: 16, size: 16 },
  mat4x4f: { align: 16, size: 64 },
};

/** One member, placed. Offsets and strides are in BYTES. */
export interface FieldLayout {
  readonly name: string;
  readonly type: string;
  /** How many floats one element holds (12 bytes of `vec3f` is 3). */
  readonly components: number;
  readonly offset: number;
  /** Elements in an array; 1 for a plain member. */
  readonly count: number;
  /** Bytes from one element to the next; the element's size for a plain member. */
  readonly stride: number;
}

/** A uniform block resolved for one variant. */
export interface BlockLayout {
  readonly struct: string;
  /** The buffer's size in bytes: the struct's, rounded to its alignment. */
  readonly size: number;
  readonly fields: readonly FieldLayout[];
}

/** Whether a guard holds for a variant: the one rule `assemble.ts` and this file share. */
export function guardHolds(when: Guard | undefined, variant: ReadonlySet<string>): boolean {
  return (when ?? []).every((d) =>
    d.startsWith("!") ? !variant.has(d.slice(1)) : variant.has(d),
  );
}

/** Where each active member of `block` sits in its buffer for `variant`. */
export function blockLayout(
  block: Extract<Binding, { kind: "uniform" }>,
  defines: Iterable<string>,
): BlockLayout {
  const variant = new Set(defines);
  const fields: FieldLayout[] = [];
  let at = 0;
  let structAlign = 16;
  for (const f of block.fields) {
    if (!guardHolds(f.when, variant)) continue;
    const placed = place(f, at, block.struct);
    fields.push(placed.field);
    structAlign = Math.max(structAlign, placed.align);
    at = placed.field.offset + placed.bytes;
  }
  return { struct: block.struct, size: roundUp(at, structAlign), fields };
}

function place(
  f: UniformField,
  at: number,
  struct: string,
): { field: FieldLayout; align: number; bytes: number } {
  const t = TYPES[f.type];
  if (t === undefined) throw new Error(`${struct}.${f.name}: no layout rule for ${f.type}`);
  const components = t.size / 4;
  if (f.count === undefined) {
    const offset = roundUp(at, t.align);
    return {
      field: { name: f.name, type: f.type, components, offset, count: 1, stride: t.size },
      align: t.align,
      bytes: t.size,
    };
  }
  // An array in the uniform address space is aligned to 16 and strides by a
  // multiple of 16 — the element's own size when it already is one, or the
  // `Strided_` wrapper's `@size(16)` (`assemble.ts`) when it is not.
  const stride = roundUp(t.size, 16);
  const offset = roundUp(at, 16);
  return {
    field: { name: f.name, type: f.type, components, offset, count: f.count, stride },
    align: 16,
    bytes: stride * f.count,
  };
}

function roundUp(n: number, k: number): number {
  return Math.ceil(n / k) * k;
}
