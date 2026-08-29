/**
 * GrassSystem.ts — Grass fields built from the map's GrassRects: one tuft
 * mesh scattered as thousands of thin instances (a single draw call), plus
 * per-frame uploads of time/camera/point-lights/pushers to the grass shader.
 * Invariants: grass is VISUAL ONLY — unpickable, non-colliding, never
 * metadata.solid, no outline, no glow; ray tests and bots must not see it.
 * Blades are 1.0 tall in local space; instance matrices scale Y to real
 * height (the shader relies on position.y as the 0..1 bend weight). Scatter
 * is deterministic (seeded PRNG) so every client grows the same field.
 * update() runs after the camera and LightingSystem updates (shares the
 * same 16 light slots) — same frame-order rule as WaterSystem.
 */
import {
  Color3,
  type GlowLayer,
  Matrix,
  Mesh,
  Quaternion,
  Scene,
  type ShaderMaterial,
  Vector2,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Combatant } from "../entities/Combatant";
import {
  MAX_POINT_LIGHTS,
  type CelMaterialFactory,
  type PointLightData,
} from "../shaders/CelShader";
import { createGrassMaterial } from "../shaders/GrassShader";
import type { EnvironmentSpec } from "../world/environment";
import { type LocalXZ, rotateToLocalXZ } from "../world/boxGeometry";
import { type BoxIndex, boxesNear, buildBoxIndex } from "../world/boxIndex";
import type { GrassRect, WorldBox } from "../world/MapBuilder";
import { onRoad, type RoadRect } from "../world/roads";
import type { TerrainField } from "../world/TerrainField";
import { mulberry32 } from "../world/rng";

const MAX_PUSHERS = CONFIG.grass.maxPushers;

/**
 * Builds one tuft: `CONFIG.grass.bladesPerTuft` tapered strips arranged in a
 * rough ring, each leaning its own way. Blades are exactly 1.0 tall so the
 * shader can use local position.y as the bend weight, and instance matrices
 * supply the real height. Three triangles per blade: a root quad, a mid
 * quad, and a tip fan — enough joints for the vertex-shader bend to curve.
 */
function buildTuftVertexData(rng: () => number): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const blades = CONFIG.grass.bladesPerTuft;

  for (let i = 0; i < blades; i++) {
    const yaw = (i / blades) * Math.PI * 2 + rng() * 0.9;
    const radialX = Math.cos(yaw);
    const radialZ = Math.sin(yaw);
    const baseR = 0.03 + rng() * 0.11;
    const bx = radialX * baseR;
    const bz = radialZ * baseR;
    // Across the blade face, perpendicular to the radial direction.
    const ax = -radialZ;
    const az = radialX;
    const halfW0 = 0.028 + rng() * 0.014;
    const halfW1 = halfW0 * 0.55;
    // Static lean, mostly outward, so tufts read as tufts instead of fences.
    const leanYaw = yaw + (rng() - 0.5) * 1.2;
    const lean = 0.12 + rng() * 0.22;
    const lx = Math.cos(leanYaw) * lean;
    const lz = Math.sin(leanYaw) * lean;

    const base = positions.length / 3;
    // root pair, mid pair (leaning a little), tip point (full lean).
    positions.push(
      bx - ax * halfW0, 0, bz - az * halfW0,
      bx + ax * halfW0, 0, bz + az * halfW0,
      bx - ax * halfW1 + lx * 0.35, 0.55, bz - az * halfW1 + lz * 0.35,
      bx + ax * halfW1 + lx * 0.35, 0.55, bz + az * halfW1 + lz * 0.35,
      bx + lx, 1.0, bz + lz,
    );
    // One face normal per blade; the fragment stage flips facets toward it,
    // so two-sided blades light correctly from either side.
    for (let v = 0; v < 5; v++) normals.push(-radialX, 0, -radialZ);
    indices.push(
      base, base + 1, base + 2,
      base + 2, base + 1, base + 3,
      base + 2, base + 3, base + 4,
    );
  }

  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices;
  return data;
}

