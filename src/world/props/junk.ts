/**
 * props/junk.ts — The city's own dressing: buildSkip, buildBinPair,
 * buildPalletStack, buildTrafficCone and buildLitter. Part of the scatter set:
 * follows the contract in `./index.ts`.
 */
import { Mesh, Scene } from "@babylonjs/core";
import { partBox, partCylinder } from "../parts";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { DARK_METAL } from "./palette";

// --- the city's own dressing ------------------------------------------------
// Everything below is Coldharbour's, and the palette is deliberately restated
// here rather than imported from `kit/city/` — the scatter set owns its own
// colours and takes nothing from the structure kit, which is what keeps a prop
// placeable without a builder (see `./index.ts`).
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
 * set's shapes are approximations a collider has to be forgiven for — a tree
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
  rng: () => number,
): Mesh {
  const body = partBox(
    "skip",
    { width: 1.9, height: 1.1, depth: 1.2 },
    scene,
  );
  body.position.y = 0.55;
  // A skip is dropped where it fits and never squared to the kerb.
  body.rotation.y = (rng() - 0.5) * 0.24;
  body.material = mats.get(SKIP_PAINT);

  const rim = partBox(
    "skip-rim",
    { width: 2.04, height: 0.12, depth: 1.34 },
    scene,
  );
  rim.parent = body;
  rim.position.y = 0.58;
  rim.material = mats.get(DARK_METAL);

  for (const sx of [-1, 1]) {
    const lug = partBox(
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
  rng: () => number,
): Mesh {
  const root = partBox(
    "bin",
    { width: 0.5, height: 1.0, depth: 0.56 },
    scene,
  );
  root.position.y = 0.5;
  root.rotation.y = (rng() - 0.5) * 0.5;
  root.material = mats.get(BIN_BODY);

  const lid = partBox(
    "bin-lid",
    { width: 0.54, height: 0.08, depth: 0.6 },
    scene,
  );
  lid.parent = root;
  lid.position.y = 0.52;
  lid.material = mats.get(BIN_LID);

  // The second bin, leaning in slightly — a pair nobody lined up.
  const mate = partBox(
    "bin-mate",
    { width: 0.48, height: 0.92, depth: 0.54 },
    scene,
  );
  mate.parent = root;
  mate.position.set(0.56, -0.04, 0.06 + rng() * 0.1);
  mate.rotation.y = (rng() - 0.5) * 0.4;
  mate.material = mats.get(BIN_BODY);

  const mateLid = partBox(
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
  rng: () => number,
): Mesh {
  const root = partBox(
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
    const slat = partBox(
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
  rng: () => number,
): Mesh {
  const base = partBox(
    "cone-base",
    { width: 0.42, height: 0.05, depth: 0.42 },
    scene,
  );
  base.position.y = 0.025;
  base.rotation.y = rng() * Math.PI;
  base.material = mats.get(CONE_ORANGE);

  const body = partCylinder(
    "cone",
    { height: 0.62, diameterTop: 0.06, diameterBottom: 0.3, tessellation: 8 },
    scene,
  );
  body.parent = base;
  body.position.y = 0.33;
  body.material = mats.get(CONE_ORANGE);

  // The reflective band. A cone without one reads as a lump.
  const band = partCylinder(
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
  rng: () => number,
): Mesh {
  const root = partBox(
    "litter",
    { width: 0.24, height: 0.012, depth: 0.19 },
    scene,
  );
  root.position.y = 0.006;
  root.rotation.y = rng() * Math.PI;
  root.material = mats.get(SCRAP_PAPER);

  const scraps = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < scraps; i++) {
    const scrap = partBox(
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

  const can = partCylinder(
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
