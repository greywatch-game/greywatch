/**
 * render/PipelineCache.ts — Every shader module, bind-group layout and render
 * pipeline our renderer draws with, built once and keyed on what makes one
 * different from another.
 * Owns: the three caches, and the rule that turns an assembled binding list
 * into a `GPUBindGroupLayout` (`layoutEntry`).
 * Invariants: a pipeline is keyed on its shader VARIANT (both modules'
 * CODE, which a label is not trusted to stand for), its VERTEX LAYOUT, its
 * TARGETS (`targetsKey`) and its fixed-function state, and nothing else
 * distinguishes two; it is built with `createRenderPipelineAsync`, so a
 * compile never stalls a frame and a caller asks AHEAD of the frame that
 * draws with it (`docs/rendering.md`: WebGPU compiles a pipeline on the
 * frame that first uses it, which is what the warm-up exists to move); a
 * compile that FAILS is not cached, so asking again retries it; every layout
 * is EXPLICIT, built from the bindings the modules were assembled with,
 * never `"auto"`, and layouts are shared by their entries — so a bind group
 * made for one pipeline binds into any other whose group has the same
 * entries (the frame block's always does when both stages see it alike; a
 * material's group differs per variant); the WINDING is derived, never
 * stated, by Babylon's rule (`webgpuEngine.pure.js`, "Front face", and
 * `Material._preBind`): a mesh in this left-handed scene is born
 * `CounterClockWiseSideOrientation` (`Mesh`'s constructor), which faces the
 * eye wound `"ccw"` on screen — and `"cw"` in a pass that flips y
 * (`PassTargets.flipY`), because the flip mirrors every triangle's turn. A
 * `reversed` mesh is the other way round in both.
 * Never: imports Babylon; builds a pipeline for targets it was not handed.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import type { PassTargets } from "./frameHost";
import { targetsKey } from "./targets";
import type { AssembledBinding } from "./wgsl/assemble";

/** A module ready for `createShaderModule`: its label is its variant's identity. */
export interface ShaderSource {
  readonly label: string;
  readonly code: string;
  readonly bindings: readonly AssembledBinding[];
}

/** The fixed-function state a pipeline is built with. Absent fields take the defaults below. */
export interface PipelineState {
  readonly cullMode?: GPUCullMode;
  /**
   * The mesh is the REVERSE of a mesh's default orientation: Babylon's
   * `ClockWiseSideOrientation`, or a default mesh under a world matrix with a
   * negative determinant, which Babylon turns the same way.
   */
  readonly reversed?: boolean;
  readonly topology?: GPUPrimitiveTopology;
  readonly depthWrite?: boolean;
  readonly depthCompare?: GPUCompareFunction;
  readonly depthBias?: number;
  readonly blend?: GPUBlendState;
}

/** One pipeline, as asked for. */
export interface PipelineSpec {
  /** One module holding both stages, or the vertex stage's alone. */
  readonly vertex: ShaderSource;
  readonly vertexEntry: string;
  readonly fragment: ShaderSource;
  readonly fragmentEntry: string;
  readonly buffers: readonly GPUVertexBufferLayout[];
  readonly targets: PassTargets;
  readonly state?: PipelineState;
}

/** What a draw needs beside the pipeline: the layouts its bind groups are made against. */
export interface BuiltPipeline {
  readonly pipeline: GPURenderPipeline;
  readonly groups: readonly GPUBindGroupLayout[];
}

export class PipelineCache {
  /** Keyed on the CODE: two programs may share a label, never a module. */
  private readonly modules = new Map<string, GPUShaderModule>();
  private readonly layouts = new Map<string, GPUBindGroupLayout>();
  private readonly pipelines = new Map<string, Promise<BuiltPipeline>>();

  constructor(private readonly device: GPUDevice) {}

  /** The pipeline for `spec`, compiled once; every later ask shares the same promise. */
  get(spec: PipelineSpec): Promise<BuiltPipeline> {
    const key = pipelineKey(spec);
    let built = this.pipelines.get(key);
    if (!built) {
      built = this.build(spec, key);
      this.pipelines.set(key, built);
      built.catch(() => this.pipelines.delete(key));
    }
    return built;
  }

