import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("server auto-listing imports resolve at runtime", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const autoListing = await import("../src/autoListing.js");
  const importEnd = source.indexOf('} from "./autoListing.js";');
  const importStart = source.lastIndexOf("import {", importEnd);
  assert.ok(importStart >= 0 && importEnd > importStart, "server auto-listing import block should exist");
  const importBlock = source.slice(importStart + "import {".length, importEnd);
  const importedNames = importBlock.split(",").map((name) => name.trim()).filter(Boolean);
  for (const name of importedNames) assert.ok(name in autoListing, `autoListing.js must export ${name}`);
});

test("manual 1688 capture routes share the versioned input and receipt contract", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /normalizeManualCapturePayload/);
  assert.match(source, /contractVersion/);
  const start = source.indexOf('app.post("/api/1688/capture"');
  const end = source.indexOf('app.post("/api/pdd/capture"', start);
  const route = source.slice(start, end);
  assert.match(route, /normalizeManualCapturePayload\(body\)/);
  assert.match(route, /captureInput\.hints/);
  assert.doesNotMatch(route, /parsePddProduct/);
});

test("server does not register duplicate method and path combinations", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const routes = [...source.matchAll(/app\.(get|post|put|patch|delete)\("([^"]+)"/g)]
    .map((match) => `${match[1].toUpperCase()} ${match[2]}`);
  const duplicates = [...new Set(routes.filter((route, index) => routes.indexOf(route) !== index))];

  assert.deepEqual(duplicates, []);
});

test("server defaults to loopback hosting and an explicit local CORS allowlist", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /process\.env\.HOST \|\| "127\.0\.0\.1"/);
  assert.match(source, /app\.listen\(port, host,/);
  assert.match(source, /function buildCorsOptions/);
  assert.match(source, /CORS_ALLOWED_ORIGINS/);
  assert.match(source, /http:\/\/localhost:/);
  assert.match(source, /http:\/\/127\.0\.0\.1:/);
  assert.match(source, /if \(!origin\) return callback\(null, true\)/);
  assert.match(source, /CORS_ORIGIN_DENIED/);
  assert.match(source, /app\.use\(cors\(corsOptions\)\)/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin", "\*"/);
  assert.doesNotMatch(source, /app\.use\(cors\(\)\)/);
});

test("CORS allows the frontend signed-read environment header used by Seller API reads", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("function buildCorsOptions");
  const end = source.indexOf("const corsOptions", start);
  assert.ok(start >= 0 && end > start);
  const corsBlock = source.slice(start, end);
  assert.match(corsBlock, /allowedHeaders:\s*\[[^\]]*X-Ozon-ERP-Read-Environment/);
  assert.match(source, /X-Ozon-ERP-Read-Environment/);
});

test("server exposes an unauthenticated liveness probe without claiming readiness", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /app\.get\("\/api\/healthz"/);
  const routeStart = source.indexOf('app.get("/api/healthz"');
  const routeEnd = source.indexOf("});", routeStart) + 3;
  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /readiness: "liveness_only"/);
  assert.match(route, /authBoundary: "api_routes_require_authentication"/);
  assert.match(route, /不读取店铺、不联网、不写入业务数据/);
  assert.match(source, /req\.path === "\/api\/healthz"\) return next\(\)/);
});

test("auto-listing job routes enforce the job store boundary", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /function autoListingJobVisibleToRequest/);
  assert.match(source, /async function getScopedAutoListingJob/);
  const listStart = source.indexOf('app.get("/api/ozon-learning/auto-list-jobs"');
  const detailStart = source.indexOf('app.get("/api/ozon-learning/auto-list-jobs/:id"');
  const contentStart = source.indexOf('app.post("/api/ozon-learning/auto-list-jobs/:id/manual-content"');
  const readinessStart = source.indexOf('app.get("/api/ozon-learning/auto-list-jobs/:id/product-readiness"');
  assert.ok(listStart >= 0 && detailStart > listStart);
  assert.match(source.slice(listStart, detailStart), /autoListingJobVisibleToRequest/);
  assert.match(source.slice(detailStart, contentStart), /getScopedAutoListingJob/);
  assert.match(source.slice(contentStart, readinessStart), /getScopedAutoListingJob/);
  assert.match(source.slice(readinessStart, source.indexOf('app.post("/api/ozon-learning/readiness-evidence-receipts/plan"', readinessStart)), /getScopedAutoListingJob/);
});

test("server exposes a runtime safety summary without claiming production readiness", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/system\/runtime-safety/);
  assert.match(source, /buildRuntimeSafetySnapshot/);
  assert.match(source, /storeCount: stores\.length/);
  assert.match(source, /runtimeStartupDecision/);
  assert.match(source, /拒绝启动/);
  assert.match(source, /durable_storage_required_but_missing/);
  assert.match(source, /DATABASE_URL/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("server exposes a read-only migration recovery status entry", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /import \{ buildMigrationStateAudit \} from "\.\/migrationStateAudit\.js"/);
  const start = source.indexOf('app.get("/api/system/migration-state"');
  const end = source.indexOf('app.get("/api/system/observability"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /buildMigrationStateAudit/);
  assert.match(route, /res\.json\(await buildMigrationStateAudit\(\)\)/);
  assert.doesNotMatch(route, /write|supabase|ozonRequest|fs\.writeFile/);
});

test("server exposes one read-only production preflight contract for operators", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /import \{ buildProductionMigrationContract \} from "\.\/migrationProductionContract\.js"/);
  assert.match(source, /import \{ buildDiskSpaceCheck \} from "\.\/diskSpaceCheck\.js"/);
  assert.match(source, /productionDeploymentDecision/);
  const start = source.indexOf('app.get("/api/system/deployment-preflight"');
  const end = source.indexOf('app.get("/api/system/observability"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /productionDeploymentDecision/);
  assert.match(route, /runtimeDecision\.allowed/);
  assert.match(route, /buildMigrationStateAudit/);
  assert.match(route, /buildCoreMigrationDryRun/);
  assert.match(route, /runCoreMigrationRecoveryDrill/);
  assert.match(route, /buildProductionMigrationContract/);
  assert.match(route, /buildDiskSpaceCheck/);
  assert.match(route, /buildApiEvidenceSummary/);
  assert.match(route, /check: "api_evidence"/);
  assert.match(route, /canonicalStoreCountVerified/);
  assert.match(route, /Ozon Seller API 文件/);
  assert.match(route, /diskSpace/);
  assert.match(route, /check: "runtime_startup"/);
  assert.match(route, /check: "migration_dry_run"/);
  assert.match(route, /check: "migration_recovery_drill"/);
  assert.match(route, /check: "production_migration_contract"/);
  assert.match(route, /check: "disk_space"/);
  assert.match(route, /verificationLevel: "configuration_declared"/);
  assert.match(route, /flatMap\(\(check\) =>/);
  assert.match(route, /deploymentReady: blockers\.length === 0/);
  assert.match(route, /只读本地部署预检/);
  assert.doesNotMatch(route, /ozonRequest|fs\.writeFile|createClient/);
});

test("server exposes bounded observability summary without automatic remediation", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/system\/observability/);
  assert.match(source, /buildObservabilitySummary/);
  const start = source.indexOf('app.get("/api/system/observability"');
  const end = source.indexOf('app.get("/api/system/api-evidence"', start);
  const route = source.slice(start, end);
  assert.doesNotMatch(route, /retry|replay|enqueue|ozonRequest/);
});

test("ops start refuses unsafe external or non-durable production configuration", async () => {
  const source = await readFile(new URL("../scripts/ops.ps1", import.meta.url), "utf8");
  assert.match(source, /Assert-StartupPrerequisites/);
  assert.match(source, /function Test-DurableDatabaseConfiguration/);
  assert.match(source, /current JobRepository has a Supabase adapter only/);
  assert.match(source, /TryCreate/);
  assert.match(source, /parsedSupabase\.Scheme -eq "https"/);
  assert.match(source, /external HOST requires/);
  assert.match(source, /durable storage is required/);
  assert.match(source, /DATABASE_URL/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /store scope is required; configure an explicit allowed store scope/);
});

test("ops start explicitly blocks external automation before spawning", async () => {
  const source = await readFile(new URL("../scripts/ops.ps1", import.meta.url), "utf8");
  assert.match(source, /\$automationEnabled = \$env:OZON_SERVER_AUTO_HEAL -eq "1"/);
  assert.match(source, /-not \$loopback -and \$automationEnabled -and -not \$authConfigured/);
  assert.match(source, /external automation requires OZON_ERP_AUTH_SECRET or AUTH_SECRET/);
});

test("ops start applies the production single-instance session revocation boundary", async () => {
  const source = await readFile(new URL("../scripts/ops.ps1", import.meta.url), "utf8");
  assert.match(source, /OZON_ERP_AUTH_SINGLE_INSTANCE/);
  assert.match(source, /-not \$loopback -and \$env:OZON_ERP_AUTH_SINGLE_INSTANCE -ne "1"/);
  assert.match(source, /shared session revocation/);
});

test("ops start applies the same admin-write prerequisite as runtime startup", async () => {
  const source = await readFile(new URL("../scripts/ops.ps1", import.meta.url), "utf8");
  assert.match(source, /if \(\$directWritesEnabled -and -not \$adminConfigured\)/);
  assert.match(source, /direct writes require OZON_ERP_ADMIN_SECRET/);
  assert.match(source, /including loopback development/);
});

test("ops start applies principal store-scope prerequisite", async () => {
  const source = await readFile(new URL("../scripts/ops.ps1", import.meta.url), "utf8");
  assert.match(source, /OZON_ERP_REQUIRE_PRINCIPAL_SCOPE/);
  assert.match(source, /OZON_ERP_AUTH_STORE_IDS/);
  assert.match(source, /principal scope is required/);
});

test("server startup maps principal-scope and migration blockers to operator next steps", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /principal_store_scope_required_but_missing/);
  assert.match(source, /OZON_ERP_AUTH_STORE_IDS/);
  const migrationStart = source.indexOf('app.get("/api/system/migration-state"');
  const migrationEnd = source.indexOf('app.get("/api/system/observability"', migrationStart);
  const migrationRoute = source.slice(migrationStart, migrationEnd);
  assert.match(migrationRoute, /buildMigrationStateAudit/);
});

test("ops start applies store-scope prerequisite consistently on loopback and external hosts", async () => {
  const source = await readFile(new URL("../scripts/ops.ps1", import.meta.url), "utf8");
  assert.match(source, /if \(\$storeScopeRequired -and \[string\]::IsNullOrWhiteSpace\(\$allowedStoreIds\)\)/);
  assert.match(source, /store scope is required; configure an explicit allowed store scope/);
  assert.doesNotMatch(source, /if \(\-not \$loopback -and \$storeScopeRequired/);
});

test("ops start verifies the server process and listener before reporting success", async () => {
  const source = await readFile(new URL("../scripts/ops.ps1", import.meta.url), "utf8");
  assert.match(source, /function Test-ServerReady/);
  assert.match(source, /Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http:\/\/127\.0\.0\.1:5178\/api\/healthz"/);
  assert.match(source, /liveness_only/);
  assert.match(source, /serverPids/);
  assert.match(source, /function Assert-Started/);
  assert.match(source, /Start-Process -FilePath node -ArgumentList "src\/server\.js"/);
  assert.match(source, /Assert-Started/);
  assert.match(source, /Server did not become ready/);
  const startBlock = source.slice(source.indexOf('"start" {'), source.indexOf('default {'));
  assert.ok(startBlock.indexOf("Assert-Started") < startBlock.indexOf("src/dailyDistributor.js"), "distributor starts only after server liveness");
});

test("ops start refuses to create a duplicate server or distributor process", async () => {
  const source = await readFile(new URL("../scripts/ops.ps1", import.meta.url), "utf8");
  assert.match(source, /function Assert-NoExistingTargets/);
  assert.match(source, /an ERP server\/distributor is already running/);
  const startBlock = source.slice(source.indexOf('"start" {'), source.indexOf('default {'));
  assert.ok(startBlock.indexOf("Assert-NoExistingTargets") < startBlock.indexOf("Start-Process"));
});

test("server protects API requests when bound outside loopback", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /requestAuthDecision/);
  assert.match(source, /x-ozon-erp-auth/);
  assert.match(source, /需要有效的 ERP 认证/);
  assert.match(source, /authTransportDecision/);
  assert.match(source, /AUTH_HTTPS_REQUIRED/);
  assert.match(source, /OZON_ERP_TRUST_PROXY/);
});

test("crawler session cookie mutation requires the operator admin boundary", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /function requireCrawlerSessionAdmin/);
  const start = source.indexOf('app.post("/api/1688-crawler/session/cookie"');
  const end = source.indexOf('app.delete("/api/1688-crawler/session/cookie"', start);
  assert.ok(start >= 0 && end > start);
  const postRoute = source.slice(start, end);
  assert.match(postRoute, /requireCrawlerSessionAdmin/);
  const deleteStart = end;
  const deleteEnd = source.indexOf('app.get("/api/1688-crawler/extension/next"', deleteStart);
  const deleteRoute = source.slice(deleteStart, deleteEnd);
  assert.match(deleteRoute, /requireCrawlerSessionAdmin/);
  assert.match(source, /CRAWLER_SESSION_ADMIN_REQUIRED/);
  assert.match(source, /当前会话没有采集会话管理员权限/);
});

