/**
 * ConquestSystem.ts — Conquest rules: flags, capture meters, tickets, bleed,
 * spawn selection, squad orders.
 * Invariants: the meter runs -1..+1 and ownership flips only by crossing 0 —
 * a flag must be neutralised before it changes hands. Occupancy comes from the
 * combatant list Game assembles each frame. update() runs BEFORE
 * BattleSystem.update so bots see this frame's ownership. Events go out via
 * onCaptured/onNeutralised callbacks wired in Game — never import other
 * systems. Squad orders are planned for a whole team at once (planSquads) so
 * squads can be spread — or deliberately stacked — relative to each other; a
 * claimed flag is penalised, never excluded. Round numbers come from
 * CONFIG.conquest, squad ones from CONFIG.bots.squad.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { clamp } from "../core/math";
import type { Combatant, Team } from "../entities/Combatant";
import type { ControlPointDef, GameMap, SpawnPointDef } from "../world/MapBuilder";

/**
 * What one squad has been told to do. `defend` is a posture rather than a
 * destination — the squad goes to the same flag either way and behaves
 * differently once it arrives.
 */
export interface SquadOrder {
  pointId: string;
  defend: boolean;
}

/** Live state of one flag. */
export interface ControlPoint {
  def: ControlPointDef;
  /** Who owns it, or null while neutral. */
  owner: Team | null;
  /**
   * Capture meter, -1 (team 0 holds it outright) .. +1 (team 1 does). Ownership
   * flips only by crossing 0, so a flag must be neutralised before it changes
   * hands — you cannot steal one by briefly outnumbering the defender.
   */
  meter: number;
  /**
   * Bodies inside the zone this tick, per team.
   *
   * Written by the occupancy pass at the top of `update` — which a CLIENT in a
   * netplay round never runs, because the authority owns the meter. There it
   * is mirrored off the snapshot (`PointState.present`) alongside `owner` and
   * `meter`, so anything new that reads this is reading the server's count and
   * must not be given a local one to fall back on: a client's own tally is a
   * picture an interpolation delay behind the tick that decided `contested`.
   */
  present: [number, number];
  /** True while both teams are inside and the meter is frozen. */
  contested: boolean;
}

/**
 * Conquest: flags, capture meters, tickets, and the bleed that ends a round.
 *
 * The ticket model is the standard one. Each death costs the dying team a
 * ticket, and whichever side holds fewer flags loses tickets steadily on top —
 * so a team that is winning fights but ignoring objectives still loses. That
 * bleed is the only thing making the flags matter, which is why it scales with
 * the size of the deficit rather than being a flat drip.
 */
export class ConquestSystem {
  readonly points: ControlPoint[] = [];
  readonly tickets: [number, number] = [0, 0];
  /** Set once a side runs out; null while the round is live. */
  winner: Team | null = null;

  /** Wired by Game: a flag changed hands (for the HUD and a sound). */
  onCaptured: (point: ControlPoint, by: Team) => void = () => {};
  /**
   * Wired by Game: a flag went neutral, and which side pushed it there.
   *
   * The team is carried rather than looked up by the handler, because by the
   * time one runs the only trace of who did it is who is standing in the ring
   * — and the ring empties. It is the side the meter was moving toward when it
   * crossed, which is the side with bodies in the zone: the meter moves only
   * while exactly one team is present, so there is never a second candidate.
   */
  onNeutralised: (point: ControlPoint, by: Team) => void = () => {};

  private spawns: SpawnPointDef[] = [];
  /**
   * The play square's diagonal, which is what the squad planner's distance
   * penalty is measured in FRACTIONS of.
   *
   * The penalty used to be a flat rate per metre, tuned on a 240 m map where
   * the longest walk anywhere is 340 m. On a 900 m one that rate is worth 300
   * points across the map against the ~120 the whole ownership/contest scale
   * spans, so it stopped being the mild tiebreak `pointValue` documents and
   * became the only term: every squad picked whatever flag was nearest and, if
   * it already held it, dug in there for the rest of the round. Measured on
   * Sarab at 23.6% of live-bot time in `capture` against 1.5% on Hollowmere.
   *
   * Normalising by the map's own diagonal is what keeps "mild" meaning the
   * same thing at every scale. Set from the built map rather than CONFIG
   * because `MapLayout.size` is the MAP's (see CLAUDE.md's table).
   */
  private span = CONFIG.map.size * Math.SQRT2;
  private bleedT = 0;

  start(map: GameMap): void {
    this.points.length = 0;
    for (const def of map.controlPoints) {
      this.points.push({
        def,
        owner: null,
        meter: 0,
        present: [0, 0],
        contested: false,
      });
    }
    this.spawns = map.spawns;
    this.span = map.size * Math.SQRT2;
    this.tickets[0] = CONFIG.conquest.tickets;
    this.tickets[1] = CONFIG.conquest.tickets;
    this.winner = null;
    this.bleedT = 0;
  }

