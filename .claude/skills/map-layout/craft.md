# Layout craft: sense and playability

Two questions, and a layout owes both: does it read as a real place, and does
it play. Each item below is a rule with the reason it exists; most were learned
by getting it wrong on a shipped map.

## Does it make sense

**A town grows along its roads, so lay the roads first and the buildings
against them.** A house is placed ON a frontage line, turned to face the
street it stands on — never placed and then given a road. Every front door
(a builder's local -Z) opens onto a street, a square or a yard within a few
metres. The audit and the generators both check it; a door into a
neighbour's back wall is the commonest thing a hand layout gets wrong.

**Door checks are order-dependent — audit the finished layout.** A generator
checks each door when its house is placed, so a neighbour placed afterwards
can stand in front of it. Hollowmere's first seeded pass shipped two (a corner
house on the square's south row facing into the east row's back wall; a cart
in front of the mill door). Run `audit.mjs` on the result, not only the
generator's own checks.

**Corners belong to one row.** Where two streets meet, the corner plot is ONE
house, turned to one of them. Run the rows along the square's north and south
sides past its corners and start the side streets' rows after them, or two
rows fight over the corner and one of them faces the other's back.

**Roads join; they do not stop.** A road ends at a junction, a yard, a door,
a ramp foot or the map's edge — never in a field, under a building or at a
fence. Use PATH roads (`params.path`) so the network paves junctions itself;
a rectangle is never an arm of a junction. One paved rectangle for a square
is fine — streets end inside it. Lanes that leave the map carry on into the
borderland (`docs/world.md`): a track running into the fog says the country
goes on.

**Village streets are straight and cardinal; country lanes bend.** Buildings
are axis-aligned (`rotY` in quarter turns), so a diagonal street gets a
sawtooth frontage. Keep the built-up streets on the grid and let the lanes out
of the village curve, with crofts strung along them facing the lane
(`laneside` in `generate-hollowmere.mjs`).

**Nothing on a slope beyond its plinth.** A placement samples the floor once,
at its centre; a cottage's plinth is 0.3 m, so a plot that falls more than
that shows daylight under one corner. Level the ground under districts
(generator.md) rather than hunting for flat spots. The chapel, ruin, shed,
cart, stall and woodpile carry themselves down to the ground; the cottage and
the townhouse do NOT (they are in `CONFORMS_TO_TERRAIN` for seeding only).

**Every building is the one that place would have built** (`docs/world.md` on
Cinderhaven's kit). A mill stands on its water with its wheel over the race; a
boathouse's water doors stand over the pool (derive its position from the
shore, never type it); a smithy's open front and an inn's porch face the
square; kilns stand in the logging camp with their mouths to the lane; a
gatehouse straddles its road.

**Ruin tells a story, not a percentage.** Decide where the fire went (up from
the bog, through the south-east quarter) and burn that: most of one quarter, a
few elsewhere, lit windows where people are holding out. Mix the burnt states
— a `ruined` cottage (roof gone, walls standing), a `ruin` (rubble shell), an
overturned `ruined` cart — and put rubble in the yard BEHIND a burnt house,
kept off the carriageway (rubble is not rooted, so a road does not refuse it).

**Walls and fences are field boundaries, cut where the lanes cross them.** Lay
them as long lines and let the generator cut runs at every road, building and
water crossing — that is what puts a gate where a lane is. Lay each line
against the ones already laid, or two lines meeting at a corner overlap.

**Lamps stand on the kerb with their arm (local +X) over the road**, at
corners and at set pieces. Each lit lamp is a point light competing for 16
slots near the camera; keep to the old count (~15 on a 240 m village).

**Dressing is a region checked against the finished floor.** A scatter region
knows nothing about water or claims: check every region dry, off every
building and yard, and under a grade a tree stands on (`groveOk`/`rectOk`).
A tall stand may straddle a field wall; a low one (headstones, logs, barrels)
must be clear of every claim. Test a RECTANGULAR region as a rectangle — a
graveyard strip tested as its bounding circle reached the nave and was
refused.

