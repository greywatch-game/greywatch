/**
 * render/WorldDepth.ts — The static world as a directional shadow map records
 * it: the casters our renderer draws in the main pass, and the ones it holds
 * only for this (`WorldBlocks.addCaster`), culled for the map's light and
 * drawn depth-only into the pass `WorldShadows` opens (`BABYLON_EXIT.md`
 * X3.6a). The same groups as the main pass, the same fold — a group's plain
 * draw over its whole range and, with scatter, its one indirect draw.
 * Owns: `WorldDepth` — a second VIEW of each of the map's culls (`ClusterCull`
 * and `InstanceCull` handed the main pass's, so the tables are uploaded once),
 * with a slot for every map a submit can draw; the depth pipelines, by which
 * faces they keep and whether they read the scatter's list; and each group's
 * geometry for them (group 1: its positions and the instances' transforms,
 * and the shadow view's list for the scatter twin); `DepthGroup`, what
 * `WorldBlocks` hands it of a group; `DepthFaces`.
 * Invariants: a map draws the clusters of the passes its inputs' MASK names
 * (`PASS_CASTS` for the world's maps, `PASS_SOLID` for the foliage's) and no
 * other, so a surface Babylon's generator would not have been handed — the
 * landform, a sheet marked `noShadowCaster` — is never in it; the cull is
 * told the light's view-projection, no reach, no size gate and no sway,
 * because Babylon's depth pass culled nothing off its render list but the
 * window and never swayed a vertex — and an orthographic light's frustum is
 * exact for that, a caster's shadow landing at its own place in the light's
 * plane; a map's culls are recorded into the encoder AHEAD of its pass and
 * after the previous map's, each map at its own slot, so its draws read its
 * own survivors; until every view and pipeline is built (`ready`) it records
 * nothing; faces are kept by Babylon's rule for its generators — the BACK
 * faces for a map that forces them, whatever a mesh's orientation, and the
 * front for the foliage's (`PipelineCache` derives the winding of the flipped
 * pass).
 * Never: imports Babylon; reads a node; opens a pass of its own — the pass is
 * its caller's; submits; allocates on a frame beyond the passes WebGPU makes.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import { celDepth, depthGeometry } from "./celDepth";
import { ClusterCull, type CullInputs } from "./ClusterCull";
import { HostBindGroup } from "./HostBindGroup";
import { InstanceCull } from "./InstanceCull";
import type { BuiltPipeline } from "./PipelineCache";
import type { Renderer } from "./Renderer";
import { SHADOW_TARGETS } from "./targets";
import { INDIRECT_BYTES } from "./wgsl/instanceCull";

/** Which faces a shadow map records: a caster's far side, or its near one. */
export type DepthFaces = "back" | "front";

/** One of `WorldBlocks`' groups, as its depth draws need it. */
export interface DepthGroup {
  readonly label: string;
  /** Its positions, three floats a vertex: the array its main-pass draws read. */
  readonly positions: GPUBuffer;
  /** Its range of the cull's indices. */
  readonly indexBase: number;
  readonly indexCount: number;
  /** The passes its surfaces' clusters are drawn in, together (`PASS_CASTS`, `PASS_SOLID`). */
  readonly surfacePasses: number;
  /** Its range of the instance cull, or -1 for a group that draws no scatter. */
  readonly scatterRange: number;
  /** The passes its instanced parts' clusters are drawn in, together. */
  readonly scatterPasses: number;
}

/** A group's geometry for the depth pipelines: plain, and the scatter twin's when it draws scatter. */
interface GroupGeometry {
  readonly group: DepthGroup;
  readonly plain: HostBindGroup;
  readonly scatter: HostBindGroup | null;
}

export class WorldDepth {
  /** Resolves true once both views and every pipeline are built; false if one failed. */
  readonly ready: Promise<boolean>;
  private built = false;
  private disposed = false;
  private readonly cull: ClusterCull;
  private readonly instances: InstanceCull | null;
  private readonly geometry: GroupGeometry[];
  /** By faces: the plain pipeline, and the scatter twin's (null with no scatter). */
  private readonly pipelines: Record<DepthFaces, { plain: BuiltPipeline | null; scatter: BuiltPipeline | null }> = {
    back: { plain: null, scatter: null },
    front: { plain: null, scatter: null },
  };

