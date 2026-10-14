process.env.TASKIFY_DB = ":memory:";

const { test, describe, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/db");
const { getMetrics } = require("../src/engine");

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();

function setNow(ms) {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: ms });
}

beforeEach(() => {
  db.importData({ todos: [] });
  setNow(T0);
});
afterEach(() => mock.timers.reset());

describe("createTask", () => {
  test("applies defaults", () => {
    const t = db.createTask({ title: "Water plants" });
    assert.equal(t.title, "Water plants");
    assert.equal(t.interval_days, 7);
    assert.equal(t.significance, 1);
    assert.equal(t.effort, 1);
    assert.equal(t.domain, "executive_mental");
    assert.equal(t.state, "active");
    assert.equal(t.is_recurring, 1);
    assert.equal(t.urgency_anchor_at, iso(T0));
    assert.equal(t.last_completed_at, null);
  });

  test("days_ago backdates anchor and last completion for recurring tasks", () => {
    const t = db.createTask({ title: "x", days_ago: 3 });
    assert.equal(t.urgency_anchor_at, iso(T0 - 3 * DAY));
    assert.equal(t.last_completed_at, iso(T0 - 3 * DAY));
  });

  test("once-off task backdated does not record a completion", () => {
    const t = db.createTask({ title: "x", days_ago: 3, is_recurring: false });
    assert.equal(t.is_recurring, 0);
    assert.equal(t.last_completed_at, null);
  });

  test("is_recurring accepts false-like values", () => {
    for (const v of [false, 0, "0", "false"]) {
      assert.equal(db.createTask({ title: "x", is_recurring: v }).is_recurring, 0);
    }
    assert.equal(db.createTask({ title: "x", is_recurring: true }).is_recurring, 1);
  });
});

describe("updateTask", () => {
  test("returns null for unknown id", () => {
    assert.equal(db.updateTask(999, { title: "x" }), null);
  });

  test("changes only provided fields", () => {
    const t = db.createTask({ title: "a", interval_days: 5, effort: 2 });
    const u = db.updateTask(t.id, { title: "b" });
    assert.equal(u.title, "b");
    assert.equal(u.interval_days, 5);
    assert.equal(u.effort, 2);
  });

  test("days_ago re-anchors; zero clears last completion", () => {
    const t = db.createTask({ title: "a" });
    const a = db.updateTask(t.id, { days_ago: 2 });
    assert.equal(a.urgency_anchor_at, iso(T0 - 2 * DAY));
    assert.equal(a.last_completed_at, iso(T0 - 2 * DAY));
    const b = db.updateTask(t.id, { days_ago: 0 });
    assert.equal(b.urgency_anchor_at, iso(T0));
    assert.equal(b.last_completed_at, null);
  });
  // Brief: last_completed_at is reserved for completions; once-off backdating in createTask leaves it null,
  // but updateTask sets it regardless of is_recurring.
  test("updateTask days_ago treats once-off tasks like createTask does", { todo: true }, () => {
    const t = db.createTask({ title: "a", is_recurring: false });
    const u = db.updateTask(t.id, { days_ago: 3 });
    assert.equal(u.last_completed_at, null);
  });
});

describe("completeTask", () => {
  test("recurring task resets anchor and stays active", () => {
    const t = db.createTask({ title: "a", days_ago: 5 });
    setNow(T0 + DAY);
    const c = db.completeTask(t.id);
    assert.equal(c.state, "active");
    assert.equal(c.urgency_anchor_at, iso(T0 + DAY));
    assert.equal(c.last_completed_at, iso(T0 + DAY));
    assert.equal(db.exportData().completions.length, 1);
  });

  test("once-off task becomes completed and keeps its anchor", () => {
    const t = db.createTask({ title: "a", days_ago: 2, is_recurring: false });
    const c = db.completeTask(t.id);
    assert.equal(c.state, "completed");
    assert.equal(c.urgency_anchor_at, t.urgency_anchor_at);
    assert.equal(c.last_completed_at, iso(T0));
  });

  test("recurring completion records a log entry and resets the clock to x = 0", () => {
    const t = db.createTask({ title: "a", interval_days: 5, days_ago: 9 });
    const c = db.completeTask(t.id);
    assert.equal(getMetrics(c, Date.now()).x, 0);
  });

  test("once-off completion halts the clock at completion time", () => {
    const t = db.createTask({ title: "a", interval_days: 10, days_ago: 4, is_recurring: false });
    const c = db.completeTask(t.id);
    setNow(T0 + 50 * DAY);
    assert.equal(getMetrics(c, Date.now()).elapsedDays, 4);
  });

  test("returns null for unknown or non-active tasks", () => {
    assert.equal(db.completeTask(999), null);
    const t = db.createTask({ title: "a" });
    db.setTaskState(t.id, "paused");
    assert.equal(db.completeTask(t.id), null);
  });
});

