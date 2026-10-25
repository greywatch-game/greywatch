/**
 * render/WorldDepth.ts — The static world as a shadow pass records it: the
 * casters our renderer draws in the main pass, and the ones it holds only for
 * this (`WorldBlocks.addCaster`), culled for a light and drawn depth-only into
 * a pass its caller opens — a directional map `WorldShadows` draws
 * (`BABYLON_EXIT.md` X3.6a), or a static face of the lamps' atlas `LampAtlas`
 * draws (X3.6b). The same groups as the main pass, the same fold — a group's
 * plain draw over its whole range and, with scatter, its one plain draw to
 * the bound the shadow view's last cull computed (`InstanceCull.drawRange`),
 * none for a bound of 0.
 * Owns: `WorldDepth` — a second VIEW of each of the map's culls (`ClusterCull`
 * and `InstanceCull` handed the main pass's, so the tables are uploaded once),
 * with a slot for every pass a submit can draw; the depth pipelines, by what
 * they record (`DepthKind`) and whether they read the scatter's list; and each
 * group's geometry for them (group 1: its positions and the instances'
 * transforms, and the shadow view's list for the scatter twin); `DepthGroup`,
 * what `WorldBlocks` hands it of a group; `DepthKind`.
 * Invariants: a pass draws the clusters of the passes its inputs' MASK names
 * (`PASS_CASTS` for the world's maps, `PASS_SOLID` for the foliage's,
 * `PASS_LAMPS` for a lamp's face) and no other, so a surface Babylon would
 * not have drawn there — the landform, a sheet marked `noShadowCaster` — is
 * never in it; the cull is told the light's view-projection, no size gate and
 * no sway, because Babylon's depth passes culled nothing off their render
 * lists but the light's own window and never swayed a vertex — and an
 * orthographic light's frustum is exact for that, a caster's shadow landing
 * at its own place in the light's plane, as a face's frustum is for a lamp,
 * whose reach is its range; a pass's culls are recorded
 * into the encoder AHEAD of it (`cull`) and after the previous pass's, each
 * pass at its own slot, so its draws (`draw`) read its own survivors; until
 * every view and pipeline is built (`ready`) it culls and draws nothing;
 * faces are kept by Babylon's rule for its depth passes — the BACK faces for
 * a directional map that forces them and for a lamp's face (its material
 * culls the front), whatever a mesh's orientation, and the front for the
 * foliage's (`PipelineCache` derives the winding of the flipped pass).
 * Never: imports Babylon; reads a node; opens a pass — the pass is its
 * caller's; submits; allocates on a frame beyond the passes WebGPU makes.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import { celDepth, depthGeometry } from "./celDepth";
import { ClusterCull, type CullInputs } from "./ClusterCull";
import { HostBindGroup } from "./HostBindGroup";
import { InstanceCull } from "./InstanceCull";
import { lampDepth } from "./lampDepth";
import type { BuiltPipeline } from "./PipelineCache";
import type { Renderer } from "./Renderer";
import { SHADOW_TARGETS } from "./targets";

/**
 * What a shadow pass records of a caster: a directional map's far side or its
 * near one (`celDepth`), or the far side as a lamp's face measures it
 * (`lampDepth`).
 */
export type DepthKind = "back" | "front" | "lamp";

/** Every kind, in the order the pipelines are asked for. */
const DEPTH_KINDS: readonly DepthKind[] = ["back", "front", "lamp"];