test("server exposes a session exchange without exposing the auth secret", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/auth\/session/);
  assert.match(source, /Set-Cookie/);
  assert.match(source, /HttpOnly/);
  assert.match(source, /不调用 Ozon API/);
  assert.match(source, /app\.delete\("\/api\/auth\/session"/);
  assert.match(source, /Max-Age=0/);
  assert.match(source, /x-forwarded-proto/);
  assert.match(source, /Secure/);
  assert.match(source, /Session exchange is a bootstrap operation/);
  assert.match(source, /authorization: ""/);
});

test("server session proof endpoint only exposes a hash-bound scope for signed sessions", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/auth/session-proof"');
  assert.ok(start >= 0);
  const end = source.indexOf('app.delete("/api/auth/session"', start);
  const route = source.slice(start, end);
  assert.match(route, /session_cookie/);
  assert.match(route, /session_bearer/);
  assert.match(route, /SESSION_PROOF_SIGNED_SESSION_REQUIRED/);
  assert.match(route, /verificationLevel: "server_verified"/);
  assert.match(route, /verified: true/);
  assert.match(route, /proofRefHash/);
  assert.match(route, /storeIds/);
  assert.match(route, /SESSION_PROOF_ENVIRONMENT_REQUIRED/);
  assert.doesNotMatch(route, /process\.env\.OZON_ERP_ENVIRONMENT/);
  assert.doesNotMatch(route, /buildAuthSessionToken|apiKey|ozonRequest/);
  assert.match(route, /不返回 Token\/API key/);
});

test("server applies one store-scope gate to authenticated API body/query storeIds", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /storeAccessDecision\(\{ storeId, env: process\.env, principal: req\.authPrincipal \}\)/);
  assert.match(source, /STORE_SCOPE_MISMATCH/);
  assert.match(source, /当前 ERP 会话未获准访问该店铺/);
  assert.ok(source.indexOf("storeAccessDecision({ storeId, env: process.env, principal: req.authPrincipal })") > source.indexOf("requestAuthDecision({"));
});

test("store listing cannot bypass principal store scope", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/stores"');
  const end = source.indexOf('app.post("/api/auth/session"', start);
  const route = source.slice(start, end);
  assert.match(route, /scopedStoreList\(loadStores\(\), req\.authPrincipal\)/);
  assert.match(source, /PRINCIPAL_STORE_SCOPE_REQUIRED/);
  assert.match(source, /deploymentStores\.filter\(\(store\) => principalStoreIds\.has\(String\(store\.id\)\)/);
});

test("store listing applies deployment allowlist before principal scope", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("function scopedStoreList");
  const end = source.indexOf('app.get("/api/stores"', start);
  const helper = source.slice(start, end);
  assert.match(helper, /parseStoreScope\(env\.OZON_ERP_ALLOWED_STORE_IDS \|\| env\.OZON_ERP_STORE_IDS\)/);
  assert.match(helper, /STORE_SCOPE_NOT_CONFIGURED/);
  assert.match(helper, /const deploymentStores = configuredStoreIds\.size/);
  assert.match(helper, /stores: deploymentStores/);
  assert.match(helper, /deploymentStores\.filter\(\(store\) => principalStoreIds/);
});

test("connectivity test exposes bounded warehouse read evidence instead of only an ok flag", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/test"');
  const end = source.indexOf('app.get("/api/ozon/warehouses"', start);
  const route = source.slice(start, end);
  assert.match(route, /operationEvidence: buildOperationEvidenceRecord/);
  assert.match(route, /readBoundedPages\("\/v2\/warehouse\/list"/);
  assert.match(route, /cursor: "", limit: 200/);
  assert.match(route, /paginationComplete: paged\.paginationComplete/);
  assert.match(route, /readStatus/);
  assert.match(route, /hasNext: warehouseHasNext/);
  assert.match(route, /readOnly: true/);
  assert.match(route, /不会修改商品、价格、库存或订单/);
});

test("workflow and persisted read-receipt routes bind durable evidence to principal store scope", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /function workflowRunStoreId/);
  assert.match(source, /function workflowRunVisibleToRequest/);
  assert.match(source, /WORKFLOW_STORE_ACCESS_DENIED/);
  assert.match(source, /app\.use\("\/api\/workflows\/:id", asyncRoute\(requireWorkflowRunScope\)\)/);
  assert.match(source, /function principalReceiptStoreRefHashes/);
  assert.match(source, /function storeRefHashesForIds/);
  assert.match(source, /OZON_ERP_ALLOWED_STORE_IDS/);
  assert.match(source, /deploymentHashes/);
  assert.match(source, /function receiptStoreScopeDecision/);
  const receiptStart = source.indexOf('app.get("/api/ozon/read-operator/receipts"');
  const receiptEnd = source.indexOf('app.post("/api/ozon-learning/readiness-evidence-receipts"', receiptStart);
  const receiptRoute = source.slice(receiptStart, receiptEnd);
  assert.match(receiptRoute, /receiptStoreScopeDecision\(req, storeRefHash\)/);
  assert.match(receiptRoute, /storeScope\.hashes\.has\(receipt\.storeRefHash\)/);
  const readinessPostStart = source.indexOf('app.post("/api/ozon-learning/readiness-evidence-receipts"');
  const readinessPostEnd = source.indexOf('app.get("/api/ozon-learning/readiness-evidence-receipts"', readinessPostStart);
  assert.match(source.slice(readinessPostStart, readinessPostEnd), /getScopedAutoListingJob\(jobId, req\)/);
  const readinessGetStart = source.indexOf('app.get("/api/ozon-learning/readiness-evidence-receipts"');
  assert.match(source.slice(readinessGetStart), /receiptStoreScopeDecision\(req, requestedStoreRefHash\)/);
});

test("server exposes Seller API evidence summary without treating coverage as permission", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/system\/api-evidence/);
  assert.match(source, /buildApiEvidenceSummary/);
  assert.match(source, /loadStores\(DEFAULT_API_FILE\)/);
  assert.match(source, /apiSourcePath: DEFAULT_API_FILE/);
  assert.match(source, /Ozon Seller API 文件\.html/);
});

test("product dashboard exposes bounded read evidence without write semantics", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/product-dashboard"');
  const end = source.indexOf('app.get("/api/ozon/product-prices"', start);
  const route = source.slice(start, end);
  assert.match(route, /readEvidence/);
  assert.match(route, /checkedAt/);
  assert.match(route, /partial/);
  assert.match(route, /hasNext/);
  assert.match(route, /missingEvidence/);
  assert.match(route, /readStatus/);
  assert.match(route, /nextAction/);
  assert.match(route, /safeToWrite: false/);
  assert.match(route, /operationEvidence/);
  assert.match(route, /v3\/product\/info\/list/);
  assert.match(route, /未修改商品、价格或库存/);
});

test("product dashboard preserves list evidence when detail read fails", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/product-dashboard"');
  const end = source.indexOf('app.get("/api/ozon/product-prices"', start);
  const route = source.slice(start, end);
  assert.match(route, /let detailReadFailed = false/);
  assert.match(route, /catch \{\s*detailReadFailed = true/);
  assert.match(route, /detailReadFailed \? listItems : detailItems/);
  assert.match(route, /product_details_read_failed/);
  assert.match(route, /statusCode: detailReadFailed \? 502 : 200/);
  assert.match(route, /verificationLevel: detailReadFailed \? "failed" : "server_observed"/);
});

test("product dashboard preserves missing list rows as unknown detail evidence", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/product-dashboard"');
  const end = source.indexOf('app.get("/api/ozon/product-prices"', start);
  const route = source.slice(start, end);
  assert.match(route, /productEvidenceKey/);
  assert.match(route, /summarizeMissingProductDetail/);
  assert.match(route, /detailItems\.length < productIds\.length/);
  const helperStart = source.indexOf("function summarizeMissingProductDetail");
  const helperEnd = source.indexOf("function summarizeWarehouses", helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /detailStatus: "unknown"/);
  assert.match(helper, /detailStatusLabel: "商品详情未知"/);
  assert.match(route, /products = listItems\.map\(\(item\) =>/);
});

test("product dashboard exposes seller recovery tasks for missing details and unknown status", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/product-dashboard"');
  const end = source.indexOf('app.get("/api/ozon/product-prices"', start);
  const route = source.slice(start, end);
  assert.match(route, /const sellerTasks = \[\];/);
  assert.match(route, /PRODUCT_DETAILS_READ_FAILED/);
  assert.match(route, /PRODUCT_DETAILS_INCOMPLETE/);
  assert.match(route, /PRODUCT_STATUS_UNKNOWN/);
  assert.match(route, /sellerTasks,/);
});

test("product dashboard filters only the observed page and keeps partial/pagination evidence", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/product-dashboard"');
  const end = source.indexOf('app.get("/api/ozon/product-prices"', start);
  const route = source.slice(start, end);
  const filterAt = route.indexOf("const query = String(req.query.query");
  const responseAt = route.indexOf("readEvidence:");
  const countsAt = route.indexOf("const counts =");
  assert.ok(filterAt > 0 && responseAt > filterAt && countsAt > filterAt);
  assert.match(route, /if \(listHasNext\) missingEvidence\.push\("pagination"\)/);
  assert.match(route, /all: listContainer\?\.total \|\| products\.length/);
  assert.match(route, /partial: missingEvidence\.length > 0/);
});

test("product dashboard keeps missing stock as unknown instead of inventing zero", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("function summarizeProduct");
  const end = source.indexOf("function summarizeWarehouses", start);
  const helper = source.slice(start, end);
  assert.match(helper, /const fbsPresent = item\?\.stocks\?\.fbs\?\.present/);
  assert.match(helper, /fbs: fbsPresent === null \|\| fbsPresent === undefined \|\| fbsPresent === "" \? null/);
  assert.match(helper, /fbo: fboPresent === null \|\| fboPresent === undefined \|\| fboPresent === "" \? null/);
  assert.match(helper, /fbs_stock: fbsPresent === null \|\| fbsPresent === undefined \|\| fbsPresent === "" \? null/);
  assert.match(helper, /fbo_stock: fboPresent === null \|\| fboPresent === undefined \|\| fboPresent === "" \? null/);
  assert.match(helper, /Missing stock is unknown evidence, not zero/);
});

test("product import info rejects malformed task ids before upstream readback", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/product-import-info"');
  const end = source.indexOf('app.get("/api/ozon/stock-queue"', start);
  const route = source.slice(start, end);
  assert.match(route, /Number\.isSafeInteger\(taskId\)/);
  assert.match(route, /PRODUCT_IMPORT_TASK_ID_INVALID/);
  assert.match(route, /task_id: taskId/);
  assert.doesNotMatch(route, /task_id: Number\(req\.body\.task_id\)/);
});

test("product import info route keeps async readback evidence separate from submission", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/product-import-info"');
  const end = source.indexOf('app.get("/api/ozon/stock-queue"', start);
  const route = source.slice(start, end);
  assert.match(route, /operationEvidence/);
  assert.match(route, /server_observed/);
  assert.match(route, /未提交新商品/);
});

test("product prices route keeps read evidence separate from pricing conclusions", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/product-prices"');
  const end = source.indexOf('app.get("/api/ozon/unfulfilled"', start);
  const route = source.slice(start, end);
  assert.match(route, /operationEvidence/);
  assert.match(route, /readOnly: true/);
  assert.match(route, /不替代成本/);
  assert.match(route, /buildProductReadEvidence\(data, \{ kind: "prices" \}\)/);
});

test("legacy unfulfilled route delegates to the current bounded v4 read contract", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/unfulfilled"');
  const end = source.indexOf('app.post("/api/ozon/warehouse-stocks"', start);
  const route = source.slice(start, end);
  assert.match(route, /buildReadEndpointRequest\("\/v4\/posting\/fbs\/unfulfilled\/list"/);
  assert.match(route, /cutoffFrom/);
  assert.match(route, /deliveringDateFrom/);
  assert.match(route, /cursor/);
  assert.doesNotMatch(route, /\/v3\/posting\/fbs\/unfulfilled\/list/);
  assert.match(route, /仅读取当前范围未履约 FBS 订单/);
});

test("product stocks route exposes conservative read evidence", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/product-stocks"');
  const end = source.indexOf('app.post("/api/1688-crawler/match-candidates"', start);
  const route = source.slice(start, end);
  assert.match(route, /buildProductReadEvidence\(data, \{ kind: "stocks" \}\)/);
  assert.match(route, /readEvidence/);
  assert.match(route, /buildReadEndpointRequest\("\/v4\/product\/info\/stocks"/);
  assert.match(route, /cursor: req\.body\.cursor/);
  assert.match(route, /const environment = requestReadEnvironment\(req, req\.body\)/);
  assert.match(route, /environment,/);
  assert.match(route, /明确 Offer\/Product ID/);
  assert.doesNotMatch(route, /last_id: req\.body\.last_id/);
});

