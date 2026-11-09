/**
 * PaperGrain.ts — The GRADE's CPU half: a VIVID chroma push, a midtone
 * CONTRAST curve, vignette, corner desaturation, radial chromatic
 * aberration, a PAPER grain pinned to the world, red damage flash — the
 * values, and the post chain's stage they are drawn by.
 * Owns: `PaperGrain` — the map's grade (`setGrade`), the player's switch
 * (`setEnabled`), the damage flash and its decay, the lattice offsets and the
 * rendered camera's basis read each frame, and `stage`, the `PostStage` our
 * renderer draws it as (`render/PostChain.ts`, `BABYLON_EXIT.md` X5.2c1: the
 * program as Babylon compiled it, `wgsl/paperGrain.ts`; its 496-byte block;
 * the frame's depth as its one extra binding; its input read NEAREST, clamped,
 * as Babylon bound it).
 * Why hand-written: Babylon's image-processing pass re-gammas the cel shader's
 * already display-ready colors and washes the palette out — which is also why
 * `scene.imageProcessingConfiguration.isEnabled` stays false (`Game`). Keep the grade in this pass.
 * Invariants: the grade is the chain's LAST stage by the HOST's order, not by
 * anything here — it is the last entry of `PostChain`'s list, and the host
 * hands the last ACTIVE stage the canvas; nothing here knows it is last or
 * that it writes the canvas. `setEnabled` is its `active()`, so the grade off
 * is a stage the host skips (and with no stage of ours active, Babylon's
 * prefix writes the canvas itself: `PostPasses`). It SAMPLES the frame's
 * depth (`FrameDepth`, shared with the ink, the blur and the shafts) to put
 * the paper on the surfaces rather than on the glass, so like them it has to
 * stay downstream of the pass the scene draws into. Its block is filled when
 * the host draws it — after the render has settled the view matrix, the one
 * the depth was written with — and every float of it every time.
 * Never: draws, binds or owns a GPU resource (the host does); reads the AIM
 * rather than the rendered camera.
 * Contract: `docs/rendering.md`, "Rendering constraints that look like bugs if
 * you undo them" (the grade's bullets) and "Our renderer's frame" (the host).
 */
import type { Camera } from "@babylonjs/core";
import { CONFIG } from "../config";
import { hostTexture } from "../render/babylonSeam";
import type { PostStage } from "../render/PostChain";
import type { EnvironmentSpec } from "../world/environment";
import type { FrameDepth } from "./FrameDepth";
import {
  PAPER_GRAIN_BLOCK as B,
  PAPER_GRAIN_FRAGMENT,
  PAPER_GRAIN_FRAGMENT_BINDINGS,
  PAPER_GRAIN_VERTEX,
  PAPER_GRAIN_VERTEX_BINDINGS,
  PAPER_LEVEL_MIN as LEVEL_MIN,
  PAPER_LEVELS as LEVELS,
  PAPER_PERIOD as PERIOD,
} from "./wgsl/paperGrain";

