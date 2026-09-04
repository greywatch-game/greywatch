# Weapons, the viewmodel and the loadout

How the first-person camera, the gun on it, the two weapon slots and the six
optics fit together, plus the procedural model rules they are built under. Split
out of [`CLAUDE.md`](../CLAUDE.md), which keeps the summary; this file is the
contract. Read it before touching `ViewModel`, `Player`'s carry/aim path,
`optics.ts` or any weapon model.

## First person, and the weapon on the camera

The camera sits **at `Player.eyePos`** — the same point `CONFIG.camera.eyeHeight`
defines and the same point bots test LOS against, so what a bot can see of you is
what you can see of it. There is **no player body mesh at all**: the player renders
only the viewmodel, its brass, and the blob shadow. There is no occlusion pick and
no camera pull-in — a camera inside the head has nothing to be occluded by.

**Crouch is that one point moving, and it only works because it is one point.** It
eases `eyePos` down to `CONFIG.player.crouchEyeHeight`, which lowers the camera,
breaks a bot's LOS and moves its aim point at once. **`Player.center` must come
down the same half metre (`crouchCenterHeight`)** or the feature inverts: bots aim
at `eyePos` and hit-test the sphere at `center`, so a dropped eye against an
unmoved sphere puts every round through the middle of the target instead of grazing
its top, and crouching makes you *easier* to kill. The two numbers keep the
sphere's top the same 0.05 m above the eye it is when standing — the
visible-but-unhittable trap `CoverMap`'s `hardHeight` documents from the other
side. The collider capsule is deliberately *not* resized: `moveWithCollisions` is
horizontal-only and the ground probe places the feet, so a shorter body buys
nothing and would owe a stand-up clearance test. Sprint outranks crouch and is
resolved first. Bots have no equivalent: the rig they share with remote humans can
crouch — `animateSoldier` takes a stance and folds the legs to it — but nothing in
the AI ever asks for one.

**Crouch is asked for two ways, and the split is per input.** Ctrl is a hold; `C`
and the pad's **B** flip a latch, which on a pad is the only workable shape since B
held rules out the rest of the face buttons. Both toggles share ONE latch in
`InputManager` and the hold ORs on top. B is also the menus' back button, so `Game`
calls `input.clearCrouchToggle()` wherever a B press hands control back to gameplay,
and on `spawnPlayer`.

**A latch is spent by whatever overrides it, never suspended under it.** Starting to
run spends a latched crouch; ending a run spends the sprint latch (so a pad player
who stops for a corner walks out of it); pressing either latch clears the other.
`Player.update` owns both edges, because `input.sprint`/`input.crouch` are only the
*ask* — the stick, the optic and the hands being full decide whether a sprint is
happening (`Player.loading`, which is a magazine going into a well OR a rocket
going down a bore) —
and it calls back into `InputManager.clearCrouchToggle`/`clearSprintToggle`. **Held
keys are exempt**: Shift and Ctrl are a live ask, so a Ctrl held through a sprint
still crouches you when the sprint ends.

`src/entities/ViewModel.ts` owns the weapon: the carried gun plus two gloved arms,
parented to the camera and posed in camera space.

- **The aimed pose is derived, not authored.** `adsPos` cancels the FITTED sight's
  own `sightCenter` offset (times `viewmodel.scale` — the node's position is in the
  camera's frame while the sight's offset is in the weapon's) so that sight's
  reticle lands on the camera axis at its own `CONFIG.sights[id].eyeRelief`,
  projecting to the exact centre of the screen, where `CombatSystem` sends the
  bullets. Hand-tuning it — or forgetting the scale factor, which puts the sight a
  couple of degrees low — gives a sight picture that looks plausible and shoots
  high. `applyFit` is the only thing allowed to write it and owes a re-derivation on
  every loadout change, **including a change of weapon**, because the same optic
  sits at a different height on each one.
- **The viewmodel renders in `VIEWMODEL_GROUP` (1).** Babylon clears depth between
  rendering groups, so the weapon draws over the world instead of being sliced open
  by the wall the player stands against. Anything attached joins that group —
  Player's muzzle flash does; the ejected brass deliberately does **not**, because it
  is thrown into the world and should be occluded like anything else.
- **Scale and stand-off are a framing decision, not realism.** A 54° vertical FOV
  against a real eye's ~130° means a rifle framed where a rifle actually sits fills
  the screen; `viewmodel.scale` shrinks it and `hipPos.z` pushes it out. That pose is
  authored for the rifle's length, so a shorter weapon adds its own `hipZ` or an SMG
  reads as being held at arm's length.
  - **`hipZ` also decides WHERE THE WEAPON PIVOTS, which for the launcher is the
    whole of how it is carried.** The offset is applied to a model's own origin,
    so for six guns it is a length correction and for the one weapon built from
    its back end it is the difference between a tube resting on a shoulder and a
    plank held out in two hands. See [`antitank.md`](antitank.md); the number is
    -0.36, and what bounds it is `rocket.launchAhead`, which the muzzle must
    stay past.
  - **`hipYaw` is the third of those knobs and it is about SHAPE rather than
    length.** Every gun in the kit is a receiver held below and right of the eye,
    which one shared `hipRot` frames. A launcher is a tube, and a tube pointed
    down the line of sight foreshortens into a pipe with a sight on it —
    turning it across the view is what makes it read as a launcher. **The sign
    is the counter-intuitive part** — the weapon is held to the RIGHT of the
    eye, so turning the muzzle outboard swings the bore ONTO the line of sight
    and inboard opens it. It is 0 on all six guns and only the hip pose takes
    it: the aimed pose is DERIVED, and a yaw baked into that would swing the
    reticle off the axis the rounds fly down.
- **The per-shot kick is a SPRING, and the spring is `Player`'s.** A shot hands
  it a *velocity* (`recoil.kick.speed`) rather than setting a level, so a round
  travels, overshoots the carry by ~0.07 on the way home and settles, and a round
  arriving on a weapon that has not come home adds to what is already there — the
  carbine's three rounds in 0.1 s reach 1.35 where one reaches 1.00. It replaced
  a snap-to-1-and-fade, which has an instant attack, a monotone return and
  nothing on the far side of neutral: a fade rather than a mechanism cycling.
  Because it goes genuinely negative, every term reading it must invert with it
  — gating on `> 0` instead of `!== 0` puts a visible corner in the return.
  - **It is stepped in CLOSED FORM, and the landing absorb's semi-implicit Euler
    must not be copied onto it.** At 6 Hz, `omega * dt` reaches 1.26 at 30 fps,
    far outside where that integrator holds: measured, one round peaked at 0.08
    of its travel at 30 fps, 0.54 at 60 and 0.78 at 120 — recoil growing with the
    frame rate. `land`'s 2 Hz is inside it and may stay as it is. **Frequency is
    what decides which you need**, not which file you are in.
  - **Its reach scales with a COMPRESSED `recoilMult`** (`kick.compress` 0.6 —
    rifle 1.00, DMR 1.61, SMG 0.70). Before it there was no weapon term at all
    and every gun moved the model the same distance. Raw `recoilMult` is not an
    option: 2.2 is a defensible thing to do to an aim in fractions of a degree
    and an indefensible thing to do to a pose in centimetres.
  - **The lateral, roll and yaw take the shot's own `kickDrift`**, so the model
    leans the way the muzzle actually walked rather than picking a direction of
    its own. `kickRoll` is subtracted against it, because a positive `rot.z`
    takes the right flank UP (see `reloadRot`) and a weapon walking right has to
    roll negative to lean into where it is going. Flip it with that convention.
  - **The off-axis terms are damped by `kick.adsMult` (0.3) and the z travel is
    not**, and that split is geometry rather than taste. The weapon carries the
    sight, so anything that rotates or laterally shifts the model while aimed
    takes the RETICLE off the axis the rounds fly down — the same lie the aimed
    hold sway is arranged to avoid from the other side. Travel along z moves the
    sight closer to the eye and leaves the picture centred, which is also what a
    braced shoulder actually does with a rifle.
  - **The z travel is not damped, but it IS bounded, and by the near plane
    rather than by taste.** An aimed sight stands only centimetres off the eye
    and the travel is *toward* it, so on a magnified optic the two collide: the
    DMR with the scope drove 4.8 cm into a 7.8 cm stand-off and put the eyepiece
    2 cm behind `camera.minZ` — the scope going inside your head, and the rifle
    grazed the same plane at 4.8 cm. `kick.adsClearance` is the floor, and what
    the travel spends is **scaled** to fit the room rather than clamped at it: a
    clamp stops the weapon dead partway through the kick and reads as a clunk.
    The bound is derived from the fitted sight's own `eyeRelief * zoomComp`, the
    same rule `adsPos` follows, so nothing is authored per combination — and
    only the prism, the scope and the 6x ever reach it. Measured over all ten
    magnified combinations with a burst stacked on the spring, the worst aimed
    sight distance is **6.2 cm** (the DMR on the prism) against a near plane at
    5.0, where before the bound that same case sat at **3.8 cm** — 1.2 cm the
    wrong side of it. **Move `minZ` and `adsClearance` has to follow.** The 6x
    is the tightest of the three at rest — 5.87 cm of stand-off, measured — and
    is where the rule below about `eyeRelief` rising with magnification is
    actually being paid; re-measure this set when a magnified optic is added.
  - **That damping made the aimed picture steadier than it has ever been, not
    less steady.** The kick had no ADS term at all before, which was survivable
    only because it had no lateral component either — but its `kickPitch` was
    applied at full, so an aimed shot tipped the sight **0.12 rad (6.9°)** at the
    peak. It is 0.036 rad (2.1°) now, and the lateral and roll that came with the
    drift arrive already damped rather than being added on top. Measured at full
    aim and full kick, the terms are exactly `kickPitch/kickSide/kickRoll/kickYaw
    × 0.3` and `kickBack × 1`; at rest all twenty-six sight pictures still read
    zero on the camera axis.
- **The camera owns the bob phase; the weapon reads it.** Two integrators fed the
  same number drift apart and the weapon would visibly swim against the view.
  `Player` pushes the drive with `cam.setBobDrive()` and passes `cam.bobPhase`
  through. Player runs before the camera, so that phase is one frame old — 16 ms of
  an ~0.8 s cycle.
- **Footsteps are a third reader of that phase, never a step timer.** The camera's
  vertical bob is `sin(bobPhase * 2)`, so its two dips per stride (3π/4 and 7π/4,
  where the head is lowest and a foot takes the weight) are where the sound goes.
  Cadence comes free: the bob stalls when the player stops or leaves the ground and
  `camera.bobCrouchMult` halves it in a crouch. It also means **sprinting does not
  step faster** — the drive is movement *intent*, 1 at a walk — so a sprint is louder
  boots at a walk's cadence (2.55 steps/s either way, a 2.0 m stride walking against
  2.6 m sprinting). Speeding the gait up means speeding the camera's bob up with it.
  `Player.update` returns `PlayerEvents` (`jumped`/`footstep`/`landed`) rather than
  playing anything: `Sfx` is Game's, the same split as bots emitting `onStep` and letting `Sfx.botStep` decide
  audibility from the listener position.
- **A landing is an arrival.** The ground probe's `stepHeight` tolerance keeps the
  feet glued walking down a kerb and is **grounded-only**: extended to a body in the
  air (testing `velY <= 0`) a jump lands 0.6 m early and is teleported the rest of
  the way in one frame — measured **0.656 m in a single frame against a physical
  maximum of 0.14 m**, which read exactly like a dropped frame. What replaces it is
  `CameraSystem.land()`: a damped spring given a downward *velocity* scaled by impact
  speed, so the eye sinks ~6 cm over 67 ms on a plain jump, rebounds ~1 cm and
  settles inside half a second. The camera owns the spring; the viewmodel READS
  `landDip` — one integrator, the same rule as the bob phase. The nod and roll are
  damped by `land.adsMult` while the dip is not: the eye dropping is parallax and
  moves nothing, while the rotations swing the picture off rounds that still fly
  along the un-nodded `forward`. **The roll needs
  `camera.updateUpVectorFromRotation`**: `rotation.z` reaches the view matrix only
  through the up vector, which Babylon otherwise refreshes only on frames the roll
  *changes*, baking in that frame's yaw and pitch — so the frame a landing settled on
  left a stale up vector for the rest of the round (no tilt where you landed, a
  growing one as you turned away). **The viewmodel's airborne give is sprung for the
  same reason**: `velY` is a step function at both ends of a jump, so a give read
  straight off it snapped `airDropMax` to neutral on contact.

