import test from "node:test";
import assert from "node:assert/strict";
import { distributorAutomationEnabled, normalizeDailyState, serverAutoHealEnabled } from "../src/dailyDistributor.js";

test("normalizeDailyState resets opportunity attempts when the day changes", () => {
  const state = normalizeDailyState({
    attemptsDay: "2026-06-01",
    attemptsByOpportunity: { old: 3 },
  }, "2026-06-02");

  assert.equal(state.attemptsDay, "2026-06-02");
  assert.deepEqual(state.attemptsByOpportunity, {});
});

test("normalizeDailyState preserves attempts for the same day", () => {
  const state = normalizeDailyState({
    attemptsDay: "2026-06-02",
    attemptsByOpportunity: { same: 2 },
  }, "2026-06-02");

  assert.deepEqual(state.attemptsByOpportunity, { same: 2 });
});

test("distributor automation is disabled by default", () => {
  assert.equal(distributorAutomationEnabled({}), false);
  assert.equal(distributorAutomationEnabled({ OZON_DISTRIBUTOR_AUTORUN: "0" }), false);
  assert.equal(distributorAutomationEnabled({ OZON_DISTRIBUTOR_AUTORUN: "1" }), true);
});

test("server auto-heal automation is disabled by default", () => {
  assert.equal(serverAutoHealEnabled({}), false);
  assert.equal(serverAutoHealEnabled({ OZON_SERVER_AUTO_HEAL: "0" }), false);
  assert.equal(serverAutoHealEnabled({ OZON_SERVER_AUTO_HEAL: "1" }), true);
});
