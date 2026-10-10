/**
 * merge.ts — The two merge passes a map build runs over its VISUALS: per
 * material within a structure or a scatter field (`mergeByMaterial`), then per
 * map block across neighbours (`BlockMerge` for everything opaque,
 * `PaneBlocks` for the glazing, which has to keep its breakable panes'
 * vertex ranges). Plus `tag`, the editor's per-item mark, and `BLOCK_SIZE`.
 * Everything here runs on `WorldSurface`s (`worldGeometry.ts`) — `Part`s and
 * their bookkeeping, typed arrays and nothing on the device — and what it
 * hands back is still surfaces: `worldMeshes` (`parts.ts`) is where the world
 * becomes meshes, once, at the end of the build (BABYLON_EXIT.md X1.4).
 * A prop's hierarchy arrives already flattened (`flattenParts` in `parts.ts`).
 * Owns: no state outlasting a call but the two passes' own block lists, and no
 * collider — `MapBuilder` drives every function here and is still the only
 * place a collider is made.
 * Invariants: `BlockMerge.finish` and `PaneBlocks.finish` write the SAME
 * `metadata.block` key off the same block size, which is what
 * `ReflectionSystem.encloses` and `WorldCulling` both rest on (the metadata
 * contract in `CLAUDE.md`). A merged surface carries the exemptions and the
 * sway mark its group was KEYED on, never ones read back off a member. A
 * merge of two or more is `mergeParts` (`Mesh.MergeMeshes`' arithmetic, each
 * member under its own world matrix, NOT renormalised) into a new part at
 * identity, minted a new birth; a merge of ONE is that member, its transform
 * baked into its own arrays (`bakePartTransform`, which DOES renormalise —
 * so a colour lone in both passes is baked twice, as it always was) and its
 * birth and metadata object kept. Merging is only safe at identity transform:
 * the merge bakes world matrices, so a lone surface is baked by hand — except
 * by `PaneBlocks`, whose surfaces are already where they belong.
 * Must NOT merge across two materials, carry `solid` onto a merged visual, or
 * paletteise anything but a plain matte cel material (`plainCelHex`) or one
 * of `getEmissive`'s unlit colours (`plainEmissive`), each into its own table.
 */
import type { Material } from "@babylonjs/core";
import { writeBufferPaletteIndex } from "../shaders/CelShader";
import type { EditorItem, EditorRef, WorldPane } from "./mapTypes";
import { bakePartTransform, mergeParts, Part, type PartMetadata } from "./parts";
import { marksSway, type SwayLayer, swayLayerOf } from "./sway";
import { type Mint, type PaneSurfaceGroup, surfaceOf, type WorldSurface } from "./worldGeometry";

/**
 * Records which layout item a mesh — or a surface's part, which hands the mesh
 * made of it the same metadata object — belongs to. The editor picks with a
 * predicate on this, which is why visuals can stay `isPickable = false`:
 * Babylon skips the isPickable test entirely when a pick supplies a predicate,
 * so the visual/collider split survives the editor untouched.
 */
export function tag(target: { metadata: PartMetadata | null }, ref: EditorRef): void {
  target.metadata = { ...(target.metadata ?? {}), editorRef: ref };
}

/**
 * Side of a merge block, in metres, **for a map that states none** — and the
 * world layer's fixed unit of LOCALITY, which is a second job and the reason
 * this is still a constant at all.
 *
 * 48 m over a 240 m map gives a 5x5 grid of blocks — coarse enough that the
 * whole village collapses into a few dozen draws, fine enough that frustum
 * culling still throws away most of the map. Well under the 78 m fog wall, so
 * a block is never half-visible for long. **Every clause of that is about a
 * 240 m map with a 78 m fog wall**, which is why `MapLayout.blockSize` exists
 * and why this is the default rather than the answer.
 *
 * **The two jobs came apart the moment a map could state its own, and they
 * must stay apart.** What a map states is how the MERGE groups: fewer, larger
 * meshes to walk and to draw, at coarser cull granularity. What stays here is
 * the size of a locality BUCKET — `PhysicsWorld`'s static containers and
 * `GlassSystem`'s pane index — and those two want the opposite thing from a
 * large map. `HavokPlugin.addChild` is quadratic in a container's children,
 * so a bucket that grew with a map's merge block would
 * hand back most of what S5b bought; a pane bucket is a slab rejection whose
 * only cost is the panes inside it. Neither is an identity — nothing reads
 * either key — so neither has anything to agree with.
 *
 * `terrainPatches` is called with `MapLayout.terrainBlock`, which defaults to
 * this too and moves independently of the merge's.
 */
