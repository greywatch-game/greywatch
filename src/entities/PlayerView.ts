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
 * - The flash is drawn in the weapon's order with the rifle it hangs off; the
 *   brass is thrown into the WORLD, a mesh of rendering group 0 occluded like
 *   anything else (the weapon is no Babylon mesh at all since
 *   `BABYLON_EXIT.md` X4.3d, and no group but 0 holds anything). Both are built as `Part`s on `src/geometry/`
 *   buffers: the petals made SEGMENTS our renderer draws (`toSegment`,
 *   `BABYLON_EXIT.md` X4.3c), the cases meshes by `drawnMesh` (a pool X4.4
 *   takes).
 * - **The flash is part of the viewmodel's TREE** (`BABYLON_EXIT.md` X4.3b):
 *   its root is a joint hung from the muzzle joint (`ViewModel.tree`), its
 *   petals segments hung from that with no parent of their own, drawn as the
 *   weapon is (`render/ViewDraw.ts`, by the emissive program, and into the
 *   glow's mask). Its switch and its per-shot roll and
 *   scale are written on the joint, the roll and scale reported to the
 *   tree's cache (`touch`). The brass is thrown off the ejection port as the
 *   render cache answers it (`ViewModel.ejectPortWorld`), never a fresh
 *   compose.
 * Never: write anything on `Player` — it reads nothing back from the picture
 * but the model's own answers (`carriedSight`, `reloadAction`, the reload's
 * head pose), which are the drawing's to give.
 */
import { Matrix, Mesh, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { createBox, createPlane, DOUBLESIDE } from "../geometry/primitives";
import { drawnMesh, Part } from "../world/parts";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { PlayerPicture } from "./Player";
import type { Joint } from "./rigJoints";
import { ViewModel } from "./ViewModel";
import { toSegment, type ViewCamera } from "./viewTree";

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
  /**
   * Muzzle flash star: shown for `gunfeel.flashTime` after each shot. A joint
   * of the viewmodel's tree (`ViewModel.tree`), its petals meshes hung from
   * it and drawn off it like every other part of the weapon.
   */
  private readonly flashRoot: Joint;
  private flashT = 0;
  /** Ejected brass pool; a case is live while its `t > 0`. */
  private readonly casings: Casing[] = [];
  /** Scratch for casing integration — no per-frame allocation. */
  private readonly casingStep = new Vector3();
  /** The ejection port's world, read once a case (`ViewModel.ejectPortWorld`). */
  private readonly portWorld = new Matrix();
  /**
   * Whether the weapon is put away — `Player`'s `bodyHidden`, as `stowed`
   * last said it. A case thrown while it is set is thrown unseen.
   */
  private hidden = true;

  constructor(scene: Scene, mats: CelMaterialFactory, camera: ViewCamera) {
    // The weapon hangs off the camera: in first person the rifle you see is a
    // viewmodel, posed in camera space.
    this.model = new ViewModel(scene, mats, camera);

    // --- gunfeel dressing: muzzle flash star + brass pool (player only) ---
    // The flash is three crossed emissive petals at the muzzle; per shot it
    // gets a random roll and scale so no two shots strobe identically.
    // The viewmodel's own muzzle joint, not the carried model's: the model can
    // be switched off under a loadout change and the flash must not go with it.
    const tree = this.model.tree;
    this.flashRoot = tree.joint("player_muzzleFlash", this.model.muzzle);
    this.flashRoot.enabled = false;
    const flashMat = mats.getEmissive("#ffd9a0");
    for (let i = 0; i < 3; i++) {
      // A SEGMENT of the weapon our renderer draws (`BABYLON_EXIT.md` X4.3c),
      // in the weapon's own order — left a mesh in the world's group it would
      // be ordered with the world rather than with the barrel it sits on.
      const petal = toSegment(
        new Part(
          `player_flashPetal${i}`,
          createPlane({ width: 0.34, height: 0.15, sideOrientation: DOUBLESIDE }),
        ),
      );
      tree.hang(petal, this.flashRoot);
      petal.rotation.y = Math.PI / 2; // length runs along the barrel
      petal.rotation.z = (i * Math.PI) / 3;
      petal.position.z = 0.14;
      petal.material = flashMat;
      petal.metadata = { noInk: true };
    }
    // The petals' own transforms, taken into their joints now they are set.
    tree.seal();

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
    this.flashRoot.enabled = true;
    this.model.tree.cache.touch(this.flashRoot);
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
    // world, which is exactly where it should end up. The joint is the
    // viewmodel's rather than the model's, so it follows a weapon swap — and
    // it is read as Babylon read the node, out of the render cache.
    const port = this.model.ejectPortWorld(this.portWorld);
    const m = port.m;
    c.mesh.position.set(m[12], m[13], m[14]);
    Vector3.TransformNormalToRef(_casingDir.set(1, 0, -0.2), port, c.vel);
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
      if (this.flashT <= 0) this.flashRoot.enabled = false;
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
    this.flashRoot.enabled = false;
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
   * off the viewmodel's muzzle joint but is not one of the viewmodel's meshes,
   * so `model.setVisible` does not reach it, and the strobe that would switch
   * it off is `stepped` — which stops being called the moment the body is put
   * away. A death taken inside the 50 ms of a shot's flash would otherwise
   * freeze the star mid-strobe and, because it draws with the weapon (in its
   * order, against the eye, our renderer's since `BABYLON_EXIT.md` X4.3c),
   * hang it over the middle of the screen for the whole death cam. It never
   * *starts* while the weapon is stowed, which is what made this look
   * self-managing; being stowed part-way through one is the case that was
   * missing.
   */
  stowed(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) {
      this.flashT = 0;
      this.flashRoot.enabled = false;
    }
    for (const c of this.casings) {
      c.mesh.isVisible = c.t > 0 && !hidden;
    }
  }
}
