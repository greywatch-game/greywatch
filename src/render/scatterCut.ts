/**
 * render/scatterCut.ts — The SCATTER's half of the map's cut (`WorldBlocks`,
 * `BABYLON_EXIT.md` X3.4b, X3.5b — the fold): what a group's instanced parts
 * are made into for the instance cull, the instances' transforms the vertex
 * stage reads, and the budget a cut's scatter is held to.
 * Owns: what `WorldBlocks.finish` is told about the scatter (`ScatterCut`,
 * `InstanceSet`) and the parts it is handed (`InstancedPart`);
 * `ScatterTables`, the instance cull's tables built group by group;
 * `uploadTransforms`; and the budget — `partRecords`, `listPast`,
 * `sourcePast`.
 * Invariants: a group's parts are cut in the order handed, each into
 * clusters in its set's own frame, its 16-bit indices laid end to end in the
 * one source, every cluster of it carrying where its part starts in its
 * group's arrays, where the parts come FIRST (`scatterList.ts`); a RECORD is
 * one cluster of one instance — part by part, instance by instance, cluster
 * by cluster — and a group's records are one RANGE, one a group in group
 * order, empty for a group drawing no scatter, so range `g` is group `g`'s;
 * a range's run of the list starts at its first record; an instance's
 * sphere is its set's — over every part handed of it, in its own frame —
 * moved by its matrix and grown by its scale, and a set none of whose parts
 * is handed has a sphere of nothing at its placement, which no record names;
 * an instance carries the block its copy was merged into (`InstanceSet.keys`),
 * which a probe's view leaves out by;
 * the transforms are every set's instances in the instance table's order.
 * `partRecords` counts what `ScatterTables.add` makes, so the budget is
 * checked before anything is cut.
 * Never: imports Babylon; reads a node; uploads but the transforms.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import type { ScanRange } from "./ClusterCull";
import { TRANSFORM_WORDS, writeTransform } from "./celVertex";
import { type Cluster, cutClusters, type SurfaceArrays, toFloat32 } from "./clusters";
import type { InstanceTables } from "./InstanceCull";
import { LIST_WORDS, listStride, SCATTER_CORNERS, SOURCE_VERTICES } from "./scatterList";
import { CLUSTER_WORDS, writeCluster } from "./wgsl/clusterCull";
import { INSTANCE_WORDS, RECORD_WORDS } from "./wgsl/instanceCull";

/** One SET of instances: a variant's placements, as `finish` is handed them. */
export interface InstanceSet {
  /** Each instance's world matrix, 16 floats laid out as WGSL's `mat4x4f` reads them. */
  readonly matrices: Float32Array;
  /** Each instance's uniform scale. */
  readonly scales: Float32Array;
  /**
   * The block each instance's copy was merged into, as the culls carry it
   * (`blockKey`): its REGION's, which is where the block merge files a
   * scatter field — never the instance's own place (`ScatterSet.blocks`).
   */
  readonly keys: Uint32Array;
}

/** What `finish` is told about the scatter: which pieces to cut, and the sets. */
export interface ScatterCut {
  /** A piece the instances draw instead (a scatter region). */
  readonly cut: (piece: number) => boolean;
  /** Indexed by the `set` each instanced part was added with. */
  readonly sets: readonly InstanceSet[];
}

/** An instanced part as handed over: drawn once per surviving instance of its set. */
export interface InstancedPart {
  readonly geometry: SurfaceArrays;
  readonly set: number;
  /** The shadow passes its clusters are drawn in (`PASS_CASTS`, `PASS_SOLID`). */
  readonly passes: number;
}

/** The records `part` makes: its clusters — runs of the most a cluster holds, as `cutClusters` cuts a part with no piece — times its set's instances. */
export function partRecords(part: InstancedPart, sets: readonly InstanceSet[], triangles: number): number {
  return Math.ceil(part.geometry.indices.length / listStride(triangles)) * sets[part.set].scales.length;
}

/**
 * Why the scatter's list cannot hold `records` survivors of clusters of
 * `triangles` — past what an index names, or past the device's `storage`
 * bytes — or null when it can.
 */
export function listPast(records: number, triangles: number, storage: number): string | null {
  const stride = listStride(triangles);
  if (records * stride > SCATTER_CORNERS) {
    return `the scatter's list (${records} records of ${stride} corners) is past what an index names`;
  }
  if (records * LIST_WORDS * 4 > storage) {
    return `the scatter's list (${records} records) is past the device's ${storage} bytes`;
  }
  return null;
}

