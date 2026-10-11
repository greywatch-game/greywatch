/**
 * src/sim/publication.ts — The simulation's STATE and NEWS laid out in
 * shared memory: what a core in a Worker PUBLISHES after every operation and
 * what the page READS back (`BABYLON_EXIT.md` X2.5b).
 * Owns: the layout of one publication — a header of float64s, the frame's
 * every array (`src/sim/frame.ts`) at a fixed offset, and the event ring's
 * four arrays after them — and the two halves that agree on it:
 * `PublicationWriter` (the Worker's, copying the core's frame and a drain in)
 * and `PublicationReader` (the page's, handing back a `SimFrame` made of views
 * onto the buffer and appending the events to a ring of its own).
 * Invariants:
 * - **The layout is DERIVED from `newFrame()`, never written out.** Both
 *   halves walk the same template at module load — every typed array is a
 *   leaf, every number a scalar, every plain object a section — so a field
 *   added to the frame crosses the boundary without a line here. What varies
 *   per round (each leaf's length, the event capacities) is written into the
 *   publication's own header with a layout VERSION, and the reader rebuilds
 *   its views only when that version moves: a round boundary, or a step that
 *   said more than any before it.
 * - **Allocation-free per publication** on both threads once a layout stands:
 *   the writer copies with `TypedArray.set` and indexed loops into views it
 *   holds, the scalars go through `frame.ts`' written-out pair (computed keys
 *   would box every double), and the reader copies events into a ring it
 *   holds. A new layout allocates views (and may `grow` the
 *   buffer), which is a round's cost, not a frame's.
 * - **Bits preserved**: every array is copied as its own type, every scalar
 *   as a float64, so the frame a reader gets is the core's frame `Object.is`
 *   for `Object.is` — the property `?simcheck` holds the in-page core to.
 * - **Double-buffered by the CALLER.** A writer writes buffer `b` and a reader
 *   reads buffer `b`; which `b` is the transport's (`simHost.ts`: an
 *   operation's sequence number, so the Worker writes one buffer while the
 *   page still reads the other). Nothing here synchronises — the transport's
 *   handshake is what makes a buffer one side's at a time.
 * Never: decide, or hold anything of the simulation's. A publication is
 * numbers.
 */
import { STRIDE, type EventCursor, type EventRing } from "./events";
import { FRAME_SCALARS, newFrame, readScalars, writeScalars, type SimFrame } from "./frame";

type View =
  | Float64Array
  | Float32Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array;
interface ViewCtor {
  new (buffer: ArrayBufferLike, byteOffset: number, length: number): View;
  readonly BYTES_PER_ELEMENT: number;
}

/** A leaf or a scalar: a key, on the frame itself (`sec` null) or on one of its sections. */
interface Field {
  readonly sec: string | null;
  readonly key: string;
}
interface Leaf extends Field {
  readonly ctor: ViewCtor;
}

/** Walked once, in the template's own key order — the order both halves agree on. */
const SECTIONS: string[] = [];
const LEAVES: Leaf[] = [];
const SCALARS: Field[] = [];
{
  const template = newFrame() as unknown as Record<string, unknown>;
  for (const key of Object.keys(template)) {
    const v = template[key];
    if (ArrayBuffer.isView(v)) LEAVES.push({ sec: null, key, ctor: v.constructor as ViewCtor });
    else if (typeof v === "number") SCALARS.push({ sec: null, key });
    else {
      SECTIONS.push(key);
      const section = v as Record<string, unknown>;
      for (const k of Object.keys(section)) {
        const w = section[k];
        if (ArrayBuffer.isView(w)) LEAVES.push({ sec: key, key: k, ctor: w.constructor as ViewCtor });
        else if (typeof w === "number") SCALARS.push({ sec: key, key: k });
        else throw new Error(`[publication] frame.${key}.${k} is neither an array nor a number`);
      }
    }
  }
}

