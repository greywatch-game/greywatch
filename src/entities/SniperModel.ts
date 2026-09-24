/**
 * SniperModel.ts — Builds the bolt-action sniper rifle, an Accuracy
 * International AXMC drawn from photographs, hangs the same optics off its
 * rail, and hands back the one part of a weapon in this kit that is worked by
 * hand.
 * Returns WeaponParts exactly as RifleModel and DmrModel do: every builder is
 * interchangeable to everything above it, which is what lets `ViewModel` carry
 * any of them.
 * Invariants: assembled at the origin with the root at identity and merged
 * before it is moved — `weaponKit.ts` owns that contract and the primitives.
 * The optics are `optics.ts`'s, built against `MOUNT` rather than re-tuned.
 * Invariant: the BOLT is built about the bore and merged into a node of its
 * own — see `WeaponParts.bolt`, and `CONFIG.viewmodel.cycle` for what moves it.
 * Invariant: a colour group is a ROLE, not a material. A chassis rifle is
 * machined where the rest of the kit is moulded, and its chassis, forend,
 * stock and magazine were once built in METAL — honest about the alloy and
 * wrong about the paint, since METAL is the ACCENT group and the MIRROR rung
 * of six finishes: half the rifle clipped to white on the turntable. They are
 * POLYMER, the furniture role, and what is machined about this rifle is said
 * in its SHAPE (`docs/weapons.md` has the measurement).
 * Invariant: THE RAIL IS SUPPORTED FOR ITS WHOLE LENGTH. It carries the DMR's
 * rail over the SHORTEST action in the kit — -0.29 to 0.57 over an action
 * 0.47 long — so 39 cm of it is over somebody else's business: 9 cm of bolt
 * raceway behind and 30 cm of barrel in front. Built as air, the forward gap
 * read as a rail bolted to nothing. What holds it up differs at each end
 * because what is underneath differs — a solid `railBridge` the bolt passes
 * under behind, and the FOREND raised to meet the rail's underside in front.
 * **Anything that lengthens the rail, moves `RAIL_TOP` or drops the forend
 * owes the support under it**, and the failure is a hole in the weapon rather
 * than anything a build would refuse.
 */
import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { buildOptics, ironSightFloor, type OpticMount } from "./optics";
import {
  BODY,
  METAL,
  magDropAxis,
  POLYMER,
  RUBBER,
  spanRing,
  WeaponBuild,
  type WeaponParts,
} from "./weaponKit";

/**
 * The magazine's rake — NEGATIVE for the reason every other box magazine here
 * is (see `magDropAxis`), and the shallowest in the kit at that. This is a
 * single-stack of a long cartridge sitting in a chassis: it is a straight
 * stick, and the couple of degrees is all the lean a fixed-taper column gets
 * before it reads as damaged rather than as raked.
 */
const MAG_RAKE = -0.04;

/**
 * Height of the BORE in the weapon's own frame — the one weapon in the kit
 * whose barrel is not on y = 0.
 *
 * On the axis, the barrel came out of the fore-end in the bottom half of a
 * silhouette 8.6 cm deep under the rail, and read as hung under the weapon
 * rather than as what the rest of it is built around. Lowering the receiver
 * and stock to meet it would have moved the rail, the comb, the grip and the
 * trigger hand; lifting the bore moves only what is concentric with it —
 * the barrel, the brake, the bolt (through `boltSeat`, so the cycle still
 * turns it about its own axis), the fore-end that floats around it, and the
 * two landmarks, `muzzle` and `ejectPort`. Nothing above reads the origin as
 * the bore: the aimed pose is derived from the sight and the flash hangs off
 * `muzzle`.
 */
const BORE_Y = 0.018;

/**
 * Top face of the receiver's rail.
 *
 * Lower than the DMR's 0.09 even though this is the bigger weapon, and the
 * reason is the BOLT rather than a style. A bolt-action's raceway is in line
 * with the bore, so the action here is a body wrapped around it rather than a
 * receiver sitting on top of a barrel — much of its depth is under the bore
 * where the DMR has nothing at all. The rail is therefore the top of a section
 * built around the axis, and the weapon carries more mass for less height.
 */
const RAIL_TOP = 0.086;

