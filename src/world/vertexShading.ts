/**
 * vertexShading.ts — The world's baked vertex-colour buffer, written once per
 * map build from the collider boxes and the terrain: ambient occlusion in the
 * ALPHA, the world mark in the GREEN, the wind's sway weight in the RED.
 * Owns: the occlusion estimate, the sway ramp, and the vertex-colour write.
 * Owns no geometry and no materials; `MapBuilder` calls it, `world/sway.ts`
 * says what a mesh's weight means and `CelShader` reads what it wrote.
 * Invariants: AO lives in the ALPHA and 1.0 means UNOCCLUDED (see below — the
 * whole design rests on it), every channel's NEUTRAL value is the GL default
 * of the disabled attrib, the walk runs AFTER every merge, only CEL-SHADED
 * meshes are written to (see the guard in `walk`), and `hasVertexAlpha` must
 * stay false. Contract: `docs/rendering.md`.
 *
 * **Three channels, one walk, and one reason they share a file.** Each is a
 * per-vertex quantity that can only be known once the merges are done and that
 * has to be derived from where a vertex ENDED UP rather than from what it was
 * built as — see the merge argument below, which is the same argument for all
 * three. Splitting them would mean walking a few hundred thousand vertices
 * twice and re-uploading the same buffer to say two things about it.
 *
 * WHY. The renderer had four light terms and no occlusion of any kind, and no
 * depth or geometry buffer to do it screen-space with. Nothing was grounded: a
 * cottage met the street with no darkening at all, an archway was as bright
 * inside as out, and the underside of a deck took the same sky fill as its top.
 * Flat cel colours make that worse rather than better, because there is no
 * texture detail for the eye to read depth from instead.
 *
 * AO IN THE ALPHA CHANNEL, AND WHY THAT IS THE WHOLE TRICK. Adding a vertex
 * attribute to the cel shader means every mesh drawn with a cel material has to
 * supply it — the pooled bot rigs, the viewmodel's forty pieces, the grenades,
 * the death cam's stand-in body — or it reads the DISABLED generic attrib,
 * whose GL default is `(0, 0, 0, 1)`. RGB comes back 0, which is not neutral for
 * anything multiplied. Alpha comes back **1**, which is exactly "unoccluded".
 *
 * So the world is the only thing that carries a colour buffer, everything else
 * is correct by construction, and the shader needs no define, no second cache
 * variant, no fourth `cel-<variant>-#rrggbb` name for `outlineInkFor`'s regex to
 * learn, and no branch. `docs/rendering.md` spells out what a fourth variant
 * costs; this design does not pay it.
 *
 * The green channel is the other half of that: it is 1 on baked world geometry
 * and 0 (the same generic default) everywhere else, so a shader term that must
 * apply to the WORLD and not to a walking bot has a mask for free. `CelShader`'s
 * albedo variation is the one that uses it.
 *
 * The RED channel is the third, and it is the same trick a third time: it is
 * how much of the wind's travel a vertex is entitled to, and its neutral value
 * — 0, meaning planted — is the generic default again. So every rig, the
 * viewmodel, every grenade and every effect mesh stands perfectly still in a
 * gale without carrying a byte, and the shader needs no define and no branch it
 * would not have taken anyway. `world/sway.ts` owns what the number MEANS; this
 * file owns where it lands.
 *
 * AFTER THE MERGE, NEVER BEFORE. `VertexData.merge` throws outright —
 * "Cannot merge vertex data that do not have the same set of attributes" — the
 * moment one mesh in a group has `colors` and another does not, and
 * `mergeByMaterial` passes `disposeSource = true`, which is what turns Babylon's
 * attribute-aligning path off. Baking per structure and then merging would work
 * only while every mesh in every group happened to be baked. Baking last cannot
 * fail that way.
 *
 * It also buys the property that makes a positional estimate legitimate: two
 * meshes that meet at a corner are in DIFFERENT merge groups (the merge is per
 * colour), and a vertex is shaded from where it is rather than from what it
 * belongs to — so the two sides of that corner agree, and there is no seam.
 *
 * ANALYTIC, NOT RAY-TRACED. A hemisphere of rays per vertex against ~750 boxes
 * is not affordable against a map build already costing ~570 ms. Each vertex
 * instead asks the handful of boxes near it for their closest point and weights
 * that by how far away it is and how squarely it faces the surface, plus one
 * term for the ground plane underneath. It is not a solution to the rendering
 * equation and does not need to be — the output is a soft darkening in creases,
 * and every error is smooth.
 *
 * MEASURED, on Hollowmere. The bake is **128,107 vertices in 71 ms**, against a
 * map build already costing ~570 ms, and it is linear in vertex count and in
 * the boxes each vertex can reach. Alpha comes out across the full [0.45, 1]
 * the strength allows, so the estimate is using its range rather than crowding
 * one end. Against the same frame with every alpha rewritten to 1 — which is
 * exactly "no occlusion", so it is an A/B with no rebuild — it moves 2.8% of
 * the pixels in a street view and 5.4% in a lantern-lit one, peaking at 27/255.
 * That reads small and is not: the term multiplies the two DIMMEST lights in
 * the scene, so the pixels it can move are dark ones, where 27 counts.
 *
 * The confirmation that matters more is the negative one. 392 pooled rig meshes
 * and the viewmodel's 100 carry no colour buffer at all, and render unchanged —
 * which is the alpha default doing its job. Had it been wrong they would not
 * have been subtly off; they would have been BLACK, so one frame with a bot in
 * it is the whole test.
 *
 * **Per-vertex is per-vertex.** A cottage wall is a box, so the occlusion is
 * interpolated across the whole face from four corners: what this produces is a
 * broad ambient gradient down a wall, not a tight contact band at its foot. That
 * is the honest limit of the technique on geometry this coarse, and tessellating
 * the world to sharpen it would cost far more than the effect is worth.
 */
