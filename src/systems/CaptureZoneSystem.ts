/**
 * CaptureZoneSystem.ts — In-world markers for the Conquest control points: the
 * capture boundary LAID OUT on the ground the way whoever holds the place would
 * lay it — a ring of whitewashed stones on open ground, a painted line where
 * the ground is MADE (a carriageway, a deck, a paved slab) — and a FLAG on a
 * pole at the point itself (`FlagCloth`), flown in the holding side's colours
 * at the height the capture meter stands at.
 *
 * Invariants: this is dressing and nothing else — never `metadata.solid`,
 * never `checkCollisions`, never pickable, and never a WorldBox, so no ray test
 * (hitscan, LOS, ground probe) and no nav consumer can see it, and a body walks
 * over a boundary stone. Everything here is drawn in the cel material like the
 * world, so it is lit, shadowed, fogged and inked like the wall behind it and
 * owes no fade of its own. None of it casts (`noShadowCaster`): a stone's
 * shadow is a few centimetres, and the world's caster list is fixed before a
 * round's markers exist.
 *
 * The ring's radius IS the capture radius — both this and
 * `ConquestSystem.pointAt` read `ControlPointDef.radius`, so the stones you see
 * are the line the occupancy test uses. They are never laid inside a wall or a
 * blocking prop (`ObstacleField.wallAt`), so where the boundary crosses a
 * building the ring breaks, as a real one would.
 *
 * **Nothing on the ground says who holds the point, and that is the design**:
 * a painted glow ring was a game element drawn over the world, and ownership
 * is already said twice — by the HUD strip and by the flag.
 *
 * **The flag IS the meter**, which is why it is not merely dressing: it flies
 * at |meter| up the pole in the colours of the side the meter leans to, so a
 * flag being neutralised comes DOWN in its owner's colours, changes at the
 * foot of the pole, and goes back up in the attacker's — the capture read off
 * the world rather than off the HUD. A point nobody has leaned on flies a
 * plain canvas flag at the foot. The colours are the sides' WORN colours
 * through `teamLook`, the same cloth the soldiers wear.
 *
 * Never imports ConquestSystem: `update` takes the flag state structurally
 * (`ZoneState`), which `ControlPoint` satisfies, so Game can pass its points
 * straight through without this becoming a system-to-system import.
 *
 * build() once per round; update() every frame — the flag's visibility and
 * its cloth step are functions of the viewpoint.
 */
