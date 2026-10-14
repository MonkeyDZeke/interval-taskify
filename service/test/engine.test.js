const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { getMetrics, getSummary } = require("../src/engine");

const NOW = Date.parse("2026-01-31T00:00:00.000Z");
const DAY = 86400000;

function task(overrides = {}) {
  return {
    interval_days: 10,
    significance: 5,
    effort: 2,
    domain: "executive_mental",
    state: "active",
    is_recurring: 1,
    urgency_anchor_at: new Date(NOW).toISOString(),
    frozen_at: null,
    last_completed_at: null,
    ...overrides
  };
}

const ago = days => new Date(NOW - days * DAY).toISOString();

describe("getMetrics", () => {
  test("fresh task has zero weight", () => {
    const m = getMetrics(task(), NOW);
    assert.equal(m.weight, 0);
    assert.equal(m.x, 0);
  });

  test("weight equals significance at x = 1", () => {
    const m = getMetrics(task({ urgency_anchor_at: ago(10) }), NOW);
    assert.equal(m.x, 1);
    assert.equal(m.weight, 5);
  });

  test("weight is logarithmic and increasing before x = 1", () => {
    const early = getMetrics(task({ urgency_anchor_at: ago(2) }), NOW).weight;
    const late = getMetrics(task({ urgency_anchor_at: ago(8) }), NOW).weight;
    assert.ok(early > 0 && early < late && late < 5);
    // concave: 20% elapsed already gives well over 20% of significance
    assert.ok(early > 1);
  });

  test("weight grows exponentially past x = 1", () => {
    const m = getMetrics(task({ urgency_anchor_at: ago(20) }), NOW);
    assert.equal(m.weight, Number((5 * Math.exp(1.386)).toFixed(2)));
  });

  test("recurring daily cost is effort / interval", () => {
    assert.equal(getMetrics(task({ urgency_anchor_at: ago(3) }), NOW).dailyCostAu, 0.2);
  });

  test("once-off daily cost ramps to full effort and is held when overdue", () => {
    const once = { is_recurring: 0 };
    assert.equal(getMetrics(task({ ...once }), NOW).dailyCostAu, 0);
    assert.equal(getMetrics(task({ ...once, urgency_anchor_at: ago(10) }), NOW).dailyCostAu, 2);
    assert.equal(getMetrics(task({ ...once, urgency_anchor_at: ago(30) }), NOW).dailyCostAu, 2);
  });

  test("actionability is weight / effort, and weight when effort is 0", () => {
    const base = { urgency_anchor_at: ago(10) };
    assert.equal(getMetrics(task(base), NOW).actionability, 2.5);
    assert.equal(getMetrics(task({ ...base, effort: 0 }), NOW).actionability, 5);
  });

  test("frozen task holds its clock at frozen_at", () => {
    const m = getMetrics(task({ state: "frozen", urgency_anchor_at: ago(10), frozen_at: ago(5) }), NOW);
    assert.equal(m.elapsedDays, 5);
    assert.equal(m.statusText, "FROZEN");
  });

  test("completed task holds its clock at last_completed_at", () => {
    const m = getMetrics(
      task({ state: "completed", is_recurring: 0, urgency_anchor_at: ago(10), last_completed_at: ago(4) }),
      NOW
    );
    assert.equal(m.elapsedDays, 6);
    assert.equal(m.statusText, "COMPLETED");
  });

  test("elapsed time never goes negative", () => {
    const future = new Date(NOW + 3 * DAY).toISOString();
    assert.equal(getMetrics(task({ urgency_anchor_at: future }), NOW).elapsedDays, 0);
  });

  test("invalid input yields neutral metrics", () => {
    for (const bad of [{ interval_days: 0 }, { interval_days: -1 }, { interval_days: "abc" }, { urgency_anchor_at: "nope" }]) {
      const m = getMetrics(task(bad), NOW);
      assert.equal(m.statusText, "Invalid");
      assert.equal(m.weight, 0);
    }
  });

  test("status text covers due, today, and overdue with pluralisation", () => {
    const text = days => getMetrics(task({ urgency_anchor_at: ago(days) }), NOW).statusText;
    assert.equal(text(9), "Due in 1 day");
    assert.equal(text(7), "Due in 3 days");
    assert.equal(text(10), "Due today");
    assert.equal(text(11), "Overdue 1 day");
    assert.equal(text(15), "Overdue 5 days");
  });
});

describe("getSummary", () => {
  test("empty list yields zeros and baseline capacity", () => {
    const s = getSummary([]);
    assert.equal(s.total_weight, 0);
    assert.equal(s.total_active_cost_au, 0);
    assert.equal(s.effective_capacity_au, 12);
    assert.deepEqual(s.domain_loads.social_relational, { current: 0, max: 3 });
  });

  test("only active tasks count, grouped by domain", () => {
    const recent = { urgency_anchor_at: new Date().toISOString() };
    const s = getSummary([
      task({ ...recent, domain: "physical_somatic", interval_days: 4, effort: 2 }),
      task({ ...recent, domain: "physical_somatic", interval_days: 4, effort: 2, state: "paused" }),
      task({ ...recent, domain: "social_relational", interval_days: 10, effort: 3 })
    ]);
    assert.equal(s.domain_loads.physical_somatic.current, 0.5);
    assert.equal(s.domain_loads.social_relational.current, 0.3);
    assert.equal(s.total_active_cost_au, 0.8);
  });

  test("unknown domains add to total but not to any domain load", () => {
    const s = getSummary([task({ urgency_anchor_at: new Date().toISOString(), domain: "other" })]);
    assert.equal(s.total_active_cost_au, 0.2);
    assert.equal(s.domain_loads.executive_mental.current, 0);
  });

  test("energy factor is clamped between 0.1 and 1", () => {
    assert.equal(getSummary([], 0.5).effective_capacity_au, 6);
    assert.equal(getSummary([], 0).effective_capacity_au, 1.2);
    assert.equal(getSummary([], 5).effective_capacity_au, 12);
  });
});
