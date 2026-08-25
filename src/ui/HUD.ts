/**
 * HUD.ts — The gameplay chrome, and only that: vitals/ammo/grenades, the stowed
 * slot, reinforcement gauge, flag strip, capture-zone panel, crosshair,
 * hitmarker, damage vignette, directional damage arcs, toasts, killfeed,
 * score feed, scoreboard.
 * Invariants: Game pushes state every frame (setHealth/setAmmo/setFlags/
 * setCapture/setViewYaw/...) — setting HUD state from anywhere else is
 * overwritten next tick. Pure DOM manipulation; reads ControlPoint data, never
 * imports game systems beyond types. Transient elements (toasts, killfeed)
 * self-remove via setTimeout; the damage arcs are a fixed pool, never allocated
 * per hit.
 *
 * **The hitmarker is the one transient with an ORDERING, and it is a rule
 * rather than a preference.** Rounds land faster than the mark lives and one
 * blast raises it once per body it caught, so a flash may only ever RAISE what
 * the mark says (`HIT_RANK`) — a plain hit arriving a few milliseconds after a
 * kill re-pops the mark and changes nothing else. It is also the one thing
 * here that has to be TORN DOWN rather than left to expire: the HUD is ticked
 * with `dt = 0` under a pause, so a mark hidden by a lid would otherwise still
 * be there when the lid came off. See `flashHitmarker` and `dropHitmarker`.
 *
 * The menu, the round-over card and the pause list are NOT here — they are
 * `OverlayScreen`, a peer of DeployScreen and LoadoutScreen. This file was both
 * for a long time, which is why every new screen grew it. What stays is the two
 * class toggles that hide the HUD's OWN chrome while something covers it,
 * `setPaused` and `setEditing`; `.overlaid` went with the cards that raise it.
 *
 * Per-frame writes touch text nodes, class flags and CSS custom properties
 * only — never innerHTML. Every element written 60 times a second (the ticket
 * gauge, the flag cells, the magazine strip) is built once and cached, and
 * `setScoreboard` is the one markup-rebuilding call left.
 *
 * **EVERY SETTER GUARDS ITS OWN WRITE.** `Game.updateHud` pushes the whole
 * gauge set on every frame — that is the right shape, and it says nothing
 * about how often the DOM should hear it. Health moves on a hit, tickets a few
 * times a second, the flag strip on a capture, and the scoreboard's markup only
 * while Tab is held. So each setter keeps the value it last handed over and
 * writes only on a difference; `setFps` is the pattern, and the `last*` block
 * of fields below is the bookkeeping. Adding a setter here without a guard is
 * adding a style recalculation to every frame of the game.
 */
import "./hud.css";
import { CONFIG } from "../config";
import type { ControlPoint } from "../systems/ConquestSystem";
import type { ScoreKind } from "../systems/ScoreBook";
import { pingQuality, pingText } from "./ping";

/**
 * Geometry of one damage arc, in the pixels of its own SVG box. Art constants,
 * so they live here rather than in CONFIG — the timings that make it *feel*
 * right are the tunables, and those are in `CONFIG.damageIndicator`.
 */
const ARC_BOX = 300;
const ARC_RADIUS = 104;
const ARC_HALF_SPAN_DEG = 29;
const ARC_THICKNESS = 8;
/** How far the tip juts past the outer edge, and how much of the span it eats. */
const ARC_TIP = 5;
const ARC_TIP_HALF_U = 0.1;

/**
 * Seconds between writes to the frame-rate readout. Not a gameplay tunable —
 * it is how fast a number can change and still be read, which is a fact about
 * eyes, so it stays here rather than in CONFIG (the same split the editor's
 * `tuning.ts` makes). Four a second is fast enough to see a dip and slow
 * enough to hold still while you read it.
 */
const FPS_INTERVAL = 0.25;
/**
 * The window the 1% low is taken over, and the ring that holds it.
 *
 * The rate beside it is Babylon's own 30-frame rolling MEAN, and a mean is
 * close to the worst statistic for judging smoothness: it is dominated by the
 * frames that arrive quickly, while what you feel is the ones that do not.
 * Measured, a 5/5/5/33 ms stream reads 83 fps as a mean and 30 fps as a 1%
 * low — a game hitching four times a second, with the headline number saying
 * everything is fine. The pair is the point; neither number alone is
 * diagnostic.
 *
 * Five seconds is long enough that a single spike does not define the reading
 * and short enough that the number still responds to what you just did. The
 * ring is sized for that window at 240 Hz with room to spare; the window is
 * trimmed by TIME rather than by count, so it means five seconds at every
 * frame rate rather than "the last N frames", which would be five seconds at
 * 60 and two at 144.
 */
const FPS_WINDOW = 5;
const FPS_MAX_SAMPLES = 1536;
/** Below this the percentile is noise, and the low reads `--` instead. */
const FPS_MIN_SAMPLES = 30;

/** One live directional damage arc, pointing at where a shot came from. */
interface DamageArc {
  el: HTMLElement;
  /** World bearing to the shooter (radians, 0 = +Z), fixed at the hit. */
  bearing: number;
  /** Seconds of life left; <= 0 means the slot is free. */
  t: number;
  /** 0..1 from the damage that spawned it — drives opacity. */
  strength: number;
}

/**
 * The arc shape: an annulus sector whose thickness tapers to nothing at both
 * ends, with a small tip at the apex jutting *outward* — away from the
 * crosshair, along the bearing to the shooter. A constant-thickness band
 * reads as a slice of a ring around the crosshair; the taper plus that tip is
 * what makes it read as a pointer. The tip is on the outer edge only, so the
 * inner edge stays a clean arc and the crosshair keeps its clearance. Built
 * once as a path string and shared by every element in the pool.
 */
function damageArcMarkup(): string {
  const c = ARC_BOX / 2;
  // Even, and fine enough that the tip's straight sides don't read as steps.
  const steps = 48;
  const outer: string[] = [];
  const inner: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const ang = ((-ARC_HALF_SPAN_DEG + u * ARC_HALF_SPAN_DEG * 2) * Math.PI) / 180;
    const taper = Math.pow(Math.max(0, Math.cos((u - 0.5) * Math.PI)), 0.7);
    // Linear falloff either side of the apex: straight sides, so it reads as a
    // point rather than a bulge. `steps` is even, so u = 0.5 is sampled exactly
    // and the apex is a real vertex.
    const tip = ARC_TIP * Math.max(0, 1 - Math.abs(u - 0.5) / ARC_TIP_HALF_U);
    const ro = ARC_RADIUS + (ARC_THICKNESS / 2) * taper + tip;
    const ri = ARC_RADIUS - (ARC_THICKNESS / 2) * taper;
    const sin = Math.sin(ang);
    const cos = Math.cos(ang);
    outer.push(`${(c + ro * sin).toFixed(1)} ${(c - ro * cos).toFixed(1)}`);
    inner.push(`${(c + ri * sin).toFixed(1)} ${(c - ri * cos).toFixed(1)}`);
  }
  inner.reverse();
  const d = `M ${outer.join(" L ")} L ${inner.join(" L ")} Z`;
  return `<svg viewBox="0 0 ${ARC_BOX} ${ARC_BOX}" width="${ARC_BOX}" height="${ARC_BOX}"><path d="${d}"/></svg>`;
}

/**
 * The magazine strip's box, in px — the health bar's width, which is what the
 * whole right column is measured in. Must match `#mag-strip` in `hud.css`,
 * where the box is fixed and the ticks are placed inside it.
 */
const MAG_STRIP_W = 224;

/**
 * The magazine strip's box height, and the gap between its rows when it has
 * two. Both must match `#mag-strip` in `hud.css`: the box is the fixed thing —
 * a strip that grew a row would move the ammo count and the weapon label with
 * it on every swap — so a second row is paid for out of the tick's HEIGHT.
 */
const MAG_STRIP_H = 13;
const MAG_ROW_GAP = 1;

/**
 * The narrowest a tick may be drawn. Under about three pixels the gaps close
 * up faster than the ticks do and the row stops being a count you can read at
 * a glance — it is a bar, which is what the strip exists not to be.
 */
const MIN_PIP_W = 3;

/**
 * Tick geometry for a row of `perRow` rounds: the pitch is whatever the fixed
 * box divides into, and both figures keep their authored size (5px tick, 2px
 * gap) until the row would overflow. Past that they close up together.
 */
function pipMetrics(perRow: number): { gap: number; w: number } {
  const pitch = MAG_STRIP_W / perRow;
  const gap = Math.min(2, pitch * 0.32);
  return { gap, w: Math.min(5, pitch - gap) };
}

/** Signed shortest angle from `a` to `b`, in radians. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * What each award is called on the score feed.
 *
 * A total map over `ScoreKind`, which is derived from `CONFIG.score` — so
 * adding a way to earn points fails to compile here until it has a name the
 * player will read, and there is no award that can appear as a bare number.
 */
const LABELS: Record<ScoreKind, string> = {
  kill: "KILL",
  headshot: "HEADSHOT",
  attack: "ATTACK",
  defend: "DEFEND",
  capture: "CAPTURE",
  neutralise: "NEUTRALISE",
};

/**
 * How severe the round that just landed was, in one number.
 *
 * The marker is a single element re-triggered several times a second at
 * automatic rates, so "which flavour is on screen" has to be comparable
 * rather than merely settable: two rounds land inside one marker's life
 * often enough that whichever arrived LAST used to decide what it said, and
 * a blast that kills one body and wounds another raises this handler once
 * per victim in whatever order the pool happens to hold them. That is the
 * bug the player sees as a kill marker that "did not come up" — it came up
 * and was overwritten by an ordinary hit a few milliseconds later.
 *
 * A rank makes the rule one comparison: a flash may only ever move the
 * marker UP this scale while the previous one is still standing. Nothing is
 * lost by it — the lesser round still re-pops the marker (see `hitPop`), so
 * every hit is still confirmed; it just cannot take the louder statement
 * away.
 */
const HIT_RANK = { hit: 1, head: 2, kill: 3, headKill: 4 } as const;

/**
 * How long each flavour stands, in seconds, indexed by the rank above.
 *
 * They are deliberately NOT equal, and the spread is the other half of the
 * missing-kill-marker complaint. A body hit is the common case and wants to
 * be brief — at 600 rpm a marker that outlived its round would smear the
 * next one — while a kill is the rarest thing the marker says and the only
 * one that asks the player to CHANGE what they are doing (stop shooting,
 * pick the next man). Every flavour used to stand for 120 ms, which for the
 * kill is seven frames arriving in the same instant as a muzzle flash, a
 * tracer and the crosshair blooming — it was being missed because it was
 * genuinely almost not there.
 */
const HIT_LIFE = [0, 0.14, 0.2, 0.42, 0.46] as const;

