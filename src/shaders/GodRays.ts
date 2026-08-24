/**
 * GodRays.ts — Moon shafts: a screen-space radial blur of the frame's bright
 * pixels away from the moon, added back over the image. Owns the pass and the
 * moon's projected screen position; owns no scene state.
 * Invariants: runs BEFORE HorrorPost so the grade still lands on top of the
 * shafts, and is DETACHED by Game (see `isLive`) whenever the moon is behind
 * the camera or off the side of the screen, which is most of a round. The
 * shader's `presence <= 0` early-out is the second line of defence for the
 * transition frame, not the saving: it skips the sample loop and still reads
 * and writes the whole frame. Fed by Game each frame from Sky.moonDirection.
 */
import {
  Camera,
  Effect,
  Matrix,
  PostProcess,
  Scene,
  Vector3,
  Viewport,
} from "@babylonjs/core";
import { CONFIG } from "../config";

/**
 * Volumetric moonlight, done the cheap way (Mitchell 2007): march each pixel
 * back toward the light's screen position, accumulate whatever is bright along
 * the way, and add the result. Anything dark standing between the camera and
 * the moon — a roofline, a tree, a bot's silhouette — stops contributing and
 * leaves a beam-shaped hole in the accumulation, which is what reads as a
 * shaft of light.
 *
 * It works here specifically because the sky is the brightest thing in the
 * frame by a wide margin and the village is nearly black, so thresholding on
 * luminance separates "sky" from "world" with no extra render pass. A proper
 * occlusion pass (Babylon's VolumetricLightScatteringPostProcess) would have
 * to re-render every mesh with a substitute material, which the cel materials
 * are not set up for.
 *
 * `presence` carries three things at once: the moon being behind the camera,
 * it being off the side of the screen, and the fade between. At zero the
 * shader early-outs to a copy — a uniform branch, so it costs nothing.
 */
Effect.ShadersStore["godRaysFragmentShader"] = `
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;

uniform vec2 lightPos;    // moon, in screen uv
uniform vec3 tint;
uniform float presence;   // 0 = off screen / behind, 1 = dead ahead
uniform float density;
uniform float decay;
uniform float weight;
uniform float intensity;
uniform float threshold;

#define SAMPLES ${CONFIG.godRays.samples}

void main() {
  vec3 scene = texture2D(textureSampler, vUV).rgb;
  if (presence <= 0.0) {
    gl_FragColor = vec4(scene, 1.0);
    return;
  }

  // Step back toward the moon, accumulating only what is bright enough to be
  // sky. The step is the whole distance to the light, split evenly, so pixels
  // far from it take longer strides and the beams stay straight.
  vec2 delta = (vUV - lightPos) * (density / float(SAMPLES));
  vec2 uv = vUV;
  float illum = 1.0;
  vec3 accum = vec3(0.0);

  for (int i = 0; i < SAMPLES; i++) {
    uv -= delta;
    // Sampling past the edge would fetch the clamped border and smear it
    // along the ray, so a tap that walks off screen contributes nothing.
    float inside = step(0.0, uv.x) * step(uv.x, 1.0)
                 * step(0.0, uv.y) * step(uv.y, 1.0);
    vec3 s = texture2D(textureSampler, clamp(uv, 0.0, 1.0)).rgb;
    float lum = dot(s, vec3(0.299, 0.587, 0.114));
    // Only the sky radiates: below the threshold a pixel is world geometry,
    // and world geometry is what has to cut the beams out.
    accum += s * smoothstep(threshold, threshold + 0.25, lum) * illum * weight * inside;
    illum *= decay;
  }
  accum /= float(SAMPLES);

  gl_FragColor = vec4(scene + accum * tint * intensity * presence, 1.0);
}
`;

/**
 * The moon-shaft pass. Created after the rendering pipeline and before
 * HorrorPost, so the chain is FXAA -> shafts -> grade.
 */
export class GodRays {
  private post: PostProcess;
  /** Screen-space uv of the moon, and how much of the effect is live. */
  private lightX = 0.5;
  private lightY = 0.5;
  private presence = 0;
  private tint = new Vector3(1, 1, 1);
  /**
   * The luminance a pixel needs before it radiates, and the map's rather than
   * the config's — `CONFIG.godRays.threshold` until a sky states its own.
   *
   * It has to be the map's because it IS the occlusion test (there is no depth
   * pass), so it is a statement about how bright a particular world is. The
   * shipped 0.78 sits above a wet cobbled night street at ~0.67; under a lit
   * sky the same number is below the ground MIST, never mind a pale slab, and
   * the frame fills with haze rising off the floor. A daylight map's value is
   * bracketed rather than chosen: above the fog colour every distant surface
   * asymptotes to, and below the dimmest sky inside the shafts' reach.
   */
  private threshold: number = CONFIG.godRays.threshold;
  /**
   * Final scale on the accumulated shafts, likewise the map's. It moves WITH
   * the threshold rather than independently: at night the sky is a thin band
   * over a near-black village, and on a lit map it is half the frame at 0.9+,
   * so the same accumulation is a different size and the night value returns a
   * white wash instead of beams.
   */
  private intensity: number = CONFIG.godRays.intensity;
  /** Scratch for the projection — no per-frame allocation. */
  private readonly moonPos = new Vector3();
  private readonly projected = new Vector3();
  private readonly viewport = new Viewport(0, 0, 1, 1);
  private readonly identity = Matrix.Identity();

