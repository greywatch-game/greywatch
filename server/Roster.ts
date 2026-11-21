/**
 * server/Roster.ts — Who is in each of a match's roster slots, and which of
 * them this round fields.
 * Owns: the fixed slot table, team balance, the human↔bot handover in both
 * directions, and the map's roster laid over the table. Owns no simulation: it
 * says which slots are people and which are in this round, and `Match` benches
 * the corresponding bots.
 * Invariants: the slot table is built once and NEVER grows, shrinks or
 * reorders — a slot only ever changes who feeds it. Its block width a team
 * (`perTeam`) is the match's, given at construction, and it IS the bot pool
 * `BattleSystem` builds: `Match` hands `perTeam` to the core as
 * `RoundSpec.pool`, because a slot index IS a bot index. A slot with no human
 * in it is a bot, always: there is no such thing as an empty slot, which is
 * what lets a match start with one player in it.
 *
 * This is the whole of "matches start without a full lobby". Joining takes a
 * bot's place and leaving gives it back; nothing is created or destroyed on
 * either path, so there is no roster size for the rest of the game to react to
 * and no spawn/despawn race to get wrong.
 *
 * **THE TABLE IS THE CEILING AND THE ROUND IS THE MAP'S**, and that split is
 * the whole design. `MapLayout.perTeam` is how many bodies a side a map fields
 * — Sarab is twenty-four and every other map is eight — and a match rotates
 * between maps under ONE table, so the authority builds the table at the
 * largest roster any map may ask for (`CONFIG.bots.maxPerTeam`, forty-eight
 * slots) and `setFielded` says how many of each team's block are in THIS
 * round. Sizing the table per map instead would mean a slot index that moves
 * under the humans sitting in it: team 1's block begins at the team's own
 * size, so a rotation would renumber every player on that side — and a peer's
 * slot is its entity id on the wire, its `ScoreBook` row, its rewind history
 * and the key of eight per-slot tables in `Match`. `RoundStart` exists
 * precisely so that a rotation re-seats nobody.
 *
 * **A match that never rotates is the one exception, and it is sized to its
 * map**: an OWNED match (`MatchOptions.owned`,
 * the page's offline round) stays on the one map its owner named, so nothing
 * can ever renumber it — and its table is that map's own roster, because every
 * outcome stream is keyed by slot and the offline fight has always been played
 * on a pool that size. The ceiling would move team 1's block and change the
 * fight.
 *
 * **HUMAN CAPACITY IS THE SMALLEST MAP IN THE ROTATION, which is why it is
 * sixteen rather than forty-eight.** A person may only ever be seated in the
 * first `HUMANS_PER_TEAM` slots of a team's block, which every map fields, so a
 * rotation can never arrive at a map with nowhere to put somebody who is
 * already sitting down — eviction is prevented by construction rather than by a
 * rule somebody has to remember. What a bigger map buys is BOTS beside the same
 * sixteen people: Sarab in a match is twenty-four a side, of whom sixteen may
 * be human. See `docs/multiplayer.md`.
 */
import { CONFIG } from "../src/config";
import type { NetTeam, SlotState } from "../src/net/protocol";

/**
 * How many of each team's block a PERSON may sit in.
 *
 * The smallest roster any map fields, which is what a map that states nothing
 * fields, which is `CONFIG.bots.perTeam`. See the header: a rotation may never
 * have to evict anybody, and this is the number that guarantees it.
 */
export const HUMANS_PER_TEAM = CONFIG.bots.perTeam;

export class Roster {
  readonly slots: SlotState[] = [];

  /**
   * How many of each team's block a person may sit in: `HUMANS_PER_TEAM`, or
   * the whole block on a table narrower than that — a map that fields fewer
   * than eight a side, which no shipped map does.
   */
  readonly seats: number;

  /** Peer id -> slot index, so a leaving socket is O(1) to find. */
  private readonly byPeer = new Map<string, number>();

  /**
   * How many of each team's block this round fields — the standing map's
   * `perTeamOf`, pushed by `Match` off `SimCore.perTeam` so the table and
   * the simulation cannot disagree about which bodies exist.
   *
   * `CONFIG.bots.perTeam` until a round has been built, which is what a map
   * stating nothing fields and therefore the only honest answer before there is
   * a map to ask.
   */
  private fieldedPerTeam: number = CONFIG.bots.perTeam;

