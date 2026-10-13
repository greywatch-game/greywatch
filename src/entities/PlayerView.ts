/**
 * PlayerView.ts — What the local player LOOKS like: the viewmodel on the
 * camera, the muzzle flash star hung off its muzzle, and the brass it throws
 * into the world. There is nothing else to draw — in first person the camera
 * is inside the head and the player has no body mesh at all.
 * Owns: the `ViewModel` (`model`), the flash's three petals and its strobe
 * clock, and the casing pool. Only the client builds one (`Game`); `Player`
 * is told what happened through `PlayerPicture` and keeps no mesh, no node and
 * no scene of its own.
 * Invariants:
 * - **Four things it is TOLD, as `Player`'s `PlayerPicture`**: a round left a
 *   gun (`fired` — the strobe and a case), a frame was stepped (`stepped` —
 *   the strobe burns down and the brass falls to the feet), a fresh body
 *   (`cleared`) and the weapon put away or taken out (`stowed`). The model is
 *   reached directly as `model`, because the pose IS `Player`'s smoothed
 *   signals and splitting them would be two owners of one gesture.
 * - **The flash and the brass are player-only pictures** (bots get neither —
 *   see `CONFIG.gunfeel`), and their randomness stays on `Math.random`:
 *   nothing about them reaches where a round goes.
 * - The flash joins `VIEWMODEL_GROUP` with the rifle it hangs off; the brass
 *   is thrown into the WORLD and stays in the ordinary group, occluded like
 *   anything else. Both are built as `Part`s on `src/geometry/` buffers and
 *   made meshes by `drawnMesh`.
 * Never: write anything on `Player` — it reads nothing back from the picture
 * but the model's own answers (`carriedSight`, `reloadAction`, the reload's
 * head pose), which are the drawing's to give.
 */
