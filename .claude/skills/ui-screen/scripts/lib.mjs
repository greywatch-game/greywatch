// What shoot.mjs and audit.mjs share: the viewport set, how each screen is
// reached from a booted page, and a page-side runner. One copy, for the reason
// scripts/browser.mjs is one copy — two lists of viewports drift.
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const { launchClient } = await import(pathToFileURL(join(ROOT, "scripts/browser.mjs")).href);
const { startDevServer } = await import(pathToFileURL(join(ROOT, "scripts/dev-server.mjs")).href);

export function cli() {
  const args = process.argv.slice(2);
  return {
    opt: (k, d) => {
      const i = args.indexOf(`--${k}`);
      return i < 0 ? d : args[i + 1];
    },
    has: (k) => args.includes(`--${k}`),
  };
}

// [name, width, height, touch]. Phones are LANDSCAPE — the game asks for it
// everywhere it can; the upright phone is there to prove nothing BREAKS.
export const ALL_VIEWS = [
  ["667x375", 667, 375, true], // small phone, sideways
  ["844x390", 844, 390, true], // common phone, sideways
  ["932x430", 932, 430, true], // large phone, sideways
  ["1024x768", 1024, 768, true], // tablet
  ["1180x820", 1180, 820, true], // tablet, where a third column runs out
  ["1280x720", 1280, 720, false], // small laptop
  ["1920x1080", 1920, 1080, false], // the unit's reference (`--u` = 1px)
  ["3440x1440", 3440, 1440, false], // ultrawide, near the 2.4:1 cap
  ["390x844", 390, 844, true], // upright phone: a fallback, not a layout
];
const SETS = {
  all: ALL_VIEWS.map((v) => v[0]),
  phones: ["667x375", "844x390", "932x430", "390x844"],
  desk: ["1280x720", "1920x1080", "3440x1440"],
};
export function views(spec = "all") {
  return (SETS[spec] ?? spec.split(",")).map((name) => {
    const known = ALL_VIEWS.find((v) => v[0] === name);
    if (known) return known;
    const [w, h] = name.split("x").map(Number);
    return [name, w, h, false];
  });
}

