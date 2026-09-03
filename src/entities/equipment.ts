/**
 * equipment.ts — The anti-tank slot's two items, as a type and as the resolved
 * numbers everything downstream reads.
 * Owns: the derivation from `CONFIG.equipment[id]` to a `WeaponSetup` the
 * carry path can hold, and the ordnance figures `AntiTankSystem` and `Game`
 * resolve a detonation with. Nothing else may re-read that table.
 * Invariants: `EquipmentId` is derived from the CONFIG table, so the table is
 * the only place an AT item is declared. Holds no state and no geometry: the
 * models are `RpgModel`'s and `MineModel`'s, and which one is carried is
 * `Game`'s.
 *
 * The third sibling of `weapons.ts` and `sights.ts`, and it is a slot rather
 * than a row on one of theirs for the reason they are separate from each
 * other: a weapon decides what the round does, an optic decides what you can
 * see when you send it, and this decides what a tank has to be afraid of.
 * Neither of the other two reads it.
 *
 * **An AT item is CARRIED as an ordinary weapon and RESOLVED as nothing like
 * one.** `equipmentSetup` hands back a plain `WeaponSetup`, so the holster,
 * the swap, the draw, the viewmodel, the camera fit and the HUD caption all
 * work on it with nothing taught about it — and every field that would make it
 * a gun is a constant here saying it is not: no fall-off, no spread, no burst,
 * and a `reloadTime` of zero that nothing may reach, because
 * `Player.startReload` refuses this slot outright. What one life carries is
 * `CONFIG.equipment[id].carried` and there is no resupply, exactly as with the
 * grenade pouch.
 */
import { CONFIG } from "../config";
import type { WeaponSetup } from "./weapons";

/**
 * An anti-tank item. Derived from the config table rather than written out, so
 * the two cannot drift and a third item is one entry plus one model builder.
 */
export type EquipmentId = keyof typeof CONFIG.equipment;

/** In screen order — the kit row, and what the cycle keys step through. */
export const EQUIPMENT_IDS = Object.keys(CONFIG.equipment) as EquipmentId[];

export function isEquipmentId(value: string): value is EquipmentId {
  return Object.prototype.hasOwnProperty.call(CONFIG.equipment, value);
}

/** The default pick: the launcher, which is the one that can chase a hull. */
export const DEFAULT_EQUIPMENT: EquipmentId = "rpg";

/**
 * What a detonation is worth: what it does to the hull it struck, and what it
 * does to everything else.
 *
 * Two numbers rather than one falloff for the reason `CONFIG.equipment`'s
 * header gives — a curve that reaches a hull's centre from its nose kills
 * infantry at eight metres. `Game` is the one place both are spent, because
 * the direct hit is a `Hittable` and the splash is `GrenadeSystem`'s.
 */
export interface OrdnanceEffect {
  /** What the hull it struck takes, as a `shell`. */
  damage: number;
  /** How near a hull's centre has to be for that to be a strike on it. */
  contactRadius: number;
  /** The splash, as `GrenadeSystem.blastAt` takes it. */
  blast: {
    radius: number;
    inner: number;
    damage: number;
    power: number;
  };
}

/** What one AT item does when it goes off. Called at a detonation, not per frame. */
export function ordnanceEffect(id: EquipmentId): OrdnanceEffect {
  const e = CONFIG.equipment[id];
  return {
    damage: e.damage,
    contactRadius: e.contactRadius,
    blast: {
      radius: e.blast.radius,
      inner: e.blast.inner,
      damage: e.blast.damage,
      power: e.blast.power,
    },
  };
}

/**
 * Resolves an AT item's config entry into the numbers the player and the
 * camera run on — the same `WeaponSetup` a rifle resolves to, so nothing
 * downstream of the holster has heard of this file.
 *
 * The constants below are the whole difference between an AT item and a gun,
 * and each of them is a statement rather than a placeholder:
 * - `damage`/`damageFar` are 0 and the fall-off band is degenerate, because
 *   nothing here fires a bullet. What an AT item is worth is
 *   `ordnanceEffect`, resolved at the detonation and never through
 *   `CombatSystem.fire`.
 * - `magSize` IS `carried`. There is no magazine and no reserve: the whole
 *   of a life's ammunition is in the hands, which is what makes the count on
 *   the HUD the number that matters.
 * - `reloadTime` is 0 and unreachable — `Player.startReload` refuses this
 *   slot, so a spent launcher is a spent launcher until the next life.
 * - `semiAuto` is true and `burst` is 1: one trigger pull is one rocket or
 *   one mine, and holding the button may never spend the second.
 * - the spreads are 0. A rocket goes where the tube points and a mine goes
 *   where the hands put it, so there is no cone for the reticle to lie about.
 */
export function equipmentSetup(id: EquipmentId): WeaponSetup {
  const e = CONFIG.equipment[id];
  const c = e.carry;
  return {
    id,
    name: e.name,
    short: e.short,
    damage: 0,
    damageFar: 0,
    falloffNear: 1,
    falloffFar: 1,
    fireRate: c.fireRate,
    semiAuto: true,
    burst: 1,
    burstCycle: 0,
    // Both AT items run a cooldown and NEITHER is a bolt. The launcher's is a
    // gesture and is played as one, but through `muzzleLoad` and
    // `Player.loadProgress` — a rocket going down a bore, which is a different
    // thing from an action being worked and has its own timeline.
    boltCycle: false,
    magSize: e.carried,
    reloadTime: 0,
    spreadHip: 0,
    spreadAds: 0,
    range: c.range,
    recoilMult: c.recoilMult,
    recoilImpulse: c.recoilImpulse,
    yawBias: c.yawBias,
    bloomMult: c.bloomMult,
    adsSpeedMult: c.adsSpeedMult,
    swayMult: c.swayMult,
    hipZ: c.hipZ,
    hipY: c.hipY,
    hipYaw: c.hipYaw,
    drawTime: c.drawTime,
    report: c.report,
    shotInterval: 1 / c.fireRate,
  };
}
