/**
 * math.ts — the scalar helpers more than one file needs, and the one place each
 * of them is written down.
 * Owns: `clamp`, `clamp01`, `hermite`, `smoothstep` and `angleDelta`.
 * Owns NO state, NO tunable and NO geometry. It imports NOTHING — not
 * `@babylonjs/core`, not `CONFIG` — and that is the property that makes it
 * safe to import from anywhere.
 *
 * ## Why this file exists, measured
 *
 * These had drifted into per-file copies, which is what a codebase with no
 * shared leaf does. `clamp(v, lo, hi)` was defined **nine times** — and not as
 * nine copies of one function, but as THREE implementations that disagree:
 * `Math.max(lo, Math.min(hi, v))` (`InputManager`, `AimAssistSystem`),
 * `Math.min(hi, Math.max(lo, x))` (`Sky`), and the ternary the other six used.
 * They agree on every input any caller passes and differ on inverted bounds,
 * which is the shape of a bug that is invisible until the day it is not.
 *
 * **`smoothstep` was worse, because the same NAME meant three things.** One
 * file's was `(x)`, another's `(edge0, edge1, x)`, a third's `(a, b, v)`, a
 * fourth called the identical curve `smoothCurve`, and a fifth — `ViewModel`'s
 * — was called `smoothstep01` and did NOT clamp, while the one in
 * `AimAssistSystem` under that exact name did. Reading `smoothstep(` told you
 * nothing about arity or about whether it clamped.
 *
 * **The first fix for that was itself a bad pattern, and this is the second.**
 * Naming them `hermite01` / `smoothstep01` / `smoothstep` collapsed the arity
 * problem and replaced it with a suffix that meant three different things —
 * `clamp01`'s `01` is the OUTPUT range, `smoothstep01`'s was an INPUT clamp it
 * performed, and `hermite01`'s was an unchecked PRECONDITION. A reader still
 * had to open the file. So the suffix is gone from everything but the one name
 * where it is unambiguous and idiomatic, and the set is now two functions that
 * cannot be confused for each other:
 *
 * - **`hermite(t)`** is the POLYNOMIAL, `3t² - 2t³`, and clamps nothing. Named
 *   for the curve it actually is, so nothing about it suggests a range.
 * - **`smoothstep(edge0, edge1, x)`** is the GLSL function every graphics
 *   programmer already knows, with its own arity, and it clamps.
 *
 * There is deliberately NO one-argument clamped form, because
 * `smoothstep(0, 1, t)` already is one and spelling it that way puts the bounds
 * on the line instead of in a suffix.
 *
 * ## Why it is in `core/` and why that is not the wiring rule being bent
 *
 * `CLAUDE.md`'s rule is that SYSTEMS never import each other and that `Game` is
 * where they meet. A system importing this is not that: **this module imports
 * nothing at all**, so an edge to it is an edge to a leaf and never a path to
 * `Game`, `InputManager` or any other module in this directory. It sits beside
 * `prefs.ts` and `settings.ts`, which are leaves in the same sense. The
 * established precedent for "a leaf everything may import" is `config/`, and
 * the division between that one and this one is exact: **`config/` holds
 * NUMBERS a designer tunes, this holds FUNCTIONS with no numbers in them.** A
 * tunable that arrives here is in the wrong file.
 *
 * ## What must never happen here
 *
 * **No function with one caller.** This is a place duplication is collapsed
 * into, not a drawer for loose helpers — a single-caller function is cheaper
 * and clearer next to the code that calls it, and moving it here only puts
 * distance between it and its reason. `Sky`'s `wrap01`, `BotSkill`'s
 * `clamp01Index`, `NetSoldier`'s `lerpAngle` and `AimAssistSystem`'s `wrapPi`
 * all stayed where they are for exactly that reason, and one of them growing a
 * second caller is the event that moves it, not a tidy-up. A `[-1, 1]` clamp
 * WAS written here once and then taken back out under this rule, having had a
 * single caller — see `clamp01`.
 *
 * **Nothing that touches a `Vector3`.** Vector work belongs beside the geometry
 * that owns it — `world/boxGeometry.ts` is where that already lives — and an
 * import of `@babylonjs/core` here would cost this module the one property the
 * section above rests on.
 */

