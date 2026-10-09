/**
 * BlastShader.ts — The material every shape a detonation puts in the air is
 * drawn in: a lumpy BILLOW that is fire while it is hot, is eaten from its rim
 * inward by the smoke it turns into, and dissolves into wisps at the end.
 * Owns: both WGSL stages, the smoke's ink, and the `BlastMaterial` class and
 * its glow-mask twin. Reads its drawing from `CONFIG.graphics.blast` and the
 * fire's five inks from `FlameShader`; is fed the clock, the fog, the key
 * light, the ambient, the sky fill, the mist and the frame's opaque alpha by
 * `CelMaterialFactory`, which is the only thing that makes one (`getBlast`).
 * Invariants: it draws THIN INSTANCES of a unit icosphere and nothing else —
 * each instance's matrix is a translation, a rotation and a scale and never a
 * shear, which is what the normal transform below assumes — and each carries
 * two instance attributes, `billow` (heat, dissolve, seed, dust) and `warmth`.
 * It is OPAQUE and cut with `discard`, never blended: it writes depth, so the
 * screen-space ink finds the edges between billows and draws them, which is
 * the whole of what makes a cloud of these read as drawn. It never casts a
 * shadow and never takes a vertex colour buffer. Every derivative is taken
 * before the first branch, for the flame's reason (WGSL defines one only in
 * uniform control flow).
 *
 * WHY A BILLOW AND NOT A SPRITE. A blast was five flat emissive spheres, a
 * torus and two clouds of soft gradient quads — a photograph's smoke in a
 * frame of flat fills and ink, which is exactly the mismatch the water was
 * once reworked for. A drawn explosion is shapes with EDGES: overlapping
 * cauliflower billows, each banded light and dark by the key light, the fire
 * sitting inside them as hard bands of colour and shrinking as the smoke
 * closes over it, the whole thing breaking into wisps at the end rather than
 * fading. Every one of those is a thing this frame already does somewhere —
 * the cel bands, the ink, the flame's eaten edge — and none of them is a
 * gradient.
 *
 * WHY IT IS LIT WHERE THE FLAME IS NOT. `FlameShader` tried a soot plume and
 * every cut of it read as floating leather or black rock, and the reason is in
 * that sentence: it was opaque and UNLIT, so a smoke shape was one flat dark
 * silhouette. Here smoke is lit by the map's own key, ambient and sky fill,
 * banded in three like every wall, and mixed toward the map's mist — so its
 * top catches the moon, its underside is dark, and where the fire is still
 * burning under it the underside glows (`warmth`).
 *
 * THE HEAT OF A PIXEL, which is the one idea the fragment stage is built on:
 * the billow's heat, weighted up where the surface FACES the eye and down at
 * the silhouette, broken by a climbing noise field. A billow handed heat 1.5
 * is fire to its rim with a white heart; as the heat falls the red rim widens,
 * the smoke closes in from the outline, and an oxblood pen line runs where it
 * meets the fire — the flame's own eaten edge. At 0 it is smoke.
 *
 * **The drawing runs on twos** (`blast.fps`): the lumps and the bands change a
 * dozen times a second while the billow travels on the smooth clock, which is
 * the flame's bargain. The clock is the WORLD's, so a pause holds the cloud.
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
  type Matrix,
  type Mesh,
  type Scene,
  type SubMesh,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { FIRE_INKS } from "./FlameShader";
import type { SelfMasking } from "./GlowPass";
import "./wgsl/includes";

/**
 * Soot: the albedo of a blast's smoke, which the key light then paints. Warm
 * and dark, because a cloud off a charge is burnt, and warm rather than grey so
 * it sits with the fire under it instead of reading as a rain cloud.
 */
const SOOT = "#6a5f58";

/** What the glow reads as this material's colour — the fire's body. */
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

