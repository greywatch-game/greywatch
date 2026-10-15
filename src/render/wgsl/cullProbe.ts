/**
 * render/wgsl/cullProbe.ts — `?cullcheck`'s probes: each cull's test re-run on
 * the GPU in every FORM it has been written in, one bit of a mask a form, so
 * one reading on a device says which form its shader compiler gets wrong
 * (`render/CullCheck.ts`).
 * Owns: `CLUSTER_PROBE_WGSL`, `INSTANCE_PROBE_WGSL`, the forms each tests
 * (`CLUSTER_FORMS`, `INSTANCE_FORMS`) and `PROBE_SIZE`.
 * Invariants: each probe reads the buffers its cull reads, under the
 * declarations that cull USED to read them with (a `vec3f` beside a scalar,
 * which `clusterCull.ts` and `instanceCull.ts` no longer declare) — the same
 * bytes either way; the reach and the size gate are the cull's own, so a bit
 * differs from the cull's verdict only by the plane test's form; bit 0 is the
 * form the culls shipped with before `?cullcheck` (a loop over the uniform
 * array, the far corner by a vector `select`), the last the form they use now
 * (unrolled, the far corner by `abs`).
 * Never: writes anything but its mask; is built without the flag.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */

/** Threads in a probe workgroup. */
export const PROBE_SIZE = 64;

export const CLUSTER_FORMS = ["loop+select (as shipped)", "loop+abs", "unrolled+select", "unrolled+abs (now)"] as const;
export const INSTANCE_FORMS = ["loop (as shipped)", "unrolled (now)"] as const;

/** The uniform block as both culls declared it before `?cullcheck`. */
const LEGACY_CULL = /* wgsl */ `
struct Cull {
  planes: array<vec4f, 5>,
  eye: vec3f,
  reach2: f32,
  perRad: f32,
  px2: f32,
  gate: u32,
  rampReach: f32,
  bands2: vec3f,
  rigReach: f32,
  count: u32,
  _a: u32,
  _b: u32,
  _c: u32,
}
const SLACK: f32 = 0.05;
@group(0) @binding(0) var<uniform> cull: Cull;
@group(0) @binding(15) var<storage, read_write> mask: array<u32>;
`;