**Two things write the camera's roll — the landing absorb and the weapon's
TWIST — and they do it through ONE assignment** at the end of
`CameraSystem.update`, which is what stops the roll becoming whichever of them
happened to run last. Verified as a sum rather than a replacement: a twist taken
with a landing already in flight reads `landDip * adsMult * land.roll + twist`
to the last digit, and neither term alone.

The twist rises to a peak and falls from it on `rollT`, its own clock —
`CONFIG.recoil.rollBeat`, a `smoothstep` up to `peakAt` and an `impulse` down
from it, continuous because both halves are 1 at the handover.
**It is a fixed torque and not a drawn direction**: it
replaced a roll taken against the shot's random lateral drift, which flipped
sign shot to shot and read as camera shake rather than as a gun. A rifle's bore
sits above and off the axis of the shoulder pocket, so every round twists it the
same way — which is what the reference footage shows, nine shots of one sign
against a 0.001° noise floor. `updateUpVectorFromRotation` covers
both and must stay on.

The bob and the view punch move the **rendered camera only** — `aimPitch`/`aimYaw`
never see them, so bullets don't bob. The punch is also the one place a rendered
angle may be *larger* than the aim's: it decays over `punchTime` (0.09 s) against
the aim spring's `recovery` (6.5/s), roughly seven times faster, which is what
lets the view snap harder than the aim does without costing any control.

**The aimed hold sway is the one thing on the camera that is not cosmetic, and it
has to be.** An aimed weapon wanders — two sines an axis, pitch breathing at
~0.23 Hz and yaw at half that, tracing a slow figure-eight — and it is added to
`aimPitch`/`aimYaw`, where the bullets, the aim assist and the damage arcs all see
it. Applied to the rendered camera alone it would slide the *world* behind a sight
still welded to the axis the rounds fly down: the reticle would look alive and lie.
Applied to the aim, the sight stays centred, the world drifts, and what you shoot
is what is under the reticle. It rides the ADS blend (hip fire untouched — a drift
you fight while running is nausea, not texture) and is an *offset*, never
integrated into `pitch`/`yaw`, or a held aim would walk away on its own. Three
things scale it: `CONFIG.weapons[id].swayMult` (the DMR is steadiest at 0.7 because
sway is angular and its scope magnifies it 3.5x) and the stance multipliers `Player`
pushes through `setSwayDrive`. It is deliberately **not** normalised by
magnification the way the ADS look rates are: a sight magnifying your unsteadiness
is the trade it is asking you to make.

`Player.setBodyHidden` hides the viewmodel, which matters in the editor: it flies
the same camera the weapon is parented to.

## The reload is a gesture with a magazine in it

Every fraction below is a share of `CONFIG.weapons[id].reloadTime`, laid out in
`CONFIG.viewmodel.reload`, so one timeline carries a 1.05 s sidearm and a 3.4 s
machine gun without a per-weapon number anywhere.

- **It is a TIMELINE, not a pose.** `reloadBlend` is only the gate — what eases
  the weapon back out when a swap or a death cancels one — and `reloadPhase` is
  the gesture. The weapon tips out of the carry over `tiltIn`, holds while the
  magazine is changed under it, and is level again by `tiltOut`'s end, which is
  before the magazine refills: a weapon still coming level on the frame the
  round is available is a reload that lied about when it ended.
- **The beats are `Sfx.reload`'s clacks and must move with them.** That sound is
  four metallic events — catch, magazine out, magazine seated, bolt — and
  `magOut`/`magSeat`/`bolt` are three of them to the frame. What makes the
  gesture legible is that what you see lands on what you hear; a magazine that
  falls half a beat off the clack releasing it is two unrelated things happening
  at once. **Change a fraction in one file and change it in the other.** The
  sound is hung off `Player.onReload` rather than fired at a call site, because
  `startReload` is the one door a gesture begins through and it is reached two
  ways — the key, and the last round leaving the magazine inside `tryShot`. In a
  match that callback also announces the reload to the authority, so a second
  call site would be a reload fifteen other players never hear.
