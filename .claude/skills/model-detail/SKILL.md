---
name: model-detail
description: Add detail to a world model, rework one that reads as boxes, or create a new structure builder under src/world/kit/ — the procedure, the gameplay rules a drawing may not break, the cel-look craft lessons, and scripts to photograph and measure a placement. Use whenever the task is "improve / add detail to / make more believable / rework / create" a building, prop structure or other kit model.
---

# Detailing and creating world models

Every structure in the game is a builder in `src/world/kit/` that emits boxes,
cylinders and surfaces at the origin, plus the collider boxes that stand in for
it. The reworks this skill distils — cottage, townhouse, tavern, smithy, mill,
chapel, boathouse, stilt hut, cart, jungle ruin, temple — all followed the
procedure below, and each one's commit message (`git log --grep "NOW:"`) is a
worked example worth reading before starting a similar model.

Read before touching anything:
- the builder's own header comment (it owns its argument — nav budget, cover
  heights, what was tried first);
- `src/world/kit/core.ts`'s header (the builder contract) and the kit file's
  own header (`structures.ts`, `city.ts`, `desert.ts`, `harbour.ts`,
  `japan/index.ts` each carry rules for their set);
- CLAUDE.md's "Visual meshes and collider proxies" and "Mesh metadata"
  sections, and `docs/world.md` / `docs/rendering.md` where the task touches
  them.

Then load the reference that fits:
- **[craft.md](craft.md)** — how to draw detail that reads in this cel look,
  and the specific mistakes that have already been made. Always.
- **[new-model.md](new-model.md)** — registering a new kind, choosing its
  colliders, params, editor wiring, placing it. Only for a new builder.

## The procedure

### 1. Find it and photograph it as it stands

```bash
node .claude/skills/model-detail/scripts/find.mjs <kind>        # every placement, as --map/--at args
node .claude/skills/model-detail/scripts/shots.mjs --map <id> --at x,z,rotY \
  --out <scratchpad>/before --r <radius> --stats <kind> [--params '{"ruined":true}']
```

