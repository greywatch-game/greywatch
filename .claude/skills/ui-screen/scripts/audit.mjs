// Audits one interface screen at a fixed set of viewports for the four
// failures a screenshot hides or a reviewer skims past (SKILL.md, "Audit it"):
//
//   DEAD    a control the POINTER cannot reach — `#hud` is `pointer-events:
//           none`, so a control that did not opt back in is clickable by
//           nothing, while the pad and the keyboard (which never touch the
//           DOM) drive it perfectly. Also catches a control painted over by
//           another element.
//   SMALL   a control under 44 px on a TOUCH viewport — a warning, not a
//           failure: a swatch in a grid of sixteen may be a considered 32.
//   CLIPPED text cut by an ellipsis, a line clamp or an overflow — the name
//           a player needed, turned into "ASSAULT RIF…".
//   OFF     a control outside the glass that is not inside a scroller (a
//           scroller's cards are allowed off its edge; that is what it is for).
//
// usage:
//   node .claude/skills/ui-screen/scripts/audit.mjs
//     [--screen menu|kit|settings|lobby|deploy|kit-deploy|pause|building|roundover]   default menu
//     [--views all|phones|desk|844x390,...]                      default all
//     [--js "g.loadoutScreen.moveSlot(1)"]   a snippet to run before auditing
//     [--map <index>]
//
// Exit code 1 when any view has a DEAD or OFF control. Needs a GPU, like
// shoot.mjs — VERIFYING.md first.
import { cli, eachView, run, SCREENS } from "./lib.mjs";

const { opt } = cli();
const screen = opt("screen", "menu");
let failed = false;

await eachView({ screen, viewSpec: opt("views", "all"), map: opt("map") }, async (page, [name, , , touch]) => {
  if (opt("js")) {
    await run(page, opt("js"));
    await page.waitForTimeout(600);
  }
  const report = await page.evaluate(
    ({ rootSel, touch }) => {
      const root = document.querySelector(rootSel);
      if (!root) return { error: `no ${rootSel}` };
      const label = (el) =>
        (el.getAttribute("aria-label") || el.title || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) ||
        `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
      const tagOf = (el) =>
        el ? `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.classList.length ? "." + [...el.classList].join(".") : ""}` : "nothing";
      const shown = (el) => {
        if (!el.getClientRects().length) return false;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") return false;
        // Faded out on purpose (the menu's slim reel cards carry their name
        // at opacity 0 until they open): not a thing a player can read.
        for (let p = el; p && p !== root.parentElement; p = p.parentElement) {
          if (getComputedStyle(p).opacity === "0") return false;
        }
        return true;
      };
      const scroller = (el) => {
        for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) return p;
        }
        return null;
      };
      const out = { dead: [], small: [], clipped: [], off: [] };
      const W = innerWidth;
      const H = innerHeight;
      for (const el of root.querySelectorAll("button, a[href], input, select, [role=button]")) {
        if (!shown(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const box = scroller(el)?.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (box && (cx < box.left || cx > box.right || cy < box.top || cy > box.bottom)) continue;
        if (!box && (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1)) {
          out.off.push(`${label(el)} @ ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
          continue;
        }
        const hit = document.elementFromPoint(Math.min(W - 1, Math.max(0, cx)), Math.min(H - 1, Math.max(0, cy)));
        if (!hit || !(hit === el || el.contains(hit))) out.dead.push(`${label(el)} -> hits ${tagOf(hit)}`);
        if (touch && Math.min(r.width, r.height) < 44)
          out.small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      for (const el of root.querySelectorAll("*")) {
        if (!shown(el) || el.children.length > 2) continue;
        const text = (el.textContent || "").trim();
        if (!text) continue;
        const cs = getComputedStyle(el);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
        if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) continue;
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
          out.clipped.push(`"${text.replace(/\s+/g, " ").slice(0, 40)}" (${tagOf(el)})`);
      }
      out.pageScroll = document.documentElement.scrollWidth > W + 1 || document.documentElement.scrollHeight > H + 1;
      return out;
    },
    { rootSel: SCREENS[screen].root, touch },
  );
  if (report.error) {
    console.log(`[${name}] ${report.error}`);
    failed = true;
    return;
  }
  const lines = [];
  for (const k of ["dead", "off", "clipped", "small"]) {
    for (const s of report[k]) lines.push(`  ${k.toUpperCase().padEnd(7)} ${s}`);
  }
  if (report.pageScroll) lines.push("  SCROLL  the document scrolls — something is wider or taller than the glass");
  if (report.dead.length || report.off.length || report.pageScroll) failed = true;
  console.log(`[${name}]${lines.length ? "" : " clean"}`);
  for (const l of lines) console.log(l);
});
process.exit(failed ? 1 : 0);