  /**
   * `perTeam` is the table's block width a team, and the bot pool's: the
   * ceiling, `CONFIG.bots.maxPerTeam`, on a match that rotates; the map's own
   * roster on one that does not — see the header. No default: `Match` is the
   * one place that decides which.
   */
  constructor(readonly perTeam: number) {
    this.seats = Math.min(HUMANS_PER_TEAM, perTeam);
    // Laid out team 0 first, then team 1 — the same order `BattleSystem` builds
    // its pool in, which is what makes a slot index usable as a bot index
    // without a lookup table that could disagree with it.
    for (let team = 0; team < 2; team++) {
      for (let i = 0; i < perTeam; i++) {
        this.slots.push({
          index: this.slots.length,
          team: team as NetTeam,
          occupant: { kind: "bot" },
        });
      }
    }
  }

  /** How many people this match seats. See `seats`. */
  get capacity(): number {
    return this.seats * 2;
  }

  /** How many humans are on a team. */
  humansOn(team: NetTeam): number {
    let n = 0;
    for (const s of this.slots) {
      if (s.team === team && s.occupant.kind === "human") n++;
    }
    return n;
  }

  get humanCount(): number {
    return this.humansOn(0) + this.humansOn(1);
  }

  /** Is there a bot whose place a joining human could take? */
  hasBotSlot(): boolean {
    return this.slots.some((s) => this.seatable(s) && s.occupant.kind === "bot");
  }

  /**
   * How many bodies a side this round fields, pushed once per round by `Match`.
   *
   * Nothing about the table changes: it is the same slots it was before the
   * call and every occupant is still in the slot it was in. What
   * moves is only which of them `fielded` hands out — see the header.
   */
  setFielded(perTeam: number): void {
    this.fieldedPerTeam = perTeam;
  }

  /** Is this slot one of the bodies in the standing round? */
  isFielded(index: number): boolean {
    return index % this.perTeam < this.fieldedPerTeam;
  }

  /**
   * The slots in the standing round, in slot order.
   *
   * What goes on the wire, because a client draws one body and one scoreboard
   * row per slot it is told about, and a slot this map does not field is a body
   * nobody can see, shoot or score against. Every human is in it by
   * construction: a person may only sit in the first `seats` of a
   * block, and every map fields at least that many.
   */
  fielded(): SlotState[] {
    return this.slots.filter((s) => this.isFielded(s.index));
  }

  /**
   * Seats a human, or returns null when every seat is already a person.
   *
   * The thinner team wins, so a match fills evenly however people arrive; a tie
   * goes to team 0, which is arbitrary but deterministic, and the joiner after
   * it necessarily goes to the other side. Within a team the lowest-numbered
   * seatable bot slot is taken, so slot assignment is reproducible in a log.
   */
  claim(peerId: string, name: string): SlotState | null {
    const team: NetTeam = this.humansOn(0) <= this.humansOn(1) ? 0 : 1;
    const slot =
      this.firstBotSlot(team) ?? this.firstBotSlot(team === 0 ? 1 : 0);
    if (!slot) return null;
    slot.occupant = { kind: "human", peerId, name };
    this.byPeer.set(peerId, slot.index);
    return slot;
  }

  /**
   * Hands a slot back to a bot. Returns the slot, or null if the peer held none.
   *
   * The bot that comes back is the one that was benched — same pool entry, same
   * skill, same squad — because nothing was ever destroyed. It respawns on the
   * ordinary timer rather than appearing where the human was standing, which is
   * `Match`'s business, not this file's.
   */
  release(peerId: string): SlotState | null {
    const index = this.byPeer.get(peerId);
    if (index === undefined) return null;
    this.byPeer.delete(peerId);
    const slot = this.slots[index];
    slot.occupant = { kind: "bot" };
    return slot;
  }

  slotFor(peerId: string): SlotState | null {
    const index = this.byPeer.get(peerId);
    return index === undefined ? null : this.slots[index];
  }

  /** True when this slot should be driven by AI this tick. */
  isBot(index: number): boolean {
    return this.slots[index].occupant.kind === "bot";
  }

  /**
   * May a PERSON sit here?
   *
   * The first `seats` of each team's block and no others, which is what
   * makes a rotation onto a smaller map impossible to fail: those slots are
   * fielded by every map there is. The rest of the table is bots for the life
   * of the match.
   */
  private seatable(slot: SlotState): boolean {
    return slot.index % this.perTeam < this.seats;
  }

  private firstBotSlot(team: NetTeam): SlotState | null {
    for (const s of this.slots) {
      if (s.team !== team || !this.seatable(s)) continue;
      if (s.occupant.kind === "bot") return s;
    }
    return null;
  }
}
