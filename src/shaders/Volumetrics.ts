/**
 * Volumetrics.ts — Moonlight scattered by the air, marched through the SHADOW
 * VOLUME rather than smeared across the screen: the march's CPU HALF and the
 * post chain's stages it is drawn as.
 * Owns: `Volumetrics` — the rung it was built at, the camera basis it
 * reconstructs rays from, the three maps it marches through as they were
 * pushed (each as Babylon holds it and, where it is our renderer's, as our
 * renderer holds it), the map's air and the moon's colour and bearing — and
 * `volumetricStages`, one `PostStage` a RUNG (`render/PostChain.ts`,
 * `BABYLON_EXIT.md` X5.2c2: the program as Babylon compiled it,
 * `wgsl/volumetrics.ts`; its 320-byte block; the frame's depth, the two
 * shadow maps and the clouds' field as its extra bindings; its input read
 * NEAREST, clamped, as Babylon bound it). Owns no scene state, renders
 * nothing of its own and copies nothing.
 * Invariants: it runs after the ink and FXAA and before the blur and the
 * grade, because it ADDS light to the frame — the beams belong to the same
 * instant as the geometry, so they have to smear with it and be graded on
 * top of it; that order is the HOST's list (`Game` assembles it), not
 * anything here. Every rung is a stage of its own, so every rung's pipelines
 * are asked when the chain is built and a rung changed in play compiles
 * nothing (`BABYLON_EXIT.md` X5.2's row "pipelines"); a rung's stage is
 * `active()` only while `live()` hands back a pass at that rung — `Game`'s,
 * and only once it has latched the pass READY (`Game.syncVolumetrics`, as it
 * used to attach it), so the first frame has no shafts exactly as before. A
 * shadow map our renderer owns is bound as OURS (`own ?? hostTexture`, the
 * pattern `ShadowBindings.fillFrameTextures` follows); the clouds' field is
 * Babylon's, through `hostTexture`, with the host's sampler. Its block is
 * filled when the host draws it, every float every time.
 * Never: draws, binds or owns a GPU resource (the host does); reads the AIM
 * rather than the rendered camera (the blur reads the aim, and says why).
 * Contract: `docs/rendering.md`.
 *
 * **IT REPLACED `GodRays` AND THAT PASS IS GONE**, rather than being kept as a
 * cheap rung. The player's `off` is the bottom of this ladder; there is one
 * light-shaft mechanism in the game and one set of numbers describing it, which
 * is the same rule the one blast and the one wind are held to.
 *
 * WHAT IT DOES THAT THE SCREEN-SPACE PASS COULD NOT, which is the whole
 * argument for paying anything at all. `GodRays` accumulated BRIGHT PIXELS
 * along a line toward the moon's projected position, so it could only draw a
 * beam whose light source was ON SCREEN, and it could only be cut by something
 * ALSO on screen — it was detached outright for 22 of 24 bearings on a level
 * sweep. A shaft through a doorway you are looking at side-on, a beam between
 * two roofs with the moon behind you, the bar of light across a street you are
 * walking down: none of those existed for it, because there was nothing in
 * frame for it to smear. This marches the air itself and asks the shadow map
 * what is lit, so the light does not have to be in frame and neither does the
 * occluder.
 *
 * **AND IT IS THEREFORE ATTACHED ALL THE TIME, WHICH IS THE TRADE.** The old
 * pass cost nothing for most of a round and everything for a few seconds of it;
 * this costs the same every frame. Measured worst-case-to-worst-case it is
 * CHEAPER at the two lower rungs (`CONFIG.graphics.volumetrics` carries the
 * table), but nobody should read that as free over a round — it is about
 * 0.75 ms of GPU, spent on a frame that leaves ~75% of the GPU idle.
 *
 * **CHARACTERS OCCLUDE, AND THEY DO IT THROUGH A MAP OF THEIR OWN.** They did
 * not when this landed: a rig is not a caster in the world's shadow map and was
 * never going to be, because that pass re-renders only when its texel-snapped
 * focus MOVES and one animated caster in its list turns it into a per-frame
 * redraw of the village. `systems/BodyShadows.ts` is the answer — a second
 * depth map carrying soldiers and hulls as thin instances of one box, one draw
 * call whatever the roster — and `shadowAt` below asks both volumes and takes
 * the `min`. The two windows are deliberately different sizes; that function
 * says why.
 *
 * **What is left unoccluded is the LOCAL PLAYER**, who has no rig to read in
 * first person, and a FLYING hull far enough up that its shadow lands outside a
 * 48 m window. Neither is a regression against the screen-space pass: it could
 * not see an off-screen occluder at all.
 *
 * WHAT IT COSTS THE CPU, which is the question that was actually asked: one
 * full-screen draw and a dozen uniform writes. Every input it needs already
 * exists and is already computed — the depth image is `FrameDepth`'s, shared
 * with the ink and the blur; the shadow map and its matrix are `ShadowSystem`'s
 * and are published to the cel materials whether this exists or not; the camera
 * basis is read straight out of the view matrix. It builds nothing, walks
 * nothing, and adds no draw to the scene.
 *
 * THE RUNG IS A SAMPLE COUNT AND NOT A RESOLUTION, and the reason is worth
 * stating because the obvious lever is the wrong one here. A pass at under
 * the render size renders the CHAIN's image into a smaller target and every
 * pass after it reads that target — so a half-res march is a half-res frame.
 * Scaling the march itself means a render target of its own plus a depth-aware
 * upsample, which is real structure; it is the next step if the measurement
 * says taps alone are not enough. The count is a WGSL `const` interpolated per
 * rung, so each rung is its own compiled shader and its own stage — which is
 * why the rung is fixed at construction and `Game.setVolumetrics` REBUILDS
 * this CPU half rather than re-configuring it when the player moves the
 * slider, and why every rung's stage stands in the chain from the start.
 */
