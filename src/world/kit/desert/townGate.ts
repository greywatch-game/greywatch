/**
 * kit/desert/townGate.ts — buildTownGate: the arch a town in this province
 * put up over its highway in the 1980s to greet whoever drove in, and the
 * checkpoint the war made of it — two whitewashed piers on a stone socle
 * with engaged colonnettes, tiled niches and a lantern apiece, an attic
 * carrying the greeting in square kufic under a pointed crest, a boom raised
 * beside the road and sandbags stacked across the approach.
 * Part of the desert-town set: follows the contract in kit/core.ts and the
 * set's rules in `./index.ts`. Invariants: the road runs through it along Z
 * and the approach is -Z; the nine colliders byte for byte and in their
 * order, restated at the top — the two piers, the attic, the six barricades —
 * the `gatehouse`'s exactly, so a side's home gate plays the same on every
 * map; no light (the map's rule); variation is seeded off where it stands,
 * never `Math.random()`. Never imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  ALLOY,
  AWNING,
  Build,
  IRON,
  StoneBatch,
  hideBack,
  streetSeed,
  type BuildCtx,
  type BuildParams,
  type Mesher,
  type Side,
  type Structure,
  type V3,
} from "../core";
import {
  MUDBRICK,
  MUDBRICK_DARK,
  PALM_BEAM,
  PLINTH,
  SANDBAG,
  SCORCH,
  TILE_BLUE,
  WHITEWASH,
  WINDOW_VOID,
} from "./shared";
import {
  HIDE_DOWN,
  Lay,
  TAU,
  band,
  blindBay,
  cornice,
  courses,
  disc,
  domeProfile,
  kufic,
  lobe,
  merlons,
  pocks,
  pointed,
  poster,
  ring,
  rod,
  slabOn,
  socle,
  spall,
  star,
} from "./lay";

/** The piers' centres off the road's axis, their half-width and their head. */
const PX = 9;
const PH = 2;
const TOP = 8;
/** The attic's soffit — what a lorry clears — and its half-thickness. */
const SOFFIT = 5.8;
const AT = 0.6;
/** The socle's head, where the colonnettes and the bays stand. */
const SOCLE = PLINTH + 0.7;
/** The string course at the soffit's height, and the cornice under the head. */
const STRING = SOFFIT;
const CORNICE = TOP - 0.4;
/** A course of sandbags. */
const BAG_COURSE = 0.183;

/** One face of a pier: the side it looks to, its plane, its run in `u`, and what it is. */
interface Face {
  s: Side;
  plane: number;
  a: number;
  c: number;
  /** The approach (-Z), the yard (+Z), the flank away from the road, or the road. */
  role: "approach" | "yard" | "flank" | "road";
}

/** A pier's four faces, `cx` its centre on X. */
function faces(cx: number): Face[] {
  const k = Math.sign(cx);
  return [
    { s: "-z", plane: PH, a: cx - PH, c: cx + PH, role: "approach" },
    { s: "+z", plane: PH, a: cx - PH, c: cx + PH, role: "yard" },
    { s: k > 0 ? "+x" : "-x", plane: Math.abs(cx) + PH, a: -PH, c: PH, role: "flank" },
    { s: k > 0 ? "-x" : "+x", plane: -(Math.abs(cx) - PH), a: -PH, c: PH, role: "road" },
  ];
}

/**
 * The town gate.
 *
 * ## What it is FOR
 *
 * **It is a side's HOME GATE**: where the road out of the staging yard
 * leaves the map, the thing that carries the side's colour, and the one
 * piece of ground a losing side can always deploy behind. It is not
 * capturable and nothing is walked on it. In play it is the `gatehouse`
 * exactly — two 4 m piers eight metres high, an attic the road passes under
 * at 5.8 m, and six barricades a metre high staggered down the approach so
 * the road between them is a chicane rather than a lane — because the
 * colliders are that builder's, restated. What this builder changes is what
 * a player standing in the yard looks back at.
 *
 * ## What it is drawn as
 *
 * The municipal arch every town of any size in the province built on its
 * highway when the oil money came, in the vocabulary of the state's idea of
 * its own past: rendered and whitewashed blockwork over a socle of dressed
 * stone, engaged colonnettes at every angle of the piers, a dog-tooth
 * cornice and stepped merlons at the head. Each pier has a tall blind niche
 * on its approach and yard faces and a narrower one toward the road, each
 * tiled blue and hung with the side's banner, a starred tile panel above
 * the niche, and an octagonal lantern on its head with blind arches round
 * it and a tiled dome. The attic carries the greeting — square kufic in
 * white on a tiled band — on both faces, ends in stepped corbels where it
 * meets the piers, has a coffered soffit, and is crowned by a pointed crest
 * with a striped ring, a star and a finial. The outer flanks carry the
 * town's enamel sign and the posters of the dead.
 *
 * The CHECKPOINT is what the war added: a boom hinged on the right pier's
 * approach face and left raised, its rest on the left pier; sandbag walls
 * laid in courses where the barricades stand, wire on some of them, a
 * painted stop board, a tyre, a jerrycan; spent cases in the road; and the
 * render pocked, spalled back to brick and scorched under the soffit.
 */
