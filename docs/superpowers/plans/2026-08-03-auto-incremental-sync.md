# Automatic Incremental Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every shop-scoped page read local data first and automatically request a deduplicated incremental Ozon correction only when the relevant resource is older than five minutes.

**Architecture:** Add one persistent `sync_states` row per shop/resource for freshness, cursor, order window, and expiring lease. A FastAPI auto-sync endpoint maps the active view to resources, acquires leases transactionally, and schedules application background work; existing business list APIs remain local-database reads. Production configuration supports PostgreSQL while SQLite remains the automated-test database.

**Tech Stack:** Python 3, FastAPI BackgroundTasks, SQLAlchemy 2, PostgreSQL/psycopg, SQLite tests, vanilla JavaScript frontend, pytest.

---

### Task 1: Persist resource freshness and PostgreSQL runtime support

**Files:**
- Modify: `backend/app/erp_models.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/database.py`
- Modify: `backend/requirements.txt`
- Modify: `.env.example`
- Test: `backend/tests/test_erp_schema.py`

- [ ] **Step 1: Write the failing schema test**

Add an assertion that `sync_states` exists and has a unique `(shop_id, resource)` key represented by the SQLAlchemy model.

- [ ] **Step 2: Run the schema test and verify RED**

Run: `$env:PYTHONPATH='backend'; pytest backend/tests/test_erp_schema.py -q`

Expected: failure because `sync_states` is absent.

- [ ] **Step 3: Add the minimal model and runtime dependencies**

Create `SyncState` with `shop_id`, `resource`, `last_success_at`, `cursor`, `window_end_at`, `lease_owner`, `lease_expires_at`, `last_error`, and `updated_at`. Add `psycopg[binary]` and `alembic` dependencies, PostgreSQL pool pre-ping, and document PostgreSQL `DATABASE_URL`; keep SQLite-only additive migrations guarded by URL scheme.

- [ ] **Step 4: Run the test and verify GREEN**

Run the schema test again and require a clean pass.

### Task 2: Decide freshness and acquire one lease

**Files:**
- Create: `backend/app/auto_sync.py`
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_auto_sync.py`

- [ ] **Step 1: Write failing decision tests**

Cover these behaviors with a real SQLite database: the first request returns `started`; a second request inside five minutes returns `already_running` while leased; a successfully refreshed state returns `fresh`; an expired lease can be reacquired; and view mappings are `orders -> fbs_postings,fbs_product_images`, `products -> products`, `dashboard -> products,fbs_postings`, `listing -> categories`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `$env:PYTHONPATH='backend'; pytest backend/tests/test_auto_sync.py -q`

Expected: import or assertion failure because the coordinator does not exist.

- [ ] **Step 3: Implement the minimal coordinator**

Define a five-minute freshness duration, a five-minute lease duration, a fixed server-side view map, and `request_auto_sync(db, shop_id, view, now)` returning resource/status records. Use a transaction and `SELECT ... FOR UPDATE` on PostgreSQL; rely on the unique resource row plus commit on SQLite tests. Do not call Ozon in this function.

- [ ] **Step 4: Run focused and full tests and verify GREEN**

Run the focused test, then `pytest backend/tests -q`.

### Task 3: Run incremental corrections and advance state only on success

**Files:**
- Modify: `backend/app/auto_sync.py`
- Modify: `backend/app/sync_service.py`
- Test: `backend/tests/test_auto_sync.py`
- Test: `backend/tests/test_sync_service.py`

- [ ] **Step 1: Write failing worker tests**

Assert that product work passes the stored cursor and saves the returned cursor; an empty returned cursor resets the rolling cycle; FBS work starts at `window_end_at - 10 minutes` or at `now - 7 days` for first sync; successful work updates `last_success_at`; failed work preserves the prior cursor/success time, stores a safe error, and releases the lease.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: failures because the background resource runner is absent.

- [ ] **Step 3: Implement the worker**

Open a new `SessionLocal` inside `run_auto_sync_resource(shop_id, resource, lease_owner)`. Call the existing idempotent product/FBS/image services with resource-specific parameters. Update `SyncState` only when the matching lease is still owned; always clear the lease at completion. Treat the current Ozon product cursor as rolling pagination, not a change timestamp.

- [ ] **Step 4: Verify GREEN**

Run focused tests followed by the full backend suite.

### Task 4: Expose non-blocking auto-sync API

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_auto_sync.py`

- [ ] **Step 1: Write a failing endpoint/coordinator contract test**

Verify accepted views, unknown-view validation, shop-not-found behavior, and that only resources with `started` status are queued.

- [ ] **Step 2: Verify RED**

Run the focused test and confirm the route/coordinator contract is missing.

- [ ] **Step 3: Implement the endpoint**

Add `POST /api/v1/shops/{shop_id}/auto-sync` using `BackgroundTasks`. Return decisions immediately and add one background task per acquired resource lease. Keep all existing list endpoints database-only.

- [ ] **Step 4: Verify GREEN**

Run focused and full backend tests.

### Task 5: Trigger correction from shop and view changes

**Files:**
- Modify: `frontend/app.js`
- Modify: `frontend/index.html`
- Test: `frontend/auto-sync.test.mjs`

- [ ] **Step 1: Write a failing dependency-free JavaScript test**

Extract and export a pure `resourcesForView`/trigger policy module or testable functions. Assert the current view is submitted after selecting a shop, repeated in-flight requests are deduplicated, local load runs before the auto-sync request, and a completed correction causes one local reload.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test frontend/auto-sync.test.mjs`

Expected: failure because the trigger module is absent.

- [ ] **Step 3: Implement local-first automatic correction**

On shop selection and navigation, call the existing local loader immediately, then `POST /auto-sync` for the active view. Show quiet status text for `fresh`, `started`, and failure; remove the requirement to click the top sync button for normal operation. Rename manual action to `强制校正` and keep it explicit.

- [ ] **Step 4: Verify GREEN and syntax**

Run the Node test and `node --check frontend/app.js`.

### Task 6: PostgreSQL migration and operational documentation

**Files:**
- Create: `alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/versions/20260803_01_sync_states.py`
- Modify: `backend/README.md`
- Modify: `docs/DATA_AND_SYNC_DESIGN.zh-CN.md`
- Modify: `docs/MASTER_PLAN.zh-CN.md`
- Modify: `docs/SESSION_HANDOFF.zh-CN.md`

- [ ] **Step 1: Add migration configuration and revision**

Configure Alembic to read `DATABASE_URL` and import `Base.metadata`. The revision creates `sync_states`, its unique constraint, foreign key, and freshness/lease indexes without containing credentials.

- [ ] **Step 2: Validate migration offline**

Run: `$env:PYTHONPATH='backend'; alembic upgrade head --sql`

Expected: SQL containing `CREATE TABLE sync_states` with no secret values.

- [ ] **Step 3: Update Chinese runbook and highest-plan handoff**

Document PostgreSQL startup/configuration, SQLite test usage, local-first behavior, five-minute TTL, ten-minute FBS overlap, rolling product cursor, force-correction semantics, and recovery behavior.

- [ ] **Step 4: Final verification**

Run: `$env:PYTHONPATH='backend'; pytest backend/tests -q; node --test frontend/auto-sync.test.mjs; node --check frontend/app.js; git diff --check`

Expected: all tests pass, scripts parse, and no whitespace errors.
