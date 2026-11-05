/**
 * render/NearestRun.ts — The ONE nearest-first run of ours (`BABYLON_EXIT.md`
 * X4.6d): the capture zones, the field's blades and the water, drawn as Babylon's
 * opaque list drew them, in one order at ONE point, because every test is LEQUAL
 * and a depth this far from the near plane ties for real where a blade stands in
 * water or grows through a stone, so an equal depth goes to the later draw.
 * Owns: `NearestRun` — the frame's one draw at `"beforeAlphaTest"`, the pull asked
 * inside the render, the blades' key (`bladeKey`), and the merge of the three lists,
 * each sorted apart. **Nothing here orders anything but the merge**: which surfaces
 * are drawn and each's key are its pull's (`Game.nearestPull`), asked once a frame
 * after every prepare (`late`), so each draw's verdict on this frame stands.
 * Invariants: first of everything of ours at `"beforeAlphaTest"` (`Game.installMap`
 * installs it so), behind what is left of Babylon's opaque list, the `backed` panes,
 * with which nothing here ties (measured, X4.6c's review); an equal key goes to the
 * mesh made first, which is what Babylon's stable sort over its list did: the
 * water's, then the blades', then the zones'; a frame it has nothing to draw costs a
 * predicate; nothing here makes an object on a frame (what the sampling profiler sees
 * here is a once-a-frame function's boxed doubles, about 100 bytes).
 * Never: imports Babylon; draws a thing itself; holds a surface; decides a key.
 * Contract: `docs/rendering.md`, "The one run".
 */
import type { GrassDraw } from "./GrassDraw";
import type { FrameContext, Renderer } from "./Renderer";
import type { WaterDraw } from "./WaterDraw";
import type { ZoneDraw } from "./ZoneDraw";

export class NearestRun {
  /** The blades' key this frame, their field's centre from the eye, squared: the pull writes it. */
  bladeKey = Number.POSITIVE_INFINITY;

  private removes: (() => void)[] = [];

  constructor(
    private readonly renderer: Renderer,
    private readonly zones: ZoneDraw,
    private readonly grass: GrassDraw,
    private readonly water: WaterDraw,
    /** Asked inside the render, once a frame: writes every list's order and keys, and `bladeKey`. */
    private readonly pull: (into: NearestRun) => void,
  ) {}

  /** Draws the run from the next frame on: the caller asks ahead of everything else of ours at this point. */
  install(): void {
    this.uninstall();
    this.removes.push(
      // Late, so every draw's prepare has given its verdict on this frame.
      this.renderer.onFrame(this.prepare, true),
      // Counted only on a frame something was committed (`Renderer.begin`).
      this.renderer.add(this.draw, "beforeAlphaTest", this.active),
    );
  }

  /** Draws nothing again until the next `install`. */
  uninstall(): void {
    for (const remove of this.removes) remove();
    this.removes.length = 0;
    this.bladeKey = Number.POSITIVE_INFINITY;
  }

  private readonly active = (): boolean => this.zones.active || this.grass.active || this.water.active;

  private readonly prepare = (): void => {
    this.bladeKey = Number.POSITIVE_INFINITY;
    this.pull(this);
  };

  /** The three lists merged, each contiguous stretch of one drawn in one call. */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    const zones = this.zones;
    const water = this.water;
    const zoneKeys = zones.keys;
    const waterKeys = water.keys;
    const zn = zones.draws;
    const wn = water.draws;
    const bladeKey = this.bladeKey;
    let blades = this.grass.drawing;
    let z = 0;
    let w = 0;
    while (z < zn || w < wn || blades) {
      const zk = z < zn ? zoneKeys[z] : Number.POSITIVE_INFINITY;
      const bk = blades ? bladeKey : Number.POSITIVE_INFINITY;
      const wk = w < wn ? waterKeys[w] : Number.POSITIVE_INFINITY;
      if (w < wn && wk <= bk && wk <= zk) {
        let end = w + 1;
        while (end < wn && waterKeys[end] <= bk && waterKeys[end] <= zk) end++;
        water.drawRange(pass, w, end);
        w = end;
      } else if (blades && bk <= zk) {
        this.grass.drawBlades(pass, ctx);
        blades = false;
      } else {
        let end = z + 1;
        while (end < zn && zoneKeys[end] < bk && zoneKeys[end] < wk) end++;
        zones.drawRange(pass, ctx, z, end);
        z = end;
      }
    }
  };
}
