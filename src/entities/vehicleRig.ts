/**
 * vehicleRig.ts — What every vehicle's MESH is, whatever kind it is, and the
 * two helpers both models are drawn with.
 * Owns: the `VehicleRig` contract — the joints `Vehicle` writes and the three
 * closures it calls — plus `Box`/`Cyl`, the per-colour merge and the outline
 * pass every model owes.
 * Owns NO geometry and no numbers. `TankModel.ts` and `TruckModel.ts` are the
 * ART, one file per kind; this is the shape they both come out in, and the one
 * thing `entities/Vehicle.ts` has ever heard of.
 *
 * ## The rig is CLOSED over its own model, which is what buys the second kind
 *
 * A tank's running gear is two belts of scrolling links and a truck's is four
 * wheels that turn and two that steer, and no interface over both of those is
 * anything but a lie in one direction. So the rig does not DESCRIBE its running
 * gear at all — it carries `setRun`, a closure its own builder made, and
 * `Vehicle` hands it the two figures it has (how far each side has covered, and
 * how hard the stick is over) without ever learning which of the two it is
 * driving. `reset` and `paint` are the same bargain for the respawn and the
 * wreck.
 *
 * That is why there is no `kind` field here and no branch in `Vehicle`: what a
 * vehicle IS lives in `config/vehicles.ts` as a `VehicleSpec` and in a model
 * file as this, and the pair are married once in `entities/vehicleKinds.ts`.
 *
 * ## What a rig must state, because `Vehicle` cannot see the geometry
 *
 * Three numbers, and all three are DRAWING decisions the physics cannot do
 * without: `gauge` (a hull turning at `w` runs its outer side `w * gauge / 2`
 * faster than its inner one, which is what makes a track run backwards in a
 * pivot), `contactReach` (how far fore and aft the ground contacts are laid,
 * which is where the belt or the wheelbase actually touches) and `wheelReach`
 * (where the outermost SUSPENSION station is, which is not the same place and
 * is what bounds the body's travel). Stating them here rather than exporting
 * three constants per model is what stopped `Vehicle` importing from a model
 * file at all.
 *
 * ## Two rules every model owes, both inherited and both already broken once
 *
 * - **Nothing emissive.** `Game`'s GlowLayer scan is construction-time and a
 *   hull is built per round, so a bloom-eligible material on one is never
 *   excluded by the `noGlow` contract and glows for the rest of the round.
 * - **Nothing pickable.** The collider box is the only pickable thing a vehicle
 *   has — see `Vehicle`. A pickable visual would put the hitscan's wall ray,
 *   the bots' LOS and the ground probe on sixty triangles of track link.
 *
 * `segmentOf` enforces both by construction, which is why neither model may
 * build a mesh any other way.
 */
import {
  type Material,
  Mesh,
  MeshBuilder,
  Scene,
  TransformNode,
} from "@babylonjs/core";
import { type CelMaterialFactory } from "../shaders/CelShader";

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
 * What a destroyed hull is repainted in. One colour for the whole vehicle —
 * a wreck has no team, which is the point of it not keeping its accent: the
 * thing standing in the street after the fire is cover, and cover belongs to
 * whoever is behind it.
 *
 * Shared by both models rather than stated twice, because a burnt-out truck and
 * a burnt-out tank are the same object to everybody who walks past one.
 */
export const CHARRED = "#221f1c";

/**
 * One whip antenna, drawn as two links because a rigid rod cannot bow.
 *
 * The lower link turns at the mast foot and the upper hangs off its top, so the
 * pair describe a CURVE rather than a lever — which is the whole read, and the
 * reason meshes were spent on the only parts of a vehicle that are not rigid.
 * `Vehicle` owns how far each is bent and `setAntennaBend` is what that looks
 * like, exactly the split `trackRun`/`setRun` has.
 */
