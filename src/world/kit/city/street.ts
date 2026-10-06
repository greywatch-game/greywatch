/**
 * kit/city/street.ts — The street furniture that makes a roadway read as one:
 * buildBarrier, buildQuay, buildCar and buildStreetLight. Part of the downtown
 * set: follows the contract in kit/core.ts and the set's rules in
 * `./index.ts` — a street light carries a lens always and a light only when
 * a layout marks it `lit`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Structure,
  ALLOY,
  ASPHALT,
  CONCRETE,
  DARK_CONCRETE,
  ENAMEL,
  KERB,
  KERB_WORN,
  LAMP_RED,
  LAMP_SODIUM,
  ROAD_PAINT,
} from "../core";

/**
 * A run of jersey barrier: roadworks, a closed lane, a checkpoint that was.
 *
 * Chest-high cover you can put anywhere, and the one piece of city furniture
 * whose whole job is to break an avenue's sightline at the ground plane. The
 * taper is two boxes rather than a chamfered profile; at 0.9 m it is read as a
 * silhouette from eye height and never from the side.
 */
export function buildBarrier(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "barrier");
  const len = p.length ?? 6;
  const h = 0.9;
  const units = Math.max(1, Math.round(len / 3));
  for (let i = 0; i < units; i++) {
    const z = -len / 2 + (i + 0.5) * (len / units);
    const unit = len / units - 0.1;
    b.box(0.62, 0.34, unit, 0, 0.17, z, CONCRETE);
    b.box(0.36, h - 0.34, unit, 0, 0.34 + (h - 0.34) / 2, z, CONCRETE);
  }
  b.block({ w: 0.62, h, d: len, x: 0, y: h / 2, z: 0 });
  return b;
}


/**
 * A QUAY: the retaining mass a waterfront city stands on, the parapet along its
 * edge and the bollards behind it. Runs along local X with the WATER on local
 * -Z, which is the kit's front.
 *
 * **It is a RETAINING wall, so the thing it is built against is the floor and
 * not the water.** The mass hangs DOWN from the placement's own ground plane —
 * the deck's top face is y = 0 — and a map lays it exactly where its
 * heightfield falls away, so the street carries on over the drop instead of
 * stopping at a lip. That is the whole reason this is a structure rather than
 * a terrace: a terrace stands ON the ground and this one stands IN a hole in
 * it, and everything below the coping is there to be seen from a boat.
 *
 * **The parapet is a `Build.guard` and it is load-bearing in the literal
 * sense**: there is no swimming in this game, so a frontage a body can walk
 * off is a body underwater on the seabed with the leash counting down. It is
 * also the one thing here that has to be CONTINUOUS — a 40 m run with a gap
 * between it and the next one is a gap somebody finds — so a caller lays these
 * end to end at exactly `length` apart and the pedestals fall where they fall.
 *
 * **The bollards are `strut`s and the coping and the pedestals are neither.**
 * A bollard is iron a round stops on and no part of a body's problem, which is
 * the pair `Build.strut` exists for; a coping cap is 14 cm of stone on top of
 * a rail whose collider already owns that line, and giving it one of its own
 * would put a second box round the thing the guard is already standing off the
 * edge to avoid.
 */
export function buildQuay(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "quay");
  const len = p.length ?? 40;
  /** How far the deck reaches out over the water from the ground's own edge. */
  const deck = p.depth ?? 4;
  /** How far the face reaches below the deck — under the bed, not down to it. */
  const drop = p.height ?? 6;
  /** Chest-high, and deliberately under `cover.crouchHeight` — see the layout. */
  const PARAPET = 1.0;

  // The mass. Top face at y = 0, so it is the street continuing rather than a
  // step onto something; one collider, because a body only ever meets its top.
  b.box(len, drop, deck, 0, -drop / 2, -deck / 2, CONCRETE);
  b.block({ w: len, h: drop, d: deck, x: 0, y: -drop / 2, z: -deck / 2 });

  // The parapet, standing outboard of the seaward face for `Build.guard`'s own
  // reason, and the coping cap over it — wider than the rail, which is what
  // stops 0.16 m of collider reading as a sheet of card on edge.
  b.guard("-z", -deck, 0, len, 0, { height: PARAPET, color: CONCRETE });
  b.box(len, 0.16, 0.72, 0, PARAPET + 0.08, -deck - 0.08, KERB_WORN);

  // Pedestals at the quarter points: the parapet's own rhythm, and the thing
  // that makes a 40 m run read as built rather than extruded.
  for (let i = 1; i < 4; i++) {
    const x = -len / 2 + (i * len) / 4;
    b.box(0.72, PARAPET + 0.3, 0.66, x, (PARAPET + 0.3) / 2, -deck - 0.08, CONCRETE);
    b.box(0.86, 0.16, 0.8, x, PARAPET + 0.38, -deck - 0.08, KERB_WORN);
  }

  // Mooring bollards, set back a metre and a half so there is room to work a
  // rope round one, and a course of kerb along the back of the deck where the
  // paving changes.
  for (let i = 0; i < 4; i++) {
    const x = -len / 2 + (i + 0.5) * (len / 4);
    b.strut(0.3, 0.62, 0.3, x, 0.31, -deck + 1.5, ALLOY);
    b.cyl(0.17, 0.52, 0.38, 8, x, 0.7, -deck + 1.5, ALLOY);
  }
  b.box(len, 0.06, 0.5, 0, 0.03, -0.25, KERB);
  return b;
}

