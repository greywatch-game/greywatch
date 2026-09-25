/**
 * cloudShadow.ts — The GROUND's picture of the clouds: where each cloud lobe's
 * shadow falls, cast along the key light onto one horizontal plane, as a field
 * a shader can cut. Pure arithmetic — no Babylon, no state beyond its own
 * buffers, no clock — which is `cloudMasses.ts`'s shape and for its reason.
 * Owns: the projection of an ellipsoid along a direction, the field written per
 * texel, and how much of it is written per call. Owns no texture, no timing
 * and no light — `Sky` drives it and `wgsl/includes.ts` (`celCloud`) reads it.
 * Invariants: a texel no lobe reaches is 0; a texel's value is the MAX over
 * the lobes that reach it, so the union of lobes is one shape and the order
 * they are written in cannot change a byte; the value crosses 0.5 exactly on a
 * lobe's shadow outline; every call writes a bounded number of texels.
 * Contract: `docs/rendering.md` ("The clouds cast shadows").
 *
 * **KEY SPACE, and why one plane serves every height.** A point p is in a
 * cloud's shadow when the ray from p toward the light, p + t*s, passes through
 * the cloud. Every point on that ray shares one KEY — where the ray crosses
 * y = 0, which is p.xz - s.xz * p.y / s.y — so a roof and the street under it
 * each look themselves up at their own key, and a single 2D map answers for
 * every surface at every height. The shader computes the key from the world
 * position; this writes the map in key space.
 *
 * **What is written is a FIELD, not coverage**, and that is what lets a 4-9 m
 * texel draw a shadow edge as clean as the cel shader's own. Coverage sampled
 * bilinearly is a staircase at the texel's scale; a field that runs smoothly
 * through the outline is interpolated into a smooth outline, and the shader
 * cuts it at one pixel wide wherever it lands. For one lobe it is
 * `0.5 + 0.5 * (1 - sqrt(q))`, q being the texel's squared radius in the
 * lobe's own shadow ellipse — 0.5 on the outline, rising inside and falling
 * outside — written only out to `MARGIN` radii, past which the background's
 * 0 is further from the cut than anything the interpolation can bring in.
 */

/** How the field is laid over the world: a square in key space. */
export interface CloudShadowArea {
  /** Key-space x and z of the texture's texel-(0, 0) corner, in metres. */
  originX: number;
  originZ: number;
  /** Side of the square, in metres. */
  extent: number;
}

/** Floats per lobe in a lobe list: centre xyz, tangent xz, radii xyz. */
export const LOBE_STRIDE = 8;

/**
 * How far out, in a lobe's own shadow radii, its field is written. 1.5 is
 * 0.25 in the byte field — well clear of the 0.5 cut, so the step down to the
 * background's 0 at the edge of the written box never reaches the outline.
 */
const MARGIN = 1.5;

/**
 * One field being written a slice at a time. `begin` takes the lobes as they
 * will stand when the field is shown and resets it; `step` writes whole lobes
 * until a texel budget is spent and says whether it has finished.
 *
 * Incremental because the cost is priced on the SUN rather than on the cloud:
 * a low light stretches a lobe's shadow by 1 / sin(elevation), four times at
 * Harrowmead's 14.5 degrees, so one heap straddling the sun can reach tens of
 * thousands of texels, and doing a whole field in one frame on a phone is the
 * hitch `FINDINGS.md` §1 is hunting. The caller builds the NEXT field while
 * the shader crossfades the two before it, so there is time to spread it.
 */
export class CloudShadowRaster {
  /** The field, one byte a texel, row 0 the min-z edge. */
  readonly field: Uint8Array;
  private lobes = new Float32Array(0);
  private count = 0;
  private next = 0;
  private sx = 0;
  private sy = 1;
  private sz = 0;
  private area: CloudShadowArea = { originX: 0, originZ: 0, extent: 1 };

