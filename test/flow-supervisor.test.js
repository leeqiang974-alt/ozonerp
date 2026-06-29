import test from "node:test";
import assert from "node:assert/strict";
import { automationActionsAllowed, automationSafetyStatus, summarizeWorkflowRuns } from "../src/flowSupervisor.js";

test("summarizeWorkflowRuns counts waiting-human and failed workflows", () => {
  const summary = summarizeWorkflowRuns([
    { status: "waiting_human" },
    { status: "failed" },
    { status: "live" },
    { status: "waiting_human" },
  ]);

  assert.equal(summary.total, 4);
  assert.equal(summary.waitingHuman, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.live, 1);
});

test("automationSafetyStatus exposes disabled automation by default", () => {
  const status = automationSafetyStatus({});

  assert.equal(status.distributorAutorun, false);
  assert.equal(status.serverAutoHeal, false);
  assert.equal(status.mode, "observe_only");
});

test("automationSafetyStatus exposes active automation flags", () => {
  const status = automationSafetyStatus({
    OZON_DISTRIBUTOR_AUTORUN: "1",
    OZON_SERVER_AUTO_HEAL: "1",
  });

  assert.equal(status.distributorAutorun, true);
  assert.equal(status.serverAutoHeal, true);
  assert.equal(status.mode, "automation_enabled");
});

test("automationActionsAllowed blocks auto-heal actions by default", () => {
  assert.equal(automationActionsAllowed({}, {}), false);
  assert.equal(automationActionsAllowed({ allowAutomation: false }, { OZON_SERVER_AUTO_HEAL: "1" }), false);
});

test("automationActionsAllowed permits explicit or environment-enabled automation", () => {
  assert.equal(automationActionsAllowed({ allowAutomation: true }, {}), true);
  assert.equal(automationActionsAllowed({}, { OZON_SERVER_AUTO_HEAL: "1" }), true);
});
