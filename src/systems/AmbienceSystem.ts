/**
 * AmbienceSystem.ts — Sole owner of the world's SUSTAINED sounds: the places
 * on a map that make a noise on their own, and which few of them are worth a
 * voice right now.
 * Owns: the emitter registry a map fills at build time, and the per-frame
 * ranking that spends `CONFIG.audio.ambience.maxVoices` on it.
 * Invariants: an emitter's INDEX is its identity for the life of a map —
 * `Sfx` keys a held-open graph on it, so `add` may only ever append and
 * `clear` is the only thing that renumbers. update() is called in EVERY state
 * that renders, not only the ones that simulate (see `Sfx.ambienceAllOff` for
 * why this and the engines differ on that), and allocates nothing per frame.
 * Never plays anything itself: what a fire SOUNDS like is `Sfx`'s, and how
 * many fires a map may hold is this file's.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { AmbienceKind, Sfx } from "../core/Sfx";

/** One place on the map that makes a noise, in world space. */
interface Emitter {
  x: number;
  y: number;
  z: number;
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
 */
export class AmbienceSystem {
  private emitters: Emitter[] = [];
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
   * Registers an emitter for the current map. Called from `MapBuilder` beside
   * `LightingSystem.add`, and from nowhere else.
   *
   * Append-only within a map: see the header's rule about the index.
   */
  add(x: number, y: number, z: number, kind: AmbienceKind): void {
    this.emitters.push({ x, y, z, kind });
  }

  /**
   * Drops every emitter. Owed by a map's `dispose`, and the caller owes
   * `Sfx.ambienceAllOff` with it — the indices this renumbers are the keys
   * that file holds its graphs on.
   */
  clear(): void {
    this.emitters.length = 0;
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
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      const dx = e.x - listener.x;
      const dy = e.y - listener.y;
      const dz = e.z - listener.z;
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // The incumbency bonus, and it is applied BEFORE the range test rather
      // than only before the ranking — which is what makes `swapMargin` the
      // one piece of hysteresis in the system instead of two that have to
      // agree. An emitter already holding a voice is both harder to displace
      // and kept until it is `range + margin` away; `Sfx.ambience`'s own 1.15
      // gate is the general guard for any other caller and is deliberately
      // wider than this, so it never fires first from here.
      //
      // Clamped at zero: an incumbent the listener is standing on must not
      // score negatively and sort itself above something closer still.
      let incumbent = false;
      for (let h = 0; h < prevCount; h++) {
        if (wasHeld[h] === i) {
          incumbent = true;
          break;
        }
      }
      if (incumbent) d = Math.max(0, d - margin);
      if (d > e.kind.range) continue;
      // Insertion sort into the top-`cap`.
      let slot = n < cap ? n : cap;
      while (slot > 0 && score[slot - 1] > d) slot--;
      if (slot >= cap) continue;
      for (let j = Math.min(n, cap - 1); j > slot; j--) {
        pick[j] = pick[j - 1];
        score[j] = score[j - 1];
      }
      pick[slot] = i;
      score[slot] = d;
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
      const e = this.emitters[i];
      this.at.x = e.x;
      this.at.y = e.y;
      this.at.z = e.z;
      sfx.ambience(i, this.at, e.kind);
      this.held[j] = i;
    }
    this.count = n;
  }

  /** Selection scratch, sized once. See `held`. */
  private pickBuf: number[] = [];
  private scoreBuf: number[] = [];
  /**
   * The position handed to `Sfx.ambience`, built once and rewritten. Every
   * world sound in `Sfx` takes a `Vector3`, and one per emitter per frame is
   * exactly the allocation this class is written not to make.
   */
  private at = new Vector3();
}