test("promotion read routes expose evidence without implying activity writes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/actions"');
  const end = source.indexOf('app.post("/api/ozon/actions/products/deactivate"', start);
  const route = source.slice(start, end);
  assert.match(route, /operationEvidence/);
  assert.match(route, /readOnly: true/);
  assert.match(route, /仅读取活动列表/);
  assert.match(route, /actions\/products/);
  assert.match(route, /actions\/candidates/);
  assert.match(route, /impactPreview/);
  assert.match(route, /buildPromotionImpactPreview/);
  assert.match(route, /sellerResult\.coverageComplete === true/);
  assert.match(route, /storeId: store\.id/);
});

test("server exposes both legacy and concise flow status routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /app\.get\("\/api\/ozon-learning\/flow-status"/);
  assert.match(source, /app\.get\("\/api\/flow\/status"/);
});

test("server exposes workflow continue node route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/:id\/nodes\/:key\/continue/);
  assert.match(source, /continueWorkflowNode/);
  assert.match(source, /rerunAutoListingMatch/);
  assert.match(source, /rerunAutoListingContent/);
  assert.match(source, /requestAutoListingNewSource/);
});

test("server exposes controlled workflow chain route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/:id\/controlled-chain/);
  assert.match(source, /runControlledWorkflowChain/);
  assert.match(source, /validatePayloadDraft/);
});

test("server exposes payload draft submit safety route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/:id\/payload-draft\/submit/);
  assert.match(source, /submitPayloadDraftToOzon/);
  assert.match(source, /confirmSubmit/);
  assert.match(source, /requireListingSubmitRole/);
  assert.match(source, /LISTING_SUBMIT_ROLE_REQUIRED/);
});

test("direct Ozon write routes require explicit confirmation and an idempotency key", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /function requireDirectOzonWriteSafety/);
  assert.match(source, /confirmDirectWrite/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /DIRECT_WRITE_CONFIRMATION_REQUIRED/);
  assert.match(source, /DIRECT_WRITE_IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(source, /privilegedWriteDecision/);
  assert.match(source, /X-Ozon-ERP-Admin/);
  assert.match(source, /ADMIN_AUTH_NOT_CONFIGURED/);

  assert.doesNotMatch(
    source,
    /app\.post\("\/api\/ozon\/product-import",/,
    "product import must only go through workflow preflight and draft-hash confirmation",
  );

  for (const route of [
    "/api/ozon/warehouse-stocks",
    "/api/ozon/prices",
    "/api/ozon/actions/products/deactivate",
    "/api/ozon/product-pictures-import",
  ]) {
    const escaped = route.replaceAll("/", "\\/");
    assert.match(
      source,
      new RegExp(`app\\.post\\(\"${escaped}\", requireDirectOzonWriteSafety, (?:[A-Za-z0-9_]+, )*directOzonWriteRoute`),
      `${route} must retain the direct-write safety gate before its handler`,
    );
  }

  assert.doesNotMatch(source, /app\.get\("\/api\/ozon\/actions", requireDirectOzonWriteSafety/);
  assert.doesNotMatch(source, /app\.post\("\/api\/workflows\/:id\/payload-draft\/submit", requireDirectOzonWriteSafety/);
});

test("promotion removal requires complete price-backed read preflight and server readback", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /function requirePromotionWritePreflight/);
  assert.match(source, /DIRECT_WRITE_ACTIVITY_PREFLIGHT_REQUIRED/);
  assert.match(source, /DIRECT_WRITE_ACTIVITY_CONFIRMATION_REQUIRED/);
  assert.match(source, /buildActivityReadSellerResult/);
  assert.match(source, /buildPromotionImpactPreview/);
  assert.match(source, /coverageComplete !== true/);
  assert.match(source, /unknownPriceCount/);
  assert.match(source, /promotionWriteReadback/);
  assert.match(source, /itemResults/);
  const start = source.indexOf('app.post("/api/ozon/actions/products/deactivate"');
  const end = source.indexOf('app.post("/api/ozon/product-import-info"', start);
  const route = source.slice(start, end);
  assert.match(route, /requireDirectOzonWriteSafety, requirePromotionWritePreflight, directOzonWriteRoute/);
  assert.match(route, /promotionWriteReadback/);
  assert.ok(route.indexOf("requirePromotionWritePreflight") < route.indexOf("ozonRequest"));
});

test("administrator write gate does not apply to local workflow/manual routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const gateStart = source.indexOf("function requireDirectOzonWriteSafety");
  const gateEnd = source.indexOf("function stableCommandJson", gateStart);
  const gate = source.slice(gateStart, gateEnd);
  assert.match(gate, /privilegedWriteDecision/);
  assert.match(gate, /X-Ozon-ERP-Admin/);
  assert.doesNotMatch(source, /app\.post\("\/api\/workflows\/.*requireDirectOzonWriteSafety/);
  assert.doesNotMatch(source, /app\.post\("\/api\/listing-rule-approval-audit\/intents", requireDirectOzonWriteSafety/);
});

test("direct Ozon write routes are disabled unless explicitly enabled", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /function directOzonWritesEnabled\(env = process\.env\)/);
  assert.match(source, /env\.ENABLE_DIRECT_OZON_WRITES === "1"/);
  const gateStart = source.indexOf("function requireDirectOzonWriteSafety");
  const gateEnd = source.indexOf("function stableCommandJson", gateStart);
  const gate = source.slice(gateStart, gateEnd);
  assert.ok(gate.indexOf("directOzonWritesEnabled") < gate.indexOf("confirmDirectWrite"));
  assert.match(gate, /status\(503\)/);
  assert.match(gate, /DIRECT_WRITES_DISABLED/);
  assert.match(source, /\/api\/ozon\/direct-write-status/);
  assert.match(source, /directWritesEnabled/);
  assert.doesNotMatch(source, /app\.post\("\/api\/workflows\/:id\/payload-draft\/submit", requireDirectOzonWriteSafety/);
});

test("direct Ozon write routes use durable payload-bound idempotency records", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /WriteCommandRepository/);
  assert.match(source, /WRITE_COMMANDS_FILE/);
  assert.match(source, /write-commands\.json/);
  assert.match(source, /function directWritePayloadHash/);
  assert.match(source, /key !== "confirmDirectWrite"/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /beginCommand\(scope, idempotencyKey, payloadHash/);
  assert.match(source, /begun\.status === "conflict"/);
  assert.match(source, /begun\.status === "unresolved_payload"/);
  assert.match(source, /DIRECT_WRITE_UNRESOLVED_PAYLOAD/);
  assert.match(source, /begun\.status === "in_progress"/);
  assert.match(source, /res\.status\(409\)/);
  assert.match(source, /begun\.status === "replay"/);
  assert.match(source, /completeCommand\(scope, idempotencyKey/);
  assert.match(source, /failCommand\(scope, idempotencyKey/);
  assert.doesNotMatch(source, /directOzonWriteRoute\("ozon\.product-import"/);
  assert.match(source, /directOzonWriteRoute\("ozon\.warehouse-stocks"/);
});

test("direct Ozon writes validate the store before creating an idempotency command", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("const directOzonWriteRoute");
  const end = source.indexOf("\nlet latest1688Capture", start);
  const route = source.slice(start, end);
  assert.match(route, /DIRECT_WRITE_STORE_REQUIRED/);
  assert.match(route, /DIRECT_WRITE_STORE_NOT_FOUND/);
  assert.match(route, /getStore\(storeId\)/);
  assert.ok(route.indexOf("getStore(storeId)") < route.indexOf("beginCommand(scope, idempotencyKey"));
});

test("confirmed stock write requires a fresh server-observed dry-run before Ozon write", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /function requireStockWritePreflight/);
  const start = source.indexOf('app.post("/api/ozon/warehouse-stocks/confirmed"');
  const end = source.indexOf('app.post("/api/ozon/prices"', start);
  const route = source.slice(start, end);
  assert.ok(start > 0);
  assert.match(route, /requireDirectOzonWriteSafety, requireStockWritePreflight/);
  assert.match(source, /gatherStockReconciliationEvidence/);
  assert.match(source, /warehouseIds/);
  assert.match(source, /requireWarehouseModeEvidence: true/);
  assert.match(source, /dryRun\.executable !== true/);
  assert.match(source, /DIRECT_WRITE_STOCK_NO_CHANGES/);
  assert.match(source, /dryRun\.plan\.changes\.length === 0/);
  assert.match(route, /ozon\.warehouse-stocks\.confirmed/);
  assert.match(route, /\/v2\/products\/stocks/);
});

test("legacy direct stock write cannot bypass the server-observed preflight", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/warehouse-stocks"');
  const end = source.indexOf('app.post("/api/ozon/warehouse-stocks/confirmed"', start);
  const route = source.slice(start, end);
  assert.ok(start > 0);
  assert.match(route, /requireDirectOzonWriteSafety, requireStockWritePreflight, directOzonWriteRoute/);
  assert.match(route, /DIRECT_WRITE_STOCKS_REQUIRED/);
  assert.ok(route.indexOf("requireStockWritePreflight") < route.indexOf("directOzonWriteRoute"));
});

test("legacy stock write also requires exact tuple readback before command completion", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/warehouse-stocks"');
  const end = source.indexOf('app.post("/api/ozon/warehouse-stocks/confirmed"', start);
  const route = source.slice(start, end);
  assert.match(route, /stockWriteReadback/);
  assert.ok(route.indexOf('ozonRequest(store, "\/v2\/products\/stocks"') < route.indexOf("stockWriteReadback"));
});

test("confirmed stock write cannot complete until exact tuple readback reconciles", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/warehouse-stocks/confirmed"');
  const end = source.indexOf('app.post("/api/ozon/prices"', start);
  const route = source.slice(start, end);
  assert.match(route, /stockWriteReadback/);
  assert.match(source, /gatherStockReconciliationEvidence/);
  assert.match(source, /reconcileDryRunStockJob/);
  assert.match(source, /DIRECT_WRITE_STOCK_READBACK_REQUIRED/);
  assert.match(source, /stockWriteReadback/);
  assert.ok(route.indexOf("ozonRequest(store, \"\/v2\/products\/stocks\"") < route.indexOf("stockWriteReadback"));
});

test("stock write response exposes the exact server-observed readback scope", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /function stockWriteReadbackSummary/);
  assert.match(source, /readbackCheckedAt/);
  assert.match(source, /readbackVerificationLevel: "server_observed"/);
  assert.match(source, /readbackScope/);
});

test("price writes require server-observed current-price diff, risk confirmation, and readback", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /function requirePriceWritePreflight/);
  const start = source.indexOf('app.post("/api/ozon/prices"');
  const end = source.indexOf('app.get("/api/ozon/actions"', start);
  const route = source.slice(start, end);
  assert.match(route, /requireDirectOzonWriteSafety, requirePriceWritePreflight/);
  assert.match(source, /validatePriceWritePreflight/);
  assert.match(source, /DIRECT_WRITE_PRICE_EVIDENCE_SERVER_REQUIRED/);
  assert.match(source, /DIRECT_WRITE_PRICE_CONFIRMATION_REQUIRED/);
  assert.match(route, /reconcilePriceWriteReadback/);
  assert.match(route, /DIRECT_WRITE_PRICE_READBACK_REQUIRED/);
  assert.match(route, /status: "reconciled"/);
});

test("direct write handlers return data to the command wrapper instead of sending twice", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('directOzonWriteRoute("ozon.warehouse-stocks"');
  const end = source.indexOf("}));", start);
  const handler = source.slice(start, end);
  assert.match(handler, /return \{ data, summary:/);
  assert.doesNotMatch(handler, /res\.json/);
});

test("direct Ozon write failures and replays do not leak upstream error text", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /function directWriteSafeFailure/);
  assert.match(source, /function directWriteReplayView/);
  assert.match(source, /DIRECT_WRITE_UPSTREAM_FAILED/);
  assert.match(source, /写入结果未确认；请使用请求 ID 排查/);

  const routeStart = source.indexOf("const directOzonWriteRoute");
  const routeEnd = source.indexOf("\nlet latest1688Capture", routeStart);
  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /directWriteReplayView\(begun\.command\)/);
  assert.match(route, /directWriteSafeFailure\(error\)/);
  assert.doesNotMatch(route, /message:\s*error\.message/);
  assert.doesNotMatch(route, /throw error/);
});

test("uncertain direct write failures require review instead of becoming retryable failures", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /function directWriteOutcomeIsUncertain/);
  assert.match(source, /failure\.status >= 500/);
  assert.match(source, /reviewCommand\(scope, idempotencyKey, "unknown_outcome"/);
  assert.match(source, /DIRECT_WRITE_UNKNOWN_OUTCOME/);
  assert.match(source, /核实前不要换新请求或重复写入/);
  assert.match(source, /replay\.commandState === "needs_review" \? 409 : 200/);
  assert.match(source, /failCommand\(scope, idempotencyKey, failure\)/);
});

