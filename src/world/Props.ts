/**
 * Props.ts — Scatter prop factories (trees, gravestones, lanterns, fungus,
 * logs, fire drums, rubble, boulders, brambles, barrels, jungle trees). Pure
 * mesh builders: each assembles at the origin and returns a
 * hierarchy; placement/merging/colliders are the caller's job.
 * Invariants: emissive parts (lantern glow, fire, fungus) MUST set
 * metadata.noInk (and noGlow where they shouldn't feed the bloom).
 * Foliage the wind moves calls `marksSway`, and NOTHING a collider stands in
 * for may (`PROP_BODIES` is the list to check) — see `world/sway.ts`.
 * Never set metadata.solid here — colliders come from MapBuilder only.
 * Never call rng() here — the per-prop jitter that makes a stand of
 * trees look like a stand of trees comes from the caller's seeded `rng`, so the
 * same layout builds the same world on every boot (see world/rng.ts).
 * One builder here is NOT a scatter prop and may not become one: the liana
 * veil is built by `buildJungleTree` and parented to its trunk, because a
 * curtain has to hang from a crown and scatter placement is what pushed it
 * away from every crown on the map. Its own header carries the measurement.
 */
import { Matrix, Mesh, MeshBuilder, Scene, Vector3, VertexData } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { flameData } from "./flame";
import { partBox, partCylinder, partSurface } from "./parts";
import { mulberry32 } from "./rng";
import { marksSway } from "./sway";

/**
 * Scatter props for Hollowmere — the loose dressing that fills space between
 * the authored buildings. Harvested from the retired room themes; each builder
 * takes `(scene, mats)` — plus an `rng` where the prop is randomised —
 * assembles a parented primitive hierarchy at the origin, and returns the root.
 * Emissive children are tagged `noInk` so the outline shell doesn't swallow
 * their glow.
 *
 * Placement (position, rotation, scale) is the caller's business — unlike the
 * old `PropSpec`, these carry no counts and no transform of their own.
 *
 * `rng` defaults to `Math.random` so a one-off caller (a model viewer, a test)
 * stays a two-argument call; MapBuilder always passes the map's seeded stream.
 */

const BARK = "#4a4238";
const DEAD_BARK = "#3c3730";
const NEEDLE = "#26402f";
const NEEDLE_LIT = "#35563d";
// The temperate BROADLEAF, and all three of these are picked against the pine
// standing next to it rather than in the abstract — see `buildAshTree`, whose
// whole job is to be a second tree you can tell apart at two hundred metres.
// Pale grey-green bark, because at that range the only things left of a tree
// are its shape and its VALUE, and a bole a shade lighter than the conifer's is
// half of the difference before a single leaf is drawn.
const ASH_BARK = "#6b6553";
// Summer leaf: warmer and yellower than `NEEDLE`, which is the other half. A
// hedgerow ash in July is the lightest green in a farming valley and a spruce
// belt is the darkest, so the pair should not be a hue apart at fifty metres
// and the same grey at two hundred.
const ASH_LEAF = "#35602f";
const ASH_LEAF_LIT = "#57893c";
// Ivy on a hedgerow bole: darker and bluer than the ash's own leaf, as ivy is
// against anything deciduous, so the climber reads as a second plant on the
// tree rather than as the crown leaking down it.
const IVY = "#2a3f2b";

// Jungle hardwood: paler and greyer than the valley's dead bark — a wet trunk
// under a bright sky, not a charred one under a moon.
const JUNGLE_BARK = "#5b5443";
// The date palm's three, and each is set against the DESERT rather than
// against the other trees in this file: a palm stands on bleached sand under a
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
const LEAF = "#2c5230";
const LEAF_LIT = "#437a3e";

/**
 * What the woods on a rolling rim wear (`Ridge.ts`), keyed by its tones: the
 * pine's own needles and bark, so a stand on the hill and the stands on the
 * plain in front of it are one wood seen at two distances, and the dark
 * broadleaf rather than the ash's — the ash's spring green, a hundred crowns
 * of it lit by a low sun, came out as a field of bright diamonds a long way
 * brighter than the pines beside it. `trans` is the translucency each takes,
 * `null` for an opaque cel material; `MapBuilder` reads both.
 */
export const RIM_WOOD = {
  needle: { hex: NEEDLE, trans: "foliage" },
  needleLit: { hex: NEEDLE_LIT, trans: "foliage" },
  leaf: { hex: LEAF, trans: "canopy" },
  bark: { hex: BARK, trans: null },
} as const;
// Creeper and moss. The same value as the kit's CREEPER, deliberately restated
// rather than imported: Props.ts owns its own palette and takes nothing from
// the structure kit, so a prop stays placeable without a builder.
const VINE = "#41552f";
const STONE = "#7a7f7c";
const DARK_STONE = "#5f6461";
const IRON = "#2f3338";
const RUST = "#5d4a3c";
const DARK_METAL = "#262a33";
const CONCRETE = "#4a4d54";

/**
 * Dead tree: a stag-headed snag — a broadleaf killed standing, its bole
 * heaving over from an upright foot, furrowed and flared into root knees, with
 * three to five limbs that leave it overhead and climb in CROOKED runs to
 * forked, twiggy ends or to a broken stump. Most of them have lost their top:
 * the bole ends in a ragged break, splinters standing round a dark, rotted-out
 * heart. Bark hangs off the bole in loose strips, a few limbs are snapped off
 * short, and bracket fungus shelves the foot of half of them. No canopy — the
 * silhouette is all splinters, and moonlight through them is most of what the
 * player sees at distance.
 *
 * **It was a hexagonal pole with six spikes pushed through it** and read as a
 * fence post, or a caltrop: every branch a straight cone CENTRED on the trunk,
 * so each one came out of the far side as a stub, and none of them forked.
 * What makes a dead tree read as one is the thing the spikes had least of —
 * the fine, angular BRANCHING against the sky, each run turning where a twig
 * once grew — so that is where this spends its vertices: the limbs are lofted
 * through kinks (`loft`), every limb throws side branches, and every end
 * forks into twigs, three-sided and a couple of centimetres thick, because a
 * twig is only ever seen as a line.
 *
 * Four things about the shape are load-bearing rather than decorative:
 *
 * - **The bole stays inside the collider's 0.35 m half-width from 0.3 m up to
 *   head height**, lean, crook and furrows together, so the column a round
 *   stops on is the column you see. The LEAN is why that needed arithmetic:
 *   the old trunk was tilted about its own middle, which walked its foot a
 *   quarter of a metre off the box. The lean is a CURVE now, zero at the foot
 *   and rising with the square of the height, so a snag stands on its roots
 *   and heaves over above you. The root knees are what is outside the box, and
 *   they are under 0.35 m there and fall to a few centimetres.
 * - **Nothing else reaches outside it below ~2.9 m** but the bark strips, hung
 *   on the face a few centimetres proud, and the fungus brackets, which stand
 *   out a hand's breadth under a metre up. The limbs and the snapped stubs leave
 *   the bole overhead, so a round at chest height never passes through wood it
 *   can see. That survives the layout's smallest scale (0.8).
 * - **Nothing here sways.** A dead tree has no leaf to move, and every member
 *   is a long thin thing lying along the ramp, the one shape `world/sway.ts`
 *   cannot bend honestly.
 * - **Its detail comes from a stream of its OWN.** `rng` is the map's shared
 *   scatter stream and every draw from it moves every prop after this one, so
 *   this takes exactly the draws the spiked pole took — the lean, the branch
 *   count, and five per branch — the first the lean and the seed of `own`, the
 *   rest taken and not spent.
 *
 * Budgeted as DRESSING: about a hundred stand on Cinderhaven's slopes and
 * nearly as many round Hollowmere, so a vertex here is a hundred in the scene.
 * In the two colours the pole wore — the bole and limbs in `BARK`, everything
 * finer and everything rotten in `DEAD_BARK` — so it costs no draw call the old
 * one did not, and it is TWO parts (`world/parts.ts`), one per colour, because
 * a part is a mesh the install pays for: built as its sixty-odd members, the
 * same vertices took a second longer to install on Hollowmere.
 */
export function buildDeadTree(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const bark = mats.get(BARK);
  const dead = mats.get(DEAD_BARK);
  // The first shared draw is the lean and the seed of this tree's own stream;
  // the second is the pole's branch count, which says how many more the pole
  // took (five a branch). Taken and not spent (see the header).
  const lean = rng();
  const spent = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < spent * 5; i++) rng();
  const own = mulberry32(Math.floor(lean * 4294967296) ^ 0x2f6b9e51);

  // Everything below is in the trunk's own frame, whose origin is 2.6 m up
  // (MapBuilder scales that and stands it on the ground), so a height above
  // the FOOT is `h + FOOT`.
  const FOOT = -2.6;
  type P3 = readonly [number, number, number];
  const dir = (az: number, el: number): P3 => [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];

  // Snapped, or still carrying a dead leader that thins to a point.
  const snapped = own() < 0.62;
  const topH = snapped ? 4.3 + own() * 0.8 : 5.9 + own() * 0.4;
  // The bole's girth, as [height above the foot, radius]: a flare into the
  // roots and a column that tapers to the break or on up into the leader.
  const GIRTH: readonly Flat[] = snapped
    ? [
        [-0.4, 0.47],
        [0, 0.45],
        [0.3, 0.32],
        [0.9, 0.28],
        [1.8, 0.255],
        [2.8, 0.22],
        [3.6, 0.19],
        [topH, 0.165],
      ]
    : [
        [-0.4, 0.47],
        [0, 0.45],
        [0.3, 0.32],
        [0.9, 0.28],
        [1.8, 0.255],
        [2.8, 0.21],
        [3.8, 0.15],
        [4.8, 0.09],
        [5.5, 0.045],
        [topH, 0.012],
      ];
  const girth = (h: number): number => {
    for (let i = 1; i < GIRTH.length; i++) {
      if (h <= GIRTH[i][0]) {
        const [h0, r0] = GIRTH[i - 1];
        const [h1, r1] = GIRTH[i];
        return r0 + ((r1 - r0) * (h - h0)) / (h1 - h0);
      }
    }
    return GIRTH[GIRTH.length - 1][1];
  };
  // The pole's own lean, ±0.09 rad, but as a CURVE from an upright foot (see
  // the header), plus a crook of its own on the same square law, so no two
  // snags heave over along the same line.
  const tilt = (lean - 0.5) * 0.18;
  const leanDir = own() * Math.PI * 2;
  const crook = 0.04 + own() * 0.06;
  const crookDir = own() * Math.PI * 2;
  const bole = (h: number): Ring => {
    const off = (tilt * h * h) / 4.4;
    const ck = crook * (h / topH) ** 2;
    return {
      x: Math.sin(leanDir) * off + Math.sin(crookDir) * ck,
      y: h + FOOT,
      z: Math.cos(leanDir) * off + Math.cos(crookDir) * ck,
      r: girth(h),
    };
  };
  const SIDES = 7;
  // Deeper than the pine's: a dead oak's bark is ridges a hand apart with the
  // furrows opened by drying, and the bands find that as the bark running up.
  const flute = Array.from({ length: SIDES }, () => (own() - 0.5) * 0.16);
  // Everything is gathered per COLOUR and merged into one part each at the
  // end: the tree is sixty-odd members, and as sixty parts the install paid
  // for each one as a mesh (a second on Hollowmere) for a merge that was
  // always going to make them two.
  const wood: VertexData[] = [loftData(GIRTH.map(([h]) => bole(h)), SIDES, flute)];
  const fine: VertexData[] = [];
  // A piece in the trunk's frame, yawed and pitched about its own origin and
  // then set where it goes — the order a mesh's own transform applies them.
  const put = (
    data: VertexData,
    rotten: boolean,
    at?: { x?: number; y?: number; z?: number; yaw?: number; pitch?: number },
  ): void => {
    if (at) {
      data.transform(
        Matrix.RotationYawPitchRoll(at.yaw ?? 0, at.pitch ?? 0, 0).multiply(
          Matrix.Translation(at.x ?? 0, at.y ?? 0, at.z ?? 0),
        ),
      );
    }
    (rotten ? fine : wood).push(data);
  };
  const member = (rings: readonly Ring[], sides: number, twiggy: boolean): void =>
    put(loftData(rings, sides), twiggy);

  // Root knees: the flare breaking into spurs, higher and more of them than
  // the pine's — a broadleaf roots deep and its knees stand proud once the
  // soil round a dead one has washed off them. Under 0.35 m where they leave
  // the collider, sunk under the foot so a slope cannot lift one out.
  const knees = own() < 0.5 ? 5 : 6;
  const kneeTurn = own() * Math.PI * 2;
  for (let i = 0; i < knees; i++) {
    const a = (i / knees) * Math.PI * 2 + kneeTurn + (own() - 0.5) * 0.5;
    const end = 0.6 + own() * 0.35;
    const knee = prismData(
      [
        [0.12, -0.4],
        [0.12, 0.55],
        [0.3, 0.34],
        [0.46, 0.15],
        [end, 0.03],
        [end - 0.06, -0.4],
      ],
      [0.2, 0.2, 0.17, 0.12, 0.06, 0.06],
      // Inside the bole, and under the ground.
      { skip: [0, 5] },
    );
    put(knee, false, { y: FOOT, yaw: a });
  }

  // A crooked run: out along a heading, turning at every joint where a twig
  // once grew, and climbing as it goes — a dead limb is angular, never a
  // smooth arc. Returns the rings and the heading it ended on.
  const crooked = (
    from: P3,
    az: number,
    el: number,
    len: number,
    segs: number,
    r0: number,
    r1: number,
    rise: number,
  ): { rings: Ring[]; az: number; el: number } => {
    const rings: Ring[] = [{ x: from[0], y: from[1], z: from[2], r: r0 }];
    let [x, y, z] = from;
    for (let s = 1; s <= segs; s++) {
      az += (own() - 0.5) * 0.7;
      el = Math.max(-0.35, Math.min(1.35, el + rise + (own() - 0.5) * 0.5));
      const [dx, dy, dz] = dir(az, el);
      const step = (len / segs) * (0.8 + own() * 0.4);
      x += dx * step;
      y += dy * step;
      z += dz * step;
      rings.push({ x, y, z, r: r0 + ((r1 - r0) * s) / segs });
    }
    return { rings, az, el };
  };
  // Twigs: three-sided and two rings, because at any distance past arm's
  // length a twig is a LINE against the sky and nothing else.
  const twigs = (at: Ring, az: number, el: number, n: number, len: number): void => {
    for (let t = 0; t < n; t++) {
      const ta = az + (t - (n - 1) / 2) * (0.7 + own() * 0.4) + (own() - 0.5) * 0.3;
      const te = el + 0.15 + (own() - 0.3) * 0.6;
      const l = len * (0.7 + own() * 0.6);
      const [dx, dy, dz] = dir(ta, te);
      member(
        [
          { x: at.x, y: at.y, z: at.z, r: Math.max(0.012, at.r * 0.8) },
          { x: at.x + dx * l, y: at.y + dy * l, z: at.z + dz * l, r: 0.004 },
        ],
        3,
        true,
      );
    }
  };

  // The LIMBS: three to five, leaving the bole overhead at staggered heights
  // round it by the golden angle, the lower ones reaching out and the upper
  // ones climbing — the stag's head, where a dead crown's limbs outstand its
  // broken top. Each is a crooked run of four, throws side branches off its
  // joints, and ends in a fork of twigs or, one time in four, snapped off.
  const limbs = 3 + Math.floor(own() * 3);
  const limbTurn = own() * Math.PI * 2;
  const limbTop = snapped ? topH - 0.3 : 4.9;
  for (let i = 0; i < limbs; i++) {
    const f = (i + 0.25 + own() * 0.5) / limbs;
    const h = 2.95 + f * (limbTop - 2.95);
    const at = bole(h);
    const az = limbTurn + i * 2.39996 + (own() - 0.5) * 0.4;
    const el = 0.25 + f * 0.45 + own() * 0.3;
    const len = (2.3 - f * 0.9) * (0.8 + own() * 0.35);
    const r0 = Math.min(0.14, at.r * 0.62);
    const broken = own() < 0.25;
    const run = crooked([at.x, at.y, at.z], az, el, broken ? len * 0.7 : len, 4, r0, broken ? r0 * 0.45 : 0.022, 0.08);
    // A swell where the limb leaves the bole: the collar every branch has.
    run.rings.splice(1, 0, {
      x: at.x + (run.rings[1].x - at.x) * 0.35,
      y: at.y + (run.rings[1].y - at.y) * 0.35,
      z: at.z + (run.rings[1].z - at.z) * 0.35,
      r: r0 * 0.95,
    });
    run.rings[0] = { ...run.rings[0], r: r0 * 1.3 };
    const rings = run.rings;
    if (broken) {
      // A torn end: the wood runs out to a splinter off to one side of the
      // axis rather than stopping square.
      const end = rings[rings.length - 1];
      const [dx, dy, dz] = dir(run.az + 0.5, run.el + 0.4);
      rings.push({ x: end.x + dx * 0.12, y: end.y + dy * 0.12, z: end.z + dz * 0.12, r: 0.008 });
    }
    member(rings, 5, false);

    // Side branches off the joints, alternating sides, each a crooked run of
    // two with twigs at its end.
    let side = own() < 0.5 ? -1 : 1;
    for (let j = 2; j < rings.length - 1; j++) {
      if (own() > 0.8) continue;
      const base = rings[j];
      const sa = az + side * (0.55 + own() * 0.55);
      side = -side;
      const sl = (0.5 + own() * 0.45) * (1 - (j / rings.length) * 0.35);
      const b = crooked([base.x, base.y, base.z], sa, el + 0.15 + own() * 0.3, sl, 2, base.r * 0.6, 0.012, 0.12);
      member(b.rings, 4, true);
      twigs(b.rings[b.rings.length - 1], b.az, b.el, 2, 0.3);
    }
    if (!broken) twigs(rings[rings.length - 1], run.az, run.el, 3, 0.4);
  }
  // The dead leader forks at its point, where a snapped top has splinters.
  if (!snapped) {
    const tip = bole(topH);
    twigs({ ...tip, r: 0.02 }, own() * Math.PI * 2, 1.0, 3, 0.4);
  }

  // Snapped-off limbs: short stubs overhead, thinning to a torn end that runs
  // out to one side of the axis — a limb breaks along its grain, never square.
  const stubs = 1 + Math.floor(own() * 3);
  for (let i = 0; i < stubs; i++) {
    const h = 3.0 + own() * (Math.min(topH, 4.6) - 3.2);
    const at = bole(h);
    const az = own() * Math.PI * 2;
    const [dx, dy, dz] = dir(az, -0.1 + own() * 0.5);
    const l = at.r + 0.14 + own() * 0.26;
    const r = at.r * (0.3 + own() * 0.15);
    const [tx, ty, tz] = dir(az + (own() < 0.5 ? -1 : 1) * (0.5 + own() * 0.5), 0.35);
    const tear = 0.1 + own() * 0.1;
    const end = { x: at.x + dx * l, y: at.y + dy * l, z: at.z + dz * l };
    member(
      [
        { x: at.x, y: at.y, z: at.z, r: r * 1.3 },
        { x: at.x + dx * at.r * 1.1, y: at.y + dy * at.r * 1.1, z: at.z + dz * at.r * 1.1, r },
        { ...end, r: r * 0.7 },
        { x: end.x + tx * tear, y: end.y + ty * tear, z: end.z + tz * tear, r: 0.008 },
      ],
      5,
      false,
    );
  }

  // The break: a rotted-out heart a few centimetres down the bole's open top,
  // DARK because that is what makes the rim read as a rim rather than a lid,
  // and the splinters of the shell standing round it — one of them the tall
  // spike every lightning-struck snag has.
  if (snapped) {
    const top = bole(topH);
    const heart = prismData(
      Array.from({ length: SIDES }, (_, k): Flat => {
        const a = (k / SIDES) * Math.PI * 2;
        return [Math.sin(a) * top.r * 0.95, Math.cos(a) * top.r * 0.95];
      }),
      0.04,
      { plane: "xz", centre: true },
    );
    put(heart, true, { x: top.x, y: top.y - 0.08, z: top.z });
    const shards = 4 + Math.floor(own() * 3);
    const spike = Math.floor(own() * shards);
    const shardTurn = own() * Math.PI * 2;
    for (let i = 0; i < shards; i++) {
      const a = shardTurn + ((i + (own() - 0.5) * 0.5) / shards) * Math.PI * 2;
      const tall = i === spike ? 0.8 + own() * 0.5 : 0.15 + own() * 0.35;
      const w = 0.05 + own() * 0.05;
      const tipOff = (own() - 0.5) * 0.3 * w;
      const shard = prismData(
        [
          [-w, -0.2],
          [w, -0.2],
          [w * 0.6, tall * 0.45],
          [tipOff, tall],
          [-w * 0.7, tall * 0.3],
        ],
        0.05,
      );
      put(shard, false, {
        x: top.x + Math.sin(a) * top.r * 0.8,
        y: top.y,
        z: top.z + Math.cos(a) * top.r * 0.8,
        yaw: a,
        pitch: 0.05 + own() * 0.15,
      });
    }
  }

  // Loose bark: strips hanging from where they still hold, narrowing to a
  // ragged end that has curled away from the wood, in the darker colour
  // because what is behind bark that has come away is shadow. Narrow on
  // purpose: a plate as wide as a hand read as a board nailed to the trunk.
  const strips = 2 + Math.floor(own() * 3);
  for (let i = 0; i < strips; i++) {
    const tall = 0.4 + own() * 0.5;
    const h = 0.9 + tall + own() * Math.min(2.2, topH - 1.9 - tall);
    // Bedded against the bole where it is widest under the strip, its foot.
    const at = bole(h - tall);
    const a = own() * Math.PI * 2;
    const w = 0.035 + own() * 0.03;
    const strip = prismData(
      [
        [-w, 0],
        [w, 0],
        [w * (0.8 + own() * 0.3), -tall * (0.5 + own() * 0.15)],
        [w * (own() - 0.3), -tall],
        [-w * (0.1 + own() * 0.3), -tall * (0.75 + own() * 0.1)],
        [-w * (0.7 + own() * 0.3), -tall * (0.45 + own() * 0.15)],
      ],
      0.022,
      { centre: true },
    );
    const rr = at.r * 1.06 + 0.012;
    put(strip, true, {
      x: at.x + Math.sin(a) * rr,
      y: h + FOOT,
      z: at.z + Math.cos(a) * rr,
      yaw: a,
      // The foot curls OUT (a negative pitch swings the bottom edge to +Z).
      pitch: -(0.05 + own() * 0.09),
    });
  }

  // Bracket fungus stacked up the foot of half of them: shelves a hand's
  // breadth out, the up-face lit by the sky, which is what finds them at all.
  if (own() < 0.5) {
    const a = own() * Math.PI * 2;
    const n = 2 + Math.floor(own() * 2);
    for (let i = 0; i < n; i++) {
      const h = 0.35 + i * (0.14 + own() * 0.08);
      const at = bole(h);
      const R = 0.1 + own() * 0.07 - i * 0.015;
      const shelf: Flat[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = -Math.PI / 2 + (k / 6) * Math.PI;
        shelf.push([Math.sin(t) * R, Math.cos(t) * R * 0.75]);
      }
      shelf.push([R, -0.08], [-R, -0.08]);
      const bracket = prismData(shelf, 0.045, { plane: "xz", centre: true });
      const ba = a + (own() - 0.5) * 0.6;
      const rr = at.r * 0.95;
      put(bracket, true, { x: at.x + Math.sin(ba) * rr, y: at.y, z: at.z + Math.cos(ba) * rr, yaw: ba });
    }
  }
  // The bole carries every other piece of BARK and is the root; the fine and
  // rotten wood is its one child.
  const trunk = partSurface("dead-trunk", wood[0].merge(wood.slice(1)), scene);
  trunk.position.y = -FOOT;
  trunk.material = bark;
  if (fine.length) {
    const rest = partSurface("dead-fine", fine[0].merge(fine.slice(1)), scene);
    rest.parent = trunk;
    rest.material = dead;
  }
  return trunk;
}

