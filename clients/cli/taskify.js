#!/usr/bin/env node

const BASE_URL = process.env.TASKIFY_URL || "http://localhost:8085/api/v1";

// Simple ANSI color helpers
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m"
};

async function api(path, options = {}) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error(`${colors.red}Error:${colors.reset} Could not connect to Taskify service at ${BASE_URL}`);
    console.error(`       (${err.message})\n`);
    process.exit(1);
  }
}

// Command: Lite Thermal Printer Output (Top 1/3 Leaderboard, 32-Char Max Width)
async function cmdLite() {
  const data = await api("/tasks?filter=active");
  let tasks = data.tasks || [];

  console.log("TOP TASK LEADERBOARD");
  console.log("--------------------------------");

  if (tasks.length === 0) {
    console.log("No active tasks.");
    return;
  }

  // Take top third of active leaderboard
  const limit = Math.ceil(tasks.length / 3);
  const selectedTasks = tasks.slice(0, limit);
  const MAX_WIDTH = 32;

  selectedTasks.forEach(t => {
    const weightStr = `(${t.metrics.weight.toFixed(2)} W)`;
    const availableForTitle = MAX_WIDTH - weightStr.length - 1;

    let title = t.title;
    if (title.length > availableForTitle) {
      title = title.slice(0, availableForTitle);
    }

    const padLen = Math.max(1, MAX_WIDTH - title.length - weightStr.length);
    const line = `${title}${" ".repeat(padLen)}${weightStr}`;
    console.log(line);
  });
}

// Command: Top N Priorities
async function cmdTop(limitArg) {
  const limit = parseInt(limitArg, 10) || 3;
  const data = await api(`/tasks/top?limit=${limit}`);

  console.log(`\n${colors.bold}${colors.cyan}=== TOP ${data.tasks.length} PRIORITIES FOR TODAY ===${colors.reset}\n`);
  if (data.tasks.length === 0) {
    console.log(`  ${colors.dim}No active tasks found.${colors.reset}\n`);
    return;
  }

  data.tasks.forEach((t, i) => {
    const m = t.metrics;
    const color = m.x > 1.0 ? colors.red : (m.x >= 0.8 ? colors.yellow : colors.green);
    console.log(`  ${colors.bold}${i + 1}. [ID: ${t.id}] ${t.title}${colors.reset}`);
    console.log(`     Status: ${color}${m.statusText}${colors.reset}  |  Weight: ${colors.bold}${m.weight.toFixed(2)}${colors.reset} W  |  Ratio: ${m.x.toFixed(2)}x`);
    console.log(`     Domain: ${t.domain}  |  ${t.is_recurring === 0 ? "Once-off, due in" : "Interval:"} ${t.interval_days}d\n`);
  });
}

// Command: List All Tasks
async function cmdList(filter = "active") {
  const data = await api(`/tasks?filter=${filter}`);

  console.log(`\n${colors.bold}=== TASK LEADERBOARD (${filter.toUpperCase()}) ===${colors.reset}\n`);
  if (data.tasks.length === 0) {
    console.log(`  ${colors.dim}No tasks found.${colors.reset}\n`);
    return;
  }

  console.log(`${colors.dim}  ID   Title                            Status             Weight    Interval${colors.reset}`);
  console.log(`${colors.dim}  ---------------------------------------------------------------------------${colors.reset}`);

  data.tasks.forEach(t => {
    const m = t.metrics;
    const color = m.x > 1.0 ? colors.red : (m.x >= 0.8 ? colors.yellow : colors.green);
    const idStr = String(t.id).padStart(3, " ");
    const titleStr = t.title.padEnd(30, " ").slice(0, 30);
    const statusStr = (m.statusText || t.state).padEnd(17, " ").slice(0, 17);
    const weightStr = m.weight.toFixed(2).padStart(6, " ");
    const intervalStr = `${t.interval_days}d${t.is_recurring === 0 ? " once" : ""}`;

    console.log(`  ${colors.bold}${idStr}${colors.reset}  ${titleStr}   ${color}${statusStr}${colors.reset}  ${weightStr} W   ${intervalStr}`);
  });
  console.log();
}

// Command: Complete Task
async function cmdComplete(id) {
  if (!id) {
    console.log(`${colors.red}Usage: taskify done <task_id>${colors.reset}`);
    return;
  }
  const data = await api(`/tasks/${id}/complete`, { method: "POST" });
  console.log(`\n${colors.green}✔ Completed task #${data.task.id}:${colors.reset} "${data.task.title}"`);
  if (data.task.state === "completed") {
    console.log(`  Once-off task finished; urgency clock stopped.\n`);
  } else {
    console.log(`  Urgency reset to 0.00 W. Next due in ${data.task.interval_days} days.\n`);
  }
}

