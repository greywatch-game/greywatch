/**
 * kit/buildings.ts — The big enterable/landmark buildings: cottage, townhouse,
 * tavern, smithy, ruin, watchtower, chapel, barn, mill, boathouse, gatehouse,
 * stiltHut, jungleRuin.
 * All follow the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata).
 */
import { Scene, VertexData } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  AWNING,
  BRICK,
  CITY_BRICK,
  CREEPER,
  DARK_STONE,
  EMBER,
  FLAME,
  GUARD_THICKNESS,
  IRON,
  MOSS_STONE,
  PLANK,
  PLASTER,
  SLATE,
  STONE,
  STUCCO,
  TEAK,
  THATCH,
  TIMBER,
  VERDIGRIS,
} from "./core";

// --- the village elevations ------------------------------------------------
//
// Four small words the cottage and the townhouse are drawn in, because each
// lays the same member on four faces. Everything they make is VISUAL: the
// masses and the roof already carry every collider either building has, and
// nothing here may add one — see the header on `buildTownhouse`.

/** Which way an elevation faces. Fixes both the axis and the outward sign. */
type Side = "-z" | "+z" | "-x" | "+x";

/** An opening in an elevation, frame and all, in that face's own (u, y). */
interface Hole {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
}

/**
 * The glass of a window with nobody behind it. Not a hole and not a pane:
 * the building is a solid mass, so what is behind the frame is plaster, and a
 * real sheet there would buy a reflection probe on every block a townhouse
 * stands in for a window nobody can see through anyway (`PaneSpec`).
 */
const CASEMENT = "#272c2d";
/** A lit room behind the same glass — the lamp colour the village has always had. */
const LAMPLIT = "#ffb257";
/**
 * A lit SHOP window, which is the same room behind four times the glass. At
 * `LAMPLIT` a 4 m frontage bloomed into a lantern under Harrowmead's low sun —
 * `ROOM_GLOW`'s argument, that what an emissive may be is set by its AREA —
 * so the wide one is a step down and still reads as the same lamps.
 */
const SHOPLIT = "#b3733a";
/**
 * What a street paints its doors and shutters, walked by a seed off the
 * placement's own size. Every one is a colour the kit already has, so a row of
 * them costs palette slots the map has spent anyway.
 */
const DOOR_PAINTS = [PLANK, TEAK, VERDIGRIS, AWNING] as const;

const outward = (s: Side): number => (s === "+z" || s === "+x" ? 1 : -1);
const runsAlongX = (s: Side): boolean => s === "-z" || s === "+z";

/**
 * Which house in the street this is, as a number: the placement's position and
 * size hashed together, so two neighbours of one size still come out different
 * and a rebuild of the same layout always comes out the same.
 *
 * The position is what makes the builder a function of WHERE it stands, and
 * that is what puts `townhouse` and `cottage` in `CONFORMS_TO_TERRAIN` —
 * without it the editor would translate a dragged house and leave it wearing
 * the door of the spot it left. Absent (a caller with no placement), the size
 * alone decides.
 */
function streetSeed(w: number, d: number, h: number, ctx?: BuildCtx): number {
  let x =
    Math.imul(Math.round((ctx?.x ?? 0) * 10), 73856093) ^
    Math.imul(Math.round((ctx?.z ?? 0) * 10), 19349663) ^
    Math.imul(Math.round(w * 100 + d * 37 + h * 1000), 83492791);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Every interval of `[a, b]` left once each cut is taken out of it. */
function carve(a: number, b: number, cuts: [number, number][]): [number, number][] {
  let out: [number, number][] = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [s0, s1] of out) {
      if (c1 <= s0 || c0 >= s1) {
        next.push([s0, s1]);
        continue;
      }
      if (c0 > s0) next.push([s0, c0]);
      if (c1 < s1) next.push([c1, s1]);
    }
    out = next;
  }
  return out;
}

/**
 * A member laid ON a face: `along` the run, `tall` up it and `thick` through
 * it, with its centre `out` past the face plane at `plane` and `u` along the
 * run. `tilt` leans it in the face's own plane, rising toward +u.
 *
 * The two axes take opposite rotation signs for the same lean — Babylon's
 * `RotationZ` lifts +x and its `RotationX` drops +z — which is the whole
 * reason this is a function rather than a `b.box` at every call.
 */
function onFace(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  y: number,
  along: number,
  tall: number,
  thick: number,
  out: number,
  color: string,
  tilt = 0,
): void {
  const c = outward(s) * (plane + out);
  if (runsAlongX(s)) b.box(along, tall, thick, u, y, c, color, tilt ? { z: tilt } : undefined);
  else b.box(thick, tall, along, c, y, u, color, tilt ? { x: -tilt } : undefined);
}

/**
 * A member standing OUT from a face, running from `r0` to `r1` past its plane
 * and from `y0` to `y1` as it goes: a bracket under the jetty, a stall board,
 * a sign's arm. `along` is its width on the run and `thick` its depth
 * vertically.
 */
function offFace(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  along: number,
  y0: number,
  y1: number,
  r0: number,
  r1: number,
  thick: number,
  color: string,
): void {
  const n = outward(s);
  const rise = Math.atan2(y1 - y0, r1 - r0);
  const len = Math.hypot(r1 - r0, y1 - y0);
  const c = n * (plane + (r0 + r1) / 2);
  const y = (y0 + y1) / 2;
  if (runsAlongX(s)) b.box(along, thick, len, u, y, c, color, rise ? { x: -n * rise } : undefined);
  else b.box(len, thick, along, c, y, u, color, rise ? { z: n * rise } : undefined);
}

/**
 * A casement: the glass (dark, or lamplit), a frame standing proud of the
 * plaster, a sill board, and mullions and a transom — which are what turn a
 * glowing rectangle into a window, the mill's argument about framing a lit
 * pane carried one step further. `lit` names the lamplight behind the glass,
 * and `shutters` the leaves' paint, throwing a pair back flat on the wall.
 */
function casement(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  sill: number,
  ww: number,
  wh: number,
  o: { lit?: string; shutters?: string; lights?: number } = {},
): Hole {
  const top = sill + wh;
  const mid = sill + wh / 2;
  if (o.lit) {
    const c = outward(s) * (plane + 0.015);
    if (runsAlongX(s)) b.glow(ww, wh, 0.05, u, mid, c, o.lit);
    else b.glow(0.05, wh, ww, c, mid, u, o.lit);
  } else {
    onFace(b, s, plane, u, mid, ww, wh, 0.06, 0.01, CASEMENT);
  }
  for (const k of [-1, 1]) {
    onFace(b, s, plane, u + k * (ww / 2 + 0.06), mid + 0.07, 0.12, wh + 0.14, 0.16, 0.04, TIMBER);
  }
  onFace(b, s, plane, u, top + 0.07, ww + 0.24, 0.14, 0.16, 0.04, TIMBER);
  onFace(b, s, plane, u, sill - 0.06, ww + 0.4, 0.12, 0.26, 0.09, TIMBER);
  const lights = o.lights ?? (ww > 0.75 ? 2 : 1);
  for (let i = 1; i < lights; i++) {
    onFace(b, s, plane, u - ww / 2 + (i * ww) / lights, mid, 0.07, wh, 0.1, 0.04, TIMBER);
  }
  onFace(b, s, plane, u, sill + wh * 0.7, ww, 0.07, 0.1, 0.04, TIMBER);

  let reach = ww / 2 + 0.12;
  if (o.shutters) {
    const leaf = ww / 2;
    for (const k of [-1, 1]) {
      const lu = u + k * (ww / 2 + 0.14 + leaf / 2);
      onFace(b, s, plane, lu, mid, leaf, wh, 0.06, 0.04, o.shutters);
      for (const y of [sill + 0.22, top - 0.22]) {
        onFace(b, s, plane, lu, y, leaf - 0.08, 0.09, 0.03, 0.085, TIMBER);
      }
    }
    reach += leaf + 0.04;
  }
  return { u0: u - reach, u1: u + reach, y0: sill - 0.12, y1: top + 0.14 };
}

/**
 * A doorway on the plinth: jambs, a head, a stone step, and — when `leaf`
 * names a paint — a ledged door shut in it, with its seams, its strap hinges
 * and its latch. `null` draws the frame alone, round an opening the walls
 * have already left (an enterable ground floor's).
 */
function doorway(
  b: Build,
  s: Side,
  plane: number,
  stepPlane: number,
  u: number,
  dw: number,
  dh: number,
  leaf: string | null,
): Hole {
  const foot = 0.3; // the plinth's top
  const top = foot + dh;
  for (const k of [-1, 1]) {
    onFace(b, s, plane, u + k * (dw / 2 + 0.09), (foot + top + 0.2) / 2, 0.18, dh + 0.2, 0.18, 0.05, TIMBER);
  }
  onFace(b, s, plane, u, top + 0.1, dw + 0.46, 0.2, 0.18, 0.05, TIMBER);
  onFace(b, s, stepPlane, u, 0.08, dw + 0.5, 0.16, 0.4, 0.2, DARK_STONE);
  if (leaf) {
    const mid = foot + dh / 2;
    onFace(b, s, plane, u, mid, dw, dh, 0.06, 0.02, leaf);
    for (let k = 1; k < 4; k++) {
      onFace(b, s, plane, u - dw / 2 + (k * dw) / 4, mid, 0.025, dh - 0.06, 0.02, 0.055, TIMBER);
    }
    for (const y of [foot + 0.4, top - 0.4]) {
      onFace(b, s, plane, u - dw * 0.12, y, dw * 0.72, 0.07, 0.02, 0.065, IRON);
    }
    onFace(b, s, plane, u + dw * 0.36, foot + dh * 0.48, 0.07, 0.12, 0.04, 0.07, IRON);
  }
  return { u0: u - dw / 2 - 0.2, u1: u + dw / 2 + 0.2, y0: 0, y1: top + 0.2 };
}

/**
 * The frame of one storey on one face, between its corner posts: posts at a
 * pitch, an optional rail, and a brace in each end panel — every member
 * stopped at an opening rather than drawn across it, which is what a real
 * frame does, since the window was framed into it.
 *
 * `close` is close studding, the street front's display; `panel` is square
 * framing with a brace at each end, what the other three faces are built in.
 * A post that would only graze an opening's frame is left out rather than
 * drawn as a sliver beside it.
 */
function framing(
  b: Build,
  s: Side,
  plane: number,
  half: number,
  y0: number,
  y1: number,
  rail: number | null,
  holes: Hole[],
  style: "close" | "panel",
): void {
  const inner = half - 0.22; // the corner posts' inner edge
  const pitch = style === "close" ? 0.52 : 1.35;
  const pw = style === "close" ? 0.15 : 0.2;
  const n = Math.max(1, Math.round((2 * inner) / pitch));
  const posts: number[] = [];
  for (let i = 1; i < n; i++) {
    const u = -inner + (i * 2 * inner) / n;
    const hit = holes.filter((h) => u + pw / 2 > h.u0 - 0.06 && u - pw / 2 < h.u1 + 0.06);
    if (hit.some((h) => u < h.u0 + 0.1 || u > h.u1 - 0.1)) continue;
    posts.push(u);
    const cuts = hit.map((h): [number, number] => [h.y0, h.y1]);
    for (const [a, c] of carve(y0, y1, cuts)) {
      if (c - a > 0.15) onFace(b, s, plane, u, (a + c) / 2, pw, c - a, 0.14, 0.03, TIMBER);
    }
  }
  if (rail !== null) {
    const cuts = holes
      .filter((h) => rail + 0.08 > h.y0 && rail - 0.08 < h.y1)
      .map((h): [number, number] => [h.u0, h.u1]);
    for (const [a, c] of carve(-inner, inner, cuts)) {
      if (c - a > 0.15) onFace(b, s, plane, (a + c) / 2, rail, c - a, 0.16, 0.14, 0.03, TIMBER);
    }
  }
  if (style !== "panel") return;
  // A brace in each end panel, high at the corner and low toward the middle,
  // in the deeper of the two bands the rail leaves (or the whole storey).
  let lo = y0 + 0.02;
  let hi = y1 - 0.02;
  if (rail !== null) {
    if (rail - y0 > y1 - rail) hi = rail - 0.08;
    else lo = rail + 0.08;
  }
  for (const k of [-1, 1]) {
    const edge = k * inner;
    const next = posts.length ? (k > 0 ? posts[posts.length - 1] : posts[0]) : 0;
    const span = Math.abs(edge - next) - 0.1;
    if (span < 0.5) continue;
    const uIn = edge - k * span;
    const [ua, ub] = k > 0 ? [uIn, edge] : [edge, uIn];
    if (holes.some((h) => h.u1 > ua - 0.05 && h.u0 < ub + 0.05 && h.y1 > lo && h.y0 < hi)) continue;
    const du = edge - uIn;
    const dy = hi - lo;
    onFace(b, s, plane, (edge + uIn) / 2, (lo + hi) / 2, Math.hypot(du, dy), 0.16, 0.12, 0.02, TIMBER, Math.atan2(dy, du));
  }
}

/** Planks nailed across an opening, alternately canted: a house nobody is coming back to. */
function boardUp(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  y0: number,
  y1: number,
  across: number,
  out: number,
): void {
  const n = Math.max(2, Math.round((y1 - y0) / 0.55));
  for (let i = 0; i < n; i++) {
    const y = y0 + ((i + 0.5) * (y1 - y0)) / n;
    onFace(b, s, plane, u, y, across + 0.3, 0.17, 0.04, out, PLANK, (i % 2 === 0 ? 1 : -1) * 0.13);
  }
}

type Point3 = readonly [number, number, number];

/**
 * A convex solid between two matching faces — `from[i]` joined to `to[i]` —
 * for the shapes a box cannot be: a coat of thatch cut vertical at the eave
 * where a box would be cut square to the slope, and the teeth along a ridge.
 *
 * Each face carries its own vertices, so the normals come out flat and the ink
 * finds its edges as it finds a box's. Every triangle is wound by testing it
 * against the solid's own centroid rather than by the order the caller walked
 * the outline in, which is what lets one helper take a face walked either way
 * round and a mirrored copy of it — the winding is `gableEnd`'s (Babylon's
 * left-handed default), and getting it wrong by hand fails silently.
 */
function convexSolid(b: Build, from: Point3[], to: Point3[], color: string): void {
  const all = [...from, ...to];
  const c = [0, 1, 2].map((i) => all.reduce((sum, p) => sum + p[i], 0) / all.length);
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const face = (pts: Point3[]): void => {
    const f = [0, 1, 2].map((i) => pts.reduce((sum, p) => sum + p[i], 0) / pts.length);
    for (let i = 1; i + 1 < pts.length; i++) {
      let [p, q, r] = [pts[0], pts[i], pts[i + 1]];
      const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (n[0] * (f[0] - c[0]) + n[1] * (f[1] - c[1]) + n[2] * (f[2] - c[2]) < 0) [q, r] = [r, q];
      for (const vtx of [p, q, r]) {
        positions.push(vtx[0], vtx[1], vtx[2]);
        uvs.push(vtx[0], vtx[1]);
        indices.push(indices.length);
      }
    }
  };
  face(from);
  face(to);
  for (let i = 0; i < from.length; i++) {
    const j = (i + 1) % from.length;
    face([from[i], from[j], to[j], to[i]]);
  }
  const data = new VertexData();
  data.positions = positions;
  data.uvs = uvs;
  data.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  b.surface(data, color);
}

/**
 * A cottage roof's pitch, as rise over run. A property of THATCH rather than
 * of the house — a coat of reed sheds water only at about this angle — so it is
 * one number for every width, and a wider cottage is a taller roof.
 */
