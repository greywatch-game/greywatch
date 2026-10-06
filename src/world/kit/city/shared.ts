/**
 * kit/city/shared.ts — What every stacked building in the downtown set is
 * measured by: the storey, the slab, the wall, the grade and the landing, the
 * ground floor's lift, the narrowest doorway the nav grid keeps, `laneFlight`
 * (the stair lane the office and the shophouse climb on) and the two face
 * masks. Part of the downtown set: follows the contract in kit/core.ts and the
 * set's four rules in `./index.ts`, which these numbers are where they bite.
 * Invariants: geometry constants, deliberately not in CONFIG. Never builds a
 * building, and never imports one.
 */
import {
  Build,
  runsAlongX,
  type Side,
} from "../core";

/**
 * Floor-to-floor height, and the one number the rest of this set is derived
 * from. 3.6 m leaves 3.1 m clear under a `SLAB`, which is an office rather
 * than a crawlspace, and it is what a flight at `GRADE` can climb in 10.3 m —
 * short enough to fit inside a building with room to walk round it.
 */
export const STOREY = 3.6;
/**
 * Floor slab thickness. Placed by its TOP face, so the walked surface is exact
 * however this moves. Deep for the outline-shell reason in the header, not
 * because a floor is thick.
 */
export const SLAB = 0.5;
/** Wall thickness, all four elevations. */
export const WALL = 0.4;
/**
 * Stair and ramp grade. `CONFIG.nav.stepHeight / cellSize` is 0.4 and severs
 * its own links at exactly that, so this is the same margin under it that
 * `buildStairs` keeps.
 */
export const GRADE = 0.35;
/** Riser aimed for; the tread count is rounded off it. `buildStairs`'s. */
export const RISER = 0.18;
/**
 * The LEAST a landing at the head of a flight may be — not how deep one is,
 * which is whatever is left of the lane past the top tread.
 *
 * A lane is void at the level its flight climbs to (see `buildOffice`), so
 * without a landing the top tread is merely FLUSH with the slab beside it: the
 * way on is sideways, and walking off the stair in the direction you climbed it
 * drops you a storey. Nothing said so — the nav graph links the top tread to
 * the slab across the lane edge, so bots route through it and every reachability
 * probe passes while the player still runs off a cliff at the top of the stairs.
 *
 * **A landing of a FIXED depth only moved that cliff back, and the measurement
 * is why it is not one any more.** At 2.4 m the void resumed on the far side of
 * it, so the failure was the same failure two and a half metres later: on the
 * shipped plates an office landing had 4.5 m of open lane in front of it over a
 * 3.4 m drop and a parkade apron 6.1 m, and a shophouse's — where the back wall
 * falls 0.54 m past the landing edge against a body radius of 0.45 — put the
 * player's centre 9 cm out over a slot, which is all `probeGround` needs to miss
 * the floor and drop them into the close. (It is a POINT query at the body's
 * centre however it is answered — that was true of the ray and is true of the
 * bucket lookup that replaced it, so the geometry below is what fixes it.) So a landing runs from
 * the top tread to the ENCLOSURE: the way on is still sideways, and the
 * direction you climbed is floor until a wall. What is left of the lane is the
 * atrium and it is all at the FOOT end — 16.6 m of it on an office plate, over
 * the flight and the floor below — which is the hole the whole lane arrangement
 * exists to leave, approached across open floor with the drop in front of you
 * rather than met at a run off a stair.
 *
 * The number survives as the minimum a plate has to leave: 2.4 m is over
 * `NavGrid`'s 1.5 m cell, so a landing is never rounded out of the graph, and
 * long enough to stop a sprint on. A flight overruns its own foot by 0.6 m and
 * needs 2.4 m past its head, so `d` is still what has to hold `run + 3.0`. Both
 * builders check it.
 */
export const LANDING = 2.4;
/**
 * The ground floor's walked height, above the street outside.
 *
 * Inside `HEIGHT_EPS` (0.35), so `NavGrid.addSurface` MERGES it with the
 * terrain underneath instead of spending a second slot on it, and inside
 * `stepHeight` (0.6), so every doorway links to the pavement without a ramp.
 * It exists at all so the interior has a floor of its own colour and so the
 * slab is not coplanar with the ground — which is the tavern's flicker.
 */
export const GROUND = 0.2;
/**
 * The narrowest opening this set will cut, and a NAV GRID number rather than
 * an architectural one.
 *
 * `NavGrid.severLinks` cuts every link whose segment crosses a wall's box, and
 * those segments run between CELL CENTRES — 1.5 m apart. So an opening keeps
 * its links only if a cell centre falls inside it, and a gap under `cellSize`
 * can land entirely between two and seal the room behind it. Nothing reports
 * it: the doorway is drawn, a player walks through it, and the flood fill has
 * simply never been to the other side.
 *
 * 1.8 m is `cellSize` plus a cell's worth of margin, so an opening survives
 * wherever the grid's origin happens to fall relative to the wall. Measured:
 * at 1.0 m a flat's back room came back standable-but-unreached from both home
 * fields, and at 1.8 m both rooms of every unit on the map are reached. The
 * cottage's 1.6 m door is the shipped precedent and is the smallest that has
 * ever worked; do not go under it, and prefer this.
 */
