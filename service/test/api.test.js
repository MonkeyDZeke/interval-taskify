process.env.TASKIFY_DB = ":memory:";

const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../src/app");
const db = require("../src/db");

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());
beforeEach(() => db.importData({ todos: [] }));

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

const create = body => call("POST", "/api/v1/tasks", body).then(r => r.body.task);

test("health check", async () => {
  const r = await call("GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "ok");
});

describe("POST /tasks", () => {
  test("creates a task with metrics", async () => {
    const r = await call("POST", "/api/v1/tasks", { title: "A", interval_days: 10, days_ago: 10,     significance: 4.0 });
    assert.equal(r.status, 201);
        assert.equal(r.body.task.metrics.weight, 4);
  });

  test("rejects missing or blank title", async () => {
    assert.equal((await call("POST", "/api/v1/tasks", {})).status, 400);
    assert.equal((await call("POST", "/api/v1/tasks", { title: "   " })).status, 400);
  });
});

describe("GET /tasks", () => {
  test("sorts by weight by default and honours limit", async () => {
    await create({ title: "low", interval_days: 10, days_ago: 1 });
    await create({ title: "high", interval_days: 10, days_ago: 20 });
    await create({ title: "mid", interval_days: 10, days_ago: 8 });
    const all = (await call("GET", "/api/v1/tasks")).body.tasks;
    assert.deepEqual(all.map(t => t.title), ["high", "mid", "low"]);
    const limited = (await call("GET", "/api/v1/tasks?limit=2")).body.tasks;
    assert.equal(limited.length, 2);
  });

  test("sorts by title", async () => {
    await create({ title: "b" });
    await create({ title: "a" });
    const r = await call("GET", "/api/v1/tasks?sort=title");
    assert.deepEqual(r.body.tasks.map(t => t.title), ["a", "b"]);
  });

  test("filters by state and domain", async () => {
    const a = await create({ title: "active-phys", domain: "physical_somatic" });
    const b = await create({ title: "paused" });
    const c = await create({ title: "done", is_recurring: false });
    await call("PATCH", `/api/v1/tasks/${b.id}/state`, { state: "paused" });
    await call("POST", `/api/v1/tasks/${c.id}/complete`);

    const titles = async q => (await call("GET", "/api/v1/tasks" + q)).body.tasks.map(t => t.title).sort();
    assert.deepEqual(await titles(""), ["active-phys"]);
    assert.deepEqual(await titles("?filter=inactive"), ["paused"]);
    assert.deepEqual(await titles("?filter=completed"), ["done"]);
    assert.deepEqual(await titles("?filter=all"), ["active-phys", "done", "paused"]);
    assert.deepEqual(await titles("?domain=physical_somatic"), ["active-phys"]);
    assert.ok(a.id);
  });
});

describe("tiers via the API", () => {
  const TIERS = [1.0, 1.6, 2.5, 4.0];

  test("equally overdue tasks are ranked by tier, highest first", async () => {
    for (const significance of TIERS) {
      await create({ title: `S${significance}`, interval_days: 10, days_ago: 10, significance });
    }
    const r = await call("GET", "/api/v1/tasks");
    assert.deepEqual(r.body.tasks.map(t => t.significance), [4.0, 2.5, 1.6, 1.0]);
    assert.deepEqual(r.body.tasks.map(t => t.metrics.weight), [4, 2.5, 1.6, 1]);
  });

  test("a heavily overdue tier 1 task outranks an on-time tier 4 task", async () => {
    await create({ title: "critical", interval_days: 10, days_ago: 10, significance: 4.0 });
    await create({ title: "routine", interval_days: 10, days_ago: 21, significance: 1.0 });
    const top = (await call("GET", "/api/v1/tasks/top?limit=1")).body.tasks[0];
    assert.equal(top.title, "routine");
  });

  test("actionability sort favours low effort over raw tier", async () => {
    await create({ title: "heavy-critical", interval_days: 10, days_ago: 10, significance: 4.0, effort: 2.5 });
    await create({ title: "quick-routine", interval_days: 10, days_ago: 10, significance: 1.0, effort: 0.5 });
    const r = await call("GET", "/api/v1/tasks?sort=actionability");
    assert.deepEqual(r.body.tasks.map(t => t.title), ["quick-routine", "heavy-critical"]);
    const byWeight = await call("GET", "/api/v1/tasks?sort=weight");
    assert.deepEqual(byWeight.body.tasks.map(t => t.title), ["heavy-critical", "quick-routine"]);
  });
});

test("GET /tasks/top returns top 3 active by default", async () => {
  for (let i = 1; i <= 5; i++) await create({ title: `t${i}`, interval_days: 10, days_ago: i });
  const r = await call("GET", "/api/v1/tasks/top");
  assert.deepEqual(r.body.tasks.map(t => t.title), ["t5", "t4", "t3"]);
  assert.equal((await call("GET", "/api/v1/tasks/top?limit=1")).body.tasks.length, 1);
});

describe("single-task routes", () => {
  test("get / update / 404", async () => {
    const t = await create({ title: "A" });
    assert.equal((await call("GET", `/api/v1/tasks/${t.id}`)).body.task.title, "A");
    assert.equal((await call("PUT", `/api/v1/tasks/${t.id}`, { title: "B" })).body.task.title, "B");
    assert.equal((await call("GET", "/api/v1/tasks/999")).status, 404);
    assert.equal((await call("PUT", "/api/v1/tasks/999", { title: "x" })).status, 404);
  });

  test("complete resets a recurring task; 404 for unknown", async () => {
    const t = await create({ title: "A", interval_days: 5, days_ago: 9 });
    const r = await call("POST", `/api/v1/tasks/${t.id}/complete`);
    assert.equal(r.status, 200);
    assert.equal(r.body.task.metrics.weight, 0);
    assert.equal((await call("POST", "/api/v1/tasks/999/complete")).status, 404);
  });

  test("state changes validate input", async () => {
    const t = await create({ title: "A" });
    const ok = await call("PATCH", `/api/v1/tasks/${t.id}/state`, { state: "frozen" });
    assert.equal(ok.body.task.state, "frozen");
    assert.equal((await call("PATCH", `/api/v1/tasks/${t.id}/state`, { state: "nope" })).status, 400);
    assert.equal((await call("PATCH", "/api/v1/tasks/999/state", { state: "active" })).status, 400);
  });

  test("delete", async () => {
    const t = await create({ title: "A" });
    assert.deepEqual((await call("DELETE", `/api/v1/tasks/${t.id}`)).body, { success: true });
    assert.equal((await call("DELETE", `/api/v1/tasks/${t.id}`)).status, 404);
  });
});

test("GET /summary reflects tasks and energy factor", async () => {
  await create({ title: "A", interval_days: 10, effort: 2.5, domain: "physical_somatic" });
  const r = await call("GET", "/api/v1/summary?energy_factor=0.5");
  assert.equal(r.body.effective_capacity_au, 6);
  assert.equal(r.body.domain_loads.physical_somatic.current, 0.25);
});

test("only active tasks appear on the leaderboard and default list", async () => {
  const states = ["frozen", "hidden", "paused"];
  const keep = await create({ title: "active", interval_days: 10, days_ago: 10 });
  for (const state of states) {
    const t = await create({ title: state, interval_days: 10, days_ago: 30 });
    await call("PATCH", `/api/v1/tasks/${t.id}/state`, { state });
  }
  const done = await create({ title: "completed", interval_days: 10, days_ago: 30, is_recurring: false });
  await call("POST", `/api/v1/tasks/${done.id}/complete`);

  for (const path of ["/api/v1/tasks", "/api/v1/tasks/top"]) {
    const r = await call("GET", path);
    assert.deepEqual(r.body.tasks.map(t => t.id), [keep.id], path);
  }
  const summary = (await call("GET", "/api/v1/summary")).body;
  assert.equal(summary.total_weight, 1);
});

describe("export / import", () => {
  test("round-trip through the API", async () => {
    await create({ title: "A" });
    const exported = (await call("GET", "/api/v1/export")).body;
    await call("DELETE", `/api/v1/tasks/${exported.todos[0].id}`);
    assert.equal((await call("POST", "/api/v1/import", exported)).status, 200);
    assert.equal((await call("GET", "/api/v1/tasks")).body.tasks.length, 1);
  });

  test("rejects invalid backup", async () => {
    assert.equal((await call("POST", "/api/v1/import", { nope: true })).status, 400);
  });
});
