/**
 * hullFrame.ts — Where a hull's guns and its sight ARE, as numbers: the offsets
 * of every joint on the path from the collider box to a muzzle, the three
 * extents the drive reads off the drawing, and the replay of that node chain.
 * Owns: `HullFrame` (one per kind, stated by its frame file), `HullPose` (the
 * channels those joints hold, written by `Vehicle` and `HullSprings` behind
 * the guards the node writes had, and copied onto the nodes by the client's
 * `VehicleView`), `hullPointToRef`, and `hullBodyToRef` — the collider box's
 * own frame, which the shadow maps draw a hull as (`core/proxyBoxes.ts`).
 * Invariants:
 * - **No `@babylonjs/core`.** `src/math` only, so the simulation can ask where
 *   a hull's barrel is without a rig and the authority without a scene.
 * - **`hullPointToRef` is the node chain, bit for bit.** It replays what
 *   Babylon's `TransformNode.computeWorldMatrix(true)` did down body → root →
 *   hull → sprung → turret → gun → muzzle (or → mgMount → mgGun → mgMuzzle /
 *   mgSight) — per node, `Quaternion.RotationYawPitchRoll` of its Euler
 *   (`rotation.y, .x, .z`), `Matrix.ComposeToRef` with unit scale into a
 *   float32 matrix, then `local.multiplyToRef(parentWorld)` — with
 *   `src/math`'s copies of those classes. A float64 trig version of the same
 *   geometry is a different number and moves the fight hash.
 * - **A `HullPose` is what the NODES hold, not what the springs want.** The
 *   lean, the heave and the suspension's tilt were written to their nodes
 *   behind a 1e-5 guard, so a drawn joint trails its spring by up to that
 *   much — and the muzzle was always read off the drawn joint. So the record
 *   keeps the guards, and it is the record that is written and the view
 *   that copies it: the node is what the record
 *   says, never the other way round.
 * - **A frame is the DRAWING's**: each kind states its own in a Babylon-free
 *   frame file (`TANK_FRAME` in `tankFrame.ts`, `TRUCK_FRAME`, `HELI_FRAME`),
 *   and its model IMPORTS those numbers and places its nodes FROM them, so the
 *   arithmetic and the picture cannot drift. No node on the path has a pivot,
 *   a billboard, a quaternion or a scale; the channels no pose writes are the
 *   zeros the builders leave.
 * Never: allocates (a muzzle is read per shot and the marker per frame), holds
 * state beyond its own scratch, or reads a node.
 */
import { Matrix, Quaternion, Vector3, type Vector3Ref } from "../math";

/** A joint's translation in its parent's frame. */
export type Point3 = readonly [number, number, number];

/**
 * One kind's joints, as offsets, and the three extents the drive needs off the
 * drawing.
 *
 * The three extents are DRAWING decisions the physics cannot do without —
 * `gauge` (a hull turning at `w` runs its outer side `w * gauge / 2` faster
 * than its inner one), `contactReach` (where the belt or the wheelbase stops
 * touching the ground, which is where the ten contacts are laid) and
 * `wheelReach` (the outermost SUSPENSION station, which bounds the body's
 * travel and is not the same place). They used to ride on the rig; they are
 * here so the simulation holds numbers rather than a mesh.
 */
export interface HullFrame {
  readonly gauge: number;
  readonly contactReach: number;
  readonly wheelReach: number;
  /** The turret ring on `sprung`. Inert (and at the origin) on a gunless kind. */
  readonly turretAt: Point3;
  /** The main gun's trunnion on the turret and its muzzle on the gun — null with `spec.gun`. */
  readonly gun: { readonly at: Point3; readonly muzzleAt: Point3 } | null;
  /** The cupola gun's mount on the turret, its gun on the mount, and the two points on the gun. */
  readonly mgMountAt: Point3;
  readonly mgGunAt: Point3;
  readonly mgMuzzleAt: Point3;
  readonly mgSightAt: Point3;
}

/**
 * The channels the moving joints on a muzzle's path hold, by node — the drawn
 * values, which is what a muzzle is read off (see the header).
 */
export interface HullPose {
  /** `rig.hull.rotation.x` / `.z`: the ground lean, as last drawn. */
  hullX: number;
  hullZ: number;
  /** `rig.sprung.rotation.x` / `.z` and `position.y`: the springs, as last drawn. */
  sprungX: number;
  sprungZ: number;
  sprungY: number;
  /** `rig.turret.rotation.y`: the turret's LOCAL yaw. */
  turretY: number;
  /** `rig.gun.rotation.x`: the NEGATIVE of the gun's elevation. */
  gunX: number;
  /** `rig.mgMount.rotation.y` and `rig.mgGun.rotation.x`, the cupola gun's two. */
  mgMountY: number;
  mgGunX: number;
}

/** A fresh hull's pose, which is a rig fresh out of `resetRigPose`. */
export function newHullPose(): HullPose {
  return {
    hullX: 0,
    hullZ: 0,
    sprungX: 0,
    sprungZ: 0,
    sprungY: 0,
    turretY: 0,
    gunX: 0,
    mgMountY: 0,
    mgGunX: 0,
  };
}