export const CLUSTER_PROBE_WGSL = /* wgsl */ `
${LEGACY_CULL}
struct Cluster {
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
struct Box {
  lo: vec3f,
  _a: f32,
  hi: vec3f,
  _b: f32,
}
@group(0) @binding(1) var<storage, read> clusters: array<Cluster>;
@group(0) @binding(2) var<storage, read> blocks: array<Box>;
@group(0) @binding(3) var<storage, read> spheres: array<vec4f>;

fn dist2(lo: vec3f, hi: vec3f) -> f32 {
  let d = max(max(lo - cull.eye, vec3f(0.0)), cull.eye - hi);
  return dot(d, d);
}

fn reachAndGate(c: Cluster) -> bool {
  let b = blocks[c.block];
  if (dist2(b.lo, b.hi) > cull.reach2) { return false; }
  if (cull.gate != 0u) {
    let s = spheres[c.surface];
    let d = s.xyz - cull.eye;
    let d2 = dot(d, d);
    if (d2 > 1.0) {
      let w = 2.0 * s.w * cull.perRad;
      if (w * w < cull.px2 * d2) { return false; }
    }
  }
  return true;
}

fn loopSelect(c: Cluster, grow: f32) -> bool {
  for (var k = 0u; k < 5u; k++) {
    let p = cull.planes[k];
    let far = select(c.lo, c.hi, p.xyz > vec3f(0.0));
    if (dot(p.xyz, far) + p.w < -grow) { return false; }
  }
  return true;
}

fn outAbs(p: vec4f, mid: vec3f, half: vec3f, grow: f32) -> bool {
  return dot(p.xyz, mid) + dot(abs(p.xyz), half) + p.w < -grow;
}

fn outSelect(p: vec4f, lo: vec3f, hi: vec3f, grow: f32) -> bool {
  let far = select(lo, hi, p.xyz > vec3f(0.0));
  return dot(p.xyz, far) + p.w < -grow;
}

fn loopAbs(c: Cluster, grow: f32) -> bool {
  let mid = 0.5 * (c.lo + c.hi);
  let half = 0.5 * (c.hi - c.lo);
  for (var k = 0u; k < 5u; k++) {
    if (outAbs(cull.planes[k], mid, half, grow)) { return false; }
  }
  return true;
}

fn unrolledSelect(c: Cluster, grow: f32) -> bool {
  return !(outSelect(cull.planes[0], c.lo, c.hi, grow) || outSelect(cull.planes[1], c.lo, c.hi, grow) ||
    outSelect(cull.planes[2], c.lo, c.hi, grow) || outSelect(cull.planes[3], c.lo, c.hi, grow) ||
    outSelect(cull.planes[4], c.lo, c.hi, grow));
}

fn unrolledAbs(c: Cluster, grow: f32) -> bool {
  let mid = 0.5 * (c.lo + c.hi);
  let half = 0.5 * (c.hi - c.lo);
  return !(outAbs(cull.planes[0], mid, half, grow) || outAbs(cull.planes[1], mid, half, grow) ||
    outAbs(cull.planes[2], mid, half, grow) || outAbs(cull.planes[3], mid, half, grow) ||
    outAbs(cull.planes[4], mid, half, grow));
}

@compute @workgroup_size(${PROBE_SIZE})
fn probe(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let i = gid.y * nw.x * ${PROBE_SIZE}u + gid.x;
  if (i >= cull.count) { return; }
  let c = clusters[i];
  var m = 0u;
  if (reachAndGate(c)) {
    let grow = c.ramp * cull.rampReach + select(0.0, cull.rigReach, c.rigged != 0u) + SLACK;
    if (loopSelect(c, grow)) { m = m | 1u; }
    if (loopAbs(c, grow)) { m = m | 2u; }
    if (unrolledSelect(c, grow)) { m = m | 4u; }
    if (unrolledAbs(c, grow)) { m = m | 8u; }
  }
  mask[i] = m;
}
`;

export const INSTANCE_PROBE_WGSL = /* wgsl */ `
${LEGACY_CULL}
struct Instance {
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
struct Set {
  start: u32,
  end: u32,
  ramp: f32,
  rigged: u32,
  base: vec4u,
  bandStart: vec4u,
  _pad: vec4u,
}
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(5) var<storage, read> sets: array<Set>;

fn reachAndGate(inst: Instance) -> bool {
  let d = inst.center - cull.eye;
  let d2 = dot(d, d);
  let near = max(0.0, sqrt(d2) - inst.radius);
  if (near * near > cull.reach2) { return false; }
  if (cull.gate != 0u && d2 > 1.0) {
    let w = 2.0 * inst.radius * cull.perRad;
    if (w * w < cull.px2 * d2) { return false; }
  }
  return true;
}

fn loopTest(inst: Instance, grow: f32) -> bool {
  for (var k = 0u; k < 5u; k++) {
    let p = cull.planes[k];
    if (dot(p.xyz, inst.center) + p.w < -grow) { return false; }
  }
  return true;
}

fn outside(p: vec4f, c: vec3f, grow: f32) -> bool {
  return dot(p.xyz, c) + p.w < -grow;
}

@compute @workgroup_size(${PROBE_SIZE})
fn probe(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let i = gid.y * nw.x * ${PROBE_SIZE}u + gid.x;
  if (i >= cull.count) { return; }
  let inst = instances[i];
  var m = 0u;
  if (reachAndGate(inst)) {
    let s = sets[inst.owner];
    let grow = inst.radius + s.ramp * cull.rampReach + select(0.0, cull.rigReach, s.rigged != 0u) + SLACK;
    if (loopTest(inst, grow)) { m = m | 1u; }
    let c = inst.center;
    if (!(outside(cull.planes[0], c, grow) || outside(cull.planes[1], c, grow) || outside(cull.planes[2], c, grow) ||
        outside(cull.planes[3], c, grow) || outside(cull.planes[4], c, grow))) { m = m | 2u; }
  }
  mask[i] = m;
}
`;
