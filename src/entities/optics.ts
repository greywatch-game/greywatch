/**
 * optics.ts — Every fittable sight, built onto whatever weapon asked for it.
 * Owns: the geometry of the irons, the two dots, the prism and the two scopes,
 * and the eye reference each one reports. Owns nothing about what a sight DOES
 * — that is `sights.ts`, from `CONFIG.sights`.
 *
 * Shared by every weapon with a rail on purpose: an optic is a thing bolted to
 * one, and every primary has one. Duplicating these builders per weapon would
 * be a place per weapon for the eye reference to drift, and the eye reference
 * is the number ADS derives the whole aimed pose from.
 *
 * Everything here is expressed against the weapon's own `OpticMount` — the
 * height of its rail and where along it the sight sits — so the same optic
 * lands correctly on a receiver of a different height without a single number
 * being re-tuned. That is not a convenience: `ViewModel.setSight` derives the
 * aimed pose from `sightCenter`, so a sight that ends up somewhere else is
 * still perfectly aligned, just carried differently.
 *
 * The other number everything is measured against is `eyeDistance` — how far
 * back the eye is held, which is what turns a length here into the angle the
 * shooter actually gets. It lives in `CONFIG.sights`, so an optic's size and
 * its eye relief are two halves of one decision; see `eyeDistance` below.
 *
 * Invariants: each optic is merged into its OWN meshes rather than into the
 * weapon's, which is what lets one be swapped for another without rebuilding
 * the gun under it. Emissive parts go through `build.lit`, never `collect`.
 */