/**
 * A parked car, along its own local X, nose at +X.
 *
 * Its collider is the BODY and not the silhouette: one box a metre high, and
 * 1.0 m of steel is something to fight from beside — under `cover.crouchHeight`
 * (1.3), so it steers a bot without protecting one — while the cabin above it
 * is glass a round goes through. That is the gravestone's lesson — a box squared off to
 * the silhouette stops rounds through the parts of it that are not there — and
 * the box here is EXACTLY the one this model replaced, which is what makes all
 * of the below a drawing change: the cover, the nav graph, the cover bake and
 * every ray in the game see what they saw before. The greenhouse, the door
 * mirrors and two centimetres of rub strip are the only geometry outside it,
 * and the first two are above it rather than beside it. Everything else is
 * inside on purpose: the bumpers are the ENDS of the car rather than proud of
 * it, so the spark lands where the panel is.
 *
 * **The shape is three volumes and a step, and the step is the wheel arch.**
 * Below `arch` the body is 26 cm narrower than it is above, which leaves a
 * channel down each side for the tyres to stand in with the full-width panel
 * over them; the bonnet and the boot are lower than the beltline between them,
 * which is the profile that stops a car reading as a brick. A box kit cannot
 * cut an arc, so the arch is a change of WIDTH rather than a cut-out, and that
 * is the one trick the whole model rests on.
 *
 * **The windscreen and the backlight are raked, and they are the reason
 * `Build.pane` has a `rotZ` at all.** A sloped sheet lands in a different cel
 * band from the flat panels either side of it, which is what a cabin reads as;
 * upright, the same glass is a box on a box, which is what this was. Both are
 * spanned between two points on the profile by `span()` so the pillars drawn
 * along their edges cannot disagree with them — the A- and C-pillars take the
 * screen's own centre, length and tilt.
 *
 * **The greenhouse is glazing rather than `breakable` panes**, and at four
 * sheets a car that argument is now four times as strong. A cabin is empty but
 * it is not somewhere anybody gets into: a round already crosses it and comes
 * out the far side, so breaking it would buy an effect and nothing else — and
 * it would put a hundred-odd sheets in the pane list, the sweep, the bake and
 * the wire to do it. See `PaneSpec.breakable`. It is also why `rotZ` and
 * `breakable` are mutually exclusive and nothing here is inconvenienced by it.
 *
 * **Five materials, and one colour the map did not already have.** The tyres,
 * the underbody, the grille and the exhaust are `ASPHALT` — the roadway's own
 * colour; the hubs, the lamps and the plate are `ROAD_PAINT`, the lane
 * markings'; the bumpers and the rub strip are `DARK_CONCRETE`. All three are
 * drawn already in any block with a street in it, so a car merges into meshes
 * the block was going to draw anyway and only `LAMP_RED` is a group of its
 * own. Measured over Coldharbour's twenty-six: the whole model costs the map
 * **eighteen** merged meshes and 21k vertices, and not one solid mesh — 783
 * before and 783 after.
 */