`--r` is the ring radius: roughly the model's half-diagonal plus 4–8 m.
`sun` is the view that shows lit faces — judge detail there; `shade` judges the
silhouette. The forest or the town often blocks the ring views; add close ones
with `--viewfile` (placement-local coordinates, y above the placement's ground).
Write scratch files to the session scratchpad, never the repo. The scripts need
a GPU — read VERIFYING.md for this machine first.

Say in one line what it reads as now ("a plaster box with a stripe round it").
That sentence is the commit's second sentence and the thing the work fixes.

### 2. Decide the detail tier

How much detail a model may carry is set mostly by how many times it is
placed: every vertex is paid once per placement, and Cinderhaven has 178
cottages. `find.mjs` counts the placements per map and suggests a tier from
the BUSIEST map's count (each map is its own scene). The count is a CEILING
and the model's ROLE decides within it: a small prop is dressing however few
there are (crates, 25 on Cinderhaven, suggest "building" and are dressing), a
cart is a structure, a landmark placed twice is still a landmark, and a model
about to be placed widely is budgeted for the count it will have.

| tier | when | vertices per placement | worked examples |
| --- | --- | --- | --- |
| **landmark** | 1–3 on its busiest map; a flag's anchor or a focal point | 50–90 k | temple ~83 k, jungle ruin ~65 k, chapel ~64 k |
| **building** | up to ~30 on its busiest map; large or enterable | 15–40 k | stilt hut ~35 k, mill ~28 k, boathouse ~27.5 k |
| **structure** | up to ~250; the common houses and big props | 4–10 k | cart ~8–9 k, townhouse ~6.2 k, cottage ~4.1 k |
| **dressing** | more; props and cover | 0.5–3 k | crates, troughs, haystacks |

**If the skill is invoked with `tier=<name>`, that tier is used as stated** —
the user knows something the count does not. Otherwise state the tier chosen
and why (count and role) before drawing, and check the result against it with
`shots.mjs --stats`. Also check the total: placements × vertices on the
busiest map. Past ~+500 k scene vertices on one map, measure the round's
install time as well as the frame rate (`perf.mjs` prints it) — the cottage
rework cost Cinderhaven 2 s of install for +720 k.

Budget detail toward what is SEEN: the elevation a player approaches, the
things at eye height, the silhouette. A landmark's back wall still gets its
share; a dressing prop's underside gets nothing.

There is deliberately **no art-style parameter**: the game has one style, and
the variation within it is the SETTING, which follows from the kit file and the
map. Read that setting's notes in craft.md ("The settings") before choosing
materials.

**Do not build runtime LOD** (a simpler mesh swapped in at distance). The frame
is draw-call bound and models are merged per colour per map block; a swap
breaks the merge and costs draw calls to save vertices. Distance is already
handled by the size cull and the fog.

### 3. Decide what it IS before drawing anything

Pick a real building type, period and construction, and let every detail follow
from how that thing is built and how it decays (a Khmer terrace is sandstone
facing on laterite fill; a farm wagon has a turntable forecarriage). Believable
comes from construction logic, not from more boxes. Keep the map's story: what
climate, what era, what else stands near it. Colours come from the kit palette
in `core.ts`; a new colour is a new draw call per map block it appears in, so
add one only when a material genuinely differs, and say why in its doc comment.

### 4. Keep the masses, draw over them

**The colliders are the gameplay and the drawing is not.** Default: every
collider stays byte-identical and in the same order — restate them by hand in
a block at the top of the builder (a `wall` becomes `block` + `box`; a
`doorWall`/`gableRoof` becomes its own arithmetic spelled out, same operations
in the same order so the floats cannot move). Everything after that block is
drawing, and every drawn part obeys one of three rules:

1. it is **flat on a face** (applied, bedded on the face — never centred inside
   the wall where the boarding swallows it);
2. it is **low enough to walk over** (under ~0.3 m; a fern, a root, a fallen
   block, a step), or overhead and clear of every head (≥ 2.4 m over a floor);
3. it **stands on top of a collider** (a head course, a pediment, a tree on a
   wall, an architrave on a pier).

Visual must never be BELOW the collider where rounds arrive — a round stopping
on air over a broken wall head reads as a bug; one passing through the top
course of a ruin does not. If the work genuinely needs new colliders (a walked
floor, a hearth, a counter), append them AFTER the existing ones and follow
new-model.md's collider rules; that owes a re-bake of every map it stands on.

### 5. Seed variation, conform to the ground

Anything that varies between placements is seeded:
`const rnd = mulberry32(streetSeed(w, d, h, ctx))` — never `Math.random()`.
A builder that reads `ctx` (seed or ground) takes `ctx?: BuildCtx` as its 4th
parameter and its kind goes in `CONFORMS_TO_TERRAIN` in `BuildingKit.ts`, with
a clause in that set's comment. Sample the ground with the rotation-aware
helper every conforming builder uses:

```ts
const ground = (lx: number, lz: number): number => {
  if (!ctx) return 0;
  const cos = Math.cos(ctx.rotY);
  const sin = Math.sin(ctx.rotY);
  return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
};
```

Carry footings, piles, steps and plinths down to it; never leave a model
hovering over a slope or buried at one end.

### 6. Iterate on photographs

Photograph after every meaningful pass, from the sun side and close, and look
at what is actually on screen. Most first cuts have at least one of the
failures in craft.md (relief invisible, leaves too big, moss like coins, roots
like pipes). Check every variant the params allow (`ruined`, small footprint)
— at least build them with `--stats`; photograph the ones a layout uses.
To photograph a variant no layout places, temporarily edit the placement's
params in the layout, shoot, and `git checkout` the layout.

### 7. Verify

Take a fingerprint of the kind BEFORE the first edit, and check against it at
the end: every placement in every layout, the drawing and the colliders hashed
apart, in a minute or less.

```bash
npm run kit:hash -- --kinds <kind> --out <scratch>/before.json   # before editing
npm run kit:hash -- --kinds <kind> --against <scratch>/before.json
```

A rework that keeps its colliders must report `colliders changed 0` — that is
the "byte for byte" claim a header makes, checked rather than asserted. A pure
refactor must report nothing changed at all. Then:

```bash
npm run typecheck
npm run collision -- <map>      # for each map the kind stands on
git diff --stat src/world/<map>/collision.ts   # must be empty if colliders were kept
npm run parity                  # all maps
npm run build
```

`npm run collision` rewrites the file; if colliders were meant to be unchanged
and the diff is empty, `git checkout` it back (line endings may still show).
If colliders changed, commit the bakes, and prove every walkable cell is still
reachable: `scripts/reach.mjs --map <id> --at x,z,rotY --half hx,hz` (how to
read it is in new-model.md).

Measure cost against HEAD from the same vantages:

```bash
node .claude/skills/model-detail/scripts/perf.mjs --map <id> --at x,z,rotY --r <radius>
git stash; node .../perf.mjs <same args>; git stash pop
```

Report vertices per model (from `--stats`) against the tier, scene vertices,
active meshes and fps at each vantage. Run-to-run spread is ~3%. The recent
bar: draw calls and active meshes unchanged, fps inside the spread. More than a couple of draw calls, or fps outside the spread, needs
a reason in the commit or a cheaper drawing.

### 8. Commit (when asked)

House style, from `git log`: a headline in capitals — `THE <MODEL> IS A <WHAT
IT IS> NOW: <the main parts>.` — then one sentence of what it read as before.
Body paragraphs: what it is drawn as, part by part; what is seeded and why it
is in `CONFORMS_TO_TERRAIN`; any new helper or palette colour; the colliders
(unchanged and in the same order, the bake hash, parity); the cost with
numbers; what was photographed and what was only built. End with the
attribution lines the session gives.

## Shared words — reuse, never copy

In `kit/core.ts`: `Build` (`box`, `cyl`, `wall`, `block`, `strut`, `guard`,
`glow`, `flame`, `light`, `sound`, `translucentBox`, `gableEnd`, `surface`,
`pane`, `doorWall`, `gableRoof`), `streetSeed`, `groundRun` (a run stepping
down a slope), `carve` (intervals minus cuts), and the forest's words: `orient`,
`slab` (a flat member from A to C), `limb` (a round one), `rope` (a tapering
chain — roots, stems, cables), `heading`, `stepAlong`, `fern`, `curtain` (creeper
hung down a face), plus `FIG_*`;
`convexSolid` (a solid between two matching faces), and the elevations' words
`onFace` (a member laid on one of four faces), `Side`, `Hole`, `CASEMENT` and
`DOOR_PAINTS`. In `buildings/` (set-local, move to core.ts if a second
set needs one): `offFace`, `casement`, `doorway`, `framing` (`village.ts`),
`facePoly`, `archRing`, `lancet`, `buttress` (`gothic.ts`), the rubble words
(`rubble.ts`), and `renderFace`, `wallHead`, `toothing`, `quoins`
(`render.ts`). In `structures.ts`: the temple's `flat`,
`courses`, `hang`, `moss`, `fallen`, `devata`. In `japan/`, each in a file of its
own: `curvedRoof` and `roofHeight` (`roof.ts`); `Lapidary` (`lapidary.ts`,
granite carving, one surface per colour — `solid`, `lathe`, `petals`,
`leafRow`, `tube`, `lichen`, `leaf`); and `Joinery` (`joinery.ts`, the carpentry under a tiled curved hip — brackets, purlins, a
frog-leg strut, two layers of rafters, hip beams with wind bells, the tiles
and ridges, the sheet), which the temple gate and the bell tower share. Moving a helper to core.ts is
the right fix for a second caller; a copy is not.
