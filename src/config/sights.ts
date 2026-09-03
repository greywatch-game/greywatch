/**
 * config/sights.ts — the optics the player can fit.
 * Owns: the sight table (its keys ARE `SightId`). Contract: `docs/weapons.md`.
 * Gotcha: the table's ORDER is the loadout row, and `magnification` is the one
 * number the aimed FOV, look sensitivity and zoom compensation are derived
 * from. `eyeRelief` is the aimed stand-off — it lives here, not in `viewmodel`.
 */

/**
 * The optics the player can fit, and everything that differs between them.
 * The keys ARE the sight ids — `SightId` in `entities/sights.ts` is derived
 * from this table, so adding an optic here and a builder in `optics.ts` is
 * the whole job.
 *
 * Every sight fires the same bullets: damage, spread and recoil are the
 * rifle's, not the optic's. What an optic changes is what you can SEE and
 * how fast you can bring it to bear, which is the trade the loadout screen
 * is asking you to make.
 *
 * `magnification` is the one number the rest is derived from — the aimed
 * FOV (`2*atan(tan(fovHip/2) / magnification)`), the look sensitivity (see
 * `camera.adsLookMouse`) and the viewmodel's zoom compensation
 * (`viewmodel.adsMagReference`) all fall out of it. Holo is 1.6, which is
 * exactly the 0.62 rad the camera used before optics were a choice, so
 * fitting it reproduces the shipped weapon frame for frame.
 *
 * **Written in ascending magnification, because that order IS the loadout
 * row** — `SIGHT_IDS` is `Object.keys` of this table, and it is what the
 * buttons are drawn in and what left/right steps through. A sight inserted
 * out of order puts a 3.5x scope between two red dots.
 */
export const sights = {
  /**
   * A miniature reflex sight: one lit dot floating in an open frame, and
   * the least zoom in the kit. Nothing to line up and almost nothing in the
   * way — where the irons put a post and a ring in the picture, this puts a
   * dot on the target and leaves the rest of the frame alone. The cost is
   * that it is a sight to bring UP rather than a leaf already standing, so
   * the irons still beat it to the shoulder.
   */
  reflex: {
    name: "Reflex",
    magnification: 1.15,
    /**
     * Distance from the eye to the sight's own eye reference, aimed (m).
     *
     * This is half of a PAIR — `optics.ts` measures every dimension of the
     * sight against it, so the two only mean anything together. What the
     * eye sees through a sight is an angle: shorten this and shrink the
     * optic by the same factor, and the sight picture is identical while
     * the thing on the weapon is smaller. That is exactly what was done to
     * the original three, which had been sized for an eye held so far back
     * that the optics came out wider than the receiver they stood on.
     * Changing one of the two alone re-sizes the picture instead.
     *
     * The shortest here, and that is what makes this a mini dot rather than
     * a small holo: the whole assembly is measured against it, so an eye
     * held closer buys the same window on a smaller sight.
     */
    eyeRelief: 0.28,
    adsSpeedMult: 1.15,
  },
  /**
   * Irons: a rear aperture and a hooded front post. No glass at all, and
   * still the fastest to the shoulder — there is nothing to raise, which is
   * the one thing the reflex cannot match. What it costs is the picture: a
   * post that covers what it is aimed at and a ring around everything else.
   */
  iron: {
    name: "Iron",
    magnification: 1.35,
    /** See `reflex.eyeRelief` — the pairing every dimension is measured against. */
    eyeRelief: 0.33,
    /** Multiplier on `camera.adsBlendSpeed` — how fast it comes up. */
    adsSpeedMult: 1.2,
  },
  /** The shipped holographic sight: a lit ring and dot on a tube optic. */
  holo: {
    name: "Holo",
    magnification: 1.6,
    eyeRelief: 0.38,
    adsSpeedMult: 1,
  },
  /**
   * A 2.5x prismatic sight with an etched chevron: a short one-piece body on
   * an integral mount, sitting between the holo and the scope at both ends.
   * It magnifies enough to make a body across the square a target rather
   * than a smudge, and keeps enough field to swing onto a second one.
   */
  prism: {
    name: "Prism",
    magnification: 2.5,
    /**
     * Short, and shorter than the picture alone would ask for. A prism is
     * built around a glass block rather than a long air path, and it is the
     * eye relief that pays for that: this is barely past the scope's, and it
     * is what keeps a 2.5x optic to a body the length of the receiver's
     * ejection port rather than a second scope.
     */
    eyeRelief: 0.18,
    adsSpeedMult: 0.88,
  },
  /**
   * A 3.5x telescopic sight with a duplex reticle. Slow to raise and a
   * tunnel to look down, and the only thing on the rifle that will show you
   * a body at the far end of the valley.
   */
  scope: {
    name: "Scope",
    magnification: 3.5,
    /**
     * Short, and that is what makes it a scope rather than a pipe. The eye
     * looks down a real hollow tube here, so how much of the frame is clear
     * is set by the far rim's angular size — pull the eye back and the rim
     * shrinks until the sight picture is a keyhole, or the tube has to grow
     * to hold it, which is what made this one a drainpipe. Close in, the
     * near rim passes off the top and bottom of the screen and what is left
     * is a magnified circle in a dark surround.
     *
     * The floor under it is the camera's near plane (`CameraSystem` sets
     * 0.05): this is scaled by `zoomComp` before it becomes a stand-off, so
     * the eyepiece sits about 0.07 m out and any less would clip it open.
     */
    eyeRelief: 0.17,
    adsSpeedMult: 0.75,
  },
  /**
   * A 6x telescopic sight with a floating dot in a fine crosshair: the longest
   * reach on offer, and the last entry in this table for the reason the table
   * is written in this order.
   *
   * At 6x a man at 300 m subtends what a man at 50 m does through the irons,
   * which is the whole of what it buys — and the whole of what it costs is
   * that everything else is gone. The aimed field is 9.8 deg against the 3.5x
   * scope's 16.7, so a second target is not merely off-centre, it is outside
   * the tube; and a picture magnified six times is a HAND magnified six times,
   * which is why `swayMult` on the weapon this was built for is the lowest in
   * the game. Bring it up in a room and you are looking at a wall.
   *
   * **Its `eyeRelief` is the longest in the table and that is a constraint
   * rather than a style.** The aimed stand-off is `eyeRelief * zoomComp` and
   * `zoomComp` falls as the magnification rises (`viewmodel.adsMagReference` /
   * 6 = 0.267 here, against the 3.5x's 0.457), so the same 0.17 the scope uses
   * would put the eyepiece 0.045 m from the camera — INSIDE `CameraSystem`'s
   * 0.05 near plane, which clips the ocular open and turns the tube into a
   * hole. At 0.22 the eyepiece sits at 0.0587 m — measured, not derived — with
   * the geometry behind the sight centre clearing the plane by a comfortable
   * margin. Anything that raises the magnification without raising this breaks
   * the picture silently.
   *
   * The long relief is also what makes the OPTIC the biggest thing in the kit:
   * every dimension in `optics.ts` is measured against `eyeDistance`, so an eye
   * held further back buys the same angular picture on a larger sight. That is
   * the honest way round — this is the one optic that should look like it
   * weighs something.
   */
  longScope: {
    name: "Long Scope",
    magnification: 6,
    /** See the entry above: this is the near plane's number, not a taste. */
    eyeRelief: 0.22,
    /** The slowest optic here by a distance, and the pair with the sniper's own
     *  0.5 is the slowest thing in the game into the shoulder. */
    adsSpeedMult: 0.62,
  },
} as const;
