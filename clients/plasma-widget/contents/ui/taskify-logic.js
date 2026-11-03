.pragma library

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

function getOfflineMetrics(task, nowMs = Date.now()) {
  const intervalDays = Number(task.interval_days);
  const significance = Number(task.significance);
  const anchorMs = Date.parse(task.urgency_anchor_at);
  if (!isFinite(intervalDays) || intervalDays <= 0 || !isFinite(anchorMs)) {
    return { elapsedDays: 0, x: 0, weight: 0, statusText: "Invalid", dueOffsetMs: null };
  }

  // Effective clock: matches engine
  const effectiveNowMs = (task.state === "frozen" && task.frozen_at)
    ? Date.parse(task.frozen_at)
    : (task.state === "completed" && task.last_completed_at)
      ? Date.parse(task.last_completed_at)
      : nowMs;

  const elapsedDays = Math.max(0, (effectiveNowMs - anchorMs) / 86400000);
  const x = elapsedDays / intervalDays;

  const A = 10.0;
  const B = 1.386;
  const ramp = Math.log(1.0 + A * Math.min(x, 1.0)) / Math.log(1.0 + A);
  const weight = x <= 1.0
    ? (1.0 + (significance - 1.0) * x) * ramp
    : significance * Math.exp(B * (x - 1.0));

  const dueAt = anchorMs + intervalDays * 86400000;
  const dueOffsetMs = dueAt - effectiveNowMs;

  const diffDays = Math.round(intervalDays - elapsedDays);
  let statusText = "";
  if (task.state !== "active") {
    statusText = task.state.toUpperCase();
  } else if (diffDays > 0) {
    statusText = `Due in ${diffDays} ${diffDays === 1 ? 'day' : 'days'}`;
  } else if (diffDays === 0) {
    statusText = "Due today";
  } else {
    const overdueDays = Math.abs(diffDays);
    statusText = `Overdue ${overdueDays} ${overdueDays === 1 ? 'day' : 'days'}`;
  }

  return {
    elapsedDays: Number(elapsedDays.toFixed(2)),
    x: Number(x.toFixed(2)),
    weight: Number(weight.toFixed(2)),
    statusText,
    dueOffsetMs: Number(dueOffsetMs)
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildTaskPayload, compareDue, getOfflineMetrics };
}