import {
  Color3,
  CreatePolyhedronVertexData,
  Matrix,
  Mesh,
  Scene,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { teamLook } from "../core/teamView";
import type { Team } from "../entities/Combatant";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { EnvironmentSpec } from "../world/environment";
import type { ControlPointDef } from "../world/MapBuilder";
import type { ObstacleField } from "../world/ObstacleField";
import type { RayHit, RayWorld } from "../world/RayWorld";
import { mulberry32 } from "../world/rng";
import {
  ROAD_DEPTH_UNITS,
  type RoadFootprint,
  roadTopAt,
} from "../world/roads";
import type { TerrainField } from "../world/TerrainField";
import {
  FlagCloth,
  MIN_POLE_HEIGHT,
  POLE_HEIGHT,
  ROOF_POLE_HEIGHT,
  type FlagColours,
} from "./FlagCloth";

/**
 * What a marker needs to know about its flag this frame. Structural on
 * purpose — see the header: `ConquestSystem.ControlPoint` satisfies it.
 */
export interface ZoneState {
  /** -1 (team 0 holds it) .. +1 (team 1 does). */
  meter: number;
}

/*
 * Marker geometry and colour. Art constants, so they live here rather than in
 * CONFIG — the capture radius they are drawn at is the gameplay number, and
 * that comes from the layout. (Same split as HUD.ts's ARC_* box geometry.)
 */
/** Metres of boundary per stone: close enough to read as a LINE, not a scatter. */
const STONE_SPACING = 0.95;
/** How far a stone strays either side of the boundary, and along it (in spacings). */
const STONE_JITTER_R = 0.07;
const STONE_JITTER_T = 0.22;
/** A stone's half-width, and the spread above it. Fist to a loaf. */
const STONE_SIZE = 0.13;
const STONE_SIZE_SPREAD = 0.09;
/** Height against width: laid stones are the flat ones, not the round ones. */
const STONE_SQUASH = 0.5;
const STONE_SQUASH_SPREAD = 0.25;
/** How far off level a stone sits, in radians either way. */
const STONE_TILT = 0.22;
/** Share of its height a stone is bedded into the ground, so none floats. */
const STONE_BED = 0.3;
/**
 * Whitewash, two coats' worth: limed stones are how a perimeter is marked by
 * people who have nothing but a bucket, and pale is what reads at range.
 */
const STONE_HEXES = ["#d3cdbc", "#bab3a1"] as const;
/** The painted line on made ground, and how far proud of it it is laid. */
const PAINT_HEX = "#b9b4a2";
const PAINT_HALF_WIDTH = 0.08;
const PAINT_STEP = 0.4;
const PAINT_LIFT = 0.018;
/**
 * A box top this far over the drawn terrain is MADE ground (a slab, a deck);
 * one more than a step over the flag's own level is something standing on
 * that ground rather than the ground itself; and one that does not carry on
 * `FLOOR_SPAN` metres every way at the same height is a crate or a wall top.
 */
const MADE_EPS = 0.03;
const SURFACE_REACH = 0.45;
const FLOOR_SPAN = 0.6;
const FLOOR_LEVEL = 0.08;
/** The band a box has to cross to be a wall a stone may not be laid in. */
const WALL_FLOOR = 0.12;
const WALL_CEILING = 1.5;

/**
 * The flag's cloth: a plain canvas for a point nobody leans on, and how much
 * darker a side's hoist band is than its field.
 */
const NEUTRAL_FLAG: FlagColours = { field: "#d4cdbd", band: "#8b857a" };
const BAND_SHADE = 0.55;
/**
 * How fast the flag runs up or down its pole, in meter-units per second. The
 * meter itself moves slower than this at any capture rate, so offline the
 * flag tracks it exactly; in a match it smooths the snapshot steps.
 */
const HOIST_RATE = 0.6;
/** A flag past the fog wall is neither drawn nor simulated. */
const FLAG_MARGIN = 4;
/**
 * The pole's clearance test (`mount`): it starts this far up so the floor
 * under it is not the answer, keeps this much air under whatever it would
 * meet, and a roof is looked for from this high over the point.
 */
const MOUNT_START = 0.3;
const MOUNT_ROOM = 0.3;
const MOUNT_SKY = 80;
const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const MOUNT_FROM = new Vector3();
const MOUNT_HIT: RayHit = {
  distance: 0,
  point: new Vector3(),
  normal: new Vector3(),
  surface: "hard",
  hull: null,
};

/** One flag's markers. */
interface Zone {
  x: number;
  z: number;
  /** The ring: a mesh per stone tone, and the paint. */
  meshes: Mesh[];
  flag: FlagCloth;
  /** The meter as the flag shows it — signed, rate-limited toward the real one. */
  shown: number;
  primed: boolean;
}

/** Where the ring lies at one point of it, and whether that ground is made. */
interface Lay {
  y: number;
  made: boolean;
}

/** One mesh's worth of triangles, filled stone by stone. */
interface Batch {
  positions: number[];
  normals: number[];
  indices: number[];
}

/**
 * Draws where the control points are and, more to the point, where their edges
 * are. A flag with no geometry around it is a flag: the HUD says one is being
 * taken and nothing on screen says whether you are standing in it.
 */
export class CaptureZoneSystem {
  private zones: Zone[] = [];
  private fogEnd = 1;
  /** A side's flag colours, derived once from its worn colour. */
  private flagColours = new Map<string, FlagColours>();
  /** Unit-radius stone shapes, made once — `CreatePolyhedronVertexData` types. */
  private protos = new Map<number, VertexData>();

  constructor(
    private scene: Scene,
    private mats: CelMaterialFactory,
  ) {}

  /**
   * Rebuilds every marker for a round. Takes the terrain AND the obstacle
   * boxes because a 28 m ring cannot be placed by one height
   * sample at the flag — the same reason a road is re-cut against the ground
   * rather than lifted rigidly. See `lay` below for which of them wins where.
   */
  build(
    points: readonly ControlPointDef[],
    terrain: TerrainField,
    obstacles: ObstacleField,
    roads: RoadFootprint,
    rays: RayWorld,
    env: EnvironmentSpec,
  ): void {
    this.dispose();
    this.fogEnd = env.fogEnd;

    for (const cp of points) {
      /**
       * What the ring lies on at one point along its circumference: the
       * surface you would STAND on, not the terrain.
       *
       * The terrain part uses `surfaceAt(..., true)` — the floor as drawn,
       * upper envelope — because the ground is flat triangles across a
       * bilinear field, and following the smooth field sinks a stone under
       * the mesh on every twisted cell. Most flags stand on something BUILT,
       * though — a paved square, a deck, Hollowmere's churchyard on its 2 m
       * plinth — and that is a box top the terrain has never heard of. So the
       * obstacle boxes are asked for the highest top up to a step over the
       * flag's own level (or over the floor, where a hillside rises past
       * it), and it is taken as the floor only when it is BROAD
       * (`floorAt`): the top of a crate or a garden wall is not where anybody
       * lays a boundary. Neither is the nav graph's height, which is sampled
       * per cell centre and resolved the churchyard's ring to the ground
       * under the plinth.
       *
       * A road is a sheet over the floor that nothing but a drawing knows is
       * there, so it is asked separately — and it is made ground too.
       */
      const lay = (x: number, z: number): Lay => {
        const floor = terrain.surfaceAt(x, z, true);
        const ceiling = Math.max(floor, cp.pos.y) + SURFACE_REACH;
        const deck = floorAt(obstacles, x, z, ceiling, floor + MADE_EPS);
        if (deck !== null) return { y: deck, made: true };
        const road = roadTopAt(roads, x, z);
        return { y: floor + road, made: road > 0 };
      };
      const walled = (x: number, z: number, y: number) =>
        obstacles.wallAt(x, z, y + WALL_FLOOR, y + WALL_CEILING);

      const rng = mulberry32(0x57a9e + this.zones.length * 7919);
      const meshes = [
        ...this.stones(cp, lay, walled, rng),
        ...this.paint(cp, lay, walled),
      ];

      // And the flag, which is what you navigate to — stood on the surface
      // the ring is, or on the roof over it (`mount`).
      const mount = this.mount(cp, lay(cp.pos.x, cp.pos.z).y, rays);
      const flag = new FlagCloth(
        this.scene,
        this.mats,
        `zone-${cp.id}`,
        cp.pos.x,
        mount.baseY,
        cp.pos.z,
        mount.height,
        this.zones.length + 1,
      );
      // Painted now rather than on the first `update`: a round is built under
      // the deploy screen, which draws the scene and steps no markers.
      flag.setColours(NEUTRAL_FLAG);

      this.zones.push({
        x: cp.pos.x,
        z: cp.pos.z,
        meshes,
        flag,
        shown: 0,
        primed: false,
      });
    }
  }

  /**
   * Flies each flag at this frame's meter. `points` is Game's live flag list
   * in build order; `viewer` is the camera, for the flag's fog gate and its
   * cloth's level of detail. The ring needs nothing: it is the world's.
   */
  update(
    dt: number,
    points: readonly ZoneState[],
    viewer: { x: number; z: number },
  ): void {
    const n = Math.min(points.length, this.zones.length);
    for (let i = 0; i < n; i++) {
      const zone = this.zones[i];
      const dx = zone.x - viewer.x;
      const dz = zone.z - viewer.z;
      this.flyFlag(zone, points[i], dt, Math.sqrt(dx * dx + dz * dz));
    }
  }

  dispose(): void {
    for (const zone of this.zones) {
      // The materials are the factory's cache and shared with the world.
      for (const m of zone.meshes) m.dispose();
      zone.flag.dispose();
    }
    this.zones = [];
  }


  /**
   * Where a flag's pole stands, and how tall it is.
   *
   * **A control point is often INDOORS** — Hollowmere's chapel, barn and dock
   * shed, a Greyfen house, three of Coldharbour's office floors — and a pole
   * cannot go through a ceiling the way the translucent beacon it replaced
   * did. So the pole asks the world, once, whether it has its height clear
   * over the floor; if it has not, the flag is flown from the ROOF of whatever
   * is over it, found by one cast straight down onto the point from above.
   * Either way a pole that would still meet something is cut short under it,
   * down to the shortest that can run the flag.
   *
   * `castBody`, not `castRound`: a glazed roof lets a round through and would
   * not let a pole.
   */
  private mount(
    cp: ControlPointDef,
    floorY: number,
    rays: RayWorld,
  ): { baseY: number; height: number } {
    const hit = MOUNT_HIT;
    const clear = (from: number, want: number) => {
      MOUNT_FROM.set(cp.pos.x, from + MOUNT_START, cp.pos.z);
      return rays.castBody(MOUNT_FROM, UP, want, hit)
        ? Math.max(MIN_POLE_HEIGHT, hit.distance + MOUNT_START - MOUNT_ROOM)
        : want;
    };
    const open = clear(floorY, POLE_HEIGHT);
    if (open >= POLE_HEIGHT) return { baseY: floorY, height: POLE_HEIGHT };
    MOUNT_FROM.set(cp.pos.x, floorY + MOUNT_SKY, cp.pos.z);
    if (!rays.castBody(MOUNT_FROM, DOWN, MOUNT_SKY, hit)) {
      return { baseY: floorY, height: open };
    }
    const roofY = hit.point.y;
    return { baseY: roofY, height: clear(roofY, ROOF_POLE_HEIGHT) };
  }

  /**
   * Runs the flag toward the meter and steps its cloth. The flag's height is
   * |meter| and its colours the side the meter leans to, so the colour changes
   * at the foot of the pole — where the meter crosses zero — and nowhere else.
   * The first frame a zone is seen it takes the meter outright: a player
   * joining a match mid-round sees the flags where they are, not rising.
   */
  private flyFlag(zone: Zone, p: ZoneState, dt: number, dist: number): void {
    if (!zone.primed) {
      zone.shown = p.meter;
      zone.primed = true;
    } else {
      const step = HOIST_RATE * dt;
      zone.shown += Math.max(-step, Math.min(step, p.meter - zone.shown));
    }
    const visible = dist < this.fogEnd + FLAG_MARGIN;
    zone.flag.setVisible(visible);
    if (!visible) return;
    const shown = zone.shown;
    zone.flag.setColours(
      shown < -1e-3
        ? this.coloursOf(0)
        : shown > 1e-3
          ? this.coloursOf(1)
          : NEUTRAL_FLAG,
    );
    if (zone.flag.inView()) zone.flag.update(dt, Math.abs(shown), dist);
  }

  /** A side's cloth: its worn colour, and a darker band at the hoist. */
  private coloursOf(team: Team): FlagColours {
    const field = teamLook(team).color;
    let c = this.flagColours.get(field);
    if (!c) {
      c = {
        field,
        band: Color3.FromHexString(field).scale(BAND_SHADE).toHexString(),
      };
      this.flagColours.set(field, c);
    }
    return c;
  }


  /**
   * The stones: one every `STONE_SPACING` metres of boundary that is open
   * ground, each a squashed polyhedron at its own size, yaw and lean, bedded
   * into the floor. Merged into one mesh per tone, so a ring is two draws
   * however many stones it has. Seeded, so a ring is the same ring every
   * load — the same rule as the scatter.
   */
  private stones(
    cp: ControlPointDef,
    lay: (x: number, z: number) => Lay,
    walled: (x: number, z: number, y: number) => boolean,
    rng: () => number,
  ): Mesh[] {
    const batches: Batch[] = STONE_HEXES.map(() => ({
      positions: [],
      normals: [],
      indices: [],
    }));
    const count = Math.max(
      12,
      Math.round((Math.PI * 2 * cp.radius) / STONE_SPACING),
    );
    const rot = Matrix.Identity();

    for (let i = 0; i < count; i++) {
      const th =
        ((i + (rng() - 0.5) * 2 * STONE_JITTER_T) / count) * Math.PI * 2;
      const r = cp.radius + (rng() - 0.5) * 2 * STONE_JITTER_R;
      const x = cp.pos.x + Math.sin(th) * r;
      const z = cp.pos.z + Math.cos(th) * r;
      // Drawn before any test so a skipped stone does not reshuffle the rest
      // of the ring: the same seed is the same stones whatever the world did.
      const size = STONE_SIZE + rng() * STONE_SIZE_SPREAD;
      const sx = size * (0.85 + rng() * 0.4);
      const sz = size * (0.85 + rng() * 0.3);
      const sy = size * (STONE_SQUASH + rng() * STONE_SQUASH_SPREAD);
      const yaw = rng() * Math.PI * 2;
      const pitch = (rng() - 0.5) * 2 * STONE_TILT;
      const roll = (rng() - 0.5) * 2 * STONE_TILT;
      const type = rng() < 0.5 ? 2 : 3;
      const tone = rng() < 0.7 ? 0 : 1;

      const ground = lay(x, z);
      if (ground.made || walled(x, z, ground.y)) continue;

      Matrix.RotationYawPitchRollToRef(yaw, pitch, roll, rot);
      this.addStone(
        batches[tone],
        this.proto(type),
        rot,
        sx,
        sy,
        sz,
        x,
        ground.y + sy * (1 - 2 * STONE_BED),
        z,
      );
    }
    return batches.flatMap((b, k) =>
      this.finish(`zone-${cp.id}-stones-${k}`, b, STONE_HEXES[k]),
    );
  }

  /**
   * The painted line: a narrow strip along the boundary wherever it crosses
   * made ground, broken wherever it meets a wall. Stones on a carriageway or
   * across an office floor would be somebody's barricade; paint is how a line
   * is drawn on a surface somebody built. It is laid proud of the surface and
   * biased toward the eye by the road's own depth offset, the problem a road
   * has against the floor under it (`ROAD_DEPTH_UNITS`).
   */
  private paint(
    cp: ControlPointDef,
    lay: (x: number, z: number) => Lay,
    walled: (x: number, z: number, y: number) => boolean,
  ): Mesh[] {
    const count = Math.max(
      24,
      Math.round((Math.PI * 2 * cp.radius) / PAINT_STEP),
    );
    const ys = new Float32Array(count);
    const on = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const th = (i / count) * Math.PI * 2;
      const x = cp.pos.x + Math.sin(th) * cp.radius;
      const z = cp.pos.z + Math.cos(th) * cp.radius;
      const ground = lay(x, z);
      ys[i] = ground.y + PAINT_LIFT;
      on[i] = ground.made && !walled(x, z, ground.y) ? 1 : 0;
    }

    const b: Batch = { positions: [], normals: [], indices: [] };
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      if (!on[i] || !on[j]) continue;
      const base = b.positions.length / 3;
      for (const k of [i, j]) {
        const th = (k / count) * Math.PI * 2;
        const sin = Math.sin(th);
        const cos = Math.cos(th);
        for (const r of [
          cp.radius - PAINT_HALF_WIDTH,
          cp.radius + PAINT_HALF_WIDTH,
        ]) {
          b.positions.push(cp.pos.x + sin * r, ys[k], cp.pos.z + cos * r);
          b.normals.push(0, 1, 0);
        }
      }
      // Both windings rather than reasoning about which one faces up: the
      // normal is stated, so whichever face survives the cull is lit as a
      // floor, and the other is culled rather than drawn over it.
      b.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      b.indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
    return this.finish(`zone-${cp.id}-paint`, b, PAINT_HEX, ROAD_DEPTH_UNITS);
  }

  /** A polyhedron scaled to unit radius, so a stone's size is its size. */
  private proto(type: number): VertexData {
    let data = this.protos.get(type);
    if (!data) {
      data = CreatePolyhedronVertexData({ type, size: 1 });
      const pos = data.positions!;
      let max = 0;
      for (let i = 0; i < pos.length; i += 3) {
        max = Math.max(max, Math.hypot(pos[i], pos[i + 1], pos[i + 2]));
      }
      data.positions = Array.from(pos, (v) => v / max);
      this.protos.set(type, data);
    }
    return data;
  }

  /**
   * One stone into a batch: scaled, turned and stood at (x, y, z). Normals go
   * through the inverse scale, which is what keeps a squashed stone's top
   * reading as a top rather than as a slope.
   */
  private addStone(
    b: Batch,
    proto: VertexData,
    rot: Matrix,
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
  ): void {
    const pos = proto.positions!;
    const nrm = proto.normals!;
    const base = b.positions.length / 3;
    const m = rot.m;
    for (let i = 0; i < pos.length; i += 3) {
      const px = pos[i] * sx;
      const py = pos[i + 1] * sy;
      const pz = pos[i + 2] * sz;
      b.positions.push(
        px * m[0] + py * m[4] + pz * m[8] + x,
        px * m[1] + py * m[5] + pz * m[9] + y,
        px * m[2] + py * m[6] + pz * m[10] + z,
      );
      const nx = nrm[i] / sx;
      const ny = nrm[i + 1] / sy;
      const nz = nrm[i + 2] / sz;
      const wx = nx * m[0] + ny * m[4] + nz * m[8];
      const wy = nx * m[1] + ny * m[5] + nz * m[9];
      const wz = nx * m[2] + ny * m[6] + nz * m[10];
      const len = Math.hypot(wx, wy, wz) || 1;
      b.normals.push(wx / len, wy / len, wz / len);
    }
    for (const index of proto.indices!) b.indices.push(base + index);
  }

  /**
   * A batch as a world-space mesh in the cel material, or nothing at all for
   * an empty one (a ring entirely indoors has no stones; one in a field has
   * no paint).
   */
  private finish(
    name: string,
    b: Batch,
    hex: string,
    depthUnits = 0,
  ): Mesh[] {
    if (b.indices.length === 0) return [];
    const mesh = new Mesh(name, this.scene);
    const data = new VertexData();
    data.positions = b.positions;
    data.normals = b.normals;
    data.indices = b.indices;
    data.applyToMesh(mesh);
    mesh.material = this.mats.get(hex, depthUnits);
    // Dressing, not world: out of every ray test and off the collidable list.
    // The paint is `noInk` by intent only — a sheet on a floor has no depth
    // step for the ink to find — and the stones are inked like any rock.
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.metadata =
      depthUnits === 0
        ? { noGlow: true, noShadowCaster: true }
        : { noInk: true, noGlow: true, noShadowCaster: true };
    mesh.freezeWorldMatrix();
    return [mesh];
  }
}

/**
 * The highest box top at (x, z) inside the band, when it is a FLOOR: the same
 * top carries on `FLOOR_SPAN` metres along both axes either way. Four more
 * bucket reads, once per stone at build time.
 */
function floorAt(
  obstacles: ObstacleField,
  x: number,
  z: number,
  ceiling: number,
  floor: number,
): number | null {
  const top = obstacles.groundAt(x, z, ceiling, floor);
  if (top === null) return null;
  for (const [dx, dz] of FLOOR_PROBES) {
    const there = obstacles.groundAt(x + dx, z + dz, ceiling, floor);
    if (there === null || Math.abs(there - top) > FLOOR_LEVEL) return null;
  }
  return top;
}

const FLOOR_PROBES = [
  [FLOOR_SPAN, 0],
  [-FLOOR_SPAN, 0],
  [0, FLOOR_SPAN],
  [0, -FLOOR_SPAN],
] as const;
