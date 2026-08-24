/**
 * Props.ts — Scatter prop factories (trees, gravestones, lanterns, fungus,
 * logs, fire drums, rubble, boulders, brambles, barrels, jungle trees). Pure
 * mesh builders: each assembles at the origin and returns a
 * hierarchy; placement/merging/colliders are the caller's job.
 * Invariants: emissive parts (lantern glow, fire, fungus) MUST set
 * metadata.noOutline (and noGlow where they shouldn't feed the GlowLayer).
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
import { Mesh, MeshBuilder, Scene } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { marksSway } from "./sway";

/**
 * Scatter props for Hollowmere — the loose dressing that fills space between
 * the authored buildings. Harvested from the retired room themes; each builder
 * takes `(scene, mats)` — plus an `rng` where the prop is randomised —
 * assembles a parented primitive hierarchy at the origin, and returns the root.
 * Emissive children are tagged `noOutline` so the outline shell doesn't swallow
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
// Jungle hardwood: paler and greyer than the valley's dead bark — a wet trunk
// under a bright sky, not a charred one under a moon.
const JUNGLE_BARK = "#5b5443";
const LEAF = "#2c5230";
const LEAF_LIT = "#437a3e";
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
 * Dead tree: a leaning bare trunk with a crown of clawing branches. No
 * canopy — the silhouette is all splinters, and moonlight through them is
 * most of what the player sees at distance.
 */
export function buildDeadTree(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const barkMat = mats.get(BARK);
  const trunk = MeshBuilder.CreateCylinder(
    "tree-trunk",
    { height: 5.2, diameterTop: 0.32, diameterBottom: 0.85, tessellation: 6 },
    scene,
  );
  trunk.position.y = 2.6;
  trunk.material = barkMat;
  trunk.rotation.z = (rng() - 0.5) * 0.18;

  const branches = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + rng() * 0.6;
    const h = 1.4 + rng() * 1.4;
    const branch = MeshBuilder.CreateCylinder(
      `branch${i}`,
      { height: h, diameterTop: 0.04, diameterBottom: 0.2, tessellation: 5 },
      scene,
    );
    branch.parent = trunk;
    branch.position.set(
      Math.cos(a) * 0.25,
      0.9 + rng() * 1.4,
      Math.sin(a) * 0.25,
    );
    branch.rotation.z = -Math.cos(a) * (0.7 + rng() * 0.5);
    branch.rotation.x = Math.sin(a) * (0.7 + rng() * 0.5);
    branch.material = mats.get(DEAD_BARK);
  }
  return trunk;
}

/**
 * Living pine: a straight trunk under four stacked cones of needles — the
 * counterpart to `buildDeadTree`, and the only green thing standing in the
 * valley.
 *
 * Two things about the shape are deliberate. The lean is a fifth of the dead
 * tree's, because a dead trunk reads as *failing* and a live one has to read as
 * the thing that hasn't; the whole silhouette is the crown, so a tilt that
 * looks like character on bare branches just looks like a felled pine here.
 * And the lowest tier's skirt starts at 1.8 m, clear of the 1.7 m hit sphere:
 * the collider is the trunk only (see `PROP_BODIES`), so needles hanging at
 * chest height would be foliage you can shoot straight through — the exact
 * complaint the prop bodies were measured to fix.
 */