// How each screen is reached from a booted page, and its root element. Every
// opener is a private method in TypeScript and an ordinary property in the
// page. The round-based ones wait for `deploy`, which is when the build and
// its reflection bake are through. A new screen is one row here.
export const SCREENS = {
  menu: { open: "", root: "#overlay" },
  kit: { open: "g.openLoadout();", root: "#loadout" },
  settings: { open: "g.openSettings();", root: "#settings" },
  lobby: { open: "g.openLobby();", root: "#lobby" },
  deploy: { open: "g.startRound(); await until(() => g.state === 'deploy');", root: "#deploy" },
  "kit-deploy": {
    open: "g.startRound(); await until(() => g.state === 'deploy'); g.openLoadout();",
    root: "#loadout",
  },
  // The building card is up for well under a second on most maps, so it is
  // RAISED here rather than reached: the step and the card, with no build
  // behind them, which holds it still for as long as a picture takes.
  building: { open: "g.go('loading'); g.overlayScreen.showBuilding(g.buildingCard());", root: "#overlay" },
  // A round ENDED rather than played out: the player is spawned, a few rows
  // of the board are paid so it has something to rank, and the enemy's
  // tickets are taken to nothing — the offline card, with its Another round.
  roundover: {
    open:
      "g.startRound(); await until(() => g.state === 'deploy'); g.spawnPlayer(); await wait(300);" +
      " const s = g.battle.playerSlot; for (let i = 0; i < 6; i++) g.scores.award(s, 'kill');" +
      " for (let i = 0; i < 9; i++) g.scores.award((i * 5) % g.battle.bots.length, 'kill');" +
      " g.scores.registerDeath(s); g.scores.registerDeath(s);" +
      " g.conquest.tickets[1 - g.player.team] = 0; g.endRound(g.player.team);",
    root: "#overlay",
  },
  pause: {
    open: "g.startRound(); await until(() => g.state === 'deploy'); g.spawnPlayer(); await wait(300); g.pause();",
    root: "#overlay",
  },
  // The Tab board over a live round, held rather than pressed: `scoreboard` is
  // recomputed from the keys every frame, so the instance property is replaced
  // by one that always reads held. A few rows are paid so the sort has
  // something to order. `--map 4` (Sarab) is the deep, two-up roster.
  scoreboard: {
    open:
      "g.startRound(); await until(() => g.state === 'deploy'); g.spawnPlayer(); await wait(300);" +
      " const s = g.battle.playerSlot; for (let i = 0; i < 5; i++) g.scores.award(s, 'kill');" +
      " for (let i = 0; i < 14; i++) g.scores.award((i * 5) % g.battle.bots.length, 'kill');" +
      " g.scores.registerDeath(s);" +
      " Object.defineProperty(g.input, 'scoreboard', { get: () => true, set() {}, configurable: true });",
    root: "#scoreboard",
  },
  // The same board over the DEPLOY screen, which is where a player waiting
  // out a reinforcement clock reads it.
  "scoreboard-deploy": {
    open:
      "g.startRound(); await until(() => g.state === 'deploy');" +
      " Object.defineProperty(g.input, 'scoreboard', { get: () => true, set() {}, configurable: true });",
    root: "#scoreboard",
  },
  // A MATCH's board, faked offline: the ping column forced on, a spread of
  // readings and dashes, and two names at `MAX_NAME_LENGTH` — the width a
  // stranger's name can actually take.
  "scoreboard-net": {
    open:
      "g.startRound(); await until(() => g.state === 'deploy'); g.spawnPlayer(); await wait(300);" +
      " const s = g.battle.playerSlot; for (let i = 0; i < 5; i++) g.scores.award(s, 'kill');" +
      " for (let i = 0; i < 14; i++) g.scores.award((i * 5) % g.battle.bots.length, 'kill');" +
      " const f = g.hud.setScoreboard.bind(g.hud);" +
      " g.hud.setScoreboard = (v, r) => f(v, r && { ...r, pings: true, rows: r.rows.map((x, i) => ({ ...x," +
      "   name: i === 3 ? 'WWWWWWWWWWWWWWWWWWWW' : i === 12 ? 'The_Longest_Callsign' : x.name," +
      "   ping: i % 4 === 0 ? -1 : [28, 64, 131, 212][i % 4] })) });" +
      " Object.defineProperty(g.input, 'scoreboard', { get: () => true, set() {}, configurable: true });",
    root: "#scoreboard",
  },
};

/** Runs a snippet in the page with `g` (the game), `wait` and `until` in scope. */
export function run(page, body) {
  return page.evaluate(async (src) => {
    const g = window.__celshock;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (f, ms = 60000) => {
      const t0 = performance.now();
      while (!f()) {
        if (performance.now() - t0 > ms) throw new Error("until: timed out");
        await wait(50);
      }
    };
    const fn = new Function("g", "wait", "until", `return (async () => { ${src} })();`);
    return fn(g, wait, until);
  }, body);
}

/**
 * Every screen that draws per-device prompts has `setInputDevice`; this finds
 * them all rather than naming them, so a third one needs no change here.
 */
export function setDevice(page, device) {
  return run(
    page,
    `for (const v of Object.values(g)) if (v && typeof v.setInputDevice === "function") v.setInputDevice(${JSON.stringify(device)});`,
  );
}

/**
 * Boots a dev server and a GPU Chromium, calls `each(page, view)` once per
 * viewport with the screen already open, and tears both down whatever happens.
 */
export async function eachView({ screen, viewSpec, map }, each) {
  if (!(screen in SCREENS)) {
    throw new Error(`unknown screen ${screen}; one of ${Object.keys(SCREENS).join(", ")}`);
  }
  const server = await startDevServer(ROOT);
  const browser = await launchClient();
  try {
    for (const view of views(viewSpec)) {
      const [name, w, h, touch] = view;
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        hasTouch: touch,
        isMobile: touch && Math.min(w, h) < 500,
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.log(`[${name}] pageerror`, e.message));
      await page.goto(server.url);
      await page.waitForFunction(() => window.__celshock, null, { timeout: 90000 });
      await page.waitForTimeout(2500);
      if (map !== undefined) await run(page, `g.setMap(${Number(map)}); g.showMenu();`);
      await run(page, SCREENS[screen].open);
      // Long enough for an entrance to finish (the menu's and the kit's run
      // about 0.9 s) and for the kit's lamps to arrive a frame after the open.
      await page.waitForTimeout(1600);
      await each(page, view);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }
}