test("direct Ozon write handlers reject empty local inputs with safe 400 codes before Ozon calls", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /function directWriteInputError/);
  assert.match(source, /error\.isDirectWriteInputError = true/);
  for (const code of [
    "DIRECT_WRITE_STOCKS_REQUIRED",
    "DIRECT_WRITE_PRICES_REQUIRED",
    "DIRECT_WRITE_ACTION_ID_REQUIRED",
    "DIRECT_WRITE_PRODUCT_IDS_REQUIRED",
    "DIRECT_WRITE_BARCODE_PRODUCT_IDS_REQUIRED",
  ]) {
    assert.match(source, new RegExp(code));
  }

  for (const [route, nextRoute] of [
    ["/api/ozon/warehouse-stocks", "/api/ozon/prices"],
    ["/api/ozon/prices", "/api/ozon/actions"],
    ["/api/ozon/actions/products/deactivate", "/api/ozon/product-import-info"],
    ["/api/ozon/barcodes/generate", "/api/ozon/product-pictures-import"],
  ]) {
    const block = source.slice(source.indexOf(`app.post("${route}"`), source.indexOf(`app.post("${nextRoute}"`, source.indexOf(`app.post("${route}"`) + 1));
    assert.ok(block.indexOf("directWriteInputError") < block.indexOf("ozonRequest"), `${route} must validate before Ozon`);
  }
});

test("direct Ozon write batches use a conservative local limit and pictures require a minimal payload", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /const DIRECT_WRITE_BATCH_LIMIT = 100/);
  assert.match(source, /function requireDirectWriteBatchLimit/);
  for (const code of [
    "DIRECT_WRITE_STOCKS_LIMIT_EXCEEDED",
    "DIRECT_WRITE_PRICES_LIMIT_EXCEEDED",
    "DIRECT_WRITE_PRODUCT_IDS_LIMIT_EXCEEDED",
    "DIRECT_WRITE_BARCODE_PRODUCT_IDS_LIMIT_EXCEEDED",
    "DIRECT_WRITE_PICTURE_PAYLOAD_REQUIRED",
    "DIRECT_WRITE_PICTURE_PRODUCT_ID_REQUIRED",
    "DIRECT_WRITE_PICTURE_IMAGES_REQUIRED",
    "DIRECT_WRITE_PICTURE_IMAGES_LIMIT_EXCEEDED",
  ]) {
    assert.match(source, new RegExp(code));
  }
  assert.doesNotMatch(source, /product_ids[^;]{0,180}\.slice\(0, 100\)/s);

  const pictureStart = source.indexOf('app.post("/api/ozon/product-pictures-import"');
  const pictureEnd = source.indexOf('app.post("/api/ozon/product-stocks"', pictureStart);
  const pictureRoute = source.slice(pictureStart, pictureEnd);
  assert.match(pictureRoute, /validateDirectWritePicturePayload/);
  assert.ok(pictureRoute.indexOf("validateDirectWritePicturePayload") < pictureRoute.indexOf("ozonRequest"));
  assert.doesNotMatch(pictureRoute, /req\.body\.payload \|\| \{\}/);
});

test("server exposes write command attention as a safe read-only view", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /app\.get\("\/api\/ozon\/write-command-attention"/);
  assert.match(source, /function directWriteAttentionView/);
  assert.match(source, /summarizeNeedsReview\(\)/);
  assert.match(source, /listCommands\(\{[\s\S]*state: \["needs_review", "in_progress"\]/);
  assert.match(source, /safeNextStep/);

  const viewStart = source.indexOf("function directWriteAttentionView");
  const viewEnd = source.indexOf("\n}\n", viewStart) + 2;
  const view = source.slice(viewStart, viewEnd);
  for (const sensitiveField of ["id:", "payloadHash", "key:", "actorId", "resultSummary", "errorSummary"]) {
    assert.doesNotMatch(view, new RegExp(sensitiveField));
  }
});

test("server exposes confirmed local payload attribute repair route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/:id\/payload-draft\/attribute-repair/);
  assert.match(source, /applyPayloadDraftAttributeRepair/);
  assert.match(source, /confirmLocalDraftRepair/);
});

test("server exposes stale workflow reconciliation route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/reconcile-stale/);
  assert.match(source, /reconcileStaleWorkflowRuns/);
});

test("server exposes workflow pricing risk action routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/:id\/nodes\/:key\/pricing-risk\/accept/);
  assert.match(source, /\/api\/workflows\/:id\/nodes\/:key\/pricing-risk\/recalculate/);
  assert.match(source, /acceptWorkflowPricingRisk/);
  assert.match(source, /requestWorkflowPricingRecalculation/);
});

test("server exposes external Ozon learning monitor routes and starts the monitor", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/ozon-learning\/external-source\/status/);
  assert.match(source, /\/api\/ozon-learning\/external-source\/sync/);
  assert.match(source, /getExternalOzonLearningStatus/);
  assert.match(source, /syncExternalOzonLearning/);
  assert.match(source, /startExternalOzonLearningMonitor\(\)/);
});

test("server exposes listing edit journal routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /listingEditJournal/);
  assert.match(source, /\/api\/listing-edit-journal\/events/);
  assert.match(source, /appendListingEditEvent/);
  assert.match(source, /listListingEditEvents/);
  assert.match(source, /summarizeListingEditJournal/);
});

test("server exposes listing rule approval audit routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /ruleApprovalAudit/);
  assert.match(source, /\/api\/listing-rule-approval-audit\/intents/);
  assert.match(source, /appendRuleApprovalAuditIntent/);
  assert.match(source, /listRuleApprovalAuditIntents/);
  assert.match(source, /summarizeRuleApprovalAuditIntents/);
});

test("1688 capture responses expose a redacted task identity receipt", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /function buildCaptureResponseReceipt/);
  assert.match(source, /captureReceipt: buildCaptureResponseReceipt/);
  assert.match(source, /rawContentStored: false/);
  assert.match(source, /canonicalUrl: String\(captureIdentity\.canonicalUrl/);
});

test("1688 capture has a seller-facing local preflight entry without Ozon side effects", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/1688/captures/:id/preflight"');
  const end = source.indexOf('app.delete("/api/1688/captures/:id"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /createListingWorkflowFrom1688Capture/);
  assert.match(route, /validatePayloadDraft/);
  assert.match(route, /sellerTask:/);
  assert.match(route, /PREFLIGHT_PAYLOAD_DRAFT_REQUIRED/);
  assert.match(route, /未联网、未读取 Seller API、未调用 Ozon 写接口/);
  assert.doesNotMatch(route, /ozonRequest/);
});

test("1688 capture workflow requires the persisted human snapshot review", async () => {
  const [source, listing, captureReplay] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/autoListing.js", import.meta.url), "utf8"),
    readFile(new URL("../src/captureReplay.js", import.meta.url), "utf8"),
  ]);
  const start = source.indexOf('app.post("/api/1688/captures/:id/workflow"');
  const end = source.indexOf('app.post("/api/1688/captures/:id/preflight"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /captureReview/);
  assert.match(listing, /CAPTURE_HUMAN_REVIEW_REQUIRED/);
  assert.match(captureReplay, /CAPTURE_SOURCE_URL_INVALID/);
  assert.match(captureReplay, /CAPTURE_OFFER_ID_MISSING/);
  assert.match(listing, /build1688CaptureImportReview/);
  assert.match(source, /app\.post\("\/api\/1688\/captures\/:id\/review"/);
});

test("legacy learning submit route fails closed before any Ozon write", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon-learning/complete-listing"');
  const end = source.indexOf('app.post("/api/ozon-learning/analyze-opportunities"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /status\(410\)/);
  assert.match(route, /LEGACY_SUBMIT_PATH_DISABLED/);
  assert.doesNotMatch(route, /completeListing\(/);
  assert.doesNotMatch(route, /ozonRequest\(/);
});

test("server exposes listing rule publish review routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /rulePublishReview/);
  assert.match(source, /\/api\/listing-rule-publish-review\/intents/);
  assert.match(source, /appendRulePublishReviewIntent/);
  assert.match(source, /listRulePublishReviewIntents/);
  assert.match(source, /summarizeRulePublishReviewIntents/);
});

test("server exposes GPT image style analysis routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /getOzonImageStyleAnalysis/);
  assert.match(source, /analyzeOzonImageStyleQueue/);
  assert.match(source, /\/api\/ozon-learning\/image-style-analysis"/);
  assert.match(source, /\/api\/ozon-learning\/image-style-analysis\/run/);
});

test("server exposes on-demand Ozon reference guidance route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /generateOzonReferenceGuidance/);
  assert.match(source, /\/api\/ozon-learning\/reference-guidance/);
});

test("server exposes APIMart GPT Image 2 generation routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /submitGptImage2Generation/);
  assert.match(source, /getImageGenerationTask/);
  assert.match(source, /\/api\/image-generation\/status/);
  assert.match(source, /\/api\/image-generation\/gpt-image-2/);
  assert.match(source, /\/api\/image-generation\/tasks\/:taskId/);
});

test("server exposes stock queue warehouse recommendation enrichment", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/ozon\/stock-queue/);
  assert.match(source, /includeWarehouseRecommendation/);
  assert.match(source, /stockJobWarehouseRecommendation/);
  assert.match(source, /warehouseRecommendationError/);
});

test("server exposes a read-only stock queue operations summary", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/ozon\/stock-queue\/ops-summary/);
  assert.match(source, /summarizeStockQueueOperations/);
  const start = source.indexOf('app.get("/api/ozon/stock-queue/ops-summary"');
  const end = source.indexOf('app.post("/api/ozon/stock-reconciliation/dry-run"', start);
  const route = source.slice(start, end);
  assert.match(route, /listStockJobs/);
  assert.doesNotMatch(route, /enqueueStockJob|replayFailedStockJobs|ozonRequest/);
});

test("warehouse read route records bounded evidence and does not overclaim an empty result", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/warehouses"');
  const end = source.indexOf('app.get("/api/ozon/description-categories"', start);
  const route = source.slice(start, end);
  assert.ok(start > 0);
  assert.match(route, /buildOperationEvidenceRecord/);
  assert.match(route, /warehouseEnvelopeRecognized/);
  assert.match(route, /warehouseReadStatus/);
  assert.match(route, /storeId: store\.id/);
  assert.match(route, /readBoundedPages\("\/v2\/warehouse\/list"/);
  assert.match(route, /paginationComplete: paged\.paginationComplete/);
  assert.match(route, /paginationCursorRepeated: paged\.paginationCursorRepeated/);
  assert.match(route, /warehouseHasNext/);
  assert.match(route, /pagination/);
  assert.match(route, /不能把它解释为没有可用仓库/);
  assert.match(route, /readOnly: true/);
});

test("category and dictionary cache reads require the current store owner", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const categoryRoute = source.slice(
    source.indexOf('app.get("/api/ozon/description-categories"'),
    source.indexOf('app.post("/api/ozon/description-attributes"'),
  );
  const matchRoute = source.slice(
    source.indexOf('app.post("/api/ozon/category-match"'),
    source.indexOf('app.post("/api/images/prepare-ozon"'),
  );
  const valuesRoute = source.slice(
    source.indexOf('app.post("/api/ozon/description-attribute-values"'),
    source.indexOf('app.get("/api/ozon/orders"'),
  );
  assert.match(categoryRoute, /cache\.storeId === store\.id/);
  assert.match(categoryRoute, /inspectCategoryCacheFreshness/);
  assert.match(categoryRoute, /cacheFreshness\.usable/);
  assert.match(categoryRoute, /storeId: store\.id/);
  assert.match(categoryRoute, /operationEvidence/);
  assert.match(matchRoute, /CATEGORY_CACHE_STORE_MISMATCH/);
  assert.match(matchRoute, /cacheFreshness\.reasonCode/);
  assert.match(matchRoute, /cacheFreshness\.usable/);
  assert.match(matchRoute, /getStore\(String\(req\.body\.storeId/);
  assert.match(valuesRoute, /(?:attributeValues\?\.\[cacheKey\]\?\.storeId|cachedValues\?\.storeId) === store\.id/);
  assert.match(valuesRoute, /valueFreshness\.usable/);
  assert.match(valuesRoute, /Array\.isArray\(cachedValues\?\.values\)/);
  assert.match(valuesRoute, /cacheFreshness: valueFreshness/);
  assert.match(valuesRoute, /operationEvidence/);
});

test("category tree, attributes, refresh, and dictionary reads require the signed read session before Ozon transport", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  for (const [routeStart, environmentExpression] of [
    ['app.get("/api/ozon/description-categories"', "req.query.environment"],
    ['app.post("/api/ozon/description-attributes"', "req.body?.environment"],
    ['app.post("/api/ozon/category-cache/refresh"', "req.body?.environment"],
    ['app.post("/api/ozon/description-attribute-values"', "req.body?.environment"],
  ]) {
    const start = source.indexOf(routeStart);
    assert.ok(start >= 0, `missing route ${routeStart}`);
    const end = source.indexOf("\n}));", start);
    const route = source.slice(start, end);
    assert.match(route, new RegExp(environmentExpression.replace(/[?.]/g, "\\$&")));
    assert.match(route, /controlledReadSessionBlock\(req, environment\)/);
    assert.ok(route.indexOf("controlledReadSessionBlock") < route.indexOf("getStore("), `${routeStart} must gate before store credential resolution`);
  }
});

