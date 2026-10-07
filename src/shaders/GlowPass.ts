/**
 * GlowPass.ts — The game's bloom, as a pass it OWNS end to end: the emissive
 * mask, the blur, and the additive compose's arithmetic. Owns its targets, its
 * override materials and the depth it borrows; reads no game state (what may glow and
 * how brightly are `GlowRules`, handed in by `Game`) and writes to no mesh.
 * Invariants: the mask is drawn against the frame's OWN depth, borrowed at the
 * size that depth is at on the frame it is borrowed — so a bloom that reaches
 * through a wall is a bug here and never a tuning question; nothing here draws
 * into that depth; and every Babylon call is public API.
 *
 * WHAT IT REPLACED, AND WHY. The bloom was a `GlowLayer` with `GlowDepth`
 * bolted on from the outside. The layer is built to own four things — its
 * texture, its depth buffer, its clear and its place in the frame — and
 * `GlowDepth` overrode all four through three Babylon internals, re-applying
 * the overrides every frame because the layer kept putting its own back. What
 * that bought is kept here exactly: the render list is the emissive meshes
 * ALONE, and their occlusion is the main pass's depth rather than the whole
 * visible scene redrawn in opaque black (docs/rendering.md, "The glow: what
 * the depth share replaced" — ~20% of the frame on
 * Coldharbour, Harrowmead and Sarab). What it cost is gone by construction:
 *
 * - **No schedule to move.** The mask is a target nothing else renders; it is
 *   rendered once, from the end of the draw phase, where the depth is final.
 * - **No clear to replace.** Colour only, installed once on a texture nothing
 *   else ever recreates — `resize` swaps its wrapper and keeps the observer.
 * - **No framebuffer to re-bind by internal.** The frame is `frame.inputTexture`,
 *   a public getter on the pass the scene draws into.
 * - **No frame lost on a resize.** The layer's
 *   texture and the depth it borrowed resized on different schedules, and the
 *   frame between was encoded with a colour attachment at one size and a depth
 *   at another and rejected whole. Here ONE function reads the size of the
 *   depth it is about to borrow, resizes to it, shares, and draws, so the two
 *   ends cannot disagree on any frame.
 * - **The blur is off the backing store.** Depth sharing needs the mask at full
 *   resolution, and the layer blurred the texture it drew, so four times the
 *   pixels went through the blur. The mask stays full resolution — `CelInk`
 *   reads it as its emissive mask — and the blur starts from a half-resolution
 *   downsample, which is the size the kernel was tuned at in the first place.
 *
 * THE GLOW SETTING MOVES WHERE THE BLUR STARTS AND NOTHING ELSE
 * (`CONFIG.graphics.glowTiers`). `high` is the paragraph above. `low` blurs at
 * a quarter and an eighth instead, with the kernel halved in texels so the
 * bloom reaches exactly as far on screen and is only softer. It owes one more
 * pass to do that honestly: the first blur reads the full-resolution mask
 * with taps spaced in texels of its OWN target, which at half resolution
 * already touches about half the mask's pixels and at quarter would touch an
 * eighth — a one-pixel tracer or reticle line falling between taps and
 * flickering as it moved. So `low` first box-filters the mask to quarter
 * resolution (`glowDown`, four bilinear taps reading every pixel once) and
 * blurs from that.
 *
 * THE MASK IS DRAWN WITH AN OVERRIDE MATERIAL, NOT WITH THE MESH'S OWN. Every
 * glowing mesh wears an unlit `StandardMaterial` already faded by `EmissiveFog`,
 * and drawing that would be simpler — but `EmissiveFog` fades a colour TOWARD
 * THE FOG, and a bloom of the fog colour is a white haze round every distant
 * lamp on a bright map. So the mask is one small WGSL material (a few variants,
 * below) handed each mesh's colour by `GlowRules.colour`, which fades toward
 * black instead. It writes NO depth: every mesh it draws already wrote its own
 * into the frame's buffer in the main pass, so an LEQUAL test against that
 * buffer is the whole of the occlusion — and a blended mesh that wrote none
 * must not start writing one here, or the ink and the blur read it.
 *
 * THE LOOK is Babylon's glow layer as it was tuned: a Gaussian `kernelBlur`
 * at half resolution and again at quarter, the two summed, scaled by
 * `glowIntensity`, clamped to 1, added to the frame. The one deliberate change
 * is WHERE: the bloom is added AFTER the ink rather than blended onto the frame
 * before it, so a bloom lies over the ink lines around its lamp rather than
 * under them.
 *
 * THE COMPOSE IS NOT A PASS OF ITS OWN, and that is a phone's fill rate rather
 * than tidiness. It reads one pixel of the frame and adds two bilinear taps,
 * so as a post-process it was a whole-frame write and read for three fetches —
 * on a tile-based GPU, a round trip of the full backing store through memory.
 * So the arithmetic stays HERE, as `GLOW_COMPOSE_WGSL` and `bindCompose`, and
 * `CelInk` splices it into its own last line: the ink already holds the pixel,
 * and adding the bloom after its own `mix` is exactly the order the separate
 * pass kept. The one difference is that the inked frame is no longer rounded
 * to 8 bits before the bloom lands on it, which is under half a step.
 *
 * A MATERIAL WHOSE VERTICES MOVE BRINGS ITS OWN MASK (`SelfMasking`). The
 * stock variants transform by `world` and `viewProjection` alone, so a surface
 * displaced in its vertex stage — the fire (`FlameShader`) — would draw its
 * rest pose into the mask and fail the LEQUAL tie everywhere it had moved. Such
 * a material hands back a twin that runs its own vertex stage, and is painted
 * through the same `GlowRules.colour` as everything else.
 *
 * MESH INSTANCES ARE NOT SUPPORTED, and nothing glowing uses them: the mask
 * shader has no instance attributes, so an instanced emissive would draw one
 * copy. A DEV build says so the first time it meets one.
 */
