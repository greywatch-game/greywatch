/**
 * LobbyScreen.ts — The match browser: what every region is running, and the way
 * into one of them.
 * Owns `#lobby`, its row cursor, and the rendering of one `LobbyResult` per
 * region. Owns no networking — it never fetches and never connects. `Game`
 * hands it a region list and each region's answer as it lands, and takes
 * `onJoin`/`onCreate`/`onPickRegion`/`onPickMap`/`onRefresh`/`onClose` back, the
 * same render-what-you-are-given shape `SettingsScreen` follows.
 * Invariants: the rows are DERIVED from the results (`buildRows`), never
 * authored as markup, because the match rows are as many as the servers say and
 * the keyboard navigation has to know about every one of them. Every string that
 * came off a network — a map id, a server's error, a region's name out of the
 * deploy-time file — reaches the DOM through `textContent`, never through the
 * template; see `fillRow`.
 *
 * **A match row is a region AND an id, never an id.** Match ids are minted per
 * process (`m1`, `m2`, …), so two regions are always running matches with the
 * same names — an id alone would let the cursor's identity check confuse two
 * different rounds on two different continents, and would send a join to
 * whichever server the game happened to be pointed at. Every row carries its
 * region, `onJoin` passes it on, and `sameRow` compares it.
 *
 * **The region column exists only when there is more than one region.** A
 * single-server deployment — which is what an untouched `public/regions.json`
 * is — gets exactly the screen it had before regions existed: three columns, one
 * ping on the status line, and no picker for a choice that does not exist.
 */
import "./lobby.css";
import type { MatchSummary } from "../net/protocol";
import type { LobbyResult } from "../net/lobby";
import type { Region } from "../net/regions";
import { MAPS } from "../world/maps";
import { pingQuality, pingText } from "./ping";

/**
 * One line, in screen order.
 *
 * The actions are rows rather than buttons beside the list, for the same reason
 * the main menu became a list: a cursor that reaches every affordance is one a
 * pad can drive without anybody inventing a face button per control.
 */
type LobbyRow =
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
  | { kind: "note"; region: Region; text: string; ping: number }
  /**
   * Which region a NEW match would be started in, and the ping to each.
   *
   * Only present when there is more than one. It says nothing about the match
   * rows above it — those are joined where they are running, whatever this row
   * says — for exactly the reason the map row does not move an existing match.
   */
  | { kind: "region" }
  /**
   * The map a NEW match would be started on — the same pick as the menu's Map
   * row, shown again here because this is where it is spent.
   *
   * It says nothing about the match rows above it: a match is played on the map
   * it is running, and joining one takes that map whatever this row says. Above
   * `create` for the reason the menu puts Map above Deploy — the parameter,
   * then the button that spends it.
   */
  | { kind: "map" }
  | { kind: "create" }
  | { kind: "refresh" };
/**
 * There is deliberately no `back` row. Leaving is not one of the things this
 * list is FOR — the rows are matches to join and the two parameters a new one
 * would be started with — and a row that leaves has the wrong shape twice
 * over: it sits under a list whose length is whatever the servers happen to be
 * running, so the one control every visitor eventually wants is the one whose
 * position nothing can predict, and it wears the same highlight and the same
 * Enter as "join this match". It is a button in the footer instead
 * (`.ui-foot` / `.ui-back` in base.css), where the settings and kit screens
 * have always kept theirs.
 */

/** What the screen is doing, which decides what stands in for the list. */
type LobbyPhase =
  | { phase: "browsing" }
  /** A join is in flight. The list stays up so the chosen row is still read. */
  | { phase: "joining"; regionId: string; matchId: string };

/**
 * Label and hint for each action row.
 *
 * `create`'s hint is the one that is not a constant — it names the map the row
 * would start a match on, which is `fillRow`'s job because the answer is a
 * field. What is here is the fallback for a screen that has not been told one.
 */
const ACTION_LABELS: Record<"create" | "refresh", [string, string]> = {
  create: ["New match", "Start a fresh round"],
  refresh: ["Refresh", "Ask every server again"],
};

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

