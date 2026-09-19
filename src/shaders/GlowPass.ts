/**
 * GlowPass.ts — The game's bloom, as a pass it OWNS end to end: the emissive
 * mask, the blur, and the additive compose. Owns its targets, its override
 * materials and the depth it borrows; reads no game state (what may glow and
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
 * visible scene redrawn in opaque black (`FINDINGS.md` 3 — ~20% of the frame on
 * Coldharbour, Harrowmead and Sarab). What it cost is gone by construction:
 *
 * - **No schedule to move.** The mask is a target nothing else renders; it is
 *   rendered once, from the end of the draw phase, where the depth is final.
 * - **No clear to replace.** Colour only, installed once on a texture nothing
 *   else ever recreates — `resize` swaps its wrapper and keeps the observer.
 * - **No framebuffer to re-bind by internal.** The frame is `frame.inputTexture`,
 *   a public getter on the pass the scene draws into.
 * - **No frame lost on a resize** (`FINDINGS.md` 3, last section). The layer's
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
 * is WHERE: the compose is a post-process right after `CelInk` rather than a
 * blend onto the frame before it, so a bloom lies over the ink lines around its
 * lamp rather than under them.
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
  Observable,
  PostProcess,
  RenderTargetTexture,
  ShaderLanguage,
  ShaderMaterial,
  ShaderStore,
  ThinBlurPostProcess,
  Vector2,
  type AbstractMesh,
  type BaseTexture,
  type Camera,
  type Material,
  type Matrix,
  type Mesh,
  type Nullable,
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

ShaderStore.ShadersStoreWGSL["glowComposeFragmentShader"] = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
var glowNearSampler: sampler;
var glowNear: texture_2d<f32>;
var glowWideSampler: sampler;
var glowWide: texture_2d<f32>;

uniform intensity: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let scene = textureSample(textureSampler, textureSamplerSampler, input.vUV);
  let near = textureSample(glowNear, glowNearSampler, input.vUV).rgb;
  let wide = textureSample(glowWide, glowWideSampler, input.vUV).rgb;
  // Clamped BEFORE the add, as the layer's merge was: it wrote into an 8-bit
  // target and was blended on from there. The layer's blend also scaled by
  // the merge's alpha, which was always 1 — the mask clears to alpha 1 and
  // nothing drawn into it lowers that — so there is no alpha term here.
  let bloom = min((near + wide) * uniforms.intensity, vec3f(1.0));
  fragmentOutputs.color = vec4f(scene.rgb + bloom, scene.a);
}
`;

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
   * Fired around each of the pass's two pieces of work — the mask and its blur
   * at the end of the draw phase, and the compose in the post chain — so the
   * frame profiler can bracket them without this file knowing it exists.
   */
  readonly onBeforeWorkObservable = new Observable<void>();
  readonly onAfterWorkObservable = new Observable<void>();

  /** Half resolution: the horizontal pass's output, then the finished blur. */
  private readonly nearH: RenderTargetTexture;
  private readonly near: RenderTargetTexture;
  /** Quarter resolution, blurred from `near`. */
  private readonly wideH: RenderTargetTexture;
  private readonly wide: RenderTargetTexture;

  private readonly blurs: ThinBlurPostProcess[];
  private readonly renderer: EffectRenderer;

  /** The pass the scene draws into, and the compose appended after it. */
  private frame: PostProcess | null = null;
  private compose: PostProcess | null = null;

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
    this.nearH = this.target("glowNearH", half);
    this.near = this.target("glowNear", half);
    this.wideH = this.target("glowWideH", half);
    this.wide = this.target("glowWide", half);

    this.renderer = new EffectRenderer(engine);
    const kernel = this.kernelTexels();
    const across = new Vector2(1, 0);
    const down = new Vector2(0, 1);
    const sources = [this.mask, this.nearH, this.near, this.wideH];
    this.blurs = sources.map((source, i) => {
      const blur = new ThinBlurPostProcess(`glowBlur${i}`, engine, i % 2 === 0 ? across : down, kernel);
      blur.onApplyObservable.add(() => {
        blur.effect.setTexture("textureSampler", source);
      });
      return blur;
    });

    scene.onAfterDrawPhaseObservable.add(() => this.render());
  }

  /**
   * Appends the compose to the camera's chain and names the pass the scene
   * draws into, whose depth the mask borrows.
   *
   * **Call it immediately after that pass is built.** `attachPostProcess`
   * APPENDS, so this is what puts the compose right behind the ink and in
   * front of everything `Game` builds after it — FXAA antialiases the bloom's
   * edge with the rest of the picture, and the shafts and the grade land on
   * top of it. And `frame` must be the FIRST pass in the chain, because it is
   * the only one Babylon gives a depth buffer to.
   */
  attach(frame: PostProcess): void {
    this.frame = frame;
    const compose = new PostProcess("glowCompose", "glowCompose", {
      uniforms: ["intensity"],
      samplers: ["glowNear", "glowWide"],
      size: 1.0,
      camera: this.camera,
      engine: this.scene.getEngine(),
      shaderLanguage: ShaderLanguage.WGSL,
    });
    compose.onApplyObservable.add((effect) => {
      this.onBeforeWorkObservable.notifyObservers();
      effect.setFloat("intensity", CONFIG.graphics.glowIntensity);
      // Declared samplers must be BOUND or the draw is silently lost; both
      // targets exist from construction, so neither can be missing here.
      effect.setTexture("glowNear", this.near);
      effect.setTexture("glowWide", this.wide);
    });
    compose.onAfterRenderObservable.add(() => this.onAfterWorkObservable.notifyObservers());
    this.compose = compose;
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
    if (size.width !== w || size.height !== h) this.resize(w, h);

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

  /** Four separable passes: mask -> half (across, down) -> quarter (across, down). */
  private blur(): void {
    const engine = this.scene.getEngine();
    // Read every frame: the render-scale setting moves the backing store, and
    // the kernel's setter returns on an unchanged value.
    const kernel = this.kernelTexels();
    const outputs = [this.nearH, this.near, this.wideH, this.wide];
    this.renderer.saveStates();
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
    this.mask.resize({ width: w, height: h });
    const hw = Math.max(1, Math.floor(w / 2));
    const hh = Math.max(1, Math.floor(h / 2));
    const qw = Math.max(1, Math.floor(hw / 2));
    const qh = Math.max(1, Math.floor(hh / 2));
    this.nearH.resize({ width: hw, height: hh });
    this.near.resize({ width: hw, height: hh });
    this.wideH.resize({ width: qw, height: qh });
    this.wide.resize({ width: qw, height: qh });
  }

  /**
   * The kernel in TEXELS of the half-resolution target, from
   * `CONFIG.graphics.glowKernel`, which is stated against the FRAME.
   *
   * A half-resolution texel is two backing-store pixels, and a backing-store
   * pixel is `level` CSS pixels (`Game.applyRenderScale`), so `glowKernel` CSS
   * pixels is `glowKernel / (2 * level)` texels. The quarter target uses the
   * same count and so blurs twice as wide on screen, which is the pair the
   * layer composed. At a scaling level of 1 this is exactly the kernel the
   * layer ran with.
   */
  private kernelTexels(): number {
    const level = this.scene.getEngine().getHardwareScalingLevel();
    return Math.max(1, CONFIG.graphics.glowKernel / (2 * level));
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
    this.compose?.dispose();
    for (const blur of this.blurs) blur.dispose();
    this.renderer.dispose();
    for (const mat of this.materials.values()) mat.dispose();
    this.mask.dispose();
    this.nearH.dispose();
    this.near.dispose();
    this.wideH.dispose();
    this.wide.dispose();
  }
}
