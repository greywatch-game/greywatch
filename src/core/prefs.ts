/**
 * prefs.ts — What the player picked last time: difficulty, map, loadout (both
 * slots and a finish per weapon) and region.
 * Owns the localStorage round trip for each; owns nothing that applies them
 * (that is `Game.setDifficulty` / `setMap` / `applyLoadout` / `setRegion`).
 * Sibling of [`settings.ts`](settings.ts), which does the same job for the
 * display settings and is separate only because those are one flat object
 * behind one screen, where these are four unrelated picks made in three places.
 * Invariants: storage throwing is NEVER fatal — private browsing and `file://`
 * both throw on the first `getItem`, and a forgotten preference is not worth
 * failing a boot over, so every reader falls back to a default.
 * Anything read back that INDEXES a table is validated rather than trusted: the
 * store holds strings the player can edit, and an id that no longer exists
 * would otherwise look up a built model with `undefined`.
 */
import { CONFIG } from "../config";
import {
  DEFAULT_FINISH,
  finishFor,
  type FinishId,
} from "../entities/finishes";
import {
  DEFAULT_EQUIPMENT,
  isEquipmentId,
  type EquipmentId,
} from "../entities/equipment";
import {
  DEFAULT_SIGHT,
  isSightId,
  type SightId,
} from "../entities/sights";
import {
  DEFAULT_WEAPON,
  isPrimaryWeaponId,
  type PrimaryWeaponId,
} from "../entities/weapons";
import { DEFAULT_MAP, MAPS, type MapDef } from "../world/maps";

/** Where the chosen enemy-skill tier is remembered between sessions. */
const DIFFICULTY_KEY = "greywatch.difficulty";
/** …and the chosen map, by `MapDef.id`. */
const MAP_KEY = "greywatch.map";
/** …and the loadout. Same store, same tolerance for it not working. */
const SIGHT_KEY = "greywatch.sight";
const WEAPON_KEY = "greywatch.weapon";
/**
 * …and which anti-tank item the kit's third slot holds.
 *
 * Remembered even on the maps that do not offer the slot, and deliberately:
 * the pick is the player's, not the map's, so walking off Coldharbour and back
 * onto it must not have quietly swapped their launcher for a stack of mines.
 * `Game` is where "is there a slot at all" is decided.
 */
const EQUIPMENT_KEY = "greywatch.equipment";
/**
 * …and the finish, which is the one preference here that is remembered PER
 * WEAPON rather than once.
 *
 * A finish belongs to a gun — the three on offer are that gun's and no other's
 * — so a single key would mean picking up the SMG threw away what the rifle
 * was painted in. One key each is what makes "your rifle is Coyote and your
 * SMG is Voltage" a thing the game can remember.
 */
const FINISH_KEY_PREFIX = "greywatch.finish.";
/** …and which region the player chose to play in, by `Region.id`. */
const REGION_KEY = "greywatch.region";

export function readDifficulty(): number {
  try {
    const raw = window.localStorage.getItem(DIFFICULTY_KEY);
    const n = raw === null ? NaN : Number(raw);
    if (Number.isFinite(n)) return n;
  } catch {
    // Private browsing and file:// both throw here. A default is fine.
  }
  return CONFIG.bots.skill.defaultDifficulty;
}

export function writeDifficulty(tier: number): void {
  try {
    window.localStorage.setItem(DIFFICULTY_KEY, String(tier));
  } catch {
    // Not being able to remember the setting is not worth failing over.
  }
}

/**
 * The remembered map, resolved by id against `MAPS`.
 *
 * It MUST return an entry out of that array rather than anything built here.
 * `applySky` skips repainting an 8-megapixel dome — two thousand stars, a
 * galactic band, a stretched halo and two fBm cloud masks — by comparing the
 * environment by OBJECT IDENTITY, so a `MapDef` assembled on the way past
 * fails that test open and repaints the whole sky on every round start. The
 * symptom is a hitch with nothing in the profile to point at it.
 */
export function readMap(): MapDef {
  try {
    const raw = window.localStorage.getItem(MAP_KEY);
    const found = MAPS.find((m) => m.id === raw);
    if (found) return found;
  } catch {
    // As above. An unknown id also lands here, which is the same answer.
  }
  return DEFAULT_MAP;
}

