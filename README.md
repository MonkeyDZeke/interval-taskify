# Interval Taskify

A dynamic task manager that tracks **relative urgency** and balances tasks against your **cognitive capacity**.

Instead of traditional due dates or static priorities, tasks accumulate urgency over time according to a mathematical curve. The system surfaces what genuinely needs attention *now* while preventing you from overloading any single mental or physical domain.

The core ideas are documented in detail in [`brief.yaml`](./brief.yaml).

## Key Concepts

- **Urgency Weight (W)**: How "loud" a task is right now, based on elapsed time, significance, and a configurable curve.
- **Significance (S)**: How bad the consequences are if the task slips (Low / Medium / High / Critical).
- **Effort (E)**: How much daily capacity (Attention Units) the task consumes.
- **Domains**: Executive/Mental, Physical/Somatic, Social/Relational — each with daily load caps.
- **Curve shapes**: Tasks can be "early reward" (logarithmic, good to do ahead) or "on-time" (power curve, only urgent near the deadline).

## Architecture

Interval Taskify is split into a backend service and multiple lightweight clients:

| Component          | Location                  | Description                              |
|--------------------|---------------------------|------------------------------------------|
| Service            | `service/`                | Node.js + Express API + urgency engine   |
| Plasma Widget      | `clients/plasma-widget/`  | Native KDE Plasma 6 applet               |
| Web App            | `clients/web-app/`        | Static single-file web client            |
| CLI                | `clients/cli/`            | Command-line interface                   |

The service is the source of truth for all calculations. Clients can work online (preferred) or with cached data.

## Getting Started

### Prerequisites

- **Node.js** 20+ (for the service and CLI)
- For the Plasma widget: KDE Plasma 6 + `kpackagetool6`

### 1. Start the Backend Service

```bash
cd service
npm install
npm start
# For development with auto-reload:
# npm run dev
```

The service listens on `http://localhost:8080` by default.

You can override the port and database location:

```bash
PORT=8085 TASKIFY_DB=/path/to/tasks.db npm start
```

### 2. Plasma Widget (KDE 6)

From the project root:

```bash
./install-plasma-widget.sh
```

Then:

1. Right-click your desktop or panel → **Add Widgets...**
2. Search for "**To Do**"
3. Drag the widget onto your desktop or panel

To uninstall:

```bash
./uninstall-plasma-widget.sh
```

During development you can use `./dev-reload.sh` to quickly reinstall and restart plasmashell.

### 3. Web App

```bash
cd clients/web-app
cp env.example.js env.js
# Edit env.js and set the correct API_URL (e.g. http://localhost:8080/api/v1)
```

Open `index.html` in a browser.

> **Tip**: Some features (clipboard export) work better when served over `http://` rather than opened as a `file://`.

### 4. CLI

```bash
cd clients/cli
npm install -g .
```

Or for local development:

```bash
npm link
```

Usage examples:

```bash
taskify ls
taskify add "Call mom" -i 7 -s 2.5
taskify done 42
taskify summary
taskify top 5
```

Set a custom service URL if needed:

```bash
export TASKIFY_URL=http://localhost:8080/api/v1
```

## Configuration & Environment

| Variable       | Default                        | Used by     |
|----------------|--------------------------------|-------------|
| `PORT`         | 8080                           | Service     |
| `TASKIFY_DB`   | `service/data/tasks.db`        | Service     |
| `TASKIFY_URL`  | `http://localhost:8085/api/v1` | CLI         |
| `API_URL`      | (in `env.js`)                  | Web App     |

## Development

- Run the service in watch mode: `cd service && npm run dev`
- Use the web app against the running service
- For the Plasma widget, use `./dev-reload.sh` after making UI changes
- Tests: `cd service && npm test`

The urgency math lives in `service/src/engine.js`. All clients fall back to the same logic when offline.

## Design & Philosophy

The full specification (including the exact weight formulas, capacity model, state machine, and planned features) lives in [`brief.yaml`](./brief.yaml).

This document is the single source of truth for how urgency, load, and task lifecycle should behave.

## Contributing

Contributions are very welcome!

Please open an issue or pull request. When touching urgency calculations, try to keep the engine as the canonical implementation and update clients accordingly.

## License

MIT — see [LICENSE](LICENSE).

## Author

**monkeydzeke**

- GitHub: [@monkeydzeke](https://github.com/monkeydzeke)
- Project: [interval-taskify](https://github.com/monkeydzeke/interval-taskify)
