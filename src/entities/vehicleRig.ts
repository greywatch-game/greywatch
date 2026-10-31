/**
 * vehicleRig.ts — What every vehicle's MESH is, whatever kind it is, and the
 * helpers every model is drawn with.
 * Owns: the `VehicleRig` contract — the joints a hull's VIEW writes and the
 * three closures it calls — plus `Box`/`Cyl`/`Shape`, the per-colour merge and
 * the outline pass every model owes, the one way a whip antenna is built
 * (`whip`), the one pose a rig is reset to (`resetRigPose`), and the one way a
 * rig's meshes are handed their matrices (`drawHullRig`), switched
 * (`setHullRigEnabled`) and freed (`disposeHullRig`).
 * Owns NO geometry and no numbers. `TankModel.ts`, `TruckModel.ts` and
 * `HeliModel.ts` are the ART, one file per kind; this is the shape they all
 * come out in, and the one thing `entities/VehicleView.ts` draws. CLIENT-only:
 * `entities/Vehicle.ts` has never heard of it — the simulation reads a
 * `HullFrame` and writes a `HullPose`, and the view copies the pose onto these
 * joints.
 *
 * **A hull's geometry is PARTS until `segment` merges it**: a box or a cylinder
 * is a `Part` on `src/geometry/`'s generators, a `Shape` is a `Part` from
 * `facet.ts`, `mergeParts` is the per-colour merge, and `drawnMesh` is the one
 * place any of it becomes a Babylon mesh. The meshes are MADE in the order the
 * scene used to receive them, which `mergeByColor` explains; `kit:hash
 * --models` hashes that order.
 *
 * **The JOINTS are OURS** (`BABYLON_EXIT.md` X4.2a, X4.1a's shape): a
 * `JointTree` (`rigJoints.ts`) whose first joint is the collider box's own
 * frame (`body`, which the view stands at the hull's `pos` and turns `yaw`)
 * and whose second is the model's `root`, each joint's world a float32 matrix
 * the rig owns, composed FRESH off the channels in `src/math`'s copies of
 * Babylon's arithmetic — what `TransformNode.computeWorldMatrix(true)` gave
 * for the same channels, bit for bit. **Babylon still draws the merged
 * meshes, and none has a parent**: each mesh's own local is composed once at
 * build (`HullMesh.local`), and `drawHullRig` hands Babylon its world (that
 * local times its joint's) through `freezeWorldMatrix`, once a frame from
 * `Game` (`VehicleViews.draw`), after every write and immediately before
 * `scene.render`. No node of a hull is in the scene. The muzzles and the
 * sight are joints with no mesh, which nothing in the game reads: the
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
 *   join. The bloom reads `noGlow` every frame now (`GlowPass`), so a glowing
 *   part is possible — it is still a look nobody has chosen.
 * - **Nothing pickable.** No mesh of a hull is pickable, and nothing in the
 *   game picks one: what a hull is to a body and to a round is
 *   `Vehicle.rayBox`, off its own fields. A pickable visual would put the
 *   hitscan's wall ray, the bots' LOS and the ground probe on sixty triangles
 *   of track link.
 *
 * `segmentOf` enforces both by construction, which is why no model may build
 * a mesh any other way — a model hands it parts, never meshes.
 */
import { type Material, Matrix as BabylonMatrix, type Mesh, type Scene } from "@babylonjs/core";
import type { VehicleSpec } from "../config/vehicles";
import { createBox, createCylinder } from "../geometry/primitives";
import { Matrix, Quaternion, Vector3 } from "../math";
import { type CelMaterialFactory } from "../shaders/CelShader";
import { drawnMesh, mergeParts, Part } from "../world/parts";
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
 * it merges to, and a round wheel merges into the same mesh a square one did.
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
 * `Part` and not a mesh: nothing on a hull becomes a mesh before `segment`.
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
 * reason meshes were spent on the only parts of a vehicle that are not rigid.
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
 * One drawn mesh of a hull and the joint it hangs off — parented to NOTHING
 * since `BABYLON_EXIT.md` X4.2a: its world is `local` times its joint's,
 * composed by `drawHullRig` and handed to Babylon (`freezeWorldMatrix`).
 */
export interface HullMesh {
  readonly mesh: Mesh;
  readonly joint: Joint;
  /** The mesh's own transform in its joint's frame, composed once at build. */
  readonly local: Matrix;
  /** What Babylon is handed — the one object it keeps as the world matrix. */
  readonly drawn: BabylonMatrix;
}