/** One of `WorldBlocks`' groups, as its depth draws need it. */
export interface DepthGroup {
  readonly label: string;
  /** Its positions, three floats a vertex: the array its main-pass draws read. */
  readonly positions: GPUBuffer;
  /** Its range of the cull's indices. */
  readonly indexBase: number;
  readonly indexCount: number;
  /** The passes its surfaces' clusters are drawn in, together (`PASS_CASTS`, `PASS_SOLID`, `PASS_LAMPS`). */
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
  private readonly clusters: ClusterCull;
  private readonly instances: InstanceCull | null;
  private readonly geometry: GroupGeometry[];
  /** By kind: the plain pipeline, and the scatter twin's (null with no scatter). */
  private readonly pipelines: Record<DepthKind, { plain: BuiltPipeline | null; scatter: BuiltPipeline | null }> = {
    back: { plain: null, scatter: null },
    front: { plain: null, scatter: null },
    lamp: { plain: null, scatter: null },
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
    /** The passes one submit may draw: a slot each in both views. */
    slots: number,
  ) {
    const device = renderer.device;
    const view = { label: "shadows", slots };
    this.clusters = new ClusterCull(device, renderer.pipelines, mainCull, { ...view, count: clusterCount });
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

    const asks: Promise<unknown>[] = [this.clusters.ready];
    if (instances) asks.push(instances.ready);
    for (const kind of DEPTH_KINDS) {
      for (const scatter of instances ? [false, true] : [false]) {
        const program = kind === "lamp" ? lampDepth(scatter ? stride : null) : celDepth(scatter ? stride : null);
        asks.push(
          renderer.pipelines
            .get({
              vertex: program.vertex,
              vertexEntry: "main",
              fragment: program.fragment,
              fragmentEntry: "main",
              targets: SHADOW_TARGETS,
              // Babylon's rule, read off the FLIPPED pass: the faces a
              // generator forcing back faces keeps, and a lamp's depth
              // material culling the front, are those wound the other way
              // from a mesh's front.
              state: { cullMode: kind === "front" ? "back" : "front" },
            })
            .then((built) => {
              this.pipelines[kind][scatter ? "scatter" : "plain"] = built;
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
   * The culls for `inputs` — a light and its pass mask — recorded into
   * `encoder` at `slot`, ahead of the pass that draws what survives: true,
   * and `draw` may follow, once every view and pipeline is built; false,
   * recording nothing, before.
   */
  cull(inputs: CullInputs, encoder: GPUCommandEncoder, slot: number): boolean {
    if (!this.built) return false;
    this.clusters.dispatch(inputs, encoder, null, slot);
    this.instances?.dispatch(inputs, encoder, null, slot);
    return true;
  }

  /**
   * Every group's casters in the passes `mask` names, as `kind` records them,
   * into `pass` — its caller's, open — off the survivors of the `cull`
   * recorded last before it. `group0` makes the pass's group 0 against the
   * layout the pipelines were built with.
   */
  draw(
    pass: GPURenderPassEncoder,
    kind: DepthKind,
    mask: number,
    group0: (layout: GPUBindGroupLayout) => GPUBindGroup,
  ): void {
    const pipes = this.pipelines[kind];
    if (!this.built || !pipes.plain) return;
    const plain = pipes.plain;
    const all = this.geometry;
    pass.setPipeline(plain.pipeline);
    pass.setBindGroup(0, group0(plain.groups[0]));
    pass.setIndexBuffer(this.clusters.indices, "uint32");
    for (let i = 0; i < all.length; i++) {
      const group = all[i].group;
      if (group.indexCount === 0 || (group.surfacePasses & mask) === 0) continue;
      const bound = all[i].plain.get(plain.groups[1]);
      if (!bound) continue;
      pass.setBindGroup(1, bound);
      pass.drawIndexed(group.indexCount, 1, group.indexBase, 0, 0);
    }
    const scatter = pipes.scatter;
    const instances = this.instances;
    if (scatter && instances) {
      pass.setPipeline(scatter.pipeline);
      pass.setBindGroup(0, group0(scatter.groups[0]));
      for (let i = 0; i < all.length; i++) {
        const { group, scatter: geometry } = all[i];
        if (!geometry || (group.scatterPasses & mask) === 0 || instances.empty(group.scatterRange)) continue;
        const bound = geometry.get(scatter.groups[1]);
        if (!bound) continue;
        pass.setBindGroup(1, bound);
        instances.drawRange(pass, group.scatterRange);
      }
    }
  }

  /** Both views' buffers destroyed: before the main pass's culls, whose tables they read. */
  dispose(): void {
    this.disposed = true;
    this.built = false;
    this.clusters.dispose();
    this.instances?.dispose();
  }
}
