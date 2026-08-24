/**
 * GlassSystem.ts — The one mutable thing in the world: panes of glass, and what
 * a round crossing one does to them.
 * Owns: which panes are intact, the segment sweep that finds the ones a shot
 * crossed, the break itself (the visual, the collider, the nav graph), and the
 * amortised flow-field rebuild a break owes.
 * Invariants: breaking is MONOTONIC — a pane never mends inside a round, and
 * `setMap` is the only thing that puts them all back, which is exactly right
 * because a round IS a fresh map build and there is no other way to start one.
 * It never decides that a pane broke in a netplay round; the authority does,
 * and this applies what it is told (see `shoot` and `applyBreak`). It holds no
 * reference to any other system.
 *
 * ## Why the sweep is analytic and not a pick
 *
 * A round has to pass THROUGH glass, so a pane may not be in `OPAQUE_ONLY` —
 * which means `CombatSystem`'s wall pick can never report one, whatever the
 * pane's collider says. A second `scene.pickWithRay` per shot would answer it
 * and would also be the most expensive thing on the shot path, and adding the
 * panes to the existing pick would stop every round on the first window it met.
 *
 * So the panes are geometry this system holds, and the question is arithmetic:
 * a segment against an oriented box, bucketed by map block so a shot tests the
 * panes near it and no others. That puts nothing at all on `Player.probeGround`
 * — the game's most expensive per-frame call — nothing on the bots' line of
 * sight, and a bounded handful of slab tests on a shot. It also runs unchanged
 * on the authority, which has the same panes off the collision bake and no
 * scene worth picking against.
 *
 * ## What is in this system, and what is merely glass
 *
 * A pane is here because there is enterable space behind it — that is what
 * `PaneSpec.breakable` declares and the only thing that puts a sheet in
 * `GameMap.panes`. The six thousand sheets of curtain wall and windscreen on
 * Coldharbour are hung on something solid, break nothing open, and are geometry
 * this system has never heard of: they are not swept, not bucketed, not baked
 * and not nameable on the wire. So the whole of this file runs over the two
 * dozen shopfront bays a round can actually open, and the sweep costs what two
 * dozen panes cost.
 *
 * ## The three things a break touches, and the one it defers
 *
 * The VISUAL is a vertex range in a merged mesh: collapsing it onto its own
 * first vertex makes every triangle in the pane degenerate, which draws nothing
 * and takes the outline shell with it (see `MapBuilder.paneGroup`).
 *
 * The COLLIDER is every pane's, because a pane with a room behind it is the
 * only thing in the way while it stands. Clearing `solid` takes it out of both
 * pick predicates in one write; clearing `checkCollisions` takes it out of
 * `moveWithCollisions`; `ObstacleField.remove` takes it out of the sub-cell
 * push-out the bots and the server's move validator both read.
 *
 * The NAV GRAPH is `NavGrid.openBox`, which relinks the ground the pane was
 * severing. That is local and cheap.
 *
 * What is DEFERRED is the flow fields, and they are the only expensive part: a
 * field is a breadth-first sweep over every walkable surface, Coldharbour has
 * ~180k of them and seven fields, so rebuilding the set is tens of
 * milliseconds. `update` rebuilds ONE PER FRAME, and every break inside that
 * window folds into the same pass. Bots keep steering on the field they have,
 * which is stale rather than wrong — monotonicity is what guarantees that: the
 * graph only ever gains links, so a route that was valid still is, and the
 * worst a bot does for those few frames is walk the long way round a window
 * that has just opened.
 */
import type { Mesh, Vector3 } from "@babylonjs/core";
import { VertexBuffer } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { GameMap, WorldPane } from "../world/MapBuilder";
import { BLOCK_SIZE } from "../world/MapBuilder";

/** One pane a segment crossed, and how far along it the crossing was. */
export interface GlassHit {
  pane: number;
  /** Metres from the segment's origin to the pane's near face. */
  dist: number;
}

/**
 * A bucket of panes filed under one map block, with the world AABB of the lot.
 *
 * The AABB is the whole index: there are a few dozen buckets on a map, so a
 * shot tests a few dozen cheap slab rejections and then only the panes in the
 * buckets it actually crossed. A finer grid would be a DDA walk for no gain —
 * glazing is clustered on buildings by construction, which is exactly what a
 * per-block bucket already expresses.
 */