const THATCH_PITCH = 0.62;
/** How deep a coat of thatch is, which is what its eave and verge read as. */
const THATCH_DEPTH = 0.4;
/**
 * What a burnt roof's rafters reach as a fraction of their run, walked in
 * order from a seeded start — `buildBarn`'s board widths, for the same reason.
 */
const RAFTER_REMAINS = [1, 0.5, 0.85, 0.3, 1, 0.65, 0.4] as const;

/**
 * Village house: a timber frame filled with plaster under a thick thatch, a
 * stack on the ridge and a door in the gable end. The workhorse — most of
 * Hollowmere is these at varying sizes, and Cinderhaven places 178.
 *
 * Solid by default. Enterable cottages cost four extra colliders and a hole in
 * the nav grid, so only the ones worth fighting over get interiors.
 *
 * **The masses are the building's and the detail is the drawing, and only the
 * masses carry a collider** — the townhouse's rule, whose header argues it. The
 * block below is every collider a cottage has ever had, in the order it has
 * always emitted them, and the roof's is still the flat slab `gableRoof` laid
 * at the eaves with 0.35 of overhang: the thatch drawn over it is this builder's
 * own, because `gableRoof` draws a 0.18 m board and closes each end in roof
 * colour, and neither is thatch. So a change below that block owes no `npm run
 * collision`, and one inside it does.
 *
 * What the drawing is FOR is that the old one was a plaster box with a stripe
 * round it: no door on a house you could not enter, two glowing rectangles
 * with no frame, a gable end in roof colour and a roof as thin as a door. It is
 * now the things a thatched cottage is recognised by, each in the frame's own
 * vocabulary so the ink finds it:
 *
 * - **The thatch is DEEP, and cut PLUMB.** `THATCH_DEPTH` at
 *   `THATCH_PITCH`, trimmed vertical at the eave and the verge (`coat`) where a
 *   box is cut square to the slope and reads as a board, its eave rolled, two
 *   courses stepping down the slope, and a block-cut ridge — a raised cap with
 *   the points cut along its lower edge, pinned by two liggers, over a roll. **The roof is taller than it was and its collider is not**: a
 *   round through the roof above the eaves slab passed before this too, over
 *   1.5 m of rise rather than about two.
 * - **The frame is on every face**, bedded on it (`gx`/`gz`, which an
 *   enterable cottage sets half a wall further out, exactly as the townhouse's
 *   ground floor does): sole plate, corner posts, a rail and braces, and the
 *   tie beam each gable stands on.
 * - **The gables are wall**, plaster with a collar and a king post, their top
 *   edges buried in the thatch, and an attic light in the front one.
 * - **Every elevation has an opening**: the front door (ledged, or a frame
 *   round an enterable one's doorway) between two casements, one or two more
 *   down each side, a back door on a solid one, and a stack on the ridge kept
 *   inside the thatch so it needs no collider and shows nothing from inside.
 *
 * **The variation is seeded off where it stands** (`streetSeed`, which is what
 * puts `cottage` in `CONFORMS_TO_TERRAIN`): the door and shutter paint, whether
 * the front windows are shuttered, a thatched hood over the door, which end the
 * stack is at, and which side the back door is. Never close studding, which is
 * a street front's display and on a cottage's small front is all posts.
 *
 * **A ruin is BURNT, not merely roofless**: one slope and the back gable gone
 * to charred rafters and a heap under the eaves, what is left of the thatch
 * torn off ragged, and every opening boarded — which also answers why a round
 * stops on a window, since a ruined cottage is still a solid block.
 */
export function buildCottage(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const w = p.width ?? 7;
  const d = p.depth ?? 6;
  const h = p.height ?? 3.4;
  const b = new Build(scene, mats, "cottage");
  const t = 0.35;
  const open = p.enterable === true;
  const ruined = p.ruined === true;
  const lit = p.litWindows && !ruined ? LAMPLIT : undefined;

  // ------------------------------------------------------------ the masses
  //
  // Every collider this building has. See the header before adding to it.
  b.box(w + 0.4, 0.3, d + 0.4, 0, 0.15, 0, DARK_STONE); // plinth
  if (open) {
    // Proud of the plinth — see buildTavern's floor. It used to sit 0.1 under
    // it, which floored the room in plinth stone.
    b.box(w, 0.2, d, 0, 0.24, 0, PLANK);
    b.doorWall(w, h, t, 0, h / 2, -d / 2, PLASTER, 1.6, 2.2);
    b.wall(w, h, t, 0, h / 2, d / 2, PLASTER);
    b.wall(t, h, d, -w / 2, h / 2, 0, PLASTER);
    b.wall(t, h, d, w / 2, h / 2, 0, PLASTER);
  } else {
    // A solid block reads identically from outside and costs one collider.
    b.box(w, h, d, 0, h / 2, 0, PLASTER);
    b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  }
  if (ruined) b.block({ w: w + 0.6, h: 0.3, d: d + 0.6, x: 0, y: h, z: 0 });
  else b.block({ w: w + 0.7, h: 0.3, d: d + 0.7, x: 0, y: h, z: 0 });

  // ----------------------------------------------------------- the drawing
  const seed = streetSeed(w, d, h, ctx);
  const paint = DOOR_PAINTS[(seed >>> 20) % DOOR_PAINTS.length];
  const shuttered = ((seed >>> 13) & 3) !== 0;
  const hooded = ((seed >>> 16) & 1) === 0;
  const stackEnd = ((seed >>> 25) & 1) === 0 ? 1 : -1;
  const sideDoor: Side = ((seed >>> 29) & 1) === 0 ? "+x" : "-x";

  /** The outer wall faces. See the header on the enterable one. */
  const gx = w / 2 + (open ? t / 2 : 0);
  const gz = d / 2 + (open ? t / 2 : 0);
  const plane = (s: Side): number => (runsAlongX(s) ? gz : gx);
  const half = (s: Side): number => (runsAlongX(s) ? gx : gz);
  /** The plinth's own face, which a doorstep stands out from. */
  const plinth = (s: Side): number => (runsAlongX(s) ? d : w) / 2 + 0.2;
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  /** Top of the sole plate, the posts' heads, and the rail between them. */
  const sole = 0.5;
  const top = h - 0.25;
  const rail = Math.max(2.3, h * 0.68);

  // The roof, described by its UNDERSIDE: a plane through the top of the wall
  // face at `THATCH_PITCH`, so the thatch sits on the wall head with no slit
  // under it and everything else is measured off that one line.
  const k = THATCH_PITCH;
  const pitch = Math.atan(k);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const T = THATCH_DEPTH;
  /** The eave's tip, horizontally from the ridge. */
  const tip = gx + 0.5;
  /** The verge, past each gable. */
  const zEnd = gz + 0.35;
  /** The thatch's underside at `x` from the ridge. */
  const under = (x: number): number => h - 0.02 + (gx - x) * k;
  /** The thatch's top face over the ridge. */
  const ridgeTop = under(0) + T / cosP;
  /**
   * A slab laid in the roof plane on side `sx`: from `x0` to `x1` from the
   * ridge (measured on the underside), `o0` to `o1` out along the normal from
   * it, and `z0` to `z1` along the ridge. Cut square to the slope, which is
   * right for a rafter and wrong for thatch — see `coat`.
   */
  const onRoof = (
    sx: number,
    x0: number,
    x1: number,
    o0: number,
    o1: number,
    z0: number,
    z1: number,
    color: string,
  ): void => {
    const xm = (x0 + x1) / 2;
    const o = (o0 + o1) / 2;
    b.box((x1 - x0) / cosP, o1 - o0, z1 - z0, sx * (xm + o * sinP), under(xm) + o * cosP, (z0 + z1) / 2, color, {
      z: -sx * pitch,
    });
  };

  /** The point `x` from the ridge on side `sx`, `o` out from the underside. */
  const roofPt = (sx: number, x: number, o: number, z: number): Point3 => [
    sx * (x + o * sinP),
    under(x) + o * cosP,
    z,
  ];
  /**
   * Thatch from `x0` to `x1` and `o0` to `o1` deep, cut PLUMB at both ends: a
   * coat is trimmed vertical at the eave, which is most of what tells it from a
   * board, and two coats cut plumb at the ridge meet with no notch between them.
   * `round` takes both of the eave's corners off, which is the roll a thatched
   * eave has and the cel bands draw as one.
   */
  const coat = (sx: number, x0: number, x1: number, o0: number, o1: number, z0: number, z1: number, round = 0): void => {
    const lo = (x: number): number => under(x) + o0 / cosP;
    const hi = (x: number): number => under(x) + o1 / cosP;
    const eave: [number, number][] =
      round > 0
        ? [
            [x1 - round, lo(x1 - round)],
            [x1, lo(x1 - round) + round * 0.3],
            [x1, hi(x1) - round],
            [x1 - round * 0.8, hi(x1 - round * 0.8)],
          ]
        : [
            [x1, lo(x1)],
            [x1, hi(x1)],
          ];
    const section = (z: number): Point3[] => [
      [sx * x0, lo(x0), z],
      ...eave.map(([x, y]): Point3 => [sx * x, y, z]),
      [sx * x0, hi(x0), z],
    ];
    convexSolid(b, section(z0), section(z1), THATCH);
  };

  // Head members, and the corner posts under them. On the gable ends the head
  // is the tie beam the gable stands on; on the eaves sides it is the plate,
  // tall enough to run up into the thatch.
  for (const s of SIDES) {
    onFace(b, s, plane(s), 0, h - 0.12, half(s) * 2 + 0.2, 0.28, 0.18, 0.05, TIMBER);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.3, top - sole, 0.3, sx * (gx - 0.05), (sole + top) / 2, sz * (gz - 0.05), TIMBER);
    }
  }

  /** A window, or on a ruin the same window boarded over. */
  const windowAt = (s: Side, u: number, sill: number, ww: number, wh: number, o: { lit?: string; shutters?: string } = {}): Hole => {
    const hole = casement(b, s, plane(s), u, sill, ww, wh, ruined ? {} : o);
    if (ruined) boardUp(b, s, plane(s), u, sill, sill + wh, ww, 0.14);
    return hole;
  };
  /** A door: the frame alone round an enterable doorway, and boarded on a ruin. */
  const doorAt = (s: Side, u: number, dw: number, dh: number, leaf: string): Hole => {
    const opening = open && s === "-z";
    const hole = doorway(b, s, plane(s), plinth(s), u, dw, dh, opening || ruined ? null : leaf);
    if (ruined && !opening) {
      onFace(b, s, plane(s), u, 0.3 + dh / 2, dw, dh, 0.06, 0.02, CASEMENT);
      boardUp(b, s, plane(s), u, 0.45, 0.3 + dh - 0.1, dw, 0.17);
    }
    return hole;
  };
  const doors: Record<Side, Hole[]> = { "-z": [], "+z": [], "-x": [], "+x": [] };

  // ---- the front (-Z): the door between a pair of casements, and a hood
  // over it on some. An enterable one's doorway is the collider gap's own
  // 1.6 x 2.2, centred.
  const front: Side = "-z";
  const dw = open ? 1.6 : 1.0;
  doors[front].push(doorAt(front, 0, dw, 1.9, paint));
  const pairL = dw / 2 + 0.3;
  const pairR = gx - 0.32;
  const pairU = (pairL + pairR) / 2;
  const span = pairR - pairL;
  const withShutters = shuttered && (span - 0.36) / 2 >= 0.55;
  const ww = withShutters ? Math.min(0.9, (span - 0.36) / 2) : Math.min(0.9, span - 0.3);
  const fHoles = [...doors[front]];
  for (const u of [-pairU, pairU]) {
    fHoles.push(windowAt(front, u, 1.0, ww, 1.0, { lit, shutters: withShutters ? paint : undefined }));
  }
  framing(b, front, gz, gx, sole, top, rail, fHoles, "panel");
  if (hooded && !ruined) {
    // A thatched hood on two brackets, which is the cottage's porch.
    const hy = 2.64;
    offFace(b, front, gz, 0, dw + 0.8, hy + 0.12, hy - 0.12, 0.02, 0.72, 0.15, THATCH);
    for (const kk of [-1, 1]) {
      offFace(b, front, gz, kk * (dw / 2 + 0.24), 0.08, hy - 0.62, hy - 0.1, 0.03, 0.6, 0.08, TIMBER);
    }
  }

  // ---- the back (+Z): one casement off to the side.
  const back: Side = "+z";
  framing(b, back, gz, gx, sole, top, rail, [windowAt(back, -gx * 0.42, 1.05, 0.75, 0.9)], "panel");

  // ---- the eaves sides: a back door on one of them on a solid cottage, and
  // casements in the rest of both. The side without the door carries the lamp.
  for (const s of ["-x", "+x"] as const) {
    const holes: Hole[] = [];
    const withDoor = !open && s === sideDoor;
    const lamp = s === sideDoor ? undefined : lit;
    if (withDoor) {
      doors[s].push(doorAt(s, gz * 0.42, 0.95, 1.85, PLANK));
      holes.push(...doors[s], windowAt(s, -gz * 0.4, 1.05, 0.8, 0.95, { lit: lamp }));
    } else {
      for (const u of [-gz * 0.42, gz * 0.42]) holes.push(windowAt(s, u, 1.05, 0.8, 0.95, { lit: lamp }));
    }
    framing(b, s, gx, gz, sole, top, rail, holes, "panel");
  }

  // ---- the sole plate on the plinth, cut at every doorway — the townhouse's
  // note on a beam across a threshold.
  for (const s of SIDES) {
    const run = half(s) + 0.1;
    const cuts = doors[s].map((hole): [number, number] => [hole.u0, hole.u1]);
    for (const [a, c] of carve(-run, run, cuts)) {
      if (c - a > 0.15) onFace(b, s, plane(s), (a + c) / 2, (0.3 + sole) / 2, c - a, sole - 0.3, 0.16, 0.04, TIMBER);
    }
  }

  // ---- the gables: plaster, standing on the tie beam with both top edges
  // buried in the thatch, framed with a collar and a king post. A ruin's back
  // gable is down to two ragged courses.
  const gt = open ? t : 0.3;
  for (const s of ["-z", "+z"] as const) {
    const n = outward(s);
    const zc = n * (gz - gt / 2);
    if (ruined && s === "+z") {
      // Two convex pieces, because a broken edge is not a convex outline:
      // a course sheared off on a slant, and a lump of it still standing.
      const piece = (outline: [number, number][]): void => {
        const at = (z: number): Point3[] => outline.map(([x, y]): Point3 => [x, y, z]);
        convexSolid(b, at(zc - gt / 2), at(zc + gt / 2), PLASTER);
      };
      piece([
        [-gx, h - 0.02],
        [gx, h - 0.02],
        [gx * 0.5, h + 0.35],
        [-gx * 0.5, h + 0.6],
      ]);
      piece([
        [-gx * 0.5, h + 0.55],
        [-gx * 0.05, h + 0.45],
        [-gx * 0.2, h + 1.15],
        [-gx * 0.45, h + 1.05],
      ]);
      continue;
    }
    const a = gx + 0.15 / k;
    b.gableEnd(2 * a, a * k, gt, 0, h - 0.02, zc, PLASTER);
    const yCol = h + 0.5 * gx * k;
    const colHalf = gx - (yCol - h) / k - 0.12;
    onFace(b, s, gz, 0, yCol, 2 * colHalf, 0.16, 0.12, 0.03, TIMBER);
    const kingTop = under(0) - 0.04;
    onFace(b, s, gz, 0, (yCol + kingTop) / 2, 0.16, kingTop - yCol, 0.12, 0.03, TIMBER);
    for (const kk of [-1, 1]) {
      const r = 0.64 * gx;
      const st = under(r) - 0.03;
      onFace(b, s, gz, kk * r, (h + 0.02 + st) / 2, 0.15, st - h - 0.02, 0.12, 0.03, TIMBER);
    }
    const attic = Math.min(0.6, yCol - 0.2 - (h + 0.28));
    if (s === front && attic > 0.3) windowAt(front, 0, h + 0.28, 0.5, attic);
  }

  // ---- the thatch.
  if (!ruined) {
    const xc = 0.85; // how far down the slope the ridge cap reaches
    /** The top of the coats, where the ridge is laid. */
    const Tr = T + 0.1;
    for (const sx of [-1, 1]) {
      coat(sx, 0, tip, 0, T, -zEnd, zEnd, 0.16);
      // Two more courses, each laid over the one below and ending in its own
      // butt: the steps down the slope are the lines a thatched roof is read
      // by from across a street, and they run ALONG it where a tiled roof's
      // run both ways and a boarded one's run down it.
      coat(sx, 0, tip * 0.66, T - 0.02, T + 0.05, -zEnd, zEnd);
      coat(sx, 0, tip * 0.36, T + 0.03, Tr, -zEnd, zEnd);
      // The block-cut ridge: a raised cap, the points cut along its lower
      // edge, and two liggers pinning it.
      coat(sx, 0, xc, Tr - 0.02, Tr + 0.14, -zEnd + 0.06, zEnd - 0.06);
      for (let z = -zEnd + 0.3; z < zEnd - 0.2; z += 0.5) {
        const o0 = Tr - 0.02;
        const o1 = Tr + 0.07;
        const tooth = (o: number): Point3[] => [
          roofPt(sx, xc - 0.02, o, z - 0.21),
          roofPt(sx, xc + 0.28, o, z),
          roofPt(sx, xc - 0.02, o, z + 0.21),
        ];
        convexSolid(b, tooth(o0), tooth(o1), THATCH);
      }
      for (const x of [0.3, xc - 0.16]) {
        onRoof(sx, x, x + 0.05, Tr + 0.14, Tr + 0.19, -zEnd + 0.12, zEnd - 0.12, TIMBER);
      }
    }
    b.cyl(2 * zEnd - 0.1, 0.46, 0.46, 8, 0, ridgeTop + 0.28, 0, THATCH, { x: Math.PI / 2 });
  } else {
    // Burnt: the -X slope holds over the front and is torn off ragged behind,
    // and everywhere else the rafters stand bare, most of them broken short.
    const zCut = gz * 0.2;
    coat(-1, 0, tip, 0, T, -zEnd, zCut, 0.16);
    coat(-1, 0, tip * 0.66, T - 0.02, T + 0.05, -zEnd, zCut);
    coat(-1, 0, tip * 0.45, 0, T, zCut, zCut + 0.9);
    const beamEnd = gz * 0.55;
    b.box(0.22, 0.26, beamEnd + zEnd - 0.1, 0, under(0) - 0.12, (beamEnd - zEnd + 0.1) / 2, TIMBER);
    let i = seed % RAFTER_REMAINS.length;
    for (let z = -gz + 0.3; z <= gz - 0.2; z += 0.8) {
      for (const sx of [-1, 1]) {
        if (sx < 0 && z < zCut + 0.9) continue; // still under the thatch
        const reach = (gx + 0.2) * RAFTER_REMAINS[i++ % RAFTER_REMAINS.length];
        onRoof(sx, gx + 0.2 - reach, gx + 0.2, -0.17, -0.02, z - 0.06, z + 0.06, TIMBER);
      }
    }
    // What came down, under the open eave: charred thatch and a rafter. Low
    // enough to walk over, which is the rule for anything outside the
    // footprint that carries no collider.
    b.box(1.3, 0.3, d * 0.55, gx + 0.7, 0.1, -d * 0.12, TIMBER, { y: 0.1, z: -0.14 });
    b.box(0.8, 0.26, d * 0.3, gx + 0.55, 0.14, d * 0.2, TIMBER, { y: -0.2, z: 0.18 });
    b.box(0.14, 0.14, 2.4, gx + 0.9, 0.26, d * 0.06, TIMBER, { x: 0.1, y: 0.5 });
  }

  // ---- the stack on the ridge, based just inside the thatch so it shows
  // nothing to a room under it. A ruin's stands from the wall head, pots gone
  // — the bit of a burnt cottage that always survives — except over an
  // enterable one, where it would hang in the room's air.
  if (!(ruined && open)) {
    const cz = stackEnd * (d / 2 - 0.8);
    const base = ruined ? h - 0.1 : under(0) + 0.02;
    const ch = ridgeTop + (ruined ? 0.8 : 1.25);
    b.box(0.8, ch - base, 0.95, 0, (base + ch) / 2, cz, BRICK);
    b.box(1.0, 0.16, 1.15, 0, ch, cz, DARK_STONE);
    b.box(0.9, 0.1, 1.05, 0, ch - 0.42, cz, DARK_STONE);
    if (!ruined) for (const kk of [-1, 1]) b.cyl(0.45, 0.2, 0.28, 8, 0, ch + 0.3, cz + kk * 0.24, CITY_BRICK);
  }

  // ---- inside an enterable one: the tie beams across the room and the ridge
  // piece, which are what a player looks up at.
  if (open) {
    for (const z of [-d / 4, d / 4]) b.box(w - t, 0.24, 0.22, 0, h - 0.12, z, TIMBER);
    if (!ruined) b.box(0.2, 0.26, d, 0, under(0) - 0.13, 0, TIMBER);
  }

  return b;
}

