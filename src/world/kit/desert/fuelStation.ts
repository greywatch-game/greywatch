/**
 * kit/desert/fuelStation.ts — buildFuelStation: a 1990s petrol station on a
 * highway at the edge of a desert town — a flat canopy on steel columns over
 * two pump islands, a concrete kiosk at the back, a pole sign at the road.
 * Part of the desert-town set: follows the contract in kit/core.ts and the
 * set's rules in `./index.ts`. Invariants: the forecourt is open to -Z (the
 * road); colliders in the set's order — islands, kiosk, the column struts,
 * then the canopy last because nobody stands on it; no light (the map's rule);
 * seeded off its params, never `Math.random()`. Never imports another
 * builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  ALLOY,
  AWNING,
  ASPHALT,
  Build,
  CONCRETE,
  DARK_CONCRETE,
  ENAMEL,
  GLASS,
  IRON,
  RUST,
  limb,
  type BuildParams,
  type Structure,
} from "../core";
import { SANDBAG, SCORCH, WHITEWASH, WINDOW_VOID, clothHash } from "./shared";

/** How high the canopy's underside stands: a lorry's cab clears it. */
const CLEAR = 4.6;
/** The canopy's fascia: deep enough to carry the band and the lettering. */
const FASCIA = 0.75;
/** Pump-island kerb height, and the island's collider (crouch cover). */
const KERB = 0.2;
const ISLAND_COVER = 1.1;

/**
 * The fuel station.
 *
 * ## What it is FOR
 *
 * **It is what a highway at the edge of a town in this part of the world
 * has, and nothing else on the map says "road" as plainly.** The old town is
 * mud and the new town is cement, and the asphalt running out past both into
 * the desert needs one thing standing beside it that only a road would put
 * there. A canopy on four columns is also a silhouette no other piece in the
 * kit makes — a flat lid four and a half metres up with daylight under it —
 * so it reads from the next quarter.
 *
 * In play it is a SHELTER rather than a building: the canopy stops rounds
 * from above and hides a body from anybody on a roof, the two islands are
 * waist-high cover with a column on each end, and the kiosk at the back is
 * one solid box to put your back to. Nothing is walked but the forecourt.
 *
 * ## `ruined`
 *
 * The -X half of the canopy has come down at the front: its two front columns
 * gone, its slab pitched from the back columns to the forecourt. Its collider
 * is that pitched slab, and too steep for the nav graph to link.
 *
 * ## The colours
 *
 * The city kit's: concrete, alloy, enamel, glass, and `AWNING` for the band
 * on the fascia — a company colour faded to brick by the sun, which is as
 * much chroma as this town allows anything that is not a dome.
 */