export function buildCar(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "car");
  const paint = p.tint ?? ENAMEL;
  const len = 4.4;
  const wide = 1.86;

  // The three heights everything hangs off. `belt` is the top of the steel AND
  // the top of the collider — the panel a round stops on is the panel the box
  // is measured to — `arch` is the tyre's top plus clearance, and `sill` is
  // where the bodywork stops and the shadow under the car starts.
  const sill = 0.42;
  const arch = 0.74;
  const belt = 1.1;
  const glassTop = 1.46;
  const roofTop = 1.54;

  // The X profile: where the bumper takes over from the panel, where the
  // windscreen stands up off the beltline, and where the backlight comes down.
  const nose = len / 2 - 0.18;
  const cowl = 0.55;
  const backlight = -1.32;
  const wheelX = 1.42;
  const wheelZ = 0.8;
  const tyre = 0.68;
  // Between the wheels the body is this wide and no wider: the tyres stand in
  // the 13 cm it leaves each side and come out flush with the panel above.
  const waist = 1.6;

  /** A sheet spanning two points of the X/Y profile: centre, length and rake. */
  const span = (x0: number, y0: number, x1: number, y1: number) => ({
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    len: Math.hypot(x1 - x0, y1 - y0),
    rot: { z: Math.atan2(y1 - y0, x1 - x0) },
  });
  const screen = span(cowl, belt, 0.1, glassTop);
  const rear = span(backlight, belt, -0.92, glassTop);

  // --- the steel, bottom up -------------------------------------------------
  b.box(nose * 2, arch - sill, waist, 0, (sill + arch) / 2, 0, paint);
  b.box(
    cowl - backlight,
    belt - arch,
    wide,
    (cowl + backlight) / 2,
    (arch + belt) / 2,
    0,
    paint,
  );
  // The bonnet falls 6 cm over its length. Tilting the whole box rather than
  // stepping it is what puts a lit face on the nose: two flat tops at two
  // heights are the same cel band twice.
  b.box(nose - cowl, 0.28, wide, (nose + cowl) / 2, 0.85, 0, paint, {
    z: -0.04,
  });
  // The boot is a step down and not a slope — a saloon's tail is flat.
  b.box(nose + backlight, 0.3, wide, (backlight - nose) / 2, 0.89, 0, paint);
  b.box(
    screen.x - rear.x + 0.04,
    roofTop - glassTop,
    1.68,
    (screen.x + rear.x) / 2,
    (glassTop + roofTop) / 2,
    0,
    paint,
  );

  // --- the greenhouse -------------------------------------------------------
  // What is INSIDE it comes first, and it is not a detail: glass is
  // see-through, so an empty greenhouse is a window onto whatever stands on
  // the far side of the street and the whole cabin reads as an open frame with
  // a plank over it.
  //
  // It is THREE masses and not one, and that is the whole of what makes them
  // an interior. A single box at seat height fills the windscreen and the
  // backlight with its own end face — a flat wall a hand behind the glass,
  // which is a solid block in the window rather than a car with somebody's
  // seats in it. So the dash and the parcel shelf are one low plane that stops
  // 23 cm above the beltline, and the seat backs are two thin masses standing
  // off it: what you see through the screen is a surface, a seat, and daylight
  // over the top of it, which is what looking into a car looks like.
  b.box(1.8, 0.13, 1.42, -0.4, 1.165, 0, ASPHALT);
  b.box(0.13, 0.21, 1.24, -0.1, 1.285, 0, ASPHALT);
  b.box(0.13, 0.19, 1.24, -0.8, 1.275, 0, ASPHALT);
  // Two raked sheets and a flank each side, inset 12 cm from the body so the
  // pillars have something to stand on. The side glass runs the whole cabin
  // and the B-pillar is drawn over it: one sheet with a post in front of it is
  // the same picture as two sheets, at half the glazing.
  b.pane(screen.len, 0.05, 1.62, screen.x, screen.y, 0, { rotZ: screen.rot.z });
  b.pane(rear.len, 0.05, 1.62, rear.x, rear.y, 0, { rotZ: rear.rot.z });
  // The rear quarter is a PANEL and not a post. A saloon's C-pillar is sheet
  // metal a hand wide, and a bar there left the cabin reading as a frame with
  // a plank across it — glass on three sides and daylight through all of them.
  // It is pushed half its width forward off the backlight's own line so its
  // back face IS that line, rather than hanging out over the boot; the side
  // glass runs on underneath and is simply inside the panel, which the depth
  // test hides for nothing.
  const quarter = 0.22;
  const qx = rear.x + (Math.sin(rear.rot.z) * quarter) / 2;
  const qy = rear.y - (Math.cos(rear.rot.z) * quarter) / 2;
  for (const sz of [-1, 1]) {
    b.pane(
      1.39,
      glassTop - belt,
      0.05,
      -0.395,
      (belt + glassTop) / 2,
      sz * 0.81,
    );
    b.box(
      screen.len,
      0.1,
      0.07,
      screen.x,
      screen.y,
      sz * 0.815,
      paint,
      screen.rot,
    );
    b.box(rear.len, quarter, 0.07, qx, qy, sz * 0.815, paint, rear.rot);
    b.box(
      0.1,
      glassTop - belt,
      0.07,
      -0.36,
      (belt + glassTop) / 2,
      sz * 0.815,
      paint,
    );
    // Door mirrors. They are the one thing here outside the collider in Z, and
    // they get away with it by being above it: at 1.16 m they are in the same
    // air the cabin is, which a round has always crossed.
    b.box(0.1, 0.09, 0.16, cowl - 0.14, belt + 0.11, sz * 0.96, paint);
  }

  // --- wheels ---------------------------------------------------------------
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl(0.24, tyre, tyre, 12, sx * wheelX, tyre / 2, sz * wheelZ, ASPHALT, {
        x: Math.PI / 2,
      });
      b.cyl(
        0.26,
        0.34,
        0.34,
        8,
        sx * wheelX,
        tyre / 2,
        sz * wheelZ,
        ROAD_PAINT,
        {
          x: Math.PI / 2,
        },
      );
    }
  }
  // Closes the gap under the sill: without it a car is a shape standing on
  // four legs with the road visible through it from twenty metres away.
  b.box(3.4, 0.16, waist - 0.06, 0, 0.34, 0, ASPHALT);

  // --- the ends -------------------------------------------------------------
  for (const sx of [-1, 1]) {
    b.box(
      len / 2 - nose,
      0.28,
      1.8,
      (sx * (len / 2 + nose)) / 2,
      0.57,
      0,
      DARK_CONCRETE,
    );
    b.box(3.0, 0.05, 0.04, -0.15, 0.83, sx * 0.93, DARK_CONCRETE);
  }
  b.box(0.05, 0.16, 0.74, nose, 0.85, 0, ASPHALT);
  b.box(0.04, 0.13, 0.4, -nose - 0.02, 0.86, 0, ROAD_PAINT);
  b.cyl(0.12, 0.09, 0.09, 6, -nose - 0.04, 0.34, -0.5, ASPHALT, {
    z: Math.PI / 2,
  });
  // Lamps, unlit metal and a flat lens rather than a glow, and this stays true
  // at any hour: a PARKED car does not have its lights on. Twenty-six of them
  // that did would be fifty-two emissive meshes in the bloom saying nothing —
  // which is a different argument from the street lamps' overhead, and it is
  // why they gained a lens when the map's hour dropped and these did not.
  for (const sz of [-1, 1]) {
    b.box(0.06, 0.18, 0.42, nose, 0.85, sz * 0.6, ROAD_PAINT);
    b.box(0.06, 0.2, 0.36, -nose, 0.87, sz * 0.62, LAMP_RED);
  }

  b.block({ w: len, h: 1.1, d: wide, x: 0, y: 0.55, z: 0 });
  return b;
}

