/**
 * FlameShader.ts — The one material every open fire in the world wears: a
 * vertex-animated, hard-banded flame drawn as if by hand — what our renderer
 * draws every fire with, as data (`FlameRecipe`, `render/FlameDraw.ts`, since
 * `BABYLON_EXIT.md` X4.4d), the fire's bloom included. No mesh wears this
 * material: it is a RECIPE KEY (the merge keys a fire's surfaces by it,
 * `isFlame`) — a Babylon `ShaderMaterial` until X6.1c, which drew nothing
 * after its Babylon stages went at X5.3d, and one of OUR keys since
 * (`MaterialKey.ts`).
 * Owns: the inks a fire is painted in, the `FlameMaterial` class, and its own
 * values as our renderer reads them (`values`: the motion, the paint and the
 * clock — the eye, the wind's bearing, the fog and the opaque alpha being the
 * FRAME's there, `render/frame.ts`). The program's body is `wgsl/flame.ts`'s,
 * which our renderer assembles (`render/flameProgram.ts`). Reads its motion
 * from `CONFIG.graphics.flame`; is fed the world clock by
 * `CelMaterialFactory`, which is the only thing that makes one (`getFlame`);
 * the frame's opaque alpha it is drawn under is 0 (no bake draws a fire,
 * `FINDINGS.md` 51).
 * Invariants: the geometry it draws is `world/flame.ts`'s, whose UV channel is
 * the whole of its per-vertex vocabulary (below) — nothing else may wear it.
 * It never casts a shadow (the world's map re-renders only when its focus moves, so an
 * animated caster turns it into a per-frame redraw) and never takes a vertex
 * colour buffer (`vertexShading` skips it). Every DERIVATIVE the fragment
 * stage takes is taken before its first branch on the layer — WGSL defines
 * one only in uniform control flow, and the layer is a varying. Every value
 * in `values` is written in place, as `Float32Array` rounds it — what the
 * material's uniform buffer held, number for number.
 * Never: restates a body (`wgsl/flame.ts`); imports anything of Babylon's but
 * its colour and vector maths (X6.1e's to move).
 * Contract: `docs/rendering.md`, "The fire".
 *
 * WHY IT IS NOT `getEmissive`. A fire was a static glowing cone, and nothing
 * about an unlit emissive can move a vertex. The look it keeps is the
 * one the rest of the frame is in: no gradient anywhere, just flat bands with
 * hard edges, and a pen line in the fire's own darkest ink where the flame is
 * eaten, in place of the ink pass, which a glowing surface cannot carry
 * without swallowing its own glow.
 *
 * WHAT A FIRE IS, IN FOUR LAYERS OF ONE MESH (`uv.x`'s whole part):
 *
 * - **0, the OUTER tongues** — crimson skin over an orange body, outlined in
 *   oxblood wherever the flame is eaten. Their tips are eaten away by a noise
 *   field scrolling UP through them, so what is left of a tongue's top breaks
 *   off and rises as a lick of its own, and their silhouettes are bitten
 *   harder toward the tip so each one ends on a brush POINT, hooked over.
 * - **1, the CORE** — gold over a white-hot heart, shorter, standing inside the
 *   outer tongues. It is SEEN because the outer tongues are wound INSIDE OUT
 *   (`world/flame.ts`): only their far wall is drawn, whose silhouette is the
 *   whole tongue's, so the core is always nearer than the orange behind it —
 *   which is how a drawn fire puts its yellow over its orange, with nothing
 *   biased in depth that could draw the core through a grate or a jamb.
 * - **2, the EMBERS** — tiny spheres riding a loop up out of the fire, drawn
 *   out into STROKES along their climb. Each is moved rigidly and shrunk about
 *   its own centre, which is recovered from its (radial) normal, because a
 *   merge has baked away every other way to find it.
 * - **3, the BOUNDS** — a degenerate triangle stood where the embers, the lean
 *   and the hook can reach, so the frustum cull of a merged mesh knows the
 *   fire is taller than its rest pose. It has no area and draws nothing.
 *
 * There is NO SMOKE, and that was tried: a soot plume in this material is
 * opaque and unlit, and every way it was cut read as floating leather or
 * black rock rather than as smoke — volume needs either light it does not
 * have or a screen-space hatch, which is a lattice the eye can see.
 *
 * `uv.x`'s fraction is a per-tongue (or per-ember) SEED. `uv.y` is `t + 4 *
 * cm`: `t` is height up the tongue, 0 at the root and 1 at the tip (an ember's
 * is its phase), and `cm` is the height of the whole FIRE in centimetres —
 * which is what lets every distance in the motion, and the noise's own scale,
 * be a share of the fire's size, so a candle moves and burns like a bonfire.
 *
 * **The boil is drawn on twos.** The shape and its bands advance at
 * `flame.fps`, not at the display's rate — the fire changes drawing a dozen
 * times a second, which is what makes it read as an animated drawing rather
 * than a simulation. The embers are the exception and move on the smooth clock:
 * a point stepping up the screen is a stutter, not a style.
 *
 * The clock is the WORLD's (`CelMaterialFactory.updateWind`'s), so a pause that
 * holds the canopy holds the fire.
 */