/**
 * Owns the grass field: builds it per round from the layout's GrassRects
 * (rejecting tufts that would grow inside a collider), feeds it the map's
 * environment palette, and per frame pushes time, the camera position, the
 * winning point-light set, and the nearest combatants as pushers.
 *
 * The field is drawn and never tested: unpickable, non-colliding, no `solid`
 * metadata — every ray (hitscan, LOS, ground probes) passes through it, and
 * bots neither path around nor trip over it. It is excluded from the
 * GlowLayer and never gets an outline (a second pass over ~4k instances
 * would double the cost and read as mush).
 */
export class GrassSystem {
  private mesh: Mesh | null = null;
  private mat: ShaderMaterial | null = null;
  private time = 0;

  // Packed uniforms, reused every frame to avoid allocation.
  private pointPos = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointColor = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointRange = new Float32Array(MAX_POINT_LIGHTS);
  private pushers = new Float32Array(MAX_PUSHERS * 3);
  private bestD2 = new Float32Array(MAX_PUSHERS);

  constructor(
    private scene: Scene,
    private glow: GlowLayer,
    private mats: CelMaterialFactory,
  ) {}

  /**
   * Rebuilds the field for a round. No-ops to a bald map when the layout has
   * no grass rects or the environment has no grass palette. `boxes` are the
   * map's colliders: candidate tufts that would grow inside one are skipped
   * (blades poking through a cottage wall read as a bug, not as undergrowth).
   * `roads` are the carriageways, and a tuft on one is skipped for the same
   * reason — grass is ROOTED, and a field is authored as a rectangle over
   * ground a road happens to cross.
   */
  build(
    rects: readonly GrassRect[],
    env: EnvironmentSpec,
    boxes: readonly WorldBox[],
    roads: readonly RoadRect[],
    terrain: TerrainField,
    /** The map's extent, for the collider index below. See `GameMap.size`. */
    size: number,
  ): void {
    this.dispose();
    if (rects.length === 0 || !env.grass) return;
    this.time = 0;

    const rng = mulberry32(0x6a55);
    const mesh = new Mesh("grass", this.scene);
    buildTuftVertexData(rng).applyToMesh(mesh);

    const matrices = this.scatter(rects, boxes, roads, terrain, size, rng);
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    mesh.thinInstanceRefreshBoundingInfo(true);

    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.metadata = { noGlow: true, noOutline: true };
    mesh.freezeWorldMatrix();
    // Built after Game's construction-time glow scan, so exclude by hand.
    this.glow.addExcludedMesh(mesh);

    const mat = createGrassMaterial(this.scene, "grass");
    const lit = env.lighting;
    mat.setVector3("lightDir", new Vector3(...lit.direction).normalize());
    mat.setColor3("lightColor", Color3.FromHexString(lit.color).scale(lit.intensity));
    mat.setColor3(
      "ambientColor",
      Color3.FromHexString(lit.ambientColor).scale(lit.ambientIntensity),
    );
    mat.setColor3("rimColor", Color3.FromHexString(lit.rimColor).scale(lit.rimIntensity));
    mat.setColor3("fogColor", Color3.FromHexString(env.fogColor));
    mat.setVector2("fogParams", new Vector2(env.fogStart, env.fogEnd));
    mat.setColor3("mistColor", Color3.FromHexString(env.mistColor));
    mat.setVector2("mistParams", new Vector2(env.mistHeight, env.mistStrength));
    mat.setColor3("rootColor", Color3.FromHexString(env.grass.rootColor));
    mat.setColor3("tipColor", Color3.FromHexString(env.grass.tipColor));
    // The depth map, its matrix and its params come from the factory, which is
    // the one publisher of all three. Unregistered, the shader would sample an
    // unbound sampler and the field would stand in permanent shadow.
    this.mats.registerShadowConsumer(mat);
    mesh.material = mat;

    this.mesh = mesh;
    this.mat = mat;
  }