  private async build(spec: PipelineSpec, key: string): Promise<BuiltPipeline> {
    const groups = this.groupLayouts(spec);
    const s = spec.state ?? {};
    const t = spec.targets;
    const pipeline = await this.device.createRenderPipelineAsync({
      label: key,
      layout: this.device.createPipelineLayout({ label: key, bindGroupLayouts: groups }),
      vertex: {
        module: this.module(spec.vertex),
        entryPoint: spec.vertexEntry,
        buffers: spec.buffers,
      },
      fragment: {
        module: this.module(spec.fragment),
        entryPoint: spec.fragmentEntry,
        targets: t.colorFormats.map((format) => (s.blend ? { format, blend: s.blend } : { format })),
      },
      primitive: {
        topology: s.topology ?? "triangle-list",
        cullMode: s.cullMode ?? "back",
        frontFace: (s.reversed ?? false) !== t.flipY ? "cw" : "ccw",
      },
      depthStencil: t.depthFormat
        ? {
            format: t.depthFormat,
            depthWriteEnabled: s.depthWrite ?? true,
            depthCompare: s.depthCompare ?? "less-equal",
            depthBias: s.depthBias ?? 0,
          }
        : undefined,
      multisample: { count: t.sampleCount },
    });
    return { pipeline, groups };
  }

  private module(src: ShaderSource): GPUShaderModule {
    let m = this.modules.get(src.code);
    if (!m) {
      m = this.device.createShaderModule({ label: src.label, code: src.code });
      this.modules.set(src.code, m);
    }
    return m;
  }

  /**
   * One layout per group, over the union of both stages' bindings. A binding
   * both stages declare is one entry visible to both; a group with no binding
   * in this variant is an empty layout, so the group numbers stay put.
   */
  private groupLayouts(spec: PipelineSpec): GPUBindGroupLayout[] {
    const byGroup: Map<number, GPUBindGroupLayoutEntry>[] = [];
    const add = (b: AssembledBinding, stage: number): void => {
      const group = (byGroup[b.group] ??= new Map());
      const had = group.get(b.binding);
      if (!had) {
        group.set(b.binding, layoutEntry(b, stage));
        return;
      }
      const theirs = JSON.stringify({ ...had, visibility: 0 });
      if (theirs !== JSON.stringify({ ...layoutEntry(b, stage), visibility: 0 })) {
        throw new Error(
          `${spec.vertex.label} / ${spec.fragment.label}: @group(${b.group}) @binding(${b.binding}) ` +
            `is declared differently by the two stages`,
        );
      }
      had.visibility |= stage;
    };
    for (const b of spec.vertex.bindings) add(b, GPUShaderStage.VERTEX);
    const sameModule = spec.fragment.code === spec.vertex.code;
    for (const b of spec.fragment.bindings) {
      // One module holding both stages lists each binding once; which stage
      // reads it is not something the list says, so both may.
      add(b, sameModule ? GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT : GPUShaderStage.FRAGMENT);
    }
    const out: GPUBindGroupLayout[] = [];
    for (let g = 0; g < byGroup.length; g++) {
      const entries = [...(byGroup[g] ?? new Map()).values()].sort((a, b) => a.binding - b.binding);
      const key = JSON.stringify(entries);
      let layout = this.layouts.get(key);
      if (!layout) {
        layout = this.device.createBindGroupLayout({ label: `group ${g}`, entries });
        this.layouts.set(key, layout);
      }
      out.push(layout);
    }
    return out;
  }
}

/** The key a pipeline is cached under: variant, vertex layout, targets, state. */
function pipelineKey(spec: PipelineSpec): string {
  return [
    `${spec.vertex.label}:${spec.vertexEntry}:${spec.vertex.code}`,
    `${spec.fragment.label}:${spec.fragmentEntry}:${spec.fragment.code}`,
    JSON.stringify(spec.buffers),
    targetsKey(spec.targets),
    JSON.stringify(spec.state ?? {}),
  ].join("|");
}

/** The layout entry an assembled binding takes. */
function layoutEntry(b: AssembledBinding, visibility: number): GPUBindGroupLayoutEntry {
  const entry: GPUBindGroupLayoutEntry = { binding: b.binding, visibility };
  if (b.kind === "uniform") entry.buffer = { type: "uniform" };
  else if (b.kind === "sampler") entry.sampler = { type: "filtering" };
  else entry.texture = { sampleType: "float", viewDimension: viewDimension(b.type) };
  return entry;
}

function viewDimension(type: string): GPUTextureViewDimension {
  if (type.startsWith("texture_3d")) return "3d";
  if (type.startsWith("texture_cube")) return "cube";
  if (type.startsWith("texture_2d_array")) return "2d-array";
  return "2d";
}
