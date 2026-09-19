/**
 * FlagCloth.ts — the flag over one control point: a pole, and a sheet of
 * cloth on it that is SIMULATED in the valley's one wind rather than posed.
 *
 * Owns: the pole mesh, the two cloth meshes (the field and the hoist band),
 * the particle state under them, and the height the flag is flown at.
 *
 * Invariants: annotation exactly as the ring is — never `solid`, never
 * `checkCollisions`, never pickable, never a WorldBox, so no ray, no nav
 * consumer and no sweep has heard of it. Every mesh is `noShadowCaster`: the
 * cloth moves every frame and the world's shadow map re-renders only when its
 * window moves, so one animated caster would make it a per-frame redraw of the
 * map. Both cloth materials are cel (`getCloth`, a canvas backlit by the
 * key) so the flag is fogged, lit, shadowed and inked like the wall behind it.
 *
 * **Why a simulation and not a vertex wave.** A travelling sine on a sheet is
 * a sheet of card being rocked: every ripple the same height, the fly never
 * snapping, nothing that droops when the air drops. Here the flag is a
 * Verlet grid of `NU * NV` particles held by distance constraints (stretch,
 * shear and a soft bend), the hoist column pinned to the pole, and the air
 * pushes each TRIANGLE by the part of the wind it faces — so the shape is
 * the cloth's answer to the air, and the flapping is what an unsteady air
 * does to a sheet that can crease. Tunables are `CONFIG.wind.flag`.
 *
 * The cloth is two-sided by construction: every vertex exists twice, the back
 * copy with its normal negated and its triangles wound the other way, so the
 * frozen cel material needs no culling change and each face is lit from the
 * side it is seen from.
 *
 * Never disposes a material: all three are the factory's cache.
 */