export function buildPine(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const trunk = MeshBuilder.CreateCylinder(
    "pine-trunk",
    { height: 6.4, diameterTop: 0.3, diameterBottom: 0.62, tessellation: 6 },
    scene,
  );
  trunk.position.y = 3.2;
  trunk.material = mats.get(BARK);
  trunk.rotation.z = (rng() - 0.5) * 0.04;

  // Centre height, cone height, bottom and top diameters. The top tier closes
  // to a point; the rest are truncated so each tier's skirt overhangs the one
  // above it and the crown steps rather than tapering smoothly.
  const tiers: [number, number, number, number][] = [
    [2.9, 2.2, 3.3, 1.9],
    [4.1, 2.0, 2.6, 1.4],
    [5.2, 1.7, 1.9, 0.9],
    [6.1, 1.4, 1.1, 0],
  ];
  tiers.forEach(([y, h, bottom, top], i) => {
    const tier = MeshBuilder.CreateCylinder(
      `pine-tier${i}`,
      {
        height: h * (0.9 + rng() * 0.2),
        diameterTop: top,
        diameterBottom: bottom,
        tessellation: 7,
      },
      scene,
    );
    tier.parent = trunk;
    // Local to the trunk's centre, so the tiers ride its lean.
    tier.position.set((rng() - 0.5) * 0.12, y - 3.2, (rng() - 0.5) * 0.12);
    tier.rotation.y = rng() * Math.PI * 2;
    // Moonlight only reaches the top of the crown — and passes THROUGH it,
    // which is why the needles are translucent rather than merely a lighter
    // green: a pine with the moon behind it should have a lit edge, and a
    // stand of them between you and the moon should read as a screen you are
    // seeing light past rather than as a row of black cones. The material is
    // one per colour either way, so this costs no extra draw call.
    tier.material = mats.getTranslucent(
      i < 2 ? NEEDLE : NEEDLE_LIT,
      CONFIG.graphics.translucency.foliage,
    );
    // The needles lean and the trunk does not — see `world/sway.ts`. A tier is
    // a cone centred ON the axis and up to 1.65 m across, so the few
    // centimetres this height is entitled to are spent well inside the overlap
    // and the crown never comes off the bole.
    marksSway(tier, "canopy");
  });
  return trunk;
}

/**
 * Hedgerow ash: a pale bole running clear to head height and above it, a
 * spreading crown of broad leaf carried on three short limbs — the temperate
 * BROADLEAF, and the counterpart to the pine in the same way the jungle
 * hardwood is the counterpart to nothing.
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
 * Three things about the shape are load-bearing rather than decorative:
 *
 * - **The lowest leaf hangs at ~3.6 m**, twice clear of the 1.7 m hit sphere.
 *   The collider is the trunk only (see `PROP_BODIES`) — the pine's rule, and
 *   the reason the crown is carried high on a bole rather than skirted down
 *   toward the grass where it would be foliage rounds pass straight through.
 *   That figure is the worst CORNER rather than the tier: the skirt's slabs
 *   are centred at 5.8 m, and one rolled and tipped to its limits puts a
 *   corner 2.2 m under its own middle. It survives scaling, since the whole
 *   crown is `3.6 * scale` — a region has to be dragged under ~0.47 before
 *   leaf reaches the sphere, and the layout's floor is 0.8.
 * - **The crown is PLATES CENTRED ON THE AXIS**, four tiers of them, which is
 *   `buildJungleTree`'s measured result taken at face value: a plate covers
 *   about four times the sky per triangle that a radiating blade does, and a
 *   crown is mass before it is edge. What the tiers buy over one rosette is
 *   the ROUNDNESS — each is narrower and shorter than the one below, so the
 *   silhouette closes toward the top instead of ending in a parasol's rim.
 * - **The limbs stop INSIDE the leaf**, and the two numbers are set against
 *   each other rather than eyeballed. A tip reaches 1.39 m from the axis, at
 *   the height the skirt's slabs pass through; a slab is 3.6 m deep and the
 *   per-plate variation below floors that at 3.1, so the inscribed circle of
 *   the SMALLEST one is 1.55 m and a tip is inside it by 0.16 m — against the
 *   0.12 m the crown drifts in the wind at that height. That is what makes it
 *   safe for the crown to sway while the limbs holding it do not: the join
 *   cannot come out of the leaf. Cut the depth or lengthen a limb and it can.
 *   See `world/sway.ts` for why the limbs are not marked themselves — a limb
 *   is a long thin thing lying along the ramp, which is the one shape a vertex
 *   ramp cannot bend honestly, and it is the trunk's argument at half the
 *   length.
 *
 * Nothing here is scaled non-uniformly, for the reason `buildJungleTree`
 * states: `renderOutline` extrudes along vertex normals without renormalising
 * them, so a squashed part grows a lopsided ink shell.
 */
