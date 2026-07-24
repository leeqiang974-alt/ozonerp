# Ozon ERP 产品与交付路线图

> 当前派工以 `docs/TOP-LEVEL-DEVELOPMENT-PLAN.zh-CN.md` 为准。本文件记录已交付内容和验证等级，不再从历史条目反向领取开发任务。G1、G2、G3 已完成；当前唯一切片：G4-S1 当前真实商品一键处理到强预检；G4 MVP 通过前冻结 FBS、活动、财务和售后扩建。

> 2026-07-24 G4-S1 包装证据与定价同源修复：真实商品页面展示 1688 快照尺重 `50g / 10×10×10mm`，但持久化定价预览此前把它加缓冲并抬到 `120g / 60×50×30mm`，仍错误标为 `1688_package`。现已移除定价/Payload 的尺重 padding、minimum clamp，来源快照和绑定手工实测按原值进入父商品、变体和定价诊断；有完整父级包装证据时，未经同一证据核验的 SKU 尺重不能覆盖父级值。Ozon 返回尺重错误时，常规重试和两个后台纠偏入口均不再改值或自动重投，只能回到当前商品补充可信证据后重新确认。当前真实商品按 2.2 CNY 采集价与 50g/10mm 原始包装重新试算为 22.45 CNY（利润仍因佣金/结算证据不足保持未知），浏览器运行态已核对同一结果和唯一动作“自动完成其余资料”。定向 119/119、全量 1322/1322、lint 76 files、offline acceptance 通过；独立审查提出的 Critical/Important 旁路已修复，未调用付费 AI、未执行 Ozon 写入。G4-S1 仍为 `CURRENT`，唯一下一入口不变。

> 2026-07-24 G4-S1 第一批实现已完成：商品页“一次授权后自动完成”现在把付费 AI 确认绑定到精确 `workflowRunId + autoListingJobId + captureId + storeId + sourceSnapshotHash`，服务端在调用 AI 前、实际 auto-listing job 的模型调用前及链路每个阶段重校验；缺少授权、工作流暂停/等待人工或上下文变化时 fail-closed。模型返回后会再次复核实际 job，并在持久化时执行绑定 CAS；匹配候选自身也必须以 crawler 持久化外层 `captureId + storeId` 和当前来源 `sourceSnapshotHash` 与授权全量一致，同 candidate ID 的新快照、缺失外层范围或 parsed 范围冲突都要求重新授权，不能继承旧来源证据。Payload 刷新失败不会预检旧草稿；`completed` 只在强预检 `validation.ok=true` 且当前 `payloadDraftHash` 与验证哈希完全一致时成立，始终返回 `submittedToOzon=false`。旧工作流控制台不再给付费节点展示无授权“从此继续”。独立复核结论 Ready；定向 377/377、全量 1319/1319、lint 76 files、offline acceptance 与 5178 浏览器页面检查通过；未确认付费 AI、未调用 AI、未执行 Ozon 写入。G4-S1 仍为 `CURRENT`，下一唯一验证入口是用户针对当前真实商品明确确认一次 AI 调用后，记录真实链路到强预检的结果。

> 2026-07-24 G3-S1 真实当前店铺类目证据闭环完成：signed session 绑定 `local-read-2026-07-24 / 3815760-4`，真实读取 `17027899:87458886` tree、40 个属性和必填字典 `85/8229/9163`；品牌 71,757 项按 `last_value_id` 完成 36 页，其余各 1 页，全部完整。最终成功回执 `read-operator:4929ef94-93f5-46c6-bfdb-b5746ccc5371` 已持久化，且 tree/attributes/字典证据全部绑定同一个 signed-session `readReceiptId/sessionRefHash`。缓存升级晚于回执持久化；异常 `has_next`、非法字典值、游标倒退、慢旧请求和 legacy 字典写入均 fail-closed。当前店铺/当前类目精简缓存约 8.94MB。真实 capture `c1784812672342zraqu` 商品页显示“胸针 / 自动匹配，不需要你操作”、9 个 SKU 价格、50g/10×10×10mm 与售价 25.37 CNY 自动带入。安全边界定向 343/343、全量 1305/1305、lint 76 files、runtime 浏览器 smoke 与 offline acceptance 通过；真实网络仅 Seller API 白名单只读，未调用付费 AI、未执行 Ozon 写入。G3 退出，唯一下一入口为 G4-S1。

> 2026-07-24 G3-S1 当前店铺类目两阶段自动读取：修复旧流程必须先从跨店铺缓存知道 attribute IDs，以及字典响应 `status=completed` 被聚合成失败的断点。商品页一次“自动完成商品资料”现在先提交绑定当前 store/environment/category/type 的 metadata 只读计划，服务端从本次 attributes 回执推导必填且有字典的属性 ID，再返回 hash 绑定的 complete 续读计划并自动读取字典；页面渲染不再自行发起 Seller API 请求。metadata 只负责发现且不落缓存；complete 仅在 tree、attributes、全部必填字典和属性范围同时通过时原子提交整组证据。payload 只消费 store/environment/cacheKey/paginationComplete 全匹配的字典，两次读取间范围变化以 `CATEGORY_READ_ATTRIBUTE_SCOPE_CHANGED` fail-closed，`has_next=true` 仍保持 partial；商品、店铺或环境在链路中切换会停止后续 AI/预检。独立复审关闭缓存拼接、并发覆盖、跨环境继续和分页证据漏存后给出 `Ready: Yes`。5178 已重启；本地真实 scope `3815760-4 / 17027899:87458886` 的计划生成 2 个 metadata 请求，执行因缺 signed session 在调用 Seller API 前返回 403 `READ_OPERATOR_SESSION_REQUIRED`。定向 519/519、全量 `npm test` 1294/1294、lint 76 files、runtime smoke、offline acceptance 通过；验证等级仍为 locally tested，未调用 Seller API、未执行 Ozon 写入。G3-S1 仍需 signed session 下真实 server-observed 回执才能退出。

> 2026-07-24 G2-S1 采集证据直接驱动自动定价：纠正真实商品已在 1688 插件采集 SKU 价格并填写包装尺重，ERP 却再次要求供应商、采购价和包装输入且不启动定价的问题。当前快照精确绑定、带稳定 source SKU ID 的详情 SKU 正价格会按来源 SKU 去重并直接作为本地采购价证据；精确绑定且四项数值一致的 `capture_hint/page_content/1688_package` 包装证据会自动复用，未绑定搜索价格或陈旧尺重仍阻塞。capture 交接立即生成本地定价预览，默认佣金下利润保持未知，不触发 Ozon 写入；预览同时落入 workflow handoff，前端即使 job 列表暂未加载也不会回退成“尚未定价”。独立复核后封死新 capture 缺 package field 走旧 URL 回退、snapshot 更新残留旧采购价、定价诊断未进入可重放强预检策略三处风险。真实 Offer `993570366569` 浏览器显示 9 个 SKU 价格 2.2–2.2 CNY、包装 50g / 10×10×10mm、售价本地试算 25.37 CNY、利润未知，且没有供应商/采购/包装二次输入和控制台错误。安全边界定向 322/322、全量 `npm test` 1288/1288、lint 76 files、offline acceptance 通过；未点击付费 AI，未执行 Seller API/Ozon 写入。

> 2026-07-23 G2-S1 1688 插件收件箱：针对“1688 采集 tab 无法由普通人操作”的纠正，把 11,762px 的采集实验室收口为插件连接、三步采集说明、当前真实商品和唯一下一步；fixture、反向链路、crawler/API、源码、候选配置、任务与历史全部保留在原生 `<details>` 但默认折叠，且不依赖 `:has()`。真实 Offer `992997159052` 在首屏显示 `xymallc`、9 个唯一规格、28 张图片，“完善商品资料”一键进入精确店铺 `3815760-4` 的商品单；顶部刷新复用只读采集箱链并返回商品数。普通页浏览器高度 912px，高级区主动展开后 11,869px、关闭后恢复；前端静态 314/314、全量 1275/1275、lint 76 files、offline acceptance 通过。未调用付费 AI、Seller API 或 Ozon 写入。

> 2026-07-23 G2-S1 一次点击自动处理到预检：纠正“只是把人工流程藏起来”的问题。商品页不再分别提供类目同步、AI 文案、草稿刷新和预检动作，而是由一次“自动完成商品资料（含 AI）”明确授权后连续执行：等待当前店铺类目证据、从 `content_generate` 进入受控链、刷新本地草稿并自动预检；受控链没有 Ozon 提交。运行前不展示采购/尺重/手工文案表单，运行后只展开来源没有且系统不能可靠推断的真实数据；预检通过后只保留最终提交确认。类目同步增加同 scope Promise 合并，自动动作增加 job 全局锁与 capture/store/run/job 绑定，类目失败或切换商品时会在 AI 前停止；只有链路到达预检且草稿/验证 hash 一致才宣称通过。真实 Offer `992997159052` 浏览器只读验证按钮启用、旧逐项 AI 按钮消失、运行前人工表单隐藏；定向 319/319、全量 1274/1274、lint 76 files、offline acceptance 和独立复核通过。未点击付费 AI，未执行 Seller API/Ozon 写入。

> 2026-07-23 G2-S1 单商品编辑单与自动处理界面：根据“能自动匹配就匹配、稳定值直接固定、AI 一键处理、只把无法判断的内容留给人”的纠正，把当前商品页从状态卡/流程解释墙收口为一张商品编辑单。俄罗斯站点、俄语、克、毫米等稳定默认值直接应用；高置信类目、SKU、图片、尺重、文案和价格结果进入自动填写区；AI 文案只有在用户明确点击后才调用现有模型接口并保存本地草稿；无法确定的采购、测量、歧义或预检问题集中展示，证据/workflow/JSON/回执折叠。修复从首页进入草稿时的店铺串区，并把 18 条原始 SKU 行按 source SKU ID 显示为 9 个唯一规格。真实 Offer `992997159052` 浏览器验证：自动切到 `xymallc - 3815760`，类目“胸针”，9 个规格、28 张采集图、Parent SKU `SKUlq00005`，AI 按钮可用，主动作“补齐采购成本”。定向 333/333、全量 1274/1274、lint 76 files、offline acceptance 通过；未点击 AI、未联网、未连接数据库、未提交 Ozon。

> 2026-07-23 G2-S1 高置信类目自动匹配：针对真实 Offer `992997159052` 的“尚未确认类目”，定位到本地 7422 type 缓存已存在正确类目但旧算法只命中宽泛“饰品”，且缓存绑定店铺 `3770019-3`、当前商品绑定 `3815760-4`。匹配器新增胸针/徽章核心商品意图、错误装饰/文具类目降权、分差与 `autoSelectable` 门；真实回放自动选择 `小百货和配饰 / 服装首饰 / 胸针`（`17027899/87458886`，420 分，领先徽章 50 分）。capture handoff 持久化 `categoryDecision/autoCategory`：唯一高置信候选自动绑定；候选接近才要求一次确认；跨店铺缓存只作为候选，前端后台自动刷新当前店铺类目树及精确类目属性只读证据并复用同一 workflow，证据必须同时匹配店铺、环境和 `description_category_id:type_id` 才能就绪；已有卖家类目选择始终优先，自动重跑不能覆盖，后续匹配变为歧义/无候选时会清除旧自动类目。卖家卡不再笼统显示“尚未确认”，而是显示自动推荐、歧义或证据同步状态；同步失败按 5 分钟退避后允许重试。定向 332/332、全量 `npm test` 1273/1273、lint 76 files、offline acceptance 通过；真实回放仅更新本地 job/workflow，未提交 Ozon、未执行付费模型或库存写入。

> 2026-07-23 G2-S1 零学习成本使用引导：针对“仍不知道 ERP 怎么使用”的反馈，首页不再假设用户理解模块、草稿或检查流程。首屏明确分开“你只负责：选商品、确认必要资料、最后决定是否上架”和“系统/AI 负责：整理现有资料、检查风险；付费生成需另行授权”；当前唯一动作按状态同时解释现在具体做什么、点击后系统做什么、何时才会真实提交或产生费用。确认商品、建立/恢复草稿和打开已有 workflow 均先切换到 capture 精确店铺；新版/旧版来源记录共用同一确认入口，确认框不暴露 snapshot/hash。真实 Offer `992997159052` 的“完善商品资料”已在浏览器实测直接进入精确 workflow `wr_mrwy5u1frz3nr`，不再要求去采集箱寻找第二个控件。前端静态 311/311、全量 `npm test` 1268/1268、lint 76 files、offline acceptance 通过，最终独立复审无 Critical/Important；无联网、数据库、付费模型或 Ozon 写入。

> 2026-07-23 G2-S1 商品工作台视觉系统重做：针对“像廉价内部后台”的真实反馈，保留三步业务逻辑和全部 fail-closed 安全门，重做品牌、浅色侧栏、SVG 导航图标、状态条、商品主卡、单一行动区、三段状态块、处理结果和响应式布局；主卡直接使用当前采集商品的首张 http(s) 图片，非 http(s) URL fail-closed，属性转义且不发送 referrer。修复窄屏侧栏参与文档流导致的 743px 顶部空白，并统一 901–1023px 的 sidebar/main/global-task-bar/padding 级联；浏览器逐一验证默认桌面、960×900 非首页、768×900 与 390×844。前端静态 308/308、全量 `npm test` 1265/1265、lint 76 files、offline acceptance 通过，最终独立复审无 Critical/Important；无 Seller API、数据库、付费模型或 Ozon 写入。

> 2026-07-23 G2-S1 卖家界面第二轮减法：根据真实使用反馈，将首屏从 5 个内部节点压缩为“采集商品—检查商品—确认上架”3 个卖家步骤；snapshot、workflow、preflight、Fixture、证据绑定和 AI 推理过程继续保留在内部安全层/高级诊断，普通界面只显示处理结果、必须人工决定的异常和一个主动作。首页隐藏重复的全局任务按钮，离开首页后才显示该快捷入口。浏览器观察到真实商品 Offer `992997159052` 已进入“检查商品”，显示 9 个规格、28 张图片，不自动上架。前端静态 307/307、全量 `npm test` 1264/1264、lint 76 files、offline acceptance 通过；新增可执行测试覆盖有效待确认、已建立草稿、草稿 hash 过期和检查通过状态，阻止内部工作流原文透传，并确保旧检查结果不能显示“确认上架”；最终独立复审无 Critical/Important；无网络、数据库或 Ozon 写入。

