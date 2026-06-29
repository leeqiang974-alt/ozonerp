# Payload Draft Submit Safety Gate Design

## Goal

Add a controlled `payload-draft-submit` path for workflow runs so a saved Ozon submit payload can only reach `/v3/product/import` after preflight validation and explicit human confirmation.

## Scope

This change covers the workflow console safety gate only. It does not change the existing automatic `completeListing()` submission path, stock queue behavior, or review reconciliation beyond recording the initial submit event for draft submissions.

## Approach

Create a small workflow service function, `submitPayloadDraftToOzon(runId, input, deps)`, in `src/workflowRuns.js`. The function owns the gate checks and persistence:

- Load the workflow run and require a saved `payloadDraft`.
- Re-run `validateSubmitPayload()` every time submit is requested.
- Require an explicit confirmation flag such as `confirmSubmit: true`.
- Block if the run is paused.
- On validation failure, write a failed `preflight_check` node and keep the run in `waiting_human`.
- On success, write a successful `preflight_check` node, call injected Ozon dependencies, then write an `ozon_submit` node and `payload_draft_submitted` event.

`src/server.js` exposes `POST /api/workflows/:id/payload-draft/submit`. The route injects `getStore` and `ozonRequest` into the workflow service, which keeps tests deterministic and prevents unit tests from touching real Ozon.

## Safety Rules

- No saved draft means no submit.
- Validation always runs at submit time, even if the UI previously validated.
- A successful validation alone is not enough; the body must include explicit human confirmation.
- The endpoint submits exactly the saved draft items. It does not regenerate content or mutate SKU data.
- Every real submit writes workflow audit data before returning to the caller.

## Testing

Use TDD in `test/workflow-runs.test.js`:

- Block invalid drafts before calling Ozon.
- Block valid drafts without explicit confirmation.
- Submit a valid confirmed draft through injected fake Ozon dependencies and record `ozon_submit`.

Add a static route test in `test/server-routes.test.js` and a frontend static test for the UI button.
