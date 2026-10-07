/**
 * BlastFx.ts — What a blast LOOKS like: six of its eight layers, drawn as
 * billows in one material.
 * Owns: the blast slots (one thin-instanced mesh each), the shared mesh the
 * sparks and the burning fragments' trails are drawn in, every billow's
 * motion, and the dust's colour. `GrenadeSystem` owns it and calls it; the
 * server never builds one (`GrenadeOptions.dust`), because nothing here is a
 * rule — where a blast is and whom it hurts are decided before this is asked
 * to draw it.
 * Invariants: nothing allocates after construction — a billow is a record in
 * a fixed pool and a frame is property writes into three typed arrays per
 * mesh. `power` scales sizes, reaches, speeds and COUNTS and never a time
 * (`docs/grenades.md`). Every mesh here is a unit icosphere at identity whose
 * instances carry the whole transform, so its bounding box is set by hand
 * every frame from the billows it drew — and it is never a shadow caster.
 * Contract: `docs/grenades.md`, "The blast is EIGHT layers".
 *
 * WHAT A BILLOW IS. A record with an age, a life and a CLOSED-FORM motion:
 * launched at `v0`, slowed by linear drag `drag` toward the terminal climb
 * `lift / drag`, so where it is at any age is one expression rather than a
 * state integrated per frame — which is what lets a spark and a smoke puff
 * share a pool, and a trail's head lay puffs at the exact points it passed
 * whatever the frame rate. Its radius eases out from `from` to `to` over
 * `tau`, and then grows by `late` over the rest of its life; its HEAT falls
 * from `heat` to nothing over `hot`; it starts to dissolve at `fade` of its
 * life and is gone at the end of it. `BlastShader` turns those four numbers
 * into fire, smoke and wisps.
 *
 * WHY ONE MESH PER SLOT RATHER THAN ONE FOR EVERYTHING. The glow fades a
 * mesh's bloom with the distance to its BOUNDING SPHERE's centre
 * (`GlowRules.colour`), so a mesh has to be one place: a slot is one blast.
 * The small mesh is the exception and its bloom is only ever sparks and the
 * hot heads of trails, a metre or two from the blast that threw them.
 */
