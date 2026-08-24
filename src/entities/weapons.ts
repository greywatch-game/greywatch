/**
 * weapons.ts — The weapons the player can carry, as a type and as the resolved
 * numbers everything downstream reads.
 * Owns: the derivation from `CONFIG.weapons[id]` to a `WeaponSetup`. Nothing
 * else may re-read that table — Player, CameraSystem and the loadout screen
 * must agree on what is being carried.
 * Invariants: `WeaponId` is derived from the CONFIG table, so the table is the
 * only place a weapon is declared. Holds no state and no geometry: the models
 * are RifleModel's and SmgModel's, and which one is carried is Game's.
 *
 * The sibling of `sights.ts`, and split from it for the reason the two are
 * separate slots: a weapon decides what the round does, an optic decides what
 * you can see when you send it. Neither reads the other.
 */
import { CONFIG } from "../config";

/**
 * A weapon. Derived from the config table rather than written out, so the two
 * cannot drift and a new weapon is one entry plus one model builder.
 */
export type WeaponId = keyof typeof CONFIG.weapons;

/** Every weapon there is a model for — what `ViewModel` builds. */
export const WEAPON_IDS = Object.keys(CONFIG.weapons) as WeaponId[];

export function isWeaponId(value: string): value is WeaponId {
  return Object.prototype.hasOwnProperty.call(CONFIG.weapons, value);
}

/**
 * The sidearm every loadout carries, whatever else is in it.
 *
 * It is an ordinary entry in `CONFIG.weapons` — it fires, reloads, blooms and
 * kicks through exactly the same numbers as the rest, and there is nothing
 * about a pistol the weapon table needed teaching. What makes it a sidearm is
 * only that it is not one of the things the kit screen offers, which is what
 * the split below says and the only place it is said.
 *
 * Declared `as const` rather than as a `WeaponId`, because `PrimaryWeaponId`
 * subtracts it from the union and a widened type would subtract everything.
 */
export const SIDEARM = "pistol" as const;

/** A weapon the loadout screen can actually offer — anything but the sidearm. */
export type PrimaryWeaponId = Exclude<WeaponId, typeof SIDEARM>;

/** In screen order — the loadout row, and what the cycle keys step through. */
export const PRIMARY_WEAPON_IDS = WEAPON_IDS.filter(
  (id) => id !== SIDEARM,
) as PrimaryWeaponId[];

export function isPrimaryWeaponId(value: string): value is PrimaryWeaponId {
  return isWeaponId(value) && value !== SIDEARM;
}

/** The default carry: the weapon the game shipped with. */
export const DEFAULT_WEAPON: PrimaryWeaponId = "rifle";

/**
 * How a weapon is HEARD, as deviations from the reference report.
 *
 * `Sfx.shoot` owns the shape of a gunshot — five layers, in the order the ear
 * resolves them — and this is what one weapon does to that shape.
 * `CONFIG.weapons[id].report` is where the numbers live and what each field
 * means; the short version is that `pitch` is bore, `weight` is charge,
 * `length` is how long it rings, `tail` is how hard it drives the village and
 * the two `action` fields are the mechanism.
 *
 * **Every field is 1 for the reference weapon**, so an all-ones voice is the
 * rifle exactly — which is what a shooter with no weapon of its own is heard
 * as, and why `Sfx` needs no separate default to fall back on.
 */
export interface ReportVoice {
  /** Multiplier on every frequency in the report — bore and charge. */
  pitch: number;
  /** Overall level, and read against the weapon's own `fireRate`. */
  level: number;
  /** The leading edge: the first few milliseconds, all of it above 3.6 kHz. */
  snap: number;
  /** The low roll and the chest thump together — how heavy the shot is. */
  weight: number;
  /** How long the body, the roll and the thump ring on. */
  length: number;
  /** How hard the shot drives the shared environment reverb. */
  tail: number;
  /** Pitch of the mechanism, and (inversely) how soon it cycles. */
  actionPitch: number;
  /** How much of the mechanism is heard against the shot — and the reload. */
  actionVol: number;
}

/**
 * Everything a carried weapon decides, resolved once when it is picked up.
 *
 * Every field is a plain `number` on purpose, and the one nested block is
 * plain numbers for the same reason. `CONFIG` is `as const`, so the table's
 * own fields are literal types and a `let` holding one cannot be reassigned;
 * resolving through here is what lets the rest of the game treat a weapon's
 * stats as numbers that happen to differ from one to the next.
 */
export interface WeaponSetup {
  id: WeaponId;
  name: string;
  short: string;
  /** What a round does at or inside `falloffNear`. */
  damage: number;
  /** …and at or beyond `falloffFar`, lerped between the two. */
  damageFar: number;
  falloffNear: number;
  falloffFar: number;
  /** Rounds per second — a ceiling on the trigger when `semiAuto`, and the
   *  rate WITHIN a burst when `burst` > 1. */
  fireRate: number;
  /** The trigger has to come up between pulls. `Player.tryShot` enforces it. */
  semiAuto: boolean;
  /** Rounds one pull spends; 1 for everything but the carbine. */
  burst: number;
  /** Seconds after a burst's last round before the next may leave. */
  burstCycle: number;
  magSize: number;
  reloadTime: number;
  spreadHip: number;
  spreadAds: number;
  /** Where a round from this weapon stops (m). */
  range: number;
  /** Scales the per-shot aim kick. */
  recoilMult: number;
  /** Which way the horizontal kick drifts, -1 (left) to +1 (right). */
  yawBias: number;
  /** Scales both the per-shot spread bloom and its ceiling. */
  bloomMult: number;
  /** Multiplier on the ADS blend rate, alongside the fitted optic's own. */
  adsSpeedMult: number;
  /** Scales the aimed hold sway — how steady this weapon is in the hands. */
  swayMult: number;
  /** Hip-pose shift along the camera axis, for a weapon of a different length. */
  hipZ: number;
  /** …and across it, for a weapon that hangs below its bore rather than above. */
  hipY: number;
  /** Seconds this weapon takes to come up when swapped to. */
  drawTime: number;
  /** What this weapon sounds like — see `ReportVoice`. */
  report: ReportVoice;
  /** Seconds between rounds — `1 / fireRate`, resolved once. */
  shotInterval: number;
}

/**
 * Resolves a weapon's config entry into the numbers the player and the camera
 * run on. Called when the loadout changes, never per frame.
 */
export function weaponSetup(id: WeaponId): WeaponSetup {
  const w = CONFIG.weapons[id];
  return {
    id,
    name: w.name,
    short: w.short,
    damage: w.damage,
    damageFar: w.damageFar,
    falloffNear: w.falloffNear,
    falloffFar: w.falloffFar,
    fireRate: w.fireRate,
    semiAuto: w.semiAuto,
    burst: w.burst,
    burstCycle: w.burstCycle,
    magSize: w.magSize,
    reloadTime: w.reloadTime,
    spreadHip: w.spreadHip,
    spreadAds: w.spreadAds,
    range: w.range,
    recoilMult: w.recoilMult,
    yawBias: w.yawBias,
    bloomMult: w.bloomMult,
    adsSpeedMult: w.adsSpeedMult,
    swayMult: w.swayMult,
    hipZ: w.hipZ,
    hipY: w.hipY,
    drawTime: w.drawTime,
    report: w.report,
    shotInterval: 1 / w.fireRate,
  };
}