import {
  Color4,
  Constants,
  EffectRenderer,
  EffectWrapper,
  Observable,
  RenderTargetTexture,
  ShaderLanguage,
  ShaderMaterial,
  ShaderStore,
  ThinBlurPostProcess,
  Vector2,
  type AbstractMesh,
  type BaseTexture,
  type Camera,
  type Effect,
  type Material,
  type Matrix,
  type Mesh,
  type Nullable,
  type PostProcess,
  type Scene,
  type StandardMaterial,
  type SubMesh,
} from "@babylonjs/core";
import { CONFIG } from "../config";

ShaderStore.ShadersStoreWGSL["glowMaskVertexShader"] = `
attribute position: vec3f;
#ifdef UV
attribute uv: vec2f;
varying vUV: vec2f;
#endif

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  // The SAME expression, in the same order, as the StandardMaterial that drew
  // this mesh into the frame — world first, then the view-projection — so the
  // LEQUAL test against the depth that material wrote ties exactly.
  let worldPos = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = uniforms.viewProjection * worldPos;
#ifdef UV
  vertexOutputs.vUV = vertexInputs.uv;
#endif
}
`;

ShaderStore.ShadersStoreWGSL["glowMaskFragmentShader"] = `
#ifdef UV
varying vUV: vec2f;
#endif
#ifdef EMISSIVE
var emissiveSamplerSampler: sampler;
var emissiveSampler: texture_2d<f32>;
#endif
#ifdef OPACITY
var opacitySamplerSampler: sampler;
var opacitySampler: texture_2d<f32>;
#endif

// rgb = the bloom colour GlowRules.colour wrote, a = the material's alpha.
uniform glowColor: vec4f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  var colour = uniforms.glowColor;
  // Babylon's glow map, term for term: the opacity map's alpha scales the
  // colour's alpha, and the emissive map multiplies the lot.
#ifdef OPACITY
  colour = vec4f(colour.rgb, colour.a * textureSample(opacitySampler, opacitySamplerSampler, fragmentInputs.vUV).a);
#endif
#ifdef EMISSIVE
  colour = colour * textureSample(emissiveSampler, emissiveSamplerSampler, fragmentInputs.vUV);
#endif
  fragmentOutputs.color = colour;
}
`;

