/**
 * systems/BlockHandover.ts — The map's BLOCKS, and since X3.5 its LANDFORM,
 * handed from Babylon's main pass to our renderer's (`BABYLON_EXIT.md` X3.3,
 * X3.5): which surfaces are taken, their arrays handed over on the way past
 * the build, and the map cut once it is filed.
 * Owns: `BlockHandover` — our renderer's `WorldBlocks`, the taken meshes in
 * surface order, which of them were handed back, the material epoch last
 * copied, and the build's scatter FIELD until the map is cut (X3.4b).
 * Invariants: a surface is TAKEN only if our pipeline draws it exactly as
 * Babylon would — block-merged or the LANDFORM (`WorldSurface.landform`: the
 * floor's patches, the rim's runs and the map-wide road merge, which the
 * BUILD marks and nothing here guesses), in rendering group 0, at identity
 * and under no parent, never written after its build (`updatable` is a
 * breakable pane's), on the layer mask every camera sees, and on a cel
 * material that keeps a recipe (`CelMaterialFactory.celRecipe`: no glazing,
 * no cloth, no emissive) — and the landform is drawn by our side ahead of
 * group 0's alpha-tested meshes, the blocks after them (`WorldBlocks`'s
 * header says why); nothing is taken from an EDITOR build, which `Game`
 * hands no `onSurface` — its blocks are unmerged, and its brush rewrites the
 * floor's meshes in place — and every other surface stays Babylon's in every
 * pass, as do the taken surfaces our side will never draw (handed back whole,
 * so every surface is drawn by one side): a pipeline's or the cull's failure
 * hands back its surfaces in the turn it lands, and a main pass our renderer
 * REFUSES (`Renderer.onRefused`) hands back the whole map, for the rest of
 * it, from the next frame — the refused one is the one frame drawn without
 * them; a taken mesh is drawn by our side
 * in the MAIN pass only and stays Babylon's in every other (the shadow maps,
 * the probes, the lamps' atlas), because only the main pass's candidate list
 * is told (`WorldCulling.setTaken`); what our side draws of it each frame is
 * decided on the GPU, cluster by cluster, from numbers alone — the frame's
 * camera, and the reach and size gate `WorldCulling` decides
 * (`WorldCulling.reachGate`, measured to the box of the cell a block is filed
 * in, and never cutting the landform, which has none — `reachBoxOf`) — so no
 * node is read per frame; a taken mesh is never switched off, hidden or
 * faded after its build, because nothing in the tree does that to a block or
 * to the landform and the cull could not follow it if
 * something did (a DEV build checks every frame and says so); the building
 * card waits for our pipelines through the renderer's own cache
 * (`core/PipelineWarmup.ts`), never through this, and a failed surface is
 * handed back in the turn its compile settles, which is also the turn the
 * cache stops counting it — so before the warm-up's next frame; the SCATTER
 * is drawn by our side as instances of its variants (`BABYLON_EXIT.md`
 * X3.4b), each set's parts added to the group of its recipe, and the
 * scatter's pieces (its regions) are cut out of the taken blocks of every
 * group that draws them so — Babylon's copy of them stays in its meshes for
 * every other pass, until X3.6 — while a recipe our side does not take is
 * drawn whole by Babylon, scatter and all, and a group that fails goes back
 * whole, scatter and all.
 * Never: draws, or reads a material's uniforms — a material reaches our side
 * as its recipe; writes a property on a mesh.
 * Contract: `docs/rendering.md`, "Our renderer's frame";
 * `BABYLON_EXIT.md` X3.3a, X3.3b, X3.3c, X3.4, X3.5.
 */
import type { AbstractMesh, Mesh } from "@babylonjs/core";
import { CONFIG } from "../config";
import { type BlockBox, type CullDiagnostics, NO_DIAGNOSTICS } from "../render/ClusterCull";
import type { Renderer } from "../render/Renderer";
import { WorldBlocks } from "../render/WorldBlocks";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { ScatterField } from "../world/scatterVariants";
import type { WorldGeometry, WorldSurface } from "../world/worldGeometry";
import type { WorldCulling } from "./WorldCulling";

