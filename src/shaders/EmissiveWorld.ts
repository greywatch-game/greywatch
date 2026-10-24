/**
 * EmissiveWorld.ts — The one material every lit window, lamp lens, ember and
 * sign in a map's MERGED world wears, whatever colour it emits: the emissive
 * palette, `getWorldCel`'s twin for the light sources. And the twin of it
 * `GlowPass` draws their bloom with.
 * Owns: Babylon's declarations of both WGSL stages (their bodies are
 * `wgsl/emissiveWorld.ts`'s, which a probe's bake on our renderer draws too)
 * and `EmissiveWorldMaterial` (`MAX_EMISSIVE_PALETTE` is the bodies' module's).
 * Is fed the fog and the palette by `CelMaterialFactory`, which is the only
 * thing that makes one (`getEmissiveWorld`), and the palette itself is
 * discovered by `MapBuilder`'s block merge.
 * Invariants: the main pass draws EXACTLY what `getEmissive`'s unlit
 * `StandardMaterial` plus `EmissiveFog` drew for the same colour — the colour,
 * faded toward the fog by the same curve over the same radial distance, alpha
 * 1 — so a block moving onto this material changes no pixel of the frame or
 * of a reflection bake. Its EYE is the cel materials' `camPos`, never
 * `ShaderMaterial`'s `cameraPosition` (see WHY ITS OWN EYE). The
 * mask twin runs the SAME vertex function, which is what lets its LEQUAL test
 * tie against the depth the main pass wrote, and carries the same polygon
 * offset. Never given a vertex colour buffer (`vertexShading` skips it). Never
 * worn by anything but a merge: every vertex it draws carries a slot.
 *
 * WHY IT EXISTS. `docs/rendering.md`, "The paint palette": the block merge
 * splits once per MATERIAL, and the albedo palette took a matte surface's
 * colour out of that key. An emissive was refused it, because an emissive is
 * a `StandardMaterial` and its colour is a uniform with no vertex path — so a
 * 48 m block of Coldharbour still held three or four emissive meshes, one per
 * colour, and every one of them is drawn TWICE: once into the frame and once
 * into the glow's mask (`FINDINGS.md` 43). This is that palette: the colour
 * is a slot in `uv2.x`, written by `writePaletteIndex` exactly as the albedo's
 * is, into a table of this material's own.
 *
 * WHY THE BLOOM FADES PER PIXEL HERE AND PER MESH EVERYWHERE ELSE. `GlowRules`
 * fades a bloom toward black by the fog at the mesh's bounding-sphere CENTRE —
 * sound for a block's windows of one colour, because they were a few metres
 * of one frontage. Merged across colours, a block's emissives are one mesh up
 * to the whole block across, and a window on its near side would fade as if
 * it stood at the far one. So the twin fades each pixel by its own distance,
 * through the curve `fogAmountAt` is, and `Game`'s rule leaves this material's
 * colour unfaded (`fadesOwnBloom`). It is the one LOOK change the palette
 * makes, and it moves the bloom toward what the wall around it already does.
 *
 * WHY ITS OWN EYE. `ShaderMaterial.bind` writes a declared `cameraPosition`
 * from `scene.activeCamera`, and a reflection probe never changes that: its
 * renderer draws with the PLAYER's camera and moves only the scene's forced
 * view position. The stock material read the scene's eye, which honours that,
 * so a probe fogged its lamps against the probe; reading `cameraPosition`
 * fogged every lamp a bake captured from wherever the player happened to
 * stand. So this takes `camPos` from `CelMaterialFactory.updateCamera`, the
 * one eye `ReflectionSystem` already moves per face and puts back — the wall
 * and the window in front of it fog against the same point by construction.
 * (That is Babylon's bake. Our renderer's draws this palette into a probe's
 * faces with its own program and the bake's own frame, whose `camPos` IS the
 * probe — `render/emissiveWorld.ts`, `BABYLON_EXIT.md` X3.6c.)
 *
 * WHY IT DECLARES `emissiveColor`. `GlowPass` and `WorldCulling` decide what is
 * a light source by that property and nothing else, exactly as for the fire
 * (`FlameMaterial`). It is WHITE, so `GlowRules.colour` hands the twin the
 * rule's own scale (the kit screen's admission, an intensity) and the palette
 * supplies the colour.
 */
import {
  Color3,
  Constants,
  ShaderLanguage,
  ShaderMaterial,
  ShaderStore,
  Vector2,
  type Material,
  type Matrix,
  type Mesh,
  type Scene,
  type SubMesh,
  Vector3,
} from "@babylonjs/core";
import type { SelfMasking } from "./GlowPass";
import { EMISSIVE_WORLD_SURFACE, EMISSIVE_WORLD_VERTEX, MAX_EMISSIVE_PALETTE } from "./wgsl/emissiveWorld";

// The bodies are `wgsl/emissiveWorld.ts`'s, which our renderer assembles too
// (a probe's bake, `render/emissiveWorld.ts`): this file holds Babylon's
// declarations and the `main`s that call them.
ShaderStore.ShadersStoreWGSL["emissiveWorldVertexShader"] = `
attribute position: vec3f;
attribute uv2: vec2f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;

varying vPosW: vec3f;
varying vSlot: f32;
${EMISSIVE_WORLD_VERTEX}
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  emissiveWorldVertex();
}
`;

