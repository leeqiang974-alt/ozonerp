import { createHmac, createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { durableStorageCapability } from "./durableStorageCapability.js";

// Session revocation is intentionally bounded and stores only a one-way token
// fingerprint.  It closes logout/replay within a single process; a
// multi-instance deployment must share the epoch or move this set to durable
// storage before claiming cluster-wide revocation.
const revokedSessionTokens = new Map();
const MAX_REVOKED_SESSION_TOKENS = 4096;

function sessionTokenFingerprint(token = "") {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function authSessionEpoch(env = process.env) {
  return String(env.OZON_ERP_AUTH_SESSION_EPOCH || "0").trim().slice(0, 120) || "0";
}

function purgeRevokedSessionTokens(nowMs = Date.now()) {
  const now = Math.floor(Number(nowMs) / 1000);
  for (const [fingerprint, expiresAt] of revokedSessionTokens) {
    if (Number(expiresAt) <= now) revokedSessionTokens.delete(fingerprint);
  }
  while (revokedSessionTokens.size > MAX_REVOKED_SESSION_TOKENS) {
    const first = revokedSessionTokens.keys().next().value;
    if (first === undefined) break;
    revokedSessionTokens.delete(first);
  }
}

export function buildRuntimeSafetySnapshot({ env = process.env, host = "127.0.0.1", storeCount = 0 } = {}) {
  const normalizedHost = String(host || "").trim() || "127.0.0.1";
  const loopbackOnly = ["127.0.0.1", "localhost", "::1"].includes(normalizedHost);
  const directWritesEnabled = String(env.ENABLE_DIRECT_OZON_WRITES || "") === "1";
  const adminWriteAuthConfigured = Boolean(String(env.OZON_ERP_ADMIN_SECRET || "").trim());
  const automationEnabled = String(env.OZON_SERVER_AUTO_HEAL || "") === "1"
    || String(env.OZON_DISTRIBUTOR_AUTORUN || "") === "1";
  const authConfigured = Boolean(String(env.OZON_ERP_AUTH_SECRET || env.AUTH_SECRET || "").trim());
  const authEnvironmentConfigured = Boolean(String(env.OZON_ERP_AUTH_ENVIRONMENT || env.OZON_ERP_ENVIRONMENT || "").trim());
  // Presence of an environment variable is not enough to establish a
  // durable-storage boundary.  A typo such as DATABASE_URL=postgres-url
  // would otherwise make the production preflight look ready while the
  // server cannot create a database client.  Keep this check syntax-only and
  // local: connectivity and migration state remain separate evidence gates.
  const databaseConfigured = isDurableDatabaseConfiguration(env);
  const repositoryStorage = durableStorageCapability(env);
  const durableStorageRequired = String(env.OZON_REQUIRE_DURABLE_STORAGE || env.REQUIRE_DURABLE_STORAGE || "") === "1";
  const storeScopeRequired = String(env.OZON_ERP_REQUIRE_STORE_SCOPE || env.REQUIRE_STORE_SCOPE || "") === "1";
  const configuredStoreIds = parseStoreScope(env.OZON_ERP_ALLOWED_STORE_IDS || env.OZON_ERP_STORE_IDS);
  const principalScopeRequired = String(env.OZON_ERP_REQUIRE_PRINCIPAL_SCOPE || "") === "1";
  const principalStoreIds = parseStoreScope(env.OZON_ERP_AUTH_STORE_IDS || "");
  // A request-time HTTPS gate is not enough for a deployment preflight: an
  // external process must explicitly declare that TLS terminates at the app
  // or at a trusted reverse proxy before it can be called production-ready.
  const httpsRequired = String(env.OZON_ERP_REQUIRE_HTTPS || "") === "1";
  const secureTransportConfigured = String(env.OZON_ERP_TLS_TERMINATED || env.OZON_ERP_HTTPS_LISTENER || "") === "1";
  // Session revocation is process-local today.  An external deployment must
  // therefore declare that it is intentionally single-instance; otherwise a
  // logout on one worker would not revoke the same bearer token on its peers.
  // This is a deployment topology assertion, not a claim that a shared
  // backend exists.  Multi-instance shared revocation remains a separate
  // implementation gate and must fail closed until it is wired end-to-end.
  const singleInstanceAuthDeclared = String(env.OZON_ERP_AUTH_SINGLE_INSTANCE || "") === "1";
  const risks = [];
  if (!loopbackOnly && !authConfigured) risks.push("external_host_without_auth");
  if (directWritesEnabled && !authConfigured) risks.push("direct_writes_without_auth");
  if (directWritesEnabled && !adminWriteAuthConfigured) risks.push("direct_writes_without_admin_auth");
  if (automationEnabled && !authConfigured) risks.push("automation_without_auth");
  if (!repositoryStorage.configured) risks.push("json_persistence_only");
  if (durableStorageRequired && !repositoryStorage.configured) risks.push("durable_storage_required_but_missing");
  if (!loopbackOnly && storeScopeRequired && !configuredStoreIds.length) risks.push("store_scope_required_but_missing");
  if (!loopbackOnly && principalScopeRequired && !principalStoreIds.length) risks.push("principal_store_scope_required_but_missing");
  if (!loopbackOnly && httpsRequired && !secureTransportConfigured) risks.push("external_https_required_but_unconfigured");
  const blockers = [
    ...(!loopbackOnly && !authConfigured ? ["external_host_requires_authentication"] : []),
    ...(directWritesEnabled && !adminWriteAuthConfigured ? ["direct_writes_require_admin_authentication"] : []),
    ...(!loopbackOnly && automationEnabled && !authConfigured ? ["automation_requires_authentication"] : []),
    ...(durableStorageRequired && !repositoryStorage.configured ? ["durable_storage_required_but_missing"] : []),
    ...(storeScopeRequired && !configuredStoreIds.length ? ["store_scope_required_but_missing"] : []),
    ...(!loopbackOnly && principalScopeRequired && !principalStoreIds.length ? ["principal_store_scope_required_but_missing"] : []),
    ...(!loopbackOnly && httpsRequired && !secureTransportConfigured ? ["external_https_required_but_unconfigured"] : []),
  ];
  const nextAction = runtimeSafetyNextAction({ blockers, risks, loopbackOnly });
  return {
    mode: risks.length ? "guarded_not_production" : "production_prerequisites_present",
    host: normalizedHost,
    loopbackOnly,
    directWritesEnabled,
    adminWriteAuthConfigured,
    automationEnabled,
    authConfigured,
    authEnvironmentConfigured,
    databaseConfigured,
    repositoryBackend: repositoryStorage.backend,
    repositoryBackendConfigured: repositoryStorage.configured,
    durableStorageRequired,
    storeScopeRequired,
    storeScopeConfigured: configuredStoreIds.length > 0,
    principalScopeRequired,
    principalScopeConfigured: principalStoreIds.length > 0,
    httpsRequired,
    secureTransportConfigured,
    singleInstanceAuthDeclared,
    allowedStoreCount: configuredStoreIds.length,
    persistenceMode: repositoryStorage.configured ? "supabase" : "json_local",
    // Runtime prerequisites are not business evidence.  Keep this explicit so
    // a healthy process/configuration cannot be rendered as a verified ERP
    // workflow or Seller API readiness state.
    businessReadiness: "not_verified",
    businessReadinessNextAction: "仍需真实 Seller API 回执、商品审核回读和库存对账；运行配置通过不代表业务已就绪。",
    storeCount: Math.max(0, Number(storeCount || 0)),
    risks,
    blockers,
    nextAction,
    blockerDetails: blockers.map((code) => ({ code, severity: "high", nextAction: runtimeSafetyActionFor(code) })),
    note: "运行安全摘要不是认证机制，也不能证明 Ozon 写入或业务闭环已经验证。",
  };
}

function isDurableDatabaseConfiguration(env = process.env) {
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      return ["postgres:", "postgresql:"].includes(parsed.protocol)
        && Boolean(parsed.hostname);
    } catch {
      return false;
    }
  }
  const supabaseUrl = String(env.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey) return false;
  try {
    const parsed = new URL(supabaseUrl);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

const RUNTIME_SAFETY_ACTIONS = Object.freeze({
  external_host_requires_authentication: "配置 ERP 认证密钥，或将 HOST 保持为 127.0.0.1。",
  direct_writes_require_admin_authentication: "配置独立管理员密钥；普通会话不能获得写入权限。",
  automation_requires_authentication: "为自动化配置 ERP 认证，再启动外部服务。",
  durable_storage_required_but_missing: "当前 JobRepository 只支持 Supabase；配置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY，DATABASE_URL 单独声明不会提供运行时适配器。",
  store_scope_required_but_missing: "配置 OZON_ERP_ALLOWED_STORE_IDS，明确允许访问的店铺范围。",
  principal_store_scope_required_but_missing: "为认证 principal 配置 OZON_ERP_AUTH_STORE_IDS，禁止无范围会话访问店铺。",
  principal_store_scope_outside_deployment_scope: "将 OZON_ERP_AUTH_STORE_IDS 限制为 OZON_ERP_ALLOWED_STORE_IDS 内的店铺，再运行生产预检。",
  external_https_required_but_unconfigured: "配置 OZON_ERP_TLS_TERMINATED=1（应用或可信反向代理已终止 TLS）后再暴露外部服务。",
  auth_environment_required: "配置 OZON_ERP_AUTH_ENVIRONMENT（或 OZON_ERP_ENVIRONMENT），让签名会话与受控 Seller API 读取环境一致。",
  auth_revocation_shared_state_unconfigured: "当前会话撤销表仅在单进程内生效；先配置 OZON_ERP_AUTH_SINGLE_INSTANCE=1 明确单实例，或实现共享撤销后端后再运行多实例。",
  json_persistence_only: "当前仅使用本地 JSON；仅在本机开发使用，生产前配置持久化数据库。",
  durable_storage_backend_unavailable: "当前 JobRepository 未配置可用的 Supabase 后端；DATABASE_URL 单独声明不会阻止 JSON fallback。",
});

function runtimeSafetyActionFor(code = "") {
  return RUNTIME_SAFETY_ACTIONS[code] || "查看运行配置并完成未满足的前置条件。";
}

function runtimeSafetyNextAction({ blockers = [], risks = [], loopbackOnly = true } = {}) {
  const first = blockers[0] || risks.find((code) => RUNTIME_SAFETY_ACTIONS[code]);
  if (first) return runtimeSafetyActionFor(first);
  if (!loopbackOnly) return "运行前置条件已满足；仍需通过业务证据、人工确认和回查验证 ERP 操作结果。";
  return "可继续本机开发；生产部署前仍需认证、持久化、恢复演练和店铺隔离验证。";
}

export function runtimeStartupDecision({ env = process.env, host = "127.0.0.1" } = {}) {
  const snapshot = buildRuntimeSafetySnapshot({ env, host });
  const blocked = (!snapshot.loopbackOnly && !snapshot.authConfigured)
    || (!snapshot.loopbackOnly && snapshot.directWritesEnabled && !snapshot.adminWriteAuthConfigured)
    || (!snapshot.loopbackOnly && snapshot.automationEnabled && !snapshot.authConfigured)
    || (snapshot.durableStorageRequired && !snapshot.repositoryBackendConfigured)
    || (snapshot.storeScopeRequired && !snapshot.storeScopeConfigured)
    || (!snapshot.loopbackOnly && snapshot.principalScopeRequired && !snapshot.principalScopeConfigured)
    || (!snapshot.loopbackOnly && snapshot.httpsRequired && !snapshot.secureTransportConfigured);
  return {
    allowed: !blocked,
    blockers: snapshot.blockers,
    blockerDetails: snapshot.blockerDetails,
    nextAction: runtimeSafetyNextAction({ blockers: snapshot.blockers, risks: snapshot.risks, loopbackOnly: snapshot.loopbackOnly }),
    snapshot,
  };
}

/**
 * Deployment-only gate.  Local development intentionally keeps the relaxed
 * loopback/JSON compatibility in runtimeStartupDecision; a deployment
 * preflight must be stricter and must not accidentally certify a process that
 * has no durable store or principal/store authorization boundary.
 */
export function productionDeploymentDecision({ env = process.env, host = "0.0.0.0" } = {}) {
  const configured = { ...env,
    OZON_REQUIRE_DURABLE_STORAGE: "1",
    OZON_ERP_REQUIRE_STORE_SCOPE: "1",
    OZON_ERP_REQUIRE_PRINCIPAL_SCOPE: "1",
    OZON_ERP_REQUIRE_HTTPS: "1",
  };
  const startup = runtimeStartupDecision({ env: configured, host });
  const blockers = [...startup.blockers];
  const snapshot = startup.snapshot;
  if (!snapshot.authConfigured && !blockers.includes("external_host_requires_authentication")) {
    blockers.push("external_host_requires_authentication");
  }
  if (!snapshot.databaseConfigured && !blockers.includes("durable_storage_required_but_missing")) {
    blockers.push("durable_storage_required_but_missing");
  }
  if (!snapshot.repositoryBackendConfigured && !blockers.includes("durable_storage_backend_unavailable")) {
    blockers.push("durable_storage_backend_unavailable");
  }
  if (!snapshot.storeScopeConfigured && !blockers.includes("store_scope_required_but_missing")) {
    blockers.push("store_scope_required_but_missing");
  }
  if (!snapshot.principalScopeConfigured && !blockers.includes("principal_store_scope_required_but_missing")) {
    blockers.push("principal_store_scope_required_but_missing");
  }
  // A non-empty deployment allowlist and a non-empty principal scope are not
  // sufficient on their own. If the principal only names stores outside the
  // deployment boundary, preflight would report "ready" while every business
  // request is rejected by storeAccessDecision. Fail closed before exposing
  // a misleading production-ready result.
  const deploymentStoreIds = parseStoreScope(configured.OZON_ERP_ALLOWED_STORE_IDS || configured.OZON_ERP_STORE_IDS);
  const principalStoreIds = parseStoreScope(configured.OZON_ERP_AUTH_STORE_IDS);
  if (deploymentStoreIds.length && principalStoreIds.length
    && principalStoreIds.some((storeId) => !deploymentStoreIds.includes(storeId))) {
    blockers.push("principal_store_scope_outside_deployment_scope");
  }
  if (!snapshot.singleInstanceAuthDeclared) blockers.push("auth_revocation_shared_state_unconfigured");
  if (!snapshot.authEnvironmentConfigured) blockers.push("auth_environment_required");
  return {
    allowed: blockers.length === 0,
    blockers,
    blockerDetails: blockers.map((code) => ({ code, severity: "high", nextAction: runtimeSafetyActionFor(code) })),
    nextAction: runtimeSafetyActionFor(blockers[0]) || "生产运行配置具备持久化、认证和店铺授权边界；仍需通过真实部署验证。",
    snapshot,
    profile: "production",
  };
}

/**
 * Normalize the explicitly configured store scope. This is a deployment guard,
 * not a substitute for user/role backed RBAC; production tenants must still
 * move this scope into the authenticated principal.
 */
export function parseStoreScope(value = "") {
  return [...new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean))];
}

