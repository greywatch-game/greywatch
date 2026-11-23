/**
 * kit/city/car.ts — buildCar: the parked saloon. Part of the downtown set:
 * follows the contract in kit/core.ts and the set's rules in `./index.ts`.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  type V3,
  Lay,
  type StoneBatch,
  ASPHALT,
  DARK_CONCRETE,
  ENAMEL,
  LAMP_RED,
  ROAD_PAINT,
  eye,
  rod,
  streetSeed,
} from "../core";

/**
 * A parked car, along its own local X, nose at +X: a three-box family saloon
 * of the late seventies, the car every street in a town like this has two of.
 *
 * **Its collider is the BODY and not the silhouette**: one box a metre high,
 * and 1.1 m of steel is something to fight from beside — under
 * `cover.crouchHeight` (1.3), so it steers a bot without protecting one —
 * while the cabin above it is glass a round goes through. A box squared off to
 * the silhouette would stop rounds through the parts of it that are not there.
 * It is declared FIRST and is the whole of what the game knows about a car;
 * everything after it is drawing, and every drawn part is inside it, flat on
 * one of its faces, or above it — the greenhouse, the door mirrors, the aerial
 * and a roof rack are in the air the cabin is in, which a round has always
 * crossed. **`belt` is the top of the steel AND the top of the collider**, so
 * the panel a round stops on is the panel the box is measured to; the bonnet
 * and the boot lid fall below it toward the ends, which a round arriving at a
 * grazing angle over a bumper is the one shot that notices.
 *
 * **The body is a LOFT**, one section swept down the length through stations
 * (`STATION`s below): a lower side tucked 15 mm under the upper, a 45° swage
 * between them, a vertical upper side, a chamfered shoulder and the deck. A
 * box kit could only step a body's width at the wheels; a loft cuts the arches
 * as ARCS — the stations over a wheel are samples of its arch, the lower side
 * stops on them and a liner turns in under the wing — and it rounds the four
 * corners in plan. **Every facet of it is planar by construction**: each
 * segment of the section is a plane extruded along X or a parallelogram
 * between two stations, which is what the cel shader's per-facet light needs
 * (craft.md); a section that differs between stations in any other way twists
 * its quads and draws every one as two values.
 *
 * **The shut lines are DRAWN, not cut**: a strip of `ASPHALT` 8 mm wide and
 * 3 mm proud, which is a dark line at any range and costs no station. The
 * swage, the shoulder and the arch lip are real folds and the ink finds them.
 *
 * **The cabin floor is the collider's top, and the interior stands on it.**
 * A round through the side glass stops at 1.1 m whatever is drawn, so nothing
 * of the interior may be drawn BELOW the beltline where a round would stop on
 * air over it: the seats are what stands above the door cards — two buckets
 * with their headrests, the back of the bench and the parcel shelf — and the
 * dash, the binnacle and the wheel are what stands above the scuttle. That is
 * also what looking into a parked car from eye height shows. Without it the
 * glass is a window onto whatever stands across the street and the cabin reads
 * as an open frame with a plank over it. The wheel is on the RIGHT.
 *
 * **The greenhouse is glazing rather than `breakable` panes.** A cabin is
 * empty but nobody gets into it: a round already crosses it and comes out the
 * far side, so breaking it would buy an effect and nothing else — and it would
 * put some three hundred sheets in the pane list, the sweep, the bake and the
 * wire. See `PaneSpec.breakable`. It is four sheets, raked front and back
 * (`Build.pane`'s `rotZ`), the side glass running the whole cabin with the
 * B-pillar drawn over it: one sheet with a post in front of it is the same
 * picture as two sheets at half the glazing.
 *
 * **A PARKED car does not have its lights on**, at any hour: lamps are
 * unlit lenses, never a glow. Fifty-seven of them that were lit would be over
 * a hundred emissive meshes in the bloom saying nothing.
 *
 * **Five materials and no colour of its own but the tail lamps.** The rubber,
 * the cabin, the grille and the underbody are `ASPHALT` — the roadway's own
 * colour; the chrome, the lenses and the plates are `ROAD_PAINT`, the lane
 * markings'; the seats, the bezels and the rub strips are `DARK_CONCRETE`.
 * All three are drawn already in any block with a street in it, so a car
 * merges into meshes the block was going to draw anyway and only `LAMP_RED`
 * (and the paint, `params.tint`) is a group of its own. All of it is laid into
 * one `Lay`, one surface per colour.
 *
 * **Seeded off where it stands** (`streetSeed`, which is why it is in
 * `CONFORMS_TO_TERRAIN`): whether the front wheels were left turned, which
 * wheels have lost their hubcaps, whether it carries a roof rack or an aerial,
 * a passenger's mirror, and whether a sun visor was left down. Nothing seeded
 * reaches the collider.
 */
