/**
 * systems/BlockHandover.ts — The map's BLOCKS handed from Babylon's main pass
 * to our renderer's, behind the DEV switch `?ourworld` (`BABYLON_EXIT.md`
 * X3.3a, X3.3b): which surfaces are taken, their arrays handed over on the
 * way past the build, and the map cut once it is filed.
 * Owns: `BlockHandover` — our renderer's `WorldBlocks`, the taken meshes in
 * surface order, and the material epoch last copied.
 * Invariants: a surface is TAKEN only if our pipeline draws it exactly as
 * Babylon would — block-merged, in rendering group 0, at identity and under
 * no parent, never written after its build (`updatable` is a breakable
 * pane's), on the layer mask every camera sees, and on a cel material that
 * keeps a recipe (`CelMaterialFactory.celRecipe`: no glazing, no cloth, no
 * emissive) — and every other surface stays Babylon's in every pass, as do
 * the taken surfaces of a pipeline that failed to build (handed back whole,
 * so every surface is drawn by one side); a taken mesh is drawn by our side
 * in the MAIN pass only and stays Babylon's in every other (the shadow maps,
 * the probes, the lamps' atlas), because only the main pass's candidate list
 * is told (`WorldCulling.setTaken`); what our side draws of it each frame is
 * decided on the GPU, cluster by cluster, from numbers alone — the frame's
 * camera, and the reach and size gate `WorldCulling` decides
 * (`WorldCulling.reachGate`, measured to the box of the cell the mesh is
 * filed in, `blockBoxOf`) — so no node is read per frame; a taken mesh is
 * never switched off, hidden or faded after its build, because nothing in
 * the tree does that to a block and the cull could not follow it if
 * something did (a DEV build checks every frame and says so); the switch is
 * read once, at construction, and a build without it makes no
 * `BlockHandover` at all.
 * Never: draws, or reads a material's uniforms — a material reaches our side
 * as its recipe; writes a property on a mesh.
 * Contract: `docs/rendering.md`, "Our renderer's frame";
 * `BABYLON_EXIT.md` X3.3a, X3.3b.
 */
import type { AbstractMesh, Mesh } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { BlockBox } from "../render/ClusterCull";
import type { Renderer } from "../render/Renderer";
import { WorldBlocks } from "../render/WorldBlocks";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { WorldSurface } from "../world/worldGeometry";
import type { WorldCulling } from "./WorldCulling";

/** The layer mask a mesh is born with, which every camera in the game sees. */
const DEFAULT_LAYER_MASK = 0x0fffffff;

export class BlockHandover {
  private readonly blocks: WorldBlocks;
  /** The taken meshes, a mesh's index being its surface's. */
  private meshes: Mesh[] = [];
  /** `CelMaterialFactory.materialEpoch` as last copied; -1 is never. */
  private epoch = -1;
  /** Whether every pipeline the taken surfaces need is built. */
  private compiledFlag = false;
  /** Bumped by `clear`, so a compile that finishes for an old map is ignored. */
  private generation = 0;
  /** The DEV check has reported a changed mesh: once a map is enough. */
  private reported = false;
  private readonly removeFrame: () => void;

  constructor(
    renderer: Renderer,
    private readonly mats: CelMaterialFactory,
    private readonly culling: WorldCulling,
  ) {
    this.blocks = new WorldBlocks(renderer, culling.reachGate, CONFIG.graphics.clusters);
    this.removeFrame = renderer.onFrame(this.frame);
  }

  /**
   * The build's `BuildOptions.onSurface`: takes `surface` if our side draws it
   * — see the header for the test — and hands its arrays over while they can
   * still be read.
   */
  readonly onSurface = (surface: WorldSurface, mesh: Mesh): void => {
    const { part } = surface;
    if (surface.block === null || surface.updatable) return;
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
    const at = this.blocks.add(part.name, g, recipe, surface.pieces);
    this.meshes[at] = mesh;
  };

  /**
   * After the map's build and `WorldCulling.setMap`: hands the taken meshes
   * to the cull, cuts the map against the cells they were filed in, and
   * starts waiting on the pipelines.
   */
  install(): void {
    const meshes = this.meshes;
    this.culling.setTaken(meshes);
    const boxes: BlockBox[] = meshes.map((mesh) => {
      const box = this.culling.blockBoxOf(mesh);
      if (!box) throw new Error(`BlockHandover: "${mesh.name}" is taken but filed in no cell`);
      return box;
    });
    this.blocks.finish(boxes);
    this.epoch = -1;
    this.compiledFlag = false;
    this.reported = false;
    const generation = this.generation;
    void this.blocks.compiled().then((failed) => {
      if (generation !== this.generation) return;
      // A surface whose pipeline did not build goes back to Babylon whole —
      // drawn by NEITHER side would be a hole in the world.
      if (failed.length > 0) {
        const back = new Set(failed.map((at) => meshes[at]));
        this.culling.setTaken(meshes.filter((m) => !back.has(m)));
      }
      this.compiledFlag = true;
    });
  }

  /**
   * Whether every pipeline the taken surfaces need is built — the building
   * card waits on it, so no frame of the round draws with one compiling.
   */
  get compiled(): boolean {
    return this.compiledFlag;
  }

  /**
   * How many surfaces are taken, how many clusters and material groups they
   * were cut into, and how many draws our side issued last frame.
   */
  get stats(): { taken: number; clusters: number; groups: number; drawn: number } {
    const { surfaces, clusters, groups } = this.blocks.count;
    return { taken: surfaces, clusters, groups, drawn: this.blocks.drawn };
  }

  /** The map is going: every surface, buffer and material of ours with it. */
  clear(): void {
    this.generation++;
    this.blocks.clear();
    this.meshes = [];
    this.compiledFlag = false;
  }

  dispose(): void {
    this.clear();
    this.removeFrame();
    this.blocks.dispose();
  }

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
