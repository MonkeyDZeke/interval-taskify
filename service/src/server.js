const express = require("express");
const cors = require("cors");
const routes = require("./routes");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// API Routes
app.use("/api/v1", routes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "interval-taskify" });
});

app.listen(PORT, () => {
  console.log(`[Interval Taskify Service] Listening on http://localhost:${PORT}`);
});
