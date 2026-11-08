/**
 * MotionBlur.ts — Camera-rotation motion blur: reprojects every pixel through
 * the frame's change in look direction and smears along the difference. The
 * smear's CPU HALF and the post chain's stage it is drawn as.
 * Owns: `MotionBlur` — the previous frame's camera basis (the blur's HISTORY,
 * on the CPU, not a texture), this frame's reprojection, strength and cap,
 * the player's switch, and `stage`, the `PostStage` our renderer draws it as
 * (`render/PostChain.ts`, `BABYLON_EXIT.md` X5.2c2: the program as Babylon
 * compiled it, `wgsl/motionBlur.ts`; its 112-byte block; the frame's depth as
 * its one extra binding; its input read NEAREST, clamped, as Babylon bound
 * it). Owns no scene state.
 * Invariants: runs AFTER Volumetrics and BEFORE PaperGrain, so the shafts smear
 * with the frame they belong to while the grain and vignette stay sharp on top
 * of it — the HOST's list order, which `Game` assembles, not anything here.
 * Driven from the player's AIM angles, never from the rendered camera
 * matrix — the view punch's per-shot jitter would otherwise turn every shot
 * into a random full-screen smear. Game must call reset() whenever the camera
 * is teleported, or the jump reads as one blurred frame. Turning it off is a
 * stage the host does not draw (`setEnabled` is its `active()`), not a zeroed
 * strength: the shader's early-out is still a full-screen copy.
 * It SAMPLES the frame's depth (`FrameDepth`, shared with `CelInk`) for one
 * question only: is this pixel the WEAPON, which is the one thing on screen
 * this pass must not touch. That image belongs to the pass the scene draws
 * into, so this one has to stay downstream of it.
 * Never: draws, binds or owns a GPU resource (the host does).
 * Contract: `docs/rendering.md`.
 */
import type { Camera } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { hostTexture } from "../render/babylonSeam";
import type { PostStage } from "../render/PostChain";
import type { FrameDepth } from "./FrameDepth";
import {
  MOTION_BLUR_BLOCK as B,
  MOTION_BLUR_FRAGMENT,
  MOTION_BLUR_FRAGMENT_BINDINGS,
  MOTION_BLUR_VERTEX,
  MOTION_BLUR_VERTEX_BINDINGS,
} from "./wgsl/motionBlur";

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
 * cel materials would also have to survive, the same wall the shafts hit when
 * they wanted an occlusion pass (see `Volumetrics`).
 *
 * THE WEAPON DOES NOT MOVE IN SCREEN SPACE AND THEREFORE MUST NOT SMEAR, and
 * it is the one place the argument above breaks down. The viewmodel is
 * parented to the camera: a rotation moves every world pixel and moves the gun
 * by exactly nothing, so the shift this pass computes is right for the whole
 * frame EXCEPT the object filling the bottom third of it. Smeared, it reads as
 * a dirty lens rather than as motion.
 *
 * It used to be answered with a RADIAL mask — sharp at the centre, full at
 * the edges — and that was backwards for the object it was aimed at. The
 * weapon sits LOW AND RIGHT, which is exactly where that mask blurred hardest,
 * so the gun was the most smeared thing in the frame; what the sharp core
 * bought instead was the middle distance, which is where the smear is the
 * whole effect. Depth names the weapon exactly, which is `ink.near`'s argument
 * spent a second time: the viewmodel is drawn between 0.05 m and 1.4 m of the
 * lens (MEASURED, hip pose, every gun in the kit — the sniper's muzzle is the
 * deepest at 1.39 m), and a body cannot get its eye much inside half a metre
 * of world geometry. So a band in metres tells them apart with no per-mesh
 * data, no velocity buffer and no second pass over the scene.
 *
 * IT IS TWO USES OF THAT BAND AND THE SECOND IS WHAT ACTUALLY FINISHES THE
 * JOB. Masking the shift keeps the weapon's own pixels sharp; it says nothing
 * about the world pixels BESIDE it, which gather backwards along the smear,
 * land on the gun, and drag its colour out across the scene — the same
 * complaint one pixel over. So every tap is weighted by the same band and the
 * accumulation normalised by the weight it actually kept: the smear gathers
 * from the WORLD only, and the gun cannot appear in a streak it is not part
 * of. The centre tap is unconditional, so a run of rejected taps degrades to
 * the sharp pixel rather than to a hole.
 *
 * `strength` carries the early-out: at zero the shader returns a straight
 * copy, and because it is a uniform the branch costs nothing. It is zero
 * whenever the view is near enough to still, which is most of a round. The
 * band carries a SECOND early-out, and that one is a SAVING rather than a
 * cost: a pixel whose shift the masks have taken under half a texel has
 * nothing to gather, so the weapon — a large, always-present part of the frame
 * — skips the sample loop outright, and so does the sharp core.
 */

