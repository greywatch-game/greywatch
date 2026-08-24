/**
 * editor/fields.ts — The vocabulary the inspector is written in: one editable
 * field, and the key that names it.
 * Owns: FieldSpec and the key conventions. Reads no layout and writes none —
 * `inspect.ts` produces these, `EditorPanel` renders them, `mutate.ts` applies
 * them. All three have to agree on what a key means, so the agreement lives
 * here rather than in any one of them.
 *
 * A key is a dotted path into a layout entry: `x`, `params.width`, `pos.y`,
 * `scale.0`. Two keys are not paths and are handled specially by `mutate.ts`,
 * because the underlying data is two fields that must move together:
 *
 * - `kind` on a placement also prunes params the new builder does not read.
 * - `owner` on a spawn sets `team` and `controlPoint` as a pair — a spawn is
 *   either a home spawn or a flag spawn, never both and never neither.
 *
 * **Angles are edited in degrees and stored in radians.** Layouts are authored
 * as `Math.PI / 2`, which is unreadable in a text box and unusable with a
 * spinner; degrees snap back to exact quarter turns on the way in (see
 * `qAngle` in mutate.ts), so the file keeps its `Math.PI / 2` spelling.
 */

/** Fields whose stored value is radians but whose control shows degrees. */
const ANGLE_KEYS = new Set(["rotY", "yaw"]);

export function isAngleKey(key: string): boolean {
  return ANGLE_KEYS.has(key);
}

/** Fields that vanish from the layout entirely when cleared or defaulted. */
const OPTIONAL_KEYS = new Set([
  "y",
  "rotY",
  "density",
  "clearance",
  "blocking",
  "scale",
]);

/**
 * True when absent is a legitimate state for this field, so clearing the
 * control removes the key instead of writing a zero. `y` absent means "on the
 * ground" and `blocking: false` is not how a non-blocking region is spelled —
 * writing either explicitly would add noise to every line the editor touches.
 */
export function isOptionalKey(key: string): boolean {
  const leaf = key.split(".").pop() ?? key;
  return OPTIONAL_KEYS.has(leaf) || key.startsWith("scale.");
}

/** Fields that must stay whole numbers. */
export function isIntegerKey(key: string): boolean {
  return key === "count";
}

export interface ChoiceOption {
  value: string;
  label: string;
}

interface FieldBase {
  /** Dotted path into the entry, or one of the two compound keys above. */
  key: string;
  label: string;
}

/** `value: null` means "unset — the builder's own default applies". */
export interface NumberField extends FieldBase {
  kind: "number";
  value: number | null;
  /** Shown as the placeholder when the value is unset. */
  def?: number;
  min: number;
  max: number;
  step: number;
}

export interface BooleanField extends FieldBase {
  kind: "boolean";
  value: boolean;
}

export interface ChoiceField extends FieldBase {
  kind: "choice";
  value: string;
  options: ChoiceOption[];
}

export interface TextField extends FieldBase {
  kind: "text";
  value: string;
}

/**
 * A colour, as `#rrggbb`. Its own kind rather than a `text` field because a
 * hex string is not something anyone can read as a colour — the whole value of
 * editing a palette in the editor is seeing the swatch you are choosing
 * against the map it is going onto.
 */
export interface ColorField extends FieldBase {
  kind: "color";
  value: string;
}

/** Something worth showing but not worth editing. */
export interface NoteField extends FieldBase {
  kind: "note";
  value: string;
}

export type FieldSpec =
  | NumberField
  | BooleanField
  | ChoiceField
  | ColorField
  | TextField
  | NoteField;

/** What a control hands back. `null` clears an optional field. */
export type FieldValue = number | string | boolean | null;

export const number = (
  key: string,
  label: string,
  value: number | null,
  min: number,
  max: number,
  step = 0.5,
  def?: number,
): NumberField => ({ kind: "number", key, label, value, min, max, step, def });

export const boolean = (key: string, label: string, value: boolean): BooleanField => ({
  kind: "boolean",
  key,
  label,
  value,
});

export const choice = (
  key: string,
  label: string,
  value: string,
  options: ChoiceOption[],
): ChoiceField => ({ kind: "choice", key, label, value, options });

export const color = (key: string, label: string, value: string): ColorField => ({
  kind: "color",
  key,
  label,
  value,
});

export const text = (key: string, label: string, value: string): TextField => ({
  kind: "text",
  key,
  label,
  value,
});

export const note = (label: string, value: string): NoteField => ({
  kind: "note",
  key: `note:${label}`,
  label,
  value,
});

/** Radians in the layout, degrees in the control. */
export const toDegrees = (rad: number): number =>
  Math.round((rad * 180) / Math.PI * 1000) / 1000;

export const toRadians = (deg: number): number => (deg * Math.PI) / 180;
