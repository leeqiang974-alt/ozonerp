# Ozon ERP 会话接管与恢复记录

## 2026-07-24 G3-S1 真实类目回执与商品页联动完成

- 已建立绑定 `local-read-2026-07-24` 和四店铺范围的 signed ERP session，并对当前店铺 `3815760-4` 执行真实白名单 Seller API 类目只读。
- `17027899:87458886` 返回 tree、40 个属性和必填字典 `85/8229/9163`；品牌字典 71,757 项按 `last_value_id` 完成 36 页，另外两个字典各 1 页，全部 `paginationComplete=true`。
- 最终持久化完整成功回执：`read-operator:4929ef94-93f5-46c6-bfdb-b5746ccc5371`；`readSucceeded=true`、`endpointCoverageComplete=true`、`signedSessionBound=true`、`writeAttempted=false`。tree、attributes 与 3 组字典证据均绑定同一个 `readReceiptId/sessionRefHash`。
- 修复真实断点：类目只读 POST allowlist、receipt observations、旧单页字典覆盖、321MB 全类目缓存，以及独立复审发现的“缓存先于回执”“异常终页可误判完整”“慢旧请求覆盖新上下文”“legacy 路由重新污染精简缓存”。
- 字典读取按最大 2000/页有界分页；缺失/非布尔 `has_next`、非法 ID、空标签、重复/缺失/倒退游标全部 fail-closed。先持久化签名回执，再由全局最新类目读取代次提交精简 `{id,value}` 工作集；代次在临时文件序列化后、原子 rename 前再次校验，跨店铺/环境慢请求也不能覆盖新上下文。legacy 单字典读取只返回结果，不写黄金缓存。缓存约 8.94MB。
- 当前界面实际绑定的是 capture `c1784812672342zraqu` / workflow `wr_mrxje9dwa5a4m`；刷新后卖家页显示“胸针 / 自动匹配，不需要你操作”和“必填属性 / 已填写”。采购价、包装尺重、定价均自动带入。
- 验证：安全边界定向 343/343、全量 `npm test` 1305/1305、lint 76 files、5178 浏览器 runtime smoke、offline acceptance 通过；未点击付费 AI，未执行 Ozon 写入。
- 顶层计划已将 G3-S1 标记 completed；当前唯一入口为 G4-S1。下一步必须由用户对当前商品明确授权一次付费 AI，随后系统连续生成内容、刷新草稿并运行强预检，不增加逐项人工操作。

## 2026-07-24 G3-S1 当前店铺类目证据自动续读

- 当前唯一切片已从通过退出门的 G2-S1 切到 G3-S1；目标是让店铺 `3815760-4` 的胸针草稿使用当前环境真实类目树、`17027899:87458886` 属性和必填字典回执。
- 修复两个主链断点：首次受控类目计划不再要求预先提供 attribute IDs；完整字典返回的 `completed` 状态不再被当成失败。
- 商品页的一次主动作现在执行两阶段只读链：metadata 读取 tree + attributes；服务端仅从该次 attributes 响应推导必填字典 IDs，并返回精确 hash 绑定的 complete 续读计划；前端自动执行续读后才刷新同一 capture/workflow。页面普通渲染不再后台发起读取。
- metadata 阶段不写缓存；complete 阶段会再次核对当前 attributes 推导出的必填字典范围，只有 tree、attributes、全部字典和范围同时成功才原子提交整组证据。与续读计划不一致时返回 `CATEGORY_READ_ATTRIBUTE_SCOPE_CHANGED`；字典 `has_next=true`、格式异常或任一端点失败仍为 partial，不得污染完整缓存或升级预检。
- payload 草稿只消费 store/environment/cacheKey/paginationComplete 全匹配的字典证据；前端自动处理从类目同步到 AI/预检全程绑定同一 capture、workflow、job、store 和 environment，切换上下文立即停止。
- 5178 服务已重启到新代码。metadata 计划对当前真实 scope 生成 tree/attributes 两个请求；执行因当前会话未签名而在 Ozon transport 前返回 HTTP 403 `READ_OPERATOR_SESSION_REQUIRED`，side effect 明确为未调用 Seller API。
- 独立复审依次发现并关闭旧字典残留、异常 200、并发写覆盖、上下文竞态、原子阶段逆序和分页完整标记漏存，最终结论 `Ready: Yes`。
- 验证：定向 519/519、全量 `npm test` 1294/1294、lint 76 files、frontend runtime smoke、offline acceptance 全部通过；未调用 Seller API、未执行 Ozon 写入。
- 下一唯一入口：建立覆盖当前 environment 与 `3815760-4` 的 signed ERP session，然后在当前商品点一次“自动完成商品资料”，记录真实 server-observed tree + attributes + 必填字典回执；完成前 G3-S1 仍为 `CURRENT`。

## 2026-07-24 G2-S1 采集价格、包装尺重与自动定价联动

- 用户纠正：1688 插件已采集每个 SKU 的价格并录入包装尺重，ERP 仍要求重复填写供应商、采购价和包装数据，而且定价没有自动启动。
- 根因是采购门只认可供应商/MOQ/阶梯价，包装门只认可 `page_content`，前端又没有把当前 `sizeWeight` 传给商品摘要；结果是同一份已绑定快照的数据被误判为缺失。
- 现在对当前 1688 快照精确绑定的详情 SKU 价格按 `sourceSkuId` 去重后直接作为本地采购价证据，取最高 SKU 价进入现有“采购价 + 5 RMB”定价公式；不再要求重复填写供应商、MOQ 或阶梯价。搜索卡价格区间或未绑定快照的价格仍保持阻塞。
- 插件采集/插件内手填的包装尺重在 source、snapshot/evidenceRef 与四项数值完全一致时自动升级并复用为 `1688_package`；任何旧快照或数值不一致仍 fail-closed。
- capture 到唯一草稿交接时立即生成本地定价预览并持久化；默认佣金只能用于试算，利润继续标记未知。该动作不调用 AI、不提交 Ozon、不产生库存或价格写入。
- 商品表单新增“采购价格”自动结果行，并直接显示已采集 SKU 数、价格范围、包装尺重和本地试算；已有可信数据不再显示人工输入。
- 独立复核后额外封死三处边界：有 evidence envelope 的新 capture 缺 package field 时不得使用旧 URL 回退；snapshot 更新必须同步替换 `bestMatch.purchasePriceCny`；自动定价诊断必须连同 `enforced` 强预检策略持久化并在 validate/submit 重放。
- 验证：采购/包装/草稿交接定向测试 63/63，安全边界定向 322/322，前端与交接定向 326/326，全量 `npm test` 1288/1288、lint 76 files、offline acceptance 通过。真实 Offer `993570366569` 浏览器复核显示 9 个 SKU 价格 2.2–2.2 CNY、包装 50g / 10×10×10mm、售价本地试算 25.37 CNY、利润未知，当前没有必须人工填写字段且控制台零错误；未点击付费 AI，未执行 Seller API/Ozon 写入。

## 2026-07-23 G2-S1 商品表单联动响应

- 用户纠正：旧商品页把类目证据同步、属性载入等内部阶段显示成橙色“系统处理中”，却没有卖家入口；真正需要卖家提供的采购和包装数据反而藏在首次自动处理之后，形成“显示要处理但不知道去哪里处理”的死路。
- 商品页已改为无忧易售式单商品表单：自动类目、属性、俄文、定价、图片按行展示结果；类目已高置信匹配时明确显示“自动匹配，不需要你操作”，内部证据同步不再冒充卖家任务。采购与包装等真实缺口首次进入页面就同屏显示输入框。
- 底部只保留“保存并自动完成其余资料”：俄文手填兜底、采购和包装事实通过同一个接口一次校验、一次保存，再连续运行类目数据载入、AI 文案、草稿刷新与预检；输入不完整时直接聚焦当前表单，不再要求去其他 tab 寻找入口。
- 修复了原保存链路的实质断点：采购与包装接口过去只写顶层旁路字段，而 Payload/UI 读取 `candidateData`。现在手工采购写入规范化 `candidateData.procurementEvidence`，包装写入 `candidateData.sizeWeight` 和可信人工/供应商来源；保存后重新读取同一 job，再生成草稿。人工包装资料与旧 1688 包装快照分开验证，不会伪造采集证据。
- 保存严格绑定当前 `captureId + storeId + sourceSnapshotHash + workflowRunId`；人工俄文、类目、采购和包装入口任何一个缺失或过期绑定都拒绝写入，旧人工尺重记录缺工作流绑定也不能升级为可信来源。资料变化后在修改 job 前先作废旧预检并锁住提交；草稿重建失败时保留已保存事实，但明确停在“草稿待刷新”，不能复用旧预检。
- 本地 JSON job 与 workflow 的 read-modify-write 现在都由跨进程文件锁串行化；超时回收、重启恢复和 timeout 回填也复用同一原子 mutation 路径，避免两个 ERP 进程互相覆盖当前商品或把已失效预检写回来。新增 8 个独立 Node 进程并发写 workflow 的回归测试。
- 稳定规则已提升到 `AGENTS.md` 与 `CLAUDE.md`：凡提示卖家处理，必须同屏给入口并联动下游；系统内部阶段不得使用卖家阻塞样式。
- 浏览器用真实 Offer `993570366569` 验证：类目显示“小百货和配饰 / 服装首饰 / 胸针”，类目与属性为系统自动，采购与包装输入同屏，且只有一个“保存并自动完成其余资料”按钮；空资料点击会聚焦供应商输入并保留表单，不触发保存、AI 或 Ozon 写入。
- 验证：定向 635/635、全量 `npm test` 1284/1284、lint 76 files、offline acceptance 通过；`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。

## 2026-07-23 G2-S1 1688 采集页改为插件收件箱

- 用户纠正：原采集页把日常插件采集、候选池、fixture 回放、反向链路、crawler/API 状态、原始页面、任务配置和自动铺货历史同时展开，实测页面约 11,762px，高级工程流程替代了正常卖家操作。
- 普通入口现在只保留 3 块：在 1688 商品页点击“补齐后入箱”的唯一操作、插件连接/人机验证状态、当前真实采集商品与系统处理结果。真实 Offer `992997159052` 直接显示店铺 `xymallc`、9 个唯一规格、28 张图片和唯一的“完善商品资料”动作。
- 全局重复任务条、功能归属说明、任务入口卡和旧工具墙在普通采集页隐藏；所有旧能力被运行时归入原生 `<details>`“高级采集工具与历史记录（通常不用）”，默认关闭且不依赖 `:has()`。顶部“刷新采集结果”复用现有只读采集箱读取链并给出商品数回执。浏览器实测普通页高度从约 11,762px 降至 912px；主动展开后恢复约 11,869px，关闭后回到 912px。
- 唯一动作已在浏览器验证可自动切到商品所属店铺 `3815760-4` 并进入“编辑商品”；没有调用付费 AI、Seller API 或 Ozon 写入。前端静态测试 314/314、全量 `npm test` 1275/1275、lint 76 files、offline acceptance 均通过；`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 稳定规则已提升到 `AGENTS.md` 与 `CLAUDE.md`：普通 1688 采集页是插件收件箱，不得再次演变为采集实验室。

## 2026-07-23 G2-S1 一次点击自动处理到预检

- 用户纠正：把复杂流程折叠起来仍不等于自动化；类目、属性、AI 文案和预检分别要求点击，本质上仍是卖家逐项驱动系统。
- 商品页现在只提供“自动完成商品资料（含 AI）”：一次明确点击先等待当前店铺类目证据同步，再从 `content_generate` 运行现有受控链路，自动生成俄文内容、刷新本地草稿并执行提交前预检；该链路不包含 Ozon 提交。
- 自动处理前不再展开采购、尺重和手工俄文表单。自动处理完成后，只有来源确实没有、系统不能可靠推断的字段才展开；预检通过后只留下“进入最终提交确认”。
- 类目自动同步增加同一商品/店铺/类目的 Promise 合并，页面后台同步与卖家点击不会并发重复，也不会在同步尚未结束时提前预检。
- 自动处理增加 job 级全局运行锁和 capture/store/run/job 四重绑定；同一商品不会重复调用付费 AI，等待期间切店/切商品会在 AI 前停止。完成提示必须同时满足受控链到达预检、原绑定不变且当前草稿 hash 与验证 hash 一致。
- 浏览器只读验收：真实 Offer `992997159052` 显示一个启用的自动处理按钮，旧“AI 一键补齐文案”不存在，采购/尺重表单在运行前不可见；未点击自动处理，因此没有模型费用、Seller API 类目读取或 Ozon 写入。
- 验证：定向 319/319、全量 `npm test` 1274/1274、lint 76 files、offline acceptance 通过；独立复核确认重复 AI、类目失败后继续、跨商品竞态和误报完成 4 项均已关闭。

## 2026-07-23 G2-S1 单商品编辑单与自动处理界面

- 用户纠正：后台证据链严谨不等于卖家前台要理解 workflow、证据卡和流程节点。上架页改为一张单商品编辑单：系统自动填写区、图片与规格区、仅剩待补资料区和一个主动作；证据、预检回执、媒体审批与诊断折叠到高级区。
- 稳定默认值直接展示为俄罗斯站点、俄语、克、毫米和真实提交人工确认；Ozon 动态类目、必填属性和当前店铺证据继续实时绑定，未被写死。
- AI 文案改为一次明确点击：按钮调用现有 `/api/ai/listing-content`，只在点击后可能产生模型费用，生成结果回填俄文标题/描述并保存本地草稿；不会提交 Ozon。AI 不可用时才展开手工俄文表单。
- 修复商品入口串店：从首页点击“完善商品资料”会先切换到 capture 所属店铺，再进入商品单；直接打开商品页也自动对齐店铺。真实 Offer `992997159052` 浏览器验证显示 `xymallc - 3815760`、类目“胸针”、9 个唯一规格、28 张采集图、Parent SKU `SKUlq00005`，AI 按钮可用，当前主动作是“补齐采购成本”。
- 规格显示不再使用 18 条原始采集行，优先按稳定 source SKU ID 去重；商品图展示采用 28 张采集主图，媒体审查的 37 个资产证据仍保留在高级区。
- 稳定规则已提升到 `AGENTS.md` 与 `CLAUDE.md`：普通上架页必须是单商品编辑单；稳定经营默认值可固定，动态 Ozon 类目/属性/字典和真实店铺证据不得写死。
- 验证：定向前端/采集/类目 333/333，全量 `npm test` 1274/1274，lint 76 files，offline acceptance 通过；浏览器完成真实商品入口、自动切店、类目、AI 按钮、SKU/图片/Parent SKU 与主动作检查。`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`；未点击 AI、未执行 Ozon 写入。

## 2026-07-23 G2-S1 高置信类目自动匹配

- 用户纠正：黄金链路中能自动完成的类目匹配不能默认转成人工操作。本地类目库存在不代表链路已完成，必须把候选生成、置信判断、当前店铺证据和卖家状态串起来。
- 真实 Offer `992997159052` 诊断：本地库有 7422 个 type，含 `胸针 17027899/87458886` 与 `徽章 17027899/93762`；旧算法只抓“饰品”宽词，错误排序室内装饰等类目。缓存绑定 `3770019-3`，商品绑定 `3815760-4`，不能直接升级为当前店铺提交证据。
- `matchCategory()` 新增胸针/徽章核心意图、错误装饰/宠物/文具类目降权，以及分差/核心词约束的 `autoSelectable`。真实回放自动选择胸针，分数 420，领先徽章 50 分。
- capture handoff 新增持久化 `categoryDecision` 和 `autoCategory`。唯一高置信候选自动绑定；候选接近才显示确认；没有可靠候选继续由系统匹配。当前店铺树或精确类目属性回执缺失时状态为 `auto_matched_evidence_pending`，不会冒充可提交证据；证据就绪必须同时匹配店铺、环境和 `description_category_id:type_id`。已有卖家类目选择始终优先，后续自动重跑不会覆盖；新快照变为歧义/无候选时会清除旧自动类目。
- 商品资料页显示实际推荐类目和证据状态；若只是跨店铺/旧缓存候选，后台自动调用只读类目树和精确属性刷新并重新运行同一 capture workflow，不再要求卖家手动搜索 7422 个 type。任何刷新失败仍 fail-closed，不提交 Ozon，并在 5 分钟退避后允许自动重试。
- 稳定规则已提升到 `AGENTS.md`：类目状态必须区分无候选、高置信候选、候选歧义和当前店铺证据问题；跨店铺缓存只可作明确标注的只读候选。
- 验证：定向前端/采集/类目 332/332，全量 `npm test` 1273/1273，lint 76 files，offline acceptance 通过；真实回放仅更新本地 job/workflow，`networkAccessed=false`（验收）、未执行 Ozon 写入、付费模型或库存写入。独立复审提出的旧自动类目残留、证据范围不足和失败后不重试均已修复。

## 2026-07-23 G2-S1 零学习成本使用引导

- 用户反馈“仍不知道 ERP 怎么使用”。根因不是缺少教程，而是首页只给出“完善商品资料”等抽象动作，没有解释用户责任、自动化责任和点击后的业务结果。
- 首页新增固定分工：用户只负责选商品、确认必要资料和最后决定是否上架；现有规格/图片整理和风险检查由系统与 AI 负责，任何付费生成仍需另行授权。
- 当前商品模型为等待采集、来源确认、重新采集、自动整理、资料补充和确认上架分别提供 `userInstruction`、`systemNext`、`safetyBoundary`。唯一主动作同屏显示“现在只做这一步”“点完以后”“安全边界”。
- 当前动作显式区分 `view/capture/capture_review/capture_workflow/workflow`，确认商品、建立/恢复草稿和打开已有 workflow 都先切换到当前 capture 的精确店铺。来源确认同时接受 canonical `sourceEvidenceRecord.snapshot.hash` 和旧 `sourceEvidence.snapshotHash`，确认框只显示卖家业务语言，不暴露 snapshot/hash。
- 当前真实 Offer `992997159052` 实测显示：只补充系统无法确定的内容；点击后直接进入绑定 workflow `wr_mrwy5u1frz3nr` 的商品资料页，不再回到采集箱寻找第二个控件；此时不提交 Ozon、不调用付费 AI。桌面视口 `scrollWidth === clientWidth`，无横向溢出。
- 稳定规则已提升到 `AGENTS.md`：普通卖家不能依赖说明书理解 ERP，每个当前动作必须说明用户现在做什么、系统接下来做什么、何时真实提交或产生费用。
- 验证：前端静态 311/311、全量 `npm test` 1268/1268、lint 76 files、offline acceptance 通过，最终独立复审无 Critical/Important；`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。

## 2026-07-23 G2-S1 商品工作台视觉系统重做

- 用户明确纠正：三步逻辑虽然已收口，但视觉仍像廉价内部后台。该反馈已提升到 `AGENTS.md`：普通卖家首屏必须是商品运营产品，优先展示真实商品图、身份、状态和单一动作，禁止序号字符导航和大面积深色动作块。
- 桌面壳层改为浅色 232px 固定侧栏、Ozon 蓝品牌标、统一 SVG 导航图标、轻量状态胶囊和 1180px 内容区；主商品卡使用真实采集首图、两行标题、商品元数据和独立蓝色行动区。
- 三步进度改为三个独立状态块：已完成为绿色勾选、当前步骤为蓝色聚焦、未开始保持中性；处理结果压缩为单行商品事实。
- 商品图只接受 http(s) URL，渲染时属性转义、`referrerpolicy=no-referrer`；无合法图片时显示本地 OZ 占位，不改变任何采集、草稿、预检、hash 或提交门。
- 响应式浏览器验收覆盖默认桌面、960×900 非首页、768×900 和 390×844；修复了窄屏下侧栏变为普通文档流、导致主内容下移 743px 的层叠冲突，并统一 901–1023px 的 sidebar、main、全局任务条和 72px 顶部占位。960px 采集页实测 main/task 左边界均为 0、task 为 static、main padding-top 为 0。
- 验证：前端静态 308/308、全量 `npm test` 1265/1265、lint 76 files、offline acceptance 通过，最终独立复审无 Critical/Important；`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。

## 2026-07-23 G2-S1 卖家三步界面

- 用户明确纠正：工作流节点、证据、快照、预检和 AI 推理属于系统内部过程，不应直接放到卖家台面。该原则已写入 `AGENTS.md`，后续普通界面只允许显示业务结果、必须人工决定的异常和唯一下一步。
- 首屏固定为“采集商品—检查商品—确认上架”三步；隐藏顶部自动化/工作流状态，技术性完成记录合并成简短处理结果，高级经营和诊断入口降级为“更多信息”。
- 首页隐藏重复的全局当前商品按钮，离开首页后才显示该快捷入口；普通首页只有一个主动作。
- 所有内部 fail-closed 安全门保持不变；本轮只重写卖家信息架构和文案，没有删除 snapshot/workflow/preflight/evidence 校验，也没有放宽提交确认。
- 浏览器观察：真实 Offer `992997159052` 当前处于“检查商品”，9 个规格、28 张图片；页面只显示“完善商品资料”动作和必须确认的资料数量，不自动上架。后台 `currentProductTask.reason` 不再直出首屏，避免泄漏 Payload、预检、证据等内部术语。
- 验证：前端静态 307/307、全量 `npm test` 1264/1264、lint 76 files、offline acceptance 通过；新增可执行测试覆盖有效待确认、已建立草稿、草稿 hash 过期和检查通过状态，确保进度高亮与主动作一致，旧检查结果不能进入“确认上架”；最终独立复审无 Critical/Important；`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。

## 2026-07-23 G2-S1 当前商品工作台重构（等待真实确认）

- 依据 Ozon 官方商品内容文档、Shopify Polaris 资源/动作模式和 Vendure/Ozon 开源后台实际代码，将首页从全域数据驾驶舱改为单商品上新工作台：真实商品、5 步进度、系统已完成、卖家唯一动作同屏显示；经营模块和系统诊断默认折叠。
- 修复三个界面各选不同当前商品的根因：工作台、全局任务条、商品草稿页和高级工作流动作现在共用 canonical capture 上下文；存在真实 capture 时，只能匹配同一 `captureId + storeId` 的非 synthetic workflow，不能回退到最近历史或 Fixture workflow。缺少 capture、无效 snapshot hash、未人工确认或绑定不匹配时，所有工作流变更/提交动作 fail-closed。
- 当前真实商品准确显示 Offer `992997159052`、9 个唯一 SKU 和 28 张图片。商品草稿页在来源未确认前只显示该商品的确认门，不再显示 Fixture 草稿、提交按钮或完整编辑墙。
- “去核对并确认”已在浏览器实测：自动切换到 xymallc (`3815760-4`)、定位 capture `c178476424685142rv6`；目标行永久橙色高亮，SKU 显示去重后的 9，未确认阶段只突出“确认当前快照”和次要的“补齐采集”。未代替用户点击人工确认。
- 外部证据和采用/不采用决策记录在 `docs/frontend-current-product-workbench-research.zh-CN.md`；稳定的当前商品绑定规则已提升到 `AGENTS.md`。
- 验证：前端静态 305/305、全量 `npm test` 1262/1262、lint 76 files、5178 frontend runtime smoke、offline acceptance 通过；新增可执行场景覆盖 synthetic/历史 workflow、无 capture、未确认和无效 snapshot hash；`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。G2-S1 仍等待用户确认真实快照，未进入 G3。

## 2026-07-23 G2-S1 前端主线收口（等待真实确认）

- 13 个平铺模块改为 5 个日常主线入口：工作台、1688 采集、商品草稿、商品状态、订单履约；其余模块保留在“更多功能”，没有删除业务能力。
- 新增全局当前商品任务条，真实采集优先于 workflow 历史；当前准确指向 capture `c178476424685142rv6`，点击后自动切到店铺 `3815760-4`、打开选品采集并定位目标行。
- 采集表使用固定布局、截断长 URL、右侧 sticky 操作列；浏览器在 1256×912 视口和页面滚动 `2289px` 时，任务条及“确认当前快照”均可见，按钮保持 enabled。
- 803 条 fixture workflow 默认隐藏，不进入首页数量、当前商品和风险统计；高级诊断明确显示隐藏数量，页面高度由约 220,449px 降至 654px，可手动显示测试数据。
- 验证：前端静态 299/299、全量 `npm test` 1256/1256、lint 76 文件；五个主线入口逐项浏览器验证通过，控制台 0 error。未点击人工确认、未调用 Seller API、未执行付费模型或 Ozon 写入。
- 当前唯一入口仍是 G2-S1：用户点击全局“去确认快照”后，在已自动定位的真实商品行确认当前 1688 快照；随后核对唯一 9 SKU 草稿和集中阻塞项。

## 2026-07-23 G2-S1 唯一本地草稿骨架（等待真实确认）

- `createListingWorkflowFrom1688Capture` 现在按 capture/store 原子复用唯一 auto-listing job，并复用精确绑定的 workflow；重复点击或刷新不会产生重复商品任务。
- 真实样本暴露出采集器返回 18 行 SKU、但仅 9 个唯一 `skuId`。草稿入口按来源 SKU 身份去重、优先保留字段更完整的行，并持久化原始/唯一/重复计数；此前文档中的“18 个 SKU”已纠正为“18 行采集结果、9 个唯一来源 SKU”。
- 草稿骨架将供应商、MOQ/阶梯价、可信包装尺重、媒体合规、俄文内容、Ozon 类目集中为卖家阻塞任务；`capture_hint` 尺重不会被升级为 `1688_package`。
- 界面在用户确认精确 snapshot hash 后立即创建/复用本地草稿骨架、进入当前商品上架中心，并展示唯一下一步；确认动作仍不可绕过，整个交接不调用 Seller API、付费模型或 Ozon 写入。
- 修复测试隔离：capture/workflow 集成测试显式把 `WORKFLOW_RUNS_FILE` 指向临时目录，避免隔离测试把 workflow 数据写进项目 `data`。
- 提交前代码审查补齐三项重要边界：跨快照不能沿用旧候选数据，workflow 创建改为同一存储事务内 find-or-create，并发 8 次仍只有 1 个；缺少来源 SKU ID 的规格必须加入阻塞，不能显示为草稿就绪。
- 验证：capture 集成 7/7、新增 workflow/前端定向通过、`npm test` 1253/1253、lint 76 文件、5178 healthz 与 frontend runtime smoke 通过、offline acceptance 通过；`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 当前阶段仍是 G2-S1 `CURRENT`。下一步唯一入口：用户在真实 capture `c178476424685142rv6` 点击“确认当前快照”，随后核对生成的 9 SKU 草稿与集中阻塞项；未完成该真实人工回执前不得进入 G3。

## 2026-07-23 G1-S3 首个真实 1688 商品回放完成

- Chrome 扩展已成功采集真实 Offer `992997159052` 到店铺 `3815760-4`，持久化 ID `c178476424685142rv6`；界面返回“已采集过”，同店同 Offer 仍只有 1 条记录。
- 真实回执包含 18 行 SKU 采集结果（归一化后为 9 个唯一来源 SKU）、28 张图片、19 个属性和绑定快照；来源校验为 `ok`。供应商身份、采购 MOQ/阶梯价仍为明确的 `needs_review`，没有被默认值升级为可信证据。
- 修复两个真实阻断：扩展不再通过 runtime message 传递整页 HTML；本地回环 ERP 只允许格式合法的 Chrome 扩展 Origin，外部绑定和普通网站来源仍拒绝。
- 验证：全量 `npm test` 1247/1247、lint 76 文件、runtime smoke（7 views、13 nav bindings、4 stores）及 offline acceptance 通过；未连接 Ozon、未执行付费模型或写入。
- G1 已完成。当前 WIP=1 唯一切片转为 G2-S1：从该真实 capture 生成或复用唯一的店铺绑定本地草稿骨架；不得提前进入真实类目属性、FBS、活动或财务。

## 2026-07-22 顶层计划与防漂移治理

- 用户确认近期唯一目标是“手工采集 1688 后，ERP 自动处理到预检通过、等待人工确认提交”，不再接受围绕无关小点持续深挖。
- 新增 `docs/TOP-LEVEL-DEVELOPMENT-PLAN.zh-CN.md`，采用 G0-G7 阶段门、WIP=1、冻结范围、退出条件和停车场治理。
- G4 MVP 通过前暂停五工作流轮转；FBS、活动、财务和售后冻结，生产化只处理黄金链路直接阻断。
- 当前唯一切片为 G1-S1：手工采集输入契约与现状核对。下一步必须从该切片开始，不能从历史 roadmap 条目或旧计划随意领取工作。
- 本次仅更新计划和代理规则，不修改业务代码、不联网、不连接数据库、不执行 Ozon 写入。

## 2026-07-22 G1-S1 采集契约收口

- 两个 1688 详情扩展、crawler detail 回传和 `/api/1688/capture` 现在共享 `manual_capture_v1`；旧扩展缺少版本号时兼容升级，显式未知版本在解析和持久化前阻断。
- 回执增加 `contractVersion`、`captureIdentity.contractVersion` 与 `sourceEvidence.snapshotHash`，并保持顶层 `snapshotHash` 兼容；HTML 只用于当前解析，不进入回执。
- 定向采集/服务端/扩展测试 187/187；全量 `npm test` 1240/1240，lint 75 文件，offline acceptance 通过。未联网、未连接数据库、未执行 Ozon 写入。验证等级 `locally_tested`。
- G1-S1 已完成。当前唯一切片转为 G1-S2：采集导入的卖家操作入口；仍缺一个真实 1688 商品回放。

## 2026-07-22 G1-S2 采集导入入口收口

- 两个 1688 采集弹窗在新采集或重复采集后自动打开带 `captureId` 的 ERP 当前商品页；仍保留“重新打开当前采集”链接作为恢复入口。
- 1688 详情扩展把 `collectionId` 和脱敏 `captureReceipt` 回传给弹窗；ERP 当前商品页显示来源身份、契约/快照、SKU/图片/采购/尺重覆盖、阻断项和卖家下一步。
- 采集失败、缺尺重和人机验证仍停在人工恢复入口；本切片没有生成或提交 Ozon 草稿。
- 验证：定向扩展/前端测试通过；全量 `npm test` 1240/1240、lint 75 文件、offline acceptance 通过。`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`，验证等级 `locally_tested`。
- G1-S2 已完成。当前唯一切片转为 G1-S3：使用首个真实 1688 商品完成采集、导入、重放和重复导入验证；不扩展边缘类目。

## 2026-07-22 P0 本机恢复后的服务启动收口

- 修复 `server.js` 引用但 `autoListing.js` 未导出的只读任务快照和三项媒体批准持久化函数；服务不再因 ESM 缺失导出而在启动阶段退出。
- `getAutoListingJobSnapshot` 只读取任务，不触发陈旧任务恢复或磁盘改写；店铺可见性、媒体批准和商品 readiness 查询保持只读。
- 媒体批准草稿、发布和并发回滚均绑定当前来源快照、payload 草稿 hash 和精确媒体集合；发布期间 workflow 变化时，本地候选批准会标记 stale 并撤销 `humanApproved`。
- 修复误落入 FBS 订单读取参数的媒体回滚回调，将补偿依赖放回媒体批准发布路由；订单读取不再携带未定义的 `jobId`。
- 新增运行时导入契约测试，逐项核对服务从 `autoListing.js` 引入的所有符号，避免静态源码测试再次漏过启动故障。
- 验证：服务在 `127.0.0.1:5189` 实际启动，healthz 与前端 runtime smoke（7 views、13 nav bindings、4 stores）通过；`npm test` 1237/1237，lint 75 文件，offline acceptance 全部通过。未联网、未连接数据库、未调用 Seller API、未执行 Ozon 写入。验证等级 `locally_tested`；真实四店铺读取与黄金链路实单回放仍未完成。

## 2026-07-20 C34 FBS 履约只读恢复收口

- 订单续页读取失败时保留已读取订单，状态降为 partial，并提供按当前店铺/筛选/游标重试；首批失败仍清空旧订单，避免旧批次冒充当前证据。
- 争议筛选同时检查 `status`、`statusGroup` 和 `substatus` 的 dispute 家族，顶层 `disputed` 不再漏出普通列表。
- 权限或订单服务失败时，订单状态区域直接显示“重新读取当前范围”按钮；按钮只触发当前范围只读读取，不执行备货、发运、取消。
- `/api/ozon/order-dashboard/evidence-receipts` 先执行受控 Seller 只读会话、principal 店铺范围和显式 `storeId` 校验，缺失时返回 `FBS_RECEIPT_STORE_REQUIRED`，不会读取 Ozon 或保存回执。
- 验证：前端静态 295/295，FBS/回执/服务端定向 189/189 以上，全量 `npm test` 1235/1235，lint 75 文件；离线验收检查本身通过（git diff 检查因当前 worktree 元数据损坏返回 fatal）；未联网、未连接数据库、未执行履约写入。验证等级 `locally_tested`；仍缺真实 FBS 订单/争议回放、履约写动作和写后回读。下一轮转 D。

## 2026-07-20 B35 商品与库存真实操作闭环收口

- 库存页“读取库存”按钮绑定到受保护的 `readStockReconciliationEvidence`，继续执行店铺、环境、Offer、仓库、可售状态和未知库存门禁。
- 切换店铺时立即递增商品请求 token，清空旧商品行、状态证据、分页游标和库存准备状态；旧店铺 Offer 不再能在新店铺上下文触发库存核对。
- `/api/ozon/stock-reconciliation/dry-run` 先要求非空 `storeId`，缺失返回 `STOCK_DRY_RUN_STORE_REQUIRED`；不再用 HTTP 200 返回无店铺阻断计划。
- fresh server evidence 显示目标与当前精确 Offer×仓库 tuple 无差异时，库存确认返回 `DIRECT_WRITE_STOCK_NO_CHANGES`，不调用 Ozon 写接口。
- 验证：前端静态 291/291，库存/服务端定向回归通过（含 stock/server 190/190），全量 `npm test` 1231/1231，lint 75 文件；未联网、未连接数据库、未执行 Ozon 写入。验证等级 `locally_tested`；仍缺四店铺真实 Seller API 商品/库存只读回放及写后回读。下一轮转 C。

## 2026-07-20 A36 黄金链路范围与恢复收口

- 类目/属性保存现在要求选中的 `selectedWorkflowRunId` 精确命中当前工作流，且草稿 `storeId` 必须等于当前店铺；失效工作流或跨店草稿直接阻断，避免把类目写入另一商品。
- 人工保存俄文内容、采购、包装资料时，如果旧草稿没有 `workflowRunId`，现在刷新卖家任务摘要并明确提示“重新交接后才能运行预检”，不再静默停止。
- `reconcileWorkflowTaskReadback()` 对已绑定店铺但缺失输入 `storeId` 的回读返回 `WORKFLOW_STORE_REQUIRED`，不更新 review 节点。
- 验证：workflow/server 定向 264/264，前端静态 289/289，`npm test` 1228/1228，`npm run lint` 75 文件；未联网、未连接数据库、未执行 Ozon 写入。验证等级 `locally_tested`；仍缺真实 1688 快照、四店铺 Seller API 只读回放和真实提交/审核回读。下一轮转 B。

## 2026-07-20 E35 生产预检与恢复安全收口

- HTTP `/api/system/deployment-preflight` 与 CLI 同时执行 `migration_dry_run`、`migration_recovery_drill`、迁移状态、生产迁移契约、canonical 四店铺/Seller HTML、磁盘和 runtime 生产门禁；恢复演练仍不会被标记为真实生产证据。
- `readJsonFile(..., { strict: true })` 遇到 `ENOENT` 直接失败，不再把缺失源快照当空集合并写 migration marker；兼容读取的非 strict fallback 保持不变。
- 系统配置运行安全摘要缺字段时，按缺认证、缺数据库、内存模式给出具体运维下一步，同时保留“API 连通不等于生产 ready”。
- 验证：E 定向 444/444，全量 `npm test` 1225/1225，lint 75 文件；未联网、未连接数据库、未执行迁移或 Ozon 写入。验证等级 `locally_tested/configuration_declared`；仍缺真实部署迁移/恢复和 signed session Seller API 回放。下一轮回到 A。

## 2026-07-20 D34 活动、财务与售后用户口径收口

- 活动商品只有明确 `action_price/discount_price` 才参与活动价影响；`min_price/max_action_price` 仅为边界证据，保持未知。可添加候选行明确显示“候选待人工确认 / 需要到 Ozon 活动页确认 / 本页不执行加入”。
- FBS 原始 `status/substatus` 任一包含 dispute，统一进入 `ORDER_DISPUTE` 售后人工任务、争议计数和 dispute 状态组，避免 `disputed` 等变体漏到普通备货/发运。
- 售后风险卡改为引导订单页查看争议/取消，并明确退货、客服动作尚未接入，不再提供回到售后自身的循环入口。
- 验证：D 定向 349/349，前端静态新增活动/售后回归，全量 `npm test` 1223/1223，lint 75 文件；未联网、未连接数据库、未执行活动/财务/售后写入。验证等级 `locally_tested`；下一轮转 E。

## 2026-07-20 C33 FBS 详情与回执可解释性收口

- `buildFbsOrderReadModel` 不再把空查询范围标记为 `requestScoped=true`；没有有效时间、状态、仓库或 cursor 范围的读模型不能生成可绑定 FBS 回执。
- FBS 订单行缺少 `posting_number` 时显示禁用的“无法重读：缺少货件编号”，不再提供点击无响应的详情按钮。
- 详情成功回读展示最多 20 个 Offer/SKU、数量、商品名称；数量缺失显示“数量未知，需重读”，并保留只读人工下一步，不引导备货/发运。
- 验证：FBS 订单/回执与前端定向通过（含 283 项前端静态回归）；全量 `npm test` 1219/1219，lint 75 文件；未联网、未连接数据库、未执行履约写入。验证等级 `locally_tested`；仍缺真实 FBS 订单/详情/争议回放。下一轮转 D。

## 2026-07-20 B34 商品可售到库存核对可操作性收口

- 库存页 `stockJson` 默认为空数组，不再携带示例 Offer、目标数量或仓库 ID；目标库存必须由商品交接或卖家真实输入产生。
- 仓库读取列表在库存交接已带入 Offer 时提供“应用到待填写目标”，只写入当前已观测的仓库 ID，不猜仓库、不写 Ozon，并使旧库存证据失效，卖家再填写真实目标数量后读取精确 tuple 证据。
- `/api/ozon/stock-reconciliation/dry-run` 在生成计划前强制显式读取环境，缺失返回 `STOCK_DRY_RUN_ENVIRONMENT_REQUIRED`，成功响应回显 `environment`，防止其他调用方拿无环境计划继续人工确认。
- 验证：B 定向 468/468，前端静态新增仓库交接回归，全量 `npm test` 1219/1219，lint 75 文件；未联网、未连接数据库、未执行 Ozon 写入。验证等级 `locally_tested`；仍缺四店铺真实商品/仓库/库存只读回放。下一轮转 C。

## 2026-07-20 A35 黄金链路用户操作与提交回读收口

- 上架中心所有黄金链路主动作（补来源、确认类目、补尺重、修复定价、运行预检、人工确认）统一先切换到“当前商品”工作台，再刷新当前工作流摘要，避免按钮点击后落在旧阶段造成“无响应”错觉。
- 采集箱重复运行本地预检/生成草稿按 `captureId + storeId` 严格复用已有本地草稿；不同店铺不复用，已有草稿缺 workflow 时补建并返回 `duplicate=true`，避免刷新或重试产生多个商品任务。
- `reconcileSubmittedJobs` 对 submitted/pending_moderation 任务使用 `listingResult.storeId || job.storeId`；缺少或已失效的店铺配置不再被过滤掉，转为 `needs_review`、`LISTING_STORE_UNAVAILABLE` 并提供恢复店铺绑定后重查的卖家动作。
- 验证：`capture-draft-integration` 3/3、`auto-listing-match` 9/9、前端静态 279/279；全量 `npm test` 1213/1213，lint 75 文件；未联网、未连接数据库、未执行 Ozon 写入。验证等级 `locally_tested`；仍缺真实提交回读与四店铺 Seller API 只读回放。下一轮转 B。

## 2026-07-20 B33 商品、价格与库存证据口径收口

- 价格证据只把 `current_price/currentPrice/price` 视为当前价；`old_price/min_price/acquiring_price/marketing_seller_price` 不能单独让读取批次变成 completed 或 safeToConclude。
- 商品总览在读取 partial、覆盖未完成或仍处于旧批次时，售价显示“未知”，并明确不能作为当前售价或利润结论。
- `stock-reconciliation/dry-run` 强制要求非空 `storeId`；缺少店铺范围时加入 `missingEvidence=storeId`，不会生成可执行库存计划或跨店幂等键。
- 定向验证：价格/商品/库存/前端/服务端相关测试通过；未联网、未连接数据库、未调用真实 Seller API、未执行 Ozon 写入。验证等级 `locally_tested`；仍缺四店铺真实商品/价格/库存只读回放与写后回读。下一轮转 C。

## 2026-07-20 A34 强预检重复校验 1688 canonical 来源身份

- `buildPreflightGateNode` 在每次强预检/提交前重跑时严格校验 `detail.1688.com/offer/<数字>` canonical URL，不再接受仅包含 `1688.com` 的伪 URL。
- URL 中的 Offer ID 必须与 `sourceEvidence.offerId` 一致；冲突返回 `SOURCE_OFFER_URL_MISMATCH`，不会进入提交。
- 验证：A 定向 `166/166`；全量测试退出码 0（当前测试集）；`npm run lint`（75 files）；`npm run offline-acceptance` 通过。验证等级 `locally_tested`，未联网、未调用模型、未执行 Ozon 写入。剩余真实 1688 快照、Seller API 类目/属性、提交和审核回读；下一轮转 B。

## 2026-07-20 E34 部署预检入口一致性收口

- HTTP `/api/system/deployment-preflight` 增加与 CLI 相同的 `api_evidence` 检查：canonical 四店铺来源必须匹配，Seller API HTML 指纹和端点覆盖必须匹配基线；失败会进入统一 blockers 并保持 `deploymentReady=false`。
- 检查只读取本地配置元数据/文档指纹，不返回凭据、不连接数据库、不调用 Ozon；HTTP 与 CLI 不再因入口不同给出相反的部署结论。
- 验证：E 定向 173/173；全量测试退出码 0（当前 1203 项）；`npm run lint`（75 files）；`npm run offline-acceptance` 通过。验证等级 `configuration_declared/locally_tested`，真实迁移/恢复、认证环境、signed session 和 Seller API 回放仍未完成；下一轮回到 A。

## 2026-07-20 D32 活动与经营读模型口径收口

- 活动页面只有在活动列表和参与/候选详情均有完整 coverage 证据时才显示确定数量；partial、unknown、空范围均显示未知。
- 活动影响预览要求当前价和活动价均为正数；零值或缺失保持 unknown，不计算虚假的 100% 降幅。
- 财务收入按状态族排除 `cancel*`、`dispute*` 等取消/争议订单，等待结算/退款明细；不因状态带后缀而误计销售额。
- 验证：D 线定向通过；全量测试退出码 0；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；验证等级 `locally_tested`，未联网、未连接数据库、未执行活动/财务/售后写入。剩余真实结算、退款、活动范围和利润回读；下一轮转 E。

## 2026-07-20 A33 采集候选到上传队列的店铺/工作流续接收口

- 同 URL 草稿复用要求既有草稿绑定当前店铺；重复交接按精确 `autoListingJobId/candidateId` 解析 workflow，不回退无关商品。
- 全量 `npm test` `1197/1197`、lint `75 files`、offline acceptance 通过；验证等级 `locally_tested`，未联网、未连接数据库、未执行 Ozon 写入。下一轮转 B。

## 2026-07-20 B32 上传结果到商品/库存入口收口

- 商品状态回查接口要求 query 显式提供读取环境，不再回退部署环境变量；因此旧任务不能被错误归入另一环境。
- 库存队列新增 `productImportReadiness`：只有 `import-info.status=imported` 且没有错误的商品才能继续，rejected、moderation_failed、error、状态缺失即使有 `product_id` 也保持阻断。
- 商品总览在 partial/loading/unknown 读取时不再沿用旧“在售”状态或绿色样式；`visible=false` 明确显示不可见。
- 验证：B 线定向通过；全量 `npm test` `1199/1199`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；验证等级 `locally_tested`，未联网、未连接数据库、未执行库存或 Ozon 写入。剩余真实四店铺商品状态/库存回放和写后回读；下一轮转 C。

## 2026-07-20 C32 FBS 只读证据和卖家动作一致性收口

- `buildFbsEvidenceReceipt` 不再信任矛盾的 `datasetComplete=true`；只有 page 完成、无下一页、非 partial、全部端点 completed、无 missing evidence 才保存完整范围，否则降级 partial。
- FBS 当前页无待处理订单但 `hasNext=true` 时，下一步明确继续读取后续分页；待备货/待发运只显示人工核对，不提供本页履约动作。
- `/v3/posting/fbs/get` 详情读请求显式携带 environment，服务端回传并校验 environment；store、environment、请求代次和 posting identity 任一不匹配都丢弃迟到回执。
- 验证：C 线定向通过；全量 `npm test` `1203/1203`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；验证等级 `locally_tested`，未联网、未连接数据库、未执行履约写入。剩余真实 FBS 订单/争议回放、履约写动作及写后回读；下一轮转 D。

## 2026-07-20 E33 生产预检、实例健康与观测一致性收口

- `/api/system/deployment-preflight` 与 `scripts/deployment-preflight.mjs` 现在共用严格 `productionDeploymentDecision`，按所有 checks 动态返回 `ok/deploymentReady`；仍保持 `configuration_declared`，不连接数据库、不执行迁移。
- 实例健康报告新增未来时间门：heartbeat 超过当前时间 5 分钟返回 `INSTANCE_HEARTBEAT_FUTURE`，不把时钟漂移/伪造摘要当成新鲜实例。
- 系统配置增加服务观测卡，区分未读取、读取失败、high 告警、一般告警和无 high 告警；文案明确服务观测不等于 Seller API 连通、生产部署或业务 readiness。
- 验证：E 线定向 `430/430`；全量 `npm test` `1194/1194`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过，`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 外部条件：真实数据库/迁移/备份恢复、认证环境、店铺 scope、HTTPS 和 Seller API 只读回放仍未提供；下一轮回到 A，继续黄金链路。

