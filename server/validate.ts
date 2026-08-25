/**
 * server/validate.ts — Is the position a client just reported physically
 * possible?
 * Owns: the speed, ground and solid checks, and nothing else. It returns a
 * verdict; `Match` decides what to do about it.
 * Invariants: pure and allocation-free — it runs once per player per input tick
 * and must not become a place that touches sockets, rosters or rounds.
 *
 * This is what we bought instead of input replay. Clients simulate their own
 * `Player` exactly as they do offline and report where they ended up, which
 * costs nothing on the client and no refactor of `Player.update` — and the
 * price is that the server has to say what "impossible" means rather than
 * simply recomputing the answer. Three cheats are worth stopping and each has a
 * check here:
 *
 *   - **speedhack** — covering more ground than the fastest legal stance could
 *   - **teleport** — the degenerate case of the same check, over one tick
 *   - **noclip** — standing where the map is solid, or off the floor entirely
 *
 * What it deliberately does NOT stop is a player who cheats *within* tolerance:
 * someone moving at 1.19x sprint forever is invisible to this. That is the
 * accepted cost of trusting movement, and the tolerance below is the dial. It
 * is set for false negatives over false positives on purpose — a legitimate
 * player yanked backwards by a bad rejection has a worse experience than
 * everyone has from a cheat that buys 19% speed.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../src/config";
import type { GameMap } from "../src/world/MapBuilder";

export type RejectReason = "speed" | "ground" | "solid";

export interface Verdict {
  ok: boolean;
  reason?: RejectReason;
}

const OK: Verdict = { ok: true };

/**
 * Headroom on the speed check.
 *
 * A client's step is its own frame time, which is neither the server's tick nor
 * constant: a browser that stalls for 200 ms and then resumes legitimately
 * covers 200 ms of ground in one sample. The margin absorbs that, plus the
 * slope bonus of running downhill and the rounding in a float position that has
 * been through a socket.
 */
const SPEED_TOLERANCE = 1.35;

/** How far above the floor a player may legitimately be, in metres. */
const AIR_ALLOWANCE = 6;

/** How far below it before they have fallen through the world. */
const SINK_ALLOWANCE = 1.5;

/**
 * The fastest a player can legitimately travel, in m/s.
 *
 * Sprint is the only stance that beats a plain walk, and ADS and crouch are
 * both slower — so the ceiling is the sprint multiplier and nothing else needs
 * enumerating. Read from `CONFIG` rather than written out, so a balance change
 * to movement speed cannot silently turn every player into a suspected cheat.
 */
const MAX_SPEED = CONFIG.player.moveSpeed * CONFIG.player.sprintMult;

/**
 * Checks one reported step.
 *
 * `dt` is the elapsed CLIENT time between this sample and the last accepted
 * one. It is clamped by the caller — a client that claims a huge `dt` would
 * otherwise buy itself a proportionally huge legal step, which is the obvious
 * way to dress a teleport up as a lag spike.
 */
