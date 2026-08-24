/**
 * Dither.ts — One LSB of triangular noise, added to a colour immediately
 * before it is written out.
 * Owns: `DITHER_GLSL`, the snippet the three surface shaders paste in. Owns no
 * state, no uniforms and no plugin — there is nothing here to configure.
 * Invariant: it must run on the value being QUANTISED, which means last, and it
 * must not be animated. Contract: `docs/rendering.md`.
 *
 * WHY THIS EXISTS. The whole chain is 8-bit: `DefaultRenderingPipeline` is built
 * with `hdr = false`, so the scene is quantised the instant it lands in FXAA's
 * input render target. Over that sit the two widest, shallowest gradients the
 * cel shader draws — the `t*t` distance fog across a 22→78 m band, and the
 * exponential ground mist under it. A gradient that shallow crosses a
 * quantisation step every few degrees of screen, and every crossing is a
 * contour: measured at nearly SEVEN PIXELS wide on a plain village wall.
 *
 * WHY IT IS NOT IN THE GRADE, WHICH IS WHERE A DITHER NORMALLY GOES. Three
 * reasons, and the third is the one that decides it:
 *
 * - `HorrorPost` is **detachable by a player setting**, and the contract for the
 *   post chain is that a setting which turns an effect off REMOVES its pass. A
 *   dither living there would be a correctness fix that disappears.
 * - A new always-attached fifth full-screen pass costs a full read and write of
 *   the frame — exactly what `FINDINGS.md` §5 counts — to run three instructions.
 * - **With the grade attached there is nothing to fix.** Its grain is
 *   `(n - 0.5) * 0.055 * (1.3 - lum * 0.6)`, never less than about ten LSB of
 *   noise; it is already dithering the frame, far past what a dither needs. The
 *   banding is a **grade-off** artefact, and the grade-off frame is the one
 *   configuration a pass inside the grade cannot reach.
 *
 * So the noise goes in at the source, in the three shaders that draw the
 * gradients, where it is free and where the information still exists.
 *
 * MEASURED, on Hollowmere, one vantage per process run, grade detached, ash
 * stopped, `sky.update` pinned and the world held under the pause lid. A
 * vertical scanline counting RUNS of identical 8-bit green — a banded ramp is a
 * few long runs, a dithered one is the same mean value broken up:
 *
 * | scanline                          | before           | after            |
 * | --------------------------------- | ---------------- | ---------------- |
 * | 202 px of fog band on a cel wall  | 30 runs, 6.73 px | 98 runs, 2.06 px |
 * | 360 px of open sky (see below)    | 233 runs, 1.55   | 229 runs, 1.57   |
 *
 * with the value range unchanged (91..137 against 92..138), which is what says
 * the runs broke up rather than the picture changing.
 *
 * **The sky was the expected customer and turns out not to need it**, which is
 * why the row is here rather than the change: its dome ramp is painted over with
 * stars, the galactic band and the halo's additive bloom, and the cloud decks
 * sit in front of it, so it arrives at 1.55 px runs already and a dither moves
 * nothing. `Sky.apply` carries the same note beside the material that does not
 * get one. Anything that ever flattens that dome — a starless overcast, a map
 * with no halo — puts the question back.
 */

/**
 * Triangular-PDF dither at one LSB, keyed on the pixel and NOT on time.
 *
 * Two independent uniform hashes subtracted give a triangular distribution over
 * [-1, 1] — the textbook 8-bit TPDF, ~0.41 LSB RMS. It is what breaks a
 * quantisation step into noise rather than moving it somewhere else, which is
 * what a single uniform hash (rectangular) does.
 *
 * **One LSB, not half.** A half-LSB dither sits below the step it exists to
 * break and stops working on exactly the shallowest gradients — the fog band and
 * the mist, which are the two this is here for.
 *
 * **Static, not animated.** Hashing on time as well would make it grain, and
 * grain is the grade's job and the player's choice; this is a correctness fix to
 * the quantiser and has to be there whatever the player turned off. It also
 * composes with anything else keyed on `gl_FragCoord` rather than beating
 * against it.
 *
 * Paste into a fragment shader and call `dither(col)` on the last value before
 * `gl_FragColor`. Requires `gl_FragCoord`, which is always available.
 */
export const DITHER_GLSL = `
float ditherHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Triangular-PDF dither, +/- 1 LSB of an 8-bit channel. See Dither.ts.
vec3 dither(vec3 col) {
  float d1 = ditherHash(gl_FragCoord.xy);
  float d2 = ditherHash(gl_FragCoord.xy + 17.31);
  return col + (d1 - d2) * (1.0 / 255.0);
}
`;
