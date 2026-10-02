// Draw a map's layout as a plan: the floor shaded by height with a contour
// every metre, the water, the carriageways as the network lays them, every
// kit footprint with a tick on its front door, the flags' rings, the
// spawns and (optionally) the scatter regions. The one picture that shows
// whether a place makes SENSE — doors to streets, streets that join, a village
// that reads as one — before anything is photographed.
//
// usage:
//   node .claude/skills/map-layout/scripts/plan.mjs <map> --out <file.png>
//     [--px 1400]          image size
//     [--box x0,z0,x1,z1]  draw only this part of the map (a district, close up)
//     [--scatter]          outline the scatter regions too
//
// Reads layout.ts and heights.ts as they are on disk. No GPU: it draws on a 2D
// canvas in a plain headless Chromium and saves the canvas.
//
// How to read it: yellow ticks are front doors (a door pointing at a wall or a
// field is the thing to fix); burnt buildings are drawn dark; kinds with no
// footprint entry (the city, desert, harbour and temple kits) are grey squares
// with their name's first letters; flags are green rings at their true radius;
// Valeguard spawns gold, Redline red, flag spawns pale blue; the dotted lines
// are the metre contours, so bunched dots are a slope.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BUILDINGS, FOOT, corners, frontOf, rotate } from "./footprints.mjs";
import { ROOT, loadMap } from "./load.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? d : args[i + 1];
};
const id = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out" && args[args.indexOf(a) - 1] !== "--px" && args[args.indexOf(a) - 1] !== "--box");
const outFile = opt("out");
if (!id || !outFile) {
  console.error("usage: plan.mjs <map> --out <file.png> [--px 1400] [--box x0,z0,x1,z1] [--scatter]");
  process.exit(1);
}
const PX = Number(opt("px", 1400));
const m = await loadMap(id);
const { layout, field, half, floorAt, wet, onRoadAt } = m;
const [bx0, bz0, bx1, bz1] = opt("box") ? opt("box").split(",").map(Number) : [-half, -half, half, half];
const span = Math.max(bx1 - bx0, bz1 - bz0);
const S = PX / span;

// Rasterise the floor, the water and the roads here, where the game's own
// network code is loaded; the page only paints.
const step = Math.max(0.5, span / 700);
const cols = Math.ceil((bx1 - bx0) / step);
const rows = Math.ceil((bz1 - bz0) / step);
let lo = Infinity;
let hi = -Infinity;
const H = new Float32Array(cols * rows);
const K = new Uint8Array(cols * rows); // 0 ground, 1 water, 2 road
for (let j = 0; j < rows; j++) {
  for (let i = 0; i < cols; i++) {
    const x = bx0 + (i + 0.5) * step;
    const z = bz1 - (j + 0.5) * step;
    const h = floorAt(x, z);
    H[j * cols + i] = h;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
    K[j * cols + i] = onRoadAt(x, z) ? 2 : wet(x, z) ? 1 : 0;
  }
}

const COL = {
  cottage: "#b08c64", townhouse: "#be7a5a", tavern: "#dca03c", smithy: "#9696a0", chapel: "#c8c8dc",
  barn: "#a04632", mill: "#78a0c8", ruin: "#6e5a50", silo: "#969696", watchtower: "#8c6e46",
  gatehouse: "#e63c3c", shed: "#826e50", boathouse: "#5a7870", stoneWall: "#7a7a6e", fence: "#96785a",
  bridge: "#b4966e", jetty: "#a08262", kiln: "#b4643c", lamp: "#ffd060",
  tower: "#8a94a6", office: "#5e86b4", shophouse: "#c08a6a", depot: "#8a7a5e", parkade: "#7a8a8a",
  monument: "#d8d8d0", quay: "#9a9a92", lighthouse: "#f0f0e8", crane: "#c0603a", netLoft: "#6a5a46",
  car: "#405060", streetLight: "#ffd060", planter: "#5a7a4a", barrier: "#a0a098",
};
const shapes = [];
for (const p of layout.placements) {
  if (p.kind === "road") continue;
  const c = corners(p);
  const burnt = p.kind === "ruin" || (p.params?.ruined && p.kind !== "cart");
  if (c) {
    let tick = null;
    if (BUILDINGS.has(p.kind) && !["silo", "gatehouse", "watchtower"].includes(p.kind)) {
      const [z0, sign] = frontOf(p);
      const [ax, az] = rotate(0, z0, p.rotY ?? 0);
      const [fx, fz] = rotate(0, 2.5 * sign, p.rotY ?? 0);
      tick = [p.x + ax, p.z + az, p.x + ax + fx, p.z + az + fz];
    }
    shapes.push({ c, col: COL[p.kind] ?? "#c8c878", burnt, tick, lamp: p.kind === "lamp" });
  } else {
    shapes.push({ unknown: p.kind.slice(0, 3), x: p.x, z: p.z });
  }
}
const scatter = args.includes("--scatter") ? layout.scatter.filter((s) => Math.abs(s.x) < half + 20 && Math.abs(s.z) < half + 20) : [];