/** The layer mask a mesh is born with, which every camera in the game sees. */
const DEFAULT_LAYER_MASK = 0x0fffffff;

export class BlockHandover {
  private readonly blocks: WorldBlocks;
  /** The taken meshes, a mesh's index being its surface's. */
  private meshes: Mesh[] = [];
  /** Of those, the LANDFORM (`WorldSurface.landform`), as the build marked it. */
  private landform = new Set<Mesh>();
  /** Of those, the ones handed back to Babylon's main pass. */
  private back = new Set<Mesh>();
  /** The whole map was handed back, its main pass refused. */
  private handedBack = false;
  /** `CelMaterialFactory.materialEpoch` as last copied; -1 is never. */
  private epoch = -1;
  /** The DEV check has reported a changed mesh: once a map is enough. */
  private reported = false;
  /** The build's scatter, held from `onScatter` until `install` hands it over. */
  private field: ScatterField | null = null;
  private readonly removeFrame: () => void;
  private readonly removeRefused: () => void;

  constructor(
    renderer: Renderer,
    private readonly mats: CelMaterialFactory,
    private readonly culling: WorldCulling,
    /** Our culls' diagnostics — `?nocull`, `?nofrustum`, `?cullcheck` (`core/urlOverrides.ts`). */
    diagnostics: CullDiagnostics = NO_DIAGNOSTICS,
  ) {
    this.blocks = new WorldBlocks(
      renderer,
      culling.reachGate,
      CONFIG.graphics.clusters,
      this.failed,
      diagnostics,
    );
    this.removeFrame = renderer.onFrame(this.frame);
    this.removeRefused = renderer.onRefused(this.refused);
  }

  /**
   * The build's `BuildOptions.onSurface`: takes `surface` if our side draws it
   * — see the header for the test — and hands its arrays over while they can
   * still be read.
   */
  readonly onSurface = (surface: WorldSurface, mesh: Mesh): void => {
    const { part } = surface;
    if ((surface.block === null && !surface.landform) || surface.updatable) return;
    // Drawn in group 0's slot, at the world's own origin, by every camera.
    if (mesh.renderingGroupId !== 0 || mesh.parent !== null) return;
    if (mesh.layerMask !== DEFAULT_LAYER_MASK) return;
    const recipe = this.mats.celRecipe(part.material);
    if (!recipe) return;
    const p = part.position;
    const r = part.rotation;
    const k = part.scaling;
    const atIdentity =
      p.x === 0 && p.y === 0 && p.z === 0 &&
      r.x === 0 && r.y === 0 && r.z === 0 &&
      k.x === 1 && k.y === 1 && k.z === 1 &&
      part.rotationQuaternion === null;
    const g = part.geometry;
    if (!atIdentity || !g.normals || !g.colors) return;
    if (recipe.defines.includes("CEL_PALETTE") && !g.uvs2) return;
    const at = this.blocks.add(part.name, g, recipe, surface.pieces, surface.landform);
    this.meshes[at] = mesh;
    if (surface.landform) this.landform.add(mesh);
  };

  /**
   * The build's `BuildOptions.onScatter`: the scatter as our side draws it,
   * kept until `install`.
   */
  readonly onScatter = (field: ScatterField): void => {
    this.field = field;
  };

  /**
   * After the map's build and `WorldCulling.setMap`: hands the taken meshes
   * to the cull and cuts the map against the cells they were filed in, the
   * scatter's sets added as instances and its pieces (`world`'s scatter
   * regions) cut out of the blocks that draw them so. What our side then
   * cannot draw comes back through `failed` and `refused`.
   */
  install(world: WorldGeometry): void {
    const meshes = this.meshes;
    const field = this.field;
    this.field = null;
    if (field) {
      field.sets.forEach((set, s) => {
        for (const part of set.parts) {
          const recipe = this.mats.celRecipe(part.material);
          const g = part.geometry;
          if (!recipe || !g.normals || !g.colors) continue;
          if (recipe.defines.includes("CEL_PALETTE") && !g.uvs2) continue;
          this.blocks.addInstanced(s, part.name, g, recipe);
        }
      });
    }
    this.back = new Set();
    this.handedBack = false;
    this.epoch = -1;
    this.reported = false;
    this.take(meshes);
    const boxes: BlockBox[] = meshes.map((mesh) => this.culling.reachBoxOf(mesh));
    this.blocks.finish(
      boxes,
      field
        ? {
            cut: (piece) => world.pieces[piece]?.list === "scatter",
            sets: field.sets.map((set) => ({ matrices: set.matrices, scales: set.scales })),
          }
        : null,
    );
  }

