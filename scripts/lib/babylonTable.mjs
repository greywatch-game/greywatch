/**
 * babylonTable.mjs — the RECORDED answers the four copy checks hold our
 * copies of Babylon to (`geometry-check`, `math-check`, `bounds-check`,
 * `sweep-check`), and the ledger each of them keeps its comparisons in.
 *
 * Owns: the table format (`scripts/tables/<check>.json`), the byte encoding a
 * comparison is digested in, and the verdict (pass or fail, with the groups
 * reported NEW, GONE or STALE) a check run against a table reaches. It
 * decides nothing about WHAT is compared — every case is its check's — and it
 * never loads Babylon.
 *
 * **Why a table** (`BABYLON_EXIT.md` row "X6.1, the copy checks", decided by
 * the owner 2026-11-12, option B): `src/geometry/`, `src/math/`, `boundsOf`
 * and `worldMatrixOf`, and the body sweep are Babylon 9.28's arithmetic
 * copied operation for operation, and every oracle the exit was graded by
 * compares bits. Once the package left the tree (X6.1i) there was nothing to
 * ask, so each check's Babylon answers were captured ONCE, against the
 * installed 9.28, at 28dc7f0 (X6.1i's first commit), and committed; the check
 * now compares ours with them, and this file no longer records. A re-record
 * means checking out that commit's check and this file with `@babylonjs/core`
 * 9.28 installed.
 *
 * **A DIGEST per group, never the numbers.** A comparison is the exact list
 * its check compared with `Object.is` — every number as its float64 bits (a
 * -0 is not a +0, a NaN is one NaN), every boolean and string, each value
 * tagged with its type and each comparison closed — and a GROUP of
 * comparisons (a case over a block of trials, a kit kind, a map and a body) is
 * one SHA-256 of them, kept to 64 bits. A group's digest moves if any bit of
 * any answer in it does, so the check is as strict as the live one was; what
 * it cannot do is say WHICH number moved, only which group (and so which case
 * and which trials). The numbers themselves were millions (math-check alone
 * compared 1.92 million answers), which no committed table should be.
 *
 * **A group whose INPUT is the game's content can go STALE, and stale is not a
 * failure.** `math-check` and `geometry-check` draw every input from a seed,
 * so their groups never go stale. `bounds-check` builds the kit and
 * `sweep-check` the maps, and a rework of a builder or a re-laid map hands the
 * copy different numbers than Babylon was asked about — which no answer can
 * be recorded for any more. So those groups carry an INPUT digest beside the
 * answer, taken over what the case reads (a part's positions and transform
 * chain, a map's boxes and floor) as the game hands it over, before the case
 * calls the copy it compares, and a group whose input moved is reported STALE
 * and skipped rather than failed. **That input is not independent of the
 * copies**: the game computes it, and partly through `src/math` — a builder's
 * own vector arithmetic, and a scatter kind's part chains, which come out of
 * `flattenParts` → `detachPart` → `worldMatrixOf` and `Matrix.decompose` — so
 * a copy that moved can move inputs too (one ULP on
 * `Vector3.TransformCoordinatesFromFloatsToRef` turns eighteen kit groups
 * STALE, beside the groups that fail). **A sudden MASS of STALE groups is therefore suspect, not "the
 * art moved"**: find what changed under them before believing it. The same
 * content can be ADDED or REMOVED as well as changed — a kit builder or a
 * scatter kind new or deleted, a foliage tier's detail (which names a scatter
 * group) moved, a map in `MAPS` new or retired — and such a group is reported
 * NEW (the run reached it, the table has none) or GONE (the table has it, the
 * run did not reach it) and is not compared, as STALE is not. Each of those
 * two checks also has a SEEDED section built from nothing in the game
 * (`bounds-check`'s synthetic parts and chains, `sweep-check`'s synthetic
 * world, which a check names to the ledger as `seeded`), so the oracle does
 * not fade as the art moves, and which is never NEW, GONE or STALE: a seeded
 * group whose input digest moved FAILS, since its input is built from nothing
 * in the game and only the check's own world (or what builds it) can move it.
 *
 * **What fails**: an answer digest that differs where the input did not; a
 * SEEDED group's input digest that differs at all; a
 * group the table has and a whole run did not reach, or the reverse — a new
 * case has nothing recorded to meet, and cannot have — unless the group is
 * the game's content (it carries an INPUT digest and is not `seeded`), when it
 * is NEW or GONE as above; and a run at knobs other than the table's (the seed
 * and the counts are part of every input). A PARTIAL run (a map or a body
 * named) is held to the groups it reached, and the rest of the table is
 * neither missing nor GONE.
 *
 * `--perturb` is each check's negative test. For the two seeded checks the
 * ledger does it: one number in the FIRST comparison of every group is moved
 * one ULP (a boolean negated, a string lengthened), and the run passes only if
 * every group then fails. The other two perturb their own INPUT, as
 * `bounds-check` always has, and use the same verdict.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Where the tables live, beside the scripts that read them. */
