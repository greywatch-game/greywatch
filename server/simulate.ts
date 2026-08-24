/**
 * server/simulate.ts — Runs a whole Conquest round headlessly and prints what
 * happened. `npm run simulate [map] [difficulty] [rounds]`.
 *
 * This is the server's equivalent of playing a round, and it is the only way to
 * see the simulation on its own — no clients, no rendering, no wall clock. A
 * round that takes twelve minutes to play takes a few seconds here, which makes
 * it the practical tool for the questions that need a whole round to answer:
 * does the bake navigate, do bots find each other, does the bleed end a match.
 *
 * It is NOT a balance oracle. `CONFIG.conquest.tickets` is sized against real
 * play, and this runs with nobody in the fight — sixteen bots is not eight bots
 * and eight people. Read it for "did the round work", not for "is the round
 * fair".
 */
import { TICK_HZ } from "../src/net/protocol";
import { CONFIG } from "../src/config";
import { MAPS } from "../src/world/maps";
import { HeadlessGame } from "./HeadlessGame";

/** Give up rather than spin forever if a round somehow cannot end. */
const MAX_SIM_MINUTES = 45;

async function runRound(mapId: string, difficulty: number) {
  const def = MAPS.find((m) => m.id === mapId);
  if (!def) throw new Error(`no map "${mapId}" (have ${MAPS.map((m) => m.id).join(", ")})`);

  const game = new HeadlessGame();
  const captures: string[] = [];
  let blasts = 0;
  game.onExplosion = () => blasts++;
  // `onCapturedEvent` and NOT `conquest.onCaptured`, which is the simulation's
  // own and pays everybody standing on the flag: a callback has one owner, and
  // taking that one here would have quietly turned the capture awards off in
  // the one tool that exists to check them.
  game.onCapturedEvent = (point, by) => captures.push(`${point.def.id}->${by}`);
  // Every award paid, by kind. The cheapest check there is that the scoring
  // rules actually fire in a whole round: no `capture` line means the flags
  // paid nobody, and no `defend` line means the attack/defend split is not
  // being reached at all.
  const awards: Record<string, number> = {};
  game.scores.onAward = (_slot, kind) => {
    awards[kind] = (awards[kind] ?? 0) + 1;
  };

  const built = Date.now();
  await game.startRound(def, difficulty);
  const buildMs = Date.now() - built;

  const dt = 1 / TICK_HZ;
  const maxTicks = MAX_SIM_MINUTES * 60 * TICK_HZ;
  const started = Date.now();
  let ticks = 0;
  while (game.step(dt)) {
    if (++ticks > maxTicks) break;
  }
  const wallMs = Date.now() - started;

  const result = {
    map: def.name,
    difficulty,
    buildMs,
    wallMs,
    ticks,
    simSeconds: ticks / TICK_HZ,
    winner: game.conquest.winner,
    tickets: [...game.conquest.tickets] as [number, number],
    // Summed out of the per-slot board rather than kept alongside it — see
    // `HeadlessGame.teamScore`.
    kills: [game.teamScore(0).kills, game.teamScore(1).kills] as [number, number],
    losses: [game.teamScore(0).deaths, game.teamScore(1).deaths] as [number, number],
    // The board's third column, which a whole headless round is the cheapest
    // way to sanity-check: it should sit well above `kills * CONFIG.score.kill`
    // once the flags have been changing hands, and equal to it if the capture
    // awards have somehow stopped being paid.
    points: [game.teamScore(0).points, game.teamScore(1).points] as [number, number],
    /** Every award paid this round, by kind — what the points above are made of. */
    awards,
    captures: captures.length,
    blasts,
    flagsHeld: [game.conquest.flagsHeld(0), game.conquest.flagsHeld(1)] as [number, number],
  };
  game.dispose();
  return result;
}

const [mapId = "hollowmere", difficulty = "1", rounds = "1"] = process.argv.slice(2);

for (let i = 0; i < Number(rounds); i++) {
  const r = await runRound(mapId, Number(difficulty));
  const mins = (r.simSeconds / 60).toFixed(1);
  console.log(
    [
      `${r.map} (difficulty ${r.difficulty})`,
      `  world built in ${r.buildMs} ms`,
      `  round ran ${r.ticks} ticks = ${mins} min of game time in ${r.wallMs} ms of wall clock`,
      `  winner: ${r.winner === null ? "NONE (hit the cap)" : CONFIG.teams[r.winner].name}`,
      `  tickets: ${r.tickets[0]} / ${r.tickets[1]}`,
      `  kills:   ${r.kills[0]} / ${r.kills[1]}`,
      `  losses:  ${r.losses[0]} / ${r.losses[1]}`,
      `  score:   ${r.points[0]} / ${r.points[1]}`,
      `  awards:  ${Object.entries(r.awards)
        .map(([kind, n]) => `${kind} ${n}`)
        .join(", ")}`,
      `  flags held at the end: ${r.flagsHeld[0]} / ${r.flagsHeld[1]}`,
      `  flag captures during the round: ${r.captures}`,
      `  grenades detonated: ${r.blasts}`,
    ].join("\n"),
  );
}