import {
  Color3,
  MeshBuilder,
  Quaternion,
  Vector3,
  type Mesh,
  type Scene,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { BlastMaterial } from "../shaders/BlastShader";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { EnvironmentSpec } from "../world/environment";

/** What the blast went off on, as `GrenadeSystem.probeGround` answers it. */
export interface BlastSurface {
  normal: Vector3;
}

/**
 * One billow: a fire, a puff of smoke, a skirt of dust or a spark. See the
 * header for the motion. Fields are plain numbers so the pool is one shape.
 */
interface Billow {
  on: boolean;
  /** Seconds since it was born; negative while it waits out its delay. */
  age: number;
  life: number;
  /** Where it was born, and how it was launched. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Linear drag (1/s), and the upward push (m/s^2) it climbs toward `lift / drag`. */
  drag: number;
  lift: number;
  /** Radius: eased from `from` to `to` over `tau`, then grown by `late` over the rest. */
  from: number;
  to: number;
  tau: number;
  late: number;
  /** Heat at birth and the seconds it takes to lose it. */
  heat: number;
  hot: number;
  /** The floor a spark cools to — a spark is drawn hot for its whole flight. */
  ember: number;
  /** The share of its life after which it dissolves. */
  fade: number;
  /** The fire-lit underside at birth and the seconds it lasts. */
  warm: number;
  warmFor: number;
  /** 0 for soot, 1 for dust (the map's floor). */
  dust: number;
  seed: number;
  /**
   * How flat it is along `nx, ny, nz` (1 = round). A surge billow lies on the
   * ground it rolled out over, which need not be level.
   */
  squash: number;
  nx: number;
  ny: number;
  nz: number;
  /** > 0 for a spark: drawn out along its flight by this many seconds of travel. */
  streak: number;
}

/** A burning fragment: flies on the closed form and lays a trail as it goes. */
interface Streamer {
  on: boolean;
  age: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** When the next puff is due, on its own clock. */
  next: number;
  size: number;
}

/** One blast: the slot's mesh, its billows, and when it goes quiet. */
interface Slot {
  batch: BillowBatch;
  billows: Billow[];
  /** Seconds since it was claimed; < 0 while free. */
  t: number;
}

/**
 * A mesh's worth of instances: the three buffers, the running bounds, and the
 * one place a billow's pose is turned into a matrix.
 */
class BillowBatch {
  readonly mesh: Mesh;
  private readonly cap: number;
  private readonly matrices: Float32Array;
  private readonly shapes: Float32Array;
  private readonly warmth: Float32Array;
  private count = 0;
  private readonly min = new Vector3();
  private readonly max = new Vector3();

  constructor(
    scene: Scene,
    name: string,
    material: BlastMaterial,
    cap: number,
    subdivisions: number,
  ) {
    this.cap = cap;
    this.matrices = new Float32Array(cap * 16);
    this.shapes = new Float32Array(cap * 4);
    this.warmth = new Float32Array(cap);
    const mesh = MeshBuilder.CreateIcoSphere(
      name,
      { radius: 1, subdivisions, flat: false },
      scene,
    );
    mesh.material = material;
    mesh.isPickable = false;
    // Not `noInk`: the ink finding the edges between billows IS the drawing.
    mesh.metadata = { noShadowCaster: true };
    // The bounds are this class's, set from the billows every frame — Babylon
    // would otherwise walk every instance's box, and before the first frame
    // take all `cap` identity matrices as the mesh's extent.
    mesh.doNotSyncBoundingInfo = true;
    mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    mesh.thinInstanceSetBuffer("billow", this.shapes, 4, false);
    mesh.thinInstanceSetBuffer("warmth", this.warmth, 1, false);
    mesh.thinInstanceCount = 0;
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
    mesh.isVisible = false;
    this.mesh = mesh;
  }

  begin(): void {
    this.count = 0;
    this.min.setAll(Number.POSITIVE_INFINITY);
    this.max.setAll(Number.NEGATIVE_INFINITY);
  }

  /**
   * One instance. `ax..` is the direction its local Y is laid along (a spark's
   * flight, a surge billow's ground normal) or null for upright; `r` is its
   * radius across, `ry` along that axis.
   */
  push(
    x: number,
    y: number,
    z: number,
    r: number,
    ry: number,
    ax: number,
    ay: number,
    az: number,
    heat: number,
    dissolve: number,
    seed: number,
    dust: number,
    warmth: number,
  ): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    const m = this.matrices;
    const o = i * 16;
    if (ay > 0.9999) {
      m[o] = r;
      m[o + 1] = 0;
      m[o + 2] = 0;
      m[o + 4] = 0;
      m[o + 5] = ry;
      m[o + 6] = 0;
      m[o + 8] = 0;
      m[o + 9] = 0;
      m[o + 10] = r;
    } else {
      // A basis with local Y along (ax, ay, az): X across it off whichever
      // world axis is least parallel, and Z = X x Y so the determinant stays
      // +1 — a mirrored instance would flip its winding and the back-face cull
      // would draw its inside.
      let rx = 0;
      let rz = 0;
      let ry2 = 0;
      if (Math.abs(ay) < 0.9) ry2 = 1;
      else rx = 1;
      // X = normalize(Y x ref)
      let xx = ay * rz - az * ry2;
      let xy = az * rx - ax * rz;
      let xz = ax * ry2 - ay * rx;
      const xl = Math.hypot(xx, xy, xz) || 1;
      xx /= xl;
      xy /= xl;
      xz /= xl;
      // Z = X x Y
      const zx = xy * az - xz * ay;
      const zy = xz * ax - xx * az;
      const zz = xx * ay - xy * ax;
      m[o] = xx * r;
      m[o + 1] = xy * r;
      m[o + 2] = xz * r;
      m[o + 4] = ax * ry;
      m[o + 5] = ay * ry;
      m[o + 6] = az * ry;
      m[o + 8] = zx * r;
      m[o + 9] = zy * r;
      m[o + 10] = zz * r;
    }
    m[o + 3] = 0;
    m[o + 7] = 0;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
    const s = i * 4;
    this.shapes[s] = heat;
    this.shapes[s + 1] = dissolve;
    this.shapes[s + 2] = seed;
    this.shapes[s + 3] = dust;
    this.warmth[i] = warmth;
    // The bounds: the larger half-extent either way, and the lumps on top.
    const e = Math.max(r, ry) * (1 + CONFIG.graphics.blast.lump);
    this.min.x = Math.min(this.min.x, x - e);
    this.min.y = Math.min(this.min.y, y - e);
    this.min.z = Math.min(this.min.z, z - e);
    this.max.x = Math.max(this.max.x, x + e);
    this.max.y = Math.max(this.max.y, y + e);
    this.max.z = Math.max(this.max.z, z + e);
  }

  end(): void {
    const mesh = this.mesh;
    if (this.count === 0) {
      if (mesh.isVisible) mesh.isVisible = false;
      return;
    }
    mesh.thinInstanceCount = this.count;
    mesh.thinInstanceBufferUpdated("matrix");
    mesh.thinInstanceBufferUpdated("billow");
    mesh.thinInstanceBufferUpdated("warmth");
    mesh.getBoundingInfo().reConstruct(this.min, this.max, mesh.getWorldMatrix());
    if (!mesh.isVisible) mesh.isVisible = true;
  }

  hide(): void {
    this.count = 0;
    this.mesh.isVisible = false;
  }
}