> 2026-07-23 G2-S1 当前商品工作台重构：基于 Ozon 官方文档、Shopify Polaris 和 Vendure/Ozon 开源后台实际代码，将卖家首屏收口为一个真实商品、5 步进度、系统已完成和一个安全动作；经营驾驶舱、完整编辑表、规则池与历史诊断默认折叠。工作台、全局任务条、商品草稿页和高级工作流动作统一按真实 `captureId + storeId` 精确匹配非 synthetic workflow；缺少 capture、无效 snapshot、未人工确认或绑定不匹配全部 fail-closed，禁止 Fixture/最近历史任务回退及提交。浏览器已验证 Offer `992997159052` 显示 9 个唯一 SKU、28 张图片；“去核对并确认”自动切换 xymallc 并永久高亮目标行，未点击人工确认。前端静态 305/305、全量 `npm test` 1262/1262、lint 76 files、runtime smoke、offline acceptance 通过；无网络、数据库或 Ozon 写入，G2-S1 仍等待真实人工快照回执。

> 2026-07-23 G2-S1 前端人工确认阻断解除：日常导航由 13 个同级模块收口为工作台、1688 采集、商品草稿、商品状态、订单履约 5 个入口，其余能力进入“更多功能”。全局当前商品条优先选择真实 capture，准确显示 `c178476424685142rv6`，一键切换到店铺 `3815760-4` 并定位目标行；采集 URL 截断，操作列固定，确认按钮无需横向查找。803 条 fixture workflow 默认隐藏且不进入卖家统计，诊断页高度由约 220,449px 降至 654px。浏览器验证五个主线入口、固定任务条、目标按钮和零控制台错误；`npm test` 1256/1256、lint 76 files 通过。未点击人工确认、未调用 Seller API、未执行 Ozon 写入；G2-S1 仍等待该真实快照确认回执。

> 2026-07-23 G2-S1 本地草稿骨架已实现、等待真实人工确认：同一 capture/store 只创建或复用一个 auto-listing job 与 workflow；真实样本的 18 行 SKU 采集结果会归一化为 9 个唯一来源 SKU，并保留原始/唯一/重复计数。草稿骨架集中列出来源 SKU、供应商、采购、可信包装尺重、媒体、俄文内容和类目阻塞；确认快照后界面自动进入当前商品和唯一下一步。并发 8 次仍只有 1 个 job/1 个 workflow，跨快照刷新与缺少来源 SKU ID 都安全阻断。`npm test` 1253/1253、lint 76 files、loopback runtime smoke、offline acceptance 通过；未联网、未连接数据库、未调用 Seller API、付费模型或 Ozon 写入。验证等级 `locally_tested`；仍需用户对真实 capture `c178476424685142rv6` 点击一次“确认当前快照”，形成真实草稿回执后才能完成 G2-S1。

> 2026-07-23 G1-S3 首个真实 1688 商品回放完成：Chrome 扩展成功采集真实 Offer `992997159052` 到店铺 `3815760-4`，复用持久化 ID `c178476424685142rv6`；回执包含 18 行 SKU 采集结果（归一化后为 9 个唯一来源 SKU）、28 张图片、19 个属性和 `ok` 快照，同店同 Offer 仍只有 1 条记录，界面明确返回“已采集过”，重复导入去重成立。供应商身份及采购 MOQ/阶梯价保持 `needs_review` 并给出补齐后重采动作，未伪造可信证据。全量 `npm test` 1247/1247、lint 76 files、runtime smoke 和 offline acceptance 通过；`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。G1 验证等级升级为真实扩展采集已验证；当前唯一入口转为 G2-S1 唯一本地草稿骨架。

> 2026-07-23 G1-S3 扩展来源白名单修复：真实插件请求已从消息传输层推进到 ERP，并以 `CORS_ORIGIN_DENIED` 精确暴露服务端遗漏 `chrome-extension://<id>` 来源。新增独立 CORS 策略：仅当 ERP 绑定 `127.0.0.1/localhost/::1` 时允许格式合法的 32 位 Chrome 扩展来源；外部绑定、畸形扩展 ID 与普通网站来源继续拒绝，显式部署白名单保持不变。定向 CORS/扩展/服务端 170/170，全量 `npm test` `1247/1247`、lint 76 files 通过；重启本地 ERP 后，真实 HTTP 预检返回 204 且回显扩展 Origin，健康接口返回 200。验证等级 `locally_tested`；浏览器自动控制点击被 1688 页面长任务拖至超时，页面仍保留上一次错误文案，尚需用户在已打开页面手动点击一次并完成重复导入，G1-S3 仍未完成。

> 2026-07-23 G1-S3 真实采集传输阻断修复：真实 1688 页面 `992997159052` 的直接本地回放 HTTP 200，证明 ERP 采集端点可用；插件的通用 `Internal server error` 定位为整页 HTML 叠加 SKU/媒体数据经过 `chrome.runtime.sendMessage` 时在 ERP 请求发出前失败。两套详情扩展改为传递绑定最终标题、SKU、图片、属性和尺重的紧凑可回放快照，并在 SKU 筛选/手动尺重后重建；同时清理“阿里巴巴/1688”标题后缀。定向 40/40、全量 `npm test` `1243/1243`、lint 75 files 通过；真实中文标题本地 API 回放 200。验证等级 `locally_tested`；尚需用户重新加载扩展后完成一次真实插件采集与重复导入，G1-S3 仍未完成。

> 2026-07-22 G1-S2 采集导入入口收口：两个 1688 采集弹窗在成功或重复采集后自动打开带 `captureId` 的 ERP 当前商品页，保留手动重开链接；详情扩展把 `collectionId` 与脱敏 `captureReceipt` 回传给弹窗。当前商品页继续显示来源身份、快照、SKU/采购/媒体覆盖、尺重与阻断动作，不生成或提交 Ozon 草稿。定向扩展/前端测试、全量 `npm test` `1240/1240`、lint 75 files、offline acceptance 通过；未联网、未连接数据库、未执行 Ozon 写入。验证等级 `locally_tested`；下一步只做首个真实 1688 商品回放。

> 2026-07-22 G1-S1 采集契约收口：两个 1688 详情扩展、crawler detail 回传和 `/api/1688/capture` 统一到 `manual_capture_v1`；旧扩展缺少版本号时兼容升级，未知版本在解析前阻断；回执同时保留脱敏身份、契约版本和同值快照 hash。定向采集/服务端/扩展 187/187，全量 `npm test` `1240/1240`、lint 75 files、offline acceptance 通过；未联网、未连接数据库、未执行 Ozon 写入。验证等级 `locally_tested`；仍缺一个真实商品回放，下一步进入 G1-S2。

> 2026-07-22 P0 本机恢复后的服务启动收口：补齐 `autoListing.js` 的只读任务快照与媒体批准草稿/发布/回滚持久化契约，修正误放到 FBS 订单读取中的回滚回调，并新增服务导入符号的运行时契约测试。服务真实启动、healthz、前端 runtime smoke、`npm test` `1237/1237`、lint 75 files 和 offline acceptance 均通过；未联网、未连接数据库、未调用 Seller API、未执行 Ozon 写入。验证等级 `locally_tested`；P0 启动阻断已解除，下一步回到 A 线，以真实 1688 快照和受控四店铺 Seller API 只读回放推进黄金链路。

> 2026-07-20 C34 FBS 履约只读恢复收口：续页读取失败保留已读订单并标记 partial，允许按当前范围重试；争议筛选同时识别顶层 status/statusGroup 与 substatus 的 dispute 变体；订单权限/服务失败状态直接显示“重新读取当前范围”按钮；FBS 回执保存先经过签名 Seller 只读会话、principal 店铺范围和显式店铺校验，缺少范围不会读取或持久化回执。C 定向通过，前端静态 295/295，全量 `npm test` `1235/1235`，lint 75 files；离线验收检查通过但 git diff 检查受当前 worktree 元数据损坏影响；未联网、未连接数据库、未执行履约写入。验证等级 `locally_tested`；仍缺真实 FBS 订单/争议回放、履约写动作和写后回读。下一轮转 D。 

> 2026-07-20 B35 商品与库存真实操作闭环收口：库存页“读取库存”按钮补齐受保护事件绑定；切换店铺立即失效商品请求、清空旧店铺 Offer/状态/分页证据，必须重新读取当前店铺；库存 dry-run 入口缺少店铺直接返回 `STOCK_DRY_RUN_STORE_REQUIRED`，不再返回无店铺阻断计划；目标库存与当前精确 tuple 无差异时返回 `DIRECT_WRITE_STOCK_NO_CHANGES`，不调用 Ozon 写接口。定向商品/库存/服务端回归通过，前端静态 291/291，全量 `npm test` `1231/1231`；未联网、未连接数据库、未执行 Ozon 写入。验证等级 `locally_tested`；仍缺四店铺真实 Seller API 商品/库存只读回放和真实写后回读。下一轮转 C。 

> 2026-07-20 A36 黄金链路范围与恢复收口：类目/属性保存要求选中的 workflow 精确存在且草稿店铺等于当前店铺，阻断失效工作流回退到其他商品；人工保存俄文内容、采购或包装资料时若旧草稿未绑定 workflow，不再静默结束，而是明确要求重新交接后预检；商品导入回读缺失已绑定店铺的 `storeId` 时返回 `WORKFLOW_STORE_REQUIRED`，不写审核节点。A 定向回归通过，`npm test` `1228/1228`、`npm run lint` 75 files；未联网、未连接数据库、未执行 Ozon 写入。验证等级 `locally_tested`；仍缺真实 1688 快照、四店铺 Seller API 只读回放和真实提交/审核回读。下一轮转 B。 

> 2026-07-20 E35 生产预检与恢复安全收口：HTTP `/api/system/deployment-preflight` 补齐 CLI 同等的 migration dry-run/recovery drill，页面与命令行不再给出不同部署结论；严格迁移读取遇到缺失源快照直接失败，不会写入“已迁移”标记；系统配置按认证缺失、数据库缺失、内存模式分别给出运维动作。定向 E 线通过，全量 `npm test` `1225/1225`、lint `75 files`；未联网、未连接数据库、未执行迁移或 Ozon 写入。下一轮回到 A，继续黄金链路真实读取前置。

> 2026-07-20 D34 活动、财务与售后用户口径收口：活动商品仅使用明确 `action_price/discount_price`，不再把 `min_price/max_action_price` 边界当活动价；可添加候选明确标记需到 Ozon 活动页人工确认，本页不执行加入。原始 `disputed/dispute_pending/customer_dispute` 状态统一进入售后争议任务；售后风险卡不再回到自身，改为引导订单页查看争议/取消并明确退货/客服动作尚未接入。定向 D 线通过，全量 `npm test` `1223/1223`、lint `75 files`；未联网、未执行活动/财务/售后写入。下一轮转 E。

> 2026-07-20 C33 FBS 详情与回执可解释性收口：FBS 读模型只有在请求带有明确时间/状态/仓库/cursor 等范围时才声明 `requestScoped`，空范围不能保存为可绑定回执；缺少 `posting_number` 的订单不再显示无效详情按钮；详情成功回读后展示 Offer/SKU、数量和商品名称，数量缺失明确标记未知并给出重读动作。定向 C 线通过，全量 `npm test` `1219/1219`、lint `75 files`；未联网、未执行履约写入；下一轮转 D。

> 2026-07-20 B34 商品可售到库存核对可操作性收口：库存页不再预填示例 Offer/库存/仓库数据；商品可售交接后，读取仓库列表会提供“应用到待填写目标”动作，把当前已观测仓库 ID 绑定到已带入的 Offer，卖家只需填写真实目标数量再读取精确证据。库存 dry-run API 强制要求 Seller API 读取环境，缺失返回 `STOCK_DRY_RUN_ENVIRONMENT_REQUIRED`，成功响应回显环境。定向 B 线通过，全量 `npm test` `1219/1219`、lint `75 files`；未联网、未调用真实 Seller API、未执行 Ozon 写入。下一轮转 C。

> 2026-07-20 A35 黄金链路用户操作收口：上架中心的补来源、确认类目、补尺重、修复定价、运行预检和人工确认等主动作现在统一落到“当前商品”工作台，不会打开上架中心却停留在旧阶段；采集箱重复运行预检按 captureId+店铺复用已有本地草稿/工作流，不再制造重复任务。提交回读对旧任务同时使用 `listingResult.storeId` 与 job 根店铺；缺少/失效店铺不再静默跳过，转为 `LISTING_STORE_UNAVAILABLE` 的 `needs_review` 恢复任务。定向黄金链路/前端测试通过，全量 `npm test` `1219/1219`、lint `75 files`；未联网、未调用真实 Seller API、未执行 Ozon 写入。下一轮转 B，继续把库存与商品运营入口做成可操作闭环。

> 2026-07-20 B33 商品/价格/库存证据口径收口：价格读取只有 `current_price/currentPrice/price` 才能作为当前价；仅有 `old_price/min_price/acquiring_price` 等参考字段时保持 partial，不能驱动利润或写入判断。商品列表覆盖未完成、部分或旧批次时，前端售价显示为“未知”，不再把保留数字当当前售价。库存 dry-run 强制绑定 `storeId`，缺少店铺范围直接阻断并不生成可执行计划。定向 B 线通过，未联网、未调用真实 Seller API、未执行 Ozon 写入；下一轮转 C，继续履约只读边界。

> 2026-07-20 A33 采集候选到上传队列的店铺/工作流续接收口：同一 1688 URL 的本地草稿复用现在要求请求店铺与既有草稿严格一致；重复交接按精确 `autoListingJobId/candidateId` 解析 workflow，不回退到无关商品。全量 `npm test` `1197/1197`、lint `75 files`、offline acceptance 通过；未联网或执行 Ozon 写入。下一轮转 B。

> 2026-07-20 B32 上传结果到商品/库存入口收口：商品状态回查不再从 `OZON_ERP_ENVIRONMENT/NODE_ENV` 推断缺失读取环境，必须由请求显式绑定当前环境；库存队列只有 `import-info.status=imported` 且无错误时才允许进入库存写入前流程，带 `product_id` 的 rejected/moderation_failed/未知状态全部阻断；商品列表在 partial/loading/unknown 读取时降级显示，不再沿用旧绿色“在售”状态。定向 B 线通过，全量 `npm test` `1199/1199`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行库存/Ozon 写入。仍缺真实四店铺商品状态/库存只读回放和写后回读；下一轮转 C，保持履约只读边界。

