/**
 * Fxaa.ts — FXAA's CPU half: the player's switch and the post chain's stage
 * our renderer draws it as (`render/PostChain.ts`, `BABYLON_EXIT.md` X5.2c2).
 * Owns: `Fxaa` — whether it is on (the stage's `active()`) and `stage`: the
 * program as Babylon compiled it (`wgsl/fxaa.ts`: Babylon's own `fxaa` vertex
 * stage and the fragment this file used to register under Babylon's name,
 * with `CONFIG.graphics.fxaa`'s three constants), its 16-byte block
 * (`texelSize`, one over the input's size), no extra binding, and its input
 * read BILINEAR, clamped, as Babylon's `FxaaPostProcess` bound it.
 * Invariants: it is the chain's FIRST stage of ours, straight after the ink —
 * the host's list order, which `Game` assembles: it antialiases the lines the
 * ink drew (they come off a depth buffer, which has no antialiasing of its
 * own), and the shafts, the smear and the grade land on the antialiased frame.
 * Its block is filled when the host draws it, every float.
 * Never: draws, binds or owns a GPU resource (the host does).
 * Contract: `docs/rendering.md`.
 *
 * WHY THE PASS WAS OURS BEFORE IT WAS OUR DRAW: BABYLON'S FXAA RUNS AT ITS
 * SOFTEST AND THE NUMBER IS NOT EXPOSED.
 *
 * Its shader is NVIDIA's FXAA 3.11 "quality" path with the three knobs fixed
 * as `const`s, and the one that decides how soft the picture is —
 * `fxaaQualitySubpix` — is 1.0, which FXAA's own documentation calls the upper
 * limit ("softer"), with 0.75 its default. Sub-pixel filtering is a blend of
 * every pixel past the edge test toward a 3x3 low-pass of its neighbourhood,
 * and in this game nearly everything is past the edge test: the ink is
 * one-pixel lines on purpose and the ground's relief is a grain per pixel. So
 * at 1.0 the pass did not so much antialias the frame as blur it, which is
 * what made it read better switched off on a desktop. The text is Babylon's
 * but for those three constants: the edge search — the half of FXAA that
 * actually removes a stair — is untouched; what moves is how much of the
 * low-pass a pixel takes on top of it.
 *
 * **THERE IS NO MALI ARM, AND THERE NEVER WAS ONE UNDER THIS ENGINE.**
 * Babylon's text has one (`#ifdef MALI`: the early exit moved to the end, so
 * every pixel pays the full edge search), its define set by
 * `ThinFXAAPostProcess._GetDefines` when `engine.extractDriverInfo()` names
 * "mali" — and under WebGPU that is the empty string on every device
 * (`BABYLON_EXIT.md` X5.2a measured it), so the arm was compiled out on every
 * phone, Mali or not. The text ported is the one the parent's device was
 * handed, the early exit at the top.
 */
import type { PostStage } from "../render/PostChain";
import {
  FXAA_BLOCK as B,
  FXAA_FRAGMENT,
  FXAA_FRAGMENT_BINDINGS,
  FXAA_VERTEX,
  FXAA_VERTEX_BINDINGS,
} from "./wgsl/fxaa";

/**
 * The sampler Babylon bound FXAA's input with (`FxaaPostProcess`'s
 * `BILINEAR_SAMPLINGMODE`, on a texture with no mips; read off the parent's
 * device by `plans/webgpu-ref/post.mjs`).
 */
const INPUT_SAMPLER: GPUSamplerDescriptor = {
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
  addressModeW: "repeat",
  magFilter: "linear",
  minFilter: "linear",
  mipmapFilter: "nearest",
  lodMinClamp: 0,
  lodMaxClamp: 0,
  maxAnisotropy: 1,
};

export class Fxaa {
  /** The stage the post chain draws FXAA as. */
  readonly stage: PostStage;
  /** The player's setting — the stage's `active()`. */
  private enabled = true;

  constructor() {
    this.stage = {
      name: "fxaa",
      label: "fxaa",
      vertex: FXAA_VERTEX,
      vertexBindings: FXAA_VERTEX_BINDINGS,
      fragment: FXAA_FRAGMENT,
      fragmentBindings: FXAA_FRAGMENT_BINDINGS,
      // The edge search walks along the edge.
      reads: "neighbourhood",
      inputBinding: 0,
      inputSamplerBinding: 1,
      internalsBinding: 2,
      blockBinding: 3,
      inputSampler: INPUT_SAMPLER,
      blockFloats: B.floats,
      extras: [],
      active: () => this.enabled,
      fill: (block, width, height) => {
        // As Babylon's `PostProcess.texelSize`: one over the pass's own size.
        block[B.texelSize] = 1 / width;
        block[B.texelSize + 1] = 1 / height;
      },
    };
  }

  /** Turns FXAA on or off: its stage's `active()`, so off is a pass the host does not open. */
  setEnabled(on: boolean): void {
    this.enabled = on;
  }
}
