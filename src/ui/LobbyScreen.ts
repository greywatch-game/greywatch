/**
 * LobbyScreen.ts — The match browser: a title screen for the MATCH the cursor
 * is on, laid out the way the main menu, the kit screen and the settings screen
 * are.
 * Owns `#lobby`, its page and row cursor, the rendering of one `LobbyResult` per
 * region, and the `#hud.lobbying` flag that takes the menu off the glass while
 * it is up. Owns no networking — it never fetches and never connects. `Game`
 * hands it a region list and each region's answer as it lands, and takes
 * `onJoin`/`onCreate`/`onPickRegion`/`onPickMap`/`onPickBots`/`onRefresh`/
 * `onClose` back, the same render-what-you-are-given shape `SettingsScreen`
 * follows. It is also handed the menu's `MenuBackdrop` and puts its own map
 * up on it.
 * Invariants: the rows are DERIVED from the results (`joinRows`), never
 * authored as markup, because the match rows are as many as the servers say and
 * the keyboard navigation has to know about every one of them. Every string that
 * came off a network — a map id, a server's error, a region's name out of the
 * deploy-time file — reaches the DOM through `textContent`, never through the
 * template; see `Fill`. Built on a raise and PATCHED after: nothing already on
 * screen is rewritten unless what it says has changed.
 *
 * **IT IS A FRONT END, NOT A FORM.** It read as one: a heading, five columns of
 * small caps floating in the middle of a black page, and three rows of chips
 * under them — eight map names in a strip that ran off its own edge. Now the
 * MATCH is the title: the map it is running is set large over that map's own
 * photograph (the menu's `MenuBackdrop`, `#menu-shot`), with the
 * seats, the ping and the state under it. The matches are a column of plates,
 * each carrying a slice of its map's picture; an INTEL plate on the right says
 * what joining that one means and draws its plan; Refresh and Back are the
 * system corner; the prompts are drawn on their controls for the device in hand
 * (`prompts.ts`).
 *
 * **Two pages, the settings screen's grammar**: JOIN (what the servers are
 * running) and NEW MATCH (the three things a match this client creates is built
 * with, and the button that spends them). The tab strip is row 0 of the cursor's
 * list, so a pad reaches both pages through the list alone, and the bumpers turn
 * the page from anywhere. They were one list, and the list was two different
 * kinds of thing — rows to JOIN and rows to CONFIGURE — whose only relation was
 * that one followed the other; a page each is also what a landscape phone has
 * the height for.
 *
 * **A match row is a region AND an id, never an id.** Match ids are minted per
 * process (`m1`, `m2`, …), so two regions are always running matches with the
 * same names — an id alone would let the cursor's identity check confuse two
 * different rounds on two different continents, and would send a join to
 * whichever server the game happened to be pointed at. Every row carries its
 * region, `onJoin` passes it on, and `sameRow` compares it.
 *
 * **The three picker rows are what a NEW match would be built with, and none of
 * them says anything about the rows on the other page.** Region, map, and
 * whether it fields bots: a match is joined where it is running, played on the
 * map it is running, and fought with the bodies it was built with, whatever
 * these rows say. What a listed match runs is on the row itself —
 * `MatchSummary.bots` through `stateLabel`, which is the only way a player can
 * tell a botless round from a quiet one, since `3 / 16` looks identical either
 * way.
 *
 * **The region rows exist only when there is more than one region.** A
 * single-server deployment — which is what an untouched `public/regions.json`
 * is — gets no region column on a plate, no region picker, and no line about a
 * region that is still being asked, because there is no choice to show.
 */
import "./lobby.css";
import { CONFIG } from "../config";
import type { MatchSummary } from "../net/protocol";
import type { LobbyResult } from "../net/lobby";
import type { Region } from "../net/regions";
import { perTeamOf } from "../world/layout";
import { MAPS, type MapDef } from "../world/maps";
import { shotThumbUrl } from "./mapShots";
import type { MenuBackdrop } from "./MenuBackdrop";
import { paintMapThumb } from "./MapThumb";
import { pingQuality, pingText } from "./ping";
import { glyph, guessDevice, markDevice, type InputDevice } from "./prompts";

/**
 * One line on the JOIN page, in screen order. There is deliberately no `back`
 * and no `refresh` row: leaving and asking again are not things this list is
 * FOR, and a control under a list whose length is whatever the servers happen
 * to be running is one whose position nothing can predict. Both are buttons in
 * the system corner, with a key each.
 */
type JoinRow =
  | { kind: "match"; region: Region; match: MatchSummary }
  /**
   * What a region has to say when it has no matches to put in the list: it is
   * still being asked, it answered with nothing, or it did not answer at all.
   *
   * A row rather than a line above the list, because with two regions there are
   * two answers and the list is the only place they can each be attributed. It
   * takes the cursor and refuses the confirm — the same shape a full match row
   * has, and the reason is the same one: a row that cannot be entered is still
   * worth reading.
   */
  | { kind: "note"; region: Region; text: string; ping: number };

/**
 * One line on the NEW MATCH page. The pickers read down as the sentence the
 * button under them spends — WHERE, then WHAT, then WHO — and `create` is last
 * for the reason the menu puts Deploy under the map: the parameters, then the
 * button that spends them.
 */
type NewRow = { kind: "region" } | { kind: "map" } | { kind: "bots" } | { kind: "create" };

type LobbyRow = JoinRow | NewRow;

/** What the screen is doing, which decides what the confirm may do. */
type LobbyPhase =
  | { phase: "browsing" }
  /** A join is in flight. The list stays up so the chosen row is still read. */
  | { phase: "joining"; regionId: string; matchId: string };

/** The two pages, in tab order. */
const JOIN = 0;
const NEW = 1;

/**
 * Line icons in the menu's own drawing: a 24-unit box, a square-capped stroke,
 * no fill. On a phone held upright the tabs are too narrow for a name, and the
 * icon is what is left.
 */
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter">${d}</svg>`;
const ICONS = {
  join: svg(`<path d="M3 5h18v5H3zM3 14h18v5H3z"/><path d="M6.5 7.5h.1M6.5 16.5h.1M11 7.5h6M11 16.5h6"/>`),
  create: svg(`<path d="M12 4v16M4 12h16"/><path d="M3 3h5M3 3v5M21 21h-5M21 21v-5"/>`),
  refresh: svg(`<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v4.2h-4.2"/>`),
  back: svg(`<path d="M15 5l-7 7 7 7"/>`),
};

const PAGES = [
  {
    label: "Join",
    icon: ICONS.join,
    blurb:
      "Every match the servers are running. Joining takes a bot's seat in a round already under way; a full match stays listed so you can see it is there.",
  },
  {
    label: "New match",
    icon: ICONS.create,
    blurb:
      "A fresh round on a server of your choosing. The map, the region and whether bots fill the empty seats are yours; anybody who joins plays on them.",
  },
] as const;

/** The bots picker's two options, as the stepper and the intel name them. */
const BOTS_OPTIONS = [
  {
    value: true,
    label: "With bots",
    note: "Bots fill every open seat",
    blurb:
      "Every seat nobody is sitting in is a bot, so the round is a full fight from the first minute and a player who joins takes one of their places.",
  },
  {
    value: false,
    label: "Players only",
    note: "Only people fight",
    blurb:
      "No bots at all: the only bodies in the round are the people in it. Quiet until somebody else joins, and listed as such so nobody mistakes it for a busy one.",
  },
] as const;

