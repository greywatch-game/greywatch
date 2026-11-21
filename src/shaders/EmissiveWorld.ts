/**
 * EmissiveWorld.ts — The one material every lit window, lamp lens, ember and
 * sign in a map's MERGED world wears, whatever colour it emits: the emissive
 * palette, `getWorldCel`'s twin for the light sources. Since X3.7c it is a
 * MATERIAL KEY and no program: our renderer draws the palette in every
 * pass of a round — the main pass (`render/WorldBlocks.ts`), a probe's bake
 * (`render/ProbeBake.ts`) and the glow's mask (`render/WorldGlow.ts`), off
 * the one body in `wgsl/emissiveWorld.ts` (`render/emissiveWorld.ts`
 * assembles it) — and no mesh is made of it (`BlockHandover`). The
 * key stays: the merge keys on it and the factory hangs the recipe our
 * renderer draws it with off it (`CelMaterialFactory.emissiveRecipe`). A
 * Babylon `Material` until `BABYLON_EXIT.md` X6.1c, one of OUR keys since
 * (`MaterialKey.ts`), carrying what a reader asks of it.
 * Owns: `EmissiveWorldMaterial` and `isEmissiveWorld`
 * (`MAX_EMISSIVE_PALETTE` is the bodies' module's).
 * Is made by `CelMaterialFactory` alone (`getEmissiveWorld`), and the palette
 * itself is discovered by `MapBuilder`'s block merge.
 * Invariants: it holds NO uniform and compiles nothing — the palette, the fog
 * band and the depth bias it is drawn with are its recipe's, PULLED off the
 * factory (`render/emissiveWorld.ts`); its `zOffsetUnits` is that bias,
 * stated for a reader of the material, never read by a draw. Never given a
 * vertex colour buffer (`vertexShading` skips it). Never worn by anything but
 * a merge: every vertex it draws carries a slot. Never on a Babylon mesh
 * (none was made of it from X3.7c's review, and no build makes a mesh of
 * anything since X6.1g) — a refused palette fails the world instead, since
 * nothing else could draw it.
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
 * through the curve `fogAmountAt` is, and `WorldGlow`'s rule (`Game`'s)
 * hands this material's colour over at a fade of 1 — no per-mesh fade ever
 * reaches it, Babylon being made no mesh of it. It is the one LOOK change
 * the palette makes, and it moves the bloom toward what the wall around it
 * already does.
 *
 * WHY IT DECLARES `emissiveColor`. `GlowRules` asks a material what it emits
 * by that property and nothing else (`WorldGlow` asks it of this one, through
 * `CelMaterialFactory.emissiveMaterialOf`), exactly as for the fire
 * (`FlameMaterial`). It is WHITE, so `GlowRules.colour` hands the mask the
 * rule's own scale (the kit screen's admission, an intensity) and the palette
 * supplies the colour.
 */
import type { Color3Like } from "../math";
import { MaterialKey } from "./MaterialKey";

/** WHITE, as `emissiveColor` (the header): the rule's own scale, the palette the colour. */
const WHITE = { r: 1, g: 1, b: 1 } as const;

export class EmissiveWorldMaterial extends MaterialKey {
  /** Never null: the palette is a light source (the header). */
  declare readonly emissiveColor: Color3Like;

  /** `depthUnits` is the polygon offset its recipe is drawn at (`overGlass`'s). */
  constructor(name: string, depthUnits: number) {
    // What `GlowRules` reads to know this is a light source — see the header.
    super(name, "emissiveWorld", { emissiveColor: WHITE, zOffsetUnits: depthUnits });
  }
}

/** Whether a material is the emissive palette — `vertexShading` asks, to leave it unbaked. */
export function isEmissiveWorld(material: MaterialKey | null): material is EmissiveWorldMaterial {
  return material instanceof EmissiveWorldMaterial;
}