/** Why `parts` cannot be read through the 16-bit source — a part past `SOURCE_VERTICES` — or null. */
export function sourcePast(parts: readonly InstancedPart[]): string | null {
  let widest = 0;
  for (const p of parts) widest = Math.max(widest, p.geometry.positions.length / 3);
  return widest > SOURCE_VERTICES
    ? `an instanced part's ${widest} vertices are past the 16-bit source (${SOURCE_VERTICES})`
    : null;
}

/**
 * Every instance's transform, `TRANSFORM_WORDS` each, set by set as the
 * instance table orders them: what group 2 binds in every group, so a map
 * with no scatter still binds one, never read. A buffer of its own rather
 * than the instance cull's table, whose records carry the same transform:
 * the stage reads twelve words an instance, never the cull's twenty, and a
 * group binds it whether or not there is a cull.
 */
export function uploadTransforms(device: GPUDevice, sets: readonly InstanceSet[]): GPUBuffer {
  let total = 0;
  for (const set of sets) total += set.scales.length;
  const buffer = device.createBuffer({
    label: "world blocks: transforms",
    size: Math.max(1, total) * TRANSFORM_WORDS * 4,
    usage: GPUBufferUsage.STORAGE,
    mappedAtCreation: true,
  });
  const dst = new Float32Array(buffer.getMappedRange());
  let at = 0;
  for (const set of sets) {
    for (let i = 0; i < set.scales.length; i++, at++) {
      writeTransform(set.matrices.subarray(i * 16, i * 16 + 16), dst, at * TRANSFORM_WORDS);
    }
  }
  buffer.unmap();
  return buffer;
}

/** A cluster of an instanced part, as the instance cull's table carries it. */
interface PartCluster {
  readonly cluster: Cluster;
  /** Its first index into the source. */
  readonly first: number;
  /** Its range: its group's. */
  readonly range: number;
  /** Its part's first vertex in its group's arrays. */
  readonly base: number;
  /** Its part's shadow passes. */
  readonly passes: number;
}

/** The instance cull's tables, built as the cut walks its groups. */
export class ScatterTables {
  /** Each set's first instance in the instance table. */
  private readonly setStarts: number[] = [];
  private readonly instanceTotal: number;
  private readonly clusters: PartCluster[] = [];
  private readonly records: number[] = [];
  private readonly ranges: ScanRange[] = [];
  /** Every part's own indices, 16 bits (`SOURCE_VERTICES`). */
  private readonly source: Uint16Array;
  /** Where the next part's source starts. */
  private sourceAt = 0;
  /** Each set's box, over every part handed of it, in its own frame. */
  private readonly lo: number[][];
  private readonly hi: number[][];
  /** The most each set's vertices can sway: the largest ramp weight, and whether any is rigged. */
  private readonly ramp: number[];
  private readonly rigged: boolean[];

  constructor(
    private readonly sets: readonly InstanceSet[],
    /** The source's length: every part to be handed, its indices (`WorldBlocks.measure`). */
    sourceLength: number,
    /** The most triangles a cluster holds (`CONFIG.graphics.clusters`). */
    private readonly triangles: number,
  ) {
    let total = 0;
    for (const s of sets) {
      this.setStarts.push(total);
      total += s.scales.length;
    }
    this.instanceTotal = total;
    this.source = new Uint16Array(sourceLength);
    this.lo = sets.map(() => [Infinity, Infinity, Infinity]);
    this.hi = sets.map(() => [-Infinity, -Infinity, -Infinity]);
    this.ramp = sets.map(() => 0);
    this.rigged = sets.map(() => false);
  }

  /** The records cut so far: what the list holds at most. */
  get recordCount(): number {
    return this.records.length / RECORD_WORDS;
  }

