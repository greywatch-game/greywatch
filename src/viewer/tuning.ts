/**
 * viewer/tuning.ts — Constants for the dev-only map viewer.
 * Owns: the fly camera's speeds, the plan's size, and the overlay and mark
 * colours.
 *
 * Deliberately NOT in src/config/, for the editor's reason (`editor/tuning.ts`,
 * whose camera block and colours these are, copied while the editor stands
 * beside the viewer as its oracle, `BABYLON_EXIT.md` X5.3b): that directory
 * owns gameplay tunables, and nothing here reaches the shipped game — the
 * viewer is dev-only and dynamically imported, so these values never load in a
 * production build.
 */

export const VIEWER = {
  camera: {
    /** Metres per second at the default speed step. */
    baseSpeed: 22,
    /** Multiplier while the sprint key is held. */
    boost: 3.5,
    /** Wheel steps scale the base speed by this factor, clamped below. */
    speedStep: 1.25,
    minSpeed: 2,
    maxSpeed: 160,
    /** Radians per pixel of mouse movement, matching the gameplay feel. */
    lookSensitivity: 0.0022,
    /** Vertical look clamp, short of straight up/down so the horizon stays readable. */
    maxPitch: 1.45,
    /** Frame-lerp rate for velocity smoothing; see the CLAUDE.md dt idiom. */
    damping: 14,
  },

  /**
   * Where a click on the plan, or a finding, puts the camera: this far above
   * the floor and this far back along -Z, pitched down by `pitch`, so the spot
   * is in frame rather than inside the camera. The editor's `goTo` numbers.
   */
  standOff: { up: 18, back: 22, pitch: -0.6 },

  /** The plan's side in CSS pixels; its backing store is this times the DPR, capped at 2. */
  planSize: 296,

  /** Overlay and mark colours. The editor's, so the two read alike. */
  colors: {
    scatter: "#ffc46b",
    controlPoint: "#ffe680",
    spawnFriendly: "#ffc46b",
    spawnEnemy: "#ff5a4f",
    water: "#4fb8ff",
    grass: "#7fd66a",
    camera: "#ffffff",
    navWalkable: "#4fd06a",
    navIsland: "#ff5a4f",
    navUnrouted: "#ffc46b",
  },

  /**
   * How hard each nav bucket is painted on the plan, 0..255. The editor drew
   * green at 0.16 over a lit world; on a plan of the same ground it would bury
   * the thing it is there to show, so the walkable wash stays thin and the
   * finding — red — is drawn hardest, as it was in the world.
   */
  navAlpha: { walkable: 70, unrouted: 150, island: 235 },
} as const;
