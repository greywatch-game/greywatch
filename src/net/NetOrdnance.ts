/**
 * net/NetOrdnance.ts — Somebody else's anti-tank kit, drawn from the wire:
 * rockets in the air and mines on the ground.
 * Owns: a fixed pool of each, the interpolation buffer behind every rocket,
 * and which wire flight or wire mine each one is currently drawing.
 * Owns NO ballistics and NO trigger: nothing here flies, nothing arms,
 * nothing detonates and nothing is damaged. It is `NetGrenades`' job done for
 * the other two objects the authority puts in the world — everything it shows
 * was decided on the server and is drawn on the same clock,
 * `CONFIG.net.interpDelay` behind the newest snapshot.
 * Invariants: both pools are built once, never resized, and are exactly the
 * authority's own sizes (`ROCKET_POOL`, `MINE_POOL`), so a client can never be
 * told about an object it has no mesh for.
 *
 * **The two halves arrive differently, and the difference is what they ARE.**
 * A rocket is on the snapshot and interpolated, because it crosses a street in
 * a second and a half; a mine is a `mines` message re-sent only when the SET
 * changes, because a mine never moves. `docs/multiplayer.md` argues the trade;
 * what it costs this file is two shapes rather than one.
 *
 * **The local player's own rocket is not in here** — `Game.launchRocket` flies
 * a real one out of the local `AntiTankSystem` on the frame the trigger goes,
 * which is what the shooter watches, and the authority's copy comes back a
 * round trip later with their slot on it. Drawing both would be two warheads
 * for one launch. Their own MINE is a different answer to the same question
 * and is drawn from here like everybody else's: it is laid at the feet and
 * never moves, so the round trip is invisible and a predicted copy would be a
 * second plate to reconcile.
 */
import { Mesh, Scene, Vector3 } from "@babylonjs/core";
import { buildMineBody } from "../entities/MineModel";
import { buildRocket } from "../entities/RpgModel";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { MINE_POOL, ROCKET_POOL } from "../systems/AntiTankSystem";
import type { MinesMessage, Snapshot } from "./protocol";

/** One received rocket sample, with the server time it describes. */
interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
}

/** How many samples to keep — `NetGrenades.BUFFER`'s reasoning exactly. */
const BUFFER = 8;

/** One pool entry: the meshes, and the flight it is drawing. */
interface Ghost {
  readonly mesh: Mesh;
  /** The motor, parented to the body. See `buildRocket`. */
  readonly flame: Mesh;
  /** The wire's flight id, or -1 while the slot is free. */
  id: number;
  readonly samples: Sample[];
  /**
   * Where the flight is pointing, straight off the wire.
   *
   * Sent rather than differenced from two samples, and that is the one place
   * this file departs from `NetGrenades`: a rocket covers six metres between
   * snapshots and a grenade tumbles anyway, so a heading taken from the last
   * two positions flickers whenever a packet is late — on the one object whose
   * whole silhouette is which way it is going.
   */
  readonly dir: Vector3;
  /** False until this ghost has been POSED — see `NetGrenades.Ghost`. */
  hasPosition: boolean;
}

export class NetOrdnance {
  private readonly rockets: Ghost[] = [];
  /** Flight id -> the ghost drawing it. Only ever holds claimed slots. */
  private readonly live = new Map<number, Ghost>();
  /** Which flights this snapshot mentioned. Reused; never a fresh Set. */
  private readonly present = new Set<number>();

  /**
   * The mines, one mesh per pool slot and indexed by it.
   *
   * A plain array rather than a claim/release pool, because a mine's index on
   * the wire IS the authority's own pool slot — see `MineState.i`. So there is
   * nothing to allocate and nothing to match up: a `mines` message is applied
   * by showing the slots it names and hiding the ones it does not.
   */
  private readonly mines: { mesh: Mesh; lamp: Mesh }[] = [];

  /**
   * How many mines each roster slot has on the field, as the last table said.
   *
   * Kept because the LAYER's own HUD counts them: the per-owner cap retires
   * your oldest when you lay a third, so this is a number a player is making a
   * decision with. Offline the same figure is `AntiTankSystem.minesFor`.
   */
  private readonly laid = new Map<number, number>();

  constructor(scene: Scene, mats: CelMaterialFactory) {
    for (let i = 0; i < ROCKET_POOL; i++) {
      const { mesh, flame } = buildRocket(scene, mats, `netRocket${i}`);
      mesh.setEnabled(false);
      this.rockets.push({
        mesh,
        flame,
        id: -1,
        samples: [],
        dir: new Vector3(0, 0, 1),
        hasPosition: false,
      });
    }
    for (let i = 0; i < MINE_POOL; i++) {
      const { mesh, lamp } = buildMineBody(scene, mats, `netMine${i}`);
      mesh.setEnabled(false);
      lamp.isVisible = false;
      this.mines.push({ mesh, lamp });
    }
  }

  /**
   * Takes a snapshot's rockets: a sample for every flight still in the air,
   * and the end of every one that is not.
   *
   * `localSlot` is this client's own roster slot, and the flights it fired are
   * skipped — see the header.
   */
  applySnapshot(snap: Snapshot, localSlot: number): void {
    this.present.clear();
    for (const r of snap.rockets ?? []) {
      if (r.by === localSlot) continue;
      const ghost = this.claim(r.i);
      // A pool with nothing free draws nothing rather than stealing a live
      // slot — `NetGrenades`' refusal, and like that one it cannot happen:
      // this pool is the authority's own size.
      if (!ghost) continue;
      this.present.add(r.i);
      ghost.dir.set(r.dir[0], r.dir[1], r.dir[2]);
      push(ghost.samples, {
        t: snap.now,
        x: r.p[0],
        y: r.p[1],
        z: r.p[2],
      });
    }
    for (const ghost of this.rockets) {
      if (ghost.id >= 0 && !this.present.has(ghost.id)) this.release(ghost);
    }
  }