- **The magazine is the one part of a weapon that moves on its own**, and it can
  only move because the model merged it into a node of its own
  (`WeaponParts.magazine`, a second `merge` call exactly like an optic's).
  Everything else on a weapon is inside one merged mesh per colour and cannot be
  animated at all without the same split. It leaves along `magDrop` — the
  weapon's own rake, from `magDropAxis`, because a magazine sliding straight
  down out of a raked well shears through the front of it.
- **The old one FALLS and the new one is DRIVEN**, and the two easings say so:
  the drop accelerates (nothing has a hand on it) and clears the frame entirely,
  while the insert's distance-to-go falls as `1 - x²` so the magazine is at its
  fastest on the frame it arrives. The clear is what lets one node stand in for
  two magazines — what comes back is read as a fresh one because it was never
  seen to be the same one.
- **The hand carries it by construction, not by matching keys.** From
  `insertFrom` the support hand rides exactly the travel the magazine rides;
  before that they part company on purpose, because a hand chasing a falling
  magazine down reads as having dropped it.
- **The seat and the bolt are IMPULSES, not poses** — instant attack, squared
  decay, the same shape as the per-shot kick, because they are the same kind of
  event. In the pose stack as blends they would be two more places the weapon
  leans and neither would land on its sound.
- **The magazine keys off `reloading`, never off the eased blend.** It has two
  places to be and no way to be between them, so a cancelled reload puts it back
  in the weapon rather than lerping it home through the receiver.
  `ViewModel.stow()` is the only place that state is cleared and all three ways
  out of a half-finished reload — a swap, a round starting, the kit screen
  coming up over one — go through it, or the weapon comes back without a
  magazine in it.
- **`Player.reloadPhase` freezes where a cancelled reload left it** rather than
  resetting to 1. The pose is played off the phase and eased out by the blend,
  so a phase that snapped to the end underneath a blend still at 1 would take
  the pose off in a single frame.
- **The pose is a CANT, not a lift.** A rifle is not hoisted in front of the
  face to change a magazine, so `reloadPos` barely moves — the weapon stays near
  carry height, pulled in a little — and the roll is what brings the magwell
  where the eye can find it. Two passes got this wrong from opposite ends. The
  original *dipped* the weapon, which played the whole magazine change below the
  bottom edge of a frame the magwell was already hanging out of. The fix over-
  corrected and raised it far enough to frame the magazine dead centre, which
  looked staged at the hip and put a receiver across the middle of the screen on
  an aimed reload.
- **`reloadRot.z` must be negative.** A positive roll takes the right flank up
  and swings the underside out to the right, away from a camera sitting to the
  LEFT of a weapon carried at `hipPos.x`: the magwell is presented to nobody and
  the weapon reads as held out at an angle rather than worked on. Negative rolls
  the underside toward the camera and carries the magwell inboard, which is both
  where the support hand comes from and the way a right-handed shooter actually
  cants a rifle to change magazines. `seatKick`/`boltKick` roll *against* that
  cant — a magazine driven home knocks the cant out — and flip with it.
- **A reload BREAKS THE AIM (`reload.aimBreak`), and that is geometry as much as
  realism.** Nobody changes a magazine through their optic, and an aimed weapon
  is *on the camera axis*, so a reload pose applied there swings the receiver
  across the middle of the screen whichever way it moves. The gesture's weight
  scales the hip→ADS blend back down, so the aimed reload is the hip reload, off
  to the side where it belongs, and the sight is back on the axis by the end of
  `tiltOut` — before the round it is loading can be fired. It is not a full 1: a
  little aim is left in so the weapon settles back from near the sight instead of
  swinging up from the hip on the last beat, which also keeps a scoped weapon
  from being flung out of a narrow FOV and back into it.
- Measured at 1280x720 through the hold: the magwell and the top third of a
  seated rifle magazine sit inside the bottom of the frame (roughly y 600–720),
  the magazine leaves through that edge, and the aimed reload keeps the whole
  middle of the screen clear.

**There is a SECOND gesture built on this one and it is not a reload** (a
THIRD is the section below): the
launcher is loaded through the MUZZLE, off `CONFIG.viewmodel.load`, and it runs
on the fire cooldown rather than on a `reloadTime` the anti-tank slot does not
have. Everything above about a timeline, an aim break, an impulse landing on a
clack and a moving part merged into a node of its own holds for it word for
word; what differs is that nothing is dropped, nothing is caught, and the part
that moves goes back down a bore instead of up into a well. `poseReload` and
`poseLoad` are exclusive — a rig carries a `magazine` or a `warhead` and never
both — and the argument for each beat is in
[`docs/antitank.md`](antitank.md#the-load-and-why-a-weapon-with-no-reload-has-one).

## The bolt cycle is the third gesture, and it is the whole of a sniper rifle

`CONFIG.viewmodel.cycle`, played off `Player.cycleProgress`, on the one weapon
whose table row says `boltCycle: true`. Read it beside the launcher's load: they
are the same mechanism reached from opposite ends of the kit, and between them
they say what the pattern is for.

- **It runs on the FIRE COOLDOWN and holds no state**, exactly as the load does.
  The launcher's argument is that on a two-shot weapon `shotInterval` IS the
  loader; the sniper's is that on a bolt gun it is the SHOOTER. So there is no
  gesture clock, no cancel path, no eased gate and nothing that can be stranded:
  `fireCooldown` is already dropped by a swap, already zeroed by a fresh weapon
  in the hands, and already the thing that refuses the trigger — which is why
  `tryShot` needs no term from either gesture and neither can disagree with it.
- **`cycleProgress` reads 1 on every weapon that is not a bolt gun**, so the
  `boltCycle` test is made once and no caller repeats it. It also reads 1 while
  `reloading` and on `ammo <= 0`, which is one case rather than two: the round
  that empties the magazine starts a reload inside `tryShot` on the frame it
  fires, and a bolt worked under a magazine change would be two gestures on one
  pair of hands. The reload wins, because the reload is what is actually
  happening.
- **A CYCLE NEVER TAKES THE SIGHT PICTURE AWAY, AND THE COST IS SPENT ON THE
  AIM INSTEAD.** This is the one gesture in the file with no `aimBreak`, and
  the reason is that you can work a bolt with the butt in the shoulder and the
  cheek on the comb: the scope does not leave your eye. A version that swung it
  away read as animation rather than as a rifle — and the fix could not be to
  swing it away LESS, because `applyFit` puts the fitted sight's own reticle on
  the camera axis, so ANY aimed weapon that moves is a reticle that lies and
  half a roll is half a lie.
- **So the gesture has TWO EXPRESSIONS OVER ONE CLOCK, crossed on the ADS
  blend and never both at full.** At the hip it is the ROLL — `cyclePos`,
  `cycleRot` and the two impulses, the weapon visibly worked in the frame. Aimed
  it is `cycle.wobble`: the same disturbance spent on where the rifle POINTS
  rather than on where it sits, as an offset on `aimPitch`/`aimYaw` computed in
  `CameraSystem` (`setCyclePhase`, pushed by `Player` beside the bob and sway
  drives). The reticle stays on the axis, the world swings behind it, and what
  the wait costs is the ability to watch the man you just missed rather than the
  picture you are watching him through. The old argument survives its own
  mechanism: what separates a bolt-action from a slow semi-automatic is not the
  wait — a wait is a number, and `fireRate` already carries it — it is that the
  wait is spent not watching your target. Take `wobble` to 0 and the weapon is a
  DMR that fires every 1.25 s, which is strictly worse than the DMR and
  interesting to nobody. Only WHERE the wait is spent moved.
- **The aimed roll is zero INCLUDING its travel along the bore**, which is the
  one place this is stricter than the per-shot kick beside it. That kick keeps
  its z travel while aimed on the argument that a weapon coming toward the eye
  leaves the picture centred — true, and it is also EYE RELIEF, which costs
  nothing for a transient measured in tens of milliseconds and would, for
  `cyclePos.z`'s 3 cm held for the better part of a second, pull the 6x eyepiece
  through `CameraSystem`'s 0.05 near plane and open the tube into a hole. So an
  aimed cycle moves the weapon not at all: what is left of it in the FRAME is
  the bolt and the hand working it, neither of which carries the sight.
- **The wobble is an OFFSET and never an integration**, which is the hold sway's
  rule and is what makes it safe on the aim at all. It is a pure function of the
  phase, exactly zero at both ends of it, and gone on the frame `cycleProgress`
  returns to 1 — so no amount of cycling walks the player's own aim anywhere,
  unlike `addRecoil`, which is meant to. Its three terms are the arc of the
  bolt's own travel plus the two impacts at the ends of it, on the same beats
  and the same squared decay as `stopKick`/`homeKick`, and going opposite ways
  as that pair does: one event, one clock, two places it can be spent. It is
  scaled by the ADS blend and by the same eased stance weight the sway runs on,
  so crouching steadies a cycle exactly as it steadies a hold and neither is a
  new number.
- **The six numbers are sized against the 6x TUBE and not against a degree**,
  which is what makes them look small written down: that glass magnifies the
  disturbance along with everything else, and its aimed field is 9.8 deg, so the
  tube's radius is 4.9 deg of apparent movement. The worst of the gesture is the
  rear stop, where yaw reaches drift + stop = 0.0105 rad — 0.6 deg of aim, 3.6
  deg apparent, **74% of the tube's radius** with pitch added in. A man standing
  in the middle of the picture when the shot broke slides most of the way to the
  edge and is back in the middle before the trigger is live; a man who was
  MOVING is somewhere the shooter did not watch him get to. Much further and he
  is outside the tube and has to be found again, which is the swing-away this
  replaced wearing a different hat. Measured in the client at 6x, aimed, one
  shot on Hollowmere: yaw runs 0 → **+0.0105 at the rear stop** → −0.0017 on
  the home kick → **exactly 0 from phase 0.79**, against a trigger that goes
  live at 1.0. The weapon's own `position.x` and `rotation.z` never leave
  0.0001 and 0 across the whole of it once the SHOT's kick has decayed — 22 deg
  of roll at the hip and none at all through the glass.
- **`cycleRot.z` is POSITIVE, and it is the one place this gesture inverts the
  reload's rule.** A reload rolls the underside toward the camera to present the
  magwell to the support hand, which is negative; a bolt is worked by the
  FIRING hand on a handle on the weapon's right, so the roll that brings the
  work where the hand is takes the right flank UP. `stopKick`/`homeKick` roll
  against that cant, which is the reload's rule kept rather than inverted.
- **The two impulses go opposite ways along the bore, and getting that round
  the wrong way is the whole difference between a bolt being worked and a
  weapon shivering.** A mass driven backwards throws the rifle forward
  (`stopKick`, on the rear stop) and a mass driven home throws it back
  (`homeKick`, the heavier of the two, because it is the one with a round on the
  end of it). The handle turning down into its notch is deliberately NOT an
  impulse: it is a wrist, not a mass stopping, and a third jolt makes the whole
  gesture read as rattling.
- **The bolt is a node of its own (`WeaponParts.bolt`) and its geometry must be
  built about the BORE.** `poseBolt` turns that node about z to lift the handle,
  and the node sits at the weapon's own origin — so a raceway built anywhere
  else swings the bolt through the receiver instead of turning it in one. That
  is not a constraint the animation imposes on the model: a bolt IS in line with
  the barrel, and a model that puts it elsewhere is wrong before it is animated.
  It is the third of these movable nodes and the only one that never leaves the
  weapon, which is also why it is not exclusive with the other two — a bolt gun
  has a magazine as well, and `poseBolt` runs beside `poseReload` rather than
  instead of it.
- **The lift and the draw are SEPARATE clocks over the one phase**, not one
  blend. A bolt turns before it moves and moves before it turns back; run the
  two together and the handle spirals out of its notch, which is not a mechanism,
  it is a screw.
- **The hand is the TRIGGER arm**, which is why that arm has a node of its own
  at all (`WeaponRig.triggerArm`, added for this and left at identity on every
  other weapon). A reload is worked by the support hand and a bolt by the firing
  hand, so the two need one posable node each or one of the two gestures is a
  part moving on its own. From the lift onward the hand rides exactly the travel
  the bolt rides, which is `poseReload`'s construction for the third time.
- **The beats are `Sfx.boltCycle`'s and must move with them**, exactly as the
  reload's are its clacks': `lift`, `back`, `home` and `lock` are four of its
  five events to the frame. It is raised beside `Sfx.shoot` off `Player
  .cycleTime` — `loadTime`'s twin — rather than from inside the gesture, because
  the shot and the cycle it starts are one event.
- **It is the only sound in the game that is a WAIT rather than an event**, and
  the two travelling noises inside it are why. Every other mechanism sound here
  is a thing arriving, because every other gesture is over before the player has
  finished reacting to what caused it; a cycle is a second and a quarter of not
  being able to shoot, and without the slides it is four unrelated clicks with
  silence between them, which sounds like a fault rather than like a rifle.

## The report: one shape, six deviations from it

The six weapons used to be one sound played six ways, and it was measurable
rather than a matter of taste. `Sfx.shoot` took a single `sfxPitch` scalar over
its four layers and scaled every frequency by it, with the level tied to
`1 / pitch`; rendered through the real graph and measured, the whole kit sat
inside a 1.8x spread of spectral centroid (321–587 Hz), 2.5 dB of K-weighted
loudness and a 5% spread of decay time. One multiplier can only make a big gun
a small gun slowed down. What actually separates an SMG from a DMR — how much
charge is behind the round, how long the report rings, how hard it drives the
village, and how loud the mechanism is against the shot — had nowhere to be
said.

**So `Sfx.shoot` owns the SHAPE and the weapon owns nothing but deviations from
it**, which is the same split `recoilMult` makes against `CONFIG.recoil`: the
anatomy of a gunshot belongs to the game, and the charge, the barrel and the
mechanism belong to the weapon. The shape is five layers in the order the ear
resolves them — the snap of the shock front, the body of the report, a low roll
under it, the chest thump, and the action cycling a beat later — and the
deviations are `ReportVoice`, eight scalars tabled per weapon in
`CONFIG.weapons[id].report` with a paragraph each on what they mean.

- **The rifle is the reference and every one of its numbers is 1.** That is what
  makes the other five rows readable as statements about a weapon rather than as
  absolute levels, and it is also why there is no separate default anywhere: an
  all-ones voice IS the rifle, so a shooter with no weapon of its own — every bot
  on the map fires one flat round off the same rig — is heard as the rifle it is
  holding, and the identity voice and the bots' voice cannot drift apart.
- **The two low layers are separate on purpose, and they are where "heavy"
  lives.** The roll is broadband noise under a resonant lowpass, which is what
  the gas column is; the thump is the one pitched oscillator this class allows
  itself, because the pressure pulse genuinely is a single frequency. Either
  alone is thin — noise without the sine is a rumble with no centre, the sine
  without the noise is a kick drum. The roll's raw gain looks enormous beside
  the others and is not: a lowpass at 360 Hz throws away all but about a tenth
  of a noise slice's amplitude, the arithmetic every filtered layer in that file
  is written against.
- **The low end sits where a small speaker can find it.** The old report put
  most of its energy under 120 Hz, which is inaudible on the laptop half the
  game is played on; the roll's resonant peak lands in 120–400 Hz instead, and
  the measured effect is that every weapon got LOUDER to the ear while the sub
  band got quieter.
- **`level` is read against `fireRate`, not on its own.** The SMG's report is
  quieter than the rifle's because it arrives half again as often, and the DMR's
  is louder because three a second can afford to be. This replaced a `1 / pitch`
  rule that tied the two together and so could not say that a pistol is small
  AND quiet while a carbine is sharper than the rifle and nearly as loud.
- **`length` is bounded from below by the rate.** Three carbine rounds leave in
  0.1 s, so a report at the rifle's length would stack into one blur instead of
  a burst you can count. It is the only field here a weapon's fire mode
  constrains directly.
- **`snap` is what stops a big gun being a small gun slowed down.** The DMR has
  the deepest body in the kit AND the sharpest edge, because a full-power round
  through a brake does; a DMR that was only deep sounds like a rifle a long way
  off rather than a big one up close.
- **The mechanism is the one place a small weapon is LOUDER than a big one.** A
  blowback SMG is mostly the sound of its own bolt, which is `actionVol` 1.55 —
  the highest in the table — and it is more of what says "SMG" than the pitch
  is. `actionPitch` divides the layer's delay as well as multiplying its
  frequency, because a light bolt comes back sooner as well as higher.
- **The same pair voices the RELOAD**, so a belt going into an LMG and a
  magazine going into a pistol are not one sound at two speeds. The timing is
  untouched by it — those four fractions are still keyed to the viewmodel's
  beats to the frame, per the section above.

**The player's own report is the one sound in the game exempt from the voice
cap**, and it is the impact reserve's argument taken one step further. The cap
is first-come-first-served, so a firefight loud enough to spend it is exactly
the moment the player's own weapon would come out thin: the roll, the thump and
the action are scheduled last and would be the three dropped, which is to say
the gun would lose its bottom end precisely when it is being fired in anger. The
exemption is bounded by construction rather than by trust: ONE shooter, five
layers, and a rate the weapon table caps. Computed over every weapon's whole
magazine held down, the worst case is TEN voices — the carbine, whose three
rounds inside 0.1 s stack deeper than the LMG's nine or the rifle's seven —
against a cap of 24 with 6 of those already reserved from impacts. The voices
are still counted, so everything else still yields to them.

**Everyone else's weapon is `Sfx.botShot`, and it takes the same voice.** Two of
its layers always play and carry the range cues (flight time, the missing top
end, the rising reverb send); the third is the low roll, and it is gated on
`CONFIG.audio.thumpRange` rather than faded over the full range. That gate is
the same argument as `impactRange`: the far field has no use for the layer — the
panner has a 60 m shot's low end down to nothing worth a voice — and it is
generated at gunfire's rate, so a roll for all sixteen bots would be the largest
line in the voice budget for the least of it. The near half of the field gets
weight and the far half gets range, which is what each is listening for.

Measured the same way as the figures above, after: **10x the spread of spectral
centroid (166–1698 Hz), 9.7 dB of loudness and 2.6x of decay time**, with every
weapon louder to the ear than it was before.

| weapon | LUFS | centroid | decay | under 120 Hz |
| --- | --- | --- | --- | --- |
| DMR | -27.6 | 166 Hz | 0.69 s | 64% |
| LMG | -30.9 | 280 Hz | 0.60 s | 45% |
| rifle | -34.2 | 369 Hz | 0.52 s | 34% |
| carbine | -34.5 | 636 Hz | 0.44 s | 14% |
| pistol | -35.6 | 1124 Hz | 0.37 s | 10% |
| SMG | -37.3 | 1698 Hz | 0.27 s | 7% |

Read the loudness column against the rate rather than down: at their own fire
rates the sustained order is LMG, DMR, rifle, SMG, carbine, pistol, which is the
kit's own story about which weapon owns a fight.

**The SNIPER is a seventh voice and is deliberately NOT in that table.** Those
six figures were rendered through the real graph and measured; the sniper's row
has not been, so putting a number beside them would be six measurements and a
guess wearing the same formatting. What it was AUTHORED to be is the DMR's
argument at half the rate and one size up — `pitch` 0.6 against 0.7,
`weight`/`tail` at 2 against 1.65/1.8, `length` 2.1 against 1.75 — which should
put it below the DMR's 166 Hz centroid and above its 0.69 s decay, with `snap`
1.9 keeping the leading edge the sharpest in the kit rather than letting the
weapon read as something a long way off. **Re-run the measurement before quoting
it**, and add the row then; the harness that produced the table is not in the
tree, which is the actual reason this paragraph exists rather than a row.

## The loadout: six weapons, six optics, sixteen finishes, and a sidearm

Two tables, two slots, neither knowing about the other (a third table, the
finishes, is below and knows about neither; a FOURTH, the anti-tank kit, is
[`antitank.md`](antitank.md)'s and knows about none of them — it is a slot the
map decides the existence of, and everything about it that touches this file is
that it resolves to an ordinary `WeaponSetup` and is carried by exactly this
machinery). `CONFIG.weapons` declares
what can be carried and `CONFIG.sights` what can be bolted to it;
`entities/weapons.ts` and `entities/sights.ts` derive `WeaponId`/`SightId` **from
those tables**, so each is declared in exactly one place. Every weapon *with a
rail* takes every optic; the sidearm has no rail.

**A new weapon is an entry in the table, a model builder and a row in
`ViewModel`'s `WEAPON_BUILDERS`, and the type system enforces the third** — the
`Record<CarriedId, WeaponBuilder>` does not compile with a weapon missing from
it, and neither does `WEAPON_BLURBS` or `SIGHT_BLURBS` on the kit screen. Adding
the sniper touched no signature and no system: the wire already resolves whatever
weapon a client declares through `weaponSetup`, the server's fire-rate gate is
`Math.max` over the table, and the stat chart's bars are shares of the best
figure in the kit rather than absolutes. **That last one is worth knowing before
adding a weapon that sets a new best in a column** — 100 damage takes the
rifle's damage bar to under a third of the width it used to draw, which is the
chart working rather than breaking, and pinning the scale to an absolute instead
would mean re-tuning every bar in the kit the day a weapon is added.

**A weapon owns the round; an optic owns the picture.** Damage, rate, magazine,
spread, range and the recoil multipliers are the weapon's and reach nothing but
`Player`; magnification, eye relief and the aimed FOV are the optic's. They meet in
exactly two places: the aimed pose (the optic's `sightCenter` on *this* weapon's
rail) and the ADS blend RATE, the product of the optic's `adsSpeedMult` and the
weapon's. `swayMult` is the weapon's alone.

Everything about an optic falls out of `magnification`: the aimed FOV is
`2*atan(tan(fovHip/2) / mag)`, the ADS look multipliers are
`camera.adsLookMouse|Stick / mag` (so the crosshair crosses the *screen* at the
same rate through any optic — a 3.5x scope on hip-fire rates is unusable), and the
viewmodel's zoom compensation is `adsMagReference / mag`. The holo is 1.6, exactly
the 0.62 rad the camera used before optics were a choice.

**The player's own look-speed setting multiplies the CONFIG rates and nothing
else** (`CameraSystem.setLookScale`, one multiplier per device, fed from
`Settings.mouseSensitivity`/`stickSensitivity` by `Game.applySettings`). That is
the whole of its reach, and it is deliberate: the ADS multipliers, the optic's
magnification and the aim assist's bound are all expressed *against* those rates,
so scaling at the source moves the three together and none of them has to know
the setting exists. **The one place it has to be written out is
`CameraSystem.stickYawRate`**, because that getter is not a rate the camera uses
— it is the rate the aim assist bounds itself as a fraction of, and a player who
has halved their stick speed has halved what "the player always out-turns the
assist" is measured against.

## The third slot: a finish, which decides nothing

`entities/finishes.ts` is the same shape as the two tables above and the
opposite of them in every way that matters. A weapon decides what the round
does, an optic decides what you can see when you send it, and a **finish
decides nothing at all** — it is the colour and the gloss of the merged colour
groups and reaches no other line in the game. That is what lets it be a
client-side preference that never touches the wire, the bots, the authority or
the camera: a remote body is drawn by `SoldierModel`, which has never heard of
any of it.

**Every weapon offers all sixteen**, and the table is therefore the whole of
the list: there is no ownership field on a finish and no derived per-weapon
list that could fall out of step with one. `FINISH_IDS` is what the kit screen
draws and what `finishFor` validates against, so a scheme written into the
table is on every gun the moment it is written and cannot be on all but one of
them by omission.

It used to be four each — the standard finish plus three that named that one
weapon — and the argument for it was that a scheme is a reason to carry THAT
gun. What that actually bought was twelve palettes a player could see on the
kit screen and not have, which advertises another weapon rather than
decorating this one; a finish decides nothing, so it is the one slot here with
nothing to trade and no reason to be rationed. What survives the change is the
grouping: the fifteen are still written in families of three (weathered, loud,
painted, restrained, heavy) and the table's ORDER is the screen's, because the
kit screen draws all sixteen at once as a grid.

**A blurb therefore describes the PAINT and never the gun under it.** Sixteen
schemes across the primaries is near a hundred combinations, so a line claiming
the
weapon is semi-automatic, or heavy enough to take a foot off, or the only matte
thing in the kit is a line that is wrong on most of them — two of the shipped
blurbs said exactly that and were rewritten when the lists were merged.

**`standard` is the built state, not a repaint of it.** Its four colours are
`weaponKit`'s own `BODY`/`POLYMER`/`METAL`/`RUBBER` constants and its metal
carries the same `spec.rifle` that `WeaponBuild.collect` hands out, referenced
rather than written out — so selecting it puts a weapon back to exactly what
came off the builder, and moving a constant moves the default with it.

**Gloss is a ladder with four rungs and a finish may not invent a fifth**: matte
(no `spec` at all), `spec.rifleSatin`, `spec.rifle`, `spec.rifleChrome`. Two
finishes that claim the same gloss have to genuinely have it. **The top rung is
a different KIND of thing and not a brighter highlight**: `rifleChrome` states a
`mirror`, which is the one spec in the game that reflects the room rather than
glinting — see `docs/rendering.md`. It had to become one, because a Blinn lobe
is constant across a flat facet and a weapon is a dozen flat plates, so the
brightest highlight in the ladder either lit a whole plate or none of it and
chrome read as paint; the gold finish came out tan. That ladder is
also why `CelMaterialFactory.getGlossy` keys its cache on the SPEC as well as
the colour: the spec is a uniform rather than a define, so one hex asked for at
two gloss levels is two materials that differ only in what was uploaded to
them, and a colour-only key would have let whichever asked first answer for
both.

**What a finish may reach is decided by the BUILDER, not by a check.**
`WeaponBuild.merge` records the colour group each merged mesh came from, and a
model calls `takeFinish()` at the seam it already merges at — after the weapon
and its magazine, before any optic. So the parts list a finish is handed is the
weapon and nothing else: an optic on a rail is a separate piece of kit and
stays black on a chrome carbine, the way one does. Two groups are out of scope
for their own reasons: **BRASS** has no key in the table at all, because the
LMG's exposed belt is ammunition rather than weapon and stays cartridge-coloured
under every scheme; and the emissive reticle never went through `collect` in the
first place.

The repaint itself is a handful of material-pointer writes over shared cached
materials, so a pick costs nothing and nothing downstream of the fit is
re-derived — a finish moves no landmark, no sight centre and no hand, which is
why `ViewModel.setFinish` is the one loadout call that does not end in
`applyFit`. The ink does not need re-deriving either: the viewmodel is the one
thing in the game that outlines itself BLACK by hand rather than tinting the
line from the surface's own colour, so there is no derived tint of its to go
stale when the surface changes underneath it.

**The sidearm has none**, and that is a statement about the kit screen rather
than about the pistol. It is not offered there, so there is nowhere to pick
one, and a pistol that turned gold because the machine gun did would be the
loadout deciding something about a slot it was not asked about. `PistolModel`
still hands back its `finish` list — `WeaponParts` is one shape for every
weapon, not five — and nothing ever repaints it.

Which finish is on which gun is remembered PER WEAPON (`prefs.readFinish` /
`writeFinish`, one `localStorage` key each), and the merge is what makes that
matter MORE rather than less: a single key would mean picking up the SMG threw
away what the rifle was painted in, and now that any gun can wear any scheme it
would also mean the whole kit turning gold together. The read is validated by
`finishFor`, which is now the table's own membership test and nothing more —
every scheme fits every gun, so the only thing a stored value can be wrong
about is being a scheme at all.

**On the screen, sixteen is what turns the row into a GRID OF SWATCHES with no
names on them** — see [`ui.md`](ui.md) for that, and for where the name of the
lit one is written instead.

## Recoil has a shape, and the shape is learnable

Five terms make the difference between recoil you fight and recoil you learn, and
none of them is a weapon's own number scaled.

**The first is the one a weapon states twice: `recoilMult` and `recoilImpulse`
are two different quantities and were one field for most of this system's
life.** Muzzle rise is a MOMENT — recoil runs along the bore and the hands hold
the weapon below it, so what tips the muzzle is that offset, and a heavy rifle
mounted against a shoulder with a cheek on the comb tips remarkably little. The
shove is the CARTRIDGE. They are uncorrelated and in this kit they are
frequently inverted: the pistol flips at 1.15 on a shove of 0.55 (the worst
bore-axis offset in the game and the least mass to resist it), the LMG shoves
0.9 and flips 0.7 (a full-power belt round soaked by the weight of the gun), and
only the bolt gun tops both columns.

Conflating them is why the two heaviest weapons said "I am a big cartridge" the
only way one number can — by ANGLE. The DMR threw the reticle **3.78° on every
deliberate scoped round** and the bolt gun **5.50°**, which is not what a
mounted rifle does and, more to the point, is not what one costs. They are 1.49°
and 1.87° now — they were 2.32° and 2.92° until the reference match below cut
`pitchPerShot`, and every figure in this paragraph scales with it.

**The second is the SHAPE, and it is not a spring — which took two goes to get
right.** The first version of the settle was a first-order decay, which has no
rise at all: the whole kick landed on one frame and fell away from there, so
every weapon in the kit moved the sight as a step function. The obvious fix was
a damped spring given a velocity, and it is the wrong fix. **A damped spring is
symmetric about its peak and smooth in the first derivative through it**, so the
sight eases out of the top of its travel on the same curve it eased in, and the
whole excursion reads as something ANIMATED rather than something hit. At any
amplitude worth feeling it reads as rubber.

[`src/core/recoilCurve.ts`](../src/core/recoilCurve.ts) is the model that
replaced it and carries the argument in full. The short version is that
**nothing about a gun wants to be where it started**, so a restoring force is
the wrong idea at the root. What actually happens is three things with three
different causes:

1. **The impulse.** The charge delivers its momentum while the bullet is in the
   barrel and for a few milliseconds of gas jet after it — 2-5 ms, which at any
   frame rate is instant. The gun leaves that with an angular VELOCITY.
2. **The grip arrests it.** Shoulder, cheek and support hand stop the rotation
   over tens of milliseconds, so the muzzle climbs fast and FLATTENS. Left
   alone it would stop there: a gun that is fired and dropped does not come
   back down.
3. **The shooter hauls it back.** Muscularly, at a roughly constant force — so
   the return is a RATE, close to a straight line in time — and not until they
   have reacted to the gun having moved.

**The corner between (2) and (3) is the whole feature.** It is where the motion
changes cause, and a curve that is smooth through that point is claiming the
rise and the fall are one motion. Measured in the client, the rifle aimed, at
7 ms intervals: `0.37 → 0.63 → 0.78 → 0.83 → 0.81 → 0.72 → 0.63 → 0.53 → 0.42
→ 0.31 → 0.21 → 0.12 → 0.10` degrees — a flattening rise to a peak at 26 ms,
then a descent whose successive differences settle at 0.10/0.11/0.11/0.11/0.10,
which is a straight line at the haul rate and not the back half of anything.

**A corner in the POSITION must not be a step in the VELOCITY, though, and the
first cut of this made it one.** Switching the haul on at the handover put its
whole rate into the velocity in a single frame — an unbounded acceleration,
which the eye reads as a dropped frame rather than as a corner.
`settle.haulRamp` eases the haul in over a window CENTRED on the handover, so
the rate is at half strength exactly where the switch used to be: the corner
keeps its position and its legibility and loses only its infinity. It smooths
the CAUSE, not the shape.

**And the other half of reading smooth is having enough frames to be resolved,
which is a constraint the physics does not care about.** A 60 Hz display
samples every 16.7 ms. The first tuning of this model put an aimed rifle's
entire excursion — up, corner and back — inside 41 ms, which is two and a half
samples, and the action's two opposite-signed beats 1.7 samples apart. **Nothing
that completes in two samples can read as motion however right its curve is**;
it reads as a strobe, and two peaks under two samples apart do not resolve as
two events at all, they alias. Both were slowed until the whole travel spans
about five samples or more — the aimed rifle is 0 → 85 ms now — and **a change
here that takes an excursion back under ~5 frames has made recoil jerkier no
matter what it did to the arithmetic.**

**`riseTurns` is what keeps the peak honest.** The rise gets a fixed number of
grip time constants before the haul begins, so at 2.7 it is 93% complete at the
handover and the peak lands ON that handover for every impulse a weapon can
produce — which is what lets `pitchPerShot` go on meaning radians of peak even
though a rate limit is not a linear system. Where it stops being linear is a
BURST, and there the nonlinearity is the behaviour you want: stack enough
impulse and the residual velocity still beats the haul, so the muzzle climbs
past the handover and the peak arrives late and high. A string outruns the
shooter's correction, which is why a held trigger walks and a tap does not.

**The third term is the STANCE, and it changes the timing rather than the
amplitude — which is the half the old model could not say at all.** Aimed, the
weapon is in a three-point lock: shoulder pocket, cheek weld, support hand. That
is a stiff system a braced shooter drives straight back. At the hip it hangs on
two arms — a long, soft lever with nothing constraining it. Under a single
`adsMult` scaling one number, hip fire was aimed fire turned up, which is the
one thing it is not. Measured in the client, one shot, rise to peak against fall
back to the resting line:

| | hip | aimed |
| --- | --- | --- |
| SMG | 0.92° · 42 ms up, 55 down | 0.54° · 22 ms up, 27 down |
| rifle | 1.73° · 62 ms up, 133 down | 0.83° · 26 ms up, 59 down |
| DMR | 2.29° · 90 ms up, 258 down | 1.19° · 42 ms up, 90 down |
| bolt gun | 2.92° · 118 ms up, 382 down | 1.51° · 56 ms up, 118 down |

So an aimed weapon is a snap that is home in a twentieth of a second and a
hip-fired one is a lift you watch come down — the same weapon, two mechanical
systems. `massExp` is what spreads the four rows: more mass takes longer to
arrest and longer to drive back, and **neither of those is an angle.**

**The permanent share is HANDED OVER rather than applied at the shot**, which it
had to become the moment the kick got a rise. `1 - recoverFraction` of every
kick goes into the player's own aim and never comes back; applied whole on the
frame the trigger broke that is 30% of the kick arriving as a step underneath a
rise taking 20-85 ms — the exact artefact the rise exists to remove.
`CameraSystem.owedPitch`/`owedYaw` are a bookkeeping bucket drained at the
haul's own rate, so all of it lands by the time the sight is home and none of it
before the sight has moved. **The total is unchanged**, which is why every walk
figure in this file still holds.

**The fourth term is the ACTION, and it is what makes a self-loader read as a
MACHINE.** A rifle's recoil is not one impulse and a shooter does not feel it as
one: there is the shot, then the carrier reaching the back of its travel and
stopping against the buffer, then the carrier slamming into battery. Three
events, and the second and third are what a shooter means when they call a gas
gun "busy" against a bolt gun's single clean shove. Without them the weapon on
screen makes one smooth excursion per round however sharp its attack, and one
smooth excursion is a catapult.

`CONFIG.recoil.kick.action` lays two `impulse()` beats on `Player.sinceShot` —
the string counter's clock, which already exists and is already dropped by
anything that takes the weapon away, so **the whole feature costs no state**.
They are OPPOSITE in sign, which is the entire reason the pair reads as a
mechanism cycling rather than as a second recoil arriving late: mass travelling
rearward drives the weapon into the shoulder, and the same mass arriving forward
pulls it out and dips the muzzle. Measured off a real shot: `+0.128` at 28 ms,
`-0.081` at 83 ms, zero by 140. **A bolt gun states `boltCycle` and is exempt** —
its action is worked by a hand, and `CONFIG.viewmodel.cycle` already plays that
over a second and a quarter; two accounts of one mechanism would be one too
many. Measured on the bolt gun the term is exactly 0 on every frame.

They ride two axes and no more (`kickBack` and `kickPitch`): a carrier is felt
fore-and-aft and as a nod, and giving it roll and lateral would make it a second
recoil. `action.adsMult` (0.45) damps but deliberately does not remove it while
aimed — a rifle in a three-point lock still buzzes, and that buzz is most of
what tells you what you are holding.

**Their timing is LEGIBLE rather than literal, and the display is why.** A real
carrier is at the back of its travel around 10 ms and in battery around 35, and
those were the first numbers here — which put two opposite-signed peaks 1.7
frames apart at 60 Hz, where they do not resolve as two events but alias into
jitter. At 30 and 82 ms they are three frames apart inside a seven-frame window
and read as what they are. Each also ARRIVES over `rise` (20 ms) rather than
jumping: `impulse` is all attack and no ease-in, which is the right shape for
something hitting and the wrong one at this rate, because an instantaneous jump
to full is a step in the pose and two of them per round at eight rounds a second
is a buzz rather than a mechanism. **A mechanism the frame cannot resolve is
noise, and noise is not more faithful for having the right timing.**

**Spend recoil's visual budget on the MODEL, not on the aim** — which is what
`kickPitch` 0.12 → 0.22 and `kick.adsMult` 0.3 → 0.16 are, as one change. Their
PRODUCT is what an aimed weapon takes (0.035 rad against 0.036 before — the same
sight picture) and the bare number is what hip fire takes: **12.6° of muzzle
flip on the model against 6.9°**. A rotation of the model while aimed takes the
fitted sight's reticle off the axis the rounds fly down and has to stay small;
at the hip there is no sight on the eye and the flip is free, and it is most of
what you actually see. Move either number alone and the aimed picture moves with
it.

**And the near-plane bound was BROKEN, in shipped code, for as long as there was
a spring behind it.** `Player` struck the kick with `kickWeight` and `ViewModel`
multiplied by `p.kickWeight` again, so the weapon's weight was SQUARED — the
bolt gun travelled 4.7x the rifle rather than 2.2x — while `adsClearance`'s
`fit` applies that weight ONCE and was therefore under-predicting exactly the
travel it exists to bound. Measured on the shipped build by walking the fitted
sight's own `sightCenter` node into camera space through a held burst, the bolt
gun's scope reached **2.18 cm and its 6x 1.59 cm against a 5 cm near plane** —
inside it, which is the eyepiece opening into a hole in the air. With the weight
applied once the worst combination in the kit is **13.81 cm**, and nothing is
within 2.7x of the plane. `stackPeak` is 2 and is **measured through a real held trigger
rather than derived**, because a round landing mid-recovery restarts the
shooter's reaction and what a string stacks to therefore depends on the haul.
The carbine is the only weapon in the kit that stacks at all — one pull, three
rounds inside 0.1 s, 1.73x one round aimed — and every other weapon measures
1.00x on a sustained trigger. It is not a guarantee: at an earlier, slower
`haul` chosen for smoothness the SMG's held trigger stacked to **5.15x** at the
hip. **Re-measure it whenever `grip`, `haul` or `riseTurns` moves.**


**The view punch knows what is in your hands now**, which it did not: every
weapon in the game shook the frame by exactly the same amount, so a bolt gun and
a submachine gun made the identical picture. `recoil.punchCompress` (0.5) scales
all five of its terms together — 0.71× on the SMG to 1.90× on the bolt gun — and
amplitude only, because a shock is a SNAP and what takes a second to fade is
`shake` above. It is **passed** to `addPunch` rather than read off the carried
weapon (`Player.punchShock`), because a blast raises a punch too and a grenade
has no business being scaled by whatever the player happens to be holding.

**The kick's DIRECTION rotates as a string runs, and `recoil.pattern` is that.**
Two envelopes over the counter `firstShotMult` already reads: `pitchSettled`
(0.8) takes the vertical down across `patternShots` (7) as a muzzle climbs and
then binds, while `yawStart` (0.3) brings the horizontal up over the same span.
So the first rounds of any string go nearly straight up — which is what makes a
tap precise and is the reason to tap — and a held trigger walks off sideways
about `yawBias`. Before it, the kick was the same vector on shot 1 and shot 20
and a spray was a straight line with jitter on it; the only shape available was
magnitude, which can be pulled against but not learned.

**The pair no longer leaves the total walk alone, because the walk is what the
reference match cut.** For the rifle's 24 rounds from the hip the per-shot
pitch multipliers sum to 9.25 and the yaw multipliers to 21.27, so the permanent
share is **0.71° of climb and 0.31° of drift**, against the 10.6° and 2.4° they
were before. Most of that is `recoverFraction` going 0.7 → 0.93 rather than
anything in `pattern`. `maxYaw` and `maxPitch` are untouched and
neither binds on any weapon now; they are kept for what `addFlinch` queues onto
the same axes. **All these figures are derived. Re-derive them rather than
assuming they followed** whenever anything in `pattern`, `pitchPerShot`,
`yawPerShot` or `firstShotMult` moves.

### What the reference footage was, and what was taken from it

Two 240 fps captures at 3440×1440 of another shooter's firing range — one of
four isolated rounds, one of a 28-round burst, both ADS on a red dot, both with
the shooter deliberately not compensating. World motion was recovered by
cross-correlating 1D row and column projections of a crop that excludes the
viewmodel and the HUD, which gives sub-pixel translation per frame; ROLL came
from tracking the left and right thirds separately, since a roll to a camera is
the two sides moving vertically against each other. The game itself rendered at
120 fps, so the real resolution is 8.3 ms.

| measured | value | what it set |
| --- | --- | --- |
| shot spacing | 106 ms, ±1 ms over 28 | rifle `fireRate` 9.43 |
| isolated peak | 0.735° at 58 ms | `pitchPerShot`, `settle.gripAds` |
| 50% recovered | 160 ms after peak | `settle.haulAds` |
| residual at 300 ms | ~10% of peak | `recoverFraction` |
| sustained string | flat **2.562°** from round 8 to 22 | `pattern.pitchSettled`, `patternShots` |
| permanent climb after a string | 0.15° | `recoverFraction` |
| lateral, 22 rd | **0.40° RIGHT**, building, springs back to ~0 | `yawPerShot` |
| roll | rises from zero to **0.86° at 58 ms**, home by ~100 ms | `recoil.rollBeat` |

**Two of those rows were measured WRONG first, and both mistakes were about the
footage rather than the game.** A first pass read the lateral as zero (0.6 px
across 28 rounds) because the only clip available aimed at a wall of horizontal
panelling — a sideways drift measured against nothing. A clip aimed at a distant
vertical edge shows 0.40° of rightward pull plainly. And the roll was first read
as an instant 0.86° with a counter-swing, off four isolated rounds; averaging 19
rounds of a burst instead shows it starting at ZERO and taking 58 ms to arrive —
the same clock as the pitch, which is what one impulse resolved on two axes
should do. The instant version was also 45 ms end to end, under three samples at
60 Hz, so most of its amplitude was never drawn at all: **the authored 0.86° was
reaching a 60 Hz display as 0.35°**, which is exactly what "we have much less
roll than the reference" feels like.

**Hip fire is measured but deliberately not fitted.** A hip clip of the same
weapon shows 1.09° of screen-space climb against ADS's 2.56° — but ADS magnifies,
so pixels are not comparable between the two, and the reference's ADS zoom is not
recoverable from the footage. `settle.gripHip`/`haulHip` remain scaled from the
aimed pair rather than measured. If the two stances ever need to be right
relative to each other, that clip plus a known ADS magnification is the way in.

**The amplitude figures depend on the reference's ADS field of view, which is
not recoverable from the footage.** They are quoted at OUR aimed vertical FOV
(48.1°), which matches what the recoil LOOKS like rather than what it costs in
mouse travel; if the reference's FOV differs, every angle above scales with it.
The timings, the roll and the shape do not — roll is an image-plane rotation and
the rest are clocks.

**Both string-shaped terms share one exclusion**, `Player.stringed` — whether the
weapon HAS a cycle you can be in the middle of (`!semiAuto || burst > 1`). It has
to be shared: applied to a string of one, `firstShotMult` is a flat 60% increase
and the taper is a flat 20% *decrease*, and the decrease is the worse of the two
because both those weapons' fire rates sit just inside `stringResetTime` (the
DMR's 0.333 s against 0.35). Only a player firing them as fast as the weapon
allows would collect it — a discount for spamming a precision weapon, which is
the opposite of what a rate ceiling is for. Excluded, the DMR and the pistol fire
shot one every time: full climb, minimum drift, nothing to learn and nothing to
game. Measured, their envelope is 1.0 on every round of a magazine while the
rifle's and the carbine's run 1.6, 0.97, 0.93, 0.90, 0.87, 0.83, 0.80, 0.80…

**`recoil.firstShotMult` (1.6) is what makes a burst have a punch and a settle
rather than a flat ramp.** A weapon that has been sitting still and one that is
mid-string are not the same weapon; without this they were, because shot 1 and
shot 20 kicked identically. It is also what makes a tap distinct from a held
trigger, which is the entire reason to tap. `Player` owns the string counter,
beside `spreadBloom` and with exactly its lifecycle — raised by a shot, bled off
by `stringResetTime` (0.35 s), and dropped by anything that takes the weapon
away. **The string belongs to the WEAPON, not to the finger**, the same split
`burstLeft` and `triggerHeld` already draw, so `completeSwap` clears it
explicitly: the sidearm's `drawTime` of 0.34 s is a hundredth of a second inside
the window, and without that line the pistol's first round would inherit the
rifle's settled kick.

**It does not apply to a weapon that is a string of one**, and the exclusion is
the feature rather than an exception to it. `Player.recoilRamp` returns 1 when
`Player.stringed` is false, which is the DMR and the pistol: every shot there is
a first shot, so the multiplier would not be texture at all — just a flat 60%
recoil increase wearing feel's clothing, and on the DMR's 2.2 that is 6.0° on
every deliberate scoped round. Their `recoilMult` already carries the punch a
single shot is supposed to have. The carbine is `semiAuto` too and is
deliberately **included**, because `burst > 1` means one pull is three rounds
climbing as one motion, which is exactly the thing that has a first round in it;
`burstCycle` 0.4 s exceeds the reset window, so every burst gets the punch.

**The stance is the fourth term, and it is the one a player can answer
immediately.** `adsMult` (0.55) was on its own for a long time; `crouchMult`
(0.8), `moveMult` (1.25) and `airMult` (1.5) sit beside it now and are blended
the same way, off the same eased weights `Player` already pushes at the camera
for the bob and the sway. Crouching bought a tighter group
(`player.crouchSpreadMult`) and a steadier hold (`aimSway.crouchMult`) and did
nothing at all about the kick, which made kneeling behind a wall a decision about
the first round and not about the eighth. The two penalties are the same fact
from the other side: recoil is absorbed by a body braced against it, and a body
that is walking or in the air is not braced.

**The whole vector is built in `Player.recoilKick`, and that is where it
belongs.** Every number in it is the weapon's or the body's, and this file has
always said the recoil multipliers reach nothing but `Player` — but `Game` used
to assemble it out of three getters and a random draw of its own, so the weapon's
kick was described in one file and built in another, and the horizontal was drawn
a *second* time for the viewmodel. It is one draw now, in `tryShot`, into
`Player.kickDrift`, read by the aim, by the weapon's lean and by the view punch:
one round going one way. `Game` wires the result to the camera and does no
arithmetic on it.

**Per-weapon `yawBias` (−1..+1) is what makes the horizontal learnable at all.**
It used to be symmetric noise, and the only correct response to a random walk is
to stop firing — so every weapon's spray was the same shape at a different rate.
The bias makes the walk drift. It **scales** the noise rather than adding to it
(`(rand * (1 − |bias|) + bias) * yawPerShot`), so the total is still bounded by
`yawPerShot` and every ceiling documented for `maxYaw` survives untouched; 0 is
bit-for-bit the old behaviour, which is what the DMR is.

The magnitudes track how legible a single kick is. The SMG's **+0.6** is the
strongest because 13 rounds a second on the smallest per-shot kick is otherwise
indistinguishable from noise — only a consistent drift is readable at that rate.
The carbine's **−0.5** is strong because three rounds in 0.1 s cannot be steered,
only pre-aimed. The LMG's **−0.25** is the gentlest for the same reason its
`recoilMult` is: seventy-five rounds of a hard pull ends up pointing at a wall.

**The signs are paired, not scattered.** Rifle, SMG and pistol pull right;
carbine and LMG pull left. So a rifle-plus-sidearm loadout is one hand to learn
across the swap, and the other family is a genuinely different weapon rather
than the same one at a different rate — the thing the kit screen's stat chart is
trying to say, said in the hands instead.

A weapon's numbers scale `CONFIG.recoil` rather than restating it: `recoilMult` and
`bloomMult` SCALE the per-shot terms, because the shape of recoil belongs to the
game. `bloomMult` multiplies the *ceiling* as well as the per-shot term — a weapon
that blooms faster has to be allowed to bloom further, or the extra rounds per
second cost it nothing after the second shot.

The three automatics are balanced on time to kill, not damage per second: 4 rifle
rounds at 8/s is 0.375 s, 6 SMG rounds at 13/s is 0.385 s, 5 LMG rounds at 10/s is
0.4 s. The choice buys how much of the screen a burst covers, how far away it still
means anything, and how long you may go on firing it.

**Every one of those figures is the CLOSE one, and that is a change of meaning
rather than a caveat.** A weapon's `damage` is what a round does at or inside
`falloffNear`; past `falloffFar` it does `damageFar`, and between the two it
lerps against the distance the round actually flew. `range` is untouched and
still the hard reach — but a round that has stopped hurting is a more
interesting fact than a round that has stopped existing, so the ramp lives well
inside it and `range` is no longer the interesting end of the weapon.

What the second column buys is that the kit can now say something it could not:
the DMR alone is exempt, the LMG loses damage per second and never a round, the
carbine's burst stops being a kill at a stated distance, and the SMG falls off
hardest and earliest. Two rewards and two bills, which is the same balance the
close figures strike.

- **The rifle** is 4 rounds to **53.1 m** and 5 beyond it — 0.375 s becoming
  0.5 s at a boundary that sits inside the 78 m fog wall, so it is a distance a
  player can actually learn.
- **The LMG's 24 → 21 crosses no round boundary at all** (21 × 5 = 105). Five
  hits kill at 85 m exactly as they do at 5, and only the sustained figure moves
  (240 → 210). That is the same reward `bloomMult` 0.5 is, on a third axis.
- **The DMR has no fall-off**, and the exemption *is* the weapon: "two shots,
  whatever the range" is the sentence its entry opens with. It is stated as
  `damageFar` equal to `damage` rather than as an absent field, so every weapon
  carries the same three numbers and the lerp needs no special case — the same
  argument `floorSurfaces.ts` makes for `flat` being a real member of its list.
- **The sidearm and the bots' round sit on a knife edge**, and it is worth
  knowing about: 25 × 4 is exactly 100, so there is no headroom and the first
  centimetre past `falloffNear` costs a whole round. Anything that moves either
  `damage` off 25 moves a boundary by tens of metres.

**Fall-off on the carbine quantises, and that is the one place these numbers are
placed rather than chosen.** Every other weapon degrades a round at a time; the
carbine has all three rounds cross the threshold together, so a burst kills
while the round makes 33.4 and does not the moment it does not — 0.1 s to kill
becoming 0.5 s, a 5x cliff crossed in one step. The drop from 34 to 33.4 is 8%
of the ramp's fall, so **the breakpoint sits just past `falloffNear` almost
regardless of `falloffFar`**: moving `falloffNear` is how you move the cliff and
`damageFar` barely touches it. It is at **39.6 m**, which is where the weapon's
own entry already says it runs out. An earlier version ran 20 → 55 and put the
cliff at 22.9 m while claiming 55 in its own comment, so: **quote the breakpoint
when any of those three move, never `falloffFar`, and re-derive it rather than
assuming it followed.**

## The head zone

A round inside `CONFIG.combat.headRadius` (0.22 m) of the target's `eyePos` is
worth `headshotMult` (2). The rifle and the pistol kill in two, the SMG in
three, the LMG in three, and **the DMR kills in one at any range** — the reward
its `semiAuto`, its 2.2 recoil multiplier and its exemption from fall-off have
all been asking for. It costs a scope, a 3/s ceiling and a 22 cm target.

**The sniper is the one weapon this column does nothing for, and that is the
decision rather than an oversight.** It kills in one on the BODY, so there is
nothing for a head hit to upgrade and the sphere is never a candidate — but the
two one-shot kills are still different weapons, and the difference is exactly
what the multiplier is. The DMR's is a 22 cm target you may take three times a
second; the sniper's is a man-sized one you may take once every 1.25 s, and the
cycle is what that costs. A one-shot kill that had to be a head hit AND cost a
bolt cycle would be a weapon nobody could justify carrying, which is why the
sniper's `damage` is 100 and not 51.

Three things about it are structural rather than tuning:

- **It is the PLAYER's, by construction rather than by a check.** Bots aim at
  `t.eyePos` — the point the zone is centred on — so a head sphere their rounds
  could reach would make every accurate bot shot a headshot and halve a tuned
  bot TTK overnight. `ShotOptions.headMult` is what turns it on; only
  `Player.shotOptions` sets it, and at 1 or absent the sphere is **never
  ray-tested**, so the sixteen shooters without the feature pay nothing for one.
  A friendly-fire or PvP mode would need one field changed and nothing added.
- **It is an upgrade to a body hit, never a candidate of its own.** `center` +
  `hitRadius` 0.75 already encloses the head, so a head sphere entered the
  nearest-hit search only to lose it; testing it after the body hit resolves
  costs one sphere per round that LANDED rather than one per target per shot,
  and it cannot create a hit that the body sphere did not already register. The
  ~12 cm of crown standing above that sphere stays unhittable exactly as it was
  — reaching it would be a change to every bot's silhouette smuggled in under a
  player feature.
- **Fall-off applies first.** A headshot at 100 m with the rifle is 44, not 60.
  The head multiplies what the round did, and what the round did is a function
  of how far it flew.

It works under crouch for free: `center` and `eyePos` ride the one blend, so a
crouching player's head comes down with the rest of them.

Feedback is split deliberately. `HUD.flashHitmarker` lets a **kill outrank a
head hit** on screen, because of the two things the marker can say, "this one is
going down" is the one that changes what you do next — and the two would
otherwise fight over the same four ticks. The ding (`Sfx.headshot`) plays
regardless, and that is where the read actually lands: it is two sines with no
noise in it at all, precisely so it cuts through a burst of ordinary markers
instead of merging into them.

**The carbine is the third question the trigger can be asked, and `semiAuto` and
`burst` are why there are three.** `semiAuto` asks whether the trigger has to come
UP between pulls; `burst` asks what one pull SPENDS. The rifle and the SMG answer
neither, the DMR and the pistol answer only the first, and the carbine answers both
— nothing may answer `burst` alone, because a burst weapon firing on a held trigger
is an automatic with a stutter in it. Its three rounds at 34 are 102 against 100 HP
and leave in 0.1 s, the best ideal time to kill in the game by a factor of three,
and the whole of the price is `burstCycle`: 0.4 s in which the weapon will not
fire, spent identically whether the burst killed, missed, or landed two of three.
That is the error budget again in its harshest form — a missed rifle round costs
0.125 s and a wasted carbine burst costs half a second — and it is what keeps the
sustained figure (6 rounds/s, 204 dps) the worst of the four automatics.

**A burst in flight is the one thing that fires with the trigger up, and that is
what makes it a mode rather than three fast rounds.** `Player.burstLeft` is the
whole of it: the pull spent all three, so the remainder leaves on the weapon's
clock and the release cannot stop it — a burst that stopped when the finger came
up would stop mid-burst on every tap, which is not something a player could aim.
Two rules keep it honest. The `fireCooldown` test comes FIRST, before the guards,
because mid-burst that cooldown is the gap between rounds rather than a refusal.
And the guards then ABANDON what is owed rather than banking it: a reload, a
sprint, a swap, an empty magazine or a death drops the remainder on the floor,
because a burst that resumed after any of them would fire seconds later out of a
weapon the player has since reloaded, holstered or died holding. `fullReset` clears
it for the one case the guards cannot see — `dying` stops `tryShot` being called at
all, so a body killed mid-burst would otherwise owe rounds to the next life.

**The DMR steps outside that too, and `semiAuto` is why it can.** Two rounds at 3/s is
0.333 s — the best ideal TTK in the kit — but the rate is a *ceiling on the trigger
finger* rather than a cadence, and the error budget pays for it: a missed rifle
round costs 0.125 s, a missed DMR round 0.333. The recoil is the second half of
the bill, and since `recoilImpulse` was split out of `recoilMult` it is mostly
paid in TIME rather than in angle: 1.49° of muzzle rise, of which 93% settles
out (`recoil.recoverFraction`), on a spring that is still moving 367 ms later — and then a hold opened to 1.72× and quickened 2.2-fold for
0.85 s while the shooter re-settles. That also makes a high `bloomMult` cheap:
at any deliberate pace the bloom has bled off before the next round leaves.

**The LMG is the third weapon you simply hold the trigger down on, and the only
one here that does not have to stop; every other number on it is the price of
that.** Seventy-five rounds is
fifteen kills and seven and a half seconds of fire; the rifle's twenty-four is six
kills and three seconds. What makes that affordable is that the ARITHMETIC is a
wash and only the timing differs: 24 damage at 10/s is 240 a second, exactly the
rifle's 30 at 8/s, and the duty cycle matches to within a percent (3.0 s of fire
against 1.4 s of reload is 68%; 7.5 against 3.4 is 69%). Two weapons deliver the
same damage over a minute, and the one that never has to stop in the middle of a
fight is choosing WHEN, not how much — which is worth exactly as much as the fight
in the middle of the rifle's reload was going to cost.

The bill is the two things it cannot do, and both are the worst figures in the
kit. It cannot start a fight — `adsSpeedMult` 0.55 and `drawTime` 0.95 against the
sidearm's 0.34, and a hip spread of 0.115 that makes firing it unaimed a way of
saying where you are. And it cannot recover from being caught empty: 3.4 s is more
than twice any other reload, in a game with no reserve ammunition, which is the
[sidearm](#the-sidearm)'s case made by a second weapon rather than by argument.

`bloomMult` is the one number on it that is a reward, and it is what makes the
magazine mean anything: at 0.5 the bloom ceiling is 0.015 against the rifle's
0.03, so the aimed group opens to 0.023 rad and stops, and the fortieth round of a
burst lands where the fourth did. A weapon that bloomed like the rifle would carry
seventy-five rounds and have nothing to do with the last fifty. `recoilMult` 0.7 is
the same argument on the other axis: at 10 rounds a second the rifle's own kick is
0.24 rad/s of settled climb, and 0.168 is the gentlest in the kit — a burst you steer
rather than one you abandon. Its `recoilImpulse` of 0.9 is the same trade read
the other way: a full-power belt round, most of it soaked by the weight of the
gun, so the settle is 150 ms and the sight is back between rounds at ten a
second — but it is the highest shake equilibrium in the kit (1.41), because at
that rate the disturbance never fully clears.

The trigger latch lives in **`Player.tryShot`, which takes the trigger rather than
being called behind it** — a semi-automatic has to see the trigger come *up*, and a
caller that only speaks while it is down can never report one. The latch is set
*before* the alive/reloading/sprinting guards, so a trigger held through a reload
does not fire the instant the reload ends. It belongs to the FINGER, which is why a
swap keeps it (a trigger held across one still needs releasing) while the burst,
which belongs to the weapon, goes with the weapon.

- **Every weapon and every optic is built once; all but one of each is
  `setEnabled(false)`.** A loadout change is a handful of boolean writes and a
  re-derived `adsPos` — never a rebuild, which would happen inside a deploy screen
  and drop Player's muzzle flash on the floor.
- **The muzzle and the ejection port are the VIEWMODEL's nodes, not the model's.**
  A model's landmarks are `Vector3`s and `ViewModel` moves its own two nodes to
  whichever weapon is carried; Player's flash is parented to one and its brass thrown
  from the other, and neither may hang off a rig that can be switched off underneath.
- **The flash hangs off the viewmodel but is not one of its meshes, so putting the
  weapon away has to END it rather than hide it.** `ViewModel.setVisible` walks
  `meshes` — every weapon's parts and both arms, and the throwing arm with them —
  and the flash petals are Player's, so the call does not reach them. The clock
  that retires them is `updateGunfeel`, which is inside `Player.update` and so
  stops the instant `updateGameplay` does. Nothing may fire while the weapon is
  stowed, which made this look self-managing; being stowed *part-way through* a
  flash is the case that was missing, and dying inside the 50 ms of one hung the
  star — in the viewmodel's depth-cleared group, so over everything — in the middle
  of the screen for the whole death cam. `Player.applyVisibility` zeroes `flashT`
  and disables the root whenever the body is hidden, which is the one funnel every
  caller already goes through. Anything else transient that Player parents to the
  camera owes the same.
- **Each weapon carries its own arms.** Where a hand grips is the model's business
  (`WeaponParts.grip`/`support`) and the forearm's geometry is baked along the
  hand-to-elbow line, so an arm cannot be translated onto a shorter gun.
- **Zoom compensation is a uniform scale about the camera's origin.** Past
  `viewmodel.adsMagReference` the weapon is scaled down *and* drawn proportionally
  closer — `adsPos` and `weapon.scaling` take the same factor — which changes no ray
  direction, so the sight stays on the axis and only the apparent size is held still.
  Without it a 3.5x optic magnifies the receiver across the whole screen.
- **The additive pose offsets take that factor too** (`ViewModel.off`). Sway, bob,
  airborne give and kick are metres in the *camera's* frame, and a compensated weapon
  is drawn closer, where the same metre is a much bigger angle; left unscaled, a flick
  of sway that nudges the holo swings the scope's bore off the axis. Rotations are
  exempt — the weapon turns about its own root, so the displacement already scales.
- **The scope is a real hollow tube, so its own weapon can get into the picture.**
  A view cone spreads with distance and runs onto the barrel; the tube's height above
  the rail, its length and the scope's omission of the folded front iron are all set
  by that constraint, not by looks. How much of the frame is clear is set by the far
  rim's angular size, which is why a long eye relief turns the picture into a keyhole.
- **An optic's size and its eye relief are ONE number.** Everything the eye gets
  from a sight is angular, so halving an optic *and* the distance the eye is held at
  leaves the picture identical to the pixel while the thing on the weapon is half the
  size. `optics.ts` measures every dimension against `eyeDistance(id)` =
  `CONFIG.sights[id].eyeRelief / viewmodel.scale`; changing one alone re-sizes the
  picture instead of the sight. Two floors bound it: the camera's near plane (`minZ`
  0.05 against a stand-off of `eyeRelief * zoomComp` — the scope's 0.17 buys ~0.02 m
  of margin) and the cone's clearance over the rail, which is what the rises are.
- **`eyeRelief` has to RISE with magnification or the near plane eats the
  eyepiece, and that is the least obvious rule in this file.** The stand-off is
  `eyeRelief * zoomComp` and `zoomComp` is `adsMagReference / magnification`, so
  the two move against each other: the 3.5x's 0.17 buys 7.8 cm, and the same
  0.17 at 6x would buy **4.5 cm** — inside `minZ`, which clips the ocular open
  and turns the tube into a hole in the air. The 6x states 0.22 for that reason
  alone and measures 5.87 cm. A longer relief is also what makes it the biggest
  optic in the kit, since every dimension is measured against `eyeDistance` —
  which is the honest way round for the one that should look like it weighs
  something.
- **Past about 4x the RAIL stops being what bounds the cone, and the solve
  inverts.** `PRISM_CONE` is derived from its rise because the rail is the
  binding constraint at 2.5x; run the same solve at 6x and it comes out at
  0.0967, which is 1.13 of the screen's own half-height — a sight picture with
  no rim in it at all, which is not a scope, it is the absence of one. A higher
  magnification is a narrower aimed FOV, so the same angular cone fills more of
  the frame. `LONG_CONE` is therefore authored against the FRAME (0.072, which is
  0.84 of the half-height, against the 3.5x's 0.674 and the prism's 0.506) and
  its rise is set by the objective bell's own radius instead, with the rail's
  inequality satisfied comfortably as a consequence. **A bigger, heavier optic
  showing MORE of the frame is the intended reading**: the tunnel is the 3.5x's
  character, not a tax every scope owes.
- **A straight tube is the worst shape to spend the cone on** — a cylinder wide
  enough not to clip at the objective is far wider than the cone needs at the
  eyepiece, which is how the scope became a drainpipe. It is built as
  `SCOPE_SECTIONS` steps, each only as wide as the cone is at *its* far rim. Anything
  clamped to or standing on the tube is sized by `outerAt`, which reports the
  section's radius rather than the cone's.

**The optics are built against the weapon, not for it.** `optics.ts` takes an
`OpticMount` — the rail's height, where along it the sight sits, and its two back-up
iron stations — and measures everything from those four numbers, so the SMG's
shallow receiver and the DMR's deeper one carry the same sights with nothing
re-tuned. Adding a weapon is a config entry, a model builder returning
`WeaponParts`, and an `OpticMount` (or, with no rail, a `fixed` sight assembly);
adding an optic is a config entry and a builder in `optics.ts`. Both are checked
by a `Record` that does not compile with a member missing, so neither can be
half-added.

**The whole grid is checkable off the scene with no round and no map**, because
every weapon and every optic is built in `Game`'s constructor. Two readings are
worth taking after touching either table, and both were taken for the 6x: every
`sightCenter` must sit on its weapon's own x axis (36 of 36 did), and a disc of
rays down each optic's cone must find none of the weapon under it (0 of 72
blocked, on all six weapons). `VERIFYING.md` has the method, including the trap
that makes twenty-three of twenty-five combinations read wrong.

