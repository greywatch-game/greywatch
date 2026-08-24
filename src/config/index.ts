/**
 * config/index.ts — the composed `CONFIG`, and the only thing that imports the
 * sections.
 * Owns: nothing of its own. It is the spine: every tunable lives in a section
 * module beside this one, and this file is how they are read as one object.
 * Invariant: ALL gameplay/balance tunables live in this directory. No gameplay
 * magic numbers elsewhere; art/geometry constants stay in their model file.
 * Gotcha: `as const` gives fields literal types — `let x = CONFIG.bots.x` then
 * reassigning fails to compile. Annotate `let x: number` instead.
 * Gotcha: each section is `as const` in its own file AND spread readonly here,
 * so the composed type is identical to the single-file version it replaced.
 * Keep the per-value comments: they record why a number is what it is.
 */

import { conquest } from "./conquest";
import { score } from "./score";
import { bots, nav } from "./bots";
import { player } from "./player";
import { weapons, combat, gunfeel } from "./weapons";
import { recoil } from "./recoil";
import { sights } from "./sights";
import { viewmodel } from "./viewmodel";
import { glass } from "./glass";
import { grenade } from "./grenade";
import { camera } from "./camera";
import { aimAssist } from "./aimAssist";
import { input, rumble } from "./input";
import { touch } from "./touch";
import { audio } from "./audio";
import { graphics, effects } from "./graphics";
import { minimap, damageIndicator } from "./hud";
import { net } from "./net";
import { lighting } from "./lighting";
import { ao, map, water, grass } from "./world";
import { sky, godRays } from "./sky";
import { wind } from "./wind";
import { teams } from "./teams";

export { FOG_WALL } from "./fogWall";

export const CONFIG = {
  ao,
  conquest,
  score,
  bots,
  nav,
  map,
  player,
  weapons,
  combat,
  recoil,
  gunfeel,
  glass,
  grenade,
  camera,
  sights,
  viewmodel,
  aimAssist,
  input,
  rumble,
  touch,
  audio,
  effects,
  graphics,
  minimap,
  damageIndicator,
  net,
  lighting,
  water,
  grass,
  wind,
  sky,
  godRays,
  teams,
} as const;