/**
 * The pop each landed round gives the marker, and how it decays.
 *
 * Restarted on EVERY flash rather than only on a flavour change, which is
 * what keeps a string of body hits legible as separate rounds: without it a
 * second hit inside the first's life is a marker that simply stays where it
 * is, and reads as one hit that lasted longer.
 */
const HIT_POP = 0.09;
const HIT_POP_GAIN = 0.55;

/**
 * The fraction of a marker's life spent fading out.
 *
 * The marker used to vanish between two frames, which at 140 ms reads as a
 * flicker rather than as a mark. Fading the tail costs nothing (the element
 * is already written every frame it is up) and is most of why the longer
 * kill marker does not feel like a sticker left on the screen.
 */
const HIT_FADE = 0.45;

/** The kill ring's travel, as a multiple of its drawn radius. */
const RING_FROM = 0.45;
const RING_TO = 1.5;

/**
 * One combatant's line on the scoreboard.
 *
 * A body, not a person: a bot and a human are the same row with the same three
 * numbers, because they are the same thing to the round they are fighting in.
 * `Game.scoreRows` builds these — offline from its own counters, in a match
 * from the authority's table — and this file only sorts and prints them.
 *
 * `name` is the one field here that can be a STRANGER'S STRING, so it is
 * written with `textContent` and never interpolated into markup. The server
 * bounds its length on arrival; nothing bounds what is in it.
 */
export interface ScoreRow {
  name: string;
  team: number;
  kills: number;
  deaths: number;
  /**
   * Points: kills, the bonuses on them, and what this body has been paid for
   * the flags — see `config/score.ts`.
   *
   * The column the board is SORTED by, and the reason it exists: a round is
   * won on flags and lost on tickets, so the player who took three of them is
   * doing more for the win than the one with four more kills, and a board
   * ordered by kills says the opposite in the one place everybody looks.
   */
  score: number;
  /** The local player's own row, which the board picks out. */
  you: boolean;
  /**
   * Round trip to the server in ms, or -1 where there is no connection to
   * measure — every bot on the board, and every row of an offline round.
   *
   * The authority's own measurement, mirrored: see `PingsMessage` for why a
   * client cannot produce this column for anybody but itself. Rendered by
   * `ui/ping.ts`, which is also what the lobby's reading goes through.
   */
  ping: number;
}

/**
 * The vehicle the player is driving, as the bottom-right band draws it.
 *
 * Derived by `Game` from the live `Tank` each frame, exactly as `CaptureStatus`
 * is derived from a `ControlPoint`: the HUD reads no game system, and the words
 * ("LOADED", "LOADING") are its own.
 */
export interface VehicleStatus {
  health: number;
  maxHealth: number;
  /** 0 just fired, 1 loaded. The gun's whole magazine, as one number. */
  load: number;
}

/**
 * The flag the player is standing in, relative to the player's own team. Game
 * derives this from the live ControlPoint each frame; the HUD picks the words.
 */
export interface CaptureStatus {
  /** Single letter, A..E. */
  id: string;
  name: string;
  owner: "mine" | "theirs" | "neutral";
  /** 0..1 — how far the meter has run, whichever way it has run. */
  progress: number;
  /**
   * The side the meter currently stands for — the bar's colour. Distinct from
   * `taking` on purpose: a flag at 95% theirs that you have just walked onto
   * is still showing a red bar while it runs back down toward you.
   */
  held: "mine" | "theirs";
  /** Which way the meter is being pushed, from who is standing in the zone. */
  taking: "mine" | "theirs";
  contested: boolean;
  /** Enemies standing in the zone with you. */
  enemies: number;
}

/**
 * DOM-based HUD: vitals/ammo, the Conquest reinforcement gauge and flag strip,
 * crosshair, hitmarker, damage vignette, toasts, killfeed and scoreboard.
 * Styling is `hud.css`, imported above.
 */
export class HUD {
  private root: HTMLElement;
  private healthFill: HTMLElement;
  private healthText: HTMLElement;
  private healthBar: HTMLElement;
  private ammoMag: HTMLElement;
  private ammoCap: HTMLElement;
  private magStrip: HTMLElement;
  private nadePips: HTMLElement;
  /** One pip per grenade carried; rebuilt only when the pouch size changes. */
  private nadeMarks: HTMLElement[] = [];
  /**
   * The anti-tank row: the same instrument as the frag pouch, one row down,
   * and up only on a kit that has the slot.
   *
   * Pips rather than a number for the reason the pouch is pips: two a life
   * with no resupply is a decision, and a decision has to be readable without
   * being counted. It is a row of its own rather than a third state on the
   * frag row because they are two independent pouches and a player spending
   * one is not spending the other.
   */
  private atRow!: HTMLElement;
  private atCap!: HTMLElement;
  private atPips!: HTMLElement;
  private atMarks: HTMLElement[] = [];
  private atBuilt = -1;
  private lastAt = -1;
  private nadeBuilt = -1;
  private hudRight: HTMLElement;
  private weaponLabel: HTMLElement;
  /** The stowed weapon's row — the slot key, its name and its magazine. */
  private stowed: HTMLElement;
  private stowedParts: {
    key: HTMLElement;
    name: HTMLElement;
    ammo: HTMLElement;
    cap: HTMLElement;
  };
  /** Last written, so a per-frame push writes nothing while nothing moves. */
  private stowedAmmoText = "";
  private stowedCapText = "";
  /**
   * Whether the carried weapon is empty and not being reloaded — recorded by
   * `setAmmo` and read by `setStowedAmmo`, which is the one state the stowed
   * row cannot see for itself and the whole basis of its `ready` cue.
   */
  private handsDry = false;
  /** One tick per round in the magazine; rebuilt only when the size changes. */
  private magTicks: HTMLElement[] = [];
  private magBuilt = -1;
  private flagStrip: HTMLElement;
  /** One cell per flag, rebuilt only when the roster changes. */
  private flagCells: { wrap: HTMLElement; fill: HTMLElement }[] = [];
  /** The reinforcement gauge's parts — written every frame, never rebuilt. */
  private ticketParts: {
    tag: HTMLElement;
    num: HTMLElement;
    fill: HTMLElement;
  }[] = [];
  private crosshair: HTMLElement;
  private hitmarker: HTMLElement;
  /** The kill ring inside the marker, driven per frame like the ticks. */
  private hitRing: HTMLElement;
  private vignette: HTMLElement;
  private damageDirs: HTMLElement;
  private message: HTMLElement;
  /**
   * The leash warning, on a map whose boundary is open. Two parts and only the
   * count is written per frame; see `setLeash`.
   */
  private outbounds: HTMLElement;
  private outboundsCount: HTMLElement;
  private toasts: HTMLElement;
  private lockHint: HTMLElement;
  /**
   * The driver's chrome. `#hud-kit` is the infantry half of the bottom-right
   * band and `#vehicle` is the armour half; `.mounted` on `#hud` swaps which
   * one is up, so nothing here has to hide four elements by name and then
   * remember all four the day a fifth arrives.
   */
  private hudKit: HTMLElement;
  private vehicle: HTMLElement;
  private vehicleParts: {
    hp: HTMLElement;
    hull: HTMLElement;
    gun: HTMLElement;
    load: HTMLElement;
  };
  /**
   * Where the tank's gun actually points, projected to the glass — NOT the
   * middle of the screen. See `setGunMarker`.
   */
  private gunMarker: HTMLElement;
  private usePrompt: HTMLElement;
  private usePromptParts: { key: HTMLElement; text: HTMLElement };
  private killfeed: HTMLElement;
  private scorefeed: HTMLElement;
  private scoreboard: HTMLElement;
  private capture: HTMLElement;
  /** The capture panel's parts, looked up once — it is written every frame. */
  private captureParts: {
    id: HTMLElement;
    name: HTMLElement;
    fill: HTMLElement;
    state: HTMLElement;
  };


  /** What the marker is saying, on the `HIT_RANK` scale; 0 when it is down. */
  private hitRank = 0;
  /** How long the current marker has left, and what it started with. */
  private hitT = 0;
  private hitLife = 0;
  /** The per-round pop, restarted by every flash including a repeat one. */
  private hitPop = 0;
  /**
   * The kill ring's own clock, deliberately not the marker's.
   *
   * A body hit landing on a man who is already going down extends the marker
   * (it is a round that landed, and it re-pops), and if the ring rode that
   * clock it would be thrown out a second time by a round that killed nobody
   * — the one statement the ring exists to make, made about the wrong bullet.
   */
  private hitRingT = 0;
  private hitRingLife = 0;
  private vignetteT = 0;
  private messageT = 0;
  /**
   * The whole second currently on the leash warning, or -1 while it is down.
   * The panel is written once a second rather than once a frame, and -1 is what
   * distinguishes "hidden" from "showing a zero".
   */
  private leashShown = -1;
  private leashUrgent = false;
  /** The frame-rate readout, and the clock that rations writes to it. */
  private fpsBox: HTMLElement;
  private fpsNum: HTMLElement;
  private fpsMs: HTMLElement;
  private fpsLow: HTMLElement;
  private fpsAccum = 0;
  private fpsText = "";
  private fpsMsText = "";
  private fpsLowText = "";

