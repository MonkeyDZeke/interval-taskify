const express = require("express");
const db = require("./db");
const engine = require("./engine");

const router = express.Router();

// GET /api/v1/tasks - Get filtered & sorted tasks with metrics
router.get("/tasks", (req, res) => {
  const { filter = "active", domain, sort = "weight", limit } = req.query;
  let tasks = db.getAllTasks();

  // Filter
  tasks = tasks.filter(task => {
    if (filter === "active" && task.state !== "active") return false;
    if (filter === "inactive" && task.state === "active") return false;
    if (domain && task.domain !== domain) return false;
    return true;
  });

  // Attach metrics
  let decorated = tasks.map(task => ({
    ...task,
    metrics: engine.getMetrics(task)
  }));

  // Sort
  if (sort === "weight") {
    decorated.sort((a, b) => b.metrics.weight - a.metrics.weight);
  } else if (sort === "actionability") {
    decorated.sort((a, b) => b.metrics.actionability - a.metrics.actionability);
  } else if (sort === "title") {
    decorated.sort((a, b) => a.title.localeCompare(b.title));
  }

  // Limit
  if (limit && !isNaN(limit)) {
    decorated = decorated.slice(0, Number(limit));
  }

  res.json({ tasks: decorated });
});

// GET /api/v1/tasks/top - Convenience endpoint for today's top priorities
router.get("/tasks/top", (req, res) => {
  const limit = Number(req.query.limit) || 3;
  const tasks = db.getAllTasks()
    .filter(t => t.state === "active")
    .map(t => ({ ...t, metrics: engine.getMetrics(t) }))
    .sort((a, b) => b.metrics.weight - a.metrics.weight)
    .slice(0, limit);

  res.json({ tasks });
});

// GET /api/v1/tasks/:id
router.get("/tasks/:id", (req, res) => {
  const task = db.getTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ task: { ...task, metrics: engine.getMetrics(task) } });
});

// POST /api/v1/tasks - Create task
router.post("/tasks", (req, res) => {
  if (!req.body.title || req.body.title.trim() === "") {
    return res.status(400).json({ error: "Title is required" });
  }
  const task = db.createTask(req.body);
  res.status(201).json({ task: { ...task, metrics: engine.getMetrics(task) } });
});

// PUT /api/v1/tasks/:id - Update task
router.put("/tasks/:id", (req, res) => {
  const task = db.updateTask(req.params.id, req.body);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ task: { ...task, metrics: engine.getMetrics(task) } });
});

// POST /api/v1/tasks/:id/complete - Log completion
router.post("/tasks/:id/complete", (req, res) => {
  const task = db.completeTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found or not active" });
  res.json({ task: { ...task, metrics: engine.getMetrics(task) } });
});

// PATCH /api/v1/tasks/:id/state - Change state (active/frozen/paused/hidden)
router.patch("/tasks/:id/state", (req, res) => {
  const { state } = req.body;
  const task = db.setTaskState(req.params.id, state);
  if (!task) return res.status(400).json({ error: "Invalid task ID or state" });
  res.json({ task: { ...task, metrics: engine.getMetrics(task) } });
});

// DELETE /api/v1/tasks/:id
router.delete("/tasks/:id", (req, res) => {
  const success = db.deleteTask(req.params.id);
  if (!success) return res.status(404).json({ error: "Task not found" });
  res.json({ success: true });
});

// GET /api/v1/summary - Bandwidth summary & system load
router.get("/summary", (req, res) => {
  const energyFactor = req.query.energy_factor ? Number(req.query.energy_factor) : 1.0;
  const tasks = db.getAllTasks();
  res.json(engine.getSummary(tasks, energyFactor));
});

// GET /api/v1/export
router.get("/export", (req, res) => {
  res.json(db.exportData());
});

// POST /api/v1/import
router.post("/import", (req, res) => {
  const success = db.importData(req.body);
  if (!success) return res.status(400).json({ error: "Invalid backup format" });
  res.json({ success: true });
});

module.exports = router;
