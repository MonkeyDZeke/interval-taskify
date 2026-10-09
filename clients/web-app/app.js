"use strict";

const API_URL = ((window.ENV && window.ENV.API_URL) || "http://localhost:8085/api/v1").replace(/\/+$/, "");

const STATE_OPTIONS = [
  { text: "Active", value: "active" },
  { text: "Frozen", value: "frozen" },
  { text: "Hidden", value: "hidden" },
  { text: "Paused", value: "paused" },
];

// ---------- API client ----------

async function request(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(API_URL + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const api = {
  getTasks: (filter) => request("GET", "/tasks" + (filter ? "?filter=" + encodeURIComponent(filter) : "")),
  getSummary: (factor) => request("GET", "/summary" + (factor ? "?energy_factor=" + encodeURIComponent(factor) : "")),
  addTask: (title, c) => request("POST", "/tasks", {
    title,
    interval_days: c.interval_days || 7,
    days_ago: c.days_ago || 0,
    significance: c.significance || 1.0,
    effort: c.effort || 1.0,
    domain: c.domain || "executive_mental",
    is_recurring: c.is_recurring !== false,
  }),
  updateTask: (id, title, c) => request("PUT", "/tasks/" + id, {
    title,
    interval_days: c.interval_days,
    days_ago: c.days_ago,
    significance: c.significance,
    effort: c.effort,
    domain: c.domain,
    is_recurring: c.is_recurring,
  }),
  completeTask: (id) => request("POST", "/tasks/" + id + "/complete"),
  setTaskState: (id, state) => request("PATCH", "/tasks/" + id + "/state", { state }),
  deleteTask: (id) => request("DELETE", "/tasks/" + id),
  exportData: () => request("GET", "/export"),
};

// ---------- State ----------

let todos = [];
let summaryData = null;
let serverOnline = false;
let currentFilter = "active";
let editingTodo = null;

const $ = (id) => document.getElementById(id);
const el = {
  title: $("title"), add: $("add-btn"), update: $("update-btn"), cancel: $("cancel-btn"),
  interval: $("interval"), intervalLabel: $("interval-label"), daysLabel: $("days-label"),
  daysAgo: $("days-ago"), daysAgoLabel: $("days-ago-label"),
  significance: $("significance"), effort: $("effort"), domain: $("domain"), once: $("once"),
  exportBtn: $("export-btn"), status: $("status"), summary: $("summary"), list: $("list"),
};

// ---------- Logic ----------

async function loadTodos() {
  try {
    const response = await api.getTasks("all");
    serverOnline = true;
    todos = response.tasks || [];
  } catch {
    serverOnline = false;
  }
  try {
    summaryData = await api.getSummary(1.0);
  } catch { /* keep previous summary */ }
  render();
}

function readConfig() {
  return {
    interval_days: Number(el.interval.value) || 1,
    days_ago: Number(el.daysAgo.value) || 0,
    significance: Number(el.significance.value),
    effort: Number(el.effort.value),
    domain: el.domain.value,
    is_recurring: !el.once.checked,
  };
}

async function act(fn) {
  try { await fn(); await loadTodos(); } catch { /* ignored, like the widget */ }
}

async function addTodo() {
  const text = el.title.value.trim();
  if (!text) return;
  try {
    await api.addTask(text, readConfig());
    el.title.value = "";
    await loadTodos();
  } catch { /* keep input for retry */ }
}

async function saveEditingTodo() {
  const text = el.title.value.trim();
  if (!editingTodo || !text) return;
  try {
    await api.updateTask(editingTodo.id, text, readConfig());
    setEditing(null);
    await loadTodos();
  } catch { /* keep editing */ }
}

function setEditing(todo) {
  editingTodo = todo;
  if (todo) {
    el.title.value = todo.title;
    el.interval.value = Number(todo.interval_days) || 7;
    el.once.checked = todo.is_recurring === 0;
    el.daysAgo.value = Math.round(getMetrics(todo).elapsedDays);
    el.significance.value = String(Number(todo.significance));
    el.effort.value = String(Number(todo.effort));
    el.domain.value = todo.domain;
    if (el.significance.selectedIndex < 0) el.significance.selectedIndex = 0;
    if (el.effort.selectedIndex < 0) el.effort.selectedIndex = 1;
    if (el.domain.selectedIndex < 0) el.domain.selectedIndex = 0;
  } else {
    el.title.value = "";
    el.interval.value = 7;
    el.once.checked = false;
    el.significance.selectedIndex = 0;
    el.effort.selectedIndex = 1;
    el.domain.selectedIndex = 0;
  }
  updateFormVisibility();
}

function updateFormVisibility() {
  const once = el.once.checked;
  el.intervalLabel.textContent = once ? "Due in" : "Every";
  el.daysLabel.textContent = once ? "days" : "days | Done";
  el.daysAgo.hidden = once;
  el.daysAgoLabel.hidden = once;
  el.add.hidden = editingTodo !== null;
  el.update.hidden = editingTodo === null;
  el.cancel.hidden = editingTodo === null;
  el.title.placeholder = editingTodo ? "Edit task title..." : "Add a task...";
}

function getMetrics(todo) {
  if (todo.metrics) {
    return {
      elapsedDays: todo.metrics.elapsedDays || 0,
      x: todo.metrics.x || 0,
      weight: todo.metrics.weight || 0,
      statusText: todo.metrics.statusText || "",
    };
  }
  const intervalDays = Number(todo.interval_days);
  const anchor = Date.parse(todo.urgency_anchor_at);
  if (!isFinite(intervalDays) || intervalDays <= 0 || !isFinite(anchor)) {
    return { elapsedDays: 0, x: 0, weight: 0, statusText: "Invalid" };
  }
  const elapsedDays = Math.max(0, (Date.now() - anchor) / 86400000);
  const x = elapsedDays / intervalDays;
  const significance = Number(todo.significance);
  const weight = x <= 1
    ? significance * Math.log(1 + 10 * x) / Math.log(11)
    : significance * Math.exp(1.386 * (x - 1));
  return { elapsedDays, x, weight, statusText: "" };
}

function getStatusText(todo) {
  if (todo.state !== "active") return todo.state.toUpperCase();
  const onceTag = todo.is_recurring === 0 ? "  •  Once-off" : "";
  if (todo.metrics && todo.metrics.statusText) {
    return todo.metrics.statusText + "  •  W " + todo.metrics.weight.toFixed(2) + onceTag;
  }
  const metrics = getMetrics(todo);
  const diffDays = Math.round(Number(todo.interval_days) - metrics.elapsedDays);
  let status;
  if (diffDays > 0) status = "Due in " + diffDays + (diffDays === 1 ? " day" : " days");
  else if (diffDays === 0) status = "Due today";
  else {
    const over = Math.abs(diffDays);
    status = "Overdue " + over + (over === 1 ? " day" : " days");
  }
  return status + "  •  W " + metrics.weight.toFixed(2) + onceTag;
}

function matchesFilter(todo, filter) {
  if (filter === "all") return true;
  if (filter === "active") return todo.state === "active";
  if (filter === "completed") return todo.state === "completed";
  if (filter === "inactive") return todo.state !== "active" && todo.state !== "completed";
  return false;
}

function getFilteredTodos() {
  return todos.filter((t) => matchesFilter(t, currentFilter)).sort((l, r) => {
    const la = l.state === "active";
    const ra = r.state === "active";
    if (la !== ra) return la ? -1 : 1;
    if (la) return getMetrics(r).weight - getMetrics(l).weight;
    return l.title.localeCompare(r.title);
  });
}

const getTodoCount = (filter) => todos.filter((t) => matchesFilter(t, filter)).length;

function getCapacitySummary() {
  if (summaryData) {
    const dl = summaryData.domain_loads || {};
    const m = dl.executive_mental ? dl.executive_mental.current : 0;
    const p = dl.physical_somatic ? dl.physical_somatic.current : 0;
    const s = dl.social_relational ? dl.social_relational.current : 0;
    return "Total Weight: " + summaryData.total_weight.toFixed(2) + " W  |  Daily load " +
      summaryData.total_active_cost_au.toFixed(1) + "/" + summaryData.effective_capacity_au.toFixed(1) +
      " AU  |  Mental " + m.toFixed(1) + "/5  Physical " + p.toFixed(1) + "/4  Social " + s.toFixed(1) + "/3";
  }
  const load = { executive_mental: 0, physical_somatic: 0, social_relational: 0 };
  let totalCost = 0;
  let totalWeight = 0;
  for (const todo of todos) {
    if (todo.state !== "active") continue;
    const metrics = getMetrics(todo);
    totalWeight += metrics.weight;
    const cost = todo.is_recurring === 0
      ? Number(todo.effort) * Math.log(1 + 10 * Math.min(metrics.x, 1)) / Math.log(11)
      : Number(todo.effort) / Number(todo.interval_days);
    if (isFinite(cost)) {
      load[todo.domain] = (load[todo.domain] || 0) + cost;
      totalCost += cost;
    }
  }
  return "Total Weight: " + totalWeight.toFixed(2) + " W  |  Daily load " + totalCost.toFixed(1) +
    "/12 AU  |  Mental " + load.executive_mental.toFixed(1) + "/5  Physical " +
    load.physical_somatic.toFixed(1) + "/4  Social " + load.social_relational.toFixed(1) + "/3";
}

// ---------- Rendering ----------

function iconButton(label, tip, onClick) {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = tip;
  b.addEventListener("click", onClick);
  return b;
}

function renderItem(todo) {
  const li = document.createElement("li");
  li.className = "item";
  const active = todo.state === "active";
  const metrics = getMetrics(todo);

  const info = document.createElement("div");
  info.className = "info";

  const name = document.createElement("div");
  name.className = "name " + (active ? "active" : "inactive");
  name.textContent = todo.title;
  name.title = todo.title;

  const status = document.createElement("div");
  status.className = "status small " + (active && metrics.x > 1.0 ? "overdue" : "muted");
  status.textContent = getStatusText(todo);
  status.title = (todo.is_recurring === 0 ? "Once-off, due in (T): " : "Interval (T): ") + todo.interval_days + " days\n" +
    "Elapsed (Δt): " + metrics.elapsedDays.toFixed(1) + " days\n" +
    "Interval Ratio (x): " + metrics.x.toFixed(2) + "x\n" +
    "Urgency Weight (W): " + metrics.weight.toFixed(2) + "\n" +
    "Significance (S): " + todo.significance + "\n" +
    "Effort (E): " + todo.effort + " AU";

  info.append(name, status);
  li.append(info);

  if (todo.state !== "completed") {
    const select = document.createElement("select");
    for (const o of STATE_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.text;
      select.append(opt);
    }
    select.value = todo.state;
    select.addEventListener("change", () => act(() => api.setTaskState(todo.id, select.value)));
    li.append(select);
  } else {
    li.append(iconButton("↩", "Reopen task (restarts urgency clock)", () => act(() => api.setTaskState(todo.id, "active"))));
  }

  if (active) {
    li.append(iconButton("✎", "Edit task", () => setEditing(todo)));
    li.append(iconButton("✔", "Mark complete", () => act(() => api.completeTask(todo.id))));
  }
  li.append(iconButton("🗑", "Delete task", () => act(() => api.deleteTask(todo.id))));
  return li;
}

function render() {
  document.querySelectorAll("[data-filter]").forEach((b) => {
    const f = b.dataset.filter;
    const label = { all: "All", active: "Active", inactive: "Inactive", completed: "Done" }[f];
    b.textContent = label + " " + getTodoCount(f);
    b.classList.toggle("checked", currentFilter === f);
  });
  el.status.textContent = serverOnline ? "● Service Online" : "● Offline (Cached)";
  el.status.className = "small " + (serverOnline ? "online" : "offline");
  el.summary.textContent = getCapacitySummary();

  // Rebuilding the list would close an open state dropdown, so skip while one is focused
  if (el.list.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;
  const scroll = el.list.scrollTop;
  el.list.replaceChildren(...getFilteredTodos().map(renderItem));
  el.list.scrollTop = scroll;
}

// ---------- Events ----------

el.title.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  editingTodo ? saveEditingTodo() : addTodo();
});
el.add.addEventListener("click", addTodo);
el.update.addEventListener("click", saveEditingTodo);
el.cancel.addEventListener("click", () => setEditing(null));
el.once.addEventListener("change", updateFormVisibility);

document.querySelectorAll("[data-filter]").forEach((b) =>
  b.addEventListener("click", () => { currentFilter = b.dataset.filter; render(); }));

el.exportBtn.addEventListener("click", async () => {
  try {
    const data = await api.exportData();
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  } catch { /* ignored */ }
  el.exportBtn.textContent = "Copied!";
  setTimeout(() => { el.exportBtn.textContent = "Export"; }, 2000);
});

updateFormVisibility();
loadTodos();
setInterval(loadTodos, 2000);
