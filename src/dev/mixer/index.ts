/**
 * dev/mixer/index.ts — the dev-only audio mixer: a fader per FAMILY of sound
 * and a fader per SOUND, live, over a round that is still being played.
 * Owns: #mixer-panel, the mute/solo state behind it, and the auditions. It
 * owns no LEVEL — `Sfx` holds the faders and this only moves them.
 * Invariant: dev-only. Reachable solely through the dynamic import() inside
 * the `import.meta.env.DEV` branch in `Game.toggleMixer`, exactly as
 * `src/editor/` is, so none of this and none of `mixer.css` reaches a
 * production bundle. Never import it statically.
 * Invariant: the PANEL is the source of truth for what a fader is worth and
 * `Sfx` is handed what is currently AUDIBLE, which are two different numbers
 * whenever anything is muted or soloed. Saving writes the former. A mixer that
 * saved what it was playing would write a zero into `mix.ts` the first time
 * somebody soloed a row and forgot.
 * Gotcha: this is the one tool here that both READS and WRITES a source file
 * through `/__layout`. See `source.ts` for why it reads rather than importing
 * the file `?raw`.
 */

import type { Vector3 } from "@babylonjs/core";
import {
  CHANNEL_GROUPS,
  CONFIG,
  MIX_CHANNELS,
  MIX_GROUPS,
  type MixChannel,
  type MixGroup,
} from "../../config";
import type { ReportVoice } from "../../entities/weapons";
import type { AmbienceKind, EngineKind, Sfx } from "../../core/Sfx";
import { patchMix, readMixSource, writeMixSource } from "./source";
import "./mixer.css";

/**
 * What the panel needs from the game, and deliberately not a `Game`.
 *
 * TWO positions, because the things this plays are heard at two distances:
 * `at` is ten metres out for anything the panner is most of — a bot's rifle
 * auditioned at the listener is not the sound anybody is mixing — and `near`
 * is the couple of metres a round going PAST actually passes at, which is the
 * whole of what that cue is. `driving` is the engine audition standing down;
 * see `AUDITIONS`.
 */
export interface MixerDeps {
  sfx: Sfx;
  at: () => Vector3;
  near: () => Vector3;
  driving: () => boolean;
}

export interface MixerSession {
  dispose(): void;
}

/** What a family is CALLED on screen. A `Record`, so one cannot go blank. */
const GROUP_LABELS: Record<MixGroup, string> = {
  ownGun: "your weapon",
  worldGun: "gunfire — world",
  mechanism: "reloads & handling",
  impact: "impacts & cracks",
  explosion: "explosions",
  footstep: "footsteps",
  engine: "engines",
  ambience: "ambience",
  feedback: "hit feedback",
  objective: "objective stings",
};

/**
 * What a SOUND is called on screen.
 *
 * The wording is what a player would say rather than what the code does — the
 * point of a mixer is to be usable at speed by ear, and "impactGlass" is not a
 * thing anybody hears.
 */
const CHANNEL_LABELS: Record<MixChannel, string> = {
  rifle: "rifle",
  carbine: "carbine",
  smg: "SMG",
  dmr: "DMR",
  sniper: "sniper",
  lmg: "LMG",
  pistol: "pistol",
  mountedGun: "cupola gun",
  cannon: "tank cannon",
  otherGun: "anything else that shoots",
  reload: "reload",
  boltCycle: "bolt cycle",
  swap: "weapon swap",
  grenadeThrow: "grenade throw",
  mineSet: "mine down",
  rpgLoad: "launcher load",
  botReload: "reload — world",
  impactFlesh: "hit — flesh",
  impactGround: "hit — ground",
  impactHard: "hit — stone & steel",
  impactGlass: "hit — glass",
  nearMiss: "round going past",
  blast: "blast",
  launcher: "launcher firing",
  step: "your boots",
  land: "landing",
  jump: "jump",
  botStep: "boots — world",
  tankEngine: "tank",
  truckEngine: "truck",
  heliEngine: "gunship",
  fire: "fire",
  stream: "stream",
  shore: "shore",
  hitmarker: "hitmarker",
  headshot: "headshot",
  enemyDie: "kill",
  playerHurt: "taking a hit",
  pickup: "pickup",
  capture: "flag taken",
  flagLost: "flag lost",
};

