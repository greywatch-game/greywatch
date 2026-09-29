// Photographs one interface screen at a fixed set of viewports, for the device
// in hand, and optionally walks it through a list of steps with a picture (and
// a printed result) after each — how the main menu and the kit screen were
// judged (SKILL.md, "Photograph it at every viewport").
//
// usage:
//   node .claude/skills/ui-screen/scripts/shoot.mjs --out <dir> [--tag before]
//     [--screen menu|kit|settings|lobby|deploy|kit-deploy|pause]   default menu
//     [--views all|phones|desk|844x390,1920x1080,...]            default all
//     [--pad]                also shoot each state with the PAD's prompts
//     [--steps steps.json]   [{ "name": "optic", "js": "g.loadoutScreen.moveSlot(1)" }]
//                            each `js` is a function body run in the page with
//                            `g` (the game), `wait` and `until` in scope; a
//                            returned value is printed as JSON; optional
//                            "settle" ms before the picture (default 600)
//     [--map <index>]        which map the menu has chosen before opening
//
// Files land as <out>/<tag>-<screen>-<view>[-<step>][-pad].png. Needs a GPU —
// the kit's weapon and the menu's photograph are the scene — so read
// VERIFYING.md for this machine first. Write --out to the scratchpad, never
// the repo.
import { readFileSync, mkdirSync } from "node:fs";
import { cli, eachView, run, setDevice } from "./lib.mjs";

const { opt, has } = cli();
const OUT = opt("out");
if (!OUT) {
  console.error("usage: shoot.mjs --out <dir> [--tag t] [--screen s] [--views v] [--pad] [--steps f] [--map i]");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const tag = opt("tag", "shot");
const screen = opt("screen", "menu");
const STEPS = opt("steps") ? JSON.parse(readFileSync(opt("steps"), "utf8")) : [];

await eachView({ screen, viewSpec: opt("views", "all"), map: opt("map") }, async (page, [name, , , touch]) => {
  const base = `${OUT}/${tag}-${screen}-${name}`;
  const shoot = async (suffix) => {
    await page.screenshot({ path: `${base}${suffix}.png` });
    if (has("pad")) {
      await setDevice(page, "pad");
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${base}${suffix}-pad.png` });
      await setDevice(page, touch ? "touch" : "kbm");
    }
  };
  await shoot("");
  for (const step of STEPS) {
    const result = await run(page, step.js);
    if (result !== undefined) console.log(`[${name}] ${step.name}:`, JSON.stringify(result));
    await page.waitForTimeout(step.settle ?? 600);
    await shoot(`-${step.name}`);
  }
  console.log("shot", name);
});
