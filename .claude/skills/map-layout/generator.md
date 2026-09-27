# A seeded map generator

`scripts/generate-hollowmere.mjs` (240 m village, the most recent) and
`scripts/generate-harrowmead.mjs` (400 m farming vale) are the worked
examples; Sarab, Cinderhaven and Kurenai have their own at larger scales. A new
one starts as a copy of the nearer of the first two and keeps its shape: the
DESIGN is authored at the top, the TRANSCRIPTION is mechanical and CHECKED, and
the output is ordinary `layout.ts`/`heights.ts` the editor can open. Register
it in `package.json` (`"<map>": "node scripts/generate-<map>.mjs"`) and in
CLAUDE.md's commands block.

## Its anatomy, in file order

1. **The floor** — `natural(x, z)` (a tilt, value noise, named `HILLS` as
   raised cosines; peak/radius x π/2 is the steepest a hill makes), then
   `land()` levels each `DISTRICTS` rect toward its `level` by a weighted
   average (a skirt eases it back; `weight` makes one win; `level: null` is its
   own natural height, rounded), then the water's cone holds the ground low near
   the water, then `heightAt()` cuts the channel and the pools to one bed. The
   grid is written ROUNDED to centimetres, and every check reads `floorAt()` on
   that grid — never `heightAt()` — because that is the floor the game draws.
2. **`--probe`** prints the floor as a table (`~` wet, `!` steep) and exits.
3. **The vocabulary** — `FOOT` (each kind's footprint, front at -Z),
   `turnOf`, `worldFoot`, `place()`/`must()` (`must` refuses to write a map
   whose set piece did not fit), `doorway()`, `houseRow()`, `laneside()`.
4. **Roads first**, as `pathRoad`s, then `roadNetwork()` imported from
   `src/world/roadPaths.ts` — the game's own network, so "on a road" means
   the same thing in the check as in a round. Throws on a road in the water.
5. **Claims**: flags, the flags' spawns and the home spawns, then the yards
   (`open` — a door may open onto one, a building may not stand in one), then
   the set pieces, the rows, the lanes, the back plots, the fields.
6. **Dressing** — scatter regions checked by `groveOk`/`rectOk`; the
   borderland block appended LAST (every region draws from one seeded stream in
   array order, so a region spliced in above re-rolls everything below).
7. **Water rects** checked both ways (every wet point inside a rect is that
   water's own, and nothing wet lies outside every rect), grass, the floor's
   gradient check, then the files.

## Rules it keeps

- **Seeded, never `Math.random()`**: one `mulberry32` stream, and re-running
  with the tree unchanged must produce the same bytes — check it (`cmp` two
  runs).
- **Flat arrays of one-line entries** in the output, which is what the
  editor's source scan requires; the template's prose is a JS template
  literal.
- **Derive what the floor decides**: march to the shore for a boathouse, a
  jetty's root, a quay; read the creek's centreline for the mill
  (`creekX`/`creekZ`). A typed coordinate goes quietly wrong when the shore
  moves.
- **A piece that reaches over water on purpose states what must be dry**
  (`opts.dry`, in its own frame: the mill's body, the boathouse's landward
  half).
- **The footprint table is copied per generator** (and mirrored in this
  skill's `footprints.mjs`). A builder whose footprint changes owes all of
  them — this is the argument for a shared module, not yet written.

## Traps that have already cost time

- **`--dry` first.** Write nothing until the refusals list reads right; keep
  a `--claims <file>` dump for plan renders of a run that never wrote.
- **A set piece refused by an OPEN claim**: a building in its own yard (the
  chapel in its churchyard, a charnel house in a burial ground) needs
  `skip: (c) => c.type === "open"`.
- **Rows vs. corner plots**: start a street's rows past the corner plots of
  the square or the junction; see craft.md.
- **Districts that meet at different levels make a cliff.** Two levels a few
  metres apart with short skirts is a step the gradient check refuses; give
  the higher one a longer skirt or bring the levels together.
- **Door checks see only what is already placed** — run `audit.mjs` on the
  output.
- **The template is a JS template literal**: a backtick must be written `` \` ``
  and a backslash `\\` (an ASCII plan's `\_` loses its backslash otherwise),
  and `${` must not appear in the prose.
- **Windows**: a Python edit fed through a bash heredoc reads stdin in the
  console's code page and mangles non-ASCII (em dashes); write edit scripts to
  a file first. Files are CRLF on disk (`core.autocrlf`); generated output is
  LF and git normalizes it.
- **`npm run parity` runs a dev server**: editing any file under `src/` while
  it runs reloads the page and crashes it partway ("Execution context was
  destroyed") — wait for it.
- **Scatter burial measured from zero**: fixed in `76013c9`
  (`MapBuilder.insideCollider` now measures from the ground). If `buried.mjs`
  is ever non-zero again, that test has been defeated.
