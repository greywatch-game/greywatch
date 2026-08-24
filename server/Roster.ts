/**
 * server/Roster.ts — Who is in each of the sixteen roster slots.
 * Owns: the fixed slot table, team balance, and the human↔bot handover in both
 * directions. Owns no simulation: it says which slots are people, and `Match`
 * benches the corresponding bots.
 * Invariants: the slot table is built once and NEVER grows, shrinks or
 * reorders — a slot only ever changes who feeds it. `CONFIG.bots.perTeam` sizes
 * it, and it must stay equal to the bot pool `BattleSystem` builds, because a
 * slot index IS a bot index. A slot with no human in it is a bot, always: there
 * is no such thing as an empty slot, which is what lets a match start with one
 * player in it.
 *
 * This is the whole of "matches start without a full lobby". A match is always
 * 8v8; joining takes a bot's place and leaving gives it back. Nothing is
 * created or destroyed on either path, so there is no roster size for the rest
 * of the game to react to and no spawn/despawn race to get wrong.
 */
import { CONFIG } from "../src/config";
import type { NetTeam, SlotState } from "../src/net/protocol";

/** Total roster size. Must equal the bot pool: a slot index is a bot index. */
export const SLOT_COUNT = CONFIG.bots.perTeam * 2;

export class Roster {
  readonly slots: SlotState[] = [];

  /** Peer id -> slot index, so a leaving socket is O(1) to find. */
  private readonly byPeer = new Map<string, number>();

  constructor() {
    // Laid out team 0 first, then team 1 — the same order `BattleSystem` builds
    // its pool in, which is what makes a slot index usable as a bot index
    // without a lookup table that could disagree with it.
    for (let team = 0; team < 2; team++) {
      for (let i = 0; i < CONFIG.bots.perTeam; i++) {
        this.slots.push({
          index: this.slots.length,
          team: team as NetTeam,
          occupant: { kind: "bot" },
        });
      }
    }
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
    return this.slots.some((s) => s.occupant.kind === "bot");
  }

  /**
   * Seats a human, or returns null when all sixteen are already people.
   *
   * The thinner team wins, so a match fills evenly however people arrive; a tie
   * goes to team 0, which is arbitrary but deterministic, and the joiner after
   * it necessarily goes to the other side. Within a team the lowest-numbered
   * bot slot is taken, so slot assignment is reproducible in a log.
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

  private firstBotSlot(team: NetTeam): SlotState | null {
    for (const s of this.slots) {
      if (s.team === team && s.occupant.kind === "bot") return s;
    }
    return null;
  }
}