/** A batch holding one upright, hot, metre-wide billow — see `BlastFx.warm`. */
function warmBillow(batch: BillowBatch): void {
  batch.begin();
  batch.push(0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1);
  batch.end();
}

function newBillow(): Billow {
  return {
    on: false,
    age: 0,
    life: 1,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    drag: 1,
    lift: 0,
    from: 0,
    to: 0,
    tau: 1,
    late: 0,
    heat: 0,
    hot: 1,
    ember: 0,
    fade: 1,
    warm: 0,
    warmFor: 1,
    dust: 0,
    seed: 0,
    squash: 1,
    nx: 0,
    ny: 1,
    nz: 0,
    streak: 0,
  };
}

/** A billow's defaults, restored before every spawn so no field leaks across uses. */
function clear(b: Billow): Billow {
  b.on = true;
  b.age = 0;
  b.vx = b.vy = b.vz = 0;
  b.drag = 1;
  b.lift = 0;
  b.tau = 1;
  b.late = 0;
  b.heat = 0;
  b.hot = 1;
  b.ember = 0;
  b.fade = 1;
  b.warm = 0;
  b.warmFor = 1;
  b.dust = 0;
  b.seed = Math.random();
  b.squash = 1;
  b.nx = 0;
  b.ny = 1;
  b.nz = 0;
  b.streak = 0;
  return b;
}

/**
 * Where a body launched at `v0` under linear drag `d` and a constant upward
 * push `a` is after `t` seconds, along one axis — the exact solution of
 * `v' = -d v + a`, so a trail can ask for any past instant.
 */
function travel(p0: number, v0: number, d: number, a: number, t: number): number {
  const f = (1 - Math.exp(-d * t)) / d;
  return p0 + v0 * f + (a / d) * (t - f);
}

/** And how fast, which is what a spark is drawn out along. */
function speedAt(v0: number, d: number, a: number, t: number): number {
  const e = Math.exp(-d * t);
  return v0 * e + (a / d) * (1 - e);
}

/**
 * How long a slot is held: the longest of its layers, derived rather than
 * declared because it is not a choice — released early, a billow vanishes
 * mid-air; held late, it is a slot the next blast has to steal.
 */
const SLOT_LIFE = (() => {
  const g = CONFIG.grenade;
  return Math.max(
    g.fireball.stagger + g.fireball.life + g.fireball.smoke * 1.2,
    g.column.delay + g.column.life * 1.1,
    g.surge.life * 1.15,
  );
})();

