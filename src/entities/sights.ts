/**
 * sights.ts — The optics the rifle can be fitted with, as a type and as the
 * resolved numbers everything downstream reads.
 * Owns: the derivation from `CONFIG.sights[id].magnification` to an aimed FOV,
 * a look-sensitivity multiplier and the viewmodel's zoom compensation. Nothing
 * else may re-derive those — CameraSystem and ViewModel must agree on them or
 * the reticle stops being the point of impact.
 * Invariants: `SightId` is derived from the CONFIG table, so the table is the
 * only place a sight is declared. Holds no state and no geometry: the optic
 * meshes are RifleModel's, and which one is fitted is Game's.
 */
import { CONFIG } from "../config";

/**
 * An optic. Derived from the config table rather than written out, so the two
 * cannot drift and a new sight is one entry plus one builder.
 */
export type SightId = keyof typeof CONFIG.sights;

/** In screen order — the loadout row, and what the cycle keys step through. */
export const SIGHT_IDS = Object.keys(CONFIG.sights) as SightId[];

export function isSightId(value: string): value is SightId {
  return Object.prototype.hasOwnProperty.call(CONFIG.sights, value);
}

/** The default fit: the sight the weapon shipped with. */
export const DEFAULT_SIGHT: SightId = "holo";

/** Everything a fitted sight changes, resolved once when it is fitted. */
export interface SightSetup {
  id: SightId;
  name: string;
  magnification: number;
  /** Vertical FOV while fully aimed (radians). */
  fovAds: number;
  /** ADS multipliers on the hip-fire look rates. */
  mouseMult: number;
  stickMult: number;
  /** How fast the hip<->ADS blend converges through this optic (per second). */
  blendSpeed: number;
  /** Distance from the eye to the sight's own centre when aimed (m). */
  eyeRelief: number;
  /**
   * Uniform scale applied to the whole viewmodel while aimed, cancelling the
   * part of the magnification past `viewmodel.adsMagReference`. 1 for anything
   * at or below the reference. See that field for why this is safe.
   */
  zoomComp: number;
}

/**
 * Resolves a sight's config entry into the numbers the camera and the
 * viewmodel run on. Called when the loadout changes, never per frame — the
 * `Math.atan` here is not the point, the single source of truth is.
 */
export function sightSetup(id: SightId): SightSetup {
  const s = CONFIG.sights[id];
  const c = CONFIG.camera;
  const mag = s.magnification;
  return {
    id,
    name: s.name,
    magnification: mag,
    // Magnification is a ratio of tangents, not of angles: halving the FOV in
    // radians is not doubling the zoom, and at 3.5x the difference is the
    // whole picture.
    fovAds: 2 * Math.atan(Math.tan(c.fovHip / 2) / mag),
    mouseMult: c.adsLookMouse / mag,
    stickMult: c.adsLookStick / mag,
    blendSpeed: c.adsBlendSpeed * s.adsSpeedMult,
    eyeRelief: s.eyeRelief,
    zoomComp: Math.min(1, CONFIG.viewmodel.adsMagReference / mag),
  };
}