export const DOORWAY = 1.8;

/** Walked height of level `s`, 0 being the ground floor. */
export const levelY = (s: number): number => (s === 0 ? GROUND : s * STOREY);

/**
 * One storey's circulation in a stair LANE: the flight, and the landing at its
 * head. Every enterable building in this set climbs on this, and it is one
 * function because the two halves are one decision — a flight whose grade moved
 * takes its landing with it, and `Build.flight`'s own header is about the copy
 * of a flight that drifts from the original.
 *
 * A lane runs the plate's depth and alternates between the two X edges storey
 * by storey (see the set's header), so which EDGE a storey climbs is always the
 * caller's. Which END it climbs toward is the caller's too, and it matters for
 * one reason: **the landing is at the head, so `dir` decides which end of the
 * lane the way UP is at, and that has to be the end the building's own door
 * for it is at.** Get it backwards and the door opens into the blind side of a
 * flight — 3.4 m of concrete two metres inside a doorway, with the graph
 * perfectly happy because the stair is still reachable from the other end.
 * `office` climbs +Z (its doorways are on -Z and +X, and the whole plate is one
 * room, so either end serves); `shophouse` climbs -Z, because its stair has a
 * street door of its own at +Z and the foot has to be inside it.
 *
 * Three things are folded in here rather than left to each caller:
 *
 * - **The overrun at the foot.** 0.6 m past the bottom tread, so the joint at
 *   the floor is buried rather than floating; `Build.flight` drops every tread
 *   under the local ground line, which is what makes an overrun free.
 * - **The landing at the head, and it runs to the ENCLOSURE.** The lane's full
 *   width, and from the top tread to the inner face of the elevation the flight
 *   climbs toward — whatever depth that comes to, never a fixed one. The lane
 *   is VOID at the level the flight climbs to, so a landing that stopped short
 *   of the wall would leave the drop it exists to remove sitting two and a half
 *   metres further on. See `LANDING`, which is what may not be left.
 * - **The DEV check that the plate can hold both.** The circulation runs from
 *   `run / 2 + 0.6` short of the -Z elevation to the +Z one, so a plate too
 *   shallow leaves a landing under `LANDING` deep — a lip rather than a floor,
 *   and under `NavGrid`'s own cell. It throws rather than building it, because
 *   the symptom otherwise is a storey that is drawn and reachable and whose
 *   stair arrives on a ledge.
 */
export function laneFlight(o: {
  b: Build;
  /** The builder's name, for the DEV message. */
  tag: string;
  /** Lane centre on X, and the lane's width — which IS the flight's. */
  x: number;
  lane: number;
  /** The plate's depth, which is what has to hold the run and the landing. */
  depth: number;
  /** Walked heights this flight runs between. */
  from: number;
  to: number;
  /** Which end of the lane the head — and so the way up — is at. */
  dir?: 1 | -1;
  tread: string;
  landing: string;
}): void {
  const { b } = o;
  const dir = o.dir ?? 1;
  const rise = o.to - o.from;
  const run = rise / GRADE;
  if (import.meta.env.DEV && run / 2 + LANDING > o.depth / 2 - WALL / 2) {
    throw new Error(
      `${o.tag}: a ${o.depth} m plate cannot hold a ${run.toFixed(1)} m flight and ` +
        `leave the ${LANDING} m its landing needs between the top tread and the ` +
        "elevation — the stair would arrive on a ledge. See laneFlight, and LANDING.",
    );
  }
  b.flight({
    x: o.x,
    w: o.lane,
    topZ: (dir * run) / 2,
    topY: o.to,
    run: run + 0.6,
    rise: rise + 0.6 * GRADE,
    dir,
    steps: Math.max(4, Math.round(rise / RISER)),
    color: o.tread,
  });
  // From the top tread to the inner face of the elevation ahead: the lane's
  // head end is floor, and the void is the whole of what is left behind it.
  const head = (dir * run) / 2;
  const far = dir * (o.depth / 2 - WALL / 2);
  const deep = Math.abs(far - head);
  const lz = (head + far) / 2;
  b.box(o.lane, SLAB, deep, o.x, o.to - SLAB / 2, lz, o.landing);
  b.block({ w: o.lane, h: SLAB, d: deep, x: o.x, y: o.to - SLAB / 2, z: lz });
}

/** A box's top face, as `StoneBatch`'s `hide` names it; `HIDE_UNDER` is its bottom. */
export const HIDE_TOP = 1 << 2;
/** The two faces of a member laid along face `s` that butt into what it spans between. */
export const hideEnds = (s: Side): number => (runsAlongX(s) ? 1 | 2 : 16 | 32);
