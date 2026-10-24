/**
 * render/lampDepth.ts — The lamps' DEPTH program: what a tile of the lamps'
 * atlas records of a caster, declared for our renderer (`BABYLON_EXIT.md`
 * X3.6b) — `LocalShadows`' own `localShadowDepth` shader, in the pulled form
 * the cel stage and the directional depth program (`render/celDepth.ts`)
 * share — in its two forms: a fixture's STATIC face, drawn over the world's
 * groups with the tile a uniform, and the PROXIES, a unit box drawn once an
 * instance with the tile its instance's.
 * Owns: `MAX_TILES`, the most tiles an atlas holds; `LAMP_BLOCK` (the face
 * records and the atlas's shape, group 0 of both forms) and
 * `LAMP_FACE_BLOCK` (the tile a static face is drawn into, group 0's second
 * binding there); the proxies' geometry (group 1, `PROXY_GEOMETRY`) and the
 * box's 36 corners as its draw reads them (`proxyBoxPositions`); `lampDepth`
 * and `lampProxyDepth`, each form's two modules; `faceInputs`, a face record
 * as the view-projection its casters are culled with.
 * Invariants: it writes what Babylon's wrote, number for number — the face's
 * own perspective scaled and offset into its tile (affine in `w`, so it
 * commutes with the divide), a fragment outside the face's frustum
 * discarded (the per-tile clip the hardware cannot make once tiles share a
 * target), and the RADIAL distance to the light over its range into the
 * colour's first channel — and reads only a vertex's POSITION, so nothing
 * sways a caster, as Babylon's depth material never ran the cel vertex body;
 * a static face decodes an index and builds `world` exactly as the cel stage
 * does (`pulledWorld`), and a proxy's `world` is its instance's matrix as
 * Babylon laid it out (`Matrix.m`, a column every four floats as WGSL
 * reads it); the face record's layout (four vec4s a tile: light and range,
 * forward and the tangent of half the field, right and the tile, up and the
 * near plane) is `LocalShadows.writeFaces`', which fills it, and the face
 * order and frames are `celShadow`'s `localLayer`, which reads the tiles.
 * Never: imports Babylon; restates the cel stage's decode; decides a face —
 * the records are handed in.
 * Contract: `docs/rendering.md`, "The lamps' shadows" and "Our renderer's
 * frame".
 */
import { createBox } from "../geometry/primitives";
import { depthGeometry } from "./celDepth";
import { pulledWorld } from "./celVertex";
import { SHADOW_TARGETS } from "./targets";
import {
  assembleFragment,
  assembleVertex,
  type AssembledModule,
  type AssembledVertex,
  type Binding,
  type VertexProgram,
} from "./wgsl/assemble";

/**
 * The most tiles any rung's atlas holds. It sizes the face records' array,
 * so it is a compile-time literal; `LocalShadows` checks every rung fits.
 */
export const MAX_TILES = 64;

/** Group 0 of both forms: four vec4s a tile of face records, and (tiles per row, a tile's side in UV). */
export const LAMP_BLOCK = {
  kind: "uniform",
  var: "lamp",
  struct: "LampFaces",
  fields: [
    { name: "faces", type: "vec4f", count: MAX_TILES * 4 },
    { name: "atlasShape", type: "vec4f" },
  ],
} as const satisfies Binding;

/** Group 0's second binding in a static face's form: the tile it is drawn into, as a float, as Babylon's was. */
export const LAMP_FACE_BLOCK = {
  kind: "uniform",
  var: "face",
  struct: "LampFace",
  fields: [{ name: "faceTile", type: "f32" }],
} as const satisfies Binding;

/** Group 1 of the proxies' form: the box's corners, and each instance's matrix and tile. */
export const PROXY_GEOMETRY = [
  { kind: "storage", name: "boxPositions", type: "array<f32>" },
  { kind: "storage", name: "proxyMatrices", type: "array<vec4f>" },
  { kind: "storage", name: "proxyTiles", type: "array<f32>" },
] as const satisfies readonly Binding[];

/** The box's triangles, a corner each: one proxy draws this many vertices. */
export const PROXY_CORNERS = 36;

/**
 * The unit box Babylon's proxy was (`MeshBuilder.CreateBox`, size 1 — the
 * kit's `createBox`, which is its vertex data number for number), unrolled
 * into its 36 triangle corners in index order, so a proxy's vertex is its
 * corner and its winding is the box's.
 */
