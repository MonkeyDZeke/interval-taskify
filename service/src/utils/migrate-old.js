// service/src/migrate-old.js
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const oldDbPath = process.argv[2];
if (!oldDbPath) {
  console.error("Please provide the path to your old .sqlite file!");
  console.error("Usage: node src/utils/migrate-old.js /path/to/old_file.sqlite");
  process.exit(1);
}

try {
  const oldDb = new DatabaseSync(oldDbPath);
  const oldTodos = oldDb.prepare("SELECT * FROM todos").all();

  let oldCompletions = [];
  try {
    oldCompletions = oldDb.prepare("SELECT * FROM completions").all();
  } catch (e) {
    // ignore if empty
  }

  console.log(`Found ${oldTodos.length} tasks and ${oldCompletions.length} completions in old database.`);

  const newDb = new DatabaseSync(path.join(__dirname, "../../data/tasks.db"));

  const insertTodo = newDb.prepare(`
    INSERT INTO todos (title, created_at, last_completed_at, urgency_anchor_at, interval_days, significance, effort, domain, state, frozen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCompletion = newDb.prepare(`
    INSERT INTO completions (todo_id, completed_at) VALUES (?, ?)
  `);

  newDb.exec("BEGIN");

  const idMap = {};
  for (const t of oldTodos) {
    const info = insertTodo.run(
      t.title,
      t.created_at,
      t.last_completed_at || null,
      t.urgency_anchor_at,
      t.interval_days,
      t.significance,
      t.effort,
      t.domain,
      t.state || 'active',
      t.frozen_at || null
    );
    idMap[t.id] = Number(info.lastInsertRowid);
  }

  for (const c of oldCompletions) {
    const newId = idMap[c.todo_id];
    if (newId) {
      insertCompletion.run(newId, c.completed_at);
    }
  }

  newDb.exec("COMMIT");
  console.log("Successfully migrated all tasks into the new service database!");
} catch (err) {
  console.error("Migration failed:", err);
}
