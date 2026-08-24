/**
 * config/teams.ts — the two sides.
 * Owns: names and the friend/foe colour read — a name, the colour a side is
 * WORN in, and the emissive its visor takes, and nothing else. A fourth
 * colour lived here unread for as long as this file has existed; a palette
 * nothing looks at is a palette that drifts from the one that is drawn.
 * Gotcha: index 0 is the player's team everywhere in the codebase.
 */

/**
 * The two sides. Colors are the primary friend/foe read — warm amber against
 * cold crimson, both legible under blue moonlight and both still saturated
 * enough to carry in Coldharbour's afternoon.
 *
 * **This colour is worn**, and that is what fixes how saturated it is allowed
 * to be: `SoldierModel`'s kit paints the pauldrons, the bandolier and the
 * helmet band with it, so a side whose colour is a dull tone is a side with no
 * marking on it at all at fifty metres. Redline's was `#5a4550`, a plum close
 * enough to the body's own greys to disappear into them — the sides were told
 * apart by the visor's glow and nothing else. Every other place this pair
 * appears (the deploy map, the killfeed) is a screen, where a dull colour
 * merely looks dull; the soldier is where it has to survive fog, distance and
 * three pixels of width.
 */
export const teams = [
  {
    name: "Valeguard",
    color: "#c9a15e",
    eyeColor: "#ffc46b",
  },
  {
    name: "Redline",
    color: "#c8404a",
    eyeColor: "#ff3b3b",
  },
] as const;
