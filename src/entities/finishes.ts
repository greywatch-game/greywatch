/**
 * finishes.ts — What a weapon is PAINTED in: four schemes per gun, as a type
 * and as the colours and gloss levels the viewmodel's merged colour groups
 * take.
 * Owns: the finish table and `applyFinish`, the one place a built weapon's
 * materials are rewritten. Holds no state and no geometry — which weapon is
 * carried is Game's, which finish is on it is Game's, and the meshes are the
 * model builders'.
 *
 * The third sibling of `weapons.ts` and `sights.ts`, and split from both for
 * the reason they are split from each other: a weapon decides what the round
 * does, an optic decides what you can see when you send it, and a finish
 * decides NOTHING. It is the only one of the three that is purely cosmetic,
 * which is what lets it be a client-side preference that never reaches the
 * wire, the bots, or the authority — a remote body is drawn by
 * `SoldierModel`, which has never heard of any of this.
 *
 * Invariants:
 * - **`standard` is the built state, not a repaint of it.** Its four colours
 *   are `weaponKit`'s own `BODY`/`POLYMER`/`METAL`/`RUBBER` and its metal
 *   carries the same `spec.rifle` that `WeaponBuild.collect` hands out, so
 *   selecting it puts a weapon back to exactly what came off the builder.
 *   Changing a constant there changes the default here, which is the point of
 *   referencing them rather than writing the hexes out twice.
 * - **A finish names ONE weapon, and that is what makes the sets disjoint.**
 *   The requirement is that no scheme is offered on two guns; a per-weapon
 *   list of ids could satisfy it today and quietly stop, so the ownership is a
 *   field on the finish and `FINISHES_BY_WEAPON` is derived from it. `null`
 *   means every weapon, and `standard` is the only entry allowed to say it.
 * - **The BRASS group is never repainted**, and a finish has no key for it.
 *   The LMG's exposed belt is the one part of a weapon that is not part of the
 *   weapon — it is the ammunition — so it stays cartridge-coloured under
 *   every scheme, which is also what keeps `bullion`'s gold plate reading as
 *   plate rather than as more belt.
 * - **Gloss is a LADDER with four rungs and no finish may invent a fifth**:
 *   matte (no `spec` at all), `spec.rifleSatin`, `spec.rifle`, and
 *   `spec.rifleChrome`. Two finishes that claim the same gloss have to
 *   genuinely have it, or the vocabulary stops meaning anything.
 * - The OPTIC is out of scope by construction rather than by a check: the
 *   parts a finish can reach are `WeaponParts.finish`, which the builder takes
 *   before any sight is built. A scope bolted to a chrome carbine stays black,
 *   the way a scope bolted to a chrome carbine does.
 *
 * The sidearm has no finishes. It is not offered on the kit screen, so there
 * is nowhere to pick one, and a pistol that turned gold because the LMG did
 * would be the loadout deciding something about a slot it was not asked about.
 */
import { CONFIG } from "../config";
import type { CelMaterialFactory, SpecSpec } from "../shaders/CelShader";
import {
  BODY,
  METAL,
  POLYMER,
  RUBBER,
  type FinishGroup,
  type FinishPart,
} from "./weaponKit";
import { PRIMARY_WEAPON_IDS, type PrimaryWeaponId } from "./weapons";

/** One colour group's paint: the colour, and how hard the moon comes off it. */
interface Paint {
  color: string;
  /** Absent is MATTE — the cel shader's specular band is opt-in per material. */
  spec?: SpecSpec;
}

/** A scheme: what it is called, what it is for, and what it paints. */
interface FinishDef {
  name: string;
  /** One line, in the player's terms. Copy, not configuration. */
  blurb: string;
  /**
   * The one weapon that offers it, or `null` for every weapon — see the
   * header. `standard` is the only entry that may be `null`.
   */
  weapon: PrimaryWeaponId | null;
  /**
   * Per group. A group left out keeps whatever the builder painted it, which
   * is how `brass` — the LMG's belt, which has no key here — stays brass.
   */
  groups: Partial<Record<FinishGroup, Paint>>;
}

const SPEC = CONFIG.graphics.spec;

