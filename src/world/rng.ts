/**
 * rng.ts — The one seeded PRNG the world layer uses.
 * Owns: mulberry32, and nothing else.
 *
 * Why this exists as a shared file rather than a local helper: anything that
 * places geometry from a seed has to agree on the generator, or two systems
 * seeded alike still disagree. GrassSystem grows its field from one; MapBuilder
 * scatters props from one. Scatter matters more than it looks — blocking props
 * emit colliders, colliders feed NavGrid and ObstacleField, so an unseeded
 * scatter means the navigation graph differs between page loads and a bot that
 * wedges itself on a boulder does it only on some boots.
 *
 * Never reach for Math.random() in world-building code. A map must build the
 * same way every time or none of its nav gotchas are reproducible.
 */

/**
 * Mulberry32: 32-bit state, no dependencies, good enough for scatter and far
 * cheaper than anything with a real period guarantee. Returns [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
