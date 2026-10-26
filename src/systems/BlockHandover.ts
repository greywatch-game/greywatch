/**
 * systems/BlockHandover.ts — The map's world as OUR renderer draws it: its
 * BLOCKS and, since X3.5, its LANDFORM in the main pass (`BABYLON_EXIT.md`
 * X3.3, X3.5), and since X3.6a its shadow CASTERS in our renderer's shadow
 * maps — since X3.6b the lamps' atlas too, since X3.6c the reflection bake,
 * since X3.6d the emissive palette's share of the glow's mask, and since
 * X3.6e that palette's main pass — and since X3.7b with NO FALLBACK: which
 * surfaces are ours, and so made no Babylon mesh at all; their arrays handed
 * over on the way past the build; the map cut once it is filed; and the
 * refusal, a failure being the world's (`Game.worldFailed`) rather than a
 * handback.
 * Owns: `BlockHandover` — our renderer's `WorldBlocks`, each surface of
 * ours's reach key (the block its record is filed under), which of them are
 * the emissive PALETTE and which are casters held rather than drawn (the
 * HELD layer, unreachable by construction: see `held`), which of them cast, which a
 * probe's bake draws and which the glow's mask draws, the fires, the held
 * casters' meshes (for the DEV node check), the refusal held until the
 * install (`refusal`), whose world the install is (`owner`, latched at the
 * install and handed back with its failure) and the install's failure, once
 * it failed (`failure`), the material epoch last copied, and the build's
 * scatter FIELD until the map is cut (X3.4b).
 * Invariants: a surface is OURS — answered `true` to `onSurface`, made no
 * mesh — if our pipeline draws it in every pass exactly as Babylon would:
 * block-merged or the LANDFORM (`WorldSurface.landform`: the floor's
 * patches, the rim's runs and the map-wide road merge, which the BUILD
 * marks and nothing here guesses), at identity, never written after its
 * build (`updatable` is a breakable pane's), and on a cel material that
 * keeps a recipe (`CelMaterialFactory.celRecipe`: no glazing, no cloth, no
 * emissive) — or the emissive PALETTE, block-merged at identity with its
 * slots, ours in its main pass, its bake, its shadows and — unless it is
 * `noGlow`, read PER SURFACE at the take — its glow mask; and that test is
 * asked of the surface's RECORD, never of a mesh (X3.7a: the identity off
 * the part's own transform, the blend off the material, `blends`, and
 * rendering group 0 on the layer mask every camera sees by construction,
 * those being what `worldMeshes` makes every world mesh with). Everything
 * else is BABYLON's, made a mesh — on a shipped map the glazing and the
 * fires alone — and a surface Babylon keeps may need nothing of ours but
 * its shadow: a caster among them is HELD for the shadows alone
 * (`WorldBlocks.addCaster`: its positions, at identity, never `updatable`)
 * — which no build can reach, its mesh being refused below unless it is a
 * fire and every fire being `noShadowCaster` (`held`) — and one that casts but cannot be held, a palette surface that cannot be
 * held, or a mesh Babylon is made that is neither the glazing nor a fire
 * (`strayMesh`: one our bake would owe a picture of, a held caster's among
 * them)
 * is REFUSED — held to the install, which fails the world on it, and then
 * THROWN in a DEV build (so `npm run merge:hash` cannot pass a map that has
 * one, and the page still reaches the menu). **THE WORLD DRAWS WHOLE OR THE
 * ROUND DOES NOT START** (`BABYLON_EXIT.md` X3.7b): every former handback is
 * the world's failure — a group or a cull our side cannot draw
 * (`WorldBlocks.onFailed`), a surface filed under a block the cull grew no
 * cell for (`WorldCulling.reachBoxOf`), a cut past the device's limits, a
 * main-pass palette pipeline that failed, a main pass our renderer REFUSES
 * (`Renderer.onRefused`), a pass of ours that cannot draw the world it was
 * handed — the shadow maps', the lamps' atlas's, the bake's and the glow
 * mask's: a build or a view that failed, a pipeline failed for the session,
 * a refused mask pass, each told through the failure the install hands
 * over WITH the world (`failFor`, bound to the install's owner, so a pass
 * holds no latch and keeps no listener) — and in DEV a held caster switched
 * off, hidden or faded — each said ONCE an install (`fail`), our draws
 * stopped there and then, and
 * handed to `Game.worldFailed` with the install's OWNER (`WorldOwner`), so a
 * failure names the map it came from and is never another round's, and
 * nothing of an EDITOR build fails (`install`'s `editor`, the build's kind,
 * never whether ours took a surface); `Game` takes the round down after the
 * task in hand; nothing goes back to Babylon, which has no mesh to draw it
 * with.
 * Our surfaces are drawn ahead of group 0's alpha-tested meshes, the
 * palette first and the blocks before the landform (`WorldBlocks`'s header
 * says why); nothing is taken from an EDITOR build, which `Game` hands no
 * `onSurface` — its blocks are unmerged, and its brush rewrites the floor's
 * meshes in place — so Babylon draws every surface of it, in every pass;
 * what our side draws of the main pass each frame is decided on the GPU,
 * cluster by cluster, from numbers alone — the frame's camera, and the
 * reach and size gate `WorldCulling` decides (`WorldCulling.reachGate`,
 * measured to the box of the cell a block's records grew, and never cutting
 * the landform, which has none — `reachBoxOf`) — so no node is read per
 * frame; the building card waits for our pipelines through the renderer's
 * own cache (`core/PipelineWarmup.ts`), never through this, and a failed
 * pipeline fails the world in the turn its compile settles, under the card;
 * the SCATTER is drawn by our side as instances of its variants
 * (`BABYLON_EXIT.md` X3.4b), each set's parts added to the group of its
 * recipe, and its pieces (its regions) are cut out of the blocks of every
 * group that draws them so — the scatter stays merged into the block
 * ARRAYS, whose spheres, cell boxes and probe region key read it. A surface
 * CASTS as Babylon would have drawn it — into the world's maps
 * (`PASS_CASTS`) if it is not `noShadowCaster` and not blended, a
 * translucent SOLID into the foliage's too (`PASS_SOLID`), and into the
 * lamps' atlas (`PASS_LAMPS`) if it is not `noShadowCaster`, blended or not,
 * as `LocalShadows`' bake drew it — and the casters are handed to
 * `WorldShadows` and `LampAtlas` together, at slots of the culls apart, on
 * EVERY shadow rung, `off` included, so a rung raised mid-map draws ours
 * (X3.7b); every surface of ours and every part is in a probe's bake
 * (`PASS_PROBE`), the palette with its slots (`WorldBlocks.addEmissive`,
 * `CelMaterialFactory.emissiveRecipe`) whether it casts or not, a FIRE left
 * out as Babylon's bake leaves it (`FINDINGS.md` 51); the palette is a
 * LIGHT SOURCE, which no size gate drops (`LIGHT_SOURCE`), its main pass
 * ours (`WorldBlocks` draws it first), and its mask handed to `WorldGlow`
 * whenever a surface of it glows.
 * Never: draws, or reads a material's uniforms — a material reaches our side
 * as its recipe; writes a property on a mesh; hands a surface back.
 * Contract: `docs/rendering.md`, "Our renderer's frame";
 * `BABYLON_EXIT.md` X3.3a, X3.3b, X3.3c, X3.4, X3.4b, X3.5, X3.5b, X3.6a,
 * X3.6b, X3.6c, X3.6d, X3.6e, X3.7a, X3.7b, X3.7c.
 */
