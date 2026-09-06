/**
 * server/validate.ts — Is the position a client just reported physically
 * possible?
 * Owns: the speed, ground and solid checks a BODY takes, the four a HULL takes,
 * and nothing else. It returns a verdict; `Match` decides what to do about it —
 * including which verdicts are refusals and which are lids, a distinction
 * `DriveVerdict` carries and `Verdict` has no need of.
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
 * Why a hull's reported step was not taken as sent.
 *
 * Two of them are REFUSALS — nothing a legitimate client runs can produce
 * either — and two are LIDS an honest pilot presses against every round. That
 * split is the whole of `validateDrive`'s policy, and it is stated in the type
 * because `Match` has to tell a liar from a pilot and the verdict is the only
 * thing that knows.
 */
export type DriveReason = "speed" | "climb" | "ceiling" | "bounds";

/**
 * What to do with one reported hull step.
 *
 * Three outcomes and not two, which is the whole difference between this and
 * `Verdict`: a hull step can be ACCEPTED AT A POSITION THAT IS NOT THE ONE
 * REPORTED. `ok` false is a refusal, `ok` true with `clamped` is "you may be
 * here and no further", and `ok` true without it is the ordinary case.
 *
 * **`x`/`y`/`z` are the position to APPLY** and are filled in on every outcome,
 * so no caller has to work out which of the three it is holding.
 */
export interface DriveVerdict {
  ok: boolean;
  /** Set on a refusal AND on a clamp; undefined only when nothing was wrong. */
  reason?: DriveReason;
  /** True when the position below is not the one that was reported. */
  clamped: boolean;
  x: number;
  y: number;
  z: number;
}

/**
 * How far over its ceiling a machine may be before it is refused any more
 * height, in metres.
 *
 * The flight model does not CLAMP altitude, it fades the commanded climb RATE
 * to nothing across `ceilingBand` — so a machine arriving at the lid under
 * power overshoots it slightly while the arrest runs. The collective is a
 * first-order lag on a proportional approach and settles about ten centimetres
 * past the lid at full stick; this is thirty times that, which leaves room for
 * the float in a position that has been through a socket and for the two sides
 * sampling the terrain one step apart.
 */
const CEILING_ALLOWANCE = 3;

/**
 * Checks one reported HULL step, from the person driving it.
 *
 * **The speed bound that knows what a player is sitting in.** A driver reports
 * where their tank ended up exactly as a body reports where it walked to, and
 * running that through `validateMove` would reject every honest driver in the
 * game at a stroke: the bound there is a sprint, and a tank at road speed
 * covers three times it.
 *
 * What is checked is the speed, the climb, the map's extent and the ceiling,
 * and that is deliberately all — the other two tests a body takes are wrong for
 * a hull rather than merely expensive:
 *
 *   - **No ground test.** `Vehicle.updateRemote` stands the reported hull on its
 *     own ten track contacts on THIS side, against the same colliders the
 *     driver used, so the authority never takes a client's word for a height
 *     in the first place. There is nothing left for a claim to be wrong about.
 *   - **No solid test.** A hull legitimately stands inside `map.obstacles`: it
 *     drives OVER the fences, the crates and the saplings a body has to walk
 *     around, which is what `climbHeight` is for. `resolve` would push it out
 *     of every one of them and read the push as a player standing in a wall.
 *
 * **THE FOUR CHECKS ARE NOT ONE KIND OF CHECK, and reading them as one cost a
 * round.** Speed and climb are things no legitimate client can produce, so they
 * are REFUSED. The extent and the ceiling are rules of the world the client
 * enforces too and presses against on purpose — a pilot holding the stick out
 * over the sea, a pilot at the top of the envelope — so they are LIDS: the step
 * is accepted at the boundary and `Match` tells the client where it actually
 * is.
 *
 * Refusing those two was the bug, and what made it unrecoverable is that a
 * refusal used to be SILENT. The driver's own hull is the one thing on a client
 * that is never posed from the wire — `Game.vehicleOrders.remoteFor` answers
 * null for it, which is the prediction — so nothing pulled the two copies back
 * together, and the next sample was measured against an authority hull that had
 * stopped moving. One refusal therefore latched: every later step failed the
 * speed bound by construction, and the pilot flew a ghost the authority had
 * parked, captured nothing, could not dismount, and was snapped across the map
 * by the first thing that took them out of the driver's chair.
 *
 * What that leaves uncovered is a driver who cheats within the tolerance, and
 * it is the same acceptance the body's check makes for the same reason — with
 * one thing in its favour here: a hull is the most conspicuous object on the
 * map, and it cannot go anywhere fifteen other people are not watching.
 *
 * **The verdict is a SHARED object** — `SCRATCH`'s rule one line down and for
 * the same reason. Read what you need from it before calling again.
 */