**The mount is not free, and the DMR is where that shows.** Two of the four numbers
are bounded by the optics rather than the receiver: the scope's cone reaches the
rail's ribs at about z = 0.59 and the holo's reaches the FOLDED front iron leaf at
about z = 0.53, which is why the DMR's rail stops where it does and why its front
iron station sits no further out than the rifle's despite a longer receiver. The
extra sight radius a marksman rifle wants comes out of the rear station instead;
`DmrModel.ts`'s `MOUNT` documents both.

**The carbine is that constraint answered by the layout rather than paid for.** A
bullpup keeps nothing above the rail forward of the mount — no gas block standing
proud, no folding leaf on the end of a long rail — so the cone would carry a folded
front iron out past z = 0.5, and what stops the station short is the rail itself
ending at the gas block because the barrel is exposed from there on. The rear
station is where it wins: the receiver runs to the butt pad, so the aperture sits at
-0.28 where the rifle's stops at -0.185 and there is still stock behind it. 0.60 of
sight radius out of a weapon 0.96 long, against the rifle's 0.715 out of 1.25 — the
same trade the layout makes everywhere else on it.

**Its carry handle is the same rule from the other side, and is why that handle has
no bridge.** The model is a FAMAS, whose one unmistakable feature is a triangular
handle over the barrel with the sights in a tunnel through it — and a tunnel is
exactly what `RAIL_REACH` forbids, since nothing forward of the mount may stand
above `railTop` without sitting in the middle of the scope's picture. So the handle
is cut off at the sight line: a blade running the full depth from the barrel to the
rail's underside, with the rail as its top face, which is what the flat-top variant
of that weapon did for the same reason. What carries the silhouette instead is
everything BELOW the rail, where there is no cone to answer to — the blade and the
raked strut onto the gas block, a full-hand trigger guard drawn around the
viewmodel's own glove, and a bipod folded down the handguard's flanks.

