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
    assert.equal((await call("POST", "/api/v1/tasks", { title: 1 })).status, 400);
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

  test("PATCH /state=completed sets last_completed_at (BUG-7)", async () => {
    const t = await create({ title: "to-be-completed", interval_days: 10, days_ago: 4, is_recurring: false });
    const r = await call("PATCH", `/api/v1/tasks/${t.id}/state`, { state: "completed" });
    assert.equal(r.status, 200);
    assert.equal(r.body.task.state, "completed");
    // BUG-7: currently last_completed_at is null; after fix it is set so getMetrics holds the clock
    assert.ok(r.body.task.last_completed_at, "last_completed_at should be set when completing via PATCH");
    assert.equal(r.body.task.urgency_anchor_at, t.urgency_anchor_at);
  });

  test("sorts by due proximity (absolute offset) not weight", async () => {
    // Create with controlled due offsets via days_ago relative to interval
    // due today: offset ~0
    await create({ title: "due-today", interval_days: 10, days_ago: 10 });
    // overdue 1: offset ~-1d
    await create({ title: "overdue-1", interval_days: 10, days_ago: 11 });
    // due in 2: offset ~+2d
    await create({ title: "due-in-2", interval_days: 10, days_ago: 8 });
    // overdue 3: offset ~-3d
    await create({ title: "overdue-3", interval_days: 10, days_ago: 13 });
    // far high weight task should not come first
    await create({ title: "far-high", interval_days: 10, days_ago: 30, significance: 4.0 });

    const dueSorted = (await call("GET", "/api/v1/tasks?sort=due")).body.tasks.map(t => t.title);
    assert.deepEqual(dueSorted, ["due-today", "overdue-1", "due-in-2", "overdue-3", "far-high"]);
  });

  test("sort=due tie-breaks overdue before future at equal distance, then by id (engine level for precision)", async () => {
    // Due to sequential Date.now() in create, exact abs equality is timing-dependent in API.
    // Rely on engine unit test for the signed tie-break; here just ensure sort=due works without error
    // and that a very close overdue beats a farther future.
    const oClose = await create({ title: "o-close", interval_days: 10, days_ago: 10.1 }); // ~ -0.1d overdue
    const fFar = await create({ title: "f-far", interval_days: 10, days_ago: 8 }); // +2d future

    const r = (await call("GET", "/api/v1/tasks?sort=due")).body.tasks.map(t => t.title);
    const idxO = r.indexOf("o-close");
    const idxF = r.indexOf("f-far");
    assert.ok(idxO < idxF, "closer (slightly overdue) should precede farther future");
  });

  test("sort=due composes with filter and limit", async () => {
    const act1 = await create({ title: "act-close", interval_days: 5, days_ago: 5 }); // due today
    const paused = await create({ title: "paused-over", interval_days: 5, days_ago: 6 });
    await call("PATCH", `/api/v1/tasks/${paused.id}/state`, { state: "paused" });
    const actFar = await create({ title: "act-far", interval_days: 5, days_ago: 0 }); // due in 5

    // filter active + sort due
    const activeDue = (await call("GET", "/api/v1/tasks?filter=active&sort=due")).body.tasks.map(t => t.title);
    assert.deepEqual(activeDue, ["act-close", "act-far"]);

    // filter all + sort due: today (act-close) is closest, then 1d-overdue paused, then +5d
    const allDue = (await call("GET", "/api/v1/tasks?filter=all&sort=due")).body.tasks.map(t => t.title);
    assert.equal(allDue[0], "act-close");
    const idxPaused = allDue.indexOf("paused-over");
    const idxFar = allDue.indexOf("act-far");
    assert.ok(idxPaused < idxFar);

    const limited = (await call("GET", "/api/v1/tasks?sort=due&limit=2")).body.tasks.map(t => t.title);
    assert.equal(limited.length, 2);
    assert.equal(limited[0], "act-close");
  });
});

describe("tier and preset validation", () => {
  const BAD_SIGNIFICANCE = [5, 0, -1, 0.3, 1.5, "2.5", null];
  const BAD_EFFORT = [0, -1, 2, 5, 0.25, "1.0", null];

  test("accepts every valid tier and preset on create", async () => {
    for (const significance of [1.0, 1.6, 2.5, 4.0]) {
      assert.equal((await call("POST", "/api/v1/tasks", { title: "t", significance })).status, 201);
    }
    for (const effort of [0.5, 1.0, 2.5]) {
      assert.equal((await call("POST", "/api/v1/tasks", { title: "t", effort })).status, 201);
    }
  });

  test("rejects invalid significance and effort on create", async () => {
    for (const significance of BAD_SIGNIFICANCE) {
      const r = await call("POST", "/api/v1/tasks", { title: "t", significance });
      assert.equal(r.status, 400, `significance ${JSON.stringify(significance)}`);
      assert.match(r.body.error, /significance/);
    }
    for (const effort of BAD_EFFORT) {
      const r = await call("POST", "/api/v1/tasks", { title: "t", effort });
      assert.equal(r.status, 400, `effort ${JSON.stringify(effort)}`);
      assert.match(r.body.error, /effort/);
    }
    assert.equal((await call("GET", "/api/v1/tasks?filter=all")).body.tasks.length, 0);
  });

  test("rejects invalid values on update and leaves the task unchanged", async () => {
    const t = await create({ title: "t", significance: 2.5, effort: 0.5 });
    assert.equal((await call("PUT", `/api/v1/tasks/${t.id}`, { significance: 5 })).status, 400);
    assert.equal((await call("PUT", `/api/v1/tasks/${t.id}`, { effort: 3 })).status, 400);
    const after = (await call("GET", `/api/v1/tasks/${t.id}`)).body.task;
    assert.equal(after.significance, 2.5);
    assert.equal(after.effort, 0.5);
  });

  test("partial update with valid or absent fields still works", async () => {
    const t = await create({ title: "t" });
    const r = await call("PUT", `/api/v1/tasks/${t.id}`, { significance: 4.0 });
    assert.equal(r.status, 200);
    assert.equal(r.body.task.significance, 4);
    assert.equal(r.body.task.effort, 1);
  });

  test("defaults still apply when fields are omitted", async () => {
    const t = await create({ title: "t" });
    assert.equal(t.significance, 1);
    assert.equal(t.effort, 1);
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

  test("update rejects blank and non-string titles", async () => {
    const t = await create({ title: "A" });
    for (const title of ["   ", null, 1]) {
      assert.equal((await call("PUT", `/api/v1/tasks/${t.id}`, { title })).status, 400);
    }
    assert.equal((await call("GET", `/api/v1/tasks/${t.id}`)).body.task.title, "A");
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

  test("import normalizes off-tier values instead of rejecting them", async () => {
    const todo = { id: 1, title: "old", created_at: new Date().toISOString(), urgency_anchor_at: new Date().toISOString(), interval_days: 7, significance: 5, effort: 3, domain: "executive_mental" };
    assert.equal((await call("POST", "/api/v1/import", { todos: [todo] })).status, 200);
    const t = (await call("GET", "/api/v1/tasks/1")).body.task;
    assert.equal(t.significance, 4);
    assert.equal(t.effort, 2.5);
  });
});
