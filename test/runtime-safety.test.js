import test from "node:test";
import assert from "node:assert/strict";
import { authTransportDecision, buildAuthSessionToken, buildRuntimeSafetySnapshot, decodeAuthSessionToken, listingSubmitRoleDecision, normalizeAuthPrincipal, parseStoreScope, privilegedWriteDecision, productionDeploymentDecision, requestAuthDecision, revokeAuthSessionToken, runtimeStartupDecision, storeAccessDecision, verifyAuthSessionToken } from "../src/runtimeSafety.js";

test("runtime safety reports guarded local JSON mode without claiming production", () => {
  const result = buildRuntimeSafetySnapshot({
    host: "127.0.0.1",
    storeCount: 4,
    env: { ENABLE_DIRECT_OZON_WRITES: "0", OZON_SERVER_AUTO_HEAL: "0", OZON_DISTRIBUTOR_AUTORUN: "0" },
  });
  assert.equal(result.loopbackOnly, true);
  assert.equal(result.directWritesEnabled, false);
  assert.equal(result.automationEnabled, false);
  assert.equal(result.authConfigured, false);
  assert.equal(result.persistenceMode, "json_local");
  assert.equal(result.storeCount, 4);
  assert.equal(result.mode, "guarded_not_production");
  assert.equal(result.businessReadiness, "not_verified");
  assert.match(result.businessReadinessNextAction, /真实 Seller API/);
  assert.ok(result.risks.includes("json_persistence_only"));
  assert.match(result.note, /不能证明/);
});

test("runtime safety flags unsafe external exposure and enabled writes without auth", () => {
  const result = buildRuntimeSafetySnapshot({
    host: "0.0.0.0",
    env: { ENABLE_DIRECT_OZON_WRITES: "1", OZON_SERVER_AUTO_HEAL: "1", DATABASE_URL: "postgres://configured" },
  });
  assert.equal(result.loopbackOnly, false);
  assert.equal(result.databaseConfigured, true);
  assert.deepEqual(result.risks.sort(), ["automation_without_auth", "direct_writes_without_admin_auth", "direct_writes_without_auth", "external_host_without_auth", "json_persistence_only"]);
});

test("runtime safety recognizes configured Supabase durable storage", () => {
  const result = buildRuntimeSafetySnapshot({
    host: "127.0.0.1",
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  });
  assert.equal(result.databaseConfigured, true);
  assert.equal(result.persistenceMode, "supabase");
  assert.equal(result.durableStorageRequired, false);
});

test("production storage gate rejects malformed database URLs instead of trusting presence", () => {
  const malformed = productionDeploymentDecision({
    host: "0.0.0.0",
    env: {
      OZON_ERP_AUTH_SECRET: "read-secret",
      DATABASE_URL: "postgres-url",
      OZON_ERP_ALLOWED_STORE_IDS: "store-a",
      OZON_ERP_AUTH_STORE_IDS: "store-a",
      OZON_ERP_AUTH_ENVIRONMENT: "production-readonly",
    },
  });
  assert.equal(malformed.allowed, false);
  assert.ok(malformed.blockers.includes("durable_storage_required_but_missing"));

  const valid = productionDeploymentDecision({
    host: "0.0.0.0",
    env: {
      OZON_ERP_AUTH_SECRET: "read-secret",
      DATABASE_URL: "postgresql://db.example.test/ozon",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      OZON_ERP_ALLOWED_STORE_IDS: "store-a",
      OZON_ERP_AUTH_STORE_IDS: "store-a",
      OZON_ERP_AUTH_ENVIRONMENT: "production-readonly",
      OZON_ERP_TLS_TERMINATED: "1",
      OZON_ERP_AUTH_SINGLE_INSTANCE: "1",
    },
  });
  assert.equal(valid.allowed, true);
});

