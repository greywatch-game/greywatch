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
 * `vEyePosition` sits in the scene uniform block — so nothing here depends on
 * which defines a given emissive mesh happens to compile with. Under WGSL they
 * are `fragmentInputs.vPositionW` and `scene.vEyePosition`, and the second is
 * the one worth knowing: a value in the SCENE block is behind `scene.` and not
 * behind the `uniforms.` this plugin's own two uniforms use.
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
  ShaderLanguage,
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

  /**
   * **The default answer is GLSL-only and would throw**, which is what made
   * this file part of the WebGPU port rather than a bystander in it.
   * `MaterialPluginBase.isCompatible` returns true for GLSL and false for
   * everything else, `Material._createUniformBuffer` picks WGSL for a
   * `StandardMaterial` on its own whenever `engine.isWebGPU`, and
   * `MaterialPluginManager._addPlugin` THROWS on the mismatch — inside
   * `CelMaterialFactory.getEmissive`, inside `Game`'s constructor, with a boot
   * screen saying "something went wrong" about a shader language.
   *
   * WGSL and only WGSL, deliberately. There is no GLSL path left in this game
   * to be compatible with: the engine is `WebGPUEngine`, every shader in the
   * tree is WGSL and nothing sets `StandardMaterial.ForceGLSL`. A GLSL arm here
   * would be a second copy of the injected code that nothing compiles and
   * nobody could tell had rotted.
   */
  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.WGSL;
  }

  /**
   * `size` and `type` are the language-independent half — the manager spells
   * the declaration itself, mapping `vec3` to `vec3f` for WGSL — so there is
   * nothing to branch on here and the pair reaches the shader as
   * `uniforms.celFogColor` and `uniforms.celFogRange`.
   *
   * No `fragment` string beside it. That is the non-UBO fallback's
   * declarations, and it is dead twice over: WebGPU has no non-UBO path, and
   * the marker it replaces (`ADDITIONAL_FRAGMENT_DECLARATION`) does not exist
   * in Babylon's WGSL `default.fragment` at all, so the text would be dropped
   * on the floor rather than compiled.
   */
  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
  } {
    return {
      ubo: [
        { name: "celFogColor", size: 3, type: "vec3" },
        { name: "celFogRange", size: 2, type: "vec2" },
      ],
    };
  }

  override getCustomCode(shaderType: string): Nullable<{ [point: string]: string }> {
    if (shaderType !== "fragment") return null;
    // `fragmentOutputs.color` has just been written from `color`; this fades the
    // ink Babylon produced rather than taking over the shader's job. Same curve
    // and same radial distance as `CelShader`'s fragment — see the header.
    //
    // The eye is `scene.vEyePosition` and not `uniforms.`: it lives in the
    // SCENE uniform block, which Babylon's WGSL puts behind its own name.
    return {
      CUSTOM_FRAGMENT_MAIN_END: `
        let celFogT = clamp((distance(fragmentInputs.vPositionW, scene.vEyePosition.xyz) - uniforms.celFogRange.x) * uniforms.celFogRange.y, 0.0, 1.0);
        fragmentOutputs.color = vec4f(mix(fragmentOutputs.color.rgb, uniforms.celFogColor, celFogT * celFogT), fragmentOutputs.color.a);
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
  // **The one engine this is skipped on is the one that cannot draw.** The
  // authority runs under `NullEngine`, which is not WebGPU, so
  // `Material._createUniformBuffer` picks GLSL for a `StandardMaterial` and
  // `isCompatible` above answers false — and `_addPlugin` THROWS on the
  // mismatch rather than declining. That threw inside `CombatSystem`'s
  // constructor, which builds its tracer pool out of `getEmissive("#ffe680")`,
  // which is to say inside `new HeadlessGame()`: every match server and every
  // `npm run simulate` died on the first material the simulation built, with a
  // message about a shader language and nothing about where.
  //
  // Skipped rather than given a GLSL arm, and rather than the caller learning
  // about plugins. This is a PICTURE — a per-pixel fade over an unlit colour —
  // and the authority draws no pixels: it builds these materials only because
  // it runs the same pooled systems a client does, and never binds one. A GLSL
  // arm would be a second copy of the injected code that nothing in the tree
  // compiles (see `isCompatible`), kept alive for a process that would not
  // look at it.
  if (!material.getScene().getEngine().isWebGPU) return;
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
