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
parented to the camera and posed in camera space. **The arms are the player's own
and are cut like a squadmate's**: `facet.loft` sections in `SoldierModel`'s
`OWN_KIT` — the rig's `suit` on the sleeve, and the kit's `webbing` on the glove
rather than the rig's `suit`, because at the lens a glove the colour of its sleeve
on a near-black weapon has no wrist in it (`buildArm` carries the argument). Still
two meshes an arm, one per colour.

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
  - **A string cannot drive it past the SHOULDER** (`kick.stackCap`, 1.6 of the
    weapon's own single-round travel, applied as `RecoilShape.cap`). The rest
    of the model is an arrest and a haul, and neither is a wall: the haul is
    gated on a reaction that every round restarts, so at an automatic's rate it
    is barely running when a string needs it most. Measured on the shipped
    constants, a held submachine gun reached **3.03× one round's travel — 13.3 cm
    of receiver toward the eye** — with the muzzle flip riding the same number
    through **23°**, and a residual at each shot frame that climbed every round
    of the magazine. The cap is what lets `grip` and `haul` be set for how
    the motion reads rather than against a stacking budget, and it is what
    retired the measured `stackPeak` below.
  - **The z travel is 3.6 cm a round and was 7.2, which is the one number a
    shoulder argues about.** The case for making it the largest term is that in
    first person the camera cannot move backwards visibly, so the weapon
    arriving at the eye *is* what travel looks like from inside the head — true,
    and it still bought 7.2 cm on the rifle and 15 on the bolt gun before any
    stacking, on a weapon whose butt is against a shoulder that is what stops
    it. A mounted rifle barely translates; it ROTATES about the mount. Half the
    old travel went to `kickPitch`'s account (the flip, which this file already
    says to spend the budget on) and the rest to **`kickLift`**, the receiver
    coming up as the muzzle tips — stated on its own rather than as the
    `kickBack × 0.25` it used to be written as, because a shoulder compressing
    and a weapon pivoting in it are two things and only one of them halved.
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
    **Those figures are a floor rather than the current reading**: `kickBack`
    0.072 → 0.036 and `stackPeak` 2 → `stackCap` 1.6 took the travel this is
    derived against to 40% of what it was, and since what the bound spends is
    `min(authored, room)` the stand-off can only have grown. Every one of the
    ten sits further from the plane than the numbers above, and a re-measure is
    owed only if a term ever moves the other way.
  - **That damping made the aimed picture steadier than it has ever been, not
    less steady.** The kick had no ADS term at all before, which was survivable
    only because it had no lateral component either — but its `kickPitch` was
    applied at full, so an aimed shot tipped the sight **0.12 rad (6.9°)** at the
    peak. It is 0.036 rad (2.1°) now, and the lateral and roll that came with the
    drift arrive already damped rather than being added on top. Measured at full
    aim and full kick, the off-axis terms are exactly
    `kickPitch/kickSide/kickRoll/kickYaw/kickLift × kick.adsMult` and the travel
    is `kickBack × 1`; at rest all twenty-six sight pictures still read zero on
    the camera axis.
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
angle may be *larger* than the aim's: it comes and goes while the aim's own kick
is still rising, which is what lets the view snap harder than the aim does
without costing any control.

**And it was a STEP, which measurement found to be the jumpiest single thing in
the recoil system.** `punchT` was set to 1 on the frame the trigger broke and
fell from there, so the FOV spike, the camera shove and the yaw nudge all
arrived *whole* in one frame: sampled in the client at 144 fps, the field of
view opened **1.2° between two frames on every round**, against a 95th
percentile of 0.19° for every other frame of the same string. A cut repeated
eight to thirteen times a second is most of what "instant motions read as
stutter" is made of. It is a two-pole impulse response now
(`punchRise` 0.028 / `punchFall` 0.085, normalised in `CameraSystem` so one
round still peaks at exactly the authored amplitude), which puts its peak **46 ms
after the shot — the same moment the aim's kick and the roll beat reach theirs**.
One event should arrive once; three terms peaking at three different times are
three events as far as the eye is concerned. It also **accumulates**, which a
restarted clock cannot: a round landing on a punch still in flight adds to it,
where an envelope restarted from its own clock would drop to zero on the frame
of every round — the same cut with its sign flipped.

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
- **The beats are `Sfx.reload`'s and must move with them.** That sound is four
  events — catch, magazine out, magazine seated, bolt — and
  `magOut`/`magSeat`/`bolt` are three of them to the frame. What makes the
  gesture legible is that what you see lands on what you hear; a magazine that
  falls half a beat off the clack releasing it is two unrelated things happening
  at once. **Change a fraction in one file and change it in the other.** The
  sound is hung off `Player.onReload` rather than fired at a call site, because
  `startReload` is the one door a gesture begins through and it is reached two
  ways — the key, and the last round leaving the magazine inside `tryShot`. In a
  match that callback also announces the reload to the authority, so a second
  call site would be a reload fifteen other players never hear.
- **The middle two of those four are RECORDED and the outer two are clacks**,
  and that split was decided by the master rather than chosen: `magOut` and
  `magIn` are the two halves of one magazine change cut from
  `audio/src/reload.wav`, which holds a magazine stripped out of a well and a
  fresh one slapped home 2.4 s apart with the fetch between them, and has no
  clean catch or bolt release in it. A missing sample falls back to the clack it
  replaced, so the gesture has the same four beats on a device that never got
  the file. **It is one of the two mechanisms in the game that are recorded** —
  the bolt cycle below is the other, and there is no third —
  and [`docs/audio.md`](audio.md) is where the boundary that keeps it to two is
  argued.
- **`magIn` is scheduled by its PEAK and not by its start, which is the one
  thing a change here can silently break.** A magazine going home is an ARRIVAL:
  188 ms of it rising and rocking into the well and then the slap, which is
  exactly what `insertFrom`→`magSeat` draws. `Sfx` starts the file
  `MAG_IN_PEAK / actionPitch` seconds BEFORE `magSeat` so the recorded slap
  lands on the drawn one — measured across the whole kit at worst 1.5 ms off,
  against a 16.7 ms frame. Those two offsets are measured off
  `audio/manifest.json`'s trims, so **a change to a `trim.start` there is a
  change to a constant in `Sfx.ts`**, exactly as a change to a fraction here is
  a change to one there.
