const app = require("./app");

const PORT = process.env.PORT || 8023;

app.listen(PORT, () => {
  console.log(`[Interval Taskify Service] Listening on http://localhost:${PORT}`);
});
