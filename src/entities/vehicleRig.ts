/**
 * vehicleRig.ts — What every vehicle's DRAWING is, whatever kind it is, and
 * the helpers every model is drawn with.
 * Owns: the `VehicleRig` contract — the joints a hull's VIEW writes, the
 * segments hung off them and the three closures it calls — plus
 * `Box`/`Cyl`/`Shape`, the per-colour merge every model owes, the KITS (one
 * drawing a model and a view, built by the first rig of it: `HullKit`,
 * `segmentOf`) and their one palette (`hullPalette`), the one way a whip
 * antenna is built (`whip`), the one pose a rig is reset to
 * (`resetRigPose`), the one way a rig's drawing is written
 * (`writeHullDrawing`), switched (`setHullRigEnabled`) and painted
 * (`paintRig`), and the hull's one whole-hull MEASURE (`HullMeasure`,
 * `measureHull`) with the DETAIL flag on a kit's segments that the detail
 * tier swaps by (`BABYLON_EXIT.md` X4.2c).
 * Owns NO numbers. `TankModel.ts`, `TruckModel.ts` and `HeliModel.ts` are the
 * ART, one file per kind; this is the shape they all come out in, and the one
 * thing `entities/VehicleView.ts` poses. CLIENT-only: `entities/Vehicle.ts`
 * has never heard of it — the simulation reads a `HullFrame` and writes a
 * `HullPose`, and the view copies the pose onto these joints.
 *
 * **A hull's geometry is PARTS until `segment` merges it**: a box or a cylinder
 * is a `Part` on `src/geometry/`'s generators, a `Shape` is a `Part` from
 * `facet.ts`, and `mergeParts` is the per-colour merge — one SEGMENT a colour
 * a call, which is what a Babylon mesh of it was until `BABYLON_EXIT.md`
 * X4.2b. **Babylon is made NO mesh of a hull**: what a segment LOOKS like is
 * its KIT's, built once a model and a view — the first rig of that pair
 * merges it, every later one hangs the kit's segments without making a part
 * — and our renderer draws every hull as an instance of its kit
 * (`render/HullDraw.ts`). The segments are in the order the scene used to
 * receive the meshes, which `mergeByColor` explains and the front-to-back
 * sort breaks a tie by; `kit:hash --models` hashes that order.
 *
 * **A hull has a DETAIL TIER, and it is data on the MODEL** (`BABYLON_EXIT.md`
 * X4.2c, `PERF_PLAN.md` A3): each model names the `segment` calls that drop
 * at range (its `DETAIL` list, handed to `segmentOf`), every segment those
 * calls make is flagged (`HullKitSegment.detail`), and a hull whose whole
 * MEASURE projects under `CONFIG.graphics.culling.hullDetail` this frame
 * (`WorldCulling.keepsDetail`) draws without them — its REDUCED set, the
 * same kit with those segments written as nothing (`writeHullDrawing`). The
 * measure is the kit's, one sphere a hull (`HullMeasure`); it decides the
 * swap and nothing else. **The size gate stays PER SEGMENT under it**
 * (decided 2026-10-31): a segment of a hull drawn in full is still gated one
 * by one, as it always was, and no hull is dropped whole by either.
 *
 * **The JOINTS are OURS** (`BABYLON_EXIT.md` X4.2a, X4.1a's shape): a
 * `JointTree` (`rigJoints.ts`) whose first joint is the collider box's own
 * frame (`body`, which the view stands at the hull's `pos` and turns `yaw`)
 * and whose second is the model's `root`, each joint's world a float32 matrix
 * the rig owns, composed FRESH off the channels in `src/math`'s copies of
 * Babylon's arithmetic — what `TransformNode.computeWorldMatrix(true)` gave
 * for the same channels, bit for bit. Each segment's own local is composed
 * once at build (`HullSegment.local`), and `writeHullDrawing` writes its
 * world (that local times its joint's) for the drawing, once a frame from
 * `Game` (`drawHulls`), after every write and immediately before
 * `scene.render`. No node of a hull is in the scene. The muzzles and the
 * sight are joints with no segment, which nothing in the game reads: the
 * simulation replays them off the record (`hullFrame.ts`' `hullPointToRef`),
 * the same chain these compose.
 *
 * ## The rig is CLOSED over its own model, which is what buys the second kind
 *
 * A tank's running gear is two belts of scrolling links and a truck's is four
 * wheels that turn and two that steer, and no interface over both of those is
 * anything but a lie in one direction. So the rig does not DESCRIBE its running
 * gear at all — it carries `setRun`, a closure its own builder made, and
 * `VehicleView` hands it the figures the hull tells it (how far each side has
 * covered, how hard the stick is over, how far the rotor has turned) without
 * ever learning which of the kinds it is drawing. `reset` and `paint` are the
 * same bargain for the respawn and the wreck.
 *
 * That is why there is no `kind` field here and no branch in `Vehicle` or its
 * view: what a vehicle IS lives in `config/vehicles.ts` as a `VehicleSpec`,
 * in a frame file as a `HullFrame` and in a model file as this — the first two
 * married once in `entities/vehicleKinds.ts`, the third keyed by the same kind
 * in `entities/vehicleModels.ts`.
 *
 * ## What a model must state, because `Vehicle` cannot see the geometry
 *
 * A `HullFrame` (`entities/hullFrame.ts`): the three extents the drive cannot
 * do without — `gauge`, `contactReach`, `wheelReach`, all DRAWING decisions —
 * and the offsets of every joint between the collider box and a muzzle, which
 * the simulation replays as numbers rather than reading off these joints. Each
 * kind's lives in a Babylon-free frame file of its own (`tankFrame.ts`,
 * `truckFrame.ts`, `heliFrame.ts`) that its model IMPORTS and places its
 * joints FROM, and `entities/vehicleKinds.ts` hands it to the hull beside the
 * spec, so neither `Vehicle` nor the authority imports a model file.
 *
 * ## Two rules every model owes, both inherited and both already broken once
 *
 * - **Nothing emissive.** Written when the glow's `noGlow` exclusion was a
 *   one-shot scan at construction, which a hull built per round could never
 *   join. Since `BABYLON_EXIT.md` X4.2b a hull is drawn by the matte cel
 *   program alone (`render/hullProgram.ts`), with no emissive program and
 *   nothing in the glow's mask, so a glowing part is a program and a mask
 *   draw nobody has built — still a look nobody has chosen.
 * - **Nothing pickable.** Nothing of a hull is pickable — there is no mesh of
 *   one to pick — and nothing in the game picks one: what a hull is to a body
 *   and to a round is `Vehicle.rayBox`, off its own fields. A pickable visual
 *   would put the hitscan's wall ray, the bots' LOS and the ground probe on
 *   sixty triangles of track link.
 *
 * `segmentOf` enforces both by construction, which is why no model may build
 * a segment any other way — a model hands it parts, never meshes.
 */
