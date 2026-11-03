"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { buildTaskPayload, compareDue, getOfflineMetrics } = require("../../clients/web-app/taskify-logic");
const engine = require("../src/engine");

// Drift guard: the two copies must be functionally identical (plasma has only the .pragma line)
test("plasma and web taskify-logic copies are in sync (modulo pragma)", () => {
  const webSrc = fs.readFileSync(
    path.join(__dirname, "../../clients/web-app/taskify-logic.js"),
    "utf8"
  );
  let plasmaSrc = fs.readFileSync(
    path.join(__dirname, "../../clients/plasma-widget/contents/ui/taskify-logic.js"),
    "utf8"
  );
  plasmaSrc = plasmaSrc.replace(/^\.pragma library\s*\n?/, "");
  assert.equal(plasmaSrc.trim(), webSrc.trim());
});

describe("buildTaskPayload (BUG-4)", () => {
  test("once-off update/create omits days_ago entirely (even if config contains rounded elapsed)", () => {
    const config = {
      interval_days: 10,
      days_ago: 3, // what setEditing / onEditingTodoChanged populates even when hidden
      significance: 1.0,
      effort: 1.0,
      domain: "executive_mental",
      is_recurring: false
    };
    const payload = buildTaskPayload("Title", config);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "days_ago"), false);
    assert.equal(payload.is_recurring, false);
    assert.equal(payload.title, "Title");
  });

  test("recurring update still includes days_ago", () => {
    const config = {
      interval_days: 7,
      days_ago: 2,
      significance: 2.5,
      effort: 1.0,
      domain: "physical_somatic",
      is_recurring: true
    };
    const payload = buildTaskPayload("Recur", config);
    assert.equal(payload.days_ago, 2);
    assert.equal(payload.is_recurring, true);
  });

  test("once-off with days_ago=0 still omits (would otherwise reset anchor on save)", () => {
    const payload = buildTaskPayload("Fresh once", {
      interval_days: 5,
      days_ago: 0,
      significance: 1.0,
      effort: 1.0,
      domain: "executive_mental",
      is_recurring: false
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "days_ago"), false);
  });
});

describe("compareDue (BUG-6)", () => {
  test("tertiary tie-break is by id ascending, not title (matches server and spec)", () => {
    const tasks = [
      { id: 2, title: "aaa", metrics: { dueOffsetMs: 1000 } },
      { id: 1, title: "zzz", metrics: { dueOffsetMs: 1000 } },
    ];
    const sorted = [...tasks].sort(compareDue);
    assert.deepEqual(sorted.map(t => t.id), [1, 2]);
  });

  test("signed secondary: overdue before equal-distance future", () => {
    const o = { id: 10, title: "o", metrics: { dueOffsetMs: -500 } };
    const f = { id: 20, title: "f", metrics: { dueOffsetMs: 500 } };
    assert.ok(compareDue(o, f) < 0);
  });
});

describe("getOfflineMetrics (BUG-5)", () => {
  const NOW = Date.parse("2026-01-31T00:00:00.000Z");
  const DAY = 86400000;
  const ago = d => new Date(NOW - d * DAY).toISOString();

  function task(overrides = {}) {
    return {
      interval_days: 10,
      significance: 4.0,
      effort: 1.0,
      domain: "executive_mental",
      state: "active",
      is_recurring: 1,
      urgency_anchor_at: new Date(NOW).toISOString(),
      frozen_at: null,
      last_completed_at: null,
      ...overrides
    };
  }

  test("matches engine.getMetrics for fresh, due, overdue (pre-epoch scaling)", () => {
    for (const d of [0, 3, 5, 10, 15]) {
      const t = task({ urgency_anchor_at: ago(d) });
      const off = getOfflineMetrics(t, NOW);
      const eng = engine.getMetrics(t, NOW);
      assert.equal(off.elapsedDays, eng.elapsedDays);
      assert.equal(off.x, eng.x);
      assert.equal(off.weight, eng.weight);
      assert.equal(off.dueOffsetMs, eng.dueOffsetMs);
      assert.equal(off.statusText, eng.statusText);
    }
  });

  test("matches engine for frozen and completed clocks", () => {
    const frozen = task({ state: "frozen", urgency_anchor_at: ago(10), frozen_at: ago(5) });
    const offF = getOfflineMetrics(frozen, NOW);
    const engF = engine.getMetrics(frozen, NOW);
    assert.equal(offF.elapsedDays, engF.elapsedDays);
    assert.equal(offF.weight, engF.weight);
    assert.equal(offF.dueOffsetMs, engF.dueOffsetMs);
    assert.equal(offF.statusText, engF.statusText);

    const completed = task({ state: "completed", is_recurring: 0, urgency_anchor_at: ago(10), last_completed_at: ago(4) });
    const offC = getOfflineMetrics(completed, NOW);
    const engC = engine.getMetrics(completed, NOW);
    assert.equal(offC.elapsedDays, engC.elapsedDays);
    assert.equal(offC.weight, engC.weight);
    assert.equal(offC.dueOffsetMs, engC.dueOffsetMs);
    assert.equal(offC.statusText, engC.statusText);
  });

  test("dueOffsetMs matches engine (effective clock)", () => {
    const t = task({ urgency_anchor_at: ago(8) });
    assert.equal(getOfflineMetrics(t, NOW).dueOffsetMs, engine.getMetrics(t, NOW).dueOffsetMs);
  });
});