export function buildTownGate(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "towngate");
  const team = p.teamColor ?? "#c9a15e";
  const skin = p.tint ?? WHITEWASH;

  // --- the colliders: the gatehouse's nine, byte for byte, in its order -----
  const w = 18;
  const h = 8;
  const t = 1.2;
  for (const sx of [-1, 1]) b.block({ w: 4, h, d: 4, x: (sx * w) / 2, y: h / 2, z: 0 });
  b.block({ w: w - 4, h: 2.2, d: t, x: 0, y: h - 1.1, z: 0 });
  const barricades: [number, number][] = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      b.block({ w: 3.2, h: 1.1, d: 1.2, x: sx * (5 + i * 0.4), y: 0.55, z: -4 - i * 1.6 });
      barricades.push([sx * (5 + i * 0.4), -4 - i * 1.6]);
    }
  }

  // --- the drawing -------------------------------------------------------------
  const rnd = mulberry32(streetSeed(w, t, h, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const lay = new Lay();
  const glow = new StoneBatch();
  // Which pier's flank the shell found, and which face is spalled.
  const hurt = rnd() < 0.5 ? -1 : 1;

  for (const cx of [-PX, PX]) pier(lay, glow, cx, skin, team, cx === hurt * PX, rnd);
  attic(lay, skin, rnd);
  crest(lay, skin, rnd);
  boom(lay);
  for (const [bx, bz] of barricades) barricade(lay, bx, bz, ground, rnd);
  litter(lay, ground, rnd);
  lay.flush(b);
  // The banners are the side's colour at full strength and are CLOTH, so
  // they stay out of the bloom: a glowing sheet in a niche under this sun
  // reads as a lit doorway.
  const first = b.meshes.length;
  glow.flushGlow(b);
  for (const m of b.meshes.slice(first)) m.metadata = { ...m.metadata, noGlow: true };

  // The cores, after everything laid on them.
  for (const cx of [-PX, PX]) {
    const g = Math.min(ground(cx - PH, -PH), ground(cx + PH, -PH), ground(cx - PH, PH), ground(cx + PH, PH)) - 0.1;
    b.box(4 + 0.3, PLINTH - g, 4 + 0.3, cx, (PLINTH + g) / 2, 0, MUDBRICK_DARK);
    b.box(4, TOP - PLINTH, 4, cx, (TOP + PLINTH) / 2, 0, skin);
  }
  b.box(2 * (PX - PH), TOP - SOFFIT, 2 * AT, 0, (TOP + SOFFIT) / 2, 0, skin);
  return b;
}

// --- the piers -----------------------------------------------------------------

/** One pier: its faces, its colonnettes, its parapet and its lantern. */
function pier(lay: Lay, glow: StoneBatch, cx: number, skin: string, team: string, hurt: boolean, rnd: () => number): void {
  for (const f of faces(cx)) face(lay, glow, f, skin, team, hurt, rnd);
  colonnettes(lay, cx, skin);
  for (const f of faces(cx)) merlons(lay, f.s, f.plane, (f.a + f.c) / 2, f.c - f.a, TOP, 0.3, skin);
  lantern(lay, cx, skin);
}

/** A face of a pier, from the socle to the cornice. */
function face(lay: Lay, glow: StoneBatch, f: Face, skin: string, team: string, hurt: boolean, rnd: () => number): void {
  const { s, plane, a, c, role } = f;
  const back = hideBack(s);
  const mid = (a + c) / 2;
  // The socle and its weathering, inside the colonnettes' bases.
  socle(lay, s, plane, a + 0.12, c - 0.12, rnd);

  // The string course at the soffit, and the cornice under the merlons; on
  // the road face both stop at the attic, which carries its own.
  const runs: [number, number][] = role === "road" ? [[a, -AT], [AT, c]] : [[a, c]];
  for (const [u0, u1] of runs) {
    lay.sb.onFace(s, plane, (u0 + u1) / 2, STRING, u1 - u0, 0.16, 0.12, 0.06, MUDBRICK, 0, 0, back);
    cornice(lay, s, plane, u0, u1, CORNICE);
  }

  if (role === "approach" || role === "yard") {
    // The tall niche, tiled, with the side's banner hung in it.
    blindBay(lay, s, plane, mid, 3.0, SOCLE, STRING - 0.2, MUDBRICK, false, TILE_BLUE);
    banner(lay, glow, s, plane, mid, 1.3, 3.45, 1.55, team);
    // The starred tile panel between the string course and the cornice.
    starPanel(lay, s, plane, mid, (STRING + CORNICE) / 2 + 0.02, 2.6, 1.15);
    // Chips: on the frame's margins mostly, and fewer in the tile.
    const n = role === "approach" ? 10 : 3;
    for (const k of [-1, 1]) pocks(lay, s, plane, mid + k * 1.75 - 0.15, mid + k * 1.75 + 0.15, SOCLE + 0.2, STRING - 0.3, n, rnd);
    pocks(lay, s, plane, mid - 1.1, mid + 1.1, SOCLE + 0.3, 3.0, role === "approach" ? 6 : 2, rnd);
  } else if (role === "road") {
    // The narrow niche toward the road with its banner, and a lantern on a
    // bracket each side of it.
    blindBay(lay, s, plane, 0, 2.0, SOCLE, 5.1, MUDBRICK, false, TILE_BLUE);
    banner(lay, glow, s, plane, 0, 0.95, 3.4, 1.7, team);
    for (const k of [-1, 1]) wallLamp(lay, s, plane, k * 1.45, 4.25, rnd() < 0.4);
    // The stepped corbels under the attic's end.
    for (let i = 0; i < 3; i++) {
      const depth = 0.18 + i * 0.15;
      lay.sb.onFace(s, plane, 0, SOFFIT - 0.125 - (2 - i) * 0.25, 2 * AT + 0.1, 0.25, depth, depth / 2, MUDBRICK, 0, 0, back);
    }
    pocks(lay, s, plane, a + 0.3, c - 0.3, SOCLE + 0.2, 4.0, 12, rnd);
  } else {
    // The flank: the town's sign, a framed panel of the posters of the dead,
    // the star panel over it, and the war's pocks.
    // The panel the posters of the dead are pasted in, two rows of three,
    // some gone and some torn to their lower half.
    framed(lay, s, plane, mid, 2.85, 2.6, 2.9);
    lay.sb.onFace(s, plane, mid, 2.85, 2.44, 2.74, 0.01, 0.005, MUDBRICK, 0, 0, hideBack(s));
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 3; i++) {
        const r = rnd();
        const pu = mid - 0.75 + i * 0.75 + (rnd() - 0.5) * 0.08;
        const py = 2.25 + row * 1.15 + (rnd() - 0.5) * 0.08;
        if (r < 0.7) poster(lay, s, plane, pu, py, 0.03, rnd);
        else if (r < 0.88) lay.sb.onFace(s, plane, pu, py - 0.16, 0.44, 0.28, 0.008, 0.034, WHITEWASH, (rnd() - 0.5) * 0.1, 0, hideBack(s));
      }
    }
    townSign(lay, s, plane, mid, 5.0, rnd);
    starPanel(lay, s, plane, mid, (STRING + CORNICE) / 2 + 0.02, 2.6, 1.15);
    pocks(lay, s, plane, a + 0.3, c - 0.3, SOCLE + 0.2, STRING - 0.3, hurt ? 40 : 14, rnd);
    if (hurt) {
      spall(lay, s, plane, mid + 0.6, 6.4, 0.6, 0.4, skin, rnd);
      spall(lay, s, plane, mid - 0.9, 1.7, 0.4, 0.3, skin, rnd);
    }
  }
}