/**
 * How many draws `buildPine` takes from the shared scatter stream — the number
 * the four-cone pine it replaced took (the lean, then four per tier), and fixed
 * there, so redrawing the tree moved no prop on any map it stands on. See its
 * header.
 */
const PINE_SHARED_DRAWS = 17;

/**
 * Living pine: a planted conifer of the spruce habit — a straight, fluted bole
 * on a flare of root knees, carrying seven WHORLS of boughs that droop from the
 * trunk to pointed tips, each whorl's tips set between the ones above it, so
 * the crown is a cone with a SERRATED edge and a dark, ribbed underside. The
 * hilltop woods on Harrowmead, the plantings and woods on Coldharbour and the
 * pines on Cinderhaven's two arms are all this tree at different scales.
 *
 * **It was four smooth cones stacked on a hexagonal pole** and read as a stack
 * of lampshades: every tier's rim a horizontal edge, one over another, and from
 * under it a flat dark lid. The silhouette is still the cone — that is the
 * whole difference between this tree and the ash (`buildAshTree`) at two
 * hundred metres, and the rim's woods (`RIM_WOOD`) are the same cone in the
 * same paint — but each whorl is now BOUGHS: a star-rimmed shell, flat-shaded,
 * whose every bough is a RIDGE from the trunk out to its tip, so the bands put
 * a lit side and a shade side on each one and the ink draws the ridge. That is
 * the jungle hardwood's and the ash's lesson in this tree's own terms — the
 * detail is an OUTLINE the bands and the ink find, never a texture.
 *
 * Four things about it are load-bearing rather than decorative:
 *
 * - **The lowest needle is at ~1.84 m**, clear of the 1.7 m hit sphere, which
 *   is where the old lowest skirt was: the collider is the trunk only (see
 *   `PROP_BODIES`), so boughs hanging at chest height would be foliage you
 *   can shoot straight through — the complaint the prop bodies were measured
 *   to fix. That is the worst TIP, not the average, and the underside rises
 *   from the tips toward the trunk, so nothing under the skirt is lower.
 * - **The crown tops out at 6.95 m**, inside `PROP_BODIES.pine.visualTop`
 *   (7.0), which is frozen, and the leader dies inside the top whorl.
 * - **The bole stays inside the collider's 0.31 m half-width** from 0.3 m up,
 *   flutes and bow included, so the column a round stops on is the column you
 *   see; the root knees are what is outside it and they are under 0.35 m
 *   there, falling to a few centimetres — a thing a boot steps over.
 * - **Its detail comes from a stream of its OWN.** `rng` is the map's shared
 *   scatter stream and every draw from it moves every prop after this one, so
 *   this takes exactly `PINE_SHARED_DRAWS` from it — the first the lean and
 *   the seed of `own`, the rest taken and not spent.
 *
 * Every whorl's apex is ON the bole and its underside meets the bole lower
 * down, so a whorl sways (`world/sway.ts`) about a point inside the trunk and
 * the whorl over it; the bough never comes off the wood it grows from by more
 * than the few centimetres the ramp is entitled to at that height.
 *
 * Budgeted as DRESSING: some six hundred stand on Harrowmead and on
 * Coldharbour each, so a vertex here is six hundred in the scene. Built from
 * parts, in the three colours the cone pine wore, so it costs no draw call the
 * old one did not.
 */
export function buildPine(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const bark = mats.get(BARK);
  // Translucent for the reason the cones were: a pine with the light behind it
  // should have a lit edge, and a stand of them between you and the moon should
  // read as a screen you see light past rather than a row of black shapes.
  const needle = mats.getTranslucent(NEEDLE, CONFIG.graphics.translucency.foliage);
  const needleLit = mats.getTranslucent(NEEDLE_LIT, CONFIG.graphics.translucency.foliage);
  // A fifth of the dead tree's lean, because a dead trunk reads as FAILING and
  // a live one has to read as the thing that hasn't. The first shared draw and
  // the seed of this tree's own stream (see the header).
  const lean = rng();
  const own = mulberry32(Math.floor(lean * 4294967296) ^ 0x3c1e9d27);
  for (let i = 1; i < PINE_SHARED_DRAWS; i++) rng();

  // Everything below is in the trunk's own frame, whose origin is 3.2 m up
  // (MapBuilder scales that and stands it on the ground), so a height above
  // the FOOT is `h + FOOT`.
  const FOOT = -3.2;
  // The bole's girth, as [height above the foot, radius]: a flare into the
  // roots, then a column tapering to a leader that dies inside the top whorl.
  // Inside the collider's 0.31 m half-width from 0.3 m up, flutes included.
  const GIRTH: readonly Flat[] = [
    [-0.4, 0.4],
    [0, 0.38],
    [0.3, 0.285],
    [1.0, 0.26],
    [1.9, 0.235],
    [3.2, 0.15],
    [4.8, 0.09],
    [6.7, 0.03],
  ];
  // A conifer's bole is the straightest thing in a wood; what it has is a
  // slight bow, most of it in the middle of the height.
  const bowDir = own() * Math.PI * 2;
  const bowAmp = 0.02 + own() * 0.03;
  const bole = (h: number): Ring => {
    let r = GIRTH[GIRTH.length - 1][1];
    for (let i = 1; i < GIRTH.length; i++) {
      if (h <= GIRTH[i][0]) {
        const [h0, r0] = GIRTH[i - 1];
        const [h1, r1] = GIRTH[i];
        r = r0 + ((r1 - r0) * (h - h0)) / (h1 - h0);
        break;
      }
    }
    const w = bowAmp * Math.sin(Math.PI * Math.min(1, Math.max(0, h / 6.7)));
    return { x: Math.cos(bowDir) * w, y: h + FOOT, z: Math.sin(bowDir) * w, r };
  };
  const SIDES = 7;
  // Deeper than the ash's flutes: pine bark is plates and furrows, and a
  // section this far out of round is what the bands find as bark running up.
  const flute = Array.from({ length: SIDES }, () => (own() - 0.5) * 0.12);
  const trunk = loft("pine-trunk", GIRTH.map(([h]) => bole(h)), SIDES, scene, flute);
  trunk.position.y = -FOOT;
  trunk.material = bark;
  trunk.rotation.z = (lean - 0.5) * 0.04;

  // Root knees: the flare breaking into low spurs where the bole meets the
  // ground, shallower than the ash's — a conifer roots wide and flat. Under
  // 0.35 m where they leave the collider, sunk 0.4 m under the foot so a
  // slope the tree does not know it stands on cannot lift one out.
  const knees = own() < 0.5 ? 4 : 5;
  const kneeTurn = own() * Math.PI * 2;
  for (let i = 0; i < knees; i++) {
    const a = (i / knees) * Math.PI * 2 + kneeTurn + (own() - 0.5) * 0.6;
    const end = 0.52 + own() * 0.25;
    const knee = prism(
      `pine-knee${i}`,
      [
        [0.1, -0.4],
        [0.1, 0.45],
        [0.26, 0.3],
        [0.4, 0.12],
        [end, 0.03],
        [end - 0.05, -0.4],
      ],
      [0.17, 0.17, 0.15, 0.11, 0.06, 0.06],
      scene,
      // Inside the bole, and under the ground.
      { skip: [0, 5] },
    );
    knee.parent = trunk;
    knee.position.y = FOOT;
    knee.rotation.y = a;
    knee.material = bark;
  }

  // One sheet of flat-shaded triangles, each wound to face UP (`side` 1) or
  // DOWN (-1) whichever way its three points were listed.
  type P3 = readonly [number, number, number];
  const sheet = (name: string, faces: readonly (readonly [P3, P3, P3, number])[], lit: boolean): void => {
    if (!faces.length) return;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const [a, b, c, side] of faces) {
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      const s = (cy * side >= 0 ? 1 : -1) / (Math.hypot(cx, cy, cz) || 1);
      const nrm = [cx * s, cy * s, cz * s];
      const first = positions.length / 3;
      for (const p of [a, b, c]) {
        positions.push(p[0], p[1], p[2]);
        normals.push(nrm[0], nrm[1], nrm[2]);
        uvs.push(p[0], p[1] + p[2]);
      }
      tri(indices, positions, first, first + 1, first + 2, nrm);
    }
    const data = new VertexData();
    data.positions = positions;
    data.normals = normals;
    data.uvs = uvs;
    data.indices = indices;
    const mesh = partSurface(name, data, scene);
    mesh.parent = trunk;
    mesh.material = lit ? needleLit : needle;
    marksSway(mesh, "canopy");
  };

  // The WHORLS, as [the skirt's tip height above the foot, the apex's, how far
  // the tips reach, how many boughs]. Each overlaps the one under it by most of
  // its height, so the crown reads as one serrated cone rather than as tiers,
  // and the lowest tip, jittered down to its limit, is at 1.84 m (see the
  // header). The top whorl's apex is the crown's point.
  const WHORLS: readonly (readonly [number, number, number, number])[] = [
    [1.92, 3.2, 1.72, 9],
    [2.6, 3.85, 1.52, 9],
    [3.3, 4.5, 1.3, 8],
    [3.95, 5.1, 1.06, 7],
    [4.6, 5.7, 0.84, 6],
    [5.25, 6.3, 0.6, 5],
    [5.85, 6.95, 0.36, 4],
  ];
  WHORLS.forEach(([tipH, apexH, reach, n], w) => {
    const rise = apexH - tipH;
    const axis = bole(tipH);
    const top = bole(apexH);
    const apex: P3 = [top.x, top.y, top.z];
    // The underside meets the bole under the apex: the inside of an umbrella,
    // concave from below, so looking up into a whorl shows ribs in shade
    // rather than a lid.
    const low = bole(tipH + rise * 0.45);
    const under: P3 = [low.x, low.y, low.z];
    // The golden angle between whorls, so no tip stands over the one below.
    const turn = w * 2.39996 + own() * 0.5;
    const angles = Array.from({ length: n }, (_, k) => turn + ((k + (own() - 0.5) * 0.35) / n) * Math.PI * 2);
    // Each bough ENDS rather than tapering to a thorn: two points a hand or
    // two apart, because a spruce bough is a flat spray of twigs with a blunt,
    // ragged end, and a single point per bough read from under the crown as a
    // ring of blades.
    const tips: [P3, P3][] = angles.map((a) => {
      const r = reach * (0.86 + own() * 0.28);
      const half = (0.08 + own() * 0.05) / r;
      const y = tipH + (own() - 0.5) * 0.12 + FOOT;
      const end = (t: number, dy: number): P3 => [axis.x + Math.sin(t) * r, y + dy, axis.z + Math.cos(t) * r];
      return [end(a - half, (own() - 0.5) * 0.04), end(a + half, (own() - 0.5) * 0.04)];
    });
    // A valley between every pair of tips: the notch where one bough's needles
    // end and the next one's begin, set in and up from the tips.
    const valleys: P3[] = angles.map((a, k) => {
      const b = k + 1 < n ? angles[k + 1] : angles[0] + Math.PI * 2;
      const m = (a + b) / 2;
      const r = reach * (0.6 + own() * 0.12);
      return [axis.x + Math.sin(m) * r, tipH + rise * (0.26 + own() * 0.1) + FOOT, axis.z + Math.cos(m) * r];
    });
    // Two sheets: the boughs the light is on, and the shade — the boughs in
    // the lower crown and every whorl's underside. A real crown is not banded
    // by height, so each bough is drawn one or the other on a chance that
    // climbs the tree rather than by its whorl alone.
    const lit: [P3, P3, P3, number][] = [];
    const shade: [P3, P3, P3, number][] = [];
    const litChance = 0.2 + (w / (WHORLS.length - 1)) * 0.65;
    for (let k = 0; k < n; k++) {
      const prev = valleys[(k + n - 1) % n];
      const next = valleys[k];
      const into = own() < litChance ? lit : shade;
      const [l, r] = tips[k];
      into.push([apex, prev, l, 1], [apex, l, r, 1], [apex, r, next, 1]);
      shade.push([under, l, prev, -1], [under, r, l, -1], [under, next, r, -1]);
    }
    sheet(`pine-whorl${w}-lit`, lit, true);
    sheet(`pine-whorl${w}`, shade, false);
  });
  return trunk;
}

