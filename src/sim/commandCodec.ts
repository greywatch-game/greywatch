/**
 * src/sim/commandCodec.ts — A `SimCommand` as NUMBERS: the one encoding a
 * command crosses a Worker boundary in (`BABYLON_EXIT.md` X2.5b).
 * Owns: each command kind's record layout, `encodeCommand` (the page's half)
 * and `CommandDecoder` (the Worker's half), and nothing that acts on a
 * command — `SimCore.submit` is still the one reader of what a command MEANS.
 * Invariants:
 * - **Allocation-free on both sides.** The encoder writes into a
 *   `Float64Array` it is handed and returns the next offset; the decoder
 *   rebuilds each kind into ONE held object per kind and hands that out, so
 *   a command it decodes is valid until the next one of its kind is decoded.
 *   `SimCore.submit` reads a command inside the call and keeps nothing of it
 *   (`commands.ts`: "never a reference into the simulation" is the rule from
 *   the other side), which is what makes the held object safe.
 * - **Bits preserved.** Every number is a float64 written and read as itself,
 *   so a decoded command is `Object.is`-equal field for field to the one
 *   encoded — the same fight on both sides of the hop, which the benchmark's
 *   hash and `simulate` hold the core to. An enumerated string is its index in
 *   its own table (`THROWABLE_IDS`, `EQUIPMENT_IDS`); an absent optional field
 *   is a flag of 0 beside the value.
 * - Every kind in `SimCommand` has a code (`CODE` is a `Record` over the
 *   union), so a new command does not compile until it can cross.
 * Never: carry anything a command does not — no slot table, no result. The
 * record's first two numbers are the KIND and the SLOT it is submitted for.
 */
import { EQUIPMENT_IDS } from "../entities/equipment";
import { THROWABLE_IDS } from "../entities/throwables";
import type { CrewSeat } from "../entities/hullSeats";
import type {
  DeployCommand,
  DismountCommand,
  DriveCommand,
  GrenadeCommand,
  GunCommand,
  KitCommand,
  MgCommand,
  MountCommand,
  MoveCommand,
  OrdnanceCommand,
  ShellCommand,
  ShotCommand,
  ShotWeapon,
  SimCommand,
} from "./commands";

const CODE = {
  move: 1,
  shot: 2,
  grenade: 3,
  ordnance: 4,
  deploy: 5,
  kit: 6,
  mount: 7,
  dismount: 8,
  drive: 9,
  gun: 10,
  shell: 11,
  mg: 12,
} as const satisfies Record<SimCommand["t"], number>;

/** The longest record, in float64s: `shot`'s kind, slot and seventeen fields. */
export const MAX_COMMAND = 19;

function v3(out: Float64Array, o: number, v: { x: number; y: number; z: number }): void {
  out[o] = v.x;
  out[o + 1] = v.y;
  out[o + 2] = v.z;
}

/**
 * Writes `cmd`, submitted for `slot`, at `o` and returns the offset after it.
 * The caller makes sure `MAX_COMMAND` float64s fit from `o`.
 */