/** Which channels sit under a family, derived so the two cannot disagree. */
const UNDER: Record<MixGroup, MixChannel[]> = (() => {
  const out = {} as Record<MixGroup, MixChannel[]>;
  for (const g of MIX_GROUPS) out[g] = [];
  for (const c of MIX_CHANNELS) {
    for (const g of CHANNEL_GROUPS[c]) out[g].push(c);
  }
  return out;
})();

/**
 * How long a sustained audition is held open, in ms. Long enough for a bed to
 * come up (`Sfx.ambience` fades in over 0.25 s) and be judged against whatever
 * else is going on, short enough that it cannot be mistaken for the world.
 */
const HOLD_MS = 3000;

/** dB is the unit a mix is argued in; the fader is a multiplier. */
const dbOf = (v: number) => 20 * Math.log10(Math.max(1e-4, v));
const linOf = (db: number) => 10 ** (db / 20);

/** The slider's ends. Roughly "gone" to "twice as loud". */
const DB_MIN = -36;
const DB_MAX = 12;

/**
 * A key no real emitter or hull can be using.
 *
 * `Sfx.ambience` and `Sfx.hullEngine` are both keyed by an INDEX owned by the
 * caller — an emitter's registry slot, a hull's position in the fleet — so an
 * audition needs a key out past anything either list can reach rather than a
 * key of its own kind. See `docs/audio.md`: an emitter's index is its
 * identity, and this is the one voice in the process that does not have one.
 */
const AUDITION_KEY = 1_000_000;

/** The four controls every row on either tier carries, spelled once. */
const CONTROLS = `
  <div class="mx-controls">
    <button class="mx-mute" type="button" title="mute">M</button>
    <button class="mx-solo" type="button" title="solo">S</button>
    <input type="range" min="${DB_MIN}" max="${DB_MAX}" step="0.25">
  </div>
`;

export function createMixer(deps: MixerDeps): MixerSession {
  return new MixerPanel(deps);
}

/** One row's controls, whichever tier it is on. */
interface Row {
  root: HTMLDivElement;
  slider: HTMLInputElement;
  value: HTMLSpanElement;
  mute: HTMLButtonElement;
  solo: HTMLButtonElement;
}

class MixerPanel implements MixerSession {
  private readonly root: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly groupRows = new Map<MixGroup, Row>();
  /**
   * A LIST per channel, not a row.
   *
   * A weapon's fader lives under both gun groups, so its row is drawn twice
   * and both copies have to redraw from the one number. Anything that treated
   * this as a single row would leave the copy under `worldGun` showing the
   * value the copy under `ownGun` had before you dragged it.
   */
  private readonly channelRows = new Map<MixChannel, Row[]>();
  private readonly bodies = new Map<MixGroup, HTMLDivElement>();
  private readonly open = new Set<MixGroup>();

  /**
   * What each fader is WORTH — the numbers that get written to disk, and the
   * ones the sliders show.
   *
   * Seeded from the live graph rather than from `CONFIG.mix`, so reopening the
   * panel picks up where the last one left off rather than silently throwing
   * away an unsaved session. That seed is only honest because `dispose` clears
   * mute and solo and pushes the faders back before it lets go —
   * `Sfx.mixGains` answers what is PLAYING, and while anything is muted that
   * is not what anything is worth.
   */
  private readonly gf: Record<MixGroup, number>;
  private readonly cf: Record<MixChannel, number>;
  private readonly mutedG = new Set<MixGroup>();
  private readonly mutedC = new Set<MixChannel>();
  private readonly soloG = new Set<MixGroup>();
  private readonly soloC = new Set<MixChannel>();
  /** Every audition timer, so `dispose` cannot leave a fire burning. */
  private readonly timers: number[] = [];
  private saving = false;

