/**
 * flame.ts — The geometry of an open fire: a ring of outer tongues and the
 * whips over them, a core inside them, embers at the bed and a bounds marker,
 * as ONE vertex-data block for `FlameMaterial` to animate.
 * Owns: the tongue profile, the layout of a fire's tongues and
 * embers, and the UV vocabulary `shaders/FlameShader.ts` decodes — layer in
 * `uv.x`'s whole part, a seed in its fraction; height up the tongue (or an
 * ember's phase) in `uv.y`'s fraction-of-four, and the FIRE'S HEIGHT in whole
 * centimetres in the rest of it (`packHeight`). The two files must agree on
 * it and nothing else reads it.
 * Invariants: built at the origin with the bed at y = 0, so it merges like
 * every other part; deterministic (no rng — a fire's variety is the shader's,
 * phased off world position); the OUTER tongues are wound inside out, which
 * is what shows the core over them (see the shader's header). Every mesh made from it is `noInk` and
 * `noShadowCaster` — it moves, and a moving caster turns the world's shadow
 * map into a per-frame redraw.
 */
import {
  CreateCylinderVertexData,
  CreateIcoSphereVertexData,
  Matrix,
  Mesh,
  VertexData,
  type Scene,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { partSurface } from "./parts";

/** How a fire is sized. The bed is at y = 0 and the flame stands on it. */
export interface FlameSpec {
  /** Radius of the ring the outer tongues stand in, metres. */
  radius: number;
  /** Height of the tallest tongue at rest, metres (the lick adds to it). */
  height: number;
  /** Embers riding up out of it. Default 8; a small fire wants fewer. */
  embers?: number;
}

const LAYER_OUTER = 0;
const LAYER_CORE = 1;
const LAYER_EMBER = 2;
const LAYER_BOUNDS = 3;

/** Rings up a tongue: enough for the writhe to bend it in an S and hook its tip. */
const RINGS = 9;
/** Sides round a tongue — enough that the bitten silhouette hides the polygon. */
const SIDES = 10;
/** Under this height (metres) a fire is a WICK: one tongue and one core. */
const WICK = 0.2;

/**
 * A tongue's radius at height `t` (0 root, 1 tip) as a share of its widest:
 * full a little above the root, then a long drawn neck to a point — the
 * brush's stroke rather than a teardrop.
 */
function profile(t: number): number {
  return Math.pow(1 - t, 1.1) * (0.85 + 1.1 * t * (1 - t));
}

/**
 * `uv.y` for a point `t` up a fire `h` metres tall: the height in whole
 * centimetres, times four, plus `t` — which the shader splits apart again so
 * that every distance in the motion can be a share of the fire's own size.
 */
function packHeight(t: number, h: number): number {
  return t + 4 * Math.max(1, Math.round(h * 100));
}

/**
 * One tongue, root at the origin: `r` its widest radius, `h` its height, `H`
 * the height of the FIRE it belongs to. The cylinder builder's indices are
 * kept for their winding and everything else is rewritten.
 */
function tongue(
  r: number,
  h: number,
  H: number,
  layer: number,
  seed: number,
  inward: boolean,
): VertexData {
  const vd = CreateCylinderVertexData({
    height: 1,
    diameter: 1,
    tessellation: SIDES,
    subdivisions: RINGS,
    cap: Mesh.NO_CAP,
  });
  const pos = vd.positions!;
  const uvs = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i < pos.length; i += 3) {
    const t = pos[i + 1] + 0.5;
    const k = 2 * r * profile(t);
    pos[i] *= k;
    pos[i + 2] *= k;
    pos[i + 1] = t * h;
    uvs[(i / 3) * 2] = layer + seed;
    uvs[(i / 3) * 2 + 1] = packHeight(t, H);
  }
  vd.uvs = uvs;
  if (inward) {
    const idx = vd.indices!;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = a;
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, vd.indices!, normals);
  vd.normals = normals;
  return vd;
}

/**
 * The vertex data for one fire. The outer ring is a fat central tongue with
 * six shorter ones leaning out of it at uneven heights and two thin WHIPS
 * standing over it, so the top edge is a crown of licks rather than one point;
 * the core is three narrower tongues inside. A wick is one of each.
 */
