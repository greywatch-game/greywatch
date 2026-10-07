/**
 * props/fireDrum.ts — buildFireDrum: the open burn barrel. Part of the scatter
 * set: follows the contract in `./index.ts`.
 */
import {
  CreateBoxVertexData,
  CreateCylinderVertexData,
  CreateTorusVertexData,
  Material,
  Matrix,
  Mesh,
  Scene,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { flameData } from "../flame";
import { partSurface } from "../parts";
import { BARK, DARK_METAL, DEAD_BARK } from "./palette";

const RUST = "#5d4a3c";

/** The drum's radius and height — `PROP_BODIES.fireDrum` is this box. */
const DRUM_R = 0.475;
const DRUM_H = 1.2;
/** Where the coal bed's top lies, a hand's depth under the open rim. */
const DRUM_COALS = 1.1;
/** What glows through every opening: the coal bed, seen from outside. */
const EMBER = "#8f2610";

/**
 * A curved sheet laid on the drum's face, one column per entry: `a` the
 * bearing round the drum (0 faces +Z), `y0`..`y1` the column's span. Normals
 * point out, the winding is Babylon's front face, and it carries UVs so it
 * merges with the primitives beside it.
 */
function drumSheet(r: number, cols: readonly { a: number; y0: number; y1: number }[]): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  cols.forEach(({ a, y0, y1 }, i) => {
    const s = Math.sin(a);
    const c = Math.cos(a);
    positions.push(s * r, y0, c * r, s * r, y1, c * r);
    normals.push(s, 0, c, s, 0, c);
    const u = i / Math.max(1, cols.length - 1);
    uvs.push(u, 0, u, 1);
    if (i === 0) return;
    const b = (i - 1) * 2;
    // (B - A) x (C - A) points INTO the drum for both triangles, which is
    // Babylon's front face for an outward normal.
    indices.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  });
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  return vd;
}

/** `n + 1` columns evenly across `a0`..`a1`, each spanning `y0`..`y1`. */
function drumPatch(a0: number, a1: number, y0: number, y1: number, n: number) {
  return Array.from({ length: n + 1 }, (_, i) => ({ a: a0 + ((a1 - a0) * i) / n, y0, y1 }));
}

/**
 * Burning oil drum — the villagers' braziers, still lit: a 200-litre steel
 * drum with its lid cut out, burnt for warmth and kept fed. A rolled chime at
 * head and foot, two rolling hoops pressed into the barrel, the paint gone to
 * rust and the top of it blued and sooted by the heat, the soot running down
 * in tongues. Air holes punched round the foot with an axe and a stoke hatch
 * cut beside them, its flap bent back on the one side left uncut — every one
 * of them a hole onto the coals and glowing with them. Inside, a hand's depth
 * under the rim, the coal bed with charred lumps lying in it and split billets
 * stood up in the fire; over the mouth, two lengths of rebar laid across as a
 * grill; at the foot, the next few billets.
 *
 * **It was an octagonal tube with a lid**, the fire standing on the lid as if
 * the drum were a plinth — so it read as a column, not as something holding a
 * fire. What makes it read as a drum is the OPEN mouth (a sooted inner wall
 * and the coal bed down inside it) and the chime and hoops the ink can find,
 * so those are where its vertices go.
 *
 * **The drum is `PROP_BODIES.fireDrum` and nothing drawn changes that box**:
 * the barrel is the same 0.95 m by 1.2 m it was. What stands outside it is
 * the hoops and chimes (under two centimetres), the hatch's flap (a third of a
 * metre high, at the foot), the billets lying on the ground (under 0.2 m) and
 * the grill's ends — none of it worth stopping a round on. What stands over it
 * is the billets in the fire, inside the flame.
 *
 * **Its variation comes from `sub`, never `rng`.** `rng` is the map's shared
 * scatter stream and this builder has never drawn from it, so drawing now
 * would move every prop sown after it; `sub` is the prop's own stream (see
 * `MapBuilder`'s `propSeed`). Seven colours: the four the drum always wore
 * (rust, dark metal, the ember, the flame) and the bark and the dead bark its
 * firewood shares with the trees, so on a wooded map it costs no draw call.
 */