import { type AbstractMesh, Material, type Mesh } from "@babylonjs/core";
import { CONFIG } from "../config";
import { type BlockBox, type CullDiagnostics, NO_DIAGNOSTICS } from "../render/ClusterCull";
import type { Renderer } from "../render/Renderer";
import type { LampAtlas } from "../render/LampAtlas";
import type { ProbeBake } from "../render/ProbeBake";
import {
  blockKey,
  blockKeyOf,
  LIGHT_SOURCE,
  PASS_CASTS,
  PASS_GLOW,
  PASS_LAMPS,
  PASS_PROBE,
  PASS_SOLID,
  SHADOW_PASSES,
} from "../render/wgsl/clusterCull";
import { WorldBlocks } from "../render/WorldBlocks";
import type { WorldDepth } from "../render/WorldDepth";
import type { WorldGlow } from "../render/WorldGlow";
import type { WorldShadows } from "../render/WorldShadows";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { isFlame } from "../shaders/FlameShader";
import type { ScatterField } from "../world/scatterVariants";
import type { WorldGeometry, WorldSurface } from "../world/worldGeometry";
import { blockOf, NO_REACH, type WorldCulling } from "./WorldCulling";

/**
 * Whether `material` draws BLENDED, as `Material.needAlphaBlendingForMesh`
 * answers for every world mesh `worldMeshes` makes — `visibility` 1 and no
 * vertex alpha (it clears `hasVertexAlpha` on every surface the bake gave
 * colours): the material's `transparencyMode` when it states one, else its
 * own `needAlphaBlending`. Asked of the material alone, so a surface's
 * shadow passes are decided off its record (`BABYLON_EXIT.md` X3.7a), and a
 * scatter part's — which has no mesh at all — by the same words.
 */
