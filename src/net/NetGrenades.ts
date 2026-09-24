/**
 * net/NetGrenades.ts — Somebody else's grenades, drawn from the wire.
 * Owns: a fixed pool of grenade visuals, the interpolation buffer behind each,
 * and which wire flight each one is currently drawing.
 * Owns NO ballistics: nothing here is integrated, nothing bounces, nothing
 * detonates and nothing is damaged. It is `NetSoldier`'s job done for the one
 * object in this game that is not hitscan — everything it shows was decided by
 * the authority, and it is drawn on the same clock, `CONFIG.net.interpDelay`
 * behind the newest snapshot.
 * Invariants: the pool is built once and never resized, and it is exactly the
 * size of the authority's own grenade pool, so a client can never be told
 * about a flight it has no mesh for. A grenade drawn here is dressing with a
 * timer, the same as one thrown locally — see `GrenadeModel`.
 *
 * **The local player's own throw is not in here**, and that is a filter rather
 * than an omission: `Game.releaseGrenade` puts a real grenade in the local
 * `GrenadeSystem` on the frame the hand opens, which is what the thrower
 * watches arc, and the authority's copy of that same throw comes back with
 * their slot on it a round trip later. Drawing both would be two grenades for
 * one throw, a tenth of a second apart.
 *
 * A grenade that stops appearing in snapshots has gone off, and it is hidden
 * on the snapshot that drops it rather than played out to the end of its
 * buffer. That is deliberate: `Match` flushes the `explode` event on the same
 * broadcast, so the two arrive together and the grenade vanishes on the frame
 * the fireball appears. The cost is the last `interpDelay` of arc — nothing at
 * all for the ordinary detonation, which happens on a grenade that has already
 * come to rest, and a stride's worth for one caught still bouncing. Playing
 * the tail out instead would draw a grenade flying through the middle of its
 * own explosion.
 *
 * A MOLOTOV is drawn by the same ghost with a bottle in place of the frag
 * (`GrenadeState.k`), and it ends the same way: it stops appearing on the
 * snapshot that carries the `blaze` event, and the fire is `GrenadeSystem`'s
 * to draw from there.
 */
import { Mesh, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { buildGrenade, pipLit } from "../entities/GrenadeModel";
import {
  buildMolotov,
  showMolotov,
  type MolotovMeshes,
} from "../entities/MolotovModel";
import type { ThrowableId } from "../entities/throwables";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { Snapshot } from "./protocol";

/** One received sample, with the server time it describes. */
interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  fuse: number;
}

/** How many samples to keep. Two is the minimum to interpolate; more absorbs jitter. */
const BUFFER = 8;

/** One pool entry: the meshes, and the flight it is drawing. */
interface Ghost {
  readonly mesh: Mesh;
  readonly pip: Mesh;
  /** The bottle, for a flight the wire says is a molotov. */
  readonly bottle: MolotovMeshes;
  /** Which of the two this flight is — decided when it is claimed. */
  kind: ThrowableId;
  /** The wire's flight id, or -1 while the slot is free. */
  id: number;
  readonly samples: Sample[];
  /**
   * False until this ghost has been POSED, which is what its visibility is
   * keyed off as well as the tumble.
   *
   * A slot is claimed on a socket callback and posed on the next frame, so a
   * ghost shown when it was claimed is a ghost drawn for one frame at
   * whatever the pool last left it at — the origin for a slot nobody has used,
   * and the point the PREVIOUS grenade in it went off for one that has. Both
   * read as a grenade flashing somewhere across the map, which at 60 fps is
   * one frame and is still the kind of thing an eye catches.
   */
  hasPosition: boolean;
}

export class NetGrenades {
  private readonly pool: Ghost[] = [];
  /** Flight id -> the ghost drawing it. Only ever holds claimed slots. */
  private readonly live = new Map<number, Ghost>();
  /** Which flights this snapshot mentioned. Reused; never a fresh Set per snapshot. */
  private readonly present = new Set<number>();

  constructor(scene: Scene, mats: CelMaterialFactory) {
    for (let i = 0; i < CONFIG.grenade.poolSize; i++) {
      const { mesh, pip } = buildGrenade(scene, mats, `netGrenade${i}`);
      this.pool.push({
        mesh,
        pip,
        bottle: buildMolotov(scene, mats, `netMolotov${i}`),
        kind: "frag",
        id: -1,
        samples: [],
        hasPosition: false,
      });
    }
  }

  /**
   * Takes a snapshot's grenades: a sample for every flight still in the air,
   * and the end of every one that is not.
   *
   * `localSlot` is this client's own roster slot, and the flights it threw are
   * skipped — see the header. It is passed in rather than kept because
   * `NetSession` is the one place that number is authoritative, and a second
   * copy here would be one that could disagree across a reconnect.
   */
  applySnapshot(snap: Snapshot, localSlot: number): void {
    this.present.clear();
    for (const g of snap.grenades ?? []) {
      if (g.by === localSlot) continue;
      const ghost = this.claim(g.i);
      // A pool with nothing free draws nothing rather than stealing a live
      // slot, the same refusal `GrenadeSystem` makes — except that it cannot
      // happen: this pool is the authority's own size, and the authority
      // cannot have more grenades in the air than its pool holds.
      if (!ghost) continue;
      // Anything the field does not name as a bottle is a frag, which is what
      // an older server — and a frag — sends: nothing.
      if (ghost.samples.length === 0) ghost.kind = g.k === "molotov" ? "molotov" : "frag";
      this.present.add(g.i);
      push(ghost.samples, {
        t: snap.now,
        x: g.p[0],
        y: g.p[1],
        z: g.p[2],
        fuse: g.fuse,
      });
    }

    for (const ghost of this.pool) {
      if (ghost.id >= 0 && !this.present.has(ghost.id)) this.release(ghost);
    }
  }