/**
 * Where the rifle offers its rail.
 *
 * `ironFrontZ` is the DMR's number for the DMR's reason, one weapon along: it
 * is where the holo's view cone reaches the folded front leaf's top, and past
 * that a longer rail buys sight radius the optics cannot use. The rail's far
 * end is 0.57 so `RAIL_REACH` in `optics.ts` — 0.55 past `mountZ` — is still
 * the honest bound every optic's rise is solved against. **A longer weapon does
 * not get a longer rail**; it gets a longer barrel in front of one.
 *
 * `ironRearZ` is the furthest back of any weapon here, which is the one thing
 * the long action does buy: the rear station sits behind the ejection port and
 * behind the bolt's own travel, where nothing is in its way.
 */
const MOUNT: OpticMount = {
  railTop: RAIL_TOP,
  mountZ: 0.02,
  ironRearZ: -0.245,
  ironFrontZ: 0.53,
};

/**
 * The cheek piece's top: about level with the rail, as the AXMC's is, and never
 * higher than the irons allow.
 *
 * The eye behind an aperture sits BEHIND the butt, so anything back here that
 * stands over the sight line fills the aperture, and a precision rifle's cheek
 * piece is the tallest candidate in the game for doing it. `ironSightFloor` at
 * the plate's front edge, less a few millimetres of daylight, is therefore the
 * ceiling it is checked against; the rail is what sets it.
 */
const COMB_FRONT_Z = -0.365;
const COMB_TOP = Math.min(RAIL_TOP + 0.004, ironSightFloor(MOUNT, COMB_FRONT_Z) - 0.006);

/**
 * The bolt, in the frame it is built and animated in.
 *
 * `BOLT_Z` is the handle's station along the barrel axis, and it is the one
 * number here that is boxed in from three sides: forward of it is the ejection
 * port, below it is the trigger housing, and behind it is the tang the thumb
 * goes over. It sits in the gap all three leave.
 *
 * `BOLT_REST` is the angle the handle hangs at, measured the way `shell` and
 * every other radial part in this kit measures one — from +y, turning toward
 * +x — so `(sin, cos)` is the direction and `rotZ = -angle` turns a part onto
 * it. At 1.92 rad the handle points out to the right and 20 deg down.
 *
 * **A real bolt handle hangs at nearer forty-five and this one was drawn there
 * first; it had to come up because it was INVISIBLE.** At 40 deg down the knob
 * sits between the action's underside and the chassis's flank, which from every
 * angle the weapon is actually seen at is inside one silhouette or the other —
 * so the one part of this rifle whose whole job is to be watched moving was a
 * tab that appeared and disappeared. Photographed on the kit stage, closed
 * against open was a two-pixel difference. At 20 deg it stands clear of both
 * outlines at rest and `cycle.liftTurn` swings it to 49 deg ABOVE horizontal,
 * beside the scope's rings and outboard of them, which is where a rifle rolled
 * right-flank-up for the cycle actually presents it to the eye.
 *
 * The lift is `CONFIG.viewmodel.cycle.liftTurn` and is deliberately not here:
 * this file owns where the part is and the viewmodel owns what is done to it,
 * which is the same split `magDrop` and `reload.dropDist` already make. The two
 * are a PAIR even so — this angle is chosen knowing what that one adds to it.
 */
const BOLT_Z = -0.075;
const BOLT_REST = 1.92;
const BOLT_DIR = { x: Math.sin(BOLT_REST), y: Math.cos(BOLT_REST) };

/**
 * Where each hand grips, in weapon-local units.
 *
 * The trigger hand is further BACK and lower than the DMR's: a raked chassis
 * grip behind a trigger set well back in a long action, and the hand point
 * rides back down the grip with its rake. The support hand is further FORWARD than anything else in the kit
 * and back from the handguard's own end for the DMR's reason — the bipod is
 * stowed under that end, and a fist closed around folded legs reads as a hand
 * pushed through the weapon.
 */
const GRIP_HAND = new Vector3(0.02, -0.176, -0.205);
const GRIP_ELBOW = new Vector3(0.27, -0.585, -0.575);
const SUPPORT_HAND = new Vector3(-0.02, -0.086 + BORE_Y, 0.43);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.51 + BORE_Y, 0.14);

