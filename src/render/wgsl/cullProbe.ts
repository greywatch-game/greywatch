/**
 * render/wgsl/cullProbe.ts — `?cullcheck`'s probes: each cull's test re-run on
 * the GPU over the very buffers the cull reads, with its inputs READ in each
 * of the ways they have been declared, one bit of a mask a form; and what the
 * shader read, echoed out (`render/CullCheck.ts`). So one reading on a device
 * says whether its GPU holds other bytes than the CPU wrote, reads the same
 * bytes as other numbers, or computes something else from the right ones.
 * Owns: `CLUSTER_PROBE_WGSL`, `INSTANCE_PROBE_WGSL`, the forms each tests
 * (`CLUSTER_FORMS`, `INSTANCE_FORMS`), the echo's layout (`ECHO_WORDS`,
 * `UNIFORM_ECHO_WORDS`) and `PROBE_SIZE`.
 * Invariants: every form runs ONE `decide` — the same arithmetic — over
 * inputs read one of two ways each: the uniform block as the struct of
 * scalars and `vec4f`s the culls declared before 2026-10-16, or as the
 * `vec4u`s of words they declare now (`CULL_DECLARATIONS`: nine of them then,
 * ten since X3.6a's pass mask, which the probe echoes nothing of and does not
 * test — only a main pass's view, whose mask is 0, takes a check); the records as
 * the structs with a `vec3f` beside a scalar they declared before, or as the
 * whole `vec4`s they declare now. Bit 0 is old/old, bit 3 new/new — the
 * culls' own reads. The old declarations are bound to the SAME buffers at
 * bindings of their own; nothing is copied.
 * Never: writes anything but its mask and its echoes; is built without the flag.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * THE ECHO, `ECHO_WORDS` an item: the record's position read the old way
 * (clusters: lo, hi; instances: centre, radius), the same read the new way,
 * then — off the new reads — the deciding test (0 kept, 1 reach, 2 gate, 3 +
 * k outside plane k), each plane's value at the far corner, the growth, and
 * the old/old form's deciding test. The UNIFORM echo, written by item 0: its
 * 36 words read through the old struct, then through the words.
 */
import { CULL_DECLARATIONS } from "./clusterCull";
import { INSTANCE_DECLARATIONS } from "./instanceCull";

/** Threads in a probe workgroup. */
export const PROBE_SIZE = 64;
/** An item's echo, in words. */
export const ECHO_WORDS = 20;
/** The uniform echo: the block read the old way, then the new. */
export const UNIFORM_ECHO_WORDS = 72;

export const CLUSTER_FORMS = ["old/old", "words/old", "old/vec4", "words/vec4 (now)"] as const;
export const INSTANCE_FORMS = CLUSTER_FORMS;

/** Both probes' shared half: the old uniform, the inputs, the outputs. */
const COMMON = /* wgsl */ `
${CULL_DECLARATIONS}
const SLACK: f32 = 0.05;

// The uniform block as the culls declared it until 2026-10-16.
struct OldCull {
  planes: array<vec4f, 5>,
  eyeReach: vec4f,
  perRad: f32,
  px2: f32,
  gate: u32,
  rampReach: f32,
  bandsRig: vec4f,
  counts: vec4u,
}
@group(0) @binding(12) var<uniform> old: OldCull;
@group(0) @binding(13) var<storage, read_write> uniformEcho: array<u32>;
@group(0) @binding(14) var<storage, read_write> echo: array<u32>;
@group(0) @binding(15) var<storage, read_write> mask: array<u32>;

// The uniform's inputs to a test, however they were read.
struct U {
  p0: vec4f,
  p1: vec4f,
  p2: vec4f,
  p3: vec4f,
  p4: vec4f,
  eye: vec3f,
  reach2: f32,
  perRad: f32,
  px2: f32,
  gate: bool,
  rampReach: f32,
  rigReach: f32,
}

fn uOld() -> U {
  return U(old.planes[0], old.planes[1], old.planes[2], old.planes[3], old.planes[4],
    old.eyeReach.xyz, old.eyeReach.w, old.perRad, old.px2, old.gate != 0u, old.rampReach, old.bandsRig.w);
}

fn uNew() -> U {
  return U(plane(cull[0]), plane(cull[1]), plane(cull[2]), plane(cull[3]), plane(cull[4]),
    eye(), reach2(), perRad(), px2(), gateOn(), rampReach(), rigReach());
}

fn echoUniform() {
  for (var k = 0u; k < 5u; k++) {
    let p = bitcast<vec4u>(old.planes[k]);
    uniformEcho[k * 4u] = p.x;
    uniformEcho[k * 4u + 1u] = p.y;
    uniformEcho[k * 4u + 2u] = p.z;
    uniformEcho[k * 4u + 3u] = p.w;
  }
  let e = bitcast<vec4u>(old.eyeReach);
  uniformEcho[20] = e.x;
  uniformEcho[21] = e.y;
  uniformEcho[22] = e.z;
  uniformEcho[23] = e.w;
  uniformEcho[24] = bitcast<u32>(old.perRad);
  uniformEcho[25] = bitcast<u32>(old.px2);
  uniformEcho[26] = old.gate;
  uniformEcho[27] = bitcast<u32>(old.rampReach);
  let b = bitcast<vec4u>(old.bandsRig);
  uniformEcho[28] = b.x;
  uniformEcho[29] = b.y;
  uniformEcho[30] = b.z;
  uniformEcho[31] = b.w;
  uniformEcho[32] = old.counts.x;
  uniformEcho[33] = old.counts.y;
  uniformEcho[34] = old.counts.z;
  uniformEcho[35] = old.counts.w;
  for (var k = 0u; k < 9u; k++) {
    let w = cull[k];
    uniformEcho[36u + k * 4u] = w.x;
    uniformEcho[37u + k * 4u] = w.y;
    uniformEcho[38u + k * 4u] = w.z;
    uniformEcho[39u + k * 4u] = w.w;
  }
}

fn put3(o: u32, v: vec3f) {
  let w = bitcast<vec3u>(v);
  echo[o] = w.x;
  echo[o + 1u] = w.y;
  echo[o + 2u] = w.z;
}
`;

