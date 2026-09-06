/**
 * puffTexture.ts — The one puff in the game: a soft blob with a lumpy edge,
 * generated so the game still ships no image files.
 * Owns: the drawing and nothing else. Every cloud in the game is this texture
 * seen a few dozen times in one place — a blast's dust and its smoke column
 * (`GrenadeSystem`'s `BlastDust`) and a rotor's downwash (`RotorWash`) — and
 * what tells them apart is size, rotation, colour and count, never the sprite.
 * Invariants: no state that outlives the call. It is a function rather than a
 * shared instance because a `DynamicTexture` belongs to a scene, and an editor
 * rebuild disposes one; each system holds its own and disposes it with itself.
 *
 * Three overlapping gradients at FIXED offsets rather than random ones — one
 * texture is shared by every puff in every cloud a system holds, so the variety
 * has to come from rotation and size, and a texture that differed between page
 * loads would only make a screenshot diff lie.
 *
 * It needs a canvas, which is what makes it a CLIENT-only file: the multiplayer
 * server runs the same `GrenadeSystem` under a `NullEngine` and passes
 * `{ dust: false }` precisely so nothing reaches this.
 */
import { DynamicTexture, type Scene } from "@babylonjs/core";

export function buildPuffTexture(scene: Scene, name: string): DynamicTexture {
  const size = 128;
  const texture = new DynamicTexture(
    name,
    { width: size, height: size },
    scene,
    false,
  );
  const ctx = texture.getContext();
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
  texture.update();
  texture.hasAlpha = true;
  return texture;
}