export function buildAshTree(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const bark = mats.get(ASH_BARK);
  const trunk = MeshBuilder.CreateCylinder(
    "ash-trunk",
    { height: 8.6, diameterTop: 0.3, diameterBottom: 0.76, tessellation: 6 },
    scene,
  );
  trunk.position.y = 4.3;
  trunk.material = bark;
  // A standard left in a hedge grows up rather than out — the pine's lean, and
  // for the pine's reason: the silhouette is the crown, so a tilted bole reads
  // as a tree coming down rather than as one with character.
  trunk.rotation.z = (rng() - 0.5) * 0.05;

  // The fork: three limbs leaving the bole at 3.6 m and spreading to 1.39 m
  // off the axis. Short on purpose (see the header) — what is meant to be
  // visible is the metre and a half of each one below the skirt, which is what
  // says the crown is carried rather than stacked.
  const limbs = 3;
  const limbTurn = rng() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + limbTurn + (rng() - 0.5) * 0.3;
    const tilt = 0.5 + rng() * 0.1;
    const len = 2.6;
    const limb = MeshBuilder.CreateBox(
      `ash-limb${i}`,
      { width: 0.3, height: len, depth: 0.26 },
      scene,
    );
    limb.parent = trunk;
    // Local to the trunk's centre: -0.7 puts the foot at 3.6 m. `rotation.y`
    // turns the limb's own +Z out along the bearing, and `rotation.x` then
    // leans its top that way, so the two are read in the limb's frame — the
    // canopy plates' convention, one level down.
    const rc = 0.14 + Math.sin(tilt) * (len / 2);
    limb.position.set(
      Math.sin(a) * rc,
      -0.7 + Math.cos(tilt) * (len / 2),
      Math.cos(a) * rc,
    );
    limb.rotation.y = a;
    limb.rotation.x = tilt;
    limb.material = bark;
  }

  // The crown: four tiers narrowing upward. Count, height on the trunk, width,
  // depth, thickness — the widest is the SKIRT the limbs die inside, and the
  // 1-plate cap is what stops the top being a flat lid.
  const tiers: [number, number, number, number, number][] = [
    [4, 1.5, 6.8, 3.6, 1.5],
    [3, 2.8, 5.6, 3.0, 1.5],
    [3, 4.0, 4.0, 2.4, 1.3],
    [1, 4.9, 2.6, 2.0, 1.0],
  ];
  tiers.forEach(([count, y, width, depth, thick], tier) => {
    const turn = rng() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + turn + rng() * 0.3;
      // Per PLATE rather than per tier, and this is what stops the crown
      // reading as a stack of slabs: four identical boxes at four bearings
      // draw one silhouette with four straight edges in it, and a sixth of
      // variation in each is enough to break every one of them.
      const vary = 0.86 + rng() * 0.28;
      const plate = MeshBuilder.CreateBox(
        `ash-leaf${tier}-${i}`,
        { width: width * vary, height: thick, depth: depth * vary },
        scene,
      );
      plate.parent = trunk;
      // Centred ON the axis rather than out from it, so a tier is a rosette
      // with no hole in its middle and a limb tip lands inside one whatever
      // bearing it left on.
      plate.position.y = y;
      plate.rotation.y = a;
      // Relief, in the plate's own frame after the yaw: `z` rolls it about its
      // long axis and `x` tips it along its depth. The skirt gets the most of
      // both — a drooping lower tier is most of what separates a hardwood
      // crown from a hedge on a stick.
      plate.rotation.z = (rng() - 0.5) * (tier === 0 ? 0.56 : 0.4);
      plate.rotation.x = (rng() - 0.5) * (tier === 0 ? 0.4 : 0.28);
      // The lit green upward, the shaded green under — a crown never shows the
      // ground what it shows the sky. Split by TIER rather than by index, so
      // the two lower ones read as the mass and the two upper as what the sun
      // is actually on.
      plate.material = mats.getTranslucent(
        tier < 2 ? ASH_LEAF : ASH_LEAF_LIT,
        CONFIG.graphics.translucency.canopy,
      );
      marksSway(plate, "canopy");
    }
  });
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