## 2026-07-20 D31 活动与经营口径收口

- 活动影响预览只接受明确的 `action_price/actionPrice/discount_price`；`min_action_price/max_action_price` 只是区间边界，不能单独生成降幅或影响结论。
- 财务收入排除 `cancelled/canceled/cancel/dispute/disputed`，并同时检查 `statusGroup`、原始 `status`、`status_name`；即使适配器把分组标为 unknown，也不能把取消/争议金额升级为销售额。
- 财务前端把 `hasNext`、`paginationComplete=false` 和分页证据缺失统一视为订单范围未完成，显示销售额未知并引导继续读取，不显示当前批次估算。
- 验证：活动/财务/前端/服务端定向 `447/447`；全量 `npm test` `1192/1192`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过，`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 剩余：真实结算、退款、活动完整范围和利润回读尚未完成；下一轮转 E，复核生产化与真实只读回放前置条件。

## 2026-07-20 C31 FBS 只读履约证据收口

- 订单 posting 中的 `sku` 只匹配商品详情的 `sku`；`offer_id` 仍匹配详情的 `offer_id/offerId`，不再使用详情的 `id/product_id` 作为 sku 兜底，防止数字碰撞把其他商品名称/图片挂到当前订单。无法明确匹配时保持 `ORDER_PRODUCT_EVIDENCE_MISSING`。
- FBS 回执保存数值或字段形式的 HTTP 403、429、5xx 语义（如 `403_FORBIDDEN`、`429_RATE_LIMIT`、`5xx_SERVER_ERROR`），查询页面保持 `needs_review`，不自动重试履约动作。
- 订单行只读界面按争议、截止时间、商品详情/数量证据和待备货/待发运状态给出卖家下一步；证据不足或争议状态明确提示不要备货、发运或取消。
- 验证：FBS/服务端/前端定向 `453/453`；全量 `npm test` `1188/1188`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过，`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 剩余：真实 FBS 订单/争议回放、履约动作及写后回读仍未验证；下一轮转 D，检查活动/经营数据不把不完整订单证据当成利润结论。

## 2026-07-20 A32 1688→Ozon 单商品提交前证据闭环

- `build1688CaptureImportReview` 校验 canonical 1688 URL 中的 Offer 编号与显式 `sourceEvidence.offerId`；不一致返回 `CAPTURE_OFFER_URL_MISMATCH`，不会进入草稿。
- 最终 `completeListing` preflight 传入当前 `pricingDiagnosis`；手工 MOQ/阶梯价等采购证据即使字段完整仍是 `needs_review`，提交前返回 `PRICING_PROCUREMENT_EVIDENCE_REVIEW_REQUIRED`，不调用 Ozon import。
- 卖家预检摘要新增媒体证据卡：明确 `blocked / needs_review / verified / not_required`、下一步和“不会上传媒体或提交 Ozon”，避免隐藏媒体硬门。
- 验证：黄金链路定向 `435/435`；全量 `npm test` `1184/1184`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过，`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 剩余：仍未取得真实 1688 快照、真实 Seller API 类目/属性回执、真实提交及审核回读；下一轮转 C，保持 FBS 只读，不扩大到履约写入。

## 2026-07-20 E32 生产化认证、观测与恢复边界收口

- `/api/auth/session-proof` 只接受 signed session 自身明确绑定的 environment；不再回退部署环境，缺失时返回 `SESSION_PROOF_ENVIRONMENT_REQUIRED`，避免把未绑定会话升级成可执行的 server proof。
- `testApi` 现在读取脱敏 `/api/system/observability` 摘要；存在 high severity 告警时显示“API 正常，但服务有错误告警”，观测失败不会覆盖运行安全结论，也不会声称业务 readiness。
- `restoreJsonFile` 与写入侧共用 `${target}.lock`：锁内校验备份、复制临时文件并原子替换，避免服务重启恢复覆盖正在切换的 `.bak` 快照。
- 验证：E 线定向 `437/437`；全量 `npm test` `1181/1181`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过，`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 外部条件：`node scripts/deployment-preflight.mjs` 仍 fail-closed，缺 `MIGRATION_STATE`、隔离备份/回执、生产数据库后端、认证环境、部署/ principal store scope、HTTPS 和多实例撤销声明；这些不能用本地测试替代。下一轮转 A，继续 1688 单商品黄金链路。

## 2026-07-20 B31 商品状态到库存入口收口

- `/api/ozon/product-stocks`、前端 `readStock` 同时绑定当前店铺、读取环境和请求代次；环境切换或迟到响应会被丢弃，普通库存展示不会冒充可写入证据。
- 商品状态 handoff 在库存尚未读取时显示“库存证据尚未读取”，不再使用完成样式，也不把空白数量解释为 0；真实 Offer×warehouse 对账仍必须进入库存证据聚合路径。
- 库存回执完整性门现在逐项检查目标 Offer×仓库 tuple 和明确非负数量（`stock/quantity/present`），调用方提供的 `completeForRequestedIds` 不能单独升级证据；缺失返回 `STOCK_RECEIPT_EXACT_TUPLES_REQUIRED`，partial 只用于诊断。
- 验证：B 线定向 `478/478`；全量 `npm test` `1179/1179`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过，`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 剩余：真实 signed session 下四店铺商品状态/库存只读回放、库存写前与写后回读尚未执行；下一轮转 E，核对生产化认证、部署和受控回放前置条件。

## 2026-07-20 A31 类目读取证据与属性字典范围收口

- 受控类目树、属性和字典值读取现在生成通用 `server_observed` 回执，绑定当前 `storeId`、environment hash、端点覆盖和签名会话范围；成功/部分结果不会再因为专用计划字段缺失而丢失回执。
- Seller API 属性字典值响应出现 `has_next=true` 时只认作 `partial`，不写入完整缓存，并清除同范围旧完整值缓存；只有分页完整才可驱动后续预检。
- 旧类目缓存必须匹配当前店铺与读取环境；前端属性读取按请求代次、店铺和环境校验并丢弃迟到/跨范围回执，避免重建错误草稿。
- 验证：类目/服务端定向通过；全量 `npm test` `1177/1177`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过，`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 剩余：尚未取得真实 signed session 下四店铺类目树/属性/字典值回放；下一轮转入 B，验证这些证据如何驱动商品状态与库存入口，不扩大到 Ozon 写入。

## 2026-07-20 受控读取执行链收口

- `/api/ozon/read-operator/execute` 的成功与失败回执均保存 `signedSessionBound`、`authSource` 和 scope/environment 绑定哈希；不保存 Token、Cookie 或请求头。
- `taskId/task_id` 贯穿计划校验、plan binding 和 `/v1/product/import/info` 请求构造，避免导入审核回查执行时丢失任务号。
- 只有完整商品列表/详情端点的 `server_observed` 回执才刷新商品页；部分、失败或跨店/跨环境迟到回执不会覆盖当前商品状态。
- 验证：全量 `npm test` `1174/1174`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；未联网、未连接数据库、未执行 Ozon 写入。
- 真实读取仍需服务端签发的匹配 signed session 和人工确认；当前代码仍不能把本地执行链测试写成真实店铺回放。

## 2026-07-20 受控真实读取前置契约

- canonical 店铺来源仍为 `4/4`，Seller API HTML 矩阵为 `matched`；当前进程没有真实 signed session、环境或部署 store scope，因此真实读取安全门保持阻断。
- `/api/auth/session-proof` 现在显式返回 gate 要求的 `verified=true`；审核回查响应补充 `storeId/environment`，前端按请求代次、店铺和环境丢弃迟到回执。
- `/v1/product/import/info` 已纳入受控读取端点，严格要求正整数 `task_id`，并将 taskId 纳入计划绑定，避免不同导入任务串用回执。
- 使用示例 proof 生成矩阵只能得到 `configuration_declared`；示例环境和占位店铺范围不匹配，不能改写为真实值冒充 proof。真实执行必须从已认证 ERP 会话获取服务端 proof，再经 `/api/ozon/read-operator/execute`。
- 验证：只读契约/服务端/前端定向通过；全量 `npm test` `1171/1171`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；未联网、未连接数据库、未执行 Ozon 写入。

## 2026-07-20 P0 主链旁路修复

- 审核回读 route 绑定 signed session、environment、单个 job 和精确 store；商品状态 adapter 收到同一环境，后台 supervisor/定时器不再无会话读取 Seller API。
- 商品总览只有完整、30 分钟内、`server_observed` 的 `selling/ready_for_sale` 证据才显示库存核对；其他状态只显示查看状态/修复商品。
- `import-info` 连续超时/5xx 返回未知结果，任务保持 `needs_review` 并记录 `OZON_IMPORT_INFO_OUTCOME_UNKNOWN`，不会自动重试或排库存写入。
- 验证：相关定向 `202/202`；全量 `npm test` `1170/1170`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；未联网、未连接数据库、未执行 Ozon 写入。
- 验证等级：`locally_tested/mocked`。真实 Seller API 只读回放、真实审核回读和真实上架仍未完成。下一步按黄金链路执行受控四店铺只读回放，先拿到真实商品状态/类目属性证据再推进单商品提交。

## 2026-07-20 D30 前端财务 fallback 与服务端销售额口径统一

- 修复经营数据的真实一致性断点：服务端已排除 `cancelled/dispute` 订单并保持净销售额未知，但前端旧响应兼容路径仍会累加这些订单；现在 `financeSnapshotRevenue` 同样排除取消/争议订单，存在这类订单时返回未知，要求回读结算/退款明细。
- 前端仍将活动价只显示为价格影响估算，不把活动折扣、订单金额或上架定价推导成确定利润；没有放宽成本、佣金、物流、杂费和结算证据门。
- 验证：财务/前端定向 `279/279`；全量 `npm test` `1166/1166`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过（`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`）。
- 剩余：真实结算/退款明细、活动完整范围和利润结果仍未做真实店铺回读；下一轮按框架转入 E，检查生产化配置、部署、监控和真实只读运行前置条件。

## 2026-07-20 C30 FBS 汇总层争议优先级

- FBS 单行任务此前已把 `substatus=dispute` 置于截止时间/仓库动作之前，但页面级汇总仍先显示“12 小时内到期”；现在 `buildSellerView` 在同一批订单同时存在争议和临近截止时，统一优先显示争议人工处理，避免卖家被引导去备货或发运。
- 继续保持只读边界：争议订单只进入人工处理任务，不生成备货、发运、取消或标签动作；v4 cursor 分页、商品详情绑定、仓库映射和截止时间证据规则未放宽。
- 验证：FBS/前端定向 `289/289`；全量 `npm test` `1165/1165`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过（`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`）。
- 剩余：仍缺真实 FBS 订单/争议回放及受控履约写入与写后回读；下一轮按框架转入 D，检查活动/财务经营数据是否把履约状态和不完整范围错误纳入经营结论。

## 2026-07-20 B30 商品可见性纳入库存入口门

- 商品状态回读现在要求每个 Offer 同时满足 Seller API 状态为可售、Offer 覆盖完整、时间新鲜、两个商品只读端点均已尝试，并且 `visible === true`；仅有 `selling` 但 `visible=false` 或缺失可见性字段时保持 `pending_moderation`，不会出现“已明确可售”或引导进入库存核对。
- 卖家视图对这两种情况给出具体动作：隐藏商品回 Ozon 商品详情处理隐藏原因，未知可见性重新读取商品详情；只有完整可见证据才进入精确 `offer_id/warehouse_id` 库存预演。未增加商品、价格或库存写入。
- 验证：商品质量/库存/前端定向 `364/364`；全量 `npm test` `1164/1164`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过（`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`）。
- 剩余：仍缺真实 Seller API 商品状态回放和真实库存读取/写后回读；当前状态是本地契约与 mocked/controlled-read 逻辑验证，不代表店铺商品已售。下一轮按框架轮转 C，保持 FBS 只读边界并检查订单范围到履约动作的闭环。

## 2026-07-20 A30 1688 草稿绑定当前店铺类目属性回执

- 修复 1688→Ozon 主链的真实断点：生成草稿时不再只保存 1688 来源证据；现在把当前类目缓存中的 `tree` 与精确 `description_category_id:type_id` 属性读取回执、店铺 ID、环境 hash 一并写入持久化 `preflightPolicy`。后续重新校验 Payload 或提交前预检会复用同一强策略，缺回执、缺店铺绑定、环境不一致或属性类目 key 不一致都会返回 `CATEGORY_EVIDENCE_MISSING`，不会把本地旧缓存当成当前店铺证据。
- 新增 `categoryReadPolicyForListing` 纯投影和回归测试；只保存回执元数据，不保存凭据或属性原始响应。非 1688 旧草稿兼容路径不改变；1688 草稿仍只到本地预检/人工确认，不自动调用 Seller API 或执行 Ozon 写入。
- 验证：类目/属性/工作流/1688 草稿定向 `156/156`；全量 `npm test` `1163/1163`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过（`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`）。
- 剩余：当前仍没有真实店铺的 Seller API 类目树/属性回执，无法宣称真实上架可用；仍需受控读取后再验证属性值、提交、审核回读和库存就绪。下一轮按框架轮转 B，检查商品状态回读到库存对账的用户闭环。

## 2026-07-20 E31 生产认证环境声明门

- `productionDeploymentDecision` 现在要求 `OZON_ERP_AUTH_ENVIRONMENT`（或 `OZON_ERP_ENVIRONMENT`）非空，并将 `authEnvironmentConfigured` 纳入快照；缺失时返回 `auth_environment_required`，不会把缺少环境绑定的签名会话部署报告为可用。
- 该门与受控 Seller API 的 signed-session 环境严格匹配规则一致；本地 loopback 开发兼容路径不变，未新增网络、数据库或 Ozon 写入。
- 验证：运行安全/部署/服务端定向 `30/30`；全量 `npm test` `1162/1162`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过。
- 剩余：仍缺真实部署环境 session proof、真实 Seller API 只读回执和多实例撤销后端；下一轮按框架回到 A，继续 1688→Ozon 主链的属性/提交前证据。

## 2026-07-20 D29 取消/争议订单销售额口径门

- 财务只读模型不再把 `cancelled` 或 `dispute` 订单的商品行直接累加进销售额；存在这类订单时销售额保持未知，并记录 `excludedRevenueOrders` 与 `ORDER_REVENUE_STATUS_UNRESOLVED`。
- 卖家下一步改为回读当前店铺结算/退款明细并复核取消、争议订单后再看净销售额；活动价格仍只是影响估算，利润仍要求成本、佣金、物流、杂费和结算证据。
- 验证：财务/活动/前端定向 `278/278`；全量 `npm test` `1161/1161`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；未联网、未连接数据库或执行写入。
- 剩余：真实结算/退款回读、活动完整范围和利润结论仍未验证；下一轮按框架回到 E，检查生产化证据和部署风险。

## 2026-07-20 C29 FBS 争议状态优先人工处理

- FBS `substatus` 含 dispute 的订单现在明确标记为 `statusGroup=dispute`、卖家标签“争议”，不再落入“状态未知”；争议任务优先于仓库映射和发运截止时间判断，下一步固定为人工处理。
- 争议订单不会被引导到备货、取消或发运；原有商品详情、数量、仓库、截止时间、分页和只读回执安全门保持不变。
- 验证：FBS/前端定向 `288/288`；全量 `npm test` `1160/1160`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；未联网、未连接数据库或执行 Ozon 履约写入。
- 剩余：真实 FBS 争议订单只读回放和真实履约动作仍未验证；下一轮按框架回到 D，检查活动/财务数据是否把争议订单或不完整范围错误纳入经营结论。

## 2026-07-20 B29 库存目标空值 fail-closed

- 库存预演目标编辑器现在在发送前逐行校验 `stock`：空值、负数、小数和非安全整数都返回 `STOCK_EVIDENCE_TARGET_STOCK_INVALID`，并明确提示“空值不会按 0 处理”；合法值会规范化为整数后再生成 dry-run 签名。
- 预演错误保留具体卖家动作，不再把目标字段错误泛化成“检查连接”；商品可售、精确 Offer×仓库、当前库存、服务端回查和写入确认门均未放宽。
- 验证：库存/前端定向 `261/261`；全量 `npm test` `1158/1158`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；未联网、未连接数据库或执行 Ozon 写入。
- 剩余：库存页仍需要真实店铺读取验证；下一轮按框架回到 C，保持履约只读边界并检查订单到仓库动作的用户闭环。

## 2026-07-20 E30 只读超时卖家恢复动作

- 受控 Seller API 只读链路已有内部超时 reconciliation 状态，但普通卖家任务此前仍会把超时泛化为依赖失败；现在单独输出 `READ_TIMEOUT_RECONCILIATION_REQUIRED`，要求保留同一店铺、环境、范围和操作计划，先核对当前端点回执，禁止用新幂等键重试。
- 仍不执行自动重试、商品/库存/订单写入或履约动作；权限、限流、过期和部分覆盖的优先级保持不变。
- 验证：只读运维/回执/服务端定向 `159/159`；全量 `npm test` `1157/1157`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；未联网、未连接数据库或执行 Ozon 写入。
- 剩余：没有真实店铺超时回放和服务端持久化回执；下一轮回到 B，检查商品状态回读到库存对账的用户动作闭环。

## 2026-07-20 A29 卖家确认类目真正驱动 Payload

- 修复 1688→Ozon 主链断点：卖家在类目界面确认的 `description_category_id/type_id/path` 现在会重新对照当前本地类目缓存，并实际作为 payload 的 `categoryMatch`；不再只保存 UI 状态后又被自动匹配覆盖。
- 手工类目不在当前缓存时返回 `LISTING_CATEGORY_NOT_IN_CACHE`，提示先刷新 Ozon 类目再确认；生成草稿时同样 fail-closed，不静默替换为另一类目。仍是本地缓存证据，不代表当前真实 Ozon 类目树已读取。
- 验证：类目/服务端定向 `142/142`；全量 `npm test` `1157/1157`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；未联网、未连接数据库或执行 Ozon 写入。
- 剩余：类目缓存仍缺真实 Seller API 受控只读回执，类目后的必填属性、提交、审核回读和库存就绪仍未完成；下一轮按框架回到 E，继续生产化读取证据准备。

## 2026-07-20 C28 FBS 失败场景恢复动作

- FBS 只读回执现在保留受限的失败场景与原因码，并将权限不足、限流、超时映射为不同的卖家恢复动作；旧回执的新鲜度门仍优先，避免把过期证据误导为可继续履约。
- 本轮没有新增备货、发运、取消或标签写入；失败恢复只要求用同一订单范围重新读取/核对，不自动重放履约动作。
- 验证：FBS 定向 `9/9`；全量 `npm test` `1156/1156`；`npm run lint`（75 files）；`npm run offline-acceptance` 通过；未联网、未连接数据库或执行 Ozon 写入。
- 剩余：仍缺真实 FBS 权限/限流/超时回放、真实订单读取与写后回执；下一轮按框架回到 A，继续 1688→Ozon 黄金链路的类目/属性与来源证据交接。

## 2026-07-20 D28 财务前端未来时间证据门

- 财务读模型服务端已经拒绝未来时间订单证据；本轮补齐旧响应兼容路径 `buildFinanceSellerResultFromSnapshot`，对未来超过 5 分钟的 `checkedAt` 同样保持销售额未知并返回 `ORDER_READ_TIMESTAMP_INVALID`，不显示当前销售额。
- 活动价影响仍只作为价格比较估算，成本、佣金、物流、杂费和结算规则不足时不生成利润结论；本轮没有新增活动或财务写入。
- 验证：财务/活动/前端定向 `285/285`；全量 `npm test` `1155/1155`、`npm run lint`（75 files）、`npm run offline-acceptance` 通过；未联网、未连接数据库或执行 Ozon 写入。
- 剩余：真实订单、活动、结算和财务明细仍未验证；下一轮按框架回到 C，保持 FBS 只读边界并检查履约回执的恢复路径。

## 2026-07-20 B28 商品回读时间戳 fail-closed

- `reconcileImportedProductReadiness` 现在拒绝无效或未来超过 5 分钟的 Seller API `readAttempt.checkedAt`；即使所有 Offer 状态为 `selling`、覆盖完整且端点齐全，也只保留 `pending_moderation`，证据标记为 `timestamp_invalid/READ_EVIDENCE_TIMESTAMP_INVALID`。
- 原有缺失时间戳、旧于任务更新时间、部分 Offer 覆盖和端点失败门保持不变；只有有效、新鲜、完整的 `/v3/product/list` 与 `/v3/product/info/list` 回读才可进入 `ready_for_sale`，之后仍需单独库存证据。
- 验证：商品质量/库存/服务端/前端定向 `501/501`；全量 `npm test` `1155/1155`、`npm run lint`（75 files）、`npm run offline-acceptance` 通过；未联网、未连接数据库或执行 Ozon 写入。
- 剩余：真实商品详情回读、审核状态和库存就绪仍未验证；下一轮按框架回到 D，审计经营数据不能把旧商品状态推导成当前利润结论。

## 2026-07-20 E29 受控只读 session 环境绑定门

- 服务端 `controlledReadSessionBlock` 现在要求 `session_cookie/session_bearer` 对应的 signed session 必须带非空环境声明，并且严格等于本次读取计划的 environment；缺失或不一致均在解析店铺凭据、调用 Seller API 前阻断。
- 这修复了“有有效 session 但没有环境绑定”可能被兼容路径放行的问题；客户端 session proof、四店铺矩阵、计划绑定和服务端脱敏回执规则保持不变。
- 验证：读取运算/回执/服务端/运行安全定向 `196/196`；全量 `npm test` `1154/1154`、`npm run lint`（75 files）、`npm run offline-acceptance` 通过；未联网、未连接数据库或执行 Ozon 写入。
- 剩余：仍未使用真实签名 session 执行 Seller API 读取；需要用户授权后记录店铺、环境、范围、时间和服务端回执。下一轮按框架回到 B，检查商品详情读取与草稿状态的真实回读交接。

## 2026-07-20 A28 1688 来源证据状态门

- 1688 快照导入审查现在除了 canonical URL、Offer ID、SHA-256 和人工确认 hash 外，还要求 `sourceEvidence.verificationState === "ok"`；`waiting_human`、`unknown` 或缺失状态即使人工确认了 hash，也保持 `needs_review`，不会创建商品草稿。
- 这修复了“确认的是同一份快照，但快照本身尚未通过采集来源验证”仍可进入草稿的证据升级漏洞；不改变后续类目/属性、采购、媒体、尺重、定价和提交前预检门。
- 验证：黄金链路定向 `63/63`；全量 `npm test` `1154/1154`、`npm run lint`（75 files）、`npm run offline-acceptance` 通过；未访问 1688、Seller API、数据库或执行 Ozon 写入。
- 剩余：仍缺受控真实 1688 快照、Seller API 类目/属性只读回执、真实提交/审核回读和库存就绪证据；下一轮按框架回到 E，检查真实回放所需的运行配置和审计入口。

## 2026-07-20 E28 健康检查损坏快照 fail-closed

- `scripts/health-check.mjs` 不再把无法解析或结构错误的 `data/auto-listing-jobs.json` 当成空队列；现在返回 `HEALTH_STORAGE_CORRUPT`、恢复动作和只读副作用说明，并以失败退出码结束。
- 健康摘要新增 `storageState`、`needsReview`、`pending`、状态计数、最近 24 小时原因摘要和卖家/运维下一步；首次运行没有快照时明确显示 `missing`，不会误报生产健康。
- 验证：健康摘要定向 `3/3`；全量 `npm test` `1153/1153`、`npm run lint`（75 files）、`npm run offline-acceptance` 通过；健康检查仅读本地文件，离线验收 `networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 剩余：仍没有真实部署进程、Supabase、反向代理或生产监控回执；下一轮回到 A，推进 1688→Ozon 单商品黄金链路的受控真实只读准备。

## 2026-07-20 B27 商品状态时间戳新鲜度门

- 库存预演现在同时检查商品的 `statusFreshness/status_stale` 与 `checkedAt/statusCheckedAt/status_checked_at`；时间无效、未来超过 5 分钟或早于 1 小时的商品状态，即使状态值仍为 `selling`，也阻断为 `PRODUCT_NOT_READY`，要求重新读取商品详情和审核状态。
- 这只收紧了“商品状态→库存预演”的证据边界，没有新增库存写入；精确 Offer×仓库当前库存、仓库模式、写后回读和人工确认门保持不变。
- 验证：库存队列/库存证据定向 `58/58`；全量 `npm test` `1150/1150`、`npm run lint`（74 files）、`npm run offline-acceptance` 通过；`networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 剩余：真实商品状态与库存读取、真实写入后的回读仍未验证；下一轮按框架轮转 E，检查生产运行时与部署可操作性，避免连续扩展同一库存支线。

## 2026-07-20 A27 1688 来源身份门前移到草稿入口

- `build1688CaptureImportReview` 现在在“人工确认快照→生成草稿”之前同时要求 canonical `detail.1688.com/offer/<数字>` URL 和明确 Offer ID；非 1688 URL、缺失 Offer ID 分别返回 `CAPTURE_SOURCE_URL_INVALID`、`CAPTURE_OFFER_ID_MISSING`，不会创建本地商品草稿。
- 该门仍要求同一 SHA-256 快照人工确认、重复 Offer 去重和后续 Payload preflight；只是把卖家走错来源的阻塞提前，未放宽任何提交或 Ozon 写入边界。
- 验证：采集/回放/候选/服务端定向 `197/197`；全量 `npm test` `1149/1149`、`npm run lint`（74 files）、`npm run offline-acceptance` 通过；未访问 1688、Seller API、数据库或执行 Ozon 写入。
- 剩余：真实 1688 浏览器快照、真实 Seller API 类目/属性读取、提交/审核回读仍需受控环境和授权；下一轮按框架轮转 B。

## 2026-07-20 D27 财务订单证据新鲜度门