> 2026-07-20 C32 FBS 只读证据和卖家动作一致性收口：矛盾的 `datasetComplete` 声明不会再持久化为完整范围，只有 page 完成、无下一页、无 partial、全部端点成功且无缺失证据时才可标记 complete；当前页无待处理订单但仍有后续分页时，卖家下一步明确继续读取，不再显示“没有待处理”；待备货/待发运文案明确为人工核对且本页不执行履约；货件详情请求/响应绑定 store/environment，跨范围或迟到回执丢弃。定向 C 线通过，全量 `npm test` `1203/1203`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行履约写入。仍缺真实 FBS 订单/争议回放、履约动作和写后回读；下一轮转 D。

> 2026-07-20 D32 活动与经营读模型口径收口：活动列表在 coverage 不完整时不显示确定的参与/候选数量；`action_price` 或当前价为 0 时不生成降幅影响；`cancelled_by_customer`、`dispute_pending` 等取消/争议状态族不计入未经结算确认的销售额。定向 D 线通过，全量测试退出码为 0、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行活动/财务/售后写入。仍缺真实结算/退款、活动完整范围和利润回读；下一轮转 E。

> 2026-07-20 E34 部署预检入口一致性收口：HTTP `/api/system/deployment-preflight` 现在与 CLI 同时检查 canonical 四店铺来源和 Seller API HTML 指纹，并把 `api_evidence` 纳入统一 blockers/`deploymentReady` 结论；检查只读本地元数据，不加载凭据、不连接数据库、不调用 Ozon。定向 E 线通过，全量测试退出码 0、lint `75 files`、offline acceptance 通过；仍缺真实数据库迁移/恢复、部署认证、signed session 和真实 Seller API 回放；下一轮回到 A，继续 1688 黄金链路。

> 2026-07-20 A34 强预检重复校验 1688 canonical 来源身份：卖家编辑草稿后再次预检时，不再仅按 URL 是否包含 `1688.com` 放行；每次都要求严格 `detail.1688.com/offer/<数字>` canonical URL，并核对 URL 中 Offer ID 与 `sourceEvidence.offerId` 一致，冲突返回 `SOURCE_OFFER_URL_MISMATCH`。新增后续预检身份回归；全量测试通过、lint `75 files`、offline acceptance 通过；未联网、未调用模型或执行 Ozon 写入。仍缺真实 1688 快照和 Seller API 类目/属性、提交/审核回读；下一轮转 B。

更新日期：2026-07-22

> 2026-07-20 E33 生产预检、实例健康与观测一致性收口：`/api/system/deployment-preflight` 现在与 CLI 共用严格 `productionDeploymentDecision`，动态返回 checks/`ok`/`deploymentReady`，不再与命令行给出相反结论；实例健康拒绝超过 5 分钟的未来 heartbeat（`INSTANCE_HEARTBEAT_FUTURE`）；系统配置新增服务观测卡，区分未读取、读取失败、高等级告警和一般告警，并明确不等于 Seller API 或业务 readiness。定向 E 线通过，全量 `npm test` `1194/1194`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行写入。真实生产数据库/迁移/备份/认证和 Seller API 回放仍需外部条件；下一轮回到 A。

> 2026-07-20 D31 活动与经营口径收口：活动影响预览不再把 `min_action_price/max_action_price` 区间边界当成实际活动价；财务收入归一化排除 `cancelled/canceled/cancel/dispute/disputed`，并同时检查 `statusGroup/status/status_name`，避免 unknown 分组遮蔽取消/争议；订单仍有分页或缺少分页结束证据时，财务前端明确销售额未知，不能用当前批次代表全店。定向 D 线通过，全量 `npm test` `1192/1192`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行经营写入。仍缺真实结算/退款、活动完整范围和利润回读；下一轮轮转 E。

> 2026-07-20 C31 FBS 只读履约证据收口：订单商品详情匹配不再把 posting 的 `sku` 与 Seller detail 的 `id/product_id` 跨命名空间匹配，碰撞时保持未知并阻断履约判断；FBS 回执统一保留数值/字段形式的 403、429、5xx 语义，卖家下一步分别指向授权、限流等待或同范围重读；订单行前端按争议、详情/数量缺失、截止时间和状态给出明确动作，争议或证据不足时明确不要备货/发运。定向 C 线通过，全量 `npm test` `1188/1188`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行履约写入。仍缺真实 FBS 订单/争议回放、履约写入和写后回读；下一轮转 D。

> 2026-07-20 A32 1688→Ozon 单商品提交前证据闭环：来源快照导入现在校验 canonical URL 中的 Offer 编号与显式 `offerId` 一致，冲突返回 `CAPTURE_OFFER_URL_MISMATCH`；最终上架 preflight 现在接收并检查 `pricingDiagnosis`，手工 MOQ/阶梯价等 `needs_review` 采购证据返回 `PRICING_PROCUREMENT_EVIDENCE_REVIEW_REQUIRED`，不能提交；卖家预检摘要新增媒体证据状态和下一步，明确媒体未上传/未提交。定向黄金链路通过，全量 `npm test` `1184/1184`、lint `75 files`、offline acceptance 通过；未联网、未调用模型或执行 Ozon 写入。仍缺真实 1688 快照、真实 Seller API 类目/属性回执、真实提交/审核回读；下一轮转 C，保持履约只读边界并核对主线影响。

> 2026-07-20 E32 生产化认证、观测与恢复边界收口：session proof 不再把未绑定环境的会话回退到部署环境，必须由 signed session 自身提供 environment；前端测试 API 现在读取脱敏 observability 摘要，高等级错误会显示“API 正常，但服务有错误告警”，不把运行状态冒充业务 readiness；JSON `.bak` 恢复与写入共用文件锁，避免重启恢复覆盖正在切换的备份快照。定向 E 线通过，全量 `npm test` `1181/1181`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。当前部署预检仍明确阻断：缺真实数据库/迁移状态/备份回执、认证环境、店铺 scope 和 signed session；下一轮轮转 A，继续 1688 单商品黄金链路证据。

> 2026-07-20 B31 商品状态→库存入口收口：`/api/ozon/product-stocks` 与前端读取现在绑定当前 store/environment/request token，环境切换或迟到响应不会污染库存页；商品已可售但尚未读取库存的 handoff 不再标成完成，明确库存仍未知、空白不能按 0；库存 server-observed 回执不再信任调用方的 `completeForRequestedIds` 标记，必须逐个验证精确 `(offer_id, warehouse_id)` 和非负当前数量。定向 B 线通过，全量 `npm test` `1179/1179`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。仍缺真实 signed session 下商品状态/库存只读回放与写后回读；下一轮轮转 E，收口生产化真实回放前置条件。

> 2026-07-20 A31 类目读取证据与属性字典范围收口：受控类目树/属性/字典值读取现在持久化通用 server-observed 回执，并绑定当前店铺、environment 与端点范围；`has_next=true` 的属性字典页被标记为 `partial`，不再写入完整缓存且会清除同范围旧完整缓存；旧类目缓存不能跨环境复用；前端属性读取按请求代次、店铺和环境丢弃迟到回执，不会污染当前商品草稿。定向类目/服务端/前端通过，全量 `npm test` `1177/1177`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。仍缺真实 signed session 下的四店铺只读类目回放；下一轮轮转 B，验证属性证据如何驱动商品状态与库存入口。

> 2026-07-20 受控读取执行链收口：`/api/ozon/read-operator/execute` 的持久化成功/失败回执现在绑定 signed session 类别与 scope/environment 哈希，不保存 token/cookie；`taskId` 在计划规范化、绑定和 `/v1/product/import/info` 执行时保持不丢失；完整商品列表/详情 server-observed 回执才触发前端商品状态刷新，部分/失败回执不会覆盖旧状态。全量 `npm test` `1174/1174`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。真实读取仍等待服务端 signed session 和人工确认。

> 2026-07-20 受控真实读取前置契约：四店铺 canonical 来源保持 `4/4`，Seller API HTML 矩阵 `matched`；修复 `/api/auth/session-proof` 缺少 gate 所需 `verified=true` 的契约旁路，审核回查回执补充当前 `storeId/environment` 并丢弃跨店/跨环境迟到响应；按 Seller API HTML 将 `/v1/product/import/info` 纳入受控只读端点，严格使用正整数 `task_id` 请求体并绑定计划 hash。全量 `npm test` `1171/1171`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。当前进程仍无真实 signed session、环境和部署 scope，示例 proof 不能执行；下一步需服务端签发匹配四店铺和同一 environment 的短期 proof 后，逐店执行只读回执。

> 2026-07-20 P0 主链旁路修复：审核回读现在必须绑定受控 signed session、environment、单任务和精确店铺，并把同一环境传入商品状态 adapter；后台 supervisor/定时器不再无会话触发 Seller API。商品总览只有在 `selling/ready_for_sale`、完整且 30 分钟内的 `server_observed` 证据下才显示库存核对；导入 `import-info` 连续超时/5xx 明确保持 `needs_review`（`OZON_IMPORT_INFO_OUTCOME_UNKNOWN`），不会自动重试或排库存写入。相关定向测试 `202/202`、全量 `npm test` `1170/1170`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。验证等级仍为 `locally_tested/mocked`，真实 Seller API 只读回放和真实上架尚未完成；下一步为受控四店铺只读回放，记录真实商品状态/类目属性回执后再推进单商品黄金路径。

> 2026-07-20 D30 前端财务 fallback 与服务端口径统一：旧响应兼容路径现在和服务端一样排除 `cancelled/dispute` 订单，存在取消/争议时销售额保持未知并要求结算/退款回读；活动价仍只是价格影响估算，不生成确定利润。定向财务/前端 `279/279`，全量 `npm test` `1166/1166`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行经营写入。仍缺真实结算、退款、活动完整范围和利润回读；下一轮轮转 E。

> 2026-07-20 C30 FBS 汇总层争议优先级：订单单行任务和页面汇总现在都优先处理 `substatus=dispute`，即使同时临近发运截止也只显示争议人工动作，不引导备货、发运或取消。定向 FBS/前端 `289/289`，全量 `npm test` `1165/1165`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行履约写入。仍缺真实 FBS 订单/争议回放与真实履约写后回读；下一轮轮转 D。

> 2026-07-20 B30 商品可见性纳入库存入口门：商品回读只有在每个 Offer 可售、覆盖完整、时间新鲜、`/v3/product/list` 与 `/v3/product/info/list` 均已尝试且 `visible=true` 时，才可显示“已明确可售”并进入库存核对；`selling + visible=false` 或可见性未知均保持待处理并给出卖家修复动作。定向商品质量/库存/前端 `364/364`，全量 `npm test` `1164/1164`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。仍缺真实商品状态回放、库存读取与写后回读；下一轮轮转 C。

> 2026-07-20 A30 1688 草稿绑定当前店铺类目属性回执：生成 1688→Ozon 草稿时，将当前类目树与精确 `description_category_id:type_id` 属性读取回执、店铺 ID、环境 hash 写入持久化 `preflightPolicy`；后续重新校验/提交前预检若缺回执、店铺或环境绑定，统一返回 `CATEGORY_EVIDENCE_MISSING`，不使用旧缓存冒充当前店铺证据。定向类目/属性/工作流/草稿 `156/156`，全量 `npm test` `1163/1163`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。仍缺真实 Seller API 类目/属性回执、提交/审核回读和库存就绪；下一轮轮转 B。

> 2026-07-20 E31 生产认证环境声明门：生产部署预检现在要求 `OZON_ERP_AUTH_ENVIRONMENT`（或 `OZON_ERP_ENVIRONMENT`），缺失返回 `auth_environment_required`；与 signed-session 必须严格绑定读取环境的规则一致，避免预检通过后真实读取被环境门阻断。定向运行安全/部署/服务端 `30/30`，全量 `npm test` `1162/1162`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。下一轮回到 A，继续黄金链路属性/提交前证据。

> 2026-07-20 D29 取消/争议订单销售额口径门：财务只读模型不再把 `cancelled/dispute` 订单直接累加进销售额；存在此类订单时保持未知并返回 `ORDER_REVENUE_STATUS_UNRESOLVED`，要求回读结算/退款明细后再判断净销售额。定向财务/活动/前端 `278/278`，全量 `npm test` `1161/1161`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行写入。下一轮回到 E，检查生产化证据和部署风险。

> 2026-07-20 C29 FBS 争议状态优先人工处理：`substatus=dispute` 订单现在显式标记为 `statusGroup=dispute` 和“争议”，并优先于仓库/截止时间任务进入人工处理；不引导备货、取消或发运。定向 FBS/前端 `288/288`，全量 `npm test` `1160/1160`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行履约写入。下一轮回到 D，复核活动/财务范围边界。

> 2026-07-20 B29 库存目标空值 fail-closed：库存预演目标现在逐行拒绝空值、负数、小数和非安全整数，空值不会按 0 处理；合法目标先规范化再生成 dry-run，错误动作明确到字段。定向前端/库存 `261/261`，全量 `npm test` `1158/1158`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。下一轮回到 C，检查订单到仓库动作闭环。

> 2026-07-20 E30 只读超时卖家恢复动作：受控 Seller API 读取超时现在单独映射为 `READ_TIMEOUT_RECONCILIATION_REQUIRED`，要求保留同一店铺/环境/范围/操作计划，先核对端点回执，不得用新幂等键重试；不增加自动重试或写入。定向只读运维/回执/服务端 `159/159`，全量 `npm test` `1157/1157`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。下一轮回到 B，检查商品状态到库存对账闭环。

> 2026-07-20 A29 卖家确认类目真正驱动 Payload：修复主链断点，手工确认的 `description_category_id/type_id/path` 现在按当前本地缓存重新绑定并实际生成 payload；不在缓存的选择返回 `LISTING_CATEGORY_NOT_IN_CACHE`，不会静默改用自动匹配。定向类目/服务端 `142/142`，全量 `npm test` `1157/1157`、lint `75 files`、offline acceptance 通过；仍是本地缓存证据，未联网、未连接数据库或执行 Ozon 写入。下一轮回到 E，准备受控 Seller API 读取证据。

> 2026-07-20 C28 FBS 失败场景恢复动作：只读回执保留受限失败场景/原因码，并把权限不足、限流、超时分别映射为重新授权、等待窗口后重读、保留 cursor 重核对等卖家动作；过期证据仍优先阻断，未增加履约写入。定向 FBS `9/9`，全量 `npm test` `1156/1156`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。下一轮回到 A，继续 1688→Ozon 黄金链路。

> 2026-07-20 D28 财务前端未来时间证据门：旧响应兼容的财务 fallback 现在拒绝未来超过 5 分钟的订单 `checkedAt`，返回 `ORDER_READ_TIMESTAMP_INVALID` 并隐藏当前销售额；活动影响仍为 estimate，利润仍要求真实成本/结算证据。定向 `285/285`，全量 `npm test` `1155/1155`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。下一轮回到 C。

