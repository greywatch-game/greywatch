/**
 * ProfileChip.ts — the frame profiler's corner of the screen: what it is
 * holding, and the three buttons that get it off the device.
 * Owns: `#prof` and the delivery of a report — the clipboard, the download and
 * the fallbacks between them. Owns NO profiling state: what it shows is PUSHED
 * by `Game` like every other HUD gauge, and a report is fetched through
 * `onCapture` rather than by reaching for the instrument.
 *
 * **It is a DEVICE on `#hud`, not a screen** — the arrangement `TouchControls`
 * already is. There is no `GameState` for it, it covers nothing, it takes
 * nothing offline, and it is up in every state while the profiler is armed,
 * because a hitch on the deploy screen is still a hitch.
 *
 * **THE THREE BUTTONS EXIST BECAUSE THE POINTER IS LOCKED.** On a desktop
 * mid-round nothing here is clickable at all — the lock eats the click — which
 * is why `F3` is wired to the same path `KEEP` takes and why the flash line
 * reports the outcome on screen rather than in a dialog nobody can dismiss. On
 * a phone there is no lock and the buttons are the whole interface, which is
 * the case this was built for.
 *
 * **The clipboard is tried THREE ways and that is not defensive coding.** The
 * async clipboard needs a secure context, and the way this game is actually
 * played on a phone is a LAN address over plain http — where
 * `navigator.clipboard` is not merely going to reject, it is `undefined`. So
 * the ladder is the modern API, then a `execCommand` textarea, then a
 * download; the last rung always works and is what a desktop wants anyway.
 */
import "./profile.css";
import type { ProfileReport } from "../core/FrameProfile";

/** How long a flash line stays up, in milliseconds. A fact about reading. */
const FLASH_MS = 4000;

/**
 * Seconds between writes to the live line — `HUD`'s `FPS_INTERVAL` and the same
 * argument: four a second is fast enough to see a number move and slow enough
 * to read it standing still.
 *
 * It is also what keeps this file honest about the profiler's own no-allocation
 * rule. `toFixed` mints a string, and a string minted in the render loop is
 * garbage the instrument itself is producing — at four a second it is noise, at
 * 240 it is a contribution to the thing being measured.
 */
const LIVE_INTERVAL = 0.25;

export class ProfileChip {
  private root: HTMLElement;
  private secEl: HTMLElement;
  private hitchEl: HTMLElement;
  private flashEl: HTMLElement;
  private flashTimer = 0;

  /** Last written, so a frame that changes nothing writes nothing. */
  private lastSec = "";
  private lastHitch = -1;
  /** Seconds since the live line was last written. See `LIVE_INTERVAL`. */
  private liveT = 0;

  /**
   * Asked for a report. `full` carries the whole per-frame series.
   *
   * A callback that RETURNS rather than one that is told: the instrument is
   * `Game`'s, the delivery is this file's, and the alternative — handing the
   * chip the profiler — would put the ring one property access away from the
   * interface layer.
   */
  onCapture: ((full: boolean) => ProfileReport | null) | null = null;

  /** Asked for the ring as Chrome Trace Event JSON. */
  onTrace: (() => string) | null = null;

  constructor() {
    const hud = document.getElementById("hud")!;
    this.root = document.createElement("div");
    this.root.id = "prof";
    this.root.className = "hidden";
    this.root.innerHTML = `
      <div class="pr-live">
        <i></i><b class="pr-sec">0.0s</b><em>held</em>
        <b class="pr-hitch">0</b><em>hitches</em>
      </div>
      <div class="pr-acts">
        <button type="button" class="pr-btn" data-act="keep">KEEP</button>
        <button type="button" class="pr-btn" data-act="save">SAVE</button>
        <button type="button" class="pr-btn" data-act="trace">TRACE</button>
      </div>
      <div class="pr-flash hidden"></div>
    `;
    hud.appendChild(this.root);
    this.secEl = this.root.querySelector(".pr-sec") as HTMLElement;
    this.hitchEl = this.root.querySelector(".pr-hitch") as HTMLElement;
    this.flashEl = this.root.querySelector(".pr-flash") as HTMLElement;
    // `forEach` rather than `for..of`: a `NodeList` is only iterable under a
    // lib this project does not target, and `Array.from` would allocate for
    // nothing.
    this.root.querySelectorAll<HTMLElement>(".pr-btn").forEach((el) => {
      // `pointerdown` and not `click`: a tap arrives twice on a phone (see
      // `CONFIG.touch.mouseGrace`), and `preventDefault` here is what stops the
      // synthesized mouse event reaching `InputManager` and convincing it a
      // mouse turned up mid-round.
      el.addEventListener("pointerdown", (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.act(el.dataset.act ?? "");
      });
    });
  }