interface PaneBucket {
  panes: number[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export class GlassSystem {
  private map: GameMap | null = null;
  private panes: readonly WorldPane[] = [];
  private buckets: PaneBucket[] = [];
  /** Intact is 0, broken is 1. Indexed by pane. */
  private broken = new Uint8Array(0);
  /**
   * A pane's collider mesh, by pane index. The authority stamps `metadata.pane`
   * itself when it rebuilds its colliders from the bake (see
   * `buildServerWorld`), so this is filled on both sides from the two places
   * that make the same mark.
   */
  private colliders = new Map<number, Mesh>();
  /** Fields owed a rebuild, oldest first. Drained one per frame by `update`. */
  private dirtyFields: string[] = [];

  /**
   * Reusable result buffer. A sweep runs on every shot from every shooter, and
   * the caller reads it and drops it — the same reason `CombatSystem` pools its
   * tracers rather than allocating one per round.
   */
  private readonly hits: GlassHit[] = [];

  /**
   * Called when a pane breaks, whoever decided it. `at` is where the round
   * crossed, `dir` the way it was going — the pair the shards are thrown from.
   * `Game` wires this to the debris and the sound.
   */
  onBreak: (pane: number, at: Vector3, dir: Vector3) => void = () => {};

  /**
   * Takes a freshly built map. Called from `installMap`, which is the only
   * place a `GameMap` is handed out.
   */
  setMap(map: GameMap): void {
    this.map = map;
    this.panes = map.panes;
    this.broken = new Uint8Array(map.panes.length);
    this.dirtyFields = [];
    this.colliders.clear();
    for (const mesh of map.colliders) {
      const pane = mesh.metadata?.pane;
      if (typeof pane === "number") this.colliders.set(pane, mesh);
    }
    this.buckets = bucketPanes(map.panes);
  }

  /** Whether a pane is still standing. Out-of-range reads as broken. */
  intact(pane: number): boolean {
    return pane >= 0 && pane < this.broken.length && this.broken[pane] === 0;
  }

  get brokenPanes(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.broken.length; i++) if (this.broken[i]) out.push(i);
    return out;
  }

  /**
   * The intact panes a segment crosses, nearest first.
   *
   * The returned array is BORROWED and is overwritten by the next call. Read it
   * or copy it before sweeping again.
   */
  sweep(origin: Vector3, dir: Vector3, maxDist: number): GlassHit[] {
    this.hits.length = 0;
    if (this.panes.length === 0) return this.hits;

    const ex = origin.x + dir.x * maxDist;
    const ey = origin.y + dir.y * maxDist;
    const ez = origin.z + dir.z * maxDist;

    for (const bucket of this.buckets) {
      if (
        !segmentHitsAabb(
          origin.x,
          origin.y,
          origin.z,
          ex,
          ey,
          ez,
          bucket.minX,
          bucket.minY,
          bucket.minZ,
          bucket.maxX,
          bucket.maxY,
          bucket.maxZ,
        )
      ) {
        continue;
      }
      for (const i of bucket.panes) {
        if (this.broken[i]) continue;
        const t = segmentHitsPane(this.panes[i], origin, dir, maxDist);
        if (t === null) continue;
        this.hits.push({ pane: i, dist: t });
      }
    }
    this.hits.sort((a, b) => a.dist - b.dist);
    return this.hits;
  }

  /**
   * A round went from `origin` along `dir` for `maxDist`: break what it crossed
   * and report it.
   *
   * **`authoritative` is the whole of the netplay question.** Offline it is
   * true and a break is complete on the spot. In a netplay round the client
   * calls this with it FALSE on its own shot, which is a prediction: the pane
   * disappears and the shards fly immediately, and the collider is left alone
   * until the authority's `glass` event confirms it. That split is what makes
   * predicting safe — the LOOK of a break is the client's to guess and the WAY
   * IN is not. A pane keeps blocking a body for the one round trip it takes to
   * be told, which is not long enough to walk through a window and is the
   * difference between an early break and a client standing in a wall the
   * server still has.
   *
   * Returns the panes it broke, so the caller can put them on the wire.
   */
  shoot(
    origin: Vector3,
    dir: Vector3,
    maxDist: number,
    authoritative: boolean,
  ): number[] {
    const hits = this.sweep(origin, dir, maxDist);
    if (hits.length === 0) return [];
    const broke: number[] = [];
    const limit = Math.min(hits.length, CONFIG.glass.maxPerShot);
    for (let i = 0; i < limit; i++) {
      const { pane, dist } = hits[i];
      const at = origin.add(dir.scale(dist));
      if (this.applyBreak(pane, at, dir, authoritative)) broke.push(pane);
    }
    return broke;
  }

  /**
   * Breaks one pane. Idempotent for the VISUAL half and not for the collider
   * half, which is what lets a predicted break be completed by the authority's
   * event arriving after it.
   *
   * Returns whether this call was the one that took the pane out of the world,
   * so a caller putting breaks on the wire says each one once.
   */
  applyBreak(
    pane: number,
    at: Vector3,
    dir: Vector3,
    authoritative: boolean,
  ): boolean {
    if (pane < 0 || pane >= this.broken.length) return false;
    const first = this.broken[pane] === 0;
    if (first) {
      this.broken[pane] = 1;
      this.collapse(pane);
      this.onBreak(pane, at, dir);
    }
    if (authoritative) this.clearCollider(pane);
    return first;
  }

  /**
   * Applies a break the authority reported, at no particular point.
   *
   * A late joiner is handed a list of panes rather than a list of shots, so
   * there is no crossing point and no direction — and there must be no shards
   * either, or arriving in a room would fill it with glass falling out of
   * windows broken minutes ago. `catchUp` is that: the world state without the
   * event that made it.
   */
  catchUp(panes: readonly number[]): void {
    for (const pane of panes) {
      if (pane < 0 || pane >= this.broken.length) continue;
      if (this.broken[pane] === 0) {
        this.broken[pane] = 1;
        this.collapse(pane);
      }
      this.clearCollider(pane);
    }
  }

  /**
   * Drains one field rebuild per frame.
   *
   * One, not all, and not none: a field is tens of milliseconds' worth of
   * breadth-first sweep and the seven of them together are a visible hitch on a
   * frame budget that already drops one every 1.7 seconds (FINDINGS #1). Spread
   * over seven frames it is invisible, and the staleness in between costs
   * nothing — see this file's header on why a stale field is never a wrong one.
   */
  update(): void {
    if (this.dirtyFields.length === 0 || !this.map) return;
    const name = this.dirtyFields.shift()!;
    this.map.nav.rebuildField(name);
  }

  /** Collapses a pane's vertex range onto its own first vertex. */
  private collapse(pane: number): void {
    const p = this.panes[pane];
    // No group on the authority, which holds panes as geometry and draws none.
    if (p.group < 0 || !this.map) return;
    const group = this.map.paneGroups[p.group];
    if (!group) return;
    const positions = group.mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) return;
    const base = p.vertexStart * 3;
    const x = positions[base];
    const y = positions[base + 1];
    const z = positions[base + 2];
    for (let v = 1; v < p.vertexCount; v++) {
      const o = base + v * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
    }
    group.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
  }

