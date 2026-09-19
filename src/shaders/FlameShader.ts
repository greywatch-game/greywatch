/**
 * FlameShader.ts — The one material every open fire in the world wears: a
 * vertex-animated, hard-banded flame drawn as if by hand, and the twin of it
 * `GlowPass` draws the fire's bloom with.
 * Owns: both WGSL stages, the four colours a fire is painted in, and the
 * `FlameMaterial` class. Reads its motion from `CONFIG.graphics.flame`; is fed
 * the world clock, the fog and the frame's opaque alpha by `CelMaterialFactory`,
 * which is the only thing that makes one (`getFlame`).
 * Invariants: the geometry it draws is `world/flame.ts`'s, whose UV channel is
 * the whole of its per-vertex vocabulary (below) — nothing else may wear it.
 * The mask twin runs the SAME vertex function over the same uniforms, which is
 * what lets its LEQUAL test tie against the depth the flame wrote. It never
 * casts a shadow (the world's map re-renders only when its focus moves, so an
 * animated caster turns it into a per-frame redraw) and never takes a vertex
 * colour buffer (`vertexShading` skips it).
 *
 * WHY IT IS NOT `getEmissive`. A fire was a static glowing cone, and nothing
 * about an unlit `StandardMaterial` can move a vertex. The look it keeps is the
 * one the rest of the frame is in: no gradient anywhere, just flat bands with
 * hard edges, and an edge colour at every silhouette in place of the ink, which
 * a glowing surface cannot carry without swallowing its own glow.
 *
 * WHAT A FIRE IS, IN FOUR LAYERS OF ONE MESH (`uv.x`'s whole part):
 *
 * - **0, the OUTER tongues** — deep red at the rim, orange inside it. Their
 *   tips are eaten away by a noise field scrolling UP through them, so what is
 *   left of a tongue's top breaks off and rises as a lick of its own.
 * - **1, the CORE** — yellow over a pale heart, shorter, standing inside the
 *   outer tongues. It is SEEN because the outer tongues are wound INSIDE OUT
 *   (`world/flame.ts`): only their far wall is drawn, whose silhouette is the
 *   whole tongue's, so the core is always nearer than the orange behind it —
 *   which is how a drawn fire puts its yellow over its orange, with nothing
 *   biased in depth that could draw the core through a grate or a jamb.
 * - **2, the EMBERS** — tiny spheres riding a loop up out of the fire. Each is
 *   moved rigidly and shrunk about its own centre, which is recovered from its
 *   (radial) normal, because a merge has baked away every other way to find it.
 * - **3, the BOUNDS** — a degenerate triangle stood where the embers and the
 *   lean can reach, so the frustum cull of a merged mesh knows the fire is
 *   taller than its rest pose. It has no area and draws nothing.
 *
 * `uv.x`'s fraction is a per-tongue (or per-ember) SEED and `uv.y` is height up
 * the tongue, 0 at the root and 1 at the tip (an ember's is its phase).
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
  Vector4,
  type Material,
  type Matrix,
  type Mesh,
  type Scene,
  type SubMesh,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { SelfMasking } from "./GlowPass";

/** The four inks a fire is painted in, coolest first. Art, not tuning. */
const DEEP = "#b8301a";
const MID = "#ff7a1c";
const HOT = "#ffc23a";
const CORE = "#fff1b8";

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
uniform motion: vec4f;   // x = boil fps, y = writhe (m), z = lean (m), w = lick (m)
uniform embers: vec4f;   // x = rise (m), y = lives a second, z = drift (m), w = ember radius (m)

varying vPosW: vec3f;
varying vNormalW: vec3f;
varying vT: f32;
varying vLayer: f32;