import type { BaseTexture, Camera, Matrix } from "@babylonjs/core";
import { Vector3, Vector4 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { depthBias } from "../core/shadowWindow";
import { hostTexture } from "../render/babylonSeam";
import type { HostTexture } from "../render/frameHost";
import type { OwnTexture } from "../render/HostBindGroup";
import type { PostStage } from "../render/PostChain";
import type { FrameDepth } from "./FrameDepth";
import {
  VOLUMETRICS_BLOCK as B,
  VOLUMETRICS_FRAGMENT_BINDINGS,
  VOLUMETRICS_VERTEX,
  VOLUMETRICS_VERTEX_BINDINGS,
  type VolumetricRung,
  volumetricsFragment,
} from "./wgsl/volumetrics";

export type { VolumetricRung } from "./wgsl/volumetrics";

/** Whether a string off the query is a rung. Narrows, so the caller needs no cast. */
export function isVolumetricRung(s: string): s is VolumetricRung {
  return s in CONFIG.graphics.volumetrics.rungs;
}

/**
 * The samplers Babylon bound the shafts' input with (the post-process's
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

/**
 * The light shafts' CPU half, built at one rung — `Game` rebuilds it on a
 * rung change and drops it when the player turns them off.
 */
export class Volumetrics {
  /** The rendered camera's world basis, read off the view matrix each frame. */
  private readonly right = new Vector3(1, 0, 0);
  private readonly up = new Vector3(0, 1, 0);
  private readonly fwd = new Vector3(0, 0, 1);
  private readonly moon = new Vector3(0, 1, 0);
  private readonly tint = new Vector3(1, 1, 1);
  private tanY = 0.5;
  /** Metres of air to march — the shadow window's reach. See `setReach`. */
  private reach =
    CONFIG.graphics.shadows.frustumSize *
    0.5 *
    CONFIG.graphics.volumetrics.reachFraction;
  /**
   * The moon's depth map and its view*projection, pushed by `Game` — as
   * Babylon holds it, and as OUR renderer holds it while the map is ours
   * (`ShadowSystem.ownDepthMap`), which is what is bound then.
   */
  private shadowMap: BaseTexture | null = null;
  private ownShadowMap: OwnTexture | null = null;
  private lightMatrix: Matrix | null = null;
  /** The BODIES' depth map and ITS view*projection — `BodyShadows`', via `Game`, both ways as the world's. */
  private bodyShadowMap: BaseTexture | null = null;
  private ownBodyShadowMap: OwnTexture | null = null;
  private bodyLightMatrix: Matrix | null = null;
  /** The clouds' shadow field and how it is read — `Sky`'s, via `Game`. */
  private cloudShadowMap: BaseTexture | null = null;
  private readonly cloudArea = new Vector4(0, 0, 0, 1);
  private readonly cloudRay = new Vector4(0, 0, 0, 0);
  /** The map's own air, as multipliers on the config. See `setEnv`. */
  private densityMult = 1;
  private intensityMult = 1;

  constructor(
    private readonly camera: Camera,
    /**
     * The frame's own depth image, shared with the ink and the blur. It is
     * what bounds every ray at the geometry already drawn, and it is why this
     * pass has to stay downstream of whichever pass the scene draws into.
     */
    private readonly depth: FrameDepth,
    readonly rung: VolumetricRung,
  ) {}

  /** Everything it needs is bound. `Game` latches the stage on only once it is. */
  get ready(): boolean {
    return (
      this.shadowMap !== null &&
      this.bodyShadowMap !== null &&
      this.cloudShadowMap !== null &&
      this.depth.texture !== null
    );
  }

  /** The moon's depth map, its view*projection, and the map as our renderer holds it when it is ours — `ShadowSystem`'s, via `Game`. */
  setShadow(map: BaseTexture, matrix: Matrix, own: OwnTexture | null): void {
    this.shadowMap = map;
    this.ownShadowMap = own;
    this.lightMatrix = matrix;
  }

  /**
   * The BODIES' depth map, its view*projection and our renderer's own
   * texture behind it — `BodyShadows`', via `Game`.
   *
   * Pushed on the same line as `setShadow` and for the same reason: both
   * owners mutate their matrix in place, so re-reading every frame is the
   * only thing that does not lean on that.
   */
  setBodyShadow(map: BaseTexture, matrix: Matrix, own: OwnTexture | null): void {
    this.bodyShadowMap = map;
    this.ownBodyShadowMap = own;
    this.bodyLightMatrix = matrix;
  }

  /**
   * The clouds' shadow field and the two vectors that read it — `Sky`'s, via
   * `Game`, on the line after `setBodyShadow` and every frame, because the
   * crossfade moves with the drift. See `celCloud`.
   */
  setCloudShadow(map: BaseTexture, area: Vector4, ray: Vector4): void {
    this.cloudShadowMap = map;
    this.cloudArea.copyFrom(area);
    this.cloudRay.copyFrom(ray);
  }

  /** The moon's own colour, pushed when the map's environment is applied. */
  setTint(r: number, g: number, b: number): void {
    this.tint.set(r, g, b);
  }

  /**
   * The direction TOWARD the key light, unit — the negated
   * `EnvironmentSpec.lighting.direction`.
   *
   * **It is the light whose shadow map this marches, and NOT the sky's moon
   * disc, which is the same vector by a different route and can be zero.**
   * `Sky` derives its disc from this very field and then withholds it when a
   * map draws no disc (`discRadius: 0`), which the screen-space pass read as
   * "switch off". A march has no such switch — it would simply get a zero
   * vector into the phase function's cosine and scatter sideways everywhere.
   * Reading the authority instead means a sky with no disc drawn is still air
   * lit from where the shadows actually come from.
   */
  setLightDir(x: number, y: number, z: number): void {
    this.moon.set(x, y, z).normalize();
  }

  /**
   * The map's own air, as MULTIPLIERS on `CONFIG.graphics.volumetrics` — both
   * absent meaning "the config's", so a map that says nothing is unaffected.
   *
   * **Multipliers and not absolutes, which is what lets a config change reach
   * every map.** The shipped numbers are the night village's; a jungle valley
   * wants thicker air than a clear desert and says so by ratio, so retuning the
   * base moves all six together and keeps the ordering their authors chose.
   *
   * **The six values in the tree were CARRIED OVER by ratio from the
   * screen-space pass and are not tuned against the march.** They preserve
   * which map wanted more shaft than which, which is the half of the old
   * numbers that still means anything — the other half was a luminance
   * threshold that no longer exists. Retuning them by eye, per map, is the
   * job this is waiting for.
   */
  setEnv(air: { density?: number; intensity?: number } | undefined): void {
    this.densityMult = air?.density ?? 1;
    this.intensityMult = air?.intensity ?? 1;
  }

  /**
   * How far the march reaches, derived from the map's shadow window.
   *
   * **The window is a SQUARE CENTRED ON THE PLAYER, so the reach is its HALF
   * side and not its side.** 55 m on the default 110 m window, which is the
   * honest limit of this whole approach: past it `shadowAt` knows nothing and
   * says lit. A map that states a bigger `shadowWindow` gets a longer march for
   * free and pays for it in texel density exactly as its shadows already do.
   */
  setReach(shadowWindow: number): void {
    this.reach = shadowWindow * 0.5 * CONFIG.graphics.volumetrics.reachFraction;
  }

  /**
   * The rendered camera's basis, once a frame.
   *
   * **It is the RENDERED camera and deliberately not the player's aim**, which
   * is where `MotionBlur` reads the opposite way: that pass excludes the view
   * punch because fresh shake is not motion worth smearing, and this one must
   * include it, because the rays it builds have to land on the same pixels the
   * depth buffer was written from. The view matrix's columns are the world
   * basis — Babylon's LookAtLH writes the axes there — so this is a read rather
   * than a second trig of the same angles.
   */
  update(): void {
    const m = this.camera.getViewMatrix().m;
    this.right.set(m[0], m[4], m[8]);
    this.up.set(m[1], m[5], m[9]);
    this.fwd.set(m[2], m[6], m[10]);
    // Babylon's default fovMode is FOVMODE_VERTICAL_FIXED, so camera.fov is the
    // vertical angle and the horizontal one follows the aspect ratio.
    this.tanY = Math.tan(this.camera.fov * 0.5);
  }

  /**
   * This frame's block, as Babylon's `onApply` set it: the vertex stage's
   * `scale` (1, 1), the clouds' two vectors, both light matrices, the air,
   * the camera's place and basis, the moon and its colour, the FOV with the
   * aspect off the input's own size (so a resized window is right on the
   * frame it happens — `MotionBlur` reads it the same way), the clip planes,
   * how far to march and each map's bias, and the intensity. Every float is
   * written; the pads stay zero.
   */
  fill(b: Float32Array, width: number, height: number): void {
    const v = CONFIG.graphics.volumetrics;
    b[B.scale] = 1;
    b[B.scale + 1] = 1;
    vec4(b, B.cloudShadow, this.cloudArea);
    vec4(b, B.cloudShadowRay, this.cloudRay);
    mat4(b, B.lightMatrix, this.lightMatrix);
    mat4(b, B.bodyLightMatrix, this.bodyLightMatrix);
    b[B.air] = v.density * this.densityMult;
    b[B.air + 1] = v.heightFalloff;
    b[B.air + 2] = v.heightBase;
    b[B.air + 3] = v.anisotropy;
    const p = this.camera.position;
    b[B.camPos] = p.x;
    b[B.camPos + 1] = p.y;
    b[B.camPos + 2] = p.z;
    vec3(b, B.camRight, this.right);
    vec3(b, B.camUp, this.up);
    vec3(b, B.camFwd, this.fwd);
    vec3(b, B.moonDir, this.moon);
    vec3(b, B.tint, this.tint);
    b[B.tanHalfFov] = (this.tanY * width) / Math.max(1, height);
    b[B.tanHalfFov + 1] = this.tanY;
    b[B.nearFar] = this.camera.minZ;
    b[B.nearFar + 1] = this.camera.maxZ;
    b[B.march] = this.reach;
    b[B.march + 1] = depthBias(CONFIG.graphics.shadows.bias, CONFIG.graphics.shadows.depthRange);
    b[B.march + 2] = depthBias(CONFIG.graphics.bodyShadows.bias, CONFIG.graphics.bodyShadows.depthRange);
    b[B.intensity] = v.intensity * this.intensityMult;
  }

  /** The world's shadow map as it is bound: ours while it is ours, Babylon's otherwise; null until pushed. */
  worldMap(): HostTexture | OwnTexture | null {
    return this.ownShadowMap ?? (this.shadowMap && hostTexture(this.shadowMap));
  }

  /** The bodies' map, the same way. */
  bodiesMap(): HostTexture | OwnTexture | null {
    return this.ownBodyShadowMap ?? (this.bodyShadowMap && hostTexture(this.bodyShadowMap));
  }

  /** The clouds' field: Babylon's texture, through the host, with the host's sampler. */
  cloudField(): HostTexture | null {
    return this.cloudShadowMap && hostTexture(this.cloudShadowMap);
  }
}

/**
 * The shafts as the post chain's stages: ONE A RUNG, each its own program
 * (`volumetricsFragment`) and every one declared when the chain is built, each
 * `active()` only while `live()` — the pass `Game` has latched ready this
 * frame, or null — is at its rung, and drawn off that pass's CPU half.
 * Babylon named each rung's pass `volumetrics_<rung>`, which is each stage's
 * label: its pipelines' and the target it reads (`PostProcessRTT-<it>`).
 */
export function volumetricStages(depth: FrameDepth, live: () => Volumetrics | null): PostStage[] {
  const rungs = Object.keys(CONFIG.graphics.volumetrics.rungs) as VolumetricRung[];
  return rungs.map((rung): PostStage => {
    const at = (): Volumetrics | null => {
      const v = live();
      return v && v.rung === rung ? v : null;
    };
    return {
      name: "shafts",
      label: `volumetrics_${rung}`,
      vertex: VOLUMETRICS_VERTEX,
      vertexBindings: VOLUMETRICS_VERTEX_BINDINGS,
      fragment: volumetricsFragment(rung),
      fragmentBindings: VOLUMETRICS_FRAGMENT_BINDINGS,
      // Every read of the input is at the pixel's own `vUV`.
      reads: "point",
      inputBinding: 0,
      inputSamplerBinding: 5,
      internalsBinding: 9,
      blockBinding: 10,
      inputSampler: INPUT_SAMPLER,
      blockFloats: B.floats,
      // The frame's depth by `textureLoad` (no sampler), then the three maps
      // each with the sampler it is bound with. Each is null until it exists
      // (the stage then draws nothing); `Game` latches the stage on only once
      // all four do, which is what `ready` asks.
      extras: [
        { binding: 1, texture: () => (depth.texture ? hostTexture(depth.texture as never) : null) },
        { binding: 2, samplerBinding: 6, texture: () => at()?.worldMap() ?? null },
        { binding: 3, samplerBinding: 7, texture: () => at()?.bodiesMap() ?? null },
        { binding: 4, samplerBinding: 8, texture: () => at()?.cloudField() ?? null },
      ],
      active: () => at() !== null,
      fill: (block, width, height) => at()!.fill(block, width, height),
    };
  });
}

function vec3(b: Float32Array, at: number, v: Vector3): void {
  b[at] = v.x;
  b[at + 1] = v.y;
  b[at + 2] = v.z;
}

function vec4(b: Float32Array, at: number, v: Vector4): void {
  b[at] = v.x;
  b[at + 1] = v.y;
  b[at + 2] = v.z;
  b[at + 3] = v.w;
}

/** A matrix as Babylon's `setMatrix` writes one: its sixteen floats in order; the identity while none is pushed. */
function mat4(b: Float32Array, at: number, m: Matrix | null): void {
  if (!m) {
    for (let i = 0; i < 16; i++) b[at + i] = i % 5 === 0 ? 1 : 0;
    return;
  }
  const a = m.m;
  for (let i = 0; i < 16; i++) b[at + i] = a[i];
}