**The LMG is the third weapon that rule has shaped, and there it took the rail
apart.** A belt-fed carries two things on top of the barrel that nothing else here
does — a folding carry handle and a front sight standing well forward — and both
are above `railTop` where a real one puts them, which is the middle of the scope's
picture. So the handle is hinged at the front and folded back down the barrel's
LEFT flank, under the sight line, and the rail is split: it runs the length of the
feed cover and stops with it, and what bridges the gap to the front iron station is
a tower standing on the barrel whose top face IS `RAIL_TOP` and no higher. That
split is also the honest read of the weapon — the barrel comes off a machine gun,
and nothing that is lifted away mid-fight may carry the optic — which is the same
bargain the carbine's handle struck: the constraint answered by the layout instead
of paid for.

**Read from the optic's side, that is one constraint and `RAIL_REACH` is it: how
high a sight is carried and how wide its picture is are ONE decision, not two.**
A view cone spreads with distance and the longest rail here (the DMR's, to
z = 0.57) is what it runs onto, so a new optic gets `rise >= cone * (eyeDistance
+ RAIL_REACH - its ocular offset)` and no freedom left over — the reflex's window
HEIGHT and the prism's `PRISM_CONE` are both that inequality solved rather than
authored, which is what stops them going quietly wrong the next time a rise or an
eye relief moves. What is left over is the daylight under the picture, and it is a
named constant either way. The width of a window is free (nothing on a weapon
stands out sideways) and the irons are exempt: what you see under the post through
an aperture is meant to be the weapon.