/**
 * Every finish there is. Fifteen schemes plus the one every gun ships in, and
 * the fifteen are one gun's each: a scheme is a reason to carry THAT weapon,
 * and a palette that turns up on three of them is a palette nobody chose.
 *
 * `satisfies` rather than an annotation, so `FinishId` is the union of these
 * keys and a screen cannot ask for a scheme that is not in here.
 */
const FINISHES = {
  /**
   * What comes off the builder: `weaponKit`'s own constants, with the tight
   * cold glint on the fittings and everything else matte. Referenced rather
   * than written out — see the header.
   */
  standard: {
    name: "Standard",
    blurb:
      "Issue finish: a grey-black receiver over dark polymer, with the rails and small fittings left in the white to catch the light.",
    weapon: null,
    groups: {
      body: { color: BODY },
      polymer: { color: POLYMER },
      metal: { color: METAL, spec: SPEC.rifle },
      rubber: { color: RUBBER },
    },
  },

  // --- the battle rifle: service finishes, because it is the issued gun ---

  coyote: {
    name: "Coyote",
    blurb:
      "Desert issue — flat dark earth under a sand-coloured stock, with every fitting rubbed back so nothing on the weapon can catch the sun and give the position away.",
    weapon: "rifle",
    groups: {
      body: { color: "#4c4335" },
      polymer: { color: "#a08356" },
      metal: { color: "#6b6152", spec: SPEC.rifleSatin },
      rubber: { color: "#2a241b" },
    },
  },
  blued: {
    name: "Blued Steel",
    blurb:
      "Rust-blued steel over oiled walnut: the finish a full-power rifle was issued in for sixty years, polished dark enough that the highlight runs along an edge rather than sitting on it.",
    weapon: "rifle",
    groups: {
      body: { color: "#232a3d", spec: SPEC.rifleSatin },
      polymer: { color: "#5c3d27" },
      metal: { color: "#3d4a6b", spec: SPEC.rifleChrome },
      rubber: { color: "#1a1410" },
    },
  },
  verdigris: {
    name: "Verdigris",
    blurb:
      "Copper left out in the weather. A green patina has taken the receiver and the brass under it still shows at every edge a hand has worn.",
    weapon: "rifle",
    groups: {
      body: { color: "#2f6153" },
      polymer: { color: "#1b2f2a" },
      metal: { color: "#9a7a41", spec: SPEC.rifleSatin },
      rubber: { color: "#12211d" },
    },
  },

  // --- the bullpup: modern, compact, and the three loudest schemes here ---

  quicksilver: {
    name: "Quicksilver",
    blurb:
      "Mirror-polished to the last fitting. The brightest thing you can carry into a night village, and it will show every fingerprint you have ever put on it.",
    weapon: "carbine",
    groups: {
      body: { color: "#b6c1d2", spec: SPEC.rifleChrome },
      polymer: { color: "#767f8e", spec: SPEC.rifleSatin },
      metal: { color: "#dde6f5", spec: SPEC.rifleChrome },
      rubber: { color: "#262a31" },
    },
  },
  signal: {
    name: "Signal",
    blurb:
      "Range-toy orange over a graphite shell. There is nothing about it that is hard to see, which is the whole of what it costs.",
    weapon: "carbine",
    groups: {
      body: { color: "#33363c" },
      polymer: { color: "#d1621b" },
      metal: { color: "#7b8494", spec: SPEC.rifle },
      rubber: { color: "#191b20" },
    },
  },
  nightshade: {
    name: "Nightshade",
    blurb:
      "A violet dark enough that it only shows where the light actually lands, with cold plum steel at every rail and pin.",
    weapon: "carbine",
    groups: {
      body: { color: "#2b2340" },
      polymer: { color: "#191325" },
      metal: { color: "#7a63b8", spec: SPEC.rifleSatin },
      rubber: { color: "#120e1a" },
    },
  },

  // --- the SMG: cheap, close, and finished the way a cheap gun gets finished --

  oxblood: {
    name: "Oxblood",
    blurb:
      "Deep lacquered crimson over near-black, with the fittings warmed to match. Reads as brown across a street and as something else entirely up close.",
    weapon: "smg",
    groups: {
      body: { color: "#5a1f24", spec: SPEC.rifleSatin },
      polymer: { color: "#2a1216" },
      metal: { color: "#94706a", spec: SPEC.rifleSatin },
      rubber: { color: "#170b0d" },
    },
  },
  whitewash: {
    name: "Whitewash",
    blurb:
      "A coat of bone-white sprayed straight over the parkerising and thin enough that the grey shows through wherever a hand has been. The only weapon here with no shine on it at all.",
    weapon: "smg",
    groups: {
      body: { color: "#d6d3c8" },
      polymer: { color: "#8e8a7e" },
      // Matte throughout, deliberately: the paint went on over the fittings
      // too, and this is the one finish in the table with no highlight
      // anywhere on it — which is what makes the rest of them read as gloss.
      metal: { color: "#5b5c57" },
      rubber: { color: "#2e2c28" },
    },
  },
  voltage: {
    name: "Voltage",
    blurb:
      "Black anodising with every rail, pin and fitting struck in electric cyan. It looks like something that ought to be humming.",
    weapon: "smg",
    groups: {
      body: { color: "#16202a" },
      polymer: { color: "#1c3a44" },
      metal: { color: "#35d0e0", spec: SPEC.rifleChrome },
      rubber: { color: "#0c1014" },
    },
  },

  // --- the marksman rifle: cold, restrained, and one that is barely there ---

  frostbite: {
    name: "Frostbite",
    blurb:
      "Glacier grey with the steel left bright — a rifle finished for country where a dark shape at eight hundred metres is the only thing there is to see.",
    weapon: "dmr",
    groups: {
      body: { color: "#8fa4b8" },
      polymer: { color: "#4d6172" },
      metal: { color: "#cfe0ef", spec: SPEC.rifleChrome },
      rubber: { color: "#23303a" },
    },
  },
  loam: {
    name: "Loam",
    blurb:
      "Olive drab and rubbed earth, dulled everywhere a highlight could travel. Matte throughout, for the same reason the weapon is semi-automatic: nothing about it announces itself.",
    weapon: "dmr",
    groups: {
      body: { color: "#414a2e" },
      polymer: { color: "#2a2f1e" },
      metal: { color: "#4f5844" },
      rubber: { color: "#1a1d12" },
    },
  },
  obsidian: {
    name: "Obsidian",
    blurb:
      "Black on black, lacquered until it behaves like glass. In the dark the only thing that shows is the edge the light runs along, and the outline it is drawn in.",
    weapon: "dmr",
    groups: {
      body: { color: "#16171b", spec: SPEC.rifleChrome },
      polymer: { color: "#0e0f12" },
      metal: { color: "#24262c", spec: SPEC.rifleChrome },
      rubber: { color: "#08090b" },
    },
  },

  // --- the machine gun: heavy, industrial, and one outright trophy ---

  bullion: {
    name: "Bullion",
    blurb:
      "Gold plate over the receiver and every fitting on it, with the belt hanging out of the side in very nearly the same colour. Subtlety was never what this weapon was for.",
    weapon: "lmg",
    groups: {
      body: { color: "#b4893a", spec: SPEC.rifleChrome },
      polymer: { color: "#201c14" },
      metal: { color: "#e0bb5e", spec: SPEC.rifleChrome },
      rubber: { color: "#14110c" },
    },
  },
  hazard: {
    name: "Hazard",
    blurb:
      "Plant-floor livery: a caution-yellow receiver on black furniture, the way anything heavy enough to take a foot off gets painted.",
    weapon: "lmg",
    groups: {
      body: { color: "#c9a018" },
      polymer: { color: "#1c1e22" },
      metal: { color: "#55595f", spec: SPEC.rifleSatin },
      rubber: { color: "#101215" },
    },
  },
  ironclad: {
    name: "Ironclad",
    blurb:
      "Dockyard grey, laid on thick and over everything. It is the colour of something that was welded together rather than machined.",
    weapon: "lmg",
    groups: {
      body: { color: "#56646f" },
      polymer: { color: "#2f3840" },
      metal: { color: "#97a6b6", spec: SPEC.rifleSatin },
      rubber: { color: "#1c2126" },
    },
  },
} satisfies Record<string, FinishDef>;