${SHARED}

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  var p = (uniforms.world * vec4f(vertexInputs.position, 1.0)).xyz;
  let n = normalize(mat3x3f(uniforms.world[0].xyz, uniforms.world[1].xyz, uniforms.world[2].xyz)
    * vertexInputs.normal);
  let layer = floor(vertexInputs.uv.x + 0.001);
  let seed = fract(vertexInputs.uv.x + 0.001);
  var t = vertexInputs.uv.y;

  if (layer < 1.5) {
    // A tongue: planted at the root, travelling at the tip. The phase is off
    // WORLD position so no two fires in a street move together, and off the
    // tongue's seed so no two tongues in one fire do.
    let clock = drawnClock();
    let ph = dot(p.xz, vec2f(1.9, 2.7)) + seed * 6.2832;
    let k = t * t;
    // Phased up the height as well, so a tongue bends in an S rather than
    // tilting as a stick.
    let writhe = vec2f(
      sin(clock * 7.1 + ph + p.y * 6.0),
      cos(clock * 5.3 + ph * 1.3 + p.y * 5.0)) * uniforms.motion.y * k;
    let lean = uniforms.windDir * uniforms.motion.z * k;
    p.x += writhe.x + lean.x;
    p.z += writhe.y + lean.y;
    p.y += uniforms.motion.w * t * (0.5 + 0.5 * sin(clock * 9.0 + ph * 1.7));
  } else if (layer < 2.5) {
    // An ember: born at the bed, carried up and downwind, shrinking to nothing.
    let life = fract(uniforms.time * uniforms.embers.y * (0.7 + 0.6 * seed) + t);
    let r = uniforms.embers.w;
    let centre = p - n * r;
    let size = 1.0 - life;
    let swirl = seed * 40.0 + life * 5.0;
    let drift = vec2f(sin(swirl), cos(swirl * 1.3)) * uniforms.embers.z * life
      + uniforms.windDir * uniforms.embers.z * 2.0 * life * life;
    p = centre + n * r * size + vec3f(drift.x, life * uniforms.embers.x, drift.y);
    t = life;
  }
  // Layer 3 is the bounds marker, zero area, left where it stands.

  vertexOutputs.vPosW = p;
  vertexOutputs.vNormalW = n;
  vertexOutputs.vT = t;
  vertexOutputs.vLayer = layer;
  vertexOutputs.position = uniforms.viewProjection * vec4f(p, 1.0);
}
`;

ShaderStore.ShadersStoreWGSL["flameFragmentShader"] = `
varying vPosW: vec3f;
varying vNormalW: vec3f;
varying vT: f32;
varying vLayer: f32;

uniform cameraPosition: vec3f;
uniform time: f32;
uniform motion: vec4f;
uniform boil: vec2f;      // x = how ragged, y = how fast the field climbs (per s)
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
  var col: vec3f;
  // How bright this pixel is in the mask, band by band.
  var glow = 1.0;

  if (layer < 1.5) {
    let clock = drawnClock();
    let p = fragmentInputs.vPosW;
    let q = vec3f(p.x * 3.4, p.y * 2.3 - clock * uniforms.boil.y, p.z * 3.4);
    let noise = vnoise(q) * 0.65 + vnoise(q * 2.2 + vec3f(17.0)) * 0.35;
    let heat = (1.0 - fragmentInputs.vT) + (noise - 0.5) * uniforms.boil.x;
    // The painted edge: where the surface turns away from the eye it takes the
    // next band down, the way a drawn flame is outlined in its own darker ink.
    let v = normalize(uniforms.cameraPosition - p);
    let edge = 1.0 - abs(dot(v, normalize(fragmentInputs.vNormalW)));
    if (layer < 0.5) {
      if (heat < 0.12) { discard; }
      if (heat < 0.36 || edge > 0.62) {
        col = uniforms.deepColor;
        glow = 0.2;
      } else {
        col = uniforms.midColor;
        glow = 0.35;
      }
    } else {
      if (heat < 0.34) { discard; }
      if (heat < 0.66 || edge > 0.7) {
        col = uniforms.hotColor;
        glow = 0.55;
      } else {
        col = uniforms.coreColor;
        glow = 0.8;
      }
    }
  } else {
    // An ember cools as it climbs.
    let life = fragmentInputs.vT;
    if (life < 0.3) {
      col = uniforms.hotColor;
    } else if (life < 0.65) {
      col = uniforms.midColor;
      glow = 0.8;
    } else {
      col = uniforms.deepColor;
      glow = 0.5;
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
  "embers",
  "boil",
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
    mat.setVector4(
      "embers",
      new Vector4(f.embers.rise, f.embers.rate, f.embers.drift, f.embers.radius),
    );
    mat.setVector2("boil", new Vector2(f.ragged, f.climb));
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