export const CLUSTER_PROBE_WGSL = /* wgsl */ `
${COMMON}
// The records as the cluster cull declared them until 2026-10-16.
struct OldCluster {
  lo: vec3f,
  firstIndex: u32,
  hi: vec3f,
  indexCount: u32,
  group: u32,
  block: u32,
  surface: u32,
  piece: u32,
  ramp: f32,
  rigged: u32,
  _a: u32,
  _b: u32,
}
struct OldBox {
  lo: vec3f,
  _a: f32,
  hi: vec3f,
  _b: f32,
}
@group(0) @binding(1) var<storage, read> clusters: array<Cluster>;
@group(0) @binding(2) var<storage, read> blocks: array<Box>;
@group(0) @binding(3) var<storage, read> spheres: array<vec4f>;
@group(0) @binding(10) var<storage, read> oldBlocks: array<OldBox>;
@group(0) @binding(11) var<storage, read> oldClusters: array<OldCluster>;

// A cluster's inputs to a test, however they were read.
struct R {
  lo: vec3f,
  hi: vec3f,
  blo: vec3f,
  bhi: vec3f,
  sphere: vec4f,
  ramp: f32,
  rigged: bool,
}

fn rOld(i: u32) -> R {
  let c = oldClusters[i];
  let b = oldBlocks[c.block];
  return R(c.lo, c.hi, b.lo, b.hi, spheres[c.surface], c.ramp, c.rigged != 0u);
}

fn rNew(i: u32) -> R {
  let c = clusters[i];
  let b = blocks[c.refs.y];
  return R(bitcast<vec3f>(c.lo.xyz), bitcast<vec3f>(c.hi.xyz), b.lo.xyz, b.hi.xyz, spheres[c.refs.z],
    bitcast<f32>(c.sway.x), c.sway.y != 0u);
}

fn grow(u: U, r: R) -> f32 {
  return r.ramp * u.rampReach + select(0.0, u.rigReach, r.rigged) + SLACK;
}

fn far(p: vec4f, r: R) -> f32 {
  let mid = 0.5 * (r.lo + r.hi);
  let half = 0.5 * (r.hi - r.lo);
  return dot(p.xyz, mid) + dot(abs(p.xyz), half) + p.w;
}

fn decide(u: U, r: R) -> u32 {
  let d = max(max(r.blo - u.eye, vec3f(0.0)), u.eye - r.bhi);
  if (dot(d, d) > u.reach2) { return 1u; }
  if (u.gate) {
    let s = r.sphere.xyz - u.eye;
    let d2 = dot(s, s);
    if (d2 > 1.0) {
      let w = 2.0 * r.sphere.w * u.perRad;
      if (w * w < u.px2 * d2) { return 2u; }
    }
  }
  let g = -grow(u, r);
  if (far(u.p0, r) < g) { return 3u; }
  if (far(u.p1, r) < g) { return 4u; }
  if (far(u.p2, r) < g) { return 5u; }
  if (far(u.p3, r) < g) { return 6u; }
  if (far(u.p4, r) < g) { return 7u; }
  return 0u;
}

@compute @workgroup_size(${PROBE_SIZE})
fn probe(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let i = gid.y * nw.x * ${PROBE_SIZE}u + gid.x;
  if (i >= itemCount()) { return; }
  if (i == 0u) { echoUniform(); }
  let uo = uOld();
  let un = uNew();
  let ro = rOld(i);
  let rn = rNew(i);
  let a = decide(uo, ro);
  let d = decide(un, rn);
  var m = 0u;
  if (a == 0u) { m = m | 1u; }
  if (decide(un, ro) == 0u) { m = m | 2u; }
  if (decide(uo, rn) == 0u) { m = m | 4u; }
  if (d == 0u) { m = m | 8u; }
  mask[i] = m;
  let o = i * ${ECHO_WORDS}u;
  put3(o, ro.lo);
  put3(o + 3u, ro.hi);
  put3(o + 6u, rn.lo);
  put3(o + 9u, rn.hi);
  echo[o + 12u] = d;
  echo[o + 13u] = bitcast<u32>(far(un.p0, rn));
  echo[o + 14u] = bitcast<u32>(far(un.p1, rn));
  echo[o + 15u] = bitcast<u32>(far(un.p2, rn));
  echo[o + 16u] = bitcast<u32>(far(un.p3, rn));
  echo[o + 17u] = bitcast<u32>(far(un.p4, rn));
  echo[o + 18u] = bitcast<u32>(grow(un, rn));
  echo[o + 19u] = a;
}
`;