import { Mesh, ShaderMaterial, VertexBuffer } from "@babylonjs/core";
import { CONFIG } from "../config";
import {
  halfDepth,
  type LocalXZ,
  rotateToLocalXZ,
  slabThickness,
} from "./boxGeometry";
import { type BoxIndex, boxesNear, buildBoxIndex } from "./boxIndex";
import type { WorldBox } from "./MapBuilder";
import { swayLayerOf, swayWeight } from "./sway";
import type { TerrainField } from "./TerrainField";

/** Scratch for the box-frame transform; the bake runs it per vertex per box. */
const localScratch: LocalXZ = { lx: 0, lz: 0 };

/**
 * The grid is `boxIndex.ts`'s, whose header carries the reasoning: the pad is
 * paid at insert, so a query reads ONE bucket and is still complete. Do not
 * "fix" that into a 3x3 loop — nine times the work for the same answer.
 *
 * It is built here rather than shared with `ObstacleField` because that one is
 * constructed after this runs and exposes only its own push-out query.
 */

/**
 * A box whose closest point lands nearer than this is treated as the vertex's
 * OWN geometry and skipped.
 *
 * Every visual has a collider standing where it stands — that is the
 * visual/collider contract — so the box a wall's own vertices sit on is always
 * at distance ~0, and without this every outward-facing surface in the village
 * would occlude itself to black. The value is the alignment slack between a
 * visual and its proxy, not a tuning knob.
 */
const SELF = 0.08;

/**
 * The shared grid, plus the local half-extents this pass alone needs.
 *
 * The bucketing used to live here in full; it is now `boxIndex.ts`, because
 * `GrassSystem.scatter` and `MapBuilder.findSpot` were asking the same question
 * by walking all 800 boxes. What stays is the half-extent table, which is
 * occlusion's own reading of a box (the pitch is folded in rather than rotated
 * for) and means nothing to the other two.
 */
interface Bucketed {
  index: BoxIndex;
  /** Local half-extents, precomputed: the pitch makes these non-obvious. */
  half: { x: number; y: number; z: number }[];
}

