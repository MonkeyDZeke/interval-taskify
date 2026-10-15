const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { getMetrics, getSummary } = require("../src/engine");

const NOW = Date.parse("2026-01-31T00:00:00.000Z");
const DAY = 86400000;

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
    assert.equal(m.weight, 4);
  });

  test("weight equals significance at x = 1 for every tier", () => {
    for (const significance of [1.0, 1.6, 2.5, 4.0]) {
      assert.equal(getMetrics(task({ significance, urgency_anchor_at: ago(10) }), NOW).weight, significance);
    }
  });

  test("Tier 4 at x = 1 matches Tier 1 at x = 2 (S_4 = S_1 * e^b)", () => {
    const tier4 = getMetrics(task({ significance: 4.0, urgency_anchor_at: ago(10) }), NOW).weight;
    const tier1 = getMetrics(task({ significance: 1.0, urgency_anchor_at: ago(20) }), NOW).weight;
    assert.ok(Math.abs(tier4 - tier1) < 0.01);
  });

  // Brief system_physics.a: "Reclaims ~75% of base weight S at half-interval (x = 0.5)"
  test("log phase reaches ~75% of S at x = 0.5", () => {
    const w = getMetrics(task({ significance: 1.0, interval_days: 10, urgency_anchor_at: ago(5) }), NOW).weight;
    assert.ok(Math.abs(w - 0.75) < 0.01, `got ${w}`);
  });

  test("log phase follows ln(1 + a*x) / ln(1 + a) with a = 10", () => {
    for (const [days, expected] of [[1, 0.2899], [2, 0.4583], [5, 0.7472], [8, 0.9163]]) {
      const w = getMetrics(task({ significance: 1.0, urgency_anchor_at: ago(days) }), NOW).weight;
      assert.ok(Math.abs(w - expected) < 0.005, `x=${days / 10}: got ${w}, want ${expected}`);
    }
  });

  // Brief system_physics: log curve shape on baseline Tier 1 task
  test("log phase rises from 0, is increasing, and base gain slows toward x = 1", () => {
    const w = days => getMetrics(task({ significance: 1.0, urgency_anchor_at: ago(days) }), NOW).weight;
    const samples = [0, 2, 4, 6, 8, 10].map(w);
    assert.equal(samples[0], 0);
    for (let i = 1; i < samples.length; i++) assert.ok(samples[i] > samples[i - 1]);
    const gains = samples.slice(1).map((v, i) => v - samples[i]);
    for (let i = 1; i < gains.length; i++) assert.ok(gains[i] < gains[i - 1], `gains ${gains}`);
  });

  // Brief system_physics.b: 2.0*S at x = 1.5, 4.0*S at x = 2.0 (b = 1.386 ~ ln 4)
  test("exponential phase doubles at x = 1.5 and quadruples at x = 2.0", () => {
    for (const S of [1.0, 1.6, 2.5, 4.0]) {
      const at = days => getMetrics(task({ significance: S, urgency_anchor_at: ago(days) }), NOW).weight;
      assert.ok(Math.abs(at(15) - 2 * S) < 0.02 * S, `S=${S} x=1.5: ${at(15)}`);
      assert.ok(Math.abs(at(20) - 4 * S) < 0.01 * S, `S=${S} x=2.0: ${at(20)}`);
    }
  });

  test("weight is continuous and increasing across the x = 1 boundary", () => {
    const at = days => getMetrics(task({ significance: 4.0, interval_days: 100, urgency_anchor_at: ago(days) }), NOW).weight;
    assert.ok(at(99) < at(100) && at(100) < at(101));
    assert.ok(at(101) - at(99) < 0.2);
  });

  // Brief system_physics.time_variable: scale invariance, x = delta_t / T
  test("scale invariance: same x gives same weight regardless of interval", () => {
    const short = getMetrics(task({ interval_days: 3, urgency_anchor_at: ago(4) }), NOW);
    const long = getMetrics(task({ interval_days: 21, urgency_anchor_at: ago(28) }), NOW);
    assert.equal(short.x, long.x);
    assert.equal(short.weight, long.weight);
  });

  // Brief cost_formula: C_i = E / T; 1.0 AU = E = 1.0 with T = 1.0
  test("recurring daily cost is effort / interval and constant over time", () => {
    for (const days of [0, 3, 10, 40]) {
      assert.equal(getMetrics(task({ effort: 2.5, urgency_anchor_at: ago(days) }), NOW).dailyCostAu, 0.25);
    }
  });

  test("1 AU is a standard-effort task with a 1-day interval", () => {
    assert.equal(getMetrics(task({ effort: 1.0, interval_days: 1 }), NOW).dailyCostAu, 1);
  });

  // Brief once_off_cost_formula: C(x) = E * R(x), peak E independent of T, ~0.75E at x = 0.5
  test("once-off cost ramps with R(x), peaks at E at the due date, and holds when overdue", () => {
    const cost = (days, extra = {}) =>
      getMetrics(task({ is_recurring: 0, effort: 2.5, urgency_anchor_at: ago(days), ...extra }), NOW).dailyCostAu;
    assert.equal(cost(0), 0);
    assert.ok(Math.abs(cost(5) - 2.5 * 0.7472) < 0.005);
    assert.equal(cost(10), 2.5);
    assert.equal(cost(15), 2.5);
    assert.equal(cost(100), 2.5);
  });

  test("once-off peak load does not depend on its interval", () => {
    for (const interval of [1, 7, 30, 365]) {
      const m = getMetrics(
        task({ is_recurring: 0, effort: 2.5, interval_days: interval, urgency_anchor_at: ago(interval) }),
        NOW
      );
      assert.equal(m.dailyCostAu, 2.5, `T=${interval}`);
    }
  });

  test("once-off cost equals W(x) for baseline tier while x <= 1 and is clamped past it", () => {
    const m = getMetrics(task({ is_recurring: 0, significance: 1.0, effort: 1.0, urgency_anchor_at: ago(6) }), NOW);
    assert.ok(Math.abs(m.dailyCostAu - m.weight) < 0.01);
    const overdue = getMetrics(task({ is_recurring: 0, significance: 1.0, effort: 1.0, urgency_anchor_at: ago(20) }), NOW);
    assert.equal(overdue.dailyCostAu, 1);
    assert.ok(overdue.weight > 1.0);
  });

  // Brief partial_completions.actionability_ratio_stability: ROI = W(x) / E
  test("actionability is weight / effort", () => {
    const base = { urgency_anchor_at: ago(10) };
    assert.equal(getMetrics(task({ ...base, effort: 0.5 }), NOW).actionability, 8);
    assert.equal(getMetrics(task({ ...base, effort: 1.0 }), NOW).actionability, 4);
    assert.equal(getMetrics(task({ ...base, effort: 2.5 }), NOW).actionability, 1.6);
  });

  test("zero effort falls back to weight rather than dividing by zero (defensive, not in brief)", () => {
    assert.equal(getMetrics(task({ effort: 0, urgency_anchor_at: ago(10) }), NOW).actionability, 4);
  });

  test("frozen task holds its clock at frozen_at", () => {
    const m = getMetrics(task({ state: "frozen", urgency_anchor_at: ago(10), frozen_at: ago(5) }), NOW);
    assert.equal(m.elapsedDays, 5);
    assert.equal(m.statusText, "FROZEN");
  });

  test("hidden task keeps advancing as if active", () => {
    const hidden = getMetrics(task({ state: "hidden", urgency_anchor_at: ago(12) }), NOW);
    const active = getMetrics(task({ state: "active", urgency_anchor_at: ago(12) }), NOW);
    assert.equal(hidden.elapsedDays, 12);
    assert.equal(hidden.weight, active.weight);
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

describe("significance tiers compared", () => {
  const TIERS = [1.0, 1.6, 2.5, 4.0];
  const metricsAt = (significance, days, extra = {}) =>
    getMetrics(task({ significance, urgency_anchor_at: ago(days), ...extra }), NOW);

  test("equal elapsed fraction ranks strictly by tier in every phase", () => {
    for (const days of [1, 5, 10, 15, 25]) {
      const weights = TIERS.map(s => metricsAt(s, days).weight);
      for (let i = 1; i < weights.length; i++) {
        assert.ok(weights[i] > weights[i - 1], `x=${days / 10}: ${weights}`);
      }
    }
  });

  test("tier ratio follows dynamic expansion pre-epoch and locks to S post-epoch", () => {
    // Pre-epoch: ratio relative to Tier 1 is 1.0 + (S - 1.0) * x
    for (const days of [3, 7]) {
      const x = days / 10;
      const base = metricsAt(1.0, days).weight;
      TIERS.forEach(s => {
        const expectedRatio = 1.0 + (s - 1.0) * x;
        assert.ok(Math.abs(metricsAt(s, days).weight / base - expectedRatio) < 0.02, `S=${s} x=${x}`);
      });
    }
    // Post-epoch (x >= 1.0): ratio locks to S
    for (const days of [10, 18]) {
      const base = metricsAt(1.0, days).weight;
      TIERS.forEach(s => {
        assert.ok(Math.abs(metricsAt(s, days).weight / base - s) < 0.02, `S=${s} post-epoch`);
      });
    }
  });

  test("anti-drowning: moderately overdue lower tier outranks high tier that is far from due", () => {
    const tier4QuarterDue = metricsAt(4.0, 2.5).weight; // x = 0.25 -> W = 0.94
    const tier1Overdue = metricsAt(1.0, 15).weight;     // x = 1.50 -> W = 2.00
    assert.ok(tier1Overdue > tier4QuarterDue, `Tier 1 overdue (${tier1Overdue}) should beat Tier 4 at x=0.25 (${tier4QuarterDue})`);
  });

  test("anti-drowning: scenario test with long-interval high tiers vs overdue routine task", () => {
    // Task A: Routine (S=1.0, T=15), 2 days overdue (elapsed = 17d, x = 1.13)
    const taskA = getMetrics(task({ significance: 1.0, interval_days: 15, urgency_anchor_at: ago(17) }), NOW);
    // Task B: Important (S=2.5, T=21), due in 11 days (elapsed = 10d, x = 0.48)
    const taskB = getMetrics(task({ significance: 2.5, interval_days: 21, urgency_anchor_at: ago(10) }), NOW);
    // Task C: Important (S=2.5, T=30), due in 20 days (elapsed = 10d, x = 0.33)
    const taskC = getMetrics(task({ significance: 2.5, interval_days: 30, urgency_anchor_at: ago(10) }), NOW);

    assert.equal(taskA.weight, 1.20);
    assert.equal(taskB.weight, 1.25);
    assert.equal(taskC.weight, 0.92);

    // Task A outranks Task C
    assert.ok(taskA.weight > taskC.weight, "Overdue routine task A must outrank distant important task C");
  });

  test("tier never changes elapsed time or daily cost", () => {
    for (const recurring of [1, 0]) {
      const results = TIERS.map(s => metricsAt(s, 6, { is_recurring: recurring }));
      for (const m of results) {
        assert.equal(m.elapsedDays, results[0].elapsedDays);
        assert.equal(m.x, results[0].x);
        assert.equal(m.dailyCostAu, results[0].dailyCostAu);
        assert.equal(m.statusText, results[0].statusText);
      }
    }
  });

  test("tier 4 on time equals tier 1 one interval overdue", () => {
    assert.ok(Math.abs(metricsAt(4.0, 10).weight - metricsAt(1.0, 20).weight) < 0.01);
  });

  test("a lower tier overtakes a higher tier at its overdue crossover", () => {
    // Tier 1 passes a tier at x = 1 once x > 1 + ln(S) / b
    const crossovers = [
      { higher: 1.6, before: 13, after: 14 },
      { higher: 2.5, before: 16, after: 17 },
      { higher: 4.0, before: 19, after: 21 }
    ];
    for (const { higher, before, after } of crossovers) {
      const target = metricsAt(higher, 10).weight;
      assert.ok(metricsAt(1.0, before).weight < target, `tier 1 at ${before}d should trail S=${higher}`);
      assert.ok(metricsAt(1.0, after).weight > target, `tier 1 at ${after}d should lead S=${higher}`);
    }
  });



  // Dynamic significance keeps higher tiers strictly increasing across 0 <= x <= 1
  test("higher tier weights remain strictly increasing across 0 <= x <= 1", () => {
    for (const S of [1.6, 2.5, 4.0]) {
      const w = days => getMetrics(task({ significance: S, urgency_anchor_at: ago(days) }), NOW).weight;
      const samples = [0, 2, 4, 6, 8, 10].map(w);
      for (let i = 1; i < samples.length; i++) {
        assert.ok(samples[i] > samples[i - 1], `S=${S} failed monotonic increase at step ${i}`);
      }
    }
  });

  test("a fresh task has zero weight regardless of tier", () => {
    for (const s of TIERS) assert.equal(metricsAt(s, 0).weight, 0);
  });

  test("actionability trades tier against effort", () => {
    const heavyCritical = metricsAt(4.0, 10, { effort: 2.5 }).actionability;
    const quickRoutine = metricsAt(1.0, 10, { effort: 0.5 }).actionability;
    const quickCritical = metricsAt(4.0, 10, { effort: 0.5 }).actionability;
    assert.equal(heavyCritical, 1.6);
    assert.equal(quickRoutine, 2);
    assert.equal(quickCritical, 8);
    assert.ok(quickRoutine > heavyCritical);
    assert.ok(quickCritical > quickRoutine);
  });

  test("summary weight sums tiers while capacity load ignores them", () => {
    const anchor = new Date(Date.now() - 10 * DAY).toISOString();
    const tasks = TIERS.map(s => task({ significance: s, urgency_anchor_at: anchor }));
    const mixed = getSummary(tasks);
    const uniform = getSummary(TIERS.map(() => task({ significance: 1.0, urgency_anchor_at: anchor })));
    assert.equal(mixed.total_weight, 9.1);
    assert.equal(uniform.total_weight, 4);
    assert.equal(mixed.total_active_cost_au, uniform.total_active_cost_au);
    assert.deepEqual(mixed.domain_loads, uniform.domain_loads);
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

  test("domain caps match the brief and sum to the 12 AU baseline", () => {
    const { domain_loads } = getSummary([]);
    assert.equal(domain_loads.executive_mental.max, 5);
    assert.equal(domain_loads.physical_somatic.max, 4);
    assert.equal(domain_loads.social_relational.max, 3);
    const sum = Object.values(domain_loads).reduce((n, d) => n + d.max, 0);
    assert.equal(sum, getSummary([]).effective_capacity_au);
  });

  test("active tasks are grouped by domain using E / T", () => {
    const recent = { urgency_anchor_at: new Date().toISOString() };
    const s = getSummary([
      task({ ...recent, domain: "physical_somatic", interval_days: 4, effort: 1.0 }),
      task({ ...recent, domain: "social_relational", interval_days: 10, effort: 2.5 })
    ]);
    assert.equal(s.domain_loads.physical_somatic.current, 0.25);
    assert.equal(s.domain_loads.social_relational.current, 0.25);
    assert.equal(s.total_active_cost_au, 0.5);
  });

  // Brief todo_states: only active tasks feed urgency, capacity and leaderboard
  test("frozen, hidden, paused and completed tasks contribute no load or weight", () => {
    const old = { urgency_anchor_at: new Date(Date.now() - 30 * DAY).toISOString() };
    for (const state of ["frozen", "hidden", "paused", "completed"]) {
      const s = getSummary([task({ ...old, state, frozen_at: old.urgency_anchor_at, last_completed_at: old.urgency_anchor_at })]);
      assert.equal(s.total_weight, 0, state);
      assert.equal(s.total_active_cost_au, 0, state);
    }
  });

  test("once-off tasks load by their ramp, recurring by E / T", () => {
    const due = { urgency_anchor_at: new Date(Date.now() - 10 * DAY).toISOString(), effort: 2.5 };
    const s = getSummary([
      task({ ...due, is_recurring: 0, domain: "physical_somatic" }),
      task({ ...due, is_recurring: 1, domain: "social_relational" })
    ]);
    assert.equal(s.domain_loads.physical_somatic.current, 2.5);
    assert.equal(s.domain_loads.social_relational.current, 0.25);
  });

  // Not specified by the brief: tasks outside the three channels still count toward the total.
  test("unknown domains add to total but not to any domain load", () => {
    const s = getSummary([task({ urgency_anchor_at: new Date().toISOString(), domain: "other" })]);
    assert.equal(s.total_active_cost_au, 0.1);
    assert.equal(s.domain_loads.executive_mental.current, 0);
  });

  // Not specified by the brief (it replaces capacity sliders with vacations): legacy energy_factor.
  test("energy factor is clamped between 0.1 and 1", () => {
    assert.equal(getSummary([], 0.5).effective_capacity_au, 6);
    assert.equal(getSummary([], 0).effective_capacity_au, 1.2);
    assert.equal(getSummary([], 5).effective_capacity_au, 12);
  });
});
