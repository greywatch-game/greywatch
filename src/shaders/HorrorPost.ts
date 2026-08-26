/**
 * HorrorPost.ts — Full-screen grade: vignette, corner desaturation, radial
 * chromatic aberration, animated grain, red damage flash.
 * Why hand-written: Babylon's image-processing pass re-gammas the cel shader's
 * already display-ready colors and washes the palette out — which is also why
 * pipeline.imageProcessingEnabled stays false. Keep the grade in this pass.
 * Invariants: this is the LAST pass on the camera; `detach`/`attach` exist so
 * the motion blur ahead of it can be removed and put back without ending up
 * behind it (see Game.setMotionBlurEnabled), and both honour `setEnabled`, so
 * that dance can never re-attach a grade the player turned off.
 * Its shader is hand-written WGSL, and `shaderLanguage` on the PostProcess is
 * load-bearing rather than declarative: the constructor defaults to GLSL and
 * would look this pass up in a store nothing writes any more. See
 * `docs/rendering.md` for what the dialect and Babylon's WGSL processor decide.
 */
import {
  Camera,
  PostProcess,
  Scene,
  ShaderLanguage,
  ShaderStore,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { EnvironmentSpec } from "../world/environment";

/**
 * Full-screen horror grade applied after FXAA: a heavy vignette, corner
 * desaturation, radial chromatic aberration, animated film grain, and a red
 * flash driven by player damage.
 *
 * This is a hand-written pass rather than Babylon's image-processing block
 * because that block re-applies gamma to the cel shader's already
 * display-ready colors and washes the palette out.
 */
ShaderStore.ShadersStoreWGSL["horrorFragmentShader"] = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;

uniform time: f32;
uniform vignette: f32;
uniform grain: f32;
uniform aberration: f32;
uniform damage: f32;

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let centered = input.vUV - 0.5;
  let r2 = dot(centered, centered);

  // Radial chromatic aberration — none at the crosshair, smeared at the edge.
  let offset = centered * uniforms.aberration * r2 * 0.09;
  var col = vec3f(
    textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV + offset, 0.0).r,
    textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0).g,
    textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV - offset, 0.0).b,
  );

  // Vignette: the corners fall away into the dark.
  col *= 1.0 - uniforms.vignette * smoothstep(0.05, 0.62, r2);

  // Color drains toward the edges of vision.
  let lum = dot(col, vec3f(0.299, 0.587, 0.114));
  col = mix(col, vec3f(lum), clamp(r2 * 1.1, 0.0, 0.4));

  // Damage: blood pushes in from the border, but never closes over the
  // crosshair — the player still has to be able to fight while hurt.
  col = mix(col, vec3f(0.42, 0.02, 0.03), uniforms.damage * 0.8 * smoothstep(0.04, 0.42, r2));

  // Animated film grain, slightly stronger in the shadows.
  let n = hash(input.vUV * vec2f(1024.0, 683.0) + fract(uniforms.time) * 91.7);
  col += (n - 0.5) * uniforms.grain * (1.3 - lum * 0.6);

  fragmentOutputs.color = vec4f(col, 1.0);
}
`;

export class HorrorPost {
  private post: PostProcess;
  private readonly camera: Camera;
  private time = 0;
  private damage = 0;
  /** Whether the player wants the grade at all. */
  private enabled = true;
  /** Whether the pass is on the camera right now — the constructor puts it
   *  there, so the two start in agreement and only this file moves them. */
  private attached = true;

  /**
   * How hard the grade is pushed, as the map asked for it. Defaults to
   * `CONFIG.graphics`, which is Hollowmere's — so a map that says nothing
   * gets exactly the shipped look.
   */
  private vignette: number = CONFIG.graphics.vignette;
  private grain: number = CONFIG.graphics.grain;
  private aberration: number = CONFIG.graphics.aberration;

  constructor(scene: Scene, camera: Camera) {
    this.camera = camera;
    this.post = new PostProcess("horror", "horror", {
      uniforms: ["time", "vignette", "grain", "aberration", "damage"],
      size: 1.0,
      camera,
      engine: scene.getEngine(),
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.post.onApply = (effect) => {
      effect.setFloat("time", this.time);
      effect.setFloat("vignette", this.vignette);
      effect.setFloat("grain", this.grain);
      effect.setFloat("aberration", this.aberration);
      effect.setFloat("damage", this.damage);
    };
  }

  /**
   * Sets the grade's strength for the installed map. Each field falls back to
   * its `CONFIG.graphics` default, so clearing a map's override restores the
   * shipped grade rather than zeroing it.
   *
   * Deliberately separate from `setEnabled`: this is the MAP saying how much,
   * and that is the PLAYER saying whether at all.
   */
  setGrade(grade: EnvironmentSpec["grade"]): void {
    const g = CONFIG.graphics;
    this.vignette = grade?.vignette ?? g.vignette;
    this.grain = grade?.grain ?? g.grain;
    this.aberration = grade?.aberration ?? g.aberration;
  }

  /**
   * Takes the grade off the camera, and puts it back on the END of the chain.
   *
   * The pair exists for two callers now. Turning the motion blur off removes a
   * pass from the middle of the chain, and Babylon's `attachPostProcess`
   * APPENDS, so putting it back would land it after this grade; detaching and
   * re-attaching the grade behind it is what keeps the documented order —
   * GodRays, then the blur, then this — without anyone having to compute an
   * insert index against a chain that also holds the pipeline's FXAA. The
   * other caller is `setEnabled` below.
   *
   * Grain over a smear is the symptom if this goes wrong: it reads as a dirty
   * lens rather than as motion, and nothing throws.
   *
   * Both are idempotent, and `attach` additionally refuses while the grade is
   * switched off — the blur's dance is a detach and a re-attach around some
   * other work, and it must not resurrect a pass the player took away. That is
   * also why the grade always APPENDS rather than going back into the slot it
   * came out of, the way `Game.syncGodRays` does: the tail is where it belongs,
   * and a blur attached while it was away is already sitting past its old
   * index. The cost is one null hole per off/on cycle in the camera's list,
   * which is bounded by clicks on a settings row rather than by frames.
   */
  detach(): void {
    if (!this.attached) return;
    this.camera.detachPostProcess(this.post);
    this.attached = false;
  }

  attach(): void {
    if (this.attached || !this.enabled) return;
    this.camera.attachPostProcess(this.post);
    this.attached = true;
  }

  /**
   * Turns the whole grade on or off — a display setting, not a mood.
   *
   * Detaching rather than zeroing the uniforms, for the reason the motion blur
   * states about itself: a pass switched off in its shader still reads and
   * writes the entire frame. Note the red damage flash goes with it, since it
   * is painted by this shader; the HUD's directional damage arcs are not, and
   * are what a player with the grade off still reads a hit from.
   */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.attach();
    else this.detach();
  }

  /** Kicks the red edge flash; call when the player takes a hit. */
  flashDamage(): void {
    this.damage = CONFIG.graphics.damageFlash;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.damage > 0) {
      this.damage = Math.max(0, this.damage - dt * CONFIG.graphics.damageFlashDecay);
    }
  }
}