import type { VehicleSpec } from "../config/vehicles";
import type { GeometryBuffer } from "../geometry/buffer";
import { createBox, createCylinder } from "../geometry/primitives";
import { Matrix, Vector3 } from "../math";
import { mergeParts, Part, PartNode, worldMatrixOf } from "../world/parts";
import { type Joint, JointTree } from "./rigJoints";

/**
 * `[width, height, depth, x, y, z, colour, rotX?, rotY?]`, as `SoldierModel`'s
 * with one rotation added.
 *
 * **`rotY` is what a faceted turret is made of.** Everything in the first
 * version was axis-aligned, and an axis-aligned box is a slab whichever way you
 * look at it: the turret came out as a crate with a pipe in it. A plate turned
 * about Y is a cheek, and two of them meeting at the mantlet are the wedge that
 * says "turret" from the front — the same trick the glacis plays with `rotX`,
 * in the other axis.
 */
export type Box = [
  number,
  number,
  number,
  number,
  number,
  number,
  string,
  number?,
  number?,
];

/**
 * `[diameter, length, x, y, z, colour, axis, diameterTop?]` — the round parts.
 *
 * **A road wheel is the reason this exists.** The first version drew them as
 * boxes, which is a bulldozer's running gear: the one silhouette cue that says
 * "tracked vehicle" is a row of DISCS, and a square wheel reads as a hatch in
 * the side of the track. A twelve-sided cylinder is forty-odd triangles
 * against a box's twelve, and both are free — a vehicle's cost is the colours
 * it merges to, and a round wheel merges into the same segment a square one did.
 */
export type Cyl = [
  number,
  number,
  number,
  number,
  number,
  string,
  "x" | "y" | "z",
  number?,
];

/**
 * `[part, colour]` — a part already BUILT, for the shapes neither a box nor a
 * cylinder can be: a profile extruded, a solid between two faces, a rod laid
 * at an angle (`entities/facet.ts`). The part is built at the origin in the
 * segment's own frame, may carry a position and rotation of its own, has no
 * parent, and is merged exactly as a box is — which is why it must carry
 * positions, normals AND uvs, the three attributes every box has. It is a
 * `Part` and not a mesh: nothing on a hull is anything but parts before
 * `segment`, and no Babylon mesh after it (`BABYLON_EXIT.md` X4.2b).
 */
export type Shape = readonly [Part, string];

/**
 * What a destroyed hull is repainted in. One colour for the whole vehicle —
 * a wreck has no team, which is the point of it not keeping its accent: the
 * thing standing in the street after the fire is cover, and cover belongs to
 * whoever is behind it.
 *
 * Shared by both models rather than stated twice, because a burnt-out truck and
 * a burnt-out tank are the same object to everybody who walks past one.
 */
const CHARRED = "#221f1c";

/**
 * One whip antenna, drawn as two links because a rigid rod cannot bow.
 *
 * The lower link turns at the mast foot and the upper hangs off its top, so the
 * pair describe a CURVE rather than a lever — which is the whole read, and the
 * reason segments were spent on the only parts of a vehicle that are not rigid.
 * `HullWhips` owns how far each is bent and `setAntennaBend` is what that
 * looks like, exactly the split the view's run and `setRun` have.
 */
export interface Whip {
  /** Turns at the mast foot. Takes `antenna.baseShare` of the bend. */
  base: Joint;
  /** Hangs off the base's top and finishes the bow, LAGGING behind it. */
  tip: Joint;
  /**
   * How much faster this mast answers than the model's LONGEST.
   *
   * A cantilever's natural frequency goes as 1/L^2, so a short mast is stiffer
   * than a long one by the square of the length ratio and nothing about it is
   * tuned separately: one config spring is scaled by this. It is on the WHIP
   * rather than in a table beside `Vehicle` because the lengths are a drawing
   * decision, and a model with one mast or three states what it has.
   */
  rate: number;
  /**
   * Where this whip is in the gust, so a pair are not stirred in lockstep by a
   * wind that is one wind. Radians of phase, and arbitrary — a pair that DID
   * swing in step would read as one animation playing twice.
   */
  phase: number;
}