export const INSTANCE_PROBE_WGSL = /* wgsl */ `
${COMMON}
${INSTANCE_DECLARATIONS}
// The records as the instance cull declared them until 2026-10-16.
struct OldInstance {
  center: vec3f,
  radius: f32,
  c0: vec4f,
  c1: vec4f,
  c2: vec4f,
  owner: u32,
  _a: u32,
  _b: u32,
  _c: u32,
}
// The set's head as scalars; the scan's three \`vec4u\`s after it went at X3.5b.
struct OldSet {
  start: u32,
  end: u32,
  ramp: f32,
  rigged: u32,
}
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(5) var<storage, read> sets: array<Set>;
@group(0) @binding(9) var<storage, read> oldSets: array<OldSet>;
@group(0) @binding(11) var<storage, read> oldInstances: array<OldInstance>;

// An instance's inputs to a test, however they were read.
struct R {
  at: vec3f,
  radius: f32,
  ramp: f32,
  rigged: bool,
}

fn rOld(i: u32) -> R {
  let inst = oldInstances[i];
  let s = oldSets[inst.owner];
  return R(inst.center, inst.radius, s.ramp, s.rigged != 0u);
}

fn rNew(i: u32) -> R {
  let inst = instances[i];
  let s = sets[inst.refs.x].head;
  return R(inst.sphere.xyz, inst.sphere.w, bitcast<f32>(s.z), s.w != 0u);
}

fn grow(u: U, r: R) -> f32 {
  return r.radius + r.ramp * u.rampReach + select(0.0, u.rigReach, r.rigged) + SLACK;
}

fn far(p: vec4f, r: R) -> f32 {
  return dot(p.xyz, r.at) + p.w;
}

fn decide(u: U, r: R) -> u32 {
  let d = r.at - u.eye;
  let d2 = dot(d, d);
  let near = max(0.0, sqrt(d2) - r.radius);
  if (near * near > u.reach2) { return 1u; }
  if (u.gate && d2 > 1.0) {
    let w = 2.0 * r.radius * u.perRad;
    if (w * w < u.px2 * d2) { return 2u; }
  }
  let g = -grow(u, r);
  if (far(u.p0, r) < g) { return 3u; }
  if (far(u.p1, r) < g) { return 4u; }
  if (far(u.p2, r) < g) { return 5u; }
  if (far(u.p3, r) < g) { return 6u; }
  if (far(u.p4, r) < g) { return 7u; }
  return 0u;
}

@compute @workgroup_size(${PROBE_SIZE})
fn probe(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let i = gid.y * nw.x * ${PROBE_SIZE}u + gid.x;
  if (i >= itemCount()) { return; }
  if (i == 0u) { echoUniform(); }
  let uo = uOld();
  let un = uNew();
  let ro = rOld(i);
  let rn = rNew(i);
  let a = decide(uo, ro);
  let d = decide(un, rn);
  var m = 0u;
  if (a == 0u) { m = m | 1u; }
  if (decide(un, ro) == 0u) { m = m | 2u; }
  if (decide(uo, rn) == 0u) { m = m | 4u; }
  if (d == 0u) { m = m | 8u; }
  mask[i] = m;
  let o = i * ${ECHO_WORDS}u;
  put3(o, ro.at);
  echo[o + 3u] = bitcast<u32>(ro.radius);
  put3(o + 4u, rn.at);
  echo[o + 7u] = bitcast<u32>(rn.radius);
  echo[o + 8u] = d;
  echo[o + 9u] = bitcast<u32>(far(un.p0, rn));
  echo[o + 10u] = bitcast<u32>(far(un.p1, rn));
  echo[o + 11u] = bitcast<u32>(far(un.p2, rn));
  echo[o + 12u] = bitcast<u32>(far(un.p3, rn));
  echo[o + 13u] = bitcast<u32>(far(un.p4, rn));
  echo[o + 14u] = bitcast<u32>(grow(un, rn));
  echo[o + 15u] = a;
}
`;