function blends(material: Material | null): boolean {
  if (!material) return false;
  const mode = material.transparencyMode;
  if (mode !== null && mode !== undefined) {
    return mode === Material.MATERIAL_ALPHABLEND || mode === Material.MATERIAL_ALPHATESTANDBLEND;
  }
  return material.needAlphaBlending();
}

/** What the build hands `install`: its records, the meshes Babylon was given, and which of them are the glazing. */
export interface InstalledWorld {
  readonly world: WorldGeometry;
  readonly visuals: readonly Mesh[];
  readonly paneGroups: readonly { readonly mesh: Mesh }[];
}

/**
 * Whose world an install is: the map it was built of — named in its
 * failure's console line and toast — as a FRESH object an install, so a
 * failure says which install it came from, and `Game.worldFailed` can tell
 * the round in hand's from the map still standing under the next round's
 * building card (`BABYLON_EXIT.md` X3.7b's review).
 */
export interface WorldOwner {
  readonly id: string;
  readonly name: string;
}

export class BlockHandover {
  private readonly blocks: WorldBlocks;
  /**
   * Each surface of ours, by its index in `blocks`: the block its record is
   * filed under, which `install` cuts it against (`WorldCulling.reachBoxOf`)
   * — null for the LANDFORM (`WorldSurface.landform`), as the build marked
   * it.
   */
  private reach: (string | null)[] = [];
  /**
   * Of those, the casters HELD for the shadows alone (`WorldBlocks.addCaster`),
   * which Babylon draws in the main pass — by index, to the surface's own
   * index in the build, which names its mesh.
   *
   * **Always empty, by construction rather than by luck** (X3.7c's review): a
   * held caster is made a Babylon mesh, and `strayMesh` refuses every mesh
   * that is neither the glazing nor a fire; the glazing is `noShadowCaster`
   * (`MapBuilder`), and so is every fire, hard-coded where a fire is made
   * (`flame.ts`'s `flamePart`, the fire drum's flame) — so no held caster
   * can exist without making a fire cast. The layer, and the DEV node check
   * that reads its meshes, are kept for X4.4 (the fires) to use or delete.
   */
  private held = new Map<number, number>();
  /** Of those, the emissive PALETTE (`WorldBlocks.addEmissive`): ours in every pass. */
  private palette = new Set<number>();
  /** The surfaces that cast, by index. */
  private casting = new Set<number>();
  /** The surfaces a probe's bake draws (`PASS_PROBE`), by index. */
  private probing = new Set<number>();
  /** The surfaces the glow's mask draws (`PASS_GLOW`), by index: the palette's, but for one marked `noGlow`. */
  private glowing = new Set<number>();
  /** The fires (`FlameMaterial` merges), by the surface's index in the build: Babylon's, and in no bake (`FINDINGS.md` 51). */
  private fireSurfaces: number[] = [];
  /** Their meshes, found at `install`. */
  private fires = new Set<Mesh>();
  /** The held casters' meshes, found at `install`: what the DEV node check reads. */
  private heldMeshes: Mesh[] = [];
  /** A surface this build could not hold: the install fails on it (`refuse`). */
  private refusal: string | null = null;
  /**
   * Whose world this is, latched at `install` and handed back with its
   * failure: null for an EDITOR build — Babylon's whole, so nothing of it can
   * fail the world — and from a `clear` until the next install.
   */
  private owner: WorldOwner | null = null;
  /** Why this install failed, once it did: said once (`fail`). */
  private failure: string | null = null;
  /** `CelMaterialFactory.materialEpoch` as last copied; -1 is never. */
  private epoch = -1;
  /** The build's scatter, held from `onScatter` until `install` hands it over. */
  private field: ScatterField | null = null;
  private readonly removeFrame: () => void;
  private readonly removeRefused: () => void;