  /**
   * How many surfaces are taken, how many clusters and material groups they
   * were cut into, how many draws our side issued last frame, and how many
   * taken surfaces went back to Babylon — every one, once a pass was refused.
   */
  get stats(): {
    taken: number;
    clusters: number;
    groups: number;
    drawn: number;
    handedBack: number;
  } {
    const { surfaces, clusters, groups } = this.blocks.count;
    return {
      taken: surfaces,
      clusters,
      groups,
      drawn: this.blocks.drawn,
      handedBack: this.handedBack ? surfaces : this.back.size,
    };
  }

  /** The map is going: every surface, buffer and material of ours with it. */
  clear(): void {
    this.blocks.clear();
    this.field = null;
    this.meshes = [];
    this.landform = new Set();
    this.back = new Set();
    this.handedBack = false;
  }

  dispose(): void {
    this.clear();
    this.removeFrame();
    this.removeRefused();
    this.blocks.dispose();
  }

  /**
   * `WorldBlocks.onFailed`: surfaces our side will never draw go back to
   * Babylon at once, whole — drawn by NEITHER side would be a hole in the
   * world. Only for the map installed now: `WorldBlocks` drops a failure
   * that settles after its map.
   */
  private readonly failed = (surfaces: readonly number[]): void => {
    if (this.handedBack) return;
    for (const at of surfaces) this.back.add(this.meshes[at]);
    this.take(this.meshes.filter((m) => !this.back.has(m)));
  };

  /** Tells the cull `meshes` are ours, each as the block or the landform the build said it was. */
  private take(meshes: readonly Mesh[]): void {
    this.culling.setTaken(
      meshes.filter((m) => !this.landform.has(m)),
      meshes.filter((m) => this.landform.has(m)),
    );
  }

  /**
   * `Renderer.onRefused`: the main pass is not what our pipelines were built
   * for, so nothing of ours draws in it — and every taken block would be a
   * hole. The whole map goes back to Babylon, for the rest of it: our side
   * stops (keeping its buffers, which this frame's commands hold) and the
   * candidate list has every block again from the next frame.
   */
  private readonly refused = (): void => {
    if (this.handedBack || this.meshes.length === 0) return;
    this.handedBack = true;
    this.blocks.stop();
    this.culling.setTaken([], []);
    console.error(
      `BlockHandover: the main pass was refused; all ${this.meshes.length} taken surfaces go back to Babylon for this map`,
    );
  };

  /**
   * Once a frame as the main pass begins: a material rewritten by its owner
   * is copied again, and a DEV build checks that no taken mesh has been
   * switched, hidden or faded — Babylon would stop drawing it, or draw it
   * blended, and our side, which reads no node, would not follow.
   */
  private readonly frame = (): void => {
    if (this.mats.materialEpoch !== this.epoch) {
      this.epoch = this.mats.materialEpoch;
      this.blocks.writeMaterials();
    }
    if (import.meta.env.DEV && !this.reported) this.check(this.meshes);
  };

  private check(meshes: readonly AbstractMesh[]): void {
    for (const mesh of meshes) {
      if (mesh.isVisible && mesh.visibility === 1 && mesh.isEnabled()) continue;
      this.reported = true;
      console.error(
        `BlockHandover: "${mesh.name}" was switched off, hidden or faded after it was taken; our renderer still draws it opaque (BABYLON_EXIT.md X3.3b)`,
      );
      return;
    }
  }
}