- 财务读模型现在消费订单批次的 `checkedAt`：时间无效或超过默认 1 小时新鲜窗口时，销售额保持 `null`，生成 `ORDER_READ_STALE`/`ORDER_READ_TIMESTAMP_INVALID`，卖家必须重新读取当前店铺订单范围。
- FBS 订单看板把服务端读取时间传给财务投影；前端兼容旧响应时也执行同一新鲜度门，避免旧缓存看起来像当前销售额。
- 活动价格影响仍只是 estimate，利润仍要求采购成本、物流、佣金、杂费和结算规则的真实证据；本轮没有新增活动写入或利润公式。
- 验证：活动/财务/服务端/前端定向 `415/415`；全量 `npm test` `1148/1148`、`npm run lint`（74 files）、`npm run offline-acceptance` 通过；未联网、未连接数据库、未执行 Ozon 写入。
- 剩余：真实订单/活动/结算读取、费率版本化和利润报表仍未验证；下一轮按框架轮转回 A，推进 1688→Ozon 黄金链路的受控真实证据准备。

## 2026-07-20 C27 FBS v4 回执卖家下一步与验证等级

- FBS 服务端回执现在保存并返回 `verificationLevel=server_observed`；查询接口把当前 cursor、分页、端点失败和 freshness 统一投影为 `status`、`stale`、`nextAction`、`sideEffect`，不再让“当前页完成”看起来像“全量履约范围完成”。
- 前端回执摘要显示状态、验证等级和下一步：继续下一批 cursor、重新读取过期/部分证据，或仅把完整范围作为只读判断；明确不会备货、发运、取消或打印标签。
- 验证：FBS/服务端/前端定向 `407/407`；全量 `npm test` `1146/1146`、`npm run lint`（74 files）、`npm run offline-acceptance` 通过；离线验收 `networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 剩余：没有真实店铺 v4 读取、权限失败回放或履约写后回查；下一轮轮转 D 的活动/财务证据覆盖，FBS 不继续扩展写动作。

## 2026-07-20 E27 生产预检统一运行时阻断与验证等级

- 修复 `/api/system/deployment-preflight` 只汇总迁移/磁盘、遗漏认证、持久化、店铺范围和 HTTPS 等运行时阻断的问题；现在统一返回 `runtime_startup`、`migration_state`、`production_migration_contract`、`disk_space` 四类 checks，并将每个阻断绑定检查名和卖家/运维下一步。
- 接口明确返回 `verificationLevel=configuration_declared`、`deploymentReady=false`；本地配置检查不会被前端渲染为生产就绪。
- 验证：定向 server routes `144/144`、deployment preflight `4/4`、全量 `npm test` `1144/1144`、`npm run lint`（74 files）、`npm run offline-acceptance` 通过；离线验收 `networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 剩余：仍未连接真实 Supabase、未执行真实迁移/恢复、未完成 Seller API 受控读取或 Ozon 写后回执；下一轮轮转到 C 的 v4 只读回放/权限回执验收，不能把本轮配置门当作生产完成。

## 2026-07-20 P0 1688→Ozon 草稿/回读闭环收口