/**
 * Two-storey townhouse: a jettied upper floor oversailing the ground floor,
 * a timber frame on both storeys, a steep slate roof and a brick stack.
 *
 * The cottage is a village silhouette; this is a *street* silhouette — taller
 * than it is wide, so a row of them walls a lane in and gives the square an
 * actual skyline. `enterable` hollows the ground floor only; the upper storey
 * is the ceiling.
 *
 * **The masses are the building's and the detail is the drawing, and only the
 * masses carry a collider.** The first block below — the two storeys, the
 * bressumer, the roof and the stack — is every collider and every box the
 * collision bake has ever seen here, and nothing after it may add one: a
 * window frame or a joist end is a few centimetres of timber that `NavGrid`
 * can only get wrong, and a townhouse is placed sixty times over on
 * Cinderhaven. So a change below that line owes no `npm run collision`, and a
 * change above it does.
 *
 * What the drawing is FOR is that the old one was two plaster boxes with
 * stripes on the upper one: no door, no window on a house whose lamps were
 * out, a gable end in roof slate, and nothing under the jetty to say what was
 * holding it up. Read front to back it is now the things a jettied house is
 * recognised by, each built from the frame's own vocabulary so the ink finds
 * it: joist ends and corner brackets under the oversail, a sole plate, posts
 * and braces on the ground storey and close studding over it, casements with
 * mullions in every elevation, a plastered gable with its collar and king
 * post under a pair of bargeboards, and clay ridge tiles and pots against the
 * slate.
 *
 * **Every applied member is bedded on a FACE**, and an enterable ground floor
 * has its face half a wall further out than a solid one — its walls are
 * centred on the footprint line — which is why `gx`/`gz` exist. The old corner
 * posts were centred on the footprint corner, and on the enterable one the
 * walls closed over them completely (`kit/core.ts`'s applied-member rule).
 *
 * **The variation is seeded off the placement's position and size, never
 * drawn** (world building may not call `Math.random()`, and `streetSeed` says
 * why that costs an entry in `CONFORMS_TO_TERRAIN`): which paint the door and
 * shutters are, whether the street front is close-studded or square-framed,
 * and whether a solid one keeps a SHOP — its door at one end, a wide window
 * with the stall board let down as a counter and the upper board propped over
 * it, and a sign on an iron arm. An enterable one is never a shop, because its
 * doorway is a collider's and is centred.
 */
export function buildTownhouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "townhouse");
  const w = p.width ?? 6.5;
  const d = p.depth ?? 6.5;
  const h = p.height ?? 6.8;
  const t = 0.35;
  const g = 3.3; // ground-floor ceiling
  const up = h - g; // upper storey
  const jut = 0.45; // how far the upper floor oversails
  const rise = 2.1;
  const eaves = 0.4;
  const open = p.enterable === true;
  const lit = p.litWindows ? LAMPLIT : undefined;

  // ------------------------------------------------------------ the masses
  //
  // Every collider this building has. See the header before adding to it.
  b.box(w + 0.5, 0.3, d + 0.5, 0, 0.15, 0, DARK_STONE); // plinth
  if (open) {
    // Proud of the plinth, not flush with it — see buildTavern's floor.
    b.box(w, 0.2, d, 0, 0.24, 0, PLANK);
    b.doorWall(w, g, t, 0, g / 2, -d / 2, PLASTER, 1.6, 2.3);
    b.wall(w, g, t, 0, g / 2, d / 2, PLASTER);
    b.wall(t, g, d, -w / 2, g / 2, 0, PLASTER);
    b.wall(t, g, d, w / 2, g / 2, 0, PLASTER);
    // The upper floor doubles as the ceiling slab.
    b.wall(w + jut * 2, up, d + jut * 2, 0, g + up / 2, 0, PLASTER);
  } else {
    b.box(w, g, d, 0, g / 2, 0, PLASTER);
    b.block({ w, h: g, d, x: 0, y: g / 2, z: 0 });
    b.box(w + jut * 2, up, d + jut * 2, 0, g + up / 2, 0, PLASTER);
    b.block({ w: w + jut * 2, h: up, d: d + jut * 2, x: 0, y: g + up / 2, z: 0 });
  }
  // The bressumer: the beam the oversailing storey stands on.
  b.box(w + jut * 2 + 0.2, 0.34, d + jut * 2 + 0.2, 0, g + 0.17, 0, TIMBER);
  b.gableRoof(w + jut * 2, d + jut * 2, rise, 0, h, 0, SLATE, eaves);
  // Brick stack, kept inside the footprint so it needs no collider of its own.
  const ch = h + 2.6;
  const cx = w / 2 - 0.6;
  const cz = d / 2 - 1.4;
  b.box(1.0, ch, 1.0, cx, ch / 2, cz, BRICK);
  b.box(1.3, 0.24, 1.3, cx, ch, cz, DARK_STONE);

  // ----------------------------------------------------------- the drawing
  // Each choice reads its own HIGH bits: the finaliser's low ones walked
  // seven of the eleven doors on Hollowmere and Harrowmead to one paint.
  const seed = streetSeed(w, d, h, ctx);
  const paint = DOOR_PAINTS[(seed >>> 20) % DOOR_PAINTS.length];
  const shop = !open && (seed >>> 11) % 3 === 0;
  const closeStudded = ((seed >>> 25) & 1) === 0;

  /** The two storeys' outer faces. See the header on the enterable one. */
  const gx = w / 2 + (open ? t / 2 : 0);
  const gz = d / 2 + (open ? t / 2 : 0);
  const ux = w / 2 + jut;
  const uz = d / 2 + jut;
  const gPlane = (s: Side): number => (runsAlongX(s) ? gz : gx);
  const gHalf = (s: Side): number => (runsAlongX(s) ? gx : gz);
  const uPlane = (s: Side): number => (runsAlongX(s) ? uz : ux);
  /** The plinth's own face, which a doorstep stands out from. */
  const plinth = (s: Side): number => (runsAlongX(s) ? d : w) / 2 + 0.25;
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];

  /** Top of the sole plate, and underside of the ground storey's top plate. */
  const sole = 0.52;
  const gTop = g - 0.44;
  /** Top of the bressumer, and the upper storey's window sill and rail. */
  const uFoot = g + 0.34;
  const uSill = uFoot + 0.72;
  const uRail = uSill - 0.2;
  const uWin = Math.min(1.2, h - 0.54 - uSill - 0.14);

  // Plates and posts. The corner posts stand on the sole plate and run up to
  // the plate over them, 0.1 proud of both faces they turn.
  for (const s of SIDES) {
    onFace(b, s, gPlane(s), 0, g - 0.31, gHalf(s) * 2 + 0.2, 0.26, 0.16, 0.04, TIMBER);
    // The two gable ends carry a TIE beam, deep enough to close the strip
    // between the wall head and the plaster gable standing on it; the eaves
    // sides a plate tall enough to close the slit under the roof slab.
    if (runsAlongX(s)) {
      onFace(b, s, uz, 0, h + 0.02, ux * 2 + 0.2, 0.32, 0.2, 0.06, TIMBER);
    } else {
      onFace(b, s, ux, 0, h - 0.05, uz * 2 + 0.2, 0.38, 0.16, 0.04, TIMBER);
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.32, gTop - sole, 0.32, sx * (gx - 0.06), (sole + gTop) / 2, sz * (gz - 0.06), TIMBER);
      const top = h - 0.24;
      b.box(0.3, top - uFoot, 0.3, sx * (ux - 0.05), (uFoot + top) / 2, sz * (uz - 0.05), TIMBER);
    }
  }

  // Under the jetty: the joists' ends where the floor they carry runs out past
  // the wall, and a bracket off each corner post on the two gable ends. This
  // is the detail that says the upper storey is held up rather than stacked.
  for (const s of SIDES) {
    const half = gHalf(s) - 0.4;
    const len = uPlane(s) - gPlane(s);
    const n = Math.max(2, Math.round((2 * half) / 0.55));
    for (let i = 0; i <= n; i++) {
      onFace(b, s, gPlane(s), -half + (i * 2 * half) / n, g - 0.09, 0.15, 0.18, len, len / 2, TIMBER);
    }
  }
  for (const s of ["-z", "+z"] as const) {
    for (const k of [-1, 1]) {
      offFace(b, s, gz, k * (gx - 0.06), 0.16, g - 0.95, g - 0.18, 0.1, uz - gz - 0.03, 0.16, TIMBER);
    }
  }

  // ---- the street front (-Z)
  const front: Side = "-z";
  const fGround: Hole[] = [];
  const fUpper: Hole[] = [];
  // Where a pair of windows either side of a centred door falls. The upper
  // storey keeps the same pair on a shop too, so the rhythm reads up the face.
  const dHalf = open ? 0.8 : 0.525;
  const pairL = dHalf + 0.3;
  const pairR = gx - 0.32;
  const pairU = (pairL + pairR) / 2;
  if (shop) {
    const sd = ((seed >>> 28) & 1) === 0 ? 1 : -1;
    const dw = 1.0;
    const ud = sd * (pairR - 0.1 - dw / 2 - 0.18);
    fGround.push(doorway(b, front, gz, plinth(front), ud, dw, 1.95, paint));
    const uA = -sd * pairR;
    const uB = ud - sd * (dw / 2 + 0.4);
    const uc = (uA + uB) / 2;
    const ww = Math.abs(uB - uA) - 0.24;
    const sill = 1.0;
    const head = sill + 1.3;
    fGround.push(casement(b, front, gz, uc, sill, ww, 1.3, { lit: lit && SHOPLIT, lights: Math.max(2, Math.round(ww / 0.6)) }));
    // The stall board, let down on two brackets as a counter...
    offFace(b, front, gz, uc, ww + 0.1, 0.84, 0.84, 0.02, 0.6, 0.07, PLANK);
    for (const k of [-1, 1]) {
      offFace(b, front, gz, uc + k * ww * 0.35, 0.06, 0.4, 0.8, 0.02, 0.5, 0.06, TIMBER);
    }
    // ...and the board over it propped out as a pentice on two iron stays.
    offFace(b, front, gz, uc, ww + 0.1, head + 0.16, head - 0.06, 0.08, 0.75, 0.05, paint);
    for (const k of [-1, 1]) {
      offFace(b, front, gz, uc + k * (ww / 2 - 0.1), 0.03, head + 0.62, head - 0.02, 0.05, 0.72, 0.03, IRON);
    }
    // A sign on an iron arm off the corner post, hung edge-on to the street
    // so it is read from along it.
    const uArm = sd * (gx - 0.06);
    offFace(b, front, gz, uArm, 0.05, 2.78, 2.78, 0.1, 1.05, 0.05, IRON);
    offFace(b, front, gz, uArm, 0.05, 2.35, 2.35, 0.3, 0.95, 0.5, paint);
    for (const r of [0.38, 0.87]) {
      offFace(b, front, gz, uArm, 0.025, 2.68, 2.68, r - 0.015, r + 0.015, 0.2, IRON);
    }
  } else {
    fGround.push(
      doorway(b, front, gz, plinth(front), 0, dHalf * 2, open ? 2.0 : 1.95, open ? null : paint),
    );
    const span = pairR - pairL;
    const shuttered = (span - 0.36) / 2 >= 0.6;
    const ww = shuttered ? Math.min(1.05, (span - 0.36) / 2) : Math.min(1.05, span - 0.3);
    for (const k of [-1, 1]) {
      fGround.push(casement(b, front, gz, k * pairU, 1.0, ww, 1.2, { lit, shutters: shuttered ? paint : undefined }));
    }
  }
  for (const k of [-1, 1]) {
    fUpper.push(casement(b, front, uz, k * pairU, uSill, 1.0, uWin, { lit }));
  }
  framing(b, front, gz, gx, sole, gTop, null, fGround, "panel");
  framing(b, front, uz, ux, uFoot, h - 0.14, uRail, fUpper, closeStudded ? "close" : "panel");

  // ---- the back (+Z): a plain door away from the stack, the scullery window
  // beside it, and one light upstairs.
  const back: Side = "+z";
  const bGround = [
    doorway(b, back, gz, plinth(back), -(pairR - 0.1 - 0.47 - 0.18), 0.95, 1.9, PLANK),
    casement(b, back, gz, pairU, 1.1, 0.75, 0.95),
  ];
  framing(b, back, gz, gx, sole, gTop, null, bGround, "panel");
  framing(b, back, uz, ux, uFoot, h - 0.14, uRail, [casement(b, back, uz, 0, uSill, 0.95, uWin)], "panel");

  // ---- the flanks: one window upstairs on each, and one down on the side
  // away from the hearth.
  for (const s of ["-x", "+x"] as const) {
    const below = s === "-x" ? [casement(b, s, gx, 0, 1.1, 0.75, 1.0)] : [];
    framing(b, s, gx, gz, sole, gTop, null, below, "panel");
    framing(b, s, ux, uz, uFoot, h - 0.24, uRail, [casement(b, s, ux, 0, uSill, 0.85, uWin)], "panel");
  }

  // ---- the sole plate the ground storey stands on, laid on the plinth and
  // cut at every doorway: a beam across a threshold draws a step the ground
  // probe says is not there (the barn's footing note), and a door's jambs
  // stand on the plinth either side of the cut.
  const doors: Record<Side, Hole[]> = {
    "-z": fGround.filter((hole) => hole.y0 === 0),
    "+z": bGround.filter((hole) => hole.y0 === 0),
    "-x": [],
    "+x": [],
  };
  for (const s of SIDES) {
    const run = gHalf(s) + 0.1;
    const cuts = doors[s].map((hole): [number, number] => [hole.u0, hole.u1]);
    for (const [a, c] of carve(-run, run, cuts)) {
      if (c - a > 0.15) onFace(b, s, gPlane(s), (a + c) / 2, (0.3 + sole) / 2, c - a, sole - 0.3, 0.16, 0.04, TIMBER);
    }
  }

  // ---- the gables. `gableRoof` closes each end in a slate panel, which is
  // right for the roof void and wrong for a timber house: a gable is wall. So
  // a plaster one stands in front of it, its sloped edges tucked up into the
  // slabs, framed with a collar and a king post round an attic light, under a
  // pair of bargeboards and a finial at the apex.
  const slopeW = ux + eaves;
  const slopeK = rise / slopeW;
  const pitch = Math.atan2(rise, slopeW);
  const slabLen = Math.hypot(slopeW, rise);
  for (const s of ["-z", "+z"] as const) {
    const n = outward(s);
    const a = ux + 0.1;
    const yb = h + (slopeW - a) * slopeK - 0.06;
    const face = uz + 0.15;
    b.gableEnd(2 * a, a * slopeK, 0.06, 0, yb, n * (uz + 0.12), PLASTER);
    const yCol = yb + 0.5 * a * slopeK;
    onFace(b, s, face, 0, yCol, a - 0.2, 0.16, 0.12, 0.03, TIMBER);
    const kingTop = yb + a * slopeK - 0.2;
    onFace(b, s, face, 0, (yCol + kingTop) / 2, 0.16, kingTop - yCol, 0.12, 0.03, TIMBER);
    for (const kk of [-1, 1]) {
      const r = 0.62 * a;
      const top = yb + (a - r) * slopeK - 0.1;
      onFace(b, s, face, kk * r, (yb + top) / 2, 0.15, top - yb, 0.12, 0.03, TIMBER);
    }
    const attic = yCol - 0.22 - (yb + 0.28);
    if (attic > 0.3) casement(b, s, face, 0, yb + 0.28, 0.55, Math.min(0.75, attic), { lights: 1 });

    const barge = n * (uz + eaves - 0.05);
    for (const sx of [-1, 1]) {
      b.box(slabLen - 0.1, 0.24, 0.06, (sx * slopeW) / 2, h + rise / 2 - 0.2 / Math.cos(pitch), barge, TIMBER, {
        z: -sx * pitch,
      });
    }
    b.box(0.14, 0.7, 0.14, 0, h + rise + 0.15, barge, TIMBER);
  }

  // ---- the roof: clay ridge tiles, and the slate's courses as lines on its
  // own plane — one slab is one tone whatever the light is doing, and a course
  // line is a depth step the ink can find.
  b.box(0.3, 0.16, 2 * (uz + eaves) + 0.04, 0, h + rise + 0.09, 0, BRICK);
  const off = 0.108; // the slab's half thickness and the course's
  for (const sx of [-1, 1]) {
    for (const f of [0.2, 0.4, 0.6, 0.8]) {
      const r = slopeW * (1 - f);
      b.box(
        0.09,
        0.035,
        2 * (uz + eaves) - 0.02,
        sx * (r + Math.sin(pitch) * off),
        h + rise * f + Math.cos(pitch) * off,
        0,
        IRON,
        { z: -sx * pitch },
      );
    }
  }
  // The stack's oversailing course and its pots.
  b.box(1.1, 0.12, 1.1, cx, ch - 0.55, cz, DARK_STONE);
  for (const kk of [-1, 1]) b.cyl(0.5, 0.22, 0.3, 8, cx + kk * 0.24, ch + 0.37, cz, CITY_BRICK);

  return b;
}