// The clock the DRAWING runs on, stepped at shape.x frames a second.
fn drawnClock() -> f32 {
  let fps = uniforms.shape.x;
  return select(uniforms.time, floor(uniforms.time * fps) / max(fps, 1.0), fps > 0.0);
}
`;

ShaderStore.ShadersStoreWGSL["blastVertexShader"] = `
attribute position: vec3f;
attribute billow: vec4f;   // x = heat, y = dissolve, z = seed, w = dust
attribute warmth: f32;

// Declares world and world0..3: this material only ever draws thin instances.
#include<celInstancesDeclaration>

uniform viewProjection: mat4x4f;
uniform time: f32;
uniform shape: vec4f;      // x = fps, y = lump, z = lumpScale, w = drift

varying vPosW: vec3f;
varying vNormalW: vec3f;
varying vRoundW: vec3f;
varying vLocal: vec3f;
varying vBillow: vec4f;
varying vWarmth: f32;

${SHARED}

// How far out of the unit sphere the surface stands along direction n. The
// drift is the DRAWN clock's, so a lump holds still between two drawings.
//
// BILLOW noise, |2n - 1|, and that is the whole difference between a cloud and
// a rock: it is round on every bump and CREASED in every valley between them,
// which is the cauliflower a drawn cloud is outlined as. Plain value noise is
// round both ways and gives a few broad facets — a boulder.
fn lumpAt(n: vec3f, off: vec3f) -> f32 {
  let q = n * uniforms.shape.z + off;
  let k = abs(2.0 * vnoise(q) - 1.0) * 0.64
    + abs(2.0 * vnoise(q * 2.13 + vec3f(11.0, 5.0, 3.0)) - 1.0) * 0.36;
  return 1.0 + (k - 0.42) * 2.0 * uniforms.shape.y;
}

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  #include<celInstancesVertex>

  let seed = vertexInputs.billow.z;
  let drift = drawnClock() * uniforms.shape.w * uniforms.shape.x;
  let off = vec3f(seed * 91.7, seed * 53.3 - drift * 0.6, seed * 27.1 + drift);

  // The displaced surface, and its normal by two neighbours on the sphere —
  // the lumps have to SHADE as lumps, or the bands run straight across them
  // as if the sphere were still round.
  let n = normalize(vertexInputs.position);
  var a = vec3f(0.0, 1.0, 0.0);
  if (abs(n.y) > 0.9) { a = vec3f(1.0, 0.0, 0.0); }
  let t1 = normalize(cross(n, a));
  let t2 = cross(n, t1);
  let e = 0.09;
  let n1 = normalize(n + t1 * e);
  let n2 = normalize(n + t2 * e);
  let p0 = n * lumpAt(n, off);
  let p1 = n1 * lumpAt(n1, off);
  let p2 = n2 * lumpAt(n2, off);
  var nl = normalize(cross(p1 - p0, p2 - p0));
  if (dot(nl, n) < 0.0) { nl = -nl; }

  let wp = finalWorld * vec4f(p0, 1.0);
  // A normal goes through R * S^-1: the matrix's own columns are R * S, so
  // dividing the local normal by each axis's squared length first leaves R *
  // S^-1 after the multiply. Exact for a scale and a rotation; a squashed
  // billow of dust shades as the flattened thing it is.
  let c0 = finalWorld[0].xyz;
  let c1 = finalWorld[1].xyz;
  let c2 = finalWorld[2].xyz;
  let s2 = vec3f(dot(c0, c0), dot(c1, c1), dot(c2, c2));
  let toW = mat3x3f(c0, c1, c2);
  let nw = toW * (nl / max(s2, vec3f(1e-8)));
  let rw = toW * (n / max(s2, vec3f(1e-8)));

  vertexOutputs.vPosW = wp.xyz;
  vertexOutputs.vNormalW = normalize(nw);
  vertexOutputs.vRoundW = normalize(rw);
  vertexOutputs.vLocal = p0;
  vertexOutputs.vBillow = vertexInputs.billow;
  vertexOutputs.vWarmth = vertexInputs.warmth;
  vertexOutputs.position = uniforms.viewProjection * wp;
}
`;

ShaderStore.ShadersStoreWGSL["blastFragmentShader"] = `
varying vPosW: vec3f;
varying vNormalW: vec3f;
varying vRoundW: vec3f;
varying vLocal: vec3f;
varying vBillow: vec4f;
varying vWarmth: f32;