- **`actionPitch` and `actionVol` still voice both of them**, and for these two
  that is the opposite of the rule a report obeys rather than an inconsistency.
  A report's file is a recording of THAT weapon and has already made the
  deviation, so `report.pitch` is not spent on it a second time; one magazine
  recording is shared by every weapon in the kit and has said nothing about
  which one it is going into, so the field whose whole job is telling a belt
  from a pistol magazine is what it still has to be told. It stretches the
  approach as well as the pitch — the LMG's 0.68 makes it half as long again,
  which is a slower hand.
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
- **A SHOT FIRED THROUGH THE SIGHT LEAVES THE BOLT SHUT UNTIL THE SIGHT COMES
  DOWN** — Battlefield's rule. `tryShot` sets `Player.boltHeld` when the ADS
  button is down on a bolt gun's round, and while it holds `update` PARKS the
  fire clock rather than spending it: the trigger stays refused by
  `fireCooldown` exactly as it is mid-cycle, `cycleProgress` reads 1 so neither
  the roll nor the wobble moves, and the picture after an aimed shot is the
  scope held still on where the round went. Releasing ADS restarts the clock
  from a full `shotInterval` and raises `PlayerEvents.cycleBegun`, which is
  where `Sfx.boltCycle` comes from for that round instead of beside the report
  (`cycleTime` reads 0 under the hold). A reload or an empty magazine drops the
  hold with no cycle — the magazine change chambers the round — and a swap, a
  fresh weapon or a death zero the clock the flag is only read under, so it
  cannot be stranded. **This is the one piece of state the cycle owns**, and it
  moves where the wait is spent rather than adding one: the cost of the bolt
  is now leaving the glass, and a hip shot cycles at once exactly as before.
- **A CYCLE THAT IS RUNNING NEVER TAKES THE SIGHT PICTURE AWAY, AND THE COST IS
  SPENT ON THE AIM INSTEAD** — which after the rule above is the shooter who
  drops the sight and puts it straight back up. This is the one gesture in the file with no `aimBreak`, and
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
- **All four of those beats are RECORDED, and this is the one gesture in the
  game where the recording carries the TRAVEL as well as the arrivals.**
  `audio/src/bolt-cycle.wav` is one performance of exactly this gesture —
  handle up, bolt back, 1.86 s held open, bolt home, handle down — cut into
  four rows, one per beat, because `Sfx.boltCycle` places its beats as
  fractions of `shotInterval` and a recording's own timing is a fixed number of
  milliseconds. Shipped as one file it would agree with what is drawn here at
  exactly one `fireRate`; shipped as four it agrees at every one, which is the
  rule `magOut` already obeys one gesture over. Each beat falls back on its own
  to the clack it replaced, so the gesture is the same five events on a device
  that never got the files.
- **`boltBack` and `boltHome` are each scheduled by their PEAK and each carry a
  SLIDE in front of it** — 115 ms of the bolt travelling ahead of the rear stop
  and 133 ms of it running forward over the magazine — so the two synthesized
  slides are inside those two arms rather than on lines of their own. A
  recorded mechanism played over a synthesized one is the SMG's mistake in the
  report section below, and `boltBack` takes the CASE with it for the same
  reason: the two are separate beats here because filtered noise cannot be
  steel and brass at once, and on the tape they are the same millisecond.
- **`BOLT_LIFT_PEAK` is the tightest scheduling constraint in either gesture**,
  and it is worth knowing before `fireRate` is tuned. `mechanism` starts a file
  `peak / actionPitch` before the beat, `cycle.lift` is 0.16 and is the
  shortest window in the game, and at the sniper's `actionPitch` of 0.68 that
  approach holds up to a `fireRate` of 1.0/s against the 0.8 it ships. Past
  that the clamp in `mechanism` puts the lugs LATE rather than crashing, which
  is the quiet kind of wrong.
- **It is the only sound in the game that is a WAIT rather than an event**, and
  what fills that wait is why. Every other mechanism sound here is a thing
  arriving, because every other gesture is over before the player has finished
  reacting to what caused it; a cycle is a second and a quarter of not being
  able to shoot, and four unrelated clicks with silence between them sound like
  a fault rather than like a rifle. The four cuts cover 40–1034 ms of the
  sniper's 1250 with one 22 ms gap in the middle of them, and that gap is the
  bolt sitting at the rear stop — which is the one moment in a cycle that
  genuinely is silent.

## The fire selector: two weapons carry more than one trigger

`CONFIG.weapons[id].modes` is a LIST of selector positions and `modes[0]` is the
one the weapon is carried on. Six of the eight entries state one position and so
have no selector at all; the rifle states `auto, semi` and the carbine states
`burst, semi`, and `B` or the d-pad's south walks the list. Everything about the feature falls out of
one decision: **`Player.tryShot` reads the POSITION and never the weapon.**

**A position resolves to exactly four facts** (`FireMode` in
`entities/weapons.ts`): `semiAuto`, `burst`, `burstCycle` and `shotInterval` —
which is precisely the set `tryShot` was already reading off the `WeaponSetup`.
That is why there is no branch anywhere and no `if` on a mode id in the whole
tree: switching is one index moving on the holster, and every rule the trigger
obeys was already being read through one object. The three ids are three answers
to the two questions the table's header has always asked — does the trigger have
to come UP, and what does one pull SPEND — so `semi` is yes/one, `auto` is
no/one and `burst` is yes/several. **There is deliberately no fourth**: a
no/several position is an automatic with a stutter.

**The position belongs to the HOLSTER, beside the magazine, and not to the
body.** A rifle put away on `semi` comes back on `semi` exactly as it comes back
half-empty, the sidearm keeps its own position regardless of what the primary is
set to, and the selector mirrored on `Player` would be the second source of
truth a swap has to remember. It also **survives a death**: `fullReset` refills
the two magazines and leaves this alone, because a selector is a decision a player
made about the weapon rather than a state a body was in, and one that snapped
back every life is one nobody can use. Picking a NEW primary builds a fresh
holster and therefore starts on `modes[0]`, which is right — it is a different
weapon.

**A position may state its own `fireRate`, and the carbine is the reason the
field exists.** `CONFIG.weapons.carbine.fireRate` is 20/s and has never been a
ceiling on a trigger finger — it is the rate INSIDE the burst, on a weapon that
delivers 6.4 sustained, which is exactly what `LoadoutScreen.sustainedRate`
exists to not chart. A `semi` position inheriting it would hand the fastest
clicker in the room three rounds in 0.15 s with none of the `burstCycle` the
mode is billed for, which is the best time to kill in the kit reached by
clicking faster. It states 6/s instead: three rounds is 0.333 s to a 102 kill, a
hair behind the rifle's 0.318 and with no dwell at the end of it, which is where
a position that dodges `burstCycle` belongs. **Everywhere else the field is
absent**, because the weapon's own figure already IS that ceiling — it is what
the DMR's 3.5 and the pistol's 5.5 have always been — and nothing is stated
twice. The weapon's figure stays on `WeaponSetup` for the two readers that want
the most permissive number there is: the bolt cycle's clock, and **the
authority's rate bucket** (`server/Match.ts`), where a bucket is a refusal and a
refusal has to be one no honest client can earn. A carbine on `semi` therefore
fires well inside a gate written for its burst, and the server needed no change
at all.

