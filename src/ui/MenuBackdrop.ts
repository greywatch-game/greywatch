/**
 * MenuBackdrop.ts — The photograph the front end stands on: the chosen map's
 * shot, under the card, cross-faded when the map changes.
 * Owns: `#menu-shot`, its two picture layers and which of them is in front,
 * and the URL the front one was last asked to show. Styling is `backdrop.css`,
 * imported here.
 *
 * **ONE backdrop, handed to every screen that stands on it.** `Game` builds it
 * and gives it to `OverlayScreen` (the menu, the building card and the
 * round-over card put their map up, and the pause and `hide` take it down) and
 * to `LobbyScreen` (the photograph of the map its cursor is on). One picture
 * with one cross-fade is why it is shared rather than copied: the lobby's map
 * and the menu's can never both be up, and a step on either screen is the same
 * fade. The overlay used to own it and the lobby reached it through
 * `OverlayScreen.showBackdrop`.
 *
 * Invariants:
 *  - **It is a root of its OWN on `#hud`, never markup inside `#overlay`**,
 *    and both halves of that are load-bearing. It has to survive the card
 *    being rewritten — the round-over card and a fresh raise both rewrite it,
 *    and a layer removed and re-inserted has no style to interpolate FROM, so
 *    the cross-fade would jump-cut. And it has to sit UNDER the scrim, which
 *    is the card's own background: a child of `#overlay` paints over its
 *    parent's background whatever its z-index, so a photograph inside the
 *    card would put the picture on top of the gradients that make the type
 *    over it legible.
 *  - **Its z-index is 9 (`backdrop.css`) and `#overlay`'s is 10**, and it is
 *    built just before `OverlayScreen` so DOM order agrees with them. Nothing
 *    rests on the order, but a reader looking at the elements should not
 *    have to check.
 *  - **`hide` takes the CONTAINER down, never the layers**, so coming back to
 *    the menu on the same map brings the same picture back without
 *    re-decoding or re-fading it.
 *  - It knows nothing about cards, states or rounds. Which screen may raise it
 *    is decided by who is holding it: the overlay only on the three cards
 *    that stand on a photograph, the lobby only while it is up — and the
 *    lobby is only ever raised over the menu.
 */
import "./backdrop.css";
import type { MapDef } from "../world/maps";
import { mapShotUrl } from "./mapShots";

/** The front end's photograph. See the header. */
export class MenuBackdrop {
  private readonly root: HTMLElement;
  /**
   * The two picture layers. One is showing and the other is where the next
   * one is prepared; a cross-fade swaps which is which. Two rather than one
   * because `background-image` cannot be transitioned.
   */
  private readonly layers: [HTMLElement, HTMLElement];
  private front = 0;
  /**
   * What the front layer was last asked to show. `undefined` covers both "no
   * screen has raised the backdrop yet" and "this map has no shot", which is
   * why a map without one fades the picture OUT rather than leaving the last
   * map's behind it.
   */
  private url: string | undefined;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "menu-shot";
    this.layers = [this.buildLayer(), this.buildLayer()];
    for (const layer of this.layers) this.root.appendChild(layer);
    document.getElementById("hud")!.appendChild(this.root);
  }

  /**
   * Puts a map's photograph up, cross-fading from whatever was there.
   *
   * The menu calls this from `showMenu` rather than from the cursor, because
   * the backdrop follows the map that has been CHOSEN and not the row the
   * cursor happens to be resting on — so it is called exactly when the answer
   * changes. The lobby calls it when the map its screen is ABOUT changes.
   *
   * It waits for the image to DECODE before swapping. A fade into a layer the
   * browser has not finished decoding is a fade into a blank rectangle and
   * then a pop, which on a cold boot is every first visit to this screen; the
   * cost of waiting is that the very first backdrop arrives a frame or two
   * after the card it is behind, which is the harmless half of the trade.
   *
   * The `url` guard is what makes stepping quickly along the reel safe:
   * whichever pick is the latest owns the swap, and a decode that comes back
   * after a later one has already been asked for is dropped rather than
   * fighting it for the front layer.
   */
  show(map: MapDef | undefined): void {
    // Raised by the fact of being called: only a screen that stands on the
    // picture calls this, and one that does not takes it down with `hide`.
    this.root.classList.add("on");
    const url = map ? mapShotUrl(map.id) : undefined;
    if (url === this.url) return;
    this.url = url;
    // A map with no shot of its own takes the picture away rather than
    // leaving the last one up, which would be a caption's worth of lie.
    if (!url) {
      this.layers[this.front].classList.remove("on");
      return;
    }
    const img = new Image();
    img.src = url;
    const raise = () => {
      if (this.url !== url) return;
      const back = this.layers[1 - this.front];
      back.style.backgroundImage = `url("${url}")`;
      back.classList.add("on");
      this.layers[this.front].classList.remove("on");
      this.front = 1 - this.front;
    };
    // A rejection is a build missing its own asset, and there is nothing to
    // fall back TO but the scrim the picture is already under — so the last
    // backdrop stays and the screen is the one it was before shots existed.
    img.decode().then(raise, () => {});
  }

  /**
   * `show`, for a card that NAMES the map — the building card and the
   * round-over card.
   *
   * A picture the layers are already holding (the menu's, on the same map)
   * goes straight back up; any other has to decode first, and until it has,
   * the LAST map's photograph must not stand behind this one's name — so the
   * front layer comes down and the scrim stands over the scene. The menu does
   * not want this: a step along its reel is a cross-fade, and the last map's
   * picture under the new one's name is that fade's first half.
   */
  showNamed(map: MapDef): void {
    if (mapShotUrl(map.id) !== this.url) {
      this.layers[this.front].classList.remove("on");
    }
    this.show(map);
  }

  /**
   * Takes the backdrop down — the container, not the layers (see the header).
   *
   * The pause calls this, and the overlay's `hide`: what a pause stands over
   * is a live round, and a photograph of a map behind the round you are
   * playing on it is two of the same place at once.
   */
  hide(): void {
    this.root.classList.remove("on");
  }

  /** One picture layer. Empty until a map is chosen. */
  private buildLayer(): HTMLElement {
    const el = document.createElement("div");
    el.className = "ov-shot";
    return el;
  }
}
