/**
 * FlameShader.ts — The one material every open fire in the world wears: a
 * vertex-animated, hard-banded flame drawn as if by hand, and the twin of it
 * `GlowPass` draws the fire's bloom with.
 * Owns: both WGSL stages, the inks a fire is painted in, and the
 * `FlameMaterial` class. Reads its motion from `CONFIG.graphics.flame`; is
 * fed the world clock, the fog and the frame's opaque alpha by
 * `CelMaterialFactory`, which is the only thing that makes one (`getFlame`).
 * Invariants: the geometry it draws is `world/flame.ts`'s, whose UV channel is
 * the whole of its per-vertex vocabulary (below) — nothing else may wear it.
 * The mask twin runs the SAME vertex function over the same uniforms, which is
 * what lets its LEQUAL test tie against the depth the flame wrote. It never
 * casts a shadow (the world's map re-renders only when its focus moves, so an
 * animated caster turns it into a per-frame redraw) and never takes a vertex
 * colour buffer (`vertexShading` skips it). Every DERIVATIVE the fragment
 * stage takes is taken before its first branch on the layer — WGSL defines
 * one only in uniform control flow, and the layer is a varying.
 *
 * WHY IT IS NOT `getEmissive`. A fire was a static glowing cone, and nothing
 * about an unlit `StandardMaterial` can move a vertex. The look it keeps is the
 * one the rest of the frame is in: no gradient anywhere, just flat bands with
 * hard edges, and a pen line in the fire's own darkest ink where the flame is
 * eaten, in place of the ink pass, which a glowing surface cannot carry
 * without swallowing its own glow.
 *
 * WHAT A FIRE IS, IN FOUR LAYERS OF ONE MESH (`uv.x`'s whole part):
 *
 * - **0, the OUTER tongues** — crimson skin over an orange body, outlined in
 *   oxblood wherever the flame is eaten. Their tips are eaten away by a noise
 *   field scrolling UP through them, so what is left of a tongue's top breaks
 *   off and rises as a lick of its own, and their silhouettes are bitten
 *   harder toward the tip so each one ends on a brush POINT, hooked over.
 * - **1, the CORE** — gold over a white-hot heart, shorter, standing inside the
 *   outer tongues. It is SEEN because the outer tongues are wound INSIDE OUT
 *   (`world/flame.ts`): only their far wall is drawn, whose silhouette is the
 *   whole tongue's, so the core is always nearer than the orange behind it —
 *   which is how a drawn fire puts its yellow over its orange, with nothing
 *   biased in depth that could draw the core through a grate or a jamb.
 * - **2, the EMBERS** — tiny spheres riding a loop up out of the fire, drawn
 *   out into STROKES along their climb. Each is moved rigidly and shrunk about
 *   its own centre, which is recovered from its (radial) normal, because a
 *   merge has baked away every other way to find it.
 * - **3, the BOUNDS** — a degenerate triangle stood where the embers, the lean
 *   and the hook can reach, so the frustum cull of a merged mesh knows the
 *   fire is taller than its rest pose. It has no area and draws nothing.
 *
 * There is NO SMOKE, and that was tried: a soot plume in this material is
 * opaque and unlit, and every way it was cut read as floating leather or
 * black rock rather than as smoke — volume needs either light it does not
 * have or a screen-space hatch, which is a lattice the eye can see.
 *
 * `uv.x`'s fraction is a per-tongue (or per-ember) SEED. `uv.y` is `t + 4 *
 * cm`: `t` is height up the tongue, 0 at the root and 1 at the tip (an ember's
 * is its phase), and `cm` is the height of the whole FIRE in centimetres —
 * which is what lets every distance in the motion, and the noise's own scale,
 * be a share of the fire's size, so a candle moves and burns like a bonfire.
 *
 * **The boil is drawn on twos.** The shape and its bands advance at
 * `flame.fps`, not at the display's rate — the fire changes drawing a dozen
 * times a second, which is what makes it read as an animated drawing rather
 * than a simulation. The embers are the exception and move on the smooth clock:
 * a point stepping up the screen is a stutter, not a style.
 *
 * The clock is the WORLD's (`CelMaterialFactory.updateWind`'s), so a pause that
 * holds the canopy holds the fire.
 */