  /**
   * LAST-WRITTEN VALUES FOR THE PER-FRAME GAUGES.
   *
   * `Game.updateHud` pushes every one of these on every frame of a live round,
   * because the HUD is told what the world is rather than asked — which is the
   * right shape and says nothing about how often the DOM should hear it. Almost
   * none of them actually change from frame to frame: health moves on a hit,
   * tickets a few times a second, the flag strip on a capture. Written
   * unconditionally, the gauges alone were ~75 DOM property writes a frame, of
   * which two were guarded, and ten of them were whole-`className` assignments
   * that invalidate style on their node whether or not the string differs.
   *
   * `setFps` above is the pattern the rest of the file now follows: keep the
   * string (or the number) that was last handed to the DOM, and write only when
   * this frame's differs. The comparison is a few dozen JS compares against a
   * style recalculation, so it is not close.
   *
   * These are values LAST WRITTEN, never a second copy of game state — nothing
   * reads them but the guard that owns each one.
   *
   * **INVALIDATION IS LOCAL TO THE REBUILD, and there is deliberately no
   * central `reset`.** A guard goes stale for exactly one reason: the element
   * it remembers a write to was replaced under it. The HUD's own markup is
   * written once in the constructor and never torn down as a whole, so there is
   * no moment when all of these are stale together for something to clear —
   * which means the four calls that DO replace their elements each clear their
   * own guards on the spot, in the same branch that rebuilt them: the magazine
   * strip on a change of magazine size, the grenade pips on a change of pouch,
   * the flag cells on a change of flag count, and the scoreboard's key when the
   * board comes back up. Anything added here that replaces a cached element
   * owes the same line next to the rebuild, or the new node inherits a previous
   * one's "already correct" and the first write it needs is the write it skips.
   */
  private lastUsePrompt = false;
  private lastUseText = "";
  private lastMounted = false;
  private lastHullText = "";
  private lastHullWidth = "";
  private lastLoadWidth = "";
  private lastLoaded = true;
  /** The marker's last position, as the string that was written. "" is hidden. */
  private lastMarker = "";
  private lastHealthWidth = "";
  private lastHealthLow = false;
  private lastHealthText = "";
  /**
   * Tick bookkeeping only — which ticks in `magTicks` currently read "spent".
   * Deliberately separate from `lastAmmoText`: on a weapon swap the strip is
   * rebuilt all-unspent, so this has to be reset to the new magazine's length
   * while the READOUT beside it is still showing the old weapon's count and
   * must be written even if the two magazines happen to be equally full.
   */
  private lastAmmo = -1;
  private lastAmmoText = "";
  private lastAmmoCap = "";
  private lastAmmoLow = false;
  private lastReloading = false;
  private lastGrenades = -1;
  private lastNoNades = false;
  private lastTicketTag: [string, string] = ["", ""];
  private lastTicketNum: [string, string] = ["", ""];
  private lastTicketWidth: [string, string] = ["", ""];
  private lastTicketCritical: [boolean, boolean] = [false, false];
  private lastFlagClass: string[] = [];
  private lastFlagHeight: string[] = [];
  private lastFlagFill: string[] = [];
  private lastCaptureKey = "";
  private lastCrosshairOpacity = "";
  private lastCrosshairSpread = "";
  private lastScoreboardVisible = false;
  private lastScoreboardKey = "";
  private lastLockHint = false;
  private lastTouching = false;
  private lastStowedDry = false;
  private lastStowedReady = false;
  /**
   * The frame times behind the 1% low, as a ring — a circular buffer rather
   * than a shifted array because this is written on every frame at up to
   * 240 Hz, and a readout whose own allocations cause a hitch is worse than no
   * readout. Both this and the sort scratch are allocated once, for the same
   * reason.
   */
  private readonly frameTimes = new Float64Array(FPS_MAX_SAMPLES);
  private readonly frameScratch = new Float64Array(FPS_MAX_SAMPLES);
  private frameStart = 0;
  private frameCount = 0;
  /** Seconds held in the ring — the trim condition, kept incrementally. */
  private frameSum = 0;
  /** Fixed pool, grown to CONFIG.damageIndicator.maxArcs and never past it. */
  private damageArcs: DamageArc[] = [];
  /** The view yaw the arcs are projected against; pushed every frame. */
  private viewYaw = 0;

  constructor() {
    this.root = document.getElementById("hud")!;
    this.root.innerHTML = `
      <div id="scrim"></div>
      <div id="ticket-bar">
        <div class="side mine"><span class="tag"></span><span class="n"></span></div>
        <div class="gauge">
          <div class="track mine"><i></i></div>
          <div class="track theirs"><i></i></div>
        </div>
        <div class="side theirs"><span class="n"></span><span class="tag"></span></div>
      </div>
      <div id="flag-strip"></div>
      <div id="crosshair">
        <i class="t"></i><i class="r"></i><i class="b"></i><i class="l"></i>
        <span class="dot"></span>
      </div>
      <div id="hitmarker" class="hidden">
        <i><b></b></i><i><b></b></i><i><b></b></i><i><b></b></i>
        <span class="ring"></span>
      </div>
      <div id="vignette"></div>
      <div id="damage-dirs"></div>
      <div id="message" class="hidden"></div>
      <div id="toasts"></div>
      <div id="killfeed"></div>
      <div id="scorefeed"></div>
      <div id="scoreboard" class="frame hidden"></div>
      <div id="lock-hint" class="hidden"><b>CLICK</b> TO CAPTURE THE MOUSE</div>
      <div id="gun-marker" class="hidden">
        <i class="t"></i><i class="r"></i><i class="b"></i><i class="l"></i>
      </div>
      <div id="use-prompt" class="hidden"><b></b><span></span></div>
      <div id="hud-fps" class="hidden">
        <span class="fps-main"><b>--</b><em>FPS</em></span>
        <span class="fps-sub"><b>--</b><em>ms</em></span>
        <span class="fps-sub"><b>--</b><em>low</em></span>
      </div>
      <div id="outbounds" class="hidden">
        <div class="ob-head">LEAVING THE BATTLEFIELD</div>
        <div class="ob-count"><b></b><em>RETURN</em></div>
      </div>
      <div id="capture-status" class="hidden">
        <div class="cap-head"><span class="cap-id"></span><span class="cap-name"></span></div>
        <div class="cap-meter"><div class="cap-meter-fill"></div><i class="ticks"></i></div>
        <div class="cap-state"></div>
      </div>
      <div id="hud-bottom">
        <div id="hud-left">
          <div class="cap-row"><span class="cap">VITALS</span></div>
          <div class="hp-bar"><i id="health-fill"></i><b class="segs"></b></div>
          <div class="hp-num"><span id="health-text">100</span><em>HP</em></div>
        </div>
        <div id="hud-right">
          <div id="hud-kit">
            <div class="cap-row nades">
              <span class="cap">FRAG</span>
              <span id="nade-pips"></span>
            </div>
            <div class="cap-row nades hidden" id="at-row">
              <span class="cap" id="at-cap">RPG</span>
              <span id="at-pips"></span>
            </div>
            <div class="ammo-row">
              <div id="stowed">
                <span class="key"></span>
                <span class="cap"></span>
                <span class="n"><b></b><em></em></span>
              </div>
              <div class="ammo">
                <span id="ammo-mag">0</span><span id="ammo-cap"></span>
              </div>
            </div>
            <div id="mag-strip"></div>
            <div class="cap-row">
              <span class="cap" id="weapon-label">RIFLE &middot; AUTO</span>
              <span class="reload-note">RELOADING</span>
            </div>
          </div>
          <div id="vehicle" class="hidden">
            <div class="cap-row"><span class="cap">HULL</span><span class="veh-hp">0</span></div>
            <div class="veh-bar hull"><i></i></div>
            <div class="cap-row"><span class="cap">MAIN GUN</span><span class="veh-gun">LOADED</span></div>
            <div class="veh-bar load"><i></i></div>
          </div>
        </div>
      </div>
    `;
    this.fpsBox = document.getElementById("hud-fps")!;
    const fpsFields = this.fpsBox.querySelectorAll("b");
    this.fpsNum = fpsFields[0] as HTMLElement;
    this.fpsMs = fpsFields[1] as HTMLElement;
    this.fpsLow = fpsFields[2] as HTMLElement;
    this.healthFill = document.getElementById("health-fill")!;
    this.healthText = document.getElementById("health-text")!;
    this.healthBar = this.root.querySelector("#hud-left .hp-bar") as HTMLElement;
    this.ammoMag = document.getElementById("ammo-mag")!;
    this.ammoCap = document.getElementById("ammo-cap")!;
    this.magStrip = document.getElementById("mag-strip")!;
    this.nadePips = document.getElementById("nade-pips")!;
    this.atRow = document.getElementById("at-row")!;
    this.atCap = document.getElementById("at-cap")!;
    this.atPips = document.getElementById("at-pips")!;
    this.hudRight = document.getElementById("hud-right")!;
    this.weaponLabel = document.getElementById("weapon-label")!;
    this.stowed = document.getElementById("stowed")!;
    this.stowedParts = {
      key: this.stowed.querySelector(".key") as HTMLElement,
      name: this.stowed.querySelector(".cap") as HTMLElement,
      ammo: this.stowed.querySelector(".n b") as HTMLElement,
      cap: this.stowed.querySelector(".n em") as HTMLElement,
    };
    this.flagStrip = document.getElementById("flag-strip")!;
    this.crosshair = document.getElementById("crosshair")!;
    this.hitmarker = document.getElementById("hitmarker")!;
    this.hitRing = this.hitmarker.querySelector(".ring") as HTMLElement;
    this.vignette = document.getElementById("vignette")!;
    this.damageDirs = document.getElementById("damage-dirs")!;
    this.message = document.getElementById("message")!;
    this.outbounds = document.getElementById("outbounds")!;
    this.outboundsCount = this.outbounds.querySelector(".ob-count b") as HTMLElement;
    this.toasts = document.getElementById("toasts")!;
    this.lockHint = document.getElementById("lock-hint")!;
    this.hudKit = document.getElementById("hud-kit")!;
    this.vehicle = document.getElementById("vehicle")!;
    this.vehicleParts = {
      hp: this.vehicle.querySelector(".veh-hp") as HTMLElement,
      hull: this.vehicle.querySelector(".veh-bar.hull i") as HTMLElement,
      gun: this.vehicle.querySelector(".veh-gun") as HTMLElement,
      load: this.vehicle.querySelector(".veh-bar.load i") as HTMLElement,
    };
    this.gunMarker = document.getElementById("gun-marker")!;
    this.usePrompt = document.getElementById("use-prompt")!;
    this.usePromptParts = {
      key: this.usePrompt.querySelector("b") as HTMLElement,
      text: this.usePrompt.querySelector("span") as HTMLElement,
    };
    this.killfeed = document.getElementById("killfeed")!;
    this.scorefeed = document.getElementById("scorefeed")!;
    this.scoreboard = document.getElementById("scoreboard")!;
    this.capture = document.getElementById("capture-status")!;
    this.captureParts = {
      id: this.capture.querySelector(".cap-id") as HTMLElement,
      name: this.capture.querySelector(".cap-name") as HTMLElement,
      fill: this.capture.querySelector(".cap-meter-fill") as HTMLElement,
      state: this.capture.querySelector(".cap-state") as HTMLElement,
    };
    // The gauge is [mine, theirs] in DOM order, which is also the order
    // setTickets resolves the teams into — index 0 is always the player's.
    const bar = document.getElementById("ticket-bar")!;
    this.ticketParts = (["mine", "theirs"] as const).map((side) => ({
      tag: bar.querySelector(`.side.${side} .tag`) as HTMLElement,
      num: bar.querySelector(`.side.${side} .n`) as HTMLElement,
      fill: bar.querySelector(`.track.${side} i`) as HTMLElement,
    }));
  }