ShaderStore.ShadersStoreWGSL["emissiveWorldFragmentShader"] = `
varying vPosW: vec3f;
varying vSlot: f32;

// The cel materials' eye, not Babylon's \`cameraPosition\` — see the header.
uniform camPos: vec3f;
uniform emissivePalette: array<vec3f, ${MAX_EMISSIVE_PALETTE}>;
uniform fogColor: vec3f;
// x = fogStart, y = 1 / (fogEnd - fogStart): \`EmissiveFog\`'s pair, computed
// the same way on the CPU, so the curve below rounds as that plugin's did.
uniform fogRange: vec2f;
#ifdef GLOW_MASK
// rgb = GlowRules' scale for this mesh (unfaded — see the header), a = alpha.
uniform glowColor: vec4f;
#endif
${EMISSIVE_WORLD_SURFACE}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  fragmentOutputs.color = emissiveWorldSurface();
}
`;

const COMMON_UNIFORMS = [
  "world",
  "viewProjection",
  "camPos",
  "emissivePalette",
  "fogColor",
  "fogRange",
];

/** What `GlowPass` hands a self-masking material to call on every mask draw. */
type GlowMaskPaint = Parameters<SelfMasking["glowMask"]>[0];

/** The mask twin: the same vertex stage, the same offset, no depth written. */
class EmissiveWorldMask extends ShaderMaterial {
  constructor(
    scene: Scene,
    private readonly paint: GlowMaskPaint,
  ) {
    super(
      "emissiveWorldGlowMask",
      scene,
      { vertex: "emissiveWorld", fragment: "emissiveWorld" },
      {
        attributes: ["position", "uv2"],
        uniforms: [...COMMON_UNIFORMS, "glowColor"],
        defines: ["#define GLOW_MASK"],
        shaderLanguage: ShaderLanguage.WGSL,
      },
    );
    this.disableDepthWrite = true;
    this.depthFunction = Constants.LEQUAL;
    this.backFaceCulling = true;
  }

  override bindForSubMesh(world: Matrix, mesh: Mesh, subMesh: SubMesh): void {
    super.bindForSubMesh(world, mesh, subMesh);
    this.paint(mesh, subMesh);
  }
}

export class EmissiveWorldMaterial extends ShaderMaterial implements SelfMasking {
  /** What `GlowPass` and `WorldCulling` read to know this is a light source — see the header. */
  readonly emissiveColor = Color3.White();

  private readonly masks: EmissiveWorldMask[] = [];
  // Unfogged and at the origin until told: the factory pushes the fog and the
  // eye before it hands the material out, so neither default is ever drawn.
  private readonly fogRange = new Vector2(0, 0);
  private readonly fogColor = new Color3(0, 0, 0);
  private readonly eye = Vector3.Zero();

  /** `palette` is the factory's table, held by reference — see `setPalette`. */
  constructor(
    scene: Scene,
    name: string,
    depthUnits: number,
    private palette: Float32Array,
  ) {
    super(
      name,
      scene,
      { vertex: "emissiveWorld", fragment: "emissiveWorld" },
      {
        attributes: ["position", "uv2"],
        uniforms: COMMON_UNIFORMS,
        shaderLanguage: ShaderLanguage.WGSL,
      },
    );
    this.backFaceCulling = true;
    this.zOffsetUnits = depthUnits;
    this.configure(this);
    this.freeze();
  }

  /** Asked by `GlowPass`, once. See `SelfMasking` there. */
  glowMask(paint: GlowMaskPaint): ShaderMaterial {
    const mask = new EmissiveWorldMask(this.getScene(), paint);
    // The LEQUAL tie holds only if the mask is biased as the draw that wrote
    // the depth was — `GlowPass.dress` copies it for its own variants.
    mask.zOffsetUnits = this.zOffsetUnits;
    this.configure(mask);
    mask.freeze();
    this.masks.push(mask);
    return mask;
  }

  /** The map's emissive colours, onto this and every mask twin. */
  setPalette(table: Float32Array): void {
    this.palette = table;
    for (const mat of [this, ...this.masks]) {
      mat.setArray3("emissivePalette", table as unknown as number[]);
    }
  }

  /** The cel materials' eye, onto this and every mask twin — see the header. */
  setEye(pos: Vector3): void {
    this.eye.copyFrom(pos);
    for (const mat of [this, ...this.masks]) mat.setVector3("camPos", this.eye);
  }

  /**
   * `EmissiveFog`'s band, onto this and every mask twin — which reads only
   * its range, fading toward black on it rather than toward the colour.
   */
  setFog(color: Color3, start: number, end: number): void {
    this.fogColor.copyFrom(color);
    this.fogRange.set(start, 1 / Math.max(0.001, end - start));
    for (const mat of [this, ...this.masks]) {
      mat.setColor3("fogColor", this.fogColor);
      mat.setVector2("fogRange", this.fogRange);
    }
  }

  private configure(mat: ShaderMaterial): void {
    mat.setArray3("emissivePalette", this.palette as unknown as number[]);
    mat.setColor3("fogColor", this.fogColor);
    mat.setVector2("fogRange", this.fogRange);
    mat.setVector3("camPos", this.eye);
  }
}

/** Whether a material is the emissive palette — `vertexShading` asks, to leave it unbaked. */
export function isEmissiveWorld(material: Material | null): material is EmissiveWorldMaterial {
  return material instanceof EmissiveWorldMaterial;
}

/**
 * Whether a material fades its own bloom per pixel, so `GlowRules.colour` must
 * not fade it again per mesh — see the header.
 */
export function fadesOwnBloom(material: Material): boolean {
  return isEmissiveWorld(material);
}