/**
 * Jungle hardwood: a buttressed trunk running bare for two storeys and then
 * spreading into a canopy of broad fronds. The tall counterpart to the pine —
 * where a pine is a cone you see the whole of, this is a column with the
 * foliage held above the fight, so a stand of them closes the sky without
 * closing the sight lines under it.
 *
 * Three things about the shape are load-bearing rather than decorative:
 *
 * - **The lowest leaf hangs at ~9 m**, five times clear of the 1.7 m hit
 *   sphere. The collider is the trunk and its buttress core only (see
 *   `PROP_BODIES`), so anything at chest height would be foliage rounds pass
 *   straight through — the pine's rule, and a canopy tree has far more leaf to
 *   get it wrong with.
 * - **The buttresses stay inside 1.0 m of the axis**, which is the collider's
 *   own half-width, so the flare a player walks up to is the flare that stops
 *   them. They are what makes the trunk read as tropical at all; a bare
 *   cylinder of this height is a telegraph pole.
 * - **The fronds are two segments, not one**, and the outer one droops harder.
 *   A single straight blade reads as a plank at any distance the fog leaves
 *   visible; the break is where the whole silhouette comes from.
 * - **The shade is the PLATES' and the silhouette is the FRONDS'**, and the
 *   split is what makes a closed canopy affordable at all. See the crown
 *   below, which carries the measurement that forced it.
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
  const trunk = MeshBuilder.CreateCylinder(
    "jungle-trunk",
    { height: 11.2, diameterTop: 0.42, diameterBottom: 1.0, tessellation: 6 },
    scene,
  );
  trunk.position.y = 5.6;
  trunk.material = bark;
  // A hardwood carries its own weight — a fifth of the pine's already-slight
  // lean, and only enough that a stand of them is not a row of posts.
  trunk.rotation.z = (rng() - 0.5) * 0.05;

  // Buttress roots. Thin radial fins, leaning their tops into the trunk so the
  // flare widens toward the ground the way a real one does.
  const fins = 3;
  const finTurn = rng() * Math.PI * 2;
  for (let i = 0; i < fins; i++) {
    const a = (i / fins) * Math.PI * 2 + finTurn;
    const fin = MeshBuilder.CreateBox(
      `jungle-buttress${i}`,
      { width: 0.2, height: 2.3 + rng() * 0.5, depth: 1.1 },
      scene,
    );
    fin.parent = trunk;
    // Local to the trunk's centre: -5.6 is its foot.
    fin.position.set(Math.sin(a) * 0.42, -4.5, Math.cos(a) * 0.42);
    fin.rotation.y = a;
    fin.rotation.x = -0.16;
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
  const plates: [number, number, number, number][] = [
    // count, height on the trunk, width, depth
    [4, 4.35, 7.6, 3.0],
    [3, 5.15, 5.6, 2.5],
  ];
  plates.forEach(([count, y, width, depth], tier) => {
    const turn = rng() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + turn + rng() * 0.3;
      const plate = MeshBuilder.CreateBox(
        `jungle-leaf${tier}-${i}`,
        { width, height: tier === 0 ? 0.55 : 0.45, depth },
        scene,
      );
      plate.parent = trunk;
      // Centred ON the axis rather than out from it: a plate is a slab of
      // canopy the trunk holds up through its middle, so four of them at
      // 90 degrees are a rosette with no hole in it. Fronds are what sit out
      // at a radius, below.
      plate.position.y = y;
      plate.rotation.y = a;
      // Relief, so the mass is not a flat lid. `rotation.z` rolls the plate
      // about its own long axis and `rotation.x` tips it along its depth —
      // both after the yaw, so both are in the plate's own frame.
      plate.rotation.z = (rng() - 0.5) * 0.26;
      plate.rotation.x = (rng() - 0.5) * 0.18;
      // The lit green goes up, the shaded green goes down: what a canopy shows
      // the sky is never what it shows the ground beneath it.
      plate.material = mats.getTranslucent(
        tier === 0 ? LEAF : LEAF_LIT,
        CONFIG.graphics.translucency.canopy,
      );
      // The whole crown is what the wind moves, and the trunk under it is not
      // — `world/sway.ts` carries the argument, and the geometry that makes it
      // safe is here: a plate is centred on the axis and metres across, so the
      // third of a metre it drifts is inside its own overlap of the bole.
      marksSway(plate, "canopy");
    }
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
  // them — so a frond costs 1,400 boxes wherever it is added, and the ring
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
      const blade = MeshBuilder.CreateBox(
        `jungle-frond${ring}-${i}`,
        { width, height: 0.14, depth: len },
        scene,
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
      blade.material = mats.getTranslucent(
        ring === 0 ? LEAF : LEAF_LIT,
        CONFIG.graphics.translucency.canopy,
      );
      // With the plates, and at the same height, so the crown travels as one
      // piece rather than the fronds shearing off the mass they break the edge
      // of. The tip below inherits it for the same reason.
      marksSway(blade, "canopy");

      // The drooping tip, hung off the blade's own far end so it rides the
      // parent's yaw and tilt. Its centre is derived from its own break angle
      // rather than authored: a fixed offset leaves the joint open at one
      // angle and the two segments overlapping at another.
      //
      // **Only on the LOWER ring**, which is the one break in the "two
      // segments, not one" rule and is a fact about where the ring sits rather
      // than a saving taken off it. The upper ring is 0.85 m higher and its
      // blades are shorter, so its tip breaks over INSIDE the mass the lower
      // ring and the plates already make: it is drawn against leaf from below
      // and against leaf from above, and the only silhouette it was ever in is
      // the lower ring's. Fourteen hundred trees, so that is 1,400 boxes drawn
      // for an edge nothing can see.
      if (ring === 0) {
        const brk = 0.5 + rng() * 0.3;
        const tipLen = len * 0.8;
        const tip = MeshBuilder.CreateBox(
          `jungle-tip${ring}-${i}`,
          { width: width * 0.72, height: 0.12, depth: tipLen },
          scene,
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
  // is more triangles than the tree it hangs on), so the number is worth
  // getting right twice over.
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
 * Fern clump: a low crown of arching fronds, each broken into two segments the
 * same way a canopy tree's are.
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
 */
