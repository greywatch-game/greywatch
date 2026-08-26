/**
 * GrassShader.ts — Vertex-animated grass ShaderMaterial: ambient wind sway
 * plus a radial "pusher" bend around nearby combatants (the ripple as you
 * run through it), lit with the same banded key/point/fog/mist terms as the
 * cel shader. Invariants: blades are exactly 1.0 tall in mesh-local space —
 * instance matrices scale Y to real height, so position.y IS the bend weight.
 * Point-light uniform arrays are pre-allocated to MAX_POINT_LIGHTS and filled
 * by GrassSystem each frame from the same LightingSystem slots as the cel
 * shader. Pusher array is pre-allocated to CONFIG.grass.maxPushers. Opaque
 * output; no Babylon lights; no texture (root->tip colour gradient instead).
 * Both stages are hand-written WGSL, and `shaderLanguage` on the material is
 * load-bearing rather than declarative: a `ShaderMaterial` defaults to GLSL
 * and would look these up in a store nothing writes any more. See
 * `docs/rendering.md` for what the dialect and Babylon's WGSL processor decide.
 */
import {
  Scene,
  ShaderLanguage,
  ShaderMaterial,
  ShaderStore,
  Vector2,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import {
  MAX_POINT_LIGHTS,
  SHADOW_SAMPLER_NAMES,
  SHADOW_UNIFORM_NAMES,
} from "./CelShader";
// The shared includes self-register in the IncludesShadersStoreWGSL; import
// them explicitly so the #include<cel...> lines below can never be tree-shaken
// away, and so registration is provably before the first effect COMPILE rather
// than merely before the first material.
import "./wgsl/includes";

/**
 * Grass — the one mesh in the game that moves without an animation system.
 *
 * All motion happens in the vertex stage, in world space, after the
 * thin-instance transform:
 *
 * - **wind**: two crossing sine waves phased on world position, so gusts
 *   travel across a field instead of every tuft bobbing in sync. The bearing
 *   and the amplitude are `CONFIG.wind`'s, shared with the world's foliage —
 *   see `CelShader`'s sway, which is the same idea one layer up;
 * - **pushers**: up to `CONFIG.grass.maxPushers` character positions bend
 *   blades radially away and flatten them, with a smoothstep falloff — a
 *   sprinting body parts the grass ahead of its feet;
 * - both are weighted by `position.y^1.6`, so roots stay planted and tips
 *   travel — the bend reads as a stalk flexing, not a mesh sliding.
 *
 * The fragment stage is the cel shader's lighting model (hard-band key
 * light, banded point lights, soft shoulder, rim, height mist, distance fog)
 * with the albedo replaced by a root->tip gradient plus a per-tuft value
 * hash, so a field of identical instances doesn't read as one stamp.
 */

/**
 * The pusher count, and — with `MAX_POINT_LIGHTS` — one of the two numbers that
 * reach the shader by INTERPOLATION and never as a `#define`.
 *
 * An array's size has to be a literal or a define, because Babylon resolves the
 * bound out of the preprocessor table when it lays out the leftover UBO and a
 * WGSL `const` is not in that table. A define is the worse of the two: the WGSL
 * processor implements one by searching the whole source for its NAME with an
 * un-anchored regex and pasting the value over every hit, so a name that is a
 * substring of any other identifier corrupts the shader with no diagnostic.
 * Both counts are TypeScript constants already, so interpolating the number
 * costs nothing and leaves the loop bounds as real WGSL `const` declarations.
 */
const MAX_PUSHERS = CONFIG.grass.maxPushers;

ShaderStore.ShadersStoreWGSL["grassVertexShader"] = `
attribute position: vec3f;
attribute normal: vec3f;

// Declares world (and world0..3 when INSTANCES): the mesh transform. Do NOT
// redeclare "uniform world" here or the shader declares it twice over.
#include<celInstancesDeclaration>

uniform viewProjection: mat4x4f;
uniform time: f32;
uniform windDir: vec2f;
uniform windParams: vec2f;   // x = tip travel (m), y = speed
uniform pushParams: vec2f;   // x = radius (m), y = tip travel (m)
uniform pushers: array<vec3f, ${MAX_PUSHERS}>;
uniform pusherCount: f32;

varying vNormalW: vec3f;
varying vPosW: vec3f;
varying vTip: f32;        // 0 at the root, 1 at the tip — drives the gradient

const MAX_PUSHERS: i32 = ${MAX_PUSHERS};

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  // Declares finalWorld (mesh world * instance matrix under THIN_INSTANCES).
  #include<celInstancesVertex>

  var worldPos = finalWorld * vec4f(vertexInputs.position, 1.0);

  // Blades are 1.0 tall in local space, so position.y is already the 0..1
  // height along the stalk. The exponent keeps the lower half stiff.
  let hw = pow(clamp(vertexInputs.position.y, 0.0, 1.0), 1.6);
  vertexOutputs.vTip = clamp(vertexInputs.position.y, 0.0, 1.0);

  // --- wind: two crossing sines phased on position = travelling gusts ---
  let phase = worldPos.x * 0.35 + worldPos.z * 0.41;
  let gust = sin(uniforms.time * uniforms.windParams.y + phase)
    + 0.5 * sin(uniforms.time * uniforms.windParams.y * 2.33 + phase * 1.71);
  let sway = uniforms.windDir * gust * uniforms.windParams.x;

  // --- pushers: radial part + flatten around each nearby body ---
  var push = vec2f(0.0);
  var flatten = 0.0;
  for (var i = 0; i < MAX_PUSHERS; i++) {
    if (f32(i) < uniforms.pusherCount) {
      let delta = worldPos.xz - uniforms.pushers[i].xz;
      let d = length(delta);
      var infl = 1.0 - smoothstep(0.0, uniforms.pushParams.x, d);
      infl *= infl;
      // max() guards the divide when a blade sits exactly on a pusher.
      push += (delta / max(d, 0.05)) * infl;
      flatten = max(flatten, infl);
    }
  }

  // Two component writes rather than one swizzle write: WGSL allows an
  // assignment to a single component and forbids one to a multi-component
  // swizzle, so the GLSL "worldPos.xz +=" has to be spelled out.
  let shift = (sway + push * uniforms.pushParams.y) * hw;
  worldPos.x += shift.x;
  worldPos.z += shift.y;
  worldPos.y -= flatten * uniforms.pushParams.y * 0.7 * hw;

  vertexOutputs.vPosW = worldPos.xyz;
  // Approximate under non-uniform instance scale; the fragment stage only
  // uses this to orient the facet normal, so the error never reads. WGSL has
  // no mat4->mat3 conversion, so the upper-left block is taken by hand.
  vertexOutputs.vNormalW = normalize(
    mat3x3f(finalWorld[0].xyz, finalWorld[1].xyz, finalWorld[2].xyz)
      * vertexInputs.normal);
  vertexOutputs.position = uniforms.viewProjection * worldPos;
}
`;

// The derivatives below are what was MEANT — a facet normal is a screen-space
// difference and band()'s width is how fast its index moves per pixel — so
// there is no explicit-LOD form to reach for the way a texture fetch has one,
// and WGSL's uniformity analysis has to be told. Every fetch in celShadow is
// already a textureSampleLevel, so this covers the derivatives and nothing else.
ShaderStore.ShadersStoreWGSL["grassFragmentShader"] = `
#define DISABLE_UNIFORMITY_ANALYSIS

varying vNormalW: vec3f;
varying vPosW: vec3f;
varying vTip: f32;

uniform lightDir: vec3f;
uniform lightColor: vec3f;
uniform ambientColor: vec3f;
uniform rimColor: vec3f;
uniform fogColor: vec3f;
uniform fogParams: vec2f;  // x = start, y = end
uniform mistColor: vec3f;
uniform mistParams: vec2f; // x = height falloff, y = strength
uniform camPos: vec3f;
uniform rootColor: vec3f;
uniform tipColor: vec3f;

uniform pointPos: array<vec3f, ${MAX_POINT_LIGHTS}>;
uniform pointColor: array<vec3f, ${MAX_POINT_LIGHTS}>; // rgb premultiplied by intensity
uniform pointRange: array<f32, ${MAX_POINT_LIGHTS}>;
uniform pointCount: f32;

const MAX_POINT_LIGHTS: i32 = ${MAX_POINT_LIGHTS};

// Same geometric-normal trick as the cel shader: hard facets from
// screen-space derivatives, flipped to agree with the interpolated normal so
// backfaces (two-sided blades) light from the viewer's side.
fn facetNormal() -> vec3f {
  let n = normalize(cross(dpdx(fragmentInputs.vPosW), dpdy(fragmentInputs.vPosW)));
  return select(n, -n, dot(n, fragmentInputs.vNormalW) < 0.0);
}

#include<celBand>
#include<celShadow>
#include<celDither>

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let n = facetNormal();

  // --- albedo: root->tip gradient with a per-tuft value hash ---
  // The hash cells (0.25 m) are roughly tuft-sized, so each instance lands
  // mostly in one cell and reads as its own plant.
  var base = mix(uniforms.rootColor, uniforms.tipColor, fragmentInputs.vTip);
  let h = fract(sin(dot(floor(fragmentInputs.vPosW.xz * 4.0), vec2f(12.9898, 78.233))) * 43758.5453);
  base *= 0.85 + 0.3 * h;

  // --- directional key light (4 bands, matching the cel shader) ---
  // Gated by the same depth map the wall behind the field is gated by. A blade
  // is two-sided and facetNormal() flips toward the viewer, so the offset can
  // point either way — 0.06 m either side of a blade is nothing, and the
  // alternative (the un-flipped normal) is not available here.
  var light = uniforms.ambientColor;
  light += uniforms.lightColor * band(max(dot(n, -uniforms.lightDir), 0.0), 4.0)
    * shadowVisibility(n, fragmentInputs.vPosW);

  // --- point lights (3 bands, smooth falloff) ---
  for (var i = 0; i < MAX_POINT_LIGHTS; i++) {
    if (f32(i) < uniforms.pointCount) {
      let toLight = uniforms.pointPos[i] - fragmentInputs.vPosW;
      let dist = length(toLight);
      var atten = clamp(1.0 - dist / max(uniforms.pointRange[i], 0.001), 0.0, 1.0);
      atten *= atten;
      let ndl = max(dot(n, toLight / max(dist, 0.001)), 0.0);
      light += uniforms.pointColor[i] * atten * (0.25 + 0.75 * band(ndl, 3.0));
    }
  }

  var col = base * light;

  // Same soft shoulder as the cel shader, so stacked lights stay tinted.
  let over = max(col - 0.75, vec3f(0.0));
  col = min(col, vec3f(0.75)) + 0.25 * over / (1.0 + over);

  // Hard rim, matching the cel look — INCLUDING the cel shader's gate on tilt,
  // which this went without and should not have. On a near-level surface the
  // grazing angle a rim keys on is nothing but distance from the eye, so an
  // ungated rim paints a hard-edged disc of un-rimmed ground locked to the
  // camera and sliding across the map with the player; docs/rendering.md
  // argues the whole case against the floor's version of it.
  //
  // A standing blade is near-vertical, so level is ~0 and it keeps its rim -
  // which is right, a blade IS a silhouette. What the gate takes off is the
  // tuft tops and the blades a combatant has flattened, which are the only
  // parts of a field that are near-horizontal and the only ones that were
  // drawing the disc.
  let viewDir = normalize(uniforms.camPos - fragmentInputs.vPosW);
  let rim = 1.0 - max(dot(viewDir, n), 0.0);
  let level = abs(n.y);
  col += base * uniforms.rimColor * step(0.72, rim) * (1.0 - smoothstep(0.90, 0.99, level));

  // --- atmosphere: identical to the cel shader ---
  let dist = length(fragmentInputs.vPosW - uniforms.camPos);
  let mist = uniforms.mistParams.y
    * exp(-max(fragmentInputs.vPosW.y, 0.0) / max(uniforms.mistParams.x, 0.001))
    * clamp((dist - 6.0) / 45.0, 0.0, 1.0);
  col = mix(col, uniforms.mistColor, clamp(mist, 0.0, 0.9));
  let fog = clamp((dist - uniforms.fogParams.x) / (uniforms.fogParams.y - uniforms.fogParams.x), 0.0, 1.0);
  col = mix(col, uniforms.fogColor, fog * fog);

  // Last thing before the write, because the write is the quantiser.
  fragmentOutputs.color = vec4f(dither(col), 1.0);
}
`;

/** Uniforms the GrassSystem pushes per frame / per round. */
const GRASS_UNIFORMS = [
  "world",
  "viewProjection",
  "time",
  "windDir",
  "windParams",
  "pushParams",
  "pushers",
  "pusherCount",
  "lightDir",
  "lightColor",
  "ambientColor",
  "rimColor",
  "fogColor",
  "fogParams",
  "mistColor",
  "mistParams",
  "camPos",
  "rootColor",
  "tipColor",
  "pointPos",
  "pointColor",
  "pointRange",
  "pointCount",
];

/**
 * One grass material per map build. Motion tunables come straight from
 * CONFIG.grass; palette and lighting uniforms are set by the GrassSystem
 * from the map's environment, and time/camera/lights/pushers per frame.
 * Two-sided: a blade is a paper-thin tapered strip seen from every angle.
 */
export function createGrassMaterial(scene: Scene, name: string): ShaderMaterial {
  const mat = new ShaderMaterial(
    name,
    scene,
    { vertex: "grass", fragment: "grass" },
    {
      attributes: ["position", "normal"],
      uniforms: [...GRASS_UNIFORMS, ...SHADOW_UNIFORM_NAMES],
      samplers: [...SHADOW_SAMPLER_NAMES],
      shaderLanguage: ShaderLanguage.WGSL,
    },
  );
  mat.backFaceCulling = false;
  const g = CONFIG.grass;
  // The bearing is the valley's, not the field's — `CONFIG.wind` is shared with
  // the foliage the same air moves, and a field leaning one way under a canopy
  // leaning another is two animations rather than a breeze.
  const w = CONFIG.wind;
  mat.setVector2("windDir", new Vector2(w.dir[0], w.dir[1]).normalize());
  mat.setVector2(
    "windParams",
    new Vector2(w.grass.travel, w.grass.speed),
  );
  mat.setVector2("pushParams", new Vector2(g.pushRadius, g.pushStrength));
  mat.setFloat("time", 0);
  mat.setVector3("camPos", Vector3.Zero());
  mat.setArray3("pushers", new Array(MAX_PUSHERS * 3).fill(0));
  mat.setFloat("pusherCount", 0);
  mat.setArray3("pointPos", new Array(MAX_POINT_LIGHTS * 3).fill(0));
  mat.setArray3("pointColor", new Array(MAX_POINT_LIGHTS * 3).fill(0));
  mat.setFloats("pointRange", new Array(MAX_POINT_LIGHTS).fill(0));
  mat.setFloat("pointCount", 0);
  return mat;
}