/**
 * The tavern: the biggest house in the village and the only one with its
 * lights still on. Two storeys, a covered porch on the -Z face, and a hanging
 * sign. Always enterable — a taproom you can brawl in is the whole point.
 */
export function buildTavern(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "tavern");
  const w = 13;
  const d = 10;
  const g = 3.6;
  const up = 3.4;
  const h = g + up;
  const t = 0.4;
  const jut = 0.5;

  // Boards stand PROUD of the plinth they are laid on. Flush tops (both at
  // 0.3) put 130 m2 of taproom floor and stone footing on one plane, and the
  // two are different colours so they merge into different meshes — the depth
  // test is then a tie the draw order breaks arbitrarily, per pixel, and the
  // floor flickers as you walk. The 0.04 is the board thickness showing.
  b.box(w + 0.6, 0.3, d + 0.6, 0, 0.15, 0, DARK_STONE);
  b.box(w, 0.2, d, 0, 0.24, 0, PLANK);
  b.doorWall(w, g, t, 0, g / 2, -d / 2, PLASTER, 2.2, 2.6);
  b.doorWall(w, g, t, 0, g / 2, d / 2, PLASTER, 1.8, 2.3); // yard door
  b.wall(t, g, d, -w / 2, g / 2, 0, STONE);
  b.wall(t, g, d, w / 2, g / 2, 0, STONE);
  b.wall(w + jut * 2, up, d + jut * 2, 0, g + up / 2, 0, PLASTER);

  b.box(w + jut * 2 + 0.2, 0.36, d + jut * 2 + 0.2, 0, g + 0.18, 0, TIMBER);
  for (let i = -3; i <= 3; i++) {
    for (const sz of [-1, 1]) {
      b.box(0.22, up, 0.22, i * 1.9, g + up / 2, sz * (d / 2 + jut), TIMBER);
    }
  }
  b.gableRoof(w + jut * 2, d + jut * 2, 2.4, 0, h, 0, THATCH, 0.5);

  // Porch: four posts under a lean-to, deep enough to stand a fight in.
  const px = 3.2;
  const pz = -d / 2 - 2.2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.24, 2.7, 0.24, sx * px, 1.35, pz + sz * 1.6, TIMBER);
    }
  }
  b.box(px * 2 + 1.2, 0.16, 4.4, 0, 2.85, pz, THATCH, { x: -0.16 });
  b.box(px * 2 + 1.2, 0.24, 0.24, 0, 2.7, pz - 1.6, TIMBER);

  // Hanging sign — the landmark read from down the road.
  b.box(0.16, 0.16, 1.8, w / 2 - 1.4, g + 0.9, -d / 2 - 0.9, IRON);
  b.box(1.4, 1.0, 0.1, w / 2 - 1.4, g + 0.3, -d / 2 - 1.6, PLANK);
  b.glow(0.9, 0.5, 0.04, w / 2 - 1.4, g + 0.3, -d / 2 - 1.68, "#c9a15e");

  // Chimneys at both gable ends.
  for (const sx of [-1, 1]) {
    const ch = h + 2.4;
    b.box(1.1, ch, 1.2, (sx * w) / 2 - sx * 0.8, ch / 2, 0.6, BRICK);
    b.box(1.4, 0.24, 1.5, (sx * w) / 2 - sx * 0.8, ch, 0.6, DARK_STONE);
  }

  for (const sx of [-1, 1]) {
    b.glow(1.0, 1.0, 0.06, sx * 4.2, g * 0.55, -d / 2 - t / 2, "#ffb257");
    b.glow(0.8, 0.9, 0.06, sx * 2.4, g + up * 0.5, -(d / 2 + jut) - 0.05, "#ffb257");
  }
  b.light("#ffb257", 24, 2.1, 0.22, 0, 2.6, pz);
  return b;
}

/**
 * The smithy: three stone walls open to the street, a brick forge still
 * banked, and a stack taller than the roof. The open front makes it a piece
 * of cover you fight *through* rather than around.
 */
export function buildSmithy(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "smithy");
  const w = 9;
  const d = 8;
  const h = 4.4;
  const t = 0.5;

  b.box(w, 0.2, d, 0, 0.1, 0, DARK_STONE);
  b.wall(w, h, t, 0, h / 2, d / 2, STONE);
  b.wall(t, h, d, -w / 2, h / 2, 0, STONE);
  b.wall(t, h, d, w / 2, h / 2, 0, STONE);
  // Open front: jambs and a lintel only.
  b.doorWall(w, h, t, 0, h / 2, -d / 2, STONE, 5.0, 3.2);
  for (const sx of [-1, 1]) {
    b.box(0.3, h, 0.3, (sx * w) / 2, h / 2, -d / 2, TIMBER);
  }
  b.gableRoof(w, d, 1.8, 0, h, 0, SLATE);

  // Forge and stack against the back wall.
  b.wall(3.0, 1.5, 1.6, -1.6, 0.75, d / 2 - 1.3, BRICK);
  // The coals sit *on* the forge bed rather than on its face: a glow plate
  // hung off the front reads as a floating light box from the street. The
  // flame above them is what stops the bed reading as a lamp — and the fixture
  // light sits in front of and above the bed, so the brickwork under it is lit
  // instead of being the one dark thing in the room.
  b.glow(2.2, 0.24, 0.9, -1.6, 1.56, d / 2 - 1.3, EMBER);
  b.glow(1.1, 0.55, 0.5, -1.6, 1.9, d / 2 - 1.3, FLAME);
  const ch = h + 3.4;
  b.box(1.8, ch, 1.6, -1.6, ch / 2, d / 2 - 1.2, BRICK);
  b.box(2.1, 0.26, 1.9, -1.6, ch, d / 2 - 1.2, DARK_STONE);
  b.light(EMBER, 20, 2.3, 0.45, -1.6, 2.1, d / 2 - 2.3);

  // Anvil on its stump, and a quench barrel.
  b.cyl(0.9, 1.1, 1.2, 8, 2.0, 0.45, 0.4, TIMBER);
  b.box(1.2, 0.35, 0.45, 2.0, 1.05, 0.4, IRON);
  b.cyl(0.4, 0.3, 0.45, 6, 2.7, 1.15, 0.4, IRON);
  b.block({ w: 1.4, h: 1.3, d: 0.9, x: 2.0, y: 0.65, z: 0.4 });
  b.cyl(1.1, 0.9, 1.0, 8, 3.2, 0.55, -1.8, PLANK);
  b.cyl(0.12, 1.04, 1.04, 8, 3.2, 0.9, -1.8, IRON);
  b.block({ w: 1.1, h: 1.1, d: 1.1, x: 3.2, y: 0.55, z: -1.8 });
  return b;
}

/**
 * A roofless stone shell: chest-high walls, one corner still carrying its
 * chimney breast. Fills ground that would otherwise be empty with somewhere
 * to *fight*, which a solid building never does — every wall here is cover on
 * both sides and none of them reaches the eaves.
 */
export function buildRuin(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "ruin");
  const w = p.width ?? 10;
  const d = p.depth ?? 8;
  const t = 0.5;

  b.box(w, 0.2, d, 0, 0.1, 0, DARK_STONE);
  // North wall: mostly standing, broken down at one end.
  b.wall(w * 0.62, 3.4, t, -w * 0.19, 1.7, d / 2, MOSS_STONE);
  b.wall(w * 0.38, 1.8, t, w * 0.31, 0.9, d / 2, MOSS_STONE);
  // East wall standing tall, west wall down to a stub.
  b.wall(t, 2.7, d * 0.72, w / 2, 1.35, d * 0.14, MOSS_STONE);
  b.wall(t, 1.2, d * 0.5, -w / 2, 0.6, -d * 0.1, MOSS_STONE);
  // South wall: two jambs either side of where the door was.
  for (const sx of [-1, 1]) {
    b.wall(w * 0.3, 1.5, t, sx * w * 0.35, 0.75, -d / 2, MOSS_STONE);
  }
  // The chimney breast — the bit of a burnt cottage that always survives.
  b.wall(2.0, 5.2, 1.4, -w / 2 + 1.4, 2.6, d / 2 - 0.9, BRICK);
  b.box(2.4, 0.24, 1.7, -w / 2 + 1.4, 5.2, d / 2 - 0.9, DARK_STONE);
  // A fallen roof beam and the heap it came down in.
  b.box(0.4, 0.4, d * 0.8, w * 0.1, 1.0, 0, TIMBER, { x: 0.5, z: 0.2 });
  b.wall(2.4, 0.7, 2.0, w * 0.22, 0.35, -d * 0.2, DARK_STONE);
  b.wall(1.8, 0.6, 1.6, -w * 0.28, 0.3, d * 0.22, DARK_STONE);
  return b;
}