/**
 * One SEGMENT of a hull and the joint it hangs off: what a Babylon mesh of
 * it was until `BABYLON_EXIT.md` X4.2b, its geometry now its KIT's
 * (`HullKit`) and drawn by our renderer at `local` times the joint's world
 * (`writeHullDrawing`).
 */
export interface HullSegment {
  readonly joint: Joint;
  /** The segment's own transform in its joint's frame — its kit's, composed once. */
  readonly local: Matrix;
}

/**
 * One segment of a kit's DRAWING: its geometry in its own frame, its local
 * transform in its joint's frame, the ONE colour it is painted (a hull is
 * merged per colour per joint, so a segment is one colour by construction),
 * and its bounding sphere in its own frame — the midpoint of its vertices'
 * extent and half that extent's diagonal, as Babylon's `BoundingSphere` made
 * them of the mesh it was: what a hull's segments are ORDERED by (Babylon's
 * front-to-back queue, `Game.hullPull`) and SIZE-GATED by
 * (`WorldCulling.keepsSphere`).
 */
export interface HullKitSegment {
  readonly name: string;
  readonly geometry: GeometryBuffer;
  readonly local: Matrix;
  /** The hex it is painted in its livery, as the model wrote it. */
  readonly color: string;
  readonly centre: Vector3;
  readonly radius: number;
  /**
   * Whether it is DETAIL — made by one of the `segment` calls its model names
   * as dropping at range (`BABYLON_EXIT.md` X4.2c, the model's `DETAIL`
   * list): drawn only while the whole hull's MEASURE (`HullKit.measure`)
   * projects at or above `CONFIG.graphics.culling.hullDetail`, and while it
   * is, under the size gate per segment like any other.
   */
  readonly detail: boolean;
}

/**
 * A hull's whole-hull MEASURE in its ROOT joint's frame (`VehicleRig.root`:
 * upright, under the collider box's frame, the bottom of the running gear at
 * y = 0): the bounding sphere of its kit's every vertex as the model built
 * them, the joints at rest — the midpoint of that extent and half its
 * diagonal, as Babylon's `BoundingSphere.reConstruct` made a mesh's
 * (`BABYLON_EXIT.md` X4.2c). A SIZE, not a bound: a turret turned or a gun
 * laid does not move it, and nothing culls by it. What the detail tier's swap
 * is asked of, and nothing else — the size gate stays per segment (decided
 * 2026-10-31).
 */
export interface HullMeasure {
  readonly centre: Vector3;
  readonly radius: number;
}

/**
 * One kind's drawing in one side's colours, built ONCE (`segmentOf`'s first
 * build of that kind and view): its segments in the order Babylon's scene
 * received the meshes they were (`mergeByColor`'s MADE order), which is the
 * order a rig's `segments` are in and the tie-break of the front-to-back
 * sort, and how many segments each of the builder's `segment` calls made,
 * which is how a later build of the same kind hangs the kit's segments
 * without building them.
 */
export interface HullKit {
  /** `${model}|${view}`, the registry's key. */
  readonly key: string;
  readonly segments: readonly HullKitSegment[];
  readonly calls: readonly number[];
  /** The whole hull's one measure (`HullMeasure`), which the detail tier swaps by. */
  readonly measure: HullMeasure;
}

/**
 * A built vehicle: the joints that move, the segments that draw, the three
 * extents the physics needs off the drawing, and what to do to all of it when
 * the hull respawns or burns.
 */