export const TABLES = fileURLToPath(new URL("../tables/", import.meta.url));

/** The version every table was recorded against; the package left at X6.1i. */
export const BABYLON = "9.28.0";

const TAG_NUMBER = 1;
const TAG_NAN = 2;
const TAG_TRUE = 3;
const TAG_FALSE = 4;
const TAG_STRING = 5;
const TAG_NULL = 6;
const TAG_UNDEFINED = 7;
const TAG_END = 0xff;

/** One comparison's bytes, built in a reused buffer. */
class Encoder {
  constructor() {
    this.buf = Buffer.alloc(1 << 16);
    this.len = 0;
  }
  reset() {
    this.len = 0;
  }
  room(n) {
    if (this.len + n <= this.buf.length) return;
    const next = Buffer.alloc(Math.max(this.buf.length * 2, this.len + n));
    this.buf.copy(next, 0, 0, this.len);
    this.buf = next;
  }
  value(v) {
    if (typeof v === "number") {
      if (Number.isNaN(v)) {
        this.room(1);
        this.buf[this.len++] = TAG_NAN;
        return;
      }
      this.room(9);
      this.buf[this.len++] = TAG_NUMBER;
      this.buf.writeDoubleLE(v, this.len);
      this.len += 8;
    } else if (typeof v === "boolean") {
      this.room(1);
      this.buf[this.len++] = v ? TAG_TRUE : TAG_FALSE;
    } else if (typeof v === "string") {
      const bytes = Buffer.from(v, "utf8");
      this.room(5 + bytes.length);
      this.buf[this.len++] = TAG_STRING;
      this.buf.writeUInt32LE(bytes.length, this.len);
      this.len += 4;
      bytes.copy(this.buf, this.len);
      this.len += bytes.length;
    } else if (v === null) {
      this.room(1);
      this.buf[this.len++] = TAG_NULL;
    } else if (v === undefined) {
      this.room(1);
      this.buf[this.len++] = TAG_UNDEFINED;
    } else {
      throw new Error(`babylonTable: cannot encode ${typeof v} ${String(v)}`);
    }
  }
  values(list) {
    for (let i = 0; i < list.length; i++) this.value(list[i]);
  }
  end() {
    this.room(1);
    this.buf[this.len++] = TAG_END;
    return this.buf.subarray(0, this.len);
  }
}

/** The next float64 after `v` away from zero: one ULP. */
function nudge(v) {
  if (v === 0) return Number.MIN_VALUE;
  const f = new Float64Array([v]);
  new BigInt64Array(f.buffer)[0] += 1n;
  return f[0];
}

/** Moves the first value it can in `list`, one ULP or one flip. */
function perturbed(list) {
  const out = Array.from(list);
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[i] = nudge(v);
      return out;
    }
    if (typeof v === "boolean") {
      out[i] = !v;
      return out;
    }
    if (typeof v === "string") {
      out[i] = `${v}~`;
      return out;
    }
  }
  return null;
}

/**
 * A check's comparisons, digested by group. Built with the check's name and
 * the KNOBS its inputs depend on (a seed, a count); the run's answers are
 * held to the table. `perturb` is `"output"` (the ledger moves one value a
 * group) or `"input"` (the check moved its own inputs, so every group it
 * reached must differ).
 */