export const BLOCK_SIZE = 48;

/**
 * The second merge pass: collapses every structure and scatter field into one
 * surface per (map block, material).
 *
 * The per-structure merge in `mergeByMaterial` already turns a cottage into
 * four surfaces, but a dense village is ~200 structures and the outline pass of
 * the time drew each mesh twice. Grouping neighbours by block took the map from
 * ~670 draws to ~150 without giving up culling: buildings are static, so the
 * extra vertices cost nothing that the draw calls weren't already costing more
 * of.
 *
 * Merging across placements is safe for the same reason it is safe within one:
 * the merge bakes world matrices. The ink still traces each building, because
 * `CelInk` finds edges in the frame's depth rather than per mesh.
 */
export class BlockMerge {
  private blocks = new Map<string, WorldSurface[]>();

  /**
   * The block's side, in metres — the MAP's (`MapLayout.blockSize`), taken in
   * rather than read off the constant so that this pass and the glazing's know
   * they are cutting on the same lattice by construction. Both are given the
   * one value `MapBuilder.build` resolved. `mint` is the build's birth counter
   * (`worldGeometry.ts`), which a merge of two or more draws from.
   */
  constructor(
    private readonly blockSize: number,
    private readonly mint: Mint,
  ) {}

  /** Files a positioned, per-material merged surface under its map block. */
  add(x: number, z: number, surface: WorldSurface): void {
    const key = `${Math.floor(x / this.blockSize)},${Math.floor(z / this.blockSize)}`;
    const group = this.blocks.get(key);
    if (group) group.push(surface);
    else this.blocks.set(key, [surface]);
  }

  /**
   * Merges each block and returns the surfaces the caller should draw.
   *
   * `palette` is what turns this from a merge per COLOUR into a merge per
   * block: hand it a hex and it hands back the slot to write into `uv2`, or 0
   * for a colour it has no room for. It is a callback rather than a map because
   * the slots are allocated in the order the merge meets them, and the merge is
   * the only thing that knows that order.
   */
  finish(palette: Palette): WorldSurface[] {
    const out: WorldSurface[] = [];
    for (const [key, group] of this.blocks) {
      for (const merged of mergeByMaterial(group, `block${key}`, { palette, mint: this.mint })) {
        // The key travels ON the surface, because `ReflectionSystem` has to ask
        // which building a merged mesh IS and the palette took the answer out
        // of the geometry — see `encloses` there. `PaneBlocks` files glazing
        // under this same key, which is what lets the two agree on "the same
        // building" without measuring a distance between two centres.
        merged.part.metadata = { ...(merged.part.metadata ?? {}), block: key };
        merged.block = key;
        out.push(merged);
      }
    }
    return out;
  }
}

/**
 * The same second pass for glazing, and it is a class of its own rather than a
 * caller of `BlockMerge` because the two want opposite things from a merge.
 *
 * `BlockMerge` exists to make a placement unrecoverable — that is the saving.
 * A breakable pane must survive it, so this one carries every such pane's
 * vertex range across by the running offset of the surfaces ahead of it. Same
 * key, same reason (glass is unbatched alpha, so a mesh is a sorted draw of its
 * own), and measured on Coldharbour: 6,139 sheets across 82 glazed placements
 * (44 towers, 26 cars, 8 shophouses, 2 offices, 2 depots) come out as 40
 * meshes, eight of which hold a range anything will ever write.
 *
 * **The editor keys per placement instead**, so nothing merges across
 * placements there — the same exemption `BlockMerge` gets, for the same reason.
 * Running the pass either way keeps one code path, and the pass is where the
 * position buffer is marked updatable.
 */
export class PaneBlocks {
  private blocks = new Map<string, PaneSurfaceGroup[]>();
  /** The layout item a block belongs to, on editor builds. See `add`. */
  private owners = new Map<string, { item: EditorItem; placement: number }>();