test("golden-path product, warehouse, order, and stock reads share the signed read session gate", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  for (const routeStart of [
    'app.post("/api/ozon/test"',
    'app.get("/api/ozon/warehouses"',
    'app.get("/api/ozon/products"',
    'app.get("/api/ozon/product-dashboard"',
    'app.get("/api/ozon/product-prices"',
    'app.get("/api/ozon/orders"',
    'app.get("/api/ozon/order-dashboard"',
    'app.get("/api/ozon/order-dashboard/detail"',
    'app.get("/api/ozon/unfulfilled"',
    'app.post("/api/ozon/product-stocks"',
    'app.post("/api/ozon/stock-reconciliation/evidence"',
  ]) {
    const start = source.indexOf(routeStart);
    assert.ok(start >= 0, `missing route ${routeStart}`);
    const end = source.indexOf("\n}));", start);
    const route = source.slice(start, end);
    assert.match(route, /requireControlledSellerRead\(req, res/);
    const storeResolution = route.indexOf("getStore(");
    assert.ok(storeResolution < 0 || route.indexOf("requireControlledSellerRead") < storeResolution, `${routeStart} must gate before store credential resolution`);
  }
});

test("stock queue warehouse recommendations share the signed read session gate", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/stock-queue"');
  const end = source.indexOf('app.get("/api/ozon/stock-queue/ops-summary"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /includeWarehouseRecommendation/);
  assert.match(route, /requireControlledSellerRead\(req, res\)/);
  assert.ok(route.indexOf("requireControlledSellerRead") < route.indexOf("getStore(req.query.storeId)"));
});

test("stock queue summaries bind durable jobs to the requested/principal store scope", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /function stockJobVisibleToRequest/);
  assert.match(source, /const jobs = \(await listStockJobs\(\)\)\.filter\(\(job\) => stockJobVisibleToRequest\(job, req\)\)/);
  const start = source.indexOf('app.get("/api/ozon/stock-queue/ops-summary"');
  const end = source.indexOf('app.post("/api/ozon/stock-reconciliation/dry-run"', start);
  const route = source.slice(start, end);
  assert.match(route, /stockJobVisibleToRequest\(job, req\)/);
  assert.match(source.slice(source.indexOf("function stockJobVisibleToRequest"), source.indexOf("// This is a precondition gate", source.indexOf("function stockJobVisibleToRequest"))), /principalStoreIds/);
});

test("stock queue replay is store-bound and returns a bounded replay summary", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/stock-queue/replay-failed"');
  const end = source.indexOf('app.post("/api/ozon/barcodes/generate"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /STOCK_QUEUE_STORE_REQUIRED/);
  assert.match(route, /storeId,\s*storeIds/);
  assert.match(route, /res\.json\(\{ \.\.\.data, data, summary/);
  assert.doesNotMatch(route, /stocks\.length/);
});

test("stock queue enqueue rejects an unbound durable job", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/stock-queue"');
  const end = source.indexOf('app.post("/api/ozon/stock-queue/replay-failed"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /STOCK_QUEUE_STORE_REQUIRED/);
  assert.match(route, /const storeId = String\(req\.body\?\.storeId/);
  assert.match(route, /storeId,\s*taskId/);
});

test("activity and import readbacks share the signed read session gate", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  for (const routeStart of [
    'app.get("/api/ozon/actions"',
    'app.post("/api/ozon/actions/products"',
    'app.post("/api/ozon/actions/candidates"',
    'app.post("/api/ozon/product-import-info"',
  ]) {
    const start = source.indexOf(routeStart);
    assert.ok(start >= 0, `missing route ${routeStart}`);
    const end = source.indexOf("\n}));", start);
    const route = source.slice(start, end);
    assert.match(route, /requireControlledSellerRead\(req, res/);
    const storeResolution = route.indexOf("getStore(");
    assert.ok(storeResolution < 0 || route.indexOf("requireControlledSellerRead") < storeResolution, `${routeStart} must gate before store resolution`);
  }
});

test("legacy pipeline status POST is read-only and does not reset the snapshot", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/pipeline/status"');
  const end = source.indexOf('app.get("/api/pipeline/status"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /getPipelineStatus\(\)/);
  assert.doesNotMatch(route, /writeFile|pipeline-status\.json|status: "idle"/);
});

test("attribute dictionary cache has its own freshness timestamp instead of reusing tree age", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/description-attributes"');
  const end = source.indexOf('app.post("/api/ozon/category-cache/refresh"', start);
  const route = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(route, /attributeUpdatedAt/);
  assert.match(route, /attributeFreshness\.usable/);
  assert.match(route, /cacheFreshness/);
});

test("category caches cannot reuse evidence from another read environment", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const treeStart = source.indexOf('app.get("/api/ozon/description-categories"');
  const treeEnd = source.indexOf('app.post("/api/ozon/description-attributes"', treeStart);
  const treeRoute = source.slice(treeStart, treeEnd);
  assert.match(treeRoute, /const environmentRefHash = scopeHash\(environment\)/);
  assert.match(treeRoute, /cachedTreeEvidence\?\.environmentRefHash === environmentRefHash/);
  assert.doesNotMatch(treeRoute, /process\.env\.OZON_ERP_ENVIRONMENT/);

  const attributesStart = treeEnd;
  const attributesEnd = source.indexOf('app.post("/api/ozon/category-cache/refresh"', attributesStart);
  const attributesRoute = source.slice(attributesStart, attributesEnd);
  assert.match(attributesRoute, /cachedAttributeEvidence\?\.environmentRefHash === environmentRefHash/);
  assert.doesNotMatch(attributesRoute, /process\.env\.OZON_ERP_ENVIRONMENT/);

  const valuesStart = source.indexOf('app.post("/api/ozon/description-attribute-values"');
  const valuesEnd = source.indexOf('app.get("/api/ozon/orders"', valuesStart);
  const valuesRoute = source.slice(valuesStart, valuesEnd);
  assert.match(valuesRoute, /cachedValueEvidence\?\.environmentRefHash === environmentRefHash/);
  assert.doesNotMatch(valuesRoute, /process\.env\.OZON_ERP_ENVIRONMENT/);
});

test("category cache refresh persists current-store operation evidence", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/category-cache/refresh"');
  const end = source.indexOf('app.post("/api/ozon/category-match"', start);
  const route = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(route, /buildOperationEvidenceRecord/);
  assert.match(route, /categoryReadEvidence/);
  assert.match(route, /environmentRefHash/);
  assert.match(route, /operationEvidence/);
});

test("server exposes a local-only stock reconciliation dry-run route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/ozon\/stock-reconciliation\/dry-run/);
  assert.match(source, /dryRunStockJobReconciliation/);
  assert.match(source, /stockDryRunSellerView/);
  assert.match(source, /validateStockDryRunInput/);
  assert.match(source, /requireWarehouseModeEvidence: true/);
  assert.match(source, /res\.status\(validation\.status\)\.json/);
});

test("stock dry-run route requires an explicit read environment before returning a plan", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/stock-reconciliation/dry-run"');
  const end = source.indexOf('app.post("/api/ozon/stock-reconciliation/evidence"', start);
  const route = source.slice(start, end);
  assert.match(route, /requestReadEnvironment\(req, req\.body \|\| \{\}\)/);
  assert.match(route, /STOCK_DRY_RUN_ENVIRONMENT_REQUIRED/);
  assert.ok(route.indexOf("STOCK_DRY_RUN_ENVIRONMENT_REQUIRED") < route.indexOf("validateStockDryRunInput"));
});

test("stock dry-run route rejects an unbound store before returning a blocked plan", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/stock-reconciliation/dry-run"');
  const end = source.indexOf('app.post("/api/ozon/stock-reconciliation/evidence"', start);
  const route = source.slice(start, end);
  assert.match(route, /const storeId = String\(req\.body\?\.storeId \|\| ""\)\.trim\(\)/);
  assert.match(route, /STOCK_DRY_RUN_STORE_REQUIRED/);
  assert.ok(route.indexOf("STOCK_DRY_RUN_STORE_REQUIRED") < route.indexOf("validateStockDryRunInput"));
  assert.match(route, /storeId,\s*stocks: validation\.value\.targetStocks/);
});

test("stock reconciliation evidence echoes the authenticated read environment", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/stock-reconciliation/evidence"');
  const end = source.indexOf('app.post("/api/ozon/stock-reconciliation/evidence-receipts"', start);
  const route = source.slice(start, end);
  assert.match(route, /const environment = requestReadEnvironment\(req, body\)/);
  assert.match(route, /res\.json\(\{ \.\.\.result, environment \}\)/);
});

test("order dashboard echoes the authenticated read environment", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/order-dashboard"');
  const end = source.indexOf('// Read-only detail lookup', start);
  const route = source.slice(start, end);
  assert.match(route, /const environment = requestReadEnvironment\(req\)/);
  assert.match(route, /res\.json\(\{ \.\.\.\(await readFbsOrderDashboardSnapshot\(req\.query\)\), environment \}\)/);
});

test("promotion read routes echo the authenticated read environment", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/actions"');
  const end = source.indexOf('app.post("/api/ozon/actions/products/deactivate"', start);
  const route = source.slice(start, end);
  assert.match(route, /const environment = requestReadEnvironment/);
  assert.match(route, /storeId: store\.id, environment/);
});

test("server exposes read-only stock reconciliation evidence aggregation without queue or writes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/stock-reconciliation/evidence"');
  const end = source.indexOf('app.post("/api/ozon/stock-queue"', start);
  const route = source.slice(start, end);
  assert.ok(start > 0);
  assert.match(route, /gatherStockReconciliationEvidence/);
  assert.match(route, /observationMode:\s*"server_read"/);
  for (const endpoint of ["/v3/product/list", "/v3/product/info/list", "/v4/product/info/stocks", "/v2/warehouse/list"]) {
    assert.match(source, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(route, /enqueueStockJob|replayFailedStockJobs|directOzonWriteRoute|\/v2\/products\/stocks/);
});

test("server persists stock evidence receipts only from a fresh server-side read aggregation", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/stock-reconciliation/evidence-receipts"');
  const end = source.indexOf('app.post("/api/ozon/stock-queue"', start);
  const routes = source.slice(start, end);
  assert.ok(start > 0);
  assert.match(routes, /gatherStockReconciliationEvidence/);
  assert.match(routes, /observationMode:\s*"server_read"/);
  assert.match(routes, /recordServerObservation/);
  assert.match(routes, /evaluateStockRealReadVerification/);
  assert.match(routes, /recordEvidence !== true/);
  assert.doesNotMatch(routes, /body\.evidence|client_asserted|enqueueStockJob|directOzonWriteRoute|\/v2\/products\/stocks/);
  assert.match(routes, /receiptCount: verification\.persistedCount/);
  assert.match(routes, /未调用 Ozon 写接口、未排队/);
});

test("stock evidence receipt summary exposes bounded freshness", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/stock-reconciliation/evidence-receipts"');
  const end = source.indexOf('\n}));', start) + 5;
  const route = source.slice(start, end);
  assert.match(route, /stockReceiptMaxAgeMs/);
  assert.match(route, /staleCount/);
  assert.match(route, /过期库存回执保留审计/);
  assert.match(route, /STOCK_RECEIPT_ENVIRONMENT_REQUIRED/);
  assert.match(route, /STOCK_RECEIPT_STORE_REQUIRED/);
  assert.match(route, /if \(!storeId\)/);
  assert.match(route, /eligible_server_observed_current_store_and_environment/);
});

test("order dashboard uses the FBS read model and never calls an undefined summarizeOrder", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('async function readFbsOrderDashboardSnapshot');
  const end = source.indexOf('app.get("/api/ozon/products"', start);
  const route = source.slice(start, end);
  assert.match(route, /buildFbsOrderReadModel/);
  assert.match(route, /filterFbsOrderReadModel/);
  assert.match(route, /readFbsProductDetailsInBatches/);
  assert.match(route, /productDetailBatchAttempts/);
  assert.match(route, /\/v4\/posting\/fbs\/list/);
  assert.match(route, /cursor/);
  assert.match(route, /sort_dir/);
  assert.doesNotMatch(route, /offset/);
  assert.doesNotMatch(route, /summarizeOrder/);
  assert.doesNotMatch(route, /financial_data: true/);
  assert.doesNotMatch(route, /offerIds\.slice\(0, 100\)/);
});

test("legacy orders route also uses the current v4 cursor contract", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/orders"');
  const end = source.indexOf('async function readFbsOrderDashboardSnapshot', start);
  const route = source.slice(start, end);
  assert.match(route, /\/v4\/posting\/fbs\/list/);
  assert.match(route, /cursor: String\(req\.query\.cursor/);
  assert.match(route, /sort_dir/);
  assert.doesNotMatch(route, /offset/);
  assert.doesNotMatch(route, /financial_data/);
});

test("FBS order detail is an identity-bound read-only route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/order-dashboard/detail"');
  const end = source.indexOf('app.post("/api/ozon/order-dashboard/evidence-receipts"', start);
  const route = source.slice(start, end);
  assert.ok(start > 0);
  assert.match(route, /FBS_ORDER_POSTING_REQUIRED/);
  assert.match(route, /\/v3\/posting\/fbs\/get/);
  assert.match(route, /expectedPostingIdentity: postingNumber/);
  assert.match(route, /const environment = requestReadEnvironment\(req\)/);
  assert.match(route, /environment,/);
  assert.match(route, /readFbsProductDetailsInBatches/);
  assert.match(route, /posting_identity_mismatch|returnedPostingIdentity/);
  assert.match(route, /未备货、未发运、未取消/);
  assert.doesNotMatch(route, /package-label|ship|cancel|enqueue/);
});

