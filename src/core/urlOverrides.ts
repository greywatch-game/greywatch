/**
 * urlOverrides.ts — The boot flags on the page's URL that override a display
 * setting for the whole session: `?gi=`, `?shadows=`, `?volumetrics=` and
 * `?nominimap` — and `?seed=`, which overrides no setting but the ROUND's
 * seed (`systems/RoundRandom.ts`), for every round of the session — and
 * `?bench=<map>`, which overrides the session itself: the page plays the
 * benchmark on that map instead of offering a menu (`bench/BenchScript.ts`) —
 * and `?babylonworld`, `?nocull` and `?nofrustum`, which take our renderer's
 * static world or its culls out, for an A/B on a device (`BABYLON_EXIT.md`),
 * and `?cullcheck`, which reads those culls back on the device, with
 * `?cullquiet` and `?cullflags` taking it apart.
 * Owns: reading them once, validating each against its own table, the rule
 * that an override BEATS the setting it shadows, and the list of which ones a
 * capture must say were forced. Owns the URL-flag reader `FrameProfile` uses
 * for `?gpu` too, so there is one place that knows a URL can throw.
 * Owns NOTHING that applies them: the module reads, `Game` spends — the shape
 * `prefs.ts` has with the store. Every method that resolves a value is handed
 * the setting rather than reading it, so the store and the screen stay
 * `Game`'s.
 * Invariants: read ONCE, at construction, and never re-read — an override is
 * for a SESSION, which is what lets a measurement run in a fresh profile with
 * no `localStorage` to write a setting into. A value that names no rung is
 * ignored rather than trusted, exactly as `prefs.ts` treats an id from the
 * store.
 * Never: write a setting, touch a system, or decide anything a player could
 * be offered — `?nominimap` is a flag precisely because losing the map is not
 * a setting.
 */
import {
  CULL_BUFFERS,
  CULL_COPIED,
  type CullBuffer,
  type CullCopied,
  type CullMode,
  type CullSplit,
  type DirectDraw,
} from "../render/ClusterCull";
import { isVolumetricRung, type VolumetricRung } from "../shaders/Volumetrics";
import { parseSeed } from "../systems/RoundRandom";
import {
  type GiQuality,
  SHADOW_QUALITIES,
  type ShadowQuality,
  type VolumetricQuality,
} from "./settings";

/**
 * One parameter off the page's URL, or null. Never throws: a page with no
 * `location` to read (a worker, a test harness) has no flags on it.
 */
