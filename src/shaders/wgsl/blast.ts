/**
 * wgsl/blast.ts — The blast's BILLOW as plain strings OUR renderer assembles
 * (`render/blastProgram.ts`, `BABYLON_EXIT.md` X4.4c): the vertex stage that
 * lumps a unit icosphere into a cauliflower, and the pixel that is fire while
 * it is hot, is eaten from its rim by the smoke it turns into and dissolves
 * into wisps — and, under `GLOW_MASK`, that pixel's bloom, the glow's mask
 * drawn by the same vertex stage, so its LEQUAL test ties against the depth
 * the main pass's billow wrote. `BlastShader.ts`'s `ShaderMaterial` and its
 * mask twin drew these bodies through Babylon until X4.4c; the arithmetic is
 * theirs, statement for statement — what moved is only where a value is read
 * from: an instance's matrix, `billow` and `warmth` through a private block
 * its assembler fills (`uniforms.instanceWorld`, `uniforms.billow`,
 * `uniforms.warmth`, the thin instance's attributes until then) and the bloom
 * through the instance's flat `vGlow` (the mask material's `glowColor`
 * uniform until then).
 * Owns: `BLAST_SHARED` (the hash, the value noise and the drawn clock both
 * stages call), `BLAST_VERTEX` (`blastVertex`) and `BLAST_SURFACE`
 * (`blastSurface`: the frame's pixel and, under `GLOW_MASK`, the bloom's).
 * Invariants: a body DECLARES NOTHING (`wgsl/chunks.ts`' rule): it reads
 * `uniforms.<name>`, `fragmentInputs.<name>` and writes `vertexOutputs.<name>`,
 * and its assembler declares those; the instance's matrix is a translation, a
 * rotation and a scale and never a shear, which the normal transform assumes
 * (`BlastFx` builds every one with a determinant of +1); every derivative is
 * taken before the first branch (WGSL defines one only in uniform control
 * flow); it writes the frame's opaque alpha (`uniforms.opaqueAlpha`, 0 in the
 * main pass — no bake draws a blast).
 * Never: imports Babylon (`src/render/` imports this, and the build gate walks
 * it); declares a binding.
 * Contract: `docs/grenades.md`, "The blast is EIGHT layers", and
 * `docs/rendering.md`, "The pools, ours".
 */

/** What both stages call: the hash, the value noise, and the clock the DRAWING runs on. */
export const BLAST_SHARED = /* wgsl */ `
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

/**
 * The vertex stage: the lumped surface and its normal off two neighbours on
 * the sphere, carried by the instance's matrix (times the mesh's `world`,
 * the identity, as a thin instance's always was), and the bloom handed to
 * the pixel flat.
 */
export const BLAST_VERTEX = /* wgsl */ `
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

fn blastVertex() {
  var finalWorld = uniforms.instanceWorld;
  finalWorld = uniforms.world * finalWorld;

  let seed = uniforms.billow.z;
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
  vertexOutputs.vBillow = uniforms.billow;
  vertexOutputs.vWarmth = uniforms.warmth;
  vertexOutputs.vGlow = uniforms.glow;
  vertexOutputs.position = uniforms.viewProjection * wp;
}
`;

/**
 * The pixel: THE HEAT OF A PIXEL (`BlastShader.ts`' header) — the billow's
 * heat weighted up where the surface faces the eye and down at its outline,
 * broken by a climbing noise field — banded into the fire's five inks over
 * the smoke, the smoke lit by the frame's key, ambient and sky fill and mixed
 * toward its mist, the outline bitten and the whole dissolved from the rim;
 * fogged as the cel shader fogs. Under `GLOW_MASK`, the bloom per band.
 */
export const BLAST_SURFACE = /* wgsl */ `
fn blastSurface() -> vec4f {
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
  return vec4f(fragmentInputs.vGlow.rgb * glow, fragmentInputs.vGlow.a);
#else
  // The cel shader's fog: same curve, same radial distance.
  let dist = distance(p, uniforms.camPos);
  let f = clamp((dist - uniforms.fogParams.x) / max(0.001, uniforms.fogParams.y - uniforms.fogParams.x), 0.0, 1.0);
  col = mix(col, uniforms.fogColor, f * f);
  return vec4f(col, uniforms.opaqueAlpha);
#endif
}
`;