  /**
   * Takes a pane's collider out of the world, and the nav graph with it. A
   * no-op for a pane already cleared, which is what `box.glass` is read for.
   *
   * The `box < 0` guard is the bake's shape rather than a live case. Every
   * pane a builder makes carries its collider's index; a bake old enough to
   * predate that carries -1, and the guard is what keeps this from indexing
   * `colliderBoxes` with it.
   */
  private clearCollider(pane: number): void {
    const map = this.map;
    if (!map) return;
    const p = this.panes[pane];
    if (p.box < 0) return;
    const box = map.colliderBoxes[p.box];
    if (!box || box.glass !== true) return;
    // The flag is what makes this idempotent: an authoritative event arriving
    // after a predicted break, or a `catchUp` over a pane already cleared, must
    // not relink the same ground twice or rebuild seven fields for nothing.
    delete box.glass;

    const mesh = this.colliders.get(pane);
    if (mesh) {
      // `solid` is the one write that matters: it takes the box out of
      // `SOLID_ONLY` and `OPAQUE_ONLY` together, so the ground probe, the death
      // cam's pull-in and the editor's pick all stop seeing it in the same
      // frame. `checkCollisions` is the movement half, which is a separate
      // list. Disabling the mesh is neither — it is what takes it out of the
      // scene's pick loop entirely, which is the cost this feature must not add.
      mesh.metadata.solid = false;
      mesh.checkCollisions = false;
      mesh.setEnabled(false);
    }

    map.obstacles.remove(box);
    // The box is still in `colliderBoxes` — that array is the bake's order and
    // the pane's own `box` index into it, so nothing may be spliced out of it
    // ever. It is filtered here instead, which is the one place a caller needs
    // "the solid world as it stands" rather than "as it was built".
    const standing = map.colliderBoxes.filter((b) => b !== box);
    map.nav.openBox(box, standing);
    for (const name of map.nav.fieldNames) {
      if (!this.dirtyFields.includes(name)) this.dirtyFields.push(name);
    }
  }
}