/**
 * How many draws `buildAshTree` takes from the shared scatter stream — the
 * number the plate crown it replaced took, and fixed there, so redrawing the
 * tree moved no prop on the map. See its header.
 */
const ASH_SHARED_DRAWS = 56;

/**
 * Hedgerow ash: a pale, faintly ridged bole on a flare of root knees, forking
 * a little over head height into three or four boughs that reach out and then
 * sweep UP, each ending in a cluster of leaf with pointed sprays breaking its
 * edge — an open, domed crown with sky and boughs showing through it. The
 * temperate BROADLEAF, and the counterpart to the pine in the same way the
 * jungle hardwood is the counterpart to nothing. A third of them carry ivy.
 *
 * **Why a farming valley needed a second tree at all.** A vale dressed in one
 * conifer is a plantation, not farmland: every stand reads as the same dark
 * cone at every distance, so a shelterbelt, a copse and a field boundary all
 * say the same thing, and the ground between them reads as empty rather than
 * as fields. What breaks that is a tree with a different SILHOUETTE — a bare
 * bole under a round crown against a cone that goes to the ground — because
 * silhouette is the one thing that survives to the far side of a 400 m map.
 * The bark and leaf tones (`ASH_BARK`, `ASH_LEAF`) are the second and third
 * differences and both were chosen against the pine's, not on their own.
 *
 * **It was four tiers of boxes centred on the axis** and read as a stack of
 * green crates on a hexagonal pole, one black cube from underneath. The crown
 * is CLUSTERS AT THE ENDS OF BOUGHS now, which is what an ash's crown is: the
 * maple's measured lesson (a tier is a rosette at one height, so its
 * silhouette is horizontal edges one over another) drawn in the jungle
 * hardwood's vocabulary — lozenge plates and pointed blades (`prism`), lofted
 * wood (`loft`), all flat-shaded outline the bands and the ink find. NOT smooth
 * puffs: a smooth-shaded crown was tried on this tree and thrown out.
 *
 * Four things about the shape are load-bearing rather than decorative:
 *
 * - **The lowest leaf hangs at ~3.5 m**, twice clear of the 1.7 m hit sphere.
 *   The collider is the bole only (see `PROP_BODIES`) — the pine's rule, and
 *   the reason the crown is carried high rather than skirted down toward the
 *   grass where it would be foliage rounds pass straight through. That is the
 *   worst CORNER: a side branch's cluster is never centred under 4.5 m, a
 *   plate sits at most 0.25 m under its cluster, and one tipped to its limits
 *   drops a corner ~0.5 m more. It survives scaling, since the whole tree is
 *   scaled — a region has to be dragged under ~0.5 before leaf reaches the
 *   sphere, and the layout's floor is 0.8. The crown tops out under 9.7 m,
 *   inside `PROP_BODIES.ashTree.visualTop`, which is frozen.
 * - **Every bough ends BURIED in leaf**, and the geometry is what makes it so
 *   rather than luck: each cluster's first plate is centred exactly on the tip
 *   of the bough carrying it and is over a metre across, against the ~0.17 m
 *   the crown drifts at that height. That is what makes it safe for the leaf
 *   to sway while the wood holding it does not — see `world/sway.ts` for why
 *   no bough is marked (a long thin thing lying along the ramp is the one
 *   shape a vertex ramp cannot bend honestly). The sprays start at a cluster's
 *   centre height, most of a metre inside its plate, and sway with it.
 * - **The bole stays inside the collider's 0.34 m half-width** from 0.3 m up,
 *   flutes and bend included, so the column a round stops on is the column
 *   you see. The root knees are what is outside it, and they are under 0.4 m
 *   there and fall to a few centimetres — a thing a boot steps over. The ivy is
 *   pressed to the bark, a few centimetres proud of it.
 * - **Its detail comes from a stream of its OWN.** `rng` is the map's shared
 *   scatter stream and every draw from it moves every prop after this one, so
 *   this takes exactly `ASH_SHARED_DRAWS` from it — the first the lean and
 *   the seed of `own`, the rest taken and not spent. Everything else is
 *   `own`'s: distinct per tree, fixed per layout, invisible to the map.
 *
 * Budgeted as DRESSING: some three hundred stand on Harrowmead, so a vertex
 * here is three hundred in the scene. Built from parts (`world/parts.ts`), so
 * none of it is uploaded to the device on its way to the merge, and in the
 * three materials the plate crown wore plus the ivy's two matte colours, which
 * go into the block's palette rather than a draw call of their own.
 *
 * Nothing here is scaled non-uniformly, for the reason `buildJungleTree`
 * states: a squashed part's normals are not renormalised by the merge.
 */
export function buildAshTree(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const bark = mats.get(ASH_BARK);
  const leaf = mats.getTranslucent(ASH_LEAF, CONFIG.graphics.translucency.canopy);
  const leafLit = mats.getTranslucent(ASH_LEAF_LIT, CONFIG.graphics.translucency.canopy);
  // A standard left in a hedge grows up rather than out — the pine's lean, and
  // for the pine's reason: the silhouette is the crown, so a tilted bole reads
  // as a tree coming down rather than as one with character. The first shared
  // draw, and the seed of this tree's own stream (see the header).
  const lean = rng();
  const own = mulberry32(Math.floor(lean * 4294967296) ^ 0x5a17e3b1);
  // The rest of the fifty-six the plate crown took, taken and not spent: the
  // scatter stream draws each tree's yaw and the next tree's spot straight
  // after this returns, so a draw fewer here moves every prop on Harrowmead.
  for (let i = 1; i < ASH_SHARED_DRAWS; i++) rng();

  // Everything below is in the trunk's own frame, whose origin is 4.3 m up
  // (MapBuilder scales that and stands it on the ground), so a height above
  // the FOOT is `h + FOOT`.
  const FOOT = -4.3;
  // The bole's girth, as [height above the foot, radius]: a flare into the
  // roots, the column, and the leader running on up the middle of the crown to
  // die inside the top cluster. Inside the collider's 0.34 m half-width from
  // 0.3 m up, flutes and bend included — 0.30 at chest height.
  const GIRTH: readonly Flat[] = [
    [-0.5, 0.46],
    [0, 0.44],
    [0.3, 0.34],
    [0.9, 0.3],
    [2.2, 0.28],
    [3.4, 0.25],
    [4.6, 0.2],
    [6.0, 0.14],
    [7.8, 0.07],
  ];
  const bendAmp = 0.04 + own() * 0.05;
  const bendRate = 0.4 + own() * 0.3;
  const bendPhase = own() * Math.PI * 2;
  const bendDir = own() * Math.PI * 2;
  const bole = (h: number): Ring => {
    let r = GIRTH[GIRTH.length - 1][1];
    for (let i = 1; i < GIRTH.length; i++) {
      if (h <= GIRTH[i][0]) {
        const [h0, r0] = GIRTH[i - 1];
        const [h1, r1] = GIRTH[i];
        r = r0 + ((r1 - r0) * (h - h0)) / (h1 - h0);
        break;
      }
    }
    const w = bendAmp * Math.sin(h * bendRate + bendPhase) * Math.min(1, Math.max(0, h - 1.5) / 3);
    return { x: Math.cos(bendDir) * w, y: h + FOOT, z: Math.sin(bendDir) * w, r };
  };
  const SIDES = 7;
  // Shallow flutes: an old ash's bark is ridged, and a section a few per cent
  // out of round is what the bands find as ridges running up the column.
  const flute = Array.from({ length: SIDES }, () => (own() - 0.5) * 0.08);
  const trunk = loft("ash-trunk", GIRTH.map(([h]) => bole(h)), SIDES, scene, flute);
  trunk.position.y = -FOOT;
  trunk.material = bark;
  trunk.rotation.z = (lean - 0.5) * 0.05;

  // Root knees: the flare breaking into four or five low spurs where the bole
  // meets the ground — the thing that says a tree GREW here rather than was
  // stood here. Under 0.4 m where they leave the collider and falling to a few
  // centimetres, so each is something a boot steps over; sunk 0.4 m under the
  // foot so a slope the tree does not know it stands on cannot lift one out.
  const knees = own() < 0.5 ? 4 : 5;
  const kneeTurn = own() * Math.PI * 2;
  for (let i = 0; i < knees; i++) {
    const a = (i / knees) * Math.PI * 2 + kneeTurn + (own() - 0.5) * 0.6;
    const end = 0.62 + own() * 0.3;
    const knee = prism(
      `ash-knee${i}`,
      [
        [0.1, -0.4],
        [0.1, 0.55],
        [0.3, 0.38],
        [0.46, 0.16],
        [end, 0.04],
        [end - 0.06, -0.4],
      ],
      [0.2, 0.2, 0.18, 0.13, 0.07, 0.07],
      scene,
      // Inside the bole, and under the ground.
      { skip: [0, 5] },
    );
    knee.parent = trunk;
    knee.position.y = FOOT;
    knee.rotation.y = a;
    knee.material = bark;
  }

  // A cluster of leaf: overlapping lozenge plates, turned and tipped each its
  // own way, the first centred exactly where the limb carrying it ends so the
  // tip is buried in the middle of a plate (see the header). `size` scales the
  // whole cluster; a limb's own is a metre and a half across, a side branch's
  // a little smaller.
  const cluster = (cx: number, cy: number, cz: number, count: number, size: number, out: number): void => {
    for (let k = 0; k < count; k++) {
      const off = k === 0 ? 0 : 0.35 + own() * 0.45;
      const b = out + (own() - 0.5) * 2.4;
      const up = k === 0 ? 0 : (own() - 0.35) * 0.7;
      const A = (size * (2.3 + own() * 0.7)) / 2;
      const B = (size * (1.4 + own() * 0.5)) / 2;
      const j = () => 1 + (own() - 0.5) * 0.16;
      const plate = prism(
        "ash-leaf",
        [
          [1.18 * A * j(), (own() - 0.5) * 0.5 * B],
          [0.58 * A * j(), 1.12 * B * j()],
          [-0.52 * A * j(), 1.08 * B * j()],
          [-1.18 * A * j(), (own() - 0.5) * 0.5 * B],
          [-0.58 * A * j(), -1.12 * B * j()],
          [0.52 * A * j(), -1.08 * B * j()],
        ],
        0.42 + own() * 0.14,
        scene,
        { plane: "xz" },
      );
      plate.parent = trunk;
      plate.position.set(cx + Math.sin(b) * off, cy + up, cz + Math.cos(b) * off);
      plate.rotation.y = own() * Math.PI * 2;
      plate.rotation.z = (own() - 0.5) * 0.8;
      plate.rotation.x = (own() - 0.5) * 0.7;
      // The sun is on the top of the crown and the top of each cluster; the
      // undersides and the heart are the shade — with a few exceptions,
      // because a real crown is not banded (the maple's rule).
      const sunny = cy + up - FOOT > 6.4 || up > 0.12;
      plate.material = sunny !== own() < 0.15 ? leafLit : leaf;
      marksSway(plate, "canopy");
    }
  };

  // A spray breaking the crown's edge: one pointed blade of leaf leaving a
  // cluster outward and down, its inner end at the cluster's centre height and
  // most of a metre inside the plate there. The ash's pinnate leaf read at the
  // size of a bough, and what makes the silhouette LEAF rather than lozenges.
  const spray = (cx: number, cy: number, cz: number, b: number): void => {
    const len = 1.5 + own() * 0.5;
    const w = 0.34 + own() * 0.1;
    const l = len / 2;
    const droop = 0.18 + own() * 0.26;
    const blade = prism(
      "ash-spray",
      [
        [-0.35 * w, -l],
        [0.35 * w, -l],
        [w, 0.05 * len],
        [0, l],
        [-w, 0.05 * len],
      ],
      0.12,
      scene,
      { plane: "xz" },
    );
    blade.parent = trunk;
    const reach = 0.75 + l * Math.cos(droop);
    blade.position.set(cx + Math.sin(b) * reach, cy - Math.sin(droop) * l, cz + Math.cos(b) * reach);
    blade.rotation.y = b;
    blade.rotation.x = droop;
    blade.material = own() < 0.5 ? leafLit : leaf;
    marksSway(blade, "canopy");
  };

  // The LIMBS: three or four, leaving the bole at staggered heights through a
  // metre above head height, reaching out and then sweeping UP at the end —
  // the ash's habit, and the one thing about its branching anybody knows.
  //
  // The crown they carry is a DOME in three storeys, and the storeys are what
  // stop it reading as a savanna acacia — which is what one storey of
  // clusters at the bough ends came out as, a flat green shelf on bare sticks.
  // Each bough ends in a cluster; each throws a side branch off its first bend
  // to a cluster lower and wider, the skirt that hides most of the bare wood;
  // and over each bough's end, inward, a cluster of the upper crown that
  // closes the shoulder of the dome toward the leader's own at the top. The
  // upper storey carries no wood of its own: it overlaps the storey under it
  // and the top, sways with both, and a bough into it would be inside leaf the
  // whole way. The dome is still OPEN — the clusters are separate masses, and
  // the sky and the boughs seen between them are half of what an ash is.
  const limbs = own() < 0.5 ? 4 : 3;
  const limbTurn = own() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + limbTurn + (own() - 0.5) * 0.5;
    const fork = 2.9 + (i / limbs) * 0.8 + own() * 0.3;
    const from = bole(fork);
    const reach = 2.0 + own() * 0.5;
    const tip = {
      x: from.x + Math.sin(a) * reach,
      y: 5.2 + (fork - 2.9) * 0.5 + own() * 0.6 + FOOT,
      z: from.z + Math.cos(a) * reach,
    };
    const along = (f: number, rise: number, r: number): Ring => ({
      x: from.x + (tip.x - from.x) * f,
      y: from.y + (tip.y - from.y) * rise,
      z: from.z + (tip.z - from.z) * f,
      r,
    });
    // Out first and up last: the horizontal runs ahead of the rise until the
    // last stretch, where the bough turns up into its leaf.
    const path = [along(0, 0, 0.15), along(0.45, 0.3, 0.12), along(0.85, 0.66, 0.085), along(1, 1, 0.06)];
    const limb = loft(`ash-limb${i}`, path, 6, scene);
    limb.parent = trunk;
    limb.material = bark;
    cluster(tip.x, tip.y, tip.z, 3 + (own() < 0.5 ? 1 : 0), 1.1, a);
    for (let s = own() < 0.5 ? 2 : 1; s > 0; s--) {
      spray(tip.x, tip.y, tip.z, a + (own() - 0.5) * 1.4);
    }
    const ub = a + (own() - 0.5) * 0.7;
    const ur = reach * (0.5 + own() * 0.15);
    cluster(from.x + Math.sin(ub) * ur, tip.y + 1.3 + own() * 0.4, from.z + Math.cos(ub) * ur, 2, 1.1, ub);

    if (own() < 0.85) {
      const base = path[1];
      const side = a + (own() < 0.5 ? -1 : 1) * (0.7 + own() * 0.3);
      const sr = reach * (0.95 + own() * 0.2);
      const end = {
        x: from.x + Math.sin(side) * sr,
        // Never under 4.3 m, which is what holds the lowest leaf where the
        // header says it is.
        y: Math.max(tip.y - 0.9 - own() * 0.5, 4.3 + FOOT),
        z: from.z + Math.cos(side) * sr,
      };
      // Out of the limb's first bend, where it is still thick enough to bury
      // a branch half its girth.
      const twig = loft(
        `ash-branch${i}`,
        [
          { ...base, r: 0.075 },
          { x: (base.x + end.x) / 2, y: base.y + (end.y - base.y) * 0.45, z: (base.z + end.z) / 2, r: 0.055 },
          { ...end, r: 0.04 },
        ],
        5,
        scene,
      );
      twig.parent = trunk;
      twig.material = bark;
      cluster(end.x, end.y, end.z, 2, 0.95, side);
      if (own() < 0.5) spray(end.x, end.y, end.z, side + (own() - 0.5) * 0.8);
    }
  }

  // The top: the leader's own cluster, over the middle, and what rounds the
  // dome off instead of leaving a ring of clusters round a hole. The leader
  // stops a fifth of a metre under its centre.
  const top = bole(8.0);
  cluster(top.x, top.y, top.z, 3, 1.15, own() * Math.PI * 2);

  // IVY on some of the boles — the hedgerow's own climber, and the one detail
  // on this tree at the height a player actually looks. A dark stem winding up
  // the bark with small leaves pressed flat to it, never a hand's breadth off
  // the bark. Plain matte and NOT marked, for the jungle climber's reason: a
  // leaf flat on bark has no sky behind it to glow against and may not drift
  // off the trunk it grips, and a matte colour goes into the block's palette
  // with the bark and costs nothing but its vertices.
  if (own() < 0.35) {
    const from = 0.1;
    const to = 2.6 + own() * 1.8;
    const turns = (0.8 + own() * 0.7) * (own() < 0.5 ? 1 : -1);
    const phase = own() * Math.PI * 2;
    const wind = (t: number, off: number): Ring & { th: number } => {
      const b = bole(from + (to - from) * t);
      const th = phase + turns * Math.PI * 2 * t;
      const r = b.r * 1.04 + off;
      return { x: b.x + Math.sin(th) * r, y: b.y, z: b.z + Math.cos(th) * r, r: 0, th };
    };
    const steps = 8;
    const stem = loft(
      "ash-ivy",
      Array.from({ length: steps }, (_, i) => ({
        ...wind(i / (steps - 1), 0.025),
        r: 0.03 - (0.015 * i) / (steps - 1),
      })),
      4,
      scene,
    );
    stem.parent = trunk;
    stem.material = mats.get(VINE);
    const dark = mats.get(IVY);
    const vine = mats.get(VINE);
    const count = 12 + Math.floor(own() * 8);
    for (let k = 0; k < count; k++) {
      const at = wind((k + 0.5 + (own() - 0.5) * 0.8) / count, 0.03);
      // Offset round the stem a little either side, so the leaves read as a
      // growth on the bark rather than beads on a string.
      const s = 0.8 + own() * 0.5;
      const ivy = prism(
        "ash-ivy-leaf",
        [
          [0, 0.02 * s],
          [0.09 * s, -0.05 * s],
          [0.05 * s, -0.12 * s],
          [0, -0.17 * s],
          [-0.05 * s, -0.12 * s],
          [-0.09 * s, -0.05 * s],
        ],
        0.025,
        scene,
      );
      ivy.parent = trunk;
      ivy.position.set(at.x, at.y + (own() - 0.5) * 0.1, at.z);
      ivy.rotation.y = at.th + (own() - 0.5) * 0.35;
      ivy.rotation.z = (own() - 0.5) * 1.6;
      ivy.rotation.x = -(0.15 + own() * 0.25);
      ivy.material = own() < 0.3 ? vine : dark;
    }
  }
  return trunk;
}

