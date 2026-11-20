export type AssignKind = "home" | "work" | null;
export type AssignField = "from" | "to";

/** Home/work assign mode, tracked per field so the two inputs stay independent. */
export interface FieldAssign {
  from: AssignKind;
  to: AssignKind;
}

export function setFieldAssign(
  state: FieldAssign,
  field: AssignField,
  value: AssignKind,
): FieldAssign {
  return { ...state, [field]: value };
}
