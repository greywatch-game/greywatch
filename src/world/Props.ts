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

/** A point or a direction in a part's own frame — see `Sheet`. */
type V3 = readonly [number, number, number];
const v3add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const v3cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const v3unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const v3dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const v3lerp = (p: V3, q: V3, u: number): V3 => [
  p[0] + (q[0] - p[0]) * u,
  p[1] + (q[1] - p[1]) * u,
  p[2] + (q[2] - p[2]) * u,
];

/**
 * A surface laid vertex by vertex, for a builder whose leaf is too fine to be
 * a part per piece — the fern's fronds, the jungle tree's pinnae. One sheet
 * per colour, merged into one part at the end (`sheetData`), so a crown of
 * three hundred leaflets costs the merge two meshes rather than three hundred.
 */
interface Sheet {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}
const newSheet = (): Sheet => ({ positions: [], normals: [], uvs: [], indices: [] });
/** A vertex at `p` facing `n` (normalised here); returns its index. */
function sheetVert(s: Sheet, p: V3, n: V3): number {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  s.positions.push(p[0], p[1], p[2]);
  s.normals.push(n[0] / l, n[1] / l, n[2] / l);
  s.uvs.push(p[0], p[1] + p[2]);
  return s.positions.length / 3 - 1;
}
/** A triangle, wound off its first vertex's normal (see `tri`). */
function sheetFace(s: Sheet, a: number, b: number, c: number): void {
  tri(s.indices, s.positions, a, b, c, s.normals.slice(a * 3, a * 3 + 3));
}
function sheetData(s: Sheet): VertexData {
  const data = new VertexData();
  data.positions = s.positions;
  data.normals = s.normals;
  data.uvs = s.uvs;
  data.indices = s.indices;
  return data;
}

/** One station of a rachis: along it, across the blade, and out of its face. */
interface RachisFrame {
  t: V3;
  side: V3;
  up: V3;
}

/**
 * The frames of a rachis heading out on bearing `a`: across the blade is
 * level, rolled by `roll` so one half of the frond faces up more than the
 * other. The fern's fronds and the jungle palm's.
 */
function rachisFrames(pts: readonly V3[], a: number, roll: number): RachisFrame[] {
  const S = pts.length - 1;
  const flat: V3 = [Math.cos(a), 0, -Math.sin(a)];
  return pts.map((_, i) => {
    const t = v3unit(v3add(pts[Math.min(S, i + 1)], pts[Math.max(0, i - 1)], -1));
    const side = v3unit(v3add(v3add([0, 0, 0], flat, Math.cos(roll)), v3cross(t, flat), Math.sin(roll)));
    return { t, side, up: v3unit(v3cross(t, side)) };
  });
}

/** A point `f` of the way along a rachis, and its frame. */
function rachisAt(pts: readonly V3[], frames: readonly RachisFrame[], f: number): RachisFrame & { p: V3 } {
  const S = pts.length - 1;
  const x = Math.min(S - 1e-6, f * S);
  const i = Math.floor(x);
  const u = x - i;
  const A = frames[i];
  const B = frames[i + 1];
  return {
    p: v3lerp(pts[i], pts[i + 1], u),
    t: v3unit(v3lerp(A.t, B.t, u)),
    side: v3unit(v3lerp(A.side, B.side, u)),
    up: v3unit(v3lerp(A.up, B.up, u)),
  };
}

/** How `pinnateBlade` cuts and folds a blade. */
interface BladeCut {
  /** The blade's half-width a fraction `f` of the way along the rachis. */
  width: (f: number) => number;
  /** How far each half falls from the rib, per metre of its own width. */
  fold: number;
  /** How much further a pinna's point droops below the fold, per metre. */
  droop: number;
  /** How far in toward the rib the cut between two pinnae runs, as a share
   *  of the half-width (small is deep). */
  notch: number;
  /** How far forward a pinna's point is swept, in metres. */
  sweep: number;
  /** How far under the top's rib the underside's runs, at the stalk. */
  thick: number;
  /** How far the two sides' pinnae are staggered, in intervals. */
  stagger: number;
  /** Extra droop per point, `[side][pinna]`, for a fringe that is not ruled. */
  ragged?: readonly (readonly number[])[];
  /**
   * ROUNDS each pinna's end: the point becomes two, this share of an
   * interval apart along the rachis and drawn a little way back toward the
   * rib, so the end is blunt where it was a spike. One vertex a pinna more.
   * Absent is pointed, the fern's.
   */
  blunt?: number;
}

/**
 * A PINNATE blade along a rachis, one pinna per interval a side — the fern's
 * frond and the jungle palm's.
 *
 * Each half is FOLDED down from the rib, so the bands put a lit half and a
 * shade half on every blade and the ink draws the rib where they meet; its
 * edge runs out to a point and back in to a notch once per pinna, the two
 * sides staggered. Every blade is a CLOSED lens — a flatter fold under the
 * top one meeting it at the points and the notches — because the world's
 * shadow map records back faces and the translucency term measures a crown's
 * thickness off its front ones. Smooth along the blade, creased at the rib.
 */
