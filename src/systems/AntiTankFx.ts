/**
 * AntiTankFx.ts — The PICTURE of the anti-tank kit in the world: a rocket's
 * body pointed down its flight with its motor guttering, and a mine's plate
 * with its fuze lamp.
 * Owns: one `RocketBody` per rocket slot and one `MineBody` per mine slot,
 * built once at the authority's own pool sizes (`ROCKET_POOL`, `MINE_POOL`).
 * Invariants: it READS `AntiTankSystem` (`rocketSlots`, `mineSlots`, read-only
 * by type) and never writes it — nothing here flies, arms, triggers or
 * detonates. `update` runs straight after `AntiTankSystem.update` every frame
 * that runs, so a rocket launched this frame is shown on it and one that went
 * off is gone on the frame its fireball appears (the fireball itself is the
 * one blast's, `GrenadeFx`). The authority never builds one
 * (`BABYLON_EXIT.md` X2.2).
 * Contract: `docs/antitank.md`.
 *
 * Split out of `AntiTankSystem` at X2.2 C3, on `CombatFx`'s line. It imports
 * the simulation's pool sizes and is handed the instance by `Game`; it holds
 * no other system. `RocketBody` and `MineBody` are exported because
 * `net/NetOrdnance` draws the same two objects off the wire, and a remote
 * warhead and a local one have to point the same way by the same move.
 */
import { Mesh, Scene, Vector3 } from "@babylonjs/core";
import { buildMineBody } from "../entities/MineModel";
import { buildRocket } from "../entities/RpgModel";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { MINE_POOL, ROCKET_POOL, type AntiTankSystem } from "./AntiTankSystem";

/** Scratch for the point a rocket is faced at. Never allocated per frame. */
const _ahead = new Vector3();

/** One rocket on screen: the body, and the motor parented to it. */
export class RocketBody {
  private readonly mesh: Mesh;
  /** The motor — the tell a driver actually reads. */
  private readonly flame: Mesh;
  private shown = false;

  constructor(scene: Scene, mats: CelMaterialFactory, name: string) {
    const { mesh, flame } = buildRocket(scene, mats, name);
    this.mesh = mesh;
    this.flame = flame;
    mesh.setEnabled(false);
  }

  /**
   * At `(x, y, z)`, pointed along `(dx, dy, dz)` — a velocity or a direction,
   * either will do. `lookAt` rather than an angle pair because the body has a
   * roll nobody cares about and two angles that would have to be kept in
   * step: what a rocket owes the picture is that the warhead is at the front,
   * and the up vector it picks for the rest is free.
   */
  place(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    this.mesh.position.set(x, y, z);
    _ahead.set(x + dx, y + dy, z + dz);
    this.mesh.lookAt(_ahead);
  }

  /**
   * The motor, guttering. Driven by the distance FLOWN rather than by a clock
   * or a random: it costs one sine, it is the same flicker for the same rocket
   * however the frame rate wanders, and it is what stops a solid cone of light
   * reading as a painted-on tail.
   */
  flicker(flown: number): void {
    const flick = 0.78 + 0.22 * Math.sin(flown * 37);
    this.flame.scaling.set(flick, flick, 0.75 + 0.5 * flick);
  }

  /**
   * On or off — the whole body, motor and fins included, which is why this is
   * `setEnabled` and not `isVisible` (see `buildRocket`).
   */
  show(on: boolean): void {
    if (this.shown === on) return;
    this.shown = on;
    this.mesh.setEnabled(on);
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

/** One laid mine on screen: the plate, and the fuze lamp parented to it. */
export class MineBody {
  private readonly mesh: Mesh;
  /** The fuze lamp: dark while arming, lit once live. */
  private readonly lamp: Mesh;

  constructor(scene: Scene, mats: CelMaterialFactory, name: string) {
    const { mesh, lamp } = buildMineBody(scene, mats, name);
    this.mesh = mesh;
    this.lamp = lamp;
    mesh.setEnabled(false);
    lamp.isVisible = false;
  }

  /**
   * On the ground at `(x, y, z)`. Dark until it arms — that is the whole tell,
   * and it is the right way round: what a driver can see is a mine that would
   * go off.
   */
  show(x: number, y: number, z: number, armed: boolean): void {
    this.mesh.position.set(x, y, z);
    if (!this.mesh.isEnabled()) this.mesh.setEnabled(true);
    this.lamp.isVisible = armed;
  }

  hide(): void {
    if (this.mesh.isEnabled()) this.mesh.setEnabled(false);
    this.lamp.isVisible = false;
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

/** What this view reads of the simulation — the pools, and nothing it could write. */
type AntiTankReader = Pick<AntiTankSystem, "rocketSlots" | "mineSlots">;

export class AntiTankFx {
  private readonly rockets: RocketBody[] = [];
  private readonly mines: MineBody[] = [];

  constructor(
    scene: Scene,
    mats: CelMaterialFactory,
    private readonly sim: AntiTankReader,
  ) {
    for (let i = 0; i < ROCKET_POOL; i++) {
      this.rockets.push(new RocketBody(scene, mats, `rocket${i}`));
    }
    for (let i = 0; i < MINE_POOL; i++) {
      this.mines.push(new MineBody(scene, mats, `mine${i}`));
    }
  }

  /** Poses every rocket and every mine off the simulation's pools. */
  update(): void {
    const rockets = this.sim.rocketSlots;
    for (let i = 0; i < rockets.length; i++) {
      const r = rockets[i];
      const body = this.rockets[i];
      if (!r.live) {
        body.show(false);
        continue;
      }
      body.place(r.pos.x, r.pos.y, r.pos.z, r.vel.x, r.vel.y, r.vel.z);
      body.flicker(r.flown);
      body.show(true);
    }
    const mines = this.sim.mineSlots;
    for (let i = 0; i < mines.length; i++) {
      const m = mines[i];
      if (m.live) this.mines[i].show(m.pos.x, m.pos.y, m.pos.z, m.armT <= 0);
      else this.mines[i].hide();
    }
  }

  /**
   * Everything off the screen, beside `AntiTankSystem.reset` — a rocket over a
   * map that is going away, or a mine under a street that is not there.
   */
  reset(): void {
    for (const r of this.rockets) r.show(false);
    for (const m of this.mines) m.hide();
  }
}