export interface VehicleRig {
  /**
   * Every joint below, parents first: OUR hierarchy (`rigJoints.ts`), each
   * world a float32 matrix the rig owns (`BABYLON_EXIT.md` X4.2a). Our
   * renderer draws the segments off them (X4.2b), and Babylon has no node and
   * no mesh of this rig.
   */
  tree: JointTree;
  /**
   * The collider box's own frame — what the view's invisible body box was
   * until X4.2a: stood at the hull's `pos` (the box's centre) and turned
   * `yaw`, by the view and nothing else. The tree's first joint; `root` hangs
   * off it.
   */
  body: Joint;
  /** Hung half a hull below `body` (`hullPointToRef`'s `drop`), by the view. */
  root: Joint;
  /**
   * The lean onto the GROUND, and nothing else. Separate from `root` because
   * the pitch and roll are a picture and the yaw is a rule: the collider box
   * never tilts, so anything reading the hull's heading reads `root` and gets
   * an angle that has no suspension in it.
   *
   * The RUNNING GEAR hangs off this and not off `sprung`: a track (or a tyre)
   * lies on the ground its contacts found, and the body is what moves against
   * it. **That is why the SUSPENSION's lean is not written here** — a
   * weight-transfer pitch on this joint rotates the running gear with it and
   * drives one end of the vehicle under the road. See `sprung`.
   */
  hull: Joint;
  /**
   * The sprung mass — everything the springs carry, and therefore everything
   * the springs may move: `HullSprings.flexHeave` holds its Y and
   * `HullSprings.flexSuspension` its pitch and roll, all three in the frame
   * of the `hull` joint it hangs off, so a compressing body compresses along its
   * OWN up axis rather than the world's.
   *
   * Splitting it off the running gear is the whole of what makes the travel
   * visible: a body that took its wheels down with it would drive them through
   * the road on every landing and bury its nose on every stop.
   */
  sprung: Joint;
  /**
   * Traverses. Local yaw, relative to the hull.
   *
   * **On a vehicle with no main gun this joint never moves**, and that is a
   * consequence rather than a special case: `Vehicle` keeps `turretYaw` equal
   * to the hull's own yaw on a gunless hull, so the difference written here is
   * always zero and the machine gun bolted above it is left riding a fixed
   * ring on the body. See `Vehicle.armed`.
   */
  turret: Joint;
  /**
   * Elevates. Local pitch, relative to the turret — and **null on a vehicle
   * that has no main gun**, which is the one place in the rig where a kind is
   * visible at all.
   *
   * Nullable rather than a dummy joint, because a dummy is a thing the next
   * reader has to discover is never used: every caller of `gunDirToRef`,
   * `muzzleToRef` and `fireGun` is already behind `Vehicle.armed`, and the
   * type is what says so.
   */
  gun: Joint | null;
  /** The barrel's tip: where a shell leaves and where its flash is lit. Null with `gun`. */
  muzzle: Joint | null;
  /**
   * The commander's gun on its ring: the mount TRAVERSES (local yaw, relative
   * to the turret it is bolted to) and the gun ELEVATES on it.
   *
   * **The turret is the parent and the angle held is a WORLD one anyway**,
   * which is the whole of what makes the second seat a second seat: `Vehicle`
   * holds `mgYaw` in the world exactly as it holds `turretYaw`, and writes the
   * DIFFERENCE here — so a turret traversing under a gunner who is not
   * touching anything leaves his gun laid where he laid it.
   */
  mgMount: Joint;
  mgGun: Joint;
  /** Where a machine-gun round leaves, and where its flash is lit. */
  mgMuzzle: Joint;
  /**
   * Where the GUNNER's eye goes when he puts the sight up: the optic head this
   * model already draws, at its outer face.
   *
   * **On `mgGun` and not on `mgMount`, which is what makes the picture a sight
   * picture.** Hung off the mount it would not elevate with the weapon, so the
   * barrel would swing up through the frame as the gun came up and the
   * parallax between the eye and the bore would change with every degree of
   * elevation. On the gun the two are PARALLEL at every lay: the barrel keeps
   * one place in the picture and the offset means the same thing at every
   * angle.
   *
   * It is a fact about the DRAWING and every one of the three is measured
   * against its own geometry — what a sight picture IS lives in
   * `CONFIG.vehicles.sight`, one block for the fleet. Two things bound it and
   * both have already cost a re-measurement somewhere in this tree: it must
   * clear the near plane (`CONFIG.camera` 0.05) against every part of its own
   * vehicle through the whole of `mg.pitchMin`..`pitchMax`, and on a hull whose
   * gun looks steeply DOWN it must still be over the pad with the machine
   * sitting on it — the same ground the muzzle is measured against.
   */
  mgSight: Joint;
  /** The masts, longest first — the order `rate` is measured against. May be empty. */
  antennae: readonly Whip[];
  /**
   * Every segment drawn, in its kit's order, with the joint it hangs off.
   * See `HullSegment`. Babylon is made no mesh of any of it
   * (`BABYLON_EXIT.md` X4.2b): our renderer draws the hull as an instance of
   * its `kit`.
   */
  segments: readonly HullSegment[];
  /** What every segment LOOKS like: its kind's drawing in its side's colours, shared by every hull of both. */
  kit: HullKit;
  /**
   * Whether the hull is drawn at all — the one switch, which the view follows
   * `Vehicle.present` with (`setHullRigEnabled`) and the drawing reads.
   */
  enabled: boolean;
  /**
   * Whether it is drawn in the CHARRED paint (`paint`) rather than its
   * livery: one colour for every segment, the drawing's to substitute.
   */
  charred: boolean;
  /**
   * The running gear, given how far each side has covered in metres, how hard
   * the stick is over (-1..1), and how far the ROTOR has turned in radians.
   *
   * **The steer is the third argument because a truck's front wheels turn and
   * a tank's do not**, and the tank ignores it for a reason rather than by
   * omission: its steer is ALREADY in the first two figures, as the difference
   * between them.
   *
   * **The rotor is the fourth for that reason one step further out.** A tank's
   * and a truck's powerplant drives the running gear, so how hard it is working
   * is already in the first two figures — where a helicopter's rotor turns
   * whether the machine is going anywhere or not, and is the only part of it
   * that moves while it sits on its pad. So each kind ignores what its own
   * drawing has no use for, and all four are figures `Vehicle` already holds.
   * A nullable second closure was the alternative and was refused: `gun`/
   * `muzzle` are called out above as "the one place in the rig where a kind is
   * visible at all", and a second nullable would turn a stated exception into a
   * pattern — worse, a `setRotor?` would DESCRIBE running gear, which is the
   * one thing this interface exists not to do.
   *
   * Nothing here may be read back — a side that has run further than the hull
   * has moved is a track slipping against a wall, not a faster vehicle.
   */
  setRun(left: number, right: number, steer: number, rotor: number): void;
  /**
   * Back to the pose and the paint a fresh hull arrives in. What a hull goes
   * through on the respawn timer, and the whole reason a destroyed vehicle is
   * repainted rather than replaced.
   */
  reset(): void;
  /** Charred, or back in its livery. */
  paint(wrecked: boolean): void;
}

