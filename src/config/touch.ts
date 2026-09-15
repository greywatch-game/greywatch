/**
 * config/touch.ts — the on-screen controls a phone plays with: the movement
 * stick's shape, what a drag does to the aim, and how long a synthesized mouse
 * event is disbelieved after a finger.
 * Owns: everything about the TOUCH device, look sensitivity included. That last
 * one sits here rather than beside `camera.sensX` deliberately — the rule is one
 * module per subsystem, and the subsystem here is a device, the same way
 * `input.ts` owns the pad's deadzones rather than `camera.ts` owning them.
 * Gotcha: two of what the device does are the PLAYER's rather than this
 * table's, because players split on them: whether the stick floats or is
 * fixed (`Settings.touchStick`) and whether FIRE also aims
 * (`Settings.touchAutoAds`). The numbers each one runs on are here.
 * Gotcha: `stickRadius` is drawn as well as read. `TouchControls` publishes it
 * as a CSS custom property so the ring on screen and the deflection the maths
 * computes cannot drift apart — the same rule the minimap's backing store
 * follows. Change it here and nowhere else.
 */

export const touch = {
  /**
   * The share of the viewport width that answers as the movement stick.
   *
   * Every mobile shooter splits the screen this way and it is not a style
   * choice: the look drag has to be able to start anywhere the buttons are
   * not, so the two halves are what keep a thumb reaching for the stick from
   * spinning the camera. A shade under half, because the right thumb does more
   * — it looks, fires and reaches the button cluster — and the left one only
   * walks.
   */
  moveZone: 0.45,
  /**
   * How far the thumb travels from where it landed for full deflection, in CSS
   * pixels, and the radius the ring is drawn at.
   *
   * By default the stick FLOATS: the ring is born under the thumb rather than
   * sitting in a fixed corner, so this is a distance from the touch-down point
   * and never a position on screen. That is what makes one number right on a 5"
   * phone and a 13" tablet alike, and it is why nothing here is expressed as a
   * fraction of the viewport. A FIXED stick's position is `touch.css`'s, and
   * the maths measures it off the ring rather than restating it.
   */
  stickRadius: 58,
  /**
   * How far from a FIXED stick's centre a touch still claims it, as a multiple
   * of `stickRadius`. The floating stick has no such number: it is born under
   * the thumb wherever that lands.
   *
   * Generous, because a thumb looking for a fixed ring lands by feel and a
   * touch that misses reads as a stick that has stopped working. Not the whole
   * zone, because a fixed stick measures from its CENTRE and not from where
   * the thumb came down (`Settings.touchStick`) — a touch half a screen above
   * the ring would be full forward and a sprint the player never asked for.
   * 2.2 is a 255 px circle a thumb can hardly miss, and a touch beyond it does
   * nothing rather than turning the view, for the reason the zones split the
   * screen at all.
   */
  fixedReach: 2.2,
  /**
   * Deflection under which the stick reads as centred, as a fraction of the
   * radius.
   *
   * Smaller than the pad's (`CONFIG.input.deadzone`, 0.18) because a thumb on
   * glass does not spring back to a centre it can drift away from — there is no
   * resting deflection to reject, only the wobble of a thumb that means to
   * stand still.
   */
  stickDeadzone: 0.12,
  /**
   * Forward deflection that starts a sprint, and the one it stops at.
   *
   * Pushing the stick to its limit is how every mobile shooter asks to run
   * (CoD Mobile calls the setting "Joystick Sprint"), and it is the right shape
   * here for the reason the pad latches L3 rather than holding it: a 240 m
   * crossing is longer than a thumb wants to hold anything. The pair is
   * hysteresis and the gap between them is the whole point — one threshold
   * makes a thumb resting at the rim flicker between running and walking, which
   * costs a sprint's spin-up on every flicker.
   */
  sprintPush: 0.88,
  sprintDrop: 0.62,
  /**
   * Radians of aim per CSS pixel of drag.
   *
   * The same unit the mouse's `CONFIG.camera.sensX` is in, and a little faster
   * than it: a thumb has a screen's width to work with where a mouse has a
   * desk. Tuned so a drag across the full width of a landscape phone turns
   * about 135 degrees — far enough to answer something behind you in one
   * confident swipe, short enough that the small corrections a fight is
   * actually made of still land.
   */
  lookSensX: 0.003,
  lookSensY: 0.0027,
  /**
   * The drag speed (CSS pixels per second) that counts as a full swipe.
   *
   * It exists for the aim assist and nothing else. The assist bounds its own
   * rotation as a fraction of the rate the PLAYER can turn at, which for a
   * stick is simply full deflection — a drag has no full deflection, so this
   * stands in for one. See `CameraSystem.touchYawRate`.
   */
  swipeReference: 1200,
  /**
   * The per-frame drag, in CSS pixels, that counts as a committed push against
   * the aim assist.
   *
   * The assist's third invariant is that a committed input always beats it, and
   * for the stick that is expressed in deflection. This is the same quantity in
   * the units a drag has. At 60 fps it is a swipe of ~840 px/s — a deliberate
   * flick, not the drift of a thumb holding an aim.
   */
  cancelDrag: 14,
  /**
   * Aim on fire (`Settings.touchAutoAds`): the fire button raises the sight
   * as well as pulling the trigger, the way every gun in Call of Duty Mobile's
   * advanced mode is set up out of the box. It exists because ADS is a
   * latch here: a phone player has no spare thumb to tap it before every fight.
   */
  autoAds: {
    /**
     * How far up the sight has to be before the trigger is let through, as
     * `CameraSystem.adsBlend`.
     *
     * **Firing the moment the button goes down wastes the round.** Hip spread is
     * 7.5x the aimed figure on the rifle and nearly 90x on the bolt gun, and
     * hip fire has no crosshair here, so a round fired as the sight starts to
     * rise is unaimed. Spread scales with the blend, so this is also the share
     * of the hip-to-aimed difference already gone. 0.8 is ~140 ms for the
     * rifle under a reflex sight and ~520 ms for the bolt gun under the 6x,
     * which is each pairing's own ADS cost, paid once at the start of a burst
     * rather than on every round.
     */
    fireAt: 0.8,
    /**
     * Seconds the sight stays up after the fire button is let go.
     *
     * Without it a semi-automatic is unusable: the DMR's gap between rounds is
     * 286 ms, and a sight that dropped on every lift would come back down and
     * go back up between taps, making the player wait for it on every round.
     */
    linger: 0.4,
  },
  /**
   * How long after a finger a mouse event is disbelieved, in seconds.
   *
   * A touch on a page raises a `pointerdown` and then, a moment later, a
   * SYNTHESIZED `mousedown`/`mousemove` pair for the benefit of pages written
   * before touch existed. Without this window every tap on the fire button
   * would look like a mouse arriving, the controls would take themselves off
   * screen, and the round would be handed to a device that is not there. The
   * layer calls `preventDefault` — which suppresses the compatibility events
   * where it is honoured — and this is the belt to that pair of braces.
   */
  mouseGrace: 1.2,
} as const;
