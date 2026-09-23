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
 * How much volumetric moonlight, as `off` plus one of
 * `CONFIG.graphics.volumetrics.rungs`.
 *
 * Derived from that table for the reason `RenderScale` is derived from its own
 * — the ladder is declared exactly once, and a value that is not on it cannot
 * be stored. `Volumetrics.ts` derives its own rung union from the same table
 * and neither module imports the other, so the config is the single answer to
 * what the rungs ARE and there is no second list to keep in step.
 *
 * **`off` is a fourth option and not a zeroed rung**: the pass comes off the
 * camera, because an attached but idle pass still reads and writes the whole
 * frame. That is the post chain's own rule — see `Game.setVolumetrics`.
 */
export type VolumetricQuality =
  | "off"
  | keyof typeof CONFIG.graphics.volumetrics.rungs;

/**
 * How much bounce light, as `off` plus one of `CONFIG.gi.tiers` — derived from
 * that table for `VolumetricQuality`'s reason. `off` takes the irradiance
 * volume out entirely (`systems/GiVolume.ts`) and puts back the flat ambient
 * and sky fill the cel shader always had.
 */
export type GiQuality = "off" | keyof typeof CONFIG.gi.tiers;

/**
 * How much shadow, as one of `CONFIG.graphics.shadowTiers` — the moon's maps
 * and the point lights' atlas together (`CONFIG.graphics.localShadows.tiers`
 * has a row per rung too, and the two tables must name the same rungs).
 * `off` is a rung of its own here rather than an extra option, because the
 * tables state what off MEANS per map.
 */
export type ShadowQuality = keyof typeof CONFIG.graphics.shadowTiers;

/**
 * A look-sensitivity multiplier, as one of `CONFIG.camera.lookScales`. Derived
 * from that list for the same reason `RenderScale` is derived from its own: the
 * ladder is declared once, and a value that is not on it cannot be stored.
 */
export type LookScale = (typeof CONFIG.camera.lookScales)[number];

/**
 * Where the touch movement stick is: born under the thumb wherever it lands
 * in the left zone (`floating`), or drawn at one spot in the corner and
 * measured from its centre (`fixed`).
 *
 * The two are listed in the order the screen draws them, and `floating` is
 * first because it is what shipped. See `TouchControls`' header for what each
 * one trades.
 */
export const TOUCH_STICKS = ["floating", "fixed"] as const;
export type TouchStick = (typeof TOUCH_STICKS)[number];

/**
 * When the phone's rotation turns the view: never, only with a sight up, or
 * all the time. The middle one is CoD Mobile's "While ADS", and it is the
 * gentle way in: the drag still does the big turns and the wrist only does
 * the fine work an aimed shot is made of.
 */