/**
 * Bends one whip: the bow the spring is holding, and the lagged angle the tip
 * has actually reached.
 *
 * The two links are given the bend the way a cantilever takes one. `base` gets
 * the share nearest the root, where a real mast's curvature is greatest, and
 * the tip link is handed **what is left over** — `tip` minus what the base has
 * already contributed, because these are nested joints and a child's rotation is
 * relative to its parent's. That subtraction is the whole trick: `Vehicle` hands
 * in a tip angle that LAGS the base's, so while the whip is moving the leftover
 * is negative and the upper link bends back against the lower one into an S,
 * and when it settles the two agree and it reads as one smooth bow.
 *
 * Both angles are small and a joint composes its euler rotation in YXZ, as
 * Babylon's node did, so the two axes cross-couple slightly at the extremes.
 * That is a picture on a picture: nothing aims, walks or is picked against a
 * mast.
 */
export function setAntennaBend(
  w: Whip,
  share: number,
  bendX: number,
  bendZ: number,
  tipX: number,
  tipZ: number,
): void {
  const baseX = bendX * share;
  const baseZ = bendZ * share;
  w.base.rotation.x = baseX;
  w.base.rotation.z = baseZ;
  w.tip.rotation.x = tipX - baseX;
  w.tip.rotation.z = tipZ - baseZ;
}

/**
 * Every number a model states about one of its masts. Where it stands, how
 * long it is and how thick are drawing decisions, so they are the model's; how
 * a whip is BUILT out of them is the same on every hull and lives in `whip`.
 */
export interface WhipDrawing {
  /** The joints are `name` and `name-tip`, the segments `name-lo` and `name-hi`. */
  name: string;
  /** What the foot is bolted to — a turret, or the sprung body. */
  parent: Joint;
  /**
   * The pivot, in `parent`'s frame. Put it INSIDE the spring foot the model
   * draws, so the pivot is inside the foot at every bend the springs can reach.
   */
  foot: readonly [number, number, number];
  length: number;
  /** The model's LONGEST mast, which `Whip.rate` is measured against. */
  longest: number;
  /** See `Whip.phase`. */
  phase: number;
  color: string;
  /** Diameters at the foot, at the joint between the two links, and at the top. */
  taper: readonly [number, number, number];
  /** The ball the mast ends in, `[diameter, height]`. Absent for a bare tip. */
  cap?: readonly [number, number];
}

/**
 * Builds one whip: two joints in `tree`, one link drawn on each.
 *
 * Each link is drawn from its own joint's origin UP, and each tapers into the
 * next: a whip is thinner at the top, and the taper is what stops two straight
 * rods reading as one straight rod with a joint in it. A `cap` is the ball a
 * real whip ends in, so it is not an eye-poker.
 *
 * A cantilever's natural frequency goes as 1/L^2, so a short mast is stiffer
 * than the long one by the square of the length ratio and nothing about it is
 * tuned separately — see `Whip.rate`.
 */
export function whip(
  tree: JointTree,
  segment: Segments["segment"],
  d: WhipDrawing,
): Whip {
  const half = d.length / 2;
  const [foot, joint, top] = d.taper;
  const base = tree.add(d.name, d.parent);
  base.position.set(d.foot[0], d.foot[1], d.foot[2]);
  const tip = tree.add(`${d.name}-tip`, base);
  tip.position.set(0, half, 0);
  segment(`${d.name}-lo`, base, [], [
    [foot, half, 0, half / 2, 0, d.color, "y", joint],
  ]);
  const upper: Cyl[] = [[joint, half, 0, half / 2, 0, d.color, "y", top]];
  if (d.cap) upper.push([d.cap[0], d.cap[1], 0, half, 0, d.color, "y"]);
  segment(`${d.name}-hi`, tip, [], upper);
  return { base, tip, rate: (d.longest / d.length) ** 2, phase: d.phase };
}

/**
 * Puts a rig back to how it was built — every joint at rest, the running gear
 * back at the start of its run, the masts straight and the livery back on. What
 * `VehicleRig.reset` is on every kind, given the kind's own spec for the one
 * number it needs (how the masts share a bend).
 *
 * `gun` is the only joint a kind may lack, which is why it is the only one
 * written through `?.`.
 */
export function resetRigPose(rig: VehicleRig, spec: VehicleSpec): void {
  rig.hull.rotation.set(0, 0, 0);
  rig.sprung.position.y = 0;
  rig.sprung.rotation.set(0, 0, 0);
  rig.turret.rotation.set(0, 0, 0);
  rig.gun?.rotation.set(0, 0, 0);
  rig.mgMount.rotation.set(0, 0, 0);
  rig.mgGun.rotation.set(0, 0, 0);
  rig.setRun(0, 0, 0, 0);
  const share = spec.antenna.baseShare;
  for (const w of rig.antennae) setAntennaBend(w, share, 0, 0, 0, 0);
  paintRig(rig, false);
}

/**
 * Charred, or back in its livery: one flag the drawing reads
 * (`BABYLON_EXIT.md` X4.2b), which substitutes `CHARRED`'s slot for every
 * segment's own — what swapping every mesh's material for the charred one
 * did while Babylon drew the hull. What `VehicleRig.paint` is on every kind.
 */
export function paintRig(rig: VehicleRig, wrecked: boolean): void {
  rig.charred = wrecked;
}

/**
 * A hull's joint tree, begun: the collider box's frame (`VehicleRig.body`)
 * and the model's root under it, named `root` — the two joints every model's
 * own hang off, made first so the tree is parents first by construction.
 */
export function rigTree(root: string): { tree: JointTree; body: Joint; root: Joint } {
  const tree = new JointTree();
  const body = tree.add("hull-body", null);
  return { tree, body, root: tree.add(root, body) };
}

