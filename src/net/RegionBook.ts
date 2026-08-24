/**
 * net/RegionBook.ts — Which server this client browses and joins, and the one
 * read of the list behind both.
 * Owns: the region list once it has been read, the promise that reads it, the
 * player's remembered pick, the client's automatic pick for a player who has
 * never made one, the newest round trip each region reported, and a server
 * named outright on the URL. Owns no UI, no socket and no storage — it answers
 * WHICH SERVER and never connects, never draws and never persists.
 * Invariants: `resolve` is the one way anything gets a region to spend, which
 * is what keeps "the row I am reading" and "the server I am joining" the same
 * machine. The player's pick and the client's are separate fields and never
 * merge — a measurement is not a decision, so `note` may move the second and
 * may never touch the first. Nothing here reaches `core/prefs`: the remembered
 * pick is handed in at construction and handed back out of `choose`, because
 * remembering is that module's job and applying it is `Game`'s, and a `net/`
 * module that imported `core/` would be the first edge of its kind in here.
 * Never: fetch a region list twice (`ensure` is the shared promise), answer
 * with an empty list (`loadRegions` cannot — see it), or move a pick the
 * player has made.
 */
import { loadRegions, regionFromSocketUrl, type Region } from "./regions";

/** What `choose` hands back: the pick to remember, and the row to light up. */
export interface RegionPick {
  id: string;
  index: number;
}

export class RegionBook {
  /**
   * Which match servers exist, in the order the deployment names them.
   *
   * Read once from `public/regions.json` (see `regions.ts`) and never
   * refetched: a region list is a fact about the deployment, not about the
   * fight, and a client that re-read it between two refreshes could move a row
   * out from under a cursor for a reason nobody on this machine caused. Empty
   * until that read lands, which is the only moment the game does not know what
   * servers there are — every reader goes through `resolve`, which is why
   * nothing else has to hold an opinion about that moment.
   *
   * A region carries BOTH its urls, resolved together. Letting the list and the
   * socket be aimed separately would make "browsing one server and joining
   * another" representable, which is not a thing anybody wants and is a bug the
   * moment it happens by accident.
   */
  private regions: Region[] = [];

  /**
   * The one read of the region file, kept so the second asker joins the first.
   *
   * `?mp` and the lobby can both want it on the same frame, and a promise here
   * rather than a flag means the second one waits on the same fetch instead of
   * making another — the same reason a texture cache holds the promise and not
   * just the texture.
   */
  private load: Promise<Region[]> | null = null;

  /**
   * Which region the player CHOSE, or null if they never have.
   *
   * Null is the interesting value: it is what lets the fastest region that
   * answers be preselected on every visit to the lobby, which is the whole of
   * the "pick the right one" problem for a player who has not thought about it.
   * The moment they step the region row it becomes their pick, is remembered,
   * and is never moved for them again — `note` is the one place that
   * distinction is spent.
   *
   * An id and not an index, because the file it indexes can be re-ordered
   * under a remembered value and an index would then mean a different server.
   */
  private chosenId: string | null;

  /**
   * The region the client picked FOR a player who never has: whichever answered
   * fastest. Not persisted, and overruled by `chosenId` the instant there is
   * one — see `note`.
   */
  private autoId: string | null = null;

  /**
   * The newest round trip each region reported, kept only to rank them.
   *
   * The lobby draws its own numbers out of the results it was handed; this is
   * the copy the auto-pick compares, and it lives here because the pick does.
   */
  private readonly pings = new Map<string, number>();

  /**
   * A server named outright on the URL, which REPLACES the region list.
   *
   * `?server=` and `?mp=<url>` are dev affordances that point this client at
   * one specific process, and a region picker offering alternatives to a
   * developer who has already named the server they want is noise — so this is
   * not one region among the file's, it is all of them.
   */
  private devRegion: Region | null = null;

  /** @param chosenId the player's remembered pick, or null if they have none. */
  constructor(chosenId: string | null) {
    this.chosenId = chosenId;
  }

  /** The list as last read. Empty before `ensure` has landed. */
  get list(): readonly Region[] {
    return this.regions;
  }

  /** Whether the URL named a server, which is what makes the list a formality. */
  get hasDev(): boolean {
    return this.devRegion !== null;
  }

  /**
   * Point this client at one named process, from `?server=` or `?mp=<url>`.
   * Replaces the list rather than joining it, for the reason `devRegion` states.
   */
  nameDev(socketUrl: string): void {
    this.devRegion = regionFromSocketUrl(socketUrl);
  }