/**
 * Timber watchtower: a railed platform 4.75 m up, reached by an external ramp.
 * The only piece of verticality outside the barn loft and the chapel tower,
 * and deliberately exposed on the way up.
 *
 * **The ramp follows `buildBarn`'s worked example**, because it previously
 * made both of the mistakes that comment exists to name, and each one showed
 * up as the climb needing a jump:
 *
 * - **The pitch is derived from the RUN and the slab is cut to the SLOPE.**
 *   `atan2(rise, slabLength)` conflates the two, which left the walked surface
 *   ending 0.40 m short of the deck at 0.14 m below it — a hole with the
 *   platform's own south face standing in it, so arriving at the top of the
 *   climb dropped you off the end or stopped you against a wall.
 * - **The foot runs on PAST the ground** (`rampDrop`) rather than stopping
 *   level with the tower's own floor, where it left 0.31 m of end grain. The
 *   ground probe would have stepped up that happily; `moveWithCollisions` is
 *   what refuses, because the collision capsule's ellipsoid bottoms out 0.05 m
 *   above the feet and a 0.31 m face is a wall to it. Hence "I have to jump".
 *
 * The rails are `Build.guard`s, which is what makes them solid and stands them
 * off the deck and the ramp; that method owns why both halves of that matter.
 * The one thing local to here is the SOUTH side, which is two stubs cut to the
 * deck's overhang either side of the ramp — so the opening is the ramp's own
 * width and always holds two nav-cell centres however the tower is turned.
 */
export function buildWatchtower(
  scene: Scene,
  mats: CelMaterialFactory,
): Structure {
  const b = new Build(scene, mats, "watchtower");
  const legs = 1.9;
  const deck = 5.0;
  const deckT = 0.3;
  /** Walkable height of the platform — the surface, not the slab's centre. */
  const deckTop = 4.75;
  const deckY = deckTop - deckT / 2;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.34, deckY, 0.34, sx * legs, deckY / 2, sz * legs, TIMBER);
      b.block({ w: 0.5, h: deckY, d: 0.5, x: sx * legs, y: deckY / 2, z: sz * legs });
      // Cross-bracing, the diagonal that reads as scaffolding at distance.
      b.box(0.2, 0.2, legs * 2.9, sx * legs, deckY * 0.45, 0, TIMBER, { x: 0.62 });
    }
  }
  for (const sz of [-1, 1]) {
    b.box(legs * 2.6, 0.2, 0.2, 0, deckY * 0.55, sz * legs, TIMBER, { z: 0.6 });
  }

  b.box(deck, deckT, deck, 0, deckY, 0, PLANK);
  b.block({ w: deck, h: deckT, d: deck, x: 0, y: deckY, z: 0 });

  // Access ramp, running up from -Z to the deck's south edge. Everything about
  // the platform's rails is cut against its width, so it is derived first.
  const rampW = 3;
  const rampT = 0.3;
  /** Rise over run. 0.35 sits inside the nav graph's 0.4 slope limit. */
  const rampGrade = 0.35;
  /** How far below the tower's own floor the ramp keeps going; see the header. */
  const rampDrop = 0.6;
  const rampRise = deckTop + rampDrop;
  const rampRun = rampRise / rampGrade;
  const rampPitch = Math.atan2(rampRise, rampRun);
  /** The slab's own length: it spans the run only once it is tilted. */
  const rampLen = Math.hypot(rampRun, rampRise);
  /** Where the walked surface meets the deck: its south edge, at deck height. */
  const rampTopZ = -deck / 2;
  /** The walked surface at a world Z — one plane, through the deck's edge. */
  const rampSurfaceAt = (z: number): number =>
    deckTop - (rampTopZ - z) * rampGrade;
  const rampZ = rampTopZ - rampRun / 2;
  // Placed by its TOP face: that surface has to meet the deck at one end and
  // pass through the ground at the other. A pitched slab's half-thickness is
  // measured VERTICALLY, so the term is h/2/cos, not h/2*cos.
  const rampY = rampSurfaceAt(rampZ) - rampT / 2 / Math.cos(rampPitch);
  b.box(rampW, rampT, rampLen, 0, rampY, rampZ, PLANK, { x: -rampPitch });
  b.block({
    w: rampW,
    h: rampT,
    d: rampLen,
    x: 0,
    y: rampY,
    z: rampZ,
    rotX: -rampPitch,
  });
  // Cleats across it. 15 m of bare plank at this pitch reads as a chute; these
  // are what say it is climbed. Nothing below the ground line — the last 1.7 m
  // of slab is buried, which is the whole point of `rampDrop`.
  for (let i = -5; i <= 5; i++) {
    const z = rampZ + (i * rampRun) / 12;
    const surface = rampSurfaceAt(z);
    if (surface < 0.12) continue;
    b.box(
      rampW - 0.3,
      0.08,
      0.14,
      0,
      surface + 0.04 / Math.cos(rampPitch),
      z,
      TIMBER,
      { x: -rampPitch },
    );
  }
  // Trestle bents under the span: 15 m of plank standing on nothing was the
  // other half of what read as wrong here. Colliders, because the upper one is
  // in ground a body can cross — above the ramp's midpoint the slab clears the
  // floor by more than HEADROOM, so the nav graph leaves that ground open and a
  // bot will route straight under it.
  for (const i of [1, 2]) {
    const z = rampTopZ - (i * rampRun) / 3;
    const bentH = rampSurfaceAt(z) - rampT / Math.cos(rampPitch);
    if (bentH < 0.4) continue;
    for (const sx of [-1, 1]) {
      const px = sx * (rampW / 2 - 0.2);
      b.box(0.24, bentH, 0.24, px, bentH / 2, z, TIMBER);
      b.block({ w: 0.34, h: bentH, d: 0.34, x: px, y: bentH / 2, z });
    }
    b.box(rampW, 0.18, 0.18, 0, bentH - 0.09, z, TIMBER);
  }
  // Handrails up both sides of the ramp, starting where it comes out of the
  // ground rather than at its buried foot. `guard` takes the horizontal RUN
  // and cuts the slab to it.
  const railFootZ = rampTopZ - deckTop / rampGrade;
  const rampRailZ = (rampTopZ + railFootZ) / 2;
  for (const side of ["-x", "+x"] as const) {
    const sx = side === "+x" ? 1 : -1;
    b.guard(
      side,
      (sx * rampW) / 2,
      rampRailZ,
      rampTopZ - railFootZ,
      rampSurfaceAt(rampRailZ),
      { pitch: rampPitch },
    );
  }

  // Railings round the platform. The -Z side is where the ramp arrives, so it
  // is two stubs and an opening the ramp's own width.
  const sideRun = deck + GUARD_THICKNESS * 2; // closes the corners
  b.guard("-x", -deck / 2, 0, sideRun, deckTop);
  b.guard("+x", deck / 2, 0, sideRun, deckTop);
  b.guard("+z", deck / 2, 0, deck, deckTop);
  const stub = (deck - rampW) / 2;
  for (const sx of [-1, 1]) {
    b.guard("-z", -deck / 2, (sx * (deck - stub)) / 2, stub, deckTop);
  }

  // Canopy on four short posts — the silhouette that says "someone watched".
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.22, 2.4, 0.22, sx * 2.1, deckTop + 1.2, sz * 2.1, TIMBER);
    }
  }
  b.gableRoof(deck + 0.6, deck + 0.6, 1.1, 0, deckTop + 2.4, 0, PLANK, 0.4);

  // Signal brazier, still lit — and the first structure in the tree that is
  // HEARD as well as seen. The three lines are one object: the iron, the light
  // it throws and the noise it makes, all at the flame rather than at the bowl.
  b.cyl(0.9, 0.85, 0.7, 8, 1.4, deckTop + 0.45, 1.4, IRON);
  b.glow(0.62, 0.08, 0.62, 1.4, deckTop + 0.84, 1.4, EMBER);
  b.flame(0.3, 0.85, 1.4, deckTop + 0.82, 1.4);
  b.light(EMBER, 22, 2.0, 0.4, 1.4, deckTop + 0.95, 1.4);
  b.sound("fire", 1.4, deckTop + 0.9, 1.4);

  return b;
}

/**
 * The chapel: a stone nave you can fight inside, with a bell tower that
 * overlooks the north half of the map. Flag A sits in the nave.
 */
export function buildChapel(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "chapel");
  const w = 12;
  const d = 20;
  const h = 7;
  const t = 0.6;

  b.box(w, 0.2, d, 0, 0.1, 0, DARK_STONE);
  // Nave: open at the south end, buttressed sides.
  b.doorWall(w, h, t, 0, h / 2, -d / 2, STONE, 2.6, 3.4);
  b.wall(w, h, t, 0, h / 2, d / 2, STONE);
  b.wall(t, h, d, -w / 2, h / 2, 0, STONE);
  b.wall(t, h, d, w / 2, h / 2, 0, STONE);
  for (let i = -2; i <= 2; i++) {
    for (const sx of [-1, 1]) {
      b.box(0.5, h * 0.8, 0.9, (sx * w) / 2, h * 0.4, i * 3.6, DARK_STONE);
    }
  }
  b.gableRoof(w, d, 2.6, 0, h, 0, SLATE);

  // Tall lancet windows, glowing faintly — the only warm thing for 60 metres.
  for (let i = -1; i <= 1; i++) {
    for (const sx of [-1, 1]) {
      b.glow(0.08, 2.6, 0.9, sx * (w / 2 + t / 2), h * 0.55, i * 5, "#7fd8ff");
    }
  }

  // Bell tower on the north end.
  const tw = 5;
  const th = 15;
  b.wall(tw, th, t, 0, th / 2, d / 2 + tw / 2 - t / 2, STONE);
  b.wall(tw, th, t, 0, th / 2, d / 2 + tw + tw / 2 - t / 2, STONE);
  b.wall(t, th, tw, -tw / 2, th / 2, d / 2 + tw, STONE);
  b.wall(t, th, tw, tw / 2, th / 2, d / 2 + tw, STONE);
  b.box(tw + 0.8, 0.4, tw + 0.8, 0, th, d / 2 + tw, DARK_STONE);
  // Spire.
  b.cyl(4.5, 0.15, tw * 0.95, 4, 0, th + 2.4, d / 2 + tw, SLATE);
  b.glow(0.9, 0.9, 0.9, 0, th - 2, d / 2 + tw, FLAME);
  b.light(FLAME, 26, 2.2, 0.3, 0, th - 2, d / 2 + tw);

  return b;
}

/**
 * The barn: a big open timber shed with a hayloft platform reachable by an
 * external ramp. Holds flag D and is the map's main piece of verticality —
 * "the map's best perch and the ramp to it is exposed", per the layout's own
 * design intent, which only means anything if the perch can be reached.
 *
 * Five things here are load-bearing rather than decorative, and every one of
 * them is what the ramp needed to stop being a dead end you could walk up and
 * nothing more:
 *
 * - **The east wall is built AROUND the loft opening** — two jambs, a sill and
 *   a lintel — not as one full-height slab with a plank glued on where a door
 *   should be. `b.wall` emits a collider, so a solid wall is solid at the loft
 *   whatever is drawn on it.
 * - **The sill's top face IS the threshold.** It stands flush with both the
 *   loft floor and the deck outside, so `NavGrid` finds one continuous height
 *   through the opening: `severLinks` spares a box standing no more than
 *   `stepHeight` above the higher end of a link, which is exactly what a flush
 *   sill is.
 * - **The ramp lands on a level deck, not on the doorway.** A pitched
 *   collider's top face is a different height on each side of a threshold, and
 *   the deck is what gives the ramp and the loft one flat surface to meet on.
 * - **The pitch is derived from the RUN and the slab is cut to the SLOPE.**
 *   Those are not the same number, and conflating them (`pitch =
 *   atan2(rise, slabLength)`) is what left the old ramp 0.3 m short of the
 *   loft and 1.5 m past the barn's north end. `stepHeight` (0.6) over
 *   `cellSize` (1.5) also caps the gradient at 0.4 — a steeper ramp severs
 *   itself from its own top and is walkable by the player and invisible to
 *   every bot.
 * - **The ramp runs on past the ground rather than stopping level with the
 *   barn's own floor** — see `rampDrop`, which is what makes it meet the
 *   terrain whatever `y` the placement carries.
 *
 * **The sixth is about the DRAWING rather than the route, and it is the one a
 * new piece of this building is most likely to get wrong.** This shed is 16 m
 * by 22 m by 8 m and almost every square metre of it is wall, so what breaks
 * those elevations up is a frame laid ON them — and an applied member is
 * bedded on the wall's FACE, never centred in it. The corner posts were 0.3 m
 * boxes at `x = ±w / 2`, which is the middle of a 0.4 m wall: the boarding
 * closed over all fourteen of them, and what a player walked up to was 22 m of
 * one flat colour with a door in it. Everything under "the frame" below stands
 * `frameT / 2` proud of the boards, the battens behind it stand less, and the
 * two layers read in that order wherever the ink is still drawing a line.
 */