/**
 * The list a model hangs its segments into and the one function that turns
 * parts into them, handed back together so a builder holds one thing, and the
 * kit they are drawn as.
 *
 * Every model calls `segment` and none may make a segment any other way: this
 * is where the per-colour merge, the kit's bookkeeping and the joint each
 * segment hangs off are kept in step, and a segment made past it is one the
 * drawing has no geometry for.
 */
export interface Segments {
  segments: HullSegment[];
  /**
   * Builds a list of parts, merges them per colour, and hangs the result off
   * `parent` — one segment a colour, filed under that joint with its own local
   * (`HullSegment`). While this build is building its kit (the first of its
   * model and view) the parts are made and merged into it; after that the
   * kit's segments are hung as they are, and no part is made.
   *
   * The two lists are one segment: a cylinder in a colour the boxes beside it
   * already carry merges into their segment and costs nothing, which is why a
   * wheel's hub caps sit in the wheel segment and a barrel sits with the
   * mantlet. `shapes` are the same bargain for a part built beforehand.
   */
  segment(
    name: string,
    parent: Joint,
    boxes: Box[],
    cyls?: Cyl[],
    shapes?: readonly Shape[],
  ): void;
  /**
   * The kit this build drew from — or built, which is filed for every later
   * build of the same model and view, its MEASURE taken off `tree` at rest
   * in `root`'s frame (`HullMeasure`). Called once, after the model has hung
   * every segment and before anything poses a joint; a build that made a
   * different number of segment calls than the kit's builder did throws, and
   * so does a kit's build whose `detail` names a call the model never made.
   */
  kit(tree: JointTree, root: Joint): HullKit;
}

/**
 * Every kit built, by `HullKit.key`: a model's drawing in a view's colours,
 * built by its first rig and the same object for the life of the page — a kit
 * is module constants (the models' `KITS`, their parts), so nothing can make
 * two builds of one key differ.
 */
const kits = new Map<string, HullKit>();

/**
 * A model's `Segments`, for a rig of `model` (the kind's model name) in
 * `view`'s colours: building the kit if no rig of that key has, and hanging
 * the built one's otherwise. `detail` is the model's DETAIL list — the names
 * of the `segment` calls that drop at range (`HullKitSegment.detail`), data
 * on the model rather than a branch on its kind; every segment a named call
 * makes (one a colour) is detail.
 */
export function segmentOf(model: string, view: number, detail: readonly string[]): Segments {
  const key = `${model}|${view}`;
  const existing = kits.get(key) ?? null;
  const built: HullKitSegment[] = [];
  const calls: number[] = [];
  const segments: HullSegment[] = [];
  let call = 0;
  let at = 0;
  const segment = (
    name: string,
    parent: Joint,
    boxes: Box[],
    cyls: Cyl[] = [],
    shapes: readonly Shape[] = [],
  ): void => {
    if (existing) {
      const n = existing.calls[call++];
      if (n === undefined) throw new Error(`[hull] ${key}: a build made more segment calls than its kit's`);
      for (let k = 0; k < n; k++) {
        const seg = existing.segments[at++];
        if (seg.name !== name) throw new Error(`[hull] ${key}: segment "${name}" where the kit has "${seg.name}"`);
        segments.push({ joint: parent, local: seg.local });
      }
      return;
    }
    const parts: Part[] = [];
    const colors: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const [w, h, d, x, y, z, color, rotX = 0, rotY = 0] = boxes[i];
      const p = new Part(`${name}${i}`, createBox({ width: w, height: h, depth: d }));
      p.position.set(x, y, z);
      p.rotation.x = rotX;
      p.rotation.y = rotY;
      parts.push(p);
      colors.push(color);
    }
    for (let i = 0; i < cyls.length; i++) {
      const [dia, len, x, y, z, color, axis, diaTop = dia] = cyls[i];
      // Facet count by SIZE, so a hub cap is not paying for a road wheel's
      // silhouette. The cel shader flat-shades from screen-space derivatives,
      // so what a facet costs is an edge the light bands break on — and at
      // 20 cm there is no such edge to see.
      const p = new Part(
        `${name}c${i}`,
        createCylinder({
          height: len,
          diameterTop: diaTop,
          diameterBottom: dia,
          tessellation: dia >= 0.5 ? 12 : 8,
        }),
      );
      // A cylinder is built along +Y; these two put it along the axis asked
      // for. Same convention as `weaponKit`'s tube/pin.
      if (axis === "x") p.rotation.z = Math.PI / 2;
      else if (axis === "z") p.rotation.x = Math.PI / 2;
      p.position.set(x, y, z);
      parts.push(p);
      colors.push(color);
    }
    for (const [p, color] of shapes) {
      parts.push(p);
      colors.push(color);
    }
    const made = mergeByColor(parts, colors, name, shapes.length, detail.includes(name));
    for (const seg of made) {
      built.push(seg);
      segments.push({ joint: parent, local: seg.local });
    }
    calls.push(made.length);
  };
  const kit = (tree: JointTree, root: Joint): HullKit => {
    if (existing) {
      if (call !== existing.calls.length) throw new Error(`[hull] ${key}: a build made fewer segment calls than its kit's`);
      return existing;
    }
    for (const name of detail) {
      if (!built.some((seg) => seg.name === name)) throw new Error(`[hull] ${key}: its detail names "${name}", which the model never made`);
    }
    const made: HullKit = { key, segments: built, calls, measure: restMeasure(built, segments, tree, root) };
    kits.set(key, made);
    return made;
  };
  return { segments, segment, kit };
}