// The scalars are copied by `frame.ts`' own written-out pair (a copy through
// computed keys boxes every double), and that list must be the walk's.
{
  const walked = SCALARS.map((f) => (f.sec === null ? f.key : `${f.sec}.${f.key}`)).join();
  if (walked !== FRAME_SCALARS.join()) {
    throw new Error(`[publication] FRAME_SCALARS is not the frame's scalars: ${walked}`);
  }
}

// The header, in float64s.
/** The layout's version — moves when any leaf's length or an event capacity does. */
const H_VERSION = 0;
/** What the operation returned: `step`'s "the round is live", 1 or 0. */
const H_LIVE = 1;
/** Events and side ints in this publication. */
const H_EVENTS = 2;
const H_INTS = 3;
/** The event region's capacities: records, and side ints. */
const H_EVCAP = 4;
const H_INTCAP = 5;
/** The operation this publication answers (the transport's code). */
const H_OP = 6;
const H_SCALARS = 8;
const H_TIMING_START = H_SCALARS + FRAME_SCALARS.indexOf("timing.start");
const H_TIMING_TOTAL = H_SCALARS + FRAME_SCALARS.indexOf("timing.total");
const H_LENGTHS = H_SCALARS + SCALARS.length;
/** Float64s of header before the first leaf. */
const HEADER = H_LENGTHS + LEAVES.length;

const align8 = (n: number): number => (n + 7) & ~7;

/**
 * The byte offset of every leaf, then of the four event arrays, for these
 * lengths and capacities — into `out` (`LEAVES.length + 4` entries). Returns
 * the bytes the whole publication needs.
 */
function layOut(lengths: ArrayLike<number>, evCap: number, intCap: number, out: Int32Array): number {
  let at = HEADER * 8;
  for (let i = 0; i < LEAVES.length; i++) {
    out[i] = at;
    at = align8(at + lengths[i] * LEAVES[i].ctor.BYTES_PER_ELEMENT);
  }
  const e = LEAVES.length;
  out[e] = at; // kinds, Uint8
  at = align8(at + evCap);
  out[e + 1] = at; // ticks, Uint32
  at = align8(at + evCap * 4);
  out[e + 2] = at; // data, Float64
  at = align8(at + evCap * STRIDE * 8);
  out[e + 3] = at; // ints, Int32
  at = align8(at + intCap * 4);
  return at;
}

/**
 * A growable `SharedArrayBuffer` for one publication: room for a round's
 * frame from the start, and a ceiling far over any map's (the Worker grows it
 * when a layout needs more — `PublicationWriter`).
 */
export function newPublicationBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer(256 * 1024, { maxByteLength: 16 * 1024 * 1024 });
}

/** One buffer's views, for the layout version it was built at. */
interface BufferViews {
  version: number;
  header: Float64Array;
  leaves: View[];
  kinds: Uint8Array;
  ticks: Uint32Array;
  data: Float64Array;
  ints: Int32Array;
}

function viewsOf(sab: SharedArrayBuffer, version: number, lengths: ArrayLike<number>, evCap: number, intCap: number, offsets: Int32Array): BufferViews {
  const header = new Float64Array(sab, 0, HEADER);
  const leaves: View[] = [];
  for (let i = 0; i < LEAVES.length; i++) {
    leaves.push(new LEAVES[i].ctor(sab, offsets[i], lengths[i]));
  }
  const e = LEAVES.length;
  return {
    version,
    header,
    leaves,
    kinds: new Uint8Array(sab, offsets[e], evCap),
    ticks: new Uint32Array(sab, offsets[e + 1], evCap),
    data: new Float64Array(sab, offsets[e + 2], evCap * STRIDE),
    ints: new Int32Array(sab, offsets[e + 3], intCap),
  };
}

/** `frame[sec][key]`, or `frame[key]` when `sec` is null. */
function owner(frame: SimFrame, sec: string | null): Record<string, unknown> {
  const f = frame as unknown as Record<string, unknown>;
  return (sec === null ? f : f[sec]) as Record<string, unknown>;
}