export const GYRO_MODES = ["off", "aiming", "always"] as const;
export type GyroMode = (typeof GYRO_MODES)[number];

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
   * The paper the world is drawn on, plus the vignette, the aberration and the
   * red damage flash painted by the same shader. Off detaches the pass.
   *
   * **It is stored as `filmGrain`, which is what this field used to be called**
   * — see `STORED_AS`. The pass did not change when the name did, so a player
   * who had turned it off is still the same player turning off the same thing.
   */
  paperGrain: boolean;
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
   * Light shafts: how many taps the volumetric march spends per ray, or `off`.
   *
   * The second field on this screen that is not a boolean, and the first that
   * is not a number either — which is what `oneOfString` below exists for.
   */
  volumetrics: VolumetricQuality;
  /**
   * Bounce light and sky occlusion — the irradiance volume's tier, or `off`.
   * Derived per MACHINE on a fresh install like the render scale: see
   * `defaultGiQuality`.
   */
  gi: GiQuality;
  /**
   * Shadows — the moon's three maps and the lamps' atlas, as one rung.
   * Derived per MACHINE on a fresh install: see `defaultShadowQuality`.
   */
  shadows: ShadowQuality;
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
  /**
   * Whether the touch movement stick floats or is fixed. See `TouchStick`.
   *
   * A setting rather than a decision because players split on it and neither
   * side is wrong: a floating stick is wherever the thumb is, and a fixed one
   * moves the body the instant a thumb lands off-centre, without a drag first.
   * Call of Duty Mobile and PUBG Mobile both ship the same toggle.
   */
  touchStick: TouchStick;
  /**
   * Whether the touch FIRE button raises the sight as well as pulling the
   * trigger (`CONFIG.touch.autoAds`). On foot only, and not for an item that
   * is set down rather than aimed (`CONFIG.equipment.*.sighted`) — `Game` works
   * that out each frame (`pushTouchControls`).
   *
   * Touch only. A mouse, a pad and a keyboard all have a finger free to aim
   * with; glass does not, which is why ADS is a latch there and why this
   * exists.
   */
  touchAutoAds: boolean;
  /**
   * Gyro aiming: whether, and when, the phone's own rotation turns the view
   * (`core/GyroInput.ts`, `CONFIG.touch.gyro`). In a vehicle too, where
   * "aiming" means the gunner's sight is up, because a setting that held on
   * foot and not in a turret would be a lie about one of the two views.
   *
   * NOT gated on touch being the device in hand: a phone with a pad clipped to
   * it is exactly who wants a gyro most.
   */
  touchGyro: GyroMode;
  /**
   * Gyro speed, as a multiplier on `CONFIG.touch.gyro.gain`, on the same
   * geometric ladder the three look speeds use.
   */
  gyroSensitivity: LookScale;
  /**
   * The frame profiler: `FrameProfile` recording the last few thousand frames,
   * and the chip that gets a capture off the device.
   *
   * **A setting rather than a dev gate, and that is the whole feature.** The
   * frame is draw-call bound on hardware nobody here owns, and the devices
   * worth measuring — a phone on a home screen, a tablet, somebody else's
   * laptop — are exactly the ones that will never run a dev server or open a
   * DevTools window. It is remembered like any other setting, so a capture
   * survives the reload it usually takes to reproduce something.
   *
   * It costs a ring (about 1.3 MB) and ~26 `performance.now()` pairs a frame
   * while it is on, and nothing at all while it is off.
   */
  profiler: boolean;
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
 * The bounce light a fresh install gets: the cheap tier on a device whose
 * primary pointer is a finger, the full one otherwise. A phone runs GPU work at
 * roughly 2.4x a desktop's cost (`FINDINGS.md` 43) and the volume is the one
 * feature here whose whole cost is GPU, so it starts where it is least likely
 * to be the thing that makes the frame late — and a player who wants more is
 * one row away.
 */
export function defaultGiQuality(): GiQuality {
  const coarse =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return coarse ? "low" : "high";
}

/**
 * The shadows a fresh install gets, on `defaultGiQuality`'s test and for its
 * reason: a finger for a pointer is a phone or a tablet, whose GPU runs this
 * frame at ~2.4x a desktop's cost, and the lamps' shadows are a depth pass per
 * face on top of the moon's.
 */
export function defaultShadowQuality(): ShadowQuality {
  const coarse =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return coarse ? "low" : "high";
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
  paperGrain: true,
  // **Medium, and it is the rung that costs what the pass it replaced cost.**
  // Measured against `GodRays`' own 32 taps at 1920x1080, 16 came back at
  // -0.010 ms of GPU on Hollowmere and -0.019 on Cinderhaven — inside the
  // noise either way, so a fresh install is not being handed a bill it did not
  // have. `CONFIG.graphics.volumetrics` carries the whole table and the caveat
  // that the old pass was detached most of a round and this one is not.
  volumetrics: "medium",
  gi: defaultGiQuality(),
  shadows: defaultShadowQuality(),
  renderScale: defaultRenderScale(),
  // 1 on both, and it is the one default that means "change nothing": the rates
  // in `CONFIG.camera` are what every other number there was tuned against.
  mouseSensitivity: 1,
  stickSensitivity: 1,
  touchSensitivity: 1,
  // Both at what shipped before they were settings: a player who never opens
  // the screen gets the controls they already know.
  touchStick: "floating",
  touchAutoAds: false,
  // Off: a view that moves when the phone does is a surprise to anyone who did
  // not ask for it, and on iOS turning it on raises a permission prompt.
  touchGyro: "off",
  gyroSensitivity: 1,
  // Off, for the reason the counter is: it is an instrument, not chrome — and
  // this one costs a megabyte of ring as well as a line of screen.
  profiler: false,
};

