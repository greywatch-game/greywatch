/**
 * props/deadTree.ts — buildDeadTree: the stag-headed snag. Part of the scatter
 * set: follows the contract in `./index.ts`.
 */
import { Matrix, Mesh, Scene, VertexData } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { partSurface } from "../parts";
import { mulberry32 } from "../rng";
import { type Flat, loftData, prismData, type Ring } from "./geometry";
import { BARK, DEAD_BARK } from "./palette";

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
