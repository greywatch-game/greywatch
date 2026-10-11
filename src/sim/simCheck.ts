/**
 * src/sim/simCheck.ts — The DEV mirror check (`?simcheck`): every answer the
 * page's readers (`src/sim/mirror.ts`) give, held against the live object it
 * stands for, with `Object.is` (`BABYLON_EXIT.md` X2.5a C5).
 * Owns: `simCheck`, one pass over everything the frame carries — the header,
 * every bot and every one of its solved joints, the flags and the tickets as
 * the page's own conquest holds them, the persons, the hulls (their posing,
 * their chairs and their target), the four pools, the board, the panes (the
 * frame's and the page's own glass), and the aim assist's target list in
 * order.
 * Invariants:
 * - **A DEV instrument, and a module function so a production bundle drops
 *   it whole** — `Game` reaches it only inside `import.meta.env.DEV` (the
 *   precedent is `MapBuilder`'s `assertSweepOrder`, `BABYLON_EXIT.md` X2.1:
 *   as a method its call folded out but its body shipped). `server/corecheck.ts`
 *   runs the same pass headless, where the persons are.
 * - **Reads; writes nothing either side.** The live reads are of public
 *   fields and of `Bot.solved`, whose one write is a cache of a pure function
 *   of the pose.
 * - Run where the two must agree: after the page has synced its mirrors off a
 *   frame the core published and drawn the events that came with it, before
 *   anything calls the core again.
 * Never: a gameplay path. It is the oracle that says the readers lost
 * nothing, so the frame can cross a Worker boundary (X2.5b) with nothing
 * left behind on the far side. It needs the core in THIS thread, which is
 * why `?simcheck` puts it there (`openSimHost`).
 */
import { JOINT_KEYS } from "../entities/soldierPose";
import { DRIVER, GUNNER, type CrewSeat } from "../entities/hullSeats";
import type { Team } from "../entities/Combatant";
import type { Vector3Like } from "../math";
import type { Hittable } from "../systems/CombatSystem";
import type { ControlPoint } from "../systems/ConquestSystem";
import { BotMirror, HullTarget, PersonMirror, type SimMirror } from "./mirror";
import type { SimCore } from "./SimCore";

/** What the page holds besides its mirror that the check also asks. */
export interface SimCheckPage {
  /** The page's own conquest the flags are written onto (`flagsInto`). */
  readonly flags?: {
    readonly points: readonly ControlPoint[];
    readonly tickets: readonly [number, number];
    readonly winner: Team | null;
  };
  /** The page's own glass, applied off the ring's `glass` events. */
  readonly glass?: { intact(pane: number): boolean };
}

/**
 * One pass: every reader against its live object. Returns the number of
 * mismatches, and hands at most `limit` of them to `report` by name.
 */
