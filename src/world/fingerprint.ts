/**
 * fingerprint.ts — A compact, comparable summary of a built world.
 * Owns: what "the same map" means when two processes build one and have to
 * agree. Read by `server/parity.ts` and by the browser half of
 * `scripts/check-world-parity.mjs`.
 * Invariants: pure — takes a `GameMap`, allocates a small object, touches
 * nothing. It must stay runnable in both a browser and a NullEngine process,
 * so no DOM and no rendering. Every field must be deterministic: anything
 * seeded from `Math.random()` or from frame timing would make two correct
 * builds disagree and turn this from a check into noise.
 *
 * It fingerprints the DERIVED structures, not the inputs. Comparing collider
 * counts would pass while every box sat a metre to the left; the nav graph is
 * downstream of every box's position, size and rotation, so a graph that
 * matches means the geometry did.
 */
import type { GameMap } from "./MapBuilder";

/** A stable, order-independent hash of a numeric array. */
function hashNumbers(values: ArrayLike<number>): string {
  // FNV-1a over the rounded values. Rounding matters: these are floats that
  // have been through a matrix or two, and the last bits of a double differ
  // between two arithmetically identical paths often enough to be useless as
  // an equality test. A millimetre is far finer than anything gameplay reads.
  let h = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) {
    const v = Math.round(values[i] * 1000) | 0;
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** What two builds of the same map must agree on. */
export interface WorldFingerprint {
  boxes: number;
  /**
   * How many of those stop a body but not a round (`BoxSpec.porous`).
   *
   * Counted rather than inferred from anything else because it is the one
   * property of a box the nav graph is blind to — a fence is a fence to the
   * flood fill whether rounds go through it or not, so every other field here
   * would match while the server ate shots the client watched land. It is also
   * the field most able to go stale on its own: `sourceHash` covers a map's
   * `layout.ts` and `heights.ts`, and this flag is declared in a BUILDER.
   */
  porousBoxes: number;
  /**
   * The ray-only geometry, which the nav graph is blind to for the same reason
   * and more completely — a `strut` emits no `WorldBox` at all.
   *
   * Both the group count and a hash over the boxes themselves, because the two
   * catch different faults: the count catches a bake that predates the flag or
   * a server that dropped the groups, and the hash catches timber standing
   * somewhere else from where the client draws it. `groups` matters on its own
   * because grouping decides how the geometry is merged, and a server that
   * merged them differently would pick against the same triangles with a
   * different bounding box.
   */
  rayGroups: number;
  rayBoxes: number;
  rayHash: string;
  /**
   * The clustering of the SOLID boxes — how many merged collider meshes a
   * scatter region's props were gathered into, and which boxes went into each.
   *
   * The nav graph is blind to this one too, and completely: a cluster changes
   * nothing about the world, only how many bounding tests a ray pays to meet
   * it. That is precisely why it belongs here — a server that ignored
   * `boxGroups` would agree with the client about every box on the map and
   * quietly do hundreds of times the picking work per shot, with nothing
   * visible on either side to say so.
   */
  boxGroups: number;
  boxGroupHash: string;
  /**
   * The glazing that can BREAK: how many panes, and where they all are.
   *
   * Not how much glass is drawn — a sheet with something solid behind it is
   * never in `GameMap.panes` and never in the bake (see `PaneSpec.breakable`),
   * so what this counts is the openings, and Coldharbour's two dozen shopfront
   * bays are all of them.
   *
   * Here for `porousBoxes`' reason taken further. A pane's index is its NAME on
   * the wire, so two sides that built the same glass in a different order would
   * agree on every other field in this object and break different windows —
   * and, since every pane carries the collider that holds a body out of it,
   * would disagree about which shopfront a body may walk through, which the
   * move validator turns into a player snapped back through a wall they can see
   * is broken. The hash is order-dependent for exactly that reason, and `box`
   * is in it: a pane whose collider index moved names a different way in.
   *
   * Like `porousBoxes` this is declared in a BUILDER, so `sourceHash` — which
   * covers `layout.ts` and `heights.ts` — cannot notice it going stale. Re-run
   * `npm run collision` by hand after touching one.
   */
  panes: number;
  paneHash: string;
  /** Nav surfaces — a (cell, height) pair each, so this counts geometry. */
  surfaces: number;
  walkable: number;
  navDim: number;
  /** Hashes over the graph's own arrays. */
  heights: string;
  counts: string;
  walkableMask: string;
  links: string;
  /** Total collider volume, as a coarse independent cross-check. */
  volume: number;
}

export function worldFingerprint(map: GameMap): WorldFingerprint {
  const snap = map.nav.debugSnapshot();
  let volume = 0;
  let porous = 0;
  for (const b of map.colliderBoxes) {
    volume += b.w * b.h * b.d;
    if (b.porous) porous++;
  }

  // Order-dependent on purpose: two sides that built the same timber in a
  // different order have merged it into different meshes.
  const ray: number[] = [];
  for (const group of map.rayGroups) {
    ray.push(group.length);
    for (const b of group) ray.push(b.w, b.h, b.d, b.cx, b.cy, b.cz, b.rotX, b.rotY);
  }

  // The grouping alone: the boxes themselves are already covered by the nav
  // graph and the volume, so what is left to disagree about is which of them
  // share a mesh.
  const groups: number[] = [];
  for (const group of map.boxGroups) {
    groups.push(group.length, ...group);
  }

  // Order-dependent for a sharper reason than the timber's: a pane's position
  // in this list is what a `glass` event on the wire names it by. `box` is in
  // the hash because it is the collider a break has to clear, and two sides
  // pointing at different boxes agree about the window and not about the wall.
  const panes: number[] = [];
  for (const p of map.panes) {
    panes.push(p.w, p.h, p.d, p.cx, p.cy, p.cz, p.rotY, p.box);
  }

  return {
    boxes: map.colliderBoxes.length,
    porousBoxes: porous,
    rayGroups: map.rayGroups.length,
    rayBoxes: (ray.length - map.rayGroups.length) / 8,
    rayHash: hashNumbers(ray),
    boxGroups: map.boxGroups.length,
    boxGroupHash: hashNumbers(groups),
    panes: map.panes.length,
    paneHash: hashNumbers(panes),
    surfaces: map.nav.surfaceCount,
    walkable: map.nav.walkableCount,
    navDim: snap.dim,
    heights: hashNumbers(snap.heights),
    counts: hashNumbers(snap.counts),
    walkableMask: hashNumbers(snap.walkable),
    links: hashNumbers(snap.links),
    volume: Math.round(volume * 1000) / 1000,
  };
}