  /**
   * The block's side, in metres. **It must be `BlockMerge`'s**, and it is the
   * same value from `MapBuilder.build` rather than a second reading of the
   * layout: the whole of `ReflectionSystem.encloses` rests on a glazing group
   * and the wall it is glazed onto landing under the same key, and two sizes
   * would break that silently — a probe reflecting its own building, with
   * nothing in the numbers to point at. `mint` as `BlockMerge`'s.
   */
  constructor(
    private readonly blockSize: number,
    private readonly mint: Mint,
  ) {}

  /**
   * Files one placement's merged glazing under its map block.
   *
   * **On an editor build the key is the PLACEMENT**, so nothing merges across
   * placements and every block has exactly one owner — which is what lets the
   * merged surface be handed back to that item's `visuals`. Without it a
   * dragged building leaves its own windows behind in the street, and nothing
   * says so: the glass is still drawn, still in `visuals`, and still disposed
   * with the map.
   */
  add(
    x: number,
    z: number,
    group: PaneSurfaceGroup,
    item: EditorItem | null,
    placement: number,
  ): void {
    const key = item
      ? `item${placement}`
      : `${Math.floor(x / this.blockSize)},${Math.floor(z / this.blockSize)}`;
    if (item) this.owners.set(key, { item, placement });
    const existing = this.blocks.get(key);
    if (existing) existing.push(group);
    else this.blocks.set(key, [group]);
  }

  /**
   * Merges each block and rewrites the ranges it moved.
   *
   * `panes` is the map's list, written through: a pane's `vertexStart` shifts
   * by the vertices of every surface merged ahead of its own, and its `group`
   * becomes the index of the group it ended up in, in what this returns.
   * Nothing else may write either field.
   */
  finish(panes: WorldPane[]): PaneSurfaceGroup[] {
    const out: PaneSurfaceGroup[] = [];
    for (const [key, group] of this.blocks) {
      // Split by material for the reason `mergeByMaterial` does: two materials
      // in one mesh would draw one of them wrong. Glass is one colour today, so
      // this is almost always a single group.
      const byMaterial = new Map<Material, PaneSurfaceGroup[]>();
      for (const g of group) {
        const mat = g.surface.part.material;
        if (!mat) continue;
        const list = byMaterial.get(mat);
        if (list) list.push(g);
        else byMaterial.set(mat, [g]);
      }

      for (const [mat, list] of byMaterial) {
        // Offsets are accumulated over the members in the order the merge
        // concatenates them, which is what makes a running sum the right
        // answer at all.
        let offset = 0;
        const indices: number[] = [];
        for (const g of list) {
          for (const p of g.panes) {
            panes[p].vertexStart += offset;
            indices.push(p);
          }
          offset += g.surface.part.geometry.vertexCount;
        }
        // **A group of one is taken AS IT STANDS, and must not be baked.** This
        // is where this pass differs from `mergeByMaterial`, which bakes a lone
        // surface because its caller then composes a placement's transform onto
        // what it gets back. Nothing composes anything onto these:
        // `MapBuilder.paneGroup` has already put each surface where it belongs.
        // Baking anyway flattens that transform into the vertices and leaves
        // the mesh at identity, which the editor's `repositionItem` then reads
        // as "no transform yet" and applies the placement a second time — a
        // dragged building whose glass is at twice its own offset, drawn
        // perfectly, with nothing in the numbers to point at.
        const merged =
          list.length === 1
            ? list[0].surface
            : surfaceOf(new Part("", mergeParts(list.map((g) => g.surface.part))), this.mint());
        merged.part.name = `paneblock${key}-${mat.name}`;
        merged.part.material = mat;
        // Updatable, which no merge can ask for: the adapter uploads a static
        // buffer unless told otherwise, and then the first break is a silent
        // no-op — the array is rewritten and never re-uploaded. The positions
        // become float32 HERE, which is what `Geometry.setVerticesData` makes
        // of a plain array it is asked to keep writable, so the record already
        // holds the numbers the device will.
        //
        // Only where there is something to break. A block of pure glazing is
        // immutable for the life of the map — nothing holds a range into it and
        // nothing may write one — so it keeps the static buffer, which is what
        // almost every block on Coldharbour is.
        if (indices.length > 0) {
          const geometry = merged.part.geometry;
          if (!(geometry.positions instanceof Float32Array)) {
            geometry.positions = new Float32Array(geometry.positions);
          }
          merged.updatable = true;
        }
        const groupIndex = out.length;
        for (const p of indices) panes[p].group = groupIndex;
        // The same key `BlockMerge.finish` writes onto a merged block, and it
        // travels for a second reader: `WorldCulling` groups by it, and a
        // tower's glazing has to leave the frame on the same block as the
        // shaft it is hung on or the city keeps its windows and loses its
        // walls. **Only on a play build** — an editor key is a PLACEMENT
        // (`item12`), which is not a map block and must not be filed as one.
        if (!this.owners.has(key)) {
          merged.part.metadata = { ...(merged.part.metadata ?? {}), block: key };
          merged.block = key;
        }
        out.push({ surface: merged, panes: indices, block: key });
        // Editor builds only: tag the surface for its item and hand it over,
        // so a dragged building takes its glazing with it. Its mesh joins the
        // item's `visuals` when the adapter makes it (`worldMeshes`).
        const owner = this.owners.get(key);
        if (owner) {
          tag(merged.part, { list: "placements", index: owner.placement });
          merged.owner = owner.item;
        }
      }
    }
    return out;
  }
}

