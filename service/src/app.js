const express = require("express");
const cors = require("cors");
const routes = require("./routes");

const app = express();

app.use(cors());
app.use(express.json());

// API Routes
app.use("/api/v1", routes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "interval-taskify" });
});

module.exports = app;
