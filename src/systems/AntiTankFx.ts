/**
 * AntiTankFx.ts — The PICTURE of the anti-tank kit in the world: a rocket's
 * body pointed down its flight with its motor guttering, and a mine's plate
 * with its fuze lamp.
 * Owns: one `RocketBody` per rocket slot and one `MineBody` per mine slot,
 * built once at the authority's own pool sizes (`ROCKET_POOL`, `MINE_POOL`),
 * each a PIECE of a kit our renderer draws (`entities/pieces.ts`,
 * `BABYLON_EXIT.md` X4.4b; `Game.drawPieces` hands them over), and the two
 * kits.
 * Invariants: it READS `AntiTankSystem` (`rocketSlots`, `mineSlots`, read-only
 * by type) and never writes it — nothing here flies, arms, triggers or
 * detonates. `update` runs straight after `AntiTankSystem.update` every frame
 * that runs, so a rocket launched this frame is shown on it and one that went
 * off is gone on the frame its fireball appears (the fireball itself is the
 * one blast's, `GrenadeFx`). The authority never builds one.
 * Contract: `docs/antitank.md`.
 *
 * Split out of `AntiTankSystem` on `CombatFx`'s line. It imports
 * the simulation's pool sizes and is handed the instance by `Game`; it holds
 * no other system. `RocketBody` and `MineBody` are exported because
 * `net/NetOrdnance` draws the same two objects off the wire, and a remote
 * warhead and a local one have to point the same way by the same move.
 */
import { minePieceParts } from "../entities/MineModel";
import { Piece, pieceKit, type PieceKits } from "../entities/pieces";
import { rocketParts } from "../entities/RpgModel";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { MINE_POOL, ROCKET_POOL, type AntiTankSystem } from "./AntiTankSystem";

/**
 * One rocket on screen: a piece of the rocket's kit — the body, and the motor
 * hung from it — which our renderer draws (`entities/pieces.ts`,
 * `BABYLON_EXIT.md` X4.4b).
 */
export class RocketBody {
  readonly piece: Piece;

  constructor(kits: Pick<PieceKits, "rocket">) {
    this.piece = new Piece(kits.rocket);
    // Every part shown, the piece switched off WHOLE until it flies.
    for (const n of this.piece.nodes) n.visible = true;
    this.piece.enabled = false;
  }

  /**
   * At `(x, y, z)`, pointed along `(dx, dy, dz)` — a velocity or a direction,
   * either will do. `lookAt`'s arithmetic rather than an angle pair because
   * the body has a roll nobody cares about and two angles that would have to
   * be kept in step: what a rocket owes the picture is that the warhead is at
   * the front, and the up vector it picks for the rest is free. Operation for
   * operation `TransformNode.lookAt` in local space (the point ahead less the
   * position) and `setDirection` with no corrections, as the mesh was turned.
   */
  place(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const root = this.piece.root;
    root.position.set(x, y, z);
    const ax = x + dx - x;
    const ay = y + dy - y;
    const az = z + dz - z;
    const yaw = -Math.atan2(az, ax) + Math.PI / 2;
    const len = Math.sqrt(ax * ax + az * az);
    const pitch = -Math.atan2(ay, len);
    root.rotation.x = pitch + 0;
    root.rotation.y = yaw + 0;
    root.rotation.z = 0;
  }

  /**
   * The motor, guttering. Driven by the distance FLOWN rather than by a clock
   * or a random: it costs one sine, it is the same flicker for the same rocket
   * however the frame rate wanders, and it is what stops a solid cone of light
   * reading as a painted-on tail.
   */
  flicker(flown: number): void {
    const flick = 0.78 + 0.22 * Math.sin(flown * 37);
    this.piece.nodes[2].scaling.set(flick, flick, 0.75 + 0.5 * flick);
  }

  /** On or off — the whole body, motor and fins included (`Piece.enabled`). */
  show(on: boolean): void {
    this.piece.enabled = on;
  }
}

/** One laid mine on screen: a piece of the mine's kit — the plate, and the fuze lamp hung from it. */
export class MineBody {
  readonly piece: Piece;

  constructor(kits: Pick<PieceKits, "mine">) {
    this.piece = new Piece(kits.mine);
    // The plate and the pressure plate always shown; the lamp is the tell,
    // switched on its own (`show`), and the piece switched off WHOLE until
    // it is laid.
    this.piece.nodes[0].visible = true;
    this.piece.nodes[1].visible = true;
    this.piece.enabled = false;
  }

  /**
   * On the ground at `(x, y, z)`. Dark until it arms — that is the whole tell,
   * and it is the right way round: what a driver can see is a mine that would
   * go off.
   */
  show(x: number, y: number, z: number, armed: boolean): void {
    this.piece.root.position.set(x, y, z);
    this.piece.enabled = true;
    this.piece.nodes[2].visible = armed;
  }

  hide(): void {
    this.piece.enabled = false;
    this.piece.nodes[2].visible = false;
  }
}

/** What this view reads of the simulation — the pools, and nothing it could write. */
type AntiTankReader = Pick<AntiTankSystem, "rocketSlots" | "mineSlots">;

export class AntiTankFx {
  /** One body a rocket slot, by slot: what `Game.drawPieces` hands our renderer. */
  readonly rockets: RocketBody[] = [];
  /** One body a mine slot, by slot. */
  readonly mines: MineBody[] = [];
  /**
   * The rocket's kit and the mine's, built here once — where the first of
   * each one's meshes were made until `BABYLON_EXIT.md` X4.4b, so their
   * materials are asked of the factory at the same point in its order — and
   * shared with the wire's pool (`net/NetOrdnance`).
   */
  readonly kits: Pick<PieceKits, "rocket" | "mine">;

  constructor(
    mats: CelMaterialFactory,
    private readonly sim: AntiTankReader,
  ) {
    this.kits = {
      rocket: pieceKit("rocket", rocketParts(mats, "rocket0")),
      mine: pieceKit("mine", minePieceParts(mats, "mine0")),
    };
    for (let i = 0; i < ROCKET_POOL; i++) this.rockets.push(new RocketBody(this.kits));
    for (let i = 0; i < MINE_POOL; i++) this.mines.push(new MineBody(this.kits));
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