// The `low` rung's downsample: the full-resolution mask to a quarter, as a 4x4
// box. Each tap sits one source texel off the output texel's centre, which is
// the corner a 2x2 quad of source pixels shares, so bilinear filtering
// averages that quad and the four taps read all sixteen pixels once. Exactly
// so where the frame divides by four. Elsewhere the quarter target is floored,
// a texel spans a little over four pixels (1755 / 438 is 4.007) and the taps
// slide off the corners: the weights go uneven and about one column in 150 is
// read faintly, against seven pixels in eight the first blur would miss
// without this pass.
ShaderStore.ShadersStoreWGSL["glowDownFragmentShader"] = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;

// One texel of the SOURCE, the mask.
uniform texel: vec2f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = fragmentInputs.vUV;
  let d = uniforms.texel;
  let sum =
    textureSampleLevel(textureSampler, textureSamplerSampler, uv + vec2f(-d.x, -d.y), 0.0) +
    textureSampleLevel(textureSampler, textureSamplerSampler, uv + vec2f(d.x, -d.y), 0.0) +
    textureSampleLevel(textureSampler, textureSamplerSampler, uv + vec2f(-d.x, d.y), 0.0) +
    textureSampleLevel(textureSampler, textureSamplerSampler, uv + vec2f(d.x, d.y), 0.0);
  fragmentOutputs.color = sum * 0.25;
}
`;

/** A rung of the Glow setting — derived from the config for `VolumetricRung`'s reason. */
export type GlowRung = keyof typeof CONFIG.graphics.glowTiers;

/**
 * The bloom's compose, as WGSL for the pass that runs it (`CelInk`, the header
 * says why it is not a pass of its own). Splice it in at the top level of a
 * fragment shader, declare `GLOW_COMPOSE_UNIFORMS` and `GLOW_COMPOSE_SAMPLERS`
 * on that pass, call `bindCompose` from its `onApply`, and add `glowAt(uv)` to
 * the finished pixel.
 */
export const GLOW_COMPOSE_WGSL = `
var glowNearSampler: sampler;
var glowNear: texture_2d<f32>;
var glowWideSampler: sampler;
var glowWide: texture_2d<f32>;

uniform glowIntensity: f32;