test("order dashboard attaches a conservative finance projection without settlement profit", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function readFbsOrderDashboardSnapshot");
  const end = source.indexOf('app.get("/api/ozon/order-dashboard"', start);
  const route = source.slice(start, end);
  assert.match(route, /buildFinanceDomainReadModel/);
  assert.match(route, /financial_data omitted|financial_data in this read path/);
  assert.match(route, /financeReadModel/);
  assert.match(route, /partial: filtered\.partial/);
  assert.match(route, /paginationComplete:/);
  assert.match(route, /checkedAt: filtered\.checkedAt/);
  assert.match(route, /result\?\.cursor === "string"/);
});

test("server exposes a read-only single auto-listing product readiness route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/ozon-learning\/auto-list-jobs\/:id\/product-readiness/);
  assert.match(source, /inspectAutoListingProductReadiness/);
  assert.match(source, /getAutoListingJobSnapshot/);
  assert.match(source, /verificationLevel: "locally_tested"/);
  assert.match(source, /liveReadObserved:/);
  assert.match(source, /const boundedOfferIds = offerIds\.slice\(0, 100\)/);
  assert.match(source, /requestedOfferCount: boundedOfferIds\.length/);
  assert.match(source, /endpointAttempts/);
  assert.match(source, /result\.evidenceSummary\?\.readStatus === "completed"/);
  const routeStart = source.indexOf('app.get("/api/ozon-learning/auto-list-jobs/:id/product-readiness"');
  const route = source.slice(routeStart, source.indexOf("// Local-only operator gate", routeStart));
  assert.match(route, /READ_OPERATOR_ENVIRONMENT_REQUIRED/);
  assert.match(route, /READ_OPERATOR_ENVIRONMENT_INVALID/);
  assert.doesNotMatch(route, /process\.env\.OZON_ERP_ENVIRONMENT|process\.env\.NODE_ENV/);
  assert.match(route, /controlledReadSessionBlock\(req, environment\)/);
  assert.match(route, /未解析店铺凭据、未联网、未读取 Ozon/);
  assert.match(route, /storeId: String\(job\.listingResult\?\.storeId \|\| job\.storeId \|\| ""\)\.trim\(\)/);
  assert.match(route, /environment,/);
  assert.match(route, /environmentRefHash: scopeHash\(environment\)/);
});

test("product readiness route preserves partial endpoint evidence", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function readAutoListingProductStatus");
  const end = source.indexOf('app.get("/api/ozon-learning/auto-list-jobs/:id/product-readiness"', start);
  const helper = source.slice(start, end);
  assert.match(helper, /endpointFailures/);
  assert.match(helper, /if \(!listResponse && !detailResponse\)/);
  assert.match(helper, /operationEvidence/);
  assert.match(source, /coverageComplete/);
});

test("product dashboard does not turn empty or malformed pages into an empty-shop claim", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/product-dashboard"');
  const end = source.indexOf('app.get("/api/ozon/product-prices"', start);
  const route = source.slice(start, end);
  assert.match(route, /listResponseRecognized/);
  assert.match(route, /detailResponseRecognized/);
  assert.match(route, /readStatus = !listResponseRecognized\s*\? "unknown"/);
  assert.match(route, /missingEvidence\.push\("pagination"\)/);
  assert.match(route, /nextCursor/);
  assert.match(route, /listHasNext = Boolean\(listContainer\?\.has_next.*nextCursor/);
  assert.match(route, /当前读取页没有商品；请结合筛选条件和分页结果判断，不代表全店没有商品/);
  assert.match(route, /listContainer\?\.items/);
  assert.match(route, /detailContainer\?\.items/);
});

test("1688 capture promotion keeps source, procurement, and media evidence gaps visible", async () => {
  const source = await readFile(new URL("../src/crawler1688.js", import.meta.url), "utf8");
  assert.match(source, /缺少来源快照证据/);
  assert.match(source, /缺少供应商 MOQ 或数量绑定阶梯价/);
  assert.match(source, /存在未人工确认的图片候选/);
  assert.match(source, /humanApproved !== true/);
});