**What `semi` actually buys on the rifle is `Player.stringed` going false.** The
rate is unchanged — 9.43/s is what the weapon cycles at and the honest ceiling
on a finger too, so that position states no `fireRate` — and what moves is that
`firstShotMult` and the recoil pattern's taper both stop applying, which is the
one exclusion those two terms share. Every round is fired at full climb and
minimum drift rather than into a pattern: a tighter group per round and a much
worse one per second. That is the whole trade, and it is why the position is
worth having on a weapon whose auto fire was the thing it was tuned around.

**Three things are refused or abandoned, and each for a reason already written
down elsewhere in this file.** `cycleFireMode` refuses a weapon with one
position and a body that is dead or mid-swap — the selector being reached for
there belongs to whichever weapon the gesture lands on. A RELOAD is deliberately
NOT a refusal: the selector is the firing hand's and the magazine is the other
one's. And a **burst in flight is abandoned**, the same rule `completeSwap` and
the reload guards already apply — the rounds it still owes were promised by a
pull under the old position, and delivering them under the new one is the
mechanism disagreeing with the switch on top of it. The fire cooldown is left
alone, being the weapon's own dwell and already earned, and so is the trigger
latch: `auto` to `semi` under a held finger arms nothing, so the trigger has to
come up exactly as it would after any other pull.

**Both bindings are Battlefield 6's own**, which is why they are `B` and the
d-pad's SOUTH rather than the `V` an earlier generation of shooter would have
used. **What that game does with them is deliberately not copied**: there the
function shares a button with the laser, the flashlight and the scope's zeroing
and answers only while the sights are UP — a contextual binding this game has
nothing to put in the other contexts, since it has no laser, no torch and no
zeroing, and one players file bug reports about. Here the same two inputs do the
one thing, at the hip as well as aimed.

**The d-pad's south is free in a ROUND and spoken for in a MENU**, exactly as
its north already is: `InputManager` reads button 13 twice, once here and once
as `menuDownPressed`, and the two can never collide because the selector is only
walked from `Game.updateOnFoot`, which does not run under a lid. That is the
same arrangement `usePressed` documents for button 12, and it is what made a
d-pad direction available at all on a pad whose every face and shoulder button
is a verb (the table in `SettingsScreen` is the audit).

**There is deliberately no glass button.** A phone's HUD is already full of
verbs a body needs in every round, and **both weapons spawn on the position they
were tuned in** — so a player who never reaches this is playing the game the kit
was balanced for. The HUD says so in its own element rather than inside
the kit caption (`#fire-mode`, brighter than the label beside it, absent rather
than dimmed on a weapon with one position), because the label is what you picked
in a menu and the mode is what the trigger will do on the next pull. The kit
screen prints the whole list on the weapon's button — `auto / semi` against
`burst x3 / semi` against a bare `semi` is three different guns, and that is a
comparison owed before deploying rather than after.

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

**Two fields on that row are not scalars and neither is a deviation.** `sample`
names a RECORDING that stands in for the eight (see below), and `mix` names the
weapon's own fader on the audio mixer (`CONFIG.mix.channels`,
[`audio.md`](audio.md)) — **which is not `level` restated.** `level` is a claim
about the weapon, part of the eight, spent on the synthesis and on the
recording alike; `mix` is what that gun turned out to be worth against the
other six once they were all in one firefight, set by ear in a live round. A
weapon that set one from the other has said nothing, exactly as
`recoilMult`/`recoilImpulse` have not.

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

**There is a NINTH field and it is not a scalar: `sample`, which names a
RECORDING that stands in for the five layers.** Every weapon in the kit sets it
now — seven rows, seven files, and nothing else in the game is recorded at all
(see [`docs/audio.md`](audio.md) for where that boundary is and what it costs).
The rifle's is still the load-bearing one, because `Sfx`'s `FLAT_REPORT` is
that row: every bot on the map fires the rifle, so removing that one file is
not the same size of decision as removing any of the other six.

**The field is still OPTIONAL, and that is not vestigial.** A weapon added
tomorrow compiles with no `sample` on it and is heard as the synthesis, and
each of the six can be deleted on its own. Four things about it are
load-bearing:

- **It replaces the REPORT and nothing else.** The MECHANISMS are recorded
  separately or not at all — the reload's middle two beats and the bolt
  cycle's four are their own rows in `samples.ts`, and everything else about
  an action is still `actionPitch`/`actionVol` off the eight scalars — because
  this field's recording is of a shot. **The masters test this rather than
  merely permitting it**: three of the seven arrived with
  their own mechanism on the tape — the carbine and the LMG lead with 32 and
  50 ms of it, the SMG has a bolt-shaped arrival 12 ms after its report dies —
  and every one is cut off in `audio/manifest.json`. The SMG is the sharpest
  case, because its `actionVol` of 1.55 is the highest in the table precisely
  because a blowback SMG is mostly its own bolt; shipping the recorded one
  would play that mechanism twice.
- **Two of the eight still apply to it, and `pitch` is emphatically NOT one
  of them.** The eight scalars are DEVIATIONS from the reference report —
  that is the whole shape of `ReportVoice`, and why the rifle's row is all
  ones — so `pitch` says "this weapon's bore and charge, against the
  rifle's", and a recording of that weapon has already said it. **`Sfx` plays
  a sample at the per-shot wobble alone.** This was `v * voice.pitch` while
  the rifle was the only row and there was nothing to notice: its `pitch` is
  1. At seven rows the double-count is loud — the SMG's 1.42 would play its
  own file a fourth high and 41 ms short, the sniper's 0.6 would stretch a
  130 ms boom to 217 — so the affordance that one file could be pitched into
  a second weapon is gone, and it was only ever there because there was one
  file.

  What still applies is `level`, because a level is a mix decision rather
  than a claim about the weapon, and `tail`, because how hard a shot drives
  the VILLAGE is the game's question and not the recording's. The three the
  recording genuinely subsumes — `snap`, `weight`, `length` — are simply not
  read while it is playing, which is why those three still carry the whole
  argument for a weapon in `config/weapons.ts` and are not dead.
- **It is a PREFERENCE and never a requirement.** The fetch is fire-and-forget
  off `Sfx.unlock`, so a shot fired before the decode lands is the synthesized
  report and nothing is told which it got. Deleting the field is a complete
  revert; see [`docs/build.md`](build.md) for why that is the ground the one
  authored asset CLASS in the tree is admitted on.
- **`Sfx.botShot` puts the distance cues back by hand.** The synthesis carries
  them in its own filters — the top end stripped off as the shot gets further
  away — and a recording has none, so a lowpass sweeping from open to a thud
  rides over it. The flight time and the climbing reverb send were already
  outside the layers and are unchanged. A recording played louder and quieter
  is not a rifle at two distances.

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