export function buildBarn(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "barn");
  const w = 16;
  const d = 22;
  const h = 8;
  const t = 0.4;

  // The loft is what the rest of the building is dimensioned against.
  /** Walkable height of the hayloft — the surface, not the slab's centre. */
  const loftTop = 4.2;
  const loftT = 0.3;
  const loftD = d / 3;
  /** Flush with the north wall's inner face, so the hay door opens onto it. */
  const loftZ = d / 2 - t / 2 - loftD / 2;

  // The loft doorway in the east wall, and the deck the ramp lands on.
  const doorW = 3.2;
  const doorH = 2.4;
  const doorS = loftZ - doorW / 2;
  const doorN = loftZ + doorW / 2;
  const deckW = 3.4;
  const deckD = doorW + 1.2;
  const deckX = w / 2 + t / 2 + deckW / 2;
  /** The deck's south edge — where the ramp arrives. */
  const deckS = loftZ - deckD / 2;

  /** The cart doorway through each gable end. */
  const cartW = 4.5;
  const cartH = 5;
  /** What the north one becomes above the loft floor — see below. */
  const hayH = loftTop + doorH;
  /** The rise `gableRoof` is given, and the eaves overhang with it. */
  const roofRise = 3.4;
  const eaves = 0.6;

  b.box(w, 0.2, d, 0, 0.1, 0, PLANK);
  b.doorWall(w, h, t, 0, h / 2, -d / 2, PLANK, cartW, cartH);
  // The north cart door runs up PAST the loft floor, which is what turns its
  // upper half into a hay door: the perch's whole value is the sightline over
  // the paddocks, and a wall at the loft's north edge is a room with a view of
  // planks.
  b.doorWall(w, h, t, 0, h / 2, d / 2, PLANK, cartW, hayH);
  b.wall(t, h, d, -w / 2, h / 2, 0, PLANK);

  // East wall, in four pieces around the loft doorway.
  const jambS = doorS + d / 2;
  b.wall(t, h, jambS, w / 2, h / 2, doorS - jambS / 2, PLANK);
  const jambN = d / 2 - doorN;
  b.wall(t, h, jambN, w / 2, h / 2, doorN + jambN / 2, PLANK);
  b.wall(t, loftTop, doorW, w / 2, loftTop / 2, loftZ, PLANK);
  const lintel = h - loftTop - doorH;
  b.wall(t, lintel, doorW, w / 2, h - lintel / 2, loftZ, PLANK);
  // Frame, so the opening reads as a door rather than as missing wall.
  for (const sz of [-1, 1]) {
    const z = loftZ + sz * (doorW / 2 - 0.08);
    b.box(t + 0.14, doorH, 0.16, w / 2, loftTop + doorH / 2, z, TIMBER);
  }
  b.box(t + 0.14, 0.16, doorW, w / 2, loftTop + doorH - 0.08, loftZ, TIMBER);

  // ------------------------------------------------------------- the frame
  //
  // Read the header's sixth bullet before moving anything here: every member
  // below is bedded on a wall FACE, and one centred in the wall instead is one
  // the boarding swallows whole.
  /** The outer faces the applied frame is laid on. */
  const faceX = w / 2 + t / 2;
  const faceZ = d / 2 + t / 2;
  /** A framing member's thickness — half of it proud of the boards. */
  const frameT = 0.2;
  /** A batten's, which is less, so the frame reads as the layer on top. */
  const battenT = 0.14;
  const plinthH = 0.55;
  const sillY = plinthH + 0.2;
  const plateY = h - 0.24;
  /**
   * Board widths, cycled with the index. World building may never call
   * `Math.random()` — the nav graph would differ between page loads — and an
   * exact rhythm reads as a fence rather than as boarding, so the only
   * irregularity a builder is allowed is a short list walked in order.
   */
  const BOARDS = [1.02, 0.84, 1.16, 0.93, 1.08, 0.88];

  // Stone footing, cut at both cart doorways rather than run through them: a
  // cart drives in over that threshold, and a course laid across it draws a
  // step the ground probe says is not there.
  for (const sx of [-1, 1]) {
    b.box(0.6, plinthH, d + 0.6, sx * (w / 2 + 0.1), plinthH / 2, 0, DARK_STONE);
  }
  const footing = (w + 0.6 - cartW) / 2;
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const x = (sx * (cartW + footing)) / 2;
      b.box(footing, plinthH, 0.6, x, plinthH / 2, sz * (d / 2 + 0.1), DARK_STONE);
    }
  }

  /** Post centres along the long walls; six bays of 3.6 m between them. */
  const bays = 6;
  const postZ: number[] = [];
  for (let i = 0; i <= bays; i++) postZ.push(-d / 2 + 0.2 + (i * (d - 0.4)) / bays);
  /** Whether a post, a brace or a batten is clear of the loft doorway. */
  const clearOfLoftDoor = (sx: number, z: number): boolean =>
    sx < 0 || Math.abs(z - loftZ) > doorW / 2 + 0.3;

  for (const sx of [-1, 1]) {
    // Posts, outside and in. The inner run is what the shed is read as from
    // the floor, where the only timber used to be the loft's own joists.
    for (const z of postZ) {
      if (!clearOfLoftDoor(sx, z)) continue;
      const tall = h - plinthH;
      b.box(frameT, tall, 0.34, sx * faceX, plinthH + tall / 2, z, TIMBER);
      b.box(0.28, tall, 0.34, sx * (w / 2 - t / 2), plinthH + tall / 2, z, TIMBER);
    }

    // Sill, mid girt and wall plate. The girt runs at the loft floor's own
    // height, so on the east it stops either side of the doorway — a beam
    // across that opening is drawn where the threshold has to stay flush.
    b.box(frameT, 0.3, d, sx * faceX, sillY, 0, TIMBER);
    b.box(frameT, 0.3, d, sx * faceX, plateY, 0, TIMBER);
    const girts: [number, number][] =
      sx > 0
        ? [
            [-d / 2, doorS - 0.1],
            [doorN + 0.1, d / 2],
          ]
        : [[-d / 2, d / 2]];
    for (const [zA, zB] of girts) {
      b.box(frameT, 0.28, zB - zA, sx * faceX, loftTop, (zA + zB) / 2, TIMBER);
      b.box(0.28, 0.3, zB - zA, sx * (w / 2 - t / 2), loftTop, (zA + zB) / 2, TIMBER);
    }

    // One long brace per bay, alternating: the zigzag is what tells the eye
    // this is a frame with boards on it rather than a stripe painted on a slab.
    for (let i = 0; i < bays; i++) {
      const zA = postZ[i];
      const zB = postZ[i + 1];
      if (!clearOfLoftDoor(sx, (zA + zB) / 2)) continue;
      const yA = sillY + 0.2;
      const yB = loftTop - 0.18;
      const angle = Math.atan2(yB - yA, zB - zA);
      const up = i % 2 === 0 ? 1 : -1;
      b.box(
        frameT - 0.04,
        0.24,
        Math.hypot(zB - zA, yB - yA),
        sx * faceX,
        (yA + yB) / 2,
        (zA + zB) / 2,
        TIMBER,
        { x: up > 0 ? -angle : angle },
      );
    }

    // Board-and-batten over the whole elevation. At the loft door the run
    // breaks above and below the opening rather than skipping the column, or
    // the one stretch of this wall a player stands against is the blank one.
    let z = -d / 2 + 0.45;
    let i = 0;
    while (z < d / 2 - 0.3) {
      const onPost = postZ.some((p) => Math.abs(p - z) < 0.36);
      if (!onPost) {
        if (clearOfLoftDoor(sx, z)) {
          b.box(battenT, plateY - sillY, 0.15, sx * faceX, (sillY + plateY) / 2, z, TIMBER);
        } else {
          b.box(battenT, loftTop - sillY, 0.15, sx * faceX, (sillY + loftTop) / 2, z, TIMBER);
          b.box(battenT, plateY - hayH, 0.15, sx * faceX, (hayH + plateY) / 2, z, TIMBER);
        }
      }
      z += BOARDS[i % BOARDS.length];
      i++;
    }

    // A shuttered vent in every other bay, up in the band between the girt and
    // the plate where there is nothing else at all. The dark is IRON and not a
    // hole: the wall is a collider and a round has to stop on it, so a vent
    // that let light through would be a window that shoots like a wall.
    for (let bay = 0; bay < bays; bay += 2) {
      const zc = (postZ[bay] + postZ[bay + 1]) / 2;
      if (!clearOfLoftDoor(sx, zc)) continue;
      const ventY = (loftTop + plateY) / 2;
      b.box(0.08, 0.66, 1.1, sx * (faceX + 0.02), ventY, zc, IRON);
      for (const k of [-1, 1]) {
        b.box(0.18, 0.14, 1.36, sx * faceX, ventY + k * 0.42, zc, TIMBER);
        b.box(0.14, 0.09, 1.1, sx * (faceX + 0.03), ventY + k * 0.17, zc, TIMBER);
      }
    }
  }

  /**
   * One gable end: the cart doorway's own frame, the boarding over the wall,
   * and the triangle above the eaves — which is the biggest single face on
   * this building and was, until now, one flat panel 17 m across.
   */
  const gableEndFrame = (sz: 1 | -1, gapH: number, hoist: boolean): void => {
    const zf = sz * faceZ;
    // Heavy jambs round the doorway, and a corner post at each end.
    for (const sx of [-1, 1]) {
      b.box(0.34, gapH + 0.3, frameT, sx * (cartW / 2 + 0.17), (gapH + 0.3) / 2, zf, TIMBER);
      const tall = h - plinthH;
      b.box(0.34, tall, frameT, sx * (w / 2 - 0.17), plinthH + tall / 2, zf, TIMBER);
    }
    b.box(cartW + 0.68, 0.3, frameT, 0, gapH + 0.15, zf, TIMBER);
    // Sill and girt, in the two runs outboard of the opening.
    const run = w / 2 - cartW / 2;
    for (const sx of [-1, 1]) {
      const x = sx * (cartW / 2 + run / 2);
      b.box(run, 0.28, frameT, x, sillY, zf, TIMBER);
      b.box(run, 0.26, frameT, x, loftTop, zf, TIMBER);
    }
    b.box(w - 0.3, 0.3, frameT, 0, plateY, zf, TIMBER);
    // Knee braces into the plate, which is what stops the head of this wall
    // reading as a line ruled across it.
    for (const sx of [-1, 1]) {
      const angle = Math.atan2(1.45, 1.6);
      b.box(
        Math.hypot(1.6, 1.45),
        0.22,
        frameT - 0.04,
        sx * (w / 2 - 1.1),
        plateY - 0.85,
        zf,
        TIMBER,
        { z: -sx * angle },
      );
    }

    // Boarding: full height outboard of the doorway, and over its head inside.
    let x = -w / 2 + 0.5;
    let i = 0;
    while (x < w / 2 - 0.4) {
      const onPost =
        Math.abs(Math.abs(x) - (cartW / 2 + 0.17)) < 0.36 ||
        Math.abs(Math.abs(x) - (w / 2 - 0.17)) < 0.36;
      if (!onPost) {
        if (Math.abs(x) > cartW / 2 + 0.34) {
          b.box(0.15, plateY - sillY, battenT, x, (sillY + plateY) / 2, zf, TIMBER);
        } else if (plateY - gapH > 1.2) {
          b.box(0.15, plateY - gapH - 0.4, battenT, x, (gapH + 0.4 + plateY) / 2, zf, TIMBER);
        }
      }
      x += BOARDS[i % BOARDS.length];
      i++;
    }

    // The triangle. Its panel is `gableRoof`'s, and that sits 0.12 m inboard
    // of the wall face, so everything applied to it is placed off the PANEL
    // and never off `faceZ` — see `gableEnd`.
    const zg = sz * (d / 2 + 0.12);
    const slope = w / 2 + eaves;
    b.box(w - 0.6, 0.26, 0.16, 0, h + 0.15, zg, TIMBER);
    for (const sx of [-1, 1]) {
      const angle = Math.atan2(2.0, 3.9);
      b.box(Math.hypot(3.9, 2.0), 0.22, 0.16, sx * 3.05, h + 1.3, zg, TIMBER, {
        z: -sx * angle,
      });
    }
    // The owl hole, louvred like the wall vents below it — but only on the
    // end that does not carry the hoist, whose beam comes out of the apex
    // through exactly this square.
    if (!hoist) {
      b.box(1.24, 0.9, 0.1, 0, h + 1.5, sz * (d / 2 + 0.16), IRON);
      for (const k of [-1, 1]) {
        b.box(1.5, 0.14, 0.18, 0, h + 1.5 + k * 0.52, zg, TIMBER);
        b.box(1.24, 0.09, 0.14, 0, h + 1.5 + k * 0.22, sz * (d / 2 + 0.18), TIMBER);
      }
    }
    for (let bx = -6.9; bx < 7.0; bx += 1.15) {
      if (Math.abs(bx) < 0.95) continue;
      const tall = roofRise * (1 - Math.abs(bx) / slope) - 0.25;
      if (tall < 0.5) continue;
      b.box(0.15, tall, battenT, bx, h + 0.25 + tall / 2, zg, TIMBER);
    }
  };
  gableEndFrame(-1, cartH, false);
  gableEndFrame(1, hayH, true);

  // One leaf of the south cart door, run back flat against the boarding. One
  // side only: a pair of them shut is a wall again, and the asymmetry is most
  // of what stops this end reading as the north end mirrored.
  const leafH = cartH - 0.25;
  const leafX = -(cartW / 2 + 1.15);
  const leafZ = -(faceZ + 0.16);
  b.box(2.1, leafH, 0.1, leafX, leafH / 2, leafZ, PLANK);
  for (const k of [0, 1, 2]) {
    b.box(2.2, 0.26, 0.12, leafX, 0.5 + (k * (leafH - 1.0)) / 2, leafZ - 0.11, TIMBER);
  }
  b.box(Math.hypot(2.1, leafH - 1.0), 0.22, 0.1, leafX, leafH / 2, leafZ - 0.11, TIMBER, {
    z: Math.atan2(leafH - 1.0, 2.1),
  });
  // Its ironwork: the strap hinges it is still hanging on.
  for (const k of [0, 2]) {
    b.box(1.5, 0.12, 0.06, leafX + 0.6, 0.5 + (k * (leafH - 1.0)) / 2, leafZ - 0.18, IRON);
  }

  b.gableRoof(w, d, roofRise, 0, h, 0, PLANK, eaves);

  // -------------------------------------------------------------- the roof
  //
  // 200 m2 of it in two slabs, and the eaves are what most of a map sees this
  // building against. The battens and the rafter tails are the walls' argument
  // again: one plane is one tone whatever the light is doing to it.
  const slope = w / 2 + eaves;
  const pitch = Math.atan2(roofRise, slope);
  const slabLen = Math.hypot(slope, roofRise);
  for (const sx of [-1, 1]) {
    for (let z = -(d / 2 + 0.35); z <= d / 2 + 0.4; z += 1.9) {
      // On the slab's own plane: its 0.09 of half-thickness, plus the batten's.
      const off = 0.125;
      b.box(
        slabLen,
        0.07,
        0.16,
        sx * (slope / 2 + off * Math.sin(pitch)),
        h + roofRise / 2 + off * Math.cos(pitch),
        z,
        TIMBER,
        { z: -sx * pitch },
      );
      // The rafter under it, showing where it crosses the wall plate.
      b.box(1.5, 0.15, 0.17, sx * (w / 2 - 0.05), h + 0.06, z, TIMBER, { z: -sx * pitch });
    }
    // Fascia along the eaves.
    b.box(0.16, 0.36, d + 1.3, sx * (slope + 0.06), h - 0.16, 0, TIMBER);
  }
  b.box(0.5, 0.2, d + 1.3, 0, h + roofRise + 0.05, 0, TIMBER); // ridge cap

  // The ridge vent, which is this building's silhouette from anywhere on the
  // map. Built by hand rather than with `gableRoof`: that emits a collider,
  // and a collider 13 m in the air is a standable surface nothing can reach
  // and a slot out of `maxSurfaces` in every cell underneath it.
  const cupZ = -d / 4;
  const ridgeY = h + roofRise;
  b.box(1.9, 0.3, 1.9, 0, ridgeY + 0.15, cupZ, PLANK);
  b.box(1.5, 1.2, 1.5, 0, ridgeY + 0.9, cupZ, IRON);
  for (const k of [0, 1, 2]) {
    b.box(1.66, 0.12, 1.66, 0, ridgeY + 0.5 + k * 0.4, cupZ, TIMBER);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.16, 1.3, 0.16, sx * 0.76, ridgeY + 0.95, cupZ + sz * 0.76, TIMBER);
    }
  }
  const capPitch = Math.atan2(0.5, 1.15);
  for (const sx of [-1, 1]) {
    b.box(1.3, 0.1, 2.3, sx * 0.58, ridgeY + 1.85, cupZ, PLANK, { z: -sx * capPitch });
  }
  b.cyl(1.1, 0.07, 0.07, 6, 0, ridgeY + 2.6, cupZ, IRON);
  b.box(1.3, 0.09, 0.05, 0.1, ridgeY + 3.05, cupZ, IRON, { y: 0.5 });
  b.box(0.36, 0.34, 0.04, -0.45, ridgeY + 3.05, cupZ - 0.24, IRON, { y: 0.5 });

  // The hoist over the hay door: the beam is what a loft is LOADED through,
  // and it is the one piece of this building that breaks its own outline.
  const hoistY = h + 1.35;
  b.box(0.26, 0.26, 2.8, 0, hoistY, d / 2 + 0.8, TIMBER);
  b.box(0.34, 0.34, 0.34, 0, hoistY - 0.3, d / 2 + 1.85, IRON);
  b.cyl(0.1, 0.44, 0.44, 8, 0, hoistY - 0.55, d / 2 + 1.85, IRON, { z: Math.PI / 2 });
  b.box(0.06, 1.5, 0.06, 0, hoistY - 1.35, d / 2 + 1.85, IRON);
  b.box(0.1, 0.28, 0.26, 0, hoistY - 2.15, d / 2 + 1.85, IRON);

  // A pentice over the south doorway. It shelters that threshold, which the
  // wear bake reads for itself — a vertex steps along its own normal and is
  // clean if a collider stands over that spot — so the boards under this hood
  // come out dry and the rest of the elevation does not.
  const hoodY = cartH + 0.6;
  b.box(cartW + 1.8, 0.14, 1.6, 0, hoodY, -(faceZ + 0.75), PLANK, { x: -0.22 });
  b.box(cartW + 1.8, 0.16, 0.18, 0, hoodY - 0.17, -(faceZ + 1.5), TIMBER);
  for (const sx of [-1, 1]) {
    b.box(0.16, 0.2, 1.3, sx * (cartW / 2 + 0.55), hoodY - 0.72, -(faceZ + 0.5), TIMBER, {
      x: Math.PI / 4,
    });
  }

  // Hayloft: a solid floor over the north third, walkable from the ramp.
  b.box(w - t * 2, loftT, loftD, 0, loftTop - loftT / 2, loftZ, PLANK);
  b.block({
    w: w - t * 2,
    h: loftT,
    d: loftD,
    x: 0,
    y: loftTop - loftT / 2,
    z: loftZ,
  });
  for (let i = -2; i <= 2; i++) {
    const z = loftZ + (i * loftD) / 5;
    b.box(w - t * 2, 0.22, 0.22, 0, loftTop - loftT - 0.11, z, TIMBER); // joist
  }
  // The south edge's lip is VISUAL ONLY, deliberately: the drop into the barn
  // is the loft's second exit and the thing you shoot down through. A collider
  // here is a rail you can neither step off nor fire over.
  b.box(w - t * 2, 0.5, 0.2, 0, loftTop + 0.25, loftZ - loftD / 2, TIMBER);
  // Loose hay. Flat pads rather than bales: anything up here tall enough to
  // read as cover has to be a collider, and a bale's top face would be a
  // standable surface 0.9 m clear of the floor that nothing can link to.
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 2.4);
    b.box(2.6, 0.14, 2.2, x, loftTop + 0.07, loftZ + loftD / 2 - 1.4, THATCH);
  }

  // --------------------------------------------------------- the shed floor
  //
  // Two tie beams and the fittings under them. The beams are DRAWN and nothing
  // else: `strut` would stop rounds on them, and a 0.3 m timber 6.6 m up is
  // exactly the geometry `NavGrid` and every ray in the game are better off
  // never hearing about.
  for (const z of [-7.4, -1.6]) {
    b.box(w - t * 2 - 0.2, 0.3, 0.28, 0, 6.6, z, TIMBER);
    for (const sx of [-1, 1]) {
      const angle = Math.atan2(1.0, 1.2);
      b.box(Math.hypot(1.2, 1.0), 0.2, 0.24, sx * (w / 2 - t - 0.75), 6.05, z, TIMBER, {
        z: -sx * angle,
      });
    }
  }
  // A lantern hung off the south tie, which is the one thing this shed was
  // missing to be read from the doorway at all: the loft's own lamp is on the
  // far side of a solid floor and lights nothing under it, so a player who
  // walked in was looking at an unlit box with a cart in it.
  const shedLampY = 4.6;
  b.box(0.06, 1.7, 0.06, -3, shedLampY + 1.1, -1.6, IRON);
  b.cyl(0.66, 0.44, 0.32, 6, -3, shedLampY, -1.6, IRON);
  b.glow(0.32, 0.32, 0.32, -3, shedLampY, -1.6, FLAME);
  b.cyl(0.18, 0.1, 0.52, 6, -3, shedLampY + 0.42, -1.6, IRON);
  b.light(FLAME, 20, 1.8, 0.3, -3, shedLampY, -1.6);

  // Mangers down the west wall, in two runs with the gap a barn keeps between
  // them. Chest high and solid, so the open half of this shed finally has
  // something in it to fight from — the loft's drop covers the north end and
  // this covers the south. They stand in cells holding the ground and the roof
  // slab and nothing else, so each one is the third surface rather than a
  // fourth that `addSurface` would drop on the floor.
  const mangerD = 0.75;
  const mangerX = -(w / 2 - t / 2 - mangerD / 2);
  const mangerRuns: [number, number][] = [
    [-9.6, -5.2],
    [-4.0, 0.6],
  ];
  for (const [zA, zB] of mangerRuns) {
    const len = zB - zA;
    const zc = (zA + zB) / 2;
    b.wall(mangerD, 0.9, len, mangerX, 0.45, zc, PLANK);
    b.box(mangerD + 0.18, 0.14, len, mangerX + 0.06, 0.97, zc, TIMBER);
    // The rack over it, and the feed behind the slats.
    b.box(0.14, 0.9, len, mangerX - mangerD / 2 + 0.3, 1.5, zc, THATCH);
    for (let z = zA + 0.35; z < zB - 0.2; z += 0.55) {
      b.box(0.5, 0.1, 0.1, mangerX - 0.12, 1.5, z, TIMBER, { z: 0.5 });
    }
  }
  // A stack of bales in the south-east corner. On the FLOOR a bale may be a
  // collider — it is cover, and one box stands in for the stack, where the
  // same four boxes in the loft would each be a standable top face 0.9 m clear
  // of a floor nothing can link them to.
  const baleX = w / 2 - t - 1.5;
  const baleZ = -d / 2 + t + 2.4;
  const bales: [number, number, number][] = [
    [0, 0, 0],
    [0, 1.05, 0],
    [0.95, 0.5, 0],
    [0.3, 0.5, 0.75],
  ];
  for (const [bx, bz, by] of bales) {
    b.box(1.5, 0.72, 0.95, baleX - bx, 0.37 + by, baleZ + bz, THATCH, {
      y: bx > 0 ? Math.PI / 2 : 0,
    });
  }
  b.block({ w: 2.9, h: 1.5, d: 2.5, x: baleX - 0.45, y: 0.75, z: baleZ + 0.5 });

  // The deck outside the loft door.
  const deckT = 0.3;
  b.box(deckW, deckT, deckD, deckX, loftTop - deckT / 2, loftZ, PLANK);
  b.block({
    w: deckW,
    h: deckT,
    d: deckD,
    x: deckX,
    y: loftTop - deckT / 2,
    z: loftZ,
  });
  for (const sz of [-1, 1]) {
    const z = loftZ + sz * (deckD / 2 - 0.3);
    const postH = loftTop - deckT;
    b.box(0.28, postH, 0.28, deckX + deckW / 2 - 0.3, postH / 2, z, TIMBER);
  }

  // External ramp up the east side to that deck. 0.35 rise over run, inside
  // the nav graph's 0.4 slope limit.
  const rampGrade = 0.35;
  /**
   * How far below the barn's own floor the ramp keeps going. A ramp whose foot
   * stops exactly at the structure's origin only meets the ground when the
   * placement's `y` is zero and the floor under it is level, and it misses by
   * centimetres otherwise — the second barn on Hollowmere carries `y: 0.33`,
   * which lifted the foot to 0.62 above the ground it stands on, two
   * centimetres past `stepHeight`, and severed the whole loft from the graph.
   * A `stepHeight` of overrun buries the last 1.7 m instead, where the terrain
   * simply wins the surface (`addSurface` keeps the higher of two within
   * `HEIGHT_EPS`) and costs nothing.
   */
  const rampDrop = 0.6;
  const rampRun = (loftTop + rampDrop) / rampGrade;
  const rampT = 0.3;
  const rampPitch = Math.atan2(loftTop + rampDrop, rampRun);
  /** The slab's own length: it spans the run only once it is tilted. */
  const rampLen = Math.hypot(rampRun, loftTop + rampDrop);
  // Placed by its TOP face — the surface walked on has to meet the deck at one
  // end and pass through the ground at the other. `topFaceHeight` measures the
  // slab's half-thickness VERTICALLY, so that term is h/2/cos, not h/2*cos.
  const rampY = (loftTop - rampDrop) / 2 - rampT / 2 / Math.cos(rampPitch);
  const rampZ = deckS - rampRun / 2;
  /** The ramp's walked surface at a point `lz` along the slab. */
  const rampTopAt = (lz: number): number =>
    rampY + rampT / 2 / Math.cos(rampPitch) + lz * Math.tan(rampPitch);
  b.box(deckW, rampT, rampLen, deckX, rampY, rampZ, PLANK, { x: -rampPitch });
  b.block({
    w: deckW,
    h: rampT,
    d: rampLen,
    x: deckX,
    y: rampY,
    z: rampZ,
    rotX: -rampPitch,
  });
  // Cleats across the ramp. Local (0, y, z) on a slab pitched by -rampPitch
  // lands at world (0, y*cos + z*sin, z*cos - y*sin).
  for (let i = -4; i <= 4; i++) {
    const ly = rampT / 2 + 0.04;
    const lz = (i * rampLen) / 10;
    // Nothing below the ground line: the last stretch of slab is buried.
    if (rampTopAt(lz) < 0.1) continue;
    b.box(
      deckW - 0.3,
      0.08,
      0.14,
      deckX,
      rampY + ly * Math.cos(rampPitch) + lz * Math.sin(rampPitch),
      rampZ - ly * Math.sin(rampPitch) + lz * Math.cos(rampPitch),
      TIMBER,
      { x: -rampPitch },
    );
  }

  // Handrail up the ramp's outer edge and round the deck. These were VISUAL
  // ONLY, and the ramp's was the worse half of that: 4.2 m of climb with an
  // open side you could walk straight off. `guard` is what makes them solid
  // without costing the route a nav cell — it owns that whole argument.
  //
  // The rail starts where the ramp leaves the ground rather than at its buried
  // foot, and only the OUTER side carries one: the ramp runs up the barn's east
  // wall, which is the other edge.
  const railFootZ = deckS - loftTop / rampGrade;
  const railZ = (deckS + railFootZ) / 2;
  const railX = deckX + deckW / 2;
  b.guard("+x", railX, railZ, deckS - railFootZ, rampTopAt(railZ - rampZ), {
    pitch: rampPitch,
  });
  // Round the deck: the outer edge runs long at both ends, closing the corner
  // against the north rail and meeting the ramp's rail in one line.
  b.guard("+x", railX, loftZ, deckD + GUARD_THICKNESS * 2, loftTop);
  b.guard("+z", loftZ + deckD / 2, deckX, deckW, loftTop);

  // A lantern over the loft door, hung off the wall on a bracket: the same
  // iron arm / tapered housing / capped flame `lamp` is built from, because a
  // bare `glow` is a flame floating in mid-air with nothing holding it. The
  // arm beds into the LINTEL rather than crossing the opening, and the housing
  // hangs clear above the door's head. The farmstead is the darkest district
  // on the map and the ramp is meant to be an exposed approach, which it can
  // only be if the player can see it is there.
  const lampY = loftTop + doorH + 0.5;
  const lampX = w / 2 + t / 2 + 0.7;
  b.box(0.9, 0.1, 0.1, w / 2 + t / 2 + 0.4, lampY + 0.3, loftZ, IRON);
  b.cyl(0.62, 0.42, 0.3, 6, lampX, lampY, loftZ, IRON);
  b.glow(0.3, 0.3, 0.3, lampX, lampY, loftZ, FLAME);
  b.cyl(0.18, 0.1, 0.5, 6, lampX, lampY + 0.4, loftZ, IRON);
  b.light(FLAME, 22, 1.9, 0.28, lampX, lampY, loftZ);

  return b;
}

