/**
 * shaders/MaterialKey.ts — What a MATERIAL is in this game: a KEY of our own,
 * which `CelMaterialFactory` mints once per variant it hands out (a cel colour,
 * a gloss, a translucency, a cloth, a pane, a ground, an unlit emissive, the
 * emissive palette, the fire and the blast's paint), and which every reader
 * holds by identity — the merge's group key, a part's paint, the factory's
 * own maps of what each one is drawn WITH (`celRecipe`, `emissiveRecipe`).
 * What our renderer draws is the RECIPE the factory keeps beside a key
 * (`render/celMaterial.ts`, `render/emissiveWorld.ts`, `FlameRecipe`,
 * `BlastRecipe`); the key itself draws nothing and compiles nothing.
 * Owns: `MaterialKey`, `MaterialProgram` and `isCelMaterial`.
 * Invariants: a key carries exactly the fields a reader still asks of a
 * material — its `name` (the merge's readers, `kit:hash`, the ground spec's
 * re-apply), its `emissiveColor` and `alpha` (`Game`'s glow rules: null on
 * everything that is not a light source), `backFaceCulling`, `zOffset` and
 * `zOffsetUnits` (the depth bias a recipe states again as `depthBias`), and
 * whether it draws BLENDED (`blended`, `BlockHandover`'s pass masks) — each
 * the value the Babylon material it replaced held for this game, Babylon's
 * defaults where the factory set none (alpha 1, culling on, no bias); its
 * `serial` is a creation counter over KEYS ALONE, in the order they are made,
 * which is what `Game`'s order of the weapon's opaque segments sorts by (it
 * sorted by Babylon's `uniqueId`, a counter every object the scene made
 * advanced, in creation order too — so any two materials compare as they
 * did, `BABYLON_EXIT.md` X6.1c); every field is set at construction and none
 * is written after.
 * Never: imports Babylon; is made by anything but the factory (and its three
 * subclasses' modules, which the factory alone calls: `EmissiveWorld.ts`,
 * `FlameShader.ts`, `BlastShader.ts`); carries a uniform, a texture or a
 * define — those are the recipe's.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import type { Color3Like } from "../math";

/**
 * Which of the game's programs draws what a key stands for — the question
 * `instanceof ShaderMaterial` used to answer for the vertex bake
 * (`isCelMaterial`), asked of the key the factory minted rather than of a
 * Babylon class.
 */
export type MaterialProgram = "cel" | "emissive" | "emissiveWorld" | "flame" | "blast";

/** What a key is made with beyond its name and program; each absent field is Babylon's default. */
export interface MaterialKeyOptions {
  readonly emissiveColor?: Color3Like | null;
  readonly alpha?: number;
  readonly backFaceCulling?: boolean;
  readonly zOffset?: number;
  readonly zOffsetUnits?: number;
  readonly blended?: boolean;
}

/** The keys made so far — `serial`'s counter, over keys alone. */
let made = 0;

export class MaterialKey {
  /** The order this key was made in among every key: what the weapon's opaque segments sort by. */
  readonly serial: number;
  /** What the glow rules read as a light source's colour; null on a surface that emits nothing. */
  readonly emissiveColor: Color3Like | null;
  readonly alpha: number;
  readonly backFaceCulling: boolean;
  /** The depth bias's SLOPE: 0 on every material the game makes. */
  readonly zOffset: number;
  /** The depth bias in the depth buffer's own units — the recipe's `depthBias`. */
  readonly zOffsetUnits: number;
  /** Whether it draws alpha-BLENDED: a see-through pane, and nothing else. */
  readonly blended: boolean;

  constructor(
    readonly name: string,
    readonly program: MaterialProgram,
    options: MaterialKeyOptions = {},
  ) {
    this.serial = made++;
    this.emissiveColor = options.emissiveColor ?? null;
    this.alpha = options.alpha ?? 1;
    this.backFaceCulling = options.backFaceCulling ?? true;
    this.zOffset = options.zOffset ?? 0;
    this.zOffsetUnits = options.zOffsetUnits ?? 0;
    this.blended = options.blended ?? false;
  }
}

/**
 * Whether `material` is one of the cel program's — a colour, a gloss, a
 * translucency, a cloth, a pane or a ground: the ONE program that reads the
 * vertex colour buffer as the lighting term it is (`world/vertexShading.ts`'s
 * `takesShading`). The fire, the emissive palette, an unlit emissive and the
 * blast's paint are not.
 */
export function isCelMaterial(material: MaterialKey | null | undefined): boolean {
  return material?.program === "cel";
}