/** The engaged colonnettes at a pier's four angles: base, shaft and capital. */
function colonnettes(lay: Lay, cx: number, skin: string): void {
  const m = lay.m(skin);
  const dark = lay.m(MUDBRICK);
  for (const kx of [-1, 1]) {
    for (const kz of [-1, 1]) {
      const x = cx + kx * PH;
      const z = kz * PH;
      band(dark, 8, 0, 0.22, SOCLE, 0.22, SOCLE + 0.22, x, z);
      disc(dark, 8, 0, 0.22, 0.15, SOCLE + 0.22, true, x, z);
      band(m, 8, 0, 0.15, SOCLE + 0.22, 0.15, CORNICE - 0.32, x, z);
      band(dark, 8, 0, 0.15, CORNICE - 0.32, 0.23, CORNICE - 0.08, x, z);
      band(dark, 8, 0, 0.23, CORNICE - 0.08, 0.23, CORNICE, x, z);
      disc(dark, 8, 0, 0.23, 0, CORNICE, true, x, z);
    }
  }
}

/**
 * A banner in the side's colour hung on a rod across a niche: a sheet and a
 * swallowtail at its foot, drawn in glow because it is the read that tells a
 * player whose ground this is, from the far end of the yard.
 */
function banner(lay: Lay, glow: StoneBatch, s: Side, plane: number, u: number, bw: number, top: number, bottom: number, team: string): void {
  const back = hideBack(s);
  const tail = 0.38;
  const body = top - bottom - tail;
  glow.onFace(s, plane, u, top - body / 2, bw, body, 0.025, 0.1, team, 0, 0, back);
  // The swallowtail: two tongues hanging from the sheet's foot.
  for (const k of [-1, 1]) {
    glow.onFace(s, plane, u + (k * bw) / 4, bottom + tail / 2 + 0.02, bw / 2 - 0.06, tail, 0.025, 0.1, team, k * 0.12, 0, back);
  }
  // The white hem round it, which is what parts the side's colour from the
  // tile whichever side it is — the blue one hangs on blue.
  const hem = 0.07;
  lay.sb.onFace(s, plane, u, top - body / 2, bw + 2 * hem, body + hem, 0.02, 0.08, WHITEWASH, 0, 0, back);
  for (const k of [-1, 1]) {
    lay.sb.onFace(s, plane, u + (k * bw) / 4, bottom + tail / 2 - 0.01, bw / 2 - 0.06 + 2 * hem, tail + 0.04, 0.02, 0.08, WHITEWASH, k * 0.12, 0, back);
  }
  // The rod across the niche, its knobs, and the cords up to its hook.
  lay.sb.onFace(s, plane, u, top + 0.03, bw + 0.36, 0.05, 0.05, 0.11, IRON, 0, 0, back);
  for (const k of [-1, 1]) {
    lay.sb.onFace(s, plane, u + k * (bw / 2 + 0.2), top + 0.03, 0.09, 0.09, 0.09, 0.11, ALLOY, 0, 0, back);
    lay.sb.onFace(s, plane, u + (k * bw) / 4, top + 0.32, 0.018, 0.58, 0.018, 0.1, IRON, -k * 0.55, 0, back);
  }
  lay.sb.onFace(s, plane, u, top + 0.58, 0.07, 0.07, 0.12, 0.07, IRON, 0, 0, back);
}

/** A tile panel with an eight-pointed star on it, framed in stone. */
function starPanel(lay: Lay, s: Side, plane: number, u: number, y: number, pw: number, ph: number): void {
  const back = hideBack(s);
  framed(lay, s, plane, u, y, pw, ph);
  lay.sb.onFace(s, plane, u, y, pw - 0.16, ph - 0.16, 0.02, 0.012, TILE_BLUE, 0, 0, back);
  const sz = ph * 0.52;
  star(lay, s, plane, u, y, sz, 0.03, WHITEWASH);
  star(lay, s, plane, u, y, sz * 0.55, 0.055, TILE_BLUE);
  lay.sb.onFace(s, plane, u, y, sz * 0.2, sz * 0.2, 0.03, 0.075, WHITEWASH, Math.PI / 4, 0, back);
  // Small stars in the panel's ends.
  for (const k of [-1, 1]) {
    const su = u + k * (pw / 2 - ph * 0.42);
    star(lay, s, plane, su, y, ph * 0.26, 0.03, WHITEWASH);
  }
}