  update(dt: number): void {
    if (this.hitT > 0) {
      this.hitT -= dt;
      this.hitPop = Math.max(0, this.hitPop - dt);
      if (this.hitT <= 0) {
        this.hitmarker.classList.add("hidden");
        // So the next round is compared against nothing rather than against
        // whatever the last one happened to be — the rank is only an
        // upgrade gate while a marker is actually standing.
        this.hitRank = 0;
      } else {
        // The pop and the fade are driven here rather than by a CSS
        // animation: the marker is re-triggered several times a second at
        // full auto, and restarting a keyframe animation needs a forced
        // reflow every time.
        //
        // Squared, so the mark snaps out and settles rather than easing
        // linearly back — the whole travel is 90 ms and a linear one reads
        // as a wobble at that length.
        const pop = this.hitPop / HIT_POP;
        const scale = 1 + HIT_POP_GAIN * pop * pop;
        this.hitmarker.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        const fade = Math.min(1, this.hitT / (this.hitLife * HIT_FADE));
        this.hitmarker.style.opacity = fade.toFixed(3);
      }
    }
    // The ring is the kill's own mark and the slow half of the cue — what
    // makes a kill a different SHAPE and not merely a redder one. Its clock
    // is stepped beside the marker's rather than inside it, because the two
    // genuinely can outlive each other: `dropHitmarker` takes both, and a
    // later body hit extends the marker without re-throwing the ring.
    if (this.hitRingT > 0) {
      this.hitRingT -= dt;
      const t = Math.min(1, 1 - this.hitRingT / this.hitRingLife);
      // Eased out: the ring leaves fast and settles, which is what makes it
      // read as thrown off the body rather than as a circle growing.
      const r = RING_FROM + (RING_TO - RING_FROM) * (1 - (1 - t) * (1 - t));
      this.hitRing.style.transform = `scale(${r.toFixed(3)})`;
      this.hitRing.style.opacity = (1 - t).toFixed(3);
    }
    if (this.vignetteT > 0) {
      this.vignetteT -= dt;
      this.vignette.style.opacity = String(Math.max(0, this.vignetteT / 0.5) * 0.55);
    }
    if (this.messageT > 0) {
      this.messageT -= dt;
      if (this.messageT <= 0) this.message.classList.add("hidden");
    }
    this.updateDamageArcs(dt);
  }

  /** Puts the frame-rate readout up or takes it away. A player setting. */
  setFpsVisible(on: boolean): void {
    this.fpsBox.classList.toggle("hidden", !on);
    if (!on) {
      // So the next time it is shown starts from the current rate rather than
      // from whatever was on screen when it was switched off. The ring goes
      // with it: nothing is sampled while the readout is down, so what is left
      // in it is however long ago the player last looked.
      this.fpsAccum = Infinity;
      this.fpsText = "";
      this.fpsMsText = "";
      this.fpsLowText = "";
      this.frameStart = 0;
      this.frameCount = 0;
      this.frameSum = 0;
    }
  }

  /**
   * The frame rate, throttled to a readable cadence.
   *
   * It takes its OWN clock rather than riding `update`'s `dt`, and that is not
   * redundancy: `update` is called with `dt = 0` while the game is paused (so
   * the killfeed freezes with the world), and a counter that stops counting
   * because the round is held is a counter that lies about the frame rate it
   * is still being handed. `realDt` is the engine's unclamped delta, so the
   * cadence is the same at 30 fps and at 240.
   *
   * The rate itself is Babylon's own smoothed average — a raw 1/dt flickers
   * through a three-digit range and is unreadable — and each DOM write is
   * skipped when its rounded string has not moved, which at a steady rate is
   * most of the time. The HUD's rule against per-frame text writes is what
   * both halves are for.
   *
   * THREE numbers, because one is not diagnostic. The rate is throughput; the
   * milliseconds beside it are the same fact stated so it can be compared
   * (frame time scales linearly with what you turned on, where a rate does
   * not — 7.0 to 6.2 ms is legible in a way 143 to 161 fps is not); and the
   * low is the worst of the last few seconds, which is the one that tracks
   * how the game FEELS. A high rate beside a low `low` is judder, and it is
   * the case a single averaged number cannot show.
   */
  setFps(fps: number, realDt: number): void {
    if (this.fpsBox.classList.contains("hidden")) return;
    this.pushFrameTime(realDt);
    this.fpsAccum += realDt;
    if (this.fpsAccum < FPS_INTERVAL) return;
    this.fpsAccum = 0;

    const text = String(Math.round(fps));
    if (text !== this.fpsText) {
      this.fpsText = text;
      this.fpsNum.textContent = text;
    }
    // The mean frame time. Derived from the rate rather than measured
    // separately, because `fps` IS 1000/mean — two independently computed
    // figures for one quantity would sooner or later disagree on screen.
    const ms = fps > 0 ? (1000 / fps).toFixed(1) : "--";
    if (ms !== this.fpsMsText) {
      this.fpsMsText = ms;
      this.fpsMs.textContent = ms;
    }
    const low = this.onePercentLow();
    const lowText = low > 0 ? String(Math.round(low)) : "--";
    if (lowText !== this.fpsLowText) {
      this.fpsLowText = lowText;
      this.fpsLow.textContent = lowText;
    }
  }

  /**
   * Adds a frame to the ring and trims it back to `FPS_WINDOW` seconds.
   *
   * Trimming by accumulated TIME rather than by sample count is what makes the
   * window mean the same thing at 60 Hz and at 240; the count cap behind it is
   * only a backstop for a rate high enough to overrun the ring inside the
   * window, and it drops the oldest sample rather than refusing the newest.
   */
  private pushFrameTime(dt: number): void {
    if (this.frameCount === FPS_MAX_SAMPLES) this.dropOldestFrame();
    this.frameTimes[(this.frameStart + this.frameCount) % FPS_MAX_SAMPLES] = dt;
    this.frameSum += dt;
    this.frameCount += 1;
    // Always leave one sample, so a single frame longer than the whole window
    // (a map build, an alt-tab) is still reported rather than emptying it.
    while (this.frameCount > 1 && this.frameSum > FPS_WINDOW) {
      this.dropOldestFrame();
    }
  }

  private dropOldestFrame(): void {
    this.frameSum -= this.frameTimes[this.frameStart];
    this.frameStart = (this.frameStart + 1) % FPS_MAX_SAMPLES;
    this.frameCount -= 1;
  }

  /**
   * The "1% low": the rate implied by the MEAN of the slowest 1% of frames in
   * the window. Zero until the ring holds enough frames for that to mean
   * anything, which the caller shows as `--`.
   *
   * The mean of the worst 1%, deliberately, and not the 99th percentile —
   * they sound interchangeable and are not. A percentile is a single sample
   * from the tail, so it cannot move until a full 1% of frames are bad: over
   * a 5 s window at 120 Hz that is six frames, and a lone 100 ms stall sits at
   * index 599 of 600 where p99 reads index 594 and never sees it. Measured,
   * that stall left a p99 reading a clean 120 — a hitch you would certainly
   * feel, reported as perfect. Averaging the tail lets one bad frame pull the
   * figure down in proportion to how bad it was, which is the behaviour this
   * number exists to have.
   *
   * A full sort at four times a second over a few hundred floats is far below
   * anything that would matter, and it is done into a preallocated scratch so
   * the readout allocates nothing per update. `Float64Array.sort` is numeric
   * by default — the ascending-string default that catches `Array.sort` out
   * does not apply here.
   */
  private onePercentLow(): number {
    if (this.frameCount < FPS_MIN_SAMPLES) return 0;
    for (let i = 0; i < this.frameCount; i++) {
      this.frameScratch[i] =
        this.frameTimes[(this.frameStart + i) % FPS_MAX_SAMPLES];
    }
    const window = this.frameScratch.subarray(0, this.frameCount);
    window.sort();
    // At least one frame, so a short window still reports its worst rather
    // than dividing by zero.
    const tail = Math.max(1, Math.floor(this.frameCount * 0.01));
    let sum = 0;
    for (let i = this.frameCount - tail; i < this.frameCount; i++) {
      sum += window[i];
    }
    const mean = sum / tail;
    return mean > 0 ? 1 / mean : 0;
  }

  /**
   * The yaw the damage arcs are drawn against — the aim yaw, so an arc lines
   * up with the crosshair you would have to put on the shooter.
   */
  setViewYaw(yaw: number): void {
    this.viewYaw = yaw;
  }

  /**
   * Records a hit from `bearing` (world radians, 0 = +Z), the way Battlefield
   * does it: the direction is world-space and fixed at the moment of the hit,
   * and it is the *view* that moves under it. Repeated hits from roughly the
   * same place refresh one arc rather than stacking (see `mergeDegrees`).
   */
  addDamageDirection(bearing: number, amount: number): void {
    const cfg = CONFIG.damageIndicator;
    const strength = Math.max(0, Math.min(1, amount / cfg.fullDamage));
    const merge = (cfg.mergeDegrees * Math.PI) / 180;

    let slot: DamageArc | null = null;
    for (const arc of this.damageArcs) {
      if (arc.t > 0 && Math.abs(angleDelta(arc.bearing, bearing)) < merge) {
        // The newest hit wins the bearing: a shooter who has moved should drag
        // their arc with them rather than leave it where they opened up.
        arc.bearing = bearing;
        arc.t = cfg.life;
        arc.strength = Math.max(arc.strength, strength);
        return;
      }
      if (arc.t <= 0 && !slot) slot = arc;
    }

    if (!slot) {
      if (this.damageArcs.length < cfg.maxArcs) {
        const el = document.createElement("div");
        el.className = "arc";
        el.innerHTML = damageArcMarkup();
        this.damageDirs.appendChild(el);
        slot = { el, bearing, t: 0, strength };
        this.damageArcs.push(slot);
      } else {
        // Pool full and all live: the arc closest to expiring is the least
        // useful one, so recycle that rather than dropping the new threat.
        slot = this.damageArcs.reduce((a, b) => (b.t < a.t ? b : a));
      }
    }
    slot.bearing = bearing;
    slot.t = cfg.life;
    slot.strength = strength;
    slot.el.style.display = "block";
  }

  /** Wipes the arcs — death, deploy, round end. Stale threats mean nothing. */
  clearDamageDirections(): void {
    for (const arc of this.damageArcs) {
      arc.t = 0;
      arc.el.style.display = "none";
    }
  }

  private updateDamageArcs(dt: number): void {
    const cfg = CONFIG.damageIndicator;
    for (const arc of this.damageArcs) {
      if (arc.t <= 0) continue;
      arc.t -= dt;
      if (arc.t <= 0) {
        arc.el.style.display = "none";
        continue;
      }
      // World yaw 0 faces +Z and grows clockwise seen from above, which is the
      // same sense as a CSS rotation of an up-pointing shape — so the bearing
      // minus the view yaw IS the screen angle, with no axis flip.
      const rel = ((arc.bearing - this.viewYaw) * 180) / Math.PI;
      const fade = Math.min(1, arc.t / cfg.fadeTime);
      const opacity =
        (cfg.minOpacity + (cfg.maxOpacity - cfg.minOpacity) * arc.strength) * fade;
      // A brief pop outward on arrival: the arc has to catch the eye in a
      // firefight where the screen is already flashing red.
      const age = cfg.life - arc.t;
      const punch = 1 + 0.09 * Math.max(0, 1 - age / 0.16);
      arc.el.style.opacity = opacity.toFixed(3);
      arc.el.style.transform = `rotate(${rel.toFixed(2)}deg) scale(${punch.toFixed(3)})`;
    }
  }