/**
 * Where one liana strand takes hold, in the trunk's own frame relative to the
 * veil's collar: `a` around the axis, `r` out from it, `y` up or down from the
 * collar's centre. Built by `buildJungleTree` out of the frond ring it has just
 * made and consumed by `buildLianaVeil` — see both for why the tree is what
 * decides this.
 */
export interface LianaHang {
  a: number;
  r: number;
  y: number;
}

/** A point in a part's own plane — see `prism`. */
type Flat = readonly [number, number];

/** One cross-section of a `loft`: its centre and its radius. */
interface Ring {
  x: number;
  y: number;
  z: number;
  r: number;
}

/**
 * One triangle, wound the way Babylon draws a FRONT face: the one whose
 * `(b - a) x (c - a)` points INTO the solid, which is the box's own convention
 * and `convexSolid`'s. Asked of the normal rather than assumed, so no caller
 * has to know which way round its outline runs.
 */
function tri(
  indices: number[],
  p: readonly number[],
  a: number,
  b: number,
  c: number,
  n: readonly number[],
): void {
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  const cross =
    (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
  if (cross > 0) indices.push(a, c, b);
  else indices.push(a, b, c);
}

/**
 * A flat-sided solid cut from an OUTLINE — a leaf, a frond, a buttress — at a
 * box's price or near it. `outline` lies in the part's own XY plane, stood
 * `thick` deep along Z, or with `plane: "xz"` in its XZ plane, `thick` deep
 * along Y (a leaf plate lies flat, a buttress stands up). `thick` may be one
 * number or one per outline point, so a fin can thin toward its tail.
 *
 * Every face is flat-shaded, which is what lets the bands and the ink find its
 * edges exactly as they find a box's; the point of it is the OUTLINE, which a
 * box can only ever draw as a rectangle. A four-point outline costs exactly
 * the box's 24 vertices. `skip` leaves out the side faces nothing can see — an
 * edge buried in the ground or inside the bole — by the index of the point
 * each starts at. The caps are fanned from the first point, which needs the
 * outline to be star-shaped about it, or from the centroid with `centre`.
 */
function prism(
  name: string,
  outline: readonly Flat[],
  thick: number | readonly number[],
  scene: Scene,
  opts: { plane?: "xy" | "xz"; centre?: boolean; skip?: readonly number[] } = {},
): Mesh {
  return partSurface(name, prismData(outline, thick, opts), scene);
}

/**
 * `prism`'s geometry without the mesh, for a builder that merges many of them
 * into one part itself (see `buildDeadTree`).
 */
function prismData(
  outline: readonly Flat[],
  thick: number | readonly number[],
  opts: { plane?: "xy" | "xz"; centre?: boolean; skip?: readonly number[] } = {},
): VertexData {
  const n = outline.length;
  const at = (u: number, v: number, w: number): number[] =>
    opts.plane === "xz" ? [u, w, v] : [u, v, w];
  const half = (i: number) => (typeof thick === "number" ? thick : thick[i]) / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vert = (p: readonly number[], nrm: readonly number[]): number => {
    positions.push(p[0], p[1], p[2]);
    normals.push(nrm[0], nrm[1], nrm[2]);
    uvs.push(p[0], p[1] + p[2]);
    return positions.length / 3 - 1;
  };
  let cu = 0;
  let cv = 0;
  let ch = 0;
  for (let i = 0; i < n; i++) {
    cu += outline[i][0] / n;
    cv += outline[i][1] / n;
    ch += half(i) / n;
  }
  for (const side of [1, -1]) {
    const nrm = at(0, 0, side);
    const first = positions.length / 3;
    for (let i = 0; i < n; i++) vert(at(outline[i][0], outline[i][1], side * half(i)), nrm);
    if (opts.centre) {
      const c = vert(at(cu, cv, side * ch), nrm);
      for (let i = 0; i < n; i++) tri(indices, positions, c, first + i, first + ((i + 1) % n), nrm);
    } else {
      for (let i = 1; i + 1 < n; i++) tri(indices, positions, first, first + i, first + i + 1, nrm);
    }
  }
  const skip = new Set(opts.skip ?? []);
  for (let i = 0; i < n; i++) {
    if (skip.has(i)) continue;
    const j = (i + 1) % n;
    const [ui, vi] = outline[i];
    const [uj, vj] = outline[j];
    // Square to the edge in the outline's plane, and away from its middle.
    let nu = vj - vi;
    let nv = ui - uj;
    if (nu * ((ui + uj) / 2 - cu) + nv * ((vi + vj) / 2 - cv) < 0) {
      nu = -nu;
      nv = -nv;
    }
    const len = Math.hypot(nu, nv) || 1;
    const nrm = at(nu / len, nv / len, 0);
    const q = [
      vert(at(ui, vi, half(i)), nrm),
      vert(at(uj, vj, half(j)), nrm),
      vert(at(uj, vj, -half(j)), nrm),
      vert(at(ui, vi, -half(i)), nrm),
    ];
    tri(indices, positions, q[0], q[1], q[2], nrm);
    tri(indices, positions, q[0], q[2], q[3], nrm);
  }
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  return data;
}

/**
 * A round member through a run of `rings` — a bole that wanders, a limb that
 * arches, a vine that winds — smooth round its girth like the cylinders it
 * replaces, and open at both ends, because every caller buries both.
 *
 * The cross-section is carried ring to ring (each ring's first axis is the
 * last one's, squared to the new tangent) so a bend does not twist the mesh.
 * `flute` is a radius scale per SIDE rather than per vertex, the same at every
 * ring: an irregular section held the whole height reads as the ridged,
 * fluted bole of a rainforest hardwood, where noise per vertex reads as a
 * crumpled can.
 */
function loft(
  name: string,
  rings: readonly Ring[],
  sides: number,
  scene: Scene,
  flute?: readonly number[],
): Mesh {
  return partSurface(name, loftData(rings, sides, flute), scene);
}

/** `loft`'s geometry without the mesh — `prismData`'s twin. */
function loftData(rings: readonly Ring[], sides: number, flute?: readonly number[]): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let ux = 0;
  let uy = 0;
  let uz = 0;
  let run = 0;
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    const a = rings[Math.max(0, i - 1)];
    const b = rings[Math.min(rings.length - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    let tz = b.z - a.z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    if (i === 0) {
      // Any axis square to the first tangent: up × t, or X × t for a member
      // that starts out vertical.
      const [rx, ry, rz] = Math.abs(ty) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      ux = ry * tz - rz * ty;
      uy = rz * tx - rx * tz;
      uz = rx * ty - ry * tx;
    } else {
      run += Math.hypot(ring.x - a.x, ring.y - a.y, ring.z - a.z);
    }
    const d = ux * tx + uy * ty + uz * tz;
    ux -= tx * d;
    uy -= ty * d;
    uz -= tz * d;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ty * uz - tz * uy;
    const vy = tz * ux - tx * uz;
    const vz = tx * uy - ty * ux;
    for (let j = 0; j <= sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const nx = c * ux + s * vx;
      const ny = c * uy + s * vy;
      const nz = c * uz + s * vz;
      const r = ring.r * (1 + (flute?.[j % sides] ?? 0));
      positions.push(ring.x + nx * r, ring.y + ny * r, ring.z + nz * r);
      normals.push(nx, ny, nz);
      uvs.push(j / sides, run);
    }
  }
  const row = sides + 1;
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * row + j;
      const b = a + row;
      const na = normals.slice(a * 3, a * 3 + 3);
      tri(indices, positions, a, b, a + 1, na);
      tri(indices, positions, a + 1, b, b + 1, na);
    }
  }
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  return data;
}

/**
 * Jungle hardwood: a buttressed, fluted bole running bare for two storeys and
 * then forking into a canopy of broad leaf and fronds. The tall counterpart
 * to the pine — where a pine is a cone you see the whole of, this is a column
 * with the foliage held above the fight, so a stand of them closes the sky
 * without closing the sight lines under it.
 *
 * Four things about the shape are load-bearing rather than decorative:
 *
 * - **The lowest leaf hangs at ~9 m**, five times clear of the 1.7 m hit
 *   sphere. The collider is the trunk and its buttress core only (see
 *   `PROP_BODIES`), so anything at chest height would be foliage rounds pass
 *   straight through — the pine's rule, and a canopy tree has far more leaf to
 *   get it wrong with. The climber below is the one leaf under it, and it is
 *   pressed flat on the bark.
 * - **The bole stays inside the collider's 0.5 m half-width up to the crown**
 *   — flare, flutes and bend together — so the column a round stops on is the
 *   column you see. The BUTTRESSES do not, and are shaped so that what is
 *   outside is low: steep against the bole and falling away, under a metre
 *   high at the box's corner and a surface root under 0.3 m past it. They are
 *   what makes the trunk read as tropical at all; a bare cylinder of this
 *   height is a telegraph pole.
 * - **The fronds are two segments, not one**, and the outer one droops harder.
 *   A single straight blade reads as a plank at any distance the fog leaves
 *   visible; the break is where the whole silhouette comes from. Both are cut
 *   to a LEAF's outline — narrow at the stalk, pointed at the tip — rather than
 *   boxed, at the box's price (see `prism`).
 * - **The shade is the PLATES' and the silhouette is the FRONDS'**, and the
 *   split is what makes a closed canopy affordable at all. See the crown
 *   below, which carries the measurement that forced it.
 *
 * **Its detail comes from a stream of its OWN, and neither of the two it is
 * handed.** `rng` is the map's shared scatter stream and every draw from it
 * moves every tree, fern and flag walk after this one, so this takes exactly
 * the forty-eight draws it always took, in the same order; `sub` is the veil's
 * (below), and a draw taken from it would re-hang every curtain on the map.
 * So the flutes, the bend, the extra buttresses, the limbs, the leaf outlines
 * and the climber are drawn from `own`, a generator keyed off this tree's
 * first shared draw — distinct per tree, fixed per layout, and invisible to
 * both of the others.
 *
 * **Some of them carry the belt's mid-story, and it is a CHILD of the trunk
 * rather than a prop placed near one.** `buildLianaVeil` is the curtain and
 * carries the argument for why the layer exists at all; what belongs here is
 * why it is built from inside a tree. A veil has to hang from a crown, and a
 * scattered prop cannot find one — `findSpot`'s burial test pushes anything
 * non-blocking out of a `blocking` tree's box, so a mid-story sampled as its
 * own region lands in the GAPS between the trunks, and neither the anchor's
 * height nor the tree's scale is known to the other. Hung here, all three
 * answer themselves: the veil is parented to the trunk, rides its scale, and
 * hangs at a fixed point on it.
 *
 * **`sub` is why that costs the map nothing, and it is load-bearing.** Every
 * draw the veil makes comes from a stream of its own, so the shared scatter
 * stream sees exactly the draws it saw before this existed and not one more —
 * which is what leaves all 354 trees, all 149 fern clumps and all five flag
 * walks on Greyfen where they already were. Drawing the veil from `rng` would
 * reroll the entire dressing field of any map with a jungle belt on it. It
 * defaults to `rng` so a one-off caller stays a two- or three-argument call;
 * `MapBuilder.scatterRegion` is what mints the real one.
 *
 * **It is the most-placed model on its map by a wide margin** — some fourteen
 * hundred on Greyfen — so it is budgeted as dressing, a vertex here being
 * fourteen hundred in the scene. That is what the shapes below are chosen
 * against: an outline where a box read as a board, a loft where a cylinder
 * read as a pole, and nothing that only the far side of a leaf could see.
 * Built from parts (`world/parts.ts`), like the maple, so none of it is
 * uploaded to the device on its way to the merge.
 *
 * Nothing here is scaled non-uniformly — `renderOutline` extrudes along vertex
 * normals and `VertexData.transform` does not re-normalise them, so a squashed
 * part grows a lopsided ink shell.
 */