  constructor(
    renderer: Renderer,
    private readonly mats: CelMaterialFactory,
    private readonly culling: WorldCulling,
    /** Our renderer's shadow maps, handed the casters (and the install's failure). */
    private readonly shadows: WorldShadows,
    /** Our renderer's lamps' atlas, handed the same casters with them. */
    private readonly lamps: LampAtlas,
    /** Our renderer's reflection bake, handed the world (and the install's failure). */
    private readonly probes: ProbeBake,
    /** Our renderer's share of the glow's mask, handed the world when a palette surface glows. */
    private readonly glow: WorldGlow,
    /**
     * Told, once an install, that the world cannot be drawn, why, and whose
     * install it was — after our draws have stopped. `Game.worldFailed`,
     * which takes the round down after the task in hand (a failure may land
     * inside a render).
     */
    private readonly worldFailed: (reason: string, owner: WorldOwner) => void,
    /** Our culls' diagnostics — `?nocull`, `?nofrustum`, `?cullcheck` (`core/urlOverrides.ts`). */
    diagnostics: CullDiagnostics = NO_DIAGNOSTICS,
  ) {
    this.blocks = new WorldBlocks(
      renderer,
      culling.reachGate,
      CONFIG.graphics.clusters,
      this.failed,
      this.mainPaletteFailed,
      diagnostics,
    );
    this.removeFrame = renderer.onFrame(this.frame);
    this.removeRefused = renderer.onRefused(this.refused);
  }

  /**
   * The build's `BuildOptions.onSurface`: whether our side draws `surface`
   * — see the header for the test — handing its arrays over while they can
   * still be read; `true` and the build makes no mesh of it. A surface
   * Babylon keeps that casts is held for the shadows; one that cannot be
   * is refused (`refuse`).
   */
  readonly onSurface = (surface: WorldSurface, index: number): boolean => {
    const { part } = surface;
    const passes = this.passesOf(part.metadata, part.material);
    const key = blockKeyOf(surface.block);
    const p = part.position;
    const r = part.rotation;
    const k = part.scaling;
    // The part's own transform: it has no parent by now (`worldMeshes`
    // refuses one), so this is a mesh's world matrix being the identity.
    const atIdentity =
      p.x === 0 && p.y === 0 && p.z === 0 &&
      r.x === 0 && r.y === 0 && r.z === 0 &&
      k.x === 1 && k.y === 1 && k.z === 1 &&
      part.rotationQuaternion === null;
    // Every surface the main pass takes is in a probe's bake too: Babylon's
    // drew the map's visuals whole but for the glazing, which is never ours.
    let at = this.takeForMainPass(surface, atIdentity, passes | PASS_PROBE, key);
    let drawn = passes | PASS_PROBE;
    if (at === null) {
      drawn = this.heldPasses(surface, atIdentity, passes);
      const held = this.hold(surface, atIdentity, drawn, key);
      // The palette is ours whole or the map is refused.
      if (this.mats.emissiveRecipe(part.material) !== null && !held?.palette) {
        return this.refuse(`"${part.name}" wears the emissive palette but is not block-merged at identity with its slots`);
      }
      // A fire is left out of our bake as Babylon's left it out of its own.
      if (isFlame(part.material)) this.fireSurfaces.push(index);
      if (held === null) {
        if ((passes & SHADOW_PASSES) !== 0) {
          return this.refuse(`"${part.name}" casts a shadow but our renderer can hold it in no way`);
        }
        // Babylon's alone, in every pass: the glazing, a fire.
        return false;
      }
      at = held.at;
      if (held.palette) this.palette.add(at);
      else this.held.set(at, index);
    }
    this.reach[at] = surface.landform ? null : (blockOf(part.metadata) ?? "");
    if ((drawn & SHADOW_PASSES) !== 0) this.casting.add(at);
    if ((drawn & PASS_PROBE) !== 0) this.probing.add(at);
    if ((drawn & PASS_GLOW) !== 0) this.glowing.add(at);
    // A held caster is still Babylon's in the main pass.
    return !this.held.has(at);
  };