/**
 * THE PAPER IS PINNED TO THE WORLD, NOT TO THE SCREEN. A grain keyed on the
 * pixel reads as a film running over the scene: walk past a wall and the wall
 * slides under a texture that stays put. This one is keyed on WHERE THE PIXEL
 * IS — the frame's depth turned back into a position — so the tooth of the
 * paper belongs to the wall and moves with it, and the player walks through a
 * world drawn on paper rather than watching one projected onto it.
 *
 * A TEXTURE PINNED TO THE WORLD HAS NO SINGLE SIZE, and that is what the rest
 * of this is for. At one world scale the grain is a blur on a wall at arm's
 * length and a shimmer of sub-pixel noise down a street. So the paper is a
 * stack of OCTAVES, each one fixed in the world at a power-of-two cell size,
 * and which octaves are weighted is chosen by how big a pixel is at that
 * distance: walking toward a wall fades finer octaves in and coarser ones out,
 * continuously, and nothing slides — the "infinite zoom" of dynamic solid
 * textures (Bénard et al. 2010). The grain therefore holds ONE SIZE ON SCREEN
 * at every distance while never leaving the surface it is on. Each octave's
 * weight is zero at both ends of the stack, so an octave arriving or leaving
 * never pops, and each feature is normalised by the weights it actually got,
 * so the contrast does not breathe as the stack rolls.
 *
 * It is a SOLID texture — 3D noise over the position — so no surface normal is
 * needed, and a cut through it at any angle is paper. Three things are read
 * off the same octaves: TOOTH (the finest, signed), FIBRES (the zero crossings
 * of the middle ones, which trace thin curling lines) and MOTTLE (the coarsest,
 * the cloudiness of pulp).
 *
 * THREE THINGS ON SCREEN ARE NOT IN THE WORLD, and each is pinned to what it
 * moves with instead (`CONFIG.graphics.paper`): the WEAPON to the camera, found
 * by the same depth band the blur names it with; the SKY to the view direction,
 * being infinitely far; and nothing else — particles, tracers and see-through
 * glass write no depth, so they carry the paper of what is behind them, which
 * is what paint on a sheet does.
 *
 * THE SHEET IS LIT AND NOT LUMINOUS. The paper is laid on twice — multiplied
 * into the paint and added under it — and only the added half survives as the
 * paint goes to zero, so on its own it puts the most paper exactly where there
 * is no light to show any by. It therefore takes the light at the pixel
 * (`paper.litKnee`, `paper.litFloor`), which is what stops a night map being a
 * spray of grey over black at the amplitude a noon map spends on a white wall.
 * `docs/rendering.md` has what it measured and why the floor is not zero.
 *
 * PRECISION IS THE TRAP, and why the octaves are offset from the CPU. A world
 * coordinate of 2 km divided by a 1 mm cell is two million cells, and a float32
 * holds that to a quarter of a cell — the grain would crawl. So the shader
 * only ever divides CAMERA-RELATIVE distances, and where the camera sits inside
 * each octave's wrapped lattice (`PERIOD` cells) is computed in float64 once a
 * frame and uploaded per level. The depth buffer's own step is the second half
 * of it: a non-reversed depth32float loses decimetres by a few hundred metres,
 * so the footprint is never allowed under that step, or distant ground would
 * show the quantisation as contours in the grain.
 *
 * WHAT THE GRADE DOES, in its order (the compiled text, `wgsl/paperGrain.ts`,
 * has no comments, so the reasons live here):
 * - **Aberration**: radial, none at the centre, smeared at the edge — the
 *   input read at `uv ± offset`, which is what makes the stage read a
 *   NEIGHBOURHOOD and fold into nothing while it has it.
 * - **Where the pixel is**: the same ray `Volumetrics` builds, unnormalised
 *   with its camera-space z at exactly 1, so ray times depth is the point.
 *   The weapon is pinned to the camera, the sky to the direction, the rest to
 *   the world.
 * - **The footprint**: how many metres one FRAME pixel covers there — the
 *   distance times a pixel's angle, widened by the screen derivative on a
 *   surface seen edge-on (ground down a street), clamped so the 2x2 quad
 *   straddling a silhouette cannot blow a block of grain up to nothing, and
 *   on the world never finer than the depth buffer's own step.
 * - **VIVID**: chroma pushed away from grey, as a VIBRANCE rather than a
 *   saturation — scaled by how much colour the pixel does NOT already have,
 *   so a grey wall and a dusty field gain it and a team's armband, already at
 *   the gamut's edge, cannot clip into another hue. Ahead of the vignette, so
 *   the corners still drain toward the grey this lifted them from.
 * - **CONTRAST**: an S-curve on LUMINANCE, one scale on all three channels so
 *   it moves value and never hue, faded out under a quarter of full luminance
 *   so the darkest shadows stay where the lighting put them, and standing
 *   aside past 1 rather than folding back down the smoothstep.
 * - **Vignette**, then colour **draining toward the edges** of vision.
 * - **Damage**: blood pushes in from the border and never closes over the
 *   middle — the player still has to be able to fight while hurt.
 * - **The paper**, multiplied into the paint (a bright wall shows its tooth as
 *   a wash on a rough sheet does) and added under it (a black shadow is still
 *   ink on a sheet), the light side warm and the dark side neutral, the added
 *   half taking the light at the pixel down to a floor (the sheet is lit).
 */