  /** Charges a team one ticket for a death. */
  registerDeath(team: Team): void {
    if (this.winner !== null) return;
    this.tickets[team] = Math.max(
      0,
      this.tickets[team] - CONFIG.conquest.ticketsPerDeath,
    );
    this.checkWin();
  }

  flagsHeld(team: Team): number {
    let n = 0;
    for (const p of this.points) if (p.owner === team) n++;
    return n;
  }

  /** The point a combatant is standing in, if any. */
  pointAt(pos: Vector3): ControlPoint | null {
    for (const p of this.points) {
      const dx = p.def.pos.x - pos.x;
      const dz = p.def.pos.z - pos.z;
      if (dx * dx + dz * dz < p.def.radius * p.def.radius) return p;
    }
    return null;
  }

  update(dt: number, combatants: Combatant[]): void {
    if (this.winner !== null) return;
    const c = CONFIG.conquest;

    // --- occupancy ---
    for (const p of this.points) {
      p.present[0] = 0;
      p.present[1] = 0;
    }
    for (const unit of combatants) {
      if (!unit.alive) continue;
      const p = this.pointAt(unit.position);
      if (p) p.present[unit.team] += 1;
    }

    // --- capture meters ---
    for (const p of this.points) {
      const a = p.present[0];
      const b = p.present[1];
      p.contested = a > 0 && b > 0;
      if (p.contested || (a === 0 && b === 0)) continue;

      const attackers = a > 0 ? a : b;
      const direction = a > 0 ? -1 : 1;
      // More bodies capture faster, but with diminishing returns, so a whole
      // squad can't flip a flag the instant it arrives.
      let mult = 0;
      for (let i = 0; i < attackers; i++) mult += c.crowdFalloff ** i;
      mult = Math.min(mult, c.maxCaptureMult);

      const before = p.meter;
      p.meter = clamp(p.meter + direction * c.captureRate * mult * dt, -1, 1);

      // Crossing zero neutralises; reaching the end captures.
      if (before !== 0 && Math.sign(before) !== Math.sign(p.meter) && p.owner !== null) {
        p.owner = null;
        // The pushing side is the one that is here: `direction` was chosen
        // from exactly that, one branch up.
        this.onNeutralised(p, a > 0 ? 0 : 1);
      }
      const team: Team | null =
        p.meter <= -1 ? 0 : p.meter >= 1 ? 1 : null;
      if (team !== null && p.owner !== team) {
        p.owner = team;
        this.onCaptured(p, team);
      }
    }

    // --- ticket bleed ---
    this.bleedT += dt;
    if (this.bleedT >= c.bleedInterval) {
      this.bleedT -= c.bleedInterval;
      const held0 = this.flagsHeld(0);
      const held1 = this.flagsHeld(1);
      if (held0 !== held1) {
        const loser: Team = held0 < held1 ? 0 : 1;
        const deficit = Math.abs(held0 - held1);
        this.tickets[loser] = Math.max(
          0,
          this.tickets[loser] - c.bleedPerFlagDeficit * deficit,
        );
      }
      this.checkWin();
    }
  }