// Clamped BEFORE the add, as the layer's merge was: it wrote into an 8-bit
// target and was blended on from there. The layer's blend also scaled by the
// merge's alpha, which was always 1 — the mask clears to alpha 1 and nothing
// drawn into it lowers that — so there is no alpha term here, and the caller
// keeps whatever alpha it was going to write.
fn glowAt(uv: vec2f) -> vec3f {
  let near = textureSampleLevel(glowNear, glowNearSampler, uv, 0.0).rgb;
  let wide = textureSampleLevel(glowWide, glowWideSampler, uv, 0.0).rgb;
  return min((near + wide) * uniforms.glowIntensity, vec3f(1.0));
}
`;

/** What a pass splicing in `GLOW_COMPOSE_WGSL` declares beside its own. */
export const GLOW_COMPOSE_UNIFORMS = ["glowIntensity"] as const;
export const GLOW_COMPOSE_SAMPLERS = ["glowNear", "glowWide"] as const;

/** What `Game` decides about the bloom, and the only game knowledge this pass sees. */
export interface GlowRules {
  /**
   * Whether an emissive mesh without `metadata.noGlow` may bloom this frame.
   * Asked once per mesh per frame, while the list is built.
   */
  admits(mesh: AbstractMesh): boolean;
  /**
   * The bloom colour for one mesh, written into `out` — rgb the colour, a the
   * material's alpha. Asked at bind time, once per draw.
   */
  colour(mesh: AbstractMesh, material: StandardMaterial, out: Color4): void;
}

/**
 * A glowing material that draws its own mask — see the header. `glowMask` is
 * asked ONCE per material; the twin it returns must write `glowColor` from
 * the paint call after its own bind, never write depth, and test LEQUAL.
 */
export interface SelfMasking {
  glowMask(paint: (mesh: AbstractMesh, sub: SubMesh) => void): ShaderMaterial;
}

function selfMasking(material: Material): material is Material & SelfMasking {
  return typeof (material as Partial<SelfMasking>).glowMask === "function";
}

/** The emissive half of a material, as far as this pass reads it. */
type Emissive = Material & {
  emissiveColor?: { r: number; g: number; b: number };
  emissiveTexture?: BaseTexture | null;
  opacityTexture?: BaseTexture | null;
};

/**
 * The mask material. A `ShaderMaterial` whose per-mesh values are written at
 * bind time — `bindForSubMesh` is where the draw's own effect is in hand, which
 * `onBindObservable` does not give.
 */
class GlowMaskMaterial extends ShaderMaterial {
  constructor(
    scene: Scene,
    private readonly flags: number,
    private readonly paint: (mesh: AbstractMesh, material: GlowMaskMaterial, sub: SubMesh) => void,
  ) {
    const uv = (flags & (EMISSIVE | OPACITY)) !== 0;
    const samplers: string[] = [];
    const defines: string[] = [];
    if (uv) defines.push("#define UV");
    if (flags & EMISSIVE) {
      samplers.push("emissiveSampler");
      defines.push("#define EMISSIVE");
    }
    if (flags & OPACITY) {
      samplers.push("opacitySampler");
      defines.push("#define OPACITY");
    }
    super(
      `glowMask-${flags}`,
      scene,
      { vertex: "glowMask", fragment: "glowMask" },
      {
        attributes: uv ? ["position", "uv"] : ["position"],
        uniforms: ["world", "viewProjection", "glowColor"],
        samplers,
        defines,
        // Blended exactly when the mesh's own material is, which also sorts it
        // into the same queue it drew in; `needAlphaBlendingForMesh` adds a
        // mesh faded by `visibility` on its own.
        needAlphaBlending: (flags & BLEND) !== 0,
        shaderLanguage: ShaderLanguage.WGSL,
      },
    );
    this.disableDepthWrite = true;
    this.depthFunction = Constants.LEQUAL;
    this.backFaceCulling = true;
    // **FROZEN, like every other `ShaderMaterial` in the tree**, and this one
    // was the exception rather than the decision — `FlameMaterial.glowMask`
    // already freezes the twin it hands this same pass. `ShaderMaterial.isReady`
    // runs for every submesh of every draw and rebuilds the whole define set
    // before it can answer: two arrays, a `#define` per entry and a join, all
    // of it thrown away against the string already on the wrapper
    // (docs/rendering.md, "Frozen materials", where that walk is a fifth of
    // everything this game allocates). The define set here is fixed at construction — it IS the
    // cache key, `flags` — so there is nothing for the rebuild to discover.
    //
    // It is safe for the reason `CelMaterialFactory.remember` records: what
    // `isReady` would vary the defines on is a property of the MESH (a vertex
    // colour buffer, instancing, bones, morph targets), and this cache is
    // keyed so that cannot differ — `flags` carries the two textures and the
    // blend, instancing is unsupported outright (see the header), and no
    // glowing mesh has bones or morph targets. What freezing does NOT stop is
    // the uniform push: `_mustRebind` does not consult it, so `bindForSubMesh`
    // and the `glowColor` every draw writes through it keep flowing.
    this.freeze();
  }

  get samplesTextures(): boolean {
    return (this.flags & (EMISSIVE | OPACITY)) !== 0;
  }

  override bindForSubMesh(world: Matrix, mesh: Mesh, subMesh: SubMesh): void {
    super.bindForSubMesh(world, mesh, subMesh);
    this.paint(mesh, this, subMesh);
  }
}

const EMISSIVE = 1;
const OPACITY = 2;
const BLEND = 4;