- 修复并补回候选交接、捕获快照人工确认、手工内容/类目/采购/包装保存、来源 SKU 绑定和来源快照绑定；候选查找与自动铺货任务继承 `storeId/storeIds`，不再跨店复用草稿。
- 提交后的 `import-info` 只作为异步结果入口；未知结果保持 `needs_review`，不重试、不生成虚假库存。商品状态只有在受控的 `/v3/product/list` + `/v3/product/info/list` 回读证据完整、新鲜、覆盖齐全时才可进入 `ready_for_sale`。
- payload 预检补齐采购证据等级、媒体人工确认、单 SKU/多 SKU 来源绑定、碰撞 Offer 保留和尺重快照一致性；离线 golden-path 篡改 fixture 会阻断。
- 验证：全量 `npm test` `1143/1143`、`npm run lint`（74 files）、`npm run offline-acceptance` 通过；验收 `networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。
- 未完成：真实店铺受控 Seller API 读取、真实 Ozon 提交/审核回读、真实库存写入；这些必须由用户明确授权并产生服务端回执后才能提升验证等级。
- 恢复注意：`data/ozon-category-cache.json` 因 C 盘空间临时移至 `D:\ozonerp-backup\ozon-category-cache.json`，未作为业务代码变更恢复；运行真实缓存刷新前先确认磁盘空间并恢复该文件。

## 2026-07-20 A26 受控只读矩阵默认范围收口

- 审计发现 CLI 和服务端默认把完整 `CURRENT_READ_ENDPOINTS` 与 `single_offer` 组合；类目/字典/FBS 端点缺少必要范围时，矩阵可能先显示通过、执行才失败。
- 现在默认计划只使用 `/v3/product/list` 和 `/v2/warehouse/list`；类目、属性字典和 FBS 读取必须通过显式端点与范围参数加入。服务端同步执行 `buildReadEndpointRequest` 校验并回传 `endpointScopeErrors`。
- `deployment-preflight` 新增真实子进程回归，验证本地失败退出码、JSON 输出和 `databaseObserved/networkAccessed/writesExecuted=false`；定向 read-operator `19/19`、server `140/140`、deployment `4/4`，全量 `npm test` `1143/1143`、lint `74 files`。
- 该轮仍只改善计划准确性，不代表真实 Seller API 读取已完成。

## 2026-07-20 E26 主链路切片全量门禁

- P0 保存草稿来源身份旁路、首页空态采集入口和普通层阶段文案修复后，全量 `npm test` `1142/1142`、lint `74 files`、offline acceptance 通过。
- 本地 API 证据矩阵仍为 `canonical=matched`、Seller HTML 指纹 `matched`、店铺 `4/4`；这些只是 configuration/local evidence，不是 Seller API 真实读取权限或业务回执。
- 离线验收明确 `networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`；真实部署预检仍 fail-closed，等待 Supabase/迁移/认证/店铺范围和受控只读回执。

## 2026-07-20 P0 黄金链路保存草稿策略旁路修复与卖家空态入口

- 审计发现 `saveWorkflowPayloadDraftForListingJob` 持久化 1688 强预检策略时漏写 `sourceIdentityRequired`；保存草稿后再次校验/提交可能退回较弱策略，绕过 canonical URL + Offer ID 身份门。
- 现在保存策略写入 `sourceIdentityRequired: sourceIs1688`，并保留已有 `sourceEvidenceRequired`、SKU 绑定和来源证据门；缺少来源身份继续返回 `SOURCE_IDENTITY_MISSING`，不调用 Ozon 写接口。
- 普通卖家首页黄金链路空态新增“去采集 1688 商品”按钮；`source/category` 等内部阶段在普通层显示为“1688 货源采集/类目与属性”等业务语言，技术 reason code 仍只留高级诊断。
- 定向 frontend `257/257`、server `140/140`、workflow `117/117` 通过；本轮未连接数据库、Seller API 或执行 Ozon 写入。

## 2026-07-20 D25 活动证据绑定读取环境并失效旧价格影响

- 审计发现活动列表和活动商品详情只校验店铺；切换读取环境后，旧活动行、参加商品和价格影响摘要可能残留。
- 现在活动列表、参加商品、候选商品接口均回传受控环境；前端严格匹配当前环境，环境切换会清空活动覆盖、详情和价格影响状态。
- 定向前端+服务端 `396/396`、全量 `1141/1141`、lint `74 files` 通过；未联网、未连接数据库、未执行 Seller API 或 Ozon 写入。

## 2026-07-20 C25 受控读取丢弃跨店/跨环境迟到响应

- 审计发现单店受控读取执行没有请求代次；店铺或环境切换后，旧执行响应仍可能回填当前页面的只读结果摘要。
- 现在执行带 `readOperatorExecutionRequestToken`，响应必须同时匹配请求代次、当前店铺和当前读取环境；切换店铺/环境会使旧执行结果失效。
- 定向前端+服务端 `394/394`、lint `74 files` 通过；未联网、未连接数据库、未执行 Seller API 或 Ozon 写入。

## 2026-07-20 B25 写入回读失败时前端不再宣称库存已完成

- 审计发现库存写入接口返回后，前端调用写后只读回查但忽略其返回值；回查失败或返回状态不是 `reconciled` 时仍显示“写入已完成并通过回查”。
- 现在只有 `readStockReconciliationEvidence()` 成功且服务端 summary 状态严格为 `reconciled` 才显示库存完成；否则显示待复核并提醒不要重复写入。
- 定向前端/服务端/库存 `435/435`、全量 `1138/1138`、lint `74 files` 通过；未联网、未连接数据库、未执行 Seller API 或 Ozon 写入。

## 2026-07-20 A25 1688 预检强制来源商品身份

- 审计发现 1688 预检只要求 snapshot hash 和 `verificationState=ok`，缺少 canonical URL 或 Offer ID 的快照仍可能被视为当前商品来源证据。
- 现在 1688 黄金链路的强预检策略额外要求 `sourceEvidence.canonicalUrl` 必须是 1688 URL 且存在 `sourceEvidence.offerId`；缺失时生成 `SOURCE_IDENTITY_MISSING` 卖家修复任务，不进入 Ozon 提交确认。
- 定向黄金链路/服务端 `291/291`、全量 `1137/1137`、lint `74 files` 通过；未联网、未连接数据库、未执行 Seller API 或 Ozon 写入。

## 2026-07-20 E24 全量门禁切换 D 盘临时目录后通过

- C 盘空间不足曾让全量测试在写临时仓库时出现 `ENOSPC`；未改业务代码绕过测试，而是将本轮 Node 临时目录切换到 D 盘重新执行。
- 全量直接 Node 回归 `1136/1136`、lint `74 files`、offline acceptance 通过；离线验收明确 `networkAccessed=false`、`databaseObserved=false`、`writesExecuted=false`。真实部署、Seller API 读取和 Ozon 写入仍未被冒充完成。

## 2026-07-20 D24 订单与财务摘要绑定读取环境并失效旧数据

- 审计发现订单/财务模型绑定店铺和筛选范围，但没有保存 Seller 读取环境；环境切换后旧订单和财务摘要仍可能留在页面。
- 现在订单看板响应回传受控环境，前端订单 scope 和财务模型严格绑定当前环境；环境变化会清空订单行、分页覆盖、详情请求和财务摘要，必须重新读取后才能判断经营数据。
- 定向前端+服务端 `392/392`、lint `74 files` 通过；未联网、未连接数据库、未执行 Seller API 或 Ozon 写入。

## 2026-07-20 C24 库存证据绑定读取环境并在环境切换时失效

- 审计发现库存证据只绑定店铺和 Offer×仓库范围，没有保存读取环境；同一店铺切换 local/staging 后，旧库存证据仍可能通过前端预演门。
- 现在服务端库存证据回传受控读取环境，前端保存并严格匹配当前环境；读取环境输入变化会清空库存证据/预演，旧环境不能继续进入库存操作链。
- 定向前端+服务端 `390/390`、lint `74 files` 通过；未联网、未连接数据库、未执行 Seller API 或 Ozon 写入。

## 2026-07-20 B24 库存证据异常数量保持未知，不显示 NaN

- 审计发现库存证据回读把缺失/非数字的 `present`、`reserved` 直接 `Number()`，异常 Seller 响应可能在页面显示 `NaN`，而不是明确的未知数量。
- 现在库存证据归一化会把空值和非有限数保留为 `null`；只有明确有限数字才进入库存快照、预演和卖家展示，不会把异常值当作 0 或有效库存。
- frontend `252/252`、lint `74 files` 通过；未联网、未连接数据库、未执行 Seller API 或 Ozon 写入。

## 2026-07-20 A24 1688 来源 URL 去重绑定当前店铺

- 审计发现候选→本地草稿的重复判断按 `candidateId` 或 1688 URL 全局匹配；同一来源商品被不同店铺采集时，可能错误复用另一店铺草稿。
- 现在重复判断同时要求现有 job 的 `storeId` 与候选有效店铺一致；无店铺的旧 job 只与无店铺候选兼容匹配，不会跨店复用草稿或后续 workflow。
- 黄金链路/服务端定向 `173/173` 通过；未联网、未连接数据库、未执行 Seller API 或 Ozon 写入。

## 2026-07-20 D23 活动详情读取绑定当前店铺并失效跨店迟到响应

- 审计发现活动列表已有 `storeId` 校验，但活动商品/候选详情响应没有回传店铺范围；切店后重新打开相同活动 ID，旧详情响应可能被当作新店铺证据。
- 现在详情接口回传 `storeId`，前端校验两个详情响应、当前店铺和详情请求 token；切换店铺会失效活动详情请求。跨店或迟到响应不会进入活动商品、候选或价格影响状态。
- 定向前端+服务端 `387/387`、lint `74 files` 通过；全量回归首次受 C 盘 `ENOSPC` 影响，清理本轮测试生成的临时目录后再复跑；未联网、未连接数据库、未执行 Seller API 或 Ozon 写入。

## 2026-07-20 C23 读取环境变更立即失效旧 proof 与计划

- 环境输入变化会清空旧 session proof、四店铺矩阵、回执和执行摘要；单店只读执行要求 proof 环境严格匹配当前环境。
- frontend `250/250`、全量基线 `1130/1130`、lint `74 files` 通过；未联网、未连接数据库、未执行 Seller API 或 Ozon 写入。

## 2026-07-20 B23 新增 SKU 行不再默认生成 100 件库存

- 新增空白变体库存保持为空并提示读取真实库存；不会把未读取的 Offer×仓库 tuple 冒充可售库存。
- frontend `249/249`、全量基线 `1129/1129`、lint `74 files` 通过；未联网、未连接数据库、未执行外部写入。

## 2026-07-20 A23 草稿无 workflow 时禁止回退到其他商品

- 候选创建本地草稿但 workflow 绑定失败时，不再按最近 workflow 渲染其他商品；停留当前候选上下文并阻断预检。
- frontend `248/248`、全量基线 `1128/1128`、lint `74 files` 通过；未联网、未连接数据库、未执行外部写入。

更新时间：2026-07-06

## 项目根目录

`C:\Users\Administrator\Documents\ozonerp`

本轮 Codex 桌面环境以 `C:\Users\Administrator\Documents\ozonerp` 为实际项目根；继续开发前仍需先确认 `git status` 和最近提交，避免误入旧复制目录。

## 2026-07-06 变体规则 V4：1688 规格匹配 Ozon 字典变体值

### 已完成

- 属性矩阵现在会读取当前 workflow/payload draft 保存的 `sourceVariants`，把同 SKU、同属性的 1688 规格候选用于字典型 `is_aspect` 属性匹配。
- 对颜色等 Ozon 字典变体属性：
  - 先用现有来源规格候选把 `白色/蓝色` 等规格映射为俄文字段候选。
  - 再只从当前类目合法 `dictionary_value_id` 中选择与候选文本精确匹配的值。
  - 例如 `白色 -> белый -> dictionary_value_id=111`，不会同时把同类目其他合法值 `синий/черный` 暴露为该 SKU 的可写候选。
- 上架填报任务队列和属性矩阵按钮会保留来源上下文：
  - `sourceSuggestedAspect=true`
  - `sourceValue`
  - `sourceVariantSpec`
- 人工确认写回字典变体值后，事件审计会记录来源规格匹配上下文，便于后续排查“为什么这个 SKU 写了这个字典值”。

### 安全边界

- 该能力仍只写本地 Payload 草稿并重新预检，不提交 Ozon。
- 写回必须满足 `waiting_human` 或 `locks.waitingHuman=true`，并且请求必须带 `confirmLocalDraftRepair=true`。
- 字典型变体属性不能走文本写回；必须写当前类目合法 `dictionary_value_id`。
- 来源规格只作为候选匹配线索，不自动启用规则、不解除 submit lock、不绕过预检。
- 如果来源规格无法匹配当前类目合法字典值，则不生成可写候选，继续停在人工修复。

### 已验证

- TDD 红灯：
  - `node --test --test-name-pattern "source-matched dictionary variant" test/workflow-runs.test.js` 先因白色 SKU 暴露 `[111,222,333]` 全部合法字典值失败。
  - `node --test --test-name-pattern "source spec dictionary matches" test/frontend-static.test.js` 先因前端未保留来源规格匹配标记失败。
- 已转绿：
  - `node --test test/workflow-runs.test.js`，75/75 通过。
  - `node --test test/frontend-static.test.js`，87/87 通过。
  - `npm test`，360/360 通过。
  - `npm run lint`，通过。

### 下一步建议

- 继续做“当前类目属性填报工作台 V5”：把来源规格匹配失败的字典 aspect 明确展示为“需人工选择 Ozon 合法字典值”，并支持按当前类目字典搜索/过滤，而不是只显示空阻塞。
- 并行推进 SKU 图/详情图对商品分值的上架前检查：区分 SKU 首图、详情图数量、OCR 风险和 Ozon 分值项，但 GPT/Image 仍必须人工确认成本。

## 2026-07-06 变体规则 V3：1688 规格候选人工写回

### 已完成

- 上架填报任务队列现在会把 `variantConfiguration.suggestedAspects` 与属性矩阵中的缺失非字典变体属性对齐：
  - 只在 workflow 处于 `waiting_human` 或 `locks.waitingHuman=true` 时显示写回入口。
  - 只对 `canApplyVariantTextDraftRepair=true` 的非字典 `is_aspect` 属性提供按钮。
  - 候选值来自当前预检中的同 SKU、同属性、同值 `1688_sku_spec` 建议。
- 点击“确认写入 1688 规格候选并预检”时：
  - 前端必须人工确认。
  - 后端只写本地 Payload 草稿并重新预检。
  - 不提交 Ozon，不解除 submit lock，不启用规则。
- 后端新增 `sourceSuggestedAspect` 校验：
  - 如果请求声称使用 1688 SKU 规格候选，必须匹配当前预检里的 `suggestedAspects`。
  - 不匹配当前预检候选会拒绝，避免用户界面或旧页面把错误值写入草稿。

### 安全边界

- 字典型变体属性仍不能走文本写回；必须后续匹配当前 Ozon 类目合法 `dictionary_value_id`。
- 该能力只推进“非字典变体文本”的人工确认写回，不覆盖重复变体、不自动修 SKU 图、不提交 Ozon。
- 写回后仍通过 `validatePayloadDraft` 重新预检；如果其他 SKU 仍缺变体属性，整体仍保持阻塞。

### 已验证

- TDD 红灯：
  - `node --test test/workflow-runs.test.js --test-name-pattern "source-suggested variant text"` 先因后端未校验候选值失败。
  - `node --test test/frontend-static.test.js --test-name-pattern "source SKU spec suggestion|variant text aspect repair"` 先因前端没有传递候选值和 `sourceSuggestedAspect` 失败。
- 已转绿：
  - `node --test test/workflow-runs.test.js`，74/74 通过。
  - `node --test test/frontend-static.test.js`，86/86 通过。

## 2026-07-06 1688 SKU 规格进入变体属性只读候选 V2

### 已完成

- 自动上架草稿生成会把 1688 `skuVariants` 映射为 `summary.sourceVariants`，按实际 Ozon `offer_id` 保留 `spec/image/source`，用于后续变体诊断。
- `savePayloadDraft` 新增 `payloadDraftSourceVariants` 持久化；保存草稿、人工本地修复后重新预检、提交前总闸都会继续携带该来源 SKU 上下文。
- `buildVariantConfigurationSummary` 在 Ozon 可变特性缺失时，会从来源 SKU 规格生成只读候选：
  - 白/蓝/黑/红/黄/绿/粉/紫/橙/棕/灰/米色等中文规格可映射到俄文颜色候选。
  - 候选值只在对应属性为颜色/色号类可变特性时自动翻译；其他可变属性保留来源规格文本，留给人工确认。
  - 每条候选带 `readOnly=true` 和 `forbiddenEffects=["payload_write","ozon_submit","rule_auto_enable"]`。
- 多 SKU 草稿现在要求补齐当前类目所有 `is_aspect` 变体属性；如果类目同时要求颜色和尺码，而 SKU 只填了颜色，预检总闸会输出 `MISSING_VARIANT_ASPECT` 并进入 `waiting_human`，不能提交 Ozon。
- 来源 SKU 规格只按 `offerId` 精确匹配；如果本地草稿被重排或改了 `offer_id`，不会再按行号把错误规格贴到另一个 SKU 上。
- 上架中心变体配置工作簿会显示：
  - 顶部“1688 规格候选 X 行 / Y 个值”。
  - 单个 SKU 缺少可变特性时显示“1688 规格候选”和来源规格。
  - 修复建议文案明确说明候选不会自动写 Payload 或提交 Ozon。

### 安全边界

- 来源 SKU 规格只作为人工修复参考，不自动写本地 Payload，不启用规则，不解除 workflow lock，不提交 Ozon。
- 部分缺失变体属性会阻塞预检和提交；即使已有一个 aspect，也不能因为“看起来有变体属性”而绕过总闸。
- 人工写回仍必须走现有 `waiting_human + confirmLocalDraftRepair + validatePayloadDraft` 后端闸口。
- 该能力只解决“采集规格如何帮助补变体属性”，不替代 Ozon 类目属性字典学习和人工最终确认。

### 已验证

- TDD 红灯：
  - `node --test test/workflow-runs.test.js --test-name-pattern "source SKU specs|buildVariantConfigurationSummary"` 先因缺少 `suggestedAspectRowCount` 失败。
  - `node --test test/frontend-static.test.js --test-name-pattern "variant configuration workbench"` 先因 UI 未消费 `suggestedAspectRowCount` 失败。
  - 独立 agent 审核发现：部分缺失变体属性可能不阻塞预检、来源 SKU 规格在 `offerId` 不匹配时可能按行号误贴；已补红灯测试后修复。
- 已转绿：
  - `node --test test/frontend-static.test.js --test-name-pattern "variant configuration workbench"`，85/85 通过。
  - `node --test test/workflow-runs.test.js`，73/73 通过。
  - `node --test test/auto-listing-payload-draft.test.js --test-name-pattern "source-explained model autofill"`，25/25 通过。

### 下一步建议

- 继续做“变体规则 V3”：把来源 SKU 规格候选接入人工确认写回入口，要求仅在 `waiting_human` 时显示，点击后写本地草稿并重新预检，不自动提交 Ozon。
- 同步完善 Ozon 类目可变特性字典值匹配：颜色/尺寸等如果是字典属性，不能写文本，必须先从当前类目字典候选中选择合法 `dictionary_value_id`。

## 2026-07-05 必填字典候选进入只读规则池 V2

### 已完成

- `requiredAttributeRuleCandidateIndex` 不再只接收人工缺规则 backlog；现在会读取当前商品 `requiredAttributeFillPlan` 中的 `suggest_dictionary` 行，把中置信 Ozon 字典候选也沉淀为只读规则候选。
- 字典候选规则项会保留：
  - 当前 `categoryKey/categoryPath`。
  - `attributeId/attributeName`。
  - 候选 `dictionaryValueId/value/confidence/source`。
  - `requiresHumanApproval=true`。
  - `forbiddenEffects=["payload_write","ozon_submit","rule_auto_enable"]`。
- `requiredAttributeRuleCandidateHistory` 继续按 `categoryKey + attributeId` 聚合同类目样本，同时保留候选字典值和出现次数，方便后续人工审核判断“这个属性应不应该沉淀成规则、候选值是否稳定”。
- 上架草稿生成和预检节点已把 `requiredAttributeFillPlan` 传入规则候选索引，因此真实 workflow/job/payload draft 的摘要可以看到这些候选，而不是只在测试工具里可见。
- 上架中心“规则审查池”会只读展示候选字典值；跨多个 workflow summary 聚合时，候选值出现次数采用去重后的最大历史计数，避免同一份类目历史摘要在列表中重复展示时夸大稳定性。

### 安全边界

- 该规则池仍是只读沉淀，不持久化真实自动规则。
- 字典候选不会直接写 Payload，不触发 Ozon submit，不绕过 Payload validation、preflight 或人工提交确认。
- 品牌“无品牌”和原产国“中国”仍走当前类目字典的高置信自动填；制造商、危险品、成分等敏感字段仍不能猜填。

### 已验证

- TDD 红灯：
  - `node --test test/ozon-required-attribute-analysis.test.js --test-name-pattern "dictionary suggestions"` 先因索引缺少字典候选失败。
  - `node --test test/ozon-required-attribute-analysis.test.js --test-name-pattern "preserves dictionary candidate values"` 先因历史聚合丢失候选值失败。
- 已转绿：
  - `node --test test/ozon-required-attribute-analysis.test.js`，4/4 通过。
  - `node --test test/auto-listing-payload-draft.test.js --test-name-pattern "RuleCandidate|rule candidates|dictionary"`，25/25 通过。
  - `node --test test/frontend-static.test.js --test-name-pattern "occurrence counts deduplicated"`，85/85 通过，覆盖规则池候选值次数不重复膨胀。

## 2026-07-05 包装尺重证据写入本地草稿入口 V1

### 已完成

- 上架中心“人工属性工作台”的包装尺重证据组新增安全写入入口：
  - 只在当前 workflow 处于 `waiting_human` 或 `locks.waitingHuman=true` 时生成候选。
  - 只针对 `payloadDraft.items` 中 `weight/depth/width/height` 缺失的 SKU 显示按钮。
  - 只接受可信尺重来源：`1688_package`、`manual_measurement`、`manual_measured`、`supplier_package`。
  - 点击“确认写入尺重并预检”前必须二次人工确认。
  - 前端调用 `/api/workflows/:id/payload-draft/attribute-repair`，`repairType: "package_info"`，只写本地 Payload 草稿并重新预检。
- 定价诊断链路保留 `packageInfoSource`；只有显式可信来源或 1688 URL/来源才会标记为 `1688_package`，PDD/未知来源即使有尺重也不会被误标为可写证据。
- 自动上架 Payload 草稿生成新增硬闸：候选尺重必须有可信来源；PDD/未知来源即使带重量和长宽高，也不能生成可提交 Ozon 的 payload 草稿。
- 包装证据组继续保留“定位包装字段”的只读入口，未知来源或缺证据时仍显示“需补证据，不可猜填”。

### 安全边界

- 该入口不调用 Ozon submit，不解除 `submitLocked`，不绕过 Payload validation。
- workflow 非等待人工状态不显示修复候选。
- PDD、未知来源、猜测尺重、不完整尺重不会被当作可写证据；定价诊断不得无条件把缺失来源兜底成 `1688_package`。
- 未知/PDD 尺重不能只靠“人工确认提交”兜底，必须回到 1688 货源、供应商包装资料或人工实测后再生成草稿。
- 后端仍二次校验 `confirmLocalDraftRepair`、可信来源、完整尺重和 `waiting_human`，前端按钮不是最终安全边界。

### 已验证

- TDD 红灯：
  - `test/frontend-static.test.js` 先因缺少 `listingFillTaskPackageRepairCandidates`、缺少 `apply-package-info-repair` 入口失败。
  - `test/workflow-runs.test.js` 先因 `packageInfoSource` 未保留失败。
- 已转绿：
  - `node --test test/frontend-static.test.js --test-name-pattern "package repair|manual backlog groups|read-only fill task queue"`，84/84 通过。
  - `node --test test/workflow-runs.test.js --test-name-pattern "carries pricing diagnosis"`，68/68 通过。
  - `node --test test/auto-listing-payload-draft.test.js --test-name-pattern "package evidence|creates workflow payload"`，25/25 通过。

## 2026-06-30 Claude NVIDIA 默认审阅链路修复

### 已完成

- 已定位 Claude NVIDIA 无有效输出根因：
  - NVIDIA `/v1/models` 与 API key 正常。
  - `moonshotai/kimi-k2.6` 官方 chat completion 在 30 秒 smoke 中超时。
  - `qwen/qwen3-next-80b-a3b-instruct` 与 `meta/llama-3.3-70b-instruct` 在同一 NVIDIA endpoint 下可正常返回。
  - 旧 `scripts/claude-ozon-review-nvidia.ps1` 不会自动启动 LiteLLM，也没有超时诊断，容易表现为“空输出/长时间卡住”。
- `config/litellm-nvidia.yaml` 新增 `nvidia-qwen-next`，映射 `openai/qwen/qwen3-next-80b-a3b-instruct`。
- `scripts/claude-code-nvidia.ps1` 默认模型改为 `nvidia-qwen-next`。
- `scripts/claude-ozon-review-nvidia.ps1` 默认模型改为 `nvidia-qwen-next`，并新增：
  - 自动启动本地 NVIDIA LiteLLM gateway。
  - `-TimeoutSeconds`，默认 120 秒。
  - 空输出/超时显式报错，不再静默失败。
  - 无效工具调用式输出检测：如果模型返回 XML/JSON tool-call 痕迹，会自动用更严格的纯文本提示重试一次；仍无效则明确失败，不把坏复审当作可用审核。
  - 子进程 exit code 检测：`claude` 非 0 退出时直接报错并带出错误摘要，避免把认证/模型/gateway 错误文本误当成复审意见。
- 本轮继续加固 Claude NVIDIA 复审输出：
  - wrapper 会把当前 `git diff` / staged / untracked 文件列表写入提示词，要求只引用真实 changed-file list、项目规则或任务中明确给出的文件，不再让模型随意编造 `src/llm/*` 等不存在路径。
  - 非 `OK/Important/Critical` 开头且过短的单词输出会被视为无效并自动严格重试。
  - `Critical` / `Important` 只有单词、没有理由时会被视为无效；风险级别必须带出与 changed-file list 或项目规则相关的具体理由。
  - 进一步定位到 Claude CLI 兼容层会在 NVIDIA/LiteLLM 场景下丢失或误读上下文；wrapper 已改为直连本地 LiteLLM `/v1/chat/completions`，用 UTF-8 bytes 发送 prompt，确保实际使用 `nvidia-qwen-next`。
  - 新增 `-PromptOutputPath`，可保存实际发给 NVIDIA 的 prompt；后续若复审异常，可直接核对模型是否收到了 changed-file list。
  - 对中文返回的 mojibake 做一次 UTF-8 修复，避免 PowerShell/REST 解码异常把可用复审变成乱码。
  - 如果 changed-file list 非空但模型声称“无变更文件/未提供变更文件”，wrapper 会判为矛盾输出并重试；重试后仍矛盾则失败，不把坏复审当作可用审核。
- 新增 `test/claude-nvidia-scripts.test.js`，静态锁定默认模型、gateway 启动和配置别名。
  - 本轮测试继续锁定 changed-file list 上下文、禁止编造路径、拒绝一词式无效输出。

### 已验证

- `node --test test/claude-nvidia-scripts.test.js`，1/1 通过。
- 本轮追加验证 `node --test test/claude-nvidia-scripts.test.js`，1/1 通过。
- 本轮追加 smoke：`scripts/claude-ozon-review-nvidia.ps1` 返回 `OK`。
- 本轮追加 smoke：wrapper 能识别一词式无效输出并触发严格重试，最终返回带理由的 `OK` 文本。
- 本轮追加 direct smoke：wrapper 直连 LiteLLM 后能读取真实 changed files，返回带理由的中文 `OK`，不再声称没有变更文件。
- `scripts/claude-ozon-review-nvidia.ps1` smoke 已自动启动 gateway 并返回：`OK，我是 NVIDIA review wrapper。`
- `scripts/claude-code-nvidia.ps1` smoke 已返回：`OK，Claude Code NVIDIA 默认模型可用。`
- `npm test`，297/297 通过。
- `npm run lint`，通过。

### 后续规则

- Ozon ERP 默认 Claude Code 搭配继续使用 NVIDIA，但默认别名为 `nvidia-qwen-next`。
- `nvidia-kimi-k2` 可保留为手动模型别名；如果后续恢复稳定，可显式传 `-Model nvidia-kimi-k2` 测试，但不再作为默认复审模型。

## 2026-06-30 审核回执与当前商品任务闭环 V1

### 已完成

- `src/workflowRuns.js` 新增 `workflowCurrentProductTask()`，在 workflow/listing 域统一把节点状态映射为当前商品下一步任务：
  - `review_reconcile` 失败或变体合并失败 -> `listing_repair`，引导修复 Payload/变体后重新预检。
  - 审核成功但内容分值/评分分项偏低 -> `content_improvement`，引导回上架内容和图片优化。
  - `stock_sync` running/failed/waiting -> `warehouse_queue`，引导进入库存队列和仓库推荐，不盲写库存。
  - 审核通过且无明显分值问题 -> `live_monitoring`，引导库存/运营检查。
- `summarizeWorkflowRun()` 现在输出 `summary.currentProductTask`，让首页/工作流列表可消费统一业务任务。
- Dashboard 单品结果卡优先读取 `latestRun.summary.currentProductTask`：
  - Dashboard 不直接解析 Ozon 原始审核回执、Payload 或库存写入结果。
  - 仍只显示当前商品、卡点、原因、下一步和跳转入口。
- 工作流控制台 run card 与当前焦点条新增只读“当前商品任务”摘要：
  - 展示商品、卡点、原因和安全下一步。
  - 数据只来自 `summary.currentProductTask`。
  - 不新增提交按钮、不触发重试、不解析 raw payload。
- Dashboard 今日提醒侧栏与商品中心产品资产台账新增只读“当前商品任务”提醒：
  - 两处共用 `summary.currentProductTask`，优先显示被阻塞/等待人工/需优化的当前商品。
  - Dashboard 仍是店铺经营总览，提醒只在侧栏出现，不把原始 workflow 诊断放进首页主区域。
  - 商品中心只展示当前商品的状态提醒，不新增上架表单、采集入口或 Ozon 提交动作。

### 安全边界

- 当前商品任务只是摘要和跳转建议，不调用 Ozon 写接口，不提交商品。
- 审核失败、变体合并失败、库存等待不会被当作成功。
- 内容分值优化不会绕过 preflight、payload validation 或人工确认。
- 库存任务仍进入库存队列/仓库页，不绕过 stock queue、商品就绪检查或 `WAREHOUSE_WRONG_STATUS` 排除。
- 不改变 workflow lock、`waiting_human`、pricing blocked 或 GPT/Image 成本确认。

### Claude Code 搭配

- 开发前调用 `scripts/claude-ozon-review-nvidia.ps1` 请求 Task 6 简报；进程正常结束但无有效文字输出，因此按本地计划和测试先推进。
- 修复 Claude NVIDIA wrapper 后，完成后复审已能稳定输出；复审提醒继续守住 `summary.currentProductTask`、preflight、`waiting_human`、pricing blocked 和 stock queue 边界。
- 复审输出里提到的 Vue/独立 JS 文件名并不存在，已按实际代码路径核对后只采纳安全边界提醒。
- 工作流控制台展示切片复审给出 Critical 级边界提醒，但未指出当前 diff 的具体违规点；已核对实际实现为只读渲染，无新增按钮、API、重试或提交副作用。
- 后续 Dashboard/商品中心复用切片仍需用 Claude NVIDIA 复审，重点检查是否误解析 raw payload、误加提交/重试按钮、或污染模块边界。

### 已验证

- TDD 红灯：
  - `test/workflow-runs.test.js` 先因 `workflowCurrentProductTask` 未导出失败。
- 已通过：
  - `node --test test/workflow-runs.test.js`，61/61 通过。
  - `node --test test/workflow-runs.test.js test/frontend-static.test.js`，132/132 通过。
  - `node --test test/frontend-static.test.js`，72/72 通过。
  - `node --test test/claude-nvidia-scripts.test.js test/workflow-runs.test.js test/frontend-static.test.js`，133/133 通过。
  - `node --test test/frontend-static.test.js`，73/73 通过。
  - `npm test`，297/297 通过。
  - 最新全量 `npm test`，298/298 通过。
  - `npm run lint`，通过。
  - `git diff --check`，通过。

### 下一步

- 继续推进“分类属性与变体填写主动化”主线：把当前类目的必填属性、字典候选、变体 aspect/SKU 图、商品分值影响项做成更明确的填报任务队列。
- 后续仍默认 Claude NVIDIA 搭配开发：实现后必须复审，Codex 以项目规则、测试和安全边界为最终判断。

## 2026-06-30 上架填报任务队列 V1

### 已完成

- 上架中心二级流程顶部新增只读“填报任务队列”：
  - 从当前 workflow 的 `payloadDraftValidation.requiredAttributeFillPlan` 汇总必填属性任务。
  - 从 `variantConfiguration` 汇总变体组合阻塞与 SKU 图提醒。
  - 从 `listingQuality` 汇总内容分值、图片/属性/描述/尺重影响项。
- 队列卡只提供“定位处理区”本地跳转：
  - 可切换到上架中心内部阶段，如内容图片、预检提交。
  - 不新增保存、自动填充、提交、重试、GPT/Image 生图或 Ozon API 调用。
- 窄屏响应式已处理，任务卡在平板两列、手机单列，避免信息挤压。

### 安全边界

- 数据源只读，沿用当前 workflow 摘要和预检结果，不创造新的属性真源。
- 建议字典值仍需人工确认；合规敏感和人工必填项不会自动写入。
- 变体阻塞必须回到草稿/预检修复，不绕过 payload validation。
- 内容分值提醒不会触发 GPT/Image 成本，不绕过 preflight 或人工确认。

### 已验证

- TDD 红灯：
  - `node --test test/frontend-static.test.js` 先因缺少 `renderListingFillTaskQueue` 失败。
- 已通过：
  - `node --test test/frontend-static.test.js`，74/74 通过。

### 下一步

- 继续把安全修复入口从“缺失字典值”扩展到更多低风险、人工确认后可本地修复的字段，例如普通文本属性、可解释型号名和可复制的变体 aspect 修复建议。

## 2026-06-30 必填属性安全修复入口 V1

### 已完成

- 后端 `applyPayloadDraftAttributeRepair()` 扩展字典修复边界：
  - 仍支持修复“已有但非法”的字典值。
  - 新增支持修复“缺失的字典属性”，但必须满足：
    - 属性矩阵判定该单元格为 `missing` 且该属性是当前类目的字典属性。
    - 候选字典值来自当前类目缓存/属性矩阵候选。
    - 前端传入 `confirmLocalDraftRepair: true`，即人工确认。
    - workflow 必须处于 `waiting_human` 或 `locks.waitingHuman=true`，避免运行中流程被静默改草稿。
  - 非候选字典 ID 仍拒绝，不能信任前端注入。
- 上架中心“只读填报任务队列”新增安全确认入口：
  - 从当前 workflow 的属性矩阵收集所有 `canApplyLocalDraftRepair` 字典候选。
  - 只有当前 workflow 处于等待人工时才展示候选写回按钮。
  - 点击后复用现有 `apply-attribute-dictionary-repair` 动作、确认弹窗和 `/payload-draft/attribute-repair` API。
  - 写回后立即重新预检，仍保持 `submitLocked`，不提交 Ozon。

### 安全边界

- 只写本地 Payload 草稿，不调用 `/v3/product/import`。
- 不绕过 preflight、payload validation、workflow lock、`waiting_human`、pricing blocked 或人工确认。
- 非 `waiting_human` 的 workflow 不能通过属性修复 API 写回本地草稿。
- 缺失字典属性只接受当前属性矩阵里的合法候选，不接受任意字典 ID。
- 任务队列按钮只是现有修复动作的入口，不新增独立写接口。

### 已验证

- TDD 红灯：
  - `node --test test/workflow-runs.test.js` 先因缺失字典属性仍被拒绝失败。
  - `node --test test/frontend-static.test.js` 先因缺少 `listingFillTaskRepairCandidate` 失败。
- 已通过：
  - `node --test test/workflow-runs.test.js`，62/62 通过。
  - `node --test test/frontend-static.test.js`，74/74 通过。

### 后续补充

- 上架中心任务队列已继续接入普通文本属性安全入口：
  - 从属性矩阵里收集 `canApplyTextDraftRepair` 的缺失普通文本属性候选。
  - 当前不再展示卡片级“第一个文本属性”按钮；只在人工属性工作台的 `手动属性缺口` 分组里，按属性/SKU 逐项展示“填写该 SKU 文本并预检”。
  - 点击后复用现有 `apply-attribute-text-repair` prompt、`/payload-draft/attribute-repair` API 和重新预检流程。
  - 后端同样要求 `waiting_human` / `locks.waitingHuman=true`、`confirmLocalDraftRepair=true`，且只能修复非字典、非变体的缺失普通文本属性。
- 上架中心任务队列已接入变体 aspect 安全修复建议：
  - 从当前 workflow 的 `variantConfiguration.rows` 读取 `duplicate_aspect` / `missing_aspect` 行。
  - 在“变体/SKU 图”任务卡内显示“变体属性修复建议”、受影响 SKU、首个业务原因和人工修法。
  - 提供“复制修复建议”和“查看变体工作簿”两个本地动作；定位时带当前 workflow run 与 `preflight_check` 节点。
  - 本轮不写 Payload、不自动补 aspect、不提交 Ozon；修正后仍必须重新预检和人工确认。
- 工作流“变体配置工作簿”已补充字段级定位入口：
  - 每个 SKU 行新增“定位该 SKU 属性”，复用现有 Payload 编辑器高亮逻辑。
  - 当前版本会携带 `offer_id` 与首个 aspect attribute id，优先在对应 SKU 片段内定位颜色/尺码等 aspect id。
  - 如果没有可定位 aspect id，仍回退到 `offer_id` 这个稳定 SKU 锚点，帮助人工在 JSON 中找到对应变体行。
  - 该动作只移动光标和高亮，不保存、不修复、不提交。
- 上架中心“只读填报任务队列”已回流变体阻塞的行级业务上下文：
  - 变体/SKU 图任务卡会列出受影响 SKU、首个 aspect 名称/属性 ID、为什么卡住、下一步。
  - 数据仍来自 `variantConfiguration.rows`，只读展示；复制建议和查看工作簿不写 Payload、不提交 Ozon。
  - 修正后仍必须回到预检/Workflow Console 重新校验。
- 上架中心“只读填报任务队列”已前置展示必填属性候选确认清单：
  - 分类属性任务卡会从 `requiredAttributeFillPlan` 中提取 `action=suggest_dictionary` 且有 `dictionaryCandidates` 的字段，展示属性名/ID、候选值、来源、置信度、为什么不能自动写和安全下一步。
  - 每个候选现在按 `attributeId + dictionaryValueId` 逐条匹配当前属性矩阵里的本地修复候选；匹配成功才显示“可安全写回”和对应 SKU 的确认按钮，未匹配则保持“暂不可直接写回”。
  - 该清单只读，不新增 API、不写 Payload、不解锁 workflow、不提交 Ozon；真正写回仍只能走既有 `waiting_human + confirmLocalDraftRepair + 重新预检` 的修复入口。
- 必填属性计划里的 `requiredAttributeManualBacklog` 已新增只读“人工属性工作台”：
  - 把人工卡点按卖家业务问题分为“包装尺重证据”“合规敏感字段”“手动属性缺口”。
  - 每组展示为什么阻断、必须补什么、补完后的安全下一步；只读展示，不提供输入、保存、fetch、workflow action 或提交按钮。
  - 包装/尺重缺口仍建议补齐 1688/人工实测证据或更换货源；合规敏感字段仍禁止猜测。
- 人工属性工作台 V1 已接入普通文本字段的安全填写入口：
  - 从当前属性矩阵收集所有 `canApplyTextDraftRepair=true` 的候选；只有 workflow 处于 `waiting_human` / `locks.waitingHuman=true` 时才会出现。
  - 仅 `手动属性缺口` 分组可显示“填写该 SKU 文本并预检”；`包装尺重证据` 和 `合规敏感字段` 继续只读，不能直接写草稿。
  - 点击后复用既有 `apply-attribute-text-repair`、`repairType: "text_value"` 和人工 prompt；只写本地草稿并重新预检，不提交 Ozon、不解锁 workflow。
- 包装尺重证据工作台 V1 已接入上架中心人工属性工作台：
  - `包装尺重证据` 分组会逐项展示证据状态、证据来源、缺少字段和补证据动作。
  - `1688_package_missing` 会明确显示“缺少 1688 尺重证据”，引导回 1688 详情重新采集或人工实测后更新货源，再重新预检。
  - 该分组继续只读，`canWriteDraft=false`，不展示属性修复按钮、不写 Payload、不提交 Ozon、不解锁 workflow。
- 包装尺重证据工作台已补充 Payload 字段定位准备：
  - 缺重量/长宽高时会生成 `weight` / `depth` / `width` / `height` 的只读定位目标。
  - 前端只显示“定位包装字段”；点击后从 Listing Center 切到 Workflow Console，复用现有 payload 编辑器高亮机制定位字段。
  - 该入口只是定位，不在 Listing Center 内编辑包装字段；没有新增 fetch、保存、写草稿或提交动作。
  - 后续若做人工确认后的尺重回填，必须继续经过 `waiting_human`、本地草稿确认、重新预检和提交总闸。
- Payload 本地修复闸口已预留包装尺重回填 V1：
  - `applyPayloadDraftAttributeRepair()` 支持 `repairType: "package_info"`，但必须 `confirmLocalDraftRepair=true` 且 workflow 处于 `waiting_human` / `locks.waitingHuman=true`。
  - 只接受可信来源 `1688_package`、`manual_measurement`、`manual_measured`、`supplier_package`，并要求重量、长、宽、高四项均为正数。
  - 写入范围仅为当前 SKU 的 `weight` / `depth` / `width` / `height` 本地草稿字段；写完立即重新预检，继续 `submitLocked`，不提交 Ozon、不解锁 workflow。
- 上架草稿侧的变体修复入口 V2 已接入非字典 aspect 文本属性：
  - `applyPayloadDraftAttributeRepair()` 新增 `repairType: "variant_text_value"`。
  - 仅允许 `waiting_human` / `locks.waitingHuman=true` 且 `confirmLocalDraftRepair=true` 的 workflow 写回本地 Payload 草稿。
  - 仅允许属性矩阵中 `status=missing`、`is_aspect=true`、非字典属性的单元格；字典 aspect 和重复 aspect 仍拒绝自动修复。
  - 写回后立即重新预检，仍保持 `submitLocked`，不会调用 Ozon 提交接口。
  - 上架中心“变体/SKU 图”任务卡和属性矩阵单元格新增“填写变体文本并预检 / 填写变体文本”按钮；用户输入后只写本地草稿并刷新 workflow 诊断。
- 变体配置工作簿新增只读“变体覆盖摘要”：
  - `variantConfiguration.summary` 现在输出 aspect 覆盖数、缺失 aspect 数、重复 aspect 数、唯一 SKU 图数、缺图数、未区分 SKU 图数、`readinessStatus` 和 `safeNextAction`。
  - 前端工作簿顶部展示“属性覆盖 / SKU 图区分 / 安全下一步”，帮助用户先看整组是否达标，再看逐 SKU 明细。
  - 上架中心顶部“只读填报任务队列”的变体/SKU 图卡片也改用同一份覆盖摘要，先显示属性覆盖、缺失/重复、SKU 图区分、缺图和未区分数量。
  - 该摘要只读取当前预检结果，不新增按钮、不写 Payload、不提交 Ozon，不触发 GPT/Image 成本。
- 变体配置工作簿新增逐 SKU 只读修复建议 V1：
  - `variantConfiguration.rows[].repairSuggestions` 现在覆盖缺失可变特性、重复可变特性组合、缺 SKU 图、SKU 图未区分四类问题。
  - `variantConfiguration.summary.repairSuggestionCount` 汇总当前工作簿建议数，方便后续任务队列排序。
  - 前端在“安全下一步”列展示“只读修复建议”，说明要补什么、为什么补、补完后必须重新预检。
  - 本切片仍不写 Payload、不调用 Ozon 提交、不触发 GPT/Image 成本、不新增自动修复按钮；只帮助人工定位下一步。
- Listing 质量诊断新增只读图片质量建议：
  - `listingQuality.imageQualityRecommendations` 现在覆盖产品图少于 3 张、详情/产品图偏少、SKU 首图重复、SKU 图片组合重复。
  - 空图片数组也会被 `PRODUCT_IMAGES_TOO_FEW` 阻塞，避免无图商品被误当作仅警告。
  - 前端 Listing 质量诊断新增“图片质量建议”只读块，只说明人工要补什么和补完后重新预检。
  - 图片准备/OCR 的 skipped 风险也会进入只读建议：`factory_intro`、`needs_translation`、`ozon_image_policy_text` 分别提示工厂/批发文字、中文文字、平台政策文字风险。
  - 本切片不写 Payload、不调用图片生成、不触发成本动作、不提交 Ozon；水印细分风险后续再从 OCR/视觉检测结果继续扩展。
- 变体配置工作簿新增整组差异建议：
  - `variantConfiguration.differenceSuggestions` 现在按重复组输出受影响 SKU、重复组、建议区分的 aspect 名称和安全下一步。
  - 前端工作簿新增“整组差异建议”只读块，提示按颜色、尺码、容量或套装组合拉开整组 SKU。
  - 不自动补 aspect、不写 Payload、不提交 Ozon；修复后仍必须重新预检。
- 变体整组差异建议已推进到可复制修复说明和 Payload 定位：
  - `differenceSuggestions[].repairTargets[]` 按受影响 SKU 输出 `offerId`、`attributeId/name`、当前值、`payloadPath`、`payloadLabel` 和 `copyText`。
  - 整组建议本身新增 `copyText`，把重复 SKU、每个 SKU 要改的 aspect 和“重新预检、不会自动写 Payload 或提交 Ozon”合成可复制说明。
  - 前端“整组差异建议”显示每个 target，并复用现有 `[data-payload-path]` 定位机制跳到同一 SKU 的属性位置；该入口只定位，不写草稿、不解锁 workflow、不提交 Ozon。
- 必填属性规则引擎 V2 继续修正原产国/制造商边界：
  - `Страна-изготовитель` / 原产国 / 生产国 / 制造国 走 `fixed_country_china`，只使用当前类目字典中的 Китай/中国。
  - 单独的 `Производитель` / 制造商不再被误识别为原产国；仍进入合规敏感人工阻塞。
  - 避免中国原产国被 `изготовител` 敏感词误挡成 `blocked_sensitive`，也避免把制造商错误自动填中国。
- 必填属性规则引擎 V2 已接入颜色字段窄范围同义词候选：
  - `Цвет` / color / 颜色字段在商品文本含红、蓝、白、黑、绿、黄、粉、紫、橙、棕、灰、透明等明确颜色词时，可候选当前类目字典中的对应颜色值。
  - 候选来源标记为 `color_synonym`，置信度 `0.7`，只进入 `dictionaryCandidates`。
  - 非颜色字段不触发；仍保持 `action=suggest_dictionary`，不设置行级 `dictionaryValueId`，不自动写 Payload。
- 必填属性规则引擎 V2 已开始接入中置信字典同义词候选：
  - `Материал` / 材质字段在商品文本含 PP/ABS/塑料、金属/不锈钢/铁/合金、硅胶等词时，可匹配当前类目字典里的俄文候选。
  - 候选来源标记为 `material_synonym`，置信度 `0.72`，只进入 `dictionaryCandidates`。
  - 仍保持 `action=suggest_dictionary`，不写 `dictionaryValueId`，必须人工确认后才可写本地草稿并重新预检。
- 必填属性规则引擎 V2 继续补充类型字段窄范围同义词候选：
  - `Тип` / `Вид` / 用途 / 类型 / 种类 字段在商品文本含 organizer / 收纳盒 / 收纳架 / 整理盒 / 置物架时，可候选当前类目字典里的 `органайзер`。
  - 候选来源标记为 `type_synonym`，置信度 `0.7`，只用于人工确认候选。
  - 非类型字段不触发该规则；例如材质字段里出现 organizer 不会生成类型候选。
- 必填属性规则引擎 V2 继续补充用途/适用对象窄范围同义词候选：
  - `Назначение` / `Применение` / `Для кого` / 用途 / 适用对象 字段在商品文本含 厨房/kitchen 时，可候选当前类目字典里的 `для кухни` 等用途值。
  - 商品文本含 宠物/猫/狗，或独立英文词 pet/cat/dog 时，可候选当前类目字典里的 `для животных` 等适用对象值；`catalog` 这类普通词不会因包含 `cat` 片段而触发。
  - 候选来源标记为 `purpose_synonym`，置信度 `0.7`，只进入 `dictionaryCandidates`；仍保持 `action=suggest_dictionary`，不设置行级 `dictionaryValueId`，不自动写 Payload。
  - 非用途/适用对象字段不触发该规则；例如 `Тип` 字段里出现 厨房 不会生成用途候选。
- 必填属性规则引擎 V2 继续补充性别/适用性别窄范围同义词候选：
  - `Пол` / `gender` / 性别 / 适用性别 字段在商品文本含 女士/women/female 或明确俄文女性词形 `женский` / `женщина` 时，可候选当前类目字典里的 `женский` 等值；标点后的 `женщина` 仍可识别，`еженедельник` 不会因包含 `жен` 片段触发。
  - 商品文本含 男士/men/male/муж 时，可候选 `мужской`；含 儿童/kids 或明确俄文儿童词形 `детский` 时，可候选 `детский`；标点后的 `детская` 仍可识别，`деталь` 不会因包含 `дет` 片段触发。
  - 候选来源标记为 `gender_synonym`，置信度 `0.7`，只进入 `dictionaryCandidates`；仍保持 `action=suggest_dictionary`，不设置行级 `dictionaryValueId`，不自动写 Payload。
  - 非性别字段不触发该规则；例如用途字段里出现 women 不会生成性别候选。
- 必填属性规则引擎 V2 继续补充容量/件数数值同义候选：
  - `Объем` / 容量 / 体积字段在商品文本含 `500ml`、`500 мл`、`1L` 等容量表达时，只候选当前类目当前属性字典中的同数值容量值。
  - `Количество` / 件数 / 数量字段在商品文本含 `10件`、`10pcs`、`10 шт` 等数量表达时，只候选当前类目当前属性字典中的同数值件数值。
  - 容量/件数表达必须是独立数值单位片段；型号或 SKU 左右连写片段如 `X500ml`、`500mlX`、`A10pcs`、`10pcsX` 不触发候选，避免把编码数字误判为商品属性。
  - 候选来源标记为 `capacity_synonym` / `count_synonym`，置信度 `0.68`，只进入 `dictionaryCandidates`；仍保持 `action=suggest_dictionary`，不设置行级 `dictionaryValueId`，不自动写 Payload。
  - 非容量/件数字段不触发该规则；例如材质字段里出现 `500ml` 不会生成容量候选。
- 必填属性规则引擎 V2 继续补充尺码、包装/套装数量、适用场景候选：
  - `Размер` / 尺码 / 尺寸字段在商品文本含 `10cm`、`10 см`、`size M` 等表达时，只候选当前类目当前属性字典中的同尺码值。
  - 尺寸组合如 `10x20cm` / `10*20 см` 会优先匹配当前字典中的同组合值（如 `10 x 20 см`），不会因为单个数字 `20` 误候选 `20 x 30 см`。
  - `Количество в упаковке` / 包装数量 / 套装字段在商品文本含 `3-pack`、`一包3个` 等表达时，只候选当前类目当前属性字典中的同数量值。
  - `Сценарий использования` / 适用场景字段在商品文本含 travel/旅行、office/办公、bath/浴室、outdoor/户外、home/家用、car/车载、school/学校等明确场景词时，只候选当前属性字典里的对应场景值。
  - 场景候选已收窄为明确适用场景字段；`场景图` 等素材/图片字段即使商品文本含 travel/旅行，也不会触发 `scenario_synonym`。
  - 候选来源标记为 `size_synonym` / `package_count_synonym` / `scenario_synonym`；仍保持 `action=suggest_dictionary`，不设置行级 `dictionaryValueId`，不自动写 Payload。
- 必填属性填充计划新增安全分层元数据：
  - 每条 `requiredAttributeFillPlan` 都输出 `safetyTier`、`safetyLabelZh`、`requiresHumanConfirmation`、`blocksAutomation`、`safeNextStep`。
  - 分层固定为 `autofill-safe`、`candidate-needs-human-confirmation`、`manual-required`、`blocked-never-guess`。
  - `auto_fill` 仍需经过 Payload validation 和预检；`suggest_dictionary` 只允许人工确认后走已有 `waiting_human + confirmLocalDraftRepair` 本地草稿修复；合规敏感/禁止猜测字段必须人工核实或换货源。
  - 前端“必填属性填充计划”只读展示安全分层和安全下一步，不新增 API、不新增自动填充按钮、不提交 Ozon。
- 当前商品属性覆盖率汇总已接入：
  - `summarizeRequiredAttributeFillPlan()` 按 `safetyTier` / `action` 汇总必填属性，输出可自动、候选确认、人工必填、禁止猜测、人工参与数、阻塞数、`readinessStatus` 和 `safeNextAction`。
  - `buildListingPayloadDraftFromJob()`、`buildPayloadDraftValidation()`、`buildPreflightGateNode()` 都输出 `requiredAttributeFillSummary`。
  - 前端“必填属性填充计划”新增只读“属性覆盖率”摘要，顶部直接显示四类数量和安全下一步。
  - 该摘要不新增写入按钮、不触发 Ozon 预检/提交、不改变 workflow lock / `waiting_human`，只帮助当前商品快速定位卡点。
- 高频人工属性 backlog 已接入：
  - `buildRequiredAttributeManualBacklog()` 从 `requiredAttributeFillPlan` 只读提取 `manual-required` / `blocked-never-guess` 行，分为 `rule_candidate`、`manual_required`、`replace_source` 三类。
  - 缺尺重/包装证据等货源关键资料进入“建议换货源”；合规敏感、制造商、保质期等禁止猜测字段进入“必须人工”；普通无规则字段进入“可规则化”。
  - `buildListingPayloadDraftFromJob()`、`buildPayloadDraftValidation()`、`buildPreflightGateNode()` 都输出 `requiredAttributeManualBacklog`。
  - 前端“必填属性填充计划”新增只读“高频人工属性”摘要，不新增按钮、不触发换货源、不写 Payload、不提交 Ozon。
- 规则沉淀候选索引已接入：
  - `buildRequiredAttributeRuleCandidateIndex()` 从 `requiredAttributeManualBacklog.rule_candidate` 生成当前类目的只读候选清单。
  - `buildListingPayloadDraftFromJob()`、`buildPayloadDraftValidation()`、`buildPreflightGateNode()` 都输出 `requiredAttributeRuleCandidateIndex`。
  - 前端“必填属性填充计划”新增只读“规则沉淀候选”摘要，展示候选属性、类目 key 和候选状态。
  - 本阶段不持久化规则、不生成自动规则、不写 Payload、不触发预检/提交；只是让后续规则池知道哪些字段值得沉淀。
- 类目规则池草案已接入：
  - `buildRequiredAttributeRuleCandidateHistory()` 可把当前商品与外部传入的历史样本候选按 `categoryKey + attributeId` 聚合。
  - 同一类目同一属性在 2 个及以上不同样本出现时标记 `ready_for_review`；同一商品/同一 run 内重复候选只算一次，单样本仍为 `collect_more_samples`。
  - `buildListingPayloadDraftFromJob()` 与 `validatePayloadDraft()` 不持久化 `requiredAttributeRuleCandidateHistory`，避免把草案误当成已沉淀规则。
  - `buildPreflightGateNode()` 只有在显式传入历史样本或历史草案时才输出只读 `requiredAttributeRuleCandidateHistory`。
  - 前端“必填属性填充计划”可渲染只读“类目规则池草案”，展示出现次数、样本数和人工审核下一步。
  - 本阶段仍不持久化规则、不自动生成规则、不写 Payload、不触发 Ozon 提交；规则进入自动化前必须另走人工审核和测试。
- 类目规则池草案已接入真实 workflow 历史读出：
  - `listWorkflowRuns()` 读取现有 run 时，会从同类目 `requiredAttributeRuleCandidateIndex` 临时聚合 `summary.requiredAttributeRuleCandidateHistory`。
  - 该字段只存在于 API 读出对象的 `summary` 副本，不写回 `workflow-runs.json`、不写 `payloadDraftValidation`、不写 Payload。
  - 前端 `renderRequiredAttributeRuleCandidateHistory()` 已读取 `run.summary.requiredAttributeRuleCandidateHistory`，继续保持只读渲染，无按钮、无 API 调用、无自动应用规则。
- 上架中心新增只读“规则审查池”工作台：
  - `collectRequiredAttributeRulePool()` 聚合 `state.workflowRuns[].summary.requiredAttributeRuleCandidateHistory.reviewQueue`，按类目和属性去重后展示。
  - 支持按规则状态和关键词本地筛选；筛选只更新前端 `state.rulePoolFilter`，不调用 API、不写 workflow、不写 Payload。
  - 工作台只做人工审核前的队列观察，不提供通过/忽略/应用按钮；规则沉淀、自动生成规则和 Payload 写入仍必须另走人工批准和测试。
- 规则审查池新增只读“人工批准草案”预览：
  - `buildRequiredAttributeRuleCandidateHistory()` 继续只输出可读历史和审查队列，不带审批草案字段，避免进入预检节点输出或持久化记录。
  - `buildRequiredAttributeApprovalDraftPreview()` 只在 `listWorkflowRuns()` 的 `summary` 读出副本里为 `ready_for_review` 候选派生 `approvalDraftQueue`。
  - 草案只展示样本数、必查项和禁止效果：不能写 Payload、不能提交 Ozon、不能自动启用规则。
  - 上架中心规则池行内展示草案预览，无保存/批准/应用按钮；后续如要做真实批准，必须新增独立人工确认、持久化审计和回归预检。
- 规则审查池新增只读“审计准备”提示：
  - 每个审批草案带 `auditReadiness`，默认 `blocked_until_audit_ready`，列出缺少的样本复核记录、人工批准人和时间、独立预检回归结果。
  - `canStoreApproval=false`、`canEnableRule=false` 是当前阶段的硬边界；它只是告诉后续真实批准存储前还缺什么，不存储批准、不启用规则、不写 Payload。
  - 前端只展示审计准备状态和缺失证明，无按钮、无 API 调用、无 workflow 状态变化。
- 规则批准审计意图日志已接入后端最小版：
  - `src/ruleApprovalAudit.js` 使用 `data/rule-approval-audit.json` 记录人工批准意图；测试可用 `RULE_APPROVAL_AUDIT_FILE` 指向临时文件。
  - `POST /api/listing-rule-approval-audit/intents` 只在 `confirmAuditIntent=true` 且样本复核记录、人工批准人、独立预检回归通过都齐全时写一条 `stored_for_review` 审计记录。
  - 记录结果固定 `effectStatus=no_rule_or_payload_effect`，`safetyLocks.draftWrite/ozonSubmit/ruleEnable/workflowUnlock=false`，不会启用规则、写草稿、提交 Ozon 或改变 workflow lock。
  - `GET /api/listing-rule-approval-audit/intents` 与 `/summary` 只读查看审计意图；本阶段没有前端按钮，后续接 UI 必须另做人工确认与安全提示。
- 上架中心规则审查池已只读接入审计意图日志：
  - 前端 `loadRuleApprovalAuditIntents()` 只通过 `GET /api/listing-rule-approval-audit/intents?limit=200` 读取记录，缓存到 `state.ruleApprovalAuditIntents`。
  - `collectRuleApprovalAuditIntentsByCandidate()` 只在审计记录同时具备 `categoryKey + attributeId` 时关联到已有规则候选；不能用属性名兜底，避免审计证据挂错属性。
  - 规则池行内展示已挂载候选的最新“审计记录”、批准人、独立预检结果、`stored_for_review` / `no_rule_or_payload_effect` 和四个安全锁状态。
  - 本阶段仍无前端保存/批准/启用按钮，不发 POST，不写 Payload，不解锁 workflow，不触发 Ozon 提交。
- 上架中心规则审查池新增只读“规则发布闸”判定：
  - `evaluateRulePublishGate()` 基于候选状态、样本数、已挂载审计意图、独立预检、回滚方案和四个安全锁，输出 `needs_evidence` / `publish_blocked` / `ready_for_publish_review`。
  - 判定结果固定 `canEnableRule=false`、`canWritePayload=false`，只说明缺少证明、阻断原因、禁止效果和安全下一步。
  - 行内展示“只读发布闸”，无按钮、无链接、无 API 写请求；即便显示“可进入发布复核”，也只是说明下一阶段可设计独立人工发布流程，不在本页启用规则。
- 规则发布复核意图记录已接入后端最小版：
  - `src/rulePublishReview.js` 使用 `data/rule-publish-review.json` 记录发布复核意图；测试可用 `RULE_PUBLISH_REVIEW_FILE` 指向临时文件。
  - `POST /api/listing-rule-publish-review/intents` 必须具备人工确认、批准审计 ID、`categoryKey + attributeId`、至少两个商品样本、独立预检通过、回滚方案和审核人一致性。
  - 记录结果固定 `publishStatus=review_only_not_enabled`、`effectStatus=no_rule_or_payload_effect`，`safetyLocks.ruleEnable/payloadWrite/workflowUnlock/ozonSubmit=false`。
  - `GET /api/listing-rule-publish-review/intents` 与 `/summary` 只读查看复核意图；本阶段仍不会启用规则、写 Payload、解锁 workflow 或提交 Ozon。
- 上架中心规则审查池已只读回接发布复核意图：
  - 前端 `loadRulePublishReviewIntents()` 只通过 `GET /api/listing-rule-publish-review/intents?limit=200` 读取记录，缓存到 `state.rulePublishReviewIntents`。
  - `collectRulePublishReviewIntentsByCandidate()` 继续沿用 `categoryKey + attributeId` 严格关联，不允许用属性名兜底。
  - 规则池行内新增“发布复核记录”展示审核人、样本数、独立预检和四个安全锁；渲染函数没有按钮、没有 `fetch/api` 写操作、没有 workflow action。

### 下一步

- 继续做“必填属性规则引擎 V2”的规则候选复用：下一步可做真正发布前的独立人工流程设计，或把变体整组差异建议推进到可复制修复说明和整组草稿定位；启用前仍不能自动写 Payload。

## 2026-06-30 仓库匹配规则引擎 V1

### 已完成

- `src/stockQueue.js` 新增 `rankWarehousesForStock()`：
  - 输入 `warehouses`、`excludedIds`、`product`、`store`、`previousFailures`。
  - 优先推荐 `created` 且匹配商品/店铺配送模式的仓库。
  - 排除本轮重试已排除仓库、历史 `WAREHOUSE_WRONG_STATUS` / `STOCK_WAREHOUSE_INVALID` 仓库、禁用/不可写仓库。
  - 输出 `recommended`、`recommendedReason`、`safeNextAction`、候选仓库、排除原因，不再只返回一个 ID。
- `resolveWarehouseIdForStore()` 与仓库状态失败后的替换仓库选择改用排名结果。
- `stockJobWarehouseRecommendation()` 可按库存队列 job 生成可解释推荐，失败仓库不会在同一轮重试被复用。
- `/api/ozon/stock-queue?includeWarehouseRecommendation=1` 可在读取队列时尝试附加仓库推荐；仓库接口失败时仍返回队列，并输出 `warehouseRecommendationError`。
- 库存页新增“库存队列与仓库推荐”只读工作台：
  - 展示库存队列任务、最后失败、推荐仓库、推荐原因、安全下一步。
  - 排除原因默认折叠，避免库存页变成诊断墙。
  - “回放可重试失败”仍调用库存队列回放，不直接盲写库存。

### 安全边界

- 仓库推荐只做本地排序和解释；不绕过库存队列、不直接写 Ozon 库存。
- `/v2/products/stocks` 写入仍只发生在现有 stock queue worker 内，并继续等待商品 import/review readiness。
- `WAREHOUSE_WRONG_STATUS` 仓库会进入排除，不把 blocked warehouse 当作安全推荐。
- 不改变 preflight、payload validation、workflow lock、`waiting_human`、pricing blocked 或人工确认。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-ozon-review-nvidia.ps1` 请求 Task 5 简报；本地未收到有效文字输出，因此按项目安全边界和测试优先流程继续推进。
- 完成后第一次 Claude NVIDIA 复审超时无输出，已终止审阅进程；第二次短复审有输出但引用不存在的 `recommendWarehouse()`、`/api/warehouse/recommend` 等内容，经 `rg` 核对为误报。
- 复审中唯一有效风险点是“不要复用错误状态仓库”，已补充测试覆盖 `status: WAREHOUSE_WRONG_STATUS` 被排除。

### 已验证

- TDD 红灯：
  - `test/stock-queue.test.js` 先因 `rankWarehousesForStock` 未导出失败。
- 已通过：
  - `node --test test/stock-queue.test.js`，8/8 通过。
  - `node --test test/stock-queue.test.js test/server-routes.test.js test/frontend-static.test.js`，91/91 通过。
  - `npm test`，292/292 通过。
  - `npm run lint`，通过。
  - `git diff --check`，通过。

### 下一步

- 继续开发“审核回执与商品分值闭环”：把 Ozon review/status、低分原因、库存等待状态映射成当前商品下一步任务；Dashboard 只接收经营摘要和侧栏提醒，不承载原始 payload 细节。

## 2026-06-30 定价策略 V1：最低价/原价来源解释

### 已完成

- `src/pricing.js` 新增 `derivePricingPolicyFields()`：
  - 无 `pricingPolicy` 时保持旧规则：`old_price = price * 2`，`min_price` 继续使用小数向下取整/整数减一。
  - 有 `pricingPolicy` 时支持 `targetProfitRate`、`minimumProfitRate`、`minimumProfitCny`、`oldPriceMode`、`oldPriceMultiplier`。
  - `min_price` 可按最低利润底线计算，并输出 `minPriceSource`、`marginFloor`。
  - `old_price` 输出 `oldPriceSource`，当前策略模式支持促销倍率。
  - 若最低价不低于售价，标记 `blocked=true` 与 `PRICING_MIN_PRICE_INVALID`。
- `buildListingPayloadDraftFromJob()` 和真实 `completeListing()` 路径都接入策略字段，避免草稿和真实流程分叉。
- `pricingDiagnosis` 新增 `pricingPolicy`、`oldPriceSource`、`minPriceSource`、`marginFloor`、`pricingBlockedReasonCode`。
- 前端定价诊断卡新增“最低价来源 / 原价策略 / 利润底线”说明。

### 安全边界

- 定价策略只计算本地 payload 字段和诊断，不调用 Ozon 写接口。
- `PRICING_MIN_PRICE_INVALID` 仍走既有 pricing blocked/preflight 阻塞逻辑，不能被当作安全通过。
- 不改变 workflow lock、`waiting_human`、preflight 或人工二次确认。
- 旧路径默认保持兼容，只有显式传入 `pricingPolicy` 才启用最低利润底线策略。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-ozon-review-nvidia.ps1` 做 Task 4 简报。
- Claude 重点提醒：旧自动上架不能破坏；最低价低于利润底线必须阻断；来源字段必须可追溯；pricing blocked 不能被接受为安全。

### 已验证

- TDD 红灯：
  - `test/pricing-source.test.js` 先因 `derivePricingPolicyFields` 未导出失败。
  - `test/auto-listing-payload-draft.test.js` 先因草稿缺少 `oldPriceSource/minPriceSource/pricingPolicy` 失败。
  - `test/frontend-static.test.js` 先因前端缺少“最低价来源/原价策略/利润底线”失败。
- 已通过：
  - `node --test test/pricing-source.test.js`，3/3 通过。
  - `node --test test/auto-listing-payload-draft.test.js`，8/8 通过。
  - `node --test test/frontend-static.test.js`，69/69 通过。

### 下一步

- 继续开发“仓库匹配规则引擎”：仓库选择不再取第一个可用，而是按仓库状态、店铺/配送模式、历史失败原因和商品 readiness 排名。
- 定价后续可继续接类目真实佣金、汇率策略和前端策略配置入口；所有策略修改仍需人工确认和重新预检。

## 2026-06-30 变体配置工作簿

### 已完成

- 新增 `buildVariantConfigurationSummary()`，在 preflight/workflow 中输出逐 SKU 变体配置摘要：
  - `offerId`、型号名称、Ozon 可变特性、aspect signature。
  - SKU 图状态：已区分、未区分、缺失。
  - 行状态：`valid`、`duplicate_aspect`、`missing_aspect`、`missing_image`、`pricing_blocked`。
  - 行级原因和安全下一步。
- `buildPayloadDraftValidation()` 与 `buildPreflightGateNode()` 现在输出 `variantConfiguration`，复用现有 `buildVariantGroupingDiagnosis()`，不创建第二套变体真相源。
- 工作流 Payload 草稿区新增“变体配置工作簿”只读表格：
  - 展示 SKU、型号、可变特性、SKU 图、判断、安全下一步。
  - 多 SKU 使用相同首图会显示图片提醒。
  - 重复 aspect 组合会显示行级阻塞，并引导修正后重新预检。

### 安全边界

- 工作簿只读展示，不调用 Ozon 写接口，不提交商品。
- 修复仍走现有 Payload 草稿编辑/本地修复和重新预检。
- 不改变 preflight、payload validation、workflow lock、`waiting_human`、pricing blocked 或人工二次确认。
- 型号相同但 aspect 不同被视为合法；重点阻塞重复 aspect 组合。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-ozon-review-nvidia.ps1` 做 Task 3 简报。
- Claude 重点提醒：工作簿必须以预检/Payload 为事实源；不能提供快速提交；pricing blocked 必须能下沉到行级状态。

### 已验证

- TDD 红灯：
  - `test/workflow-runs.test.js` 先因 `buildVariantConfigurationSummary` 未导出失败。
  - `test/frontend-static.test.js` 先因缺少 `renderVariantConfigurationWorkbench` 失败。
- 已通过：
  - `node --test test/workflow-runs.test.js`，58/58 通过。
  - `node --test test/frontend-static.test.js`，69/69 通过。

### 下一步

- 继续开发“定价策略升级”：把 `price`、`min_price`、`old_price` 从简单公式升级为可解释商业策略，并保持 blocked pricing 不可接受跳过。
- 后续可把变体工作簿的“定位字段”与现有 Payload 字段定位进一步打通，但仍只改本地草稿并重新预检。

## 2026-06-30 必填属性规则引擎 V2：可解释填充计划

### 已完成

- 新增 `buildRequiredAttributeFillPlan()`，为当前类目必填属性输出可解释计划：
  - `attributeId` / `name` / `strategy` / `confidence`。
  - `action`: `auto_fill`、`suggest_dictionary`、`manual_required`、`blocked_sensitive`。
  - `source`、`value`、`dictionaryValueId`、`dictionaryCandidates`、`reasonZh`。
- `buildListingPayloadDraftFromJob()` 现在把 `requiredAttributeFillPlan` 写入草稿 `summary`：
  - 型号名称来自父 SKU/商品族上下文，跨变体保持一致，并记录 `source=parent_sku`。
  - 品牌无品牌、原产国中国仍只使用当前类目合法字典值，不硬编码字典 ID。
  - 尺重类必填字段仅在 1688 尺重存在时进入自动填充计划，缺失时进入人工处理。
  - 材质/类型/用途等中置信字典字段只给当前类目合法候选，不自动写入。
  - 保质期、储存条件、成分、危险、温度、儿童/食品/化妆品/医疗/电池等合规敏感字段进入 `blocked_sensitive`。
- `buildPayloadDraftValidation()` 与 `buildPreflightGateNode()` 输出 `requiredAttributeFillPlan`，让工作流总闸展示“系统准备怎么填、为什么、是否需要人工”。
- 工作流 Payload 草稿区新增“必填属性填充计划”只读面板，按“已安全补齐 / 建议确认 / 必须人工处理 / 合规敏感”分组展示。

### 安全边界

- fill-plan 是本地解释与计划，不调用 Ozon 写接口，不提交商品。
- 中置信字典候选不自动写草稿；仍需人工确认后走已有本地草稿修复和重新预检。
- 合规敏感字段不自动填，不能被当作安全通过。
- 不改变 preflight、payload validation、workflow lock、`waiting_human`、pricing blocked 或人工二次确认。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-ozon-review-nvidia.ps1` 做 Task 2 简报。
- Claude 重点提醒：字典缓存必须按当前 category/type/attribute 校验；`package_data` 不能缺尺重硬猜；合规敏感字段必须人工处理；fill-plan 不能推进状态机或绕过 preflight。

### 已验证

- TDD 红灯：
  - `test/auto-listing-payload-draft.test.js` 先因 `buildRequiredAttributeFillPlan` 未导出失败。
  - `test/workflow-runs.test.js` 先因 `requiredAttributeFillPlan` 未接入 preflight 输出失败。
  - `test/frontend-static.test.js` 先因前端缺少 `renderRequiredAttributeFillPlan` 失败。
- 目标验证：`node --test test/auto-listing-payload-draft.test.js test/workflow-runs.test.js test/frontend-static.test.js`，130/130 通过。

### 下一步

- 继续开发“变体配置工作台”：逐 SKU 展示型号、aspect 字段、SKU 图、重复组合和安全下一步，集中解决多 SKU 合并失败。
- 之后再进入定价策略升级，把 `price/min_price/old_price` 从固定公式升级为可解释商业策略。

## 2026-06-30 Ozon 内容评分与媒体质量闸口

### 已完成

- `diagnoseListingQuality()` 新增本地 Ozon 内容评分分项：
  - 图片与媒体：产品图 3-4 张提示分值风险，多 SKU 图片组合重复提示缺 SKU 区分图。
  - 分类属性与变体：沿用必填属性、字典合法值、变体可变特性阻塞。
  - 标题描述与富内容：描述过短、rich content/视觉详情缺失会进入商品分值提醒。
  - 尺重与物流基础：缺少完整尺重会进入商品分值提醒，并引导回尺重/价格预检。
- `buildPreflightGateNode()` 现在把 `contentSummary` 传入 listing quality 诊断，让预检总闸能展示内容评分分项。
- 工作流 Listing 质量诊断面板新增“评分分项”卡片，展示图片与媒体、分类属性与变体、标题描述与富内容、尺重与物流基础四项分数和原因。
- 若本地 Payload 草稿保存后尚未重新校验，面板会显示“旧分数已过期 / 修改后需重新预检”，避免继续展示旧预检分数。

### 安全边界

- 内容评分全量本地计算，不调用 Ozon 写接口，不提交商品。
- 评分只解释商品分值/内容风险，不替代 Payload validation、preflight 或人工确认。
- 不触发 GPT/Image 生成，不绕过 GPT/Image 成本确认。
- 不改变 workflow lock、`waiting_human`、pricing blocked 或提交确认逻辑。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-ozon-review-nvidia.ps1` 做 Task 1 实现简报。
- Claude 重点提醒：评分只能作为 preflight 前置解释，不能替代 preflight；不能引入图片处理/生图成本；不能侵入营销活动或商品运营页。
- 提交前复审指出需防止“草稿改动后继续显示旧分数”；已补充 stale UI 防护和静态测试。

### 已验证

- TDD 红灯：
  - `node --test test/listing-quality.test.js` 先因 `scoreBreakdown` 缺失失败。
  - `node --test test/workflow-runs.test.js` 先因 `contentSummary` 未接入预检诊断失败。
  - `node --test test/frontend-static.test.js` 先因前端未渲染评分分项失败。
- 目标验证：`node --test test/listing-quality.test.js test/workflow-runs.test.js test/frontend-static.test.js`，125/125 通过。

### 下一步

- 继续开发“必填属性规则引擎 V2”：把 `model_name_from_parent_sku`、包装尺重字段、高置信自动补齐、中置信字典候选和合规敏感阻塞做成可解释填充计划。
- 后续再进入“变体配置工作台”，集中解决 SKU 图、颜色/尺寸 aspect、重复组合和模型名一致性。

## 2026-06-30 Ozon ERP 专属经验学习与差距评估

### 已完成

- 新增 `docs/ozon-erp-benchmark.zh-CN.md`，把 Ozon 官方规则、Seller Edu、同类 Ozon 工具/集成经验与当前系统做了对照评估。
- 明确纠偏：Ozon ERP 不能只按通用 ERP 模块推进；上架主线必须围绕 `description_category_id/type_id`、当前类目属性字典、变体可变特性、内容评分、媒体素材和审核回执。
- 结论：当前系统方向总体正确，已经不是纯泛 ERP；但还缺内容评分模型、类目/type 决策解释、类目规则模板、媒体结构化质量闸和审核/状态回读闭环。

### Claude Code 搭配

- 已使用 `scripts/claude-code-nvidia.ps1` 做两轮分析。
- Claude 有效建议：内容评分、媒体结构、样板商品/批量参数、字典合法值校验都是 Ozon 专属关键能力。
- 已纠偏 Claude 的两点误判：
  - 当前并非没有 `description_category_id/type_id` 映射，缺的是解释、候选对比和人工切换。
  - 当前品牌/原产国没有硬编码字典 ID，而是从当前类目字典值匹配。

### 后续建议

- 下一步优先开发 `Ozon 内容评分预估面板`：
  - 媒体：主图、SKU 图、详情图、视频、rich-content、图片文字风险。
  - 特征：必填属性覆盖率、字典合法率、可变特性唯一性。
  - 描述：俄文标题、描述长度、rich-content JSON、hashtags。
  - 输出阻塞项、建议项和安全下一步，不提交 Ozon、不生成图片、不绕过预检。

## 2026-06-30 高置信必填属性补齐：品牌与原产国

### 已完成

- `buildListingPayloadDraftFromJob()` 新增高置信必填属性补齐：
  - 品牌字段固定业务语义为 `Нет бренда` / 无品牌。
  - 原产国字段固定业务语义为 `Китай` / 中国。
  - 若字段是 Ozon 字典属性，只在当前类目字典值里找到匹配值时写入 `dictionary_value_id`。
  - 若当前类目没有合法字典值，不硬编码、不猜 ID，保留给预检/属性矩阵阻塞和人工处理。
  - 非字典字段才写文本值。
- 草稿生成可从两类来源读取当前类目字段和值：
  - 调用方传入的 `attrsMeta` + `attributeValuesById`。
  - 本地 `categoryCache.attributes` + `categoryCache.attributeValues`。
- 真实 workflow 草稿刷新现在会把本地类目缓存传入草稿生成，并把 `attrsMeta` 保存到 workflow run，便于后续预检和属性矩阵解释字段。

### 安全边界

- 不调用 Ozon 写接口，不提交商品，不绕过 preflight、人工确认、workflow lock 或 `waiting_human`。
- 不硬编码任何 `dictionary_value_id`；字典值必须来自当前 `description_category_id/type_id/attribute_id` 的缓存。
- 不触碰定价、库存、GPT/Image 成本确认、变体 aspect 自动修复或 PDD 采集。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-code-nvidia.ps1` 做实现简报审查。
- Claude 建议核心边界：字典属性不得硬编码 ID；helper 保持同步、无副作用，复用现有 category cache。

### 已验证

- TDD 红灯：`node --test test/auto-listing-payload-draft.test.js` 先因品牌/原产国未补齐、仍误留品牌文本失败。
- 目标验证：`node --test test/auto-listing-payload-draft.test.js`，5/5 通过。
- 相关回归：`node --test test/auto-listing-payload-draft.test.js test/listing-content-quality.test.js`，33/33 通过。
- 工作流/预检回归：`node --test test/workflow-runs.test.js test/listing-quality.test.js`，56/56 通过。

### 下一步

- 继续接 `model_name_from_parent_sku` 的可解释补齐来源显示，让用户知道型号名称来自父 SKU/商品族。
- 再推进包装尺重字段映射，把 1688 尺重进入 Ozon 相关属性/商品分值提示，但保持缺尺重阻塞。
- 中置信字典字段如类型、材质、用途仍保持候选推荐 + 人工确认，不自动写入。

## 2026-06-30 属性矩阵缺失文本属性本地修复

### 已完成

- 上架中心/工作流属性矩阵新增“填写文本属性”人工入口。
- 后端 `applyPayloadDraftAttributeRepair()` 新增 `repairType: "text_value"`：
  - 只允许修复属性矩阵中 `status=missing` 的普通文本属性。
  - 明确排除字典属性和 `is_aspect=true` 变体属性，避免错误自动填变体/字典值。
  - 只写回本地 `payloadDraft.attributes[].values[{ value }]`，随后立即重新执行 `validatePayloadDraft()`。
  - 保持 `waitingHuman` 和 `submitLocked=true`，事件记录 `submittedToOzon=false`。
- 前端只在 `canApplyTextDraftRepair=true` 时显示按钮；点击后由人工输入文本值，并提示“不会提交 Ozon”。

### 安全边界

- 不调用 Ozon 写接口，不绕过 preflight、人工确认、workflow lock 或 `waiting_human`。
- 不自动修复字典属性、变体 aspect、定价、GPT/Image 或图片生成成本相关逻辑。
- 字典候选写回仍保持原有合法候选校验，不因文本修复放宽。

### Claude Code 搭配

- 使用 `scripts/claude-code-nvidia.ps1` 进行 NVIDIA Claude Code 审核。
- 审核结论：Critical / Important / Minor findings 均无；仅提示并发草稿修改属于通用模型问题，不构成本次改动风险。

### 已验证

- `node --test test/workflow-runs.test.js`：53/53 通过。
- `node --test test/frontend-static.test.js`：67/67 通过。
- `npm test`：271/271 通过。
- `npm run lint`：41 files 通过。
- `git diff --check`：通过。

### 下一步

- 继续把高置信必填属性补齐器接入上架草稿：品牌无品牌、型号名称、原产国、包装尺重等可解释来源字段。
- 对中置信字典匹配继续保持“候选推荐 + 人工确认写回”，不要自动越过 Ozon 字典合法值校验。
- 把商品分值相关的图片数量、SKU 图、详情图要求继续沉入预检/修复面板，让卖家看到分数影响和安全下一步。

## 2026-06-30 上架质量诊断接入预检总闸

### 已完成

- 新增 `src/listingQuality.js`，把 Ozon 上架质量诊断从 UI 提示沉到后端本地预检：
  - 必填字典属性存在文本值但缺少当前类目合法 `dictionary_value_id` 时阻塞。
  - 变体 `is_aspect=true` 属性缺失或组合重复时阻塞。
  - 产品图少于 3 张时阻塞；3-4 张时只作为商品分值警告。
  - 已存在 `PRICING_*` 阻塞节点或直接 pricing blocked 时阻塞。
- `validatePayloadDraft()` 现在返回合并后的 `payloadDraftValidation`：
  - 保留原有 payload 结构校验。
  - 增加 `listingQuality`、`listingQualityWarnings` 和 `LISTING_QUALITY_*` issues。
  - 阻塞时继续保持 `submitLocked=true`。
- `submitPayloadDraftToOzon()` 在本地质量诊断阻塞时直接返回 `blocked`：
  - 更新 `preflight_check` 节点。
  - 进入 `waiting_human`。
  - 不调用 `/v3/product/import`。
  - 不改变 `confirmSubmit` 人工二次确认安全门。
- `buildPreflightGateNode()` 现在把上架质量诊断纳入提交前总闸输出，供工作流控制台展示具体字段、原因和下一步。

### Claude Code 搭配

- 开发前已执行 Claude Code NVIDIA fallback 审查：`logs/claude-listing-quality-preflight-pre-review.md`。
- 审查结论要求：新增诊断必须位于 `confirmSubmit` 之前，阻塞时不得调用 Ozon 写接口，pricing blocked 不能被强制提交绕过。
- 开发后已执行两轮 Claude Code NVIDIA fallback diff 审查：
  - `logs/claude-listing-quality-preflight-post-review.md`
  - `logs/claude-listing-quality-preflight-final-review.md`
- 第一轮后审指出需显式补齐 `waiting_human` 提交锁与 pricing blocked 集成测试；已补充并验证。

### 已验证

- 已按 focused test 先看到失败，再实现：
  - `test/listing-quality.test.js`
  - `test/workflow-runs.test.js`
- 目标验证：`node --test test/listing-quality.test.js test/workflow-runs.test.js`，45/45 通过。
- 前端契约：`node --test test/frontend-static.test.js`，62/62 通过。
- 全量测试：`npm test`，254/254 通过。
- Lint：`npm run lint`，41 files 通过。

### 下一步

- 把 `listingQuality` 的阻塞/警告结果在“上架中心/预检提交”页面做成字段级修复面板：当前商品是谁、哪个属性缺字典值、哪个 SKU 图或变体 aspect 卡住、下一步点什么。
- 继续接 Ozon Seller API 的分类属性/字典缓存，让属性填写从“发现缺失”升级为“高置信自动填、低置信人工确认”。
- 开发后必须继续执行 Claude Code diff 审查，通过后才能提交。

## 2026-06-30 Listing 质量字段级只读诊断

### 已完成

- 工作流 Payload 草稿区新增 `Listing 质量诊断` 只读路由卡：
  - 数据只读来自 `payloadDraftValidation.listingQuality`、`payloadDraftValidation.issues` 和 `preflight_check.output.listingQuality`。
  - 展示状态、分数、阻塞项、`offerId`、`attributeId`、商品分值 warning 和 `nextActions`。
  - 每个阻塞项提供“定位 Payload 字段”，复用原有编辑器高亮，不自动改字段；修复后必须重新预检。
- 新增 `collectListingQualityDiagnosis()`、`renderListingQualityPanel()` 和 `workflowPayloadLocationForIssue()`：
  - 支持 `LISTING_QUALITY_DICTIONARY_VALUE_INVALID` 定位字典值。
  - 支持 `LISTING_QUALITY_PRICING_BLOCKED` 定位价格/定价诊断。
  - 支持变体 aspect 和图片数量问题定位到对应 Payload 区域。
- 前端静态契约新增测试：`frontend renders listing quality field repair panel`。

### 安全边界

- 本卡片只解释和定位，不新增任何 Ozon 写接口，不提供自动修复按钮。
- 不绕过 `confirmSubmit`、preflight、workflow lock、`waiting_human`、pricing blocked、GPT/Image 成本确认。
- 未改 PDD、营销活动、Dashboard、订单或仓储模块。

### Claude Code 搭配

- 开发前审查：`logs/claude-listing-quality-repair-panel-pre-review.md`。
- 开发后第一轮审查指出：面板必须避免暗示“可直接修复 Listing 字段”。
- 已收窄为只读诊断路由卡，`nextActions` 只渲染为文字列表，唯一交互是高亮 Payload 字段。
- 最终复审：`logs/claude-listing-quality-repair-panel-final-review.md`，结论可提交，要求 blocking/warning 视觉区分和全量验证；已完成。

### 已验证

- 已按 TDD 先看到 `node --test test/frontend-static.test.js` 红灯，再实现面板。
- 目标验证：`node --test test/frontend-static.test.js`，63/63 通过。
- 质量/工作流回归：`node --test test/listing-quality.test.js test/workflow-runs.test.js`，45/45 通过。
- 全量测试：`npm test`，255/255 通过。
- Lint：`npm run lint`，41 files 通过。
- 本地服务检查：`http://127.0.0.1:5178` 返回 200，`/app.js` 可访问并包含新面板代码。

### 下一步

- 接入 Ozon 字典值候选推荐：对 `DICTIONARY_VALUE_INVALID` 不只定位字段，还展示当前类目合法值候选和置信度。
- 把高置信字段（品牌无品牌、型号、原产国、颜色/尺寸 aspect）做成“建议填入草稿”，仍需人工保存和预检。

## 启动与验证

- 启动后台：`powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 start`
- 停止后台：`powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 stop`
- 查看状态：`powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 status`
- 测试：`npm test`
- 当前前端静态测试基线：`node --test test/frontend-static.test.js`，52 个测试通过。

## 2026-06-29 前端功能归属与串区修复

用户反馈：ERP 左侧选中“营销活动”时，主内容区却出现 `平台分类 / 无忧易售信息 / 描述 / 产品采集图` 等上架草稿字段，说明不是单个 tab 文案问题，而是整个功能区归属和导航运行逻辑不清晰。

本阶段修复：

1. 新增 `ERP_VIEW_OWNERSHIP_CONTRACTS`，为每个业务页定义：
   - 当前功能区。
   - 本页处理什么。
   - 本页不处理什么。
   - 错页提示。
2. 新增 `renderViewOwnershipBars()`，所有业务页顶部都会显示功能归属契约，普通操作员先知道“这个页面是干嘛的”。
3. 修正导航同步：
   - `activateErpView()` 只激活目标 view，并通过 `syncNavigationForView()` 同步左侧 tab 与一级分组。
   - 一级导航点击时固定进入该组第一个 tab，不再复用隐藏/历史 active tab，避免串区错觉。
4. 明确营销活动页边界：
   - 只处理 Ozon 活动读取、活动商品、可加入商品和移出活动。
   - 如果营销活动页出现上架字段，按“路由/内容串区 bug”处理。
5. 更新 `docs/erp-ui-information-architecture.zh-CN.md`，加入“功能区归属契约”和全局区检查原则。

已验证：

- `node --test test/frontend-static.test.js`：52 个测试通过。

## 2026-06-29 Tab 长页面瘦身

用户继续反馈：每个 tab 内部页面过长，一打开就是大量面板和字段，看不出系统到底想让用户做什么。

本阶段修复：

1. 新增 `ERP_TAB_TASK_CARDS`，每个业务 tab 都有顶部任务入口卡。
2. 新增 `renderTabTaskCards()`，在功能区归属契约后展示：
   - 这个页面先做什么。
   - 当前页面的核心任务。
   - 2-3 个下一步按钮。
3. 新增 `applyProgressiveDisclosure()`：
   - 每个 view 只默认露出前 1-2 个关键业务面板。
   - 后续长内容统一加 `tab-secondary-panel tab-secondary-collapsed`。
   - 用户需要时点“展开本页高级内容”再查看。
4. 新增样式：
   - `tab-task-card`
   - `tab-disclosure-toggle`
   - `tab-secondary-panel`
   - `tab-secondary-collapsed`
5. 更新 `docs/erp-ui-information-architecture.zh-CN.md`，加入“Tab 页面层级”规则：标题 → 归属契约 → 任务入口卡 → 关键面板 → 高级内容折叠。

已验证：

- `node --test test/frontend-static.test.js`：53 个测试通过。

## 2026-06-29 侧栏文字被隐藏回归修复

用户截图反馈：左侧二级导航只剩图标，文字全部消失。根因是旧的 `@media (max-width: 1439px)` 窄侧栏规则在普通桌面浏览器宽度下生效，把 `.tab > span:not(.tab-icon)`、分组标题、品牌和店铺卡全部 `display: none`。

本阶段修复：

1. 在 `@media (max-width: 1439px)` 内为 `business-erp-theme` 加业务版覆盖规则：
   - 侧栏继续保持 `292px`。
   - tab 文字继续 `display: inline`。
   - 品牌、分组标题、店铺卡继续可见。
   - 主内容左边距保持 `378px`。
2. 新增回归测试 `business ERP sidebar keeps text labels visible on desktop widths`。

已验证：

- `node --test test/frontend-static.test.js`：54 个测试通过。
- `npm test`：223 个测试通过。
- `npm run lint`：通过。

## 当前运行注意

为避免 EasyOCR 卡住上架请求，当前可用临时运行参数：

- `OZON_IMAGE_PREPARE_COUNT=4`
- `OZON_IMAGE_OCR_ENABLED=0`

默认代码仍保持 OCR 开启；该参数只用于小量实跑或紧急验证。长期方案应改成图片 OCR 异步队列，不阻塞 `/complete-listing`。

## 已修复的关键问题

1. 同一 job 重试时复用同一个父 SKU，避免 OCR 卡住后重复生成 `SKUlq00126 / SKUlq00127` 这种重复卡。
2. 已归档幽灵重复卡：
   - 归档：`SKUlq00126`
   - product_id：`4904379384`
   - 保留在售：`SKUlq00127`
   - product_id：`4904387807`
3. 已重新保存 `SKUlq00127`：
   - task_id：`4677748900`
   - import errors：空
4. 自动上架最低价规则已修正：
   - 售价小数：向下取整，例如 `25.2 -> 25`
   - 售价整数：减 1，例如 `25 -> 24`
5. 自动上架已支持 1688 多 SKU 展开：
   - SKU 数 2-5 个时展开多个 Ozon offer
   - 子 SKU 命名格式：`父SKU-俄文化变体属性`
   - 示例：`SKUlq00127-makaronnye-tsveta-miks-tsvetov-100-sht`
6. 自动上架已补 `is_aspect` 变体属性：
   - 例如 `颜色名称(10097)`、`长度，m(4678)`、`厚度，毫米(4662)`
7. 已保留 Ozon 同类反哺、1688 属性、DeepSeek `attributes_hint` 的懒加载属性补全。
8. 1688/Ozon 浏览器插件已修复人机暂停逻辑：
   - 发现人机验证后写入暂停标记。
   - 清理 `ozon-erp-crawler-poll` 定时轮询。
   - 保持当前验证页打开并激活，不再继续刷任务。
   - 普通“立即检查任务”不会误清除暂停；只有人工通过后才恢复。
9. 玫瑰玻璃罩/灯罩礼品类目误配已修复：
   - `Роза в колбе / 玫瑰 / 永生花 / LED / 摆件` 优先走纪念品/礼品/家居装饰/夜灯方向。
   - 明确压低 `礼品包装纸 / 包装纸 / 包装材料`，避免被“礼品”泛化误配。
10. Ozon 多变体 `offer_id` 重复已修复：
   - 同色不同罩材（玻璃罩/亚克力罩）会生成不同俄文化 SKU 后缀。
   - Ozon 提交和库存队列前新增 `offer_id` 去重保险。
   - 去重时会记录 `variants_deduped` 步骤，避免重复库存行。
11. 多变体可变特征覆盖已修复：
   - `mergeVariantListingAttributes()` 会让变体属性覆盖基础属性。
   - 避免所有子 SKU 继承同一个基础颜色，导致 Ozon 报“无法与其他商品合并/可变特性相同”。
12. Ozon 标题中文残留已修复：
   - `normalizeOzonTitleForListing()` 会清理中文片段和中文标点。
   - 已覆盖猫咪钥匙扣标题中 `卡通立体` 混入俄文标题的问题。
13. 类目规则新增三类保护：
   - 猫咪钥匙扣优先 `住宅和花园 / 纪念品和礼品 / 纪念品`，避免误入汽车礼品套装、成人纪念品、水晶小饰品。
   - `礼品` 供应商属性不再单独触发纪念品逻辑，避免宠物饮水机误入纪念奖牌。
   - 纯饮水/喷泉意图优先 `宠物用品 / 宠物餐具 / 宠物饮水器`，压过宠物自动喂食器。
14. Ozon 模型重试属性保留已修复：
   - `retry_model` 不再只保留品牌/型号字段。
   - 新增 `mergeRetryModelAttributes()`，补模型名时保留 `4958 Предназначено для` 等其它必填属性。
   - 覆盖 Ozon 报错：`Название модели (для объединения в одну карточку)` / `Предназначено для` 这类必填字段在重试中被误删的问题。
15. 工作流控制台设计已完成：
   - 设计文档：`docs/workflow-console-design.zh-CN.md`
   - 目标：把 1688 采集、Ozon 学习、分析、上架、审核、库存写入做成可观察、可暂停、可编辑 payload、可定点重试的标准工作流。

## 最近成功闭环

Ozon 参考：

`https://www.ozon.ru/product/sinelnaya-provoloka-dlya-rukodeliya-tvorchestva-i-podelok-10-tsvetov-100-shtuk-3536437377/`

1688 货源：

`https://detail.1688.com/offer/978985041695.html`

结果：

- SKU：`SKUlq00127`
- task_id：`4677516306`
- product_id：`4904387807`
- 店铺：`3815760-4 / xymallc`
- 状态：`live`
- 库存：已写入 100，仓库 `1020005003350730`

## 2026-06-04 自动化实跑记录

### 1688 单品采集

- 任务：`ct_1780577898504umska`
- 候选：`cc_178057820632620g39`
- 1688 URL：`https://detail.1688.com/offer/654891318123.html`
- 标题：`DIY环氧树脂硅胶模具书包 饰品钥匙挂件四格迷你猫爪硅胶模具批发`
- 结果：完成采集，`candidatesSaved=1`

### Ozon 自动上架

- 上架 job：`al_mpzigq92direct`
- Ozon 参考机会：`mpqfuc35o36lzz`
- Ozon 标题：`Роза в колбе с подсветкой красная, подарок девушке`
- 1688 候选：`cc_1780078066310ujb0i`
- 1688 URL：`https://detail.1688.com/offer/676736066669.html`
- 父 SKU：`SKUlq00128`
- Ozon task_id：`4685902627`
- 店铺：`3815760-4`
- 状态：`live`
- 导入 product_id：
  - `SKUlq00128-krasnyy` → `4916398209`
  - `SKUlq00128-zheltyy` → `4916398204`
  - `SKUlq00128-rozovyy` → `4916398329`
- 库存队列：`sq17805785284398cuou`
- 仓库：`1020005003350730`

### 本次实跑暴露并已修复的问题

1. 类目误配：玫瑰玻璃罩礼品被打到 `爱好和创作 / 手工艺品材料 / 礼品包装纸`，已通过类目规则回归测试修复。
2. SKU 重复：同色不同罩材只生成颜色后缀，导致 `krasnyy / zheltyy` 重复，已通过变体后缀和提交前去重修复。
3. 插件人机暂停：旧插件遇人机仍会持续轮询刷新，已改为硬暂停并等待人工恢复。

### 已验证

- `node --test test\extension-unified.test.js`
- `node --test test\category-match.test.js test\listing-content-quality.test.js`
- `npm test`
- 当前结果：48 个测试全部通过。

## 2026-06-08 自动化实跑记录

### 本轮代码修复

- `src/autoListing.js`
  - 标题清洗移除中文字符片段，避免 Ozon 标题中混入 1688 中文。
  - 多变体属性合并时，变体属性覆盖基础属性，确保 `颜色名称(10097)` 等可变特征按子 SKU 区分。
- `src/ozonCategoryCache.js`
  - 猫咪钥匙扣类目从 `水晶小饰品` 修正为更稳的 `纪念品`。
  - 宠物饮水机类目从 `纪念奖牌` 修正为 `宠物饮水器`。
  - 收窄 `礼品` 泛词对纪念品类目的影响。
- 新增/更新测试：
  - `test/listing-content-quality.test.js`
  - `test/category-match.test.js`
- 验证：`npm test`，当前 54 个测试全部通过。

### 猫咪钥匙扣验证

- 1688 候选：`cc_1780052530307aed2w`
- 1688 URL：`https://detail.1688.com/offer/1050435735127.html`
- 旧失败任务：`al_mq3ogyz6cat3`
  - SKU：`SKUlq00132`
  - Ozon task_id：`4721273538`
  - 失败原因：标题/类型不匹配，标题中残留中文 `卡通立体`，并误入 `水晶小饰品`。
  - 核对结果：变体属性已经区分，颜色分别为 `черный 23 шт`、`черный оранжевый 23 шт`、`желтый 23 шт`、`серый 23 шт`、`оранжевый 23 шт`。
- 修复后重跑任务：`al_mq3t1x14cat4`
  - SKU：`SKUlq00133`
  - Ozon task_id：`4722124545`
  - 类目：`住宅和花园 / 纪念品和礼品 / 纪念品`
  - 标题：已无中文残留。
  - 结果：Ozon 判定与旧 `SKUlq00132` 部分变体重复，未继续作为成功样本。

### 宠物饮水机成功闭环

- 1688 候选：`cc_17800832113116zoa6`
- 1688 URL：`https://detail.1688.com/offer/1039844389103.html`
- 商品：宠物 USB 自动饮水机/流动饮水器
- 成功任务：`al_mq3tpwv3water2`
- 父 SKU：`SKUlq00135`
- Ozon task_id：`4722250151`
- 店铺：`3815760-4`
- 状态：`live`
- 类目：`宠物用品 / 宠物餐具 / 宠物饮水器`
- 子 SKU：
  - `SKUlq00135-belyy-043-sht`
  - `SKUlq00135-zheltyy-043-sht`
- 库存队列：成功写入，事件 `stock_success`

### 本轮失败样本与原因

- `al_mq3tf085water1 / SKUlq00134`
  - 失败原因：供应商属性里的 `是否属于礼品 / 商务礼品` 误触发纪念品类目，提交到 `纪念奖牌`。
  - 已修复：`礼品` 不再单独触发 `keychainSouvenir`，饮水机预检已命中 `宠物饮水器`。
- `al_mq3t1x14cat4 / SKUlq00133`
  - 失败原因：与旧 `SKUlq00132` 两个变体重复。
  - 结论：不是变体特征 bug；标题和类目修复已生效，但旧失败导入残留会影响同货源重复上架。

## 2026-06-08 受控自动上架第二轮

### 宠物喂食饮水二合一成功闭环

- 1688 候选：`cc_1780084623362lpjt0`
- 1688 URL：`https://detail.1688.com/offer/676537176601.html`
- 商品：猫咪自动喂食器/饮水机二合一，3 个颜色变体来源。
- 上架 job：`al_mq4pmfhqfeed1`
- 父 SKU：`SKUlq00136`
- Ozon task_id：`4728558469`
- product_id：`4971852162`
- 店铺：`3815760-4`
- 状态：`live`
- Ozon 前台状态：`Продается`
- 审核状态：`approved`
- 类目：`宠物用品 / 宠物餐具 / 宠物自动喂食器`
- 库存：已写入 100，库存队列事件 `stock_success`

### 本轮暴露并已修复的问题

1. 首次提交 `SKUlq00136` 时，Ozon 回执报：
   - `Предназначено для(4958)` 必填缺失。
   - 根因：Ozon 触发 `retry_model` 后，代码用品牌/型号字段替换了整个属性数组，误删了其它必填属性。
2. 已修复：
   - 新增 `mergeRetryModelAttributes()`。
   - `retry_model` 只替换品牌/模型相关字段，保留其它必填属性。
   - 测试：`mergeRetryModelAttributes preserves required non-model attributes`。
3. 用户后续看到的 Ozon 提示：
   - `Название модели (для объединения в одну карточку)`。
   - 已核查当前 `SKUlq00136` 的 Ozon API 属性：`9048` 已存在，当前值为 `SKUlq00136`。
   - 当前 product_id `4971852162` errors 为空，状态已在售。

### 已验证

- `node --test test/listing-content-quality.test.js`
- `npm test`
- 当前结果：55 个测试全部通过。

## 2026-06-08 工作流控制台设计

### 已完成设计文档

- 文件：`docs/workflow-console-design.zh-CN.md`
- 方案：标准版 `workflow-runs.json` + 人工可干预控制台。
- 目标：把 ERP 从“黑盒自动化”改造成“可观察、可暂停、可修复、可定点重试”的工作流。

### 第一版设计范围

- 新增统一数据文件：`data/workflow-runs.json`
- 固定 10 个节点：
  1. `ozon_learning`
  2. `keyword_expand`
  3. `crawler_1688`
  4. `candidate_parse`
  5. `match_profit`
  6. `content_generate`
  7. `preflight_check`
  8. `ozon_submit`
  9. `review_reconcile`
  10. `stock_sync`
- 每个节点保存：
  - `status`
  - `input`
  - `output`
  - `error`
  - `diagnosis`
  - `actions`
- 控制台支持：
  - 工作流列表
  - 节点时间线
  - 节点详情
  - payload 查看/编辑/保存草稿/校验/人工确认提交
  - 暂停、恢复、重试本节点、从这里继续、自动修复

### 关键设计约束

- payload 人工编辑后必须先校验，再二次确认提交。
- 禁止自动连续提交多个 Ozon task。
- 遇到人机、必填字段、类目风险、重复卡等问题时进入 `waiting_human`，不继续刷任务。
- 第一版不做拖拽编排，不替换现有 `auto-listing-jobs.json`，先作为统一观察与干预层。

## 2026-06-08 工作流控制台第一版实现

更新时间：2026-06-08 17:23:58 +08:00

### 已完成

- 新增工作流持久化模块：`src/workflowRuns.js`
  - 数据文件：`data/workflow-runs.json`
  - 支持创建/读取工作流、节点 upsert、事件追加、暂停/恢复、payload 草稿保存与校验。
  - 新增 `diagnoseWorkflowError()`，可识别 `9048 Название модели`、`4958 Предназначено для`、类目/type 等常见 Ozon 报错。
  - 新增 `validateSubmitPayload()`，提交前检查重复 `offer_id`、标题中文、类目/type、价格、图片、品牌 `85`、模型名 `9048`。
- 新增 `/api/workflows` 系列 API：
  - `GET /api/workflows`
  - `POST /api/workflows`
  - `GET /api/workflows/:id`
  - `POST /api/workflows/:id/pause`
  - `POST /api/workflows/:id/resume`
  - `POST /api/workflows/:id/nodes/:key/retry`
  - `PUT /api/workflows/:id/payload-draft`
  - `POST /api/workflows/:id/payload-draft/validate`
- 前端新增“工作流控制台”：
  - 文件：`public/index.html`、`public/app.js`、`public/styles.css`
  - 支持运行列表、节点时间线、节点详情、诊断展示、输入/输出查看、payload 草稿编辑、保存、校验、暂停、恢复、重试节点。
- 自动上架真实流程已接入工作流：
  - `src/autoListing.js`
  - `findOrCreateWorkflowForAutoListingJob()` 按 `autoListingJobId` 复用同一条 workflow。
  - `completeListing()` 写入：
    - `ozon_submit`
    - `preflight_check`
    - `review_reconcile`
  - Ozon 回执错误会进入诊断，并在失败时把 workflow 标成 `waiting_human`。
- 库存队列已接入工作流：
  - `src/stockQueue.js`
  - 新增 `workflowStockNodeFromJob()`。
  - 库存排队/成功/失败会同步 `stock_sync` 节点。
  - 库存成功时 workflow 可进入 `live`；库存失败时进入 `waiting_human`。
- 总流程状态已纳入 workflow 摘要：
  - `src/flowSupervisor.js`
  - 新增 `summarizeWorkflowRuns()`。
  - `getFlowStatusSnapshot()` 返回 `workflowRuns` 统计：`total/running/waitingHuman/failed/live/paused`。

### 新增/更新测试

- `test/workflow-runs.test.js`
  - 工作流创建、节点 upsert、事件追加、诊断、payload 校验、暂停/恢复、payload 草稿校验、自动上架 job 绑定复用。
- `test/frontend-static.test.js`
  - 前端工作流控制台 shell 和 payload editor hooks。
- `test/stock-queue.test.js`
  - `workflowStockNodeFromJob()` 映射库存成功为 `stock_sync`。
- `test/flow-supervisor.test.js`
  - `summarizeWorkflowRuns()` 统计 waiting-human/failed/live。

### 验证结果

- `node --test test\frontend-static.test.js`
- `node --test test\workflow-runs.test.js`
- `node --test test\stock-queue.test.js`
- `node --test test\flow-supervisor.test.js`
- `npm test`
- 当前结果：65 个测试全部通过。

### 下一阶段建议

1. 手动启动 ERP，打开“工作流控制台”，用 `/api/workflows` 做一次 UI 冒烟验证。
2. 再跑 1 条受控自动上架，确认 `preflight_check -> ozon_submit -> review_reconcile -> stock_sync` 能出现在控制台。
3. 如果出现 `waiting_human`，优先在控制台查看诊断和 payload 草稿，不要立即重复点击全自动上架。
4. 下一步再接入更早阶段节点：`ozon_learning`、`keyword_expand`、`crawler_1688`、`candidate_parse`、`match_profit`、`content_generate`。

## 当前主要风险

1. OCR 仍可能卡死 Python 子进程，导致提交接口长时间无响应。
2. 已上架的 `SKUlq00127` 是旧单 SKU 结构；新代码支持多 SKU，但不应直接覆盖旧商品，避免再次重复。
3. 后续应使用新候选商品验证多 SKU 展开，不要在同一已上架商品上反复试。
4. Ozon 前台/1688 插件遇人机验证必须进入 `waiting_human`，禁止持续刷新；当前代码已修，但本地 Chrome 需要重新加载/安装最新扩展包。
5. 上架内容标题已补中文残留清洗；描述、属性、营销词仍建议继续增加中文残留检查。
6. 旧的队列文件里可能残留历史 crawler/listing 任务；继续实跑前应先确认队列只保留本轮目标任务。
7. 同一个 1688 货源如果已有失败导入残留，Ozon 可能继续判重复；再次验证应优先换新货源，或先在 Ozon 后台清理残留卡片。
8. `workflow-runs.json` 统一观察层已实现第一版，但目前主要接入了上架/审核/库存后半段；采集、学习、匹配、内容生成前半段还需要继续接入。

## 下一步建议

1. 选新的 1688 小件多 SKU 候选，走 Ozon 反哺后提交一条多 SKU 测试。
2. 验证 Ozon 内容评分里“特征”是否因为变体属性和懒加载属性提升。
3. 把图片 OCR 改成异步队列：先筛缓存图，缺 OCR 的进入图片审核队列，不阻塞上架提交。
4. 对自动上架的 submit payload 增加快照检查：属性数量、min_price、skuOffers、is_aspect 属性必须达标后才提交。
5. 给描述、属性和 rich content 增加中文残留检查，尤其是节日词、1688 促销词、工厂/批发词。
6. 自动上架候选进入 submit 前增加“类目强校验”：当宠物/饮水/喂食等强意图存在时，禁止提交到纪念品/礼品等泛类目。
7. 增加重复残留处理策略：同一 1688 URL 或同款 Ozon 已有失败导入时，自动提示人工清理或换候选，不要盲目新建 SKU。
8. 继续把 `ozon_learning`、`keyword_expand`、`crawler_1688`、`candidate_parse`、`match_profit`、`content_generate` 接入 `workflow-runs.json`。

## 2026-06-09 工作流控制台第二阶段增强

更新时间：2026-06-09  +08:00

### 沟通说明

- 之前每个阶段末尾的“现在请你执行：更新交接文档”，是按用户早先约定给出的阶段提醒。
- 如果用户明确说“请执行：更新交接文档”，则由 Codex 直接更新本文件。
- 后续建议改成更清晰表述：`阶段完成；是否需要我更新交接文档？`，避免误解为必须用户手动执行。

### 已完成：安全自动化默认观察模式

- `src/dailyDistributor.js`
  - `OZON_DISTRIBUTOR_AUTORUN` 默认关闭。
  - `OZON_SERVER_AUTO_HEAL` 默认关闭。
  - distributor 默认只观察，不自动创建/提交任务。
- `src/server.js`
  - server auto-heal 仅在显式开启时执行。
- `src/flowSupervisor.js`
  - 新增自动化安全状态：`observe_only`。
  - `/api/flow/status` 返回 `automation.mode`、`distributorAutorun`、`serverAutoHeal`。
  - observe-only 下阻止自动修复创建/重试/重新提交任务。
- 当前接口状态：`automation.mode = observe_only`。

### 已完成：人工介入闭环

- `src/workflowRuns.js`
  - 新增 `requestWorkflowNewSource()`：人工选择换新货源，关闭当前候选并写事件。
  - 新增 `retryWorkflowAfterManualFix()`：人工确认外部残留已清理后重试当前节点。
  - 新增 `confirmWorkflowContinue()`：人工确认风险可接受后解除等待/提交锁。
  - workflow 节点 upsert 保留已有 metadata/diagnosis/input/output/actions，避免后续写入覆盖诊断。
  - waiting-human/run 状态自动同步 `locks.waitingHuman`。
- `src/server.js`
  - 新增 API：
    - `POST /api/workflows/:id/request-new-source`
    - `POST /api/workflows/:id/nodes/:key/manual-fix-retry`
    - `POST /api/workflows/:id/nodes/:key/confirm-continue`
- `public/app.js`
  - waiting-human 节点详情显示“人工介入”面板。
  - 三个按钮：`换新货源`、`已清理残留，重试`、`确认继续提交`。
  - `确认继续提交` 有浏览器二次确认。
- `public/styles.css`
  - 新增人工介入面板样式和危险按钮样式。

### 已完成：workflow 汇总与锁状态

- `src/workflowRuns.js`
  - `summarizeWorkflowRunList()` 新增：
    - `lockedWaitingHuman`
    - `submitLocked`
    - `lockedPaused`
- `public/app.js`
  - 工作流汇总卡显示等待人工锁、提交锁、暂停锁。
  - 节点详情和卡片显示锁徽章：`已暂停`、`等待人工`、`提交锁定`、`无锁`。
- 已修正历史 workflow 数据：等待人工流程带 `locks.waitingHuman=true`，陈旧 `ozon_submit running` 节点改为 skipped。

### 已完成：前半段 workflow 接入

- `src/crawler1688.js`
  - 1688 采集任务创建时自动创建/绑定 workflow。
  - 写入 `crawler_1688` 节点：任务 ID、搜索词/URL、初始插件任务、采集状态。
  - 插件 discover/detail 遇人机时写入 `waiting_human`，不继续派发。
  - 详情解析后写入 `candidate_parse` 节点：候选数量、通过/拒绝数量、标题、URL、价格、SKU 数、图片数、尺重状态。
  - 新增 `CRAWLER1688_DATA_DIR` 支持测试隔离。
- `src/autoListing.js`
  - `match_profit` 节点增强：记录评估数、拒绝数、拒绝原因统计、拒绝样本、最佳匹配利润/置信度/采购价/目标价/价差。
  - `content_generate` 节点增强：记录俄文标题、描述长度、属性提示字段、候选图片数、SKU 变体数、尺重状态、视觉卡片状态、内容问题。

### 已完成：提交前总闸与审核回执

- `src/workflowRuns.js`
  - 新增 `buildPreflightGateNode()`。
  - 总闸汇总：payload 问题、重复货源、内容问题、图片不足、尺重缺失、类目缺失、多变体塌缩为单 SKU。
  - preflight 失败时：`status=failed`、`runStatus=waiting_human`、`reasonCode=PREFLIGHT_BLOCKED`。
  - 新增 `workflowReviewReconcileNode()`。
  - Ozon 回执节点输出：`taskId`、`skuOffers`、`importedCount`、`errorCount`、`warningCount`、`reasonCode`、`firstError`、`importErrors`、`importWarnings`。
- `src/autoListing.js`
  - `completeListing()` 改为调用 `buildPreflightGateNode()`。
  - preflight 失败会真正阻断，不再继续调用 Ozon `/v3/product/import`。
  - 阻断时 job 状态为 `preflight_blocked`。
  - Ozon 回执改为 `workflowReviewReconcileNode()` 写入，错误进入 waiting-human。

### 已完成：存储稳定性

- `src/workflowRuns.js`
  - 写入 `workflow-runs.json` 增加串行写队列。
  - Windows `EPERM/EBUSY/ENOENT rename` 增加重试。
  - 解决全量测试中 workflow 测试并发写 JSON 偶发失败。

### 当前测试状态

- 最新全量验证：`npm test`
- 当前结果：`102/102` 通过。

### 当前运行状态

- 后台已重启。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行。
- `/api/flow/status`：`observe_only`。
- 当前 workflow 概况：约 4 条历史 workflow，其中约 3 条仍处于 `waiting_human`，主要是重复货源/重复参考品风险。

### 当前项目判断

- 工作流已从“后半段观察层”升级为“采集到审核的主流程可观察层”。
- 已接入节点：
  - `crawler_1688`
  - `candidate_parse`
  - `match_profit`
  - `content_generate`
  - `preflight_check`
  - `ozon_submit`
  - `review_reconcile`
  - `stock_sync`
- 仍需加强节点：
  - `ozon_learning`
  - `keyword_expand`
- 当前策略正确：不要立即恢复无人值守全自动，应先跑单条受控流程，观察每个节点输入/输出/诊断。

### 下一步建议

1. 接入 `ozon_learning` 节点：Ozon 采样任务、竞品数量、类目/价格/标题样本、采样失败原因。
2. 接入 `keyword_expand` 节点：翻译词、扩展词、多维度关键词、拓词失败原因。
3. 做 workflow “从节点继续”的真实执行闭环，而不只是标记重试。
4. 增加“换新货源”动作的自动后续：从当前 Ozon 样本重新采集一个新 1688 候选。
5. 跑一条受控链路：`1 个 Ozon 学习样本 -> 1688 采集 -> 匹配 -> 内容生成 -> preflight`，暂不自动提交 Ozon。
6. 确认 Chrome 扩展已重新加载最新版，避免人机后继续刷页面。

## 2026-06-09 工作流源头节点接入补充

更新时间：2026-06-09 +08:00

### 用户偏好更新

- 用户明确要求：`更新交接文档。不要问。继续后面的开发`。
- 后续阶段完成后，Codex 应直接更新本交接文档，不再询问“是否需要更新交接文档”。

### 已完成：`ozon_learning` 接入 workflow

- `src/ozonLearning.js`
  - 新增 `OZON_LEARNING_DATA_DIR`，支持测试隔离。
  - 新增 `summarizeLearningRows()`，汇总 Ozon 学习样本。
  - 新增 `findOrCreateOzonLearningWorkflow()`，按 `ozonLearningTaskId` 绑定 workflow。
  - 新增 `emitOzonLearningWorkflowNode()`，统一写入 `ozon_learning` 节点。
  - Ozon 学习任务创建时写入 running 节点。
  - 搜索完成后写入：样本数量、详情队列数、机会品数量、价格区间、类目统计、样本标题。
  - Ozon 人机/登录验证会进入 `waiting_human` 并设置 `locks.waitingHuman=true`。

### 已完成：`keyword_expand` 接入 workflow

- `src/workflowRuns.js`
  - `workflowNodeFromAutoListingStage()` 的 output 新增源头字段：
    - `sourceType`
    - `sourceValue`
    - `sourceText`
    - `keywordCount`
    - `totalFound`
    - `detailQueued`
    - `detailedCount`
    - `opportunityCount`
    - `priceMinRub`
    - `priceMaxRub`
    - `categoryCounts`
    - `sampleTitles`
- `src/autoListing.js`
  - `sampled` 阶段写入 Ozon 样本摘要。
  - `translating` 阶段写入原始 Ozon 文本 `sourceText`、翻译关键词 `keyword`、扩展关键词 `searchKeywords`。

### 新增/更新测试

- `test/ozon-learning-workflow.test.js`
  - Ozon 学习搜索任务会写入 `ozon_learning` workflow 节点。
  - Ozon 人机会让 workflow 进入 `waiting_human`。
- `test/workflow-runs.test.js`
  - `workflowNodeFromAutoListingStage()` 覆盖 Ozon 学习样本摘要和 keyword_expand 摘要。
- `test/frontend-static.test.js`
  - 覆盖 Ozon 学习和关键词扩展诊断字段。

### 验证结果

- `npm test`
- 当前结果：`106/106` 通过。

### 当前链路状态

主链路已基本完整可视化：

`ozon_learning -> keyword_expand -> crawler_1688 -> candidate_parse -> match_profit -> content_generate -> preflight_check -> ozon_submit -> review_reconcile -> stock_sync`

### 下一步开发方向

1. 做 workflow “从节点继续”的真实执行闭环，而不只是修改状态/写事件。
2. 优先支持安全动作：
   - `preflight_check`：重新校验 payload 草稿/提交前总闸。
   - `crawler_1688`：恢复采集任务。
   - `review_reconcile`：按诊断进入修复/重试路径。
3. 动作必须继续尊重 `observe_only`，不能绕过人工确认自动提交 Ozon。

## 2026-06-09 工作流“从节点继续”闭环补充

更新时间：2026-06-09 +08:00

### 已完成：安全续跑入口

- `src/server.js`
  - 新增 `continueWorkflowNode()`，作为页面“从此继续”的统一后端入口。
  - 新增接口：`POST /api/workflows/:id/nodes/:key/continue`。
  - 当前支持安全动作：
    - `crawler_1688`：如果 workflow 绑定了 `crawlerTaskId`，将采集任务恢复为 `running`。
    - `preflight_check`：如果存在 `payloadDraft`，重新执行 payload 草稿校验。
    - 其他节点：只记录续跑请求与审计事件，不绕过人工锁强行提交。
  - 每次点击会追加 `continue_requested` 事件，便于在事件时间线追踪是谁、在哪个节点触发了继续。

### 已完成：前端人工控制台入口

- `public/app.js`
  - 节点操作区新增按钮：`从此继续`。
  - 点击后调用 `/api/workflows/:id/nodes/:key/continue`。
  - 事件时间线新增 `continue_requested -> 从此继续` 中文标签。
  - 保留已有动作：暂停、恢复、重试节点、换新货源、已清理残留重试、确认继续提交。

### 新增/更新测试

- `test/server-routes.test.js`
  - 覆盖 workflow continue node route。
- `test/frontend-static.test.js`
  - 覆盖 `continue-node` 按钮与 `continue_requested` 事件标签。

### 验证结果

- 局部验证：`node --test test\server-routes.test.js test\frontend-static.test.js`
  - `19/19` 通过。
- 全量验证：`npm test`
  - `107/107` 通过。

### 当前运行状态

- 已执行 `scripts\ops.ps1 stop` / `scripts\ops.ps1 start` 重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status` 当前安全模式：`observe_only`。
- 当前 workflow 概况：`total=4`，`waitingHuman=3`，`highRisk=4`，`blocking=4`。
- 当前主要人工动作仍是：`人工确认是否换货源`。

### 当前判断

- 工作流控制台已具备第一版“人工可干预控制台”闭环：能看节点、看诊断、看锁、保存/校验 payload、暂停/恢复、换货源、重试、确认继续、从节点继续。
- 当前“从此继续”是安全版续跑：只恢复可安全恢复的节点，不会在 `observe_only` 下偷偷自动提交 Ozon。
- 下一步应把“从此继续”扩展为节点执行器：按节点 key 调用对应 runner，并把每一步结果重新写回 workflow。

### 下一步开发方向

1. 做 `workflowNodeExecutor`：把 `crawler_1688`、`candidate_parse`、`match_profit`、`content_generate`、`preflight_check` 的续跑动作统一封装。
2. 优先把 `request-new-source` 做成真实换货源：从当前 Ozon 学习样本/关键词重新挑 1 个 1688 候选。
3. 增加前端按钮禁用规则：高风险节点只允许人工确认后的动作，避免误点。
4. 跑一条受控链路到 `preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-09 工作流节点执行器第一版

更新时间：2026-06-09 +08:00

### 已完成：`workflowNodeExecutor` 模块化

- 新增 `src/workflowNodeExecutor.js`
  - 把原来写在 `src/server.js` 里的“从此继续”逻辑拆成独立执行器。
  - 导出 `continueWorkflowNode()`，后续所有节点续跑逻辑统一从这里扩展。
  - 使用依赖注入方式接入外部动作，便于测试和避免执行器直接耦合 Express。

### 当前支持的安全续跑动作

- `crawler_1688`
  - 如果 workflow 绑定了 `entity.crawlerTaskId`，调用 `updateCrawlerTaskStatus(taskId, "running")`。
  - 追加动作：`crawler_resumed`。
- `preflight_check`
  - 如果存在 `payloadDraft`，调用 `validatePayloadDraft(runId)`。
  - 追加动作：`payload_draft_validated`。
- 其他节点
  - 只记录 `continue_requested` 事件。
  - 追加动作：`continue_recorded`。
  - 明确 `supported=false`，表示还没有接入真实自动执行器。
  - 不会触发 Ozon 提交，不会绕过 `observe_only`。

### 已完成：server 接入执行器

- `src/server.js`
  - `POST /api/workflows/:id/nodes/:key/continue` 改为调用 `workflowNodeExecutor.continueWorkflowNode()`。
  - 传入依赖：`getWorkflowRun`、`updateCrawlerTaskStatus`、`validatePayloadDraft`、`retryWorkflowAfterManualFix`、`appendWorkflowEvent`。
  - 避免 server 内继续堆积节点执行分支。

### 新增测试

- `test/workflow-node-executor.test.js`
  - 覆盖 `crawler_1688` 续跑会恢复绑定采集任务。
  - 覆盖 `preflight_check` 续跑会重新校验 payload 草稿。
  - 覆盖未支持节点只记录事件，不产生不安全副作用。

### 验证结果

- 局部验证：`node --test test\workflow-node-executor.test.js test\server-routes.test.js test\frontend-static.test.js`
  - `22/22` 通过。
- 全量验证：`npm test`
  - `110/110` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。
- 当前 workflow 概况：`total=4`，`waitingHuman=3`，`highRisk=4`，`blocking=4`。

### 下一步开发方向

1. 为 `match_profit` 接入真实续跑动作：基于 workflow/entity 找回 auto listing job 或候选，重新执行匹配/利润评估。
2. 为 `content_generate` 接入真实续跑动作：基于已有候选和类目，重新生成标题、描述、属性、图片摘要。
3. 为 `request-new-source` 接入真实换货源动作：从现有 Ozon 学习样本/关键词重新创建一个 1688 采集任务。
4. 前端补充按钮状态：对 `supported=false` 的节点显示“仅记录，未接入自动执行”。

## 2026-06-09 `match_profit` 真实续跑第一版

更新时间：2026-06-09 +08:00

### 已完成：匹配/利润节点接入真实续跑

- `src/workflowNodeExecutor.js`
  - `continueWorkflowNode()` 新增 `match_profit` 分支。
  - 当 workflow 绑定 `entity.autoListingJobId` 时，调用 `rerunAutoListingMatch(autoListingJobId)`。
  - 成功动作标记为 `match_profit_rerun`。
  - 仍会追加 `continue_requested` 审计事件。

### 已完成：autoListing 只重跑匹配，不提交 Ozon

- `src/autoListing.js`
  - 新增 `selectBestMatchForOzon()`：纯匹配选择函数，复用本地/AI 匹配、利润计算、跑量兜底逻辑。
  - 新增 `rerunAutoListingMatch()`：按 auto listing job 重新获取 Ozon 上下文、候选池、小件门禁、排序候选，然后只执行匹配/利润分析。
  - 匹配成功后：job 状态更新为 `matched`，写入 `bestMatch`、`candidateData`、`ozonContext`，workflow `match_profit` 节点写入 success 诊断。
  - 匹配失败后：job 停在 `matching`/`failed`，workflow `match_profit` 节点进入 `waiting_human`，记录 rejectedReasons/rejectedSamples。
  - 不生成 listingContent，不调用 `completeListing()`，不提交 Ozon。

### 已完成：server 接入

- `src/server.js`
  - 从 `autoListing.js` 导入 `rerunAutoListingMatch`。
  - `POST /api/workflows/:id/nodes/:key/continue` 的执行器依赖新增 `rerunAutoListingMatch`。

### 新增/更新测试

- `test/workflow-node-executor.test.js`
  - 覆盖 `match_profit` 节点点击“从此继续”会调用 `rerunAutoListingMatch()`。
- `test/auto-listing-match-rerun.test.js`
  - 覆盖 `selectBestMatchForOzon()` 能在不提交/不生成内容的情况下选出同族且有利润的候选。
- `test/server-routes.test.js`
  - 覆盖 server 已把 `rerunAutoListingMatch` 接入 workflow continue route。

### 验证结果

- 局部验证：`node --test test\auto-listing-match-rerun.test.js test\workflow-node-executor.test.js test\server-routes.test.js`
  - `7/7` 通过。
- 全量验证：`npm test`
  - `112/112` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。
- 当前 workflow 概况：`total=4`，`waitingHuman=3`，`highRisk=4`，`blocking=4`。

### 当前判断

- “从此继续”已经从记录型按钮升级为第一批真实节点执行器：
  - `crawler_1688`：恢复采集任务。
  - `preflight_check`：重新校验 payload 草稿。
  - `match_profit`：重新执行匹配/利润分析。
- 仍然没有自动提交 Ozon，符合当前安全策略。

### 下一步开发方向

1. 为 `content_generate` 接入真实续跑：基于 `matched` job 的 `bestMatch/candidateData/ozonContext` 重新生成标题、描述、属性和视觉卡片 prompt。
2. 前端对 `supported=false` 的节点显示“仅记录，未接入自动执行”。
3. 把 `request-new-source` 做成真实换货源动作：重新创建 1688 采集任务或从候选池挑下一个候选。
4. 跑一条受控链路到 `content_generate`，继续保持不自动提交 Ozon。

## 2026-06-10 `content_generate` 真实续跑第一版

更新时间：2026-06-10 +08:00

### 已完成：内容生成节点接入真实续跑

- `src/workflowNodeExecutor.js`
  - `continueWorkflowNode()` 新增 `content_generate` 分支。
  - 当 workflow 绑定 `entity.autoListingJobId` 时，调用 `rerunAutoListingContent(autoListingJobId)`。
  - 成功动作标记为 `content_generate_rerun`。
  - 仍会追加 `continue_requested` 审计事件。

### 已完成：autoListing 只重跑内容生成，不提交 Ozon

- `src/autoListing.js`
  - 新增 `rerunAutoListingContent()`。
  - 基于已匹配 job 的 `bestMatch`、`candidateData`、`ozonContext` 重新调用 `generateListingContentWithLlm()`。
  - 重新生成：`listingContent`、`visualCard.prompt`、`contentGenerationWorkflowSummary()`。
  - 成功后 job 状态更新为 `ready_for_listing`，workflow `content_generate` 节点写入 success 诊断。
  - 失败时 job 进入 failed/guided，workflow `content_generate` 节点进入 `waiting_human`，提示 LLM 未配置或内容生成失败。
  - 不调用 `completeListing()`，不调用 Ozon Seller API，不自动提交。

### 已完成：server 接入

- `src/server.js`
  - 从 `autoListing.js` 导入 `rerunAutoListingContent`。
  - `POST /api/workflows/:id/nodes/:key/continue` 的执行器依赖新增 `rerunAutoListingContent`。

### 新增/更新测试

- `test/workflow-node-executor.test.js`
  - 覆盖 `content_generate` 节点点击“从此继续”会调用 `rerunAutoListingContent()`。
- `test/server-routes.test.js`
  - 覆盖 server 已把 `rerunAutoListingContent` 接入 workflow continue route。

### 验证结果

- 局部验证：`node --test test\workflow-node-executor.test.js test\server-routes.test.js test\frontend-static.test.js`
  - `24/24` 通过。
- 全量验证：`npm test`
  - `113/113` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。
- 当前 workflow 概况：`total=4`，`waitingHuman=3`，`highRisk=4`，`blocking=4`。

### 当前判断

- “从此继续”当前真实支持节点：
  - `crawler_1688`：恢复采集任务。
  - `preflight_check`：重新校验 payload 草稿。
  - `match_profit`：重新执行匹配/利润分析。
  - `content_generate`：重新生成上架内容和视觉卡片 prompt。
- 整体仍处于安全观察模式，不会绕过人工确认自动提交 Ozon。

### 下一步开发方向

1. 前端对 `supported=false` 或 `continue_recorded` 的节点显示“仅记录，未接入自动执行”。
2. 为 `request-new-source` 接入真实换货源动作：重新创建 1688 采集任务或从候选池挑下一个候选。
3. 把 `content_generate -> preflight_check` 的衔接增强：内容生成成功后可自动写入/刷新 payloadDraft，然后由人工点击校验。
4. 跑一条受控链路到 `preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-10 `content_generate -> preflight_check` 草稿衔接

更新时间：2026-06-10 +08:00

### 已完成：内容生成后自动刷新 Payload 草稿

- `src/autoListing.js`
  - 新增 `buildListingPayloadDraftFromJob()`：从已生成内容的 auto listing job 构建 Ozon payload 草稿。
  - 草稿包含：`items`、offer_id、标题、描述、图片、尺重、价格、类目、品牌、模型名称、营销属性、变体 SKU。
  - 新增 `saveWorkflowPayloadDraftForListingJob()`：为 auto listing job 找到/创建 workflow，并写入 `payloadDraft`。
  - `rerunAutoListingContent()` 成功后会自动刷新 workflow `payloadDraft`。
  - 刷新成功后写入 `preflight_check` pending 节点，提示“等待人工点击校验 Payload”。
  - 不调用 `completeListing()`，不调用 Ozon Seller API，不自动提交。

### 当前交互逻辑

- 人工在 workflow 控制台点击 `content_generate` 的“从此继续”。
- 系统重新生成上架内容。
- 系统自动生成/刷新 Payload 草稿。
- `preflight_check` 节点变为 pending，并给出推荐动作：
  - 校验 Payload
  - 检查图片/属性/变体
  - 必要时编辑草稿
- 人工再点击“校验 Payload”，进入提交前总闸。

### 新增测试

- `test/auto-listing-payload-draft.test.js`
  - 覆盖 `buildListingPayloadDraftFromJob()` 能从 ready job 构建可通过 `validateSubmitPayload()` 的 payload 草稿。

### 验证结果

- 局部验证：`node --test test\auto-listing-payload-draft.test.js test\workflow-node-executor.test.js test\server-routes.test.js test\frontend-static.test.js`
  - `25/25` 通过。
- 全量验证：`npm test`
  - `114/114` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。
- 当前 workflow 概况：`total=4`，`waitingHuman=3`，`highRisk=4`，`blocking=4`。

### 当前判断

- 工作流已经形成更完整的人工可控链路：
  - `match_profit` 可真实续跑。
  - `content_generate` 可真实续跑。
  - 内容生成成功后会自动准备 payload 草稿。
  - `preflight_check` 仍由人工点击校验，不会自动提交 Ozon。

### 下一步开发方向

1. 前端增加“真实执行 / 仅记录”的按钮反馈：显示 `continue_requested.data.supported` 和 `actions`。
2. 为 `request-new-source` 接入真实换货源动作：重新创建 1688 采集任务或从候选池挑下一个候选。
3. 增强 payload 草稿 UI：显示草稿 item 数、父 SKU、类目路径、变体数。
4. 跑一条受控链路：`match_profit -> content_generate -> payloadDraft -> preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-10 workflow 续跑执行反馈显示

更新时间：2026-06-10 +08:00

### 已完成：前端区分“真实执行 / 仅记录”

- `public/app.js`
  - 新增 `workflowEventExecutionBadge()`。
  - 新增 `workflowEventActionText()`。
  - workflow 最近事件里，`continue_requested` 事件会显示：
    - `真实执行`：后端执行器实际调用了节点动作。
    - `仅记录`：当前节点尚未接入自动执行器，只记录了人工请求。
  - 事件 meta 中同步展示 actions，例如：`match_profit_rerun`、`content_generate_rerun`、`payload_draft_validated`、`continue_recorded`。

### 已完成：样式

- `public/styles.css`
  - 新增 `.workflow-event-meta`。
  - 新增 `.workflow-event-badge`。
  - 新增 `.workflow-event-badge-live` / `.workflow-event-badge-record`。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖事件时间线会显示续跑执行反馈。
  - 覆盖 `真实执行` / `仅记录` / actions 文案与样式钩子。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `18/18` 通过。
- 全量验证：`npm test`
  - `115/115` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。

### 当前判断

- 现在人工控制台不仅能点“从此继续”，还能在事件流里看清楚该次点击到底触发了真实执行，还是只是审计记录。
- 这能降低误操作和误判，适合继续扩展更多节点执行器。

### 下一步开发方向

1. 为 `request-new-source` 接入真实换货源动作：重新创建 1688 采集任务或从候选池挑下一个候选。
2. 增强 payload 草稿 UI：显示草稿 item 数、父 SKU、类目路径、变体数。
3. 跑一条受控链路：`match_profit -> content_generate -> payloadDraft -> preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-10 真实换货源第一版

更新时间：2026-06-10 +08:00

### 已完成：`request-new-source` 变成真实动作

- `src/autoListing.js`
  - 新增 `deriveNewSourceKeywords()`：从已有 `searchKeywords`、`keyword`、`bestMatch.candidateTitle`、`ozonTitle` 推导换源关键词。
  - 新增 `requestAutoListingNewSource()`：为当前 auto listing job 重新创建 1688 搜索任务。
  - 换源后会：
    - 创建新的 `crawler_1688` 搜索任务。
    - 更新 job 状态为 `waiting_crawl`。
    - 追加 `new_source_requested` 记录。
    - 重新写入 `waiting_crawl` workflow 节点。
    - 尝试刷新 payload 草稿（如果已有内容上下文可用）。

### 已完成：workflow 层不再盲目取消

- `src/workflowRuns.js`
  - `requestWorkflowNewSource()` 现在支持 `replacementCrawlerTaskIds`。
  - 如果有 replacement 任务，workflow 保持 `running`，不再变成 `cancelled`。
  - 如果没有 replacement 任务，仍保留原来的取消行为。

### 已完成：server 接入

- `src/server.js`
  - `POST /api/workflows/:id/request-new-source` 会先尝试对 `autoListingJobId` 调用 `requestAutoListingNewSource()`。
  - 再把 `replacementCrawlerTaskIds` 传回 workflow 状态更新。
  - 这样按钮“换新货源”在自动上架 workflow 上会真的开新 1688 搜索任务。

### 新增测试

- `test/auto-listing-new-source.test.js`
  - 覆盖换源关键词推导顺序。
- `test/workflow-runs.test.js`
  - 覆盖有 replacement 任务时 workflow 保持运行。
- `test/server-routes.test.js`
  - 覆盖 server 已接入 `requestAutoListingNewSource`。

### 验证结果

- 局部验证：`node --test test\auto-listing-new-source.test.js test\workflow-runs.test.js test\server-routes.test.js`
  - `26/26` 通过。
- 全量验证：`npm test`
  - `117/117` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。

### 当前判断

- 现在 `request-new-source` 已经不只是“放弃当前候选”，而是可以真的重新发起下一轮 1688 采集。
- 这让 workflow 从“看见失败”进一步变成“现场换血源”。

### 下一步开发方向

1. 给换源按钮增加更明确的 UI 文案：显示“已创建 X 个新 1688 任务”。
2. 增强 payload 草稿 UI：显示草稿 item 数、父 SKU、类目路径、变体数。
3. 跑一条受控链路：`match_profit -> content_generate -> payloadDraft -> preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-10 换货源按钮提示增强

更新时间：2026-06-10 +08:00

### 已完成：换货源提示更明确

- `public/app.js`
  - 新增 `workflowNewSourceToast()`。
  - 点击“换新货源”后，前端会根据后端返回的 `replacementCrawlerTaskIds` / `replacement.crawlerTaskIds` 提示：
    - `已创建 X 个新 1688 采集任务`
    - 若没有任务，则回退为 `已关闭当前候选，请重新选择新货源`
  - 这样能直观看到这次换源是否真的开了新任务。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowNewSourceToast` 与 `replacementCrawlerTaskIds` 的静态可见性。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js test\server-routes.test.js test\auto-listing-new-source.test.js test\workflow-runs.test.js`
  - `44/44` 通过。
- 全量验证：`npm test`
  - `117/117` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。

### 下一步开发方向

1. 增强 payload 草稿 UI：显示草稿 item 数、父 SKU、类目路径、变体数。
2. 跑一条受控链路：`match_profit -> content_generate -> payloadDraft -> preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-10 Payload 草稿摘要 UI

更新时间：2026-06-10 +08:00

### 已完成：草稿摘要可视化

- `public/app.js`
  - 新增 `workflowPayloadDraftItems()` 和 `workflowPayloadDraftSummary()`。
  - 在工作流节点详情的 `Payload 草稿` 编辑框上方显示摘要：
    - 商品数
    - 父 SKU
    - 类目
    - 变体数
    - 图片数
  - 摘要优先读取 `payloadDraft.summary`，没有 summary 时从 `items` / 单 item 草稿中兜底推导。

- `public/styles.css`
  - 新增 `.workflow-payload-summary` 样式。
  - 摘要以胶囊指标形式展示，便于人工介入时快速判断草稿结构是否正确。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowPayloadDraftSummary`、`父SKU`、`类目`、`变体数`、`.workflow-payload-summary` 的前端可见性。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `19/19` 通过。
- 全量验证：`npm test`
  - `118/118` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 跑一条受控链路：`match_profit -> content_generate -> payloadDraft -> preflight_check`，继续保持不自动提交 Ozon。
2. 给工作流详情增加“节点输入/输出摘要”，减少人工排查时翻 JSON 的次数。
3. 增加 preflight 问题的“一键定位字段”提示，让必填字段缺失能直接指向 Payload 编辑位置。

## 2026-06-10 受控链路：跑到提交前总闸

更新时间：2026-06-10 +08:00

### 已完成：受控串跑执行器

- `src/workflowNodeExecutor.js`
  - 新增 `runControlledWorkflowChain()`。
  - 固定只串联执行：
    - `match_profit`
    - `content_generate`
    - `preflight_check`
  - 每一步复用既有安全执行器 `continueWorkflowNode()`。
  - 若节点不支持或结果 `ok === false`，链路会停止。
  - 最后追加 `controlled_chain_completed` 事件，明确记录“未触发 Ozon 提交”。

### 已完成：后端入口

- `src/server.js`
  - 新增 `POST /api/workflows/:id/controlled-chain`。
  - 接入依赖：
    - `rerunAutoListingMatch`
    - `rerunAutoListingContent`
    - `validatePayloadDraft`
    - `appendWorkflowEvent`
  - 该入口不调用 Ozon import / submit 类接口。

### 已完成：前端入口

- `public/app.js`
  - 工作流节点详情操作区新增按钮：`受控跑到总闸`。
  - 点击后调用 `/api/workflows/:id/controlled-chain`。
  - Toast 显示：`受控链路已跑 X 步，未触发 Ozon 提交`。
  - 事件时间线新增 `controlled_chain_completed` 标签：`受控链路`。

### 新增测试

- `test/workflow-node-executor.test.js`
  - 覆盖受控链路按 `match_profit -> content_generate -> preflight_check` 顺序执行。
  - 覆盖不调用 submit/import 类动作。
- `test/server-routes.test.js`
  - 覆盖后端受控链路路由。
- `test/frontend-static.test.js`
  - 覆盖前端按钮、文案和安全提示。

### 验证结果

- 局部验证：
  - `node --test test\workflow-node-executor.test.js`
    - `6/6` 通过。
  - `node --test test\server-routes.test.js test\frontend-static.test.js`
    - `23/23` 通过。
- 全量验证：`npm test`
  - `121/121` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 给 `preflight_check` 的 issues 增加“一键定位字段”提示。
2. 给工作流详情增加“节点输入/输出摘要”，减少人工排查时翻 JSON。
3. 增加受控链路结果面板：显示每步动作、是否真实执行、停止原因。

## 2026-06-10 preflight 问题一键定位字段

更新时间：2026-06-10 +08:00

### 已完成：问题定位映射

- `public/app.js`
  - 新增 `workflowPayloadIssueLocator()`。
  - 针对常见校验问题补了字段映射：
    - `EMPTY_PAYLOAD` → `payload.items`
    - `MISSING_OFFER_ID` → `items[0].offer_id`
    - `MISSING_NAME` / `CHINESE_IN_TITLE` → `items[0].name`
    - `MISSING_CATEGORY` → `items[0].description_category_id / type_id`
    - `MISSING_PRICE` → `items[0].price`
    - `IMAGES_TOO_FEW` → `items[0].images`
    - `MISSING_BRAND` → `items[0].attributes[85]`
    - `MISSING_MODEL_NAME` → `items[0].attributes[9048]`
  - 在 `Payload 草稿` 区域内新增校验问题列表。
  - 点击某条问题后，编辑器会聚焦并选中对应字段附近文本，同时提示“已定位字段”。

- `public/styles.css`
  - 新增 `.workflow-payload-issues`、`.workflow-payload-issue-list`、`.workflow-payload-issue` 样式。
  - 让问题列表更像可操作的诊断卡片。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowPayloadIssueLocator`、`data-payload-path`、`定位字段` 文案。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `21/21` 通过。
- 全量验证：`npm test`
  - `122/122` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 增加“定位字段”后的视觉高亮和问题计数汇总。
2. 给 preflight 校验补一个“按错误码分组”的总结面板。
3. 继续完善受控链路结果面板，减少翻 JSON 的成本。

## 2026-06-10 preflight 错误码汇总面板

更新时间：2026-06-10 +08:00

### 已完成：按错误码汇总

- `public/app.js`
  - 新增 `workflowPayloadIssueSummary()`。
  - 在 `Payload 草稿` 的校验问题区域顶部显示“按错误码汇总”。
  - 每个分组以 `规则/错误码：数量` 的胶囊标签展示，方便先看问题类型，再点单条问题定位字段。

- `public/styles.css`
  - 新增 `.workflow-payload-issue-summary` 和 `.workflow-payload-issue-summary-list` 样式。
  - 汇总区与单条问题卡分层展示，阅读顺序更清晰。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowPayloadIssueSummary`、`按错误码汇总`、`规则/` 文案。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `22/22` 通过。
- 全量验证：`npm test`
  - `123/123` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 给问题定位补一个高亮闪烁/滚动到目标字段的视觉反馈。
2. 给 summary 面板增加“最常见 3 类错误”的排序提示。
3. 继续完善受控链路结果面板，减少人工排查步骤。

## 2026-06-10 Payload 字段定位高亮

更新时间：2026-06-10 +08:00

### 已完成：定位后的视觉反馈

- `public/app.js`
  - 新增 `highlightWorkflowPayloadEditor()`。
  - 点击 `Payload` 校验问题后，会：
    - 聚焦 `Payload` 编辑框。
    - 选中目标字段附近文本。
    - 调用 `scrollIntoView()` 自动滚动到编辑器。
    - 给编辑框临时添加 `payload-located` 高亮类。

- `public/styles.css`
  - 新增 `.workflow-payload-editor.payload-located`。
  - 新增 `@keyframes payloadLocatePulse`，让定位动作有短暂高亮反馈。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `highlightWorkflowPayloadEditor`、`scrollIntoView`、`payload-located`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `23/23` 通过。
- 全量验证：`npm test`
  - `124/124` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 继续完善受控链路结果面板：显示每步动作、真实执行/仅记录、停止原因。
2. 给工作流节点输入/输出加摘要卡，减少翻 JSON。
3. 给 preflight 问题补“自动修复建议模板”，例如模型名称 9048 的建议值。

## 2026-06-10 受控链路结果面板

更新时间：2026-06-10 +08:00

### 已完成：链路结果可视化

- `public/app.js`
  - 新增 `workflowControlledChainResultPanel()`。
  - 会从最近的 `controlled_chain_completed` 事件读取：
    - 链路结果
    - 停止原因
    - 每一步是否 `真实执行` / `仅记录`
    - 每步动作列表
  - 面板插入到节点详情中，和事件时间线并列展示。

- `public/styles.css`
  - 新增 `.workflow-chain-result` 和 `.workflow-chain-steps` 样式。
  - 用卡片化结构展示每一步执行状态。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowControlledChainResultPanel`、`链路结果`、`停止原因`、`workflow-chain-result`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `24/24` 通过。
- 全量验证：`npm test`
  - `125/125` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 给工作流节点输入/输出增加摘要卡，减少翻 JSON。
2. 给 preflight 问题补“自动修复建议模板”，例如模型名称 9048 的建议值。
3. 继续收敛链路结果与事件日志的重复信息。

## 2026-06-10 节点输入/输出摘要卡

更新时间：2026-06-10 +08:00

### 已完成：节点 IO 摘要

- `public/app.js`
  - 新增 `workflowNodeIoSummaryValue()`。
  - 新增 `workflowNodeIoSummary()`。
  - 在节点详情的 JSON 展开区上方新增：
    - `输入摘要`
    - `输出摘要`
  - 摘要会优先展示常用关键字段：
    - `candidateCount`
    - `acceptedCount`
    - `rejectedCount`
    - `itemCount`
    - `variantCount`
    - `candidateImageCount`
    - `skuVariantCount`
    - `payloadDraftReady`
    - `listingContentReady`
    - `ok`
  - 若输出里有 `issues` 或 `issueCount`，会显示 `问题数`。
  - 若有 `actions`，会显示 `动作数`。
  - 原始 JSON 仍保留在 `节点输入` / `节点输出` details 中。

- `public/styles.css`
  - 新增 `.workflow-io-summary-grid` 和 `.workflow-io-summary` 样式。
  - 输入/输出摘要以双卡片展示，适合快速扫一眼。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowNodeIoSummary`、`输入摘要`、`输出摘要`、`问题数`、`.workflow-io-summary`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `25/25` 通过。
- 全量验证：`npm test`
  - `126/126` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 给 preflight 问题补“自动修复建议模板”，例如模型名称 9048 的建议值。
2. 继续收敛链路结果与事件日志的重复信息。
3. 增加一键复制节点摘要，方便发给人工/供应商排查。

## 2026-06-11 Payload 自动修复建议模板

更新时间：2026-06-11 +08:00

### 已完成：问题修复建议卡

- `public/app.js`
  - 新增 `workflowPayloadRepairTemplate()`。
  - 在问题卡内直接展示：
    - `自动修复建议`
    - `建议值`
  - 已覆盖常见问题：
    - `MISSING_MODEL_NAME` → `9048 Название модели`
    - `MISSING_BRAND` → 品牌属性 85
    - `MISSING_PRICE` → 价格回填
    - `MISSING_CATEGORY` → 类目 / 类型重新匹配
    - `IMAGES_TOO_FEW` → 补足图片
    - `EMPTY_PAYLOAD` → 恢复 `payload.items`
    - `CHINESE_IN_TITLE` → 改为纯俄文标题

- `public/styles.css`
  - 新增 `.workflow-payload-repair` 样式。
  - 让修复建议块在问题卡内部独立显示。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowPayloadRepairTemplate`、`自动修复建议`、`建议值`、`9048`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `26/26` 通过。
- 全量验证：`npm test`
  - `127/127` 通过。

## 2026-06-12 P0-1：payload-draft-submit 安全提交闸口

更新时间：2026-06-12 +08:00

### 已完成

- 新增设计与实施计划：
  - `docs/superpowers/specs/2026-06-12-payload-draft-submit-design.md`
  - `docs/superpowers/plans/2026-06-12-payload-draft-submit.md`
- `src/workflowRuns.js`
  - 新增 `submitPayloadDraftToOzon(runId, input, deps)`。
  - 每次提交前重新校验 `payloadDraft`，无草稿/校验失败时不调用 Ozon。
  - 必须传入 `confirmSubmit: true`，否则返回 `confirmation_required`。
  - 真实提交只通过注入的 `ozonRequest(store, "/v3/product/import", { items })` 执行，便于测试隔离。
  - 提交成功后写入：
    - `preflight_check` 成功节点。
    - `ozon_submit` 成功节点。
    - `payload_draft_submitted` 工作流事件。
  - 提交成功后保持 `locks.submitLocked=true`，防止重复点击再次提交。
- `src/server.js`
  - 新增 `POST /api/workflows/:id/payload-draft/submit`。
  - 路由显式标准化 `confirmSubmit`，并注入 `getStore` / `ozonRequest`。
- `public/app.js`
  - 工作流 Payload 草稿区新增 `确认提交 Ozon`。
  - 点击后先浏览器二次确认，再保存当前编辑器草稿，最后调用 `/payload-draft/submit`。
  - 后端仍会重新校验，前端按钮不能绕过安全闸口。

### 新增测试

- `test/workflow-runs.test.js`
  - 无效草稿阻断且不调用 Ozon。
  - 有效草稿缺少人工确认时阻断。
  - 人工确认后的有效草稿会提交并记录 workflow 节点/事件。
- `test/server-routes.test.js`
  - 覆盖 `/api/workflows/:id/payload-draft/submit` 路由。
- `test/frontend-static.test.js`
  - 覆盖 `确认提交 Ozon`、`submit-payload-draft`、`confirmSubmit` 和 `/payload-draft/submit`。

### 验证结果

- 局部验证：
  - `node --test test\workflow-runs.test.js`：`26/26` 通过。
  - `node --test test\server-routes.test.js`：`4/4` 通过。
  - `node --test test\frontend-static.test.js`：`29/29` 通过。

### 下一步建议

1. 进入 `P0-2：review_reconcile 回执标准化`，把草稿提交后的 `task_id` 回查、`product_id`、错误/警告和 reasonCode 统一沉淀到 `review_reconcile`。
2. 给 `payload-draft-submit` 增加前端可见的“最近提交 task_id / offer 列表”小摘要，减少提交后翻事件日志。
3. 再做一次人工 UI 冒烟：打开工作流控制台，用测试 workflow 的草稿验证按钮、弹窗和阻断提示。

## 2026-06-12 轻量上架编辑日志与 Ozon Seller 表单监听

更新时间：2026-06-12 +08:00

### 背景

用户确认当前阶段不继续追求“一键全自动上架”，优先做流程化学习层：

`1688 候选 -> ERP 建议 -> 人工填写/修改 -> Ozon Seller 后台二次修改 -> Ozon 回执 -> 规则沉淀`

本轮先做最小可用底座，不重构现有主链。

### 已完成

- 新增 `src/listingEditJournal.js`
  - 数据文件：`data/listing-edit-journal.json`
  - 支持追加结构化编辑事件。
  - 支持按 `candidateId / offerId / productId / workflowRunId / stage / source` 查询。
  - 支持摘要：总数、按来源、按阶段、最常修改字段。
  - 支持 `diffListingFields(before, after)`，用于后续 ERP 作业单建议值/人工值 diff。
- 新增 API：
  - `GET /api/listing-edit-journal/events`
  - `POST /api/listing-edit-journal/events`
  - `GET /api/listing-edit-journal/summary`
- 浏览器统一插件新增 Ozon Seller 后台轻量监听：
  - 生效域名：`https://seller.ozon.ru/*`
  - 内容脚本函数：`mountOzonSellerEditMonitor()`
  - 页面加载后记录初始表单快照。
  - 监听 `input/change`，debounce 后生成字段差异。
  - 回传到 `/api/listing-edit-journal/events`。
  - 事件标记：
    - `stage = ozon_backend_edit`
    - `source = ozon_seller_plugin`
  - 只记录变化，不点击、不保存、不自动操作 Ozon 后台。
- 已同步两个插件目录：
  - `browser-extension/1688-collector`
  - `browser-extension/erp-collector-extension`
- 已重建插件包：
  - `browser-extension/erp-collector-extension.zip`

### 验证与运行状态

- 局部验证：
  - `node --test test\listing-edit-journal.test.js`
  - `node --test test\server-routes.test.js`
  - `node --test test\extension-unified.test.js`
- 本地 API 冒烟：
  - `POST /api/listing-edit-journal/events` 可写入。
  - `GET /api/listing-edit-journal/summary` 可读取摘要。
  - 冒烟测试产生的 `cc_smoke` 临时数据已删除。
- 采集插件状态：
  - 插件在线。
  - 当前 `1688-crawler/extension/status` 显示 `waiting_human`。
  - 原因：浏览器侧人机验证暂停。不能强行继续采集；需人工在浏览器里完成验证后点插件“恢复采集”。

### 下一步建议

1. 增加 ERP 内部“人工上架作业单 diff”：保存系统建议值、人工最终值，并写入 `listingEditJournal`。
2. 把 Ozon API 回执中的错误/警告也写入 `listingEditJournal`，来源标记为 `ozon_api_review`。
3. 等用户手动完成 Ozon/1688 人机验证后，恢复采集插件，跑少量候选采集，不直接触发自动提交。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`waitingHuman = 0`

### 下一步开发方向

1. 增加一键复制节点摘要，方便发给人工/供应商排查。
2. 继续收敛链路结果与事件日志的重复信息。
3. 给自动修复建议增加可复制模板按钮。

## 2026-06-11 ERP 模块归属与 Ozon API 对齐

更新时间：2026-06-11 +08:00

### 已完成：模块地图与接口对照

- `public/index.html`
  - 总览页新增：
    - `ERP 模块归属地图`
    - `Ozon Seller API 对齐概览`

- `public/app.js`
  - 新增 `ERP_MODULE_OWNERSHIP`。
  - 新增 `OZON_SELLER_API_ALIGNMENT`。
  - 新增 `renderErpModuleOwnership()`。
  - 启动时直接渲染模块边界和 API 缺口。

- `public/styles.css`
  - 新增模块地图和 API 覆盖卡片样式。
  - 总览页更像“控制台首页”而不是纯表格堆叠。

- `docs/erp-tab-api-map.zh-CN.md`
  - 单独沉淀 tab 归属、Seller API 对齐现状和后续顺序。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `moduleOwnershipGrid`、`sellerApiCoverageGrid`、`ERP_MODULE_OWNERSHIP`、`OZON_SELLER_API_ALIGNMENT`、`.api-coverage-card`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `27/27` 通过。
- 全量验证：`npm test`
  - `128/128` 通过。

### 当前结论

- `学习与机会 / 1688反向选品 / 上架执行 / 商品状态 / 仓库与库存 / 工作流控制台 / 订单履约 / 营销活动` 的边界已经明确。
- Ozon Seller API 里已对齐的主要是：类目、属性、上架、审核回执、商品、价格、图片、库存、订单、活动。
- 仍明显偏本地逻辑的模块是：1688 采集、Ozon 学习、规则分析、工作流控制、AI 内容与利润判断。

## 2026-06-12 1688 官方 OpenAPI 接入状态

更新时间：2026-06-12 +08:00

### 当前结论

- 已订购 `代发解决方案（分销买家版）`，应用名 `ozonerp-分销`。
- 本机已配置 1688 OpenAPI 凭据，配置文件为 `data/1688-openapi.json`，该文件已加入 `.gitignore`，不得提交。
- 已新增官方 API 配置状态卡，ERP 前端只显示脱敏后的 AppSecret/token 状态。
- 已验证 1688 OpenAPI 网关和签名可用：
  - `system/currentTime` 返回成功。
- 已试探业务接口，但当前应用仍被 ACL 拒绝：
  - `alibaba.product.get`
  - `alibaba.agent.product.get`
  - `alibaba.trade.fastCreateOrder`
  - `alibaba.fenxiao.productInfo.get`
- 返回核心错误：`gw.APIACLDecline / AppKey is not allowed(acl)`。

### 暂缓原因

- 用户确认应用仍在审核中。
- 在审核通过或接口权限正式放行前，不继续投入业务接口适配，避免反复猜接口名浪费时间。

### 已落地文件

- `src/open1688Config.js`
  - 读取本机 1688 OpenAPI 配置。
  - 支持 Windows UTF-8 BOM JSON。
  - 只对外返回脱敏状态。
- `src/open1688Client.js`
  - 封装 `param2` 网关路径、HMAC-SHA1 签名和 HTTP 调用。
- `scripts/probe-1688-openapi.mjs`
  - 可重复运行官方 API 探针。
- `public/index.html`
  - `1688 官方接口` 状态面板。
- `public/app.js`
  - `loadOpen1688Status()` / `renderOpen1688Status()`。
- `public/styles.css`
  - `.open1688-status-*` 样式。
- `test/open1688-config.test.js`
  - 覆盖配置缺项、脱敏、BOM、签名稳定性。

### 后续恢复条件

1. 应用审核通过。
2. 用户提供开放平台“已授权 API / 接口权限列表”的截图或接口名。
3. 运行 `node scripts\probe-1688-openapi.mjs` 复测 ACL。
4. 若业务接口返回参数错误而非 ACL，则开始接入真实商品/分销接口。

### 2026-06-13 更新

- 用户提供新的生产 AppKey / AppSecret / accessToken，已更新到本机 `data/1688-openapi.json`。
- 已用真实 API 复测：
  - namespace：`com.alibaba.search`
  - apiName：`alibaba.search.relation.supply`
  - 返回：HTTP `200`
  - 结果：`{ pageNum: 1, pageSize: 20, result: [], totalRecords: 0 }`
- 结论：OpenAPI 网关、签名、授权 token 均已打通；当前接口返回空结果是业务数据为空，不是 ACL/授权失败。
- 下一步：把 `alibaba.search.relation.supply` 接入 ERP，作为官方 API 搜索/供应商推荐的第一条可用通道。

## 2026-06-12 1688 插件恢复采集修复

更新时间：2026-06-12 +08:00

### 问题

- 插件遇到 1688 人机验证后会暂停，并在浏览器扩展里显示“恢复采集”。
- 旧逻辑只清理浏览器扩展本地暂停状态，没有同步恢复 ERP 服务端 task。
- 服务端 `/api/1688-crawler/extension/next` 会跳过 `waiting_human` task，导致点击“恢复采集”后不一定继续领取原任务。
- 另外，服务端 resume 旧逻辑会触发后端直连 1688 的 `runTask()`，在插件队列模式下反而可能再次把任务打回 `waiting_human`。

### 修复

- `src/crawler1688.js`
  - 新增可恢复 job 判断。
  - task resume 时把人机/登录/验证类 failed job 重新置为 `queued`。
  - 若 task 已有插件队列 job，则不再启动服务端直连 1688 的 `runTask()`。
- `browser-extension/1688-collector/background.js`
  - 插件点击“恢复采集”时调用 `/api/1688-crawler/tasks/:id/resume`。
- `browser-extension/erp-collector-extension/background.js`
  - 同步上述恢复逻辑。
- `browser-extension/erp-collector-extension.zip`
  - 已重新打包。

### 当前现场

- 服务端已重启。
- 3 条 `waiting_human` task 已恢复为 `running`。
- 队列中有 `32` 个 `queued` job 等待插件领取。
- 插件 worker 仍离线，最后心跳停在 `2026-06-12T12:42:08Z`。
- 用户需要重新加载/更新浏览器扩展，并点击插件里的“恢复采集”。

### 验证

- `node --test test\crawler-workflow.test.js test\extension-unified.test.js`
  - `10/10` 通过。
- `node --test test\*.test.js`
  - `148/148` 通过。

## 2026-06-12 1688 海选队列提速

更新时间：2026-06-12 +08:00

### 问题

- 用户反馈插件和后台仍在少数几个品类/关键词上反复采集。
- 排查发现 queued job 里残留了大量旧详情页：
  - `自动喂食器` 12 个 queued job。
  - 多个旧关键词各 6 个详情页。
- 插件按队列顺序领取，导致看起来一直围着几个品深挖，不符合“一个关键词只找一两个合格链接，然后切下一个分类”的海选目标。

### 修复

- `src/crawler1688.js`
  - 默认 `CRAWLER1688_MAX_DETAIL_JOBS` 从 `6` 改为 `2`。
  - `claimCrawlerExtensionJob()` 认领时优先处理 `discover` 搜索页，再处理详情页，避免旧详情页阻塞新关键词搜索。
- `test/crawler-workflow.test.js`
  - 新增默认海选只打开 2 个详情页的测试。

### 一次性队列整理

- 已暂停旧队列中每个关键词超过 2 个的 queued 详情页。
- 结果：
  - queued job 从 `46` 降到 `18`。
  - 暂停多余详情页 `28` 个。
  - discover 搜索页保留，不影响新关键词展开。

### 验证

- `node --test test\crawler-workflow.test.js test\extension-unified.test.js`
  - `11/11` 通过。
- `node --test test\*.test.js`
  - `149/149` 通过。

## 2026-06-11 Ozon Seller API 缺口开发清单

更新时间：2026-06-11 +08:00

### 已完成：缺口优先级拆分

- `public/index.html`
  - 总览页新增 `Seller API 缺口开发清单`。

- `public/app.js`
  - 新增 `OZON_SELLER_API_GAP_BACKLOG`。
  - 把缺口按 `P0 / P1 / P2` 显示：
    - `P0`：上架安全闸口、审核回执闭环、库存安全回查。
    - `P1`：订单履约动作、商品资料维护、营销活动闭环。
    - `P2`：仓库分页与详情、报表与财务。
  - `renderErpModuleOwnership()` 同时渲染模块归属、API 对齐、API 缺口。

- `public/styles.css`
  - 新增 `.seller-api-gap-grid`、`.api-gap-card`、`.api-gap-p0/.api-gap-p1/.api-gap-p2`。
  - 用颜色区分开发优先级。

- `docs/ozon-seller-api-gap-backlog.zh-CN.md`
  - 新增完整 Seller API 缺口开发路线图。
  - 明确本地能力和 Seller API 能力边界。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `sellerApiGapGrid`、`OZON_SELLER_API_GAP_BACKLOG`、`payload-draft-submit`、`P0/P1/P2`。
  - 覆盖新文档 `docs/ozon-seller-api-gap-backlog.zh-CN.md`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `28/28` 通过。
- 全量验证：`npm test`
  - `129/129` 通过。

### 下一步建议

1. 进入 `P0-1：payload-draft-submit 安全提交闸口`。
2. 或继续做 `C：UI 前端展示修正`，把总览和工作流控制台整体视觉再收敛。

## 2026-06-11 工作流摘要一键复制

更新时间：2026-06-11 +08:00

### 已完成：工作流摘要复制

- `public/app.js`
  - 新增 `workflowRunCopySummaryText()`，可把当前工作流的：
    - 运行 ID
    - 状态和锁
    - 当前节点
    - 风险与下一步
    - Payload 问题
    - 节点进度
    - 最近事件
    汇总成可直接发送的纯文本。
  - 在详情页头部新增 `复制工作流摘要`。
  - 复用现有 `copyWorkflowText()`。

- `public/styles.css`
  - 新增 `.workflow-detail-head-actions`，让头部按钮与状态标签对齐。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowRunCopySummaryText`、`复制工作流摘要`、`工作流摘要已复制`、`.workflow-detail-head-actions`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `26/26` 通过。
- 全量验证：`npm test`
  - `127/127` 通过。

## 2026-06-11 修复建议一键复制 + 链路结果收口

更新时间：2026-06-11 +08:00

### 已完成：修复建议复制按钮

- `public/app.js`
  - 新增 `copyWorkflowText()`，兼容 `navigator.clipboard` 与回退复制。
  - `workflowPayloadRepairTemplate()` 现在在建议卡内显示 `复制建议`。
  - `workflowPayloadIssueLocator()` 改成独立问题卡，支持：
    - `定位字段`
    - `复制建议`
  - `handleWorkflowAction()` 新增 `copy-repair-template` 分支。

- `public/styles.css`
  - 新增 `.workflow-payload-copy`、`.workflow-payload-issue-actions`、`.workflow-payload-repair-head`。
  - 问题卡改为分区布局，按钮更适合人工排查。

### 已完成：链路结果面板收口

- `public/app.js`
  - `workflowControlledChainResultPanel()` 现在优先展示摘要：
    - 步骤数
    - 真实执行数
    - 仅记录数
    - 末节点 / 末动作
  - 详细步骤收纳到 `查看步骤明细` 内，减少与事件日志重复。

- `public/styles.css`
  - 新增 `.workflow-chain-result-summary`。
  - 将步骤明细折叠成更轻量的详情区。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `复制建议`、`.workflow-payload-copy`、`查看步骤明细`、`.workflow-chain-result-summary`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `26/26` 通过。
- 全量验证：`npm test`
  - `127/127` 通过。

## 2026-06-16 C：ERP 前端展示修正（工作流设计导航）

更新时间：2026-06-16 22:19:02 +08:00

### 已完成：总览主链导航

- public/index.html
  - 总览页新增 ERP 主链导航 面板。
  - 新增 erpWorkflowNavigator 容器，用于把采集、分析、上架、审核回馈、库存闭环串成一条可点击路径。

- public/app.js
  - 新增 ERP_WORKFLOW_NAVIGATION。
  - 新增 enderErpWorkflowNavigator()，复用模块/API 对齐渲染，同时渲染主链导航。
  - 主链步骤点击后跳转到对应业务 tab：
    - 采集 → 1688反向选品
    - 分析 → 学习与机会
    - 上架 → 上架执行
    - 审核回馈 → 工作流控制台
    - 库存闭环 → 仓库与库存

### 已完成：工作流焦点条

- public/index.html
  - 工作流控制台新增 workflowFocusBar。

- public/app.js
  - 新增 enderWorkflowFocusBar()。
  - 工作流列表渲染时同步显示当前节点、运行状态、风险分和下一步建议。
  - 无运行记录时显示空状态说明，避免用户不知道页面是否加载失败。

- public/styles.css
  - 新增 .erp-workflow-navigator、.erp-workflow-step。
  - 新增 .workflow-focus-bar、.workflow-focus-step 和不同风险层级样式。
  - 总览和工作流控制台的信息层级更清晰，减少“功能散在不同 tab 不知道去哪处理”的问题。

### 新增测试

- 	est/frontend-static.test.js
  - 新增 rontend exposes ERP workflow design navigation。
  - 覆盖 erpWorkflowNavigator、workflowFocusBar、ERP_WORKFLOW_NAVIGATION、enderErpWorkflowNavigator()、enderWorkflowFocusBar() 和相关 CSS 类。

### 验证结果

- TDD 红灯：
ode --test test\frontend-static.test.js
  - 新测试按预期失败，缺少 erpWorkflowNavigator。
- 局部验证：
ode --test test\frontend-static.test.js
  - 32/32 通过。
- 全量验证：
pm test
  - 150/150 通过。
- 浏览器冒烟：http://127.0.0.1:5178/
  - erpWorkflowNavigator 存在。
  - workflowFocusBar 存在。
  - 主链步骤数量：5。
  - 阶段：采集、分析、上架、审核回馈、库存闭环。

### 下一步建议

1. 继续做 P0-2：review_reconcile 审核回执闭环增强，把 task_id 回查、错误字段、SKU 和下一步修复动作进一步汇总到工作流焦点条/详情页。
2. 或做 商品状态页维护面板，把改价、换图、资料修复入口统一收口，减少散落操作。
## 2026-06-18 外部 DataHunter 插件对比评估

评估目录：`C:\Users\Administrator\WorkBuddy\20260401160514\ozon-browser-plugin`

### DataHunter 相对现有 ERP 插件的优势

- 支持平台更广：除 Ozon、1688 外，还内置 Amazon、MercadoLibre 详情采集。
- 页面解析更重：1688 详情解析器、Ozon 增强解析器和网络请求拦截器覆盖字段更多。
- 支持 1688 列表页批量采集，并能后台打开多个详情页抓取。
- 内置自动发送/手动发送、采集历史和较完整的 popup 操作界面。

### 不能直接替换现有插件的原因

- DataHunter 固定连接 `localhost:8891`，当前 ERP 使用 `localhost:5178`，接口协议也不同。
- DataHunter 没有接入 ERP 的 crawler/learning 任务领取、节点回传、heartbeat 和 workflow_runs 状态。
- 自动发送默认开启，且网络拦截器自动启动，不符合当前项目“人机立即暂停、人工确认、禁止连续刷页”的安全要求。
- 权限包含 `<all_urls>`，权限面明显大于现有 ERP 插件。
- 页面解析逻辑大量堆在插件端，维护和测试成本高；当前插件把主要解析放在 ERP 后端，便于统一修复。

### 结论

- 不建议直接替换现有 `erp-collector-extension`。
- 建议把 DataHunter 当作“采集能力仓库”，优先移植：
  1. 1688 详情字段/颜色 SKU 解析规则。
  2. Ozon API 网络数据拦截解析。
  3. Amazon、MercadoLibre 采集适配器。
  4. 1688 列表批量候选提取，但必须接入现有任务队列、限速和人机暂停。
- 保留现有插件的工作流协议、人机暂停、heartbeat、Seller 编辑日志和安全控制。

## 2026-06-18 DataHunter 1688 详情解析能力第一批迁移

更新时间：2026-06-18 15:04:29 +08:00

### 本次迁移范围

- src/collector1688.js
  - 支持 DataHunter 常见的 specList/specItems 结构。
  - 支持对象型 skuMap，保留 map key 中的组合规格，如 颜色: 白色; 尺寸: S。
  - SKU map 同步读取价格、库存、SKU ID 和 SKU 图片。
  - 颜色/款式属性兜底支持逗号、中文逗号、分号、中文分号、斜杠、竖线和顿号。
  - 没有复制 DataHunter 的整套重型脚本，解析仍集中在 ERP 后端，保持可测试和可维护。

### 安全边界

- 未修改浏览器插件的自动开页逻辑。
- 未提高并发数或采集频率。
- 未修改人机验证暂停与恢复机制。
- 未修改 Ozon 提交和人工确认闸口。

### 新增测试

- 	est/collector1688-parser.test.js
  - 对象型 skuMap 组合规格。
  - specList/specItems 颜色规格。
  - 中文多分隔符颜色属性兜底。

### 验证结果

- 解析回归：3/3 通过。
- 扩展/采集局部测试：14/14 通过。
- Lint：33 files 通过。
- 全量测试：153/153 通过。

### 下一批可迁移能力

1. 1688 详情参数表的更多 DOM 结构兼容。
2. Ozon 前台网络接口数据拦截，但只做只读采集并接入现有任务队列。
3. 1688 SKU 图片与规格组合映射的更多异常结构。

## 2026-06-18 ERP 综合开发状态评估

更新时间：2026-06-18 20:25:19 +08:00

### 综合完成度

- 功能与架构完成度：约 82%。
- 采集 → 分析 → 上架主链：约 75%。
- 工作流控制台与人工干预：约 80%。
- Ozon Seller API 运营闭环：约 60%。
- 可长期无人值守的生产成熟度：约 55%。

### 已形成的能力

- 119 条本地 API 路由。
- 1688 插件采集、候选解析、SKU/颜色/参数解析、人机暂停与恢复。
- Ozon 竞品学习、机会分析、货源匹配、内容生成、类目属性、图片处理。
- Payload 草稿、preflight 校验、人工确认提交 Ozon。
- workflow_runs 节点、输入输出、诊断、重试、继续、受控链路、事件审计。
- Ozon 商品、价格、图片、仓库、库存、订单、促销基础接口。
- 总览主链导航、模块归属地图、API 对齐与缺口面板。

### 当前实时状态

- 服务端口 5178 在线。
- 自动化模式：observe_only；没有正在执行的自动上架 job。
- 工作流：190 条，其中 running 173、waiting_human 16、paused 1。
- 173 条 running 全部超过 3 天，属于陈旧状态而非真实运行。
- 工作流主要卡在：candidate_parse 125、ozon_learning 42、crawler_1688 22。
- 自动上架：needs_review 48。
- 库存队列：成功 10、失败 47；主要原因是标题和必填属性问题。
- 1688 插件 worker 离线，最后状态为 waiting_human。
- 1688 Open API 凭据已配置，但具体搜索/详情接口尚未真正接入。

### 关键未完成项

1. 工作流生命周期收口：识别陈旧 running，自动转为 waiting_human、failed、paused 或 archived。
2. review_reconcile 审核回执闭环：把 task_id、SKU、字段错误、警告和修复动作统一展示。
3. stock_sync 库存安全闭环：商品未就绪时避免重复写入，修正 47 条失败队列。
4. 商品状态页受控维护：把改价、换图、资料修复统一到商品页。
5. 订单履约动作：目前以读取为主，尚未补打包、发运、取消和标签。
6. 营销活动闭环：目前可读取和移除，加入活动和活动价策略未完成。
7. 1688 Open API 真实接口接入。

### 验证

- 
pm test：153/153 通过。
- 
pm run lint：33 files 通过。

### 推荐下一阶段

优先做“工作流状态治理 + review_reconcile”，先让控制台显示真实进程，再继续扩大自动化范围。

## 2026-06-18 工作流陈旧状态治理

更新时间：2026-06-18 20:32:35 +08:00

### 已完成

- src/workflowRuns.js
  - 新增 econcileStaleWorkflowRuns()。
  - 仅处理超过阈值仍为 unning 的工作流。
  - 转为 waiting_human，保留当前节点、输入、输出和历史事件。
  - 当前运行节点同步转为 waiting_human，增加风险说明和人工处理动作。
  - 追加 workflow_stale_reconciled 审计事件。

- src/server.js
  - 新增 POST /api/workflows/reconcile-stale。
  - 默认阈值 2 小时，允许传 	hresholdHours，限制在 1 至 720 小时。

- public/index.html、public/app.js
  - 工作流控制台新增“清理陈旧状态”按钮。
  - 点击前浏览器二次确认。
  - 只修改陈旧状态，不删除工作流，不自动重试，不提交 Ozon。

### 测试

- 新增陈旧运行、近期运行、暂停流程三类治理测试。
- 新增路由和前端按钮静态测试。
- 局部测试：66/66 通过。
- 全量测试：156/156 通过。
- Lint：33 files 通过。

### 运行验证

- ERP 服务已重启并监听 5178。
- 以 720 小时阈值调用接口，扫描 190 条、治理 0 条，确认接口可用且没有修改现有数据。
- 页面已确认包含 workflowReconcileStale 按钮。

### 使用方式

进入“工作流控制台”，点击“清理陈旧状态”。确认后，超过 2 小时未更新的 unning 流程会转入“等待人工”，之后可逐条重试、换货源或暂停。

### 下一步

增强 eview_reconcile：把 task_id、SKU、错误字段、警告和修复动作汇总到工作流详情和焦点条。

## 2026-06-18 陈旧工作流数据清理执行

更新时间：2026-06-18 20:34:34 +08:00

### 执行结果

- 清理前：190 条 workflow。
- 删除超过 2 小时仍为 unning 的陈旧记录：173 条。
- 清理后：17 条。
- 当前状态：
  - unning：0。
  - waiting_human：16。
  - paused：1。

### 删除记录原节点分布

- candidate_parse：110 条。
- ozon_learning：42 条。
- crawler_1688：21 条。

### 备份

- 已在删除前保存完整备份：
  - data/workflow-runs.json.bak_stale_purge_20260618_203402

### 验证

- workflow-runs.json 可正常解析，剩余 17 条。
- /api/workflows 返回 total=17、running=0、waitingHuman=16、paused=1。
- ERP 服务已重启，端口 5178 正常在线。

## 2026-06-18 外部 Ozon 竞品学习监控接入

更新时间：2026-06-18 20:50 +08:00

### 目标

- 只读监控另一个插件维护的 `E:\ozonerp\ozon_competitors.json`。
- 将可靠的 Ozon 商品详情增量合并到 ERP 学习库，用于标题、属性、类目和价格规则学习。
- 不触发 Ozon 上架，不控制外部插件，也不导入促销卡片和页面导航噪声。

### 已完成

- 新增 `src/externalOzonLearning.js`：
  - 默认每 60 秒检查一次源文件的修改时间和大小签名。
  - 文件未变化时不重复解析；文件正在写入或 JSON 不完整时仅记录运行错误，下轮自动重试，不影响 ERP 服务。
  - 只接受包含 `detail`、有效 Ozon 商品 URL、有效标题，且至少具有价格、图片、类目或属性之一的记录。
  - 从 URL 提取真实 Ozon 商品 ID，不信任外部记录中可能错误的短 SKU。
  - 清理促销标题、伪图片、导航/支付属性和采集器说明文字。
- `src/ozonLearning.js` 新增 `importExternalOzonLearningItems()`：
  - 按规范化 URL 去重。
  - 写入统一 `ozon-learning-items.json`，来源标记为 `external_ozonerp`，状态为 `detailed`。
  - 不覆盖其他来源中已经完整的详情记录。
- `src/listingRules.js`：
  - 规则分析器现同时支持历史数组属性和外部对象属性。
- `src/server.js`：
  - `GET /api/ozon-learning/external-source/status` 查看源文件、签名、同步和运行状态。
  - `POST /api/ozon-learning/external-source/sync` 手动同步；传 `{ "force": true }` 可强制重扫。
  - ERP 启动时自动开启只读增量监控。

### 真实数据结果

- 源文件：`E:\ozonerp\ozon_competitors.json`，7,874,864 字节。
- 扫描：11,875 条。
- 通过质量门槛：316 条。
- 拒绝噪声或不完整记录：11,559 条。
- 本轮更新：315 条；跳过：1 条；统一学习库总量：767 条。
- 同步后已自动重建 listing rules。
- 同步前已备份 `ozon-learning-items.json` 和 `listing-rules.json`，备份文件名包含 `bak_external_` 时间戳。

### 验证

- 新增外部数据清洗、增量签名、统一学习库去重、属性结构兼容和服务路由测试。
- 全量测试：162/162 通过。
- Lint：34 files 通过。
- ERP 服务已重启并监听 5178。
- 状态接口确认源文件存在，监控已启用，当前签名未变化。

### 后续建议

- 在 ERP 的 Ozon 学习页增加“外部学习源”可视化卡片，显示接受率、拒绝原因分布、最近同步时间和手动强制同步按钮。
- 将高频拒绝原因和规则样本暴露到工作流控制台，便于人工审阅哪些竞品信息真正影响了上架内容。

## 2026-06-19 Ozon 变体合并假成功修复

更新时间：2026-06-19

### 根因

- Ozon 对 `double_without_merger_offer` 返回 `level=warning`，但其业务含义是同一型号下的 SKU 没有成功合并。
- 旧代码把所有 warning 都当成非阻塞信息；只要回执存在 `product_id`，异步对账就把任务标记为 `live`。
- 旧自动重试还可能在多变体批次失败后只保留第一条 SKU 重试，破坏整组变体结构。

### 已完成

- `src/autoListing.js`
  - `splitImportWarningsAndErrors()` 新增 `listingDefects` 分类，将变体未合并警告从普通 warning 中分离。
  - 新增 `importFeedbackState()`，明确“已导入但分组失败”必须进入 `needs_review / listing_defect`。
  - 新增 `shouldAutoRetryImport()`，仅允许单 SKU 自动修复；多 SKU 批次不得降级为单品重试。
  - 提交阶段遇到分组缺陷时不生成条码、不排库存、不记录为成功提交。
  - 异步审核对账遇到分组缺陷时不再标记 `live`，统一原因码为 `VARIANT_GROUPING_FAILED`。
- `src/workflowRuns.js`
  - `review_reconcile` 节点支持 `listingDefects`。
  - 变体合并失败进入 `waiting_human` 和 `variant_grouping_fix` 分支，提示修正可变特征后整组重提。
- 新增规范文档 `docs/OZON_LISTING_VARIANTS.zh-CN.md`，固化 API 顺序、字段边界、变体不变量、审核判定和研究资料。

### 回归测试

- 普通 warning 仍保持非阻塞。
- `double_without_merger_offer` 被识别为上架业务缺陷。
- 已生成 `product_id` 的变体分组失败不会进入 `live`。
- 多变体批次不会自动折叠为单 SKU 重试。
- 工作流审核节点会阻断库存并要求整组修复。

### 下一步

- 在工作流控制台增加 `listing_defect` 专用卡片，逐 SKU 对比型号、颜色、尺寸和字典值。
- 增加“整组修复草稿”操作：仅生成可编辑 Payload，不自动提交，人工确认后整组重提。

## 2026-06-19 变体合并缺陷修复台

更新时间：2026-06-19

### 已完成

- `src/workflowRuns.js`
  - 新增 `buildVariantGroupingDiagnosis()`：按 Ozon 实时类目元数据提取型号属性和 `is_aspect` 属性，逐 SKU 生成可读值与组合签名，并标记重复组。
  - 新增 `buildVariantGroupingRepairDraft()`：只允许包含原批次全部 `offer_id` 的整组草稿；缺少任一 SKU 时返回 `INCOMPLETE_VARIANT_GROUP`。
  - `review_reconcile` 输出新增 `variantGroupingDiagnosis` 和 `variantGroupingRepairDraft`。
- `src/autoListing.js`
  - 首次提交回执将完整提交 Payload 和实时属性元数据传入审核节点。
  - `listingResult` 持久化 `attrsMeta`，供后续异步回查诊断使用。
  - 如果分组缺陷在异步审核回查时才出现，会同步更新对应工作流的 `review_reconcile` 节点。
- `public/app.js`、`public/styles.css`
  - 新增变体合并失败专用卡片，逐 SKU 展示型号、可变特征、重复组和唯一状态。
  - 新增“生成整组修复草稿”按钮。
  - 按钮只把完整批次写入 Payload 编辑器并保存草稿，不调用 Ozon 提交接口。
  - 后续仍必须执行 Payload 校验，并通过现有人工二次确认才能提交。

### 安全边界

- 不允许单 SKU 修复或降级重试多变体批次。
- 不完整的 SKU 集合不能生成修复草稿。
- 生成草稿不会自动提交 Ozon、不会生成条码、不会排库存。
- 草稿仍存在重复变体组合时，提交前总闸继续以 `DUPLICATE_VARIANT_ASPECTS` 阻断。

### 验证

- 后端诊断、完整批次草稿、缺失 SKU 阻断和审核节点输出测试通过。
- 前端专用卡、逐 SKU 表格和仅生成草稿动作测试通过。
- 全量测试：173/173 通过。
- Lint：34 files 通过。

### 操作方式

1. 打开“工作流控制台”。
2. 选择原因码为 `VARIANT_GROUPING_FAILED` 的 `review_reconcile` 节点。
3. 在红色“变体合并失败”卡片中检查重复 SKU 的型号、颜色、尺寸等特征。
4. 点击“生成整组修复草稿”。
5. 在 Payload 编辑器修正重复的可变特征，点击“校验 Payload”。
6. 只有校验通过后，人工二次确认才可整组提交 Ozon。

### 下一步

- 使用历史失败任务 `al_mq3g1i6scat2 / SKUlq00131` 重建工作流诊断卡，确认 5 个 SKU 的颜色文本与字典值显示正确。
- 在不自动提交的前提下生成整组修复草稿，人工检查后再决定是否进行真实 Ozon 回放。

## 2026-06-19 SKUlq00131 历史失败回放

更新时间：2026-06-19

### 回放范围

- 自动上架任务：`al_mq3g1i6scat2`。
- 父 SKU：`SKUlq00131`。
- Ozon 历史任务 ID：`4719643287`。
- 工作流：`wr_mql3mi8kvb6we`。
- 本次只读取本地历史数据、重建诊断和保存草稿，没有调用 Ozon Seller API，没有提交商品，没有写库存。

### 确认的历史根因

- 历史提交包含 5 个 SKU。
- 5 个 SKU 的型号字段 `9048` 都为 `Брелок`，符合合并要求。
- 5 个 SKU 的可变特征 `10097 Название цвета` 全部错误地写为 `белый`。
- Ozon 因此返回 `double_without_merger_offer`，但旧系统错误地将任务标记为 `live`。

### 生成的修复草稿

- 保留原有 5 个 `offer_id`，不创建新 SKU：
  - `SKUlq00131-variant-1`
  - `SKUlq00131-chernyy`
  - `SKUlq00131-belyy`
  - `SKUlq00131-zheltyy`
  - `SKUlq00131-siniy`
- 变体颜色已改为唯一组合：
  - 米色：`10097=бежевый`，`10096.dictionary_value_id=61573`。
  - 黑色：`10097=черный`，`10096.dictionary_value_id=61574`。
  - 白色：`10097=белый`，`10096.dictionary_value_id=61571`。
  - 黄色：`10097=желтый`，`10096.dictionary_value_id=61578`。
  - 蓝色：`10097=синий`，`10096.dictionary_value_id=61581`。
- 修复草稿包含 5 个 SKU，动态变体预检通过，问题数为 0。

### 工作流状态

- 历史任务已从错误的 `live` 修正为 `needs_review / listing_defect`。
- 原因码：`VARIANT_GROUPING_FAILED`。
- 工作流处于 `waiting_human`。
- 页面已实测显示红色“变体合并失败”卡片、5 行重复诊断和可用的“生成整组修复草稿”按钮。
- 页面 Payload 编辑器已显示修复后的五 SKU 颜色文本和字典值。

### 同步修复的安全缺口

- `savePayloadDraft()` 现在会持久化 `payloadDraftAttrsMeta`。
- 草稿再次保存后不会丢失 Ozon `is_aspect` 元数据。
- `validatePayloadDraft()` 和最终人工确认提交前总闸统一使用保存的类目元数据，可持续阻断重复变体组合。
- `workflowReviewReconcileNode()` 支持分别传入失败 Payload 与修复 Payload：诊断展示旧错误，草稿保存新值。

### 备份

- `data/auto-listing-jobs.json.bak_variant_replay_20260619154349`
- `data/workflow-runs.json.bak_variant_replay_20260619154349`
- `data/auto-listing-jobs.json.bak_variant_offer_fix_20260619154530`
- `data/workflow-runs.json.bak_variant_offer_fix_20260619154530`

### 验证

- 页面实测：诊断卡 5 行，5 行均显示历史重复组；修复按钮可用。
- 修复草稿：5 个原始 `offer_id`，5 组唯一颜色与字典值。
- 工作流提交事件 `payload_draft_submitted` 数量：0。
- 全量测试：175/175 通过。
- Lint：34 files 通过。

### 下一步

- 当前已经具备真实回放条件，但仍停在人工闸口。
- 下一步应由人工检查标题、图片、价格、尺重和五个变体映射；确认无误后再决定是否点击“确认提交 Ozon”。

## 2026-06-21 ERP 流程驾驶舱前端重构

更新时间：2026-06-21

### 已完成

- 将九个平级功能页重组为两级导航：
  - 驾驶舱：运营总览、工作流中心。
  - 商品全链路：Ozon 学习、1688 选品、上架执行。
  - 运营管理：商品状态、仓库与库存、订单履约、营销活动。
  - 系统状态：店铺与 Seller API 入口。
- 运营总览改为流程驾驶舱，统一显示风险横幅、四项关键指标、采集/分析/上架/审核回馈/库存闭环五阶段、当前工作流焦点和系统脉冲。
- 建立深色组件视觉系统，统一面板、指标卡、状态胶囊、按钮、输入框、表格、空状态和代码块，并保留危险提交操作的红色语义。
- 完成三档响应式布局：
  - `>=1440px`：72px 一级栏 + 220px 二级栏。
  - `1024px–1439px`：64px 一级栏 + 72px 紧凑二级栏。
  - `<1024px`：移动抽屉；支持按钮打开、选中页面后关闭、遮罩关闭和 Escape 关闭。

### 兼容与安全边界

- 未改动后端 API 合约、业务请求路径和 Ozon Seller API 调用逻辑。
- 保留原有页面 ID、业务控件 ID、`.tab[data-view]` 选择器和惰性加载逻辑。
- 未绕过 Payload 预检、工作流锁、人工二次确认或 Ozon 提交安全闸。
- 自动化仍遵守人机验证暂停规则；本轮没有执行真实 Ozon 提交、库存写入或外部副作用。

### 浏览器验收

- `1600×900`：完整一级栏、二级栏、风险横幅、四项 KPI、五阶段流程、工作流焦点和系统脉冲均可见，无页面横向溢出。
- `1366×768`：紧凑二级导航生效，主内容保持可读，无页面横向溢出。
- `1024×768`：临界紧凑布局正常，流程卡允许自然换行，无页面横向溢出。
- `900×768`：移动顶部栏和抽屉生效；抽屉可打开、切组、切页并自动关闭。
- 已逐页实测：运营总览、工作流中心、Ozon 学习、1688 选品、上架执行、商品状态、仓库与库存、订单履约、营销活动。
- 浏览器控制台错误：0。

### 自动验证

- `node --test test/frontend-static.test.js`：38/38 通过。
- `npm test`：179/179 通过。
- `npm run lint`：通过，34 files。

### 相关文件

- 设计规格：`docs/superpowers/specs/2026-06-21-erp-flow-cockpit-ui-design.md`。
- 实施计划：`docs/superpowers/plans/2026-06-21-erp-flow-cockpit-ui.md`。
- 前端实现：`public/index.html`、`public/app.js`、`public/styles.css`。
- 静态契约测试：`test/frontend-static.test.js`。

## 2026-06-26 定价/运费/原价/最低价逻辑沉淀

更新时间：2026-06-26

### 已完成

- 新增项目文档 `docs/pricing-logic.zh-CN.md`，用中文文字化说明当前 ERP 的定价口径。
- 新增 Codex skill `ozon-erp-pricing-logic`，用于后续解释、审查或修改 Ozon ERP 售价、运费、原价、最低价逻辑。
- 明确自动上架当前核心规则：
  - 采购成本：匹配货源价或 1688 SKU 价 + `5 RMB` 采购缓冲。
  - 售价：通过采购成本、运费等级、佣金、杂费、利润率迭代计算，币种 `CNY`。
  - 运费：按 Extra Small / Budget / Small / Big 四个人民币物流等级匹配。
  - 原价/划线价：`old_price = price * 2`。
  - 最低价：小数向下取整，整数减一，最低不低于 `1`，避免最低价等于售价。

### 当前实现锚点

- 物流等级与售价公式：`src/pricing.js`。
- 自动上架 payload 价格字段：`src/autoListing.js`。
- 前端价格计算器入口：`public/index.html`、`public/app.js`。
- 最低价测试保护：`test/listing-content-quality.test.js`。

### 验证

- Skill 结构校验：`quick_validate.py C:\Users\Administrator\.codex\skills\ozon-erp-pricing-logic`，结果 `Skill is valid!`。

### 后续建议

- 将 Ozon 类目真实佣金率接入定价计算，替代固定 `15%` 默认值。
- 将物流等级后台配置化，支持维护历史版本。
- 在工作流节点中输出完整价格诊断：采购价、缓冲、等级、运费、佣金、杂费、利润、原价、最低价。
- 对无尺重、无法匹配运费等级、价格不收敛、售价超等级范围的商品进入人工阻塞。

## 2026-06-27 工作流定价诊断接入

更新时间：2026-06-27

### 已完成

- 将自动上架定价结果结构化为 `pricingDiagnosis`，接入 `match_profit` 工作流节点。
- Payload 草稿刷新路径和真实自动上架流程都会写入定价诊断。
- 工作流节点输出现在包含：
  - 原始货源价、`5 RMB` 采购缓冲、计价采购成本。
  - 售价、原价/划线价、最低价、币种。
  - 运费等级、运费、佣金、杂费、成本基数、利润、利润率。
  - 计价尺重、价格迭代步骤。
  - 多变体 SKU 的独立售价、最低价、运费等级和尺重。
- 前端“工作流控制台”节点详情新增“定价诊断”卡片，直接展示成本拆解和变体价格明细。

### 安全边界

- 定价诊断只解释价格来源，不自动调用 Ozon 提交接口。
- 未绕过 Payload 预检、人工二次确认、工作流锁或提交流程总闸。
- 价格异常仍应进入人工检查；本次没有执行真实 Ozon 提交、库存写入或外部副作用。

### 相关文件

- 后端节点摘要：`src/workflowRuns.js`。
- 自动上架价格诊断生成：`src/autoListing.js`。
- 前端诊断卡：`public/app.js`、`public/styles.css`。
- 定价文档：`docs/pricing-logic.zh-CN.md`。
- 测试：`test/workflow-runs.test.js`、`test/frontend-static.test.js`。

### 验证

- 已先写失败测试，再实现功能。
- 目标测试：`node --test test/workflow-runs.test.js test/frontend-static.test.js`，74/74 通过。

## 2026-06-27 价格异常阻塞规则

更新时间：2026-06-27

### 已完成

- 在 `match_profit` 节点定价诊断基础上新增价格风险评估。
- 以下价格异常会把节点状态置为 `waiting_human`：
  - `PRICING_PACKAGE_MISSING`：缺少完整尺重，`blocked / high`。
  - `PRICING_SHIPPING_LEVEL_MISSING`：无法匹配运费等级，`blocked / high`。
  - `PRICING_NOT_CONVERGED`：价格迭代未收敛，`blocked / high`。
  - `PRICING_MIN_PRICE_INVALID`：最低价为空或不低于售价，`blocked / high`。
  - `PRICING_PROFIT_LOW`：利润过低或为负，`manual_review / medium`。
  - `PRICING_LOGISTICS_RATIO_HIGH`：运费占售价超过 35%，`manual_review / medium`。
- 前端“定价诊断”卡片新增价格风险标签，显示 `PRICING_*` reasonCode。

### 安全边界

- 价格风险只影响工作流状态和人工介入，不调用 Ozon 提交接口。
- 触发 `blocked` 或 `manual_review` 后，流程必须经过人工确认/修正后再继续。
- 未绕过 Payload 预检、人工二次确认、工作流锁或提交流程总闸。

### 相关文件

- 风险评估与节点状态：`src/workflowRuns.js`。
- 前端风险标签：`public/app.js`、`public/styles.css`。
- 文档规则：`docs/pricing-logic.zh-CN.md`。
- 测试：`test/workflow-runs.test.js`、`test/frontend-static.test.js`。

### 验证

- 已按 TDD 先写失败测试，再实现功能。
- 目标测试：`node --test test/workflow-runs.test.js`，37/37 通过。
- 前端契约：`node --test test/frontend-static.test.js`，39/39 通过。

## 2026-06-27 价格风险人工处理动作

更新时间：2026-06-27

### 已完成

- 工作流价格风险节点新增人工处理动作：
  - `重新生成价格`：调用 `/api/workflows/:id/nodes/:key/pricing-risk/recalculate`，节点置为 `retrying`，记录 `pricing_recalculation_requested`。
  - `接受价格风险`：调用 `/api/workflows/:id/nodes/:key/pricing-risk/accept`，只允许接受 `PRICING_PROFIT_LOW` 与 `PRICING_LOGISTICS_RATIO_HIGH`。
  - `转到 Payload 草稿`：前端定位到 Payload 编辑器，不改数据。
  - `标记换货源`：复用已有 `request-new-source` 安全动作。
- 后端强制拒绝直接接受 `blocked` 类价格风险，例如缺尺重、无运费等级、不收敛、最低价异常。
- 接受价格风险后流程可继续，但仍保留提交锁，后续必须经过 Payload 预检和人工确认。

### 安全边界

- 所有价格风险处理动作都不会调用 Ozon 提交接口。
- `blocked` 风险不能被“接受风险”跳过，只能修正后重算或换货源。
- `manual_review` 风险接受后仍不会绕过 Payload 预检、人工二次确认、工作流锁或提交总闸。

### 相关文件

- 后端动作函数：`src/workflowRuns.js`。
- API 路由：`src/server.js`。
- 前端按钮与调用：`public/app.js`、`public/styles.css`。
- 测试：`test/workflow-runs.test.js`、`test/server-routes.test.js`、`test/frontend-static.test.js`。

### 验证

- 已按 TDD 先写失败测试，再实现功能。
- 后端目标测试：`node --test test/workflow-runs.test.js`，39/39 通过。
- 接口/前端契约：`node --test test/server-routes.test.js test/frontend-static.test.js`，47/47 通过。

## 2026-06-27 佣金来源与 Ozon 分类字典本地化

更新时间：2026-06-27

### 已完成

- 定价计算结果新增 `commissionRate` 与 `commissionSource`，工作流定价诊断可明确显示佣金比例、来源和可信度。
- 自动上架 Payload 草稿路径和真实流程路径都会调用统一佣金来源解析：
  - 有 `ozonContext.commissions` 或任务佣金数据时，使用可解析比例，标记为 `learned_product / 同类已上架商品学习`。
  - 没有可学习佣金时，继续使用 `15%`，标记为 `manual_default / 手填/默认佣金率`。
  - 预留 `ozon_category` 来源，后续可接 Ozon 官方类目真实佣金/费率接口。
- Ozon 属性值字典新增本地持久化缓存：
  - 缓存 key：`description_category_id:type_id:attribute_id:language`。
  - 默认语言：`ZH_HANS`。
  - 落盘位置：`data/ozon-category-cache.json` 的 `attributeValues`。
- `/api/ozon/description-attribute-values` 现在支持先读本地缓存；传 `refresh: true` 时刷新 Ozon 并写回缓存。
- 前端工作流“定价诊断”卡显示佣金率、佣金来源和可信度。

### 安全边界

- 本次只改定价解释、缓存和诊断展示，不自动提交 Ozon。
- `learned_product` 只是同类已上架商品经验学习，不等同于 Ozon 官方实时类目佣金。
- 缺真实类目佣金时仍有明确兜底来源，不会把默认 `15%` 冒充真实值。
- 未绕过 Payload 预检、人工二次确认、工作流锁或提交总闸。

### 相关文件

- 定价结果元数据：`src/pricing.js`。
- 自动上架佣金来源解析：`src/autoListing.js`。
- Ozon 分类/属性值缓存：`src/ozonCategoryCache.js`。
- 属性值字典 API：`src/server.js`。
- 工作流前端展示：`public/app.js`。
- 文档：`docs/pricing-logic.zh-CN.md`、`docs/erp-tab-api-map.zh-CN.md`。
- 测试：`test/pricing-source.test.js`、`test/ozon-category-cache.test.js`、`test/auto-listing-payload-draft.test.js`。

### 验证

- 已按 TDD 先写失败测试，再实现功能。
- 目标测试：`node --test test\pricing-source.test.js test\ozon-category-cache.test.js test\auto-listing-payload-draft.test.js`，5/5 通过。

## 2026-06-27 Ozon 必填属性字典分析自动化

更新时间：2026-06-27

### 已完成

- 新增 Ozon 必填属性分析模块，可从本地分类缓存中提取每个 `description_category_id/type_id` 的必填属性。
- 新增填写策略归类：
  - `fixed_no_brand`：品牌默认无品牌。
  - `model_name_from_parent_sku`：型号名称由父 SKU/商品族名生成。
  - `fixed_country_china`：生产国/制造国默认中国。
  - `variant_aspect_from_sku`：颜色、尺码等变体特征从 1688 SKU 规格提取。
  - `dictionary_lookup_from_product_text`：材质、类型、用途等从商品文本匹配字典。
  - `dictionary_lookup_or_manual_rule`：需继续沉淀字典映射规则。
  - `package_data`：尺重字段来自 1688 详情解析。
  - `generated_content`：描述/关键词由俄文内容生成。
  - `manual_rule_needed`：暂缺可靠自动规则。
- 新增可恢复脚本：
  - `npm run analyze:ozon-required-attributes`
  - `npm run analyze:ozon-required-attributes -- --refresh-attributes --limit=50 --throttle-ms=350`
  - `npm run analyze:ozon-required-attributes -- --refresh-values --limit=50 --throttle-ms=350`
- 已生成本地分析产物：`data/ozon-required-attribute-analysis.json`。
- 已完成全局真实刷新：
  - 分类属性：7422/7422 个 type 已缓存。
  - 必填字典值：16797/16797 行已缓存。
  - 中途遇到 Ozon 脏 type、网络 `fetch failed` 和 Windows 覆盖写入问题，已修复脚本容错和缓存保存逻辑，并重试补齐。

### 当前分析快照

- 分类 type 总数：7422。
- 已缓存属性的 type：7422。
- 未缓存属性的 type：0。
- 必填属性行：27394。
- 唯一必填属性：62。
- 必填字典属性行：16797。
- 已缓存字典值行：16797。

当前策略分布：

```json
{
  "dictionary_lookup_from_product_text": 7551,
  "fixed_no_brand": 7418,
  "model_name_from_parent_sku": 7612,
  "dictionary_lookup_or_manual_rule": 788,
  "variant_aspect_from_sku": 1128,
  "manual_rule_needed": 2135,
  "package_data": 316,
  "fixed_country_china": 446
}
```

### 安全边界

- 该自动化只读取 Ozon 分类/属性/字典接口并写本地 JSON。
- 不创建商品、不提交 Payload、不改库存、不触发审核。
- 全量刷新已完成；后续再次刷新仍建议分批、限速、可恢复执行，避免 Ozon API 限流。
- 分析结果用于后续自动填写规则反哺，不代表所有属性已经可以无人工确认提交。

### 相关文件

- 分析模块：`src/ozonRequiredAttributeAnalysis.js`。
- 批量脚本：`scripts/analyze-ozon-required-attributes.mjs`。
- npm 命令：`package.json`。
- 分类/字典缓存：`data/ozon-category-cache.json`。
- 分析产物：`data/ozon-required-attribute-analysis.json`。
- 说明文档：`docs/ozon-required-attributes-analysis.zh-CN.md`。
- 测试：`test/ozon-required-attribute-analysis.test.js`。

## 2026-07-24 G4-S1 一键自动处理安全闭环（第一批）

### 已完成

- 普通商品页的“自动完成其余资料”会先取得一次明确的付费 AI 授权；授权内容明确说明可能产生 AI 调用费用、不会提交 Ozon。
- 浏览器请求与服务端共同绑定当前真实商品的 `workflowRunId + autoListingJobId + captureId + storeId + sourceSnapshotHash`。
- 服务端在 AI 调用前和受控链路每个阶段重新校验绑定；缺少授权、字段不完整或商品/店铺/来源快照变化时，在 AI 调用前停止。
- 实际 auto-listing job 在模型调用前再次校验相同五字段；工作流暂停或等待人工时不会启动，也不会被串跑自动解锁。
- 模型返回后再次复核真实 job，关键写回使用绑定 CAS；匹配候选自身必须以 crawler 持久化外层 `captureId + storeId` 和当前来源 `sourceSnapshotHash` 与授权全量一致，同 ID 新快照、缺失外层范围或 parsed 范围冲突均停止并要求重新授权，不能把新字段挂到旧来源证据。
- AI 内容未形成当前 Payload 草稿时立即停止，不会拿旧草稿继续预检；付费节点也不再显示旧的无授权“从此继续”动作。
- 受控链路不再以“到达 preflight 节点”冒充完成。只有当前草稿 `payloadDraftHash` 与成功预检的验证哈希完全一致时才返回 `completed=true`。
- 所有返回和审计事件继续明确 `submittedToOzon=false`；本轮没有调用付费 AI，也没有执行 Ozon 写入。

### 当前真实页面

- 当前 capture：`c1784812672342zraqu`，店铺 `3815760-4 / xymallc`。
- 页面自动展示胸针类目、9 个 SKU 的 2.2 CNY 采集价、50g / 10×10×10mm 包装尺重与 25.37 CNY 试算售价。
- 页面只有一个主动作“自动完成其余资料”；点击后首先出现付费 AI 安全确认，取消不会运行链路。

### 验证

- 定向：`node --test test/workflow-node-executor.test.js test/auto-listing-payload-draft.test.js test/auto-listing-match-rerun.test.js test/frontend-static.test.js`，377/377。
- 全量：`npm test`，1319/1319。
- 独立只读复核：Ready，未发现仍存在的 Critical/Important。
- `npm run lint`：76 files。
- `npm run offline-acceptance`：通过，`networkAccessed=false`、`writesExecuted=false`。
- 5178 服务已重启并在真实商品草稿页完成浏览器检查。

### 唯一下一入口

- G4-S1 仍为 `CURRENT`。下一步只能是在用户明确确认当前真实商品的一次付费 AI 调用后，记录“AI 文案 → 当前草稿刷新 → 自动定价/属性 → 强预检”的真实结果；仍不提交 Ozon。

## 2026-07-24 G4-S1 包装证据与定价同源修复

- 真实 capture `c1784812672342zraqu` 的当前快照明确记录 `50g / 10×10×10mm`，但旧定价预览通过 padding/minimum clamp 改成 `120g / 60×50×30mm`，导致页面展示证据与实际计价输入不一致。
- `packageSizeWeight` 现在保留来源快照或绑定手工实测的原始数值；父商品、变体、定价诊断和 Payload 不再加缓冲或抬高最小值后继续冒充可信证据。
- Ozon 尺重错误不再触发“安全默认尺重”自动重试；必须返回卖家同屏修复来源/实测证据，保留预检和人工提交总闸。
- 当前真实商品以 2.2 CNY 采集价和 `50g / 10×10×10mm` 重新试算为 22.45 CNY；利润继续显示未知，因为当前店铺佣金和结算规则仍没有可信证据。浏览器运行态已核对页面显示同一尺重、售价和唯一动作“自动完成其余资料”。
- 独立审查发现并已封死两条旁路：SKU 自带尺重不能覆盖已验证的父级包装；`WEIGHT_SIZE_INVALID` 不再进入任一后台自动纠偏/自动重投路径。
- 验证：定向 119/119、全量 1322/1322、lint 76 files、offline acceptance 通过；未调用付费 AI、未执行 Ozon 写入。
- G4-S1 状态不变。唯一下一入口仍是用户针对当前真实商品明确授权一次付费 AI，随后记录 AI 文案、草稿刷新和强预检真实结果。

## 2026-07-23 G2-S1 真实胸针商品类目回填复核

- 当前真实采集：`c1784812672342zraqu`，1688 Offer `993570366569`，店铺 `3815760-4`。
- 标题“卡通小精灵胸针徽章服装背包饰品配饰别针跨境外贸热销合金胸章”在 7422 条本地类目中自动匹配：
  - 第一候选：`小百货和配饰 / 服装首饰 / 胸针`
  - `description_category_id=17027899`
  - `type_id=87458886`
  - 分数 `420`，领先第二候选 `50`，满足自动选择门槛。
- 页面先前显示“系统尚未找到可靠类目”的直接原因是 5178 端口仍运行未加载现有匹配代码的旧 Node 进程；重启服务并重跑同一 capture 后，旧草稿已回填 `auto_matched_evidence_pending`。
- 新增回归测试，证明旧草稿即使缺失 `categoryDecision/autoCategory`，重复打开时也会从标题回填“胸针”，并把阻断收敛为“当前店铺类目证据待同步”，不会退回人工盲选。
- 浏览器实测商品草稿已展示“系统已自动匹配：小百货和配饰 / 服装首饰 / 胸针”。
- 定向回归 `11/11`、全量 `npm test` `1276/1276`、lint `76 files`、offline acceptance 均通过。
- 验证等级：标题候选与旧草稿回填为 `locally_tested`；当前店铺 `3815760-4` 的类目树和属性回执仍未取得，本地跨店缓存只作候选诊断，不能作为提交证据。
- G2-S1 退出前的下一项直接阻断：通过受控 Seller API 只读同步当前店铺类目树与 `17027899:87458886` 必填属性；该证据边界属于后续 G3，只有 G2-S1 正式通过退出门后才进入，且不要求卖家手工搜索 7422 个类型。

### 后续建议

1. 把 `dictionary_lookup_from_product_text` 接入 Payload 预检/属性自动补齐节点。
2. 把 `fixed_country_china`、`fixed_no_brand`、`model_name_from_parent_sku` 写入统一必填属性补齐器。
3. 把 `manual_rule_needed` 高频属性整理成规则 backlog。
4. 在工作流中展示“当前类目必填属性覆盖率/缺失字段/自动填充策略”。

## 2026-06-27 Ozon 字典填写规则与技巧沉淀

更新时间：2026-06-27

### 已完成

- 检索并归纳 Ozon 官方 Seller API、Ozon Seller 教程、俄语卖家经验中关于商品属性、字典值、标题、合并商品卡和变体属性的规则。
- 结合本地全量字典分析，新增规则文档：`docs/ozon-dictionary-fill-rules.zh-CN.md`。
- 形成可接入自动化的策略分层：
  - 高置信自动填：品牌无品牌、型号名称父 SKU、原产国中国、颜色/尺码等 SKU 变体属性、尺重字段。
  - 中置信半自动匹配：类型、材质、用途、性别、尺码、容量、件数、适用对象。
  - 低置信/合规敏感阻塞：危险等级、保质期、储存条件、成分、制造商、温度范围、儿童/食品/化妆品/医疗/化学/电池/机动车配件相关字段。
- 明确关键边界：
  - 字典值必须来自当前 `description_category_id/type_id/attribute_id` 的合法字典，不能跨类目复用。
  - `型号名称` 用于商品卡合并，同父 SKU 应保持一致。
  - `is_aspect=true` 的变体属性必须在同组 SKU 中形成差异，否则会触发 Ozon 合并失败。
  - 标题、类型、品牌、模型、颜色必须共用同一套属性结果，不能各自独立生成。

### 后续建议

1. 新增 `requiredAttributeAutofill` 模块，把规则文档转成可执行代码。
2. 先接入高置信自动填字段：品牌、型号名称、原产国、颜色、尺重。
3. 再接入中置信字典匹配字段：类型、材质、用途、性别、尺码、容量。
4. 在工作流/Payload 预检里展示每个必填属性的填充来源、置信度和是否需要人工确认。
5. 把低置信与合规敏感字段自动放入人工规则池，不允许无确认提交。

### 相关文件

- 规则文档：`docs/ozon-dictionary-fill-rules.zh-CN.md`。
- 全量分析产物：`data/ozon-required-attribute-analysis.json`。
- 分类/字典缓存：`data/ozon-category-cache.json`。