/**
 * A built vehicle: the joints that move, the meshes that draw, the three
 * extents the physics needs off the drawing, and what to do to all of it when
 * the hull respawns or burns.
 */
export interface VehicleRig {
  /**
   * Every joint below, parents first: OUR hierarchy (`rigJoints.ts`), each
   * world a float32 matrix the rig owns. Babylon draws the meshes off them and
   * has no node of this rig (`BABYLON_EXIT.md` X4.2a).
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
  /** Every drawn mesh, for the repaint and for whoever needs the list. */
  meshes: Mesh[];
  /** What each of `meshes` was painted with when it was built. */
  livery: Material[];
  /** Each of `meshes`, in that order, with the joint it hangs off. See `HullMesh`. */
  drawn: readonly HullMesh[];
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
  /** The joints are `name` and `name-tip`, the meshes `name-lo` and `name-hi`. */
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
 * back at the start of its run, the masts straight and the paint back on. What
 * `VehicleRig.reset` is on every kind, given the kind's own spec for the one
 * number it needs (how the masts share a bend).
 *
 * `gun` is the only joint a kind may lack, which is why it is the only one
 * written through `?.`.
 */
export function resetRigPose(
  rig: VehicleRig,
  mats: CelMaterialFactory,
  spec: VehicleSpec,
): void {
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
  paintRig(rig.meshes, rig.livery, mats, false);
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
 * The lists a model draws into and the one function that turns parts into
 * meshes, handed back together so a builder holds one thing.
 *
 * Every model calls `segment` and none may build a mesh any other way: this
 * is where the per-colour merge, the pickability rule and the mesh/livery/
 * joint bookkeeping are enforced, and a mesh built past it is one that is
 * picked, unmerged, never repainted when the hull burns and never handed a
 * matrix.
 */
export interface Segments {
  meshes: Mesh[];
  livery: Material[];
  drawn: HullMesh[];
  /**
   * Builds a list of parts, merges them per colour, and hangs the result off
   * `parent` — which is to say files each mesh under that joint, the mesh
   * itself parented to nothing (`HullMesh`).
   *
   * The two lists are one segment: a cylinder in a colour the boxes beside it
   * already carry merges into their mesh and costs nothing, which is why a
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
}

export function segmentOf(scene: Scene, mats: CelMaterialFactory): Segments {
  const meshes: Mesh[] = [];
  const livery: Material[] = [];
  const drawn: HullMesh[] = [];
  const segment = (
    name: string,
    parent: Joint,
    boxes: Box[],
    cyls: Cyl[] = [],
    shapes: readonly Shape[] = [],
  ): void => {
    const parts: Part[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const [w, h, d, x, y, z, color, rotX = 0, rotY = 0] = boxes[i];
      const p = new Part(`${name}${i}`, createBox({ width: w, height: h, depth: d }));
      p.position.set(x, y, z);
      p.rotation.x = rotX;
      p.rotation.y = rotY;
      p.material = mats.get(color);
      parts.push(p);
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
      p.material = mats.get(color);
      parts.push(p);
    }
    for (const [p, color] of shapes) {
      p.material = mats.get(color);
      parts.push(p);
    }
    for (const merged of mergeByColor(scene, parts, name, shapes.length)) {
      // No mesh of a hull is pickable — what a hull is to a round is
      // `Vehicle.rayBox`. A pickable visual would put the hitscan's wall ray,
      // the bots' LOS and the ground probe on sixty triangles of track link.
      merged.isPickable = false;
      merged.checkCollisions = false;
      meshes.push(merged);
      livery.push(merged.material!);
      drawn.push({ mesh: merged, joint: parent, local: meshLocal(merged), drawn: new BabylonMatrix() });
    }
  };
  return { meshes, livery, drawn, segment };
}

/**
 * A mesh's own transform as `computeWorldMatrix` composed it before the
 * parent's: its scaling, its quaternion or else its Euler as yaw-pitch-roll,
 * and its position. Constant: nothing moves a hull's mesh in its joint's
 * frame (a lone part keeps its own frame on its mesh, `mergeByColor`).
 */
function meshLocal(mesh: Mesh): Matrix {
  const q = new Quaternion();
  const rq = mesh.rotationQuaternion;
  if (rq) q.copyFrom(rq);
  else Quaternion.RotationYawPitchRollToRef(mesh.rotation.y, mesh.rotation.x, mesh.rotation.z, q);
  const s = mesh.scaling;
  const d = mesh.scalingDeterminant;
  return Matrix.ComposeToRef(new Vector3(s.x * d, s.y * d, s.z * d), q, mesh.position, new Matrix());
}

// Scratch for `drawHullRig`.
const _meshWorld = new Matrix();

/**
 * Composes the rig's joints and hands Babylon every switched-on mesh's world
 * matrix off them — the mesh's own local times its joint's world, what
 * `computeWorldMatrix` made of a mesh hung off a node.
 *
 * **Called once a frame, after every write and before the render**
 * (`VehicleViews.draw`, from `Game` beside the bodies, inside the render
 * span: Babylon composed these inside `scene.render` before X4.2a).
 * `freezeWorldMatrix` is how a mesh with no parent is handed a matrix:
 * Babylon keeps the object it is given as the world matrix, updates its
 * bounds, and composes nothing of its own.
 */
export function drawHullRig(rig: VehicleRig): void {
  rig.tree.compute();
  for (const d of rig.drawn) {
    if (!d.mesh.isEnabled(false)) continue;
    d.local.multiplyToRef(d.joint.world, _meshWorld);
    BabylonMatrix.FromArrayToRef(_meshWorld.m, 0, d.drawn);
    d.mesh.freezeWorldMatrix(d.drawn);
  }
}

/**
 * The whole hull on or off — every mesh's own flag, which is what the body
 * box's switch reached through the parent chain before X4.2a. Nothing on a
 * hull is switched separately, so the rig has the one switch.
 */
export function setHullRigEnabled(rig: VehicleRig, on: boolean): void {
  for (const mesh of rig.meshes) mesh.setEnabled(on);
}

/**
 * Disposes the rig's meshes — the whole of what Babylon holds of it. The
 * meshes only: the paint is the factory's shared cache (`VehicleView.dispose`
 * says why that must never go with them).
 */
export function disposeHullRig(rig: VehicleRig): void {
  for (const mesh of rig.meshes) mesh.dispose(false, false);
}

/**
 * Merges a segment's parts into one mesh per colour, at identity, and hands
 * the meshes back in COLOUR order — the order a colour first appears among
 * the boxes, then the cylinders, then the shapes, which is the order
 * `VehicleRig.meshes` and `livery` are in.
 *
 * **A colour with ONE part is drawn as that part, transform and all**, rather
 * than merged into a mesh at identity: a merge of one is a copy, and the part
 * keeps its own frame on the mesh exactly as the lone mesh `MergeMeshes` was
 * never asked about kept its own.
 *
 * **The meshes are MADE in the order the scene used to receive them**, which
 * is not the colour order. When the parts were meshes, a shape was built
 * before its segment was called and a box or a cylinder inside it, so a lone
 * part's mesh stood in the scene at its PART's moment — shapes first, then
 * boxes, then cylinders — and every merge was minted after all of them. So the
 * lone colours are drawn first, in that order, and the merged ones after, in
 * colour order; `kit:hash --models` hashes scene order, and a reordered scene
 * is a reordered draw list.
 */
function mergeByColor(
  scene: Scene,
  parts: readonly Part[],
  name: string,
  shapeCount: number,
): Mesh[] {
  const groups = new Map<unknown, Part[]>();
  for (const p of parts) {
    const key = p.material;
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }
  const list = [...groups.values()];
  // Where each part's mesh used to be made: the shapes (the last
  // `shapeCount` parts) before the boxes and cylinders, which keep their order.
  const made = (p: Part): number => {
    const i = parts.indexOf(p);
    const first = parts.length - shapeCount;
    return i >= first ? i - first : shapeCount + i;
  };
  const when = list.map((g, k) => (g.length === 1 ? made(g[0]) : parts.length + k));
  const order = list.map((_, k) => k).sort((a, b) => when[a] - when[b]);
  const out: Mesh[] = new Array(list.length);
  for (const k of order) {
    const group = list[k];
    const mat = group[0].material;
    const merged =
      group.length === 1
        ? drawnMesh(group[0], scene)
        : drawnMesh(name, mergeParts(group), scene);
    merged.name = name;
    merged.material = mat;
    out[k] = merged;
  }
  return out;
}

/** Swaps the whole vehicle to the charred palette, or back to its livery. */
export function paintRig(
  meshes: readonly Mesh[],
  livery: readonly Material[],
  mats: CelMaterialFactory,
  wrecked: boolean,
): void {
  const charred = wrecked ? mats.get(CHARRED) : null;
  for (let i = 0; i < meshes.length; i++) {
    meshes[i].material = charred ?? livery[i];
  }
}