/** Files panes by map block and measures each bucket's world AABB. */
function bucketPanes(panes: readonly WorldPane[]): PaneBucket[] {
  const byBlock = new Map<string, PaneBucket>();
  for (const [i, p] of panes.entries()) {
    const key = `${Math.floor(p.cx / BLOCK_SIZE)},${Math.floor(p.cz / BLOCK_SIZE)}`;
    // The pane's own reach, generously: the rotated half-diagonal covers any
    // yaw without asking which, and the height is not rotated because a pane
    // has no pitch.
    const reach = Math.hypot(p.w, p.d) / 2;
    let bucket = byBlock.get(key);
    if (!bucket) {
      bucket = {
        panes: [],
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity,
      };
      byBlock.set(key, bucket);
    }
    bucket.panes.push(i);
    bucket.minX = Math.min(bucket.minX, p.cx - reach);
    bucket.maxX = Math.max(bucket.maxX, p.cx + reach);
    bucket.minY = Math.min(bucket.minY, p.cy - p.h / 2);
    bucket.maxY = Math.max(bucket.maxY, p.cy + p.h / 2);
    bucket.minZ = Math.min(bucket.minZ, p.cz - reach);
    bucket.maxZ = Math.max(bucket.maxZ, p.cz + reach);
  }
  return [...byBlock.values()];
}

/** Slab test of a segment against an axis-aligned box. */
function segmentHitsAabb(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const from = [x0, y0, z0];
  const to = [x1, y1, z1];
  const lo = [minX, minY, minZ];
  const hi = [maxX, maxY, maxZ];
  for (let a = 0; a < 3; a++) {
    const d = to[a] - from[a];
    if (Math.abs(d) < 1e-9) {
      if (from[a] < lo[a] || from[a] > hi[a]) return false;
      continue;
    }
    let near = (lo[a] - from[a]) / d;
    let far = (hi[a] - from[a]) / d;
    if (near > far) [near, far] = [far, near];
    if (near > t0) t0 = near;
    if (far < t1) t1 = far;
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Distance along `dir` at which a segment enters the pane, or null if it never
 * does.
 *
 * A three-axis slab test in the pane's own frame. The Y axis is not rotated
 * because a `PaneSpec` carries no pitch — glass in this kit is a sheet in a
 * wall, and a pane that ever tilts owes this function the third rotation as
 * well as the type the second one.
 *
 * The sign convention is `boxGeometry.rotateToLocalXZ`'s, and must stay so: the
 * two describe the same world and a mirrored one of them would break the wrong
 * window on every yawed building on the map.
 */
function segmentHitsPane(
  p: WorldPane,
  origin: Vector3,
  dir: Vector3,
  maxDist: number,
): number | null {
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  const dx = origin.x - p.cx;
  const dz = origin.z - p.cz;
  const ox = dx * c - dz * s;
  const oz = dx * s + dz * c;
  const oy = origin.y - p.cy;
  const vx = dir.x * c - dir.z * s;
  const vz = dir.x * s + dir.z * c;
  const vy = dir.y;

  let t0 = 0;
  let t1 = maxDist;
  const from = [ox, oy, oz];
  const vel = [vx, vy, vz];
  const half = [p.w / 2, p.h / 2, p.d / 2];
  for (let a = 0; a < 3; a++) {
    const v = vel[a];
    const o = from[a];
    const h = half[a];
    if (Math.abs(v) < 1e-9) {
      if (Math.abs(o) > h) return null;
      continue;
    }
    let near = (-h - o) / v;
    let far = (h - o) / v;
    if (near > far) [near, far] = [far, near];
    if (near > t0) t0 = near;
    if (far < t1) t1 = far;
    if (t0 > t1) return null;
  }
  // The round must ENTER the pane, not merely overlap it. `t0 === 0` is a
  // muzzle already inside the glass, which is not a shot through a window. A
  // pane's own collider holds a walking body out of it, but `ObstacleField`'s
  // push-out is a preference and never a veto (see `docs/bots.md`), so a bot
  // shoved against a shopfront can have its muzzle in the sheet — and would
  // otherwise blow out the bay it is standing in the moment it fires down the
  // street. It was reachable more cheaply still when the curtain walls were
  // panes, and the measurement is from then: against a brute-force control over
  // 600 varied shots, this is the only case the two ever disagreed about.
  return t0 > 0 ? t0 : null;
}