/**
 * Builds a cel-styled Accuracy International AXMC. Local +z is the barrel
 * axis, origin at the action's centre — the same frame the other weapons are
 * built in, so the viewmodel poses any of them with the same numbers — with
 * the bore carried `BORE_Y` above it, and the one extra promise the bolt needs.
 *
 * What makes it an AX, all taken from photographs of the AXMC and the AX338:
 *
 * - **The long rectangular action** with its rail running on unbroken onto the
 *   forend, a long ejection port on the right and the bolt channel down the
 *   left.
 * - **The deep flat chassis**, its keel run forward under the forend with oval
 *   recesses, and a short deep ten-round box standing in it.
 * - **The long squared forend** drilled with two rows of ovals.
 * - **The folding skeleton stock**: a hinge knuckle, a frame of triangles with
 *   daylight through it, a cheek plate carried on a post, a tall butt on
 *   spacers and a bag rider under it.
 * - **AI's squared brake**, its ports cut straight through the sides.
 *
 * Built as the rifle is — bevelled profile slabs and contoured lofts, detail at
 * its real scale, controls small and dark, machining as dark inlays — see
 * `docs/weapons.md`'s procedural-models section. Merged to one mesh per colour,
 * plus a set for the magazine and a set for the bolt, the two things that have
 * to move independently.
 */
