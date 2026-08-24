/**
 * Generates the water foam mask, committed under `textures/`. Zero
 * dependencies — the PNG is encoded by hand with zlib from Node's stdlib.
 *
 * Run with `npm run textures`. Deterministic (fixed seed), so regenerating
 * never produces diff churn unless the parameters below change.
 *
 * - `water-foam.png`    256x256 grayscale mask: ridged fBm broken up by a
 *   low-frequency blob field, read as a shoreline foam pattern.
 *
 * **There was a `water-normal.png` here and it is not coming back.** The
 * water surface was three scrolled layers of a 512px tiling normal map, and
 * every rule the shader carried — rotate each layer off the world axes, warp
 * each by the one above it, fade the fine ones out with distance, never
 * tighten the uv scales — existed to stop a lattice being visible on a plane
 * the size of a valley. It was visible anyway, as low-frequency cloudy
 * mottling with no direction in it, which is what fBm is and is not what
 * water is. The surface is now summed from directional wave trains in the
 * fragment shader, which has no lattice to hide; see `shaders/WaterShader.ts`.
 * A foam MASK is a different job — it is read through a smoothstep in a band a
 * metre wide — and it stays.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "textures");

// ---------------------------------------------------------------------------
// Minimal PNG encoder (8-bit RGB, no interlace).
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
    Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(
      raw,
      y * stride + 1,
    );
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
// Deterministic PRNG + tileable value noise.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise on a wrapped lattice: sampling x,y in [0, lattice) tiles. */
function makeNoise(seed, lattice) {
  const rand = mulberry32(seed);
  const values = new Float32Array(lattice * lattice);
  for (let i = 0; i < values.length; i++) values[i] = rand();
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = smooth(x - xi);
    const v = smooth(y - yi);
    const x0 = ((xi % lattice) + lattice) % lattice;
    const y0 = ((yi % lattice) + lattice) % lattice;
    const x1 = (x0 + 1) % lattice;
    const y1 = (y0 + 1) % lattice;
    const v00 = values[y0 * lattice + x0];
    const v10 = values[y0 * lattice + x1];
    const v01 = values[y1 * lattice + x0];
    const v11 = values[y1 * lattice + x1];
    return (
      v00 + (v10 - v00) * u + (v01 - v00) * v + (v00 - v10 - v01 + v11) * u * v
    );
  };
}

/** fBm over wrapped lattices, normalised to roughly 0..1. */
function makeFbm(seed, lattices) {
  const layers = lattices.map((lattice, i) => ({
    noise: makeNoise(seed + i * 101, lattice),
    lattice,
    amp: 0.5 ** i,
  }));
  const norm = layers.reduce((s, l) => s + l.amp, 0);
  return (x, y) => {
    let sum = 0;
    for (const { noise, lattice, amp } of layers) {
      sum += noise(x * lattice, y * lattice) * amp;
    }
    return sum / norm;
  };
}

// ---------------------------------------------------------------------------
// Foam mask: ridged fBm (sharp crests) patched by a low-frequency blob field
// so the foam clumps instead of covering the tile evenly.
// ---------------------------------------------------------------------------

function generateFoamMask(size) {
  const fbm = makeFbm(4242, [6, 12, 24, 48]);
  const blobs = makeFbm(99, [3, 6]);
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbm(u, v);
      let r = 1 - Math.abs(2 * n - 1); // ridged
      r = r * r; // sharpen crests
      const b = blobs(u, v);
      const value = Math.max(0, Math.min(1, r * (0.25 + 1.1 * b)));
      const byte = Math.round(value * 255);
      const i = (y * size + x) * 3;
      rgb[i] = byte;
      rgb[i + 1] = byte;
      rgb[i + 2] = byte;
    }
  }
  return rgb;
}

// ---------------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });
const foamSize = 256;
writeFileSync(
  join(outDir, "water-foam.png"),
  encodePNG(foamSize, foamSize, generateFoamMask(foamSize)),
);
console.log(`wrote textures/water-foam.png (${foamSize}px)`);