/**
 * A street lamp: an alloy column with a cantilevered head over the roadway.
 *
 * It carries NO light, and that is the set's header's argument rather than an
 * omission — under a daylit sky there is nothing for one to do, and a fixture
 * light always wins one of the sixteen shader slots whether or not it is
 * adding anything.
 *
 * **The lens is not emissive either, and that was a fix rather than a
 * simplification.** It was a `glow` at a tenth of a lantern's strength, on the
 * argument that the head should still read at distance — and the glow
 * does not scale with the sky: a pale emissive against a bright afternoon
 * blooms to a hard white disc, so every junction on the map had a lamp burning
 * in broad daylight. What reads at distance instead is the SILHOUETTE, which is
 * what a cantilevered arm against the sky already is.
 */
export function buildStreetLight(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "streetlight");
  const h = p.height ?? 7.5;
  const reach = 2.2;
  b.cyl(h, 0.16, 0.3, 8, 0, h / 2, 0, ALLOY);
  b.box(reach, 0.16, 0.16, reach / 2, h - 0.1, 0, ALLOY);
  b.box(0.9, 0.18, 0.42, reach, h - 0.24, 0, ALLOY);
  // The lens, and it is `glow` rather than a flat tone for the reason the whole
  // fixture argument turns on: an emissive box costs no light slot, takes the
  // glow's bloom, and is faded per pixel by `EmissiveFog` like everything
  // else `getEmissive` hands out. Sodium orange rather than a pale white — a
  // pale lens against a lit sky blooms to a hard white disc, which is why the
  // lens was left off this model in the first place; a saturated one reads as a
  // lamp at any hour and goes to the fog with the rest of the skyline.
  b.glow(0.7, 0.06, 0.3, reach, h - 0.35, 0, LAMP_SODIUM);
  // And the light itself, only where the map asks. See `BuildParams.lit`: the
  // lens says the lamp is on and this says the shader can afford to prove it.
  // Steady — a sodium lamp does not flicker, and the term exists for flame.
  if (p.lit) b.light(LAMP_SODIUM, 16, 0.9, 0, reach, h - 0.5, 0);
  b.block({ w: 0.4, h, d: 0.4, x: 0, y: h / 2, z: 0 });
  return b;
}