export function buildSniper(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_sniper`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- the action: AI's long rectangular receiver, wrapped around the BORE ---
  // Half its section is under the axis, where the other weapons have air, which
  // is why the rail is lower than the DMR's on the bigger gun.
  b.slab("action", BODY, [
    [-0.2, -0.033],
    [0.27, -0.033],
    [0.27, 0.052],
    [0.264, 0.058],
    [-0.2, 0.058],
  ], 0.076, 0.005);
  // The deck runs the RAIL's length rather than the action's, and its top face
  // IS the rail's underside — see the invariant in the header. Under its rear
  // 9 cm the action has already stopped, so the bridge below carries it there:
  // solid over the raceway, with the bolt passing under it exactly as one does
  // under a real rear receiver bridge. Its floor clears the shroud's crown by
  // 3 mm, which is what keeps the draw legible from the side.
  b.slab("actionTop", BODY, [
    [-0.29, 0.056],
    [0.27, 0.056],
    [0.27, 0.072],
    [-0.29, 0.072],
  ], 0.062, 0.004);
  const bridgeFloor = BORE_Y + 0.024;
  b.slab("railBridge", BODY, [
    [-0.29, bridgeFloor],
    [-0.2, bridgeFloor],
    [-0.2, 0.057],
    [-0.29, 0.057],
  ], 0.056, 0.003);
  b.picatinny("rail", 0, 0.072, -0.28, 43, { width: 0.058, height: RAIL_TOP - 0.072 });
  // The long ejection port on the right, and the bolt channel down the left —
  // AI's two long slots, dark where the action is open.
  b.slab("ejectPort", RUBBER, [
    [0.0, 0.012],
    [0.15, 0.012],
    [0.15, 0.048],
    [0.0, 0.048],
  ], 0.003, 0, 0.0385);
  b.slab("boltChannel", RUBBER, [
    [-0.19, 0.03],
    [0.06, 0.03],
    [0.064, 0.036],
    [0.06, 0.042],
    [-0.19, 0.042],
  ], 0.003, 0, -0.0385);
  // Screws down the flank, where the action is bedded into the chassis.
  for (const z of [-0.14, 0.02, 0.2] as const) {
    b.pin("actionScrew", METAL, 0.008, 0.08, 0, -0.018, z);
  }
  b.slab("plate", BODY, [
    [0.08, 0.01],
    [0.2, 0.01],
    [0.2, 0.024],
    [0.08, 0.024],
  ], 0.003, 0, -0.0385);
  for (const [y, len] of [[0.02, 0.1], [0.014, 0.07]] as const) {
    b.box("stamp", RUBBER, 0.002, 0.0026, len, -0.0402, y, 0.09 + len / 2);
  }
  // The tang, and it is UNDER the bolt line rather than around it — which is
  // the one place this model is laid out for the animation rather than for the
  // part. Around the raceway it would hide the whole bolt at rest; below it,
  // the shroud and the cocking piece stand in OPEN AIR behind the action and
  // the draw is bright metal sliding straight at the eye, behind everything
  // and hidden by nothing.
  b.slab("tang", BODY, [
    [-0.2, -0.04],
    [-0.295, -0.04],
    [-0.295, -0.01],
    [-0.284, -0.004],
    [-0.2, -0.004],
  ], 0.05, 0.004);
  b.box("safety", METAL, 0.004, 0.012, 0.022, 0.028, -0.014, -0.24);

  // --- the chassis: trigger housing, magwell, and a deep keel run forward
  // under the forend with its oval recesses — the AX's lower half ---
  // Narrower than the action above it (0.066 against 0.076), which is what
  // leaves the bolt knob somewhere to hang: see BOLT_REST.
  b.slab("chassis", POLYMER, [
    [-0.262, -0.03],
    [0.3, -0.03],
    [0.312, -0.042],
    [0.312, -0.062],
    [0.298, -0.078],
    [0.132, -0.078],
    [0.128, -0.132],
    [0.118, -0.142],
    [-0.012, -0.142],
    [-0.02, -0.132],
    [-0.024, -0.1],
    [-0.2, -0.1],
    [-0.24, -0.086],
    [-0.262, -0.06],
  ], 0.066, 0.005);
  for (let i = 0; i < 3; i++) {
    const zc = 0.175 + i * 0.045;
    b.slab("keelOval", RUBBER, [
      [zc - 0.016, -0.054],
      [zc - 0.01, -0.062],
      [zc + 0.01, -0.062],
      [zc + 0.016, -0.054],
      [zc + 0.01, -0.046],
      [zc - 0.01, -0.046],
    ], 0.068, 0);
  }
  b.box("magLatch", POLYMER, 0.024, 0.014, 0.012, 0, -0.14, -0.018);
  // The guard: a rounded loop, integral, behind the magazine.
  b.slab("guard", POLYMER, [
    [-0.026, -0.1],
    [-0.026, -0.16],
    [-0.04, -0.176],
    [-0.19, -0.178],
    [-0.19, -0.166],
    [-0.042, -0.164],
    [-0.038, -0.158],
    [-0.038, -0.1],
  ], 0.022, 0.002);
  // A two-stage trigger with a flat shoe: on a weapon fired once every second
  // and a quarter, the trigger is the only control the shooter thinks about.
  b.slab("trigger", METAL, [
    [-0.124, -0.1],
    [-0.113, -0.1],
    [-0.115, -0.122],
    [-0.112, -0.142],
    [-0.111, -0.154],
    [-0.12, -0.154],
    [-0.122, -0.142],
    [-0.124, -0.122],
  ], 0.012, 0.0015);

  // AI's grip: slender, a finger swell down the front and a thumb shelf over
  // the web, and raked back at the rifle's angle. It stood near-vertical once,
  // on the argument that a precision hold puts the wrist under the trigger —
  // and read as a post stuck under the chassis rather than as AI's grip, which
  // lays back like any other.
  const gripPivot = b.pivot("gripPivot", 0, -0.118, -0.198, 0.3);
  b.upright("grip", POLYMER, [
    spanRing(-0.16, 0.05, 0.034, -0.04),
    spanRing(-0.13, 0.05, 0.03, -0.041),
    spanRing(-0.1, 0.052, 0.036, -0.043),
    spanRing(-0.075, 0.052, 0.03, -0.044),
    spanRing(-0.05, 0.052, 0.035, -0.044),
    spanRing(-0.02, 0.05, 0.033, -0.043),
    spanRing(0.0, 0.05, 0.034, -0.06),
    spanRing(0.02, 0.046, 0.032, -0.05),
  ], gripPivot);
  b.upright("gripCap", RUBBER, [
    spanRing(-0.172, 0.05, 0.035, -0.041),
    spanRing(-0.158, 0.051, 0.035, -0.041),
  ], gripPivot);

  // --- the forend: long, squared, drilled with two rows of ovals ---
  // Free-float is a promise about the BARREL, so the forend's top is free to
  // come up to the rail — and ahead of the action it has to, because there is
  // nothing else under 30 cm of rail (see the header). Past the rail's end it
  // runs on bare, flat-topped, to its squared front.
  const f = BORE_Y;
  b.slab("forend", POLYMER, [
    [0.25, 0.072],
    [0.72, 0.072],
    [0.728, 0.064],
    [0.728, -0.024],
    [0.72, -0.032],
    [0.25, -0.032],
  ], 0.07, 0.01);
  for (const y of [0.046, 0.016] as const) {
    for (let i = 0; i < 12; i++) {
      const zc = 0.33 + i * 0.033;
      b.slab("forendOval", RUBBER, [
        [zc - 0.011, y],
        [zc - 0.006, y - 0.006],
        [zc + 0.006, y - 0.006],
        [zc + 0.011, y],
        [zc + 0.006, y + 0.006],
        [zc - 0.006, y + 0.006],
      ], 0.072, 0);
    }
  }
  b.picatinny("sideRail", -0.035, 0.03, 0.52, 4, { width: 0.018, height: 0.006, facing: "left" });
  b.pin("forendBolt", METAL, 0.01, 0.074, 0, 0.03, 0.27);
  // A hand stop on the underside, and the sling socket forward of it.
  b.slab("handStop", POLYMER, [
    [0.36, -0.03],
    [0.41, -0.03],
    [0.41, -0.042],
    [0.39, -0.054],
    [0.374, -0.054],
  ], 0.026, 0.003);
  b.box("slingQd", METAL, 0.004, 0.014, 0.014, 0.036, -0.012, 0.62);

  // --- bipod, folded back along the underside of the forend's front ---
  // Nothing in this game rests a weapon on anything, so deployed legs would be
  // geometry the player can never use; folded is the state it is carried in.
  b.slab("bipodMount", BODY, [
    [0.66, -0.03],
    [0.71, -0.03],
    [0.71, -0.044],
    [0.702, -0.052],
    [0.668, -0.052],
    [0.66, -0.044],
  ], 0.04, 0.004);
  for (const side of [-1, 1] as const) {
    b.tube("bipodLeg", BODY, 0.011, 0.013, 0.19, side * 0.018, -0.058, 0.6);
    b.box("bipodFoot", RUBBER, 0.015, 0.015, 0.022, side * 0.018, -0.058, 0.5);
    b.tube("bipodSpring", METAL, 0.006, 0.006, 0.05, side * 0.018, -0.046, 0.672);
  }

  // --- barrel: heavy, the widest thing ahead of the forend ---
  b.tube("barrel", BODY, 0.044, 0.05, 0.2, 0, f, 0.82);
  // AI's brake: a squared block with its ports cut straight through the sides,
  // on a threaded collar.
  b.tube("threadCollar", BODY, 0.05, 0.05, 0.016, 0, f, 0.928);
  b.slab("brake", BODY, [
    [0.936, f - 0.026],
    [1.006, f - 0.026],
    [1.012, f - 0.02],
    [1.012, f + 0.02],
    [1.006, f + 0.026],
    [0.936, f + 0.026],
  ], 0.054, 0.006);
  for (let i = 0; i < 3; i++) {
    const zc = 0.952 + i * 0.02;
    b.slab("brakePort", RUBBER, [
      [zc - 0.005, f - 0.016],
      [zc + 0.005, f - 0.016],
      [zc + 0.005, f + 0.016],
      [zc - 0.005, f + 0.016],
    ], 0.056, 0);
  }
  b.tube("mzCore", RUBBER, 0.02, 0.02, 0.004, 0, f, 1.012);

  // --- the folding stock: a hinge knuckle, then a skeleton of triangles ---
  // The daylight is the point: every other stock in the kit is a body with
  // details on it, and this is a frame with the world showing through it,
  // which is the one cue that survives being three pixels wide. Every height
  // at the comb is derived — see COMB_TOP.
  b.slab("hinge", BODY, [
    [-0.29, 0.05],
    [-0.29, -0.046],
    [-0.336, -0.046],
    [-0.342, -0.04],
    [-0.342, 0.044],
    [-0.336, 0.05],
  ], 0.06, 0.005);
  b.pin("hingeKnuckle", METAL, 0.018, 0.1, 0.03, 0.002, -0.316, "y");
  b.pin("foldButton", METAL, 0.014, 0.066, 0, 0.024, -0.316);
  // The frame's four members, and the two diagonals that triangulate it.
  const STOCK_W = 0.04;
  const bar = (name: string, pts: readonly (readonly [number, number])[], w = STOCK_W) =>
    b.slab(name, POLYMER, pts, w, 0.004);
  bar("stockTop", [
    [-0.34, 0.034],
    [-0.54, 0.038],
    [-0.54, 0.016],
    [-0.34, 0.012],
  ]);
  bar("stockBottom", [
    [-0.34, -0.024],
    [-0.34, -0.046],
    [-0.535, -0.118],
    [-0.535, -0.094],
  ]);
  bar("strutFront", [
    [-0.36, 0.014],
    [-0.38, 0.014],
    [-0.448, -0.064],
    [-0.428, -0.064],
  ], 0.034);
  bar("strutRear", [
    [-0.505, 0.018],
    [-0.525, 0.018],
    [-0.456, -0.068],
    [-0.436, -0.068],
  ], 0.034);
  // The cheek piece on its post: a plate carried above the frame, not moulded
  // into it, with the knob that sets its height.
  bar("cheekPost", [
    [-0.43, 0.034],
    [-0.45, 0.034],
    [-0.45, COMB_TOP - 0.012],
    [-0.43, COMB_TOP - 0.012],
  ], 0.022);
  bar("cheekPlate", [
    [COMB_FRONT_Z, COMB_TOP - 0.012],
    [COMB_FRONT_Z - 0.012, COMB_TOP],
    [-0.52, COMB_TOP],
    [-0.526, COMB_TOP - 0.008],
    [-0.526, COMB_TOP - 0.014],
  ], 0.05);
  b.pin("cheekKnob", METAL, 0.014, 0.034, 0.02, 0.05, -0.44);
  // The butt: a tall plate with its pad on length-of-pull spacers.
  bar("buttPlate", [
    [-0.532, COMB_TOP - 0.01],
    [-0.558, COMB_TOP - 0.01],
    [-0.564, COMB_TOP - 0.018],
    [-0.564, -0.128],
    [-0.556, -0.136],
    [-0.532, -0.136],
  ], 0.06);
  for (let i = 0; i < 2; i++) {
    b.box("padSpacer", BODY, 0.058, COMB_TOP + 0.13, 0.006, 0, (COMB_TOP - 0.144) / 2, -0.568 - i * 0.008);
  }
  b.slab("buttPad", RUBBER, [
    [-0.578, COMB_TOP - 0.012],
    [-0.59, COMB_TOP - 0.016],
    [-0.594, COMB_TOP - 0.03],
    [-0.594, -0.124],
    [-0.588, -0.136],
    [-0.578, -0.138],
  ], 0.066, 0.004);
  // The bag rider under the butt, where the off hand goes on a supported shot.
  b.slab("bagRider", RUBBER, [
    [-0.47, -0.1],
    [-0.532, -0.12],
    [-0.532, -0.146],
    [-0.52, -0.152],
    [-0.476, -0.134],
  ], 0.044, 0.004);
  b.box("slingRear", METAL, 0.004, 0.016, 0.012, -0.031, -0.06, -0.52);

  // Merged before the magazine, the bolt and any optic, so none of their parts
  // can end up inside the weapon's own colour groups.
  const meshes = b.merge("sniper", root);

  // --- magazine: AI's short, deep ten-round box ---
  // Straight and square, and short: it hangs little further under the well
  // than the trigger guard does, which is the read on the one weapon here that
  // does not hold twenty. Merged into a node of its own so the reload can drop
  // it.
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  const magPivot = b.pivot("magPivot", 0, -0.135, 0.055, MAG_RAKE);
  b.upright("mag", POLYMER, [
    { y: -0.078, w: 0.046, d: 0.11, k: 0.12 },
    { y: 0.03, w: 0.046, d: 0.11, k: 0.12 },
  ], magPivot);
  // A sunk panel down each flank, and the floor plate a little proud.
  b.slab("magPanel", RUBBER, [
    [-0.04, -0.066],
    [0.04, -0.066],
    [0.04, -0.016],
    [-0.04, -0.016],
  ], 0.047, 0, 0, magPivot);
  b.upright("magFloor", POLYMER, [
    { y: -0.09, w: 0.05, d: 0.116, k: 0.2 },
    { y: -0.076, w: 0.05, d: 0.116, k: 0.2 },
  ], magPivot);
  meshes.push(...b.merge("sniperMag", magazine));

  // --- the bolt, about the bore, in a node of its own ---
  // Everything here is built at the weapon's origin and on the axis, because
  // `ViewModel` turns this node about z to lift the handle: a raceway built
  // anywhere else would swing the bolt through the receiver instead of turning
  // it in one. See `WeaponParts.bolt`.
  //
  // The bore is `BORE_Y` above the origin on this weapon, so the bolt's parts
  // are built on y = 0 and the node is hung from a fixed SEAT on the bore: the
  // viewmodel zeroes the bolt node's own transform whenever it puts the part
  // home, so an offset written on the node itself would be wiped the first
  // time it did.
  const boltSeat = new TransformNode(`${prefix}_boltSeat`, scene);
  boltSeat.parent = root;
  boltSeat.position.y = BORE_Y;
  const bolt = new TransformNode(`${prefix}_bolt`, scene);
  bolt.parent = boltSeat;
  b.tube("boltBody", METAL, 0.03, 0.03, 0.18, 0, 0, -0.1);
  b.tube("boltHead", METAL, 0.034, 0.03, 0.024, 0, 0, -0.006);
  // The shroud and the cocking piece — the two parts standing in the open air
  // behind the action, and therefore what the eye actually watches travel. See
  // the tang above, which was moved out from around them to make that true.
  b.tube("boltShroud", BODY, 0.042, 0.038, 0.042, 0, 0, -0.208);
  b.tube("boltCollarR", METAL, 0.03, 0.03, 0.012, 0, 0, -0.233);
  b.tube("boltPin", METAL, 0.018, 0.018, 0.026, 0, 0, -0.248);
  // Two locking-lug ribs on the body, so the travel reads as a part sliding in
  // a tube rather than as a tube changing length.
  for (let i = 0; i < 2; i++) {
    b.tube("boltRib", BODY, 0.034, 0.034, 0.014, 0, 0, -0.04 - i * 0.05);
  }
  // The handle: a stem out along BOLT_DIR and a knob on the end of it, both
  // turned onto that direction with `rotZ = -BOLT_REST` the way every radial
  // part in this kit is (see `WeaponBuild.shell`).
  // **Sized to be READ, not to be right.** A bolt handle on a real rifle is a
  // stub; this one is nearly as long as the action is deep, because the whole
  // of what the cycle has to say is said by this part moving, and at viewmodel
  // distance through a weapon carried below and right of the eye a correctly
  // proportioned handle is four pixels that change place. It is the same
  // argument the reticles are scaled by and the tracers are drawn by: what is
  // authored is the ANGLE it subtends where it is actually looked at.
  b.box(
    "boltStem",
    METAL,
    0.022,
    0.082,
    0.026,
    BOLT_DIR.x * 0.05,
    BOLT_DIR.y * 0.05,
    BOLT_Z,
    root,
    -BOLT_REST,
  );
  b.pin("boltKnob", METAL, 0.036, 0.03, BOLT_DIR.x * 0.094, BOLT_DIR.y * 0.094, BOLT_Z, "x");
  b.box(
    "boltCollar",
    BODY,
    0.026,
    0.016,
    0.03,
    BOLT_DIR.x * 0.02,
    BOLT_DIR.y * 0.02,
    BOLT_Z,
    root,
    -BOLT_REST,
  );
  meshes.push(...b.merge("sniperBolt", bolt));

  // Every colour group the WEAPON itself merged — the magazine and the bolt
  // included, and the optics deliberately not. A bolt gun repainted in a
  // scheme with a black bolt would read as a different weapon underneath.
  const finish = b.takeFinish();

  const optics = buildOptics(b, MOUNT, prefix);
  meshes.push(...optics.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, BORE_Y, 1.01),
    // Matches the `ejectPort` box above — the right side of the action.
    ejectPort: new Vector3(0.045, 0.03, 0.075),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magazine,
    magDrop: magDropAxis(MAG_RAKE),
    bolt,
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
