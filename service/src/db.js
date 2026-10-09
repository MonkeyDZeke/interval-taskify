const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "../data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(path.join(dataDir, "tasks.db"));
db.exec("PRAGMA journal_mode = WAL;");

// Database initialization
db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_completed_at TEXT,
    urgency_anchor_at TEXT NOT NULL,
    interval_days REAL NOT NULL,
    significance REAL NOT NULL,
    effort REAL NOT NULL,
    domain TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    frozen_at TEXT
  );

  CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    todo_id INTEGER NOT NULL,
    completed_at TEXT NOT NULL,
    FOREIGN KEY(todo_id) REFERENCES todos(id) ON DELETE CASCADE
  );
`);

// Ordered, additive migrations tracked via PRAGMA user_version. Each runs once;
// the column checks keep them safe against databases that were altered manually.
const MIGRATIONS = [
  function addIsRecurring() {
    const cols = db.prepare("PRAGMA table_info(todos)").all();
    if (!cols.some(c => c.name === "is_recurring")) {
      db.exec("ALTER TABLE todos ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 1");
    }
  }
];

function runMigrations() {
  const current = db.prepare("PRAGMA user_version").get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      MIGRATIONS[v]();
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

runMigrations();

function toRecurringFlag(value, fallback = 1) {
  if (value === undefined || value === null) return fallback;
  return value === false || value === 0 || value === "0" || value === "false" ? 0 : 1;
}

function getAllTasks() {
  return db.prepare("SELECT * FROM todos ORDER BY id ASC").all();
}

function getTaskById(id) {
  return db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
}

function createTask(data) {
  const nowMs = Date.now();
  const daysAgo = Number(data.days_ago) || 0;
  const anchorMs = nowMs - (daysAgo * 86400000);
  const anchorIso = new Date(anchorMs).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  const stmt = db.prepare(`
    INSERT INTO todos (title, created_at, last_completed_at, urgency_anchor_at, interval_days, significance,     effort, domain, state, is_recurring)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `);

  const isRecurring = toRecurringFlag(data.is_recurring);

  const info = stmt.run(
    data.title,
    nowIso,
    isRecurring && daysAgo > 0 ? anchorIso : null,
    anchorIso,
    Number(data.interval_days) || 7,
    Number(data.significance) || 1.0,
    Number(data.effort) || 1.0,
    data.domain || "executive_mental",
    toRecurringFlag(data.is_recurring)
  );

  return getTaskById(Number(info.lastInsertRowid));
}

function updateTask(id, data) {
  const existing = getTaskById(id);
  if (!existing) return null;

  const nowMs = Date.now();
  let anchorIso = existing.urgency_anchor_at;
  let lastCompletedIso = existing.last_completed_at;

  if (data.days_ago !== undefined) {
    const daysAgo = Number(data.days_ago);
    const anchorMs = nowMs - (daysAgo * 86400000);
    anchorIso = new Date(anchorMs).toISOString();
    lastCompletedIso = daysAgo > 0 ? anchorIso : null;
  }

  const stmt = db.prepare(`
    UPDATE todos
    SET title = ?, interval_days = ?, significance = ?, effort = ?, domain = ?,     urgency_anchor_at = ?, last_completed_at = ?, is_recurring = ?
    WHERE id = ?
  `);

  stmt.run(
    data.title !== undefined ? data.title : existing.title,
    data.interval_days !== undefined ? Number(data.interval_days) : existing.interval_days,
    data.significance !== undefined ? Number(data.significance) : existing.significance,
    data.effort !== undefined ? Number(data.effort) : existing.effort,
    data.domain !== undefined ? data.domain : existing.domain,
    anchorIso,
    lastCompletedIso,
    toRecurringFlag(data.is_recurring, existing.is_recurring),
    id
  );

  return getTaskById(id);
}

function completeTask(id) {
  const task = getTaskById(id);
  if (!task || task.state !== "active") return null;

  const nowIso = new Date().toISOString();

  const insertComp = db.prepare("INSERT INTO completions (todo_id, completed_at) VALUES (?, ?)");
  // Once-off tasks keep their anchor (clock halts) and move to the terminal state.
  const updateTodo = task.is_recurring === 0
    ? db.prepare("UPDATE todos SET last_completed_at = ?, state = 'completed', frozen_at = NULL WHERE id = ?")
    : db.prepare("UPDATE todos SET last_completed_at = ?, urgency_anchor_at = ?, frozen_at = NULL WHERE id = ?");

  db.exec("BEGIN");
  try {
    insertComp.run(id, nowIso);
    if (task.is_recurring === 0) {
      updateTodo.run(nowIso, id);
    } else {
      updateTodo.run(nowIso, nowIso, id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return getTaskById(id);
}

function setTaskState(id, newState) {
  const validStates = ["active", "frozen", "hidden", "paused"];
  if (!validStates.includes(newState)) return null;

  const task = getTaskById(id);
  if (!task) return null;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let urgencyAnchor = task.urgency_anchor_at;
  let frozenAt = task.frozen_at;

  if (task.state === "frozen" && newState !== "frozen" && frozenAt) {
    const frozenDuration = nowMs - Date.parse(frozenAt);
    urgencyAnchor = new Date(Date.parse(urgencyAnchor) + frozenDuration).toISOString();
    frozenAt = null;
  }

  if ((task.state === "paused" || task.state === "completed") && newState !== task.state) {
    urgencyAnchor = nowIso;
  }

  if (newState === "frozen" && task.state !== "frozen") {
    frozenAt = nowIso;
  } else if (newState !== "frozen") {
    frozenAt = null;
  }

  const stmt = db.prepare("UPDATE todos SET state = ?, urgency_anchor_at = ?, frozen_at = ? WHERE id = ?");
  stmt.run(newState, urgencyAnchor, frozenAt, id);

  return getTaskById(id);
}

function deleteTask(id) {
  const stmt = db.prepare("DELETE FROM todos WHERE id = ?");
  const info = stmt.run(id);
  return info.changes > 0;
}

function exportData() {
  const todos = getAllTasks();
  const completions = db.prepare("SELECT * FROM completions ORDER BY completed_at ASC").all();
  return {
    version: "1.1",
    exported_at: new Date().toISOString(),
    todos,
    completions
  };
}

function importData(payload) {
  if (!payload || !Array.isArray(payload.todos)) return false;

  const clearTodos = db.prepare("DELETE FROM todos");
  const clearCompletions = db.prepare("DELETE FROM completions");

  const insertTodo = db.prepare(`
    INSERT INTO todos (id, title, created_at, last_completed_at, urgency_anchor_at,     interval_days, significance, effort, domain, state, frozen_at, is_recurring)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCompletion = db.prepare(`
    INSERT INTO completions (todo_id, completed_at) VALUES (?, ?)
  `);

  db.exec("BEGIN");
  try {
    clearTodos.run();
    clearCompletions.run();

    for (const t of payload.todos) {
      insertTodo.run(
        t.id,
        t.title,
        t.created_at,
        t.last_completed_at || null,
        t.urgency_anchor_at,
        t.interval_days,
        t.significance,
        t.effort,
        t.domain,
        t.state || 'active',
        t.frozen_at || null,
        toRecurringFlag(t.is_recurring)
      );
    }

    if (Array.isArray(payload.completions)) {
      for (const c of payload.completions) {
        insertCompletion.run(c.todo_id, c.completed_at);
      }
    }
    db.exec("COMMIT");
    return true;
  } catch (err) {
    db.exec("ROLLBACK");
    return false;
  }
}

module.exports = {
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  completeTask,
  setTaskState,
  deleteTask,
  exportData,
  importData
};
