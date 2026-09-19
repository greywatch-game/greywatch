/**
 * CaptureZoneSystem.ts — In-world markers for the Conquest control points: a
 * terrain-following ring drawn ON the capture boundary, a skirt that rises
 * from the stretch of it you are about to cross, and a FLAG on a pole at the
 * point itself (`FlagCloth`), flown in the holding side's colours at the
 * height the capture meter stands at.
 *
 * Invariants: this is annotation geometry and nothing else — never
 * `metadata.solid`, never `checkCollisions`, never pickable, and never a
 * WorldBox, so no ray test (hitscan, LOS, ground probe) and no nav consumer
 * can see it. The ring and skirt set noInk/noGlow/noShadowCaster; the bloom
 * reads `noGlow` every frame, so a marker built mid-round is out of it too.
 * The flag and its pole are the exception to `noInk` only: they are drawn in
 * the cel material like the world, so they carry its line work too.
 *
 * The ring's radius IS the capture radius — both this and
 * `ConquestSystem.pointAt` read `ControlPointDef.radius`, so the line you see
 * is the line the occupancy test uses. Colours are the HUD/minimap ones and
 * are relative to the player's team, not absolute per side.
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
 * build() once per round; update() every frame AFTER the camera has moved —
 * both the fog fade and the skirt's reveal are functions of the viewpoint.
 */
import {
  Color3,
  Mesh,
  Scene,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { clamp01 } from "../core/math";
import { teamLook } from "../core/teamView";
import type { Team } from "../entities/Combatant";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { EnvironmentSpec } from "../world/environment";
import type { ControlPointDef } from "../world/MapBuilder";
import type { NavGrid } from "../world/NavGrid";
import type { RayHit, RayWorld } from "../world/RayWorld";
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
  owner: Team | null;
  /** -1 (team 0 holds it) .. +1 (team 1 does). */
  meter: number;
  contested: boolean;
  present: readonly [number, number];
}

/*
 * Marker geometry and colour. Art constants, so they live here rather than in
 * CONFIG — the capture radius they are drawn at is the gameplay number, and
 * that comes from the layout. (Same split as HUD.ts's ARC_* box geometry.)
 */
/** Half-width of the ground ring; it straddles the boundary. */
const RING_HALF_WIDTH = 0.55;
/** Clear of the floor, or the ring z-fights the surface it lies on. */
const RING_LIFT = 0.09;
/** The skirt above the ring: enough to read as a threshold, low enough to see over. */
const SKIRT_HEIGHT = 1.9;
/** Alpha at the bottom of each piece; the skirt fades out upward. */
const RING_ALPHA = 0.8;
const SKIRT_ALPHA = 0.42;
/** Ring segments per metre of radius, clamped — a 12 m ring must not be a polygon. */
const SEGMENTS_PER_M = 4;
const MIN_SEGMENTS = 40;
const MAX_SEGMENTS = 96;

/**
 * How near a stretch of boundary has to be before its skirt shows: full
 * strength within `SKIRT_FULL` metres of it, gone by `SKIRT_FADE`.
 */
const SKIRT_FULL = 4;
const SKIRT_FADE = 13;

/** Owner colours, matching the HUD flag strip and the minimap exactly. */
const COLOR_MINE = "#ffc46b";
const COLOR_THEIRS = "#ff5a4f";
const COLOR_NEUTRAL = "#c2c7d0";
/** The same three, parsed once — `update` runs on every flag every frame. */
const RGB_MINE = Color3.FromHexString(COLOR_MINE);
const RGB_THEIRS = Color3.FromHexString(COLOR_THEIRS);
const RGB_NEUTRAL = Color3.FromHexString(COLOR_NEUTRAL);
/** Ownership changes hands in an instant; the colour crossfades. */
const COLOR_RATE = 5;

/** Pulse: fast and deep while both teams are on it, slow while it is moving. */
const CONTESTED_RATE = 9;
const CONTESTED_DEPTH = 0.45;
const CAPTURING_RATE = 3.4;
const CAPTURING_DEPTH = 0.22;

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

/** One piece of one flag's markers. */
interface Marker {
  mesh: Mesh;
  mat: StandardMaterial;
  /** Alpha at full strength — the pulse and the fog scale this. */
  alpha: number;
}

/** One flag's markers. */
interface Zone {
  x: number;
  z: number;
  radius: number;
  markers: Marker[];
  /**
   * The skirt's vertex colours and the ground position of each of its
   * segments, kept for the per-frame reveal (`revealSkirt`).
   */
  skirt: { mesh: Mesh; colors: Float32Array; points: Float32Array };
  /** Current colour, crossfaded toward the owner's. */
  color: Color3;
  flag: FlagCloth;
  /** The meter as the flag shows it — signed, rate-limited toward the real one. */
  shown: number;
  primed: boolean;
}

/** One ring of vertices in a band: where it sits and how solid it is there. */
interface Loop {
  radius: number;
  /** Height above the sampled ground. */
  lift: number;
  alpha: number;
}

/**
 * Draws where the control points are and, more to the point, where their edges
 * are. A flag with no geometry is invisible from the ground: the HUD says one
 * is being taken and nothing on screen says whether you are standing in it.
 */