/** Back to `newHullPose`'s zeros, in place — `resetRigPose`'s twin. */
export function zeroHullPose(p: HullPose): void {
  p.hullX = 0;
  p.hullZ = 0;
  p.sprungX = 0;
  p.sprungZ = 0;
  p.sprungY = 0;
  p.turretY = 0;
  p.gunX = 0;
  p.mgMountY = 0;
  p.mgGunX = 0;
}

/** Which end of the chain `hullPointToRef` walks to. */
export const HULL_MUZZLE = 0;
export const HULL_MG_MUZZLE = 1;
export const HULL_MG_SIGHT = 2;
export type HullPoint = typeof HULL_MUZZLE | typeof HULL_MG_MUZZLE | typeof HULL_MG_SIGHT;

// Scratch for the replay. One matrix per link, so no product is ever written
// into one of its own operands.
const ONE = new Vector3(1, 1, 1);
const _q = new Quaternion();
const _at = new Vector3();
const _local = new Matrix();
const _body = new Matrix();
const _root = new Matrix();
const _hull = new Matrix();
const _sprung = new Matrix();
const _turret = new Matrix();
const _gun = new Matrix();
const _mount = new Matrix();
const _mgGun = new Matrix();
const _end = new Matrix();

/** One link: `local(euler, at) * parent` into `world`, Babylon's order. */
function link(
  yaw: number,
  pitch: number,
  roll: number,
  x: number,
  y: number,
  z: number,
  parent: Matrix,
  world: Matrix,
): void {
  Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, _q);
  Matrix.ComposeToRef(ONE, _q, _at.copyFromFloats(x, y, z), _local);
  _local.multiplyToRef(parent, world);
}

/**
 * The collider box's frame — the box stands at `(x, y, z)`, its centre,
 * turned `yaw` — into `out`, as the body node a view hangs its rig off
 * composed it (`TransformNode.computeWorldMatrix`, unit scale, no parent):
 * the first link of `hullPointToRef`'s chain, and what a shadow map draws a
 * hull's box off (`core/proxyBoxes.ts`, `BABYLON_EXIT.md` X4.1c), so neither
 * reads the mesh.
 */
export function hullBodyToRef(x: number, y: number, z: number, yaw: number, out: Matrix): Matrix {
  Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, _q);
  Matrix.ComposeToRef(ONE, _q, _at.copyFromFloats(x, y, z), out);
  return out;
}

/**
 * A point on a hull in world space: the main gun's muzzle (the turret ring on a
 * kind with no gun), the cupola gun's muzzle, or the gunner's sight.
 *
 * The box stands at `(x, y, z)` turned `yaw` — the collider's centre, which is
 * what the body mesh the rig hangs off was placed at — and the rig's root hangs
 * `drop` below it (`-hull.height / 2`). It is what
 * `node.computeWorldMatrix(true)` followed by `getAbsolutePosition()` returned
 * off the rig: that call forces every ancestor (`parent.computeWorldMatrix(force)`
 * inside Babylon's), so it was always the FRESH chain off the nodes' current
 * values on both sides — never a cached parent — and the answer is the float32
 * translation row.
 */
export function hullPointToRef<T extends Vector3Ref>(
  frame: HullFrame,
  x: number,
  y: number,
  z: number,
  yaw: number,
  drop: number,
  pose: Readonly<HullPose>,
  point: HullPoint,
  out: T,
): T {
  hullBodyToRef(x, y, z, yaw, _body);
  link(0, 0, 0, 0, drop, 0, _body, _root);
  link(0, pose.hullX, pose.hullZ, 0, 0, 0, _root, _hull);
  link(0, pose.sprungX, pose.sprungZ, 0, pose.sprungY, 0, _hull, _sprung);
  const t = frame.turretAt;
  link(pose.turretY, 0, 0, t[0], t[1], t[2], _sprung, _turret);
  let m = _turret;
  if (point === HULL_MUZZLE) {
    const g = frame.gun;
    if (g) {
      link(0, pose.gunX, 0, g.at[0], g.at[1], g.at[2], _turret, _gun);
      const e = g.muzzleAt;
      link(0, 0, 0, e[0], e[1], e[2], _gun, _end);
      m = _end;
    }
  } else {
    const a = frame.mgMountAt;
    link(pose.mgMountY, 0, 0, a[0], a[1], a[2], _turret, _mount);
    const b = frame.mgGunAt;
    link(0, pose.mgGunX, 0, b[0], b[1], b[2], _mount, _mgGun);
    const e = point === HULL_MG_MUZZLE ? frame.mgMuzzleAt : frame.mgSightAt;
    link(0, 0, 0, e[0], e[1], e[2], _mgGun, _end);
    m = _end;
  }
  const r = m.m;
  out.set(r[12], r[13], r[14]);
  return out;
}