  setHealth(current: number, max: number): void {
    const frac = Math.max(0, current / max);
    const width = `${frac * 100}%`;
    if (width !== this.lastHealthWidth) {
      this.lastHealthWidth = width;
      this.healthFill.style.width = width;
    }
    // The low state is carried on the whole block, not just the fill: the bar
    // goes red, the readout goes red, and both breathe, which is the one thing
    // that has to register without being looked at.
    const low = frac < 0.3;
    if (low !== this.lastHealthLow) {
      this.lastHealthLow = low;
      this.healthBar.classList.toggle("low", low);
      this.healthText.classList.toggle("low", low);
    }
    const text = String(Math.ceil(current));
    if (text !== this.lastHealthText) {
      this.lastHealthText = text;
      this.healthText.textContent = text;
    }
  }

  setAmmo(ammo: number, magSize: number, reloading: boolean): void {
    if (this.magBuilt !== magSize) {
      this.magStrip.innerHTML = "";
      this.magTicks = [];
      // One tick per round however many rounds there are, so it is the PITCH
      // that gives way rather than the count: the LMG's belt is 75, and at the
      // authored 5px tick and 2px gap that row would be 525px — more than
      // twice the gauges it sits under. Both keep their authored size until
      // the row would overflow (anything up to 32 rounds), so the rifle's
      // strip is untouched; past that they close up together. The SMG's 34
      // came to 236 and now fits the 224 the rest of the column is drawn in.
      //
      // The belt is the one that cannot be squeezed into a single row: 75
      // rounds is a 2.0px tick behind a 0.96px gap, which is a bar with a
      // texture rather than a count. It gets a SECOND ROW instead, and the
      // threshold is that measurement rather than a round number, so a future
      // magazine earns the row by being unreadable at one. The rows are
      // explicit rather than `flex-wrap`, because a wrap decides how many fit
      // from a width this code computed to fit exactly that many — a rounding
      // error either way and a row breaks a tick early.
      const rows = pipMetrics(magSize).w < MIN_PIP_W ? 2 : 1;
      const cols = Math.ceil(magSize / rows);
      const { gap, w } = pipMetrics(cols);
      this.magStrip.style.setProperty("--pip-gap", `${gap.toFixed(2)}px`);
      this.magStrip.style.setProperty("--pip-w", `${w.toFixed(2)}px`);
      const rowH = (MAG_STRIP_H - (rows - 1) * MAG_ROW_GAP) / rows;
      this.magStrip.style.setProperty("--pip-h", `${rowH.toFixed(2)}px`);
      // Filled by COLUMN, not by line: consecutive rounds are the top and the
      // bottom of one column, so a column is worth `rows` rounds and the lit
      // FRACTION of the strip is the fraction of the magazine left — the same
      // reading as every one-row weapon, which is the only reason a second row
      // is allowed at all. Filled by line instead, the top row would stay full
      // until the belt was half gone and the glance would need to know where
      // the split was.
      //
      // The rows are explicit rather than `flex-wrap`, because a wrap decides
      // how many fit from a width this code computed to fit exactly that many,
      // and a rounding error either way breaks the row a tick early.
      const rowEls: HTMLElement[] = [];
      for (let r = 0; r < rows; r++) {
        const row = document.createElement("b");
        this.magStrip.appendChild(row);
        rowEls.push(row);
      }
      // An uneven belt leaves its empty slot at the TOP-LEFT — the corner the
      // last round to be fired lives furthest from, so the right-hand edge the
      // eye reads against is a full column all the way down.
      const blank = rows * cols - magSize;
      for (let i = 0; i < magSize; i++) {
        const tick = document.createElement("i");
        rowEls[(i + blank) % rows].appendChild(tick);
        this.magTicks.push(tick);
      }
      this.magBuilt = magSize;
      // A fresh strip is all-unspent, so the "already correct" the guard below
      // would otherwise inherit is a lie about a different weapon's magazine.
      this.lastAmmo = this.magTicks.length;
    }
    // One tick per round left in the magazine — the count is legible without
    // reading the number, which is the whole point of a strip.
    //
    // ONLY THE TICKS THAT CROSSED. A shot moves one; a reload moves the whole
    // strip once. Toggling all of them every frame was O(magSize) DOM writes
    // for a state that changes on a trigger pull — 75 of them a frame for the
    // belt, which is the weapon that can least afford it because it is also the
    // one firing fastest.
    if (ammo !== this.lastAmmo) {
      const lo = Math.max(0, Math.min(ammo, this.lastAmmo));
      const hi = Math.min(this.magTicks.length, Math.max(ammo, this.lastAmmo));
      for (let i = lo; i < hi; i++) {
        this.magTicks[i].classList.toggle("spent", i >= ammo);
      }
      this.lastAmmo = ammo;
    }
    const text = String(ammo);
    if (text !== this.lastAmmoText) {
      this.lastAmmoText = text;
      this.ammoMag.textContent = text;
    }
    const cap = `/ ${magSize}`;
    if (cap !== this.lastAmmoCap) {
      this.lastAmmoCap = cap;
      this.ammoCap.textContent = cap;
    }
    const low = !reloading && ammo <= magSize * 0.25;
    if (low !== this.lastAmmoLow) {
      this.lastAmmoLow = low;
      this.ammoMag.classList.toggle("low", low);
    }
    if (reloading !== this.lastReloading) {
      this.lastReloading = reloading;
      this.hudRight.classList.toggle("reloading", reloading);
    }
    // Read by `setStowedAmmo`, pushed immediately after this one. "Nothing to
    // fire with" is the whole condition, and a reload counts: firing the last
    // round starts one in the same call (`Player.tryShot`), so an empty
    // magazine that is not already being changed is a state the HUD would
    // never get a frame of — and the reload is the interval that matters
    // anyway. A draw is a third of a second where a reload is one and a half,
    // which is the entire argument for carrying the second slot.
    this.handsDry = ammo <= 0 || reloading;
  }

  /**
   * The grenade pouch: one pip per grenade carried, spent ones hollowed out
   * rather than removed. A count you can read at a glance matters more here
   * than for ammunition — you carry two for a whole life and there is no
   * resupply, so "how many left" is a decision rather than a status.
   *
   * Built against `carried` rather than the live count for the same reason the
   * magazine strip is built against `magSize`: the row must not change width
   * as it empties.
   */
  setGrenades(count: number, carried: number): void {
    if (this.nadeBuilt !== carried) {
      this.nadePips.innerHTML = "";
      this.nadeMarks = [];
      for (let i = 0; i < carried; i++) {
        const pip = document.createElement("i");
        this.nadePips.appendChild(pip);
        this.nadeMarks.push(pip);
      }
      this.nadeBuilt = carried;
      this.lastGrenades = this.nadeMarks.length;
    }
    if (count !== this.lastGrenades) {
      const lo = Math.max(0, Math.min(count, this.lastGrenades));
      const hi = Math.min(this.nadeMarks.length, Math.max(count, this.lastGrenades));
      for (let i = lo; i < hi; i++) {
        this.nadeMarks[i].classList.toggle("spent", i >= count);
      }
      this.lastGrenades = count;
    }
    const none = count <= 0;
    if (none !== this.lastNoNades) {
      this.lastNoNades = none;
      this.hudRight.classList.toggle("no-nades", none);
    }
  }

  /**
   * The anti-tank pouch, or nothing at all.
   *
   * A null `label` takes the row away outright, which is what every map with
   * no armour on it and every netplay round hand it — the same rule the kit
   * screen's row follows, and for the same reason: a slot that is not there
   * is not a slot that is empty, and drawing it would be the HUD explaining a
   * rule instead of reporting a state.
   *
   * The caption is composed by `Game` rather than derived here, because what
   * it has to say differs per item: a launcher's row is the name, and a mine's
   * carries how many of yours are lying on the field — which is a number only
   * the system that owns them can answer, and one that matters because laying
   * a third lifts the first.
   */
  setAntiTank(label: string | null, count: number, carried: number): void {
    if (label === null) {
      this.atRow.classList.add("hidden");
      // Forgotten rather than kept: the next kit with a slot may be a
      // different item with a different pouch size, and a stale build count
      // would leave it drawing the last one's pips.
      this.atBuilt = -1;
      return;
    }
    this.atRow.classList.remove("hidden");
    if (this.atCap.textContent !== label) this.atCap.textContent = label;
    if (this.atBuilt !== carried) {
      this.atPips.innerHTML = "";
      this.atMarks = [];
      for (let i = 0; i < carried; i++) {
        const pip = document.createElement("i");
        this.atPips.appendChild(pip);
        this.atMarks.push(pip);
      }
      this.atBuilt = carried;
      this.lastAt = -1;
    }
    if (count !== this.lastAt) {
      for (let i = 0; i < this.atMarks.length; i++) {
        this.atMarks[i].classList.toggle("spent", i >= count);
      }
      this.lastAt = count;
    }
  }

  /**
   * Reinforcement counts, as two gauges draining away from the centre. The
   * player's team is always the left-hand one. `CONFIG.conquest.tickets` is the
   * full-scale reading — the gauge is a fraction of the round's starting pool,
   * so "we are losing" reads off the bar rather than off the arithmetic.
   */
  setTickets(names: readonly string[], tickets: readonly number[], playerTeam: number): void {
    const max = CONFIG.conquest.tickets;
    const order = [playerTeam, 1 - playerTeam];
    for (let i = 0; i < 2; i++) {
      const team = order[i];
      const part = this.ticketParts[i];
      const n = tickets[team];
      const tag = names[team].toUpperCase();
      if (tag !== this.lastTicketTag[i]) {
        this.lastTicketTag[i] = tag;
        part.tag.textContent = tag;
      }
      const num = String(n);
      if (num !== this.lastTicketNum[i]) {
        this.lastTicketNum[i] = num;
        part.num.textContent = num;
      }
      const width = `${Math.max(0, Math.min(1, n / max)) * 100}%`;
      if (width !== this.lastTicketWidth[i]) {
        this.lastTicketWidth[i] = width;
        part.fill.style.width = width;
      }
      const critical = n / max < 0.15;
      if (critical !== this.lastTicketCritical[i]) {
        this.lastTicketCritical[i] = critical;
        part.num.classList.toggle("critical", critical);
      }
    }
  }

