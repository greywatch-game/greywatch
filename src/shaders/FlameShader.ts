/**
 * FlameShader.ts — The one material every open fire in the world wears: a
 * vertex-animated, hard-banded flame drawn as if by hand — what our renderer
 * draws every fire with, as data (`FlameRecipe`, `render/FlameDraw.ts`, since
 * `BABYLON_EXIT.md` X4.4d), the fire's bloom included. No Babylon mesh wears
 * this material: it is a RECIPE KEY (the merge keys a fire's surfaces by it,
 * `isFlame`), and its Babylon stages and its glow-mask twin, which drew the
 * map editor's build's fires alone after X4.4d, were deleted at X5.3d — so
 * the `ShaderMaterial` names a program nothing declares, and a compile of it
 * is what the DEV counter of Babylon effect compiles exists to catch
 * (`core/babylonCompiles.ts`).
 * Owns: the inks a fire is painted in, the `FlameMaterial` class, and its own
 * values as our renderer reads them (`values`: the motion, the paint and the
 * clock — the eye, the wind's bearing, the fog and the opaque alpha being the
 * FRAME's there, `render/frame.ts`, the very numbers the factory pushes onto
 * this material). The program's body is `wgsl/flame.ts`'s, which our
 * renderer assembles (`render/flameProgram.ts`). Reads its motion from
 * `CONFIG.graphics.flame`; is fed the world clock, the fog and the eye by
 * `CelMaterialFactory`, which is the only thing that makes one (`getFlame`),
 * and writes the frame's opaque alpha, 0 (no bake draws a fire, `FINDINGS.md`
 * 51).
 * Invariants: the geometry it draws is `world/flame.ts`'s, whose UV channel is
 * the whole of its per-vertex vocabulary (below) — nothing else may wear it.
 * It never casts a shadow (the world's map re-renders only when its focus moves, so an
 * animated caster turns it into a per-frame redraw) and never takes a vertex
 * colour buffer (`vertexShading` skips it). Every DERIVATIVE the fragment
 * stage takes is taken before its first branch on the layer — WGSL defines
 * one only in uniform control flow, and the layer is a varying. Every value
 * in `values` is written in place, as `Float32Array` rounds it — what the
 * material's uniform buffer holds, number for number — off the same objects
 * the material is handed.
 * Never: restates a body (`wgsl/flame.ts`).
 * Contract: `docs/rendering.md`, "The fire".
 *
 * WHY IT IS NOT `getEmissive`. A fire was a static glowing cone, and nothing
 * about an unlit `StandardMaterial` can move a vertex. The look it keeps is the
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
import {
  Color3,
  ShaderLanguage,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type Material,
  type Scene,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { FlameField, FlameRecipe } from "../render/flameProgram";

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

const COMMON_UNIFORMS = [
  "world",
  "viewProjection",
  "camPos",
  "time",
  "windDir",
  "motion",
  "curl",
  "embers",
  "boil",
  "charColor",
  "deepColor",
  "midColor",
  "hotColor",
  "coreColor",
];

/**
 * The fire. One per `CelMaterialFactory`, shared by every flame in the world,
 * which is what lets a block's fires merge into one draw.
 */
export class FlameMaterial extends ShaderMaterial implements FlameRecipe {
  /**
   * What `WorldCulling` and the handover read to know this is a light source —
   * the same property an emissive `StandardMaterial` carries, and the only
   * thing either asks — and the fire's bloom colour (`Game`'s glow rules).
   */
  readonly emissiveColor = Color3.FromHexString(GLOW);

  /**
   * What our renderer draws a fire of a round with (`render/FlameDraw.ts`):
   * this material's own values, each the `Float32Array` its uniform buffer
   * rounds the same number to — written in place, so a reader holding the
   * record sees every later write (the clock). The eye, the wind's bearing,
   * the fog and the opaque alpha are not here: they are the FRAME's
   * (`CelMaterialFactory.fillFrame`), off the very fields the factory pushes
   * onto this material (`windBearing` is the same `normalize` of the same
   * numbers as `configure`'s).
   */
  readonly values: Readonly<Record<FlameField, Float32Array>>;

  private readonly eye = Vector3.Zero();

  constructor(scene: Scene) {
    super(
      "flame",
      scene,
      { vertex: "flame", fragment: "flame" },
      {
        attributes: ["position", "normal", "uv"],
        uniforms: [...COMMON_UNIFORMS, "fogColor", "fogParams", "opaqueAlpha"],
        shaderLanguage: ShaderLanguage.WGSL,
      },
    );
    this.values = {
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
    this.backFaceCulling = true;
    this.configure(this);
    this.setFloat("opaqueAlpha", 0);
    this.setColor3("fogColor", Color3.Black());
    this.setVector2("fogParams", new Vector2(24, 78));
    this.freeze();
  }

  /** The world clock, into `values` and onto this material. */
  setClock(seconds: number): void {
    this.values.time[0] = seconds;
    this.setFloat("time", seconds);
  }

  /**
   * The eye the fire fogs against and turns its silhouette from — the cel
   * materials' own (`CelMaterialFactory.updateCamera`), onto this material.
   * Never `ShaderMaterial`'s `cameraPosition`: Babylon writes that
   * from `scene.activeCamera`, which Babylon's reflection probe never
   * changed, so its bake drew every fire it captured as seen from wherever
   * the player stood — the reason the palette took the same eye, when
   * Babylon still drew one.
   */
  setEye(pos: Vector3): void {
    this.eye.copyFrom(pos);
    this.setVector3("camPos", this.eye);
  }

  setFog(color: Color3, start: number, end: number): void {
    this.setColor3("fogColor", color);
    this.setVector2("fogParams", new Vector2(start, end));
  }

  /** The motion and the paint, onto this material and into `values`, off the same objects. */
  private configure(mat: ShaderMaterial): void {
    const f = CONFIG.graphics.flame;
    const w = CONFIG.wind.dir;
    const motion = new Vector4(f.fps, f.writhe, f.lean, f.lick);
    const curl = new Vector2(f.hook, f.embers.stretch);
    const embers = new Vector4(f.embers.rise, f.embers.rate, f.embers.drift, f.embers.radius);
    const boil = new Vector3(f.ragged, f.climb, f.bite);
    const char = Color3.FromHexString(CHAR);
    const deep = Color3.FromHexString(DEEP);
    const mid = Color3.FromHexString(MID);
    const hot = Color3.FromHexString(HOT);
    const core = Color3.FromHexString(CORE);
    mat.setFloat("time", 0);
    mat.setVector2("windDir", new Vector2(w[0], w[1]).normalize());
    mat.setVector4("motion", motion);
    mat.setVector2("curl", curl);
    mat.setVector4("embers", embers);
    mat.setVector3("boil", boil);
    mat.setColor3("charColor", char);
    mat.setColor3("deepColor", deep);
    mat.setColor3("midColor", mid);
    mat.setColor3("hotColor", hot);
    mat.setColor3("coreColor", core);
    mat.setVector3("camPos", this.eye);
    if (mat !== this) return;
    const v = this.values;
    v.time[0] = 0;
    motion.toArray(v.motion);
    curl.toArray(v.curl);
    embers.toArray(v.embers);
    boil.toArray(v.boil);
    char.toArray(v.charColor);
    deep.toArray(v.deepColor);
    mid.toArray(v.midColor);
    hot.toArray(v.hotColor);
    core.toArray(v.coreColor);
  }
}

/** Whether a material is the fire — `vertexShading` asks, to leave it unbaked. */
export function isFlame(material: Material | null): material is FlameMaterial {
  return material instanceof FlameMaterial;
}