export function buildFuelStation(
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(mats, "fuelStation");
  const w = p.width ?? 18;
  const d = p.depth ?? 14;
  const ruined = p.ruined === true;
  const rnd = mulberry32(Math.floor(clothHash(w, d, ruined ? 1 : 0) * 0xffffffff));
  const hw = w / 2;
  const hd = d / 2;

  // The kiosk across the back, and the canopy over the forecourt in front of it.
  const kw = Math.min(9, w * 0.5);
  const kd = Math.min(5.5, d * 0.38);
  const kh = 3.3;
  const kx = hw - kw / 2 - 1.6;
  const kz = hd - kd / 2 - 0.3;
  const cw = Math.min(w - 2, 14);
  const cd = Math.min(d - kd - 2.2, 8);
  const cx = -hw + cw / 2 + 1;
  const cz = -hd + cd / 2 + 1.2;
  const islandX = [cx - cw * 0.22, cx + cw * 0.22];
  const islandL = cd - 2.0;
  const colZ = [cz - islandL / 2 + 0.3, cz + islandL / 2 - 0.3];
  const top = CLEAR + FASCIA;

  // --- the colliders, in order -----------------------------------------------
  for (const ix of islandX) {
    b.block({ w: 1.1, h: ISLAND_COVER, d: islandL, x: ix, y: ISLAND_COVER / 2, z: cz });
  }
  b.block({ w: kw, h: kh + 0.5, d: kd, x: kx, y: (kh + 0.5) / 2, z: kz });
  const standing = (ix: number, z: number): boolean => !(ruined && ix < cx && z < cz);
  for (const ix of islandX) {
    for (const z of colZ) {
      if (!standing(ix, z)) continue;
      b.strut(0.36, CLEAR - ISLAND_COVER, 0.36, ix, ISLAND_COVER + (CLEAR - ISLAND_COVER) / 2, z, ALLOY);
    }
  }
  // The sign pole, at the road.
  const sx = -hw + 0.9;
  const sz = -hd + 0.5;
  const poleH = 7.2;
  b.strut(0.3, poleH, 0.3, sx, poleH / 2, sz, ALLOY);
  // The canopy, last: what a round from a roof stops on. Ruined, the -X half
  // is a pitched slab from the back columns down onto the forecourt.
  const pitch = Math.atan2(CLEAR - 0.6, cd);
  if (ruined) {
    b.block({ w: cw / 2, h: FASCIA, d: cd, x: cx + cw / 4, y: CLEAR + FASCIA / 2, z: cz });
    b.block({
      w: cw / 2,
      h: 0.5,
      d: cd / Math.cos(pitch),
      x: cx - cw / 4,
      y: (CLEAR + 0.6) / 2,
      z: cz,
      rotX: -pitch,
    });
  } else {
    b.block({ w: cw, h: FASCIA, d: cd, x: cx, y: CLEAR + FASCIA / 2, z: cz });
  }

  // --- the forecourt -------------------------------------------------------------
  // Poured concrete in bays, a hand thick so the ink finds its edge against the
  // road, with the bays' joints as darker strips and the oil the pumps dripped
  // for twenty years.
  b.box(w, 0.08, d, 0, 0.04, 0, CONCRETE);
  for (let i = 1; i < 4; i++) b.box(0.08, 0.005, d - 0.2, -hw + (i / 4) * w, 0.083, 0, DARK_CONCRETE);
  for (let i = 1; i < 3; i++) b.box(w - 0.2, 0.005, 0.08, 0, 0.083, -hd + (i / 3) * d, DARK_CONCRETE);
  for (let i = 0; i < 7; i++) {
    const ix = islandX[i % 2] + (rnd() - 0.5) * 3.6;
    const z = cz + (rnd() - 0.5) * islandL;
    b.box(0.5 + rnd() * 1.1, 0.006, 0.4 + rnd() * 0.9, ix, 0.085, z, ASPHALT, { y: rnd() * 3 });
  }

  // --- the pump islands --------------------------------------------------------
  for (const ix of islandX) {
    // The island: a kerbed concrete plinth with rounded ends, its kerb painted.
    b.box(1.1, KERB, islandL - 0.6, ix, KERB / 2, cz, CONCRETE);
    for (const s of [-1, 1]) {
      b.cyl(KERB, 1.1, 1.1, 10, ix, KERB / 2, cz + s * (islandL / 2 - 0.3), CONCRETE);
      // Painted bollards at both ends, against a careless bumper.
      b.cyl(0.95, 0.2, 0.2, 8, ix, KERB + 0.47, cz + s * (islandL / 2 - 0.05), WHITEWASH);
      b.cyl(0.18, 0.21, 0.21, 8, ix, KERB + 0.7, cz + s * (islandL / 2 - 0.05), AWNING);
    }
    // Two pumps a side, back to back: an enamel cabinet on a plinth, a white
    // head with its dark display, the nozzle holstered on each face and its
    // hose looping to the ground.
    for (const pz of [cz - islandL * 0.18, cz + islandL * 0.18]) {
      const scorched = ruined && ix < cx && pz < cz;
      const body = scorched ? SCORCH : ENAMEL;
      b.box(0.62, 0.18, 0.98, ix, KERB + 0.09, pz, DARK_CONCRETE);
      b.box(0.52, 1.15, 0.88, ix, KERB + 0.18 + 0.575, pz, body);
      b.box(0.56, 0.42, 0.92, ix, KERB + 1.33 + 0.21, pz, scorched ? SCORCH : WHITEWASH);
      b.box(0.58, 0.07, 0.94, ix, KERB + 1.75, pz, body);
      for (const s of [-1, 1]) {
        const fx = ix + s * 0.29;
        b.box(0.02, 0.2, 0.56, fx, KERB + 1.55, pz, WINDOW_VOID);
        b.box(0.02, 0.22, 0.3, fx, KERB + 0.95, pz - 0.18, ALLOY);
        // The nozzle in its boot, and the hose: from the cabinet's side down
        // to a loop just off the kerb and back up into the boot.
        b.box(0.12, 0.08, 0.26, fx + s * 0.06, KERB + 0.92, pz - 0.18, IRON, { x: 0.6 });
        limb(b, [fx + s * 0.02, KERB + 1.2, pz + 0.3], [fx + s * 0.22, KERB + 0.35, pz + 0.15], 0.05, 0.05, IRON);
        limb(b, [fx + s * 0.22, KERB + 0.35, pz + 0.15], [fx + s * 0.08, KERB + 0.88, pz - 0.12], 0.05, 0.05, IRON);
      }
    }
    // A water drum and an oil-can rack at the island's road end.
    b.cyl(0.85, 0.56, 0.58, 10, ix + 0.18, KERB + 0.425, cz - islandL / 2 + 0.75, RUST);
    b.cyl(0.05, 0.6, 0.6, 10, ix + 0.18, KERB + 0.875, cz - islandL / 2 + 0.75, IRON);
  }

  // --- the columns ---------------------------------------------------------------
  for (const ix of islandX) {
    for (const z of colZ) {
      if (!standing(ix, z)) continue;
      b.box(0.34, CLEAR - KERB, 0.34, ix, KERB + (CLEAR - KERB) / 2, z, ALLOY);
      // The base plate and its cladding: a column's foot is boxed in concrete
      // against the forecourt's traffic.
      b.box(0.56, 0.6, 0.56, ix, KERB + 0.3, z, CONCRETE);
      // Rust bleeding out of the base, and a band of paint at hand height.
      b.box(0.36, 0.02, 0.36, ix, KERB + 0.61, z, RUST);
      b.box(0.36, 0.22, 0.36, ix, 1.4, z, AWNING);
    }
  }
  // The two front columns the ruined half lost, one lying across the
  // forecourt and the other gone.
  if (ruined) {
    b.box(0.34, 0.34, CLEAR - 0.6, islandX[0] - 1.1, 0.25, cz - 0.6, ALLOY, { y: 0.35 });
  }

  // --- the canopy ----------------------------------------------------------------
  // A steel deck (the soffit, lighter, with its grid of panels and the dead
  // lamps let into it), a deep fascia in white with the company's band, and
  // the edge flashing over both.
  const canopy = (w0: number, x0: number): void => {
    b.box(w0, 0.12, cd, x0, CLEAR + 0.06, cz, WHITEWASH);
    for (let i = 1; i < Math.round(w0 / 1.8); i++) {
      b.box(0.06, 0.03, cd - 0.3, x0 - w0 / 2 + (i * w0) / Math.round(w0 / 1.8), CLEAR - 0.005, cz, CONCRETE);
    }
    for (const lz of [cz - cd * 0.22, cz + cd * 0.22]) {
      for (let i = 0; i < Math.max(2, Math.round(w0 / 3.6)); i++) {
        const lx = x0 - w0 / 2 + ((i + 0.5) * w0) / Math.max(2, Math.round(w0 / 3.6));
        b.box(0.9, 0.06, 0.5, lx, CLEAR - 0.02, lz, rnd() < 0.3 ? WINDOW_VOID : GLASS);
      }
    }
    b.box(w0, FASCIA - 0.12, cd - 0.3, x0, CLEAR + 0.12 + (FASCIA - 0.12) / 2, cz, DARK_CONCRETE);
    for (const s of [-1, 1]) {
      b.box(w0, FASCIA, 0.12, x0, CLEAR + FASCIA / 2, cz + s * (cd / 2 - 0.06), WHITEWASH);
      b.box(w0 + 0.02, 0.22, 0.14, x0, CLEAR + FASCIA * 0.45, cz + s * (cd / 2 - 0.06), AWNING);
      b.box(w0 + 0.08, 0.06, 0.2, x0, top + 0.03, cz + s * (cd / 2 - 0.06), ALLOY);
    }
    for (const s of [-1, 1]) {
      b.box(0.12, FASCIA, cd - 0.24, x0 + s * (w0 / 2 - 0.06), CLEAR + FASCIA / 2, cz, WHITEWASH);
      b.box(0.14, 0.22, cd - 0.24, x0 + s * (w0 / 2 - 0.06), CLEAR + FASCIA * 0.45, cz, AWNING);
    }
  };
  if (ruined) {
    canopy(cw / 2, cx + cw / 4);
    // The fallen half: the deck and its fascia as one pitched slab, the front
    // edge on the forecourt and the band still on it, crumpled.
    const fx = cx - cw / 4;
    const len = cd / Math.cos(pitch);
    const y = (CLEAR + 0.6) / 2;
    b.box(cw / 2 - 0.2, 0.5, len, fx, y, cz, DARK_CONCRETE, { x: -pitch });
    b.box(cw / 2 - 0.1, 0.14, len, fx, y + 0.3 * Math.cos(pitch), cz - 0.3 * Math.sin(pitch), WHITEWASH, { x: -pitch });
    b.box(cw / 2 - 0.3, 0.6, 0.12, fx, 0.4, cz - cd / 2 + 0.2, WHITEWASH, { x: 0.3 });
    b.box(cw / 2 - 0.3, 0.2, 0.14, fx, 0.42, cz - cd / 2 + 0.12, AWNING, { x: 0.3 });
    // Panels shaken out of it.
    for (let i = 0; i < 6; i++) {
      b.box(0.9, 0.04, 0.5, fx + (rnd() - 0.5) * cw * 0.45, 0.1, cz - cd / 2 - 0.4 + rnd() * 1.0, WHITEWASH, { y: rnd() * 3, x: (rnd() - 0.5) * 0.3 });
    }
  } else {
    canopy(cw, cx);
  }
  // Pocks along the front fascia: rounds that went high.
  for (let i = 0; i < 9; i++) {
    const px = cx + (rnd() - 0.5) * cw * 0.9;
    if (ruined && px < cx) continue;
    b.box(0.09, 0.09, 0.02, px, CLEAR + 0.15 + rnd() * (FASCIA - 0.3), cz - cd / 2 - 0.01, SCORCH);
  }

  // --- the kiosk -----------------------------------------------------------------
  // A rendered block with a flat roof oversailing it, a shopfront of glass on
  // the forecourt side (two panes of it gone), a door, a roller shutter on the
  // stores end, and an air-conditioner on the roof.
  const kTop = kh;
  b.box(kw, kh, kd, kx, kh / 2, kz, CONCRETE);
  b.box(kw + 0.5, 0.28, kd + 0.5, kx, kTop + 0.14, kz, DARK_CONCRETE);
  b.box(kw + 0.6, 0.12, kd + 0.6, kx, kTop + 0.34, kz, WHITEWASH);
  b.box(kw + 0.04, 0.5, kd + 0.04, kx, 0.25, kz, DARK_CONCRETE);
  const front = kz - kd / 2 - 0.02;
  const shop = kw * 0.55;
  const shopX = kx - kw / 2 + 0.4 + shop / 2;
  const panes = 4;
  for (let i = 0; i < panes; i++) {
    const px = shopX - shop / 2 + ((i + 0.5) * shop) / panes;
    const gone = rnd() < 0.45;
    b.box(shop / panes - 0.12, 1.7, 0.04, px, 1.55, front, gone ? WINDOW_VOID : GLASS);
    b.box(0.08, 1.8, 0.07, px - shop / panes / 2, 1.55, front - 0.02, ALLOY);
  }
  b.box(0.08, 1.8, 0.07, shopX + shop / 2, 1.55, front - 0.02, ALLOY);
  b.box(shop + 0.1, 0.08, 0.07, shopX, 2.44, front - 0.02, ALLOY);
  b.box(shop + 0.1, 0.08, 0.07, shopX, 0.66, front - 0.02, ALLOY);
  // The door, and the band over the shopfront where the name was.
  const doorX = shopX + shop / 2 + 0.75;
  b.box(1.0, 2.2, 0.04, doorX, 1.1 + 0.01, front, WINDOW_VOID);
  b.box(1.16, 0.08, 0.07, doorX, 2.24, front - 0.02, ALLOY);
  b.box(kw - 0.6, 0.5, 0.06, kx, kh - 0.45, front - 0.01, WHITEWASH);
  b.box(kw - 0.8, 0.14, 0.07, kx, kh - 0.45, front - 0.02, AWNING);
  // The stores end: a roller shutter half up.
  const shutterX = kx + kw / 2 - 1.2;
  if (shutterX - 0.9 > doorX + 0.6) {
    b.box(1.6, 1.4, 0.05, shutterX, 2.7 - 0.7, front, ALLOY);
    for (let i = 0; i < 5; i++) b.box(1.6, 0.03, 0.06, shutterX, 1.4 + i * 0.28, front - 0.01, IRON);
    b.box(1.6, 1.3, 0.04, shutterX, 0.65, front, WINDOW_VOID);
  }
  // Scorch over a pane that burned, and pocks.
  b.box(1.4, 1.1, 0.02, shopX - shop * 0.2, 2.6, front - 0.03, SCORCH);
  for (let i = 0; i < 7; i++) {
    b.box(0.08, 0.08, 0.02, kx + (rnd() - 0.5) * kw * 0.9, 0.8 + rnd() * 2.2, front - 0.03, SCORCH);
  }
  // The air-conditioner on the roof and its drip down the back wall.
  b.box(1.0, 0.7, 0.8, kx + kw * 0.25, kTop + 0.75, kz + 0.6, ALLOY);
  b.box(0.92, 0.04, 0.72, kx + kw * 0.25, kTop + 1.12, kz + 0.6, IRON);
  b.cyl(0.04, 0.55, 0.55, 10, kx + kw * 0.25, kTop + 1.15, kz + 0.6, DARK_CONCRETE);
  // A water tank on legs at the kiosk's -X end: what every building out here
  // keeps on its roof or beside it, filled off a bowser.
  const tx = kx - kw / 2 - 1.1;
  if (tx - 0.9 > -hw) {
    for (const lx of [-0.55, 0.55]) {
      for (const lz of [-0.55, 0.55]) b.box(0.1, 2.0, 0.1, tx + lx, 1.0, kz + lz, IRON);
    }
    b.box(1.3, 0.1, 1.3, tx, 2.05, kz, IRON);
    b.cyl(1.4, 1.35, 1.35, 12, tx, 2.8, kz, WHITEWASH);
    b.cyl(0.1, 1.38, 1.38, 12, tx, 3.5, kz, SANDBAG);
    b.block({ w: 1.3, h: 3.5, d: 1.3, x: tx, y: 1.75, z: kz });
  }
  // The tyre stack against the kiosk's +X end: a tyre fitter's sign without
  // the sign.
  const tyX = Math.min(hw - 0.7, kx + kw / 2 + 0.75);
  if (tyX + 0.55 <= hw + 0.3) {
    const stacks = [
      [tyX, kz - kd * 0.2, 5],
      [tyX, kz + kd * 0.25, 3],
    ] as const;
    for (const [x, z, n] of stacks) {
      for (let k = 0; k < n; k++) {
        b.cyl(0.2, 0.68, 0.68, 12, x + (rnd() - 0.5) * 0.05, 0.1 + k * 0.205, z, IRON);
        b.cyl(0.21, 0.36, 0.36, 10, x, 0.1 + k * 0.205, z, WINDOW_VOID);
      }
      b.block({ w: 0.68, h: n * 0.205, d: 0.68, x, y: (n * 0.205) / 2, z });
    }
  }

  // --- the pole sign -----------------------------------------------------------
  // Two posts and a tall board at the road: a white panel with the company's
  // band and a price board under it, the numbers as dark slots, one panel
  // blown out.
  b.box(0.26, poleH, 0.26, sx, poleH / 2, sz, ALLOY);
  b.box(0.5, 0.5, 0.5, sx, 0.25, sz, CONCRETE);
  const bw = 1.9;
  const by = poleH - 1.4;
  b.box(bw, 1.5, 0.22, sx + bw / 2 - 0.13, by, sz, WHITEWASH);
  b.box(bw + 0.08, 0.36, 0.26, sx + bw / 2 - 0.13, by + 0.35, sz, AWNING);
  b.box(bw - 0.2, 0.5, 0.26, sx + bw / 2 - 0.13, by - 0.35, sz, ENAMEL);
  b.box(bw, 1.8, 0.2, sx + bw / 2 - 0.13, by - 1.95, sz, DARK_CONCRETE);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 1 && c === 2) continue;
      b.box(0.36, 0.32, 0.22, sx + 0.28 + c * 0.55, by - 1.35 - r * 0.55, sz, rnd() < 0.15 ? SCORCH : WINDOW_VOID);
    }
  }
  b.box(bw + 0.1, 0.06, 0.3, sx + bw / 2 - 0.13, by + 0.78, sz, ALLOY);
  return b;
}