**Grass is how LUSH and how TALL, never a count** — the field is drawn round
the eye. Keep it low where something must show through it (a churchyard at
0.55 height, not 0.85, or the headstones vanish). Grass under a water rect
grows as reeds.

## Does it play

**Every flag has three or more ways in**, and none of them is only a road.
Count them on the plan: streets, lanes, a footbridge, a ford, a gap in a wall.

**Balance lives in the home→flag distances.** The audit prints them; the two
sides' totals should be close (Hollowmere 740/751, Harrowmead 1196/1168) and
each side should have its "own" near flag at a similar distance (A 46 vs E 59).
Keep the flags roughly where they were when re-laying, unless balance is the
task.

**Break the long looks.** `fogEnd` decides the longest look, and a clear map
must be laid out knowing `bots.perception.engageRange` (55 m) did not move with
it. A straight street longer than the engage range is a lane of fire — kink
it, close it with a landmark, or break it with a crest. Ground does this
better than walls: a crest wall over a dell is cover and a sightline at once.

**Give each flag a character and keep it.** High ground slow to reach (a
church on a hill inside walls with gates); low ground shot into (a mill yard
two metres under a crest wall); an open square nobody keeps; a perch with an
exposed climb (a barn loft); a close brawl (a boathouse in the thickest mist).
Relief is ground now, not boxes: a `terrace` or embankment standing in for a
hill is what the re-lays removed.

**Spawns**: each flag's spawn outside its own ring, on open ground, claimed
before any building so nothing is built on it; home spawns on the village side
of the gatehouse barricades, off the road through the arch. A blocking scatter
prop is held off flags and spawns by `MapBuilder.keepClear`.

**A flag's spawn is a balance lever as strong as the flag.** It is where
every reinforcement for the NEXT flag starts, so moving one 11 m away from
the contested middle took Greyfen's re-lay from 18-18 to 26-10 on nav
distances that were all within 6 m of the old map's. Keep each spawn on the
side of its flag that faces the fight it feeds, and when re-laying, start
from the OLD spawns' bearings rather than from a fresh guess.

**Read the sim per FLAG, not per round.** Batches of twelve on identical
files swing from 9-3 to 1-11; each flag's share of the round held by each
side stays within about ten points. `server/simulate.ts` does not print it:
patch a counter over `game.conquest.points` (`owner` per tick) into the step
loop for the run and take it out again, and run the OLD map the same way for
the baseline before believing any difference.

**Water is wadeable.** No swimming: a channel's banks grade under ~0.25 so
anybody wades it anywhere, and the footbridges and fords are the easy line,
not the only one. Anything steeper than 0.4 per metre severs its own nav
links — the generators refuse a floor steeper than 0.36 anywhere (0.4 less a
tenth for margin).

**A lit fixture costs a slot everywhere.** `LightingSystem` fills its 16
point-light slots nearest-first with no range cull, so every lamp, drum, kiln,
shrine and watchtower basket ON THE MAP is paid per pixel at every flag until
there are sixteen of them. Greyfen's first pass lit its new places like a
village at night and lost 13-26% of the frame; ten lights got it back to within
6-14%. Count the lit kinds (`grep` the layout for `lamp`, `fireDrum`, `kiln`,
`shrine`, `watchtower`, `fungus`, and the lit builders) and measure before and
after with `perf.mjs`.

**Density is cost.** A map is priced on its area and its placements
(`docs/world.md` on Kurenai): ~200-250 placements and ~55 houses on 240 m kept
Hollowmere's active meshes level with the old layout. Measure; do not guess.

## The atmosphere

**The mist is an ABSOLUTE height falloff** (`exp(-max(y, 0) / mistHeight)`), so
where the floor's zero sits is a decision about the look. Keep the town just
above zero (it keeps its mist), put the low ground below zero (it drowns — the
dell, the moor, the bog shore), and let a landmark stand clear on a hill.
Moving the whole floor up thins every district's mist at once.

**Fog is linear and the borderland must reach `fogEnd` from everywhere** —
see `docs/world.md`. Relief at the play edge is extruded outward by the
clamped edge row, so a hill touching the edge becomes a ridge running out:
keep edge features deliberate (a creek or a pool running off the map is good;
a half-hill is not).