/**
 * A map's display name from its id.
 *
 * The server sends an id because that is what it is authoritative about; the
 * name is presentation and lives in the client's own table. An id this build has
 * never heard of falls through VERBATIM rather than being hidden — a server one
 * version ahead is exactly when a player most needs to see what is running — and
 * that fallback is why every row's text is assigned rather than interpolated.
 */
function mapName(id: string): string {
  return MAPS.find((m) => m.id === id)?.name ?? id;
}

/**
 * What a row says about a match, past the player count.
 *
 * `empty` is deliberately not shown as "empty": every match has sixteen bodies
 * in it whatever the roster says, so joining one is not joining an abandoned
 * server — it is taking a bot's place in a fight already happening. "Bots only"
 * is what is actually true, and it is an invitation rather than a warning.
 */
function stateLabel(match: MatchSummary): string {
  switch (match.state) {
    case "rotating":
      return "Changing map";
    case "empty":
      return "Bots only";
    case "live":
      return match.humans >= match.slots ? "Full" : "In progress";
  }
}

export class LobbyScreen {
  private root: HTMLElement;
  private rows: LobbyRow[] = [];
  private rowEls: HTMLElement[] = [];
  private index = 0;
  private state: LobbyPhase = { phase: "browsing" };

  /**
   * The regions to ask, in file order, and which one a new match goes in.
   *
   * Empty until `Game` has read the deploy-time list, which is the screen's
   * loading state and the reason `buildRows` can find nothing to draw: there is
   * a moment, once, where the client does not yet know what servers exist.
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
  /** Wired by Game: fetch every region's list again. */
  onRefresh: () => void = () => {};
  /** Wired by Game: leave the screen. */
  onClose: () => void = () => {};

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "lobby";
    // The shell's frame and its backdrop, carried permanently: this screen has
    // one card rather than four, so nothing here has to swap them the way
    // `OverlayScreen.setCardClass` does. `.hidden` is `!important` and wins
    // over the display the frame sets.
    this.root.className = "ui-screen ui-veil ui-solid hidden";
    document.getElementById("hud")!.appendChild(this.root);
  }

  show(): void {
    this.root.classList.remove("hidden");
    // Raised anew every time, and never on the row the list happens to start
    // with. Unlike the main menu there is nothing worth preserving across
    // visits — the rows themselves differ each time — but the row it OPENS on
    // matters for the same reason `MENU_DEFAULT` puts the menu's cursor on
    // Deploy rather than on Map: the screen is raised to do something, and the
    // first rows are pickers that would answer a blind Enter by cycling a map
    // or moving the player to another continent. The identity rule then keeps
    // the cursor here when the list lands under it.
    this.index = 0;
    this.state = { phase: "browsing" };
    // Every answer is stale by the time the screen is raised again — a match
    // that was there a minute ago is the exact row this screen must not show —
    // so the results are dropped and re-asked rather than shown while they are
    // re-asked. The region LIST is not: it is a deploy-time file `Game` reads
    // once, and clearing it here would flash an empty screen on every visit.
    this.results.clear();
    this.render();
    const create = this.rows.findIndex((r) => r.kind === "create");
    if (create >= 0) this.setIndex(create);
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  isOpen(): boolean {
    return !this.root.classList.contains("hidden");
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
    this.render();
  }

  /**
   * Which region a new match would be started in, as an index.
   *
   * Pushed in by `Game` after every pick, so the row and the game's own choice
   * cannot disagree — the same one-way shape `setMapChoice` has.
   */
  setRegionChoice(index: number): void {
    if (index === this.regionChoice) return;
    this.regionChoice = index;
    this.render();
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
    this.render();
  }

  /** A join is in flight; the screen stays up until the round replaces it. */
  setJoining(regionId: string, matchId: string): void {
    this.state = { phase: "joining", regionId, matchId };
    this.render();
  }

  /**
   * Which map a new match would be started on, as an index into `MAPS`.
   *
   * Pushed in by `Game` both when the screen opens and after every pick, so the
   * row and the game's own choice cannot disagree — the same one-way shape
   * `SettingsScreen.setValues` has.
   */
  setMapChoice(index: number): void {
    if (index === this.mapChoice) return;
    this.mapChoice = index;
    this.render();
  }

  /** The map row's selection. Index into `MAPS`; `Game` owns the value. */
  private mapChoice = 0;

  moveRow(delta: number): void {
    if (this.rows.length === 0) return;
    const n = this.rows.length;
    this.setIndex((this.index + delta + n) % n);
  }

  /** Fires the cursor's row — Enter / pad A / a click. */
  activate(): void {
    const row = this.rows[this.index];
    if (!row) return;
    // A join already in flight swallows further picks. Two `connect`s would
    // leave `Game.net` pointing at one session while another still holds a
    // socket — `joinMatch` guards on `this.net` and would drop the second on
    // the floor, which looks from here like a button that did nothing.
    if (this.state.phase === "joining") return;
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
      // there is no match here to enter, and the two things a player might
      // want next — Refresh, or starting one — are rows of their own.
      case "note":
        break;
      // The two PICKERS wrap on the confirm, where left/right clamps — the
      // same split the menu's map row keeps. A confirm that answers nothing is
      // the thing a list screen is rebuilt to remove, so the button always
      // moves the choice on.
      case "region":
        if (this.regions.length > 0) {
          this.onPickRegion((this.regionChoice + 1) % this.regions.length);
        }
        break;
      case "map":
        if (MAPS.length > 0) this.onPickMap((this.mapChoice + 1) % MAPS.length);
        break;
      case "create":
        this.onCreate();
        break;
      case "refresh":
        this.onRefresh();
        break;
    }
  }

  /**
   * Left/right on the cursor's row.
   *
   * Only the two picker rows have anything to step, and they CLAMP where the
   * confirm wraps. Every other row does one thing on Enter and deliberately
   * nothing on a horizontal nudge: a match row's map and region are that
   * match's, so there is nothing here for left and right to change.
   */
  stepRow(delta: number): void {
    // A join in flight swallows this for the reason `activate` states — the
    // screen is on its way out and the pick would be spent on nothing.
    if (this.state.phase === "joining") return;
    const kind = this.rows[this.index]?.kind;
    if (kind === "map") this.onPickMap(this.mapChoice + delta);
    else if (kind === "region") this.onPickRegion(this.regionChoice + delta);
  }

  /** Is the region column worth drawing at all? */
  private multi(): boolean {
    return this.regions.length > 1;
  }

  /**
   * The rows this list currently has.
   *
   * The actions are always present, even when every fetch failed — a server
   * that did not answer is the case where Refresh matters most. The two picker
   * rows are among them for the same reason: they are what a new match would
   * be started with, and creating one is exactly what a player does when the
   * list is empty. Leaving is not among them; that is the footer's, and the
   * reason is at the top of this file.
   *
   * Matches are grouped BY REGION in the order the file names them, rather than
   * sorted by ping or by how full they are. The file's order is a deployment's
   * own statement of which server it thinks of first, and a list that reordered
   * itself as pings came in would move a row out from under the cursor for
   * reasons the player cannot see.
   */
  private buildRows(): LobbyRow[] {
    const rows: LobbyRow[] = [];
    const multi = this.multi();
    for (const region of this.regions) {
      const result = this.results.get(region.id);
      if (!result) {
        // Only worth a line when there is another region whose answer it is
        // being told apart from. With one, the status line above already says
        // the screen is waiting.
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
          // to list — it is the number that says whether to start a match HERE,
          // which is the decision an empty region actually poses.
          ping: result.ping,
        });
      }
    }
    if (multi) rows.push({ kind: "region" });
    rows.push({ kind: "map" }, { kind: "create" }, { kind: "refresh" });
    return rows;
  }

  private render(): void {
    // The row the cursor is ON, captured before the list is rebuilt under it.
    const held = this.rows[this.index];
    this.rows = this.buildRows();
    // Kept by IDENTITY, not by index. A refresh inserts match rows ABOVE the
    // actions, so an index carried across one silently means a different row —
    // press Refresh, let a match appear, press Enter again and you have created
    // a match instead of refreshing, with the highlight having moved under your
    // hand to say so. With regions it is not even a refresh that does it: the
    // far server's rows land a moment after the near one's, under a cursor
    // nobody touched. Falling back to the clamp covers the row that genuinely
    // went away (a match that filled), which should leave the cursor near where
    // it was rather than at the top.
    const wanted = held ? this.rows.findIndex((r) => sameRow(r, held)) : -1;
    this.index =
      wanted >= 0
        ? wanted
        : Math.max(0, Math.min(this.index, this.rows.length - 1));

    // `.lb-panel` survives the move into the shell as the thing the rows'
    // grid templates are scoped to — `.multi` on it is what turns the
    // three-column screen into the five-column one, and hanging that off the
    // frame instead would put a layout decision about ROWS on the screen.
    this.root.innerHTML = `
      <div class="ui-head">
        <div class="ui-titles">
          <span class="ui-eyebrow">Online</span>
          <h2>Multiplayer</h2>
        </div>
        <div class="ui-meta">
          <span class="lb-status"></span>
          <span class="lb-ping"></span>
        </div>
      </div>
      <div class="ui-body solo">
        <div class="lb-panel${this.multi() ? " multi" : ""}">
          <div class="lb-body">
            ${this.rows.map((row, i) => this.rowMarkup(row, i)).join("")}
          </div>
        </div>
      </div>
      <p class="ui-foot">
        <span><kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd class="pad">Stick / D-pad</kbd> move</span>
        <span><kbd>&larr;</kbd><kbd>&rarr;</kbd> pick</span>
        <span><kbd>Enter</kbd><kbd class="pad">A</kbd> select</span>
        <button class="ui-back"><kbd>Esc</kbd><kbd class="pad">B</kbd> Back</button>
      </p>
    `;

    // Assigned, not interpolated. The subtitle carries a server-supplied error
    // string and a row carries a possibly-unknown map id, and `textContent` is
    // the whole of the defence — the same rule `HUD` states at the top of its
    // own file for the strings it writes every frame.
    const sub = this.root.querySelector<HTMLElement>(".lb-status");
    if (sub) sub.textContent = this.subtitle();
    this.fillPing();

    // `Array.from`, not a spread: the root tsconfig's `lib` has DOM but not
    // DOM.Iterable, so a `NodeListOf` is not statically iterable here.
    this.rowEls = Array.from(
      this.root.querySelectorAll<HTMLElement>("[data-row]"),
    );
    this.rowEls.forEach((el, i) => {
      this.fillRow(el, this.rows[i]);
      // Hover moves the cursor, so the highlighted row and the one Enter will
      // fire can never disagree — the rule every list-shaped screen keeps.
      el.onmouseenter = () => this.setIndex(i);
      el.onpointerdown = () => {
        this.setIndex(i);
        // A row that PICKS rather than fires takes its clicks on the buttons
        // inside it, which is the same split the main menu keeps: its map and
        // difficulty rows are ordinary clicks and everything that LEAVES a
        // screen is a pointerdown. Firing a picker row here as well would cycle
        // the choice on the way down and then set the clicked one on the way
        // up, which lands in the right place by luck and flickers getting
        // there.
        const kind = this.rows[i]?.kind;
        if (kind !== "map" && kind !== "region") this.activate();
      };
    });
    // Bound after the rows, so a click on a picker button is not also the
    // row's. `onclick` (mouse-UP) is what the menu's own map buttons use, and
    // the row above deliberately does not act on the DOWN edge under them.
    this.root.querySelectorAll<HTMLElement>("button[data-map]").forEach((btn) => {
      btn.onclick = () => this.onPickMap(Number(btn.dataset.map));
    });
    this.root.querySelectorAll<HTMLElement>("button[data-region]").forEach((btn) => {
      btn.onclick = () => this.onPickRegion(Number(btn.dataset.region));
    });
    // The way out, in the footer rather than in the list — see the note on
    // `LobbyRow`. Rebound on every render because this screen rebuilds its
    // markup wholesale, unlike the other two, whose footers are written once
    // in the constructor. `click` and not pointerdown, the same edge their
    // Back buttons take: this screen is already up, so there is no mouse-down
    // confirm underneath for it to race.
    const back = this.root.querySelector<HTMLElement>("button.ui-back");
    if (back) back.onclick = () => this.onClose();
    this.applySelection();
  }

  /** The text cells of a row, all assigned rather than interpolated. */
  private fillRow(el: HTMLElement, row: LobbyRow): void {
    const name = el.querySelector<HTMLElement>(".lb-id");
    if (!name) return;
    // The two picker rows' middle cell is their buttons. The map's were written
    // by `rowMarkup` from this build's own table, but a REGION's name came out
    // of a file over HTTP, so it is filled in here like every other such string.
    if (row.kind === "map") {
      name.textContent = "Map";
      return;
    }
    if (row.kind === "region") {
      name.textContent = "Region";
      el.querySelectorAll<HTMLElement>("button[data-region]").forEach((btn) => {
        const region = this.regions[Number(btn.dataset.region)];
        if (!region) return;
        const label = btn.querySelector<HTMLElement>(".lb-rn");
        if (label) label.textContent = region.name;
        this.fillLatency(btn.querySelector<HTMLElement>(".lb-lat"), this.pingOf(region.id));
      });
      return;
    }
    const state = el.querySelector<HTMLElement>(".lb-state");
    if (!state) return;
    if (row.kind === "match" || row.kind === "note") {
      // Which server this row is on. Only present in the markup when there is
      // more than one region, so this is a no-op on a single-server deployment.
      const region = el.querySelector<HTMLElement>(".lb-region");
      if (region) region.textContent = row.region.name;
    }
    if (row.kind === "match") {
      name.textContent = mapName(row.match.mapId);
      state.textContent = stateLabel(row.match);
      this.fillLatency(el.querySelector<HTMLElement>(".lb-lat"), this.pingOf(row.region.id));
      return;
    }
    if (row.kind === "note") {
      name.textContent = row.text;
      state.textContent = "";
      this.fillLatency(el.querySelector<HTMLElement>(".lb-lat"), row.ping);
      return;
    }
    const [label, hint] = ACTION_LABELS[row.kind];
    name.textContent = label;
    // The one hint that is not a constant: the row states which map it would
    // start a match on, so the choice above is visibly what this button spends.
    // `MAPS` is this build's own table, but it reaches the DOM through
    // `textContent` like every other cell here.
    const map = MAPS[this.mapChoice];
    state.textContent = row.kind === "create" && map ? `${hint} on ${map.name}` : hint;
    // WHICH SERVER it would start it on goes in the region column rather than
    // into that sentence, because the column already means exactly that and a
    // hint carrying both names is a line long enough to wrap the row onto two.
    // The create row is the one action that is about a particular server, so it
    // is the one action with anything in that cell.
    if (row.kind === "create" && this.multi()) {
      const cell = el.querySelector<HTMLElement>(".lb-region");
      const chosen = this.regions[this.regionChoice];
      if (cell && chosen) cell.textContent = chosen.name;
    }
  }

  /** What a region's last answer measured, or -1 if it has none. */
  private pingOf(regionId: string): number {
    const result = this.results.get(regionId);
    return result?.ok ? result.ping : -1;
  }

  /** One latency cell: the number, and the band its colour comes from. */
  private fillLatency(el: HTMLElement | null, ping: number): void {
    if (!el) return;
    el.className = `lb-lat ${pingQuality(ping)}`;
    // An em dash rather than a blank, unlike the status line's reading: this
    // cell sits in a column of numbers being compared, and a hole in it reads
    // as a measurement nobody took — which is exactly what it is.
    el.textContent = pingText(ping);
  }

  /** The line under the title: what happened, or what is running. */
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
    // is the column's job, and saying it twice would leave the two to disagree
    // as answers land.
    if (this.results.size < this.regions.length) return "Looking for matches…";
    const answered = [...this.results.values()].filter((r) => r.ok);
    if (answered.length === 0) return "Could not reach any match server.";
    const n = answered.reduce((sum, r) => sum + (r.ok ? r.list.matches.length : 0), 0);
    const where = `${answered.length} region${answered.length === 1 ? "" : "s"}`;
    if (n === 0) return `No matches running in ${where} — start one.`;
    return `${n} match${n === 1 ? "" : "es"} in ${where}`;
  }

  /**
   * The round trip on the status line, which is the SINGLE-region form of the
   * ping column.
   *
   * With one server behind every row, one reading belongs to the screen rather
   * than to a row: the same number printed four times would read as though
   * picking a row picked a connection, when what a match row chooses is a round
   * on a machine the player has already reached. With more than one server that
   * argument inverts exactly — the number differs per row, choosing a row IS
   * choosing a connection, and the cell moves into the list where it can be
   * compared. So this line is empty in that case rather than picking one region
   * to speak for the rest.
   *
   * A fetch that failed also leaves it EMPTY rather than showing a zero or a
   * dash: the subtitle beside it is already saying the server did not answer,
   * and a second cell saying so in numbers is a reading nobody took.
   */
  private fillPing(): void {
    const el = this.root.querySelector<HTMLElement>(".ui-meta .lb-ping");
    if (!el) return;
    const ping = this.multi() || this.regions.length === 0 ? -1 : this.pingOf(this.regions[0].id);
    el.className = `lb-ping ${pingQuality(ping)}`;
    el.textContent = ping < 0 ? "" : `ping ${pingText(ping)} ms`;
  }

  private rowMarkup(row: LobbyRow, i: number): string {
    const sel = i === this.index ? " sel" : "";
    const multi = this.multi();
    // The region cell leads every row when there is a choice of server, and is
    // absent entirely when there is not — the grid template is declared per row
    // in CSS, so a screen with one region is the three-column screen it has
    // always been rather than a five-column one with two blanks in it.
    const region = multi ? `<span class="lb-region"></span>` : "";
    const lat = multi ? `<span class="lb-lat"></span>` : "";
    // The pickers: one button per choice, the chosen one lit, exactly the shape
    // the menu's Map row has. Map names are interpolated because they are THIS
    // build's own constants — the rule at the top of the file is about strings
    // that arrived over a network, and both a match's map id and a region's
    // name are filled in by `fillRow` like every other one.
    if (row.kind === "map" || row.kind === "region") {
      const buttons =
        row.kind === "map"
          ? MAPS.map(
              (m, n) =>
                `<button class="lb-pick${n === this.mapChoice ? " on" : ""}" data-map="${n}">${m.name}</button>`,
            ).join("")
          : this.regions
              .map(
                (_r, n) =>
                  `<button class="lb-pick${n === this.regionChoice ? " on" : ""}" data-region="${n}"><span class="lb-rn"></span><span class="lb-lat"></span></button>`,
              )
              .join("");
      // A picker's cells STOP at its buttons, where every other row carries the
      // count and the ping. Given only what is left between a region column and
      // a ping column, a row of choices wraps its labels onto two lines — so
      // the buttons take the rest of the row instead, and the trailing cells
      // are not emitted at all, because there is nothing a picker would put in
      // them. The three-column screen keeps its empty count cell: that row was
      // measured with it, and nothing about a second region should move it.
      return `<div class="lb-row lb-action lb-pickline${sel}" data-row="${i}">
          ${region}<span class="lb-id"></span><span class="lb-picks">${buttons}</span>
          ${multi ? "" : `<span class="lb-count"></span>`}
        </div>`;
    }
    if (row.kind === "note") {
      return `<div class="lb-row lb-note${sel}" data-row="${i}">
          ${region}<span class="lb-id"></span><span class="lb-state"></span>
          <span class="lb-count"></span>${lat}
        </div>`;
    }
    if (row.kind !== "match") {
      return `<div class="lb-row lb-action${sel}" data-row="${i}">
          ${region}<span class="lb-id"></span><span class="lb-state"></span>
          <span class="lb-count"></span>${lat}
        </div>`;
    }
    const full = row.match.humans >= row.match.slots;
    const busy =
      this.state.phase === "joining" &&
      this.state.matchId === row.match.id &&
      this.state.regionId === row.region.id;
    // The counts are numbers the server computed, so they are safe to
    // interpolate; the text cells next door are not, and are left empty for
    // `fillRow`.
    return `<div class="lb-row lb-match${sel}${full ? " full" : ""}${busy ? " busy" : ""}" data-row="${i}">
        ${region}<span class="lb-id"></span><span class="lb-state"></span>
        <span class="lb-count"><b>${row.match.humans}</b> / ${row.match.slots}</span>${lat}
      </div>`;
  }

  private setIndex(i: number): void {
    if (i === this.index) return;
    this.index = i;
    this.applySelection();
  }

  /** Paints the cursor onto rows that already exist, never by redrawing. */
  private applySelection(): void {
    this.rowEls.forEach((el, i) => el.classList.toggle("sel", i === this.index));
  }
}