  constructor(private readonly deps: MixerDeps) {
    const live = deps.sfx.mixGains();
    this.gf = live.groups;
    this.cf = live.channels;

    this.root = document.createElement("div");
    this.root.id = "mixer-panel";
    this.root.innerHTML = `
      <h2>AUDIO MIXER</h2>
      <div class="mx-sub">
        A fader per family and a fader per sound; the two multiply. Yellow no
        longer matches <code>config/mix.ts</code>, and SAVE patches exactly
        those lines.
      </div>
      <div id="mx-rows"></div>
      <div class="mx-foot">
        <button id="mx-reset" type="button">reset all</button>
        <button id="mx-save" type="button">save</button>
      </div>
      <div id="mx-status" class="mx-status"></div>
    `;
    const list = this.root.querySelector("#mx-rows") as HTMLDivElement;
    this.status = this.root.querySelector("#mx-status") as HTMLDivElement;

    for (const g of MIX_GROUPS) {
      list.appendChild(this.buildGroup(g));
      const body = document.createElement("div");
      body.className = "mx-body";
      body.hidden = true;
      for (const c of UNDER[g]) body.appendChild(this.buildChannel(c));
      this.bodies.set(g, body);
      list.appendChild(body);
    }

    (this.root.querySelector("#mx-reset") as HTMLButtonElement)
      .addEventListener("click", () => {
        for (const g of MIX_GROUPS) this.gf[g] = 1;
        for (const c of MIX_CHANNELS) this.cf[c] = 1;
        this.pushAll();
        this.refresh();
        this.say("");
      });
    (this.root.querySelector("#mx-save") as HTMLButtonElement)
      .addEventListener("click", () => void this.save());

    // Same mount as every screen in `src/ui/`: `#hud` is the one root, and a
    // class on it belongs to whoever raised it.
    document.getElementById("hud")?.appendChild(this.root);
    this.refresh();
  }

  // ---------------------------------------------------------------- building

  private buildGroup(g: MixGroup): HTMLDivElement {
    const root = document.createElement("div");
    root.className = "mx-row mx-group";
    root.innerHTML = `
      <div class="mx-head">
        <button class="mx-disc" type="button" title="the sounds in it">&#9656;</button>
        <span class="mx-name">${GROUP_LABELS[g]}</span>
        <span class="mx-count">${UNDER[g].length}</span>
        <span class="mx-val" title="click for 0 dB"></span>
      </div>
      ${CONTROLS}
    `;
    const row = this.wire(root);
    (root.querySelector(".mx-disc") as HTMLButtonElement)
      .addEventListener("click", () => this.toggle(g));
    row.slider.addEventListener("input", () => {
      this.setGroup(g, round3(linOf(Number(row.slider.value))));
    });
    row.value.addEventListener("click", () => this.setGroup(g, 1));
    row.mute.addEventListener("click", () => {
      toggleIn(this.mutedG, g);
      this.pushAll();
      this.refresh();
    });
    row.solo.addEventListener("click", () => {
      toggleIn(this.soloG, g);
      this.pushAll();
      this.refresh();
    });
    this.groupRows.set(g, row);
    return root;
  }

  private buildChannel(c: MixChannel): HTMLDivElement {
    const root = document.createElement("div");
    root.className = "mx-row mx-channel";
    // A weapon is ONE fader heard under two families, so its row appears in
    // both. Saying so on the row is what stops the second copy reading as a
    // bug or as a second number.
    const both = CHANNEL_GROUPS[c].length > 1;
    root.innerHTML = `
      <div class="mx-head">
        <span class="mx-name">${CHANNEL_LABELS[c]}</span>
        ${both ? '<span class="mx-both" title="one fader, heard under both gun families">&#8644;</span>' : ""}
        <span class="mx-val" title="click for 0 dB"></span>
      </div>
      <div class="mx-line">
        ${CONTROLS}
        <button class="mx-play" type="button" title="audition"${
          AUDITIONS[c] ? "" : " disabled"
        }>&#9654;</button>
      </div>
    `;
    const row = this.wire(root);
    row.slider.addEventListener("input", () => {
      this.setChannel(c, round3(linOf(Number(row.slider.value))));
    });
    row.value.addEventListener("click", () => this.setChannel(c, 1));
    row.mute.addEventListener("click", () => {
      toggleIn(this.mutedC, c);
      this.pushAll();
      this.refresh();
    });
    row.solo.addEventListener("click", () => {
      toggleIn(this.soloC, c);
      this.pushAll();
      this.refresh();
    });
    (root.querySelector(".mx-play") as HTMLButtonElement)
      .addEventListener("click", () => this.audition(c));

    const rows = this.channelRows.get(c);
    if (rows) rows.push(row);
    else this.channelRows.set(c, [row]);
    return root;
  }

  /** Pulls the four controls out of a row's markup and hands them back. */
  private wire(root: HTMLDivElement): Row {
    return {
      root,
      slider: root.querySelector("input") as HTMLInputElement,
      value: root.querySelector(".mx-val") as HTMLSpanElement,
      mute: root.querySelector(".mx-mute") as HTMLButtonElement,
      solo: root.querySelector(".mx-solo") as HTMLButtonElement,
    };
  }

