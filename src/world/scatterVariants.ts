/**
 * world/scatterVariants.ts — The scatter's VARIANTS: each kind built a fixed
 * number of times a build (`CONFIG.scatter.variants`), and every placement of
 * it wearing one of them (`BABYLON_EXIT.md` X3.4a).
 * Owns: `ScatterVariants` — one build's variants, made the first time a kind
 * is asked for and kept for the build; which variant a placement wears
 * (`pick`); and a placement's parts, cloned off its variant (`place`).
 * Invariants: a variant is its kind's builder run off a stream of its OWN,
 * seeded from the layout's seed, the kind and the variant's number, never the
 * build's shared scatter stream — so making the variants takes nothing from
 * the stream the placements are drawn off, and the shared draws a placement
 * still owes are spent by its replay (`props/sharedDraws.ts`); a variant's
 * parts are its builder's, flattened and merged per material in the PROP's
 * own frame — standing at the origin at scale 1 and yaw 0, its root's own
 * height and lean kept, which is everything the placement used to overwrite
 * taken away and everything it kept left in — so a placement's transform is a
 * translation, a yaw and a uniform scale and nothing else; which variant a
 * placement wears is a hash of where it sits in the layout (the region and
 * its index), never a draw; a kind with CLASSES (maple's four crowns) has its
 * variants shared out evenly between them; a variant's parts are never
 * admitted — a placement admits CLONES, every array its own (`worldGeometry`'s
 * admission refuses a shared one).
 * Never: draws from a stream it did not make; reads a scene; is used by an
 * editor build's caller for anything but the same parts a shipped build gets.
 * Contract: `docs/world.md`, the scatter.
 *
 * WHY VARIANTS. Every tree was a different shape: a tree builder seeds a
 * stream of its own from one of the shared draws, so Greyfen's 1,737 jungle
 * trees were 1,737 meshes' worth of unique geometry, 7.3 M of the map's
 * 8.9 M vertices. Our renderer draws scatter as INSTANCES of a source mesh
 * (X3.4b), which only pays if placements share one; sixteen a kind was the
 * user's call (2026-10-14) over eight, the forest's repetition broken up by
 * each placement's own yaw and scale.
 */
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { ScatterSpec } from "./layout";
import { mergeByMaterial } from "./merge";
import { flattenParts, Part } from "./parts";
import { mapleCrownOf } from "./props";
import { mulberry32 } from "./rng";
import { mintFrom, surfaceOf } from "./worldGeometry";

type Kind = ScatterSpec["prop"];

/** A scatter builder, as `MapBuilder.SCATTER_BUILDERS` holds one. */
export type VariantBuilder = (
  mats: CelMaterialFactory,
  rng: () => number,
  sub: () => number,
  foliage: number,
) => Part;

/** One variant of a kind: its parts in the prop's own frame, each at identity. */
export interface ScatterVariant {
  readonly parts: readonly Part[];
}

/**
 * Kinds whose variants are shared out evenly between CLASSES, and how a
 * variant's class is read off the stream its builder will be handed — maple's
 * crown colour, decided by its third shared draw (`mapleCrownOf`). Without it
 * sixteen draws over four crowns leave one crown with a tree or two at best.
 */
const CLASSES: Partial<Record<Kind, { readonly count: number; of(rng: () => number): number }>> = {
  maple: { count: 4, of: mapleCrownOf },
};

/** 32-bit FNV-1a of a kind's name, so each kind's variants are its own. */
function kindHash(kind: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < kind.length; i++) {
    h ^= kind.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class ScatterVariants {
  private readonly made = new Map<Kind, ScatterVariant[]>();

  constructor(
    private readonly builders: Record<Kind, VariantBuilder>,
    private readonly mats: CelMaterialFactory,
    /** The layout's seed (`MapBuilder.propSeed`). */
    private readonly seed: number,
    /** `BuildOptions.foliage`, which a crown's builder reads. */
    private readonly foliage: number,
    readonly count: number = CONFIG.scatter.variants,
  ) {}

  /** `kind`'s variants, made on the first ask. */
  of(kind: Kind): readonly ScatterVariant[] {
    let list = this.made.get(kind);
    if (!list) {
      list = this.seeds(kind).map((s) => this.make(kind, s));
      this.made.set(kind, list);
    }
    return list;
  }

  /**
   * Which variant placement `i` of region `region` wears: a hash of where it
   * sits in the layout, so it takes nothing from any stream and a region's
   * `count` moving leaves the props it still places wearing what they wore.
   */
  pick(region: number, i: number): number {
    const h = mulberry32((this.seed ^ (region * 7919 + i)) ^ 0x6c8e9cf5)();
    return Math.min(this.count - 1, Math.floor(h * this.count));
  }

  /**
   * One placement's parts: variant `v` of `kind` cloned, each part standing
   * at `(x, y, z)` in its region's frame, turned `yaw` and scaled `scale` —
   * what the placement's root transform used to be, with the root's own
   * height and lean already in the variant.
   */
  place(kind: Kind, v: number, x: number, y: number, z: number, yaw: number, scale: number): Part[] {
    return this.of(kind)[v].parts.map((src) => {
      const part = new Part(src.name, src.geometry.clone());
      part.material = src.material;
      part.metadata = src.metadata ? { ...src.metadata } : null;
      part.position.copyFromFloats(x, y, z);
      part.rotation.copyFromFloats(0, yaw, 0);
      part.scaling.setAll(scale);
      return part;
    });
  }

  /**
   * The seed each of `kind`'s variants is built from. A kind with classes
   * walks the candidates in order and takes each into its class until every
   * class holds its share, so the set is the same on every build.
   */
  private seeds(kind: Kind): number[] {
    const base = (this.seed ^ kindHash(kind)) >>> 0;
    const candidate = (c: number): number => (base ^ Math.imul(c + 1, 0x9e3779b1)) >>> 0;
    const classes = CLASSES[kind];
    if (!classes) return Array.from({ length: this.count }, (_, k) => candidate(k));
    const share = Math.ceil(this.count / classes.count);
    const held = new Array<number>(classes.count).fill(0);
    const out: number[] = [];
    for (let c = 0; out.length < this.count; c++) {
      if (c > this.count * classes.count * 64) {
        throw new Error(`scatterVariants: ${kind}'s classes cannot be filled`);
      }
      const s = candidate(c);
      const k = classes.of(mulberry32(s));
      if (held[k] >= share) continue;
      held[k]++;
      out.push(s);
    }
    return out;
  }

  /** One variant: the builder off `s`, its placement taken off, merged per material. */
  private make(kind: Kind, s: number): ScatterVariant {
    const root = this.builders[kind](this.mats, mulberry32(s), mulberry32(s ^ 0x2545f491), this.foliage);
    // What `scatterRegion` used to overwrite on the root, taken off: where it
    // stands on the ground, its yaw and its scale. Its own height and its
    // lean stay, as the placement left them.
    root.position.x = 0;
    root.position.z = 0;
    root.rotation.y = 0;
    root.scaling.setAll(1);
    const mint = mintFrom();
    const merged = mergeByMaterial(
      flattenParts(root).map((p) => surfaceOf(p, mint())),
      `${kind}${s.toString(16)}`,
      { mint },
    );
    return { parts: merged.map((m) => m.part) };
  }
}
