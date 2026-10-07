/**
 * Scoreboard.ts — The Tab board: the standing, held over the round.
 * Owns: `#scoreboard` and everything under it — the frame (the two
 * reinforcement counts facing each other as its title, the margin, each side's
 * facts) and the two sides' lists. Styling is `scoreboard.css`, imported here.
 *
 * **It is a SCREEN on `#hud`, not gameplay chrome**, which is why it is not
 * `HUD`'s. `Game.pushScoreboard` pushes it from `tick` in every state with a
 * round behind it — playing, the death cam and the deploy screen — so its
 * lifetime is the ROUND's (`ScreenSpec.inRound`), where the HUD's chrome is
 * the living, armed player's. It is built after `HUD`, whose constructor
 * writes `#hud.innerHTML`, and before every other screen.
 *
 * Invariants:
 *  - **Pushed, never asked.** `set` is called on every frame of a round; while
 *    the board is down it returns after one comparison, and while it is up the
 *    standing and the lists each have a key, so the DOM hears a CHANGE and not
 *    a frame. The keys are values LAST WRITTEN, never a second copy of game
 *    state, and the raise clears both so the first frame up always writes.
 *  - **A name is a STRANGER'S STRING.** Every row is built with
 *    `createElement` and `textContent`; nothing a player typed is ever parsed
 *    as markup here. The server bounds a name's length; nothing bounds what is
 *    in it.
 *  - **Your side is the LEFT column**, whichever team the authority seated you
 *    on — `rows.playerTeam` decides, and the board never reads a team index
 *    as a place.
 *  - It reads no game system: `Game.scoreRows` builds the rows and
 *    `Game.pushScoreboard` sums the team totals from them, and this file only
 *    sorts and prints.
 *  - **Its `z-index` (9, `scoreboard.css`) is what puts it over the deploy
 *    screen**, which appends itself later and takes the default; DOM order
 *    alone would bury the board on the one screen it is most read over.
 */
import "./scoreboard.css";
import { pingQuality, pingText } from "./ping";

/**
 * Bodies in the round above which the scoreboard lays each side's list out
 * two-up instead of as one column.
 *
 * 24 is chosen against the rosters that exist rather than against a pixel
 * count: five maps field sixteen, and Sarab's and Cinderhaven's forty-eight are
 * the only rosters on the far side of it. They field forty-eight in a MATCH
 * too (`setFielded`), so a deep board can carry the ping column, and
 * `scoreboard.css` takes the deaths and then the place off a deep line to keep
 * a name readable beside it.
 */
const DEEP_ROSTER = 24;

/** The Tab board's frame, looked up once when it is built. */
interface ScoreboardParts {
  eyebrow: HTMLElement;
  /** Left (the player's own side) and right, never team 0 and team 1. */
  sides: {
    team: HTMLElement;
    tickets: HTMLElement;
    flags: HTMLElement;
    score: HTMLElement;
    kills: HTMLElement;
  }[];
  margin: HTMLElement;
  split: [HTMLElement, HTMLElement];
  /** The box each side's lists are rebuilt into. */
  lists: [HTMLElement, HTMLElement];
}

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
 * The standing, as the board draws it. Assembled by `Game.pushScoreboard`, and
 * only while the board is actually up.
 */
export interface ScoreboardView {
  /** What is being played on — passed in, never named here. */
  map: string;
  teams: readonly string[];
  tickets: readonly number[];
  flags: readonly number[];
  /** How many flags the map has, which the held counts are read against. */
  flagCount: number;
  kills: readonly number[];
  /** Team totals, summed from the rows by the caller like the one above. */
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
}

