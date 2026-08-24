# AGENTS.md

**All agent guidance starts at [`CLAUDE.md`](CLAUDE.md).** Read it before any
change — it is the spine: commands, architecture, the rules that cross
subsystems, and conventions. Each subsystem's own rules are a **contract** under
[`docs/`](docs/) (weapons, grenades, ui, rendering, world, editor, bots, deaths,
pwa), named from a table at the top of `CLAUDE.md` — read the one covering what
you are changing; the summary in `CLAUDE.md` is a pointer, not a substitute.
Three more companions carry the lookup material: [`FILES.md`](FILES.md) (the
module map), [`VERIFYING.md`](VERIFYING.md) (headless-browser quirks) and
[`FINDINGS.md`](FINDINGS.md) (open threads).

Quick facts:

- Babylon.js + TypeScript + Vite browser game; `npm run typecheck` is the only
  automated gate — run it after every change.
- `src/core/Game.ts` is the only place systems meet; never add imports between
  systems.
- Every source file has a **contract header** at the top stating what it owns
  and its invariants — read it before editing that file.
- `README.md` is user-facing (game, controls, setup), not contributor guidance.