  /**
   * `surface` added to the main pass's blocks if our pipeline draws it exactly
   * as Babylon would — see the header for the test, which is the record's —
   * and its index; else null.
   */
  private takeForMainPass(surface: WorldSurface, atIdentity: boolean, passes: number, key: number): number | null {
    const { part } = surface;
    if ((surface.block === null && !surface.landform) || surface.updatable) return null;
    // At the world's own origin; group 0's slot and every camera's mask are
    // every world mesh's (see the header).
    if (!atIdentity) return null;
    const recipe = this.mats.celRecipe(part.material);
    if (!recipe) return null;
    const g = part.geometry;
    if (!g.normals || !g.colors) return null;
    if (recipe.defines.includes("CEL_PALETTE") && !g.uvs2) return null;
    return this.blocks.add(part.name, g, recipe, surface.pieces, surface.landform, passes, key);
  }

  /**
   * The passes a surface the main pass does not take is held for: its
   * shadow passes, and if it is the emissive PALETTE
   * (`CelMaterialFactory.emissiveRecipe`) with its slots — drawn as Babylon
   * draws it, at identity, and in rendering group 0 on every camera's layer
   * mask as every world mesh is (see the header) — a probe's bake
   * (`PASS_PROBE`), `LIGHT_SOURCE` (no size gate drops it, as the frame's
   * mesh walk never gated an emissive), and the glow's mask (`PASS_GLOW`)
   * unless this surface is `noGlow` — read here, per surface, as `GlowPass`
   * read it per mesh.
   */
  private heldPasses(surface: WorldSurface, atIdentity: boolean, passes: number): number {
    const { part } = surface;
    if (!atIdentity || !this.mats.emissiveRecipe(part.material) || !part.geometry.uvs2) return passes;
    const glows = (part.metadata as { noGlow?: boolean } | null | undefined)?.noGlow !== true;
    return passes | PASS_PROBE | LIGHT_SOURCE | (glows ? PASS_GLOW : 0);
  }