export function encodeCommand(out: Float64Array, o: number, slot: number, cmd: SimCommand): number {
  out[o] = CODE[cmd.t];
  out[o + 1] = slot;
  let k = o + 2;
  switch (cmd.t) {
    case "move":
      out[k++] = cmd.dt;
      out[k++] = cmd.x;
      out[k++] = cmd.y;
      out[k++] = cmd.z;
      out[k++] = cmd.yaw;
      out[k++] = cmd.pitch;
      out[k++] = cmd.crouch ? 1 : 0;
      out[k++] = cmd.sprint ? 1 : 0;
      return k;
    case "shot": {
      v3(out, k, cmd.origin);
      v3(out, k + 3, cmd.dir);
      k += 6;
      out[k++] = cmd.muzzle ? 1 : 0;
      if (cmd.muzzle) v3(out, k, cmd.muzzle);
      else out[k] = out[k + 1] = out[k + 2] = 0;
      k += 3;
      const w = cmd.weapon;
      out[k++] = w.damage;
      out[k++] = w.damageFar;
      out[k++] = w.falloffNear;
      out[k++] = w.falloffFar;
      out[k++] = w.range;
      out[k++] = cmd.renderTime === undefined ? 0 : 1;
      out[k++] = cmd.renderTime ?? 0;
      return k;
    }
    case "grenade":
      v3(out, k, cmd.origin);
      v3(out, k + 3, cmd.dir);
      out[k + 6] = THROWABLE_IDS.indexOf(cmd.kind);
      return k + 7;
    case "ordnance":
      out[k] = EQUIPMENT_IDS.indexOf(cmd.kind);
      v3(out, k + 1, cmd.origin);
      v3(out, k + 4, cmd.dir);
      return k + 7;
    case "deploy":
      out[k] = cmd.spawn === undefined ? 0 : 1;
      out[k + 1] = cmd.spawn ?? 0;
      return k + 2;
    case "kit":
      out[k] = cmd.grenades;
      out[k + 1] = cmd.ordnance;
      return k + 2;
    case "mount":
      out[k] = cmd.tank;
      out[k + 1] = cmd.seat;
      return k + 2;
    case "dismount":
      return k;
    case "drive":
      out[k++] = cmd.x;
      out[k++] = cmd.y;
      out[k++] = cmd.z;
      out[k++] = cmd.yaw;
      out[k++] = cmd.turretYaw;
      out[k++] = cmd.gunPitch;
      out[k++] = cmd.aimYaw;
      out[k++] = cmd.aimPitch;
      out[k++] = cmd.time;
      out[k++] = cmd.resync === undefined ? 0 : cmd.resync ? 2 : 1;
      return k;
    case "gun":
      out[k] = cmd.yaw;
      out[k + 1] = cmd.pitch;
      return k + 2;
    case "shell":
    case "mg":
      out[k] = cmd.early;
      return k + 1;
    default: {
      const unhandled: never = cmd;
      void unhandled;
      return o;
    }
  }
}

/** A held `{x, y, z}` — what a decoded command's vectors are. */
interface Held3 {
  x: number;
  y: number;
  z: number;
}

const held3 = (): Held3 => ({ x: 0, y: 0, z: 0 });

function read3(src: Float64Array, o: number, out: Held3): Held3 {
  out.x = src[o];
  out.y = src[o + 1];
  out.z = src[o + 2];
  return out;
}

/**
 * The Worker's half: walks a buffer of encoded records and hands each back as
 * a held command. `next` decodes the record at the cursor into `slot` and
 * `cmd` and advances; read both before the next call.
 */
export class CommandDecoder {
  /** The slot the last decoded command was submitted for. */
  slot = -1;
  /** The last decoded command — a held object, rewritten by the next of its kind. */
  cmd: SimCommand = null!;

  private readonly move: MoveCommand = {
    t: "move", dt: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, sprint: false,
  };
  private readonly shotWeapon: ShotWeapon = {
    damage: 0, damageFar: 0, falloffNear: 0, falloffFar: 0, range: 0,
  };
  private readonly shotOrigin = held3();
  private readonly shotDir = held3();
  private readonly shotMuzzle = held3();
  private readonly shot: ShotCommand = {
    t: "shot", origin: this.shotOrigin, dir: this.shotDir, weapon: this.shotWeapon,
  };
  private readonly grenade: GrenadeCommand = {
    t: "grenade", origin: held3(), dir: held3(), kind: "frag",
  };
  private readonly ordnance: OrdnanceCommand = {
    t: "ordnance", kind: EQUIPMENT_IDS[0], origin: held3(), dir: held3(),
  };
  private readonly deploy: DeployCommand = { t: "deploy" };
  private readonly kit: KitCommand = { t: "kit", grenades: 0, ordnance: 0 };
  private readonly mount: MountCommand = { t: "mount", tank: 0, seat: 0 };
  private readonly dismount: DismountCommand = { t: "dismount" };
  private readonly drive: DriveCommand = {
    t: "drive", x: 0, y: 0, z: 0, yaw: 0, turretYaw: 0, gunPitch: 0, aimYaw: 0, aimPitch: 0, time: 0,
  };
  private readonly gun: GunCommand = { t: "gun", yaw: 0, pitch: 0 };
  private readonly shell: ShellCommand = { t: "shell", early: 0 };
  private readonly mg: MgCommand = { t: "mg", early: 0 };