/**
 * The Worker's half: the core's frame and one drain, copied into buffer `b`.
 */
export class PublicationWriter {
  private version = 0;
  private readonly lengths = new Int32Array(LEAVES.length);
  private readonly offsets = new Int32Array(LEAVES.length + 4);
  private evCap = 512;
  private intCap = 256;
  /** The frame's arrays as they stood at the last layout — what `set` copies from. */
  private readonly src: View[] = [];
  /** The section objects and top-level arrays as they stood — the identity test. */
  private readonly heldSections: unknown[] = SECTIONS.map(() => null);
  private readonly heldTop: unknown[] = [];
  private readonly views: (BufferViews | null)[] = [null, null];

  constructor(private readonly buffers: readonly SharedArrayBuffer[]) {}

  /** Whether a section or a top-level array of `frame` is not the object the layout was taken off. */
  private moved(frame: SimFrame): boolean {
    const f = frame as unknown as Record<string, unknown>;
    for (let i = 0; i < SECTIONS.length; i++) {
      if (f[SECTIONS[i]] !== this.heldSections[i]) return true;
    }
    let t = 0;
    for (let i = 0; i < LEAVES.length; i++) {
      if (LEAVES[i].sec !== null) continue;
      if (f[LEAVES[i].key] !== this.heldTop[t++]) return true;
    }
    return false;
  }

  /** Takes the layout off `frame`: its arrays, their lengths, a new version. */
  private relayout(frame: SimFrame): void {
    const f = frame as unknown as Record<string, unknown>;
    for (let i = 0; i < SECTIONS.length; i++) this.heldSections[i] = f[SECTIONS[i]];
    this.heldTop.length = 0;
    for (let i = 0; i < LEAVES.length; i++) {
      const leaf = LEAVES[i];
      const arr = owner(frame, leaf.sec)[leaf.key] as View;
      if (leaf.sec === null) this.heldTop.push(arr);
      this.src[i] = arr;
      this.lengths[i] = arr.length;
    }
    this.version++;
  }

  /**
   * `frame` and the drain in `events` into buffer `b`, with `live` and `op`
   * in the header. Grows the buffer when the layout needs more than it has.
   */
  write(b: number, frame: SimFrame, events: EventCursor, live: boolean, op: number): void {
    if (this.version === 0 || this.moved(frame)) this.relayout(frame);
    if (events.count > this.evCap || events.intCount > this.intCap) {
      while (this.evCap < events.count) this.evCap *= 2;
      while (this.intCap < events.intCount) this.intCap *= 2;
      this.version++;
    }
    let v = this.views[b];
    if (!v || v.version !== this.version) {
      const sab = this.buffers[b];
      const bytes = layOut(this.lengths, this.evCap, this.intCap, this.offsets);
      if (sab.byteLength < bytes) sab.grow(Math.min(sab.maxByteLength, align8(bytes * 1.5)));
      v = viewsOf(sab, this.version, this.lengths, this.evCap, this.intCap, this.offsets);
      this.views[b] = v;
      const h = v.header;
      h[H_VERSION] = this.version;
      h[H_EVCAP] = this.evCap;
      h[H_INTCAP] = this.intCap;
      for (let i = 0; i < LEAVES.length; i++) h[H_LENGTHS + i] = this.lengths[i];
    }
    const leaves = v.leaves;
    for (let i = 0; i < LEAVES.length; i++) leaves[i].set(this.src[i]);
    const h = v.header;
    writeScalars(frame, h, H_SCALARS);
    const n = events.count;
    const kinds = events.kinds;
    const ticks = events.ticks;
    const data = events.data;
    for (let i = 0; i < n; i++) {
      v.kinds[i] = kinds[i];
      v.ticks[i] = ticks[i];
    }
    for (let i = 0, end = n * STRIDE; i < end; i++) v.data[i] = data[i];
    const ints = events.ints;
    for (let i = 0; i < events.intCount; i++) v.ints[i] = ints[i];
    h[H_EVENTS] = n;
    h[H_INTS] = events.intCount;
    h[H_LIVE] = live ? 1 : 0;
    h[H_OP] = op;
  }