test("production deployment requires an explicit auth environment for signed read sessions", () => {
  const result = productionDeploymentDecision({
    host: "0.0.0.0",
    env: {
      OZON_ERP_AUTH_SECRET: "read-secret",
      DATABASE_URL: "postgres://configured",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      OZON_ERP_ALLOWED_STORE_IDS: "store-a",
      OZON_ERP_AUTH_STORE_IDS: "store-a",
      OZON_ERP_TLS_TERMINATED: "1",
      OZON_ERP_AUTH_SINGLE_INSTANCE: "1",
    },
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("auth_environment_required"));
  assert.match(result.nextAction, /AUTH_ENVIRONMENT|环境/);
  assert.equal(result.snapshot.authEnvironmentConfigured, false);
});

test("required durable storage blocks startup when database credentials are absent", () => {
  const blocked = runtimeStartupDecision({ host: "127.0.0.1", env: { REQUIRE_DURABLE_STORAGE: "1" } });
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.blockers, ["durable_storage_required_but_missing"]);
  const ready = runtimeStartupDecision({
    host: "127.0.0.1",
    env: { REQUIRE_DURABLE_STORAGE: "1", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  });
  assert.equal(ready.allowed, true);
});

test("explicit durable storage gate exposes an operator next action without changing default compatibility", () => {
  const defaultExternal = runtimeStartupDecision({
    host: "0.0.0.0",
    env: { OZON_ERP_AUTH_SECRET: "configured" },
  });
  assert.equal(defaultExternal.allowed, true);
  assert.deepEqual(defaultExternal.blockers, []);
  assert.match(defaultExternal.nextAction, /JSON|持久化/);

  const required = runtimeStartupDecision({
    host: "0.0.0.0",
    env: {
      OZON_ERP_AUTH_SECRET: "configured",
      OZON_REQUIRE_DURABLE_STORAGE: "1",
    },
  });
  assert.equal(required.allowed, false);
  assert.ok(required.blockers.includes("durable_storage_required_but_missing"));
  assert.match(required.nextAction, /DATABASE_URL/);
  assert.equal(required.blockerDetails[0].code, "durable_storage_required_but_missing");

  const snapshot = buildRuntimeSafetySnapshot({
    host: "0.0.0.0",
    env: { OZON_ERP_AUTH_SECRET: "configured", REQUIRE_DURABLE_STORAGE: "1" },
  });
  assert.ok(snapshot.blockers.includes("durable_storage_required_but_missing"));
  assert.match(snapshot.nextAction, /SUPABASE/);
});

test("production deployment profile fail-closes missing durable storage and principal RBAC scope", () => {
  const blocked = productionDeploymentDecision({ host: "0.0.0.0", env: {} });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blockers.includes("external_host_requires_authentication"));
  assert.ok(blocked.blockers.includes("durable_storage_required_but_missing"));
  assert.ok(blocked.blockers.includes("store_scope_required_but_missing"));
  assert.ok(blocked.blockers.includes("principal_store_scope_required_but_missing"));
  assert.match(blocked.nextAction, /认证|密钥|DATABASE|持久化|店铺/);
  const ready = productionDeploymentDecision({
    host: "0.0.0.0",
    env: {
      OZON_ERP_AUTH_SECRET: "read-secret",
      DATABASE_URL: "postgres://configured",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      OZON_ERP_ALLOWED_STORE_IDS: "store-a,store-b",
      OZON_ERP_AUTH_STORE_IDS: "store-a",
      OZON_ERP_AUTH_ENVIRONMENT: "production-readonly",
      OZON_ERP_TLS_TERMINATED: "1",
      OZON_ERP_AUTH_SINGLE_INSTANCE: "1",
    },
  });
  assert.equal(ready.allowed, true);
  assert.deepEqual(ready.blockers, []);
});