// Command: Add Task
async function cmdAdd(args) {
  const titleIndex = args.findIndex(a => !a.startsWith("-"));
  if (titleIndex === -1) {
    console.log(`${colors.red}Usage: taskify add "Task Title" [--once] [-i interval] [-s significance] [-e effort] [-d domain] [-a days_ago]${colors.reset}`);
    return;
  }

  const title = args[titleIndex];
  let interval = 7;
  let significance = 1.0;
  let effort = 1.0;
  let domain = "executive_mental";
  let daysAgo = 0;
  const isRecurring = !args.includes("--once");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-i" && args[i + 1]) interval = parseFloat(args[i + 1]);
    if (args[i] === "-s" && args[i + 1]) significance = parseFloat(args[i + 1]);
    if (args[i] === "-e" && args[i + 1]) effort = parseFloat(args[i + 1]);
    if (args[i] === "-d" && args[i + 1]) domain = args[i + 1];
    if (args[i] === "-a" && args[i + 1]) daysAgo = parseFloat(args[i + 1]);
  }

  const data = await api("/tasks", {
    method: "POST",
    body: JSON.stringify({
      title,
      interval_days: interval,
      significance,
      effort,
      domain,
      days_ago: daysAgo,
      is_recurring: isRecurring
    })
  });

  console.log(`\n${colors.green}✔ Created ${isRecurring ? "" : "once-off "}task #${data.task.id}:${colors.reset} "${data.task.title}"`);
  console.log(`  ${isRecurring ? "Interval" : "Due in"}: ${data.task.interval_days}d | Weight: ${data.task.metrics.weight.toFixed(2)} W\n`);
}

// Command: Summary / Bandwidth
async function cmdSummary() {
  const data = await api("/summary");

  console.log(`\n${colors.bold}${colors.magenta}=== SYSTEM BANDWIDTH SUMMARY ===${colors.reset}\n`);
  console.log(`  ${colors.bold}Total Urgency Weight:${colors.reset}  ${data.total_weight.toFixed(2)} W`);
  console.log(`  ${colors.bold}Daily Maintenance Load:${colors.reset} ${data.total_active_cost_au.toFixed(2)} / ${data.effective_capacity_au.toFixed(2)} AU/day\n`);

  console.log(`  ${colors.bold}Domain Breakdown:${colors.reset}`);
  const dl = data.domain_loads;
  console.log(`   • Mental/Executive: ${dl.executive_mental.current.toFixed(1)} / ${dl.executive_mental.max} AU`);
  console.log(`   • Physical/Somatic: ${dl.physical_somatic.current.toFixed(1)} / ${dl.physical_somatic.max} AU`);
  console.log(`   • Social/Relational: ${dl.social_relational.current.toFixed(1)} / ${dl.social_relational.max} AU\n`);
}

// Help Menu
function showHelp() {
  console.log(`
${colors.bold}Interval Taskify CLI${colors.reset}

${colors.bold}USAGE:${colors.reset}
  taskify <command> [options]

${colors.bold}COMMANDS:${colors.reset}
  top [N]               Show today's top N priorities (default: 3)
  ls [--all|--inactive|--completed] List all tasks sorted by urgency
  done <id>             Mark a task complete by ID
  add "Title" [opts]    Add a new task (recurring unless --once)
                        Opts: --once (once-off; -i is days until due)
                              -i <days> (interval)
                              -s <1.0|1.6|2.5|4.0> (significance)
                              -e <0.5|1.0|2.5> (effort)
                              -d <executive_mental|physical_somatic|social_relational>
                              -a <days_ago>
  summary               View capacity load & domain AU breakdown
  lite | --lite         Format top 1/3 of leaderboard for 32-col receipt printer
  help                  Show this menu
  `);
}

// CLI Routing
const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case "top":
    cmdTop(args[0]);
    break;
  case "lite":
  case "--lite":
    cmdLite();
    break;
  case "ls":
  case "list":
    cmdList(args.includes("--all") ? "all" : (args.includes("--inactive") ? "inactive" : (args.includes("--completed") ? "completed" : "active")));
    break;
  case "done":
  case "complete":
    cmdComplete(args[0]);
    break;
  case "add":
    cmdAdd(args);
    break;
  case "summary":
  case "status":
    cmdSummary();
    break;
  default:
    if (!cmd || cmd === "help") {
      showHelp();
    } else {
      console.log(`${colors.red}Unknown command: ${cmd}${colors.reset}`);
      showHelp();
    }
}