**The irons bound the weapon from the other end, and that is what the stock's
heights are.** An aperture's eye relief is over half a receiver's length, so the eye
sits BEHIND the butt and everything on a stock stands in the one part of the picture
there is no looking around. `optics.ts` exports `ironSightFloor` — the underside of
the cone from the eye to the rear ring's bore — and `DmrModel` derives its comb from
it, with the butt and spine hung off the comb. A cheek riser over that line does not
clip the sight picture, it *is* the sight picture, which is what the DMR shipped
with; a comb is adjustable precisely because irons and glass want different heights,
and this is it at the bottom of its travel. Forward of the rear station the cone
runs onto the rail and the front sight's base, and that is correct.

### The sidearm

**Every loadout carries a pistol, reachable two ways.** The mouse WHEEL swaps to
the other weapon and so does pad **Y**; `1` and `2` name a slot outright (primary,
sidearm). `drawSlot` refuses a request for the weapon already up, so a second press
of `1` costs nothing rather than replaying the animation. `InputManager` normalises
`deltaMode` and gates on `input.wheelStep` before calling a wheel event a notch, or
a trackpad's inertial fling swaps repeatedly after the fingers lift. The number keys
sit in the trap `BOUND_CODES` documents — crouch is Ctrl, and Ctrl+1/Ctrl+2 are
browser tab switches no page handler sees — which is the other reason the wheel is
named first.