/**
 * Merges a segment's parts into one SEGMENT per colour, at identity, and
 * hands them back in the order Babylon's scene received the meshes they were
 * until `BABYLON_EXIT.md` X4.2b — which is not the colour order, and is the
 * order a rig's segments are in and what the front-to-back sort breaks a tie
 * by (`Game.hullPull`), as `Array.prototype.sort` broke one over meshes in
 * scene order.
 *
 * **A colour with ONE part is drawn as that part, transform and all**, rather
 * than merged into a segment at identity: a merge of one is a copy, and the
 * part keeps its own frame as the segment's local, exactly as the lone mesh
 * `MergeMeshes` was never asked about kept its own.
 *
 * **The segments are in the order their meshes were MADE.** When the parts
 * were meshes, a shape was built before its segment was called and a box or a
 * cylinder inside it, so a lone part's mesh stood in the scene at its PART's
 * moment — shapes first, then boxes, then cylinders — and every merge was
 * minted after all of them, in colour order (a colour's first appearance
 * among the boxes, then the cylinders, then the shapes). A colour is a
 * material's identity here because the factory kept one material a hex
 * (`CelMaterialFactory.get`), so the groups are the ones that merge made.
 */
function mergeByColor(
  parts: readonly Part[],
  colors: readonly string[],
  name: string,
  shapeCount: number,
  detail: boolean,
): HullKitSegment[] {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < parts.length; i++) {
    const g = groups.get(colors[i]);
    if (g) g.push(i);
    else groups.set(colors[i], [i]);
  }
  const list = [...groups.entries()];
  // Where each part's mesh used to be made: the shapes (the last
  // `shapeCount` parts) before the boxes and cylinders, which keep their order.
  const first = parts.length - shapeCount;
  const made = (i: number): number => (i >= first ? i - first : shapeCount + i);
  const when = list.map(([, g], k) => (g.length === 1 ? made(g[0]) : parts.length + k));
  const order = list.map((_, k) => k).sort((a, b) => when[a] - when[b]);
  return order.map((k) => {
    const [color, group] = list[k];
    if (group.length === 1) {
      const part = parts[group[0]];
      // A lone part's frame is its own; a part still hung off another would
      // be composed with it, which no model does.
      if (part.parent) throw new Error(`[hull] "${part.name}" still has a parent — detach or bake it first`);
      return kitSegment(name, part.geometry, worldMatrixOf(part, new Matrix()), color, detail);
    }
    return kitSegment(
      name,
      mergeParts(group.map((i) => parts[i])),
      worldMatrixOf(new PartNode(name), new Matrix()),
      color,
      detail,
    );
  });
}

/**
 * A kit segment of `geometry`, with its bounding sphere in its own frame: the
 * extent of its positions as the mesh was handed them (`extractMinAndMax`),
 * then `BoundingSphere.reConstruct`'s centre and radius.
 */
function kitSegment(name: string, geometry: GeometryBuffer, local: Matrix, color: string, detail: boolean): HullKitSegment {
  const p = geometry.positions;
  const min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  const max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
  for (let i = 0; i < p.length; i += 3) {
    min.minimizeInPlaceFromFloats(p[i], p[i + 1], p[i + 2]);
    max.maximizeInPlaceFromFloats(p[i], p[i + 1], p[i + 2]);
  }
  const radius = Vector3.Distance(min, max) * 0.5;
  const centre = max.addToRef(min, new Vector3()).scaleInPlace(0.5);
  return { name, geometry, local, color, centre, radius, detail };
}

/**
 * A kit's MEASURE (`HullMeasure`), off the build that made it: `tree`
 * composed at rest, every vertex of every segment carried through its local
 * and its joint's world into `root`'s frame, and the sphere of their extent —
 * the midpoint and half the diagonal, as `kitSegment` takes a segment's. Once
 * a kit, at its build; never on a frame.
 */
function restMeasure(
  kit: readonly HullKitSegment[],
  segments: readonly HullSegment[],
  tree: JointTree,
  root: Joint,
): HullMeasure {
  tree.compute();
  const toRoot = root.world.invertToRef(new Matrix());
  const world = new Matrix();
  const m = new Matrix();
  const v = new Vector3();
  const min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  const max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
  for (let s = 0; s < kit.length; s++) {
    segments[s].local.multiplyToRef(segments[s].joint.world, world);
    world.multiplyToRef(toRoot, m);
    const p = kit[s].geometry.positions;
    for (let i = 0; i < p.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(p[i], p[i + 1], p[i + 2], m, v);
      min.minimizeInPlace(v);
      max.maximizeInPlace(v);
    }
  }
  const centre = max.addToRef(min, new Vector3()).scaleInPlace(0.5);
  return { centre, radius: Vector3.Distance(min, max) * 0.5 };
}

/**
 * Every hull kit's colours as one palette, and the charred paint's slot in
 * it: what the hulls' material holds (`CelMaterialFactory.hullCelRecipe`)
 * and their segments' `uv2.x` indexes, 1-based — 0 is "not paletted"
 * (`writePaletteIndex`). A hex is one slot however it is cased: the same
 * colour either way.
 */
export function hullPalette(all: readonly HullKit[]): {
  readonly colors: readonly string[];
  slotOf(hex: string): number;
  readonly charred: number;
} {
  const slots = new Map<string, number>();
  const colors: string[] = [];
  const add = (hex: string): number => {
    const k = hex.toLowerCase();
    let slot = slots.get(k);
    if (slot === undefined) {
      colors.push(hex);
      slot = colors.length;
      slots.set(k, slot);
    }
    return slot;
  };
  for (const kit of all) for (const seg of kit.segments) add(seg.color);
  const charred = add(CHARRED);
  return {
    colors,
    slotOf: (hex) => {
      const slot = slots.get(hex.toLowerCase());
      if (slot === undefined) throw new Error(`[hull] ${hex} is in no kit's palette`);
      return slot;
    },
    charred,
  };
}