import { MeshBuilder, Mesh, Color3, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { SIGHT_IDS, type SightId } from "./sights";
import {
  FACETS,
  METAL,
  POLYMER,
  RUBBER,
  type SightAssembly,
  type WeaponBuild,
} from "./weaponKit";

/**
 * Where a weapon offers its rail, and where along it a sight sits. Everything
 * an optic builds is measured from these four numbers.
 */
export interface OpticMount {
  /** Top face of the receiver's rail — what every sight base stands on. */
  railTop: number;
  /** The optic's own centre along the barrel axis (the holo window). */
  mountZ: number;
  /** The rear and front back-up iron stations. */
  ironRearZ: number;
  ironFrontZ: number;
}

/**
 * How far the eye sits behind a sight's own centre, in WEAPON units — the one
 * number every size here is measured against.
 *
 * An optic is only ever seen through, so what matters about it is angular: the
 * bore's half-angle at the eye is `radius / eyeDistance`, and NOTHING else
 * about the sight picture is a length. Halve an optic and halve the distance
 * the eye is held at, and the picture through it is identical to the pixel
 * while the thing bolted to the weapon is half the size. That is the whole
 * reason these are as small as they are: the sights used to be sized against
 * an eye held a rifle's length back, which made every one of them wider than
 * the receiver it stood on.
 *
 * `CONFIG.sights[id].eyeRelief` is in the CAMERA's frame and the weapon is
 * drawn at `viewmodel.scale`, so the conversion is that scale — see
 * `ViewModel.applyFit`, which derives the aimed pose from the same two numbers
 * in the other direction.
 */
export const eyeDistance = (id: SightId): number =>
  CONFIG.sights[id].eyeRelief / CONFIG.viewmodel.scale;

/**
 * Rises above the rail. Each is the LOWEST its own optic can be carried, and
 * for the two tube sights the floor is the same thing: the cone the eye sees
 * through the sight spreads with distance, and where it spreads far enough it
 * runs onto the weapon's own top deck — the rifle's rail runs out to 0.53 with
 * a folded iron leaf standing on the end of it. A sight lower than this puts
 * the gun in its own picture. The irons have no such floor, because what you
 * see under the front post through a rear aperture IS the weapon.
 *
 * These are therefore not free to be "realistic", and they are what is left of
 * the old bulk: the optics themselves came down by a third to a half, the
 * mounts under them by rather less.
 */
const IRON_RISE = 0.036;
const WIN_RISE = 0.078;
const SCOPE_RISE = 0.1;
const REFLEX_RISE = 0.072;
const PRISM_RISE = 0.096;
/**
 * The 6x's, and it is the ONE rise here the rail does not decide — see
 * `LONG_CONE`. What sets it is the objective bell's own outer radius: the
 * biggest tube in the kit has to stand high enough for the fattest part of it
 * to clear the receiver, and at 0.0566 of radius that is the number this is
 * solving. The cone clears the rail with 0.023 to spare as a side effect.
 */
const LONG_RISE = 0.098;

/**
 * The far end of the longest rail any weapon here offers, as a depth past the
 * optic's own mount — the DMR's and the sniper's, both of which run to z = 0.57
 * off a `mountZ` of 0.02. It is a bound on the RAIL and not on the weapon: the
 * sniper is a quarter longer than the DMR and stops its rail in the same place,
 * because past this every optic's cone is over barrel rather than over ribs.
 *
 * This is the number every rise above is really solving against, and it was
 * worked out by hand three times before it was written down: a sight's view
 * cone spreads with distance, and where it spreads far enough it runs onto the
 * weapon's own top deck. A cone that clears the rail HERE clears everything
 * forward of it too, because past the rail there is nothing left standing as
 * high — the gas block, the barrel and the flash hider are all well under it.
 *
 * So a new optic's rise and its cone are ONE decision, not two:
 *
 *     rise >= cone * (eyeDistance(id) + RAIL_REACH - <its ocular offset>)
 *
 * and the margin left over is how much daylight there is under the picture.
 * Break it and the far ribs of the rail sit in the bottom of the sight.
 *
 * **It is an inequality and not an equation, and past about 4x it stops
 * binding.** A higher magnification is a narrower aimed FOV, so the same
 * angular cone fills more of the screen — and the 6x's cone is chosen against
 * the FRAME instead, with this satisfied comfortably as a consequence. See
 * `LONG_CONE`, which is the one number here solved the other way round.
 */
const RAIL_REACH = 0.55;

/**
 * The holo's clear bore and wall. The shooter looks PAST the wall, so every
 * millimetre of it costs sight picture — keep it near the outline width and
 * let the bore carry the size. Outer radius is `(BORE + WALL * 2) / 2`, which
 * is what the turrets and the mount stand off from.
 *
 * The bore is `2 * eyeDistance("holo") * tan(half-angle)`, and the half-angle
 * is what the window is FOR — about 3.3 deg, a window a fifth of the screen
 * high, wide enough to find a target through and small enough that the housing
 * is not the largest thing on the weapon.
 */
const BORE = 0.072;
const WALL = 0.007;

/**
 * The two iron stations share a bore, which is what gives the picture its
 * depth: the rear ring is a third of the eye's distance to the front one, so
 * it reads as twice the size and the front hood floats inside it.
 */
const IRON_BORE = 0.048;

/**
 * The reflex's window, and the frame around it. Rectangular rather than round,
 * which is the whole silhouette: there is no tube here, so the frame is the
 * only thing between the eye and the world and it is kept to `REFLEX_FRAME`
 * either side of the glass.
 *
 * The HEIGHT is therefore not authored: it is `RAIL_REACH` solved for, the
 * tallest window this rise can carry with `REFLEX_FLOOR_GAP` of daylight left
 * under the picture, and it comes out at 0.060. Written as a number instead it
 * would go quietly wrong the first time the rise or the eye relief moved. The
 * WIDTH is free — nothing on a weapon stands out sideways — so it is simply
 * wider than it is tall, the way a reflex lens is.
 */
const REFLEX_WIN_W = 0.076;
const REFLEX_FLOOR_GAP = 0.005;
const REFLEX_WIN_H =
  (2 * (REFLEX_RISE - REFLEX_FLOOR_GAP) * eyeDistance("reflex")) /
  (eyeDistance("reflex") + RAIL_REACH);
const REFLEX_FRAME = 0.006;

/**
 * The 3.5x scope. A telescope here is a real tube the eye looks down — there
 * is no lens and no post-process, so how much of the frame is clear glass is
 * decided by the rim's angular size, and the bore has to be wide enough to be
 * worth looking through: `SCOPE_CONE` is the tangent of the half-angle that
 * buys, and at these numbers the picture is a circle about two thirds of the
 * screen high.
 *
 * That single number is what sizes the body, because a straight tube is the
 * WORST shape to spend it on: a cylinder wide enough not to clip the cone at
 * the objective is far wider than the cone needs at the eyepiece, which is
 * exactly the drainpipe this used to be. The tube is built as `SCOPE_SECTIONS`
 * steps instead, each only as wide as the cone is at ITS far rim — so the body
 * flares from eyepiece to objective the way a real scope's does, and the
 * silhouette is a scope rather than a can.
 */
const SCOPE_CONE = 0.099;
const SCOPE_WALL = 0.007;
const SCOPE_SECTIONS = 3;
/**
 * Ocular and objective, relative to `mountZ`. The tube's height and length are
 * set by ONE constraint, and it is not appearance: the view cone runs onto the
 * weapon's own rail and barrel where it spreads far enough, putting a lit
 * muzzle device inside the bottom of the sight picture. `SCOPE_RISE` is high
 * enough to keep the cone's lower edge clear of the rail, the gas block and
 * the flash hider all the way out, and the scope's omission of the folded
 * front iron is the same constraint again. Lower the rings and the weapon
 * appears in its own scope.
 *
 * Length is the one dimension that is NOT free to shrink with the rest: the
 * far rim's distance from the eye is what the bore is divided by, so a shorter
 * tube is a wider one. This is as long as it can be without reaching past the
 * charging handle.
 */
const SCOPE_OCULAR_DZ = -0.13;
const SCOPE_OBJECTIVE_DZ = 0.12;

/**
 * The clear bore a scope section ending `dz` from the sight centre must carry,
 * so that its far rim sits exactly on the view cone.
 */
const scopeBore = (dz: number): number =>
  2 * SCOPE_CONE * (eyeDistance("scope") + dz - SCOPE_OCULAR_DZ);

/**
 * The 2.5x prism. Built the same way as the scope — a stepped tube that
 * circumscribes the view cone — and everything different about it comes out of
 * one fact: a lower magnification is a WIDER aimed FOV, so filling the same
 * share of the screen needs a wider cone, and a wider cone needs either a
 * taller mount or a shorter body.
 *
 * It buys the second. The tube is a third of the scope's length and the eye is
 * held nearly as close, which is what keeps the objective under the scope's own
 * bell despite the wider cone — a prism is a glass block with a short air path
 * either side of it, and this is that shape rather than a shrunken telescope.
 *
 * `PRISM_CONE` is then not a choice at all — it is whatever `PRISM_RISE` will
 * pay for against `RAIL_REACH`, solved rather than written the way the reflex's
 * window is. It works out at 0.104: in screen terms a circle a little over half
 * the frame high, smaller than the scope's two thirds, and a WIDER cone of
 * actual world (5.9 deg against 5.7) — the honest way round for the optic that
 * magnifies less.
 */
/**
 * The wall and the step count are what the shooter actually LOOKS at, and they
 * are not the same lever as the cone.
 *
 * The bore is the picture and is solved above; everything outside it is a black
 * ring around that picture, and at the near end that ring was most of the
 * screen. Two things set its width, and only one of them is the wall: a section
 * carries its FAR rim's radius all the way back, so the ocular end stands
 * `cone * seg` proud of the cone whatever the wall does. Halving the step
 * length is therefore worth more than halving the wall — three sections over a
 * body this short is still a fine staircase.
 *
 * Measured on the rifle at full ADS, against the flush rims below: the
 * housing's outer edge came in from 97% of the half-screen to 81% while the
 * picture stayed exactly where the cone puts it (~50%), which is 40% less black
 * ring around the same view. The picture is not what got smaller and must not
 * be — it is `PRISM_CONE`'s, and `PRISM_CONE` answers to the rail.
 *
 * The floor under both is the same as the scope's: a wall thinner than the ink
 * shell `renderOutline` extrudes reads as a line rather than a rim.
 */
export const PRISM_WALL = 0.005;
const PRISM_SECTIONS = 3;
const PRISM_OCULAR_DZ = -0.06;
const PRISM_OBJECTIVE_DZ = 0.05;
const PRISM_FLOOR_GAP = 0.0025;
export const PRISM_CONE =
  (PRISM_RISE - PRISM_FLOOR_GAP) /
  (eyeDistance("prism") + RAIL_REACH - PRISM_OCULAR_DZ);

/** `scopeBore`'s twin: the clear bore a prism section ending at `dz` carries. */
const prismBore = (dz: number): number =>
  2 * PRISM_CONE * (eyeDistance("prism") + dz - PRISM_OCULAR_DZ);

/**
 * The 6x long scope. Built exactly as the 3.5x is — a stepped tube
 * circumscribing the view cone, in two rings — and the one thing that is
 * genuinely different about it is which constraint the cone answers to.
 *
 * **At 6x the picture is bounded by the SCREEN and not by the rail, which
 * inverts the rule the other two tube optics are solved under.** `PRISM_CONE`
 * is derived rather than chosen because the prism's rise is what its cone can
 * afford; run the same solve here and it comes out at 0.0967, which is 1.13 of
 * the screen's own half-height at this magnification — a sight picture with no
 * rim in it at all, which is not a scope, it is the absence of one. A higher
 * magnification is a NARROWER aimed FOV (`sights.ts` derives it), so the same
 * angular cone fills more of the frame, and past about 4x the rail stops being
 * the thing in the way. So this number is authored against the frame and the
 * rise is what follows, rather than the other way round.
 *
 * 0.072 is 0.84 of the screen's half-height at 6x, against the 3.5x scope's
 * 0.674 and the prism's 0.506 — the reading being that a bigger, heavier optic
 * shows you MORE of the frame, not less, and that the tunnel is the 3.5x's
 * character rather than a tax every scope owes. The daylight left under it
 * against `RAIL_REACH` is 0.023, which is the most of any optic here.
 */
const LONG_CONE = 0.072;
/**
 * Thicker than the scope's 0.007, and it is the one wall in this file that is
 * about weight rather than about the picture. Every dimension here is measured
 * against `eyeDistance`, which for this optic is the longest in the table
 * (0.355 weapon units against the scope's 0.274) — so a wall carried over at
 * the scope's thickness would come out proportionally THINNER on the largest
 * sight in the kit, which reads as a bigger tube made of foil.
 */
const LONG_WALL = 0.008;
const LONG_SECTIONS = 3;
/**
 * Ocular and objective, relative to `mountZ` — 0.32 of body, the longest thing
 * bolted to any weapon here and 28% longer than the 3.5x's.
 *
 * The rear end is bounded by the same thing the scope's is: on the rifle this
 * puts the ocular at z = -0.12 and the objective at 0.20, which stops just
 * short of that weapon's charging handle at 0.22. It clears every handle in
 * the kit by height anyway — they all sit at or under y = 0.058 and the tube's
 * underside is 0.04 above a rail that is itself higher than that — but the
 * length is authored to the tighter of the two constraints, because a handle
 * moved up on some future weapon would otherwise put a knob inside the bell.
 */
const LONG_OCULAR_DZ = -0.14;
const LONG_OBJECTIVE_DZ = 0.18;

/** `scopeBore`'s twin again: the clear bore a 6x section ending at `dz` carries. */
const longBore = (dz: number): number =>
  2 * LONG_CONE * (eyeDistance("longScope") + dz - LONG_OCULAR_DZ);

/**
 * The height a weapon's own geometry must stay UNDER at depth `z`, if it is not
 * to eat into the iron sight picture.
 *
 * What the eye gets through an aperture is the cone from the eye to the rear
 * ring's bore, and anything standing into that cone between the two takes a
 * bite out of the picture — enough of it and the picture is gone. The eye sits
 * `eyeDistance("iron")` behind the rear station (that is exactly what
 * `ViewModel.applyFit` puts it at), so the cone's lower edge is the straight
 * line from there to the bore's lower rim; this is that line at `z`.
 *
 * Exported because a stock is the one part of a weapon that lives BEHIND its
 * own rear sight, which makes it the one part whose height is not free — see
 * the comb in `DmrModel`, which is what this was written for. Forward of the
 * rear station the same cone runs onto the rail and the front sight's own
 * base, and that is not a fault: what you see under the post through an
 * aperture is meant to be the weapon.
 */
export function ironSightFloor(mount: OpticMount, z: number): number {
  const eyeBack = eyeDistance("iron");
  return (
    mount.railTop +
    IRON_RISE -
    (IRON_BORE / 2) * ((z - mount.ironRearZ + eyeBack) / eyeBack)
  );
}

/**
 * Builds all three optics onto one weapon and returns them keyed by id, with
 * every mesh they added.
 *
 * Called with the weapon already merged, so `build`'s colour groups are empty
 * and each optic's parts land in its own meshes.
 */
export function buildOptics(
  build: WeaponBuild,
  mount: OpticMount,
  prefix: string,
): { sights: Record<SightId, SightAssembly>; meshes: Mesh[] } {
  const b = build;
  const ironY = mount.railTop + IRON_RISE;
  const winY = mount.railTop + WIN_RISE;
  const scopeY = mount.railTop + SCOPE_RISE;
  const reflexY = mount.railTop + REFLEX_RISE;
  const prismY = mount.railTop + PRISM_RISE;
  const longY = mount.railTop + LONG_RISE;
  const winZ = mount.mountZ;

  /**
   * The back-up irons, folded flat the way they would be with an optic
   * mounted — standing them up would put pillars in the middle of the sight
   * picture the housing exists to keep clear. Part of each OPTIC rather than
   * of the weapon, so the iron loadout can stand its own sights up in the same
   * place without two sets of leaves fighting over it.
   */
  const foldedIrons = (front: boolean): void => {
    const r = mount.railTop;
    b.box("rsBase", METAL, 0.034, 0.016, 0.032, 0, r + 0.002, mount.ironRearZ + 0.042);
    b.box("rsLeaf", METAL, 0.028, 0.01, 0.062, 0, r + 0.008, mount.ironRearZ);
    // The front pair is the last thing the scope's view cone runs onto — see
    // SCOPE_OCULAR_DZ. A weapon wearing a scope this size is set up around it
    // rather than over a set of irons, so it simply does not carry them.
    if (!front) return;
    b.box("fsBase", METAL, 0.032, 0.016, 0.028, 0, r + 0.002, mount.ironFrontZ - 0.044);
    b.box("fsLeaf", METAL, 0.026, 0.008, 0.062, 0, r + 0.007, mount.ironFrontZ);
  };

  /**
   * Irons: a rear aperture on a low block and a hooded front post. The post's
   * TIP and the aperture's centre both sit on `ironY`, which is where the
   * sight centre goes — so aiming lines all three up at once and the picture
   * is right by construction.
   */
  const buildIron = (node: TransformNode): Vector3 => {
    // Both bases stand from the rail to the BORE's floor, never into it. The
    // bore's lower edge is only a few millimetres above the receiver from the
    // eye's point of view, so a base sized by hand blocks the bottom of the
    // aperture — which reads as a sight with a bite taken out of it.
    const floor = ironY - IRON_BORE / 2;
    const baseH = floor - mount.railTop;
    const baseY = (mount.railTop + floor) / 2;
    // Rear: a ring standing just clear of the rail on its own base.
    b.box("ironRearBase", METAL, 0.026, baseH, 0.026, 0, baseY, mount.ironRearZ);
    b.shell("ironRearRing", METAL, IRON_BORE, 0.0055, 0.01, ironY, mount.ironRearZ, 10);
    // Front: the same ring as a hood, with the post rising from its floor to
    // the axis. The bead is the aim point — a tritium dot, and the only thing
    // on this sight that is visible against a dark treeline.
    b.box("ironFrontBase", METAL, 0.028, baseH, 0.028, 0, baseY, mount.ironFrontZ);
    b.shell("ironFrontHood", METAL, IRON_BORE, 0.005, 0.012, ironY, mount.ironFrontZ, 10);
    const postH = IRON_BORE / 2;
    b.box("ironPost", METAL, 0.005, postH, 0.007, 0, ironY - postH / 2, mount.ironFrontZ);
    b.merge("iron", node);
    const bead = b.lit(
      MeshBuilder.CreateSphere(
        `${prefix}_ironBead`,
        { diameter: 0.005, segments: 6 },
        b.scene,
      ),
      node,
    );
    bead.position.set(0, ironY, mount.ironFrontZ);
    // The eye reference is the REAR aperture: that is the hole you look
    // through, and the front post lands on the axis behind it for free.
    return new Vector3(0, ironY, mount.ironRearZ);
  };

  /**
   * The miniature reflex sight: a small body on the rail carrying an open
   * rectangular frame, with one lit dot on the axis and a canted lens behind
   * it.
   *
   * The frame is the whole design. There is no tube and no rear ring, so the
   * only thing this sight puts in the picture is `REFLEX_FRAME` of wall around
   * a window wider than the holo's bore — which is what makes it the choice
   * for a fight already inside a room, where what you can see PAST the sight
   * is worth more than what you can see through it.
   */
  const buildReflex = (node: TransformNode): Vector3 => {
    // The rear leaf only. The window is lower than the holo's and its cone is
    // wider, so a standing front leaf sits about a millimetre inside the
    // bottom of the picture — the same call the scope makes, one size down.
    foldedIrons(false);
    const halfW = REFLEX_WIN_W / 2;
    const halfH = REFLEX_WIN_H / 2;
    const f = REFLEX_FRAME;
    // The body is whatever is LEFT between the rail and the window's lower
    // rim, exactly as the holo's saddle is: the rise is the constrained
    // number, so anything with a height of its own here fights it.
    const footY = mount.railTop + 0.004;
    const bodyFrom = mount.railTop + 0.008;
    const bodyTo = reflexY - halfH;
    b.box("reflexFoot", METAL, 0.046, 0.01, 0.064, 0, footY, winZ);
    b.box(
      "reflexBody",
      POLYMER,
      REFLEX_WIN_W + f * 2,
      bodyTo - bodyFrom,
      0.052,
      0,
      (bodyFrom + bodyTo) / 2,
      winZ,
    );
    b.box("reflexLever", METAL, 0.012, 0.02, 0.034, 0.03, footY + 0.007, winZ - 0.012);
    // The frame: two posts and a lid, each sized OUTWARD from the window so a
    // heavier frame can never eat the picture. The bottom bar is the body's
    // own top face, which is why there are three parts here and not four.
    for (const side of [-1, 1] as const) {
      b.box(
        "reflexPost",
        POLYMER,
        f,
        REFLEX_WIN_H + f,
        0.016,
        side * (halfW + f / 2),
        reflexY + f / 2,
        winZ,
      );
    }
    b.box(
      "reflexHood",
      POLYMER,
      REFLEX_WIN_W + f * 2,
      f,
      0.018,
      0,
      reflexY + halfH + f / 2,
      winZ,
    );
    // The emitter, in the rear lip of the window — the one part of this sight
    // deliberately standing INTO the picture, because that is where the thing
    // projecting the dot has to be. It costs almost nothing: it sits at the
    // very bottom and well behind the glass, and the cone rises going back
    // toward the eye, so what it actually eats is a couple of millimetres.
    b.box("reflexEmitter", METAL, 0.018, 0.009, 0.014, 0, bodyTo, winZ - 0.021);
    b.pin("reflexElev", METAL, 0.011, 0.008, 0, reflexY + halfH + f + 0.004, winZ, "y");
    b.pin("reflexWind", METAL, 0.011, 0.008, halfW + f + 0.004, reflexY, winZ, "x");
    b.pin("reflexBattery", METAL, 0.016, 0.009, -(halfW + f + 0.004), bodyTo - 0.008, winZ, "x");
    b.merge("reflex", node);

    // The dot IS the sight — there is nothing else to align, which is the one
    // thing this has over the irons. Smaller than the holo's, because there is
    // no ring around it to give it a scale.
    const dot = b.lit(
      MeshBuilder.CreateSphere(
        `${prefix}_reflexDot`,
        { diameter: 0.0028, segments: 6 },
        b.scene,
      ),
      node,
    );
    dot.position.set(0, reflexY, winZ);

    // The lens, canted back the way a reflex's is — it is a mirror for the
    // emitter under it, not a window. Its own material, for the same reason
    // the holo's glass has one: an alpha leaked into the shared emissive cache
    // would take every tracer and reticle in the game with it.
    const glassMat = new StandardMaterial(`${prefix}_reflexGlass`, b.scene);
    glassMat.emissiveColor = Color3.FromHexString("#3af0d6");
    glassMat.diffuseColor = Color3.Black();
    glassMat.specularColor = Color3.Black();
    glassMat.disableLighting = true;
    // Fainter than the holo's for the same reading: this window is twice the
    // area, and a tint that sits politely in a 0.072 bore is a green filter
    // across the whole picture at this size.
    glassMat.alpha = 0.07;
    const glass = MeshBuilder.CreatePlane(
      `${prefix}_reflexGlass`,
      {
        width: REFLEX_WIN_W,
        height: REFLEX_WIN_H,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      b.scene,
    );
    glass.parent = node;
    glass.position.set(0, reflexY, winZ);
    // The cant is small enough to stay inside the frame's own depth: any more
    // and the glass corners poke out through the posts.
    glass.rotation.x = -0.12;
    // Not optional, and the failure is not subtle: this scene has no Babylon
    // lights at all, so a mesh left on the default material renders BLACK —
    // which on a sight is an opaque window, not a missing tint.
    glass.material = glassMat;
    // noGlow for the holo's reason — bloom on a full-window tint is a haze
    // over the one thing the sight exists to keep clear.
    glass.metadata = { noInk: true, noGlow: true };
    glass.isPickable = false;

    return new Vector3(0, reflexY, winZ);
  };

  /**
   * The holographic sight: rail mount plus a round tube housing around the
   * sight axis, with a lit ring and dot floating in the bore.
   *
   * The mount's top face meets the housing's underside exactly, so the two
   * read as one assembly rather than a sight balanced on a block.
   */
  const buildHolo = (node: TransformNode): Vector3 => {
    foldedIrons(true);
    // Turrets and battery cap, standing off the housing's outer radius.
    const rOut = BORE / 2 + WALL;
    // Foot plate on the rail, and a saddle from it to the housing's underside.
    // The saddle is whatever is LEFT between the two, not a size of its own:
    // at this rise it is a low mount rather than the riser block the old
    // shoulder-height housing needed, and hard-coding a height for it would
    // put the tube back up in the air or bury it in the receiver.
    const footY = mount.railTop + 0.004;
    const saddleFrom = mount.railTop + 0.008;
    const saddleTo = winY - rOut;
    b.box("opticFoot", METAL, 0.056, 0.01, 0.104, 0, footY, winZ);
    b.box(
      "opticMount",
      POLYMER,
      0.048,
      saddleTo - saddleFrom,
      0.096,
      0,
      (saddleFrom + saddleTo) / 2,
      winZ,
    );
    b.box("opticLever", METAL, 0.014, 0.022, 0.038, 0.031, footY + 0.006, winZ + 0.02);
    b.pin("opticNut", METAL, 0.01, 0.062, 0, footY + 0.006, winZ - 0.032);
    // The housing: a shell of `FACETS` slabs about the sight axis, with a
    // heavier rim at each end. The bore is the sight picture — the rims are
    // sized OUTWARD from it so a wider rim never eats into what you can see.
    b.shell("sightTube", POLYMER, BORE, WALL, 0.042, winY, winZ);
    b.shell("sightRimF", POLYMER, BORE + 0.003, 0.009, 0.011, winY, winZ + 0.024);
    b.shell("sightRimR", POLYMER, BORE + 0.003, 0.009, 0.011, winY, winZ - 0.024);
    b.pin("elevTurret", METAL, 0.022, 0.013, 0, winY + rOut + 0.006, winZ, "y");
    b.pin("elevCap", METAL, 0.016, 0.006, 0, winY + rOut + 0.016, winZ, "y");
    b.pin("windTurret", METAL, 0.022, 0.013, rOut + 0.006, winY, winZ, "x");
    b.pin("battery", METAL, 0.019, 0.012, -(rOut + 0.006), winY - 0.006, winZ, "x");
    b.merge("holo", node);

    // Reticle: emissive ring + center dot.
    // Scaled with the bore, so the ring subtends what it always did: a reticle
    // is an angle, and one left at its old size in a smaller window would fill
    // the picture it is supposed to sit in.
    const ring = b.lit(
      MeshBuilder.CreateTorus(
        `${prefix}_reticleRing`,
        { diameter: 0.016, thickness: 0.002, tessellation: 24 },
        b.scene,
      ),
      node,
    );
    ring.rotation.x = Math.PI / 2; // face down the barrel axis
    ring.position.set(0, winY, winZ - 0.003);

    const dot = b.lit(
      MeshBuilder.CreateSphere(
        `${prefix}_reticleDot`,
        { diameter: 0.0032, segments: 6 },
        b.scene,
      ),
      node,
    );
    dot.position.set(0, winY, winZ - 0.003);

    // Faint holo glass filling the bore (own material — alpha must not leak
    // into the shared emissive cache). A disc, not a quad: the corners of a
    // square lens would poke through a round housing.
    const glassMat = new StandardMaterial(`${prefix}_holoGlass`, b.scene);
    glassMat.emissiveColor = Color3.FromHexString("#35f0ff");
    glassMat.diffuseColor = Color3.Black();
    glassMat.specularColor = Color3.Black();
    glassMat.disableLighting = true;
    glassMat.alpha = 0.12;
    const glass = MeshBuilder.CreateDisc(
      `${prefix}_holoGlass`,
      { radius: BORE / 2, tessellation: FACETS, sideOrientation: Mesh.DOUBLESIDE },
      b.scene,
    );
    glass.parent = node;
    glass.position.set(0, winY, winZ + 0.009);
    glass.material = glassMat;
    // noGlow: the GlowLayer would turn the faint tint into a cyan haze that
    // obscures the sight picture.
    glass.metadata = { noInk: true, noGlow: true };
    glass.isPickable = false;

    return new Vector3(0, winY, winZ);
  };

  /**
   * The 2.5x prism: a short stepped body on ONE integral mount, with an etched
   * chevron hung near the objective.
   *
   * The mount is what tells it apart from the scope at a glance, and it is not
   * decoration: a prism carries its glass in a single block and is bolted down
   * as one piece, where a scope is a tube borrowed by two rings. It also earns
   * its keep — a body this short in two rings would be rings end to end.
   */
  const buildPrism = (node: TransformNode): Vector3 => {
    // No front leaf, for the scope's reason: this cone is wider still.
    foldedIrons(false);
    const ocularZ = winZ + PRISM_OCULAR_DZ;
    const objectiveZ = winZ + PRISM_OBJECTIVE_DZ;
    const seg = (PRISM_OBJECTIVE_DZ - PRISM_OCULAR_DZ) / PRISM_SECTIONS;
    /** The radius a section carries — its FAR rim's. See `outerAt` in the scope. */
    const outerAt = (dz: number): number => {
      const i = Math.min(
        PRISM_SECTIONS,
        Math.max(1, Math.ceil((dz - PRISM_OCULAR_DZ) / seg)),
      );
      return prismBore(PRISM_OCULAR_DZ + i * seg) / 2 + PRISM_WALL;
    };
    for (let i = 0; i < PRISM_SECTIONS; i++) {
      const far = PRISM_OCULAR_DZ + seg * (i + 1);
      b.shell(
        "prismTube",
        POLYMER,
        prismBore(far),
        PRISM_WALL,
        seg,
        prismY,
        winZ + far - seg / 2,
      );
    }
    const rOcular = outerAt(PRISM_OCULAR_DZ);
    const rObjective = outerAt(PRISM_OBJECTIVE_DZ);
    // The two rims are the near end of the sight and therefore the widest thing
    // in the frame — the eyecup more so than the ocular, since it is nearer the
    // eye again. They are given the SAME outer radius rather than each standing
    // proud of the last, so the near end is one diameter instead of a stack of
    // three — a stack reads as detail on a bench and as a wider black band in
    // the one place this sight is actually looked through.
    b.shell("prismOcular", POLYMER, rOcular * 2, 0.005, 0.014, prismY, ocularZ - 0.003);
    // A rubber eyecup, which is the one part of this sight that is about the
    // eye relief rather than about the picture: it is short and unforgiving,
    // and a cup is what a shooter finds the box behind. Sized off the ocular's
    // OUTER radius, so it stands around the tube and never inside the cone.
    b.shell("prismCup", RUBBER, rOcular * 2, 0.005, 0.013, prismY, ocularZ - 0.014);
    b.shell("prismBell", POLYMER, rObjective * 2, 0.006, 0.022, prismY, objectiveZ + 0.01);
    // The mount: one block from the rail to the OCULAR section's underside, so
    // the wider objective end overhangs it rather than the block having to
    // clear the fattest part of a body that changes width along its length.
    const baseBottom = mount.railTop - 0.003;
    const baseTop = prismY - rOcular - 0.004;
    b.box(
      "prismMount",
      METAL,
      0.05,
      baseTop - baseBottom,
      0.088,
      0,
      (baseBottom + baseTop) / 2,
      winZ - 0.008,
    );
    b.box("prismLever", METAL, 0.013, 0.024, 0.044, 0.031, mount.railTop + 0.014, winZ - 0.02);
    b.pin("prismBolt", METAL, 0.011, 0.06, 0, mount.railTop + 0.014, winZ + 0.024);
    // Capped turrets, low against the body — a prism is zeroed once and left.
    // The wider knob opposite them is the reticle's illumination, which is the
    // part of this sight that gets used mid-round.
    const turretZ = winZ + 0.005;
    const rTurret = outerAt(0.005);
    b.pin("prismElev", METAL, 0.022, 0.012, 0, prismY + rTurret + 0.005, turretZ, "y");
    b.pin("prismElevCap", METAL, 0.017, 0.005, 0, prismY + rTurret + 0.0145, turretZ, "y");
    b.pin("prismWind", METAL, 0.022, 0.012, rTurret + 0.005, prismY, turretZ, "x");
    b.pin("prismIllum", METAL, 0.03, 0.013, -(rTurret + 0.006), prismY, turretZ, "x");
    b.merge("prism", node);

    // The reticle: a caret and nothing else, two arms merged into one emissive
    // mesh the way the scope's duplex is.
    //
    // A caret rather than a cross because the TIP is the aim point, and once
    // the tip is doing the aiming every other mark is something laid over the
    // target: the stadia bars and the drop post this carried were three more
    // red lines across a picture at 2.5x, where a target is small enough that
    // the marks meant to frame it cover it instead. What is left is the one
    // stroke you actually put on a body.
    //
    // Its size is a share of the CONE at the reticle's own depth, not a length:
    // the caret should read the same against the picture if the cone is ever
    // re-solved, and the picture is what the cone is.
    const retZ = objectiveZ - 0.03;
    const clearR = PRISM_CONE * (eyeDistance("prism") + retZ - ocularZ);
    const armLen = clearR * 0.5;
    const bars: Mesh[] = [];
    for (const side of [-1, 1] as const) {
      // The caret's arms: each hung from the axis so its top end lands ON it,
      // which is what makes the apex the aim point rather than something near
      // it. Babylon's rotation about z takes the bar's own +y to
      // `(-sin, cos)`, so the centre is half a length back down that vector.
      const a = 0.6;
      const arm = MeshBuilder.CreateBox(
        `${prefix}_prismRetCaret`,
        { width: 0.0011, height: armLen, depth: 0.0012 },
        b.scene,
      );
      arm.rotation.z = side * a;
      arm.position.set(
        (side * Math.sin(a) * armLen) / 2,
        prismY - (Math.cos(a) * armLen) / 2,
        retZ,
      );
      bars.push(arm);
    }
    const reticle = Mesh.MergeMeshes(bars, true, true);
    if (reticle) {
      reticle.name = `${prefix}_prismReticle`;
      b.lit(reticle, node);
    }

    // The eye reference is the ocular rim, exactly as the scope's is: the eye
    // goes behind the glass it looks through, not behind the middle of a body.
    return new Vector3(0, prismY, ocularZ);
  };

  /**
   * The 3.5x scope: a long tube in two clamp rings, with a duplex reticle
   * hung near the objective end.
   *
   * There is no glass and no post-process here — the eye genuinely looks down
   * a hollow tube, and what it can see through it is set by the far rim. That
   * is why the bore is half again the holo's: at 3.5x a narrow tube is a
   * keyhole. The reticle's arms are cut to just inside that far rim, so they
   * run out to the edge of the visible circle and stop.
   */
  const buildScope = (node: TransformNode): Vector3 => {
    foldedIrons(false);
    const ocularZ = winZ + SCOPE_OCULAR_DZ;
    const objectiveZ = winZ + SCOPE_OBJECTIVE_DZ;
    const seg = (SCOPE_OBJECTIVE_DZ - SCOPE_OCULAR_DZ) / SCOPE_SECTIONS;
    // The body, as steps that each just clear the cone at their own far rim.
    // A section is limited by that rim and by nothing else — its near end is
    // always wider than the cone needs there — so the staircase circumscribes
    // the cone and the sight picture is the last section's.
    // A section's outer radius is its FAR rim's — which is the radius the
    // whole section carries, so anything clamped to or standing on the tube at
    // `dz` has to be sized against the section `dz` falls in, not against the
    // cone where it happens to sit.
    const outerAt = (dz: number): number => {
      const i = Math.min(
        SCOPE_SECTIONS,
        Math.max(1, Math.ceil((dz - SCOPE_OCULAR_DZ) / seg)),
      );
      return scopeBore(SCOPE_OCULAR_DZ + i * seg) / 2 + SCOPE_WALL;
    };
    for (let i = 0; i < SCOPE_SECTIONS; i++) {
      const far = SCOPE_OCULAR_DZ + seg * (i + 1);
      b.shell(
        "scopeTube",
        POLYMER,
        scopeBore(far),
        SCOPE_WALL,
        seg,
        scopeY,
        winZ + far - seg / 2,
      );
    }
    const rOcular = outerAt(SCOPE_OCULAR_DZ);
    const rObjective = outerAt(SCOPE_OBJECTIVE_DZ);
    // Eyepiece and objective bell, both sized outward from their own section's
    // bore so neither can narrow the sight picture.
    b.shell("scopeOcular", POLYMER, rOcular * 2, 0.012, 0.016, scopeY, ocularZ - 0.004);
    b.shell("scopeDiopter", METAL, rOcular * 2, 0.009, 0.01, scopeY, ocularZ + 0.026, 10);
    b.shell("scopeBell", POLYMER, rObjective * 2, 0.009, 0.026, scopeY, objectiveZ + 0.012);
    // Two clamp rings, each around the section it lands on, on bases tall
    // enough to bridge the gap the cone needs (see SCOPE_RISE) — clearing the
    // weapon's own rail is why a scope stands off as far as this one does.
    // A base runs from a hair under the rail to the underside of its own clamp
    // ring, so the two meet with no seam and no overlap however high this
    // weapon carries its rail.
    const baseBottom = mount.railTop - 0.003;
    for (const dz of [-0.02, 0.085] as const) {
      const rRing = outerAt(dz);
      const baseTop = scopeY - rRing - 0.007;
      b.box(
        "scopeRingBase",
        METAL,
        0.042,
        baseTop - baseBottom,
        0.024,
        0,
        (baseBottom + baseTop) / 2,
        winZ + dz,
      );
      b.shell("scopeRing", METAL, rRing * 2, 0.007, 0.02, scopeY, winZ + dz, 10);
    }
    const turretZ = winZ + 0.005;
    const rTurret = outerAt(0.005);
    b.pin("scopeElev", METAL, 0.026, 0.015, 0, scopeY + rTurret + 0.007, turretZ, "y");
    b.pin("scopeElevCap", METAL, 0.018, 0.006, 0, scopeY + rTurret + 0.018, turretZ, "y");
    b.pin("scopeWind", METAL, 0.026, 0.015, rTurret + 0.007, scopeY, turretZ, "x");
    b.pin("scopeParallax", METAL, 0.021, 0.012, -(rTurret + 0.006), scopeY, turretZ, "x");
    b.merge("scope", node);

    // Duplex reticle: four arms in from the tube wall, and a centre dot. Built
    // as one merged emissive mesh — five separate draws for a crosshair is
    // five too many on the one model that is always on screen.
    // The arms run to just inside the CONE at the reticle's own depth, not to
    // the tube wall beside it: the visible circle is the cone's, and a wall
    // this far up the flare is well outside it.
    const retZ = objectiveZ - 0.06;
    const armIn = 0.011;
    const armOut = SCOPE_CONE * (eyeDistance("scope") + retZ - ocularZ) - 0.004;
    const armLen = armOut - armIn;
    const armMid = (armIn + armOut) / 2;
    const bars: Mesh[] = [];
    for (const side of [-1, 1] as const) {
      const v = MeshBuilder.CreateBox(
        `${prefix}_scopeRetV`,
        { width: 0.0017, height: armLen, depth: 0.0012 },
        b.scene,
      );
      v.position.set(0, scopeY + side * armMid, retZ);
      bars.push(v);
      const h = MeshBuilder.CreateBox(
        `${prefix}_scopeRetH`,
        { width: armLen, height: 0.0017, depth: 0.0012 },
        b.scene,
      );
      h.position.set(side * armMid, scopeY, retZ);
      bars.push(h);
    }
    const centre = MeshBuilder.CreateSphere(
      `${prefix}_scopeRetDot`,
      { diameter: 0.003, segments: 6 },
      b.scene,
    );
    centre.position.set(0, scopeY, retZ);
    bars.push(centre);
    const reticle = Mesh.MergeMeshes(bars, true, true);
    if (reticle) {
      reticle.name = `${prefix}_scopeReticle`;
      b.lit(reticle, node);
    }

    // The eye reference is the ocular rim — a scope's eye relief is measured
    // to the glass you put your eye behind, not to the middle of the tube.
    return new Vector3(0, scopeY, ocularZ);
  };

  /**
   * The 6x long scope: the 3.5x one size up and one constraint different, with
   * a floating dot in a fine crosshair and two holdover ticks under it.
   *
   * Everything structural is `buildScope`'s — a stepped tube that circumscribes
   * its own view cone, two clamp rings, an eyepiece and a bell — and what is
   * added is the two things a long-range optic has that a general-purpose one
   * does not: a SUNSHADE past the objective, and turrets tall enough to be
   * turned rather than capped and forgotten. Both are sized OUTWARD from their
   * own section's outer radius, so neither can reach into the picture.
   */
  const buildLongScope = (node: TransformNode): Vector3 => {
    // The rear leaf only, exactly as the scope and the prism do: at this rise a
    // standing front leaf would be a pillar in the middle of the one sight
    // picture in the game that has no field to spare.
    foldedIrons(false);
    const ocularZ = winZ + LONG_OCULAR_DZ;
    const objectiveZ = winZ + LONG_OBJECTIVE_DZ;
    const seg = (LONG_OBJECTIVE_DZ - LONG_OCULAR_DZ) / LONG_SECTIONS;
    /** The radius a section carries — its FAR rim's. See `outerAt` in the scope. */
    const outerAt = (dz: number): number => {
      const i = Math.min(
        LONG_SECTIONS,
        Math.max(1, Math.ceil((dz - LONG_OCULAR_DZ) / seg)),
      );
      return longBore(LONG_OCULAR_DZ + i * seg) / 2 + LONG_WALL;
    };
    for (let i = 0; i < LONG_SECTIONS; i++) {
      const far = LONG_OCULAR_DZ + seg * (i + 1);
      b.shell(
        "longTube",
        POLYMER,
        longBore(far),
        LONG_WALL,
        seg,
        longY,
        winZ + far - seg / 2,
      );
    }
    const rOcular = outerAt(LONG_OCULAR_DZ);
    const rObjective = outerAt(LONG_OBJECTIVE_DZ);
    // Eyepiece, diopter ring and a rubber cup. The cup is the prism's part for
    // the opposite reason: there it stands for an eye box a shooter has to
    // find, and here it stands for the longest relief in the table — a cup is
    // what says the weapon is meant to be fired from behind the glass rather
    // than pressed against it.
    b.shell("longOcular", POLYMER, rOcular * 2, 0.013, 0.016, longY, ocularZ - 0.004);
    b.shell("longDiopter", METAL, rOcular * 2, 0.009, 0.011, longY, ocularZ + 0.028, 10);
    b.shell("longCup", RUBBER, rOcular * 2, 0.006, 0.014, longY, ocularZ - 0.016);
    b.shell("longBell", POLYMER, rObjective * 2, 0.01, 0.028, longY, objectiveZ + 0.013);
    // The sunshade: a plain tube standing off the BELL's outer radius and
    // reaching forward past it. It is the one part of this sight that is not
    // about what the shooter sees through it — it is about what the sun does to
    // the glass — and it is the cue that reads at a glance as an optic set up
    // for one shot at long range.
    b.shell(
      "longShade",
      POLYMER,
      rObjective * 2 + 0.004,
      0.006,
      0.05,
      longY,
      objectiveZ + 0.052,
    );
    // Two clamp rings, straddling the mount. Taller bases than the scope's: the
    // bell is the widest thing in the kit and the tube has to stand clear of
    // the receiver at its fattest, not at its thinnest.
    const baseBottom = mount.railTop - 0.003;
    for (const dz of [-0.05, 0.075] as const) {
      const rRing = outerAt(dz);
      const baseTop = longY - rRing - 0.008;
      b.box(
        "longRingBase",
        METAL,
        0.046,
        baseTop - baseBottom,
        0.028,
        0,
        (baseBottom + baseTop) / 2,
        winZ + dz,
      );
      b.shell("longRing", METAL, rRing * 2, 0.008, 0.024, longY, winZ + dz, 10);
    }
    // Exposed target turrets — tall and knurled, which is the one place this
    // differs from the scope in KIND rather than in size. A capped turret is a
    // sight zeroed once and left; these are the marks a shooter dials a drop
    // into between shots, which is exactly the tempo the weapon this was drawn
    // for is fired at.
    const turretZ = winZ + 0.012;
    const rTurret = outerAt(0.012);
    b.pin("longElev", METAL, 0.03, 0.026, 0, longY + rTurret + 0.013, turretZ, "y");
    b.pin("longElevCap", METAL, 0.022, 0.007, 0, longY + rTurret + 0.0295, turretZ, "y");
    b.pin("longWind", METAL, 0.03, 0.026, rTurret + 0.013, longY, turretZ, "x");
    b.pin("longFocus", METAL, 0.034, 0.016, -(rTurret + 0.008), longY, turretZ, "x");
    // A throw lever on the ocular: the magnification ring is the one control on
    // this sight a shooter reaches for with the weapon still shouldered.
    b.box("longLever", METAL, 0.012, 0.03, 0.014, 0.028, longY + 0.018, ocularZ + 0.028);
    b.merge("longScope", node);

    // The reticle: a fine full crosshair, a floating centre dot, and two
    // holdover ticks under it.
    //
    // It is the prism's argument answered in the other direction. There, marks
    // meant to frame a target COVER it, because at 2.5x a body across the
    // square is a few pixels; here a body at 300 m subtends what one at 50 m
    // does through the irons, so there is room around it for the marks to mean
    // something. The arms are thinner than the scope's for the same reason —
    // magnification scales the reticle along with everything else, and a
    // duplex's weight at 6x is a fence across the picture.
    const retZ = objectiveZ - 0.075;
    const clearR = LONG_CONE * (eyeDistance("longScope") + retZ - ocularZ);
    const armIn = 0.005;
    const armOut = clearR - 0.004;
    const armLen = armOut - armIn;
    const armMid = (armIn + armOut) / 2;
    const bars: Mesh[] = [];
    for (const side of [-1, 1] as const) {
      const v = MeshBuilder.CreateBox(
        `${prefix}_longRetV`,
        { width: 0.0012, height: armLen, depth: 0.0012 },
        b.scene,
      );
      v.position.set(0, longY + side * armMid, retZ);
      bars.push(v);
      const h = MeshBuilder.CreateBox(
        `${prefix}_longRetH`,
        { width: armLen, height: 0.0012, depth: 0.0012 },
        b.scene,
      );
      h.position.set(side * armMid, longY, retZ);
      bars.push(h);
    }
    // The holdovers, on the lower arm only — a drop is one direction. Spaced as
    // a fraction of the CONE rather than as a length, exactly as the prism's
    // caret is sized, so they keep their place against the picture if the cone
    // is ever re-solved.
    for (let i = 1; i <= 2; i++) {
      const tick = MeshBuilder.CreateBox(
        `${prefix}_longRetTick`,
        { width: clearR * 0.13, height: 0.0012, depth: 0.0012 },
        b.scene,
      );
      tick.position.set(0, longY - clearR * 0.3 * i, retZ);
      bars.push(tick);
    }
    const centre = MeshBuilder.CreateSphere(
      `${prefix}_longRetDot`,
      { diameter: 0.0022, segments: 6 },
      b.scene,
    );
    centre.position.set(0, longY, retZ);
    bars.push(centre);
    const reticle = Mesh.MergeMeshes(bars, true, true);
    if (reticle) {
      reticle.name = `${prefix}_longReticle`;
      b.lit(reticle, node);
    }

    // The ocular rim, as on the scope: a sight's eye relief is measured to the
    // glass the eye goes behind, and here it is the number the camera's near
    // plane is arguing with — see `CONFIG.sights.longScope.eyeRelief`.
    return new Vector3(0, longY, ocularZ);
  };

  const BUILDERS: Record<SightId, (node: TransformNode) => Vector3> = {
    reflex: buildReflex,
    iron: buildIron,
    holo: buildHolo,
    prism: buildPrism,
    scope: buildScope,
    longScope: buildLongScope,
  };

  const sights = {} as Record<SightId, SightAssembly>;
  const meshes: Mesh[] = [];
  for (const id of SIGHT_IDS) {
    const node = new TransformNode(`${prefix}_sight_${id}`, b.scene);
    node.parent = b.root;
    const centre = BUILDERS[id](node);
    const sightCenter = new TransformNode(`${prefix}_${id}_sightCenter`, b.scene);
    sightCenter.parent = node;
    sightCenter.position = centre;
    // The builder has already parented its merged colour groups and its
    // reticle to `node`, so the node itself is the list — no bookkeeping to
    // keep in step with it.
    const own = node.getChildMeshes(true) as Mesh[];
    meshes.push(...own);
    sights[id] = { root: node, sightCenter, meshes: own };
  }
  return { sights, meshes };
}
