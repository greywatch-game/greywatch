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
   * thrown away, which is why there is no `dropTime` here and no drop axis:
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