/** A frame of stone round a panel, `pw` by `ph`, centred at `(u, y)`. */
function framed(lay: Lay, s: Side, plane: number, u: number, y: number, pw: number, ph: number): void {
  const back = hideBack(s);
  const fw = 0.1;
  for (const k of [-1, 1]) {
    lay.sb.onFace(s, plane, u, y + k * (ph / 2 - fw / 2), pw, fw, 0.08, 0.04, MUDBRICK, 0, 0, back);
    lay.sb.onFace(s, plane, u + k * (pw / 2 - fw / 2), y, fw, ph - 2 * fw, 0.08, 0.04, MUDBRICK, 0, 0, back);
  }
}

/** A lantern on an iron bracket: its arm, its frame, and its glass whole or gone. */
function wallLamp(lay: Lay, s: Side, plane: number, u: number, y: number, smashed: boolean): void {
  const back = hideBack(s);
  lay.sb.onFace(s, plane, u, y + 0.05, 0.16, 0.24, 0.03, 0.015, IRON, 0, 0, back);
  lay.sb.onFace(s, plane, u, y + 0.1, 0.04, 0.04, 0.42, 0.22, IRON, 0, 0, back);
  lay.sb.onFace(s, plane, u, y - 0.02, 0.03, 0.26, 0.03, 0.22, IRON, 0.6, 0, back);
  const out = 0.44;
  // The cap, the frame's posts and the glass between them.
  lay.sb.onFace(s, plane, u, y + 0.1, 0.3, 0.06, 0.3, out, IRON, 0, Math.PI / 4, back);
  lay.sb.onFace(s, plane, u, y + 0.16, 0.14, 0.08, 0.14, out, IRON, 0, Math.PI / 4, back);
  lay.sb.onFace(s, plane, u, y - 0.3, 0.2, 0.05, 0.2, out, IRON, 0, Math.PI / 4, 0);
  for (const [du, dz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]] as const) {
    lay.sb.onFace(s, plane, u + du, y - 0.1, 0.025, 0.36, 0.025, out + dz, IRON, 0, 0, 0);
  }
  if (!smashed) lay.sb.onFace(s, plane, u, y - 0.1, 0.18, 0.34, 0.18, out, WINDOW_VOID, 0, 0, HIDE_DOWN);
  else lay.sb.onFace(s, plane, u, y + 0.02, 0.18, 0.1, 0.18, out, WINDOW_VOID, 0, 0, HIDE_DOWN);
}

/** The town's sign: an enamel plate on two brackets, its name in white kufic and a white rule. */
function townSign(lay: Lay, s: Side, plane: number, u: number, y: number, rnd: () => number): void {
  const back = hideBack(s);
  const sw = 2.3;
  const sh = 0.7;
  for (const k of [-1, 1]) lay.sb.onFace(s, plane, u + k * (sw / 2 - 0.25), y, 0.06, sh + 0.2, 0.1, 0.05, IRON, 0, 0, back);
  lay.sb.onFace(s, plane, u, y, sw, sh, 0.03, 0.115, TILE_BLUE, 0, 0, back);
  lay.sb.onFace(s, plane, u, y, sw - 0.08, sh - 0.08, 0.008, 0.132, WHITEWASH, 0, 0, back);
  lay.sb.onFace(s, plane, u, y, sw - 0.14, sh - 0.14, 0.008, 0.137, TILE_BLUE, 0, 0, back);
  kufic(
    (ku, ky, along, tall) => lay.sb.onFace(s, plane, ku, ky, along, tall, 0.008, 0.143, WHITEWASH, 0, 0, back),
    u - sw / 2 + 0.2,
    u + sw / 2 - 0.2,
    y - sh / 2 + 0.12,
    0.46,
    rnd,
  );
  // A round through it, and the rust it bled.
  if (rnd() < 0.7) {
    const hu = u + (rnd() - 0.5) * sw * 0.7;
    const hy = y + (rnd() - 0.5) * sh * 0.5;
    lay.sb.onFace(s, plane, hu, hy, 0.05, 0.05, 0.01, 0.147, SCORCH, 0.5, 0, back);
    lay.sb.onFace(s, plane, hu, hy - 0.09, 0.025, 0.14, 0.006, 0.146, MUDBRICK_DARK, 0, 0, back);
  }
}

/**
 * The lantern on a pier's head: a square step, an octagon with a blind arch
 * on every flat, a corbelled ledge with merlons, a tiled dome laid in
 * courses and a finial. It stands on the collider's head, above every
 * round's business.
 */
function lantern(lay: Lay, cx: number, skin: string): void {
  const m = lay.m(skin);
  const dark = lay.m(MUDBRICK);
  const yb = TOP + 0.3;
  const ao = 1.0;
  const yh = yb + 1.2;
  lay.sb.box(2.7, 0.3, 2.7, cx, TOP + 0.15, 0, skin, undefined, HIDE_DOWN);
  lay.sb.box(2.4, 0.06, 2.4, cx, TOP + 0.33, 0, MUDBRICK, undefined, HIDE_DOWN);
  band(m, 8, Math.PI / 8, ao, yb, ao, yh, cx, 0);
  // A blind pointed arch on every flat, framed, and the colonnettes at the angles.
  const k8 = 1 / Math.cos(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * TAU) / 8;
    facetSlab(lay.m(k % 2 ? TILE_BLUE : WINDOW_VOID), cx, a, ao, pointed(0, yb + 0.12, 0.42, 0.55, 0.26), 0, 0.015);
    facetSlab(dark, cx, a, ao, pointed(0, yb + 0.06, 0.58, 0.61, 0.33), 0, 0.006);
    const ca = a + Math.PI / 8;
    const r = ao * k8 - 0.02;
    lay.sb.box(0.1, yh - yb - 0.1, 0.1, cx + Math.sin(ca) * r, (yb + yh - 0.1) / 2, Math.cos(ca) * r, skin, { y: ca }, HIDE_DOWN);
  }
  // The ledge, the merlons on it and the dome.
  band(dark, 8, Math.PI / 8, ao, yh - 0.12, ao + 0.08, yh - 0.04, cx, 0);
  band(dark, 8, Math.PI / 8, ao + 0.08, yh - 0.04, ao + 0.08, yh, cx, 0);
  const R = ao - 0.12;
  disc(dark, 8, Math.PI / 8, ao + 0.08, R - 0.02, yh, true, cx, 0);
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * TAU) / 8;
    const r = ao - 0.04;
    lay.sb.box(0.22, 0.2, 0.1, cx + Math.sin(a) * r, yh + 0.1, Math.cos(a) * r, skin, { y: a }, HIDE_DOWN);
    lay.sb.box(0.1, 0.08, 0.1, cx + Math.sin(a) * r, yh + 0.24, Math.cos(a) * r, skin, { y: a }, HIDE_DOWN);
  }
  const prof = domeProfile(R, yh, 1.15, 0.12, 9);
  courses(lay.m(TILE_BLUE), 16, 0, prof, 0.035, cx, 0);
  finial(lay, cx, 0, prof[prof.length - 1][1] - 0.03, 0.9);
}

