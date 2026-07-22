# Ozon ERP 部署与恢复演练边界

这份文档描述当前仓储已经提供的“可执行前置检查”，不把配置检查冒充为生产就绪。

## 数据库迁移

1. 在目标 Supabase 项目执行 `supabase/migrations/20260715_001_core_job_storage.sql`。
2. 先执行 `npm run migration-dry-run`。它只读取三个本地 JSON 快照和 SQL，不连接数据库；会阻止无主键、重复主键、结构损坏或凭据字段进入迁移计划，并输出各源文件 SHA-256、行数和阻塞代码。
3. 用服务端 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY` 启动一次只读验证；客户端 anon key 不满足仓储迁移条件。
4. 确认三个表 `auto_listing_jobs`、`stock_queue_jobs`、`pipeline_runs` 存在，且 RLS 已启用。应用只通过 service-role 服务端客户端访问这些表。
5. 设置 `OZON_REQUIRE_DURABLE_STORAGE=1`，再运行 `scripts/ops.ps1 start`。缺少数据库配置时脚本和服务端都应拒绝启动。
6. `scripts/ops.ps1 start` 只有在 `src/server.js` 进程仍存活且 5178 端口处于监听状态时才会报告启动成功；否则会在短暂重试后失败，避免把已退出的隐藏子进程误报为已启动。

## 高风险直通写入

- 只有在明确需要时设置 `ENABLE_DIRECT_OZON_WRITES=1`；除此之外保持默认关闭。
- 启用后，除普通 `OZON_ERP_AUTH_SECRET`/会话外，还必须配置独立的 `OZON_ERP_ADMIN_SECRET`，并通过 `X-Ozon-ERP-Admin` 传入；两者不要复用，也不要写入前端或仓储文件。
- 缺少管理员密钥时直通写入会在服务端以 `503/ADMIN_AUTH_NOT_CONFIGURED` 阻断；`scripts/ops.ps1 start` 也会在启动前拦截（不论 loopback 还是外部监听），避免隐藏进程启动后立即退出；外部监听同时还要求普通认证。该门是部署级高风险权限边界，不等于完整用户/RBAC。

## 最小会话角色/店铺边界（非完整 RBAC）

- 外部部署可配置 `OZON_ERP_AUTH_ROLE=viewer|operator|admin`、`OZON_ERP_AUTH_STORE_IDS=store-a,store-b` 和可选 `OZON_ERP_AUTH_PRINCIPAL_ID`；会话 token 只携带签名后的角色与店铺范围，不携带 API 密钥。
- 会话 v3 还携带 `jti`、`iat` 和 `OZON_ERP_AUTH_SESSION_EPOCH`。退出会话会同时撤销 Cookie 与 Bearer Token；修改 epoch 会批量使已签发会话失效。当前撤销表是单进程、有上限且只存哈希，不能替代多实例共享撤销存储；生产多实例必须在所有实例同步 epoch，并将撤销状态迁移到共享持久化边界。
- 因为当前代码尚未接入共享撤销后端，生产预检对外部部署会要求显式配置 `OZON_ERP_AUTH_SINGLE_INSTANCE=1`；未声明时返回 `auth_revocation_shared_state_unconfigured` 并 fail-closed。这个变量只声明部署拓扑，不把进程内撤销表伪装成集群能力；真正多实例部署必须先实现并验证共享 epoch/撤销存储，再移除该阻断。
- 启用 `OZON_ERP_REQUIRE_PRINCIPAL_SCOPE=1` 时，外部启动必须配置会话店铺范围；缺少范围或请求不在范围内会 fail-closed（`PRINCIPAL_STORE_SCOPE_REQUIRED`/`PRINCIPAL_STORE_ACCESS_DENIED`）。部署 allowlist 仍会继续检查。
- 生产预检还要求 principal 店铺范围完全落在 `OZON_ERP_ALLOWED_STORE_IDS`（或兼容 `OZON_ERP_STORE_IDS`）内；两者虽都非空但存在越界店铺时返回 `principal_store_scope_outside_deployment_scope`，不会误报生产就绪。
- 店铺选择接口同样执行 principal 店铺范围过滤：受限会话只能看到声明的店铺；要求 principal scope 但会话没有店铺声明时，`/api/stores` 直接拒绝，不会因为省略 `storeId` 而返回全部 canonical 店铺。
- 外部直通写入除管理员密钥外还要求会话角色为 `admin`；回环开发请求保持本地兼容。该机制是最小 claim 边界，不代表用户目录、登录、角色管理、密钥轮换或完整 RBAC 已完成。

迁移代码使用 JSONB payload，允许先从本地 JSON fallback 逐表迁移；首次读取会执行幂等 upsert，并在 `data/migration-state.json` 记录完成标记。进入 Supabase upsert 前，JobRepository 会把 `created_at/updated_at` 归一化为 ISO 时间，并拒绝无法解析或 `updated_at` 早于 `created_at` 的行，避免任务排序和恢复时序被坏数据污染。迁移状态文件不是数据库迁移版本表，正式部署仍应由 Supabase/CI 的 migration runner 管理 SQL 版本。状态文件必须是 `schemaVersion=1` 且 `done` 为对象；损坏、旧版本或未知版本会 fail-closed，不会把 fallback/空状态误报为已迁移。

迁移 dry-run 通过后才允许安排应用写入，但它仍不保证跨表原子性：当前客户端逐表执行 upsert，数据库连接、迁移 runner 和备份恢复必须由部署流程提供。迁移状态读改写使用 `migration-state.json.lock` 的跨进程锁，锁超时或状态损坏会 fail-closed；它只避免并发状态覆盖，不把三张表包装成一个事务。应用迁移不会主动删除目标表中的旧行，删除/重建只能由明确的数据库迁移方案执行。

`scripts/migration-check.mjs` 还要求核心 SQL 包含明确的 `ozon-erp-migration: 20260715_001_core_job_storage schema=1` 标记；缺失或未知版本即失败。静态检查只证明文件安全性和版本可识别，不证明目标数据库已经执行迁移。

## 恢复演练

- 可重复的本地演练：运行 `npm run recovery-rehearsal`。命令会在系统临时目录创建最小三表 fixture 及 `.bak`，先验证三表成功路径，再注入 `stock_queue_jobs` 中途失败并检查已应用表的逆序恢复动作；输出仅包含表名、状态和边界标记，演练结束自动清理临时目录。
- CI 可重复门禁：运行 `npm run recovery-ci-gate`。该包装器会清理可能存在的 Ozon、Supabase、数据库、Redis 和 OSS 环境变量，只接受本地临时 fixture、`databaseObserved=false`、`networkAccessed=false`、`writesExecuted=false`、`deploymentReady=false` 的演练回执；`.github/workflows/recovery-rehearsal.yml` 在相关迁移/恢复文件变更时执行同一门禁。它不连接真实数据库、不联网，也不把本地演练升级为生产恢复证据。
- 该命令的成功只表示 `locally_tested`；输出固定标记 `databaseObserved:false`、`networkAccessed:false`、`writesExecuted:false`、`deploymentReady:false`。它不能替代隔离数据库的真实迁移/恢复回放，也不会读取或覆盖项目 `data/` 中的业务快照。
- JSON fallback：先复制目标文件和 `${file}.bak` 到隔离临时目录，验证备份 JSON 可解析，再显式调用 `restoreJsonFile(filePath)`；不会因读取损坏文件而自动覆盖当前证据。
- `write-command` 命令仓储每次原子替换前会保留上一份 `${file}.bak`；可将该备份交给 `scripts/recovery-drill.mjs` 做隔离校验，不会直接覆盖在线命令状态。
- `node scripts/recovery-drill.mjs <json-file>` 在备份缺失或不可解析时返回非零退出码；可安全接入 CI/部署门，但仍只校验备份证据，不执行恢复覆盖。
- 数据库：先在 Supabase 创建隔离项目或备份恢复分支，再验证三张表的行数、`updated_at` 顺序和 payload schema；不要直接对生产表做 destructive delete 测试。
- 恢复后重新运行预检、幂等命令回查和库存证据回查。未知 Ozon 写入结果必须保持 `needs_review`，不能因为恢复而自动重放。
- `recovery-drill` 只接受可解析备份并在隔离临时目录核对哈希；它不把任意 JSON 解析成功当作业务 schema 已恢复，也不覆盖在线文件。业务恢复后仍需执行对应仓储 schema/版本检查。

可在部署前运行 `npm run migration-state-check [state-file]` 做只读状态审计。它要求 `schemaVersion=1` 且 `done` 中包含三个核心表的可解析时间戳；缺失、部分完成或损坏状态均返回非零并保持阻塞。该命令不连接数据库、不写回状态，也不能替代目标库逐表存在性检查。

## 当前未完成

- CI 目前只验证本地模拟的安全边界；尚未执行 Supabase migration runner、备份保留策略和隔离数据库的实际恢复演练。`npm run recovery-rehearsal`/`npm run recovery-ci-gate` 不能升级为生产恢复证据。
- 尚未证明数据库连接健康、跨区域灾备或队列消费者故障转移。
- 多实例健康摘要缺少 release 证据时保持未就绪，即使 `APP_RELEASE` 未配置也不会用“没有预期版本”绕过证据门；未知/空实例清单同样保持失败。
- 因此路线图验证等级仍是 `locally_tested`，不能称为生产 ERP。

## 部署预检的生产配置门

`npm run deployment-preflight` 使用严格生产 profile，即使在开发机回环执行也不会把本地 JSON fallback 当成生产就绪。它会同时阻断：缺少迁移目标 `DATABASE_URL`、缺少实际运行时 Supabase service-role 后端、缺少 ERP 会话认证、缺少部署店铺 allowlist、缺少 principal 店铺范围，以及三张核心表缺少可解析且通过同等 schema 校验的 `.bak`。`DATABASE_URL` 只声明迁移目标，当前 JobRepository 仍必须配置 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`；预检仍不连接数据库、不执行迁移、不写文件，也不等于真实 RBAC 或恢复已经验证。

