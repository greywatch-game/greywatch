/**
 * systems/BlockHandover.ts — The map's BLOCKS handed from Babylon's main pass
 * to our renderer's, behind the DEV switch `?ourworld` (`BABYLON_EXIT.md`
 * X3.3a): which surfaces are taken, their arrays uploaded on the way past the
 * build, and which of them are drawn each frame.
 * Owns: `BlockHandover` — our renderer's `WorldBlocks`, the taken meshes in
 * draw order, the material epoch last copied, and the per-frame decision of
 * which taken mesh is ON.
 * Invariants: a surface is TAKEN only if our pipeline draws it exactly as
 * Babylon would — block-merged, in rendering group 0, at identity and under
 * no parent, never written after its build (`updatable` is a breakable
 * pane's), and on a cel material that keeps a recipe
 * (`CelMaterialFactory.celRecipe`: no glazing, no cloth, no emissive) — and
 * every other surface stays Babylon's in every pass, as does a taken one
 * whose pipeline failed to build (handed back whole, so every surface is drawn
 * by one side); a taken mesh is
 * drawn by our side in the MAIN pass only and stays Babylon's in every other
 * (the shadow maps, the probes, the lamps' atlas), because only the main
 * pass's candidate list is told (`WorldCulling.setTaken`); a taken mesh is ON
 * in a frame exactly when Babylon's own active-mesh walk would have drawn it
 * — `WorldCulling`'s cell, visibility and size tests, then the walk's own
 * (`Scene._evaluateActiveMeshes`: ready, enabled, visible, layer mask, the
 * frustum), asked of the mesh through its public API in the same frame, after
 * the walk — so a main pass trades one draw for one draw; the switch is read
 * once, at construction, and a build without it makes no `BlockHandover` at
 * all.
 * Never: draws, or reads a material's uniforms — a material reaches our side
 * as its recipe; writes a property on a mesh.
 * Contract: `docs/rendering.md`, "Our renderer's frame";
 * `BABYLON_EXIT.md` X3.3a.
 */
import type { AbstractMesh, Mesh, Scene } from "@babylonjs/core";
import type { Renderer } from "../render/Renderer";
import { WorldBlocks } from "../render/WorldBlocks";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { WorldSurface } from "../world/worldGeometry";
import type { WorldCulling } from "./WorldCulling";

export class BlockHandover {
  private readonly blocks: WorldBlocks;
  /** The taken meshes, a mesh's index being its draw's. */
  private meshes: Mesh[] = [];
  private readonly drawOf = new Map<AbstractMesh, number>();
  /** `CelMaterialFactory.materialEpoch` as last copied; -1 is never. */
  private epoch = -1;
  /** Whether every pipeline the taken surfaces need is built. */
  private compiledFlag = false;
  /** Bumped by `clear`, so a compile that finishes for an old map is ignored. */
  private generation = 0;
  private readonly observer: { remove(): void };

  constructor(
    renderer: Renderer,
    private readonly scene: Scene,
    private readonly mats: CelMaterialFactory,
    private readonly culling: WorldCulling,
  ) {
    this.blocks = new WorldBlocks(renderer);
    const o = scene.onAfterActiveMeshesEvaluationObservable.add(this.decide);
    this.observer = { remove: () => scene.onAfterActiveMeshesEvaluationObservable.remove(o) };
  }

  /**
   * The build's `BuildOptions.onSurface`: takes `surface` if our side draws it
   * — see the header for the test — and uploads its arrays while they can
   * still be read.
   */
  readonly onSurface = (surface: WorldSurface, mesh: Mesh): void => {
    const { part } = surface;
    if (surface.block === null || surface.updatable) return;
    // Drawn in group 0's slot, at the world's own origin.
    if (mesh.renderingGroupId !== 0 || mesh.parent !== null) return;
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
    const at = this.blocks.add(part.name, g, recipe);
    this.meshes[at] = mesh;
    this.drawOf.set(mesh, at);
  };

  /**
   * After the map's build and `WorldCulling.setMap`: hands the taken meshes
   * to the cull, and starts waiting on their pipelines.
   */
  install(): void {
    this.culling.setTaken(this.meshes);
    this.epoch = -1;
    this.compiledFlag = false;
    const generation = this.generation;
    void this.blocks.compiled().then((failed) => {
      if (generation !== this.generation) return;
      // A surface whose pipeline did not build goes back to Babylon whole —
      // drawn by NEITHER side would be a hole in the world.
      if (failed.length > 0) {
        for (const at of failed) this.drawOf.delete(this.meshes[at]);
        this.culling.setTaken(this.meshes.filter((m) => this.drawOf.has(m)));
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

  /** How many surfaces are taken, and how many our side drew last frame. */
  get stats(): { taken: number; drawn: number } {
    return { taken: this.blocks.count, drawn: this.blocks.drawn };
  }

  /** The map is going: every surface, buffer and material of ours with it. */
  clear(): void {
    this.generation++;
    this.blocks.clear();
    this.meshes = [];
    this.drawOf.clear();
    this.compiledFlag = false;
  }

  dispose(): void {
    this.clear();
    this.observer.remove();
    this.blocks.dispose();
  }

  /**
   * Which taken meshes are ON this frame: the survivors of `WorldCulling`'s
   * tests (`takenOffered`) put through the rest of Babylon's walk, in the
   * order and with the planes the walk just used.
   */
  private readonly decide = (): void => {
    const blocks = this.blocks;
    blocks.clearOn();
    if (this.meshes.length === 0) return;
    if (this.mats.materialEpoch !== this.epoch) {
      this.epoch = this.mats.materialEpoch;
      blocks.writeMaterials();
    }
    const scene = this.scene;
    const camera = scene.activeCamera;
    if (!camera) return;
    const planes = scene.frustumPlanes;
    const everything = scene.skipFrustumClipping;
    const list = this.culling.takenOffered;
    for (let i = 0; i < list.length; i++) {
      const mesh = list.data[i];
      if (
        mesh.isBlocked ||
        !mesh.isReady() ||
        !mesh.isEnabled() ||
        mesh.scaling.hasAZeroComponent ||
        !mesh.isVisible ||
        mesh.visibility <= 0 ||
        (mesh.layerMask & camera.layerMask) === 0 ||
        !(everything || mesh.alwaysSelectAsActiveMesh || mesh.isInFrustum(planes))
      ) {
        continue;
      }
      const at = this.drawOf.get(mesh);
      if (at !== undefined) blocks.setOn(at);
    }
  };
}