/**
 * The render exemptions a merged surface may carry, and the reason they are
 * part of the merge KEY rather than something read off a member.
 *
 * `noInk` could have been propagated from any one mesh safely, because it
 * tracks the MATERIAL: the kit's `glow()` reaches for `getEmissive`, so an
 * emissive group is unanimous by construction and the group key already
 * implies the flag. `noGlow` and `noShadowCaster` track a mesh's ROLE, which
 * is orthogonal to its colour — a flat sheet that must not cast stands in the
 * same paint as the wall behind it. Reading either off one member would hand
 * the whole colour group an exemption one mesh asked for, and through
 * `BlockMerge` that group is every structure within 48 m; requiring unanimity
 * instead would drop the exemption the one mesh genuinely needed. Both fail
 * silently. Keying splits a disagreeing group into one merged surface per
 * exemption set, which costs a draw call exactly when there is a real
 * disagreement to represent and nothing at all otherwise.
 *
 * `solid` is deliberately NOT in the set — a merged VISUAL is never a
 * collider, and carrying it up would break the one rule the world layer cannot
 * bend.
 *
 * The sway mark is keyed beside these and is not one of them, because it is a
 * VALUE rather than a flag — a canopy leaf and a fern blade are both foliage
 * and lean by different amounts. It is in the key for the `noGlow` reason and
 * one further one: `vertexShading` reads the mark once per MESH and writes the
 * weight per vertex from it, so a group that disagreed would write one layer's
 * answer over both.
 */
const EXEMPTIONS = ["noInk", "noGlow", "noShadowCaster"] as const;

type Exemption = (typeof EXEMPTIONS)[number];

/** A part's exemptions, in a fixed order so the key is stable. */
function exemptionsOf(part: Part): Exemption[] {
  return EXEMPTIONS.filter((flag) => part.metadata?.[flag] === true);
}

/**
 * Collapses a structure's surfaces into one per material.
 *
 * This is the whole draw-call budget for the village: a cottage goes from ~20
 * parts to 4 surfaces — and, while the inverted-hull outlines drew a back-face
 * shell per mesh, from ~40 draws to 8. Those shells are retired: the ink is
 * `CelInk`'s post pass now, which finds edges in the frame's depth and draws
 * nothing per mesh.
 *
 * Merging is only safe because builders work at identity: the merge bakes
 * world matrices and hands back an identity-transform surface, which the
 * caller then positions.
 */