const { chromium } = await import(pathToFileURL(join(ROOT, "node_modules/playwright/index.mjs")).href);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const png = await page.evaluate(
    ({ PX, S, bx0, bz1, step, cols, rows, H, K, lo, hi, shapes, flags, spawns, scatter }) => {
      const cv = document.createElement("canvas");
      cv.width = PX;
      cv.height = PX;
      const g = cv.getContext("2d");
      const P = (x, z) => [(x - bx0) * S, (bz1 - z) * S];
      g.fillStyle = "#202420";
      g.fillRect(0, 0, PX, PX);
      const cell = step * S;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i;
          const t = (H[k] - lo) / Math.max(1e-6, hi - lo);
          g.fillStyle =
            K[k] === 1 ? "#1e4678" : K[k] === 2 ? "#8a8272" : `rgb(${30 + 110 * t | 0},${36 + 96 * t | 0},${30 + 64 * t | 0})`;
          g.fillRect(i * cell, j * cell, cell + 0.6, cell + 0.6);
          // A contour dot wherever a whole metre is crossed.
          if (i + 1 < cols && Math.floor(H[k]) !== Math.floor(H[k + 1])) {
            g.fillStyle = "rgba(230,230,190,0.55)";
            g.fillRect((i + 1) * cell - 0.5, j * cell, 1.2, cell);
          }
          if (j + 1 < rows && Math.floor(H[k]) !== Math.floor(H[k + cols])) {
            g.fillStyle = "rgba(230,230,190,0.55)";
            g.fillRect(i * cell, (j + 1) * cell - 0.5, cell, 1.2);
          }
        }
      }
      for (const s of scatter) {
        g.strokeStyle = s.blocking ? "rgba(120,170,100,0.5)" : "rgba(160,160,120,0.35)";
        g.lineWidth = 1;
        if (s.radius !== undefined) {
          const [x, y] = P(s.x, s.z);
          g.beginPath();
          g.arc(x, y, s.radius * S, 0, Math.PI * 2);
          g.stroke();
        } else {
          const [x, y] = P(s.x - s.width / 2, s.z + s.depth / 2);
          g.strokeRect(x, y, s.width * S, s.depth * S);
        }
      }
      for (const sh of shapes) {
        if (sh.unknown) {
          const [x, y] = P(sh.x, sh.z);
          g.fillStyle = "#9a9a9a";
          g.fillRect(x - 3, y - 3, 6, 6);
          g.fillStyle = "#dddddd";
          g.font = "9px sans-serif";
          g.fillText(sh.unknown, x + 4, y - 3);
          continue;
        }
        g.beginPath();
        sh.c.forEach(([x, z], n) => {
          const [px, py] = P(x, z);
          if (n) g.lineTo(px, py);
          else g.moveTo(px, py);
        });
        g.closePath();
        let col = sh.col;
        if (sh.burnt) col = col.replace(/[0-9a-f]{2}/gi, (h) => Math.round(parseInt(h, 16) * 0.5).toString(16).padStart(2, "0"));
        g.fillStyle = col;
        g.fill();
        g.strokeStyle = "#111";
        g.lineWidth = 1;
        g.stroke();
        if (sh.tick) {
          const [a, b] = P(sh.tick[0], sh.tick[1]);
          const [c, d] = P(sh.tick[2], sh.tick[3]);
          g.strokeStyle = "#ffe600";
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(a, b);
          g.lineTo(c, d);
          g.stroke();
        }
      }
      for (const f of flags) {
        const [x, y] = P(f.x, f.z);
        g.strokeStyle = "#50ffa0";
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(x, y, f.r * S, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = "#50ffa0";
        g.font = "bold 14px sans-serif";
        g.fillText(f.id, x - 4, y + 5);
      }
      for (const s of spawns) {
        const [x, y] = P(s.x, s.z);
        g.fillStyle = s.team === 0 ? "#e6be5a" : s.team === 1 ? "#ff4040" : "#c8d2ff";
        g.beginPath();
        g.arc(x, y, 3.5, 0, Math.PI * 2);
        g.fill();
      }
      return cv.toDataURL("image/png");
    },
    {
      PX, S, bx0, bz1, step, cols, rows, H: Array.from(H), K: Array.from(K), lo, hi, shapes, scatter,
      flags: layout.controlPoints.map((c) => ({ id: c.id, x: c.pos.x, z: c.pos.z, r: c.radius })),
      spawns: layout.spawns.map((s) => ({ team: s.team, x: s.pos.x, z: s.pos.z })),
    },
  );
  writeFileSync(outFile, Buffer.from(png.split(",")[1], "base64"));
  console.log(`${id}: ${PX}px plan of x ${bx0}..${bx1}, z ${bz0}..${bz1} (floor ${lo.toFixed(1)}..${hi.toFixed(1)} m, field ${field.size}x${field.cell} m) -> ${outFile}`);
} finally {
  await browser.close();
}