export class Ledger {
  constructor(check, knobs, { perturb = false, partial = false, seeded = () => false } = {}) {
    this.check = check;
    this.knobs = knobs;
    this.perturb = perturb;
    /** A run over some of the table (a map or a body named): the rest is not missing. */
    this.partial = partial;
    /**
     * The groups built from nothing in the game even where they carry an
     * input digest (`sweep-check`'s synthetic world): never NEW or GONE, so
     * one added or lost FAILS as a seeded check's does.
     */
    this.seeded = seeded;
    this.path = `${TABLES}${check}.json`;
    this.enc = new Encoder();
    /** group → hash, answers then inputs. */
    this.answers = new Map();
    this.inputs = new Map();
    /** Groups `perturb` moved a value in, and those it could not. */
    this.moved = new Set();
    this.comparisons = 0;
  }

  /**
   * The table as committed, or null where there is none — read for the inputs
   * a check FROZE with its answers rather than reading from the game each run
   * (the table's `frozen`: `sweep-check`'s bodies, since a CONFIG retune is
   * not a change to the sweep).
   */
  recorded() {
    if (!existsSync(this.path)) return null;
    return JSON.parse(readFileSync(this.path, "utf8"));
  }

  hashOf(map, group) {
    let h = map.get(group);
    if (!h) {
      h = createHash("sha256");
      map.set(group, h);
    }
    return h;
  }

  /**
   * One comparison's answer in `group`: ours, as the same flat list in the
   * same order as Babylon's was recorded.
   */
  answer(group, list) {
    this.comparisons++;
    let values = list;
    if (this.perturb === "output" && !this.moved.has(group)) {
      const p = perturbed(list);
      if (p) {
        values = p;
        this.moved.add(group);
      }
    }
    this.enc.reset();
    this.enc.values(values);
    this.hashOf(this.answers, group).update(this.enc.end());
  }

  /** What `group`'s cases read, before any copy under test ran. */
  input(group, list) {
    this.enc.reset();
    this.enc.values(list);
    this.hashOf(this.inputs, group).update(this.enc.end());
  }

  static hex(h) {
    return h.digest("hex").slice(0, 16);
  }

  /** This run's digests in the table's shape, groups flat (`name @block`). */
  table() {
    const groups = {};
    for (const [g, h] of this.answers) groups[g] = Ledger.hex(h);
    const inputs = {};
    for (const [g, h] of this.inputs) inputs[g] = Ledger.hex(h);
    return { check: this.check, babylon: BABYLON, knobs: this.knobs, groups, inputs };
  }