export function buildFireDrum(
  scene: Scene,
  mats: CelMaterialFactory,
  _rng: () => number,
  sub: () => number,
): Mesh {
  const rust: VertexData[] = [];
  const dark: VertexData[] = [];
  const ember: VertexData[] = [];
  const char: VertexData[] = [];
  const wood: VertexData[] = [];
  const put = (into: VertexData[], vd: VertexData, m: Matrix): void => {
    vd.transform(m);
    into.push(vd);
  };
  const at = (x: number, y: number, z: number): Matrix => Matrix.Translation(x, y, z);

  // --- the barrel ---------------------------------------------------------
  // Open at the top: the outer wall, then the inner one a sheet's thickness
  // in (drawn from inside, so its far side is what you see looking in), down
  // to the coals. The chime laid over the rim closes the gap between them.
  put(
    rust,
    CreateCylinderVertexData({ height: DRUM_H, diameter: DRUM_R * 2, tessellation: 20, cap: Mesh.CAP_START }),
    at(0, DRUM_H / 2, 0),
  );
  const innerH = DRUM_H - DRUM_COALS + 0.12;
  put(
    dark,
    CreateCylinderVertexData({
      height: innerH,
      diameter: (DRUM_R - 0.02) * 2,
      tessellation: 20,
      cap: Mesh.NO_CAP,
      sideOrientation: Mesh.BACKSIDE,
    }),
    at(0, DRUM_H - innerH / 2, 0),
  );
  // The chimes, rolled steel at the head and the foot. The head is heat-blued
  // with everything else up there; the foot is the barrel's own rust.
  const chime = (y: number): VertexData =>
    CreateTorusVertexData({ diameter: (DRUM_R - 0.005) * 2, thickness: 0.045, tessellation: 18 }).transform(at(0, y, 0));
  dark.push(chime(DRUM_H));
  rust.push(chime(0.025));
  // The two rolling hoops pressed into the barrel at its thirds.
  for (const y of [DRUM_H / 3, (DRUM_H * 2) / 3]) {
    put(rust, CreateCylinderVertexData({ height: 0.04, diameter: (DRUM_R + 0.014) * 2, tessellation: 20 }), at(0, y, 0));
  }

  // The heat line: the top of the drum blued and sooted, its lower edge a slow
  // wave with soot running down from it in two or three tongues where the
  // draught pulls the flame over the lip.
  const p1 = sub() * Math.PI * 2;
  const p2 = sub() * Math.PI * 2;
  const tongues = Array.from({ length: 2 + Math.floor(sub() * 2) }, () => ({
    a: sub() * Math.PI * 2,
    depth: 0.08 + sub() * 0.1,
    width: 0.14 + sub() * 0.1,
  }));
  const band: { a: number; y0: number; y1: number }[] = [];
  const BAND_COLS = 48;
  for (let i = 0; i <= BAND_COLS; i++) {
    const a = (i / BAND_COLS) * Math.PI * 2;
    let y = 0.97 - 0.035 * (1 + Math.sin(2 * a + p1)) - 0.02 * Math.sin(5 * a + p2);
    for (const t of tongues) {
      const d = Math.atan2(Math.sin(a - t.a), Math.cos(a - t.a));
      y -= t.depth * Math.exp(-((d / t.width) ** 2));
    }
    // A run stops on the upper hoop rather than leaving its tip stranded
    // under it as a notch.
    band.push({ a, y0: Math.max(y, (DRUM_H * 2) / 3 + 0.035), y1: DRUM_H - 0.025 });
  }
  dark.push(drumSheet(DRUM_R + 0.004, band));

  // --- the openings at the foot ---------------------------------------------
  // Each is a dark lip round a glowing hole: the glow alone, flush on rust, is
  // a stain, and the lip is what makes it read as a hole cut through.
  const hatchA = sub() * Math.PI * 2;
  const hatchW = 0.32 / DRUM_R;
  const opening = (a0: number, a1: number, y0: number, y1: number, lip: number): void => {
    const la = lip / DRUM_R;
    dark.push(drumSheet(DRUM_R + 0.004, drumPatch(a0 - la, a1 + la, y0 - lip, y1 + lip, 3)));
    ember.push(drumSheet(DRUM_R + 0.007, drumPatch(a0, a1, y0, y1, 3)));
  };
  opening(hatchA - hatchW / 2, hatchA + hatchW / 2, 0.07, 0.3, 0.018);
  // The air holes, punched round the rest of the foot with an axe and none
  // of them in the hatch's way: each a split pointed at both ends and a
  // little off level, never a tidy rectangle — that read as a row of lamps.
  const slit = (a: number, w: number, y: number, hh: number, tilt: number, r: number) => {
    const cols: { a: number; y0: number; y1: number }[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 3 - 1;
      const h = hh * Math.max(0.12, 1 - Math.abs(t)) ** 0.6;
      const yc = y + t * tilt;
      cols.push({ a: a + (t * w) / 2, y0: yc - h, y1: yc + h });
    }
    return drumSheet(r, cols);
  };
  const vents = 5 + Math.floor(sub() * 3);
  for (let i = 0; i < vents; i++) {
    const a = hatchA + hatchW * 0.9 + ((i + 0.5 + (sub() - 0.5) * 0.4) / vents) * (Math.PI * 2 - hatchW * 1.8);
    const w = (0.11 + sub() * 0.05) / DRUM_R;
    const y = 0.17 + sub() * 0.07;
    const hh = 0.022 + sub() * 0.01;
    const tilt = (sub() - 0.5) * 0.04;
    dark.push(slit(a, w + 0.04 / DRUM_R, y, hh + 0.012, tilt, DRUM_R + 0.004));
    ember.push(slit(a, w, y, hh, tilt, DRUM_R + 0.007));
  }
  // The flap: cut on three sides and bent back on the fourth, standing open
  // like a door.
  {
    const hinge = hatchA + hatchW / 2;
    const n = new Vector3(Math.sin(hinge), 0, Math.cos(hinge));
    const t = new Vector3(Math.cos(hinge), 0, -Math.sin(hinge));
    const swing = 1.0 + sub() * 0.5;
    const dir = t.scale(-Math.cos(swing)).add(n.scale(Math.sin(swing)));
    const w = 0.32;
    const c = n.scale(DRUM_R + 0.008).add(dir.scale(w / 2));
    put(
      rust,
      CreateBoxVertexData({ width: w, height: 0.23, depth: 0.012 }),
      Matrix.RotationY(Math.atan2(-dir.z, dir.x)).multiply(at(c.x, 0.185, c.z)),
    );
  }

  // --- inside -------------------------------------------------------------
  // The coal bed, heaped a little to the middle, and charred lumps lying in it.
  put(
    ember,
    CreateCylinderVertexData({ height: 0.1, diameterTop: 0.62, diameterBottom: (DRUM_R - 0.02) * 2, tessellation: 12 }),
    at(0, DRUM_COALS - 0.05, 0),
  );
  for (let i = 0; i < 6; i++) {
    const a = sub() * Math.PI * 2;
    const r = sub() * 0.3;
    put(
      char,
      CreateBoxVertexData({ width: 0.1 + sub() * 0.08, height: 0.05 + sub() * 0.03, depth: 0.06 + sub() * 0.04 }),
      Matrix.RotationYawPitchRoll(sub() * Math.PI, (sub() - 0.5) * 0.6, (sub() - 0.5) * 0.6).multiply(
        at(Math.sin(a) * r, DRUM_COALS - 0.01 + (0.3 - r) * 0.08, Math.cos(a) * r),
      ),
    );
  }
  // Split billets stood up in the fire, leaning on each other and the wall.
  const billets = 2 + Math.floor(sub() * 2);
  const b0 = sub() * Math.PI * 2;
  for (let i = 0; i < billets; i++) {
    const a = b0 + (i / billets) * Math.PI * 2 + (sub() - 0.5) * 0.8;
    const r = 0.12 + sub() * 0.12;
    const len = 0.55 + sub() * 0.2;
    const lean = 0.2 + sub() * 0.25;
    // Leans away from where it stands, so its top is over the middle of the
    // fire rather than over the rim.
    put(
      char,
      CreateCylinderVertexData({ height: len, diameter: 0.1 + sub() * 0.03, tessellation: 3 }),
      at(0, len / 2, 0)
        .multiply(Matrix.RotationX(-lean))
        .multiply(Matrix.RotationY(a + (sub() - 0.5) * 0.6))
        .multiply(at(Math.sin(a) * r, DRUM_COALS - 0.12, Math.cos(a) * r)),
    );
  }
  // The grill: two lengths of rebar laid across the mouth on the chime.
  const grill = sub() * Math.PI;
  for (const o of [-0.13, 0.11]) {
    put(
      dark,
      CreateCylinderVertexData({ height: DRUM_R * 2 + 0.08, diameter: 0.018, tessellation: 5 }),
      Matrix.RotationZ(Math.PI / 2)
        .multiply(Matrix.RotationY(grill))
        .multiply(at(Math.sin(grill) * o, DRUM_H + 0.031, Math.cos(grill) * o)),
    );
  }

  // --- the woodpile -----------------------------------------------------------
  // The next few billets, dropped at the foot on the side away from the hatch:
  // two on the ground and one across them, all under knee height.
  const pileA = hatchA + Math.PI * (0.6 + sub() * 0.8);
  const pd = DRUM_R + 0.3;
  for (let i = 0; i < 3; i++) {
    const len = 0.45 + sub() * 0.2;
    const d = 0.12 + sub() * 0.03;
    const top = i === 2;
    const side = top ? 0 : i === 0 ? -0.07 : 0.07;
    const along = pileA + Math.PI / 2 + (top ? 0.5 : (sub() - 0.5) * 0.3);
    put(
      wood,
      CreateCylinderVertexData({ height: len, diameter: d, tessellation: 3 }),
      Matrix.RotationY(sub() * Math.PI * 2)
        .multiply(Matrix.RotationZ(Math.PI / 2))
        .multiply(Matrix.RotationY(along))
        .multiply(
          at(
            Math.sin(pileA) * (pd + side),
            top ? d * 0.75 + 0.06 : d * 0.3,
            Math.cos(pileA) * (pd + side),
          ),
        ),
    );
  }

  // Hidden layers after what hides them: the inner wall and the coals are
  // emitted after the barrel and the chime that cover their edges.
  const merged = (list: VertexData[]): VertexData => list[0].merge(list.slice(1));
  const drum = partSurface("drum", merged(rust), scene);
  drum.material = mats.get(RUST);
  const parts: [string, VertexData[], Material, object?][] = [
    ["drum-scale", dark, mats.get(DARK_METAL)],
    ["drum-char", char, mats.get(DEAD_BARK)],
    ["drum-wood", wood, mats.get(BARK)],
    // The coal bed and every hole onto it — emissive, flat, and never a caster.
    ["drum-coals", ember, mats.getEmissive(EMBER), { noInk: true, noShadowCaster: true }],
  ];
  for (const [name, list, material, metadata] of parts) {
    const mesh = partSurface(name, merged(list), scene);
    mesh.parent = drum;
    mesh.material = material;
    if (metadata) mesh.metadata = metadata;
  }

  // The fire itself — animated, so it is never a shadow caster (`flame.ts`).
  // Rooted in the coals and reaching the height it always did.
  const fire = new Mesh("drum-fire", scene);
  flameData({ radius: 0.36, height: 2.1 - DRUM_COALS + 0.05 }).applyToMesh(fire);
  fire.parent = drum;
  fire.position.y = DRUM_COALS - 0.05;
  fire.material = mats.getFlame();
  fire.metadata = { noInk: true, noShadowCaster: true };
  return drum;
}