/** How much of `flash.radius` the flash billow is drawn at. */
const FLASH_DRAWN = 0.6;

/** Sparks and trail puffs, pooled across every blast in the air. */
const SMALL_CAP = 320;
const STREAMERS = 32;

const _q = new Quaternion();
const _t1 = new Vector3();
const _t2 = new Vector3();
const _up = new Vector3(0, 1, 0);

export class BlastFx {
  private readonly slots: Slot[] = [];
  private readonly small: BillowBatch;
  private readonly smallBillows: Billow[] = [];
  private readonly streamers: Streamer[] = [];
  private readonly material: BlastMaterial;

  constructor(scene: Scene, mats: CelMaterialFactory) {
    const g = CONFIG.grenade;
    this.material = mats.getBlast();
    for (let i = 0; i < g.blastSlots; i++) {
      const billows: Billow[] = [];
      for (let j = 0; j < g.blastBillows; j++) billows.push(newBillow());
      this.slots.push({
        batch: new BillowBatch(scene, `blast${i}`, this.material, g.blastBillows, 8),
        billows,
        t: -1,
      });
    }
    this.small = new BillowBatch(scene, "blastSmall", this.material, SMALL_CAP, 4);
    for (let i = 0; i < SMALL_CAP; i++) this.smallBillows.push(newBillow());
    for (let i = 0; i < STREAMERS; i++) {
      this.streamers.push({
        on: false,
        age: 0,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        next: 0,
        size: 1,
      });
    }
    // The EFFECT compiled now rather than on the first detonation. The
    // PIPELINE still waits for a real draw on WebGPU, and that draw is
    // `warm`'s, under the building card — together they keep both off the
    // frame a player is looking hardest.
    this.material.forceCompilation(this.slots[0].batch.mesh, undefined, {
      useInstances: true,
    });
  }

  /**
   * The dust is the map's FLOOR, lit — an albedo the shader multiplies by the
   * map's own light exactly as the ground under it is, so a night map's dust
   * comes out as dark as its street without being told. It is pulled a
   * little under half way to a pale dust, because what a blast lifts is the dry
   * fines off the top of the ground, which are always paler than it.
   */
  setEnvironment(env: EnvironmentSpec): void {
    const floor = Color3.FromHexString(env.floorColor);
    this.material.setDust(Color3.Lerp(floor, PALE_DUST, 0.45));
  }

  /** A frag's blast, or a shell's, at `power` of a frag. */
  blast(at: Vector3, power: number, ground: BlastSurface): void {
    const slot = this.claim();
    this.flash(slot, at, power);
    this.fireball(slot, at, power);
    this.column(slot, at, power);
    this.surge(slot, at, power, ground.normal);
    this.sparks(at, power);
    this.trails(at, power);
    this.drawNow(slot);
  }

  /**
   * A molotov going up: the flash and the fireball at `fire` of a frag, the
   * column at `smoke`, and the sparks — no surge (petrol going up is a whoosh,
   * not a pressure wave) and no burning fragments (there is no metal).
   */
  ignite(at: Vector3, fire: number, smoke: number): void {
    const slot = this.claim();
    this.flash(slot, at, fire);
    this.fireball(slot, at, fire);
    this.column(slot, at, smoke);
    this.sparks(at, fire);
    this.drawNow(slot);
  }

  /** Ages everything, lays the trails, and poses every billow into its mesh. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (slot.t < 0) continue;
      slot.t += dt;
      if (slot.t > SLOT_LIFE) {
        this.park(slot);
        continue;
      }
      this.poseSlot(slot, dt);
    }
    this.layTrails(dt);
    this.poseSmall(dt);
  }

  /**
   * **A new blast is posed on the frame it is raised and not left to the
   * next**: a slot is reused, so a mesh left as it was holds whatever the
   * LAST blast in it ended on — one frame of an old cloud where the new
   * fireball should be.
   */
  private drawNow(slot: Slot): void {
    this.poseSlot(slot, 0);
    this.poseSmall(0);
  }