系统配置页的 `/api/system/deployment-preflight` 与该 CLI 门禁同步检查部署目录剩余空间；`LOW_DISK_SPACE` 会进入阻断列表，并展示当前/最低字节数和“先释放或扩容磁盘”的动作。页面与命令均不会自动清理缓存或删除业务数据。

四店铺受控只读计划应先运行 `node scripts/read-operator-matrix.mjs --environment <env> --session-proof <proof.json>`。该入口只读取 canonical `D:\Desktop\api\ozonapi.txt` 和本地 proof，要求四个 primary 店铺逐一覆盖、session proof 标记为服务端验证的 `session_cookie`/`session_bearer`、环境一致且 session 店铺范围完整；缺少任一项时以 `READ_OPERATOR_SIGNED_SESSION_REQUIRED`、`READ_OPERATOR_SESSION_ENVIRONMENT_MISMATCH` 或 `READ_OPERATOR_SESSION_SCOPE_REQUIRED` 阻断，永远不会启动 Ozon transport。proof 只应包含短期会话验证摘要（不放 Token/API key），服务端可通过受保护的 `GET /api/auth/session-proof` 返回该摘要；loopback/static secret 会被拒绝。示例见 `docs/examples/read-operator-session-proof.example.json`（其中店铺 ID 是占位符，不能直接用于读取）。`scripts/controlled-read.mjs` 现为 plan-only，即使传入 `--execute-live` 也返回 `READ_OPERATOR_SERVER_EXECUTION_REQUIRED`，真实执行唯一转到已认证的 `/api/ozon/read-operator/execute`；输出仍是 `configuration_declared`，不是 `server_observed` 回执。

