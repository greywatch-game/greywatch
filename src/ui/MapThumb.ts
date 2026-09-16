/**
 * MapThumb.ts — The top-down schematic of a map for the menu's dossier, drawn
 * from a map's own DATA rather than from a built world.
 * Owns: the projection into the panel's canvas, the fetch-and-upgrade order,
 * and the flags and home gates over the plan. The plan itself is
 * `mapPlan.ts`'s and the look is `mapPaint.ts`'s — this file is what turns a
 * `MapDef` into the one and hands it to the other.
 * Invariants: it touches no scene, no `MapBuilder` and no `GameMap`. What it
 * reads is the layout (a module constant, in the bundle before the player
 * pressed anything) and the two BULK halves behind `MapDef`'s lazy imports,
 * both of which it takes as ARGUMENTS rather than going and getting: the
 * schematic draws whatever it is handed, and `OverlayScreen.paintThumb` — which
 * is what knows a row is under the cursor and is allowed to wait — asks again
 * when each half lands.
 *
 * That restriction is the whole reason this file can exist. The deploy screen
 * and the minimap draw out of the finished collider set, which is the honest
 * way to draw a map you are standing in — the two can never disagree — but it
 * needs a BUILT map, and the main menu is the one screen in the game where
 * there is no such thing: on a cold boot nothing has been built yet, and
 * building one to illustrate a row costs the ~0.7 s the building card exists
 * to cover.
 *
 * **It is nonetheless the SAME DRAWING as those two now, and that is what
 * changed here.** It used to plot a placement as a square, because a
 * `Placement` is a point and a kit name and the footprint is the builder's —
 * so the menu said "there is something here" where the deploy map said what
 * shape it was, and a player learned the village twice. The collider BAKE is
 * the shape, it is already generated for the authority (`MapDef.collision`),
 * and it is behind an `import()` exactly as the floor is. So the schematic
 * arrives in up to three passes — level and bare, then the relief, then the
 * town — and every one of them is a smaller version of the plan the deploy
 * screen will draw of the same place. Drawing a coarse map for a moment and
 * then the real one is the honest order; drawing nothing until two fetches
 * return would put a hole in the menu.
 */
import { CONFIG } from "../config";
import {
  paintFlagIcon,
  paintPlan,
  paintZone,
  px,
  py,
  type PlanView,
} from "./mapPaint";
import { planFromLayout } from "./mapPlan";
import type { MapCollision } from "../world/collision";
import type { Heightfield } from "../world/layout";
import type { MapDef } from "../world/maps";

/**
 * Paints one map into a canvas, filling it edge to edge.
 *
 * The canvas's backing store is sized here from its CSS box and the device
 * pixel ratio: this is a schematic of straight lines and 1 px rules, and a
 * canvas left at its attribute size and stretched by CSS is the one thing on
 * these screens that would come out visibly soft.
 */
export function drawMapThumb(
  canvas: HTMLCanvasElement,
  def: MapDef,
  floor: Heightfield | null,
  bake: MapCollision | null,
): void {
  const box = canvas.getBoundingClientRect();
  if (box.width < 4 || box.height < 4) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(box.width * dpr);
  const h = Math.round(box.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const plan = planFromLayout(def.layout, def.environment, floor, bake);
  // The map is square and the panel it sits in is not, so it is fitted rather
  // than stretched: one scale for both axes, centred on whatever is left.
  const scale = Math.min(w, h) / plan.size;
  const side = plan.size * scale;
  const view: PlanView = {
    scale,
    ox: (w - side) / 2 + side / 2,
    oy: (h - side) / 2 + side / 2,
  };
  // A grid of LINES rather than of letters: the dossier's panel is 220 px on
  // a phone and ~380 on a laptop, so a lettered grid there is either
  // unreadable or the loudest thing on a drawing whose job is to say what
  // shape the place is. The deploy screen, which is the whole window, letters
  // its own.
  paintPlan(ctx, plan, view, {
    bounds: { x: (w - side) / 2, y: (h - side) / 2, w: side, h: side },
    grid: "lines",
  });
  drawSpawns(ctx, def, view);
  drawFlags(ctx, def, view);
}

/**
 * The two home spawn lines, in the colours the sides are WORN in.
 *
 * Indexed ABSOLUTELY and deliberately, where a body in the world goes through
 * `core/teamView.ts`: this card is a map rather than a round, drawn before
 * there is an authority to seat anybody, and the player it is drawn for is the
 * amber side of every match they will ever join.
 *
 * Home spawns only — the ones with a team. Every control point carries a spawn
 * of its own, and drawing those puts a second mark inside each flag ring
 * saying nothing the ring does not.
 */
function drawSpawns(
  ctx: CanvasRenderingContext2D,
  def: MapDef,
  view: PlanView,
): void {
  for (const sp of def.layout.spawns) {
    if (sp.team === null || sp.team === undefined) continue;
    const color = CONFIG.teams[sp.team]?.color ?? "#ffffff";
    const x = px(view, sp.pos.x);
    const y = py(view, sp.pos.z);
    const r = Math.max(2.6, 2 * view.scale);
    // A diamond, which is what the minimap's prerendered gates are: a spawn is
    // a place you arrive, and the one mark on any of these three maps that is
    // neither a round shape (a zone) nor a hexagon (a flag).
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.2;
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * The control points: the zone at its real capture radius, and the hexagon.
 *
 * The radius is the layout's own, so the zones are to scale with everything
 * else — which is the one fact on this thumbnail a player can act on, since
 * how far apart the flags are is most of what a Conquest map IS. Nobody owns
 * anything on a menu, so every one of them is drawn neutral: this is the map,
 * not a round on it.
 */
function drawFlags(
  ctx: CanvasRenderingContext2D,
  def: MapDef,
  view: PlanView,
): void {
  const r = Math.max(6, Math.min(11, 90 * view.scale));
  for (const cp of def.layout.controlPoints) {
    const x = px(view, cp.pos.x);
    const y = py(view, cp.pos.z);
    paintZone(ctx, x, y, Math.max(r * 0.9, cp.radius * view.scale), NEUTRAL);
    paintFlagIcon(ctx, x, y, r, NEUTRAL, cp.id);
  }
}

/** `--neutral` in `base.css`: nobody's, which is every flag on a menu. */
const NEUTRAL = "#aeb6c2";
