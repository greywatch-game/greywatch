/**
 * CloudShader.ts — What the sky's cloud masses are drawn WITH, as plain data
 * since `BABYLON_EXIT.md` X4.5b, when our renderer took the ring
 * (`render/CloudDraw.ts`, its program `render/cloudProgram.ts`, its bodies
 * `shaders/wgsl/cloud.ts`) and Babylon was made no `sky-clouds` mesh and no
 * `ShaderMaterial`. The light it states: a key cut twice off the light the map's
 * shadows fall from, asked mostly of each lump's SMOOTH normal so a terminator is
 * one line broken along the facets rather than a tone per triangle; a shadow side
 * pulled toward the dome's gradient behind it; a darker belly; a silver lining on
 * the rim when the eye looks toward that light; and the dome's own haze over the
 * low ones.
 * Owns: `CloudLook`, what `Sky` states a ring's look with, and `CloudPaint` —
 * the ring's values (`CloudRecipe`): that look, set once; and, written every
 * frame by `Sky`, the ring's `world`, the eye, the depth line and the flash on
 * the two lit tones. Owns no shape (`systems/cloudMasses.ts`), no placement or
 * drift (`systems/Sky.ts`) and no WGSL.
 * Invariants: every value is written in place into the array our renderer reads
 * (`values`), as `Float32Array` rounds it — what the material's uniform buffer
 * held, number for number — and nothing here allocates after construction;
 * unlit by any scene light and unfogged by the cel fog — a cloud is SKY, and the
 * atmosphere it takes is the dome's gradient rather than the village's fog wall;
 * the geometry is REAL world positions (a cloud stays over the field it is over
 * as the player walks) but every fragment writes the depth of a point 7 km out
 * along its own pixel's ray, so every surface in the world hides a cloud and a
 * cloud hides only the sun's disc; it writes coverage 0, as every opaque surface
 * does.
 * Never: imports anything of Babylon's but types; restates the WGSL.
 * Contract: `docs/rendering.md` ("The sky").
 *
 * **Every fragment on a pixel writes the SAME depth and back faces are CULLED,
 * and the two go together.** With one depth for the whole ring the buffer cannot
 * settle which facet is in front, so a closed lump is only right because its far
 * side is culled, and one lump in front of another is only right because `Sky`
 * draws the lumps back to front and the test is LEQUAL, so a later tie wins —
 * which is the state `CloudDraw`'s pipeline is built with.
 */
import type { Color3, Vector3 } from "@babylonjs/core";
import type { CloudField, CloudRecipe } from "../render/cloudProgram";

/** What `Sky` hands the paint. Colours are display-ready, like every palette here. */
export interface CloudLook {
  sunDir: Vector3;
  shade: Color3;
  lit: Color3;
  /** The dome's horizon band. */
  haze: Color3;
  /** The dome's top. */
  zenith: Color3;
  glow: Color3;
  litShare: number;
  hazeAtHorizon: number;
  lining: number;
  wrap: number;
  /** Share of the FACET normal in what the light sees; the rest is the lump's. */
  facetShare: number;
  /** How far the shadow side is pulled toward the sky behind it. */
  shadeSky: number;
  /** How much darker the belly's tone is. */
  belly: number;
  /** How much of the sky behind it every cloud takes, however high. */
  air: number;
  /** How far toward the lit tone the first cut goes; the highlight is the rest. */
  litStep: number;
  /** Where the highlight's cut sits, as a cosine to the light. */
  highlight: number;
  /** How far the shadow side's upper facets go toward the sky above them. */
  skyFill: number;
  /** How much of the air's share the LIT side sheds, 0..1. */
  litAir: number;
}

/** One ring's values, everything but the frame's camera. */
export class CloudPaint implements CloudRecipe {
  readonly values: Record<CloudField, Float32Array>;

  constructor(look: CloudLook) {
    const sun = look.sunDir.normalizeToNew();
    const rgb = (c: Color3): Float32Array => Float32Array.of(c.r, c.g, c.b);
    this.values = {
      world: new Float32Array(16),
      cloudEye: new Float32Array(3),
      depthRay: Float32Array.of(1, 1, 0, 0),
      depthLine: Float32Array.of(1, 0),
      sunDir: Float32Array.of(sun.x, sun.y, sun.z),
      shadeColor: rgb(look.shade),
      litColor: rgb(look.lit),
      hazeColor: rgb(look.haze),
      zenithColor: rgb(look.zenith),
      glowColor: rgb(look.glow),
      look: Float32Array.of(look.litShare, look.hazeAtHorizon, look.lining, look.wrap),
      form: Float32Array.of(look.facetShare, look.shadeSky, look.belly, look.air),
      tones: Float32Array.of(look.litStep, look.highlight),
      fill: Float32Array.of(look.skyFill, look.litAir),
    };
  }

  /** The ring's world matrix, `Matrix.m`'s layout. */
  setWorld(m: ArrayLike<number>): void {
    this.values.world.set(m);
  }

  /** The eye the terms that ask where the viewer is looking are measured from. */
  setEye(eye: Vector3): void {
    const e = this.values.cloudEye;
    e[0] = eye.x;
    e[1] = eye.y;
    e[2] = eye.z;
  }

  /** Where a fragment's depth comes from — `shaders/wgsl/cloud.ts`' surface says what each is. */
  setDepth(tanX: number, tanY: number, pixelX: number, pixelY: number, a: number, b: number): void {
    const ray = this.values.depthRay;
    ray[0] = tanX;
    ray[1] = tanY;
    ray[2] = pixelX;
    ray[3] = pixelY;
    const line = this.values.depthLine;
    line[0] = a;
    line[1] = b;
  }

  /** The two lit tones as they stand this frame, the flash on them. */
  setTones(shade: Color3, lit: Color3): void {
    const s = this.values.shadeColor;
    s[0] = shade.r;
    s[1] = shade.g;
    s[2] = shade.b;
    const l = this.values.litColor;
    l[0] = lit.r;
    l[1] = lit.g;
    l[2] = lit.b;
  }
}