  /**
   * The next group's instanced parts — called once a group, in group order,
   * so the range it opens is the group's: each part's own indices into the
   * source, each part cut into clusters, and a record for every cluster of
   * every instance wearing it. Returns the vertices the parts take, where the
   * group's surfaces start in its arrays, and the records it made: none for a
   * group that draws no scatter.
   */
  add(parts: readonly InstancedPart[]): { vertices: number; records: number } {
    const range = this.ranges.length;
    const recordStart = this.recordCount;
    let vertices = 0;
    for (const p of parts) {
      const positions = toFloat32(p.geometry.positions);
      const local = p.geometry.indices;
      this.source.set(local, this.sourceAt);
      this.grow(p.set, positions, p.geometry.colors);
      const first = this.clusters.length;
      const clusters = cutClusters(positions, local, p.geometry.colors, [], this.triangles);
      for (const cluster of clusters) {
        this.clusters.push({ cluster, first: this.sourceAt + cluster.indexStart, range, base: vertices, passes: p.passes });
      }
      for (let i = this.setStarts[p.set], end = i + this.sets[p.set].scales.length; i < end; i++) {
        for (let c = 0; c < clusters.length; c++) this.records.push(i, first + c);
      }
      this.sourceAt += local.length;
      vertices += positions.length / 3;
    }
    // The list's entries are a record's, so its run starts at its first.
    const end = this.recordCount;
    this.ranges.push({ start: recordStart, end, base: recordStart });
    return { vertices, records: end - recordStart };
  }

  /**
   * The instance cull's tables, once every group is added: every set's
   * instances, set by set, each with its world sphere and its set's sway,
   * and the clusters, records, ranges and source the groups made.
   */
  tables(bands2: readonly number[]): InstanceTables {
    const sets = this.sets;
    const words = new ArrayBuffer(Math.max(1, this.instanceTotal) * INSTANCE_WORDS * 4);
    const f = new Float32Array(words);
    const u = new Uint32Array(words);
    const out: InstanceTables["sets"][number][] = [];
    sets.forEach((set, s) => {
      const l = this.lo[s];
      const h = this.hi[s];
      const drawn = l[0] <= h[0];
      const cx = drawn ? (l[0] + h[0]) / 2 : 0;
      const cy = drawn ? (l[1] + h[1]) / 2 : 0;
      const cz = drawn ? (l[2] + h[2]) / 2 : 0;
      const r = drawn ? Math.hypot(h[0] - l[0], h[1] - l[1], h[2] - l[2]) / 2 : 0;
      const at = this.setStarts[s];
      const n = set.scales.length;
      for (let i = 0; i < n; i++) {
        const m = set.matrices.subarray(i * 16, i * 16 + 16);
        const o = (at + i) * INSTANCE_WORDS;
        f[o] = m[0] * cx + m[4] * cy + m[8] * cz + m[12];
        f[o + 1] = m[1] * cx + m[5] * cy + m[9] * cz + m[13];
        f[o + 2] = m[2] * cx + m[6] * cy + m[10] * cz + m[14];
        f[o + 3] = r * set.scales[i];
        writeTransform(m, f, o + 4);
        u[o + 16] = s;
        u[o + 17] = set.keys[i];
      }
      out.push({ start: at, end: at + n, ramp: this.ramp[s], rigged: this.rigged[s] });
    });
    return {
      instances: words,
      instanceCount: this.instanceTotal,
      sets: out,
      clusters: clusterWords(this.clusters),
      records: Uint32Array.from(this.records),
      ranges: this.ranges,
      source: this.source,
      bands2,
    };
  }

  /** Set `set`'s box and sway grown by one part's vertices. */
  private grow(set: number, positions: Float32Array, colors: ArrayLike<number> | null): void {
    const l = this.lo[set];
    const h = this.hi[set];
    for (let i = 0, v = 0; i < positions.length; i += 3, v++) {
      for (let a = 0; a < 3; a++) {
        if (positions[i + a] < l[a]) l[a] = positions[i + a];
        if (positions[i + a] > h[a]) h[a] = positions[i + a];
      }
      if (colors) {
        const r = colors[v * 4];
        if (r > this.ramp[set]) this.ramp[set] = r;
        else if (r < 0) this.rigged[set] = true;
      }
    }
  }
}

/**
 * The instanced parts' clusters as the instance cull reads them
 * (`InstanceTables.clusters`): the same record, its first index into the
 * 16-bit source and its range in the place of a group, its part's first
 * vertex beside it, and its part's shadow passes.
 */
function clusterWords(clusters: readonly PartCluster[]): ArrayBuffer {
  const words = new ArrayBuffer(Math.max(1, clusters.length) * CLUSTER_WORDS * 4);
  const f = new Float32Array(words);
  const u = new Uint32Array(words);
  clusters.forEach(({ cluster, first, range, base, passes }, k) =>
    writeCluster(f, u, k, cluster, first, [range, base, 0, 0], passes),
  );
  return words;
}