  /** Texels along each side. */
  readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.field = new Uint8Array(size * size);
  }

  /** True once every lobe handed to `begin` has been written. */
  get done(): boolean {
    return this.next >= this.count;
  }

  /**
   * Starts a field: `lobes` is `count` lobes of `LOBE_STRIDE` floats in WORLD
   * metres (copied, so the caller may reuse its buffer), `toLight` the unit
   * direction toward the light, which must point up.
   */
  begin(
    lobes: Float32Array,
    count: number,
    toLight: { x: number; y: number; z: number },
    area: CloudShadowArea,
  ): void {
    if (this.lobes.length < count * LOBE_STRIDE) {
      this.lobes = new Float32Array(count * LOBE_STRIDE);
    }
    this.lobes.set(lobes.subarray(0, count * LOBE_STRIDE));
    this.count = count;
    this.next = 0;
    this.sx = toLight.x;
    this.sy = toLight.y;
    this.sz = toLight.z;
    this.area = area;
    this.field.fill(0);
  }

  /**
   * Writes lobes until at least `budget` texels have been visited or the list
   * is finished, and says whether it is finished. A lobe is never split, so
   * one call can overrun its budget by one lobe's box — which the box's clip
   * to the square bounds.
   */
  step(budget: number): boolean {
    let spent = 0;
    while (this.next < this.count && spent < budget) {
      spent += this.lobe(this.next++);
    }
    return this.done;
  }

  /** Writes one lobe's shadow; returns how many texels it visited. */
  private lobe(index: number): number {
    const L = this.lobes;
    const o = index * LOBE_STRIDE;
    const cx = L[o], cy = L[o + 1], cz = L[o + 2];
    const tx = L[o + 3], tz = L[o + 4];
    const a = 1 / (L[o + 5] * L[o + 5]);
    const b = 1 / (L[o + 6] * L[o + 6]);
    const c = 1 / (L[o + 7] * L[o + 7]);
    const ux = this.sx, uy = this.sy, uz = this.sz;
    // The ellipsoid as a quadratic form, A = T T'/sx^2 + Y Y'/sy^2 + R R'/sz^2
    // with T its tangent, Y up and R = (tz, 0, -tx). No xy or yz terms: both
    // horizontal axes are level.
    const axx = a * tx * tx + c * tz * tz;
    const axz = (a - c) * tx * tz;
    const azz = a * tz * tz + c * tx * tx;
    // Its SHADOW along s: the points whose ray toward the light meets it. The
    // nearest approach of the ray is minimised over t in closed form, leaving
    // B = A - (A s)(A s)' / (s' A s); B s = 0, so only the key's offset from
    // the centre's own key matters, and on the plane that is a 2x2 form.
    const asx = axx * ux + axz * uz;
    const asy = b * uy;
    const asz = axz * ux + azz * uz;
    const sas = ux * asx + uy * asy + uz * asz;
    if (!(sas > 0)) return 0;
    const bxx = axx - (asx * asx) / sas;
    const bxz = axz - (asx * asz) / sas;
    const bzz = azz - (asz * asz) / sas;
    const det = bxx * bzz - bxz * bxz;
    if (!(det > 0)) return 0;
    // The centre's key, and the box the written margin fits in.
    const kx = cx - (ux * cy) / uy;
    const kz = cz - (uz * cy) / uy;
    const hx = MARGIN * Math.sqrt(bzz / det);
    const hz = MARGIN * Math.sqrt(bxx / det);
    const n = this.size;
    const texel = this.area.extent / n;
    const i0 = Math.max(0, Math.floor((kx - hx - this.area.originX) / texel));
    const i1 = Math.min(n - 1, Math.ceil((kx + hx - this.area.originX) / texel));
    const j0 = Math.max(0, Math.floor((kz - hz - this.area.originZ) / texel));
    const j1 = Math.min(n - 1, Math.ceil((kz + hz - this.area.originZ) / texel));
    if (i0 > i1 || j0 > j1) return 0;
    const f = this.field;
    const limit = MARGIN * MARGIN;
    for (let j = j0; j <= j1; j++) {
      const wz = this.area.originZ + (j + 0.5) * texel - kz;
      const row = j * n;
      for (let i = i0; i <= i1; i++) {
        const wx = this.area.originX + (i + 0.5) * texel - kx;
        const q = bxx * wx * wx + 2 * bxz * wx * wz + bzz * wz * wz;
        if (q >= limit) continue;
        const v = Math.round((1 - 0.5 * Math.sqrt(q)) * 255);
        if (v > f[row + i]) f[row + i] = v;
      }
    }
    return (i1 - i0 + 1) * (j1 - j0 + 1);
  }
}