import {
  Mesh,
  type Node,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { createBox, createPlane, DOUBLESIDE } from "../geometry/primitives";
import { drawnMesh, Part } from "../world/parts";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { PlayerPicture } from "./Player";
import { ViewModel, VIEWMODEL_GROUP } from "./ViewModel";

/** One live brass case: world-space ballistic, despawned on `t` expiry. */
interface Casing {
  mesh: Mesh;
  vel: Vector3;
  spin: number;
  t: number;
}

/** Scratch for the eject direction — no allocation per shot. */
const _casingDir = new Vector3();

export class PlayerView implements PlayerPicture {
  /** The rifle and hands on screen, hanging off the camera. */
  readonly model: ViewModel;
  /** Muzzle flash star: shown for `gunfeel.flashTime` after each shot. */
  private readonly flashRoot: TransformNode;
  private flashT = 0;
  /** Ejected brass pool; a case is live while its `t > 0`. */
  private readonly casings: Casing[] = [];
  /** Scratch for casing integration — no per-frame allocation. */
  private readonly casingStep = new Vector3();
  /**
   * Whether the weapon is put away — `Player`'s `bodyHidden`, as `stowed`
   * last said it. A case thrown while it is set is thrown unseen.
   */
  private hidden = true;

  constructor(scene: Scene, mats: CelMaterialFactory, camera: Node) {
    // The weapon hangs off the camera: in first person the rifle you see is a
    // viewmodel, posed in camera space.
    this.model = new ViewModel(scene, mats, camera);

    // --- gunfeel dressing: muzzle flash star + brass pool (player only) ---
    // The flash is three crossed emissive petals at the muzzle; per shot it
    // gets a random roll and scale so no two shots strobe identically.
    this.flashRoot = new TransformNode("player_muzzleFlash", scene);
    // The viewmodel's own muzzle node, not the carried model's: the model can
    // be switched off under a loadout change and the flash must not go with it.
    this.flashRoot.parent = this.model.muzzle;
    this.flashRoot.setEnabled(false);
    const flashMat = mats.getEmissive("#ffd9a0");
    for (let i = 0; i < 3; i++) {
      const petal = drawnMesh(
        new Part(
          `player_flashPetal${i}`,
          createPlane({ width: 0.34, height: 0.15, sideOrientation: DOUBLESIDE }),
        ),
        scene,
      );
      petal.parent = this.flashRoot;
      petal.rotation.y = Math.PI / 2; // length runs along the barrel
      petal.rotation.z = (i * Math.PI) / 3;
      petal.position.z = 0.14;
      petal.material = flashMat;
      petal.metadata = { noInk: true };
      petal.isPickable = false;
      // The flash lives on the viewmodel, so it has to be drawn in the same
      // depth-cleared pass — left in the world group it would be hidden
      // behind the very barrel it sits on.
      petal.renderingGroupId = VIEWMODEL_GROUP;
      petal.alwaysSelectAsActiveMesh = true;
    }

    const casingMat = mats.get("#b99b4e");
    for (let i = 0; i < CONFIG.gunfeel.casingPool; i++) {
      const m = drawnMesh(
        new Part(`player_casing${i}`, createBox({ width: 0.016, height: 0.016, depth: 0.05 })),
        scene,
      );
      m.material = casingMat;
      m.isPickable = false;
      m.isVisible = false;
      this.casings.push({ mesh: m, vel: new Vector3(), spin: 0, t: 0 });
    }
    // Brass is thrown into the WORLD, not onto the camera, so it stays in the
    // ordinary rendering group and is occluded by geometry like anything else.
  }

  /**
   * Muzzle flash: a single-frame-scale strobe with a random roll and scale,
   * so full-auto reads as flicker rather than one static sprite — and one
   * case of brass out of the port.
   */
  fired(): void {
    this.flashT = CONFIG.gunfeel.flashTime;
    this.flashRoot.setEnabled(true);
    this.flashRoot.rotation.z = Math.random() * Math.PI;
    this.flashRoot.scaling.setAll(0.85 + Math.random() * 0.4);
    this.ejectCasing();
  }

  /**
   * Pops one brass case out of the eject port: sideways off the rifle with a
   * random upward toss and tumble. Pool-starved shots just skip the case.
   */
  private ejectCasing(): void {
    const c = this.casings.find((c) => c.t <= 0);
    if (!c) return;
    const g = CONFIG.gunfeel;
    // The port is on the viewmodel, so this is a camera-space frame resolved
    // to world: the brass leaves the gun you can see and then falls in the
    // world, which is exactly where it should end up. The node is the
    // viewmodel's rather than the model's, so it follows a weapon swap.
    const port = this.model.ejectPort;
    c.mesh.position.copyFrom(port.getAbsolutePosition());
    Vector3.TransformNormalToRef(
      _casingDir.set(1, 0, -0.2),
      port.getWorldMatrix(),
      c.vel,
    );
    c.vel.normalize().scaleInPlace(g.casingEject * (0.8 + Math.random() * 0.4));
    c.vel.y += g.casingUp * (0.7 + Math.random() * 0.6);
    c.spin = (Math.random() * 2 - 1) * 25;
    c.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    c.t = g.casingLife;
    c.mesh.isVisible = !this.hidden;
  }

  /**
   * Advances the flash strobe and the live brass. Cases fall ballistically
   * and come to rest at the height of the player's FEET (an approximation —
   * they're never more than a toss away) until their lifetime expires.
   */
  stepped(dt: number, feetY: number): void {
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flashRoot.setEnabled(false);
    }
    const g = CONFIG.gunfeel;
    const restY = feetY + 0.02;
    for (const c of this.casings) {
      if (c.t <= 0) continue;
      c.t -= dt;
      if (c.t <= 0) {
        c.mesh.isVisible = false;
        continue;
      }
      if (c.vel.y !== 0 || c.mesh.position.y > restY) {
        c.vel.y -= g.casingGravity * dt;
        c.mesh.position.addInPlace(
          this.casingStep.copyFrom(c.vel).scaleInPlace(dt),
        );
        if (c.mesh.position.y <= restY && c.vel.y < 0) {
          c.mesh.position.y = restY;
          c.vel.setAll(0); // bounced to rest; tumble stops with it
          c.spin = 0;
        } else {
          c.mesh.rotation.x += c.spin * dt;
          c.mesh.rotation.z += c.spin * 0.7 * dt;
        }
      }
    }
  }

  /** A fresh body: no strobe and no brass left over from the last life. */
  cleared(): void {
    this.flashT = 0;
    this.flashRoot.setEnabled(false);
    for (const c of this.casings) {
      c.t = 0;
      c.mesh.isVisible = false;
    }
  }

  /**
   * The weapon put away or taken out (an inspection is neither — brass is
   * thrown into the world, and the world is not what the kit screen shows).
   *
   * The flash has to be ENDED here rather than left to retire itself. It hangs
   * off the viewmodel's muzzle node but is not one of the viewmodel's meshes,
   * so `model.setVisible` does not reach it, and the strobe that would switch
   * it off is `stepped` — which stops being called the moment the body is put
   * away. A death taken inside the 50 ms of a shot's flash would otherwise
   * freeze the star mid-strobe and, because it draws in the viewmodel's
   * depth-cleared group, hang it over the middle of the screen for the whole
   * death cam. It never *starts* while the weapon is stowed, which is what
   * made this look self-managing; being stowed part-way through one is the
   * case that was missing.
   */
  stowed(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) {
      this.flashT = 0;
      this.flashRoot.setEnabled(false);
    }
    for (const c of this.casings) {
      c.mesh.isVisible = c.t > 0 && !hidden;
    }
  }
}
