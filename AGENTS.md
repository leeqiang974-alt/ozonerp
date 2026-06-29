# Ozon ERP Agent Guide

This file mirrors `CLAUDE.md` so Codex and Claude Code follow the same project rules.

## Required Context

Read these before substantial Ozon ERP changes:

- `docs/SESSION_HANDOFF.zh-CN.md`
- `docs/erp-ui-information-architecture.zh-CN.md`
- Relevant source and tests for the feature area.
- `docs/pricing-logic.zh-CN.md` for any price, logistics, commission, `old_price`, `min_price`, or profit work.

## Product Principle

Ozon ERP is a seller operating workbench. UI and workflow changes must help the user answer:

- What is the current product or operational issue?
- Why is it blocked?
- What can I safely do next?
- What happens after I click?

Do not turn ordinary seller screens into developer logs, long unscannable forms, or generic diagnostic walls.

## Hard Boundaries

- Promotions cannot contain listing draft fields.
- Listing submission cannot bypass preflight or human confirmation.
- Workflow locks, paused states, and `waiting_human` must be respected.
- Browser human verification must pause automation.
- GPT/image generation requires user-confirmed action before cost.
- Blocked pricing risk cannot be accepted as safe; fix it or replace the source.

## Expected Implementation Flow

1. Translate the request into the affected business object and module.
2. Add or update a targeted test before changing behavior.
3. Keep implementation scoped to the relevant files.
4. Run targeted tests, then `npm test`, then `npm run lint`.
5. Update `docs/SESSION_HANDOFF.zh-CN.md` when a stage is completed.

## Claude-Guided Development

When the user asks for Ozon ERP development to be guided by Claude Code:

1. Ask Claude Code for a short implementation brief or review using `scripts/claude-ozon-review.ps1`.
2. Treat the Claude output as architecture/product guidance, not as automatically trusted code.
3. Codex implements the scoped change, runs verification, and reports the result.
4. If Claude's guidance conflicts with tests, safety gates, or existing project rules, follow the project rules and explain the conflict.

## Verification Commands

```powershell
node --test test/frontend-static.test.js
node --test test/workflow-runs.test.js
npm test
npm run lint
```