export interface Whip {
  /** Turns at the mast foot. Takes `antenna.baseShare` of the bend. */
  base: TransformNode;
  /** Hangs off the base's top and finishes the bow, LAGGING behind it. */
  tip: TransformNode;
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
 * A built vehicle: the nodes that move, the meshes that draw, the three
 * extents the physics needs off the drawing, and what to do to all of it when
 * the hull respawns or burns.
 */
export interface VehicleRig {
  /** Positioned and yawed by `Vehicle`. Nothing else may write it. */
  root: TransformNode;
  /**
   * The lean onto the GROUND, and nothing else. Separate from `root` because
   * the pitch and roll are a picture and the yaw is a rule: the collider box
   * never tilts, so anything reading the hull's heading reads `root` and gets
   * an angle that has no suspension in it.
   *
   * The RUNNING GEAR hangs off this and not off `sprung`: a track (or a tyre)
   * lies on the ground its contacts found, and the body is what moves against
   * it. **That is why the SUSPENSION's lean is not written here** — a
   * weight-transfer pitch on this node rotates the running gear with it and
   * drives one end of the vehicle under the road. See `sprung`.
   */
  hull: TransformNode;
  /**
   * The sprung mass — everything the springs carry, and therefore everything
   * the springs may move: `Vehicle.flexHeave` writes its Y and
   * `Vehicle.flexSuspension` writes its pitch and roll, all three in the frame
   * of the `hull` node it hangs off, so a compressing body compresses along its
   * OWN up axis rather than the world's.
   *
   * Splitting it off the running gear is the whole of what makes the travel
   * visible: a body that took its wheels down with it would drive them through
   * the road on every landing and bury its nose on every stop.
   */
  sprung: TransformNode;
  /**
   * Traverses. Local yaw, relative to the hull.
   *
   * **On a vehicle with no main gun this node never moves**, and that is a
   * consequence rather than a special case: `Vehicle` keeps `turretYaw` equal
   * to the hull's own yaw on a gunless hull, so the difference written here is
   * always zero and the machine gun bolted above it is left riding a fixed
   * ring on the body. See `Vehicle.armed`.
   */
  turret: TransformNode;
  /**
   * Elevates. Local pitch, relative to the turret — and **null on a vehicle
   * that has no main gun**, which is the one place in the rig where a kind is
   * visible at all.
   *
   * Nullable rather than a dummy node, because a dummy is a thing the next
   * reader has to discover is never used: every caller of `gunDirToRef`,
   * `muzzleToRef` and `fireGun` is already behind `Vehicle.armed`, and the
   * type is what says so.
   */
  gun: TransformNode | null;
  /** The barrel's tip: where a shell leaves and where its flash is lit. Null with `gun`. */
  muzzle: TransformNode | null;
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
  mgMount: TransformNode;
  mgGun: TransformNode;
  /** Where a machine-gun round leaves, and where its flash is lit. */
  mgMuzzle: TransformNode;
  /** The masts, longest first — the order `rate` is measured against. May be empty. */
  antennae: readonly Whip[];
  /** Every drawn mesh, for the repaint and for whoever needs the list. */
  meshes: Mesh[];
  /** What each of `meshes` was painted with when it was built. */
  livery: Material[];
  /**
   * The distance between the two sides' ground contacts.
   *
   * `Vehicle` splits one hull speed into two side speeds and cannot do it
   * without this — a hull turning at `w` rad/s runs its outer side
   * `w * gauge / 2` faster than its inner one.
   */
  gauge: number;
  /**
   * How far fore and aft of the hull's centre the ground contacts reach —
   * where the belt or the wheelbase stops touching anything.
   *
   * Not the collider's own half-length: on a tank the sprocket and the idler
   * stand 0.6 m inside the box, and sampling past them is a hull rearing up on
   * a kerb its tracks have not reached yet.
   */
  contactReach: number;
  /**
   * …and how far out the outermost SUSPENSION station is, which is a different
   * place and bounds a different thing.
   *
   * The body's travel is stopped at the wheel STATIONS rather than at the ends
   * of the running gear, because a bump stop is something a wheel arm reaches
   * and an idler has no arm at all.
   */
  wheelReach: number;
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
 * already contributed, because these are nested nodes and a child's rotation is
 * relative to its parent's. That subtraction is the whole trick: `Vehicle` hands
 * in a tip angle that LAGS the base's, so while the whip is moving the leftover
 * is negative and the upper link bends back against the lower one into an S,
 * and when it settles the two agree and it reads as one smooth bow.
 *
 * Both angles are small and Babylon composes euler rotations in YXZ, so the two
 * axes cross-couple slightly at the extremes. That is a picture on a picture:
 * nothing aims, walks or is picked against a mast.
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
 * The two lists a model draws into and the one function that turns parts into
 * meshes, handed back together so a builder holds one thing.
 *
 * Both models call `segment` and neither may build a mesh any other way: this
 * is where the per-colour merge, the pickability rule and the mesh/livery
 * bookkeeping are enforced, and a part built past it is a part that is picked,
 * unmerged and never repainted when the hull burns.
 */
export interface Segments {
  meshes: Mesh[];
  livery: Material[];
  /**
   * Builds a list of parts, merges them per colour, and parents the result.
   *
   * The two lists are one segment: a cylinder in a colour the boxes beside it
   * already carry merges into their mesh and costs nothing, which is why a
   * wheel's hub caps sit in the wheel segment and a barrel sits with the
   * mantlet.
   */
  segment(
    name: string,
    parent: TransformNode,
    boxes: Box[],
    cyls?: Cyl[],
  ): void;
}

export function segmentOf(scene: Scene, mats: CelMaterialFactory): Segments {
  const meshes: Mesh[] = [];
  const livery: Material[] = [];
  const segment = (
    name: string,
    parent: TransformNode,
    boxes: Box[],
    cyls: Cyl[] = [],
  ): void => {
    const parts: Mesh[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const [w, h, d, x, y, z, color, rotX = 0, rotY = 0] = boxes[i];
      const m = MeshBuilder.CreateBox(
        `${name}${i}`,
        { width: w, height: h, depth: d },
        scene,
      );
      m.position.set(x, y, z);
      m.rotation.x = rotX;
      m.rotation.y = rotY;
      m.material = mats.get(color);
      parts.push(m);
    }
    for (let i = 0; i < cyls.length; i++) {
      const [dia, len, x, y, z, color, axis, diaTop = dia] = cyls[i];
      // Facet count by SIZE, so a hub cap is not paying for a road wheel's
      // silhouette. The cel shader flat-shades from screen-space derivatives,
      // so what a facet costs is an edge the light bands break on — and at
      // 20 cm there is no such edge to see.
      const m = MeshBuilder.CreateCylinder(
        `${name}c${i}`,
        {
          height: len,
          diameterTop: diaTop,
          diameterBottom: dia,
          tessellation: dia >= 0.5 ? 12 : 8,
        },
        scene,
      );
      // Babylon builds a cylinder along +Y; these two put it along the axis
      // asked for. Same convention as `weaponKit`'s tube/pin.
      if (axis === "x") m.rotation.z = Math.PI / 2;
      else if (axis === "z") m.rotation.x = Math.PI / 2;
      m.position.set(x, y, z);
      m.material = mats.get(color);
      parts.push(m);
    }
    for (const merged of mergeByColor(parts, name)) {
      merged.parent = parent;
      // The collider box is the only pickable thing a vehicle has — see
      // `Vehicle`. A pickable visual would put the hitscan's wall ray, the
      // bots' LOS and the ground probe on sixty triangles of track link.
      merged.isPickable = false;
      merged.checkCollisions = false;
      meshes.push(merged);
      livery.push(merged.material!);
    }
  };
  return { meshes, livery, segment };
}

/** Merges a segment's parts into one mesh per colour, at identity. */
function mergeByColor(parts: Mesh[], name: string): Mesh[] {
  const groups = new Map<unknown, Mesh[]>();
  for (const m of parts) {
    const key = m.material;
    const g = groups.get(key);
    if (g) g.push(m);
    else groups.set(key, [m]);
  }
  const out: Mesh[] = [];
  for (const group of groups.values()) {
    const mat = group[0].material;
    const merged =
      group.length === 1
        ? group[0]
        : Mesh.MergeMeshes(group, true, true, undefined, false, false);
    if (!merged) continue;
    merged.name = name;
    merged.material = mat;
    out.push(merged as Mesh);
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