import { Color3, Vector2, Vector3, Vector4 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { FlameField, FlameRecipe } from "../render/flameProgram";
import { MaterialKey } from "./MaterialKey";

/**
 * The inks a fire is painted in, coolest first. Art, not tuning — and
 * exported, because a blast's fireball (`BlastShader`) is painted in the same
 * five: one fire in this world, whether it is a brazier or a grenade.
 */
export const FIRE_INKS = {
  char: "#4a0c07",
  deep: "#a8190c",
  mid: "#f5541a",
  hot: "#ffb12e",
  core: "#fff5d8",
} as const;
const CHAR = FIRE_INKS.char;
const DEEP = FIRE_INKS.deep;
const MID = FIRE_INKS.mid;
const HOT = FIRE_INKS.hot;
const CORE = FIRE_INKS.core;

/**
 * What the glow reads as this material's colour — the orange of the body of
 * the fire, which is the old cone's `#ff8a2a` and so the bloom it always had.
 */
const GLOW = "#ff8a2a";

/**
 * The fire. One per `CelMaterialFactory`, shared by every flame in the world,
 * which is what lets a block's fires merge into one draw.
 */
export class FlameMaterial extends MaterialKey implements FlameRecipe {
  /** The fire's bloom colour, never null (the constructor's comment). */
  declare readonly emissiveColor: Color3;

  /**
   * What our renderer draws a fire of a round with (`render/FlameDraw.ts`):
   * the fire's own values, each the `Float32Array` its uniform block rounds
   * the same number to — written in place, so a reader holding the record
   * sees every later write (the clock). The eye, the wind's bearing, the fog
   * and the opaque alpha are not here: they are the FRAME's
   * (`CelMaterialFactory.fillFrame`).
   */
  readonly values: Readonly<Record<FlameField, Float32Array>>;

  constructor() {
    // `emissiveColor` is what `WorldCulling` and the handover read to know
    // this is a light source — the property an emissive carries, and the
    // only thing either asks — and the fire's bloom colour (`Game`'s glow
    // rules).
    super("flame", "flame", { emissiveColor: Color3.FromHexString(GLOW) });
    const f = CONFIG.graphics.flame;
    const v = {
      time: new Float32Array(1),
      motion: new Float32Array(4),
      curl: new Float32Array(2),
      embers: new Float32Array(4),
      boil: new Float32Array(3),
      charColor: new Float32Array(3),
      deepColor: new Float32Array(3),
      midColor: new Float32Array(3),
      hotColor: new Float32Array(3),
      coreColor: new Float32Array(3),
    };
    // The motion and the paint, each through the Babylon type the material's
    // setter took, so every number rounds as its uniform held it.
    new Vector4(f.fps, f.writhe, f.lean, f.lick).toArray(v.motion);
    new Vector2(f.hook, f.embers.stretch).toArray(v.curl);
    new Vector4(f.embers.rise, f.embers.rate, f.embers.drift, f.embers.radius).toArray(v.embers);
    new Vector3(f.ragged, f.climb, f.bite).toArray(v.boil);
    Color3.FromHexString(CHAR).toArray(v.charColor);
    Color3.FromHexString(DEEP).toArray(v.deepColor);
    Color3.FromHexString(MID).toArray(v.midColor);
    Color3.FromHexString(HOT).toArray(v.hotColor);
    Color3.FromHexString(CORE).toArray(v.coreColor);
    this.values = v;
  }

  /** The world clock, into `values`. */
  setClock(seconds: number): void {
    this.values.time[0] = seconds;
  }
}

/** Whether a material is the fire — `vertexShading` asks, to leave it unbaked. */
export function isFlame(material: MaterialKey | null): material is FlameMaterial {
  return material instanceof FlameMaterial;
}