/**
 * The sampler Babylon bound the blur's input with (its post-process's
 * `renderTargetSamplingMode`, NEAREST, on a texture with no mips; read off the
 * parent's device by `plans/webgpu-ref/post.mjs`).
 */
const INPUT_SAMPLER: GPUSamplerDescriptor = {
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
  addressModeW: "repeat",
  magFilter: "nearest",
  minFilter: "nearest",
  mipmapFilter: "nearest",
  lodMinClamp: 0,
  lodMaxClamp: 0,
  maxAnisotropy: 1,
};

export class MotionBlur {
  /** The stage the post chain draws the smear as. */
  readonly stage: PostStage;

  /** The previous frame's camera basis, in world space. */
  private readonly prevRight = new Vector3(1, 0, 0);
  private readonly prevUp = new Vector3(0, 1, 0);
  private readonly prevFwd = new Vector3(0, 0, 1);
  /** Scratch for this frame's basis — no per-frame allocation. */
  private readonly right = new Vector3(1, 0, 0);
  private readonly up = new Vector3(0, 1, 0);
  private readonly fwd = new Vector3(0, 0, 1);

  /**
   * Column-major, which is what WGSL wants: `[1..9]` arrives as the columns
   * `(1,2,3)`, `(4,5,6)`, `(7,8,9)`. Identity until the first update.
   *
   * **A WGSL `mat3x3f` is three vec4-ALIGNED columns and these nine floats are
   * not**, so the block is written as a repack into 16-byte slots rather than
   * a copy (`fill`) — what Babylon's `UniformBuffer` did for `setMatrix3x3`,
   * and getting it wrong would be a scrambled matrix with no diagnostic
   * anywhere. It is also the one thing about this pass the reference bank
   * cannot check, because a frozen frame is a STILL camera, a still camera is
   * `strength = 0`, and that is the early-out two lines into the shader —
   * which is why the bank's `post-*` rows and `plans/webgpu-ref/post.mjs`'s
   * `blur` scenario turn the aim first, and why the probe compares the
   * block's bytes.
   */
  private readonly reproject = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  /** Vertical half-extent of the near plane at z = 1; the pair is built at
   * fill time, when the pass knows the size it is actually running at. */
  private tanY = 1;
  private strength = 0;
  /** `maxShift` for the frame being drawn — the config's rate times its length. */
  private maxShift: number = CONFIG.graphics.motionBlur.maxShift;
  /**
   * False for one frame after a teleport (and on the first frame of all), so
   * the stale basis is replaced rather than smeared through.
   */
  private primed = false;
  /**
   * The player's setting, and the stage's `active()`. False is a pass the
   * host does not open rather than a zeroed strength: the shader's early-out
   * makes it a straight copy, which is still a full-screen read and write,
   * and a graphics setting that costs nothing to turn off is not a graphics
   * setting.
   */
  private enabled = true;

