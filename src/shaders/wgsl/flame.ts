/**
 * wgsl/flame.ts — The FIRE as plain strings our renderer assembles
 * (`render/flameProgram.ts`, which draws every fire since `BABYLON_EXIT.md`
 * X4.4d — the world's and the molotov's). Babylon's assembled them too, in
 * `shaders/FlameShader.ts`' stages and its glow-mask twin, which the map
 * editor drew its fires with; those were deleted at X5.3d, and the arms below
 * written for them (`uniforms.world` a uniform, the bloom
 * `uniforms.glowColor`: no `FLAME_INSTANCED`) are assembled by nothing since.
 * The vertex stage that writhes, leans, licks and
 * hooks a tongue and carries an ember up out of the bed, and the pixel that
 * bands it in the fire's five inks — and, under `GLOW_MASK`, that pixel's
 * bloom, drawn by the same vertex stage, so its LEQUAL test ties against the
 * depth the main pass's fire wrote. The arithmetic is the one `FlameShader.ts`
 * held whole until X4.4d, statement for statement: what moved is only the
 * wrapper — a body is a function here, each renderer's `main` calling it.
 * Owns: `FLAME_SHARED` (the hash, the value noise and the drawn clock both
 * stages call), `FLAME_VERTEX` (`flameVertex`) and `FLAME_SURFACE`
 * (`flameSurface`: the frame's pixel and, under `GLOW_MASK`, the bloom's).
 * Invariants: a body DECLARES NOTHING (`wgsl/chunks.ts`' rule): it reads
 * `uniforms.<name>`, `vertexInputs.<name>` and `fragmentInputs.<name>` and
 * writes `vertexOutputs.<name>`, and each renderer declares those; the
 * vertex's `uniforms.world` is a uniform on Babylon's side and an instance's
 * matrix on ours (a private block its assembler fills), and the bloom is
 * `uniforms.glowColor` on Babylon's side and, under `FLAME_INSTANCED`, the
 * instance's flat `vGlow` on ours — the two names a body may read two ways;
 * every derivative is taken before the first branch on the layer (WGSL
 * defines one only in uniform control flow, and the layer is a varying); it
 * writes the frame's opaque alpha (`uniforms.opaqueAlpha`, 0 in the main
 * pass — no bake draws a fire, `FINDINGS.md` 51).
 * Never: imports Babylon (`src/render/` imports this, and the build gate walks
 * it); declares a binding; is edited on one side only — there is no other
 * copy.
 * Contract: `docs/rendering.md`, "The fire", and `docs/grenades.md`.
 */

/** What both stages call: the hash, the value noise, and the clock the SHAPE runs on. */
export const FLAME_SHARED = /* wgsl */ `
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

/**
 * The vertex stage: a tongue planted at its root and travelling at its tip,
 * an ember born at the bed and drawn out along its climb, the bounds marker
 * left where it stands (`FlameShader.ts`' header has the four layers).
 */
export const FLAME_VERTEX = /* wgsl */ `
fn flameVertex() {
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

/**
 * The pixel: the tongue's heat, eaten by a climbing noise field and bitten at
 * the silhouette, banded into the outer tongue's three inks, the core's two
 * and the embers' cooling three — fogged as the cel shader fogs. Under
 * `GLOW_MASK`, the bloom per band.
 */
export const FLAME_SURFACE = /* wgsl */ `
fn flameSurface() -> vec4f {
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
  let v = normalize(uniforms.camPos - p);
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
#ifdef FLAME_INSTANCED
  let glowColor = fragmentInputs.vGlow;
#else
  let glowColor = uniforms.glowColor;
#endif
  return vec4f(glowColor.rgb * glow, glowColor.a);
#else
  // The same fog, curve and radial distance as the cel shader and EmissiveFog.
  let dist = distance(fragmentInputs.vPosW, uniforms.camPos);
  let f = clamp((dist - uniforms.fogParams.x) / max(0.001, uniforms.fogParams.y - uniforms.fogParams.x), 0.0, 1.0);
  col = mix(col, uniforms.fogColor, f * f);
  // Opaque, so it writes what every opaque surface writes into the frame's
  // translucent-coverage channel — 0 for the frame.
  return vec4f(col, uniforms.opaqueAlpha);
#endif
}
`;