  /**
   * The region list, read once and shared by everything that needs it.
   *
   * A promise field rather than an array plus a flag: the lobby and a `?mp`
   * join can both ask before either answer has landed, and two reads of one
   * static file is one more than the deployment deserves. It cannot fail — see
   * `loadRegions`, which answers a broken or missing file with the one region
   * every deployment has — so nothing downstream has an error case for "we do
   * not know what servers exist".
   */
  async ensure(): Promise<Region[]> {
    // A server named on the URL is the whole list, so there is nothing to read
    // and nothing to wait for. Assigned rather than just returned, so that
    // `this.regions` is always exactly what the lobby was handed.
    if (this.devRegion) {
      this.regions = [this.devRegion];
      return this.regions;
    }
    if (!this.load) {
      this.load = loadRegions().then((regions) => {
        this.regions = regions;
        return regions;
      });
    }
    return this.load;
  }

  /**
   * The region a join should go to: the one named, else the standing choice.
   *
   * Every socket and every list in the game comes through here, which is what
   * keeps "the row I am reading" and "the server I am joining" the same
   * machine. The fallbacks are ordered by how specific the answer is — a row's
   * own region, then the player's remembered pick, then the first region the
   * deployment names — and the last of those is what a client that has not yet
   * read the file gets, which is exactly the same-origin server it would have
   * had before regions existed.
   */
  resolve(regionId?: string): Region | null {
    if (this.devRegion) return this.devRegion;
    if (regionId) {
      const named = this.regions.find((r) => r.id === regionId);
      if (named) return named;
    }
    const wanted = this.chosenId ?? this.autoId;
    const chosen = wanted ? this.regions.find((r) => r.id === wanted) : undefined;
    return chosen ?? this.regions[0] ?? null;
  }

  /**
   * Where the standing choice sits in the list, for a screen drawing a row.
   *
   * Zero when there is no answer yet, which is the same row `resolve`'s last
   * fallback would hand back — the two must not disagree, or the lobby would
   * highlight one region and join another.
   */
  selectedIndex(): number {
    const standing = this.resolve();
    return standing ? Math.max(0, this.regions.indexOf(standing)) : 0;
  }

  /**
   * The player PICKING a region: the lobby's Region row.
   *
   * The mirror of `Game.setMap` one screen over, and it is remembered for the
   * same reason — it is a choice about how the game is played rather than a
   * fact about a match. What it is NOT is a thing a match can change: joining a
   * row in another region plays there without moving this pick, because the
   * pick is where a match this client CREATES would go and a round somebody
   * else started says nothing about that.
   *
   * Hands the pick back rather than writing it, so the one place that knows
   * what remembering means is still `core/prefs` and the one place that spends
   * it is still `Game`. Null when nothing moved, which is what keeps a repeated
   * press off the storage.
   */
  choose(index: number): RegionPick | null {
    const n = this.regions.length;
    if (n === 0) return null;
    const next = index < 0 ? 0 : index >= n ? n - 1 : index;
    if (this.regions[next].id === this.chosenId) return null;
    this.chosenId = this.regions[next].id;
    return { id: this.chosenId, index: next };
  }

  /**
   * A region answered; move the standing choice if the player has never made
   * one. Hands back the row to light up, or null if nothing moved.
   *
   * **This is the whole of "choose the right region for me".** A player who has
   * never touched the row is put in whichever server answered fastest, and one
   * who has picked is never moved — which is why `chosenId` is null rather than
   * defaulted, and why this is the only writer that does not persist. Being
   * seated somewhere by a measurement is not a decision to remember; it is a
   * measurement, and the next visit takes it again.
   *
   * It runs per answer rather than after all of them, so the near server is
   * already selected while the far one is still being waited for. That can move
   * the highlight once, a few milliseconds in, on a row nobody is looking at
   * yet — the screen opens with the cursor on New match, and a player who
   * reaches the region row has by definition arrived after its answers did.
   */
  note(region: Region, ping: number): number | null {
    // Overwritten rather than cleared per refresh, which is what keeps a
    // Refresh from passing through a moment where only one region has answered
    // and is therefore the fastest one. The readings a player is comparing are
    // always the newest each server gave.
    this.pings.set(region.id, ping);
    if (this.chosenId !== null) return null;
    let best: Region | null = null;
    let bestPing = Infinity;
    for (const candidate of this.regions) {
      const measured = this.pings.get(candidate.id);
      if (measured !== undefined && measured < bestPing) {
        bestPing = measured;
        best = candidate;
      }
    }
    if (!best || best.id === this.autoId) return null;
    // Deliberately not `choose`: this is not a pick, so it is not written to
    // storage and it does not stop a later answer moving it again.
    this.autoId = best.id;
    return this.regions.indexOf(best);
  }
}