## The loadout: six weapons, seven optics, sixteen finishes, and a sidearm

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
adding a weapon that sets a new best in a column** — the sniper's damage took
the rifle's damage bar to about a third of the width it used to draw, which is the
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
`camera.adsLookMouse|Stick / mag` (so the aim crosses the *screen* at the
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

**The rule was stated in `settle` and broken in `kick`, which is the term it
matters most for**, the weapon being the biggest moving thing in the frame. At
`gripAds` 95 / `grip` 65 the rifle's whole ATTACK was 27 ms braced and 40 at the
hip — 1.6 frames and 2.4 at 60 Hz — and measured in the client it was worse than
the arithmetic said: **18 ms to the top aimed and 36 at the hip, whole
excursions of 66 and 96 ms.** That is a strobe with the right curve behind it,
and it is most of what a report of recoil feeling jumpy and jerky rather than
heavy was describing. At 56/40, measured the same way, it is **39 ms and 56 ms
to the top and 101 and 145 ms end to end** — two and a half to three and a half
frames of attack, six to nine of travel. What normally makes that expensive is
stacking, and `stackCap` is why it is not: measured through the same held
triggers, the rifle's hip string tops out at exactly 1.60 of one round and the
SMG's at 1.056, which are the cap times each weapon's own `kickWeight` to three
figures.

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
jitter. At 34 and 88 ms they are three frames apart inside a nine-frame window
and read as what they are. Each also ARRIVES over `rise` (32 ms) rather than
jumping: `impulse` is all attack and no ease-in, which is the right shape for
something hitting and the wrong one at this rate, because an instantaneous jump
to full is a step in the pose and two of them per round at eight rounds a second
is a buzz rather than a mechanism. **A mechanism the frame cannot resolve is
noise, and noise is not more faithful for having the right timing.** `rise` was
20 ms — a little over one frame — and the amplitudes came down with it
(`backKick` 0.2 → 0.13, `homeKick` −0.13 → −0.08) for the same reason the
`grip` pair did: two beats a round arriving inside one frame each is a rattle
laid over the kick rather than a mechanism working inside it, and the carrier is
a fraction of the charge that was reading as a second recoil.

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
within 2.7x of the plane. The figure it is derived against used to be a
**measured** `stackPeak` (2), because a round landing mid-recovery restarts the
shooter's reaction and what a string stacks to therefore depends on the haul —
so it carried a standing debt to re-measure whenever `grip`, `haul` or
`riseTurns` moved, and it was never a bound but a report. **What it was
reporting at the hip is why the shoulder exists**: the ADS case it had been
measured in was honest (the carbine, 1.73×, every other weapon 1.00×), and at
the hip the same build drove a held submachine gun to 3.03× — 13.3 cm — while a
slower `haul` chosen for smoothness took it past 5×. `kick.stackCap` (1.6) is a
wall instead of a report, so the string cannot pass it however fast the weapon
cycles and this bound is exact. It is a multiple of the WEAPON's own travel and
not an absolute, or it would clip the bolt gun's single shot (2.10 kick units),
which is not a string and has nothing to stack against.


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
(0.55) takes the vertical down across `patternShots` (8) as a muzzle climbs and
then binds — and it is spent on BOTH axes, so a string changes how hard the
weapon kicks and never which way (see the angle section below, which is where
the second envelope this used to have died).
**The taper is not what makes a string level off** — `settle.reachAds` is, below —
and for one revision, at 0.25, it was, which is how the SMG came to sink.
So the first rounds of any string go nearly straight up — which is what makes a
tap precise and is the reason to tap — and a held trigger walks off sideways
about `yawBias`. Before it, the kick was the same vector on shot 1 and shot 20
and a spray was a straight line with jitter on it; the only shape available was
magnitude, which can be pulled against but not learned.

**The lateral itself is a SWEEP over the string now, and was an independent draw
per round** (`pattern.sweepShots` 17, `sweepNoise` 0.3). Eight to thirteen
independent draws a second on one axis is a muzzle that changes its mind: the
horizontal flipped sign on roughly a third of the rounds, and what a player
reads is an aim jumping in random directions rather than one walking somewhere.
A muzzle walks, and the reference footage shows exactly that — 0.40° of
rightward pull *building* through 22 rounds and springing back when the string
ends. So the lateral is a sine over the string counter with its direction drawn
once per string and its phase starting at ZERO, so a string opens on the
weapon's own bias with nothing added to it. It is a NARROW band about that bias
rather than a shape in its own right — see the angle section below for why a
sweep wide enough to read as a shape is a sweep wide enough to rotate the
kick. **It is not a difficulty change and that was
checked rather than assumed**: `yawBias` scales and offsets the sweep exactly as
it did the noise, so every round's mean lateral is unmoved and the rifle's
permanent drift over 22 rounds is 0.176° under both models. What moves is the
SPREAD across magazines — 0.11..0.24° where the independent draw ran
−0.01..0.37° — and the springy mid-string peak, up about 8% (0.65 → 0.72° aimed)
because five rounds pulling the same way go further than five rounds arguing.
Re-run that pair rather than scaling if `yawPerShot` or `recoverFraction` moves.

### The lateral is a WALK and only a little SPRING, and it used to be the other way round

**This is the one place in the kit where the footage lost an argument, and it
lost it to the thing the footage cannot show: what a lateral feels like to
hold.** The reference measures a horizontal that is nearly all spring — 0.40°
of pull built through 22 rounds and given back almost entirely when the string
ends — and `yawPerShot` 0.0109 was fitted to it. Played, that reads as the
reticle being thrown sideways and hauled back, and **making the direction
coherent made it worse rather than better**: five rounds pulling the same way go
somewhere five rounds arguing never did. Measured in the client through held
triggers at that figure, the rifle's springy lateral swung **0.67° aimed and
1.71° at the hip** before coming home, the SMG's 1.58° at the hip.

What was cut is the SPRING and not the lateral. Two numbers move as a pair:
`yawPerShot` 0.0109 → **0.005**, and a horizontal recovery fraction of its own,
`yawRecoverFraction` **0.905** against the vertical's 0.958 — so the share that
never comes back rises from 4.2% to 9.5% and **their product, which is the walk,
is where it was.** The argument for splitting them is not a knob: *a shooter
braces against a climb they knew about before the trigger broke*, which is most
of what a grip is and why nearly all of the vertical returns on its own; a
lateral cannot be pre-loaded against, is not known until it has happened, and
what a shooter does about it is re-aim. More of it is therefore aim and less of
it is spring.

Measured after, same probe, same strings:

| | swing (aimed) | swing (hip) | per-round sideways step | permanent walk, 20 rd |
| --- | ---: | ---: | ---: | ---: |
| rifle, before | 0.67° | 1.71° | 0.073° | 0.141° |
| rifle, after | **0.20°** | **1.00°** | **0.010°** | **0.185°** |
| SMG hip, before | — | 1.58° | 0.079° | 0.145° |
| SMG hip, after | — | **0.38°** | **0.020°** | **0.158°** |

The vertical is identical on every row (2.44 / 4.98 / 2.96° of sustained pitch,
before and after), which is the check that matters: **this is a change to what
the horizontal DOES, not to how hard the kit is to hold.**

#### …and then the ANGLE of a single round, which was the cosmetic all along

The report after that pass was that some rounds still threw the dot up and out
at about **45°** and came back. Measured per round through a held trigger, the
aim was not doing it: the aimed rifle's own kick rises **0.256° vertically and
0.035° sideways**, a 9° median, which is the "mostly up with a slight pull" the
kit is meant to have. **The punch's yaw alone peaked at 0.201°** — five and a
half times the aim's own lateral and four fifths of its vertical rise — and
because `punchLift` is 0 it was the punch's *only* angle, so every round carried
a purely sideways cosmetic jolt that rose and fell in a tenth of a second.

`punchSwing` is `punchLift`'s twin and **both are 0 for a gunshot, which
together say that a gunshot's punch HAS NO DIRECTION.** Every angle in a rifle
round is already stated where the bullets can see it — the climb in
`pitchPerShot`, the pull in `yawPerShot` and `yawBias`, the twist in
`rollBeat`'s fixed torque — so a cosmetic angle on top can only disagree with
one of them, and this one disagreed with all three at once. What sells a shot to
the eye is the three terms that make no claim about direction: the FOV spike,
the shove along the view axis, and the roll. **A BLAST keeps both**, which is
why they are per-event rather than smaller constants: a grenade *has* a bearing
and throwing the view off it is the whole point.

The second half was `pattern.sweepSpan`, which replaced a spread written as
`1 - |bias|` — a form that decided a weapon's lateral SPREAD entirely by its
pull, so the rifle at a bias of 0.35 wandered ±0.65 and its worst round landed
at 1.0, **three times its own mean**. Nothing physical couples them: torque is
what the weapon does every round, the spread is the shooter. At a span of 0.35
the rifle's lateral is 0..0.70 about a mean of 0.35 — *every round pulls the
same way and what varies is how hard* — and the mean is untouched on every
weapon, so the walk above is exactly what it was.

Per-round vector, measured, aimed rifle through a held trigger:

| | rise | across | median angle off vertical | p90 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| original | 0.257° | 0.635° | 72° | 74° | 77° |
| after the walk/spring split | 0.256° | 0.354° | 59° | 63° | 63° |
| after both of the above | 0.257° | **0.029°** | **7°** | **12°** | **14°** |

A single aimed shot measures **1°** — a tap is dead vertical. At the hip it is
9° median (16° on the SMG), and the sustained pitch plateau is 2.44° on every
one of those rows, unchanged. **The two outliers either table shows at the last
round of a string are the metric and not a kick**: the window for round 20 runs
past the end of the string, so it catches the axis hauling back to centre.

#### The last of it was the kick vector ROTATING, and two of these mechanisms were doing it

Even at a 7° median the report was that the kick *oscillated* — "it starts
recoiling vertically, then tilts until it is kicking at 45 degrees, then tilts
back to vertical." Measured per round and read **in round order** rather than as
a distribution, which is the reading that shows it, the aimed rifle went:

```
2° 2° 4° 7° 9° 9° 12° 11° 10° 10° 5° 5° 2° 3° 3° 6° 5° 9° 10°
```

and the hip 1° → 16° → 6°. Two mechanisms, both mine, stacked:

1. **The two ENVELOPES crossed over.** The lateral ramped 0.3 → 1.0 while the
   vertical tapered 1.0 → 0.55, which rotates the kick vector through the
   opening of every string by construction — a factor of six over eight rounds.
   That was deliberate: a muzzle that can no longer rise goes sideways instead,
   and a kick whose direction rotates is a hook you can learn where one that
   only changes size can merely be pulled against.
2. **The SWEEP rotated it back**, on its seventeen-round cycle, and at a span
   of ±0.35 about a mean of 0.35 that was every round between straight up and
   twice the weapon's own pull.

**A string changes how HARD a weapon kicks and never which WAY.** There is one
envelope now, spent on both axes, so `pattern` is a magnitude and the DIRECTION
belongs to the weapon — `yawBias`, which is a torque and does not oscillate. The
hook argument survives only where it was actually true: it was made when the
lateral was symmetric NOISE, and the alternative to a rotation was a straight
line with jitter on it. `yawBias` is what answers that now, and a straight
diagonal whose direction belongs to the weapon is as learnable as a hook and far
easier to read. `sweepSpan` went 0.35 → 0.15 in the same pass, because **a span
is also an angle**: the lateral is the short side of the vector, so ± a span is
± that many degrees off vertical.

Measured after, per round, in round order:

| | by round | min | median | max |
| --- | --- | ---: | ---: | ---: |
| rifle aimed | `4 4 3 5 5 3 5 5 6 4 5 6 5 6 6 5 6 6 5` | 3° | **5°** | 6° |
| rifle hip | `6 6 5 4 4 5 5 4 5 4 7 6 7 6 7 5 6 5 5` | 4° | **5°** | 7° |
| SMG hip | `9 8 9 9 9 11 10 9 10 8 8 7 7 8 7 8 9 9 10` | 7° | **9°** | 11° |

Flat, with no trend and no cycle. A single aimed shot measures 5° — **the same
as every round of a string**, which is the point: the weapon has one direction
and it is the weapon's own. The SMG sits at 9° because its `yawBias` is 0.6
against the rifle's 0.35, which is that weapon's character and not a defect.
The sustained pitch plateau is unmoved on every row (2.44 / 4.98 / 2.97°), and
the permanent walk costs 22% — 0.165° → **0.128° over twenty rounds** — because
the lateral now tapers with the vertical instead of ramping against it. That is
the one price of the change, it is paid in the axis nobody complained about, and
`yawPerShot` buys it back at the cost of the angle above if it is ever wanted. `pattern.sweepShots`
went 11 → 17 in the same pass for the same reason — at eleven a half cycle was
five and a half rounds, so the muzzle went out and came back inside one burst,
which is a swing however coherent it is; at seventeen a burst is most of one
way and it takes a magazine to come back. And `shakeYaw`, the punch's own
cosmetic sideways nudge, went 0.006 → 0.0035: it was sized against an aim whose
lateral swung four times further, and left alone it would simply have become the
swing — with the added insult of being one no bullet agrees with.

**The pair no longer leaves the total walk alone, because the walk is what the
reference match cut.** For the rifle's 24 rounds from the hip the per-shot
pitch multipliers sum to 15.25 and the yaw multipliers to 21.27, so the permanent
share is **0.70° of climb and 0.21° of drift** (the drift off `yawPerShot` and
`yawRecoverFraction`, which are not the vertical's pair), against the 10.6° and 2.4° they
were before. Most of that is `recoverFraction` going 0.7 → 0.958 rather than
anything in `pattern` — and its last step, 0.93 → 0.958, is what held the climb
at 0.70° when `pitchSettled` went 0.25 → 0.55. `maxYaw` and `maxPitch` are untouched and
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
| sustained string | floor climbs to ~2.2° by round 9, then flat to ±0.15° through round 28 | `settle.reachAds`, `pattern.pitchSettled`, `patternShots` |
| each round of that plateau | lifts **0.31°**, gives ~0.25° back before the next | `pattern.pitchSettled`, `settle.reachAds` |
| per-round peak through the string | 58–70 ms after the shot | `recoil.punchLift` (0) |
| permanent climb after a string | 0.15° | `recoverFraction` |
| lateral, 22 rd | **0.40° RIGHT**, building, springs back to ~0 | `yawPerShot`, until the split below overrode it |
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
recoverable from the footage. `settle.gripHip`/`haulHip` are therefore not
measured; they are set against two constraints `config/recoil.ts` states — the
hip REACTION (`riseTurns / gripHip`) must fit inside the fastest automatic's
cycle or a held trigger is never hauled at all, and the hip HAUL must pay for
`adsMult` because a rate against a bigger kick is a longer return. The pair they
replaced (24.1 and 1.48, scaled from the aimed pair) broke both, and a ten-round
hip string took 3.7 s to settle against 0.8 aimed. If the two stances ever need
to be right relative to each other, that clip plus a known ADS magnification is
the way in.

**The amplitude figures depend on the reference's ADS field of view, which is
not recoverable from the footage.** They are quoted at OUR aimed vertical FOV
(48.1°), which matches what the recoil LOOKS like rather than what it costs in
mouse travel; if the reference's FOV differs, every angle above scales with it.
The timings, the roll and the shape do not — roll is an image-plane rotation and
the rest are clocks.

### A held trigger may never take the aim DOWN

**Nothing may move the aim down under a held trigger except each round's own
recovery**, and for a while four things did. The report was "the recoil goes
downwards sometimes", and the recoil model on its own cannot do that: the kick
is always up, the haul only ever brings the displacement back toward zero, and
the permanent share only ever adds. What a player sees is not the recoil,
though, but the RENDERED pitch — the player's aim plus the recoil plus the hold
sway plus the punch — and three of those four were pulling the picture down
through the middle of a string. Measured in the live client through a held
trigger, frame by frame, before the fix: the aimed rifle had a floor that went
DOWN on 6–10 of its 28 rounds and fell 1.3–1.5° from its high while still
firing; the aimed SMG's floor ended the string **below where it began**.

The reference was tracked the same way, from `reference-media/`, by
cross-correlating row and column profiles of background crops that exclude the
viewmodel and the HUD: its floor climbs for nine rounds and then holds flat to
±0.15°, and the only downward motion in it is each round giving back ~0.25° of
its own 0.31° before the next one lands. Four fixes, one per cause:

1. **The haul had no equilibrium.** It is a RATE, so a cycle nets `kick − haul ×
   (time it ran)` whatever the level — a string either climbs without end (the
   hip rifle was past 9° at round 24 and still going) or, where the tapered kick
   comes in under the haul, **sinks with the trigger held** (the aimed SMG: 0.8°
   down through a magazine, the recoil alone and nothing else). The rifle's
   aimed plateau only existed because the taper had been fitted to it.
   `settle.reachAds`/`reachHip` make the haul **lean in** past a displacement —
   a shooter pulls harder the further off they are — so every weapon at every
   rate finds a level. It is armed by the rounds BEHIND a string's first and
   lets go at `reach`, where the load is exactly 1, so **a lone round, a tap and
   a flinch are unchanged to the number** (checked: all fourteen single-round
   and flinch excursions are identical to before) and a grenade's flinch is
   still two seconds.
2. **The shake piled up.** `recoil.shake` was raised by every round, so a held
   automatic sat at ~1.5: a hold sway 2.6× as wide and 3.5× as fast, which swung
   the aim through 1.4° in the middle of a string, half of it downward. A
   string now disturbs the hold once, on its opening round (`opensString`), and
   a weapon with no string — the DMR, the pistol, the bolt gun — pays on every
   round exactly as before.
3. **The breath ran through the burst.** Even at rest the sway is a 4.3 s
   cycle, and a two-to-three-second string rides one side of it: component by
   component in the client, the SMG's recoil held flat while its breath carried
   the aim 0.6° down. The breath's PHASE now stops while a string is live
   (`camera.aimSway.holdEase`) — the wander holds wherever it got to rather than
   being taken away, which would itself be a motion — and resumes when the
   string ends. Firing in the respiratory pause is how a shooter holds a burst.
4. **The punch added a step.** Its pitch nudge landed whole on the frame the
   trigger broke and fell over 90 ms, so every round of a string peaked on its
   first frame and then SANK, while the aim under it was still rising. The aim's
   kick is fitted to the reference's whole visible lift, so the nudge was a
   second copy of it; `recoil.punchLift` is 0 for gunfire and a blast keeps all
   of it.

With `pattern.pitchSettled` 0.25 → 0.55 fitted beside `reachAds` (6× closer to
the reference floor than before, and a per-round lift through the plateau of
0.32° against the reference's 0.31°), the live client reads, aimed rifle, three
trials: floor 2.1° at round 10, 2.4° at round 20, 2.5° at round 28, **no round
with a floor lower than the one before it**, worst fall from the running high
0.34° (the reference's is ~0.5°, its own recovery plus a hand), each round
peaking 49 ms after the shot. The aimed SMG levels at 1.45° where it used to go
below zero, and the hip rifle levels at ~4.9° where it used to pass 9°. The hip
plateau is SET rather than fitted, for the reason the hip pair above is: at
`reachHip` 0.6 it sits about twice the aimed one.

**What to re-measure, and how.** The fit's sim is not in the tree; the honest
check is the live one — hold ADS and the trigger through `window.__celshock`
(stub `input.update` to hold `ads`/`fire`, no-op `cameraSys.addFlinch` so a bot
cannot move the aim), and read the rendered camera's pitch on every
`onAfterRenderObservable`. A floor sampled on the frame before each round
aliases against the fire interval by up to ~0.1° on the steep hip sawtooth, so
count a round as net-down only past that.

**Both string-shaped terms share one exclusion**, `Player.stringed` — whether the
SELECTED POSITION has a cycle you can be in the middle of (`!semiAuto ||
burst > 1`, asked of the `FireMode` and not of the weapon, so a rifle switched
to `semi` leaves on the exclusion's wrong side). It has
to be shared: applied to a string of one, `firstShotMult` is a flat 60% increase
and the taper is a flat 20% *decrease*, and the decrease is the worse of the two
because both those weapons' fire rates sit just inside `stringResetTime` (the
DMR's 0.286 s against 0.35). Only a player firing them as fast as the weapon
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
single shot is supposed to have. The carbine's `burst` position is semi-automatic
too and is deliberately **included**, because `burst > 1` means one pull is three
rounds climbing as one motion, which is exactly the thing that has a first round
in it; `burstCycle` 0.4 s exceeds the reset window, so every burst gets the
punch. Switch either weapon to `semi` and it joins the DMR and the pistol on the
excluded side, which is most of what that position is for — see the fire
selector's own section.

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

The three automatics are balanced on time to kill, not damage per second, and in
the order of their reach: 5 SMG rounds at 13/s is 0.308 s, 4 rifle rounds at
9.43/s is 0.318 s, 5 LMG rounds at 10/s is 0.4 s. The choice buys how much of the
screen a burst covers, how far away it still means anything, and how long you may
go on firing it.

**No single round to the BODY kills anything in the kit, and that is the rule the
table is balanced around.** A one-round kill is always a head hit, and it belongs
to the one weapon that pays a bolt cycle for it. The balance pass that set it
(2026-09-14) moved five rows at once, and each move is the reason for the next:

| weapon | was | is | why |
| --- | --- | --- | --- |
| sniper | 100 | **80** | a kill anywhere on a man asked nothing of 6x glass and a 0.09° group; 80 leaves 20, which one round of anything finishes |
| DMR | 50 at 3/s, 12 rds | **45 at 3.5/s, 15 rds** | 50 made its head hit a one-shot at three a second, which is the better sniper at every range it reaches the moment the sniper needs the head |
| rifle | 30 | **28** | the deferred half of the 9.43/s cadence: 283 dps was the best automatic and the longest reach; 264 puts the LMG's wash back within 3% without moving the 4-shot or 2-head kill |
| SMG | 18, near 12 m | **21, near 15 m** | six shots at 0.385 s made it slower than the rifle at arm's length; five at 0.308 s gives the room back to the room weapon |
| LMG | recoil 0.7 / 0.9 | **0.85 / 0.95** | the gentlest climb in the kit with half-bloom made a 75-round belt too easy to hold on a man; its climb per second (`recoilMult × fireRate`) now sits between the SMG's and the rifle's |

The LMG's `recoilImpulse` of 0.95 was set against a held trigger's shake, which
no longer piles up: a string disturbs the hold once, on its opening round (see
"A held trigger may never take the aim DOWN"). It is now a statement about the
settle alone.

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

- **The rifle** is 4 rounds to **47.5 m** and 5 beyond it — 0.318 s becoming
  0.424 s at a boundary that sits inside the 78 m fog wall, so it is a distance a
  player can actually learn.
- **The LMG's 24 → 21 crosses no round boundary at all** (21 × 5 = 105). Five
  hits kill at 85 m exactly as they do at 5, and only the sustained figure moves
  (240 → 210). That is the same reward `bloomMult` 0.5 is, on a third axis.
- **The SMG's five-shot kill holds to 17.3 m** (21 falling to 10 over
  15 → 40 m; the kill is lost when a round makes under 20), six to 24.8 m, and it
  degrades a round at a time to ten. 21 rather than 20 is headroom for the
  sidearm's reason below.
- **The DMR and the sniper have no fall-off**, and the exemption *is* the weapon:
  "two with a head in them, whatever the range" is the sentence the DMR's entry
  opens with, and a head shot that stopped killing at range is the sniper's. It is stated as
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
worth `headshotMult` (2). The rifle and the pistol kill in two, the SMG and the
LMG in three, two of the carbine's three rounds are a kill, the DMR kills with a
head and any second round (90 + 45) at any range, and **the sniper is the one
weapon that kills in one — on the head, and only there** (80 becomes 160).

**It used to be the other way round, and that was the decision this replaced.**
The sniper was 100, a kill on the BODY, so this column did nothing for it; the
argument was that a one-shot kill which had to be a head hit AND cost a bolt
cycle would be a weapon nobody could justify carrying. In play it was the other
failure: a round that kills anywhere on a man asks nothing of the 6x glass and
the tightest group in the game it is carried behind. What keeps the head-only
sniper worth carrying is the body hit — 80 leaves a man on 20, one round of
anything in the kit — and the DMR stopping short of a head one-shot, because
the DMR's old 50 made its head hit a kill at three a second, which is the
sniper's whole case without the bolt. **Neither half survives without the
other**: raise the DMR back to 50 and the sniper is dead weight inside 180 m.

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

**The carbine is the third answer the trigger can give, and the two questions
under it are why there are three.** Does the trigger have to come UP between
pulls, and what does one pull SPEND? The SMG and the LMG answer no/one, the DMR
and the pistol yes/one, and the carbine's first position yes/three — and nothing
may answer no/several, because a burst weapon firing on a held trigger is an
automatic with a stutter in it. Both of the carbine's numbers below are quoted
in that first position; the `semi` it can be switched to is the fire selector's
section, above. Its three rounds at 34 are 102 against 100 HP
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

**The DMR steps outside that too, and firing `semi` and only `semi` is why it
can.** A head and a
body at 3.5/s is 0.286 s — faster than any automatic — and three on the body is
0.571 s, but the rate is a *ceiling on the trigger finger* rather than a cadence,
and the error budget pays for it: a missed rifle round costs 0.106 s, a missed DMR
round 0.286, and every one of them outlasts its own 0.85 s re-settle. The recoil is the second half of
the bill, and since `recoilImpulse` was split out of `recoilMult` it is mostly
paid in TIME rather than in angle: 1.49° of muzzle rise, of which 93% settles
out (`recoil.recoverFraction`), on a spring that is still moving 367 ms later — and then a hold opened to 1.72× and quickened 2.2-fold for
0.85 s while the shooter re-settles. That also makes a high `bloomMult` cheap:
at any deliberate pace the bloom has bled off before the next round leaves.

**The LMG is the third weapon you simply hold the trigger down on, and the only
one here that does not have to stop; every other number on it is the price of
that.** Seventy-five rounds is
fifteen kills and seven and a half seconds of fire; the rifle's twenty-four is six
kills and two and a half seconds. What makes that affordable is that the ARITHMETIC
is a wash and only the timing differs: 24 damage at 10/s is 240 a second against
the rifle's 28 at 9.43/s (264), and the duty cycles run the other way (2.5 s of
fire against 1.4 s of reload is 65%; 7.5 against 3.4 is 69%), so over a minute of
trigger the two deliver 170 and 165 a second. Two weapons deliver the
same damage over a minute to within three percent, and the one that never has to stop in the middle of a
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
seventy-five rounds and have nothing to do with the last fifty. `recoilMult` 0.85 is
the same argument on the other axis, and it was 0.7 until that proved too much of
a reward stacked on the bloom: its climb per second (`recoilMult × fireRate`) is
8.5, between the SMG's 7.15 and the rifle's 9.43 — a burst you steer rather than
one you abandon, but one that has to be steered. Its `recoilImpulse` of 0.95 (was
0.9) is the same trade read the other way: a full-power belt round, most of it
soaked by the weight of the gun, so the settle stays short and the sight is back
between rounds at ten a second (150 ms was measured at 0.9 and has not been
re-measured). It used to be pinned under 1 by the held-trigger shake, which
piled up to 1.53 at ten a second; a string now pays its shake once, so that
ceiling no longer binds and 0.95 is a statement about the settle alone.

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
rays down each optic's cone must find nothing but the reticle in it.
`VERIFYING.md` has the method, including the trap that makes twenty-three of
twenty-five combinations read wrong.

**That second reading was recorded here as "0 of 72 blocked" and 72 rays is not
enough to mean it**, which is worth more than the correction: the 6x's own
throw lever sat 6 mm inside the clear bore for as long as the lever has
existed — a block of metal in the top right of the one sight picture in the
kit with no field to spare — and a 72-ray disc never touched it. **What a
coarse disc misses is not a small fault but a small SOLID ANGLE**, and a part
bolted to the tube is exactly that shape: the lever subtended a 45° wedge of
the outer fifth of the radius, so it is invisible to any disc that samples the
rim and the middle and nothing between. At 16 rings x 64 azimuths (1024) it
reads **13 blocked on `longScope_metal` at the ocular**, and 0 once the lever
is sized off `outerAt` like everything else on that tube. **Take this at 1024
and read the MESH NAMES, never the count**: the honest floor is not zero —
1024 rays find the reticle (52 on the 6x, 39 on the 3.5x's posts, 33 on the 2x's, which is what
thinning the reticle moved and is the only place that shows up as a number) and
6 rays of the outermost ring find the tube itself, because a stepped tube
circumscribes its own cone and touches it at every step's far rim. A count
compared against a remembered number would have called both of those a
regression and the lever nothing at all.

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

**Its handle is the same rule from the other side, and is why the hole in this
weapon is UNDER the sight line rather than around it.** A bullpup's handle wants
to be a tunnel with the sights inside it, and a tunnel is exactly what
`RAIL_REACH` forbids, since nothing forward of the mount may stand above
`railTop` without sitting in the middle of the scope's picture. So the rail is the
top face and everything structural hangs below it: forward of the receiver it is
carried on a spine a third of its width, on two posts — one on the receiver, one
on the gas block — with a long window of real daylight between them. That is the
one hole through a weapon in this kit, it reads at any distance because what shows
through it is the WORLD rather than a darker shade of gun, and the cone still sees
an unbroken flat deck. The rest of the silhouette is everything else below the
rail, where there is no cone to answer to: a skeletonised butt with a diamond void
and a hook of a toe, a slotted handguard, and the one square, stepped muzzle in a
kit whose other three end in round cages and a chambered brake. It is drawn from
`reference-media/bullpup.png`.

**It is the second weapon here whose BORE is not on y = 0, and the first whose
reason is the ejection port.** `SniperModel` was the first — an action wrapped
around the bore rather than a receiver sitting on one — and the rule
`weaponKit.ts` states for its `bolt` node generalises: a barrel is screwed into
a CHAMBER, and the chamber is whatever the port is cut into. Built on the
origin, this weapon's barrel ran 0.032 under its own ejection port, and that is
not a subtle fault in a side view — the port is the largest light-coloured thing
on the flank and the barrel is the longest straight line on the weapon, so the
eye pairs them whether or not it is told to. `BORE` is 0.02 now, everything
forward of the receiver is written against it (the handguard, the gas block and
its regulator, the barrel, every ring of the muzzle, and both landmarks
`WeaponParts` hands back), and the sight height falls out at 0.066 where it was
0.086 — the right direction anyway, since every real weapon of this layout sits
between 0.055 and 0.070.

**Raising it costs the window, and the RAIL is where that is paid back.** A
window loses from the bottom whatever the barrel gains, so the bed and the rail
over it are 0.018 together where they were 0.034: a spine deep enough to look
structural closes the one hole the weapon has. The handguard is the other half —
it is DEEPENED rather than carried up, because one that keeps its clearance
under a raised barrel takes its belly up with it and the profile then steps two
centimetres where it meets the receiver, which the eye reads as a mistake rather
than as the width change the model claims.

**Two more of its numbers were moved by a photograph rather than by arithmetic,
and both are recorded in `CarbineModel.ts` beside the parts they moved.** The firing
grip went forward 0.024 and the magazine well back 0.033, because at the authored
positions the two met flush at the bottom and the kit stage showed a magazine
growing out of the front of the grip — the daylight between them is the layout's
only evidence, and it has to be spent from both ends. And the butt pad went from
0.126 deep to 0.150, because everything in front of it is 0.146 and a weapon whose
whole mass is behind the trigger may not taper to a sliver at the shoulder.

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

**There are TWO answers to that constraint and the second is the rifle's, because a
moulded riser cannot be adjusted down.** The DMR, the LMG and the sniper drop the
comb to `ironSightFloor`; the rifle's comb is a rounded riser cast into a
side-folding stock, so dropping it drops the whole stock and puts the shooter's face
on the receiver. It carries the SIGHTS up instead — `OpticMount.ironRise`, absent on
every other weapon and therefore the shared `IRON_RISE` there, and DERIVED on the
rifle rather than authored: `ironRiseClearing` is `ironSightFloor` solved the other
way round, and the rifle asks it for the rise that puts the cone's lower edge 6 mm
over the riser's FRONT edge, which is where the cone is lowest over it. Measured
through VERIFYING.md's cone of rays: 38 of 193 looked at the riser at the shared
rise, and 0 of 193 do now, with every other weapon unmoved at 0. Nothing downstream
had to be told — the bases, the hood and the post are all built off the rise, and
`ViewModel.applyFit` re-derives the aimed pose from `sightCenter`.

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
  entry point; `swapWeapon` is "the other index". They are declared in
  `entities/weapons.ts` beside `SIDEARM` rather than here, because the AUTHORITY
  names them too — a round reports the slot it left and `Match.onShot` reads this
  side's damage and rate off it — and `server/` cannot import `Player` without
  dragging the viewmodel into a process with no canvas. A second literal over
  there would be exactly the table this bullet says there is not.
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
  receiver. It cannot be fixed in the stylesheet — the bay is a hole precisely
  because every point of DOM alpha over it is a point off the weapon — so the
  card hangs *behind* the weapon instead, sized to the frustum from the same fov
  and aspect that place the weapon. See [`rendering.md`](rendering.md) for the
  draw-order rules that keep it between the two — and for why the card writes
  **no coverage** into the frame's alpha channel, without which it takes the ink
  off the very weapon it was hung behind. Because it is cut to the WHOLE
  frustum it also darkens the map behind the rest of the screen, which is what
  let the kit screen's own scrim go — see [`ui.md`](ui.md).
- **Where the weapon STANDS is the kit screen's answer, not this config's.**
  `LoadoutScreen.stageBay` measures the hole and hands it over every frame
  (`InspectParams.bay`); what is left in `CONFIG.viewmodel.inspect` is the
  weapon's own SPAN (`frameWidth`/`frameHeight`, as multiples of the frame's
  height) and how much of a bay it may fill, and `updateInspect` pushes it back
  until both axes fit — or brings it CLOSER than the authored distance, down to
  `frameNearest`, when the bay is roomier than the framing was drawn for. The
  card's pool of light is repainted to follow the same point.
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