/**
 * Are these the same row, across a rebuild?
 *
 * An action row is identified by its kind, a match row by its region and id,
 * and a note by its region — never by anything that CHANGES, which is why the
 * player count, the state and a note's text are not compared. A row whose count
 * went from 3 to 4 is the same row, and a cursor that let go of it every time
 * somebody joined would be unusable on a busy server; a region whose "asking…"
 * became "no matches running" is likewise still that region's line.
 */
function sameRow(a: LobbyRow, b: LobbyRow): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "match" && b.kind === "match") {
    return a.match.id === b.match.id && a.region.id === b.region.id;
  }
  if (a.kind === "note" && b.kind === "note") return a.region.id === b.region.id;
  return true;
}

/** A row's identity as a string, for the list's "did the SET change" test. */
function rowKey(row: LobbyRow): string {
  if (row.kind === "match") return `m:${row.region.id}:${row.match.id}`;
  if (row.kind === "note") return `n:${row.region.id}`;
  return row.kind;
}

/**
 * A map's display name from its id.
 *
 * The server sends an id because that is what it is authoritative about; the
 * name is presentation and lives in the client's own table. An id this build has
 * never heard of falls through VERBATIM rather than being hidden — a server one
 * version ahead is exactly when a player most needs to see what is running — and
 * that fallback is why every name is assigned rather than interpolated.
 */
function mapById(id: string): MapDef | undefined {
  return MAPS.find((m) => m.id === id);
}
function mapName(id: string): string {
  return mapById(id)?.name ?? id;
}

/**
 * What a row says about a match, past the player count.
 *
 * `empty` is deliberately not shown as "empty": every match fields its bots
 * whatever the roster says, so joining one is not joining an abandoned server —
 * it is taking a bot's place in a fight already happening. "Bots only" is what
 * is actually true, and it is an invitation rather than a warning.
 */
function stateLabel(match: MatchSummary): string {
  // **A match with no bots in it inverts the paragraph above**, which is why
  // this is read first rather than appended as a decoration. "Bots only" of an
  // empty botless match would be the one flatly false thing on this screen —
  // there is nothing in it at all — and every other label needs the words too,
  // because a row that says `2 / 16 · In progress` describes two very different
  // rounds depending on whether thirty bodies are missing from it.
  const botless = match.bots === false;
  const state =
    match.state === "rotating"
      ? "Changing map"
      : match.state === "empty"
        ? botless
          ? "Empty"
          : "Bots only"
        : match.humans >= match.slots
          ? "Full"
          : "In progress";
  return botless ? `${state} · no bots` : state;
}

/** What joining a match MEANS, in a sentence — the intel's paragraph. */
function matchBlurb(match: MatchSummary): string {
  const botless = match.bots === false;
  if (match.humans >= match.slots) {
    return "Every seat is taken by a person. It stays listed so you know the round is there; ask again once somebody has left.";
  }
  if (match.state === "rotating") {
    return "The last round is over and the next map is being built. Joining puts you into it as it starts.";
  }
  if (match.state === "empty") {
    return botless
      ? "Nobody is in it and it fields no bots, so it is exactly as empty as it looks until somebody else joins."
      : "Nobody is in it yet and the bots are holding every seat. Join, and you take one of their places.";
  }
  return botless
    ? "A round with no bots in it: every body on the field is a person, and the empty seats are empty."
    : "A round is under way. Joining takes a bot's seat, so the fight you walk into is already full.";
}

/** A 1-based index as two digits: the title's numeral and its counter. */
const twoDigits = (n: number) => String(n).padStart(2, "0");

/**
 * Markup with holes in it for strings that are not this build's own.
 *
 * `t(value)` writes an empty span where the value goes and remembers it; `into`
 * puts the markup in and then fills every hole through `textContent`. That is
 * the whole of the defence against a map id or a server's error text that
 * arrived off a network — the same rule `HUD` states at the top of its own file
 * — made cheap enough that nothing is tempted to interpolate one.
 */
class Fill {
  private values: string[] = [];
  t(value: string, cls = ""): string {
    this.values.push(value);
    return `<span${cls ? ` class="${cls}"` : ""} data-fill="${this.values.length - 1}"></span>`;
  }
  /** The values, as one string — half of "has this block changed at all". */
  sig(): string {
    return JSON.stringify(this.values);
  }
  into(el: HTMLElement, html: string): void {
    el.innerHTML = html;
    el.querySelectorAll<HTMLElement>("[data-fill]").forEach((slot) => {
      slot.textContent = this.values[Number(slot.dataset.fill)] ?? "";
      slot.removeAttribute("data-fill");
    });
  }
}

/** What the hero is ABOUT: the match, a region's line, the list's state, or a new match. */
type Focus =
  | { kind: "match"; row: Extract<JoinRow, { kind: "match" }>; n: number; of: number }
  | { kind: "note"; row: Extract<JoinRow, { kind: "note" }> }
  | { kind: "status" }
  | { kind: "new" };

/** What `draw` last put on screen, so it can patch rather than rewrite. */
interface Shown {
  page: number;
  /** Every row's identity on the page, in order — the list's SHAPE. */
  keys: string;
  heroKey: string;
  intelKey: string;
  backdrop: string;
}

export class LobbyScreen {
  private root: HTMLElement;
  private heroEl: HTMLElement;
  private tabsRow: HTMLElement;
  private tabs: HTMLElement[];
  private countEl: HTMLElement;
  private prevEl: HTMLElement;
  private nextEl: HTMLElement;
  private listEl: HTMLElement;
  private sayEl: HTMLElement;
  private intelEl: HTMLElement;
  private device: InputDevice = guessDevice();
  /** Which page is shown: `JOIN` or `NEW`. */
  private page = JOIN;
  /** Where the cursor is: 0 is the tab strip, 1.. are the page's rows. */
  private row = 0;
  private state: LobbyPhase = { phase: "browsing" };
  private shown: Shown | null = null;

  /**
   * The regions to ask, in file order, and which one a new match goes in.
   *
   * Empty until `Game` has read the deploy-time list, which is the screen's
   * loading state: there is a moment, once, where the client does not yet know
   * what servers exist.
   */
  private regions: Region[] = [];
  /** Index into `regions`. `Game` owns the value; this is its copy to draw. */
  private regionChoice = 0;
  /**
   * Each region's answer, by id. A region with no entry has not answered yet —
   * which is a THIRD state, distinct from "answered with nothing" and from
   * "could not be reached", and the only one of the three that is temporary.
   */
  private results = new Map<string, LobbyResult>();
  /** The map row's selection. Index into `MAPS`; `Game` owns the value. */
  private mapChoice = 0;
  /**
   * The bots row's selection: whether a new match would field them. True until
   * `Game` says otherwise, which is what an untouched client wants.
   */
  private botsChoice = true;

  /**
   * Wired by Game: join this specific match, in this region, running this map.
   *
   * All three travel together rather than being looked up later, because this
   * row is where they are known together — the client has to open the socket to
   * the server that listed the match and build that match's world rather than
   * its own, and a join carrying only an id would be guessing at both until the
   * welcome arrived.
   */
  onJoin: (regionId: string, matchId: string, mapId: string) => void = () => {};
  /** Wired by Game: start a new match in the chosen region, on the chosen map. */
  onCreate: () => void = () => {};
  /**
   * Wired by Game: the region row moved, to this index into the region list.
   *
   * An index and not the choice itself, exactly like `onPickMap`: `Game` owns
   * the pick (it is the one that gets remembered, and the one every join
   * spends), so this screen asks for it to move and is told what it became
   * through `setRegionChoice`. It never writes its own state — the rule every
   * list-shaped screen here keeps.
   */
  onPickRegion: (index: number) => void = () => {};
  /** Wired by Game: the map row moved, to this index into `MAPS`. */
  onPickMap: (index: number) => void = () => {};
  /**
   * Wired by Game: the bots row moved, to this value. The VALUE and not an
   * index, because this pick has two states rather than a list of them.
   */
  onPickBots: (bots: boolean) => void = () => {};
  /** Wired by Game: fetch every region's list again. */
  onRefresh: () => void = () => {};
  /** Wired by Game: leave the screen. */
  onClose: () => void = () => {};