  private poseSlot(slot: Slot, dt: number): void {
    slot.batch.begin();
    for (const b of slot.billows) {
      if (b.on) this.pose(b, dt, slot.batch);
    }
    slot.batch.end();
  }

  private poseSmall(dt: number): void {
    let any = false;
    this.small.begin();
    for (const b of this.smallBillows) {
      if (!b.on) continue;
      any = true;
      this.pose(b, dt, this.small);
    }
    if (any) this.small.end();
    else this.small.hide();
  }

  /**
   * One hot billow in an idle slot's batch and in the small batch, for the
   * frames of the building card's pipeline warm-up (`core/PipelineWarmup.ts`),
   * or both taken back off. `forceCompilation` in the constructor builds the
   * EFFECT and not the pipeline, which on WebGPU waits for a real draw — the
   * first blast of a round was that draw, and on a phone it cost 403 ms
   * (`FINDINGS.md` 16). Hot, so the glow's mask draws it too.
   */
  warm(on: boolean): void {
    const slot = this.slots[this.slots.length - 1];
    if (!on) {
      if (this.warmedSlot) slot.batch.hide();
      if (this.warmedSmall) this.small.hide();
      this.warmedSlot = false;
      this.warmedSmall = false;
      return;
    }
    if (slot.t < 0) {
      warmBillow(slot.batch);
      this.warmedSlot = true;
    }
    let smallBusy = false;
    for (const b of this.smallBillows) if (b.on) smallBusy = true;
    if (!smallBusy) {
      warmBillow(this.small);
      this.warmedSmall = true;
    }
  }
  private warmedSlot = false;
  private warmedSmall = false;

  /** Takes every blast out of the air — a map is going away under it. */
  reset(): void {
    for (const slot of this.slots) this.park(slot);
    for (const b of this.smallBillows) b.on = false;
    for (const s of this.streamers) s.on = false;
    this.small.hide();
  }

  /**
   * The slot for a new blast: a free one, or the OLDEST. Claimed by age and
   * never refused — nothing is spent on a picture, so a blast with nothing
   * drawn at it is a worse lie than an old cloud cut short.
   */
  private claim(): Slot {
    let slot = this.slots[0];
    for (const s of this.slots) {
      if (s.t < 0) {
        slot = s;
        break;
      }
      if (s.t > slot.t) slot = s;
    }
    for (const b of slot.billows) b.on = false;
    slot.t = 0;
    return slot;
  }

  private park(slot: Slot): void {
    slot.t = -1;
    for (const b of slot.billows) b.on = false;
    slot.batch.hide();
  }

  /** The next free billow in a slot, or null when the slot is full. */
  private take(slot: Slot): Billow | null {
    for (const b of slot.billows) if (!b.on) return clear(b);
    return null;
  }

  private takeSmall(): Billow | null {
    for (const b of this.smallBillows) if (!b.on) return clear(b);
    return null;
  }

  /**
   * One billow at its age, into a batch. The whole of how a billow looks at
   * any moment is here and in `BlastShader`, and it is a pure function of
   * the record and the age.
   */
  private pose(b: Billow, dt: number, batch: BillowBatch): void {
    b.age += dt;
    const a = b.age;
    if (a < 0) return;
    if (a >= b.life) {
      b.on = false;
      return;
    }
    const f = a / b.life;
    const x = travel(b.x, b.vx, b.drag, 0, a);
    const y = travel(b.y, b.vy, b.drag, b.lift, a);
    const z = travel(b.z, b.vz, b.drag, 0, a);
    let r = b.to - (b.to - b.from) * Math.exp(-a / b.tau);
    r *= 1 + b.late * f;
    const heat =
      a < b.hot ? b.ember + (b.heat - b.ember) * (1 - a / b.hot) ** 1.3 : b.ember;
    const dissolve = f < b.fade ? 0 : (f - b.fade) / (1 - b.fade);
    const warmth = b.warm * Math.max(0, 1 - a / b.warmFor);

    if (b.streak > 0) {
      // A spark: drawn out along where it is going, as long as the distance
      // it covers in `streak` seconds.
      const vx = speedAt(b.vx, b.drag, 0, a);
      const vy = speedAt(b.vy, b.drag, b.lift, a);
      const vz = speedAt(b.vz, b.drag, 0, a);
      const sp = Math.hypot(vx, vy, vz) || 1;
      const len = Math.max(r * 1.5, sp * b.streak);
      batch.push(
        x, y, z, r, len, vx / sp, vy / sp, vz / sp,
        heat, dissolve, b.seed, b.dust, warmth,
      );
      return;
    }
    batch.push(
      x, y, z, r, r * b.squash, b.nx, b.ny, b.nz,
      heat, dissolve, b.seed, b.dust, warmth,
    );
  }