function pinnateBlade(
  pts: readonly V3[],
  frames: readonly RachisFrame[],
  cut: BladeCut,
  top: Sheet,
  under: Sheet,
): void {
  const S = pts.length - 1;
  const { width, fold, droop, notch, sweep, thick, stagger, ragged, blunt } = cut;
  [-1, 1].forEach((s, k) => {
    // The top half and the underside, which meet at the notches and the
    // points; the underside's rib is the blade's thickness under the top's.
    for (const below of [false, true]) {
      const into = below ? under : top;
      const normal = (side: V3, up: V3, fall: number): V3 =>
        below ? v3add(v3add([0, 0, 0], up, -1), side, -s * fold * 0.6) : v3add(up, side, s * fall);
      const ribs: number[] = [];
      const notches: number[] = [];
      for (let i = 0; i <= S; i++) {
        const { side, up } = frames[i];
        const w = width(i / S) * notch;
        const n = normal(side, up, fold);
        ribs.push(sheetVert(into, below ? v3add(pts[i], up, -thick * (1 - 0.6 * (i / S))) : pts[i], n));
        notches.push(sheetVert(into, v3add(v3add(pts[i], side, s * w), up, -fold * w), n));
      }
      for (let i = 0; i < S; i++) {
        const f = (i + 0.5 + s * stagger) / S;
        const { p, t, side, up } = rachisAt(pts, frames, f);
        const w = width(f);
        const fall = ragged ? fold + droop + ragged[k][i] : fold + droop;
        const tip = v3add(v3add(v3add(p, side, s * w), up, -fall * w), t, sweep);
        const n = normal(side, up, fall);
        if (!blunt) {
          const point = sheetVert(into, tip, n);
          sheetFace(into, ribs[i], notches[i], point);
          sheetFace(into, ribs[i], point, ribs[i + 1]);
          sheetFace(into, ribs[i + 1], point, notches[i + 1]);
          continue;
        }
        // Back from the point along the pinna, toward the middle of its foot,
        // and either side of that along the rachis: a short square end, which
        // the bands and the ink draw as a round one at any range it is seen at.
        const half = (blunt * v3dist(pts[i], pts[i + 1])) / 2;
        const foot = v3add(v3add(p, side, s * w * notch), up, -fold * w * notch);
        const end = v3lerp(tip, foot, 0.07);
        const back = sheetVert(into, v3add(end, t, -half), n);
        const front = sheetVert(into, v3add(end, t, half), n);
        sheetFace(into, ribs[i], notches[i], back);
        sheetFace(into, ribs[i], back, front);
        sheetFace(into, ribs[i], front, ribs[i + 1]);
        sheetFace(into, ribs[i + 1], front, notches[i + 1]);
      }
    }
  });
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
 * Jungle palm: a buttressed, fluted bole running bare for two storeys into a
 * crown head, and a fountain of FEATHER FRONDS out of it — the young ones
 * standing up out of the middle and arching over, the old ones spread round
 * them and hanging, each a rachis fringed with pinnae. The tall counterpart to
 * the pine — where a pine is a cone you see the whole of, this is a column
 * with the foliage held above the fight, so a stand of them roofs the sky
 * without closing the sight lines under it.
 *
 * **It was a hardwood crowned with slabs** — two tiers of lozenge plates under
 * rings of two-segment blades, carried on limbs — and from every distance a
 * player sees it from it read as green boards stacked on a post. The look this
 * game is drawn in finds an edge where depth steps or bends and gives a face
 * one value per band, so a slab is one shape and one tone however big it is.
 * A frond is the opposite: a broad blade hanging either side of its rib
 * like a wet feather, creased down the middle into a lit half and a shade
 * half and cut at its edge into a ragged fringe of hanging pinnae — strokes
 * the ink and the bands can find, made of geometry, which is the only way
 * this look can have them (`reference-media/jungletrees.jpg` is the target).
 * The crown still closes most of the sky, and lets it through at the fringes,
 * so the forest floor is dappled rather than shut.
 *
 * Four things about the shape are load-bearing rather than decorative:
 *
 * - **The lowest leaf hangs at ~6.5 m** on a scale-1 tree (5.5 m at the
 *   region's 0.85), three times clear of the 1.7 m hit sphere — the oldest
 *   frond's tip and the pinnae hanging off it. The collider is the trunk and
 *   its buttress core only (see `PROP_BODIES`), so anything at chest height
 *   would be foliage rounds pass straight through — the pine's rule. The
 *   climber below is the one leaf under the crown, and it is pressed flat on
 *   the bark.
 * - **The bole stays inside the collider's 0.5 m half-width up to the crown**
 *   — flare, flutes and bend together — so the column a round stops on is the
 *   column you see. The BUTTRESSES do not, and are shaped so that what is
 *   outside is low: steep against the bole and falling away, under a metre
 *   high at the box's corner and a surface root under 0.3 m past it. They are
 *   what makes the trunk read as tropical at all; a bare cylinder of this
 *   height is a telegraph pole.
 * - **The fronds sway and the crown head does not**, and every frond's root is
 *   inside it: `buildPalm`'s rule, for `world/sway.ts`'s reason.
 * - **The crown stays under 11.6 m**, the frozen
 *   `PROP_BODIES.jungleTree.visualTop` — the youngest frond's arch is what
 *   reaches it.
 *
 * **Its detail comes from a stream of its OWN, and neither of the two it is
 * handed.** `rng` is the map's shared scatter stream and every draw from it
 * moves every tree, fern and flag walk after this one, so this takes exactly
 * the forty-eight draws it always took, in the same order; `sub` is the veil's
 * (below), and a draw taken from it would re-hang every curtain on the map.
 * So the flutes, the bend, the extra buttresses, the fronds, every pinna and
 * the climber are drawn from `own`, a generator keyed off this tree's first
 * shared draw — distinct per tree, fixed per layout, and invisible to both of
 * the others. Most of the forty-eight are taken and thrown away now (see the
 * crown).
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
 * read as a pole, a pinna at three vertices a face, and nothing that only the
 * far side of a leaf could see — about 2,950 vertices a tree on average, most
 * of them fronds. Built from parts (`world/parts.ts`), like the maple, so none
 * of it is uploaded to the device on its way to the merge, and the whole
 * crown is three of them (`Sheet`): the lit green, the shade green and the
 * dead fronds.
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

  // The rest of the shared stream's forty-eight. The crown they used to place
  // — two tiers of plates and two rings of blades — is gone, and these are
  // taken and not spent (bar the first, which turns the crown) so every tree,
  // fern and flag walk sown after this one stays where it was.
  const crownTurn = rng() * Math.PI * 2;
  for (let i = 0; i < 42; i++) rng();

  // The CROWN HEAD: the knot of frond bases the bole runs up into and every
  // frond leaves from. Unmarked, because it is what buries the fronds' roots
  // while they sway — `buildPalm`'s boss, for its reason. It starts inside the
  // bole, so it rises out of the trunk rather than sitting on it as a cap, and
  // its flutes are the old leaf bases standing proud.
  const HEAD: readonly Flat[] = [
    [9.55, 0.19],
    [9.95, 0.3],
    [10.35, 0.37],
    [10.75, 0.33],
    [11.0, 0.2],
    [11.12, 0.04],
  ];
  const boss = loft(
    "jungle-boss",
    HEAD.map(([h, r]) => ({ ...bole(h), r })),
    7,
    scene,
    Array.from({ length: 7 }, () => (own() - 0.5) * 0.24),
  );
  boss.parent = trunk;
  boss.material = vine;

  // The FRONDS, and the whole of what this tree is drawn by now. It was a
  // crown of slabs — two tiers of lozenge plates under rings of two-segment
  // blades — and at every distance a player sees it from it read as green
  // boards stacked on a post: one value per slab, and a silhouette of a dozen
  // straight edges. A frond here is a feather: a broad PINNATE blade either
  // side of the rachis (`pinnateBlade`, the fern's), each half hanging from
  // the rib like the two slopes of a tent and cut at its edge into a fringe of
  // long hanging pinnae.
  //
  // **It is a BLADE cut into pinnae and not a row of separate pinnae**, and
  // that was measured by eye rather than argued. Built as loose triangles
  // strung along a stalk, the crown came back as combs of spikes — thin,
  // hard and see-through, a frond's worth of teeth with sky between every
  // one. What makes a frond read as THICK is the solid band of leaf along
  // the rib that the cut stops short of; what makes it read as SOFT is that
  // the blade is smooth-shaded along its length and drapes, so the bands run
  // across it as curves rather than one hard value per spike; and what makes
  // it read as DRAWN is still geometry the ink can find — the rib creases
  // the blade into a lit half and a shade half, every pinna is a fold
  // between two notches, and the fringe is ragged, each point falling its
  // own way, so no two strokes are ruled.
  //
  // Each frond leaves the crown head on the axis, climbs and arches over, and
  // the OLDER it is the lower it leaves, the harder it falls and the steeper
  // its two halves hang: the young ones stand up out of the middle of the
  // crown nearly flat and the old ones spread round them like wet feathers,
  // so the crown is a fountain rather than a parasol. Turned by the golden
  // angle, so no two neighbours lie over each other.
  //
  // **The lowest leaf hangs at ~6.5 m on a scale-1 tree** (5.5 at the
  // region's 0.85), measured over two hundred seeds — an old frond's fringe hanging
  // off its drooping far end. Three times the hit sphere's 1.7 m, so nothing
  // a round can find is up here. Hang the old fronds harder and that is the
  // number that moves.
  //
  // **The top is ~11.6 m**, the youngest frond's arch, at the frozen
  // `PROP_BODIES.jungleTree.visualTop`.
  //
  // Budget: some fourteen hundred of these stand on Greyfen, so a pinna is
  // fourteen hundred in the scene and they are counted — six vertices a
  // pinna a side (a notch and a ROUNDED end of two, top and underside),
  // fourteen a side on nine to eleven fronds: FEWER fronds and more pinnae,
  // because a blade this broad fills a crown on its own and it is the pinna
  // count that decides whether the fringe reads as leaflets or as the teeth
  // of a saw. The ends are blunted (`BladeCut.blunt`) because a fringe of
  // single-vertex points read as spikes, hard against the soft blade, and
  // the vertex that costs was paid for with two pinnae a side. Measured
  // against the plate crown it replaced, ~5% of the frame rate standing in
  // the forest and ~1% from the air; a first cut of loose pinnae at ~3,000
  // vertices a tree cost 13% from the air.
  const lit = newSheet();
  const shade = newSheet();
  const dry = newSheet();
  // Where along a frond the bare stalk gives way to the blade.
  const STIPE = 0.14;
  // One frond out along bearing `a` from `from`, `pinnae` a side: the rachis
  // climbing at `e0` and falling to `e1`, `W` the widest half-width, `fold`
  // and `droop` how hard the halves and the points hang, `roll` the blade's
  // turn about its rachis. Returns the rachis.
  const frond = (
    a: number,
    from: V3,
    len: number,
    e0: number,
    e1: number,
    pinnae: number,
    W: number,
    fold: number,
    droop: number,
    roll: number,
    top: Sheet,
    under: Sheet,
  ): V3[] => {
    const pts: V3[] = [from];
    for (let i = 1; i <= pinnae; i++) {
      const e = e0 + ((e1 - e0) * (i - 0.5)) / pinnae;
      const p = pts[i - 1];
      const d = len / pinnae;
      pts.push([
        p[0] + Math.sin(a) * Math.cos(e) * d,
        p[1] + Math.sin(e) * d,
        p[2] + Math.cos(a) * Math.cos(e) * d,
      ]);
    }
    // A strap of stalk, then the blade — longest a little past its middle and
    // still long at its foot, which is what gives a palm frond its weight
    // close in where a fern's tapers to nothing.
    const width = (f: number): number => {
      if (f <= STIPE) return 0.035;
      const u = (f - STIPE) / (1 - STIPE);
      return Math.max(0.035, W * Math.pow(Math.sin(Math.PI * (0.08 + 0.84 * u)), 0.55));
    };
    const ragged = [0, 1].map(() => Array.from({ length: pinnae }, () => (own() - 0.5) * 0.4));
    pinnateBlade(
      pts,
      rachisFrames(pts, a, roll),
      { width, fold, droop, notch: 0.36, sweep: (len / pinnae) * 0.3, thick: 0.04, stagger: 0.2, ragged, blunt: 0.22 },
      top,
      under,
    );
    return pts;
  };

  // Where the older fronds ended up, for the veil's hang points below: a
  // liana hangs from foliage that EXISTS rather than from a radius that hopes
  // to be under some.
  const boughs: { a: number; pts: V3[] }[] = [];
  const fronds = 9 + Math.floor(own() * 3);
  for (let k = 0; k < fronds; k++) {
    // 0 the youngest, upright in the middle; 1 the oldest, low and drooping.
    const age = k / (fronds - 1);
    const a = crownTurn + k * 2.39996 + (own() - 0.5) * 0.3;
    const len = 4.6 + age * 0.6 + own() * 0.6;
    const e0 = 0.6 - age * 0.62 + (own() - 0.5) * 0.1;
    const e1 = e0 - 1.0 - age * 0.15 - own() * 0.1;
    // On the axis, a hand behind it, inside the head: the root is buried by
    // the head's radius plus that, against the third of a metre it drifts.
    const root = bole(10.6 - age * 0.4);
    const from: V3 = [root.x - Math.sin(a) * 0.1, root.y, root.z - Math.cos(a) * 0.1];
    // Young fronds are the fresh green, old ones the dark.
    const top = own() < 0.95 - age * 0.75 ? lit : shade;
    const W = len * (0.24 + own() * 0.04);
    const roll = (own() - 0.5) * 0.4;
    const pts = frond(a, from, len, e0, e1, 14, W, 0.3 + age * 0.45, 0.35 + age * 0.2, roll, top, shade);
    if (age >= 0.5) boughs.push({ a, pts });
  }

  // DEAD FRONDS on some, hanging down the bole under the crown in the bark's
  // colour — the skirt of old leaf a palm carries until it falls, and the
  // one part of the crown that says what it is in silhouette against the
  // sky. Limp and narrow, and turned over (`roll` of a half turn) so its
  // halves fall AWAY from the bole it hangs down rather than into it. Not
  // marked — a dead
  // frond hangs stiff while the crown above it moves, and its root is inside
  // the head, which does not move either.
  const dead = own() < 0.45 ? 0 : own() < 0.6 ? 1 : 2;
  for (let k = 0; k < dead; k++) {
    const a = own() * Math.PI * 2;
    const root = bole(10.1 - own() * 0.3);
    const e0 = -0.85 - own() * 0.2;
    frond(a, [root.x, root.y, root.z], 3.0 + own() * 0.8, e0, e0 - 0.4, 8, 0.45, 0.9, 0.3, Math.PI, dry, dry);
  }

  const crown = (name: string, s: Sheet, material: typeof leaf, sways: boolean): void => {
    if (!s.indices.length) return;
    const mesh = partSurface(name, sheetData(s), scene);
    mesh.parent = trunk;
    mesh.material = material;
    // The live crown travels as one piece; see `world/sway.ts`, and the head
    // above for where the join is buried.
    if (sways) marksSway(mesh, "canopy");
  };
  crown("jungle-fronds-lit", lit, leafLit, true);
  crown("jungle-fronds", shade, leaf, true);
  crown("jungle-fronds-dead", dry, bark, false);

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
    // scale-1 tree, just under the crown head (9.55 to 11.1 in the same
    // frame's heights above the foot), so it is gathered where the fronds
    // leave the bole rather than floating under them. Every hang below is
    // stated relative to that line.
    const hangs: LianaHang[] = [];
    // One on the bole, so the collar is visibly holding something. Everything
    // else is out under a frond.
    hangs.push({ a: sub() * Math.PI * 2, r: 0.55, y: 0.02 });
    // The rest, each under one of the older fronds, taken in turn from a
    // random start so no two trees drape the same way. `r` is where along the
    // frond the vine took hold and `y` is the rachis's own height there, which
    // is what puts the strand's top in the fringe instead of beside it.
    const first = Math.floor(sub() * boughs.length);
    for (let i = 0; i < 4; i++) {
      const b = boughs[(first + i) % boughs.length];
      // Out under the frond and BOUNDED there rather than run to its tip,
      // which falls further than `buildLianaVeil`'s hem may start.
      const r = 1.5 + sub() * 1.6;
      const at = b.pts.findIndex((p) => Math.hypot(p[0], p[2]) >= r);
      const p0 = b.pts[Math.max(0, at - 1)];
      const p1 = b.pts[at < 0 ? b.pts.length - 1 : at];
      const r0 = Math.hypot(p0[0], p0[2]);
      const r1 = Math.hypot(p1[0], p1[2]);
      const under = p0[1] + ((p1[1] - p0[1]) * (r - r0)) / (r1 - r0 || 1) - 0.06;
      hangs.push({
        a: b.a + (sub() - 0.5) * 0.3,
        r,
        // FLOORED at -0.4 — 9.25 m up a scale-1 tree, the lowest a hang may
        // start and the number the veil's hem is derived against (see
        // `buildLianaVeil`). Where an old frond has already fallen below
        // that by `r`, the strand starts inside its fringe instead.
        y: Math.max(-0.4, under - 4.05),
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
 * The older fronds reach four metres and more and are already built, so
 * `buildJungleTree` hands over the fronds it actually made and a strand hangs
 * from one — out where the curtain is between the trunks rather than on them,
 * and in leaf rather than beside it. That is the whole reason
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
    // foliage on it is the mid-story as far as the eye is concerned. Each is a
    // pointed blade HANGING from its stalk, cut to a leaf's outline: they were
    // boxes, and next to the crown's pinnae a box on a vine read as a block
    // threaded on a string rather than as leaf.
    //
    // The lowest sits a clear margin above the hem so the bottom of the veil is
    // vine rather than foliage: a leaf is the widest thing here and the hem is
    // the one edge that must not creep downward.
    const leaves = 4;
    for (let j = 0; j < leaves; j++) {
      const t = 0.22 + (j / leaves) * 0.62;
      const at = radial(t, t);
      const s = 0.85 + rng() * 0.5;
      const blade = prism(
        "liana-leaf",
        [
          [0, 0],
          [0.13 * s, -0.16 * s],
          [0.04 * s, -0.42 * s],
          [0, -0.56 * s],
          [-0.04 * s, -0.42 * s],
          [-0.13 * s, -0.16 * s],
        ],
        0.03,
        scene,
      );
      blade.parent = collar;
      blade.position.set(at.x, top - drop * t, at.z);
      blade.rotation.y = rng() * Math.PI;
      // Hanging off the vine, never plumb: a leaf straight down the strand is
      // lost in it, and one held level reads as a shelf.
      blade.rotation.x = -(0.25 + rng() * 0.5);
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
  const lit = newSheet();
  const shade = newSheet();

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
    // Young fronds are the fresh green, old ones the dark.
    const top = own() < 0.9 - age * 0.6 ? lit : shade;
    pinnateBlade(
      pts,
      rachisFrames(pts, a, roll),
      { width, fold: FOLD, droop: DROOP, notch: NOTCH, sweep: (len / S) * SWEEP, thick: 0.02, stagger: 0.14 },
      top,
      shade,
    );
  }

  const surface = (name: string, s: Sheet, material: typeof frondLit): void => {
    if (!s.indices.length) return;
    const mesh = partSurface(name, sheetData(s), scene);
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

/**
 * The boulder's two stones. `BOULDER` is the weathered skin — the rounded mass
 * and the joint faces the ice broke it along, which are the same rock a few
 * thousand years later and so the same colour. `BOULDER_DARK` is what has not
 * weathered or never sees the sky: the inside of a frost cleft and the spalls
 * lying at the foot. Both are the colours the octahedron wore, so the rework
 * costs no draw call.
 */
const BOULDER = "#565d59";
const BOULDER_DARK = "#474e4a";

/**
 * How many draws `buildBoulder` takes from the shared scatter stream — the
 * number the octahedron it replaced took (its stretch, its tilt and the
 * shoulder stone's three turns), fixed there so redrawing it moved no prop on
 * any map. See its header.
 */
const BOULDER_SHARED_DRAWS = 7;

/**
 * Subdivisions of the geodesic a boulder's mass is drawn over: 162 directions,
 * an edge about a third of a metre round a stone two metres across — fine
 * enough that a joint face's outline wanders and an arris rounds, coarse
 * enough for 414 of them. A split stone draws it twice.
 */
const BOULDER_LEVEL = 2;

/** One flat face cut through a rock: whatever lies past `n·p = c` is laid onto it. */
interface RockCut {
  n: readonly [number, number, number];
  c: number;
  /** Drawn in `BOULDER_DARK` — the inside of a cleft, not a weathered joint. */
  dark?: boolean;
}

/** A rock's geometry in its two colours, either of which may be empty. */
interface RockSheets {
  skin: VertexData[];
  dark: VertexData[];
}

/** Unit geodesic spheres by subdivision level, built once and shared. */
const GEODESICS: { pts: number[][]; faces: number[][] }[] = [];

/**
 * An icosahedron subdivided `level` times, pushed out onto the unit sphere.
 * Pure and cached: every boulder on a map is drawn over the same lattice, and
 * nothing of it survives but the directions.
 */
function geodesic(level: number): { pts: number[][]; faces: number[][] } {
  const hit = GEODESICS[level];
  if (hit) return hit;
  const t = (1 + Math.sqrt(5)) / 2;
  const pts: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const mid = new Map<string, number>();
    const half = (a: number, b: number): number => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const known = mid.get(key);
      if (known !== undefined) return known;
      const x = pts[a][0] + pts[b][0];
      const y = pts[a][1] + pts[b][1];
      const z = pts[a][2] + pts[b][2];
      const len = Math.hypot(x, y, z);
      pts.push([x / len, y / len, z / len]);
      mid.set(key, pts.length - 1);
      return pts.length - 1;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = half(a, b);
      const bc = half(b, c);
      const ca = half(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  GEODESICS[level] = { pts, faces };
  return GEODESICS[level];
}

/**
 * A rock: the geodesic at `level` carried out to `place(direction)`, then cut
 * flat by each of `cuts` in turn, then moved by `m` (a rotation and a
 * translation only — `VertexData.transform` does not re-normalise).
 *
 * **Rounded where the ice wore it, flat where it broke.** A face lying wholly
 * on one cut is FLAT-shaded in that cut's normal, so a joint face is one tone
 * with a hard edge the ink draws; every other face shares its vertices and a
 * normal averaged over its neighbours, so the worn surface bands round the
 * stone rather than breaking into facets. It does not hide the lattice
 * entirely: the shadow map tests the real triangles, so where its terminator
 * crosses a broad stretch of skin the triangles show — which is why
 * `buildBoulder` keeps the skin narrow. The ring of faces straddling a cut's
 * edge are the smooth kind, which is the arris rounded off.
 */
function rockData(
  level: number,
  place: (u: readonly number[]) => number[],
  cuts: readonly RockCut[],
  m: Matrix,
  out: RockSheets,
): void {
  const g = geodesic(level);
  const P = g.pts.map(place);
  for (const { n, c } of cuts) {
    for (const p of P) {
      const d = n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - c;
      if (d > 0) {
        p[0] -= n[0] * d;
        p[1] -= n[1] * d;
        p[2] -= n[2] * d;
      }
    }
  }
  const onCut = (i: number, k: number): boolean => {
    const { n, c } = cuts[k];
    const p = P[i];
    return Math.abs(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - c) < 1e-6;
  };

  const acc = new Float64Array(P.length * 3);
  const worn: { f: number[]; nrm: number[] }[] = [];
  const flat: { f: number[]; k: number }[] = [];
  for (const f of g.faces) {
    const [a, b, c] = f;
    const ux = P[b][0] - P[a][0];
    const uy = P[b][1] - P[a][1];
    const uz = P[b][2] - P[a][2];
    const vx = P[c][0] - P[a][0];
    const vy = P[c][1] - P[a][1];
    const vz = P[c][2] - P[a][2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    // A face collapsed onto a cut is a sliver of nothing — skip it.
    if (Math.hypot(nx, ny, nz) < 1e-7) continue;
    let k = -1;
    for (let j = 0; j < cuts.length && k < 0; j++) {
      if (onCut(a, j) && onCut(b, j) && onCut(c, j)) k = j;
    }
    if (k >= 0) {
      flat.push({ f, k });
      continue;
    }
    // Outward is the way the lattice's own directions point.
    const ox = g.pts[a][0] + g.pts[b][0] + g.pts[c][0];
    const oy = g.pts[a][1] + g.pts[b][1] + g.pts[c][1];
    const oz = g.pts[a][2] + g.pts[b][2] + g.pts[c][2];
    if (nx * ox + ny * oy + nz * oz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const i of f) {
      acc[i * 3] += nx;
      acc[i * 3 + 1] += ny;
      acc[i * 3 + 2] += nz;
    }
    worn.push({ f, nrm: [nx, ny, nz] });
  }

  const sheet = () => ({ positions: [] as number[], normals: [] as number[], uvs: [] as number[], indices: [] as number[] });
  const skin = sheet();
  const dark = sheet();
  const vert = (s: ReturnType<typeof sheet>, p: readonly number[], n: readonly number[]): number => {
    s.positions.push(p[0], p[1], p[2]);
    s.normals.push(n[0], n[1], n[2]);
    s.uvs.push(p[0], p[1] + p[2]);
    return s.positions.length / 3 - 1;
  };
  const shared = new Map<number, number>();
  const smooth = (i: number): number => {
    const known = shared.get(i);
    if (known !== undefined) return known;
    const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) || 1;
    const at = vert(skin, P[i], [acc[i * 3] / l, acc[i * 3 + 1] / l, acc[i * 3 + 2] / l]);
    shared.set(i, at);
    return at;
  };
  for (const { f, nrm } of worn) {
    const [a, b, c] = f.map(smooth);
    tri(skin.indices, skin.positions, a, b, c, nrm);
  }
  // A joint face shares its vertices too — only across the crease does a
  // corner need a second copy, in the face's own normal. A cleft face is half
  // the lattice laid flat, so a copy per triangle was most of a split stone.
  const onFace = new Map<number, number>();
  for (const { f, k } of flat) {
    const s = cuts[k].dark ? dark : skin;
    const n = cuts[k].n;
    const [a, b, c] = f.map((i) => {
      const key = i * cuts.length + k;
      const known = onFace.get(key);
      if (known !== undefined) return known;
      const at = vert(s, P[i], n);
      onFace.set(key, at);
      return at;
    });
    tri(s.indices, s.positions, a, b, c, n);
  }

  for (const [s, list] of [[skin, out.skin], [dark, out.dark]] as const) {
    if (!s.indices.length) continue;
    const data = new VertexData();
    data.positions = s.positions;
    data.normals = s.normals;
    data.uvs = s.uvs;
    data.indices = s.indices;
    data.transform(m);
    list.push(data);
  }
}

/** A unit vector drawn evenly over the sphere. */
function unitFrom(own: () => number): [number, number, number] {
  const y = own() * 2 - 1;
  const a = own() * Math.PI * 2;
  const r = Math.sqrt(1 - y * y);
  return [Math.cos(a) * r, y, Math.sin(a) * r];
}

/**
 * The far reach of `pts` along `n` — where a cut `depth` into the stone from
 * that side has to be laid.
 */
function reach(pts: readonly number[][], n: readonly number[]): number {
  let h = -Infinity;
  for (const p of pts) h = Math.max(h, n[0] * p[0] + n[1] * p[1] + n[2] * p[2]);
  return h;
}

/**
 * A worn stone's shape over the unit sphere: an egg — `rx`/`rz` round the
 * waist, `top` above it and `bottom` below, its waist `cy` up — swelled and
 * sunk by a few broad LOBES, so no two are the same lump and none is a ball.
 * The lobes are low frequency on purpose: a ripple per lattice edge reads as a
 * crumpled can, a swell a stone wide reads as a stone.
 */
function wornShape(
  own: () => number,
  rx: number,
  rz: number,
  top: number,
  bottom: number,
  cy: number,
  lobes: number,
  swell: number,
): (u: readonly number[]) => number[] {
  const L = Array.from({ length: lobes }, (_, i) => ({
    d: unitFrom(own),
    // The last lobe is the finer one: a knuckle on the swell, not a second swell.
    a: (i === lobes - 1 ? 0.35 : 1) * swell * (0.6 + own() * 0.4),
    f: i === lobes - 1 ? 2.2 + own() * 0.8 : 0.8 + own() * 0.7,
    ph: own() * Math.PI * 2,
  }));
  return (u) => {
    let r = 1;
    for (const l of L) {
      r += l.a * Math.cos(Math.PI * l.f * (u[0] * l.d[0] + u[1] * l.d[1] + u[2] * l.d[2]) + l.ph);
    }
    return [u[0] * r * rx, cy + u[1] * r * (u[1] > 0 ? top : bottom), u[2] * r * rz];
  };
}

/**
 * Glacial erratic: a boulder the ice carried down the valley and left — hard
 * cover in the fields and the woods. A squat mass broken along ten to thirteen
 * JOINT faces, big ones round its waist and small ones over its shoulders,
 * with the worn skin between them left as rounded arrises, sunk into the
 * ground rather than set down on it. Two in five have been split by frost
 * along a joint, the halves wedged a few degrees apart over a dark cleft; half
 * have a shoulder stone at one corner, and flakes spalled off the joints lie
 * at the foot of the faces they came off.
 *
 * **It was an octahedron** — a grey gem stood on its point with a tetrahedron
 * beside it — and read as a pyramid pushed up through the turf: four flat
 * faces meeting at a ridge, the same four from every side. What makes a stone
 * read as one is the pair of surfaces it is made of, the broken and the worn
 * (`rockData`): every joint face FLAT, one tone under one hard edge the ink
 * draws, and the worn skin SMOOTH. The balance between them is the lesson.
 * A first cut was mostly skin with two to four joints and read as an egg — a
 * pebble scaled up — and the smooth normals over a coarse lattice let the
 * lattice through wherever the shadow map's terminator crossed it, a mosaic
 * of faint triangles. So the joints now take nearly the whole surface, as the
 * pines' and the ash's facets do, and the skin is only ever a narrow arris.
 *
 * Three things about it are load-bearing rather than decorative:
 *
 * - **The mass is sized to its collider** (`PROP_BODIES.boulder`, 2.1 x 1.9 x
 *   1.45, oriented with the prop): its waist is on the box's half-widths
 *   along its own X and Z at the median and under 0.16 m past them in nine
 *   stones in ten, and its top is held at or over the box's 1.45 m whatever
 *   the cuts take off it — a round stopping on air over a flat top reads as a
 *   bug. The corners the mass leaves empty are where the shoulder stone goes,
 *   so it is mostly inside the box and under half a metre; the spalls are
 *   outside it and ankle high.
 * - **Its detail comes from `sub`**, the per-prop stream. `rng` is the map's
 *   scatter stream and every draw from it moves every prop sown after this
 *   one, so this takes exactly `BOULDER_SHARED_DRAWS` from it and spends none.
 * - **Nothing is scaled non-uniformly.** The stretch is in the shape, and the
 *   tilt and the wedge are rotations baked into the vertices, so a normal
 *   still says which way the stone faces.
 *
 * Budgeted as DRESSING: 414 stand on Cinderhaven's slopes, so a vertex here is
 * four hundred in the scene. Two parts, one per colour, because a part is a
 * mesh the install pays for (see `buildDeadTree`).
 */
export function buildBoulder(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
  sub: () => number = Math.random,
): Mesh {
  // The octahedron's draws, taken and not spent (see the header).
  for (let i = 0; i < BOULDER_SHARED_DRAWS; i++) rng();
  const own = sub;
  const out: RockSheets = { skin: [], dark: [] };

  // The mass. The waist stands 0.42 m up, so it meets the ground at ~0.9 of
  // its width and sits IN the turf rather than on it, and it carries on down
  // to a flat bed half a metre under — deep enough that the downhill side of
  // one on Cinderhaven's slopes is still stone and not the underside of it.
  const rx = 1.12 + own() * 0.08;
  const rz = 1.02 + own() * 0.08;
  const cy = 0.42;
  const top = 0.95 + own() * 0.15;
  const shape = wornShape(own, rx, rz, top, 0.95, cy, 4, 0.1);
  const lattice = geodesic(BOULDER_LEVEL).pts.map(shape);

  // The joints: ten to thirteen planes the stone broke along, turned round it
  // by the golden angle so they do not stack on one side, from a little under
  // the level to 70 degrees over it, cut deep enough that their faces meet —
  // so the stone is a polytope of big faces with the worn skin left only at
  // the arrises. Two in five have had a shoulder of the crown taken off too,
  // steep and never a table top.
  const cuts: RockCut[] = [];
  const joints = 10 + Math.floor(own() * 4);
  const turn = own() * Math.PI * 2;
  for (let i = 0; i < joints; i++) {
    const az = turn + i * 2.39996 + (own() - 0.5) * 0.5;
    // Even over the band of the sphere from a little under the level to 70
    // degrees over it: a spiral in the SINE of the elevation, as a
    // sunflower's seeds are even over its disc.
    const el = Math.asin(-0.3 + ((i + 0.5 + (own() - 0.5) * 0.6) / joints) * 1.25);
    const n: [number, number, number] = [
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az),
    ];
    // Deep round the waist, where a face is a side of the stone; shallow over
    // the shoulder, or the crown goes and the stone is a squat lump.
    const deep = el < 0.6 ? 0.12 + own() * 0.24 : 0.06 + own() * 0.1;
    cuts.push({ n, c: reach(lattice, n) - deep });
  }
  if (own() < 0.4) {
    const az = own() * Math.PI * 2;
    const el = 1.15 + own() * 0.3;
    const n: [number, number, number] = [
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az),
    ];
    cuts.push({ n, c: reach(lattice, n) - (0.08 + own() * 0.14) });
  }
  cuts.push({ n: [0, -1, 0], c: 0.5 });

  // The whole stone leans a little off its bed, about a level axis.
  const leanAz = own() * Math.PI * 2;
  const lean = Matrix.RotationAxis(new Vector3(Math.cos(leanAz), 0, Math.sin(leanAz)), own() * 0.09);

  // Held to the collider's top: if the cuts took the crown under 1.47 m, the
  // shape above the ground is stretched back up to it and the cut planes with
  // it. The stretch is applied to the SHAPE, so nothing downstream sees a
  // scaled normal.
  const trial = lattice.map((p) => p.slice());
  for (const { n, c } of cuts) {
    for (const p of trial) {
      const d = n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - c;
      if (d > 0) for (let j = 0; j < 3; j++) p[j] -= n[j] * d;
    }
  }
  let crownY = 0;
  for (const p of trial) crownY = Math.max(crownY, p[1]);
  const lift = crownY < 1.47 ? 1.47 / crownY : 1;
  const place =
    lift === 1
      ? shape
      : (u: readonly number[]) => {
          const p = shape(u);
          if (p[1] > 0) p[1] *= lift;
          return p;
        };
  if (lift !== 1) {
    for (const cut of cuts) {
      if (cut.n[1] < 0) continue;
      // A plane through a point q with normal n, under y -> y * lift, is the
      // plane through (q.x, q.y * lift, q.z) with normal (n.x, n.y / lift, n.z).
      const q = [cut.n[0] * cut.c, cut.n[1] * cut.c * lift, cut.n[2] * cut.c];
      const raw = [cut.n[0], cut.n[1] / lift, cut.n[2]];
      const l = Math.hypot(raw[0], raw[1], raw[2]);
      const n: [number, number, number] = [raw[0] / l, raw[1] / l, raw[2] / l];
      cut.n = n;
      cut.c = n[0] * q[0] + n[1] * q[1] + n[2] * q[2];
    }
  }

  const split = own() < 0.4;
  if (!split) {
    rockData(BOULDER_LEVEL, place, cuts, lean, out);
  } else {
    // A frost cleft along a near-vertical joint, off the middle so the halves
    // are not a matched pair, the far half wedged over about its own foot.
    const sa = own() * Math.PI * 2;
    const s: [number, number, number] = [Math.cos(sa), (own() - 0.5) * 0.2, Math.sin(sa)];
    const sl = Math.hypot(...s);
    for (let j = 0; j < 3; j++) s[j] /= sl;
    const off = (own() - 0.5) * 0.4;
    const gap = 0.025 + own() * 0.02;
    rockData(BOULDER_LEVEL, place, [...cuts, { n: s, c: off - gap, dark: true }], lean, out);
    const pivot = new Vector3(s[0] * off, -0.1, s[2] * off);
    const hinge = Vector3.Cross(new Vector3(s[0], 0, s[2]), Vector3.Up());
    let wedge = 0.04 + own() * 0.05;
    const hinged = (a: number) =>
      Matrix.Translation(-pivot.x, -pivot.y, -pivot.z)
        .multiply(Matrix.RotationAxis(hinge, a))
        .multiply(Matrix.Translation(pivot.x, pivot.y, pivot.z));
    // Whichever sign opens the cleft at the top rather than closing it.
    const up = Vector3.TransformCoordinates(pivot.add(new Vector3(0, 1, 0)), hinged(wedge));
    if ((up.x - pivot.x) * s[0] + (up.z - pivot.z) * s[2] < 0) wedge = -wedge;
    rockData(
      BOULDER_LEVEL,
      place,
      [...cuts, { n: [-s[0], -s[1], -s[2]], c: -(off + gap), dark: true }],
      hinged(wedge).multiply(lean),
      out,
    );
  }

  // How far the mass reaches along a bearing at knee height — where a stone
  // lying against it has to be put.
  const footAt = (a: number): number =>
    Math.hypot(rx * Math.cos(a), rz * Math.sin(a)) * 0.9;

  // The shoulder stone, in a corner of the box the egg leaves empty: a small
  // worn stone of its own, sunk to half its height.
  if (own() < 0.5) {
    const r = 0.28 + own() * 0.14;
    const corner =
      Math.atan2(rz, rx) * (own() < 0.5 ? 1 : -1) + (own() < 0.5 ? 0 : Math.PI) + (own() - 0.5) * 0.3;
    const d = footAt(corner) + r * 0.25;
    const stone = wornShape(own, r, r * (0.8 + own() * 0.3), r * 0.9, r * 0.7, r * 0.2, 2, 0.12);
    const sn = unitFrom(own);
    sn[1] = Math.abs(sn[1]) * 0.8 + 0.2;
    const nl = Math.hypot(...sn);
    const stoneCuts: RockCut[] = [
      { n: [sn[0] / nl, sn[1] / nl, sn[2] / nl], c: r * (0.55 + own() * 0.25) },
      { n: [0, -1, 0], c: r * 0.35 },
    ];
    rockData(
      1,
      stone,
      stoneCuts,
      Matrix.RotationY(own() * Math.PI * 2).multiply(
        Matrix.Translation(Math.cos(corner) * d, 0, Math.sin(corner) * d),
      ),
      out,
    );
  }

  // Spalls: flakes frost has taken off the joint faces, lying at the foot of
  // the side they came off, tipped and half in the turf.
  const sides = cuts.filter((c) => c.n[1] >= 0 && c.n[1] < 0.8);
  const flakes = 2 + Math.floor(own() * 3);
  for (let i = 0; i < flakes; i++) {
    const from = sides.length ? sides[i % sides.length].n : unitFrom(own);
    const a = Math.atan2(from[2], from[0]) + (own() - 0.5) * 0.9;
    const d = footAt(a) + 0.08 + own() * 0.28;
    const size = 0.09 + own() * 0.11;
    const points = 5 + Math.floor(own() * 2);
    const outline: Flat[] = [];
    for (let j = 0; j < points; j++) {
      const t = ((j + (own() - 0.5) * 0.5) / points) * Math.PI * 2;
      const rr = size * (0.6 + own() * 0.5);
      outline.push([Math.cos(t) * rr * 1.4, Math.sin(t) * rr]);
    }
    const thick = 0.04 + own() * 0.05;
    const flake = prismData(outline, thick, { plane: "xz", centre: true });
    flake.transform(
      Matrix.RotationYawPitchRoll(own() * Math.PI * 2, (own() - 0.5) * 0.7, (own() - 0.5) * 0.7).multiply(
        Matrix.Translation(Math.cos(a) * d, thick * 0.15, Math.sin(a) * d),
      ),
    );
    out.dark.push(flake);
  }

  const rock = partSurface("boulder", out.skin[0].merge(out.skin.slice(1)), scene);
  rock.material = mats.get(BOULDER);
  if (out.dark.length) {
    const rest = partSurface("boulder-dark", out.dark[0].merge(out.dark.slice(1)), scene);
    rest.parent = rock;
    rest.material = mats.get(BOULDER_DARK);
  }
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