const AUTH_ROLES = new Set(["viewer", "operator", "admin"]);

export function normalizeAuthPrincipal({ role = "operator", storeIds = [], principalId = "", environment = "" } = {}) {
  const normalizedRole = AUTH_ROLES.has(String(role || "").trim().toLowerCase())
    ? String(role).trim().toLowerCase()
    : "operator";
  return {
    role: normalizedRole,
    storeIds: parseStoreScope(Array.isArray(storeIds) ? storeIds.join(",") : storeIds),
    ...(String(principalId || "").trim() ? { principalId: String(principalId).trim().slice(0, 120) } : {}),
    ...(String(environment || "").trim() ? { environment: String(environment).trim().slice(0, 120) } : {}),
  };
}

function configuredAuthPrincipal(env = process.env) {
  return normalizeAuthPrincipal({
    role: env.OZON_ERP_AUTH_ROLE || "operator",
    storeIds: env.OZON_ERP_AUTH_STORE_IDS || env.OZON_ERP_ALLOWED_STORE_IDS || env.OZON_ERP_STORE_IDS,
    principalId: env.OZON_ERP_AUTH_PRINCIPAL_ID || "",
    environment: env.OZON_ERP_AUTH_ENVIRONMENT || env.OZON_ERP_ENVIRONMENT || "",
  });
}

