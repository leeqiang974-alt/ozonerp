# Ozon 自动流稳定运行 SOP（含自愈策略）

## 1) 启动前检查（必须）

1. 停止旧进程，避免双实例冲突  
   `powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 stop`
2. 检查状态  
   `powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 status`
3. 确认关键文件可读  
   - `data/auto-listing-jobs.json`
   - `data/stock-queue.json`
   - `data/daily-distributor-state.json`
4. 确认店铺配置、API Key、仓库可用。

## 2) 标准启动顺序

1. 启动服务与分发器  
   `powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 start`
2. 观察 3 分钟，确认：
   - `running` 有值（>=1）
   - `auto-list-jobs` 接口返回 200
   - 无持续 JSON 解析错误

## 3) 运行中监控指标（每 10 分钟）

- 任务：`running / ready_for_listing / listed`
- 失败 Top3（按出现次数）
- 库存队列：`pending / success / failed`
- 关键告警：
  - `Unexpected end of JSON input`
  - `EPERM/ENOENT rename ...auto-listing-jobs.json`
  - `任务超时自动回收`

## 4) 自愈策略表（出现即执行）

### A. `running=0` 且 15 分钟无新任务

动作：
1. 查是否有 `excluded=false && status=detailed` 的 Ozon 机会项。
2. 查分发器是否单实例运行。
3. 重启分发器（不重启全局）：
   - `ops.ps1 stop`
   - `ops.ps1 start`

### B. JSON 读写异常（`Unexpected end of JSON input`）

动作：
1. 先停进程：`ops.ps1 stop`
2. 修复损坏 JSON（保留有效结构）
3. 再启动：`ops.ps1 start`

说明：当前代码已做串行写、唯一临时文件、重试、BOM兼容；若再次出现，优先判断是否有外部脚本并发改写同一文件。

### C. 任务长期卡住（超时回收频发）

动作：
1. 检查 1688 采集任务是否回流候选数据。
2. 降低并发（建议先 `OZON_MAX_CONCURRENT_JOBS=3~5`）。
3. 对失败机会开启有限重试（当前默认每天最多 3 次/机会）。

### D. 上架失败（类目/型号/尺重/品牌）

动作：
1. 优先修规则再重试，不在同一条 SKU 无限重放。
2. 固化规则：
   - 品牌默认：`Нет бренда`
   - 原产国默认：`Китай/中国`
   - 型号必填：自动填充 `modelName + parentSku`
   - 尺重异常：切安全尺重重试

### E. 库存失败（仓库状态/未创建）

动作：
1. 延迟 5 分钟后再写库存（已实现）。
2. 校验仓库状态（非归档、可写）。
3. 若 `WAREHOUSE_WRONG_STATUS`，切换到当前可用仓库 ID 再补写。

## 5) 配置建议（先稳再快）

- `OZON_MAX_CONCURRENT_JOBS=4`
- `OZON_DISTRIBUTOR_LOOP_MS=15000`
- `OZON_MAX_RETRY_PER_OPPORTUNITY_PER_DAY=3`
- `OZON_JOB_STALE_TIMEOUT_MS=1800000`

## 6) 每日复盘模板（建议）

1. 今日成功上架数（按店铺）
2. 失败前三原因及修复动作
3. 规则新增/修订项（型号、类目、尺重、富内容）
4. 明日参数调整（并发、重试、阈值）

---

## 快速命令

- 查看状态：  
  `powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 status`
- 启动：  
  `powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 start`
- 停止：  
  `powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 stop`

