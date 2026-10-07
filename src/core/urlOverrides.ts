/**
 * urlOverrides.ts — The boot flags on the page's URL that override a display
 * setting for the whole session: `?gi=`, `?shadows=`, `?volumetrics=` and
 * `?nominimap`.
 * Owns: reading them once, validating each against its own table, the rule
 * that an override BEATS the setting it shadows, and the list of which ones a
 * capture must say were forced. Owns the URL-flag reader `FrameProfile` uses
 * for `?gpu` too, so there is one place that knows a URL can throw.
 * Owns NOTHING that applies them: the module reads, `Game` spends — the shape
 * `prefs.ts` has with the store. Every method that resolves a value is handed
 * the setting rather than reading it, so the store and the screen stay
 * `Game`'s.
 * Invariants: read ONCE, at construction, and never re-read — an override is
 * for a SESSION, which is what lets a measurement run in a fresh profile with
 * no `localStorage` to write a setting into. A value that names no rung is
 * ignored rather than trusted, exactly as `prefs.ts` treats an id from the
 * store.
 * Never: write a setting, touch a system, or decide anything a player could
 * be offered — `?nominimap` is a flag precisely because losing the map is not
 * a setting.
 */
import { isVolumetricRung, type VolumetricRung } from "../shaders/Volumetrics";
import {
  type GiQuality,
  SHADOW_QUALITIES,
  type ShadowQuality,
  type VolumetricQuality,
} from "./settings";

/**
 * One parameter off the page's URL, or null. Never throws: a page with no
 * `location` to read (a worker, a test harness) has no flags on it.
 */
function urlParam(name: string): string | null {
  try {
    return new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}

/** Whether a bare flag (`?profile`, `?gpu`) is on the URL. Never throws. */
export function urlFlag(name: string): boolean {
  try {
    return new URLSearchParams(location.search).has(name);
  } catch {
    return false;
  }
}

export class UrlOverrides {
  /**
   * `?gi=off|low|high`. Overrides the setting for the session, for the reason
   * every row here does: a measurement runs in a fresh profile with nothing
   * stored.
   */
  private readonly giForced: GiQuality | null;
  /**
   * `?shadows=off|low|medium|high`, on the same terms — a capture that
   * compares rungs is taken in a fresh profile with nothing stored.
   */
  private readonly shadowsForced: ShadowQuality | null;
  /**
   * `?volumetrics=<rung>` — the same relationship `?profile` has with
   * `Settings.profiler`, and for the same reason.
   */
  private readonly volumetricsForced: VolumetricRung | null;
  /**
   * `?nominimap` — the corner map is not drawn at all, for the A/B in
   * FINDINGS.md 13: it is the one piece of chrome redrawn in full on every
   * frame (a Canvas2D blit, its marks, and the CSS drop shadow under it
   * re-applied because the canvas changed), and that is raster and compositor
   * work no span in the profiler can see. A flag and never a setting, because
   * the map is not something a player should be offered to lose; recorded in
   * every capture as `graphics.minimap`.
   */
  readonly minimap: boolean;
  /**
   * Which of the above the URL set, by the name a capture files it under —
   * `graphics.forced`, so a report off a device nobody here owns says which of
   * its numbers were somebody's experiment rather than the player's choice.
   */
  readonly forced: readonly string[];

  constructor() {
    const gi = urlParam("gi");
    this.giForced = gi === "off" || gi === "low" || gi === "high" ? gi : null;
    const shadows = urlParam("shadows");
    this.shadowsForced = (SHADOW_QUALITIES as readonly string[]).includes(
      shadows ?? "",
    )
      ? (shadows as ShadowQuality)
      : null;
    const volumetrics = urlParam("volumetrics");
    this.volumetricsForced =
      volumetrics !== null && isVolumetricRung(volumetrics) ? volumetrics : null;
    this.minimap = !urlFlag("nominimap");
    const forced: string[] = [];
    if (this.giForced) forced.push("gi");
    if (this.shadowsForced) forced.push("shadows");
    if (this.volumetricsForced) forced.push("volumetrics");
    if (!this.minimap) forced.push("minimap");
    this.forced = forced;
  }

  /** The irradiance tier in force: the URL's for a session, else the setting. */
  gi(setting: GiQuality): GiQuality {
    return this.giForced ?? setting;
  }

  /** The shadow rung in force: the URL's for a session, else the setting. */
  shadows(setting: ShadowQuality): ShadowQuality {
    return this.shadowsForced ?? setting;
  }

  /**
   * Which shaft rung should be BUILT for a setting — `?volumetrics=` first,
   * the player's choice otherwise, and null for off.
   */
  volumetrics(setting: VolumetricQuality): VolumetricRung | null {
    if (this.volumetricsForced) return this.volumetricsForced;
    return setting === "off" ? null : setting;
  }
}