/** Indexes the collider boxes for the radius query below. */
function bucket(boxes: readonly WorldBox[], size: number, radius: number): Bucketed {
  const index = buildBoxIndex(boxes, size, radius);
  const half = index.boxes.map((box) => {
    // Local half-extents. Depth and height both grow with the pitch: a tilted
    // slab covers more ground than its depth and stands taller than its height,
    // and `boxGeometry` already owns both of those conversions.
    const sin = Math.abs(Math.sin(box.rotX));
    return {
      x: box.w / 2,
      y: slabThickness(box) / 2 + (box.d / 2) * sin,
      z: halfDepth(box),
    };
  });
  return { index, half };
}

/**
 * How much of `p`'s hemisphere the nearby boxes and the ground take away.
 *
 * Each occluder contributes `facing * nearness`: `facing` is how squarely it
 * sits in front of the surface (a box behind the plane cannot occlude it), and
 * `nearness` falls smoothly to nothing at the radius, so a box drifting out of
 * range never pops.
 */
function occlusionAt(
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
  index: Bucketed,
  terrain: TerrainField,
  radius: number,
): number {
  let occ = 0;

  const list = boxesNear(index.index, px, pz);
  if (list) {
    for (const i of list) {
      const box = index.index.boxes[i];
      const half = index.half[i];
      // Into the box's yaw frame; the pitch is folded into the half-extents
      // above rather than rotated for, because an occlusion estimate does not
      // need a ramp's exact face — only roughly where its bulk is.
      const { lx, lz } = rotateToLocalXZ(box, px, pz, localScratch);
      const ly = py - box.cy;

      const qx = lx - Math.max(-half.x, Math.min(half.x, lx));
      const qy = ly - Math.max(-half.y, Math.min(half.y, ly));
      const qz = lz - Math.max(-half.z, Math.min(half.z, lz));
      const r = Math.hypot(qx, qy, qz);
      if (r < SELF || r > radius) continue;

      // Back to world for the facing test — only the yaw needs undoing, and
      // `rotateToLocalXZ` owns the sign convention, so this pair is its
      // world→local angles read back rather than a second opinion about which
      // way the box faces. Computed HERE rather than beside the transform, and
      // behind the same yaw test the helper makes: the range refusal above is
      // the common case, an unrotated box is the common shape, and the bucket
      // hands this loop every box whose reach the point falls in.
      let wx = qx;
      let wz = qz;
      if (box.rotY !== 0) {
        const c = Math.cos(-box.rotY);
        const s = Math.sin(-box.rotY);
        wx = qx * c - qz * s;
        wz = qx * s + qz * c;
      }
      // `q` points from the box's surface OUT to the vertex, so the occluder
      // lies along -q.
      const facing = -(nx * wx + ny * qy + nz * wz) / r;
      if (facing <= 0) continue;

      const t = r / radius;
      occ += facing * (1 - t * t);
    }
  }

  // The ground is not in the box list — the heightfield has no proxy box, by
  // the one documented exception to the collider contract — so it is added
  // analytically. It is also the term that matters most: a wall meeting the
  // street is the commonest crease in the map.
  const above = py - terrain.surfaceAt(px, pz, true);
  if (above > 0 && above < radius) {
    // Nothing for an up-facing surface, most for a face turned down into it.
    occ += (0.5 - ny * 0.5) * (1 - above / radius);
  }

  return occ;
}

/**
 * Writes a colour buffer onto every finished visual: `rgb = (0, 1, 0)` and
 * `a = ao`, where 1 is unoccluded.
 *
 * Returns the number of vertices shaded, which is the only number worth having
 * about the cost — everything here is linear in it.
 */
