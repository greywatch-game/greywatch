/**
 * MotionBlur.ts — Camera-rotation motion blur: reprojects every pixel through
 * the frame's change in look direction and smears along the difference. Owns
 * the pass and the previous frame's camera basis; owns no scene state.
 * Invariants: runs AFTER GodRays and BEFORE HorrorPost, so the shafts smear
 * with the frame they belong to while the grain and vignette stay sharp on top
 * of it. Driven from the player's AIM angles, never from the rendered camera
 * matrix — the view punch's per-shot jitter would otherwise turn every shot
 * into a random full-screen smear. Game must call reset() whenever the camera
 * is teleported, or the jump reads as one blurred frame. Turning it off is a
 * DETACH (`pass` + `setEnabled`, sequenced by Game.setMotionBlurEnabled), not a
 * zeroed strength: the shader's early-out is still a full-screen copy.
 */
import { Camera, Effect, PostProcess, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";

/**
 * Motion blur for the look, and only for the look.
 *
 * A camera *rotation* moves a pixel's ray the same way whatever the distance
 * to what it hit, so where a pixel was last frame is a function of its screen
 * position alone. That is the whole design: the reprojection is exact at every
 * depth — sky, roofline and cobbles alike — with no depth buffer, no velocity
 * buffer and no second pass over the scene. The cost is one full-screen pass.
 *
 * The other half of camera motion, translation, is depth-dependent and is
 * therefore simply absent: strafing past a cottage wall does not smear it. In
 * a first-person game the whip-pan carries most of the effect, and buying the
 * rest would mean a `GeometryBufferRenderer` re-rendering the map — which the
 * cel materials would also have to survive, the same wall `GodRays` hit.
 *
 * `strength` carries the early-out: at zero the shader returns a straight
 * copy, and because it is a uniform the branch costs nothing. It is zero
 * whenever the view is near enough to still, which is most of a round.
 */
Effect.ShadersStore["motionBlurFragmentShader"] = `
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;

uniform mat3 reproject;   // current camera space -> previous camera space
uniform vec2 tanHalfFov;  // half-extents of the near plane, at z = 1
uniform float strength;   // 0 = pass through
uniform float maxShift;
uniform vec2 mask;        // radial falloff: x = inner (sharp), y = outer (full)

#define SAMPLES ${CONFIG.graphics.motionBlur.samples}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec3 scene = texture2D(textureSampler, vUV).rgb;
  if (strength <= 0.0) {
    gl_FragColor = vec4(scene, 1.0);
    return;
  }

  // The ray through this pixel, in camera space. Babylon is left-handed, so
  // the camera looks down +Z and the ray needs no sign flip.
  vec2 ndc = vUV * 2.0 - 1.0;
  vec3 ray = vec3(ndc * tanHalfFov, 1.0);
  vec3 prev = reproject * ray;

  // Behind the previous camera. Only reachable past a quarter-turn in one
  // frame, and the divide below would fold it back into frame mirrored rather
  // than off the edge — so leave the pixel sharp instead.
  if (prev.z <= 0.0001) {
    gl_FragColor = vec4(scene, 1.0);
    return;
  }

  vec2 prevUV = (prev.xy / (prev.z * tanHalfFov)) * 0.5 + 0.5;
  vec2 shift = (prevUV - vUV) * strength;

  // A dropped frame arrives as one enormous rotation, and without this cap it
  // smears the whole screen into paste. Clamping is the honest failure: the
  // blur saturates instead of exploding.
  float len = length(shift);
  if (len > maxShift) shift *= maxShift / len;

  // The weapon is parented to the camera, so it is motionless in screen space
  // while the world behind it sweeps — blurring it reads as a dirty lens, not
  // as motion. There is no depth here to separate the two, so the smear fades
  // out toward the crosshair, which is where the eye tracks and where blur is
  // least wanted anyway. Same radial language as HorrorPost's aberration.
  float r = length(vUV - 0.5) * 2.0;
  shift *= smoothstep(mask.x, mask.y, r);

  // Taps walk back toward where the pixel came from — a trailing smear, which
  // is what a shutter integrates, rather than a centred one that would lead
  // the motion. The jitter breaks the even spacing into noise: at these
  // sample counts a long smear otherwise arrives as distinct ghosts.
  float jitter = hash(vUV) - 0.5;
  vec3 accum = scene;
  for (int i = 1; i < SAMPLES; i++) {
    vec2 uv = vUV + shift * ((float(i) + jitter) / float(SAMPLES - 1));
    accum += texture2D(textureSampler, clamp(uv, 0.0, 1.0)).rgb;
  }

  gl_FragColor = vec4(accum / float(SAMPLES), 1.0);
}
`;

export class MotionBlur {
  private post: PostProcess;
  private readonly camera: Camera;

  /** The previous frame's camera basis, in world space. */
  private readonly prevRight = new Vector3(1, 0, 0);
  private readonly prevUp = new Vector3(0, 1, 0);
  private readonly prevFwd = new Vector3(0, 0, 1);
  /** Scratch for this frame's basis — no per-frame allocation. */
  private readonly right = new Vector3(1, 0, 0);
  private readonly up = new Vector3(0, 1, 0);
  private readonly fwd = new Vector3(0, 0, 1);

  /** Column-major, as GLSL wants a mat3. Identity until the first update. */
  private readonly reproject = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  /** Vertical half-extent of the near plane at z = 1; the pair is built at
   * apply time, when the pass knows the size it is actually running at. */
  private tanY = 1;
  private strength = 0;
  /**
   * False for one frame after a teleport (and on the first frame of all), so
   * the stale basis is replaced rather than smeared through.
   */
  private primed = false;
  /**
   * The player's setting. False DETACHES the pass rather than zeroing its
   * strength: the shader's early-out makes it a straight copy, which is still
   * a full-screen read and write, and a graphics setting that costs nothing to
   * turn off is not a graphics setting. `Game` owns the detach, because the
   * chain's order is Game's to know; this flag is what the pass itself reads.
   */
  private enabled = true;

  constructor(scene: Scene, camera: Camera) {
    const c = CONFIG.graphics.motionBlur;
    this.camera = camera;
    this.post = new PostProcess(
      "motionBlur",
      "motionBlur",
      ["reproject", "tanHalfFov", "strength", "maxShift", "mask"],
      null,
      1.0,
      camera,
      undefined,
      scene.getEngine(),
    );
    this.post.onApply = (effect) => {
      effect.setMatrix3x3("reproject", this.reproject);
      // The aspect comes from the pass's own target rather than a cached
      // engine size, so a resized window is right on the frame it happens.
      effect.setFloat2(
        "tanHalfFov",
        (this.tanY * this.post.width) / Math.max(1, this.post.height),
        this.tanY,
      );
      effect.setFloat("strength", this.strength);
      effect.setFloat("maxShift", c.maxShift);
      effect.setFloat2("mask", c.maskInner, c.maskOuter);
    };
  }

  /**
   * Drops the previous basis, so the next frame is reprojected against itself
   * and comes out sharp. Call after any discontinuity in the camera — a
   * respawn, a round start, a warp into or out of the editor — or the jump
   * renders as a single frame of full-screen smear.
   */
  reset(): void {
    this.primed = false;
  }

  /**
   * The pass, for `Game` to attach and detach. Exposed rather than given an
   * `attach`/`detach` pair of its own because the ORDER is the caller's
   * business: this pass has to land between GodRays and HorrorPost, and only
   * the place that assembled the chain knows that.
   */
  get pass(): PostProcess {
    return this.post;
  }

  /** Whether the pass is attached — the flag Game tests before reordering. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Turns the effect on or off. Detaching is Game's half; this is the half
   * that stops `update` doing arithmetic for a pass that is not running, and
   * that re-primes on the way back on — the stored basis is however many
   * seconds stale by then, and the contract above is explicit that a stale
   * basis renders as one frame of full-screen smear.
   */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.strength = 0;
    if (on) this.reset();
  }

  /**
   * `yaw`/`pitch` are the player's aim, NOT the rendered camera's orientation.
   * The two differ by the view punch's shake, which is fresh noise every frame
   * and would smear the screen at random on every shot. Recoil is included,
   * because the muzzle genuinely climbing is motion worth blurring.
   *
   * Called every frame in every game state, so the basis can never go stale
   * just because the player is sitting in a menu.
   */
  update(yaw: number, pitch: number): void {
    // Detached: no pass to feed, and the basis it would be tracking is
    // discarded by `setEnabled` on the way back on anyway.
    if (!this.enabled) return;
    const c = CONFIG.graphics.motionBlur;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // The same basis CameraSystem builds: forward through the crosshair, right
    // on the flat plane (there is no roll anywhere in this game), up
    // completing the left-handed set.
    this.fwd.set(cp * sy, sp, cp * cy);
    this.right.set(cy, 0, -sy);
    this.up.set(-sp * sy, cp, -sp * cy);

    // Babylon's default fovMode is FOVMODE_VERTICAL_FIXED, so camera.fov is
    // the vertical angle and the horizontal one follows the aspect ratio.
    // Both frames are projected with the CURRENT fov on purpose: using the
    // previous one would turn the ADS zoom and the per-shot FOV punch into a
    // radial smear, and neither of those is head movement.
    this.tanY = Math.tan(this.camera.fov * 0.5);

    // Wrap-immune: CameraSystem's yaw accumulates without a modulo, so
    // comparing angles directly would work today and break the day anyone
    // normalises it. The forward vectors cannot lie.
    const swept = Math.acos(
      Math.max(-1, Math.min(1, Vector3.Dot(this.prevFwd, this.fwd))),
    );
    this.strength =
      this.primed && c.strength > 0 && swept >= c.minRotation ? c.strength : 0;

    // Left deliberately stale while the pass is off — the shader never reads
    // it at strength 0. Worth knowing if you drive this from a test script:
    // forcing `strength` without also stepping `update` through a rotation
    // leaves the identity matrix in place and nothing appears to blur.
    if (this.strength > 0) {
      // Each column is one of THIS frame's basis vectors written in the
      // PREVIOUS frame's coordinates — which is exactly the matrix that
      // carries a current-camera ray back to where it was pointing. GLSL
      // mat3 is column-major, so the columns are contiguous here.
      const m = this.reproject;
      m[0] = Vector3.Dot(this.prevRight, this.right);
      m[1] = Vector3.Dot(this.prevUp, this.right);
      m[2] = Vector3.Dot(this.prevFwd, this.right);
      m[3] = Vector3.Dot(this.prevRight, this.up);
      m[4] = Vector3.Dot(this.prevUp, this.up);
      m[5] = Vector3.Dot(this.prevFwd, this.up);
      m[6] = Vector3.Dot(this.prevRight, this.fwd);
      m[7] = Vector3.Dot(this.prevUp, this.fwd);
      m[8] = Vector3.Dot(this.prevFwd, this.fwd);
    }

    this.prevRight.copyFrom(this.right);
    this.prevUp.copyFrom(this.up);
    this.prevFwd.copyFrom(this.fwd);
    this.primed = true;
  }

  dispose(): void {
    this.post.dispose();
  }
}