// The cel materials' eye, not Babylon's \`cameraPosition\` — see \`BlastMaterial.setEye\`.
uniform camPos: vec3f;
uniform time: f32;
uniform shape: vec4f;
uniform field: vec4f;      // x = grain cells, y = climb, z = ragged, w = erode cells
uniform charColor: vec3f;
uniform deepColor: vec3f;
uniform midColor: vec3f;
uniform hotColor: vec3f;
uniform coreColor: vec3f;
uniform sootColor: vec3f;
uniform dustColor: vec3f;
uniform lightDir: vec3f;
uniform lightColor: vec3f;
uniform ambientColor: vec3f;
uniform skyLightColor: vec3f;
uniform mistColor: vec3f;
uniform air: f32;
uniform rim: f32;
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
  let b = fragmentInputs.vBillow;
  let heat = b.x;
  let seed = b.z;
  let p = fragmentInputs.vPosW;
  let n = normalize(fragmentInputs.vNormalW);
  let v = normalize(uniforms.camPos - p);
  let facing = clamp(dot(n, v), 0.0, 1.0);
  let clock = drawnClock();

  // Both fields, and both pen widths, BEFORE any branch — see the header.
  // The grain climbs through the billow (the fire eaten from below, as the
  // flame's is); the erosion field is coarser and nearly still, so a cloud
  // breaks where it breaks rather than boiling its holes about.
  let l = fragmentInputs.vLocal;
  let q = l * uniforms.field.x
    + vec3f(seed * 37.0, seed * 19.0 - clock * uniforms.field.y, seed * 23.0);
  let grain = vnoise(q) * 0.62 + vnoise(q * 2.2 + vec3f(17.0)) * 0.38;
  let qe = l * uniforms.field.w + vec3f(seed * 11.0, seed * 7.0 - clock * 0.25, seed * 5.0);
  let erode = vnoise(qe) * 0.56 + vnoise(qe * 2.4 + vec3f(5.0)) * 0.29
    + vnoise(qe * 5.3 + vec3f(9.0)) * 0.15;

  // The heat of THIS pixel: the billow's, up where it faces the eye and down
  // at its outline, and broken by the grain.
  let hot = heat * (0.42 + 0.78 * facing) + (grain - 0.5) * uniforms.field.z;
  let pen = fwidth(hot) * 1.6;

  // The dissolve eats from the outline inward — a facing pixel is further
  // from going — so a dying billow shrinks into its own wisps. And the
  // outline is ALWAYS bitten a little (rim): a clean round silhouette is
  // what a solid thing has, and vapour's edge is torn from the start.
  let away = 1.0 - facing;
  let keep = erode + facing * 0.3 - b.y * 1.45 - away * away * away * uniforms.rim;
  if (keep < 0.0) { discard; }

  var col: vec3f;
  var glow = 0.0;

  // Smoke and dust: the key light in TWO tones and a thin third, taken off a
  // normal part way between the round billow and its lumps — so the
  // terminator is one clean line that follows the lumps it crosses, rather
  // than every lump casting its own blotch. Shaded off the lumps alone, a
  // cloud is mottled like granite, and that is exactly what it read as.
  let ns = normalize(mix(normalize(fragmentInputs.vRoundW), n, uniforms.shape.y * 1.2));
  let wob = (grain - 0.5) * 0.12;
  let ndl = dot(ns, -uniforms.lightDir);
  let key = select(select(0.0, 0.55, ndl > -0.05 + wob), 1.0, ndl > 0.55 + wob);
  let sky = select(0.5, 1.0, ns.y > -0.35 + wob);
  let albedo = mix(uniforms.sootColor, uniforms.dustColor, b.w);
  col = albedo * (uniforms.ambientColor + uniforms.skyLightColor * sky + uniforms.lightColor * key);
  col = mix(col, uniforms.mistColor, uniforms.air);

  // The fire under it lights its underside: in two hard bands, as a lamp
  // lights a wall in this frame, and only while the billow is still WARM.
  let under = fragmentInputs.vWarmth * (0.55 - 0.45 * ns.y + 0.25 * facing) + wob;
  if (under > 0.72) {
    col = mix(col, uniforms.midColor, 0.72);
    glow = 0.22;
  } else if (under > 0.45) {
    col = mix(col, uniforms.deepColor, 0.42);
    glow = 0.08;
  }

  // Fire, over all of it, in the flame's five inks and with its pen line
  // where the smoke has eaten it.
  if (hot > 0.26) {
    if (hot < 0.26 + pen) {
      col = uniforms.charColor;
      glow = 0.05;
    } else if (hot < 0.5) {
      col = uniforms.deepColor;
      glow = 0.25;
    } else if (hot < 0.78) {
      col = uniforms.midColor;
      glow = 0.45;
    } else if (hot < 1.06) {
      col = uniforms.hotColor;
      glow = 0.65;
    } else {
      col = uniforms.coreColor;
      glow = 0.95;
    }
  }

