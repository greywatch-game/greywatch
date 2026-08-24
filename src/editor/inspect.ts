/**
 * editor/inspect.ts — Turns a selection into the inspector's title and its
 * editable fields.
 * Owns: the read model. Writes nothing — every control it describes is applied
 * by `mutate.setField`, keyed by the same `key` string this file puts on it.
 *
 * Params are shown through the PARAMS descriptor table rather than by dumping
 * the params bag, because BuildParams is one flat union shared by 30 builders:
 * a bag may legitimately carry a field the selected builder ignores, and
 * showing it would suggest an effect that isn't there. Fields the layout left
 * unset are shown empty with the builder's own default as the placeholder,
 * since that is what the geometry in front of you was actually built from —
 * and leaving them unset is what keeps the layout line short.
 */
import { CONFIG } from "../config";
import type { EnvironmentSpec } from "../world/environment";
import {
  DEFAULT_FLOOR_SURFACE,
  FLOOR_SURFACE_IDS,
  floorSurfaceLabel,
} from "../world/floorSurfaces";
import { isScatterRect, type MapLayout } from "../world/layout";
import {
  boolean,
  choice,
  color,
  note,
  number,
  text,
  toDegrees,
  type ChoiceOption,
  type FieldSpec,
} from "./fields";
import { BUILDER_KINDS, PARAMS, SCATTER_PROPS } from "./params";
import type { SelectionRef } from "./selection";

/**
 * Half of THIS map — the same bound the ridge check uses, and a per-map number
 * since `MapLayout.size` exists. Threaded down from `inspect`, which is where
 * the layout is in hand: a spinner clamped to the shipped 240 m would refuse
 * to type a coordinate a 320 m map is full of.
 */
const reachOf = (layout: MapLayout): number =>
  (layout.size ?? CONFIG.map.size) / 2;

export interface Inspection {
  title: string;
  fields: FieldSpec[];
  /** False for a stale ref, so the panel offers no delete button. */
  deletable: boolean;
}

const EMPTY: Inspection = { title: "", fields: [], deletable: false };

const options = (values: readonly string[]): ChoiceOption[] =>
  values.map((v) => ({ value: v, label: v }));

/** x / y / z, shared by everything that sits somewhere. */
function place(
  reach: number,
  x: number,
  y: number | null,
  z: number,
  yOptional: boolean,
  prefix = "",
): FieldSpec[] {
  return [
    number(`${prefix}x`, "x", x, -reach, reach),
    number(`${prefix}z`, "z", z, -reach, reach),
    number(`${prefix}y`, "y", y, -8, 48, 0.25, yOptional ? 0 : undefined),
  ];
}

/** The three fields water and grass rects share. */
function rect(
  reach: number,
  r: { x: number; z: number; y?: number; width: number; depth: number },
): FieldSpec[] {
  return [
    ...place(reach, r.x, r.y ?? null, r.z, true),
    number("width", "width", r.width, 1, 200, 1),
    number("depth", "depth", r.depth, 1, 200, 1),
  ];
}

/**
 * @param env the map's own environment. Only the `floor` ref reads it — a
 *   floor is a statement about the place rather than an entry in one of the
 *   layout's arrays, so it is the one selection whose fields do not come out
 *   of `layout` at all.
 */
