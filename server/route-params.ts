/**
 * Express 5 types every route param as `string | string[]`, because a pattern like
 * `/api/x/:id` *could* be matched by a repeated segment. `parseInt` accepts only
 * `string`, so the direct call no longer type-checks — and at runtime the union is a
 * quiet hazard: `parseInt(["12","34"])` coerces the array to `"12,34"` and returns 12,
 * silently addressing the wrong row.
 *
 * These helpers narrow once, so route handlers read a number and stay honest about it.
 * They never throw: an unparsable param yields `NaN`, which the existing
 * `Number.isInteger(...)` / `<= 0` guards at the call sites already reject with a 400.
 */

/** Integer route param, or `NaN` when absent or not an integer. */
export function intParam(value: string | string[] | undefined): number {
  if (typeof value !== "string") return NaN;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

/** Positive integer route param, or `NaN` — the common "this must be a real row id" case. */
export function idParam(value: string | string[] | undefined): number {
  const n = intParam(value);
  return n > 0 ? n : NaN;
}