此外，生产迁移契约还要求显式绑定当前已审计版本：`OZON_ERP_MIGRATION_ID=20260715_001_core_job_storage`、`OZON_ERP_MIGRATION_SCHEMA=1`。备份回执必须以 `20260715_001_core_job_storage@schema=1@` 开头，再接外部记录引用；这样不能用另一套 schema 的回执误通过当前迁移预检。契约还要求 `OZON_ERP_MIGRATION_TRANSACTION=single-transaction`、`OZON_ERP_MIGRATION_BACKUP_EVIDENCE=isolated-verified`。这些只是部署方提供的事务 runner/隔离备份记录引用，预检不会连接数据库、验证回执或把声明升级为 `deploymentReady`；缺失或版本不匹配时仍 fail-closed。应用自身逐表 upsert 不能满足 single-transaction 声明，必须由 Supabase/CI migration runner 执行并保留外部记录。

`scripts/ops.ps1 start` 与运行时使用同一实际后端门：当前 JobRepository 只支持带主机的 `https:` Supabase URL 且同时存在 service-role key。`DATABASE_URL` 仍可用于迁移目标声明，但单独配置它不会让运行时脱离 JSON fallback。配置缺失会在创建隐藏进程前给出明确阻塞，而不是等待 liveness 超时后显示成泛化的启动失败。

外部生产预检还要求显式设置 `OZON_ERP_TLS_TERMINATED=1`（或兼容别名 `OZON_ERP_HTTPS_LISTENER=1`），声明 HTTPS 已在应用或可信反向代理终止。请求级 HTTPS 拦截仍会拒绝明文请求；这个静态声明只证明部署方已经配置了传输层边界，不连接代理、不探测公网，也不替代真实 TLS/证书演练。缺少声明时 `deployment-preflight` 返回 `external_https_required_but_unconfigured` 并阻断。