/**
 * A question asked of a world sphere this frame: whether the size gate keeps
 * a segment (`WorldCulling.keepsSphere`), or whether a hull's MEASURE keeps
 * its full set (`WorldCulling.keepsDetail`).
 */
export type SphereGate = (x: number, y: number, z: number, radius: number) => boolean;

// Scratch for `writeHullDrawing` and `measureHull`.
const _meshWorld = new Matrix();
const _centre = new Vector3();
const _scale = new Vector3();
const _measure = { x: 0, y: 0, z: 0, radius: 0 };

/**
 * A hull's whole-hull MEASURE in the world, this frame: its kit's
 * `HullMeasure` centre carried by the root joint's world, and its radius
 * scaled by that matrix's own scale (the length of its x axis; a hull's
 * joints scale nothing, so it is 1 to a rounding). **Deliberately NOT
 * `BoundingSphere._update`'s radius**, which a segment's sphere copies for
 * the order Babylon's queue sorted by: that scales by the largest component
 * of (1, 1, 1) carried through the matrix, so a matrix that only TURNS
 * inflates it by up to the square root of two with the hull's heading — a
 * swap that came 41% further out as a tank turned would be a swap decided
 * by its yaw. The root's world must be current — composed this frame —
 * which `writeHullDrawing` sees to; a script reading it owes a compose
 * first.
 */
export function measureHull(rig: VehicleRig, out: { x: number; y: number; z: number; radius: number }): void {
  const w = rig.root.world;
  Vector3.TransformCoordinatesToRef(rig.kit.measure.centre, w, _centre);
  const m = w.m;
  out.x = _centre.x;
  out.y = _centre.y;
  out.z = _centre.z;
  out.radius = Math.hypot(m[0], m[1], m[2]) * rig.kit.measure.radius;
}

/**
 * Composes the rig's joints and writes its DRAWING into `out` from `at`:
 * each segment's world matrix, sixteen floats in its kit's order — the
 * segment's own local times its joint's world, what `drawHullRig` handed
 * Babylon's mesh through `freezeWorldMatrix` until `BABYLON_EXIT.md` X4.2b —
 * and that segment's world bounding sphere into `spheres` from `spheresAt`,
 * four doubles a segment (centre, radius): `BoundingSphere._update`,
 * operation for operation, which is what Babylon's front-to-back queue sorted
 * the mesh by and its frustum test culled it by. `stride` segments are
 * written; past the kit's own (a kind with fewer segments than the drawing's
 * widest), for a segment `keeps` drops — the size gate, asked of the same
 * world sphere `WorldCulling` asked of the mesh's bounds — and for a DETAIL
 * segment (`HullKitSegment.detail`) of a hull whose whole MEASURE `full`
 * refuses this frame (`measureHull`, the detail tier, `BABYLON_EXIT.md`
 * X4.2c), sixteen zeros and a NaN sphere, which nothing draws. The tier is ON
 * TOP of the size gate: a detail segment of a hull drawn in full is still
 * gated as any segment is, and no segment but a detail one ever leaves by
 * the tier.
 *
 * **Called once a frame for every present hull, after every write and before
 * the render** (`Game.drawHulls`, inside the render span). The rig's switch
 * is the caller's to have asked. Allocates nothing.
 */
export function writeHullDrawing(
  rig: VehicleRig,
  out: Float32Array,
  at: number,
  stride: number,
  keeps: SphereGate,
  full: SphereGate,
  spheres: Float64Array,
  spheresAt: number,
): void {
  rig.tree.compute();
  measureHull(rig, _measure);
  const whole = full(_measure.x, _measure.y, _measure.z, _measure.radius);
  const segments = rig.segments;
  const kit = rig.kit.segments;
  for (let s = 0; s < stride; s++) {
    const o = at + s * 16;
    const c = spheresAt + s * 4;
    if (s < segments.length && (whole || !kit[s].detail)) {
      const seg = segments[s];
      seg.local.multiplyToRef(seg.joint.world, _meshWorld);
      const drawing = kit[s];
      Vector3.TransformCoordinatesToRef(drawing.centre, _meshWorld, _centre);
      Vector3.TransformNormalFromFloatsToRef(1.0, 1.0, 1.0, _meshWorld, _scale);
      const radius = Math.max(Math.abs(_scale.x), Math.abs(_scale.y), Math.abs(_scale.z)) * drawing.radius;
      if (keeps(_centre.x, _centre.y, _centre.z, radius)) {
        out.set(_meshWorld.m, o);
        spheres[c] = _centre.x;
        spheres[c + 1] = _centre.y;
        spheres[c + 2] = _centre.z;
        spheres[c + 3] = radius;
        continue;
      }
    }
    out.fill(0, o, o + 16);
    spheres[c] = spheres[c + 1] = spheres[c + 2] = spheres[c + 3] = Number.NaN;
  }
}

/**
 * The whole hull on or off — the rig's one switch (`VehicleRig.enabled`),
 * which every mesh's own flag was until `BABYLON_EXIT.md` X4.2b. Nothing on a
 * hull is switched separately, so the rig has the one switch.
 */
export function setHullRigEnabled(rig: VehicleRig, on: boolean): void {
  rig.enabled = on;
}