export function inspect(
  layout: MapLayout,
  env: EnvironmentSpec,
  ref: SelectionRef | null,
): Inspection {
  if (!ref) return EMPTY;
  const reach = reachOf(layout);

  switch (ref.list) {
    case "placements": {
      const p = layout.placements[ref.index];
      if (!p) break;
      const fields: FieldSpec[] = [
        choice("kind", "kind", p.kind, options(BUILDER_KINDS)),
        ...place(reach, p.x, p.y ?? null, p.z, true),
        // Empty rather than a solid 0 when unrotated, matching `y`: both are
        // absent from the data, and the placeholder says what absent means.
        number(
          "rotY",
          "rotY°",
          p.rotY === undefined ? null : toDegrees(p.rotY),
          -360,
          360,
          15,
          0,
        ),
      ];
      const specs = PARAMS[p.kind];
      if (!specs.length) {
        fields.push(note("params", "none — placed as built"));
      }
      for (const s of specs) {
        const key = `params.${s.key}`;
        const set = p.params?.[s.key];
        if (s.type === "number") {
          fields.push(
            number(
              key,
              s.label,
              typeof set === "number" ? set : null,
              s.min,
              s.max,
              s.step,
              s.def,
            ),
          );
        } else if (s.type === "boolean") {
          fields.push(boolean(key, s.label, set === undefined ? s.def : set === true));
        } else {
          fields.push(
            choice(key, s.label, set === undefined ? s.def : String(set), options(s.options)),
          );
        }
      }
      return { title: `${p.kind} #${ref.index}`, fields, deletable: true };
    }

    case "scatter": {
      const s = layout.scatter[ref.index];
      if (!s) break;
      // The shape decides which extents mean anything, so only those are
      // offered: a rect has no radius and a disc has no facing to rotate.
      const shape: FieldSpec[] = isScatterRect(s)
        ? [
            number("width", "width", s.width, 1, 200, 1),
            number("depth", "depth", s.depth, 1, 200, 1),
            number(
              "rotY",
              "rotY°",
              s.rotY === undefined ? null : toDegrees(s.rotY),
              -360,
              360,
              15,
              0,
            ),
          ]
        : [number("radius", "radius", s.radius, 1, 60, 0.5)];
      return {
        title: `${s.prop} field #${ref.index}`,
        deletable: true,
        fields: [
          choice("prop", "prop", s.prop, options(SCATTER_PROPS)),
          choice(
            "shape",
            "shape",
            isScatterRect(s) ? "rect" : "circle",
            options(["circle", "rect"]),
          ),
          ...place(reach, s.x, s.y ?? null, s.z, true),
          ...shape,
          number("count", "count", s.count, 0, 120, 1),
          number("scale.0", "scale min", s.scale?.[0] ?? null, 0.2, 4, 0.1, 1),
          number("scale.1", "scale max", s.scale?.[1] ?? null, 0.2, 4, 0.1, 1),
          boolean("blocking", "blocking", s.blocking === true),
          number("clearance", "clearance", s.clearance ?? null, 0.1, 4, 0.05, 0.8),
        ],
      };
    }

    case "controlPoints": {
      const cp = layout.controlPoints[ref.index];
      if (!cp) break;
      return {
        title: `flag ${cp.id}`,
        deletable: true,
        fields: [
          text("id", "id", cp.id),
          text("name", "name", cp.name),
          ...place(reach, cp.pos.x, cp.pos.y, cp.pos.z, false, "pos."),
          number("radius", "radius", cp.radius, 3, 40, 0.5),
        ],
      };
    }

    case "spawns": {
      const s = layout.spawns[ref.index];
      if (!s) break;
      // team and controlPoint are one decision, not two: a spawn is either a
      // home spawn or a flag spawn. Offering them as separate controls invites
      // the two states nothing in ConquestSystem knows how to read.
      const owners: ChoiceOption[] = [
        { value: "team:0", label: "team 0 — home" },
        { value: "team:1", label: "team 1 — home" },
        ...layout.controlPoints.map((cp) => ({
          value: `cp:${cp.id}`,
          label: `flag ${cp.id} — ${cp.name}`,
        })),
      ];
      const owner = s.team === null ? `cp:${s.controlPoint ?? ""}` : `team:${s.team}`;
      return {
        title: `spawn #${ref.index}`,
        deletable: true,
        fields: [
          choice("owner", "owner", owner, owners),
          ...place(reach, s.pos.x, s.pos.y, s.pos.z, false, "pos."),
          number("yaw", "yaw°", toDegrees(s.yaw), -360, 360, 15, 0),
        ],
      };
    }

    case "water": {
      const r = layout.water?.[ref.index];
      if (!r) break;
      return { title: `water rect #${ref.index}`, fields: rect(reach, r), deletable: true };
    }

    case "grass": {
      const r = layout.grass?.[ref.index];
      if (!r) break;
      return {
        title: `grass rect #${ref.index}`,
        deletable: true,
        fields: [
          ...rect(reach, r),
          number(
            "density",
            "density",
            r.density ?? null,
            0.02,
            4,
            0.05,
            CONFIG.grass.density,
          ),
        ],
      };
    }

    case "floor": {
      // The map's ground, off the EnvironmentSpec rather than the layout —
      // one colour and the grain painted in it. Never deletable: every map has
      // a floor, and `flat` is how one says it wants no pattern.
      return {
        title: "map floor",
        deletable: false,
        fields: [
          color("floorColor", "colour", env.floorColor),
          choice(
            "floorSurface",
            "surface",
            env.floorSurface ?? DEFAULT_FLOOR_SURFACE,
            FLOOR_SURFACE_IDS.map((id) => ({
              value: id,
              label: floorSurfaceLabel(id),
            })),
          ),
          note(
            "note",
            "rebuilds the map · tones are derived from the colour",
          ),
        ],
      };
    }
  }

  // A stale ref — the layout changed under the selection.
  return EMPTY;
}
