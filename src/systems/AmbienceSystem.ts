/**
 * AmbienceSystem.ts — Sole owner of the world's SUSTAINED sounds: the places
 * on a map that make a noise on their own, and which few of them are worth a
 * voice right now.
 * Owns: the emitter registry a map fills at build time, and the per-frame
 * ranking that spends `CONFIG.audio.ambience.maxVoices` on it.
 * Invariants: an emitter's INDEX is its identity for the life of a map —
 * `Sfx` keys a held-open graph on it, so `add`/`addRun` may only ever append
 * and `clear` is the only thing that renumbers. update() is called in EVERY
 * state that renders, not only the ones that simulate (see `Sfx.ambienceAllOff`
 * for why this and the engines differ on that), and allocates nothing per
 * frame.
 * Never plays anything itself: what a fire SOUNDS like is `Sfx`'s, and how
 * many fires a map may hold is this file's.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { AmbienceKind, Sfx } from "../core/Sfx";

/**
 * One thing on the map that makes a noise: a slice of `points` (world-space
 * x/y/z triples), and what it sounds like.
 *
 * **A fire is a PLACE and a shore is a RUN of them**, which is the one idea
 * this file gained when water arrived. See `addRun`.
 */
interface Emitter {
  /** First triple, as an index into `points` (so `start * 3` is the x). */
  start: number;
  /** How many triples. One is an ordinary point emitter. */
  count: number;
  kind: AmbienceKind;
}

/**
 * The world's ambient emitters, and the budget over them.
 *
 * **This is `LightingSystem`'s problem with a different currency, and it gets
 * `LightingSystem`'s answer.** A village may hold twenty burning drums; a
 * shader has sixteen light slots and an audio graph has rather fewer voices
 * worth spending on scenery, so each frame the nearest few win and the rest
 * are silent. That is imperceptible for the same reason it is imperceptible
 * there — what loses is already most of a rolloff away — and it is what keeps
 * the cost a property of the BUDGET rather than of how densely a map was
 * dressed.
 *
 * **It is a ranking rather than a gate, and that is the load-bearing part.** A
 * plain range test spends whatever the map placed: stand between four drums
 * and you hold four graphs open, and a map that dressed a burning quarter
 * would quietly cost twenty. Ranking first and gating second means the ceiling
 * is stated here, once, and a layout can never raise it.
 *
 * **A BODY OF WATER IS ONE EMITTER THAT MOVES, and that is what stops a
 * coastline eating the budget.** A fire is a point and a shore is a line, and
 * the honest way to hear a line is from whichever part of it is nearest — so
 * a water emitter carries its whole waterline as a run of points, scores
 * itself on the nearest one, and hands `Sfx` that point. Laid out instead as
 * one emitter per sampled point, Cinderhaven's bay alone would put several
 * hundred candidates into a budget of three and win every slot on the map: a
 * player standing at a brazier on the quay would hear no fire. As one emitter
 * it competes with a drum on even terms, holds one graph rather than three,
 * and is a better model of a diffuse line into the bargain.
 *
 * **The nearest point can JUMP, and the place it can is the one place that
 * costs nothing.** Two points can only trade the lead where they are exactly
 * equidistant, so the level is continuous across the swap and only the BEARING
 * moves — which for a noise bed is what walking round a headland sounds like
 * anyway. Everywhere else the nearest point slides, because the waterline is
 * sampled every `shorelineStep` metres.
 */
export class AmbienceSystem {
  private emitters: Emitter[] = [];
  /**
   * Every emitter's points, flat and shared. Flat because an emitter's
   * position is read in the inner loop of a per-frame scan over a coastline
   * that can run to hundreds of points, and an array of `Vector3` there is
   * three pointer hops and a cache miss per candidate.
   */
  private points: number[] = [];
  /**
   * Which emitter indices currently hold a voice, `count` of them valid.
   *
   * A plain array rewritten in place rather than a `Set`, because this runs in
   * every state — including the ones that draw a menu over a still frame — and
   * the rule about per-frame allocation is the whole frame's rather than the
   * profiler's: `FINDINGS.md` §1's leading suspect is GC, and a fixed-size
   * selection over a static list has no reason to produce garbage. At
   * `maxVoices` of three the linear scans over it are cheaper than a hash
   * anyway.
   */
  private held: number[] = [];
  private count = 0;

  /**
   * Registers a PLACE that makes a noise. Called from `MapBuilder` beside
   * `LightingSystem.add`, and from nowhere else.
   *
   * Append-only within a map: see the header's rule about the index.
   */
  add(x: number, y: number, z: number, kind: AmbienceKind): void {
    this.emitters.push({ start: this.points.length / 3, count: 1, kind });
    this.points.push(x, y, z);
  }

  /**
   * Registers a RUN of places that are one thing making one noise — a
   * waterline. `xyz` is flat triples and is copied, not kept.
   *
   * An empty run registers nothing rather than an emitter with nowhere to be:
   * a `WaterRect` laid entirely over deep water has no shore in it, and
   * Cinderhaven has four of those.
   */
  addRun(xyz: readonly number[], kind: AmbienceKind): void {
    const count = Math.floor(xyz.length / 3);
    if (count === 0) return;
    this.emitters.push({ start: this.points.length / 3, count, kind });
    for (let i = 0; i < count * 3; i++) this.points.push(xyz[i]);
  }