  /**
   * The core: one billow, already large, white to its rim and torn apart
   * inside `flash.life`.
   */
  private flash(slot: Slot, at: Vector3, power: number): void {
    const fl = CONFIG.grenade.flash;
    const b = this.take(slot);
    if (!b) return;
    b.x = at.x;
    b.y = at.y;
    b.z = at.z;
    b.life = fl.life;
    // Drawn at FLASH_DRAWN of the radius: `flash.radius` is also where the
    // debris starts, and a solid billow that big is a white dome over the
    // whole blast rather than a flash at the middle of it — the bloom adds
    // the rest.
    b.from = fl.radius * power * FLASH_DRAWN * 0.55;
    b.to = fl.radius * power * FLASH_DRAWN;
    b.tau = fl.life * 0.5;
    b.heat = 1.9;
    b.hot = fl.life * 2;
    b.fade = 0.35;
  }

  /** The cluster: out along the golden angle, fire, then its own smoke. */
  private fireball(slot: Slot, at: Vector3, power: number): void {
    const fb = CONFIG.grenade.fireball;
    const n = fb.billows;
    const spin = Math.random() * Math.PI * 2;
    for (let j = 0; j < n; j++) {
      const b = this.take(slot);
      if (!b) return;
      // The golden angle round the vertical and a lift that walks up it: an
      // even spread with no two billows on one bearing.
      const yaw = spin + j * 2.399963;
      const lift = -0.2 + (j / Math.max(1, n - 1)) * 1.0 + (Math.random() - 0.5) * 0.2;
      const flat = Math.sqrt(Math.max(0, 1 - lift * lift));
      const reach = fb.spread * power * (0.45 + 0.55 * Math.random());
      const dx = Math.cos(yaw) * flat;
      const dy = lift;
      const dz = Math.sin(yaw) * flat;
      b.x = at.x + dx * 0.25 * power;
      b.y = at.y + dy * 0.25 * power;
      b.z = at.z + dz * 0.25 * power;
      // Launched so linear drag brings it to rest `reach` out.
      b.drag = fb.drag;
      b.vx = dx * reach * fb.drag;
      b.vy = dy * reach * fb.drag;
      b.vz = dz * reach * fb.drag;
      b.lift = fb.rise * fb.drag * power;
      const size = fb.radius * power * (0.6 + 0.4 * Math.random());
      b.from = size * 0.3;
      b.to = size;
      b.tau = 0.12;
      b.age = -(j / n) * fb.stagger - Math.random() * 0.03;
      b.life = fb.life + fb.smoke * (0.8 + 0.4 * Math.random());
      b.late = (fb.grow - 1) * (0.7 + 0.6 * Math.random());
      b.heat = fb.heat * (0.85 + 0.3 * Math.random());
      b.hot = fb.life * (0.8 + 0.4 * Math.random());
      b.fade = 0.45 + Math.random() * 0.15;
      b.warm = 1;
      b.warmFor = fb.life * 1.8;
    }
  }