export function buildCar(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "car");
  const len = 4.4;
  const wide = 1.86;
  const belt = 1.1;

  // --- the collider: the body, and nothing else -----------------------------
  b.block({ w: len, h: 1.1, d: wide, x: 0, y: 0.55, z: 0 });

  const paint = p.tint ?? ENAMEL;
  const lay = new Lay();
  const sb = lay.sb;
  const rnd = mulberry32(streetSeed(len, wide, 1.54, ctx));
  const steer = rnd() < 0.5 ? (rnd() - 0.5) * 0.16 : 0;
  const hubcaps = [rnd() > 0.15, rnd() > 0.15, rnd() > 0.15, rnd() > 0.15];
  const rack = rnd() < 0.15;
  const aerial = rnd() < 0.6;
  const visorDown = rnd() < 0.3;
  const twoMirrors = rnd() < 0.6;

  // --- the section ----------------------------------------------------------
  // `zl` is the lower side, `zc` the upper; the swage between them is at `yc`.
  const zl = 0.915;
  const zc = 0.93;
  const yc = 0.8;
  const swage = 0.015;
  const shoulder = 0.045;
  const shoulderIn = 0.06;
  const sill = 0.32;
  // The two ends of the body; the bumpers carry on to the collider's.
  const nose = 2.06;
  const tail = -2.08;
  const corner = 0.1;
  const cornerIn = 0.04;
  // The wheels, and the arch cut over each.
  const wheelX = 1.36;
  const wheelY = 0.31;
  const wheelR = 0.31;
  const wheelZ = 0.79;
  const tread = 0.17;
  const archR = 0.4;
  const liner = 0.6;
  // Where the cabin's floor is, between the screen's foot and the backlight's.
  const cowl = 0.56;
  const backlight = -1.32;
  const glassTop = 1.46;

  /** The deck's height along the car: bonnet, scuttle, cabin, rear deck, boot. */
  const DECK: [number, number][] = [
    [nose, 0.93],
    [0.64, 1.02],
    [cowl, belt],
    [backlight, belt],
    [-1.4, 1.05],
    [tail, 1.03],
  ];
  const deckAt = (x: number): number => {
    for (let i = 0; i + 1 < DECK.length; i++) {
      const [x0, y0] = DECK[i];
      const [x1, y1] = DECK[i + 1];
      if (x <= x0 && x >= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    return x > nose ? DECK[0][1] : DECK[DECK.length - 1][1];
  };
  const arch0 = Math.asin((sill - wheelY) / archR);
  const archHalf = archR * Math.cos(arch0);
  const wheelOf = (x: number): number | null => {
    for (const wx of [wheelX, -wheelX]) if (Math.abs(x - wx) < archHalf - 1e-6) return wx;
    return null;
  };
  /** Where the side stops at the bottom: the sill, an arch, or a valance. */
  const footAt = (x: number): number => {
    const wx = wheelOf(x);
    if (wx !== null) return Math.max(sill, wheelY + Math.sqrt(Math.max(0, archR * archR - (x - wx) ** 2)));
    if (x > nose - corner) return sill + ((x - (nose - corner)) / corner) * 0.04;
    if (x < tail + corner) return sill + (((tail + corner) - x) / corner) * 0.04;
    return sill;
  };
  const insetAt = (x: number): number => {
    if (x > nose - corner) return ((x - (nose - corner)) / corner) * cornerIn;
    if (x < tail + corner) return (((tail + corner) - x) / corner) * cornerIn;
    return 0;
  };

  const xs = new Set<number>([nose, nose - corner, tail + corner, tail, ...DECK.map(([x]) => x)]);
  for (const wx of [wheelX, -wheelX]) {
    const n = 10;
    for (let k = 0; k <= n; k++) {
      const th = arch0 + ((Math.PI - 2 * arch0) * k) / n;
      xs.add(wx + archR * Math.cos(th));
    }
  }
  const stations = [...xs].sort((a, c) => c - a).map((x) => ({ x, yb: footAt(x), yt: deckAt(x), pin: insetAt(x) }));

  // --- the steel, lofted ----------------------------------------------------
  const body = lay.m(paint);
  const dark = lay.m(ASPHALT);
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = stations[i];
    const c = stations[i + 1];
    const cabin = a.x <= cowl + 1e-6 && c.x >= backlight - 1e-6;
    const xm = (a.x + c.x) / 2;
    const wx = wheelOf(xm);
    for (const sz of [-1, 1]) {
      const P = (x: number, y: number, z: number): V3 => [x, y, sz * z];
      body.quad(P(a.x, a.yb, zl - a.pin), P(c.x, c.yb, zl - c.pin), P(c.x, yc, zl - c.pin), P(a.x, yc, zl - a.pin), [0, 0, sz]);
      body.quad(P(a.x, yc, zl - a.pin), P(c.x, yc, zl - c.pin), P(c.x, yc + swage, zc - c.pin), P(a.x, yc + swage, zc - a.pin), [0, -0.7, sz * 0.7]);
      body.quad(
        P(a.x, yc + swage, zc - a.pin),
        P(c.x, yc + swage, zc - c.pin),
        P(c.x, c.yt - shoulder, zc - c.pin),
        P(a.x, a.yt - shoulder, zc - a.pin),
        [0, 0, sz],
      );
      body.quad(
        P(a.x, a.yt - shoulder, zc - a.pin),
        P(c.x, c.yt - shoulder, zc - c.pin),
        P(c.x, c.yt, zc - shoulderIn - c.pin),
        P(a.x, a.yt, zc - shoulderIn - a.pin),
        [0, 0.7, sz * 0.7],
      );
      if (cabin) {
        // The window sill: the deck between the shoulder and the glass.
        body.quad(P(a.x, a.yt, zc - shoulderIn), P(c.x, c.yt, zc - shoulderIn), P(c.x, c.yt, 0.8), P(a.x, a.yt, 0.8), [0, 1, 0]);
      }
      // Under the side: the sill's underside, or the liner turned in under a
      // wing, which faces the wheel it covers.
      const under = wx === null ? body : dark;
      const ym = (a.yb + c.yb) / 2;
      under.quad(
        P(a.x, a.yb, zl - a.pin),
        P(c.x, c.yb, zl - c.pin),
        P(c.x, c.yb, liner),
        P(a.x, a.yb, liner),
        wx === null ? [0, -1, 0] : [wx - xm, wheelY - ym, 0],
      );
    }
    if (!cabin) {
      const za = zc - shoulderIn - a.pin;
      const zcc = zc - shoulderIn - c.pin;
      body.quad([a.x, a.yt, -za], [c.x, c.yt, -zcc], [c.x, c.yt, zcc], [a.x, a.yt, za], [0, 1, 0]);
    }
  }
  // The two ends, each the section at its station, fanned from its middle.
  for (const s of [stations[0], stations[stations.length - 1]]) {
    const out = s.x > 0 ? 1 : -1;
    const half: [number, number][] = [
      [s.yb, zl - s.pin],
      [yc, zl - s.pin],
      [yc + swage, zc - s.pin],
      [s.yt - shoulder, zc - s.pin],
      [s.yt, zc - shoulderIn - s.pin],
    ];
    const ring: V3[] = [
      ...half.map(([y, z]): V3 => [s.x, y, z]),
      ...[...half].reverse().map(([y, z]): V3 => [s.x, y, -z]),
    ];
    const mid: V3 = [s.x, (s.yb + s.yt) / 2, 0];
    for (let i = 0; i < ring.length; i++) body.tri(mid, ring[i], ring[(i + 1) % ring.length], [out, 0, 0]);
  }
  // The well behind each arch, so the arch is a dark void round its tyre and
  // never a window onto the road beyond.
  for (const wx of [wheelX, -wheelX]) {
    const arc = stations.filter((s) => Math.abs(s.x - wx) <= archHalf + 1e-6);
    for (const sz of [-1, 1]) {
      const hub: V3 = [wx, 0.3, sz * liner];
      for (let i = 0; i + 1 < arc.length; i++) {
        dark.tri(hub, [arc[i].x, arc[i].yb, sz * liner], [arc[i + 1].x, arc[i + 1].yb, sz * liner], [0, 0, sz]);
      }
    }
  }
  // The floor pan, closing the underside between the sills.
  sb.box(nose - tail - 0.1, 0.06, liner * 2 + 0.04, (nose + tail) / 2, 0.33, 0, ASPHALT, undefined, 1 << 2);

  // --- the cabin ------------------------------------------------------------
  // Door cards and the floor, a centimetre over the sill so the two never
  // share a plane; then the dash, its binnacle on the driver's side, the
  // wheel on its column, the two buckets with their headrests, the bench's
  // back and the parcel shelf. Everything is placed under the glass: the
  // screen and the backlight are planes, and `glassAt` is how high each is.
  const driver = -0.38;
  const screenRun = (glassTop - belt) / (cowl - 0.1);
  const glassAt = (x: number): number => belt + (cowl - x) * screenRun;
  sb.box(cowl - backlight - 0.02, 0.03, 1.6, (cowl + backlight) / 2, belt - 0.005, 0, DARK_CONCRETE);
  sb.box(0.22, 0.12, 1.5, 0.27, belt + 0.06, 0, ASPHALT, { z: -0.12 });
  sb.box(0.12, 0.06, 0.4, 0.24, belt + 0.14, driver, ASPHALT);
  {
    // The wheel: a rim of ten bars in a plane leaning its top toward the
    // screen, a spoke across it, and a column down into the dash.
    const cx = 0.06;
    const cy = 1.22;
    const r = 0.17;
    const lean = 0.5;
    const n = 10;
    const on = (a: number, rr: number): V3 => [
      cx + Math.sin(lean) * Math.cos(a) * rr,
      cy + Math.cos(lean) * Math.cos(a) * rr,
      driver + Math.sin(a) * rr,
    ];
    for (let k = 0; k < n; k++) rod(lay, on((k / n) * Math.PI * 2, r), on(((k + 1) / n) * Math.PI * 2, r), 0.025, ASPHALT);
    rod(lay, on(Math.PI / 2, r), on(-Math.PI / 2, r), 0.025, ASPHALT);
    rod(lay, [cx, cy, driver], [cx + Math.cos(lean) * 0.25, cy - Math.sin(lean) * 0.25, driver], 0.04, ASPHALT);
  }
  for (const z of [-0.4, 0.4]) {
    sb.box(0.12, 0.26, 0.5, -0.16, belt + 0.12, z, DARK_CONCRETE, { z: 0.22 });
    sb.box(0.08, 0.1, 0.26, -0.2, belt + 0.29, z, DARK_CONCRETE, { z: 0.22 });
  }
  sb.box(0.13, 0.24, 1.42, -0.84, belt + 0.1, 0, DARK_CONCRETE, { z: 0.3 });
  sb.box(0.28, 0.025, 1.5, -1.08, belt + 0.06, 0, ASPHALT);
  for (const z of [-0.52, 0.52]) sb.box(0.16, 0.02, 0.2, -1.1, belt + 0.08, z, DARK_CONCRETE);
  // The mirror on the screen's head, the visors folded up under the roof —
  // or one of them left down.
  sb.box(0.03, 0.05, 0.2, 0.08, glassTop - 0.07, 0, ASPHALT);
  sb.box(0.02, 0.05, 0.02, 0.09, glassTop - 0.03, 0, ASPHALT);
  for (const z of [-0.4, 0.4]) {
    const down = visorDown && z < 0;
    sb.box(down ? 0.015 : 0.16, down ? 0.16 : 0.015, 0.36, down ? 0.06 : 0.0, down ? glassTop - 0.09 : glassTop - 0.015, z, DARK_CONCRETE);
  }

  // --- the greenhouse -------------------------------------------------------
  /** A sheet spanning two points of the X/Y profile: centre, length and rake. */
  const span = (x0: number, y0: number, x1: number, y1: number) => ({
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    len: Math.hypot(x1 - x0, y1 - y0),
    rot: { z: Math.atan2(y1 - y0, x1 - x0) },
  });
  const screen = span(cowl, belt, 0.1, glassTop);
  const rear = span(backlight, belt, -0.92, glassTop);
  b.pane(screen.len, 0.05, 1.62, screen.x, screen.y, 0, { rotZ: screen.rot.z });
  b.pane(rear.len, 0.05, 1.62, rear.x, rear.y, 0, { rotZ: rear.rot.z });
  for (const sz of [-1, 1]) b.pane(1.39, glassTop - belt, 0.05, -0.395, (belt + glassTop) / 2, sz * 0.81);

  // The roof: a crowned section between faces raked to the screen's and the
  // backlight's own lines, so the pillars meet it rather than a plank over it.
  {
    const roofFront = (y: number): number => 0.12 - (y - glassTop) / screenRun;
    const backRun = (glassTop - belt) / (-0.92 - backlight);
    const roofBack = (y: number): number => -0.94 + (y - glassTop) / backRun;
    const sec: [number, number][] = [
      [glassTop - 0.005, 0.845],
      [1.5, 0.85],
      [1.535, 0.76],
      [1.548, 0],
      [1.535, -0.76],
      [1.5, -0.85],
      [glassTop - 0.005, -0.845],
    ];
    const roof = lay.m(paint);
    const F = sec.map(([y, z]): V3 => [roofFront(y), y, z]);
    const R = sec.map(([y, z]): V3 => [roofBack(y), y, z]);
    const cx = (roofFront(1.475) + roofBack(1.475)) / 2;
    for (let i = 0; i < sec.length; i++) {
      const j = (i + 1) % sec.length;
      const [ym, zm] = [(sec[i][0] + sec[j][0]) / 2, (sec[i][1] + sec[j][1]) / 2];
      roof.quad(F[i], F[j], R[j], R[i], [0, ym - 1.47, zm]);
    }
    for (let i = 1; i + 1 < sec.length; i++) {
      roof.tri(F[0], F[i], F[i + 1], [1, 0.8, 0]);
      roof.tri(R[0], R[i], R[i + 1], [-1, 0.9, 0]);
    }
    // Drip rails along both eaves, and the rack when it carries one.
    for (const sz of [-1, 1]) {
      sb.box(roofFront(1.475) - roofBack(1.475) + 0.02, 0.025, 0.02, cx, 1.475, sz * 0.86, paint);
    }
    if (rack) {
      for (const x of [-0.12, -0.78]) {
        for (const sz of [-1, 1]) sb.box(0.06, 0.08, 0.05, x, 1.52, sz * 0.84, ASPHALT);
        sb.box(0.035, 0.03, 1.74, x, 1.575, 0, ROAD_PAINT);
      }
    }
  }
  // The pillars stand on the glass's edges: the A-pillars along the screen,
  // the B-pillar over the side glass, and the rear quarter a PANEL rather than
  // a post — a saloon's C-pillar is sheet metal a hand wide, and a bar there
  // left the cabin glass on three sides with daylight through all of them. It
  // is pushed half its width forward off the backlight's own line so its back
  // face IS that line; the side glass runs on inside it, hidden for nothing.
  const quarter = 0.22;
  const qx = rear.x + (Math.sin(rear.rot.z) * quarter) / 2;
  const qy = rear.y - (Math.cos(rear.rot.z) * quarter) / 2;
  for (const sz of [-1, 1]) {
    sb.box(screen.len, 0.1, 0.07, screen.x, screen.y, sz * 0.815, paint, screen.rot);
    sb.box(rear.len, quarter, 0.07, qx, qy, sz * 0.815, paint, rear.rot);
    sb.box(0.1, glassTop - belt, 0.07, -0.36, (belt + glassTop) / 2, sz * 0.815, paint);
    // The chrome along the glass's foot, and the bar closing the side glass's
    // front edge with the sail panel ahead of it that the mirror stands on —
    // the corner between the screen and the door glass, which is otherwise a
    // hole in the greenhouse.
    sb.box(1.42, 0.018, 0.02, -0.41, belt + 0.01, sz * 0.845, ROAD_PAINT);
    rod(lay, [0.3, belt, sz * 0.84], [0.3, glassAt(0.3) - 0.01, sz * 0.84], 0.02, ROAD_PAINT);
    for (const [z, out] of [
      [0.835, -1],
      [0.845, 1],
    ]) {
      lay.m(DARK_CONCRETE).tri([0.3, belt, sz * z], [cowl, belt, sz * z], [0.3, glassAt(0.3), sz * z], [0, 0, sz * out]);
    }
    // The badge on the C-panel.
    sb.box(0.06, 0.04, 0.01, qx - 0.02, qy - 0.02, sz * 0.855, ROAD_PAINT, rear.rot);
  }
  // The wipers, parked on the screen's foot.
  for (const [z0, z1] of [
    [-0.62, -0.12],
    [0.02, 0.52],
  ]) {
    const x = cowl - 0.05;
    sb.box(0.02, 0.012, z1 - z0, x, glassAt(x) + 0.03, (z0 + z1) / 2, ASPHALT, screen.rot);
  }

  // --- the doors and the wings ----------------------------------------------
  /** A shut line on a side, from `y0` up to `y1` at `x`, on whichever face it crosses. */
  const shutUp = (x: number, y0: number, y1: number, sz: number): void => {
    if (y0 < yc) sb.box(0.008, Math.min(yc, y1) - y0, 0.006, x, (y0 + Math.min(yc, y1)) / 2, sz * zl, ASPHALT);
    if (y1 > yc + swage) sb.box(0.008, y1 - (yc + swage), 0.006, x, (y1 + yc + swage) / 2, sz * zc, ASPHALT);
  };
  const doorTop = belt - shoulder - 0.005;
  for (const sz of [-1, 1]) {
    shutUp(0.52, sill + 0.01, doorTop, sz);
    shutUp(-0.37, sill + 0.01, doorTop, sz);
    shutUp(-1.08, footAt(-1.08), doorTop, sz);
    sb.box(0.52 + 0.96, 0.008, 0.006, (0.52 - 0.96) / 2, sill + 0.05, sz * zl, ASPHALT);
    // Rub strip along the swage, broken at the arches.
    for (const [x0, x1] of [
      [1.92, wheelX + archHalf],
      [wheelX - archHalf, -wheelX + archHalf],
      [-wheelX - archHalf, -1.94],
    ]) {
      sb.box(x0 - x1, 0.035, 0.016, (x0 + x1) / 2, yc + 0.06, sz * (zc + 0.008), DARK_CONCRETE);
    }
    // Pull handles near each door's back edge, a key under the front one.
    for (const x of [-0.24, -0.96]) {
      sb.box(0.16, 0.035, 0.02, x, 0.97, sz * (zc + 0.01), ROAD_PAINT);
      sb.box(0.12, 0.012, 0.008, x, 0.955, sz * (zc + 0.002), ASPHALT);
    }
    sb.box(0.02, 0.02, 0.008, -0.08, 0.965, sz * (zc + 0.004), ROAD_PAINT);
    // The repeater on each front wing.
    sb.box(0.06, 0.03, 0.012, 1.72, 0.9, sz * (zc + 0.006), ROAD_PAINT);
  }
  // The filler flap, on the near-side rear wing.
  sb.box(0.13, 0.13, 0.01, -1.66, 0.93, zc + 0.005, paint);
  // The door mirrors, the driver's always.
  for (const sz of twoMirrors ? [-1, 1] : [-1]) {
    sb.box(0.03, 0.05, 0.08, 0.44, belt + 0.03, sz * 0.92, paint);
    sb.box(0.11, 0.09, 0.13, 0.43, belt + 0.09, sz * 0.99, paint);
    sb.box(0.01, 0.07, 0.11, 0.37, belt + 0.09, sz * 0.99, DARK_CONCRETE);
  }
  // Shut lines across the deck: the bonnet's back edge and the boot lid's
  // front one, laid on their own slopes.
  sb.box(0.008, 0.006, 2 * (zc - shoulderIn) - 0.04, 0.68, deckAt(0.68) + 0.002, 0, ASPHALT);
  sb.box(0.008, 0.006, 2 * (zc - shoulderIn) - 0.04, -1.44, deckAt(-1.44) + 0.002, 0, ASPHALT);
  if (aerial) {
    sb.box(0.04, 0.03, 0.04, 0.82, deckAt(0.82) + 0.01, 0.8, ASPHALT);
    rod(lay, [0.82, deckAt(0.82), 0.8], [0.74, 1.72, 0.8], 0.008, ROAD_PAINT);
  }

  // --- the front ------------------------------------------------------------
  const front = nose;
  const fz = zc - cornerIn;
  // The grille in its frame, four chrome bars across a black ground.
  sb.box(0.02, 0.2, 0.74, front + 0.005, 0.76, 0, ASPHALT);
  for (let k = 0; k < 4; k++) sb.box(0.015, 0.012, 0.72, front + 0.02, 0.69 + k * 0.045, 0, ROAD_PAINT);
  for (const z of [-0.375, 0.375]) sb.box(0.02, 0.22, 0.015, front + 0.02, 0.76, z, ROAD_PAINT);
  sb.box(0.02, 0.015, 0.76, front + 0.02, 0.87, 0, ROAD_PAINT);
  sb.box(0.03, 0.05, 0.08, front + 0.025, 0.76, 0, ROAD_PAINT);
  for (const sz of [-1, 1]) {
    // Headlamp: a lens set in a bezel, ribbed across.
    const z = sz * 0.6;
    sb.box(0.02, 0.18, 0.36, front + 0.005, 0.77, z, DARK_CONCRETE);
    sb.box(0.02, 0.14, 0.32, front + 0.012, 0.77, z, ROAD_PAINT);
    sb.box(0.01, 0.008, 0.32, front + 0.024, 0.77, z, DARK_CONCRETE);
    sb.box(0.01, 0.14, 0.008, front + 0.024, 0.77, z - sz * 0.05, DARK_CONCRETE);
    // Indicator in the valance.
    sb.box(0.02, 0.05, 0.14, front + 0.005, 0.42, sz * 0.68, ROAD_PAINT);
  }
  // The bonnet's leading edge.
  sb.box(0.006, 0.008, 2 * fz - 0.1, front + 0.003, 0.9, 0, ASPHALT);

  // --- the back -------------------------------------------------------------
  const back = tail;
  for (const sz of [-1, 1]) {
    // Tail lamp cluster: red lens, the reversing lens inboard, ribbed in a frame.
    const z = sz * 0.66;
    sb.box(0.02, 0.2, 0.4, back - 0.005, 0.75, z, DARK_CONCRETE);
    sb.box(0.02, 0.16, 0.27, back - 0.012, 0.75, z + sz * 0.05, LAMP_RED);
    sb.box(0.02, 0.16, 0.08, back - 0.012, 0.75, z - sz * 0.14, ROAD_PAINT);
    for (const y of [0.72, 0.78]) sb.box(0.01, 0.008, 0.36, back - 0.024, y, z, DARK_CONCRETE);
  }
  // The plate in its recess with its lamp over it, the lock, the boot lid's
  // edge and the maker's letters.
  sb.box(0.02, 0.15, 0.6, back - 0.005, 0.735, 0, ASPHALT);
  plate(sb, back - 0.018, 0.735, -1);
  sb.box(0.04, 0.025, 0.16, back - 0.02, 0.825, 0, DARK_CONCRETE);
  sb.box(0.015, 0.03, 0.04, back - 0.01, 0.87, 0, ROAD_PAINT);
  sb.box(0.006, 0.008, 2 * fz - 0.1, back - 0.003, 0.88, 0, ASPHALT);
  for (let k = 0; k < 6; k++) sb.box(0.008, 0.03, 0.022, back - 0.004, 0.92, 0.42 + k * 0.032, ROAD_PAINT);
  // The exhaust, out under the off side.
  eye(dark, [back + 0.4, 0.27, -0.5], [-1, 0, 0], 0.03, 0.03, 0.52, 8, true, false);
  sb.box(0.5, 0.14, 0.3, back + 0.7, 0.27, -0.42, ASPHALT, undefined, 1 << 2);

  // --- the bumpers ----------------------------------------------------------
  // Chrome blades wrapped round the corners on a rubber insert, overriders
  // either side of the plate, inside the collider's ends.
  for (const sx of [-1, 1]) {
    const end = sx > 0 ? front : back;
    const x = end + sx * 0.07;
    sb.box(0.1, 0.12, 1.66, x, 0.52, 0, ROAD_PAINT);
    sb.box(0.012, 0.03, 1.66, x + sx * 0.055, 0.52, 0, ASPHALT);
    for (const sz of [-1, 1]) {
      sb.box(0.1, 0.12, 0.14, x - sx * 0.03, 0.52, sz * 0.82, ROAD_PAINT, { y: -sx * sz * 0.6 });
      sb.box(0.16, 0.1, 0.03, end - sx * 0.06, 0.52, sz * (zc - 0.02), ROAD_PAINT);
      sb.box(0.05, 0.2, 0.06, x + sx * 0.04, 0.53, sz * 0.4, ASPHALT);
    }
    if (sx > 0) plate(sb, end + 0.012, 0.41, 1);
  }
  // Mud flaps behind the rear wheels.
  for (const sz of [-1, 1]) sb.box(0.012, 0.2, 0.18, -(wheelX + archHalf) - 0.02, 0.23, sz * wheelZ, ASPHALT);

  // --- the wheels -----------------------------------------------------------
  const rim = lay.m(ROAD_PAINT);
  const steel = lay.m(DARK_CONCRETE);
  let w = 0;
  for (const sx of [1, -1]) {
    for (const sz of [-1, 1]) {
      const turn = sx > 0 ? steer : 0;
      const cx = sx * wheelX;
      const cz = sz * wheelZ;
      const ax: V3 = [Math.sin(turn) * sz, 0, Math.cos(turn) * sz];
      const at = (d: number): V3 => [cx + ax[0] * d, wheelY, cz + ax[2] * d];
      eye(dark, at(-tread / 2), ax, wheelR, wheelR, tread - 0.03, 16, false, true);
      eye(dark, at(tread / 2 - 0.03), ax, wheelR, wheelR - 0.05, 0.03, 16, true, false);
      if (hubcaps[w++]) {
        eye(rim, at(tread / 2 - 0.01), ax, 0.2, 0.18, 0.022, 16, true, false);
        eye(rim, at(tread / 2 + 0.012), ax, 0.07, 0.04, 0.015, 8, true, false);
      } else {
        eye(steel, at(tread / 2 - 0.01), ax, 0.19, 0.18, 0.02, 12, true, false);
        eye(dark, at(tread / 2 + 0.002), ax, 0.05, 0.05, 0.004, 8, true, false);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + 0.4;
          const u = Math.cos(a) * 0.08;
          const v = Math.sin(a) * 0.08;
          const p = at(tread / 2 + 0.016);
          sb.box(0.025, 0.025, 0.025, p[0] + Math.cos(turn) * u, p[1] + v, p[2] - Math.sin(turn) * u, ASPHALT, { y: turn });
        }
      }
    }
  }

  lay.flush(b);
  return b;
}

/** A number plate facing `out` along X: the plate, and seven characters on it. */
function plate(sb: StoneBatch, x: number, y: number, out: number): void {
  sb.box(0.012, 0.11, 0.52, x, y, 0, ROAD_PAINT);
  for (let k = 0; k < 7; k++) {
    if (k !== 3) sb.box(0.006, 0.07, 0.045, x + out * 0.008, y, -0.21 + k * 0.07, ASPHALT);
  }
}