/**
 * The mill: a stone-based timber mill with a waterwheel on its west face,
 * straddling the creek. Flag B sits at its base.
 */
export function buildMill(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "mill");
  const w = 10;
  const d = 9;
  const h = 9;
  const t = 0.45;

  b.box(w, 0.2, d, 0, 0.1, 0, PLANK);
  b.box(w + 0.6, 2.4, d + 0.6, 0, 1.2, 0, STONE); // stone base course
  b.doorWall(w, h, t, 0, h / 2, -d / 2, PLASTER, 1.8, 2.3);
  b.wall(w, h, t, 0, h / 2, d / 2, PLASTER);
  b.wall(t, h, d, -w / 2, h / 2, 0, PLASTER);
  b.wall(t, h, d, w / 2, h / 2, 0, PLASTER);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.3, h, 0.3, (sx * w) / 2, h / 2, (sz * d) / 2, TIMBER);
    }
  }
  b.gableRoof(w, d, 2.2, 0, h, 0, THATCH);

  // Waterwheel: a spoked disc standing in the creek on the west face.
  const wheelR = 3.2;
  const wx = -w / 2 - 0.9;
  b.cyl(0.5, wheelR * 2, wheelR * 2, 12, wx, wheelR - 0.6, 0, TIMBER, {
    z: Math.PI / 2,
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box(
      0.8,
      0.16,
      1.4,
      wx,
      wheelR - 0.6 + Math.sin(a) * wheelR * 0.82,
      Math.cos(a) * wheelR * 0.82,
      PLANK,
      { x: -a },
    );
  }
  b.block({ w: 2, h: wheelR * 2, d: wheelR * 2, x: wx, y: wheelR - 0.6, z: 0 });

  // Lit windows on the lane face, and a lantern to be the thing making the
  // light. What stood here was one unframed `glow` off to one side of the
  // face, with the point light 0.6 m off the plaster and 2.5 m away from it in
  // X — so the wall carried a bright disc with nothing at its centre, and a
  // second, smaller bright patch that did not line up with it. Both read as
  // glowing bits rather than as a mill with its lamps on. It is `buildBarn`'s
  // note one building along: a bare `glow` is a flame floating in mid-air with
  // nothing holding it, and a point light parked against blank plaster is the
  // same mistake with the flame left off.
  //
  // So each pane gets a timber reveal behind it and a sill under it — the
  // kiln's stoke-hole trick, where the dark surround is what makes the bright
  // patch read as an opening — and they are PAIRED, because two of anything
  // spaced off a centre line is fenestration and one of it is a smudge. At
  // 1.0 x 1.2 they are also sized for a 9 m gable rather than for a cottage;
  // the 0.6 x 0.7 they replace was a cottage's window on a building three
  // times its height, which is most of why it read as a stain on the wall.
  const paneZ = -d / 2 - t / 2;
  for (const sx of [-1, 1]) {
    const px = (sx * w) / 3;
    const py = h * 0.62;
    b.box(1.3, 1.5, 0.1, px, py, paneZ, TIMBER);
    b.glow(1.0, 1.2, 0.06, px, py, paneZ - 0.08, "#ffb257");
    b.box(1.5, 0.16, 0.3, px, py - 0.82, paneZ - 0.1, TIMBER);
  }

  // The lantern: iron arm, tapered housing, capped flame — `buildLampPost`'s
  // fixture hung off a wall, exactly as the barn's loft lamp is. It sits just
  // clear of the stone base course so the wash it throws lands on the masonry
  // and the yard, which is where a lamp on this wall would throw it, and it
  // carries the mill's one point light. The light does NOT go up at the
  // windows: a lamp inside a building lights the room, and what reaches the
  // yard through the glass is the pane's own emissive, which is already there.
  const lampY = 3.4;
  const lampZ = paneZ - 0.55;
  b.box(0.1, 0.1, 0.9, 0, lampY + 0.3, paneZ - 0.35, IRON);
  b.cyl(0.62, 0.42, 0.3, 6, 0, lampY, lampZ, IRON);
  b.glow(0.3, 0.3, 0.3, 0, lampY, lampZ, FLAME);
  b.cyl(0.18, 0.1, 0.5, 6, 0, lampY + 0.4, lampZ, IRON);
  b.light(FLAME, 20, 1.8, 0.3, 0, lampY, lampZ);
  return b;
}

/**
 * Boathouse: a plank shed on stilts at the bog's edge, open to the water.
 * Holds flag E in a deliberately cramped, low-visibility fight.
 */