  private toggle(g: MixGroup): void {
    toggleIn(this.open, g);
    const body = this.bodies.get(g);
    if (body) body.hidden = !this.open.has(g);
    this.refresh();
  }

  // ------------------------------------------------------------------ faders

  private setGroup(g: MixGroup, v: number): void {
    this.gf[g] = v;
    this.deps.sfx.setGroupMix(g, this.groupGain(g));
    this.refresh();
  }

  private setChannel(c: MixChannel, v: number): void {
    this.cf[c] = v;
    this.deps.sfx.setChannelMix(c, this.channelGain(c));
    this.refresh();
  }

  /**
   * What a family should currently SOUND like, which is its fader unless
   * something is standing in front of it.
   *
   * Solo is checked first and is a whole-TIER state: the moment any family is
   * soloed, every family that is not becomes silent regardless of its own
   * mute. The two tiers solo independently and the result is the intersection
   * — soloing `reload` alone leaves it playing through `mechanism`'s own
   * fader, which is what "let me hear this one thing, in place" has to mean.
   */
  private groupGain(g: MixGroup): number {
    if (this.soloG.size > 0 && !this.soloG.has(g)) return 0;
    return this.mutedG.has(g) ? 0 : this.gf[g];
  }

  private channelGain(c: MixChannel): number {
    if (this.soloC.size > 0 && !this.soloC.has(c)) return 0;
    return this.mutedC.has(c) ? 0 : this.cf[c];
  }

  private pushAll(): void {
    for (const g of MIX_GROUPS) this.deps.sfx.setGroupMix(g, this.groupGain(g));
    for (const c of MIX_CHANNELS) {
      this.deps.sfx.setChannelMix(c, this.channelGain(c));
    }
  }

  /** Redraws every row from the faders, the four sets, and what is on disk. */
  private refresh(): void {
    for (const g of MIX_GROUPS) {
      const r = this.groupRows.get(g);
      if (!r) continue;
      this.paint(r, this.gf[g], CONFIG.mix.groups[g], this.mutedG.has(g), this.soloG.has(g));
      // A collapsed family still has to say that something under it moved, or
      // the one thing this panel is for — knowing what you have changed — is
      // hidden behind a disclosure triangle.
      const dirtyChild = UNDER[g].some((c) => this.cf[c] !== CONFIG.mix.channels[c]);
      r.root.classList.toggle("mx-child-dirty", dirtyChild);
      r.root.classList.toggle("mx-open", this.open.has(g));
      const disc = r.root.querySelector(".mx-disc");
      if (disc) disc.innerHTML = this.open.has(g) ? "&#9662;" : "&#9656;";
    }
    for (const c of MIX_CHANNELS) {
      for (const r of this.channelRows.get(c) ?? []) {
        this.paint(r, this.cf[c], CONFIG.mix.channels[c], this.mutedC.has(c), this.soloC.has(c));
      }
    }
  }

  private paint(r: Row, v: number, onDisk: number, muted: boolean, solo: boolean): void {
    const db = dbOf(v);
    r.slider.value = String(clamp(db, DB_MIN, DB_MAX));
    r.value.textContent = `${db >= 0 ? "+" : ""}${db.toFixed(1)} dB`;
    // `CONFIG.mix` is the file as it stood when the page loaded, which is the
    // only baseline this panel can honestly claim — a save is a patch against
    // the CURRENT text on disk, re-read at save time.
    r.root.classList.toggle("mx-dirty", v !== onDisk);
    r.mute.classList.toggle("mx-on", muted);
    r.solo.classList.toggle("mx-on", solo);
  }

  private say(text: string, kind: "" | "mx-good" | "mx-bad" = ""): void {
    this.status.textContent = text;
    this.status.className = `mx-status ${kind}`;
  }

  /** Plays whatever stands in for one sound. See `AUDITIONS`. */
  private audition(c: MixChannel): void {
    const fn = AUDITIONS[c];
    if (!fn) return;
    const stop = fn(this.deps, (id) => this.timers.push(id));
    if (stop) this.timers.push(window.setTimeout(stop, HOLD_MS));
  }

  // -------------------------------------------------------------------- disk