  /**
   * Drops every emitter. Owed by a map's `dispose`, and the caller owes
   * `Sfx.ambienceAllOff` with it — the indices this renumbers are the keys
   * that file holds its graphs on.
   */
  clear(): void {
    this.emitters.length = 0;
    this.points.length = 0;
    this.count = 0;
    this.held.length = 0;
  }

  /**
   * Picks this frame's winners and pushes them.
   *
   * **An incumbent is scored `swapMargin` metres closer than it is**, which is
   * the whole of the hysteresis and it is on the RANKING rather than on the
   * range — `Sfx.ambience` already holds the range boundary. Without it two
   * fires either side of a street trade the last slot back and forth as the
   * player walks the line between them, and every trade is a fade-out and a
   * fade-in of something that never actually went anywhere.
   *
   * The selection is an insertion into a `maxVoices`-long list rather than a
   * sort, because `maxVoices` is three and the emitter list is the map's: at
   * that ratio a full sort is both slower and an allocation.
   *
   * **The whole scan is in SQUARED metres and the root is taken once per
   * emitter that survives the reach test**, which is what makes a coastline
   * affordable: the inner loop over a run's points is three subtractions and
   * three multiplies, and an emitter out of reach never pays for a root at
   * all. It matters because this runs in every state that renders, menus
   * included, on a map whose bay can hold several hundred sampled points.
   */
  update(listener: Vector3, sfx: Sfx): void {
    const cap = CONFIG.audio.ambience.maxVoices;
    const margin = CONFIG.audio.ambience.swapMargin;
    // The previous frame's winners, needed while the new ones are chosen: the
    // incumbency bonus is read off `held` and `held` is what gets rewritten.
    const wasHeld = this.held;
    const prevCount = this.count;
    let n = 0;
    const pick: number[] = this.pickBuf;
    const score: number[] = this.scoreBuf;
    const at: number[] = this.atBuf;
    const pts = this.points;
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      // The nearest of this emitter's places, in squared metres. One place is
      // the ordinary case and costs exactly what it always did.
      let best = Infinity;
      let bestP = e.start;
      for (let p = e.start; p < e.start + e.count; p++) {
        const dx = pts[p * 3] - listener.x;
        const dy = pts[p * 3 + 1] - listener.y;
        const dz = pts[p * 3 + 2] - listener.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) {
          best = d2;
          bestP = p;
        }
      }
      // The reach test before the root: an incumbent is kept out to
      // `range + margin` and everything else to `range`, which is exactly
      // what the margin below would have decided anyway.
      let incumbent = false;
      for (let h = 0; h < prevCount; h++) {
        if (wasHeld[h] === i) {
          incumbent = true;
          break;
        }
      }
      const reach = e.kind.range + (incumbent ? margin : 0);
      if (best > reach * reach) continue;
      let d = Math.sqrt(best);
      // The incumbency bonus itself. Clamped at zero: an incumbent the
      // listener is standing on must not score negatively and sort itself
      // above something closer still. `Sfx.ambience`'s own 1.15 gate is the
      // general guard for any other caller and is deliberately wider than
      // this, so it never fires first from here.
      if (incumbent) d = Math.max(0, d - margin);
      // Insertion sort into the top-`cap`.
      let slot = n < cap ? n : cap;
      while (slot > 0 && score[slot - 1] > d) slot--;
      if (slot >= cap) continue;
      for (let j = Math.min(n, cap - 1); j > slot; j--) {
        pick[j] = pick[j - 1];
        score[j] = score[j - 1];
        at[j] = at[j - 1];
      }
      pick[slot] = i;
      score[slot] = d;
      at[slot] = bestP;
      if (n < cap) n++;
    }

    // Stand down anything that held a voice and is not on the new list. Before
    // the pushes rather than after, so a frame that swaps one emitter for
    // another never has both graphs open at once.
    for (let h = 0; h < prevCount; h++) {
      const idx = wasHeld[h];
      let kept = false;
      for (let j = 0; j < n; j++) {
        if (pick[j] === idx) {
          kept = true;
          break;
        }
      }
      if (!kept) sfx.ambienceOff(idx);
    }

    for (let j = 0; j < n; j++) {
      const i = pick[j];
      const p = at[j];
      this.at.x = pts[p * 3];
      this.at.y = pts[p * 3 + 1];
      this.at.z = pts[p * 3 + 2];
      sfx.ambience(i, this.at, this.emitters[i].kind);
      this.held[j] = i;
    }
    this.count = n;
  }

  /** Selection scratch, sized once. See `held`. */
  private pickBuf: number[] = [];
  private scoreBuf: number[] = [];
  /** Which of a winner's points won it — an index into `points`. */
  private atBuf: number[] = [];
  /**
   * The position handed to `Sfx.ambience`, built once and rewritten. Every
   * world sound in `Sfx` takes a `Vector3`, and one per emitter per frame is
   * exactly the allocation this class is written not to make.
   */
  private at = new Vector3();
}