export function mergeByMaterial(
  surfaces: readonly WorldSurface[],
  tag: string,
  { palette, mint }: MergeOptions,
): WorldSurface[] {
  // Material first, then sway layer and exemption set — see `EXEMPTIONS`.
  // Nested rather than keyed on a composed string, because two distinct
  // materials are free to share a name and a merge across them would draw one
  // of them wrong.
  const groups = new Map<Material, Map<string, Group>>();
  for (const s of surfaces) {
    const m = s.part;
    const mat0 = m.material;
    // A part with no material is not merged, and is dropped: nothing would
    // draw it. (The part mesh it used to become was uploaded and left in the
    // scene, outside `visuals`, for no reader at all.)
    if (!mat0) continue;
    // **The palette is what takes the COLOUR out of this key.** A matte cel
    // material differs from another only in a uniform, so every one of them can
    // be answered by one material reading the albedo per vertex instead — which
    // is what collapses a block of a city from ten meshes to two. Only the
    // plain matte variant qualifies: gloss, translucency and glazing are shader
    // BEHAVIOUR and merging across them would draw one of them wrong, which is
    // the rule this function already states about two materials sharing a
    // name.
    //
    // An EMISSIVE was refused the same way once, for being a different shader
    // rather than a different colour. It is now the same move into a table of
    // its own (`Palette.glow`): `getEmissive`'s unlit colour differs from
    // another only in a uniform too, and `EmissiveWorld.ts` draws it per vertex
    // to the same pixel. Never into the ALBEDO table — the two never share a
    // material, so they never share a merge group either.
    const picked = palette ? paletteFor(mat0.name, palette) : null;
    if (picked) writeBufferPaletteIndex(m.geometry, picked.slot);
    const mat = picked ? picked.material : mat0;
    let byExemption = groups.get(mat);
    if (!byExemption) groups.set(mat, (byExemption = new Map()));
    const flags = exemptionsOf(m);
    // The sway mark is in the key for the EXEMPTIONS' reason and one of its
    // own. It tracks a mesh's ROLE — a canopy tree's fronds sway and its
    // trunk does not, in the same palette green a fern's crown is — so reading
    // it off one member would hand a whole colour group a lean one mesh asked
    // for. The extra reason is that the BAKE reads it per mesh rather than per
    // vertex, so a group that disagreed would write one answer over both.
    const sway = swayLayerOf(m);
    const key = `${sway ?? ""}|${flags.join("-")}`;
    const group = byExemption.get(key);
    if (group) group.surfaces.push(s);
    else byExemption.set(key, { flags, sway, surfaces: [s] });
  }

  const out: WorldSurface[] = [];
  for (const [mat, byExemption] of groups) {
    for (const { flags, sway, surfaces: group } of byExemption.values()) {
      // A merge of two or more bakes their world matrices; a group of one has
      // to be baked by hand or the promise above is a lie for exactly the
      // colours only one part uses — and the caller, which positions and
      // rotates what it gets back, would clobber that part's own transform
      // instead of composing with it. The lone surface keeps its birth and its
      // metadata OBJECT (the editor writes a road's flag into it in place); a
      // merge starts from none, as `MergeMeshes`' new mesh did.
      let merged: WorldSurface;
      if (group.length === 1) {
        merged = group[0];
        bakePartTransform(merged.part);
      } else {
        merged = surfaceOf(new Part("", mergeParts(group.map((g) => g.part))), mint());
      }
      // Suffixed only where a group actually splits, so the common name is the
      // one the rest of the tree already reads in a profile.
      const suffix = flags.map((f) => `-${f}`).join("");
      merged.part.name = `${tag}-${mat.name}${sway ? `-${sway}` : ""}${suffix}`;
      merged.part.material = mat;
      // From the KEY, not from a member — and this half of it was not a
      // precaution, it was a live bug. The exemption used to be read back off
      // the group AFTER the merge, and `MergeMeshes` was called with
      // `disposeSource = true`, so by then Babylon's `Node.dispose` had set
      // every source's `metadata` to null and the read came back false for any
      // group of two or more. Measured on Hollowmere: 19 of the map's 42 merged
      // emissive meshes lost the ink exemption here and were handed an outline
      // shell by the caller — a black ring drawn around every lantern, flame
      // and sign dense enough to have a neighbour its own colour. That
      // particular consequence is gone with the outline pass, and the same
      // read still has to be right for `noGlow` and `noShadowCaster`, which are
      // live. Grouping first means the flags are read off the members, and the
      // group is unanimous, so the key is what they said.
      for (const flag of flags) {
        merged.part.metadata = { ...(merged.part.metadata ?? {}), [flag]: true };
      }
      // A swaying group carries the mark forward, and that is now all it does.
      // It used to leave Babylon's outline pass here as well, because that
      // hull could see neither the wind nor the per-vertex weight and the leaf
      // leaned out from under a shell left standing at the rest pose. The ink
      // reads the depth buffer now and the leaf is already in it.
      if (sway) {
        markSwayMerged(merged.part, sway);
      }
      out.push(merged);
    }
  }
  return out;
}