  /**
   * Holds this run to the table. Returns whether the run FAILED, having
   * printed why; a perturbed run fails unless every group it moved differs.
   */
  finish() {
    const mine = this.table();
    if (!existsSync(this.path)) {
      console.log(`${this.check}: no table at ${this.path}`);
      return true;
    }
    const read = JSON.parse(readFileSync(this.path, "utf8"));
    const table = { ...read, groups: unfold(read.groups), inputs: unfold(read.inputs) };
    if (JSON.stringify(table.knobs) !== JSON.stringify(this.knobs)) {
      console.log(
        `${this.check}: the table was recorded at ${JSON.stringify(table.knobs)} and this run is ${JSON.stringify(this.knobs)}; ` +
          "Babylon cannot be asked about other inputs, so run at the table's",
      );
      return true;
    }
    // The game's content: a group with an input digest (this run's or the
    // table's) that the check has not named seeded. Only such a group can be
    // NEW or GONE; any other one unrecorded or unreached fails.
    const content = (g) => !this.seeded(g) && (mine.inputs[g] !== undefined || table.inputs?.[g] !== undefined);
    const differ = [];
    const stale = [];
    const missing = [];
    const gone = [];
    /** Seeded groups whose input moved: never STALE, always a failure. */
    const seededMoved = [];
    let compared = 0;
    for (const [g, digest] of Object.entries(table.groups)) {
      const input = table.inputs?.[g];
      if (input !== undefined && mine.inputs[g] !== undefined && mine.inputs[g] !== input) {
        // Only the game's content may go STALE. A seeded group's input is
        // built from nothing in the game, so its moving is the check's own
        // world (or what builds it) changing, never art landing.
        if (this.seeded(g)) seededMoved.push(g);
        else stale.push(g);
        continue;
      }
      if (mine.groups[g] === undefined) {
        // A partial run reached only what it named: the rest is out of it.
        if (this.partial) continue;
        if (content(g)) gone.push(g);
        else missing.push(g);
        continue;
      }
      compared++;
      if (mine.groups[g] !== digest) differ.push(g);
    }
    const added = Object.keys(mine.groups).filter((g) => table.groups[g] === undefined);
    const fresh = added.filter(content);
    const unrecorded = added.filter((g) => !content(g));
    console.log(
      `${this.check}: ${this.comparisons} answers in ${Object.keys(mine.groups).length} groups against the table of Babylon ${table.babylon}: ` +
        `${compared - differ.length} of ${compared} groups identical`,
    );
    // The count, for a check whose groups can be the game's content at all.
    if (this.inputs.size > 0 || Object.keys(table.inputs ?? {}).length > 0) {
      console.log(
        `${this.check}: ${fresh.length} NEW, ${gone.length} GONE, ${stale.length} STALE ` +
          "(the game's content added, removed or changed since the table; reported, not compared)",
      );
    }
    if (fresh.length) console.log(`  new: ${summarise(fresh)}`);
    if (gone.length) console.log(`  gone: ${summarise(gone)}`);
    if (stale.length) console.log(`  stale: ${summarise(stale)}`);
    if (this.perturb) {
      if (this.perturb === "input") for (const g of Object.keys(mine.groups)) this.moved.add(g);
      const caught = [...this.moved].filter((g) => differ.includes(g)).length;
      // A NEW group has nothing recorded to differ from, as a STALE one has
      // nothing it may be compared with: neither is the perturbation's miss.
      const uncaught = [...this.moved].filter((g) => !differ.includes(g) && !stale.includes(g) && !fresh.includes(g));
      const how = this.perturb === "input" ? "the input moved under" : "one value moved in";
      console.log(`perturbed: ${how} ${this.moved.size} groups, ${caught} of them differ`);
      if (uncaught.length) console.log(`  NOT caught: ${summarise(uncaught)}`);
      if (seededMoved.length) console.log(`FAILED: ${seededMoved.length} seeded groups' input changed: ${summarise(seededMoved)}`);
      return !(
        this.moved.size > 0 &&
        uncaught.length === 0 &&
        missing.length === 0 &&
        unrecorded.length === 0 &&
        seededMoved.length === 0
      );
    }
    if (seededMoved.length) {
      console.log(
        `FAILED: ${seededMoved.length} seeded groups' input changed: the seeded world's own inputs moved ` +
          "(TerrainField's defaults? how RayWorld or the world builder takes its boxes?), so this is not art landing: " +
          summarise(seededMoved),
      );
    }
    if (differ.length) console.log(`FAILED: ${differ.length} groups differ: ${summarise(differ)}`);
    if (missing.length) console.log(`FAILED: ${missing.length} recorded groups not reached: ${summarise(missing)}`);
    if (unrecorded.length) {
      console.log(`FAILED: ${unrecorded.length} groups have no recorded answer (a case added after Babylon left): ${summarise(unrecorded)}`);
    }
    return differ.length > 0 || missing.length > 0 || unrecorded.length > 0 || seededMoved.length > 0;
  }
}

/**
 * A group named `case @n` is a case's nth block: the file keeps each case's
 * blocks as one array (its name written once), and a group with no block as
 * itself. This reads it back flat.
 */
function unfold(folded = {}) {
  const out = {};
  for (const [g, d] of Object.entries(folded)) {
    if (Array.isArray(d)) d.forEach((x, i) => (out[`${g} @${i}`] = x));
    else out[g] = d;
  }
  return out;
}

/** Up to a dozen names, then a count. */
function summarise(list) {
  return list.length <= 12 ? list.join("; ") : `${list.slice(0, 12).join("; ")}; and ${list.length - 12} more`;
}