> 2026-07-20 B28 商品回读时间戳 fail-closed：商品状态回读现在拒绝无效或未来超过 5 分钟的 `checkedAt`，即使状态为 `selling` 也保持 `pending_moderation`，返回 `timestamp_invalid/READ_EVIDENCE_TIMESTAMP_INVALID`；有效、新鲜、完整的商品列表+详情回读才可进入 `ready_for_sale`，库存仍需单独证据。定向 `501/501`，全量 `npm test` `1155/1155`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。下一轮回到 D。

> 2026-07-20 E29 受控只读 session 环境绑定门：Seller API 读取服务端现在拒绝缺失 environment 声明的 signed session，并要求其与读取计划严格相等，且在解析店铺凭据和调用 Seller API 前执行。定向 `196/196`，全量 `npm test` `1154/1154`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。下一轮回到 B。

> 2026-07-20 A28 1688 来源证据状态门：导入草稿前新增 `sourceEvidence.verificationState === "ok"` 要求；人工确认 hash 不能替代来源证据验证，`waiting_human/unknown/缺失` 均保持 `needs_review`。定向黄金链路 `63/63`，全量 `npm test` `1154/1154`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。下一轮回到 E。

> 2026-07-20 E28 健康检查损坏快照 fail-closed：`health-check` 不再把损坏的本地任务 JSON 当作 0 条任务，而是返回 `HEALTH_STORAGE_CORRUPT` 并失败退出；摘要增加存储状态、`needsReview`、待处理积压、状态计数、原因和下一步。首次运行无快照明确为 `missing`。定向 `3/3`，全量 `npm test` `1153/1153`、lint `75 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。下一轮回到 A。

> 2026-07-20 B27 商品状态时间戳新鲜度门：库存预演现在拒绝无效、未来超过 5 分钟或超过 1 小时的 `checkedAt/statusCheckedAt/status_checked_at`，即使商品状态为 `selling` 也返回 `PRODUCT_NOT_READY`，要求重新读取商品状态；原有精确 Offer×仓库库存、仓库模式、写后回读和人工确认门未放宽。定向 `58/58`，全量 `npm test` `1150/1150`、lint `74 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。下一轮轮转 E。

> 2026-07-20 A27 1688 来源身份门前移到草稿入口：人工确认快照后生成草稿前，必须通过 canonical `detail.1688.com/offer/<数字>` URL 与明确 Offer ID 校验；非 1688 来源或缺失身份分别阻断为 `CAPTURE_SOURCE_URL_INVALID`/`CAPTURE_OFFER_ID_MISSING`，同时保留 SHA-256 人工确认和重复 Offer 门。定向采集/回放/候选/服务端 `197/197`，全量 `npm test` `1149/1149`、lint `74 files`、offline acceptance 通过；未访问 1688、Seller API、数据库或执行写入。下一轮轮转 B。

> 2026-07-20 D27 财务订单证据新鲜度门：财务读模型及前端兼容路径现在要求订单 `checkedAt` 处于默认 1 小时新鲜窗口；时间无效/过期时销售额保持未知并返回 `ORDER_READ_STALE` 或 `ORDER_READ_TIMESTAMP_INVALID` 与重新读取动作。活动价格影响仍仅为 estimate，利润仍等待真实成本/佣金/物流/结算证据。定向 `415/415`，全量 `npm test` `1148/1148`、lint `74 files`、offline acceptance 通过；未联网、未连接数据库或执行 Ozon 写入。下一轮轮转 A，继续黄金链路受控真实证据准备。

> 2026-07-20 C27 FBS v4 回执卖家下一步与验证等级：服务端保存的 FBS 回执增加 `verificationLevel=server_observed`，查询接口按分页 cursor、端点失败和 freshness 输出 `status/stale/nextAction/sideEffect`；前端不再把当前页完成显示成全量履约完成，并明确不会备货、发运、取消或打印标签。定向 `407/407`，全量 `npm test` `1146/1146`、lint `74 files`、offline acceptance 通过；未执行真实 Seller API 或履约写入。下一轮轮转 D 的活动/财务覆盖。

> 2026-07-20 E27 生产预检统一运行时阻断与验证等级：`/api/system/deployment-preflight` 现在同时汇总运行时认证/持久化/店铺范围/HTTPS、迁移状态、生产迁移声明和磁盘空间，前端可按检查项显示具体下一步；接口固定返回 `verificationLevel=configuration_declared` 与 `deploymentReady=false`，不把本地配置检查冒充生产就绪。全量 `npm test` `1144/1144`、lint `74 files`、offline acceptance 通过；未联网、未连接数据库、未执行 Ozon 写入。下一轮轮转 C 的 v4 只读回放与权限回执验收。

> 2026-07-20 A26 受控只读矩阵默认范围收口：CLI 与服务端矩阵不再把需要类目/属性或 FBS 日期的全部端点伪装进 `single_offer` 默认计划；默认只列商品列表和仓库列表，扩展端点必须显式提供范围。服务端同步校验端点契约并返回 `endpointScopeErrors`；新增 deployment-preflight 子进程回归，确认退出码和 `network/database/write=false` fail-closed。定向 read-operator `19/19`、server `140/140`、deployment `4/4`，全量 `1143/1143`、lint `74 files`；未联网、未连接数据库或 Ozon 写入。

> 2026-07-20 P0 1688→Ozon 草稿/回读闭环收口：补回候选/捕获到本地草稿交接、来源快照人工确认、手工证据保存、单/多 SKU 来源绑定、采购/媒体/尺重证据门；提交未知结果保持 `needs_review`，商品状态回读不再直接等同于可售，库存入口继续要求精确 Offer×仓库当前证据。全量 `npm test` `1143/1143`、lint `74 files`、offline acceptance 通过；仅本地/fixture 验证，未联网、未连接数据库、未执行 Ozon 写入。

> 2026-07-20 E26 主链路切片门禁：P0 保存草稿来源身份旁路、首页采集空态和卖家阶段文案修复后，全量 `1142/1142`、lint `74 files`、offline acceptance 通过；`canonical=matched`、Seller HTML 指纹匹配、店铺 `4/4`。仍是 `locally_tested/configuration`，未联网、未连接数据库、未执行 Ozon 写入。

> 2026-07-20 P0 黄金链路旁路修复：保存 1688 商品草稿时，持久化的强预检策略漏写 `sourceIdentityRequired`，导致后续“校验 Payload/提交”可能退回较弱策略。现在保存策略与直接预检一致，缺少 1688 canonical URL 或 Offer ID 会继续生成 `SOURCE_IDENTITY_MISSING` 并阻断；补充 workflow 与服务端静态回归，前端黄金链路空态新增“去采集 1688 商品”入口，普通层把 `source/category` 等内部阶段映射为卖家业务语言。定向 frontend `257/257`、server `140/140`、workflow `117/117`；仍未连接真实 Ozon、数据库或执行写入。

> 2026-07-20 D25 活动证据绑定读取环境：活动列表/商品/候选接口回传环境，前端严格匹配并在环境变化时清空活动和价格影响；定向 `396/396`、全量 `1141/1141`、lint `74 files`，未联网或写入。

> 2026-07-20 C25 受控读取丢弃跨店/跨环境迟到响应：执行结果绑定请求代次、当前店铺和环境，切换上下文会失效旧结果；定向 `394/394`、lint `74 files`，未联网或写入。

> 2026-07-20 B25 写入回读失败时不宣称库存完成：前端要求写后回查成功且 summary=`reconciled`，否则保持待复核；定向 `435/435`、全量 `1138/1138`、lint `74 files`，未联网或写入。

> 2026-07-20 A25 1688 预检强制来源商品身份：强预检要求 1688 canonical URL + Offer ID，缺失生成 `SOURCE_IDENTITY_MISSING` 并阻断提交；定向 `291/291`、全量 `1137/1137`、lint `74 files`，未联网或写入。

> 2026-07-20 E24 全量门禁通过：临时目录切换 D 盘后全量 `1136/1136`、lint `74 files`、offline acceptance 通过；`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`，真实部署/读取仍需授权。

> 2026-07-20 D24 订单与财务摘要绑定读取环境：订单看板回传环境，订单 scope/财务模型严格匹配当前环境，环境切换清空旧订单与财务摘要；定向前端+服务端 `392/392`、lint `74 files`，未联网或写入。

> 2026-07-20 C24 库存证据绑定读取环境：服务端回传受控环境，前端严格匹配当前环境，环境切换会失效库存证据/预演；定向前端+服务端 `390/390`、lint `74 files`，未联网或写入。

> 2026-07-20 B24 库存证据异常数量保持未知：缺失/非数字的 `present`、`reserved` 不再渲染为 `NaN` 或隐含 0；frontend `252/252`、lint `74 files`，未联网或写入。

> 2026-07-20 A24 1688 来源 URL 去重绑定当前店铺：候选→草稿重复判断不再按 URL 跨店复用；定向黄金链路/服务端 `173/173`，未联网或写入。

> 2026-07-20 D23 活动详情读取绑定当前店铺并失效跨店迟到响应：详情路由回传 `storeId`，前端校验活动商品/候选响应、当前店铺和请求代次；定向前端+服务端 `387/387`、lint `74 files`，首次全量回归受 C 盘 `ENOSPC` 影响，未联网或写入。

> 2026-07-20 C23 读取环境变更立即失效旧 proof 与计划：环境输入改变会清空旧 session proof、矩阵、回执和执行摘要，单店读取要求 proof 环境严格匹配当前环境；frontend `250/250`、全量 `1130/1130`、lint `74 files`，未联网或写入。

> 2026-07-20 B23 新增 SKU 行不再默认生成 100 件库存：空白变体库存改为空并要求读取真实库存后填写；frontend `249/249`、全量 `1129/1129`、lint `74 files`，未联网或写入。

> 2026-07-20 A23 草稿无 workflow 时禁止回退到其他商品：候选交接缺少 `workflowRunId` 时不再显示最近任务，停留候选上下文并阻断预检；frontend `248/248`、全量 `1128/1128`、lint `74 files`，未联网或写入。

> 2026-07-20 E21 部署文档与实际持久化后端口径统一：明确 `DATABASE_URL` 仅为迁移目标声明，当前 JobRepository 运行时必须使用 Supabase service-role；runtime/server `161/161`，未联网或写入。

> 2026-07-20 D22 切换店铺清除活动与价格影响摘要：店铺切换现在失效活动请求、清空活动/候选/价格影响并重绘财务域，避免上一店铺活动残留；frontend `247/247`、全量 `1127/1127`、lint `74 files`，未联网或写入。

> 2026-07-20 C22 切换店铺清除受控读取回执与计划：旧店铺/旧环境的 Seller API 回执、矩阵和执行摘要不再残留；frontend `246/246`、全量 `1126/1126`、lint `74 files`，未联网或写入。

> 2026-07-20 B22 字典修复候选绑定到同一 SKU：多 SKU 共用属性时，修复按钮必须匹配同一 `offerId`，找不到则不显示可写回；frontend `245/245`、全量 `1125/1125`、lint `74 files`，未联网或写入。

> 2026-07-20 A22 候选池操作继承商品店铺范围：忽略/入采集箱不再丢失候选自身 `storeId`，防止多店铺误处理；frontend `244/244`、全量 `1124/1124`，未联网或写入。

> 2026-07-20 D21 售后风险不再把不完整订单显示为零：争议订单和取消订单只在当前店铺订单范围完整时计数，否则显示未知并引导完成读取；frontend `243/243`、全量 `1123/1123`、lint `74 files`，未联网或写入。

> 2026-07-20 C21 切换店铺清除类目/属性读取证据：店铺上下文改变时清空上一店铺的类目树、属性 `server_observed` 回执和字典缓存，防止跨店铺误用；frontend `242/242`，未联网或写入。

> 2026-07-20 B21 类目属性输入不再生成示例事实：Integer/Decimal 属性不再自动填 `1`，默认留空并提示填写真实数值；frontend `241/241`，未联网或写入 Ozon。

> 2026-07-20 A21 黄金链路首屏阶段进度：普通卖家首页新增 1688 来源、SKU、类目、俄文内容、媒体、价格、预检的完成/待处理计数，且不把离线 fixture 升级为真实证据。frontend `240/240`、全量 `1120/1120`、lint `74 files`；offline acceptance wrapper 受 C 盘 `ENOSPC` 阻塞，未联网或写入。

> 2026-07-20 E20 运行时持久化门与实际仓储后端对齐：单独 `DATABASE_URL` 不再解除生产持久化门禁；当前 JobRepository 只有 Supabase 运行时适配器，`persistenceMode` 与 JSON fallback 风险据实际后端判断。runtime `25/25`、全量 `1120/1120`、lint `74 files`，未连接数据库或执行外部写入。

> 2026-07-20 D20 财务摘要验证等级与订单覆盖对齐：完整服务端订单读取才标 `server_observed`，分页/金额不完整标 `partial`，本地 fixture 保持 `locally_tested`；利润仍必须等待成本、佣金、物流和结算证据。全量 `1120/1120`，无外部写入。

> 2026-07-20 C20 审核可售状态与库存入口边界：`ready_for_sale` 没有完整、新鲜、覆盖完整的服务端商品状态证据时，不得进入库存流程；自动停在人工复核。全量 `1118/1118`，未执行履约或库存写入。

> 2026-07-20 B20 库存聚合回执验证等级对齐：只有服务端明确声明受控读取模式且四端点/目标 tuple/商品状态完整时，库存聚合才标 `server_observed`；本地 fixture 仍为 `locally_tested`。定向 `391/391`，未访问真实 Seller API 或执行库存写入。

> 2026-07-20 A20 黄金链路 fixture 阶段进度摘要：离线批回放新增 `stageProgress`，显示已完成/剩余阶段和数量；6/6 fixture 仍保持预检阻断，未升级为真实 Seller API 或审核证据。黄金回放定向 `17/17`，未访问外部服务或执行写入。

> 2026-07-20 E 生产持久化后端声明与实际实现对齐：`DATABASE_URL` 单独存在不再被生产门禁当成 JobRepository 可用后端；当前实现只有 Supabase client，生产迁移/部署预检要求实际 Supabase 配置，loopback JSON 仅保留开发兼容。定向 runtime/迁移契约 `30/30`，未连接数据库或执行写入。

> 2026-07-20 E 受控只读矩阵计划可执行性校验：矩阵 CLI 现在支持端点选择、类目/属性和 FBS 日期范围，并在生成前检查 endpoint request contract；缺必要范围时明确阻断，不再把必然 partial 的计划当成完整读取计划。read-operator `19/19` 通过；未联网、未读取 Ozon、未写数据库或写入。