  /**
   * Reads `mix.ts` off the dev server, patches both tables' value lines, and
   * writes it back.
   *
   * The read is what makes this safe to do repeatedly and safe to do beside a
   * hand edit: the baseline is always the bytes currently on disk, so a save
   * cannot re-apply an earlier session's numbers on top of a file somebody has
   * since edited.
   */
  private async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.say("saving…");
    try {
      const read = await readMixSource();
      if (!read.ok) {
        this.say(read.error, "mx-bad");
        return;
      }
      const patched = patchMix(read.source, this.gf, this.cf);
      if (!patched.ok) {
        this.say(patched.error, "mx-bad");
        return;
      }
      if (patched.changed === 0) {
        this.say("nothing to save — mix.ts already matches");
        return;
      }
      const wrote = await writeMixSource(patched.source);
      if (!wrote.ok) {
        this.say(wrote.error, "mx-bad");
        return;
      }
      this.say(
        `saved ${patched.changed} fader${patched.changed > 1 ? "s" : ""} to config/mix.ts`,
        "mx-good",
      );
    } finally {
      this.saving = false;
    }
  }

  /**
   * Closing the panel is not the same as putting the mix back: the faders
   * stand, because the whole point is to keep listening to them. What DOES go
   * back is mute and solo, which are the panel's own state and would otherwise
   * leave a sound silent for the rest of the session with nothing on screen to
   * say why.
   */
  dispose(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.length = 0;
    this.mutedG.clear();
    this.mutedC.clear();
    this.soloG.clear();
    this.soloC.clear();
    this.pushAll();
    // Whatever an audition may have left holding a voice. Both are idempotent
    // and the engine one is skipped while somebody is actually driving, which
    // is the only case where the voice is not ours to stop.
    this.deps.sfx.ambienceOff(AUDITION_KEY);
    if (!this.deps.driving()) this.deps.sfx.engineOff();
    this.root.remove();
  }
}

/**
 * Every `ReportVoice` in the game, by the channel it named.
 *
 * DERIVED rather than listed, so a weapon added to `CONFIG.weapons` with a
 * `mix` on its report gets an audition button without this file hearing about
 * it — and a channel no voice claims simply has none, which is the right
 * answer for `otherGun`.
 */
const VOICES: Partial<Record<MixChannel, ReportVoice>> = (() => {
  const out: Partial<Record<MixChannel, ReportVoice>> = {};
  for (const w of Object.values(CONFIG.weapons)) {
    if (w.report.mix) out[w.report.mix] = w.report;
  }
  for (const k of ["tank", "truck", "heli"] as const) {
    const r = CONFIG.vehicles[k].mg.report;
    if (r.mix) out[r.mix] = r;
  }
  return out;
})();

/** Every powerplant, by the channel it named. Same derivation, same reason. */
const ENGINES: Partial<Record<MixChannel, EngineKind>> = (() => {
  const out: Partial<Record<MixChannel, EngineKind>> = {};
  for (const k of ["tank", "truck", "heli"] as const) {
    out[CONFIG.vehicles[k].engine.mix] = CONFIG.vehicles[k].engine;
  }
  return out;
})();

/**
 * What stands in for each sound when there is no round going on around you.
 *
 * A one-shot channel plays one representative sound and returns nothing. A
 * SUSTAINED one — a bed, an engine — has to be held open instead, so it
 * returns the thing that stands it down again and the panel schedules that.
 * `null` is a channel with no honest stand-in.
 *
 * **A weapon plays TWICE, in your hands and then out in the street**, because
 * that channel is one fader living under both gun families and the two are the
 * whole reason it is one fader rather than two.
 *
 * **The engines' is the one with a window in it.** It borrows the DRIVEN voice
 * (`engineOn`) rather than a hull's, because `Game.pushHullEngines` stands
 * every hull voice down on any frame that did not step the fleet — on a map
 * with no vehicles that is every frame, and the audition would be torn down as
 * fast as it was built. The borrow is safe while nobody is driving, which is
 * why it asks; mounting a hull inside the three seconds it is held would have
 * the real engine adopted and then stopped, and the fix for that is to
 * dismount and remount.
 */
type Audition = (
  deps: MixerDeps,
  keep: (id: number) => void,
) => (() => void) | void;

/** A carried weapon: your own report, then the same weapon across the street. */
function gun(c: MixChannel): Audition {
  return ({ sfx, at }, keep) => {
    const voice = VOICES[c];
    if (!voice) return;
    sfx.shoot(voice);
    keep(window.setTimeout(() => sfx.botShot(at(), 0, voice), 550));
  };
}