export function writeMap(id: string): void {
  try {
    window.localStorage.setItem(MAP_KEY, id);
  } catch {
    // As above.
  }
}

/**
 * The region the player last CHOSE, by id, or null.
 *
 * The one preference here that is not validated against a table, because the
 * table is not in this build: regions come from a deploy-time file, so an id
 * this reader cannot recognise may be a region that exists, one that has been
 * retired, or one that is briefly out of the list while a box is down. It is
 * resolved where the list is known (`Game.regionFor`) and simply falls through
 * to the ordinary default when it does not match — and it is deliberately NOT
 * cleared then, so a region taken out for an hour is still the player's when it
 * comes back.
 *
 * Null is a meaningful answer and not a missing one. Nothing remembered means
 * the player has never picked, which is what lets the lobby put them in the
 * region that answered fastest rather than in whichever one the file lists
 * first — see `Game.noteRegionPing`.
 */
export function readRegion(): string | null {
  try {
    const raw = window.localStorage.getItem(REGION_KEY);
    if (raw) return raw;
  } catch {
    // As above.
  }
  return null;
}

export function writeRegion(id: string): void {
  try {
    window.localStorage.setItem(REGION_KEY, id);
  } catch {
    // As above.
  }
}

/**
 * The remembered optic. Validated rather than trusted: the value is a string
 * out of a store the player can edit, and a sight that no longer exists would
 * otherwise index the assembly table with `undefined`.
 */
export function readSight(): SightId {
  try {
    const raw = window.localStorage.getItem(SIGHT_KEY);
    if (raw !== null && isSightId(raw)) return raw;
  } catch {
    // As above.
  }
  return DEFAULT_SIGHT;
}

export function writeSight(id: SightId): void {
  try {
    window.localStorage.setItem(SIGHT_KEY, id);
  } catch {
    // As above.
  }
}

/**
 * The remembered weapon. Validated exactly as the optic is, and for the same
 * reason: it indexes a table of built models. The test is the PRIMARY one, so
 * a store holding "pistol" — which is a real weapon id, just not one the kit
 * offers — falls back to the default rather than putting the sidearm in both
 * hands with nothing to swap to.
 */
export function readWeapon(): PrimaryWeaponId {
  try {
    const raw = window.localStorage.getItem(WEAPON_KEY);
    if (raw !== null && isPrimaryWeaponId(raw)) return raw;
  } catch {
    // As above.
  }
  return DEFAULT_WEAPON;
}

export function writeWeapon(id: PrimaryWeaponId): void {
  try {
    window.localStorage.setItem(WEAPON_KEY, id);
  } catch {
    // As above.
  }
}

/**
 * The remembered anti-tank item. Validated exactly as the weapon and the optic
 * are, and for the same reason: it indexes a table of built models.
 */
export function readEquipment(): EquipmentId {
  try {
    const raw = window.localStorage.getItem(EQUIPMENT_KEY);
    if (raw !== null && isEquipmentId(raw)) return raw;
  } catch {
    // As above.
  }
  return DEFAULT_EQUIPMENT;
}

export function writeEquipment(id: EquipmentId): void {
  try {
    window.localStorage.setItem(EQUIPMENT_KEY, id);
  } catch {
    // As above.
  }
}

/**
 * The finish remembered for one weapon.
 *
 * Validated by `finishFor`, which is stricter than the two above and has to
 * be: a stored value that is a real `FinishId` may still be another gun's, and
 * painting the rifle in the machine gun's gold is not something the kit screen
 * could ever have been asked for. Anything that does not fit falls back to the
 * standard finish, which every weapon offers.
 */
export function readFinish(weapon: PrimaryWeaponId): FinishId {
  try {
    const raw = window.localStorage.getItem(FINISH_KEY_PREFIX + weapon);
    if (raw !== null) return finishFor(weapon, raw);
  } catch {
    // As above.
  }
  return DEFAULT_FINISH;
}

export function writeFinish(weapon: PrimaryWeaponId, id: FinishId): void {
  try {
    window.localStorage.setItem(FINISH_KEY_PREFIX + weapon, id);
  } catch {
    // As above.
  }
}