test("production deployment requires an explicit TLS termination assertion", () => {
  const blocked = productionDeploymentDecision({
    host: "0.0.0.0",
    env: {
      OZON_ERP_AUTH_SECRET: "read-secret",
      DATABASE_URL: "postgres://configured",
      SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role",
      OZON_ERP_ALLOWED_STORE_IDS: "store-a",
      OZON_ERP_AUTH_STORE_IDS: "store-a",
    },
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blockers.includes("external_https_required_but_unconfigured"));
  assert.match(blocked.nextAction, /TLS|HTTPS/);
  const ready = productionDeploymentDecision({
    host: "0.0.0.0",
    env: {
      OZON_ERP_AUTH_SECRET: "read-secret",
      DATABASE_URL: "postgres://configured",
      SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role",
      OZON_ERP_ALLOWED_STORE_IDS: "store-a",
      OZON_ERP_AUTH_STORE_IDS: "store-a",
      OZON_ERP_AUTH_ENVIRONMENT: "production-readonly",
      OZON_ERP_TLS_TERMINATED: "1",
      OZON_ERP_AUTH_SINGLE_INSTANCE: "1",
    },
  });
  assert.equal(ready.allowed, true);
  assert.equal(ready.snapshot.secureTransportConfigured, true);
});

test("production deployment rejects a principal scope outside the deployment allowlist", () => {
  const result = productionDeploymentDecision({
    host: "0.0.0.0",
    env: {
      OZON_ERP_AUTH_SECRET: "read-secret",
      DATABASE_URL: "postgres://configured",
      SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role",
      OZON_ERP_ALLOWED_STORE_IDS: "store-a",
      OZON_ERP_AUTH_STORE_IDS: "store-b",
      OZON_ERP_AUTH_ENVIRONMENT: "production-readonly",
      OZON_ERP_TLS_TERMINATED: "1",
      OZON_ERP_AUTH_SINGLE_INSTANCE: "1",
    },
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("principal_store_scope_outside_deployment_scope"));
  assert.match(result.nextAction, /AUTH_STORE_IDS|店铺/);
});

test("production deployment fails closed while session revocation is only process-local", () => {
  const sharedStateMissing = productionDeploymentDecision({
    host: "0.0.0.0",
    env: {
      OZON_ERP_AUTH_SECRET: "read-secret",
      DATABASE_URL: "postgres://configured",
      SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role",
      OZON_ERP_ALLOWED_STORE_IDS: "store-a",
      OZON_ERP_AUTH_STORE_IDS: "store-a",
      OZON_ERP_AUTH_ENVIRONMENT: "production-readonly",
      OZON_ERP_TLS_TERMINATED: "1",
    },
  });
  assert.equal(sharedStateMissing.allowed, false);
  assert.ok(sharedStateMissing.blockers.includes("auth_revocation_shared_state_unconfigured"));
  assert.match(sharedStateMissing.nextAction, /单实例|共享撤销/);

  const explicitlySingleInstance = productionDeploymentDecision({
    host: "0.0.0.0",
    env: {
      OZON_ERP_AUTH_SECRET: "read-secret",
      DATABASE_URL: "postgres://configured",
      SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role",
      OZON_ERP_ALLOWED_STORE_IDS: "store-a",
      OZON_ERP_AUTH_STORE_IDS: "store-a",
      OZON_ERP_AUTH_ENVIRONMENT: "production-readonly",
      OZON_ERP_TLS_TERMINATED: "1",
      OZON_ERP_AUTH_SINGLE_INSTANCE: "1",
    },
  });
  assert.equal(explicitlySingleInstance.allowed, true);
  assert.equal(explicitlySingleInstance.snapshot.singleInstanceAuthDeclared, true);
});

test("runtime startup blocks external exposure without authentication", () => {
  const blocked = runtimeStartupDecision({ host: "0.0.0.0", env: {} });
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.blockers, ["external_host_requires_authentication"]);
  const local = runtimeStartupDecision({ host: "127.0.0.1", env: {} });
  assert.equal(local.allowed, true);
  const authenticated = runtimeStartupDecision({ host: "0.0.0.0", env: { OZON_ERP_AUTH_SECRET: "configured" } });
  assert.equal(authenticated.allowed, true);
  const missingAdmin = runtimeStartupDecision({ host: "0.0.0.0", env: { OZON_ERP_AUTH_SECRET: "configured", ENABLE_DIRECT_OZON_WRITES: "1" } });
  assert.equal(missingAdmin.allowed, false);
  assert.ok(missingAdmin.blockers.includes("direct_writes_require_admin_authentication"));
  const configuredAdmin = runtimeStartupDecision({ host: "0.0.0.0", env: { OZON_ERP_AUTH_SECRET: "configured", OZON_ERP_ADMIN_SECRET: "admin", ENABLE_DIRECT_OZON_WRITES: "1" } });
  assert.equal(configuredAdmin.allowed, true);
});

test("runtime startup blocks unauthenticated automation on external deployments", () => {
  const blocked = runtimeStartupDecision({
    host: "0.0.0.0",
    env: { OZON_SERVER_AUTO_HEAL: "1", DATABASE_URL: "postgres://configured" },
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blockers.includes("external_host_requires_authentication"));
  assert.ok(blocked.blockers.includes("automation_requires_authentication"));
});

test("request auth keeps loopback usable and protects external API requests", () => {
  assert.equal(requestAuthDecision({ host: "127.0.0.1", env: {}, authorization: "" }).allowed, true);
  assert.equal(requestAuthDecision({ host: "0.0.0.0", env: { OZON_ERP_AUTH_SECRET: "secret" } }).reasonCode, "AUTH_REQUIRED");
  assert.equal(requestAuthDecision({ host: "0.0.0.0", env: { OZON_ERP_AUTH_SECRET: "secret" }, authorization: "Bearer wrong" }).reasonCode, "AUTH_INVALID");
  assert.equal(requestAuthDecision({ host: "0.0.0.0", env: { OZON_ERP_AUTH_SECRET: "secret" }, providedSecret: "secret" }).allowed, true);
});

test("external API auth can exchange a secret for a time-bounded session token", () => {
  const env = { OZON_ERP_AUTH_SECRET: "secret", OZON_ERP_AUTH_SESSION_TTL_SECONDS: "600" };
  const token = buildAuthSessionToken({ env, now: 1_000_000 });
  assert.ok(token);
  assert.equal(verifyAuthSessionToken({ env, token, now: 1_000_100 }), true);
  assert.equal(verifyAuthSessionToken({ env, token, now: 1_601_000 }), false);
  assert.equal(requestAuthDecision({ env, host: "0.0.0.0", sessionToken: token, now: 1_000_100 }).reasonCode, "SESSION_OK");
});

test("loopback preserves a valid signed session source for read-operator proof", () => {
  const env = {
    OZON_ERP_AUTH_SECRET: "secret",
    OZON_ERP_AUTH_ENVIRONMENT: "local-read",
    OZON_ERP_AUTH_STORE_IDS: "store-a,store-b",
  };
  const token = buildAuthSessionToken({ env, now: 1_000_000 });
  const result = requestAuthDecision({ env, host: "127.0.0.1", sessionToken: token, now: 1_000_100 });
  assert.equal(result.allowed, true);
  assert.equal(result.reasonCode, "SESSION_OK");
  assert.equal(result.authSource, "session_cookie");
  assert.deepEqual(result.principal.storeIds, ["store-a", "store-b"]);
});

test("external extensions may present the signed session token as a bearer credential", () => {
  const env = { OZON_ERP_AUTH_SECRET: "secret", OZON_ERP_AUTH_ROLE: "operator", OZON_ERP_AUTH_STORE_IDS: "store-a" };
  const token = buildAuthSessionToken({ env, now: 1_000_000 });
  const result = requestAuthDecision({ env, host: "0.0.0.0", authorization: `Bearer ${token}`, now: 1_000_100 });
  assert.equal(result.reasonCode, "SESSION_OK");
  assert.deepEqual(result.principal.storeIds, ["store-a"]);
  assert.equal(result.authSource, "session_bearer");
});

test("static ERP secret is classified as bootstrap auth, never as a read session", () => {
  const env = { OZON_ERP_AUTH_SECRET: "secret", OZON_ERP_AUTH_ENVIRONMENT: "production" };
  const result = requestAuthDecision({ env, host: "0.0.0.0", providedSecret: "secret" });
  assert.equal(result.allowed, true);
  assert.equal(result.authSource, "static_secret");
  const token = buildAuthSessionToken({ env, now: 1_000_000 });
  const session = requestAuthDecision({ env, host: "0.0.0.0", authorization: `Bearer ${token}`, now: 1_000_100 });
  assert.equal(session.authSource, "session_bearer");
  assert.equal(session.principal.environment, "production");
  assert.notEqual(result.authSource, session.authSource);
});

test("session logout revokes bearer replay and epoch rotation invalidates issued sessions", () => {
  const env = { OZON_ERP_AUTH_SECRET: "secret", OZON_ERP_AUTH_SESSION_EPOCH: "epoch-1" };
  const token = buildAuthSessionToken({ env, now: 1_000_000 });
  assert.equal(requestAuthDecision({ env, host: "0.0.0.0", authorization: `Bearer ${token}`, now: 1_000_100 }).allowed, true);
  assert.equal(revokeAuthSessionToken({ env, token, now: 1_000_101 }), true);
  assert.equal(requestAuthDecision({ env, host: "0.0.0.0", authorization: `Bearer ${token}`, now: 1_000_102 }).reasonCode, "AUTH_INVALID");

  const rotated = buildAuthSessionToken({ env: { ...env, OZON_ERP_AUTH_SESSION_EPOCH: "epoch-2" }, now: 1_000_200 });
  assert.equal(decodeAuthSessionToken({ env, token: rotated, now: 1_000_201 }).valid, false);
  assert.equal(decodeAuthSessionToken({ env: { ...env, OZON_ERP_AUTH_SESSION_EPOCH: "epoch-2" }, token: rotated, now: 1_000_201 }).valid, true);
});

test("session tokens carry a bounded role and store scope claim", () => {
  const env = {
    OZON_ERP_AUTH_SECRET: "secret",
    OZON_ERP_AUTH_ROLE: "operator",
    OZON_ERP_AUTH_STORE_IDS: "store-a,store-b",
    OZON_ERP_AUTH_PRINCIPAL_ID: "operator-1",
  };
  const token = buildAuthSessionToken({ env, now: 1_000_000 });
  const decoded = decodeAuthSessionToken({ env, token, now: 1_000_100 });
  assert.equal(decoded.valid, true);
  assert.deepEqual(decoded.principal, { role: "operator", storeIds: ["store-a", "store-b"], principalId: "operator-1" });
  assert.equal(requestAuthDecision({ env, host: "0.0.0.0", sessionToken: token, now: 1_000_100 }).principal.role, "operator");
  assert.equal(normalizeAuthPrincipal({ role: "root", storeIds: "store-a" }).role, "operator");
});

test("direct writes require a separate administrator secret from the normal ERP session", () => {
  const env = { OZON_ERP_AUTH_SECRET: "read-secret", OZON_ERP_ADMIN_SECRET: "write-secret" };
  assert.equal(privilegedWriteDecision({ env, authorization: "Bearer read-secret" }).reasonCode, "ADMIN_AUTH_INVALID");
  assert.equal(privilegedWriteDecision({ env }).reasonCode, "ADMIN_AUTH_REQUIRED");
  assert.equal(privilegedWriteDecision({ env, providedSecret: "write-secret" }).reasonCode, "ADMIN_AUTH_OK");
  assert.equal(privilegedWriteDecision({ env: { OZON_ERP_AUTH_SECRET: "read-secret" }, providedSecret: "write-secret" }).reasonCode, "ADMIN_AUTH_NOT_CONFIGURED");
});

test("external authentication requires HTTPS while loopback remains available", () => {
  assert.equal(authTransportDecision({ host: "0.0.0.0" }).reasonCode, "AUTH_HTTPS_REQUIRED");
  assert.equal(authTransportDecision({ host: "0.0.0.0", forwardedProto: "https" }).allowed, false);
  assert.equal(authTransportDecision({ host: "0.0.0.0", forwardedProto: "https", trustProxy: true }).allowed, true);
  assert.equal(authTransportDecision({ host: "0.0.0.0", secure: true }).allowed, true);
  assert.equal(authTransportDecision({ host: "127.0.0.1" }).allowed, true);
});

test("store scope rejects body/query-selected stores outside the deployment allowlist", () => {
  assert.deepEqual(parseStoreScope(" store-a,store-b,store-a "), ["store-a", "store-b"]);
  assert.equal(storeAccessDecision({ storeId: "store-a", env: { OZON_ERP_ALLOWED_STORE_IDS: "store-a,store-b" } }).reasonCode, "STORE_SCOPE_OK");
  assert.equal(storeAccessDecision({ storeId: "store-c", env: { OZON_ERP_ALLOWED_STORE_IDS: "store-a,store-b" } }).reasonCode, "STORE_ACCESS_DENIED");
  assert.equal(storeAccessDecision({ storeId: "store-a", env: { OZON_ERP_REQUIRE_STORE_SCOPE: "1" } }).reasonCode, "STORE_SCOPE_NOT_CONFIGURED");
});

test("principal store scope fails closed when required and prevents cross-store access", () => {
  const env = { OZON_ERP_REQUIRE_PRINCIPAL_SCOPE: "1", OZON_ERP_ALLOWED_STORE_IDS: "store-a,store-b" };
  assert.equal(storeAccessDecision({ storeId: "store-a", env, principal: { role: "operator", storeIds: ["store-a"] } }).allowed, true);
  assert.equal(storeAccessDecision({ storeId: "store-b", env, principal: { role: "operator", storeIds: ["store-a"] } }).reasonCode, "PRINCIPAL_STORE_ACCESS_DENIED");
  assert.equal(storeAccessDecision({ storeId: "store-a", env, principal: { role: "operator", storeIds: [] } }).reasonCode, "PRINCIPAL_STORE_SCOPE_REQUIRED");
  const blocked = runtimeStartupDecision({ host: "0.0.0.0", env: { OZON_ERP_AUTH_SECRET: "secret", OZON_ERP_REQUIRE_PRINCIPAL_SCOPE: "1" } });
  assert.ok(blocked.blockers.includes("principal_store_scope_required_but_missing"));
});

test("listing submission role gate blocks viewers outside loopback", () => {
  assert.equal(listingSubmitRoleDecision({ host: "0.0.0.0", principal: { role: "viewer" } }).reasonCode, "LISTING_SUBMIT_ROLE_REQUIRED");
  assert.equal(listingSubmitRoleDecision({ host: "0.0.0.0", principal: { role: "operator" } }).allowed, true);
  assert.equal(listingSubmitRoleDecision({ host: "0.0.0.0", principal: { role: "admin" } }).allowed, true);
  assert.equal(listingSubmitRoleDecision({ host: "127.0.0.1", principal: null }).reasonCode, "LOOPBACK_ALLOWED");
});

test("required store scope is a startup prerequisite for external deployments", () => {
  const blocked = runtimeStartupDecision({ host: "0.0.0.0", env: { OZON_ERP_AUTH_SECRET: "secret", OZON_ERP_REQUIRE_STORE_SCOPE: "1" } });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blockers.includes("store_scope_required_but_missing"));
  const ready = runtimeStartupDecision({ host: "0.0.0.0", env: { OZON_ERP_AUTH_SECRET: "secret", OZON_ERP_REQUIRE_STORE_SCOPE: "1", OZON_ERP_ALLOWED_STORE_IDS: "store-a" } });
  assert.equal(ready.allowed, true);
});