export function validateDrive(
  map: GameMap,
  from: Vector3,
  to: { x: number; y: number; z: number },
  dt: number,
  /**
   * The fastest THIS hull can legitimately travel, in m/s — its own
   * `VehicleSpec.drive.maxSpeed`, ahead rather than in reverse because the
   * check is on distance covered and has no opinion about which way the
   * vehicle was pointing.
   *
   * **Passed in rather than taken as the fastest kind on the map**, which is
   * the bound this used to be: with one kind that was the same number, and with
   * two it would hand every tank driver the truck's 18 m/s and a third of the
   * bound's whole point away. The caller has the hull in hand and its speed is
   * a fact about it.
   */
  maxSpeed: number,
  /**
   * The fastest this hull can GAIN HEIGHT under its own power, in m/s — a
   * rotor's own climb rate, or, on a tracked hull, what riding a grade up gives
   * it plus what `launchSpeed` lets it carry off the crest.
   *
   * `Vehicle.climbRate` resolves it once per hull, for the reason `maxSpeed` is
   * passed rather than assumed: the caller has the hull in hand and this is a
   * fact about it.
   */
  maxClimb: number,
  /**
   * How far over the heightfield this hull may CLIMB, or **null for one that
   * cannot leave the ground** — where the answer is "as high as the map goes",
   * and a map is full of legitimate high ground the field knows nothing about.
   * `validateMove`'s own note on its air allowance is the argument.
   *
   * **It bounds a climb and not an altitude**, which is the correction the
   * ceiling term below is written around.
   */
  ceiling: number | null,
): DriveVerdict {
  const v = DRIVE;
  v.ok = true;
  v.reason = undefined;
  v.clamped = false;
  v.x = to.x;
  v.y = to.y;
  v.z = to.z;

  // --- speed: a REFUSAL ---
  // Nothing running the drive model covers this much ground in one step, so a
  // sample that does is a claim rather than a mistake.
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) > maxSpeed * SPEED_TOLERANCE * dt) {
    v.ok = false;
    v.reason = "speed";
    return v;
  }

  // --- the climb: a REFUSAL, and the same statement one axis up ---
  // A tracked hull's climb is what riding a grade up gives it plus what it may
  // carry off the crest, and the tolerance leaves it 65% of headroom over the
  // fastest rise the limiter in `standOnGround` can actually produce — so this
  // has never been able to refuse a legitimate tank, and it is stated for every
  // kind rather than for the one that needed it.
  //
  // **The DESCENT is deliberately not bounded**, which is the same acceptance
  // the body's own check makes on the same axis: falling is gravity's, a client
  // frame that ran long legitimately covers a lot of it, and a hull claiming to
  // have fallen is claiming to be somewhere lower than it was — which is not a
  // thing anybody cheats to do.
  if (to.y - from.y > maxClimb * SPEED_TOLERANCE * dt) {
    v.ok = false;
    v.reason = "climb";
    return v;
  }

  // --- the extent: a LID ---
  // The same reach a body is held to and for the same reason: past the
  // borderland there is no floor, no nav cell and four boundary colliders in
  // the way. A tank is not leashed — the nav graph and the hardstandings are
  // both inside the play square — but nothing here needs to know that, because
  // "there is nothing out there" is true whatever claims to be standing in it.
  //
  // Clamped rather than refused because a HELICOPTER reaches it in ordinary
  // flight: an island map runs its sea the better part of a kilometre past this
  // line, and the only thing that has ever stopped a pilot crossing it is the
  // leash, which is a countdown rather than a wall. This is the wall, and the
  // pilot is told about it on the sample they touch it rather than by being
  // quietly detached from the round.
  const half = map.size / 2 + map.margin;
  if (Math.abs(v.x) > half) {
    v.x = Math.sign(v.x) * half;
    v.clamped = true;
    v.reason = "bounds";
  }
  if (Math.abs(v.z) > half) {
    v.z = Math.sign(v.z) * half;
    v.clamped = true;
    v.reason = "bounds";
  }

  // --- the ceiling: a LID, and the one that has to be read carefully ---
  //
  // **`flight.ceiling` bounds a RATE and not a HEIGHT**, which is what an
  // altitude test gets wrong about it. The model fades the commanded climb to
  // nothing as the machine approaches its ceiling and never pulls the machine
  // down, so a helicopter cruising at the top of its envelope and crossing
  // ground that falls away — a ridge, a caldera wall, a coastline — is
  // legitimately far higher over the floor than `ceiling` and has done nothing
  // at all to get there. "No higher than `ceiling` over the heightfield" calls
  // that a cheat, and on a map whose floor runs from a volcanic apron down to a
  // sea bed it calls it a cheat within seconds of taking off.
  //
  // What IS true of the model is that a machine over its ceiling cannot GAIN
  // height, because the fade is zero up there. That is terrain-INDEPENDENT,
  // which is exactly what the altitude form was not: over flat ground it pins a
  // machine at its ceiling, and over falling ground it lets the gap open as
  // fast as the ground drops without ever refusing anything.
  //
  // Asked at `from` — the last place this hull actually WAS — so the rule is
  // asked about somewhere the authority agrees exists rather than about the
  // position being claimed. And it FREEZES the height rather than pulling it
  // down to the lid: a machine that is over its ceiling because the seabed went
  // past underneath it would be yanked out of the sky by a clamp toward the
  // floor, which is the failure this whole term exists to avoid.
  if (
    ceiling !== null &&
    v.y > from.y &&
    from.y - map.terrain.surfaceAt(from.x, from.z) > ceiling + CEILING_ALLOWANCE
  ) {
    v.y = from.y;
    v.clamped = true;
    v.reason = "ceiling";
  }

  return v;
}

/**
 * The verdict `validateDrive` hands back, reused so the path that runs at
 * `INPUT_HZ` per driver allocates nothing — `SCRATCH`'s rule below, and
 * `HeadlessGame.applyDrive`'s, which writes into the object `remoteFor` has
 * already handed out for the same reason.
 */
const DRIVE: DriveVerdict = {
  ok: true,
  reason: undefined,
  clamped: false,
  x: 0,
  y: 0,
  z: 0,
};

/**
 * Reused so validation allocates nothing per player per tick.
 *
 * A real `Vector3` and not a `{x, y, z}` literal: `ObstacleField.resolve`
 * writes through `.set`, and a plain object silently has no such method.
 */
const SCRATCH = new Vector3();
