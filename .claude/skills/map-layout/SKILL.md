---
name: map-layout
description: Create, re-lay or fix a map's layout so it reads as a real place and plays well — the procedure, the sense and playability checklists, the seeded-generator pattern, the traps that have already cost time, and scripts to audit placements, draw a plan, photograph flags in a live round and check a bake. Use whenever the task is "lay out / re-lay / make sense of / fix placements on / improve the playability of / add a district to" a map, or a new map is being built.
---

# Laying out a map

A map is data (`src/world/<map>/layout.ts`, `heights.ts`, `environment.ts`)
and `MapBuilder` special-cases nothing, so every quality a map has — whether
its houses face their streets, whether its streets join, whether a flag has
three ways in — is in that data and nowhere else. Nothing crashes when it is
wrong. This skill is how the Harrowmead and Hollowmere re-lays were done
(`git log --grep "IS SEEDED"`, and `76013c9` for what the second one found in
the engine), and those commits are the worked examples.

Read before touching anything:
- CLAUDE.md's "The map is data, not code", "Visual meshes and collider
  proxies" and "Mesh metadata" sections — the world layer's two rules that
  cannot bend;
- `docs/world.md` — the eight per-map overrides, the heightfield, roads and
  paths, the borderland and the rim, and each seeded map's lessons;
- the map's own `layout.ts` header (it says what each flag is FOR) and, if it
  is seeded, its generator's header in `scripts/generate-<map>.mjs`.

Then load the reference that fits:
- **[craft.md](craft.md)** — what makes a layout make sense and play well, as
  checklists, with the mistakes already made. Always.
- **[generator.md](generator.md)** — the anatomy of a seeded generator, what to
  copy from the two worked ones, and its traps. For a re-lay or a new map.

## Hand edit or generator?

**A few placements on a map** (move a house, add a lamp, open a gate): edit
`layout.ts` by hand or in the editor (`F2`), then run the audit.
**Anything that moves the ground, the roads, or more than a district**: use the
map's generator, or write one. A hand-kept layout and a hand-sculpted floor
drift apart the way any two hand-kept copies of one idea do — that is the whole
reason Harrowmead and Hollowmere are seeded now. Re-running a generator
DISCARDS editor edits to both files; say so before running one on a map whose
`layout.ts` has been hand-edited since its last run (`git log` both files).

## The procedure

### 1. Look at it as it stands

```bash
node .claude/skills/map-layout/scripts/audit.mjs <map>
node .claude/skills/map-layout/scripts/plan.mjs <map> --out <scratchpad>/before.png
node .claude/skills/map-layout/scripts/views.mjs <map> --out <scratchpad>/before --flags
```

The audit lists buildings on roads, in the water, on slopes, overlapping,
doors onto walls, spawns inside things, wet roads, and each side's distance to
each flag. The plan shows it; the views show what a player sees at each flag.
Scratch output goes to the session scratchpad, never the repo. `views.mjs`
needs a GPU (read VERIFYING.md for this machine); the other two do not.

Write down, in a sentence each: what the map IS (its place, era, story — "a
burnt village in a dead valley at night"), what each flag is FOR (the layout
header usually says), and what is wrong now. Keep the vibe the user likes:
the flags' identities, the districts' names, the environment, and roughly the
flags' positions (balance lives in those distances).

### 2. Design on paper before code

In this order, because each constrains the next:
1. **The ground** — where it is high and low and why (a hill under the
   landmark, a dell for the water, the town on a rise). Mind the MIST's datum
   (craft.md) and the fog (`fogEnd`).
2. **The water** — its course, what crosses it and where.
3. **The road network** — a main road, the streets off it, the lanes to each
   flag and each home, the back lanes. Every road ends at a junction, a yard,
   a door or the map's edge.
4. **The set pieces** — each flag's building and yard, the home gatehouses.
5. **The frontage** — rows of houses along each street, turned to it.
6. **The country** — outlying farms and crofts along the lanes, field walls
   cut at the lanes, woods at the edges.
7. **The dressing** — scatter, grass, lamps, braziers.

### 3. Build it, and iterate on the plan

