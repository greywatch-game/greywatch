/**
 * editor/tuning.ts — Constants for the map editor tool.
 * Owns: fly speeds, snap sizes, overlay and proxy colours.
 *
 * Deliberately NOT in src/config/. That directory owns gameplay tunables — things
 * that change how the game plays and that a designer balances. Nothing here
 * reaches the shipped game: the editor is dev-only and dynamically imported, so
 * these values never load in a production build.
 *
 * Snap defaults are not arbitrary: layout hygiene says structures are
 * axis-aligned with rotY in multiples of PI/2, so that is what the rotation
 * gizmo snaps to unless the free modifier is held.
 */

export const EDITOR = {
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
   * How long a param edit waits before the map is rebuilt, in milliseconds.
   *
   * A rebuild is the whole map (~570 ms measured headless, far less on real
   * hardware), and a number spinner held down emits a change per repeat. Long
   * enough to swallow a burst of keystrokes, short enough that letting go and
   * looking up shows the result.
   */
  rebuildDelay: 200,

  /** A path road's point handles. */
  path: {
    /**
     * A handle's radius per metre of distance from the camera, floored at
     * `minRadius`. A fixed size is either a boulder at your feet or a speck on
     * a road a street away; scaled, it stays about the same size on screen.
     */
    radiusPerMetre: 0.011,
    minRadius: 0.45,
    /** An insert handle is this much smaller than a point. */
    insertScale: 0.7,
    /** How far past an end the extend handle stands, as road widths. */
    extendWidths: 2,
    /** The drawn lines' width in metres, and their lift off the floor. */
    lineWidth: 0.35,
    lineLift: 0.25,
  },

  snap: {
    /** Position snap in metres. */
    position: 0.5,
    /** Rotation snap — the layout's axis-aligned rule. */
    rotation: Math.PI / 2,
  },

  /** Proxy and overlay colours. Emissive, so they read against the night grade. */
  colors: {
    selection: "#35f0ff",
    scatter: "#ffc46b",
    controlPoint: "#ffe680",
    spawnFriendly: "#ffc46b",
    spawnEnemy: "#ff5a4f",
    water: "#4fb8ff",
    grass: "#7fd66a",
    terrain: "#c58cff",
    /** The level brush. Distinct from the sculpt violet: which tool is armed
     *  changes what a drag does, so it has to be readable at the cursor. */
    terrainLevel: "#ff9ad5",
    /** A path road's points, and the one the gizmo is on. */
    pathPoint: "#ffffff",
    pathPointSelected: "#35f0ff",
    /** The `+` handles that insert a point, between two or past an end. */
    pathInsert: "#7fd66a",
    /** The authored polyline between the points. */
    pathControl: "#ffffff",
    /** The centreline the builder will draw, bends and all. */
    pathCurve: "#35f0ff",
    navWalkable: "#4fd06a",
    navIsland: "#ff5a4f",
    navUnrouted: "#ffc46b",
  },
} as const;