export function buildJungleTree(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
  sub: () => number = rng,
): Mesh {
  const bark = mats.get(JUNGLE_BARK);
  const vine = mats.get(VINE);
  const leaf = mats.getTranslucent(LEAF, CONFIG.graphics.translucency.canopy);
  const leafLit = mats.getTranslucent(LEAF_LIT, CONFIG.graphics.translucency.canopy);
  // A hardwood carries its own weight — a fifth of the pine's already-slight
  // lean, and only enough that a stand of them is not a row of posts. The
  // first shared draw, and the seed of this tree's own stream (see the
  // header): `mulberry32` hands out whole multiples of 2^-32, so the product
  // is an exact integer and no two trees on a map share it.
  const lean = rng();
  const own = mulberry32(Math.floor(lean * 4294967296) ^ 0x2c1b3c6d);

  // Everything below is in the trunk's own frame, whose origin is 5.6 m up
  // (MapBuilder scales that and stands it on the ground), so a height above
  // the FOOT is `h + FOOT`.
  const FOOT = -5.6;
  // The bole's girth, as [height above the foot, radius]: a flare into the
  // roots, a quick narrowing to the column, and a slow taper to the crown. The
  // whole of it is inside the collider's 0.5 m half-width from 0.4 m up, with
  // the flutes and the bend below included — 0.47 at chest height, and 5% of
  // flute puts that at 0.49.
  const GIRTH: readonly Flat[] = [
    [-0.6, 0.62],
    [0, 0.6],
    [0.4, 0.52],
    [1.1, 0.47],
    [2.6, 0.43],
    [5.4, 0.36],
    [7.8, 0.285],
    [10.75, 0.2],
  ];
  // It wanders, a few centimetres either way, and only above head height:
  // a straight bole of this height is the other half of the telegraph pole.
  const bendAmp = 0.05 + own() * 0.05;
  const bendRate = 0.35 + own() * 0.25;
  const bendPhase = own() * Math.PI * 2;
  const bendDir = own() * Math.PI * 2;
  const bole = (h: number): Ring => {
    let r = GIRTH[GIRTH.length - 1][1];
    for (let i = 1; i < GIRTH.length; i++) {
      if (h <= GIRTH[i][0]) {
        const [h0, r0] = GIRTH[i - 1];
        const [h1, r1] = GIRTH[i];
        r = r0 + ((r1 - r0) * (h - h0)) / (h1 - h0);
        break;
      }
    }
    const w = bendAmp * Math.sin(h * bendRate + bendPhase) * Math.min(1, Math.max(0, h - 1.5) / 4);
    return { x: Math.cos(bendDir) * w, y: h + FOOT, z: Math.sin(bendDir) * w, r };
  };
  const SIDES = 8;
  const flute = Array.from({ length: SIDES }, () => (own() - 0.5) * 0.1);
  // It stops at 10.75 m, the middle of the upper plate tier, where it used to
  // run on to 11.2 and stand through the top of its own crown: from above, a
  // forest of green plates each with a stump in the middle. The collider still
  // runs to 11.2 — inside the leaf, where nothing can tell.
  const trunk = loft("jungle-trunk", GIRTH.map(([h]) => bole(h)), SIDES, scene, flute);
  trunk.position.y = -FOOT;
  trunk.material = bark;
  trunk.rotation.z = (lean - 0.5) * 0.05;

  // Buttress roots: plank fins standing out of the bole, steep against it and
  // falling away in a curve to a root that runs on along the ground. The
  // profile is concave on purpose — a fin cut as a triangle or a box reads as
  // cardboard propped against a post, and the curve is what reads as wood
  // that grew there. Thick at the bole and thinning to the tail.
  //
  // Four or five of them. The first three take their heights from the shared
  // stream, as the three boxes they replace did; the rest are the tree's own,
  // and lower.
  const finTurn = rng() * Math.PI * 2;
  const finRise = [rng(), rng(), rng()];
  const fins = own() < 0.5 ? 4 : 5;
  for (let i = 0; i < fins; i++) {
    const a = (i / fins) * Math.PI * 2 + finTurn + (own() - 0.5) * 0.5;
    const h = i < 3 ? 2.3 + finRise[i] * 0.5 : 1.5 + own() * 0.9;
    // Where it meets the ground, and where the root running on from it sinks.
    const foot = 0.75 + h * 0.12 + own() * 0.2;
    const end = foot + 0.3 + own() * 0.35;
    const fin = prism(
      `jungle-buttress${i}`,
      [
        // Inside the bole, from under the ground to above where it leaves.
        [0.1, -0.6],
        [0.1, h + 0.15],
        // Where it leaves the bole, and down the curve.
        [0.4, h],
        [0.55, h * 0.5],
        [0.8, h * 0.2 + 0.06],
        [foot, 0.22],
        // The root's tail, and down into the ground under it — deep enough to
        // stay buried on a slope the tree does not know it stands on.
        [end, 0.05],
        [end - 0.08, -0.6],
      ],
      [0.26, 0.26, 0.24, 0.2, 0.16, 0.12, 0.07, 0.08],
      scene,
      // Inside the bole, inside the bole, and under the ground.
      { skip: [0, 1, 7] },
    );
    fin.parent = trunk;
    fin.position.y = FOOT;
    fin.rotation.y = a;
    fin.material = bark;
  }

  // The crown's MASS, and the one thing on this tree that decides whether a
  // belt of them reads as jungle at all.
  //
  // It was a single cylinder 2.3 m across — "filling the middle the fronds
  // radiate out of" — and the middle was never what was open. Measured over
  // the shipped valley, a ray fired straight up from head height inside the
  // THICKEST belt found leaf 24% of the time; the other three quarters of the
  // sky came down between the crowns, which is what made five belts of
  // hardwoods read as columns in a park.
  //
  // The fix is not more fronds, and the arithmetic is why. A frond is a
  // 12-triangle box whose blade is 1.5 m wide, so it covers ~4 m2 of sky; the
  // same twelve triangles as a plate 6 m across cover ~15. Closing a canopy
  // out of fronds costs four times what closing it out of leaf mass does, and
  // that ratio is the whole reason the old crown could not afford to close.
  // So the mass is broad overlapping plates and the fronds are what break its
  // edge — the silhouette stays theirs, the shade becomes the plates'.
  //
  // Two tiers, because one rosette of plates is a parasol: the upper tier sits
  // 0.8 m higher and is turned off the lower one's spokes, so the gaps in each
  // sit over the other's leaf and the mass has depth when you stand under it.
  //
  // Each plate is a LOZENGE rather than a rectangle: pointed at both ends of
  // its length and irregular along its sides, stated as fractions of the box
  // it replaced and sized to within a few per cent of its area, so the sky it
  // closes is the sky the box closed. A rosette of rectangles is a stack of
  // boards from underneath; the same rosette of lozenges is a star of leaf.
  const plates: [number, number, number, number, number][] = [
    // count, height on the trunk, width, depth, thickness
    [4, 4.35, 7.6, 3.0, 0.55],
    [3, 5.15, 5.6, 2.5, 0.45],
  ];
  // The lower tier as it was laid, for the limbs that carry it.
  const lower: { a: number; roll: number; pitch: number }[] = [];
  plates.forEach(([count, y, width, depth, thick], tier) => {
    const turn = rng() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + turn + rng() * 0.3;
      // Relief, so the mass is not a flat lid. `roll` turns the plate about
      // its own long axis and `pitch` tips it along its depth — both after
      // the yaw, so both are in the plate's own frame.
      const roll = (rng() - 0.5) * 0.26;
      const pitch = (rng() - 0.5) * 0.18;
      const A = width / 2;
      const B = depth / 2;
      const j = () => 1 + (own() - 0.5) * 0.14;
      const plate = prism(
        `jungle-leaf${tier}-${i}`,
        [
          [1.18 * A * j(), (own() - 0.5) * 0.5 * B],
          [0.58 * A * j(), 1.12 * B * j()],
          [-0.52 * A * j(), 1.08 * B * j()],
          [-1.18 * A * j(), (own() - 0.5) * 0.5 * B],
          [-0.58 * A * j(), -1.12 * B * j()],
          [0.52 * A * j(), -1.08 * B * j()],
        ],
        thick,
        scene,
        { plane: "xz" },
      );
      plate.parent = trunk;
      // Centred ON the axis rather than out from it: a plate is a slab of
      // canopy the trunk holds up through its middle, so four of them at
      // 90 degrees are a rosette with no hole in it. Fronds are what sit out
      // at a radius, below.
      plate.position.y = y;
      plate.rotation.y = a;
      plate.rotation.z = roll;
      plate.rotation.x = pitch;
      // The lit green goes up, the shaded green goes down: what a canopy shows
      // the sky is never what it shows the ground beneath it.
      plate.material = tier === 0 ? leaf : leafLit;
      // The whole crown is what the wind moves, and the trunk under it is not
      // — `world/sway.ts` carries the argument, and the geometry that makes it
      // safe is here: a plate is centred on the axis and metres across, so the
      // third of a metre it drifts is inside its own overlap of the bole.
      marksSway(plate, "canopy");
      if (tier === 0) lower.push({ a, roll, pitch });
    }
  });

  // The LIMBS, forking out of the bole two metres under the crown and each
  // running up into the long arm of a lower plate. From underneath, which is
  // where anybody on this map looks at a canopy from, they are what says the
  // crown is CARRIED — without them it was a lid balanced on a post.
  //
  // Each ends at the middle of its plate's thickness, a metre and a half or
  // so out along the arm — computed through the plate's own roll and pitch,
  // not guessed at — and that is the ash's rule for its reason: the crown
  // sways and the limb does not (a limb is a long thin thing lying along the
  // ramp, the trunk's argument at a shorter length), so the join has to be
  // BURIED. The arm is over three metres across there against the third of a
  // metre the plate drifts, and a tip ~0.1 m thick sits inside a slab 0.55 m
  // deep with its roll already accounted for.
  const limbs = own() < 0.45 ? 4 : 3;
  const bare = limbs === 4 ? -1 : Math.floor(own() * 4);
  lower.forEach((p, k) => {
    if (k === bare) return;
    const reach = new Vector3(1.4 + own() * 0.4, 0, (own() - 0.5) * 0.6);
    const tip = Vector3.TransformCoordinates(reach, Matrix.RotationYawPitchRoll(p.a, p.pitch, p.roll));
    tip.y += plates[0][1];
    const from = bole(7.7 + own() * 0.7);
    const along = (f: number, rise: number, r: number): Ring => ({
      x: from.x + (tip.x - from.x) * f,
      y: from.y + (tip.y - from.y) * rise,
      z: from.z + (tip.z - from.z) * f,
      r,
    });
    // Steep out of the fork and flattening into the leaf.
    const limb = loft(
      `jungle-limb${k}`,
      [along(0, 0, 0.22), along(0.45, 0.72, 0.16), along(1, 1, 0.1)],
      6,
      scene,
    );
    limb.parent = trunk;
    limb.material = bark;
  });

  // Two rings of fronds, offset from each other so the gaps in one sit over the
  // blades of the other. Inner blade out from the plates, outer blade drooping
  // off its tip. FEWER and BIGGER than they were (six and five 0.95 m blades,
  // against four and three at 1.7 and 1.5): the plates took over the shading, so
  // what is left for a frond is the EDGE of the crown, and an edge is drawn
  // better by long blades with sky between them than by short ones packed.
  //
  // The count is a budget as much as a shape. A canopy tree is the most-drawn
  // object on this map by a wide margin — there are around fourteen hundred of
  // them — so a frond costs 1,400 blades wherever it is added, and the ring
  // counts were cut to the point where taking one more measurably opened the
  // sky (see the closure figures in `greyfen/layout.ts`).
  const rings: [number, number, number, number, number][] = [
    // count, height on the trunk, blade length, blade width, droop
    [4, 4.15, 3.6, 1.7, 0.34],
    [3, 5.0, 3.0, 1.5, 0.18],
  ];
  // Where the lowest ring's blades ended up. A liana hangs from foliage that
  // EXISTS rather than from a radius that hopes to be under some — see the
  // hang points below, and `buildLianaVeil` for why that matters.
  const boughs: { a: number; tilt: number }[] = [];
  rings.forEach(([count, y, len, width, droop], ring) => {
    const turn = rng() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + turn + rng() * 0.25;
      const tilt = droop + rng() * 0.16;
      // Narrow at the stalk and widening to the break, where the tip takes
      // over — or, on the upper ring, which has no tip, pointed there itself.
      const w = width / 2;
      const l = len / 2;
      const blade = prism(
        `jungle-frond${ring}-${i}`,
        ring === 0
          ? [
              [-0.4 * w, -l],
              [0.4 * w, -l],
              [0.96 * w, l],
              [-0.96 * w, l],
            ]
          : [
              [-0.4 * w, -l],
              [0.4 * w, -l],
              [w, 0.1 * len],
              [0, l],
              [-w, 0.1 * len],
            ],
        0.14,
        scene,
        { plane: "xz" },
      );
      blade.parent = trunk;
      blade.position.set(
        Math.sin(a) * (len / 2 + 0.5),
        y,
        Math.cos(a) * (len / 2 + 0.5),
      );
      blade.rotation.y = a;
      blade.rotation.x = tilt;
      // The lit green goes on the upper ring, for the reason the plates split
      // the same way.
      blade.material = ring === 0 ? leaf : leafLit;
      // With the plates, and at the same height, so the crown travels as one
      // piece rather than the fronds shearing off the mass they break the edge
      // of. The tip below inherits it for the same reason.
      marksSway(blade, "canopy");

      // The drooping tip, hung off the blade's own far end so it rides the
      // parent's yaw and tilt, and pointed. Its centre is derived from its own
      // break angle rather than authored: a fixed offset leaves the joint open
      // at one angle and the two segments overlapping at another.
      //
      // **Only on the LOWER ring**, which is the one break in the "two
      // segments, not one" rule and is a fact about where the ring sits rather
      // than a saving taken off it. The upper ring is 0.85 m higher and its
      // blades are shorter, so its tip breaks over INSIDE the mass the lower
      // ring and the plates already make: it is drawn against leaf from below
      // and against leaf from above, and the only silhouette it was ever in is
      // the lower ring's. Fourteen hundred trees, so that is 1,400 blades drawn
      // for an edge nothing can see.
      if (ring === 0) {
        const brk = 0.5 + rng() * 0.3;
        const tipLen = len * 0.8;
        const t = tipLen / 2;
        const tip = prism(
          `jungle-tip${ring}-${i}`,
          [
            [-0.88 * w, -t],
            [0.88 * w, -t],
            [0.8 * w, 0.05 * tipLen],
            [0, t],
            [-0.8 * w, 0.05 * tipLen],
          ],
          0.12,
          scene,
          { plane: "xz" },
        );
        tip.parent = blade;
        tip.rotation.x = brk;
        tip.position.set(
          0,
          (-Math.sin(brk) * tipLen) / 2,
          len / 2 + (Math.cos(brk) * tipLen) / 2,
        );
        tip.material = blade.material;
        marksSway(tip, "canopy");
        boughs.push({ a, tilt });
      }
    }
  });

  // A CLIMBER on some of them — a vine winding up the bole with broad leaves
  // pressed flat to the bark, the aroid every rainforest trunk carries. It is
  // the one leaf under the canopy, and it may be because it is ON the trunk:
  // flat on a face and never more than a hand's breadth off the bark, so it
  // changes nothing a round or a body meets. It is also the only detail on
  // this tree at the height a player actually looks, which is what it is for.
  // Not every tree, for the veil's reason — a climber on every trunk is a
  // plantation's stakes.
  if (own() < 0.3) {
    const from = 0.25;
    const to = 5.5 + own() * 2.5;
    const turns = (1.1 + own() * 0.8) * (own() < 0.5 ? 1 : -1);
    const phase = own() * Math.PI * 2;
    // Round the bole a clear hand off the widest flute, at `t` of the way up.
    const wind = (t: number, off: number): Ring & { th: number } => {
      const b = bole(from + (to - from) * t);
      const th = phase + turns * Math.PI * 2 * t;
      const r = b.r * 1.05 + off;
      return { x: b.x + Math.sin(th) * r, y: b.y, z: b.z + Math.cos(th) * r, r: 0, th };
    };
    const steps = 10;
    const stem = loft(
      "jungle-climber",
      Array.from({ length: steps }, (_, i) => ({
        ...wind(i / (steps - 1), 0.04),
        r: 0.045 - (0.02 * i) / (steps - 1),
      })),
      4,
      scene,
    );
    stem.parent = trunk;
    stem.material = vine;
    // The leaves are the canopy's green but NOT its material, and the
    // difference is a draw call a block. The crown's leaf is translucent and
    // marked to sway; this is neither — a leaf flat on bark has no sky behind
    // it to glow against, and it may not drift off the trunk it grips — and a
    // translucent mesh that disagrees with its fellows about the sway mark is
    // a merge group of its own in every block with a climber in it. Plain
    // matte, it goes into the block's palette with the bark (see
    // `mergeByMaterial`) and costs nothing but its vertices.
    const blade0 = mats.get(LEAF);
    const count = 5 + Math.floor(own() * 4);
    for (let k = 0; k < count; k++) {
      const at = wind((k + 0.5 + (own() - 0.5) * 0.6) / count, 0.035);
      // A broad blade hanging from its stalk, a hand's length and pointed —
      // the aroid's, not the creeper's fingernail: this one is read at the
      // ten metres a stand is crossed at, not at a wall's arm's length.
      const s = 0.8 + own() * 0.4;
      const blade = prism(
        "jungle-climber-leaf",
        [
          [0, 0],
          [0.11 * s, -0.09 * s],
          [0, -0.34 * s],
          [-0.11 * s, -0.09 * s],
        ],
        0.03,
        scene,
      );
      blade.parent = trunk;
      blade.position.set(at.x, at.y, at.z);
      // Face out from the bole (the blade's own +Z), turned in the bark's
      // plane, and its tip lifted off the bark a little.
      blade.rotation.y = at.th;
      blade.rotation.z = (own() - 0.5) * 1.2;
      blade.rotation.x = -(0.2 + own() * 0.3);
      blade.material = k % 3 === 0 ? vine : blade0;
    }
  }

  // The mid-story. Not every tree: a belt where every trunk wore the same
  // curtain would read as a manufactured screen, and the gaps are what let the
  // layer scatter through the stand rather than ring each trunk in it.
  //
  // **The share is stated per TREE and tuned against the STAND**, which is why
  // it fell from 0.45 to 0.16 when Greyfen's forest thickened. The veil was
  // added to fill eight metres of empty air between a fern and the lowest
  // frond, and at a trunk every ten metres it took nearly half of them to do
  // it. At a trunk every four that air is full of trunks, and the same share
  // would hang three times the curtain in the same volume — a screen, which is
  // the thing this fraction exists to avoid. Sixteen per cent of the denser
  // valley is about a hundred and sixty veils, which is what the sparse one
  // had: the layer keeps its absolute weight while the forest around it
  // triples. It is also the most expensive thing this builder can draw (a veil
  // is about as many triangles as the tree it hangs on), so the number is
  // worth getting right twice over.
  if (sub() < 0.16) {
    // The collar hangs at 4.05 above the trunk's own centre — 9.65 m up a
    // scale-1 tree, which is just under the lower plate tier (4.07 to 4.63 in
    // the same frame), so it emerges from the foliage rather than floating
    // under it. Every hang below is stated relative to that line.
    const hangs: LianaHang[] = [];
    // One on the bole, so the collar is visibly holding something. Everything
    // else is out under a blade.
    hangs.push({ a: sub() * Math.PI * 2, r: 0.55, y: 0.02 });
    // The rest, each under a blade of the lowest ring, taken in turn from a
    // random start so no two trees drape the same way. `r` is where along the
    // blade the vine took hold and `y` follows the blade's own droop down to
    // it, which is what puts the strand's top under leaf instead of beside it.
    const first = Math.floor(sub() * boughs.length);
    for (let i = 0; i < 4; i++) {
      const b = boughs[(first + i) % boughs.length];
      // Out under the blade, and BOUNDED there rather than run to its tip:
      // the ring's blades are 3.4 m now, and a hang taken from the drooping
      // far end starts lower, which comes straight off the clearance
      // `buildLianaVeil` derives its hem against. 3.1 m keeps the worst case
      // at the 2.85 m it was measured at before the blades grew.
      const r = 1.5 + sub() * 1.6;
      hangs.push({
        a: b.a + (sub() - 0.5) * 0.3,
        r,
        // 4.15 is the ring's height on the trunk, 2.2 is where along it the
        // blade's own centre sits, and 0.07 is half a blade's thickness; the
        // sine is how far the blade has drooped by `r`.
        y: 4.15 - Math.sin(b.tilt) * (r - 2.2) - 0.07 - 4.05,
      });
    }
    const veil = buildLianaVeil(scene, mats, sub, hangs);
    veil.parent = trunk;
    veil.position.y = 4.05;
  }
  return trunk;
}

/**
 * Liana veil: a curtain of vines hung from a canopy tree's own crown, leafed
 * along its length and ragged along its hem.
 *
 * **This exists to fill a band, and the band is the argument for it.** A fern
 * tops out at 1.2 m and a canopy tree's lowest frond hangs at 9, so a jungle
 * belt is a floor, eight metres of clear air, and a ceiling. That gap is what
 * makes a stand of trunks read as columns in a park rather than as jungle: the
 * eye gets no layer between its feet and the roof, so there is nothing for
 * distance to stack. Every other fix for it fights the belt's own promise —
 * more trunks is a thicker plantation, and foliage brought DOWN to chest height
 * is the thing `buildFernClump` explains at length must never exist. Hanging
 * the layer from ABOVE is the one direction that is free.
 *
 * **It is part of the TREE and not a prop of its own, and that is the whole of
 * why it hangs off anything.** It shipped as a `lianaVeil` scatter region
 * mirroring each tree region's footprint, on the reasoning that a region over a
 * belt puts a veil under a canopy. It does not, and the mechanism is the
 * opposite of incidental: `findSpot` rejects a spot buried in an existing
 * collider, a jungle tree is `blocking` with an 11.2 m box, and every tree
 * region builds before the veils — so the burial test pushed the mid-story into
 * the GAPS between the trunks by construction. Measured over the shipped
 * Greyfen: 179 veils, nearest trunk a median 4.62 m away against a canopy that
 * reaches 4.4 m, a hundred of them outside any canopy at all and thirty-nine
 * past six metres, hanging in open sky. No number could have fixed it, because
 * the anchor's height and the tree's scale were drawn independently and neither
 * knew the other. Hung from the crown there is nothing to keep in step: the
 * veil is a child of the trunk, rides its scale, and cannot be anywhere a tree
 * is not. See `buildJungleTree`, which is the only caller.
 *
 * **Nothing it draws is below 2.4 m, and that number is the whole safety
 * argument.** It clears the 1.7 m hit sphere by 0.7 m, so at any range worth
 * shooting across, a level sightline from a 1.55 m eye passes UNDER the hem —
 * the veil frames the shot instead of standing in it. That is what lets this be
 * non-blocking without repeating the fern's mistake: the fern rule is that
 * anything soft AT CHEST HEIGHT must be genuinely solid or genuinely absent,
 * and the way to obey it is to not be at chest height. So this carries no
 * collider, no `WorldBox` and nothing any ray in the game can find, which is
 * also why it can be hung at a density cover never could.
 *
 * The hem is DERIVED from that floor and the derivation now runs through the
 * TREE's scale rather than a scatter region's — see `drop` below. The tree is
 * the looser of the two (0.85 against the veil region's old 0.9) and the anchor
 * is a metre higher, which nets out as more rope: 6.4 m of fall against 5.6,
 * over a band that starts higher.
 *
 * **Where each strand starts is the CALLER's to say, and that is what makes the
 * layer worth having.** The obvious anchor is the bole, so anything within a
 * metre or so of the axis is under leaf from every angle. Built that way it is
 * genuinely attached and nearly useless: five strands inside a 2 m circle sit
 * within the trunk's own silhouette, so at the twenty metres a belt is read
 * across they thicken the column instead of filling the gap between columns,
 * and the eight metres of clear air the veil exists to close is still clear.
 * The blades of the lowest frond ring reach 3.9 m and the ring is already
 * built, so `buildJungleTree` hands over the blades it actually made and a
 * strand hangs UNDER one — out where the curtain is between the trunks rather
 * than on them, and under leaf rather than beside it. That is the whole reason
 * this takes `hangs` instead of picking a radius.
 *
 * The collar is the one part meant to be seen at the top — the woody mass a
 * liana gathers where it meets the bole, sitting half inside the crown so it
 * emerges from the foliage, with one strand of its own so it is visibly
 * holding something.
 *
 * The hem is deliberately uneven. Strands cut to one length read as a curtain
 * rail; the whole silhouette is in the raggedness, which is the same lesson
 * `buildJungleTree` states about its fronds needing two segments.
 */
