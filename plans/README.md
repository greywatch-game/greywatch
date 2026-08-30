# plans/

Not documentation. `CLAUDE.md` and the contracts under `docs/` are the rules;
`FILES.md` is the module map; `FINDINGS.md` is the open-threads list. This
directory holds the two things that are neither: **plans that have shipped**, and
the **reference harnesses** built to grade them.

| | what it is |
| --- | --- |
| `done/` | Shipped plans, kept for their ARGUMENTS. A record, not a to-do. Each one opens with a status block saying when it landed and what in it is still true. |
| `webgpu-ref/` | **LIVE.** The reference-image bank and harness the WGSL milestones diffed against, and still how a rendering change is graded — `gate.mjs`, `bank.mjs --check`, `depth.mjs`. Cited from `docs/build.md`, `docs/rendering.md`, `docs/world.md`, `VERIFYING.md` and `FINDINGS.md`. |
| `physics-ref/` | **LIVE.** The same for Havok: `drop.mjs` is the oracle for anything that changes what a body stands on. |

**A plan being finished is not a reason to delete it.** These documents argue
rather than describe, and the argument outlives the work — why the uniform
arrays were not repacked, why a deep-import count had to end lower than it
started. Deleting one loses the reason a rule exists while leaving the rule.
Moving it into `done/` is what says it is no longer a description of work
anybody should start.

**The live engine plan is `ENGINE_UPGRADE.md`, at the repository root, and it is
deliberately not in here.** Fifteen of its sixteen steps are marked LANDED and
S10 is not, which is the whole reason it stays where it is; it is also cited by
step number from `CLAUDE.md`, eight files under `docs/`, `FILES.md`,
`VERIFYING.md` and `FINDINGS.md`, so it is a reference as much as a plan. Do not
archive it on the strength of the LANDED markers alone.