/**
 * `v` held inside `[lo, hi]`.
 *
 * **On inverted bounds this returns `hi`, and that is decided rather than
 * accidental**: with `lo > hi` the first test fails for anything above `lo` and
 * the second then pins it to `hi`. The three implementations this replaced each
 * answered that differently and no caller in the tree can reach it — every
 * call site passes literals (`-1, 1`, `0, 1`) or a non-negative magnitude
 * mirrored about zero (`-pull, pull`, `-cap, cap`). It is written down so that
 * a future caller with dynamic bounds knows what it gets instead of finding
 * out.
 *
 * `NaN` in is `NaN` out, which every form it replaced also did.
 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * `v` held inside `[0, 1]` — the common case, without the two constants.
 *
 * **The one `01` left, and it is unambiguous**: `01` is the range this returns,
 * which is the reading `Mathf.Clamp01` and HLSL's `saturate` have already
 * fixed. It survived the rename that removed the suffix from the two curve
 * helpers precisely because it is the only one where the suffix describes the
 * OUTPUT rather than a precondition or an internal step.
 *
 * **There is no `clampUnit`, and its absence is deliberate.** A `[-1, 1]` guard
 * for `Math.acos`/`Math.asin` — whose argument is a cosine or a sine that
 * floating-point drift can carry a few ULPs out of domain, where the answer is
 * `NaN` rather than a large angle — is spelled `clamp(x, -1, 1)`, which is what
 * `AimAssistSystem` and `Sky` already spelled it before this file existed.
 * "Unit" reads as `[0, 1]` to as many people as read it `[-1, 1]`, so a name
 * for it bought ambiguity and a third spelling of one idea.
 */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The cubic Hermite curve `3t² - 2t³`, RAW — `t` outside `[0, 1]` is not
 * clamped and the curve runs away, which is the caller's business.
 *
 * Named for the polynomial rather than for a range, because a range in the name
 * is what made the last version of this file confusing: it is the SHAPE, and
 * where its input comes from is the caller's to state. Reach for it when the
 * input is a fraction by construction — a blend that is already `0..1`, or a
 * fade between two noise lattice points — and for `Sky`'s noise in particular,
 * where it runs three times per sample and the divide `smoothstep` would add is
 * worth avoiding. When the input is NOT known to be in range, that is
 * `smoothstep(0, 1, t)`.
 */
export function hermite(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The GLSL-shaped ramp: 0 at or below `edge0`, 1 at or above `edge1`, eased
 * between.
 *
 * **The `|| 1e-6` is a divide guard and it is deliberate.** With `edge0 ===
 * edge1` the ratio is a division by zero, and what comes back is `Infinity`,
 * `-Infinity` or — when the numerator is zero too — `NaN`, which `clamp01`
 * passes straight through onto whatever the value was going to drive. Two of
 * the copies this replaced had the guard and one did not; the guarded form is
 * taken because it is identical for every `edge0 !== edge1` and is an answer
 * rather than a `NaN` for the case that is left.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/**
 * The signed shortest angle from `a` to `b`, in radians, wrapped to
 * `[-PI, PI]`.
 *
 * Turning "where it is" and "where it should point" into "how far to turn, and
 * which way" — the question every turret, hull, camera and compass bearing in
 * this game asks. **It lived on `entities/Vehicle.ts`, whose own comment said a
 * second copy of it "is exactly the kind of thing that gets a sign wrong once"
 * — and `ui/HUD.ts` held exactly that second copy anyway.** Being on a leaf
 * rather than on the hull is what stops the third one: `HUD` was never going to
 * import a vehicle to draw a damage arc.
 */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