  /**
   * `surface`, which the main pass does not take, held for the passes
   * `passes` names if its positions are world positions and nothing rewrites
   * them — a block merge, at identity, never `updatable`: the palette with its
   * slots for every pass of ours, a caster's positions alone for the shadows
   * — its index, and which of the two it was made; else null.
   */
  private hold(
    surface: WorldSurface,
    atIdentity: boolean,
    passes: number,
    key: number,
  ): { at: number; palette: boolean } | null {
    if (passes === 0 || surface.block === null || surface.updatable || !atIdentity) return null;
    const { part } = surface;
    const palette = (passes & PASS_PROBE) !== 0 ? this.mats.emissiveRecipe(part.material) : null;
    if (palette) {
      const at = this.blocks.addEmissive(part.name, part.geometry, surface.pieces, palette, passes, key);
      return { at, palette: true };
    }
    if ((passes & SHADOW_PASSES) === 0) return null;
    const at = this.blocks.addCaster(part.name, part.geometry, surface.pieces, passes, key);
    return { at, palette: false };
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
   * filter: each must agree, or a shadow differs by who draws it (an editor
   * build's are Babylon's). The blend is the material's (`blends`), for a
   * surface and a scatter part alike.
   */
  private passesOf(metadata: { noShadowCaster?: boolean } | null | undefined, material: Material | null): number {
    if (metadata?.noShadowCaster) return 0;
    if (blends(material)) return PASS_LAMPS;
    return PASS_LAMPS | PASS_CASTS | (this.mats.isSolid(material) ? PASS_SOLID : 0);
  }

  /**
   * A surface this build cannot hold: held until `install`, which fails the
   * world on it — the surface made a mesh meanwhile, so the build completes
   * and the map it built is torn down whole — and in a DEV build then
   * THROWS, so `npm run merge:hash` refuses the map, the page still reaching
   * the menu (`fail` is told first). Answers `false` for `onSurface`.
   */
  private refuse(why: string): false {
    this.refusal ??= `BlockHandover: ${why} (BABYLON_EXIT.md X3.7b: the world draws whole or the round does not start)`;
    return false;
  }

  /**
   * The build's `BuildOptions.onScatter`: the scatter as our side draws it,
   * kept until `install`.
   */
  readonly onScatter = (field: ScatterField): void => {
    this.field = field;
  };

  /**
   * After the map's build and `WorldCulling.setMap`: cuts the map against
   * the cells its records were filed in, the scatter's sets added as
   * instances and its pieces (`world`'s scatter regions) cut out of the
   * blocks that draw them so, and hands every pass of ours its world — the
   * casters to the shadows on every rung, the world to the bake and the
   * palette's glowing share to the mask — each with the install's failure
   * (`failFor`), which it tells if it cannot draw what it was handed.
   * `owner` is latched for the install's failure; an EDITOR build
   * (`editor`) is taken from by
   * nothing and fails nothing — the exemption is the build's kind, never
   * that ours took no surface, so a production refusal on a map ours took
   * nothing of still fails. A refusal held from the build (thrown after it
   * in a DEV build: `refuse`), a mesh Babylon was
   * made that is neither the glazing nor a fire (`strayMesh`), a surface
   * filed under a block no cell was grown for, or a cut that fails, fails
   * the world (`fail`).
   */
  install(map: InstalledWorld, owner: WorldOwner, editor: boolean): void {
    this.owner = editor ? null : owner;
    const failed = (reason: string): void => this.failFor(owner, reason);
    const meshOf = (index: number): Mesh | null => {
      const v = map.world.surfaces[index]?.visual ?? -1;
      return v >= 0 ? (map.visuals[v] ?? null) : null;
    };
    this.fires = new Set(this.fireSurfaces.map(meshOf).filter((m): m is Mesh => m !== null));
    this.heldMeshes = [...this.held.values()].map(meshOf).filter((m): m is Mesh => m !== null);
    this.epoch = -1;
    const field = this.field;
    this.field = null;
    if (editor) return;
    const stray = this.strayMesh(map);
    if (stray) this.refuse(stray);
    if (this.refusal) {
      this.fail(this.refusal);
      // DEV: a page error out of `buildRound` too, which `merge:hash` fails
      // on — after `fail`, so the page still reaches the menu.
      if (import.meta.env.DEV) throw new Error(this.refusal);
      return;
    }
    if (field) {
      field.sets.forEach((set, s) => {
        for (const part of set.parts) {
          // A part wears the block merge's palette material, so a recipe our
          // side cannot keep is one whose blocks it never took either — which
          // a shipped map has none of. A part our side cannot draw for want
          // of an array fails its whole group (`WorldBlocks.addInstanced`),
          // never skipped while its pieces are cut.
          const recipe = this.mats.celRecipe(part.material);
          if (recipe) {
            const passes = this.passesOf(part.metadata, part.material) | PASS_PROBE;
            this.blocks.addInstanced(s, part.name, part.geometry, recipe, passes);
          }
        }
      });
    }
    // A caster held for the shadows alone is never reach-culled: no main pass
    // of ours draws it, the world's maps cull by no reach, and a lamp face
    // (which reaches only its light's range) draws one past it, which the
    // face's far plane clips or stores as a distance over 1 — lit, as no
    // caster at all would read. Every other surface is measured to the box
    // the cull grew for its block — the PALETTE's too: past the reach a lit
    // window is `fogColor` written over the SKY. Every other view reads that
    // box to the same picture — the mask (past the reach its pixel is the
    // clear's own), the lamps' atlas (the box holds the surface, so a light's
    // range drops nothing a face would draw), the world's maps (no reach) and
    // a probe's bake (a surface's sphere).
    const boxes: BlockBox[] = [];
    for (let at = 0; at < this.reach.length; at++) {
      const block = this.reach[at];
      const box = this.held.has(at) ? NO_REACH : this.culling.reachBoxOf(block);
      // The build's contract broken — a surface filed under a block no
      // record grew a cell for — refused as `setMap` refuses its own.
      if (!box) {
        this.fail(
          block === ""
            ? "the cull grew no cell for a surface of ours that is filed under no block"
            : `the cull grew no cell for block "${block}", which a surface of ours is filed under`,
        );
        return;
      }
      boxes.push(box);
    }
    this.blocks.finish(
      boxes,
      field
        ? {
            cut: (piece) => map.world.pieces[piece]?.list === "scatter",
            sets: field.sets.map((set) => ({
              matrices: set.matrices,
              scales: set.scales,
              keys: Uint32Array.from({ length: set.scales.length }, (_, i) =>
                blockKey(set.blocks[i * 2], set.blocks[i * 2 + 1]),
              ),
            })),
          }
        : null,
      // The world's maps' slots first, then the atlas's static faces' — on
      // every rung, so a rung raised from `off` mid-map draws ours.
      this.shadows.slots + this.lamps.slots,
    );
    // The cut can fail in the turn it runs: a group our side cannot draw, or
    // the whole map past the device's limits.
    if (this.failure !== null) return;
    const depth = this.blocks.depth;
    if (this.casting.size > 0 && !depth) {
      this.fail("the casters could not be cut for our shadow maps");
      return;
    }
    // Each pass of ours is handed its world WITH the install's failure, and
    // tells it of whatever it finds it cannot draw — a build or a view that
    // failed, a pipeline failed for the session, a refused mask pass — in
    // whatever turn it finds it: no pass latches anything or keeps a
    // listener, and a failure told for a world since replaced is dropped.
    this.handCasters(depth, failed);
    this.probes.setWorld(this.probing.size > 0 ? this.blocks : null, failed);
    // The palette's main pass is ours whenever there is a palette: the
    // blocks draw it first (`WorldBlocks`), and a failed pipeline of it says
    // so itself (`onPaletteFailed`).
    if (this.glowing.size === 0) return;
    this.glow.setWorld(this.blocks, failed);
  }

  /**
   * The first mesh Babylon was made that is neither the glazing (which no
   * bake draws) nor a FIRE (which no bake has ever drawn, `FINDINGS.md` 51),
   * with how many others — a mesh the reflection bake would owe a picture of
   * and cannot draw, our bake reading no mesh, a held caster's among them;
   * null for none, every shipped map. Asked at the install, of every map.
   */
  private strayMesh(map: InstalledWorld): string | null {
    const panes = new Set(map.paneGroups.map((g) => g.mesh));
    let first: Mesh | null = null;
    let others = 0;
    for (const mesh of map.visuals) {
      if (panes.has(mesh) || this.fires.has(mesh)) continue;
      if (first) others++;
      else first = mesh;
    }
    return first
      ? `Babylon was made "${first.name}" and ${others} other meshes the reflection bake would draw, which our renderer cannot bake`
      : null;
  }

  /** The casters to every shadow of ours, with the install's failure — or none, when the map has none of ours. */
  private handCasters(depth: WorldDepth | null, failed?: (reason: string) => void): void {
    this.shadows.setCasters(depth, failed);
    this.lamps.setCasters(depth, this.shadows.slots, failed);
  }

  /**
   * How many surfaces our main pass draws — the palette among them — how
   * many clusters and material groups they were cut into, and how many
   * draws our side issued last frame.
   */
  get stats(): {
    taken: number;
    clusters: number;
    groups: number;
    drawn: number;
  } {
    const { surfaces, clusters, groups } = this.blocks.count;
    // The main pass's: a caster held for the shadows alone is not drawn in it.
    return {
      taken: surfaces - this.held.size,
      clusters,
      groups,
      drawn: this.blocks.drawn,
    };
  }

  /** The map is going: every surface, buffer and material of ours with it, and the shadows' casters first. */
  clear(): void {
    this.handCasters(null);
    // Ahead of the blocks, whose culls the bake's view and the mask's read.
    this.probes.setWorld(null);
    this.glow.setWorld(null);
    this.blocks.clear();
    this.field = null;
    this.reach = [];
    this.held = new Map();
    this.palette = new Set();
    this.casting = new Set();
    this.probing = new Set();
    this.glowing = new Set();
    this.fireSurfaces = [];
    this.fires = new Set();
    this.heldMeshes = [];
    this.refusal = null;
    this.owner = null;
    this.failure = null;
  }

  dispose(): void {
    this.clear();
    this.removeFrame();
    this.removeRefused();
    this.blocks.dispose();
  }

  /**
   * The world cannot be drawn: said once an install — our draws stopped at
   * once (`WorldBlocks.stop`, safe inside a render: its buffers stay until
   * `clear`) — and handed to `Game.worldFailed` with the install's owner.
   * Nothing of a world with no owner can fail: an EDITOR build (Babylon's
   * whole, `install`), or none installed (the menu, a build not yet
   * installed) — and a failure told for a world since replaced is dropped
   * (`failFor`, and each pass's own generation).
   */
  private fail(reason: string): void {
    const owner = this.owner;
    if (this.failure !== null || owner === null) return;
    this.failure = reason;
    this.blocks.stop();
    this.worldFailed(reason, owner);
  }

  /**
   * The install `owner`'s failure, as a pass of ours tells it (the failure
   * `install` hands over with each world): `fail`, unless the world in hand
   * is another install's — a failure that lands for a map already gone is no
   * failure of the next one.
   */
  private failFor(owner: WorldOwner, reason: string): void {
    if (owner === this.owner) this.fail(reason);
  }

  /** `WorldBlocks.onFailed`: surfaces our side will never draw — and Babylon has no mesh of. */
  private readonly failed = (surfaces: readonly number[]): void => {
    this.fail(`${surfaces.length} surface${surfaces.length === 1 ? "" : "s"} our renderer cannot draw`);
  };

  /** `WorldBlocks.onPaletteFailed`: a main-pass palette pipeline failed. */
  private readonly mainPaletteFailed = (): void => {
    this.fail("a main-pass pipeline of the emissive palette failed");
  };

  /** `Renderer.onRefused`: the main pass is not what our pipelines were built for. */
  private readonly refused = (): void => {
    this.fail("the main pass was refused, so nothing of ours can draw in it");
  };

  /**
   * Once a frame as the main pass begins: a material rewritten by its owner
   * is copied again, and a DEV build checks that no held caster — the one
   * kind of surface Babylon draws and ours casts — has been switched,
   * hidden or faded: Babylon would stop drawing it and ours, which reads no
   * node, would cast it still.
   */
  private readonly frame = (): void => {
    if (this.mats.materialEpoch !== this.epoch) {
      this.epoch = this.mats.materialEpoch;
      this.blocks.writeMaterials();
    }
    if (import.meta.env.DEV && this.failure === null) this.check(this.heldMeshes);
  };

  private check(meshes: readonly AbstractMesh[]): void {
    for (const mesh of meshes) {
      if (mesh.isVisible && mesh.visibility === 1 && mesh.isEnabled()) continue;
      this.fail(`"${mesh.name}" was switched off, hidden or faded after its shadow was taken; our renderer still casts it`);
      return;
    }
  }
}