> 2026-07-20 A/B 黄金链路旧自动铺货入口收口：旧 `/api/ozon-learning/auto-list` 现要求明确确认和店铺归属，job/1688 task/候选读取均继承 store scope，避免 AI/采集未经确认启动和跨店铺污染。server `136/136`、采集/匹配定向 `20/20`、全量 `npm test` `1116/1116`、lint `73 files`、offline acceptance 通过；未调用 AI、1688、Seller API、数据库或写入。

> 2026-07-20 R01 回环 signed session proof 闭环修复：有效 signed Cookie/Bearer 现在优先于 loopback bootstrap，修复本机建立会话后 proof 仍被判为未签名的问题。临时本机 smoke 已验证 session `200`、proof `server_verified`、四店铺范围和矩阵 `ok=true`；未访问 Seller API/数据库/写入。runtime/server 定向 `160/160`、全量 `npm test` `1115/1115`、lint `73 files`、offline acceptance 通过。

> 2026-07-20 E 第二十三轮流水线启动安全边界：`/api/pipeline/run` 现在拒绝并发运行，并要求 `autoList` 分支具备明确 `confirmAutoList`；前端按钮改名为“运行分析与采集流水线”，不再暗示自动完成 Ozon 上架。server `135/135`、frontend `240/240`、lint `73 files` 通过；未调用 AI/Seller API、未访问数据库、未执行外部写入。

> 2026-07-20 A 第十八轮 R01 跨域只读请求修复：前端发送的 `X-Ozon-ERP-Read-Environment` 已加入服务端 CORS 显式白名单，避免独立部署前端在预检阶段无法进入 signed session 门禁；新增静态回归，server/frontend 定向 `363/363` 通过。该修复不产生网络、数据库或 Ozon 副作用，真实 Seller API 读取仍未验证。

> 2026-07-20 A 第十八轮 CORS 运行烟测：允许的 loopback Origin 对带只读环境 header 的 OPTIONS 预检返回 `204`，未配置 Origin 返回 `403 CORS_ORIGIN_DENIED`；外部 Origin/HTTPS 仍需部署配置，不把本机烟测升级为真实读取。

> 2026-07-20 B 第十八轮采集入口 UX：统一采集插件在 ERP 未连接或未选择归属店铺时禁用“采集当前商品”，即使被脚本直接触发也会给出卖家下一步；连接店铺成功后才恢复按钮。扩展回归 `16/16`、全量 `npm test` `1102/1102`、lint `73 files` 通过，未改变采集契约或 Ozon 写入边界。

> 2026-07-20 B 第十八轮库存入口去演示数据：移除库存页硬编码的 `SKU00259-оранжевый-hello`，改为空目标并提示从商品页带入或填写真实 Offer ID，避免把样例库存误当当前店铺目标；前端静态 `236/236`、全量 `npm test` `1103/1103`、lint `73 files` 通过。

> 2026-07-20 B 第十八轮上架表单去演示数据：移除上架页默认中文测试标题、测试 Offer、示例售价/库存/尺重、默认采购成本和佣金输入；新建行不再自动填 100 件库存，要求采集或人工证据进入后再预检。前端静态 `237/237`、全量 `npm test` `1104/1104`、lint `73 files` 通过，未触发 Ozon 写入。

> 2026-07-20 B 第十八轮测试 API 前置门：缺少只读环境或店铺时，按钮现在只做本地提示、不发起 403 请求；满足条件后才进入服务端 signed-session 门禁。前端静态 `238/238`、全量 `npm test` `1105/1105`、offline acceptance 通过，未联网。

> 2026-07-20 B 第十八轮定价输入门：清空演示默认值后，定价计算器现在要求成本、包装尺重、费率和目标利润率都具备有效输入；空白或无效字段只提示卖家，不提交伪 0 值。前端静态 `239/239`、全量 `npm test` `1106/1106`、offline acceptance 通过。

> 2026-07-20 A 第十八轮环境绑定修复：公共 Seller API 请求现在优先使用系统只读环境，上架页环境仅作为类目/属性工作台的 fallback；避免旧上架环境污染商品、订单和库存读取。前端静态 `240/240`、全量 `npm test` `1107/1107`、offline acceptance 通过。

> 2026-07-20 A 第十八轮库存队列权限收口：`stock-queue?includeWarehouseRecommendation=1` 原可绕过统一读取门直接调用仓库 Seller API；现在仅本地队列摘要可免会话，仓库推荐必须先通过 signed session/environment。server 定向 `129/129`、全量 `npm test` `1108/1108`、offline acceptance 通过。

> 2026-07-20 A 第十八轮库存队列店铺隔离：失败队列与运维摘要原会返回所有店铺 durable jobs；现按请求店铺和 principal store scope 过滤，仓库推荐仍先过 Seller read gate。server 定向 `130/130`、全量 `npm test` `1109/1109`、offline acceptance 通过。

> 2026-07-20 A 第十八轮库存失败回放修复：回放入口原未绑定店铺、成功后引用未定义 `stocks` 导致 500；现在必须带当前店铺并按 principal scope 过滤，响应返回 `scanned/replayed/storeId`，前端正确显示数量。server 定向 `131/131`、前端 `240/240`、全量 `npm test` `1110/1110`、offline acceptance 通过。

> 2026-07-20 A 第十八轮活动/审核回读门禁：活动列表、活动商品/候选和 `product-import-info` 任务回查原可绕过 signed session；现统一在 `getStore` 前校验环境、会话和店铺范围。server 定向 `132/132`、全量 `npm test` `1111/1111`、offline acceptance 通过。

> 2026-07-20 A 第十八轮活动/审核回读负向烟测：无 signed session 的四个新增门禁入口均实际返回 `403`，服务已关闭；未调用 Ozon。

> 2026-07-20 A 第十八轮库存入队边界：库存 durable job 入队原允许缺少 `storeId`，现直接返回 `STOCK_QUEUE_STORE_REQUIRED`，上架入队提交明确当前店铺；server 定向 `133/133`、全量 `npm test` `1112/1112`、offline acceptance 通过。

> 2026-07-20 E 第二十三轮流水线状态只读修复：旧 `POST /api/pipeline/status` 会把持久化状态重置为 `idle`；现改为只读返回当前快照，刷新不会覆盖运行中的流水线。server 定向 `134/134`、全量 `npm test` `1113/1113`、offline acceptance 通过。

> 2026-07-20 A 第十八轮旧 Seller API 读取入口收口：商品、商品价格/总览、仓库、订单看板/详情、未履约和库存证据入口统一经过 `requireControlledSellerRead`，环境优先取请求参数并绑定受控 signed session；没有会话不解析店铺凭据、不调用 Ozon。定向 server/frontend `361/361`、全量 `npm test` `1099/1099`、lint `73 files`、offline acceptance 通过；真实 Seller API 读取仍未执行。

> 2026-07-20 A 第十八轮卖家错误恢复：前端商品、仓库、订单读取不再把所有 403 都显示为“店铺无权限”，现在区分 signed session 缺失、环境不匹配和店铺范围不足，并给出建立会话/切换环境/补充范围的下一步；`235/235` 前端静态回归、全量 `npm test` `1101/1101`、lint 通过。未联网、未写入。

> 2026-07-20 A 第十八轮黄金链路类目闸门回归：四个旧类目 Seller API 入口已绑定 signed session/环境，前端上架页提供只读环境；无会话回环请求均 403。全量 `npm test` `1098/1098`、lint `73 files`、offline acceptance 通过，仍未执行真实 Seller API 读取。

> 2026-07-20 A 第十八轮类目读取闸门：发现旧类目树、属性、刷新和字典值入口仍可绕过 signed-session 直接调用 Seller API；现统一要求环境 + 服务端验证会话，并在解析店铺凭据前阻断。上架页新增只读环境输入。定向 server/frontend `360/360`，回环负向请求无会话均返回 403，未调用 Ozon。

> 2026-07-20 A 第十八轮回环运行验证：清理会话表单重复后，本机启动服务做 runtime smoke，首页 200、7 个视图、13 个导航绑定、4 个店铺通过；仅 loopback，服务已关闭，未调用 Ozon。

> 2026-07-20 A 第十八轮前端结构修复后门禁：会话表单重复块已清理，前端静态 `234/234`、全量 `npm test` `1097/1097`、lint `73 files`、offline acceptance 通过；离线验收仍无网络、数据库或 Ozon 写入。

> 2026-07-20 A 第十八轮前端结构修复：发现 `public/index.html` 中 ERP 会话表单被重复渲染 259 次，造成重复 DOM ID、页面膨胀和会话事件绑定不确定；已删除 258 个完全重复块，保留系统配置页唯一会话表单，并修正末尾多余 `</section>`。前端静态回归 `234/234`、lint `73 files` 通过。

> 2026-07-20 A 第十八轮部署前置实跑：`npm run deployment-preflight` 明确阻断迁移状态/备份恢复、生产数据库契约、认证店铺范围、HTTPS 与会话撤销共享状态；canonical 四店铺/API 指纹和磁盘空间通过。输出确认未连接数据库、未联网、未写入，生产就绪不能由本地测试替代。

> 2026-07-20 A 第十八轮真实回放前置核验：以 canonical 店铺 `2367028-1` 生成并检查 `single_offer` 受控只读计划，计划绑定和 9 个当前只读端点校验通过；由于本机没有 signed session、环境声明和认证店铺范围，执行明确保持 blocked，未访问 Ozon。该结果证明“计划可生成”，不证明“真实读取已完成”。

> 2026-07-20 E 第二十二轮全量门禁：A17/B17/C17/D17 轮转完成；全量 `npm test` `1096/1096`、lint `73 files`、offline acceptance 通过。离线验收明确 `networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`；canonical Seller API 文档与四店铺矩阵只证明本地配置一致，不能替代真实 Seller API 读取、审核回读、写后库存回查或生产部署验证。

> 2026-07-20 D 第十七轮活动/财务边界复核：活动分页不完整、总量未知或价格缺失时继续保持 unknown/partial；`old_price` 不被当作当前成交价；订单只有在完整范围和完整行金额证据下才进入销售额，利润仍要求成本、佣金、物流、杂费和结算证据。活动/财务/前端定向 `255/255`，未访问真实 Seller API。

> 2026-07-20 C 第十七轮履约/库存边界：FBS 订单只读模型新增边界回归，恶意订单行中的 `present/stock/sale_ready` 不会进入 `currentStocks`、库存证据或商品可售状态；订单读取仍只保留履约事实，库存继续要求独立的精确 Offer/仓库 Seller API 证据。全量 `npm test` `1094/1094`、lint `73 files`、offline acceptance 通过；真实订单读取和库存写后回查仍未验证。

> 2026-07-20 B 第十七轮库存交接门禁：发现库存 dry-run 入口不能只依赖按钮 disabled 和店铺/Offer/仓库字符串匹配；直接事件或恢复状态可能绕过“完整回执、所有商品明确可售”条件。前端现同时强制 `completeForRequestedIds=true`、`productStatusReadyForAll=true`、fresh checkedAt 和精确范围；库存回执摘要也必须同时绑定 environment 与当前 storeId，缺店铺/环境直接阻断，不能跨店铺聚合。全量 `npm test` `1094/1094`、lint `73 files`、offline acceptance 通过，仍未访问真实 Seller API 或执行写入。

> 2026-07-20 A 第十七轮修复：受控只读执行恢复商品列表→详情→库存的业务依赖顺序。此前稳定 plan binding 的端点排序会让 `/v3/product/info/list` 先于 `/v3/product/list` 执行，首个真实商品回放即使输入有效 Offer 也会产生误导性的 partial 回执；现由 `orderReadEndpoints` 在执行边界恢复前置依赖，不改变白名单、计划绑定或四店铺矩阵。定向 `read-endpoint-request + server-routes` `129/129`，仍未访问真实 Seller API。

> 本轮统一回归已达 `npm test` 待全量回归、前端待全量回归、lint 待全量回归；本轮新增单 SKU 父 Offer→1688 来源绑定，以及包装尺重必须绑定 source snapshot 的证据门。部署预检现在绑定 canonical 四店铺与 Seller API HTML 指纹，受控读取回执保留 401/403/429/5xx 分类和卖家恢复动作；FBS 订单看板已从已停用的 v3 offset 迁移到 Seller API v4 cursor/sort_dir 只读契约，前端刷新/筛选会失效旧游标，非完整范围状态数显示“本批”；活动报表在读取范围不完整时显示未知，不再把局部活动行误报为完整活动数；采集箱确认后的精确快照审核现在能跨候选池和草稿 handoff 保留，waiting-human 行可直接定位真实采集任务；启动脚本现在拒绝已有 server/distributor 时重复启动，库存多 Offer 入口已修复 `limit:10` 静默漏读，缺 Offer 或下一页时明确标记结果不完整；库存 dry-run 拒绝重复 `(offer_id, warehouse_id)` 目标和重复当前证据；多 SKU 规格归一化造成的生成 Offer ID 冲突现在不会在草稿或提交前静默丢 SKU：草稿保留冲突行，提交前以 `DUPLICATE_GENERATED_OFFER_ID` 阻断并等待人工修复；ERP 下载的统一采集扩展包已与源码同步并包含 captureId 深链；多 SKU 来源绑定新增顺序变化 fail-closed 回归，Offer 无明确来源匹配时不会按数组位置冒险错绑；来源绑定缺失的 SKU 现在可从变体工作簿直接回到 1688 来源入口，修复后重新生成 Payload 并预检；采集箱现在必须通过服务端持久化的精确快照人工确认，PATCH、请求体伪造和批量草稿入口都不能绕过该门；受控只读执行已按 Seller API 端点契约生成请求并做商品身份有界 fan-out，系统配置页已允许卖家填写 Offer/Product 范围和商品列表游标，空范围本地阻断；四店铺矩阵现在显示卖家店铺名，同时保留脱敏 hash 作为证据索引；商品总览和活动商品表都可直接把当前 Offer 送入库存只读核对，商品状态回查进入库存页时会保留全部可售 Offer，并同步到库存读取框和目标库存草稿，多个 Offer 不再只带入第一个；1688 扩展采集成功后可直接打开当前采集箱记录，定位商品并继续生成本地草稿；采集页已支持导入明确 `redacted=true` 的脱敏 1688 manifest/page 快照，服务端只保留解析摘要、哈希和有限 provenance；采集箱“生成草稿”现在会保存本地草稿并绑定工作流，保存后刷新关联 job 以显示类目/采购/包装修复表单，已有草稿只打开编辑；单商品本地预检阻塞时留在当前商品行显示卡点和下一步，提交成功后可从预检结果卡直接进入 Task ID 只读回查，回查结果同步 `review_reconcile` 并生成状态/字段修复任务；补内容、采购或包装尺重后会自动重新校验本地 Payload，只有通过才进入上架页；旧学习/分发 `complete-listing` 写路径已返回 410 并停用后台自动提交，统一提交闸现在传递俄文事实复核与定价证据，manual_default 佣金在预检阶段直接阻断；统一提交若收到 2xx 但缺少 `task_id` 现在转为 `needs_review` 并占用原草稿 reservation，禁止自动重试；FBS 任务已补卖家可读状态、定价佣金无证据时 fail-closed，商品筛选空状态已与店铺空结果区分；提交任务的 `product/import/info` 回查现在按 workflow/task/store 绑定写入 `review_reconcile`，仅有导入回执时保持 `pending_moderation`，不误报审核通过；此前的恢复演练、1688 快照→类目/属性→预检回放和 signed-session 回执绑定继续有效。offline acceptance 与 runtime smoke 均通过，当前仍无真实 Seller API 读取、真实审核回读或真实写后回查，因此验证等级保持 `locally_tested/configuration_declared`。 

