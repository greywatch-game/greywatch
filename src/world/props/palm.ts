/**
 * props/palm.ts — buildPalm: the date palm and its colours. Part of the scatter
 * set: follows the contract in `./index.ts`.
 */
import { Mesh, MeshBuilder, Scene } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { marksSway } from "../sway";
import { DEAD_BARK } from "./palette";

// The date palm's three, and each is set against the DESERT rather than
// against the other trees in this set: a palm stands on bleached sand under a
// bleached sky, so its bole has to be darker than the ground and its crown has
// to be the only saturated green for four hundred metres. Greyer and drier
// than either forest bark, because a palm's trunk is a stack of old frond
// stubs and reads as fibre rather than as timber.
const PALM_BARK = "#6d5c44";
const FROND = "#4a6733";
const FROND_LIT = "#71934a";
// Ripening dates: the one warm note in the crown, and the reason a grove reads
// as tended rather than as scrub that happens to be tall.
const DATE_FRUIT = "#8a5a2a";

/**
 * The date palm: a leaning fibrous bole with a rosette of fronds on top, and
 * the only tree on a desert map.
 *
 * ## What it is FOR
 *
 * The same job the ash does in the vale, and the reverse of the job the pine
 * does in it. A palm's SILHOUETTE is a bare column with a burst at the top, so
 * a grove of them screens nothing at head height and everything at fifteen
 * metres: you can see a body through a palm grove the whole way across it, and
 * you cannot see a roof over one. That is what makes a grove a place worth
 * crossing rather than a wall to walk around, and it is why the trunks are the
 * only part of it that stops anything.
 *
 * Three things about the shape are load-bearing rather than decorative:
 *
 * - **The collider is the BOLE only** (`PROP_BODIES`), which is the pine's rule
 *   and matters more here: the crown is 5 m across and eight metres up, and a
 *   box that held it would stop rounds through a grove's worth of open air at
 *   exactly the height a roof fight happens at.
 * - **The fronds start ON the axis and the crown boss does not sway.** A frond
 *   is a long thin thing lying along the sway ramp, which is the shape a vertex
 *   ramp draws worst — so the fronds are marked and the boss covering their
 *   inner ends is not, and every frond runs from the axis outward so its root
 *   is 0.55 m inside a boss that never moves. `CONFIG.wind.foliage` gives a
 *   vertex at this height about 0.26 m of travel, which is inside that by
 *   half again. See `world/sway.ts`.
 * - **The bole leans a little and the crown does not straighten up.** The
 *   fronds are parented to the trunk, so they ride the lean the way the pine's
 *   tiers do — a palm whose crown stood plumb over a leaning bole would read as
 *   two props in the same place.
 */
export function buildPalm(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number,
): Mesh {
  const height = 7.6 + rng() * 1.6;
  const trunk = MeshBuilder.CreateCylinder(
    "palm-trunk",
    { height, diameterTop: 0.44, diameterBottom: 0.68, tessellation: 7 },
    scene,
  );
  trunk.position.y = height / 2;
  trunk.material = mats.get(PALM_BARK);
  // A real lean, unlike the pine's — a date palm grows toward its water and
  // almost never stands plumb. Held under 0.12 rad so the bole stays inside
  // the collider box `PROP_BODIES` gives it.
  trunk.rotation.z = (rng() - 0.5) * 0.2;
  trunk.rotation.x = (rng() - 0.5) * 0.16;

  // The frond scars: rings of old stubs up the bole, which is the whole of what
  // makes a palm trunk read as a palm trunk at fifty metres.
  const rings = 6;
  for (let i = 0; i < rings; i++) {
    const t = (i + 0.5) / rings;
    const ring = MeshBuilder.CreateCylinder(
      `palm-ring${i}`,
      {
        height: 0.24,
        diameter: 0.78 - t * 0.2,
        tessellation: 7,
      },
      scene,
    );
    ring.parent = trunk;
    ring.position.y = -height / 2 + t * height;
    ring.rotation.y = rng() * Math.PI;
    ring.material = mats.get(i % 2 === 0 ? PALM_BARK : DEAD_BARK);
  }

  // The boss at the head of the bole: unmarked, and what buries every frond's
  // root. See the header.
  const boss = MeshBuilder.CreateCylinder(
    "palm-boss",
    { height: 0.7, diameterTop: 0.9, diameterBottom: 1.1, tessellation: 7 },
    scene,
  );
  boss.parent = trunk;
  boss.position.y = height / 2 - 0.1;
  boss.material = mats.get(PALM_BARK);

  const fronds = 9 + Math.floor(rng() * 4);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rng() * 0.3;
    const len = 2.9 + rng() * 1.1;
    // Two thirds of them arch up and out; the rest are older and hang. Both
    // start at the axis, so the root is inside the boss whatever the droop.
    const droop = i % 3 === 0 ? -0.62 - rng() * 0.3 : 0.16 + rng() * 0.24;
    const frond = MeshBuilder.CreateBox(
      `palm-frond${i}`,
      { width: len, height: 0.06, depth: 0.52 },
      scene,
    );
    frond.parent = trunk;
    frond.position.set(
      Math.cos(a) * (len / 2),
      height / 2 + 0.25 + Math.sin(droop) * (len / 2),
      Math.sin(a) * (len / 2),
    );
    frond.rotation.y = -a;
    frond.rotation.z = droop;
    // Translucent for the pine's reason and more so: a frond is one thin blade,
    // and a palm seen against a desert sky is mostly the light coming through
    // it. The lit tone goes on the arching ones, which are the ones the sun
    // actually reaches.
    frond.material = mats.getTranslucent(
      droop > 0 ? FROND_LIT : FROND,
      CONFIG.graphics.translucency.canopy,
    );
    marksSway(frond, "canopy");
  }

  // Two bunches of dates under the crown, on the fruiting side.
  for (let i = 0; i < 2; i++) {
    const a = rng() * Math.PI * 2;
    const bunch = MeshBuilder.CreateCylinder(
      `palm-dates${i}`,
      { height: 0.8, diameterTop: 0.16, diameterBottom: 0.5, tessellation: 6 },
      scene,
    );
    bunch.parent = trunk;
    bunch.position.set(Math.cos(a) * 0.62, height / 2 - 0.35, Math.sin(a) * 0.62);
    bunch.rotation.z = Math.cos(a) * 0.4;
    bunch.rotation.x = -Math.sin(a) * 0.4;
    bunch.material = mats.get(DATE_FRUIT);
    marksSway(bunch, "canopy");
  }
  return trunk;
}