The pistol is an ordinary `CONFIG.weapons` entry; the only thing making it a
sidearm is `entities/weapons.ts` keeping it out of `PRIMARY_WEAPON_IDS`. That split
is the one place the distinction is stated: the kit screen offers the primaries,
`SIDEARM` names the other, and the stat chart ranks against the primaries alone,
because a bar scaled by a weapon nobody can decline says nothing the player can act
on.

What it buys is not damage (25 a round at 5.5/s semi is the worst TTK here) but
`drawTime` 0.34 against the rifle's 0.55. **There is no reserve ammunition in this
game**, so a dry magazine is the problem the second slot solves: a third of a second
to a loaded weapon where a reload is one and a half. Refilling a slung magazine, or
making the draw as slow as a reload, removes the feature's reason to exist.

- **The two slots are an ARRAY, indexed by exactly the number on the key.**
  `PRIMARY_SLOT` is 0, `SIDEARM_SLOT` is 1, so what `1`/`2` name and what
  `Player.slot` holds are one fact with no table between. `drawSlot` is the single
  entry point; `swapWeapon` is "the other index".
- **Each slot keeps its own magazine, in a `Holster`.** A weapon put away half-empty
  comes back half-empty. `Player.ammo` is an accessor onto the carried holster rather
  than a field, so no mirrored count needs keeping in step. Both are refilled by
  `fullReset` and nothing else — the slung one explicitly, since only the carried
  weapon is reachable through `startReload`.
