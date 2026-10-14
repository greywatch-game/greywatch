/**
 * render/HostBindGroup.ts — One bind group built from a group's DECLARED
 * entries: the uniform buffers our renderer owns, and the textures the host
 * owns, resolved through it every frame.
 * Owns: `HostBindGroup` — the entries' binding numbers for one variant, what
 * each texture resolved to last, and one `GPUBindGroup` per layout it has
 * been asked for.
 * Invariants: the binding numbers are `firstBindings`', the rule the WGSL is
 * declared by, so the group and the module are one statement; a texture is
 * the host's own view and sampler (`FrameHost.bind`), compared every frame
 * and never kept across a change — a group is re-made only on the frame
 * something behind one of its handles moved, and a group with a texture
 * missing is not made at all (null: the caller draws nothing); `refresh`
 * allocates nothing.
 * Never: imports Babylon; copies a texture; owns a buffer it was handed.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import type { BoundTexture, FrameHost, HostTexture } from "./frameHost";
import { firstBindings, type Binding } from "./wgsl/assemble";
import { guardHolds } from "./wgsl/layout";

/** One texture entry of the group, as last resolved. */
interface TextureSlot {
  readonly name: string;
  readonly sampler: number;
  readonly view: number;
  readonly bound: BoundTexture;
}

/** What a group's textures are looked up in: a handle per declared name. */
export type TextureHandles = { readonly [name: string]: HostTexture | null | undefined };

export class HostBindGroup {
  private readonly buffers: GPUBindGroupEntry[] = [];
  private readonly slots: TextureSlot[] = [];
  private readonly scratch: BoundTexture = { view: null, sampler: null };
  private readonly made = new Map<GPUBindGroupLayout, GPUBindGroup>();
  /** Every texture resolved to a view and a sampler at the last `refresh`. */
  private complete = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly label: string,
    entries: readonly Binding[],
    defines: Iterable<string>,
    /** The buffer behind each uniform entry the variant binds, by its `var`. */
    buffers: { readonly [variable: string]: GPUBuffer },
  ) {
    const variant = new Set(defines);
    const first = firstBindings(entries);
    entries.forEach((entry, e) => {
      if (!guardHolds(entry.when, variant)) return;
      if (entry.kind === "sampled") {
        this.slots.push({
          name: entry.name,
          sampler: first[e],
          view: first[e] + 1,
          bound: { view: null, sampler: null },
        });
        return;
      }
      // A block the variant leaves empty is not declared, so not bound
      // (`declareGroups`).
      if (!entry.fields.some((f) => guardHolds(f.when, variant))) return;
      const buffer = buffers[entry.var];
      if (!buffer) throw new Error(`${label}: no buffer for the block "${entry.var}"`);
      this.buffers.push({ binding: first[e], resource: { buffer } });
    });
  }

  /** Re-resolves every texture through `host`; call once a frame before `get`. */
  refresh(host: FrameHost, handles: TextureHandles): void {
    let complete = true;
    let changed = false;
    const scratch = this.scratch;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const handle = handles[slot.name];
      if (handle) host.bind(handle, scratch);
      else {
        scratch.view = null;
        scratch.sampler = null;
      }
      if (!scratch.view || !scratch.sampler) complete = false;
      if (scratch.view !== slot.bound.view || scratch.sampler !== slot.bound.sampler) {
        slot.bound.view = scratch.view;
        slot.bound.sampler = scratch.sampler;
        changed = true;
      }
    }
    if (changed) this.made.clear();
    this.complete = complete;
  }

  /** The group for `layout` as last refreshed, or null while a texture is missing. */
  get(layout: GPUBindGroupLayout): GPUBindGroup | null {
    if (!this.complete) return null;
    let group = this.made.get(layout);
    if (group) return group;
    const entries: GPUBindGroupEntry[] = [...this.buffers];
    for (const slot of this.slots) {
      entries.push({ binding: slot.sampler, resource: slot.bound.sampler! });
      entries.push({ binding: slot.view, resource: slot.bound.view! });
    }
    group = this.device.createBindGroup({ label: this.label, layout, entries });
    this.made.set(layout, group);
    return group;
  }
}