/** A finial: a stem through two balls and a point, `scale` of the lanterns'. */
function finial(lay: Lay, x: number, z: number, y: number, scale: number): void {
  const m = lay.m(ALLOY);
  const k = scale;
  band(m, 6, 0, 0.03 * k, y, 0.03 * k, y + 0.7 * k, x, z);
  for (const [yc, r] of [[0.2, 0.09], [0.47, 0.065]] as const) {
    band(m, 6, 0, 0.04 * k, y + (yc - r) * k, r * k, y + yc * k, x, z);
    band(m, 6, 0, r * k, y + yc * k, 0.04 * k, y + (yc + r) * k, x, z);
  }
  band(m, 4, Math.PI / 4, 0.04 * k, y + 0.7 * k, 0.001, y + 0.98 * k, x, z);
}

/**
 * An outline in a flat's `(u, y)` laid on the flat of an octagon of apothem
 * `ao` about `(cx, 0)` facing bearing `a`, from `out0` to `out1` past it:
 * its front and its edges. Convex, fanned from its first point.
 */
function facetSlab(m: Mesher, cx: number, a: number, ao: number, pts: readonly [number, number][], out0: number, out1: number): void {
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const at = (u: number, y: number, out: number): V3 => [cx + sa * (ao + out) + ca * u, y, ca * (ao + out) - sa * u];
  const fwd: V3 = [sa, 0, ca];
  const n = pts.length;
  for (let i = 1; i + 1 < n; i++) m.tri(at(pts[0][0], pts[0][1], out1), at(pts[i][0], pts[i][1], out1), at(pts[i + 1][0], pts[i + 1][1], out1), fwd);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  const sg = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const du = pts[j][0] - pts[i][0];
    const dy = pts[j][1] - pts[i][1];
    const nu = sg * dy;
    m.quad(at(pts[i][0], pts[i][1], out0), at(pts[j][0], pts[j][1], out0), at(pts[j][0], pts[j][1], out1), at(pts[i][0], pts[i][1], out1), [ca * nu, -sg * du, -sa * nu]);
  }
}

// --- the attic and its crest ---------------------------------------------------

/**
 * The attic the road passes under: on each face an architrave, the greeting
 * in white kufic on a tiled band between stars, the cornice and the
 * merlons; under it a coffered soffit, smoked where something burned under
 * it.
 */
function attic(lay: Lay, skin: string, rnd: () => number): void {
  const L = PX - PH;
  for (const s of ["-z", "+z"] as const) {
    const back = hideBack(s);
    lay.sb.onFace(s, AT, 0, SOFFIT + 0.11, 2 * L, 0.22, 0.12, 0.05, MUDBRICK, 0, 0, back);
    lay.sb.onFace(s, AT, 0, SOFFIT + 0.32, 2 * L, 0.06, 0.08, 0.03, MUDBRICK_DARK, 0, 0, back);
    // The inscription band: a frame, the tile, the script.
    const by = 6.78;
    const bh = 1.02;
    const bl = 9.6;
    framed(lay, s, AT, 0, by, bl, bh);
    lay.sb.onFace(s, AT, 0, by, bl - 0.16, bh - 0.16, 0.02, 0.012, TILE_BLUE, 0, 0, back);
    kufic(
      (ku, ky, along, tall) => lay.sb.onFace(s, AT, ku, ky, along, tall, 0.025, 0.035, WHITEWASH, 0, 0, back),
      -bl / 2 + 0.2,
      bl / 2 - 0.2,
      by - bh / 2 + 0.1,
      0.86,
      rnd,
    );
    // Starred tile at the band's ends.
    for (const k of [-1, 1]) starPanel(lay, s, AT, k * (bl / 2 + 0.95), by, 1.5, bh);
    cornice(lay, s, AT, -L, L, CORNICE);
    // The merlons, broken where the crest stands and where a round took one.
    for (const [u0, u1] of [[-L, -2.35], [2.35, L]] as const) merlons(lay, s, AT, (u0 + u1) / 2, u1 - u0, TOP, 0.3, skin);
    pocks(lay, s, AT, -L + 0.3, L - 0.3, SOFFIT + 0.4, CORNICE - 0.1, s === "-z" ? 26 : 6, rnd);
  }
  // The soffit: two ribs along it and a cross rib every bay, a hair proud.
  const ribY = SOFFIT - 0.03;
  for (const k of [-1, 1]) lay.sb.box(2 * L, 0.06, 0.1, 0, ribY, k * (AT - 0.12), MUDBRICK, undefined, 1 << 2);
  const bays = 9;
  for (let i = 0; i <= bays; i++) {
    const x = -L + 0.2 + (i * (2 * L - 0.4)) / bays;
    lay.sb.box(0.1, 0.06, 2 * AT - 0.14, x, ribY, 0, MUDBRICK, undefined, 1 << 2);
  }
  // Smoke on it from a fire under it, a lobe or two of soot.
  const soot = lay.m(SCORCH);
  const sx = (rnd() - 0.5) * 5;
  soffitLobe(soot, sx, SOFFIT - 0.008, 1.3 + rnd() * 0.8, 0.45, rnd);
  soffitLobe(soot, sx + 0.9 * (rnd() < 0.5 ? -1 : 1), SOFFIT - 0.012, 0.8, 0.35, rnd);
}