/** The Tab board. See the header. */
export class Scoreboard {
  private readonly root: HTMLElement;
  /** The board's standing parts, built once — see `build`. */
  private readonly sb: ScoreboardParts;
  /**
   * LAST-WRITTEN VALUES, as `HUD`'s gauges keep them: whether the board is up,
   * the standing's key and the lists' key. The two keys are cleared on the
   * raise, in the same branch that replays the entrance.
   */
  private lastVisible = false;
  private lastHead = "";
  private lastKey = "";

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "scoreboard";
    this.root.className = "hidden";
    this.sb = this.build();
    document.getElementById("hud")!.appendChild(this.root);
  }

  /**
   * The Tab board: a title screen for the STANDING, held over the round.
   *
   * **The title is the two reinforcement counts facing each other**, in the
   * colours of the sides that own them, across the margin between them drawn
   * as the round-over card draws it — because that is the question a player
   * holding Tab is asking, and it is the one thing on the board that says
   * whether the round is being won. Under it each side's list is the
   * round-over card's board, line for line: a place, the side's mark down the
   * leading edge, the name, kills, deaths and the points it is ranked by, the
   * player's own line picked out hot. The card that ends the round shows the
   * top of this board, and the two are one drawing so a player learns it once.
   *
   * The FRAME is built once (`build`) and patched by text; the lists are
   * rebuilt as markup, and they are KEYED — see below.
   */
  set(visible: boolean, rows?: ScoreboardView): void {
    if (visible !== this.lastVisible) {
      this.lastVisible = visible;
      this.root.classList.toggle("hidden", !visible);
      // Force both writes below on the frame it comes up, whatever the numbers
      // were when it was last down — and replay the entrance, which is keyed
      // to the RAISE and never to a patch.
      this.lastHead = "";
      this.lastKey = "";
      if (visible) {
        this.root.classList.remove("enter");
        void this.root.offsetWidth;
        this.root.classList.add("enter");
      }
    }
    if (!visible || !rows) return;
    const sides = [rows.playerTeam, 1 - rows.playerTeam];
    const head =
      `${rows.map}|${rows.playerTeam}|${rows.teams}|${rows.tickets}|` +
      `${rows.flags}|${rows.flagCount}|${rows.kills}|${rows.score}|${rows.rows.length}`;
    if (head !== this.lastHead) {
      this.lastHead = head;
      this.patchScoreHead(rows, sides);
    }
    // THE ONE MARKUP REBUILD, AND IT IS KEYED.
    //
    // Tab is a HELD key, so `Game.updateHud` calls this on every frame the
    // board is up — and this method used to answer by tearing down and
    // reparsing the whole panel sixty times a second for as long as a player
    // looked at it. The key is what makes it a rebuild per CHANGE.
    //
    // The rows are in it whole: a kill anywhere on the roster moves one of
    // their numbers and reorders the column it is in, and a board that redraws
    // only when the TOTALS move would sit there showing the wrong order for the
    // rest of the round every time two people traded.
    //
    // The pings are in it too, which is a rebuild about once a second for as
    // long as Tab is held — the cadence the authority measures them on, and the
    // same cost as a kill landing. A column left out of the key would be a
    // column frozen at whatever it read when somebody last died.
    const key =
      `${rows.playerTeam}|${rows.teams}|${rows.pings}|` +
      rows.rows
        .map(
          (r) =>
            `${r.name}:${r.team}:${r.score}:${r.kills}:${r.deaths}:${r.ping}`,
        )
        .join(",");
    if (key === this.lastKey) return;
    this.lastKey = key;
    // The column's width lives in CSS, so whether there IS one is a class on
    // the panel rather than a template branch per row.
    this.root.classList.toggle("pinged", rows.pings);
    // A DEEP roster is laid out two-up inside each side's column rather than as
    // one list twice as long.
    //
    // The board draws every body in the round and not only the people in it, so
    // its height is the ROSTER's — eight a side is a panel a player reads at a
    // glance and twenty-four a side is off the bottom of every short viewport
    // the game runs on. `MapLayout.perTeam` is what made that reachable.
    //
    // Two LISTS rather than one list flowed into CSS columns: the side is
    // SORTED, so it is split in rank order — the top half down the left, the
    // rest down the right, each read downward — and each list carries its own
    // heading, so the right-hand one is never a column of unlabelled figures.
    const deep = rows.rows.length > DEEP_ROSTER;
    this.root.classList.toggle("deep", deep);
    // Your side on the left, always — the board is read from where you are
    // standing, and a column that swaps ends with the team you were seated
    // onto is one a player has to find before they can read it.
    for (let i = 0; i < sides.length; i++) {
      const team = sides[i];
      const lists = this.sb.lists[i];
      // Sorted by SCORE, then by kills, then by the fewer deaths. Score first
      // because it is what the board is for: the player who has been taking
      // flags outranks the one who has been shooting people away from them,
      // which is the whole reason there is a column beside the kills. `sort`
      // is stable, so bodies level on all three keep roster order and a row
      // does not jitter between two places while a player is looking at it.
      const side = rows.rows
        .filter((r) => r.team === team)
        .sort(
          (a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths,
        );
      const per = deep ? Math.ceil(side.length / 2) : side.length;
      const parts = deep ? [side.slice(0, per), side.slice(per)] : [side];
      const built: HTMLElement[] = [];
      for (let p = 0; p < parts.length; p++) {
        const list = document.createElement("ol");
        list.className = "sb-list";
        list.appendChild(
          this.scoreHeading(p === 0 ? rows.teams[team] : "", rows.pings),
        );
        for (let j = 0; j < parts[p].length; j++) {
          list.appendChild(
            this.scoreRow(parts[p][j], p * per + j + 1, rows.pings),
          );
        }
        built.push(list);
      }
      lists.replaceChildren(...built);
    }
  }

  /**
   * The board's frame, built once and never rewritten: the eyebrow, the two
   * sides facing each other across the margin, and a box per side that the
   * lists are rebuilt into. Everything in it is a number or a name out of
   * `CONFIG`, and it is still written by `textContent` below, so nothing a
   * player typed is ever parsed as markup here.
   */
  private build(): ScoreboardParts {
    const side = (which: "mine" | "theirs") => `
      <div class="sb-side ${which}">
        <span class="sb-team"></span>
        <b class="sb-n"></b>
        <span class="sb-facts"><span><b></b> flags</span><span><b></b> pts</span><span><b></b> kills</span></span>
      </div>`;
    this.root.innerHTML = `
      <div class="sb-in">
        <header class="sb-hero">
          <span class="sb-eyebrow"></span>
          <div class="sb-face">
            ${side("mine")}
            <div class="sb-mid">
              <b class="sb-margin"></b>
              <div class="sb-split"><i class="mine"></i><i class="theirs"></i></div>
              <span class="sb-mcap">Reinforcements</span>
            </div>
            ${side("theirs")}
          </div>
        </header>
        <div class="sb-teams">
          <section class="sb-col mine"></section>
          <section class="sb-col theirs"></section>
        </div>
      </div>
    `;
    const q = (sel: string) => this.root.querySelector(sel) as HTMLElement;
    const sideParts = (which: string) => {
      const el = q(`.sb-side.${which}`);
      const facts = el.querySelectorAll<HTMLElement>(".sb-facts b");
      return {
        team: el.querySelector(".sb-team") as HTMLElement,
        tickets: el.querySelector(".sb-n") as HTMLElement,
        flags: facts[0],
        score: facts[1],
        kills: facts[2],
      };
    };
    return {
      eyebrow: q(".sb-eyebrow"),
      sides: [sideParts("mine"), sideParts("theirs")],
      margin: q(".sb-margin"),
      split: [q(".sb-split .mine"), q(".sb-split .theirs")],
      lists: [q(".sb-col.mine"), q(".sb-col.theirs")],
    };
  }

  /** Writes the standing into the frame: the eyebrow, both sides, the margin. */
  private patchScoreHead(
    rows: ScoreboardView,
    sides: readonly number[],
  ): void {
    let per = 0;
    for (const team of sides) {
      let n = 0;
      for (const r of rows.rows) if (r.team === team) n++;
      per = Math.max(per, n);
    }
    this.sb.eyebrow.textContent = `Conquest · ${rows.map} · ${per} v ${per}`;
    for (let i = 0; i < sides.length; i++) {
      const t = sides[i];
      const parts = this.sb.sides[i];
      parts.team.textContent = rows.teams[t];
      parts.tickets.textContent = String(rows.tickets[t]);
      parts.flags.textContent = `${rows.flags[t]}/${rows.flagCount}`;
      parts.score.textContent = String(rows.score[t]);
      parts.kills.textContent = String(rows.kills[t]);
    }
    // The bar is the two counts against each other rather than against the
    // pool, as the round-over card draws it: the HUD's own gauge over the top
    // of the screen already says how far each side has fallen, and what the
    // board adds is who is AHEAD, which is the margin.
    const mine = Math.max(0, rows.tickets[sides[0]]);
    const theirs = Math.max(0, rows.tickets[sides[1]]);
    const total = Math.max(1, mine + theirs);
    this.sb.split[0].style.flexGrow = (mine / total).toFixed(4);
    this.sb.split[1].style.flexGrow = (theirs / total).toFixed(4);
    const margin = mine - theirs;
    this.sb.margin.textContent =
      margin === 0 ? "Even" : `${margin > 0 ? "+" : "−"}${Math.abs(margin)}`;
    this.sb.margin.className = `sb-margin ${margin > 0 ? "up" : margin < 0 ? "down" : ""}`;
  }

  /** The heading over one list — the side's name over the first, blank over a second. */
  private scoreHeading(team: string, pings: boolean): HTMLElement {
    const el = document.createElement("li");
    el.className = "head";
    const rk = document.createElement("span");
    rk.className = "rk";
    rk.textContent = "#";
    const name = document.createElement("b");
    name.className = "nm";
    name.textContent = team;
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = "K";
    const d = document.createElement("span");
    d.className = "d";
    d.textContent = "D";
    const s = document.createElement("span");
    s.className = "pts";
    s.textContent = "Pts";
    el.append(rk, document.createElement("i"), name, k, d, s);
    if (pings) {
      const ms = document.createElement("span");
      ms.textContent = "Ms";
      el.append(ms);
    }
    return el;
  }

  /**
   * One body's line, laid out as the round-over card lays its board.
   *
   * Built rather than interpolated, and that is a rule and not a preference:
   * `name` is a string another player typed on a machine this one has never
   * met, so it reaches the document through `textContent` — the same way every
   * other screen in the game writes one. The server bounds its length; nothing
   * bounds its contents.
   */
  private scoreRow(r: ScoreRow, place: number, pings: boolean): HTMLElement {
    const el = document.createElement("li");
    if (r.you) el.className = "you";
    const rk = document.createElement("span");
    rk.className = "rk";
    rk.textContent = String(place);
    const name = document.createElement("b");
    name.className = "nm";
    name.textContent = r.name;
    const kills = document.createElement("span");
    kills.className = "k";
    kills.textContent = String(r.kills);
    const deaths = document.createElement("span");
    deaths.className = "d";
    deaths.textContent = String(r.deaths);
    const score = document.createElement("span");
    score.className = "pts";
    score.textContent = String(r.score);
    el.append(rk, document.createElement("i"), name, kills, deaths, score);
    // The connection behind the row, in the band that says how bad it is. A
    // bot's is an em dash rather than a zero — it has no connection at all, and
    // a zero would read as the best one on the board. Both the number and the
    // band come from `ui/ping.ts`, which the lobby's reading also goes through.
    if (pings) {
      const ping = document.createElement("span");
      ping.className = `ms ${pingQuality(r.ping)}`;
      ping.textContent = pingText(r.ping);
      el.append(ping);
    }
    return el;
  }

}