export function proxyBoxPositions(): Float32Array {
  const box = createBox({ width: 1, height: 1, depth: 1 });
  const out = new Float32Array(box.indices.length * 3);
  for (let i = 0; i < box.indices.length; i++) {
    const v = box.indices[i] * 3;
    out[i * 3] = box.positions[v];
    out[i * 3 + 1] = box.positions[v + 1];
    out[i * 3 + 2] = box.positions[v + 2];
  }
  return out;
}

const LAMP_VARYINGS = [
  { name: "vFace", type: "vec3f" },
  { name: "vPosW", type: "vec3f" },
  { name: "vLight", type: "vec4f" },
] as const;

/** `localShadowDepth`'s vertex stage, both forms: the tile is `uniforms.faceTile` in each. */
const LAMP_VERTEX_BODY = `
fn lampVertex() {
  let wp = uniforms.world * vec4f(vertexInputs.position, 1.0);
  let k = i32(uniforms.faceTile + 0.5) * 4;
  let l = uniforms.faces[k];
  let f = uniforms.faces[k + 1];
  let r = uniforms.faces[k + 2];
  let u = uniforms.faces[k + 3];
  let d = wp.xyz - l.xyz;
  // The face's own perspective: x and y over w are the face coordinates, and
  // the depth runs 0..1 from the near plane to the light's range.
  let x = dot(d, r.xyz) / f.w;
  let y = dot(d, u.xyz) / f.w;
  let w = dot(d, f.xyz);
  let z = (w - u.w) * l.w / (l.w - u.w);
  // Scaled and offset into the tile: clip = (origin * 2 - 1 + side) * w +
  // face * side, which is the tile's UV rectangle read as clip space.
  let row = floor(r.w / uniforms.atlasShape.x);
  let col = r.w - row * uniforms.atlasShape.x;
  let side = uniforms.atlasShape.y;
  let o = vec2f(col, row) * side;
  vertexOutputs.position = vec4f(
    (o.x * 2.0 - 1.0 + side) * w + x * side,
    (o.y * 2.0 - 1.0 + side) * w + y * side,
    z,
    w);
  vertexOutputs.vFace = vec3f(x, y, w);
  vertexOutputs.vPosW = wp.xyz;
  vertexOutputs.vLight = l;
}
`;

/** `localShadowDepth`'s fragment stage, both forms. */
const LAMP_FRAGMENT_BODY = `
fn lampSurface() -> vec4f {
  // Outside this face's frustum is another face's tile: the per-tile clip the
  // hardware cannot do once six faces share one render target.
  let f = fragmentInputs.vFace;
  if (abs(f.x) > f.z || abs(f.y) > f.z) {
    discard;
  }
  let dist = length(fragmentInputs.vPosW - fragmentInputs.vLight.xyz);
  return vec4f(dist / fragmentInputs.vLight.w, 0.0, 0.0, 1.0);
}
`;

/** A static face's vertex stage over the world's arrays, or with the list's `stride` its scatter twin. */
function faceProgram(stride: number | null): VertexProgram {
  return {
    label: stride === null ? "lamp-depth-vertex" : "lamp-depth-vertex-scatter",
    groups: [[LAMP_BLOCK, LAMP_FACE_BLOCK], depthGeometry(stride)],
    attributes: [{ name: "position", type: "vec3f", from: "positionData" }],
    varyings: LAMP_VARYINGS,
    includes: {},
    body: LAMP_VERTEX_BODY,
    entry: "lampVertex",
    ...pulledWorld(stride),
  };
}