export function buildLianaVeil(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number,
  hangs: readonly LianaHang[],
): Mesh {
  const bark = mats.get(JUNGLE_BARK);
  const vineMat = mats.get(VINE);
  // What hangs in the canopy's own light gets the canopy's own translucency, so
  // a veil between you and the sky glows the way the fronds above it do.
  const leafMat = mats.getTranslucent(
    LEAF,
    CONFIG.graphics.translucency.canopy,
  );
  const leafLitMat = mats.getTranslucent(
    LEAF_LIT,
    CONFIG.graphics.translucency.canopy,
  );

  // The collar, and the root of the hierarchy. Assembled at the ORIGIN like
  // every builder in this file, so its centre is the hang line and every Y
  // below is relative to that; `buildJungleTree` is what lifts it to the
  // crown, and it writes this mesh's own `position`.
  //
  // Proud of the bole by ~8 cm at the height it is hung (the trunk tapers to
  // 0.52 there), which is what makes it a thickening on the trunk rather than
  // a band painted round it. Half of it is inside the crown and half below,
  // so it emerges from the foliage instead of sitting under it.
  const collar = MeshBuilder.CreateCylinder(
    "liana-collar",
    { height: 0.55, diameterTop: 0.58, diameterBottom: 0.7, tessellation: 6 },
    scene,
  );
  // **Deliberately unrotated.** A hexagon's facet alignment is invisible at
  // this size, and turning the root would turn every strand with it — off the
  // blade whose azimuth the caller computed it against, which is the one thing
  // this whole arrangement exists to get right. The tree carries a yaw of its
  // own from `scatterRegion`, and the collar rides that.
  collar.material = bark;

  for (const hang of hangs) {
    // Where the strand takes hold: `a` around the trunk, `r0` out from it, and
    // `top` up or down from the collar — the underside of the blade the caller
    // picked, in the collar's own frame.
    const { a, r: r0, y: top } = hang;
    // The hem, and the one number in here that is DERIVED rather than picked.
    // The floor is 2.4 m and the collar stands 9.65 m up the trunk, so a hang
    // is at `9.65 + top` — and the lowest a drooping blade offers is 9.25. The
    // veil rides the TREE's scale, so the hem lands at
    // `(9.65 + top - drop) * scale` and `jungleTree`'s minimum of 0.85 caps
    // the drop at 6.40. Anything here over that, or a `jungleTree` region
    // scattered below 0.85, and the veil's whole safety argument is gone with
    // no error to say so. Measured over 400 seeds at that worst case the
    // lowest thing any veil draws sits at 2.90 m.
    const drop = 3.6 + rng() * 2.3;
    const hem = top - drop;
    // How far the curtain swings out as it falls. A vine hangs plumb only if
    // nothing grew it outward, and a plumb one reads as a wire dropped down
    // the trunk. Modest, because `r0` is already out under a blade — the width
    // here is the ring's, not the swing's.
    const flare = 0.1 + rng() * 0.45;
    const sway = (rng() - 0.5) * 0.5;

    // Two segments per strand, the lower one leaning harder — a rope hanging
    // under its own weight is never straight, and the break is where a vine
    // stops reading as a wire. Each is positioned and turned so the pair
    // tracks the same outward line, which is what `radial` is for.
    const radial = (t: number, out: number) => ({
      x: Math.sin(a) * (r0 + flare * out) + Math.cos(a) * sway * t,
      z: Math.cos(a) * (r0 + flare * out) - Math.sin(a) * sway * t,
    });

    const upperLen = drop * 0.55;
    const upperAt = radial(0.28, 0.22);
    const upper = MeshBuilder.CreateBox(
      "liana-strand",
      { width: 0.13, height: upperLen, depth: 0.13 },
      scene,
    );
    upper.parent = collar;
    upper.position.set(upperAt.x, top - upperLen / 2, upperAt.z);
    upper.rotation.y = a;
    upper.rotation.x = -flare * 0.22;
    upper.material = vineMat;
    // The whole strand leans, and the CANOPY layer is right for it rather than
    // an understory one: a veil hangs from a blade nine and a half metres up,
    // so the ramp gives its top almost exactly what it gives the frond it hangs
    // from and the two travel together. What the ramp does further down is the
    // thing a hand-authored version would have had to fake — the hem is
    // entitled to less than the hang, so the curtain trails the branch instead
    // of swinging rigidly with it. The COLLAR is deliberately left out: it is a
    // thickening on the bole, and the bole does not move.
    marksSway(upper, "canopy");

    const lowerLen = drop * 0.45;
    const lowerAt = radial(0.78, 0.78);
    const lower = MeshBuilder.CreateBox(
      "liana-strand-low",
      { width: 0.11, height: lowerLen, depth: 0.11 },
      scene,
    );
    lower.parent = collar;
    lower.position.set(lowerAt.x, top - upperLen - lowerLen / 2, lowerAt.z);
    lower.rotation.y = a;
    lower.rotation.x = -flare * 0.1;
    lower.material = vineMat;
    marksSway(lower, "canopy");

    // Leaves down the strand, and they are what the layer is actually SEEN by:
    // a 13 cm vine is under a pixel at the range a belt is read across, so the
    // foliage on it is the mid-story as far as the eye is concerned. Narrower
    // and longer than they were hung off a bough — a wide flat blade at this
    // size reads as a plank nailed to the trunk rather than as leaf.
    //
    // The lowest sits a clear margin above the hem so the bottom of the veil is
    // vine rather than foliage: a leaf is the widest thing here and the hem is
    // the one edge that must not creep downward.
    const leaves = 4;
    for (let j = 0; j < leaves; j++) {
      const t = 0.22 + (j / leaves) * 0.62;
      const at = radial(t, t);
      const blade = MeshBuilder.CreateBox(
        "liana-leaf",
        { width: 0.5 + rng() * 0.28, height: 0.09, depth: 0.4 },
        scene,
      );
      blade.parent = collar;
      blade.position.set(at.x, top - drop * t, at.z);
      blade.rotation.y = rng() * Math.PI;
      // Drooping, never level: a horizontal blade at this size reads as a shelf.
      blade.rotation.z = 0.5 + rng() * 0.5;
      blade.material = j === 0 ? leafLitMat : leafMat;
      marksSway(blade, "canopy");
    }

    // A tangle at the hem on some strands — the knot of old growth a liana
    // gathers where it has been hanging longest.
    if (rng() < 0.55) {
      const at = radial(1, 1);
      const knot = MeshBuilder.CreateCylinder(
        "liana-knot",
        { height: 0.4, diameterTop: 0.3, diameterBottom: 0.22, tessellation: 5 },
        scene,
      );
      knot.parent = collar;
      knot.position.set(at.x, hem + 0.2, at.z);
      knot.rotation.y = rng() * Math.PI;
      knot.material = vineMat;
      marksSway(knot, "canopy");
    }
  }
  return collar;
}

/**
 * Fern clump: a SHUTTLECOCK fern — a crown of arching fronds out of one
 * rootstock, the youngest standing up in the middle and the oldest spread
 * round them to the ground, each frond a folded blade whose edge is cut into
 * pinnae, with a fiddlehead or two uncurling at the heart. The one fern serves
 * both of its maps: a male fern under a Harrowmead hedgerow and the understory
 * between Greyfen's buttresses are the same plant to anybody not carrying a
 * flora.
 *
 * **It was a starfish of green planks**: seven to ten boxes out of a green
 * stump, each bent once at the knee, so it read as boards laid in the dirt from
 * every side and a cog from above. What makes it a fern is three things, each
 * an edge the bands or the ink can find, never a texture:
 *
 * - **A frond is FOLDED along its midrib** — a shallow roof with the rachis as
 *   its ridge — so the bands put a lit half and a shade half on every frond and
 *   the ink draws the rib where the two meet.
 * - **Its edge is PINNAE**: the outline runs out to a forward-swept point and
 *   back in to a notch once per pinna pair, the two sides staggered, so the
 *   silhouette is a saw from every side. That is where the COUNT of edges a
 *   clump is read by comes from now; a blade's size no longer has to supply it.
 * - **The fronds are a SHUTTLECOCK, not a ring**: turned by the golden angle,
 *   and by AGE — a young frond leaves steep and arches over, an old one leaves
 *   low and runs out to lie on the ground — so the clump is a vase with a skirt
 *   rather than a star of identical blades.
 *
 * Every frond is a CLOSED lens — a flatter fold under the top one, meeting it
 * at the pinnae — because the world's shadow map records back faces and the
 * translucency term measures a crown's thickness off its front ones. The
 * halves are smooth along the frond and creased at the rib, so the arch bands
 * light-to-shade from the rise to the droop while the fold stays a hard edge.
 *
 * **Non-blocking, and that is the load-bearing decision here.** The canopy tree
 * keeps its foliage out of its collider because there is nothing to shoot nine
 * metres up; a fern sits at exactly the height of the hit sphere, so the same
 * reasoning inverts — anything soft at chest height must be either genuinely
 * solid or genuinely absent, never visible and shot straight through. And
 * solid is the wrong answer, because the one promise a jungle-tree belt makes
 * is that the canopy starts nine metres up and the sight lines under it stay
 * open. A bullet-stopping box in every gap between the trunks would contradict
 * that, punch nav holes through the understory and give bots one more thing to
 * wedge on. You walk through ferns. `bramble` makes the same call.
 *
 * **It takes exactly the draws from the shared stream the plank fern took** —
 * its blade count, then two plus four per blade — and spends none of them:
 * `rng` is the map's scatter stream, and every draw from it moves every prop
 * sown after this one. Its detail comes from `sub`, the per-prop stream
 * `MapBuilder` mints for exactly this.
 *
 * Budgeted as DRESSING: about 750 stand on Harrowmead and 370 on Greyfen, so a
 * vertex here is seven hundred in the scene. Two sheets (the lit colour and
 * the shade), the fiddleheads and the rootstock, in the three materials the
 * plank fern wore, so it costs no draw call the old one did not.
 */
export function buildFernClump(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
  sub: () => number = Math.random,
): Mesh {
  // The plank fern's draws, taken and not spent (see the header).
  const planks = 7 + Math.floor(rng() * 4);
  for (let i = 0; i < 1 + planks * 4; i++) rng();
  const own = sub;

  const frondShade = mats.getTranslucent(LEAF, CONFIG.graphics.translucency.canopy);
  const frondLit = mats.getTranslucent(LEAF_LIT, CONFIG.graphics.translucency.canopy);

  // The rootstock: a low green mound of old frond bases the fronds grow out
  // of. Sunk under the foot so a slope cannot lift it out, and NOT marked —
  // it is the one part of a fern that is genuinely planted.
  const stock = partCylinder(
    "fern-stock",
    { height: 0.22, diameterTop: 0.15, diameterBottom: 0.3, tessellation: 6 },
    scene,
  );
  stock.position.y = 0.03;
  stock.material = mats.get(LEAF);

  // One sheet per colour. Every frond half is its own run of vertices — the
  // rib is a crease, so the two halves cannot share one — smooth along its
  // length, with each triangle wound off its own vertex normal.
  type V3 = readonly [number, number, number];
  interface Sheet {
    positions: number[];
    normals: number[];
    uvs: number[];
    indices: number[];
  }
  const sheet = (): Sheet => ({ positions: [], normals: [], uvs: [], indices: [] });
  const lit = sheet();
  const shade = sheet();
  const vert = (s: Sheet, p: V3, n: V3): number => {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    s.positions.push(p[0], p[1], p[2]);
    s.normals.push(n[0] / l, n[1] / l, n[2] / l);
    s.uvs.push(p[0], p[1] + p[2]);
    return s.positions.length / 3 - 1;
  };
  const face = (s: Sheet, a: number, b: number, c: number): void =>
    tri(s.indices, s.positions, a, b, c, s.normals.slice(a * 3, a * 3 + 3));
  const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const cross = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const unit = (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const lerp = (p: V3, q: V3, u: number): V3 => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u];

  // Stations along a frond. Nine intervals is nine pinna pairs a side: a
  // real frond has twenty, and at the range a clump is read from nine
  // leaflets a side is already a frond where one was a plank.
  const S = 9;
  // Where the stipe ends and the blade begins, as a fraction of the frond.
  const STIPE = 0.14;
  // How far each half falls from the rib, per metre of its own width: the
  // fold that puts a lit half and a shade half on every frond.
  const FOLD = 0.36;
  // How much further a pinna's point droops below the fold.
  const DROOP = 0.24;
  // How far in toward the rib the cut between two pinnae runs, as a share of
  // the blade's half-width, and how far forward a pinna's point is swept, as a
  // share of one interval. Deep and nearly square to the rib is a LEAFLET; a
  // shallow cut swept well forward read as the teeth of a saw.
  const NOTCH = 0.26;
  const SWEEP = 0.22;

  const fronds = 7 + Math.floor(own() * 4);
  const turn = own() * Math.PI * 2;
  for (let k = 0; k < fronds; k++) {
    // 0 is the youngest, in the middle and upright; 1 the oldest, outermost
    // and lying on the ground.
    const age = k / (fronds - 1);
    const a = turn + k * 2.39996 + (own() - 0.5) * 0.3;
    const len = 0.78 + age * 0.22 + own() * 0.14;
    const e0 = 1.45 - age * 0.62 + (own() - 0.5) * 0.14;
    const e1 = e0 - 0.85 - age * 0.65 - own() * 0.18;
    const W = len * (0.17 + own() * 0.04);
    const roll = (own() - 0.5) * 0.5;
    const width = (t: number): number => {
      if (t <= STIPE) return 0.012;
      const u = (t - STIPE) / (1 - STIPE);
      return Math.max(0.012 * (1 - u), W * Math.sin(Math.PI * Math.pow(u, 0.75)));
    };

    // The rachis: out of the rootstock and arching over, its elevation
    // falling steadily along it, and held off the ground where an old frond
    // runs out onto it.
    const pts: V3[] = [[Math.sin(a) * 0.05, 0.1, Math.cos(a) * 0.05]];
    for (let i = 1; i <= S; i++) {
      const e = e0 + ((e1 - e0) * (i - 0.5)) / S;
      const d = len / S;
      const p = pts[i - 1];
      pts.push([
        p[0] + Math.sin(a) * Math.cos(e) * d,
        Math.max(0.03, p[1] + Math.sin(e) * d),
        p[2] + Math.cos(a) * Math.cos(e) * d,
      ]);
    }
    // Each station's frame: along the rachis, across the blade (rolled a
    // little, so one half of the frond faces up more than the other) and out
    // of its face.
    const flat: V3 = [Math.cos(a), 0, -Math.sin(a)];
    const frames = pts.map((_, i) => {
      const t = unit(add(pts[Math.min(S, i + 1)], pts[Math.max(0, i - 1)], -1));
      const side = unit(add(add([0, 0, 0], flat, Math.cos(roll)), cross(t, flat), Math.sin(roll)));
      return { t, side, up: unit(cross(t, side)) };
    });
    // A point `f` of the way along the frond, and its frame.
    const along = (f: number) => {
      const x = Math.min(S - 1e-6, f * S);
      const i = Math.floor(x);
      const u = x - i;
      const A = frames[i];
      const B = frames[i + 1];
      return {
        p: lerp(pts[i], pts[i + 1], u),
        t: unit(lerp(A.t, B.t, u)),
        side: unit(lerp(A.side, B.side, u)),
        up: unit(lerp(A.up, B.up, u)),
      };
    };
    // Young fronds are the fresh green, old ones the dark.
    const top = own() < 0.9 - age * 0.6 ? lit : shade;
    const step = len / S;

    for (const s of [-1, 1]) {
      // The top half and the underside, which meet at the notches and the
      // points; the underside's rib is the frond's thickness under the top's.
      for (const under of [false, true]) {
        const into = under ? shade : top;
        const normal = (side: V3, up: V3, fall: number): V3 =>
          under ? add(add([0, 0, 0], up, -1), side, -s * FOLD * 0.6) : add(up, side, s * fall);
        const ribs: number[] = [];
        const notches: number[] = [];
        for (let i = 0; i <= S; i++) {
          const { side, up } = frames[i];
          const w = width(i / S) * NOTCH;
          const thick = 0.02 * (1 - 0.6 * (i / S));
          const n = normal(side, up, FOLD);
          ribs.push(vert(into, under ? add(pts[i], up, -thick) : pts[i], n));
          notches.push(vert(into, add(add(pts[i], side, s * w), up, -FOLD * w), n));
        }
        for (let i = 0; i < S; i++) {
          // Staggered: the two sides' pinnae alternate along the rib.
          const f = (i + 0.5 + s * 0.14) / S;
          const { p, t, side, up } = along(f);
          const w = width(f);
          const point = vert(
            into,
            add(add(add(p, side, s * w), up, -(FOLD + DROOP) * w), t, step * SWEEP),
            normal(side, up, FOLD + DROOP),
          );
          face(into, ribs[i], notches[i], point);
          face(into, ribs[i], point, ribs[i + 1]);
          face(into, ribs[i + 1], point, notches[i + 1]);
        }
      }
    }
  }

  const surface = (name: string, s: Sheet, material: typeof frondLit): void => {
    if (!s.indices.length) return;
    const data = new VertexData();
    data.positions = s.positions;
    data.normals = s.normals;
    data.uvs = s.uvs;
    data.indices = s.indices;
    const mesh = partSurface(name, data, scene);
    mesh.parent = stock;
    mesh.position.y = -stock.position.y;
    mesh.material = material;
    // The understory layer, which is the one the player walks THROUGH. A
    // frond leaves the rootstock at 0.1 m, where the ramp has given it a few
    // millimetres, inside a stock 0.15 m across, so the join is buried.
    marksSway(mesh, "understory");
  };
  surface("fern-fronds-lit", lit, frondLit);
  surface("fern-fronds", shade, frondShade);

  // Fiddleheads: a young frond not yet unrolled, a stalk out of the heart of
  // the crown curling over outward into a coil. Fat in the coil, where the
  // pinnae are still packed, and in the fresh green.
  const heads = 1 + Math.floor(own() * 3);
  for (let h = 0; h < heads; h++) {
    const b = turn + h * 2.1 + own() * 0.8;
    const tall = 0.2 + own() * 0.12;
    const rc = 0.035 + own() * 0.012;
    const at = (u: number, v: number, r: number): Ring => ({ x: Math.sin(b) * u, y: v, z: Math.cos(b) * u, r });
    const rings: Ring[] = [at(0.01, 0.06, 0.011), at(0.02, tall * 0.5, 0.011), at(0.03, tall - 0.01, 0.012)];
    // A spiral about a centre just outward of the stalk's head: up and over,
    // down the far side and back in under itself, tightening as it goes.
    for (let j = 1; j <= 8; j++) {
      const f = j / 8;
      const th = Math.PI - f * Math.PI * 2.4;
      const r = rc * (1 - 0.62 * f);
      rings.push(at(0.03 + rc + Math.cos(th) * r, tall + Math.sin(th) * r, 0.016 - 0.008 * f));
    }
    const head = loft(`fern-head${h}`, rings, 4, scene);
    head.parent = stock;
    head.position.y = -stock.position.y;
    head.material = frondLit;
    marksSway(head, "understory");
  }
  return stock;
}

