/**
 * net/regions.ts — Which match servers exist, and the two URLs each one is.
 * Owns: the deploy-time region list, the one fetch that reads it, and the
 * arithmetic that turns a region's HOST into the socket a client joins and the
 * HTTP origin its match list is fetched from. Owns no UI, no state and no
 * socket — it answers what there is to connect to and never connects.
 * Invariants: a resolved `Region` carries BOTH urls, built together in one
 * place. Nothing downstream may derive one from the other or hold a host of its
 * own, for the reason `Game` kept a single `netUrl` before there were regions:
 * browsing one server and joining another is a bug the moment it is
 * representable. `loadRegions` never rejects and never answers with an empty
 * list — a deployment with no regions file is a deployment with exactly one
 * region, which is the server behind this page's own origin.
 *
 * **The list is a deploy-time file rather than a table in this bundle**, and
 * that is the same rule `public/` already carries: a region's address is a fact
 * about where the game is hosted, not a constant about how it plays. A region
 * added, moved or drained is then one file on the box, not a rebuild of the
 * client — which matters most in the case that is worst to be slow about, an
 * unhealthy region that wants taking out of the list now.
 *
 * **The scheme is the PAGE's, never the file's.** An entry names an authority
 * (`us-east-1.example.com`, optionally with a port) and nothing else, so a file
 * cannot ask an https page to open a plain socket — the browser would refuse it
 * as mixed content anyway, and the failure would arrive as a socket that closes
 * with nothing in it rather than as anything a deployer could read.
 */
import { CONFIG } from "../config";

/** Where the deploy-time list lives. Same origin, always: it is a static file
 * beside `index.html`, unhashed and named by hand, which is why nginx and the
 * service worker both have to be told not to cache it. */
const REGIONS_URL = "/regions.json";

/**
 * How long to wait for the list, in ms. The same budget the match list itself
 * gets and for the same reason: this is a menu, the file is a few hundred
 * bytes off the game's own origin, and anything past a second is a network
 * that is not going to answer.
 */
const LOAD_TIMEOUT_MS = 4000;

/**
 * How many regions the client will carry, however many the file names.
 *
 * The lobby fans out one request per region on every refresh, so the length of
 * this list is the cost of opening that screen. The cap is not a policy about
 * how big a deployment may get — it is what keeps a typo in a hand-edited file
 * from turning one keypress into a hundred requests.
 */
const MAX_REGIONS = 8;

/**
 * One region as the deploy-time file states it.
 *
 * `host` is an AUTHORITY — `us-east-1.example.com`, or `host:port` — and never
 * a URL: the scheme comes from the page and the two paths are this module's.
 * Absent means the server behind this page's own origin, which is what a
 * single-box deployment is and what every client did before regions existed.
 */
export interface RegionSpec {
  /** Stable id, remembered as the player's pick. Never shown. */
  id: string;
  /** What the lobby calls it. Shown in a narrow column, so keep it short. */
  name: string;
  /** Authority of the match server. Absent = this page's origin. */
  host?: string;
}

/** A region with its two URLs already resolved. What the rest of the game holds. */
export interface Region {
  id: string;
  name: string;
  /** Where `GET /matches` lives. */
  listUrl: string;
  /** Where the socket opens. */
  socketUrl: string;
}

/** The scheme pair this page may talk in: secure page, secure server. */
function schemes(): { http: string; ws: string } {
  return location.protocol === "https:"
    ? { http: "https:", ws: "wss:" }
    : { http: "http:", ws: "ws:" };
}

/**
 * The region every deployment has: whatever is answering `/ws` and `/matches`
 * on the origin this page was served from.
 *
 * It is the fallback for a missing or unreadable file, and it is deliberately
 * the SAME shape as a named one rather than a null case threaded through the
 * lobby — a client with no regions file browses and joins exactly as it did
 * before this module existed, through one code path rather than beside it.
 */
export function originRegion(id = "local", name = "This server"): Region {
  return {
    id,
    name,
    listUrl: `${location.origin}/matches`,
    // The configured relative path, which `Connection` resolves against the
    // page — the deployed case nginx's `/ws` proxy answers.
    socketUrl: CONFIG.net.url,
  };
}

