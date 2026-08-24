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
 */
import { Effect, Scene, ShaderMaterial, Vector2, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { DITHER_GLSL } from "./Dither";
import {
  BAND_GLSL,
  MAX_POINT_LIGHTS,
  SHADOW_GLSL,
  SHADOW_SAMPLER_NAMES,
  SHADOW_UNIFORM_NAMES,
} from "./CelShader";
// The instance includes self-register in the IncludesShadersStore; import
// them explicitly so the grass vertex shader's #include<instances...> can
// never be tree-shaken away (same trick the cel shader uses for bones).
import "@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration";
import "@babylonjs/core/Shaders/ShadersInclude/instancesVertex";

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

const MAX_PUSHERS = CONFIG.grass.maxPushers;

Effect.ShadersStore["grassVertexShader"] = `
precision highp float;

#define MAX_PUSHERS ${MAX_PUSHERS}

attribute vec3 position;
attribute vec3 normal;

// Declares world (and world0..3 when INSTANCES): the mesh transform. Do NOT
// redeclare "uniform mat4 world" here or the shader compiles twice over.
#include<instancesDeclaration>

uniform mat4 viewProjection;
uniform float time;
uniform vec2 windDir;
uniform vec2 windParams;   // x = tip travel (m), y = speed
uniform vec2 pushParams;   // x = radius (m), y = tip travel (m)
uniform vec3 pushers[MAX_PUSHERS];
uniform float pusherCount;

varying vec3 vNormalW;
varying vec3 vPosW;
varying float vTip;        // 0 at the root, 1 at the tip — drives the gradient

void main() {
  // Declares finalWorld (mesh world * instance matrix under THIN_INSTANCES).
  #include<instancesVertex>

  vec4 worldPos = finalWorld * vec4(position, 1.0);

  // Blades are 1.0 tall in local space, so position.y is already the 0..1
  // height along the stalk. The exponent keeps the lower half stiff.
  float hw = pow(clamp(position.y, 0.0, 1.0), 1.6);
  vTip = clamp(position.y, 0.0, 1.0);

  // --- wind: two crossing sines phased on position = travelling gusts ---
  float phase = worldPos.x * 0.35 + worldPos.z * 0.41;
  float gust = sin(time * windParams.y + phase)
    + 0.5 * sin(time * windParams.y * 2.33 + phase * 1.71);
  vec2 sway = windDir * gust * windParams.x;

  // --- pushers: radial part + flatten around each nearby body ---
  vec2 push = vec2(0.0);
  float flatten = 0.0;
  for (int i = 0; i < MAX_PUSHERS; i++) {
    if (float(i) < pusherCount) {
      vec2 delta = worldPos.xz - pushers[i].xz;
      float d = length(delta);
      float infl = 1.0 - smoothstep(0.0, pushParams.x, d);
      infl *= infl;
      // max() guards the divide when a blade sits exactly on a pusher.
      push += (delta / max(d, 0.05)) * infl;
      flatten = max(flatten, infl);
    }
  }

  worldPos.xz += (sway + push * pushParams.y) * hw;
  worldPos.y -= flatten * pushParams.y * 0.7 * hw;

  vPosW = worldPos.xyz;
  // Approximate under non-uniform instance scale; the fragment stage only
  // uses this to orient the facet normal, so the error never reads.
  vNormalW = normalize(mat3(finalWorld) * normal);
  gl_Position = viewProjection * worldPos;
}
`;

Effect.ShadersStore["grassFragmentShader"] = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

#define MAX_POINT_LIGHTS ${MAX_POINT_LIGHTS}

varying vec3 vNormalW;
varying vec3 vPosW;
varying float vTip;

uniform vec3 lightDir;
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform vec3 rimColor;
uniform vec3 fogColor;
uniform vec2 fogParams;  // x = start, y = end
uniform vec3 mistColor;
uniform vec2 mistParams; // x = height falloff, y = strength
uniform vec3 camPos;
uniform vec3 rootColor;
uniform vec3 tipColor;

uniform vec3 pointPos[MAX_POINT_LIGHTS];
uniform vec3 pointColor[MAX_POINT_LIGHTS]; // rgb premultiplied by intensity
uniform float pointRange[MAX_POINT_LIGHTS];
uniform float pointCount;

// Same geometric-normal trick as the cel shader: hard facets from
// screen-space derivatives, flipped to agree with the interpolated normal so
// backfaces (two-sided blades) light from the viewer's side.
vec3 facetNormal() {
  vec3 n = normalize(cross(dFdx(vPosW), dFdy(vPosW)));
  return dot(n, vNormalW) < 0.0 ? -n : n;
}

${BAND_GLSL}
${SHADOW_GLSL}
${DITHER_GLSL}

void main() {
  vec3 n = facetNormal();

  // --- albedo: root->tip gradient with a per-tuft value hash ---
  // The hash cells (0.25 m) are roughly tuft-sized, so each instance lands
  // mostly in one cell and reads as its own plant.
  vec3 base = mix(rootColor, tipColor, vTip);
  float h = fract(sin(dot(floor(vPosW.xz * 4.0), vec2(12.9898, 78.233))) * 43758.5453);
  base *= 0.85 + 0.3 * h;

  // --- directional key light (4 bands, matching the cel shader) ---
  // Gated by the same depth map the wall behind the field is gated by. A blade
  // is two-sided and facetNormal() flips toward the viewer, so the offset can
  // point either way — 0.06 m either side of a blade is nothing, and the
  // alternative (the un-flipped normal) is not available here.
  vec3 light = ambientColor;
  light += lightColor * band(max(dot(n, -lightDir), 0.0), 4.0)
    * shadowVisibility(n, vPosW);

  // --- point lights (3 bands, smooth falloff) ---
  for (int i = 0; i < MAX_POINT_LIGHTS; i++) {
    if (float(i) < pointCount) {
      vec3 toLight = pointPos[i] - vPosW;
      float dist = length(toLight);
      float atten = clamp(1.0 - dist / max(pointRange[i], 0.001), 0.0, 1.0);
      atten *= atten;
      float ndl = max(dot(n, toLight / max(dist, 0.001)), 0.0);
      light += pointColor[i] * atten * (0.25 + 0.75 * band(ndl, 3.0));
    }
  }

  vec3 col = base * light;

  // Same soft shoulder as the cel shader, so stacked lights stay tinted.
  vec3 over = max(col - 0.75, 0.0);
  col = min(col, vec3(0.75)) + 0.25 * over / (1.0 + over);

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
  vec3 viewDir = normalize(camPos - vPosW);
  float rim = 1.0 - max(dot(viewDir, n), 0.0);
  float level = abs(n.y);
  col += base * rimColor * step(0.72, rim) * (1.0 - smoothstep(0.90, 0.99, level));

  // --- atmosphere: identical to the cel shader ---
  float dist = length(vPosW - camPos);
  float mist = mistParams.y
    * exp(-max(vPosW.y, 0.0) / max(mistParams.x, 0.001))
    * clamp((dist - 6.0) / 45.0, 0.0, 1.0);
  col = mix(col, mistColor, clamp(mist, 0.0, 0.9));
  float fog = clamp((dist - fogParams.x) / (fogParams.y - fogParams.x), 0.0, 1.0);
  col = mix(col, fogColor, fog * fog);

  // Last thing before the write, because the write is the quantiser.
  gl_FragColor = vec4(dither(col), 1.0);
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