  /**
   * Poses every live grenade for `renderTime` — a server-clock instant the
   * caller has already put behind the newest sample.
   *
   * Takes no `dt`, for the reason `NetSoldier.update` gives: nothing here
   * integrates against frame time. The tumble is driven by the ground actually
   * covered between frames, which already carries the time, so a rolling
   * grenade rolls and a resting one is still at any frame rate.
   */
  update(renderTime: number): void {
    const g = CONFIG.grenade;
    for (const ghost of this.pool) {
      if (ghost.id < 0 || ghost.samples.length === 0) continue;
      const [a, b, blend] = bracket(ghost.samples, renderTime);
      const x = a.x + (b.x - a.x) * blend;
      const y = a.y + (b.y - a.y) * blend;
      const z = a.z + (b.z - a.z) * blend;
      const fuse = a.fuse + (b.fuse - a.fuse) * blend;

      const bottle = ghost.kind === "molotov";
      const body = bottle ? ghost.bottle.mesh : ghost.mesh;
      const stepped = ghost.hasPosition
        ? Vector3.Distance(body.position, TMP.set(x, y, z))
        : 0;
      body.position.set(x, y, z);
      // Shown on the frame it is first POSED and never on the one it was
      // claimed — see `Ghost.hasPosition`.
      if (!ghost.hasPosition) {
        ghost.hasPosition = true;
        if (bottle) showMolotov(ghost.bottle, true);
        else ghost.mesh.isVisible = true;
      }
      // The same rates the simulated flight tumbles at, read off distance
      // instead of speed — one is the other times the frame.
      body.rotation.x += stepped * (bottle ? 0.9 : 2.4);
      body.rotation.z += stepped * (bottle ? 0.25 : 1.7);
      // A bottle's rag is its tell and is always lit; only a frag has a fuse.
      if (!bottle) ghost.pip.isVisible = pipLit(fuse / g.fuse);
    }
  }

  /**
   * Drops every grenade on screen. Called when the round under them changes —
   * a flight whose map has been rebuilt is one nothing will ever send the end
   * of, and it would hang in the air over the next round's terrain.
   */
  reset(): void {
    for (const ghost of this.pool) this.release(ghost);
  }

  dispose(): void {
    for (const ghost of this.pool) {
      ghost.pip.dispose();
      ghost.mesh.dispose();
      // The neck, the cloth and the wick are its children and go with it.
      ghost.bottle.mesh.dispose();
    }
    this.pool.length = 0;
    this.live.clear();
  }

  /** The ghost already drawing `id`, or a free one taken for it. */
  private claim(id: number): Ghost | null {
    const held = this.live.get(id);
    if (held) return held;
    const free = this.pool.find((n) => n.id < 0);
    if (!free) return null;
    free.id = id;
    free.samples.length = 0;
    free.hasPosition = false;
    // Some attitude to start from, so twenty grenades are not all facing the
    // same way. `Math.random` is fine here for the reason `GrenadeSystem` uses
    // it in the same place: this is an effect, not world building — nothing
    // navigates by it and no other client has to reproduce it.
    free.mesh.rotation.set(
      Math.random() * 3,
      Math.random() * 3,
      Math.random() * 3,
    );
    free.bottle.mesh.rotation.copyFrom(free.mesh.rotation);
    this.live.set(id, free);
    return free;
  }

  private release(ghost: Ghost): void {
    if (ghost.id >= 0) this.live.delete(ghost.id);
    ghost.id = -1;
    ghost.samples.length = 0;
    ghost.hasPosition = false;
    ghost.mesh.isVisible = false;
    ghost.pip.isVisible = false;
    showMolotov(ghost.bottle, false);
  }
}

/** Scratch for the distance the tumble reads. Never allocated per frame. */
const TMP = new Vector3();

/**
 * Appends a sample, dropping anything that is not newer than what is already
 * held. A WebSocket does not reorder, but a reconnect can replay an older
 * tick, and one stale sample in the middle of the buffer drags a grenade
 * backwards through its own arc.
 */
function push(samples: Sample[], sample: Sample): void {
  const newest = samples[samples.length - 1];
  if (newest && sample.t <= newest.t) return;
  samples.push(sample);
  if (samples.length > BUFFER) samples.shift();
}

/**
 * The two samples `t` falls between, and how far between them it is. Clamps at
 * both ends rather than extrapolating — `NetSoldier.bracket`'s rule, and for
 * the same reason: a grenade that keeps flying because its packets stopped is
 * one that has to be yanked back when they resume.
 */
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