export function flameData(spec: FlameSpec): VertexData {
  const { radius: R, height: H } = spec;
  const f = CONFIG.graphics.flame;
  const parts: VertexData[] = [];
  const place = (vd: VertexData, x: number, z: number, lean = 0, bearing = 0): VertexData => {
    vd.transform(
      Matrix.RotationZ(lean)
        .multiply(Matrix.RotationY(bearing))
        .multiply(Matrix.Translation(x, 0, z)),
    );
    return vd;
  };
  const wick = H < WICK;

  // The outer ring. Seeds are spread so no two tongues share a phase.
  parts.push(tongue(R * 0.72, H, H, LAYER_OUTER, 0.05, true));
  if (!wick) {
    // Nearly upright: a ring splayed outward reads as a crown or a flower,
    // where a fire's tongues rise together and part only at the tips.
    const ring = [0.84, 0.62, 0.76, 0.58, 0.72, 0.66];
    for (let i = 0; i < ring.length; i++) {
      const a = (i / ring.length) * Math.PI * 2 + 0.4;
      const d = R * 0.46;
      parts.push(
        place(
          tongue(R * 0.4, H * ring[i], H, LAYER_OUTER, 0.15 + i * 0.11, true),
          Math.cos(a) * d,
          Math.sin(a) * d,
          -0.1,
          -a,
        ),
      );
    }
    // The whips: thin, and taller than the body, so the crown is spiked.
    for (const [a, hs, s] of [
      [1.1, 1.25, 0.83],
      [3.9, 1.1, 0.91],
    ] as const) {
      const d = R * 0.26;
      parts.push(
        place(tongue(R * 0.2, H * hs, H, LAYER_OUTER, s, true), Math.cos(a) * d, Math.sin(a) * d, -0.12, -a),
      );
    }
  }

  // The core: inside the ring, shorter, and wound the right way out.
  parts.push(tongue(R * 0.45, H * 0.62, H, LAYER_CORE, 0.1, false));
  if (!wick) {
    parts.push(place(tongue(R * 0.3, H * 0.48, H, LAYER_CORE, 0.6, false), R * 0.22, -R * 0.14));
    parts.push(place(tongue(R * 0.26, H * 0.4, H, LAYER_CORE, 0.35, false), -R * 0.2, R * 0.16));
  }

  // Embers, stood round the bed; each one's phase offset is its own.
  const er = f.embers.radius;
  const count = spec.embers ?? 8;
  for (let i = 0; i < count; i++) {
    const vd = CreateIcoSphereVertexData({ radius: er, subdivisions: 1, flat: false });
    const a = i * 2.39996;
    const d = R * (0.25 + 0.5 * ((i * 0.618) % 1));
    const seed = ((i + 1) * 0.3819) % 1;
    const n = vd.positions!.length / 3;
    const uvs = new Float32Array(n * 2);
    for (let v = 0; v < n; v++) {
      uvs[v * 2] = LAYER_EMBER + seed * 0.99;
      uvs[v * 2 + 1] = packHeight(i / count, H);
    }
    vd.uvs = uvs;
    parts.push(place(vd, Math.cos(a) * d, Math.sin(a) * d));
  }

  // The bounds: a zero-area triangle across the diagonal of everything the
  // lean, the lick, the hook and the embers can reach.
  const reach = R + H * Math.max(f.embers.drift * 3, f.lean + f.writhe + f.hook);
  const top = H * (1.25 + f.lick + f.embers.rise);
  const bounds = new VertexData();
  bounds.positions = [-reach, 0, -reach, reach, top, reach, 0, top / 2, 0];
  bounds.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0];
  bounds.uvs = [LAYER_BOUNDS, 0, LAYER_BOUNDS, 0, LAYER_BOUNDS, 0];
  bounds.indices = [0, 1, 2];
  parts.push(bounds);

  const out = parts[0];
  out.merge(parts.slice(1), true);
  return out;
}

/**
 * A fire as a PART (`parts.ts`): for the building kit, whose parts are merged
 * and uploaded by the block merge. Wears the factory's one flame material.
 */
export function flamePart(
  name: string,
  spec: FlameSpec,
  scene: Scene,
  mats: CelMaterialFactory,
): Mesh {
  const mesh = partSurface(name, flameData(spec), scene);
  mesh.material = mats.getFlame();
  mesh.metadata = { noInk: true, noShadowCaster: true };
  return mesh;
}