/**
 * Anything in a `host` that means it is not one.
 *
 * A path, a query, a fragment, a scheme (which brings the slashes with it), any
 * whitespace — and `@`, which is the one that matters: `evil.example.com@real`
 * is a URL whose authority is `real` and whose look is `evil`, and an entry
 * shaped like that is not a typo. A backslash is here because browsers treat it
 * as a slash when parsing.
 *
 * A character test rather than parsing and comparing the result back, which was
 * the first version: `new URL("https://x.example:443/")` normalises the default
 * port away, so a deployer who wrote one out would have watched their region
 * quietly not appear.
 */
const NOT_A_HOST = /[\s/?#@\\]/;

/**
 * A region built from one entry, or null if the entry cannot be used.
 *
 * Dropped rather than half-honoured, and dropped QUIETLY: this file is read on
 * a player's machine and the person who can fix it is not there. What a bad
 * entry costs is its own row; the rest of the list still works, and a file with
 * nothing usable in it falls back to the origin like a file that is not there.
 */
function resolve(spec: RegionSpec): Region | null {
  const id = typeof spec?.id === "string" ? spec.id.trim() : "";
  const name = typeof spec?.name === "string" ? spec.name.trim() : "";
  if (!id || !name) return null;
  const host = typeof spec.host === "string" ? spec.host.trim() : "";
  if (!host) return originRegion(id, name);
  if (NOT_A_HOST.test(host)) return null;
  const { http, ws } = schemes();
  try {
    // The parse is the rest of the validation — an unbracketed IPv6 address, a
    // port that is not a number, an empty label: all of them throw here.
    const list = new URL(`${http}//${host}/matches`);
    return { id, name, listUrl: list.href, socketUrl: `${ws}//${host}/ws` };
  } catch {
    return null;
  }
}

/**
 * A region for a socket URL somebody named outright — `?server=` and `?mp=`.
 *
 * The list's path is REPLACED rather than derived from the socket's by string
 * surgery, because those two are proxied independently and only agree by
 * convention; naming both means a server that moves its socket does not
 * silently take its lobby with it. A relative value means this page's own
 * origin, which is what a deployed build already speaks.
 */
export function regionFromSocketUrl(url: string, id = "dev", name = "Dev server"): Region {
  if (!/^wss?:\/\//.test(url)) return { ...originRegion(id, name), socketUrl: url };
  const parsed = new URL(url);
  const http = parsed.protocol === "wss:" ? "https:" : "http:";
  return { id, name, listUrl: `${http}//${parsed.host}/matches`, socketUrl: url };
}

/**
 * Reads the deploy-time list, and always answers with at least one region.
 *
 * Every failure — no file, a proxy answering `index.html` with a 200, a file
 * somebody left half-edited — lands on the same fallback rather than on an
 * error the lobby would have to render: a client that cannot read the list is
 * in exactly the position every client was in before there was one, and the
 * server behind its own origin is the honest answer for it. A region list is
 * not a thing a player asked for and not a thing they can fix.
 *
 * Duplicate ids are dropped rather than merged. The id is what a pick is
 * remembered as and what a match row is qualified by, so two of them is a
 * lobby where the same row means two servers.
 */
export async function loadRegions(): Promise<Region[]> {
  try {
    const res = await fetch(REGIONS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
    });
    if (!res.ok) return [originRegion()];
    const body = (await res.json()) as { regions?: RegionSpec[] };
    const specs = body?.regions;
    if (!Array.isArray(specs)) return [originRegion()];
    const seen = new Set<string>();
    const regions: Region[] = [];
    for (const spec of specs) {
      if (regions.length >= MAX_REGIONS) break;
      const region = resolve(spec);
      if (!region || seen.has(region.id)) continue;
      seen.add(region.id);
      regions.push(region);
    }
    return regions.length > 0 ? regions : [originRegion()];
  } catch {
    return [originRegion()];
  }
}
