/**
 * RifleModel.ts — Builds the low-poly SCAR-pattern battle rifle from
 * primitives, and hangs the three fittable optics off its rail.
 * Returns WeaponParts: pose root, alignment landmarks (muzzle, ejection port,
 * the two grips) and the sight assemblies, of which exactly one is enabled.
 * Invariants: everything is assembled at the origin with the root at identity
 * and merged before it is moved — see `weaponKit.ts`, which owns that contract
 * along with the primitives this is written in. The optics are `optics.ts`'s,
 * shared with the SMG rather than duplicated here.
 */
import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { buildOptics, ironRiseClearing, type OpticMount } from "./optics";
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
 * Height of the bore above the origin: the middle of the upper receiver.
 *
 * It was on y = 0, which on this weapon is the seam between the upper and the
 * lower — a chamber in the trigger housing, 4 cm under its own ejection port
 * and charging handle. A SCAR's barrel comes out of the FRONT FACE of the
 * upper with the lower rail hung beneath it, so the barrel, the gas block and
 * the birdcage move up and the handguard stays where the hand is.
 */
const BORE_Y = 0.032;

/** Top face of the receiver's rail — what every sight base stands on. */
const RAIL_TOP = 0.084;

/** The rear iron station, which is also the eye reference the irons are aimed
 *  through — so it is the apex of the cone the stock below has to stay under. */
const IRON_REAR_Z = -0.185;

/**
 * The cheek riser, authored here rather than at the build site because the
 * irons are solved against it.
 *
 * This is a side-folding stock with the comb MOULDED INTO IT — there is no
 * adjustment, so the way out the DMR, the LMG and the sniper take (drop the
 * comb to `ironSightFloor`) is not available: dropping this one drops the
 * whole stock, and a face on the rifle would be a face on the receiver. The
 * riser stays where the stock wants it and the SIGHTS clear it instead.
 *
 * `CHEEK_TOP` is the comb's flat top, and `CHEEK_FRONT_Z` where that flat
 * begins, which is where the aperture's cone is lowest over it — spreading
 * with distance, the cone is at its tightest nearest the eye. The ramp ahead
 * of it is lower than the top everywhere, so solving against the top there is
 * a few millimetres of margin rather than an approximation.
 */
const CHEEK_TOP = 0.108;
const CHEEK_FRONT_Z = -0.36;
const CHEEK_WIDTH = 0.048;

/** Daylight left under the sight picture, over the comb. The DMR's number,
 *  solved from the other side. */
const CHEEK_GAP = 0.006;

/**
 * The magazine's rake, which is also the line it drops out along, and it is
 * NEGATIVE because a rifle magazine leans and curves toward the MUZZLE. The
 * cartridges in it are tapered, so the column they stack into bends away from
 * their bases — which is why every curved box magazine in service, STANAG and
 * AK alike, hangs forward of its well rather than back toward the stock. A
 * pivot's positive `rotX` sends everything below it backwards (see
 * `magDropAxis`), so forward is the minus sign here, and the same sign takes
 * the magazine out of the well down and FORWARD along its own body.
 *
 * Shallow here, because the SCAR-H's 7.62 magazine is STRAIGHT: the column is
 * short enough in a 20-round box that it needs no curve, so the whole of the
 * lean is this rake and none of it is the body's.
 */
const MAG_RAKE = -0.08;

/**
 * Where the rifle offers its rail. The iron stations are as far apart as the
 * receiver allows: the sight radius is what makes irons shootable, and the
 * front station rides the gas block at the far end of the top rail.
 */
const MOUNT: OpticMount = {
  railTop: RAIL_TOP,
  mountZ: 0.02,
  ironRearZ: IRON_REAR_Z,
  ironFrontZ: 0.53,
  /**
   * Raised off the shared rise, and DERIVED rather than authored: the cheek
   * riser stands into the shared cone by 13 mm, which reads as an aperture
   * with the bottom third bitten out of it. This is the rise that puts the
   * cone's lower edge `CHEEK_GAP` over the riser's front edge instead — the
   * inverse of what `DmrModel` does with the same line. Move the riser and the
   * sights follow it; the front post, the hood and both bases come with them,
   * and `ViewModel.applyFit` re-derives the aimed pose off `sightCenter`, so
   * nothing has to be told twice.
   */
  ironRise: ironRiseClearing(
    { railTop: RAIL_TOP, ironRearZ: IRON_REAR_Z },
    CHEEK_FRONT_Z,
    CHEEK_TOP,
    CHEEK_GAP,
  ),
};