> 2026-07-19 回归更新：上面的待回归占位已完成；黄金链路/payload 定向 `52/52`、`npm test` 全量通过、`npm run lint` 通过（72 files）。

> 2026-07-20 B 更新：库存 `/v4/product/info/stocks` 与仓库 `/v2/warehouse/list` 已接入有界 cursor/last_id 分页；重复游标 fail-closed，回执保留分页范围，库存页显示分页读取状态。库存/商品/前端定向 `238/238`，仍未做真实 Seller API 读取。

> 2026-07-20 C 更新：FBS v4 cursor、异常 has_next、重复 posting、商品详情批量读取、未知数量/状态和“本批”范围提示复核通过，FBS 定向 `24/24`；未执行订单履约写动作。下一轮进入活动/财务覆盖审计。

> 2026-07-20 D 更新：活动 total/has_next/offset 矛盾、未知总量、空响应和局部页保持 unknown/partial；财务摘要不会把活动折扣或局部订单升级为利润/全店销售额。活动/财务定向 `21/21`，未访问真实 Seller API。

> 2026-07-20 E 更新：部署预检确认 canonical 四店铺/API 文档证据通过，但迁移状态/备份回执、生产数据库契约和外部部署认证/持久化/HTTPS 仍缺失，整体保持 fail-closed；预检/受控读取定向 `12/12`，无网络、无写入。

> 2026-07-20 A 第二轮更新：包装尺重证据现在还会逐字段匹配当前待提交数值，快照之后修改的数字即使沿用旧 evidenceRef 也会阻断；黄金链路/payload 定向 `53/53`，未访问真实 Seller API。

> 2026-07-20 B 第二轮更新：库存只读回执现在保留并哈希绑定分页页数、完整性和重复游标信号，不能把不明读取范围保存成完整回执；库存回执定向回归通过。

> 2026-07-20 C 第二轮更新：FBS v4 cursor 回执 scope hash 现在包含 cursor/sortDir/pagination，不同订单页不能复用同一页证据；FBS 回执/订单定向 `31/31`。

> 2026-07-20 C 第二轮补充：前端 FBS 回执摘要查询已传递 cursor/sortDir/pagination；库存回执验证按店铺和 Offer/仓库范围过滤，保存后自动按当前范围回读摘要。

> 2026-07-20 D 第二轮更新：活动商品 API 只有在 Seller API 活动范围完整时才返回价格影响 preview，局部页不会升级成经营结论；活动/财务/服务端路由定向回归通过。

> 2026-07-20 E 第二轮更新：部署和受控读取继续保持 fail-closed；canonical 四店铺/API 文档证据通过，迁移/备份/数据库/外部认证配置缺失仍明确阻断；受控读取与回执定向 `26/26`，无网络、无写入。

> 2026-07-20 D 第二轮补修：活动 preview 不再把 Ozon `old_price` 原价当当前成交价；只有明确 current price 才计算降幅，缺失时保持 unknown。

> 2026-07-20 E 第二轮补修：readiness evidence GET 现在强制 environment 与 storeId，禁止同环境跨店铺回执聚合升级；部署/服务端定向 `139/139`。

> 2026-07-20 A 第三轮更新：媒体显式人工审批现在仍受当前 1688 source snapshot 绑定，跨快照 `evidenceRef` 进入 rich content 会阻断；类目/属性 server_observed 回执必须严格绑定店铺、环境和属性 cacheKey，不能用缺 scope 的旧回执冒充当前证据。媒体/类目/黄金链路/服务端定向 `290/290`，未访问真实账户、未执行写入。

> 2026-07-20 B 第三轮更新：库存写入响应补充 server-observed 写后回查时间、精确 Offer/仓库范围和匹配数量，前端明确展示“已通过精确 tuple 回查”；写前 fresh dry-run 与写后 readback 门槛保持不变。全量 `npm test 1071/1071`、lint 通过，未访问真实 Seller API、未执行写入。

> 2026-07-20 C 第三轮更新：FBS 回执摘要查询强制绑定 environment 与 storeId，缺失范围直接给卖家恢复动作，避免 local/staging 回执冒充当前店铺证据。FBS/前端/服务端定向 `376/376`，未访问真实 Seller API、未执行履约。

> 2026-07-20 D 第三轮更新：活动商品前端不再把 `old_price` 划线原价显示为当前成交价；FBS 回执按钮需先具备环境和店铺范围。活动/财务/前端/服务端定向 `357/357`，未访问真实 Seller API、未执行写入。

> 2026-07-20 E 第三轮更新：部署预检实跑继续明确阻断迁移状态、备份恢复、生产数据库契约、认证/HTTPS/持久化和会话撤销；canonical 四店铺/API 文档证据通过，但没有网络、数据库或写入，生产就绪仍未达成。

> 2026-07-20 A/B/C 第四轮复核：采集失败/人工验证/草稿交接、商品/活动到库存目标范围、FBS 详情只读边界均保持 fail-closed；未发现可复现的跨店铺、跨快照或履约误导缺口。未访问真实 Seller API、未执行库存或履约写入。

> 2026-07-20 E 第四轮更新：离线验收先发现并修复采集箱重试提示缺少“不提交 Ozon”的安全文案；修复后测试 `1075/1075`、lint、黄金链路 fixture、四店铺/API 矩阵和 loopback runtime smoke（7 views/13 nav/4 stores）均通过。生产部署阻断保持不变。

> 2026-07-20 A 第五轮复核：外部 GitHub/API 证据已落入端点矩阵和缺口 backlog，当前调用端点、验证等级、FBS v4 迁移及 P0/P1 任务均有可审计记录；未把 README、fixture 或本地测试冒充真实账号能力，本轮不新增未经证据支持的端点。

> 2026-07-20 B 第五轮更新：库存队列在写请求已发出后遇到超时/5xx 现在进入 `needs_review`，不会落入自动失败重放；必须先完成精确库存回查。全量 `npm test 1076/1076`、lint 通过，未访问真实 Seller API、未执行写入。

> 2026-07-20 C 第五轮复核：FBS 持久化回执按环境、店铺、完整 cursor 页面 scope 和 freshness 选择，过期/旧页不会冒充当前订单状态；服务重启不自动升级业务状态。未访问真实 Seller API、未执行履约。

> 2026-07-20 B 第六轮更新：受控只读回执 GET 不再允许只按环境汇总；现在必须同时绑定当前店铺 `storeRefHash`，前端也从当前店铺计算并传递 hash，查询范围固定为 `current_environment_and_store`。定向回归 `server-routes + frontend-static 350/350`，未访问真实 Seller API。

## 1. 文档地位

本文是项目唯一的当前路线图入口，用来回答“现在做到哪里、下一阶段做什么、什么证据才算完成”。

- 具体历史方案及其当前状态见 `docs/plan-status-index.zh-CN.md`。
- `docs/external-evidence-driven-erp-roadmap.zh-CN.md` 保留外部调研和证据方法，作为本文的研究依据。
- `docs/erp-ui-information-architecture.zh-CN.md` 是交互原则，不代表相应业务能力已经完成。
- `docs/ozon-seller-api-gap-backlog.zh-CN.md` 是 API 缺口清单，不单独决定开发顺序。
- `docs/SESSION_HANDOFF.zh-CN.md` 只记录近期接管信息；若与本文的阶段优先级冲突，以本文为准。

## 2. 产品目标与边界

目标用户是经营 Ozon 店铺、从中国货源组织商品与履约的卖家及运营人员。系统的首要成果不是“提供很多技术面板”，而是让用户安全完成两类任务：

1. 把一个有来源证据的 1688 商品转成合规、可审核、可售的 Ozon 商品。
2. 每天处理商品异常、库存、FBS 订单和活动，而不需要理解 Payload、workflow node 或原始 API 响应。

普通页面必须回答：当前对象是什么、状态如何、为什么阻塞、建议做什么、点击有什么影响、结果是否真正生效。技术详情只进入高级诊断。

## 3. 验证等级

| 等级 | 含义 | 不能推导出的结论 |
|---|---|---|
| `documented` | 有官方资料或已保存的真实响应定义业务事实 | 不能证明代码可运行 |
| `mocked` | 使用模拟依赖或构造响应通过测试 | 不能证明真实接口兼容 |
| `locally_tested` | 本地 fixture、单测或界面烟测通过 | 不能证明当前真实账号可用 |
| `real_read_verified` | 当前受控账号完成真实读取并保存日期、请求范围和脱敏回执 | 不能证明写入成功 |
| `real_write_verified` | 当前受控账号完成确认写入、异步回读和结果对账 | 只能证明已记录场景，不代表所有类目都可用 |

模块可称为“业务可用”至少需要 `real_write_verified`（纯读取模块为 `real_read_verified`），并具备权限、幂等、审计、失败恢复和界面状态测试。代码存在或测试通过只能称为已实现/本地验证。

证据回执的升级边界：只有服务端实际观察并持久化的 `server_observed` 回执可参与 `real_read_verified`；客户端提交的 `client_asserted`、空 environment、损坏存储、未知状态或未提供读取依赖均不能升级。当前 `observed_read_failure` 只证明受控只读调用出现过通用依赖/网络失败，不代表权限拒绝、限流或其他失败类型已经覆盖；`permissionFailureVerified` 必须保持 `false`，直到增加独立、受控且可审计的权限失败场景。

## 4. 当前能力验证矩阵

以下是保守基线；没有可定位的真实回放记录时不升级等级。

| 业务模块 | 当前等级 | 已有能力 | 关键缺口 / 升级证据 |
|---|---|---|---|
| 店铺连接与仓库读取 | `locally_tested` | 四个 canonical 店铺矩阵、session proof、单店受控只读执行卡、仓库读取界面 | 仍需受控账号真实读取；保存脱敏请求/响应、权限失败和最后同步时间，才能升级到 `real_read_verified` |
| 1688 页面采集 | `locally_tested` | 插件/任务、标题图片、SKU、详情图、解析问题、人机暂停；已有 6 类 synthetic/redacted 离线回放 | 以受控真实页面替换/补充 synthetic fixture；记录登录失效、验证码暂停与恢复，不能把合成样本当真实采集证据 |
| 货源筛选与供应商判断 | `locally_tested`（仅采购证据摘要） | 候选池、物理小件门、供应商/MOQ/阶梯价缺口与卖家下一步 | 仍缺供应商稳定性、采购风险证据和真实人工淘汰记录，不得宣称可自动判断“值得采购” |
| SKU 规范化 | `locally_tested` | 规格矩阵、颜色/尺寸候选、变体诊断 | 用单 SKU、多颜色、多尺寸、套装及缺图样本回放，并对照采购 SKU |
| Ozon 类目/type/属性读取 | `locally_tested` | 类目、属性及字典缓存、统一 hash-only 回执和本地匹配测试较完整 | 当前仍没有受控店铺真实回放；需保存店铺/环境/端点/时间/响应哈希和最小脱敏 fixture 后，才能升级 `real_read_verified` |
| 必填属性与变体草稿 | `locally_tested` | 合法字典候选、文本/尺重人工修复、变体唯一性和来源记录 | 真实类目逐 SKU 预检；低置信/合规属性必须人工确认 |
| 俄文标题与描述 | `locally_tested` | AI 内容生成和质量诊断 | 建立中俄事实对照、禁臆造项、人工确认与真实审核结果 |
| 图片与富内容 | `locally_tested` | 详情图、rich content 候选、图片观察、按需指导、付费生图确认 | 建立真实媒体规范检查、OCR 风险、OSS 回读和审核结果；不得以风格评分代替合规 |
| 包装尺重与合规 | `locally_tested` | 来源尺重修复、缺失阻塞、单位转换相关测试 | 记录来源可信度；覆盖敏感类目，禁止 AI/不可信同品猜尺重 |
| 定价与利润 | `locally_tested` | 成本、物流级别、佣金、利润和 blocked 风险 | 佣金/物流/汇率/促销资料必须版本化并有来源；移除默认 15% 和临时规则的“官方费率”错觉 |
| Payload preflight | `locally_tested` | 字段、字典、变体、媒体和价格闸口 | 对真实黄金 SKU 保存请求快照和 Ozon 回执差异 |
| 人工确认提交 | `locally_tested` | confirmSubmit、草稿 hash、锁、审计、task id 处理 | 受控账号真实提交并证明 hash/幂等/重复点击/超时恢复，升级 `real_write_verified` |
| 审核回读与修复 | `locally_tested` | review_reconcile 诊断框架、字段定位和修复草稿 | 真实 task_id → product_id → SKU/字段错误 → 修复 → 再审核完整记录 |
| 商品状态 | `locally_tested` | 状态列表、待处理/在售/审核/归档分组 | 真实读取、分页、状态时效、权限和陈旧数据处理 |
| 库存读取/写入 | `locally_tested` | 仓库、库存、失败队列、就绪检查框架 | 写前商品/仓库就绪、结构化 diff、确认、幂等、部分成功、写后回查 |
| FBS 订单 | `locally_tested` | 订单看板已切换 `/v4/posting/fbs/list` cursor/sort_dir 只读；服务端保留 next cursor，前端刷新/筛选会失效旧游标，非完整范围显示“本批” | 仍需受控店铺 v4 真实只读回放、权限失败和脱敏回执；真实读取后再实现详情、备货、标签、发运、取消及回查 |
| 营销活动 | `locally_tested` | 活动、参与/候选商品读取和移出入口 | 真实读取；写操作需选择范围、价格影响、确认、逐项结果和回查 |
| 财务、售后、经营报表 | `locally_tested`（仅财务只读投影） | 财务证据摘要、未知/阻塞边界和卖家下一步；售后/报表仍为导航面板 | 未完成真实订单/结算回读，不得宣称利润或完整经营报表可用 |
| 权限、认证与多店铺隔离 | `locally_tested`（session proof/店铺 scope 门禁） | 签名会话 proof、部署/主体店铺 scope 校验、受控读取回执保留 401/403/429/5xx 分类和卖家恢复动作；部署预检绑定 canonical 四店铺与 Seller API HTML 指纹 | 仍缺完整 RBAC、接口授权覆盖、密钥轮换和真实权限失败回放；不得据此宣称生产认证完成 |
| 数据持久化与任务队列 | `locally_tested` | JSON 仓储、工作流锁和部分队列 | 缺生产数据库迁移、并发一致性、备份恢复、多实例和队列运维 |
| UX 状态与可恢复性 | `locally_tested` | 业务对象分区、部分同步时间/陈旧状态、静态测试 | 全面覆盖 loading、真实空、筛选空、500、403、partial、重复点击和持久结果 |

