/**
 * settings.ts — The player's settings and where they are remembered: what the
 * game looks like, and how fast it looks around.
 * Owns the `Settings` shape, its defaults and the localStorage round trip;
 * owns nothing that applies them (that is `Game.applySettings`).
 * Invariants: every field is read INDEPENDENTLY, so a key added later cannot
 * invalidate what an older build stored; storage throwing is never fatal, the
 * same tolerance `readDifficulty` and friends have in [`prefs.ts`](prefs.ts).
 */
import { CONFIG } from "../config";

/**
 * How much of the display's native resolution to render, as one of
 * `CONFIG.graphics.renderScales`. Derived from that list so the ladder is
 * declared exactly once and a value that is not on it cannot be stored.
 */
export type RenderScale = (typeof CONFIG.graphics.renderScales)[number];

/**
 * A look-sensitivity multiplier, as one of `CONFIG.camera.lookScales`. Derived
 * from that list for the same reason `RenderScale` is derived from its own: the
 * ladder is declared once, and a value that is not on it cannot be stored.
 */
export type LookScale = (typeof CONFIG.camera.lookScales)[number];

/**
 * One row on the settings screen. Mostly booleans; `renderScale` is the first
 * field that is not, and it is what the note this replaces was warning about.
 *
 * **What the widening actually cost**, since the old note guessed at it: not a
 * second control type on the screen (a toggle turned out to be a two-option
 * choice, so both render through one path), but the storage layer below, which
 * really was generic over the keys and not their types. It now carries a codec
 * per key, and the mapped type over `Settings` is what makes a new field a
 * compile error until it has one.
 */
export type Settings = {
  /** The frame-rate readout in the HUD's corner. */
  fpsCounter: boolean;
  /** The camera-rotation smear. Off detaches the pass, not just its effect. */
  motionBlur: boolean;
  /**
   * The horror grade — vignette, grain, aberration, and with them the red
   * damage flash, which is painted by the same shader. Off detaches the pass.
   */
  horrorGrade: boolean;
  /**
   * How much of the panel's native resolution the scene is drawn at.
   *
   * This is the one setting that was silently pinned before it existed. The
   * engine was built without `adaptToDeviceRatio`, so Babylon's hardware
   * scaling level stayed 1 and the backing store matched the CSS pixel grid —
   * which on any 2x display is a QUARTER of the panel's pixels, upscaled by the
   * compositor, with FXAA smoothing an already-soft image. Nothing in the tree
   * had ever called `setHardwareScalingLevel`.
   */
  renderScale: RenderScale;
  /**
   * Mouse look speed, as a multiplier on `CONFIG.camera.sensX`/`sensY`.
   *
   * The first setting that is not about the picture, and the reason the screen
   * grew a second section. It is a multiplier rather than a rate because the
   * two axes are a tuned ratio — see `CONFIG.camera.lookScales`.
   */
  mouseSensitivity: LookScale;
  /**
   * Gamepad look speed, as a multiplier on `CONFIG.camera.stickSensX`/`sensY`.
   *
   * Separate from the mouse's because the two devices are not the same setting
   * wearing two hats: a machine with a pad plugged in has both, and a player
   * who slows the stick down has said nothing about the mouse. Aim assist is
   * bounded as a fraction of the player's own turn rate, so this moves that
   * bound with it (`CameraSystem.stickYawRate`) rather than leaving the assist
   * able to out-turn a slowed stick.
   */
  stickSensitivity: LookScale;
  /**
   * Touch look speed, as a multiplier on `CONFIG.touch.lookSensX`/`lookSensY`.
   *
   * A third, for the reason there is a second: a machine can have all three
   * plugged in at once, and the one number a phone player changes first is this
   * one — every mobile shooter puts touch sensitivity at the top of its
   * settings because a thumb's comfortable travel varies more between people
   * and screen sizes than a mouse's does between desks. It bounds the aim
   * assist through `CameraSystem.touchYawRate`, exactly as the stick's does.
   */
  touchSensitivity: LookScale;
};

/**
 * The scale a fresh install starts at: the rung NEAREST the resolution the game
 * has always drawn at.
 *
 * `1 / devicePixelRatio` is the old behaviour expressed on this ladder — the
 * backing store used to match the CSS pixel grid — so on a 1x display that is
 * 1.0 and nothing changes at all, and on a 2x display it is 0.5, which is
 * exactly the frame that shipped. The sharpness is then one keypress away
 * rather than forced on a machine that has never been measured; `FINDINGS.md`
 * §1 is the reason that distinction matters.
 *
 * **NEAREST, and it used to be "largest rung at or below", which is a bug on
 * every fractional-DPI display there is.** `1 / dpr` is only ON this ladder for
 * dpr 1, 1.333 and 2. Everywhere else, rounding down takes the rung below —
 * and the gap between rungs is a third of the resolution, so the "safe"
 * direction is not safe at all. Measured on the display that reported it:
 * **dpr 1.4406 gives `1/dpr` = 0.694, rounded DOWN to 0.5, for a hardware
 * scaling level of 1.388 — 52% of the pixel count the game drew before the
 * setting existed**, upscaled by the browser. Every hard edge in a renderer
 * with no MSAA gets chunkier and crawls: it reads as lines flickering along the
 * viewmodel, the interior walls, the stair sides and every place two surfaces
 * meet, none of which changed. Rounding to the nearest rung bounds the error at
 * half a rung either way — the same display now takes 0.75, a level of 0.926
 * and 17% MORE pixels than shipped, which is a cost the player can spend one
 * keypress undoing, where blur is not.
 *
 * The ladder still cannot express `1/dpr` exactly, and that is the honest limit
 * of a three-rung setting. A fourth rung, or letting the default sit off the
 * ladder, is what "exactly what shipped, on every machine" would take;
 * `CONFIG.graphics.renderScales` is where that decision lives.
 *
 * A display past 2x has no rung near `1/dpr` either and takes the lowest one,
 * coming out sharper than before. That is the right way for the clamp to fail
 * and it only reaches phones — unchanged by this.
 */