export function validateMove(
  map: GameMap,
  from: Vector3,
  to: { x: number; y: number; z: number },
  dt: number,
): Verdict {
  // --- speed ---
  // Horizontal only. Vertical travel is gravity and jumping, whose bounds are
  // the ground check's business, and folding the two together would make a
  // legitimate fall down the terrace read as a speedhack.
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const travelled = Math.hypot(dx, dz);
  const allowed = MAX_SPEED * SPEED_TOLERANCE * dt;
  if (travelled > allowed) return { ok: false, reason: "speed" };

  // --- inside the world at all ---
  //
  // The BOUNDARY's extent, which is the play square's plus the borderland on a
  // map whose edge is open. Being outside the play square is not a cheat there
  // and must not be treated as one: it is ordinary ground with ordinary floor
  // under it, and what a player standing on it is doing is running out of time
  // — the leash's business, in `HeadlessGame`, and nothing to do with whether
  // the step they just reported was possible. Past the borderland there is
  // genuinely nothing: no floor, no nav cell and four boundary colliders in
  // the way, so a position out there is a claim about a place that does not
  // exist.
  const play = map.size / 2;
  const half = play + map.margin;
  if (Math.abs(to.x) > half || Math.abs(to.z) > half) {
    return { ok: false, reason: "solid" };
  }
  // Outside the play square but legally so — the borderland. Kept for the
  // height test below, which is the one check that has to know the difference.
  const outsidePlay = Math.abs(to.x) > play || Math.abs(to.z) > play;

  // --- ground ---
  // The floor under the point, from the same `TerrainField` the client's own
  // ground probe reads. A player may be well above it (a jump, a roof, the
  // watchtower) but never appreciably below it.
  const floor = map.terrain.heightAt(to.x, to.z);
  if (to.y < floor - SINK_ALLOWANCE) return { ok: false, reason: "ground" };

  // A ceiling on how high above the terrain a player may be is NOT checked
  // here, and must not be: the map is full of legitimate high ground that the
  // heightfield knows nothing about — roofs, the gatehouse, the trestle. The
  // `AIR_ALLOWANCE` above the nearest walkable SURFACE is the meaningful test,
  // and the nav graph is what knows where those are.
  const surface = map.nav.surfaceAt(to.x, to.y, to.z);
  if (surface >= 0) {
    const standing = map.nav.heightOf(surface);
    if (to.y > standing + AIR_ALLOWANCE) return { ok: false, reason: "ground" };
  } else if (outsidePlay) {
    // **The borderland has no nav cells, so it would otherwise have no ceiling
    // at all.** The graph is built over the play square and `surfaceAt` answers
    // -1 everywhere past it, which lands a player standing out there in this
    // `else` — and the branch above is the only test bounding how high a client
    // may claim to be. Out here the floor is the only thing there IS to stand
    // on: the borderland is bare pasture by construction, no roof, no deck and
    // nothing built, which makes the heightfield plus the same allowance exactly
    // the right ceiling rather than an approximation of one.
    //
    // **It is gated on being genuinely OUTSIDE and not merely on `-1`**, which
    // is the whole reason this is an extra term rather than the obvious `else`:
    // inside the square a `-1` is the case the comment above exists for — a
    // roof, a gatehouse, a trestle, legitimate high ground the graph did not
    // record — and applying a heightfield ceiling to those would reject honest
    // players for standing on the map.
    //
    // What it is worth is small and it is worth taking anyway. The leash kills
    // anyone out here inside ten seconds whatever altitude they claim, so the
    // hole was bounded before this line existed; what it costs is one compare on
    // a branch almost nobody takes.
    if (to.y > floor + AIR_ALLOWANCE) return { ok: false, reason: "ground" };
  }

  // --- solid ---
  // Sub-cell collision, the same structure the bots are pushed out of props
  // with. `resolve` reports whether the point had to move to be legal; if it
  // did, the client is standing inside something.
  const out = SCRATCH;
  const pushed = map.obstacles.resolve(to.x, to.y, to.z, CONFIG.nav.bodyRadius, out);
  if (pushed) {
    const slipped = Math.hypot(out.x - to.x, out.z - to.z);
    // A small push-out is ordinary — a player brushing a crate is inside its
    // radius by centimetres all the time, and `ObstacleField`'s own contract
    // calls the push a preference rather than a veto. Only a deep one means
    // somebody is standing in a wall.
    if (slipped > CONFIG.nav.bodyRadius) return { ok: false, reason: "solid" };
  }

  return OK;
}

/**
 * The fastest a HULL can legitimately travel, in m/s.
 *
 * Ahead rather than in reverse, because the check is on distance covered and
 * has no opinion about which way the tank was pointing. It is an order of
 * magnitude over a body's walk, which is exactly why a driver may not be
 * judged by `validateMove` — see `validateDrive`.
 */
const MAX_HULL_SPEED = CONFIG.vehicles.tank.drive.maxSpeed;

/**
 * Checks one reported HULL step, from the person driving it.
 *
 * **The speed bound that knows what a player is sitting in.** A driver reports
 * where their tank ended up exactly as a body reports where it walked to, and
 * running that through `validateMove` would reject every honest driver in the
 * game at a stroke: the bound there is a sprint, and a tank at road speed
 * covers three times it.
 *
 * What is checked is the speed and the map's extent, and that is deliberately
 * all — the other two tests a body takes are wrong for a hull rather than
 * merely expensive:
 *
 *   - **No ground test.** `Tank.updateRemote` stands the reported hull on its
 *     own ten track contacts on THIS side, against the same colliders the
 *     driver used, so the authority never takes a client's word for a height
 *     in the first place. There is nothing left for a claim to be wrong about.
 *   - **No solid test.** A hull legitimately stands inside `map.obstacles`: it
 *     drives OVER the fences, the crates and the saplings a body has to walk
 *     around, which is what `climbHeight` is for. `resolve` would push it out
 *     of every one of them and read the push as a player standing in a wall.
 *
 * What that leaves uncovered is a driver who cheats within the tolerance, and
 * it is the same acceptance the body's check makes for the same reason — with
 * one thing in its favour here: a hull is the most conspicuous object on the
 * map, and it cannot go anywhere fifteen other people are not watching.
 */
export function validateDrive(
  map: GameMap,
  from: Vector3,
  to: { x: number; y: number; z: number },
  dt: number,
): Verdict {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) > MAX_HULL_SPEED * SPEED_TOLERANCE * dt) {
    return { ok: false, reason: "speed" };
  }
  // The same extent a body is held to, and for the same reason: past the
  // borderland there is no floor, no nav cell and four boundary colliders in
  // the way. A tank is not leashed — the nav graph and the hardstandings are
  // both inside the play square — but nothing here needs to know that, because
  // "there is nothing out there" is true whatever is claiming to be standing
  // in it.
  const half = map.size / 2 + map.margin;
  if (Math.abs(to.x) > half || Math.abs(to.z) > half) {
    return { ok: false, reason: "solid" };
  }
  return OK;
}

/**
 * Reused so validation allocates nothing per player per tick.
 *
 * A real `Vector3` and not a `{x, y, z}` literal: `ObstacleField.resolve`
 * writes through `.set`, and a plain object silently has no such method.
 */
const SCRATCH = new Vector3();