  /** The column: thrown straight up, stacking as the drag catches each one. */
  private column(slot: Slot, at: Vector3, power: number): void {
    const c = CONFIG.grenade.column;
    const n = Math.max(1, Math.round(c.billows * power));
    for (let j = 0; j < n; j++) {
      const b = this.take(slot);
      if (!b) return;
      const k = j / Math.max(1, n - 1);
      const jitter = 0.9 * power;
      b.x = at.x + (Math.random() - 0.5) * jitter;
      b.y = at.y + c.lift * power;
      b.z = at.z + (Math.random() - 0.5) * jitter;
      b.drag = c.drag;
      // The later a billow is born the slower it leaves, so the first ones
      // reach the top of the column and the last ones fill in under them.
      const up = c.speed * power * (1 - 0.55 * k) * (0.85 + 0.3 * Math.random());
      b.vx = (Math.random() - 0.5) * 2.4 * power;
      b.vy = up;
      b.vz = (Math.random() - 0.5) * 2.4 * power;
      b.lift = c.rise * c.drag * power;
      // Sized on power^0.6 while the COUNT takes the rest: a shell's column
      // is more billows rather than bigger ones, or it is one boulder.
      const size = power ** 0.6;
      b.from = c.from * size * (0.8 + 0.4 * Math.random());
      b.to = c.to * size * (0.75 + 0.5 * Math.random());
      b.tau = 0.9;
      b.age = -(0.04 + k * c.delay);
      b.life = c.life * (0.9 + 0.2 * Math.random()) - k * c.delay;
      b.heat = c.heat * (1 - k);
      b.hot = 0.35;
      b.fade = c.fade + Math.random() * 0.1;
      b.warm = 1 - 0.6 * k;
      b.warmFor = 1.0;
    }
  }

  /** The surge: a ring of low dust rolled out flat to the ground. */
  private surge(slot: Slot, at: Vector3, power: number, normal: Vector3): void {
    const s = CONFIG.grenade.surge;
    const n = Math.max(3, Math.round(s.billows * power));
    // Two tangents of the ground, so the ring lies on a slope or a wall as
    // well as on the level.
    Quaternion.FromUnitVectorsToRef(_up, normal, _q);
    _t1.set(1, 0, 0).rotateByQuaternionToRef(_q, _t1);
    Vector3.CrossToRef(_t1, normal, _t2);
    const spin = Math.random() * Math.PI * 2;
    for (let j = 0; j < n; j++) {
      const b = this.take(slot);
      if (!b) return;
      const yaw = spin + ((j + Math.random() * 0.6) / n) * Math.PI * 2;
      const cx = Math.cos(yaw);
      const sz = Math.sin(yaw);
      const dx = _t1.x * cx + _t2.x * sz;
      const dy = _t1.y * cx + _t2.y * sz;
      const dz = _t1.z * cx + _t2.z * sz;
      // Most run out to the edge and a few stay near the middle, so the ring
      // has a floor of dust inside it rather than a hole.
      const reach = s.reach * power * (j % 4 === 0 ? 0.3 + 0.3 * Math.random() : 0.75 + 0.25 * Math.random());
      // The reach goes with power and the billow with its square root, for
      // the column's reason.
      const size = Math.sqrt(power) * (0.85 + 0.3 * Math.random());
      b.x = at.x + dx * 0.4 * power + normal.x * s.from * size * s.squash;
      b.y = at.y + dy * 0.4 * power + normal.y * s.from * size * s.squash;
      b.z = at.z + dz * 0.4 * power + normal.z * s.from * size * s.squash;
      b.drag = s.drag;
      b.vx = dx * reach * s.drag;
      b.vy = dy * reach * s.drag;
      b.vz = dz * reach * s.drag;
      b.lift = s.rise * s.drag;
      b.from = s.from * size;
      b.to = s.to * size;
      b.tau = 0.25;
      b.late = 0.25;
      b.life = s.life * (0.8 + 0.35 * Math.random());
      b.fade = s.fade + Math.random() * 0.15;
      b.dust = 1;
      b.squash = s.squash;
      b.nx = normal.x;
      b.ny = normal.y;
      b.nz = normal.z;
      // The inner edge of the skirt is still lit by the fire a moment.
      b.warm = 0.9;
      b.warmFor = 0.8;
    }
  }