export function bakeVertexShading(
  meshes: readonly Mesh[],
  boxes: readonly WorldBox[],
  terrain: TerrainField,
  size: number,
): number {
  const cfg = CONFIG.ao;
  if (cfg.strength <= 0) return 0;
  // Glass occludes nothing: it is transparent while it stands and gone after,
  // and a pane that darkened the reveal it sits in would leave that shadow
  // painted on the wall once the round took the glass away. A `porous` fence is
  // NOT excluded here for the mirror reason — a rail casts a real ambient
  // shadow even though a round goes through it.
  const occluders = boxes.some((b) => b.glass)
    ? boxes.filter((b) => !b.glass)
    : boxes;
  const index = bucket(occluders, size, cfg.radius);
  let total = 0;

  const walk = (mesh: Mesh): void => {
    // **Only the cel shader may be given this buffer.** It is a lighting term
    // dressed as a vertex colour, and the one material in the tree that reads
    // it as a lighting term is the cel shader; `StandardMaterial` reads a
    // colour buffer as a COLOUR and multiplies its output by it, with
    // `Mesh.useVertexColors` defaulting to true and nothing to turn the
    // VERTEXCOLOR define off but the buffer's absence.
    //
    // `visuals` is not all cel materials. `mergeByMaterial` emits one mesh per
    // material, and every lit window, brazier flame, ember and sign in the map
    // comes out of it as a `block<x>,<y>-emissive-#rrggbb-noOutline` drawn
    // with an unlit emissive `StandardMaterial` — 42 of them on Hollowmere.
    // Writing `rgb = (0, 1, 0)` onto those multiplied every one by pure green:
    // the village's lanterns and fires rendered as green blobs inside their own
    // correctly-coloured bloom, since `GlowLayer` builds its halo from
    // `material.emissiveColor` and never saw the vertex buffer.
    if (!(mesh.material instanceof ShaderMaterial)) return;

    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
    if (!positions || !normals) return;

    // Merged blocks sit at identity and merged structures do not, and the
    // terrain blocks are placed as well — so nothing may assume, and the matrix
    // is recomputed rather than read off a possibly stale cache.
    const world = mesh.computeWorldMatrix(true);
    const m = world.m;
    const count = positions.length / 3;
    const colors = new Float32Array(count * 4);
    // Read once per mesh, never per vertex: `mergeByMaterial` keys on the mark,
    // so a merged mesh is unanimously foliage or unanimously not — which is
    // also what lets the shader's branch be coherent. Null is every mesh in the
    // map that is not leaf, and it costs the loop one compare.
    const layer = swayLayerOf(mesh);

    for (let i = 0; i < count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const px = m[0] * x + m[4] * y + m[8] * z + m[12];
      const py = m[1] * x + m[5] * y + m[9] * z + m[13];
      const pz = m[2] * x + m[6] * y + m[10] * z + m[14];

      const ax = normals[i * 3];
      const ay = normals[i * 3 + 1];
      const az = normals[i * 3 + 2];
      let nx = m[0] * ax + m[4] * ay + m[8] * az;
      let ny = m[1] * ax + m[5] * ay + m[9] * az;
      let nz = m[2] * ax + m[6] * ay + m[10] * az;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      const occ = occlusionAt(px, py, pz, nx, ny, nz, index, terrain, cfg.radius);
      const ao = 1 - Math.min(1, occ) * cfg.strength;
      // Height above the GROUND under this vertex, not above sea level: the
      // valley falls two metres under a stand of trees and dips to -1.34 in a
      // riverbed, and a ramp measured from y = 0 would plant the ferns on one
      // bank and let the ones on the other slide.
      colors[i * 4] = layer
        ? swayWeight(py - terrain.heightAt(px, pz), layer)
        : 0;
      colors[i * 4 + 1] = 1;
      colors[i * 4 + 2] = 0;
      colors[i * 4 + 3] = ao;
    }

    mesh.setVerticesData(VertexBuffer.ColorKind, colors, false);
    // Writing a colour buffer does not set this by itself, and it must not
    // become true: the world is opaque, and vertex alpha here is a lighting
    // term rather than a transparency.
    mesh.hasVertexAlpha = false;
    total += count;
  };

  for (const mesh of meshes) {
    walk(mesh);
    for (const child of mesh.getChildMeshes()) {
      if (child instanceof Mesh) walk(child);
    }
  }
  return total;
}