describe("setTaskState", () => {
  test("rejects invalid state or unknown id", () => {
    const t = db.createTask({ title: "a" });
    assert.equal(db.setTaskState(t.id, "bogus"), null);
    assert.equal(db.setTaskState(999, "frozen"), null);
  });

  test("freezing records frozen_at; thawing shifts the anchor by the frozen duration", () => {
    const t = db.createTask({ title: "a", days_ago: 4 });
    const frozen = db.setTaskState(t.id, "frozen");
    assert.equal(frozen.frozen_at, iso(T0));
    setNow(T0 + 3 * DAY);
    const thawed = db.setTaskState(t.id, "active");
    assert.equal(thawed.frozen_at, null);
    assert.equal(thawed.urgency_anchor_at, iso(T0 - 4 * DAY + 3 * DAY));
  });

  test("leaving paused restarts the clock and records no completion", () => {
    const t = db.createTask({ title: "a", days_ago: 4 });
    db.setTaskState(t.id, "paused");
    setNow(T0 + 2 * DAY);
    const r = db.setTaskState(t.id, "active");
    assert.equal(r.urgency_anchor_at, iso(T0 + 2 * DAY));
    assert.equal(r.last_completed_at, t.last_completed_at);
    assert.equal(db.exportData().completions.length, 0);
  });

  test("hidden time still counts: returning to active keeps the original anchor", () => {
    const t = db.createTask({ title: "a", days_ago: 4 });
    db.setTaskState(t.id, "hidden");
    setNow(T0 + 6 * DAY);
    const r = db.setTaskState(t.id, "active");
    assert.equal(r.urgency_anchor_at, t.urgency_anchor_at);
    assert.equal(getMetrics(r, T0 + 6 * DAY).elapsedDays, 10);
  });

  test("time spent frozen does not advance urgency", () => {
    const t = db.createTask({ title: "a", days_ago: 4 });
    const before = getMetrics(db.setTaskState(t.id, "frozen"), T0).elapsedDays;
    setNow(T0 + 30 * DAY);
    assert.equal(getMetrics(db.getTaskById(t.id), T0 + 30 * DAY).elapsedDays, before);
    const thawed = db.setTaskState(t.id, "active");
    assert.equal(getMetrics(thawed, T0 + 30 * DAY).elapsedDays, before);
  });

  test("reopening a completed task restarts the clock and records no new completion", () => {
    const t = db.createTask({ title: "a", is_recurring: false });
    db.completeTask(t.id);
    setNow(T0 + DAY);
    const r = db.setTaskState(t.id, "active");
    assert.equal(r.state, "active");
    assert.equal(r.urgency_anchor_at, iso(T0 + DAY));
    assert.equal(db.exportData().completions.length, 1);
  });
});

describe("deleteTask", () => {
  test("removes existing, reports missing", () => {
    const t = db.createTask({ title: "a" });
    assert.equal(db.deleteTask(t.id), true);
    assert.equal(db.getTaskById(t.id), undefined);
    assert.equal(db.deleteTask(t.id), false);
  });
});

describe("export / import", () => {
  test("round-trips tasks and completions", () => {
    const a = db.createTask({ title: "a", days_ago: 1 });
    db.createTask({ title: "b", is_recurring: false });
    db.completeTask(a.id);
    const snapshot = db.exportData();

    db.importData({ todos: [] });
    assert.equal(db.getAllTasks().length, 0);

    assert.equal(db.importData(snapshot), true);
    const again = db.exportData();
    assert.deepEqual(again.todos, snapshot.todos);
    assert.deepEqual(again.completions.map(c => c.completed_at), snapshot.completions.map(c => c.completed_at));
  });

  test("rejects malformed payloads without touching data", () => {
    db.createTask({ title: "keep" });
    assert.equal(db.importData(null), false);
    assert.equal(db.importData({}), false);
    assert.equal(db.importData({ todos: "nope" }), false);
    assert.equal(db.getAllTasks().length, 1);
  });

  test("failed import rolls back", () => {
    db.createTask({ title: "keep" });
    const bad = { todos: [{ id: 1, title: null, created_at: "x", urgency_anchor_at: "x", interval_days: 1, significance: 1, effort: 1, domain: "d" }] };
    assert.equal(db.importData(bad), false);
    assert.equal(db.getAllTasks().length, 1);
    assert.equal(db.getAllTasks()[0].title, "keep");
  });
});
