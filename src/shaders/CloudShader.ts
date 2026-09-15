/**
 * CloudShader.ts — The sky's cloud masses, lit in cel TONES: a key cut twice
 * off the light the map's shadows fall from, asked mostly of each lump's SMOOTH
 * normal so a terminator is one line broken along the facets rather than a
 * tone per triangle; a shadow side pulled toward the dome's gradient behind
 * it; a darker belly; a silver lining on the rim when the eye looks toward
 * that light; and the dome's own haze over the low ones. Both stages
 * hand-written WGSL, and
 * `shaderLanguage` on the material is load-bearing rather than declarative —
 * see `GrassShader.ts`.
 * Owns: how a cloud facet is coloured. Owns no shape (`systems/cloudMasses.ts`)
 * and no placement or drift (`systems/Sky.ts`).
 * Invariants: unlit by any scene light and unfogged by the cel fog — a cloud is
 * SKY, and the atmosphere it takes is the dome's gradient rather than the
 * village's fog wall; the geometry is REAL world positions (a cloud stays over
 * the field it is over as the player walks) but every fragment writes the depth
 * of a point 7 km out along its own pixel's ray — see the fragment's end — so
 * every surface in the world
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
  Vector2,
  Vector3,
  Vector4,
} from "@babylonjs/core";
// celBand and celDither self-register here; imported for the side effect so the
// includes are provably in the store before this effect compiles.
import "./wgsl/includes";

ShaderStore.ShadersStoreWGSL["cloudVertexShader"] = `
attribute position: vec3f;
attribute normal: vec3f;
attribute smoothNormal: vec3f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
uniform camPos: vec3f;

varying vNormalW: vec3f;
varying vSmoothW: vec3f;
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
  vertexOutputs.vSmoothW = (uniforms.world * vec4f(vertexInputs.smoothNormal, 0.0)).xyz;
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
varying vSmoothW: vec3f;
varying vDir: vec3f;

uniform sunDir: vec3f;      // unit, TOWARD the key light
uniform shadeColor: vec3f;  // a facet turned away from the light
uniform litColor: vec3f;    // a facet square to it
uniform hazeColor: vec3f;   // the dome's horizon band
uniform zenithColor: vec3f; // the dome's top
uniform glowColor: vec3f;   // the dome's halo around the light
uniform look: vec4f;        // x lit share, y haze at the horizon, z lining, w wrap
// x how much of the facet's own normal the light sees (the rest is the lump's
// smooth one), y how much of the sky behind the shadow side takes, z the
// belly's step, w how strongly the sky's air reaches the lit side too.
uniform form: vec4f;
// x how far toward the lit tone the first cut goes, y where the second cut
// (the highlight) sits, as a cosine to the light.
uniform tones: vec2f;
// Where a cloud's depth is written from: x, y the tangents of the half field of
// view, z, w two over the target's width and height (pixel -> NDC).
uniform depthRay: vec4f;
// The depth of a point depthMetres out ALONG ITS OWN RAY is x - y * |ray|,
// with the ray's view-space z at 1 — see the fragment's end.
uniform depthLine: vec2f;

#include<celBand>
#include<celDither>

// The dome's canvas gradient, stop for stop (\`Sky.paintDome\`): row 0 the
// zenith, 0.28 halfway to the horizon colour, 0.43 the horizon colour — and a
// row is (90 - elevation) / 180. Nothing a cloud stands in is under the band,
// so the stops past it are never reached and are not repeated.
fn domeAt(up: f32) -> vec3f {
  let row = 0.5 - asin(clamp(up, -1.0, 1.0)) / 3.14159265;
  let mid = mix(uniforms.zenithColor, uniforms.hazeColor, 0.5);
  if (row < 0.28) {
    return mix(uniforms.zenithColor, mid, row / 0.28);
  }
  return mix(mid, uniforms.hazeColor, clamp((row - 0.28) / 0.15, 0.0, 1.0));
}

// A hard cel step at zero, footed on the pixel so the edge is one pixel of
// antialiasing wide at every distance — \`band\`'s own edge, for a threshold
// that is not a multiple of a band width.
fn cut(x: f32) -> f32 {
  let w = max(fwidth(x), 1e-4);
  return smoothstep(-w, w, x);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let nFacet = normalize(fragmentInputs.vNormalW);
  let nSmooth = normalize(fragmentInputs.vSmoothW);
  let v = normalize(fragmentInputs.vDir);
  let l = uniforms.sunDir;
  let toward = clamp(dot(v, l), 0.0, 1.0);

  // THE SKY BEHIND THIS PIXEL: the dome's gradient, rebuilt from the same
  // stops the dome was painted with. A cloud is made of the air it stands in,
  // and the shade and the haze below reach for this rather than for a fixed
  // colour — that is the difference between a cloud and a pale rock hung in
  // front of the sky.
  //
  // **The gradient and NOT the halo baked over it**, and the halo was tried: a
  // cloud crossing the light took the halo's own colour and vanished into it,
  // where a backlit cloud is the one that should stand DARK against the glare.
  // The glow term below is what puts it back in the bright air, and only there.
  let dome = domeAt(v.y);

  // THE NORMAL THE LIGHT SEES is mostly the LUMP's, and only partly the
  // facet's. Lit per facet alone, every triangle took a tone of its own and a
  // cloud was a crystal of forty greys — the "too 3D, too solid" of it. Off the
  // smooth normal the terminator is one clean line across a lump, and the
  // facet share left in it is what makes that line break along the facets,
  // which is the frame's own hand-cut edge rather than an airbrushed one.
  let n = normalize(mix(nSmooth, nFacet, uniforms.form.x));

  // THE KEY, WRAPPED and cut ONCE. Two tones, as every wall in the village has:
  // a cloud is a scattering volume, so the light reaches past the equator
  // (wrap), but a ramp across it would be the continuous-tone smear the decks
  // were retired for.
  //
  // …and a SECOND cut above it for the facets square to the light. With one
  // cut, a flat bank's whole top was one cream shape with nothing in it; the
  // highlight is where the facet share in the normal shows, as the broken
  // bright ridge along the top of a lit cloud.
  let ndl = dot(n, l);
  let key = cut(uniforms.look.w + ndl) * uniforms.tones.x
    + cut(ndl - uniforms.tones.y) * (1.0 - uniforms.tones.x);

  // The two tones. The SHADOW side is mostly sky — a cloud's shade is lit by
  // the dome all round it — so it is the map's cloud colour pulled toward the
  // air behind it, which keeps it a darker shape IN the sky rather than a hole
  // cut out of it. The lit side is that tone carried toward the light's colour.
  let shade = mix(uniforms.shadeColor, dome, uniforms.form.y);
  let lit = mix(shade, uniforms.litColor, uniforms.look.x);
  var col = mix(shade, lit, key);

  // The belly. Nothing lights the underside of a cloud but the ground, so the
  // flat base is a third, darker tone — asked of the SMOOTH normal, so it is
  // one band along the bottom of the bank rather than a scatter of dark facets.
  col *= 1.0 - uniforms.form.z * cut(-nSmooth.y - 0.6);

  // THE SILVER LINING, the one term that belongs to where the EYE is. Looking
  // toward the light a cloud's thin edge is lit through, and on the smooth
  // normal that edge is a clean band round the silhouette — the rim light's own
  // vocabulary, one layer up — where on the facet normal it was a handful of
  // bright shards. Only well inside the light's quarter of the sky.
  //
  // **A graze alone is not an EDGE on a flat lump, and that shipped for a
  // photograph.** A bank low over the rim is seen almost edge-on, so its whole
  // top and its whole belly are square to the view as well as its rim, and a
  // cloud crossing the light took the lining all over and went the glare's own
  // colour. The rim of a flat lump is where its normal is also LEVEL, so the
  // lining asks both.
  let graze = cut(0.3 - abs(dot(nSmooth, v))) * cut(0.45 - abs(nSmooth.y));
  let behind = cut(pow(toward, 8.0) - 0.5);
  col = mix(col, uniforms.litColor, uniforms.look.z * graze * behind);

  // Inside the light's halo the whole mass is lifted toward the dome's glow,
  // so a cloud crossing the sun sits IN the bright air rather than cut out of it.
  col = mix(col, uniforms.glowColor, 0.35 * pow(toward, 40.0));

  // THE AIR. Every cloud takes some of the sky behind it — it is kilometres
  // away through the same haze that paints the dome — and a low one takes much
  // more, on the dome's own schedule: most of the way at the rim, the floor by
  // 30 degrees up. This is what sets a far bank back behind a near one.
  let low = 1.0 - smoothstep(0.06, 0.5, v.y);
  col = mix(col, dome, clamp(uniforms.form.w + low * uniforms.look.y, 0.0, 1.0));

  // ONE DEPTH PER PIXEL FOR EVERY CLOUD, written here rather than interpolated.
  // It is the depth of a point 7 km out along THIS PIXEL'S RAY, which is behind
  // every surface in the world and in front of the sun's disc — so a roof hides
  // a cloud, a cloud hides the disc, and the glow layer, occluded by this same
  // depth buffer, stops blooming the disc through one.
  //
  // **Along the ray, never along the view axis, and the difference was a bug
  // anybody could see.** A depth buffer stores view-axis z, and the disc 9 km
  // out has a view z of 9 km x cos(its angle off the centre of the screen). The
  // first version wrote one constant, the depth of 7 km DOWN THE AXIS, so past
  // about 39 degrees off-centre the disc's z fell under it and the disc drew in
  // front of the cloud hiding it: turn until the moon was toward the side of the
  // screen and the order flipped. A point at radial distance D on a ray whose
  // view-space direction is (x, y, 1) has z = D / |ray|, so writing that makes
  // the cloud's distance and the disc's the same KIND of distance at every
  // pixel, and 7 against 9 holds everywhere on the screen.
  //
  // From the pixel's own position rather than from vDir, for the painter's
  // order's sake: with LEQUAL a nearer lump drawn later must tie EXACTLY with
  // the farther one under it, and every fragment on one pixel is handed the same
  // position bit for bit, where an interpolated direction is not.
  let ndc = fragmentInputs.position.xy * uniforms.depthRay.zw - vec2f(1.0);
  let ray = ndc * uniforms.depthRay.xy;
  fragmentOutputs.fragDepth = uniforms.depthLine.x
    - uniforms.depthLine.y * sqrt(1.0 + dot(ray, ray));
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
}

/**
 * One material for the whole ring. Everything it reads but the eye is fixed for
 * the life of a sky, so it is set once and FROZEN — `GrassShader`'s argument:
 * the world matrix and `camPos` keep flowing through `_mustRebind`, which does
 * not read `isFrozen`.
 *
 * **Every fragment on a pixel writes the SAME depth and back faces are CULLED,
 * and the two go together.** With one depth for the whole ring the buffer cannot settle
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
      attributes: ["position", "normal", "smoothNormal"],
      uniforms: [
        "world",
        "viewProjection",
        "camPos",
        "depthRay",
        "depthLine",
        "sunDir",
        "shadeColor",
        "litColor",
        "hazeColor",
        "zenithColor",
        "glowColor",
        "look",
        "form",
        "tones",
      ],
      shaderLanguage: ShaderLanguage.WGSL,
      // Nothing is alpha-TESTED here, and this is not a claim that anything
      // is: it is the draw ORDER. Babylon draws a rendering group's opaque list,
      // then its alpha-test list, then its particles and its blended meshes, so
      // this puts the clouds after every opaque surface — the dome included,
      // which is depth-tested at 600 m and would paint over a cloud drawn before
      // it — and BEFORE everything that writes no depth. Drawn after those (the
      // clouds had a rendering group of their own), a cloud covered every
      // capture marker, tracer and plume standing against the sky: the far
      // depth passes wherever nothing wrote one. See `Sky.buildClouds`.
      needAlphaTesting: true,
    },
  );
  mat.setVector3("camPos", Vector3.Zero());
  mat.setVector4("depthRay", new Vector4(1, 1, 0, 0));
  mat.setVector2("depthLine", new Vector2(1, 0));
  mat.setVector3("sunDir", look.sunDir.normalizeToNew());
  mat.setColor3("shadeColor", look.shade);
  mat.setColor3("litColor", look.lit);
  mat.setColor3("hazeColor", look.haze);
  mat.setColor3("zenithColor", look.zenith);
  mat.setColor3("glowColor", look.glow);
  mat.setVector4(
    "look",
    new Vector4(look.litShare, look.hazeAtHorizon, look.lining, look.wrap),
  );
  mat.setVector4(
    "form",
    new Vector4(look.facetShare, look.shadeSky, look.belly, look.air),
  );
  mat.setVector2("tones", new Vector2(look.litStep, look.highlight));
  mat.depthFunction = Constants.LEQUAL;
  mat.backFaceCulling = true;
  mat.freeze();
  return mat;
}