/** A finish. Derived from the table, so the table is the only declaration. */
export type FinishId = keyof typeof FINISHES;

/**
 * One entry, as the INTERFACE rather than as its own literal type.
 *
 * `satisfies` is what makes `FinishId` the union of the table's keys, and the
 * price of it is that each entry keeps the exact shape it was written in — so
 * `groups` on a finish that says nothing about `brass` has no such key to
 * index at all, and a lookup by `FinishGroup` does not compile. Everything
 * here reads the table through this, which widens each entry back to the
 * declared shape without giving up the keys.
 */
function def(id: FinishId): FinishDef {
  return FINISHES[id];
}

/** Every finish there is, in table order. */
export const FINISH_IDS = Object.keys(FINISHES) as FinishId[];

/** The scheme every weapon ships in, and the fallback for anything unknown. */
export const DEFAULT_FINISH: FinishId = "standard";

export function isFinishId(value: string): value is FinishId {
  return Object.prototype.hasOwnProperty.call(FINISHES, value);
}

export function finishName(id: FinishId): string {
  return def(id).name;
}

export function finishBlurb(id: FinishId): string {
  return def(id).blurb;
}

/**
 * The three colours a finish is recognised by, front to back: furniture,
 * receiver, fittings. What the kit screen paints its swatch from, so a button
 * says what it does rather than only what it is called.
 *
 * The order is the eye's rather than the table's — a weapon is mostly stock
 * and receiver, and the fittings are the accent.
 */