import {
  Color3,
  Constants,
  ShaderLanguage,
  ShaderMaterial,
  ShaderStore,
  Vector2,
  Vector3,
  Vector4,
  type Material,
  type Matrix,
  type Mesh,
  type Scene,
  type SubMesh,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { SelfMasking } from "./GlowPass";

/** The inks a fire is painted in, coolest first. Art, not tuning. */
const CHAR = "#4a0c07";
const DEEP = "#a8190c";
const MID = "#f5541a";
const HOT = "#ffb12e";
const CORE = "#fff5d8";

/**
 * What the glow reads as this material's colour — the orange of the body of
 * the fire, which is the old cone's `#ff8a2a` and so the bloom it always had.
 */
const GLOW = "#ff8a2a";

const SHARED = `
fn hashU(x: u32) -> u32 {
  let v = x * 747796405u + 2891336453u;
  let w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return (w >> 22u) ^ w;
}

fn hash3(i: vec3f) -> f32 {
  let q = bitcast<vec3<u32>>(vec3<i32>(i));
  return f32(hashU(q.x ^ hashU(q.y ^ hashU(q.z)))) / 4294967295.0;
}

fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(hash3(i), hash3(i + vec3f(1.0, 0.0, 0.0)), u.x);
  let b = mix(hash3(i + vec3f(0.0, 1.0, 0.0)), hash3(i + vec3f(1.0, 1.0, 0.0)), u.x);
  let c = mix(hash3(i + vec3f(0.0, 0.0, 1.0)), hash3(i + vec3f(1.0, 0.0, 1.0)), u.x);
  let d = mix(hash3(i + vec3f(0.0, 1.0, 1.0)), hash3(i + vec3f(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}

// The clock the SHAPE runs on: stepped at motion.x frames a second, or smooth
// at 0. The embers read uniforms.time directly.
fn drawnClock() -> f32 {
  let fps = uniforms.motion.x;
  return select(uniforms.time, floor(uniforms.time * fps) / max(fps, 1.0), fps > 0.0);
}
`;

ShaderStore.ShadersStoreWGSL["flameVertexShader"] = `
attribute position: vec3f;
attribute normal: vec3f;
attribute uv: vec2f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
uniform cameraPosition: vec3f;
uniform time: f32;
uniform windDir: vec2f;
uniform motion: vec4f;   // x = boil fps; y = writhe, z = lean, w = lick (shares of the fire's height)
uniform curl: vec2f;     // x = hook (a share); y = how far a spark is drawn out
uniform embers: vec4f;   // x = rise, y = lives a second, z = drift (shares), w = ember radius (m)

varying vPosW: vec3f;
varying vNormalW: vec3f;
varying vT: f32;
varying vLayer: f32;
varying vField: vec3f;

${SHARED}

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  var p = (uniforms.world * vec4f(vertexInputs.position, 1.0)).xyz;
  let n = normalize(mat3x3f(uniforms.world[0].xyz, uniforms.world[1].xyz, uniforms.world[2].xyz)
    * vertexInputs.normal);
  let layer = floor(vertexInputs.uv.x + 0.001);
  let seed = fract(vertexInputs.uv.x + 0.001);
  // uv.y is t + 4 * (the fire's height in cm): split it, and scale the height
  // by the mesh's own vertical stretch, which a molotov's flames grow by.
  let cm = floor(vertexInputs.uv.y * 0.25);
  var t = clamp(vertexInputs.uv.y - cm * 4.0, 0.0, 1.0);
  let authored = max(cm * 0.01, 0.01);
  let size = authored * length(uniforms.world[1].xyz);
  // The fire's REST frame, which every phase and the noise field are taken in:
  // the vertex BEFORE the mesh's own transform, in heights of the fire, offset
  // by where the mesh stands. Never the world position over its size — a
  // molotov's flames shrink every frame as they die, and a field scaled about
  // the WORLD origin slid metres a frame, so a dying fire boiled at a race.
  let rest = vertexInputs.position / authored + uniforms.world[3].xyz;

  if (layer < 1.5) {
    // A tongue: planted at the root, travelling at the tip. The phase is off
    // the rest frame — where the fire stands — so no two fires in a street
    // move together, and off the tongue's seed so no two tongues in one fire do.
    let clock = drawnClock();
    let ph = dot(rest.xz, vec2f(1.9, 2.7)) + seed * 6.2832;
    let k = t * t;
    // Phased up the height as well, so a tongue bends in an S rather than
    // tilting as a stick.
    let hh = rest.y;
    let writhe = vec2f(
      sin(clock * 7.1 + ph + hh * 5.5),
      cos(clock * 5.3 + ph * 1.3 + hh * 4.7)) * uniforms.motion.y * size * k;
    let lean = uniforms.windDir * uniforms.motion.z * size * k;
    // The hook: the last of a tongue curls over, its bearing turning slowly.
    let hb = seed * 6.2832 + clock * 2.3;
    let hook = vec2f(cos(hb), sin(hb)) * uniforms.curl.x * size * k * k;
    p.x += writhe.x + lean.x + hook.x;
    p.z += writhe.y + lean.y + hook.y;
    p.y += uniforms.motion.w * size * t * (0.5 + 0.5 * sin(clock * 9.0 + ph * 1.7));
  } else if (layer < 2.5) {
    // An ember: born at the bed, carried up and downwind, shrinking to nothing
    // — and drawn out along its climb into a STROKE rather than a dot.
    let life = fract(uniforms.time * uniforms.embers.y * (0.7 + 0.6 * seed) + t);
    let r = uniforms.embers.w;
    let centre = p - n * r;
    let sz = 1.0 - life;
    let swirl = seed * 40.0 + life * 5.0;
    let d = uniforms.embers.z * size;
    let drift = vec2f(sin(swirl), cos(swirl * 1.3)) * d * life
      + uniforms.windDir * d * 2.0 * life * life;
    p = centre + vec3f(n.x, n.y * uniforms.curl.y, n.z) * r * sz
      + vec3f(drift.x, life * uniforms.embers.x * size, drift.y);
    t = life;
  }
  // Layer 3 is the bounds marker, zero area, left where it stands.

  vertexOutputs.vPosW = p;
  vertexOutputs.vNormalW = n;
  vertexOutputs.vT = t;
  vertexOutputs.vLayer = layer;
  vertexOutputs.vField = rest;
  vertexOutputs.position = uniforms.viewProjection * vec4f(p, 1.0);
}
`;

ShaderStore.ShadersStoreWGSL["flameFragmentShader"] = `
varying vPosW: vec3f;
varying vNormalW: vec3f;
varying vT: f32;
varying vLayer: f32;
varying vField: vec3f;

uniform cameraPosition: vec3f;
uniform time: f32;
uniform motion: vec4f;
uniform boil: vec3f;      // x = how ragged, y = how fast the field climbs (per s), z = bite
uniform charColor: vec3f;
uniform deepColor: vec3f;
uniform midColor: vec3f;
uniform hotColor: vec3f;
uniform coreColor: vec3f;
#ifdef GLOW_MASK
uniform glowColor: vec4f;
#else
uniform fogColor: vec3f;
uniform fogParams: vec2f;
uniform opaqueAlpha: f32;
#endif

${SHARED}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let layer = floor(fragmentInputs.vLayer + 0.5);
  let t = fragmentInputs.vT;
  let p = fragmentInputs.vPosW;
  let clock = drawnClock();

  // Everything a band is cut from is computed HERE, before any branch: the
  // pen line is measured with fwidth, and a derivative is only defined in
  // uniform control flow. The field is sampled in the fire's rest frame (so a
  // candle is eaten like a bonfire, and a flame growing or dying stretches its
  // drawing rather than scrolling it), stretched up, and climbing.
  let f0 = fragmentInputs.vField;
  let q = vec3f(f0.x * 4.2, f0.y * 1.9 - clock * uniforms.boil.y, f0.z * 4.2);
  let noise = vnoise(q) * 0.62 + vnoise(q * vec3f(2.3, 2.0, 2.3) + vec3f(17.0)) * 0.38;
  // Where the surface turns away from the eye.
  let v = normalize(uniforms.cameraPosition - p);
  let edge = 1.0 - abs(dot(v, normalize(fragmentInputs.vNormalW)));
  // A tongue's heat: hottest at the root, eaten by the field, and bitten at
  // the silhouette harder toward the tip, so it narrows to a brush point.
  let heat = (1.0 - t) + (noise - 0.5) * uniforms.boil.x
    - edge * edge * (0.25 + 0.55 * t) * uniforms.boil.z;
  // One pen width of heat, in screen pixels.
  let pen = fwidth(heat) * 1.6;

  var col: vec3f;
  // How bright this pixel is in the mask, band by band.
  var glow = 1.0;

  if (layer < 0.5) {
    // The OUTER tongue: an oxblood line where it is eaten, crimson skin,
    // orange body.
    if (heat < 0.1) { discard; }
    if (heat < 0.1 + pen) {
      col = uniforms.charColor;
      glow = 0.05;
    } else if (heat < 0.36 || edge > 0.8) {
      col = uniforms.deepColor;
      glow = 0.2;
    } else {
      col = uniforms.midColor;
      glow = 0.4;
    }
  } else if (layer < 1.5) {
    // The CORE: gold round a white-hot heart.
    if (heat < 0.34) { discard; }
    if (heat < 0.62 || edge > 0.75) {
      col = uniforms.hotColor;
      glow = 0.6;
    } else {
      col = uniforms.coreColor;
      glow = 0.9;
    }
  } else {
    // An ember cools as it climbs.
    if (t < 0.3) {
      col = uniforms.coreColor;
      glow = 0.9;
    } else if (t < 0.6) {
      col = uniforms.hotColor;
      glow = 0.7;
    } else {
      col = uniforms.midColor;
      glow = 0.45;
    }
  }

#ifdef GLOW_MASK
  // The bloom's colour is GlowRules' (faded toward black with distance, not
  // toward the fog), scaled by the band — so the heart of the fire blooms
  // hardest and a red lick barely at all.
  fragmentOutputs.color = vec4f(uniforms.glowColor.rgb * glow, uniforms.glowColor.a);
#else
  // The same fog, curve and radial distance as the cel shader and EmissiveFog.
  let dist = distance(fragmentInputs.vPosW, uniforms.cameraPosition);
  let f = clamp((dist - uniforms.fogParams.x) / max(0.001, uniforms.fogParams.y - uniforms.fogParams.x), 0.0, 1.0);
  col = mix(col, uniforms.fogColor, f * f);
  // Opaque, so it writes what every opaque surface writes into the frame's
  // translucent-coverage channel — 0 for the frame, 1 inside a probe's bake.
  fragmentOutputs.color = vec4f(col, uniforms.opaqueAlpha);
#endif
}
`;

const COMMON_UNIFORMS = [
  "world",
  "viewProjection",
  "cameraPosition",
  "time",
  "windDir",
  "motion",
  "curl",
  "embers",
  "boil",
  "charColor",
  "deepColor",
  "midColor",
  "hotColor",
  "coreColor",
];

/** What `GlowPass` hands a self-masking material to call on every mask draw. */
type GlowMaskPaint = Parameters<SelfMasking["glowMask"]>[0];

/**
 * The flame's glow-mask twin: the same vertex stage, so it ties the depth the
 * flame wrote, and a fragment stage that writes the bloom colour per band.
 * Configured exactly as `GlowPass`'s own mask variants are.
 */
class FlameMaskMaterial extends ShaderMaterial {
  constructor(
    scene: Scene,
    private readonly paint: GlowMaskPaint,
  ) {
    super(
      "flameGlowMask",
      scene,
      { vertex: "flame", fragment: "flame" },
      {
        attributes: ["position", "normal", "uv"],
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

/**
 * The fire. One per `CelMaterialFactory`, shared by every flame in the world,
 * which is what lets a block's fires merge into one draw.
 */
export class FlameMaterial extends ShaderMaterial implements SelfMasking {
  /**
   * What `GlowPass` and `WorldCulling` read to know this is a light source —
   * the same property an emissive `StandardMaterial` carries, and the only
   * thing either asks.
   */
  readonly emissiveColor = Color3.FromHexString(GLOW);

  private readonly masks: FlameMaskMaterial[] = [];

  constructor(scene: Scene) {
    super(
      "flame",
      scene,
      { vertex: "flame", fragment: "flame" },
      {
        attributes: ["position", "normal", "uv"],
        uniforms: [...COMMON_UNIFORMS, "fogColor", "fogParams", "opaqueAlpha"],
        shaderLanguage: ShaderLanguage.WGSL,
      },
    );
    this.backFaceCulling = true;
    this.configure(this);
    this.setFloat("opaqueAlpha", 0);
    this.setColor3("fogColor", Color3.Black());
    this.setVector2("fogParams", new Vector2(24, 78));
    this.freeze();
  }

  /**
   * The mask this material's meshes are drawn into the glow with — asked by
   * `GlowPass`, once. See `SelfMasking` there.
   */
  glowMask(paint: GlowMaskPaint): ShaderMaterial {
    const mask = new FlameMaskMaterial(this.getScene(), paint);
    this.configure(mask);
    mask.setFloat("time", this.clock);
    mask.freeze();
    this.masks.push(mask);
    return mask;
  }

  private clock = 0;

  /** The world clock, onto this and every mask twin — they must never differ. */
  setClock(seconds: number): void {
    this.clock = seconds;
    this.setFloat("time", seconds);
    for (const mask of this.masks) mask.setFloat("time", seconds);
  }

  setFog(color: Color3, start: number, end: number): void {
    this.setColor3("fogColor", color);
    this.setVector2("fogParams", new Vector2(start, end));
  }

  setOpaqueAlpha(alpha: number): void {
    this.setFloat("opaqueAlpha", alpha);
  }

  /** The motion and the paint, identical on the flame and its mask. */
  private configure(mat: ShaderMaterial): void {
    const f = CONFIG.graphics.flame;
    const w = CONFIG.wind.dir;
    mat.setFloat("time", 0);
    mat.setVector2("windDir", new Vector2(w[0], w[1]).normalize());
    mat.setVector4("motion", new Vector4(f.fps, f.writhe, f.lean, f.lick));
    mat.setVector2("curl", new Vector2(f.hook, f.embers.stretch));
    mat.setVector4(
      "embers",
      new Vector4(f.embers.rise, f.embers.rate, f.embers.drift, f.embers.radius),
    );
    mat.setVector3("boil", new Vector3(f.ragged, f.climb, f.bite));
    mat.setColor3("charColor", Color3.FromHexString(CHAR));
    mat.setColor3("deepColor", Color3.FromHexString(DEEP));
    mat.setColor3("midColor", Color3.FromHexString(MID));
    mat.setColor3("hotColor", Color3.FromHexString(HOT));
    mat.setColor3("coreColor", Color3.FromHexString(CORE));
    // `cameraPosition` is not set here: `ShaderMaterial.bind` writes it from
    // the ACTIVE camera on every bind, which is also what makes a reflection
    // probe's bake fog the fire against the probe rather than the player.
  }
}

/** Whether a material is the fire — `vertexShading` asks, to leave it unbaked. */
export function isFlame(material: Material | null): material is FlameMaterial {
  return material instanceof FlameMaterial;
}
