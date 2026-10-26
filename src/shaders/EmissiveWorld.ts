/**
 * EmissiveWorld.ts — The one material every lit window, lamp lens, ember and
 * sign in a map's MERGED world wears, whatever colour it emits: the emissive
 * palette, `getWorldCel`'s twin for the light sources. Since X3.7c it is a
 * MATERIAL OBJECT and no program: our renderer draws the palette in every
 * pass of a round — the main pass (`render/WorldBlocks.ts`), a probe's bake
 * (`render/ProbeBake.ts`) and the glow's mask (`render/WorldGlow.ts`), off
 * the one body in `wgsl/emissiveWorld.ts` (`render/emissiveWorld.ts`
 * assembles it) — and Babylon is made no mesh of it (`BlockHandover`), nor
 * is one made of it in an EDITOR build, whose blocks are never merged
 * (`MapBuilder.mergeBlocks`), so no Babylon draw of it is left anywhere and
 * its Babylon stages and its glow-mask twin went with X3.7c
 * (`BABYLON_EXIT.md`). The object stays (X3.7, Keeps): the merge keys on it
 * and the factory hangs the recipe our renderer draws it with off it
 * (`CelMaterialFactory.emissiveRecipe`).
 * Owns: `EmissiveWorldMaterial`, `isEmissiveWorld` and `fadesOwnBloom`
 * (`MAX_EMISSIVE_PALETTE` is the bodies' module's).
 * Is made by `CelMaterialFactory` alone (`getEmissiveWorld`), and the palette
 * itself is discovered by `MapBuilder`'s block merge.
 * Invariants: it holds NO uniform and compiles nothing — the palette, the fog
 * band and the depth bias it is drawn with are its recipe's, PULLED off the
 * factory (`render/emissiveWorld.ts`); its `zOffsetUnits` is that bias,
 * stated for a reader of the material, never read by a draw. Never given a
 * vertex colour buffer (`vertexShading` skips it). Never worn by anything but
 * a merge: every vertex it draws carries a slot. Never on a Babylon mesh: a
 * plain `Material` draws nothing, so one that wore it would be a hole.
 *
 * WHY IT EXISTS. `docs/rendering.md`, "The paint palette": the block merge
 * splits once per MATERIAL, and the albedo palette took a matte surface's
 * colour out of that key. An emissive was refused it, because an emissive is
 * a `StandardMaterial` and its colour is a uniform with no vertex path — so a
 * 48 m block of Coldharbour still held three or four emissive meshes, one per
 * colour, and every one of them is drawn TWICE: once into the frame and once
 * into the glow's mask (`FINDINGS.md` 43). This is that palette: the colour
 * is a slot in `uv2.x`, written by `writePaletteIndex` exactly as the albedo's
 * is, into the factory's table.
 *
 * WHY THE BLOOM FADES PER PIXEL HERE AND PER MESH EVERYWHERE ELSE. `GlowRules`
 * fades a bloom toward black by the fog at the mesh's bounding-sphere CENTRE —
 * sound for a block's windows of one colour, because they were a few metres
 * of one frontage. Merged across colours, a block's emissives are one mesh up
 * to the whole block across, and a window on its near side would fade as if
 * it stood at the far one. So the mask fades each pixel by its own distance,
 * through the curve `fogAmountAt` is, and `Game`'s rule leaves this material's
 * colour unfaded (`fadesOwnBloom`). It is the one LOOK change the palette
 * makes, and it moves the bloom toward what the wall around it already does.
 *
 * WHY IT DECLARES `emissiveColor`. `GlowRules` asks a material what it emits
 * by that property and nothing else (`WorldGlow` asks it of this one, through
 * `CelMaterialFactory.emissiveMaterialOf`), exactly as for the fire
 * (`FlameMaterial`). It is WHITE, so `GlowRules.colour` hands the mask the
 * rule's own scale (the kit screen's admission, an intensity) and the palette
 * supplies the colour.
 */
import { Color3, Material, type Scene } from "@babylonjs/core";

export class EmissiveWorldMaterial extends Material {
  /** What `GlowRules` reads to know this is a light source — see the header. */
  readonly emissiveColor = Color3.White();

  /** `depthUnits` is the polygon offset its recipe is drawn at (`overGlass`'s). */
  constructor(scene: Scene, name: string, depthUnits: number) {
    super(name, scene);
    this.backFaceCulling = true;
    this.zOffsetUnits = depthUnits;
    this.freeze();
  }

  override getClassName(): string {
    return "EmissiveWorldMaterial";
  }
}

/** Whether a material is the emissive palette — `vertexShading` asks, to leave it unbaked. */
export function isEmissiveWorld(material: Material | null): material is EmissiveWorldMaterial {
  return material instanceof EmissiveWorldMaterial;
}

/**
 * Whether a material fades its own bloom per pixel, so `GlowRules.colour` must
 * not fade it again per mesh — see the header.
 */
export function fadesOwnBloom(material: Material): boolean {
  return isEmissiveWorld(material);
}
