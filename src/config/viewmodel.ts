/**
 * config/viewmodel.ts — where the weapon sits in front of the camera.
 * Owns: the pose stack — hip/aim offsets, bob, sway, the lower and the
 * holsters. Contract: `docs/weapons.md`.
 * Gotcha: all values are CAMERA-LOCAL and in rifle-model units. The aimed
 * pose is DERIVED from the fitted sight, never authored here.
 */

/**
 * The first-person weapon: where the rifle sits in front of the camera, and
 * everything that moves it there. All positions/rotations are CAMERA-LOCAL
 * (+x right, +y up, +z forward) and in rifle-model units — the viewmodel
 * node carries `scale`, so the rifle's own local coordinates and these
 * offsets are in the same frame.
 *
 * The aimed stand-off is NOT here — it is `sights[id].eyeRelief`, and it is
 * the one number that must not be treated as art direction: ViewModel
 * derives the aimed position from it so the fitted sight's own centre lands
 * exactly on the camera axis, which is where the bullets go. Move the sight
 * off that axis and the reticle stops being the point of impact.
 */
export const viewmodel = {
  /**
   * Scale and stand-off together decide how much of the frame the rifle
   * eats. At full size half a metre from the lens it is a wall: this is a
   * 54° vertical FOV against a real eye's ~130°, so a viewmodel framed the
   * way a rifle actually sits fills the screen. Shrunk and pushed out, it
   * reads at the size the eye expects.
   */
  scale: 0.62,
  /**
   * The magnification the weapon is FRAMED at. Aiming narrows the FOV, and
   * a narrower FOV magnifies the rifle along with the world — harmless at
   * the holo's 1.6x, and at 3.5x a receiver across the whole screen. Past
   * this reference the viewmodel is scaled down and drawn in proportionally
   * closer, which is a uniform scale about the camera's own origin: it
   * changes no ray direction, so the sight picture and the point of impact
   * are untouched and only the apparent size of the weapon is held still.
   * Set it to the largest magnification on offer to disable the whole
   * mechanism.
   */
  adsMagReference: 1.6,
  /** Hip-fire pose: sight ~30% right and ~22% down, muzzle turned inboard. */
  hipPos: { x: 0.184, y: -0.185, z: 0.66 },
  hipRot: { x: 0.03, y: -0.08, z: 0.06 },
  /**
   * Sprint: the rifle carried ACROSS the body, muzzle swung inboard and
   * canted, reading as a diagonal through the lower right of the frame.
   *
   * The yaw sign is the whole pose. Babylon is left-handed, so a positive
   * `rotY` takes the barrel (+z) toward +x — outboard, away from the
   * shooter. That is a rifle held out to one side at arm's length: it
   * reads as broken rather than as running, and it swings the weapon off
   * the edge of the screen so only the optic is left. Inboard is negative.
   *
   * The drop is small on purpose. `hipPos.y` is already -0.185, so an
   * offset much past this lands near -0.3 and sinks the whole weapon out
   * of frame — the same symptom, from the other axis.
   */
  sprintPos: { x: -0.01, y: -0.05, z: -0.03 },
  sprintRot: { x: 0.2, y: -0.4, z: 0.3 },
  /**
   * Reload: the weapon held at about the height it is carried at, pulled in a
   * little, and CANTED so the magwell rolls over toward the support hand.
   *
   * **It is a ROTATION, not a lift, and that is the whole shape of it.** A
   * rifle is not hoisted in front of the face to change a magazine — it is
   * canted at the shoulder and worked by feel — so the roll is what puts the
   * magwell where the eye can find it while the weapon stays roughly where it
   * is being held. An earlier pass raised it far enough to frame the magazine
   * dead centre; it looked staged at the hip and it put a receiver across the
   * middle of the screen on an aimed reload, which is the one place a weapon
   * must never end up.
   *
   * **The roll's SIGN carries it, and it was once the wrong way round.** A
   * positive `rotZ` takes the weapon's right flank UP (the +x axis rotates
   * toward +y), which tips the top inboard and swings the underside out to the
   * right — away from a camera that sits to the LEFT of a weapon carried at
   * `hipPos.x`. That is a reload presenting the magwell to nobody, and it reads
   * as the weapon being held out at an angle rather than worked on. Negative
   * rolls the underside toward the camera and carries the magwell inboard, to
   * the side the support hand comes from, which is the same direction a
   * right-handed shooter cants a rifle to change magazines.
   *
   * The pitch is small and positive (nose-down, see `recoil.kickPitch`): a
   * muzzle that stays level reads as the weapon being presented rather than
   * worked on, and one much lower takes the magwell down with it.
   */
  reloadPos: { x: 0.01, y: 0.015, z: -0.02 },
  reloadRot: { x: 0.12, y: -0.2, z: -0.45 },
  /**
   * The reload, as a TIMELINE rather than as a pose held for the duration.
   * Everything here is a fraction of `weapons[id].reloadTime`, which is what
   * lets one set of numbers carry a 1.05 s sidearm and a 3.4 s machine gun:
   * the beats keep their proportions and the weapon that takes three times as
   * long takes three times as long over every part of it.
   *
   * **The first three are `Sfx.reload`'s clacks and must move with them.** That
   * sound is four metallic events — catch, magazine out, fresh magazine seated,
   * bolt — and the whole reason the gesture is legible is that what you SEE
   * lands on what you HEAR. A magazine that falls half a beat after the clack
   * that released it reads as two unrelated things happening at once, which is
   * exactly what the old hold-one-pose reload looked like with the sound over
   * it. Change a fraction in either file and change it in both.
   *
   * The order the beats run in:
   * - `0` — the catch. The weapon tips out of the aim and the support hand
   *   leaves the handguard for the magwell.
   * - `magOut` — the magazine is released and falls free, out of the bottom of
   *   the frame under `dropDist`/`dropTumble` while the hand carries on down
   *   after a fresh one.
   * - `[insertFrom, magSeat]` — the fresh magazine rises back into frame WITH
   *   the hand, rocked nose-first into the well, arriving exactly on the seat.
   * - `magSeat` — it is slapped home: `seatKick` is the weapon taking that.
   * - `bolt` — the bolt goes forward and the weapon settles back to the carry.
   */
  reload: {
    /** The magazine falls free. `Sfx.reload`'s second clack. */
    magOut: 0.18,
    /** The fresh magazine is seated. `Sfx.reload`'s third clack. */
    magSeat: 0.55,
    /** The bolt goes forward. `Sfx.reload`'s fourth and last clack. */
    bolt: 0.8,
    /**
     * The weapon's tip out of the carry and back into it. The return starts
     * on the bolt and finishes just short of the end, because the round the
     * player is waiting for is fired from the carry: a weapon still coming
     * level on the frame the magazine refills is a reload that lied about
     * when it ended.
     */
    tiltIn: 0.14,
    tiltOut: [0.8, 0.97],
    /**
     * How much of the AIM the gesture takes away, on the same weight as the
     * tilt: 1 puts the weapon all the way back to the carry pose for the
     * duration, 0 reloads it wherever the aim left it.
     *
     * This is the half of the pose that only shows up while aimed, and it is
     * the realistic half rather than a concession. A shouldered weapon comes
     * down to be reloaded — nobody changes a magazine through their optic —
     * and geometrically an aimed weapon is ON the camera axis, so a reload
     * pose applied there swings the receiver across the middle of the screen
     * whatever direction it moves in. Breaking the aim first means the aimed
     * reload is the hip reload, off to the side where it belongs, and the
     * sight is back on the axis by the end of `tiltOut` — before the round it
     * is loading can be fired.
     *
     * Not 1: a little of the aim is left in, so the weapon settles back to the
     * sight from somewhere near it rather than swinging up from the hip on the
     * last beat. It also keeps a scoped weapon from being flung out of a
     * narrow FOV and back in.
     */
    aimBreak: 0.8,
    /**
     * The old magazine: how long it takes to clear the frame, how far it
     * travels along `magDrop` doing it (model units, as every offset in this
     * file is), and how far it tumbles on the way (radians). It ACCELERATES —
     * the fall is the one thing in the gesture that is not a hand's doing, and
     * a magazine leaving at a constant rate reads as being lowered on a wire.
     */
    dropTime: 0.15,
    dropDist: 0.9,
    dropTumble: 1.3,
    /**
     * The fresh magazine: when it comes back into frame, how far below the
     * well it starts, and how far its nose is rocked back (radians) when it
     * gets there. It arrives ON `magSeat`, at its fastest — a magazine that
     * eased to a halt at the well would be a magazine placed rather than
     * seated, and the clack has nothing to be the sound of.
     *
     * `insertDist` has a floor that is not about timing: one node stands in
     * for both magazines, so the frame the old one is swapped for the new one
     * is a JUMP from `dropDist` to this, and it has to happen far enough below
     * the bottom edge that the bob cannot bring it back into view. Measured at
     * 1280x720, 0.62 left that jump only ~40 px clear — inside a fast walk's
     * vertical bob. Deeper costs nothing: the travel eases so late that the
     * magazine is still in view for the last third of its trip.
     */
    insertFrom: 0.34,
    insertDist: 0.72,
    insertTilt: 0.38,
    /** The support hand's trip back to the handguard, once the mag is home. */
    handHome: [0.6, 0.82],
    /**
     * The two impacts, as impulses on the weapon: the magazine going home
     * under the heel of the hand, and the bolt slamming forward. Metres and
     * radians in the camera's frame, laid on top of the tilt, with an instant
     * attack and a squared decay over `kickFall` — the same shape as a shot's
     * kick, because they are the same kind of event.
     *
     * Both roll AGAINST `reloadRot.z` rather than with it: a magazine driven
     * up into the well knocks the cant out of the weapon for a moment, and a
     * kick that deepened the roll instead would read as the weapon flinching
     * away from its own hand. Flip these with the cant if it is ever flipped.
     */
    seatKick: { pos: { x: 0, y: 0.024, z: 0.006 }, rot: { x: -0.06, y: 0, z: 0.08 } },
    boltKick: { pos: { x: 0, y: -0.006, z: -0.016 }, rot: { x: 0.05, y: 0, z: 0.04 } },
    kickFall: 0.12,
  },
  /**
   * The weapon swap: one gun goes away below the frame and the other comes
   * up in its place, on a triangle that peaks halfway through
   * `weapons[id].drawTime`.
   *
   * The drop has to be enough to take the weapon fully OFF the screen, not
   * merely low, and that is what sizes it: at the hip stand-off of ~0.66 m a
   * 54° vertical FOV puts the bottom edge 0.336 m below the axis, and
   * `hipPos.y` has already spent 0.185 of that. The switch is hidden behind
   * the frame's edge or it is a model popping into another one — which is
   * exactly what a swap with a shallow dip looks like.
   *
   * The rotation is the half that sells it as a hand rather than a lift:
   * positive `rotX` is nose-down (see `recoil.kickPitch`, which is the same
   * axis in the other direction) and positive `rotY` is outboard, so the
   * weapon rolls off the shoulder rather than sinking straight down.
   */
  swap: {
    pos: { x: -0.02, y: -0.32, z: -0.08 },
    rot: { x: 0.62, y: 0.3, z: -0.28 },
    /**
     * Share of the draw spent putting the old weapon away — where the models
     * are exchanged. Under a half, because the up-stroke is what the player
     * is waiting on and the down-stroke is only the cover for it.
     */
    switchFrac: 0.42,
  },
  /**
   * The throw. A grenade goes with the OFF hand, so the weapon is not put
   * away for it: the support hand leaves the handguard, the weapon tips out
   * of the aim under the firing hand alone, and the other arm does the work
   * in front of the camera.
   *
   * The ARM is the animation, and it has to be. This was once a weapon dip
   * on its own with nothing thrown in view, and the grenade appeared on the
   * camera axis on the frame the button went down — which is exactly what a
   * muzzle does, so the whole thing read as a second trigger rather than as
   * a throw. What makes it a throw is a gesture with a release IN it: the
   * hand comes up holding the grenade, cocks back, whips forward, and the
   * grenade leaves it at full extension, from the hand's own position rather
   * than from the eye.
   *
   * The timeline, all seconds from the button:
   * - `[0, windup * cockFrac]` — the hand rises into frame and cocks back.
   * - `[windup * cockFrac, windup]` — the whip forward. Short, so it snaps.
   * - `windup` — RELEASE. The grenade leaves the hand and `GrenadeSystem`
   *   has it from there; `Player.throwReleaseDue` is the one edge that says
   *   so, and it is what the sound and the camera's follow-through key off.
   * - `[windup, windup + recover]` — the hand drops back out of frame and
   *   the weapon comes back up.
   *
   * `windup + recover` is deliberately shorter than `grenade.throwInterval`,
   * so the arm is out of frame and the weapon settled before a second throw
   * is allowed.
   */
  throw: {
    windup: 0.24,
    /** Share of the windup spent cocking; the rest is the whip. */
    cockFrac: 0.6,
    recover: 0.34,
    /**
     * The weapon's give, held from the cock through to the end of the
     * recovery — it is the support hand being somewhere else, so it lasts
     * exactly as long as the hand is away. Positive `rotY` is outboard (see
     * `sprintRot`), which with the drop reads as the weapon tipping down and
     * away under one hand.
     */
    weaponPos: { x: 0.02, y: -0.07, z: -0.06 },
    weaponRot: { x: 0.2, y: 0.18, z: -0.24 },
    /**
     * The throwing hand's three keys, CAMERA-LOCAL and in metres (the arm
     * node carries `scale`, so only its geometry is in model units). The
     * off hand is the LEFT one — the rifle's support hand — so every x here
     * is inboard of the weapon, which sits at `hipPos.x` on the right. That
     * separation is half of why the grenade no longer reads as leaving the
     * muzzle.
     *
     * `rest` is below the frame at both ends of the gesture. `cock` holds the
     * whole fist and the frag in frame and near the lens, because the one
     * thing the wind-up has to say is WHAT is about to be thrown — a hand
     * cocked off the left edge is a throw the player never sees loaded.
     * `release` is far out and low, so the whip reads as extension in DEPTH
     * rather than as a slide across the screen.
     *
     * Both live poses are also bounded by something that is not composition:
     * THE ELBOW MUST LEAVE THE FRAME. The forearm ends at a flat cut where
     * the arm would carry on into a shoulder there is no geometry for, and a
     * cut end standing in open screen reads as a floating log rather than as
     * an arm — which is exactly what the first pass at this looked like. A
     * hand placed high and central drags that cut into view however good the
     * rest of the gesture is; low and outboard keeps it off the bottom-left
     * corner, and `THROW_ELBOW`'s length is the other half of the same
     * guarantee.
     */
    handRest: { x: -0.28, y: -0.36, z: 0.6 },
    handRestRot: { x: 0.3, y: 0.3, z: 0 },
    handCock: { x: -0.24, y: 0.04, z: 0.5 },
    handCockRot: { x: -0.3, y: 0.25, z: -0.2 },
    handRelease: { x: -0.18, y: -0.1, z: 0.86 },
    handReleaseRot: { x: 0.35, y: -0.1, z: 0.1 },
  },
  /** Where the support hand travels to for the magazine swap. */
  magHandOffset: { x: -0.02, y: -0.09, z: -0.34 },
  /**
   * Sway: the weapon lags the view. Position offsets oppose the turn,
   * rotation follows it, both clamped so a fast flick can't swing the
   * rifle out of frame, and both eased so the weapon settles after the
   * camera stops.
   */
  swayPos: 0.05,
  swayRot: 0.1,
  swayPitchPos: 0.035,
  /** One ceiling for all four terms — metres for the offsets, radians for
   *  the rotations. They happen to want the same number. */
  swayMax: 0.09,
  swaySmooth: 8,
  /** Weapon bob, on the camera's own bob phase (see camera.bobRate). */
  bobLateral: 0.022,
  bobVertical: 0.014,
  bobRoll: 0.05,
  /** Sway/bob multipliers while aimed — a braced weapon barely moves. */
  adsSwayMult: 0.3,
  adsBobMult: 0.12,
  /**
   * Vertical give while airborne, from the fall speed (m per m/s). The
   * pose blends themselves need no smoothing constant: Player hands over
   * adsBlend/sprintBlend/reloadBlend already eased.
   */
  airDrop: 0.006,
  airDropMax: 0.05,
  /**
   * How fast the give follows that fall speed (per second). It exists
   * because the speed it follows does not ease: it jumps to the launch
   * velocity on the push and to zero on the frame the feet touch. Take the
   * give straight from it and the weapon snaps 5 cm back to neutral in one
   * frame, which is the pop the landing absorb is there to replace. ~70 ms
   * of lag — enough that the return is a motion, short enough that the
   * weapon still reads as attached to the body.
   */
  airDropSmooth: 14,
  /**
   * The landing absorb's share of the camera's dip (see `camera.land`). The
   * weapon already rides the camera down; this is how much further the arms
   * let it go, and the nose-down pitch per metre of that dip. Both are the
   * part you can actually see, because the rest of the sink moves the eye
   * and the weapon together.
   */
  landFollow: 0.35,
  landPitch: 0.5,

  /**
   * The loadout screen's turntable: the weapon held up to be LOOKED at
   * rather than carried, parked at a fixed place on the screen and turned by
   * the player. Framing numbers, in the same spirit as `scale` and `hipPos`
   * above — how much of the frame the weapon eats and where it sits, not
   * anything the rounds can tell apart.
   */
  inspect: {
    /**
     * Metres from the lens at the hip-fire FOV. Nearer than the hip pose, so
     * the weapon fills its half of the screen; ViewModel scales this by the
     * live FOV so the stage frames identically whatever the camera was left
     * zoomed to (dying mid-ADS is enough to leave it narrow — nothing
     * re-writes `camera.fov` until the next round starts).
     */
    dist: 1.25,
    /**
     * The aspect ratio `dist` frames the weapon for. Narrower than this and
     * the weapon is pushed proportionally further back: its size follows the
     * vertical FOV, but the room it has to fit in is the stage's share of the
     * width, so a nearly square window would otherwise lay a rifle across
     * the panel column. Wider is free — the stage only gets roomier.
     */
    aspectReference: 1.7,
    /**
     * Where on the SCREEN the weapon is centred, in NDC (-1..1, +x right,
     * +y up). This is the loadout screen's stage: its panel column takes the
     * left 46% of the viewport (`--panel` in #loadout's CSS) and the stage
     * the rest, so the stage's centre sits `(1 + 0.46) / 2` across — which in
     * NDC is 0.46 again. Both sides are FRACTIONS of the viewport, which is
     * what keeps the DOM and the weapon together at any window size.
     */
    anchorX: 0.46,
    anchorY: 0.06,
    /**
     * The turntable spins about a point this far along the weapon's own
     * muzzle offset, so a shorter weapon centres itself instead of swinging
     * around a stock that is no longer there. Measured from the models'
     * spans — the rifle runs -0.52..0.75 and the SMG -0.32..0.50, whose
     * midpoints are 0.15 and 0.18 of their own muzzle landmark.
     */
    pivotFrac: 0.17,
    /**
     * Opening angles. A yaw just past a quarter turn brings the ejection-port
     * side toward the viewer with the muzzle across to the right, leaning a
     * few degrees TOWARD it — the other way round reads as foreshortened,
     * because the near end is then the stock and the whole weapon tapers off
     * to a muzzle in the distance. The slight negative pitch tips the top
     * plate into view, so the optic reads as fitted rather than as a lump on
     * the receiver.
     */
    baseYaw: 1.78,
    basePitch: -0.12,
    /** Radians per pixel of drag, and per second at full stick deflection. */
    dragRate: 0.009,
    stickRate: 2.6,
    /** Pitch is clamped short of straight up/down; yaw wraps freely. */
    pitchMax: 1.15,
    /**
     * The card hung behind the weapon while it is on the stage.
     *
     * The stage is a HOLE in the kit screen's scrim — the weapon there is the
     * live viewmodel on the canvas, and everything the screen draws is DOM
     * above it — so what filled the hole was whatever the scene happened to be
     * looking at. Off the main menu that is empty sky and reads as a bench;
     * off the DEPLOY screen it is a lit village at the exact tone of a grey
     * receiver, and the weapon the screen exists to show is the one thing on
     * it you cannot make out. The card is the fix, and it has to be in the
     * SCENE rather than in the stylesheet for the same reason the stage is a
     * hole: a panel dark enough to hide the map is a panel that hides the
     * weapon with it.
     */
    backdrop: {
      /**
       * Metres ahead of the lens. Free to be anything past the weapon: the
       * card never writes depth and is drawn before the viewmodel's rendering
       * group, so the weapon is in front of it whatever the number says — the
       * distance only decides how much scaling "the whole frustum" takes.
       */
      dist: 8,
      /** Slop past the frustum's corners, so no edge can creep into shot. */
      margin: 1.04,
      /**
       * A hair short of opaque, and the hair is not the point — being BLENDED
       * is. A blended mesh is drawn in its rendering group's last pass, which
       * is the only slot in the frame that comes after the world and before
       * the weapon; an opaque card would be sorted in among the village
       * instead. What is left of the map at this value is a value or two on a
       * near-black card, which is to say nothing.
       */
      alpha: 0.985,
      /**
       * The pool of light behind the weapon and the dark it falls off to,
       * centred on `anchorX`/`anchorY` — the same point the weapon is placed
       * at, so the brightest part of the card is always behind the receiver.
       * Cool, and darker than any weapon in the kit at both ends: the card is
       * what the weapon is read AGAINST, so nothing on it may compete.
       */
      near: "#171e2b",
      far: "#04060b",
      /** The pool's radius, as a fraction of the card's width. */
      poolRadius: 0.55,
    },
  },
} as const;