  /**
   * Advances the animation and uploads camera, lights, and pushers. Pushers
   * are the `maxPushers` combatants nearest the camera — beyond that a bend
   * is outside reading distance, and the shader's falloff would zero it
   * anyway. Same frame-order rule as the lights and the fog: call after the
   * camera update.
   */
  update(
    dt: number,
    camPos: Vector3,
    lights: readonly PointLightData[],
    combatants: readonly Combatant[],
  ): void {
    if (!this.mat) return;
    this.time += dt;

    const count = Math.min(lights.length, MAX_POINT_LIGHTS);
    for (let i = 0; i < count; i++) {
      const l = lights[i];
      this.pointPos[i * 3] = l.position.x;
      this.pointPos[i * 3 + 1] = l.position.y;
      this.pointPos[i * 3 + 2] = l.position.z;
      this.pointColor[i * 3] = l.color.r * l.intensity;
      this.pointColor[i * 3 + 1] = l.color.g * l.intensity;
      this.pointColor[i * 3 + 2] = l.color.b * l.intensity;
      this.pointRange[i] = l.range;
    }

    // Insertion-select the nearest MAX_PUSHERS combatants (33 candidates
    // into 8 slots — a sort would allocate per frame for nothing).
    this.bestD2.fill(Infinity);
    const p = this.pushers;
    let pusherCount = 0;
    for (const c of combatants) {
      const dx = c.position.x - camPos.x;
      const dz = c.position.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= this.bestD2[MAX_PUSHERS - 1]) continue;
      let i = MAX_PUSHERS - 1;
      while (i > 0 && this.bestD2[i - 1] > d2) {
        this.bestD2[i] = this.bestD2[i - 1];
        p[i * 3] = p[(i - 1) * 3];
        p[i * 3 + 1] = p[(i - 1) * 3 + 1];
        p[i * 3 + 2] = p[(i - 1) * 3 + 2];
        i--;
      }
      this.bestD2[i] = d2;
      p[i * 3] = c.position.x;
      p[i * 3 + 1] = c.position.y;
      p[i * 3 + 2] = c.position.z;
      pusherCount = Math.min(pusherCount + 1, MAX_PUSHERS);
    }