## 5. 当前阶段与阶段门

### Phase 0：可信基线（当前，P0）

目标：停止用页面数量和测试数量代表业务完成度，让每项能力有证据、状态和可信代码基线。

依赖：无。

交付：

- 本路线图和历史计划状态索引成为唯一治理入口。
- 整理工作区与测试 fixture 污染，形成可追溯提交基线。
- 建立 API 端点/版本/读写风险/fixture 对照表。
- 受控只读执行采用 endpoint-specific body contract：商品列表先行并 bounded fan-out 到详情/库存；FBS、类目字典等缺少必要 scope 时保存可定位失败码，不发送臆造请求体。
- 系统配置页已提供 session proof 摘要和单店受控只读确认卡；浏览器不直连 Seller API，真实执行仍须服务端签名会话、scope 和人工确认。
- 建立 1688 黄金 fixture 库和真实回放记录模板。
- 首页和高频页面不展示伪汇率、伪在线、伪 KPI 或未实现写动作。
- 明确当前服务的部署边界；在认证完成前不得开放到不可信网络。

验收：每个矩阵行有负责人任务、验证等级和证据路径；标准测试不污染 Git；无“已完成但无法定位实现/回放”的新声明。

### Phase 1：单商品黄金路径（P0）

目标：让一个普通卖家不用进入技术控制台，也能把受控商品从 1688 证据推进到 Ozon 审核结果和库存就绪。

依赖：Phase 0；当前 Ozon 官方端点基线；受控测试店铺；人工确认写入许可。

交付：

- 至少 1 个单 SKU 和 1 个多 SKU 商品的完整对象页。
- 来源、SKU、类目/type、属性、俄文、媒体、尺重、价格均有证据与阻塞状态。
- 保存草稿后必须重新预检；提交确认绑定草稿 hash，不可复用旧确认。
- task_id、product_id、审核错误、字段/SKU 修复及再次回读在同一对象链路可见。
- 商品审核就绪后才能进入库存步骤。

验收：至少 10 次受控真实回放；所有真实写入经过 preflight + 草稿版本确认 + 人工确认；失败可定位到业务字段/SKU；无重复提交和无限重试。

### Phase 2：商品与库存运营（P1）

目标：可信管理已上架商品、价格和库存。

依赖：Phase 1 的 product_id/offer_id 状态链；仓库真实读取；权限模型最小版本。

交付：商品保存视图和详情；库存结构化编辑；写前 diff；部分成功结果；写后回查；操作审计。

验收：真实商品读取和库存写入/回查达到相应验证等级；慢响应、500、403、空数据、重复点击、部分成功均有测试和恢复入口。

### Phase 3：FBS 订单履约（P1）

目标：按截止时间完成待备货、标签、发运、取消和异常处理。

依赖：真实订单读取、仓库与商品映射、权限、幂等和审计。

交付：可保存任务视图、订单详情、选择后批量动作、逐项结果、失败重试与状态回读。

验收：受控真实订单从读取到最终状态回读；accepted 不冒充成功；部分失败不丢失成功项。

### Phase 4：活动及后续经营域（P2）

目标：先完成活动加入/价格校验/移出/回查，再决定财务、售后和报表是否进入一级导航。

依赖：商品/价格可信数据、权限和真实活动读取。

验收：活动写入具备选择范围、影响预览、确认、逐项结果和回查。财务/售后/报表各自通过证据门后才立项，不因已有导航而自动开发。

### Phase 5：生产化（贯穿 Phase 1–4）

目标：从单机原型演进到可维护服务。

交付：数据库迁移、任务队列、认证/RBAC、密钥管理、备份恢复、幂等、限流、监控告警、多环境和契约/E2E 测试。

验收：恢复演练、权限测试、并发测试、告警演练和部署文档均通过；未完成前不得称为生产 ERP。

## 6. 当前优先任务

| 顺序 | 任务 | 主要依赖 | 完成证据 |
|---:|---|---|---|
| 1 | 工作区/测试数据可信基线 | 无 | 干净可复现的测试与提交 |
| 2 | [Ozon API 证据矩阵](ozon-api-evidence-matrix.zh-CN.md)持续核验 | 官方资料、真实只读账号 | 端点版本、fixture、实现位置、验证等级 |
| 3 | 1688 黄金 fixture | 真实页面和人机暂停规则 | 6 类 synthetic/redacted 样本已可离线回放；下一门是受控真实快照与脱敏记录 |
| 4 | 单商品任务式界面 | 1–3 | 五类页面状态测试和普通卖家走查 |
| 5 | 真实提交与审核回读 | 受控写权限 | 10 次脱敏回放记录 |
| 6 | 库存写前写后对账 | 商品审核就绪 | 真实写入、部分成功和回查 |
| 7 | FBS 只读工作台后再加写动作 | 真实订单读取 | 保存视图、详情、状态回读 |

## 7. 明确不做

- 不继续以新增一级菜单、技术面板、规则面板或大屏作为当前进度。
- 不依据 README、竞品截图、模型常识或本项目现有 UI 发明 Ozon 行为。
- 不在没有真实数据闭环时扩建财务、售后、通用 BI 或多平台 ERP。
- 不让普通卖家直接编辑原始库存 JSON、Payload 或 workflow node。
- 不让 AI/Claude/NVIDIA 决定平台事实、批准价格/库存/提交写入或绕过确认。
- 不自动调用付费生图；不绕过浏览器人机验证。
- 不接受 blocked 价格风险，不用默认佣金/固定汇率伪装官方实时资料。
- 不在 JSON 单机持久化、无认证和无恢复演练的条件下宣称生产可用。

## 7.1 2026-07-19 当前交付快照