/** The mask's clear: black, alpha 1 — the value the compose's missing alpha term assumes. */
const NEUTRAL = new Color4(0, 0, 0, 1);

export class GlowPass {
  /**
   * The emissive meshes alone, full resolution, UNBLURRED, depth-tested against
   * this frame. `CelInk` reads it as its emissive mask. The object is stable
   * for the life of the pass; `resize` swaps what is under it.
   */
  readonly mask: RenderTargetTexture;

  /**
   * Fired around the pass's own work — the mask and its blur, at the end of
   * the draw phase — so the frame profiler can bracket it without this file
   * knowing it exists. The compose is three fetches inside `CelInk` and is
   * that pass's cost now.
   */
  readonly onBeforeWorkObservable = new Observable<void>();
  readonly onAfterWorkObservable = new Observable<void>();

  /**
   * The mask box-filtered to quarter resolution, which the `low` rung blurs
   * from (see the header). 1x1 on `high`, which never reads it.
   */
  private readonly down: RenderTargetTexture;
  /** `downsample` below the frame: the horizontal pass's output, then the finished blur. */
  private readonly nearH: RenderTargetTexture;
  private readonly near: RenderTargetTexture;
  /** Half of `near` again, blurred from it. */
  private readonly wideH: RenderTargetTexture;
  private readonly wide: RenderTargetTexture;

  private readonly blurs: ThinBlurPostProcess[];
  private readonly downsample: EffectWrapper;
  /** What the first blur reads this frame: `down` on `low` once it is drawn, else the mask. */
  private firstSource: RenderTargetTexture;
  private rung: GlowRung = "high";
  /** Set when the rung moves, so the next frame re-sizes the targets whatever the frame did. */
  private stale = false;
  private readonly renderer: EffectRenderer;

  /** The pass the scene draws into, whose depth the mask borrows. */
  private frame: PostProcess | null = null;

  /** Both ends of the last depth share. A share is a relation between two targets. */
  private sharedFrom: object | null = null;
  private sharedTo: object | null = null;

