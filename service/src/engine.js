const A = 10.0;
const B = 1.386;

const DOMAIN_CAPACITIES = {
  executive_mental: 5.0,
  physical_somatic: 4.0,
  social_relational: 3.0
};

/**
 * Calculates current urgency weight W(x) and elapsed time metrics for a task.
 */
function getMetrics(task, nowMs = Date.now()) {
  const intervalDays = Number(task.interval_days);
  const significance = Number(task.significance);
  const effort = Number(task.effort);
  const anchorMs = Date.parse(task.urgency_anchor_at);

  if (!isFinite(intervalDays) || intervalDays <= 0 || !isFinite(anchorMs)) {
    return { elapsedDays: 0, x: 0, weight: 0, dailyCostAu: 0, actionability: 0, statusText: "Invalid" };
  }

  // Handle frozen state: time freeze anchors at frozen_at timestamp
  const effectiveNowMs = (task.state === "frozen" && task.frozen_at)
    ? Date.parse(task.frozen_at)
    : nowMs;

  const elapsedDays = Math.max(0, (effectiveNowMs - anchorMs) / 86400000);
  const x = elapsedDays / intervalDays;

  // W(x): Logarithmic phase (x <= 1) vs. Exponential phase (x > 1)
  const weight = x <= 1.0
    ? significance * (Math.log(1.0 + A * x) / Math.log(1.0 + A))
    : significance * Math.exp(B * (x - 1.0));

  const dailyCostAu = effort / intervalDays;
  const actionability = effort > 0 ? weight / effort : weight;

  // Human-readable status string
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
    dailyCostAu: Number(dailyCostAu.toFixed(3)),
    actionability: Number(actionability.toFixed(2)),
    statusText
  };
}

/**
 * Calculates system capacity summaries and domain load allocations.
 */
function getSummary(tasks, energyFactor = 1.0) {
  const load = { executive_mental: 0, physical_somatic: 0, social_relational: 0 };
  let totalCostAu = 0;
  let totalWeight = 0;

  for (const task of tasks) {
    if (task.state !== "active") continue;
    const metrics = getMetrics(task);
    totalWeight += metrics.weight;

    if (load[task.domain] !== undefined) {
      load[task.domain] += metrics.dailyCostAu;
    }
    totalCostAu += metrics.dailyCostAu;
  }

  const baselineCeiling = 12.0;
  const effectiveCapacityAu = baselineCeiling * Math.max(0.1, Math.min(1.0, energyFactor));

  return {
    total_weight: Number(totalWeight.toFixed(2)),
    total_active_cost_au: Number(totalCostAu.toFixed(2)),
    effective_capacity_au: Number(effectiveCapacityAu.toFixed(2)),
    energy_factor: energyFactor,
    domain_loads: {
      executive_mental: { current: Number(load.executive_mental.toFixed(2)), max: DOMAIN_CAPACITIES.executive_mental },
      physical_somatic: { current: Number(load.physical_somatic.toFixed(2)), max: DOMAIN_CAPACITIES.physical_somatic },
      social_relational: { current: Number(load.social_relational.toFixed(2)), max: DOMAIN_CAPACITIES.social_relational }
    }
  };
}

module.exports = {
  getMetrics,
  getSummary
};
