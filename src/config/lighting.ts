/**
 * config/lighting.ts — the dynamic light budget.
 * Owns: slot counts, ranges and the muzzle-flash budget. Contract:
 * `docs/rendering.md`.
 * Gotcha: cel materials read these as UNIFORMS. Adding a Babylon `PointLight`
 * to the scene will not light a single cel-shaded mesh.
 */

export const lighting = {
  /** Muzzle flash pulse: color, reach, brightness, and life in seconds. */
  muzzleColor: "#ffcf7a",
  muzzleRange: 14,
  muzzleIntensity: 2.6,
  muzzleLife: 0.07,
  /**
   * Transient pulses always win a shader light slot, so 16 bots firing at
   * once would saturate all 16 and black out the village's own lanterns.
   * Only the nearest few muzzle flashes get a light, and only up close.
   */
  muzzleBudgetPerFrame: 4,
  muzzleMaxDistance: 30,
  /**
   * A grenade going off. Unbudgeted, unlike the muzzle flashes above, and it
   * can be: there is one blast every few seconds at the very most, against
   * up to eighty muzzle flashes a second, so a transient slot for each one is
   * never the thing that blacks the village out. It is far brighter and far
   * longer than a muzzle flash for the obvious reason — for a third of a
   * second it is the only light in the valley that matters.
   */
  explosionColor: "#ffb45a",
  explosionRange: 28,
  explosionIntensity: 7,
  explosionLife: 0.34,
  /**
   * Shoulder lamp the player carries. Without it these arenas are too dark
   * to fight in between fixtures — and it gives the character a light of
   * their own to be silhouetted against.
   */
  lampColor: "#ffd9a8",
  lampRange: 18,
  lampIntensity: 1.6,
  /** Above `Player.center` — a carried light rides the body, not the ground. */
  lampHeight: 1.45,
  /**
   * The kit screen's bench lamps — carried lights that exist only while a
   * weapon is on the loadout turntable, placed relative to the CAMERA
   * (`ahead`/`side`/`up`, metres) rather than anywhere in the world.
   *
   * They are here because the alternative is whatever the moon and the last
   * frame's fixtures happen to be doing to a gun held at hip height in a
   * dark village — and on the one screen whose entire job is to show you the
   * weapon, that is a black silhouette. The weapon's albedo is a night
   * game's albedo, so this is deliberately far brighter than the shoulder
   * lamp: `col = albedo * light` in the cel shader, and a #2a-ish receiver
   * needs light well past 1 before it reads as metal rather than as a hole.
   *
   * Two of them — a warm key above the weapon and a dimmer cool fill from
   * beyond it and below — because a single light flattens the model into one
   * tone, and the hard bands the shader quantises the light into need
   * something to vary across before they read as shape.
   *
   * The short range is load-bearing: the stage is a hole in the kit screen's
   * scrim, so anything these reach is visible behind the weapon.
   *
   * **The third one is BEHIND the eye, and it is there for the polish rather
   * than for the light.** A mirror hands back what is behind the CAMERA — a
   * plate facing you reflects the room at your shoulder, never the lamp in
   * front of it — so with two lamps both beyond the weapon, every reflection
   * a chrome finish could return landed on the faces turned away from the
   * screen. Photographed on this stage at a 13-degree highlight and again at
   * 60: nothing on any visible facet, which is why the gold plate read as tan
   * paint on the one screen whose job is to sell it. This one sits back and
   * off to the left of the eye, where the weapon's own faces bounce it
   * straight down the lens. It is dim and short-ranged because what it is for
   * is the top rung of the gloss ladder (`graphics.spec.rifleChrome`'s
   * `mirror`); on a matte finish it is a slight fill on the near faces and
   * nothing else.
   */
  kitLamps: [
    { ahead: 1, side: 0, up: 0.62, color: "#ffe8c6", range: 3, intensity: 5.2 },
    { ahead: 1.6, side: 0.75, up: -0.25, color: "#a6bfe0", range: 3, intensity: 2.2 },
    { ahead: -0.3, side: -0.55, up: 0.3, color: "#dce8ff", range: 3, intensity: 2.6 },
  ],
} as const;
