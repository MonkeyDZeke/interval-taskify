"use strict";

/**
 * taskify-logic.js
 * Pure client-side helpers extracted so they can be unit-tested with node:test.
 * Web loads via <script src="taskify-logic.js"> (before app.js).
 * Plasma imports a copy with .pragma library.
 *
 * Initial implementation replicates the pre-BUG-4 / pre-BUG-5 / pre-BUG-6 behavior
 * so that wiring does not change observable results. Tests then assert the
 * corrected contracts (red), then we fix the implementations (green).
 */

function buildTaskPayload(title, config) {
  // Fixed for BUG-4: once-off (is_recurring === false) must never send days_ago.
  // Sending it (even 0) causes updateTask to rewrite urgency_anchor_at and due date.
  // Recurring edits still send days_ago (the control is visible and intentional).
  // CLI -a remains the explicit advanced path.
  const isRecurring = config.is_recurring !== false;
  const payload = {
    title: title,
    interval_days: Number(config.interval_days) || 7,
    significance: Number(config.significance) || 1.0,
    effort: Number(config.effort) || 1.0,
    domain: config.domain || "executive_mental",
    is_recurring: isRecurring
  };
  if (isRecurring && config.days_ago !== undefined) {
    payload.days_ago = Number(config.days_ago) || 0;
  }
  // once-off: deliberately omit the key
  return payload;
}

function compareDue(a, b) {
  // Fixed for BUG-6: tertiary tie-break by id ascending (matches server/routes.js and due_proximity_view spec).
  const getDue = (t) => (t.metrics && t.metrics.dueOffsetMs != null ? t.metrics.dueOffsetMs : null);
  const la = Math.abs(getDue(a) != null ? getDue(a) : Infinity);
  const ra = Math.abs(getDue(b) != null ? getDue(b) : Infinity);
  if (la !== ra) return la - ra;
  const lo = getDue(a) != null ? getDue(a) : 0;
  const ro = getDue(b) != null ? getDue(b) : 0;
  if (lo !== ro) return lo - ro;
  return (a.id || 0) - (b.id || 0); // id ascending for stability
}

// Future: getOfflineMetrics, offlineSummary will live here too.

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildTaskPayload, compareDue };
}
