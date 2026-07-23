# Ozon ERP Claude Code Guide

This project is a seller operating system for Ozon, not a generic admin demo or a developer diagnostics page. Claude Code should act as the product and architecture reviewer before implementation, and should keep Codex aligned with the rules below.

## Start Here

Before proposing or changing anything, read these files:

- `docs/TOP-LEVEL-DEVELOPMENT-PLAN.zh-CN.md` as the authoritative source for execution order, frozen scope, the sole current slice, and stage exit gates.
- `docs/ROADMAP.zh-CN.md` as the delivery/verification evidence log; check `docs/plan-status-index.zh-CN.md` before resuming an older plan.
- `docs/SESSION_HANDOFF.zh-CN.md`
- `docs/erp-ui-information-architecture.zh-CN.md`
- `docs/pricing-logic.zh-CN.md` when pricing, logistics, old_price, min_price, commission, or profit is involved.
- `src/pricing.js`, `src/autoListing.js`, `src/workflowRuns.js`, `public/index.html`, `public/app.js`, `public/styles.css`, and the relevant tests for the feature area.

Use the project root: `C:\Users\Administrator\Documents\ozonerp`.

店铺 API 的 canonical 本地来源是 `D:\Desktop\api\ozonapi.txt`，当前按 4 个主 API 记录识别店铺；`D:\Desktop\ozonseller api\Ozon Seller API 文件.html` 是 Seller API 接口事实的优先文档。外部使用/个人使用备注不重复计数，GitHub 只能作为工程参考。

## Operating Model

当前按 `docs/TOP-LEVEL-DEVELOPMENT-PLAN.zh-CN.md` 执行黄金链路阶段门，WIP=1。G4 MVP 通过前暂停五工作流轮转；只能领取标记为 `CURRENT` 的切片。FBS、活动、财务和售后冻结，生产化工作只处理黄金链路的直接阻断。只有启动失败、数据损坏/丢失、凭据泄露或真实写入安全门旁路可以中断当前切片。

The ERP must be organized around seller decisions:

- The ordinary listing surface is one product sheet: auto-fill every field that can be safely derived, apply stable seller defaults directly, expose paid AI as one explicit click, and show only unresolved inputs. Keep evidence, workflow nodes, JSON, prompts, receipts, and safety diagnostics collapsed. Stable site/language/unit defaults may be fixed; dynamic Ozon categories, required attributes, dictionary values, and real-store evidence may not be hard-coded.
- Do not split category evidence sync, attribute fill, AI copy, media preparation, pricing, and preflight into seller-by-seller confirmations. One explicit “auto-complete product” action should run every automatable stage continuously and stop only for unavailable source facts, genuine ambiguity, or a safety failure; retain one final confirmation for the real Ozon submit.
- The ordinary `1688 sourcing` screen is the browser extension's inbox, not a collection lab. Its first viewport shows only the plugin connection, the single “补齐后入箱” action performed on the 1688 product page, the current real product, and the system's result. Fixtures, reverse workflows, crawler/API configuration, raw pages, task lists, candidate controls, and history stay collapsed under advanced tools.

1. What should be handled today.
2. Which product or workflow is blocked.
3. Why it is blocked in business language.
4. What the user can safely decide next.

Avoid developer-only language such as "manual intervention" unless the UI also explains the concrete issue, cause, available actions, and result of each action.

## Feature Ownership

Every tab has a strict responsibility boundary:

- Dashboard: today, current product, business risks, and next action.
- Sourcing: 1688 source collection, collection box, candidate parsing, and draft creation.
- Listing: Ozon listing draft, category, attributes, title, description, images, pricing, preflight, and submit gates.
- Workflow console: blocked nodes, diagnostics, field location, retry, source replacement, and submit gates.
- Research/materials: Ozon reference, image style, guidance, and image generation suggestions.
- Products: Ozon product list, status, price, and listing anomalies.
- Warehouse: warehouses, stock read/write, stock queue, and stock failures.
- Orders: FBS orders, preparation, shipping, cancellation, dispute states.
- Promotions: Ozon promotions, promotion products, joinable products, and removal from promotions only.

If the promotions tab shows listing fields such as category, description, listing title, collected product images, or attribute forms, treat it as a routing/content ownership bug.

## Safety Gates

Never bypass these gates:

- Ozon submission requires preflight and explicit human confirmation.
- Payload edits must be validated before submission.
- Workflow locks, waiting_human states, and paused states must be respected.
- Human verification in browser automation must pause the workflow, not refresh or continue polling.
- GPT/Image generation must be user-confirmed before spending money.
- Pricing risk marked blocked cannot be accepted as safe; it must be corrected or moved to a new source.

## Pricing Rules

When touching prices, keep these aligned:

- `src/pricing.js`
- `src/autoListing.js`
- frontend pricing/workflow diagnosis in `public/app.js`
- tests in `test/listing-content-quality.test.js`, `test/workflow-runs.test.js`, and related pricing tests.

Current pricing meaning:

- `price`: listing price in CNY.
- `old_price`: strike-through price, currently `price * 2`.
- `min_price`: floor price for Ozon promotions. Decimal prices floor; integer prices subtract 1; never below `1`.
- Commission source must be explicit. Do not present the default 15% as a real Ozon category commission.

## UI Rules

The ERP is a business workbench:

- Use readable, light, dense business UI unless an existing screen requires otherwise.
- Every tab starts with title, ownership contract, task entry card, key business panel, then collapsed advanced content.
- Long forms and diagnostics must not dominate the first viewport.
- Desktop sidebar text must remain visible.
- The current product workflow should focus on the current product, not aggregate old historical failures into the main action area.

## Development Discipline

Use test-driven changes for behavior:

1. Add or update a focused failing test for the business rule or regression.
2. Implement the smallest code change that satisfies the rule.
3. Run targeted tests.
4. Run `npm test`.
5. Run `npm run lint`.
6. Update `docs/SESSION_HANDOFF.zh-CN.md` after a completed stage.

Never run `npm test` and `npm run offline-acceptance` concurrently. Both use shared local crawler/fixture directories; run them serially so test contention cannot be mistaken for a product regression.

Useful commands:

```powershell
npm test
npm run lint
node --test test/frontend-static.test.js
node --test test/workflow-runs.test.js
powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 start
powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 stop
powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 status
```

## Claude Code Role

For future Ozon ERP work, Claude Code should usually produce an implementation brief before Codex edits code:

- Restate the user problem in business terms.
- Identify the affected module ownership boundary.
- Identify safety gates.
- Name files and tests likely to change.
- State the acceptance criteria.
- Warn if the request would bypass preflight, human confirmation, pricing risk, workflow locks, or human verification pauses.

Codex should then implement against that brief, keep changes scoped, and verify with tests.