  /** Decodes the record at `o` of `src` into `slot`/`cmd`; returns the offset after it. */
  next(src: Float64Array, o: number): number {
    const code = src[o];
    this.slot = src[o + 1];
    let k = o + 2;
    switch (code) {
      case CODE.move: {
        const c = this.move;
        c.dt = src[k++];
        c.x = src[k++];
        c.y = src[k++];
        c.z = src[k++];
        c.yaw = src[k++];
        c.pitch = src[k++];
        c.crouch = src[k++] === 1;
        c.sprint = src[k++] === 1;
        this.cmd = c;
        return k;
      }
      case CODE.shot: {
        const c = this.shot;
        read3(src, k, this.shotOrigin);
        read3(src, k + 3, this.shotDir);
        k += 6;
        const hasMuzzle = src[k++] === 1;
        c.muzzle = hasMuzzle ? read3(src, k, this.shotMuzzle) : undefined;
        k += 3;
        const w = this.shotWeapon;
        w.damage = src[k++];
        w.damageFar = src[k++];
        w.falloffNear = src[k++];
        w.falloffFar = src[k++];
        w.range = src[k++];
        const hasTime = src[k++] === 1;
        const time = src[k++];
        c.renderTime = hasTime ? time : undefined;
        this.cmd = c;
        return k;
      }
      case CODE.grenade: {
        const c = this.grenade;
        read3(src, k, c.origin as Held3);
        read3(src, k + 3, c.dir as Held3);
        c.kind = THROWABLE_IDS[src[k + 6]];
        this.cmd = c;
        return k + 7;
      }
      case CODE.ordnance: {
        const c = this.ordnance;
        c.kind = EQUIPMENT_IDS[src[k]];
        read3(src, k + 1, c.origin as Held3);
        read3(src, k + 4, c.dir as Held3);
        this.cmd = c;
        return k + 7;
      }
      case CODE.deploy: {
        const c = this.deploy;
        c.spawn = src[k] === 1 ? src[k + 1] : undefined;
        this.cmd = c;
        return k + 2;
      }
      case CODE.kit: {
        const c = this.kit;
        c.grenades = src[k];
        c.ordnance = src[k + 1];
        this.cmd = c;
        return k + 2;
      }
      case CODE.mount: {
        const c = this.mount;
        c.tank = src[k];
        c.seat = src[k + 1] as CrewSeat;
        this.cmd = c;
        return k + 2;
      }
      case CODE.dismount:
        this.cmd = this.dismount;
        return k;
      case CODE.drive: {
        const c = this.drive;
        c.x = src[k++];
        c.y = src[k++];
        c.z = src[k++];
        c.yaw = src[k++];
        c.turretYaw = src[k++];
        c.gunPitch = src[k++];
        c.aimYaw = src[k++];
        c.aimPitch = src[k++];
        c.time = src[k++];
        const resync = src[k++];
        c.resync = resync === 0 ? undefined : resync === 2;
        this.cmd = c;
        return k;
      }
      case CODE.gun: {
        const c = this.gun;
        c.yaw = src[k];
        c.pitch = src[k + 1];
        this.cmd = c;
        return k + 2;
      }
      case CODE.shell:
        this.shell.early = src[k];
        this.cmd = this.shell;
        return k + 1;
      case CODE.mg:
        this.mg.early = src[k];
        this.cmd = this.mg;
        return k + 1;
      default:
        throw new Error(`[commandCodec] unknown command code ${code} at ${o}`);
    }
  }
}