  private readonly materials = new Map<number | string, GlowMaskMaterial>();
  /** The twins `SelfMasking` materials handed back, one per source material. */
  private readonly ownMasks = new WeakMap<Material, ShaderMaterial>();
  /** What each mesh wears in the mask pass, so the override is only set when it changes. */
  private readonly worn = new WeakMap<AbstractMesh, ShaderMaterial>();
  /** The list handed back each frame, reused so a frame allocates nothing. */
  private readonly kept: AbstractMesh[] = [];
  private readonly colour = new Color4();
  private warnedInstances = false;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly rules: GlowRules,
  ) {
    const engine = scene.getEngine();

    this.mask = this.target("glowMask", Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.mask.renderParticles = false;
    this.mask.renderSprites = false;
    // The whole target, whatever the camera's viewport says.
    this.mask.ignoreCameraViewport = true;
    // COLOUR ONLY. The depth attachment is the frame's, borrowed; a clear that
    // took it would leave nothing to occlude against, and every lamp in the
    // map would bloom through the wall it hangs on. An observer here replaces
    // Babylon's default clear rather than adding to one.
    this.mask.onClearObservable.add((e) => e.clear(NEUTRAL, true, false, false));
    // NULL, not the empty array a target is born with: with no list of its own
    // the target hands `getCustomRenderList` the frame's ACTIVE meshes — the
    // culling already done — and with an empty one it hands it nothing, which
    // is a mask with no lamps in it and no error anywhere.
    this.mask.renderList = null;
    this.mask.getCustomRenderList = (_pass, list, length) =>
      this.buildList(list, length);

    const half = Constants.TEXTURETYPE_HALF_FLOAT;
    this.down = this.target("glowDown", half);
    this.firstSource = this.mask;
    this.nearH = this.target("glowNearH", half);
    this.near = this.target("glowNear", half);
    this.wideH = this.target("glowWideH", half);
    this.wide = this.target("glowWide", half);

    this.renderer = new EffectRenderer(engine);
    const kernel = this.kernelTexels();
    const across = new Vector2(1, 0);
    const down = new Vector2(0, 1);
    // The first pass's source is read at bind time: it is the mask or `down`.
    const sources = [null, this.nearH, this.near, this.wideH];
    this.blurs = sources.map((source, i) => {
      const blur = new ThinBlurPostProcess(`glowBlur${i}`, engine, i % 2 === 0 ? across : down, kernel);
      blur.onApplyObservable.add(() => {
        blur.effect.setTexture("textureSampler", source ?? this.firstSource);
      });
      return blur;
    });

    this.downsample = new EffectWrapper({
      engine,
      name: "glowDown",
      fragmentShader: "glowDown",
      useShaderStore: true,
      // Babylon's own post-process binding — no blending, and the `scale` its
      // stock vertex stage reads — which is the shape `ThinBlurPostProcess`
      // takes.
      useAsPostProcess: true,
      uniforms: ["texel"],
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.downsample.onApplyObservable.add(() => {
      const size = this.mask.getSize();
      this.downsample.effect.setTexture("textureSampler", this.mask);
      this.downsample.effect.setFloat2("texel", 1 / size.width, 1 / size.height);
    });

    scene.onAfterDrawPhaseObservable.add(() => this.render());
  }

  /**
   * Names the pass the scene draws into, whose depth the mask borrows.
   *
   * **`frame` must be the FIRST pass in the chain**, because it is the only one
   * Babylon gives a depth buffer to — `render` asserts it in a DEV build.
   */
  drawsInto(frame: PostProcess): void {
    this.frame = frame;
  }

  /**
   * The Glow setting. A no-op unless the rung moved; a move re-sizes the blur's
   * targets on the next frame, and the kernel follows by itself because it is
   * read before every blur.
   */
  setQuality(rung: GlowRung): void {
    if (rung === this.rung) return;
    this.rung = rung;
    this.stale = true;
  }

  /**
   * Binds what `GLOW_COMPOSE_WGSL` reads, from the `onApply` of the pass that
   * spliced it in. Declared samplers must be BOUND or the draw is silently
   * lost; both targets exist from construction, so neither can be missing.
   */
  bindCompose(effect: Effect): void {
    effect.setFloat("glowIntensity", CONFIG.graphics.glowIntensity);
    effect.setTexture("glowNear", this.near);
    effect.setTexture("glowWide", this.wide);
  }

  /** The emissive meshes of this frame, dressed for the mask. */
  private buildList(list: Nullable<readonly AbstractMesh[]>, length: number): AbstractMesh[] {
    const kept = this.kept;
    kept.length = 0;
    if (!list) return kept;
    for (let i = 0; i < length; i++) {
      const mesh = list[i];
      const material = mesh.material as Emissive | null;
      const e = material?.emissiveColor;
      if (!material || !e || (e.r <= 0 && e.g <= 0 && e.b <= 0)) continue;
      if (mesh.metadata?.noGlow === true) continue;
      if (!this.rules.admits(mesh)) continue;
      if (import.meta.env.DEV && !this.warnedInstances && (mesh as Mesh).hasInstances) {
        this.warnedInstances = true;
        console.warn(`GlowPass: "${mesh.name}" is instanced; the mask draws one copy of it`);
      }
      this.dress(mesh, material);
      kept.push(mesh);
    }
    return kept;
  }

  /** Puts the right mask variant on a mesh, touching Babylon only when it changed. */
  private dress(mesh: AbstractMesh, material: Emissive): void {
    if (selfMasking(material)) {
      let own = this.ownMasks.get(material);
      if (!own) {
        own = material.glowMask((m, sub) => this.paintColour(m, sub));
        this.ownMasks.set(material, own);
      }
      if (this.worn.get(mesh) === own) return;
      this.worn.set(mesh, own);
      this.mask.setMaterialForRendering(mesh, own);
      return;
    }
    const flags =
      (material.emissiveTexture ? EMISSIVE : 0) |
      (material.opacityTexture ? OPACITY : 0) |
      (material.needAlphaBlending() ? BLEND : 0);
    // The source's polygon offset is part of the variant: the LEQUAL tie
    // against the frame's depth only holds if the mask is biased exactly as
    // the draw that wrote it was (a lit room over a `backed` pane is, see
    // `CelMaterialFactory.getEmissive`).
    const units = material.zOffsetUnits;
    const key = units === 0 ? flags : `${flags}@${units}`;
    let mat = this.materials.get(key);
    if (!mat) {
      mat = new GlowMaskMaterial(this.scene, flags, (m, self, sub) => this.paint(m, self, sub));
      mat.zOffsetUnits = units;
      this.materials.set(key, mat);
    }
    if (this.worn.get(mesh) === mat) return;
    this.worn.set(mesh, mat);
    this.mask.setMaterialForRendering(mesh, mat);
  }

  /** Writes one draw's colour and textures, off the mesh's own material. */
  private paint(mesh: AbstractMesh, mat: GlowMaskMaterial, sub: SubMesh): void {
    const effect = sub.effect;
    const material = mesh.material as Emissive | null;
    if (!effect || !material) return;
    this.paintColour(mesh, sub);
    if (mat.samplesTextures) {
      if (material.emissiveTexture) effect.setTexture("emissiveSampler", material.emissiveTexture);
      if (material.opacityTexture) effect.setTexture("opacitySampler", material.opacityTexture);
    }
  }

  /** One draw's bloom colour, the half of `paint` every mask shares. */
  private paintColour(mesh: AbstractMesh, sub: SubMesh): void {
    const effect = sub.effect;
    const material = mesh.material;
    if (!effect || !material) return;
    this.rules.colour(mesh, material as StandardMaterial, this.colour);
    effect.setDirectColor4("glowColor", this.colour);
  }

  /**
   * The mask and its blur, at the end of the draw phase.
   *
   * Sized, shared and drawn in one function, which is the whole of the resize
   * fix: the size is READ off the depth this is about to borrow, on the frame
   * it is borrowed, so the colour attachment and the depth attachment of the
   * mask's pass are never two sizes.
   */
  private render(): void {
    // Render targets drive this observable too — a reflection probe's bake is
    // the one that matters — and a probe's depth is not the frame's.
    if (this.scene.activeCamera !== this.camera) return;
    const frame = this.frame?.inputTexture;
    if (!frame) return;
    if (!frame.depthStencilTexture) {
      // The same failure `GlowDepth` guarded: a frame with no depth to share
      // is a mask with no occluders, every lamp blooming through its wall.
      // The scene draws into the FIRST pass in the chain and Babylon gives a
      // depth buffer to that one alone, so this is an assertion about the
      // order `Game` built the chain in.
      if (import.meta.env.DEV) {
        throw new Error(
          "GlowPass: the frame has no depth to share — the mask would occlude against nothing",
        );
      }
      return;
    }
    this.onBeforeWorkObservable.notifyObservers();

    const w = frame.width;
    const h = frame.height;
    const size = this.mask.getSize();
    if (this.stale || size.width !== w || size.height !== h) this.resize(w, h);

    const dest = this.mask.renderTarget;
    if (dest && (frame !== this.sharedFrom || dest !== this.sharedTo)) {
      frame.shareDepth(dest);
      this.sharedFrom = frame;
      this.sharedTo = dest;
    }
    this.mask.render();
    this.blur();

    // Put the frame back, because the draw phase's contract is that the frame
    // is what is bound when it ends — and `FrameDepth`, whose observer on this
    // same hook runs AFTER this one, reads the bound target to find the
    // frame's depth. Leave the last blur target bound and the ink and the
    // motion blur sample a target with no depth at all.
    this.scene.getEngine().bindFramebuffer(frame, undefined, undefined, undefined, true);
    this.onAfterWorkObservable.notifyObservers();
  }

  /**
   * Four separable passes: mask -> near (across, down) -> wide (across, down),
   * near being half resolution on `high` and quarter on `low` — where the mask
   * is box-filtered into `down` first and the first pass reads that instead.
   */
  private blur(): void {
    const engine = this.scene.getEngine();
    // Read every frame: the render-scale setting moves the backing store, and
    // the kernel's setter returns on an unchanged value.
    const kernel = this.kernelTexels();
    const outputs = [this.nearH, this.near, this.wideH, this.wide];
    this.renderer.saveStates();
    // Until the box filter's shader has compiled, the first pass reads the
    // mask direct — undersampled for a frame or two rather than blurring
    // nothing.
    this.firstSource = this.mask;
    const down = this.down.renderTarget;
    if (this.downsampleBy() > 2 && down && this.downsample.isReady()) {
      engine.bindFramebuffer(down, undefined, undefined, undefined, true);
      this.renderer.applyEffectWrapper(this.downsample);
      this.renderer.draw();
      engine.unBindFramebuffer(down);
      this.firstSource = this.down;
    }
    for (let i = 0; i < 4; i++) {
      const blur = this.blurs[i];
      blur.kernel = kernel;
      const target = outputs[i].renderTarget;
      if (!target || !blur.isReady()) continue;
      blur.textureWidth = target.width;
      blur.textureHeight = target.height;
      engine.bindFramebuffer(target, undefined, undefined, undefined, true);
      // `bind` sets the alpha mode (none) and the texel step; the observer
      // added at construction binds the source.
      this.renderer.applyEffectWrapper(blur);
      this.renderer.draw();
      engine.unBindFramebuffer(target);
    }
    this.renderer.restoreStates();
  }

  private resize(w: number, h: number): void {
    this.stale = false;
    this.mask.resize({ width: w, height: h });
    const by = this.downsampleBy();
    const nw = Math.max(1, Math.floor(w / by));
    const nh = Math.max(1, Math.floor(h / by));
    const ww = Math.max(1, Math.floor(nw / 2));
    const wh = Math.max(1, Math.floor(nh / 2));
    // The box filter's output IS the near size, four mask pixels to a texel.
    this.down.resize(by > 2 ? { width: nw, height: nh } : { width: 1, height: 1 });
    this.nearH.resize({ width: nw, height: nh });
    this.near.resize({ width: nw, height: nh });
    this.wideH.resize({ width: ww, height: wh });
    this.wide.resize({ width: ww, height: wh });
  }

  /** How far below the frame the near target sits, off the rung. */
  private downsampleBy(): number {
    return CONFIG.graphics.glowTiers[this.rung].downsample;
  }

  /**
   * The kernel in TEXELS of the near target, from
   * `CONFIG.graphics.glowKernel`, which is stated against the FRAME.
   *
   * A near texel is `downsample` backing-store pixels (2 on `high`, 4 on
   * `low`), and a backing-store pixel is `level` CSS pixels
   * (`Game.applyRenderScale`), so `glowKernel` CSS pixels is
   * `glowKernel / (downsample * level)` texels — the same reach on screen on
   * either rung. The wide target uses the same count and so blurs twice as
   * wide on screen, which is the pair the layer composed. At a scaling level
   * of 1 on `high` this is exactly the kernel the layer ran with.
   */
  private kernelTexels(): number {
    const level = this.scene.getEngine().getHardwareScalingLevel();
    return Math.max(1, CONFIG.graphics.glowKernel / (this.downsampleBy() * level));
  }

  private target(name: string, type: number): RenderTargetTexture {
    const rtt = new RenderTargetTexture(name, { width: 1, height: 1 }, this.scene, {
      generateMipMaps: false,
      generateDepthBuffer: false,
      generateStencilBuffer: false,
      type,
      samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    });
    rtt.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    rtt.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    return rtt;
  }

  dispose(): void {
    for (const blur of this.blurs) blur.dispose();
    this.downsample.dispose();
    this.renderer.dispose();
    for (const mat of this.materials.values()) mat.dispose();
    this.mask.dispose();
    this.down.dispose();
    this.nearH.dispose();
    this.near.dispose();
    this.wideH.dispose();
    this.wide.dispose();
  }
}
