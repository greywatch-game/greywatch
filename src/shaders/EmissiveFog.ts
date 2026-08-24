/**
 * EmissiveFog.ts — Per-pixel distance fog for the unlit emissive materials.
 * Owns: a `MaterialPluginBase` bolted onto every material `getEmissive()` hands
 * out, and the fog values it binds. Invariants: the fog it uploads must be the
 * SAME fog the cel shader is given — `CelMaterialFactory.setEnvironment` is the
 * only caller of `setEmissiveFog`, exactly as it is for `setOutlineFog`, so a
 * lit window cannot describe different weather from the wall it is set into.
 *
 * WHY THIS EXISTS. `getEmissive()` returns an unlit `StandardMaterial` — the
 * third pass in this game that never runs the cel shader, after the outline
 * shell and the glow map, and the last one to be given a fade. It draws a flat
 * `emissiveColor` with `disableLighting`, so a lit window, a forge's embers, a
 * brazier flame, a gatehouse's team-colour bar and a tracer all rendered at full
 * saturation from any distance. Measured on Greyfen before this: a cottage
 * window at 77.6 m — a metre and a half INSIDE `fogEnd` — came back
 * rgb(249,177,92) against its own `#ffb257`, over a fog colour of
 * rgb(194,204,212). Not attenuated at all, in a frame where the wall it is cut
 * into had gone to flat haze. Fading the bloom (`Game`'s
 * `customEmissiveColorSelector`) only ever dimmed the halo around that bar; the
 * bar itself is this pass.
 *
 * WHY A MATERIAL PLUGIN, AND NOT THE THREE OBVIOUS ALTERNATIVES.
 *
 * - **Not `scene.fogMode`.** `StandardMaterial` has fog built in and it would
 *   have been one line — but Babylon's fog is `FOGMODE_LINEAR`/`EXP`/`EXP2` over
 *   the VIEW-SPACE z, and the cel shader's is `t*t` over the RADIAL distance.
 *   Linear against squared over-fogs the window relative to its wall through the
 *   whole middle of the band, and planar against radial disagrees by up to 1.4x
 *   at the corners of a 54 deg FOV. Both are this bug again, one notch quieter.
 *   It is also scene-wide, so the sky dome would need opting out by hand.
 * - **Not a `ShaderMaterial` of our own.** The GlowLayer builds its bloom from
 *   `material.emissiveColor`; a material without one falls to `neutralColor` and
 *   every lantern, tracer, visor and reticle in the game stops glowing. Keeping
 *   the `StandardMaterial` is what keeps `Game`'s selector working unchanged.
 * - **Not baked literals + a cache drop, the way `OutlineFog` does it.** That
 *   file has no choice: `OutlineRenderer` hardcodes its `uniformsNames`. A
 *   material plugin can declare real uniforms, so this one does, and a fog change
 *   is a buffer write rather than a recompile.
 *
 * The distance is `vPositionW` against `vEyePosition`. Both are unconditional in
 * `default.fragment` — `vPositionW` is declared outside every `#ifdef` and
 * `vEyePosition` sits in the scene uniform block, present on the UBO and non-UBO
 * paths alike — so nothing here depends on which defines a given emissive mesh
 * happens to compile with.
 *
 * WHAT DELIBERATELY IS NOT EXEMPTED. Every caller of `getEmissive()` gets this,
 * including the viewmodel's reticle and the muzzle flash. They need no opt-out:
 * they are parented to the camera, half a metre from the eye, where `fogStart`
 * has not begun. An exemption list would be a second thing to keep in step for
 * no effect.
 */
import {
  Color3,
  MaterialPluginBase,
  type AbstractEngine,
  type Nullable,
  type Scene,
  type StandardMaterial,
  type SubMesh,
  type UniformBuffer,
} from "@babylonjs/core";

/**
 * The one copy of the fog, read at bind time by every attached plugin. Module
 * state rather than per-material fields so a map change is one write instead of
 * a walk of a cache this file does not own.
 */
const fog = { color: new Color3(0.05, 0.06, 0.08), start: 24, end: 78 };

class EmissiveFogPlugin extends MaterialPluginBase {
  constructor(material: StandardMaterial) {
    super(material, "CelEmissiveFog", 200, undefined, true, true);
  }

  override getClassName(): string {
    return "EmissiveFogPlugin";
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
    fragment: string;
  } {
    return {
      ubo: [
        { name: "celFogColor", size: 3, type: "vec3" },
        { name: "celFogRange", size: 2, type: "vec2" },
      ],
      // The non-UBO path still needs the declarations spelled out; WebGL2 does
      // not take it, but it costs two lines to not depend on that.
      fragment: `uniform vec3 celFogColor;
uniform vec2 celFogRange;`,
    };
  }

  override getCustomCode(shaderType: string): Nullable<{ [point: string]: string }> {
    if (shaderType !== "fragment") return null;
    // `gl_FragColor` has just been written from `color`; this fades the ink
    // Babylon produced rather than taking over the shader's job. Same curve and
    // same radial distance as `CelShader`'s fragment — see the header.
    return {
      CUSTOM_FRAGMENT_MAIN_END: `
        float celFogT = clamp((distance(vPositionW, vEyePosition.xyz) - celFogRange.x) * celFogRange.y, 0.0, 1.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, celFogColor, celFogT * celFogT);
      `,
    };
  }

  override bindForSubMesh(
    uniformBuffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh,
  ): void {
    uniformBuffer.updateColor3("celFogColor", fog.color);
    uniformBuffer.updateFloat2(
      "celFogRange",
      fog.start,
      1 / Math.max(0.001, fog.end - fog.start),
    );
  }
}

/**
 * Fogs one unlit emissive material. Called from `CelMaterialFactory.getEmissive`
 * on the frame the material is created, which is before anything can have drawn
 * with it — a plugin added after an effect is built does not reach that effect.
 */
export function attachEmissiveFog(material: StandardMaterial): void {
  new EmissiveFogPlugin(material);
}

/**
 * Installs this fog into every emissive material at once. No recompile and no
 * cache walk: the values are uniforms, uploaded per draw from the module state
 * this writes.
 */
export function setEmissiveFog(color: Color3, start: number, end: number): void {
  fog.color.copyFrom(color);
  fog.start = start;
  fog.end = end;
}
