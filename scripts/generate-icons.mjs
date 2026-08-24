/**
 * Generates the PWA install icons, committed under `public/icons/`. Zero
 * dependencies — PNGs are encoded by hand with zlib from Node's stdlib, the
 * same as `generate-water-textures.mjs`.
 *
 * Run with `npm run icons`. Deterministic (there is no noise here at all), so
 * regenerating never produces diff churn unless the parameters below change.
 *
 * The mark is the HUD's own control-point hexagon (`.flag` in index.html: a
 * pointy-top hull with a 2px rim and a capture meter filling from the bottom),
 * drawn in the friendly amber. It is the one shape in this game that is
 * already a logo, and an icon that matches the flag strip is recognisable at
 * 48px on a home screen where a village rooftop would not be.
 *
 * - `icon-192.png` / `icon-512.png`  the `any` purpose icons.
 * - `icon-maskable-512.png`          same mark, shrunk to the maskable safe
 *   zone (a circle 80% of the icon's width — a launcher may crop everything
 *   outside it to whatever shape it likes) on a full-bleed background.
 * - `apple-touch-icon.png`           180px, for iOS's Add to Home Screen,
 *   which ignores the manifest's icons entirely and applies its own corner
 *   mask (so it takes the un-shrunk mark, not the maskable one).
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "icons",
);

// ---------------------------------------------------------------------------
// Minimal PNG encoder (8-bit RGB, no interlace). Icons are opaque on purpose:
// a maskable icon must fill its whole box, and iOS composites a transparent
// touch icon onto black anyway.
// ---------------------------------------------------------------------------

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgb) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// The mark. Everything is in unit coordinates (0..1 across the icon) so one
// description serves every size, and the only thing a size changes is how many
// samples it is drawn with.
// ---------------------------------------------------------------------------

/** HUD palette, straight from index.html's custom properties. */
const AMBER = [0xff, 0xc4, 0x6b]; // --mine
const HOT = [0xff, 0xe6, 0x80]; // --hot
const CORE = [0x08, 0x0b, 0x11]; // the flag's dark inset
const BG_TOP = [0x14, 0x19, 0x24];
const BG_BOTTOM = [0x05, 0x07, 0x0b];

/** The `.flag` hull: pointy-top, flat-sided, 36x42 in the HUD. */
const HEX = [
  [0.5, 0.0],
  [1.0, 0.26],
  [1.0, 0.74],
  [0.5, 1.0],
  [0.0, 0.74],
  [0.0, 0.26],
];

const HEX_ASPECT = 42 / 36;
/** How much of the capture meter is filled. Reads as a point being taken. */
const CAPTURE = 0.58;

/** Crossing test against a polygon given as [x, y] pairs. */
function inPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** The hull placed in the icon: `width` wide, centred, scaled about the centre. */
function hexPoly(width, inset) {
  const w = width - 2 * inset;
  const h = width * HEX_ASPECT - 2 * inset;
  const x0 = 0.5 - w / 2;
  const y0 = 0.5 - h / 2;
  return HEX.map(([u, v]) => [x0 + u * w, y0 + v * h]);
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Colour at one sample point. Returns a float RGB triple; the caller averages
 * the samples in a pixel, which is where the antialiasing comes from — there
 * are no curves here, only long diagonals, and those are exactly what a hard
 * edge makes ugly at 48px.
 */
function sample(x, y, scale) {
  const width = 0.62 * scale;
  const rim = 0.042 * scale;
  const outer = hexPoly(width, 0);
  const inner = hexPoly(width, rim);

  // Background: a vertical gradient with the moon's own falloff, lifted a
  // little behind the mark so the hull does not sit on dead black.
  const glow = Math.max(
    0,
    1 - Math.hypot(x - 0.5, y - 0.5) / (0.75 * scale + 0.25),
  );
  let col = mix(BG_TOP, BG_BOTTOM, y);
  col = mix(col, [0x2a, 0x22, 0x1a], glow * glow * 0.55);

  if (!inPolygon(outer, x, y)) return col;
  if (!inPolygon(inner, x, y)) return AMBER; // the rim IS the hull

  col = CORE;
  // The capture meter, filling from the bottom of the inner hull.
  const top = 0.5 + (width * HEX_ASPECT) / 2 - rim;
  const bottom = top - (width * HEX_ASPECT - 2 * rim) * CAPTURE;
  if (y > bottom) {
    // Brightest at the meter's leading edge, which is where the eye goes.
    const t = Math.min(1, (y - bottom) / (0.06 * scale));
    col = mix(mix(HOT, AMBER, t), CORE, 0.2);
  }
  return col;
}

function render(size, scale) {
  const rgb = new Uint8Array(size * size * 3);
  const SS = 4; // 4x4 supersamples per pixel
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(
            (px + (sx + 0.5) / SS) / size,
            (py + (sy + 0.5) / SS) / size,
            scale,
          );
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (py * size + px) * 3;
      const n = SS * SS;
      rgb[i] = Math.round(r / n);
      rgb[i + 1] = Math.round(g / n);
      rgb[i + 2] = Math.round(b / n);
    }
  }
  return encodePNG(size, size, rgb);
}

mkdirSync(outDir, { recursive: true });

// The maskable scale: the mark's bounding circle must fit the safe zone, a
// circle 80% of the icon's width. At scale 1 that circle has diameter ~0.95.
const MASKABLE = 0.8 / 0.95;

for (const [name, size, scale] of [
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["icon-maskable-512.png", 512, MASKABLE],
  ["apple-touch-icon.png", 180, 1],
]) {
  const png = render(size, scale);
  writeFileSync(join(outDir, name), png);
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