/** Where each hand grips, in rifle-local units. */
const GRIP_HAND = new Vector3(0.02, -0.16, -0.165);
const GRIP_ELBOW = new Vector3(0.26, -0.555, -0.535);
const SUPPORT_HAND = new Vector3(-0.02, -0.075, 0.4);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.5, 0.12);

/**
 * Builds a low-poly cel-styled SCAR-pattern battle rifle with a rail optic.
 * Local +z is the barrel axis, origin at the receiver center, the bore
 * `BORE_Y` above it.
 *
 * The silhouette follows the FN SCAR-H, drawn from photographs rather than
 * from memory: one long, deep upper receiver carrying a full-length top rail
 * at a real rail's slot pitch, a shallow polymer lower whose front slants down
 * to the magwell's mouth, an oversized square guard, a straight 7.62
 * magazine, a long exposed barrel, and a side-folding stock that is a raised
 * frame round a recessed panel with the comb moulded in. Every part with a
 * character is a bevelled profile slab or a contoured loft — see
 * `docs/weapons.md`'s procedural-models section, which is the design language
 * the rest of the kit follows.
 *
 * All of it is static, so the parts are merged down to one mesh per color
 * once built. That keeps draw calls flat and — more importantly — keeps the
 * outline pass drawing one clean border per color group instead of wrapping
 * every screw and rail rib in its own black shell. Detail here is nearly free
 * for that reason: this is the one model always on screen, half a metre from
 * the lens, and it costs four draws however many boxes go into it.
 */