/** The proxies' vertex stage: a corner of the box, at its instance's matrix, into its instance's tile. */
const PROXY_PROGRAM: VertexProgram = {
  label: "lamp-proxy-vertex",
  groups: [[LAMP_BLOCK], PROXY_GEOMETRY],
  attributes: [{ name: "position", type: "vec3f", from: "boxPositions" }],
  varyings: LAMP_VARYINGS,
  includes: {},
  body: LAMP_VERTEX_BODY,
  entry: "lampVertex",
  privates: [
    {
      var: "instance",
      struct: "LampProxy",
      fields: [
        { name: "world", type: "mat4x4f" },
        { name: "faceTile", type: "f32" },
      ],
    },
  ],
  pull: {
    vertex: "vertex",
    decode: [`  let vertex = vertexIndex % ${PROXY_CORNERS}u;`, `  let drawnAt = vertexIndex / ${PROXY_CORNERS}u;`].join("\n"),
  },
  prelude: [
    "  let m = drawnAt * 4u;",
    "  instance.world = mat4x4f(proxyMatrices[m], proxyMatrices[m + 1u], proxyMatrices[m + 2u], proxyMatrices[m + 3u]);",
    "  instance.faceTile = proxyTiles[drawnAt];",
  ].join("\n"),
};

/** The fragment stage both forms share, assembled once. */
let fragment: AssembledModule | null = null;
function lampFragment(): AssembledModule {
  return (fragment ??= assembleFragment(
    {
      label: "lamp-depth-fragment",
      groups: [],
      varyings: LAMP_VARYINGS,
      includes: {},
      body: LAMP_FRAGMENT_BODY,
      surface: "lampSurface",
    },
    [],
    SHADOW_TARGETS,
  ));
}

/** Each stride's static-face vertex module, assembled once. */
const faces = new Map<string, AssembledVertex>();

/**
 * A static face's depth program for the atlas's pass (`SHADOW_TARGETS`, which
 * the atlas is): the plain stage, or the scatter twin for `stride`.
 */
export function lampDepth(stride: number | null): { vertex: AssembledVertex; fragment: AssembledModule } {
  const key = String(stride);
  let vertex = faces.get(key);
  if (!vertex) faces.set(key, (vertex = assembleVertex(faceProgram(stride), [], SHADOW_TARGETS)));
  return { vertex, fragment: lampFragment() };
}

/** The proxies' module, assembled once. */
let proxy: AssembledVertex | null = null;

/** The proxies' depth program for the atlas's pass. */
export function lampProxyDepth(): { vertex: AssembledVertex; fragment: AssembledModule } {
  return { vertex: (proxy ??= assembleVertex(PROXY_PROGRAM, [], SHADOW_TARGETS)), fragment: lampFragment() };
}

/**
 * Tile `t`'s face record in `faces` as the view-projection its casters are
 * culled with — 16 floats into `out` as WGSL's `mat4x4f` reads them: the
 * clip position the vertex stage computes BEFORE it is offset into the tile,
 * so its four side planes are the face's frustum and its eye plane the
 * light's. The reach is the light's range, written beside it: the cull
 * tests it against a cluster's BLOCK, and a block wholly past it holds only
 * casters that store a distance over 1, which shadows no receiver, since
 * the lookup is only asked inside the range — Babylon's bake skipped a MESH
 * by the same test (`LocalShadows.reaches`), so past the range the two may
 * store different values over 1, which read alike.
 */
export function faceInputs(faces: Float32Array, t: number, out: Float32Array): void {
  const o = t * 16;
  const lx = faces[o];
  const ly = faces[o + 1];
  const lz = faces[o + 2];
  const range = faces[o + 3];
  const fx = faces[o + 4];
  const fy = faces[o + 5];
  const fz = faces[o + 6];
  const th = faces[o + 7];
  const rx = faces[o + 8];
  const ry = faces[o + 9];
  const rz = faces[o + 10];
  const ux = faces[o + 12];
  const uy = faces[o + 13];
  const uz = faces[o + 14];
  const near = faces[o + 15];
  // x = dot(p - l, r) / th, y = dot(p - l, u) / th, w = dot(p - l, f),
  // z = (w - near) * range / (range - near): a column a coordinate of p.
  const k = range / (range - near);
  const lf = lx * fx + ly * fy + lz * fz;
  out[0] = rx / th;
  out[1] = ux / th;
  out[2] = fx * k;
  out[3] = fx;
  out[4] = ry / th;
  out[5] = uy / th;
  out[6] = fy * k;
  out[7] = fy;
  out[8] = rz / th;
  out[9] = uz / th;
  out[10] = fz * k;
  out[11] = fz;
  out[12] = -(lx * rx + ly * ry + lz * rz) / th;
  out[13] = -(lx * ux + ly * uy + lz * uz) / th;
  out[14] = (-lf - near) * k;
  out[15] = -lf;
}