  constructor(
    private readonly camera: Camera,
    /**
     * The frame's own depth image, shared with the ink. It is what names the
     * viewmodel — see the class comment — and it is the reason this pass has
     * to stay downstream of whichever pass the scene draws into.
     */
    depth: FrameDepth,
  ) {
    this.stage = {
      name: "blur",
      label: "motionBlur",
      vertex: MOTION_BLUR_VERTEX,
      vertexBindings: MOTION_BLUR_VERTEX_BINDINGS,
      fragment: MOTION_BLUR_FRAGMENT,
      fragmentBindings: MOTION_BLUR_FRAGMENT_BINDINGS,
      // The taps walk back along the smear.
      reads: "neighbourhood",
      inputBinding: 0,
      inputSamplerBinding: 2,
      internalsBinding: 3,
      blockBinding: 4,
      inputSampler: INPUT_SAMPLER,
      blockFloats: B.floats,
      // The frame's depth, read by `textureLoad` (no sampler). Null before
      // the first draw phase has captured it, and the stage then draws
      // nothing — it cannot be by the time the host draws, the capture being
      // on the draw phase of the same `scene.render()`.
      extras: [{ binding: 1, texture: () => (depth.texture ? hostTexture(depth.texture as never) : null) }],
      active: () => this.enabled,
      fill: (block, width, height) => this.fill(block, width, height),
    };
  }

  /**
   * This frame's block, as Babylon's `onApply` set it: the vertex stage's
   * `scale` (1, 1), the reprojection repacked into three vec4 columns, the
   * FOV with the aspect off the input's own size (so a resized window is
   * right on the frame it happens), the strength and its cap, the radial
   * mask, the camera's clip planes — `minZ` written once by CameraSystem and
   * read here rather than copied, for the reason CelInk reads it the same
   * way — and the weapon's depth band. Every float is written; the pads stay
   * zero.
   */
  private fill(b: Float32Array, width: number, height: number): void {
    const c = CONFIG.graphics.motionBlur;
    b[B.scale] = 1;
    b[B.scale + 1] = 1;
    const m = this.reproject;
    for (let col = 0; col < 3; col++) {
      b[B.reproject + col * 4] = m[col * 3];
      b[B.reproject + col * 4 + 1] = m[col * 3 + 1];
      b[B.reproject + col * 4 + 2] = m[col * 3 + 2];
    }
    b[B.tanHalfFov] = (this.tanY * width) / Math.max(1, height);
    b[B.tanHalfFov + 1] = this.tanY;
    b[B.strength] = this.strength;
    b[B.maxShift] = this.maxShift;
    b[B.mask] = c.maskInner;
    b[B.mask + 1] = c.maskOuter;
    b[B.nearFar] = this.camera.minZ;
    b[B.nearFar + 1] = this.camera.maxZ;
    b[B.nearBand] = c.nearSharp;
    b[B.nearBand + 1] = c.nearFull;
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

  /** Whether the player has it on — the stage's `active()`. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Turns the effect on or off: the stage's `active()`, and the half that
   * stops `update` doing arithmetic for a pass that is not drawn, and that
   * re-primes on the way back on — the stored basis is however many seconds
   * stale by then, and the contract above is explicit that a stale basis
   * renders as one frame of full-screen smear.
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
   *
   * `dt` is the frame's length, and it reaches the CAP alone: the smear is
   * already the frame's own rotation, so it lengthens with the frame by
   * itself, and only the cap was stated per frame (see `maxShift`).
   */
  update(yaw: number, pitch: number, dt: number): void {
    // Off: no stage to feed, and the basis it would be tracking is
    // discarded by `setEnabled` on the way back on anyway.
    if (!this.enabled) return;
    const c = CONFIG.graphics.motionBlur;
    this.maxShift = c.maxShift * 60 * Math.min(dt, c.maxShiftSpan);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // The same basis CameraSystem builds: forward down the aim axis, right
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
      // carries a current-camera ray back to where it was pointing. A WGSL
      // mat3x3f is column-major, so the columns are contiguous here.
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
}
