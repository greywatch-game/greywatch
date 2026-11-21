/**
 * puffTexture.ts — The one puff in the game: a soft blob with a lumpy edge,
 * generated so the game still ships no image files.
 * Owns: the drawing and nothing else. A rotor's downwash (`RotorWash`) is this
 * texture seen a few dozen times in one place; a blast's dust and smoke were
 * too, until they became drawn billows (`BlastFx`). Size, rotation, colour and
 * count are what vary a cloud, never the sprite.
 * Invariants: no state that outlives the call. It is a function rather than a
 * shared instance because each system holds its own texture and releases it
 * with itself (`TextureMaker.release`). The canvas is painted as the
 * `DynamicTexture` it was painted on, and made OUR texture as Babylon made that
 * one (`TextureMaker.picture`, `BABYLON_EXIT.md` X5.4d): 128 square, flipped,
 * no mips, sampled flat.
 *
 * Three overlapping gradients at FIXED offsets rather than random ones — one
 * texture is shared by every puff in every cloud a system holds, so the variety
 * has to come from rotation and size, and a texture that differed between page
 * loads would only make a screenshot diff lie.
 *
 * It needs a canvas, which is what makes it a CLIENT-only file: the multiplayer
 * server runs the grenade SIMULATION alone and never builds a picture
 * (`GrenadeFx`, `RotorWash`), so nothing on that side reaches this.
 */
import { type MadeTexture, newCanvas, SAMPLING, type TextureMaker } from "../render/TextureMaker";

export function buildPuffTexture(textures: TextureMaker, name: string): MadeTexture {
  const size = 128;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const lobes: [number, number, number][] = [
    [64, 64, 46],
    [46, 52, 30],
    [82, 74, 26],
  ];
  for (const [x, y, r] of lobes) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.45)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return textures.picture({ label: name, canvas, flipY: true, mips: false, sampling: SAMPLING.flat });
}