    this.mat.setFloat("time", this.time);
    this.mat.setVector3("camPos", camPos);
    this.mat.setArray3("pointPos", this.pointPos as unknown as number[]);
    this.mat.setArray3("pointColor", this.pointColor as unknown as number[]);
    this.mat.setFloats("pointRange", this.pointRange as unknown as number[]);
    this.mat.setFloat("pointCount", count);
    this.mat.setArray3("pushers", p as unknown as number[]);
    this.mat.setFloat("pusherCount", pusherCount);
  }

  dispose(): void {
    // Before the dispose, not after: the factory would otherwise keep writing
    // three uniforms a frame into a dead material for the rest of the session.
    if (this.mat) this.mats.unregisterShadowConsumer(this.mat);
    this.mesh?.dispose();
    this.mat?.dispose();
    this.mesh = null;
    this.mat = null;
  }

  /**
   * Packs one thin-instance matrix per accepted tuft. Rejection is a single
   * sample (no retries): fields are mostly open ground, and a slightly
   * thinner edge against a wall reads as trampled, which is free realism —
   * and it is what makes the road test below cost nothing at all, because a
   * rejected tuft here takes no further numbers out of the stream. The field
   * a map grew before roads were in the test is the same field minus the
   * blades that were standing in the asphalt.
   */
  private scatter(
    rects: readonly GrassRect[],
    boxes: readonly WorldBox[],
    roads: readonly RoadRect[],
    terrain: TerrainField,
    size: number,
    rng: () => number,
  ): Float32Array {
    const g = CONFIG.grass;
    // Upper bound: no rect rejects more than it grows.
    let total = 0;
    for (const r of rects) {
      total += Math.floor(r.width * r.depth * (r.density ?? g.density));
    }
    const data = new Float32Array(total * 16);

    // Bucketed once, then read per tuft. This test used to walk all ~800
    // collider boxes for each of ~11,000 tufts — nearly nine million box tests
    // inside the map build the loading card is covering — while the index that
    // answers it in a handful was being built and thrown away two passes
    // earlier. No pad: a tuft is a point and the test has no clearance term.
    const index = buildBoxIndex(boxes, size, 0);

    const scale = new Vector3();
    const pos = new Vector3();
    const rot = new Quaternion();
    const mat = new Matrix();
    let n = 0;
    for (const r of rects) {
      const count = Math.floor(r.width * r.depth * (r.density ?? g.density));
      const base = (r.y ?? 0) - 0.02; // sink roots a touch into the surface
      for (let i = 0; i < count; i++) {
        const x = r.x + (rng() - 0.5) * r.width;
        const z = r.z + (rng() - 0.5) * r.depth;
        // Per tuft, not per rect: a field running over a bank has to follow it,
        // or half of it grows in mid-air and the other half is buried.
        const y = base + terrain.heightAt(x, z);
        if (insideCollider(x, y, z, index)) continue;
        // No pad, for the reason the collider test has none: a tuft is a point
        // and one against the kerb is the verge rather than a bug.
        if (onRoad(roads, x, z, 0)) continue;
        scale.set(
          0.7 + rng() * 0.6,
          g.heightMin + rng() * (g.heightMax - g.heightMin),
          0.7 + rng() * 0.6,
        );
        pos.set(x, y, z);
        Quaternion.RotationYawPitchRollToRef(rng() * Math.PI * 2, 0, 0, rot);
        Matrix.ComposeToRef(scale, rot, pos, mat);
        mat.copyToArray(data, n * 16);
        n++;
      }
    }
    return n === total ? data : data.slice(0, n * 16);
  }
}

/** Scratch for the box-frame transform below; scatter runs it per tuft per box. */
const localScratch: LocalXZ = { lx: 0, lz: 0 };

/**
 * True when a tuft at (x, y, z) would grow inside a collider box. A smaller
 * cousin of MapBuilder.insideCollider: no padding (blades are thin, and a
 * blade leaning against a trunk looks right) and no prop-height table (a
 * tuft tops out at CONFIG.grass.heightMax).
 */
function insideCollider(
  x: number,
  y: number,
  z: number,
  index: BoxIndex,
): boolean {
  const topY = y + CONFIG.grass.heightMax;
  const near = boxesNear(index, x, z);
  if (near) {
    for (const i of near) {
      if (buries(index.boxes[i], x, y, z, topY)) return true;
    }
  }
  // …and the two map-sized boxes the grid refuses. The ridge is one of them,
  // and a field running up to the valley wall would otherwise grow into it.
  for (const b of index.oversized) {
    if (buries(b, x, y, z, topY)) return true;
  }
  return false;
}

/** One collider box against one candidate tuft. */
function buries(
  b: WorldBox,
  x: number,
  y: number,
  z: number,
  topY: number,
): boolean {
  // A tilted box (rotX ramps) spans a taller band than its thickness.
  let halfH = b.h / 2;
  if (b.rotX !== 0) halfH += (Math.abs(Math.sin(b.rotX)) * b.d) / 2;
  // The 0.05 tolerance matters: a collider whose top sits within 5 cm of
  // the tuft's base IS the ground it stands on — a terrace top or a jetty
  // deck. Without it every tuft standing on one rejects itself.
  if (topY <= b.cy - halfH + 0.05 || y >= b.cy + halfH - 0.05) return false;
  const { lx, lz } = rotateToLocalXZ(b, x, z, localScratch);
  return Math.abs(lx) <= b.w / 2 && Math.abs(lz) <= b.d / 2;
}