  /**
   * Takes the whole mine table. Slots the message does not name are hidden,
   * which is what makes a re-send correct rather than merely cheap: a mine
   * that went off is simply absent from the next list.
   *
   * `localTeam` decides nothing here — a mine is visible to everybody, exactly
   * as it is offline, and the LAMP is the only tell about whether it will go
   * off. Hiding the other side's would be a fairness rule nothing else in this
   * game makes: the plate is a 34 cm disc in the road, and finding it is the
   * skill.
   */
  applyMines(msg: MinesMessage): void {
    for (const m of this.mines) {
      if (m.mesh.isEnabled()) m.mesh.setEnabled(false);
      m.lamp.isVisible = false;
    }
    this.laid.clear();
    for (const state of msg.mines) {
      if (state.by >= 0) this.laid.set(state.by, (this.laid.get(state.by) ?? 0) + 1);
      const mine = this.mines[state.i];
      if (!mine) continue;
      mine.mesh.position.set(state.p[0], state.p[1], state.p[2]);
      mine.mesh.setEnabled(true);
      // Dark until it arms. That is the whole tell, and it is the right way
      // round: what a driver can see is a mine that would go off.
      mine.lamp.isVisible = state.armed;
    }
  }

  /** How many mines `slot` has on the field. `AntiTankSystem.minesFor`'s twin. */
  minesFor(slot: number): number {
    return this.laid.get(slot) ?? 0;
  }

  /**
   * Poses every rocket for `renderTime` — a server-clock instant the caller
   * has already put behind the newest sample.
   *
   * Takes no `dt`, for `NetGrenades.update`'s reason: nothing here integrates
   * against frame time.
   */
  update(renderTime: number): void {
    for (const ghost of this.rockets) {
      if (ghost.id < 0 || ghost.samples.length === 0) continue;
      const [a, b, blend] = bracket(ghost.samples, renderTime);
      const x = a.x + (b.x - a.x) * blend;
      const y = a.y + (b.y - a.y) * blend;
      const z = a.z + (b.z - a.z) * blend;
      ghost.mesh.position.set(x, y, z);
      // Down its own flight, off the direction that arrived rather than off
      // two positions — see `Ghost.dir`. The same `lookAt` the simulated
      // rocket uses, so a remote one and a local one point the same way.
      TMP.set(x + ghost.dir.x, y + ghost.dir.y, z + ghost.dir.z);
      ghost.mesh.lookAt(TMP);
      // Shown on the frame it is first POSED and never on the one it was
      // claimed — `NetGrenades.Ghost.hasPosition`, and the same one-frame
      // flash across the map if it is not done this way.
      if (!ghost.hasPosition) {
        ghost.hasPosition = true;
        // The whole body, motor and fins included, for the reason
        // `AntiTankSystem.launch` uses `setEnabled` rather than `isVisible`.
        ghost.mesh.setEnabled(true);
      }
    }
  }

  /**
   * Drops everything on screen. Called when the round under it changes — a
   * flight whose map has been rebuilt is one nothing will ever send the end
   * of, and a mine would be waiting under a street that is not there.
   */
  reset(): void {
    for (const ghost of this.rockets) this.release(ghost);
    for (const m of this.mines) {
      m.mesh.setEnabled(false);
      m.lamp.isVisible = false;
    }
    this.laid.clear();
  }

  dispose(): void {
    for (const ghost of this.rockets) ghost.mesh.dispose();
    for (const m of this.mines) m.mesh.dispose();
    this.rockets.length = 0;
    this.mines.length = 0;
    this.live.clear();
  }

  /** The ghost already drawing `id`, or a free one taken for it. */
  private claim(id: number): Ghost | null {
    const held = this.live.get(id);
    if (held) return held;
    const free = this.rockets.find((r) => r.id < 0);
    if (!free) return null;
    free.id = id;
    free.samples.length = 0;
    free.hasPosition = false;
    this.live.set(id, free);
    return free;
  }

  private release(ghost: Ghost): void {
    if (ghost.id >= 0) this.live.delete(ghost.id);
    ghost.id = -1;
    ghost.samples.length = 0;
    ghost.hasPosition = false;
    ghost.mesh.setEnabled(false);
  }
}

/** Scratch for the point a rocket is faced at. Never allocated per frame. */
const TMP = new Vector3();

/** `NetGrenades.push` — see there. */
function push(samples: Sample[], sample: Sample): void {
  const newest = samples[samples.length - 1];
  if (newest && sample.t <= newest.t) return;
  samples.push(sample);
  if (samples.length > BUFFER) samples.shift();
}

/** `NetGrenades.bracket` — clamps at both ends rather than extrapolating. */
function bracket(s: Sample[], t: number): [Sample, Sample, number] {
  if (t <= s[0].t) return [s[0], s[0], 0];
  const last = s[s.length - 1];
  if (t >= last.t) return [last, last, 0];
  for (let i = 0; i < s.length - 1; i++) {
    if (t <= s[i + 1].t) {
      const span = s[i + 1].t - s[i].t;
      return [s[i], s[i + 1], span > 0 ? (t - s[i].t) / span : 0];
    }
  }
  return [last, last, 0];
}