  /**
   * The frame's `timing` section again, into buffer `b` already written —
   * for a Worker that adds its own copy's cost to the step's timing after
   * the copy (`simWorker.ts`).
   */
  retime(b: number, frame: SimFrame): void {
    const v = this.views[b];
    if (!v) return;
    for (let i = 0; i < LEAVES.length; i++) {
      if (LEAVES[i].sec === "timing") v.leaves[i].set(this.src[i]);
    }
    v.header[H_TIMING_START] = frame.timing.start;
    v.header[H_TIMING_TOTAL] = frame.timing.total;
  }
}

/**
 * The page's half: buffer `b` read back as a `SimFrame` of views and its
 * events appended to a ring. Each buffer has its own frame object, rebuilt
 * when the buffer's layout version moves.
 */
export class PublicationReader {
  private readonly frames: (SimFrame | null)[] = [null, null];
  private readonly views: (BufferViews | null)[] = [null, null];
  /** Each buffer's header, at offset 0 for its life — what a layout's version is read off. */
  private readonly headers: Float64Array[];
  private readonly offsets = new Int32Array(LEAVES.length + 4);
  private readonly lengths = new Int32Array(LEAVES.length);

  constructor(private readonly buffers: readonly SharedArrayBuffer[]) {
    this.headers = buffers.map((sab) => new Float64Array(sab, 0, HEADER));
  }

  /** Buffer `b` as a frame: views rebuilt if its layout moved, scalars copied in. */
  read(b: number): SimFrame {
    const h = this.headers[b];
    if (this.views[b]?.version !== h[H_VERSION]) this.rebuild(b, h[H_VERSION]);
    const f = this.frames[b]!;
    readScalars(h, H_SCALARS, f);
    return f;
  }

  /** Buffer `b`'s events, appended to `ring` in order. Read `b` first. */
  appendEvents(b: number, ring: EventRing): void {
    const v = this.views[b]!;
    const h = this.headers[b];
    ring.append(v.kinds, v.ticks, v.data, v.ints, h[H_EVENTS], h[H_INTS]);
  }

  /** What buffer `b`'s operation returned. */
  live(b: number): boolean {
    return this.headers[b][H_LIVE] === 1;
  }

  /** Which operation buffer `b` answers. */
  op(b: number): number {
    return this.headers[b][H_OP];
  }

  private rebuild(b: number, version: number): void {
    const h = this.headers[b];
    for (let i = 0; i < LEAVES.length; i++) this.lengths[i] = h[H_LENGTHS + i];
    const evCap = h[H_EVCAP];
    const intCap = h[H_INTCAP];
    layOut(this.lengths, evCap, intCap, this.offsets);
    const v = viewsOf(this.buffers[b], version, this.lengths, evCap, intCap, this.offsets);
    this.views[b] = v;
    // A frame object in the template's own shape — every section, every key,
    // in its order — whose arrays are this buffer's views and whose numbers
    // `read` copies in. The walk is the module's own, so the leaves come out
    // in `LEAVES` order.
    const f: Record<string, unknown> = {};
    let li = 0;
    const template = newFrame() as unknown as Record<string, unknown>;
    for (const key of Object.keys(template)) {
      const t = template[key];
      if (ArrayBuffer.isView(t)) f[key] = v.leaves[li++];
      else if (typeof t === "number") f[key] = 0;
      else {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(t as object)) {
          out[k] = ArrayBuffer.isView((t as Record<string, unknown>)[k]) ? v.leaves[li++] : 0;
        }
        f[key] = out;
      }
    }
    this.frames[b] = f as unknown as SimFrame;
  }
}