export function finishSwatch(id: FinishId): [string, string, string] {
  const g = def(id).groups;
  return [
    g.polymer?.color ?? POLYMER,
    g.body?.color ?? BODY,
    g.metal?.color ?? METAL,
  ];
}

/**
 * What each weapon offers, in screen order: the standard finish first and its
 * own three after it.
 *
 * DERIVED from the `weapon` field rather than written out as five lists, which
 * is what makes "no scheme appears on two guns" true by construction instead
 * of by review — see the header.
 */
export const FINISHES_BY_WEAPON: Record<PrimaryWeaponId, FinishId[]> = (() => {
  // Seeded from the WEAPON list rather than grown from the finishes, so every
  // primary has a row whether or not any scheme names it. A weapon added to
  // `CONFIG.weapons` before its three are written still opens a kit screen —
  // the alternative is an `undefined` where the row's `.map` goes, on the
  // one table here nothing validates against.
  const out = Object.fromEntries(
    PRIMARY_WEAPON_IDS.map((id) => [id, [DEFAULT_FINISH]]),
  ) as Record<PrimaryWeaponId, FinishId[]>;
  for (const id of FINISH_IDS) {
    const owner = def(id).weapon;
    if (owner !== null) out[owner].push(id);
  }
  return out;
})();

/**
 * The finish a weapon should actually wear, given what was asked for.
 *
 * The ask is validated against THIS weapon's list rather than against the
 * table, because the ids are remembered per weapon in `localStorage` and a
 * store the player can edit could hold a real finish that belongs to a
 * different gun. Anything that does not fit falls back to the standard, which
 * every weapon offers.
 */
export function finishFor(weapon: PrimaryWeaponId, id: string): FinishId {
  return isFinishId(id) && FINISHES_BY_WEAPON[weapon].includes(id)
    ? id
    : DEFAULT_FINISH;
}

/**
 * Repaints a built weapon's colour groups.
 *
 * Materials are the factory's shared, cached ones, so this is a handful of
 * pointer writes and nothing is allocated per weapon — the first weapon to ask
 * for a colour mints it, and every later ask is a map lookup. A group the
 * finish says nothing about is left exactly as the builder painted it, which
 * is what keeps the LMG's brass belt out of this.
 *
 * The ink is not re-derived and does not need to be: the viewmodel is the one
 * thing in the game that outlines itself BLACK by hand rather than tinting the
 * line from the surface's own colour (see `ViewModel`'s constructor), so there
 * is no derived tint of its to go stale when the surface changes underneath it.
 */
export function applyFinish(
  mats: CelMaterialFactory,
  parts: readonly FinishPart[],
  id: FinishId,
): void {
  const groups = def(id).groups;
  for (const part of parts) {
    const paint = groups[part.group];
    if (!paint) continue;
    part.mesh.material = paint.spec
      ? mats.getGlossy(paint.color, paint.spec)
      : mats.get(paint.color);
  }
}