export function storeAccessDecision({ storeId = "", env = process.env, principal = null } = {}) {
  const requested = String(storeId || "").trim();
  const allowedStoreIds = parseStoreScope(env.OZON_ERP_ALLOWED_STORE_IDS || env.OZON_ERP_STORE_IDS);
  const principalStoreIds = parseStoreScope(principal?.storeIds || "");
  const required = String(env.OZON_ERP_REQUIRE_STORE_SCOPE || env.REQUIRE_STORE_SCOPE || "") === "1";
  const principalScopeRequired = String(env.OZON_ERP_REQUIRE_PRINCIPAL_SCOPE || "") === "1";
  if (!requested) return { allowed: true, required, reasonCode: "STORE_SCOPE_NOT_REQUESTED", allowedStoreIds };
  if (principalScopeRequired && !principalStoreIds.length) {
    return { allowed: false, required: true, reasonCode: "PRINCIPAL_STORE_SCOPE_REQUIRED", allowedStoreIds, principalStoreIds };
  }
  if (principalStoreIds.length && !principalStoreIds.includes(requested)) {
    return { allowed: false, required: true, reasonCode: "PRINCIPAL_STORE_ACCESS_DENIED", allowedStoreIds, principalStoreIds };
  }
  if (!allowedStoreIds.length) {
    return required
      ? { allowed: false, required: true, reasonCode: "STORE_SCOPE_NOT_CONFIGURED", allowedStoreIds, principalStoreIds }
      : { allowed: true, required: false, reasonCode: "STORE_SCOPE_UNCONFIGURED", allowedStoreIds, principalStoreIds };
  }
  return allowedStoreIds.includes(requested)
    ? { allowed: true, required, reasonCode: "STORE_SCOPE_OK", allowedStoreIds, principalStoreIds }
    : { allowed: false, required, reasonCode: "STORE_ACCESS_DENIED", allowedStoreIds, principalStoreIds };
}