  /**
   * The pass is built UNATTACHED, and `Game` puts it on the camera.
   *
   * That is not tidiness: the pass comes off the camera whenever the moon is
   * out of frame and goes back on when it returns, and Babylon's
   * `detachPostProcess` leaves a null hole in the camera's list while
   * `attachPostProcess` APPENDS — so a pass that attached itself here would
   * have no way to say which slot it came out of, and every cycle would add a
   * hole to an array walked every frame. Game holds that slot index, which it
   * can only have if Game did the first attach.
   */
  constructor(scene: Scene) {
    const g = CONFIG.godRays;
    this.post = new PostProcess(
      "godRays",
      "godRays",
      [
        "lightPos",
        "tint",
        "presence",
        "density",
        "decay",
        "weight",
        "intensity",
        "threshold",
      ],
      null,
      1.0,
      null,
      undefined,
      scene.getEngine(),
    );
    this.post.onApply = (effect) => {
      effect.setFloat2("lightPos", this.lightX, this.lightY);
      effect.setFloat3("tint", this.tint.x, this.tint.y, this.tint.z);
      effect.setFloat("presence", this.presence);
      effect.setFloat("density", g.density);
      effect.setFloat("decay", g.decay);
      effect.setFloat("weight", g.weight);
      effect.setFloat("intensity", this.intensity);
      effect.setFloat("threshold", this.threshold);
    };
  }

  /**
   * The pass, for `Game` to attach and detach — exposed rather than given an
   * attach/detach pair of its own for the same reason MotionBlur's is: the
   * ORDER is the caller's business, and only what assembled the chain knows
   * the shafts go between FXAA and the blur.
   */
  get pass(): PostProcess {
    return this.post;
  }

  /**
   * Whether the shafts are doing anything this frame — the moon in front of
   * the camera and inside the fade.
   *
   * `Game` detaches the pass whenever this is false, and that is not the same
   * as the shader's `presence <= 0` early-out. The early-out saves the sample
   * loop; the pass is still a full-screen read and write of the frame either
   * way, and this one is off screen for most of a round. MotionBlur documents
   * the same rule from the other side: turning an effect off is a detach, not
   * a zeroed uniform.
   */
  get isLive(): boolean {
    return this.presence > 0;
  }

  /** The shafts take the moon's own colour; called when the sky is applied. */
  setTint(r: number, g: number, b: number): void {
    this.tint.set(r, g, b);
  }

  /**
   * The map's own occlusion threshold and shaft strength, pushed beside the
   * tint when the sky is applied. Either omitted falls back to `CONFIG.godRays`,
   * which is the shipped night village's — see the fields.
   */
  setRays(rays: { threshold?: number; intensity?: number } | undefined): void {
    const g = CONFIG.godRays;
    this.threshold = rays?.threshold ?? g.threshold;
    this.intensity = rays?.intensity ?? g.intensity;
  }

  /**
   * Projects the moon and works out how much of the effect should be live.
   * `moonDir` is a unit direction from the camera (the moon rides at infinite
   * distance, so it has no world position of its own).
   */
  update(scene: Scene, camera: Camera, moonDir: Vector3): void {
    const g = CONFIG.godRays;
    // The view matrix's third column is the camera's forward axis in world
    // space, so this is dot(moonDir, forward): negative means behind us, and
    // a projected point behind the camera comes back mirrored, not off screen.
    const view = camera.getViewMatrix();
    if (
      moonDir.x * view.m[2] + moonDir.y * view.m[6] + moonDir.z * view.m[10] <=
      0
    ) {
      this.presence = 0;
      return;
    }

    // Anything in front of the camera projects to the same place at any
    // distance; 1000 units keeps it clear of the near plane.
    moonDir.scaleToRef(1000, this.moonPos);
    this.moonPos.addInPlace(camera.position);

    // The scene's view*projection is otherwise only rebuilt inside render(),
    // so without this the shafts would converge on where the moon was last
    // frame — visible as a lag in the beams whenever the camera whips round.
    scene.updateTransformMatrix();

    const engine = scene.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    camera.viewport.toGlobalToRef(width, height, this.viewport);
    Vector3.ProjectToRef(
      this.moonPos,
      this.identity,
      scene.getTransformMatrix(),
      this.viewport,
      this.projected,
    );
    this.lightX = this.projected.x / width;
    // Screen coordinates run down the page; uv runs up it.
    this.lightY = 1 - this.projected.y / height;

    // Fade out as the moon leaves the frame: past the edge there is nothing
    // left to blur toward, and popping is the alternative.
    const off = Math.hypot(this.lightX - 0.5, this.lightY - 0.5) * 2;
    this.presence =
      off <= g.fadeStart
        ? 1
        : off >= g.fadeEnd
          ? 0
          : 1 - (off - g.fadeStart) / (g.fadeEnd - g.fadeStart);
  }

  dispose(): void {
    this.post.dispose();
  }
}