#ifdef GLOW_MASK
  fragmentOutputs.color = vec4f(uniforms.glowColor.rgb * glow, uniforms.glowColor.a);
#else
  // The cel shader's fog: same curve, same radial distance.
  let dist = distance(p, uniforms.camPos);
  let f = clamp((dist - uniforms.fogParams.x) / max(0.001, uniforms.fogParams.y - uniforms.fogParams.x), 0.0, 1.0);
  col = mix(col, uniforms.fogColor, f * f);
  fragmentOutputs.color = vec4f(col, uniforms.opaqueAlpha);
#endif
}
`;

const COMMON_UNIFORMS = [
  "world",
  "viewProjection",
  "camPos",
  "time",
  "shape",
  "field",
  "charColor",
  "deepColor",
  "midColor",
  "hotColor",
  "coreColor",
  "sootColor",
  "dustColor",
  "lightDir",
  "lightColor",
  "ambientColor",
  "skyLightColor",
  "mistColor",
  "air",
  "rim",
];

const ATTRIBUTES = ["position", "billow", "warmth"];

/** What `GlowPass` hands a self-masking material to call on every mask draw. */
type GlowMaskPaint = Parameters<SelfMasking["glowMask"]>[0];

/** The light a billow of smoke is painted by — the cel materials' own. */
export interface BlastLight {
  lightDir: Vector3;
  lightColor: Color3;
  ambientColor: Color3;
  skyLightColor: Color3;
  mistColor: Color3;
}

/**
 * The billow's glow-mask twin: the same vertex stage, so it ties the depth the
 * billow wrote, and a fragment stage that writes the bloom per band — the
 * white heart hardest, the smoke not at all, which is what lets a cloud of
 * soot stand in FRONT of the fire in the bloom as well as in the frame.
 */
class BlastMaskMaterial extends ShaderMaterial {
  constructor(
    scene: Scene,
    private readonly paint: GlowMaskPaint,
  ) {
    super(
      "blastGlowMask",
      scene,
      { vertex: "blast", fragment: "blast" },
      {
        attributes: ATTRIBUTES,
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
 * The billow. One per `CelMaterialFactory`, shared by every blast in the game.
 */
export class BlastMaterial extends ShaderMaterial implements SelfMasking {
  /** What `GlowPass` and `WorldCulling` read to know this is a light source. */
  readonly emissiveColor = Color3.FromHexString(GLOW);

  private readonly masks: BlastMaskMaterial[] = [];
  private clock = 0;
  private light: BlastLight | null = null;
  private dust = Color3.FromHexString("#8a7d68");
  private readonly eye = Vector3.Zero();

  constructor(scene: Scene) {
    super(
      "blast",
      scene,
      { vertex: "blast", fragment: "blast" },
      {
        attributes: ATTRIBUTES,
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

  /** The mask this material's meshes are drawn into the glow with. */
  glowMask(paint: GlowMaskPaint): ShaderMaterial {
    const mask = new BlastMaskMaterial(this.getScene(), paint);
    this.configure(mask);
    mask.freeze();
    this.masks.push(mask);
    return mask;
  }

  /** The world clock, onto this and every mask twin — they must never differ. */
  setClock(seconds: number): void {
    this.clock = seconds;
    this.setFloat("time", seconds);
    for (const mask of this.masks) mask.setFloat("time", seconds);
  }

  /**
   * The eye, onto this and every twin — the cel materials' own, for the
   * fire's reason (`FlameMaterial.setEye`). No probe draws a blast today, its
   * meshes being a pool rather than the map's visuals; reading the active
   * camera would make that a rule nothing states, where this makes it moot.
   */
  setEye(pos: Vector3): void {
    this.eye.copyFrom(pos);
    this.setVector3("camPos", this.eye);
    for (const mask of this.masks) mask.setVector3("camPos", this.eye);
  }

  setFog(color: Color3, start: number, end: number): void {
    this.setColor3("fogColor", color);
    this.setVector2("fogParams", new Vector2(start, end));
  }

  setOpaqueAlpha(alpha: number): void {
    this.setFloat("opaqueAlpha", alpha);
  }

  /**
   * The map's light, onto this and every twin. The mask needs it too: it runs
   * the same fragment stage, and the underglow's bands read it.
   */
  setLight(light: BlastLight): void {
    this.light = light;
    this.writeLight(this);
    for (const mask of this.masks) this.writeLight(mask);
  }

  /**
   * What a blast's DUST is made of — the map's floor, which `BlastFx` works
   * out from the environment. Smoke is soot on every map; dust is the ground.
   */
  setDust(color: Color3): void {
    this.dust = color.clone();
    this.setColor3("dustColor", this.dust);
    for (const mask of this.masks) mask.setColor3("dustColor", this.dust);
  }

  private writeLight(mat: ShaderMaterial): void {
    const l = this.light;
    if (!l) return;
    mat.setVector3("lightDir", l.lightDir);
    mat.setColor3("lightColor", l.lightColor);
    mat.setColor3("ambientColor", l.ambientColor);
    mat.setColor3("skyLightColor", l.skyLightColor);
    mat.setColor3("mistColor", l.mistColor);
  }

  /** The drawing and the paint, identical on the billow and its mask. */
  private configure(mat: ShaderMaterial): void {
    const b = CONFIG.graphics.blast;
    mat.setFloat("time", this.clock);
    mat.setVector4("shape", new Vector4(b.fps, b.lump, b.lumpScale, b.drift));
    mat.setVector4("field", new Vector4(b.grain, b.climb, b.ragged, b.erode));
    mat.setFloat("air", b.air);
    mat.setFloat("rim", b.rim);
    mat.setColor3("charColor", Color3.FromHexString(FIRE_INKS.char));
    mat.setColor3("deepColor", Color3.FromHexString(FIRE_INKS.deep));
    mat.setColor3("midColor", Color3.FromHexString(FIRE_INKS.mid));
    mat.setColor3("hotColor", Color3.FromHexString(FIRE_INKS.hot));
    mat.setColor3("coreColor", Color3.FromHexString(FIRE_INKS.core));
    mat.setColor3("sootColor", Color3.FromHexString(SOOT));
    mat.setColor3("dustColor", this.dust);
    mat.setVector3("camPos", this.eye);
    mat.setVector3("lightDir", new Vector3(-0.5, -0.9, 0.4).normalize());
    mat.setColor3("lightColor", new Color3(0.8, 0.8, 0.8));
    mat.setColor3("ambientColor", new Color3(0.16, 0.18, 0.24));
    mat.setColor3("skyLightColor", new Color3(0.08, 0.11, 0.18));
    mat.setColor3("mistColor", new Color3(0.3, 0.3, 0.32));
    this.writeLight(mat);
  }
}