/**
 * A fallen jungle hardwood: a rolled trunk lying along its own local X, with
 * two buttress fins still standing off it and the torn root plate at one end.
 *
 * The buttresses are what make this a jungle log rather than the temperate one
 * — the same fins `buildJungleTree` stands its trunks on, seen from the side.
 *
 * Its collider (`PROP_BODIES`) is the TRUNK only. The fins reach 1.4 m and the
 * root plate 1.9, but both are thin plates, and a box that held them would stop
 * rounds through a metre of visible daylight along the whole prop — the canopy
 * tree's rule, applied in the same direction rather than inverted. At the trunk
 * height alone it also bakes as low cover rather than as a wall, which is what
 * a log should be.
 */
export function buildButtressLog(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const bark = mats.get(JUNGLE_BARK);
  const trunk = MeshBuilder.CreateCylinder(
    "buttresslog-trunk",
    { height: 5.2, diameterTop: 0.72, diameterBottom: 0.95, tessellation: 7 },
    scene,
  );
  trunk.position.y = 0.48;
  trunk.rotation.z = Math.PI / 2;
  // Rolled about its own axis, so no two logs show the same facet uppermost.
  trunk.rotation.x = (rng() - 0.5) * 0.3;
  trunk.material = bark;

  // Buttress fins, still standing off the butt end. Parented to the trunk, so
  // they ride its roll — a fin that ignored it would float.
  for (let i = 0; i < 2; i++) {
    const fin = MeshBuilder.CreateBox(
      `buttresslog-fin${i}`,
      { width: 0.16, height: 1.5, depth: 1.1 },
      scene,
    );
    fin.parent = trunk;
    fin.position.set(0, -2.0, (i === 0 ? 1 : -1) * 0.42);
    fin.rotation.x = (i === 0 ? 1 : -1) * 0.22;
    fin.material = bark;
  }

  // The torn root plate: a disc on edge, closing the butt.
  const plate = MeshBuilder.CreateCylinder(
    "buttresslog-plate",
    { height: 0.28, diameterTop: 1.7, diameterBottom: 1.9, tessellation: 7 },
    scene,
  );
  plate.parent = trunk;
  plate.position.y = -2.7;
  plate.material = mats.get(DEAD_BARK);

  // Moss along the upper flank — a log on a wet floor is the first thing the
  // forest takes.
  for (let i = 0; i < 3; i++) {
    const moss = MeshBuilder.CreateBox(
      `buttresslog-moss${i}`,
      { width: 0.5, height: 0.1, depth: 0.62 },
      scene,
    );
    moss.parent = trunk;
    moss.position.set(0.44, -1.4 + i * 1.5, 0);
    moss.rotation.z = 0.3;
    moss.material = mats.get(VINE);
  }
  return trunk;
}

/**
 * A carved stele: a leaning slab of worked stone with relief bands and a
 * chamfered cap, half-swallowed at the foot.
 *
 * The temple's outriders — the thing that says a stepped platform in a jungle
 * was a place rather than a hill. It is the only one of the three understory
 * props that clears the 1.7 m hit sphere, so it is the only one `CoverMap`
 * bakes as genuine hard cover.
 *
 * Its collider is wide and thin and oriented with the prop, which is the
 * gravestone's lesson: squared off to its own width it would block five times
 * its thickness. The stone leans a few degrees while the box does not, so the
 * top corner stands a little outside it — the same approximation the gravestone
 * already makes at a much steeper angle.
 */
export function buildCarvedStele(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const stone = mats.get(STONE);
  const slab = MeshBuilder.CreateBox(
    "stele-slab",
    { width: 0.95, height: 2.3, depth: 0.42 },
    scene,
  );
  slab.position.y = 1.15;
  // Shallower than the gravestone's: nobody has been keeping this one upright,
  // but a temple mason set it deeper than a village sexton did.
  slab.rotation.x = (rng() - 0.5) * 0.18;
  slab.rotation.z = (rng() - 0.5) * 0.24;
  slab.material = stone;

  const cap = MeshBuilder.CreateCylinder(
    "stele-cap",
    { height: 0.2, diameter: 0.98, tessellation: 6 },
    scene,
  );
  cap.parent = slab;
  cap.rotation.x = Math.PI / 2;
  cap.position.y = 1.2;
  cap.material = stone;

  // Relief bands across the face — the carving, at the only fidelity a cel
  // shader's flat bands can carry at this distance.
  for (let i = 0; i < 3; i++) {
    const band = MeshBuilder.CreateBox(
      `stele-band${i}`,
      { width: 0.78, height: 0.14, depth: 0.06 },
      scene,
    );
    band.parent = slab;
    band.position.set(0, 0.55 - i * 0.55, 0.24);
    band.material = mats.get(DARK_STONE);
  }

  const plinth = MeshBuilder.CreateBox(
    "stele-plinth",
    { width: 1.3, height: 0.3, depth: 0.7 },
    scene,
  );
  plinth.parent = slab;
  plinth.position.y = -1.1;
  plinth.material = mats.get(DARK_STONE);

  // Creeper up one face.
  const vine = MeshBuilder.CreateBox(
    "stele-vine",
    { width: 0.16, height: 1.6, depth: 0.08 },
    scene,
  );
  vine.parent = slab;
  vine.position.set(-0.3, -0.15, -0.25);
  vine.material = mats.get(VINE);
  return slab;
}

/** Leaning headstone with a cracked-off corner. */
export function buildGravestone(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const stone = mats.get(STONE);
  const slab = MeshBuilder.CreateBox(
    "grave-slab",
    { width: 1.0, height: 1.5, depth: 0.24 },
    scene,
  );
  slab.position.y = 0.75;
  slab.rotation.x = (rng() - 0.5) * 0.22;
  slab.rotation.z = (rng() - 0.5) * 0.3;
  slab.material = stone;

  const cap = MeshBuilder.CreateCylinder(
    "grave-cap",
    { height: 0.22, diameter: 1.0, tessellation: 7 },
    scene,
  );
  cap.parent = slab;
  cap.rotation.x = Math.PI / 2;
  cap.position.y = 0.72;
  cap.material = stone;

  const plinth = MeshBuilder.CreateBox(
    "grave-plinth",
    { width: 1.3, height: 0.28, depth: 0.5 },
    scene,
  );
  plinth.parent = slab;
  plinth.position.y = -0.72;
  plinth.material = mats.get("#5f6461");
  return slab;
}

/** Iron lamp post — the warm anchor in an otherwise blue-black village. */
export function buildLantern(scene: Scene, mats: CelMaterialFactory): Mesh {
  const iron = mats.get(IRON);
  const post = MeshBuilder.CreateCylinder(
    "lantern-post",
    { height: 3.6, diameterTop: 0.14, diameterBottom: 0.24, tessellation: 6 },
    scene,
  );
  post.position.y = 1.8;
  post.material = iron;

  const arm = MeshBuilder.CreateBox(
    "lantern-arm",
    { width: 0.9, height: 0.1, depth: 0.1 },
    scene,
  );
  arm.parent = post;
  arm.position.set(0.35, 1.75, 0);
  arm.material = iron;

  const cage = MeshBuilder.CreateCylinder(
    "lantern-cage",
    { height: 0.62, diameterTop: 0.42, diameterBottom: 0.3, tessellation: 6 },
    scene,
  );
  cage.parent = post;
  cage.position.set(0.75, 1.42, 0);
  cage.material = iron;

  const flame = MeshBuilder.CreateSphere(
    "lantern-flame",
    { diameter: 0.3, segments: 6 },
    scene,
  );
  flame.parent = cage;
  flame.material = mats.getEmissive("#ffbe63");
  flame.metadata = { noInk: true };

  const cap = MeshBuilder.CreateCylinder(
    "lantern-cap",
    { height: 0.18, diameterTop: 0.1, diameterBottom: 0.5, tessellation: 6 },
    scene,
  );
  cap.parent = cage;
  cap.position.y = 0.38;
  cap.material = iron;
  return post;
}

/** Cluster of luminous corpse-fungus — small, cold, and everywhere. */
export function buildFungus(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const stem = mats.get("#6a6f63");
  const glow = mats.getEmissive("#6effc0");
  const base = MeshBuilder.CreateCylinder(
    "fungus-base",
    { height: 0.5, diameterTop: 0.12, diameterBottom: 0.2, tessellation: 5 },
    scene,
  );
  base.position.y = 0.25;
  base.material = stem;

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng();
    const r = 0.25 + rng() * 0.35;
    const h = 0.3 + rng() * 0.4;
    const stalk = MeshBuilder.CreateCylinder(
      `fungus-stalk${i}`,
      { height: h, diameterTop: 0.07, diameterBottom: 0.1, tessellation: 5 },
      scene,
    );
    stalk.parent = base;
    stalk.position.set(Math.cos(a) * r, h / 2 - 0.2, Math.sin(a) * r);
    stalk.material = stem;

    const cap = MeshBuilder.CreateSphere(
      `fungus-cap${i}`,
      { diameter: 0.26 + rng() * 0.12, segments: 5 },
      scene,
    );
    cap.parent = stalk;
    cap.position.y = h / 2;
    cap.scaling.y = 0.55;
    cap.material = glow;
    cap.metadata = { noInk: true };
  }
  return base;
}

/** Fallen, half-rotted log. */
export function buildLog(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const log = MeshBuilder.CreateCylinder(
    "log",
    { height: 3.0, diameterTop: 0.55, diameterBottom: 0.7, tessellation: 6 },
    scene,
  );
  log.rotation.z = Math.PI / 2;
  log.rotation.x = (rng() - 0.5) * 0.4;
  log.position.y = 0.36;
  log.material = mats.get(DEAD_BARK);

  const stub = MeshBuilder.CreateCylinder(
    "log-stub",
    { height: 0.9, diameterTop: 0.12, diameterBottom: 0.22, tessellation: 5 },
    scene,
  );
  stub.parent = log;
  stub.position.set(0, 0.6, 0.3);
  stub.rotation.x = 0.6;
  stub.material = mats.get(BARK);
  return log;
}

/** Burning oil drum — the villagers' braziers, still lit. */
export function buildFireDrum(scene: Scene, mats: CelMaterialFactory): Mesh {
  const drum = MeshBuilder.CreateCylinder(
    "drum",
    { height: 1.2, diameter: 0.95, tessellation: 8 },
    scene,
  );
  drum.position.y = 0.6;
  drum.material = mats.get(RUST);

  const rim = MeshBuilder.CreateTorus(
    "drum-rim",
    { diameter: 1.0, thickness: 0.1, tessellation: 10 },
    scene,
  );
  rim.parent = drum;
  rim.position.y = 0.55;
  rim.material = mats.get(DARK_METAL);

  // The bed of coals the fire stands in, laid ON the drum's closed top inside
  // the rim: what you see when you look down into it, and the root the tongues
  // rise out of.
  const coals = MeshBuilder.CreateCylinder(
    "drum-coals",
    { height: 0.03, diameter: 0.84, tessellation: 8 },
    scene,
  );
  coals.parent = drum;
  coals.position.y = 0.61;
  coals.material = mats.getEmissive("#8f2610");
  coals.metadata = { noInk: true, noShadowCaster: true };

  // The fire itself — animated, so it is never a shadow caster (`flame.ts`).
  const fire = new Mesh("drum-fire", scene);
  flameData({ radius: 0.36, height: 0.95 }).applyToMesh(fire);
  fire.parent = drum;
  fire.position.y = 0.55;
  fire.material = mats.getFlame();
  fire.metadata = { noInk: true, noShadowCaster: true };
  return drum;
}

/** Glacial boulder — hard cover in the fields and the woods. */
export function buildBoulder(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const rock = MeshBuilder.CreatePolyhedron(
    "boulder",
    { type: 1, size: 0.8 },
    scene,
  );
  rock.position.y = 0.6;
  rock.scaling.set(1.3 + rng() * 0.4, 0.85 + rng() * 0.3, 1.2);
  rock.rotation.set(rng() * 0.4, rng() * Math.PI, 0.12);
  rock.material = mats.get("#565d59");

  // A shoulder stone, so the silhouette isn't a single tidy lump.
  const chip = MeshBuilder.CreatePolyhedron(
    "boulder-chip",
    { type: 0, size: 0.42 },
    scene,
  );
  chip.parent = rock;
  chip.position.set(0.7, -0.35, 0.4);
  chip.rotation.set(rng(), rng(), rng());
  chip.material = mats.get("#474e4a");
  return rock;
}

/**
 * Dead bramble thicket. Non-blocking on purpose: it is visual undergrowth that
 * fills bare ground without adding another thing for a bot to get wedged in.
 */
export function buildBramble(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const wood = mats.get(DEAD_BARK);
  const base = MeshBuilder.CreateCylinder(
    "bramble",
    { height: 0.4, diameterTop: 0.5, diameterBottom: 0.7, tessellation: 5 },
    scene,
  );
  base.position.y = 0.2;
  base.material = wood;

  const canes = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < canes; i++) {
    const a = (i / canes) * Math.PI * 2 + rng() * 0.5;
    const h = 0.8 + rng() * 0.9;
    const cane = MeshBuilder.CreateCylinder(
      `cane${i}`,
      { height: h, diameterTop: 0.03, diameterBottom: 0.09, tessellation: 4 },
      scene,
    );
    cane.parent = base;
    cane.position.set(Math.cos(a) * 0.22, h / 2, Math.sin(a) * 0.22);
    cane.rotation.z = -Math.cos(a) * (0.5 + rng() * 0.6);
    cane.rotation.x = Math.sin(a) * (0.5 + rng() * 0.6);
    cane.material = wood;
  }
  return base;
}

/** Abandoned barrel — small hard cover, and the village's loose change. */
export function buildBarrel(scene: Scene, mats: CelMaterialFactory): Mesh {
  const barrel = MeshBuilder.CreateCylinder(
    "barrel",
    { height: 1.2, diameterTop: 0.8, diameterBottom: 0.9, tessellation: 8 },
    scene,
  );
  barrel.position.y = 0.6;
  barrel.material = mats.get("#4a4034");

  for (const y of [-0.32, 0.3]) {
    const hoop = MeshBuilder.CreateCylinder(
      `hoop${y}`,
      { height: 0.1, diameter: 0.96, tessellation: 8 },
      scene,
    );
    hoop.parent = barrel;
    hoop.position.y = y;
    hoop.material = mats.get(DARK_METAL);
  }

  const lid = MeshBuilder.CreateCylinder(
    "barrel-lid",
    { height: 0.08, diameter: 0.72, tessellation: 8 },
    scene,
  );
  lid.parent = barrel;
  lid.position.y = 0.62;
  lid.material = mats.get(BARK);
  return barrel;
}

/** Collapsed masonry with rebar poking out — waist-high cover. */
export function buildRubble(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const heap = MeshBuilder.CreateBox(
    "rubble",
    { width: 1.9, height: 0.6, depth: 1.6 },
    scene,
  );
  heap.position.y = 0.3;
  heap.rotation.y = rng() * Math.PI;
  heap.material = mats.get(CONCRETE);

  for (let i = 0; i < 3; i++) {
    const chunk = MeshBuilder.CreateBox(
      `chunk${i}`,
      { width: 0.7, height: 0.5, depth: 0.6 },
      scene,
    );
    chunk.parent = heap;
    chunk.position.set(
      (rng() - 0.5) * 1.2,
      0.4,
      (rng() - 0.5) * 1.0,
    );
    chunk.rotation.set(rng(), rng(), rng());
    chunk.material = mats.get("#565a62");
  }

  const rebar = MeshBuilder.CreateCylinder(
    "rebar",
    { height: 1.7, diameterTop: 0.05, diameterBottom: 0.07, tessellation: 4 },
    scene,
  );
  rebar.parent = heap;
  rebar.position.set(0.5, 0.8, -0.3);
  rebar.rotation.z = 0.7;
  rebar.material = mats.get("#6b5c4a");
  return heap;
}

// --- the city's own dressing ------------------------------------------------
// Everything below is Coldharbour's, and the palette is deliberately restated
// here rather than imported from `kit/city.ts` — Props.ts owns its own colours
// and takes nothing from the structure kit, which is what keeps a prop
// placeable without a builder (see this file's header).
const SKIP_PAINT = "#7a5230";
const BIN_BODY = "#39413a";
const BIN_LID = "#2b322c";
const PALLET_WOOD = "#8a7048";
const CONE_ORANGE = "#e4571f";
const CONE_BAND = "#e8e4dc";
const SCRAP_PAPER = "#b9b3a4";
const SCRAP_CARD = "#8a7355";