/** What a `mergeByMaterial` caller hands it beyond the surfaces. */
export interface MergeOptions {
  /** Merge per BLOCK rather than per colour — see `BlockMerge.finish`. */
  palette?: Palette;
  /** The build's birth counter, drawn from by every merge of two or more. */
  mint: Mint;
}

/** One merge group: the surfaces, and the exemptions and sway they all agree on. */
type Group = { flags: Exemption[]; sway: SwayLayer | null; surfaces: WorldSurface[] };

/**
 * What a merge needs in order to take the colour out of its key: somewhere to
 * put a hex, and the one material that answers for all of them.
 *
 * Passed in rather than reached for, because the SLOTS are allocated in the
 * order the merge meets a colour and only the merge knows that order, while the
 * material belongs to a factory this file's free functions cannot see.
 */
export type Palette = {
  /** The 1-based slot for a hex, or 0 for "keep your own material". */
  slot(hex: string): number;
  /** The material every slotted mesh ends up wearing. */
  material: Material;
  /**
   * The same pair for the map's EMISSIVES, in a table of their own —
   * `CelMaterialFactory.getEmissiveWorld`. The material is asked per mesh
   * because the source's polygon offset (`overGlass`) has to survive the move.
   */
  glow: {
    slot(hex: string): number;
    material(overGlass: boolean): Material;
  };
};

/**
 * Which palette a source material joins, and the slot — or null for "keep
 * your own material", which is every material neither name test accepts and
 * every colour a table had no room for.
 */
function paletteFor(name: string, palette: Palette): { slot: number; material: Material } | null {
  const hex = plainCelHex(name);
  if (hex) {
    const slot = palette.slot(hex);
    return slot > 0 ? { slot, material: palette.material } : null;
  }
  const glow = plainEmissive(name);
  if (glow) {
    const slot = palette.glow.slot(glow.hex);
    return slot > 0 ? { slot, material: palette.glow.material(glow.overGlass) } : null;
  }
  return null;
}

/**
 * The hex of one of `CelMaterialFactory.getEmissive`'s materials, and whether
 * it is the over-glass variant — or null for anything else.
 *
 * **As strict as `plainCelHex` and for its reason.** That factory names its
 * unlit `StandardMaterial`s `emissive-#rrggbb` and `emissive-#rrggbb-over-glass`
 * and nothing else in the tree is named so; a material with a texture, an
 * alpha or any behaviour the palette material does not reproduce must never
 * match, and none can, because `getEmissive` makes none.
 */
function plainEmissive(materialName: string): { hex: string; overGlass: boolean } | null {
  const m = /^emissive-(#[0-9a-fA-F]{6})(-over-glass)?$/.exec(materialName);
  return m ? { hex: m[1], overGlass: m[2] !== undefined } : null;
}

/**
 * The hex of a PLAIN matte cel material, or null for anything else.
 *
 * **It matches the matte name ALONE and must stay that strict**, which is the
 * whole of what it is for: gloss and translucent differ from matte in shader
 * BEHAVIOUR rather than merely in a uniform, so they cannot join the palette
 * merge however alike their colours are, and a regex loosened to
 * `cel-(gloss-|trans-)?#rrggbb` would quietly enrol them. `cel-world` is
 * refused by the same line, having no hex at all — see `WORLD_CEL_NAME`.
 *
 * It had a looser twin once, `inkColorFor`, which DID accept all three because
 * it was asking a different question of the same name: what colour to tint a
 * mesh's ink shell. That went with the hull ink, so this is the only reader of
 * a material name left and there is no longer a second regex to keep it
 * distinct from.
 */
function plainCelHex(materialName: string): string | null {
  const m = /^cel-(#[0-9a-fA-F]{6})$/.exec(materialName);
  return m ? m[1] : null;
}

/**
 * Carries a merged group's sway mark onto the surface's part.
 *
 * It used to do a second thing — take Babylon's ink off the group, because that
 * hull could see neither the wind nor the per-vertex weight and an outlined leaf
 * leaned out from under a shell left standing at the rest pose. The ink is a
 * screen-space pass over the depth buffer now, and the depth buffer already has
 * the leaf where the wind put it, so there is nothing to take off.
 */
function markSwayMerged(part: Part, layer: SwayLayer): void {
  marksSway(part, layer);
}
