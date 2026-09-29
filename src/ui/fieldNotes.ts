/**
 * fieldNotes.ts — The one line of advice the building card gives while a map
 * is built under it.
 * Owns: the notes, and which of them a given map may be told.
 * Invariants: every note is a claim about how THIS game plays, so a number in
 * one is read off `CONFIG` rather than typed, and a note about something a map
 * does not have (armour, the third slot) says so in its `when` rather than
 * being told on Hollowmere. No note names a key: the card draws no prompts,
 * and a sentence naming a key to a phone is a line of lies (`docs/ui.md`).
 * Must never: carry a note that is TRUE ONLY OF A SETTING — a difficulty, a
 * sensitivity — or advice the game does not bear out. A loading screen that is
 * wrong about the game is worse than one that says nothing.
 *
 * A table rather than prose in `OverlayScreen`, because it is DATA that grows:
 * a new mechanic that surprises players is one row here and nothing else.
 */
import { CONFIG } from "../config";
import type { MapDef } from "../world/maps";

interface FieldNote {
  text: string;
  /** Only told on a map this answers true for. Absent is every map. */
  when?: (map: MapDef) => boolean;
}

const armoured = (map: MapDef) => (map.layout.vehicles?.length ?? 0) > 0;

const NOTES: readonly FieldNote[] = [
  {
    text:
      "There is no crosshair. Hip fire goes roughly where the barrel points; " +
      "the sight is the only mark that says where a round will land.",
  },
  {
    text:
      `Grenades come back when you do and not before — ${CONFIG.grenade.carried} ` +
      "a life, so spend them on a flag rather than on one body.",
  },
  {
    text:
      "A flag has to be dragged back to neutral before it changes hands, so a " +
      "contested flag you still hold is time bought.",
  },
  {
    text:
      `Health comes back on its own ${CONFIG.player.regenDelay} seconds after ` +
      "the last hit. Break line of sight and let it.",
  },
  {
    text:
      `A round to the head does ${CONFIG.combat.headshotMult}× damage — and ` +
      "only yours do. A bot's rounds are never headshots.",
  },
  {
    text:
      "Crouching brings your whole body down, not just your eye: behind a low " +
      "wall it is the difference between cover and a target.",
  },
  {
    text:
      "A bolt gun stays shut while you are aimed in. Let the sight down to " +
      "work the bolt, then take it back up.",
  },
  {
    text:
      "Most of a rifle's climb comes back on its own. Fire in short strings " +
      "and let the muzzle settle between them.",
  },
  {
    text:
      "A window with a room behind it breaks, and rounds go straight through " +
      "glass — it is concealment, never cover.",
  },
  {
    text:
      "A bot tells its squad where it saw you. After a kill, move — the rest " +
      "of them are already looking there.",
  },
  {
    text:
      "A frag bounces before it goes off. A molotov bursts on whatever it " +
      "touches first and leaves the ground burning.",
  },
  {
    text:
      "Two fit in a vehicle: the first aboard drives, and the second takes " +
      "the mounted gun.",
    when: armoured,
  },
  {
    text:
      "Where there is armour, the kit has a third slot — a launcher or two " +
      "mines — and it is the one thing a hull is afraid of.",
    when: armoured,
  },
  {
    text:
      "A mine is set off by a hull and nothing else, so infantry can cross a " +
      "minefield that a tank cannot.",
    when: armoured,
  },
];

/**
 * One note this map may be told, never the one told last time — a tip that
 * repeats across two loads in a row reads as a screen with one line on it.
 */
export function pickFieldNote(map: MapDef, last: string | null): string {
  const pool = NOTES.filter((n) => (n.when ? n.when(map) : true) && n.text !== last);
  return pool[Math.floor(Math.random() * pool.length)]?.text ?? NOTES[0].text;
}
