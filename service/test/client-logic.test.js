"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { buildTaskPayload } = require("../../clients/web-app/taskify-logic");

// Drift guard: the two copies must be functionally identical (plasma has only the .pragma line)
test("plasma and web taskify-logic copies are in sync (modulo pragma)", () => {
  const webSrc = fs.readFileSync(
    path.join(__dirname, "../../clients/web-app/taskify-logic.js"),
    "utf8"
  );
  let plasmaSrc = fs.readFileSync(
    path.join(__dirname, "../../clients/plasma-widget/contents/ui/taskify-logic.js"),
    "utf8"
  );
  plasmaSrc = plasmaSrc.replace(/^\.pragma library\s*\n?/, "");
  assert.equal(plasmaSrc.trim(), webSrc.trim());
});

describe("buildTaskPayload (BUG-4)", () => {
  test("once-off update/create omits days_ago entirely (even if config contains rounded elapsed)", () => {
    const config = {
      interval_days: 10,
      days_ago: 3, // what setEditing / onEditingTodoChanged populates even when hidden
      significance: 1.0,
      effort: 1.0,
      domain: "executive_mental",
      is_recurring: false
    };
    const payload = buildTaskPayload("Title", config);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "days_ago"), false);
    assert.equal(payload.is_recurring, false);
    assert.equal(payload.title, "Title");
  });

  test("recurring update still includes days_ago", () => {
    const config = {
      interval_days: 7,
      days_ago: 2,
      significance: 2.5,
      effort: 1.0,
      domain: "physical_somatic",
      is_recurring: true
    };
    const payload = buildTaskPayload("Recur", config);
    assert.equal(payload.days_ago, 2);
    assert.equal(payload.is_recurring, true);
  });

  test("once-off with days_ago=0 still omits (would otherwise reset anchor on save)", () => {
    const payload = buildTaskPayload("Fresh once", {
      interval_days: 5,
      days_ago: 0,
      significance: 1.0,
      effort: 1.0,
      domain: "executive_mental",
      is_recurring: false
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "days_ago"), false);
  });
});
