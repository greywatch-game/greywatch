/**
 * CloudShader.ts — The sky's cloud masses, lit as FACETS: a banded key off the
 * light the map's shadows fall from, a darker belly, a hard silver lining on
 * the silhouette facets when the eye looks toward that light, and the dome's
 * own horizon haze over the low ones. Both stages hand-written WGSL, and
 * `shaderLanguage` on the material is load-bearing rather than declarative —
 * see `GrassShader.ts`.
 * Owns: how a cloud facet is coloured. Owns no shape (`systems/cloudMasses.ts`)
 * and no placement or drift (`systems/Sky.ts`).
 * Invariants: unlit by any scene light and unfogged by the cel fog — a cloud is
 * SKY, and the atmosphere it takes is the dome's gradient rather than the
 * village's fog wall; the geometry is REAL world positions (a cloud stays over
 * the field it is over as the player walks) but every fragment writes one
 * depth 7 km out — see the fragment's end — so every surface in the world
 * hides a cloud and a cloud hides only the sun's disc; writes coverage 0, as
 * every opaque surface does.
 * Contract: `docs/rendering.md` ("The sky").
 */
import {
  Color3,
  Constants,
  Scene,
  ShaderLanguage,
  ShaderMaterial,
  ShaderStore,
  Vector3,
  Vector4,
} from "@babylonjs/core";
// celBand and celDither self-register here; imported for the side effect so the
// includes are provably in the store before this effect compiles.
import "./wgsl/includes";

ShaderStore.ShadersStoreWGSL["cloudVertexShader"] = `
attribute position: vec3f;
attribute normal: vec3f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
uniform camPos: vec3f;

varying vNormalW: vec3f;
// From the EYE to this point, for the terms that ask where the viewer is
// looking — the lining, the halo and the haze.
varying vDir: vec3f;

// Where a cloud's VERTICES land in clip depth: just short of the far plane, so
// no cloud is ever clipped by it however far out the ring is laid. What the
// depth TEST sees is not this but the fragment's skyDepth — see the fragment.
const CLIP_DEPTH: f32 = 0.9999998;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let worldPos = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vNormalW = (uniforms.world * vec4f(vertexInputs.normal, 0.0)).xyz;
  vertexOutputs.vDir = worldPos.xyz - uniforms.camPos;
  // THE CLOUD IS WHERE IT IS AND DRAWN AS IF IT WERE FAR BEYOND THE WORLD. x
  // and y are the real projection, so a cloud a few hundred metres up over the
  // north field slides across the sky exactly as much as walking under it
  // should move it; z is pinned just inside the far plane so nothing clips it.
  var clip = uniforms.viewProjection * worldPos;
  clip.z = clip.w * CLIP_DEPTH;
  vertexOutputs.position = clip;
}
`;