/** One key per field, so the fields are independent in the store as well. */
const KEY_PREFIX = "greywatch.setting.";

/**
 * Fields whose stored key is NOT their name, because the field was RENAMED and
 * what the player chose is still the same choice.
 *
 * A setting's key is its field name, which is what makes adding one free — and
 * it also means a rename silently forgets every player's answer. That is
 * sometimes right: `filmGrain` deliberately took a new key when it replaced the
 * horror filter, because what a player had turned off was a different effect.
 * It is wrong when only the NAME moved, which is this row: `paperGrain` is the
 * same pass doing the same thing, renamed because "film grain" described a film
 * running over the scene — the exact thing the world-pinned paper replaced.
 *
 * **So the question a rename has to answer is whether the EFFECT changed, and
 * this table is where the answer "no" is written down.** An entry is permanent:
 * it is the key that is already on players' machines, so it may never be tidied
 * to match the field it belongs to.
 */
const STORED_AS: Partial<Record<keyof Settings, string>> = {
  paperGrain: "filmGrain",
};

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
 * A codec over a fixed list of STRINGS — `oneOf`'s twin, and separate because
 * that one stringifies a number to compare and this one has nothing to do.
 * Both reject an unrecognised value rather than storing it, which is how a
 * setting written by a build with a different ladder degrades to its default.
 */
function oneOfString<T extends string>(allowed: readonly T[]): Codec<T> {
  return {
    read: (raw) => allowed.find((v) => v === raw) ?? null,
    write: (value) => value,
  };
}

/** `off` plus the config's rungs, in the order the screen draws them. */
const VOLUMETRIC_QUALITIES = [
  "off",
  ...(Object.keys(CONFIG.graphics.volumetrics.rungs) as (keyof typeof CONFIG.graphics.volumetrics.rungs)[]),
] as const;

/** `off` plus the volume's tiers, in the order the screen draws them. */
const GI_QUALITIES = [
  "off",
  ...(Object.keys(CONFIG.gi.tiers) as (keyof typeof CONFIG.gi.tiers)[]),
] as const;

/** The shadow rungs, in the order the screen draws them. */
export const SHADOW_QUALITIES = Object.keys(
  CONFIG.graphics.shadowTiers,
) as ShadowQuality[];

/**
 * One codec per field. The mapped type is the point: a field added to
 * `Settings` without an entry here does not compile, so the store can never
 * silently stop remembering something.
 */
const CODECS: { [K in keyof Settings]: Codec<Settings[K]> } = {
  fpsCounter: bool,
  motionBlur: bool,
  paperGrain: bool,
  renderScale: oneOf(CONFIG.graphics.renderScales),
  volumetrics: oneOfString(VOLUMETRIC_QUALITIES),
  gi: oneOfString(GI_QUALITIES),
  shadows: oneOfString(SHADOW_QUALITIES),
  mouseSensitivity: oneOf(CONFIG.camera.lookScales),
  stickSensitivity: oneOf(CONFIG.camera.lookScales),
  touchSensitivity: oneOf(CONFIG.camera.lookScales),
  touchStick: oneOfString(TOUCH_STICKS),
  touchAutoAds: bool,
  touchGyro: oneOfString(GYRO_MODES),
  gyroSensitivity: oneOf(CONFIG.camera.lookScales),
  profiler: bool,
};

function readRaw(key: keyof Settings): string | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + (STORED_AS[key] ?? key));
  } catch {
    // Private browsing and file:// both throw here. Defaults are fine.
    return null;
  }
}

function writeRaw(key: keyof Settings, raw: string): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + (STORED_AS[key] ?? key), raw);
  } catch {
    // Not being able to remember a setting is not worth failing over.
  }
}
