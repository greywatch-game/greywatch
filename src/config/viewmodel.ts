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
  /**
   * Hip-fire pose: sight ~30% right and ~22% down, muzzle turned inboard.
   *
   * The stand-off is what says whether the weapon is HELD or held OUT. At
   * 0.66 the rifle's butt was a third of a metre in front of the face — an
   * arm's-length carry that read as posing with the weapon rather than
   * shouldering it. At 0.52 the butt is at the shoulder pocket and the
   * receiver fills the lower right, which is where a braced weapon sits; much
   * nearer and the receiver crowds the frame at this FOV.
   */
  hipPos: { x: 0.17, y: -0.17, z: 0.52 },
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
   * The drop is small on purpose. `hipPos.y` is already -0.17, so an
   * offset much past this lands near -0.3 and sinks the whole weapon out
   * of frame — the same symptom, from the other axis.
   */
  sprintPos: { x: -0.01, y: -0.05, z: -0.03 },
  sprintRot: { x: 0.2, y: -0.4, z: 0.3 },
  /**
   * THE RELOAD: two hands changing a magazine on a weapon that has weight,
   * played by `entities/ReloadGesture.ts` and argued in `docs/weapons.md`.
   *
   * **Every beat is a fraction of `weapons[id].reloadTime` and every IMPACT is
   * in seconds, and that split is the whole of how one table serves a 1.05 s
   * sidearm and a 3.4 s machine gun.** Where the hands are is choreography and
   * stretches with the gesture; how a weapon rings when a magazine is driven
   * into it is physics and does not — a machine gun that took three times as
   * long to settle from the same slap would read as being under water.
   *
   * **Nothing in it is a pose held for a duration.** The old reload was one
   * cant, eased in, held flat for two thirds of the gesture and eased out: the
   * weapon sat perfectly still while the thing it was supposedly having done
   * to it happened below the edge of the frame. A weapon in two hands is never
   * still — the support hand leaving takes the front end's support away, the
   * eye goes to the well and the well comes to meet the magazine, a magazine
   * driven home throws the whole thing — so every channel here is a CURVE
   * through keys, and every impact is a damped ring the weapon answers with.
   *
   * The beats, in order:
   * - `0` — the weapon comes off the shoulder into the hands (`styles`), the
   *   roll leading and overshooting, and the support hand leaves the handguard.
   * - `magOut` — DRY: the firing finger drops the magazine and it falls free
   *   under real gravity while the hand is already on its way to the pouch (a
   *   speed reload). TACTICAL: the hand has gone to the magazine instead and
   *   strips it out (`strip`), because a magazine with rounds in it is kept.
   * - `[fresh.from, fresh.index]` — the fresh magazine comes up out of the
   *   pouch in the hand, on an arc, turning upright as it comes.
   * - `[fresh.index, magSeat]` — its lips find the well, and it is driven home.
   * - `magSeat` — seated: the weapon takes the slap.
   * - `tug` — pulled once to prove it latched: the push-pull every trained
   *   shooter does, and the beat that says the magazine is now PART of the gun.
   * - `bolt` — DRY only: the action is closed — a catch struck, a handle
   *   yanked, a bolt run home, a slide dropped (`WeaponParts.reload`). A
   *   tactical reload kept its chambered round and skips it, its hand going
   *   straight home instead (`home`).
   *
   * **`magOut`, `magSeat` and `bolt` are `Sfx.reload`'s beats** and that file
   * reads them from here, so the gesture and the sound cannot drift apart. The
   * recorded `magIn` is scheduled by its PEAK so its slap lands on `magSeat`
   * after an approach the gesture draws between `fresh.index` and `magSeat`;
   * see `Sfx`'s `MAG_IN_PEAK`.
   */
  reload: {
    magOut: 0.18,
    magSeat: 0.55,
    bolt: 0.8,
    /**
     * The weight the AIM is broken by — up over `tiltIn`, down over
     * `tiltOut` on a dry reload and `tacticalOut` on a tactical one, which has
     * no action to close and is back in the shoulder sooner. Both finish short
     * of the end: the round the player is waiting on is fired from a settled
     * weapon, and a weapon still coming back on the frame the magazine refills
     * is a reload that lied about when it ended.
     *
     * `aimBreak` is how much of the aim that weight takes: nobody changes a
     * magazine through their optic, and an aimed weapon is ON the camera axis,
     * so a reload worked there swings the receiver across the middle of the
     * screen. Not 1, so the sight comes back to the axis from near it rather
     * than swinging up from the hip on the last beat.
     */
    tiltIn: 0.12,
    tiltOut: [0.8, 0.97],
    tacticalOut: [0.7, 0.95],
    aimBreak: 0.8,
    /**
     * How each weapon LAYOUT is held to be worked on (`WeaponParts.reload`),
     * stated as four deviations from the carry — camera-local metres for
     * `pos`, radians for `rot` (+x nose-down, -y muzzle inboard, -z underside
     * toward the camera), every rotation about the FIRING HAND, which is what
     * the weapon is actually turned in.
     *
     * - `work` — where it is held for the change: off the shoulder, tucked in
     *   toward the chest at about the height it was carried at, and canted so
     *   the well faces the support hand. **It is NOT lifted into view**: a pass
     *   that raised it a dozen centimetres showed the well and read as a
     *   weapon hoisted for the camera. What brings the work into the frame is
     *   the head looking down at it (`head`), which is what a person does.
     * - `sag` — what having only one hand on it costs while the support hand
     *   is at the pouch: the front end drops and the cant slackens.
     * - `meet` — turned to TAKE the fresh magazine as it arrives. A well is
     *   brought to a magazine as much as a magazine is brought to a well.
     * - `present` — DRY only: turned to give the hand the action.
     *
     * `heft` is how much weapon there is to move, and an impact both moves it
     * and rings at `1/sqrt(heft)` — a heavy weapon answers the same slap less
     * and slower. The square root and not the mass itself, because the hand is
     * the spring and a light weapon is held stiffer: divided by the full heft,
     * a slapped-in pistol magazine threw the pistol three centimetres and
     * eight degrees in a hundredth of a second.
     *
     * `wrist` is how much of the weapon's turn the FIRING wrist takes back.
     * The arms are children of the weapon, so without it a forearm turns
     * rigidly with every radian the weapon does: a pistol tipped muzzle-up
     * swung the firing forearm up into the lens until it filled the frame.
     * A wrist bends; the forearm stays roughly where it was.
     *
     * `grip` is where the support hand holds a magazine, measured off the
     * magazine itself — `below` its floorplate along the drop axis (negative
     * is up the body) and `side` across (negative is the left, the camera's
     * side of a weapon canted for a reload). **Never round the middle**: this
     * fist is one solid shape, and closed round a magazine's body the body —
     * deeper front-to-back than the fist — pokes out through the knuckles. A
     * long magazine is held from the LEFT, low, the palm on its flank the way
     * a hand coming off a chest rig carries one, so the hand is in the frame
     * while the magazine goes in; a pistol's, which is all floorplate below
     * the grip, under the heel of the palm that drives it home. A weapon whose
     * magazine is held some other way (a belt box, by its flank) states
     * `WeaponParts.magHand` and this is not read.
     */
    styles: {
      rifle: {
        heft: 1,
        wrist: 0.4,
        grip: { below: -0.07, side: -0.066 },
        work: { pos: { x: -0.04, y: 0.03, z: -0.01 }, rot: { x: -0.04, y: -0.2, z: -0.62 } },
        sag: { pos: { x: 0, y: -0.01, z: 0 }, rot: { x: 0.05, y: 0.012, z: 0.05 } },
        meet: { pos: { x: -0.005, y: 0.008, z: 0.004 }, rot: { x: -0.04, y: -0.03, z: -0.08 } },
        present: { pos: { x: 0.004, y: 0.004, z: 0 }, rot: { x: -0.02, y: 0.03, z: 0.18 } },
      },
      /**
       * The well is BEHIND the firing hand, at the shoulder, so the weapon is
       * pushed OUT and its nose tipped DOWN about the grip to lift its back end
       * into view — the opposite of everything a rifle does, and the reason
       * this is a style of its own rather than a rifle with a longer reach.
       */
      bullpup: {
        heft: 1,
        wrist: 0.4,
        grip: { below: -0.07, side: -0.066 },
        work: { pos: { x: -0.03, y: 0.03, z: 0.06 }, rot: { x: 0.26, y: -0.36, z: -0.5 } },
        sag: { pos: { x: 0, y: -0.01, z: 0 }, rot: { x: 0.03, y: 0.01, z: 0.05 } },
        meet: { pos: { x: -0.004, y: 0.006, z: 0.006 }, rot: { x: 0.03, y: -0.03, z: -0.07 } },
        present: { pos: { x: 0, y: -0.01, z: -0.02 }, rot: { x: -0.16, y: 0.08, z: 0.2 } },
      },
      /**
       * Brought in toward the chest and tipped muzzle-UP, so the bottom of the
       * grip faces the hand coming up from the belt — a pistol magazine goes
       * in from underneath, along the grip's own rake.
       */
      pistol: {
        heft: 0.7,
        wrist: 0.65,
        grip: { below: 0.03, side: 0 },
        work: { pos: { x: -0.06, y: 0.02, z: 0.03 }, rot: { x: -0.14, y: -0.3, z: -0.72 } },
        sag: { pos: { x: 0, y: -0.006, z: 0 }, rot: { x: 0.03, y: 0, z: 0.03 } },
        meet: { pos: { x: -0.004, y: 0.006, z: 0 }, rot: { x: -0.05, y: -0.02, z: -0.06 } },
        present: { pos: { x: 0.006, y: 0.004, z: 0.01 }, rot: { x: 0.08, y: 0.06, z: 0.14 } },
      },
      /**
       * A long, heavy rifle whose action is on its RIGHT: it is canted less, so
       * the bolt the firing hand works at either end of the reload stays in
       * reach, and dry it is rolled back LEVEL to present that bolt — not past
       * it: rolled right-flank-up as far as the cycle rolls it, it swung from
       * one cant to the other across a quarter of a second, which read as the
       * rifle being thrown rather than turned.
       */
      bolt: {
        heft: 1.35,
        wrist: 0.4,
        grip: { below: -0.07, side: -0.066 },
        work: { pos: { x: -0.04, y: 0.03, z: -0.01 }, rot: { x: -0.03, y: -0.18, z: -0.5 } },
        sag: { pos: { x: 0, y: -0.012, z: 0 }, rot: { x: 0.06, y: 0.012, z: 0.05 } },
        meet: { pos: { x: -0.004, y: 0.008, z: 0.004 }, rot: { x: -0.04, y: -0.03, z: -0.07 } },
        present: { pos: { x: 0.006, y: 0.006, z: 0 }, rot: { x: -0.02, y: 0.06, z: 0.46 } },
      },
      /**
       * Eight kilos on a bipod's worth of handguard: canted less (the box hangs
       * off the left flank and comes into view sooner), sagging more, and
       * rolled back right-flank-up to give the firing hand its handle.
       */
      belt: {
        heft: 1.8,
        wrist: 0.35,
        grip: { below: 0.03, side: 0 },
        work: { pos: { x: -0.035, y: 0.02, z: -0.01 }, rot: { x: 0.02, y: -0.16, z: -0.42 } },
        sag: { pos: { x: 0, y: -0.016, z: 0 }, rot: { x: 0.07, y: 0.014, z: 0.05 } },
        meet: { pos: { x: -0.004, y: 0.008, z: 0.004 }, rot: { x: -0.05, y: -0.03, z: -0.06 } },
        present: { pos: { x: 0.004, y: 0.004, z: 0 }, rot: { x: -0.02, y: 0.04, z: 0.42 } },
      },
    },
    /**
     * The fresh magazine's trip, weapon-local and relative to SEATED, in model
     * units — the pouch to the well.
     *
     * It appears in the hand at `from`, below the frame (`fetch`, turned the
     * way a hand coming off a belt holds one), comes up on an ARC — a
     * quadratic through a point `arc.drop` back down the well's own axis and
     * `arc.side` inboard, so it finishes travelling UP the axis rather than
     * across it — and reaches `index` with its lips at the mouth, `indexDist`
     * short of home and still rocked `indexRot`. Then it is driven in: the
     * distance to go falls as `1 - x²`, so it is at its fastest on the frame it
     * seats and the slap is something arriving rather than something parked.
     *
     * The approach is a MINIMUM-JERK reach, which is what a practised hand's
     * path to a target measures as — a bell of speed, fast through the middle
     * and slowing to find the well — and the short stop it makes there is real:
     * a magazine is offered to the mouth before it is driven.
     *
     * `fetch` is out of the frame at every style's `work` pose, with room for a
     * walk's bob; it is where the hand closes on it, so nothing about the swap
     * of the spent magazine for this one can be seen.
     */
    fresh: {
      from: 0.32,
      index: 0.47,
      fetch: { pos: { x: -0.16, y: -0.66, z: -0.22 }, rot: { x: -0.6, y: 0.32, z: 0.42 } },
      indexDist: 0.05,
      indexSide: { x: -0.012, y: 0, z: -0.006 },
      indexRot: { x: -0.17, y: 0.02, z: 0.07 },
      arc: { drop: 0.26, side: -0.07 },
    },
    /**
     * The spent magazine on a DRY reload: dropped, never handled. It leaves
     * the catch already moving at `eject` — the magazine's own spring against
     * the follower, and the flick of the wrist every dry reload is done with —
     * slides `slide` out of the well along its own axis at `grip` of gravity,
     * the well's friction still on it, and then FALLS, at 9.81 m/s² along the
     * WORLD's down converted into the weapon's frame each frame, so it drops
     * the way the ground says rather than the way the weapon happens to be
     * canted. `shove` is the little sideways speed it leaves the well with and
     * `spin` the tumble it picks up coming off the lip (both per second, model
     * units and radians), about its own middle. Hidden after `life` seconds,
     * by which time it is a metre below the frame.
     *
     * Gravity alone, from rest, is SLOW at the start — 5 cm in the first
     * tenth of a second — and a magazine that hung at the mouth of its well
     * for a beat after the catch let go read as stuck. `eject` is what a real
     * one has that a dropped stone does not.
     *
     * It is a CLONE of the magazine, which is what lets it take as long as
     * gravity takes: the one node used to stand in for both magazines, so the
     * old one had to be thrown out of the frame at three times g to be gone
     * before the new one could come back.
     */
    spent: {
      eject: 0.45,
      slide: 0.04,
      grip: 0.8,
      shove: { x: -0.05, y: 0, z: 0.14 },
      spin: { x: 2.6, y: 0.5, z: -1.4 },
      life: 0.75,
    },
    /**
     * The spent magazine on a TACTICAL reload: a magazine with rounds in it is
     * kept, so the hand goes to it first (`reach`), closes on it, and strips it
     * out down the well's axis and away below the frame (`at`) — to exactly
     * where the fresh one is picked up, `fresh.fetch`. The dump pouch and the
     * magazine pouch are one reach apart on a chest rig, and ending there is
     * what keeps the hand's path unbroken: the two magazines trade at the
     * pouch identical and coincident. The strip starts just ahead of `magOut`
     * so the recorded magazine leaving the well lands as it clears.
     */
    strip: {
      reach: [0.0, 0.15],
      at: [0.165, 0.3],
    },
    /**
     * The support hand on a DRY reload: off the handguard and straight down to
     * the pouch, the release pressed by the firing finger while it goes. It
     * drops FIRST and comes back second — `dip` is how much of its fall is
     * taken before it starts toward the body — which is the curve a hand
     * leaving something and reaching for something else actually draws.
     */
    away: [0.02, 0.3],
    dip: 0.75,
    /**
     * The push-pull: the hand on the seated magazine pulls it once, `dist`
     * down the well, to prove it latched. Quick out (`peak` of the window) and
     * eased back. The weapon is pulled with it (`jolts.tug`), because a latched
     * magazine is part of the weapon.
     */
    tug: { at: [0.565, 0.64], dist: 0.024, peak: 0.35 },
    /** The support hand's trip home to the handguard when nothing is left to do. */
    home: [0.64, 0.84],
    /**
     * Dry, AR-pattern: the hand comes off the magazine and up the left flank
     * to stand off the catch (`reach`), is driven into it on `bolt` along the
     * model's `strike` — accelerating, the way a strike does — and rebounds
     * away and home (`home`). `twist` turns the heel in as it goes.
     */
    catch: { reach: [0.64, 0.755], twist: -0.22, home: [0.8, 0.95] },
    /**
     * Dry, a charging handle: the hand goes to the knob (`reach`), hooks it,
     * yanks it the length of the model's `pull` (`pull`) and lets it fly on
     * `bolt`, following through a little before it goes home. The handle is
     * held at the back of its slot for a beat before it is let go — two
     * events and two sounds, the stop and the carrier running home, and with
     * the yank ending a hundredth of a second short of the release they were
     * one smeared clack.
     */
    handle: { reach: [0.64, 0.735], pull: [0.742, 0.778], follow: 0.25, home: [0.8, 0.94] },
    /**
     * Dry, a bolt gun: the firing hand runs the bolt OPEN off the spent case
     * before the magazine is touched and SHUT on a fresh round after it — the
     * cycle's own `liftTurn`, `draw` and `cycleHand`, on two windows of this
     * timeline. The hand goes back to the grip in between, and the bolt stays
     * open while it does.
     */
    boltWork: {
      open: { reach: [0.0, 0.05], lift: [0.025, 0.07], draw: [0.07, 0.125], home: [0.125, 0.23] },
      close: { reach: [0.6, 0.675], push: [0.675, 0.745], turn: [0.745, 0.8], home: [0.8, 0.9] },
    },
    /**
     * Dry, a pistol: the slide goes home off the stop in `close` SECONDS — it
     * is a spring, not a hand, and takes the same thirtieth of a second on any
     * weapon — under the firing thumb, which presses down for `thumb` of the
     * timeline ending on the beat.
     */
    slide: { close: 0.03, thumb: 0.05 },
    /**
     * The firing hand pressing the magazine release: a twitch of the wrist,
     * `len` of the timeline ending just after the magazine moves. Small, and
     * the only thing that says the magazine was LET GO rather than fell.
     */
    press: { len: 0.1, rot: { x: -0.07, y: 0.02, z: -0.06 } },
    /**
     * The HEAD's part, on the rendered camera — which is how the work comes
     * into view at all. A person changing a magazine keeps the weapon where the
     * hands hold it, tucked at the chest, and looks DOWN at the well; the first
     * pass at this hoisted the weapon up in front of a head that never moved,
     * which showed the well and read as a gesture made for the camera rather
     * than by a person. `ViewModel` counter-rotates the weapon by whatever the
     * head does here (its BODY node), so the rifle stays put in the hands while
     * the head tips down to it, and the world and the weapon move on screen
     * together the way they do when you look down.
     *
     * - `look` — how far down at the deepest, radians. Seven degrees: enough to
     *   bring the well and the hand into the frame, and it is the WORLD that
     *   moves to show it, so the horizon tells the player where the head went.
     * - `lookIn` / `lookOut` (dry) / `lookOutTactical` — when the head goes
     *   down and when it comes back, AHEAD of the weapon's own return: the eyes
     *   go back to the fight while the rifle is still coming up, and the view
     *   is level well before the round being loaded can be fired.
     * - `watch` — a little deeper while the fresh magazine is found and driven
     *   home, the one part a practised hand still watches.
     * - `nod` — the share of each impact's pitch the head takes, and `follow` /
     *   `jolt` the same for roll: leaning a little with the cant, and taking a
     *   little of every slap, because a slap that moves a rifle moves what it
     *   is braced against.
     *
     * **This is the one exception to "nothing may take the rendered aim down
     * under a held trigger"** (`docs/weapons.md`): rendered only, never on
     * `aimPitch`; during a gesture no round can be fired through; level again
     * before the reload is over. See `CameraSystem.reloadPitch`.
     */
    head: {
      look: 0.16,
      lookIn: [0.02, 0.17],
      lookOut: [0.74, 0.92],
      lookOutTactical: [0.64, 0.88],
      watch: 0.15,
      nod: 0.15,
      follow: 0.04,
      jolt: 0.15,
    },
    /**
     * How the weapon answers each impact: a damped ring — the impulse response
     * of a mass on a spring, which is what a weapon in two hands is — peaking
     * at `pos`/`rot` and ringing at `hz`, its envelope falling by e every
     * `decay` SECONDS. Camera-local metres and radians on the same axes as
     * `styles`, divided by the style's `heft`.
     *
     * **A ring starts at zero and rises**, which is the correction to the
     * impulses these replace: those were all attack, a full displacement on
     * the frame of the event, and a weapon cannot be in two places a frame
     * apart. What an impact delivers is a SPEED, so the displacement peaks a
     * few tens of milliseconds after it — the shape the per-shot kick and the
     * view punch were both moved to for the same reason.
     *
     * …and a speed is not delivered in an instant either. `rise` is how long
     * the FORCE takes to arrive, in seconds, and the ring is eased in over it:
     * a slap or a carrier hitting home is ten to twenty milliseconds of contact
     * and keeps a crisp edge, while a strip or a tug is a pull lasting several
     * times that, and taken as instantaneous it put a visible kink in the
     * weapon's path where the pull began. The seat's own was 12 ms once, and
     * on the sniper — whose three-second reload makes the push into the well
     * slow — that landed ten of the slap's fourteen millimetres in one frame.
     *
     * Signs: the seat drives the magazine UP into the well forward of the grip,
     * so the weapon rises nose-first and the cant is knocked out of it (+z);
     * the tug is the same thing downward; a catch struck from the left pushes
     * the weapon right and swings its muzzle outboard; a handle yanked back
     * pulls it in and a carrier slamming home throws it forward.
     */
    jolts: {
      release: { pos: { x: 0, y: 0.004, z: 0 }, rot: { x: -0.014, y: 0, z: 0.012 }, hz: 4.5, decay: 0.09, rise: 0.02 },
      strip: { pos: { x: 0, y: -0.009, z: 0.002 }, rot: { x: 0.024, y: 0, z: -0.022 }, hz: 4, decay: 0.1, rise: 0.045 },
      seat: { pos: { x: 0.002, y: 0.012, z: 0.003 }, rot: { x: -0.03, y: 0.008, z: 0.045 }, hz: 5.5, decay: 0.1, rise: 0.018 },
      tug: { pos: { x: 0, y: -0.007, z: 0 }, rot: { x: 0.016, y: 0, z: -0.016 }, hz: 5, decay: 0.08, rise: 0.03 },
      strike: { pos: { x: 0.012, y: 0.002, z: 0.002 }, rot: { x: -0.01, y: 0.035, z: 0.03 }, hz: 6.5, decay: 0.09, rise: 0.012 },
      yank: { pos: { x: 0, y: 0, z: -0.009 }, rot: { x: 0.016, y: 0, z: 0 }, hz: 5, decay: 0.09, rise: 0.035 },
      slam: { pos: { x: 0, y: 0.003, z: 0.007 }, rot: { x: -0.022, y: 0, z: 0.01 }, hz: 7, decay: 0.08, rise: 0.01 },
      shoulder: { pos: { x: 0, y: -0.002, z: -0.006 }, rot: { x: 0.008, y: 0, z: 0 }, hz: 4, decay: 0.12, rise: 0.06 },
    },
  },
  /**
   * The LAUNCHER's load, which is not a reload and is deliberately not built
   * out of one.
   *
   * **What it runs on is the FIRE COOLDOWN, because on a two-shot weapon the
   * cooldown IS the loader** — `equipment.rpg.carry.fireRate` says so in as
   * many words, and two seconds of a tube sitting still between rockets was
   * the only place in the kit where a wait had nothing on screen to be. So
   * nothing here goes near `Player.startReload`: there is no magazine, no
   * reserve and no reload on this slot (`docs/antitank.md`), and the gesture
   * is what the weapon is DOING while the clock the trigger already sets runs
   * down. A launcher with no round left never plays it — the tube is spent and
   * `tryShot` is putting it away.
   *
   * **It is a MUZZLE load, and every beat below is that fact.** A rifle's
   * magazine is released, falls away and is replaced from underneath; a rocket
   * is fetched whole, offered to the mouth of the bore nose-first and pushed
   * back down it until the motor is home. Nothing is dropped and nothing is
   * thrown away, which is why nothing here falls and there is no drop axis:
   * what left the weapon left it at forty-five metres a second.
   *
   * The order the beats run in, all fractions of `weapons[id].shotInterval`:
   * - `0` — the shot. The round is GONE (`ViewModel` disables the node), the
   *   tube comes down off the shoulder under `loadPos`/`loadRot`, and the
   *   support hand leaves the heat shield.
   * - `[0, offerFrom]` — the hand goes down out of frame after the next
   *   rocket. There is nothing to see; the empty tube is the picture.
   * - `[offerFrom, alignAt]` — the round rises back into frame WITH the hand,
   *   offered up to the muzzle and turned onto the bore.
   * - `[alignAt, seat]` — it slides straight back down the bore, at its
   *   fastest on the frame it arrives.
   * - `seat` — home. `seatKick` is the weapon taking it.
   * - `cock` — the hammer is thumbed back and the weapon is live again;
   *   `cockKick` is the bolt's opposite number and the last thing that
   *   happens.
   */
  loadPos: { x: 0.02, y: -0.02, z: -0.05 },
  loadRot: { x: 0.05, y: -0.16, z: -0.22 },
  load: {
    /** The hand comes back into frame with the round here. */
    offerFrom: 0.3,
    /** The round is on the bore, tail toward the mouth, ready to go in. */
    alignAt: 0.56,
    /** The motor is home. */
    seat: 0.78,
    /** The hammer back — the launcher's answer to the bolt going forward. */
    cock: 0.9,
    /**
     * The tube's trip down off the shoulder and back up onto it. The return
     * starts on the seat rather than on the cock, because a launcher is a
     * metre and a half of tube and it takes the whole of the tail of the
     * gesture to get back where it was — and it finishes just short of the
     * end for the reload's reason: the rocket the player is waiting on is
     * fired from the carry.
     */
    tiltIn: 0.12,
    tiltOut: [0.78, 0.98],
    /**
     * How much of the AIM the gesture takes away. Higher than the rifle's,
     * and for a reason the rifle does not have: this optic is a 2x prism
     * standing off the LEFT of the tube, so the aimed pose swings the bore
     * across the middle of the screen and the load happens at the muzzle —
     * the far end of the thing that would be lying over the picture. Not 1,
     * on `reload.aimBreak`'s argument: the sight comes back to the axis from
     * near it rather than swinging up from the shoulder on the last beat.
     */
    aimBreak: 0.9,
    /**
     * Where the round is when the hand first has it, weapon-local and
     * relative to SEATED (as every offset in this file is): below the frame,
     * outboard and forward of the muzzle, nose up and turned across the bore.
     *
     * The depth is not composition. One node stands in for the round that
     * left and the round that comes back, so the frame it reappears on is a
     * JUMP from nothing to here, and it has to happen far enough under the
     * bottom edge that neither the bob nor the tube's own tip can bring it
     * into view. The travel eases late, so the round is still in frame for
     * the last half of its trip up.
     */
    offerPos: { x: 0.16, y: -0.78, z: 0.26 },
    offerRot: { x: -0.5, y: 0.34, z: 0 },
    /**
     * How far ahead of seated the round sits once it is ON the bore, along
     * the bore. It has to clear the MOTOR and not merely the warhead: the
     * sustainer's tail is 0.35 behind the muzzle when the round is home, so
     * anything under that is a round that never actually came out of the tube
     * and the whole gesture reads as the head wobbling.
     */
    alignDist: 0.46,
    /**
     * Radians the round is still turned by when it reaches the bore, unwound
     * across the slide. A rocket indexes on a lug and the last thing a loader
     * does is turn it into the notch — and it is the one thing on a round
     * this symmetric that says it was PUT there rather than parked.
     */
    indexTurn: 0.9,
    /**
     * Where the support hand holds the round, relative to its home on the
     * heat shield and weapon-local — the hand rides this PLUS the round's own
     * travel from `offerFrom` on, so it is carrying the rocket rather than
     * arriving with it, exactly as the magazine's hand does.
     */
    loadHand: { x: 0.05, y: -0.02, z: 0.3 },
    /** The hand's trip back to the shield, once the motor is home. */
    handHome: [0.78, 0.94],
    /**
     * The two impacts, as impulses on the weapon — the round going home and
     * the hammer coming back — in the same shape and for the same reason as
     * `reload.seatKick`/`boltKick`: they are impacts, and the weapon answers
     * one the way it answers a shot. Both roll AGAINST `loadRot.z`, the rule
     * the reload's pair already follow.
     */
    seatKick: { pos: { x: 0, y: 0.012, z: -0.03 }, rot: { x: -0.05, y: 0.04, z: 0.09 } },
    cockKick: { pos: { x: 0, y: -0.008, z: 0.012 }, rot: { x: 0.04, y: 0, z: 0.05 } },
    kickFall: 0.13,
  },
  /**
   * The BOLT CYCLE: the third gesture in this file, and the one that is not
   * about ammunition at all.
   *
   * **It runs on the fire cooldown, exactly as the launcher's load does, and
   * for a reason one step further on.** The launcher's argument is that on a
   * two-shot weapon the cooldown IS the loader; here the argument is that on a
   * bolt gun the cooldown is the SHOOTER. `weapons.sniper.fireRate` is 0.8, and
   * 1.25 s of a rifle sitting perfectly still between rounds would be the
   * clearest possible statement that the wait is a rule rather than an action.
   * So this needs no state of its own, no cancel path and no eased gate: it is
   * a pure function of a clock that is already kept, already dropped by a swap
   * and already zeroed by a fresh weapon in the hands — `Player.cycleProgress`
   * is that clock read as a phase, and it is 1 on every weapon that does not
   * declare `boltCycle`.
   *
   * **A CYCLE NEVER TAKES THE SIGHT PICTURE AWAY, AND THE COST IS SPENT ON
   * THE AIM INSTEAD.** You can work a bolt with the butt in the shoulder and
   * the cheek on the comb — the scope does not leave your eye — and a gesture
   * that swung it away was the one thing in this file that read as animation
   * rather than as a rifle. But the fix cannot be to swing it away LESS:
   * `applyFit` puts the fitted sight's own reticle on the camera axis, so any
   * aimed weapon that MOVES is a reticle that lies, and half a roll is half a
   * lie. So the gesture has TWO EXPRESSIONS OVER ONE CLOCK, crossed on the ADS
   * blend and never both at full: at the hip it is the ROLL — `cyclePos`,
   * `cycleRot` and the two impulses, the weapon working in the frame — and
   * aimed it is `wobble`, the same disturbance spent on where the rifle POINTS
   * rather than on where it sits. The reticle stays on the axis, the world
   * swings behind it, and what the wait costs is the ability to watch the man
   * you just missed rather than the picture you are watching him through.
   *
   * **So the roll is the HIP's ENTIRELY, including its travel along the bore**,
   * which is the one place this is stricter than the per-shot kick beside it.
   * That kick keeps its z travel aimed on the argument that a weapon coming
   * toward the eye leaves the picture centred — true, and it is also EYE
   * RELIEF, which for a transient measured in tens of milliseconds costs
   * nothing and for `cyclePos.z`'s 3 cm held for the better part of a second
   * would pull the 6x eyepiece through `CameraSystem`'s near plane and open
   * the tube into a hole. An aimed cycle therefore moves the weapon not at
   * all. What is left of it in the FRAME is the bolt and the hand working it,
   * which run at full travel whatever the aim is doing because neither of them
   * carries the sight.
   *
   * Take `wobble` to 0 and the weapon is a DMR that fires every 1.25 s, which
   * is strictly worse than the DMR and interesting to nobody. That was
   * `aimBreak`'s argument and it survives it: what separates a bolt-action
   * from a slow semi-automatic is not the wait — a wait is a number, and
   * `fireRate` already carries it — it is that the wait is spent not watching
   * your target. It is only WHERE the wait is spent that moved, from the
   * picture to the hold.
   *
   * The order the beats run in, all fractions of `weapons[id].shotInterval`:
   * - `0` — the shot. The weapon is still in recoil and the hand is still on
   *   the grip; nothing here has started.
   * - `[0, lift]` — the weapon rolls its right flank up under `cyclePos`/
   *   `cycleRot` and the trigger hand comes off the grip onto the knob.
   * - `lift` — the handle is turned up out of its notch, `liftTurn` complete.
   * - `[lift, back]` — the bolt is drawn to the rear stop, `draw` behind it,
   *   and the case is out.
   * - `back` — it hits the stop: `stopKick` is the weapon taking that, thrown
   *   FORWARD, because a bolt pulled back pushes the rifle the other way.
   * - `[back, home]` — pushed forward again, stripping a round out of the
   *   magazine.
   * - `home` — closed. `homeKick` is the heavier of the two and goes the other
   *   way for the same reason.
   * - `lock` — the handle turns down into the notch and the weapon is live.
   *   Deliberately NOT an impulse: it is a wrist turning, not a mass stopping,
   *   and a third jolt here would make the whole gesture read as rattling.
   * - `[lock, tiltOut[1]]` — the hand goes back to the grip and the rifle
   *   settles, finishing before the round it just chambered can be fired.
   *
   * **All four of those beats are RECORDED, and the four fractions below are
   * therefore a contract with two files rather than one.** `Sfx.boltCycle`
   * places `audio/src/bolt-cycle.wav`'s four cuts on `lift`, `back`, `home`
   * and `lock` — the whole reason it is four cuts and not one performance is
   * that these are fractions and a recording's timing is milliseconds — so a
   * fraction moved here is moved there, exactly as the reload's already are.
   * `back` is the one that carries TWO of the sound's events, because on the
   * tape the stop and the case leaving are the same millisecond.
   */
  cyclePos: { x: -0.015, y: -0.012, z: -0.03 },
  cycleRot: { x: 0.09, y: -0.12, z: 0.38 },
  cycle: {
    /** The handle is up out of its notch. */
    lift: 0.16,
    /** The bolt is at the rear stop and the case is clear. */
    back: 0.42,
    /** It is closed on a fresh round. */
    home: 0.68,
    /** The handle is down and the rifle is live again. */
    lock: 0.78,
    /**
     * The weight over the whole gesture — the roll out of the carry and back
     * into it at the hip, and the wobble on the hold when aimed. It starts on
     * the shot rather than after it — the two are one motion, and a weapon
     * that sat level for a tenth of a second before beginning would read as
     * the player deciding to work the bolt rather than as the rifle being
     * worked. It finishes short of the end for the reload's reason: the round
     * this is chambering is fired from a settled rifle, so both expressions
     * have to be off it before the trigger is live.
     */
    tiltIn: 0.1,
    tiltOut: [0.78, 0.96],
    /**
     * The AIMED half of the gesture: what working the bolt does to where the
     * rifle is POINTED, in radians on `aimPitch`/`aimYaw`. See the header —
     * this is the feature, and `CameraSystem` is where it is spent.
     *
     * **It is an OFFSET and never an integration**, which is the hold sway's
     * rule and it is what makes this safe on the aim at all: it is a pure
     * function of the cycle phase, it is exactly zero at both ends of it, and
     * a weapon put down mid-cycle takes the whole thing away on the frame
     * `cycleProgress` returns to 1. Nothing can be stranded, and no amount of
     * cycling walks the player's own aim anywhere — unlike `addRecoil`, which
     * is meant to.
     *
     * It is scaled by the ADS blend, so the hip keeps the roll and pays none
     * of this, and by the stance steadiness the hold sway already runs on
     * (`CameraSystem.swayAmount`) — so crouching steadies a cycle for the same
     * reason it steadies a hold, and working a bolt at a jog is worse than
     * working one standing still. Both were already there to be read; neither
     * is a second knob.
     *
     * `drift` rides the bolt's OWN travel — out to the rear stop and back to
     * closed — so it is the arc a rifle takes when the firing hand comes off
     * the grip, goes up and pulls back: the muzzle swings toward the hand
     * working it and comes home as the bolt does.
     *
     * `stop` and `home` are the two impacts, on the same beats and the same
     * squared decay as `stopKick`/`homeKick` — and, like that pair, they go
     * OPPOSITE ways, because a mass driven back and a mass driven home do not
     * snatch a rifle the same way. They are about a third of the drift: they
     * are what stops the arc reading as one smooth swing, which is a hand
     * moving a rifle rather than a mechanism being worked in one.
     *
     * **All six are sized against the 6x TUBE and not against a degree**,
     * which is what makes them small: the glass this weapon is built around
     * magnifies the disturbance along with everything else, and its aimed
     * field is 9.8 deg, so the tube's own radius is 4.9 deg of apparent
     * movement and there is no room in it for a number that reads generous
     * written down. Worst of the whole gesture is the rear stop, where yaw
     * reaches drift + stop = 0.0105 rad — 0.6 deg of aim, 3.6 deg of apparent
     * movement, **74% of the tube's radius** with the pitch term added in. So
     * a man standing in the middle of the picture when the shot broke slides
     * most of the way to the edge of it and is back in the middle before the
     * trigger is live, and a man who was MOVING is somewhere the shooter did
     * not watch him get to. Take these much further and he is outside the tube
     * and has to be found again, which is the swing-away this replaced wearing
     * a different hat. Pitch is deliberately about half of yaw and peaks
     * before the stop rather than on it: a bolt throw pivots a rifle in the
     * shoulder far more than it lifts it, and two axes peaking on one beat
     * would spend the whole budget in one direction.
     */
    wobble: {
      drift: { pitch: 0.0035, yaw: 0.008 },
      stop: { pitch: -0.002, yaw: 0.0025 },
      home: { pitch: 0.0022, yaw: -0.0032 },
      kickFall: 0.11,
    },
    /**
     * How far the bolt travels, in model units along -z, and how far the
     * handle turns getting there (radians, about the bore).
     *
     * `draw` is the cartridge's own length and not a number picked for the
     * read: this action is cut for the longest round in the game and the bolt
     * has to clear one, which is also why the model's shroud stands proud of
     * the tang far enough to still be visible at full travel.
     *
     * `liftTurn` is 72 deg and it is the other half of a pair: `SniperModel`'s
     * `BOLT_REST` hangs the handle 20 deg BELOW horizontal, so this takes it to
     * 49 above — out of the chassis's outline at one end and clear of the
     * scope's rings at the other, which is the arc that is actually visible on
     * a rifle rolled right-flank-up for the cycle. Both numbers were moved
     * together after a photograph: at the honest 45-degree rest angle the knob
     * lives between the action's underside and the chassis's flank, and closed
     * against open was a two-pixel difference on the one part of this weapon
     * that exists to be watched moving.
     */
    draw: 0.09,
    liftTurn: 1.25,
    /**
     * Where the trigger hand goes, relative to its home on the grip and
     * weapon-local — up, out and forward onto the knob. It rides this PLUS the
     * bolt's own draw from `lift` on, so the hand is pulling the bolt rather
     * than hovering beside it, exactly as the magazine's hand carries the
     * magazine.
     *
     * One offset shared by every weapon that declares `boltCycle`, which today
     * is one. A second bolt gun with its handle somewhere else would want the
     * `WeaponParts.magHand` treatment — a per-weapon override with this as the
     * fallback — and nothing else here would move.
     */
    cycleHand: { x: 0.034, y: 0.128, z: 0.115 },
    /** The hand's trip back to the grip, once the handle is locked down. */
    handHome: [0.78, 0.93],
    /**
     * The two impacts, as impulses on the weapon, in the same shape and for
     * the same reason as `reload.seatKick`/`boltKick`: instant attack, squared
     * decay over `kickFall`, laid on top of the roll rather than blended into
     * it.
     *
     * Both take the weapon along the bore AGAINST the bolt, which is the one
     * thing this pair says that the reload's does not: a mass driven backwards
     * throws the rifle forward and a mass driven home throws it back, and
     * getting that round the wrong way is the difference between a bolt being
     * worked and a weapon shivering. `home` is the heavier of the two because
     * it is the one with a round on the end of it. Both roll AGAINST
     * `cycleRot.z`, the rule the other two gestures already follow.
     */
    stopKick: { pos: { x: 0, y: -0.004, z: 0.016 }, rot: { x: 0.04, y: 0, z: -0.06 } },
    homeKick: { pos: { x: 0, y: 0.006, z: -0.02 }, rot: { x: -0.05, y: 0, z: -0.07 } },
    kickFall: 0.11,
  },
  /**
   * The weapon swap: one gun goes away below the frame and the other comes
   * up in its place, on a triangle that peaks halfway through
   * `weapons[id].drawTime`.
   *
   * The drop has to be enough to take the weapon fully OFF the screen, not
   * merely low, and that is what sizes it: at the hip stand-off of ~0.52 m a
   * 54° vertical FOV puts the bottom edge 0.265 m below the axis, and
   * `hipPos.y` has already spent 0.17 of that. The switch is hidden behind
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
     * HOW BIG THE WEAPON IS, as a multiple of the frame's own HEIGHT at the
     * authored framing — its width and its height, measured off the rifle on
     * the bench. The pair replaces an NDC anchor and an aspect reference, and
     * the swap is the whole reason the kit screen can be laid out at all.
     *
     * **Where the weapon stands is the DOM's answer now and no longer this
     * file's.** The anchor used to be welded to a CSS percentage — the stage
     * was the right 54% of the viewport, so its centre sat 0.46 across and
     * `anchorX` said 0.46 in a second place that had to be changed with it.
     * That pair is what made the screen unmovable: any arrangement other than
     * a full-height column beside a full-height hole left the weapon behind
     * the panel. The screen MEASURES its own hole and hands it over every
     * frame (`LoadoutScreen.stageBay`, `InspectParams.bay`), so the layout is
     * free to be three columns and a strip on a desktop and a bay over a
     * scrolling list on a phone, and the weapon is in the middle of the bay
     * either way.
     *
     * What is left here is the SIZE, and stating it as the weapon's own span
     * is what lets one rule serve any bay: the weapon is pushed back until it
     * fits, on EITHER axis, where the old form could only ever be told about
     * the width. Both spans are against the frame's HEIGHT because that is the
     * axis Babylon's FOV is fixed on — a width stated as a fraction of the
     * frame's own width would have to carry the aspect it was measured at, and
     * that is exactly the `aspectReference` this pair retires.
     */
    frameWidth: 0.68,
    frameHeight: 0.25,
    /**
     * How much of the bay the weapon may fill before it is pushed back. The
     * rest is the air that makes a bay read as a bay rather than as a box the
     * rifle is jammed into, and it is the number to move if the weapon ever
     * looks tight in a corner of some viewport nobody measured.
     */
    frameMargin: 0.82,
    /**
     * The CLOSEST the weapon may be brought, as a fraction of `dist`.
     *
     * The fit is a "push it back until it fits" rule and its natural floor is
     * 1 — the authored distance, on a bay exactly big enough. But the bay is
     * the biggest thing on a redesigned kit screen and on a monitor it is
     * roomier than the framing was ever authored for, which at a floor of 1 is
     * a rifle sitting in the middle of a great deal of nothing. Letting the
     * fit go UNDER 1 spends that room on the weapon, which is the one thing on
     * this screen worth looking at; the floor is what stops an ultrawide
     * putting the muzzle through the near plane.
     */
    frameNearest: 0.66,
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
       * **There is deliberately no `alpha` here any more, and the absence is
       * the rule rather than a tidy-up.** The card is BLENDED — a blended mesh
       * is drawn in its rendering group's last pass, which is the only slot in
       * the frame that comes after the world and before the weapon, and an
       * opaque one would be sorted in among the village — but its blending is
       * a sorting device and not a claim of translucency. The frame's alpha
       * channel is TRANSLUCENT COVERAGE and `CelInk` takes its stroke off by
       * `1 - a`, so the 0.985 that used to live here stamped 0.985 of coverage
       * over every pixel of the kit screen and took the ink off the weapon it
       * was standing behind. `buildKitBackdrop` writes 0 and replaces the
       * colour outright instead; the argument is on the material, and the one
       * thing to know here is that the value it needs is not a tunable — 0 is
       * what puts the card in the blended queue AND what keeps it out of the
       * coverage channel, and nothing else is either.
       */
      /**
       * The pool of light behind the weapon and the dark it falls off to,
       * centred on the BAY the kit screen reported — the same point the weapon
       * is placed at, so the brightest part of the card is always behind the
       * receiver. It is repainted when the bay moves rather than baked once
       * (`paintKitPool`), because the bay is the DOM's answer and a phone's is
       * nowhere near a desktop's. Cool, and darker than any weapon in the kit
       * at both ends: the card is what the weapon is read AGAINST, so nothing
       * on it may compete.
       */
      near: "#171e2b",
      far: "#04060b",
      /** The pool's radius, as a fraction of the card's width. */
      poolRadius: 0.55,
    },
  },
} as const;