/**
 * A refuse skip: an open steel box with a flared rim and two lift lugs.
 *
 * **The best of the urban props, because it is honest as a box.** Most of this
 * file's shapes are approximations a collider has to be forgiven for — a tree
 * is a trunk with a crown the box does not hold, a boulder is a stretched
 * polyhedron. A skip genuinely IS a rectangular prism, so its `PROP_BODIES`
 * entry is the shape rather than a compromise with it, and every round that
 * looks like it should hit one does.
 *
 * At 1.25 m it sits under `CoverMap`'s 1.7 m hard-cover line, so it bakes as
 * LOW cover — which is what a skip is: something you crouch behind, not
 * something you stand behind. The flare is drawn above the body and outside
 * the collider on purpose, the gravestone's lesson: 8 cm of proud lip is not
 * worth stopping a round through.
 */
export function buildSkip(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const body = MeshBuilder.CreateBox(
    "skip",
    { width: 1.9, height: 1.1, depth: 1.2 },
    scene,
  );
  body.position.y = 0.55;
  // A skip is dropped where it fits and never squared to the kerb.
  body.rotation.y = (rng() - 0.5) * 0.24;
  body.material = mats.get(SKIP_PAINT);

  const rim = MeshBuilder.CreateBox(
    "skip-rim",
    { width: 2.04, height: 0.12, depth: 1.34 },
    scene,
  );
  rim.parent = body;
  rim.position.y = 0.58;
  rim.material = mats.get(DARK_METAL);

  for (const sx of [-1, 1]) {
    const lug = MeshBuilder.CreateBox(
      `skip-lug${sx}`,
      { width: 0.12, height: 0.34, depth: 0.5 },
      scene,
    );
    lug.parent = body;
    lug.position.set(sx * 0.98, 0.1, 0);
    lug.material = mats.get(DARK_METAL);
  }
  return body;
}

/**
 * Two wheelie bins side by side — the doorway-scale companion to the skip,
 * for the building bases and back closes a skip is too big for.
 */
export function buildBinPair(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const root = MeshBuilder.CreateBox(
    "bin",
    { width: 0.5, height: 1.0, depth: 0.56 },
    scene,
  );
  root.position.y = 0.5;
  root.rotation.y = (rng() - 0.5) * 0.5;
  root.material = mats.get(BIN_BODY);

  const lid = MeshBuilder.CreateBox(
    "bin-lid",
    { width: 0.54, height: 0.08, depth: 0.6 },
    scene,
  );
  lid.parent = root;
  lid.position.y = 0.52;
  lid.material = mats.get(BIN_LID);

  // The second bin, leaning in slightly — a pair nobody lined up.
  const mate = MeshBuilder.CreateBox(
    "bin-mate",
    { width: 0.48, height: 0.92, depth: 0.54 },
    scene,
  );
  mate.parent = root;
  mate.position.set(0.56, -0.04, 0.06 + rng() * 0.1);
  mate.rotation.y = (rng() - 0.5) * 0.4;
  mate.material = mats.get(BIN_BODY);

  const mateLid = MeshBuilder.CreateBox(
    "bin-mate-lid",
    { width: 0.52, height: 0.08, depth: 0.58 },
    scene,
  );
  mateLid.parent = mate;
  mateLid.position.y = 0.48;
  mateLid.material = mats.get(BIN_LID);
  return root;
}

/** A stack of pallets against a wall: back lots, depot yards, loading bays. */
export function buildPalletStack(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const root = MeshBuilder.CreateBox(
    "pallet",
    { width: 1.2, height: 0.14, depth: 1.0 },
    scene,
  );
  root.position.y = 0.07;
  root.rotation.y = rng() * Math.PI;
  root.material = mats.get(PALLET_WOOD);

  // Four or five more on top, each skewed a little — a stack nobody squared.
  const count = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i++) {
    const slat = MeshBuilder.CreateBox(
      `pallet${i}`,
      { width: 1.2, height: 0.14, depth: 1.0 },
      scene,
    );
    slat.parent = root;
    slat.position.set((rng() - 0.5) * 0.14, (i + 1) * 0.17, (rng() - 0.5) * 0.12);
    slat.rotation.y = (rng() - 0.5) * 0.16;
    slat.material = mats.get(PALLET_WOOD);
  }
  return root;
}

/**
 * A traffic cone, and the best value on the urban list.
 *
 * It is NON-BLOCKING and that is the whole design: at 0.62 m across the base a
 * collider would be a lie either way — too small to stop anything worth
 * stopping, and big enough to eat rounds through the air around a shape that
 * is mostly slope. So it emits nothing at all, which means it costs no solid
 * mesh, no `WorldBox`, no nav cell and nothing to any ray in the game.
 *
 * What it buys is two complaints at once: it is dressing, and it is the only
 * saturated warm thing at ground level on a map made of grey. At a low sun it
 * also throws a shadow several times its own height, which is what makes a
 * scatter of them read across a carriageway rather than only underfoot.
 */
export function buildTrafficCone(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const base = MeshBuilder.CreateBox(
    "cone-base",
    { width: 0.42, height: 0.05, depth: 0.42 },
    scene,
  );
  base.position.y = 0.025;
  base.rotation.y = rng() * Math.PI;
  base.material = mats.get(CONE_ORANGE);

  const body = MeshBuilder.CreateCylinder(
    "cone",
    { height: 0.62, diameterTop: 0.06, diameterBottom: 0.3, tessellation: 8 },
    scene,
  );
  body.parent = base;
  body.position.y = 0.33;
  body.material = mats.get(CONE_ORANGE);

  // The reflective band. A cone without one reads as a lump.
  const band = MeshBuilder.CreateCylinder(
    "cone-band",
    { height: 0.1, diameterTop: 0.17, diameterBottom: 0.21, tessellation: 8 },
    scene,
  );
  band.parent = body;
  band.position.y = 0.08;
  band.material = mats.get(CONE_BAND);

  // A tenth of them knocked over, which is what says a street is used rather
  // than dressed. Tipped about the base's own edge so it still sits ON the
  // ground rather than through it.
  if (rng() < 0.1) base.rotation.z = Math.PI / 2 - 0.08;
  return base;
}

/**
 * Blown litter: a few flat scraps and a crushed can.
 *
 * The cheapest density in the game — non-blocking, nearly flat, and merged per
 * colour with every other instance in its region, so a hundred of them is two
 * draw calls. Flat geometry catching a raking key light is most of what makes
 * a street read as swept-past rather than swept, and it does that for no ray
 * cost at all.
 *
 * Everything is laid within a few centimetres of the ground because a scrap
 * standing proud reads as a shard of something structural. `visualTop` in
 * `PROP_BODIES` is what keeps `findSpot`'s burial check honest about that.
 */
export function buildLitter(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const root = MeshBuilder.CreateBox(
    "litter",
    { width: 0.24, height: 0.012, depth: 0.19 },
    scene,
  );
  root.position.y = 0.006;
  root.rotation.y = rng() * Math.PI;
  root.material = mats.get(SCRAP_PAPER);

  const scraps = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < scraps; i++) {
    const scrap = MeshBuilder.CreateBox(
      `scrap${i}`,
      { width: 0.1 + rng() * 0.2, height: 0.01, depth: 0.08 + rng() * 0.16 },
      scene,
    );
    scrap.parent = root;
    scrap.position.set(
      (rng() - 0.5) * 1.1,
      rng() * 0.01,
      (rng() - 0.5) * 1.1,
    );
    scrap.rotation.y = rng() * Math.PI;
    scrap.material = mats.get(rng() < 0.5 ? SCRAP_PAPER : SCRAP_CARD);
  }

  const can = MeshBuilder.CreateCylinder(
    "can",
    { height: 0.11, diameter: 0.06, tessellation: 6 },
    scene,
  );
  can.parent = root;
  can.position.set((rng() - 0.5) * 0.8, 0.028, (rng() - 0.5) * 0.8);
  // Lying on its side, which is the only way a can ends up on a pavement.
  can.rotation.z = Math.PI / 2;
  can.rotation.y = rng() * Math.PI;
  can.material = mats.get(DARK_METAL);
  return root;
}

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
  rng: () => number = Math.random,
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

// The temple valley's three, and every one is set against the MAPLE rather
// than against the other trees in this file: Kurenai is a valley where the
// red is the point, so the bark is dark enough to draw every crown on a
// stroke, the bamboo is the one cool green for a hundred metres, and what lies
// on the ground is the crown's own colour gone a shade browner.
const MAPLE_BARK = "#3b2d26";
/**
 * Four crowns, each a SHADE and a LIT tone: crimson, scarlet, flame and a
 * deep oxblood. One valley's maples do not turn together, and a hillside of
 * them in a single red reads as a flat colour rather than as trees — so each
 * tree draws one of these. Four is the budget rather than a taste: a merged
 * block carries a draw per material, and eight tones is eight draws a block.
 */
const MAPLE_CROWNS: readonly [string, string][] = [
  ["#6a1410", "#a61e17"],
  ["#7d1d12", "#b8301a"],
  ["#86300f", "#c4521c"],
  ["#5c1512", "#931b1a"],
];
/** What the maples have dropped — the crowns' tones, browned and dulled. */
const FALLEN = ["#8e2a1b", "#b33c20", "#c9602a", "#6f2a1d"];
const BAMBOO_CULM = "#71803e";
const BAMBOO_OLD = "#8f8b4c";
const BAMBOO_LEAF = "#4b682b";
const BAMBOO_LEAF_LIT = "#789441";

/**
 * Japanese maple: a short dark bole that forks at head height into three or
 * four limbs, and a broad crown of JAGGED CLUMPS — the tree the whole map is
 * named for and the one the reference frame is made of.
 *
 * **The crown is a cloud of tilted clumps and not a stack of tiers**, and that
 * was measured by eye rather than argued: built the ash's way, round the axis
 * in four tiers, the maple came back as a pile of red boards — a tier is a
 * rosette of boxes at one height, so its silhouette is horizontal edges one
 * over another. A maple's crown is separate masses of leaf at every height and
 * bearing with sky between them, and twenty clumps sown through a flattened
 * dome, each turned and tipped its own way, is that — thirty-odd of them,
 * a metre or so across, because at the size of a limb's cloud the clumps
 * read as boards again from underneath: every edge in the
 * silhouette runs a different way, which is what reads as LEAF.
 *
 * Three things about the shape are load-bearing:
 *
 * - **Wider than it is tall.** The dome is ~7 m across on a tree ~6.5 m high
 *   at scale 1; what reads at a distance is a red cloud on a dark stroke.
 * - **The lowest leaf is at ~2.6 m at scale 1**, clear of the 1.7 m hit
 *   sphere at any scale over 0.65. That is the worst CORNER: a clump's centre
 *   is never under 3.3 m, and at the tilt cap (0.45 rad) and its largest size
 *   a corner dips 0.7 m under it. The collider is the bole only (see
 *   `PROP_BODIES`), so everything above is leaf a round passes through.
 * - **The limbs end INSIDE the crown**, the ash's rule and for its reason: the
 *   crown sways and the limb does not, so a limb tip outside the leaf would
 *   show the join moving.
 *
 * Built from parts (`world/parts.ts`) rather than `MeshBuilder`: a map sows
 * thousands of these and every part is merged away, so uploading each clump
 * to the device on the way was most of the build.
 */
export function buildMaple(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const bark = mats.get(MAPLE_BARK);
  const trunk = partCylinder(
    "maple-trunk",
    { height: 3.4, diameterTop: 0.28, diameterBottom: 0.52, tessellation: 6 },
    scene,
  );
  trunk.position.y = 1.7;
  trunk.material = bark;
  // A maple leans more than a standard does — it is a garden tree, grown for
  // its habit — but the crown is still the silhouette, so not by much.
  trunk.rotation.z = (rng() - 0.5) * 0.14;
  trunk.rotation.x = (rng() - 0.5) * 0.1;

  const [shade, lit] = MAPLE_CROWNS[Math.floor(rng() * MAPLE_CROWNS.length)];
  const leaf = (hex: string) =>
    mats.getTranslucent(hex, CONFIG.graphics.translucency.maple);

  // The limbs, reaching up and out into the crown.
  const limbs = 3 + Math.floor(rng() * 2);
  const turn = rng() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + turn + (rng() - 0.5) * 0.4;
    const tilt = 0.6 + rng() * 0.25;
    const len = 2.4 + rng() * 0.4;
    const limb = partBox(
      `maple-limb${i}`,
      { width: 0.2, height: len, depth: 0.18 },
      scene,
    );
    limb.parent = trunk;
    const rc = 0.08 + Math.sin(tilt) * (len / 2);
    // Local to the trunk's centre (1.7 m): the fork is at 2.9 m.
    limb.position.set(
      Math.sin(a) * rc,
      1.2 + Math.cos(tilt) * (len / 2),
      Math.cos(a) * rc,
    );
    limb.rotation.y = a;
    limb.rotation.x = tilt;
    limb.material = bark;
  }

  // The crown: clumps through a flattened dome, lowest at 3.4 m and none
  // above 5.8, widest a third of the way up.
  const clumps = 30 + Math.floor(rng() * 8);
  for (let i = 0; i < clumps; i++) {
    const t = Math.pow(rng(), 1.25);
    const y = 3.3 + 2.5 * t;
    const reach = 3.4 * (1 - 0.8 * t * t) * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    // A five-sided plate rather than a box: turned and tipped, its points are
    // what make the silhouette read as LEAF rather than as boards.
    const w = 1.2 + rng() * 0.8;
    const clump = partCylinder(
      `maple-clump${i}`,
      {
        height: 0.4 + rng() * 0.3,
        diameterTop: w * 0.8,
        diameterBottom: w,
        tessellation: 5,
      },
      scene,
    );
    clump.parent = trunk;
    clump.position.set(Math.sin(a) * reach, y - 1.7, Math.cos(a) * reach);
    clump.rotation.y = rng() * Math.PI * 2;
    clump.rotation.x = (rng() - 0.5) * 0.9;
    clump.rotation.z = (rng() - 0.5) * 0.9;
    // The sun is on the top and the outside; the heart and the underside are
    // the shade — with a few exceptions, because a real crown is not banded.
    const sunny = t > 0.45 || (reach > 2.2 && rng() < 0.5);
    clump.material = leaf(sunny !== rng() < 0.15 ? lit : shade);
    marksSway(clump, "canopy");
  }
  return trunk;
}

/**
 * Fallen leaves: a drift of red chips lying flat on the ground under the
 * maples, the other half of the reference frame's red. Non-blocking, casts
 * nothing (a 3 cm chip in the sun's map is acne and not a shadow), and inked,
 * which is what makes a drift read as leaves rather than as a stain.
 *
 * It lies LEVEL at the height of the prop's own centre, so a region of it is
 * only honest on gentle ground — the generator sows it where the gradient is
 * under 0.05 and nowhere else — and a drift is 1.6 m across so the error at
 * its edge is about the chip's own thickness.
 */
export function buildLeafLitter(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const chip = (i: number): Mesh => {
    const m = partBox(
      `leaves${i}`,
      { width: 0.15 + rng() * 0.12, height: 0.025, depth: 0.12 + rng() * 0.1 },
      scene,
    );
    m.material = mats.get(FALLEN[Math.floor(rng() * FALLEN.length)]);
    m.rotation.y = rng() * Math.PI * 2;
    m.rotation.z = (rng() - 0.5) * 0.1;
    m.metadata = { noShadowCaster: true };
    return m;
  };
  const root = chip(0);
  root.position.y = 0.02;
  const n = 24 + Math.floor(rng() * 14);
  for (let i = 1; i < n; i++) {
    const m = chip(i);
    m.parent = root;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.8;
    m.position.set(Math.cos(a) * r, (rng() - 0.5) * 0.008, Math.sin(a) * r);
  }
  return root;
}

/**
 * A clump of bamboo: eight to eleven culms nine metres high, leaning out from
 * the clump a little, with the leaf carried in tufts over the top half — the
 * one cool green in a red valley, and the thing a hillside path is walked
 * between.
 *
 * NON-BLOCKING, the bramble's rule and for the fern's reason: a culm is ten
 * centimetres thick and a clump is mostly air at head height, so a box round
 * one would stop rounds through a metre of daylight. The tufts start at half
 * the height, far clear of the hit sphere.
 */
export function buildBamboo(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  let root: Mesh | null = null;
  const culms = 8 + Math.floor(rng() * 4);
  for (let i = 0; i < culms; i++) {
    const h = 7.5 + rng() * 3;
    const a = rng() * Math.PI * 2;
    const r = i === 0 ? 0 : 0.2 + rng() * 0.7;
    const culm = partCylinder(
      `bamboo${i}`,
      { height: h, diameterTop: 0.07, diameterBottom: 0.12 + rng() * 0.05, tessellation: 5 },
      scene,
    );
    culm.material = mats.get(rng() < 0.3 ? BAMBOO_OLD : BAMBOO_CULM);
    const lean = 0.03 + r * 0.06;
    if (!root) {
      root = culm;
      culm.position.y = h / 2;
    } else {
      culm.parent = root;
      // Relative to the root culm's centre.
      culm.position.set(Math.cos(a) * r, h / 2 - root.position.y, Math.sin(a) * r);
    }
    culm.rotation.z = -Math.cos(a) * lean;
    culm.rotation.x = Math.sin(a) * lean;
    const tufts = 3;
    for (let k = 0; k < tufts; k++) {
      const tuft = partBox(
        `bamboo-leaf${i}-${k}`,
        { width: 1.5 + rng() * 0.6, height: 0.4, depth: 0.8 + rng() * 0.4 },
        scene,
      );
      tuft.parent = culm;
      const f = 0.55 + (k / tufts) * 0.42;
      tuft.position.set(0, h * f - h / 2, 0);
      tuft.rotation.y = rng() * Math.PI * 2;
      tuft.rotation.z = (rng() - 0.5) * 0.5;
      tuft.material = mats.getTranslucent(
        k === tufts - 1 ? BAMBOO_LEAF_LIT : BAMBOO_LEAF,
        CONFIG.graphics.translucency.canopy,
      );
      marksSway(tuft, "canopy");
    }
  }
  return root!;
}