  /**
   * The photograph behind the screen: the map it is ABOUT, put up on the
   * MENU's backdrop (`#menu-shot`) rather than a second copy here. This screen
   * is only ever raised from the menu, the picture is already up behind it, and
   * one backdrop with one cross-fade cannot show two maps at once. The menu
   * puts its own map back when it is redrawn on the way out.
   */
  private readonly backdrop: MenuBackdrop;

  constructor(backdrop: MenuBackdrop) {
    this.backdrop = backdrop;
    this.root = document.createElement("div");
    this.root.id = "lobby";
    this.root.className = `hidden dev-${this.device}`;
    // Every block is a named grid AREA, which is what lets a phone's layout be
    // a change of template in the stylesheet rather than a second copy of this
    // markup — the menu's rule, the kit screen's and the settings screen's.
    const tabs = PAGES.map(
      (p, i) =>
        `<button class="lb-tab" data-page="${i}">${p.icon}<b>${p.label}</b>${i === JOIN ? `<em class="lb-count"></em>` : ""}</button>`,
    ).join("");
    this.root.innerHTML = `
      <div class="lb-top">
        <div class="lb-brand">
          <span class="lb-kicker">Greywatch</span>
          <span class="lb-word">Online</span>
        </div>
        <div class="lb-sys">
          <button class="lb-sysbtn lb-refresh">${ICONS.refresh}<b>Refresh</b>${glyph("R", "X")}</button>
          <button class="lb-sysbtn lb-back">${ICONS.back}<b>Back</b>${glyph("Esc", "B")}</button>
        </div>
      </div>
      <div class="lb-hero"></div>
      <div class="lb-tabsrow" data-row="0">
        <button class="lb-nav prev" data-step="-1" aria-label="Previous page">${glyph("Q", "LB")}</button>
        <div class="lb-tabs">${tabs}</div>
        <button class="lb-nav next" data-step="1" aria-label="Next page">${glyph("E", "RB")}</button>
      </div>
      <div class="lb-list"></div>
      <p class="lb-say"></p>
      <aside class="lb-intel"></aside>
      <div class="lb-foot">
        <span data-dev="kbm"><kbd>&uarr;</kbd><kbd>&darr;</kbd> Move</span>
        <span data-dev="kbm"><kbd>&larr;</kbd><kbd>&rarr;</kbd> Change</span>
        <span data-dev="kbm"><kbd>Enter</kbd> Select</span>
        <span data-dev="pad"><kbd class="pd">D-pad</kbd> Navigate</span>
        <span data-dev="pad"><kbd class="pd">A</kbd> Select</span>
      </div>
    `;
    document.getElementById("hud")!.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.heroEl = q(".lb-hero");
    this.tabsRow = q(".lb-tabsrow");
    this.tabs = Array.from(this.root.querySelectorAll<HTMLElement>(".lb-tab"));
    this.countEl = q(".lb-count");
    this.prevEl = q(".lb-nav.prev");
    this.nextEl = q(".lb-nav.next");
    this.listEl = q(".lb-list");
    this.sayEl = q(".lb-say");
    this.intelEl = q(".lb-intel");
    // The system corner. `click` is safe on a button INSIDE a screen that is
    // already up: the pointerdown rule the menu's buttons follow is about
    // buttons that race a confirm on the way in.
    q(".lb-back").onclick = () => this.onClose();
    q(".lb-refresh").onclick = () => this.refresh();
    this.tabs.forEach((t) => {
      t.onclick = () => this.setPage(Number(t.dataset.page), true);
    });
    for (const nav of [this.prevEl, this.nextEl]) {
      nav.onclick = () => this.stepPage(Number(nav.dataset.step));
    }
    this.tabsRow.onmouseenter = () => this.hoverRow(0);
    // The plan in the intel is a canvas sized to its box when it was drawn, so
    // a resize owes it a repaint rather than a stretched bitmap.
    window.addEventListener("resize", () => {
      if (this.visible) this.paintThumb();
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  isOpen(): boolean {
    return this.visible;
  }

  show(): void {
    // Raised anew every time, on the JOIN page and its tab strip. Unlike the
    // menu there is nothing worth preserving across visits — the rows
    // themselves differ each time — and the strip is the one row whose blind
    // Enter can do no harm: it turns the page, where a match row would join a
    // round and a picker would move the player to another continent. The
    // identity rule then keeps the cursor there as the list lands under it.
    this.page = JOIN;
    this.row = 0;
    this.state = { phase: "browsing" };
    // Every answer is stale by the time the screen is raised again — a match
    // that was there a minute ago is the exact row this screen must not show —
    // so the results are dropped and re-asked rather than shown while they are
    // re-asked. The region LIST is not: it is a deploy-time file `Game` reads
    // once, and clearing it here would flash an empty screen on every visit.
    this.results.clear();
    this.root.classList.remove("hidden");
    // The ENTRANCE, replayed on every raise and never on a patch — the menu's
    // `.enter`. Taking the class off and reading a layout property is what
    // restarts animations that already ran on the last open.
    this.root.classList.remove("enter");
    void this.root.offsetWidth;
    this.root.classList.add("enter");
    // The menu this is raised over is DOM, and what the lobby is laid over is
    // the photograph; the CSS carries the rule, this is the flag it reads.
    document.getElementById("hud")!.classList.add("lobbying");
    this.shown = null;
    this.draw();
  }

  hide(): void {
    this.root.classList.add("hidden");
    this.root.classList.remove("enter");
    document.getElementById("hud")!.classList.remove("lobbying");
  }

  /**
   * Which device's prompts to draw. A class on the root, compared before it is
   * written, so `Game` can push it every frame.
   */
  setInputDevice(device: InputDevice): void {
    if (device === this.device) return;
    this.device = device;
    markDevice(this.root, device);
  }

  /**
   * The regions this client knows about, and which is chosen.
   *
   * Pushed in before any result, and pushed in again on every open — the list
   * itself is read once, but which region is chosen may have moved since (the
   * fastest one is preselected until the player picks for themselves).
   */
  setRegions(regions: Region[], choice: number): void {
    this.regions = regions;
    this.regionChoice = choice;
    if (this.visible) this.draw();
  }

  /**
   * Which region a new match would be started in, as an index. Pushed in by
   * `Game` after every pick, so the row and the game's own choice cannot
   * disagree.
   */
  setRegionChoice(index: number): void {
    if (index === this.regionChoice) return;
    this.regionChoice = index;
    if (this.visible) this.draw();
  }

  /**
   * One region's fetch came back.
   *
   * Per region and not per refresh, because the regions are asked TOGETHER and
   * answer separately: the near one lands in a few milliseconds and the far one
   * a moment later, and holding the near one back to render them as a set would
   * make every lobby as slow as the slowest server in the file — including a
   * server that is down, whose answer is four seconds of timeout.
   */
  setResult(regionId: string, result: LobbyResult): void {
    this.results.set(regionId, result);
    if (this.visible) this.draw();
  }

  /** A join is in flight; the screen stays up until the round replaces it. */
  setJoining(regionId: string, matchId: string): void {
    this.state = { phase: "joining", regionId, matchId };
    if (this.visible) this.draw(true);
  }

  /**
   * Which map a new match would be started on, as an index into `MAPS`. Pushed
   * in by `Game` both when the screen opens and after every pick, so the row
   * and the game's own choice cannot disagree.
   */
  setMapChoice(index: number): void {
    if (index === this.mapChoice) return;
    this.mapChoice = index;
    if (this.visible) this.draw();
  }

  /** Whether a new match would field bots, pushed in the same one-way shape. */
  setBotsChoice(bots: boolean): void {
    if (bots === this.botsChoice) return;
    this.botsChoice = bots;
    if (this.visible) this.draw();
  }

  /** Steps the highlighted row, wrapping at both ends — the screen's up/down. */
  moveRow(delta: number): void {
    // The tab strip is one of them, which is what puts both pages in reach of
    // a pad without a button of its own.
    const n = this.rows().length + 1;
    this.row = (this.row + delta + n) % n;
    this.draw();
  }

  /**
   * Turns the PAGE wherever the cursor is — the bumpers. Clamped, as left and
   * right on the strip are, because it is the same choice reached by another
   * key and the two must not disagree about what happens at the end of it.
   */
  stepPage(delta: number): void {
    this.setPage(step(this.page, delta, PAGES.length, false), this.row === 0);
  }

  /** Asks every server again — the system corner's Refresh, and R / X. */
  refresh(): void {
    if (this.state.phase === "joining") return;
    this.onRefresh();
  }

  /** Fires the cursor's row — Enter / pad A / a click. */
  activate(): void {
    // A join already in flight swallows further picks. Two `connect`s would
    // leave `Game.net` pointing at one session while another still holds a
    // socket — `joinMatch` guards on `this.net` and would drop the second on
    // the floor, which looks from here like a button that did nothing.
    if (this.state.phase === "joining") return;
    if (this.row === 0) {
      // The strip: one page on, and round — Enter is one key being asked to
      // reach every page, so it has to come round where the arrows clamp.
      this.setPage(step(this.page, 1, PAGES.length, true), true);
      return;
    }
    const row = this.rows()[this.row - 1];
    if (!row) return;
    switch (row.kind) {
      case "match":
        // A full match is drawn dimmed and refuses the confirm, rather than
        // being left out of the list. Knowing a round is there and full is
        // worth more than a shorter list, and the server would refuse the
        // join anyway — this only saves the round trip.
        if (row.match.humans >= row.match.slots) return;
        this.onJoin(row.region.id, row.match.id, row.match.mapId);
        break;
      // A line about a region rather than a round in one. It takes the cursor
      // so the text can be read on a pad, and does nothing on the confirm:
      // there is no match here to enter.
      case "note":
        break;
      // The three PICKERS wrap on the confirm, where left/right clamps — the
      // same split the settings screen's rows keep.
      case "region":
      case "map":
      case "bots":
        this.stepPicker(row.kind, 1, true);
        break;
      case "create":
        this.onCreate();
        break;
    }
  }

  /**
   * Left/right on the cursor's row: the page on the strip, a picker's value on
   * the NEW MATCH page, and nothing at all on a match row — that match's map,
   * region and bodies are its own, so there is nothing here for a horizontal
   * nudge to change, and a nudge that did something anyway would make the
   * cursor's own edges feel like traps.
   */
  stepRow(delta: number): void {
    if (this.state.phase === "joining") return;
    if (this.row === 0) {
      this.setPage(step(this.page, delta, PAGES.length, false), true);
      return;
    }
    const kind = this.rows()[this.row - 1]?.kind;
    if (kind === "region" || kind === "map" || kind === "bots") {
      this.stepPicker(kind, delta, false);
    }
  }

  private stepPicker(kind: "region" | "map" | "bots", delta: number, wrap: boolean): void {
    if (this.state.phase === "joining") return;
    if (kind === "region") {
      const next = step(this.regionChoice, delta, this.regions.length, wrap);
      if (next !== this.regionChoice) this.onPickRegion(next);
    } else if (kind === "map") {
      const next = step(this.mapChoice, delta, MAPS.length, wrap);
      if (next !== this.mapChoice) this.onPickMap(next);
    } else {
      const at = this.botsChoice ? 0 : 1;
      const next = step(at, delta, BOTS_OPTIONS.length, wrap);
      if (next !== at) this.onPickBots(BOTS_OPTIONS[next].value);
    }
  }

  /** Is there a choice of server at all? */
  private multi(): boolean {
    return this.regions.length > 1;
  }

  /**
   * The JOIN page's rows.
   *
   * Matches are grouped BY REGION in the order the file names them, rather than
   * sorted by ping or by how full they are. The file's order is a deployment's
   * own statement of which server it thinks of first, and a list that reordered
   * itself as pings came in would move a row out from under the cursor for
   * reasons the player cannot see.
   */
  private joinRows(): JoinRow[] {
    const rows: JoinRow[] = [];
    const multi = this.multi();
    for (const region of this.regions) {
      const result = this.results.get(region.id);
      if (!result) {
        // Only worth a line when there is another region whose answer it is
        // being told apart from. With one, the empty state already says the
        // screen is waiting.
        if (multi) rows.push({ kind: "note", region, text: "Asking…", ping: -1 });
        continue;
      }
      if (!result.ok) {
        if (multi) rows.push({ kind: "note", region, text: result.error, ping: -1 });
        continue;
      }
      for (const match of result.list.matches) rows.push({ kind: "match", region, match });
      if (multi && result.list.matches.length === 0) {
        rows.push({
          kind: "note",
          region,
          text: result.list.full ? "Every match is full" : "No matches running",
          // A region that answered has a ping worth showing even with nothing
          // to list — it is the number that says whether to start a match HERE.
          ping: result.ping,
        });
      }
    }
    return rows;
  }

  /** The NEW MATCH page's rows. The region picker only where there is a choice. */
  private newRows(): NewRow[] {
    const rows: NewRow[] = [];
    if (this.multi()) rows.push({ kind: "region" });
    rows.push({ kind: "map" }, { kind: "bots" }, { kind: "create" });
    return rows;
  }

  private rows(): LobbyRow[] {
    return this.page === JOIN ? this.joinRows() : this.newRows();
  }

  /**
   * Shows a page. From the strip the cursor stays on the strip; from a row it
   * goes to the TOP of the new page's list rather than being carried across —
   * row 2 of the matches is not row 2 of anything on the other page.
   */
  private setPage(next: number, onStrip: boolean): void {
    if (next === this.page) return;
    this.page = next;
    this.row = onStrip ? 0 : Math.min(1, this.rows().length);
    this.draw();
  }

  /** Hover moves the cursor, so the highlighted row and the one Enter fires agree. */
  private hoverRow(index: number): void {
    if (index === this.row) return;
    this.row = index;
    this.draw();
  }

  /**
   * What the hero is about. The cursor's match or region line; on the strip
   * the FIRST match, because the strip is where the screen opens and the title
   * of a screen full of matches should be one of them; the list's own state
   * when there is nothing in it; and on the other page, the match this client
   * would make.
   */
  private focus(rows: readonly LobbyRow[]): Focus {
    if (this.page === NEW) return { kind: "new" };
    const matches = rows.filter((r): r is Extract<JoinRow, { kind: "match" }> => r.kind === "match");
    const at = rows[this.row - 1] ?? matches[0];
    if (at?.kind === "match") {
      return { kind: "match", row: at, n: matches.indexOf(at) + 1, of: matches.length };
    }
    if (at?.kind === "note") return { kind: "note", row: at };
    return { kind: "status" };
  }

  /**
   * Brings the screen up to date by PATCHING it. Each block is touched only
   * when what it says has changed, and that is not tidiness: the title's
   * wipe, the rows' deal and the plan in the intel are things that have to
   * survive the redraw to be seen at all — and a list rewritten every time a
   * far region answers is a list whose row the pointer is over is replaced
   * under it.
   *
   * The cursor is re-found by IDENTITY first, not by index. A refresh inserts
   * match rows above the ones that were there, so an index carried across one
   * silently means a different row — press Enter twice and you have joined a
   * different round, with the highlight having moved under your hand to say
   * so. Falling back to the clamp covers the row that genuinely went away.
   */
  private draw(force = false): void {
    const was = this.shown;
    const rows = this.rows();
    // The list's SHAPE — and, on a JOIN page with nothing to join, what its
    // empty state says, since that block is part of the list and has nothing
    // to be patched through.
    const empty =
      this.page === JOIN && !rows.some((r) => r.kind === "match")
        ? `|empty:${this.searching()}:${this.subtitle()}`
        : "";
    const keys = rows.map(rowKey).join("|") + empty;
    const pageMoved = !was || was.page !== this.page;
    if (!pageMoved && was.keys !== keys && this.row > 0) {
      const held = this.heldRow;
      const found = held ? rows.findIndex((r) => sameRow(r, held)) : -1;
      this.row = found >= 0 ? found + 1 : Math.min(this.row, rows.length);
    }
    this.row = Math.max(0, Math.min(this.row, rows.length));
    this.heldRow = rows[this.row - 1] ?? null;

    this.patchStrip(rows);
    if (pageMoved || force || was.keys !== keys) {
      this.buildList(rows, pageMoved && was !== null, was && !pageMoved ? was.keys : null);
    }
    this.patchRows(rows);
    this.patchCursor();

    const focus = this.focus(rows);
    const heroKey = this.heroKey(focus);
    if (!was || was.heroKey !== heroKey) this.writeHero(focus, was !== null);
    this.patchHero(focus);

    const intel = this.intelMarkup(rows, focus);
    const intelKey = `${this.page}:${this.row}:${rowKeyAt(rows, this.row)}`;
    const intelSig = intel.html + intel.fill.sig();
    if (!was || force || was.intelKey !== intelKey || this.intelHtml !== intelSig) {
      // The plate's fade is for the CURSOR arriving on something new, not for
      // a server's answer rewriting the one it is already on.
      const fresh = !was || was.intelKey !== intelKey;
      this.intelHtml = intelSig;
      intel.fill.into(this.intelEl, `<div class="lb-intel-in${fresh ? " fade" : ""}">${intel.html}</div>`);
      this.thumbMap = intel.thumb;
      this.paintThumb();
      this.sayEl.textContent = intel.say;
    }

    // An id, because a listed match names its map by id — and one this build
    // has never heard of has no picture, so the backdrop fades out. Pushed only
    // while the screen is up, which is only ever over the menu: the picture is
    // the menu's, and nothing else may raise it.
    const backdrop = this.backdropOf(focus);
    if (this.visible && (!was || was.backdrop !== backdrop)) {
      this.backdrop.show(MAPS.find((m) => m.id === backdrop));
    }

    this.shown = { page: this.page, keys, heroKey, intelKey, backdrop };
  }

  /** The row the cursor was on at the last draw, for the identity rule. */
  private heldRow: LobbyRow | null = null;
  /** The intel's last markup, so an answer that changes nothing rewrites nothing. */
  private intelHtml = "";
  /** The map whose plan the intel's canvas shows, or null when it has none. */
  private thumbMap: MapDef | null = null;

  /** The tabs, the match count on the JOIN tab, and the strip's spent ends. */
  private patchStrip(rows: readonly LobbyRow[]): void {
    this.tabs.forEach((t, i) => t.classList.toggle("on", i === this.page));
    const count = this.page === JOIN
      ? rows.filter((r) => r.kind === "match").length
      : this.joinRows().filter((r) => r.kind === "match").length;
    // Only once some server has actually ANSWERED: a zero on a screen that
    // could not reach anybody is a measurement nobody took.
    const answered = [...this.results.values()].some((r) => r.ok);
    const text = answered ? String(count) : "";
    if (this.countEl.textContent !== text) this.countEl.textContent = text;
    this.prevEl.classList.toggle("off", this.page <= 0);
    this.nextEl.classList.toggle("off", this.page >= PAGES.length - 1);
  }

  /**
   * The page's rows from nothing — on a page turn, where they are different
   * rows, and when a server's answer changed the SET of rows on the JOIN page.
   * `deal` is the page turn's entrance, staggered by index; `before` is the
   * set that was on screen, so a row that has just ARRIVED deals itself in and
   * the rows that were already there hold still.
   */
  private buildList(rows: readonly LobbyRow[], deal: boolean, before: string | null): void {
    const old = before === null ? null : new Set(before.split("|"));
    this.listEl.className = `lb-list${deal ? " deal" : ""}`;
    const fill = new Fill();
    let html = rows
      .map((r, n) => {
        const fresh = old !== null && !old.has(rowKey(r));
        return this.rowMarkup(r, n + 1, fresh, fill);
      })
      .join("");
    if (this.page === JOIN && !rows.some((r) => r.kind === "match")) {
      html += this.emptyMarkup(fill);
    }
    fill.into(this.listEl, html);
    if (deal) this.listEl.scrollTop = 0;
    this.bindRows(rows);
    this.paintArt(rows);
  }

  /**
   * One row's markup. Every row is a plate in a WRAPPER that is not clipped,
   * because the cursor is a pair of sight brackets on the wrapper's corners
   * (the menu's mark) and the plate is cut by a `clip-path` that would take
   * them off with its corner.
   */
  private rowMarkup(row: LobbyRow, index: number, fresh: boolean, fill: Fill): string {
    const wrap = (cls: string, inner: string) =>
      `<div class="lb-rowwrap${fresh ? " fresh" : ""}" data-row="${index}" style="--i:${index}"><div class="lb-row ${cls}">${inner}</div></div>`;
    const multi = this.multi();
    switch (row.kind) {
      case "match": {
        // The counts are numbers the server computed, so they are safe to
        // interpolate; the text cells are not, and go through the filler.
        const where = multi
          ? `<span class="lb-where">${fill.t(row.region.name, "lb-rn")}<b class="lb-lat"></b></span>`
          : "";
        return wrap(
          `lb-match${multi ? " multi" : ""}`,
          `<span class="lb-art" data-map="${index}"></span>
           <span class="lb-name">${fill.t(mapName(row.match.mapId), "lb-mn")}<i class="lb-state"></i></span>
           <span class="lb-seats"><b></b><i>/ ${row.match.slots}</i></span>
           ${where}`,
        );
      }
      case "note":
        return wrap(
          "lb-note",
          `<span class="lb-name">${fill.t(row.region.name, "lb-mn")}<i class="lb-state"></i></span>
           <span class="lb-where"><b class="lb-lat"></b></span>`,
        );
      case "region":
      case "map":
      case "bots": {
        const label = row.kind === "region" ? "Region" : row.kind === "map" ? "Map" : "Bots";
        const count =
          row.kind === "region" ? this.regions.length : row.kind === "map" ? MAPS.length : BOTS_OPTIONS.length;
        return wrap(
          "lb-pick",
          `<span class="lb-label">${label}</span>
           <i class="lb-pnote"></i>
           <div class="lb-step">
             <button class="lb-arr prev" data-d="-1" aria-label="Previous ${label}"></button>
             <button class="lb-val" aria-label="${label}"><b></b><i>${"<s></s>".repeat(count)}</i></button>
             <button class="lb-arr next" data-d="1" aria-label="Next ${label}"></button>
           </div>`,
        );
      }
      case "create":
        return wrap(
          "lb-create",
          `<span class="lb-cword">Start match</span><span class="lb-csub"></span>`,
        );
    }
  }

  /**
   * What stands where the matches would be when there are none: what the
   * servers said, and the way to the other page — which is the thing a player
   * looking at an empty list is about to want. The button's prompt is the
   * bumper that turns the page, because that is what it does.
   */
  private emptyMarkup(fill: Fill): string {
    const searching = this.searching();
    return `
      <div class="lb-empty${searching ? " searching" : ""}">
        <span class="lb-empty-cap">${searching ? "Searching" : "Nothing to join"}</span>
        <p>${fill.t(this.subtitle())}</p>
        <button class="lb-go">${ICONS.create}<b>New match</b>${glyph("E", "RB")}</button>
      </div>`;
  }

  /**
   * Hangs the pointer on a freshly built list. Once per BUILD, because a patch
   * keeps every element and therefore every handler.
   */
  private bindRows(rows: readonly LobbyRow[]): void {
    this.listEl.querySelectorAll<HTMLElement>(".lb-rowwrap").forEach((wrap) => {
      const index = Number(wrap.dataset.row);
      const row = rows[index - 1];
      if (!row) return;
      // Hovering a row moves the cursor with it — every row here carries its
      // own control, so the row under the pointer is always the one it is
      // about to use (the settings screen's rule, and the reason).
      wrap.onmouseenter = () => this.hoverRow(index);
      if (row.kind === "match" || row.kind === "create") {
        // A CLICK, where the old lobby fired its rows on pointer-down. The
        // down edge is what a control that LEAVES a screen for the round
        // takes when the same press must go on to take the pointer lock (the
        // deploy screen's), and a join takes no lock — it goes to the building
        // card and then to the deploy map. What decides it here is the
        // finger: this list scrolls on a phone, and a drag that begins on a
        // plate must not join the round under it, which only a click — never
        // raised after a scroll — can promise.
        wrap.onclick = () => {
          this.row = index;
          this.draw();
          this.activate();
        };
        return;
      }
      if (row.kind === "note") {
        wrap.onclick = () => this.hoverRow(index);
        return;
      }
      // A picker picks rather than fires, so it takes ordinary clicks on its
      // arrows and its value — the settings screen's stepper exactly.
      const kind = row.kind;
      wrap.querySelectorAll<HTMLElement>("button.lb-arr").forEach((btn) => {
        btn.onclick = () => {
          this.hoverRow(index);
          this.stepPicker(kind, Number(btn.dataset.d), false);
        };
      });
      const val = wrap.querySelector<HTMLElement>("button.lb-val");
      if (val) {
        val.onclick = () => {
          this.hoverRow(index);
          this.stepPicker(kind, 1, true);
        };
      }
    });
    const go = this.listEl.querySelector<HTMLElement>("button.lb-go");
    if (go) go.onclick = () => this.setPage(NEW, false);
  }

  /**
   * Puts each match's map photograph on its plate, as the downscales arrive.
   * `shotThumbUrl` makes one per map per session and the menu's reel has
   * usually made them already, so this answers on resolved promises. A map with
   * no photograph keeps the plate's own dark slice.
   */
  private paintArt(rows: readonly LobbyRow[]): void {
    this.listEl.querySelectorAll<HTMLElement>(".lb-art").forEach((el) => {
      const row = rows[Number(el.dataset.map) - 1];
      if (row?.kind !== "match") return;
      void shotThumbUrl(row.match.mapId)?.then((url) => {
        el.style.backgroundImage = `url("${url}")`;
      });
    });
  }

  /** Writes every row's changing text and values in place. */
  private patchRows(rows: readonly LobbyRow[]): void {
    this.listEl.querySelectorAll<HTMLElement>(".lb-rowwrap").forEach((wrap) => {
      const row = rows[Number(wrap.dataset.row) - 1];
      if (!row) return;
      const setText = (sel: string, text: string) => {
        const el = wrap.querySelector<HTMLElement>(sel);
        if (el && el.textContent !== text) el.textContent = text;
      };
      if (row.kind === "match") {
        const full = row.match.humans >= row.match.slots;
        const busy =
          this.state.phase === "joining" &&
          this.state.matchId === row.match.id &&
          this.state.regionId === row.region.id;
        wrap.classList.toggle("full", full);
        wrap.classList.toggle("busy", busy);
        wrap.classList.toggle("botless", row.match.bots === false);
        setText(".lb-state", busy ? "Joining…" : stateLabel(row.match));
        setText(".lb-seats b", String(row.match.humans));
        this.fillLatency(wrap.querySelector(".lb-lat"), this.pingOf(row.region.id));
        return;
      }
      if (row.kind === "note") {
        setText(".lb-state", row.text);
        this.fillLatency(wrap.querySelector(".lb-lat"), row.ping);
        return;
      }
      if (row.kind === "create") {
        const map = MAPS[this.mapChoice];
        const region = this.multi() ? this.regions[this.regionChoice]?.name : undefined;
        // What the button would SPEND, read back in the order the rows above
        // ask it — a button that named only the map would be silent about the
        // one choice whose wrong answer is invisible until the round is up.
        setText(
          ".lb-csub",
          [map?.name ?? "", region, this.botsChoice ? "With bots" : "Players only"]
            .filter(Boolean)
            .join(" · "),
        );
        return;
      }
      const { at, count, label, note, quality } = this.pickerValue(row.kind);
      // The value is a region name out of a file over HTTP in one of the three
      // cases, so it is assigned here like every other such string.
      setText(".lb-val > b", label);
      setText(".lb-pnote", note);
      const noteEl = wrap.querySelector<HTMLElement>(".lb-pnote");
      if (noteEl) noteEl.className = `lb-pnote${quality ? ` ${quality}` : ""}`;
      wrap.querySelectorAll("s").forEach((s, k) => s.classList.toggle("lit", k === at));
      // Left and right CLAMP, so an arrow at the end of its list is drawn
      // spent — the settings screen's stepper, for its reason.
      wrap.querySelector(".lb-arr.prev")?.classList.toggle("off", at <= 0);
      wrap.querySelector(".lb-arr.next")?.classList.toggle("off", at >= count - 1);
    });
  }

  /** A picker's chosen value, its place on its list, and its plate's note. */
  private pickerValue(kind: "region" | "map" | "bots"): {
    at: number;
    count: number;
    label: string;
    note: string;
    quality?: string;
  } {
    if (kind === "region") {
      const region = this.regions[this.regionChoice];
      const ping = region ? this.pingOf(region.id) : -1;
      return {
        at: this.regionChoice,
        count: this.regions.length,
        label: region?.name ?? "—",
        note: ping < 0 ? "Not answering" : `${pingText(ping)} ms round trip`,
        quality: pingQuality(ping),
      };
    }
    if (kind === "map") {
      const map = MAPS[this.mapChoice];
      const per = map ? perTeamOf(map.layout) : CONFIG.bots.perTeam;
      const size = map?.layout.size ?? CONFIG.map.size;
      return {
        at: this.mapChoice,
        count: MAPS.length,
        label: map?.name ?? "—",
        note: `${per} v ${per} · ${size} m across`,
      };
    }
    const at = this.botsChoice ? 0 : 1;
    return { at, count: BOTS_OPTIONS.length, label: BOTS_OPTIONS[at].label, note: BOTS_OPTIONS[at].note };
  }

  /** Puts the cursor's brackets on its row and keeps that row on the glass. */
  private patchCursor(): void {
    this.tabsRow.classList.toggle("sel", this.row === 0);
    let lit: HTMLElement | null = null;
    this.listEl.querySelectorAll<HTMLElement>(".lb-rowwrap").forEach((wrap) => {
      const on = Number(wrap.dataset.row) === this.row;
      wrap.classList.toggle("sel", on);
      if (on) lit = wrap;
    });
    (lit as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
    if (this.row === 0) this.listEl.scrollTop = 0;
  }

  /** What the hero's IDENTITY is — a change of it is a title wipe. */
  private heroKey(focus: Focus): string {
    switch (focus.kind) {
      case "match":
        return `m:${focus.row.region.id}:${focus.row.match.id}:${focus.row.match.mapId}`;
      case "note":
        return `n:${focus.row.region.id}`;
      case "status":
        return `s:${this.statusWord()}`;
      case "new":
        return `new:${this.mapChoice}`;
    }
  }

  /**
   * The title: a hollow numeral behind, an eyebrow, the NAME, and a strip of
   * figures under it. Rewritten only when what the hero is about changes,
   * because replacing it is how `.swap` replays the wipe; the eyebrow and the
   * figures are patched in place by `patchHero`.
   */
  private writeHero(focus: Focus, swap: boolean): void {
    const fill = new Fill();
    let index = "";
    let title: string;
    switch (focus.kind) {
      case "match":
        index = twoDigits(focus.n);
        title = fill.t(mapName(focus.row.match.mapId));
        break;
      case "note":
        title = fill.t(focus.row.region.name);
        break;
      case "status":
        title = this.statusWord();
        break;
      case "new":
        index = twoDigits(this.mapChoice + 1);
        title = MAPS[this.mapChoice]?.name ?? "New match";
        break;
    }
    fill.into(
      this.heroEl,
      `<div class="lb-hero-in${swap ? " swap" : ""}">
        ${index ? `<span class="lb-index" aria-hidden="true">${index}</span>` : ""}
        <span class="lb-mode"></span>
        <h2 class="lb-title">${title}</h2>
        <div class="lb-facts"></div>
      </div>`,
    );
  }

  /** The hero's eyebrow and figures, which move under a title that does not. */
  private patchHero(focus: Focus): void {
    const mode = this.heroEl.querySelector<HTMLElement>(".lb-mode");
    const factsEl = this.heroEl.querySelector<HTMLElement>(".lb-facts");
    if (!mode || !factsEl) return;
    const multi = this.multi();
    let eyebrow: string;
    let facts: [string, string, string?][];
    switch (focus.kind) {
      case "match": {
        const { match, region } = focus.row;
        const joining =
          this.state.phase === "joining" &&
          this.state.matchId === match.id &&
          this.state.regionId === region.id;
        eyebrow = joining
          ? "Joining…"
          : `Match ${twoDigits(focus.n)} / ${twoDigits(focus.of)}${multi ? ` · ${region.name}` : ""}`;
        const ping = this.pingOf(region.id);
        facts = [
          [`${match.humans} / ${match.slots}`, "Players"],
          [pingText(ping), "ms", pingQuality(ping)],
          [stateLabel(match), ""],
        ];
        break;
      }
      case "note":
        eyebrow = "Region";
        facts = [[focus.row.text, ""]];
        break;
      case "status":
        eyebrow = this.multi() ? `${this.regions.length} regions` : "Match server";
        facts = [[this.subtitle(), ""]];
        break;
      case "new": {
        const map = MAPS[this.mapChoice];
        const per = map ? perTeamOf(map.layout) : CONFIG.bots.perTeam;
        const region = multi ? this.regions[this.regionChoice]?.name : undefined;
        eyebrow = `New match${region ? ` · ${region}` : ""}`;
        facts = [
          [`${per} v ${per}`, "Conquest"],
          [`${map?.layout.controlPoints.length ?? 5}`, "Points"],
          [this.botsChoice ? "With bots" : "Players only", ""],
        ];
        break;
      }
    }
    if (mode.textContent !== eyebrow) mode.textContent = eyebrow;
    // Compared as text before it is written, so an answer that moved nothing
    // rewrites nothing; each figure goes in through `textContent`, because a
    // note's text and a server's error are among them.
    const sig = JSON.stringify(facts);
    if (factsEl.dataset.sig === sig) return;
    factsEl.dataset.sig = sig;
    factsEl.replaceChildren(
      ...facts.map(([v, l, q]) => {
        const span = document.createElement("span");
        if (q) span.className = q;
        const b = document.createElement("b");
        b.textContent = v;
        span.appendChild(b);
        if (l) {
          const i = document.createElement("i");
          i.textContent = l;
          span.appendChild(i);
        }
        return span;
      }),
    );
  }

  /**
   * The intel plate — what the cursor's row IS, described — and the one-line
   * version of it that stands in where a viewport has no room for the plate.
   * `thumb` is the map whose plan the plate draws, painted after the markup is
   * in because a canvas is sized from its own box.
   */
  private intelMarkup(
    rows: readonly LobbyRow[],
    focus: Focus,
  ): { html: string; fill: Fill; say: string; thumb: MapDef | null } {
    const fill = new Fill();
    const head = (eyebrow: string, title: string) =>
      `<div class="lb-intel-head"><span class="lb-eyebrow-s">${eyebrow}</span><h3>${title}</h3></div>`;
    const blurb = (text: string) => `<p class="lb-blurb">${text}</p>`;
    const thumb = `<div class="lb-thumb"><canvas></canvas></div>`;
    const row = rows[this.row - 1];

    if (!row) {
      // The strip: the PAGE, and what is on it.
      const p = PAGES[this.page];
      if (this.page === JOIN) {
        const regions = this.regions
          .map((r) => {
            const result = this.results.get(r.id);
            const what = !result
              ? "Asking…"
              : !result.ok
                ? "No answer"
                : `${result.list.matches.length} match${result.list.matches.length === 1 ? "" : "es"}`;
            const ping = this.pingOf(r.id);
            return `<div class="lb-sum">${fill.t(r.name)}<em>${what}</em><b class="lb-lat ${pingQuality(ping)}">${ping < 0 ? "—" : `${pingText(ping)} ms`}</b></div>`;
          })
          .join("");
        return {
          html:
            head(`Page 01 · ${this.regions.length} region${this.regions.length === 1 ? "" : "s"}`, p.label) +
            blurb(p.blurb) +
            (regions ? `<div class="lb-sums">${regions}</div>` : ""),
          fill,
          say: p.blurb,
          thumb: null,
        };
      }
      const sums = this.newRows()
        .filter((r): r is Exclude<NewRow, { kind: "create" }> => r.kind !== "create")
        .map((r) => {
          const v = this.pickerValue(r.kind);
          const label = r.kind === "region" ? "Region" : r.kind === "map" ? "Map" : "Bots";
          return `<div class="lb-sum"><span>${label}</span><b>${fill.t(v.label)}</b></div>`;
        })
        .join("");
      return {
        html: head("Page 02", p.label) + blurb(p.blurb) + `<div class="lb-sums">${sums}</div>`,
        fill,
        say: p.blurb,
        thumb: null,
      };
    }

    if (row.kind === "match" && focus.kind === "match") {
      const { match, region } = row;
      const map = mapById(match.mapId) ?? null;
      const botless = match.bots === false;
      // The seats as a strip of pips: a person lit, a seat a bot is holding
      // filled dim, and — in a match with no bots — an open seat as an outline,
      // because in that round it is genuinely empty.
      const seats = Array.from(
        { length: match.slots },
        (_, k) => `<s class="${k < match.humans ? "p" : botless ? "o" : "b"}"></s>`,
      ).join("");
      const ping = this.pingOf(region.id);
      const text = matchBlurb(match);
      return {
        html:
          head(`${fill.t(region.name)} · Match ${twoDigits(focus.n)}`, fill.t(mapName(match.mapId))) +
          `<div class="lb-seatstrip"><div class="lb-pips">${seats}</div>
             <div class="lb-seatkey"><span><i class="p"></i>${match.humans} player${match.humans === 1 ? "" : "s"}</span><span><i class="${botless ? "o" : "b"}"></i>${botless ? "Open" : "Bot"}</span></div></div>` +
          `<div class="lb-ifacts"><span class="${pingQuality(ping)}"><b>${pingText(ping)}</b><i>Ping, ms</i></span><span><b>${stateLabel(match)}</b><i>State</i></span></div>` +
          (map ? thumb : "") +
          blurb(text),
        fill,
        say: text,
        thumb: map,
      };
    }

    if (row.kind === "note") {
      const text = `${row.text}. Refresh asks every server again.`;
      return {
        html: head("Region", fill.t(row.region.name)) + `<p class="lb-blurb">${fill.t(text)}</p>`,
        fill,
        say: text,
        thumb: null,
      };
    }

    if (row.kind === "region") {
      const ladder = this.regions
        .map((r, k) => {
          const ping = this.pingOf(r.id);
          return `<span class="${k === this.regionChoice ? "on" : ""}">${fill.t(r.name)}<em class="lb-lat ${pingQuality(ping)}">${pingText(ping)}</em></span>`;
        })
        .join("");
      const text =
        "Where the match runs, and so how far every one of your shots travels. The nearest server is chosen for you until you pick one; the number is the round trip in milliseconds.";
      return {
        html: head("New match", "Region") + `<div class="lb-ladder">${ladder}</div>` + blurb(text),
        fill,
        say: text,
        thumb: null,
      };
    }

    if (row.kind === "map") {
      const map = MAPS[this.mapChoice];
      if (!map) return { html: "", fill, say: "", thumb: null };
      const per = perTeamOf(map.layout);
      const size = map.layout.size ?? CONFIG.map.size;
      return {
        html:
          head(`Map ${twoDigits(this.mapChoice + 1)} / ${twoDigits(MAPS.length)}`, map.name) +
          `<div class="lb-ifacts"><span><b>${per} v ${per}</b><i>Per side</i></span><span><b>${map.layout.controlPoints.length}</b><i>Points</i></span><span><b>${size} m</b><i>Across</i></span></div>` +
          thumb +
          blurb(map.blurb),
        fill,
        say: map.blurb,
        thumb: map,
      };
    }

    if (row.kind === "bots") {
      const at = this.botsChoice ? 0 : 1;
      const ladder = BOTS_OPTIONS.map(
        (o, k) => `<span class="${k === at ? "on" : ""}">${o.label}</span>`,
      ).join("");
      const text = BOTS_OPTIONS[at].blurb;
      return {
        html: head("New match", "Bots") + `<div class="lb-ladder">${ladder}</div>` + blurb(text),
        fill,
        say: text,
        thumb: null,
      };
    }

    // The button: everything it would spend, then what pressing it does.
    const sums = this.newRows()
      .filter((r): r is Exclude<NewRow, { kind: "create" }> => r.kind !== "create")
      .map((r) => {
        const v = this.pickerValue(r.kind);
        const label = r.kind === "region" ? "Region" : r.kind === "map" ? "Map" : "Bots";
        return `<div class="lb-sum"><span>${label}</span><b>${fill.t(v.label)}</b></div>`;
      })
      .join("");
    const text =
      "Builds a fresh match with these three and puts you in it. It is in everybody else's list the moment it exists.";
    return {
      html: head("New match", "Start match") + `<div class="lb-sums">${sums}</div>` + blurb(text),
      fill,
      say: text,
      thumb: null,
    };
  }

  /**
   * Paints the plan in the intel, if the plate that is up has one — the menu's
   * `paintThumb`, through the same `paintMapThumb`. The map is re-tested inside
   * the callback because the cursor moves faster than a fetch, and so is the
   * screen: a half landing after the lobby has closed paints nothing.
   */
  private paintThumb(): void {
    const canvas = this.intelEl.querySelector("canvas");
    const map = this.thumbMap;
    if (!canvas || !map) return;
    paintMapThumb(canvas, map, () => {
      if (this.thumbMap === map && this.visible) this.paintThumb();
    });
  }

  /** Which map the photograph behind the screen should be. */
  private backdropOf(focus: Focus): string {
    if (focus.kind === "match") return focus.row.match.mapId;
    return MAPS[this.mapChoice]?.id ?? "";
  }

  /** What a region's last answer measured, or -1 if it has none. */
  private pingOf(regionId: string): number {
    const result = this.results.get(regionId);
    return result?.ok ? result.ping : -1;
  }

  /** One latency cell: the number, and the band its colour comes from. */
  private fillLatency(el: Element | null, ping: number): void {
    if (!el) return;
    const cls = `lb-lat ${pingQuality(ping)}`;
    if (el.className !== cls) el.className = cls;
    // An em dash rather than a blank: this cell sits in a column of numbers
    // being compared, and a hole in it reads as a measurement nobody took —
    // which is exactly what it is.
    const text = pingText(ping);
    if (el.textContent !== text) el.textContent = text;
  }

  /** True while the list has not heard enough to say anything definite. */
  private searching(): boolean {
    if (this.regions.length === 0) return true;
    return this.regions.some((r) => !this.results.has(r.id)) &&
      ![...this.results.values()].some((r) => r.ok && r.list.matches.length > 0);
  }

  /** The hero's title when there is no match to be about: one word, set large. */
  private statusWord(): string {
    if (this.searching()) return "Searching";
    const answered = [...this.results.values()].filter((r) => r.ok);
    if (answered.length === 0) return "Offline";
    if (answered.every((r) => r.ok && r.list.full)) return "Full";
    return "No matches";
  }

  /** The line that says what happened, or what is running. */
  private subtitle(): string {
    if (this.state.phase === "joining") return "Joining…";
    if (this.regions.length === 0) return "Looking for matches…";
    if (!this.multi()) {
      const result = this.results.get(this.regions[0].id);
      if (!result) return "Looking for matches…";
      if (!result.ok) return result.error;
      if (result.list.full) return "Every match on this server is full.";
      const n = result.list.matches.length;
      if (n === 0) return "No matches running — start one.";
      return `${n} match${n === 1 ? "" : "es"} on this server`;
    }
    // With more than one region the line is about the SET: which servers
    // answered and what they hold between them. Which region a given row is on
    // is the row's job, and saying it twice would leave the two to disagree as
    // answers land.
    if (this.results.size < this.regions.length) return "Looking for matches…";
    const answered = [...this.results.values()].filter((r) => r.ok);
    if (answered.length === 0) return "Could not reach any match server.";
    const n = answered.reduce((sum, r) => sum + (r.ok ? r.list.matches.length : 0), 0);
    const where = `${answered.length} region${answered.length === 1 ? "" : "s"}`;
    if (n === 0) return `No matches running in ${where} — start one.`;
    return `${n} match${n === 1 ? "" : "es"} in ${where}`;
  }
}

/** A row's identity at a cursor position, or the strip's. */
function rowKeyAt(rows: readonly LobbyRow[], row: number): string {
  const r = rows[row - 1];
  return r ? rowKey(r) : "strip";
}

/** One step along a list of `n`: clamped for the arrows, wrapped for Enter. */
function step(from: number, delta: number, n: number, wrap: boolean): number {
  if (n <= 0) return 0;
  return wrap ? (from + delta + n) % n : Math.max(0, Math.min(n - 1, from + delta));
}