// Minimal role boundary for irreversible listing submission.  This is not a
// general RBAC system: viewers may read/repair drafts, while operators and
// admins may submit after the existing preflight and confirmation gates.
export function listingSubmitRoleDecision({ host = "127.0.0.1", principal = null } = {}) {
  const normalizedHost = String(host || "").trim() || "127.0.0.1";
  const loopbackOnly = ["127.0.0.1", "localhost", "::1"].includes(normalizedHost);
  const role = String(principal?.role || "").trim().toLowerCase();
  if (loopbackOnly || role === "operator" || role === "admin") {
    return { allowed: true, reasonCode: loopbackOnly ? "LOOPBACK_ALLOWED" : "LISTING_SUBMIT_ROLE_OK" };
  }
  return { allowed: false, reasonCode: "LISTING_SUBMIT_ROLE_REQUIRED" };
}

function authSessionSignature(secret, payload) {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

export function buildAuthSessionToken({ env = process.env, now = Date.now() } = {}) {
  const secret = String(env.OZON_ERP_AUTH_SECRET || env.AUTH_SECRET || "").trim();
  if (!secret) return "";
  const ttl = Math.min(86400, Math.max(300, Number(env.OZON_ERP_AUTH_SESSION_TTL_SECONDS || 28800)));
  const expiresAt = Math.floor(Number(now) / 1000) + ttl;
  const principal = configuredAuthPrincipal(env);
  const payload = JSON.stringify({ v: 3, iat: Math.floor(Number(now) / 1000), exp: expiresAt, epoch: authSessionEpoch(env), jti: randomUUID(), role: principal.role, stores: principal.storeIds, ...(principal.principalId ? { sub: principal.principalId } : {}), ...(principal.environment ? { env: principal.environment } : {}) });
  return `${Buffer.from(payload).toString("base64url")}.${authSessionSignature(secret, payload)}`;
}

export function decodeAuthSessionToken({ env = process.env, token = "", now = Date.now() } = {}) {
  const secret = String(env.OZON_ERP_AUTH_SECRET || env.AUTH_SECRET || "").trim();
  const parts = String(token || "").split(".");
  purgeRevokedSessionTokens(now);
  if (!secret || parts.length !== 2) return { valid: false, principal: null };
  const fingerprint = sessionTokenFingerprint(token);
  if (revokedSessionTokens.has(fingerprint)) return { valid: false, principal: null, reasonCode: "SESSION_REVOKED" };
  let payload;
  try { payload = Buffer.from(parts[0], "base64url").toString("utf8"); } catch { return { valid: false, principal: null }; }
  const expected = authSessionSignature(secret, payload);
  if (parts[1].length !== expected.length || !timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return { valid: false, principal: null };
  if (payload.startsWith("v1.")) {
    const expiry = Number(payload.slice(3));
    return expiry > Math.floor(Number(now) / 1000)
      ? { valid: true, principal: normalizeAuthPrincipal({ role: "operator" }) }
      : { valid: false, principal: null };
  }
  try {
    const parsed = JSON.parse(payload);
    // v2 sessions had no epoch or revocation identity. Reject them rather
    // than preserving a replayable credential across the security upgrade.
    if (parsed.v !== 3 || Number(parsed.exp) <= Math.floor(Number(now) / 1000)) return { valid: false, principal: null };
    // v3 binds a session to the configured epoch. Incrementing the epoch
    // invalidates all previously issued sessions without exposing secrets.
    if (String(parsed.epoch || "") !== authSessionEpoch(env)) return { valid: false, principal: null, reasonCode: "SESSION_EPOCH_MISMATCH" };
    return { valid: true, principal: normalizeAuthPrincipal({ role: parsed.role, storeIds: parsed.stores, principalId: parsed.sub, environment: parsed.env }) };
  } catch {
    return { valid: false, principal: null };
  }
}

export function revokeAuthSessionToken({ env = process.env, token = "", now = Date.now() } = {}) {
  const raw = String(token || "").trim();
  if (!raw) return false;
  const decoded = decodeAuthSessionToken({ env, token: raw, now });
  if (!decoded.valid) return false;
  const payloadPart = raw.split(".")[0] || "";
  let expiresAt = Math.floor(Number(now) / 1000) + 300;
  try {
    const parsed = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    expiresAt = Math.max(Math.floor(Number(now) / 1000) + 1, Number(parsed.exp) || expiresAt);
  } catch { /* keep bounded fallback */ }
  purgeRevokedSessionTokens(now);
  revokedSessionTokens.set(sessionTokenFingerprint(raw), expiresAt);
  purgeRevokedSessionTokens(now);
  return true;
}

export function verifyAuthSessionToken(options = {}) {
  return decodeAuthSessionToken(options).valid;
}

export function requestAuthDecision({ env = process.env, host = "127.0.0.1", authorization = "", providedSecret = "", sessionToken = "", now = Date.now() } = {}) {
  const snapshot = buildRuntimeSafetySnapshot({ env, host });
  const configuredSecret = String(env.OZON_ERP_AUTH_SECRET || env.AUTH_SECRET || "").trim();
  // A valid signed session must remain visible even on loopback. Loopback is
  // a bootstrap convenience, not a reason to downgrade an established
  // session to `authSource=loopback`; read-operator proof requires the signed
  // source to be preserved.
  const decoded = decodeAuthSessionToken({ env, token: sessionToken, now });
  if (decoded.valid) return { allowed: true, required: true, reasonCode: "SESSION_OK", authSource: "session_cookie", principal: decoded.principal };
  const bearer = String(authorization || "").replace(/^Bearer\s+/i, "").trim();
  // Browser extensions cannot read the ERP's HttpOnly session cookie. Accept
  // the same signed session token in an Authorization header so a configured
  // extension can call the external deployment without receiving the secret.
  const decodedBearer = decodeAuthSessionToken({ env, token: bearer, now });
  if (decodedBearer.valid) return { allowed: true, required: true, reasonCode: "SESSION_OK", authSource: "session_bearer", principal: decodedBearer.principal };
  if (snapshot.loopbackOnly) return { allowed: true, required: false, reasonCode: "LOOPBACK_ALLOWED", authSource: "loopback", principal: normalizeAuthPrincipal({ role: "admin", storeIds: env.OZON_ERP_AUTH_STORE_IDS || env.OZON_ERP_ALLOWED_STORE_IDS, environment: env.OZON_ERP_AUTH_ENVIRONMENT || env.OZON_ERP_ENVIRONMENT || "" }) };
  if (!configuredSecret) return { allowed: false, required: true, reasonCode: "AUTH_NOT_CONFIGURED", principal: null };
  const presented = String(providedSecret || bearer).trim();
  const matches = presented.length === configuredSecret.length
    && timingSafeEqual(Buffer.from(presented), Buffer.from(configuredSecret));
  return {
    allowed: Boolean(presented) && matches,
    required: true,
    reasonCode: presented ? (matches ? "AUTH_OK" : "AUTH_INVALID") : "AUTH_REQUIRED",
    authSource: matches ? "static_secret" : "",
    principal: matches ? configuredAuthPrincipal(env) : null,
  };
}

/**
 * Gate high-risk direct Ozon writes with a separate operator secret. The
 * normal ERP auth secret/session proves that a caller may use the API; this
 * second secret proves that the caller may perform an irreversible write.
 * This is deliberately a deployment boundary, not a claim that user/RBAC is
 * complete. Keep the two credentials separate so a read-only session cannot
 * silently gain write capability.
 */
export function privilegedWriteDecision({ env = process.env, authorization = "", providedSecret = "" } = {}) {
  const configuredSecret = String(env.OZON_ERP_ADMIN_SECRET || "").trim();
  if (!configuredSecret) return { allowed: false, required: true, reasonCode: "ADMIN_AUTH_NOT_CONFIGURED" };
  const bearer = String(authorization || "").replace(/^Bearer\s+/i, "").trim();
  const presented = String(providedSecret || bearer).trim();
  const matches = presented.length === configuredSecret.length
    && timingSafeEqual(Buffer.from(presented), Buffer.from(configuredSecret));
  return {
    allowed: Boolean(presented) && matches,
    required: true,
    reasonCode: presented ? (matches ? "ADMIN_AUTH_OK" : "ADMIN_AUTH_INVALID") : "ADMIN_AUTH_REQUIRED",
  };
}

// Authentication credentials and session cookies must not cross an external
// network over clear-text HTTP. Loopback remains usable for local development;
// deployments bound to a non-loopback host must terminate TLS at the app or a
// trusted reverse proxy and forward `X-Forwarded-Proto: https`.
export function authTransportDecision({ host = "127.0.0.1", secure = false, forwardedProto = "", trustProxy = false } = {}) {
  const normalizedHost = String(host || "").trim() || "127.0.0.1";
  const loopbackOnly = ["127.0.0.1", "localhost", "::1"].includes(normalizedHost);
  const forwarded = String(forwardedProto || "").split(",")[0].trim().toLowerCase();
  // Never trust a client-supplied forwarding header unless the deployment has
  // explicitly declared a trusted reverse proxy.
  const isHttps = Boolean(secure) || (trustProxy === true && forwarded === "https");
  if (loopbackOnly || isHttps) return { allowed: true, reasonCode: "AUTH_TRANSPORT_OK" };
  return { allowed: false, reasonCode: "AUTH_HTTPS_REQUIRED" };
}