export function simCheck(
  core: SimCore,
  mirror: SimMirror,
  page: SimCheckPage,
  report: (what: string) => void,
  limit = 8,
): number {
  let bad = 0;
  const is = (what: string, a: unknown, b: unknown): void => {
    if (Object.is(a, b)) return;
    if (bad++ < limit) report(`${what}: mirror ${String(a)} live ${String(b)}`);
  };
  const vec = (what: string, a: Vector3Like, b: Vector3Like): void => {
    is(`${what}.x`, a.x, b.x);
    is(`${what}.y`, a.y, b.y);
    is(`${what}.z`, a.z, b.z);
  };

  // --- header ---
  const f = mirror.frame;
  is("tick", f.tick, core.tick);
  is("time", f.time, core.now);
  is("seed", f.seed, core.random.seed);
  is("fielded", f.fielded, core.perTeam);
  is("winner", f.winner, core.conquest.winner ?? -1);
  is("poolVersion", mirror.roster.poolVersion, core.battle.poolVersion);

  // --- bots ---
  const bots = core.battle.bots;
  is("bots.count", mirror.roster.bots.length, bots.length);
  const n = Math.min(bots.length, mirror.roster.bots.length);
  for (let i = 0; i < n; i++) {
    const m = mirror.roster.bots[i];
    const b = bots[i];
    const at = `bot ${i}`;
    is(`${at}.team`, m.team, b.team);
    is(`${at}.alive`, m.alive, b.alive);
    is(`${at}.shown`, m.shown, b.shown);
    is(`${at}.life`, m.life, b.life);
    is(`${at}.launcher`, m.launcher, b.launcher);
    is(`${at}.aside`, m.aside, core.battle.aside(b));
    vec(`${at}.position`, m.position, b.position);
    vec(`${at}.center`, m.center, b.center);
    vec(`${at}.eyePos`, m.eyePos, b.eyePos);
    is(`${at}.hitRadius`, m.hitRadius, b.hitRadius);
    is(`${at}.lookYaw`, m.lookYaw, b.lookYaw);
    is(`${at}.rootX`, m.rootX, b.rootX);
    is(`${at}.rootY`, m.rootY, b.rootY);
    is(`${at}.rootZ`, m.rootZ, b.rootZ);
    is(`${at}.rootYaw`, m.rootYaw, b.rootYaw);
    vec(`${at}.deathFrom`, m.deathFrom, b.deathFrom);
    is(`${at}.deathDamage`, m.deathDamage, b.deathDamage);
    is(`${at}.deathKind`, m.deathKind, b.deathKind);
    const solved = b.solved;
    for (const k of JOINT_KEYS) is(`${at}.solved.${k}`, m.solved[k], solved[k]);
  }

  // --- flags, as the page holds them ---
  const points = core.conquest.points;
  if (page.flags) {
    const fl = page.flags;
    is("flags.count", fl.points.length, points.length);
    for (let i = 0; i < Math.min(points.length, fl.points.length); i++) {
      const a = fl.points[i];
      const b = points[i];
      is(`flag ${i}.id`, a.def.id, b.def.id);
      is(`flag ${i}.owner`, a.owner, b.owner);
      is(`flag ${i}.meter`, a.meter, b.meter);
      is(`flag ${i}.contested`, a.contested, b.contested);
      is(`flag ${i}.present0`, a.present[0], b.present[0]);
      is(`flag ${i}.present1`, a.present[1], b.present[1]);
    }
    is("tickets0", fl.tickets[0], core.conquest.tickets[0]);
    is("tickets1", fl.tickets[1], core.conquest.tickets[1]);
    is("flags.winner", fl.winner, core.conquest.winner);
  }

  // --- persons, both ways: the count, every mirror row a person of the
  // core's in the core's own order, and (below) every person of the core's a
  // mirror row — a row the core has dropped, or one it never had, is a
  // mismatch rather than a silence.
  is("persons.count", mirror.personCount, core.players.size);
  for (let k = 0; k < mirror.personCount; k++) {
    const m = mirror.personAt(k)!;
    is(`person[${k}].slot`, m.slot, core.playerList[k]?.slot);
    is(`person[${k}].inCore`, core.players.get(m.slot) !== undefined, true);
  }
  for (const p of core.players.values()) {
    const m = mirror.person(p.slot);
    const at = `person ${p.slot}`;
    if (!m) {
      is(`${at}.present`, false, true);
      continue;
    }
    is(`${at}.team`, m.team, p.team);
    is(`${at}.alive`, m.alive, p.alive);
    is(`${at}.health`, m.health, p.health);
    vec(`${at}.position`, m.position, p.position);
    vec(`${at}.center`, m.center, p.center);
    vec(`${at}.eyePos`, m.eyePos, p.eyePos);
    is(`${at}.hitRadius`, m.hitRadius, p.hitRadius);
    is(`${at}.seat`, m.seat, p.seat);
    is(`${at}.crewSeat`, m.crewSeat, p.crewSeat);
    is(`${at}.grenades`, m.grenades, p.grenades);
    is(`${at}.ordnance`, m.ordnance, p.ordnance);
    is(`${at}.respawnT`, m.respawnT, p.respawnT);
    is(`${at}.mines`, m.mines, core.antiTank.minesFor(p));
  }

  // --- hulls ---
  const hulls = core.vehicles.hulls;
  const fleet = mirror.fleet;
  is("hulls.count", fleet.count, hulls.length);
  for (let i = 0; i < Math.min(hulls.length, fleet.count); i++) {
    const t = hulls[i];
    const at = `hull ${i}`;
    is(`${at}.present`, fleet.present(i), t.present);
    is(`${at}.alive`, fleet.alive(i), t.alive);
    is(`${at}.health`, fleet.health(i), t.health);
    const s = fleet.stateFor(i);
    is(`${at}.state`, s !== null, t.present);
    if (s && t.present) {
      is(`${at}.x`, s.x, t.position.x);
      is(`${at}.y`, s.y, t.position.y);
      is(`${at}.z`, s.z, t.position.z);
      is(`${at}.yaw`, s.yaw, t.yaw);
      is(`${at}.turretYaw`, s.turretYaw, t.turretYaw);
      is(`${at}.gunPitch`, s.gunPitch, t.gunPitch);
      const g = fleet.mgFor(i);
      is(`${at}.mgYaw`, g?.yaw, t.mgYaw);
      is(`${at}.mgPitch`, g?.pitch, t.mgPitch);
    }
    for (const seat of [DRIVER, GUNNER] as CrewSeat[]) {
      const live = !t.seats[seat] ? "open" : core.crew.crewOf(t, seat) ? "bot" : "player";
      is(`${at}.seat${seat}`, fleet.seatHolder(i, seat), live);
    }
    const target = fleet.targets[i];
    is(`${at}.team`, target.team, t.team);
    vec(`${at}.center`, target.center, t.center);
    vec(`${at}.eyePos`, target.eyePos, t.eyePos);
    is(`${at}.hitRadius`, target.hitRadius, t.hitRadius);
  }

  // --- the pools ---
  const ord = mirror.ordnance;
  const flights = core.grenades.flights;
  is("grenades.count", ord.flights.length, flights.length);
  for (let i = 0; i < Math.min(flights.length, ord.flights.length); i++) {
    const a = ord.flights[i];
    const b = flights[i];
    const at = `grenade ${i}`;
    is(`${at}.live`, a.live, b.live);
    is(`${at}.resting`, a.resting, b.resting);
    is(`${at}.id`, a.id, b.id);
    is(`${at}.kind`, a.kind, b.kind);
    is(`${at}.fuse`, a.fuse, b.fuse);
    vec(`${at}.pos`, a.pos, b.pos);
    vec(`${at}.vel`, a.vel, b.vel);
  }
  const fires = core.grenades.fireSlots;
  is("fires.count", ord.fireSlots.length, fires.length);
  for (let i = 0; i < Math.min(fires.length, ord.fireSlots.length); i++) {
    is(`fire ${i}.id`, ord.fireSlots[i].id, fires[i].id);
    is(`fire ${i}.t`, ord.fireSlots[i].t, fires[i].t);
    vec(`fire ${i}.at`, ord.fireSlots[i].at, fires[i].at);
  }
  // The visit, as the light and the voice see it: same fires, same order,
  // same swell.
  const seen: number[] = [];
  ord.forEachFire((id, at, strength) => seen.push(id, at.x, at.y, at.z, strength));
  let v = 0;
  core.grenades.forEachFire((id, at, strength) => {
    is(`forEachFire ${v / 5}.id`, seen[v], id);
    is(`forEachFire ${v / 5}.x`, seen[v + 1], at.x);
    is(`forEachFire ${v / 5}.y`, seen[v + 2], at.y);
    is(`forEachFire ${v / 5}.z`, seen[v + 3], at.z);
    is(`forEachFire ${v / 5}.strength`, seen[v + 4], strength);
    v += 5;
  });
  is("forEachFire.count", seen.length, v);
  const rockets = core.antiTank.rocketSlots;
  is("rockets.count", ord.rocketSlots.length, rockets.length);
  for (let i = 0; i < Math.min(rockets.length, ord.rocketSlots.length); i++) {
    is(`rocket ${i}.live`, ord.rocketSlots[i].live, rockets[i].live);
    is(`rocket ${i}.flown`, ord.rocketSlots[i].flown, rockets[i].flown);
    vec(`rocket ${i}.pos`, ord.rocketSlots[i].pos, rockets[i].pos);
    vec(`rocket ${i}.vel`, ord.rocketSlots[i].vel, rockets[i].vel);
  }
  const mines = core.antiTank.mineSlots;
  is("mines.count", ord.mineSlots.length, mines.length);
  for (let i = 0; i < Math.min(mines.length, ord.mineSlots.length); i++) {
    is(`mine ${i}.live`, ord.mineSlots[i].live, mines[i].live);
    is(`mine ${i}.armT`, ord.mineSlots[i].armT, mines[i].armT);
    vec(`mine ${i}.pos`, ord.mineSlots[i].pos, mines[i].pos);
  }

  // --- the board ---
  is("scores.version", mirror.scores.version, core.scores.version);
  for (let i = 0; i < core.scores.kills.length; i++) {
    const a = mirror.scores.row(i);
    const b = core.scores.row(i);
    is(`score ${i}.kills`, a.kills, b.kills);
    is(`score ${i}.deaths`, a.deaths, b.deaths);
    is(`score ${i}.points`, a.points, b.points);
  }

  // --- the glass: the frame's, and the page's own off the events ---
  for (let i = 0; i < core.glass.paneCount; i++) {
    const live = !core.glass.intact(i);
    is(`pane ${i}`, mirror.paneBroken(i), live);
    if (page.glass) is(`page pane ${i}`, !page.glass.intact(i), live);
  }

  // --- the target list, in order ---
  for (const team of [0, 1] as Team[]) {
    const ours = mirror.hittablesAgainst(team);
    const live = core.battle.hittablesAgainst(team);
    is(`targets ${team}.count`, ours.length, live.length);
    for (let i = 0; i < Math.min(ours.length, live.length); i++) {
      const at = `targets ${team}[${i}]`;
      is(`${at}.who`, whoOf(mirror, ours[i]), whoOfLive(core, live[i]));
      vec(`${at}.center`, ours[i].center, live[i].center);
      vec(`${at}.eyePos`, ours[i].eyePos, live[i].eyePos);
      is(`${at}.hitRadius`, ours[i].hitRadius, live[i].hitRadius);
    }
  }
  return bad;
}

/** A mirror target's identity: `b<slot>`, `h<hardstanding>` or `p<slot>`. */
function whoOf(mirror: SimMirror, t: Hittable): string {
  if (t instanceof BotMirror) return `b${t.slot}`;
  if (t instanceof PersonMirror) return `p${t.slot}`;
  if (t instanceof HullTarget) return `h${mirror.fleet.targets.indexOf(t)}`;
  return "?";
}

/** The live target's identity in `whoOf`'s terms. */
function whoOfLive(core: SimCore, t: Hittable): string {
  const b = core.battle.bots.indexOf(t as (typeof core.battle.bots)[number]);
  if (b >= 0) return `b${b}`;
  for (const p of core.players.values()) if (p === t) return `p${p.slot}`;
  const h = core.vehicles.hulls.indexOf(t as (typeof core.vehicles.hulls)[number]);
  return h >= 0 ? `h${h}` : "?";
}