- E 生产恢复新增可重复的 `npm run recovery-rehearsal`：在系统临时目录验证三表备份、成功路径和注入失败后的逆序恢复；该证据严格保持 `locally_tested`，不连接数据库、不联网、不写 Ozon，也不替代隔离数据库真实恢复回放。
- 本地回归基线为 `npm test` 978/978、`npm run lint` 70 files，离线验收通过；这些结果只证明 `locally_tested`，不升级真实店铺读取或写入等级。
- 本轮修复了商品列表分页失败时仍保留 `completed` 的状态错觉，并把采集箱保存草稿接入本地 workflow；生产化仍受数据库、认证、店铺范围和恢复演练阻断。
- 生产预检现在拒绝不可解析的 `DATABASE_URL`，避免“非空字符串”伪装成可用数据库配置。
- FBS 详情晚到响应会按当前店铺和订单批次 token 丢弃；活动刷新会先清除旧卡片和影响预览，避免 stale 数据被继续操作。
- 工作流、read-operator 回执和商品就绪回执现在按持久化对象与 principal/deployment 店铺范围隔离，不能通过省略请求 `storeId` 读取或触发其他店铺数据。
- 系统配置页将只读权限失败和部署阻断映射为卖家/运维下一步；复制部署预检命令不会在浏览器执行任何副作用。
- GitHub 工程对照已记录在 `docs/ozon-github-benchmark.zh-CN.md`；没有发现可直接证明 1688→Ozon 全链路的公开仓库，不能把参考项目当业务事实。
- 本轮补齐执行阶段来源 SKU 快照绑定、商品导入 Task ID/跨店缓存边界，以及受控只读矩阵 canonical 四店铺与 Seller HTML 指纹闸；仍未升级真实读取或写入验证等级。
- 本轮继续收紧批量采集动作、迁移严格解析和采集会话管理员权限，并完成 extension worker 的跨店 job 绑定。
- 本轮已完成 extension worker/job 店铺隔离与 principal 心跳持久化、受控只读回执防伪造、审计工件防覆盖、部署 principal 范围校验和启动失败卖家恢复卡；真实部署认证会话接入与真实 Ozon 读取/写入仍未完成。
- 本轮新增统一扩展的 HTTPS 外部地址与短期 Token 传递、生产预检 allowed/ok 契约统一、只读回执服务端环境必填；扩展 Token 签发/轮换和真实部署仍需单独演练。
- 本轮增加 session 撤销/epoch 轮换、恢复演练生产门禁、静态 secret 禁止直接只读和会话环境 claim；多实例撤销共享与真实 Ozon 读取/写入仍未验证。
- 本轮新增生产迁移事务/隔离备份回执契约；本地演练保持 `deploymentReady=false`，不能冒充真实数据库迁移或恢复证据。
- readiness 回查现要求签名会话、匹配环境和权威任务店铺范围；类目端点已进入统一回执，但真实店铺类目读取仍是明确缺口。
- 本轮 A/B/D 轮转交付了采集箱卖家任务卡、product-readiness 环境/会话门和活动商品降幅只读预览；均为 `locally_tested`，没有升级真实 1688/Ozon 证据。
- 商品 readiness GET 已补统一授权，当前仍缺受控真实商品读取；活动加入/活动价校验和真实回查仍保持未完成，不能从只读影响预览推导利润或写入可用。
- 本轮 A/C/E 轮转补齐了预检问题的字段/SKU 定位、FBS 已读取批次内筛选解释和只读生产门禁聚合；没有新增履约写入、数据库迁移或真实 Ozon 证据。
- 本轮 B/D/类目轮转补齐了精确库存 tuple unknown 边界、定价未知利润提示和类目读取统一只读回执；类目回执仍是代码路径验证，不是当前店铺真实读取。
- 本轮 E 补齐了 durable task 写入前的时间序列契约：`created_at/updated_at` 统一 ISO 归一化，非法时间或 `updated_at` 早于 `created_at` 会在首次 upsert 前阻断；只证明本地构造安全，不替代真实数据库迁移、恢复和多实例验证。
- 本轮 E 补齐了四店铺受控只读 session 前置闸：矩阵计划要求 canonical 四店铺逐一覆盖、匹配环境和服务端验证的短期 session scope；缺失时固定不执行 transport，输出仍为 `configuration_declared`，不伪造真实读取回执。
- `controlled-read.mjs --execute-live` 同步拒绝仅凭静态店铺 API key 的执行，要求脱敏且带 `server_verified`/`proofRefHash` 的 session proof；示例仅为占位符，不能替代真实签名验证或 `server_observed` 回执。
- 新增受保护 `/api/auth/session-proof` 摘要入口，loopback/static secret 不得伪造 `server_verified`；只返回范围 hash/环境/店铺 ID，不返回 Token 或 API key，不触发 Ozon 请求。
- 受控读取 CLI 现在只生成计划；`--execute-live` 不再调用直连 Seller API，必须转到已认证服务端 `/api/ozon/read-operator/execute`，避免本地 proof 冒充真实验签。
- 系统配置页已接入 `/api/auth/session-proof` 的只读摘要状态，并将 proof 缺失/已获取与四店铺矩阵同屏展示；不显示 Token、不执行 Ozon，仍保持 `configuration_declared`。
- 系统配置页增加单店受控只读执行卡：用户明确确认后经 plan binding 调用已认证 `/api/ozon/read-operator/execute`，显示服务端回执和下一步；默认不执行，浏览器不直连 Ozon。
- 本轮 A/B/E 轮转补齐了媒体逐资产合规提示、库存 tuple 前端展示和迁移版本/备份回执绑定；真实媒体回放、Supabase 迁移与 Ozon 读取写入仍未验证。
- 本轮继续按 A/B/E 轮转：类目保存后本地预检反馈、商品 readiness 到精确库存核对引导、任务时间序列 fail-closed，以及测试 API 的仓库读取状态/脱敏回执已补齐；仍未升级真实读取或写入验证等级。
- 本轮继续按 A/B/E 轮转：候选池交接后持久显示“本地草稿→预检”下一步；库存证据卡将 Seller API 端点/verification level 收敛为卖家语言；`controlled-read --execute-live` 强制匹配环境与店铺范围的服务端 session proof，禁止静态 API key 绕过。统一回归 `968/968`，仍未联网、未写入 Ozon。
- 本轮继续按 A/B/E 轮转：媒体阻塞优先于尺重/定价主动作；审核+库存成功进入 `sale_ready`，不再误导重复提交或进入 FBS；服务端提供 session proof 摘要；受控读取 CLI 固定 plan-only，真实读取只能走已认证服务端路由。统一回归 `971/971`，仍未联网、未写入 Ozon。
- 本轮继续按 A/B/E 轮转：系统配置可获取无 Token 的 session proof 摘要；预检通过与已提交状态分开；`sale_ready` 商品运营卡不再显示 FBS 库存，库存未知回到库存读取。统一回归 `974/974`，仍未联网、未写入 Ozon。
- 本轮继续按 A/B/E 轮转：系统配置增加带确认的单店服务端只读执行卡；提交未知结果优先进入回查；商品运营任务提供作用域导航；浏览器不再收到 masked API key。统一回归 `978/978`，仍未联网、未写入 Ozon。
- 本轮继续按 A/B/E 轮转：受控 Seller API 读取改为端点专属请求体和依赖链，缺少 Offer、日期或类目参数时 fail-closed；未把错误 payload 当作真实接口兼容。统一回归 `978/978`，仍未联网、未写入 Ozon。
- D 第五轮修复店铺切换后的订单/财务缓存隔离：切换店铺会失效订单列表/详情请求、清空订单分页与财务 read model，并在 dashboard/orders/finance 视图按新店铺重新回读；全量回归 `1077/1077`、lint `72 files`，仍未升级真实 Ozon 验证等级。
- E 第五轮复核确认离线验收通过，但生产预检仍被迁移状态、备份/恢复、数据库契约、外部认证、持久化、店铺范围、HTTPS 和共享撤销状态阻断；未联网、未连接数据库、未执行写入。
- A 第六轮完成黄金链路卖家可用性审计：业务链路的阻塞/下一步/副作用已串通，定向回归 `227/227` + `385/385`；下一缺口不是继续扩展 UI，而是受控真实证据升级（1688 回放、类目/属性、媒体回读、导入写入和审核回读）。
- C 第六轮复核订单/FBS 当前店铺只读边界：显式店铺、环境、posting 和分页范围保持绑定，履约动作仍未开放；本轮未发现新增回归，真实 Seller API/FBS 读取仍未验证。
- D 第六轮复核活动/财务证据口径：活动价仅作影响参考，财务要求完整订单/成本/结算证据，未知不被推导为利润；本轮未新增写入能力。
- E 第六轮全量门禁通过：测试、lint、黄金链路 fixture、canonical 四店铺/API 指纹均通过；无网络、数据库或 Ozon 写入，真实部署/读取阻断项保持不变。
- A 第七轮修正受控读取计划：新计划不再列出已停用 FBS v3，只生成 v4 FBS 端点；旧 v3 仅保留历史兼容校验。全量回归 `1078/1078`、lint `72 files`，真实读取等级不变。
- A 第七轮补齐受控读取计划回执契约：每个 canonical 店铺计划显式绑定店铺/环境/范围 hash、端点和 `planBinding`，并提供卖家 `nextAction` 与 `not_started` 回执预期；定向回归 `41/41`，未联网、未读取 Ozon。下一步需用户授权 signed session 后，由服务端逐店执行并保存脱敏 `server_observed` 回执。
- B 第七轮复核库存/仓库读取计划与分页契约一致，未发现可证实的旧端点偏差；官方字段和真实账号读取仍待授权核验，不新增臆想接口。
- C 第七轮复核订单/FBS 计划回执契约，确认新计划仅列 v4、绑定环境/店铺/范围和分页，且不误导为履约能力；真实 FBS 读取仍待授权。
- D 第七轮明确活动/价格/财务尚未进入受控真实读取计划；相关官方字段与端点请求契约待核验，不能把本地活动影响或估算利润升级为真实财务证据。
- E 第七轮离线门禁通过：本轮计划契约、端点版本和证据等级修改均通过 tests/lint/fixture/API matrix；真实读取前置仍是授权 signed session 与服务端脱敏回执，未联网、未写入。
- A 第八轮复核 1688 `sourceSkuId`→Ozon `offer_id` 交接：缺绑定、缺 Offer 覆盖、旧回执和有限页均保持阻断；真实商品导入/审核回读仍未验证。
- B 第八轮复核库存写后证据与 Offer 链路：精确 `(offer_id, warehouse_id)` tuple、商品/仓库状态和未知结果边界保持 fail-closed，无新增库存写入能力。
- C 第八轮复核订单/FBS 与商品库存交接，确认订单数量不会冒充库存或 `sale_ready`，FBS 仍只读；无新增履约能力。
- D 第八轮复核活动/财务与商品库存状态隔离：价格影响和财务估算不改变审核、库存或 FBS 状态，活动写操作继续受服务端预检与回读约束。
- E 第八轮跨模块交接离线验收通过；真实 signed session、Seller API 回执、数据库和生产部署仍未配置，验证等级不升级。
- A 第九轮确认真实读取授权入口：signed ERP session、环境/四店铺 scope、plan binding、人工确认和服务端脱敏回执必须连续成立；loopback/static secret 不能升级真实读取。
- E 第九轮最终门禁复核：离线验收通过，生产预检继续明确阻断；真实 signed session、Seller API 回执、数据库迁移和持久化仍未完成。
- A 第十轮统一单店/四店受控读取入口：默认端点均排除停用 FBS v3，计划摘要显式标记弃用范围；全量回归 `1080/1080`、lint `72 files`，真实读取等级不变。
- B 第十轮复核库存/仓库单店请求体和分页契约一致，缺精确标识继续 fail-closed；不新增未经官方核验的端点。
- C 第十轮修正订单/FBS 受控读取范围传递：保留 `since/to` 与 `cutoff/delivering` 日期字段，并让单店/四店计划显式接收日期参数；回归 `35/35`，真实 FBS 读取等级不变。
- D 第十轮复核活动/财务边界：活动影响不进入商品库存或审核状态，履约订单读取不冒充结算明细；财务只在完整订单行和分页证据下展示范围销售额，利润仍未知。
- A 第十一轮修正 1688 候选到本地草稿的 principal 店铺范围：交接同时绑定显式店铺和允许店铺集合，跨店候选不再仅凭候选 ID 被打开；定向回归 `124/124`。
- B 第十一轮补齐候选到草稿的店铺继承：principal 范围查找成功后，草稿继续绑定候选所属店铺，避免 Offer/库存队列接收到空店铺上下文；未执行真实库存读取或写入。
- E 第十一轮全量门禁通过：`npm test` `1081/1081`、lint `72 files`；黄金链路与店铺/API 证据仍为离线/本地验证，真实 Seller API 回执和生产部署没有被虚构。
- C 第十一轮修正商品状态回读的双重店铺绑定：任务根与 listing 回执店铺不一致时在网络调用前阻断；全量回归 `1082/1082`、lint `72 files`，下一轮继续轮转活动/财务或验收主线。
- D 第十一轮复核活动/财务与上架状态隔离：活动影响不改变 `ready_for_sale` 或库存队列，履约订单不冒充结算证据；未发现新增跨域污染。
- E 第十二轮离线验收通过：测试、lint、黄金链路 fixture、canonical 四店铺/API 文档矩阵通过；无网络、数据库或写入副作用，真实运行前置保持明确阻断。
- A 第十二轮修正候选前端店铺交接：建草稿按候选自身店铺提交并在缺失时阻断，不再依赖全局选择店铺；全量回归 `1082/1082`、lint `72 files`。
- B 第十二轮修正商品可售→库存入口：库存核对按钮绑定回查店铺并在跨店时先切换上下文，Offer/仓库 tuple 证据继续按当前店铺校验；全量回归 `1082/1082`。
- C 第十二轮修正订单列表回读范围绑定：前端在绘制前核对店铺、`since/to`、状态、仓库、cursor、分页模式和 `sort_dir`，同店但不同筛选范围的迟到/缓存响应保持未知并提示重读；全量回归 `1082/1082`、lint `72 files`，未联网、未执行履约写入。
- D 第十二轮修正活动列表店铺回读绑定：服务端回执带 `storeId`，前端以请求店铺和 request token 丢弃迟到/跨店活动响应；活动覆盖和价格影响仍不升级为利润或写入许可；全量回归 `1083/1083`、lint `72 files`。
- E 第十三轮跨模块离线验收通过：`npm run offline-acceptance` 的测试、lint、黄金链路 fixture、canonical 四店铺和 Seller API HTML 指纹均通过；`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`，下一轮回到 A13 主线缺口。
- A 第十三轮黄金路径缺口审计：Phase 1 的剩余工作不是继续堆 UI，而是 10 次受控真实 1688 回放、真实 Seller API 类目/属性读取、人工确认后的导入/审核回读和写后库存回查；signed session、受控测试店铺与明确授权缺失时保持阻断，不把本地测试升级为真实完成。
- B 第十三轮库存/仓库交接修正：仓库页、上架仓库页和库存证据回读均绑定 request token、storeId、Offer/warehouse 精确范围；跨店或迟到响应不会进入库存预演/写入门；全量回归 `1085/1085`、lint `72 files`。仓库分页完整消费仍列为 B14 缺口。
- E 第十四轮库存交接离线验收通过：`npm run offline-acceptance` 测试、lint、黄金链路 fixture、canonical/API 矩阵均通过；无网络、数据库或写入副作用，真实仓库读取与写后回查仍待授权和回执。
- C 第十三轮订单与库存交接复核：订单商品/数量/仓库/履约状态只作为订单观察证据，不进入库存 tuple、`currentStocks` 或 `sale_ready`；详情缺失继续保持未知，未发现可复现跨域污染；全量回归保持 `1085/1085`。
- D 第十三轮活动/财务与库存状态隔离复核：活动影响仍是覆盖受限估算，财务缺证据时保持未知；活动或财务读取不改变 `ready_for_sale`、`stock_sync` 或库存 tuple；本轮无代码变更。
- E 第十五轮全量离线验收通过：`npm run offline-acceptance` 保持 `ok=true`，测试 `1085/1085`、lint `72 files`、fixture/API 矩阵通过；无网络、数据库或 Ozon 写入副作用。
- A 第十四轮真实读取前置可执行化：实跑四店铺矩阵 CLI 后确认 canonical/API 文档通过，但示例 session proof 以 `executionAllowed=false` fail-closed；真实执行前置已明确为服务端签发、环境匹配、四店铺范围完整的短期 signed session，不允许静态密钥直连。
- B 第十四轮仓库分页契约修正：依据 Seller API HTML 将 `/v2/warehouse/list` 统一为 `cursor + limit + warehouse_ids` 请求，并在库存证据与仓库路由消费有界分页；重复游标/页数上限保持 partial；端点/库存/服务端定向 `141/141`，未访问真实 Seller API。
- E 第十六轮仓库分页离线验收通过：`npm test` `1086/1086`、lint `72 files`、黄金 fixture 和 canonical/API 矩阵通过；无网络、数据库或 Ozon 写入副作用，真实仓库回执仍待 signed session。
- C 第十四轮订单回执与库存分页范围复核：FBS 回执摘要继续绑定店铺、环境、日期/状态/仓库、cursor、sortDir 和分页模式；订单覆盖不升级库存 tuple，库存回执独立保留分页完整性和精确 Offer/warehouse 范围；本轮无代码变更。
- D 第十四轮活动/财务分页与库存边界复核：活动分页矛盾/未知覆盖保持 `unknown/partial`，财务只在订单范围结束且订单行金额完整时展示销售额；活动/财务不改变库存、`ready_for_sale` 或写入许可。
- E 第十七轮全量离线验收通过：`npm run offline-acceptance` 保持 `ok=true`，测试 `1086/1086`、lint `72 files`、黄金 fixture/API 矩阵通过；无网络、数据库或 Ozon 写入副作用。
- A 第十五轮黄金链路真实回放执行包：新增 `docs/GOLDEN-PATH-REAL-REPLAY.zh-CN.md`，固定 R01-R10 的商品形态、来源/类目/属性、草稿 hash、人工提交、审核回读、库存 tuple 和验证等级记录；未取得 signed session 时仍只生成计划，不联网。
- B 第十五轮商品/仓库 fixture 与请求契约对齐：商品列表/详情/库存/仓库请求与 Seller API HTML、Offer/Product 身份和 cursor 范围保持一致；6 个离线 fixture 全部保持可解释的 preflight blocked，不误报可提交；全量回归 `1086/1086`。
- C 第十五轮商品审核回读升级门收紧：`selling/visible` 商品行不能单独升级 `ready_for_sale`；必须有 list/detail 两个 Seller API 端点尝试、完整 Offer 覆盖和任务之后的 fresh `checkedAt`，否则保持 `pending_moderation`。定向 readiness 回归 `76/76`，真实读取等级不变。
- D 第十五轮活动/财务状态隔离复核：活动价格影响保持 `estimate`，订单销售额要求完整分页和逐行金额，成本/佣金/结算不足时利润保持 `unknown`；活动/财务读取不进入库存 tuple、`sale_ready` 或履约状态。本轮无业务代码变更。
- E 第十八轮全量门禁与阶段汇总：`npm test` `1087/1087`、lint `72 files`、离线验收通过；无网络、数据库或 Ozon 写入。当前阶段完成的是本地证据与安全闸，不等于真实店铺连通或 ERP 生产可用。
- A 第十六轮黄金链路卖家任务化输出：批量 fixture 报告新增当前阻塞阶段、原因、阻塞数量和卖家下一步，减少技术化 issue 列表；6 个 fixture 仍全部 `preflightBlocked`，定向回归 `17/17`，真实验证等级不变。
- B 第十六轮上架仓库分页安全交接：上架仓库选择器现在要求完整分页和当前店铺范围；局部/重复游标响应会清空并禁用旧选项，不再把局部仓库列表交给商品草稿。前端回归 `232/232`，真实库存/上架验证等级不变。
- E 第十九轮全量门禁：A16/B16 修复后 `npm test` `1089/1089`、lint `72 files`、离线验收通过；无网络、数据库或 Ozon 写入，真实读取等级不变。
- C 第十六轮连通性读取与 FBS 交接复核：`/api/ozon/test` 统一使用仓库 cursor+limit 有界分页契约并暴露完整性；旧未履约入口改用 v4 并强制日期范围；FBS 订单数量/仓库/履约状态继续不进入库存或 `sale_ready`。定向服务端回归 `125/125`，真实履约验证等级不变。
- D 第十六轮经营读取边界复核：活动覆盖、订单金额、成本/佣金/结算证据不足时继续保持 estimate/unknown，不污染库存、可售或履约状态；本轮无业务代码变更。
- E 第二十轮全量门禁：C16 后 `npm test` `1090/1090`、lint `72 files`、离线验收通过；无网络、数据库或 Ozon 写入，真实验证等级不变。
- A 第十七轮真实回放记录入口：新增 `golden-path-record`，可生成 R01-R10 的 `configuration_declared/not_started` 本地起始记录和明确阻塞，不伪造来源快照、Seller API 回执或提交结果；新增回归 3 项，真实回放仍未开始。
- E 第二十一轮全量门禁：A17 后 `npm test` `1093/1093`、lint `73 files`、离线验收通过；无网络、数据库或 Ozon 写入，真实验证等级不变。
- G2-S1 真实商品类目回填：Offer `993570366569` 的中文标题在本地 7422 类目库中唯一高置信匹配“服装首饰 / 胸针”（`17027899:87458886`，420 分、领先 50 分）；重启滞后的 5178 服务并重跑同一 capture 后，卖家页已展示候选。新增旧草稿缺失决策时自动回填回归；全量 `1276/1276`、lint `76 files`、离线验收通过。当前店铺类目/属性证据仍为 G3 阻断，未升级为真实 Seller API 读取或可提交结论。

## 8. 路线图更新规则

- 新业务能力开始前必须关联本文某一阶段；不关联则暂停立项。
- 每次升级验证等级必须记录日期、账号/环境、脱敏证据路径、成功及失败场景。
- 历史 plan 不删除；状态变化写入 `docs/plan-status-index.zh-CN.md`，不要靠勾选旧 checklist 表示当前产品优先级。
- 阶段完成后再更新 `SESSION_HANDOFF`；会话交接不得自行改变路线图优先级。
