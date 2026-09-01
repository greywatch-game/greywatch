/**
 * MineModel.ts — What an anti-tank mine looks like, in the hands and on the
 * ground.
 * Returns `WeaponParts` exactly as the six guns do, so `ViewModel` carries it
 * with nothing re-tuned, plus `buildMineBody` for the one `AntiTankSystem`
 * lays.
 * Invariants: the carried mine is assembled at the origin with the root at
 * identity and merged before it is moved — `weaponKit.ts` owns that contract
 * and the primitives. The laid mine is DRESSING: no `solid` flag, no
 * `WorldBox`, not pickable. A tank drives THROUGH it and the trigger is a
 * distance test, never a collision.
 *
 * Two builders in one file for the reason `RpgModel` is one: the plate a
 * player is holding and the plate lying in the road are the same object, and
 * the tell that says a laid one is ARMED is the same lamp that is dark in the
 * hands.
 *
 * **It is the one thing in the kit that is not a weapon at all**, and every
 * odd thing about this file follows from that. There is no muzzle, nothing is
 * ejected, and the "sight" is a point above the plate that exists only
 * because `applyFit` derives an aimed pose from one — aiming a mine brings it
 * closer to the eye and does nothing else, which is exactly what looking hard
 * at a thing in your hands does.
 */
import { Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { type CelMaterialFactory } from "../shaders/CelShader";
import {
  BODY,
  METAL,
  POLYMER,
  RUBBER,
  WeaponBuild,
  type SightAssembly,
  type WeaponParts,
} from "./weaponKit";

/** The plate's outside diameter, in weapon units (~1.4 per metre). */
const PLATE_DIA = 0.42;

/** Where each hand grips: both under the plate, thumbs on the rim. */
const GRIP_HAND = new Vector3(0.13, -0.13, -0.05);
const GRIP_ELBOW = new Vector3(0.34, -0.5, -0.34);
const SUPPORT_HAND = new Vector3(-0.13, -0.13, -0.05);
const SUPPORT_ELBOW = new Vector3(-0.34, -0.5, -0.34);

/**
 * Builds the carried mine: a shallow steel plate held flat in both hands, with
 * a pressure plate on top and a fuze well in the middle of it.
 *
 * Local +z is still "forward" and the plate lies FLAT in that frame — face up,
 * pointing away from the player — because that is how you carry one and
 * because it is what makes the shape read at all. Stood on its edge like a
 * weapon it is a disc seen end-on, which is a bar.
 *
 * ~40 parts, merged to one mesh per colour like every other model here.
 */
export function buildMine(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_mine`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // The plate itself, lying flat: a squat cylinder standing on its own axis,
  // so it is built with `pin` on the Y axis rather than with `tube`.
  b.pin("body", BODY, PLATE_DIA, 0.075, 0, -0.07, 0, "y");
  b.pin("rim", METAL, PLATE_DIA + 0.02, 0.022, 0, -0.098, 0, "y");
  // The pressure plate, proud of the body, and the ring of bolts around it.
  b.pin("pressure", POLYMER, PLATE_DIA * 0.68, 0.03, 0, -0.02, 0, "y");
  b.pin("fuze", METAL, PLATE_DIA * 0.24, 0.036, 0, 0.002, 0, "y");
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box(
      "bolt",
      METAL,
      0.026,
      0.014,
      0.026,
      Math.sin(a) * PLATE_DIA * 0.42,
      -0.03,
      Math.cos(a) * PLATE_DIA * 0.42,
    );
  }
  // The carrying handle, a strap across the underside, and the two lugs it is
  // slung from. This is what the hands are actually holding.
  b.box("handle", RUBBER, 0.3, 0.02, 0.05, 0, -0.128, 0);
  for (const side of [-1, 1] as const) {
    b.box("lug", METAL, 0.03, 0.036, 0.05, side * 0.15, -0.115, 0);
  }
  // The arming key, standing off the rim where a thumb reaches it.
  b.box("keyBody", METAL, 0.05, 0.03, 0.03, 0, -0.05, -PLATE_DIA / 2);
  b.box("keyLever", RUBBER, 0.016, 0.026, 0.05, 0, -0.05, -PLATE_DIA / 2 - 0.03);

  b.merge("mine", root);
  const finish = b.takeFinish();

  const sight = buildMineTell(b, root, prefix);
  b.disposePivots();

  return {
    root,
    // Nothing leaves this weapon, so both landmarks are the fuze — anything
    // that reads one gets a point on the object rather than a point in space.
    muzzle: new Vector3(0, 0.02, 0),
    ejectPort: new Vector3(0, 0.02, 0),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    sights: { kind: "fixed", sight: "iron", assembly: sight },
    finish,
    meshes: root.getChildMeshes(false) as Mesh[],
  };
}

/**
 * The fuze lamp on the carried mine, and the point ADS puts on the camera
 * axis.
 *
 * A `SightAssembly` because that is the shape `WeaponParts` takes and the
 * shape `applyFit` derives an aimed pose from — but there is nothing to look
 * through, so the "sight centre" is simply a hand's breadth above the fuze.
 * What aiming a mine does is hold it up in front of your face, and that is
 * both the honest animation and exactly what falls out of the derivation.
 */
function buildMineTell(
  b: WeaponBuild,
  parent: TransformNode,
  prefix: string,
): SightAssembly {
  const node = new TransformNode(`${prefix}_mine_tell`, b.scene);
  node.parent = parent;

  const lamp = b.lit(
    MeshBuilder.CreateSphere(
      `${prefix}_mineLamp`,
      { diameter: 0.03, segments: 6 },
      b.scene,
    ),
    node,
  );
  // Proud of the fuze's own ink shell, the rule every lit part in the kit
  // follows.
  lamp.position.set(0, 0.028, 0);

  const sightCenter = new TransformNode(`${prefix}_mine_sightCenter`, b.scene);
  sightCenter.parent = node;
  sightCenter.position = new Vector3(0, 0.14, 0.02);
  return { root: node, sightCenter, meshes: node.getChildMeshes(true) as Mesh[] };
}

/** One laid mine's meshes. The lamp is parented to the body and moves with it. */
export interface MineMeshes {
  mesh: Mesh;
  lamp: Mesh;
}

/**
 * Builds one laid mine, hidden, at WORLD scale — everything above this
 * function is in the viewmodel's units and none of those numbers may be
 * carried down here.
 *
 * A third of a metre across and eight centimetres proud of the road, which is
 * what a real one is and small enough that the thing a driver has to spot is
 * the LAMP. That lamp is the whole of the warning a mine gives, the way the
 * pip is the whole of the warning a grenade gives, and it is off for
 * `armTime` after the mine goes down and lit for the rest of its life — so a
 * mine you can see is a mine that is live, and one still winking out is one
 * you could still drive over.
 *
 * A mine is dressing with a fuze on it: no `solid` flag, no `WorldBox`, not
 * pickable. A tank drives THROUGH the mesh, and what sets it off is
 * `AntiTankSystem`'s distance test against the hull's centre.
 */
export function buildMineBody(
  scene: Scene,
  mats: CelMaterialFactory,
  name: string,
): MineMeshes {
  // Nothing here is derived from `CONFIG.equipment.mine`: the trigger radius
  // is four metres of ground a hull has to be over, and a plate drawn that
  // size would be a manhole cover. What the mine LOOKS like is a mine.
  const mesh = MeshBuilder.CreateCylinder(
    name,
    { height: 0.08, diameter: 0.34, tessellation: 10 },
    scene,
  );
  mesh.material = mats.get("#3a3f34");
  mesh.isPickable = false;

  const plate = MeshBuilder.CreateCylinder(
    `${name}Plate`,
    { height: 0.04, diameter: 0.22, tessellation: 10 },
    scene,
  );
  plate.parent = mesh;
  plate.position.y = 0.055;
  plate.material = mats.get("#22261f");
  plate.isPickable = false;

  const lamp = MeshBuilder.CreateSphere(
    `${name}Lamp`,
    { diameter: 0.07, segments: 6 },
    scene,
  );
  lamp.parent = mesh;
  // Standing proud of the plate's ink shell — the grenade pip's rule, and for
  // the same reason: it is the only warning the thing gives.
  lamp.position.y = 0.095;
  lamp.material = mats.getEmissive("#ff4a3a");
  lamp.metadata = { noInk: true };
  lamp.isPickable = false;
  // The lamp is toggled INSIDE an enabled mine — dark while it arms, lit once
  // it is live — so it keeps its own `isVisible` on top of the subtree switch
  // below.
  lamp.isVisible = false;

  // Ink, or a dark plate on a dark road is invisible from the one direction it
  // matters from — which for the object a driver is meant to notice in time is
  // the whole ball game.
  // Disabled rather than invisible, for the reason `buildRocket` gives at
  // length: `isVisible` does not reach a child, and a pool of sixteen hidden
  // mines would leave sixteen pressure plates lying at the world origin.
  mesh.setEnabled(false);
  return { mesh, lamp };
}