test("1688 capture routes apply principal store scope to persisted captures", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/1688/captures"');
  const end = source.indexOf('app.post("/api/1688-crawler/tasks"', start);
  const routes = source.slice(start, end);
  assert.match(routes, /listCollectionItems\(\{ storeId:/);
  assert.match(routes, /storeIds: .*authPrincipal\?\.storeIds/);
  assert.match(routes, /getCollectionItem\(req\.params\.id, \{ storeId:/);
  assert.match(routes, /const patch = \{\};[\s\S]*updateCollectionItem\(req\.params\.id, patch, \{ storeId:/);
  assert.match(routes, /captureReview and parsed\/source evidence are intentionally not patchable/);
  assert.match(routes, /deleteCollectionItem\(req\.params\.id, \{ storeId:/);
  assert.match(routes, /moveCaptureToCrawlerCandidate\(req\.params\.id, \{ storeId:/);
  assert.match(source, /CAPTURE_STORE_REQUIRED/);
  assert.match(source, /CAPTURE_STORE_SCOPE_NOT_FOUND/);
  assert.match(source, /latest1688Capture\.storeId/);
});

test("1688 candidate can enter a local listing draft without Ozon side effects", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /createListingDraftFrom1688Candidate/);
  const start = source.indexOf('app.post("/api/1688-crawler/candidates/:id/create-listing-draft"');
  const end = source.indexOf('app.patch("/api/1688-crawler/candidates/:id"', start);
  const route = source.slice(start, end);
  assert.match(route, /storeId/);
  assert.match(route, /storeIds: req\.authPrincipal\?\.storeIds/);
  assert.match(route, /未调用 Ozon/);
  assert.doesNotMatch(route, /ozonRequest|completeListing|directOzonWriteRoute/);
  const autoListing = await readFile(new URL("../src/autoListing.js", import.meta.url), "utf8");
  const startAuto = autoListing.indexOf("export async function createListingDraftFrom1688Candidate");
  const endAuto = autoListing.indexOf("export async function saveManualListingContent", startAuto);
  const handler = autoListing.slice(startAuto, endAuto);
  assert.match(handler, /sourceEvidence/);
  assert.match(handler, /candidateData:\s*\{[\s\S]*parseIssues:[\s\S]*sourceEvidence:/);
  assert.match(handler, /job\.candidateData\?\.url \|\| \"\"\) === sourceUrl/);
  assert.match(handler, /sameStore/);
  assert.match(handler, /jobStoreId === effectiveStoreId/);
  assert.match(handler, /sourceVariantIds/);
  assert.match(handler, /variant\?\.source_sku_id/);
  assert.match(handler, /variant\?\.sku_id/);
  assert.match(handler, /snapshotHash/);
  assert.match(handler, /verificationState/);
  assert.match(handler, /buildCandidateMediaEvidenceSummary/);
  assert.match(handler, /mediaEvidence/);
  assert.match(handler, /build1688SourceEvidenceContract/);
  assert.match(handler, /sourceEvidenceReview/);
});

test("saving manual listing content invalidates the old preflight through a refreshed local payload", async () => {
  const source = await readFile(new URL("../src/autoListing.js", import.meta.url), "utf8");
  const start = source.indexOf("export async function saveManualListingContent");
  const end = source.indexOf("export function findCachedManualCategory", start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /saveWorkflowPayloadDraftForListingJob/);
  assert.match(handler, /saveWorkflowPayloadDraftForListingJob/);
  assert.match(handler, /重新运行商品预检|运行预检/);
});

test("1688 candidate routes apply principal store scope", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/1688-crawler/candidates"');
  const end = source.indexOf('app.post("/api/ozon-learning/auto-list-jobs', start);
  const routes = source.slice(start, end);
  assert.match(routes, /listCrawlerCandidates\(\{[\s\S]*storeId:/);
  assert.match(routes, /storeIds: req\.authPrincipal\?\.storeIds/);
  assert.match(routes, /const patch = \{\};[\s\S]*updateCrawlerCandidate\(req\.params\.id, patch, \{ storeId:/);
  assert.match(routes, /delete patch\.captureReview/);
  assert.match(routes, /moveCrawlerCandidateToCapture\(req\.params\.id, req\.body\?\.storeId \|\| req\.query\.storeId \|\| "", \{ storeIds:/);
  const autoListing = await readFile(new URL("../src/autoListing.js", import.meta.url), "utf8");
  assert.match(autoListing, /listCrawlerCandidates\(\{ storeId, storeIds \}\)/);
});

test("1688 crawler task routes apply principal store scope", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/1688-crawler/tasks"');
  const end = source.indexOf('app.get("/api/1688-crawler/candidates"', start);
  const routes = source.slice(start, end);
  assert.match(routes, /CRAWLER_TASK_STORE_REQUIRED/);
  assert.match(routes, /listCrawlerTasks\(\{ storeId:/);
  assert.match(routes, /getCrawlerTask\(req\.params\.id, \{ storeId:/);
  assert.match(routes, /updateCrawlerTaskStatus\(req\.params\.id, "paused", \{ storeId:/);
  assert.match(routes, /deleteCrawlerTask\(req\.params\.id, \{ storeId:/);
});

test("extension worker claim and result routes carry the persisted job store scope", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const heartbeatStart = source.indexOf('app.post("/api/1688-crawler/extension/heartbeat"');
  const heartbeatEnd = source.indexOf('app.post("/api/1688-crawler/session/cookie"', heartbeatStart);
  const heartbeat = source.slice(heartbeatStart, heartbeatEnd);
  assert.match(heartbeat, /principalId: String\(req\.authPrincipal\?\.principalId \|\| ""\)/);
  assert.match(heartbeat, /principalStoreIds: req\.authPrincipal\?\.storeIds/);
  assert.match(heartbeat, /principalRole: String\(req\.authPrincipal\?\.role \|\| ""\)/);
  const statusStart = source.indexOf('app.get("/api/1688-crawler/extension/status"');
  const statusEnd = source.indexOf('app.post("/api/1688-crawler/extension/heartbeat"', statusStart);
  const status = source.slice(statusStart, statusEnd);
  assert.match(status, /getCrawlerWorkerStatus\(\{[\s\S]*principalId: String\(req\.authPrincipal\?\.principalId \|\| ""\)/);
  const crawlerStart = source.indexOf('app.get("/api/1688-crawler/extension/next"');
  const crawlerEnd = source.indexOf('app.post("/api/1688-crawler/expand-keywords"', crawlerStart);
  const crawlerRoutes = source.slice(crawlerStart, crawlerEnd);
  assert.match(crawlerRoutes, /claimCrawlerExtensionJob\(String\(req\.query\.workerId \|\| ""\), \{/);
  assert.match(crawlerRoutes, /storeId: String\(req\.query\.storeId \|\| ""\)/);
  assert.match(crawlerRoutes, /storeIds: req\.authPrincipal\?\.storeIds/);
  assert.match(crawlerRoutes, /completeCrawlerExtensionDiscover\(req\.body\.jobId, req\.body \|\| \{\}, \{/);
  assert.match(crawlerRoutes, /completeCrawlerExtensionDetail\(req\.body\.jobId, \{[\s\S]*storeIds: req\.authPrincipal\?\.storeIds/);
  assert.match(crawlerRoutes, /data\.scopeDenied/);

  const learningStart = source.indexOf('app.get("/api/ozon-learning/extension/next"');
  const learningEnd = source.indexOf('app.post("/api/pipeline/run"', learningStart);
  const learningRoutes = source.slice(learningStart, learningEnd);
  assert.match(learningRoutes, /claimOzonLearningJob\(String\(req\.query\.workerId \|\| ""\), \{/);
  assert.match(learningRoutes, /completeOzonSearchJob\(req\.body\.jobId, req\.body \|\| \{\}, \{/);
  assert.match(learningRoutes, /completeOzonDetailJob\(req\.body\.jobId, req\.body \|\| \{\}, \{/);
  assert.match(learningRoutes, /data\.scopeDenied/);
});

test("manual listing content route saves local seller input without AI or Ozon calls", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/ozon-learning\/auto-list-jobs\/:id\/manual-content/);
  assert.match(source, /saveManualListingContent/);
  const start = source.indexOf('app.post("/api/ozon-learning/auto-list-jobs/:id/manual-content"');
  const end = source.indexOf('async function readAutoListingProductStatus', start);
  const route = source.slice(start, end);
  assert.match(route, /未调用 AI/);
  assert.doesNotMatch(route, /generateListingContentWithLlm|ozonRequest|completeListing/);
});

test("manual listing category route persists a seller-confirmed category without Ozon writes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/ozon-learning\/auto-list-jobs\/:id\/manual-category/);
  assert.match(source, /saveManualListingCategory/);
  const start = source.indexOf('app.post("/api/ozon-learning/auto-list-jobs/:id/manual-category"');
  const end = source.indexOf('async function readAutoListingProductStatus', start);
  const route = source.slice(start, end);
  assert.match(route, /保存卖家确认的本地类目/);
  assert.doesNotMatch(route, /ozonRequest|completeListing|directOzonWriteRoute/);
  const autoListing = await readFile(new URL("../src/autoListing.js", import.meta.url), "utf8");
  const startAuto = autoListing.indexOf("export async function saveManualListingCategory");
  const endAuto = autoListing.indexOf("export async function saveManualProcurementEvidence", startAuto);
  const handler = autoListing.slice(startAuto, endAuto);
  assert.match(handler, /saveWorkflowPayloadDraftForListingJob/);
  assert.match(handler, /payloadDraftReady/);
  const draftStart = autoListing.indexOf("async function saveWorkflowPayloadDraftForListingJob");
  const draftEnd = autoListing.indexOf("async function waitForImportInfo", draftStart);
  const draftHelper = autoListing.slice(draftStart, draftEnd);
  assert.match(draftHelper, /savedCategoryIdsValid/);
  assert.match(draftHelper, /savedCategory/);
});

test("1688 saved draft policy persists the product identity gate for later revalidation", async () => {
  const autoListing = await readFile(new URL("../src/autoListing.js", import.meta.url), "utf8");
  const start = autoListing.indexOf("async function saveWorkflowPayloadDraftForListingJob");
  const end = autoListing.indexOf("async function waitForImportInfo", start);
  assert.ok(start >= 0 && end > start);
  const helper = autoListing.slice(start, end);
  assert.match(helper, /sourceEvidenceRequired:\s*sourceIs1688/);
  assert.match(helper, /sourceIdentityRequired:\s*sourceIs1688/);
  assert.match(helper, /sourceVariantBindingRequired:\s*sourceIs1688/);
});

test("manual procurement route keeps seller evidence distinct from official Ozon pricing", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/ozon-learning\/auto-list-jobs\/:id\/manual-procurement/);
  assert.match(source, /saveManualProcurementEvidence/);
  const start = source.indexOf('app.post("/api/ozon-learning/auto-list-jobs/:id/manual-procurement"');
  const end = source.indexOf('async function readAutoListingProductStatus', start);
  const route = source.slice(start, end);
  assert.match(route, /手填数据标成官方实时费率/);
  assert.doesNotMatch(route, /ozonRequest|completeListing|directOzonWriteRoute/);
  const autoListing = await readFile(new URL("../src/autoListing.js", import.meta.url), "utf8");
  const startAuto = autoListing.indexOf("export async function saveManualProcurementEvidence");
  const endAuto = autoListing.indexOf("export async function saveManualPackageEvidence", startAuto);
  const handler = autoListing.slice(startAuto, endAuto);
  assert.match(handler, /saveWorkflowPayloadDraftForListingJob/);
  assert.match(handler, /payloadDraftReady/);
  assert.doesNotMatch(handler, /ozonRequest\(/);
});

test("manual package route keeps measured dimensions local and blocks Ozon writes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/ozon-learning\/auto-list-jobs\/:id\/manual-package/);
  assert.match(source, /saveManualPackageEvidence/);
  const start = source.indexOf('app.post("/api/ozon-learning/auto-list-jobs/:id/manual-package"');
  const end = source.indexOf('async function readAutoListingProductStatus', start);
  const route = source.slice(start, end);
  assert.match(route, /人工实测或供应商包装资料/);
  assert.doesNotMatch(route, /ozonRequest|completeListing|directOzonWriteRoute/);
  const autoListing = await readFile(new URL("../src/autoListing.js", import.meta.url), "utf8");
  const startAuto = autoListing.indexOf("export async function saveManualPackageEvidence");
  const endAuto = autoListing.indexOf("async function addStep", startAuto);
  const handler = autoListing.slice(startAuto, endAuto);
  assert.match(handler, /saveWorkflowPayloadDraftForListingJob/);
  assert.match(handler, /payloadDraftReady/);
  assert.doesNotMatch(handler, /ozonRequest\(/);
});

test("media review request only enters waiting-human mode and does not approve or submit", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/workflows\/:id\/request-media-review/);
  assert.match(source, /requestWorkflowMediaReview/);
  const start = source.indexOf('app.post("/api/workflows/:id/request-media-review"');
  const end = source.indexOf('app.post("/api/workflows/:id/resume"', start);
  const route = source.slice(start, end);
  assert.match(route, /等待人工媒体审查/);
  assert.doesNotMatch(route, /approveWorkflowMediaCandidates|publishWorkflowMediaApproval|completeListing|ozonRequest/);
});

test("published media approval can only request a local preflight recheck", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/workflows\/:id\/request-preflight-recheck/);
  const start = source.indexOf('app.post("/api/workflows/:id/request-preflight-recheck"');
  const end = source.indexOf('app.post("/api/workflows/:id/payload-draft/submit"', start);
  const route = source.slice(start, end);
  assert.match(route, /published_local/);
  assert.match(route, /validatePayloadDraft/);
  assert.match(route, /未上传媒体、未调用 Ozon、未提交商品/);
  assert.doesNotMatch(route, /ozonRequest/);
});

test("server persists FBS evidence only after a fresh server-side read", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/order-dashboard/evidence-receipts"');
  const end = source.indexOf('app.get("/api/ozon/products"', start);
  const route = source.slice(start, end);
  assert.match(route, /\/api\/ozon\/order-dashboard\/evidence-receipts/);
  assert.match(route, /requireControlledSellerRead\(req, res, body\)/);
  assert.match(route, /const environment = requestReadEnvironment\(req, body\)/);
  assert.match(route, /FBS_RECEIPT_STORE_REQUIRED/);
  assert.match(route, /readFbsOrderDashboardSnapshot\(query\)/);
  assert.match(source, /FbsEvidenceReceiptRepository/);
  assert.match(route, /recordServerObservation\(\{ recordEvidence: true, model, environment \}\)/);
  assert.match(route, /服务端重新读取当前 FBS 批次并保存脱敏只读回执/);
  assert.doesNotMatch(route, /model:\s*body\.model/);
  assert.match(source, /app\.get\("\/api\/ozon\/order-dashboard\/evidence-receipts"/);
  assert.match(source, /missingEvidenceCount/);
  assert.doesNotMatch(route, /order_number|posting_number|offer_id/);
});

test("FBS receipt reads enforce principal/deployment store scope", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/order-dashboard/evidence-receipts"');
  const end = source.indexOf('app.get("/api/ozon/products"', start);
  const route = source.slice(start, end);
  assert.match(route, /FBS_RECEIPT_ENVIRONMENT_REQUIRED/);
  assert.match(route, /FBS_RECEIPT_STORE_REQUIRED/);
  assert.match(route, /environment\.length < 3/);
  assert.match(route, /if \(!storeId\)/);
  assert.match(route, /receiptStoreScopeDecision\(req, storeRef\)/);
  assert.match(route, /if \(!scopeDecision\.allowed\)/);
  assert.match(route, /scopeDecision\.hashes\.has\(receipt\.storeRef\)/);
  assert.match(route, /candidateLatest && \(!scopeDecision\.hashes\.size \|\| scopeDecision\.hashes\.has\(candidateLatest\.storeRef\)\)/);
  assert.match(route, /buildFbsReceiptSellerView/);
  assert.match(route, /verificationLevel/);
});

test("server records readiness evidence only through an explicit local receipt action", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/ozon-learning\/readiness-evidence-receipts/);
  assert.match(source, /ReadinessEvidenceReceiptRepository/);
  assert.match(source, /recordEvidence/);
  assert.match(source, /evaluateRealReadVerification/);
  assert.match(source, /recordServerObservation/);
  assert.match(source, /latestReceipt/);
  assert.match(source, /countScope: "eligible_server_observed_current_environment"/);
  assert.match(source, /readAutoListingProductStatus/);
  assert.doesNotMatch(source, /inspection:\s*body\.inspection/);
  assert.match(source, /执行一次受限 Ozon 只读回查并保存脱敏本地回执；未调用 Ozon 写接口、未修改商品状态/);
  assert.doesNotMatch(source, /仅保存脱敏本地证据回执；未调用 Ozon、未修改商品状态/);
  const getStart = source.indexOf('app.get("/api/ozon-learning/readiness-evidence-receipts"');
  const getEnd = source.indexOf("\n}));", getStart) + 5;
  const getRoute = source.slice(getStart, getEnd);
  assert.match(getRoute, /const verification = evaluateRealReadVerification/);
  assert.match(getRoute, /receiptCount: verification\.persistedCount/);
  assert.match(getRoute, /countScope: "eligible_server_observed_current_environment"/);
  assert.match(getRoute, /readinessReceiptMaxAgeMs/);
  assert.match(getRoute, /staleCount/);
  assert.match(getRoute, /maxAgeMs/);
  assert.match(getRoute, /storeRef: String\(latest\.storeRef/);
  assert.match(getRoute, /environmentRef: String\(latest\.environmentRef/);
  assert.match(getRoute, /storeId/);
  assert.match(getRoute, /environment\.length < 3/);
  assert.match(getRoute, /READINESS_EVIDENCE_ENVIRONMENT_REQUIRED/);
  assert.match(getRoute, /READINESS_EVIDENCE_STORE_REQUIRED/);
  assert.match(getRoute, /storeRef === verification\.storeRef/);
  assert.match(getRoute, /checkedAt: latest\.checkedAt/);
  assert.match(getRoute, /endpointAttempts: Array\.isArray\(latest\.endpointAttempts/);
  assert.match(getRoute, /failureScenario: String\(latest\.failureScenario/);
  assert.match(getRoute, /failureEvidence: Array\.isArray\(latest\.failureEvidence/);
  assert.match(getRoute, /operationEvidence: Array\.isArray\(latest\.operationEvidence/);
  assert.match(getRoute, /responseHash: String\(latest\.responseHash/);
  assert.doesNotMatch(getRoute, /rawResponse|apiKey|offerId|productId/);
  assert.doesNotMatch(getRoute, /receiptCount: receipts\.length/);
});

test("server exposes a local readiness operator plan gate before receipt persistence", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon-learning/readiness-evidence-receipts/plan"');
  const end = source.indexOf('app.post("/api/ozon/read-operator/category-plan"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /buildReadOperatorPlanSummary/);
  assert.match(route, /status\(summary\.ok \? 200 : 400\)/);
  assert.match(route, /sideEffect: summary\.sideEffect/);
  assert.doesNotMatch(route, /ozonRequest|recordServerObservation|writeFile|readAutoListingProductStatus/);
  assert.match(source, /import \{ buildReadOperatorPlanSummary \} from "\.\/readVerificationOperator\.js"/);
});

test("server exposes a hash-only four-store controlled-read matrix without network execution", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/read-operator/matrix"');
  const end = source.indexOf('app.post("/api/auth/session"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /buildReadOperatorPlanMatrixSummary/);
  assert.match(route, /expectedPrimaryStoreCount: 4/);
  assert.match(route, /environmentRefHash/);
  assert.match(route, /execution: "not_started"/);
  assert.match(route, /不会联网或写入 Ozon/);
  assert.match(route, /readOperatorReceipts\.list/);
});

test("controlled-read matrix uses canonical API evidence and scopes persisted receipts", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/read-operator/matrix"');
  const end = source.indexOf('app.post("/api/auth/session"', start);
  const route = source.slice(start, end);
  assert.match(source, /DEFAULT_API_FILE/);
  assert.match(route, /loadStores\(canonicalApiPath\)/);
  assert.match(route, /buildApiEvidenceSummary/);
  assert.match(route, /READ_OPERATOR_SELLER_API_DOCUMENT_STALE/);
  assert.match(route, /scopedReceiptHashes/);
  assert.match(route, /scopedReceiptHashes\.has\(String\(receipt\.storeRefHash/);
  assert.match(route, /evidenceGate/);
});

test("controlled-read matrix fresh plans exclude deprecated FBS v3 endpoints", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/read-operator/matrix"');
  const end = source.indexOf('app.post("/api/auth/session"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.doesNotMatch(source, /import \{ CURRENT_READ_ENDPOINTS/);
  assert.match(route, /defaultOperatorEndpoints/);
  assert.match(route, /"\/v3\/product\/list", "\/v2\/warehouse\/list"/);
  assert.match(route, /endpointScopeErrors/);
  assert.doesNotMatch(route, /endpoints: \[\.\.\.READ_ENDPOINTS\]/);
});

test("server exposes a server-observed general read operator without client receipt injection", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/read-operator/execute"');
  const end = source.indexOf('app.get("/api/ozon/read-operator/receipts"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /validateReadOperatorPlan/);
  assert.match(route, /validateReadOperatorPlanBinding/);
  assert.match(route, /runReadVerification/);
  assert.match(route, /readOperatorReceipts\.record/);
  assert.match(route, /persistFailure/);
  assert.match(route, /sellerTask:\s*buildReadFailureSellerTask\(recorded\.receipt\)/);
  assert.match(route, /store_resolution_failed/);
  assert.match(route, /result\.reasonCode/);
  assert.match(route, /LIVE_CONFIRMATION/);
  assert.match(route, /未调用写接口/);
  assert.doesNotMatch(route, /body\.receipt/);
  assert.doesNotMatch(route, /body\.response/);
  assert.match(source, /ReadOperatorReceiptRepository/);
});

test("controlled read execute gates confirmation and plan binding before resolving a store or running a reader", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/read-operator/execute"');
  const end = source.indexOf('app.get("/api/ozon/read-operator/receipts"', start);
  const route = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(route.indexOf('body.recordEvidence !== true') < route.indexOf("getStore(plannedStoreId)"));
  assert.ok(route.indexOf("validateReadOperatorPlanBinding") < route.indexOf("getStore(plannedStoreId)"));
  assert.ok(route.indexOf('String(body.confirm || "") !== LIVE_CONFIRMATION') < route.indexOf("getStore(plannedStoreId)"));
  assert.ok(route.indexOf("getStore(plannedStoreId)") < route.indexOf("runReadVerification"));
  assert.doesNotMatch(route, /body\.receipt|body\.response/);
});

test("controlled read execution rejects static bootstrap secrets and binds session environment", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/read-operator/execute"');
  const end = source.indexOf('app.get("/api/ozon/read-operator/receipts"', start);
  const route = source.slice(start, end);
  assert.match(source, /req\.authSource = decision\.authSource/);
  assert.match(route, /controlledReadSessionBlock/);
  assert.match(source, /静态认证密钥只能用于建立会话/);
  assert.match(source, /sessionEnvironment/);
  assert.match(source, /READ_OPERATOR_SESSION_ENVIRONMENT_REQUIRED/);
  assert.match(source, /READ_OPERATOR_ENVIRONMENT_SCOPE_DENIED/);
  assert.match(source, /function controlledReadSessionBlock/);
  assert.match(source, /if \(!\["session_cookie", "session_bearer"\]\.includes\(authSource\)\)/);
  assert.match(source, /本地回环或静态认证密钥只能用于建立会话/);
  const categoryStart = source.indexOf('app.post("/api/ozon/read-operator/category-execute"');
  const categoryEnd = source.indexOf('app.post("/api/ozon/read-operator/execute"', categoryStart);
  const categoryRoute = source.slice(categoryStart, categoryEnd);
  assert.match(categoryRoute, /controlledReadSessionBlock/);
  assert.ok(route.indexOf("controlledReadSessionBlock") < route.indexOf("getStore(plannedStoreId)"));
});

test("controlled read receipts retain a non-secret signed-session binding", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/read-operator/execute"');
  const end = source.indexOf('app.get("/api/ozon/read-operator/receipts"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /signedSessionReceiptBinding/);
  assert.match(route, /signedSessionBound:\s*true/);
  assert.match(route, /authSource:\s*String\(req\.authSource/);
  assert.match(route, /sessionRefHash:\s*scopeHash\(/);
  assert.match(route, /parseStoreScope\(req\.authPrincipal\?\.storeIds/);
  assert.match(route, /readOperatorReceipts\.record\(plan, \{ \.\.\.result, \.\.\.signedSessionReceiptBinding \}\)/);
  assert.doesNotMatch(route, /req\.headers\.(authorization|cookie)/i);
});

test("controlled read execution uses endpoint-specific request contracts and bounded product fan-out", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon/read-operator/execute"');
  const end = source.indexOf('app.get("/api/ozon/read-operator/receipts"', start);
  const route = source.slice(start, end);
  assert.match(route, /buildReadEndpointRequest\(endpoint/);
  assert.match(route, /extractBoundedProductIdentifiers\(response\)/);
  assert.match(route, /orderReadEndpoints\(planValidation\.endpoints\)/);
  assert.match(route, /requestContract\.body/);
  assert.match(route, /status: "blocked"/);
  assert.doesNotMatch(route, /body: \{ limit: scope\.offerCount \|\| 100, offset: 0 \}/);
});

test("read operator receipt lookup is scoped and returns seller recovery guidance", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/read-operator/receipts"');
  const end = source.indexOf('app.post("/api/ozon-learning/readiness-evidence-receipts"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /storeRefHash/);
  assert.match(route, /READ_OPERATOR_ENVIRONMENT_REQUIRED/);
  assert.match(route, /environment\.length < 3/);
  assert.match(route, /READ_OPERATOR_STORE_SCOPE_INVALID/);
  assert.match(route, /sellerTask:/);
  assert.match(route, /current_environment_and_store/);
});

test("read operator receipt lookup exposes freshness and maps stale receipts to a reread task", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/ozon/read-operator/receipts"');
  const end = source.indexOf('app.post("/api/ozon-learning/readiness-evidence-receipts"', start);
  const route = source.slice(start, end);
  assert.match(route, /maxAgeMs/);
  assert.match(route, /stale/);
  assert.match(route, /READ_EVIDENCE_STALE/);
  assert.match(route, /不要把过期回执当作当前状态/);
});

test("server exposes parameterized category read plan and evidence execution", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const planStart = source.indexOf('app.post("/api/ozon/read-operator/category-plan"');
  const executeStart = source.indexOf('app.post("/api/ozon/read-operator/category-execute"');
  const generalStart = source.indexOf('app.post("/api/ozon/read-operator/execute"');
  assert.ok(planStart >= 0 && executeStart > planStart && generalStart > executeStart);
  const route = source.slice(executeStart, generalStart);
  assert.match(route, /validateCategoryReadPlan/);
  assert.match(route, /validateCategoryReadPlanBinding/);
  assert.match(route, /buildCategoryReadRequests/);
  assert.match(route, /descriptionCategoryId/);
  assert.match(route, /attributeId/);
  assert.match(route, /categoryReadEvidence/);
  assert.match(route, /readOperatorReceipts\.record/);
  assert.match(route, /categoryReceiptPlan/);
  assert.match(route, /endpoints: requests\.map\(\(request\) => request\.endpoint\)/);
  assert.match(route, /storeRef: scopeHash\(validation\.storeId\)/);
  assert.match(route, /categorySessionReceiptBinding/);
  assert.match(route, /CATEGORY_READ_EVIDENCE_PARTIAL/);
  assert.match(route, /sellerTask:/);
  assert.match(route, /receipt: categoryReceipt\.receipt/);
  assert.match(route, /未调用写接口/);
  assert.doesNotMatch(route, /body\.receipt|body\.response/);
});

test("readiness receipt response exposes a seller task projection for read failures", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const routeStart = source.indexOf('app.get("/api/ozon-learning/readiness-evidence-receipts"');
  const routeEnd = source.indexOf('app.post("/api/ozon-learning/reconcile-submitted"', routeStart);
  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /sellerTask:\s*buildReadFailureSellerTask\(latest\)/);
});

test("submitted reconciliation accepts a scoped job/task readback", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon-learning/reconcile-submitted"');
  const end = source.indexOf('app.post("/api/ozon-learning/backfill-timeout-stages"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /jobId:\s*String\(req\.body\?\.jobId/);
  assert.match(route, /taskId:\s*Number\(req\.body\?\.taskId/);
  assert.match(route, /controlledReadSessionBlock\(req, environment\)/);
  assert.match(route, /readProductStatus:\s*readAutoListingProductStatus/);
  assert.match(route, /environment,/);
  assert.match(route, /storeId:\s*persistedStoreId/);
  assert.ok(route.indexOf("controlledReadSessionBlock") < route.indexOf("readProductStatus:"));
});

test("background reconciliation never performs an unscoped Seller read", async () => {
  const source = await readFile(new URL("../src/flowSupervisor.js", import.meta.url), "utf8");
  const start = source.indexOf("export async function autoHealFlow");
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end > start ? end : start + 3000);
  assert.match(body, /CONTROLLED_RECONCILIATION_REQUIRED/);
  assert.match(body, /后台自愈未读取 Ozon 商品状态/);
  assert.doesNotMatch(body, /reconcileSubmittedJobs\(/);
});

test("readiness evidence live-read route binds the job to the authenticated store scope", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/ozon-learning/readiness-evidence-receipts"');
  const end = source.indexOf('app.get("/api/ozon-learning/readiness-evidence-receipts"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /controlledReadSessionBlock\(req, environment\)/);
  assert.match(route, /READINESS_EVIDENCE_ENVIRONMENT_MISMATCH/);
  assert.match(route, /getScopedAutoListingJob\(jobId, req\)/);
  assert.match(route, /jobStoreId/);
  assert.match(route, /const storeId = jobStoreId/);
  assert.ok(route.indexOf("const storeId = jobStoreId") > route.indexOf("recorded"), "readiness verification must use the persisted job store binding");
  assert.match(source, /function autoListingJobVisibleToRequest/);
  assert.match(source, /principalReceiptStoreRefHashes/);
});

test("readiness and read-operator receipt lookups apply principal receipt store scope", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const operatorStart = source.indexOf('app.get("/api/ozon/read-operator/receipts"');
  const readinessStart = source.indexOf('app.get("/api/ozon-learning/readiness-evidence-receipts"');
  assert.ok(operatorStart >= 0 && readinessStart > operatorStart);
  const operatorRoute = source.slice(operatorStart, readinessStart);
  const readinessRoute = source.slice(readinessStart, source.indexOf('app.post("/api/ozon-learning/reconcile-submitted"', readinessStart));
  assert.match(operatorRoute, /receiptStoreScopeDecision\(req, storeRefHash\)/);
  assert.match(operatorRoute, /READ_OPERATOR_STORE_SCOPE_REQUIRED/);
  assert.match(operatorRoute, /countScope = "current_environment_and_store"/);
  assert.match(operatorRoute, /storeScope\.hashes\.has\(receipt\.storeRefHash\)/);
  assert.match(readinessRoute, /receiptStoreScopeDecision\(req, requestedStoreRefHash\)/);
  assert.match(readinessRoute, /storeScope\.hashes\.has/);
  assert.match(source, /function storeRefHashesForIds/);
  assert.match(source, /const deploymentHashes = storeRefHashesForIds/);
});

test("server exposes a local-only media candidate approval draft route", async () => {
  const [source, workflowSource] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/workflowRuns.js", import.meta.url), "utf8"),
  ]);

  assert.match(source, /\/api\/workflows\/:id\/media-approval-draft/);
  assert.match(source, /approveWorkflowMediaCandidates/);
  assert.match(source, /saveAutoListingMediaApprovalDraft/);
  assert.match(workflowSource, /workflowSummary/);
  const approvalStart = workflowSource.indexOf("export async function approveWorkflowMediaCandidates");
  const approvalEnd = workflowSource.indexOf("\nfunction canonicalJson", approvalStart);
  const approval = workflowSource.slice(approvalStart, approvalEnd);
  assert.doesNotMatch(approval, /run:\s*updated/);
});

test("server exposes an explicit local media approval publish route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/:id\/media-approval-draft\/publish/);
  assert.match(source, /publishWorkflowMediaApproval/);
  assert.match(source, /publishAutoListingMediaApproval/);
  assert.match(source, /rollbackAutoListingMediaApproval/);
  assert.match(source, /rollbackCandidateData/);
  const publishStart = source.indexOf('app.post("/api/workflows/:id/media-approval-draft/publish"');
  const publishEnd = source.indexOf('app.post("/api/workflows/:id/request-preflight-recheck"', publishStart);
  assert.match(source.slice(publishStart, publishEnd), /rollbackCandidateData/);
  const ordersStart = source.indexOf('app.get("/api/ozon/orders"');
  const ordersEnd = source.indexOf("async function readFbsOrderDashboardSnapshot", ordersStart);
  assert.doesNotMatch(source.slice(ordersStart, ordersEnd), /rollbackCandidateData|jobId/);
});

test("pipeline run refuses concurrent runs and unconfirmed local auto-list verification", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/pipeline/run"');
  const end = source.indexOf('app.post("/api/pipeline/status"', start);
  const route = source.slice(start, end);
  assert.match(route, /PIPELINE_ALREADY_RUNNING/);
  assert.match(route, /PIPELINE_AUTOLIST_CONFIRMATION_REQUIRED/);
  assert.match(route, /body\.confirmAutoList !== true/);
  assert.match(route, /runFullPipeline\(\{[\s\S]*autoList,/);
});

test("legacy auto-list trigger requires explicit confirmation and store binding", async () => {
  const [source, autoListing] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/autoListing.js", import.meta.url), "utf8"),
  ]);
  const start = source.indexOf('app.post("/api/ozon-learning/auto-list"');
  const end = source.indexOf('app.get("/api/ozon-learning/auto-list-jobs"', start);
  const route = source.slice(start, end);
  assert.match(route, /AUTO_LIST_CONFIRMATION_REQUIRED/);
  assert.match(route, /AUTO_LIST_STORE_REQUIRED/);
  assert.match(route, /confirmAutoList !== true/);
  assert.match(route, /triggerAutoListing\(body\.itemId, storeId\)/);
  const triggerStart = autoListing.indexOf("export async function triggerAutoListing");
  const triggerEnd = autoListing.indexOf("\nasync function runAutoListing", triggerStart);
  const trigger = autoListing.slice(triggerStart, triggerEnd);
  assert.match(trigger, /scopedStoreId/);
  assert.match(trigger, /storeId: scopedStoreId/);
  assert.match(autoListing, /createCrawlerTask\(\{[\s\S]*storeId: job\.storeId/);
  assert.match(autoListing, /listCrawlerCandidates\(\{ storeId: job\.storeId \}\)/);
});