// band() reads fwidth, which WGSL's uniformity analysis cannot prove uniform;
// the same define the cel and grass fragments carry for the same reason.
ShaderStore.ShadersStoreWGSL["cloudFragmentShader"] = `
#define DISABLE_UNIFORMITY_ANALYSIS

varying vNormalW: vec3f;
varying vDir: vec3f;

uniform sunDir: vec3f;      // unit, TOWARD the key light
uniform shadeColor: vec3f;  // a facet turned away from the light
uniform litColor: vec3f;    // a facet square to it
uniform hazeColor: vec3f;   // the dome's horizon band
uniform glowColor: vec3f;   // the dome's halo around the light
uniform look: vec4f;        // x lit share, y haze at the horizon, z lining, w wrap
uniform skyDepth: f32;      // the ONE depth every cloud fragment writes

#include<celBand>
#include<celDither>

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let n = normalize(fragmentInputs.vNormalW);
  let v = normalize(fragmentInputs.vDir);
  let l = uniforms.sunDir;

  // THE KEY, WRAPPED. A cloud is a scattering volume and not a wall, so light
  // reaches round onto facets a hard Lambert would leave black — but it is
  // still BANDED, three steps, because the facet is the look and a smooth ramp
  // across a faceted lump reads as a ball that has been badly tessellated.
  let ndl = dot(n, l);
  let key = band(clamp(uniforms.look.w + (1.0 - uniforms.look.w) * ndl, 0.0, 1.0), 3.0);
  var col = mix(uniforms.shadeColor, uniforms.litColor, key * uniforms.look.x);

  // The belly. Nothing lights the underside of a cloud but the ground, so the
  // facets that face down take a step darker whatever the key did — which is
  // what makes the flat base read as a base rather than as another side.
  col *= 1.0 - 0.22 * band(clamp(-n.y, 0.0, 1.0), 2.0);

  // THE SILVER LINING, which is the one term that belongs to where the EYE is.
  // Looking toward the light, a cloud's thin edges are lit through; the facets
  // that carry that are the SILHOUETTE ones (the view grazes them), and the
  // step keeps the lining a hard band of whole facets — the rim light's own
  // vocabulary, one layer up — rather than a glow.
  let toward = clamp(dot(v, l), 0.0, 1.0);
  // Only the facets the view genuinely GRAZES, and only well inside the
  // light's quarter of the sky: taken wider, every facet on a backlit pile's
  // outline lit at once and the cloud broke into bright shards over a dark one.
  let edge = step(0.72, 1.0 - abs(dot(n, v)));
  col += uniforms.litColor * uniforms.look.z * edge * band(pow(toward, 10.0), 2.0);

  // Inside the light's halo the whole mass is lifted toward the dome's glow,
  // so a cloud crossing the sun sits IN the bright air rather than cut out of it.
  col = mix(col, uniforms.glowColor, 0.35 * pow(toward, 40.0));

  // THE DOME'S HAZE. A low cloud is seen through as much air as the horizon
  // band is, so it takes that band's colour on the same schedule the dome
  // paints it: most of the way at the rim, nothing by 30 degrees up.
  let haze = (1.0 - smoothstep(0.06, 0.5, v.y)) * uniforms.look.y;
  col = mix(col, uniforms.hazeColor, haze);

  // ONE DEPTH FOR EVERY CLOUD, written here rather than interpolated. It is the
  // depth of a point 7 km out (Sky.update computes it from the camera), which
  // is behind every surface in the world and in front of the sun's disc — so a
  // roof hides a cloud, a cloud hides the disc, and the glow layer, which is
  // occluded by this same depth buffer, stops blooming the disc through one.
  // Constant and not interpolated for the painter's order's sake: with LEQUAL,
  // a nearer lump drawn later must tie exactly with the farther one under it,
  // and a per-vertex z/w in float32 near 1 wobbles by about one depth LSB.
  fragmentOutputs.fragDepth = uniforms.skyDepth;
  // Coverage 0, as everything opaque writes. At 7 km the ink's own fade has
  // taken every line off already, on every map's fog band.
  fragmentOutputs.color = vec4f(dither(col), 0.0);
}
`;

/** What `Sky` hands the material. Colours are display-ready, like every palette here. */
export interface CloudLook {
  sunDir: Vector3;
  shade: Color3;
  lit: Color3;
  haze: Color3;
  glow: Color3;
  litShare: number;
  hazeAtHorizon: number;
  lining: number;
  wrap: number;
}

/**
 * One material for the whole ring. Everything it reads but the eye is fixed for
 * the life of a sky, so it is set once and FROZEN — `GrassShader`'s argument:
 * the world matrix and `camPos` keep flowing through `_mustRebind`, which does
 * not read `isFrozen`.
 *
 * **Every fragment writes the SAME depth and back faces are CULLED, and the two
 * go together.** With one depth for the whole ring the buffer cannot settle
 * which facet is in front, so a closed lump is only right because its far side
 * is culled, and one lump in front of another is only right because `Sky` draws
 * the lumps back to front and the test is LEQUAL, so a later tie wins.
 */
export function createCloudMaterial(scene: Scene, look: CloudLook): ShaderMaterial {
  const mat = new ShaderMaterial(
    "sky-clouds-mat",
    scene,
    { vertex: "cloud", fragment: "cloud" },
    {
      attributes: ["position", "normal"],
      uniforms: [
        "world",
        "viewProjection",
        "camPos",
        "skyDepth",
        "sunDir",
        "shadeColor",
        "litColor",
        "hazeColor",
        "glowColor",
        "look",
      ],
      shaderLanguage: ShaderLanguage.WGSL,
    },
  );
  mat.setVector3("camPos", Vector3.Zero());
  mat.setFloat("skyDepth", 1);
  mat.setVector3("sunDir", look.sunDir.normalizeToNew());
  mat.setColor3("shadeColor", look.shade);
  mat.setColor3("litColor", look.lit);
  mat.setColor3("hazeColor", look.haze);
  mat.setColor3("glowColor", look.glow);
  mat.setVector4(
    "look",
    new Vector4(look.litShare, look.hazeAtHorizon, look.lining, look.wrap),
  );
  mat.depthFunction = Constants.LEQUAL;
  mat.backFaceCulling = true;
  mat.freeze();
  return mat;
}
