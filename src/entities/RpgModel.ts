/**
 * RpgModel.ts — What the rocket launcher looks like, at both ends of a shot:
 * the tube on the player's shoulder and the rocket that leaves it.
 * Returns `WeaponParts` exactly as the six guns do, so `ViewModel` carries it
 * with nothing re-tuned, plus `buildRocket` for the body `AntiTankSystem`
 * flies.
 * Invariants: the launcher is assembled at the origin with the root at
 * identity and merged before it is moved — `weaponKit.ts` owns that contract
 * and the primitives. The rocket is DRESSING: no `solid` flag, no `WorldBox`,
 * not pickable, exactly as a grenade is.
 *
 * Two builders in one file for the reason `GrenadeModel` is one file: what a
 * rocket looks like and what threw it are the same object seen twice, and the
 * warhead standing in the tube has to be the warhead that flies out of it.
 * The launcher's is at weapon scale (~1.4 units per metre, the kit's) and the
 * rocket's is at WORLD scale, which is the one thing that must not be copied
 * between them.
 *
 * It is the second weapon in the game with no rail — `WeaponSights`' `fixed`
 * shape, the sidearm's case — and its sight is offset to the LEFT rather than
 * standing over the bore, which is what an RPG's optic actually does and what
 * puts the tube down the right-hand side of an aimed picture instead of
 * through the middle of it. `applyFit` cancels the whole offset, so the
 * reticle is still the point of impact: the derivation never cared which way
 * the sight sat, only where its centre is.
 */
import { Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { type CelMaterialFactory } from "../shaders/CelShader";
import { eyeDistance, PRISM_CONE, PRISM_WALL } from "./optics";
import {
  BODY,
  FACETS,
  METAL,
  POLYMER,
  RUBBER,
  WeaponBuild,
  type SightAssembly,
  type WeaponParts,
} from "./weaponKit";

/** Outside of the launch tube. Everything else on the weapon hangs off it. */
const TUBE_BORE = 0.105;

/**
 * Where the loaded round turns about — the seam between the skirt and the head,
 * which is both where the round balances and where a hand actually holds one.
 * See the `setPivotPoint` call in `buildRpg` for why it has to be said at all.
 */
const ROUND_PIVOT_Z = 0.95;

/**
 * **The origin is at the VENTURI, not at the middle of the weapon**, and that
 * is the one thing about this model that is a framing decision rather than a
 * shape.
 *
 * Every other weapon in the kit is built around its receiver, because a
 * receiver is roughly where a rifle balances and the hip pose puts the origin
 * a comfortable distance from the eye. A launcher is fired off the SHOULDER,
 * so its balance point is behind the shooter's head — built the same way, the
 * bell ends up half a metre from the lens filling a third of the frame, and
 * the warhead, which is the whole silhouette, is off the right edge. Built
 * from the rear the tube recedes exactly as a rifle's barrel does.
 *
 * **The other half of that decision is `equipment.rpg.carry.hipZ`, and one
 * without the other is the bug it was**: the origin being the venturi only
 * pays if the carry then puts the venturi where a shoulder is, which is
 * BEHIND the lens. Left at the shared stand-off the weapon pivots half a
 * metre in front of the chest and every part of it is in frame at once — a
 * plank held level in two hands rather than a tube being shouldered.
 */

/**
 * The optic's line of sight, weapon-local. Left of the bore and above it: the
 * PGO-7's mount stands off the tube's left side so the gunner's head is clear
 * of the backblast path, which is also why nothing on this weapon sits behind
 * the shoulder except the venturi.
 */
const SIGHT_X = -0.1;
const SIGHT_Y = 0.075;
const SIGHT_Z = 0.38;

/**
 * The optic is a HOLLOW TUBE and every radius on it is solved rather than
 * authored — `optics.ts` gives the prism the same construction, for the same
 * reason and off the same two numbers.
 *
 * An optic is only ever looked THROUGH, so the one thing it owes is a clear
 * bore around the cone from the eye. Built as a stack of solid boxes it is a
 * wall: the eye sits on this axis at `SIGHT_Z - eyeDistance("prism")`, which
 * put the whole aimed picture inside a 5 cm block — measured, 0 rays clear of
 * 313 across the sight picture. So each section carries the bore its own FAR
 * rim needs and the housing circumscribes the cone.
 *
 * `PRISM_CONE` is borrowed exactly as `CONFIG.sights.prism` already is: this
 * weapon looks through the prism's eye relief at the prism's magnification, so
 * anything but the prism's cone would be a different picture through the same
 * glass. What is NOT borrowed is where the eye reference sits — the prism puts
 * it on its ocular rim, and this one keeps it at the body's centre, which is
 * what holds a launcher's optic to something slimmer than its own launch tube:
 * the cone spreads with distance from the eye, so a sight carried further out
 * in front of it needs a wider bore for the same view.
 */
const OPTIC_OCULAR_DZ = -0.09;
const OPTIC_OBJECTIVE_DZ = 0.07;
const OPTIC_SECTIONS = 3;
const OPTIC_SEG = (OPTIC_OBJECTIVE_DZ - OPTIC_OCULAR_DZ) / OPTIC_SECTIONS;

/** The clear bore a section ending `dz` from the sight centre must carry. */
const opticBore = (dz: number): number => 2 * PRISM_CONE * (eyeDistance("prism") + dz);

/**
 * The outer radius the housing actually HAS at `dz` — its own section's far
 * rim, since a section carries that radius all the way back. Anything clamped
 * to the body or standing under it is sized against this and never against the
 * cone where it happens to sit.
 */
const opticOuterAt = (dz: number): number => {
  const i = Math.min(
    OPTIC_SECTIONS,
    Math.max(1, Math.ceil((dz - OPTIC_OCULAR_DZ) / OPTIC_SEG)),
  );
  return opticBore(OPTIC_OCULAR_DZ + i * OPTIC_SEG) / 2 + PRISM_WALL;
};

/** Where each hand grips, in weapon-local units. */
const GRIP_HAND = new Vector3(0.015, -0.165, 0.3);
const GRIP_ELBOW = new Vector3(0.26, -0.55, -0.05);
const SUPPORT_HAND = new Vector3(-0.01, -0.156, 0.667);
const SUPPORT_ELBOW = new Vector3(-0.28, -0.516, 0.497);

/**
 * Builds a low-poly cel-styled shoulder-fired rocket launcher. Local +z is the
 * bore and the bore is at y = 0, the frame every other weapon here is built
 * in.
 *
 * The silhouette is the one everybody already knows and it is four lines: a
 * plain tube, a slatted heat shield wrapped around the middle of it, a
 * bell-mouthed venturi behind the shoulder, and the fat over-calibre warhead
 * standing proud of the muzzle — which is the detail that says "rocket
 * launcher" rather than "pipe" at any distance, and the one part of this
 * weapon that visibly LEAVES when it is fired.
 *
 * ~90 parts, merged to one mesh per colour like every other weapon here —
 * twice over, because the loaded ROUND is a node of its own so the load
 * gesture can take it out of the tube and slide a fresh one back in. It
 * is 1.39 long against the rifle's 1.27 — the longest thing in the kit and
 * deliberately only just, because the hip pose frames a weapon from a fixed
 * point and everything past the rifle's length is a warhead off the edge of
 * the screen. What a launcher has to READ as is the tube, the venturi and the
 * fat head; all three have to be inside the frame at once for that.
 */
export function buildRpg(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_rpg`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- the tube: one run from the shoulder to the muzzle, in three diameters
  // so it reads as pressed steel rather than as a length of pipe ---
  b.tube("tube", BODY, TUBE_BORE, TUBE_BORE, 0.66, 0, 0, 0.45);
  // The two swells the tube is stiffened at, front and rear of the shield.
  b.tube("swellRear", METAL, TUBE_BORE + 0.02, TUBE_BORE + 0.02, 0.05, 0, 0, 0.27);
  b.tube("swellFront", METAL, TUBE_BORE + 0.02, TUBE_BORE + 0.02, 0.05, 0, 0, 0.65);
  // The chamber, where the tube widens to take the sustainer's gas.
  b.tube("chamber", BODY, TUBE_BORE + 0.045, TUBE_BORE + 0.03, 0.16, 0, 0, 0.07);

  // --- the venturi: a bell behind the shoulder, and the one thing on the
  // weapon that says which way the backblast goes ---
  b.tube("venturiNeck", METAL, TUBE_BORE + 0.03, TUBE_BORE + 0.01, 0.06, 0, 0, -0.02);
  b.tube("venturiBell", METAL, TUBE_BORE + 0.09, TUBE_BORE + 0.03, 0.1, 0, 0, -0.1);
  b.shell("venturiLip", METAL, TUBE_BORE + 0.09, 0.012, 0.02, 0, -0.15);

  // --- the heat shield: slats around the tube where the support hand goes.
  // Eight slabs on a ring rather than one sleeve, so the shield reads as
  // something clamped ON the tube rather than as more tube ---
  b.shell("shield", RUBBER, TUBE_BORE + 0.004, 0.026, 0.34, 0, 0.49, 8);
  b.shell("shieldBandR", METAL, TUBE_BORE + 0.05, 0.01, 0.022, 0, 0.34, 8);
  b.shell("shieldBandF", METAL, TUBE_BORE + 0.05, 0.01, 0.022, 0, 0.64, 8);

  // --- the trigger group: a raked pistol grip under the chamber, a squared
  // guard, and the trigger inside it ---
  const grip = b.pivot("gripPivot", 0, -0.075, 0.29, 0.3);
  b.box("gripBody", POLYMER, 0.042, 0.2, 0.062, 0, -0.1, 0, grip);
  b.box("gripCap", RUBBER, 0.046, 0.02, 0.066, 0, -0.198, 0, grip);
  for (let i = 0; i < 4; i++) {
    b.box("gripRib", RUBBER, 0.048, 0.012, 0.02, 0, -0.055 - i * 0.032, 0.026, grip);
  }
  b.box("guardFront", METAL, 0.014, 0.05, 0.012, 0, -0.062, 0.498);
  b.box("guardLoop", METAL, 0.014, 0.012, 0.09, 0, -0.09, 0.455);
  b.box("guardRear", METAL, 0.014, 0.05, 0.012, 0, -0.062, 0.412);
  b.box("trigger", METAL, 0.01, 0.036, 0.012, 0, -0.072, 0.466);
  // The hammer housing the grip hangs off, bridging it to the chamber.
  b.box("housing", BODY, 0.05, 0.06, 0.1, 0, -0.055, 0.29);

  // --- the forward grip: the second hand, under the shield ---
  // Toe FORWARD, against the firing grip's toe back — the support grip's sign,
  // and the one place in the kit a hand CLOSES round the raked part rather
  // than clamping the rail beside it, so `SUPPORT_HAND` was re-derived with it.
  const fore = b.pivot("forePivot", 0, -0.075, 0.64, -0.16);
  b.box("foreBody", POLYMER, 0.038, 0.15, 0.05, 0, -0.075, 0, fore);
  b.box("foreCap", RUBBER, 0.042, 0.018, 0.054, 0, -0.148, 0, fore);
  b.box("foreYoke", BODY, 0.044, 0.05, 0.06, 0, -0.02, 0.64);

  // --- the sight mount: a bracket off the left of the tube. Both parts are
  // capped by the optic they carry rather than sized by hand, and the cap is
  // the HOUSING's underside at the bracket's own FRONT face, where the
  // staircase is lowest. It is the prism mount block's rule, and it is the one
  // the old post broke: it stood 2 mm inside the sight picture, which is a
  // bracket in the bottom of every aimed shot ---
  const MOUNT_D = 0.07;
  const armTop = SIGHT_Y - opticOuterAt(MOUNT_D / 2) - 0.002;
  b.box("mountArm", METAL, 0.08, 0.014, MOUNT_D, -0.065, armTop - 0.007, SIGHT_Z);
  b.box("mountClamp", METAL, 0.028, 0.012, 0.05, SIGHT_X, armTop, SIGHT_Z);

  // Everything above is the LAUNCHER, and it is merged before the round is
  // built for the reason the rifle merges before its magazine: what comes out
  // of a weapon cannot be inside the weapon's own colour groups.
  b.merge("rpg", root);

  // --- the ROUND: an over-calibre head on a thin boom, standing out past the
  // muzzle, and the sustainer motor behind it that is inside the tube ---
  //
  // It is the loaded rocket, so it is drawn as one — and it is the one part of
  // this weapon that visibly LEAVES when it is fired, which is what makes it a
  // node of its own rather than more launcher. See `WeaponParts.warhead`.
  //
  // **The sustainer is the half of the round that makes the load READ**, and
  // it is invisible for as long as nothing is happening to it: seated, all
  // 0.33 of it is inside a solid cylinder of tube and the depth buffer eats
  // it, so it costs the carried weapon nothing. Pulled forward for a reload it
  // comes out of the bore — a third of a metre of motor tube leaving and going
  // back in is the whole gesture, where a warhead sliding about in front of an
  // unchanged muzzle would read as the head coming loose. Its diameter is
  // under the bore's for that reason and not as dressing — which also means it
  // can never stand outside the launch tube's own silhouette, so it is
  // incapable of intruding on the optic's picture whatever the load is doing.
  // (The bore clearance measured for `buildRpgSight` is unaffected by this
  // file's ROUND for exactly that reason.)
  const warhead = new TransformNode(`${prefix}_warhead`, scene);
  warhead.parent = root;
  b.tube("sustainer", BODY, 0.062, 0.058, 0.33, 0, 0, 0.605);
  b.tube("sustainerCap", METAL, 0.05, 0.036, 0.026, 0, 0, 0.427);
  b.tube("boom", METAL, 0.05, 0.05, 0.12, 0, 0, 0.83);
  b.tube("headSkirt", POLYMER, 0.115, 0.055, 0.09, 0, 0, 0.91);
  b.tube("headBody", POLYMER, 0.115, 0.115, 0.11, 0, 0, 1);
  b.tube("headCone", POLYMER, 0.03, 0.115, 0.12, 0, 0, 1.11);
  b.tube("fuze", METAL, 0.018, 0.026, 0.05, 0, 0, 1.18);
  // The band where the head meets the skirt, in metal, so the two polymer
  // sections do not merge into one long lozenge.
  b.tube("headBand", METAL, 0.12, 0.12, 0.016, 0, 0, 0.95);
  b.merge("rpgRound", warhead);
  // **The round turns about the ROUND, and it takes a pivot point to say so.**
  // The node is at the weapon's own origin, which is the venturi — half a metre
  // BEHIND the rocket — so a tilt of the node is a tilt of a half-metre lever
  // and the round swings through an arc rather than turning in a hand.
  // Measured before this line: the offer tilt alone moved the warhead's nose
  // 220 px, which put a round that is supposed to be out of frame in the middle
  // of it. `setPivotPoint` leaves `position` a translation in the parent's
  // frame and leaves the node at identity when nothing is set, so `stow()` and
  // `WeaponParts.warhead`'s "position is a pure offset from seated" both still
  // hold; only the centre of rotation moves. It is on the bore, so the index
  // roll about z is unaffected either way — this is for the two axes that are
  // not.
  warhead.setPivotPoint(new Vector3(0, 0, ROUND_PIVOT_Z));

  // Taken after the round's merge and before the sight's, exactly as the rifle
  // takes it after its magazine: a finish paints what the weapon IS, which
  // includes the round it carries and excludes the optic bolted to it.
  const finish = b.takeFinish();

  const sight = buildRpgSight(b, root, prefix);
  b.disposePivots();

  return {
    root,
    // The tip of the warhead. It is where the rocket leaves, so the flash and
    // the launch point are both here rather than at the tube's own mouth.
    muzzle: new Vector3(0, 0, 1.24),
    // Nothing is ejected — see `Player.tryShot`, which does not call
    // `ejectCasing` for an AT item. The port is the venturi so that anything
    // that reads this landmark reads the end the gas actually leaves by.
    ejectPort: new Vector3(0, 0, -0.15),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    warhead,
    sights: { kind: "fixed", sight: "prism", assembly: sight },
    finish,
    meshes: root.getChildMeshes(false) as Mesh[],
  };
}

/**
 * The launcher's own optic: a short prismatic body on the bracket, with a lit
 * chevron standing in its bore.
 *
 * Fixed rather than fitted for the same reason the sidearm's notch is — there
 * is no rail here to take anything else — and it reports a `sightCenter` like
 * every other assembly in the kit, which is the whole of what `applyFit`
 * needs to put the reticle on the axis the rockets fly down.
 *
 * It borrows `prism`'s entry in `CONFIG.sights` rather than declaring one:
 * 2x is what a launcher's optic is for, and the eye relief and the aimed FOV
 * that come with it are the same picture through the same glass.
 */
function buildRpgSight(
  b: WeaponBuild,
  parent: TransformNode,
  prefix: string,
): SightAssembly {
  const node = new TransformNode(`${prefix}_sight_rpg`, b.scene);
  node.parent = parent;

  /**
   * A ring on the SIGHT's axis rather than the bore's — `shell`'s `x`, which
   * this weapon is the one caller of. The optic stands beside the launch tube
   * instead of over it, so this is the one housing in the kit that is not
   * built around the barrel.
   */
  const ring = (
    name: string,
    color: string,
    bore: number,
    wall: number,
    len: number,
    z: number,
  ): void => b.shell(name, color, bore, wall, len, SIGHT_Y, z, FACETS, 0, 1, SIGHT_X);

  // The body: a staircase of rings, each wide enough at its far rim to clear
  // the cone there, so the housing circumscribes the picture.
  const ocularZ = SIGHT_Z + OPTIC_OCULAR_DZ;
  const objectiveZ = SIGHT_Z + OPTIC_OBJECTIVE_DZ;
  for (let i = 0; i < OPTIC_SECTIONS; i++) {
    const far = OPTIC_OCULAR_DZ + OPTIC_SEG * (i + 1);
    const z = SIGHT_Z + far - OPTIC_SEG / 2;
    ring("opticBody", BODY, opticBore(far), PRISM_WALL, OPTIC_SEG, z);
  }
  const rOcular = opticOuterAt(OPTIC_OCULAR_DZ);
  const rObjective = opticOuterAt(OPTIC_OBJECTIVE_DZ);
  // The ocular rim and a rubber eyecup behind it, both sized off the ocular
  // section's OUTER radius so neither can stand inside the cone. The near end
  // of a sight is the widest thing in the frame, so it is one diameter rather
  // than a stack of them — the prism's call, one size down.
  const eyeZ = ocularZ - 0.003;
  ring("opticEye", METAL, rOcular * 2, 0.005, 0.014, eyeZ);
  ring("opticCup", RUBBER, rOcular * 2, 0.005, 0.013, eyeZ - 0.011);
  // The hood: a sunshade past the objective, which is the part of a launcher's
  // optic that says the thing is not a second tube.
  const hoodZ = objectiveZ + 0.013;
  ring("opticHood", BODY, rObjective * 2, 0.006, 0.028, hoodZ);
  // Elevation on top and the range dial on the LEFT, which is the side away
  // from the launch tube: the housing clears the tube by 5 mm and a drum on
  // the inboard face would foul it.
  const rTurret = opticOuterAt(0);
  const turretY = SIGHT_Y + rTurret + 0.004;
  b.pin("opticTurret", METAL, 0.02, 0.014, SIGHT_X, turretY, SIGHT_Z, "y");
  b.pin("opticDial", METAL, 0.03, 0.014, SIGHT_X - rTurret - 0.005, SIGHT_Y, SIGHT_Z, "x");
  b.merge("rpgSight", node);

  // The chevron: two short bars meeting at a point, standing proud of the
  // objective so the ink shell does not swallow it — the rule every lit part
  // in the kit follows. Its size is a share of the CONE at its own depth
  // rather than a length, so it reads the same against the picture if the bore
  // is ever re-solved, exactly as the prism's caret does.
  const retDz = OPTIC_OBJECTIVE_DZ - 0.02;
  const armLen = PRISM_CONE * (eyeDistance("prism") + retDz) * 0.5;
  for (const side of [-1, 1] as const) {
    const a = 0.6;
    const bar = b.lit(
      MeshBuilder.CreateBox(
        `${prefix}_rpgChevron`,
        { width: 0.0012, height: armLen, depth: 0.0013 },
        b.scene,
      ),
      node,
    );
    // Each arm is hung from the axis so its TOP end lands on it, which is what
    // makes the apex the aim point rather than something near it.
    bar.rotation.z = side * a;
    bar.position.set(
      SIGHT_X + (side * Math.sin(a) * armLen) / 2,
      SIGHT_Y - (Math.cos(a) * armLen) / 2,
      SIGHT_Z + retDz,
    );
  }

  const sightCenter = new TransformNode(`${prefix}_rpg_sightCenter`, b.scene);
  sightCenter.parent = node;
  sightCenter.position = new Vector3(SIGHT_X, SIGHT_Y, SIGHT_Z);
  return { root: node, sightCenter, meshes: node.getChildMeshes(true) as Mesh[] };
}

/** One rocket's meshes. The flame is parented to the body and moves with it. */
export interface RocketMeshes {
  mesh: Mesh;
  flame: Mesh;
}

/**
 * Builds one rocket in flight, hidden, at WORLD scale — everything above this
 * function is in the viewmodel's units and none of those numbers may be
 * carried down here.
 *
 * It is the same over-calibre head standing on the same thin boom, at the size
 * it actually is: a third of a metre, which is small enough that the thing a
 * player tracks across a street is the FLAME rather than the body. That is why
 * the flame is a separate mesh and emissive — it is the tell, the way the
 * grenade's pip is, and it has to be readable against a night village and an
 * afternoon one alike.
 *
 * A rocket is dressing with a warhead on it: no `solid` flag, no `WorldBox`,
 * not pickable. Nothing shoots one down, walks into one or takes cover behind
 * one, and the only thing that stops one is the step ray `AntiTankSystem`
 * casts along its own flight.
 */
export function buildRocket(
  scene: Scene,
  mats: CelMaterialFactory,
  name: string,
): RocketMeshes {
  const r = CONFIG.equipment.rpg.rocket.radius;
  const head = MeshBuilder.CreateCylinder(
    name,
    { height: r * 2.4, diameterTop: r * 0.4, diameterBottom: r * 2, tessellation: 8 },
    scene,
  );
  head.rotation.x = Math.PI / 2;
  head.bakeCurrentTransformIntoVertices();
  head.material = mats.get("#4b4f42");
  head.isPickable = false;

  // The boom and its fins, behind the head. Merged in rather than parented, so
  // a pooled rocket is one mesh and one draw.
  const boom = MeshBuilder.CreateCylinder(
    `${name}Boom`,
    { height: r * 3, diameter: r * 0.7, tessellation: 6 },
    scene,
  );
  boom.rotation.x = Math.PI / 2;
  boom.position.z = -r * 2.6;
  const fins: Mesh[] = [boom];
  for (let i = 0; i < 4; i++) {
    const fin = MeshBuilder.CreateBox(
      `${name}Fin`,
      { width: r * 1.6, height: r * 0.12, depth: r * 1.2 },
      scene,
    );
    fin.rotation.z = (i / 4) * Math.PI * 2;
    fin.position.z = -r * 3.6;
    fins.push(fin);
  }
  const tail = Mesh.MergeMeshes(fins, true, true);
  if (tail) {
    tail.parent = head;
    tail.material = mats.get("#2f3229");
    tail.isPickable = false;
  }

  // **A parked rocket is DISABLED, not invisible**, and that is the one
  // Babylon fact this pool turns on: `isVisible` hides the mesh it is set on
  // and nothing under it, so a pool of eight hidden rockets would leave eight
  // sets of fins and eight motors standing at the world origin. `setEnabled`
  // takes the whole subtree, which is what a body made of three meshes needs.
  // `GrenadeModel` gets away with `isVisible` only because it toggles its pip
  // by hand, for a different reason.
  head.setEnabled(false);

  // The motor. Unlit, un-outlined and deliberately a stubby cone rather than a
  // sphere: it is what says which way the thing is pointing at the range a
  // rocket is actually read at.
  const flame = MeshBuilder.CreateCylinder(
    `${name}Flame`,
    { height: r * 4, diameterTop: r * 1.5, diameterBottom: r * 0.2, tessellation: 6 },
    scene,
  );
  flame.rotation.x = -Math.PI / 2;
  flame.bakeCurrentTransformIntoVertices();
  flame.parent = head;
  flame.position.z = -r * 6;
  flame.material = mats.getEmissive("#ffb046");
  flame.metadata = { noOutline: true };
  flame.isPickable = false;

  // Ink, or a dark warhead crossing a dark street is a hole in the picture
  // rather than a thing arriving — the same argument the grenade's outline
  // makes, against a body moving forty times faster.
  return { mesh: head, flame };
}
