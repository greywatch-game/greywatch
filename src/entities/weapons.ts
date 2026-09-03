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
import { EQUIPMENT_IDS, equipmentSetup, isEquipmentId, type EquipmentId } from "./equipment";

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

/**
 * Anything the player may have in their hands — a weapon out of the kit, the
 * sidearm, or the anti-tank item in the third slot.
 *
 * The two id spaces are deliberately disjoint tables rather than one: an AT
 * item is not offered by the weapon row, takes no optic, takes no finish and
 * is not ranked on the kit screen's stat chart, and every one of those would
 * have to be written here as an exception if it were a seventh entry in
 * `CONFIG.weapons`. It is `WeaponSetup.id`'s type because a holster holds one
 * of either and everything downstream of a holster reads that field.
 *
 * The import it rests on is TYPE-ONLY in both directions, so `equipment.ts`
 * and this file are a cycle the compiler resolves and the module graph never
 * has.
 */
export type CarriedId = WeaponId | EquipmentId;

/**
 * Every id `ViewModel` has to have a rig for — the weapons and both AT items.
 *
 * The one list that spans the two tables, and it exists because the viewmodel
 * is the one place that genuinely does not care which of them a thing came
 * out of: it builds a rig per id, enables one, and poses whatever is enabled.
 * Everything else in the game reads one table or the other.
 */
export const CARRIED_IDS: CarriedId[] = [...WEAPON_IDS, ...EQUIPMENT_IDS];

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
  id: CarriedId;
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
  /**
   * Whether this weapon's fire cooldown is a GESTURE — a bolt worked by hand
   * between rounds — rather than an action that cycles itself.
   *
   * It changes no rule: `shotInterval` already stops the trigger and the round
   * is unaffected. What it decides is that `ViewModel` plays the cycle over
   * that clock and takes the sight picture away while it runs, which on the one
   * weapon that sets it is the entire cost of the weapon. See
   * `Player.cycleProgress`, and `CONFIG.weapons.rifle.boltCycle` for the
   * argument.
   */
  boltCycle: boolean;
  magSize: number;
  reloadTime: number;
  spreadHip: number;
  spreadAds: number;
  /** Where a round from this weapon stops (m). */
  range: number;
  /**
   * Scales the per-shot aim kick — the MOMENT, how far the muzzle tips. Read
   * by `Player.recoilKick` and by nothing else.
   */
  recoilMult: number;
  /**
   * How hard the shot SHOVES, which is a different quantity from how far it
   * tips the muzzle and is spent on entirely different things: the settle
   * spring's constants and the post-shot unsteadiness (`CameraSystem`), the
   * view punch's amplitude (`Player.punchShock`) and the viewmodel's own
   * travel (`Player.kickWeight`). It reaches no angle at all.
   */
  recoilImpulse: number;
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
  /**
   * How far the weapon is TURNED in the hands at hip, in radians, on top of
   * the shared `viewmodel.hipRot`.
   *
   * The third of the hip-pose knobs and the one that is about SHAPE rather
   * than length: every gun in the kit is a receiver held below and right of
   * the eye, so a small shared yaw frames all six. A launcher is a tube whose
   * rear end is a bell fifteen centimetres across half a metre from the lens —
   * pointed away it is a disc with the rest of the weapon hidden behind it,
   * and no amount of `hipZ` or `hipY` fixes that, because the problem is that
   * the eye is looking down the bore. Turning it outboard is what puts the
   * tube, the shield and the warhead broadside where they can be read.
   *
   * Positive is OUTBOARD — Babylon is left-handed, so a positive `rotY` takes
   * the muzzle (+z) toward +x, the same convention `viewmodel.sprintRot`
   * documents from the other side.
   */
  hipYaw: number;
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
    boltCycle: w.boltCycle,
    magSize: w.magSize,
    reloadTime: w.reloadTime,
    spreadHip: w.spreadHip,
    spreadAds: w.spreadAds,
    range: w.range,
    recoilMult: w.recoilMult,
    recoilImpulse: w.recoilImpulse,
    yawBias: w.yawBias,
    bloomMult: w.bloomMult,
    adsSpeedMult: w.adsSpeedMult,
    swayMult: w.swayMult,
    hipZ: w.hipZ,
    hipY: w.hipY,
    hipYaw: w.hipYaw,
    drawTime: w.drawTime,
    report: w.report,
    shotInterval: 1 / w.fireRate,
  };
}

/**
 * Resolves whatever is in the hands, out of whichever table owns it.
 *
 * The one place the two id spaces are joined, and it exists because a handful
 * of call sites genuinely hold a `CarriedId` and want the numbers behind it —
 * the viewmodel building a rig, the camera taking a fit, the HUD captioning a
 * slot. Everything else knows which table it is asking about and calls
 * `weaponSetup` or `equipmentSetup` directly.
 */
export function carriedSetup(id: CarriedId): WeaponSetup {
  return isEquipmentId(id) ? equipmentSetup(id) : weaponSetup(id);
}
