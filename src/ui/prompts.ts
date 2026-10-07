/**
 * prompts.ts — The key or pad button drawn ON a control, for the device in hand.
 * Owns: `InputDevice`, `glyph` (the markup of one prompt), `guessDevice`
 * (what a screen assumes before any device has spoken) and `markDevice` (the
 * `dev-*` class write every screen's `setInputDevice` makes).
 * Invariants: holds no state and reads no input — `Game` pushes the device to
 * each screen that draws prompts, and the screen writes it as a `dev-*` class on
 * its own root through `markDevice`. The stylesheet does the rest (`kbd.gl` in
 * `base.css`).
 *
 * Shared by every screen laid out like a console front end: the main menu,
 * the round-over card and the pause (`OverlayScreen`), the kit screen
 * (`LoadoutScreen`), the settings screen (`SettingsScreen`), the lobby
 * (`LobbyScreen`) and the deploy screen (`DeployScreen`). A new screen
 * drawing prompts imports these and adds its root to the `:is(...)` list in
 * `base.css`; it does not write another copy.
 */

/**
 * Which device the player has in hand, as far as the prompts are concerned.
 * `Game` pushes it (`setInputDevice` on each screen); no screen reads
 * `InputManager`.
 */
export type InputDevice = "kbm" | "pad" | "touch";

/**
 * A PROMPT: the key or the button that reaches a control, drawn ON the control
 * the way a console front end draws one, for whichever device is in hand.
 *
 * Both labels are written into the markup and the STYLESHEET picks one, off
 * the `dev-*` class on the screen's root — so the player picking up a pad turns
 * every prompt on the screen over in one class write, without a redraw, and a
 * prompt with no label for the device in hand is simply not drawn. Touch gets
 * none at all: the control under the finger is its own prompt.
 */
export function glyph(key: string | null, pad: string | null): string {
  return `<kbd class="gl"${key ? ` data-k="${key}"` : ""}${pad ? ` data-p="${pad}"` : ""}></kbd>`;
}

/**
 * The device a screen assumes until one has actually been used. Guessed from
 * the POINTER — a phone's first frame has touched nothing, and prompting it for
 * Enter would be the one wrong answer.
 */
export function guessDevice(): InputDevice {
  return typeof matchMedia === "function" &&
    matchMedia("(hover: none) and (pointer: coarse)").matches
    ? "touch"
    : "kbm";
}

/** Every device, for the class write below. */
const DEVICES: readonly InputDevice[] = ["kbm", "pad", "touch"];

/**
 * Puts `device` on a screen's root as its `dev-*` class and takes the other
 * two off, which turns every prompt on that screen over in one write.
 *
 * The write itself and nothing else. Each screen's `setInputDevice` keeps the
 * device it last wrote and compares before calling this, so `Game` can push
 * the device every frame and the DOM hears only a change. The overlay also
 * skips the write on a card that draws no prompts.
 */
export function markDevice(root: HTMLElement, device: InputDevice): void {
  for (const d of DEVICES) root.classList.toggle(`dev-${d}`, d === device);
}