For a generator: `node scripts/generate-<map>.mjs --dry --refusals` (or its
map's flags — each generator's header lists them) to see what it refused and
why, then write the files and draw the plan. For a hand edit: edit, audit,
plan. Most first passes refuse a lot: rows crowding corner plots, set pieces
on the new roads, plots on a skirt's slope. Fix the design, not the check.
Loop until the audit is clean of ERRORs and every WARN is one you can explain.

### 4. Photograph it

`views.mjs --flags` photographs every flag from its spawn and from 35 m on
four bearings; add a `--viewfile` for streets, the landmark and anything the
plan made you doubt. Judge from standing height, in the map's own light: does
a street read as a street, a hill as a hill, a ruin as a ruin, and is any
approach a 70 m walk across nothing?

### 5. Rebake, prove, play

```bash
npm run collision -- <map>
npm run typecheck
npm run parity                       # every map; do not edit files while it runs
node .claude/skills/map-layout/scripts/buried.mjs <map>    # must be 0
npm run simulate -- <map> 1 12 2>&1 | grep -E "winner|flags held|captures"
```

- **The simulation** is bots only and not a balance oracle, but it answers
  "can every flag be taken": every flag should change hands over twelve
  rounds, and a side winning 10 of 12 is a layout question. Report the split.
- **Frame cost**: active meshes and fps at the flags against HEAD, with
  `.claude/skills/model-detail/scripts/perf.mjs --map <map> --at 0,0,0
  --viewfile <v.json>` (its viewfile is `{name: {cam, tgt}}`, local to `--at`,
  so world coordinates at `0,0,0`). Headless Chromium on this box may cap at
  60 fps, and then the mesh count is the reading.

### 6. What a map change owes

- `npm run collision -- <map>` — the build refuses a bake older than its
  LAYOUT, but a change in a BUILDER re-rolls every map's scatter and needs
  `npm run collision` (all maps) by hand.
- `npm run parity`, all maps.
- The physics oracle: `node plans/physics-ref/drop.mjs --check <map>` for a
  map with a reference (`plans/physics-ref/ref/`). A changed world FAILS it —
  re-bank with `drop.mjs <map>`, then `scripts/physdiff.mjs <map>` must show
  every moved body sitting on a changed collider (see the script's header).
- The menu photograph if its subject moved: fix the vantage in
  `src/ui/mapShots.ts`, then `npm run shots -- <map>` (needs a GPU).
- `npm run build` last.
- Docs: the layout's header prose and ASCII plan, the map's paragraph in
  `docs/world.md`, CLAUDE.md's commands block for a new generator, and any
  `environment.ts` comment that described the old ground.

### 7. Commit (when asked)

House style, from `git log`: a headline in capitals saying what the place IS
now and the parts that make it one, then a sentence of what it was. Body: what
the generator checks, what is new about the ground, the flags (kept or moved),
the verification (parity, the sim's split, meshes/fps), what was regenerated
(bakes, physics references, the menu shot), and anything found and left alone.
End with the attribution lines the session gives.

## The scripts

All in `.claude/skills/map-layout/scripts/`, each with a usage header:

| script | what | needs |
| --- | --- | --- |
| `audit.mjs <map\|--all>` | placements on roads, in water, on slopes, overlapping; doors blocked or onto nothing; spawns; wet roads; home→flag distances | Node |
| `plan.mjs <map> --out f.png [--box] [--scatter]` | the plan: floor, contours, water, roads, footprints with door ticks, flags, spawns | Node + Chromium |
| `views.mjs <map> --out dir [--flags] [--viewfile]` | photographs from standing height in a live round | GPU |
| `buried.mjs <map\|--all> [--rev r]` | scatter colliders baked inside a structure's (must be 0) | Node + git |
| `physdiff.mjs <map> [--rev r]` | after a re-bank: which oracle bodies moved and what they rest on then/now | Node + git |
| `footprints.mjs`, `load.mjs` | the footprint table and the map loader the others share | — |

`footprints.mjs` covers the village, jungle, city and harbour kits; a desert
or temple kind is reported as "not checked". Adding one is a row in `FOOT` (and
in the generators' own tables — see generator.md). The city kit's street front
is +Z for the kinds in `FRONT_PLUS_Z`, so a door check or a plan tick asks
`frontOf(p)` rather than assuming -Z.
