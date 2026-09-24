/**
 * throwables.ts — The throwable slot's two items, as a type and as the few
 * numbers everything that is not `GrenadeSystem` reads about them.
 * Owns: `ThrowableId`, the order the kit row shows them in, the default, and
 * the per-item name and pouch size. Nothing else may decide how many a life
 * carries — the player, the bots and the authority all ask `throwableCarried`.
 * Invariants: holds no state and no geometry (the models are `GrenadeModel`'s
 * and `MolotovModel`'s), imports nothing but `CONFIG`, and every reader of a
 * stored or wired id goes through `isThrowableId` before indexing anything.
 *
 * **One pouch, two things it can hold, never both** — the anti-tank slot's
 * bargain (`equipment.ts`) made about the off hand. The frag is a moment and
 * the molotov is a place, and a player who could carry both would never have
 * to decide which one a doorway wants.
 *
 * It is a union written out rather than derived from a config table, which is
 * the difference from `EquipmentId`: the two items' numbers live in two config
 * modules (`CONFIG.grenade` is the frag and the reference for every blast in
 * the game; `CONFIG.molotov` is the other), because they share almost nothing
 * but the arc they are thrown on. `THROWABLES` below is the `Record` that makes
 * a third item not compile until it has said what it is called and how many a
 * life carries.
 */
import { CONFIG } from "../config";

/** What the throwable slot holds. */
export type ThrowableId = "frag" | "molotov";

/** Per item: what the kit screen and the HUD call it, and a life's pouch. */
interface ThrowableInfo {
  readonly name: string;
  readonly short: string;
  readonly carried: number;
}

const THROWABLES: Record<ThrowableId, ThrowableInfo> = {
  frag: CONFIG.grenade,
  molotov: CONFIG.molotov,
};

/** In screen order — the kit row, and what the cycle keys step through. */
export const THROWABLE_IDS: readonly ThrowableId[] = ["frag", "molotov"];

/** The default pick: the frag, which is what everybody carried before there was a choice. */
export const DEFAULT_THROWABLE: ThrowableId = "frag";

export function isThrowableId(value: unknown): value is ThrowableId {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(THROWABLES, value);
}

/** How many one life carries. Death is the only resupply, for both. */
export function throwableCarried(id: ThrowableId): number {
  return THROWABLES[id].carried;
}

export function throwableName(id: ThrowableId): string {
  return THROWABLES[id].name;
}

/** The HUD's caption over the pouch, where the full name will not fit. */
export function throwableShort(id: ThrowableId): string {
  return THROWABLES[id].short;
}
