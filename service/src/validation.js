// Allowed values from brief.yaml (significance_tiers, effort_levels).
const SIGNIFICANCE_TIERS = [1.0, 1.6, 2.5, 4.0];
const EFFORT_PRESETS = [0.5, 1.0, 2.5];

function checkChoice(body, field, allowed) {
  const value = body[field];
  if (value === undefined) return null;
  if (typeof value !== "number" || !allowed.includes(value)) {
    return `${field} must be one of ${allowed.join(", ")}`;
  }
  return null;
}

/**
 * Validates the tiered fields of a create/update payload. Fields that are
 * absent are skipped (defaults on create, unchanged on update).
 * Returns an error message, or null when valid.
 */
function validateTaskPayload(body) {
  return checkChoice(body, "significance", SIGNIFICANCE_TIERS)
    || checkChoice(body, "effort", EFFORT_PRESETS);
}

/**
 * Snaps a value to the nearest allowed choice (ties go to the lower choice).
 * Missing or non-numeric values fall back to the default.
 */
function nearestChoice(value, allowed, fallback) {
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return fallback;
  return allowed.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) ? c : best));
}

const normalizeSignificance = value => nearestChoice(value, SIGNIFICANCE_TIERS, 1.0);
const normalizeEffort = value => nearestChoice(value, EFFORT_PRESETS, 1.0);

module.exports = {
  SIGNIFICANCE_TIERS,
  EFFORT_PRESETS,
  validateTaskPayload,
  normalizeSignificance,
  normalizeEffort
};