export function buildFernClump(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const crown = MeshBuilder.CreateCylinder(
    "fern-crown",
    { height: 0.3, diameterTop: 0.26, diameterBottom: 0.4, tessellation: 5 },
    scene,
  );
  crown.position.y = 0.15;
  crown.material = mats.get(LEAF);

  // MANY blades, and SHORT ones. Both numbers are the difference between a
  // fern and an agave: the canopy tree's fronds are 2.0-2.4 m and read as a
  // canopy because they are nine metres up, but the same blade at ankle height
  // is a plank lying in the dirt — which is what the first pass looked like.
  // A clump reads as foliage from the count of edges in its silhouette, not
  // from the size of any one leaf.
  const blades = 7 + Math.floor(rng() * 4);
  const turn = rng() * Math.PI * 2;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + turn + rng() * 0.3;
    const len = 0.72 + rng() * 0.3;
    const blade = MeshBuilder.CreateBox(
      `fern-blade${i}`,
      { width: 0.3, height: 0.07, depth: len },
      scene,
    );
    blade.parent = crown;
    blade.position.set(Math.sin(a) * len * 0.42, 0.42, Math.cos(a) * len * 0.42);
    blade.rotation.y = a;
    // Negative: a frond leaves the crown climbing, then breaks over.
    blade.rotation.x = -0.5 - rng() * 0.25;
    blade.material = mats.getTranslucent(
      i % 2 === 0 ? LEAF_LIT : LEAF,
      CONFIG.graphics.translucency.canopy,
    );
    // The understory layer, which is the one the player walks THROUGH — so the
    // ramp matters here in a way it does not nine metres up: a blade leaves its
    // crown at 0.42 m with four centimetres of travel, and breaks over at 0.7 m
    // with ten. The crown itself is not marked, because a fern's root ball is
    // the one part of it that is genuinely planted — and four centimetres is
    // lost inside a crown 0.3 m across.
    marksSway(blade, "understory");

    // The drooping tip, hung off the blade's far end with its centre derived
    // from its own break angle — buildJungleTree's frond, at a third the size.
    const brk = 0.8 + rng() * 0.4;
    const tipLen = len * 0.75;
    const tip = MeshBuilder.CreateBox(
      `fern-tip${i}`,
      { width: 0.22, height: 0.06, depth: tipLen },
      scene,
    );
    tip.parent = blade;
    tip.rotation.x = brk;
    tip.position.set(
      0,
      (-Math.sin(brk) * tipLen) / 2,
      len / 2 + (Math.cos(brk) * tipLen) / 2,
    );
    tip.material = blade.material;
    marksSway(tip, "understory");
  }
  return crown;
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
  flame.metadata = { noOutline: true };

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
    cap.metadata = { noOutline: true };
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

  const fire = MeshBuilder.CreateCylinder(
    "drum-fire",
    { height: 0.95, diameterTop: 0.06, diameterBottom: 0.72, tessellation: 6 },
    scene,
  );
  fire.parent = drum;
  fire.position.y = 0.9;
  fire.material = mats.getEmissive("#ff8a2a");
  fire.metadata = { noOutline: true };
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