import {
  BoundingInfo,
  Mesh,
  MeshBuilder,
  Scene,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";

/*
 * Art constants — what the flag and its pole ARE, not how they behave.
 */
/**
 * Pole height over the ground a flag stands on, metres — and the shorter one
 * a flag gets when its point is indoors and it is flown from the ROOF instead
 * (`CaptureZoneSystem.mount`), which is how a building flies a flag anyway.
 */
export const POLE_HEIGHT = 10;
export const ROOF_POLE_HEIGHT = 6;
/** The shortest pole the flag can still be run up: anything less is clamped. */
export const MIN_POLE_HEIGHT = 4;
const POLE_RADIUS_BASE = 0.065;
const POLE_RADIUS_TOP = 0.04;
/** The plinth the pole is set in, half of it below the ground line. */
const PLINTH_HEIGHT = 0.5;
const PLINTH_RADIUS = 0.34;
/** The ball on top, which is also what stops the flag at full hoist. */
const FINIAL_RADIUS = 0.09;
/** Flag size: hoist (height) by fly (length), metres. Three by five. */
const FLAG_HEIGHT = 1.6;
const FLAG_LENGTH = 2.7;
/** Particles along the fly and down the hoist. */
const NU = 16;
const NV = 10;
/** Columns from the hoist that are the band rather than the field. */
const BAND_COLS = 3;
/** Full hoist: the head of the flag this far under the finial. */
const TOP_GAP = 0.18;
/** Half-mast floor: the hem this far over the plinth. */
const BOTTOM_GAP = 0.55;
/** The pole, galvanised and weathered; its own hex so no other mesh shares it. */
const POLE_HEX = "#5d6166";
/** How far the cloth may be from the pole axis, for the fixed bounds. */
const REACH = FLAG_LENGTH + 0.3;

/** Past a hitch, the cloth takes at most this much time in one frame. */
const MAX_FRAME = 0.1;

/** What one flag is wearing: the field and the band, both cel hexes. */
export interface FlagColours {
  field: string;
  band: string;
}

const N = NU * NV;

export class FlagCloth {
  private pole: Mesh;
  private field: Mesh;
  private band: Mesh;
  private pos = new Float32Array(N * 3);
  private prev = new Float32Array(N * 3);
  private force = new Float32Array(N * 3);
  private windV = new Float32Array(N * 3);
  /** Both sides' positions and normals, as uploaded. */
  private outPos = new Float32Array(N * 6);
  private outNrm = new Float32Array(N * 6);
  /** Constraint pairs, rest lengths and stiffnesses, flat. */
  private pairs: Uint16Array;
  private rest: Float32Array;
  private stiff: Float32Array;
  /** Triangles of the front face, for the air — shared with both meshes. */
  private tris: Uint16Array;
  /** +1 or -1: which way `cross(du, dv)` points against Babylon's front. */
  private normalSign = 1;
  private dy = FLAG_HEIGHT / (NV - 1);
  private mass: number;
  private acc = 0;
  private t = 0;
  /** The head of the hoist column's world y, and the range it runs over. */
  private hoistY: number;
  private readonly hoistLow: number;
  private readonly hoistHigh: number;
  private readonly floorY: number;
  /** Per-flag phase, so five flags are five flags and not one flag five times. */
  private readonly phase: number;
  private fieldHex = "";
  /** This substep's wind bearing, unit, in XZ — written by `bearing`. */
  private wdx = 1;
  private wdz = 0;
  private bandHex = "";

  constructor(
    private scene: Scene,
    private mats: CelMaterialFactory,
    name: string,
    private x: number,
    baseY: number,
    private z: number,
    poleHeight: number,
    seed: number,
  ) {
    const topY = baseY + poleHeight;
    this.hoistHigh = topY - FINIAL_RADIUS - TOP_GAP;
    this.hoistLow = baseY + PLINTH_HEIGHT / 2 + BOTTOM_GAP + FLAG_HEIGHT;
    this.hoistY = this.hoistLow;
    this.floorY = baseY + 0.04;
    this.phase = seed * 2.399963;
    this.mass = (CONFIG.wind.flag.density * FLAG_HEIGHT * FLAG_LENGTH) / N;

    this.pole = this.buildPole(name, baseY, topY);

    // --- the grid, laid out flat and downwind so the first frame is flying ---
    this.bearing(0);
    const dx = FLAG_LENGTH / (NU - 1);
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const k = (j * NU + i) * 3;
        this.pos[k] = x + this.wdx * i * dx;
        this.pos[k + 1] = this.hoistY - j * this.dy;
        this.pos[k + 2] = z + this.wdz * i * dx;
      }
    }
    this.prev.set(this.pos);

    // --- constraints: stretch, shear, and a soft skip-one bend ---
    const pairs: number[] = [];
    const stiff: number[] = [];
    const add = (a: number, b: number, s: number) => {
      pairs.push(a, b);
      stiff.push(s);
    };
    const v = (i: number, j: number) => j * NU + i;
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        if (i + 1 < NU) add(v(i, j), v(i + 1, j), 1);
        if (j + 1 < NV) add(v(i, j), v(i, j + 1), 1);
        if (i + 1 < NU && j + 1 < NV) {
          add(v(i, j), v(i + 1, j + 1), 0.9);
          add(v(i + 1, j), v(i, j + 1), 0.9);
        }
        const bend = CONFIG.wind.flag.bend;
        if (i + 2 < NU) add(v(i, j), v(i + 2, j), bend);
        if (j + 2 < NV) add(v(i, j), v(i, j + 2), bend);
      }
    }
    this.pairs = Uint16Array.from(pairs);
    this.stiff = Float32Array.from(stiff);
    this.rest = new Float32Array(stiff.length);
    for (let c = 0; c < this.rest.length; c++) {
      this.rest[c] = dist(this.pos, this.pairs[c * 2], this.pairs[c * 2 + 1]);
    }

    // --- triangles, and which side of them Babylon calls the front ---
    const front: number[] = [];
    const bandIdx: number[] = [];
    const fieldIdx: number[] = [];
    for (let j = 0; j < NV - 1; j++) {
      for (let i = 0; i < NU - 1; i++) {
        const a = v(i, j);
        const b = v(i + 1, j);
        const c = v(i, j + 1);
        const d = v(i + 1, j + 1);
        front.push(a, b, c, b, d, c);
        const out = i < BAND_COLS ? bandIdx : fieldIdx;
        // The front, then the back copy wound the other way.
        out.push(a, b, c, b, d, c);
        out.push(N + a, N + c, N + b, N + b, N + c, N + d);
      }
    }
    this.tris = Uint16Array.from(front);
    const probe: number[] = [];
    VertexData.ComputeNormals(Array.from(this.pos), front, probe);
    this.writeOut();
    this.normalSign =
      probe[0] * this.outNrm[0] +
        probe[1] * this.outNrm[1] +
        probe[2] * this.outNrm[2] <
      0
        ? -1
        : 1;
    this.writeOut();

    this.field = this.buildCloth(`${name}-flag`, fieldIdx, baseY, topY);
    this.band = this.buildCloth(`${name}-flag-band`, bandIdx, baseY, topY);

    // A second of air before anybody sees it, so no flag starts flat.
    for (let s = 0; s < CONFIG.wind.flag.rate; s++) {
      this.substep(1 / CONFIG.wind.flag.rate);
    }
    this.writeOut();
    this.upload();
  }

  /** Paints the flag. Materials are the factory's; swapping one is a pointer. */
  setColours(c: FlagColours): void {
    if (c.field !== this.fieldHex) {
      this.fieldHex = c.field;
      this.field.material = this.mats.getCloth(
        c.field,
        CONFIG.graphics.translucency.awning,
      );
    }
    if (c.band !== this.bandHex) {
      this.bandHex = c.band;
      this.band.material = this.mats.getCloth(
        c.band,
        CONFIG.graphics.translucency.awning,
      );
    }
  }

  /** Shows or hides all three meshes: the fog wall's cut, and nothing else. */
  setVisible(on: boolean): void {
    if (this.pole.isEnabled() === on) return;
    this.pole.setEnabled(on);
    this.field.setEnabled(on);
    this.band.setEnabled(on);
  }

  /**
   * Whether the flag was inside the view last frame — the planes are the
   * render's own. A flag nobody can see is not worth its ~0.15 ms: it holds
   * its shape and picks the air up again where it left off.
   */
  inView(): boolean {
    const planes = this.scene.frustumPlanes;
    return !planes || this.field.isInFrustum(planes);
  }

  /**
   * Steps the cloth. `hoist` is 0 (at the foot of the pole) .. 1 (full
   * hoist) and is where the head of the flag is TAKEN this frame; the cloth
   * follows its own head through the constraints.
   */
  update(dt: number, hoist: number): void {
    const cfg = CONFIG.wind.flag;
    const h = 1 / cfg.rate;
    const target = this.hoistLow + (this.hoistHigh - this.hoistLow) * hoist;
    // A jump the halyard could not have made (the flag out past the fog while
    // the meter moved) carries the whole sheet rather than yanking its head.
    const jump = target - this.hoistY;
    if (Math.abs(jump) > 0.5) {
      for (let k = 1; k < N * 3; k += 3) {
        this.pos[k] += jump;
        this.prev[k] += jump;
      }
      this.hoistY = target;
    }
    const steps = Math.min(dt, MAX_FRAME);
    const from = this.hoistY;
    this.acc += steps;
    let n = Math.floor(this.acc / h);
    this.acc -= n * h;
    const total = n;
    while (n-- > 0) {
      // The head runs up or down the pole across the substeps, not in one.
      this.hoistY = from + (target - from) * ((total - n) / total);
      this.substep(h);
    }
    if (total === 0) return;
    this.hoistY = target;
    this.writeOut();
    this.upload();
  }

  dispose(): void {
    this.pole.dispose();
    this.field.dispose();
    this.band.dispose();
  }

  // --------------------------------------------------------------------------

  private substep(h: number): void {
    const cfg = CONFIG.wind.flag;
    this.t += h;
    const t = this.t;
    const pos = this.pos;
    const prev = this.prev;
    const f = this.force;
    const w = this.windV;

    // --- the air at every particle ---
    this.bearing(t);
    const dx = this.wdx;
    const dz = this.wdz;
    const px = -dz;
    const pz = dx;
    const kG = (Math.PI * 2) / CONFIG.wind.foliage.gust;
    const wG1 = (Math.PI * 2) / cfg.gustPeriods[0];
    const wG2 = (Math.PI * 2) / cfg.gustPeriods[1];
    const kF = (Math.PI * 2) / cfg.flutterLength;
    const wF = kF * cfg.convect * cfg.speed;
    const ph = this.phase;
    for (let k = 0; k < N * 3; k += 3) {
      const s = pos[k] * dx + pos[k + 2] * dz;
      const gust =
        1 +
        cfg.gust *
          (0.62 * Math.sin(s * kG - t * wG1 + ph) +
            0.38 * Math.sin(s * kG * 2.3 - t * wG2 + ph * 1.7));
      const along = cfg.speed * gust;
      const cross = cfg.flutter * cfg.speed * Math.sin(s * kF - t * wF + ph);
      const lift =
        0.5 *
        cfg.flutter *
        cfg.speed *
        Math.sin(s * kF * 1.37 - t * wF * 1.21 + ph * 2.1);
      w[k] = dx * along + px * cross;
      w[k + 1] = lift;
      w[k + 2] = dz * along + pz * cross;
    }

    // --- the air on every triangle, shared out to its corners ---
    f.fill(0);
    const tris = this.tris;
    const inv = 1 / h;
    for (let q = 0; q < tris.length; q += 3) {
      const a = tris[q] * 3;
      const b = tris[q + 1] * 3;
      const c = tris[q + 2] * 3;
      const ex = pos[b] - pos[a];
      const ey = pos[b + 1] - pos[a + 1];
      const ez = pos[b + 2] - pos[a + 2];
      const gx = pos[c] - pos[a];
      const gy = pos[c + 1] - pos[a + 1];
      const gz = pos[c + 2] - pos[a + 2];
      let nx = ey * gz - ez * gy;
      let ny = ez * gx - ex * gz;
      let nz = ex * gy - ey * gx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < 1e-9) continue;
      const area = len * 0.5;
      nx /= len;
      ny /= len;
      nz /= len;
      // Air relative to the cloth: the wind less the triangle's own velocity.
      const rx =
        (w[a] + w[b] + w[c]) / 3 -
        ((pos[a] - prev[a] + pos[b] - prev[b] + pos[c] - prev[c]) * inv) / 3;
      const ry =
        (w[a + 1] + w[b + 1] + w[c + 1]) / 3 -
        ((pos[a + 1] - prev[a + 1] + pos[b + 1] - prev[b + 1] + pos[c + 1] - prev[c + 1]) *
          inv) /
          3;
      const rz =
        (w[a + 2] + w[b + 2] + w[c + 2]) / 3 -
        ((pos[a + 2] - prev[a + 2] + pos[b + 2] - prev[b + 2] + pos[c + 2] - prev[c + 2]) *
          inv) /
          3;
      const vn = rx * nx + ry * ny + rz * nz;
      const tx = rx - vn * nx;
      const ty = ry - vn * ny;
      const tz = rz - vn * nz;
      const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const pn = (cfg.air * cfg.normalDrag * area * vn * Math.abs(vn)) / 3;
      const pt = (cfg.air * cfg.skinDrag * area * vt) / 3;
      const fx = pn * nx + pt * tx;
      const fy = pn * ny + pt * ty;
      const fz = pn * nz + pt * tz;
      f[a] += fx;
      f[a + 1] += fy;
      f[a + 2] += fz;
      f[b] += fx;
      f[b + 1] += fy;
      f[b + 2] += fz;
      f[c] += fx;
      f[c + 1] += fy;
      f[c + 2] += fz;
    }

    // --- Verlet ---
    const hh = h * h;
    const im = 1 / this.mass;
    const damp = cfg.damping;
    for (let k = 0; k < N * 3; k += 3) {
      if (k % (NU * 3) === 0) continue; // the hoist column is the pole's
      for (let e = 0; e < 3; e++) {
        const cur = pos[k + e];
        const a = f[k + e] * im - (e === 1 ? 9.81 : 0);
        pos[k + e] = cur + (cur - prev[k + e]) * damp + a * hh;
        prev[k + e] = cur;
      }
    }
    this.pin();

    // --- constraints ---
    const pairs = this.pairs;
    const rest = this.rest;
    const stiff = this.stiff;
    for (let it = 0; it < cfg.iterations; it++) {
      for (let c = 0; c < rest.length; c++) {
        const i = pairs[c * 2];
        const j = pairs[c * 2 + 1];
        const a = i * 3;
        const b = j * 3;
        const ddx = pos[b] - pos[a];
        const ddy = pos[b + 1] - pos[a + 1];
        const ddz = pos[b + 2] - pos[a + 2];
        const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        if (d < 1e-9) continue;
        const pinA = i % NU === 0;
        const pinB = j % NU === 0;
        if (pinA && pinB) continue;
        const s = ((d - rest[c]) / d) * stiff[c];
        const wa = pinA ? 0 : pinB ? 1 : 0.5;
        const wb = pinB ? 0 : pinA ? 1 : 0.5;
        pos[a] += ddx * s * wa;
        pos[a + 1] += ddy * s * wa;
        pos[a + 2] += ddz * s * wa;
        pos[b] -= ddx * s * wb;
        pos[b + 1] -= ddy * s * wb;
        pos[b + 2] -= ddz * s * wb;
      }
    }

    // --- the ground, for a flag at the foot of its pole in a lull ---
    const floor = this.floorY;
    for (let k = 1; k < N * 3; k += 3) {
      if (pos[k] < floor) {
        pos[k] = floor;
        prev[k] = floor;
        // Cloth on the ground drags rather than skating.
        prev[k - 1] += (pos[k - 1] - prev[k - 1]) * 0.5;
        prev[k + 1] += (pos[k + 1] - prev[k + 1]) * 0.5;
      }
    }
  }

  /**
   * The valley's wind bearing — `CONFIG.wind.dir`, the one every layer
   * shares — veered a little and slowly, per flag.
   */
  private bearing(t: number): void {
    const [x, z] = CONFIG.wind.dir;
    const len = Math.hypot(x, z) || 1;
    const ph = this.phase;
    const veer =
      CONFIG.wind.flag.veer *
      (0.7 * Math.sin(t * 0.21 + ph) + 0.3 * Math.sin(t * 0.53 + ph * 1.3));
    const c = Math.cos(veer);
    const s = Math.sin(veer);
    this.wdx = (x * c - z * s) / len;
    this.wdz = (x * s + z * c) / len;
  }

  /** The hoist column, on the pole axis under the head. */
  private pin(): void {
    for (let j = 0; j < NV; j++) {
      const k = j * NU * 3;
      const y = this.hoistY - j * this.dy;
      this.prev[k] = this.pos[k] = this.x;
      this.prev[k + 1] = this.pos[k + 1] = y;
      this.prev[k + 2] = this.pos[k + 2] = this.z;
    }
  }

  /** Positions and normals for both faces, into the upload buffers. */
  private writeOut(): void {
    const p = this.pos;
    const op = this.outPos;
    const on = this.outNrm;
    op.set(p, 0);
    op.set(p, N * 3);
    const sign = this.normalSign;
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const u0 = (j * NU + Math.max(0, i - 1)) * 3;
        const u1 = (j * NU + Math.min(NU - 1, i + 1)) * 3;
        const v0 = (Math.max(0, j - 1) * NU + i) * 3;
        const v1 = (Math.min(NV - 1, j + 1) * NU + i) * 3;
        const ax = p[u1] - p[u0];
        const ay = p[u1 + 1] - p[u0 + 1];
        const az = p[u1 + 2] - p[u0 + 2];
        const bx = p[v1] - p[v0];
        const by = p[v1 + 1] - p[v0 + 1];
        const bz = p[v1 + 2] - p[v0 + 2];
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const s = sign / len;
        nx *= s;
        ny *= s;
        nz *= s;
        const k = (j * NU + i) * 3;
        on[k] = nx;
        on[k + 1] = ny;
        on[k + 2] = nz;
        on[N * 3 + k] = -nx;
        on[N * 3 + k + 1] = -ny;
        on[N * 3 + k + 2] = -nz;
      }
    }
  }

  private upload(): void {
    for (const m of [this.field, this.band]) {
      m.updateVerticesData(VertexBuffer.PositionKind, this.outPos);
      m.updateVerticesData(VertexBuffer.NormalKind, this.outNrm);
    }
  }

  private buildCloth(
    name: string,
    indices: number[],
    baseY: number,
    topY: number,
  ): Mesh {
    const mesh = new Mesh(name, this.scene);
    const data = new VertexData();
    data.positions = this.outPos;
    data.normals = this.outNrm;
    data.indices = indices;
    data.applyToMesh(mesh, true);
    // World-space vertices under an identity transform, and bounds that hold
    // every shape the sheet can take, set once — an upload never re-measures.
    mesh.setBoundingInfo(
      new BoundingInfo(
        new Vector3(this.x - REACH, baseY, this.z - REACH),
        new Vector3(this.x + REACH, topY, this.z + REACH),
      ),
    );
    this.annotate(mesh);
    return mesh;
  }

  private buildPole(name: string, baseY: number, topY: number): Mesh {
    const shaft = MeshBuilder.CreateCylinder(
      `${name}-pole-shaft`,
      {
        height: topY - baseY,
        diameterBottom: POLE_RADIUS_BASE * 2,
        diameterTop: POLE_RADIUS_TOP * 2,
        tessellation: 8,
      },
      this.scene,
    );
    shaft.position.set(this.x, (baseY + topY) / 2, this.z);
    const plinth = MeshBuilder.CreateCylinder(
      `${name}-pole-plinth`,
      {
        height: PLINTH_HEIGHT,
        diameterBottom: PLINTH_RADIUS * 2.3,
        diameterTop: PLINTH_RADIUS * 2,
        tessellation: 8,
      },
      this.scene,
    );
    plinth.position.set(this.x, baseY, this.z);
    const finial = MeshBuilder.CreateSphere(
      `${name}-pole-finial`,
      { diameter: FINIAL_RADIUS * 2, segments: 6 },
      this.scene,
    );
    finial.position.set(this.x, topY, this.z);
    const pole = Mesh.MergeMeshes([shaft, plinth, finial], true)!;
    pole.name = `${name}-pole`;
    pole.material = this.mats.get(POLE_HEX);
    this.annotate(pole);
    return pole;
  }

  private annotate(mesh: Mesh): void {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.metadata = { noGlow: true, noShadowCaster: true };
    mesh.freezeWorldMatrix();
  }
}

function dist(p: Float32Array, i: number, j: number): number {
  const a = i * 3;
  const b = j * 3;
  return Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
}