  constructor(
    renderer: Renderer,
    /** The main pass's culls, whose tables these views read: disposed no earlier than this. */
    mainCull: ClusterCull,
    mainInstances: InstanceCull | null,
    groups: readonly DepthGroup[],
    /** The instances' transforms, which every group binds. */
    transforms: GPUBuffer,
    /** Every cluster of the map — the casters held for this alone included. */
    clusterCount: number,
    /** The corners a scatter survivor's run takes (`listStride`). */
    stride: number,
    /** The maps one submit may draw: a slot each in both views. */
    slots: number,
  ) {
    const device = renderer.device;
    const view = { label: "shadows", slots };
    this.cull = new ClusterCull(device, renderer.pipelines, mainCull, { ...view, count: clusterCount });
    this.instances = mainInstances ? new InstanceCull(device, renderer.pipelines, mainInstances, stride, view) : null;
    const instances = this.instances;
    this.geometry = groups.map((group) => {
      const make = (scatter: boolean): HostBindGroup => {
        const buffers: Record<string, GPUBuffer> = { positionData: group.positions, transforms };
        if (scatter) {
          buffers.scatterList = instances!.list;
          buffers.scatterSource = instances!.source;
        }
        const bound = new HostBindGroup(
          device,
          `world depth: ${group.label}${scatter ? " scatter" : ""}`,
          depthGeometry(scatter ? stride : null),
          [],
          buffers,
        );
        // No textures: resolved once, whole for good.
        bound.refresh(renderer.host, {});
        return bound;
      };
      return { group, plain: make(false), scatter: group.scatterRange >= 0 && instances ? make(true) : null };
    });

    const asks: Promise<unknown>[] = [this.cull.ready];
    if (instances) asks.push(instances.ready);
    for (const faces of ["back", "front"] as const) {
      for (const scatter of instances ? [false, true] : [false]) {
        const program = celDepth(scatter ? stride : null);
        asks.push(
          renderer.pipelines
            .get({
              vertex: program.vertex,
              vertexEntry: "main",
              fragment: program.fragment,
              fragmentEntry: "main",
              targets: SHADOW_TARGETS,
              // Babylon's rule, read off the FLIPPED pass: the faces a
              // generator forcing back faces keeps are those wound the
              // other way from a mesh's front.
              state: { cullMode: faces === "back" ? "front" : "back" },
            })
            .then((built) => {
              this.pipelines[faces][scatter ? "scatter" : "plain"] = built;
              return true;
            }),
        );
      }
    }
    this.ready = Promise.all(asks).then(
      (oks) => {
        if (this.disposed || !oks.every(Boolean)) return false;
        this.built = true;
        return true;
      },
      (err: unknown) => {
        if (!this.disposed) console.error("world depth: a pipeline did not build; the world's shadows go back to Babylon", err);
        return false;
      },
    );
  }

  /**
   * One shadow map's pass recorded into `encoder`: the culls for `inputs` —
   * the map's light and its pass mask — at `slot`, then the pass `pass`
   * describes (its caller's targets, cleared) with every group's draws for
   * the faces `faces`. `light` makes the map's group 0 against the layout
   * the pipelines were built with. Before `ready` it records nothing at all.
   */
  record(
    encoder: GPUCommandEncoder,
    pass: GPURenderPassDescriptor,
    inputs: CullInputs,
    faces: DepthFaces,
    light: (layout: GPUBindGroupLayout) => GPUBindGroup,
    slot: number,
  ): void {
    const pipes = this.pipelines[faces];
    if (!this.built || !pipes.plain) return;
    this.cull.dispatch(inputs, encoder, null, slot);
    this.instances?.dispatch(inputs, encoder, null, slot);
    const mask = inputs.mask;
    const p = encoder.beginRenderPass(pass);
    const plain = pipes.plain;
    const all = this.geometry;
    p.setPipeline(plain.pipeline);
    p.setBindGroup(0, light(plain.groups[0]));
    p.setIndexBuffer(this.cull.indices, "uint32");
    for (let i = 0; i < all.length; i++) {
      const group = all[i].group;
      if (group.indexCount === 0 || (group.surfacePasses & mask) === 0) continue;
      const bound = all[i].plain.get(plain.groups[1]);
      if (!bound) continue;
      p.setBindGroup(1, bound);
      p.drawIndexed(group.indexCount, 1, group.indexBase, 0, 0);
    }
    const scatter = pipes.scatter;
    const instances = this.instances;
    if (scatter && instances) {
      p.setPipeline(scatter.pipeline);
      p.setBindGroup(0, light(scatter.groups[0]));
      for (let i = 0; i < all.length; i++) {
        const { group, scatter: geometry } = all[i];
        if (!geometry || (group.scatterPasses & mask) === 0) continue;
        const bound = geometry.get(scatter.groups[1]);
        if (!bound) continue;
        p.setBindGroup(1, bound);
        p.drawIndirect(instances.args, group.scatterRange * INDIRECT_BYTES);
      }
    }
    p.end();
  }

  /** Both views' buffers destroyed: before the main pass's culls, whose tables they read. */
  dispose(): void {
    this.disposed = true;
    this.built = false;
    this.cull.dispose();
    this.instances?.dispose();
  }
}