function urlParam(name: string): string | null {
  try {
    return new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}

/** Whether a bare flag (`?profile`, `?gpu`) is on the URL. Never throws. */
export function urlFlag(name: string): boolean {
  try {
    return new URLSearchParams(location.search).has(name);
  } catch {
    return false;
  }
}

/**
 * A list-valued diagnostic (`?cullflags`, `?cullcopy`): none when absent,
 * all of `all` when bare, else those it names, comma-joined.
 */
function namedOf<T extends string>(value: string | null, all: readonly T[]): ReadonlySet<T> {
  if (value === null) return new Set();
  if (value.trim() === "") return new Set(all);
  const named = value.split(",").map((s) => s.trim());
  return new Set(all.filter((b) => named.includes(b)));
}

export class UrlOverrides {
  /**
   * `?gi=off|low|high`. Overrides the setting for the session, for the reason
   * every row here does: a measurement runs in a fresh profile with nothing
   * stored.
   */
  private readonly giForced: GiQuality | null;
  /**
   * `?shadows=off|low|medium|high`, on the same terms — a capture that
   * compares rungs is taken in a fresh profile with nothing stored.
   */
  private readonly shadowsForced: ShadowQuality | null;
  /**
   * `?volumetrics=<rung>` — the same relationship `?profile` has with
   * `Settings.profiler`, and for the same reason.
   */
  private readonly volumetricsForced: VolumetricRung | null;
  /**
   * `?nominimap` — the corner map is not drawn at all, for the A/B in
   * FINDINGS.md 13: it is the one piece of chrome redrawn in full on every
   * frame (a Canvas2D blit, its marks, and the CSS drop shadow under it
   * re-applied because the canvas changed), and that is raster and compositor
   * work no span in the profiler can see. A flag and never a setting, because
   * the map is not something a player should be offered to lose; recorded in
   * every capture as `graphics.minimap`.
   */
  readonly minimap: boolean;
  /**
   * `?seed=<n>` — every round this session plays starts from this seed rather
   * than a fresh one, which is how a round is played again: the seed is in
   * the profiler capture and on a DEV build's console (`Game.buildRound`).
   * Null when absent or not a seed. Not in `forced`, which is the GRAPHICS a
   * capture was drawn with; a capture states its seed on its own.
   */
  readonly seed: number | null;
  /**
   * `?bench=<map>` — the page plays the benchmark on that map
   * (`Game.bootBench`), and `?bench` bare plays it on the map the menu would
   * have offered. Null when absent. The id is NOT validated here, because the
   * map table is `Game`'s to read; an id that names no map is refused there,
   * on the console, and the page boots to its menu. Not in `forced`: a
   * benchmark's capture says it was one in `bench`, on its own.
   */
  readonly bench: string | null;
  /**
   * `?babylonworld` — our renderer takes no block and no scatter, so Babylon
   * draws the static world whole, as before X3.3 (`BABYLON_EXIT.md`). A
   * diagnostic for a device nobody here owns: one reload A/Bs our main pass
   * against Babylon's. False when the flag is set.
   */
  readonly ourWorld: boolean;
  /**
   * `?nofrustum` — our culls keep everything the reach and the size gate
   * keep, the frustum untested; `?nocull` — they keep EVERYTHING, the reach
   * and the size gate off too (`render/ClusterCull.ts`'s `CullMode`). The
   * other half of that A/B: whether a cull's decision or the draw after it is
   * wrong. `?nocull` wins when both are set.
   */
  readonly cullMode: CullMode;
  /**
   * `?cullcheck` — our culls' verdicts read back off the GPU about once a
   * second and replayed on the CPU, with the plane test re-run in each form
   * it has been written in, on the glass (`render/CullCheck.ts`). The third
   * half of the A/B: WHICH test a device's GPU gets wrong, and in which form.
   */
  readonly cullCheck: boolean;
  /**
   * `?cullquiet` — `?cullcheck`'s readings go to the console and nothing is
   * laid on the glass; `?cullflags` — no check, but the buffers it copies
   * out made copyable as it makes them: all three bare, or those named
   * (`?cullflags=uniform,records,bands`). Each is one of the two things the
   * check changes on the frames it does not read (the panel over the canvas,
   * the buffers' usage), for a device whose bug `?cullcheck` makes go away.
   */
  readonly cullQuiet: boolean;
  readonly cullFlags: ReadonlySet<CullBuffer>;
  /**
   * `?cullsplit` — the cluster cull's three dispatches each in a compute pass
   * of its own; `?cullsplit=submits` — each in a submit of its own, ahead of
   * the frame (`render/ClusterCull.ts`'s `CullSplit`).
   */
  readonly cullSplit: CullSplit;
  /**
   * `?cullcopy` — the cluster cull's draws read a copy of what its compute
   * wrote, the indices and the indirect arguments, or the one it names
   * (`?cullcopy=indices`, `=args`; `render/ClusterCull.ts`'s `CullCopied`).
   */
  readonly cullCopy: ReadonlySet<CullCopied>;
  /**
   * `?directdraw` (`=source`) — the blocks drawn with `drawIndexed` over a
   * static copy of their indices; `?directdraw=cull` over the cull's own.
   * Right only with `?nocull` (`render/ClusterCull.ts`'s `DirectDraw`).
   */
  readonly directDraw: DirectDraw;
  /**
   * `?indirectcpu` (`=N`) — the blocks drawn indirect at arguments the CPU
   * wrote once, N draws a group; right only with `?nocull`
   * (`CullDiagnostics.cpuArgs`). 0 off.
   */
  readonly cpuArgs: number;
  /** `?skipempty` — no draw for a group whose cut kept no index (`CullDiagnostics.skipEmpty`). */
  readonly skipEmpty: boolean;
  /** `?cullonce` — the cluster cull dispatched once, never again (`CullDiagnostics.once`). */
  readonly cullOnce: boolean;
  /**
   * `?drawcheck` — once a second, to the console: how many frames the scene
   * rendered, and how many times our main pass began, queued its opaque
   * draws and ran them, with the fewest and most block draws a run issued
   * (`Renderer.tally`). Whether a frame went without our draws is a CPU
   * question, and this answers it without touching the GPU.
   */
  readonly drawCheck: boolean;
  /**
   * Which of the above the URL set, by the name a capture files it under —
   * `graphics.forced`, so a report off a device nobody here owns says which of
   * its numbers were somebody's experiment rather than the player's choice.
   */
  readonly forced: readonly string[];

  constructor() {
    const gi = urlParam("gi");
    this.giForced = gi === "off" || gi === "low" || gi === "high" ? gi : null;
    const shadows = urlParam("shadows");
    this.shadowsForced = (SHADOW_QUALITIES as readonly string[]).includes(
      shadows ?? "",
    )
      ? (shadows as ShadowQuality)
      : null;
    const volumetrics = urlParam("volumetrics");
    this.volumetricsForced =
      volumetrics !== null && isVolumetricRung(volumetrics) ? volumetrics : null;
    this.minimap = !urlFlag("nominimap");
    this.seed = parseSeed(urlParam("seed"));
    this.bench = urlParam("bench");
    this.ourWorld = !urlFlag("babylonworld");
    this.cullMode = urlFlag("nocull") ? "none" : urlFlag("nofrustum") ? "nofrustum" : "full";
    this.cullCheck = urlFlag("cullcheck");
    this.cullQuiet = urlFlag("cullquiet");
    this.cullFlags = namedOf(urlParam("cullflags"), CULL_BUFFERS);
    this.cullCopy = namedOf(urlParam("cullcopy"), CULL_COPIED);
    this.cullOnce = urlFlag("cullonce");
    const direct = urlParam("directdraw");
    this.directDraw = direct === null ? "none" : direct === "cull" ? "cull" : "source";
    const cpu = urlParam("indirectcpu");
    this.cpuArgs = cpu === null ? 0 : Math.min(64, Math.max(1, Math.floor(Number(cpu)) || 1));
    this.skipEmpty = urlFlag("skipempty");
    this.drawCheck = urlFlag("drawcheck");
    const split = urlParam("cullsplit");
    this.cullSplit = split === null ? "none" : split === "submits" ? "submits" : "passes";
    const forced: string[] = [];
    if (this.giForced) forced.push("gi");
    if (this.shadowsForced) forced.push("shadows");
    if (this.volumetricsForced) forced.push("volumetrics");
    if (!this.minimap) forced.push("minimap");
    if (!this.ourWorld) forced.push("babylonworld");
    if (this.cullMode !== "full") forced.push(this.cullMode === "none" ? "nocull" : "nofrustum");
    if (this.cullCheck) forced.push(this.cullQuiet ? "cullcheck-quiet" : "cullcheck");
    if (this.cullSplit !== "none") forced.push(`cullsplit=${this.cullSplit}`);
    if (this.cullOnce) forced.push("cullonce");
    if (this.directDraw !== "none") forced.push(`directdraw=${this.directDraw}`);
    if (this.cpuArgs > 0) forced.push(`indirectcpu=${this.cpuArgs}`);
    if (this.skipEmpty) forced.push("skipempty");
    if (this.drawCheck) forced.push("drawcheck");
    if (this.cullCopy.size > 0) forced.push(`cullcopy=${[...this.cullCopy].join("+")}`);
    if (this.cullFlags.size > 0) forced.push(`cullflags=${[...this.cullFlags].join("+")}`);
    this.forced = forced;
  }

  /** The irradiance tier in force: the URL's for a session, else the setting. */
  gi(setting: GiQuality): GiQuality {
    return this.giForced ?? setting;
  }

  /** The shadow rung in force: the URL's for a session, else the setting. */
  shadows(setting: ShadowQuality): ShadowQuality {
    return this.shadowsForced ?? setting;
  }

  /**
   * Which shaft rung should be BUILT for a setting — `?volumetrics=` first,
   * the player's choice otherwise, and null for off.
   */
  volumetrics(setting: VolumetricQuality): VolumetricRung | null {
    if (this.volumetricsForced) return this.volumetricsForced;
    return setting === "off" ? null : setting;
  }
}