export class CaptureZoneSystem {
  private zones: Zone[] = [];
  private fogStart = 0;
  private fogEnd = 1;
  private t = 0;
  /** A side's flag colours, derived once from its worn colour. */
  private flagColours = new Map<string, FlagColours>();

  constructor(
    private scene: Scene,
    private mats: CelMaterialFactory,
  ) {}

  /**
   * Rebuilds every marker for a round. Takes the terrain AND the nav graph
   * because a 28 m ring cannot be placed by one height sample at the flag —
   * the same reason a road is re-cut against the ground rather than lifted
   * rigidly. See `ground` below for which of the two wins where.
   */
  build(
    points: readonly ControlPointDef[],
    terrain: TerrainField,
    nav: NavGrid,
    rays: RayWorld,
    env: EnvironmentSpec,
  ): void {
    this.dispose();
    this.fogStart = env.fogStart;
    this.fogEnd = env.fogEnd;

    for (const cp of points) {
      /**
       * Where the ring lies at one point along its circumference: the surface
       * you would STAND on, not the terrain.
       *
       * The terrain part uses `surfaceAt(..., true)` — the floor as drawn,
       * upper envelope — because the ground is flat triangles across a
       * bilinear field, and following the smooth field sinks the ring under
       * the mesh on every twisted cell. That alone is not enough: every flag
       * but one sits on a paved square or a deck, and a slab's top face is
       * above the terrain it stands on, so a terrain-only ring is buried by
       * the very surface the player is walking on. The nav graph already
       * knows those heights — resolved nearest the flag's own y, so a ring
       * crossing a bridge takes the deck rather than the creek floor.
       */
      const ground = (x: number, z: number) => {
        const floor = terrain.surfaceAt(x, z, true);
        const surface = nav.surfaceAt(x, cp.pos.y, z);
        return surface < 0 ? floor : Math.max(floor, nav.heightOf(surface));
      };

      const segs = Math.max(
        MIN_SEGMENTS,
        Math.min(MAX_SEGMENTS, Math.round(cp.radius * SEGMENTS_PER_M)),
      );

      // The boundary itself, as a band lying on the ground.
      const ring = this.band(
        `zone-${cp.id}-ring`,
        cp,
        { radius: cp.radius - RING_HALF_WIDTH, lift: RING_LIFT, alpha: 1 },
        { radius: cp.radius + RING_HALF_WIDTH, lift: RING_LIFT, alpha: 1 },
        segs,
        ground,
        RING_ALPHA,
      );
      // A skirt above it: a ring seen from ground level is a line on the floor
      // and reads as dressing. A wall you walk through reads as a threshold.
      const skirt = this.band(
        `zone-${cp.id}-skirt`,
        cp,
        { radius: cp.radius, lift: RING_LIFT, alpha: 1 },
        { radius: cp.radius, lift: RING_LIFT + SKIRT_HEIGHT, alpha: 0 },
        segs,
        ground,
        SKIRT_ALPHA,
        true,
      );
      // And the flag, which is what you navigate to — stood on the surface
      // the ring is, or on the roof over it (`mount`).
      const mount = this.mount(cp, ground(cp.pos.x, cp.pos.z), rays);
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
        radius: cp.radius,
        markers: [ring.marker, skirt.marker],
        skirt: {
          mesh: skirt.marker.mesh,
          colors: skirt.colors,
          points: skirt.points,
        },
        color: Color3.FromHexString(COLOR_NEUTRAL),
        flag,
        shown: 0,
        primed: false,
      });
    }
  }

  /**
   * Pushes this frame's ownership onto the markers. `points` is Game's live
   * flag list in build order; `viewer` is the camera, for the fog fade and
   * the skirt's reveal.
   */
  update(
    dt: number,
    points: readonly ZoneState[],
    playerTeam: Team,
    viewer: { x: number; z: number },
  ): void {
    this.t += dt;
    const n = Math.min(points.length, this.zones.length);
    const lerp = Math.min(1, dt * COLOR_RATE);

    for (let i = 0; i < n; i++) {
      const p = points[i];
      const zone = this.zones[i];

      const target =
        p.owner === null
          ? RGB_NEUTRAL
          : p.owner === playerTeam
            ? RGB_MINE
            : RGB_THEIRS;
      Color3.LerpToRef(zone.color, target, lerp, zone.color);

      // Contested beats capturing: both teams standing on it is the thing
      // worth catching from the corner of the eye.
      let pulse = 1;
      if (p.contested) {
        pulse = 1 - CONTESTED_DEPTH * wave(this.t * CONTESTED_RATE);
      } else if (p.present[0] + p.present[1] > 0 && Math.abs(p.meter) < 1) {
        pulse = 1 - CAPTURING_DEPTH * wave(this.t * CAPTURING_RATE);
      }

      const dx = zone.x - viewer.x;
      const dz = zone.z - viewer.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const fade =
        1 -
        clamp01(
          (dist - this.fogStart) / Math.max(1, this.fogEnd - this.fogStart),
        );

      for (const m of zone.markers) {
        const alpha = m.alpha * pulse * fade;
        m.mat.alpha = alpha;
        m.mat.emissiveColor.copyFrom(zone.color);
        // Nothing to draw is worth a draw call saved: at village scale most
        // of the flags are behind the fog wall most of the time.
        m.mesh.setEnabled(alpha > 0.01);
      }

      // The skirt is a cylinder around the player, so from inside a zone you
      // are always looking THROUGH its far side — at any alpha that reads as a
      // wall, that is a white wash over the whole screen. Revealing only the
      // stretch you are near fixes both halves of that: no wash, and the piece
      // that does show is the piece you are about to walk through.
      if (zone.skirt.mesh.isEnabled()) {
        this.revealSkirt(zone, viewer);
      }

      this.flyFlag(zone, p, dt, dist);
    }
  }

  dispose(): void {
    for (const zone of this.zones) {
      for (const m of zone.markers) {
        m.mesh.dispose();
        m.mat.dispose();
      }
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
    if (zone.flag.inView()) zone.flag.update(dt, Math.abs(shown));
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
   * Rewrites the skirt's per-vertex alpha from the viewer's distance to each
   * segment. Cheap by construction — one square root per segment, ~56 of them
   * per flag, and only for flags close enough to be drawn at all.
   */
  private revealSkirt(zone: Zone, viewer: { x: number; z: number }): void {
    const { mesh, colors, points } = zone.skirt;
    const segs = points.length / 2;
    for (let i = 0; i < segs; i++) {
      const dx = points[i * 2] - viewer.x;
      const dz = points[i * 2 + 1] - viewer.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      // Vertices come in (bottom, top) pairs of 4 floats; the top is always
      // fully transparent, so only the bottom's alpha is worth writing.
      const u = clamp01((d - SKIRT_FULL) / (SKIRT_FADE - SKIRT_FULL));
      // Smoothstep, not linear: a linear reveal puts a visible vertical seam
      // down the skirt where the falloff starts, which reads as a pane of
      // glass rather than as the boundary catching the light.
      colors[i * 8 + 3] = 1 - u * u * (3 - 2 * u);
    }
    mesh.updateVerticesData(VertexBuffer.ColorKind, colors);
  }

  /**
   * A closed band between two rings of vertices, in world space.
   *
   * Winding is deliberately not reasoned about: the material is unlit and
   * two-sided, so there is no normal to get backwards and no face to cull.
   * That is a licence this file has and the world layer does not — a
   * hand-wound floor with downward normals is the failure `assertFacesUp`
   * exists to catch.
   *
   * Vertex alpha carries the shape's own gradient (a skirt fading out at the
   * top, and its reveal); the material's alpha carries the state (pulse and
   * fog), so the two multiply and neither has to know about the other.
   */
  private band(
    name: string,
    cp: ControlPointDef,
    a: Loop,
    b: Loop,
    segs: number,
    groundAt: (x: number, z: number) => number,
    alpha: number,
    updatable = false,
  ): { marker: Marker; colors: Float32Array; points: Float32Array } {
    const positions: number[] = [];
    const colors = new Float32Array(segs * 8);
    const points = new Float32Array(segs * 2);
    const indices: number[] = [];

    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const sin = Math.sin(th);
      const cos = Math.cos(th);
      const loops = [a, b];
      for (let k = 0; k < 2; k++) {
        const loop = loops[k];
        const x = cp.pos.x + sin * loop.radius;
        const z = cp.pos.z + cos * loop.radius;
        positions.push(x, groundAt(x, z) + loop.lift, z);
        // RGB is ignored — diffuse is black and the colour comes from the
        // material's emissive. Only the alpha channel is doing work here.
        colors.set([1, 1, 1, loop.alpha], i * 8 + k * 4);
      }
      // The band's own ground track, at the first loop's radius: what the
      // skirt's reveal measures its distance to.
      points[i * 2] = cp.pos.x + sin * a.radius;
      points[i * 2 + 1] = cp.pos.z + cos * a.radius;
    }
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      indices.push(i * 2, i * 2 + 1, j * 2, j * 2, i * 2 + 1, j * 2 + 1);
    }

    const mesh = new Mesh(name, this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.colors = Array.from(colors);
    data.indices = indices;
    data.applyToMesh(mesh, updatable);
    mesh.hasVertexAlpha = true;

    const mat = new StandardMaterial(`${name}-mat`, this.scene);
    mat.emissiveColor = Color3.FromHexString(COLOR_NEUTRAL);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    // A marker must never hide what it marks — or the other markers behind it.
    mat.disableDepthWrite = true;
    mat.alpha = alpha;
    mesh.material = mat;

    // Annotation, not world: out of every ray test and off the collidable list.
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.metadata = { noInk: true, noGlow: true, noShadowCaster: true };
    mesh.freezeWorldMatrix();

    return { marker: { mesh, mat, alpha }, colors, points };
  }
}

/** 0..1 pulse; 0 at t = 0, so a marker starts at full strength. */
function wave(t: number): number {
  return 0.5 - 0.5 * Math.cos(t);
}
