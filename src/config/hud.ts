/**
 * config/hud.ts — the gameplay chrome's own numbers.
 * Owns: the corner minimap and the directional damage arcs. Contract:
 * `docs/ui.md`.
 * Gotcha: the damage arcs are re-projected against the live view yaw every
 * frame — they are world-bearing, not screen-space.
 */

/**
 * The corner minimap: player-centred and heading-up, drawn from the same
 * collider data the deploy screen uses so the two can never disagree. The
 * whole-map, north-up picture is the deploy screen's; this one is local.
 * Enemies are hidden unless their own gunfire gives them away.
 */
export const minimap = {
  /**
   * The map's AUTHORED size in pixels, square — the one it was drawn for and
   * the one every constant below is stated against.
   *
   * It is no longer the canvas's size. The box is `--hud-map` in `base.css`,
   * which comes down with the viewport and again when the on-screen controls
   * want the corner, and `Minimap.resize` matches the backing store to it; this
   * is what that box is measured against to give `Minimap.k`, the scale the
   * plate's shapes follow down. Raising it therefore makes the map SMALLER
   * relative to its own furniture on every device but a desktop, which is not
   * what it reads like.
   */
  size: 220,
  /**
   * Metres from the player to the MID-EDGE of the canvas — half the map's
   * width across the picture, and the whole of the zoom. Raising it costs
   * nothing per frame but makes the prerendered backdrop bigger by the square
   * (`size / 2 / viewRange` pixels per metre over the play square), so a very
   * small number is the thing to be careful with, not a large one. Sixty is
   * `bots.perception.engageRange` (55) with five metres to spare, so the whole
   * band a bot will open fire from is inside the drawn square — which is the
   * read this map is for: everything that could already be shooting at me is
   * on it.
   */
  viewRange: 60,
  /** Seconds an enemy stays on the minimap after one of their shots. */
  enemyRevealTime: 2.2,
  /** The final stretch of a reveal, spent fading out (seconds). */
  enemyFadeTime: 0.6,
  /** Blip radii in canvas pixels. */
  friendlyRadius: 3,
  enemyRadius: 3.5,
  /**
   * The rim marker standing in for a control point the zoomed view does not
   * reach: the disc's radius, and how far in from the canvas edge its centre
   * is pinned. The pad has to clear the disc plus its chevron (6 px) or the
   * marker is cut off by the frame's chamfer.
   */
  edgeRadius: 7,
  edgePad: 14,
} as const;

/**
 * Battlefield-style directional damage arcs around the crosshair. A hit
 * records the *world* bearing to whoever fired it; the arc is re-projected
 * against the live view yaw every frame, so turning toward the shooter
 * swings their arc up to the top of the screen and off to the side again if
 * you turn past them. That is the whole point of the thing — an indicator
 * frozen in screen space tells you where you were looking, not where they
 * are.
 */
export const damageIndicator = {
  /** Seconds an arc lives, and the tail of that spent fading out. */
  life: 2.4,
  fadeTime: 1.4,
  /**
   * Two hits from within this many degrees of each other refresh one arc
   * instead of stacking two. A burst from one rifle is one threat; six
   * overlapping arcs would just read as a red ring.
   */
  mergeDegrees: 24,
  /** Most arcs alive at once; a new hit past this recycles the oldest. */
  maxArcs: 5,
  /** Damage that reads as a full-strength arc. One bot hit, by design. */
  fullDamage: 25,
  /** Opacity of the weakest and a full-strength arc. */
  minOpacity: 0.55,
  maxOpacity: 0.95,
} as const;