export function buildBoathouse(
  scene: Scene,
  mats: CelMaterialFactory,
): Structure {
  const b = new Build(scene, mats, "boathouse");
  const w = 11;
  const d = 13;
  const h = 4.6;
  const t = 0.3;

  b.box(w, 0.25, d, 0, 0.6, 0, PLANK);
  b.block({ w, h: 0.25, d, x: 0, y: 0.6, z: 0 });
  for (const sx of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      b.cyl(1.4, 0.3, 0.36, 5, (sx * w) / 2.4, 0.1, i * 4.5, TIMBER);
    }
  }
  b.doorWall(w, h, t, 0, h / 2 + 0.7, -d / 2, PLANK, 3.4, 3);
  b.wall(w, h, t, 0, h / 2 + 0.7, d / 2, PLANK);
  b.wall(t, h, d, -w / 2, h / 2 + 0.7, 0, PLANK);
  b.doorWall(t, h, d, w / 2, h / 2 + 0.7, 0, PLANK, 3.4, 3);
  b.gableRoof(w, d, 1.6, 0, h + 0.7, 0, PLANK, 0.5);

  b.glow(0.5, 0.5, 0.5, 0, h + 0.2, -d / 2 + 0.4, "#6effc0");
  b.light("#6effc0", 14, 1.2, 0.15, 0, h + 0.2, -d / 2 + 0.4);
  return b;
}

/**
 * Home-spawn gatehouse: a barricaded stone arch on the valley road. Not
 * capturable — it exists so a losing team always has somewhere safe to deploy.
 */
export function buildGatehouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const teamColor = p.teamColor ?? "#c9a15e";
  const b = new Build(scene, mats, "gatehouse");
  const w = 18;
  const h = 8;
  const t = 1.2;

  for (const sx of [-1, 1]) {
    b.wall(4, h, 4, (sx * w) / 2, h / 2, 0, DARK_STONE);
    b.box(5, 0.6, 5, (sx * w) / 2, h, 0, STONE);
  }
  b.wall(w - 4, 2.2, t, 0, h - 1.1, 0, STONE); // arch lintel
  // Sandbag/timber barricades flanking the road.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      b.wall(3.2, 1.1, 1.2, sx * (5 + i * 0.4), 0.55, -4 - i * 1.6, TIMBER);
    }
  }
  // Team banners: the emissive read that tells you whose ground this is.
  for (const sx of [-1, 1]) {
    b.glow(0.15, 3.2, 1.6, (sx * w) / 2 - sx * 2.4, h - 2.4, 0, teamColor);
  }
  b.light(teamColor, 24, 1.6, 0.1, 0, h - 2, 0);
  return b;
}

// --- the tropical dwelling -------------------------------------------------

/**
 * Walked height of a stilt hut's platform. INSIDE CONFIG.nav.stepHeight (0.6),
 * which is the entire reason the builder contains no ramp and no stair: every
 * cell of the platform links to the ground beside it from every bearing. It is
 * the manor's 0.40 m podium trick at 0.55.
 */
const HUT_DECK = 0.55;
/** The platform slab, placed by its TOP face. See `boardDeck` in kit/manor.ts. */
const HUT_DECK_T = 0.69;
/** How far the platform oversails the walls, on all four sides. */
const HUT_VER = 1.6;
/** How far the piles run below the platform's underside. */
const HUT_POST = 1.5;

/**
 * The jungle's cottage: a shuttered box of a house standing on a teak platform
 * carried on piles, with a deep thatch roof and creeper up one gable.
 *
 * This is the repeatable dwelling the tropical end of the kit was missing. A
 * village is a dozen of these and some boardwalk; the manor is the landmark
 * they are a village *of*.
 *
 * ## Raised, and linked, and those are separate problems
 *
 * The obvious way to build a stilt house is to put its floor where a stilt
 * house's floor goes — a metre and a half up — and hang a stair off it. That
 * costs a ramp, a nav surface, and a climb; and it makes every hut a building
 * you enter rather than cover you move through. So the two reads are decoupled:
 *
 * - **The walked surface is `HUT_DECK`, full stop.** Inside `stepHeight`, so
 *   the platform links on every bearing with nothing to climb.
 * - **The stilt read costs navigation nothing**, and comes from three things
 *   that are true whatever height the deck is at. The platform OVERSAILS the
 *   walls by `HUT_VER` on all four sides, and a house reads as raised because
 *   the thing on posts is visibly wider than the box it carries. The piles run
 *   `HUT_POST` below the deck's underside, which on level ground is simply
 *   buried — and `MapBuilder` samples the terrain ONCE, at the placement's own
 *   centre, so wherever the ground falls away inside the footprint that buried
 *   length becomes exposed post with nothing in the builder changing. And the
 *   water surface never moves, so a hut whose local ground is under it has
 *   water beneath its floor for free.
 *
 * Worked example, on Greyfen's west branch: a hut centred where the terrain
 * reads -0.45 puts its deck at +0.10 absolute. The landward corner stands
 * 0.10 m over dry ground and links trivially; the seaward corner stands over a
 * bed at -1.34, which is 1.44 m of deck above the mud with 0.82 m of standing
 * water under the piles. One placement, both reads.
 *
 * **So a stilt hut wants its centre on ground that falls away within a few
 * metres.** On dead-level ground it reads as a raised timber house, which is
 * also correct and is what a hamlet inland should look like.
 *
 * ## Three things that must not change
 *
 * A cell under this building carries exactly THREE nav surfaces — the terrain,
 * the platform top, and `gableRoof`'s eaves block — and `NavGrid` keeps three
 * and silently drops the fourth. So: no second floor slab inside the walls (the
 * platform is the floor), no colliders on the piles, and **the roof is emitted
 * last**. Any of the three costs the platform, which is the only thing here
 * anything actually walks on.
 *
 * The guards are on ±X only. The ±Z faces are deliberately open: a platform
 * railed on all four sides links to the map on none of them, and the door is in
 * the -Z elevation.
 */
export function buildStiltHut(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "stilthut");
  const w = p.width ?? 6.4;
  const d = p.depth ?? 5.2;
  const h = p.height ?? 2.8;
  const t = 0.28;
  const enterable = p.enterable ?? true;
  const fw = w + HUT_VER * 2;
  const fd = d + HUT_VER * 2;
  const under = HUT_DECK - HUT_DECK_T;

  // The platform: visual and collider in one box, placed by its top face.
  b.wall(fw, HUT_DECK_T, fd, 0, HUT_DECK - HUT_DECK_T / 2, 0, PLANK);

  // Piles. Visual only — a collider on one would spend a nav surface under the
  // deck and give bots something to wedge on. buildJetty makes the same call.
  for (const px of [-1, 0, 1]) {
    for (const pz of [-1, 0, 1]) {
      b.cyl(
        HUT_POST + 0.7,
        0.24,
        0.32,
        6,
        (px * (fw - 1.0)) / 2,
        under - HUT_POST / 2,
        (pz * (fd - 1.0)) / 2,
        TEAK,
      );
    }
  }
  // Head beams under the platform, along both axes: what the piles carry.
  for (const sz of [-1, 1]) {
    b.box(fw, 0.2, 0.26, 0, under - 0.1, (sz * (fd - 1.0)) / 2, TEAK);
  }

  // The house itself, standing on the platform.
  const wallY = HUT_DECK + h / 2;
  if (enterable) {
    b.doorWall(w, h, t, 0, wallY, -d / 2, STUCCO, 1.6, 2.1);
    b.wall(w, h, t, 0, wallY, d / 2, STUCCO);
    b.wall(t, h, d, -w / 2, wallY, 0, STUCCO);
    b.wall(t, h, d, w / 2, wallY, 0, STUCCO);
  } else {
    b.box(w, h, d, 0, wallY, 0, STUCCO);
    b.block({ w, h, d, x: 0, y: wallY, z: 0 });
  }

  // Corner posts and a shuttered opening each side — the louvred read that
  // separates a tropical house from a plastered one.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.24, h, 0.24, (sx * w) / 2, wallY, (sz * d) / 2, TEAK);
    }
    b.box(0.06, 1.0, 1.5, (sx * (w + t)) / 2, HUT_DECK + h * 0.6, 0, TEAK);
    for (let i = 0; i < 4; i++) {
      b.box(0.1, 0.14, 1.4, (sx * (w + t)) / 2, HUT_DECK + h * 0.45 + i * 0.24, 0, TEAK);
    }
  }

  if (p.ruined) {
    // One slope gone and a wall stove in: the same trade buildCottage makes.
    b.box(w * 0.7, 0.18, d + 0.8, -w * 0.18, HUT_DECK + h + 0.5, 0, THATCH, { z: -0.5 });
    b.block({ w: w + 0.8, h: 0.3, d: d + 0.8, x: 0, y: HUT_DECK + h, z: 0 });
  }

  // Creeper up one gable and down two piles — the jungle read is CREEPER
  // against STUCCO, never saturation.
  b.box(0.09, h * 0.8, 0.5, -(w + t) / 2 - 0.05, HUT_DECK + h * 0.5, d * 0.3, CREEPER);
  b.box(0.12, 1.1, 0.12, -(fw - 1.0) / 2, under - 0.6, (fd - 1.0) / 2, CREEPER);

  if (p.litWindows) {
    b.glow(0.9, 0.7, 0.06, 0, HUT_DECK + h * 0.6, -d / 2 - t / 2 - 0.02, "#ffb257");
  }

  // Rails, on ±X only. `guard` stands them outboard of the platform edge, which
  // is what keeps them out of the nav samples the platform needs.
  for (const side of ["-x", "+x"] as const) {
    const sx = side === "+x" ? 1 : -1;
    b.guard(side, (sx * fw) / 2, 0, fd, HUT_DECK, { color: TEAK });
    const postX = (sx * (fw + GUARD_THICKNESS)) / 2;
    for (const sz of [-1, 0, 1]) {
      b.box(0.18, 1.1, 0.18, postX, HUT_DECK + 0.55, (sz * (fd - 0.6)) / 2, TEAK);
    }
  }

  // LAST, and it has to be: this block is the third and final nav surface the
  // cells under the hut can hold.
  if (!p.ruined) {
    b.gableRoof(w + 0.6, d + 0.6, 1.5, 0, HUT_DECK + h, 0, THATCH, 0.5);
  }
  return b;
}

/**
 * Walked height of a jungle ruin's floor. Three numbers had to agree: inside
 * `stepHeight` so the plinth links from every bearing with no ramp, at least
 * `HEIGHT_EPS` (0.35) above the terrain so it is a genuine second nav surface
 * rather than a coplanar smear on the floor, and standing on enough slab that
 * the outline shell cannot win the depth test across it.
 */
const RUIN_FLOOR = 0.45;

/**
 * A colonial house the forest has taken back: stucco walls with the roof gone,
 * a surviving corner of the veranda colonnade, a sheet of the copper roof lying
 * where it fell, and a hardwood coming up through the north-east corner.
 *
 * `buildRuin` is this building's temperate cousin and the grammar is
 * deliberately the same — every wall is cover on both sides and none of them
 * reaches the eaves — but two things are different and both are the point.
 *
 * **The floor is real.** `buildRuin` lays a 0.2 m visual-only slab and gets away
 * with it because nothing stands on it: its walls are chest-high and the fight
 * is around them. This one has walls at head height and doorways through them,
 * so the fight is INSIDE it, and a floor you fight on is a walked surface with
 * everything that implies — a thick box placed by its top face, and a collider.
 *
 * **One wall can be shot through.** The +X elevation keeps its full height but
 * carries an empty window: a ruin whose every standing wall is opaque is a set
 * of blinds, and the one opening is what makes holding the inside a decision
 * rather than a default. It is a window and not a door — sill at 1.2 above the
 * floor — so it is a firing port, not a fourth way in.
 *
 * Nav: two surfaces per cell, terrain and the plinth. There is no roof and no
 * upper storey, which is the whole reason this one can carry a fallen roof
 * sheet and a tree without anyone having to count.
 */
export function buildJungleRuin(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "jungleruin");
  const w = p.width ?? 12;
  const d = p.depth ?? 9;
  const h = p.height ?? 3.6;
  const t = 0.45;
  /** Centre height of a wall of height `hh` standing on the plinth. */
  const on = (hh: number): number => RUIN_FLOOR + hh / 2;

  // The plinth, and the floor you fight on: one box, placed by its top face.
  b.wall(w + 0.8, 0.6, d + 0.8, 0, RUIN_FLOOR - 0.3, 0, DARK_STONE);
  // Flagstones, sunk so their top is a hair under the plinth's — two up-facing
  // surfaces in different colour groups must never share a plane.
  b.box(w - 0.4, 0.36, d - 0.4, 0, RUIN_FLOOR - 0.19, 0, MOSS_STONE);

  // North wall: standing over most of its run, broken down at one end.
  b.wall(w * 0.62, h, t, -w * 0.19, on(h), d / 2, STUCCO);
  b.wall(w * 0.38, 1.1, t, w * 0.31, on(1.1), d / 2, STUCCO);

  // East wall: full height, with an empty window punched through it.
  const runZ = d * 0.72;
  const midZ = d * 0.14;
  const gap = 1.5;
  const sill = 1.2;
  const head = 2.4;
  const leg = (runZ - gap) / 2;
  for (const sz of [-1, 1]) {
    b.wall(t, h, leg, w / 2, on(h), midZ + (sz * (gap + leg)) / 2, STUCCO);
  }
  b.wall(t, sill, gap, w / 2, on(sill), midZ, STUCCO);
  b.wall(t, h - head, gap, w / 2, RUIN_FLOOR + head + (h - head) / 2, midZ, STUCCO);

  // West wall down to a stub, south wall down to two jambs.
  b.wall(t, 1.1, d * 0.5, -w / 2, on(1.1), -d * 0.1, STUCCO);
  b.doorWall(w, 2.4, t, 0, on(2.4), -d / 2, STUCCO, 2.0, 2.2);

  // The one surviving corner of the veranda colonnade. Each column is a wall of
  // its own: a column you shoot through standing beside one you do not reads as
  // a hitscan bug, which is the manor's rule at :780.
  for (let i = 0; i < 2; i++) {
    b.wall(0.34, 3.0, 0.34, w / 2 + 1.5, on(3.0), -d / 2 - 0.4 - i * 2.4, TEAK);
  }
  b.box(0.5, 0.3, 5.2, w / 2 + 1.5, RUIN_FLOOR + 3.15, -d / 2 - 1.6, TEAK);

  // A sheet of the copper roof, lying where it came down. Chest cover inside,
  // and the only thing here that says what the roof was made of.
  b.wall(3.6, 0.9, 2.6, -w * 0.16, on(0.9), d * 0.1, VERDIGRIS);
  b.box(2.4, 0.5, 1.8, w * 0.24, RUIN_FLOOR + 0.25, -d * 0.22, VERDIGRIS, { z: 0.3 });

  // A hardwood coming up through the north-east corner. Its trunk stands inside
  // the corner the two walls already occupy, so it costs no nav cell of its own.
  b.cyl(7.4, 0.34, 0.62, 6, w / 2 - 0.9, RUIN_FLOOR + 3.7, d / 2 - 0.9, TIMBER);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    b.box(2.6, 0.16, 0.9, w / 2 - 0.9 + Math.sin(a) * 1.2, RUIN_FLOOR + 6.6, d / 2 - 0.9 + Math.cos(a) * 1.2, CREEPER, { y: a, x: -0.2 });
  }

  // Creeper down both tall elevations — blank bays only, never over an opening,
  // and standing proud of the face it grows on rather than buried in it.
  b.box(0.7, h * 0.85, 0.1, -w * 0.34, on(h * 0.85), d / 2 + t / 2 + 0.05, CREEPER);
  b.box(0.5, h * 0.6, 0.1, w * 0.02, on(h * 0.6), d / 2 + t / 2 + 0.05, CREEPER);
  b.box(0.1, h * 0.7, 0.7, w / 2 + t / 2 + 0.05, on(h * 0.7), midZ - runZ / 2 + 0.6, CREEPER);
  return b;
}
