/**
 * systems/BlockHandover.ts — The map's BLOCKS, and since X3.5 its LANDFORM,
 * handed from Babylon's main pass to our renderer's (`BABYLON_EXIT.md` X3.3,
 * X3.5), and since X3.6a its shadow CASTERS to our renderer's shadow maps —
 * since X3.6b the lamps' atlas too: which surfaces are taken, their arrays
 * handed over on the way past the build, and the map cut once it is filed.
 * Owns: `BlockHandover` — our renderer's `WorldBlocks`, the taken meshes in
 * surface order, which of them were handed back and which are held rather
 * than taken, which of them cast and which a probe's bake draws, the fires,
 * whether the handover holds every caster the map has, the material epoch
 * last copied, and the build's scatter FIELD until the map is cut (X3.4b).
 * Invariants: a surface is TAKEN only if our pipeline draws it exactly as
 * Babylon would — block-merged or the LANDFORM (`WorldSurface.landform`: the
 * floor's patches, the rim's runs and the map-wide road merge, which the
 * BUILD marks and nothing here guesses), in rendering group 0, at identity
 * and under no parent, never written after its build (`updatable` is a
 * breakable pane's), on the layer mask every camera sees, and on a cel
 * material that keeps a recipe (`CelMaterialFactory.celRecipe`: no glazing,
 * no cloth, no emissive) — and both are drawn by our side ahead of group
 * 0's alpha-tested meshes, the blocks before the landform (`WorldBlocks`'s
 * header says why); nothing is taken from an EDITOR build, which `Game`
 * hands no `onSurface` — its blocks are unmerged, and its brush rewrites the
 * floor's meshes in place — and every other surface stays Babylon's in every
 * pass, as do the taken surfaces our side will never draw (handed back whole,
 * so every surface is drawn by one side): a pipeline's or the cull's failure
 * hands back its surfaces in the turn it lands, and a main pass our renderer
 * REFUSES (`Renderer.onRefused`) hands back the whole map, for the rest of
 * it, from the next frame — the refused one is the one frame drawn without
 * them; a taken mesh is drawn by our side
 * in the MAIN pass only and stays Babylon's in every other Babylon draws (the
 * probes, and the shadow maps and the lamps' atlas while they are Babylon's),
 * because only the main pass's candidate list
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
 * whole, scatter and all. THE SHADOWS ARE TAKEN WHOLE OR NOT AT ALL
 * (X3.6a, X3.6b): a surface CASTS as Babylon would have drawn it — into the
 * world's maps (`PASS_CASTS`) if it is not `noShadowCaster` and not blended,
 * a translucent SOLID into the foliage's too (`PASS_SOLID`), and into the
 * lamps' atlas (`PASS_LAMPS`) if it is not `noShadowCaster`, blended or not,
 * as `LocalShadows`' bake drew it; a caster the main pass does not take is
 * held for the shadows alone (`WorldBlocks.addCaster`: its positions, at
 * identity, never `updatable`); and only when EVERY caster is held, taken or
 * so, are the casters handed to `WorldShadows` and `LampAtlas` together, at
 * slots of the culls apart — one we cannot hold leaves the whole map's
 * shadows to Babylon (its generators and the atlas's render target), and a
 * caster handed back later, or a refused main pass, LOSES them to Babylon for
 * the rest of the map (`WorldShadows.lose`, `LampAtlas.lose`), so no caster
 * is ever drawn by neither side or in half a map. THE REFLECTION BAKE TOO
 * (X3.6c): every taken surface and part is in a probe's bake (`PASS_PROBE`),
 * the emissive palette is held for it with its slots
 * (`WorldBlocks.addEmissive`, `CelMaterialFactory.emissiveRecipe`) whether it
 * casts or not, a FIRE is left out of it as Babylon's bake leaves it
 * (`FINDINGS.md` 51), and the world is handed to `ProbeBake` when no surface
 * it draws went back at the cut; `probeHolds` answers `ReflectionSystem`
 * whether that is every mesh of a probe's list, and a surface it draws handed
 * back later, or a refused main pass, LOSES the bake to Babylon
 * (`ProbeBake.lose`).
 * Never: draws, or reads a material's uniforms — a material reaches our side
 * as its recipe; writes a property on a mesh.
 * Contract: `docs/rendering.md`, "Our renderer's frame";
 * `BABYLON_EXIT.md` X3.3a, X3.3b, X3.3c, X3.4, X3.4b, X3.5, X3.5b, X3.6a.
 */