/** A lobe laid under a level soffit at `y`, facing down. */
function soffitLobe(m: Mesher, x: number, y: number, a: number, bb: number, rnd: () => number): void {
  const p1 = rnd() * TAU;
  const N = 12;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * TAU;
    const kk = 1 + 0.2 * Math.sin(2 * th + p1);
    pts.push([x + Math.cos(th) * a * kk, Math.min(AT - 0.02, Math.max(-AT + 0.02, Math.sin(th) * bb * kk))]);
  }
  for (let i = 0; i < N; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % N];
    m.tri([x, y, 0], [ax, y, az], [bx, y, bz], [0, -1, 0]);
  }
}

/**
 * The crest on the attic's middle: a pointed slab, tiled on both faces
 * inside a striped ring, a star on the tile and a line of script under it,
 * a coping round its head and a finial on its point.
 */
function crest(lay: Lay, skin: string, rnd: () => number): void {
  const half = 0.35;
  const span = 4.4;
  const outline = pointed(0, TOP, span, 1.0, 1.5);
  slabOn(lay, "-z", 0, outline, -half, half, skin, true);
  const ys = TOP + 0.25 + 0.85;
  const inner = pointed(0, TOP + 0.25, 3.5, 0.85, 1.15);
  for (const s of ["-z", "+z"] as const) {
    const back = hideBack(s);
    slabOn(lay, s, half, inner, 0, 0.015, TILE_BLUE);
    ring(lay, s, half, 0, ys, 3.5, 1.15, 0.2, 0.1, 0.05, [MUDBRICK_DARK, WHITEWASH]);
    for (const k of [-1, 1]) lay.sb.onFace(s, half, k * (3.5 / 2 + 0.1), (TOP + 0.25 + ys) / 2, 0.2, ys - TOP - 0.25, 0.1, 0.05, MUDBRICK_DARK, 0, 0, back);
    lay.sb.onFace(s, half, 0, TOP + 0.17, span, 0.16, 0.1, 0.05, MUDBRICK, 0, 0, back);
    star(lay, s, half, 0, ys + 0.3, 0.86, 0.035, WHITEWASH);
    star(lay, s, half, 0, ys + 0.3, 0.48, 0.06, TILE_BLUE);
    lay.sb.onFace(s, half, 0, ys + 0.3, 0.16, 0.16, 0.03, 0.08, WHITEWASH, Math.PI / 4, 0, back);
    kufic(
      (ku, ky, along, tall) => lay.sb.onFace(s, half, ku, ky, along, tall, 0.02, 0.03, WHITEWASH, 0, 0, back),
      -1.35,
      1.35,
      TOP + 0.33,
      0.42,
      rnd,
    );
  }
  // The coping round its head: stones along both arcs, a hair proud each side.
  const arc = outline.slice(2);
  for (let i = 0; i + 1 < arc.length; i++) {
    const [ua, ya] = arc[i];
    const [ub, yb] = arc[i + 1];
    const len = Math.hypot(ub - ua, yb - ya) + 0.04;
    const tilt = Math.atan2(yb - ya, ub - ua);
    const ti = tilt > Math.PI / 2 ? tilt - Math.PI : tilt <= -Math.PI / 2 ? tilt + Math.PI : tilt;
    lay.sb.box(len, 0.12, 2 * half + 0.1, (ua + ub) / 2, (ya + yb) / 2 + 0.03, 0, MUDBRICK, { z: ti }, HIDE_DOWN);
  }
  const apex = outline.reduce((m, q) => Math.max(m, q[1]), 0);
  lay.sb.box(0.34, 0.16, 0.34, 0, apex + 0.1, 0, MUDBRICK, undefined, HIDE_DOWN);
  finial(lay, 0, 0, apex + 0.18, 1.4);
}

// --- the checkpoint ----------------------------------------------------------

/**
 * The boom: hinged on a housing on the right pier's approach face at the
 * road's edge, its counterweight down and its arm raised over the road,
 * striped red and white; and the fork it rests in when it is down, on the
 * left pier.
 */
function boom(lay: Lay): void {
  const z = -PH;
  const px = PX - PH + 0.32;
  const py = 1.05;
  // The housing, bolted to the face, and the pivot through it.
  lay.sb.box(0.36, 0.6, 0.3, px, 0.85, z - 0.15, AWNING, undefined, 0);
  lay.sb.box(0.42, 0.08, 0.36, px, 1.19, z - 0.15, IRON, undefined, HIDE_DOWN);
  lay.sb.box(0.12, 0.12, 0.5, px, py + 0.12, z - 0.27, IRON);
  const ang = (102 * Math.PI) / 180;
  const dir: V3 = [Math.cos(ang), Math.sin(ang), 0];
  const pz = z - 0.42;
  const seg = 0.55;
  for (let i = 0; i < 12; i++) {
    const d = 0.15 + (i + 0.5) * seg;
    lay.sb.box(seg + 0.002, 0.11, 0.09, px + dir[0] * d, py + 0.12 + dir[1] * d, pz, i % 2 ? WHITEWASH : AWNING, { z: ang }, 0);
  }
  // The counterweight on the short end.
  lay.sb.box(0.5, 0.26, 0.2, px - dir[0] * 0.35, py + 0.12 - dir[1] * 0.35, pz, IRON, { z: ang }, 0);
  // The rest on the far pier: a post on a bracket with a fork at its head.
  const rx = -(PX - PH) - 0.22;
  lay.sb.box(0.3, 0.3, 0.05, rx, 1.0, z - 0.025, IRON, undefined, 0);
  lay.sb.box(0.1, 0.1, 0.3, rx, 1.0, z - 0.17, IRON);
  for (const k of [-1, 1]) lay.sb.box(0.04, 0.16, 0.04, rx + k * 0.07, 1.13, z - 0.3, IRON);
}