  /**
   * The A..E flag strip. Each cell is a hexagon in its owner's colour, filling
   * from the bottom with the capture meter, so a flag being taken is visible
   * without looking at it. The two-layer shape (`.core` inset inside the
   * coloured hull) is how the cell gets a border at all: `clip-path` clips a
   * CSS border away with everything else outside the polygon.
   */
  setFlags(points: ControlPoint[], playerTeam: number): void {
    if (this.flagCells.length !== points.length) {
      this.flagStrip.innerHTML = "";
      this.flagCells = points.map((p) => {
        const wrap = document.createElement("div");
        wrap.className = "flag";
        wrap.innerHTML =
          `<div class="core"><i class="cap-fill"></i>` +
          `<span class="id">${p.def.id}</span></div>`;
        this.flagStrip.appendChild(wrap);
        return { wrap, fill: wrap.querySelector(".cap-fill") as HTMLElement };
      });
      // The cells are new, so nothing has been written to them yet.
      this.lastFlagClass = [];
      this.lastFlagHeight = [];
      this.lastFlagFill = [];
    }
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const cell = this.flagCells[i];
      const owner =
        p.owner === null ? "neutral" : p.owner === playerTeam ? "mine" : "theirs";
      // Guarded harder than the rest: `className =` is an attribute write, so
      // it invalidates style on the node whether or not the string changed, and
      // there are two of them per cell across five cells. A flag's owner and
      // contested state change a handful of times in a round; the meter moves
      // only while someone is standing in the zone.
      const cls = `flag ${owner}${p.contested ? " contested" : ""}`;
      if (cls !== this.lastFlagClass[i]) {
        this.lastFlagClass[i] = cls;
        cell.wrap.className = cls;
      }
      // Meter runs -1..+1; show it as distance from neutral either way.
      const height = `${Math.abs(p.meter) * 100}%`;
      if (height !== this.lastFlagHeight[i]) {
        this.lastFlagHeight[i] = height;
        cell.fill.style.height = height;
      }
      const fill = `cap-fill ${
        Math.sign(p.meter) === (playerTeam === 0 ? -1 : 1) ? "mine" : "theirs"
      }`;
      if (fill !== this.lastFlagFill[i]) {
        this.lastFlagFill[i] = fill;
        cell.fill.className = fill;
      }
    }
  }

  /**
   * The leash: `remaining` seconds before leaving the play square kills you, or
   * null when there is nothing to say.
   *
   * On a map closed by the rim this is never anything but null, because there is
   * a wall and you are standing against it. On one with a `borderland` it is the
   * ONLY thing telling a player that the field they are walking into is not part
   * of the map — there is no rock, no fence and deliberately no invisible wall
   * to bump into — so it is the loudest thing the HUD draws, and it says what to
   * do rather than what has happened.
   *
   * The count is displayed rounded UP, so it opens on the full ten and only
   * shows a 1 while there is genuinely under a second of it left; rounding to
   * nearest would spend half of the first second on a number the player never
   * had.
   */
  setLeash(remaining: number | null): void {
    if (remaining === null) {
      if (this.leashShown !== -1) {
        this.leashShown = -1;
        this.outbounds.classList.add("hidden");
      }
      return;
    }
    const secs = Math.max(0, Math.ceil(remaining));
    const urgent = remaining <= CONFIG.map.leash.urgentAt;
    // One write per changed second, not one per frame: the panel is otherwise
    // still, and the class carries the only other thing about it that moves.
    if (this.leashShown === -1) this.outbounds.classList.remove("hidden");
    if (secs !== this.leashShown || urgent !== this.leashUrgent) {
      this.leashShown = secs;
      this.leashUrgent = urgent;
      this.outboundsCount.textContent = `${secs}`;
      // Toggled rather than reassigned: `hidden` lives on the same element and
      // an assignment here would take it off on the frame the panel goes away.
      this.outbounds.classList.toggle("urgent", urgent);
    }
  }

  /**
   * The "you are standing in it" panel: shown only while the player is inside
   * a capture zone, which is the one thing the flag strip cannot say. The ring
   * on the ground draws the boundary; this confirms which side of it you are
   * on, and what the meter is doing about it.
   */
  setCapture(status: CaptureStatus | null): void {
    if (!status) {
      if (this.lastCaptureKey !== "") {
        this.lastCaptureKey = "";
        this.capture.classList.add("hidden");
      }
      return;
    }
    // A held flag with nobody contesting it has no meter story to tell, so the
    // panel says so rather than showing a full bar and leaving you to read it.
    // Worked out BEFORE the key, because the key is built from what is drawn.
    const pct = Math.round(status.progress * 100);
    let state: string;
    if (status.contested) {
      const n = status.enemies;
      state = `CONTESTED — ${n} ENEM${n === 1 ? "Y" : "IES"} IN ZONE`;
    } else if (status.owner === "mine" && status.progress >= 1) {
      state = "SECURED";
    } else if (status.taking === "mine") {
      state = "CAPTURING";
    } else {
      state = "LOSING";
    }
    // One key for the whole panel: it is six writes that all move together.
    // **It carries the drawn percent and the drawn WORDS, never the raw
    // progress or the two fields the words are picked from.** The bar is drawn
    // in whole percent, so 0.996 and a full 1.0 are one key — and a flag you
    // already own can sit in that last half-percent, because ownership is only
    // lost by crossing zero: walk back onto a slipped flag of your own and the
    // frame it reaches 1.0 changes nothing else in the status. A key holding
    // the number would swallow that frame and leave CAPTURING on screen over a
    // secured point. Keyed on the text, the key changes exactly when the panel
    // does, which is what it is for.
    const key = `${status.id}|${status.owner}|${status.contested}|${status.held}|${pct}|${state}`;
    if (key === this.lastCaptureKey) return;
    this.lastCaptureKey = key;
    const parts = this.captureParts;
    // Rewritten wholesale rather than toggled, which is also what clears the
    // `hidden` the null branch above puts back on. `frame` has to be re-stated
    // here — it is what draws the panel's chamfered hull.
    this.capture.className = `frame zone ${status.owner}${
      status.contested ? " contested" : ""
    }`;
    parts.id.textContent = status.id;
    parts.name.textContent = status.name.toUpperCase();
    parts.fill.style.width = `${pct}%`;
    parts.fill.className = `cap-meter-fill ${status.held}`;
    parts.state.textContent = state;
  }

  /**
   * Crosshair state, pushed every frame. The gap between the four ticks IS the
   * current bullet spread in screen pixels, so recoil bloom is visible as the
   * crosshair opening up and settling as it bleeds off. The ticks read the gap
   * off the `--sp` custom property, so one write per frame moves all four and
   * the browser keeps it on the compositor.
   *
   * `adsBlend` fades it out rather than switching it off: aimed, the weapon's
   * own holo reticle sits on the camera axis at the exact centre of the
   * screen, and two aiming marks stacked on each other read as a smear. The
   * fade rides the same blend the sight comes up on, so the handover happens
   * while the rifle is still moving.
   */
  setCrosshair(adsBlend: number, spreadPx: number): void {
    // These two genuinely do move most frames of a live round — the spread
    // bleeds off after every shot and the blend runs whenever the sight comes
    // up. They are guarded anyway, because the frames they DON'T move on are
    // the ones a player spends walking with the trigger off, which is most of
    // them, and the size is already quantised to the pixel it is drawn at.
    const opacity = `${Math.max(0, 1 - adsBlend * 1.6)}`;
    if (opacity !== this.lastCrosshairOpacity) {
      this.lastCrosshairOpacity = opacity;
      this.crosshair.style.opacity = opacity;
    }
    const size = `${Math.round(Math.max(10, Math.min(90, spreadPx)))}px`;
    if (size !== this.lastCrosshairSpread) {
      this.lastCrosshairSpread = size;
      this.crosshair.style.setProperty("--sp", size);
    }
  }

  /**
   * The hit confirmation, in four flavours: a body hit, a headshot, a kill,
   * and a kill that was a headshot.
   *
   * The two axes COMPOSE rather than fight, which is the one thing about this
   * that changed. They used to argue over the same four ticks and a headshot
   * lost outright to a kill, on the reasoning that "stop shooting" is the more
   * urgent of the two things to say and the ding is where the headshot read
   * actually lands. The urgency ordering is right and is kept — a kill still
   * decides the COLOUR and still brings the ring with it — but the ticks now
   * carry length as a second, independent axis, so a headshot that killed is
   * the kill marker drawn long instead of the headshot being thrown away. Two
   * statements, two properties, no arbitration. `hud.css` holds the four
   * numbers each flavour moves.
   *
   * **A standing marker may only be upgraded, never downgraded** (`HIT_RANK`).
   * Two rounds inside one marker's life is the common case rather than the
   * exceptional one — an automatic weapon fires faster than the marker lives,
   * and one blast raises this once per body it caught, in pool order — and
   * letting the last arrival win is what put an ordinary white marker over the
   * kill a few milliseconds after it appeared. The lesser round is not
   * swallowed: it restarts the pop, so it is still confirmed as a separate
   * round; it simply cannot take the louder statement away.
   */
  flashHitmarker(killed = false, headshot = false): void {
    const rank = killed
      ? headshot
        ? HIT_RANK.headKill
        : HIT_RANK.kill
      : headshot
        ? HIT_RANK.head
        : HIT_RANK.hit;
    // The clock and not the rank decides whether there is a marker to
    // upgrade. `update` does clear the rank as it takes the marker down, so
    // the two agree — but only while the HUD is being ticked, and it is not
    // ticked under a lid (`docs/states.md`). A round that lands the frame
    // after a pause is lifted must not be arbitrated against a flavour that
    // stopped being on screen before the pause.
    if (this.hitT <= 0 || rank >= this.hitRank) {
      this.hitRank = rank;
      this.hitmarker.classList.toggle("kill", killed);
      this.hitmarker.classList.toggle("head", headshot);
      // The ring is written by its own clock and by nothing else, so a kill
      // followed by a plain hit would otherwise leave the last frame of the
      // old ring standing on the new marker.
      if (!killed) {
        this.hitRingT = 0;
        this.hitRing.style.opacity = "0";
      }
    }
    // Thrown by the kill itself, and only ever by a kill — including a second
    // kill inside the first's life, which is a fresh statement about a fresh
    // body and deserves a fresh ring.
    if (killed) {
      this.hitRingLife = HIT_LIFE[rank];
      this.hitRingT = this.hitRingLife;
    }
    // Whatever it says, this round says it again: the pop is the confirmation
    // that a SECOND bullet landed, and it is restarted even when the flavour
    // did not change.
    this.hitPop = HIT_POP;
    // The longer of the two, so an upgrade extends the marker and a lesser
    // round can neither cut a kill short nor stretch a body hit out.
    this.hitLife = Math.max(this.hitT, HIT_LIFE[this.hitRank]);
    this.hitT = this.hitLife;
    this.hitmarker.classList.remove("hidden");
  }

  /**
   * Takes the marker down and forgets what it said.
   *
   * The three callers are the three ways the chrome stops being true —
   * a pause, the death cam and the editor — and each of them already hides
   * this element in `hud.css`. Hiding it is not enough on its own: the HUD is
   * ticked with `dt = 0` under a pause (`docs/states.md`), so the marker's
   * clock does not run while it is out of sight and what was left of it is
   * still there when the lid comes off. At 120 ms nobody could have seen the
   * difference; a kill marker lives long enough now that they would.
   */
  private dropHitmarker(): void {
    this.hitT = 0;
    this.hitPop = 0;
    this.hitRank = 0;
    this.hitRingT = 0;
    this.hitRing.style.opacity = "0";
    this.hitmarker.classList.add("hidden");
  }

  flashDamage(): void {
    this.vignetteT = 0.5;
    this.vignette.style.opacity = "0.55";
  }

  showMessage(text: string, seconds = 2.4): void {
    this.message.textContent = text;
    this.message.classList.remove("hidden");
    this.messageT = seconds;
  }

  toast(text: string): void {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.classList.add("fade"), 1800);
    setTimeout(() => el.remove(), 2600);
  }

  /**
   * One kill line. `mine` tints entries the player was involved in, so your own
   * kills and deaths stand out from the background chatter of a 16-bot fight.
   */
  addKill(killer: string, victim: string, mine: boolean): void {
    const el = document.createElement("div");
    el.className = `kill${mine ? " mine" : ""}`;
    el.innerHTML =
      `<span class="k">${killer}</span>` +
      `<span class="x">&#9587;</span>` +
      `<span class="v">${victim}</span>`;
    this.killfeed.appendChild(el);
    // Cap the feed: a full battle would otherwise fill the screen edge to edge.
    while (this.killfeed.childElementCount > 6) {
      this.killfeed.firstElementChild!.remove();
    }
    setTimeout(() => el.classList.add("fade"), 4000);
    setTimeout(() => el.remove(), 4800);
  }

  /**
   * One line on the score feed: what you were just paid, and for what.
   *
   * **The feed is the only place a player sees the scoring system work.** The
   * board is behind Tab and the number on it is a total; this is what says
   * that the flag you just stood on was worth two and a half kills, which is
   * the thing that changes how the next five minutes are played. Every award
   * gets a line, so a headshot on an attacker in your own zone is three of
   * them stacked — which is Battlefield's read exactly: one kill, itemised.
   *
   * `LABELS` is a total map over `ScoreKind`, so a new award in
   * `config/score.ts` does not compile until this file has decided what to
   * call it on screen. That is the only thing the interface owes the table.
   *
   * Presentation only, and transient like the killfeed next door: the numbers
   * that survive are the book's, and this is a receipt.
   */
  addScore(kind: ScoreKind, points: number): void {
    const el = document.createElement("div");
    el.className = "score-line";
    const n = document.createElement("b");
    n.textContent = `+${points}`;
    const what = document.createElement("span");
    what.textContent = LABELS[kind];
    el.append(n, what);
    this.scorefeed.appendChild(el);
    // Capped like the killfeed, and lower: a capture pays five people at once
    // and a good exchange stacks three lines on its own, so the cap is what
    // keeps a busy second from becoming a column up the side of the screen.
    while (this.scorefeed.childElementCount > 5) {
      this.scorefeed.firstElementChild!.remove();
    }
    setTimeout(() => el.classList.add("fade"), 1500);
    setTimeout(() => el.remove(), 2100);
  }

  setScoreboard(
    visible: boolean,
    rows?: {
      /** What is being played on — passed in, never named here. */
      map: string;
      teams: readonly string[];
      tickets: readonly number[];
      flags: readonly number[];
      kills: readonly number[];
      deaths: readonly number[];
      /** Team totals, summed from the rows by the caller like the two above. */
      score: readonly number[];
      playerTeam: number;
      /**
       * Whether the board has a ping column at all — true in a match, false
       * offline, where there is no server to be any distance from.
       *
       * Stated by the caller rather than derived from the rows, and that is the
       * difference between a column and a flicker: the authority's first table
       * arrives a second into the round, so a board that grew its column when
       * the first number turned up would reflow every name on it under a player
       * already reading them. Told outright, the column is there from the first
       * frame with an em dash in it, and the dashes fill in.
       */
      pings: boolean;
      /**
       * One line per body in the round, in roster order. Summed for the team
       * totals above by the caller, and split into two columns here.
       */
      rows: readonly ScoreRow[];
    },
  ): void {
    if (visible !== this.lastScoreboardVisible) {
      this.lastScoreboardVisible = visible;
      this.scoreboard.classList.toggle("hidden", !visible);
      // Force the rebuild below on the frame it comes up, whatever the numbers
      // were when it was last down.
      this.lastScoreboardKey = "";
    }
    if (!visible || !rows) return;
    // THE ONE MARKUP REBUILD LEFT IN THE FILE, AND IT IS KEYED.
    //
    // Tab is a HELD key, so `Game.updateHud` calls this on every frame the
    // board is up — and this method used to answer by assigning a twenty-element
    // template literal to `innerHTML`, tearing down and reparsing the whole
    // panel sixty times a second for as long as a player looked at it. The
    // file header has always said this call "fires on a state change instead";
    // the key is what makes that true rather than aspirational.
    //
    // Everything the markup interpolates is in the key, so a ticket ticking
    // down or a kill landing still redraws on the frame it happens. The rows
    // are in it whole: a kill anywhere on the roster moves one of their numbers
    // and reorders the column it is in, and a board that redraws only when the
    // TOTALS move would sit there showing the wrong order for the rest of the
    // round every time two people traded.
    //
    // The pings are in it too, which is a rebuild about once a second for as
    // long as Tab is held — the cadence the authority measures them on, and the
    // same cost as a kill landing. A column left out of the key would be a
    // column frozen at whatever it read when somebody last died.
    const key =
      `${rows.map}|${rows.playerTeam}|${rows.teams}|${rows.tickets}|` +
      `${rows.flags}|${rows.kills}|${rows.deaths}|${rows.score}|${rows.pings}|` +
      rows.rows
        .map(
          (r) =>
            `${r.name}:${r.team}:${r.score}:${r.kills}:${r.deaths}:${r.ping}`,
        )
        .join(",");
    if (key === this.lastScoreboardKey) return;
    this.lastScoreboardKey = key;
    const max = CONFIG.conquest.tickets;
    const row = (t: number) => {
      const frac = Math.max(0, Math.min(1, rows.tickets[t] / max));
      return `
      <div class="sb-row ${t === rows.playerTeam ? "mine" : "theirs"}">
        <span class="sb-name">${rows.teams[t].toUpperCase()}</span>
        <span class="sb-tickets">
          <b>${rows.tickets[t]}</b>
          <i class="sb-gauge"><u style="width:${(frac * 100).toFixed(1)}%"></u></i>
        </span>
        <span class="sb-n">${rows.flags[t]}</span>
        <span class="sb-n sb-score">${rows.score[t]}</span>
        <span class="sb-n">${rows.kills[t]}</span>
        <span class="sb-n">${rows.deaths[t]}</span>
      </div>`;
    };
    // The frame, which interpolates nothing a player typed: the map's own name,
    // the two team names out of CONFIG, and numbers. The per-body rows are
    // built as ELEMENTS below rather than joined into this string, because one
    // of their fields is a name somebody else chose — see `ScoreRow.name`.
    this.scoreboard.innerHTML = `
      <div class="sb-head">
        <span class="sb-mode">CONQUEST</span>
        <span class="sb-map">${rows.map.toUpperCase()}</span>
      </div>
      <div class="sb-cols">
        <span></span><span>REINFORCEMENTS</span><span>FLAGS</span>
        <span>SCORE</span><span>KILLS</span><span>LOSSES</span>
      </div>
      ${row(rows.playerTeam)}${row(1 - rows.playerTeam)}
      <div class="sb-teams">
        <div class="sb-col" data-side="mine"></div>
        <div class="sb-col" data-side="theirs"></div>
      </div>
    `;
    // The column's width lives in CSS, so whether there IS one is a class on
    // the panel rather than a template branch per row. Set after the rebuild
    // because the rebuild does not touch the root's own classes, and read by
    // every `.sb-prow` inside it.
    this.scoreboard.classList.toggle("pinged", rows.pings);
    const columns = this.scoreboard.querySelectorAll<HTMLElement>(".sb-col");
    // Your side on the left, always — the board is read from where you are
    // standing, and a column that swaps ends with the team you were seated
    // onto is one a player has to find before they can read it.
    const sides = [rows.playerTeam, 1 - rows.playerTeam];
    for (let i = 0; i < sides.length; i++) {
      const team = sides[i];
      const column = columns[i];
      const mine = team === rows.playerTeam;
      column.classList.add(mine ? "mine" : "theirs");
      column.appendChild(
        this.scoreHeading(rows.teams[team].toUpperCase(), rows.pings),
      );
      // Sorted by SCORE, then by kills, then by the fewer deaths. Score first
      // because it is what the board is now for: the player who has been
      // taking flags outranks the one who has been shooting people away from
      // them, which is the whole reason there is a column beside the kills.
      // `sort` is stable, so bodies level on all three keep roster order and a
      // row does not jitter between two places while a player is looking at it.
      const side = rows.rows
        .filter((r) => r.team === team)
        .sort(
          (a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths,
        );
      for (const r of side) column.appendChild(this.scoreRow(r, rows.pings));
    }
  }

  /** The column header over one team's rows. */
  private scoreHeading(team: string, pings: boolean): HTMLElement {
    const el = document.createElement("div");
    el.className = "sb-prow sb-phead";
    const name = document.createElement("span");
    name.className = "sb-pname";
    name.textContent = team;
    const s = document.createElement("span");
    s.textContent = "PTS";
    const k = document.createElement("span");
    k.textContent = "K";
    const d = document.createElement("span");
    d.textContent = "D";
    el.append(name, s, k, d);
    if (pings) {
      const ms = document.createElement("span");
      ms.textContent = "MS";
      el.append(ms);
    }
    return el;
  }

  /**
   * One body's row.
   *
   * Built rather than interpolated, and that is a rule and not a preference:
   * `name` is a string another player typed on a machine this one has never
   * met, so it reaches the document through `textContent` — the same way every
   * other screen in the game writes one. The server bounds its length; nothing
   * bounds its contents.
   */
  private scoreRow(r: ScoreRow, pings: boolean): HTMLElement {
    const el = document.createElement("div");
    el.className = r.you ? "sb-prow sb-pyou" : "sb-prow";
    const name = document.createElement("span");
    name.className = "sb-pname";
    name.textContent = r.name;
    const score = document.createElement("span");
    score.className = "sb-ps";
    score.textContent = String(r.score);
    const kills = document.createElement("span");
    kills.textContent = String(r.kills);
    const deaths = document.createElement("span");
    deaths.className = "sb-pd";
    deaths.textContent = String(r.deaths);
    el.append(name, score, kills, deaths);
    // The connection behind the row, in the band that says how bad it is. A
    // bot's is an em dash rather than a zero — it has no connection at all, and
    // a zero would read as the best one on the board. Both the number and the
    // band come from `ui/ping.ts`, which the lobby's reading also goes through.
    if (pings) {
      const ping = document.createElement("span");
      ping.className = `sb-ping ${pingQuality(r.ping)}`;
      ping.textContent = pingText(r.ping);
      el.append(ping);
    }
    return el;
  }

  /**
   * Hides the gameplay chrome (tickets, flags, crosshair, health, ammo) while
   * the map editor is open. One class on the root rather than a toggle per
   * element — `update()` keeps writing to those nodes regardless, and CSS
   * hiding survives that where a per-element flag would be overwritten.
   */
  setEditing(on: boolean): void {
    this.root.classList.toggle("editing", on);
    if (on) this.dropHitmarker();
  }

  /**
   * The kit caption over the magazine strip. Pushed when the loadout changes
   * rather than every frame — it is one of the few strings on the HUD that
   * only moves when the player moves it.
   */
  setKit(label: string): void {
    this.weaponLabel.textContent = label.toUpperCase();
  }

  /**
   * What the OTHER slot is holding — the one thing about the kit the rest of
   * the chrome cannot say. The viewmodel shows one weapon and the ammunition
   * readout counts one magazine, so a player who never pressed the swap key
   * had nothing on screen telling them there was a second weapon to press it
   * for; a sidearm nobody knows about is a sidearm nobody draws when the rifle
   * runs dry, which is the entire reason it is carried.
   *
   * It sits at the far LEFT of the ammunition line, in the space the big
   * number was already leaving empty, so it costs the corner no height and no
   * width at all — the two slots read as one line with the carried magazine
   * shouting at the right end of it and the slung one murmuring at the other.
   * It is that line's poor relation on purpose: a key chip, a short name and a
   * plain count against a 46 px number. What is in your hands has to win the
   * corner; this only has to be findable when you go looking.
   *
   * The KEY CHIP is the exception to the dimming and the one thing here that
   * is drawn to be read first — it is the instruction, and a hint you have to
   * squint at is a hint nobody follows.
   *
   * Pushed when the hands change rather than every frame, like `setKit`: the
   * slot number and the name only move when a swap completes.
   */
  setStowedKit(name: string, key: number): void {
    this.stowedParts.key.textContent = String(key);
    this.stowedParts.name.textContent = name.toUpperCase();
  }

  /**
   * The slung magazine, pushed every frame like the carried one — it is not
   * static: a weapon put away half-empty comes back half-empty, so the count
   * here is what you would be swapping TO rather than what the weapon holds
   * when full. Each write is skipped when the string has not moved, since at
   * a steady count that is every frame but the ones just after a swap.
   *
   * The two states it raises its voice for are opposites and cannot both be
   * true. `dry` is the slung magazine being empty as well — a swap will not
   * save you, so the row says so in the colour the HUD keeps for bad news.
   * `ready` is the mirror: there is nothing to fire in your hands and there is
   * here, which is the one moment in a round when the second slot is the whole
   * answer. It is a HANDOVER rather than an alarm — the carried readout is
   * already dimming itself through a reload (`#hud-right.reloading .ammo`), so
   * this coming up as that goes down reads as the corner pointing at the
   * faster option, and needs no animation to do it.
   *
   * `handsDry` is what `setAmmo` recorded, which `Game.updateHud` pushes on
   * the same frame immediately before this — the ordering is the contract, and
   * the only other caller (`applyCarry`, outside a round) has no hands to be
   * dry.
   */
  setStowedAmmo(ammo: number, magSize: number): void {
    const text = String(ammo);
    if (text !== this.stowedAmmoText) {
      this.stowedAmmoText = text;
      this.stowedParts.ammo.textContent = text;
    }
    const cap = `/${magSize}`;
    if (cap !== this.stowedCapText) {
      this.stowedCapText = cap;
      this.stowedParts.cap.textContent = cap;
    }
    const dry = ammo <= 0;
    if (dry !== this.lastStowedDry) {
      this.lastStowedDry = dry;
      this.stowed.classList.toggle("dry", dry);
    }
    const ready = ammo > 0 && this.handsDry;
    if (ready !== this.lastStowedReady) {
      this.lastStowedReady = ready;
      this.stowed.classList.toggle("ready", ready);
    }
  }

  setLockHint(visible: boolean): void {
    if (visible === this.lastLockHint) return;
    this.lastLockHint = visible;
    this.lockHint.classList.toggle("hidden", !visible);
  }

  /**
   * What the player is standing next to that they could act on, or null.
   *
   * A prompt rather than a hint: it names the KEY as well as the thing, because
   * this is the only verb in the game that is not on the mouse or on a stance
   * key, and a player who has never been told about it will not find it.
   */
  setUsePrompt(key: string | null, text = ""): void {
    const show = key !== null;
    if (show !== this.lastUsePrompt || (show && text !== this.lastUseText)) {
      this.lastUsePrompt = show;
      this.lastUseText = text;
      if (show) {
        this.usePromptParts.key.textContent = key!;
        this.usePromptParts.text.textContent = text;
      }
      this.usePrompt.classList.toggle("hidden", !show);
    }
  }

  /**
   * The driver's readout, or null when the player is on foot.
   *
   * Passing null does not merely blank it: `.mounted` comes off `#hud`, which
   * is what puts the magazine, the frag pips and the crosshair back. The two
   * halves of the bottom-right band are never up together, because a tank has
   * no magazine and the rifle in the player's hands is not what is firing.
   */
  setVehicle(status: VehicleStatus | null): void {
    const on = status !== null;
    if (on !== this.lastMounted) {
      this.lastMounted = on;
      this.root.classList.toggle("mounted", on);
      this.vehicle.classList.toggle("hidden", !on);
      this.hudKit.classList.toggle("hidden", on);
    }
    if (!status) return;
    const hp = Math.max(0, Math.round(status.health));
    const hpText = String(hp);
    if (hpText !== this.lastHullText) {
      this.lastHullText = hpText;
      this.vehicleParts.hp.textContent = hpText;
    }
    const frac = status.maxHealth > 0 ? hp / status.maxHealth : 0;
    // Quantised to whole percent before the guard, so a hull losing a fifth of
    // a point a frame under sustained rifle fire does not repaint the bar
    // sixty times a second for a width nobody can see change.
    const width = `${Math.round(frac * 100)}%`;
    if (width !== this.lastHullWidth) {
      this.lastHullWidth = width;
      this.vehicleParts.hull.style.width = width;
      this.vehicle.classList.toggle("hurt", frac <= 0.3);
    }
    const loaded = status.load >= 1;
    const loadWidth = `${Math.round(Math.min(1, status.load) * 100)}%`;
    if (loadWidth !== this.lastLoadWidth) {
      this.lastLoadWidth = loadWidth;
      this.vehicleParts.load.style.width = loadWidth;
    }
    if (loaded !== this.lastLoaded) {
      this.lastLoaded = loaded;
      this.vehicleParts.gun.textContent = loaded ? "LOADED" : "LOADING";
      this.vehicle.classList.toggle("loading", !loaded);
    }
  }

  /**
   * Where the tank's gun is pointing, as a fraction of the viewport, or null
   * when it is behind the camera or there is no gun.
   *
   * **This is the marker, and the crosshair is deliberately not.** In a
   * third-person view the eye and the muzzle are twelve metres apart and the
   * turret traverses at its own rate, so the middle of the screen is where the
   * driver is ASKING to shoot and this is where the shell will actually go. The
   * project's rule is that the reticle may not lie (`docs/weapons.md`); with a
   * turret in the way the only way to keep that is to draw the gun rather than
   * the request.
   *
   * `left`/`top` percentages rather than a transform, because the element is
   * already centred on its own point by a static transform and stacking a
   * second one would mean rebuilding the whole string every frame.
   */
  setGunMarker(x: number | null, y = 0): void {
    const show = x !== null;
    if (!show) {
      if (this.lastMarker !== "") {
        this.lastMarker = "";
        this.gunMarker.classList.add("hidden");
      }
      return;
    }
    // A tenth of a percent is well under a pixel at any viewport this runs on,
    // and it is what keeps a gun tracking a still target from repainting.
    const key = `${(x! * 100).toFixed(1)},${(y * 100).toFixed(1)}`;
    if (key === this.lastMarker) return;
    if (this.lastMarker === "") this.gunMarker.classList.remove("hidden");
    this.lastMarker = key;
    this.gunMarker.style.left = `${(x! * 100).toFixed(2)}%`;
    this.gunMarker.style.top = `${(y * 100).toFixed(2)}%`;
  }

  /**
   * Takes away the chrome that would be lying while the game is held: the
   * crosshair (nothing to shoot), the hitmarker and damage arcs (frozen
   * mid-decay), and the lock hint (the pause is why the mouse is free).
   *
   * The pause CARD itself is OverlayScreen's. This is only the HUD's own
   * chrome getting out of its way, which is why the two are separate calls and
   * why `.paused` is not `.overlaid`: under a pause the tickets, the flags and
   * your vitals are this round's and frozen with the scene, so they stay.
   */
  setPaused(on: boolean): void {
    this.root.classList.toggle("paused", on);
    if (on) this.dropHitmarker();
  }

  /**
   * The death cam is up: the player is down and the camera has left their head.
   *
   * It hides the same four things a pause does and is deliberately NOT the same
   * class, because the two agree by coincidence rather than by meaning. A pause
   * hides them because the world is frozen; this hides them because the world
   * is still moving and the player is no longer in it — a crosshair over a
   * camera nobody is aiming, a capture panel for a zone nobody is standing in,
   * and damage arcs bearing on a view yaw that has stopped being the player's.
   * The gauges stay for the opposite reason to a pause's: not because they are
   * frozen and true, but because they are LIVE and true, and watching the
   * tickets while you wait is half of why the cam is worth showing.
   */
  setDeathCam(on: boolean): void {
    this.root.classList.toggle("dying", on);
    if (on) this.dropHitmarker();
  }

  /**
   * The on-screen controls are up, so the chrome gets out of their way.
   *
   * It hides nothing — every gauge here is exactly as true on a phone — it
   * SHRINKS the two that sit where the thumbs go: the bottom band (about its
   * bottom centre, which pulls both ends inward as it goes) and the minimap.
   * The rules are in `hud.css` and `minimap.css` beside the markup they move,
   * and the ladder they share is `--hud-touch` in `base.css`.
   *
   * This is a fix the gauges had coming anyway. They are authored in pixels for
   * a 720p window — a 224 px health bar, 46 px ammo numerals, a 220 px minimap
   * — and a landscape phone is ~390 px tall, so the corners were already
   * carrying about twice the chrome they should. The controls are simply what
   * made it impossible to ignore: a trigger drawn over the magazine strip is a
   * trigger that reads as part of it.
   */
  setTouching(on: boolean): void {
    if (on === this.lastTouching) return;
    this.lastTouching = on;
    this.root.classList.toggle("touching", on);
  }
}