/** One bed, stood up at `at()` and taken down again. */
function bed(kind: AmbienceKind): Audition {
  return ({ sfx, at }) => {
    // `Sfx.ambience` builds on the first call and only moves the panner
    // afterwards, so one call opens the voice and nothing has to pump it. It
    // is placed once and does not follow the camera, deliberately: a fire that
    // walks with you is not a fire you can judge the rolloff of.
    sfx.ambience(AUDITION_KEY, at(), kind);
    return () => sfx.ambienceOff(AUDITION_KEY);
  };
}

/** One powerplant, held at a fast idle. */
function plant(c: MixChannel): Audition {
  return (deps) => {
    const kind = ENGINES[c];
    if (!kind || deps.driving()) return;
    deps.sfx.engineOn(kind);
    deps.sfx.engineDrive(0.55, 6);
    return () => deps.sfx.engineOff();
  };
}

const AUDITIONS: Record<MixChannel, Audition | null> = {
  rifle: gun("rifle"),
  carbine: gun("carbine"),
  smg: gun("smg"),
  dmr: gun("dmr"),
  sniper: gun("sniper"),
  lmg: gun("lmg"),
  pistol: gun("pistol"),
  // Never unpanned even for the player firing it — see `CHANNEL_GROUPS`.
  mountedGun: ({ sfx, at }) => {
    const voice = VOICES.mountedGun;
    if (voice) sfx.botShot(at(), 0, voice);
  },
  cannon: ({ sfx, at }) => {
    sfx.cannon(at());
  },
  // The rifle's row IS the reference report, so the default voice is what a
  // weapon that named no channel is heard as.
  otherGun: ({ sfx, at }, keep) => {
    sfx.shoot();
    keep(window.setTimeout(() => sfx.botShot(at()), 550));
  },

  reload: ({ sfx }) => {
    sfx.reload(2.2);
  },
  boltCycle: ({ sfx }) => {
    sfx.boltCycle(1.25, CONFIG.weapons.sniper.report);
  },
  swap: ({ sfx }) => {
    sfx.swap(0.5);
  },
  grenadeThrow: ({ sfx }) => {
    sfx.grenadeThrow();
  },
  mineSet: ({ sfx }) => {
    sfx.mineSet();
  },
  rpgLoad: ({ sfx }) => {
    sfx.rpgLoad(2.5);
  },
  botReload: ({ sfx, at }) => {
    sfx.botReload(at());
  },

  impactFlesh: ({ sfx, at }) => {
    sfx.impact(at(), "flesh");
  },
  impactGround: ({ sfx, at }) => {
    sfx.impact(at(), "ground");
  },
  impactHard: ({ sfx, at }) => {
    sfx.impact(at(), "hard");
  },
  impactGlass: ({ sfx, at }) => {
    sfx.impact(at(), "glass");
  },
  // The one cue heard CLOSE by definition: the real thing passes inside two
  // metres, and at ten it is a different sound entirely.
  nearMiss: ({ sfx, near }) => {
    sfx.nearMiss(near());
  },

  blast: ({ sfx, at }) => {
    sfx.explosion(at());
  },
  launcher: ({ sfx, at }) => {
    sfx.launcher(at());
  },

  step: ({ sfx }, keep) => {
    sfx.step(1);
    keep(window.setTimeout(() => sfx.step(0.9), 380));
    keep(window.setTimeout(() => sfx.step(1), 760));
  },
  land: ({ sfx }) => {
    sfx.land(0.8);
  },
  jump: ({ sfx }) => {
    sfx.jump();
  },
  botStep: ({ sfx, at }, keep) => {
    sfx.botStep(at());
    keep(window.setTimeout(() => sfx.botStep(at()), 400));
  },

  tankEngine: plant("tankEngine"),
  truckEngine: plant("truckEngine"),
  heliEngine: plant("heliEngine"),

  fire: bed(CONFIG.audio.ambience.fire),
  stream: bed(CONFIG.audio.ambience.stream),
  shore: bed(CONFIG.audio.ambience.shore),

  hitmarker: ({ sfx }) => {
    sfx.hit();
  },
  headshot: ({ sfx }) => {
    sfx.headshot();
  },
  enemyDie: ({ sfx }) => {
    sfx.enemyDie();
  },
  playerHurt: ({ sfx }) => {
    sfx.playerHurt();
  },
  pickup: ({ sfx }) => {
    sfx.pickup();
  },

  capture: ({ sfx }) => {
    sfx.capture();
  },
  flagLost: ({ sfx }) => {
    sfx.flagLost();
  },
};

function toggleIn<T>(set: Set<T>, v: T): void {
  if (set.has(v)) set.delete(v);
  else set.add(v);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