/**
 * A barricade where the gatehouse's stood: sandbags laid in courses to the
 * collider's head on the ground under it, staggered course to course, the
 * outer rows' bags plump and a little askew and the top course laid across;
 * then what a position gathers on it.
 */
function barricade(lay: Lay, bx: number, bz: number, ground: (x: number, z: number) => number, rnd: () => number): void {
  const L = 3.2;
  const D = 1.2;
  const H = 1.1;
  const g = Math.min(ground(bx - L / 2, bz - D / 2), ground(bx + L / 2, bz - D / 2), ground(bx - L / 2, bz + D / 2), ground(bx + L / 2, bz + D / 2), 0);
  const n = Math.max(2, Math.round((H - g) / BAG_COURSE));
  const course = (H - g) / n;
  const per = 5;
  const pitch = L / per;
  for (let c = 0; c < n; c++) {
    const y = g + (c + 0.5) * course;
    const top = c === n - 1;
    const shift = c % 2 ? pitch / 2 : 0;
    // A course of headers on top, otherwise stretchers on both faces.
    const rows: number[] = top ? [-0.38, 0, 0.38] : [-1, 1];
    for (const row of rows) {
      const count = top ? per : c % 2 ? per - 1 : per;
      for (let i = 0; i < count; i++) {
        const x = bx - L / 2 + shift + (i + 0.5) * pitch;
        const z = top ? bz + row : bz + row * (D / 2 - 0.19 - c * 0.006);
        bag(lay, x, y, z, pitch - 0.02, course, top ? 0.4 : 0.44, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.06, top ? 0 : row < 0 ? 1 : -1);
      }
    }
    // The ends, closed with a header a course.
    if (!top && c % 2) {
      for (const k of [-1, 1]) bag(lay, bx + k * (L / 2 - 0.18), y, bz, 0.62, course, 0.38, Math.PI / 2 + (rnd() - 0.5) * 0.1, 0, 0);
    }
  }
  lay.sb.box(L - 0.25, H - g - 0.05, D - 0.4, bx, (H + g) / 2 - 0.03, bz, SANDBAG, undefined, HIDE_DOWN);

  // What a position gathers.
  const r = rnd();
  if (r < 0.45) wire(lay, bx, H + 0.22, bz - 0.08, L - 0.2, rnd);
  else if (r < 0.65) stopBoard(lay, bx + (rnd() - 0.5) * 1.2, H, bz, rnd);
  else if (r < 0.82) {
    // A tyre laid on the top course.
    const m = lay.m(WINDOW_VOID);
    const tx = bx + (rnd() - 0.5) * 1.6;
    band(m, 10, 0, 0.36, H + 0.02, 0.36, H + 0.2, tx, bz);
    disc(m, 10, 0, 0.36, 0.2, H + 0.2, true, tx, bz);
    band(m, 10, 0, 0.2, H + 0.2, 0.2, H + 0.04, tx, bz);
  } else {
    // A jerrycan and an ammunition box.
    const jx = bx + (rnd() - 0.5) * 1.6;
    const jy = rnd() * 0.6;
    const c = Math.cos(jy);
    const sn = Math.sin(jy);
    const at = (u: number, w: number): [number, number] => [jx + u * c + w * sn, bz - u * sn + w * c];
    lay.sb.box(0.35, 0.45, 0.17, jx, H + 0.245, bz, PALM_BEAM, { y: jy }, HIDE_DOWN);
    // Its three handles across the top, its spout, and the X pressed in each side.
    for (const u of [-0.09, 0, 0.09]) {
      const [hx, hz] = at(u, 0);
      lay.sb.box(0.025, 0.05, 0.13, hx, H + 0.495, hz, PALM_BEAM, { y: jy }, HIDE_DOWN);
    }
    const [sx, sz] = at(0.15, 0);
    lay.sb.box(0.06, 0.07, 0.06, sx, H + 0.5, sz, PALM_BEAM, { y: jy }, HIDE_DOWN);
    for (const w of [-0.09, 0.09]) {
      const [xx, xz] = at(0, w);
      for (const k of [-1, 1]) lay.sb.box(0.4, 0.035, 0.012, xx, H + 0.24, xz, PALM_BEAM, { y: jy, z: k * 0.9 }, 0);
    }
    lay.sb.box(0.3, 0.2, 0.17, jx + 0.55, H + 0.12, bz + 0.1, IRON, { y: rnd() * 0.6 }, HIDE_DOWN);
  }
  // A bag burst at the foot, its sand spilled.
  if (rnd() < 0.5) {
    const sx = bx + (rnd() - 0.5) * L * 0.8;
    const sz = bz - D / 2 - 0.12;
    lobe(lay.m(SANDBAG), sx, ground(sx, sz) + 0.02, sz, 0.45, 0.18, rnd() * 0.2, rnd);
  }
}