- **The swap is a gesture with the exchange buried inside it**, the same shape as
  the [grenade throw](grenades.md): `Player.swapT` counts up, the pose is a TRIANGLE that takes the
  weapon fully out of frame, and `completeSwap` fires at
  `viewmodel.swap.switchFrac` — at the peak, where nothing is on screen to see the
  models change. The drop must clear the bottom edge (`viewmodel.swap` sizes it
  against the FOV) or the swap is one model popping into another.
- **Nothing fires or reloads while it is in flight**, and a reload in progress is
  cancelled rather than remembered — the magazine being worked on is going away with
  the weapon. The trigger latch survives, because it belongs to the finger.
- **Its glass is not a choice, and that is a SHAPE rather than a convention.**
  `WeaponParts.sights` is a `WeaponSights` union: `fitted` (a rail — one assembly per
  optic) or `fixed` (the notch and blade machined into the slide). `wornSight`
  resolves the fitted request into the worn answer and `ViewModel.applyFit` is its
  only caller, which keeps the aimed pose, the zoom compensation and — through
  `carriedSight` — the camera's FOV all derived from one sight. A pistol aimed down a
  3.5x scope's FOV is the mismatch the union makes impossible to spell.
- **`Player.onCarryChanged` is how the rest of the game hears about it.**
  `Game.applyCarry` pushes the camera's fit, the HUD's caption and the HUD's stowed
  row, and all three things that change the hands — a kit pick, a swap completing, a
  fresh body coming up with the primary — reach it without remembering to.
  `applyLoadout` is the kit's own path; the deploy and kit screens keep naming the
  PRIMARY.
- **The slot that is DOWN is readable too** (`slungWeapon`/`slungSlot`/`slungAmmo`/
  `slungMagSize`), and nothing about firing depends on it: it exists so the HUD can
  say the second slot is there at all. A weapon the viewmodel never shows and the
  ammunition readout never counts is one a player can carry a whole round without
  finding, which is the sidearm's own failure mode — see [`ui.md`](ui.md).
- **`hipY` is the sibling of `hipZ`, and the pistol is why it exists.** The hip pose
  is authored around the reference weapon's bore and every long gun carries its bulk
  *above* that line; a pistol hangs below it, hands and all. Measured on 1280x720:
  without it the grip and both fists are outside the frustum.

`PistolModel.ts` is the one weapon builder that does not call `optics.ts` — a 1911
has no rail, and what stands on the back of its slide is a square notch, not the
rear aperture every optic here is built around. It still reports a `sightCenter` and
`applyFit` derives the aimed pose from it exactly as for a holo, so the eye
reference is not duplicated; only the geometry in front of it is the weapon's own.

The kit screen (`src/ui/LoadoutScreen.ts`) owns its DOM under `#hud` and is a
`loadout` game state — a lid over `menu` or `deploy`, which closing puts back. It
is reachable from the **main menu and the deploy screen** (a button, `L`, or
gamepad X) and deliberately not from the pause menu: a round you are already
standing in is not somewhere you change what you are carrying. That is the
`covers` list on `loadout`'s row in `SCREENS` (see [`states.md`](states.md)),
which is what refuses the raise. Every pick applies immediately through `Game.applyLoadout` and
persists to `localStorage` like the difficulty tier, so confirm just closes.

- **The weapon on the stage is read against a CARD, and the card is in the scene**
  (`CONFIG.viewmodel.inspect.backdrop`, built by `buildKitBackdrop`). What used to
  fill the stage was the live map: off the menu that is empty sky and reads as a
  bench, off the deploy screen it is a lit village at the exact tone of a grey
  receiver. It cannot be fixed in the stylesheet — the stage is a hole in the
  scrim precisely because every point of DOM alpha over it is a point off the
  weapon — so the card hangs *behind* the weapon instead, sized to the frustum
  from the same fov and aspect that place the weapon. See
  [`rendering.md`](rendering.md) for the draw-order rules that keep it between
  the two.
- **The stat bars are derived from the table**, each weapon's figure against the
  best any weapon has, so a third weapon re-scales the chart instead of dating it.
  Accuracy is the aimed spread *inverted* — a bar that grew with the number would rank
  the SMG as the accurate one.
- **The buttons that OPEN the screen fire on `pointerdown`, not click**, the same
  edge every button that *leaves* a screen uses. It was once load-bearing — the
  menu's confirm was "a mouse button went down anywhere", read from the button mask
  on the next tick, which happens before a `click` (mouse *up*) ever fires, so a
  click that asked for the loadout also deployed the player out from under it. The
  pointer is no longer in that confirm, so this is now consistency rather than a
  fix. Buttons *inside* the screen can use `click` safely.

On the keyboard, d-pad and left stick the screen splits the axes: up/down chooses
the slot, left/right steps through it (the menu behind keeps left/right for
difficulty). Enter, pad **A**, pad **B** and `L`/pad Y all close it — every pick is
already applied, so there is nothing for a confirm and a cancel to disagree about.

## Procedural models

`RifleModel.buildRifle()` merges its ~150 static parts into one mesh per colour
(BODY/POLYMER/METAL/RUBBER/BRASS) — that merge is what makes the outline pass draw
one border per colour group instead of a black shell around every screw, and it is
what makes detail nearly free: one draw per colour however many boxes go in. A
colour missing from `SECTIONS` is silently never merged, so anything `collect()`
takes has to be listed there. The merge works only because the root is still at
identity while building.

**A RAKE is a `Build.pivot`, and its SIGN is decided by which WRIST holds the
part.** Positive `rotX` sends everything below the pivot BACKWARDS, which is the
direction `magDropAxis` already reads it in. A rake leans AWAY from the wrist
that holds it, so the two hands' grips lean APART:

| | sign | toe goes |
| --- | --- | --- |
| every `gripPivot` — the firing hand | **positive** (0.18-0.34) | back, the 15-20 deg off vertical a pistol grip stands at |
| every `foregripPivot` — the support hand | **negative** (-0.16 to -0.45) | forward, which is what an angled foregrip is |
| a magazine (`MAG_RAKE`) | **negative**, or the pistol's own grip rake | forward, because a curved magazine feeds a receiver ahead of it — `magDropAxis` reads the same sign, so it leaves along its own body |

Get a firing grip's sign wrong and the toe lies out over the trigger guard — a
grip on backwards, and the thing to check first if a weapon reads as a toy. Get
a foregrip's wrong and both grips lean the same way, which reads as a mistake in
one of them rather than as a style. All five long guns carried the firing grip
inverted until it was caught from the kit stage, and three foregrips with it;
the comments beside three of them had by then rationalised it into a feature, so
trust the table over the prose.

**A merge is also how a part is let OUT of the weapon.** `merge` swaps the
accumulator, so a builder that wants a piece to move on its own builds it after
the weapon's own merge and merges it into a node of its own — which is what the
optics have always done and what the **magazine** now does. That node sits at
identity, so the merged geometry lands where it was built and its
`position`/`rotation` are pure offsets from seated. It costs one more merged mesh
per colour the magazine uses, on a rig that is disabled unless it is the carried
one. The LMG's `magazine` is its belt box **and the belt** — a belt is fed from
the box it is coiled in, so swapping the container and leaving a run of brass
hanging out of the feed would be a reload that loaded nothing — while `boxMount`
stays with the weapon, since the fresh box needs a shelf to hang from. The
pistol's is the only one built with geometry a seated magazine never shows: its
magazine is up inside the grip, so the body is there to be seen on the way out
and sized clear of the grip's walls on every face.

**A colour group is also the unit a FINISH repaints**, which is the second job
the merge does: `merge` records which group each merged mesh came from and
`takeFinish()` hands the list back at the seam between the weapon and its
optics. See the finish section above for what that buys and what it deliberately
leaves out.

**A colour group is a ROLE, not a material, and the four names are misleading
about exactly that.** `POLYMER` is the FURNITURE — its own comment in
`weaponKit.ts` lists what belongs to it and the list is roles: lower receiver,
grip, magazine, handguard, stock. `METAL` is the ACCENT: rails, sights, the
charging handle, small fittings. A finish is written against that reading —
`finishes.ts` puts a scheme's brightest colour on `METAL` (Frostbite's steel,
Voltage's cyan, Bullion's gold) because it expects to be lighting up rails and
pins, and `finishSwatch` reads the three groups as "furniture, receiver,
fittings" in the eye's own order.

So a part goes in the group that matches what it IS ON THE WEAPON, never what
it is made of, and **the sniper is where that was got wrong**: a chassis rifle
is machined where the rest of the kit is moulded, so its lower, its free-float
handguard, its skeleton stock and its magazine were all built in `METAL`. That
is honest about the alloy and wrong about the paint — measured as painted
surface area it put **49.9% of the weapon in the accent group against a kit
running 11.5-16.3%**, and left the furniture group at **5.2% against
27.2-46.8%**.

**The GLOSS is the half that made it read as a different gun rather than as a
lighter one**, and it is the reason a group swap is the fix rather than a
recolour. `METAL` is the rung the ladder's top lives on: six of the sixteen
schemes state `rifleChrome` on it — blued, quicksilver, voltage, frostbite,
obsidian, bullion — so under those six half this rifle was not merely the
lightest colour in the scheme but the only MIRRORED surface at that size in the
kit. Photographed on the turntable in Voltage the chassis, handguard and stock
clipped to white while the DMR standing beside it stayed teal. Nothing about
the finishes was wrong; they were being asked to accent half a weapon.

The four parts are `POLYMER` now, part for part as the DMR's
`lower`/`handguard`/`stockTop`/`stockBottom`/`buttPlate`/`mag` are, which puts
the sniper inside the kit's band on every group (BODY 39.7%, POLYMER 37.8%,
METAL 17.3%, RUBBER 5.2%). **What is machined about that rifle is said in its
SHAPE** — the skeletonised stock, the chassis flank, the bare tube — and a
finish is not the place to say it a second time.

**A colour group is free where it is unused, which is why BRASS is one.** `merge`
skips a group with nothing in it, so the LMG's exposed belt costs the other four
weapons nothing at all — and the belt has to be its own group rather than METAL,
because brass is the one thing on a weapon that is not part of the weapon and
merged into the fittings it would come out steel-coloured and steel-glossy along
with the rails.

**Nothing in the rifle may be scaled non-uniformly.** `VertexData.transform`
transforms normals *without* re-normalising them, and `renderOutline` extrudes each
vertex along its own normal — so a squashed part grows an ink shell that is fat on
the squashed axis. This is why the round shells (the optic housing, the muzzle cage)
are built by `shell()`, a ring of slabs each turned to its own facet, rather than by
stretching a torus. The primitives offer nothing else that would do: a capped
cylinder has no bore, and an uncapped one is a single-sided shell whose far wall
disappears exactly when you look through it. Facets cost nothing visually — the cel
shader flat-shades from screen-space derivatives. `ViewModel`'s arms follow the same
rule, with the wrinkle `mergeByMaterial` documents: a colour group of **one** mesh
has to be baked by hand (`bakeCurrentTransformIntoVertices`), and because that call
resets the local matrix, the part must be detached with `setParent(null)` first or
the aim node's transform is applied twice.
