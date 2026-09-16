/**
 * FilmGrain.ts — Full-screen grade: vignette, corner desaturation, radial
 * chromatic aberration, a PAPER grain pinned to the world, red damage flash.
 * Why hand-written: Babylon's image-processing pass re-gammas the cel shader's
 * already display-ready colors and washes the palette out — which is also why
 * pipeline.imageProcessingEnabled stays false. Keep the grade in this pass.
 * Invariants: this is the LAST pass on the camera; `detach`/`attach` exist so
 * the motion blur ahead of it can be removed and put back without ending up
 * behind it (see Game.setMotionBlurEnabled), and both honour `setEnabled`, so
 * that dance can never re-attach a grade the player turned off.
 * It SAMPLES the frame's depth (`FrameDepth`, shared with the ink, the blur
 * and the shafts) to put the paper on the surfaces rather than on the glass,
 * so like them it has to stay downstream of the pass the scene draws into.
 * Its shader is hand-written WGSL, and `shaderLanguage` on the PostProcess is
 * load-bearing rather than declarative: the constructor defaults to GLSL and
 * would look this pass up in a store nothing writes any more. See
 * `docs/rendering.md` for what the dialect and Babylon's WGSL processor decide.
 */
import {
  Camera,
  PostProcess,
  Scene,
  ShaderLanguage,
  ShaderStore,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { EnvironmentSpec } from "../world/environment";
import type { FrameDepth } from "./FrameDepth";

/**
 * THE PAPER IS PINNED TO THE WORLD, NOT TO THE SCREEN. A grain keyed on the
 * pixel reads as a film running over the scene: walk past a wall and the wall
 * slides under a texture that stays put. This one is keyed on WHERE THE PIXEL
 * IS — the frame's depth turned back into a position — so the tooth of the
 * paper belongs to the wall and moves with it, and the player walks through a
 * world drawn on paper rather than watching one projected onto it.
 *
 * A TEXTURE PINNED TO THE WORLD HAS NO SINGLE SIZE, and that is what the rest
 * of this is for. At one world scale the grain is a blur on a wall at arm's
 * length and a shimmer of sub-pixel noise down a street. So the paper is a
 * stack of OCTAVES, each one fixed in the world at a power-of-two cell size,
 * and which octaves are weighted is chosen by how big a pixel is at that
 * distance: walking toward a wall fades finer octaves in and coarser ones out,
 * continuously, and nothing slides — the "infinite zoom" of dynamic solid
 * textures (Bénard et al. 2010). The grain therefore holds ONE SIZE ON SCREEN
 * at every distance while never leaving the surface it is on. Each octave's
 * weight is zero at both ends of the stack, so an octave arriving or leaving
 * never pops, and each feature is normalised by the weights it actually got,
 * so the contrast does not breathe as the stack rolls.
 *
 * It is a SOLID texture — 3D noise over the position — so no surface normal is
 * needed, and a cut through it at any angle is paper. Three things are read
 * off the same octaves: TOOTH (the finest, signed), FIBRES (the zero crossings
 * of the middle ones, which trace thin curling lines) and MOTTLE (the coarsest,
 * the cloudiness of pulp).
 *
 * THREE THINGS ON SCREEN ARE NOT IN THE WORLD, and each is pinned to what it
 * moves with instead (`CONFIG.graphics.paper`): the WEAPON to the camera, found
 * by the same depth band the blur names it with; the SKY to the view direction,
 * being infinitely far; and nothing else — particles, tracers and see-through
 * glass write no depth, so they carry the paper of what is behind them, which
 * is what paint on a sheet does.
 *
 * THE SHEET IS LIT AND NOT LUMINOUS. The paper is laid on twice — multiplied
 * into the paint and added under it — and only the added half survives as the
 * paint goes to zero, so on its own it puts the most paper exactly where there
 * is no light to show any by. It therefore takes the light at the pixel
 * (`paper.litKnee`, `paper.litFloor`), which is what stops a night map being a
 * spray of grey over black at the amplitude a noon map spends on a white wall.
 * `docs/rendering.md` has what it measured and why the floor is not zero.
 *
 * PRECISION IS THE TRAP, and why the octaves are offset from the CPU. A world
 * coordinate of 2 km divided by a 1 mm cell is two million cells, and a float32
 * holds that to a quarter of a cell — the grain would crawl. So the shader
 * only ever divides CAMERA-RELATIVE distances, and where the camera sits inside
 * each octave's wrapped lattice (`PERIOD` cells) is computed in float64 once a
 * frame and uploaded per level. The depth buffer's own step is the second half
 * of it: a non-reversed depth32float loses decimetres by a few hundred metres,
 * so the footprint is never allowed under that step, or distant ground would
 * show the quantisation as contours in the grain.
 */
const P = CONFIG.graphics.paper;
/** The lattice wraps every PERIOD cells, per octave. MUST stay 256: the shader
 *  wraps with a mask and packs the wrapped point into 24 bits for one hash. */
const PERIOD = 256;
/** The finest and coarsest octave levels, as log2 of the cell in metres. */
const LEVEL_MIN = -12;
const LEVELS = 24;
/** Octaves summed per pixel. */
const OCTAVES = 5;
/** The finest octave's cell, in frame pixels (`paper.rows`). */
const CELL_PIXELS = 2;
/** The sky's paper is a sphere of this radius around the eye. */
const SKY_RADIUS = 1000;

ShaderStore.ShadersStoreWGSL["filmGrainFragmentShader"] = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;

// The frame's own depth, out of the shared FrameDepth. Declared as a depth
// texture so every read is a textureLoad and this pass declares no sampler.
var depthTexture: texture_depth_2d;

// Widest first, as Volumetrics orders its own.
uniform cellOffset: array<vec4f, ${LEVELS}>; // where the eye sits in each level's lattice, in cells
uniform camRight: vec3f;
uniform camUp: vec3f;
uniform camFwd: vec3f;
uniform tanHalfFov: vec2f;
uniform nearFar: vec2f;
uniform vignette: f32;
uniform grain: f32;
uniform aberration: f32;
uniform damage: f32;

const PERIOD: i32 = ${PERIOD};
const LEVEL_MIN: f32 = ${LEVEL_MIN.toFixed(1)};
const LEVEL_TOP: f32 = ${(LEVEL_MIN + LEVELS - OCTAVES).toFixed(1)};
const OCTAVES: i32 = ${OCTAVES};
const CELL_PIXELS: f32 = ${CELL_PIXELS.toFixed(1)};
const ROWS: f32 = ${P.rows.toFixed(1)};
const SKY_RADIUS: f32 = ${SKY_RADIUS.toFixed(1)};
const HELD_WITHIN: f32 = ${P.heldWithin.toFixed(3)};
const SKY_FROM: f32 = ${P.skyFrom.toFixed(1)};
const FIBRES: f32 = ${P.fibres.toFixed(3)};
const MOTTLE: f32 = ${P.mottle.toFixed(3)};
const LIT_KNEE: f32 = ${P.litKnee.toFixed(3)};
const LIT_FLOOR: f32 = ${P.litFloor.toFixed(3)};

// Buffer depth -> metres along the view axis. The same inverse CelInk,
// MotionBlur and Volumetrics take: left-handed, NDC z in [0, 1], no reverse-z.
fn linearise(d: f32, nf: vec2f) -> f32 {
  return (nf.x * nf.y) / (nf.y - d * (nf.y - nf.x));
}

// An integer hash, because a sin() hash of a lattice coordinate is exactly the
// float precision problem the header is about.
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

// A gradient per lattice point, wrapped to PERIOD so it agrees with cellOffset.
// PERIOD is 2^8, so the wrapped point packs into 24 bits and ONE pcg step
// hashes it — the nested three-step form cost three times as much for a
// pattern nobody can tell apart.
fn grad(c: vec3i) -> vec3f {
  let w = vec3u(c & vec3i(PERIOD - 1));
  let h = pcg(w.x | (w.y << 8u) | (w.z << 16u));
  return vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 511.5 - 1.0;
}

// 3D gradient noise, quintic. Signed, roughly +-0.5.
fn gnoise(p: vec3f) -> f32 {
  let fl = floor(p);
  let i = vec3i(fl);
  let f = p - fl;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let n000 = dot(grad(i), f);
  let n100 = dot(grad(i + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
  let n010 = dot(grad(i + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0));
  let n110 = dot(grad(i + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
  let n001 = dot(grad(i + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0));
  let n101 = dot(grad(i + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
  let n011 = dot(grad(i + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0));
  let n111 = dot(grad(i + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

// A window over the octave stack that is zero at both of its ends.
fn band(u: f32, a: f32, b: f32, c: f32, d: f32) -> f32 {
  return smoothstep(a, b, u) * (1.0 - smoothstep(c, d, u));
}

// The paper at one point, signed around zero. rel is camera-relative metres (or
// camera-space, or a direction on the sky's sphere); world says whether the
// lattice offsets apply; foot is how many metres one frame pixel covers there.
fn paper(rel: vec3f, world: bool, foot: f32) -> f32 {
  let lvl = clamp(log2(foot * CELL_PIXELS), LEVEL_MIN, LEVEL_TOP + 0.999);
  let e0 = floor(lvl);
  let fr = lvl - e0;
  var tooth = 0.0; var toothW = 0.0;
  var fibre = 0.0; var fibreW = 0.0;
  var mottle = 0.0; var mottleW = 0.0;
  for (var k: i32 = 0; k < OCTAVES; k++) {
    let e = e0 + f32(k);
    let offset = select(vec3f(0.0), uniforms.cellOffset[i32(e - LEVEL_MIN)].xyz, world);
    let n = gnoise(offset + rel * pow(2.0, -e));
    // Where this octave sits in the stack, 0 (finest, arriving) to 1 (coarsest,
    // leaving). Every window below is zero at both ends, so nothing pops.
    let u = (f32(k) - fr + 1.0) / f32(OCTAVES);
    let wt = band(u, 0.0, 0.12, 0.2, 0.45);
    let wf = band(u, 0.3, 0.5, 0.7, 0.9);
    let wm = band(u, 0.6, 0.82, 0.9, 1.0);
    // A fibre is where the noise crosses zero: thin, curling, never straight.
    let ridge = 1.0 - smoothstep(0.0, 0.045, abs(n));
    tooth += n * wt; toothW += wt * wt;
    fibre += (ridge - 0.12) * wf; fibreW += wf * wf;
    mottle += n * wm; mottleW += wm * wm;
  }
  return tooth / sqrt(max(toothW, 1e-4))
    + FIBRES * fibre / sqrt(max(fibreW, 1e-4))
    + MOTTLE * mottle / sqrt(max(mottleW, 1e-4));
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let centered = input.vUV - 0.5;
  let r2 = dot(centered, centered);

  // Radial chromatic aberration — none at the centre, smeared at the edge.
  let offset = centered * uniforms.aberration * r2 * 0.09;
  var col = vec3f(
    textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV + offset, 0.0).r,
    textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0).g,
    textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV - offset, 0.0).b,
  );

  // Where this pixel is. The same ray Volumetrics builds: unnormalised with its
  // camera-space z at exactly 1, so ray * depth is the point.
  let dims = vec2f(textureDimensions(depthTexture, 0));
  let px = clamp(vec2i(input.vUV * dims), vec2i(0), vec2i(dims) - vec2i(1));
  let d = linearise(textureLoad(depthTexture, px, 0), uniforms.nearFar);
  let ndc = input.vUV * 2.0 - 1.0;
  let rayC = vec3f(ndc * uniforms.tanHalfFov, 1.0);
  let rayW = uniforms.camRight * rayC.x + uniforms.camUp * rayC.y + uniforms.camFwd * rayC.z;

  // What the paper is pinned to: the camera for the weapon, the direction for
  // the sky, the world for everything else.
  let held = d < HELD_WITHIN;
  let sky = d > SKY_FROM;
  let world = !(held || sky);
  let rel = select(select(rayW * d, normalize(rayW) * SKY_RADIUS, sky), rayC * d, held);

  // How many metres one FRAME pixel covers there. The isotropic figure is the
  // distance times a pixel's angle; the screen derivative widens it on a
  // surface seen edge-on (ground down a street), clamped so the 2x2 quad
  // straddling a silhouette cannot blow one block of grain up to nothing; and
  // on the world it may never be finer than the depth buffer's own step.
  let pixAngle = 2.0 * uniforms.tanHalfFov.y / ROWS;
  let iso = select(d, SKY_RADIUS, sky) * pixAngle;
  let slope = max(length(dpdx(rel)), length(dpdy(rel))) * dims.y / ROWS;
  let quantum = select(0.0, d * d / uniforms.nearFar.x * 2.5e-7, world);
  let foot = max(clamp(slope, iso, iso * 6.0), quantum);

  // Vignette: the corners fall away into the dark.
  col *= 1.0 - uniforms.vignette * smoothstep(0.05, 0.62, r2);

  // Color drains toward the edges of vision.
  let lumV = dot(col, vec3f(0.299, 0.587, 0.114));
  col = mix(col, vec3f(lumV), clamp(r2 * 1.1, 0.0, 0.4));

  // Damage: blood pushes in from the border, but never closes over the middle
  // of the screen — the player still has to be able to fight while hurt.
  col = mix(col, vec3f(0.42, 0.02, 0.03), uniforms.damage * 0.8 * smoothstep(0.04, 0.42, r2));

  // The paper. Multiplied into the paint, so a bright wall shows its tooth the
  // way a wash on a rough sheet does, and added under it too, so a black
  // shadow is still ink on a sheet rather than a hole in it. The light side is
  // warm and the dark side neutral: the pale flecks are the sheet showing
  // through, and a sheet is not white.
  //
  // THE SHEET IS LIT AND NOT LUMINOUS, and that is what keeps a night map from
  // being a spray of grey over black. The added half is the only one that
  // survives as the paint goes to zero — the multiplied half goes down with it
  // — so on its own it puts the MOST paper exactly where there is least light
  // to show any by, and its weight rises as the picture darkens on top of
  // that. A sheet reflects what falls on it, so the added half takes the light
  // at the pixel, down to a floor that keeps a shadow a sheet and not a hole.
  let g = paper(rel, world, foot) * uniforms.grain;
  let sheet = select(vec3f(1.0), vec3f(1.0, 0.94, 0.82), g > 0.0);
  let lit = mix(LIT_FLOOR, 1.0, smoothstep(0.0, LIT_KNEE, lumV));
  col = col * (1.0 + g * 2.2) + g * sheet * (0.9 - lumV * 0.5) * lit;

  fragmentOutputs.color = vec4f(col, 1.0);
}
`;

export class FilmGrain {
  private post: PostProcess;
  private readonly camera: Camera;
  private damage = 0;
  /** Whether the player wants the grade at all. */
  private enabled = true;
  /** Whether the pass is on the camera right now — the constructor puts it
   *  there, so the two start in agreement and only this file moves them. */
  private attached = true;

  /**
   * How hard the grade is pushed, as the map asked for it. Defaults to
   * `CONFIG.graphics`, which is Hollowmere's — so a map that says nothing
   * gets exactly the shipped look.
   */
  private vignette: number = CONFIG.graphics.vignette;
  private grain: number = CONFIG.graphics.grain;
  private aberration: number = CONFIG.graphics.aberration;

  /** Where the eye sits in each level's wrapped lattice, in cells — `vec4`s. */
  private readonly cellOffset = new Float32Array(LEVELS * 4);
  /** The rendered camera's world basis, read off the view matrix at apply. */
  private readonly right = new Vector3(1, 0, 0);
  private readonly up = new Vector3(0, 1, 0);
  private readonly fwd = new Vector3(0, 0, 1);

  constructor(
    scene: Scene,
    camera: Camera,
    /** The frame's own depth image — what puts the paper on the surfaces. */
    private readonly depth: FrameDepth,
  ) {
    this.camera = camera;
    this.post = new PostProcess("filmGrain", "filmGrain", {
      uniforms: [
        "cellOffset",
        "camRight",
        "camUp",
        "camFwd",
        "tanHalfFov",
        "nearFar",
        "vignette",
        "grain",
        "aberration",
        "damage",
      ],
      samplers: ["depthTexture"],
      size: 1.0,
      camera,
      engine: scene.getEngine(),
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.post.onApply = (effect) => {
      this.placeLattice();
      effect.setArray4("cellOffset", this.cellOffset as unknown as number[]);
      effect.setFloat3("camRight", this.right.x, this.right.y, this.right.z);
      effect.setFloat3("camUp", this.up.x, this.up.y, this.up.z);
      effect.setFloat3("camFwd", this.fwd.x, this.fwd.y, this.fwd.z);
      // Vertical-fixed fov, the aspect off the pass's own target — the same
      // pair Volumetrics builds, for the same reason.
      const tanY = Math.tan(this.camera.fov * 0.5);
      effect.setFloat2(
        "tanHalfFov",
        (tanY * this.post.width) / Math.max(1, this.post.height),
        tanY,
      );
      effect.setFloat2("nearFar", this.camera.minZ, this.camera.maxZ);
      effect.setFloat("vignette", this.vignette);
      effect.setFloat("grain", this.grain);
      effect.setFloat("aberration", this.aberration);
      effect.setFloat("damage", this.damage);
      // A DECLARED sampler must be BOUND or the bind group fails to build and
      // the draw is silently lost. It cannot be null by the time this runs —
      // the capture is on the draw phase of the same `scene.render()` — but
      // nothing here rests on that.
      const depth = this.depth.texture;
      if (depth) effect.setTexture("depthTexture", depth);
    };
  }

  /**
   * The RENDERED camera's basis and its place in every octave's lattice, at
   * apply time — after the render has settled the view matrix, which is the
   * matrix the depth being read was written with. The rendered camera and not
   * the aim, for Volumetrics' reason: the rays have to land on the pixels the
   * depth came from, view punch and all.
   *
   * The offsets are computed here in float64 and are the whole precision story
   * (see the header): `position / cell mod PERIOD` is exact on the CPU and
   * crawls by a quarter-cell on the GPU.
   */
  private placeLattice(): void {
    const m = this.camera.getViewMatrix().m;
    this.right.set(m[0], m[4], m[8]);
    this.up.set(m[1], m[5], m[9]);
    this.fwd.set(m[2], m[6], m[10]);
    const p = this.camera.globalPosition;
    const o = this.cellOffset;
    for (let i = 0; i < LEVELS; i++) {
      const inv = 2 ** -(LEVEL_MIN + i);
      o[i * 4] = wrap(p.x * inv);
      o[i * 4 + 1] = wrap(p.y * inv);
      o[i * 4 + 2] = wrap(p.z * inv);
    }
  }

  /**
   * Sets the grade's strength for the installed map. Each field falls back to
   * its `CONFIG.graphics` default, so clearing a map's override restores the
   * shipped grade rather than zeroing it.
   *
   * Deliberately separate from `setEnabled`: this is the MAP saying how much,
   * and that is the PLAYER saying whether at all.
   */
  setGrade(grade: EnvironmentSpec["grade"]): void {
    const g = CONFIG.graphics;
    this.vignette = grade?.vignette ?? g.vignette;
    this.grain = grade?.grain ?? g.grain;
    this.aberration = grade?.aberration ?? g.aberration;
  }

  /**
   * Takes the grade off the camera, and puts it back on the END of the chain.
   *
   * The pair exists for two callers now. Turning the motion blur off removes a
   * pass from the middle of the chain, and Babylon's `attachPostProcess`
   * APPENDS, so putting it back would land it after this grade; detaching and
   * re-attaching the grade behind it is what keeps the documented order —
   * the shafts, then the blur, then this — without anyone having to compute an
   * insert index against a chain that also holds the pipeline's FXAA. The
   * other caller is `setEnabled` below.
   *
   * Grain over a smear is the symptom if this goes wrong: it reads as a dirty
   * lens rather than as motion, and nothing throws.
   *
   * Both are idempotent, and `attach` additionally refuses while the grade is
   * switched off — the blur's dance is a detach and a re-attach around some
   * other work, and it must not resurrect a pass the player took away. That is
   * also why the grade always APPENDS rather than going back into the slot it
   * came out of, the way `Game.syncVolumetrics` does: the tail is where it belongs,
   * and a blur attached while it was away is already sitting past its old
   * index. The cost is one null hole per off/on cycle in the camera's list,
   * which is bounded by clicks on a settings row rather than by frames.
   */
  detach(): void {
    if (!this.attached) return;
    this.camera.detachPostProcess(this.post);
    this.attached = false;
  }

  attach(): void {
    if (this.attached || !this.enabled) return;
    this.camera.attachPostProcess(this.post);
    this.attached = true;
  }

  /**
   * Turns the whole grade on or off — a display setting, not a mood.
   *
   * Detaching rather than zeroing the uniforms, for the reason the motion blur
   * states about itself: a pass switched off in its shader still reads and
   * writes the entire frame. Note the red damage flash goes with it, since it
   * is painted by this shader; the HUD's directional damage arcs are not, and
   * are what a player with the grade off still reads a hit from.
   */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.attach();
    else this.detach();
  }

  /** Kicks the red edge flash; call when the player takes a hit. */
  flashDamage(): void {
    this.damage = CONFIG.graphics.damageFlash;
  }

  /** Decays the damage flash. The paper has no clock: it is part of the world. */
  update(dt: number): void {
    if (this.damage > 0) {
      this.damage = Math.max(0, this.damage - dt * CONFIG.graphics.damageFlashDecay);
    }
  }
}

/** `x mod PERIOD`, positive, in float64. */
function wrap(x: number): number {
  return x - PERIOD * Math.floor(x / PERIOD);
}