/**
 * One sandbag: a filled sack `len` along its turn `yaw`, `wid` across and
 * the course `hgt` high, its end dropped `roll` — three rings (a foot drawn
 * in, the full belt a little under the middle, and the crown the fill pulls
 * in) and the crown's face, so the cel bands find a pillow and the ink its
 * seams. `back` leaves out the side toward the wall's core (-1 the -w
 * side, +1 the +w side, 0 neither).
 */
function bag(lay: Lay, x: number, y: number, z: number, len: number, hgt: number, wid: number, yaw: number, roll: number, back: -1 | 0 | 1): void {
  const m = lay.m(SANDBAG);
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const at = (u: number, v: number, w: number): V3 => [x + u * c + w * sn, y + v + u * roll, z - u * sn + w * c];
  const rings: [number, number, number][] = [
    [-hgt / 2, len * 0.46, wid * 0.42],
    [-hgt * 0.06, len / 2, wid / 2],
    [hgt / 2, len * 0.38, wid * 0.3],
  ];
  const corner = (r: [number, number, number], i: number): V3 => {
    const [v, hu, hw] = r;
    const su = i === 0 || i === 3 ? -1 : 1;
    const sw = i < 2 ? -1 : 1;
    return at(su * hu, v, sw * hw);
  };
  // The four sides in order -w, +u, +w, -u, as (corner i, corner j, the
  // side's outward in the bag's own frame).
  const sides: [number, number, number, number][] = [
    [0, 1, 0, -1],
    [1, 2, 1, 0],
    [2, 3, 0, 1],
    [3, 0, -1, 0],
  ];
  for (let r = 0; r + 1 < rings.length; r++) {
    for (const [i, j, nu, nw] of sides) {
      if (back !== 0 && nw === back) continue;
      const dv = rings[r + 1][0] - rings[r][0];
      const lean = nu !== 0 ? rings[r][1] - rings[r + 1][1] : rings[r][2] - rings[r + 1][2];
      const out: V3 = [nu * c + nw * sn, lean / dv, -nu * sn + nw * c];
      m.quad(corner(rings[r], i), corner(rings[r], j), corner(rings[r + 1], j), corner(rings[r + 1], i), out);
    }
  }
  const top = rings[2];
  m.quad(corner(top, 0), corner(top, 1), corner(top, 2), corner(top, 3), [0, 1, 0]);
}

/** A coil of wire along a barricade's top on two pickets: a helix of short bars. */
function wire(lay: Lay, x: number, y: number, z: number, len: number, rnd: () => number): void {
  const R = 0.24;
  const loops = Math.round(len / 0.32);
  const per = 6;
  let prev: V3 | null = null;
  for (let i = 0; i <= loops * per; i++) {
    const t = i / (loops * per);
    const th = (i / per) * TAU;
    const r = R * (0.9 + 0.1 * Math.sin(t * 17));
    const q: V3 = [x - len / 2 + t * len, y + Math.cos(th) * r, z + Math.sin(th) * r];
    if (prev) rod(lay, prev, q, 0.016, IRON);
    prev = q;
  }
  for (const k of [-1, 1]) {
    const sx = x + k * (len / 2 - 0.1);
    rod(lay, [sx, y - 0.32, z - 0.1], [sx + (rnd() - 0.5) * 0.06, y + 0.4, z - 0.12], 0.05, IRON);
  }
}

/**
 * A board painted with "stop" in red on white, stood on the top course at
 * the barricade's front edge and wired to a picket behind it.
 */
function stopBoard(lay: Lay, x: number, y: number, z: number, rnd: () => number): void {
  const s: Side = "-z";
  const back = hideBack(s);
  // The board's front face, as a plane for `onFace`: z = -(plane + out).
  const zf = z - 0.42;
  const plane = -zf;
  lay.sb.box(1.0, 0.62, 0.03, x, y + 0.33, zf + 0.015, WHITEWASH, undefined, HIDE_DOWN);
  for (const yy of [y + 0.08, y + 0.58]) lay.sb.onFace(s, plane, x, yy, 0.94, 0.07, 0.01, 0.004, AWNING, 0, 0, back);
  kufic(
    (ku, ky, along, tall) => lay.sb.onFace(s, plane, ku, ky, along, tall, 0.01, 0.005, AWNING, 0, 0, back),
    x - 0.38,
    x + 0.38,
    y + 0.15,
    0.36,
    rnd,
  );
  rod(lay, [x + 0.3, y - 0.1, zf + 0.12], [x + 0.32, y + 0.75, zf + 0.1], 0.05, IRON);
}

/** Spent cases in the road where it was fought over, and drifts against the piers. */
function litter(lay: Lay, ground: (x: number, z: number) => number, rnd: () => number): void {
  for (let i = 0; i < 40; i++) {
    const x = (rnd() - 0.5) * 9;
    const z = -8 + rnd() * 8;
    lay.sb.box(0.012, 0.012, 0.05, x, ground(x, z) + 0.008, z, ALLOY, { y: rnd() * TAU }, HIDE_DOWN);
  }
  const sand = lay.m(SANDBAG);
  for (const cx of [-PX, PX]) {
    // Against the approach face, and round the flank's corner.
    const k = Math.sign(cx);
    // Every drift stays inside the gatehouse's footprint row, which this
    // builder shares (`scripts/lib/footprints.mjs`).
    const x0 = cx + (rnd() - 0.5) * 0.6;
    lobe(sand, x0, ground(x0, -PH - 0.4) + 0.02, -PH - 0.4, 0.9 + rnd() * 0.3, 0.38, 0, rnd);
    const x1 = cx + k * (PH + 0.12);
    const z1 = -PH + 0.6 + rnd() * 0.8;
    lobe(sand, x1, ground(x1, z1) + 0.02, z1, 0.12, 0.9, 0, rnd);
  }
}