  /**
   * Where a combatant of `team` should deploy: a spawn attached to a flag they
   * hold, biased toward the one nearest the fighting, falling back to the home
   * gatehouse. Spawns tied to a contested flag are skipped, so nobody drops
   * into the middle of a firefight they cannot see coming.
   */
  spawnFor(team: Team): SpawnPointDef | null {
    const owned = this.flagSpawnsFor(team);
    if (owned.length > 0) {
      // Prefer a flag adjacent to a contested one — that is where the line is.
      const frontline = owned.filter((s) => {
        const p = this.points.find((q) => q.def.id === s.controlPoint)!;
        return this.points.some(
          (q) => q !== p && q.owner !== team && near(q.def.pos, p.def.pos, 90),
        );
      });
      const pool = frontline.length > 0 ? frontline : owned;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    const home = this.homeSpawnsFor(team);
    if (home.length === 0) return null;
    return home[Math.floor(Math.random() * home.length)];
  }

  /**
   * Flag spawns this team may deploy to: owned and not currently contested, so
   * nobody drops into the middle of a fight they can't see coming.
   */
  flagSpawnsFor(team: Team): SpawnPointDef[] {
    const out: SpawnPointDef[] = [];
    for (const s of this.spawns) {
      if (!s.controlPoint) continue;
      const p = this.points.find((q) => q.def.id === s.controlPoint);
      if (p && p.owner === team && !p.contested) out.push(s);
    }
    return out;
  }

  /** The uncapturable home spawn — always available, so you can never be locked out. */
  homeSpawnsFor(team: Team): SpawnPointDef[] {
    return this.spawns.filter((s) => s.team === team);
  }

  /** Everything the deploy screen should offer, home spawn first. */
  deployOptions(team: Team): SpawnPointDef[] {
    return [...this.homeSpawnsFor(team).slice(0, 1), ...this.flagSpawnsFor(team)];
  }

  /**
   * Which spawn this is, as a number that means the same thing on both sides of
   * a wire: its index in the MAP's spawn table.
   *
   * The deploy screen's own list is not that number. It is derived from flag
   * ownership and re-derived every frame, so its indices renumber whenever a
   * flag changes hands — and a client naming a position by one of them would be
   * naming a different position from the one it drew whenever the server's
   * round had moved on. The map's table is a module constant that both ends
   * build from, so an index into it is a name.
   */
  spawnIndex(spawn: SpawnPointDef): number {
    return this.spawns.indexOf(spawn);
  }

  /**
   * The spawn at `index`, but only if this team may deploy there right now.
   *
   * The authority's half of `spawnIndex`. Everything a player is allowed to ask
   * for is in `deployOptions`, so the check is that the named spawn is in it —
   * which refuses the enemy's gatehouse and the flag that fell while the
   * request was in the air with the same line, and needs no rule of its own for
   * either. `null` means "pick for them" rather than "refuse them": the player
   * asked to come back, and where is the authority's answer.
   */
  deployAt(team: Team, index: number): SpawnPointDef | null {
    const spawn = this.spawns[index];
    if (!spawn) return null;
    return this.deployOptions(team).includes(spawn) ? spawn : null;
  }

  pointById(id: string): ControlPoint | undefined {
    return this.points.find((p) => p.def.id === id);
  }

  /**
   * Orders for one team's squads, resolved together.
   *
   * Together, because the interesting part is what the squads do *relative to
   * each other* — and because the thing this replaces could not express it.
   * The old `objectiveFor` was `ranked[squad % ranked.length]`: squad N took
   * the Nth-best flag, full stop. With two squads per team that meant a team
   * only ever pursued its top two objectives, could never choose to defend
   * (an owned flag scored a flat -30 however close it was to being lost), and
   * re-sorted the whole point list per bot per think tick — 160 throwaway
   * arrays a second for a value that changes every few seconds.
   *
   * Squads are resolved in order and each claims a point. A claimed point is
   * *penalised*, not excluded: when the round hinges on one flag, two squads
   * stacking on it is the right answer, and forced spreading is what made bots
   * wander off from the fight that decided the game.
   */
  planSquads(team: Team, centroids: Vector3[], previous: string[]): SquadOrder[] {
    const out: SquadOrder[] = [];
    if (this.points.length === 0) {
      for (let i = 0; i < centroids.length; i++) out.push({ pointId: "", defend: false });
      return out;
    }

    const s = CONFIG.bots.squad;
    const claims = new Map<string, number>();
    for (let i = 0; i < centroids.length; i++) {
      const from = centroids[i];
      const held = previous[i] ?? "";
      let best = this.points[0];
      let bestScore = -Infinity;
      for (const p of this.points) {
        let score = this.pointValue(p, team, from);
        score -= (claims.get(p.def.id) ?? 0) * s.claimPenalty;
        // Hysteresis, on the squad rather than the bot: the score of two
        // flags crossing must not make a squad turn round mid-approach.
        if (p.def.id === held) score += s.switchMargin;
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      claims.set(best.def.id, (claims.get(best.def.id) ?? 0) + 1);
      // Defending is a posture, not a destination: you go to the same place
      // either way, you just behave differently once you arrive.
      out.push({ pointId: best.def.id, defend: best.owner === team });
    }
    return out;
  }

  private pointValue(p: ControlPoint, team: Team, from: Vector3): number {
    const s = CONFIG.bots.squad;
    let score = 100;
    // Taking a flag off the enemy is worth more than grabbing a neutral one,
    // which is worth more than standing on your own.
    if (p.owner === null) score += 40;
    else if (p.owner !== team) score += 70;
    else score -= 30;
    if (p.contested) score += 50;
    // A flag you hold with enemies standing on it is about to stop being one.
    // `present` has been counted every tick since the beginning and read by
    // nothing; this is what turns it into a reason to go home and defend.
    if (p.owner === team) {
      const enemies = p.present[team === 0 ? 1 : 0];
      if (enemies > 0) {
        // Scaled by how far the meter has already slipped, so a flag actually
        // being taken outranks one with a single enemy wandering across it.
        const slipped = team === 0 ? (p.meter + 1) / 2 : (1 - p.meter) / 2;
        score += s.defendUnderAttack * Math.min(1, enemies / 2) * (0.4 + slipped);
      }
    }
    // Distance is a mild penalty, not a dominant one — otherwise every squad
    // just defends whatever is closest to the home spawn. It is a fraction of
    // the MAP rather than a rate per metre, because "mild" is relative to how
    // far there is to walk: see `span`, and `squad.distancePenalty`.
    score -= (Vector3.Distance(from, p.def.pos) / this.span) * s.distancePenalty;
    return score;
  }

  private checkWin(): void {
    if (this.winner !== null) return;
    if (this.tickets[0] <= 0) this.winner = 1;
    else if (this.tickets[1] <= 0) this.winner = 0;
  }
}

function near(a: Vector3, b: Vector3, dist: number): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz < dist * dist;
}