import type { AbstractMesh, Material, Mesh } from "@babylonjs/core";
import { CONFIG } from "../config";
import { type BlockBox, type CullDiagnostics, NO_DIAGNOSTICS } from "../render/ClusterCull";
import type { Renderer } from "../render/Renderer";
import type { LampAtlas } from "../render/LampAtlas";
import type { ProbeBake } from "../render/ProbeBake";
import {
  blockKey,
  blockKeyOf,
  PASS_CASTS,
  PASS_LAMPS,
  PASS_PROBE,
  PASS_SOLID,
  SHADOW_PASSES,
} from "../render/wgsl/clusterCull";
import { WorldBlocks } from "../render/WorldBlocks";
import type { WorldDepth } from "../render/WorldDepth";
import type { WorldShadows } from "../render/WorldShadows";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { ProbeHolding } from "./ReflectionSystem";
import { isFlame } from "../shaders/FlameShader";
import type { ScatterField } from "../world/scatterVariants";
import type { WorldGeometry, WorldSurface } from "../world/worldGeometry";
import { NO_REACH, type WorldCulling } from "./WorldCulling";

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
  /**
   * Of those, the ones HELD rather than taken, which no main pass of ours
   * draws: the casters held for the shadows alone (`WorldBlocks.addCaster`)
   * and the emissive palette held for the probes' bake (`addEmissive`).
   */
  private held = new Set<Mesh>();
  /** The surfaces that cast, by index — one of them handed back loses the shadows. */
  private casting = new Set<number>();
  /** The surfaces a probe's bake draws (`PASS_PROBE`), by index — one of them handed back loses the bake. */
  private probing = new Set<number>();
  /** The fires (`FlameMaterial` merges), which no probe has ever drawn (`FINDINGS.md` 51) and ours draws none of. */
  private fires = new Set<Mesh>();
  /** Every caster of the map built so far is held, taken or for the shadows alone. */
  private allCasters = true;
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
    /** Our renderer's shadow maps, handed the casters when every one is held. */
    private readonly shadows: WorldShadows,
    /** Our renderer's lamps' atlas, handed the same casters with them. */
    private readonly lamps: LampAtlas,
    /** Our renderer's reflection bake, handed the world when it holds every surface a bake draws. */
    private readonly probes: ProbeBake,
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
   * — see the header for the test — or holds it for the shadows alone if
   * it casts, and hands its arrays over while they can still be read.
   */
  readonly onSurface = (surface: WorldSurface, mesh: Mesh): void => {
    const { part } = surface;
    const passes = this.passesOf(part.metadata, part.material, mesh);
    const key = blockKeyOf(surface.block);
    const p = part.position;
    const r = part.rotation;
    const k = part.scaling;
    const atIdentity =
      p.x === 0 && p.y === 0 && p.z === 0 &&
      r.x === 0 && r.y === 0 && r.z === 0 &&
      k.x === 1 && k.y === 1 && k.z === 1 &&
      part.rotationQuaternion === null &&
      mesh.parent === null;
    // Every surface the main pass takes is in a probe's bake too: Babylon's
    // drew the map's visuals whole but for the glazing, which is never taken.
    let at = this.takeForMainPass(surface, mesh, atIdentity, passes | PASS_PROBE, key);
    let drawn = passes | PASS_PROBE;
    if (at === null) {
      drawn = this.heldPasses(surface, mesh, atIdentity, passes);
      at = this.hold(surface, atIdentity, drawn, key);
      // A fire is left out of our bake as Babylon's left it out of its own.
      if (isFlame(part.material)) this.fires.add(mesh);
      // A caster our side can hold in neither way: the map's shadows stay Babylon's.
      if (at === null) {
        if ((passes & SHADOW_PASSES) !== 0) this.allCasters = false;
        return;
      }
      this.held.add(mesh);
    }
    this.meshes[at] = mesh;
    if ((drawn & SHADOW_PASSES) !== 0) this.casting.add(at);
    if ((drawn & PASS_PROBE) !== 0) this.probing.add(at);
    if (surface.landform) this.landform.add(mesh);
  };

  /**
   * `surface` added to the main pass's blocks if our pipeline draws it exactly
   * as Babylon would — see the header for the test — and its index; else null.
   */
  private takeForMainPass(surface: WorldSurface, mesh: Mesh, atIdentity: boolean, passes: number, key: number): number | null {
    const { part } = surface;
    if ((surface.block === null && !surface.landform) || surface.updatable) return null;
    // Drawn in group 0's slot, at the world's own origin, by every camera.
    if (mesh.renderingGroupId !== 0 || !atIdentity) return null;
    if (mesh.layerMask !== DEFAULT_LAYER_MASK) return null;
    const recipe = this.mats.celRecipe(part.material);
    if (!recipe) return null;
    const g = part.geometry;
    if (!g.normals || !g.colors) return null;
    if (recipe.defines.includes("CEL_PALETTE") && !g.uvs2) return null;
    return this.blocks.add(part.name, g, recipe, surface.pieces, surface.landform, passes, key);
  }

  /**
   * The passes a surface the main pass does not take is held for: its
   * shadow passes, and a probe's bake (`PASS_PROBE`) if it is the emissive
   * PALETTE (`CelMaterialFactory.emissiveRecipe`) with its slots, drawn as
   * Babylon draws it — rendering group 0, every camera's layer mask.
   */
  private heldPasses(surface: WorldSurface, mesh: Mesh, atIdentity: boolean, passes: number): number {
    const { part } = surface;
    if (!atIdentity || !this.mats.emissiveRecipe(part.material) || !part.geometry.uvs2) return passes;
    if (mesh.renderingGroupId !== 0 || mesh.layerMask !== DEFAULT_LAYER_MASK) return passes;
    return passes | PASS_PROBE;
  }

  /**
   * `surface`, which the main pass does not take, held for the passes
   * `passes` names if its positions are world positions and nothing rewrites
   * them — a block merge, at identity, never `updatable`: the palette with its
   * slots for a probe's bake (and its shadows), a caster's positions alone for
   * the shadows — and its index; else null.
   */
  private hold(surface: WorldSurface, atIdentity: boolean, passes: number, key: number): number | null {
    if (passes === 0 || surface.block === null || surface.updatable || !atIdentity) return null;
    const { part } = surface;
    const palette = (passes & PASS_PROBE) !== 0 ? this.mats.emissiveRecipe(part.material) : null;
    if (palette) return this.blocks.addEmissive(part.name, part.geometry, surface.pieces, palette, passes, key);
    return this.blocks.addCaster(part.name, part.geometry, surface.pieces, passes, key);
  }

  /**
   * The shadow passes a surface or a part is drawn in, as Babylon would have
   * drawn it: none for a `noShadowCaster` one; the lamps' atlas for every
   * other (`LocalShadows`' bake drew its visuals whatever their material);
   * the world's maps for those Babylon's generators would have been handed
   * (`ShadowSystem.casts`) — not one a generator skips as blended
   * (`transparencyShadow` off) — and the foliage's too for a translucent
   * SOLID (`CelMaterialFactory.isSolid`). The generators' own statement of
   * it is `ShadowSystem.casts`, which the blend test is not in because a
   * generator makes it itself, and the atlas's is `LocalShadows.setWorld`'s
   * filter: each must agree, or a shadow differs by who draws it.
   */
  private passesOf(metadata: { noShadowCaster?: boolean } | null | undefined, material: Material | null, mesh: Mesh | null): number {
    if (metadata?.noShadowCaster) return 0;
    // A part has no mesh of its own: its material alone says whether it blends.
    if (material && (mesh ? material.needAlphaBlendingForMesh(mesh) : material.needAlphaBlending())) return PASS_LAMPS;
    return PASS_LAMPS | PASS_CASTS | (this.mats.isSolid(material) ? PASS_SOLID : 0);
  }

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
          // A part wears the block merge's palette material, so a recipe our
          // side cannot keep is one whose blocks it never took either: Babylon
          // draws that recipe whole, scatter and all. A part our side cannot
          // draw for want of an array hands its whole group back
          // (`WorldBlocks.addInstanced`), never skipped while its pieces are cut.
          const recipe = this.mats.celRecipe(part.material);
          if (recipe) {
            const passes = this.passesOf(part.metadata, part.material, null) | PASS_PROBE;
            this.blocks.addInstanced(s, part.name, part.geometry, recipe, passes);
          }
        }
      });
    }
    this.back = new Set();
    this.handedBack = false;
    this.epoch = -1;
    this.reported = false;
    this.fileTaken(meshes);
    // A caster held for the shadows alone is not taken, so the cull has no
    // reach box for it, and is never reach-culled: no main pass draws it, the
    // world's maps cull by no reach, and a lamp face (which reaches only its
    // light's range) draws one past it, which the face's far plane clips or
    // stores as a distance over 1 — lit, as no caster at all would read.
    const boxes: BlockBox[] = meshes.map((mesh) =>
      this.held.has(mesh) ? NO_REACH : this.culling.reachBoxOf(mesh),
    );
    // Held for shadows that draw: on a rung with every map and the atlas off
    // there is nothing to draw them into, and Babylon's (of none) are the map's.
    const holdsAll =
      this.allCasters && this.casting.size > 0 && (this.shadows.rungDraws || this.lamps.rungDraws);
    this.blocks.finish(
      boxes,
      field
        ? {
            cut: (piece) => world.pieces[piece]?.list === "scatter",
            sets: field.sets.map((set) => ({
              matrices: set.matrices,
              scales: set.scales,
              keys: Uint32Array.from({ length: set.scales.length }, (_, i) =>
                blockKey(set.blocks[i * 2], set.blocks[i * 2 + 1]),
              ),
            })),
          }
        : null,
      // The world's maps' slots first, then the atlas's static faces'.
      holdsAll ? this.shadows.slots + this.lamps.slots : 0,
    );
    // The cut may already have handed casters back — a group it could not
    // draw, or the whole map past the device's limits — before there were
    // casters to lose: then the map's shadows were never ours to hand over.
    let whole = holdsAll;
    for (const at of this.casting) if (this.back.has(this.meshes[at])) whole = false;
    this.handCasters(whole ? this.blocks.depth : null);
    // And the world a probe's bake draws, under the same rule: none, if a
    // surface it draws already went back.
    let probes = this.probing.size > 0;
    for (const at of this.probing) if (this.back.has(this.meshes[at])) probes = false;
    this.probes.setWorld(probes ? this.blocks : null);
  }

  /**
   * Whether our renderer's bake draws every mesh of `list` — a probe's
   * render list as Babylon's bake would have it (`ReflectionSystem`): each
   * taken and not handed back, or the palette held for it, or a FIRE, which
   * no bake has ever drawn (`FINDINGS.md` 51) — and, of the list, how many
   * fall where. False with no world handed to the bake.
   */
  probeHolds(list: readonly Mesh[]): ProbeHolding {
    const at = new Map<Mesh, number>();
    this.meshes.forEach((m, i) => at.set(m, i));
    let taken = 0;
    let palette = 0;
    let fires = 0;
    let other = 0;
    for (const mesh of list) {
      const i = at.get(mesh);
      if (this.fires.has(mesh)) fires++;
      else if (i === undefined || this.back.has(mesh) || !this.probing.has(i)) other++;
      else if (this.held.has(mesh)) palette++;
      else taken++;
    }
    const ours = this.probes.holds && other === 0 && !this.handedBack;
    return { ours, taken, palette, fires, other };
  }

  /** The casters to every shadow of ours — or none, when the map's shadows are Babylon's. */
  private handCasters(depth: WorldDepth | null): void {
    this.shadows.setCasters(depth);
    this.lamps.setCasters(depth, this.shadows.slots);
  }

  /** The casters can no longer draw what Babylon would: every shadow of ours goes back to Babylon. */
  private loseCasters(): void {
    this.shadows.lose();
    this.lamps.lose();
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
    // The main pass's: a caster held for the shadows alone is not taken from it.
    const taken = surfaces - this.held.size;
    let back = 0;
    for (const mesh of this.back) if (!this.held.has(mesh)) back++;
    return {
      taken,
      clusters,
      groups,
      drawn: this.blocks.drawn,
      handedBack: this.handedBack ? taken : back,
    };
  }

  /** The map is going: every surface, buffer and material of ours with it, and the shadows' casters first. */
  clear(): void {
    this.handCasters(null);
    // Ahead of the blocks, whose culls the bake's view reads.
    this.probes.setWorld(null);
    this.blocks.clear();
    this.field = null;
    this.meshes = [];
    this.landform = new Set();
    this.back = new Set();
    this.held = new Set();
    this.casting = new Set();
    this.probing = new Set();
    this.fires = new Set();
    this.allCasters = true;
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
    // A caster going back is Babylon's to draw into a shadow: so is every other.
    if (surfaces.some((at) => this.casting.has(at))) this.loseCasters();
    // …and one a probe's bake draws is Babylon's to bake: so is every other.
    if (surfaces.some((at) => this.probing.has(at))) this.probes.lose();
    this.fileTaken(this.meshes.filter((m) => !this.back.has(m)));
  };

  /**
   * Tells the cull `meshes` are ours, each as the block or the landform the
   * build said it was — but for those held for the shadows alone, which
   * the main pass is never told of.
   */
  private fileTaken(meshes: readonly Mesh[]): void {
    const drawn = meshes.filter((m) => !this.held.has(m));
    this.culling.setTaken(
      drawn.filter((m) => !this.landform.has(m)),
      drawn.filter((m) => this.landform.has(m)),
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
    this.loseCasters();
    this.probes.lose();
    this.blocks.stop();
    this.culling.setTaken([], []);
    console.error(
      `BlockHandover: the main pass was refused; all ${this.meshes.length} taken surfaces go back to Babylon for this map`,
    );
  };

  /**
   * Once a frame as the main pass begins: a material rewritten by its owner
   * is copied again, and a DEV build checks that no mesh of ours — taken, or
   * held for the shadows alone — has been switched, hidden or faded:
   * Babylon would stop drawing or casting it, or draw it blended, and our
   * side, which reads no node, would not follow.
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
        `BlockHandover: "${mesh.name}" was switched off, hidden or faded after it was taken; our renderer still draws it (BABYLON_EXIT.md X3.3b, X3.6a)`,
      );
      return;
    }
  }
}