export function buildRifle(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_rifle`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- upper receiver: the SCAR's spine. One long, deep, even aluminium
  // extrusion from the stock hinge to the gas block, with the lower hung under
  // its rear half and a full-length rail on top. Two slabs, because the real
  // one narrows a step at the shoulder under the rail ---
  b.slab("upper", BODY, [
    [-0.265, -0.022],
    [0.548, -0.022],
    [0.548, 0.046],
    [0.542, 0.056],
    [-0.265, 0.056],
  ], 0.08, 0.004);
  b.slab("upperDeck", BODY, [
    [-0.25, 0.052],
    [0.54, 0.052],
    [0.54, 0.064],
    [0.534, 0.07],
    [-0.25, 0.07],
  ], 0.068, 0.004);
  // The full-length top rail: a real picatinny, dovetailed teeth on a spine
  // with open slots between them, at a real rail's pitch — a coarse one is
  // the quickest way to make a rifle read as a toy. Its teeth top out at
  // `RAIL_TOP`, which is what every sight base stands on.
  b.picatinny("topRail", 0, 0.07, -0.25, 40, { width: 0.058, height: RAIL_TOP - 0.07 });

  // Receiver side detail, as dark inlays standing a hair proud of the face:
  // the long charging-handle channel on the left, the three lightening slots
  // forward on both sides, and the ejection port on the right. These are what
  // make a flat extrusion read as a machined receiver rather than a plank.
  b.slab("chChannel", RUBBER, [
    [-0.16, 0.026],
    [0.3, 0.026],
    [0.304, 0.03],
    [0.3, 0.034],
    [-0.16, 0.034],
    [-0.164, 0.03],
  ], 0.003, 0, -0.0405);
  for (let i = 0; i < 3; i++) {
    const zc = 0.35 + i * 0.056;
    b.slab("lightSlot", RUBBER, [
      [zc - 0.022, 0.03],
      [zc - 0.017, 0.025],
      [zc + 0.017, 0.025],
      [zc + 0.022, 0.03],
      [zc + 0.017, 0.035],
      [zc - 0.017, 0.035],
    ], 0.083, 0);
  }
  b.slab("ejectPort", RUBBER, [
    [0.005, 0.024],
    [0.115, 0.024],
    [0.115, 0.05],
    [0.005, 0.05],
  ], 0.003, 0, 0.0405);
  // The brass deflector: a swept hump behind the port.
  b.slab("deflector", BODY, [
    [-0.045, 0.028],
    [-0.002, 0.028],
    [-0.002, 0.036],
    [-0.02, 0.054],
    [-0.045, 0.054],
  ], 0.012, 0.003, 0.044);
  // A thin frame round the port, standing a hair proud of the receiver, so
  // it reads as an opening cut into the side rather than a patch laid on it.
  b.box("portRim", BODY, 0.003, 0.004, 0.118, 0.042, 0.052, 0.06);
  b.box("portRim", BODY, 0.003, 0.004, 0.118, 0.042, 0.022, 0.06);
  b.box("portRim", BODY, 0.003, 0.034, 0.004, 0.042, 0.037, 0.117);
  b.box("portRim", BODY, 0.003, 0.034, 0.004, 0.042, 0.037, 0.003);
  // Takedown pins and a few screw heads, small — the size a real one is —
  // and the head of the bolt that clamps the barrel into the upper.
  for (const [z, y] of [[0.13, -0.008], [IRON_REAR_Z, -0.008], [0.25, 0.012], [0.47, 0.012]] as const) {
    b.pin("pin", METAL, 0.009, 0.084, 0, y, z);
  }
  b.pin("barrelBolt", METAL, 0.013, 0.086, 0, 0.014, 0.52);
  // Charging handle: a small folding lever at the front of its channel.
  b.box("chArm", POLYMER, 0.03, 0.01, 0.018, -0.055, 0.03, 0.29);
  b.box("chKnob", POLYMER, 0.012, 0.018, 0.03, -0.069, 0.03, 0.285);

  // Short side rails low on the front of the upper, and the bottom rail the
  // foregrip clamps to — at the same fine pitch as the top.
  for (const [side, facing] of [[-1, "left"], [1, "right"]] as const) {
    b.picatinny("sideRail", side * 0.04, -0.005, 0.392, 8, { width: 0.022, height: 0.008, facing });
  }
  b.picatinny("bottomRail", 0, -0.022, 0.21, 17, { width: 0.044, height: 0.009, facing: "down" });

  // --- lower receiver: polymer, shallow, hung under the rear of the upper.
  // Its front is one steep slant from the upper down to the magwell's mouth,
  // which is the SCAR lower's signature line; the flat behind the well runs
  // back to the grip ---
  b.slab("lower", POLYMER, [
    [-0.262, -0.018],
    [0.2, -0.018],
    [0.2, -0.03],
    [0.15, -0.126],
    [0.142, -0.134],
    [-0.01, -0.134],
    [-0.022, -0.12],
    [-0.04, -0.1],
    [-0.2, -0.1],
    [-0.245, -0.07],
    [-0.262, -0.05],
  ], 0.072, 0.005);
  // The mouth of the well, a little wider than the lower — the funnel.
  b.slab("magwellLip", POLYMER, [
    [-0.014, -0.138],
    [0.146, -0.138],
    [0.14, -0.122],
    [-0.018, -0.122],
  ], 0.078, 0.003);
  // Small, dark controls: magazine release at the guard, bolt catch above
  // it, and the ambidextrous selector over the grip.
  b.box("magRelease", POLYMER, 0.006, 0.014, 0.016, 0.037, -0.085, -0.012);
  b.box("magRelease", POLYMER, 0.006, 0.014, 0.016, -0.037, -0.085, -0.012);
  b.box("boltCatch", POLYMER, 0.005, 0.014, 0.03, -0.037, -0.05, -0.03);
  // Fire-control pins, and the maker's plate on the left flat with its three
  // lines of stamping — the one place a real receiver is lettered.
  b.pin("fcPin", METAL, 0.008, 0.074, 0, -0.06, -0.07);
  b.pin("fcPin", METAL, 0.008, 0.074, 0, -0.06, -0.215);
  b.slab("plate", BODY, [
    [-0.235, -0.028],
    [-0.14, -0.028],
    [-0.14, -0.058],
    [-0.235, -0.058],
  ], 0.003, 0, -0.0375);
  for (const [y, len] of [[-0.036, 0.07], [-0.043, 0.056], [-0.05, 0.036]] as const) {
    b.box("stamp", RUBBER, 0.002, 0.0028, len, -0.039, y, -0.225 + len / 2);
  }
  b.pin("safetyPin", METAL, 0.01, 0.078, 0, -0.045, -0.118);
  for (const side of [-1, 1] as const) {
    b.box("safetyLever", METAL, 0.004, 0.024, 0.009, side * 0.04, -0.035, -0.118);
  }
  // The guard is oversized and square, the way the SCAR's is — a gloved
  // finger has to get in. A U drawn from the side, down from the lower, along
  // under the trigger and into the grip's front face.
  b.slab("guard", POLYMER, [
    [-0.028, -0.095],
    [-0.028, -0.152],
    [-0.038, -0.162],
    [-0.15, -0.162],
    [-0.15, -0.151],
    [-0.042, -0.151],
    [-0.04, -0.148],
    [-0.04, -0.095],
  ], 0.022, 0.002);
  // Trigger: a curved blade, hollow along its front face where the finger lies
  // and curling forward at the tip.
  b.slab("trigger", METAL, [
    [-0.1, -0.095],
    [-0.091, -0.095],
    [-0.093, -0.112],
    [-0.093, -0.126],
    [-0.088, -0.137],
    [-0.086, -0.142],
    [-0.092, -0.139],
    [-0.098, -0.128],
    [-0.1, -0.112],
  ], 0.008, 0.001);

  // Raked back, and the SIGN is the whole of it: positive `rotX` sends
  // everything below the pivot BACKWARDS, which is the ~17 deg off vertical a
  // pistol grip stands at. Negative lays the toe out over the trigger guard,
  // which is not a rake at all — it is the grip on backwards. `PistolModel`'s
  // `GRIP_RAKE` carries the same note; every FIRING grip in the kit is this
  // sign, and every foregrip is its mirror — see the foregrip below.
  const gripPivot = b.pivot("gripPivot", 0, -0.1, -0.155, 0.3);
  // An A2-pattern grip, drawn by its two faces: a single finger swell on the
  // FRONT between the middle and ring fingers, a beavertail hump on the BACK
  // under the web of the hand, and slimmer than a hand-width block.
  b.upright("grip", POLYMER, [
    spanRing(-0.148, 0.05, 0.033, -0.037),
    spanRing(-0.12, 0.052, 0.032, -0.039),
    spanRing(-0.085, 0.053, 0.03, -0.041),
    spanRing(-0.066, 0.053, 0.037, -0.042),
    spanRing(-0.048, 0.053, 0.03, -0.043),
    spanRing(-0.02, 0.051, 0.033, -0.045),
    spanRing(0.01, 0.048, 0.034, -0.038),
  ], gripPivot);
  // The textured panel on each flank: a raised pad with the stippling given as
  // a run of fine ridges across it, standing past the moulding on both sides.
  b.slab("gripPanel", POLYMER, [
    [-0.03, -0.132],
    [0.014, -0.132],
    [0.02, -0.124],
    [0.02, -0.03],
    [0.014, -0.022],
    [-0.03, -0.022],
    [-0.036, -0.03],
    [-0.036, -0.124],
  ], 0.057, 0.002, 0, gripPivot);
  for (let i = 0; i < 7; i++) {
    b.box("gripStipple", POLYMER, 0.059, 0.0028, 0.042, 0, -0.035 - i * 0.014, -0.008, gripPivot);
  }
  // Dark cap: a light one reads as a second magazine floorplate at a glance.
  b.upright("gripCap", RUBBER, [
    spanRing(-0.158, 0.05, 0.033, -0.037),
    spanRing(-0.146, 0.051, 0.034, -0.038),
  ], gripPivot);

  // --- the side-folding stock: a hinge knuckle, then a solid trapezoid whose
  // top runs level from the receiver and whose underside falls away to a deep
  // toe. Built as a raised FRAME round a recessed web, because a SCAR stock's
  // side is a panel sunk inside its own rim, and that sunk panel is most of
  // what makes it read as moulded rather than cut from a block ---
  b.slab("stockHinge", BODY, [
    [-0.262, 0.05],
    [-0.27, 0.058],
    [-0.33, 0.058],
    [-0.338, 0.05],
    [-0.338, -0.024],
    [-0.33, -0.032],
    [-0.27, -0.032],
    [-0.262, -0.024],
  ], 0.074, 0.005);
  b.pin("hingePin", METAL, 0.012, 0.08, 0, 0.035, -0.3);
  b.pin("hingePin", METAL, 0.012, 0.08, 0, -0.012, -0.3);
  // The web: the recessed panel the frame stands round.
  b.slab("stockWeb", POLYMER, [
    [-0.34, 0.066],
    [-0.52, 0.078],
    [-0.52, -0.11],
    [-0.34, -0.026],
  ], 0.036, 0.003);
  // The frame: a front post at the hinge, a top bar, a raked bottom bar and
  // the butt post, each proud of the web on both sides.
  b.slab("stockFront", POLYMER, [
    [-0.336, 0.066],
    [-0.362, 0.068],
    [-0.362, -0.036],
    [-0.336, -0.028],
  ], 0.056, 0.005);
  b.slab("stockTop", POLYMER, [
    [-0.34, 0.046],
    [-0.34, 0.068],
    [-0.5, 0.079],
    [-0.5, 0.057],
  ], 0.056, 0.005);
  b.slab("stockBottom", POLYMER, [
    [-0.34, -0.004],
    [-0.34, -0.028],
    [-0.5, -0.108],
    [-0.5, -0.084],
  ], 0.056, 0.005);
  b.slab("stockRear", POLYMER, [
    [-0.485, 0.079],
    [-0.498, 0.085],
    [-0.516, 0.085],
    [-0.524, 0.076],
    [-0.524, -0.106],
    [-0.516, -0.116],
    [-0.494, -0.114],
    [-0.485, -0.102],
  ], 0.06, 0.005);
  b.box("slingRear", METAL, 0.004, 0.018, 0.012, -0.032, -0.07, -0.505);
  // The fold release on the front post, and a run of grip ridges across the
  // bottom bar where the support hand clamps the stock into the shoulder.
  b.pin("foldRelease", BODY, 0.014, 0.062, 0, 0.012, -0.35);
  for (let i = 0; i < 4; i++) {
    const z = -0.42 - i * 0.016;
    b.box("stockRidge", POLYMER, 0.059, 0.02, 0.004, 0, -0.016 + (z + 0.34) * 0.5, z);
  }
  // Cheek riser — the one part of the weapon a face actually rests on, and the
  // last place a square edge belongs, hence the deepest bevel on the rifle.
  // Moulded into the top bar rather than bolted on: it ramps up out of the
  // stock ahead of `CHEEK_FRONT_Z`, so the cone the irons are solved against
  // passes over the ramp with more room than it has at the riser itself.
  b.slab("cheekRiser", POLYMER, [
    [-0.336, 0.062],
    [CHEEK_FRONT_Z, CHEEK_TOP - 0.004],
    [CHEEK_FRONT_Z - 0.008, CHEEK_TOP],
    [-0.488, CHEEK_TOP],
    [-0.498, CHEEK_TOP - 0.008],
    [-0.498, 0.06],
  ], CHEEK_WIDTH, 0.009);
  // Butt pad: full height, its back face curved so the shoulder meets a
  // crescent rather than a plank, with grip ribs across its lower half.
  b.slab("buttPad", RUBBER, [
    [-0.522, 0.085],
    [-0.535, 0.083],
    [-0.541, 0.066],
    [-0.542, -0.098],
    [-0.536, -0.116],
    [-0.522, -0.117],
  ], 0.062, 0.004);
  for (let i = 0; i < 5; i++) {
    b.box("padRib", RUBBER, 0.064, 0.005, 0.012, 0, -0.03 - i * 0.017, -0.534);
  }

  // Raked the OTHER way from the pistol grip, and that is the rule rather
  // than an inconsistency: a rake leans away from the wrist that holds it, so
  // the firing hand's grip puts its toe BACK and the support hand's puts its
  // toe FORWARD. Two grips leaning apart is the silhouette; two leaning the
  // same way reads as a mistake in one of them. A slim ribbed vertical grip
  // on the bottom rail, not a paddle.
  const foregripPivot = b.pivot("foregripPivot", 0, -0.03, 0.44, -0.2);
  b.box("foregripClamp", POLYMER, 0.05, 0.012, 0.05, 0, -0.004, 0, foregripPivot);
  b.upright("foregrip", POLYMER, [
    spanRing(-0.1, 0.038, 0.02, -0.02, 0.45),
    spanRing(0.0, 0.034, 0.018, -0.018, 0.45),
  ], foregripPivot);
  for (let i = 0; i < 4; i++) {
    const y = -0.025 - i * 0.018;
    b.upright("foregripRib", POLYMER, [
      spanRing(y - 0.003, 0.039, 0.021, -0.021, 0.45),
      spanRing(y + 0.003, 0.039, 0.021, -0.021, 0.45),
    ], foregripPivot);
  }
  b.upright("foregripCap", RUBBER, [
    spanRing(-0.112, 0.041, 0.022, -0.022, 0.45),
    spanRing(-0.098, 0.041, 0.022, -0.022, 0.45),
  ], foregripPivot);

  // --- barrel: gas block and its regulator, a long exposed barrel, and the
  // flash hider. The SCAR's barrel stands well out of the receiver; that
  // length is half of its silhouette ---
  b.slab("gasBlock", BODY, [
    [0.548, BORE_Y - 0.02],
    [0.598, BORE_Y - 0.02],
    [0.602, BORE_Y - 0.014],
    [0.602, BORE_Y + 0.016],
    [0.594, BORE_Y + 0.024],
    [0.548, BORE_Y + 0.024],
  ], 0.04, 0.004);
  b.pin("gasRegulator", BODY, 0.018, 0.056, 0, BORE_Y + 0.004, 0.575);
  b.box("regulatorLever", BODY, 0.004, 0.024, 0.008, -0.03, BORE_Y + 0.012, 0.575, b.root, 0.4);
  b.tube("barrel", BODY, 0.024, 0.03, 0.18, 0, BORE_Y, 0.692);
  b.tube("barrelShoulder", BODY, 0.03, 0.03, 0.02, 0, BORE_Y, 0.612);
  // Birdcage: rear collar, four struts with the slots between them, open front
  // ring. `a0` is a half facet, so a slot rather than a strut sits at top dead
  // centre — which is where a muzzle device vents, to hold the barrel down.
  // The dark core is what the slots are cut against: without something behind
  // them they open onto the skybox and the cage reads as a smooth tube. Its
  // front face doubles as the bore, seen through the ring.
  b.tube("mzCollar", BODY, 0.036, 0.034, 0.02, 0, BORE_Y, 0.792);
  b.tube("mzCore", RUBBER, 0.022, 0.022, 0.044, 0, BORE_Y, 0.824);
  b.shell("mzStrut", BODY, 0.024, 0.007, 0.036, BORE_Y, 0.82, 4, Math.PI / 4, 0.5);
  // The bottom slot is webbed shut, the way a device that fights muzzle rise
  // vents everywhere but down.
  b.box("mzWeb", BODY, 0.016, 0.008, 0.036, 0, BORE_Y - 0.0155, 0.82);
  b.shell("crown", BODY, 0.024, 0.008, 0.01, BORE_Y, 0.843, 10);

  // The rifle itself is finished. Merge it before any optic is built, so a
  // sight's parts can never end up inside the weapon's colour groups.
  const meshes = b.merge("rifle", root);

  // The SCAR-H's 20-round 7.62 magazine: STRAIGHT, deep and plain, standing
  // at a slight forward rake. Built AFTER the weapon's own merge and merged
  // into a node of its own, so the reload can drop it out of the well — see
  // `WeaponParts.magazine`.
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  const magPivot = b.pivot("magPivot", 0, -0.12, 0.066, MAG_RAKE);
  const magRing = (y: number, w: number, d: number, k = 0.18) => ({ y, w, d, k });
  b.upright("magBody", POLYMER, [
    magRing(-0.178, 0.054, 0.108),
    magRing(0.03, 0.052, 0.106),
  ], magPivot);
  // Raised edges down the front and back, so each flank is a panel sunk
  // between them — the stock's trick, at the magazine's scale.
  for (const [front, back] of [[0.056, 0.047], [-0.047, -0.056]] as const) {
    b.slab("magEdge", POLYMER, [
      [back, -0.176],
      [front, -0.176],
      [front, 0.02],
      [back, 0.02],
    ], 0.058, 0.002, 0, magPivot);
  }
  // Two stiffening ribs round the lower body, where a hand strips it out.
  for (const y of [-0.14, -0.155]) {
    b.upright("magRib", POLYMER, [
      magRing(y - 0.003, 0.057, 0.111),
      magRing(y + 0.003, 0.057, 0.111),
    ], magPivot);
  }
  // Floorplate: polymer, a little proud all round, the way a real one is — a
  // bright steel base is the other giveaway of a toy.
  b.upright("magFloor", POLYMER, [
    magRing(-0.194, 0.058, 0.116, 0.25),
    magRing(-0.176, 0.058, 0.116, 0.25),
  ], magPivot);
  b.upright("magBase", RUBBER, [
    magRing(-0.2, 0.054, 0.108, 0.3),
    magRing(-0.192, 0.056, 0.112, 0.3),
  ], magPivot);
  meshes.push(...b.merge("rifleMag", magazine));

  // Every colour group the WEAPON itself merged, taken before the optics are
  // built so a finish can never reach one — see `WeaponBuild.takeFinish`.
  const finish = b.takeFinish();

  const optics = buildOptics(b, MOUNT, prefix);
  meshes.push(...optics.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, BORE_Y, 0.85),
    // Matches the `ejectPort` box above: brass leaves the right side of the
    // receiver, not the middle of the gun.
    ejectPort: new Vector3(0.05, 0.04, 0.06),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magazine,
    magDrop: magDropAxis(MAG_RAKE),
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