export function defaultRenderScale(): RenderScale {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const want = 1 / dpr;
  const rungs = CONFIG.graphics.renderScales;
  let best: RenderScale = rungs[0];
  for (const rung of rungs) {
    if (Math.abs(rung - want) < Math.abs(best - want)) best = rung;
  }
  return best;
}

/**
 * What a fresh install gets.
 *
 * The blur's default is derived from `CONFIG` rather than restated, so the
 * config stays the single answer to "does this effect ship on" — its own note
 * already documents 0 as the disabled value. The counter is off because it is
 * an instrument, not chrome. The grade is the plain `true` the other two are
 * not: it is three independent terms with no single number that disables it,
 * so deriving would mean inventing a fourth that the shader does not read.
 *
 * The scale is derived too, but from the MACHINE rather than from `CONFIG` —
 * see `defaultRenderScale`. It is therefore the one default that is not the
 * same on every install, which is the point of it.
 */
export const SETTING_DEFAULTS: Settings = {
  fpsCounter: false,
  motionBlur: CONFIG.graphics.motionBlur.strength > 0,
  horrorGrade: true,
  renderScale: defaultRenderScale(),
  // 1 on both, and it is the one default that means "change nothing": the rates
  // in `CONFIG.camera` are what every other number there was tuned against.
  mouseSensitivity: 1,
  stickSensitivity: 1,
  touchSensitivity: 1,
};

/** One key per field, so the fields are independent in the store as well. */
const KEY_PREFIX = "greywatch.setting.";

/**
 * Reads every field on its own, falling back per field.
 *
 * A single JSON blob would have been shorter and is the trap: the settings
 * list is expected to grow, and a blob written by today's build is missing
 * tomorrow's key — which reads back as `undefined` and quietly turns a
 * defaulted-on setting off. Per-key storage means an unknown key is simply
 * absent and takes its default.
 */
export function readSettings(): Settings {
  const out = { ...SETTING_DEFAULTS };
  for (const key of Object.keys(out) as (keyof Settings)[]) {
    const raw = readRaw(key);
    if (raw === null) continue;
    // Each codec is free to reject: an unrecognised string leaves the default
    // in place, which is how a value written by a build with a different ladder
    // degrades instead of poisoning the setting.
    const parsed = CODECS[key].read(raw);
    if (parsed !== null) out[key] = parsed as never;
  }
  return out;
}

/** Writes every field. Cheap enough to do wholesale on each change. */
export function writeSettings(settings: Settings): void {
  for (const key of Object.keys(settings) as (keyof Settings)[]) {
    writeRaw(key, CODECS[key].write(settings[key] as never));
  }
}

/**
 * How one field survives a round trip through `localStorage`.
 *
 * The store is still one key per field — the invariant this file opens with —
 * so what a codec owns is only the string in that key, and a field can change
 * its encoding without touching any other.
 */
interface Codec<T> {
  /** Returns null for anything this build does not recognise. */
  read(raw: string): T | null;
  write(value: T): string;
}

const bool: Codec<boolean> = {
  read: (raw) => (raw === "1" ? true : raw === "0" ? false : null),
  write: (value) => (value ? "1" : "0"),
};

/**
 * A codec over a fixed list of numbers — the tolerance `readMap` and
 * `readSight` in [`prefs.ts`](prefs.ts) have for a stored id this build has
 * never heard of, which is the same problem.
 */
function oneOf<T extends number>(allowed: readonly T[]): Codec<T> {
  return {
    read: (raw) => allowed.find((v) => String(v) === raw) ?? null,
    write: (value) => String(value),
  };
}

/**
 * One codec per field. The mapped type is the point: a field added to
 * `Settings` without an entry here does not compile, so the store can never
 * silently stop remembering something.
 */
const CODECS: { [K in keyof Settings]: Codec<Settings[K]> } = {
  fpsCounter: bool,
  motionBlur: bool,
  horrorGrade: bool,
  renderScale: oneOf(CONFIG.graphics.renderScales),
  mouseSensitivity: oneOf(CONFIG.camera.lookScales),
  stickSensitivity: oneOf(CONFIG.camera.lookScales),
  touchSensitivity: oneOf(CONFIG.camera.lookScales),
};

function readRaw(key: keyof Settings): string | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + key);
  } catch {
    // Private browsing and file:// both throw here. Defaults are fine.
    return null;
  }
}

function writeRaw(key: keyof Settings, raw: string): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + key, raw);
  } catch {
    // Not being able to remember a setting is not worth failing over.
  }
}