/**
 * The sampler Babylon bound the grade's input with (its post-process's
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

export class PaperGrain {
  /** The stage the post chain draws the grade as. */
  readonly stage: PostStage;
  private damage = 0;
  /** Whether the player wants the grade at all — the stage's `active()`. */
  private enabled = true;

  /**
   * How hard the grade is pushed, as the map asked for it. Defaults to
   * `CONFIG.graphics`, which is Hollowmere's — so a map that says nothing
   * gets exactly the shipped look.
   */
  private vignette: number = CONFIG.graphics.vignette;
  private grain: number = CONFIG.graphics.grain;
  private aberration: number = CONFIG.graphics.aberration;
  private vivid: number = CONFIG.graphics.vivid;
  private contrast: number = CONFIG.graphics.contrast;

  constructor(
    private readonly camera: Camera,
    /** The frame's own depth image — what puts the paper on the surfaces. */
    depth: FrameDepth,
  ) {
    this.stage = {
      name: "grain",
      label: "paperGrain",
      vertex: PAPER_GRAIN_VERTEX,
      vertexBindings: PAPER_GRAIN_VERTEX_BINDINGS,
      fragment: PAPER_GRAIN_FRAGMENT,
      fragmentBindings: PAPER_GRAIN_FRAGMENT_BINDINGS,
      // The aberration reads the input at `uv ± offset`.
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
   * `scale` (1, 1: no power-of-two scaling), where the eye sits in each
   * level's lattice, the RENDERED camera's basis — read off the view matrix
   * after the render has settled it, which is the matrix the depth being read
   * was written with, view punch and all (`Volumetrics`' reason) — the
   * vertical-fixed FOV with the aspect off the input's own size, the clip
   * planes, and the grade's six scalars. Every float is written; the pads
   * stay zero.
   *
   * The offsets are computed here in float64 and are the whole precision story
   * (see the header): `position / cell mod PERIOD` is exact on the CPU and
   * crawls by a quarter-cell on the GPU.
   */
  private fill(b: Float32Array, width: number, height: number): void {
    b[B.scale] = 1;
    b[B.scale + 1] = 1;
    const p = this.camera.globalPosition;
    for (let i = 0; i < LEVELS; i++) {
      const inv = 2 ** -(LEVEL_MIN + i);
      const o = B.cellOffset + i * 4;
      b[o] = wrap(p.x * inv);
      b[o + 1] = wrap(p.y * inv);
      b[o + 2] = wrap(p.z * inv);
      b[o + 3] = 0;
    }
    const m = this.camera.getViewMatrix().m;
    b[B.camRight] = m[0];
    b[B.camRight + 1] = m[4];
    b[B.camRight + 2] = m[8];
    b[B.camUp] = m[1];
    b[B.camUp + 1] = m[5];
    b[B.camUp + 2] = m[9];
    b[B.camFwd] = m[2];
    b[B.camFwd + 1] = m[6];
    b[B.camFwd + 2] = m[10];
    const tanY = Math.tan(this.camera.fov * 0.5);
    b[B.tanHalfFov] = (tanY * width) / Math.max(1, height);
    b[B.tanHalfFov + 1] = tanY;
    b[B.nearFar] = this.camera.minZ;
    b[B.nearFar + 1] = this.camera.maxZ;
    b[B.vignette] = this.vignette;
    b[B.grain] = this.grain;
    b[B.aberration] = this.aberration;
    b[B.vivid] = this.vivid;
    b[B.contrast] = this.contrast;
    b[B.damage] = this.damage;
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
    this.vivid = grade?.vivid ?? g.vivid;
    this.contrast = grade?.contrast ?? g.contrast;
  }

  /**
   * Turns the whole grade on or off — a display setting, not a mood.
   *
   * The stage's `active()`, so off is a pass the host does not open rather
   * than a pass with its uniforms zeroed, which would still read and write
   * the entire frame. Note the red damage flash goes with it, since it is
   * painted by this shader; the HUD's directional damage arcs are not, and
   * are what a player with the grade off still reads a hit from.
   */
  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /** Kicks the red edge flash; call when the player takes a hit. */
  flashDamage(): void {
    this.damage = CONFIG.graphics.damageFlash;
  }

  /** Decays the damage flash. The paper has no clock: it is part of the world. */
  update(dt: number): void {
    if (this.damage > 0) {
      this.damage = Math.max(0, this.damage - dt * CONFIG.graphics.damageFlashDecay);
    }
  }
}

/** `x mod PERIOD`, positive, in float64. */
function wrap(x: number): number {
  return x - PERIOD * Math.floor(x / PERIOD);
}