  /** Hot metal, as strokes on an even-ish spread. */
  private sparks(at: Vector3, power: number): void {
    const sp = CONFIG.grenade.sparks;
    const n = Math.round(sp.count * power);
    for (let j = 0; j < n; j++) {
      const b = this.takeSmall();
      if (!b) return;
      const yaw = ((j + Math.random()) / n) * Math.PI * 2;
      const lift = 0.2 + Math.random() * 0.95;
      const l = Math.hypot(1, lift);
      const speed = sp.speed * power * (0.5 + Math.random() * 0.7);
      b.x = at.x;
      b.y = at.y;
      b.z = at.z;
      b.vx = (Math.sin(yaw) / l) * speed;
      b.vy = (lift / l) * speed;
      b.vz = (Math.cos(yaw) / l) * speed;
      b.drag = 0.6;
      b.lift = -sp.gravity;
      b.from = b.to = sp.width * (0.7 + 0.6 * Math.random());
      b.life = sp.life * (0.6 + 0.6 * Math.random());
      b.heat = 1.7;
      b.ember = 0.75;
      b.hot = b.life;
      b.fade = 0.75;
      b.streak = sp.stretch;
    }
  }

  /** The burning fragments: thrown out and up, laying their trails in `update`. */
  private trails(at: Vector3, power: number): void {
    const tr = CONFIG.grenade.trails;
    const n = Math.round(tr.streamers * power);
    const spin = Math.random() * Math.PI * 2;
    let made = 0;
    for (const s of this.streamers) {
      if (made >= n) break;
      if (s.on) continue;
      const yaw = spin + ((made + Math.random() * 0.5) / n) * Math.PI * 2;
      const lift = 0.7 + Math.random() * 0.8;
      const l = Math.hypot(1, lift);
      const speed = tr.speed * Math.sqrt(power) * (0.75 + 0.5 * Math.random());
      s.on = true;
      s.age = 0;
      s.next = 0;
      s.x = at.x;
      s.y = at.y + 0.3;
      s.z = at.z;
      s.vx = (Math.cos(yaw) / l) * speed;
      s.vy = (lift / l) * speed;
      s.vz = (Math.sin(yaw) / l) * speed;
      s.size = Math.sqrt(power);
      made++;
    }
  }

  /**
   * Every burning fragment's trail, laid at the exact instants its clock
   * passed this frame — so a slow frame lays the same trail a fast one does,
   * each puff where the head WAS, already that much older.
   */
  private layTrails(dt: number): void {
    const tr = CONFIG.grenade.trails;
    for (const s of this.streamers) {
      if (!s.on) continue;
      s.age += dt;
      while (s.next <= s.age && s.next <= tr.life) {
        const t = s.next;
        s.next += tr.every;
        const b = this.takeSmall();
        if (!b) continue;
        b.x = travel(s.x, s.vx, tr.drag, 0, t) + (Math.random() - 0.5) * 0.08;
        b.y = travel(s.y, s.vy, tr.drag, -tr.gravity, t);
        b.z = travel(s.z, s.vz, tr.drag, 0, t) + (Math.random() - 0.5) * 0.08;
        b.drag = 2;
        b.vx = speedAt(s.vx, tr.drag, 0, t) * 0.04;
        b.vy = speedAt(s.vy, tr.drag, -tr.gravity, t) * 0.04;
        b.vz = speedAt(s.vz, tr.drag, 0, t) * 0.04;
        b.lift = 0.9;
        // The trail thins toward its end: the fragment is burning out.
        const k = 1 - 0.5 * (t / tr.life);
        b.from = tr.from * s.size * k;
        b.to = tr.to * s.size * k * (0.8 + 0.4 * Math.random());
        b.tau = 0.35;
        b.life = tr.puffLife * (0.8 + 0.4 * Math.random());
        b.heat = tr.heat * k;
        b.hot = tr.hot;
        b.fade = 0.12;
        b.warm = 0.8;
        b.warmFor = 0.25;
        // Born already as old as the head is past this instant.
        b.age = s.age - t - dt;
      }
      if (s.next > tr.life) s.on = false;
    }
  }
}

/** What the top of any ground dries to — pulled toward, never reached. */
const PALE_DUST = Color3.FromHexString("#cfc4ae");