  /** Up whenever the profiler is recording, in every state. */
  setArmed(on: boolean): void {
    this.root.classList.toggle("hidden", !on);
  }

  /**
   * What the ring is holding. Guarded per field, which is the rule `HUD`'s own
   * setters follow — a write here is a style recalculation — and rate-limited
   * above that, which is the rule `FrameProfile` follows.
   */
  update(dt: number, seconds: number, hitches: number): void {
    this.liveT += dt;
    if (this.liveT < LIVE_INTERVAL) return;
    this.liveT = 0;
    const sec = `${seconds.toFixed(1)}s`;
    if (sec !== this.lastSec) {
      this.lastSec = sec;
      this.secEl.textContent = sec;
    }
    if (hitches !== this.lastHitch) {
      this.lastHitch = hitches;
      this.hitchEl.textContent = String(hitches);
      this.hitchEl.classList.toggle("hot", hitches > 0);
    }
  }

  /** The `F3` path and the `KEEP` button's, so the two cannot diverge. */
  keep(): void {
    this.act("keep");
  }

  private act(what: string): void {
    if (what === "trace") {
      const trace = this.onTrace?.();
      if (!trace || trace === "{}") return this.flash("nothing recorded yet");
      this.download(trace, "trace");
      this.flash("trace saved — open it at ui.perfetto.dev");
      return;
    }
    const full = what === "save";
    const report = this.onCapture?.(full);
    if (!report) return this.flash("nothing recorded yet");
    const json = JSON.stringify(report);
    const line = headline(report);
    if (full) {
      this.download(json, "profile");
      this.flash(`saved · ${line}`);
      return;
    }
    void this.copy(json).then((how) => this.flash(`${how} · ${line}`));
  }

  /**
   * The three-rung ladder from the header. Resolves with what actually
   * happened, because a chip that says "copied" when it downloaded is worse
   * than one that says nothing.
   */
  private async copy(text: string): Promise<string> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return "copied";
      }
    } catch {
      // A rejected write is a permissions or focus problem, not a reason to
      // lose the capture. Fall through.
    }
    if (this.copyByTextarea(text)) return "copied";
    this.download(text, "profile");
    return "saved";
  }

  /** The pre-`navigator.clipboard` route, which is what plain http still has. */
  private copyByTextarea(text: string): boolean {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    try {
      el.select();
      el.setSelectionRange(0, text.length);
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      el.remove();
    }
  }

  private download(text: string, kind: string): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `greywatch-${kind}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Not immediately: Safari has not started the transfer when `click()`
    // returns, and a revoked url is a download that silently never happens.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private flash(text: string): void {
    this.flashEl.textContent = text;
    this.flashEl.classList.remove("hidden");
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashEl.classList.add("hidden");
    }, FLASH_MS);
  }
}

/**
 * The one line worth putting on screen: the pair `HUD.setFps` already argues
 * for, and the phase that came top.
 *
 * The rate alone would be the same lie the mean is — see `FrameProfile`'s
 * `onePercentLow` — and the top phase is what says whether the capture is
 * worth carrying to a desktop at all.
 */
function headline(report: ProfileReport): string {
  const worst = report.phases.find((p) => p.name !== "frame");
  const top = worst ? ` · ${worst.name} ${worst.mean.toFixed(1)}ms` : "";
  return (
    `${report.frame.fps.toFixed(0)} fps · ` +
    `1% low ${report.frame.onePercentLow.toFixed(0)}${top}`
  );
}
