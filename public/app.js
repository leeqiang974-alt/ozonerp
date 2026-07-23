const state = {
  stores: [],
  selectedStoreId: "",
  categoryTree: [],
  categoryEvidence: { tree: null, attributes: null },
  categoryAttributeRequestToken: 0,
  productStatus: "all",
  productRows: [],
  productReadState: "idle",
  // Stock values in the product ledger are only usable while the matching
  // product read is a recent, complete evidence batch.  Keep the timestamp
  // separate so a previously loaded positive value cannot survive a partial
  // or expired refresh and look like current stock readiness.
  productReadCheckedAt: "",
  productNextAction: "先读取商品列表。",
  productSellerResult: null,
  productCounts: {},
  productLastId: "",
  productHasNext: false,
  stockWarehouses: null,
  stockSnapshotProducts: null,
  stockSnapshot: null,
  stockEvidence: null,
  stockDryRun: null,
  stockFocusOfferIds: [],
  // Store changes and overlapping reads must invalidate all stock evidence;
  // otherwise a late response can make another store look write-ready.
  stockReadRequestToken: 0,
  warehouseRequestToken: 0,
  // Listing forms consume the same warehouse endpoint as the inventory
  // workbench.  Keep their request generation separate so a late response
  // from the previous store cannot repopulate a listing warehouse selector.
  listingWarehouseRequestToken: 0,
  stockEvidenceRequestToken: 0,
  listingAttributes: [],
  listingVariantAspects: [],
  generatedListingContent: null,
  orderStatus: "",
  orderRows: [],
  orderBatch: { loaded: false, failed: false, partial: false, hasNext: false, syncedAt: "", sourceCount: 0 },
  orderCoverage: { pageOffsets: [], pageCursors: [], orderKeys: [], observedCount: 0, hasNext: false },
  // Finance is a read-only projection. Keep the server/model contract visible
  // in the UI instead of deriving a profit number from cached orders.
  financeReadModel: null,
  readOperatorReceiptSummary: null,
  readOperatorMatrix: null,
  readOperatorMatrixEnvironment: "",
  readOperatorExecutionSummary: null,
  readOperatorExecutionRequestToken: 0,
  sessionProofSummary: null,
  runtimeSafetySnapshot: null,
  observabilitySummary: null,
  migrationStateAudit: null,
  deploymentPreflight: null,
  orderRequestToken: 0,
  // A selected posting detail read must not paint after the seller changes
  // store or refreshes the order batch.  Keep it separate from the list
  // request token because detail reads are independently scoped.
  orderDetailRequestToken: 0,
  // Keep a read-only receipt summary bound to the order batch that requested it.
  fbsReceiptRequestToken: 0,
  orderPageOffset: 0,
  orderCursor: "",
  orderCursorHistory: [],
  orderSortDir: "DESC",
  productRequestToken: 0,
  promotionRows: [],
  promotionRequestToken: 0,
  promotionSellerResult: null,
  selectedPromotion: null,
  promotionProducts: [],
  promotionCandidates: [],
  // Activity writes must be scoped to an explicit seller selection.  Keeping
  // this separate from the read rows prevents the remove action from
  // silently treating every participating product as the user's intent.
  promotionSelectedProductIds: [],
  promotionDetailSellerResult: { products: null, candidates: null },
  promotionImpactPreview: null,
  promotionDetailOffset: 0,
  promotionDetailHasNext: false,
  // Keep detail-read failures distinct from an activity that has zero items.
  promotionDetailError: "",
  promotionProductKind: "products",
  promotionMutationEvidence: null,
  promotionDetailRequestToken: 0,
  collected1688: null,
  captureRows: [],
  currentCaptureId: "",
  currentCaptureDraft: null,
  categorySearchTimer: 0,
  categorySearchLoading: false,
  attributeValueCache: {},
  listingWarehouses: [],
  listingWarehouseReadIncomplete: false,
  variantGroups: [],
  selectedVariantGroup: 0,
  reservedParentSkus: [],
  crawlerTasks: [],
  crawlerCandidates: [],
  crawlerCandidateRequestToken: 0,
  listingHandoffNotice: "",
  crawlerWorkerStatus: null,
  open1688Status: null,
  selectedCrawlerTaskId: "",
  crawlerRefreshTimer: 0,
  ozonLearningTasks: [],
  ozonLearningItems: [],
  ozonOpportunities: [],
  ozonImageStyleObservations: null,
  ozonImageStyleAnalysis: null,
  ozonReferenceGuidance: null,
  ozonImage2Task: null,
  selectedOzonLearningTaskId: "",
  autoListJobs: [],
  productReadinessByJobId: {},
  // A product status reread must not repaint after the seller switches store
  // or environment while the controlled Seller API request is in flight.
  productReadinessRequestToken: 0,
  directWriteKeysByScope: {},
  reverseGuidanceCards: [],
  workflowRuns: [],
  workflowSummary: null,
  showSyntheticWorkflows: false,
  ruleApprovalAuditIntents: [],
  ruleApprovalAuditSummary: null,
  rulePublishReviewIntents: [],
  rulePublishReviewSummary: null,
  workflowFilter: "all",
  rulePoolFilter: {
    status: "all",
    keyword: "",
  },
  selectedWorkflowRunId: "",
  selectedWorkflowNodeKey: "",
  // Seller-facing preflight repair context.  Keep the exact issue while
  // switching from the listing card to the workflow console so the console
  // can focus the same field/SKU instead of making the seller search again.
  selectedWorkflowPayloadIssue: null,
};

const PURCHASE_COST_MARKUP_RMB = 5;
const PACKAGE_WEIGHT_PADDING_G = 50;
const PACKAGE_SIZE_PADDING_MM = 20;
// A new seller row must not invent sellable inventory. Stock is only filled
// after the seller observes the exact Offer×warehouse tuple.
const DEFAULT_LISTING_STOCK = "";
const ERP_NAVIGATION_GROUPS = [
  { key: "store-overview", label: "店铺总览", views: ["dashboard"] },
  { key: "product-management", label: "商品管理", views: ["products"] },
  { key: "sourcing-procurement", label: "选品采集", views: ["sourcing", "research"] },
  { key: "listing-center", label: "上传管理", views: ["listing", "workflow-console"] },
  { key: "order-fulfillment", label: "订单履约", views: ["orders"] },
  { key: "inventory-warehouse", label: "库存仓库", views: ["warehouse"] },
  { key: "marketing", label: "营销活动", views: ["promotions"] },
  { key: "finance-profit", label: "财务利润", views: ["finance"] },
  { key: "customer-service", label: "客户售后", views: ["service"] },
  { key: "analytics", label: "数据报表", views: ["reports"] },
  { key: "system", label: "系统配置", views: ["system"] },
];
const ERP_VIEW_OWNERSHIP_CONTRACTS = {
  dashboard: {
    title: "店铺总览",
    handles: "只处理店铺销售、订单、商品、库存、利润、活动风险和今日提醒。",
    excludes: "不直接编辑 Ozon payload、不承载采集表单、不把上架流水线作为主区域。",
    wrongPageHint: "如果你要编辑商品资料，去“上架中心”；如果要处理活动，去“营销活动”。",
  },
  sourcing: {
    title: "选品采集",
    handles: "只处理货源采集、候选池、采集质量和生成上传草稿。",
    excludes: "不处理 Ozon 活动、订单履约、库存提交和在售商品维护。",
    wrongPageHint: "看到活动或订单字段时说明页面串区；请切回对应运营 tab。",
  },
  listing: {
    title: "上传队列",
    handles: "只处理准备上传的商品草稿、上传状态、最少必要修复和人工确认上传。",
    excludes: "不处理 Ozon 营销活动、订单履约、库存队列和竞品样本采集。",
    wrongPageHint: "如果你只是处理活动商品，不应该出现在这里。",
  },
  "workflow-console": {
    title: "自动化任务",
    handles: "只处理自动化任务卡点、错误原因、字段定位、重试、换货源和提交闸口。",
    excludes: "不作为普通商品列表、不作为活动运营页、不承载完整上架表单。",
    wrongPageHint: "这里应该看到问题、原因、推荐动作，而不是完整商品编辑表。",
  },
  research: {
    title: "竞品素材",
    handles: "只处理 Ozon 样本、同品参照、图片风格、文案指导和素材建议。",
    excludes: "不直接提交 Ozon、不处理订单、库存和营销活动。",
    wrongPageHint: "学习结果只反哺上架，不替代上架草稿。",
  },
  products: {
    title: "商品总览",
    handles: "只处理店铺商品资产全览、在售、审核中、待修、缺库存、缺价格和下架归档。",
    excludes: "不采集 1688、不生成新商品草稿、不处理营销活动详情。",
    wrongPageHint: "要新增商品去“1688 采集”或“上架草稿”。",
  },
  warehouse: {
    title: "仓库与库存",
    handles: "只处理 Ozon 仓库读取、库存读取、库存写入和库存失败队列。",
    excludes: "不处理上架文案、类目属性、活动商品和订单发货动作。",
    wrongPageHint: "看到标题、描述、图片字段时说明进入了上架草稿，不是库存页。",
  },
  orders: {
    title: "订单履约",
    handles: "只处理 FBS 订单、待备货、待发运、运输中、取消和争议状态。",
    excludes: "不处理新品上架、活动商品、库存写入和 Ozon 参照学习。",
    wrongPageHint: "订单页只应该看到订单筛选和订单列表。",
  },
  promotions: {
    title: "营销活动",
    handles: "只处理 Ozon 活动读取、活动商品、可加入商品和移出活动。",
    excludes: "不处理新品上架表单、类目属性、标题描述、图片采集和库存提交。",
    wrongPageHint: "如果这里出现“无忧易售信息、描述、产品采集图、平台分类”，就是串到了上架草稿。",
  },
  finance: {
    title: "财务利润",
    handles: "只处理销售额、采购成本、物流费、佣金、毛利、最低价和价格风险。",
    excludes: "不处理上架表单、订单发货动作、采集任务和活动商品编辑。",
    wrongPageHint: "如果你要改商品标题或图片，去“上架中心”；如果要发货，去“订单履约”。",
  },
  service: {
    title: "客户售后",
    handles: "只处理评价、退货、纠纷、客服问题和差评风险。",
    excludes: "不处理新品上架、库存写入、活动商品和采集任务。",
    wrongPageHint: "售后页不应该出现类目属性、上架图片或库存 JSON。",
  },
  reports: {
    title: "数据报表",
    handles: "只处理销售趋势、商品表现、库存周转、选品效果、上架成功率和异常趋势。",
    excludes: "不承载日常操作表单、不直接提交 Ozon、不修改库存。",
    wrongPageHint: "需要操作时从报表跳到对应业务模块，而不是在报表页直接编辑。",
  },
  system: {
    title: "系统配置",
    handles: "只处理店铺 API、Ozon 字典、1688 插件、自动化规则、运行日志和高级诊断。",
    excludes: "不作为日常经营入口、不处理订单发货、不编辑商品上架资料。",
    wrongPageHint: "普通卖家每天要处理的事应该回到业务模块，不塞进系统配置。",
  },
};
const ERP_TAB_TASK_CARDS = {
  dashboard: {
    title: "先看店铺现在怎么样",
    primary: "先看销售、订单、商品、库存、利润和活动风险；今日提醒只做跳转，不抢主区域。",
    actions: [
      { label: "处理商品风险", view: "products" },
      { label: "查看订单", view: "orders" },
      { label: "进入上架中心", view: "listing" },
    ],
  },
  sourcing: {
    title: "找到可卖的新商品",
    primary: "这里先看采集箱、候选池和采集质量，确认后再进入上传队列。",
    actions: [
      { label: "打开采集任务", view: "sourcing" },
      { label: "去上传队列", view: "listing" },
      { label: "看自动化任务", view: "workflow-console" },
    ],
  },
  listing: {
    title: "处理待上传商品",
    primary: "这里只看当前草稿能不能上传、缺什么最少资料、下一步点哪里。",
    actions: [
      { label: "查看当前草稿", view: "listing" },
      { label: "补必要资料", view: "listing" },
      { label: "看自动化卡点", view: "workflow-console" },
    ],
  },
  "workflow-console": {
    title: "处理卡住的自动化任务",
    primary: "这里不再说笼统人工干预，只看问题、原因、推荐动作、点了以后会发生什么。",
    actions: [
      { label: "查看失败原因", view: "workflow-console" },
      { label: "回上架草稿修字段", view: "listing" },
      { label: "换 1688 货源", view: "sourcing" },
    ],
  },
  research: {
    title: "准备竞品和素材参考",
    primary: "这里只采 Ozon 同品、图片风格和文案建议；素材只反哺上传草稿。",
    actions: [
      { label: "打开参照学习", view: "research" },
      { label: "生成图片指导", view: "research" },
      { label: "回上架草稿", view: "listing" },
    ],
  },
  products: {
    title: "管理店铺商品资产",
    primary: "这里看全店商品、在售、审核中、待修、缺库存、缺价格和下架归档。",
    actions: [
      { label: "刷新商品状态", view: "products" },
      { label: "处理库存", view: "warehouse" },
      { label: "处理审核失败", view: "workflow-console" },
    ],
  },
  warehouse: {
    title: "补库存和查仓库",
    primary: "这里只处理仓库、库存读取、库存写入和失败队列；不编辑上架资料。",
    actions: [
      { label: "读取仓库", view: "warehouse" },
      { label: "写入库存", view: "warehouse" },
      { label: "查看商品状态", view: "products" },
    ],
  },
  orders: {
    title: "处理今天订单",
    primary: "这里看 FBS 待备货、待发运、运输中、取消和争议；不处理新品上架。",
    actions: [
      { label: "刷新订单", view: "orders" },
      { label: "看库存", view: "warehouse" },
      { label: "看商品状态", view: "products" },
    ],
  },
  promotions: {
    title: "维护 Ozon 活动",
    primary: "这里只看活动、活动商品、候选商品和移出活动；不出现上架草稿字段。",
    actions: [
      { label: "读取活动", view: "promotions" },
      { label: "查看活动商品", view: "promotions" },
      { label: "查看商品状态", view: "products" },
    ],
  },
  finance: {
    title: "核算利润风险",
    primary: "这里汇总销售额、采购成本、物流费、佣金、毛利和最低价风险，先作为财务域入口承接价格逻辑。",
    actions: [
      { label: "看价格规则", view: "listing" },
      { label: "看商品状态", view: "products" },
      { label: "看活动风险", view: "promotions" },
    ],
  },
  service: {
    title: "处理售后风险",
    primary: "这里承接评价、退货、纠纷和客服问题，避免售后被塞进商品或订单页。",
    actions: [
      { label: "查看订单", view: "orders" },
      { label: "查看商品", view: "products" },
      { label: "看报表", view: "reports" },
    ],
  },
  reports: {
    title: "看跨模块趋势",
    primary: "这里看销售、商品、库存、选品、上架成功率和异常趋势，不直接承载业务操作表单。",
    actions: [
      { label: "店铺总览", view: "dashboard" },
      { label: "商品管理", view: "products" },
      { label: "财务利润", view: "finance" },
    ],
  },
  system: {
    title: "配置连接与自动化",
    primary: "这里只处理 API、字典、插件、自动化规则、日志和高级诊断，日常经营回到业务域。",
    actions: [
      { label: "看 API 状态", view: "system" },
      { label: "工作流诊断", view: "workflow-console" },
      { label: "回店铺总览", view: "dashboard" },
    ],
  },
};

const BUSINESS_PRIMARY_PANEL_CLASSES = [
  "business-primary-panel",
  "product-asset-ledger",
  "single-listing-outcome",
  "listing-secondary-workflow",
  "workflow-summary-cards",
  "workflow-focus-bar",
  "promotion-layout",
  "erp-dashboard-grid",
];
const ERP_INFORMATION_ARCHITECTURE = [
  {
    area: "今日工作台",
    purpose: "日常只看这里：今天卡在哪里、哪些商品能继续、哪个节点需要人工。",
    entry: "运营总览",
    actions: ["看风险", "处理等待人工", "进入对应节点"],
  },
  {
    area: "商品上架流水线",
    purpose: "把一个 1688 商品从采集推进到 Ozon 审核回馈，所有关键节点都可诊断。",
    entry: "1688采集 / 上架执行 / 工作流中心",
    actions: ["采集货源", "生成草稿", "预检提交", "修复失败"],
  },
  {
    area: "学习与素材",
    purpose: "辅助上架，不直接提交：Ozon 样本、文案指导、图片风格、GPT Image 2。",
    entry: "Ozon 学习",
    actions: ["采样同品", "生成指导卡", "分析图片", "生图测试"],
  },
  {
    area: "店铺运营",
    purpose: "上架后的运营区：商品、库存、订单、促销，不混入采集和 AI 实验。",
    entry: "商品状态 / 仓库与库存 / 订单履约 / 营销活动",
    actions: ["查商品", "写库存", "看订单", "维护活动"],
  },
  {
    area: "系统配置",
    purpose: "高级工具和配置区：店铺 API、类目字典、诊断、开发缺口，不作为日常入口。",
    entry: "系统说明、模块归属与 API 对齐",
    actions: ["检查 API", "维护字典", "查看高级工具"],
  },
];
const SELLER_ERP_MANAGEMENT_SCOPES = [
  {
    area: "新品上架",
    view: "sourcing",
    promise: "从 1688 商品开始，完成采集、解析、分类、属性、文案、图片、定价、预检、提交和审核回馈。",
    owns: ["1688 采集", "Ozon 参照学习", "上架草稿", "审核失败修复"],
    next: "要新增商品时，从这里进入。",
  },
  {
    area: "商品状态",
    view: "products",
    promise: "查看 Ozon 商品是否在售、审核中、失败、缺价、缺库存或需要修复。",
    owns: ["商品列表", "状态分组", "价格读取", "异常定位"],
    next: "商品已经提交后，从这里观察结果。",
  },
  {
    area: "库存与仓库",
    view: "warehouse",
    promise: "读取仓库、写入库存、回放失败库存队列，并避免商品未就绪时盲目写库存。",
    owns: ["仓库读取", "库存写入", "库存回查", "失败队列"],
    next: "商品可售后，从这里补库存。",
  },
  {
    area: "订单履约",
    view: "orders",
    promise: "查看 FBS 待备货、待发运、运输中、取消和争议订单，后续接入打包发运动作。",
    owns: ["订单看板", "状态筛选", "仓库筛选", "订单商品明细"],
    next: "每天发货前，从这里处理订单。",
  },
  {
    area: "营销活动",
    view: "promotions",
    promise: "读取 Ozon 活动、查看参与商品和候选商品，维护活动商品和后续活动价策略。",
    owns: ["活动读取", "参与商品", "候选商品", "移出活动"],
    next: "做促销或清理活动商品时进入。",
  },
  {
    area: "利润与价格",
    view: "listing",
    promise: "把采购价、运费、佣金、原价、最低价和利润风险统一变成上架前诊断。",
    owns: ["定价计算", "运费档位", "佣金来源", "最低价保护"],
    next: "上架前必须过这里的安全判断。",
  },
];
const SELLER_OPERATING_MODEL = [
  {
    area: "今天先处理什么",
    view: "dashboard",
    system: "系统自动汇总当前商品、审核失败、库存风险、订单待处理和价格风险。",
    decision: "你只需要决定先推进哪个商品、先修哪个异常、今天是否要补库存或处理订单。",
    result: "进入 ERP 后先看这里，不需要猜哪个 tab 有事。",
  },
  {
    area: "商品生命周期",
    view: "sourcing",
    system: "系统自动把 1688 货源推进为 Ozon 草稿、预检结果、提交任务和审核回馈。",
    decision: "你只需要决定货源是否继续、类目是否正确、失败后修字段还是换货源。",
    result: "一个商品从采集到上架只走一条主线。",
  },
  {
    area: "店铺日常运营",
    view: "orders",
    system: "系统自动读取商品状态、库存、订单和活动数据。",
    decision: "你只需要决定补库存、处理订单、调整价格或维护活动商品。",
    result: "上架后的事情归到运营区，不再混进采集和 AI 工具。",
  },
  {
    area: "异常与决策",
    view: "workflow-console",
    system: "系统自动把失败翻译成业务原因，例如类目错、必填属性缺失、变体合并失败、利润不安全。",
    decision: "你只需要在推荐动作里选择：修资料、换货源、重新生成、确认继续或放弃。",
    result: "不再说人工干预，只说问题、原因、选择和后果。",
  },
];
const ERP_MODULE_OWNERSHIP = [
  {
    tab: "总览",
    role: "健康与入口",
    owns: ["店铺/API 连通", "关键指标", "最近响应", "模块归属地图"],
    excludes: ["不承载采集任务", "不直接提交 Ozon"],
    next: "异常时进入对应业务 tab 或工作流控制台。",
  },
  {
    tab: "学习与机会",
    role: "Ozon 学习与机会发现",
    owns: ["Ozon 竞品学习", "机会池", "反查 1688", "规则分析", "主链驾驶舱"],
    excludes: ["不编辑最终上架 payload", "不写库存"],
    next: "输出机会和关键词给 1688 反向选品。",
  },
  {
    tab: "1688反向选品",
    role: "货源采集与候选池",
    owns: ["1688 搜索任务", "详情解析", "候选审核", "Cookie/人机状态", "入采集箱"],
    excludes: ["不做 Ozon 提交", "不处理审核回执"],
    next: "合格候选进入上架执行或工作流。",
  },
  {
    tab: "上架执行",
    role: "草稿、预检、提交",
    owns: ["类目/属性读取", "俄文内容生成", "变体与图片", "Payload 草稿", "Ozon 提交"],
    excludes: ["不替代流程诊断", "不做批量无确认提交"],
    next: "提交后由审核回执和库存节点接管。",
  },
  {
    tab: "商品状态",
    role: "在售商品观察",
    owns: ["商品列表", "状态分组", "价格读取", "商品检索", "异常状态查看"],
    excludes: ["不采集货源", "不重新生成内容"],
    next: "状态异常时回到工作流或上架执行修复。",
  },
  {
    tab: "仓库与库存",
    role: "仓库和库存写入",
    owns: ["仓库读取", "库存读取", "库存提交", "库存队列回放"],
    excludes: ["不生成商品", "不判断商品审核"],
    next: "只在商品可售或待补库存时执行。",
  },
  {
    tab: "工作流控制台",
    role: "节点诊断与人工介入",
    owns: ["节点状态", "输入/输出/诊断", "Payload 校验", "重试/继续", "摘要导出"],
    excludes: ["不是普通运营列表", "不自动连点提交"],
    next: "卡点统一从这里定位和恢复。",
  },
  {
    tab: "订单履约",
    role: "FBS 订单运营",
    owns: ["订单看板", "状态筛选", "仓库/服务筛选", "订单商品明细"],
    excludes: ["不处理新品上架", "不做采集分析"],
    next: "用于发货准备和订单状态追踪。",
  },
  {
    tab: "营销活动",
    role: "活动商品维护",
    owns: ["活动读取", "参与商品", "可加入商品", "活动商品移除"],
    excludes: ["不改商品基础资料", "不改库存"],
    next: "用于促销维护，不进入上架主链。",
  },
];
const OZON_SELLER_API_ALIGNMENT = [
  {
    area: "店铺/仓库",
    status: "已对齐",
    api: ["/v2/warehouse/list"],
    gap: "缺少仓库详情与仓库状态变更类能力，当前只读为主。",
  },
  {
    area: "类目/属性",
    status: "已对齐",
    api: ["/v1/description-category/tree", "/v1/description-category/attribute", "/v1/description-category/attribute/values"],
    gap: "需要继续把必填属性规则沉淀到 preflight 动态校验。",
  },
  {
    area: "上架/审核",
    status: "部分对齐",
    api: ["/v3/product/import", "/v1/product/import/info"],
    gap: "提交和回执已接入；人工确认后的 payload-draft-submit 仍需最终安全闸口化。",
  },
  {
    area: "商品/价格/图片",
    status: "部分对齐",
    api: ["/v3/product/list", "/v3/product/info/list", "/v4/product/info/prices", "/v1/product/import/prices", "/v1/product/pictures/import"],
    gap: "已有读取/改价/换图入口；商品资料更新、归档/恢复等能力尚未系统化。",
  },
  {
    area: "库存",
    status: "已对齐",
    api: ["/v2/products/stocks", "/v4/product/info/stocks"],
    gap: "库存队列是本地增强；需继续补商品未就绪时的自动回查策略。",
  },
  {
    area: "订单履约",
    status: "迁移审计",
    api: ["/v4/posting/fbs/list", "/v4/posting/fbs/unfulfilled/list", "/v3/posting/fbs/list（legacy）", "/v3/posting/fbs/unfulfilled/list（legacy）"],
    gap: "Seller API 当前契约已是 v4 cursor；订单页已使用 cursor/sort_dir 只读模型，但完整覆盖和真实账号回放仍需确认。打包、发运、取消、标签等履约动作未接齐。",
  },
  {
    area: "营销活动",
    status: "部分对齐",
    api: ["/v1/actions", "/v1/actions/products", "/v1/actions/candidates", "/v1/actions/products/deactivate"],
    gap: "已读活动和移除商品；加入活动、活动价策略仍未完整闭环。",
  },
  {
    area: "采集/工作流/AI",
    status: "本地逻辑",
    api: ["1688 插件", "workflow_runs.json", "AI 内容/规则"],
    gap: "不是 Ozon Seller API；必须保留安全边界，输出只能进入预检和人工闸口。",
  },
];
const OZON_SELLER_API_GAP_BACKLOG = [
  {
    priority: "P0",
    area: "上架安全闸口",
    tab: "工作流控制台 / 上架执行",
    api: ["/v3/product/import", "/v1/product/import/info"],
    task: "补齐 payload-draft-submit：只有预检通过、人工确认后才允许提交 Ozon task。",
    reason: "这是自动上架闭环的总闸，必须先保证不会绕过人工和预检。",
  },
  {
    priority: "P0",
    area: "审核回执闭环",
    tab: "工作流控制台 / 商品状态",
    api: ["/v1/product/import/info", "/v3/product/info/list"],
    task: "把 task_id 回查、product_id、错误/警告、状态组统一落到 review_reconcile 节点。",
    reason: "用户需要知道失败卡在哪个字段、哪个 SKU、下一步如何修。",
  },
  {
    priority: "P0",
    area: "库存安全回查",
    tab: "仓库与库存",
    api: ["/v2/products/stocks", "/v4/product/info/stocks"],
    task: "库存写入前后自动回查商品是否可写库存，失败进入 stock_sync 节点而不是盲重试。",
    reason: "避免商品未过审时反复刷库存接口。",
  },
  {
    priority: "P1",
    area: "订单履约动作",
    tab: "订单履约",
    api: ["/v4/posting/fbs/list", "/v4/posting/fbs/unfulfilled/list"],
    task: "继续验证 cursor/sort_dir 的批次覆盖并完成真实只读回放，再拆出待接入动作：打包、发运、取消、标签/条码。",
    reason: "v3 FBS 已停用；当前订单页是只读 v4 模型，完整覆盖和履约写动作仍未完成。",
  },
  {
    priority: "P1",
    area: "商品资料维护",
    tab: "商品状态",
    api: ["/v3/product/info/list", "/v1/product/import/prices", "/v1/product/pictures/import"],
    task: "把改价、换图、异常状态修复合并到商品状态页的受控操作面板。",
    reason: "商品维护现在分散在上架页和商品页，容易误操作。",
  },
  {
    priority: "P1",
    area: "营销活动闭环",
    tab: "营销活动",
    api: ["/v1/actions", "/v1/actions/products", "/v1/actions/candidates", "/v1/actions/products/deactivate"],
    task: "补加入活动、活动价校验、移除后的回查刷新。",
    reason: "目前主要支持读活动和移除商品，活动运营还没有闭环。",
  },
  {
    priority: "P2",
    area: "仓库分页与详情",
    tab: "仓库与库存",
    api: ["/v2/warehouse/list"],
    task: "增加分页/详情兼容层，适配 Ozon 仓库列表接口返回变化。",
    reason: "官方接口有分页变化趋势，提前隔离 summarizeWarehouses 能降低维护成本。",
  },
  {
    priority: "P2",
    area: "报表与财务",
    tab: "总览 / 商品状态",
    api: ["待选：Analytics / Finance / Reports"],
    task: "先只做接口调研和字段地图，不进入自动化主链。",
    reason: "财务/报表会影响利润判断，但不是当前上架闭环的阻塞点。",
  },
];
const ERP_WORKFLOW_NAVIGATION = [
  {
    phase: "采集",
    tab: "1688反向选品",
    view: "sourcing",
    node: "crawler_1688",
    check: "Cookie/人机、候选图片、源链接",
    output: "候选货源与原始详情",
  },
  {
    phase: "分析",
    tab: "学习与机会",
    view: "research",
    node: "match_profit",
    check: "竞品规则、利润、同类匹配",
    output: "可上架机会与匹配理由",
  },
  {
    phase: "上架",
    tab: "上架执行",
    view: "listing",
    node: "preflight_check",
    check: "类目、属性、变体、价格、图片",
    output: "Ozon Payload 草稿",
  },
  {
    phase: "审核回馈",
    tab: "工作流控制台",
    view: "workflow-console",
    node: "review_reconcile",
    check: "task_id、错误字段、人工修复建议",
    output: "通过、待修复或换货源",
  },
  {
    phase: "库存闭环",
    tab: "仓库与库存",
    view: "warehouse",
    node: "stock_sync",
    check: "商品可写库存、仓库、库存回查",
    output: "库存写入结果",
  },
];
const ERP_LISTING_PIPELINE_STAGES = [
  {
    key: "collect_1688",
    label: "1688 采集",
    view: "sourcing",
    nodePatterns: ["collect_1688", "crawler_1688"],
    owner: "商品上架流水线",
    primaryAction: "打开采集任务",
    description: "从 1688 插件或采集任务获取商品源数据、图片、SKU 和参数。",
    diagnostic: "重点看插件连接、人机状态、候选数量和详情解析是否完整。",
  },
  {
    key: "parse_product",
    label: "商品解析",
    view: "sourcing",
    nodePatterns: ["candidate_parse", "normalize_source"],
    owner: "商品上架流水线",
    primaryAction: "查看候选解析",
    description: "把原始商品拆成标题、图片、SKU、颜色、规格、尺重和原始参数。",
    diagnostic: "重点看 SKU 是否可区分、颜色/规格是否缺失、图片是否有效。",
  },
  {
    key: "ozon_reference",
    label: "Ozon 参照",
    view: "research",
    nodePatterns: ["ozon_learning", "learn_ozon", "keyword_expand"],
    owner: "学习与素材",
    primaryAction: "打开参照学习",
    description: "同步采集同类 Ozon 样本，为分类、文案、属性和图片提供参考。",
    diagnostic: "重点看样本是否同品、是否有足够详情、是否误入无关类目。",
  },
  {
    key: "category_attributes",
    label: "分类属性",
    view: "listing",
    nodePatterns: ["map_category", "category", "attributes"],
    owner: "上架草稿",
    primaryAction: "检查分类属性",
    description: "匹配 Ozon 类目并读取必填属性、字典值和变体区分字段。",
    diagnostic: "重点看分类置信度、必填项、模型名称和变体特征是否可合并。",
  },
  {
    key: "copy_images",
    label: "文案图片",
    view: "research",
    nodePatterns: ["content_generate", "generate_listing"],
    owner: "学习与素材",
    primaryAction: "生成指导/素材",
    description: "生成俄文标题、描述、标签、图片指导和可选 GPT Image 2 生图任务。",
    diagnostic: "重点看俄文是否混中文、图片是否含违规文字、轮播图是否完整。",
  },
  {
    key: "pricing_profit",
    label: "定价利润",
    view: "listing",
    nodePatterns: ["match_profit", "pricing"],
    owner: "上架草稿",
    primaryAction: "查看定价诊断",
    description: "计算采购成本、运费、佣金、售价、原价、最低价和利润风险。",
    diagnostic: "重点看佣金来源、运费等级、利润率、最低价是否安全。",
  },
  {
    key: "preflight_check",
    label: "提交前校验",
    view: "workflow-console",
    nodePatterns: ["preflight_check", "validate_payload"],
    owner: "节点诊断",
    primaryAction: "打开预检结果",
    description: "提交 Ozon 前检查 payload、变体、图片、价格、必填属性和重复 SKU。",
    diagnostic: "这是总闸；失败时必须按字段定位修复，不允许绕过。",
  },
  {
    key: "submit_ozon",
    label: "提交 Ozon",
    view: "workflow-console",
    nodePatterns: ["ozon_submit", "submit_ozon"],
    owner: "节点诊断",
    primaryAction: "查看提交闸口",
    description: "只有预检通过并人工确认后，才允许提交到 Ozon Seller API。",
    diagnostic: "重点看是否有人工确认、task_id 是否返回、是否被安全闸拦截。",
  },
  {
    key: "review_feedback",
    label: "审核回馈",
    view: "workflow-console",
    nodePatterns: ["review_reconcile", "review_feedback"],
    owner: "节点诊断",
    primaryAction: "处理审核回馈",
    description: "回查 Ozon 审核结果，把错误字段、警告、变体合并问题转成修复任务。",
    diagnostic: "重点看错误码、字段路径、SKU 组、是否需要换货源或重新提交。",
  },
];
const ERP_AUTOMATION_GUARDRAILS = [
  {
    title: "Ozon 提交必须人工确认",
    rule: "任何触发 /v3/product/import 的动作都必须带 confirmSubmit，并且先通过 payload 校验。",
    node: "ozon_submit",
    evidence: "confirmSubmit + submit-payload-draft",
    view: "workflow-console",
  },
  {
    title: "定价风险不能静默跳过",
    rule: "低利润、最低价、佣金来源不明或阻塞型 PRICING 风险只能重新计算或人工接受。",
    node: "match_profit",
    evidence: "pricing-risk/recalculate + pricing-risk/accept",
    view: "workflow-console",
  },
  {
    title: "预检失败不能继续提交",
    rule: "preflight_check 发现重复 offer、缺少型号属性或变体组合冲突时，必须回草稿修字段。",
    node: "preflight_check",
    evidence: "validateSubmitPayload",
    view: "listing",
  },
  {
    title: "浏览器人机验证只允许暂停恢复",
    rule: "1688/Ozon 页面遇到人机验证时，自动化只能标记 waiting_human，人工通过后再恢复。",
    node: "crawler_1688",
    evidence: "waiting_human + manual-fix-retry",
    view: "sourcing",
  },
  {
    title: "库存写入等待审核成功",
    rule: "Ozon 审核失败或变体组合失败时，不自动写库存，先进入审核回馈和修复草稿。",
    node: "stock_sync",
    evidence: "review_reconcile + stock queue",
    view: "workflow-console",
  },
];

const LISTING_CENTER_STAGES = [
  {
    key: "current-product",
    label: "当前商品",
    owner: "上架中心",
    status: "先确定当前处理对象",
    body: "只展示一个当前商品的状态、卡点和下一步，避免历史流水抢占主界面。",
    checks: ["是否已采集 1688 商品", "是否有当前 workflow", "是否有 payload 草稿"],
    action: "看当前商品",
    view: "listing",
  },
  {
    key: "collect-parse",
    label: "采集解析",
    owner: "选品采购",
    status: "从 1688 商品事实开始",
    body: "采集标题、图片、SKU、尺重、颜色和规格；解析失败先回采集箱修数据。",
    checks: ["人机验证是否暂停", "SKU 是否可区分", "尺重是否完整"],
    action: "打开采集",
    view: "sourcing",
  },
  {
    key: "match-sourcing",
    label: "匹配选品",
    owner: "选品采购",
    status: "判断是否值得上架",
    body: "把 1688 候选和 Ozon 参照、利润机会、同品风险放在同一判断层。",
    checks: ["是否同品", "是否重复", "是否有替代货源"],
    action: "看选品",
    view: "research",
  },
  {
    key: "pricing-profit",
    label: "定价利润",
    owner: "财务利润",
    status: "成本、运费、佣金先算清",
    body: "售价、原价、最低价和利润率必须在提交前形成可解释口径。",
    checks: ["采购成本", "物流等级", "最低价/利润风险"],
    action: "算价格",
    view: "listing",
  },
  {
    key: "content-images",
    label: "内容图片",
    owner: "上架中心",
    status: "文案和图片服务于当前商品",
    body: "俄文标题、描述、属性、轮播图、参考指导和生图任务都归到当前商品。",
    checks: ["标题是否自然", "图片是否干净", "属性是否覆盖必填"],
    action: "编辑内容",
    view: "listing",
  },
  {
    key: "preflight-submit",
    label: "预检提交",
    owner: "安全闸",
    status: "预检通过才允许人工确认",
    body: "payload 必须先校验；真实提交 Ozon 仍然需要人工确认，不能自动越过。",
    checks: ["payload 校验", "重复 offer", "人工确认"],
    action: "打开预检",
    view: "workflow-console",
  },
  {
    key: "review-feedback",
    label: "审核回执",
    owner: "商品中心",
    status: "提交后看 Ozon 回执",
    body: "task_id、product_id、审核状态、警告和错误原因进入审核回执区。",
    checks: ["task_id", "审核失败原因", "商品状态回写"],
    action: "看回执",
    view: "workflow-console",
  },
  {
    key: "failure-repair",
    label: "失败修复",
    owner: "工作流诊断",
    status: "失败必须归因再重试",
    body: "字段缺失、变体合并、图片违规、价格阻塞和换货源都从这里分流。",
    checks: ["错误码", "字段定位", "修复后重试"],
    action: "修复失败",
    view: "workflow-console",
  },
];

const $ = (selector) => document.querySelector(selector);
const on = (selector, event, handler) => {
  const el = $(selector);
  if (!el) return false;
  el.addEventListener(event, handler);
  return true;
};

function obsSetContext(extra = {}) {
  if (!window.Sentry) return;
  try {
    window.Sentry.setContext("erp", Object.assign({
      storeId: $("#storeSelect")?.value || "",
      activeView: document.querySelector(".view.active")?.id || "",
      taskId: $("#listingTaskId")?.value || "",
    }, extra));
  } catch {}
}

function obsTrack(eventName, payload = {}) {
  try {
    window.__ERP_OBS__?.track?.(eventName, payload);
    window.Sentry?.addBreadcrumb?.({
      category: "biz",
      level: "info",
      message: eventName,
      data: payload,
    });
  } catch {}
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.dataset.label ||= button.textContent;
  button.textContent = busy ? "处理中..." : button.dataset.label;
}

function toast(message, type = "ok") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast show ${type}`;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    el.className = "toast";
  }, 3200);
}

async function copyWorkflowText(text = "") {
  const value = String(text || "");
  if (!value) throw new Error("没有可复制的内容");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("复制失败");
}

function showResponse(data) {
  $("#lastResponse").textContent = JSON.stringify(data, null, 2);
}

function updateDataFreshness(selector, stateName, message) {
  const element = $(selector);
  if (!element) return;
  element.dataset.syncState = stateName;
  element.textContent = message;
}

function renderAppBootstrapRecovery(error = {}) {
  const target = $("#appBootstrapRecovery");
  if (!target) return;
  const status = Number(error?.httpStatus || error?.responseData?.status || 0);
  const title = status === 401
    ? "ERP 会话未授权"
    : status === 403
      ? "当前会话没有店铺访问权限"
      : "ERP 数据初始化失败";
  const nextAction = status === 401
    ? "请重新登录 ERP 会话；如果仍失败，请让管理员确认当前用户已绑定店铺。"
    : status === 403
      ? "请切换到已授权店铺，或联系管理员补充当前用户的店铺权限。"
      : "请检查 ERP 服务是否运行，然后点击“重新加载”再次读取；本次没有执行任何 Ozon 写入。";
  target.hidden = false;
  target.innerHTML = `<strong>${escapeHtml(title)}</strong><p>店铺和工作台尚未完成初始化，旧数据不会被当作当前店铺证据。</p><p>下一步：${escapeHtml(nextAction)}</p><button class="ghost" type="button" data-bootstrap-retry>重新加载</button>`;
  target.querySelector("[data-bootstrap-retry]")?.addEventListener("click", () => window.location.reload());
  updateDataFreshness("#erpDataFreshness", "error", "工作台未初始化；请先完成授权或重新加载。");
}

function synchronizedAt(label) {
  return `${label}：${new Date().toLocaleString("zh-CN", { hour12: false })}`;
}

async function api(path, options = {}) {
  const directWriteKey = String(options.headers?.["Idempotency-Key"] || "");
  const readEnvironment = typeof currentSellerReadEnvironment === "function" ? currentSellerReadEnvironment() : "";
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(readEnvironment ? { "X-Ozon-ERP-Read-Environment": readEnvironment } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "请求失败");
    // Keep the structured seller recovery contract available to the caller;
    // generic Error.message alone would discard captureReview.nextAction.
    error.responseData = data;
    error.httpStatus = response.status;
    error.reasonCode = String(data.reasonCode || "");
    error.commandState = String(data.commandState || "");
    error.idempotencyKey = String(data.idempotencyKey || directWriteKey);
    if (error.reasonCode === "DIRECT_WRITE_UNKNOWN_OUTCOME" && error.idempotencyKey) {
      const entry = Object.entries(state.directWriteKeysByScope).find(([, value]) => value?.key === error.idempotencyKey);
      if (entry) state.directWriteKeysByScope[entry[0]] = { ...entry[1], status: "unknown_outcome" };
      loadWriteCommandAttention().catch(() => {});
    } else if (directWriteKey) {
      const entry = Object.entries(state.directWriteKeysByScope).find(([, value]) => value?.key === directWriteKey);
      if (entry) delete state.directWriteKeysByScope[entry[0]];
    }
    throw error;
  }
  if (directWriteKey) {
    const entry = Object.entries(state.directWriteKeysByScope).find(([, value]) => value?.key === directWriteKey);
    if (entry) delete state.directWriteKeysByScope[entry[0]];
  }
  return data;
}

function sellerReadAccessRecovery(error = {}, fallback = "检查店铺只读权限后重新读取。") {
  const code = String(error?.reasonCode || error?.responseData?.reasonCode || "").toUpperCase();
  if ([
    "READ_OPERATOR_SESSION_REQUIRED",
    "READ_OPERATOR_SIGNED_SESSION_REQUIRED",
    "SESSION_PROOF_SIGNED_SESSION_REQUIRED",
  ].includes(code)) {
    return "请先在系统配置建立签名 ERP 会话，再重新读取；本次没有调用 Ozon。";
  }
  if (code === "READ_OPERATOR_SESSION_ENVIRONMENT_MISMATCH") {
    return "当前只读环境与签名会话不一致；改为会话对应的环境后重新读取。";
  }
  if (["READ_OPERATOR_SESSION_SCOPE_REQUIRED", "READ_OPERATOR_SCOPE_REQUIRED"].includes(code)) {
    return "当前签名会话没有覆盖所选店铺或读取范围；请让管理员补充店铺范围后重试。";
  }
  if (Number(error?.httpStatus || 0) === 403) return fallback;
  return fallback;
}

function selectedStoreId() {
  return $("#storeSelect").value;
}

function toUtcIsoFromLocal(value) {
  if (!value) return "";
  return new Date(value).toISOString();
}

async function loadStores() {
  const data = await api("/api/stores");
  state.stores = data.stores;
  $("#storeCount").textContent = data.stores.length;
  if ($("#erpStoreCount")) $("#erpStoreCount").textContent = data.stores.length;
  $("#storeSelect").innerHTML = data.stores
    .map((store) => `<option value="${store.id}">${store.name} - ${store.clientId}</option>`)
    .join("");
  if ($("#captureStoreSelect")) {
    $("#captureStoreSelect").innerHTML = data.stores
      .map((store) => `<option value="${store.id}">${store.name} - ${store.clientId}</option>`)
      .join("");
  }
  state.selectedStoreId = data.stores[0]?.id || "";
  if ($("#captureStoreSelect")) $("#captureStoreSelect").value = state.selectedStoreId;
  updateStoreHint();
}

function updateStoreHint() {
  const store = state.stores.find((item) => item.id === selectedStoreId());
  $("#storeHint").textContent = store
    ? `Client ID: ${store.clientId} · Seller API 凭据已配置，尚未验证连通（密钥不会显示在浏览器）`
    : "未找到店铺";
  syncListingStore();
}

function directWriteRequest(payload, scope = "ozon-write") {
  const retained = state.directWriteKeysByScope[scope];
  if (retained?.status === "unknown_outcome") {
    const error = new Error("该写操作结果未知，原幂等键已保留；请先到待复核区只读回查，不能换新键重试。");
    error.reasonCode = "DIRECT_WRITE_UNKNOWN_OUTCOME";
    throw error;
  }
  if (retained?.status === "pending") {
    return {
      headers: { "Idempotency-Key": retained.key },
      body: JSON.stringify({ ...payload, confirmDirectWrite: true }),
    };
  }
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const key = `${scope}:${nonce}`;
  state.directWriteKeysByScope[scope] = { key, status: "pending" };
  return {
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({ ...payload, confirmDirectWrite: true }),
  };
}

function apiAlignmentClass(status = "") {
  if (status === "已对齐") return "aligned";
  if (status === "部分对齐") return "partial";
  return "local";
}

function apiGapPriorityClass(priority = "") {
  if (priority === "P0") return "p0";
  if (priority === "P1") return "p1";
  return "p2";
}

function renderErpArchitectureMap() {
  const map = $("#erpArchitectureMap");
  if (!map) return;
  map.innerHTML = ERP_INFORMATION_ARCHITECTURE.map((item, index) => `
    <article class="architecture-card">
      <div class="architecture-card-index">0${index + 1}</div>
      <div>
        <strong>${escapeHtml(item.area)}</strong>
        <p>${escapeHtml(item.purpose)}</p>
        <small>入口：${escapeHtml(item.entry)}</small>
        <div class="architecture-actions">
          ${item.actions.map((action) => `<span>${escapeHtml(action)}</span>`).join("")}
        </div>
      </div>
    </article>
  `).join("");
}

function renderSellerOperatingModel() {
  const grid = $("#sellerOperatingModelGrid");
  if (!grid) return;
  grid.innerHTML = SELLER_OPERATING_MODEL.map((item, index) => `
    <article class="seller-operation-card">
      <div class="seller-operation-index">${String(index + 1).padStart(2, "0")}</div>
      <div>
        <strong>${escapeHtml(item.area)}</strong>
        <p><b>系统自动做：</b>${escapeHtml(item.system)}</p>
        <p><b>你只需要决定：</b>${escapeHtml(item.decision)}</p>
        <small>${escapeHtml(item.result)}</small>
        <button class="ghost" type="button" data-cockpit-view="${escapeHtml(item.view)}">进入处理</button>
      </div>
    </article>
  `).join("");
}

function canonicalCurrentCaptureWorkflowRun() {
  const captureTask = currentCaptureSellerTask();
  if (!captureTask?.item) return null;
  const captureId = String(captureTask.item.id || "").trim();
  const storeId = String(captureTask.item.storeId || "").trim();
  return (state.workflowRuns || [])
    .filter((run) => !isSyntheticWorkflowRun(run))
    .find((run) => String(run?.entity?.candidateId || "").trim() === captureId
      && String(run?.entity?.storeId || "").trim() === storeId) || null;
}

function currentListingWorkflowRun() {
  const captureTask = currentCaptureSellerTask();
  if (captureTask?.item) return canonicalCurrentCaptureWorkflowRun();
  return null;
}

function workflowCanActForCurrentProduct(run = null) {
  if (!run || isSyntheticWorkflowRun(run)) return false;
  const captureTask = currentCaptureSellerTask();
  if (!captureTask?.item) return false;
  return captureTask.reviewApproved === true
    && String(run?.entity?.candidateId || "").trim() === String(captureTask.item.id || "").trim()
    && String(run?.entity?.storeId || "").trim() === String(captureTask.item.storeId || "").trim();
}

function currentListingAutoListJob(run = null) {
  const jobs = Array.isArray(state.autoListJobs) ? state.autoListJobs : [];
  const linkedJobId = String(run?.entity?.autoListingJobId || run?.autoListingJobId || "").trim();
  if (linkedJobId) return jobs.find((job) => String(job.id || "") === linkedJobId) || { id: linkedJobId };
  if (run) return null;
  return [...jobs].sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))[0] || null;
}

function sellerEvidenceVerification(evidence = {}) {
  if (evidence.failed === true) return { level: "failed", label: "读取失败", explanation: "本次没有形成可用只读证据。" };
  if (evidence.partial === true) return { level: "partial", label: "部分证据", explanation: "只读响应不完整，不能据此推进后续动作。" };
  if (evidence.liveReadObserved === true || String(evidence.verificationLevel || "") === "server_observed") {
    return { level: "server_observed", label: "服务端已观察真实只读响应", explanation: "仅证明服务端收到只读响应，不代表业务状态已安全。" };
  }
  if (String(evidence.verificationLevel || "") === "configuration_declared") {
    return { level: "configuration_declared", label: "配置已声明", explanation: "仅证明配置或计划已声明，尚无真实账号读取证明。" };
  }
  return { level: "locally_tested", label: "本地测试", explanation: "本地契约已验证，尚无真实账号读取证明。" };
}

function productSellerResultFromRead(data = {}, evidence = {}) {
  const supplied = data?.sellerResult && typeof data.sellerResult === "object"
    ? data.sellerResult
    : {};
  const readStatus = String(supplied.status || supplied.readStatus || evidence.readStatus || "unknown");
  const failed = supplied.failed === true || readStatus === "error" || readStatus === "failed";
  const partial = supplied.partial === true || readStatus === "partial" || evidence.partial === true;
  const status = failed ? "error" : partial ? "partial" : readStatus === "empty" ? "empty" : readStatus === "completed" || readStatus === "complete" ? "complete" : "unknown";
  const labels = {
    error: "商品读取失败",
    partial: "商品证据不完整",
    empty: "当前读取页没有商品",
    unknown: "商品读取结果未知",
    complete: "商品只读结果已形成",
  };
  return {
    ...supplied,
    status,
    statusLabel: String(supplied.statusLabel || labels[status]),
    reason: String(supplied.reason || supplied.summary || (status === "complete" ? "当前批商品列表和详情可供查看。" : "当前结果不能代表完整店铺商品状态。")),
    nextAction: String(supplied.nextAction || evidence.nextAction || "重新读取商品并确认证据范围。"),
    sideEffect: String(supplied.sideEffect || evidence.sideEffect || "仅读取商品列表和详情；不会修改商品、价格或库存。"),
    sellerTasks: Array.isArray(supplied.sellerTasks)
      ? supplied.sellerTasks
      : (Array.isArray(evidence.sellerTasks) ? evidence.sellerTasks : []),
    evidenceAt: String(supplied.evidenceAt || evidence.checkedAt || "尚无证据时间"),
    partial,
    failed,
    liveReadObserved: supplied.liveReadObserved === true || evidence.operationEvidence?.some((item) => item?.verificationLevel === "server_observed") === true,
    coverageComplete: supplied.coverageComplete === true || (status === "complete" && evidence.hasNext !== true),
  };
}

function renderProductSellerResult() {
  const container = $("#productSellerResult");
  if (!container) return;
  const result = state.productSellerResult || productSellerResultFromRead();
  const status = String(result.status || "unknown");
  const verification = sellerEvidenceVerification({
    failed: result.failed === true || status === "error",
    partial: result.partial === true || status === "partial" || status === "unknown" || status === "empty",
    liveReadObserved: result.liveReadObserved === true,
  });
  const scope = Number(result.loadedProductCount ?? state.productRows.length);
  const detailCount = Number(result.detailProductCount ?? 0);
  const counts = result.counts && typeof result.counts === "object" ? result.counts : {};
  const statusBreakdown = [
    ["在售", counts.selling],
    ["待修", counts.needFix],
    ["错误", counts.error],
    ["审核/待处理", counts.ready],
  ].filter(([, count]) => Number(count || 0) > 0).map(([label, count]) => `${label} ${Number(count)}`).join(" · ");
  container.innerHTML = `
    <div class="product-read-seller-result ${escapeHtml(status)}" data-product-seller-status="${escapeHtml(status)}">
      <div><strong>${escapeHtml(result.statusLabel || "商品读取结果未知")}</strong><small>证据时间：${escapeHtml(result.evidenceAt || "尚无证据时间")}</small></div>
      <p><b>当前判断：</b>${escapeHtml(result.reason || "当前结果不能代表完整店铺商品状态。")}</p>
      <div class="seller-evidence-verification" data-level="${escapeHtml(verification.level)}">
        <span>验证等级：${escapeHtml(verification.label)}</span>
        <span>已加载商品：${escapeHtml(String(scope))}${detailCount ? ` · 详情 ${escapeHtml(String(detailCount))}` : ""}${statusBreakdown ? ` · ${escapeHtml(statusBreakdown)}` : ""}</span>
        <small>${escapeHtml(verification.explanation)} 不代表商品可售，也不代表库存已写入。</small>
      </div>
      <p><b>安全下一步：</b>${escapeHtml(result.nextAction || "重新读取商品并确认证据范围。")}</p>
      ${Array.isArray(result.sellerTasks) && result.sellerTasks.length ? `<ul class="seller-task-list product-seller-task-list">${result.sellerTasks.slice(0, 4).map((task) => `<li data-task-code="${escapeHtml(task.code || "")}" data-task-priority="${escapeHtml(task.priority || "normal")}"><strong>${escapeHtml(task.label || "需人工处理")}</strong>${Number(task.count || 0) > 1 ? `（${Number(task.count)} 个）` : ""}：${escapeHtml(task.nextAction || "请重新读取商品详情")}</li>`).join("")}</ul>` : ""}
      <small>${escapeHtml(result.sideEffect || "仅读取商品列表和详情；不会修改商品、价格或库存。")}</small>
    </div>
  `;
}

function renderListingProductReadiness(job = null) {
  const jobId = String(job?.id || "").trim();
  const result = jobId ? state.productReadinessByJobId[jobId] : null;
  const sellerView = result?.sellerView || null;
  const offers = Array.isArray(sellerView?.offers) ? sellerView.offers : [];
  const allRepairTasks = Array.isArray(sellerView?.repairTasks) ? sellerView.repairTasks : [];
  const repairTasks = allRepairTasks.slice(0, 100);
  const repairTasksTruncated = allRepairTasks.length > repairTasks.length;
  const verification = sellerEvidenceVerification({
    failed: result?.failed === true,
    partial: result?.partial === true,
    liveReadObserved: result?.liveReadObserved === true,
    verificationLevel: result?.verificationLevel,
  });
  const readinessClaim = sellerView?.statusLabel === "已明确可售";
  const statusLabel = result?.loading
    ? "正在只读回查"
    : readinessClaim && verification.level !== "server_observed"
      ? "本地就绪判断，待服务端回查"
      : sellerView?.statusLabel || (result?.failed ? "状态读取失败" : "尚未回查");
  const evidenceAt = sellerView?.evidenceAt || result?.evidenceAt || "尚无证据时间";
  const reason = sellerView?.reason || result?.reason || (jobId ? "点击后只读取 Ozon 商品状态。" : "当前商品尚未关联自动上架任务，无法回查。");
  const nextAction = sellerView?.nextAction || result?.nextAction || (jobId ? "执行只读回查，确认审核状态。" : "先生成或选择当前商品任务。");
  const scopeText = result?.storeId
    ? `店铺 ${result.storeId} · ${offers.length ? `${offers.length} 个 Offer` : `任务 ${jobId}`}`
    : (jobId ? `任务 ${jobId}` : "尚未绑定范围");
  const receiptEligible = Boolean(jobId && result?.failed !== true && result?.partial !== true
    && result?.evidenceSummary?.readStatus === "completed"
    && result?.evidenceSummary?.coverageComplete !== false
    && Number(result?.evidenceSummary?.requestedOfferCount || 0) > 0);
  const operationEvidenceCount = Array.isArray(result?.evidenceSummary?.operationEvidence) ? result.evidenceSummary.operationEvidence.length : 0;
  const readinessCheckedAt = Date.parse(String(sellerView?.evidenceAt || result?.evidenceAt || ""));
  const readinessFresh = Number.isFinite(readinessCheckedAt)
    && readinessCheckedAt <= Date.now()
    && Date.now() - readinessCheckedAt <= 30 * 60 * 1000;
  const stockReady = readinessClaim && verification.level === "server_observed" && readinessFresh && offers.length > 0;
  const stockReadyAction = stockReady
    ? `<button class="primary" type="button" data-stock-readiness-ready="true" data-stock-readiness-fresh="true" data-stock-readiness-status="ready_for_sale" data-stock-readiness-verification="server_observed" data-stock-readiness-offers="${escapeHtml(offers.map((offer) => String(offer.offerId || "")).filter(Boolean).join(","))}" data-stock-readiness-store-id="${escapeHtml(String(result?.storeId || job?.storeId || ""))}">进入库存核对</button>`
    : "";
  return `
    <section class="listing-product-readiness ${result?.failed ? "is-failed" : sellerView?.statusLabel === "已明确可售" ? "is-ready" : ""}" aria-label="商品状态只读证据">
      <div>
        <span>商品状态回查</span>
        <strong>${escapeHtml(statusLabel)}</strong>
        <small>证据时间：${escapeHtml(evidenceAt)}</small>
      </div>
      <p><b>原因：</b>${escapeHtml(reason)}</p>
      <div class="seller-evidence-verification" data-level="${escapeHtml(verification.level)}">
        <span>验证等级：${escapeHtml(verification.label)}</span>
        <span>证据范围：${escapeHtml(scopeText)}</span>
        <small>${escapeHtml(verification.explanation)} 不代表商品可售，也不代表库存已写入。</small>
      </div>
      <p><b>安全下一步：</b>${escapeHtml(nextAction)}</p>
      ${stockReadyAction ? `<div class="listing-product-readiness-stock-next"><strong>商品已明确可售</strong><p>下一步只读取这些 Offer 对应的仓库和当前库存；不会自动写入。</p>${stockReadyAction}</div>` : ""}
      <small>本次回查记录 ${operationEvidenceCount} 个只读接口证据${result?.evidenceSummary?.readStatus === "partial" ? "；存在接口失败或 Offer 覆盖不完整" : ""}；仅用于审计，不代表商品可售。</small>
      ${offers.length ? `
        <details>
          <summary>逐 Offer 状态（${offers.length}）</summary>
          <div class="listing-product-readiness-offers">
            ${offers.map((offer) => `<span><b>${escapeHtml(offer.offerId || "-")}</b> · 商品 ${escapeHtml(offer.productId || "-")} · 导入 ${escapeHtml(offer.importStatus || "unknown")} · 审核 ${escapeHtml(offer.moderationStatus || "unknown")} · 错误 ${Number(offer.errorCount || 0)}${offer.errorReasonCode ? ` · 原因 ${escapeHtml(offer.errorReasonCode)}` : ""}</span>`).join("")}
          </div>
        </details>
      ` : ""}
      ${repairTasks.length ? `
        <details class="listing-product-repair-tasks" open>
          <summary>审核修复任务（${repairTasks.length}${repairTasksTruncated ? "+" : ""}）</summary>
          <div class="listing-product-repair-task-list">
            ${repairTasks.map((task) => `<div class="seller-task-row"><b>${escapeHtml(task.code || "MODERATION_FAILED")}</b> · 任务 ${escapeHtml(task.taskId || "-")} · 商品 ${escapeHtml(task.productId || "-")} · Offer ${escapeHtml(task.offerId || "-")}<br><small>字段：${escapeHtml(task.fieldPath || "products[*]")} · ${escapeHtml(task.message || "需要人工确认")}</small><br><span>下一步：${escapeHtml(task.action || "修复本地草稿后重新预检")}</span></div>`).join("")}
          </div>
        </details>
      ` : ""}
      <label>读取环境
        <input type="text" data-product-readiness-environment value="${escapeHtml(result?.environment || "")}" placeholder="例如：production-readonly" />
      </label>
      <button class="ghost" type="button" data-product-readiness-job-id="${escapeHtml(jobId)}" ${!jobId || result?.loading ? "disabled" : ""}>只读回查商品状态</button>
      <div class="readiness-evidence-receipt" data-readiness-receipt-eligible="${receiptEligible ? "true" : "false"}">
        <strong>保存本地只读证据回执</strong>
        <label>环境名
          <input type="text" list="readinessReceiptEnvironmentOptions" data-readiness-receipt-environment placeholder="例如：production-readonly" ${receiptEligible ? "" : "disabled"} />
          <datalist id="readinessReceiptEnvironmentOptions"><option value="local-dev-readonly"></option><option value="staging-readonly"></option><option value="production-readonly"></option></datalist>
        </label>
        <label><input type="checkbox" data-readiness-receipt-confirm ${receiptEligible ? "" : "disabled"} /> 我确认保存当前环境的一次只读证据回执</label>
        <button type="button" class="ghost" data-save-readiness-evidence-receipt data-job-id="${escapeHtml(jobId)}" data-store-id="${escapeHtml(result?.storeId || "")}" disabled>保存本次只读回执</button>
        <small>${receiptEligible ? "服务端会重新执行受限只读回查并仅保存脱敏摘要。" : "需先完成包含列表和详情的完整只读回查，失败或部分证据不能保存。"} 不会写 Ozon、不会修改草稿。</small>
        <p class="readiness-evidence-receipt-response" aria-live="polite"></p>
      </div>
      <small>只读操作：不修改草稿、不写 Ozon、不自动进入库存。</small>
    </section>
  `;
}

function updateReadinessReceiptControl(container) {
  if (!container) return;
  const environment = container.querySelector("[data-readiness-receipt-environment]")?.value.trim() || "";
  const confirmed = container.querySelector("[data-readiness-receipt-confirm]")?.checked === true;
  const button = container.querySelector("[data-save-readiness-evidence-receipt]");
  if (button) button.disabled = container.dataset.readinessReceiptEligible !== "true" || !environment || !confirmed;
}

async function saveReadinessEvidenceReceipt(button) {
  const container = button.closest(".readiness-evidence-receipt");
  const response = container?.querySelector(".readiness-evidence-receipt-response");
  const environment = container?.querySelector("[data-readiness-receipt-environment]")?.value.trim() || "";
  const storeId = button.dataset.storeId || "";
  setBusy(button, true);
  try {
    const operatorPlan = {
      store: { id: storeId },
      environment,
      scope: { name: "single_auto_listing_job", offerCount: 1 },
      endpoints: ["/v3/product/list", "/v3/product/info/list"],
      readOnly: true,
      writeAttempted: false,
      confirm: "I_CONFIRM_READ_ONLY",
      maxAgeMs: 24 * 60 * 60 * 1000,
    };
    const planGate = await api("/api/ozon-learning/readiness-evidence-receipts/plan", {
      method: "POST",
      body: JSON.stringify({ plan: operatorPlan }),
    });
    if (!planGate?.ok || !planGate.planBinding) throw new Error("READ_OPERATOR_PLAN_BINDING_REQUIRED");
    const data = await api("/api/ozon-learning/readiness-evidence-receipts", {
      method: "POST",
      body: JSON.stringify({ recordEvidence: true, environment, jobId: button.dataset.jobId, operatorPlan, planBinding: planGate.planBinding }),
    });
    if (response) {
      const receipt = data.receipt || {};
      const endpoints = Array.isArray(receipt.endpointAttempts) ? receipt.endpointAttempts : [];
      const failure = String(receipt.failureScenario || "").trim();
      const sellerTask = data.sellerTask || {};
      response.textContent = `回执已保存 · ${escapeHtml(sellerTask.title || "只读证据已记录")} · ${escapeHtml(sellerTask.nextAction || "请查看证据范围后继续")} · 验证等级 ${escapeHtml(data.verification?.verificationLevel || "locally_tested")} · 证据时间 ${escapeHtml(receipt.checkedAt || "未返回")} · 端点 ${endpoints.length} 个${failure ? ` · 失败场景 ${escapeHtml(failure)}` : ""}。${escapeHtml(sellerTask.sideEffect || "不会写入 Ozon")}`;
    }
  } catch {
    if (response) response.textContent = "只读回执保存未完成，请检查环境名和只读连接后重试。";
  } finally {
    setBusy(button, false);
    updateReadinessReceiptControl(container);
  }
}

async function loadListingProductReadiness(jobId) {
  if (!jobId) return;
  const requestToken = (state.productReadinessRequestToken = Number(state.productReadinessRequestToken || 0) + 1);
  const requestStoreId = String(selectedStoreId() || "").trim();
  const environmentInput = document.querySelector("[data-product-readiness-environment]");
  const environmentCheck = validateReadOperatorEnvironment(environmentInput?.value || "");
  if (!environmentCheck.ok) {
    state.productReadinessByJobId[jobId] = {
      failed: true,
      evidenceAt: new Date().toISOString(),
      reason: environmentCheck.message,
      nextAction: "填写当前 ERP 部署的环境名后再执行只读回查；不会联网。",
      reasonCode: environmentCheck.reasonCode,
      environment: environmentInput?.value?.trim() || "",
    };
    renderListingSellerTaskSummary();
    return;
  }
  const environment = environmentCheck.environment;
  if (!requestStoreId) {
    state.productReadinessByJobId[jobId] = {
      failed: true,
      evidenceAt: new Date().toISOString(),
      reason: "当前没有选择商品所属店铺，系统不会使用无店铺范围的审核回执。",
      nextAction: "先选择商品所属店铺，再重新回查商品状态。",
      reasonCode: "READ_OPERATOR_STORE_SCOPE_REQUIRED",
      environment,
    };
    renderListingSellerTaskSummary();
    return;
  }
  state.productReadinessByJobId[jobId] = { loading: true };
  renderListingSellerTaskSummary();
  try {
    const result = await api(`/api/ozon-learning/auto-list-jobs/${encodeURIComponent(jobId)}/product-readiness?environment=${encodeURIComponent(environment)}`);
    if (requestToken !== state.productReadinessRequestToken
      || String(selectedStoreId() || "").trim() !== requestStoreId
      || String(currentSellerReadEnvironment() || "").trim() !== environment) {
      return;
    }
    const resultStoreId = String(result?.storeId || "").trim();
    const resultEnvironment = String(result?.environment || "").trim();
    if (!resultStoreId || resultStoreId !== requestStoreId || resultEnvironment !== environment) {
      state.productReadinessByJobId[jobId] = {
        failed: true,
        evidenceAt: new Date().toISOString(),
        reason: "商品状态回执的店铺或环境与当前操作不一致，系统没有使用这份回执。",
        nextAction: "确认当前店铺和读取环境后重新回查；不会使用跨店铺或跨环境的迟到回执。",
        reasonCode: "READINESS_RECEIPT_SCOPE_MISMATCH",
        environment,
        storeId: resultStoreId,
      };
      renderListingSellerTaskSummary();
      return;
    }
    result.environment = environment;
    state.productReadinessByJobId[jobId] = result;
  } catch (error) {
    if (requestToken !== state.productReadinessRequestToken
      || String(selectedStoreId() || "").trim() !== requestStoreId
      || String(currentSellerReadEnvironment() || "").trim() !== environment) {
      return;
    }
    const httpStatus = Number(error?.httpStatus || 0);
    const accessDenied = httpStatus === 401 || httpStatus === 403;
    const serverFailure = httpStatus >= 500;
    state.productReadinessByJobId[jobId] = {
      failed: true,
      httpStatus,
      evidenceAt: new Date().toISOString(),
      reason: accessDenied
        ? "当前会话或店铺权限不足，系统没有获得商品状态证据。"
        : serverFailure
          ? "ERP 服务暂时无法完成商品状态回查，系统没有使用旧状态替代本次结果。"
          : "本次只读回查未完成，系统没有获得可用于判断商品状态的证据。",
      nextAction: accessDenied
        ? "重新建立 ERP 会话并检查店铺 Seller API 权限后再回查。"
        : serverFailure
          ? "稍后重试；若持续失败，检查服务日志和店铺只读连接。"
          : "检查店铺只读 API 配置后重试；失败不会把商品改为可售。",
      environment,
    };
  }
  renderListingSellerTaskSummary();
}

const LISTING_SELLER_SUMMARY_STATUS_LABELS = {
  no_product: "尚未开始",
  waiting_human: "等待你确认",
  reviewing: "Ozon 审核中",
  review_failed: "审核未通过",
  submission_needs_review: "提交结果待复核",
  sale_pending_stock: "可售，待确认库存",
  sale_ready: "商品已上架，库存已就绪",
  listing_progress: "上架准备中",
};

function listingSellerTaskSummaryModel(run = null, context = {}) {
  const nodes = Array.isArray(run?.nodes) ? run.nodes : [];
  const task = run?.summary?.currentProductTask || null;
  const reviewNode = nodes.find((node) => node.key === "review_reconcile") || null;
  const handoffNode = nodes.find((node) => node.key === "candidate_handoff") || null;
  const stockNode = nodes.find((node) => node.key === "stock_sync") || null;
  const sourceEvidence = run?.sourceEvidence || run?.source?.sourceEvidence || context.sourceEvidence || null;
  const procurementEvidence = run?.source?.procurementEvidence || context.procurementEvidence || null;
  const mediaAssets = run?.source?.mediaAssets || context.mediaAssets || [];
  const mediaIssues = Array.isArray(context.mediaIssues)
    ? context.mediaIssues.filter(Boolean).map(String)
    : (Array.isArray(run?.source?.mediaIssues) ? run.source.mediaIssues.filter(Boolean).map(String) : []);
  const mediaBlocked = mediaIssues.length > 0;
  const contentNode = nodes.find((node) => ["content_generation", "content_review"].includes(node.key));
  const contentEvidence = run?.contentEvidence || contentNode?.output?.contentEvidence || null;
  const contentSellerResult = run?.contentSellerResult || contentNode?.output?.sellerResult || null;
  const pricingNode = nodes.find((node) => node.key === "match_profit") || null;
  const pricingDiagnosis = run?.pricingDiagnosis || pricingNode?.output?.pricingDiagnosis || null;
  const pricingDiagnosisResult = pricingNode?.output?.diagnosis || null;
  const title = task?.productTitle || run?.source?.title || run?.payloadDraft?.items?.[0]?.name || context.title || "";
  const skuCount = Array.isArray(run?.payloadDraft?.items) && run.payloadDraft.items.length
    ? run.payloadDraft.items.length
    : Number(sourceEvidence?.fields?.variants?.count || context.skuCount || 0);
  const validation = run?.payloadDraftValidation || null;
  const validationIssues = Array.isArray(validation?.issues) ? validation.issues.length : 0;
  const firstPayloadItem = run?.payloadDraft?.items?.[0] || null;
  const category = run?.categoryMatch || run?.source?.categoryMatch || context.categoryMatch || firstPayloadItem || null;
  const categoryReady = Number(category?.description_category_id || 0) > 0 && Number(category?.type_id || 0) > 0;
  const categoryText = categoryReady
    ? String(category.path || `${category.description_category_id} / ${category.type_id}`)
    : "尚未确认 Ozon 类目";
  const attributeIssueCount = Array.isArray(validation?.issues)
    ? validation.issues.filter((issue) => /ATTRIBUTE|属性|CATEGORY/i.test(String(issue?.code || issue?.message || ""))).length
    : 0;
  const attributeText = !categoryReady
    ? "先确认类目后检查必填属性"
    : !validation
      ? "尚未运行属性预检"
      : attributeIssueCount
        ? `属性待修复（${attributeIssueCount} 项）`
        : "属性预检未发现阻塞";
  const contentStatus = contentSellerResult?.status || contentEvidence?.status || "needs_review";
  const contentText = contentStatus === "blocked"
    ? "俄文内容被来源事实阻塞"
    : contentStatus === "reviewed"
      ? "俄文内容已人工复核"
      : "俄文内容待人工核对";
  const packageInfo = pricingDiagnosis?.package || run?.source?.sizeWeight || context.sizeWeight || {};
  const packageReady = [packageInfo.weightG, packageInfo.lengthMm, packageInfo.widthMm, packageInfo.heightMm]
    .every((value) => Number(value || 0) > 0);
  const packageText = packageReady
    ? `包装 ${packageInfo.weightG}g / ${packageInfo.lengthMm}×${packageInfo.widthMm}×${packageInfo.heightMm}mm`
    : "包装尺重证据待补齐";
  const pricingBlocked = pricingNode?.status === "waiting_human"
    || [pricingDiagnosisResult?.reasonCode, pricingDiagnosis?.reasonCode].some((code) => String(code || "").startsWith("PRICING_"));
  const pricingProfitStatus = String(pricingDiagnosis?.profitStatus || "unknown");
  const pricingText = !pricingDiagnosis
    ? "尚未生成定价诊断"
    : pricingBlocked
      ? `定价风险阻塞${pricingDiagnosisResult?.messageZh ? `：${pricingDiagnosisResult.messageZh}` : ""}`
      : pricingDiagnosis.priceCny
        ? pricingProfitStatus === "observed"
          ? `售价 ${pricingDiagnosis.priceCny} CNY；利润 ${pricingDiagnosis.profit || "待确认"}`
          : pricingProfitStatus === "estimate"
            ? `售价 ${pricingDiagnosis.priceCny} CNY；利润估算 ${pricingDiagnosis.profit || "待确认"}`
            : `售价 ${pricingDiagnosis.priceCny} CNY；利润未知（佣金/结算证据不足）`
        : "定价结果待人工核对";
  // Keep the seller-facing chain explicit: source/draft evidence can exist
  // while preflight has not run yet.  Without this field the summary only
  // showed the generic “上架准备中”, which made a passed/blocked preflight
  // indistinguishable from an unfinished draft.
  const preflightStatus = !run?.payloadDraft
    ? "尚未生成 Payload 草稿"
    : !validation
      ? "尚未预检"
      : validation.ok
        ? "预检通过，等待人工确认"
        : `预检阻塞（${validationIssues} 项）`;
  const preflightNextStep = !run?.payloadDraft
    ? "先补齐来源、类目和商品字段"
    : !validation
      ? "运行本地预检；不会提交 Ozon"
      : validation.ok
        ? "检查媒体、价格和库存证据，再确认提交"
        : "按字段和 SKU 修复问题后重新预检";
  const reviewFailed = reviewNode && (["failed", "waiting_human"].includes(String(reviewNode.status || ""))
    || Number(reviewNode.output?.errorCount || 0) > 0
    || Number(reviewNode.output?.listingDefectCount || 0) > 0);
  const reviewSucceeded = String(reviewNode?.status || "") === "success";
  const submitted = nodes.some((node) => node.key === "ozon_submit" && ["success", "completed"].includes(String(node.status || "")));
  const submissionNeedsReview = String(run?.submissionReservation?.state || "").trim() === "needs_review";
  const stockSucceeded = ["success", "completed"].includes(String(stockNode?.status || ""));
  // currentProductTask is normalized by the workflow summary layer and may
  // use either the legacy seller label (`waiting`) or the canonical workflow
  // state (`waiting_human`/`needs_confirmation`). Treat all three as the same
  // seller gate so the primary action never falls back to generic draft work.
  const waitingHuman = run?.status === "waiting_human"
    || run?.locks?.waitingHuman === true
    || ["waiting", "waiting_human", "needs_confirmation"].includes(String(task?.status || ""));

  let stateName = "listing_progress";
  if (!run && !title) stateName = "no_product";
  else if (reviewFailed) stateName = "review_failed";
  else if (submissionNeedsReview) stateName = "submission_needs_review";
  else if (reviewSucceeded && !stockSucceeded) stateName = "sale_pending_stock";
  else if (submitted && !reviewSucceeded) stateName = "reviewing";
  else if (waitingHuman) stateName = "waiting_human";
  else if (reviewSucceeded && stockSucceeded) stateName = "sale_ready";

  const actions = {
    no_product: { label: "去采集商品", view: "sourcing", effect: "打开采集页；不会创建或提交 Ozon 商品。" },
    waiting_human: { label: "处理待确认项", view: task?.view || "listing", nodeKey: task?.nodeKey || "preflight_check", effect: "打开待确认项；确认前不会自动提交 Ozon。" },
    reviewing: { label: "查看审核进度", view: "workflow-console", nodeKey: "review_reconcile", effect: "打开审核进度；只查看 Ozon 回执，不会重复提交。" },
    review_failed: { label: "修复审核问题", view: "workflow-console", nodeKey: "review_reconcile", effect: "打开审核问题和字段定位；修复后仍需重新预检与确认。" },
    submission_needs_review: { label: "回查提交结果", view: "workflow-console", nodeKey: "review_reconcile", effect: "打开提交结果和 task_id 回查；不会重复提交或自动重试。" },
    sale_pending_stock: { label: "检查库存就绪", view: "warehouse", nodeKey: "stock_sync", effect: "打开库存页核对仓库和数量；不会自动写入库存。" },
    sale_ready: { label: "查看商品运营", view: "products", nodeKey: "stock_sync", effect: "打开已上架商品状态；不会进入订单履约或执行写入。" },
    listing_progress: { label: "继续完善商品", view: "listing", nodeKey: task?.nodeKey || "preflight_check", effect: "打开当前商品草稿；修改只保存在草稿，提交仍需预检和人工确认。" },
  };
  // The primary seller action follows the first business blocker in the
  // golden path. It only routes the user to a repair/review surface; it
  // never performs an Ozon write by itself.
  let action = actions[stateName];
  if (stateName === "listing_progress") {
    const missingSourceDomains = Array.isArray(sourceEvidence?.missingDomains)
      ? sourceEvidence.missingDomains.length
      : 0;
    const sourceReady = Boolean(
      sourceEvidence?.snapshotHash
      && sourceEvidence?.verificationState === "ok"
      && missingSourceDomains === 0,
    );
    if (!sourceReady) {
      action = {
        label: "补齐来源证据",
        view: "sourcing",
        nodeKey: "candidate_parse",
        effect: "打开来源采集与证据修复；不会提交 Ozon。",
      };
    } else if (!categoryReady) {
      action = {
        label: "确认 Ozon 类目",
        view: "listing",
        nodeKey: "category_match",
        effect: "打开类目匹配与必填属性；不会提交 Ozon。",
      };
    } else if (contentStatus === "blocked") {
      action = {
        label: "核对俄文内容",
        view: "listing",
        nodeKey: "content_generation",
        effect: "打开俄文内容和来源事实冲突；不会提交 Ozon。",
      };
    } else if (mediaBlocked) {
      action = {
        label: "处理媒体审查",
        view: "listing",
        nodeKey: "content_review",
        effect: "打开媒体审查并处理图片风险；不会上传媒体或提交 Ozon。",
      };
    } else if (!packageReady && (pricingDiagnosis || run?.payloadDraft)) {
      action = {
        label: "补齐包装尺重",
        view: "listing",
        nodeKey: "match_profit",
        effect: "打开包装尺重证据修复；不会提交 Ozon。",
      };
    } else if (pricingBlocked) {
      action = {
        label: "修复定价风险",
        view: "listing",
        nodeKey: "match_profit",
        effect: "打开采购、运费和利润诊断；不会提交 Ozon。",
      };
    } else if (run?.payloadDraft && !validation) {
      action = {
        label: "运行提交前预检",
        view: "listing",
        nodeKey: "preflight_check",
        effect: "运行本地预检；不会提交 Ozon。",
      };
    } else if (run?.payloadDraft && validation && !validation.ok) {
      action = {
        label: "回到草稿修复并重新预检",
        view: "listing",
        nodeKey: "preflight_check",
        effect: "回到当前本地草稿修复问题；修复后重新预检，仍不会提交 Ozon。",
      };
    } else if (run?.payloadDraft && validation?.ok) {
      // A passed preflight is a seller gate, not generic "continue editing".
      // Route the primary action to the confirmation surface so the seller
      // can see the exact payload/hash confirmation and side effect before
      // any Ozon write. The click itself remains read-only.
      action = {
        label: "进入人工确认提交",
        view: "workflow-console",
        nodeKey: "ozon_submit",
        effect: "打开提交确认和草稿 hash；再次确认前不会调用 Ozon。",
      };
    }
  }
  const sourceText = sourceEvidence?.verificationState === "waiting_human"
    ? "来源页面等待人工验证"
    : sourceEvidence?.snapshotHash && sourceEvidence?.verificationState === "ok"
      ? "1688 页面证据已验证"
      : sourceEvidence?.snapshotHash
        ? "1688 页面证据已记录，待人工验证"
      : (run?.source?.url || title)
        ? "已有商品来源，页面证据待补齐"
        : "来源证据未绑定";
  const procurementText = procurementEvidence?.moq?.source && procurementEvidence.moq.source !== "missing"
    ? `MOQ ${String(procurementEvidence.moq.value || "已记录")}；阶梯价 ${Number(procurementEvidence.priceTiers?.values?.length || 0)} 档`
    : "采购 MOQ/阶梯价证据待补齐";
  const mediaList = Array.isArray(mediaAssets) ? mediaAssets : [];
  const approvedMediaCount = mediaList.filter((asset) => asset?.checks?.humanApproved === true).length;
  const mediaText = mediaList.length
    ? `${mediaList.length} 个媒体候选，人工批准 ${approvedMediaCount} 个`
    : "媒体候选证据待补齐";
  const defaultReasons = {
    no_product: "还没有当前商品，无法开始 Ozon 上架检查。",
    waiting_human: "当前步骤需要人工确认，系统不会自动越过。",
    reviewing: "商品已提交，正在等待 Ozon 审核回执。",
    review_failed: "Ozon 审核返回阻塞问题，需要按商品字段修复。",
    submission_needs_review: "上一次提交结果未知，需要先按 task_id 回查，不能重复提交。",
    sale_pending_stock: "审核已通过，确认仓库和库存后才能形成可售闭环。",
    sale_ready: "商品审核和库存证据均已完成；后续进入商品运营，不自动进入 FBS 履约。",
    listing_progress: validationIssues
      ? `预检仍有 ${validationIssues} 个问题需要处理。`
      : handoffNode
        ? "1688 候选已进入草稿，但还没有可提交 Payload；先补俄文内容、类目、采购成本和媒体资料。"
        : "商品仍在上架准备阶段。",
  };
  return {
    state: stateName,
    status: LISTING_SELLER_SUMMARY_STATUS_LABELS[stateName],
    title: title || "还没有当前商品",
    sourceText,
    categoryText,
    attributeText,
    contentText,
    packageText,
    pricingText,
    procurementText,
    mediaText,
    preflightStatus,
    preflightNextStep,
    validationIssueCount: validationIssues,
    skuCount,
    stage: task?.blockedAt || task?.stage || (stateName === "no_product" ? "选择货源" : "上架准备"),
    reason: task?.reason || reviewNode?.reason || defaultReasons[stateName],
    reviewStatus: reviewFailed ? "审核失败" : submissionNeedsReview ? "提交结果待复核" : reviewSucceeded ? "审核通过" : submitted ? "审核中" : "尚未提交",
    stockStatus: stockSucceeded ? "库存已就绪" : reviewSucceeded ? "待确认库存" : "等待审核后处理",
    action,
    runId: run?.id || "",
  };
}

// Keep the compact upload-queue card truthful to the same seller summary as
// the detailed task panel.  The old HTML always said "确认上传", even when
// there was no draft or the first blocker was source/category evidence.  A
// seller must see the current gate and the first safe action, not an upload
// affordance that cannot actually proceed.
function renderListingUploadQueueSummary(summary = {}, run = null) {
  const draft = document.querySelector("#listingCurrentDraftStatus");
  const readiness = document.querySelector("#listingUploadReadiness");
  const repairs = document.querySelector("#listingMinimalRepairCount");
  const next = document.querySelector("#listingUploadNextAction");
  if (!draft || !readiness || !repairs || !next) return;
  draft.textContent = run?.payloadDraft
    ? "草稿已绑定"
    : summary.state === "no_product"
      ? "未绑定商品"
      : "待生成草稿";
  const firstAction = state.listingHandoffNotice || summary.action?.label || "查看当前商品任务";
  const actionIsListing = summary.action?.view === "listing";
  readiness.textContent = summary.state === "no_product"
    ? "未开始"
    : summary.state === "waiting_human"
      ? "等待人工确认"
      : summary.state === "sale_ready"
        ? "库存已就绪"
      : summary.preflightStatus?.includes("阻塞")
        ? "预检阻塞"
        : !actionIsListing && summary.state === "listing_progress"
          ? "资料待补齐"
          : summary.preflightStatus?.includes("通过")
            ? "预检通过，待确认"
            : "待预检";
  repairs.textContent = run
    ? summary.validationIssueCount > 0
      ? `${summary.validationIssueCount} 项`
      : summary.preflightStatus === "尚未预检"
        ? "待预检"
        : "0 项"
    : "-";
  next.textContent = firstAction;
}

// Translate local media checks into the seller's decision language.  The
// collector/preflight keeps the machine evidence in checks.*; this helper is
// intentionally read-only and never starts OCR, downloads an image, uploads
// media, or calls Ozon.
function mediaSellerRiskItems(asset = {}) {
  const checks = asset?.checks && typeof asset.checks === "object" ? asset.checks : {};
  const risks = [];
  const ocr = checks.ocr && typeof checks.ocr === "object" ? checks.ocr : {};
  const ocrStatus = String(ocr.status || "unknown").toLowerCase();
  const hasOcrRisk = ocrStatus === "blocked" || ocr.hasChinese === true || ocr.isFactoryIntro === true || ocr.hasOzonPolicyText === true;
  if (hasOcrRisk) {
    const reasons = [];
    if (ocr.hasChinese === true) reasons.push("检测到中文文字");
    if (ocr.isFactoryIntro === true) reasons.push("包含工厂/供应商介绍");
    if (ocr.hasOzonPolicyText === true) reasons.push("包含平台政策文字");
    risks.push({ code: "MEDIA_OCR_RISK", label: "图片文字需要处理", reason: `${reasons.join("、") || "OCR 标记为风险"}，不能直接用于 Ozon 商品媒体。`, next: "翻译并清理文字，或更换无风险图片，然后重新检查。", sideEffect: "当前只记录本地风险，不会上传图片或写入 Ozon。" });
  } else if (ocrStatus !== "clear") {
    risks.push({ code: "MEDIA_OCR_UNKNOWN", label: "图片文字尚未确认", reason: "还没有可核对的 OCR 结果，不能判断图片是否含违规文字。", next: "先完成人工看图或 OCR 检查，再决定保留、清理或换图。", sideEffect: "在检查完成前，富内容和提交仍保持锁定。" });
  }
  const sourceRisk = String(checks.sourceRisk?.status || checks.sourceRisk || "unknown").toLowerCase();
  if (sourceRisk === "blocked") {
    risks.push({ code: "MEDIA_SOURCE_RISK", label: "图片来源有风险", reason: "来源可能涉及版权或平台使用风险，不能把当前图片当作可发布素材。", next: "换用有来源证据的图片，并重新绑定当前 1688 快照。", sideEffect: "不会删除 1688 原始采集，只会阻止这张图片进入批准草稿。" });
  } else if (sourceRisk !== "clear") {
    risks.push({ code: "MEDIA_SOURCE_RISK_UNKNOWN", label: "图片来源尚未确认", reason: "缺少可核对的版权/来源判断，当前素材不应直接批准。", next: "核对来源证据或重新采集图片，再重新检查。", sideEffect: "当前只显示待核验状态，不会上传或写入 Ozon。" });
  }
  const dimensions = checks.dimensions && typeof checks.dimensions === "object" ? checks.dimensions : {};
  const dimensionsStatus = String(dimensions.status || "unknown").toLowerCase();
  if (dimensionsStatus === "blocked" || Number(dimensions.width) <= 0 || Number(dimensions.height) <= 0) {
    risks.push({ code: "MEDIA_DIMENSIONS_INVALID", label: "图片尺寸不可用", reason: "图片尺寸无效，无法作为稳定的商品媒体。", next: "替换或重新获取原图，再重新检查像素尺寸。", sideEffect: "不会修改原图，也不会自动生成新图片。" });
  } else if (dimensionsStatus !== "clear") {
    risks.push({ code: "MEDIA_DIMENSIONS_UNKNOWN", label: "图片尺寸尚未确认", reason: "还没有可信的像素尺寸证据。", next: "查看原图尺寸或重新采集后再检查。", sideEffect: "尺寸确认前不会把它当作可提交媒体。" });
  }
  if (!/^https?:\/\/[^\s]+$/i.test(String(asset.sourceUrl || "").trim())) {
    risks.push({ code: "MEDIA_SOURCE_URL_INVALID", label: "媒体来源链接无效", reason: "当前图片没有可追溯的来源链接。", next: "回到 1688 采集并保存来源链接。", sideEffect: "不会从不明来源补图或猜测来源。" });
  }
  const sourceHash = String(asset.sourceHash || "").trim();
  if (!sourceHash) {
    risks.push({ code: "MEDIA_SOURCE_HASH_MISSING", label: "缺少图片来源指纹", reason: "当前图片没有 URL 哈希，无法核对是否被替换。", next: "重新采集并保存媒体来源指纹。", sideEffect: "不会把没有指纹的图片标记为已批准。" });
  } else if (!/^(?:(?:sha256|url-sha256):)?[a-f0-9]{64}$/i.test(sourceHash)) {
    risks.push({ code: "MEDIA_SOURCE_HASH_INVALID", label: "图片来源指纹无效", reason: "当前来源指纹格式不正确，无法核对图片是否被替换。", next: "重新采集并生成来源指纹。", sideEffect: "不会用无效指纹放行媒体批准。" });
  }
  if (!/^snapshot:[a-f0-9]{64}$/i.test(String(asset.evidenceRef || "").trim())) {
    risks.push({ code: "MEDIA_EVIDENCE_REF_INVALID", label: "缺少当前 1688 快照", reason: "图片没有绑定当前商品的页面快照证据。", next: "刷新 1688 采集结果，并重新绑定当前草稿。", sideEffect: "不会复用旧商品或其他店铺的媒体批准。" });
  }
  return risks;
}

function mediaIssueSellerDetail(issue = "") {
  const code = String(issue || "").trim();
  const map = {
    detail_images_require_human_review_before_rich_content: { label: "详情图待人工审查", reason: "详情图还没有逐张确认，不能直接放入富内容。", next: "进入人工看图，选择要保留的详情图。", sideEffect: "只保存本地批准草稿，不会上传或写入 Ozon。" },
    collected_rich_content_requires_human_approval: { label: "富内容待人工确认", reason: "采集到的富内容尚未得到人工批准。", next: "逐项核对图片和内容后保存批准草稿。", sideEffect: "确认前不会把富内容带入提交 Payload。" },
    blocked_sensitive: { label: "合规敏感项阻断", reason: "该素材关联合规敏感信息，系统不能猜测或自动放行。", next: "核对真实来源和平台要求，必要时更换素材。", sideEffect: "不会自动填写敏感字段，也不会提交 Ozon。" },
  };
  return map[code] || { label: code || "媒体问题", reason: "媒体候选存在未解决问题。", next: "处理问题后重新进行媒体合规检查。", sideEffect: "当前只保留本地草稿，不会执行 Ozon 写入。" };
}

function renderListingMediaReview(mediaAssets = [], mediaIssues = [], approvalContext = {}) {
  const assets = Array.isArray(mediaAssets) ? mediaAssets : [];
  const issues = Array.isArray(mediaIssues) ? mediaIssues.filter(Boolean).map(String) : [];
  const roleGroups = [
    { key: "main", label: "主图" },
    { key: "variant", label: "SKU 图" },
    { key: "detail", label: "详情图" },
  ];
  const unapprovedCount = assets.filter((asset) => asset?.checks?.humanApproved !== true).length;
  const sellerRiskItems = assets.flatMap((asset) => mediaSellerRiskItems(asset).map((risk) => ({ ...risk, assetId: asset?.id || "" })));
  const issueRiskItems = issues.map((issue) => ({ ...mediaIssueSellerDetail(issue), code: issue, assetId: "" }));
  const blockers = [...issueRiskItems.map((item) => item.reason), ...sellerRiskItems.map((item) => item.reason)];
  if (unapprovedCount) blockers.push(`${unapprovedCount} 个媒体候选尚未确认`);
  const run = approvalContext.run || null;
  const expectedDraftHash = String(run?.payloadDraftHash || "").trim();
  const expectedSourceHash = String(approvalContext.sourceEvidence?.snapshotHash || "").trim();
  const waitingHuman = run?.status === "waiting_human" || run?.locks?.waitingHuman === true;
  const baseEligible = Boolean(run?.id && expectedDraftHash && expectedSourceHash && waitingHuman && assets.length);
  const approvalDraft = run?.mediaApprovalDraft || null;
  const draftSaveEligible = baseEligible && !["approved_draft", "published_local"].includes(approvalDraft?.status);
  const draftSaveHint = approvalDraft?.status === "approved_draft"
    ? "已有批准草稿，不能重复保存第一阶段；请核对后进入第二阶段。"
    : approvalDraft?.status === "published_local"
      ? "本地媒体批准已发布，不能重新保存为草稿。"
      : draftSaveEligible
        ? "选择至少一个候选、填写操作者并勾选明确确认后才能保存。"
        : "当前不可保存：需要等待人工状态、当前 Payload hash、1688 来源快照 hash 和媒体候选。";
  const candidateApprovalDraft = approvalContext.candidateApprovalDraft || null;
  const approvalAssetIds = Array.isArray(approvalDraft?.assetIds) ? [...new Set(approvalDraft.assetIds.map(String))].sort() : [];
  const currentAssetIds = new Set(assets.map((asset) => String(asset?.id || "")));
  const candidateAssetIds = Array.isArray(candidateApprovalDraft?.assetIds) ? [...new Set(candidateApprovalDraft.assetIds.map(String))].sort() : [];
  const publishEligible = Boolean(
    baseEligible
    && approvalDraft?.status === "approved_draft"
    && candidateApprovalDraft?.status === "approved_draft"
    && approvalDraft.expectedDraftHash === expectedDraftHash
    && approvalDraft.expectedSourceHash === expectedSourceHash
    && candidateApprovalDraft.expectedDraftHash === expectedDraftHash
    && candidateApprovalDraft.expectedSourceHash === expectedSourceHash
    && approvalAssetIds.length
    && approvalAssetIds.every((id) => currentAssetIds.has(id))
    && approvalAssetIds.join("|") === candidateAssetIds.join("|")
  );
  return `
    <section class="listing-media-review" aria-label="媒体候选只读审查">
      <div class="listing-media-review-head">
        <div>
          <span>媒体审查工作台</span>
          <strong>${assets.length} 个候选 · ${unapprovedCount ? `${unapprovedCount} 个待确认` : "均已有确认记录"}</strong>
        </div>
        <small>当前只能审查；未经确认不进入 rich content。${run?.id && unapprovedCount && !waitingHuman ? `<button class="small-blue" type="button" data-request-media-review data-media-review-run-id="${escapeHtml(run.id)}">进入人工看图</button>` : ""}</small>
      </div>
      <div class="listing-media-review-groups">
        ${roleGroups.map((group) => {
          const items = assets.filter((asset) => asset?.role === group.key);
          const approvedCount = items.filter((asset) => asset?.checks?.humanApproved === true).length;
          return `
            <article>
              <span>${group.label}</span>
              <strong>候选 ${items.length} · 已确认 ${approvedCount}</strong>
              <small>${items.length ? `待确认 ${items.length - approvedCount}` : "暂无候选"}</small>
              ${items.length ? `
                <details>
                  <summary>查看证据引用</summary>
                  <div class="listing-media-review-evidence">
                    ${items.map((asset) => `
                      <label>
                        <input type="checkbox" data-media-approval-asset-id="${escapeHtml(asset.id || "")}" ${draftSaveEligible ? "" : "disabled"} />
                        <b>${escapeHtml(asset.id || "未编号")}${asset.sourceSkuId ? ` · SKU ${escapeHtml(asset.sourceSkuId)}` : ""}</b>
                        <small>批准状态：${asset?.checks?.humanApproved === true ? "已有确认记录" : "未确认"}</small>
                        ${mediaSellerRiskItems(asset).length ? `<ul class="listing-media-risk-list">${mediaSellerRiskItems(asset).map((risk) => `<li><b>${escapeHtml(risk.label)}</b><span>原因：${escapeHtml(risk.reason)}</span><span>下一步：${escapeHtml(risk.next)}</span><small>不会发生：${escapeHtml(risk.sideEffect)}</small></li>`).join("")}</ul>` : `<small class="listing-media-clear">媒体检查已通过；仍需人工确认后才能进入批准草稿。</small>`}
                        <code>${escapeHtml(asset.evidenceRef || "无页面快照引用")}</code>
                        <code>${escapeHtml(asset.sourceHash || "无 URL 哈希")}</code>
                      </label>
                    `).join("")}
                  </div>
                </details>
              ` : ""}
            </article>
          `;
        }).join("")}
      </div>
      <p><b>阻断原因：</b>${escapeHtml(blockers.join("；") || "当前媒体证据无已知阻断；是否可提交仍以预检和人工确认为准。")}</p>
      ${(issueRiskItems.length || sellerRiskItems.length) ? `<div class="listing-media-risk-summary"><strong>处理建议</strong>${[...issueRiskItems, ...sellerRiskItems].map((risk) => `<p><b>${escapeHtml(risk.label)}</b>：${escapeHtml(risk.next)} <small>不会发生：${escapeHtml(risk.sideEffect)}</small></p>`).join("")}</div>` : ""}
      <div class="listing-media-approval-draft" data-media-approval-eligible="${draftSaveEligible ? "true" : "false"}">
        <strong>本地批准草稿</strong>
        <label>操作者（本机审计标识、未验证身份） <input type="text" maxlength="128" data-media-approval-actor placeholder="填写本机审计标识" ${draftSaveEligible ? "" : "disabled"} /></label>
        <label><input type="checkbox" data-media-approval-confirm ${draftSaveEligible ? "" : "disabled"} /> 我已逐项审查所选媒体，并确认只保存本地批准草稿</label>
        <button class="primary" type="button" data-save-media-approval-draft data-media-approval-run-id="${escapeHtml(run?.id || "")}" data-expected-draft-hash="${escapeHtml(expectedDraftHash)}" data-expected-source-hash="${escapeHtml(expectedSourceHash)}" disabled>保存批准草稿（仅本地）</button>
        <small>${draftSaveHint}</small>
        ${approvalDraft ? `<p class="media-approval-draft-status ${approvalDraft.status === "stale" ? "is-stale" : ""}">${approvalDraft.status === "stale" ? "批准草稿已陈旧：Payload 或来源证据发生变化，请重新审查。" : `当前草稿状态：${escapeHtml(approvalDraft.status || "unknown")} · 操作者 ${escapeHtml(approvalDraft.actorId || "未记录")} · ${escapeHtml(approvalDraft.confirmedAt || "时间未记录")}`}</p>` : ""}
        <p class="media-approval-draft-response" aria-live="polite"></p>
      </div>
      ${approvalDraft?.status === "published_local" ? `
        <div class="listing-media-approval-published">
          <strong>本地媒体批准已发布</strong>
          <span>详情媒体齐全：${approvalDraft.richContentDetailAssetsApproved === true ? "是" : "否，rich content 仍不能放行"}</span>
          <small>不上传、不写 Ozon；提交仍锁定，后续仍需预检和人工确认。</small>
          <button class="small-blue" type="button" data-request-preflight-recheck data-preflight-recheck-run-id="${escapeHtml(run?.id || "")}">重新运行商品预检</button>
          <p>点击后只重新计算当前本地草稿的阻塞项，不会提交 Ozon。</p>
        </div>
      ` : `
        <div class="listing-media-approval-publish" data-media-publish-eligible="${publishEligible ? "true" : "false"}" data-media-publish-original-actor="${escapeHtml(approvalDraft?.actorId || "")}">
          <strong>第二阶段：发布本地媒体批准</strong>
          <label>发布操作者（本机审计标识、未验证身份） <input type="text" maxlength="128" data-media-approval-publish-actor value="${escapeHtml(approvalDraft?.actorId || "")}" ${publishEligible ? "" : "disabled"} /></label>
          <label><input type="checkbox" data-media-approval-publish-confirm ${publishEligible ? "" : "disabled"} /> 我确认发布当前本地批准绑定</label>
          <label><input type="checkbox" data-media-approval-reconfirm-actor ${publishEligible ? "" : "disabled"} /> 若更换操作者，我再次确认身份标识变化</label>
          <button class="primary" type="button" data-publish-media-approval data-media-approval-run-id="${escapeHtml(run?.id || "")}" data-expected-draft-hash="${escapeHtml(expectedDraftHash)}" data-expected-source-hash="${escapeHtml(expectedSourceHash)}" data-media-approval-asset-ids="${escapeHtml(approvalAssetIds.join(","))}" disabled>发布本地媒体批准</button>
          <small>${publishEligible ? "勾选发布确认后可继续；更换操作者还必须再次确认。" : "当前批准草稿、hash、assetIds 或关联任务已变化，请先刷新并重新审查。"}</small>
          <p class="media-approval-publish-response" aria-live="polite"></p>
        </div>
      `}
      <small>保存只记录本地审查草稿；没有发布媒体，也没有写入 Ozon。</small>
    </section>
  `;
}

function updateMediaApprovalDraftControl(container) {
  if (!container) return;
  const review = container.closest(".listing-media-review") || container;
  const button = container.querySelector("[data-save-media-approval-draft]");
  const selected = review.querySelectorAll("[data-media-approval-asset-id]:checked");
  const actor = container.querySelector("[data-media-approval-actor]")?.value.trim() || "";
  const confirmed = container.querySelector("[data-media-approval-confirm]")?.checked === true;
  if (button) button.disabled = container.dataset.mediaApprovalEligible !== "true" || !selected.length || !actor || !confirmed;
}

function updateMediaApprovalPublishControl(container) {
  if (!container) return;
  const button = container.querySelector("[data-publish-media-approval]");
  const actor = container.querySelector("[data-media-approval-publish-actor]")?.value.trim() || "";
  const publishConfirmed = container.querySelector("[data-media-approval-publish-confirm]")?.checked === true;
  const actorChanged = actor !== String(container.dataset.mediaPublishOriginalActor || "");
  const reconfirmed = container.querySelector("[data-media-approval-reconfirm-actor]")?.checked === true;
  if (button) button.disabled = container.dataset.mediaPublishEligible !== "true" || !actor || !publishConfirmed || (actorChanged && !reconfirmed);
}

function mediaApprovalSellerError(reasonCode = "") {
  const messages = {
    MEDIA_APPROVAL_DRAFT_HASH_MISMATCH: "Payload 草稿已变化，请刷新当前商品并重新审查媒体。",
    MEDIA_APPROVAL_SOURCE_HASH_MISMATCH: "1688 来源证据已变化，请刷新当前商品并重新审查媒体。",
    MEDIA_APPROVAL_WAITING_HUMAN_REQUIRED: "当前任务不在等待人工状态，不能保存批准草稿。",
    MEDIA_APPROVAL_CONFIRMATION_REQUIRED: "请填写本机审计标识并完成明确确认。",
    MEDIA_APPROVAL_ASSET_IDS_INVALID: "请选择当前商品的至少一个媒体候选。",
    MEDIA_APPROVAL_ASSET_NOT_FOUND: "所选媒体不属于当前商品，请刷新后重新选择。",
    MEDIA_APPROVAL_ASSET_SOURCE_MISMATCH: "所选媒体与当前来源快照不一致，请刷新后重新审查。",
    MEDIA_APPROVAL_PUBLISH_CONFIRMATION_REQUIRED: "请明确确认发布当前本地媒体批准。",
    MEDIA_APPROVAL_ACTOR_MISMATCH: "发布操作者与批准草稿不同；更换操作者需要再次确认。",
    MEDIA_APPROVAL_ASSET_SET_MISMATCH: "当前媒体集合与批准草稿不一致，请刷新并重新审查。",
    MEDIA_APPROVAL_DRAFT_STALE: "批准草稿已陈旧，请刷新当前商品并重新创建批准草稿。",
    MEDIA_APPROVAL_ROLLBACK_FAILED: "本地媒体批准状态需要人工复核，请停止继续操作并刷新。",
  };
  return messages[reasonCode] || "保存未完成，请刷新当前商品后重试。";
}

async function publishMediaApproval(button) {
  const container = button.closest(".listing-media-approval-publish");
  const response = container?.querySelector(".media-approval-publish-response");
  const runId = String(button.dataset.mediaApprovalRunId || "");
  const actorId = container.querySelector("[data-media-approval-publish-actor]")?.value.trim() || "";
  const reconfirmActorChange = container.querySelector("[data-media-approval-reconfirm-actor]")?.checked === true;
  const assetIds = String(button.dataset.mediaApprovalAssetIds || "").split(",").filter(Boolean);
  setBusy(button, true);
  try {
    const result = await api(`/api/workflows/${encodeURIComponent(runId)}/media-approval-draft/publish`, {
      method: "POST",
      body: JSON.stringify({
        publishConfirmed: true,
        actorId,
        reconfirmActorChange,
        assetIds,
        expectedDraftHash: button.dataset.expectedDraftHash,
        expectedSourceHash: button.dataset.expectedSourceHash,
      }),
    });
    if (response) response.textContent = result.richContentDetailAssetsApproved
      ? "本地批准已发布，详情媒体齐全；不上传、不写 Ozon，提交仍锁定。"
      : "本地批准已发布，但详情媒体不齐全；不上传、不写 Ozon，提交仍锁定。";
    await loadWorkflowRuns();
    await loadAutoListJobs();
  } catch (error) {
    if (response) response.textContent = mediaApprovalSellerError(error.reasonCode);
  } finally {
    setBusy(button, false);
    updateMediaApprovalPublishControl(container);
  }
}

async function saveMediaApprovalDraft(button) {
  const container = button.closest(".listing-media-approval-draft");
  const review = container?.closest(".listing-media-review") || container;
  const response = container?.querySelector(".media-approval-draft-response");
  const runId = String(button.dataset.mediaApprovalRunId || "");
  const assetIds = [...review.querySelectorAll("[data-media-approval-asset-id]:checked")].map((input) => input.dataset.mediaApprovalAssetId);
  const actorId = container.querySelector("[data-media-approval-actor]")?.value.trim() || "";
  setBusy(button, true);
  try {
    const result = await api(`/api/workflows/${encodeURIComponent(runId)}/media-approval-draft`, {
      method: "POST",
      body: JSON.stringify({
        assetIds,
        actorId,
        confirmed: true,
        expectedDraftHash: button.dataset.expectedDraftHash,
        expectedSourceHash: button.dataset.expectedSourceHash,
      }),
    });
    if (response) {
      response.className = `media-approval-draft-response ${result.status === "stale" ? "is-stale" : "is-saved"}`;
      response.textContent = result.status === "stale"
        ? "批准草稿已陈旧：请刷新当前商品并重新审查。"
        : "本地批准草稿已保存；没有发布媒体，也没有写入 Ozon。";
    }
    try {
      await loadWorkflowRuns();
      await loadAutoListJobs();
    } catch {
      if (response) {
        response.className = "media-approval-draft-response is-stale";
        response.textContent = "本地批准草稿已保存，但页面刷新失败；请手动刷新后查看真实草稿状态。";
      }
    }
  } catch (error) {
    if (response) {
      response.className = "media-approval-draft-response is-stale";
      response.textContent = mediaApprovalSellerError(error.reasonCode);
    }
  } finally {
    setBusy(button, false);
    updateMediaApprovalDraftControl(container);
  }
}

function renderListingSellerTaskSummary() {
  const body = $("#listingSellerTaskSummaryBody");
  if (!body) return;
  const panel = $("#listingSellerTaskSummary");
  const run = currentListingWorkflowRun();
  const captureTask = currentCaptureSellerTask();
  renderCurrentProductWorkspace();
  if (!run || captureTask?.reviewApproved !== true) {
    if (panel) panel.hidden = true;
    body.innerHTML = "";
    return;
  }
  if (panel) panel.hidden = false;
  const autoListJob = currentListingAutoListJob(run);
  const linkedCandidate = autoListJob?.candidateData || null;
  const mediaAssets = run
    ? (linkedCandidate?.mediaAssets || run.source?.mediaAssets || [])
    : (state.collected1688?.mediaAssets || state.currentCaptureDraft?.mediaAssets || []);
  const mediaIssues = run
    ? (linkedCandidate?.mediaIssues || run.source?.mediaIssues || [])
    : (state.collected1688?.mediaIssues || state.currentCaptureDraft?.mediaIssues || []);
  const summary = listingSellerTaskSummaryModel(run, {
    title: state.collected1688?.title || state.currentCaptureDraft?.title || "",
    sourceEvidence: state.collected1688?.sourceEvidence || state.currentCaptureDraft?.sourceEvidence || null,
    procurementEvidence: state.collected1688?.procurementEvidence || state.currentCaptureDraft?.procurementEvidence || null,
    mediaAssets: state.collected1688?.mediaAssets || state.currentCaptureDraft?.mediaAssets || [],
    mediaIssues,
    skuCount: state.collected1688?.skuVariants?.length || state.currentCaptureDraft?.skuVariants?.length || 0,
  });
  renderListingUploadQueueSummary(summary, run);
  body.innerHTML = `
    <article><span>当前商品</span><strong>${escapeHtml(summary.title)}</strong><small>${escapeHtml(summary.status)}</small></article>
    <article><span>来源证据</span><strong>${escapeHtml(summary.sourceText)}</strong><small>SKU ${escapeHtml(summary.skuCount || "-")} 个</small></article>
    <article><span>Ozon 类目</span><strong>${escapeHtml(summary.categoryText)}</strong><small>${escapeHtml(summary.categoryText === "尚未确认 Ozon 类目" ? "需从当前类目缓存中选择有效 type" : "类目/type 已绑定当前草稿")}</small></article>
    <article><span>必填属性</span><strong>${escapeHtml(summary.attributeText)}</strong><small>字典值和敏感属性仍需按字段确认</small></article>
     <article><span>俄文内容</span><strong>${escapeHtml(summary.contentText)}</strong><small>模型建议不能替代来源事实或人工确认</small></article>
     <article><span>采购证据</span><strong>${escapeHtml(summary.procurementText)}</strong><small>展示价不能替代真实采购阶梯价</small></article>
     <article><span>包装尺重</span><strong>${escapeHtml(summary.packageText)}</strong><small>缺少可信尺重时不能确认运费和利润</small></article>
     <article><span>定价与利润</span><strong>${escapeHtml(summary.pricingText)}</strong><small>风险状态不会绕过预检或人工确认</small></article>
     <article><span>媒体候选</span><strong>${escapeHtml(summary.mediaText)}</strong><small>未经人工批准不能作为可提交富内容</small></article>
    <article><span>提交前预检</span><strong>${escapeHtml(summary.preflightStatus)}</strong><small>${escapeHtml(summary.preflightNextStep)}</small></article>
    <article><span>当前阶段</span><strong>${escapeHtml(summary.stage)}</strong><small>${escapeHtml(summary.reason)}</small></article>
    <article><span>审核状态</span><strong>${escapeHtml(summary.reviewStatus)}</strong><small>库存就绪：${escapeHtml(summary.stockStatus)}</small></article>
    <article>
      <span>安全下一步</span>
      <strong>${escapeHtml(summary.action.label)}</strong>
      <button class="primary" type="button" data-listing-seller-primary-view="${escapeHtml(summary.action.view)}" data-listing-seller-run-id="${escapeHtml(summary.runId)}" data-listing-seller-node-key="${escapeHtml(summary.action.nodeKey || "")}">${escapeHtml(summary.action.label)}</button>
      <small>点击后：${escapeHtml(summary.action.effect)}</small>
    </article>
    ${renderListingSellerPayloadValidation(run)}
    ${renderListingSellerContentEvidence(run)}
    ${renderListingSellerPreflightResult(run)}
    ${renderListingSellerPayloadIssues(run)}
    ${renderListingSellerSourceBinding(run)}
    ${renderListingSellerEvidenceActions(run, autoListJob)}
    ${renderListingMediaReview(mediaAssets, mediaIssues, { run, sourceEvidence: linkedCandidate?.sourceEvidence || null, candidateApprovalDraft: linkedCandidate?.mediaApprovalDraft || null })}
    ${renderListingProductReadiness(autoListJob)}
    ${renderManualListingContentForm(autoListJob)}
    ${renderManualProcurementForm(autoListJob)}
    ${renderManualPackageForm(autoListJob)}
  `;
  body.querySelector("[data-manual-content-save]")?.addEventListener("click", () => saveManualListingContentFromUi(autoListJob));
  body.querySelector("[data-manual-procurement-save]")?.addEventListener("click", () => saveManualProcurementFromUi(autoListJob));
  body.querySelector("[data-manual-package-save]")?.addEventListener("click", () => saveManualPackageFromUi(autoListJob));
  body.querySelector("[data-seller-validate-payload]")?.addEventListener("click", () => validateListingSellerPayload(body.querySelector("[data-seller-validate-payload]").dataset.runId));
  body.querySelectorAll("[data-seller-payload-issue]").forEach((button) => {
    button.addEventListener("click", () => openSellerPayloadIssue(button.dataset.runId, button));
  });
  body.querySelector("[data-seller-source-task]")?.addEventListener("click", () => openSellerSourceTask());
  body.querySelector("[data-seller-category-task]")?.addEventListener("click", () => openSellerCategoryTask(run));
  body.querySelector("[data-seller-source-binding]")?.addEventListener("click", () => openSellerPayloadIssue(run?.id));
  body.querySelector("[data-seller-task-readback]")?.addEventListener("click", (event) => openListingTaskReadback(event.currentTarget));
  body.querySelector("[data-request-media-review]")?.addEventListener("click", () => requestListingMediaReview(body.querySelector("[data-request-media-review]").dataset.mediaReviewRunId));
  body.querySelector("[data-request-preflight-recheck]")?.addEventListener("click", () => requestListingPreflightRecheck(body.querySelector("[data-request-preflight-recheck]").dataset.preflightRecheckRunId));
  body.querySelector("[data-seller-preflight-return]")?.addEventListener("click", () => {
    state.selectedWorkflowRunId = body.querySelector("[data-seller-preflight-return]").dataset.runId || state.selectedWorkflowRunId;
    state.selectedWorkflowNodeKey = "preflight_check";
    setListingStage("current-product");
    document.querySelector("#listingCurrentDraftStatus")?.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("已回到当前本地草稿；修复后点击重新校验 Payload", "ok");
  });
}

function renderListingSellerContentEvidence(run = null) {
  if (!run) return "";
  const contentNode = (run.nodes || []).find((node) => ["content_generation", "content_review"].includes(node.key));
  const evidence = run.contentEvidence || contentNode?.output?.contentEvidence || null;
  const sellerResult = run.contentSellerResult || contentNode?.output?.sellerResult || null;
  if (!evidence && !sellerResult) return "";
  const source = evidence?.source || sellerResult?.source || {};
  const facts = evidence?.facts || [];
  const counts = sellerResult?.factSummary || {
    total: facts.length,
    sourceSupported: facts.filter((fact) => fact.status === "source_supported").length,
    needsReview: facts.filter((fact) => fact.status === "model_generated_unverified").length,
    missing: facts.filter((fact) => fact.status === "missing").length,
  };
  const status = sellerResult?.status || evidence?.status || "needs_review";
  return `<article class="listing-seller-content-evidence" aria-label="俄文内容证据">
    <span>俄文内容证据</span><strong>${escapeHtml(status === "blocked" ? "来源/事实需修复" : status === "reviewed" ? "已人工复核" : "待人工核对")}</strong>
    <small>来源：${escapeHtml(source.type || "none")} · 支持 ${escapeHtml(counts.sourceSupported || 0)} · 待核对 ${escapeHtml(counts.needsReview || 0)} · 缺失 ${escapeHtml(counts.missing || 0)}</small>
    <small>${escapeHtml(sellerResult?.action || evidence?.action || "逐字段核对中俄事实后重新预检")}</small>
    <small>不会把模型建议当作 Ozon 已验证事实，也不会自动提交。</small>
  </article>`;
}

function renderListingSellerPayloadValidation(run = null) {
  if (!run?.id || !run.payloadDraft) return "";
  const validation = run.payloadDraftValidation || null;
  const issueCount = Number(validation?.issues?.length || validation?.errors?.length || 0);
  const status = validation
    ? (validation.ok ? "预检通过" : `预检阻塞（${issueCount} 项）`)
    : "尚未校验";
  const next = validation?.ok
    ? "可以继续人工检查媒体、价格和提交安全门"
    : (validation ? "按问题定位修复本地草稿，再重新校验" : "点击校验当前本地 Payload");
  return `<article class="listing-seller-payload-validation" aria-label="卖家商品预检">
    <span>提交前检查</span><strong>${escapeHtml(status)}</strong>
    <small>${escapeHtml(next)}；只校验本地草稿，不提交 Ozon。</small>
    ${!validation ? `<small class="listing-seller-preflight-stale-hint">当前草稿没有有效预检版本；如之前有人工确认，旧确认不可复用。</small>` : ""}
    <button class="primary" type="button" data-seller-validate-payload data-run-id="${escapeHtml(run.id)}">${validation ? "重新校验 Payload" : "校验 Payload"}</button>
  </article>`;
}

// Render the business contract first; raw Payload diagnostics stay behind the
// existing locator/details action.  A seller should see what is blocked, what
// to do next, what will (and will not) happen, and the expected result without
// reading workflow nodes or JSON.
function listingPreflightMediaEvidence(run = null) {
  const job = currentListingAutoListJob(run);
  const candidate = job?.candidateData || null;
  const assets = Array.isArray(candidate?.mediaAssets)
    ? candidate.mediaAssets
    : (Array.isArray(run?.source?.mediaAssets) ? run.source.mediaAssets : []);
  const issues = Array.isArray(candidate?.mediaIssues)
    ? candidate.mediaIssues.filter(Boolean).map(String)
    : (Array.isArray(run?.source?.mediaIssues) ? run.source.mediaIssues.filter(Boolean).map(String) : []);
  const approval = run?.mediaApprovalDraft || candidate?.mediaApprovalDraft || null;
  if (!assets.length && !issues.length) {
    return { status: "not_required", nextAction: "当前商品没有媒体候选；不会上传媒体或提交 Ozon。" };
  }
  if (issues.length) {
    return { status: "blocked", nextAction: `先处理 ${issues.length} 个媒体证据问题，再重新预检；不会上传媒体或提交 Ozon。` };
  }
  if (approval?.status === "published_local" && approval.richContentDetailAssetsApproved === true) {
    return { status: "verified", nextAction: "媒体批准已在本地发布；仍需人工确认提交安全门，不会自动上传或提交 Ozon。" };
  }
  return { status: "needs_review", nextAction: "逐项检查并发布本地媒体批准后再重新预检；不会上传媒体或提交 Ozon。" };
}

function renderListingSellerPreflightResult(run = null) {
  if (!run?.id) return "";
  const nodeResult = (run.nodes || []).find((node) => node.key === "preflight_check")?.output?.sellerResult || null;
  const result = run.payloadDraftValidation?.sellerResult || nodeResult;
  if (!result || typeof result !== "object") return "";
  const repairs = Array.isArray(result.repairs) ? result.repairs : [];
  const blocked = result.status === "blocked" || result.outcome === "submission_not_started";
  const submission = run.submissionReservation || {};
  const submittedTaskId = String(submission.taskId || result.taskId || "").trim();
  const submissionCompleted = submission.state === "completed" && submittedTaskId;
  const title = blocked ? "预检阻塞，暂不能提交" : "预检通过，等待人工确认";
  const summary = blocked ? `${Number(result.blockerCount || repairs.length || 0)} 个问题需要处理` : "当前本地草稿可以进入提交确认";
  const evidenceSummary = result.evidenceSummary && typeof result.evidenceSummary === "object" ? result.evidenceSummary : {};
  const evidenceSummaryWithMedia = evidenceSummary.media ? evidenceSummary : { ...evidenceSummary, media: listingPreflightMediaEvidence(run) };
  const evidenceLabels = { source: "1688 来源", content: "俄文内容", category: "Ozon 类目", sku: "SKU 绑定", media: "媒体" };
  const evidenceStatusLabels = { verified: "已验证", needs_review: "待人工核对", missing: "缺失", blocked: "阻塞", not_required: "未要求", single_sku: "单 SKU" };
  const evidenceEntries = Object.entries(evidenceLabels).map(([key, label]) => {
    const evidence = evidenceSummaryWithMedia[key];
    if (!evidence || typeof evidence !== "object") return "";
    const status = String(evidence.status || "unknown");
    return `<div class="listing-seller-evidence-item" data-evidence-status="${escapeHtml(status)}"><b>${escapeHtml(label)}</b><span>${escapeHtml(evidenceStatusLabels[status] || status)}</span><small>${escapeHtml(evidence.nextAction || "暂无下一步")}</small></div>`;
  }).filter(Boolean).join("");
  return `<article class="listing-seller-preflight-result ${blocked ? "is-blocked" : "is-ready"}" aria-label="卖家预检结果">
    <span>卖家下一步</span><strong>${escapeHtml(title)}</strong>
    <small>${escapeHtml(summary)}；${escapeHtml(result.nextAction || "请查看当前草稿并按提示继续")}</small>
    ${blocked ? `<button class="primary" type="button" data-seller-preflight-return data-run-id="${escapeHtml(run.id)}">回到草稿修复并重新预检</button>` : ""}
    ${submissionCompleted ? `<button class="primary" type="button" data-seller-task-readback data-run-id="${escapeHtml(run.id)}" data-task-id="${escapeHtml(submittedTaskId)}">回查 Ozon 审核状态</button>` : ""}
    <div class="listing-seller-preflight-contract">
      <div><b>点击后会发生什么</b><span>${escapeHtml(result.sideEffect || "仅更新本地预检状态，不会自动提交")}</span></div>
      <div><b>本次结果</b><span>${escapeHtml(result.result || "请以新的预检结果为准")}</span></div>
    </div>
    ${evidenceEntries ? `<div class="listing-seller-evidence-summary" aria-label="提交前证据摘要"><strong>提交前证据</strong>${evidenceEntries}</div>` : ""}
    ${repairs.length ? `<div class="listing-seller-preflight-repairs">
      ${repairs.slice(0, 6).map((repair) => `<div class="listing-seller-preflight-repair">
      <div><strong>${escapeHtml(repair.message || "需要修复的商品资料")}</strong><small>字段：${escapeHtml(repair.fieldPath || "当前商品草稿")}${repair.offerId ? ` · SKU：${escapeHtml(repair.offerId)}` : ""}</small></div>
        <small>建议：${escapeHtml(repair.action || "修复后重新预检")}；${escapeHtml(repair.sideEffect || result.sideEffect || "仅本地处理，不提交 Ozon")}</small>
        <small>结果：${escapeHtml(repair.result || result.result || "修复后生成新的预检结果")}</small>
        <button class="ghost" type="button" data-seller-payload-issue data-run-id="${escapeHtml(run.id)}" data-issue-code="${escapeHtml(repair.code || "")}" data-issue-field-path="${escapeHtml(workflowPayloadLocationForIssue(repair).path)}" data-issue-label="${escapeHtml(workflowPayloadLocationForIssue(repair).label)}" data-issue-offer-id="${escapeHtml(repair.offerId || "")}" data-issue-attribute-id="${escapeHtml(repair.attributeId || repair.attribute_id || "")}">查看并定位</button>
      </div>`).join("")}
      ${repairs.length > 6 ? `<small>还有 ${repairs.length - 6} 项，请进入预检详情查看。</small>` : ""}
    </div>` : ""}
  </article>`;
}

function openListingTaskReadback(button) {
  const taskId = String(button?.dataset?.taskId || "").trim();
  if (!/^\d+$/.test(taskId)) {
    toast("当前提交没有可用 Task ID，请到工作流详情查看回执。", "error");
    return;
  }
  state.selectedWorkflowRunId = button.dataset.runId || state.selectedWorkflowRunId;
  activateErpView("listing");
  setListingStage("current-product");
  window.setTimeout(() => {
    const input = $("#listingTaskId");
    if (!input) {
      toast("当前页面没有任务回查输入框，请打开上架详情后重试。", "error");
      return;
    }
    input.value = taskId;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
  }, 0);
  toast(`已填入 Task ID ${taskId}；点击“读取任务结果”只回查 Ozon，不会重复提交。`);
}

function renderListingSellerPayloadIssues(run = null) {
  const validation = run?.payloadDraftValidation || null;
  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  if (!run?.id || !validation || !issues.length) return "";
  const visibleIssues = issues.slice(0, 6);
  return `<article class="listing-seller-payload-issues" aria-label="商品预检问题">
    <span>需要处理的商品问题</span>
    <strong>${issues.length} 项，按字段和 SKU 定位</strong>
    <div class="listing-seller-payload-issue-list">
      ${visibleIssues.map((issue, index) => {
        const location = workflowPayloadLocationForIssue(issue);
        const offer = String(issue.offerId || issue.offer_id || "").trim();
        const attribute = Number(issue.attributeId || issue.attribute_id || 0);
        return `<div class="listing-seller-payload-issue">
          <div><strong>${escapeHtml(issue.code || "UNKNOWN")}</strong><small>${escapeHtml(issue.message || "需要修复本地 Payload")}</small></div>
          <small>${offer ? `SKU：${escapeHtml(offer)} · ` : ""}${attribute ? `属性：${attribute} · ` : ""}字段：${escapeHtml(location.label)}</small>
          <button class="ghost" type="button" data-seller-payload-issue data-run-id="${escapeHtml(run.id)}" data-issue-code="${escapeHtml(issue.code || "")}" data-issue-field-path="${escapeHtml(location.path)}" data-issue-label="${escapeHtml(location.label)}" data-issue-offer-id="${escapeHtml(offer)}" data-issue-attribute-id="${escapeHtml(attribute || "")}">查看并定位</button>
        </div>`;
      }).join("")}
    </div>
    ${issues.length > visibleIssues.length ? `<small>还有 ${issues.length - visibleIssues.length} 项，请进入预检详情查看全部。</small>` : ""}
  </article>`;
}

function renderListingSellerSourceBinding(run = null) {
  if (!run?.payloadDraft) return "";
  // Prefer the compact source binding persisted beside the local Payload
  // summary.  It is deliberately not the raw 1688 capture: only the
  // verification state, a short hash, and counts are seller-facing here.
  const payloadSummary = run.payloadDraft.summary || {};
  const payloadBinding = payloadSummary.sourceEvidence || null;
  const validation = run.payloadDraftValidation || {};
  const preflight = (run.nodes || []).find((node) => node.key === "preflight_check")?.output || {};
  const variantBinding = validation.variantConfiguration?.sourceVariantBinding
    || preflight.variantConfiguration?.sourceVariantBinding
    || null;
  const summary = variantBinding?.summary || null;
  if (!payloadBinding && (!summary || Number(summary.itemCount || 0) < 2)) return "";

  if (payloadBinding) {
    const snapshotHash = String(payloadBinding.snapshotHash || "").trim();
    const hashShort = /^sha256:[a-f0-9]{64}$/i.test(snapshotHash)
      ? `${snapshotHash.slice(0, 15)}…${snapshotHash.slice(-8)}`
      : "未生成快照 hash";
    const verificationState = String(payloadBinding.verificationState || "unknown").trim().toLowerCase();
    const status = payloadBinding.status === "bound" && verificationState === "ok"
      ? "已验证"
      : verificationState === "waiting_human"
        ? "等待人工确认"
        : snapshotHash
          ? "已记录，待人工验证"
          : "来源证据缺失";
    const offerCount = Number(payloadSummary.itemCount || run.payloadDraft.items?.length || 0);
    const sourceSkuCount = Number(payloadBinding.variantCount || payloadSummary.variantCount || 0);
    const nextAction = String(payloadBinding.nextAction || (snapshotHash
      ? "人工确认来源快照后再运行预检。"
      : "重新采集并人工确认 1688 来源快照后再预检。")).trim();
    const needsSourceAction = status !== "已验证";
    return `<article class="listing-seller-source-binding" aria-label="1688 来源快照证据">
      <span>1688 来源证据</span><strong>${escapeHtml(status)}</strong>
      <small>快照：${escapeHtml(hashShort)} · Offer ${escapeHtml(offerCount || "-")} 个 · 来源 SKU ${escapeHtml(sourceSkuCount || "-")} 个</small>
      <small>下一步：${escapeHtml(nextAction)}</small>
      ${needsSourceAction ? `<button class="ghost" type="button" data-seller-source-task>回到 1688 采集并确认来源</button>` : ""}
    </article>`;
  }

  const bound = Number(summary.boundCount || 0);
  const total = Number(summary.itemCount || 0);
  const missing = Number(summary.missingCount || 0);
  const duplicate = Number(summary.duplicateCount || 0);
  const ready = summary.ready === true;
  return `<article class="listing-seller-source-binding" aria-label="1688 来源 SKU 绑定">
    <span>1688 来源 SKU 绑定</span><strong>${ready ? `已绑定 ${bound}/${total}` : `阻塞：已绑定 ${bound}/${total}`}</strong>
    <small>${ready ? "每个 Ozon offer 都能回指来源 SKU。" : `缺失 ${missing}，重复 ${duplicate}；多 SKU 不能在来源不明确时提交。`}</small>
    ${ready ? "" : `<button class="ghost" type="button" data-seller-source-binding>查看 SKU 绑定详情</button>`}
  </article>`;
}

function renderListingSellerEvidenceActions(run = null, job = null) {
  if (!run && !job) return "";
  const candidate = job?.candidateData || run?.source || {};
  const sourceEvidence = candidate.sourceEvidence || run?.sourceEvidence || null;
  const sourceReady = Boolean(
    sourceEvidence?.snapshotHash
      && sourceEvidence?.canonicalUrl
      && sourceEvidence?.verificationState === "ok",
  );
  const category = job?.categoryMatch || run?.source?.categoryMatch || null;
  const categoryReady = Number(category?.description_category_id || 0) > 0 && Number(category?.type_id || 0) > 0;
  if (sourceReady && categoryReady) return "";
  return `<article class="listing-seller-evidence-actions" aria-label="前置证据任务">
    <span>上架前置资料</span><strong>${sourceReady ? "来源已记录" : "来源证据待补齐"} · ${categoryReady ? "类目已确认" : "类目待确认"}</strong>
    <small>先补齐真实来源和当前店铺类目，系统不会根据标题猜测或把页面状态当成证据。</small>
    <div class="listing-seller-evidence-buttons">
      ${sourceReady ? "" : `<button class="ghost" type="button" data-seller-source-task>回到 1688 采集</button>`}
      ${categoryReady ? "" : `<button class="primary" type="button" data-seller-category-task>选择 Ozon 类目</button>`}
    </div>
  </article>`;
}

function openSellerSourceTask() {
  document.querySelector('[data-view="sourcing"]')?.click();
  toast("已打开 1688 采集入口，请补齐来源快照和页面证据");
}

function openVariantSourceTask(button = null) {
  const runId = String(button?.dataset?.runId || "").trim();
  if (runId) state.selectedWorkflowRunId = runId;
  activateErpView("sourcing");
  toast("已打开 1688 来源入口；补齐来源变体后重新生成 Payload 并预检，不会自动提交 Ozon。", "ok");
}

function openSellerCategoryTask(run = null) {
  state.selectedWorkflowRunId = run?.id || state.selectedWorkflowRunId;
  document.querySelector('[data-view="listing"]')?.click();
  window.setTimeout(() => {
    const field = $("#categoryKeyword") || $("#listingCategoryId");
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
    field?.focus();
  }, 0);
  toast("已定位类目选择；请选择当前店铺类目后保存到草稿");
}

function stockReadinessClaimFromDataset(button = {}) {
  const status = String(button?.dataset?.stockReadinessStatus || "").trim().toLowerCase();
  const verification = String(button?.dataset?.stockReadinessVerification || "").trim().toLowerCase();
  return status === "ready_for_sale"
    && verification === "server_observed"
    && button?.dataset?.stockReadinessFresh === "true";
}

async function openStockReadinessTask(button) {
  if (!stockReadinessClaimFromDataset(button)) {
    toast("当前商品尚未形成新鲜的服务端可售证据，请先回查商品状态。库存核对未打开。", "warning");
    return;
  }
  const offerIds = String(button?.dataset.stockReadinessOffers || "")
    .split(",")
    .map((offerId) => offerId.trim())
    .filter(Boolean);
  if (!offerIds.length) {
    toast("未找到可核对的 Offer，请先重新读取商品状态。", "error");
    return;
  }
  const targetStoreId = String(button?.dataset.stockReadinessStoreId || "").trim();
  const currentStoreId = String(selectedStoreId() || "").trim();
  if (targetStoreId && targetStoreId !== currentStoreId) {
    try {
      await switchStoreContext(targetStoreId);
    } catch (error) {
      toast(error.message || "无法切换到商品所属店铺，未打开库存核对", "error");
      return;
    }
  }
  state.stockFocusOfferIds = offerIds;
  state.stockEvidence = null;
  state.stockDryRun = null;
  state.stockSnapshotProducts = null;
  state.stockSnapshot = null;
  state.stockWarehouses = null;
  const handoffEnvironment = String(currentSellerReadEnvironment() || "").trim();
  const handoffStoreId = String(selectedStoreId() || targetStoreId || "").trim();
  const offerInput = $("#stockOfferId");
  if (offerInput) offerInput.value = offerIds.join(", ");
  const stockJson = $("#stockJson");
  if (stockJson) {
    let existing = [];
    try {
      const parsed = JSON.parse(stockJson.value || "[]");
      existing = Array.isArray(parsed) ? parsed : [];
    } catch {
      existing = [];
    }
    const existingByOffer = new Map(existing.map((row) => [String(row?.offer_id || row?.offerId || "").trim(), row]));
    stockJson.value = JSON.stringify(offerIds.map((offerId) => {
      const row = existingByOffer.get(offerId) || {};
      return { offer_id: offerId, stock: row.stock ?? "", warehouse_id: row.warehouse_id ?? "" };
    }), null, 2);
  }
  activateErpView("warehouse");
  const evidence = $("#stockEvidenceResult");
  if (evidence) {
    evidence.innerHTML = `
      <div class="stock-evidence-summary is-partial" data-stock-readiness-focus="true">
        <strong>商品已形成服务端可售证据，当前库存尚未读取</strong>
        <p>已定位 ${offerIds.length} 个 Offer：${offerIds.map(escapeHtml).join("、")}。</p>
        <p><b>读取范围：</b>店铺 ${escapeHtml(handoffStoreId || "未绑定")} · 环境 ${escapeHtml(handoffEnvironment || "未填写")}。</p>
        <p><b>当前状态：</b>库存证据尚未读取，不能判断缺货，也不能把空白数量当作 0。</p>
        <p><b>下一步：</b>先补齐目标仓库和数量，然后读取当前库存；再核对对应 Offer。本次不会自动写入。</p>
        <small>商品审核状态来自只读回查；可售不等于库存已就绪。</small>
      </div>
    `;
  }
  syncStockActionButtons();
  toast("已打开库存核对，请先补齐目标仓库和数量");
}

function openSellerPayloadIssue(runId = "", issueButton = null) {
  const id = String(runId || "").trim();
  if (!id) return;
  state.selectedWorkflowRunId = id;
  state.selectedWorkflowNodeKey = "preflight_check";
  state.selectedWorkflowPayloadIssue = issueButton ? {
    code: String(issueButton.dataset.issueCode || "").trim(),
    fieldPath: String(issueButton.dataset.issueFieldPath || "").trim(),
    label: String(issueButton.dataset.issueLabel || issueButton.dataset.issueFieldPath || "").trim(),
    offerId: String(issueButton.dataset.issueOfferId || "").trim(),
    attributeId: String(issueButton.dataset.issueAttributeId || "").trim(),
  } : null;
  activateErpView("workflow-console");
  renderWorkflowConsole();
  const issue = state.selectedWorkflowPayloadIssue;
  if (issue?.fieldPath || issue?.offerId || issue?.attributeId) {
    window.setTimeout(() => {
      const locator = [...document.querySelectorAll("#workflowNodeDetail [data-payload-path]")].find((candidate) => {
        const pathMatches = !issue.fieldPath || candidate.dataset.payloadPath === issue.fieldPath;
        const offerMatches = !issue.offerId || candidate.dataset.payloadOfferId === issue.offerId;
        const attributeMatches = !issue.attributeId || candidate.dataset.payloadAttributeId === issue.attributeId;
        return pathMatches && offerMatches && attributeMatches;
      });
      if (locator) focusWorkflowPayloadIssue(locator);
      else toast(`已打开预检详情：${issue.label || issue.code || "请查看问题"}`);
    }, 0);
  } else {
    toast("已打开预检详情，可按字段定位 Payload");
  }
}

async function validateListingSellerPayload(runId = "") {
  const id = String(runId || "").trim();
  if (!id) return;
  const button = document.querySelector(`[data-seller-validate-payload][data-run-id="${CSS.escape(id)}"]`);
  setBusy(button, true);
  try {
    const result = await api(`/api/workflows/${encodeURIComponent(id)}/payload-draft/validate`, {
      method: "POST",
      body: "{}",
    });
    showResponse(result);
    toast(result.ok ? "Payload 预检通过" : `Payload 仍有 ${result.issues?.length || result.errors?.length || 0} 项问题`, result.ok ? "ok" : "error");
    await loadWorkflowRuns();
  } catch (error) {
    toast(error.message || "Payload 校验失败", "error");
  } finally {
    setBusy(button, false);
  }
}

async function requestListingMediaReview(runId) {
  try {
    const data = await api(`/api/workflows/${encodeURIComponent(runId)}/request-media-review`, { method: "POST" });
    showResponse(data);
    toast("已进入人工看图，请逐项确认媒体候选");
    await loadWorkflowRuns();
  } catch (error) {
    toast(error.message || "进入人工看图失败", "error");
  }
}

async function requestListingPreflightRecheck(runId) {
  try {
    const data = await api(`/api/workflows/${encodeURIComponent(runId)}/request-preflight-recheck`, {
      method: "POST",
      body: JSON.stringify({ note: "媒体批准发布后，卖家明确请求重新运行商品预检" }),
    });
    showResponse(data);
    toast("商品预检已重新运行");
    await loadWorkflowRuns();
  } catch (error) {
    toast(error.message || "重新运行商品预检失败", "error");
  }
}

function renderManualListingContentForm(job = null) {
  if (!job?.id) return "";
  const content = job.listingContent || {};
  const ready = String(content.title_ru || "").trim() && String(content.description_ru || "").trim();
  if (ready && !["draft_pending", "content_ready"].includes(String(job.status || ""))) return "";
  return `<article class="listing-manual-content-form" aria-label="人工填写俄文内容">
    <span>先完成商品内容</span>
    <strong>人工填写俄文标题和描述</strong>
    <small>只保存本地草稿，不调用 AI、不提交 Ozon；保存后继续补类目和采购证据。</small>
    <label>俄文标题<input data-manual-content-title value="${escapeHtml(content.title_ru || "")}" maxlength="200" placeholder="例如：Органайзер для хранения" /></label>
    <label>俄文描述<textarea data-manual-content-description maxlength="5000" placeholder="填写至少 20 个字符的俄文商品描述">${escapeHtml(content.description_ru || "")}</textarea></label>
    <label>俄文短卖点（可选）<input data-manual-content-annotation value="${escapeHtml(content.annotation_ru || "")}" maxlength="500" /></label>
    <button class="primary" type="button" data-manual-content-save>保存并重新预检</button>
  </article>`;
}

async function saveManualListingContentFromUi(job = null) {
  if (!job?.id) return;
  const body = document.querySelector("#listingSellerTaskSummaryBody");
  const button = body?.querySelector("[data-manual-content-save]");
  setBusy(button, true);
  try {
    const data = await api(`/api/ozon-learning/auto-list-jobs/${encodeURIComponent(job.id)}/manual-content`, {
      method: "POST",
      body: JSON.stringify({
        title_ru: body.querySelector("[data-manual-content-title]")?.value || "",
        description_ru: body.querySelector("[data-manual-content-description]")?.value || "",
        annotation_ru: body.querySelector("[data-manual-content-annotation]")?.value || "",
      }),
    });
    showResponse(data);
    toast("俄文内容已保存，正在重新预检");
    await loadAutoListJobs();
    await loadWorkflowRuns();
    await recheckListingAfterEvidenceSave(job, data);
  } catch (error) {
    toast(error.message || "保存内容失败", "error");
  } finally {
    setBusy(button, false);
  }
}

function renderManualProcurementForm(job = null) {
  if (!job?.id) return "";
  const evidence = job.candidateData?.procurementEvidence || {};
  const tiers = Array.isArray(evidence.priceTiers?.values) ? evidence.priceTiers.values : [];
  const verified = evidence.moq?.source && evidence.moq.source !== "missing" && tiers.length;
  if (verified && !["draft_pending", "content_ready", "category_manual_saved", "procurement_manual_saved"].includes(String(job.status || ""))) return "";
  const tierRows = [0, 1, 2].map((index) => {
    const tier = tiers[index] || {};
    return `<div class="erp-inline"><input data-procurement-min="${index}" type="number" min="1" value="${escapeHtml(tier.minQuantity || "")}" placeholder="第 ${index + 1} 档起订量" /><input data-procurement-price="${index}" type="number" min="0.01" step="0.01" value="${escapeHtml(tier.unitPriceCny || "")}" placeholder="采购单价 RMB" /></div>`;
  }).join("");
  return `<article class="listing-manual-procurement-form" aria-label="人工填写采购证据">
    <span>补齐采购成本</span><strong>MOQ 与阶梯价</strong>
    <small>这些数据用于成本和利润诊断；手填来源会保留为 manual_seller，不会伪装成官方实时费率。</small>
    <label>供应商 ID（可选）<input data-procurement-supplier-id value="${escapeHtml(evidence.supplierId?.value || "")}" /></label>
    <label>供应商名称（至少填一个）<input data-procurement-supplier-name value="${escapeHtml(evidence.supplierName?.value || "")}" /></label>
    <label>MOQ<input data-procurement-moq type="number" min="1" value="${escapeHtml(evidence.moq?.value || "")}" /></label>
    <label>采购阶梯（数量递增）${tierRows}</label>
    <button class="primary" type="button" data-manual-procurement-save>保存并重新预检</button>
  </article>`;
}

async function saveManualProcurementFromUi(job = null) {
  if (!job?.id) return;
  const body = document.querySelector("#listingSellerTaskSummaryBody");
  const button = body?.querySelector("[data-manual-procurement-save]");
  const priceTiers = [0, 1, 2].map((index) => ({
    minQuantity: Number(body.querySelector(`[data-procurement-min="${index}"]`)?.value || 0),
    unitPriceCny: Number(body.querySelector(`[data-procurement-price="${index}"]`)?.value || 0),
  })).filter((tier) => tier.minQuantity > 0 || tier.unitPriceCny > 0);
  setBusy(button, true);
  try {
    const data = await api(`/api/ozon-learning/auto-list-jobs/${encodeURIComponent(job.id)}/manual-procurement`, {
      method: "POST",
      body: JSON.stringify({
        supplierId: body.querySelector("[data-procurement-supplier-id]")?.value || "",
        supplierName: body.querySelector("[data-procurement-supplier-name]")?.value || "",
        moq: Number(body.querySelector("[data-procurement-moq]")?.value || 0),
        priceTiers,
      }),
    });
    showResponse(data);
    toast(data.payloadDraftReady ? "采购已保存，正在重新预检" : "采购证据已保存到本地草稿");
    await loadAutoListJobs();
    await loadWorkflowRuns();
    await recheckListingAfterEvidenceSave(job, data);
  } catch (error) {
    toast(error.message || "保存采购证据失败", "error");
  } finally {
    setBusy(button, false);
  }
}

function renderManualPackageForm(job = null) {
  if (!job?.id) return "";
  const sizeWeight = job.candidateData?.sizeWeight || {};
  const valuesReady = [sizeWeight.weightG, sizeWeight.lengthMm, sizeWeight.widthMm, sizeWeight.heightMm]
    .every((value) => Number(value) > 0);
  const lockedStatuses = ["submitted", "live", "listing"];
  if (valuesReady && !["draft_pending", "content_ready", "category_manual_saved", "procurement_manual_saved", "package_manual_saved"].includes(String(job.status || ""))) return "";
  if (lockedStatuses.includes(String(job.status || ""))) return "";
  const source = ["manual_measurement", "supplier_package"].includes(String(sizeWeight.source || ""))
    ? sizeWeight.source
    : "manual_measurement";
  return `<article class="listing-manual-package-form" aria-label="人工填写包装尺重证据">
    <span>补齐物流资料</span><strong>包装重量和长宽高</strong>
    <small>只能填写人工实测或供应商包装资料；单位固定为克和毫米，保存后只更新本地草稿并重新预检。</small>
    <label>证据来源<select data-package-source><option value="manual_measurement" ${source === "manual_measurement" ? "selected" : ""}>人工实测</option><option value="supplier_package" ${source === "supplier_package" ? "selected" : ""}>供应商包装资料</option></select></label>
    <div class="erp-inline"><label>重量（克）<input data-package-weight type="number" min="1" max="100000" value="${escapeHtml(sizeWeight.weightG || "")}" /></label><label>长度（毫米）<input data-package-length type="number" min="1" max="2000" value="${escapeHtml(sizeWeight.lengthMm || "")}" /></label></div>
    <div class="erp-inline"><label>宽度（毫米）<input data-package-width type="number" min="1" max="2000" value="${escapeHtml(sizeWeight.widthMm || "")}" /></label><label>高度（毫米）<input data-package-height type="number" min="1" max="2000" value="${escapeHtml(sizeWeight.heightMm || "")}" /></label></div>
    <label>测量备注（可选）<input data-package-note maxlength="500" value="${escapeHtml(sizeWeight.evidenceNote || "")}" placeholder="例如：含外包装，供应商 2026-07-16 提供" /></label>
    <button class="primary" type="button" data-manual-package-save>保存尺重证据并重新预检</button>
  </article>`;
}

async function saveManualPackageFromUi(job = null) {
  if (!job?.id) return;
  const body = document.querySelector("#listingSellerTaskSummaryBody");
  const button = body?.querySelector("[data-manual-package-save]");
  setBusy(button, true);
  try {
    const data = await api(`/api/ozon-learning/auto-list-jobs/${encodeURIComponent(job.id)}/manual-package`, {
      method: "POST",
      body: JSON.stringify({
        source: body.querySelector("[data-package-source]")?.value || "",
        weightG: Number(body.querySelector("[data-package-weight]")?.value || 0),
        lengthMm: Number(body.querySelector("[data-package-length]")?.value || 0),
        widthMm: Number(body.querySelector("[data-package-width]")?.value || 0),
        heightMm: Number(body.querySelector("[data-package-height]")?.value || 0),
        note: body.querySelector("[data-package-note]")?.value || "",
      }),
    });
    showResponse(data);
    toast(data.payloadDraftReady ? "尺重已保存，本地 Payload 已刷新，请继续校验" : "尺重证据已保存到本地草稿");
    await loadAutoListJobs();
    await loadWorkflowRuns();
    await recheckListingAfterEvidenceSave(job, data);
  } catch (error) {
    toast(error.message || "保存尺重证据失败", "error");
  } finally {
    setBusy(button, false);
  }
}

async function recheckListingAfterEvidenceSave(previousJob = null, saveResult = {}) {
  const runId = String(
    saveResult.workflowRunId
      || previousJob?.workflowRunId
      || currentListingWorkflowRun()?.id
      || "",
  ).trim();
  if (!runId) {
    state.listingHandoffNotice = "资料已保存，但商品工作流未绑定；请重新交接后才能运行预检。";
    renderListingSellerTaskSummary();
    toast(state.listingHandoffNotice, "warning");
    return;
  }
  try {
    const result = await api(`/api/workflows/${encodeURIComponent(runId)}/payload-draft/validate`, {
      method: "POST",
      body: "{}",
    });
    showResponse(result);
    toast(result.ok
      ? "资料已保存，预检通过；仍需人工确认后才能提交"
      : `资料已保存，预检仍有 ${result.issues?.length || result.errors?.length || 0} 项待处理`, result.ok ? "ok" : "error");
    await loadWorkflowRuns();
  } catch (error) {
    toast(error.message || "资料已保存，但重新预检失败，请手动点击预检", "error");
  }
}

function summarizePipelineHistory(currentRun) {
  const historyRuns = (state.workflowRuns || []).filter((run) => run.id !== currentRun?.id);
  return {
    total: historyRuns.length,
    waiting: historyRuns.filter((run) => run.status === "waiting_human").length,
    failed: historyRuns.filter((run) => run.status === "failed").length,
  };
}

function pipelineStageStats(stage, currentRun) {
  const patterns = stage.nodePatterns || [stage.key];
  const stats = { total: 0, waiting: 0, failed: 0, running: 0, completed: 0, risk: false, label: "暂无运行", latestIssue: null };
  for (const run of currentRun ? [currentRun] : []) {
    const nodes = Array.isArray(run.nodes) ? run.nodes : [];
    for (const node of nodes) {
      const key = String(node.key || "");
      if (!patterns.some((pattern) => key.includes(pattern))) continue;
      stats.total += 1;
      if (node.status === "waiting_human" || run.status === "waiting_human") stats.waiting += 1;
      else if (node.status === "failed" || run.status === "failed") stats.failed += 1;
      else if (node.status === "running" || run.status === "running") stats.running += 1;
      else if (node.status === "completed" || node.status === "done") stats.completed += 1;
      if (Number(node.riskScore || 0) >= 70 || node.riskLevel === "high") stats.risk = true;
      const issue = pipelineStageLatestIssue(run, node);
      if (issue && (!stats.latestIssue || issue.score > stats.latestIssue.score)) stats.latestIssue = issue;
    }
  }
  if (stats.failed) stats.label = `${stats.failed} 个失败`;
  else if (stats.waiting) stats.label = `${stats.waiting} 个待人工`;
  else if (stats.running) stats.label = `${stats.running} 个运行中`;
  else if (stats.completed) stats.label = `${stats.completed} 个已完成`;
  return stats;
}

function pipelineStageLatestIssue(run = {}, node = {}) {
  const diagnostic = node.diagnostic || node.diagnosis || {};
  const output = node.output || {};
  const issues = Array.isArray(output.issues) ? output.issues : Array.isArray(run.payloadDraftValidation?.issues) ? run.payloadDraftValidation.issues : [];
  const firstIssue = issues[0] || {};
  const message = diagnostic.messageZh
    || diagnostic.message
    || node.reason
    || firstIssue.messageZh
    || firstIssue.message
    || run.summary?.nextAction
    || "";
  const blocked = node.status === "failed" || run.status === "failed" || node.status === "waiting_human" || run.status === "waiting_human";
  if (!message && !blocked) return null;
  return {
    score: (node.status === "failed" || run.status === "failed" ? 100 : 0)
      + (node.status === "waiting_human" || run.status === "waiting_human" ? 80 : 0)
      + Number(node.riskScore || 0),
    runId: run.id || "",
    nodeKey: node.key || "",
    status: node.status || run.status || "",
    message: message || "该节点需要人工查看输入/输出诊断。",
  };
}

function renderListingPipelineWorkbench() {
  const workbench = $("#listingPipelineWorkbench");
  if (!workbench) return;
  const currentRun = currentListingWorkflowRun();
  const history = summarizePipelineHistory(currentRun);
  const currentTitle = currentRun?.source?.title || currentRun?.payloadDraft?.items?.[0]?.name || currentRun?.id || "当前商品未绑定 workflow";
  const stageCards = ERP_LISTING_PIPELINE_STAGES.map((stage, index) => {
    const stats = pipelineStageStats(stage, currentRun);
    const issue = stats.latestIssue;
    const className = stats.failed ? "is-failed" : stats.waiting ? "is-waiting" : stats.running ? "is-running" : stats.completed ? "is-complete" : "";
    return `
      <article class="pipeline-stage-card ${className}">
        <div class="pipeline-stage-head">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <strong>${escapeHtml(stage.label)}</strong>
          <em>${escapeHtml(stats.label)}</em>
        </div>
        <p>${escapeHtml(stage.description)}</p>
        <div class="pipeline-stage-issue">
          <span>当前商品问题</span>
          <strong>${escapeHtml(issue?.message || (currentRun ? "当前商品此节点暂无阻塞。" : "还没有当前商品 workflow；先采集或生成草稿。"))}</strong>
          ${issue?.runId ? `<code>${escapeHtml(issue.runId)} / ${escapeHtml(workflowNodeTitle(issue.nodeKey))}</code>` : `<code>${currentRun ? escapeHtml(currentRun.id || "当前 workflow") : "未绑定当前 workflow"}</code>`}
        </div>
        <small><b>${escapeHtml(stage.owner)}</b> · ${escapeHtml(stage.diagnostic)}</small>
        <div class="pipeline-stage-actions">
          <button class="small-blue" type="button" data-pipeline-stage-view="${escapeHtml(stage.view)}">${escapeHtml(stage.primaryAction)}</button>
          ${issue?.runId ? `<button class="small-blue tone-purple" type="button" data-pipeline-run-id="${escapeHtml(issue.runId)}" data-pipeline-node-key="${escapeHtml(issue.nodeKey)}">定位工作流</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
  workbench.innerHTML = `
    <div class="pipeline-current-context">
      <div>
        <span>只看当前商品</span>
        <strong>${escapeHtml(currentTitle)}</strong>
        <p>${currentRun ? `当前 workflow：${escapeHtml(currentRun.id || "-")}，状态：${escapeHtml(currentRun.status || "unknown")}` : "没有当前商品 workflow 时，9 个节点只显示操作入口，不显示历史事故数量。"}</p>
      </div>
      <details class="pipeline-history-summary">
        <summary>历史统计</summary>
        <small>${history.total} 条历史 workflow · ${history.waiting} 条待人工 · ${history.failed} 条失败。历史问题已折叠，只在工作流控制台处理。</small>
      </details>
    </div>
    ${stageCards}
  `;
}

function listingStageStatus(stage) {
  const currentRun = currentListingWorkflowRun();
  if (!currentRun) return stage.status;
  const nodeKeysByStage = {
    "collect-parse": ["crawler_1688", "candidate_parse", "collect_1688"],
    "match-sourcing": ["ozon_learning", "keyword_expand", "match_profit"],
    "pricing-profit": ["match_profit", "pricing"],
    "content-images": ["content_generate", "generate_listing"],
    "preflight-submit": ["preflight_check", "ozon_submit"],
    "review-feedback": ["review_reconcile", "stock_sync"],
    "failure-repair": ["preflight_check", "review_reconcile", "manual"],
  };
  if (stage.key === "current-product") return `当前 workflow：${currentRun.status || "unknown"}`;
  const patterns = nodeKeysByStage[stage.key] || [];
  const nodes = Array.isArray(currentRun.nodes) ? currentRun.nodes : [];
  const matched = nodes.filter((node) => patterns.some((pattern) => String(node.key || "").includes(pattern)));
  const failed = matched.filter((node) => node.status === "failed").length;
  const waiting = matched.filter((node) => node.status === "waiting_human").length;
  const completed = matched.filter((node) => node.status === "completed" || node.status === "done").length;
  if (failed) return `${failed} 个失败`;
  if (waiting) return `${waiting} 个待人工`;
  if (completed) return `${completed} 个已完成`;
  return stage.status;
}

function listingFillTaskDictionaryRepairCandidates(run = currentListingWorkflowRun()) {
  if (!run) return [];
  const waitingHuman = run.status === "waiting_human" || run.locks?.waitingHuman === true;
  if (!waitingHuman) return [];
  const preflightNode = (run.nodes || []).find((node) => node.key === "preflight_check") || {};
  const matrix = run.payloadDraftValidation?.attributeMatrix || preflightNode.output?.attributeMatrix || null;
  const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];
  const repairCandidates = [];
  for (const row of rows) {
    for (const cell of row.cells || []) {
      const guidance = cell.repairGuidance || {};
      const candidates = Array.isArray(guidance.dictionaryCandidates) ? guidance.dictionaryCandidates : [];
      if (guidance.canApplyLocalDraftRepair === true) {
        candidates.forEach((candidate) => {
          repairCandidates.push({
            runId: run.id || "",
            nodeKey: preflightNode.key || "preflight_check",
            offerId: guidance.offerId || cell.offerId || "",
            attributeId: guidance.attributeId || row.attributeId || "",
            attributeName: guidance.attributeName || row.name || "",
            dictionaryValueId: candidate.dictionary_value_id || candidate.dictionaryValueId || "",
            value: candidate.value || "",
            sourceSuggestedAspect: candidate.source === "1688_sku_spec_dictionary_match",
            sourceValue: candidate.sourceValue || "",
            sourceVariantSpec: candidate.sourceVariantSpec || "",
          });
        });
      }
    }
  }
  return repairCandidates;
}

function listingFillTaskRepairCandidate(run = currentListingWorkflowRun()) {
  return listingFillTaskDictionaryRepairCandidates(run)[0] || null;
}

function listingFillTaskTextRepairCandidates(run = currentListingWorkflowRun()) {
  if (!run) return [];
  const waitingHuman = run.status === "waiting_human" || run.locks?.waitingHuman === true;
  if (!waitingHuman) return [];
  const preflightNode = (run.nodes || []).find((node) => node.key === "preflight_check") || {};
  const matrix = run.payloadDraftValidation?.attributeMatrix || preflightNode.output?.attributeMatrix || null;
  const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];
  const repairCandidates = [];
  for (const row of rows) {
    for (const cell of row.cells || []) {
      const guidance = cell.repairGuidance || {};
      if (guidance.canApplyTextDraftRepair === true) {
        repairCandidates.push({
          runId: run.id || "",
          nodeKey: preflightNode.key || "preflight_check",
          offerId: guidance.offerId || cell.offerId || "",
          attributeId: guidance.attributeId || row.attributeId || "",
          attributeName: guidance.attributeName || row.name || "",
        });
      }
    }
  }
  return repairCandidates;
}

function listingFillTaskTextRepairCandidate(run = currentListingWorkflowRun()) {
  return listingFillTaskTextRepairCandidates(run)[0] || null;
}

function listingFillTaskVariantTextRepairCandidate(run = currentListingWorkflowRun()) {
  if (!run) return null;
  const waitingHuman = run.status === "waiting_human" || run.locks?.waitingHuman === true;
  if (!waitingHuman) return null;
  const preflightNode = (run.nodes || []).find((node) => node.key === "preflight_check") || {};
  const matrix = run.payloadDraftValidation?.attributeMatrix || preflightNode.output?.attributeMatrix || null;
  const variantConfiguration = run.payloadDraftValidation?.variantConfiguration || preflightNode.output?.variantConfiguration || null;
  const variantRows = Array.isArray(variantConfiguration?.rows) ? variantConfiguration.rows : [];
  const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];
  for (const row of rows) {
    for (const cell of row.cells || []) {
      const guidance = cell.repairGuidance || {};
      if (guidance.canApplyVariantTextDraftRepair === true) {
        const offerId = guidance.offerId || cell.offerId || "";
        const attributeId = guidance.attributeId || row.attributeId || "";
        const variantRow = variantRows.find((entry) => String(entry.offerId || "") === String(offerId || "")) || {};
        const suggestedAspect = (variantRow.suggestedAspects || []).find((aspect) => (
          String(aspect.attributeId || "") === String(attributeId || "")
          && aspect.readOnly === true
          && aspect.source === "1688_sku_spec"
        )) || null;
        return {
          runId: run.id || "",
          nodeKey: preflightNode.key || "preflight_check",
          offerId,
          attributeId,
          attributeName: guidance.attributeName || row.name || "",
          suggestedValue: suggestedAspect?.value || "",
          sourceSuggestedAspect: Boolean(suggestedAspect?.value),
          sourceVariantSpec: variantRow.sourceVariant?.spec || "",
          safeNextStep: suggestedAspect?.value
            ? "人工确认 1688 SKU 规格候选后，只写回本地草稿并重新预检；不会提交 Ozon。"
            : "人工输入变体文本后，只写回本地草稿并重新预检；不会提交 Ozon。",
        };
      }
    }
  }
  return null;
}

function listingNormalizePackageRepairInfo(input = {}) {
  const source = input.package || input.packageInfo || input;
  const normalized = {
    weight: Math.round(Number(source.weight || source.weightG || source.weight_g || 0)),
    depth: Math.round(Number(source.depth || source.lengthMm || source.length_mm || source.length || 0)),
    width: Math.round(Number(source.width || source.widthMm || source.width_mm || 0)),
    height: Math.round(Number(source.height || source.heightMm || source.height_mm || 0)),
  };
  if (!Number.isFinite(normalized.weight) || normalized.weight < 1
    || !Number.isFinite(normalized.depth) || normalized.depth < 1
    || !Number.isFinite(normalized.width) || normalized.width < 1
    || !Number.isFinite(normalized.height) || normalized.height < 1) {
    return null;
  }
  return normalized;
}

function listingTrustedPackageRepairSource(source = "") {
  const value = String(source || "").trim();
  return ["1688_package", "manual_measurement", "manual_measured", "supplier_package"].includes(value) ? value : "";
}

function listingPackageMissingFields(item = {}) {
  return [
    ["weight", item.weight],
    ["depth", item.depth],
    ["width", item.width],
    ["height", item.height],
  ].filter(([, value]) => !Number.isFinite(Number(value)) || Number(value) < 1)
    .map(([field]) => field);
}

function listingPackageRepairEvidenceItems(run = {}) {
  const nodes = Array.isArray(run.nodes) ? run.nodes : [];
  const evidenceItems = [];
  function pushEvidence(node = {}, rawPackage = {}, rawSource = "", offerId = "") {
    const packageInfo = listingNormalizePackageRepairInfo(rawPackage);
    const explicitSource = listingTrustedPackageRepairSource(rawSource || rawPackage?.packageInfoSource || rawPackage?.source || "");
    if (!packageInfo || !explicitSource) return;
    evidenceItems.push({
      nodeKey: node.key || "preflight_check",
      offerId: String(offerId || rawPackage?.offerId || rawPackage?.offer_id || "").trim(),
      packageInfoSource: explicitSource,
      packageInfo,
    });
  }
  nodes.forEach((node) => {
    const output = node.output || {};
    const input = node.input || {};
    const pricingDiagnosis = output.pricingDiagnosis || input.pricingDiagnosis || {};
    if (pricingDiagnosis?.package) {
      pushEvidence(node, pricingDiagnosis.package, pricingDiagnosis.packageInfoSource || output.packageInfoSource || input.packageInfoSource || "", "");
    }
    if (input.package) {
      pushEvidence(node, input.package, input.packageInfoSource || "", input.offerId || "");
    }
    (Array.isArray(pricingDiagnosis?.variants) ? pricingDiagnosis.variants : []).forEach((variant) => {
      pushEvidence(node, variant.package || variant.packageInfo || {}, variant.packageInfoSource || pricingDiagnosis.packageInfoSource || "", variant.offerId || "");
    });
  });
  const validation = run.payloadDraftValidation || {};
  if (validation.pricingDiagnosis?.package) {
    pushEvidence({ key: "preflight_check" }, validation.pricingDiagnosis.package, validation.pricingDiagnosis.packageInfoSource || "", "");
  }
  return evidenceItems;
}

function listingFillTaskPackageRepairCandidates(run = currentListingWorkflowRun()) {
  if (!run) return [];
  const waitingHuman = run.status === "waiting_human" || run.locks?.waitingHuman === true;
  if (!waitingHuman) return [];
  const items = Array.isArray(run.payloadDraft?.items) ? run.payloadDraft.items : [];
  if (!items.length) return [];
  const preflightNode = (run.nodes || []).find((node) => node.key === "preflight_check") || {};
  const evidenceItems = listingPackageRepairEvidenceItems(run);
  if (!evidenceItems.length) return [];
  const candidates = [];
  for (const item of items) {
    const offerId = String(item.offer_id || item.offerId || "").trim();
    const missingFields = listingPackageMissingFields(item);
    if (!missingFields.length) continue;
    const evidence = evidenceItems.find((entry) => entry.offerId && entry.offerId === offerId)
      || evidenceItems.find((entry) => !entry.offerId)
      || null;
    if (!evidence) continue;
    candidates.push({
      runId: run.id || "",
      nodeKey: preflightNode.key || "preflight_check",
      offerId,
      packageInfoSource: evidence.packageInfoSource,
      packageInfo: evidence.packageInfo,
      missingFields,
    });
  }
  return candidates;
}

function listingFillTaskPackageRepairCandidate(run = currentListingWorkflowRun()) {
  return listingFillTaskPackageRepairCandidates(run)[0] || null;
}

function listingVariantCoverageTaskText(summary = {}) {
  const rowCount = Number(summary.rowCount || 0);
  const aspectCovered = Number(summary.aspectCoveredRowCount || 0);
  const missingAspect = Number(summary.missingAspectRowCount || 0);
  const duplicateAspect = Number(summary.duplicateAspectRowCount || 0);
  const uniqueImages = Number(summary.uniqueSkuImageRowCount || 0);
  const missingImages = Number(summary.missingSkuImageRowCount || 0);
  const nonUniqueImages = Number(summary.nonUniqueSkuImageRowCount || 0);
  return [
    `属性覆盖 ${aspectCovered}/${rowCount}`,
    `缺失 ${missingAspect}`,
    `重复 ${duplicateAspect}`,
    `SKU 图区分 ${uniqueImages}/${rowCount}`,
    `缺图 ${missingImages}`,
    `未区分 ${nonUniqueImages}`,
  ].join("，");
}

function listingVariantAspectContext(row = {}) {
  const aspects = Array.isArray(row.aspects) ? row.aspects : [];
  const primaryAspect = aspects.find((aspect) => aspect?.id || aspect?.name) || {};
  const reasons = Array.isArray(row.reasons) ? row.reasons : [];
  const blockingReason = reasons.find((reason) => ["DUPLICATE_ASPECT", "MISSING_ASPECT"].includes(reason.code)) || reasons[0] || {};
  const statusText = row.rowStatus === "duplicate_aspect"
    ? "变体属性重复"
    : row.rowStatus === "missing_aspect" ? "缺少可变特性" : "变体属性待检查";
  const aspectName = primaryAspect.name || (primaryAspect.id ? `属性 ${primaryAspect.id}` : "当前类目可变特性");
  return {
    offerId: row.offerId || "",
    aspectName,
    aspectId: primaryAspect.id || "",
    statusText,
    reason: blockingReason.message || row.safeNextAction || statusText,
    nextAction: row.safeNextAction || "修正该 SKU 的可变特性后重新预检；不会自动提交 Ozon。",
  };
}

function listingFillTaskVariantAspectSuggestion(variantConfiguration = null) {
  const rows = Array.isArray(variantConfiguration?.rows) ? variantConfiguration.rows : [];
  const affectedRows = rows.filter((row) => ["duplicate_aspect", "missing_aspect"].includes(row.rowStatus));
  if (!affectedRows.length) return null;
  const duplicateRows = affectedRows.filter((row) => row.rowStatus === "duplicate_aspect");
  const missingRows = affectedRows.filter((row) => row.rowStatus === "missing_aspect");
  const offers = affectedRows.map((row) => row.offerId).filter(Boolean);
  const previewOffers = offers.slice(0, 5);
  const firstIssue = affectedRows[0];
  const firstReason = (firstIssue.reasons || []).find((reason) => ["DUPLICATE_ASPECT", "MISSING_ASPECT"].includes(reason.code)) || {};
  const aspectLabels = [...new Set(affectedRows
    .flatMap((row) => row.aspects || [])
    .map((aspect) => aspect.name || `属性 ${aspect.id || ""}`)
    .filter(Boolean))];
  const issueSummary = [
    duplicateRows.length ? `${duplicateRows.length} 个 SKU 变体属性重复` : "",
    missingRows.length ? `${missingRows.length} 个 SKU 缺少可变特性` : "",
  ].filter(Boolean).join("，");
  const action = duplicateRows.length
    ? "为重复 SKU 填写不同的颜色、尺码或其他 Ozon 可变特性；同父 SKU 可以共用型号名称，但 aspect 组合必须不同。"
    : "先读取当前类目 aspect 属性，再给每个 SKU 补齐颜色、尺码或其他可变特性。";
  const variantAspectContexts = affectedRows.slice(0, 4).map(listingVariantAspectContext);
  const contextCopy = variantAspectContexts.map((context) => {
    const aspect = context.aspectId ? `${context.aspectName} / 属性 ID ${context.aspectId}` : context.aspectName;
    return `- ${context.offerId || "SKU"}：${aspect}；原因：${context.reason}；下一步：${context.nextAction}`;
  }).join("\n");
  const copyText = [
    `问题：${issueSummary || firstReason.message || "变体属性异常"}`,
    `受影响 SKU：${offers.join("、") || "-"}`,
    `涉及属性：${aspectLabels.join("、") || "当前类目可变特性"}`,
    contextCopy ? `SKU 明细：\n${contextCopy}` : "",
    `建议：${action}`,
    "下一步：查看变体配置工作簿，修正后重新预检；不会自动写入、不会提交 Ozon。",
  ].filter(Boolean).join("\n");
  return {
    issueSummary: issueSummary || "变体属性异常",
    affectedSkuText: previewOffers.join("、") + (offers.length > previewOffers.length ? ` 等 ${offers.length} 个` : ""),
    detail: firstReason.message || firstIssue.safeNextAction || "检查每个 SKU 的 Ozon 可变特性是否完整且互不重复。",
    action,
    copyText,
    variantAspectContexts,
  };
}

function listingRequiredAttributeConfirmationItems(requiredAttributeFillPlan = [], repairCandidates = []) {
  return (Array.isArray(requiredAttributeFillPlan) ? requiredAttributeFillPlan : [])
    .filter((row) => row?.action === "suggest_dictionary" && Array.isArray(row.dictionaryCandidates) && row.dictionaryCandidates.length)
    .slice(0, 4)
    .map((row) => {
      const candidates = row.dictionaryCandidates.slice(0, 3);
      const candidateText = candidates.map((candidate) => {
        const id = candidate.dictionaryValueId || candidate.dictionary_value_id || candidate.id || "";
        const value = candidate.value || candidate.name || "";
        return `${id ? `#${id} ` : ""}${value}`.trim();
      }).filter(Boolean).join(" / ");
      const sourceText = [...new Set(candidates.map((candidate) => candidate.source).filter(Boolean))].join(" / ") || row.source || "current_category_dictionary";
      const confidence = candidates
        .map((candidate) => Number(candidate.confidence))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => b - a)[0];
      const confidenceText = Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : "待人工判断";
      const attributeName = row.attributeName || row.name || `属性 ${row.attributeId || ""}`.trim();
      const matchReason = row.reasonZh || row.reason || "根据当前商品文本和当前类目字典生成候选。";
      const reason = "该字段是中置信字典候选，必须人工确认当前类目合法值，不能自动写入 Payload。";
      const attributeId = row.attributeId || row.id || "";
      const dictionaryValueIds = candidates
        .map((candidate) => candidate.dictionaryValueId || candidate.dictionary_value_id || candidate.id || "")
        .filter(Boolean)
        .map(String);
      const rowOfferId = String(row.offerId || row.offer_id || "").trim();
      const candidateMatchesField = (candidate) => (
        String(candidate.attributeId || "") === String(attributeId || "")
        && dictionaryValueIds.includes(String(candidate.dictionaryValueId || ""))
      );
      const scopedRepairCandidates = (Array.isArray(repairCandidates) ? repairCandidates : []).filter(candidateMatchesField);
      // A dictionary value can be legal for several variants. If the plan
      // carries an offer id, never fall back to another SKU's candidate.
      const repairCandidate = (rowOfferId
        ? scopedRepairCandidates.find((candidate) => String(candidate.offerId || "").trim() === rowOfferId)
        : scopedRepairCandidates[0]) || null;
      const repairStatusText = repairCandidate ? "可安全写回" : "暂不可直接写回";
      const safeNextStep = repairCandidate
        ? `当前 workflow 已等待人工，可确认后写回 SKU ${repairCandidate.offerId || "-"} 的属性 ${attributeName}，系统只改本地草稿并重新预检；不会提交 Ozon。`
        : row.safeNextStep || "先在属性矩阵/预检结果中确认合法候选；只有 workflow 等待人工且候选来自当前矩阵时，才能写回本地草稿并重新预检。";
      return {
        attributeId,
        attributeName,
        safetyLabel: row.safetyLabelZh || "候选需确认",
        candidateText,
        sourceText,
        confidenceText,
        repairStatusText,
        repairCandidate,
        reason,
        matchReason,
        safeNextStep,
        copyText: [
          `属性：${attributeName}${row.attributeId ? ` / ID ${row.attributeId}` : ""}`,
          `候选值：${candidateText || "-"}`,
          `写回状态：${repairStatusText}`,
          `来源：${sourceText}`,
          `匹配线索：${matchReason}`,
          `下一步：${safeNextStep}`,
          "安全边界：不会自动写 Payload，不会提交 Ozon，确认后仍需重新预检。",
        ].join("\n"),
      };
    });
}

function listingFillTaskQueueItems(run = currentListingWorkflowRun()) {
  if (!run) {
    return [{
      tone: "muted",
      label: "等待当前商品",
      title: "先绑定一个采集商品",
      body: "还没有当前 workflow，无法汇总类目属性、变体和内容分值任务。",
      meta: "安全下一步：采集商品或生成 Ozon 草稿。",
      target: "collect-parse",
    }];
  }
  const preflightNode = (run.nodes || []).find((node) => node.key === "preflight_check") || {};
  const preflightOutput = preflightNode.output || {};
  const validation = run.payloadDraftValidation || {};
  const requiredAttributeFillPlan = validation.requiredAttributeFillPlan || preflightOutput.requiredAttributeFillPlan || [];
  const requiredAttributeFillSummary = validation.requiredAttributeFillSummary || preflightOutput.requiredAttributeFillSummary || null;
  const requiredAttributeManualBacklog = validation.requiredAttributeManualBacklog || preflightOutput.requiredAttributeManualBacklog || null;
  const variantConfiguration = validation.variantConfiguration || preflightOutput.variantConfiguration || null;
  const listingQuality = validation.listingQuality || preflightOutput.listingQuality || null;
  const repairCandidates = listingFillTaskDictionaryRepairCandidates(run);
  const textRepairCandidates = listingFillTaskTextRepairCandidates(run);
  const packageRepairCandidates = listingFillTaskPackageRepairCandidates(run);
  const variantTextRepairCandidate = listingFillTaskVariantTextRepairCandidate(run);
  const variantAspectSuggestion = listingFillTaskVariantAspectSuggestion(variantConfiguration);
  const items = [];
  if (Array.isArray(requiredAttributeFillPlan) && requiredAttributeFillPlan.length) {
    const autoCount = Number(requiredAttributeFillSummary?.autofillSafeCount ?? requiredAttributeFillPlan.filter((row) => row.action === "auto_fill").length);
    const confirmCount = Number(requiredAttributeFillSummary?.candidateNeedsHumanConfirmationCount ?? requiredAttributeFillPlan.filter((row) => row.action === "suggest_dictionary").length);
    const manualCount = Number((requiredAttributeFillSummary?.manualRequiredCount ?? 0) + (requiredAttributeFillSummary?.blockedNeverGuessCount ?? 0))
      || requiredAttributeFillPlan.filter((row) => ["manual_required", "blocked_sensitive"].includes(row.action)).length;
    const confirmationItems = listingRequiredAttributeConfirmationItems(requiredAttributeFillPlan, repairCandidates);
    const manualAttributeWorkbenchGroups = requiredAttributeManualWorkbenchGroups(requiredAttributeManualBacklog, textRepairCandidates, packageRepairCandidates);
    items.push({
      tone: manualCount ? "warning" : confirmCount ? "info" : "success",
      label: "分类属性",
      title: `${requiredAttributeFillPlan.length} 个必填属性任务`,
      body: `${autoCount} 个已安全补齐，${confirmCount} 个需确认字典，${manualCount} 个需人工处理。`,
      meta: requiredAttributeFillSummary?.safeNextAction || "数据来自 requiredAttributeFillPlan，只读汇总，不自动写入或提交。",
      target: "content-images",
      attributeConfirmationItems: confirmationItems,
      manualAttributeWorkbenchGroups,
    });
  }
  const variantRows = Array.isArray(variantConfiguration?.rows) ? variantConfiguration.rows : [];
  if (variantRows.length) {
    const summary = variantConfiguration.summary || {};
    const blockedCount = Number(summary.blockedRowCount || 0);
    const imageWarningCount = Number(summary.imageWarningRowCount || 0);
    items.push({
      tone: blockedCount ? "danger" : imageWarningCount ? "warning" : "success",
      label: "变体/SKU 图",
      title: `${variantRows.length} 个 SKU 变体`,
      body: listingVariantCoverageTaskText(summary),
      meta: summary.safeNextAction || "数据来自 variantConfiguration；修复后必须重新预检。",
      target: blockedCount ? "preflight-submit" : "content-images",
      variantTextRepairCandidate: variantTextRepairCandidate && blockedCount ? variantTextRepairCandidate : null,
      variantAspectSuggestion,
    });
  }
  if (listingQuality) {
    const status = String(listingQuality.status || "");
    const score = Number.isFinite(Number(listingQuality.score)) ? `${Number(listingQuality.score)} 分` : "待评分";
    const warnings = Array.isArray(listingQuality.warnings) ? listingQuality.warnings.length : 0;
    const blockers = Array.isArray(listingQuality.blockedReasons) ? listingQuality.blockedReasons.length : 0;
    items.push({
      tone: status === "blocked" || blockers ? "danger" : warnings ? "warning" : "success",
      label: "内容分值",
      title: `Ozon 内容质量 ${score}`,
      body: `${blockers} 个阻塞项，${warnings} 个优化提醒；图片、属性、描述和尺重一起看。`,
      meta: "数据来自 listingQuality；不会触发 GPT/Image 成本或 Ozon 写操作。",
      target: "content-images",
    });
  }
  if (items.length) return items;
  return [{
    tone: "muted",
    label: "等待预检",
    title: "还没有填报诊断",
    body: "当前 workflow 尚未生成必填属性、变体或内容分值摘要。",
    meta: "安全下一步：继续生成草稿并运行提交前预检。",
    target: "preflight-submit",
  }];
}

function renderListingFillTaskQueue(run = currentListingWorkflowRun()) {
  const items = listingFillTaskQueueItems(run);
  const productTitle = run?.source?.title || run?.payloadDraft?.items?.[0]?.name || run?.id || "未绑定当前商品";
  return `
    <section class="listing-fill-task-queue" aria-label="上架填报任务队列">
      <div class="listing-fill-task-head">
        <div>
          <strong>只读填报任务队列</strong>
          <p>当前商品：${escapeHtml(productTitle)}。只汇总属性、变体/SKU 图和内容分值诊断，不编辑、不提交、不调用外部平台。</p>
        </div>
        <span>${items.length} 项</span>
      </div>
      <div class="listing-fill-task-list">
        ${items.map((item) => `
          <article class="listing-fill-task-card listing-fill-task-card-${escapeHtml(item.tone)}">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.body)}</p>
            <small>${escapeHtml(item.meta)}</small>
            ${Array.isArray(item.attributeConfirmationItems) && item.attributeConfirmationItems.length ? `
              <div class="listing-attribute-confirmation-list" aria-label="待确认字典候选">
                <strong>待确认字典候选</strong>
                ${item.attributeConfirmationItems.map((candidateItem) => `
                  <div class="listing-attribute-confirmation-item">
                    <b>${escapeHtml(candidateItem.attributeName || "字典属性")}${candidateItem.attributeId ? ` / ID ${escapeHtml(candidateItem.attributeId)}` : ""}</b>
                    <span>候选值：${escapeHtml(candidateItem.candidateText || "-")}</span>
                    <span>来源：${escapeHtml(candidateItem.sourceText || "-")} · 置信度：${escapeHtml(candidateItem.confidenceText || "待人工判断")}</span>
                    <span>写回状态：${escapeHtml(candidateItem.repairStatusText || "暂不可直接写回")}</span>
                    <span>为什么不能自动写：${escapeHtml(candidateItem.reason || "字典候选必须人工确认。")}</span>
                    <span>匹配线索：${escapeHtml(candidateItem.matchReason || "根据当前商品文本和当前类目字典生成候选。")}</span>
                    <span>下一步：${escapeHtml(candidateItem.safeNextStep || "人工确认后写回本地草稿并重新预检。")}</span>
                    ${candidateItem.repairCandidate ? `<button
                      type="button"
                      data-workflow-action="apply-attribute-dictionary-repair"
                      data-workflow-run-id="${escapeHtml(candidateItem.repairCandidate.runId)}"
                      data-workflow-node-key="${escapeHtml(candidateItem.repairCandidate.nodeKey)}"
                      data-repair-offer-id="${escapeHtml(candidateItem.repairCandidate.offerId)}"
                      data-repair-attribute-id="${escapeHtml(candidateItem.repairCandidate.attributeId)}"
                      data-repair-dictionary-value-id="${escapeHtml(candidateItem.repairCandidate.dictionaryValueId)}"
                      data-repair-value="${escapeHtml(candidateItem.repairCandidate.value)}"
                      data-repair-source-suggested-aspect="${candidateItem.repairCandidate.sourceSuggestedAspect ? "true" : "false"}"
                      data-repair-source-value="${escapeHtml(candidateItem.repairCandidate.sourceValue || "")}"
                      data-repair-source-variant-spec="${escapeHtml(candidateItem.repairCandidate.sourceVariantSpec || "")}"
                      title="${escapeHtml(candidateItem.repairCandidate.attributeName || "字典属性")}"
                    >确认写入草稿并预检</button>` : ""}
                  </div>
                `).join("")}
              </div>
            ` : ""}
            ${Array.isArray(item.manualAttributeWorkbenchGroups) && item.manualAttributeWorkbenchGroups.length
              ? renderRequiredAttributeManualWorkbench(item.manualAttributeWorkbenchGroups)
              : ""}
            ${item.variantTextRepairCandidate ? `<button
              type="button"
              data-workflow-action="apply-variant-text-repair"
              data-workflow-run-id="${escapeHtml(item.variantTextRepairCandidate.runId)}"
              data-workflow-node-key="${escapeHtml(item.variantTextRepairCandidate.nodeKey)}"
              data-repair-offer-id="${escapeHtml(item.variantTextRepairCandidate.offerId)}"
              data-repair-attribute-id="${escapeHtml(item.variantTextRepairCandidate.attributeId)}"
              data-repair-value="${escapeHtml(item.variantTextRepairCandidate.suggestedValue || "")}"
              data-repair-source-suggested-aspect="${item.variantTextRepairCandidate.sourceSuggestedAspect ? "true" : "false"}"
              title="${escapeHtml(item.variantTextRepairCandidate.attributeName || "变体文本属性")}"
            >${item.variantTextRepairCandidate.suggestedValue ? "确认写入 1688 规格候选并预检" : "填写变体文本并预检"}</button>` : ""}
            ${item.variantAspectSuggestion ? `
              <div class="listing-variant-suggestion">
                <strong>变体属性修复建议</strong>
                <span>受影响 SKU：${escapeHtml(item.variantAspectSuggestion.affectedSkuText || "-")}</span>
                <p>${escapeHtml(item.variantAspectSuggestion.detail || item.variantAspectSuggestion.issueSummary)}</p>
                <small>${escapeHtml(item.variantAspectSuggestion.action || "修复后重新预检；不会自动提交 Ozon。")}</small>
                ${Array.isArray(item.variantAspectSuggestion.variantAspectContexts) && item.variantAspectSuggestion.variantAspectContexts.length ? `
                  <ul class="listing-variant-context-list" aria-label="变体 SKU 修复上下文">
                    ${item.variantAspectSuggestion.variantAspectContexts.map((context) => `
                      <li>
                        <b>SKU：${escapeHtml(context.offerId || "-")}</b>
                        <span>属性：${escapeHtml(context.aspectName || "当前类目可变特性")}${context.aspectId ? ` / 属性 ID ${escapeHtml(context.aspectId)}` : ""}</span>
                        <span>为什么卡住：${escapeHtml(context.reason || context.statusText || "变体属性待检查")}</span>
                        <span>下一步：${escapeHtml(context.nextAction || "修正后重新预检；不会自动提交 Ozon。")}</span>
                      </li>
                    `).join("")}
                  </ul>
                ` : ""}
                <div class="listing-variant-suggestion-actions">
                  <button
                    type="button"
                    class="ghost"
                    data-listing-variant-suggestion-copy="true"
                    data-workflow-action="copy-repair-template"
                    data-repair-copy="${escapeHtml(item.variantAspectSuggestion.copyText)}"
                  >复制修复建议</button>
                  <button
                    type="button"
                    data-listing-task-view="workflow-console"
                    data-listing-task-run-id="${escapeHtml(run?.id || "")}"
                    data-listing-task-node-key="preflight_check"
                  >查看变体工作簿</button>
                </div>
              </div>
            ` : ""}
            <button
              type="button"
              data-listing-task-view="${escapeHtml(item.target)}"
              data-listing-task-run-id="${escapeHtml(run?.id || "")}"
              data-listing-task-node-key="preflight_check"
            >定位处理区</button>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderListingStagePanels() {
  const tabs = $("#listingSecondaryTabs");
  const panels = $("#listingStagePanels");
  if (!tabs || !panels) return;
  renderListingRequiredAttributeRulePoolWorkbench();
  const active = state.listingStage || "current-product";
  tabs.querySelectorAll("[data-listing-stage]").forEach((button) => {
    button.classList.toggle("active", button.dataset.listingStage === active);
  });
  panels.innerHTML = renderListingFillTaskQueue(currentListingWorkflowRun()) + LISTING_CENTER_STAGES.map((stage, index) => {
    const selected = stage.key === active;
    return `
      <article class="listing-stage-panel ${selected ? "active" : ""}" data-listing-stage-panel="${escapeHtml(stage.key)}">
        <div class="listing-stage-index">${String(index + 1).padStart(2, "0")}</div>
        <div class="listing-stage-body">
          <div class="listing-stage-head">
            <strong>${escapeHtml(stage.label)}</strong>
            <span>${escapeHtml(stage.owner)}</span>
          </div>
          <p>${escapeHtml(stage.body)}</p>
          <div class="listing-stage-checks">
            ${stage.checks.map((item) => `<em>${escapeHtml(item)}</em>`).join("")}
          </div>
          <footer>
            <small>${escapeHtml(listingStageStatus(stage))}</small>
            <button type="button" data-listing-stage-view="${escapeHtml(stage.view)}">${escapeHtml(stage.action)}</button>
          </footer>
        </div>
      </article>
    `;
  }).join("");
}

function setListingStage(stageKey) {
  if (!LISTING_CENTER_STAGES.some((stage) => stage.key === stageKey)) return;
  state.listingStage = stageKey;
  renderListingStagePanels();
}

function renderListingAutomationGuardrails() {
  const grid = $("#listingAutomationGuardrailGrid");
  if (!grid) return;
  grid.innerHTML = ERP_AUTOMATION_GUARDRAILS.map((item) => `
    <article class="automation-guardrail-card">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(workflowNodeTitle(item.node) || item.node)}</span>
      </div>
      <p>${escapeHtml(item.rule)}</p>
      <footer>
        <code>${escapeHtml(item.evidence)}</code>
        <button type="button" data-cockpit-view="${escapeHtml(item.view)}">查看对应入口</button>
      </footer>
    </article>
  `).join("");
}

function singleListingOutcomeState() {
  const latestRun = sellerWorkflowRuns()
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))[0];
  const nodes = Array.isArray(latestRun?.nodes) ? latestRun.nodes : [];
  const blockingNode = nodes.find((node) => node.status === "failed" || node.status === "waiting_human")
    || nodes.find((node) => Number(node.riskScore || 0) >= 70);
  const latestJob = [...(state.autoListJobs || [])]
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))[0];
  const capturedTitle = state.collected1688?.title || state.currentCaptureDraft?.title || latestJob?.sourceTitle || latestRun?.source?.title || "";
  const currentProductTask = latestRun?.summary?.currentProductTask || null;
  if (!capturedTitle && !latestRun) {
    return {
      status: "未开始",
      title: "还没有当前商品",
      stuckAt: "未采集商品",
      reason: "ERP 还没有可推进的 1688 商品，所以不能生成 Ozon 草稿。",
      next: "下一步：打开 1688 采集，先采集一个商品。",
      view: "sourcing",
      action: "去采集 1688",
    };
  }
  if (currentProductTask) {
    return {
      status: currentProductTask.status === "blocked" ? "卡住" : currentProductTask.status === "waiting" ? "等待" : currentProductTask.status === "needs_improvement" ? "可优化" : "推进中",
      title: currentProductTask.productTitle || capturedTitle || latestRun?.id || "当前商品",
      stuckAt: currentProductTask.blockedAt
        || (workflowNodeTitle(currentProductTask.nodeKey || "") !== "未命名节点"
          ? workflowNodeTitle(currentProductTask.nodeKey || "")
          : sellerTaskStageTitle(currentProductTask.stage)),
      reason: currentProductTask.reason || "当前商品需要按工作流摘要处理。",
      next: `下一步：${currentProductTask.nextAction || "查看当前商品任务"}`,
      view: currentProductTask.view || "workflow-console",
      action: currentProductTask.view === "warehouse" ? "查看库存队列" : currentProductTask.view === "listing" ? "继续上架优化" : "定位工作流",
      runId: latestRun?.id || "",
      nodeKey: currentProductTask.nodeKey || "",
    };
  }
  if (blockingNode) {
    const issue = pipelineStageLatestIssue(latestRun, blockingNode);
    return {
      status: blockingNode.status === "failed" ? "卡住" : "等待人工",
      title: capturedTitle || latestRun?.id || "当前 workflow",
      stuckAt: workflowNodeTitle(blockingNode.key),
      reason: issue?.message || "该节点需要人工查看输入、输出和诊断。",
      next: "下一步：进入节点诊断，按字段修复或确认继续。",
      view: "workflow-console",
      action: "定位工作流",
      runId: latestRun?.id || "",
      nodeKey: blockingNode.key || "",
    };
  }
  if (latestRun) {
    return {
      status: "推进中",
      title: capturedTitle || latestRun.id,
      stuckAt: workflowNodeTitle(nodes.at(-1)?.key || "preflight_check"),
      reason: "当前没有阻塞节点，可以继续按主流程推进。",
      next: "下一步：进入上架草稿，检查分类、属性、价格和图片。",
      view: "listing",
      action: "继续上架草稿",
    };
  }
  return {
    status: "已采集",
    title: capturedTitle,
    stuckAt: "等待生成草稿",
    reason: "商品已采集，但还没有绑定到工作流和 Ozon payload 草稿。",
    next: "下一步：进入上架草稿，生成并预检 Ozon 填写项。",
    view: "listing",
    action: "生成 Ozon 草稿",
  };
}

function latestCurrentProductTask() {
  const taskPriority = {
    blocked: 0,
    waiting: 1,
    needs_improvement: 2,
    running: 3,
    ready: 4,
    done: 5,
  };
  return sellerWorkflowRuns()
    .map((run) => ({
      task: run.summary?.currentProductTask || null,
      updatedAt: run.updatedAt || run.createdAt || "",
    }))
    .filter((item) => item.task?.stage)
    .sort((left, right) => {
      const leftPriority = taskPriority[left.task.status] ?? 9;
      const rightPriority = taskPriority[right.task.status] ?? 9;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return String(right.updatedAt).localeCompare(String(left.updatedAt));
    })[0]?.task || null;
}

function renderCurrentProductTaskReminder(task, options = {}) {
  if (!task?.stage) return "";
  const placement = options.placement === "products" ? "product-current-task-reminder" : "today-reminder-current-task";
  const statusLabel = task.status === "blocked"
    ? "卡住"
    : task.status === "waiting"
      ? "等待人工"
      : task.status === "needs_improvement"
        ? "可优化"
        : "推进中";
  const title = task.productTitle || task.offerId || task.runId || "当前商品";
  const nodeTitle = workflowNodeTitle(task.nodeKey || "");
  const blockedAt = task.blockedAt || (nodeTitle !== "未命名节点" ? nodeTitle : sellerTaskStageTitle(task.stage));
  const reason = task.reason || "当前商品需要按工作流摘要处理。";
  const nextAction = task.nextAction || "进入对应业务模块继续处理。";
  const taskView = String(task.view || "").trim();
  const taskViewLabel = taskView === "warehouse"
    ? "去库存核对"
    : taskView === "orders"
      ? "去订单履约"
      : taskView === "products"
        ? "查看商品运营"
        : "进入处理";
  return `
    <article class="${placement}" aria-label="当前商品任务">
      <span>当前商品任务 · ${escapeHtml(statusLabel)}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(blockedAt)}：${escapeHtml(reason)}</p>
      <small>安全下一步：${escapeHtml(nextAction)}</small>
      ${taskView ? `<button type="button" class="ghost" data-cockpit-view="${escapeHtml(taskView)}">${escapeHtml(taskViewLabel)}</button>` : ""}
    </article>
  `;
}

function renderSingleListingOutcomePanel() {
  const body = $("#singleListingOutcomeBody");
  if (!body) return;
  const outcome = singleListingOutcomeState();
  body.innerHTML = `
    <article class="outcome-step-card active">
      <span>当前商品</span>
      <strong>${escapeHtml(outcome.title)}</strong>
      <p>${escapeHtml(outcome.status)}</p>
    </article>
    <article class="outcome-step-card warning">
      <span>现在卡在哪</span>
      <strong>${escapeHtml(outcome.stuckAt)}</strong>
      <p>${escapeHtml(outcome.reason)}</p>
    </article>
    <article class="outcome-step-card next">
      <span>下一步</span>
      <strong>${escapeHtml(outcome.next)}</strong>
      <button class="primary" type="button" data-outcome-view="${escapeHtml(outcome.view)}" data-outcome-run-id="${escapeHtml(outcome.runId || "")}" data-outcome-node-key="${escapeHtml(outcome.nodeKey || "")}">${escapeHtml(outcome.action)}</button>
    </article>
  `;
}

function renderSellerManagementScope() {
  const grid = $("#sellerManagementScopeGrid");
  if (!grid) return;
  grid.innerHTML = SELLER_ERP_MANAGEMENT_SCOPES.map((item) => `
    <article class="seller-scope-card">
      <div class="seller-scope-card-head">
        <strong>${escapeHtml(item.area)}</strong>
        <button type="button" data-cockpit-view="${escapeHtml(item.view)}">进入</button>
      </div>
      <p>${escapeHtml(item.promise)}</p>
      <div class="seller-scope-tags">
        ${item.owns.map((scope) => `<span>${escapeHtml(scope)}</span>`).join("")}
      </div>
      <small>${escapeHtml(item.next)}</small>
    </article>
  `).join("");
}

function renderErpModuleOwnership() {
  renderSellerOperatingModel();
  renderListingSellerTaskSummary();
  renderErpArchitectureMap();
  renderListingStagePanels();
  renderListingPipelineWorkbench();
  renderListingAutomationGuardrails();
  renderSingleListingOutcomePanel();
  renderSellerManagementScope();
  renderSecondaryDomainPanels();
  const navigator = $("#erpWorkflowNavigator");
  if (navigator) {
    const phaseCounts = cockpitWorkflowPhases();
    navigator.innerHTML = ERP_WORKFLOW_NAVIGATION.map((item, index) => `
      <button class="erp-workflow-step ${phaseCounts[item.phase]?.risk ? "has-risk" : ""}" type="button" data-view="${escapeHtml(item.view)}" title="${escapeHtml(item.check)}">
        <span>0${index + 1}</span>
        <strong>${escapeHtml(item.phase)}</strong>
        <b>${Number(phaseCounts[item.phase]?.count || 0)}</b>
        <small>${escapeHtml(workflowNodeTitle(item.node))}</small>
      </button>
    `).join("");
  }
  const moduleGrid = $("#moduleOwnershipGrid");
  if (moduleGrid) {
    moduleGrid.innerHTML = ERP_MODULE_OWNERSHIP.map((item) => `
      <article class="module-card">
        <div class="module-card-head">
          <strong>${escapeHtml(item.tab)}</strong>
          <span>${escapeHtml(item.role)}</span>
        </div>
        <div class="module-card-body">
          <p><b>归属：</b>${item.owns.map(escapeHtml).join(" / ")}</p>
          <p><b>不归属：</b>${item.excludes.map(escapeHtml).join(" / ")}</p>
          <small>${escapeHtml(item.next)}</small>
        </div>
      </article>
    `).join("");
  }
  const apiGrid = $("#sellerApiCoverageGrid");
  if (apiGrid) {
    apiGrid.innerHTML = OZON_SELLER_API_ALIGNMENT.map((item) => `
      <article class="api-coverage-card api-coverage-${apiAlignmentClass(item.status)}">
        <div class="api-coverage-head">
          <strong>${escapeHtml(item.area)}</strong>
          <span>${escapeHtml(item.status)}</span>
        </div>
        <code>${item.api.map(escapeHtml).join(" · ")}</code>
        <p>${escapeHtml(item.gap)}</p>
      </article>
    `).join("");
  }
  const gapGrid = $("#sellerApiGapGrid");
  if (gapGrid) {
    gapGrid.innerHTML = OZON_SELLER_API_GAP_BACKLOG.map((item) => `
      <article class="api-gap-card api-gap-${apiGapPriorityClass(item.priority)}">
        <div class="api-gap-head">
          <span>${escapeHtml(item.priority)}</span>
          <strong>${escapeHtml(item.area)}</strong>
        </div>
        <small>${escapeHtml(item.tab)}</small>
        <code>${item.api.map(escapeHtml).join(" · ")}</code>
        <p>${escapeHtml(item.task)}</p>
        <em>${escapeHtml(item.reason)}</em>
      </article>
    `).join("");
  }
}

function renderErpWorkflowNavigator() {
  renderErpModuleOwnership();
}

function workflowStatusBusinessLabel(status = "") {
  const labels = {
    waiting_human: "需要人工确认后继续",
    node_failed: "业务步骤失败，需要修复字段或策略",
    blocked: "当前步骤被安全闸阻止",
    preflight_blocked: "提交前检查未通过",
    manual_intervention: "需要人工处理页面或数据",
  };
  return labels[status] || workflowStatusLabel(status);
}

function cockpitWorkflowPhases() {
  const phases = {
    "采集": { count: 0, risk: false },
    "分析": { count: 0, risk: false },
    "上架": { count: 0, risk: false },
    "审核回馈": { count: 0, risk: false },
    "库存闭环": { count: 0, risk: false },
  };
  for (const run of state.workflowRuns || []) {
    const key = String(run.currentNode || run.summary?.currentNodeKey || "");
    let phase = "分析";
    if (/crawler_1688|candidate_parse/.test(key)) phase = "采集";
    else if (/match_profit|ozon_learning|keyword_expand/.test(key)) phase = "分析";
    else if (/content_generate|preflight_check|ozon_submit/.test(key)) phase = "上架";
    else if (/review_reconcile/.test(key)) phase = "审核回馈";
    else if (/stock_sync|live/.test(key)) phase = "库存闭环";
    phases[phase].count += 1;
    phases[phase].risk ||= run.status === "waiting_human" || run.summary?.riskLevel === "high";
  }
  return phases;
}

// Keep the offline golden-path seller task visible at the ordinary seller
// entry point.  Real workflow runs may carry an explicit goldenPathSellerTask
// when they were produced from a replay/controlled handoff; older runs only
// expose currentProductTask, so the fallback is deliberately labelled as a
// workflow-derived summary rather than pretending it is an Ozon response.
function latestGoldenPathSellerTask() {
  const runs = sellerWorkflowRuns()
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")));
  for (const run of runs) {
    const explicit = run?.goldenPathSellerTask || run?.summary?.goldenPathSellerTask;
    if (explicit && typeof explicit === "object") {
      return {
        ...explicit,
        title: explicit.title || run.title || run.source?.title || "当前商品",
        view: explicit.view || run.summary?.currentProductTask?.view || "listing",
        runId: run.id || "",
        sourceLabel: "黄金链路任务摘要",
      };
    }
    const current = run?.summary?.currentProductTask;
    if (current && typeof current === "object" && current.stage) {
      return {
        status: current.status === "blocked" ? "blocked" : current.status === "waiting" ? "waiting_human" : current.status || "running",
        blockedStage: current.blockedAt || current.stage,
        reasonCode: current.reasonCode || "WORKFLOW_CURRENT_PRODUCT_TASK",
        reason: current.reason || "当前商品需要按黄金链路继续处理。",
        nextAction: current.nextAction || "进入上架中心继续处理当前商品。",
        sideEffect: "仅打开本地业务模块并显示当前任务；不会调用 Ozon 写接口。",
        title: current.productTitle || current.offerId || run.title || "当前商品",
        view: current.view || "listing",
        runId: run.id || "",
        sourceLabel: "工作流任务映射（非 Ozon 审核回执）",
      };
    }
  }
  return null;
}

function renderGoldenPathSellerTask() {
  const target = $("#goldenPathSellerTaskStatus");
  if (!target) return;
  const stageLabels = {
    source: "1688 货源采集",
    sku: "SKU 绑定",
    category: "类目与属性",
    content: "俄文内容",
    media: "图片媒体",
    pricing: "价格与费用",
    preflight: "提交前预检",
  };
  const task = latestGoldenPathSellerTask();
  if (!task) {
    target.innerHTML = `<article><span>状态</span><strong>暂无当前商品</strong><small>先从 1688 采集商品；刷新后这里会显示黄金链路的安全下一步。</small><button type="button" class="primary" data-cockpit-view="sourcing">去采集 1688 商品</button></article>`;
    return;
  }
  const status = String(task.status || "unknown");
  const statusLabel = status === "blocked"
    ? "当前阻塞"
    : status === "waiting_human" || status === "waiting"
      ? "等待人工"
      : status === "needs_confirmation"
        ? "等待确认"
        : "推进中";
  const view = String(task.view || "listing");
  const progress = task.stageProgress && typeof task.stageProgress === "object" ? task.stageProgress : null;
  const blockedStageLabel = stageLabels[task.blockedStage] || stageLabels[task.reasonCode] || "当前阶段";
  const completedStages = Array.isArray(progress?.completedStages) ? progress.completedStages : [];
  const remainingStages = Array.isArray(progress?.remainingStages) ? progress.remainingStages : [];
  const progressHtml = progress
    ? `<article><span>链路进度</span><strong>${Number(progress.completedCount || completedStages.length)}/${Number(progress.totalCount || (completedStages.length + remainingStages.length))} 阶段完成</strong><small>已完成：${escapeHtml(completedStages.map((stage) => stageLabels[stage] || stage).join("、") || "暂无")}；待处理：${escapeHtml(remainingStages.map((stage) => stageLabels[stage] || stage).join("、") || "无")}</small></article>`
    : "";
  target.innerHTML = `
    <article><span>当前商品</span><strong>${escapeHtml(task.title || "当前商品")}</strong><small>${escapeHtml(task.sourceLabel || "黄金链路任务摘要")}</small></article>
    <article><span>卡点</span><strong>${escapeHtml(statusLabel)} · ${escapeHtml(blockedStageLabel)}</strong><small>${escapeHtml(task.reason || "当前商品需要继续处理")}</small></article>
    ${progressHtml}
    <article><span>安全下一步</span><strong>${escapeHtml(task.nextAction || "进入对应模块继续处理")}</strong><small>${escapeHtml(task.sideEffect || "仅查看或修改本地草稿，不会自动提交 Ozon")}</small>${view ? `<button type="button" class="primary" data-cockpit-view="${escapeHtml(view)}" data-golden-path-run-id="${escapeHtml(task.runId || "")}">去处理</button>` : ""}</article>
  `;
}

function renderStoreOperatingOverview() {
  const sales = $("#storeSalesOverview");
  const health = $("#storeBusinessHealthGrid");
  const reminderRail = $("#todayReminderRail");
  const orders = state.orderRows || [];
  const products = state.productRows || [];
  const promotions = state.promotionRows || [];
  const workflows = sellerWorkflowRuns();
  const summary = sellerWorkflowSummary();
  const currentProductTask = latestCurrentProductTask();
  renderGoldenPathSellerTask();
  // The dashboard must not derive a sales number from whatever order rows are
  // currently in memory.  A page can be partial and order lines can omit
  // amount/quantity fields; summing unit prices here made incomplete evidence
  // look like a store KPI.  The server finance read model is the single
  // conservative source and only exposes revenue after a complete batch with
  // complete line coverage.
  const financeOrder = state.financeReadModel?.order || null;
  const orderRevenue = financeOrder?.state === "complete"
    && financeOrder?.revenueCoverage?.complete === true
    && Number.isFinite(Number(financeOrder.revenue))
    ? Number(financeOrder.revenue)
    : null;
  const awaitingOrders = orders.filter((order) => ["awaiting_packaging", "awaiting_deliver"].includes(order.status)).length;
  const orderBatch = state.orderBatch || {};
  const orderSellerStatus = String(orderBatch.sellerStatus || orderBatch.sellerView?.status || "");
  const orderEvidenceKnown = orderBatch.loaded === true
    && orderBatch.failed !== true
    && orderBatch.partial !== true
    && !["unknown", "manual_review", "error"].includes(orderSellerStatus);
  const riskyProducts = products.filter((item) => ["error", "needFix"].includes(item.status_group) || item.status === "error").length;
  const stockCounts = productStockCounts(products);
  const lowStockProducts = stockCounts.lowStockProducts.length;
  const unknownStockProducts = stockCounts.unknownStockProducts.length;
  const promotionCoverageKnown = promotionCoverageComplete();
  const activePromotions = promotionCoverageKnown
    ? promotions.filter((item) => !/inactive|closed|finished/i.test(String(item.status || ""))).length
    : null;
  const waitingHuman = Number(summary.waitingHuman || 0);
  if ($("#workflowStatusCount")) $("#workflowStatusCount").textContent = String(workflows.length || 0);
  if ($("#erpDashboardOrderCell")) $("#erpDashboardOrderCell").textContent = String(orders.length || "-");
  if ($("#erpDashboardProductCell")) $("#erpDashboardProductCell").textContent = String(products.length || "-");
  if (sales) {
    sales.innerHTML = `
      <article><span>当前读取范围销售额</span><strong>${orderRevenue !== null ? orderRevenue.toFixed(0) : "-"}</strong><small>${orderRevenue !== null ? "当前订单范围完整且订单行金额已核对；不是结算利润" : "订单范围或金额证据未完整，不显示合计"}</small></article>
      <article><span>当前订单批次</span><strong>${orders.length || "-"}</strong><small>${awaitingOrders} 单待备货/发运；数量仅代表当前已加载范围</small></article>
      <article><span>商品风险</span><strong>${riskyProducts}</strong><small>${products.length || 0} 个商品已加载</small></article>
      <article><span>活动中</span><strong>${activePromotions === null ? "-" : activePromotions}</strong><small>${activePromotions === null ? "活动范围未完整读取，不显示数量" : `${promotions.length || 0} 个活动已加载`}</small></article>
    `;
  }
  if (health) {
    health.innerHTML = `
      <section id="storeProductHealth" class="store-health-panel">
        <div><span>商品健康</span><strong>${riskyProducts ? "需处理" : "稳定"}</strong></div>
        <p>${riskyProducts ? `${riskyProducts} 个商品存在审核、缺价或资料风险。` : "当前已加载商品没有高风险状态。"}</p>
        <button type="button" data-cockpit-view="products">进入商品管理</button>
      </section>
      <section id="storeOrderFulfillment" class="store-health-panel">
        <div><span>订单履约</span><strong>${!orderBatch.loaded ? "待同步" : !orderEvidenceKnown ? "状态未知" : awaitingOrders ? "有待处理" : "暂无积压"}</strong></div>
        <p>${!orderBatch.loaded ? "尚未读取订单，不能判断是否有履约积压。" : !orderEvidenceKnown ? "订单读取不完整或解释状态未知，不能据此判断没有积压。" : awaitingOrders ? `${awaitingOrders} 单需要人工核对；订单状态不会触发备货或发运。` : "已加载订单里没有待备货/待发运积压。"}</p>
        <button type="button" data-cockpit-view="orders">进入订单履约</button>
      </section>
      <section id="storeInventoryRisk" class="store-health-panel">
        <div><span>库存仓库</span><strong>${lowStockProducts ? "有缺库存" : unknownStockProducts ? "库存未知" : "已同步"}</strong></div>
        <p>${lowStockProducts ? `${lowStockProducts} 个商品已明确为 0 库存。` : unknownStockProducts ? `${unknownStockProducts} 个商品尚未获得当前库存证据，不能按 0 判断。` : "当前已加载商品均有明确库存证据。"}</p>
        <button type="button" data-cockpit-view="warehouse">进入库存仓库</button>
      </section>
      <section id="storeProfitSnapshot" class="store-health-panel">
        <div><span>财务利润</span><strong>待核算</strong></div>
        <p>销售额、采购成本、物流费、佣金和最低价风险统一进入财务利润域。</p>
        <button type="button" data-cockpit-view="finance">进入财务利润</button>
      </section>
    `;
  }
  if (reminderRail) {
    const reminders = [
      waitingHuman ? { title: "上架安全闸", body: `${waitingHuman} 个流程需要人工确认`, view: "workflow-console", tone: "warning" } : null,
      awaitingOrders ? { title: "订单履约", body: `${awaitingOrders} 单待处理`, view: "orders", tone: "warning" } : null,
      riskyProducts ? { title: "商品管理", body: `${riskyProducts} 个商品需修复`, view: "products", tone: "danger" } : null,
      activePromotions ? { title: "营销活动", body: `${activePromotions} 个活动可查看`, view: "promotions", tone: "info" } : null,
    ].filter(Boolean);
    reminderRail.innerHTML = `
      <div class="today-reminder-head">
        <span>今日提醒</span>
        <strong>${reminders.length || 0}</strong>
      </div>
      <div class="today-reminder-list">
        ${renderCurrentProductTaskReminder(currentProductTask, { placement: "dashboard" })}
        ${reminders.length ? reminders.map((item) => `
          <button type="button" class="today-reminder-item ${escapeHtml(item.tone)}" data-cockpit-view="${escapeHtml(item.view)}">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.body)}</span>
          </button>
        `).join("") : `<p class="hint">当前没有高优先级提醒。订单、库存、商品和活动数据刷新后会自动更新。</p>`}
      </div>
      <section id="cockpitWorkflowFocus" class="cockpit-workflow-focus">
        <div class="section-headline"><div><h2>上架诊断提醒</h2><p class="hint">只显示需要跳转处理的异常。</p></div></div>
      </section>
    `;
  }
}

function writeCommandStateLabel(state) {
  return state === "needs_review" ? "需要人工复核" : "执行已陈旧，结果未知";
}

function productStockCounts(products = []) {
  const rows = Array.isArray(products) ? products : [];
  return {
    lowStockProducts: rows.filter((item) => productStockEvidenceState(item) === "zero"),
    unknownStockProducts: rows.filter((item) => productStockEvidenceState(item) === "unknown"),
  };
}

// A non-empty first page is not proof of the store's complete activity set.
function promotionCoverageComplete(sellerResult = state.promotionSellerResult, evidence = state.promotionEvidence) {
  // A status label is not sufficient evidence of full store coverage. Older
  // adapters can say `complete` for a successfully returned page while
  // omitting pagination/total metadata; treating that as a complete activity
  // set would turn a stale first page into a seller KPI.
  return sellerResult?.coverageComplete === true || evidence?.coverageComplete === true;
}

function renderWriteCommandAttention(data = {}) {
  const target = $("#writeCommandAttentionList");
  if (!target) return;
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    target.innerHTML = `<article class="write-command-attention-empty"><strong>没有待复核写操作</strong><p>当前没有结果未知或执行陈旧的 Ozon 写命令。</p></article>`;
    return;
  }
  target.innerHTML = items.map((item) => `
    <article class="write-command-attention-item">
      <div>
        <span class="status-pill warning">${escapeHtml(writeCommandStateLabel(item.state))}</span>
        <strong>${escapeHtml(item.action || "Ozon 写操作")}</strong>
        <small>${escapeHtml(item.storeId ? `店铺 ${item.storeId}` : "店铺未标记")} · 发起于 ${escapeHtml(formatDateTime(item.createdAt))}</small>
      </div>
      <p><b>为什么要复核：</b>${escapeHtml(item.reason || "系统无法安全判断写入结果。")}</p>
      <p><b>安全下一步：</b>${escapeHtml(item.safeNextStep || "先只读回查 Ozon 平台状态；核实前不会自动重试，也不要手动重复写入。")}</p>
    </article>
  `).join("");
}

async function loadWriteCommandAttention() {
  const target = $("#writeCommandAttentionList");
  if (!target) return true;
  try {
    const data = await api("/api/ozon/write-command-attention");
    renderWriteCommandAttention(data);
    return true;
  } catch (error) {
    target.innerHTML = `<article class="write-command-attention-empty"><strong>待复核状态读取失败</strong><p>${escapeHtml(error.message)}</p><small>请稍后刷新；读取失败不会触发任何写入。</small></article>`;
    return false;
  }
}

function financeAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function financeOrderLineAmount(product = {}) {
  const lineTotal = financeAmount(product.total_price ?? product.totalPrice ?? product.line_total ?? product.amount);
  if (lineTotal !== null) return lineTotal;
  const unitPrice = financeAmount(product.price ?? product.offer_price ?? product.offerPrice);
  if (unitPrice === null) return null;
  const quantity = financeAmount(product.quantity ?? product.count ?? product.qty);
  // A unit price without an observed quantity is not a one-item line.  The
  // server finance model applies the same rule; keeping the UI fallback
  // conservative prevents an offline/older response from manufacturing
  // revenue by silently assuming quantity=1.
  return quantity === null ? null : unitPrice * quantity;
}

function financeSnapshotRevenue(orders, orderBatch) {
  const complete = orderBatch.loaded === true
    && orderBatch.failed !== true
    && orderBatch.partial !== true
    && orderBatch.hasNext !== true;
  if (!complete) return null;
  let total = 0;
  let unknownLine = false;
  let excludedOrder = false;
  for (const order of Array.isArray(orders) ? orders : []) {
    const status = String(order?.statusGroup || order?.status || "").trim().toLowerCase();
    const substatus = String(order?.substatus || "").trim().toLowerCase();
    // Keep the compatibility path aligned with the server finance model:
    // cancelled/disputed postings need settlement/refund evidence before
    // their lines can be called realized sales.
    if (status === "cancelled" || status === "dispute" || substatus.includes("dispute")) {
      excludedOrder = true;
      continue;
    }
    for (const product of Array.isArray(order?.products) ? order.products : []) {
      const amount = financeOrderLineAmount(product);
      if (amount === null) unknownLine = true;
      else total += amount;
    }
  }
  return unknownLine || excludedOrder ? null : total;
}

function domainPanelSnapshot() {
  const orders = state.orderRows || [];
  const products = state.productRows || [];
  const promotions = state.promotionRows || [];
  const workflows = sellerWorkflowRuns();
  const summary = sellerWorkflowSummary();
  const orderBatch = state.orderBatch || null;
  const orderCoverageKnown = orderBatch?.loaded === true
    && orderBatch.failed !== true
    && orderBatch.partial !== true
    && orderBatch.hasNext !== true
    && orderBatch.paginationComplete !== false;
  const revenue = financeSnapshotRevenue(orders, orderBatch || {});
  // An empty/partial order array is not evidence that there are no disputes or
  // cancellations. Keep service metrics unknown until the current store's
  // complete order scope is known.
  const awaitingOrders = orderCoverageKnown ? orders.filter((order) => ["awaiting_packaging", "awaiting_deliver"].includes(order.status)).length : null;
  const disputeOrders = orderCoverageKnown ? orders.filter((order) => order.status === "dispute" || String(order.substatus || "").includes("dispute")).length : null;
  const cancelledOrders = orderCoverageKnown ? orders.filter((order) => order.status === "cancelled").length : null;
  const riskyProducts = products.filter((item) => ["error", "needFix"].includes(item.status_group) || item.status === "error");
  const stockCounts = productStockCounts(products);
  const lowStockProducts = stockCounts.lowStockProducts;
  const unknownStockProducts = stockCounts.unknownStockProducts;
  // A non-empty activity page is not a complete store activity set. Keep an
  // unknown value explicit so the finance panel cannot turn a partial read
  // into a count of active promotions.
  const activePromotions = promotionCoverageComplete()
    ? promotions.filter((item) => !/inactive|closed|finished/i.test(String(item.status || "")))
    : null;
  const waitingHuman = Number(summary.waitingHuman || workflows.filter((run) => run.status === "waiting_human").length);
  const highRisk = Number(summary.highRisk || workflows.filter((run) => run.summary?.riskLevel === "high").length);
  const blocked = Number(summary.blocking || workflows.filter((run) => run.status === "blocked" || run.summary?.blockingNodeName).length);
  return {
    orders,
    orderBatch,
    products,
    promotions,
    workflows,
    revenue,
    activityImpact: state.promotionImpactPreview || null,
    financeReadModel: state.financeReadModel || null,
    awaitingOrders,
    disputeOrders,
    cancelledOrders,
    riskyProducts,
    lowStockProducts,
    unknownStockProducts,
    activePromotions,
    waitingHuman,
    highRisk,
    blocked,
  };
}

function buildFinanceSellerResultFromSnapshot(snapshot = {}) {
  const batch = snapshot.orderBatch || {};
  const checkedAtMs = batch.checkedAt ? Date.parse(String(batch.checkedAt)) : null;
  const staleOrderEvidence = batch.checkedAt
    && (!Number.isFinite(checkedAtMs) || checkedAtMs > Date.now() + 5 * 60 * 1000 || Date.now() - checkedAtMs > 60 * 60 * 1000);
  const complete = batch.loaded === true && batch.failed !== true && batch.partial !== true && batch.hasNext !== true;
  // A legacy/older response may not carry the server finance projection.  In
  // that fallback path, a complete page with an unknown order-line amount is
  // not observed revenue: the snapshot deliberately returns `null` for that
  // case.  Keep the seller result blocked instead of displaying an "observed"
  // card with no value (or encouraging a profit conclusion from incomplete
  // rows).  The server projection applies the same gate.
  const revenueKnown = complete
    && batch.paginationComplete !== false
    && snapshot.revenue !== null
    && snapshot.revenue !== undefined
    && snapshot.revenue !== ""
    && Number.isFinite(Number(snapshot.revenue));
  const failed = batch.failed === true;
  const orderState = staleOrderEvidence ? "unknown" : failed ? "unknown" : batch.loaded !== true ? "unknown" : !complete ? "partial" : revenueKnown ? "complete" : "unknown";
  const orderCode = failed
    ? "ORDER_READ_FAILED"
    : staleOrderEvidence
      ? (Number.isFinite(checkedAtMs) ? "ORDER_READ_STALE" : "ORDER_READ_TIMESTAMP_INVALID")
    : batch.loaded !== true
      ? "ORDER_READ_NOT_RUN"
      : !complete
        ? "ORDER_READ_INCOMPLETE"
        : batch.paginationComplete === false
          ? "ORDER_PAGINATION_EVIDENCE_MISSING"
          : revenueKnown ? "ORDER_READ_COMPLETE" : "ORDER_REVENUE_FIELDS_UNKNOWN";
  const orderReason = failed
    ? "订单读取失败，当前缓存不能作为全店销售额。"
    : staleOrderEvidence
      ? "订单读取证据已过期或时间无效，当前缓存不能作为当前销售额。"
    : batch.loaded !== true
      ? "订单尚未读取，当前没有销售额证据。"
      : !complete
        ? "订单批次不完整或仍有后续分页，不能代表全店销售额。"
        : batch.paginationComplete === false
          ? "订单读取缺少可核对的分页结束证据，当前页面不能代表销售额范围。"
          : revenueKnown
        ? "订单读取批次已结束。"
        : "订单范围已读取，但部分订单行缺少可核对金额字段，当前合计不能代表全店销售额。";
  const impact = snapshot.activityImpact || {};
  const knownPriceCount = Number(impact.knownPriceCount || 0);
  const summary = [
    {
      key: "revenue",
      label: "订单销售额",
      status: orderState === "complete" && revenueKnown ? "observed" : orderState === "partial" ? "blocked" : "unknown",
      code: orderCode,
      reason: orderReason,
      nextAction: orderState === "complete"
        ? "可查看当前已完成订单范围的销售额。"
        : orderCode === "ORDER_REVENUE_FIELDS_UNKNOWN"
          ? "补齐订单行金额或改用带财务明细的订单读取，再查看销售额。"
        : ["ORDER_READ_STALE", "ORDER_READ_TIMESTAMP_INVALID"].includes(orderCode)
          ? "重新读取当前店铺订单范围，确认读取时间有效且在新鲜窗口内后再查看销售额。"
          : "完成订单范围读取（含全部分页）后再查看销售额。",
      value: revenueKnown ? snapshot.revenue : null,
    },
    {
      key: "activityImpact",
      label: "活动价格影响",
      status: knownPriceCount > 0 ? "estimate" : "unknown",
      code: knownPriceCount > 0 ? "ACTIVITY_PRICE_IMPACT_ONLY" : "ACTIVITY_IMPACT_NOT_AVAILABLE",
      reason: knownPriceCount > 0 ? "仅比较活动价与当前价，不代表利润或结算结果。" : "没有可比较的活动价格证据。",
      nextAction: "仅将活动数据用于价格影响参考，不要据此宣称利润。",
      value: knownPriceCount > 0 ? `${knownPriceCount} 个可比较` : "未知",
    },
    {
      key: "costSettlement",
      label: "成本/结算证据",
      status: "unknown",
      code: "FINANCE_COST_SETTLEMENT_EVIDENCE_MISSING",
      reason: "采购成本、物流费、佣金、杂费和结算规则尚未形成可追溯证据。",
      nextAction: "补齐成本、费用和结算规则证据。",
      value: "未知",
    },
    {
      key: "profit",
      label: "利润结论",
      status: "unknown",
      code: "FINANCE_SETTLEMENT_NOT_VERIFIED",
      reason: "不从订单金额、活动折扣或定价估算推导确定利润。",
      nextAction: "完成结算证据回读并核对成本后，再生成利润报表。",
      value: "未知",
    },
  ];
  const blockers = [];
  if (orderState !== "complete") blockers.push(orderCode);
  blockers.push("FINANCE_COST_SETTLEMENT_EVIDENCE_MISSING");
  if (knownPriceCount > 0) blockers.push("ACTIVITY_PRICE_IMPACT_NOT_PROFIT");
  return {
    state: blockers.length ? "blocked" : "ready_for_review",
    blockerCodes: blockers,
    nextAction: orderState !== "complete"
      ? ["ORDER_READ_STALE", "ORDER_READ_TIMESTAMP_INVALID"].includes(orderCode)
        ? "重新读取当前店铺订单范围，确认读取时间有效且在新鲜窗口内后再查看销售额。"
        : "先读取并完成当前店铺订单范围（含全部分页），再查看销售额。"
      : "补齐采购成本、物流费、佣金、杂费和结算规则证据；未补齐前不要宣称利润。",
    evidenceSummary: summary,
    sideEffect: "只生成只读经营摘要，不会修改订单、活动、价格或结算数据。",
  };
}

function domainMetricCard(label, value, note, view) {
  const displayValue = value === null || value === undefined ? "未知" : value;
  return `
    <article class="domain-metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(displayValue))}</strong>
      <small>${escapeHtml(note)}</small>
      ${view ? `<button type="button" data-cockpit-view="${escapeHtml(view)}">进入</button>` : ""}
    </article>
  `;
}

function domainRiskItem(title, body, view, tone = "info") {
  return `
    <button type="button" class="domain-risk-item ${escapeHtml(tone)}" data-cockpit-view="${escapeHtml(view)}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(body)}</span>
    </button>
  `;
}

function renderFinanceProfitPanel() {
  const grid = $("#financeProfitGrid");
  const list = $("#financeRiskList");
  if (!grid && !list) return;
  const snapshot = domainPanelSnapshot();
  const finance = snapshot.financeReadModel || {
    sellerResult: buildFinanceSellerResultFromSnapshot(snapshot),
  };
  const sellerResult = finance.sellerResult || buildFinanceSellerResultFromSnapshot(snapshot);
  const evidenceSummary = Array.isArray(finance.evidenceSummary)
    ? finance.evidenceSummary
    : (Array.isArray(sellerResult.evidenceSummary) ? sellerResult.evidenceSummary : []);
  const orderBatch = snapshot.orderBatch || {};
  const orderReadIncomplete = orderBatch.failed === true
    || orderBatch.partial === true
    || orderBatch.loaded !== true
    || orderBatch.hasNext === true
    || orderBatch.paginationComplete === false;
  const financeEvidenceNote = orderBatch.failed === true
    ? "订单读取失败；销售额未知，请先重试订单读取"
    : orderBatch.loaded !== true
      ? "尚未读取订单；销售额未知，请先读取订单"
      : orderBatch.partial === true || orderBatch.hasNext === true || orderBatch.paginationComplete === false
        ? "订单读取范围未完成；销售额未知，不能用当前批次代表全店"
        : "仅按已读取订单估算；成本、物流、佣金和结算仍未知";
  const costEvidenceNote = "成本/结算证据：采购成本、物流费、佣金、杂费和结算规则尚未形成可追溯证据";
  if (grid) {
    grid.innerHTML = [
      ...evidenceSummary.slice(0, 4).map((entry) => domainMetricCard(
        `${entry.label}${entry.status === "observed" ? "" : "（待补证据）"}`,
        entry.value === null || entry.value === undefined ? "未知" : entry.value,
        `${entry.reason} 下一步：${entry.nextAction}`,
        entry.key === "revenue" ? "orders" : entry.key === "activityImpact" ? "promotions" : "reports",
      )),
    ].join("");
  }
  if (list) {
    const items = [
      domainRiskItem(
        sellerResult.state === "blocked" ? "财务证据未闭环" : "财务证据可复核",
        `${sellerResult.nextAction} ${sellerResult.sideEffect || "仅读取，不修改经营数据。"}`,
        "finance",
        sellerResult.state === "blocked" ? "warning" : "info",
      ),
      ...evidenceSummary.filter((entry) => entry.status !== "observed").map((entry) => domainRiskItem(
        `${entry.label}：${entry.status === "estimate" ? "估算" : "未知"}`,
        `${entry.reason} 下一步：${entry.nextAction}`,
        entry.key === "revenue" ? "orders" : entry.key === "activityImpact" ? "promotions" : "finance",
        entry.status === "estimate" ? "info" : "warning",
      )),
      snapshot.highRisk ? domainRiskItem("高风险定价", `${snapshot.highRisk} 条流程需要复核利润或最低价。`, "workflow-console", "warning") : "",
      snapshot.activePromotions === null
        ? domainRiskItem("活动范围未知", "活动读取覆盖不完整，不能据此判断店铺活动数量或价格影响。", "promotions", "warning")
        : snapshot.activePromotions.length
          ? domainRiskItem("活动仅为价格影响预览", `${snapshot.activePromotions.length} 个活动可能改变成交价；没有采购成本、佣金和结算证据，不能推导利润。`, "promotions", "info")
          : "",
      orderReadIncomplete ? domainRiskItem("财务证据未闭环", `${financeEvidenceNote}；下一步：进入订单履约读取完整批次。`, "orders", "warning") : "",
      domainRiskItem("利润口径仍未知", `${costEvidenceNote}；活动折扣不能替代结算规则。`, "finance", "warning"),
    ].filter(Boolean);
    list.innerHTML = items.join("");
  }
}

function renderServiceRiskPanel() {
  const grid = $("#serviceRiskGrid");
  const list = $("#serviceQueueList");
  if (!grid && !list) return;
  const snapshot = domainPanelSnapshot();
  if (grid) {
    grid.innerHTML = [
      domainMetricCard("争议订单", snapshot.disputeOrders, "来自订单履约状态", "orders"),
      domainMetricCard("取消订单", snapshot.cancelledOrders, "需后续归因到售后/库存/物流", "orders"),
      domainMetricCard("商品异常", snapshot.riskyProducts.length, "审核失败和资料风险可能转售后", "products"),
      domainMetricCard("待人工流程", snapshot.waitingHuman, "人工确认后再继续自动化", "workflow-console"),
    ].join("");
  }
  if (list) {
    const items = [
      snapshot.disputeOrders === null ? domainRiskItem("争议订单范围未知", "订单尚未完成当前店铺范围读取，不能判断没有争议订单。", "orders", "warning") : "",
      snapshot.disputeOrders ? domainRiskItem("优先处理争议", `${snapshot.disputeOrders} 个争议订单需要售后介入。`, "orders", "danger") : "",
      snapshot.cancelledOrders === null ? domainRiskItem("取消订单范围未知", "订单尚未完成当前店铺范围读取，不能判断没有取消订单。", "orders", "warning") : "",
      snapshot.cancelledOrders ? domainRiskItem("取消订单复盘", `${snapshot.cancelledOrders} 个取消订单需要归因。`, "orders", "warning") : "",
      snapshot.riskyProducts.length ? domainRiskItem("商品资料风险", `${snapshot.riskyProducts.length} 个商品异常可能影响售后。`, "products", "warning") : "",
      domainRiskItem("售后动作尚未接入", "当前先从订单页查看争议和取消；本页只展示风险，不处理退货或客服动作。", "orders", "info"),
    ].filter(Boolean);
    list.innerHTML = items.join("");
  }
}

function renderReportsPanel() {
  const grid = $("#reportsMetricGrid");
  const list = $("#reportsTrendList");
  if (!grid && !list) return;
  const snapshot = domainPanelSnapshot();
  if (grid) {
    grid.innerHTML = [
      domainMetricCard("订单样本", snapshot.orders.length, "当前已加载订单", "orders"),
      domainMetricCard("商品样本", snapshot.products.length, "当前已加载商品", "products"),
      domainMetricCard("上架流程", snapshot.workflows.length, "workflow 成功率和卡点来源", "workflow-console"),
      domainMetricCard(
        "营销活动",
        snapshot.activePromotions === null ? "未知" : snapshot.activePromotions.length,
        snapshot.activePromotions === null
          ? "活动范围未完整读取，不能据此判断活动数量"
          : "当前完整读取范围内的活动表现和候选商品来源",
        "promotions",
      ),
    ].join("");
  }
  if (list) {
    list.innerHTML = [
      domainRiskItem("销售趋势", "按日/周/月汇总销售额、订单数、取消和争议。", "orders", "info"),
      domainRiskItem("商品表现", "在售、审核失败、缺库存、缺价和异常商品进入商品报表。", "products", "info"),
      domainRiskItem("上架成功率", "按采集、属性、定价、预检、提交、审核回馈统计漏斗。", "workflow-console", "info"),
      domainRiskItem("选品效果", "1688 候选、Ozon 样本、匹配利润和换货源次数汇总。", "sourcing", "info"),
    ].join("");
  }
}

function renderSystemConfigPanel() {
  const grid = $("#systemStatusGrid");
  const list = $("#systemAutomationList");
  if (!grid && !list) return;
  const snapshot = domainPanelSnapshot();
  const workerOnline = Boolean(state.crawlerWorkerStatus?.online || state.crawlerWorkerStatus?.connected || state.crawlerWorkerStatus?.active);
  const observability = observabilitySellerStatus(state.observabilitySummary);
  if (grid) {
    grid.innerHTML = [
      domainMetricCard("店铺 API", $("#healthStatus")?.textContent || "未测试", `${state.stores.length} 个店铺`, "dashboard"),
      domainMetricCard("服务观测", observability.label, observability.nextAction, "system"),
      domainMetricCard("1688 采集器", workerOnline ? "在线" : "待连接", "浏览器插件与人机状态", "sourcing"),
      domainMetricCard("自动化锁", snapshot.waitingHuman, "waiting_human 流程必须人工处理", "workflow-console"),
      domainMetricCard("运行流程", snapshot.workflows.length, "工作流日志和高级诊断", "workflow-console"),
    ].join("");
  }
  if (list) {
    list.innerHTML = [
      observability.state === "unknown"
        ? domainRiskItem("服务观测尚未读取", observability.nextAction, "system", "info")
        : observability.state === "alert"
          ? domainRiskItem("服务观测有告警", observability.nextAction, "system", "warning")
          : "",
      domainRiskItem("Ozon 提交安全", "提交商品必须通过 preflight，并带 confirmSubmit 人工确认。", "workflow-console", "warning"),
      domainRiskItem("自动化模式", "默认 observe_only；高风险动作不自动提交外部平台。", "system", "info"),
      domainRiskItem("字典与插件", "Ozon 类目属性字典、1688 插件、运行日志统一在系统配置维护。", "system", "info"),
    ].join("");
  }
  renderRuntimeSafetyStatus(state.runtimeSafetySnapshot);
  renderMigrationStateStatus(state.migrationStateAudit);
}

function observabilitySellerStatus(summary = null) {
  if (!summary || typeof summary !== "object") {
    return { state: "unknown", label: "未读取", nextAction: "点击 API 测试后再查看服务错误告警；这不代表 Seller API 或业务 readiness。" };
  }
  if (summary.error || summary.failed === true) {
    return { state: "alert", label: "读取失败", nextAction: "重新读取服务观测摘要；先处理服务错误，再判断 API 或业务状态。" };
  }
  const alerts = Array.isArray(summary.alerts) ? summary.alerts : [];
  const high = alerts.filter((alert) => String(alert?.severity || "").toLowerCase() === "high").length;
  if (high) {
    return { state: "alert", label: `${high} 个高优先级告警`, nextAction: "查看服务错误和运行日志；告警处理前不要把 API 连通当作生产或业务就绪。" };
  }
  return { state: "ok", label: alerts.length ? `${alerts.length} 个一般告警` : "无高优先级告警", nextAction: alerts.length ? "查看一般告警；它们不等于 Seller API 或业务 readiness。" : "服务观测未发现高优先级告警；仍需单独核对运行配置和业务证据。" };
}

function renderRuntimeSafetyStatus(snapshot = state.runtimeSafetySnapshot) {
  const target = $("#runtimeSafetyStatus");
  if (!target) return;
  const safety = runtimeSafetySellerStatus(snapshot || {});
  target.dataset.state = safety.blocked ? "needs_review" : "verified";
  target.innerHTML = `<strong>${escapeHtml(safety.label)}</strong><span>下一步：${escapeHtml(safety.nextAction)}</span>`;
  renderSystemOperatorActionStatus(snapshot, state.migrationStateAudit);
}

async function loadRuntimeSafetySummary() {
  const target = $("#runtimeSafetyStatus");
  if (target) target.textContent = "正在核验认证、持久化和店铺作用域…";
  try {
    const data = await api("/api/system/runtime-safety");
    state.runtimeSafetySnapshot = data;
    renderRuntimeSafetyStatus(data);
    return data;
  } catch (error) {
    state.runtimeSafetySnapshot = { error: String(error?.message || "运行安全摘要读取失败") };
    renderRuntimeSafetyStatus(state.runtimeSafetySnapshot);
    return null;
  }
}

function renderMigrationStateStatus(audit = state.migrationStateAudit) {
  const target = $("#migrationStateStatus");
  if (!target) return;
  if (!audit) {
    target.textContent = "尚未读取迁移状态；读取只读本地状态，不连接数据库。";
    renderSystemOperatorActionStatus(state.runtimeSafetySnapshot, audit);
    return;
  }
  if (audit.error) {
    target.dataset.state = "needs_review";
    target.innerHTML = `<strong>迁移状态读取失败</strong><span>下一步：${escapeHtml(audit.error)}；检查本地状态文件后重新读取。</span>`;
    renderSystemOperatorActionStatus(state.runtimeSafetySnapshot, audit);
    return;
  }
  const blockers = Array.isArray(audit.blockers) ? audit.blockers : [];
  const nextAction = String(audit.nextAction || blockers[0]?.nextAction || "迁移状态完整；仍需按部署环境执行恢复演练。");
  target.dataset.state = audit.ok === true ? "verified" : "needs_review";
  const blockerSummary = blockers.length
    ? `<ul>${blockers.slice(0, 4).map((item) => `<li><code>${escapeHtml(item.code || "MIGRATION_BLOCKED")}</code>：${escapeHtml(item.nextAction || "请查看部署预检输出")}</li>`).join("")}</ul>`
    : "";
  target.innerHTML = `<strong>迁移状态：${escapeHtml(audit.state || (audit.ok ? "complete" : "blocked"))}</strong><span>下一步：${escapeHtml(nextAction)}</span>${blockerSummary}`;
  renderSystemOperatorActionStatus(state.runtimeSafetySnapshot, audit);
}

function renderSystemOperatorActionStatus(runtimeSafety = state.runtimeSafetySnapshot, migration = state.migrationStateAudit) {
  const target = $("#systemOperatorActionStatus");
  if (!target) return;
  const runtime = runtimeSafety ? runtimeSafetySellerStatus(runtimeSafety) : null;
  const migrationBlockers = Array.isArray(migration?.blockers) ? migration.blockers : [];
  const deployment = state.deploymentPreflight;
  const deploymentBlockers = Array.isArray(deployment?.blockers) ? deployment.blockers : [];
  // A local preflight with no blockers is still not production readiness. If
  // it has been read, preserve its explicit deploymentReady=false boundary
  // whenever another system panel re-renders this shared operator status.
  const deploymentNotReady = deployment && deployment.deploymentReady !== true;
  const blocker = runtime?.blocked
    ? `运行配置：${runtime.nextAction}`
    : migrationBlockers[0]?.nextAction
      || deploymentBlockers[0]?.nextAction
      || (deploymentNotReady ? "本地门禁结果不能证明生产已就绪；请在受控终端完成真实迁移和恢复演练。" : "");
  const needsReview = Boolean(blocker);
  target.dataset.state = needsReview ? "needs_review" : "verified";
  target.innerHTML = needsReview
    ? `<strong>当前不能宣称可部署</strong><span>运维下一步：${escapeHtml(blocker)}</span><small>解决后点击上方按钮重新读取；最后再在受控终端执行 <code>npm run deployment-preflight</code>。</small>`
    : `<strong>本地阻断项未发现</strong><span>下一步：复制并在受控终端执行部署预检。</span><small>此页面仍不连接数据库，也不代表真实迁移或恢复已验证。</small>`;
}

async function copyDeploymentPreflightCommand() {
  const command = "npm run deployment-preflight";
  const target = $("#systemOperatorActionStatus");
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(command);
    else {
      const input = document.createElement("textarea");
      input.value = command;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    if (target) target.innerHTML = `<strong>命令已复制</strong><span><code>${command}</code></span><small>请在受控部署终端运行；本页面未执行命令。</small>`;
    toast("部署预检命令已复制");
  } catch {
    if (target) target.innerHTML = `<strong>复制失败</strong><span>请手动运行 <code>${command}</code>。</span>`;
    toast("复制失败，请手动运行部署预检", "warning");
  }
}

async function loadMigrationStateAudit() {
  const target = $("#migrationStateStatus");
  if (target) target.textContent = "正在读取本地迁移状态…";
  try {
    const data = await api("/api/system/migration-state");
    state.migrationStateAudit = data;
    renderMigrationStateStatus(data);
    return data;
  } catch (error) {
    state.migrationStateAudit = { error: String(error?.message || "迁移状态读取失败") };
    renderMigrationStateStatus(state.migrationStateAudit);
    return null;
  }
}

async function loadDeploymentPreflight() {
  const target = $("#systemOperatorActionStatus");
  if (target) target.textContent = "正在检查生产门禁（仅读取本地配置和状态）…";
  try {
    const data = await api("/api/system/deployment-preflight");
    state.deploymentPreflight = data;
    const blockers = Array.isArray(data.blockers) ? data.blockers : [];
    // Low disk space is the most immediate recovery risk; surface it first
    // even when runtime/migration declarations have other blockers. The API
    // remains read-only and the operator still has to free/expand storage.
    const first = blockers.find((item) => item.check === "disk_space") || blockers[0];
    const diskSpace = data.diskSpace || {};
    const diskHint = first?.check === "disk_space" && diskSpace.availableBytes != null && Number.isFinite(Number(diskSpace.availableBytes))
      ? ` 当前可用 ${Number(diskSpace.availableBytes)} bytes，最低要求 ${Number(diskSpace.minimumFreeBytes)} bytes。`
      : "";
    const blockerList = blockers.slice(0, 5).map((item) => {
      const label = item?.check || item?.code || "DEPLOYMENT_BLOCKED";
      const detail = item?.blocker?.code || item?.blocker || item?.nextAction || "请查看部署预检输出";
      return `<li><code>${escapeHtml(label)}</code>：${escapeHtml(String(detail))}</li>`;
    }).join("");
    const blockerListHtml = blockerList ? `<ul class="deployment-preflight-blockers">${blockerList}</ul>` : "";
    if (target) {
      // The endpoint is intentionally a local, read-only preflight.  Even an
      // empty blocker list cannot prove a deploy is ready: the contract keeps
      // deploymentReady=false until the deployment operator runs the real
      // migration/recovery procedure.  Keep this state actionable rather
      // than presenting a green "verified" badge that operators could read
      // as production readiness.
      const locallyClear = data.ok === true && data.deploymentReady !== true;
      const productionReady = data.ok === true && data.deploymentReady === true;
      target.dataset.state = productionReady ? "verified" : "needs_review";
      target.innerHTML = productionReady
        ? `<strong>生产门禁通过</strong><span>仍需保留迁移和恢复演练回执，并按部署变更流程上线。</span><small>验证等级：${escapeHtml(data.verificationLevel || "locally_tested")}。</small>`
        : locallyClear
          ? `<strong>本地门禁未发现阻断，但生产未就绪</strong><span>仍需在受控终端执行真实迁移、恢复演练和部署预检。</span><small>验证等级：${escapeHtml(data.verificationLevel || "locally_tested")}；本页面未连接数据库，也不代表可部署。</small>`
        : `<strong>生产门禁仍被阻断</strong><span>运维下一步：${escapeHtml((first?.nextAction || data.nextAction || "查看部署预检阻断项") + diskHint)}</span><small>阻断 ${blockers.length} 项；解决后重新检查，最后在受控终端运行 <code>npm run deployment-preflight</code>。未执行迁移或 Ozon 写入。</small>`;
      if (!productionReady && target.innerHTML && blockerListHtml) target.innerHTML += blockerListHtml;
    }
    return data;
  } catch (error) {
    state.deploymentPreflight = { error: String(error?.message || "生产门禁读取失败") };
    if (target) {
      target.dataset.state = "needs_review";
      target.innerHTML = `<strong>生产门禁读取失败</strong><span>下一步：${escapeHtml(state.deploymentPreflight.error)}；请在受控终端运行部署预检。</span>`;
    }
    return null;
  }
}

// Keep permission/scope failures in seller language.  The API intentionally
// returns a reasonCode instead of store names or credentials; this projection
// must remain equally safe and actionable for a normal operator.
function readOperatorReceiptRecovery(errorOrSummary = {}) {
  const responseData = errorOrSummary?.responseData || {};
  const reasonCode = String(errorOrSummary?.reasonCode || responseData.reasonCode || "").trim();
  const status = Number(errorOrSummary?.httpStatus || responseData.status || 0);
  const known = {
    PRINCIPAL_STORE_SCOPE_REQUIRED: {
      title: "当前会话没有绑定店铺权限",
      nextAction: "请让管理员把当前 ERP 会话绑定到允许的店铺后重新登录，再刷新只读回执。",
    },
    READ_RECEIPT_STORE_SCOPE_REQUIRED: {
      title: "系统还没有配置可读取的店铺范围",
      nextAction: "请管理员配置部署店铺范围和当前会话的店铺范围，再重新检查只读回执。",
    },
    PRINCIPAL_STORE_ACCESS_DENIED: {
      title: "当前会话不能访问所选店铺",
      nextAction: "切换到当前会话已授权的店铺，或让管理员补充店铺范围后重新读取。",
    },
    STORE_ACCESS_DENIED: {
      title: "部署范围未允许所选店铺",
      nextAction: "请管理员把目标店铺加入部署允许范围后重新检查；本次没有读取 Ozon。",
    },
    READ_OPERATOR_STORE_SCOPE_INVALID: {
      title: "读取店铺范围标识无效",
      nextAction: "清除手工填写的店铺范围并使用系统生成的计划，再重新检查。",
    },
  }[reasonCode];
  if (known) return { ...known, reasonCode, status, sideEffect: String(responseData.sideEffect || "本次只校验权限范围，不会读取或写入 Ozon。") };
  if (status === 401) return {
    title: "ERP 会话已失效或未登录",
    nextAction: "重新建立 ERP 会话后，再刷新当前环境的只读回执。",
    reasonCode: reasonCode || "AUTH_REQUIRED",
    status,
    sideEffect: "本次没有读取或写入 Ozon。",
  };
  return {
    title: "只读回执状态暂时无法读取",
    nextAction: "先确认当前环境和会话，再重试；失败不会把旧回执当作当前证据。",
    reasonCode: reasonCode || "READ_OPERATOR_RECEIPT_READ_FAILED",
    status,
    sideEffect: "本次没有读取或写入 Ozon。",
  };
}

function readOperatorReceiptFreshnessRecovery(latest = {}, sellerTask = {}) {
  if (latest?.stale === true) return {
    title: "最近回执已过期",
    nextAction: "按当前店铺、环境和读取范围重新执行受控只读回查；旧回执不能用于上架、价格或库存判断。",
  };
  if (latest?.endpointCoverageComplete !== true) return {
    title: "最近回执的读取范围不完整",
    nextAction: "补齐计划要求的 Seller API 只读端点后重新回查；当前结果只能作部分证据。",
  };
  if (sellerTask?.status === "needs_review") return {
    title: String(sellerTask.title || "只读结果需要人工复核"),
    nextAction: String(sellerTask.nextAction || "按回执的失败原因和当前店铺范围人工复核后再读取。"),
  };
  return {
    title: String(sellerTask.title || "只读结果待核验"),
    nextAction: String(sellerTask.nextAction || "确认店铺、环境和读取范围后再继续业务操作。"),
  };
}

function validateReadOperatorEnvironment(value) {
  const environment = String(value || "").trim();
  if (!environment) return { ok: false, reasonCode: "READ_OPERATOR_ENVIRONMENT_REQUIRED", message: "请先填写读取环境标识；不能跨环境汇总只读回执。" };
  if (environment.length < 3 || environment.length > 120 || /[\u0000-\u001f\u007f]/.test(environment)) {
    return { ok: false, reasonCode: "READ_OPERATOR_ENVIRONMENT_INVALID", message: "读取环境标识需为 3-120 个可见字符；请使用当前部署的唯一环境名。" };
  }
  return { ok: true, environment };
}

function currentSellerReadEnvironment() {
  // General product/order/stock reads belong to the system operator scope.
  // The listing field is only a fallback for the category/attribute workbench;
  // a stale listing value must not poison unrelated Seller API requests.
  return String($("#readOperatorEnvironment")?.value || $("#listingReadEnvironment")?.value || "").trim();
}

// Keep the ordinary operator view focused on the business decision.  Hashes,
// endpoint names and receipt ids remain available only in the collapsed
// diagnostics panel so a seller does not need to interpret API internals.
function renderReadOperatorReceiptBusinessCard(summary = state.readOperatorReceiptSummary) {
  const card = $("#readOperatorReceiptBusinessStatus");
  const diagnostics = $("#readOperatorReceiptDiagnostics");
  if (!card) return;
  const cells = card.querySelectorAll("div");
  const setCell = (index, value) => { if (cells[index]) cells[index].querySelector("strong").textContent = String(value || "—"); };
  const setDiagnostics = (value) => { if (diagnostics) diagnostics.textContent = String(value || "暂无高级诊断信息"); };
  if (!summary) {
    setCell(0, "尚未选择环境"); setCell(1, "待读取");
    setCell(2, "需要先填写读取环境"); setCell(3, "填写环境后刷新回执");
    setCell(4, "只读取本地脱敏回执，不会访问或写入 Ozon。");
    setDiagnostics("尚未读取诊断信息");
    return;
  }
  if (summary.error) {
    const recovery = readOperatorReceiptRecovery(summary);
    setCell(0, "当前读取环境"); setCell(1, "需要复核");
    setCell(2, recovery.title); setCell(3, recovery.nextAction);
    setCell(4, recovery.sideEffect);
    setDiagnostics(`reasonCode: ${recovery.reasonCode}\nhttpStatus: ${recovery.status || "—"}`);
    return;
  }
  const latest = summary.latest;
  if (!latest) {
    setCell(0, "当前环境 / 已授权店铺范围"); setCell(1, "暂无回执");
    setCell(2, "还没有可用于判断当前状态的只读证据");
    setCell(3, "先确认 session proof 和四店铺计划矩阵，再执行当前店铺只读");
    setCell(4, summary.sideEffect || "这里只读取本地回执，不会访问或写入 Ozon。");
    setDiagnostics(`receiptCount: ${Number(summary.receiptCount || 0)}\ncountScope: ${summary.countScope || "—"}`);
    return;
  }
  const task = latest.sellerTask || {};
  const stale = latest.stale === true;
  const incomplete = latest.endpointCoverageComplete !== true;
  const needsReview = stale || incomplete || task.status === "needs_review" || latest.status !== "success";
  const statusLabel = needsReview ? (stale ? "已过期，需要重新读取" : latest.status === "success" ? "范围不完整，需要复核" : "读取失败，需要复核") : "读取成功，可作为当前只读证据";
  const scope = latest.scope?.name || "当前店铺只读范围";
  const offers = Number.isFinite(Number(latest.scope?.offerCount)) ? ` · ${Number(latest.scope?.offerCount)} 个商品范围` : "";
  const shortHash = latest.storeRefHash ? `${String(latest.storeRefHash).slice(0, 15)}…` : "店铺范围哈希缺失";
  setCell(0, `${scope}${offers} · 店铺 ${shortHash}`);
  setCell(1, statusLabel);
  setCell(2, task.title || (incomplete ? "Seller API 读取端点未覆盖完整" : "服务端回执需要人工确认"));
  setCell(3, task.nextAction || "确认范围后按当前店铺计划重新读取");
  setCell(4, task.sideEffect || summary.sideEffect || "只读取并保存脱敏回执，不会写入 Ozon。");
  setDiagnostics([
    `receiptId: ${latest.id || "—"}`,
    `checkedAt: ${latest.checkedAt || "—"}`,
    `status: ${latest.status || "unknown"}`,
    `endpointCoverageComplete: ${latest.endpointCoverageComplete === true}`,
    `endpoints: ${Array.isArray(latest.endpoints) ? latest.endpoints.join(", ") || "—" : "—"}`,
    `responseHash: ${latest.responseHash || "—"}`,
  ].join("\n"));
}

function renderReadOperatorReceiptStatus(summary = state.readOperatorReceiptSummary) {
  const target = $("#readOperatorReceiptStatus");
  if (!target) return;
  renderReadOperatorReceiptBusinessCard(summary);
  if (!summary) {
    target.textContent = "尚未读取回执状态；刷新只读回执不会联网，只读取本地脱敏回执。";
    return;
  }
  if (summary.error) {
    const recovery = readOperatorReceiptRecovery(summary);
    target.dataset.state = "needs_review";
    target.dataset.reasonCode = recovery.reasonCode;
    target.textContent = `${recovery.title}：${recovery.nextAction} ${recovery.sideEffect}`;
    return;
  }
  const latest = summary.latest;
  const sellerTask = latest?.sellerTask || {};
  const coverage = latest?.endpointCoverageComplete === true ? "端点覆盖完整" : "端点覆盖不完整";
  const stale = latest?.stale === true;
  const recovery = readOperatorReceiptFreshnessRecovery(latest, sellerTask);
  target.dataset.state = stale || latest?.endpointCoverageComplete !== true || sellerTask?.status === "needs_review"
    ? "needs_review"
    : "verified";
  target.dataset.reasonCode = stale ? "READ_OPERATOR_RECEIPT_STALE" : latest?.endpointCoverageComplete !== true ? "READ_OPERATOR_RECEIPT_SCOPE_INCOMPLETE" : "";
  target.textContent = latest
    ? `服务端回执 ${Number(summary.receiptCount || 0)} 条；最近：${formatDateTime(latest.checkedAt)}；状态 ${stale ? "stale（已过期）" : (latest.status || "unknown")}，${coverage}。${recovery.title}：${recovery.nextAction} 真实读取不代表写入成功。`
    : `当前没有服务端只读回执（${Number(summary.receiptCount || 0)} 条）；先生成明确店铺、环境和读取范围的计划，再由授权操作者确认执行。`;
}

async function loadReadOperatorReceipts() {
  const button = $("#refreshReadOperatorReceipts");
  setBusy(button, true);
  try {
    const environmentCheck = validateReadOperatorEnvironment($("#readOperatorEnvironment")?.value);
    if (!environmentCheck.ok) {
      state.readOperatorReceiptSummary = { error: environmentCheck.message, reasonCode: environmentCheck.reasonCode, httpStatus: 400, responseData: { reasonCode: environmentCheck.reasonCode, sideEffect: "仅校验环境标识，不会联网或读取 Ozon。" } };
      renderReadOperatorReceiptStatus(state.readOperatorReceiptSummary);
      return null;
    }
    const environment = environmentCheck.environment;
    const storeId = String(selectedStoreId() || "").trim();
    if (!storeId) {
      state.readOperatorReceiptSummary = { error: "必须先选择当前店铺。", reasonCode: "READ_OPERATOR_STORE_SCOPE_REQUIRED", httpStatus: 400, responseData: { reasonCode: "READ_OPERATOR_STORE_SCOPE_REQUIRED", sideEffect: "仅校验店铺范围，不会联网或读取 Ozon。" } };
      renderReadOperatorReceiptStatus(state.readOperatorReceiptSummary);
      return null;
    }
    const storeRefHash = await sha256Text(storeId);
    const query = `?environment=${encodeURIComponent(environment)}&storeRefHash=${encodeURIComponent(storeRefHash)}`;
    const data = await api(`/api/ozon/read-operator/receipts${query}`);
    state.readOperatorReceiptSummary = data;
    renderReadOperatorReceiptStatus(data);
    return data;
  } catch (error) {
    const recovery = readOperatorReceiptRecovery(error);
    state.readOperatorReceiptSummary = {
      error: String(error?.message || "读取失败"),
      reasonCode: recovery.reasonCode,
      httpStatus: recovery.status,
      responseData: { reasonCode: recovery.reasonCode, sideEffect: recovery.sideEffect },
    };
    renderReadOperatorReceiptStatus(state.readOperatorReceiptSummary);
    return null;
  } finally {
    setBusy(button, false);
  }
}

function renderReadOperatorMatrix(matrix = state.readOperatorMatrix) {
  const target = $("#readOperatorMatrixStatus");
  if (!target) return;
  if (!matrix) return;
  if (matrix.error) {
    target.textContent = `四店铺计划检查失败：${matrix.error}；失败不会触发 Ozon 请求。`;
    return;
  }
  const stores = Array.isArray(matrix.matrix?.stores) ? matrix.matrix.stores : [];
  const rows = stores.map((entry) => {
    const hash = String(entry.storeRefHash || "");
    const shortHash = hash ? `${hash.slice(0, 15)}…` : "店铺哈希缺失";
    const storeLabel = String(entry.storeLabel || "当前店铺").trim();
    const plan = entry.ok ? "计划通过" : "计划阻塞";
    const receipt = entry.latestReceipt
      ? `最近回执 ${formatDateTime(entry.latestReceipt.checkedAt)} · ${entry.latestReceipt.status || "unknown"}`
      : "尚无服务端回执";
    return `<div class="system-read-operator-matrix-row"><strong>${escapeHtml(storeLabel)}</strong><small>${escapeHtml(shortHash)}</small><span>${escapeHtml(plan)} · ${escapeHtml(receipt)}</span></div>`;
  }).join("");
  const proof = state.sessionProofSummary;
  const proofText = proof?.ok === true
    ? `session proof 已获取 · ${escapeHtml(proof.authSource || "signed session")} · 环境 ${escapeHtml(proof.environment || "当前环境")} · ${Number(Array.isArray(proof.storeIds) ? proof.storeIds.length : 0)} 店铺范围`
    : "session proof 尚未获取；真实读取前必须先建立签名会话。";
  target.innerHTML = `<strong>矩阵 ${Number(matrix.canonicalStoreCount || 0)}/${Number(matrix.expectedPrimaryStoreCount || 4)} 店铺</strong><span>${proofText}</span><span>${escapeHtml(matrix.nextAction || "未开始真实读取")}</span>${rows || "<span>没有可用店铺计划。</span>"}`;
}

function renderSessionProofStatus(summary = state.sessionProofSummary) {
  const target = $("#sessionProofStatus");
  if (!target) return;
  if (!summary) {
    target.dataset.state = "needs_review";
    target.textContent = "尚未获取当前会话 proof；只读按钮不会执行 Ozon 请求。";
    return;
  }
  if (summary.error || summary.ok !== true) {
    target.dataset.state = "needs_review";
    target.textContent = `session proof 未获取：${summary.nextAction || summary.error || "请先建立 ERP 签名会话"}`;
    return;
  }
  const hash = String(summary.proofRefHash || "");
  const shortHash = hash ? `${hash.slice(0, 15)}…` : "哈希缺失";
  target.dataset.state = "verified";
  target.innerHTML = `<strong>session proof 已获取</strong><span>来源：${escapeHtml(summary.authSource || "signed session")} · 环境：${escapeHtml(summary.environment || "当前环境")} · 店铺范围：${Number(Array.isArray(summary.storeIds) ? summary.storeIds.length : 0)} 个</span><small>proof 哈希：${escapeHtml(shortHash)}；不展示 Token，不代表已读取 Ozon。</small>`;
}

function invalidateReadOperatorEnvironmentEvidence() {
  const environment = String($("#readOperatorEnvironment")?.value || "").trim();
  state.readOperatorReceiptSummary = null;
  state.readOperatorMatrix = null;
  state.readOperatorMatrixEnvironment = "";
  state.readOperatorExecutionSummary = null;
  state.readOperatorExecutionRequestToken = Number(state.readOperatorExecutionRequestToken || 0) + 1;
  const proofEnvironment = String(state.sessionProofSummary?.environment || "").trim();
  if (!environment || !proofEnvironment || proofEnvironment !== environment) {
    state.sessionProofSummary = null;
  }
  renderReadOperatorReceiptStatus();
  renderReadOperatorMatrix();
  renderReadOperatorExecutionStatus();
  renderSessionProofStatus();
  invalidateStockEvidenceForEnvironment();
}

function invalidateStockEvidenceForEnvironment() {
  const environment = String(currentSellerReadEnvironment() || "").trim();
  invalidatePromotionEvidenceForEnvironment();
  invalidateOrderEvidenceForEnvironment();
  if (!state.stockEvidence || String(state.stockEvidence.environment || "").trim() === environment) return;
  state.stockEvidence = { ...state.stockEvidence, stale: true, partial: true };
  state.stockDryRun = null;
  syncStockActionButtons();
  renderStockEvidence({ ...state.stockEvidence, products: [], warehouses: [], currentStocks: [] });
  const dryRun = $("#stockDryRunResult");
  if (dryRun) dryRun.innerHTML = "<p class=\"hint\">读取环境已变化；旧库存证据和预演结果已失效，请重新读取。</p>";
}

function invalidatePromotionEvidenceForEnvironment() {
  const environment = String(currentSellerReadEnvironment() || "").trim();
  if (!state.promotionEvidence || String(state.promotionEvidence.environment || "").trim() === environment) return;
  state.promotionRequestToken = Number(state.promotionRequestToken || 0) + 1;
  state.promotionDetailRequestToken = Number(state.promotionDetailRequestToken || 0) + 1;
  state.promotionRows = [];
  state.promotionSellerResult = null;
  state.promotionEvidence = { failed: false, loading: false, checkedAt: "", count: 0, readStatus: "unknown", coverageComplete: false, partial: true, environment, readOnly: true };
  state.promotionSelectedProductIds = [];
  state.promotionProducts = [];
  state.promotionCandidates = [];
  state.promotionSelectedProductIds = [];
  state.promotionImpactPreview = null;
  state.promotionDetailSellerResult = { products: null, candidates: null };
  state.selectedPromotion = null;
  renderPromotions();
  renderSecondaryDomainPanels();
}

function invalidateOrderEvidenceForEnvironment() {
  const environment = String(currentSellerReadEnvironment() || "").trim();
  const orderEnvironment = String(state.orderBatch?.scope?.environment || "").trim();
  if (!state.orderBatch?.loaded && !state.financeReadModel) return;
  if (orderEnvironment === environment) return;
  state.orderRequestToken = Number(state.orderRequestToken || 0) + 1;
  state.orderDetailRequestToken = Number(state.orderDetailRequestToken || 0) + 1;
  state.orderRows = [];
  state.orderCoverage = { pageOffsets: [], pageCursors: [], orderKeys: [], observedCount: 0, hasNext: false };
  state.orderBatch = { loaded: false, loading: false, failed: false, partial: false, hasNext: false, syncedAt: "", sourceCount: 0, scope: { storeId: selectedStoreId(), environment } };
  state.financeReadModel = null;
  const table = $("#ordersTable");
  if (table) table.innerHTML = "<tr><td colspan=\"10\" class=\"product-empty\">读取环境已变化，请重新读取当前店铺订单。</td></tr>";
  renderOrderBatchStatus([]);
  renderSecondaryDomainPanels();
}

async function loadSessionProofSummary() {
  const button = $("#refreshSessionProof");
  setBusy(button, true);
  try {
    const data = await api("/api/auth/session-proof");
    state.sessionProofSummary = data;
    renderSessionProofStatus(data);
    renderReadOperatorMatrix(state.readOperatorMatrix);
    return data;
  } catch (error) {
    state.sessionProofSummary = { error: String(error?.message || "session proof 读取失败"), reasonCode: error?.reasonCode || "SESSION_PROOF_REQUIRED", nextAction: "先建立 ERP 签名会话，再获取当前环境的只读 proof；不会读取 Ozon。" };
    renderSessionProofStatus(state.sessionProofSummary);
    renderReadOperatorMatrix(state.readOperatorMatrix);
    return null;
  } finally {
    setBusy(button, false);
  }
}

async function loadReadOperatorMatrix() {
  const button = $("#refreshReadOperatorMatrix");
  const environmentCheck = validateReadOperatorEnvironment($("#readOperatorEnvironment")?.value);
  if (!environmentCheck.ok) {
    state.readOperatorMatrix = { error: environmentCheck.message, reasonCode: environmentCheck.reasonCode };
    renderReadOperatorMatrix(state.readOperatorMatrix);
    return null;
  }
  const environment = environmentCheck.environment;
  setBusy(button, true);
  try {
    const data = await api(`/api/ozon/read-operator/matrix?environment=${encodeURIComponent(environment)}`);
    state.readOperatorMatrix = data;
    state.readOperatorMatrixEnvironment = environment;
    renderReadOperatorMatrix(data);
    return data;
  } catch (error) {
    state.readOperatorMatrix = { error: String(error?.message || "检查失败") };
    renderReadOperatorMatrix(state.readOperatorMatrix);
    return null;
  } finally {
    setBusy(button, false);
  }
}

function renderReadOperatorExecutionStatus(summary = state.readOperatorExecutionSummary) {
  const target = $("#readOperatorExecutionStatus");
  if (!target) return;
  if (!summary) {
    target.dataset.state = "needs_review";
    target.textContent = "尚未执行当前店铺只读计划；默认不执行，不会直连 Ozon。";
    return;
  }
  const report = summary.report || {};
  const task = summary.sellerTask || {};
  const status = summary.ok === true ? "本店只读回执已保存" : "本店只读执行失败或需要复核";
  const coverage = report.endpointCoverage || {};
  const requestedCount = Array.isArray(coverage.requested) ? coverage.requested.length : 0;
  const observedCount = Array.isArray(coverage.observed) ? coverage.observed.length : 0;
  const missingCount = Array.isArray(coverage.missing) ? coverage.missing.length : 0;
  const scope = report.scope && typeof report.scope === "object"
    ? `${String(report.scope.name || "当前范围")} · ${Number(report.scope.offerCount || 0)} 个商品范围`
    : "当前已确认范围";
  const coverageText = requestedCount
    ? `读取范围：${scope}；已完成 ${observedCount}/${requestedCount} 个读取步骤${missingCount ? `，缺少 ${missingCount} 个` : ""}`
    : "读取范围：未能确认完整覆盖";
  target.dataset.state = summary.ok === true ? "verified" : "needs_review";
  target.innerHTML = `<strong>${escapeHtml(status)}</strong><span>${escapeHtml(task.title || report.nextStep || summary.nextAction || "查看服务端回执和失败原因")}</span><small>${escapeHtml(coverageText)}</small><small>验证等级：${escapeHtml(summary.verificationLevel || report.verificationLevel || "server_observed")}；${escapeHtml(task.nextAction || "不会写入 Ozon，按原计划处理下一步")}</small>`;
}

async function executeCurrentStoreRead() {
  const button = $("#executeReadOperatorCurrentStore");
  const environmentCheck = validateReadOperatorEnvironment($("#readOperatorEnvironment")?.value);
  if (!environmentCheck.ok) {
    state.readOperatorExecutionSummary = { ok: false, nextAction: environmentCheck.message };
    renderReadOperatorExecutionStatus(state.readOperatorExecutionSummary);
    return null;
  }
  const environment = environmentCheck.environment;
  const storeId = selectedStoreId();
  const requestToken = (state.readOperatorExecutionRequestToken = Number(state.readOperatorExecutionRequestToken || 0) + 1);
  if (!storeId) {
    state.readOperatorExecutionSummary = { ok: false, nextAction: "先选择当前店铺，再生成单店只读计划。" };
    renderReadOperatorExecutionStatus(state.readOperatorExecutionSummary);
    return null;
  }
  const proofEnvironment = String(state.sessionProofSummary?.environment || "").trim();
  if (!state.sessionProofSummary?.ok || proofEnvironment !== environment || !Array.isArray(state.sessionProofSummary.storeIds) || !state.sessionProofSummary.storeIds.includes(storeId)) {
    state.readOperatorExecutionSummary = { ok: false, nextAction: "先获取覆盖当前店铺和环境的 session proof；不会执行 Ozon 请求。" };
    renderReadOperatorExecutionStatus(state.readOperatorExecutionSummary);
    return null;
  }
  if (!state.readOperatorMatrix || state.readOperatorMatrixEnvironment !== environment || state.readOperatorMatrix.ok !== true) {
    state.readOperatorExecutionSummary = { ok: false, nextAction: "先检查当前环境的四店铺计划矩阵，并确认矩阵通过后再执行单店读取。" };
    renderReadOperatorExecutionStatus(state.readOperatorExecutionSummary);
    return null;
  }
  const splitIds = (value) => String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
  const offerIds = splitIds($("#readOperatorOfferIds")?.value);
  const productIds = splitIds($("#readOperatorProductIds")?.value);
  const lastId = String($("#readOperatorLastId")?.value || "").trim();
  if (!offerIds.length && !productIds.length) {
    state.readOperatorExecutionSummary = { ok: false, nextAction: "至少填写一个 Offer ID 或 Product ID；空范围不会发送 Seller API 请求。" };
    renderReadOperatorExecutionStatus(state.readOperatorExecutionSummary);
    return null;
  }
  const operatorPlan = {
    store: { id: storeId },
    environment,
    scope: {
      name: "single_store_manual",
      offerCount: Math.max(offerIds.length, productIds.length),
      ...(offerIds.length ? { offerIds } : {}),
      ...(productIds.length ? { productIds } : {}),
      ...(lastId ? { lastId } : {}),
    },
    endpoints: ["/v3/product/list", "/v3/product/info/list"],
    readOnly: true,
    writeAttempted: false,
    confirm: "I_CONFIRM_READ_ONLY",
    maxAgeMs: 60 * 60 * 1000,
  };
  if (!window.confirm("确认执行当前店铺的受控只读读取吗？只读取商品列表/详情并保存脱敏回执，不会写入 Ozon。")) return null;
  setBusy(button, true);
  try {
    const planGate = await api("/api/ozon-learning/readiness-evidence-receipts/plan", { method: "POST", body: JSON.stringify({ plan: operatorPlan }) });
    if (!planGate?.ok || !planGate.planBinding) throw new Error("READ_OPERATOR_PLAN_BINDING_REQUIRED");
    const data = await api("/api/ozon/read-operator/execute", {
      method: "POST",
      body: JSON.stringify({ recordEvidence: true, storeId, confirm: "I_CONFIRM_READ_ONLY", operatorPlan, planBinding: planGate.planBinding }),
    });
    if (requestToken !== state.readOperatorExecutionRequestToken
      || String(selectedStoreId() || "").trim() !== String(storeId || "").trim()
      || String(currentSellerReadEnvironment() || "").trim() !== environment) {
      return null;
    }
    state.readOperatorExecutionSummary = data;
    renderReadOperatorExecutionStatus(data);
    // The controlled read receipt is an audit result, not the product table
    // itself.  When it actually observed the product list/detail endpoints,
    // refresh the seller-facing product state in the same bound store and
    // environment; otherwise the operator could see a fresh server receipt
    // beside stale product/status/readiness rows.
    const observedEndpoints = Array.isArray(data?.report?.endpointCoverage?.observed)
      ? data.report.endpointCoverage.observed.map((endpoint) => String(endpoint || ""))
      : [];
    const productReadObserved = data?.ok === true
      && String(data?.verificationLevel || data?.report?.verificationLevel || "") === "server_observed"
      && data?.report?.endpointCoverage?.complete === true
      && observedEndpoints.some((endpoint) => endpoint === "/v3/product/list" || endpoint === "/v3/product/info/list");
    if (productReadObserved
      && requestToken === state.readOperatorExecutionRequestToken
      && String(selectedStoreId() || "").trim() === String(storeId || "").trim()
      && String(currentSellerReadEnvironment() || "").trim() === environment) {
      await loadProducts();
    }
    return data;
  } catch (error) {
    if (requestToken !== state.readOperatorExecutionRequestToken
      || String(selectedStoreId() || "").trim() !== String(storeId || "").trim()
      || String(currentSellerReadEnvironment() || "").trim() !== environment) return null;
    state.readOperatorExecutionSummary = {
      ok: false,
      reasonCode: error?.reasonCode || "READ_OPERATOR_EXECUTION_FAILED",
      nextAction: error?.responseData?.message || "服务端未完成只读执行；查看会话、店铺范围和回执状态后按原计划重试。",
      report: error?.responseData?.report,
      sellerTask: error?.responseData?.sellerTask,
      verificationLevel: error?.responseData?.verificationLevel || "server_observed",
    };
    renderReadOperatorExecutionStatus(state.readOperatorExecutionSummary);
    return null;
  } finally {
    setBusy(button, false);
  }
}

function renderSecondaryDomainPanels() {
  renderFinanceProfitPanel();
  renderServiceRiskPanel();
  renderReportsPanel();
  renderSystemConfigPanel();
}

async function establishErpSession(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const secretInput = form.querySelector("#erpSessionSecret");
  const status = form.querySelector("#erpSessionStatus");
  const secret = secretInput?.value || "";
  if (!secret) {
    if (status) status.textContent = "请输入认证密钥";
    return;
  }
  try {
    const response = await api("/api/auth/session", { method: "POST", body: JSON.stringify({ secret }) });
    if (secretInput) secretInput.value = "";
    if (status) status.textContent = response.session ? "会话已建立，密钥未保存" : "本机模式已确认";
    toast("ERP 会话已建立");
  } catch {
    if (status) status.textContent = "认证失败，请检查密钥或服务端配置";
    toast("ERP 会话建立失败", "error");
  }
}

async function logoutErpSession() {
  const status = $("#erpSessionStatus");
  try {
    await api("/api/auth/session", { method: "DELETE" });
    if (status) status.textContent = "会话已退出";
    toast("ERP 会话已退出");
  } catch {
    if (status) status.textContent = "退出失败，请稍后重试";
    toast("ERP 会话退出失败", "error");
  }
}

function renderCockpitDashboard() {
  renderStoreOperatingOverview();
  const summary = sellerWorkflowSummary();
  const riskBanner = $("#cockpitRiskBanner");
  const waitingHuman = Number(summary.waitingHuman || 0);
  const blocking = Number(summary.blocking || 0);
  if (riskBanner) {
    riskBanner.classList.toggle("active", waitingHuman > 0 || blocking > 0);
    riskBanner.innerHTML = waitingHuman || blocking ? `
      <div><span>⚠</span><strong>${waitingHuman} 个任务等待人工</strong><small>${blocking} 个阻塞节点已停止后续自动动作</small></div>
      <button type="button" data-cockpit-view="workflow-console">立即处理 →</button>
    ` : `<div><span>✓</span><strong>当前没有人工阻塞</strong><small>工作流运行正常</small></div>`;
  }
  const kpis = $("#cockpitKpis");
  if (kpis) {
    kpis.innerHTML = `
      <article><span>运行中工作流</span><strong>${Number(summary.running || 0)}</strong><small>真实任务 ${Number(summary.total || 0)}</small></article>
      <article class="${waitingHuman ? "is-warning" : ""}"><span>等待人工</span><strong>${waitingHuman}</strong><small>高风险 ${Number(summary.highRisk || 0)}</small></article>
      <article><span>近 14 天 FBS 单</span><strong id="orderCount">${escapeHtml($("#orderCount")?.textContent || "-")}</strong><small>订单履约</small></article>
      <article><span>系统状态</span><strong id="healthStatus">${escapeHtml($("#healthStatus")?.textContent || "未测试")}</strong><small><span id="storeCount">${state.stores.length}</span> 店铺 · <span id="warehouseCount">${escapeHtml($("#warehouseCount")?.textContent || "-")}</span> 仓库</small></article>
    `;
  }
  const focus = $("#cockpitWorkflowFocus");
  if (focus) {
    const runs = sellerWorkflowRuns().sort((left, right) => {
      const leftRisk = left.status === "waiting_human" ? 2 : (left.summary?.riskLevel === "high" ? 1 : 0);
      const rightRisk = right.status === "waiting_human" ? 2 : (right.summary?.riskLevel === "high" ? 1 : 0);
      return rightRisk - leftRisk;
    }).slice(0, 4);
    focus.innerHTML = `
      <div class="section-headline"><div><h2>当前工作流焦点</h2><p class="hint">优先显示真实业务中等待人工和高风险的任务。</p></div><button class="ghost" type="button" data-cockpit-view="workflow-console">查看真实任务 ${summary.total}</button></div>
      <div class="cockpit-focus-list">${runs.length ? runs.map((run) => `
        <button type="button" class="cockpit-focus-item" data-cockpit-run-id="${escapeHtml(run.id)}">
          <span><strong>${escapeHtml(run.title || run.id)}</strong><small>${escapeHtml(run.currentNode || run.summary?.currentNodeName || "等待节点")}</small></span>
          <em class="erp-status-pill ${run.status === "waiting_human" ? "warning" : "info"}">${escapeHtml(workflowStatusBusinessLabel(run.status))}</em>
          <small>${escapeHtml(run.summary?.nextAction || "查看详情")}</small><b>诊断 →</b>
        </button>
      `).join("") : `<div class="erp-empty-state">暂无工作流，先从 Ozon 学习或 1688 选品开始。</div>`}</div>
    `;
  }
  const pulse = $("#systemPulseGrid");
  if (pulse) {
    const workerOnline = Boolean(state.crawlerWorkerStatus?.online || state.crawlerWorkerStatus?.connected || state.crawlerWorkerStatus?.active);
    pulse.innerHTML = `
      <article><strong>${escapeHtml($("#healthStatus")?.textContent || "未测试")}</strong><span>Seller API</span></article>
      <article><strong class="${workerOnline ? "success" : "muted"}">${workerOnline ? "在线" : "待连接"}</strong><span>1688 采集器</span></article>
      <article><strong>${Number(summary.running || 0)}</strong><span>运行队列</span></article>
      <article><strong>${Number(state.ozonLearningItems?.length || 0)}</strong><span>学习样本</span></article>
    `;
  }
  renderErpModuleOwnership();
}

function refreshActiveStoreView() {
  const active = document.querySelector(".view.active")?.id;
  if (["orders", "finance", "dashboard"].includes(active)) loadOrders({ resetOffset: true });
  if (active === "products") loadProducts();
  if (active === "promotions") {
    state.selectedPromotion = null;
    state.promotionRows = [];
    state.promotionSellerResult = null;
    state.promotionProducts = [];
    state.promotionCandidates = [];
    state.promotionSelectedProductIds = [];
    state.promotionDetailSellerResult = { products: null, candidates: null };
    renderPromotionDetail();
    loadPromotions();
  }
  if (active === "warehouse") loadWarehouses();
  if (active === "listing") loadListingWarehouses();
}

function syncListingStore() {
  const select = $("#listingStoreMirror");
  if (!select) return;
  select.innerHTML = state.stores
    .map((store) => `<option value="${store.id}">${store.name} - ${store.clientId}</option>`)
    .join("");
  select.value = selectedStoreId();
}

async function testApi() {
  const button = $("#testButton");
  const environmentCheck = validateReadOperatorEnvironment(currentSellerReadEnvironment());
  if (!environmentCheck.ok) {
    $("#healthStatus").textContent = "待填写只读环境";
    toast(environmentCheck.message, "warning");
    return false;
  }
  if (!selectedStoreId()) {
    $("#healthStatus").textContent = "待选择店铺";
    toast("请先选择需要读取的店铺；本次未发起 API 请求。", "warning");
    return false;
  }
  setBusy(button, true);
  try {
    const data = await api("/api/ozon/test", {
      method: "POST",
      body: JSON.stringify({ storeId: selectedStoreId() }),
    });
    $("#healthStatus").textContent = "正常";
    const warehouses = Array.isArray(data.warehouses)
      ? data.warehouses
      : data.warehouses?.result || data.warehouses?.warehouses || [];
    $("#warehouseCount").textContent = Array.isArray(warehouses) ? warehouses.length : "-";
    let runtimeSafety = null;
    let observability = null;
    try {
      runtimeSafety = await api("/api/system/runtime-safety");
    } catch {
      // Ozon connectivity and deployment safety are separate facts. Keep the
      // API read result, but do not claim the runtime is production-ready when
      // its safety endpoint cannot be checked.
      $("#healthStatus").textContent = "API 正常，运行配置未核验";
    }
    if (runtimeSafety) {
      const safety = runtimeSafetySellerStatus(runtimeSafety);
      $("#healthStatus").textContent = safety.label;
      if (safety.blocked) toast(safety.nextAction, "warning");
    }
    try {
      observability = await api("/api/system/observability");
      state.observabilitySummary = observability;
    } catch {
      // Observability is an operator aid; an unavailable summary must not
      // upgrade or erase the bounded Seller API/runtime safety result.
      state.observabilitySummary = { alerts: [{ code: "OBSERVABILITY_UNAVAILABLE", severity: "high" }] };
    }
    const highObservabilityAlerts = Array.isArray(observability?.alerts)
      && observability.alerts.some((alert) => String(alert?.severity || "").toLowerCase() === "high");
    if (highObservabilityAlerts) {
      $("#healthStatus").textContent = "API 正常，但服务有错误告警";
    }
    showResponse({ ...data, runtimeSafety, observability });
    toast(highObservabilityAlerts
      ? "API 连通，但服务错误告警需要运维处理"
      : runtimeSafety?.mode === "guarded_not_production"
        ? "API 连通，但运行配置需要处理"
        : "API 连通；运行前置条件满足，但业务 readiness 未验证");
    return true;
  } catch (error) {
    $("#healthStatus").textContent = "异常";
    toast(sellerReadAccessRecovery(error, error.message || "仓库读取失败，请重新读取。"), "error");
    return false;
  } finally {
    setBusy(button, false);
  }
}

function runtimeSafetySellerStatus(snapshot = {}) {
  const valid = snapshot && ["guarded_not_production", "production_prerequisites_present"].includes(String(snapshot.mode || ""))
    && Array.isArray(snapshot.blockers)
    && Array.isArray(snapshot.risks)
    && typeof snapshot.nextAction === "string"
    && typeof snapshot.loopbackOnly === "boolean"
    && typeof snapshot.authConfigured === "boolean"
    && typeof snapshot.databaseConfigured === "boolean"
    && typeof snapshot.persistenceMode === "string"
    && snapshot.businessReadiness === "not_verified"
    && typeof snapshot.businessReadinessNextAction === "string";
  if (!valid) {
    const missingPrerequisite = snapshot?.authConfigured === false
      ? "先配置服务端认证并重新读取运行安全摘要。"
      : snapshot?.databaseConfigured === false
        ? "先配置持久化/数据库连接并重新读取运行安全摘要。"
        : snapshot?.persistenceMode === "memory_only"
          ? "当前为内存模式；先切换到受支持的持久化环境，再执行部署预检。"
          : "运行安全摘要缺少认证或持久化字段；请重新读取并确认服务端版本。";
    return {
      blocked: true,
      label: "API 正常，运行配置未核验",
      nextAction: missingPrerequisite,
    };
  }
  const blockers = Array.isArray(snapshot.blockers) ? snapshot.blockers : [];
  const risks = Array.isArray(snapshot.risks) ? snapshot.risks : [];
  const blocked = snapshot.mode === "guarded_not_production" || blockers.length > 0;
  return {
    blocked,
    label: blocked ? "API 正常，运行配置需处理" : "API 与运行前置条件已满足（业务未验证）",
    nextAction: blocked
      ? `先处理运行前置条件：${[...new Set([...blockers, ...risks])].slice(0, 4).join("、") || "查看系统配置"}`
      : (snapshot.businessReadinessNextAction || "业务 readiness 未验证；需要真实 Seller API 回执、审核回读和库存对账。"),
  };
}

async function loadWarehouses() {
  const button = $("#loadWarehouses");
  const requestToken = (state.warehouseRequestToken = Number(state.warehouseRequestToken || 0) + 1);
  const requestStoreId = String(selectedStoreId() || "").trim();
  setBusy(button, true);
  try {
    const data = await api(`/api/ozon/warehouses?storeId=${encodeURIComponent(requestStoreId)}`);
    if (requestToken !== state.warehouseRequestToken || requestStoreId !== String(selectedStoreId() || "").trim()) return false;
    if (String(data.storeId || "").trim() !== requestStoreId) {
      const error = new Error("仓库读取范围已变化，请重新读取当前店铺。操作者不会看到旧仓库状态。");
      error.httpStatus = 409;
      throw error;
    }
    const warehouses = data.result || data.warehouses || [];
    const paginationComplete = data.paginationComplete === true && data.hasNext !== true;
    state.stockWarehouses = Array.isArray(warehouses) ? warehouses : null;
    $("#warehouseCount").textContent = Array.isArray(warehouses) ? warehouses.length : "-";
    const warehouseRows = Array.isArray(warehouses) && warehouses.length
      ? warehouses.map((warehouse) => {
        const warehouseId = String(warehouse.warehouse_id || warehouse.id || "").trim();
        const warehouseName = String(warehouse.name || warehouse.warehouse_name || "未命名仓库");
        const chooseButton = warehouseId && state.stockFocusOfferIds?.length
          ? `<button class="small-blue stock-warehouse-choose" type="button" data-stock-warehouse-id="${escapeHtml(warehouseId)}" data-stock-warehouse-name="${escapeHtml(warehouseName)}">应用到待填写目标</button>`
          : "";
        return `
          <article>
            <strong>${escapeHtml(warehouseName)}</strong>
            <code>ID: ${escapeHtml(warehouseId || "-")}</code>
            <span>类型: ${escapeHtml(warehouse.type || warehouse.delivery_method_type || "-")}</span>
            <span>状态: ${escapeHtml(warehouse.status || (warehouse.is_rfbs ? "rfbs" : "-"))}</span>
            ${chooseButton}
          </article>
        `;
      }).join("")
      : "<p class=\"hint\">没有返回仓库数据。</p>";
    $("#warehouseList").innerHTML = `${paginationComplete ? "" : "<p class=\"warning\">仓库列表未完整读取；当前数量和可用仓库范围不能代表全部结果，请重新读取。</p>"}${warehouseRows}`;
    bindStockWarehouseChoices();
    showResponse(data);
    toast(data.readStatus === "empty" ? "本次没有仓库证据，请检查店铺权限和范围" : paginationComplete ? "仓库已读取" : "仓库读取不完整，请重新读取", data.readStatus === "empty" || !paginationComplete ? "warning" : "ok");
  } catch (error) {
    state.stockWarehouses = null;
    $("#warehouseCount").textContent = "-";
    $("#warehouseList").innerHTML = "<p class=\"hint\">仓库读取失败，未展示旧仓库状态；请重新读取。</p>";
    toast(sellerReadAccessRecovery(error, error.message || "仓库读取失败，请重新读取。"), "error");
  } finally {
    if (requestToken === state.warehouseRequestToken) setBusy(button, false);
  }
}

// A readiness handoff already carries the exact Offer IDs, but the seller
// still has to choose an observed warehouse before the tuple evidence read can
// run. Keep that choice in the same local target editor instead of forcing the
// seller to copy a large warehouse ID from a diagnostic response.
function bindStockWarehouseChoices() {
  document.querySelectorAll(".stock-warehouse-choose[data-stock-warehouse-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const warehouseId = String(button.dataset.stockWarehouseId || "").trim();
      if (!warehouseId) return;
      const focusOffers = new Set((state.stockFocusOfferIds || []).map(String).filter(Boolean));
      let rows;
      try {
        const parsed = JSON.parse($("#stockJson")?.value || "[]");
        rows = Array.isArray(parsed) ? parsed : [];
      } catch {
        rows = [];
      }
      const next = rows.map((row) => {
        const offerId = String(row?.offer_id || row?.offerId || "").trim();
        if (focusOffers.has(offerId) && !(Number(row?.warehouse_id || row?.warehouseId || 0) > 0)) {
          return { ...row, offer_id: offerId, warehouse_id: Number(warehouseId) };
        }
        return row;
      });
      const stockJson = $("#stockJson");
      if (stockJson) stockJson.value = JSON.stringify(next, null, 2);
      invalidateStockEvidenceOnTargetChange();
      toast(`已把仓库 ${warehouseId} 应用到待填写的 Offer；请继续填写目标库存`, "ok");
    });
  });
}

async function loadListingWarehouses() {
  const requestToken = (state.listingWarehouseRequestToken = Number(state.listingWarehouseRequestToken || 0) + 1);
  const requestStoreId = String(selectedStoreId() || "").trim();
  try {
    const data = await api(`/api/ozon/warehouses?storeId=${encodeURIComponent(requestStoreId)}`);
    if (requestToken !== state.listingWarehouseRequestToken || requestStoreId !== String(selectedStoreId() || "").trim()) return false;
    if (String(data.storeId || "").trim() !== requestStoreId) {
      throw new Error("上架仓库读取范围已变化，请重新读取当前店铺。操作者不会看到旧仓库状态。");
    }
    const warehouses = data.warehouses || [];
    const paginationComplete = data.paginationComplete === true && data.hasNext !== true;
    state.listingWarehouseReadIncomplete = !paginationComplete;
    state.listingWarehouses = paginationComplete
      ? warehouses.filter((warehouse) => warehouse.status === "created" || warehouse.is_rfbs)
      : [];
    const options = paginationComplete ? warehouses
      .filter((warehouse) => warehouse.status === "created" || warehouse.is_rfbs)
      .map((warehouse) => `<option value="${warehouse.warehouse_id}">${warehouse.name} - ${warehouse.warehouse_id}</option>`)
      .join("")
      : `<option value="" disabled selected>仓库列表未完整读取，请重新读取</option>`;
    document.querySelectorAll(".variant-warehouse, #listingWarehouse").forEach((select) => {
      const selected = select.value;
      select.innerHTML = options;
      select.disabled = !paginationComplete;
      if ([...select.options].some((option) => option.value === selected)) {
        select.value = selected;
      }
    });
  } catch {
    if (requestToken !== state.listingWarehouseRequestToken || requestStoreId !== String(selectedStoreId() || "").trim()) return false;
    state.listingWarehouses = [];
    state.listingWarehouseReadIncomplete = true;
    document.querySelectorAll(".variant-warehouse, #listingWarehouse").forEach((select) => {
      select.innerHTML = "";
      select.disabled = true;
    });
  }
}

async function loadOrders(options = {}) {
  const append = options.append === true;
  const button = $("#loadOrders");
  // A store switch can leave the previous read in flight. Only the latest
  // request may paint rows or freshness; a late response must not appear
  // under the newly selected store.
  const requestToken = (state.orderRequestToken = Number(state.orderRequestToken || 0) + 1);
  state.fbsReceiptRequestToken = Number(state.fbsReceiptRequestToken || 0) + 1;
  // Invalidate any selected-posting detail read from the previous batch/store.
  state.orderDetailRequestToken = Number(state.orderDetailRequestToken || 0) + 1;
  const requestStoreId = selectedStoreId();
  const environmentCheck = validateReadOperatorEnvironment(currentSellerReadEnvironment());
  if (!environmentCheck.ok) {
    state.orderRows = [];
    state.financeReadModel = null;
    state.orderBatch = { loaded: false, loading: false, failed: true, partial: true, hasNext: false, syncedAt: "", sourceCount: 0, scope: { storeId: requestStoreId, environment: "" } };
    updateDataFreshness("#orderDataFreshness", "error", environmentCheck.message);
    toast(environmentCheck.message, "warning");
    return false;
  }
  const requestEnvironment = environmentCheck.environment;
  if (options.resetOffset === true || options.resetCursor === true) {
    state.orderPageOffset = 0;
    state.orderCursor = "";
    state.orderCursorHistory = [];
  }
  setBusy(button, true);
  updateDataFreshness("#orderDataFreshness", "loading", "正在读取订单；完成前不会执行备货或发运。");
  try {
    const params = new URLSearchParams({
      storeId: requestStoreId,
      limit: "100",
      cursor: String(state.orderCursor || ""),
      sortDir: String(state.orderSortDir || "DESC"),
    });
    const status = state.orderStatus && state.orderStatus !== "dispute" ? state.orderStatus : "";
    const since = toUtcIsoFromLocal($("#orderSince").value);
    const to = toUtcIsoFromLocal($("#orderTo").value);
    const warehouseId = $("#orderWarehouse").value;
    const query = $("#orderSearch").value.trim();
    if (status) params.set("status", status);
    if (since) params.set("since", since);
    if (to) params.set("to", to);
    if (warehouseId) params.set("warehouseId", warehouseId);
    if (query) params.set("query", query);

    const scope = { storeId: requestStoreId, environment: requestEnvironment, status, warehouseId, since, to, query, limit: 100, cursor: String(state.orderCursor || ""), sortDir: state.orderSortDir || "DESC", pagination: "cursor" };
    // A failed continuation page must not erase orders already observed from
    // earlier pages. Keep those rows visible but downgrade the batch to
    // partial; the seller can retry the same cursor without losing context.
    if (!append) state.orderRows = [];
    if (!scope.cursor) state.orderCoverage = { pageOffsets: [], pageCursors: [], orderKeys: [], observedCount: 0, hasNext: false };
    state.orderBatch = { loaded: false, loading: true, failed: false, partial: false, hasNext: false, syncedAt: "", sourceCount: 0, scope };
    state.financeReadModel = null;
    $("#orderCount").textContent = "0";
    $("#ordersTable").innerHTML = "<tr><td colspan=\"10\" class=\"product-empty\">正在读取当前店铺和筛选范围的订单…</td></tr>";
    renderOrderBatchStatus([]);

    const data = await api(`/api/ozon/order-dashboard?${params}`);
    if (requestToken !== state.orderRequestToken) return false;
    // The request token prevents late responses from painting after a newer
    // request, while this scope check prevents a stale/cached response from
    // being accepted under the current store or pagination page.
    const responseStoreId = String(data.storeId || "");
    // The API's data.requestScope?.cursor is part of the response identity;
    // normalize it once before comparing the complete scope.
    const responseScope = data.requestScope || {};
    const responseCursor = String(responseScope.cursor || "");
    const responseWarehouseId = String(responseScope.warehouseId || "");
    // Keep the legacy store mismatch guard explicit in the audit trail:
    // responseStoreId !== requestStoreId must never paint a seller's rows.
    const scopeMatches = responseStoreId === requestStoreId
      && String(data.environment || "").trim() === requestEnvironment
      && responseCursor === scope.cursor
      && String(responseScope.pagination || "") === "cursor"
      && String(responseScope.since || "") === String(scope.since || "")
      && String(responseScope.to || "") === String(scope.to || "")
      && String(responseScope.status || "") === String(scope.status || "")
      && responseWarehouseId === String(scope.warehouseId || "")
      && String(responseScope.sortDir || "") === String(scope.sortDir || "");
    if (!scopeMatches) {
      const error = new Error("订单读取范围已变化，请重新读取当前店铺和游标。操作者不会看到旧批次数据。");
      error.httpStatus = 409;
      throw error;
    }
    const sourceOrders = Array.isArray(data.orders) ? data.orders : [];
    state.orderRows = state.orderStatus === "dispute"
      ? sourceOrders.filter((order) => String(order.substatus || "").toLowerCase().includes("dispute")
        || String(order.statusGroup || order.status || "").toLowerCase().includes("disput"))
      : sourceOrders;
    const hasNext = data.has_next === true;
    if (!scope.cursor) state.orderCoverage = { pageOffsets: [], pageCursors: [], orderKeys: [], observedCount: 0, hasNext: false };
    const pageCursors = [...new Set([...(state.orderCoverage?.pageCursors || []), scope.cursor || "首批"])];
    const orderKeys = new Set(state.orderCoverage?.orderKeys || []);
    sourceOrders.forEach((order, index) => orderKeys.add(String(order.posting_number || order.order_number || `${scope.offset}:${index}`)));
    state.orderCoverage = {
      pageOffsets: [],
      pageCursors,
      orderKeys: [...orderKeys],
      observedCount: orderKeys.size,
      hasNext,
    };
    state.orderBatch = {
      loaded: true,
      failed: false,
      partial: data.partial === true || data.stale === true || hasNext,
      hasNext,
      nextCursor: String(data.nextCursor || data.readCoverage?.nextCursor || ""),
      syncedAt: String(data.checkedAt || data.syncedAt || new Date().toISOString()),
      sourceCount: sourceOrders.length,
      missingEvidence: Array.isArray(data.missingEvidence) ? data.missingEvidence.map(String) : [],
      sellerView: data.sellerView || null,
      sellerStatus: String(data.sellerView?.status || ""),
      verificationLevel: String(data.verificationLevel || "locally_tested"),
      scope,
      coverage: { pageOffsets: [], pageCursors: state.orderCoverage.pageCursors, observedCount: state.orderCoverage.observedCount, hasNext },
    };
    // The finance panel consumes the same server-side order evidence. It may
    // still show revenue/profit as unknown because this FBS read deliberately
    // omits financial_data and settlement fields.
    state.financeReadModel = data.financeReadModel || null;
    $("#orderCount").textContent = state.orderRows.length;
    updateOrderCounts(data.counts || {});
    updateOrderFilterOptions(sourceOrders);
    renderOrders();
    showResponse(data);
    toast("FBS 订单已读取");
    updateDataFreshness("#orderDataFreshness", state.orderBatch.partial ? "stale" : "success", `订单同步时间：${formatDateTime(state.orderBatch.syncedAt)}${state.orderBatch.partial ? "；本批读取不完整" : ""}`);
    return true;
  } catch (error) {
    if (requestToken !== state.orderRequestToken) return false;
    // A failed continuation page must not erase orders already observed from
    // earlier pages. Keep those rows visible but downgrade the batch to
    // partial; the seller can retry the same cursor without losing context.
    if (!append) state.orderRows = [];
    if (!state.orderCursor) state.orderCoverage = { pageOffsets: [], pageCursors: [], orderKeys: [], observedCount: 0, hasNext: false };
    const failedScope = state.orderBatch?.scope || {
      storeId: requestStoreId,
      environment: requestEnvironment,
      status: state.orderStatus || "",
      warehouseId: $("#orderWarehouse")?.value || "",
      since: toUtcIsoFromLocal($("#orderSince")?.value || ""),
      to: toUtcIsoFromLocal($("#orderTo")?.value || ""),
      limit: 100,
      cursor: state.orderCursor || "",
      sortDir: state.orderSortDir || "DESC",
      pagination: "cursor",
    };
    state.orderBatch = {
      ...state.orderBatch,
      loaded: false,
      loading: false,
      failed: true,
      httpStatus: Number(error.httpStatus || 0),
      scope: failedScope,
      sellerStatus: "error",
      sellerView: {
        status: "error",
        nextAction: "保持当前店铺、筛选和页码不变，点击“读取订单”重试；核实前不执行履约动作。",
        sellerTasks: [{
          state: "blocked",
          code: "FBS_READ_RETRY_REQUIRED",
          count: 1,
          nextAction: "按当前读取范围重新读取订单和商品详情。",
        }],
      },
    };
    state.financeReadModel = null;
    $("#orderCount").textContent = String(state.orderRows.length);
    if (!append) {
      $("#ordersTable").innerHTML = `<tr><td colspan="10" class="product-empty">${state.orderBatch.httpStatus === 403 ? "当前店铺无权读取这批订单。" : "本批订单读取失败，未展示旧订单。"}</td></tr>`;
      renderOrderBatchStatus([]);
    } else {
      renderOrders();
      renderOrderBatchStatus(state.orderRows);
    }
    const failureText = sellerReadAccessRecovery(error, state.orderBatch.httpStatus === 403
      ? "当前店铺没有订单读取权限，请检查店铺授权。"
      : "FBS 订单服务暂时不可用，请稍后重试。");
    toast(failureText, "error");
    updateDataFreshness("#orderDataFreshness", "error", `订单同步失败；${failureText} 本次没有执行任何订单动作。`);
    return false;
  } finally {
    if (requestToken === state.orderRequestToken) setBusy(button, false);
  }
}

function updateOrderCounts(counts) {
  const batch = state.orderBatch || {};
  const incomplete = batch.loaded !== true || batch.failed === true || batch.partial === true || batch.hasNext === true;
  const scopeHint = $("#orderCountScopeHint");
  if (scopeHint) {
    scopeHint.dataset.scope = incomplete ? "page" : "complete";
    scopeHint.textContent = incomplete
      ? "上方状态数量仅代表当前已读取批次，不是店铺全量；继续读取下一页后再判断积压。"
      : "上方状态数量代表当前筛选范围的完整读取结果。";
  }
  document.querySelectorAll("#orderStatusTabs .product-tab").forEach((tab) => {
    const key = tab.dataset.status || "all";
    const value = counts[key] ?? 0;
    tab.dataset.countScope = incomplete ? "current_batch" : "complete_scope";
    tab.setAttribute("aria-label", `${tab.textContent.replace(/\s+\d+\s*$/, "").trim()}：${incomplete ? "本批 " : ""}${value}`);
    tab.querySelector("span").textContent = incomplete ? `本批 ${value}` : String(value);
  });
}

function updateOrderFilterOptions(orders) {
  const currentWarehouse = $("#orderWarehouse").value;
  const currentService = $("#orderService").value;
  const warehouses = [...new Map(orders
    .filter((order) => order.warehouse_id)
    .map((order) => [String(order.warehouse_id), order])).values()];
  $("#orderWarehouse").innerHTML = `<option value="">全部仓库</option>${warehouses
    .map((order) => `<option value="${order.warehouse_id}">${escapeHtml(order.warehouse)} - ${order.warehouse_id}</option>`)
    .join("")}`;
  $("#orderWarehouse").value = currentWarehouse;

  const services = [...new Set(orders.map((order) => order.delivery_service).filter(Boolean))];
  $("#orderService").innerHTML = `<option value="">全部服务</option>${services
    .map((service) => `<option value="${escapeHtml(service)}">${escapeHtml(service)}</option>`)
    .join("")}`;
  if (services.includes(currentService)) $("#orderService").value = currentService;
}

async function loadNextOrderBatch() {
  if (state.orderBatch?.hasNext !== true) return;
  const nextCursor = String(state.orderBatch?.nextCursor || "").trim();
  if (!nextCursor || nextCursor === state.orderCursor) {
    toast("Ozon 未返回可继续使用的新游标，不能冒险重复读取。", "error");
    return;
  }
  state.orderCursorHistory = [...(state.orderCursorHistory || []), state.orderCursor || ""];
  state.orderCursor = nextCursor;
  state.orderPageOffset += 100;
  await loadOrders();
}

async function loadPreviousOrderBatch() {
  const history = [...(state.orderCursorHistory || [])];
  if (!history.length || state.orderBatch?.loading === true) return;
  state.orderCursor = String(history.pop() || "");
  state.orderCursorHistory = history;
  state.orderPageOffset = Math.max(0, state.orderPageOffset - 100);
  await loadOrders();
}

function renderOrders() {
  const service = $("#orderService").value;
  const rows = service
    ? state.orderRows.filter((order) => order.delivery_service === service)
    : state.orderRows;
  const filtered = Boolean(state.orderStatus || $("#orderWarehouse").value || service || $("#orderSearch").value.trim());
  const sellerStatus = String(state.orderBatch?.sellerStatus || state.orderBatch?.sellerView?.status || "");
  const emptyMessage = state.orderBatch?.failed
    ? "订单读取失败，未展示旧订单；不能据此判断店铺没有订单。"
    : ["unknown", "manual_review", "error"].includes(sellerStatus)
      ? "订单读取范围或解释状态未知，不能判断店铺没有订单；请查看下方下一步。"
      : state.orderBatch?.partial
        ? "订单读取不完整，不能据此判断店铺没有订单；请继续读取或重新读取。"
        : filtered ? "当前筛选没有匹配订单。" : "当前读取范围没有订单。";
  $("#ordersTable").innerHTML = rows.length
    ? rows.map(orderRowHtml).join("")
    : `<tr><td colspan="10" class="product-empty">${emptyMessage}</td></tr>`;
  renderOrderBatchStatus(rows);
}

function currentOrderViewFilter() {
  const statusLabels = {
    awaiting_packaging: "待备货",
    awaiting_deliver: "待发运",
    delivering: "运输中",
    dispute: "争议",
    delivered: "已签收",
    cancelled: "已取消",
  };
  const status = String(state.orderStatus || "").trim();
  const warehouseId = String($("#orderWarehouse")?.value || "").trim();
  const service = String($("#orderService")?.value || "").trim();
  const query = String($("#orderSearch")?.value || "").trim();
  const parts = [];
  if (status) parts.push(`状态：${statusLabels[status] || status}`);
  if (warehouseId) parts.push(`仓库：${warehouseId}`);
  if (service) parts.push(`配送服务：${service}`);
  if (query) parts.push(`搜索：${query}`);
  return { active: parts.length > 0, summary: parts.length ? parts.join("；") : "全部已读取订单" };
}

function renderOrderBatchStatus(visibleRows = []) {
  const target = $("#orderBatchStatus");
  if (!target) return;
  const batch = state.orderBatch || {};
  const previous = $("#orderPreviousBatch");
  const next = $("#orderNextBatch");
  const pageLabel = $("#orderPageLabel");
  const coverage = state.orderCoverage || {};
  const observedBatches = Number((coverage.pageCursors || coverage.pageOffsets || []).length || 0);
  const observedOrders = Number(coverage.observedCount || 0);
  const coverageText = observedBatches > 1
    ? ` · 已读取 ${observedBatches} 批，去重累计 ${observedOrders} 个订单`
    : "";
  if (previous) previous.disabled = batch.loading === true || !(state.orderCursorHistory || []).length;
  if (next) next.disabled = batch.loading === true || batch.loaded !== true || batch.hasNext !== true || !batch.nextCursor;
  if (pageLabel) pageLabel.textContent = `第 ${Number(state.orderCursorHistory?.length || 0) + 1} 批 · cursor 分页，当前页替换显示 · 每批最多 100 个${coverageText}`;
  if (batch.loading) {
    target.dataset.state = "loading";
    target.innerHTML = "<strong>正在读取当前批次</strong><span>旧订单已清除；完成前不会执行任何订单动作。</span><p><b>下一步：</b>等待本批读取完成；如果失败，点击“读取订单”重试。</p>";
    renderOrderReceiptControls();
    return;
  }
  if (batch.failed) {
    target.dataset.state = "failed";
    const failedTask = batch.sellerView?.sellerTasks?.[0];
    const retryNextAction = batch.sellerView?.nextAction || "保持当前店铺、筛选和页码不变，点击“读取订单”重试；当前不执行履约动作。";
    target.innerHTML = batch.httpStatus === 403
      ? `<strong>本批读取失败：无读取权限</strong><span>当前店铺没有这批 FBS 订单的读取权限；未展示旧订单。</span><p><b>下一步：</b>${escapeHtml(retryNextAction)}</p><button type="button" class="ghost" data-fbs-order-retry>重新读取当前范围</button>`
      : `<strong>本批读取失败</strong><span>订单服务暂时不可用；未展示旧订单。本页没有执行备货、发运或取消。</span><p><b>下一步：</b>${escapeHtml(retryNextAction)}</p><button type="button" class="ghost" data-fbs-order-retry>重新读取当前范围</button>${failedTask ? `<small>${escapeHtml(failedTask.code || "FBS_READ_RETRY_REQUIRED")}：${escapeHtml(failedTask.nextAction || "请重新读取当前范围")}</small>` : ""}`;
    renderOrderReceiptControls();
    return;
  }
  if (!batch.loaded) return;
  const service = $("#orderService")?.value || "";
  const filtered = Boolean(state.orderStatus || $("#orderWarehouse")?.value || service || $("#orderSearch")?.value.trim());
  const viewFilter = currentOrderViewFilter();
  const emptyText = visibleRows.length
    ? `当前显示 ${visibleRows.length} 个订单。`
    : filtered ? "当前筛选没有匹配订单。" : "当前读取范围没有订单。";
  const missingLabels = (batch.missingEvidence || []).map((item) => ({
    product_details: "部分商品详情未读取",
    orders: "部分订单未读取",
    pagination: "分页信息不完整",
  })[item] || "部分只读证据缺失");
  const sellerStatus = String(batch.sellerStatus || batch.sellerView?.status || (batch.partial ? "partial" : "evidence_ready"));
  // A technically complete page can still have an unknown/manual-review
  // seller view (for example an unrecognised order status). Do not tell the
  // seller that the batch is complete in that case: completeness of the
  // response is different from confidence in the operational interpretation.
  const sellerInterpretationBlocked = ["unknown", "manual_review", "error"].includes(sellerStatus);
  const partialText = sellerInterpretationBlocked
    ? "订单已读取，但卖家状态仍需人工复核；不能据此执行履约。"
    : batch.hasNext && !batch.missingEvidence?.length
      ? "当前页读取完整，但仍有后续分页；当前数量不是全量订单。"
      : batch.partial
        ? `本批读取不完整${missingLabels.length ? `：${[...new Set(missingLabels)].join("、")}` : "，请稍后重新读取"}。`
        : "本批读取完整。";
  target.dataset.state = ["unknown", "manual_review", "error"].includes(sellerStatus)
    ? "unknown"
    : batch.partial ? "partial" : "success";
  const scope = batch.scope || {};
  const range = scope.since || scope.to ? `${formatDateTime(scope.since)} 至 ${formatDateTime(scope.to)}` : "默认读取范围";
  const sellerTasks = Array.isArray(batch.sellerView?.sellerTasks) ? batch.sellerView.sellerTasks : [];
  const sellerTaskHtml = sellerTasks.length
    ? `<ul class="seller-task-list">${sellerTasks.slice(0, 5).map((task) => `<li data-task-code="${escapeHtml(task.code || "")}" data-task-priority="${escapeHtml(task.priority || "normal")}"><strong>${escapeHtml(task.label || "需人工处理")}</strong>${Number(task.count || 0) > 1 ? `（${Number(task.count)} 单）` : ""}：${escapeHtml(task.nextAction || "请人工核对当前订单")}</li>`).join("")}</ul>`
    : "";
  // Service and free-text filters are view filters over the already-read
  // batch. Keep the next action aligned with what the seller can actually
  // see, and never let an empty filtered view look like an empty store queue.
  const visibleNextAction = filtered
    ? visibleRows.length
      ? "当前筛选只影响已读取批次的展示；要判断完整店铺范围，请清除筛选并继续读取全部分页。"
      : "清除或调整当前筛选后再查看；当前筛选没有匹配订单，不代表店铺没有待处理订单。"
    : (batch.sellerView?.nextAction || "根据当前订单状态继续人工核对；当前页面不执行履约动作。");
  target.innerHTML = `
    <strong>${escapeHtml(emptyText)}</strong>
    <span>证据范围：店铺 ${escapeHtml(scope.storeId || "未知")} · ${escapeHtml(range)}</span>
    <span>当前视图筛选：${escapeHtml(viewFilter.summary)}${filtered ? "（只影响已读取批次展示）" : ""}</span>
    <span>同步时间：${escapeHtml(formatDateTime(batch.syncedAt))} · ${escapeHtml(partialText)} · 卖家状态：${escapeHtml(sellerStatus)}</span>
    <small>验证等级：${escapeHtml(batch.verificationLevel || "locally_tested")}</small>
    <small>当前批次 ${Number(batch.sourceCount || 0)} 个；${batch.hasNext ? "还有下一批，当前数量不是订单总数。" : "服务端未标记还有下一批，仍仅代表当前读取范围。"}${observedBatches > 1 ? ` 已读取 ${observedBatches} 批，去重累计 ${observedOrders} 个订单；累计范围仅作只读覆盖提示。` : ""} 只读展示，不执行订单动作。</small>
    <p><b>安全下一步：</b>${escapeHtml(visibleNextAction)}</p>
    ${sellerTaskHtml}
  `;
  renderOrderReceiptControls();
}

function renderOrderReceiptControls() {
  const target = $("#orderReceiptControls");
  if (!target) return;
  const batch = state.orderBatch || {};
  const sellerStatus = String(batch.sellerStatus || batch.sellerView?.status || "");
  const sellerInterpretationBlocked = ["unknown", "manual_review", "error"].includes(sellerStatus);
  // A technically complete page is not safe to save as an operator receipt
  // when the seller interpretation is unknown/manual-review/error.  Keep the
  // receipt action aligned with the same boundary shown in the batch status.
  const eligible = Boolean(batch.loaded === true
    && batch.failed !== true
    && batch.partial !== true
    && batch.hasNext !== true
    && !sellerInterpretationBlocked
    && Number(batch.sourceCount || 0) > 0);
  target.dataset.eligible = eligible ? "true" : "false";
  target.innerHTML = `
    <strong>保存 FBS 只读证据回执</strong>
    <label>环境名
      <input type="text" list="fbsReceiptEnvironmentOptions" data-fbs-receipt-environment placeholder="例如：production-readonly" ${eligible ? "" : "disabled"} />
      <datalist id="fbsReceiptEnvironmentOptions"><option value="local-dev-readonly"></option><option value="staging-readonly"></option><option value="production-readonly"></option></datalist>
    </label>
    <label><input type="checkbox" data-fbs-receipt-confirm ${eligible ? "" : "disabled"} /> 我确认保存当前批次的只读证据回执</label>
    <button type="button" class="ghost" data-save-fbs-evidence-receipt disabled>保存本次只读回执</button>
    <button type="button" class="ghost" data-load-fbs-evidence-summary disabled>查看已保存回执摘要</button>
    <small>${eligible ? "服务端会重新读取当前范围并保存脱敏摘要。" : "仅完整、非分页且卖家状态可解释的批次可保存；部分、失败、未知或仍有下一批时保持禁用。"} 不会备货、发运或取消订单。</small>
    <p class="fbs-evidence-receipt-response" aria-live="polite"></p>
  `;
}

function updateFbsReceiptControl(container) {
  if (!container) return;
  const environment = container.querySelector("[data-fbs-receipt-environment]")?.value.trim() || "";
  const confirmed = container.querySelector("[data-fbs-receipt-confirm]")?.checked === true;
  const button = container.querySelector("[data-save-fbs-evidence-receipt]");
  const summaryButton = container.querySelector("[data-load-fbs-evidence-summary]");
  const batchStoreId = String(state.orderBatch?.scope?.storeId || "").trim();
  if (summaryButton) summaryButton.disabled = environment.length < 3 || !batchStoreId;
  if (button) button.disabled = container.dataset.eligible !== "true" || !environment || !confirmed;
}

async function saveFbsEvidenceReceipt(button) {
  const container = button.closest("#orderReceiptControls");
  const response = container?.querySelector(".fbs-evidence-receipt-response");
  const environment = container?.querySelector("[data-fbs-receipt-environment]")?.value.trim() || "";
  const batch = state.orderBatch || {};
  setBusy(button, true);
  try {
    const data = await api("/api/ozon/order-dashboard/evidence-receipts", {
      method: "POST",
      body: JSON.stringify({ recordEvidence: true, environment, storeId: batch.scope?.storeId, scope: batch.scope }),
    });
    if (response) response.textContent = `回执已保存 · 证据时间 ${escapeHtml(data.receipt?.checkedAt || "未返回")}`;
  } catch {
    if (response) response.textContent = "FBS 只读回执保存未完成，请检查环境名和店铺只读连接后重试。";
  } finally {
    setBusy(button, false);
    updateFbsReceiptControl(container);
  }
}

async function loadFbsEvidenceSummary(button) {
  const container = button.closest("#orderReceiptControls");
  const response = container?.querySelector(".fbs-evidence-receipt-response");
  const environment = container?.querySelector("[data-fbs-receipt-environment]")?.value.trim() || "";
  const requestToken = (state.fbsReceiptRequestToken = Number(state.fbsReceiptRequestToken || 0) + 1);
  const batchScope = { ...(state.orderBatch?.scope || {}) };
  const requestStoreId = String(batchScope.storeId || selectedStoreId() || "").trim();
  setBusy(button, true);
  try {
    const queryParams = new URLSearchParams();
    if (environment) queryParams.set("environment", environment);
    if (requestStoreId) queryParams.set("storeId", requestStoreId);
    ["since", "to", "status", "warehouseId", "limit", "offset", "cursor", "sortDir"].forEach((key) => {
      if (batchScope[key] !== undefined && batchScope[key] !== null && String(batchScope[key]) !== "") {
        queryParams.set(key, String(batchScope[key]));
      }
    });
    if (batchScope.pagination === "cursor" || batchScope.cursor !== undefined) queryParams.set("pagination", "cursor");
    const query = queryParams.toString() ? `?${queryParams.toString()}` : "";
    const data = await api(`/api/ozon/order-dashboard/evidence-receipts${query}`);
    const currentStoreId = String(selectedStoreId() || "").trim();
    if (requestToken !== state.fbsReceiptRequestToken || currentStoreId !== requestStoreId) {
      if (response) response.textContent = "店铺或订单批次已变化，本次回执摘要已丢弃；请重新查看当前批次。";
      return false;
    }
    const latest = data.latestReceipt;
    if (response) response.textContent = latest
      ? `已保存 ${Number(data.receiptCount || 0)} 次 · 最近 ${escapeHtml(latest.checkedAt || "未知时间")} · 状态 ${escapeHtml(latest.status || "needs_review")} · 验证 ${escapeHtml(latest.verificationLevel || "server_observed")} · ${escapeHtml(latest.nextAction || (latest.datasetComplete ? "当前范围完成（全范围完成）" : latest.hasNext ? "仍有下一批" : "当前范围需要复核"))} ${escapeHtml(latest.sideEffect || "不会备货、发运或取消。")}`
      : "当前环境还没有已保存的服务端观察回执。";
  } catch {
    if (response) response.textContent = "回执摘要读取失败，请检查服务状态后重试。";
  } finally { setBusy(button, false); }
}

function orderStatusClass(statusGroup = "") {
  const allowed = new Set(["awaiting_packaging", "awaiting_deliver", "delivering", "dispute", "delivered", "cancelled"]);
  return allowed.has(String(statusGroup || "")) ? String(statusGroup) : "unknown";
}

function safeOrderImageUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw || /[\u0000-\u001f\u007f"'<>\\]/.test(raw)) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function orderSellerNextAction(order = {}) {
  const status = String(order.statusGroup || order.status || "").toLowerCase();
  const hasUnknownProduct = !Array.isArray(order.products) || !order.products.length
    || order.products.some((product) => product?.quantityStatus === "unknown" || product?.quantity == null || product?.detailStatus !== "matched");
  if (status === "dispute" || String(order.substatus || "").toLowerCase().includes("dispute")) {
    return "先进入争议/售后处理并核对平台状态；争议未澄清前不要备货或发运。";
  }
  if (order.deadlineStatus === "overdue") {
    return "截止时间已过：先重新读取订单详情并核对平台状态；不要按旧状态备货或发运。";
  }
  if (hasUnknownProduct) {
    return "先重新读取选中货件详情，确认 SKU 与数量；确认前不要备货或发运。";
  }
  if (order.deadlineStatus === "due_soon") {
    return "截止时间临近：先核对详情和仓库，再按平台流程人工处理；本页不执行发运。";
  }
  if (status === "awaiting_packaging") return "订单可进入备货核对；本页不执行备货或发运。";
  if (status === "awaiting_deliver") return "订单待发运；先核对包裹和追踪信息；本页不执行发运。";
  return "当前仅只读观察；如需履约，请先核对订单详情和平台状态。";
}

function orderRowHtml(order) {
  const firstProduct = order.products[0] || {};
  const productsHtml = order.products.length
    ? order.products.map((product) => `
    <div class="order-product-line">
      <strong>${product.quantityStatus === "unknown" || product.quantity == null ? "数量未知，需重读" : `${escapeHtml(product.quantity)} x`} ${escapeHtml(product.offer_id || product.sku || "-")}</strong>
      <span>${escapeHtml(product.name || "-")}</span>
      <small>${product.detailStatus === "matched" ? "商品详情已匹配" : "商品详情未知；不能据此备货"}</small>
    </div>
    `).join("")
    : `<div class="order-product-line"><strong>商品明细未知，需重读</strong><span>当前批次没有返回商品行，不能把该订单当作可履约事实。</span><small>只读详情未建立数量证据</small></div>`;
  const safeImage = safeOrderImageUrl(firstProduct.image);
  const image = safeImage
    ? `<img class="product-photo" src="${escapeHtml(safeImage)}" alt="${escapeHtml(firstProduct.name || "")}" />`
    : `<div class="photo-placeholder">＋</div>`;
  const weightText = order.declaration_weight_required ? "需填写" : "不适用";
  const deadlineLabel = order.deadlineStatus === "overdue"
    ? "已超时，需人工核对"
    : order.deadlineStatus === "due_soon"
      ? "12 小时内到期，优先处理"
      : order.deadlineStatus === "unknown"
        ? "截止时间未知，不能安全安排"
        : order.deadlineStatus === "upcoming" ? "截止时间已读取" : "";
  return `
    <tr>
      <td>
        <div class="product-offer">
          <strong>${escapeHtml(order.posting_number || "-")}</strong>
          <span>${escapeHtml(order.tracking_number || "")}</span>
        </div>
      </td>
      <td><span class="status-pill ${orderStatusClass(order.statusGroup)}">${escapeHtml(order.status_label || "状态未知")}</span></td>
      <td>${formatDateTime(order.accepted_at)}</td>
      <td>${order.shipment_date ? formatDateTime(order.shipment_date) : "截止时间未知"}${deadlineLabel ? `<div class="status-sub">${escapeHtml(deadlineLabel)}</div>` : ""}</td>
      <td>${image}</td>
      <td>
        ${productsHtml}
        <details class="order-readonly-detail">
          <summary>查看只读详情</summary>
          ${order.posting_number
            ? `<button type="button" class="ghost" data-fbs-order-detail="${escapeHtml(order.posting_number)}">重新读取选中货件详情</button>`
            : `<button type="button" class="ghost" disabled title="缺少 posting number，无法定位货件详情">无法重读：缺少货件编号</button>`}
          <span class="status-sub" data-fbs-order-detail-result>尚未单独读取；列表行不是详情证据。</span>
          <div><span>订单号：${escapeHtml(order.order_number || "未知")}</span><span>仓库：${escapeHtml(order.warehouse || "未知")}</span><span>追踪号：${escapeHtml(order.tracking_number || "未知")}</span></div>
          <small>卖家下一步：${escapeHtml(orderSellerNextAction(order))}</small>
          <small>任务：${escapeHtml(order.task?.nextAction || "当前仅只读观察")}</small>
          <small>只读详情；数量未知时必须重新读取，当前不提供备货、发运或取消操作。</small>
        </details>
      </td>
      <td>${order.financialStatus === "not_requested" ? "财务数据未读取" : `${formatMoney(order.price)} ${escapeHtml(order.currency_code || "")}`}</td>
      <td>${escapeHtml(order.warehouse || "仓库未知")}</td>
      <td>${escapeHtml(order.delivery_service || "-")}<div class="status-sub">${escapeHtml(order.delivery_type || order.delivery_method || "")}</div></td>
      <td>${weightText}</td>
    </tr>
  `;
}

async function loadFbsOrderDetail(button) {
  const postingNumber = String(button?.dataset?.fbsOrderDetail || "").trim();
  const container = button?.closest(".order-readonly-detail");
  const result = container?.querySelector("[data-fbs-order-detail-result]");
  if (!postingNumber || !container) return;
  const storeId = String(state.orderBatch?.scope?.storeId || $("#storeSelect")?.value || "").trim();
  const environmentCheck = validateReadOperatorEnvironment(currentSellerReadEnvironment());
  const requestEnvironment = environmentCheck.environment || "";
  if (!storeId) {
    if (result) result.textContent = "未选择店铺，不能读取详情。";
    return;
  }
  if (!environmentCheck.ok) {
    if (result) result.textContent = environmentCheck.message || "未绑定读取环境，不能读取详情。";
    return;
  }
  const detailRequestToken = (state.orderDetailRequestToken = Number(state.orderDetailRequestToken || 0) + 1);
  button.disabled = true;
  if (result) result.textContent = "正在读取选中货件详情；不会执行履约动作。";
  try {
    const params = new URLSearchParams({ storeId, postingNumber, environment: requestEnvironment });
    const data = await api(`/api/ozon/order-dashboard/detail?${params}`);
    const currentStoreId = String(selectedStoreId() || state.orderBatch?.scope?.storeId || $("#storeSelect")?.value || "").trim();
    if (detailRequestToken !== state.orderDetailRequestToken
      || currentStoreId !== storeId
      || String(currentSellerReadEnvironment() || "").trim() !== requestEnvironment
      || String(data?.environment || "").trim() !== requestEnvironment) {
      if (result) result.textContent = "店铺或订单批次已变化，本次详情结果已丢弃；请重新读取当前货件详情。";
      return false;
    }
    const detail = data.orders?.[0] || null;
    const identity = data.detailRead?.returnedPostingIdentity || "";
    if (data.partial || data.expectedPostingIdentity !== postingNumber || identity !== postingNumber || !detail) {
      if (result) result.textContent = `详情证据不完整：${data.sellerView?.nextAction || "请重新读取当前货件"}`;
    } else if (result) {
      const products = Array.isArray(detail.products) ? detail.products : [];
      const productRows = products.slice(0, 20).map((product) => {
        const offer = String(product?.offer_id || product?.offerId || product?.sku || "未知 SKU").trim();
        const quantity = product?.quantityStatus === "unknown" || product?.quantity == null
          ? "数量未知，需重读"
          : `${product.quantity} 件`;
        return `<li><b>${escapeHtml(offer)}</b> · ${escapeHtml(quantity)} · ${escapeHtml(product?.name || "商品名称未知")}</li>`;
      }).join("");
      result.innerHTML = `<span class="fbs-detail-readback-ok">详情已回读：${products.length} 个商品行</span>${productRows ? `<ul class="fbs-detail-product-list">${productRows}</ul>` : "<span>未返回可解释商品行，不能据此备货。</span>"}<span>${escapeHtml(detail.task?.nextAction || "当前仅只读观察；确认数量后再按平台流程人工处理")}</span>`;
    }
  } catch (error) {
    if (result) result.textContent = `详情读取失败：${error?.message || "请稍后重试"}`;
  } finally {
    button.disabled = false;
  }
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function collect1688() {
  const button = $("#collect1688");
  setBusy(button, true);
  try {
    const data = await api("/api/1688/collect", {
      method: "POST",
      body: JSON.stringify({
        url: $("#collect1688Url").value.trim(),
        html: $("#collect1688Html").value,
        storeId: $("#captureStoreSelect")?.value || selectedStoreId(),
        includeVideo: $("#manualIncludeVideo")?.checked !== false,
      }),
    });
    state.collected1688 = data;
    state.currentCaptureId = data.collectionId || "";
    render1688Collection(data);
    await loadCaptureBox();
    showResponse(data);
    toast(data.duplicate ? `已采集过：${data.collectionId || data.id || ""}` : "1688 商品已采集");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function sha256Text(value) {
  if (!window.crypto?.subtle) return "";
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

async function import1688Fixture() {
  const button = $("#import1688Fixture");
  const status = $("#1688FixtureImportStatus");
  const manifestFile = $("#1688FixtureManifest")?.files?.[0];
  const pageFile = $("#1688FixturePage")?.files?.[0];
  if (!manifestFile || !pageFile) {
    if (status) status.textContent = "请同时选择 manifest.json 和 page.html。";
    return;
  }
  setBusy(button, true);
  try {
    const [manifestText, html] = await Promise.all([manifestFile.text(), pageFile.text()]);
    let manifest;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      throw new Error("manifest.json 不是有效 JSON");
    }
    if (manifest?.redacted !== true) throw new Error("只接受明确标记 redacted=true 的脱敏快照");
    const url = String(manifest.url || "").trim();
    if (!url) throw new Error("manifest.json 缺少商品 url");
    if (!html.trim()) throw new Error("page.html 为空");
    if (html.length > 50 * 1024 * 1024) throw new Error("page.html 超过 50MB，本地导入已阻断");
    const hints = manifest.hints && typeof manifest.hints === "object" ? manifest.hints : {};
    const safeHintKeys = ["taskId", "capturedAt", "captureMode", "title", "images", "detailImages", "attributes", "skuVariants", "packageInfo", "supplier", "supplierId", "supplierName", "moq", "priceTiers", "video"];
    const safeHints = Object.fromEntries(safeHintKeys.filter((key) => Object.prototype.hasOwnProperty.call(hints, key)).map((key) => [key, hints[key]]));
    const fixtureProvenance = {
      fixtureKind: manifest.fixtureKind || "real_redacted_capture",
      synthetic: typeof manifest.synthetic === "boolean" ? manifest.synthetic : null,
      redacted: true,
      verificationLevel: manifest.verificationLevel || "locally_tested_fixture",
      manifestHash: await sha256Text(manifestText),
      captureMode: hints.captureMode || "fixture_replay",
      capturedAt: hints.capturedAt || "",
      validationTargets: Array.isArray(manifest.validationTargets) ? manifest.validationTargets : [],
    };
    const data = await api("/api/1688/capture", {
      method: "POST",
      body: JSON.stringify({
        url,
        html,
        storeId: $("#captureStoreSelect")?.value || selectedStoreId(),
        includeVideo: $("#manualIncludeVideo")?.checked !== false,
        ...safeHints,
        taskId: hints.taskId || manifest.taskId || "",
        capturedAt: hints.capturedAt || "",
        captureMode: hints.captureMode || "fixture_replay",
        fixtureProvenance,
      }),
    });
    state.collected1688 = data;
    state.currentCaptureId = data.id || "";
    render1688Collection(data);
    await loadCaptureBox();
    showResponse({ fixtureImport: { ok: true, collectionId: data.id, captureReceipt: data.captureReceipt }, sideEffect: "仅保存解析摘要与哈希；未保存原始 HTML，未提交 Ozon。" });
    if (status) status.textContent = `已导入 ${data.title || "商品"}；仅保存解析摘要，可在采集箱运行本地预检。`;
    toast(data.duplicate ? "该快照已存在，已保留原采集记录" : "脱敏快照已导入采集箱");
  } catch (error) {
    if (status) status.textContent = error.message || "脱敏快照导入失败";
    toast(error.message || "脱敏快照导入失败", "error");
  } finally {
    setBusy(button, false);
  }
}

async function loadCaptureBox() {
  const data = await api("/api/1688/captures");
  state.captureRows = data.items || [];
  renderCaptureBox();
  renderGlobalCurrentTaskBar();
  renderCurrentProductWorkspace();
  renderListingSellerTaskSummary();
}

async function openCaptureFromDeepLink() {
  const captureId = String(new URLSearchParams(window.location.search).get("captureId") || "").trim();
  if (!captureId) return false;
  const item = state.captureRows.find((row) => String(row.id || "") === captureId);
  if (!item) {
    toast("采集结果已回传，但当前店铺看不到这条采集记录，请先检查店铺范围。", "error");
    return false;
  }
  await openCurrentCaptureTask(captureId, item.storeId);
  return true;
}

function isSyntheticCapture(item = {}) {
  const product = item.parsed || {};
  const fixture = product.sourceEvidenceRecord?.fixtureProvenance || product.fixtureProvenance || item.fixtureProvenance || {};
  const captureMode = String(fixture.captureMode || product.capture?.captureMode || item.captureMode || "").toLowerCase();
  const title = String(product.title || item.title || "").toLowerCase();
  return fixture.manifestHash || /fixture|replay|test/.test(captureMode) || /fixture product|test product|测试商品/.test(title);
}

function captureSnapshotHash(item = {}) {
  const product = item.parsed || item;
  return String(product.sourceEvidenceRecord?.snapshot?.hash || product.sourceEvidence?.snapshotHash || "").trim();
}

function currentCaptureSellerTask() {
  const realCaptures = (state.captureRows || []).filter((item) => !isSyntheticCapture(item));
  const requestedId = String(state.currentCaptureId || new URLSearchParams(window.location.search).get("captureId") || "").trim();
  const ranked = realCaptures.map((item) => {
    const product = item.parsed || {};
    const snapshotHash = captureSnapshotHash(item);
    const review = product.captureReview || item.captureReview || {};
    const reviewApproved = review.humanConfirmed === true
      && String(review.reviewedSnapshotHash || "").trim() === snapshotHash
      && /^sha256:[a-f0-9]{64}$/i.test(snapshotHash);
    const reviewPossible = /^sha256:[a-f0-9]{64}$/i.test(snapshotHash);
    const reviewNeeded = !reviewApproved;
    const hasDraft = Boolean(item.draft?.parentSku || item.draft?.payloadDraftHash || item.draft?.categoryId || item.draft?.typeId);
    const captureMode = String(product.sourceEvidenceRecord?.captureIdentity?.captureMode || product.capture?.captureMode || item.captureMode || "").toLowerCase();
    const rank = String(item.id || "") === requestedId ? 0 : /extension_browser|browser_extension/.test(captureMode) ? 1 : 2;
    return { item, product, reviewApproved, reviewPossible, reviewNeeded, hasDraft, rank };
  }).sort((left, right) => left.rank - right.rank
    || String(right.item.updatedAt || right.item.receivedAt || "").localeCompare(String(left.item.updatedAt || left.item.receivedAt || "")));
  return ranked[0] || null;
}

function currentProductWorkspaceModel() {
  const captureTask = currentCaptureSellerTask();
  if (!captureTask) {
    return {
      empty: true,
      title: "还没有真实采集商品",
      status: "等待采集商品",
      reason: "请先采集一个准备上架的真实商品。",
      actionLabel: "去采集商品",
      actionKind: "view",
      actionView: "sourcing",
      actionEffect: "打开采集页面，不会自动上架或产生费用。",
      userInstruction: "去 1688 选择一个商品，用 Ozon ERP 插件完成采集。",
      systemNext: "采集成功后，商品会自动回到这个首页并开始整理。",
      safetyBoundary: "现在不会提交到 Ozon，也不会调用任何付费 AI；两者都需你另行确认。",
      completed: [],
      required: ["采集一个真实 1688 商品"],
      stages: ["采集商品", "检查商品", "确认上架"].map((label, index) => ({ label, status: index === 0 ? "current" : "pending" })),
    };
  }
  const { item, product, reviewApproved, reviewPossible, reviewNeeded, hasDraft } = captureTask;
  const run = currentListingWorkflowRun();
  const store = state.stores.find((row) => String(row.id || "") === String(item.storeId || ""));
  const source = product.sourceEvidenceRecord || product.sourceEvidence || {};
  const offerId = String(source.captureIdentity?.offerId || source.offerId || product.offerId || item.offerId || "").trim();
  const sourceVariants = Array.isArray(product.skuVariants) ? product.skuVariants : [];
  const firstImage = Array.isArray(product.images) ? product.images[0] : "";
  const rawImageUrl = String(typeof firstImage === "string" ? firstImage : firstImage?.url || "").trim();
  const imageUrl = /^https?:\/\//i.test(rawImageUrl) ? rawImageUrl : "";
  const uniqueSourceSkuIds = new Set(sourceVariants
    .map((variant) => String(variant?.sourceSkuId || variant?.source_sku_id || variant?.skuId || variant?.sku_id || "").trim())
    .filter(Boolean));
  const skuCount = Number(item.draft?.uniqueSourceSkuCount || uniqueSourceSkuIds.size || sourceVariants.length || item.skuCount || 0);
  const imageCount = Number(product.images?.length || product.imageCount || item.imageCount || 0);
  const draftReady = reviewApproved === true && Boolean(run || hasDraft);
  const currentDraftHash = String(run?.payloadDraftHash || "").trim();
  const validatedDraftHash = String(run?.validatedDraftHash || run?.payloadDraftValidation?.draftHash || "").trim();
  const validationReportedPassed = run?.payloadDraftValidation?.ok === true;
  const validationHashMatches = Boolean(currentDraftHash && validatedDraftHash && currentDraftHash === validatedDraftHash);
  const preflightPassed = reviewApproved === true && validationReportedPassed && validationHashMatches;
  const validationStale = validationReportedPassed && !validationHashMatches;
  const issueCount = Array.isArray(run?.payloadDraftValidation?.issues) ? run.payloadDraftValidation.issues.length : 0;
  const confirmed = reviewApproved === true;
  const completed = [
    `已读取商品${offerId ? ` · 货号 ${offerId}` : ""} · ${skuCount || "-"} 个规格${imageCount ? ` · ${imageCount} 张图片` : ""}`,
  ];
  if (preflightPassed) completed.push("商品资料检查通过");
  else if (draftReady) completed.push("系统和 AI 正在整理商品资料");
  else if (confirmed) completed.push("商品已确认，等待系统继续处理");

  let status = "等待你确认商品";
  let reason = "请确认标题、规格和图片属于你刚刚采集的商品。";
  let actionLabel = "确认这是我的商品";
  let actionKind = "capture_review";
  let actionView = "sourcing";
  let actionEffect = `确认 ${store?.name || item.storeId || "目标店铺"} 的当前商品；确认后建立本地草稿，不会自动上架。`;
  let userInstruction = "确认标题、规格和图片是你刚刚采集的商品。";
  let systemNext = "系统会建立本地商品草稿并打开资料页；只有无法判断的内容才会再问你。";
  let safetyBoundary = "现在不会提交到 Ozon，也不会调用任何付费 AI；两者都需你另行确认。";
  let required = ["确认标题、规格和图片是否正确"];
  if (!reviewPossible) {
    status = "商品资料不完整";
    reason = "这次采集缺少必要信息，系统无法安全处理。";
    actionLabel = "重新采集商品";
    actionKind = "capture";
    actionEffect = `打开 ${store?.name || item.storeId || "目标店铺"} 的采集记录；重新采集不会自动上架。`;
    userInstruction = "回到这个 1688 商品页面，用插件重新采集一次。";
    systemNext = "系统会检查新数据，完整后自动回到商品确认。";
    required = ["重新打开商品页面并采集"];
  } else if (!reviewNeeded && !draftReady) {
    status = "商品正在整理";
    reason = "商品已经确认，系统正在准备商品资料。";
    actionLabel = "建立商品草稿";
    actionKind = "capture_workflow";
    actionEffect = "建立或恢复当前商品的唯一本地草稿，不会自动上架。";
    userInstruction = "点击建立当前商品的本地草稿。";
    systemNext = "系统会整理已有规格和图片，并打开需要你确认的资料。";
    required = ["继续当前商品"];
  } else if (draftReady && !preflightPassed) {
    status = validationStale ? "商品有更新，需要重新检查" : issueCount ? `需要补充 ${issueCount} 项资料` : "商品资料待完善";
    reason = validationStale
      ? "商品资料在上次检查后发生了变化，系统需要重新确认。"
      : issueCount
        ? `还有 ${issueCount} 项资料无法自动判断，需要你确认。`
        : "系统和 AI 已完成可自动处理的内容，只留下必须确认的资料。";
    actionLabel = validationStale ? "重新检查商品" : "完善商品资料";
    actionKind = run ? "workflow" : "capture_workflow";
    if (!run) actionLabel = "打开商品资料";
    actionView = "listing";
    actionEffect = validationStale
      ? "重新检查当前版本，检查通过前不会上架。"
      : "只处理当前商品缺少的资料，检查通过前不会上架。";
    userInstruction = !run
      ? "打开当前商品资料，只处理系统无法确定的内容。"
      : validationStale
      ? "重新核对发生变化的商品资料。"
      : "只补充系统无法确定的内容，不需要重做已经完成的资料。";
    systemNext = run
      ? "系统会重新检查商品；通过后再通知你确认是否上架。"
      : "系统会恢复当前商品的唯一任务并打开资料页，不会让你寻找其他控件。";
    required = [actionLabel];
  } else if (preflightPassed) {
    status = "商品已准备好";
    reason = "系统检查已经通过，最后由你决定是否上架。";
    actionLabel = "确认上架";
    actionKind = "workflow";
    actionView = "listing";
    actionEffect = "先展示价格和商品摘要，只有你再次确认才会提交。";
    userInstruction = "核对商品摘要和价格，决定是否进入最后确认。";
    systemNext = "系统会先展示本次提交内容；仍需你再次确认才会提交。";
    safetyBoundary = "点击这里不会直接提交；Ozon 提交和任何付费 AI 都需你另行确认。";
    required = ["确认商品信息和价格后决定是否上架"];
  }
  return {
    empty: false,
    captureId: String(item.id || ""),
    storeId: String(item.storeId || ""),
    runId: String(run?.id || ""),
    title: product.title || item.title || "未命名商品",
    storeLabel: store?.name || item.storeId || "店铺未绑定",
    offerId,
    imageUrl,
    skuCount,
    imageCount,
    reviewNeeded,
    status,
    reason,
    actionLabel,
    actionKind,
    actionView,
    actionEffect,
    userInstruction,
    systemNext,
    safetyBoundary,
    completed,
    required,
    stages: [
      { label: "采集商品", status: reviewPossible ? "complete" : "current" },
      { label: "检查商品", status: preflightPassed ? "complete" : reviewPossible ? "current" : "pending" },
      { label: "确认上架", status: preflightPassed ? "current" : "pending" },
    ],
  };
}

function currentProductActionAttributes(model = {}) {
  const captureId = String(model.captureId || "").trim();
  const storeId = String(model.storeId || "").trim();
  const runId = String(model.runId || "").trim();
  if (model.actionKind === "capture_review") {
    if (!captureId) throw new Error("当前商品确认动作缺少采集记录");
    return `data-current-capture-review="${escapeHtml(captureId)}" data-current-capture-store-id="${escapeHtml(storeId)}"`;
  }
  if (model.actionKind === "capture_workflow") {
    if (!captureId) throw new Error("当前商品草稿动作缺少采集记录");
    return `data-current-capture-workflow="${escapeHtml(captureId)}" data-current-capture-store-id="${escapeHtml(storeId)}"`;
  }
  if (model.actionKind === "capture") {
    if (!captureId) throw new Error("当前商品采集动作缺少采集记录");
    return `data-current-capture-id="${escapeHtml(captureId)}" data-current-capture-store-id="${escapeHtml(storeId)}"`;
  }
  if (model.actionKind === "workflow") {
    if (!runId) throw new Error("当前商品动作缺少工作流");
    return `data-current-workflow-id="${escapeHtml(runId)}" data-current-workflow-store-id="${escapeHtml(storeId)}"`;
  }
  return `data-cockpit-view="${escapeHtml(model.actionView || "sourcing")}"`;
}

function renderCurrentProductWorkspace() {
  const model = currentProductWorkspaceModel();
  const workspace = $("#currentProductWorkspace");
  const progress = $("#currentProductProgress");
  const completed = $("#currentProductCompleted");
  const required = $("#currentProductRequired");
  const listingGate = $("#listingCurrentProductGate");
  const actionAttributes = currentProductActionAttributes(model);
  if (workspace) {
    workspace.innerHTML = `
      <div class="current-product-main">
        <div class="current-product-thumbnail">
          ${model.imageUrl ? `<img src="${escapeHtml(model.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span>OZ</span>`}
        </div>
        <div class="current-product-identity">
          <span class="current-product-status">${escapeHtml(model.status)}</span>
          <h2>${escapeHtml(model.title)}</h2>
          <p>${escapeHtml(model.reason)}</p>
          <div class="current-product-meta">
            ${model.storeLabel ? `<span>${escapeHtml(model.storeLabel)}</span>` : ""}
            ${model.offerId ? `<span>货号 ${escapeHtml(model.offerId)}</span>` : ""}
            ${model.skuCount ? `<span>${escapeHtml(model.skuCount)} 个规格</span>` : ""}
            ${model.imageCount ? `<span>${escapeHtml(model.imageCount)} 张图片</span>` : ""}
          </div>
        </div>
      </div>
      <div class="current-product-primary-action">
        <span class="current-product-action-kicker">现在只做这一步</span>
        <p class="current-product-user-instruction">${escapeHtml(model.userInstruction)}</p>
        <button class="primary" type="button" aria-describedby="currentProductActionDescription currentProductActionSafety" ${actionAttributes}>${escapeHtml(model.actionLabel)}</button>
        <div class="current-product-action-explanation">
          <div><span>点完以后</span><strong id="currentProductActionDescription">${escapeHtml(model.systemNext)}</strong></div>
          <div class="is-safe"><span>安全边界</span><strong id="currentProductActionSafety">${escapeHtml(model.safetyBoundary)}</strong></div>
        </div>
      </div>`;
  }
  if (progress) progress.innerHTML = model.stages.map((stage, index) => `<li class="${escapeHtml(stage.status)}"><span>${index + 1}</span><strong>${escapeHtml(stage.label)}</strong></li>`).join("");
  if (completed) completed.innerHTML = model.completed.length
    ? `<ul>${model.completed.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<p>采集完成后，系统会在这里显示处理结果。</p>`;
  if (required) required.innerHTML = `<strong>${escapeHtml(model.status)}</strong><p>${escapeHtml(model.required.join("；"))}</p><small>${escapeHtml(model.actionEffect)}</small>`;
  if (listingGate) {
    listingGate.classList.toggle("is-blocked", model.reviewNeeded || model.empty);
    listingGate.innerHTML = `
      <div><span>当前商品</span><strong>${escapeHtml(model.title)}</strong><small>${escapeHtml(model.storeLabel || "尚未绑定店铺")}${model.offerId ? ` · Offer ${escapeHtml(model.offerId)}` : ""}</small></div>
      <div><span>下一步</span><strong>${escapeHtml(model.status)}</strong><small>${escapeHtml(model.reason)}</small></div>
      <button class="primary" type="button" ${actionAttributes}>${escapeHtml(model.actionLabel)}</button>`;
  }
}

function renderGlobalCurrentTaskBar() {
  const target = $("#globalCurrentTaskBody");
  if (!target) return;
  const task = currentCaptureSellerTask();
  if (!task) {
    target.innerHTML = `<div><strong>还没有商品</strong><small>先采集一个准备上架的商品。</small></div><button type="button" class="primary" data-cockpit-view="sourcing">去采集商品</button>`;
    return;
  }
  const { item, product, reviewNeeded, hasDraft } = task;
  const store = state.stores.find((row) => row.id === item.storeId);
  const status = reviewNeeded ? "等待你确认商品" : hasDraft ? "继续完善商品资料" : "商品正在整理";
  target.innerHTML = `
    <div class="global-current-task-copy">
      <strong title="${escapeHtml(product.title || "未命名商品")}">${escapeHtml(product.title || "未命名商品")}</strong>
      <small>${escapeHtml(store?.name || item.storeId || "店铺未绑定")} · ${escapeHtml(status)}</small>
    </div>
    <button type="button" class="primary" data-global-capture-id="${escapeHtml(item.id)}" data-global-capture-store-id="${escapeHtml(item.storeId || "")}">${reviewNeeded ? "检查商品" : "继续处理"}</button>
  `;
}

async function openCurrentCaptureTask(captureId = "", storeId = "") {
  const id = String(captureId || "").trim();
  const item = state.captureRows.find((row) => String(row.id || "") === id);
  if (!item) {
    toast("当前采集商品已不存在，请刷新采集箱。", "error");
    return false;
  }
  storeId = String(storeId || item.storeId || "").trim();
  activateErpView("sourcing");
  await switchStoreContext(storeId, { loadWarehouses: false });
  if ($("#captureStoreSelect")) $("#captureStoreSelect").value = storeId;
  state.currentCaptureId = id;
  renderCaptureBox();
  const row = document.querySelector(`#captureBoxTable tr[data-id="${CSS.escape(id)}"]`);
  row?.scrollIntoView({ behavior: "smooth", block: "center" });
  row?.classList.add("capture-deep-link-focus");
  window.setTimeout(() => row?.classList.remove("capture-deep-link-focus"), 2200);
  toast("已打开当前真实商品；操作按钮固定在右侧，不需要横向查找。", "ok");
  return true;
}

async function loadCrawlerTasks() {
  try {
    const data = await api("/api/1688-crawler/tasks");
    state.crawlerTasks = data.items || [];
    if (!state.selectedCrawlerTaskId && state.crawlerTasks.length) {
      state.selectedCrawlerTaskId = state.crawlerTasks[0].id;
    }
    renderCrawlerTaskRows();
    renderCrawlerLivePanel();
  } catch (error) {
    state.crawlerTasks = [];
    state.selectedCrawlerTaskId = "";
    renderCrawlerTaskRows();
    renderCrawlerLivePanel();
    throw error;
  }
}

async function loadCrawlerSessionStatus() {
  const data = await api("/api/1688-crawler/session/status");
  const el = $("#crawlerCookieStatus");
  if (!el) return;
  el.textContent = data.hasCookie
    ? `已保存 Cookie（更新于 ${formatDateTime(data.updatedAt)}）`
    : "未保存 Cookie";
}

async function loadCrawlerWorkerStatus() {
  const data = await api("/api/1688-crawler/extension/status");
  state.crawlerWorkerStatus = data;
  renderCrawlerWorkerStatus();
  renderCrawlerLivePanel();
}

async function loadOpen1688Status() {
  const data = await api("/api/1688-open/status");
  state.open1688Status = data;
  renderOpen1688Status();
}

function renderOpen1688Status() {
  const body = $("#open1688StatusBody");
  if (!body) return;
  const data = state.open1688Status || {};
  const updated = $("#open1688StatusUpdated");
  if (updated) updated.textContent = `更新 ${formatDateTime(new Date().toISOString())}`;
  const statusClass = data.configured ? "ready" : "missing";
  const statusText = data.configured ? "已配置" : "缺配置";
  const missing = (data.missing || []).length ? data.missing.join("、") : "无";
  body.innerHTML = `
    <article class="open1688-status-card ${statusClass}">
      <span>接口状态</span>
      <strong>${escapeHtml(statusText)}</strong>
      <p>${escapeHtml(data.nextStep || "-")}</p>
    </article>
    <article class="open1688-status-card">
      <span>应用</span>
      <strong>${escapeHtml(data.appName || "-")}</strong>
      <p>APPKEY: ${escapeHtml(data.appKey || "-")}</p>
    </article>
    <article class="open1688-status-card">
      <span>授权账号</span>
      <strong>${escapeHtml(data.accountName || "-")}</strong>
      <p>${escapeHtml(data.accountType || "-")} / ${escapeHtml(data.authorizedAt || "-")}</p>
    </article>
    <article class="open1688-status-card">
      <span>有效期</span>
      <strong>${escapeHtml(data.validFrom || "-")} 至 ${escapeHtml(data.validTo || "-")}</strong>
      <p>缺项: ${escapeHtml(missing)}</p>
    </article>
  `;
}

function renderCrawlerWorkerStatus() {
  const box = $("#crawlerWorkerStatus");
  if (!box) return;
  const workers = state.crawlerWorkerStatus?.items || [];
  const latest = workers[0] || null;
  const statusText = latest?.online ? "在线" : "离线";
  const currentJob = latest?.currentJobId
    ? `${latest.currentJobKind || "job"} / ${latest.currentTaskId || "-"}`
    : "空闲";
  box.innerHTML = `
    <article class="${latest?.online ? "online" : "offline"}">
      <span>插件状态</span>
      <strong>${statusText}</strong>
    </article>
    <article>
      <span>Worker ID</span>
      <strong>${escapeHtml(latest?.workerId || "-")}</strong>
    </article>
    <article>
      <span>最近检查任务</span>
      <strong>${formatDateTime(latest?.lastCheckAt || latest?.updatedAt)}</strong>
    </article>
    <article>
      <span>当前作业</span>
      <strong>${escapeHtml(currentJob)}</strong>
    </article>
    <article>
      <span>最近错误</span>
      <strong>${escapeHtml(latest?.lastError || latest?.message || "-")}</strong>
    </article>
    <article class="${latest?.needsHuman ? "needs-human" : ""}">
      <span>人机验证</span>
      <strong>${latest?.needsHuman ? "需要处理" : "无需处理"}</strong>
    </article>
  `;
}

function renderCrawlerTaskRows() {
  const tbody = $("#crawlerTaskRows");
  if (!tbody) return;
  const candidatesByTask = (state.crawlerCandidates || []).reduce((acc, item) => {
    acc[item.taskId] = (acc[item.taskId] || 0) + 1;
    return acc;
  }, {});
  tbody.innerHTML = state.crawlerTasks.length
    ? state.crawlerTasks.map((task) => `
      <tr data-task-id="${escapeHtml(task.id)}">
        <td><code>${escapeHtml(task.id)}</code></td>
        <td>${escapeHtml(task.sourceType)}<div class="status-sub">${escapeHtml(task.sourceValue || "-")}</div></td>
        <td>${escapeHtml(task.status || "-")}</td>
        <td>${candidatesByTask[task.id] || task.progress?.candidatesSaved || 0}</td>
        <td>${formatDateTime(task.updatedAt || task.createdAt)}</td>
        <td class="row-actions">
          <button class="small-blue crawler-view-task" type="button">查看候选</button>
          <button class="ghost crawler-pause-task" type="button">暂停</button>
          <button class="ghost crawler-resume-task" type="button">继续</button>
          <button class="ghost crawler-stop-task" type="button">停止</button>
          <button class="danger crawler-delete-task" type="button">删除</button>
        </td>
      </tr>
    `).join("")
    : "<tr><td colspan=\"6\" class=\"product-empty\">暂无任务</td></tr>";
  bindCrawlerTaskRows();
}

function bindCrawlerTaskRows() {
  document.querySelectorAll("#crawlerTaskRows tr[data-task-id]").forEach((row) => {
    const id = row.dataset.taskId;
    row.querySelector(".crawler-view-task")?.addEventListener("click", async () => {
      state.selectedCrawlerTaskId = id;
      await loadCrawlerCandidates();
      toast(`已切换到任务 ${id}`);
    });
    row.querySelector(".crawler-pause-task")?.addEventListener("click", () => updateCrawlerTaskStatus(id, "pause"));
    row.querySelector(".crawler-resume-task")?.addEventListener("click", () => updateCrawlerTaskStatus(id, "resume"));
    row.querySelector(".crawler-stop-task")?.addEventListener("click", () => updateCrawlerTaskStatus(id, "stop"));
    row.querySelector(".crawler-delete-task")?.addEventListener("click", () => deleteCrawlerTask(id));
  });
}

async function loadCrawlerCandidates() {
  const requestToken = ++state.crawlerCandidateRequestToken;
  const requestedTaskId = state.selectedCrawlerTaskId;
  const params = new URLSearchParams();
  if (requestedTaskId) params.set("taskId", requestedTaskId);
  const status = $("#crawlerCandidateStatus")?.value.trim();
  const query = $("#crawlerCandidateQuery")?.value.trim();
  if (status) params.set("status", status);
  if (query) params.set("query", query);
  try {
    const data = await api(`/api/1688-crawler/candidates?${params}`);
    if (requestToken !== state.crawlerCandidateRequestToken || requestedTaskId !== state.selectedCrawlerTaskId) {
      return data;
    }
    state.crawlerCandidates = data.items || [];
    renderCrawlerCandidateRows();
    renderCrawlerTaskRows();
    renderCrawlerLivePanel();
  } catch (error) {
    if (requestToken !== state.crawlerCandidateRequestToken || requestedTaskId !== state.selectedCrawlerTaskId) {
      return null;
    }
    state.crawlerCandidates = [];
    renderCrawlerCandidateRows();
    renderCrawlerTaskRows();
    renderCrawlerLivePanel();
    throw error;
  }
}

function renderCrawlerCandidateRows() {
  const tbody = $("#crawlerCandidateRows");
  if (!tbody) return;
  tbody.innerHTML = state.crawlerCandidates.length
    ? state.crawlerCandidates.map((item) => {
      const status = String(item.status || "").toLowerCase();
      const captured = status === "captured";
      const ignored = status === "ignored";
      const sourceReview = item.sourceEvidenceSummary && typeof item.sourceEvidenceSummary === "object"
        ? item.sourceEvidenceSummary
        : item.parsed?.sourceEvidence?.sellerFacing || {};
      const sourceStatus = ["ready", "needs_review", "waiting_human", "unknown"].includes(String(sourceReview.status || ""))
        ? String(sourceReview.status)
        : "unknown";
      const sourceLabel = sourceStatus === "ready" ? "来源已验证"
        : sourceStatus === "waiting_human" ? "等待人工验证"
          : sourceStatus === "needs_review" ? "来源待补齐" : "来源证据未知";
      const sourceBlocker = String(sourceReview.blocker || (sourceStatus === "ready" ? "" : "缺少可安全使用的完整来源证据"));
      const sourceNextAction = String(sourceReview.nextAction || "重新打开 1688 商品详情页并采集有效页面快照");
      // A waiting-human source cannot be handed off accidentally.  Incomplete
      // evidence may still create a local draft so the seller can repair it,
      // but the row makes the limitation and side effect explicit.
      const actionDisabled = captured || ignored || sourceStatus === "waiting_human";
      const actionLabel = captured ? "已入采集箱" : ignored ? "已忽略" : sourceStatus === "waiting_human" ? "先完成人工验证" : "";
      const statusHint = captured
        ? "该候选已进入采集箱；这不代表已创建上架草稿，请打开采集箱继续确认来源证据。"
        : ignored ? "该候选已忽略，如需处理请调整筛选或恢复候选状态。"
          : sourceStatus === "waiting_human"
            ? `来源需要人工处理：${sourceBlocker} 下一步：${sourceNextAction}`
            : sourceStatus === "ready"
              ? "来源快照已记录；生成的只是本地草稿，仍需补齐资料并重新预检。"
              : `来源证据${sourceStatus === "needs_review" ? "待补齐" : "尚未确认"}：${sourceBlocker} 下一步：${sourceNextAction}`;
      return `
      <tr data-candidate-id="${escapeHtml(item.id)}" data-store-id="${escapeHtml(item.storeId || "")}">
        <td>
          <strong>${escapeHtml(item.title || "未命名商品")}</strong>
          <div class="status-sub"><a href="${escapeHtml(item.url || "#")}" target="_blank">${escapeHtml(item.url || "-")}</a></div>
        </td>
        <td>${escapeHtml(item.priceMin || "-")}${item.priceMax && item.priceMax !== item.priceMin ? ` ~ ${escapeHtml(item.priceMax)}` : ""}</td>
        <td>${escapeHtml(item.skuCount || 0)}</td>
        <td>${item.sizeWeightReady ? "完整" : "缺失"}</td>
        <td>${escapeHtml(item.score || 0)}</td>
        <td>${escapeHtml(item.status || "-")}<div class="status-sub candidate-source-evidence" data-source-evidence-status="${escapeHtml(sourceStatus)}">${escapeHtml(sourceLabel)}</div></td>
        <td class="row-actions">
          <button class="small-blue crawler-to-capture" type="button" ${actionDisabled ? "disabled" : ""}>${actionLabel || "入采集箱"}</button>
          <button class="primary crawler-create-listing-draft" type="button" ${actionDisabled ? "disabled" : ""}>${actionDisabled ? (captured ? "已入采集箱（未建草稿）" : "不可操作") : "建上架草稿"}</button>
          <button class="ghost crawler-ignore" type="button" ${actionDisabled ? "disabled" : ""}>${ignored ? "已忽略" : "忽略"}</button>
        </td>
      </tr>
      ${statusHint ? `<tr class="status-sub"><td colspan="7">${statusHint}</td></tr>` : ""}`;
    }).join("")
    : "<tr><td colspan=\"7\" class=\"product-empty\">暂无候选数据</td></tr>";
  bindCrawlerCandidateRows();
}

function bindCrawlerCandidateRows() {
  document.querySelectorAll("#crawlerCandidateRows tr[data-candidate-id]").forEach((row) => {
    const id = row.dataset.candidateId;
    const candidateStoreId = String(row.dataset.storeId || "").trim();
    row.querySelector(".crawler-ignore")?.addEventListener("click", async () => {
      await api(`/api/1688-crawler/candidates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ignored", storeId: candidateStoreId }),
      });
      await loadCrawlerCandidates();
      toast("候选已标记为忽略");
    });
    row.querySelector(".crawler-to-capture")?.addEventListener("click", () => moveCrawlerCandidateToCapture(id, candidateStoreId));
    row.querySelector(".crawler-create-listing-draft")?.addEventListener("click", () => createListingDraftFromCandidate(id));
  });
}

async function createListingDraftFromCandidate(id) {
  const row = document.querySelector(`#crawlerCandidateRows tr[data-candidate-id="${CSS.escape(id)}"]`);
  const button = row?.querySelector(".crawler-create-listing-draft");
  const candidateStoreId = String(row?.dataset.storeId || "").trim();
  const storeId = candidateStoreId || String(selectedStoreId() || "").trim();
  if (!storeId) {
    toast("候选没有归属店铺，请先绑定店铺后再建草稿", "error");
    return;
  }
  setBusy(button, true);
  try {
    const data = await api(`/api/1688-crawler/candidates/${encodeURIComponent(id)}/create-listing-draft`, {
      method: "POST",
      body: JSON.stringify({ storeId }),
    });
    state.listingHandoffNotice = data.duplicate
      ? "已找到已有本地上架草稿；下一步打开当前草稿并重新预检"
      : "1688 候选已交接为本地上架草稿；下一步补齐资料并运行预检";
    showResponse(data);
    toast(data.duplicate ? "已打开已有上架草稿；未提交 Ozon" : "已创建本地上架草稿；未提交 Ozon");
    await loadWorkflowRuns();
    // Duplicate handoffs may return the existing job without repeating a
    // workflowRunId. Resolve only an exact job/candidate binding after the
    // scoped workflow refresh; never fall back to the latest unrelated run.
    const existingJobId = String(data.job?.id || "").trim();
    const workflowRunId = String(data.workflowRunId || data.job?.workflowRunId || "").trim()
      || String((state.workflowRuns || []).find((run) => (
        (existingJobId && String(run?.entity?.autoListingJobId || run?.autoListingJobId || "").trim() === existingJobId)
        || String(run?.entity?.candidateId || run?.candidateId || "").trim() === String(id || "").trim()
      ))?.id || "").trim();
    // Keep the legacy no-id guard visible for static safety audits: if (!data.workflowRunId)
    // alone is insufficient for duplicate responses, so the exact binding above is required.
    if (!workflowRunId) {
      // A local job without a workflow cannot reach the normal preflight and
      // must not make the listing page fall back to an unrelated latest run.
      // Leave the seller in the candidate context with an explicit recovery
      // action instead of showing another product's draft.
      state.selectedWorkflowRunId = "__no_workflow__";
      state.listingHandoffNotice = "本地草稿已保存，但商品工作流未绑定；请稍后重试交接，绑定成功后才能运行预检。";
      toast("草稿已保存，但工作流未绑定；暂不能进入预检", "warning");
      return;
    }
    state.selectedWorkflowRunId = workflowRunId;
    state.selectedWorkflowNodeKey = "candidate_handoff";
    renderWorkflowConsole?.();
    activateErpView("listing");
    await loadAutoListJobs().catch(() => {});
    renderListingSellerTaskSummary();
  } catch (error) {
    const responseData = error.responseData || {};
    const nextAction = String(responseData.captureImportReview?.nextAction || responseData.nextAction || "").trim();
    if (nextAction) {
      state.listingHandoffNotice = nextAction;
      showResponse(responseData);
      activateErpView("listing");
      renderListingSellerTaskSummary();
      toast(`当前不能建草稿：${nextAction}`, "warning");
    } else {
      toast(error.message || "创建上架草稿失败", "error");
    }
  } finally {
    setBusy(button, false);
  }
}

async function moveCrawlerCandidateToCapture(id, storeId = "") {
  const data = await api(`/api/1688-crawler/candidates/${id}/to-capture`, {
    method: "POST",
    body: JSON.stringify({ storeId: storeId || selectedStoreId() }),
  });
  await loadCrawlerCandidates();
  await loadCaptureBox();
  showResponse(data);
  toast(data.capture?.duplicate ? "已采集过，保留原记录" : "已入采集箱");
  return data;
}

async function createCrawlerTask() {
  const button = $("#crawlerTaskStart");
  setBusy(button, true);
  try {
    const payload = {
      storeId: selectedStoreId(),
      sourceType: $("#crawlerSourceType").value,
      sourceValue: $("#crawlerSourceValue").value.trim(),
      options: {
        maxProducts: Number($("#crawlerMaxProducts").value || 20),
        mustHaveSku: $("#crawlerMustHaveSku").checked,
        mustHaveSizeWeight: $("#crawlerMustHaveSizeWeight").checked,
      },
    };
    const data = await api("/api/1688-crawler/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.selectedCrawlerTaskId = data.task?.id || "";
    await loadCrawlerTasks();
    await loadCrawlerCandidates();
    showResponse(data);
    toast("任务已创建，开始后台采集");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function saveCrawlerCookie() {
  const text = $("#crawlerCookie")?.value.trim();
  if (!text) {
    toast("请先粘贴 cookie", "error");
    return;
  }
  await api("/api/1688-crawler/session/cookie", {
    method: "POST",
    body: JSON.stringify({ cookie: text }),
  });
  await loadCrawlerSessionStatus();
  toast("Cookie 已保存");
}

async function clearCrawlerCookie() {
  await api("/api/1688-crawler/session/cookie", { method: "DELETE", body: JSON.stringify({}) });
  if ($("#crawlerCookie")) $("#crawlerCookie").value = "";
  await loadCrawlerSessionStatus();
  toast("Cookie 已清空");
}

function startCrawlerAutoRefresh() {
  if (state.crawlerRefreshTimer) return;
  state.crawlerRefreshTimer = window.setInterval(async () => {
    if (document.querySelector(".view.active")?.id !== "sourcing") return;
    await loadOpen1688Status();
    await loadCrawlerWorkerStatus();
    await loadCrawlerTasks();
    await loadCrawlerCandidates();
  }, 5000);
}

async function loadOzonLearningTasks() {
  try {
    const data = await api("/api/ozon-learning/tasks");
    state.ozonLearningTasks = data.items || [];
    if (!state.selectedOzonLearningTaskId && state.ozonLearningTasks.length) {
      state.selectedOzonLearningTaskId = state.ozonLearningTasks[0].id;
    }
    renderOzonLearningTaskRows();
  } catch (error) {
    state.ozonLearningTasks = [];
    state.selectedOzonLearningTaskId = "";
    renderOzonLearningTaskRows();
    throw error;
  }
}

async function loadOzonLearningItems() {
  const params = new URLSearchParams();
  if (state.selectedOzonLearningTaskId) params.set("taskId", state.selectedOzonLearningTaskId);
  const query = $("#ozonLearningQuery")?.value.trim();
  if (query) params.set("query", query);
  try {
    const data = await api(`/api/ozon-learning/items?${params}`);
    state.ozonLearningItems = data.items || [];
    renderOzonLearningItemRows();
    renderOzonLearningTaskRows();
  } catch (error) {
    state.ozonLearningItems = [];
    renderOzonLearningItemRows();
    renderOzonLearningTaskRows();
    throw error;
  }
}

async function loadOzonOpportunities() {
  const params = new URLSearchParams();
  const query = $("#ozonOpportunityQuery")?.value.trim();
  const minScore = $("#ozonOpportunityMinScore")?.value.trim();
  if (query) params.set("query", query);
  if (minScore) params.set("minScore", minScore);
  const data = await api(`/api/ozon-learning/opportunities?${params}`);
  state.ozonOpportunities = data.items || [];
  renderOzonOpportunityRows();
}

async function loadOzonImageStyleObservations() {
  const data = await api("/api/ozon-learning/image-style-observations");
  state.ozonImageStyleObservations = data || null;
  renderOzonImageStyleObservations();
}

async function loadOzonImageStyleAnalysis() {
  const data = await api("/api/ozon-learning/image-style-analysis");
  state.ozonImageStyleAnalysis = data || null;
  renderOzonImageStyleAnalysis();
}

async function rebuildOzonImageStyleObservations() {
  const button = $("#ozonImageStyleRebuild");
  setBusy(button, true);
  try {
    const payload = {
      limit: Number($("#ozonImageStyleLimit")?.value || 300),
      query: $("#ozonImageStyleQuery")?.value.trim() || "",
      minImages: 1,
    };
    const data = await api("/api/ozon-learning/image-style-observations/rebuild", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.ozonImageStyleObservations = data || null;
    renderOzonImageStyleObservations();
    toast(`图片观察库已重建：${Number(data.totalObserved || 0)} 个商品`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function runOzonImageStyleAnalysis() {
  const button = $("#ozonImageStyleAnalyze");
  setBusy(button, true);
  try {
    const data = await api("/api/ozon-learning/image-style-analysis/run", {
      method: "POST",
      body: JSON.stringify({ limit: 5 }),
    });
    state.ozonImageStyleAnalysis = data || null;
    renderOzonImageStyleAnalysis();
    toast(`GPT 图片观察完成：累计 ${Number(data.totalAnalyzed || 0)} 个样本`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function runOzonReferenceGuidance() {
  const button = $("#ozonReferenceGuidanceRun");
  setBusy(button, true);
  try {
    if (!state.ozonLearningItems.length) await loadOzonLearningItems();
    let latestCapture = state.collected1688;
    if (!latestCapture) {
      try {
        latestCapture = await api("/api/1688/capture/latest");
      } catch {
        latestCapture = null;
      }
    }
    const parsed = latestCapture?.parsed || latestCapture || {};
    if (!parsed.title && !parsed.subject) throw new Error("还没有最新 1688 商品，请先采集一个产品。");
    const references = (state.ozonLearningItems || [])
      .filter((item) => item.status === "detailed" || item.detail || item.images?.length || item.image)
      .slice(0, 8);
    if (!references.length) throw new Error("还没有 Ozon 同类样本，请先按当前商品关键词采样。");
    const data = await api("/api/ozon-learning/reference-guidance", {
      method: "POST",
      body: JSON.stringify({
        product: {
          title: parsed.title || parsed.subject || "",
          category: parsed.category || parsed.categoryName || "",
          url: parsed.url || "",
          images: parsed.images || parsed.imageUrls || parsed.detailImages || [],
          variants: parsed.skus || parsed.variants || parsed.colors || [],
          attributes: parsed.attributes || parsed.specs || {},
        },
        references,
      }),
    });
    state.ozonReferenceGuidance = data || null;
    state.ozonImage2Task = null;
    renderOzonReferenceGuidance();
    renderImage2TaskResult();
    showResponse(data);
    toast("单品实时参照指导卡已生成");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function firstImage2Prompt() {
  const prompts = state.ozonReferenceGuidance?.image2Prompts || [];
  const first = prompts.find((item) => item?.prompt) || prompts[0] || null;
  return String(first?.prompt || first || "").trim();
}

function renderImage2TaskResult() {
  const box = $("#ozonImage2TaskResult");
  if (!box) return;
  const task = state.ozonImage2Task || {};
  if (!task.taskId) {
    box.innerHTML = "<p class=\"hint\">生成指导卡后，可用第 1 条 image2 prompt 提交异步生图任务。</p>";
    return;
  }
  const images = Array.isArray(task.imageUrls) ? task.imageUrls : [];
  box.innerHTML = `
    <div class="ozon-image2-task-card">
      <div>
        <strong>任务 ${escapeHtml(task.taskId)}</strong>
        <p class="hint">状态：${escapeHtml(task.status || "submitted")}；进度：${task.progress ?? "-"}；费用：${task.cost ?? task.creditsCost ?? "-"}</p>
      </div>
      <button class="small-blue ozon-image2-poll" type="button" data-image2-task-id="${escapeHtml(task.taskId)}">查询状态</button>
    </div>
    ${images.length ? `<div class="ozon-image2-gallery">${images.map((url) => `
      <a href="${escapeHtml(url)}" target="_blank"><img src="${escapeHtml(url)}" alt="GPT Image 2 generated product" /></a>
    `).join("")}</div>` : "<p class=\"hint\">APIMart 异步生成中，稍后点击“查询状态”。</p>"}
  `;
}

async function submitFirstImage2Prompt() {
  const button = $("#ozonImage2SubmitFirstPrompt");
  const prompt = firstImage2Prompt();
  if (!prompt) {
    toast("还没有 image2 prompt，请先生成单品指导卡。", "error");
    return;
  }
  if (!window.confirm("这会调用 APIMart GPT Image 2 并产生费用，确认生成 1 张测试图吗？")) return;
  setBusy(button, true);
  try {
    const data = await api("/api/image-generation/gpt-image-2", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        size: $("#ozonImage2Size")?.value || "1:1",
        resolution: $("#ozonImage2Resolution")?.value || "1k",
        n: 1,
      }),
    });
    state.ozonImage2Task = data || null;
    renderImage2TaskResult();
    showResponse(data);
    toast(`GPT Image 2 任务已提交：${data.taskId || "-"}`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function pollImage2Task(taskId) {
  const id = String(taskId || state.ozonImage2Task?.taskId || "").trim();
  if (!id) return;
  try {
    const data = await api(`/api/image-generation/tasks/${encodeURIComponent(id)}`);
    state.ozonImage2Task = data || null;
    renderImage2TaskResult();
    showResponse(data);
    toast(`GPT Image 2 状态：${data.status || "-"}`);
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderOzonLearningTaskRows() {
  const tbody = $("#ozonLearningTaskRows");
  if (!tbody) return;
  const samplesByTask = (state.ozonLearningItems || []).reduce((acc, item) => {
    acc[item.taskId] = (acc[item.taskId] || 0) + 1;
    return acc;
  }, {});
  tbody.innerHTML = state.ozonLearningTasks.length
    ? state.ozonLearningTasks.map((task) => `
      <tr data-ozon-learning-task-id="${escapeHtml(task.id)}">
        <td><code>${escapeHtml(task.id)}</code></td>
        <td>
          <strong>${escapeHtml(task.sourceValue || "-")}</strong>
          <div class="status-sub"><a href="${escapeHtml(task.sourceUrl || "#")}" target="_blank">${escapeHtml(task.sourceType || "keyword")}</a></div>
        </td>
        <td>${escapeHtml(task.status || "-")}${task.lastError ? `<div class="field-alert">${escapeHtml(task.lastError)}</div>` : ""}</td>
        <td>${samplesByTask[task.id] ?? task.totalFound ?? 0}</td>
        <td>${escapeHtml(task.detailQueued ?? 0)}</td>
        <td>${escapeHtml(formatDateTime(task.updatedAt || task.createdAt))}</td>
        <td>
          <button class="small-blue ozon-learning-view" type="button">查看</button>
          <button class="small-red ozon-learning-delete" type="button">删除</button>
        </td>
      </tr>
    `).join("")
    : "<tr><td colspan=\"7\" class=\"product-empty\">暂无 Ozon 学习任务</td></tr>";
  document.querySelectorAll("#ozonLearningTaskRows tr[data-ozon-learning-task-id]").forEach((row) => {
    const id = row.dataset.ozonLearningTaskId;
    row.querySelector(".ozon-learning-view")?.addEventListener("click", async () => {
      state.selectedOzonLearningTaskId = id;
      await loadOzonLearningItems();
      toast(`已切换到 Ozon 任务 ${id}`);
    });
    row.querySelector(".ozon-learning-delete")?.addEventListener("click", () => deleteOzonLearningTask(id));
  });
}

function renderOzonLearningItemRows() {
  const tbody = $("#ozonLearningItemRows");
  if (!tbody) return;
  tbody.innerHTML = state.ozonLearningItems.length
    ? state.ozonLearningItems.map((item) => `
      <tr>
        <td>
          <div class="learning-product-cell">
            ${item.image ? `<img src="${escapeHtml(item.image)}" alt="" class="product-photo" />` : "<span class=\"photo-placeholder\">无图</span>"}
            <div>
              <strong>${escapeHtml(item.title || "未命名商品")}</strong>
              <div class="status-sub"><a href="${escapeHtml(item.url || "#")}" target="_blank">${escapeHtml(item.url || "-")}</a></div>
              <div class="status-sub">位置：${escapeHtml(item.position || "-")} / SKU：${escapeHtml(item.sku || "-")}</div>
            </div>
          </div>
        </td>
        <td>
          <strong>${escapeHtml(item.price || "-")} ₽</strong>
          ${item.oldPrice ? `<div class="status-sub">原价 ${escapeHtml(item.oldPrice)} ₽</div>` : ""}
          ${item.discount ? `<div class="status-sub">${escapeHtml(item.discount)}</div>` : ""}
        </td>
        <td>${escapeHtml(item.rating || "-")}<div class="status-sub">${escapeHtml(item.reviewCount || 0)} 评论</div></td>
        <td>
          <div>${escapeHtml(item.category || "-")}</div>
          <div class="status-sub">${(item.badges || []).map(escapeHtml).join(" / ")}</div>
        </td>
        <td>${item.detail ? "已采详情" : "搜索页样本"}</td>
      </tr>
    `).join("")
    : "<tr><td colspan=\"5\" class=\"product-empty\">暂无样本数据</td></tr>";
}

function renderOzonOpportunityRows() {
  const tbody = $("#ozonOpportunityRows");
  if (!tbody) return;
  tbody.innerHTML = state.ozonOpportunities.length
    ? state.ozonOpportunities.map((item) => `
      <tr>
        <td>
          <div class="learning-product-cell">
            ${item.image ? `<img src="${escapeHtml(item.image)}" alt="" class="product-photo" />` : "<span class=\"photo-placeholder\">无图</span>"}
            <div>
              <strong>${escapeHtml(item.title || "未命名商品")}</strong>
              <div class="status-sub"><a href="${escapeHtml(item.url || "#")}" target="_blank">${escapeHtml(item.url || "-")}</a></div>
              <div class="status-sub">关键词：${escapeHtml(item.keyword || "-")} / 位置：${escapeHtml(item.position || "-")}</div>
            </div>
          </div>
        </td>
        <td><strong>${escapeHtml(item.opportunityScore || 0)}</strong></td>
        <td>
          <strong>${escapeHtml(item.price || "-")} ₽</strong>
          <div class="status-sub">评分 ${escapeHtml(item.rating || "-")} / ${escapeHtml(item.reviewCount || 0)} 评论</div>
        </td>
        <td>${(item.opportunityReasons || []).map((reason) => `<span class="opportunity-chip">${escapeHtml(reason)}</span>`).join("")}</td>
        <td>
          <button class="small-blue ozon-reverse-1688" type="button" data-item-id="${escapeHtml(item.id)}">反查1688</button>
          <div class="status-sub" id="reverseStatus-${escapeHtml(item.id)}">点击查找 1688 货源</div>
        </td>
      </tr>
    `).join("")
    : "<tr><td colspan=\"5\" class=\"product-empty\">暂无机会数据</td></tr>";
}

async function createOzonLearningTask() {
  const button = $("#ozonLearningStart");
  setBusy(button, true);
  try {
    const payload = {
      sourceType: $("#ozonLearningSourceType").value,
      sourceValue: $("#ozonLearningSourceValue").value.trim(),
      maxProducts: Number($("#ozonLearningMaxProducts").value || 30),
      detailSampleSize: Number($("#ozonLearningDetailSampleSize").value || 8),
    };
    if (!payload.sourceValue) throw new Error("请输入 Ozon 关键词或搜索页链接");
    const data = await api("/api/ozon-learning/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.selectedOzonLearningTaskId = data.task?.id || "";
    await loadOzonLearningTasks();
    await loadOzonLearningItems();
    showResponse(data);
    toast("Ozon 竞品采样任务已创建");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function createOzonBlindRun() {
  const button = $("#ozonBlindStart");
  setBusy(button, true);
  try {
    const payload = {
      batchSize: Number($("#ozonBlindBatchSize").value || 6),
      maxProducts: Number($("#ozonBlindMaxProducts").value || 24),
      detailSampleSize: Number($("#ozonBlindDetailSampleSize").value || 4),
      seeds: $("#ozonBlindSeeds").value.trim(),
    };
    const data = await api("/api/ozon-learning/blind-run", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.selectedOzonLearningTaskId = data.tasks?.[0]?.id || state.selectedOzonLearningTaskId;
    await loadOzonLearningTasks();
    await loadOzonLearningItems();
    await loadOzonOpportunities();
  await loadAutoListJobs();
    showResponse(data);
    toast(`已创建 ${data.tasks?.length || 0} 个盲搜任务`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function deleteOzonLearningTask(id) {
  try {
    await api(`/api/ozon-learning/tasks/${id}`, { method: "DELETE" });
    if (state.selectedOzonLearningTaskId === id) state.selectedOzonLearningTaskId = "";
    await loadOzonLearningTasks();
    await loadOzonLearningItems();
    toast("Ozon 学习任务已删除");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function updateCrawlerTaskStatus(id, action) {
  try {
    await api(`/api/1688-crawler/tasks/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
    await loadCrawlerTasks();
    toast(`任务 ${id} 已${action === "pause" ? "暂停" : action === "resume" ? "继续" : "停止"}`);
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteCrawlerTask(id) {
  if (!window.confirm(`确定删除任务 ${id}？关联作业和候选也会一起删除。`)) return;
  try {
    await api(`/api/1688-crawler/tasks/${id}`, { method: "DELETE", body: JSON.stringify({}) });
    if (state.selectedCrawlerTaskId === id) state.selectedCrawlerTaskId = "";
    await loadCrawlerTasks();
    await loadCrawlerCandidates();
    toast(`任务 ${id} 已删除`);
  } catch (error) {
    toast(error.message, "error");
  }
}

// Keep the collection box seller-facing: a raw capture status is not enough
// to tell an operator what blocks this item or what the next click does.
// This pure view model is also easy to exercise with offline fixtures.
function captureSellerTaskView(item = {}, { sourceEvidenceStatus = "unknown", evidenceIssues = [] } = {}) {
  const lastError = String(item.lastError || "").trim();
  if (String(item.status || "") === "error" || lastError) {
    return { state: "error", label: "采集失败", blocker: lastError || "上一次采集没有形成可用商品数据。", nextAction: "先清理本地失败标记，再打开商品重试；不会跳过来源确认。", actionLabel: "清理错误并重试" };
  }
  if (sourceEvidenceStatus === "waiting_human") {
    return { state: "waiting_human", label: "等待人工验证", blocker: "1688 页面需要人工完成登录或人机验证。", nextAction: "回到 1688 页面完成验证，然后重新采集。", actionLabel: "继续验证" };
  }
  const draft = item.draft || {};
  // A saved single-SKU draft can legitimately have an empty `variants` array;
  // use the persisted draft identity/category markers instead of requiring a
  // multi-SKU row to exist, otherwise the capture box tells the seller to
  // generate the same draft again.
  if (draft.parentSku || draft.payloadDraftHash || draft.categoryId || draft.typeId) {
    return {
      state: evidenceIssues.length ? "draft_blocked" : "draft_ready",
      label: evidenceIssues.length ? "草稿待补资料" : "草稿已保存，待预检",
      blocker: evidenceIssues.length ? evidenceIssues[0] : "尚未运行当前草稿的提交前预检。",
      nextAction: evidenceIssues.length ? "打开草稿补齐阻塞项，再重新预检。" : "打开上架草稿，运行预检并查看修复项。",
      actionLabel: evidenceIssues.length ? "补齐草稿" : "打开草稿",
    };
  }
  return {
    state: evidenceIssues.length ? "capture_blocked" : "captured",
    label: evidenceIssues.length ? "采集完成，待补资料" : "已采集，待生成草稿",
    blocker: evidenceIssues.length ? evidenceIssues[0] : "还没有把来源商品转换成本地上架草稿。",
    nextAction: evidenceIssues.length ? "打开采集记录补齐来源、采购或媒体证据。" : "打开采集记录，确认来源后生成上架草稿。",
    actionLabel: evidenceIssues.length ? "补齐采集" : "生成草稿",
  };
}

function renderCaptureBox() {
  const tbody = $("#captureBoxTable");
  if (!tbody) return;
  tbody.innerHTML = state.captureRows.length
    ? state.captureRows.map((item) => {
        const product = item.parsed || {};
        const store = state.stores.find((row) => row.id === item.storeId);
        const sizeWeight = productSizeWeightStatus(product);
        const warningBadge = sizeWeight.ok && !sizeWeight.warnOnly
          ? ""
          : `<span class="warn-badge" title="${escapeHtml(sizeWeight.message)}">${sizeWeight.warnOnly ? "SKU尺重回填" : "尺重不全"}</span>`;
        const sourceEvidenceRecord = product.sourceEvidenceRecord || {};
        const captureIdentity = sourceEvidenceRecord.captureIdentity || product.capture || {};
        const captureTaskId = String(captureIdentity.taskId || product.capture?.taskId || item.taskId || "").trim();
        const captureSnapshotHash = String(sourceEvidenceRecord.snapshot?.hash || product.sourceEvidence?.snapshotHash || "").trim();
        const captureHashShort = /^sha256:[a-f0-9]{64}$/i.test(captureSnapshotHash)
          ? `${captureSnapshotHash.slice(0, 15)}…${captureSnapshotHash.slice(-8)}`
          : "未记录";
        const captureIdentityText = [
          captureIdentity.taskId ? `任务 ${captureIdentity.taskId}` : "任务未绑定",
          captureIdentity.offerId ? `Offer ${captureIdentity.offerId}` : "Offer 未解析",
          `快照 ${captureHashShort}`,
        ].join(" · ");
        const sourceEvidenceSeller = product.sourceEvidence?.sellerFacing || sourceEvidenceRecord.sellerFacing || {};
        const domainCoverage = sourceEvidenceRecord.domainCoverage && typeof sourceEvidenceRecord.domainCoverage === "object"
          ? sourceEvidenceRecord.domainCoverage : {};
        const domainLabels = { sku: "SKU", procurement: "采购", media: "媒体" };
        const domainText = ["sku", "procurement", "media"].map((key) => {
          const status = String(domainCoverage[key]?.status || "needs_review");
          return `${domainLabels[key]}${status === "captured" ? "已记录" : "待补齐"}`;
        }).join(" · ");
        const missingDomains = Array.isArray(sourceEvidenceRecord.missingDomains)
          ? sourceEvidenceRecord.missingDomains : [];
        const sourceEvidenceStatus = ["ready", "needs_review", "waiting_human", "unknown"].includes(String(sourceEvidenceSeller.status || ""))
          ? String(sourceEvidenceSeller.status)
          : product.sourceEvidence?.snapshotHash ? "needs_review" : "unknown";
        const captureReview = product.captureReview || item.captureReview || {};
        const captureReviewApproved = captureReview.humanConfirmed === true
          && String(captureReview.reviewedSnapshotHash || "").trim() === captureSnapshotHash
          && /^sha256:[a-f0-9]{64}$/i.test(captureSnapshotHash);
        const captureReviewNeeded = !captureReviewApproved && /^sha256:[a-f0-9]{64}$/i.test(captureSnapshotHash);
        const sourceEvidenceNextAction = String(sourceEvidenceSeller.nextAction || "重新打开来源商品详情页并采集有效页面快照");
        const sourceEvidenceBlocker = String(sourceEvidenceSeller.blocker || (sourceEvidenceStatus === "ready" ? "" : "来源证据待补齐"));
        const evidenceIssues = [
          sourceEvidenceStatus === "ready" ? "" : (!product.sourceEvidence?.snapshotHash && sourceEvidenceStatus === "unknown"
            ? `来源快照缺失：${sourceEvidenceBlocker || "来源证据待补齐"}`
            : (sourceEvidenceBlocker || "来源证据待补齐")),
          captureReviewNeeded ? "当前 1688 快照尚未由卖家确认" : "",
          (product.procurementEvidence?.supplierId?.value || product.procurementEvidence?.supplierName?.value)
            && product.procurementEvidence?.moq?.value
            && product.procurementEvidence?.priceTiers?.values?.length ? "" : "供应商/MOQ/采购阶梯价待核",
          Array.isArray(product.mediaAssets) && product.mediaAssets.length && product.mediaAssets.some((asset) => asset?.checks?.humanApproved !== true) ? "媒体待人工" : "",
        ].filter(Boolean);
        const evidenceBadge = evidenceIssues.length
          ? `<span class="warn-badge capture-evidence-badge" title="${escapeHtml([sourceEvidenceBlocker, sourceEvidenceNextAction, ...evidenceIssues].filter(Boolean).join("；"))}">${sourceEvidenceStatus === "waiting_human" ? "需人工处理" : "证据待补齐"} ${evidenceIssues.length}</span>`
          : `<span class="ok-badge capture-evidence-badge" title="${escapeHtml(sourceEvidenceNextAction)}">来源证据完整</span>`;
        const draftStatus = captureDraftVariantStatuses(item);
        const sellerTask = captureSellerTaskView(item, { sourceEvidenceStatus, evidenceIssues });
        const sourceVariants = Array.isArray(product.skuVariants) ? product.skuVariants : [];
        const uniqueSkuIds = new Set(sourceVariants
          .map((variant) => String(variant?.sourceSkuId || variant?.source_sku_id || variant?.skuId || variant?.sku_id || "").trim())
          .filter(Boolean));
        const uniqueSkuCount = uniqueSkuIds.size || sourceVariants.length;
        const isCurrentProduct = String(item.id || "") === String(state.currentCaptureId || "");
        return `
          <tr class="${isCurrentProduct ? "capture-current-product" : "capture-other-product"}" data-id="${item.id}" data-store-id="${escapeHtml(item.storeId || "")}">
            <td><input class="capture-check" type="checkbox" /></td>
            <td>${formatDateTime(item.updatedAt || item.receivedAt)}</td>
            <td>
              <select class="capture-store">
                ${state.stores.map((row) => `<option value="${row.id}" ${row.id === item.storeId ? "selected" : ""}>${escapeHtml(row.name)}</option>`).join("")}
              </select>
            </td>
            <td>
              ${isCurrentProduct ? `<span class="capture-current-label">当前要处理的商品</span>` : ""}
              <strong>${escapeHtml(product.title || "未命名商品")}</strong>
              <div class="status-sub capture-source-url" title="${escapeHtml(product.url || "")}">${escapeHtml(product.url || "")}</div>
              ${warningBadge}
              ${evidenceBadge}
              <div class="status-sub capture-source-evidence" data-source-evidence-status="${escapeHtml(sourceEvidenceStatus)}">下一步：${escapeHtml(sourceEvidenceNextAction)}</div>
              <div class="status-sub capture-evidence-side-effect">影响：证据未验证前不会创建或提交 Ozon；补证动作只更新本地候选。</div>
              <div class="status-sub capture-source-domain-coverage" data-missing-domains="${escapeHtml(missingDomains.join(","))}">证据覆盖：${escapeHtml(domainText)}</div>
              <div class="status-sub capture-identity-summary" data-capture-task-id="${escapeHtml(captureIdentity.taskId || "")}" data-capture-offer-id="${escapeHtml(captureIdentity.offerId || "")}">回传身份：${escapeHtml(captureIdentityText)}</div>
            </td>
            <td title="${sourceVariants.length !== uniqueSkuCount ? `采集 ${sourceVariants.length} 行，去重后 ${uniqueSkuCount} 个` : `${uniqueSkuCount} 个唯一 SKU`}">${uniqueSkuCount}</td>
            <td>${product.video?.url ? "有" : "无"}</td>
            <td>
              <div class="capture-seller-task" data-capture-task-state="${escapeHtml(sellerTask.state)}">
                <span class="status-pill ${sellerTask.state === "captured" || sellerTask.state === "draft_ready" ? "success" : sellerTask.state === "waiting_human" ? "warning" : "blocked"}">${escapeHtml(sellerTask.label)}</span>
                <div class="status-sub"><b>卡点：</b>${escapeHtml(sellerTask.blocker)}</div>
                <div class="status-sub"><b>下一步：</b>${escapeHtml(sellerTask.nextAction)}</div>
              </div>
              ${draftStatus ? `<div class="status-sub">${escapeHtml(draftStatus)}</div>` : ""}
            </td>
            <td class="row-actions">
              ${isCurrentProduct && captureReviewNeeded ? `<span class="capture-current-action-guide">现在只做这一步</span>` : ""}
              <button class="small-blue edit-capture" type="button">${escapeHtml(sellerTask.actionLabel)}</button>
              ${sellerTask.state === "waiting_human" && captureTaskId ? `<button class="small-blue resume-capture-human" type="button" data-task-id="${escapeHtml(captureTaskId)}">打开采集任务</button>` : ""}
              ${captureReviewNeeded ? `<button class="small-blue review-capture" type="button">确认当前快照</button>` : ""}
              <button class="small-blue preflight-capture" type="button">运行本地预检</button>
              <button class="ghost promote-capture-candidate" type="button">${evidenceIssues.length ? "转候选池（需审核）" : "转候选池"}</button>
              <button class="ghost delete-capture" type="button">删除</button>
            </td>
          </tr>
        `;
      }).join("")
    : "<tr><td colspan=\"8\" class=\"product-empty\">采集箱为空。去 1688 页面用常驻按钮采集，或在这里手动采集。</td></tr>";
  bindCaptureBoxRows();
}

function selectedCaptureSelections() {
  return [...document.querySelectorAll("#captureBoxTable tr[data-id]")]
    .filter((row) => row.querySelector(".capture-check")?.checked)
    .map((row) => ({
      id: row.dataset.id,
      storeId: row.querySelector(".capture-store")?.value || "",
    }));
}

async function switchStoreContext(storeId, { loadWarehouses = true } = {}) {
  if (!storeId) throw new Error("采集记录没有归属店铺，请先在采集箱选择店铺");
  if (!state.stores.some((store) => store.id === storeId)) {
    throw new Error(`找不到采集记录归属店铺：${storeId}`);
  }
  if ($("#storeSelect").value !== storeId) {
    $("#storeSelect").value = storeId;
    $("#storeSelect").dispatchEvent(new Event("change"));
  }
  if (loadWarehouses) await loadListingWarehouses();
}

function captureDraftVariantStatuses(item = {}) {
  const variants = item.draft?.variants || [];
  if (!variants.length) return "";
  const counts = variants.reduce((acc, row) => {
    const key = row.status || "unlisted";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const labels = {
    success: "成功",
    error: "错误",
    submitted: "已提交",
    unclaimed: "未认领",
    edited: "已编辑",
    unlisted: "未上架",
  };
  return Object.entries(counts)
    .map(([key, count]) => `${labels[key] || key}${count}`)
    .join(" / ");
}

function setAllCapturesChecked(checked) {
  document.querySelectorAll(".capture-check").forEach((checkbox) => {
    checkbox.checked = checked;
  });
}

function bindCaptureBoxRows() {
  document.querySelectorAll("#captureBoxTable tr[data-id]").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".capture-store")?.addEventListener("change", async (event) => {
      await api(`/api/1688/captures/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ storeId: event.target.value }),
      });
      const item = state.captureRows.find((entry) => entry.id === id);
      if (item) item.storeId = event.target.value;
      toast("采集箱店铺已更新");
    });
    row.querySelector(".edit-capture")?.addEventListener("click", () => {
      const action = row.querySelector(".edit-capture");
      const storeId = row.querySelector(".capture-store")?.value || "";
      if (String(action?.textContent || "").includes("清理错误")) retryCaptureAfterError(id, storeId, action);
      else if (String(action?.textContent || "").includes("生成草稿")) createDraftFromCapture(id, storeId, action);
      else editCaptureItem(id, storeId);
    });
    row.querySelector(".resume-capture-human")?.addEventListener("click", () => openCaptureHumanTask(row.querySelector(".resume-capture-human")?.dataset.taskId || ""));
    row.querySelector(".review-capture")?.addEventListener("click", () => reviewCaptureSnapshot(id, row.querySelector(".capture-store")?.value || "", row.querySelector(".review-capture")));
    row.querySelector(".preflight-capture")?.addEventListener("click", () => runCapturePreflight(id, row.querySelector(".capture-store")?.value || ""));
    row.querySelector(".promote-capture-candidate")?.addEventListener("click", () => promoteCaptureToCandidate(id));
    row.querySelector(".delete-capture")?.addEventListener("click", () => deleteCaptureItem(id));
  });
}

// Batch draft/preflight failures are persisted on the capture so the seller
// can see what happened.  They must not become a sticky dead end: this action
// only clears the local retry marker and reloads the capture; it does not
// approve a snapshot, create a draft, or call Ozon.
async function retryCaptureAfterError(id, storeId = "", button = null) {
  setBusy(button, true);
  try {
    await api(`/api/1688/captures/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ storeId, status: "captured", lastError: "" }),
    });
    await loadCaptureBox();
    toast("已清理本地失败标记；请打开采集记录并按当前证据重新尝试，不会提交 Ozon", "ok");
  } catch (error) {
    toast(error.message || "清理采集失败标记失败", "error");
  } finally {
    setBusy(button, false);
  }
}

// A waiting-human capture must return the operator to the crawler task that
// owns the login/CAPTCHA gate.  Opening the local capture editor alone cannot
// complete that gate and used to leave the seller with a dead-end action.
async function openCaptureHumanTask(taskId = "") {
  const id = String(taskId || "").trim();
  if (!id) {
    toast("当前采集没有绑定任务，无法定位人机验证；请重新打开 1688 页面采集", "warning");
    return false;
  }
  state.selectedCrawlerTaskId = id;
  document.querySelector('.tab[data-view="crawler1688"]')?.click();
  try {
    if (!state.crawlerTasks.some((task) => String(task.id || "") === id)) await loadCrawlerTasks();
    await loadCrawlerCandidates();
  } catch (error) {
    toast(error.message || "采集任务读取失败，请刷新后重试", "error");
    return false;
  }
  const row = document.querySelector(`#crawlerTaskRows tr[data-task-id="${CSS.escape(id)}"]`);
  row?.scrollIntoView({ behavior: "smooth", block: "center" });
  row?.classList.add("capture-deep-link-focus");
  window.setTimeout(() => row?.classList.remove("capture-deep-link-focus"), 2200);
  toast("已定位采集任务；请点击“继续”完成 1688 登录或人机验证", "ok");
  return true;
}

async function reviewCaptureSnapshot(id, storeId = "", button = null) {
  const item = state.captureRows.find((entry) => String(entry.id || "") === String(id || ""));
  const hash = captureSnapshotHash(item);
  if (!/^sha256:[a-f0-9]{64}$/i.test(hash)) {
    toast("当前采集缺少可核对的来源记录，请重新采集商品", "error");
    return;
  }
  if (!window.confirm("确认标题、规格和图片属于你刚刚采集的商品？确认后系统会建立本地草稿；不会提交到 Ozon，也不会调用付费 AI。")) return;
  setBusy(button, true);
  try {
    const reviewResult = await api(`/api/1688/captures/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ storeId }),
    });
    const itemIndex = state.captureRows.findIndex((entry) => String(entry.id || "") === String(id || ""));
    if (itemIndex >= 0 && reviewResult.item) state.captureRows[itemIndex] = reviewResult.item;
    await openCaptureDraftSkeleton(id, storeId);
    toast("已确认当前快照并创建本地草稿骨架；未提交 Ozon", "ok");
  } catch (error) {
    toast(error.message || "来源快照确认或本地草稿创建失败", "error");
  } finally {
    setBusy(button, false);
  }
}

async function reviewCurrentProductFromWorkspace(id, storeId = "", button = null) {
  const item = state.captureRows.find((entry) => String(entry.id || "") === String(id || ""));
  storeId = String(storeId || item?.storeId || "").trim();
  await switchStoreContext(storeId, { loadWarehouses: false });
  state.currentCaptureId = String(id || "");
  return reviewCaptureSnapshot(id, storeId, button);
}

async function openCurrentProductDraftFromWorkspace(id, storeId = "") {
  const item = state.captureRows.find((entry) => String(entry.id || "") === String(id || ""));
  storeId = String(storeId || item?.storeId || "").trim();
  await switchStoreContext(storeId, { loadWarehouses: false });
  state.currentCaptureId = String(id || "");
  return openCaptureDraftSkeleton(id, storeId);
}

async function openCurrentProductWorkflowFromWorkspace(runId, storeId = "") {
  await switchStoreContext(String(storeId || "").trim(), { loadWarehouses: false });
  state.selectedWorkflowRunId = String(runId || "").trim();
  state.selectedWorkflowNodeKey = "";
  activateErpView("listing");
  renderListingSellerTaskSummary();
}

async function openCaptureDraftSkeleton(id, storeId = "") {
  const data = await api(`/api/1688/captures/${encodeURIComponent(id)}/workflow`, {
    method: "POST",
    body: JSON.stringify({ storeId }),
  });
  const draftSkeleton = data.draftSkeleton || {};
  const workflowRunId = String(data.workflowRunId || data.job?.workflowRunId || "").trim();
  if (!workflowRunId) throw new Error("本地草稿骨架已创建，但没有绑定商品工作流；请重试当前交接");
  state.selectedWorkflowRunId = workflowRunId;
  state.selectedWorkflowNodeKey = "capture_handoff";
  state.currentCaptureId = id;
  const capture = state.captureRows.find((entry) => String(entry.id || "") === String(id || ""));
  if (capture?.parsed) state.collected1688 = capture.parsed;
  const blockerCount = Array.isArray(draftSkeleton.blockers) ? draftSkeleton.blockers.length : 0;
  state.listingHandoffNotice = blockerCount
    ? `本地草稿已建立：保留 ${draftSkeleton.variantCount || 0} 个唯一 SKU，集中列出 ${blockerCount} 项待补资料；未提交 Ozon。`
    : `本地草稿已建立：保留 ${draftSkeleton.variantCount || 0} 个唯一 SKU；下一步运行提交前预检。`;
  showResponse(data);
  await loadWorkflowRuns();
  await loadAutoListJobs();
  await loadCaptureBox();
  activateErpView("listing");
  renderListingSellerTaskSummary();
  return data;
}

async function createDraftFromCapture(id, storeId = "", button = null) {
  setBusy(button, true);
  try {
    await editCaptureItem(id, storeId);
    const item = state.captureRows.find((entry) => entry.id === id) || { id, parsed: state.collected1688 };
    const snapshotHash = String(item.parsed?.sourceEvidence?.snapshotHash || "").trim();
    const review = item.parsed?.captureReview || item.captureReview || {};
    if (!(/^sha256:[a-f0-9]{64}$/i.test(snapshotHash)
      && review.humanConfirmed === true
      && String(review.reviewedSnapshotHash || "").trim() === snapshotHash)) {
      throw new Error("请先在采集箱点击“确认当前快照”，确认同一份 1688 来源后再生成草稿");
    }
    assertListingBoundToCapture(item);
    const saved = await saveListingDraft("draft", { createdFromCaptureAction: true });
    if (!saved) throw new Error("本地草稿未保存");
    state.listingHandoffNotice = "已保存本地上架草稿；下一步补齐证据并运行预检，未提交 Ozon。";
    // Keep the seller on the explicit golden-path destination even if the
    // field-population helper changes its own navigation behavior later.
    // Saving a draft is the hand-off boundary: the next screen must be the
    // listing workbench with the freshly bound task summary visible.
    activateErpView("listing");
    renderListingSellerTaskSummary();
    toast("本地上架草稿已保存；尚未提交 Ozon");
  } catch (error) {
    toast(error.message || "本地草稿生成失败", "error");
  } finally {
    setBusy(button, false);
  }
}

async function runCapturePreflight(id, storeId = "") {
  const row = document.querySelector(`#captureBoxTable tr[data-id="${CSS.escape(id)}"]`);
  const button = row?.querySelector(".preflight-capture");
  setBusy(button, true);
  try {
    const data = await api(`/api/1688/captures/${encodeURIComponent(id)}/preflight`, {
      method: "POST",
      body: JSON.stringify({ storeId }),
    });
    if (data.workflowRunId) {
      state.selectedWorkflowRunId = data.workflowRunId;
      state.selectedWorkflowNodeKey = "preflight_check";
      await loadWorkflowRuns();
    }
    showResponse(data);
    const task = data.sellerTask || {};
    if (row && !data.ok) {
      const taskBox = row.querySelector(".capture-seller-task");
      if (taskBox) {
        taskBox.dataset.captureTaskState = "blocked";
        taskBox.innerHTML = `<span class="status-pill blocked">预检阻塞</span><div class="status-sub"><b>卡点：</b>${escapeHtml(task.title || task.reasonCode || "本地 Payload 尚未通过")}</div><div class="status-sub"><b>下一步：</b>${escapeHtml(task.nextAction || data.nextAction || "打开商品草稿补齐资料后重试")}</div>`;
      }
      if (button) button.dataset.label = "重新预检";
      toast(`本地预检已完成：${task.title || "还有阻塞项"}；请按当前行下一步处理`, "error");
    } else {
      document.querySelector('[data-view="listing"]')?.click();
      toast("本地预检通过；提交前仍需人工确认", "ok");
    }
    return data;
  } catch (error) {
    toast(error.message || "本地预检失败", "error");
  } finally {
    setBusy(button, false);
  }
}

async function promoteCaptureToCandidate(id) {
  try {
    const data = await api(`/api/1688/captures/${id}/to-candidate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadCaptureBox();
    await loadCrawlerCandidates();
    const candidate = data.candidate || {};
    toast(data.duplicate ? `候选池已有：${candidate.id || ""}` : `已转入候选池：${candidate.id || ""}`);
  } catch (error) {
    toast(error.message || "转入候选池失败", "error");
  }
}

function sizeWeightFields() {
  return [
    { key: "weightG", label: "重量" },
    { key: "lengthMm", label: "长" },
    { key: "widthMm", label: "宽" },
    { key: "heightMm", label: "高" },
  ];
}

function missingSizeWeightFields(source = {}) {
  return sizeWeightFields()
    .filter((field) => !Number(source[field.key] || 0))
    .map((field) => field.label);
}

function productSizeWeightStatus(product = {}) {
  const productMissing = missingSizeWeightFields(product.sizeWeight || {});
  const skuVariants = product.skuVariants || [];
  const skuMissing = skuVariants
    .map((sku, index) => ({ index: index + 1, missing: missingSizeWeightFields(sku) }))
    .filter((item) => item.missing.length);
  const noProductFallback = productMissing.length === sizeWeightFields().length;
  const blockingSku = skuMissing.filter((item) => noProductFallback || item.missing.length === sizeWeightFields().length);
  if (!productMissing.length && !skuMissing.length) return { ok: true, message: "尺重完整" };
  const parts = [];
  if (productMissing.length) parts.push(`商品级缺少：${productMissing.join("、")}`);
  if (skuMissing.length) {
    const preview = skuMissing.slice(0, 4).map((item) => `SKU${item.index}缺少${item.missing.join("、")}`).join("；");
    parts.push(`${preview}${skuMissing.length > 4 ? "；更多 SKU 也缺少尺重" : ""}`);
  }
  return {
    ok: !blockingSku.length,
    warnOnly: Boolean(blockingSku.length === 0),
    message: parts.join("；"),
  };
}

function skuSizeWeightStatus(sku = {}, product = {}) {
  const ownMissing = missingSizeWeightFields(sku);
  if (!ownMissing.length) return { ok: true, message: "SKU 尺重完整", fallback: false };
  const fallbackMissing = missingSizeWeightFields(product.sizeWeight || {});
  if (!fallbackMissing.length) {
    return { ok: true, fallback: true, message: `SKU 缺少${ownMissing.join("、")}，当前使用商品级尺重回填` };
  }
  return {
    ok: false,
    fallback: false,
    message: `缺少${[...new Set([...ownMissing, ...fallbackMissing])].join("、")}，请手动输入后再上传`,
  };
}

async function editCaptureItem(id, forcedStoreId = "", options = {}) {
  if (forcedStoreId) {
    await api(`/api/1688/captures/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ storeId: forcedStoreId }),
    });
  }
  const item = await api(`/api/1688/captures/${id}`);
  if (forcedStoreId) item.storeId = forcedStoreId;
  state.currentCaptureId = item.id;
  state.currentCaptureDraft = item.draft || null;
  state.collected1688 = item.parsed;
  await switchStoreContext(item.storeId);
  render1688Collection(item.parsed);
  await apply1688ToListing(item, options);
  assertListingBoundToCapture(item);
}

async function deleteCaptureItem(id) {
  const isCurrent = state.currentCaptureId === id;
  await api(`/api/1688/captures/${id}`, { method: "DELETE" });
  if (isCurrent) {
    state.currentCaptureId = "";
    state.currentCaptureDraft = null;
  }
  await loadCaptureBox();
  toast("已删除采集箱商品");
}

async function batchGenerateDrafts() {
  const selections = selectedCaptureSelections();
  if (!selections.length) {
    toast("请先勾选采集箱商品", "error");
    return;
  }
  const result = [];
  for (const { id, storeId } of selections) {
    try {
      const savedItem = await api(`/api/1688/captures/${id}`);
      assertCaptureSnapshotReviewed(savedItem);
      await editCaptureItem(id, storeId);
      assertListingBoundToCapture(state.captureRows.find((item) => item.id === id) || { id, parsed: state.collected1688 });
      await saveListingDraft("draft");
      result.push({ id, storeId, ok: true, parentSku: $("#listingParentSku").value });
    } catch (error) {
      result.push({ id, storeId, ok: false, error: error.message });
      if (!String(error.message || "").includes("CAPTURE_HUMAN_REVIEW_REQUIRED")) {
        await api(`/api/1688/captures/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "error", lastError: error.message }),
        });
      }
    }
  }
  await loadCaptureBox();
  showResponse({ batchDraft: result });
  const okCount = result.filter((item) => item.ok).length;
  toast(`批量生成草稿完成：成功 ${okCount} / ${selections.length}`);
}

async function batchPublishCaptures() {
  const selections = selectedCaptureSelections();
  if (!selections.length) {
    toast("请先勾选采集箱商品", "error");
    return;
  }
  const result = [];
  for (const { id, storeId } of selections) {
    try {
      const savedItem = await api(`/api/1688/captures/${id}`);
      assertCaptureSnapshotReviewed(savedItem);
      ensureCaptureReadyForBatchPublish(savedItem);
      await editCaptureItem(id, storeId, { useSavedDraft: true });
      assertListingBoundToCapture(state.captureRows.find((item) => item.id === id) || { id, parsed: state.collected1688 });
      // Batch actions may prepare local drafts, but they must not pretend to
      // submit Ozon or wait for a task id.  Submission is intentionally gated
      // by each workflow's preflight result and an explicit human confirmation.
      const savedDraft = await saveListingDraft("draft", { batchPreparedAt: new Date().toISOString() });
      result.push({
        id,
        storeId,
        ok: true,
        status: "draft_ready",
        workflowRunId: state.selectedWorkflowRunId || "",
        nextAction: "逐个打开工作流运行预检；通过后再人工确认提交",
        draftUpdatedAt: savedDraft?.draft?.updatedAt || savedDraft?.updatedAt || "",
      });
    } catch (error) {
      result.push({ id, storeId, ok: false, error: error.message });
      if (!String(error.message || "").includes("CAPTURE_HUMAN_REVIEW_REQUIRED")) {
        await api(`/api/1688/captures/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "error", lastError: error.message }),
        });
      }
    }
  }
  await loadCaptureBox();
  showResponse({
    batchPublish: result,
    sellerView: {
      title: "批量草稿已准备",
      nextAction: "逐个打开工作流运行预检；通过后再人工确认提交",
      sideEffect: "仅保存本地草稿和工作流绑定；没有调用 Ozon，也没有创建提交任务。",
    },
  });
  const okCount = result.filter((item) => item.ok).length;
  toast(`批量草稿准备完成：成功 ${okCount} / ${selections.length}；请逐个预检并人工确认`, okCount ? "ok" : "error");
}

function assertCaptureSnapshotReviewed(item = {}) {
  const parsed = item.parsed || {};
  const snapshotHash = String(parsed.sourceEvidence?.snapshotHash || "").trim();
  const review = item.captureReview || parsed.captureReview || {};
  if (!(/^sha256:[a-f0-9]{64}$/i.test(snapshotHash)
    && review.humanConfirmed === true
    && String(review.reviewedSnapshotHash || "").trim() === snapshotHash)) {
    throw new Error("CAPTURE_HUMAN_REVIEW_REQUIRED：请逐条确认当前 1688 快照后再批量生成草稿");
  }
  return true;
}

function ensureCaptureReadyForBatchPublish(item = {}) {
  const draft = item.draft || {};
  if (!draft.parentSku || !draft.categoryId || !draft.typeId) {
    throw new Error("请先生成草稿并确认分类，再批量自动上架");
  }
  const variants = draft.variants || [];
  if (!variants.length || variants.some((row) => row.status === "unlisted")) {
    throw new Error("草稿尚未经过当前分类处理，请先进入上架页点击“按当前分类重建草稿”并保存");
  }
}

async function load1688Capture() {
  const button = $("#load1688Capture");
  setBusy(button, true);
  try {
    const data = await api("/api/1688/capture/latest");
    state.collected1688 = data.parsed;
    state.currentCaptureId = data.id || "";
    $("#collect1688Url").value = data.parsed?.url || "";
    render1688Collection(data.parsed);
    showResponse(data);
    toast(`已读取采集助手结果：${data.receivedAt}`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function collectorParseIssueLabel(code = "") {
  const labels = {
    missing_title: "缺少商品标题",
    missing_images: "缺少商品图片",
    missing_sku_variants: "缺少 SKU 变体",
    missing_attributes: "缺少商品属性",
    missing_package_weight: "缺少包装重量",
    missing_package_dimensions: "缺少包装尺寸",
  };
  return labels[code] || code || "未知解析问题";
}

function renderCollectorParseIssues(parseIssues = []) {
  const issues = Array.isArray(parseIssues) ? parseIssues.filter(Boolean) : [];
  if (!issues.length) return "";
  return `
    <div class="collector-parse-issue-title">解析问题</div>
    <div class="collector-parse-issue-list">
      ${issues.map((issue) => `<span class="collector-parse-issue">${escapeHtml(collectorParseIssueLabel(issue))}</span>`).join("")}
    </div>
    <p class="hint">这些问题只用于定位采集缺口，不会自动提交 Ozon。</p>
  `;
}

function render1688Collection(data) {
  $("#collectTitle").textContent = data.title || "-";
  $("#collectSkuCount").textContent = data.skuVariants?.length || 0;
  $("#collectImageCount").textContent = data.images?.length || 0;
  $("#collectAttrCount").textContent = data.attributes?.length || 0;
  $("#collectWarnings").innerHTML = (data.warnings || []).map((warning) => `<p>${escapeHtml(warning)}</p>`).join("");
  $("#collectParseIssues").innerHTML = renderCollectorParseIssues(data.parseIssues);
  $("#collectSkuTable").innerHTML = (data.skuVariants || []).length
    ? data.skuVariants.map((sku) => {
      const status = skuSizeWeightStatus(sku, data);
      return `
        <tr>
          <td>${sku.image ? `<img class="product-photo" src="${sku.image}" alt="${escapeHtml(sku.spec || "")}" />` : "<div class=\"photo-placeholder\">＋</div>"}</td>
          <td>${escapeHtml(sku.skuId || "-")}</td>
          <td>
            ${escapeHtml(sku.spec || "-")}
            ${status.ok && !status.fallback ? "" : `<div class="${status.ok ? "field-note" : "field-alert"}">${escapeHtml(status.message)}</div>`}
          </td>
          <td>${sku.price ?? "-"}</td>
          <td>${sku.stock ?? "-"}</td>
        </tr>
      `;
    }).join("")
    : "<tr><td colspan=\"5\" class=\"product-empty\">没有解析到 SKU 变体。</td></tr>";
  $("#collectAttrTable").innerHTML = (data.attributes || []).length
    ? data.attributes.slice(0, 80).map((attr) => `
        <tr>
          <td>${escapeHtml(attr.name)}</td>
          <td>${escapeHtml(attr.value)}</td>
        </tr>
      `).join("")
    : "<tr><td colspan=\"2\" class=\"product-empty\">没有解析到商品属性。</td></tr>";
  $("#collectWeight").textContent = data.sizeWeight?.weightG || "-";
  $("#collectLength").textContent = data.sizeWeight?.lengthMm || "-";
  $("#collectWidth").textContent = data.sizeWeight?.widthMm || "-";
  $("#collectHeight").textContent = data.sizeWeight?.heightMm || "-";
  const videoUrl = data.video?.url || "";
  $("#collectVideo").textContent = videoUrl ? "打开视频" : "-";
  $("#collectVideo").href = videoUrl || "#";
  $("#collectImageGrid").innerHTML = (data.images || []).length
    ? data.images.slice(0, 30).map((src, index) => `
        <figure>
          <img src="${src}" alt="1688 图片 ${index + 1}" />
          <figcaption>${index === 0 ? "主图" : `图片 ${index + 1}`}</figcaption>
        </figure>
      `).join("")
    : "<p class=\"hint\">没有解析到图片。</p>";
  $("#collectDetailText").value = data.detail?.text || "";
}

async function apply1688ToListing(captureItem = null, options = {}) {
  const data = captureItem?.parsed || state.collected1688;
  if (!data) {
    toast("请先采集 1688 商品", "error");
    return;
  }
  clearListingSourceFields();
  const preGroups = phoneCaseVariantGroups(data);
  const savedParentSkus = captureItem?.draft?.parentSkus || [];
  const savedSkuUsable = captureItem?.draft?.parentSku && (!preGroups.length || savedParentSkus.length === preGroups.length);
  let sequence = savedSkuUsable
    ? { parentSku: captureItem.draft.parentSku, parentSkus: savedParentSkus }
    : null;
  if (!sequence) {
    sequence = preGroups.length
      ? await api("/api/erp/reserve-parent-skus", { method: "POST", body: JSON.stringify({ count: preGroups.length }) })
      : await api("/api/erp/next-parent-sku", { method: "POST", body: "{}" });
  }
  state.reservedParentSkus = sequence.parentSkus || [sequence.parentSku].filter(Boolean);
  state.selectedVariantGroup = Number(captureItem?.draft?.selectedVariantGroup || 0);
  const parentSku = state.reservedParentSkus[0] || sequence.parentSku;
  const draft = data.ozonDraft || {};
  const aiContent = await generateListingContent(data);
  const fallbackTitle = generateRussianOzonTitle(data);
  const russianTitle = isUsableGeneratedTitle(aiContent.title) ? aiContent.title : fallbackTitle;
  const generated = {
    ...buildGeneratedListingContent(data, russianTitle),
    ...aiContent,
  };
  generated.description = buildDetailedOzonDescription(data, russianTitle, generated.description);
  generated.richContent = JSON.stringify(buildOzonRichContent(data, russianTitle, generated.description), null, 2);
  state.generatedListingContent = generated;
  document.querySelector('[data-view="listing"]').click();
  $("#listingParentSku").value = parentSku;
  $("#listingOriginalTitle").value = data.title || "";
  $("#listingTitlePrompt").value = buildRussianTitlePrompt(data);
  $("#listingName").value = state.generatedListingContent.title || draft.name || data.title || "";
  $("#listingNameCount").textContent = $("#listingName").value.length;
  $("#listingKeywords").value = state.generatedListingContent.tags;
  $("#listingImages").value = normalizeImageUrlsForOzon(draft.images || data.images || []).join("\n");
  $("#listingDescription").value = state.generatedListingContent.description;
  $("#listingRichContent").value = state.generatedListingContent.richContent;
  await renderListingVariantsFrom1688(data, parentSku);
  applyCollectedAttributesToListing(data);
  $("#listingVideoUrl").value = data.video?.url || "";
  $("#listingVideoCover").value = data.video?.coverUrl || "";
  $("#sourceUrl").value = data.url || $("#collect1688Url").value.trim();
  $("#listingRemark").value = [
    `1688采集：${data.title || ""}`,
    `合并SKU：${state.reservedParentSkus.length > 1 ? state.reservedParentSkus.join(", ") : parentSku}`,
    `来源：${data.url || ""}`,
    `SKU：${data.skuVariants?.length || 0} 个`,
    `视频：${data.video?.url || "无"}`,
    "图片全局规格：800x800，约 150KB；后续图片变更统一按此规格处理。",
  ].join("\n");
  previewListingImages();
  await autoMatchCategory();
  if (options.useSavedDraft && captureItem?.draft?.categoryId && captureItem?.draft?.typeId) {
    restoreDraftCategory(captureItem.draft);
    await rebuildListingDraftFromCurrentCategory({ preserveText: true, save: false });
  }
  toast("已填入产品上架草稿");
}

function restoreDraftCategory(draft = {}) {
  if (draft.categoryId) $("#listingCategoryId").value = draft.categoryId;
  if (draft.typeId) $("#listingTypeId").value = draft.typeId;
  if (draft.categoryPath) $("#listingCategoryPath").value = draft.categoryPath;
  if (draft.categoryPath) $("#categoryKeyword").value = draft.categoryPath.split(" / ").at(-1) || "";
}

function clearListingSourceFields() {
  [
    "#listingOriginalTitle",
    "#listingTitlePrompt",
    "#listingName",
    "#listingKeywords",
    "#listingImages",
    "#listingDescription",
    "#listingRichContent",
    "#listingVideoUrl",
    "#listingVideoCover",
    "#sourceUrl",
    "#listingRemark",
    "#listingCategoryPath",
    "#listingCategoryId",
    "#listingTypeId",
    "#categoryKeyword",
    "#listingAttributesJson",
    "#listingTaskId",
  ].forEach((selector) => {
    const el = $(selector);
    if (el) el.value = "";
  });
  state.listingAttributes = [];
  state.listingVariantAspects = [];
  state.generatedListingContent = null;
  state.variantGroups = [];
  state.selectedVariantGroup = 0;
  state.reservedParentSkus = [];
  $("#listingNameCount").textContent = "0";
  $("#attributeList").innerHTML = "";
  $("#categoryResults").innerHTML = "";
  $("#categoryResults").classList.remove("open");
  $("#imagePreviewGrid").innerHTML = "<p class=\"hint\">暂无图片 URL。</p>";
  $("#listingVariantRows").innerHTML = `
    <tr>
      <td><input class="variant-row-check" type="checkbox" checked /></td>
      <td class="variant-status-cell" data-status="unlisted"><span class="variant-status-badge neutral">未上架</span></td>
      <td><div class="variant-color-sample"><div class="photo-placeholder">＋</div></div></td>
      <td>
        <button class="variant-image-editor" type="button" title="编辑该 SKU 图片">
          <div class="variant-image-box"><div class="photo-placeholder">＋</div></div>
        </button>
        <textarea class="variant-images-json" hidden>[]</textarea>
      </td>
      <td><input id="listingOfferId" value="" /></td>
      <td><input class="variant-barcode" placeholder="留空自动生成" /></td>
      <td><input id="listingPrice" value="" /></td>
      <td><input class="variant-cost-price" value="" /></td>
      <td><input id="listingOldPrice" value="" /></td>
      <td><input id="listingMinPrice" value="" /></td>
      <td><select id="listingWarehouse" class="variant-warehouse">${state.listingWarehouses.map((warehouse) => `<option value="${warehouse.warehouse_id}">${escapeHtml(warehouse.name)}</option>`).join("")}</select></td>
      <td><input id="listingStock" value="" placeholder="读取真实库存后填写" /></td>
      <td><input id="listingWeight" value="" /></td>
      <td><input id="listingDepth" value="" /></td>
      <td><input id="listingWidth" value="" /></td>
      <td><input id="listingHeight" value="" /></td>
      <td class="variant-aspect-cell"><input id="listingVariantValue" class="variant-value" value="" placeholder="读取分类属性后自动切换" /></td>
      <td><button class="row-delete variant-delete" type="button">移除</button></td>
    </tr>
  `;
  bindVariantRowActions();
}

function assertListingBoundToCapture(captureItem = {}) {
  const data = captureItem.parsed || state.collected1688 || {};
  const pageTitle = $("#listingOriginalTitle")?.value.trim() || "";
  const pageUrl = stripUrlTracking($("#sourceUrl")?.value.trim() || "");
  const expectedTitle = String(data.title || "").trim();
  const expectedUrl = stripUrlTracking(data.url || "");
  if (expectedTitle && pageTitle !== expectedTitle) {
    throw new Error(`上架页面原标题与当前采集品不一致，已停止：${captureItem.id || ""}`);
  }
  if (expectedUrl && pageUrl !== expectedUrl) {
    throw new Error(`上架页面来源 URL 与当前采集品不一致，已停止：${captureItem.id || ""}`);
  }
}

function stripUrlTracking(url = "") {
  try {
    const parsed = new URL(url);
    const offerMatch = parsed.pathname.match(/\/offer\/(\d+)\.html/i) || parsed.search.match(/[?&]offerId=(\d+)/i);
    return offerMatch ? `${parsed.origin}/offer/${offerMatch[1]}.html` : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(url || "").replace(/[?#].*$/, "");
  }
}

async function generateListingContent(data) {
  try {
    const result = await api("/api/ai/listing-content", {
      method: "POST",
      body: JSON.stringify({ product: data }),
    });
    if (!result.enabled || !result.content) return {};
    const content = result.content;
    const title = sanitizeAiTitle(content.title_ru || "", data);
    if (!title) return {};
    return {
      title,
      description: content.description_ru || "",
      tags: content.hashtags_ru || "",
      aiModel: result.model,
      attributesHint: content.attributes_hint || {},
    };
  } catch (error) {
    console.warn("AI listing content fallback:", error.message);
    return {};
  }
}

function sanitizeAiTitle(title, data = {}) {
  const value = String(title || "").trim();
  if (!value) return "";
  if (/^(нет бренда|no brand|без бренда|brand)$/i.test(value)) return "";
  if (value.length < 8) return "";
  if (!isAiTitleRelevant(value, data)) return "";
  return value.slice(0, 200);
}

function isAiTitleRelevant(title, data = {}) {
  const source = `${data.title || ""} ${(data.attributes || []).map((item) => `${item.name}${item.value}`).join(" ")}`.toLowerCase();
  const value = title.toLowerCase();
  const rules = [
    { cn: /头巾|发带|发箍|围巾|披肩|帽子/, ru: /платок|повязк|лента|ободок|бандан|косынк|шарф|головн/ },
    { cn: /单肩包|斜挎包|手提包|女包|包包|小方包/, ru: /сумк|шоппер|клатч|рюкзак/ },
    { cn: /衣架|挂衣架/, ru: /вешалк|плечик/ },
    { cn: /收纳盒|收纳箱|整理箱/, ru: /органайзер|контейнер|короб/ },
    { cn: /手机壳|保护壳/, ru: /чехол|смартфон|телефон/ },
    { cn: /玩具|公仔|毛绒/, ru: /игрушк|плюш|кукл/ },
    { cn: /鞋|拖鞋|凉鞋/, ru: /обув|тапоч|сандал|кроссов/ },
    { cn: /杯|水杯|保温杯/, ru: /кружк|стакан|термос|бутыл/ },
  ];
  const matched = rules.find((rule) => rule.cn.test(source));
  return !matched || matched.ru.test(value);
}

function buildGeneratedListingContent(data, russianTitle) {
  const description = buildDetailedOzonDescription(data, russianTitle);
  return {
    title: russianTitle || generateRussianOzonTitle(data),
    tags: generateStrictRussianHashtags(russianTitle || generateRussianOzonTitle(data)),
    description,
    richContent: JSON.stringify(buildOzonRichContent(data, russianTitle, description), null, 2),
  };
}

function buildRussianTitlePrompt(data) {
  const attrs = (data.attributes || []).slice(0, 12).map((item) => `${item.name}: ${item.value}`).join("\n");
  const sku = (data.skuVariants || []).slice(0, 8).map((item) => cleanSkuSpec(item.spec)).join(", ");
  return [
    "你是 Ozon 俄罗斯电商平台的商品标题优化助手。",
    "任务：根据 1688 中文原标题和属性，提取真实产品名称，生成俄文通用商品标题。",
    "同时生成俄文商品描述和主体标签。",
    "要求：",
    "1. 标题使用俄语，适合 Ozon 商品卡片。",
    "2. 先写产品类型，再写适用人群/性别，再写关键特征、材质、颜色或规格。",
    "3. 删除平台词、年份、新款、爆款、工厂、批发、亚马逊、速卖通、跨境、促销等营销词。",
    "4. 不写夸张词，不写品牌词，除非品牌是用户明确要保留的合法品牌。",
    "5. 标题不超过 200 个字符，避免重复关键词。",
    "6. 主体标签规则：根据产品名称生成俄文搜索词，1-2 个单词一个标签，约 25 个，每个前面带 #，连续输出。",
    "7. 描述使用俄语，简洁说明用途、材质、风格、尺码、适用场景。",
    "",
    `1688原标题：${data.title || ""}`,
    `商品属性：\n${attrs}`,
    `SKU规格：${sku}`,
    "",
    "输出格式：标题 / 描述 / 主体标签。",
  ].join("\n");
}

function buildOzonPlainDescription(data, russianTitle) {
  const attrs = new Map((data.attributes || []).map((item) => [item.name, item.value]));
  const product = russianTitle || generateRussianOzonTitle(data);
  const source = `${data.title || ""} ${(data.attributes || []).map((item) => `${item.name}${item.value}`).join(" ")}`.toLowerCase();
  if (isPhoneCaseSource(source)) return buildPhoneCaseDescription(data, product);
  if (isWaterBottleSource(source)) return buildWaterBottleDescription(data, product);
  const material = translateMaterial(attrs.get("材质") || "");
  const style = translateStyle(attrs.get("风格") || attrs.get("图案") || "");
  const size = attrs.get("尺码") || attrs.get("尺寸") || "";
  const skuValues = (data.skuVariants || [])
    .slice(0, 20)
    .map((sku) => safeRussianText(inferRussianColorNameFromSpec(sku.spec) || extractWeightLabel(sku.spec)))
    .filter(Boolean);
  const specs = [
    material ? `Материал: ${material}` : "",
    style ? `Дизайн: ${style}` : "",
    size ? `Размер: ${safeRussianText(size)}` : "",
    data.sizeWeight?.weightG ? `Вес: ${data.sizeWeight.weightG} г` : "",
    data.sizeWeight?.lengthMm ? `Габариты: ${data.sizeWeight.lengthMm} x ${data.sizeWeight.widthMm} x ${data.sizeWeight.heightMm} мм` : "",
  ].filter(Boolean);

  return [
    product,
    "",
    `Описание: ${product} подходит для повседневного использования и аккуратно сочетается с разными образами.${style ? ` Стиль: ${style}.` : ""}${material ? ` Материал: ${material}.` : ""}`,
    "",
    "Характеристики:",
    ...specs.map((line) => `- ${line}`),
    skuValues.length ? "" : "",
    skuValues.length ? "Варианты: " + skuValues.join(", ") : "",
  ].filter((line, index, arr) => line || arr[index - 1]).map(safeRussianText).filter(Boolean).join("\n").trim();
}

function buildDetailedOzonDescription(data, russianTitle, preferred = "") {
  const attrs = new Map((data.attributes || []).map((item) => [item.name, item.value]));
  const source = `${data.title || ""} ${(data.attributes || []).map((item) => `${item.name}${item.value}`).join(" ")}`.toLowerCase();
  if (isPhoneCaseSource(source)) return buildPhoneCaseDescription(data, russianTitle || generateRussianOzonTitle(data));
  if (isWaterBottleSource(source)) return buildWaterBottleDescription(data, russianTitle || generateRussianOzonTitle(data));
  const base = sanitizeCommercialText(preferred || buildOzonPlainDescription(data, russianTitle));
  const craftMold = isCraftMoldSource(source);
  if (base.length >= 420 && !/выпеч|кекс|пирог/i.test(base)) return base.slice(0, 650);
  const product = safeRussianText(russianTitle || generateRussianOzonTitle(data));
  const material = translateMaterial(attrs.get("材质") || "") || "прочный материал";
  const size = data.sizeWeight?.lengthMm
    ? `Размер упаковки: ${data.sizeWeight.lengthMm} x ${data.sizeWeight.widthMm} x ${data.sizeWeight.heightMm} мм.`
    : "";
  const weight = data.sizeWeight?.weightG ? `Вес с упаковкой: около ${data.sizeWeight.weightG} г.` : "";
  if (craftMold) {
    const craftExtra = [
      `${product} предназначена для изготовления декоративных изделий из эпоксидной смолы, гипса, воска и ароматических композиций.`,
      `Материал: ${material}. Гибкая форма помогает аккуратно извлекать готовую заготовку и сохранять рельефные детали рисунка.`,
      "Подходит для домашнего творчества, мастер-классов и небольших творческих проектов. Перед использованием форму рекомендуется промыть и высушить.",
      size,
      weight,
    ].filter(Boolean).join(" ");
    return sanitizeCommercialText(craftExtra).slice(0, 650);
  }
  const category = /силикон|силиконовый/i.test(material) ? "силиконовая форма" : "форма для выпечки";
  const extra = [
    `${product} предназначена для домашней и профессиональной выпечки, приготовления десертов, муссов, брауни, кексов и небольших порционных изделий.`,
    `Изделие выполнено из материала: ${material}. ${category} удобна в использовании, помогает аккуратно сформировать заготовку и подходит для регулярной работы на кухне.`,
    "Поверхность легко очищается после использования, форма занимает мало места при хранении и подходит для создания аккуратной подачи десертов к празднику, семейному чаепитию или небольшому заказу.",
    size,
    weight,
    "Перед первым использованием рекомендуется промыть изделие теплой водой и использовать согласно назначению.",
  ].filter(Boolean).join(" ");
  return sanitizeCommercialText(extra).slice(0, 650);
}

function isPhoneCaseSource(source = "") {
  return /手机壳|保护壳|软壳|防摔|镜头防摔|iphone|适用机型|苹果型号|чехол|смартфон/.test(String(source || "").toLowerCase());
}

function isWaterBottleSource(source = "") {
  return /运动水壶|旅行水壶|户外水壶|折叠水壶|折叠水杯|水瓶|水壶|水杯|杯子|бутылк|фляг|термос/.test(String(source || "").toLowerCase());
}

function buildWaterBottleDescription(data, russianTitle = "") {
  const attrs = new Map((data.attributes || []).map((item) => [item.name, item.value]));
  const material = translateMaterial(attrs.get("材质") || attrs.get("塑料") || "") || "пищевого материала";
  const size = data.sizeWeight?.lengthMm
    ? `Размер упаковки: ${data.sizeWeight.lengthMm} x ${data.sizeWeight.widthMm} x ${data.sizeWeight.heightMm} мм.`
    : "";
  const weight = data.sizeWeight?.weightG ? `Вес с упаковкой: около ${data.sizeWeight.weightG} г.` : "";
  return sanitizeCommercialText([
    `${safeRussianText(russianTitle || "Складная бутылка для воды")} подходит для тренировок, поездок, прогулок и отдыха на природе.`,
    `Изделие выполнено из материала: ${material}. Бутылка легкая, многоразовая и удобная для переноски в сумке или рюкзаке.`,
    "Складная конструкция помогает экономить место после использования. Перед первым применением рекомендуется промыть изделие теплой водой.",
    size,
    weight,
  ].filter(Boolean).join(" ")).slice(0, 650);
}

function buildPhoneCaseDescription(data, russianTitle = "") {
  const attrs = new Map((data.attributes || []).map((item) => [item.name, item.value]));
  const material = translateMaterial(attrs.get("材质") || "") || "силикон";
  const features = [];
  const featureText = `${attrs.get("功能") || ""} ${attrs.get("款式") || ""} ${attrs.get("流行元素") || ""} ${data.title || ""}`;
  if (/防摔|防震|защит/i.test(featureText)) features.push("защищает корпус смартфона от повседневных потертостей и небольших ударов");
  if (/镜头|камера/i.test(featureText)) features.push("имеет бортик для дополнительной защиты блока камеры");
  if (/挂绳|ремеш/i.test(featureText)) features.push("может использоваться с ремешком, если он предусмотрен выбранным вариантом");
  if (!features.length) features.push("подходит для ежедневного использования");
  const models = [...new Set((data.skuVariants || [])
    .map((sku) => cleanSkuSpec(sku.spec || "").split(">").at(-1)?.trim())
    .filter(Boolean))]
    .slice(0, 6);
  const modelText = models.length
    ? `Доступны варианты для разных моделей iPhone, включая ${models.join(", ")}.`
    : "Доступны варианты для разных моделей смартфонов.";
  const size = data.sizeWeight?.lengthMm
    ? `Размер упаковки: ${data.sizeWeight.lengthMm} x ${data.sizeWeight.widthMm} x ${data.sizeWeight.heightMm} мм.`
    : "";
  const weight = data.sizeWeight?.weightG ? `Вес с упаковкой: около ${data.sizeWeight.weightG} г.` : "";
  return sanitizeCommercialText([
    `${safeRussianText(russianTitle || "Чехол для смартфона из силикона")} выполнен из материала: ${material}.`,
    `Мягкая накладка плотно прилегает к смартфону и ${features.join(", ")}.`,
    modelText,
    "Перед заказом выберите подходящую модель телефона в вариантах товара.",
    size,
    weight,
  ].filter(Boolean).join(" ")).slice(0, 520).replace(/\s+\S*$/, ".");
}

function buildOzonRichContent(data, russianTitle, preparedDescription = "") {
  const storeName = currentStoreName();
  const images = (data.images || []).slice(0, 5);
  const description = preparedDescription || buildDetailedOzonDescription(data, russianTitle);
  const specLines = buildRichSpecLines(data);
  const content = [
    {
      widgetName: "raTextBlock",
      text: {
        content: `Добро пожаловать в магазин ${storeName}. Наш магазин стремится предложить вам изящные и красивые товары для комфортной жизни.`,
      },
    },
    {
      widgetName: "raTextBlock",
      text: { content: description },
    },
  ];
  if (specLines.length) {
    content.push({
      widgetName: "raTextBlock",
      text: {
        content: ["Характеристики:", ...specLines.map((line) => `• ${line}`)].join("\n"),
      },
    });
  }
  if (images.length) {
    content.push({
      widgetName: "raGallery",
      blocks: images.map((url) => ({ img: { src: url } })),
    });
  }
  return { content };
}

function buildRichSpecLines(data = {}) {
  const attrs = (data.attributes || [])
    .map((item) => ({
      name: String(item?.name || "").trim(),
      value: String(item?.value || "").trim(),
    }))
    .filter((item) => item.name && item.value && item.value !== "-")
    .slice(0, 8)
    .map((item) => `${safeRussianText(item.name)}: ${safeRussianText(item.value)}`);
  const sizeWeightLines = [];
  if (data.sizeWeight?.weightG) sizeWeightLines.push(`Вес: ${data.sizeWeight.weightG} г`);
  if (data.sizeWeight?.lengthMm && data.sizeWeight?.widthMm && data.sizeWeight?.heightMm) {
    sizeWeightLines.push(`Габариты упаковки: ${data.sizeWeight.lengthMm} x ${data.sizeWeight.widthMm} x ${data.sizeWeight.heightMm} мм`);
  }
  const variants = [...new Set((data.skuVariants || [])
    .map((sku) => safeRussianText(cleanSkuSpec(sku.spec || "").replace(/>/g, " / ")))
    .filter(Boolean))]
    .slice(0, 6);
  if (variants.length) sizeWeightLines.push(`Варианты: ${variants.join("; ")}`);
  return [...sizeWeightLines, ...attrs].slice(0, 12);
}

function currentStoreName() {
  const store = state.stores.find((item) => item.id === selectedStoreId());
  return store?.name || "Ozon";
}

function generateRussianHashtags(data, russianTitle) {
  const source = `${russianTitle || ""} ${data.title || ""} ${(data.attributes || []).map((item) => `${item.name} ${item.value}`).join(" ")}`;
  const product = detectRussianProduct(source.toLowerCase());
  const attrs = new Map((data.attributes || []).map((item) => [item.name, item.value]));
  const base = [
    product,
    "женский платок",
    "головной платок",
    "платок на голову",
    "этнический стиль",
    "модный аксессуар",
    "женский аксессуар",
    "легкий платок",
    "регулируемый размер",
    "повседневный образ",
    "летний аксессуар",
    "платок женский",
    "головной убор",
    "аксессуар для волос",
    "стильный платок",
    "платок тканевый",
    "платок с узором",
    "шарф платок",
    "бандана женская",
    "косынка женская",
    "мягкая ткань",
    "для прогулки",
    "для отдыха",
    "для подарка",
    "универсальный аксессуар",
  ];
  if (/包|сумка/i.test(source)) base.splice(0, base.length, "женская сумка", "сумка через плечо", "модная сумка", "повседневная сумка", "маленькая сумка", "сумка женская", "сумка для прогулки", "сумка на каждый день", "стильная сумка", "текстильная сумка", "сумка с ремнем", "городская сумка", "сумка кроссбоди", "женский аксессуар", "сумка подарок", "легкая сумка", "сумка casual", "компактная сумка", "сумка для телефона", "сумка для документов", "сумка тренд", "сумка практичная", "сумка мягкая", "сумка универсальная", "сумка озон");
  const colors = translateColors(attrs.get("颜色") || "");
  if (colors) base.push(...colors.split("/").map((color) => `${color} цвет`));
  return [...new Set(base)]
    .slice(0, 25)
    .map((tag) => `#${tag.trim().replace(/\s+/g, "_")}`)
    .join(" ");
}

function generateStrictRussianHashtags(russianTitle = "") {
  const title = sanitizeCommercialText(russianTitle).toLowerCase();
  const titleWords = title
    .replace(/[^а-яё\s-]/gi, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !isForbiddenTagWord(word));
  const waterBottle = /бутылк|фляг|вода|спорт|туризм|путешеств|силикон/.test(title);
  const craft = /смол|эпоксид|свеч|гипс|молд|силиконовая_форма|силиконовая форма|творч/.test(title);
  const base = waterBottle ? [
    "бутылка воды",
    "спортивная бутылка",
    "складная бутылка",
    "бутылка спорт",
    "бутылка туризм",
    "бутылка поездки",
    "многоразовая бутылка",
    "бутылка силикон",
    "туристическая бутылка",
    "бутылка прогулки",
    "бутылка фитнес",
    "бутылка тренировки",
    "легкая бутылка",
    "походная бутылка",
    "бутылка дорожная",
    "для воды",
    "для спорта",
    "для путешествий",
    "для кемпинга",
    "силиконовая бутылка",
    "складная посуда",
    "аксессуар спорт",
    "активный отдых",
    "туристическая посуда",
    "бутылка рюкзак",
  ] : craft ? [
    "силиконовая форма",
    "форма смолы",
    "форма свечей",
    "форма гипса",
    "молд силиконовый",
    "форма молд",
    "форма льва",
    "декор своими",
    "творчество",
    "рукоделие",
    "эпоксидная смола",
    "гипсовый декор",
    "восковая форма",
    "арома свеча",
    "форма фигурки",
    "домашний декор",
    "форма рукоделия",
    "силиконовый молд",
    "форма заливки",
    "творческий набор",
    "декоративная форма",
    "молд льва",
    "форма поделок",
    "ручная работа",
    "форма декора",
  ] : [
    "форма выпечки",
    "форма брауни",
    "форма десертов",
    "кухонная форма",
    "форма кекса",
    "домашняя выпечка",
    "кондитерская форма",
    "форма мусса",
    "форма пирога",
    "форма духовки",
    "силиконовая форма",
    "антипригарная форма",
    "кухонные товары",
    "десерт",
    "кекс",
    "брауни",
    "печенье",
    "готовка",
    "кухня",
    "кондитер",
    "посуда",
    "выпечка",
    "пирог",
    "мусс",
    "форма",
  ];
  const fromTitle = [];
  for (let i = 0; i < titleWords.length; i += 1) {
    fromTitle.push(titleWords[i]);
    if (titleWords[i + 1]) fromTitle.push(`${titleWords[i]} ${titleWords[i + 1]}`);
  }
  const tags = [...fromTitle, ...base]
    .map((tag) => tag.toLowerCase().replace(/-/g, " ").trim())
    .filter((tag) => tag && tag.split(/\s+/).length <= 2)
    .filter((tag) => !/\d/.test(tag))
    .filter((tag) => !tag.split(/\s+/).some(isForbiddenTagWord))
    .map((tag) => `#${tag.replace(/\s+/g, "_")}`);
  return [...new Set(tags)].slice(0, 25).join("");
}

function isForbiddenTagWord(word = "") {
  return /ozon|amazon|ebay|wish|lazada|aliexpress|nashome|oem|xymall|ксималл|бренд|brand|shop|магазин|скидк|акци|хит|топ|лучший|новинк|дешев|подарок|распродаж/i.test(String(word || ""));
}

function generateRussianOzonTitle(data) {
  const source = `${data.title || ""} ${(data.attributes || []).map((item) => `${item.name}${item.value}`).join(" ")}`.toLowerCase();
  const attrs = new Map((data.attributes || []).map((item) => [item.name, item.value]));
  const product = detectRussianProduct(source);
  const audience = detectRussianAudience(source, attrs);
  const material = translateMaterial(attrs.get("材质") || "");
  const usage = detectRussianUsage(source, attrs);
  const shape = detectRussianShape(source, attrs);
  const style = translateStyle(attrs.get("风格") || attrs.get("图案") || "");
  const size = attrs.get("尺码") || attrs.get("尺寸") || "";
  const features = [
    audience ? `${audience} вариант` : "",
    material,
    shape,
    style,
    usage,
    size ? `размер ${safeRussianText(size)}` : "",
    "для повседневного использования",
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  return sanitizeOzonTitleText([product, ...features].join(", "), 220);
}

function detectRussianProduct(text) {
  const rules = [
    [/运动水壶|旅行水壶|户外水壶|折叠水壶|折叠水杯|水瓶|水壶|水杯|杯子/, "Складная силиконовая бутылка для воды"],
    [/滴胶|树脂|香薰|石膏|蜡烛|手工diy|diy.*模具/, "Силиконовая форма для свечей и смолы"],
    [/брауни|蛋糕模|蛋糕磨具|慕斯模具|法甜模|模具|烘焙用品|烘焙/, "Форма для выпечки"],
    [/烤盘|布朗尼烤盘|面包蛋糕模|蛋糕模方格/, "Форма для выпечки брауни"],
    [/头巾帽|化疗帽|民族帽|帽子|头巾|围巾|披肩/, "Головной платок"],
    [/单肩包|斜挎包|手提包|女包|包包|小方包/, "Женская сумка"],
    [/衣架|挂衣架/, "Вешалка для одежды"],
    [/收纳盒|收纳箱|整理箱/, "Органайзер для хранения"],
    [/手机壳|保护壳/, "Чехол для смартфона"],
    [/玩具|公仔|毛绒/, "Мягкая игрушка"],
    [/鞋|拖鞋|凉鞋/, "Обувь"],
    [/杯|水杯|保温杯/, "Кружка"],
  ];
  return rules.find(([regex]) => regex.test(text))?.[1] || "Товар для дома";
}

function detectRussianUsage(text, attrs) {
  const source = `${text} ${attrs.get("用途") || ""} ${attrs.get("产品类别") || ""}`;
  if (isCraftMoldSource(source)) return "для свечей, гипса и эпоксидной смолы";
  if (/брауни|布朗尼/.test(source)) return "для брауни и десертов";
  if (/мусс|慕斯|法甜/.test(source)) return "для мусса и десертов";
  if (/蛋糕|кекс|пирог/.test(source)) return "для кексов и пирогов";
  if (/烘焙|выпеч/.test(source)) return "для домашней выпечки";
  return "";
}

function detectRussianShape(text, attrs) {
  const source = `${text} ${attrs.get("形状") || ""} ${attrs.get("规格") || ""}`;
  if (/狮子|лев/.test(source)) return "в форме льва";
  if (/长方|прямоуг/.test(source)) return "прямоугольная";
  if (/圆|круг/.test(source)) return "круглая";
  if (/菱形|ромб/.test(source)) return "ромбовидная";
  if (/四叶草|клевер/.test(source)) return "в форме клевера";
  return "";
}

function isCraftMoldSource(source = "") {
  return /滴胶|树脂|香薰|石膏|蜡烛|肥皂|手工diy|diy/.test(source) && /模具|模|mold/i.test(source);
}

function isUsableGeneratedTitle(title = "") {
  const value = safeRussianText(title);
  if (!value || value.length < 18) return false;
  if (/\bтовар\b/i.test(value)) return false;
  if (/\d+\s*(g|г|kg|кг)\b/i.test(value)) return false;
  if (/\/.*\//.test(value)) return false;
  return /форма|платок|сумка|вешалка|органайзер|чехол|игрушка|обувь|кружка|бутылк|фляг/i.test(value);
}

function detectRussianAudience(text, attrs) {
  const gender = `${attrs.get("适用性别") || ""} ${text}`;
  if (/女|女士|жен/.test(gender)) return "женский";
  if (/男|男士|муж/.test(gender)) return "мужской";
  if (/儿童|дет/.test(gender)) return "детский";
  return "";
}

function translateMaterial(value) {
  const text = String(value || "");
  if (/水晶麻/.test(text)) return "из ткани";
  if (/织物|布|棉|涤纶/.test(text)) return "из текстиля";
  if (/硅胶|silicone/i.test(text)) return "из силикона";
  if (/碳钢|高碳钢|钢|steel/i.test(text)) return "из стали";
  if (/木|木质/.test(text)) return "из дерева";
  if (/塑料|pp|abs/i.test(text)) return "из пластика";
  if (/金属|铁|钢/.test(text)) return "из металла";
  if (/皮|pu/i.test(text)) return "из искусственной кожи";
  return "";
}

function translateStyle(value) {
  const text = String(value || "");
  if (/民族|欧美|拼色|缎纹/.test(text)) return "в этническом стиле";
  if (/简约|纯色/.test(text)) return "однотонный";
  if (/卡通|可爱/.test(text)) return "с декоративным дизайном";
  return "";
}

function translateColors(value) {
  const map = [
    [/白/, "белый"],
    [/黑/, "черный"],
    [/灰/, "серый"],
    [/粉/, "розовый"],
    [/蓝/, "синий"],
    [/紫/, "фиолетовый"],
    [/红/, "красный"],
    [/卡其|驼/, "хаки"],
    [/咖啡|棕/, "коричневый"],
  ];
  const colors = value.split(/[,，]/)
    .map((item) => map.find(([regex]) => regex.test(item))?.[1])
    .filter(Boolean);
  return [...new Set(colors)].slice(0, 3).join("/");
}

function translateSize(value) {
  if (/可调节/.test(String(value || ""))) return "регулируемый размер";
  return "";
}

function compactRussianTitle(value, limit = 200) {
  return value
    .replace(/\s+/g, " ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*$/g, "")
    .slice(0, limit)
    .trim();
}

function variantDraftStatusForOffer(offerId) {
  const variants = state.currentCaptureDraft?.variants || [];
  return variants.find((item) => item.offer_id === offerId) || null;
}

function variantStatusBadgeHtml(status = "unlisted", message = "") {
  const labels = {
    unlisted: "未上架",
    unclaimed: "未认领",
    edited: "未提交修改",
    submitted: "已提交",
    success: "成功",
    error: "错误",
  };
  const cls = ["success", "error", "submitted"].includes(status) ? status : "neutral";
  return `<span class="variant-status-badge ${cls}" title="${escapeHtml(message || labels[status] || status)}">${escapeHtml(labels[status] || status)}</span>`;
}

async function renderListingVariantsFrom1688(data, parentSku = "") {
  const grouped = phoneCaseVariantGroups(data);
  state.variantGroups = grouped;
  state.selectedVariantGroup = Math.min(state.selectedVariantGroup || 0, Math.max(grouped.length - 1, 0));
  renderVariantGroupPanel(data, parentSku);
  const activeGroup = grouped[state.selectedVariantGroup] || null;
  const variants = activeGroup?.variants?.length
    ? activeGroup.variants
    : (data.skuVariants?.length ? data.skuVariants : [data.ozonDraft || {}]);
  const activeParentSku = activeGroup ? phoneCaseGroupParentSku(activeGroup, state.selectedVariantGroup) : parentSku;
  const baseOfferRoot = activeParentSku || data.ozonDraft?.offer_id || `1688-${Date.now()}`;
  const baseOffer = baseOfferRoot;
  if (activeParentSku) {
    $("#listingParentSku").value = activeParentSku;
    applyCardMergeModelAttribute();
  }
  const fallbackOldPrice = document.querySelector(".variant-old-price, #listingOldPrice")?.value || "";
  const fallbackMinPrice = document.querySelector(".variant-min-price, #listingMinPrice")?.value || "";
  renderVariantTableHeader();
  const rows = await Promise.all(variants.map(async (variant, index) => {
    const suffix = activeGroup ? phoneModelSuffix(variant.spec || "", index) : variantRussianSuffix(variant.spec || "", index);
    const offerId = `${baseOffer}-${suffix}`;
    const draftStatus = variantDraftStatusForOffer(offerId);
    const sizeStatus = skuSizeWeightStatus(variant, data);
    const skuPrice = Number(variant.price || data.ozonDraft?.price || 0);
    const purchasePrice = addNumber(skuPrice, PURCHASE_COST_MARKUP_RMB);
    const weight = addNumber(variant.weightG || data.sizeWeight?.weightG || data.ozonDraft?.weight, PACKAGE_WEIGHT_PADDING_G);
    const depth = addNumber(variant.lengthMm || data.sizeWeight?.lengthMm || data.ozonDraft?.depth, PACKAGE_SIZE_PADDING_MM);
    const width = addNumber(variant.widthMm || data.sizeWeight?.widthMm || data.ozonDraft?.width, PACKAGE_SIZE_PADDING_MM);
    const height = addNumber(variant.heightMm || data.sizeWeight?.heightMm || data.ozonDraft?.height, PACKAGE_SIZE_PADDING_MM);
    const autoPrice = await calculateListingVariantPrice({
      purchaseCost: purchasePrice,
      weightG: weight,
      lengthMm: depth,
      widthMm: width,
      heightMm: height,
    });
    const price = autoPrice?.price || (purchasePrice || "");
    const oldPrice = price ? roundListingMoney(Number(price) * 2) : fallbackOldPrice;
    const minPrice = $("#enableLowestPrice")?.checked !== false && price ? minimumPriceFromFinalPrice(price) : fallbackMinPrice;
    const priceSource = autoPrice?.price
      ? "本地试算，未写入 Ozon；提交前需确认"
      : price
        ? "候选/草稿价格，尚未验证 Ozon 生效"
        : "价格未知，需补齐证据";
    const warehouseId = warehouseIdForShippingLevel(autoPrice?.level);
    const primaryImage = normalizeImageUrlForOzon(variant.image);
    const imageHtml = primaryImage
      ? `<img class="variant-image" src="${escapeHtml(primaryImage)}" alt="${escapeHtml(cleanSkuSpec(variant.spec || ""))}" />`
      : `<div class="photo-placeholder">＋</div>`;
    return `
      <tr data-size-weight-status="${sizeStatus.ok ? "ok" : "missing"}">
        <td><input class="variant-row-check" type="checkbox" checked /></td>
        <td class="variant-status-cell"
          data-offer-id="${escapeHtml(offerId)}"
          data-status="${escapeHtml(draftStatus?.status || "unlisted")}"
          data-task-id="${escapeHtml(draftStatus?.taskId || "")}"
          data-product-id="${escapeHtml(draftStatus?.productId || "")}"
          data-message="${escapeHtml(draftStatus?.message || "")}">
          ${variantStatusBadgeHtml(draftStatus?.status || "unlisted", draftStatus?.message || "")}
          ${draftStatus?.taskId ? `<div class="status-sub">任务 ${escapeHtml(draftStatus.taskId)}</div>` : ""}
        </td>
        <td><div class="variant-color-sample">${imageHtml}</div></td>
        <td>
          <button class="variant-image-editor" type="button" title="编辑该 SKU 图片">
            <div class="variant-image-box">${imageHtml}</div>
          </button>
          <textarea class="variant-images-json" hidden>${escapeHtml(JSON.stringify(variantImagesForOzon(variant)))}</textarea>
        </td>
        <td><input class="variant-offer-id" value="${escapeHtml(offerId)}" /></td>
        <td><input class="variant-barcode" placeholder="任务成功后生成" /></td>
        <td><input class="variant-price" data-price-source="${escapeHtml(priceSource)}" title="${escapeHtml(priceSource)}" value="${escapeHtml(price)}" /></td>
        <td><input class="variant-cost-price" data-price-source="采购成本草稿值，未写入 Ozon" title="采购成本草稿值，未写入 Ozon" value="${escapeHtml(purchasePrice || "")}" placeholder="采购成本" /></td>
        <td><input class="variant-old-price" data-price-source="${escapeHtml(priceSource)}" title="${escapeHtml(priceSource)}" value="${escapeHtml(oldPrice)}" /></td>
        <td><input class="variant-min-price" data-price-source="${escapeHtml(priceSource)}" title="${escapeHtml(priceSource)}" value="${escapeHtml(minPrice)}" ${$("#enableLowestPrice")?.checked === false ? "disabled" : ""} /></td>
        <td>${selectOptionsWithSelected(warehouseId)}</td>
        <td><input class="variant-stock" value="${DEFAULT_LISTING_STOCK}" /></td>
        <td>
          <input class="variant-weight" value="${escapeHtml(weight)}" />
          ${sizeStatus.ok && !sizeStatus.fallback ? "" : `<div class="${sizeStatus.ok ? "field-note" : "field-alert"}">${escapeHtml(sizeStatus.message)}</div>`}
        </td>
        <td><input class="variant-depth" value="${escapeHtml(depth)}" /></td>
        <td><input class="variant-width" value="${escapeHtml(width)}" /></td>
        <td><input class="variant-height" value="${escapeHtml(height)}" /></td>
        ${variantAspectCellsHtml(variant, index)}
        <td><button class="row-delete variant-delete" type="button">移除</button></td>
      </tr>
    `;
  }));
  $("#listingVariantRows").innerHTML = rows.join("");
  bindAttributeValuePickers($("#listingVariantRows"));
  await autoResolveAttributeValueInputs($("#listingVariantRows"));
  bindVariantRowActions();
}

function phoneCaseVariantGroups(data = {}) {
  const title = `${data.title || ""} ${(data.attributes || []).map((item) => `${item.name}${item.value}`).join(" ")}`;
  const variants = data.skuVariants || [];
  if (!/手机壳|保护壳|iphone|苹果型号|适用机型|硅胶软壳/i.test(title) || variants.length < 20) return [];
  const groups = new Map();
  for (const variant of variants) {
    const spec = cleanSkuSpec(variant.spec || "");
    const [styleRaw, modelRaw = ""] = spec.split(">").map((item) => item.trim());
    if (!styleRaw || !modelRaw) continue;
    const key = styleRaw.replace(/[【】★]/g, " ").replace(/\s+/g, " ").trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...variant, spec, phoneCaseStyle: key, phoneCaseModel: modelRaw });
  }
  const result = [...groups.entries()]
    .map(([key, rows]) => ({ key, variants: rows }))
    .filter((group) => group.variants.length >= 2);
  return result.length >= 2 ? result : [];
}

function renderVariantGroupPanel(data = {}, parentSku = "") {
  const panel = $("#variantGroupPanel");
  if (!panel) return;
  if (!state.variantGroups.length) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  const root = parentSku || $("#listingParentSku")?.value.trim() || "SKUlq";
  panel.hidden = false;
  panel.innerHTML = `
    <div><strong>检测到手机壳双维变体：</strong>已按 1688 款式拆成 ${state.variantGroups.length} 个独立 SKU 合集，每个合集单独占用一个 SKUlq 编号；当前合集下面商品颜色用随机颜色，颜色名称填写 iPhone 型号。</div>
    <label>当前 SKU 合集
      <select id="variantGroupSelect">
        ${state.variantGroups.map((group, index) => `
          <option value="${index}" ${index === state.selectedVariantGroup ? "selected" : ""}>
            ${escapeHtml(`${phoneCaseGroupParentSku(group, index) || root}｜${group.key}｜${group.variants.length}个型号`)}
          </option>
        `).join("")}
      </select>
    </label>
  `;
  $("#variantGroupSelect")?.addEventListener("change", async (event) => {
    state.selectedVariantGroup = Number(event.target.value || 0);
    await renderListingVariantsFrom1688(data, $("#listingParentSku").value.trim());
  });
}

function phoneModelSuffix(spec = "", index = 0) {
  const parts = cleanSkuSpec(spec).split(">").map((item) => item.trim()).filter(Boolean);
  return slugForOffer(parts[1] || `model-${index + 1}`) || `model-${index + 1}`;
}

function phoneCaseGroupParentSku(_group, index = 0) {
  return state.reservedParentSkus[index] || $("#listingParentSku")?.value.trim() || "";
}

function slugForOffer(value = "") {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[【】（）()★+]/g, " ")
    .replace(/罗小黑/g, "luoxiaohei")
    .replace(/可爱/g, "cute")
    .replace(/生气/g, "angry")
    .replace(/荷叶/g, "lotus")
    .replace(/挂绳/g, "strap")
    .replace(/硅胶/g, "silicone")
    .replace(/软壳/g, "case")
    .replace(/镜头/g, "camera")
    .replace(/防摔/g, "shockproof")
    .replace(/灰/g, "gray")
    .replace(/酒红/g, "burgundy")
    .replace(/黑/g, "black")
    .replace(/白/g, "white")
    .replace(/粉/g, "pink")
    .replace(/红/g, "red")
    .replace(/蓝/g, "blue")
    .replace(/绿/g, "green")
    .replace(/紫/g, "purple")
    .replace(/黄/g, "yellow")
    .replace(/金/g, "gold")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return text.slice(0, 64);
}

async function renderVariantAspectColumns() {
  renderVariantTableHeader();
  if (state.collected1688) {
    await renderListingVariantsFrom1688(state.collected1688, $("#listingParentSku").value.trim());
    return;
  }
  document.querySelectorAll("#listingVariantRows tr").forEach((row) => {
    const current = row.querySelector(".variant-value, #listingVariantValue")?.value || "";
    row.querySelectorAll(".variant-aspect-cell").forEach((cell) => cell.remove());
    row.insertAdjacentHTML("beforeend", variantAspectCellsHtml({ spec: current }, 0));
  });
  bindAttributeValuePickers($("#listingVariantRows"));
  await autoResolveAttributeValueInputs($("#listingVariantRows"));
}

async function calculateListingVariantPrice({ purchaseCost, weightG, lengthMm, widthMm, heightMm }) {
  if (!purchaseCost || !weightG || !lengthMm || !widthMm || !heightMm) return null;
  const data = await api("/api/pricing/calculate", {
    method: "POST",
    body: JSON.stringify({
      purchaseCost,
      weightG,
      lengthMm,
      widthMm,
      heightMm,
      commissionRate: Number($("#calcCommissionRate").value) / 100,
      miscFeeRate: Number($("#calcMiscRate").value) / 100,
      fixedMiscFee: Number($("#calcFixedMisc").value),
      profitRate: Number($("#calcProfitRate").value) / 100,
    }),
  });
  return {
    price: Number(data.priceCny ?? data.nextPriceCny ?? 0) || null,
    level: data.level || (data.levelName ? { name: data.levelName, id: data.levelId } : null),
  };
}

function addNumber(value, addition) {
  const number = Number(value || 0);
  return number > 0 ? roundListingMoney(number + Number(addition || 0)) : "";
}

function roundListingMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function minimumPriceFromFinalPrice(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return "";
  const floored = Math.floor(value);
  return Math.max(1, Number.isInteger(value) ? floored - 1 : floored);
}

function listingImageLibrary() {
  return normalizeImageUrlsForOzon($("#listingImages").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean));
}

function variantImagesForOzon(variant = {}) {
  const primary = normalizeImageUrlForOzon(variant.image || "");
  const rest = listingImageLibrary().filter((url) => normalizeImageUrlForOzon(url) !== primary);
  return normalizeImageUrlsForOzon([primary, ...rest].filter(Boolean));
}

function normalizeImageUrlForOzon(url = "") {
  let value = String(url || "").trim();
  if (!value) return "";
  value = value.replace(/\.jpg_b\.jpg$/i, ".jpg");
  value = value.replace(/\.jpeg_b\.jpg$/i, ".jpeg");
  value = value.replace(/\.png_b\.jpg$/i, ".png");
  value = value.replace(/_+$/i, "");
  return value;
}

function normalizeImageUrlsForOzon(urls = []) {
  return [...new Set(urls.map(normalizeImageUrlForOzon).filter((url) => /^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url)))];
}

function warehouseIdForShippingLevel(level) {
  const name = `${level?.name || ""} ${level?.id || ""}`.toLowerCase().replace(/\s+/g, "");
  if (!name) return "";
  const aliases = {
    extrasmall: ["extrasmall", "extra_small", "exsmall", "超小", "特小"],
    budget: ["budget", "经济", "预算"],
    small: ["small", "小"],
    big: ["big", "大"],
  };
  const key = Object.keys(aliases).find((item) => aliases[item].some((alias) => name.includes(alias.replace(/\s+/g, ""))));
  if (!key) return "";
  const warehouse = state.listingWarehouses.find((item) => {
    const text = `${item.name || ""} ${item.warehouse_id || ""}`.toLowerCase().replace(/\s+/g, "");
    return aliases[key].some((alias) => text.includes(alias.replace(/\s+/g, "")));
  });
  return warehouse?.warehouse_id ? String(warehouse.warehouse_id) : "";
}

function selectOptionsWithSelected(selected = "") {
  const base = warehouseSelectHtml();
  if (!selected) return base;
  return base.replace(`<option value="${escapeHtml(selected)}">`, `<option value="${escapeHtml(selected)}" selected>`);
}

function renderVariantTableHeader() {
  const header = $("#variantTableHeader");
  if (!header) return;
  const aspects = variantAspectAttributes();
  const aspectHeaders = aspects.length
    ? aspects.map((item) => `
        <th class="variant-aspect-header">${requiredMark(item.is_required)}${escapeHtml(item.name || item.attribute_name || "变体属性")}<br /><span>ID ${item.id}${item.is_aspect ? " / 变体属性" : ""}</span></th>
      `).join("")
    : `<th class="variant-aspect-header">变体属性<br /><span>读取分类后生成</span></th>`;
  header.innerHTML = `
    <th class="variant-check-col"><input id="variantSelectAll" type="checkbox" /></th>
    <th>上架状态<br /><span>按 SKU 回填</span></th>
    <th>颜色样本</th>
    <th><b>*</b>产品图</th>
    <th><b>*</b>SKU编号<br /><span>唯一生成</span></th>
    <th>条形码<br /><span>任务成功后请求生成</span></th>
    <th><b>*</b>售价<br /><span>CNY · 本地试算/草稿值，提交前需确认</span></th>
    <th>成本价<br /><span>CNY · 草稿值</span></th>
    <th>划线价<br /><span>CNY · 本地试算值</span></th>
    <th>最低价<br /><span>CNY · 本地试算值</span></th>
    <th><b>*</b>仓库</th>
    <th><b>*</b>库存</th>
    <th><b>*</b>重量(g)<br /><span>含包装</span></th>
    <th><b>*</b>长(mm)</th>
    <th><b>*</b>宽(mm)</th>
    <th><b>*</b>高(mm)</th>
    ${aspectHeaders}
    <th>操作</th>
  `;
  $("#variantSelectAll")?.addEventListener("change", (event) => setAllVariantChecked(event.target.checked));
}

function requiredMark(required) {
  return required ? "<b>*</b>" : "";
}

function variantAspectAttributes() {
  return state.listingVariantAspects?.length ? state.listingVariantAspects : [];
}

function variantAspectCellsHtml(variant = {}, index = 0) {
  const aspects = variantAspectAttributes();
  if (!aspects.length) {
    return `<td class="variant-aspect-cell"><input class="variant-value" value="${escapeHtml(cleanSkuSpec(variant.spec || ""))}" placeholder="读取分类属性后自动切换" /></td>`;
  }
  return aspects.map((aspect) => {
    const value = inferVariantAspectValue(aspect, variant, index);
    return `
      <td class="variant-aspect-cell">
        <div class="attribute-value-combobox">
          <input class="variant-aspect-input"
            data-attribute-id="${aspect.id}"
            data-complex-id="${aspect.attribute_complex_id || 0}"
            data-attribute-type="${aspect.type || "String"}"
            value="${escapeHtml(value)}"
            placeholder="${escapeHtml(aspect.name || aspect.attribute_name || "变体属性")}" />
          <div class="attribute-value-menu"></div>
        </div>
      </td>
    `;
  }).join("");
}

function inferVariantAspectValue(aspect, variant = {}, index = 0) {
  const name = normalizeName(aspect.name || aspect.attribute_name || "");
  const spec = cleanSkuSpec(variant.spec || "");
  const parts = spec.split(/[>;；,，/]+/).map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return "";
  if (variant.phoneCaseModel && /цвет|颜色|colour|color/.test(name)) {
    if (Number(aspect.id) === 10097 || /название цвета|颜色名称/.test(name)) return variant.phoneCaseModel;
    return phoneCasePseudoColor(index);
  }
  if (Number(aspect.id) === 10097 || /название цвета|颜色名称/.test(name)) {
    return inferRussianColorNameFromSpec(spec) || parts[0] || spec;
  }
  if (/цвет|颜色|colour|color/.test(name)) return inferColorNameFromSpec(spec) || parts[0] || spec;
  if (/размер|尺码|尺寸|size/.test(name)) return parts.find((item) => /码|号|可调节|cm|mm|s|m|l|xl|\d/i.test(item)) || parts[1] || spec;
  if (Number(aspect.id) === 7188 || /元件数量|колич|数量|комплект|套|count|quantity/.test(name)) return "1";
  return parts[0] || spec;
}

function phoneCasePseudoColor(index = 0) {
  const colors = ["黑色", "蓝色", "红色", "绿色", "黄色", "紫色", "粉色", "白色", "灰色", "橙色", "棕色", "米色", "金色", "银色"];
  return colors[Math.abs(Number(index) || 0) % colors.length];
}

function inferRussianColorNameFromSpec(spec = "") {
  const text = String(spec).toLowerCase();
  const rules = [
    [/酒红|枣红|玫红|红|red|бордо|красн/, "красный"],
    [/粉红|粉|pink|розов/, "розовый"],
    [/橙|orange|оранж/, "оранжевый"],
    [/黄|yellow|желт/, "желтый"],
    [/金|香槟|gold|золот/, "золотой"],
    [/绿|军绿|墨绿|green|зелен/, "зеленый"],
    [/蓝|天蓝|藏青|navy|blue|син|голуб/, "синий"],
    [/紫|purple|фиолет/, "фиолетовый"],
    [/黑|black|черн/, "черный"],
    [/白|米白|乳白|white|бел/, "белый"],
    [/灰|gray|grey|сер/, "серый"],
    [/棕|咖|brown|корич/, "коричневый"],
    [/卡其|驼|khaki|хаки|беж/, "бежевый"],
    [/透明|clear|прозрач/, "прозрачный"],
  ];
  return rules.find(([regex]) => regex.test(text))?.[1] || "";
}

function extractWeightLabel(value = "") {
  const match = String(value || "").match(/(\d+(?:[.,]\d+)?)\s*(g|г|kg|кг|克)/i);
  if (!match) return "";
  const unit = /kg|кг/i.test(match[2]) ? "кг" : "г";
  return `${match[1].replace(",", ".")} ${unit}`;
}

function defaultProductColorValue() {
  const data = state.collected1688 || {};
  const attrs = new Map((data.attributes || []).map((item) => [item.name, item.value]));
  return attrs.get("产品颜色") || attrs.get("颜色") || data.skuVariants?.map((item) => item.spec).join(" ") || "";
}

function safeRussianText(value = "") {
  return String(value || "")
    .replace(/[\p{Script=Han}]+/gu, " ")
    .replace(/[，、；：。！？【】（）《》]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeCommercialText(value = "") {
  const banned = /\b(ozon|amazon|ebay|wish|lazada|aliexpress|nashome|oem|xymall|brand|shop)\b|ксималл|бренд|магазин|скидк\w*|акци\w*|хит\w*|топ\w*|лучший|новинк\w*|дешев\w*|распродаж\w*/gi;
  return safeRussianText(value)
    .replace(banned, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeOzonTitleText(value = "", limit = 220) {
  const base = sanitizeCommercialText(value)
    .replace(/[;|]+/g, ", ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,+/g, ",")
    .replace(/^,\s*|\s*,$/g, "")
    .trim();
  const parts = base.split(",").map((item) => item.trim()).filter(Boolean);
  const uniqueParts = [];
  const seen = new Set();
  for (const part of parts) {
    const key = normalizeName(part);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueParts.push(part);
  }
  const compact = uniqueParts.join(", ").replace(/\s+/g, " ").trim();
  return compact.slice(0, limit);
}

function hasCyrillicText(value = "") {
  return /[\u0400-\u04FF]/.test(String(value || ""));
}

function ensureRussianTitle(value = "", data = state.collected1688 || {}) {
  const cleaned = sanitizeOzonTitleText(value, 220);
  if (hasCyrillicText(cleaned)) return cleaned;
  return sanitizeOzonTitleText(generateRussianOzonTitle(data), 220);
}

function ensureRussianTags(value = "", title = "", data = state.collected1688 || {}) {
  const cleaned = sanitizeHashtags(value || "");
  if (hasCyrillicText(cleaned)) return cleaned;
  const fallbackTitle = ensureRussianTitle(title, data);
  return generateStrictRussianHashtags(fallbackTitle);
}

function ensureRussianDescription(value = "", title = "", data = state.collected1688 || {}) {
  const cleaned = sanitizeCommercialText(value || "");
  if (hasCyrillicText(cleaned)) return cleaned;
  const fallbackTitle = ensureRussianTitle(title, data);
  return buildDetailedOzonDescription(data, fallbackTitle);
}

function ensureRussianRichContent(value = "", title = "", description = "", data = state.collected1688 || {}) {
  const normalized = sanitizeOzonRichContent(value || "");
  if (hasCyrillicText(normalized)) return normalized;
  const fallbackTitle = ensureRussianTitle(title, data);
  const fallbackDesc = ensureRussianDescription(description, fallbackTitle, data);
  return JSON.stringify(buildOzonRichContent(data, fallbackTitle, fallbackDesc), null, 2);
}

function sanitizeHashtags(value = "") {
  const banned = /ozon|amazon|ebay|wish|lazada|aliexpress|nashome|oem|xymall|ксималл|бренд|brand|магазин|shop/i;
  const fallback = [
    "#форма_для_выпечки",
    "#для_брауни",
    "#для_десертов",
    "#кухня",
    "#выпечка",
    "#кондитерская_форма",
    "#форма_для_кекса",
    "#домашняя_выпечка",
    "#силиконовая_форма",
    "#антипригарная_форма",
    "#для_мусса",
    "#для_пирога",
    "#кухонные_товары",
    "#форма_для_духовки",
    "#десерт",
    "#кекс",
    "#брауни",
    "#печенье",
    "#удобная_форма",
    "#подарок_кулинару",
    "#дом",
    "#готовка",
    "#кондитер",
    "#праздничная_выпечка",
    "#посуда",
  ];
  const tags = String(value || "")
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter((tag) => /^#[\p{Script=Cyrillic}a-z0-9_]{2,30}$/iu.test(tag))
    .filter((tag) => !banned.test(tag));
  return [...new Set(tags.length ? tags : fallback)].slice(0, 25).join(" ");
}

function sanitizeOzonRichContent(value = "") {
  try {
    const data = JSON.parse(value || "{}");
    return JSON.stringify(normalizeOzonRichContent(data), null, 2);
  } catch {
    const text = safeRussianText(value);
    return JSON.stringify(normalizeOzonRichContent({
      content: [
        {
          widgetName: "raTextBlock",
          text: { content: text || "Описание товара" },
        },
      ],
    }), null, 2);
  }
}

function normalizeOzonRichContent(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const blocks = Array.isArray(source.content) ? source.content : [];
  const normalized = [];
  for (const block of blocks) {
    const widgetName = String(block?.widgetName || "").trim();
    if (widgetName === "raTextBlock") {
      const text = safeRussianText(block?.text?.content || block?.text || "");
      if (!text) continue;
      normalized.push({
        widgetName: "raTextBlock",
        text: { content: text.slice(0, 4000) },
      });
      continue;
    }
    if (widgetName === "raGallery") {
      const galleryBlocks = Array.isArray(block?.blocks) ? block.blocks : [];
      const images = galleryBlocks
        .map((item) => String(item?.img?.src || "").trim())
        .filter((src) => /^https?:\/\/\S+/i.test(src))
        .slice(0, 15)
        .map((src) => ({ img: { src } }));
      if (!images.length) continue;
      normalized.push({
        widgetName: "raGallery",
        blocks: images,
      });
    }
  }
  if (!normalized.length) {
    normalized.push({
      widgetName: "raTextBlock",
      text: { content: "Описание товара" },
    });
  }
  return { content: normalized };
}

function inferColorNameFromSpec(spec = "") {
  const text = String(spec).toLowerCase();
  const rules = [
    [/酒红|枣红|玫红|粉红|红|red|бордо|красн/, "红色"],
    [/粉|pink|розов/, "粉色"],
    [/橙|orange|оранж/, "橙色"],
    [/黄|金|gold|yellow|золот|желт/, "黄色"],
    [/绿|军绿|墨绿|green|зелен/, "绿色"],
    [/蓝|天蓝|藏青|navy|blue|син|голуб/, "蓝色"],
    [/紫|purple|фиолет/, "紫色"],
    [/黑|black|черн/, "黑色"],
    [/白|米白|乳白|white|бел/, "白色"],
    [/灰|gray|grey|сер/, "灰色"],
    [/棕|咖|卡其|驼|brown|khaki|корич|хаки|беж/, "棕色"],
    [/透明|clear|прозрач/, "透明"],
  ];
  return rules.find(([regex]) => regex.test(text))?.[1] || "";
}

function colorFamily(value = "") {
  const color = inferColorNameFromSpec(value) || String(value);
  return normalizeName(color);
}

function setAllVariantChecked(checked) {
  document.querySelectorAll(".variant-row-check").forEach((checkbox) => {
    checkbox.checked = checked;
  });
}

function bindVariantRowActions() {
  document.querySelectorAll(".variant-delete").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => {
      const rows = document.querySelectorAll("#listingVariantRows tr");
      if (rows.length <= 1) {
        toast("至少保留一行变体", "error");
        return;
      }
      button.closest("tr")?.remove();
    });
  });
  document.querySelectorAll(".variant-image-editor").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => openVariantImageEditor(button.closest("tr")));
  });
  document.querySelectorAll("#listingVariantRows input, #listingVariantRows select, #listingVariantRows textarea").forEach((input) => {
    input.addEventListener("input", () => markVariantRowEdited(input.closest("tr")));
    input.addEventListener("change", () => markVariantRowEdited(input.closest("tr")));
  });
}

function markVariantRowEdited(row) {
  const cell = row?.querySelector(".variant-status-cell");
  if (!cell) return;
  const current = cell.dataset.status || "unlisted";
  if (current === "submitted" || current === "success" || current === "error") {
    setVariantRowStatus(row, "edited", "本行已修改，尚未重新提交");
  }
}

function setVariantRowStatus(row, status, message = "", taskId = "", productId = "") {
  const cell = row?.querySelector(".variant-status-cell");
  if (!cell) return;
  cell.dataset.status = status;
  if (taskId) cell.dataset.taskId = taskId;
  if (productId) cell.dataset.productId = productId;
  cell.dataset.message = message || "";
  cell.innerHTML = `
    ${variantStatusBadgeHtml(status, message)}
    ${cell.dataset.taskId ? `<div class="status-sub">任务 ${escapeHtml(cell.dataset.taskId)}</div>` : ""}
    ${message ? `<div class="variant-status-message">${escapeHtml(message)}</div>` : ""}
  `;
}

function openVariantImageEditor(row) {
  if (!row) return;
  const textarea = row.querySelector(".variant-images-json");
  let images = [];
  try {
    images = JSON.parse(textarea?.value || "[]");
  } catch {
    images = [];
  }
  const library = listingImageLibrary();
  const indexed = library.map((url, index) => `${index + 1}. ${url}`).join("\n");
  const currentPick = images
    .map((url) => library.findIndex((item) => item === url))
    .filter((index) => index >= 0)
    .map((index) => index + 1)
    .join(",");
  const next = window.prompt(
    `从图片库选择该 SKU 图片（逗号分隔序号，第一张会作为颜色样本）\n\n图片库:\n${indexed}\n\n当前已选: ${currentPick || "无"}`,
    currentPick || "1"
  );
  if (next == null) return;
  const pickedIndex = next.split(/[,\s]+/).map((item) => Number(item.trim())).filter((n) => Number.isInteger(n) && n > 0);
  const list = [...new Set(pickedIndex)].map((n) => library[n - 1]).filter(Boolean);
  if (!list.length) {
    toast("SKU 图片不能为空", "error");
    return;
  }
  textarea.value = JSON.stringify(list);
  const imgBox = row.querySelector(".variant-image-box");
  const sampleBox = row.querySelector(".variant-color-sample");
  const html = `<img class="variant-image" src="${escapeHtml(list[0])}" alt="SKU 图片" />`;
  if (imgBox) imgBox.innerHTML = html;
  if (sampleBox) sampleBox.innerHTML = html;
}

function addBlankVariantRow() {
  const first = document.querySelector("#listingVariantRows tr");
  if (!first) {
    toast("当前没有可复制的变体行", "error");
    return;
  }
  const clone = first.cloneNode(true);
  clone.querySelectorAll("input").forEach((input) => {
    if (input.type === "checkbox") {
      input.checked = true;
    } else if (input.classList.contains("variant-offer-id") || input.id === "listingOfferId") {
      input.value = `${$("#listingParentSku").value.trim() || "SKUlq"}-${Date.now().toString().slice(-5)}`;
      input.removeAttribute("id");
      input.classList.add("variant-offer-id");
    } else if (!input.classList.contains("variant-stock")) {
      input.value = "";
      input.removeAttribute("id");
    }
  });
  clone.querySelectorAll("[id]").forEach((item) => item.removeAttribute("id"));
  $("#listingVariantRows").appendChild(clone);
  bindVariantRowActions();
  bindAttributeValuePickers(clone);
  toast("已添加一行变体");
}

function deleteSelectedVariantRows() {
  const rows = [...document.querySelectorAll("#listingVariantRows tr")];
  const selected = rows.filter((row) => row.querySelector(".variant-row-check")?.checked);
  if (!selected.length) {
    toast("请先勾选要移除的变体", "error");
    return;
  }
  if (selected.length >= rows.length) {
    toast("至少保留一行变体", "error");
    return;
  }
  selected.forEach((row) => row.remove());
  toast("已移除选中变体");
}

function showVariantTips() {
  toast("红色 * 为 Ozon 必填项；动态变体列来自类目属性 is_aspect；下拉值来自 Ozon 中文属性值接口。");
}

function syncLowestPriceVisibility() {
  const enabled = $("#enableLowestPrice")?.checked !== false;
  document.querySelectorAll(".variant-min-price, #listingMinPrice").forEach((input) => {
    input.disabled = !enabled;
    if (!enabled) input.value = "";
    if (enabled && !input.value) {
      const row = input.closest("tr");
      const price = row?.querySelector(".variant-price, #listingPrice")?.value;
      input.value = minimumPriceFromFinalPrice(price);
    }
  });
}

function batchApplyVariantFields(selectors) {
  const rows = [...document.querySelectorAll("#listingVariantRows tr")];
  const firstRow = rows[0];
  if (!firstRow) return;
  selectors.forEach((selector) => {
    const firstValue = firstRow.querySelector(selector)?.value ?? "";
    rows.slice(1).forEach((row) => {
      const input = row.querySelector(selector);
      if (input) input.value = firstValue;
    });
  });
  toast("已批量同步");
}

function variantRussianSuffix(spec, index = 0) {
  const cleaned = cleanSkuSpec(spec)
    .split(/[>;；,，/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const translated = cleaned
    .flatMap((item) => translateVariantPartToRussian(item))
    .filter(Boolean);
  const unique = [...new Set(translated)];
  return (unique.length ? unique : [`вариант-${index + 1}`])
    .join("-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function translateVariantPartToRussian(value) {
  const text = String(value || "").toLowerCase();
  const parts = [];
  const map = [
    [/白/, "белый"],
    [/黑/, "черный"],
    [/灰/, "серый"],
    [/粉/, "розовый"],
    [/枚红|玫红/, "малиновый"],
    [/酒红/, "бордовый"],
    [/宝蓝/, "ярко-синий"],
    [/天蓝|浅蓝/, "голубой"],
    [/藏青|哈青/, "темно-синий"],
    [/深紫|紫/, "фиолетовый"],
    [/卡其/, "хаки"],
    [/驼/, "верблюжий"],
    [/咖啡|棕/, "коричневый"],
    [/橘|橙/, "оранжевый"],
    [/红/, "красный"],
    [/蓝/, "синий"],
    [/可调节/, "регулируемый"],
    [/均码/, "единый-размер"],
    [/一件|1件/, "1шт"],
    [/两件|2件/, "2шт"],
    [/三件|3件/, "3шт"],
  ];
  for (const [regex, word] of map) {
    if (regex.test(text)) parts.push(word);
  }
  if (!parts.length && /\d+/.test(text)) parts.push(text.match(/\d+(?:\.\d+)?/)?.[0]);
  return parts;
}

function warehouseSelectHtml() {
  const select = document.querySelector(".variant-warehouse, #listingWarehouse");
  const selected = select?.value || "";
  const options = [...(select?.options || [])].map((option) =>
    `<option value="${escapeHtml(option.value)}" ${option.value === selected ? "selected" : ""}>${escapeHtml(option.textContent)}</option>`
  ).join("");
  return `<select class="variant-warehouse">${options}</select>`;
}

function cleanSkuSpec(spec) {
  return String(spec || "").replaceAll("&gt;", " > ").replace(/\s+/g, " ").trim();
}

function applyCollectedAttributesToListing(data) {
  const attrs = data.attributes || [];
  const byName = new Map(attrs.map((item) => [normalizeName(item.name), item.value]));
  const lines = attrs.map((item) => `${item.name}: ${item.value}`);
  $("#listingAttributesJson").value = JSON.stringify([], null, 2);

  document.querySelectorAll("#attributeList .attribute-form-row").forEach((row) => {
    const label = row.querySelector("label")?.childNodes?.[0]?.textContent || row.querySelector("label")?.textContent || "";
    const value = byName.get(normalizeName(label)) || guessCollectedAttributeValue(normalizeName(label), byName, data);
    if (value) row.querySelector(".listing-attribute-input").value = value;
  });
}

function normalizeName(value) {
  return String(value || "").replace(/\s|：|:|\*|ID\s*\d+/g, "").toLowerCase();
}

function guessCollectedAttributeValue(name, byName, data) {
  if (/品牌|brand/.test(name)) return byName.get("品牌") || "无品牌";
  if (/颜色|color/.test(name)) return byName.get("颜色") || data.skuVariants?.map((sku) => cleanSkuSpec(sku.spec).split(">")[0]).filter(Boolean).join(", ");
  if (/尺寸|尺码|size/.test(name)) return byName.get("尺寸") || byName.get("尺码");
  if (/材质|material/.test(name)) return byName.get("材质");
  if (/产地|国家|country/.test(name)) return byName.get("产地") || "中国";
  if (isCardMergeModelAttribute(name)) return $("#listingParentSku").value.trim();
  if (/商品名称|标题|^名称$|название|наименование|title/.test(name)) return state.generatedListingContent?.title || data.ozonDraft?.name || data.title;
  return "";
}

function priceItemsFromResponse(data) {
  return data.items || data.result?.items || data.result || [];
}

// Ozon cursors can occasionally repeat the boundary row. Keep the seller's
// accumulated product ledger keyed by a stable product identity so pagination
// cannot inflate rows or status counts. A later page wins for the same key,
// which also lets a refreshed status replace the older boundary copy.
function productRowKey(row = {}, index = 0) {
  const value = row?.product_id || row?.id || row?.productId || row?.offer_id || row?.offerId || row?.sku;
  return String(value || `row:${index}`);
}

function mergeProductRows(existing = [], incoming = []) {
  const rows = Array.isArray(existing) ? existing.slice() : [];
  const indexes = new Map(rows.map((row, index) => [productRowKey(row, index), index]));
  for (const [index, row] of (Array.isArray(incoming) ? incoming : []).entries()) {
    const key = productRowKey(row, rows.length + index);
    if (indexes.has(key)) rows[indexes.get(key)] = row;
    else {
      indexes.set(key, rows.length);
      rows.push(row);
    }
  }
  return rows;
}

function productCountsFromRows(rows = [], total = null) {
  const items = Array.isArray(rows) ? rows : [];
  return {
    all: Number.isFinite(Number(total)) && Number(total) > items.length ? Number(total) : items.length,
    selling: items.filter((item) => item.status_group === "selling").length,
    ready: items.filter((item) => item.status_group === "ready").length,
    error: items.filter((item) => item.status_group === "error").length,
    needFix: items.filter((item) => item.status_group === "needFix").length,
    delisted: items.filter((item) => item.status_group === "delisted").length,
    archived: items.filter((item) => item.status_group === "archived").length,
  };
}

async function loadProducts(options = {}) {
  const append = options.append === true;
  const button = $("#loadProducts");
  const nextButton = $("#productNextPage");
  // Store/search changes invalidate older reads. A slower response must not
  // repaint a different store's product ledger after the switch.
  const requestToken = (state.productRequestToken = Number(state.productRequestToken || 0) + 1);
  const requestStoreId = selectedStoreId();
  setBusy(button, true);
  if (nextButton) setBusy(nextButton, true);
  updateDataFreshness("#productDataFreshness", "loading", "正在读取商品列表和详情；不会修改商品、价格或库存。");
  // Invalidate stock readiness for both first-page and pagination reads.  A
  // request in flight is not current evidence, even when prior rows remain
  // visible while appending the next page.
  state.productReadState = "loading";
  state.productReadCheckedAt = "";
  try {
    if (!append) {
      // A new store/search/filter read invalidates the previous page immediately.
      // Keep stale rows from looking like current evidence while the request is
      // in flight (or when an unknown/empty response arrives).
      state.productRows = [];
      state.productCounts = {};
      state.productReadState = "loading";
      state.productReadCheckedAt = "";
      state.productNextAction = "等待商品列表和详情读取完成。";
      state.productSellerResult = productSellerResultFromRead({}, { readStatus: "unknown", nextAction: "等待商品列表和详情读取完成。" });
      state.productLastId = "";
      state.productHasNext = false;
      if (nextButton) nextButton.disabled = true;
      renderProducts();
    }
    const params = new URLSearchParams({
      storeId: requestStoreId,
      limit: "100",
      query: $("#productSearch").value.trim(),
    });
    if (append && state.productLastId) params.set("lastId", state.productLastId);
    const data = await api(`/api/ozon/product-dashboard?${params}`);
    if (requestToken !== state.productRequestToken) return false;
    state.productRows = append
      ? mergeProductRows(state.productRows, data.products || [])
      : mergeProductRows([], data.products || []);
    state.productLastId = String(data.last_id || "");
    const evidence = data.readEvidence || {};
    const pageCounts = data.counts || {};
    // Recompute status distribution from the de-duplicated ledger. Preserve a
    // server-reported total when it is larger than the currently observed
    // rows, but never sum duplicated boundary pages into the seller counts.
    state.productCounts = productCountsFromRows(state.productRows, pageCounts.all);
    state.productSellerResult = productSellerResultFromRead({
      ...data,
      counts: state.productCounts,
      sellerResult: data.sellerResult || {
        readStatus: evidence.readStatus,
        partial: evidence.partial,
        nextAction: evidence.nextAction,
        sideEffect: evidence.sideEffect,
        evidenceAt: evidence.checkedAt,
        detailProductCount: evidence.detailProductCount,
        loadedProductCount: state.productRows.length,
      },
    }, evidence);
    state.productReadState = String(evidence.readStatus || (evidence.partial ? "partial" : "unknown"));
    state.productReadCheckedAt = String(evidence.checkedAt || "");
    state.productNextAction = String(evidence.nextAction || "查看商品状态并确认读取范围。");
    state.productHasNext = evidence.hasNext === true && Boolean(state.productLastId);
    updateProductCounts(state.productCounts);
    renderProducts();
    showResponse(data);
    const operationEvidenceCount = Array.isArray(evidence.operationEvidence) ? evidence.operationEvidence.length : 0;
    const evidenceText = evidence.partial
      ? `商品同步时间：${formatDateTime(evidence.checkedAt)}；本批证据不完整${evidence.hasNext ? "，仍有下一页" : ""}`
      : (evidence.readStatus === "unknown"
        ? `商品同步时间：${formatDateTime(evidence.checkedAt)}；商品列表响应格式未知，不能判断商品数量`
        : (evidence.readStatus === "empty" ? `商品同步时间：${formatDateTime(evidence.checkedAt)}；当前读取页没有商品，不代表全店没有商品` : `商品同步时间：${formatDateTime(evidence.checkedAt)}；本次读取完整`));
    const evidenceNeedsReview = evidence.partial || evidence.readStatus === "empty" || evidence.readStatus === "unknown";
    updateDataFreshness("#productDataFreshness", evidenceNeedsReview ? "stale" : "success", `${evidenceText}。已记录 ${operationEvidenceCount} 个只读接口证据。下一步：${evidence.nextAction || "查看商品状态"}`);
    toast(evidenceNeedsReview ? "商品读取结果需要补充或确认" : "商品已读取");
    if (nextButton) {
      nextButton.disabled = !state.productHasNext;
      nextButton.title = state.productHasNext ? "继续读取下一页商品；当前列表仍不代表全店范围" : "没有可继续读取的商品页";
    }
  } catch (error) {
    if (requestToken !== state.productRequestToken) return false;
    if (!append) {
      // Do not leave a previous store/search result on screen as current
      // evidence after the first page failed. Already observed pages may stay
      // visible during an append failure, but the banner remains an error.
      state.productRows = [];
      state.productCounts = {};
      state.productReadState = "error";
      state.productReadCheckedAt = "";
      state.productNextAction = sellerReadAccessRecovery(error, Number(error.httpStatus || 0) === 403
        ? "检查店铺授权和当前会话权限后，重新读取商品。"
        : "检查服务连接后重新读取商品。");
      state.productSellerResult = productSellerResultFromRead({ sellerResult: {
        status: "error",
        failed: true,
        reason: sellerReadAccessRecovery(error, Number(error.httpStatus || 0) === 403 ? "当前店铺没有商品读取权限。" : "商品同步服务暂时不可用。"),
        nextAction: state.productNextAction,
        sideEffect: "本次没有修改商品、价格或库存。",
      } });
      state.productLastId = "";
      state.productHasNext = false;
      renderProducts();
    } else {
      // Keep the already observed rows visible, but downgrade the overall
      // evidence when a later page fails.  Leaving `completed` here would
      // make the product ledger (and its stock hints) look current even
      // though the seller has not received the full requested range.  The
      // previous cursor remains intact so the same page can be retried.
      state.productReadState = "partial";
      state.productReadCheckedAt = "";
      state.productNextAction = "重新读取下一页商品；当前已加载商品不能代表完整店铺范围。";
      state.productSellerResult = productSellerResultFromRead({ sellerResult: {
        status: "partial",
        partial: true,
        loadedProductCount: state.productRows.length,
        reason: "下一页商品读取失败；已保留之前读取的商品，但当前结果不能代表完整店铺范围。",
        nextAction: state.productNextAction,
        sellerTasks: [{
          code: "PRODUCT_PAGE_READ_FAILED",
          count: 1,
          nextAction: "重试下一页商品读取；成功后再判断完整商品状态、价格或库存。",
        }],
        sideEffect: "本次没有修改商品、价格或库存；已读取的商品仅作为部分范围保留。",
      } }, { readStatus: "partial", partial: true, nextAction: state.productNextAction });
      renderProducts();
    }
    const failureText = sellerReadAccessRecovery(error, Number(error.httpStatus || 0) === 403
      ? "当前店铺没有商品读取权限，请检查店铺授权。"
      : "商品同步服务暂时不可用，请稍后重试。");
    updateDataFreshness("#productDataFreshness", "error", `商品同步失败；${failureText} 本次没有修改商品、价格或库存。`);
    toast(failureText, "error");
  } finally {
    if (requestToken === state.productRequestToken) {
      setBusy(button, false);
      if (nextButton) {
        setBusy(nextButton, false);
        nextButton.disabled = !state.productHasNext;
      }
    }
  }
}

function updateProductCounts(counts) {
  document.querySelectorAll("#productStatusTabs .product-tab").forEach((tab) => {
    const key = tab.dataset.status;
    const count = counts[key] ?? 0;
    tab.querySelector("span").textContent = count;
  });
}

function productAssetSnapshot() {
  const products = state.productRows || [];
  const archived = products.filter((item) => item.archived || ["archived", "delisted"].includes(item.status_group));
  const selling = products.filter((item) => item.status_group === "selling" && !item.archived);
  const reviewing = products.filter((item) => ["ready", "moderating", "pending"].includes(item.status_group) && !item.archived);
  const actionQueue = products.filter((item) => productAssetIssues(item).length > 0 && !item.archived);
  const priced = products.filter((item) => Number(item.price || 0) > 0);
  const active = products.filter((item) => !item.archived && !["archived", "delisted"].includes(item.status_group));
  const stocked = active.filter((item) => productStockEvidenceState(item) === "positive");
  const stockMissing = active.filter((item) => productStockEvidenceState(item) === "zero");
  const stockUnknown = active.filter((item) => productStockEvidenceState(item) === "unknown");
  return {
    products,
    actionQueue,
    selling,
    reviewing,
    archived,
    priced,
    stocked,
    stockMissing,
    stockUnknown,
  };
}

// An empty ledger is not the same as a clean ledger. During the first load,
// an unknown/partial response, or a failed read, showing zero risks and a
// green "no high-priority risk" message would make the seller believe the
// store was checked successfully. Keep that state explicit until a complete
// read has produced rows (or a confirmed empty result).
function productAssetLedgerState() {
  const readState = String(state.productReadState || "idle");
  const hasRows = Array.isArray(state.productRows) && state.productRows.length > 0;
  if (hasRows) return { known: true, label: "当前已加载商品资产", emptyMessage: "当前筛选范围没有匹配商品。" };
  if (readState === "empty") return { known: false, label: "当前读取范围没有商品", emptyMessage: "当前读取范围没有商品；这不代表全店没有商品。" };
  if (readState === "error") return { known: false, label: "商品读取失败", emptyMessage: "尚无可判定的商品风险；请先修复读取失败。" };
  if (readState === "partial") return { known: false, label: "商品证据不完整", emptyMessage: "尚无可判定的商品风险；请继续读取或补齐详情。" };
  if (readState === "loading") return { known: false, label: "正在读取商品", emptyMessage: "正在读取商品，暂不判断风险。" };
  return { known: false, label: "尚未读取商品", emptyMessage: "尚无可判定的商品风险；先读取商品列表。" };
}

function productStockEvidenceState(item = {}) {
  // A product row can contain a numeric stock copied from a prior/partial
  // Seller response.  It must not enter the stock summary unless the current
  // product read is complete and fresh; otherwise the seller may see a
  // positive quantity for a product whose readiness is unknown or stale.
  const readState = String(state.productReadState || "idle");
  const checkedAt = Date.parse(String(state.productReadCheckedAt || ""));
  const maxAgeMs = 30 * 60 * 1000;
  const fresh = Number.isFinite(checkedAt)
    && checkedAt <= Date.now()
    && Date.now() - checkedAt <= maxAgeMs;
  if (readState !== "completed" || !fresh) return "unknown";
  const raw = item.fbs_stock ?? item.stock;
  if (raw === null || raw === undefined || raw === "") return "unknown";
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return "unknown";
  return numeric > 0 ? "positive" : "zero";
}

function productAssetIssues(item = {}) {
  const issues = [];
  const stockState = productStockEvidenceState(item);
  const price = Number(item.price || 0);
  if (["error", "needFix"].includes(item.status_group) || item.status === "error") issues.push(item.status_group === "needFix" ? "待修改" : "审核/状态错误");
  if (item.errors?.length) issues.push(`错误 ${item.errors.length}`);
  if (stockState === "unknown" && !["archived", "delisted"].includes(item.status_group)) issues.push("库存未知");
  else if (stockState === "zero" && !["archived", "delisted"].includes(item.status_group)) issues.push("缺库存");
  if (price <= 0 && !["archived", "delisted"].includes(item.status_group)) issues.push("缺价格");
  if (!item.image && !["archived", "delisted"].includes(item.status_group)) issues.push("缺主图");
  if (item.reasons?.length) issues.push("有失败原因");
  return [...new Set(issues)];
}

function productAssetNextAction(issues = []) {
  const list = Array.isArray(issues) ? issues : [];
  if (list.some((issue) => /审核|状态|错误|失败/.test(issue))) return "打开审核回执或商品状态详情，按具体 SKU/字段处理。";
  if (list.includes("缺价格")) return "进入上架中心核对售价、采购成本和费用证据，再运行预检。";
  if (list.includes("缺主图")) return "进入上架中心补齐主图和媒体审核，确认后再预检。";
  if (list.some((issue) => /库存/.test(issue))) return "进入库存页重新读取准确仓库库存；商品总览不直接写库存。";
  if (list.length) return "查看商品异常详情并按提示修复；修复后重新预检。";
  return "当前没有待处理异常。";
}

function productAssetCard(label, value, note, tone = "info") {
  return `
    <article class="product-asset-card ${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function productLedgerItemHtml(item, mode = "default") {
  const issues = productAssetIssues(item);
  const issueText = issues.length ? issues.slice(0, 3).join(" / ") : item.status_label || "状态正常";
  const nextAction = productAssetNextAction(issues);
  const price = item.price ? `${formatMoney(item.price)} ${item.currency_code || ""}`.trim() : "未定价";
  const stock = productStockLabel(item);
  const tone = issues.length ? "warning" : mode;
  return `
    <article class="product-ledger-item ${escapeHtml(tone)}">
      <div class="product-ledger-title">
        <strong>${escapeHtml(item.name || item.offer_id || "未命名商品")}</strong>
        <span>${escapeHtml(item.offer_id || item.sku || item.product_id || "-")}</span>
      </div>
      <div class="product-ledger-meta">
        <span>${escapeHtml(item.status_label || item.status_group || "-")}</span>
        <span>${escapeHtml(price)}</span>
        <span>库存 ${escapeHtml(stock)}</span>
      </div>
      <p>${escapeHtml(issueText)}</p>
      <small>下一步：${escapeHtml(nextAction)}；副作用：商品总览只读，不会直接修改 Ozon。</small>
    </article>
  `;
}

function productLedgerEmpty(message) {
  return `<p class="product-ledger-empty">${escapeHtml(message)}</p>`;
}

function renderProductAssetLedger() {
  const summary = $("#productAssetSummary");
  if (!summary) return;
  const snapshot = productAssetSnapshot();
  const ledgerState = productAssetLedgerState();
  const missingPrice = snapshot.products.length - snapshot.priced.length;
  const missingStock = snapshot.stockMissing.length;
  const unknownStock = snapshot.stockUnknown.length;
  const currentProductTask = latestCurrentProductTask();
  summary.innerHTML = [
    renderCurrentProductTaskReminder(currentProductTask, { placement: "products" }),
    productAssetCard("商品总数", ledgerState.known ? snapshot.products.length : "待确认", ledgerState.label, "info"),
    productAssetCard("待处理", ledgerState.known ? snapshot.actionQueue.length : "—", "错误、待修改、缺价或缺库存", ledgerState.known && snapshot.actionQueue.length ? "warning" : ledgerState.known ? "success" : "warning"),
    productAssetCard("在售商品", ledgerState.known ? snapshot.selling.length : "—", "正在产生经营结果的商品", ledgerState.known ? "success" : "warning"),
    productAssetCard("缺库存/未知库存", ledgerState.known ? `${Math.max(0, missingStock)} / ${Math.max(0, unknownStock)}` : "待确认", ledgerState.known ? `未知库存不能按 0 推导；价格缺口 ${Math.max(0, missingPrice)} 个` : ledgerState.label, ledgerState.known && (missingStock || unknownStock || missingPrice) ? "warning" : ledgerState.known ? "success" : "warning"),
    productAssetCard("审核/归档", ledgerState.known ? `${snapshot.reviewing.length} / ${snapshot.archived.length}` : "待确认", "提交回执和非在售资产分开看", "info"),
  ].join("");

  const groups = [
    ["#productAssetActionQueue", snapshot.actionQueue, ledgerState.known ? "当前没有高优先级商品风险。" : ledgerState.emptyMessage, "warning"],
    ["#productSellingLedger", snapshot.selling, ledgerState.known ? "当前没有加载到在售商品。" : ledgerState.emptyMessage, "success"],
    ["#productReviewLedger", snapshot.reviewing, ledgerState.known ? "当前没有待上架或审核中的商品。" : ledgerState.emptyMessage, "info"],
    ["#productArchivedLedger", snapshot.archived, ledgerState.known ? "当前没有下架或归档商品。" : ledgerState.emptyMessage, "muted"],
  ];
  groups.forEach(([selector, rows, emptyText, mode]) => {
    const box = $(selector);
    if (!box) return;
    box.innerHTML = rows.length
      ? rows.slice(0, 6).map((item) => productLedgerItemHtml(item, mode)).join("")
      : productLedgerEmpty(emptyText);
  });
}

function renderProducts() {
  const rows = state.productStatus === "all"
    ? state.productRows
    : state.productRows.filter((item) => item.status_group === state.productStatus);

  renderProductSellerResult();
  renderProductAssetLedger();
  if (rows.length) {
    $("#productsTable").innerHTML = rows.map(productRowHtml).join("");
    return;
  }
  // A successful read with zero rows after a status/search filter is a
  // business "filter empty" state, not an empty store. Keep that distinction
  // visible so an operator knows to change the filter rather than re-authorize
  // the shop or infer that all products disappeared.
  const filterEmpty = rows.length === 0 && state.productRows.length > 0;
  const messages = {
    idle: "商品状态尚未读取；先点击“刷新商品”获取当前店铺商品。",
    loading: "正在读取商品列表和详情；旧数据已清除。",
    unknown: "商品读取结果未知，不能判断店铺商品数量。请重试或检查 Seller API 版本。",
    partial: "商品证据不完整。请继续读取下一页或补齐缺失详情后再判断。",
    empty: "当前读取页没有商品；请结合筛选条件和分页结果判断，不代表全店没有商品。",
    error: "商品读取失败；请按上方提示检查权限或连接后重试。",
    completed: "本次读取没有可展示商品。",
  };
  const message = filterEmpty ? "当前筛选没有匹配的商品。" : (messages[state.productReadState] || "没有可展示的商品。");
  const nextAction = filterEmpty
    ? "清除关键词或切换状态筛选后再查看；不会修改商品。"
    : (state.productNextAction || (state.productReadState === "idle" ? "点击“刷新商品”" : "重新读取商品"));
  $("#productsTable").innerHTML = `<tr><td colspan="9" class="product-empty" data-product-empty-state="${filterEmpty ? "filter" : escapeHtml(state.productReadState || "unknown")}">${escapeHtml(message)}<br><small>下一步：${escapeHtml(nextAction)}</small></td></tr>`;
}

function productStockLabel(item = {}) {
  // The product overview may retain a numeric stock from an older or partial
  // Seller response. Do not show that number as current inventory until the
  // list read is complete and fresh; the warehouse page is the editing/read
  // entry point for an explicit tuple snapshot and dry-run.
  if (productStockEvidenceState(item) === "unknown") return "未知";
  const raw = item.fbs_stock ?? item.stock;
  if (raw === null || raw === undefined || raw === "") return "未知";
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? String(numeric) : "未知";
}

function productStockReadinessClaim(item = {}) {
  const status = String(item.status_group || item.status || "").trim().toLowerCase();
  const itemVerification = String(item.readinessVerificationLevel || item.verificationLevel || item.statusVerificationLevel || "").trim().toLowerCase();
  const verification = itemVerification || (state.productSellerResult?.liveReadObserved === true ? "server_observed" : "");
  const checkedAt = Date.parse(String(state.productReadCheckedAt || ""));
  const fresh = Number.isFinite(checkedAt)
    && checkedAt <= Date.now()
    && Date.now() - checkedAt <= 30 * 60 * 1000;
  const readyStatus = ["selling", "ready_for_sale"].includes(status);
  return state.productReadState === "completed"
    && fresh
    && (status === "selling" || readyStatus)
    && verification === "server_observed"
    && item.visible !== false;
}

function productRowHtml(item) {
  const priceEvidenceReady = state.productReadState === "completed"
    && state.productSellerResult?.coverageComplete === true;
  const price = priceEvidenceReady && item.price !== null && item.price !== undefined && item.price !== ""
    ? `${formatMoney(item.price)} ${item.currency_code}`
    : "未知";
  const oldPrice = item.old_price ? `划线价 ${formatMoney(item.old_price)}` : "没有指数";
  const priceSourceNote = priceEvidenceReady
    ? "Seller API 当前读取价；不含采购成本、佣金、物流或利润"
    : "价格读取证据不完整或覆盖未完成；不能作为当前售价或利润结论";
  const image = item.image
    ? `<img class="product-photo" src="${item.image}" alt="${escapeHtml(item.name)}" />`
    : `<div class="photo-placeholder">＋</div>`;
  const reason = item.reasons?.[0] || item.status_description || "";
  const marker = item.errors?.length ? `错误 ${item.errors.length}` : "添加";
  const stockEvidenceState = productStockEvidenceState(item);
  const stockNote = stockEvidenceState === "unknown"
    ? "当前库存证据未知；去库存页重新读取"
    : `预留 ${item.reserved ?? 0}`;
  const assetIssues = productAssetIssues(item);
  const nextAction = productAssetNextAction(assetIssues);
  const productStatusLabel = state.productReadState === "completed"
    ? (item.visible === false ? "不可见" : (item.status_label || "状态未知"))
    : state.productReadState === "partial"
      ? "状态未完整"
      : state.productReadState === "loading"
        ? "正在读取"
        : "状态未知";

  return `
    <tr>
      <td><input type="checkbox" /></td>
      <td>${image}</td>
      <td>
        <div class="product-offer">
          <strong>${escapeHtml(item.offer_id || "-")}</strong>
          <span>SKU ${item.sku || "-"}</span>
          <span>Product ID ${item.product_id || "-"}</span>
        </div>
      </td>
      <td>
        <div class="product-title">
          <strong>${escapeHtml(item.name || item.offer_id || "-")}</strong>
          <span>${item.archived ? "已归档" : "商品卡片"}</span>
        </div>
      </td>
      <td>
        <span class="status-pill ${state.productReadState === "completed" && item.visible !== false ? item.status_group : "unknown"}"
          title="${escapeHtml(state.productReadState === "completed" ? (item.visible === false ? "当前商品对买家不可见" : "当前读取批次的商品状态") : "当前商品列表读取未完整，旧状态不作可售结论")}">${escapeHtml(productStatusLabel)}</span>
        <div class="status-sub">${escapeHtml(reason)}</div>
        <div class="status-sub">下一步：${escapeHtml(nextAction)}；副作用：商品总览只读。</div>
      </td>
      <td><strong>${escapeHtml(marker)}</strong></td>
      <td>
        <div class="price-cell">
          <strong>${price}</strong>
          <span class="price-index">${oldPrice}</span>
          <span class="price-source-note">${escapeHtml(priceSourceNote)}</span>
        </div>
      </td>
      <td>${escapeHtml(productStockLabel(item))}<div class="status-sub">${escapeHtml(stockNote)}</div></td>
      <td>
        <div class="row-actions">
          <button class="icon-button" title="商品总览只读；去上架中心编辑" aria-label="商品总览只读" disabled>只读</button>
          ${item.offer_id ? (productStockReadinessClaim(item)
             ? `<button class="icon-button" type="button" data-product-stock-offer="${escapeHtml(item.offer_id)}" data-stock-readiness-ready="true" data-stock-readiness-fresh="true" data-stock-readiness-status="ready_for_sale" data-stock-readiness-verification="server_observed" title="只读核对该 Offer 的库存">库存核对</button>`
             : `<button class="icon-button" type="button" data-product-stock-offer="${escapeHtml(item.offer_id)}" data-stock-readiness-status="${escapeHtml(String(item.status_group || item.status || "unknown"))}" data-stock-readiness-verification="${escapeHtml(String(item.readinessVerificationLevel || item.verificationLevel || "unknown"))}" title="商品状态未形成可售证据；先回查商品状态">查看状态/修复商品</button>`
          ) : ""}
          <button class="icon-button" title="更多">⋮</button>
        </div>
      </td>
    </tr>
  `;
}

async function loadPromotions() {
  const button = $("#loadPromotions");
  const requestToken = Number(state.promotionRequestToken || 0) + 1;
  state.promotionRequestToken = requestToken;
  const requestStoreId = String(selectedStoreId() || "").trim();
  const environmentCheck = validateReadOperatorEnvironment(currentSellerReadEnvironment());
  if (!environmentCheck.ok) {
    state.promotionRows = [];
    state.promotionEvidence = { failed: true, loading: false, checkedAt: "", count: 0, readStatus: "unknown", coverageComplete: false, partial: true, environment: "", readOnly: true };
    renderPromotions();
    toast(environmentCheck.message, "warning");
    return;
  }
  const requestEnvironment = environmentCheck.environment;
  setBusy(button, true);
  // A store/filter refresh invalidates the previous activity evidence at the
  // moment the request starts.  Keeping old cards clickable while the new
  // read is in flight lets a seller open an activity from another store (or
  // an expired page) and mistake it for current evidence.
  state.promotionRows = [];
  state.selectedPromotion = null;
  state.promotionProducts = [];
  state.promotionCandidates = [];
  state.promotionSelectedProductIds = [];
  state.promotionImpactPreview = null;
  state.promotionDetailError = "";
  state.promotionEvidence = {
    checkedAt: "",
    count: 0,
    readStatus: "unknown",
    partial: false,
    coverageComplete: false,
    readOnly: true,
    loading: true,
  };
  state.promotionMutationEvidence = null;
  state.promotionDetailSellerResult = { products: null, candidates: null };
  state.promotionDetailOffset = 0;
  state.promotionDetailHasNext = false;
  renderPromotions();
  updateDataFreshness("#promotionDataFreshness", "loading", "正在读取活动和活动商品；不会修改活动商品。");
  try {
    const data = await api(`/api/ozon/actions?storeId=${encodeURIComponent(requestStoreId)}`);
    if (requestToken !== state.promotionRequestToken) return;
    const responseStoreId = String(data.storeId || "").trim();
    if (!responseStoreId || responseStoreId !== requestStoreId || String(data.environment || "").trim() !== requestEnvironment) {
      const error = new Error("活动读取范围已变化，请重新读取当前店铺。操作者不会看到旧活动数据。");
      error.httpStatus = 409;
      throw error;
    }
    state.promotionRows = normalizeOzonList(data, ["actions", "items"]);
    state.promotionSellerResult = data.sellerResult || null;
    // The number of rows is not a coverage signal.  A non-empty first page
    // can still be partial (or have an unknown server total), so retain the
    // server-side seller result as the source of truth for the activity list.
    const sellerStatus = String(data.sellerResult?.status || "");
    state.promotionEvidence = {
      checkedAt: new Date().toISOString(),
      environment: requestEnvironment,
      count: state.promotionRows.length,
      operationEvidence: Array.isArray(data.operationEvidence) ? [data.operationEvidence] : [],
      readStatus: sellerStatus || (state.promotionRows.length ? "completed" : "empty"),
      partial: data.partial === true || sellerStatus === "partial",
      coverageComplete: data.sellerResult?.coverageComplete === true,
      coverageText: data.sellerResult?.coverageText || "",
      readOnly: true,
    };
    renderPromotions();
    showResponse(data);
    const evidenceState = state.promotionEvidence.partial || !state.promotionEvidence.coverageComplete || ["unknown", "empty"].includes(state.promotionEvidence.readStatus) ? "stale" : "success";
    const message = state.promotionEvidence.partial
      ? "活动读取不完整；不能据此判断活动商品范围。"
      : !state.promotionEvidence.coverageComplete
        ? "活动返回了记录，但完整覆盖证据缺失；不能据此判断全店活动。"
      : state.promotionEvidence.readStatus === "unknown"
        ? "活动返回了记录，但服务端覆盖范围未知；不能据此判断全店活动。"
      : state.promotionEvidence.readStatus === "empty"
        ? "本次店铺没有返回活动证据；请确认筛选范围和店铺权限。"
        : `活动同步时间：${formatDateTime(state.promotionEvidence.checkedAt)} · ${state.promotionEvidence.coverageText || `已读取 ${state.promotionRows.length} 个活动`}`;
    updateDataFreshness("#promotionDataFreshness", evidenceState, message);
    const coverageWarning = state.promotionEvidence.partial || !state.promotionEvidence.coverageComplete || ["unknown", "empty"].includes(state.promotionEvidence.readStatus);
    toast(coverageWarning ? message : `已读取 ${state.promotionRows.length} 个 Ozon 促销活动`, coverageWarning ? "warning" : "ok");
  } catch (error) {
    state.promotionRows = [];
    state.promotionSellerResult = { status: "unknown", nextAction: "检查店铺只读连接后重新读取活动。", sideEffect: "未展示旧活动状态；不会修改活动商品。" };
    state.selectedPromotion = null;
    state.promotionProducts = [];
    state.promotionCandidates = [];
    state.promotionDetailSellerResult = { products: null, candidates: null };
    state.promotionMutationEvidence = null;
    state.promotionEvidence = { failed: true, checkedAt: new Date().toISOString(), count: 0, operationEvidence: [], readOnly: true };
    renderPromotions();
    updateDataFreshness("#promotionDataFreshness", "error", "活动同步失败；未展示旧活动状态，请检查店铺只读连接后重试。");
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function renderPromotions() {
  const container = $("#promotionList");
  if (!container) return;
  if (!state.promotionRows.length) {
    const sellerStatus = String(state.promotionSellerResult?.status || state.promotionEvidence?.readStatus || "unknown");
    const message = state.promotionEvidence?.failed
      ? "活动读取失败，未展示旧活动状态；请重新读取。"
      : state.promotionEvidence?.loading
        ? "正在读取当前店铺活动；旧活动已清除，读取完成前不能判断活动范围。"
      : state.promotionEvidence?.partial
        ? "活动读取不完整，暂不展示活动范围；请重新读取。"
        : state.promotionEvidence?.coverageComplete !== true || sellerStatus === "unknown"
          ? "活动读取结果缺少完整覆盖信息，不能判断店铺是否没有活动；请检查分页或重新读取。"
          : "当前读取范围没有返回促销活动。";
    container.innerHTML = `<p class="hint">${escapeHtml(message)}</p>`;
    renderPromotionDetail();
    return;
  }
  container.innerHTML = state.promotionRows.map((action) => {
    const id = promotionId(action);
    const selected = id && promotionId(state.selectedPromotion || {}) === id;
    const coverageComplete = state.promotionSellerResult?.coverageComplete === true
      && state.promotionEvidence?.coverageComplete === true;
    const productCount = coverageComplete
      ? (action.participating_products_count ?? action.products_count ?? action.product_count ?? "-")
      : "未知（范围未完成）";
    const candidateCount = coverageComplete
      ? (action.potential_products_count ?? action.candidates_count ?? action.candidate_count ?? "-")
      : "未知（范围未完成）";
    return `
      <button class="promotion-card ${selected ? "active" : ""}" type="button" data-action-id="${id}">
        <span>${escapeHtml(promotionPeriod(action))}</span>
        <strong>${escapeHtml(promotionTitle(action))}</strong>
        <small>活动商品 ${escapeHtml(productCount)} / 可添加 ${escapeHtml(candidateCount)}</small>
      </button>
    `;
  }).join("");
  container.querySelectorAll(".promotion-card").forEach((card) => {
    card.addEventListener("click", () => selectPromotion(Number(card.dataset.actionId)));
  });
}

async function selectPromotion(actionId) {
  const action = state.promotionRows.find((item) => promotionId(item) === actionId);
  if (!action) return;
  state.selectedPromotion = action;
  state.promotionProductKind = "products";
  // The detail request is scoped to the newly selected activity. Clear the
  // previous activity's rows before showing the loading state so a seller
  // cannot mistake stale products/candidates for the new activity.
  state.promotionProducts = [];
  state.promotionCandidates = [];
  state.promotionSelectedProductIds = [];
  state.promotionDetailSellerResult = { products: null, candidates: null };
  state.promotionImpactPreview = null;
  state.promotionDetailError = "";
  state.promotionMutationEvidence = null;
  renderPromotions();
  renderPromotionDetail(true);
  await loadPromotionProducts(actionId);
}

async function loadPromotionProducts(actionId = promotionId(state.selectedPromotion || {}), options = {}) {
  if (!actionId) return;
  const requestToken = Number(state.promotionDetailRequestToken || 0) + 1;
  state.promotionDetailRequestToken = requestToken;
  const requestStoreId = String(selectedStoreId() || "").trim();
  const environmentCheck = validateReadOperatorEnvironment(currentSellerReadEnvironment());
  if (!environmentCheck.ok) return;
  const requestEnvironment = environmentCheck.environment;
  state.promotionDetailError = "";
  const offset = Math.max(0, Number(options.offset ?? state.promotionDetailOffset ?? 0));
  const append = offset > 0;
  try {
    const [productsData, candidatesData] = await Promise.all([
      api("/api/ozon/actions/products", {
        method: "POST",
        body: JSON.stringify({ storeId: selectedStoreId(), action_id: actionId, limit: 1000, offset }),
      }),
      api("/api/ozon/actions/candidates", {
        method: "POST",
        body: JSON.stringify({ storeId: selectedStoreId(), action_id: actionId, limit: 1000, offset }),
      }),
    ]);
    // A seller can switch activities while the previous read is still in
    // flight. Do not let a late response repaint the newly selected activity.
    if (requestToken !== state.promotionDetailRequestToken || promotionId(state.selectedPromotion || {}) !== actionId || String(selectedStoreId() || "").trim() !== requestStoreId || String(currentSellerReadEnvironment() || "").trim() !== requestEnvironment) return;
    const productStoreId = String(productsData.storeId || "").trim();
    const candidateStoreId = String(candidatesData.storeId || "").trim();
    if (!productStoreId || productStoreId !== requestStoreId || !candidateStoreId || candidateStoreId !== requestStoreId
      || String(productsData.environment || "").trim() !== requestEnvironment
      || String(candidatesData.environment || "").trim() !== requestEnvironment) {
      throw Object.assign(new Error("活动商品读取范围已变化，请重新读取当前店铺。操作者不会看到旧店铺商品。"), { httpStatus: 409 });
    }
    const pageProducts = normalizeOzonList(productsData, ["products", "items"]);
    const pageCandidates = normalizeOzonList(candidatesData, ["products", "items", "candidates"]);
    const mergeRows = (previous, page) => {
      const rows = [...(append ? previous : []), ...page];
      const seen = new Set();
      return rows.filter((row, index) => {
        const key = String(row.product_id || row.id || row.productId || row.offer_id || `${offset}:${index}`);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    state.promotionProducts = mergeRows(state.promotionProducts, pageProducts);
    state.promotionCandidates = mergeRows(state.promotionCandidates, pageCandidates);
    const pageHasNext = [productsData.sellerResult, candidatesData.sellerResult]
      .some((result) => result?.status === "partial" || result?.nextOffset !== null && result?.nextOffset !== undefined);
    state.promotionDetailOffset = offset;
    state.promotionDetailHasNext = pageHasNext;
    const availableIds = new Set(state.promotionProducts
      .map((item) => Number(item.product_id || item.id || item.productId))
      .filter(Boolean));
    state.promotionSelectedProductIds = (state.promotionSelectedProductIds || [])
      .filter((id) => availableIds.has(Number(id)));
    const resultWithAccumulatedCoverage = (result, pageRows) => {
      if (!result) return { status: "unknown", nextAction: "活动证据未返回，请重新读取。" };
      const observed = offset + pageRows.length;
      return {
        ...result,
        offset,
        coverageText: result.total === null || result.total === undefined
          ? `已读取至少 ${observed} 条，服务端总量未知`
          : `已读取 ${Math.min(observed, Number(result.total))} / ${Number(result.total)} 条`,
      };
    };
    state.promotionDetailSellerResult = {
      products: resultWithAccumulatedCoverage(productsData.sellerResult, state.promotionProducts),
      candidates: resultWithAccumulatedCoverage(candidatesData.sellerResult, state.promotionCandidates),
    };
    // Do not promote a partial/unknown page's discount arithmetic into the
    // finance domain. Activity price impact is a comparison aid only after
    // the Seller API confirms the selected activity's product scope.
    state.promotionImpactPreview = productsData.sellerResult?.coverageComplete === true
      ? productsData.impactPreview || null
      : null;
    const verifyIds = Array.isArray(options.verifyRemovedProductIds)
      ? options.verifyRemovedProductIds.map((id) => Number(id)).filter(Boolean)
      : [];
    if (verifyIds.length) {
      const remainingIds = new Set(state.promotionProducts
        .map((item) => Number(item.product_id || item.id || item.productId))
        .filter(Boolean));
      const remaining = verifyIds.filter((id) => remainingIds.has(id));
    const partial = productsData.partial === true || candidatesData.partial === true;
    state.promotionMutationEvidence = {
        ...(state.promotionMutationEvidence || {}),
        status: state.promotionMutationEvidence?.writeStatus === "needs_review"
          ? "needs_review"
          : (!partial && remaining.length === 0 ? "server_observed" : "needs_review"),
        checkedAt: new Date().toISOString(),
        requestedProductIds: verifyIds,
        remainingProductIds: remaining,
        partial,
        readback: true,
      };
    }
    showResponse({ products: productsData, candidates: candidatesData });
    renderPromotionDetail();
  } catch (error) {
    if (requestToken !== state.promotionDetailRequestToken || promotionId(state.selectedPromotion || {}) !== actionId || String(selectedStoreId() || "").trim() !== requestStoreId) return;
    state.promotionDetailError = Number(error.httpStatus || 0) === 403
      ? "当前店铺无权读取该活动商品，请检查店铺授权。"
      : "活动商品读取失败，未能确认参加商品或可添加商品；请重试。";
    state.promotionProducts = [];
    state.promotionCandidates = [];
    state.promotionSelectedProductIds = [];
    state.promotionDetailSellerResult = {
      products: { status: "unknown", nextAction: "活动商品读取失败，请重试。" },
      candidates: { status: "unknown", nextAction: "可添加商品读取失败，请重试。" },
    };
    state.promotionDetailHasNext = false;
    state.promotionImpactPreview = null;
    renderPromotionDetail();
    if (Array.isArray(options.verifyRemovedProductIds) && options.verifyRemovedProductIds.length) {
      state.promotionMutationEvidence = {
        ...(state.promotionMutationEvidence || {}),
        status: "needs_review",
        checkedAt: new Date().toISOString(),
        readback: false,
        error: error.message,
      };
      renderPromotionDetail();
    }
    toast(error.message, "error");
  }
}

function renderPromotionDetail(loading = false) {
  const action = state.selectedPromotion;
  $("#promotionDetailTitle").textContent = action ? promotionTitle(action) : "请选择一个活动";
  $("#promotionDetailMeta").textContent = action ? `活动 ID ${promotionId(action)} / ${promotionPeriod(action)}` : "可查看正在参加和可加入商品。";
  const sellerResultNode = $("#promotionSellerResult");
  if (sellerResultNode) {
    const results = [state.promotionSellerResult, state.promotionDetailSellerResult?.products, state.promotionDetailSellerResult?.candidates]
      .filter((result) => result && typeof result === "object");
    const statuses = [...new Set(results.map((result) => String(result.status || "unknown")))];
    const statusLabel = { complete: "已完成读取", partial: "部分读取", empty: "当前范围为空", unknown: "覆盖范围未知" };
    const nextAction = results.find((result) => result.status === "partial" || result.status === "unknown")?.nextAction
      || results[0]?.nextAction || "先读取活动，系统不会修改活动商品。";
    const coverage = results.map((result) => result.coverageText).filter(Boolean).join(" / ");
    sellerResultNode.textContent = `证据状态：${statuses.map((status) => statusLabel[status] || status).join(" / ")}${coverage ? ` · 覆盖：${coverage}` : ""} · 下一步：${nextAction} · ${results[0]?.sideEffect || "仅读取，不加入/移出活动，不修改价格、库存或订单。"}`;
  }
  const mutation = state.promotionMutationEvidence;
  const mutationStatus = mutation?.status === "server_observed"
    ? `移出回读已确认：${mutation.requestedProductIds.length} 个商品不再参加活动`
    : mutation?.status === "needs_review"
      ? `移出结果待复核：仍返回 ${mutation.remainingProductIds?.length || 0} 个商品，或回读不完整`
      : mutation?.status === "pending"
        ? "移出请求已提交，正在读取活动商品确认结果"
        : "";
  const mutationNode = $("#promotionMutationStatus");
  if (mutationNode) mutationNode.textContent = mutationStatus;
  const impactNode = $("#promotionImpactPreview");
  const impact = state.promotionImpactPreview;
  if (impactNode) impactNode.textContent = loading
    ? "活动价格影响：读取中；利润仍需成本、物流、佣金证据。"
    : state.promotionDetailError
      ? `活动商品读取失败：${state.promotionDetailError} 利润和活动范围均未确认。`
    : impact
      ? `活动价格影响：${impact.knownPriceCount || 0} 个商品可比较，${impact.unknownPriceCount || 0} 个价格未知；平均降幅 ${impact.averageReductionPercent === null ? "未知" : `${impact.averageReductionPercent}%`}。利润不可仅凭活动接口判断。`
      : "活动价格影响：尚未读取；利润仍需成本、物流、佣金证据。";
  const paginationNode = $("#promotionPaginationControls");
  if (paginationNode) {
    paginationNode.innerHTML = state.promotionDetailHasNext
      ? `<button type="button" class="ghost" data-load-promotion-next ${loading ? "disabled" : ""}>继续读取下一页活动商品</button><small>当前已累计显示 ${state.promotionProducts.length} 个活动商品、${state.promotionCandidates.length} 个可添加商品；仍是只读读取。</small>`
      : (state.promotionDetailOffset > 0
        ? `<small>已读取到当前活动分页末端；累计显示 ${state.promotionProducts.length} 个活动商品、${state.promotionCandidates.length} 个可添加商品。</small>`
        : "");
    paginationNode.querySelector("[data-load-promotion-next]")?.addEventListener("click", () => {
      loadPromotionProducts(promotionId(state.selectedPromotion || {}), { offset: state.promotionDetailOffset + 1000 });
    });
  }
  $("#promotionProductCount").textContent = loading ? "读取中" : String(state.promotionProducts.length || 0);
  $("#promotionCandidateCount").textContent = loading ? "读取中" : String(state.promotionCandidates.length || 0);
  $("#promotionProductsTabCount").textContent = String(state.promotionProducts.length || 0);
  $("#promotionCandidatesTabCount").textContent = String(state.promotionCandidates.length || 0);
  $("#promotionStatus").textContent = action?.is_participating === true ? "已参加" : (action?.status || action?.state || "-");
  const selectedCount = Array.isArray(state.promotionSelectedProductIds) ? state.promotionSelectedProductIds.length : 0;
  const removeButton = $("#removePromotionProducts");
  removeButton.disabled = !action || selectedCount === 0 || loading;
  removeButton.textContent = selectedCount ? `移出已选 ${selectedCount} 个商品（确认后写入）` : "先选择活动商品再移出";
  renderPromotionProductRows();
}

function renderPromotionProductRows() {
  const rows = state.promotionProductKind === "candidates" ? state.promotionCandidates : state.promotionProducts;
  const body = $("#promotionProductRows");
  if (state.promotionDetailError) {
    body.innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(state.promotionDetailError)} 当前没有可安全操作的活动商品。</td></tr>`;
    return;
  }
  if (!rows.length) {
    const sellerResult = state.promotionDetailSellerResult?.[state.promotionProductKind] || {};
    const status = String(sellerResult.status || "unknown");
    const emptyText = status === "empty"
      ? "当前活动读取范围没有商品。"
      : status === "partial"
        ? "活动商品读取不完整，不能判断当前活动没有商品；请继续读取下一页。"
        : status === "error"
          ? "活动商品读取失败，不能判断当前活动没有商品；请重新读取。"
          : "活动商品读取范围未知，不能判断当前活动没有商品。";
    const nextAction = String(sellerResult.nextAction || "").trim();
    body.innerHTML = `<tr><td colspan="9" class="empty">${emptyText}${nextAction ? `<br><small>下一步：${escapeHtml(nextAction)}</small>` : ""}</td></tr>`;
    return;
  }
  const impactByProductId = new Map((state.promotionImpactPreview?.products || [])
    .map((item) => [String(item.productId || ""), item]));
  body.innerHTML = rows.map((item) => {
    const productId = item.product_id || item.id || item.productId || "";
    // Ozon old_price is the original/strikethrough price, not the current
    // selling price. Keep the table unknown when no explicit current price
    // was returned instead of displaying old_price under the current-price
    // column.
    const price = item.current_price || item.currentPrice || item.price || "";
    // Range fields (min_price/max_action_price) are constraints, not an
    // observed activity selling price. Showing one as “活动价” makes the
    // seller believe a discount was verified when the API only returned a
    // bound. Keep the comparison unknown until an explicit action price is
    // present.
    const actionPrice = item.action_price || item.discount_price || "";
    const discount = item.discount || item.discount_percent || item.discount_value || "";
    const impact = impactByProductId.get(String(productId));
    // Show the seller the comparable price impact rather than exposing a
    // raw platform discount field as if it were a validated discount.
    // Missing prices remain explicitly unknown and never become a profit
    // conclusion.
    const impactLabel = impact?.impact === "known"
      ? `降幅 ${impact.reductionPercent}%`
      : impact?.impact === "unknown"
        ? "未知（缺当前价或活动价）"
        : discount ? `平台折扣 ${discount}` : "未知";
    const selected = state.promotionProductKind === "products"
      && (state.promotionSelectedProductIds || []).includes(Number(productId));
    return `
      <tr>
        <td>${state.promotionProductKind === "products" ? `<input type="checkbox" class="promotion-product-select" data-product-id="${escapeHtml(productId)}" ${selected ? "checked" : ""} aria-label="选择商品 ${escapeHtml(productId)}" />` : "-"}</td>
        <td>${escapeHtml(productId)}</td>
        <td>${escapeHtml(item.offer_id || item.offerId || "-")}</td>
        <td>${escapeHtml(item.name || item.title || "-")}</td>
        <td>${price ? escapeHtml(price) : "-"}</td>
        <td>${actionPrice ? escapeHtml(actionPrice) : "-"}</td>
        <td>${escapeHtml(impactLabel)}</td>
        <td>${escapeHtml(item.status || item.state || item.action_status || (state.promotionProductKind === "candidates" ? "候选待人工确认" : "-"))}${state.promotionProductKind === "candidates" ? `<div class="status-sub">本页只读；加入活动需在 Ozon 活动页人工确认</div>` : ""}</td>
        <td>${item.offer_id || item.offerId ? `<button class="ghost" type="button" data-promotion-stock-offer="${escapeHtml(item.offer_id || item.offerId)}" data-stock-readiness-status="unknown" data-stock-readiness-verification="unknown" title="活动商品列表不提供当前可售证据；先回查商品状态">库存核对（先确认可售）</button>` : (state.promotionProductKind === "candidates" ? "本页不执行加入" : "-")}</td>
      </tr>
    `;
  }).join("");
  body.querySelectorAll(".promotion-product-select").forEach((input) => {
    input.addEventListener("change", () => {
      const id = Number(input.dataset.productId);
      const current = new Set((state.promotionSelectedProductIds || []).map(Number));
      if (input.checked) current.add(id); else current.delete(id);
      state.promotionSelectedProductIds = [...current].filter(Boolean);
      renderPromotionDetail();
    });
  });
}

async function removePromotionProducts() {
  const actionId = promotionId(state.selectedPromotion || {});
  const productIds = (state.promotionSelectedProductIds || []).map((id) => Number(id)).filter(Boolean);
  if (!actionId || !productIds.length) {
    toast("请先选择要移出的活动商品", "error");
    return;
  }
  const title = promotionTitle(state.selectedPromotion);
  const ok = window.confirm(`确认从活动「${title}」中删除 ${productIds.length} 个商品吗？这个动作会真实提交到 Ozon。`);
  if (!ok) return;
  const button = $("#removePromotionProducts");
  setBusy(button, true);
  state.promotionMutationEvidence = {
    status: "pending",
    requestedProductIds: productIds,
    remainingProductIds: [],
    readback: false,
  };
  renderPromotionDetail();
  try {
    const data = await api("/api/ozon/actions/products/deactivate", {
      method: "POST",
      ...directWriteRequest({ storeId: selectedStoreId(), action_id: actionId, product_ids: productIds, confirmPromotionWrite: true }, "promotion-deactivate"),
    });
    if (data?.commandState === "needs_review" || data?.status === "unknown_outcome") {
      state.promotionMutationEvidence.writeStatus = "needs_review";
    }
    showResponse(data);
    toast("已提交移出请求，正在回读活动商品确认结果");
    await loadPromotionProducts(actionId, { verifyRemovedProductIds: productIds });
    if (state.promotionMutationEvidence?.status === "server_observed") {
      toast("移出活动回读已确认", "ok");
    } else {
      toast("移出活动结果待复核；请不要重复提交", "warning");
    }
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function formatMoney(value) {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeOzonList(data, keys = []) {
  const candidates = [
    data,
    data?.result,
    ...keys.map((key) => data?.[key]),
    ...keys.map((key) => data?.result?.[key]),
  ];
  return candidates.find((item) => Array.isArray(item)) || [];
}

function promotionTitle(action = {}) {
  return action.title || action.name || action.action_name || action.description || `活动 ${action.id || action.action_id || ""}`;
}

function promotionId(action = {}) {
  return Number(action.id || action.action_id || action.actionId || 0);
}

function promotionDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("zh-CN");
}

function promotionPeriod(action = {}) {
  const start = promotionDate(action.date_start || action.start_date || action.starts_at || action.dateStart);
  const end = promotionDate(action.date_end || action.end_date || action.ends_at || action.dateEnd);
  return [start, end].filter(Boolean).join(" 至 ") || "时间未返回";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function renderOzonImageStyleObservations() {
  const data = state.ozonImageStyleObservations || {};
  if ($("#ozonImageStyleTotal")) $("#ozonImageStyleTotal").textContent = Number(data.totalObserved || 0);
  if ($("#ozonImageStyleImages")) $("#ozonImageStyleImages").textContent = Number(data.totalImages || 0);
  if ($("#ozonImageStyleGroups")) $("#ozonImageStyleGroups").textContent = Number((data.groups || []).length);
  if ($("#ozonImageStyleQueue")) $("#ozonImageStyleQueue").textContent = Number((data.visionQueue || []).length);
  renderOzonImageStyleAnalysis();
  if ($("#ozonImageStyleNotes")) {
    $("#ozonImageStyleNotes").innerHTML = (data.notes || [])
      .map((note) => `<div class="field-alert">${escapeHtml(note)}</div>`)
      .join("");
  }
  const tbody = $("#ozonImageStyleRows");
  if (!tbody) return;
  const groups = data.groups || [];
  tbody.innerHTML = groups.length
    ? groups.slice(0, 30).map((group) => {
      const sample = (group.topSamples || [])[0] || {};
      const sampleImage = sample.firstImage
        ? `<img src="${escapeHtml(sample.firstImage)}" alt="" class="product-photo" />`
        : "<span class=\"photo-placeholder\">无图</span>";
      const sequencePreview = (group.sequenceSamples || [])
        .slice(0, 2)
        .map((row) => `${escapeHtml(row.title || "-")} · ${Number(row.imageCount || 0)}图`)
        .join("<br/>");
      return `
        <tr>
          <td>
            <strong>${escapeHtml(group.level2 || group.key || "未分类")}</strong>
            <div class="status-sub">${escapeHtml(group.level1 || "-")}</div>
          </td>
          <td>
            <strong>${Number(group.sampleCount || 0)}</strong>
            <div class="status-sub">详情 ${Number(group.detailCount || 0)}</div>
          </td>
          <td>
            平均 ${escapeHtml(group.avgImageCount || 0)} 张
            <div class="status-sub">${sequencePreview || "暂无序列样本"}</div>
          </td>
          <td>
            ${Number(group.priceMinRub || 0)}–${Number(group.priceMaxRub || 0)} ₽
            <div class="status-sub">平均评论 ${Number(group.avgReviewCount || 0)}</div>
          </td>
          <td>
            <div class="learning-product-cell">
              ${sampleImage}
              <div>
                <strong>${escapeHtml(sample.title || "-")}</strong>
                <div class="status-sub"><a href="${escapeHtml(sample.url || "#")}" target="_blank">${escapeHtml(sample.url || "-")}</a></div>
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join("")
    : "<tr><td colspan=\"5\" class=\"product-empty\">暂无图片观察数据，请先采集 Ozon 样本或重建观察库。</td></tr>";
}

function renderOzonImageStyleAnalysis() {
  const data = state.ozonImageStyleAnalysis || {};
  if ($("#ozonImageAnalysisTotal")) $("#ozonImageAnalysisTotal").textContent = Number(data.totalAnalyzed || 0);
  if ($("#ozonImageAnalysisRisks")) $("#ozonImageAnalysisRisks").textContent = Number(data.summary?.riskCount || 0);
  const box = $("#ozonImageAnalysisRows");
  if (!box) return;
  const rows = data.rows || [];
  box.innerHTML = rows.length
    ? rows.slice(0, 5).map((row) => {
      const guidance = (row.listingGuidance || []).slice(0, 3).map(escapeHtml).join("；") || "暂无建议";
      const facts = (row.observedFacts || []).slice(0, 3).map(escapeHtml).join("；") || "暂无事实";
      const risks = (row.riskFlags || []).slice(0, 3).map(escapeHtml).join("；") || "none";
      return `
        <div class="field-alert">
          <strong>${escapeHtml(row.productType || row.title || "未识别商品")}</strong>
          <div class="status-sub">${escapeHtml(row.title || "")}</div>
          <div>可见事实：${facts}</div>
          <div>上架指导：${guidance}</div>
          <div>风险：${risks}</div>
          <div class="status-sub">${escapeHtml(row.provider || "-")} · ${escapeHtml(row.model || "-")}</div>
        </div>
      `;
    }).join("")
    : "<div class=\"field-alert\">还没有 GPT 图片观察结果。点击“GPT分析观察库”会分析视觉队列前 5 个样本。</div>";
}

function renderGuidanceList(title, items = []) {
  const rows = (items || []).filter(Boolean).slice(0, 8);
  return `
    <article>
      <strong>${escapeHtml(title)}</strong>
      ${rows.length ? `<ul>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p class=\"hint\">暂无</p>"}
    </article>
  `;
}

function renderOzonReferenceGuidance() {
  const box = $("#ozonReferenceGuidanceResult");
  if (!box) return;
  const data = state.ozonReferenceGuidance || {};
  if (!data.ok) {
    box.innerHTML = "<p class=\"hint\">先采集 1688 商品，再同步采集同类 Ozon 样本；这里生成当前单品的参照指导卡。</p>";
    return;
  }
  const imageStyleProfile = data.imageStyleProfile || {};
  const carouselPlan = data.carouselPlan || [];
  const image2Prompts = data.image2Prompts || [];
  const qualityChecklist = data.qualityChecklist || [];
  box.innerHTML = `
    <div class="ozon-reference-guidance-grid">
      ${renderGuidanceList("文案指导", data.copywritingGuidance)}
      ${renderGuidanceList("属性指导", data.attributeGuidance)}
      ${renderGuidanceList("布局", imageStyleProfile.layout)}
      ${renderGuidanceList("色调", imageStyleProfile.colorTone)}
      ${renderGuidanceList("构图", imageStyleProfile.composition)}
      ${renderGuidanceList("文字/场景", [...(imageStyleProfile.typography || []), ...(imageStyleProfile.sceneLogic || [])])}
      <article>
        <strong>轮播图脚本</strong>
        ${carouselPlan.length ? carouselPlan.slice(0, 8).map((item) => `
          <p><b>图 ${Number(item.index || 0)}</b>：${escapeHtml(item.goal || "")}｜${escapeHtml(item.composition || "")}｜${escapeHtml(item.text || "")}</p>
        `).join("") : "<p class=\"hint\">暂无</p>"}
      </article>
      <article>
        <strong>image2 Prompts</strong>
        ${image2Prompts.length ? image2Prompts.slice(0, 8).map((item) => `
          <p><b>图 ${Number(item.index || 0)}</b>：${escapeHtml(item.prompt || "")}</p>
        `).join("") : "<p class=\"hint\">暂无</p>"}
      </article>
      ${renderGuidanceList("质检清单", qualityChecklist)}
      ${renderGuidanceList("风险", data.riskFlags)}
    </div>
    <p class="hint">参照样本：${Number(data.referenceSummary?.count || 0)} 个；仅用于指导当前商品，不复制竞品，不自动提交 Ozon。</p>
  `;
}

function workflowStatusLabel(status = "") {
  const labels = {
    idle: "空闲",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    pending: "等待中",
    retrying: "重试中",
    skipped: "已跳过",
  };
  return labels[status] || status || "未知";
}

function workflowNodeTitle(key = "") {
  const titles = {
    collect_1688: "1688 采集",
    ozon_learning: "Ozon 学习",
    keyword_expand: "关键词扩展",
    crawler_1688: "1688 采集",
    candidate_parse: "候选解析",
    match_profit: "匹配利润",
    content_generate: "内容生成",
    preflight_check: "提交前校验",
    ozon_submit: "提交 Ozon",
    stock_sync: "库存写入",
    normalize_source: "采集清洗",
    learn_ozon: "Ozon 学习",
    map_category: "类目映射",
    generate_listing: "生成上架稿",
    validate_payload: "提交前校验",
    submit_ozon: "提交 Ozon",
    review_feedback: "审核回馈",
    retry_model: "修正模型属性",
    sync_stock: "库存写入",
  };
  return titles[key] || key || "未命名节点";
}

function sellerTaskStageTitle(stage = "") {
  const titles = {
    candidate_handoff: "1688 候选交接",
    listing_progress: "Ozon 上架主流程",
    product_readiness: "商品就绪检查",
    stock_readiness: "库存就绪检查",
    review_reconcile: "审核结果回读",
  };
  return titles[String(stage || "").trim()] || "当前业务步骤";
}

function workflowRiskLabel(riskLevel = "") {
  const labels = {
    low: "低风险",
    medium: "中风险",
    high: "高风险",
  };
  return labels[riskLevel] || riskLevel || "未评估";
}

function workflowRunSummaryText(summary = {}) {
  if (!summary || !summary.nodeCount) return "暂无节点摘要";
  if (summary.blockingNodeName) {
    return `卡在：${summary.blockingNodeName} · 下一步：${summary.nextAction || "查看节点"}`;
  }
  return `当前：${summary.currentNodeName || "-"} · ${summary.completedCount || 0}/${summary.nodeCount || 0} 节点完成`;
}

function renderWorkflowCurrentProductTask(task = {}, options = {}) {
  if (!task || !task.stage) return "";
  const compact = Boolean(options.compact);
  return `
    <span class="workflow-current-product-task ${compact ? "compact" : ""}">
      <b>当前商品任务</b>
      <em>${escapeHtml(task.productTitle || "当前商品")}</em>
      <small>${escapeHtml(task.blockedAt || "主流程")} · ${escapeHtml(task.reason || "等待节点输出")}</small>
      <strong>${escapeHtml(task.nextAction || "查看工作流节点")}</strong>
    </span>
  `;
}

function workflowRunCopySummaryText(run = {}, node = null) {
  const summary = run.summary || {};
  const locks = workflowLockBadges(run.locks || {}).join(" / ");
  const nodes = Array.isArray(run.nodes) ? run.nodes : [];
  const payloadIssues = Array.isArray(run.payloadDraftValidation?.issues) ? run.payloadDraftValidation.issues : [];
  const recentEvents = (run.events || []).slice(-5).reverse();
  const lines = [
    "Ozon ERP 工作流排查摘要",
    `运行ID：${run.id || "-"}`,
    `标题：${run.title || run.name || "-"}`,
    `状态：${workflowStatusLabel(run.status)}；锁：${locks}`,
    `当前节点：${workflowNodeTitle(run.currentNode || summary.currentNodeKey || node?.key) || "-"}`,
    `摘要：${workflowRunSummaryText(summary)}`,
    `风险：${workflowRiskLabel(summary.riskLevel)} ${Number(summary.maxRiskScore || node?.riskScore || 0)}分`,
    `下一步：${summary.nextAction || node?.recommendedActions?.[0] || "查看节点诊断"}`,
  ];
  if (summary.blockingNodeName) lines.push(`阻塞节点：${summary.blockingNodeName}`);
  if (node) {
    const diagnostic = node.diagnostic || node.diagnosis || {};
    lines.push(`选中节点：${workflowNodeTitle(node.key)} / ${workflowStatusLabel(node.status)}`);
    lines.push(`节点判断：${node.reason || diagnostic.messageZh || diagnostic.message || "-"}`);
  }
  if (payloadIssues.length) {
    lines.push(`Payload问题：${payloadIssues.length} 个`);
    for (const issue of payloadIssues.slice(0, 5)) {
      lines.push(`- ${issue.code || "UNKNOWN"}：${issue.message || issue.field || "请查看校验问题"}`);
    }
  }
  if (nodes.length) {
    lines.push("节点进度：");
    for (const item of nodes.slice(0, 12)) {
      lines.push(`- ${workflowNodeTitle(item.key)}：${workflowStatusLabel(item.status)}；${item.reason || item.branch || "-"}`);
    }
  }
  if (recentEvents.length) {
    lines.push("最近事件：");
    for (const event of recentEvents) {
      lines.push(`- ${workflowEventLabel(event.type)} / ${event.node || "-"} / ${event.message || "-"}`);
    }
  }
  return lines.join("\n");
}

function workflowLockBadges(locks = {}) {
  const badges = [];
  if (locks.paused) badges.push("已暂停");
  if (locks.waitingHuman) badges.push("等待人工");
  if (locks.submitLocked) badges.push("提交锁定");
  return badges.length ? badges : ["无锁"];
}

function workflowEventLabel(type = "") {
  const labels = {
    workflow_paused: "人工暂停",
    workflow_resumed: "人工恢复",
    retry_requested: "请求重试",
    continue_requested: "从此继续",
    controlled_chain_completed: "受控链路",
    new_source_requested: "换新货源",
    manual_fix_retry_requested: "清理后重试",
    manual_continue_confirmed: "确认继续",
    task_submitted: "已提交任务",
    stock_success: "库存成功",
    stock_failed: "库存失败",
  };
  return labels[type] || type || "事件";
}

function workflowEventExecutionBadge(event = {}) {
  if (event.type !== "continue_requested") return "";
  const supported = event.data?.supported === true;
  return supported
    ? `<em class="workflow-event-badge workflow-event-badge-live">真实执行</em>`
    : `<em class="workflow-event-badge workflow-event-badge-record">仅记录</em>`;
}

function workflowEventActionText(event = {}) {
  const actions = Array.isArray(event.data?.actions) ? event.data.actions : [];
  if (!actions.length) return "";
  return `动作：${actions.map((action) => String(action || "")).filter(Boolean).join(" / ")}`;
}

function workflowControlledChainResultPanel(run = {}) {
  const event = (run.events || []).slice().reverse().find((item) => item.type === "controlled_chain_completed");
  if (!event) return "";
  const steps = Array.isArray(event.data?.steps) ? event.data.steps : [];
  const stopReason = event.message || (steps.length ? "链路已结束" : "还没有步骤结果");
  const liveCount = steps.filter((step) => step.supported).length;
  const recordCount = steps.length - liveCount;
  const lastStep = steps[steps.length - 1] || null;
  return `
    <section class="workflow-chain-result">
      <div class="workflow-section-head">
        <div>
          <strong>链路结果</strong>
          <p class="hint">${escapeHtml(stopReason)}</p>
        </div>
        <span>步骤：${steps.length} · 真实执行：${liveCount} · 仅记录：${recordCount}</span>
      </div>
      <div class="workflow-chain-result-summary">
        ${lastStep ? `<span>末节点：${escapeHtml(workflowNodeTitle(lastStep.node) || lastStep.node || "-")}</span>` : ""}
        ${lastStep ? `<span>末动作：${escapeHtml((lastStep.actions || []).join(" / ") || "无动作")}</span>` : ""}
      </div>
      ${steps.length ? `
        <details class="workflow-chain-steps">
          <summary>查看步骤明细</summary>
          <div>
            ${steps.map((step, index) => `
              <article>
                <span>#${index + 1} ${escapeHtml(workflowNodeTitle(step.node) || step.node || "-")}</span>
                <em class="${step.supported ? "workflow-event-badge-live" : "workflow-event-badge-record"}">${step.supported ? "真实执行" : "仅记录"}</em>
                <small>${escapeHtml((step.actions || []).join(" / ") || "无动作")}</small>
              </article>
            `).join("")}
          </div>
        </details>
      ` : `<p class="hint">暂无链路步骤。</p>`}
    </section>
  `;
}

function renderCrawlerLivePanel() {
  const panel = $("#crawlerLivePanel");
  if (!panel) return;
  const workers = state.crawlerWorkerStatus?.items || [];
  const latest = workers[0] || null;
  const tasks = state.crawlerTasks || [];
  const counts = summarizeCrawlerTaskCounts(tasks);
  const runningTasks = tasks.filter((task) => task.status === "running");
  const waitingTasks = tasks.filter((task) => task.status === "waiting_human");
  const failedTasks = tasks.filter((task) => task.status === "failed").slice(0, 5);
  const activeTask = latest?.currentTaskId
    ? tasks.find((task) => task.id === latest.currentTaskId)
    : runningTasks[0] || waitingTasks[0] || tasks[0] || null;
  const discovered = tasks.reduce((sum, task) => sum + Number(task.progress?.urlsDiscovered || 0), 0);
  const parsed = tasks.reduce((sum, task) => sum + Number(task.progress?.productsParsed || 0), 0);
  const saved = tasks.reduce((sum, task) => sum + Number(task.progress?.candidatesSaved || 0), 0);

  const now = $("#crawlerLiveNow");
  if (now) {
    const tone = latest?.needsHuman ? "needs-human" : latest?.status === "running" ? "running" : latest?.online ? "online" : "offline";
    const jobLabel = latest?.currentJobKind
      ? `${latest.currentJobKind} / ${activeTask?.sourceValue || latest.currentTaskId || "-"}`
      : activeTask?.status === "running"
        ? `等待详情解析 / ${activeTask.sourceValue || activeTask.id}`
        : "没有正在执行的浏览器作业";
    now.className = `crawler-live-now ${tone}`;
    now.innerHTML = `
      <span>当前动作</span>
      <strong>${escapeHtml(crawlerStatusLabel(latest?.status || activeTask?.status || "idle"))}</strong>
      <p>${escapeHtml(jobLabel)}</p>
      ${latest?.currentJobUrl ? `<a href="${escapeHtml(latest.currentJobUrl)}" target="_blank">打开当前页面</a>` : ""}
      ${latest?.lastError ? `<em>${escapeHtml(latest.lastError)}</em>` : ""}
    `;
  }

  const metrics = $("#crawlerLiveMetrics");
  if (metrics) {
    metrics.innerHTML = [
      ["运行中", counts.running || 0, "running"],
      ["等你处理", counts.waiting_human || 0, "waiting"],
      ["失败", counts.failed || 0, "failed"],
      ["排队", counts.queued || 0, "queued"],
      ["已发现链接", discovered, "info"],
      ["已解析商品", parsed, "info"],
      ["已保存候选", saved, "ok"],
    ].map(([label, value, tone]) => `
      <article class="crawler-live-metric ${tone}">
        <span>${label}</span>
        <strong>${value}</strong>
      </article>
    `).join("");
  }

  const lanes = $("#crawlerLiveLanes");
  if (lanes) {
    lanes.innerHTML = [
      crawlerLiveLane("正在跑", runningTasks.slice(0, 4), "running"),
      crawlerLiveLane("需要你看", waitingTasks.slice(0, 4), "waiting"),
      crawlerLiveLane("刚失败", failedTasks, "failed"),
    ].join("");
  }

  const issues = $("#crawlerLiveIssues");
  if (issues) {
    const issueRows = [...waitingTasks, ...failedTasks].slice(0, 6);
    issues.innerHTML = issueRows.length
      ? `
        <h3>需要处理的具体原因</h3>
        <div class="crawler-issue-list">
          ${issueRows.map((task) => {
            const issue = classifyCrawlerIssue(task.lastError || task.status || "");
            return `
              <article class="${issue.tone}">
                <strong>${escapeHtml(issue.label)}</strong>
                <span>${escapeHtml(task.sourceValue || task.id)}</span>
                <p>${escapeHtml(issue.action)}</p>
              </article>
            `;
          }).join("")}
        </div>
      `
      : `<div class="crawler-live-clear">当前没有需要人工处理的采集错误。</div>`;
  }

  const updated = $("#crawlerLiveUpdated");
  if (updated) {
    updated.textContent = latest?.updatedAt ? `更新 ${formatDateTime(latest.updatedAt)}` : "等待 worker 心跳";
  }
}

function summarizeCrawlerTaskCounts(tasks = []) {
  return tasks.reduce((acc, task) => {
    const status = task.status || "unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

function crawlerStatusLabel(status) {
  const map = {
    running: "正在采集",
    checking: "检查任务",
    idle: "空闲等待",
    waiting_human: "等待人工",
    failed: "失败",
    queued: "排队",
    finished: "已完成",
    stopped: "已停止",
    paused: "已暂停",
    error: "插件错误",
  };
  return map[status] || status || "-";
}

function crawlerLiveLane(title, tasks, tone) {
  return `
    <section class="crawler-live-lane ${tone}">
      <header>${title}<strong>${tasks.length}</strong></header>
      ${tasks.length ? tasks.map((task) => `
        <article>
          <strong>${escapeHtml(task.sourceValue || task.id)}</strong>
          <span>${escapeHtml(crawlerStatusLabel(task.status))} · 链接 ${Number(task.progress?.urlsDiscovered || 0)} · 候选 ${Number(task.progress?.candidatesSaved || 0)}</span>
          ${task.lastError ? `<p>${escapeHtml(classifyCrawlerIssue(task.lastError).label)}</p>` : ""}
        </article>
      `).join("") : `<p class="hint">暂无</p>`}
    </section>
  `;
}

function classifyCrawlerIssue(text = "") {
  const value = String(text || "");
  if (/人机|验证|captcha|verify/i.test(value)) {
    return { label: "1688 人机验证", action: "在浏览器验证页处理，然后点插件恢复采集。", tone: "waiting" };
  }
  if (/login\.taobao|login\.1688|登录|signin/i.test(value)) {
    return { label: "登录跳转", action: "确认淘宝/1688 已登录；插件已补登录域权限，重载插件后再跑。", tone: "waiting" };
  }
  if (/permission|manifest|access contents/i.test(value)) {
    return { label: "插件权限不足", action: "重新加载最新插件包，再恢复采集。", tone: "failed" };
  }
  if (/message channel closed|asynchronous response/i.test(value)) {
    return { label: "页面通信中断", action: "通常是页面跳转或标签页关闭；可重试该任务。", tone: "failed" };
  }
  if (/标题|图片|SKU|属性|重量|尺寸/.test(value)) {
    return { label: "商品信息不完整", action: "候选可保留，但上架前需要人工补字段。", tone: "warning" };
  }
  return { label: value ? "采集失败" : "等待处理", action: value || "查看任务详情后决定是否重试。", tone: "failed" };
}

function workflowNodeIoSummaryValue(value) {
  if (Array.isArray(value)) return `${value.length} 项`;
  if (value && typeof value === "object") return `${Object.keys(value).length} 字段`;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function workflowNodeIoSummary(label = "", data = {}) {
  const payload = data || {};
  const title = label === "输入" ? "输入摘要" : (label === "输出" ? "输出摘要" : `${label}摘要`);
  const issueCount = Array.isArray(payload.issues) ? payload.issues.length : Number(payload.issueCount || 0);
  const keys = [
    "candidateCount",
    "acceptedCount",
    "rejectedCount",
    "itemCount",
    "variantCount",
    "candidateImageCount",
    "skuVariantCount",
    "payloadDraftReady",
    "listingContentReady",
    "ok",
  ].filter((key) => Object.prototype.hasOwnProperty.call(payload, key));
  const summary = keys.slice(0, 8).map((key) => ({ key, value: workflowNodeIoSummaryValue(payload[key]) }));
  if (issueCount) summary.unshift({ key: "问题数", value: issueCount });
  if (Array.isArray(payload.actions)) summary.push({ key: "动作数", value: payload.actions.length });
  return `
    <article class="workflow-io-summary">
      <strong>${escapeHtml(title)}</strong>
      ${summary.length ? `
        <div>
          ${summary.map((item) => `<span>${escapeHtml(item.key)}：${escapeHtml(item.value)}</span>`).join("")}
        </div>
      ` : `<p class="hint">暂无可摘要字段。</p>`}
    </article>
  `;
}

function workflowRunMatchesFilter(run = {}, filter = "all") {
  const summary = run.summary || {};
  if (filter === "waiting_human") return run.status === "waiting_human" || summary.status === "waiting_human";
  if (filter === "high_risk") return summary.riskLevel === "high";
  if (filter === "blocking") return Boolean(summary.blockingNodeKey);
  if (filter === "live") return run.status === "live" || summary.status === "live";
  return true;
}

function isSyntheticWorkflowRun(run = {}) {
  if (run.synthetic === true || run.fixture === true || run.summary?.synthetic === true) return true;
  const sourceMarkers = [
    run.sourceType,
    run.summary?.sourceType,
    run.fixtureProvenance?.captureMode,
  ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
  if (sourceMarkers.some((value) => ["fixture", "fixture_replay", "synthetic", "synthetic_fixture", "test"].includes(value))) return true;
  const titles = [
    run.title,
    run.name,
    run.summary?.productTitle,
    run.currentProductTask?.title,
    run.summary?.currentProductTask?.title,
    run.goldenPathSellerTask?.title,
  ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
  return titles.some((value) => /^(fixture product|test product|测试商品|demo product)(?:\b|\s|$)/.test(value));
}

function sellerWorkflowRuns() {
  return state.showSyntheticWorkflows
    ? [...(state.workflowRuns || [])]
    : (state.workflowRuns || []).filter((run) => !isSyntheticWorkflowRun(run));
}

function sellerWorkflowSummary() {
  const runs = sellerWorkflowRuns();
  return {
    total: runs.length,
    running: runs.filter((run) => run.status === "running").length,
    waitingHuman: runs.filter((run) => run.status === "waiting_human" || run.summary?.status === "waiting_human").length,
    blocking: runs.filter((run) => Boolean(run.summary?.blockingNodeKey) || run.status === "blocked").length,
    highRisk: runs.filter((run) => run.summary?.riskLevel === "high").length,
    live: runs.filter((run) => run.status === "live" || run.summary?.status === "live").length,
    failed: runs.filter((run) => run.status === "failed").length,
    lockedWaitingHuman: runs.filter((run) => run.locks?.waitingHuman === true || run.locks?.waiting_human === true).length,
    submitLocked: runs.filter((run) => run.locks?.submit === true || run.locks?.submitLocked === true).length,
    lockedPaused: runs.filter((run) => run.locks?.paused === true).length,
  };
}

function selectedWorkflowRun() {
  const captureTask = currentCaptureSellerTask();
  if (!captureTask?.item || captureTask.reviewApproved !== true) return null;
  return canonicalCurrentCaptureWorkflowRun();
}

function selectedWorkflowNode(run) {
  if (!run) return null;
  return (run.nodes || []).find((node) => node.key === state.selectedWorkflowNodeKey) || (run.nodes || [])[0] || null;
}

async function loadWorkflowRuns() {
  try {
    const data = await api("/api/workflows");
    state.workflowRuns = data.items || data.runs || [];
    state.workflowSummary = data.summary || null;
    const sellerRuns = sellerWorkflowRuns();
    const captureTask = currentCaptureSellerTask();
    if (captureTask?.item) {
      const canonicalRun = canonicalCurrentCaptureWorkflowRun();
      state.selectedWorkflowRunId = canonicalRun?.id || "__no_workflow__";
      state.selectedWorkflowNodeKey = "";
    } else {
      if (!state.selectedWorkflowRunId && sellerRuns.length) state.selectedWorkflowRunId = sellerRuns[0].id;
      if (!sellerRuns.some((run) => run.id === state.selectedWorkflowRunId)) {
        state.selectedWorkflowRunId = sellerRuns[0]?.id || "";
        state.selectedWorkflowNodeKey = "";
      }
    }
    renderWorkflowConsole();
    renderCockpitDashboard();
    // The seller-facing listing summary is derived from the selected workflow.
    // Refreshing the workflow list can change that selection, so refresh the
    // summary as well; otherwise the upload queue may keep showing the prior
    // product's blocker and safe next action.
    renderListingSellerTaskSummary();
    renderGlobalCurrentTaskBar();
    renderCurrentProductWorkspace();
  } catch (error) {
    state.promotionProducts = [];
    state.promotionCandidates = [];
    state.promotionImpactPreview = null;
    renderPromotionDetail();
    toast(error.message, "error");
  }
}

async function loadRuleApprovalAuditIntents() {
  try {
    const data = await api("/api/listing-rule-approval-audit/intents?limit=200");
    state.ruleApprovalAuditIntents = Array.isArray(data.items) ? data.items : [];
    state.ruleApprovalAuditSummary = data.summary || null;
  } catch (error) {
    state.ruleApprovalAuditIntents = [];
    state.ruleApprovalAuditSummary = {
      safeNextStep: `审计记录暂不可用：${error.message}`,
    };
  }
  renderListingRequiredAttributeRulePoolWorkbench();
}

async function loadRulePublishReviewIntents() {
  try {
    const data = await api("/api/listing-rule-publish-review/intents?limit=200");
    state.rulePublishReviewIntents = Array.isArray(data.items) ? data.items : [];
    state.rulePublishReviewSummary = data.summary || null;
  } catch (error) {
    state.rulePublishReviewIntents = [];
    state.rulePublishReviewSummary = {
      safeNextStep: `发布复核记录暂不可用：${error.message}`,
    };
  }
  renderListingRequiredAttributeRulePoolWorkbench();
}

function renderWorkflowRunList(run) {
  const list = $("#workflowRunList");
  if (!list) return;
  const sellerRuns = sellerWorkflowRuns();
  const hiddenCount = Math.max(0, (state.workflowRuns || []).length - sellerRuns.length);
  const notice = $("#syntheticWorkflowNotice");
  if (notice) notice.textContent = state.showSyntheticWorkflows
    ? `正在显示全部 ${(state.workflowRuns || []).length} 条记录，其中包含测试数据。`
    : `测试数据已隐藏 ${hiddenCount} 条，只显示真实业务记录。`;
  const toggle = $("#toggleSyntheticWorkflows");
  if (toggle) toggle.textContent = state.showSyntheticWorkflows ? "隐藏测试数据" : "显示测试数据";
  if (!sellerRuns.length) {
    list.innerHTML = `<p class="hint">暂无工作流记录。跑一次自动上架后，这里会显示每个节点。</p>`;
    return;
  }
  const filteredRuns = sellerRuns.filter((item) => workflowRunMatchesFilter(item, state.workflowFilter));
  list.innerHTML = `
    <h2>运行记录</h2>
    <p class="hint">当前筛选：${escapeHtml(state.workflowFilter)} · ${filteredRuns.length}/${sellerRuns.length} 条真实业务记录</p>
    <div class="workflow-run-items">
      ${filteredRuns.length ? filteredRuns.map((item) => `
        <button class="workflow-run-card ${item.id === run?.id ? "active" : ""}" data-run-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.title || item.name || item.id)}</strong>
          <span class="workflow-status workflow-status-${escapeHtml(item.status || "idle")}">${workflowStatusLabel(item.status)}</span>
          <span class="workflow-locks">${workflowLockBadges(item.locks || {}).map((label) => `<em>${escapeHtml(label)}</em>`).join("")}</span>
          ${renderWorkflowCurrentProductTask(item.summary?.currentProductTask || {}, { compact: true })}
          <span class="workflow-run-summary">${escapeHtml(workflowRunSummaryText(item.summary || {}))}</span>
          <span class="workflow-run-summary">风险：${workflowRiskLabel(item.summary?.riskLevel)} ${Number(item.summary?.maxRiskScore || 0)}分${item.summary?.blockingNodeName ? ` · 阻塞：${escapeHtml(item.summary.blockingNodeName)}` : ""}</span>
          <small>${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : "时间未知")}</small>
        </button>
      `).join("") : `<p class="hint">当前筛选下没有工作流。</p>`}
    </div>
  `;
}

function renderWorkflowSummaryCards() {
  const el = $("#workflowSummaryCards");
  if (!el) return;
  const summary = sellerWorkflowSummary();
  el.innerHTML = `
    <article>
      <span>工作流</span>
      <strong>${Number(summary.total || 0)}</strong>
      <small>运行 ${Number(summary.running || 0)} / 在售 ${Number(summary.live || 0)}</small>
    </article>
    <article>
      <span>等待人工</span>
      <strong>${Number(summary.waitingHuman || 0)}</strong>
      <small>锁 ${Number(summary.lockedWaitingHuman || 0)} / 提交锁 ${Number(summary.submitLocked || 0)} / 暂停锁 ${Number(summary.lockedPaused || 0)}</small>
    </article>
    <article>
      <span>高风险</span>
      <strong>${Number(summary.highRisk || 0)}</strong>
      <small>失败 ${Number(summary.failed || 0)}</small>
    </article>
    <article>
      <span>阻塞节点</span>
      <strong>${Number(summary.blocking || 0)}</strong>
      <small>选择任务后查看安全下一步</small>
    </article>
  `;
}

function renderWorkflowFocusBar(run, node) {
  const el = $("#workflowFocusBar");
  if (!el) return;
  if (!run) {
    el.innerHTML = `
      <span>当前焦点</span>
      <strong>暂无工作流运行</strong>
      <small>启动采集/上架流程后，这里会显示卡点、风险和下一步动作。</small>
    `;
    return;
  }
  const summary = run.summary || {};
  const nextAction = (node?.recommendedActions || summary.recommendedActions || [])[0]
    || summary.nextAction
    || (run.locks?.waitingHuman ? "等待人工确认下一步" : "可继续观察或执行节点动作");
  el.className = `workflow-focus-bar workflow-focus-${escapeHtml(summary.riskLevel || node?.riskLevel || "low")}`;
  el.innerHTML = `
    <span>当前焦点</span>
    <strong>${escapeHtml(workflowNodeTitle(node?.key || run.currentNode || summary.currentNodeKey) || "未选节点")}</strong>
    <small>${escapeHtml(workflowStatusLabel(run.status))} · 风险 ${workflowRiskLabel(summary.riskLevel || node?.riskLevel)} ${Number(summary.maxRiskScore || node?.riskScore || 0)}分 · ${escapeHtml(nextAction)}</small>
    ${renderWorkflowCurrentProductTask(summary.currentProductTask || {})}
    <div class="workflow-focus-step">
      ${(run.nodes || []).slice(0, 9).map((item) => `
        <em class="workflow-status-${escapeHtml(item.status || "pending")}">${escapeHtml(workflowNodeTitle(item.key) || item.key)}</em>
      `).join("")}
    </div>
  `;
}

function renderWorkflowTimeline(run, node) {
  const timeline = $("#workflowNodeTimeline");
  if (!timeline) return;
  if (!run) {
    timeline.innerHTML = `<p class="hint">暂无可展示的工作流。</p>`;
    return;
  }
  const nodes = run.nodes || [];
  timeline.innerHTML = `
    <div class="workflow-section-head">
      <div>
        <h2>${escapeHtml(run.name || run.id)}</h2>
        <p class="hint">${escapeHtml(run.description || "每个节点都保留输入、输出、错误和诊断信息。")}</p>
      </div>
      <span class="workflow-status workflow-status-${escapeHtml(run.status || "idle")}">${workflowStatusLabel(run.status)}</span>
    </div>
    <div class="workflow-node-list">
      ${nodes.length ? nodes.map((item) => `
        <button class="workflow-node-card ${item.key === node?.key ? "active" : ""}" data-node-key="${escapeHtml(item.key)}">
          <span class="workflow-node-dot workflow-status-${escapeHtml(item.status || "pending")}"></span>
          <div>
            <strong>${escapeHtml(item.title || workflowNodeTitle(item.key))}</strong>
            <small>${workflowStatusLabel(item.status)} · ${workflowRiskLabel(item.riskLevel)}${Number(item.riskScore || 0) ? ` ${Number(item.riskScore || 0)}分` : ""}${item.updatedAt ? ` · ${escapeHtml(new Date(item.updatedAt).toLocaleString("zh-CN"))}` : ""}</small>
            ${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ""}
            ${item.diagnostic?.message ? `<p>${escapeHtml(item.diagnostic.message)}</p>` : ""}
          </div>
        </button>
      `).join("") : `<p class="hint">这条工作流还没有节点记录。</p>`}
    </div>
  `;
}

function workflowPayloadDraftItems(payload = {}) {
  if (Array.isArray(payload.items)) return payload.items;
  if (payload.offer_id || payload.name || payload.old_price) return [payload];
  return [];
}

function workflowPayloadDraftSummary(payload = {}) {
  const items = workflowPayloadDraftItems(payload);
  const summary = payload.summary || {};
  const first = items[0] || {};
  const itemCount = Number(summary.itemCount || items.length || 0);
  const variantCount = Number(summary.variantCount || items.length || 0);
  const imageCount = Number(summary.imageCount || new Set(items.flatMap((item) => item.images || [])).size || 0);
  const parentSku = summary.parentSku
    || String(first.offer_id || "").replace(/-variant-.+$/, "")
    || "-";
  const category = summary.categoryPath
    || [first.description_category_id, first.type_id].filter(Boolean).join(" / ")
    || "-";

  return `
    <div class="workflow-payload-summary">
      <span>商品数：${itemCount}</span>
      <span>父SKU：${escapeHtml(parentSku)}</span>
      <span>类目：${escapeHtml(category)}</span>
      <span>变体数：${variantCount}</span>
      <span>图片数：${imageCount}</span>
    </div>
  `;
}

function workflowPayloadRepairTemplate(issue = {}, payload = {}) {
  const code = String(issue.code || "").trim();
  const offerId = String(issue.offerId || issue.offer_id || payload.offer_id || "").trim();
  const parentSku = String(payload.summary?.parentSku || payload.parentSku || offerId.replace(/-variant-.+$/, "") || "").trim();
  const templateMap = {
    MISSING_MODEL_NAME: {
      suggestion: "补充 9048 Название модели，用于 Ozon 合并同卡片。",
      value: parentSku || "建议值：父SKU / 货源型号",
    },
    MISSING_BRAND: {
      suggestion: "补充 85 品牌属性，确保品牌字段完整。",
      value: "建议值：真实品牌名；若无品牌按类目要求填无品牌",
    },
    MISSING_PRICE: {
      suggestion: "回填价格字段，保持与上架草稿一致。",
      value: "建议值：与当前草稿售价一致",
    },
    MISSING_CATEGORY: {
      suggestion: "重新匹配 Ozon 类目和类型字段。",
      value: "建议值：选择对应 description_category_id / type_id",
    },
    IMAGES_TOO_FEW: {
      suggestion: "补足至少 3 张可提交图片。",
      value: "建议值：主图 + 细节图 + 场景图",
    },
    EMPTY_PAYLOAD: {
      suggestion: "先生成或恢复 payload.items，再继续校验。",
      value: "建议值：至少 1 个可提交 item",
    },
    CHINESE_IN_TITLE: {
      suggestion: "将标题改写为俄文，删除中文残留。",
      value: "建议值：纯俄文标题",
    },
  };
  const template = templateMap[code];
  if (!template) return "";
  const copyText = `问题码：${code}\n建议：${template.suggestion}\n${template.value}`;
  return `
    <div class="workflow-payload-repair">
      <div class="workflow-payload-repair-head">
        <strong>自动修复建议</strong>
        <button type="button" class="ghost workflow-payload-copy" data-workflow-action="copy-repair-template" data-repair-copy="${escapeHtml(copyText)}">复制建议</button>
      </div>
      <p>${escapeHtml(template.suggestion)}</p>
      <small>${escapeHtml(template.value)}</small>
    </div>
  `;
}

function workflowPayloadLocationForIssue(issue = {}) {
  const attributeId = Number(issue.attributeId || issue.attribute_id || 0);
  if (attributeId) {
    return { label: `items[].attributes[${attributeId}]`, path: `"id": ${attributeId}` };
  }
  const code = String(issue.code || issue.qualityCode || "").trim();
  const map = {
    EMPTY_PAYLOAD: { label: "payload.items", path: "payload.items" },
    MISSING_OFFER_ID: { label: "items[0].offer_id", path: "items[0].offer_id" },
    DUPLICATE_OFFER_ID: { label: "items[].offer_id", path: "items[].offer_id" },
    MISSING_NAME: { label: "items[0].name", path: "items[0].name" },
    CHINESE_IN_TITLE: { label: "items[0].name", path: "items[0].name" },
    MISSING_CATEGORY: { label: "items[0].description_category_id / type_id", path: "description_category_id" },
    MISSING_PRICE: { label: "items[0].price", path: "\"price\"" },
    IMAGES_TOO_FEW: { label: "items[0].images", path: "\"images\"" },
    MISSING_BRAND: { label: "items[0].attributes[85]", path: "\"id\": 85" },
    MISSING_MODEL_NAME: { label: "items[0].attributes[9048]", path: "\"id\": 9048" },
    LISTING_QUALITY_DICTIONARY_VALUE_INVALID: { label: "字典属性 dictionary_value_id", path: "dictionary_value_id" },
    LISTING_QUALITY_REQUIRED_ATTRIBUTE_MISSING: { label: "Ozon 必填属性", path: "\"attributes\"" },
    LISTING_QUALITY_PRODUCT_IMAGES_TOO_FEW: { label: "商品图片 images", path: "\"images\"" },
    LISTING_QUALITY_MISSING_VARIANT_ASPECT: { label: "变体可变特性 attributes", path: "\"attributes\"" },
    LISTING_QUALITY_DUPLICATE_VARIANT_ASPECTS: { label: "变体可变特性 attributes", path: "\"attributes\"" },
    LISTING_QUALITY_PRICING_BLOCKED: { label: "定价诊断 pricing", path: "\"price\"" },
    DUPLICATE_LISTING: { label: "duplicate.duplicateSku", path: "duplicate.duplicateSku" },
    CONTENT_ISSUE: { label: "contentSummary.contentIssues", path: "contentSummary.contentIssues" },
    SOURCE_IMAGES_TOO_FEW: { label: "contentSummary.candidateImageCount", path: "contentSummary.candidateImageCount" },
    SOURCE_SIZE_WEIGHT_MISSING: { label: "contentSummary.sizeWeightReady", path: "contentSummary.sizeWeightReady" },
    CATEGORY_MATCH_MISSING: { label: "category", path: "category" },
    VARIANT_COLLAPSED: { label: "variantCount", path: "variantCount" },
  };
  return map[code] || { label: "payload", path: "payload" };
}

function workflowPayloadIssueLocator(issue = {}, index = 0, payload = {}) {
  const meta = workflowPayloadLocationForIssue(issue);
  const offerId = String(issue.offerId || issue.offer_id || "").trim();
  const attributeId = String(issue.attributeId || issue.attribute_id || "").trim();
  return `
    <article class="workflow-payload-issue" title="${escapeHtml(issue.message || issue.code || "问题")}">
      <div class="workflow-payload-issue-main">
        <span>#${index + 1}</span>
        <strong>${escapeHtml(issue.code || "UNKNOWN")}</strong>
        <small>定位字段：${escapeHtml(meta.label)}</small>
      </div>
      ${workflowPayloadRepairTemplate(issue, payload)}
      <div class="workflow-payload-issue-actions">
        <button class="ghost" type="button" data-payload-path="${escapeHtml(meta.path)}" data-payload-label="${escapeHtml(meta.label)}" data-payload-offer-id="${escapeHtml(offerId)}" data-payload-attribute-id="${escapeHtml(attributeId)}">定位字段</button>
      </div>
    </article>
  `;
}

function listingQualityIsStale(run = {}) {
  if (!run.payloadDraft) return false;
  const validation = run.payloadDraftValidation;
  if (!validation) return true;
  return typeof validation === "object"
    && !Array.isArray(validation)
    && Object.keys(validation).length === 0;
}

function collectListingQualityDiagnosis(run = {}, node = {}) {
  const validation = run.payloadDraftValidation || {};
  const qualityStale = listingQualityIsStale(run);
  if (qualityStale) {
    return {
      listingQuality: null,
      qualityIssues: [],
      listingQualityWarnings: [],
      qualityStale: true,
    };
  }
  const preflight = (run.nodes || []).find((item) => item.key === "preflight_check") || {};
  const preflightOutput = node?.key === "preflight_check" ? (node.output || {}) : (preflight.output || {});
  const listingQuality = run.payloadDraftValidation?.listingQuality || preflightOutput.listingQuality || null;
  const listingQualityWarnings = validation.listingQualityWarnings
    || preflightOutput.listingQualityWarnings
    || listingQuality?.warnings
    || [];
  const qualityIssues = [
    ...(Array.isArray(validation.issues) ? validation.issues : []),
    ...(Array.isArray(preflightOutput.issues) ? preflightOutput.issues : []),
  ].filter((issue, index, issues) => (
    String(issue?.code || "").startsWith("LISTING_QUALITY_")
    && issues.findIndex((item) => String(item?.code || "") === String(issue?.code || "")
      && String(item?.offerId || "") === String(issue?.offerId || "")
      && Number(item?.attributeId || 0) === Number(issue?.attributeId || 0)) === index
  ));
  return {
    listingQuality,
    qualityIssues,
    listingQualityWarnings: Array.isArray(listingQualityWarnings) ? listingQualityWarnings : [],
    qualityStale: false,
  };
}

function listingQualityStatusText(status = "") {
  const labels = {
    blocked: "阻塞",
    warning: "有警告",
    ready: "可继续",
  };
  return labels[status] || status || "未校验";
}

function listingQualityCandidateSourceText(source = "") {
  const labels = {
    ozon_dictionary_cache: "本地 Ozon 字典缓存",
    attrs_meta_dictionary: "属性元数据",
    provided_dictionary_values: "传入字典值",
  };
  return labels[source] || source || "字典候选";
}

function renderListingQualityDictionaryCandidates(issue = {}) {
  const candidates = Array.isArray(issue.dictionaryCandidates) ? issue.dictionaryCandidates : [];
  if (!candidates.length) return "";
  const enteredValues = Array.isArray(issue.enteredValues) ? issue.enteredValues.filter(Boolean) : [];
  return `
    <div class="workflow-listing-quality-candidates">
      <strong>候选字典值（人工选择后重新预检）</strong>
      ${enteredValues.length ? `<small>当前文本：${enteredValues.map(escapeHtml).join(" / ")}</small>` : ""}
      <div>
        ${candidates.slice(0, 5).map((candidate) => `
          <span title="${escapeHtml(listingQualityCandidateSourceText(candidate.source))}">
            #${escapeHtml(candidate.dictionary_value_id || "")} · ${escapeHtml(candidate.value || "")}
            <em>${Math.round(Number(candidate.confidence || 0) * 100)}% · ${escapeHtml(listingQualityCandidateSourceText(candidate.source))}</em>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderListingQualityScoreBreakdown(listingQuality = {}) {
  const scoreBreakdown = listingQuality?.scoreBreakdown || {};
  const labels = {
    media: "图片与媒体",
    attributes: "分类属性与变体",
    description: "标题描述与富内容",
    package: "尺重与物流基础",
  };
  const rows = Object.entries(labels)
    .map(([key, fallbackLabel]) => {
      const item = scoreBreakdown[key] || null;
      if (!item) return null;
      return {
        key,
        label: item.label || fallbackLabel,
        score: Number.isFinite(Number(item.score)) ? Number(item.score) : 0,
        status: item.status || "warning",
        reasonZh: item.reasonZh || "建议人工复核该分项。",
      };
    })
    .filter(Boolean);
  if (!rows.length) return "";
  return `
    <div class="workflow-listing-quality-breakdown">
      <strong>评分分项</strong>
      <div>
        ${rows.map((row) => `
          <article class="workflow-listing-quality-breakdown-item workflow-listing-quality-breakdown-${escapeHtml(row.status)}">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.score)}分</strong>
            <small>${escapeHtml(row.reasonZh)}</small>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function renderListingImageQualityRecommendations(listingQuality = {}) {
  const recommendations = Array.isArray(listingQuality?.imageQualityRecommendations)
    ? listingQuality.imageQualityRecommendations
    : [];
  if (!recommendations.length) return "";
  return `
    <div class="workflow-listing-image-recommendations">
      <strong>图片质量建议</strong>
      ${recommendations.slice(0, 6).map((item) => `
        <article class="workflow-listing-image-recommendation workflow-listing-image-recommendation-${escapeHtml(item.severity || "warning")}">
          <span>${escapeHtml(item.title || item.code || "图片建议")}${item.offerId ? ` · ${escapeHtml(item.offerId)}` : ""}</span>
          <p>${escapeHtml(item.action || "人工检查图片质量。")}</p>
          <small>${escapeHtml(item.nextStep || "处理后重新预检；仅提示，不写 Payload。")}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function renderListingQualityPanel(run = {}, node = {}) {
  const { listingQuality, qualityIssues, listingQualityWarnings, qualityStale } = collectListingQualityDiagnosis(run, node);
  if (qualityStale) {
    return `
      <section class="workflow-listing-quality workflow-listing-quality-warning">
        <div class="workflow-listing-quality-head">
          <div>
            <strong>Listing 质量诊断</strong>
            <p class="hint">只读诊断：当前草稿已修改，旧分数已过期；修改后需重新预检，重新预检会生成新分数与阻塞原因。</p>
          </div>
          <span>需重新预检</span>
        </div>
      </section>
    `;
  }
  if (!listingQuality && !qualityIssues.length && !listingQualityWarnings.length) {
    return `
      <section class="workflow-listing-quality workflow-listing-quality-empty">
        <div class="workflow-listing-quality-head">
          <div>
            <strong>Listing 质量诊断</strong>
            <p class="hint">只读诊断。以下信息仅供定位，请在 Payload 草稿或上架草稿修字段后重新预检。</p>
          </div>
          <span>未校验</span>
        </div>
      </section>
    `;
  }
  const status = String(listingQuality?.status || (qualityIssues.length ? "blocked" : "warning"));
  const blockedReasons = Array.isArray(listingQuality?.blockedReasons) ? listingQuality.blockedReasons : [];
  const issues = qualityIssues.length ? qualityIssues : blockedReasons.map((reason) => ({
    code: `LISTING_QUALITY_${String(reason.code || "BLOCKED").toUpperCase()}`,
    message: reason.message || "",
    offerId: reason.offerId || "",
    attributeId: reason.attributeId || 0,
    enteredValues: Array.isArray(reason.enteredValues) ? reason.enteredValues : [],
    dictionaryCandidates: Array.isArray(reason.dictionaryCandidates) ? reason.dictionaryCandidates : [],
  }));
  const warnings = listingQualityWarnings.length ? listingQualityWarnings : (listingQuality?.warnings || []);
  const nextActions = Array.isArray(listingQuality?.nextActions) ? listingQuality.nextActions : [];
  return `
    <section class="workflow-listing-quality workflow-listing-quality-${escapeHtml(status)}">
      <div class="workflow-listing-quality-head">
        <div>
          <strong>Listing 质量诊断</strong>
          <p class="hint">只读诊断：分数不替代预检；请在 Payload 草稿或上架草稿修字段后重新预检。</p>
        </div>
        <span>${escapeHtml(listingQualityStatusText(status))}${Number.isFinite(Number(listingQuality?.score)) ? ` · ${Number(listingQuality.score)}分` : ""}</span>
      </div>
      ${renderListingQualityScoreBreakdown(listingQuality || {})}
      ${renderListingImageQualityRecommendations(listingQuality || {})}
      ${issues.length ? `
        <div class="workflow-listing-quality-grid">
          ${issues.map((issue, index) => {
            const meta = workflowPayloadLocationForIssue(issue);
            return `
              <article class="workflow-listing-quality-issue">
                <div>
                  <span>#${index + 1} ${escapeHtml(issue.code || "LISTING_QUALITY_BLOCKED")}</span>
                  <strong>${escapeHtml(issue.message || "上架质量诊断存在阻塞项。")}</strong>
                  <small>offerId：${escapeHtml(issue.offerId || "-")} · attributeId：${escapeHtml(issue.attributeId || "-")}</small>
                  ${renderListingQualityDictionaryCandidates(issue)}
                </div>
                <button class="ghost" type="button" data-payload-path="${escapeHtml(meta.path)}" data-payload-label="${escapeHtml(meta.label)}">定位 Payload 字段</button>
              </article>
            `;
          }).join("")}
        </div>
      ` : `<p class="hint">没有阻塞质量问题。</p>`}
      ${warnings.length ? `
        <div class="workflow-listing-quality-warnings">
          <strong>商品分值提醒</strong>
          ${warnings.map((warning) => `<span>${escapeHtml(warning.code || "WARNING")}：${escapeHtml(warning.message || "建议优化。")}</span>`).join("")}
        </div>
      ` : ""}
      ${nextActions.length ? `
        <div class="workflow-listing-quality-actions">
          <strong>下一步（人工处理后重新预检）</strong>
          <ul>${nextActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ul>
        </div>
      ` : ""}
    </section>
  `;
}

function listingAttributeMatrixStatusText(status = "") {
  const labels = {
    ok: "已填",
    empty: "未填",
    missing: "缺失",
    invalid_dictionary: "字典不合法",
    duplicate_variant: "变体重复",
    missing_variant_aspect_metadata: "缺变体元数据",
  };
  return labels[status] || status || "-";
}

function listingAttributeMatrixKindText(kind = "") {
  const labels = {
    required_dictionary: "必填字典",
    required: "必填",
    variant_aspect: "变体特征",
    dictionary: "字典",
    attribute: "属性",
    variant_aspect_missing_metadata: "变体元数据",
  };
  return labels[kind] || kind || "属性";
}

function renderListingAttributeCellRepair(cell = {}, row = {}) {
  const guidance = cell.repairGuidance || null;
  if (!guidance) return "";
  const candidates = Array.isArray(guidance.dictionaryCandidates) ? guidance.dictionaryCandidates : [];
  const canApplyLocalDraftRepair = guidance.canApplyLocalDraftRepair === true;
  const canApplyTextDraftRepair = guidance.canApplyTextDraftRepair === true;
  const canApplyVariantTextDraftRepair = guidance.canApplyVariantTextDraftRepair === true;
  return `
    <div class="attribute-matrix-repair">
      <strong>人工修复入口</strong>
      <small>${escapeHtml(guidance.message || "请人工修复该属性后重新预检。")}</small>
      ${candidates.length ? `
        <div class="attribute-matrix-candidates">
          ${candidates.map((candidate) => `
            <span>
              #${escapeHtml(candidate.dictionary_value_id || "")} · ${escapeHtml(candidate.value || "")}
              ${canApplyLocalDraftRepair ? `<button
                class="ghost"
                type="button"
                data-workflow-action="apply-attribute-dictionary-repair"
                data-repair-offer-id="${escapeHtml(guidance.offerId || cell.offerId || "")}"
                data-repair-attribute-id="${escapeHtml(guidance.attributeId || row.attributeId || "")}"
                data-repair-dictionary-value-id="${escapeHtml(candidate.dictionary_value_id || "")}"
                data-repair-value="${escapeHtml(candidate.value || "")}"
                data-repair-source-suggested-aspect="${candidate.source === "1688_sku_spec_dictionary_match" ? "true" : "false"}"
                data-repair-source-value="${escapeHtml(candidate.sourceValue || "")}"
                data-repair-source-variant-spec="${escapeHtml(candidate.sourceVariantSpec || "")}"
              >应用到草稿并预检</button>` : ""}
            </span>
          `).join("")}
        </div>
      ` : ""}
      <div>
        ${canApplyTextDraftRepair ? `<button
          class="ghost"
          type="button"
          data-workflow-action="apply-attribute-text-repair"
          data-repair-offer-id="${escapeHtml(guidance.offerId || cell.offerId || "")}"
          data-repair-attribute-id="${escapeHtml(guidance.attributeId || row.attributeId || "")}"
        >填写文本属性</button>` : ""}
        ${canApplyVariantTextDraftRepair ? `<button
          class="ghost"
          type="button"
          data-workflow-action="apply-variant-text-repair"
          data-repair-offer-id="${escapeHtml(guidance.offerId || cell.offerId || "")}"
          data-repair-attribute-id="${escapeHtml(guidance.attributeId || row.attributeId || "")}"
        >填写变体文本</button>` : ""}
        <button class="ghost" type="button" data-payload-path="${escapeHtml(guidance.payloadPath || "")}" data-payload-label="${escapeHtml(guidance.payloadLabel || row.name || "属性矩阵卡点")}">定位</button>
        <button class="ghost workflow-payload-copy" type="button" data-workflow-action="copy-repair-template" data-repair-copy="${escapeHtml(guidance.copyText || "人工修复后重新预检；不会自动提交 Ozon。")}">复制建议</button>
      </div>
      <small>${escapeHtml(guidance.nextStep || "人工修复后重新预检；不会自动提交 Ozon。")}</small>
    </div>
  `;
}

function renderListingAttributeMatrix(run = {}, node = {}) {
  const matrix = run.payloadDraftValidation?.attributeMatrix || node?.output?.attributeMatrix || null;
  const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];
  const offers = Array.isArray(matrix?.offers) ? matrix.offers : [];
  if (!rows.length || !offers.length) return "";
  const summary = matrix.summary || {};
  const blockedStatuses = new Set(["missing", "invalid_dictionary", "duplicate_variant", "missing_variant_aspect_metadata"]);
  const sortedRows = rows.slice().sort((left, right) => {
    const leftBlocked = (left.cells || []).some((cell) => blockedStatuses.has(cell.status));
    const rightBlocked = (right.cells || []).some((cell) => blockedStatuses.has(cell.status));
    return Number(rightBlocked) - Number(leftBlocked);
  });
  return `
    <section class="workflow-attribute-matrix">
      <div class="workflow-attribute-matrix-head">
        <div>
          <strong>属性矩阵</strong>
          <p class="hint">只读矩阵：逐 SKU 查看必填属性、字典值和变体特征，修复后必须重新预检。</p>
        </div>
        <span>${Number(summary.blockedCellCount || 0)} 个卡点</span>
      </div>
      <div class="workflow-attribute-matrix-table-wrap">
        <table class="workflow-attribute-matrix-table">
          <thead>
            <tr>
              <th>属性</th>
              ${offers.map((offer) => `<th>${escapeHtml(offer)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${sortedRows.slice(0, 28).map((row) => `
              <tr>
                <th>
                  <strong>${escapeHtml(row.name || `属性 ${row.attributeId || ""}`)}</strong>
                  <small>#${escapeHtml(row.attributeId || "")} · ${escapeHtml(listingAttributeMatrixKindText(row.kind))}</small>
                </th>
                ${(row.cells || []).map((cell) => `
                  <td>
                    <span class="attribute-matrix-cell attribute-matrix-cell-${escapeHtml(cell.status || "empty")}">
                      ${escapeHtml(listingAttributeMatrixStatusText(cell.status))}
                    </span>
                    <small>${escapeHtml(cell.value || "-")}</small>
                    ${renderListingAttributeCellRepair(cell, row)}
                  </td>
                `).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ${rows.length > 28 ? `<p class="hint">已优先显示有卡点的属性行；其余低风险属性在重新预检后继续汇总。</p>` : ""}
    </section>
  `;
}

function requiredFillPlanActionText(action = "") {
  const map = {
    auto_fill: "已安全补齐",
    suggest_dictionary: "建议确认",
    manual_required: "必须人工处理",
    blocked_sensitive: "合规敏感",
  };
  return map[action] || "必须人工处理";
}

function requiredFillPlanSafetyText(row = {}) {
  const tier = row.safetyTier || "manual-required";
  const label = row.safetyLabelZh || {
    "autofill-safe": "可自动填",
    "candidate-needs-human-confirmation": "候选需确认",
    "manual-required": "必须人工填",
    "blocked-never-guess": "禁止猜测",
  }[tier] || "必须人工填";
  return `安全分层：${label} / ${tier}`;
}

function requiredFillPlanGroups(plan = []) {
  return [
    { key: "auto_fill", title: "已安全补齐" },
    { key: "suggest_dictionary", title: "建议确认" },
    { key: "manual_required", title: "必须人工处理" },
    { key: "blocked_sensitive", title: "合规敏感" },
  ].map((group) => ({
    ...group,
    rows: (plan || []).filter((row) => String(row.action || "manual_required") === group.key),
  })).filter((group) => group.rows.length);
}

function renderRequiredFillPlanCandidates(row = {}) {
  const candidates = Array.isArray(row.dictionaryCandidates) ? row.dictionaryCandidates : [];
  if (!candidates.length) return "";
  return `
    <div class="required-fill-plan-candidates">
      ${candidates.slice(0, 5).map((candidate) => `
        <span>#${escapeHtml(candidate.dictionaryValueId || "")} · ${escapeHtml(candidate.value || "")}</span>
      `).join("")}
    </div>
  `;
}

function renderRequiredAttributeFillSummary(run = {}, node = {}, plan = []) {
  const summary = run.payloadDraftValidation?.requiredAttributeFillSummary || node?.output?.requiredAttributeFillSummary || null;
  if (!summary || !Number(summary.totalCount || 0)) return "";
  const cards = [
    ["可自动填", summary.autofillSafeCount || 0],
    ["候选确认", summary.candidateNeedsHumanConfirmationCount || 0],
    ["人工必填", summary.manualRequiredCount || 0],
    ["禁止猜测", summary.blockedNeverGuessCount || 0],
  ];
  return `
    <div class="required-attribute-coverage-summary">
      <div>
        <strong>属性覆盖率</strong>
        <small>${escapeHtml(summary.readinessStatus || "ready")} · ${Number(summary.totalCount || plan.length || 0)} 个必填属性</small>
      </div>
      <div class="required-attribute-coverage-grid">
        ${cards.map(([label, value]) => `
          <span>
            <b>${escapeHtml(value)}</b>
            <small>${escapeHtml(label)}</small>
          </span>
        `).join("")}
      </div>
      <p>${escapeHtml(summary.safeNextAction || "修复后重新预检；不会自动提交 Ozon。")}</p>
    </div>
  `;
}

function requiredAttributeManualBacklogBucketTitle(bucket = {}) {
  const map = {
    rule_candidate: "可规则化",
    manual_required: "必须人工",
    replace_source: "建议换货源",
  };
  return bucket.title || map[bucket.key] || "人工属性";
}

function requiredAttributeManualWorkbenchGroups(backlog = {}, textRepairCandidates = [], packageRepairCandidates = []) {
  const groupDefinitions = [
    {
      key: "package_evidence",
      title: "包装尺重证据",
      problemText: "1688 或当前货源缺少重量、长宽高、规格证据时，上架自动化不能继续猜测。",
      mustSupplyText: "1688 或人工实测的包装重量、长宽高、规格证据",
      safeNextStep: "补齐 1688 尺重/规格证据或更换货源后重新预检；本页只读，不写 Payload。",
    },
    {
      key: "compliance_sensitive",
      title: "合规敏感字段",
      problemText: "保质期、成分、危险、儿童、食品、化妆品、医疗、电池等字段必须来自真实资料。",
      mustSupplyText: "真实合规资料、包装标识或供应商证明",
      safeNextStep: "人工核实真实属性后再写本地草稿并重新预检；系统不能猜测。",
    },
    {
      key: "manual_value",
      title: "手动属性缺口",
      problemText: "当前商品文本或类目字典证据不足，不能低置信自动填入 Ozon 草稿。",
      mustSupplyText: "真实属性值、当前类目合法字典值或可沉淀规则的样本证明",
      safeNextStep: "先人工填写本次商品；后续再沉淀类目规则，不自动写 Payload。",
    },
  ];
  const groups = groupDefinitions.map((definition) => ({ ...definition, items: [] }));
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  const buckets = Array.isArray(backlog.buckets) ? backlog.buckets : [];
  const safeTextRepairCandidates = Array.isArray(textRepairCandidates) ? textRepairCandidates : [];
  const safePackageRepairCandidates = Array.isArray(packageRepairCandidates) ? packageRepairCandidates : [];
  const packagePattern = /package|weight|dimension|length|width|height|尺重|重量|长宽高|规格|вес|длина|ширина|высота/i;
  const compliancePattern = /合规|保质期|储存|成分|危险|儿童|食品|化妆|医疗|电池|срок|состав|опас|дет|пищ|battery/i;
  function packageEvidenceForItem(item = {}) {
    const text = [
      item.attributeName,
      item.reasonZh,
      item.safeNextStep,
      item.source,
      item.strategy,
    ].join(" ");
    const missingFields = [];
    if (/вес|重量|weight/i.test(text)) missingFields.push("重量");
    if (/длина|глубина|长|length|depth/i.test(text)) missingFields.push("长度/深度");
    if (/ширина|宽|width/i.test(text)) missingFields.push("宽度");
    if (/высота|高|height/i.test(text)) missingFields.push("高度");
    const targetDefinitions = [
      { field: "weight", label: "重量 weight", pattern: /вес|重量|weight/i },
      { field: "depth", label: "长度/深度 depth", pattern: /длина|глубина|长|length|depth/i },
      { field: "width", label: "宽度 width", pattern: /ширина|宽|width/i },
      { field: "height", label: "高度 height", pattern: /высота|高|height/i },
    ];
    const payloadTargets = targetDefinitions
      .filter((target) => target.pattern.test(text) || !missingFields.length)
      .map((target) => ({
        ...target,
        path: `"${target.field}"`,
        canWriteDraft: false,
      }));
    const source = String(item.source || "");
    const missingSource = source === "1688_package_missing" || /缺少|缺失|missing/i.test(text);
    const canWriteDraft = safePackageRepairCandidates.length > 0;
    const candidateMissingFields = [...new Set(safePackageRepairCandidates.flatMap((candidate) => candidate.missingFields || []))];
    const missingFieldLabels = {
      weight: "重量",
      depth: "长度/深度",
      width: "宽度",
      height: "高度",
    };
    const sourceLabels = {
      "1688_package": "1688 详情解析尺重",
      "manual_measurement": "人工实测尺重",
      "manual_measured": "人工实测尺重",
      "supplier_package": "供应商包装资料",
    };
    const candidateSourceText = [...new Set(safePackageRepairCandidates
      .map((candidate) => sourceLabels[candidate.packageInfoSource] || candidate.packageInfoSource)
      .filter(Boolean))].join(" / ");
    return {
      canWriteDraft,
      statusText: canWriteDraft ? "已有可信尺重证据" : (missingSource ? "缺少 1688 尺重证据" : "需核实尺重证据"),
      sourceText: canWriteDraft ? candidateSourceText : (source === "1688_package_missing" ? "1688 详情解析未取得完整包装尺重" : (source || "当前货源/人工资料")),
      missingText: candidateMissingFields.length
        ? candidateMissingFields.map((field) => missingFieldLabels[field] || field).join("、")
        : (missingFields.length ? missingFields.join("、") : "重量、长宽高或规格"),
      payloadTargets,
      safeSourceAction: "回到 1688 采集或详情页重新采集尺重；没有可靠来源时人工实测后更新货源，再重新预检。",
    };
  }
  buckets.forEach((bucket) => {
    (Array.isArray(bucket.items) ? bucket.items : []).forEach((item) => {
      const text = [
        bucket.key,
        item.strategy,
        item.source,
        item.action,
        item.safetyTier,
        item.attributeName,
        item.reasonZh,
        item.safeNextStep,
      ].join(" ");
      let groupKey = "manual_value";
      if (item.action === "blocked_sensitive" || item.safetyTier === "blocked-never-guess" || compliancePattern.test(text)) {
        groupKey = "compliance_sensitive";
      } else if (bucket.key === "replace_source" || packagePattern.test(text)) {
        groupKey = "package_evidence";
      }
      const group = groupByKey.get(groupKey) || groupByKey.get("manual_value");
      const itemRepairCandidates = groupKey === "manual_value"
        ? safeTextRepairCandidates.filter((candidate) => String(candidate.attributeId || "") === String(item.attributeId || ""))
        : [];
      const itemPackageRepairCandidates = groupKey === "package_evidence" ? safePackageRepairCandidates : [];
      const packageEvidence = groupKey === "package_evidence" ? packageEvidenceForItem(item) : null;
      group.items.push({
        ...item,
        bucketKey: bucket.key || "",
        blockReason: item.reasonZh || group.problemText,
        mustSupplyText: group.mustSupplyText,
        safeNextStep: itemPackageRepairCandidates.length
          ? "当前 workflow 已等待人工；可人工确认可信尺重后写回本地草稿并重新预检，不提交 Ozon。"
          : itemRepairCandidates.length
          ? "当前 workflow 已等待人工；可人工填写该 SKU 文本值，系统只写本地草稿并重新预检，不提交 Ozon。"
          : item.safeNextStep || group.safeNextStep,
        repairStatusText: groupKey === "package_evidence"
          ? (itemPackageRepairCandidates.length ? "可确认写入本地草稿" : "需补证据，不可猜填")
          : itemRepairCandidates.length ? "可安全填写" : "暂不可直接填写",
        textRepairCandidates: itemRepairCandidates,
        packageRepairCandidates: itemPackageRepairCandidates,
        packageEvidence,
      });
    });
  });
  return groups.filter((group) => group.items.length);
}

function renderRequiredAttributeManualWorkbench(workbenchGroups = []) {
  const groups = Array.isArray(workbenchGroups) ? workbenchGroups : [];
  if (!groups.length) return "";
  return `
    <div class="required-attribute-manual-workbench" aria-label="人工属性工作台">
      <div>
        <strong>人工属性工作台</strong>
        <small>本页只读优先：只给当前属性矩阵确认可安全本地填写的普通文本字段提供入口。</small>
      </div>
      <div class="required-attribute-manual-workbench-grid">
        ${groups.map((group) => `
          <article class="required-attribute-manual-workbench-group required-attribute-manual-workbench-group-${escapeHtml(group.key)}">
            <strong>${escapeHtml(group.title)} · ${Number(group.items.length || 0)}</strong>
            <p>${escapeHtml(group.problemText)}</p>
            <small>必须补：${escapeHtml(group.mustSupplyText)}</small>
            <small>安全下一步：${escapeHtml(group.safeNextStep)}</small>
            <div>
              ${group.items.slice(0, 5).map((item) => `
                <span>
                  <b>${escapeHtml(item.attributeName || `属性 ${item.attributeId || ""}`)}</b>
                  <small>#${escapeHtml(item.attributeId || "")} · ${escapeHtml(item.strategy || item.bucketKey || "manual_required")}</small>
                  <small>原因：${escapeHtml(item.blockReason || group.problemText)}</small>
                  <small>要补：${escapeHtml(item.mustSupplyText || group.mustSupplyText)}</small>
                  <small>填写状态：${escapeHtml(item.repairStatusText || "暂不可直接填写")}</small>
                  ${item.packageEvidence ? `
                    <span class="required-attribute-package-evidence">
                      <small>证据状态：${escapeHtml(item.packageEvidence.statusText || "需核实尺重证据")}</small>
                      <small>证据来源：${escapeHtml(item.packageEvidence.sourceText || "当前货源/人工资料")}</small>
                      <small>缺少字段：${escapeHtml(item.packageEvidence.missingText || "重量、长宽高或规格")}</small>
                      <small>补证据动作：${escapeHtml(item.packageEvidence.safeSourceAction || "补齐真实尺重证据后重新预检。")}</small>
                      ${Array.isArray(item.packageEvidence.payloadTargets) && item.packageEvidence.payloadTargets.length ? `
                        <span class="required-attribute-package-targets">
                          ${item.packageEvidence.payloadTargets.slice(0, 4).map((target) => `
                            <button
                              class="ghost"
                              type="button"
                              data-payload-path="${escapeHtml(target.path || "")}"
                              data-payload-label="${escapeHtml(target.label || target.field || "包装字段")}"
                            >定位包装字段</button>
                          `).join("")}
                        </span>
                      ` : ""}
                      ${item.packageEvidence.canWriteDraft && Array.isArray(item.packageRepairCandidates) && item.packageRepairCandidates.length ? `
                        <div class="required-attribute-manual-actions">
                          ${item.packageRepairCandidates.slice(0, 4).map((candidate) => `
                            <button
                              type="button"
                              data-workflow-action="apply-package-info-repair"
                              data-workflow-run-id="${escapeHtml(candidate.runId)}"
                              data-workflow-node-key="${escapeHtml(candidate.nodeKey || "preflight_check")}"
                              data-repair-offer-id="${escapeHtml(candidate.offerId)}"
                              data-repair-package-source="${escapeHtml(candidate.packageInfoSource)}"
                              data-repair-package-weight="${escapeHtml(candidate.packageInfo?.weight || "")}"
                              data-repair-package-depth="${escapeHtml(candidate.packageInfo?.depth || "")}"
                              data-repair-package-width="${escapeHtml(candidate.packageInfo?.width || "")}"
                              data-repair-package-height="${escapeHtml(candidate.packageInfo?.height || "")}"
                              title="只写本地 Payload 草稿并重新预检，不提交 Ozon"
                            >确认写入尺重并预检</button>
                          `).join("")}
                        </div>
                      ` : ""}
                    </span>
                  ` : ""}
                  <small>下一步：${escapeHtml(item.safeNextStep || group.safeNextStep)}</small>
                  ${Array.isArray(item.textRepairCandidates) && item.textRepairCandidates.length ? `
                    <div class="required-attribute-manual-actions">
                      ${item.textRepairCandidates.slice(0, 4).map((candidate) => `
                        <button
                          type="button"
                          data-workflow-action="apply-attribute-text-repair"
                          data-workflow-run-id="${escapeHtml(candidate.runId)}"
                          data-workflow-node-key="${escapeHtml(candidate.nodeKey)}"
                          data-repair-offer-id="${escapeHtml(candidate.offerId)}"
                          data-repair-attribute-id="${escapeHtml(candidate.attributeId)}"
                          title="${escapeHtml(candidate.attributeName || item.attributeName || "文本属性")}"
                        >填写该 SKU 文本并预检</button>
                      `).join("")}
                    </div>
                  ` : ""}
                </span>
              `).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function renderRequiredAttributeManualBacklog(run = {}, node = {}, options = {}) {
  const backlog = run.payloadDraftValidation?.requiredAttributeManualBacklog || node?.output?.requiredAttributeManualBacklog || null;
  if (!backlog || !Number(backlog.totalCount || 0)) return "";
  const buckets = Array.isArray(backlog.buckets) ? backlog.buckets : [];
  const showWorkbench = options.showWorkbench === true;
  const workbenchGroups = showWorkbench ? requiredAttributeManualWorkbenchGroups(backlog) : [];
  return `
    <div class="required-attribute-manual-backlog">
      <div>
        <strong>高频人工属性</strong>
        <small>${escapeHtml(backlog.readinessStatus || "manual_review")} · ${Number(backlog.totalCount || 0)} 项</small>
      </div>
      <p>${escapeHtml(backlog.safeNextAction || "人工处理后重新预检；不会自动提交 Ozon。")}</p>
      ${workbenchGroups.length ? renderRequiredAttributeManualWorkbench(workbenchGroups) : ""}
      <div class="required-attribute-manual-backlog-grid">
        ${buckets.map((bucket) => `
          <article>
            <strong>${escapeHtml(requiredAttributeManualBacklogBucketTitle(bucket))} · ${Number((bucket.items || []).length || 0)}</strong>
            ${(bucket.items || []).slice(0, 4).map((item) => `
              <span>${escapeHtml(item.attributeName || `属性 ${item.attributeId || ""}`)}</span>
            `).join("") || "<small>暂无</small>"}
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function renderRequiredAttributeRuleCandidateIndex(run = {}, node = {}) {
  const index = run.payloadDraftValidation?.requiredAttributeRuleCandidateIndex || node?.output?.requiredAttributeRuleCandidateIndex || null;
  const candidates = Array.isArray(index?.candidates) ? index.candidates : [];
  if (!candidates.length) return "";
  return `
    <div class="required-attribute-rule-candidate-index">
      <div>
        <strong>规则沉淀候选</strong>
        <small>${escapeHtml(index.categoryKey || "")} · ${Number(index.totalCount || candidates.length)} 项</small>
      </div>
      <p>${escapeHtml(index.safeNextAction || "仅作为后续规则沉淀参考；不会自动生成规则或写入 Payload。")}</p>
      <div class="required-attribute-rule-candidate-list">
        ${candidates.slice(0, 6).map((candidate) => `
          <span>
            <b>${escapeHtml(candidate.attributeName || `属性 ${candidate.attributeId || ""}`)}</b>
            <small>${escapeHtml(candidate.ruleStatus || "candidate")} · ${escapeHtml(candidate.suggestedRuleKey || "")}</small>
            ${renderRequiredAttributeRuleCandidateValues(candidate)}
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderRequiredAttributeRuleCandidateValues(item = {}) {
  const values = Array.isArray(item.candidateValues) ? item.candidateValues : [];
  if (!values.length) return "";
  return `
    <small class="required-attribute-rule-candidate-values">
      候选值 ${values.slice(0, 3).map((value) => {
        const occurrence = Number(value.occurrenceCount || 0);
        const countText = occurrence ? ` · ${occurrence} 次` : "";
        const sourceText = value.source ? ` · ${value.source}` : "";
        return `#${escapeHtml(value.dictionaryValueId || "")} ${escapeHtml(value.value || "")}${escapeHtml(sourceText)}${escapeHtml(countText)}`;
      }).join(" / ")}
    </small>
  `;
}

function renderRequiredAttributeRuleCandidateHistory(run = {}, node = {}) {
  const history = run.payloadDraftValidation?.requiredAttributeRuleCandidateHistory
    || node?.output?.requiredAttributeRuleCandidateHistory
    || run.summary?.requiredAttributeRuleCandidateHistory
    || null;
  const queue = Array.isArray(history?.reviewQueue) ? history.reviewQueue : [];
  if (!queue.length) return "";
  return `
    <div class="required-attribute-rule-candidate-history">
      <div>
        <strong>类目规则池草案</strong>
        <small>${Number(history.readyForReviewCount || 0)} 待审核 · ${Number(history.ruleCandidateCount || queue.length)} 类规则</small>
      </div>
      <p>${escapeHtml(history.safeNextStep || "仅供人工审核沉淀规则；不会自动生成规则、写 Payload 或提交 Ozon。")}</p>
      <div class="required-attribute-rule-candidate-history-list">
        ${queue.slice(0, 6).map((item) => `
          <span>
            <b>${escapeHtml(item.attributeName || `属性 ${item.attributeId || ""}`)}</b>
            <small>${escapeHtml(item.categoryKey || "")} · ${escapeHtml(item.ruleStatus || "collect_more_samples")} · ${Number(item.occurrenceCount || 0)} 次</small>
            ${renderRequiredAttributeRuleCandidateValues(item)}
            <small>样本 ${Number((item.sampleProductIds || []).length || 0)} 个 · ${escapeHtml(item.safeNextStep || "人工审核前不生成规则。")}</small>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function requiredAttributeRuleCandidateKey(item = {}) {
  // Workflow history rows may only have a display name; persisted audit evidence uses the strict key below.
  return [item.categoryKey || "", item.attributeId || item.attributeName || ""].join(":");
}

function strictRuleApprovalAuditCandidateKey(item = {}) {
  const categoryKey = String(item.categoryKey || "").trim();
  const attributeId = String(item.attributeId || "").trim();
  if (!categoryKey || !attributeId) return "";
  return [categoryKey, attributeId].join(":");
}

function collectRuleApprovalAuditIntentsByCandidate(intents = []) {
  const grouped = new Map();
  (Array.isArray(intents) ? intents : []).forEach((intent) => {
    const key = strictRuleApprovalAuditCandidateKey(intent);
    if (!key) return;
    const items = grouped.get(key) || [];
    items.push(intent);
    grouped.set(key, items);
  });
  grouped.forEach((items) => {
    items.sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
  });
  return grouped;
}

function collectRulePublishReviewIntentsByCandidate(intents = []) {
  const grouped = new Map();
  (Array.isArray(intents) ? intents : []).forEach((intent) => {
    const key = strictRuleApprovalAuditCandidateKey(intent);
    if (!key) return;
    const items = grouped.get(key) || [];
    items.push(intent);
    grouped.set(key, items);
  });
  grouped.forEach((items) => {
    items.sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
  });
  return grouped;
}

function collectRequiredAttributeRulePool(runs = [], auditIntents = [], publishReviewIntents = []) {
  const pool = new Map();
  const approvalAuditIntents = collectRuleApprovalAuditIntentsByCandidate(auditIntents);
  const publishReviewIntentsByCandidate = collectRulePublishReviewIntentsByCandidate(publishReviewIntents);
  (Array.isArray(runs) ? runs : []).forEach((run) => {
    const history = run.summary?.requiredAttributeRuleCandidateHistory || null;
    const queue = Array.isArray(history?.reviewQueue) ? history.reviewQueue : [];
    const approvalDrafts = new Map((Array.isArray(history?.approvalDraftQueue) ? history.approvalDraftQueue : [])
      .map((draft) => [requiredAttributeRuleCandidateKey(draft), draft]));
    queue.forEach((item) => {
      const key = requiredAttributeRuleCandidateKey(item);
      const current = pool.get(key) || {
        categoryKey: item.categoryKey || "",
        attributeId: item.attributeId || "",
        attributeName: item.attributeName || "",
        ruleStatus: item.ruleStatus || "collect_more_samples",
        occurrenceCount: 0,
        sampleProductIds: new Set(),
        sampleRunIds: new Set(),
        sourceRunIds: new Set(),
        candidateValueCounts: new Map(),
        safeNextStep: item.safeNextStep || "",
        approvalDraft: approvalDrafts.get(key) || null,
        approvalAuditIntents: approvalAuditIntents.get(strictRuleApprovalAuditCandidateKey(item)) || [],
        publishReviewIntents: publishReviewIntentsByCandidate.get(strictRuleApprovalAuditCandidateKey(item)) || [],
      };
      current.occurrenceCount = Math.max(Number(current.occurrenceCount || 0), Number(item.occurrenceCount || 0));
      (item.sampleProductIds || []).forEach((id) => current.sampleProductIds.add(id));
      (item.sampleRunIds || []).forEach((id) => current.sampleRunIds.add(id));
      if (run.id) current.sourceRunIds.add(run.id);
      if (item.ruleStatus === "ready_for_review") current.ruleStatus = "ready_for_review";
      if (!current.safeNextStep && item.safeNextStep) current.safeNextStep = item.safeNextStep;
      if (!current.approvalDraft && approvalDrafts.has(key)) current.approvalDraft = approvalDrafts.get(key);
      (item.candidateValues || []).forEach((value) => {
        const valueKey = [value.dictionaryValueId || "", value.value || "", value.source || ""].join(":");
        if (!String(value.dictionaryValueId || "").trim() || !String(value.value || "").trim()) return;
        const currentValue = current.candidateValueCounts.get(valueKey) || {
          dictionaryValueId: value.dictionaryValueId,
          value: value.value,
          confidence: Number(value.confidence || 0),
          source: value.source || "",
          occurrenceCount: 0,
        };
        currentValue.occurrenceCount = Math.max(Number(currentValue.occurrenceCount || 0), Number(value.occurrenceCount || 1));
        currentValue.confidence = Math.max(Number(currentValue.confidence || 0), Number(value.confidence || 0));
        current.candidateValueCounts.set(valueKey, currentValue);
      });
      pool.set(key, current);
    });
  });
  return [...pool.values()]
    .map((item) => {
      const { candidateValueCounts, ...publicItem } = item;
      return {
        ...publicItem,
        sampleProductIds: [...item.sampleProductIds],
        sampleRunIds: [...item.sampleRunIds],
        sourceRunIds: [...item.sourceRunIds],
        candidateValues: [...candidateValueCounts.values()]
          .sort((left, right) => Number(right.occurrenceCount || 0) - Number(left.occurrenceCount || 0) || String(left.value || "").localeCompare(String(right.value || ""))),
        latestApprovalAudit: item.approvalAuditIntents[0] || null,
        latestPublishReview: item.publishReviewIntents[0] || null,
      };
    })
    .sort((a, b) => Number(b.occurrenceCount || 0) - Number(a.occurrenceCount || 0));
}

function rulePoolItemMatchesFilter(item = {}, filter = {}) {
  const status = filter.status || "all";
  const keyword = String(filter.keyword || "").trim().toLowerCase();
  if (status !== "all" && item.ruleStatus !== status) return false;
  if (!keyword) return true;
  return [
    item.attributeName,
    item.attributeId,
    item.categoryKey,
    ...(item.sampleRunIds || []),
    ...(item.sourceRunIds || []),
    ...((item.approvalAuditIntents || []).flatMap((audit) => [
      audit.id,
      audit.approver,
      audit.intentStatus,
      audit.effectStatus,
    ])),
    ...((item.publishReviewIntents || []).flatMap((review) => [
      review.id,
      review.reviewer,
      review.intentStatus,
      review.publishStatus,
      review.effectStatus,
    ])),
  ].some((value) => String(value || "").toLowerCase().includes(keyword));
}

function renderRuleApprovalAuditLog(audit = null) {
  if (!audit) return "";
  const proof = audit.proof || {};
  const locks = audit.safetyLocks || {};
  const lockText = [
    `draftWrite:${locks.draftWrite ? "异常开启" : "关闭"}`,
    `ozonSubmit:${locks.ozonSubmit ? "异常开启" : "关闭"}`,
    `ruleEnable:${locks.ruleEnable ? "异常开启" : "关闭"}`,
    `workflowUnlock:${locks.workflowUnlock ? "异常开启" : "关闭"}`,
  ].join(" · ");
  return `
    <div class="rule-pool-audit-log">
      <strong>审计记录</strong>
      <span>${escapeHtml(audit.intentStatus || "stored_for_review")} · ${escapeHtml(audit.effectStatus || "no_rule_or_payload_effect")}</span>
      <small>批准人：${escapeHtml(audit.approver || proof.approvedBy || "未记录")} · 时间：${escapeHtml(audit.createdAt ? new Date(audit.createdAt).toLocaleString("zh-CN") : "未记录")}</small>
      <small>独立预检：${escapeHtml(proof.independentPreflightRunId || "未记录")} · ${proof.independentPreflightPassed === true ? "已通过" : "未通过"}</small>
      <small>安全锁：${escapeHtml(lockText)}</small>
      <p>${escapeHtml(audit.auditReadiness?.safeNextStep || "审计记录仅证明人工意图；启用规则前仍需独立发布闸和预检回归。")}</p>
    </div>
  `;
}

function renderRulePublishReviewLog(review = null) {
  if (!review) return "";
  const proof = review.proof || {};
  const locks = review.safetyLocks || {};
  const sampleCoverage = review.sampleCoverage || {};
  const lockText = [
    `ruleEnable:${locks.ruleEnable ? "异常开启" : "关闭"}`,
    `payloadWrite:${locks.payloadWrite ? "异常开启" : "关闭"}`,
    `workflowUnlock:${locks.workflowUnlock ? "异常开启" : "关闭"}`,
    `ozonSubmit:${locks.ozonSubmit ? "异常开启" : "关闭"}`,
  ].join(" · ");
  return `
    <div class="rule-pool-publish-review-log">
      <strong>发布复核记录</strong>
      <span>${escapeHtml(review.intentStatus || "stored_for_publish_review")} · ${escapeHtml(review.publishStatus || "review_only_not_enabled")}</span>
      <small>审核人：${escapeHtml(review.reviewer || proof.reviewedBy || "未记录")} · 时间：${escapeHtml(review.createdAt ? new Date(review.createdAt).toLocaleString("zh-CN") : "未记录")}</small>
      <small>样本：${Number(sampleCoverage.distinctProductCount || 0)} 个商品 · 独立预检：${escapeHtml(proof.independentPreflightRunId || "未记录")} · ${proof.independentPreflightPassed === true ? "已通过" : "未通过"}</small>
      <small>安全锁：${escapeHtml(lockText)}</small>
      <p>${escapeHtml(review.safeNextStep || "发布复核记录只证明人工复核意图；不能自动启用规则、写草稿或提交 Ozon。")}</p>
    </div>
  `;
}

function rulePublishSafetyLocksClosed(locks = {}) {
  return ["draftWrite", "ozonSubmit", "ruleEnable", "workflowUnlock"]
    .every((key) => locks[key] === false);
}

function evaluateRulePublishGate(item = {}) {
  const audit = item.latestApprovalAudit || null;
  const proof = audit?.proof || {};
  const sampleCount = Number((item.sampleProductIds || []).length || 0);
  const missingProofs = [];
  const blockedReasons = [];
  if (item.ruleStatus !== "ready_for_review" || sampleCount < 2) {
    missingProofs.push("至少两个不同商品样本");
  }
  if (!audit) {
    missingProofs.push("审计意图记录");
  } else {
    if (audit.intentStatus !== "stored_for_review") blockedReasons.push("审计意图状态异常");
    if (audit.effectStatus !== "no_rule_or_payload_effect") blockedReasons.push("审计记录存在写入效果");
    if (!proof.independentPreflightRunId || proof.independentPreflightPassed !== true) {
      missingProofs.push("独立预检通过记录");
    }
    const rollbackText = [audit.rollbackPlan, audit.note, proof.rollbackPlan].filter(Boolean).join(" ");
    if (!/回滚|撤回|禁用|rollback|disable/i.test(rollbackText)) {
      missingProofs.push("回滚方案");
    }
    if (!rulePublishSafetyLocksClosed(audit.safetyLocks || {})) {
      blockedReasons.push("安全锁存在开启项");
    }
  }
  const status = blockedReasons.length
    ? "publish_blocked"
    : missingProofs.length ? "needs_evidence" : "ready_for_publish_review";
  const labelMap = {
    publish_blocked: "发布被阻断",
    needs_evidence: "需补证据",
    ready_for_publish_review: "可进入发布复核",
  };
  return {
    readOnly: true,
    status,
    label: labelMap[status] || labelMap.needs_evidence,
    missingProofs,
    blockedReasons,
    canEnableRule: false,
    canWritePayload: false,
    forbiddenEffects: ["rule_enable", "payload_write", "workflow_unlock", "ozon_submit"],
    safeNextStep: status === "ready_for_publish_review"
      ? "只读发布闸已满足发布复核条件；下一阶段仍需独立人工发布流程，不能在本页启用规则。"
      : status === "publish_blocked"
        ? "先修复阻断原因并重新完成审计与独立预检；本页不会启用规则。"
        : "先补齐样本、审计、独立预检或回滚方案；本页只展示缺口。",
  };
}

function renderRulePublishGate(item = {}) {
  const gate = evaluateRulePublishGate(item);
  return `
    <div class="rule-pool-publish-gate rule-pool-publish-gate-${escapeHtml(gate.status)}">
      <strong>只读发布闸</strong>
      <span>${escapeHtml(gate.label)} · ${escapeHtml(gate.status)}</span>
      <small>缺少证明：${(gate.missingProofs || []).map(escapeHtml).join("、") || "无"}</small>
      <small>阻断原因：${(gate.blockedReasons || []).map(escapeHtml).join("、") || "无"}</small>
      <small>禁止效果：${(gate.forbiddenEffects || []).map(escapeHtml).join("、")}</small>
      <p>${escapeHtml(gate.safeNextStep)}</p>
    </div>
  `;
}

function renderListingRequiredAttributeRulePoolWorkbench() {
  const el = $("#listingRulePoolWorkbench");
  if (!el) return;
  const filter = state.rulePoolFilter || { status: "all", keyword: "" };
  const items = collectRequiredAttributeRulePool(state.workflowRuns, state.ruleApprovalAuditIntents, state.rulePublishReviewIntents);
  const filtered = items.filter((item) => rulePoolItemMatchesFilter(item, filter));
  const readyCount = items.filter((item) => item.ruleStatus === "ready_for_review").length;
  const collectMoreCount = items.filter((item) => item.ruleStatus !== "ready_for_review").length;
  const auditCount = items.reduce((count, item) => count + Number((item.approvalAuditIntents || []).length || 0), 0);
  const publishReviewCount = items.reduce((count, item) => count + Number((item.publishReviewIntents || []).length || 0), 0);
  el.innerHTML = `
    <div class="section-headline">
      <div>
        <h2>规则审查池</h2>
        <p class="hint">聚合真实 workflow 的类目属性候选，只做筛选和人工判断准备；不会自动生成规则、写 Payload 或提交 Ozon。</p>
      </div>
      <span class="module-map-badge soft">${Number(filtered.length || 0)}/${Number(items.length || 0)} 项</span>
    </div>
    <div class="rule-pool-controls">
      <label class="field">
        <span>状态筛选</span>
        <select id="rulePoolStatusFilter" class="rule-pool-status-filter">
          <option value="all"${filter.status === "all" ? " selected" : ""}>全部候选</option>
          <option value="ready_for_review"${filter.status === "ready_for_review" ? " selected" : ""}>待人工审核</option>
          <option value="collect_more_samples"${filter.status === "collect_more_samples" ? " selected" : ""}>继续积累样本</option>
        </select>
      </label>
      <label class="field">
        <span>关键词</span>
        <input id="rulePoolKeyword" class="rule-pool-keyword" value="${escapeHtml(filter.keyword || "")}" placeholder="属性、类目、样本 workflow" />
      </label>
      <div class="rule-pool-stats">
        <span>待审 ${Number(readyCount || 0)}</span>
        <span>积累样本 ${Number(collectMoreCount || 0)}</span>
        <span>审计记录 ${Number(auditCount || 0)}</span>
        <span>发布复核 ${Number(publishReviewCount || 0)}</span>
      </div>
    </div>
    <div class="rule-pool-list">
      ${filtered.length ? filtered.slice(0, 12).map((item) => `
        <article class="rule-pool-row rule-pool-row-${escapeHtml(item.ruleStatus || "collect_more_samples")}">
          <div>
            <strong>${escapeHtml(item.attributeName || `属性 ${item.attributeId || ""}`)}</strong>
            <small>${escapeHtml(item.categoryKey || "")} · ${escapeHtml(item.ruleStatus || "collect_more_samples")}</small>
          </div>
          <div>
            <span>${Number(item.occurrenceCount || 0)} 次出现</span>
            <small>样本 ${Number((item.sampleProductIds || []).length || 0)} 个 · workflow ${(item.sampleRunIds || item.sourceRunIds || []).slice(0, 3).map(escapeHtml).join("、") || "-"}</small>
            ${renderRequiredAttributeRuleCandidateValues(item)}
          </div>
          <p>${escapeHtml(item.safeNextStep || "人工审核前不生成规则；确认后仍需独立测试和预检。")}</p>
          ${item.approvalDraft ? `
            <div class="rule-pool-approval-draft">
              <strong>人工批准草案</strong>
              <span>${escapeHtml(item.approvalDraft.draftStatus || "pending_human_approval")} · ${Number(item.approvalDraft.occurrenceCount || item.occurrenceCount || 0)} 个样本信号</span>
              <small>检查项：${(item.approvalDraft.requiredChecks || []).map(escapeHtml).join("、") || "人工复核、独立预检"}</small>
              <small>禁止效果：${(item.approvalDraft.forbiddenEffects || []).map(escapeHtml).join("、") || "不写草稿、不提交、不启用规则"}</small>
              ${item.approvalDraft.auditReadiness ? `
                <div class="rule-pool-audit-readiness">
                  <span>审计准备：${escapeHtml(item.approvalDraft.auditReadiness.status || "blocked_until_audit_ready")}</span>
                  <small>缺少证明：${(item.approvalDraft.auditReadiness.missingProofs || []).map(escapeHtml).join("、") || "样本复核、人工批准、独立预检"}</small>
                  <small>存储批准：${item.approvalDraft.auditReadiness.status === "audit_ready" && item.approvalDraft.auditReadiness.canStoreApproval ? "允许" : "暂不允许"} · 启用规则：${item.approvalDraft.auditReadiness.status === "audit_ready" && item.approvalDraft.auditReadiness.canEnableRule ? "允许" : "暂不允许"}</small>
                  <p>${escapeHtml(item.approvalDraft.auditReadiness.safeNextStep || "先补齐审计记录设计和独立预检结果，再进入真实人工批准存储。")}</p>
                </div>
              ` : ""}
              <p>${escapeHtml(item.approvalDraft.safeNextStep || "批准前只做草案预览；不会自动写草稿、提交 Ozon 或启用规则。")}</p>
            </div>
          ` : ""}
          ${renderRuleApprovalAuditLog(item.latestApprovalAudit)}
          ${renderRulePublishReviewLog(item.latestPublishReview)}
          ${renderRulePublishGate(item)}
        </article>
      `).join("") : `<p class="hint">当前筛选下没有规则候选。规则池只读，不会因为筛选而写入 Payload 或改变工作流状态。</p>`}
    </div>
  `;
}

function renderRequiredAttributeFillPlan(run = {}, node = {}) {
  const plan = run.payloadDraftValidation?.requiredAttributeFillPlan || node?.output?.requiredAttributeFillPlan || [];
  if (!Array.isArray(plan) || !plan.length) return "";
  const groups = requiredFillPlanGroups(plan);
  return `
    <section class="workflow-required-fill-plan">
      <div class="workflow-required-fill-plan-head">
        <div>
          <strong>必填属性填充计划</strong>
          <p class="hint">只读计划：展示来源、置信度、安全分层和安全动作；建议项需人工确认，且不会自动提交 Ozon。</p>
        </div>
        <span>${plan.length} 个必填属性</span>
      </div>
      ${renderRequiredAttributeFillSummary(run, node, plan)}
      ${renderRequiredAttributeManualBacklog(run, node, { showWorkbench: false })}
      ${renderRequiredAttributeRuleCandidateIndex(run, node)}
      ${renderRequiredAttributeRuleCandidateHistory(run, node)}
      ${groups.map((group) => `
        <div class="required-fill-plan-group required-fill-plan-group-${escapeHtml(group.key)}">
          <strong>${escapeHtml(group.title)}</strong>
          <div class="required-fill-plan-list">
            ${group.rows.slice(0, 12).map((row) => `
              <div class="required-fill-plan-row required-fill-plan-row-${escapeHtml(row.action || "manual_required")}">
                <div>
                  <strong>${escapeHtml(row.name || `属性 ${row.attributeId || ""}`)}</strong>
                  <small>#${escapeHtml(row.attributeId || "")} · ${escapeHtml(row.strategy || "")} · ${escapeHtml(row.confidence || "")}</small>
                  <small>${escapeHtml(requiredFillPlanSafetyText(row))}</small>
                  <small>字段路径：${escapeHtml(row.fieldPath || `items[*].attributes[id=${row.attributeId || "*"}]`)}</small>
                </div>
                <div>
                  <span>${escapeHtml(requiredFillPlanActionText(row.action))}</span>
                  ${row.value ? `<code>${escapeHtml(row.value)}</code>` : ""}
                  ${row.dictionaryValueId ? `<small>字典 #${escapeHtml(row.dictionaryValueId)}</small>` : ""}
                  ${renderRequiredFillPlanCandidates(row)}
                </div>
                <p>${escapeHtml(row.reasonZh || "修复后重新预检；不会自动提交 Ozon。")}</p>
                <p>${escapeHtml(row.safeNextStep || "修复后重新预检；不会自动提交 Ozon。")}</p>
                <small>副作用：${escapeHtml(row.sideEffect || "仅本地草稿预检；不会写入 Ozon、提交、修改价格或库存。")}</small>
              </div>
            `).join("")}
          </div>
        </div>
      `).join("")}
    </section>
  `;
}

function variantWorkbenchStatusText(status = "") {
  const map = {
    valid: "可继续",
    duplicate_aspect: "重复组合",
    missing_aspect: "缺可变特性",
    missing_image: "缺 SKU 图",
    pricing_blocked: "价格阻塞",
  };
  return map[status] || "待检查";
}

function variantWorkbenchImageText(status = "") {
  const map = {
    unique: "已区分",
    not_unique: "未区分",
    missing: "缺失",
  };
  return map[status] || "待检查";
}

function variantWorkbenchPayloadPath(row = {}) {
  const aspect = variantWorkbenchPrimaryAspect(row);
  return String(aspect?.id || row.offerId || "");
}

function variantWorkbenchPrimaryAspect(row = {}) {
  return (Array.isArray(row.aspects) ? row.aspects : []).find((aspect) => aspect?.id || aspect?.name) || null;
}

function variantCoverageStatusText(readinessStatus = "") {
  const labels = {
    ready: "覆盖达标",
    warning: "图片待优化",
    blocked: "变体阻塞",
  };
  return labels[readinessStatus] || "待预检";
}

function renderVariantSuggestedAspects(rowOrSuggestion = {}) {
  const suggestedAspects = Array.isArray(rowOrSuggestion.suggestedAspects) ? rowOrSuggestion.suggestedAspects : [];
  if (!suggestedAspects.length) return "";
  return `
    <div class="variant-suggested-aspects">
      <strong>1688 规格候选</strong>
      ${suggestedAspects.slice(0, 4).map((aspect) => `
        <span>${escapeHtml(aspect.attributeName || `属性 ${aspect.attributeId || ""}`)}：${escapeHtml(aspect.value || "")}</span>
      `).join("")}
      <small>${escapeHtml(rowOrSuggestion.sourceVariant?.spec ? `来源规格：${rowOrSuggestion.sourceVariant.spec}` : "只读候选，人工确认后重新预检。")}</small>
    </div>
  `;
}

function renderVariantRepairSuggestions(row = {}) {
  const suggestions = Array.isArray(row.repairSuggestions) ? row.repairSuggestions : [];
  if (!suggestions.length) return "";
  return `
    <div class="variant-repair-suggestions">
      <strong>只读修复建议</strong>
      ${suggestions.map((suggestion) => `
        <span>${escapeHtml(suggestion.title || suggestion.code || "修复建议")}：${escapeHtml(suggestion.action || "")}</span>
        ${renderVariantSuggestedAspects(suggestion)}
        <small>${escapeHtml(suggestion.nextStep || "修复后重新预检；不会自动提交 Ozon。")}</small>
      `).join("")}
    </div>
  `;
}

function renderVariantGroupDifferenceSuggestions(workbench = {}) {
  const suggestions = Array.isArray(workbench.differenceSuggestions) ? workbench.differenceSuggestions : [];
  if (!suggestions.length) return "";
  return `
    <div class="variant-group-difference-suggestions">
      <strong>整组差异建议</strong>
      ${suggestions.map((suggestion) => `
        <article>
          <span>${escapeHtml((suggestion.affectedOfferIds || []).join(" / ") || suggestion.duplicateGroupId || "重复组")}</span>
          <p>${escapeHtml(suggestion.action || "整组检查变体差异。")}</p>
          ${suggestion.copyText ? `<code data-variant-difference-copy="${escapeHtml(suggestion.copyText)}">整组修复说明：${escapeHtml(suggestion.copyText)}</code>` : ""}
          ${(suggestion.repairTargets || []).length ? `
            <div class="variant-group-difference-targets">
              ${(suggestion.repairTargets || []).map((target) => `
                <span>
                  <b>${escapeHtml(target.offerId || "SKU")}</b>
                  <small>${escapeHtml(target.attributeName || `属性 ${target.attributeId || ""}`)}：${escapeHtml(target.currentValue || "空")}</small>
                  <em
                    class="workflow-payload-locator"
                    data-payload-path="${escapeHtml(target.payloadPath || "")}"
                    data-payload-label="${escapeHtml(target.payloadLabel || "变体差异字段")}"
                    data-payload-offer-id="${escapeHtml(target.offerId || "")}"
                    data-payload-attribute-id="${escapeHtml(target.attributeId || "")}"
                    title="仅定位，不修改数据"
                  >定位该差异字段</em>
                </span>
              `).join("")}
            </div>
          ` : ""}
          <small>${escapeHtml(suggestion.nextStep || "整组修复后重新预检；不会自动提交 Ozon。")}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function renderVariantConfigurationWorkbench(run = {}, node = {}) {
  const workbench = run.payloadDraftValidation?.variantConfiguration || node?.output?.variantConfiguration || null;
  const rows = Array.isArray(workbench?.rows) ? workbench.rows : [];
  if (rows.length < 2) return "";
  const summary = workbench.summary || {};
  const sourceBinding = workbench.sourceVariantBinding?.summary || {};
  const sourceBindingText = sourceBinding.ready
    ? `来源绑定 ${Number(sourceBinding.boundCount || 0)}/${Number(sourceBinding.itemCount || rows.length)} 完整`
    : `来源绑定 ${Number(sourceBinding.boundCount || 0)}/${Number(sourceBinding.itemCount || rows.length)}；缺失 ${Number(sourceBinding.missingCount || 0)}，重复 ${Number(sourceBinding.duplicateCount || 0)}`;
  return `
    <section class="workflow-variant-workbench">
      <div class="workflow-variant-workbench-head">
        <div>
          <strong>变体配置工作簿</strong>
          <p class="hint">只读工作簿：逐 SKU 查看型号、可变特性、SKU 图和重复组合；修复后必须重新预检。</p>
        </div>
        <span>${Number(summary.blockedRowCount || 0)} 个阻塞 / ${Number(summary.imageWarningRowCount || 0)} 个图片提醒</span>
      </div>
      <div class="workflow-variant-coverage-summary" aria-label="变体覆盖摘要">
        <strong>变体覆盖摘要：${escapeHtml(variantCoverageStatusText(summary.readinessStatus))}</strong>
        <span>属性覆盖 ${Number(summary.aspectCoveredRowCount || 0)}/${Number(summary.rowCount || rows.length)}，缺失 ${Number(summary.missingAspectRowCount || 0)}，重复 ${Number(summary.duplicateAspectRowCount || 0)}</span>
        <span>1688 规格候选 ${Number(summary.suggestedAspectRowCount || 0)} 行 / ${Number(summary.suggestedAspectCount || 0)} 个值</span>
        <span>SKU 图区分 ${Number(summary.uniqueSkuImageRowCount || 0)}/${Number(summary.rowCount || rows.length)}，缺图 ${Number(summary.missingSkuImageRowCount || 0)}，未区分 ${Number(summary.nonUniqueSkuImageRowCount || 0)}</span>
        <span class="${sourceBinding.ready ? "ok-badge" : "warn-badge"}">1688 ${escapeHtml(sourceBindingText)}</span>
        <small>${escapeHtml(summary.safeNextAction || "修复后重新预检；不会自动提交 Ozon。")}</small>
      </div>
      ${renderVariantGroupDifferenceSuggestions(workbench)}
      <div class="workflow-variant-workbench-table-wrap">
        <table class="workflow-variant-workbench-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>型号</th>
              <th>可变特性</th>
              <th>SKU 图</th>
              <th>判断</th>
              <th>安全下一步</th>
            </tr>
          </thead>
          <tbody>
            ${rows.slice(0, 50).map((row) => {
              const primaryAspect = variantWorkbenchPrimaryAspect(row);
              return `
              <tr class="variant-workbench-row variant-workbench-row-${escapeHtml(row.rowStatus || "valid")}">
                <td>
                  <code>${escapeHtml(row.offerId || "-")}</code>
                  ${row.sourceVariant ? `<small class="variant-source-binding ${row.sourceVariant.sourceSkuId ? "is-bound" : "is-missing"}">${row.sourceVariant.sourceSkuId ? `1688 SKU：${escapeHtml(row.sourceVariant.sourceSkuId)}` : "缺少 1688 SKU 来源 ID"}</small>` : `<small class="variant-source-binding is-missing">未匹配 1688 来源变体</small>`}
                  ${row.sourceVariant?.sourceSkuId ? "" : `<button type="button" class="ghost" data-variant-source-task data-run-id="${escapeHtml(run.id || "")}">回到来源变体</button>`}
                </td>
                <td>${escapeHtml(row.modelName || "未读取")}</td>
                <td>${(row.aspects || []).length
                  ? (row.aspects || []).map((aspect) => `<span>${escapeHtml(aspect.name || `属性 ${aspect.id || ""}`)}：${escapeHtml(aspect.value || "空")}</span>`).join("")
                  : `缺少可变特性${renderVariantSuggestedAspects(row)}`}</td>
                <td>
                  <span class="variant-workbench-image variant-workbench-image-${escapeHtml(row.skuImage?.status || "missing")}">${escapeHtml(variantWorkbenchImageText(row.skuImage?.status))}</span>
                  <small>${escapeHtml(row.skuImage?.message || "SKU 图待检查")}</small>
                </td>
                <td>
                  <strong>${escapeHtml(variantWorkbenchStatusText(row.rowStatus))}</strong>
                  ${(row.reasons || []).some((reason) => reason.code === "DUPLICATE_ASPECT") ? `<small>重复组合</small>` : ""}
                </td>
                <td>
                  <span>${escapeHtml(row.safeNextAction || "重新预检后继续。")}</span>
                  ${renderVariantRepairSuggestions(row)}
                  ${variantWorkbenchPayloadPath(row) ? `<button
                    type="button"
                    class="ghost workflow-payload-locator"
                    data-payload-path="${escapeHtml(variantWorkbenchPayloadPath(row))}"
                    data-payload-label="${escapeHtml(`${row.offerId || "SKU"} / 变体属性`)}"
                    data-payload-offer-id="${escapeHtml(row.offerId || "")}"
                    data-payload-attribute-id="${escapeHtml(primaryAspect?.id || "")}"
                    title="仅定位，不修改数据"
                  >定位该 SKU 属性</button>
                  <small>仅定位，不修改数据</small>` : ""}
                </td>
              </tr>
            `; }).join("")}
          </tbody>
        </table>
      </div>
      ${rows.length > 50 ? `<p class="hint">已显示前 50 个 SKU，其余变体请在 Payload 草稿中继续检查。</p>` : ""}
    </section>
  `;
}

function workflowPayloadIssueSummary(issues = []) {
  const counts = new Map();
  for (const issue of issues) {
    const code = String(issue?.code || "UNKNOWN");
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!groups.length) return "";
  return `
    <div class="workflow-payload-issue-summary">
      <strong>按错误码汇总</strong>
      <div class="workflow-payload-issue-summary-list">
        ${groups.map(([code, count]) => `
          <span>规则/${escapeHtml(code)}：${count}</span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderVariantGroupingDefectCard(node = {}) {
  const output = node.output || {};
  const diagnosis = output.variantGroupingDiagnosis || null;
  const repairDraft = output.variantGroupingRepairDraft || null;
  if (output.reasonCode !== "VARIANT_GROUPING_FAILED" || !diagnosis) return "";
  const rows = Array.isArray(diagnosis.rows) ? diagnosis.rows : [];
  const duplicateCount = Array.isArray(diagnosis.duplicateGroups) ? diagnosis.duplicateGroups.length : 0;
  return `
    <section class="variant-grouping-defect">
      <div class="variant-grouping-defect-head">
        <div>
          <strong>变体合并失败</strong>
          <p>发现 ${duplicateCount} 组重复的 Ozon 可变特征。必须保留全部 SKU，修正后整组重提。</p>
        </div>
        <span>${rows.length} 个 SKU</span>
      </div>
      <div class="variant-grouping-table-wrap">
        <table class="variant-grouping-table">
          <thead><tr><th>SKU</th><th>型号</th><th>可变特征</th><th>判断</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="${row.duplicateGroup ? "duplicate" : "unique"}">
                <td><code>${escapeHtml(row.offerId || "-")}</code></td>
                <td>${escapeHtml(row.modelValue || "未读取")}</td>
                <td>${(row.aspects || []).length
                  ? (row.aspects || []).map((aspect) => `<span>${escapeHtml(aspect.name)}：${escapeHtml(aspect.value || "空")}</span>`).join("")
                  : "未读取可变特征"}</td>
                <td>${row.duplicateGroup ? `重复组 ${escapeHtml(row.duplicateGroup)}` : "唯一"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <p class="hint">生成操作只会把完整批次写入 Payload 编辑器并保存草稿，不会自动提交 Ozon。</p>
      <button class="primary" data-workflow-action="generate-variant-repair-draft" ${repairDraft?.ok ? "" : "disabled"}>生成整组修复草稿</button>
      ${repairDraft && !repairDraft.ok ? `<small class="variant-grouping-error">${escapeHtml(repairDraft.message || "缺少完整整组 Payload")}</small>` : ""}
    </section>
  `;
}

function renderWorkflowPricingDiagnosis(node = {}) {
  const pricingDiagnosis = node.output?.pricingDiagnosis || node.diagnosis?.pricingDiagnosis || null;
  if (!pricingDiagnosis || !Number(pricingDiagnosis.priceCny || 0)) return "";
  const pricingRiskCode = /^PRICING_/.test(String(node.diagnosis?.reasonCode || "")) ? String(node.diagnosis.reasonCode) : "";
  const canAcceptPricingRisk = ["PRICING_PROFIT_LOW", "PRICING_LOGISTICS_RATIO_HIGH"].includes(pricingRiskCode) && node.branch !== "blocked";
  const packageInfo = pricingDiagnosis.package || {};
  const level = pricingDiagnosis.level || {};
  const variants = Array.isArray(pricingDiagnosis.variants) ? pricingDiagnosis.variants : [];
  const steps = Array.isArray(pricingDiagnosis.steps) ? pricingDiagnosis.steps : [];
  const commissionSource = pricingDiagnosis.commissionSource || {};
  const minPriceSource = pricingDiagnosis.minPriceSource || {};
  const oldPriceSource = pricingDiagnosis.oldPriceSource || {};
  const marginFloor = pricingDiagnosis.marginFloor || {};
  const procurementEvidence = pricingDiagnosis.procurementEvidence || null;
  const procurementMissingLabels = {
    supplier: "供应商",
    moq: "MOQ",
    price_tiers: "数量绑定阶梯价",
  };
  const procurementMissing = Array.isArray(procurementEvidence?.missing)
    ? procurementEvidence.missing.map((key) => procurementMissingLabels[key] || key)
    : [];
  const procurementActions = Array.isArray(node.diagnosis?.recommendedActions)
    ? node.diagnosis.recommendedActions
    : [];
  const commissionRateText = Number(pricingDiagnosis.commissionRate || 0)
    ? `${Math.round(Number(pricingDiagnosis.commissionRate || 0) * 1000) / 10}%`
    : "-";
  const profitStatus = String(pricingDiagnosis.profitStatus || "unknown");
  const profitStatusText = profitStatus === "observed"
    ? "已核对"
    : profitStatus === "estimate"
      ? "估算（未核对结算）"
      : "未知（佣金/结算证据不足）";
  const commissionIsDefault = String(commissionSource.source || "manual_default") === "manual_default";
  const commissionStatusText = commissionIsDefault
    ? "未知（默认比例仅供试算）"
    : `估算（${commissionSource.label || "来源待核对"}）`;
  const pricingNextAction = profitStatus === "observed"
    ? ""
    : "下一步：补齐当前店铺/类目佣金、物流/结算规则和汇率证据，再确认利润。";
  const money = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, "");
  const logisticsStatusText = level.name
    ? `本地档位试算 ${money(pricingDiagnosis.logisticsFee)} CNY`
    : "未知（尺重/运费档位证据不足）";
  return `
    <section class="workflow-pricing-diagnosis">
      <div class="workflow-pricing-head">
        <div>
          <strong>定价诊断</strong>
          <p class="hint">采购价、运费、佣金、杂费、利润、原价和最低价拆解。</p>
        </div>
        <div class="workflow-pricing-badges">
          ${pricingRiskCode ? `<em class="workflow-pricing-risk">价格风险 ${escapeHtml(pricingRiskCode)}</em>` : ""}
          <span>${escapeHtml(pricingDiagnosis.currencyCode || "CNY")}</span>
        </div>
      </div>
      <div class="workflow-pricing-grid">
        <article><span>采购成本</span><strong>${money(pricingDiagnosis.purchaseCost)}</strong><small>含 ${money(pricingDiagnosis.purchaseMarkupRmb)} RMB 缓冲</small></article>
        <article><span>售价</span><strong>${money(pricingDiagnosis.priceCny)}</strong><small>原价 ${money(pricingDiagnosis.oldPriceCny)}</small></article>
        <article><span>最低价</span><strong>${escapeHtml(pricingDiagnosis.minPriceCny || "-")}</strong><small>最低价来源：${escapeHtml(minPriceSource.label || "低于售价防拒绝")}</small></article>
        <article><span>运费等级</span><strong>${escapeHtml(level.name || "未知")}</strong><small>${escapeHtml(logisticsStatusText)}</small></article>
        <article><span>佣金</span><strong>${escapeHtml(commissionStatusText)}</strong><small>试算 ${money(pricingDiagnosis.commission)} CNY · ${escapeHtml(commissionRateText)}</small></article>
        <article><span>利润 · ${escapeHtml(profitStatusText)}</span><strong>${profitStatus === "unknown" ? "未知" : money(pricingDiagnosis.profit)}</strong><small>${profitStatus === "unknown" ? "公式结果仅作价格试算，不是确定利润" : `目标 ${Math.round(Number(pricingDiagnosis.profitRate || 0) * 100)}%`}</small></article>
      </div>
      ${pricingNextAction ? `<p class="workflow-pricing-evidence-warning" role="status">${escapeHtml(pricingNextAction)}</p>` : ""}
      ${procurementEvidence ? `
        <section class="workflow-procurement-evidence ${procurementEvidence.status === "blocked" ? "is-blocked" : ""}" aria-label="采购证据">
          <div>
            <strong>采购证据 · ${procurementEvidence.status === "verified" ? "完整" : procurementEvidence.status === "blocked" ? "不完整，定价阻塞" : "待核实"}</strong>
            <span>供应商：${escapeHtml(procurementEvidence.supplierName || procurementEvidence.supplierId || "未记录")}</span>
            <span>MOQ：${procurementEvidence.moq ? escapeHtml(procurementEvidence.moq) : "未记录"}</span>
            <span>阶梯价：${Number(procurementEvidence.priceTierCount || 0)} 档</span>
          </div>
          <p>${procurementMissing.length ? `为何阻塞：缺少${escapeHtml(procurementMissing.join("、"))}，无法证明当前数量对应的真实采购成本。` : procurementEvidence.verificationState === "manual_unverified" ? "当前资料来自手工填写，不能冒充 1688 页面事实；补充来源快照后才可标记为来源已验证。" : "供应商、MOQ 与数量绑定阶梯价已形成采购依据。"}</p>
          ${procurementEvidence.sellerAction ? `<small>下一步：${escapeHtml(procurementEvidence.sellerAction)}</small>` : ""}
          <small>1688 展示价不作为采购成本，也不能据此证明利润。</small>
          ${procurementActions.length ? `<small>补证动作：${procurementActions.map(escapeHtml).join("；")}</small>` : ""}
          ${procurementEvidence.reasonCode ? `<code>${escapeHtml(procurementEvidence.reasonCode || "PRICING_PROCUREMENT_EVIDENCE_MISSING")}</code>` : ""}
        </section>
      ` : ""}
      <div class="workflow-pricing-foot">
        <span>尺重：${Number(packageInfo.weightG || 0)}g / ${Number(packageInfo.lengthMm || 0)}×${Number(packageInfo.widthMm || 0)}×${Number(packageInfo.heightMm || 0)}mm</span>
        <span>成本基数：${money(pricingDiagnosis.baseCost)}</span>
        <span>原价策略：${escapeHtml(oldPriceSource.label || "旧规则：售价乘以 2")}</span>
        <span>利润底线：${marginFloor.floorCny ? `${money(marginFloor.floorCny)} CNY` : "未配置"}</span>
        <span>佣金来源：${escapeHtml(commissionSource.source || "manual_default")} / ${escapeHtml(commissionSource.confidence || "low")}</span>
        <span>结算/汇率：${profitStatus === "observed" ? "已核对" : "未核对"}</span>
        <span>迭代：${steps.length} 步</span>
        <span>变体：${variants.length || 0} 个</span>
      </div>
      ${variants.length ? `
        <details>
          <summary>变体价格明细</summary>
          <div class="workflow-pricing-variants">
            ${variants.map((variant) => `
              <div>
                <strong>${escapeHtml(variant.offerId || "-")}</strong>
                <span>售价 ${money(variant.priceCny)} / 最低价 ${escapeHtml(variant.minPriceCny || "-")} / 运费 ${money(variant.logisticsFee)} / ${escapeHtml(variant.level?.name || "-")}</span>
              </div>
            `).join("")}
          </div>
        </details>
      ` : ""}
      ${pricingRiskCode ? `
        <div class="workflow-pricing-actions">
          <button class="primary" data-workflow-action="recalculate-pricing">重新生成价格</button>
          <button class="ghost" data-workflow-action="accept-pricing-risk" ${canAcceptPricingRisk ? "" : "disabled"}>接受价格风险</button>
          <button class="ghost" data-workflow-action="focus-payload-draft">转到 Payload 草稿</button>
          <button class="ghost" data-workflow-action="request-new-source">标记换货源</button>
        </div>
      ` : ""}
    </section>
  `;
}

function renderReviewRepairDraft(node = {}, runId = "") {
  const draft = node?.output?.reviewRepairDraft;
  if (!draft?.ok || !Array.isArray(draft.repairs) || !draft.repairs.length) return "";
  const workflow = draft.workflow || {};
  return `
    <section class="workflow-review-repair" data-review-repair-status="${escapeHtml(draft.status || "pending_manual_repair")}">
      <div class="workflow-section-head">
        <div><strong>审核失败修复草稿</strong><p class="hint">逐 Offer/字段定位；当前只生成本地草稿，不会自动提交。</p></div>
        <span class="workflow-status workflow-status-failed">待人工修复</span>
      </div>
      <button class="primary" type="button" data-review-repair-return data-run-id="${escapeHtml(runId)}">打开本地草稿修复台</button>
      <div class="workflow-review-repair-list">
        ${draft.repairs.slice(0, 20).map((repair) => `
          <article class="workflow-review-repair-item">
            <strong>${escapeHtml(repair.code || "UNKNOWN")}</strong>
            <span>任务 ${escapeHtml(draft.taskId || "-")} · 商品 ${escapeHtml(repair.productId || "-")} · Offer ${escapeHtml(repair.offerId || "未解析（需人工确认范围）")}</span>
            <small>字段：${escapeHtml(repair.fieldPath || "items[*]")} · ${escapeHtml(repair.message || "需要修复")}</small>
            <small>动作：${escapeHtml(repair.action || "人工修复本地草稿")}；不会写入 Ozon。</small>
            <button class="ghost" type="button" data-review-repair-locate data-run-id="${escapeHtml(runId)}" data-issue-code="${escapeHtml(repair.code || "")}" data-issue-field-path="${escapeHtml(repair.fieldPath || "items[*]")}" data-issue-label="${escapeHtml(repair.message || repair.code || "审核问题")}" data-issue-offer-id="${escapeHtml(repair.offerId || "")}" data-issue-attribute-id="${escapeHtml(repair.attributeId || repair.attribute_id || "")}">查看并定位本地草稿字段</button>
          </article>
        `).join("")}
      </div>
      ${draft.repairs.length > 20 ? `<small>还有 ${draft.repairs.length - 20} 项，请查看节点输出。</small>` : ""}
      <ol class="workflow-review-repair-steps">
        <li>${escapeHtml(workflow.saveDraft || "保存修复后的本地 Payload，生成新的草稿 hash。")}</li>
        <li>${escapeHtml(workflow.preflight || "对新草稿重新预检；旧确认不可复用。")}</li>
        <li>${escapeHtml(workflow.submit || "预检通过后人工确认提交。")}</li>
        <li>${escapeHtml(workflow.readback || "提交后按 task_id、product_id、Offer 再次只读回查。")}</li>
      </ol>
      <p class="hint">结果：${escapeHtml(draft.result || "等待人工修复")}；副作用：${escapeHtml(draft.sideEffect || "仅本地草稿")}</p>
    </section>
  `;
}

function openReviewRepairDraft(button) {
  const runId = String(button?.dataset?.runId || "").trim();
  if (!runId) return;
  state.selectedWorkflowRunId = runId;
  state.selectedWorkflowNodeKey = "review_reconcile";
  activateErpView("listing");
  setListingStage("current-product");
  window.setTimeout(() => {
    const target = $("#listingSellerTaskSummaryBody");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 0);
  toast("已打开本地草稿修复台；保存后必须重新预检，不会自动提交 Ozon。");
}

function renderWorkflowDetail(run, node) {
  const detail = $("#workflowNodeDetail");
  if (!detail) return;
  if (!run || !node) {
    detail.innerHTML = `<p class="hint">选择节点后查看输入、输出、诊断和可编辑 Payload。</p>`;
    return;
  }
  const payloadDraft = run.payloadDraft || node.output || {};
  const payloadText = JSON.stringify(payloadDraft, null, 2);
  const diagnostic = node.diagnostic || node.diagnosis || {};
  const diagnosticMessage = diagnostic.messageZh || diagnostic.message || "暂无诊断文本";
  const diagnosticGuidance = diagnostic.guidance || (Array.isArray(diagnostic.fixHints) ? diagnostic.fixHints.join("；") : "");
  const recentEvents = (run.events || []).slice(-8).reverse();
  const payloadValidation = run.payloadDraftValidation || {};
  const payloadIssues = Array.isArray(payloadValidation.issues) ? payloadValidation.issues : [];
  // A completed/unknown reservation is already a seller-facing outcome. Keep
  // the confirmation control visible for context, but lock it before a second
  // click can reach the API and explain the safe next action. The server also
  // enforces this reservation; this UI guard prevents duplicate-click anxiety
  // and avoids presenting a replay as a fresh submission.
  const submissionState = String(run.submissionReservation?.state || "").trim();
  const submissionLocked = ["completed", "in_progress", "needs_review"].includes(submissionState);
  const currentDraftHash = String(run.payloadDraftHash || "").trim();
  const validatedDraftHash = String(run.validatedDraftHash || run.payloadDraftValidation?.draftHash || "").trim();
  const preflightPassed = run.payloadDraftValidation?.ok === true;
  const validationHashMatches = Boolean(currentDraftHash && validatedDraftHash && currentDraftHash === validatedDraftHash);
  const currentProductBindingReady = workflowCanActForCurrentProduct(run);
  const submissionGateBlocked = !preflightPassed || !validationHashMatches || !currentProductBindingReady;
  const submissionButtonLabel = submissionState === "completed"
    ? "已提交，等待审核回查"
    : submissionState === "needs_review"
      ? "结果未知，先人工回查"
      : submissionState === "in_progress"
      ? "提交处理中..."
        : !preflightPassed
          ? (run.payloadDraftValidation ? "先修复预检问题" : "先完成提交前预检")
          : !validationHashMatches
            ? "草稿已修改，先重新预检"
            : "确认提交 Ozon";
  const submissionButtonHint = !currentProductBindingReady
    ? "当前工作流没有绑定已人工确认的真实商品；禁止保存、预检或提交另一个历史/测试商品。"
    : submissionState === "completed"
    ? "当前草稿已提交过；请使用 task_id 回查审核，不要再次提交。"
    : submissionState === "needs_review"
      ? "上次提交结果未知；先人工回查 Ozon，不能自动重试。"
      : submissionState === "in_progress"
      ? "已有提交请求处理中，请等待结果回写。"
      : !preflightPassed
        ? "当前 Payload 尚未通过预检；先点击“校验 Payload”，不会调用 Ozon。"
        : !validationHashMatches
          ? "当前草稿 hash 与预检版本不一致；旧确认不可复用，请先重新预检。"
          : "预检通过并确认草稿哈希后才会调用 Ozon。";
  const sellerNodeStatusLabel = node.key === "preflight_check" && node.status === "success"
    ? "预检通过（尚未提交）"
    : node.key === "ozon_submit" && submissionState === "completed"
      ? "已提交，等待审核回查"
      : workflowStatusLabel(node.status);
  detail.innerHTML = `
    <div class="workflow-section-head">
      <div>
        <h2>${escapeHtml(node.title || workflowNodeTitle(node.key))}</h2>
        <p class="hint">${escapeHtml(node.key)}</p>
      </div>
      <div class="workflow-detail-head-actions">
        <button class="ghost" data-workflow-action="copy-run-summary">复制工作流摘要</button>
        <span class="workflow-status workflow-status-${escapeHtml(node.status || "pending")}">${escapeHtml(sellerNodeStatusLabel)}</span>
      </div>
    </div>
    <div class="workflow-actions">
      <button class="ghost" data-workflow-action="pause">暂停</button>
      <button class="ghost" data-workflow-action="resume">恢复</button>
      <button class="primary" data-workflow-action="retry">重试节点</button>
      <button class="primary" data-workflow-action="continue-node">从此继续</button>
      <button class="primary" data-workflow-action="controlled-chain">受控跑到总闸</button>
    </div>
    ${currentProductBindingReady && (run.status === "waiting_human" || run.locks?.waitingHuman) ? `
      <section class="workflow-manual-panel">
        <strong>人工介入</strong>
        <p class="hint">当前流程已安全暂停，请选择一个处理结果，系统会记录事件并更新锁状态。</p>
        <div class="workflow-actions">
          <button class="ghost" data-workflow-action="request-new-source">换新货源</button>
          <button class="primary" data-workflow-action="manual-fix-retry">已清理残留，重试</button>
          <button class="danger" data-workflow-action="confirm-continue">确认继续提交</button>
        </div>
      </section>
    ` : ""}
    ${(node.diagnostic || node.diagnosis) ? `
      <section class="workflow-diagnostic">
        <strong>诊断</strong>
        <p>${escapeHtml(diagnosticMessage)}</p>
        ${diagnosticGuidance ? `<small>${escapeHtml(diagnosticGuidance)}</small>` : ""}
      </section>
    ` : ""}
    ${renderVariantGroupingDefectCard(node)}
    ${renderReviewRepairDraft(node, run?.id || "")}
    ${renderWorkflowPricingDiagnosis(node)}
    <section class="workflow-decision workflow-risk-${escapeHtml(node.riskLevel || "low")}">
      <strong>分支判断</strong>
      <p>${escapeHtml(node.reason || "当前节点未发现明显阻塞风险，可继续流程。")}</p>
      <div class="workflow-decision-meta">
        <span>走向：${escapeHtml(node.branch || "continue")}</span>
        <span>风险：${workflowRiskLabel(node.riskLevel)} ${Number(node.riskScore || 0)}分</span>
      </div>
      <div class="workflow-locks">${workflowLockBadges(run.locks || {}).map((label) => `<em>${escapeHtml(label)}</em>`).join("")}</div>
      ${(node.recommendedActions || []).length ? `
        <ul>
          ${(node.recommendedActions || []).map((action) => `<li>${escapeHtml(action)}</li>`).join("")}
        </ul>
      ` : ""}
    </section>
    <label class="field workflow-field">
      <span>Payload 草稿</span>
      ${workflowPayloadDraftSummary(payloadDraft)}
      ${renderListingQualityPanel(run, node)}
      ${renderRequiredAttributeFillPlan(run, node)}
      ${renderVariantConfigurationWorkbench(run, node)}
      ${renderListingAttributeMatrix(run, node)}
      ${payloadIssues.length ? `
        <div class="workflow-payload-issues">
          ${workflowPayloadIssueSummary(payloadIssues)}
          <strong>校验问题</strong>
          <div class="workflow-payload-issue-list">
            ${payloadIssues.map((issue, index) => workflowPayloadIssueLocator(issue, index, payloadDraft)).join("")}
          </div>
        </div>
      ` : ""}
      <textarea id="workflowPayloadEditor" class="workflow-payload-editor" spellcheck="false">${escapeHtml(payloadText)}</textarea>
    </label>
    <div class="workflow-actions">
      <button class="ghost" data-workflow-action="save-payload">保存草稿</button>
      <button class="primary" data-workflow-action="validate-payload">校验 Payload</button>
      <button class="danger" data-workflow-action="submit-payload-draft" ${submissionLocked || submissionGateBlocked ? "disabled" : ""}>${submissionButtonLabel}</button>
      <small class="hint workflow-submit-state-hint">${submissionButtonHint}</small>
    </div>
    <section class="workflow-io-summary-grid">
      ${workflowNodeIoSummary("输入", node.input || {})}
      ${workflowNodeIoSummary("输出", node.output || {})}
    </section>
    <details open>
      <summary>节点输入</summary>
      <pre>${escapeHtml(JSON.stringify(node.input || {}, null, 2))}</pre>
    </details>
    <details>
      <summary>节点输出</summary>
      <pre>${escapeHtml(JSON.stringify(node.output || {}, null, 2))}</pre>
    </details>
    ${workflowControlledChainResultPanel(run)}
    <section class="workflow-event-log">
      <strong>最近事件</strong>
      ${recentEvents.length ? `
        <ul>
          ${recentEvents.map((event) => `
            <li>
              <span>${escapeHtml(workflowEventLabel(event.type))}</span>
              <small class="workflow-event-meta">
                ${workflowEventExecutionBadge(event)}
                <span>${escapeHtml(event.node || "-")} · ${escapeHtml(event.time ? new Date(event.time).toLocaleString("zh-CN") : "")}</span>
                ${workflowEventActionText(event) ? `<span>${escapeHtml(workflowEventActionText(event))}</span>` : ""}
              </small>
              ${event.message ? `<p>${escapeHtml(event.message)}</p>` : ""}
            </li>
          `).join("")}
        </ul>
      ` : `<p class="hint">暂无事件。</p>`}
    </section>
  `;
}

function renderWorkflowConsole() {
  const run = selectedWorkflowRun();
  const node = selectedWorkflowNode(run);
  if (run && node && !state.selectedWorkflowNodeKey) {
    state.selectedWorkflowNodeKey = node.key;
  }
  renderWorkflowRunList(run);
  renderWorkflowSummaryCards();
  renderWorkflowFocusBar(run, node);
  renderWorkflowTimeline(run, node);
  renderWorkflowDetail(run, node);
  document.querySelectorAll(".workflow-filter-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.filter === state.workflowFilter);
  });
}

async function saveWorkflowPayloadDraft(runId, payloadText) {
  const payload = JSON.parse(payloadText || "{}");
  const currentRun = state.workflowRuns.find((item) => item.id === runId);
  if (currentRun) {
    currentRun.validatedDraftHash = "";
    currentRun.payloadDraftValidation = null;
  }
  await api(`/api/workflows/${encodeURIComponent(runId)}/payload-draft`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  toast("Payload 草稿已保存");
  await loadWorkflowRuns();
}

async function validateWorkflowPayloadDraft(runId) {
  const result = await api(`/api/workflows/${encodeURIComponent(runId)}/payload-draft/validate`, {
    method: "POST",
    body: "{}",
  });
  const currentRun = state.workflowRuns.find((item) => item.id === runId);
  if (currentRun) {
    currentRun.validatedDraftHash = String(result.draftHash || "");
    currentRun.payloadDraftValidation = { ...result };
  }
  toast(result.ok ? "Payload 校验通过" : `Payload 有 ${result.issues?.length || result.errors?.length || 0} 个问题`, result.ok ? "ok" : "error");
  await loadWorkflowRuns();
}

function workflowPayloadDraftMatchesRun(run, payloadText) {
  const editorPayload = JSON.parse(payloadText || "{}");
  return JSON.stringify(editorPayload) === JSON.stringify(run?.payloadDraft || {});
}

function focusWorkflowPayloadIssue(button) {
  const path = button?.dataset?.payloadPath || "";
  const label = button?.dataset?.payloadLabel || path || "payload";
  const offerId = button?.dataset?.payloadOfferId || "";
  const attributeId = button?.dataset?.payloadAttributeId || "";
  const editor = $("#workflowPayloadEditor");
  if (!editor) return;
  highlightWorkflowPayloadEditor(editor);
  editor.focus();
  const value = editor.value || "";
  const index = workflowPayloadLocateIndex(value, path, offerId, attributeId);
  const locatedAttribute = attributeId && value.slice(index, index + String(attributeId).length) === String(attributeId);
  const selectionText = locatedAttribute ? String(attributeId) : path;
  editor.setSelectionRange(index, Math.min(value.length, index + Math.max(selectionText.length, 1)));
  editor.scrollIntoView({ behavior: "smooth", block: "center" });
  toast(`已定位字段：${label}`);
}

function workflowPayloadLocateIndex(value = "", path = "", offerId = "", attributeId = "") {
  const text = String(value || "");
  const fallback = path && text.includes(path) ? text.indexOf(path) : 0;
  if (!offerId || !attributeId) return fallback;
  const offerText = String(offerId);
  const attributeText = String(attributeId);
  const offerIndex = text.indexOf(offerText);
  if (offerIndex < 0) return fallback;
  const nextOfferIndex = text.indexOf("\"offer_id\"", offerIndex + offerText.length);
  const segmentEnd = nextOfferIndex > offerIndex ? nextOfferIndex : text.length;
  const segment = text.slice(offerIndex, segmentEnd);
  const attributeMatch = new RegExp(`"id"\\s*:\\s*"?${escapeWorkflowPayloadRegex(attributeText)}"?`).exec(segment);
  if (!attributeMatch) return fallback;
  const innerIndex = attributeMatch[0].lastIndexOf(attributeText);
  return offerIndex + attributeMatch.index + Math.max(innerIndex, 0);
}

function escapeWorkflowPayloadRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightWorkflowPayloadEditor(editor) {
  if (!editor) return;
  window.clearTimeout(highlightWorkflowPayloadEditor.timer);
  editor.classList.add("payload-located");
  highlightWorkflowPayloadEditor.timer = window.setTimeout(() => {
    editor.classList.remove("payload-located");
  }, 1600);
}

function workflowNewSourceToast(result = {}) {
  const event = (result.events || []).slice().reverse().find((item) => item.type === "new_source_requested") || {};
  const data = event.data || {};
  const taskIds = data.replacementCrawlerTaskIds || data.replacement?.crawlerTaskIds || [];
  if (Array.isArray(taskIds) && taskIds.length) {
    return `已创建 ${taskIds.length} 个新 1688 采集任务`;
  }
  return "已关闭当前候选，请重新选择新货源";
}

async function handleWorkflowAction(action, button) {
  const run = selectedWorkflowRun();
  const node = selectedWorkflowNode(run);
  if (!run) return;
  const readOnlyActions = new Set(["copy-run-summary", "focus-payload-draft"]);
  if (!workflowCanActForCurrentProduct(run) && !readOnlyActions.has(action)) {
    toast("当前没有精确绑定且已确认的真实商品；该工作流动作已阻断。", "error");
    return;
  }
  if (action === "pause") await api(`/api/workflows/${encodeURIComponent(run.id)}/pause`, { method: "POST", body: "{}" });
  if (action === "resume") await api(`/api/workflows/${encodeURIComponent(run.id)}/resume`, { method: "POST", body: "{}" });
  if (action === "request-new-source") {
    const result = await api(`/api/workflows/${encodeURIComponent(run.id)}/request-new-source`, {
      method: "POST",
      body: JSON.stringify({ note: "页面人工选择：换新货源" }),
    });
    toast(workflowNewSourceToast(result));
  }
  if (action === "manual-fix-retry" && node) {
    await api(`/api/workflows/${encodeURIComponent(run.id)}/nodes/${encodeURIComponent(node.key)}/manual-fix-retry`, {
      method: "POST",
      body: JSON.stringify({ note: "页面人工选择：已清理残留，重试", input: node.input || {} }),
    });
    toast("已解除人工等待锁，并请求重试当前节点");
  }
  if (action === "continue-node" && node) {
    await api(`/api/workflows/${encodeURIComponent(run.id)}/nodes/${encodeURIComponent(node.key)}/continue`, {
      method: "POST",
      body: JSON.stringify({ note: "页面人工选择：从此继续", input: node.input || {} }),
    });
    toast("已执行从此继续动作");
  }
  if (action === "controlled-chain") {
    const result = await api(`/api/workflows/${encodeURIComponent(run.id)}/controlled-chain`, {
      method: "POST",
      body: JSON.stringify({ startNode: node?.key || run.currentNode || "match_profit", note: "页面人工选择：受控跑到总闸" }),
    });
    toast(`受控链路已跑 ${result.steps?.length || 0} 步，未触发 Ozon 提交`);
  }
  if (action === "confirm-continue" && node) {
    if (!workflowCanActForCurrentProduct(run)) {
      toast("当前商品尚未完成来源确认，不能确认继续提交。", "error");
      return;
    }
    const ok = window.confirm("确认继续提交风险较高。请确认你已判断不是重复货源/重复卡片，是否继续？");
    if (!ok) return;
    await api(`/api/workflows/${encodeURIComponent(run.id)}/nodes/${encodeURIComponent(node.key)}/confirm-continue`, {
      method: "POST",
      body: JSON.stringify({ note: "页面人工选择：确认继续提交" }),
    });
    toast("已记录人工确认，流程可继续");
  }
  if (action === "recalculate-pricing" && node) {
    await api(`/api/workflows/${encodeURIComponent(run.id)}/nodes/${encodeURIComponent(node.key)}/pricing-risk/recalculate`, {
      method: "POST",
      body: JSON.stringify({ note: "页面请求重新生成价格" }),
    });
    toast("已请求重新生成价格");
  }
  if (action === "accept-pricing-risk" && node) {
    const ok = window.confirm("确认接受当前价格风险？阻塞型风险不能跳过，后续仍必须经过 Payload 预检。");
    if (!ok) return;
    await api(`/api/workflows/${encodeURIComponent(run.id)}/nodes/${encodeURIComponent(node.key)}/pricing-risk/accept`, {
      method: "POST",
      body: JSON.stringify({ note: "页面人工接受价格风险" }),
    });
    toast("已记录人工接受价格风险");
  }
  if (action === "focus-payload-draft") {
    const editor = $("#workflowPayloadEditor");
    editor?.scrollIntoView({ behavior: "smooth", block: "center" });
    editor?.focus();
    toast("已定位 Payload 草稿");
  }
  if (action === "retry" && node) {
    await api(`/api/workflows/${encodeURIComponent(run.id)}/nodes/${encodeURIComponent(node.key)}/retry`, {
      method: "POST",
      body: JSON.stringify({ input: node.input || {} }),
    });
  }
  if (action === "save-payload") {
    await saveWorkflowPayloadDraft(run.id, $("#workflowPayloadEditor")?.value || "{}");
    return;
  }
  if (action === "validate-payload") {
    await validateWorkflowPayloadDraft(run.id);
    return;
  }
  if (action === "generate-variant-repair-draft" && node) {
    const repairDraft = node.output?.variantGroupingRepairDraft;
    if (!repairDraft?.ok || !repairDraft.payload) throw new Error(repairDraft?.message || "当前没有完整的整组修复草稿");
    const editor = $("#workflowPayloadEditor");
    if (!editor) throw new Error("Payload 编辑器不可用");
    editor.value = JSON.stringify(repairDraft.payload, null, 2);
    highlightWorkflowPayloadEditor(editor);
    await saveWorkflowPayloadDraft(run.id, editor.value);
    toast(`已生成 ${repairDraft.payload.items?.length || 0} 个 SKU 的整组修复草稿，不会自动提交 Ozon`);
    return;
  }
  if (action === "apply-attribute-dictionary-repair") {
    const ok = window.confirm("确认把该 Ozon 合法字典值写回本地 Payload 草稿？系统会立即重新预检，但不会提交 Ozon。");
    if (!ok) return;
    const result = await api(`/api/workflows/${encodeURIComponent(run.id)}/payload-draft/attribute-repair`, {
      method: "POST",
      body: JSON.stringify({
        confirmLocalDraftRepair: true,
        repairType: "dictionary_value",
        offerId: button?.dataset?.repairOfferId || "",
        attributeId: Number(button?.dataset?.repairAttributeId || 0),
        dictionaryValueId: Number(button?.dataset?.repairDictionaryValueId || 0),
        value: button?.dataset?.repairValue || "",
        sourceSuggestedAspect: button?.dataset?.repairSourceSuggestedAspect === "true",
        sourceValue: button?.dataset?.repairSourceValue || "",
        sourceVariantSpec: button?.dataset?.repairSourceVariantSpec || "",
        note: button?.dataset?.repairSourceSuggestedAspect === "true"
          ? "页面人工确认：1688 SKU 规格匹配 Ozon 字典值"
          : "页面人工选择：属性矩阵字典值修复",
      }),
    });
    toast(result.ok ? "本地草稿已写回并通过预检，不会提交 Ozon" : "本地草稿已写回，但预检仍有问题", result.ok ? "ok" : "error");
    await loadWorkflowRuns();
    renderListingSellerTaskSummary();
    return;
  }
  if (action === "apply-attribute-text-repair") {
    const value = window.prompt("请输入要写回本地 Payload 草稿的文本属性值。系统会重新预检，但不会提交 Ozon。", "");
    if (value === null) return;
    const trimmed = String(value || "").trim();
    if (!trimmed) throw new Error("文本属性值不能为空");
    const result = await api(`/api/workflows/${encodeURIComponent(run.id)}/payload-draft/attribute-repair`, {
      method: "POST",
      body: JSON.stringify({
        confirmLocalDraftRepair: true,
        repairType: "text_value",
        offerId: button?.dataset?.repairOfferId || "",
        attributeId: Number(button?.dataset?.repairAttributeId || 0),
        value: trimmed,
        note: "页面人工输入：属性矩阵文本属性修复",
      }),
    });
    toast(result.ok ? "本地文本属性已写回并通过预检，不会提交 Ozon" : "本地文本属性已写回，但预检仍有问题", result.ok ? "ok" : "error");
    await loadWorkflowRuns();
    renderListingSellerTaskSummary();
    return;
  }
  if (action === "apply-variant-text-repair") {
    const suggestedValue = String(button?.dataset?.repairValue || "").trim();
    let value = suggestedValue;
    if (suggestedValue) {
      const ok = window.confirm(`确认把 1688 SKU 规格候选「${suggestedValue}」写回本地 Payload 草稿？系统会重新预检，但不会提交 Ozon。`);
      if (!ok) return;
    } else {
      value = window.prompt("请输入要写回本地 Payload 草稿的变体文本值。系统会重新预检，但不会提交 Ozon。", "");
      if (value === null) return;
    }
    const trimmed = String(value || "").trim();
    if (!trimmed) throw new Error("变体文本值不能为空");
    const result = await api(`/api/workflows/${encodeURIComponent(run.id)}/payload-draft/attribute-repair`, {
      method: "POST",
      body: JSON.stringify({
        confirmLocalDraftRepair: true,
        repairType: "variant_text_value",
        offerId: button?.dataset?.repairOfferId || "",
        attributeId: Number(button?.dataset?.repairAttributeId || 0),
        value: trimmed,
        sourceSuggestedAspect: button?.dataset?.repairSourceSuggestedAspect === "true",
        note: suggestedValue ? "页面人工确认：1688 SKU 规格候选写回" : "页面人工输入：变体文本属性修复",
      }),
    });
    toast(result.ok ? "本地变体文本已写回并通过预检，不会提交 Ozon" : "本地变体文本已写回，但预检仍有问题", result.ok ? "ok" : "error");
    await loadWorkflowRuns();
    renderListingSellerTaskSummary();
    return;
  }
  if (action === "apply-package-info-repair") {
    const offerId = button?.dataset?.repairOfferId || "";
    const packageInfo = {
      weight: Number(button?.dataset?.repairPackageWeight || 0),
      depth: Number(button?.dataset?.repairPackageDepth || 0),
      width: Number(button?.dataset?.repairPackageWidth || 0),
      height: Number(button?.dataset?.repairPackageHeight || 0),
    };
    if (!packageInfo.weight || !packageInfo.depth || !packageInfo.width || !packageInfo.height) {
      throw new Error("可信尺重不完整，不能写回本地草稿。");
    }
    const ok = window.confirm(`确认把可信包装尺重写回 ${offerId || "当前 SKU"} 的本地 Payload 草稿？系统会立即重新预检，但不会提交 Ozon。`);
    if (!ok) return;
    const result = await api(`/api/workflows/${encodeURIComponent(run.id)}/payload-draft/attribute-repair`, {
      method: "POST",
      body: JSON.stringify({
        confirmLocalDraftRepair: true,
        repairType: "package_info",
        offerId,
        packageInfoSource: button?.dataset?.repairPackageSource || "",
        packageInfo,
        note: "页面人工确认：可信包装尺重修复",
      }),
    });
    toast(result.ok ? "本地包装尺重已写回并通过预检，不会提交 Ozon" : "本地包装尺重已写回，但预检仍有问题", result.ok ? "ok" : "error");
    await loadWorkflowRuns();
    renderListingSellerTaskSummary();
    return;
  }
  if (action === "submit-payload-draft") {
    if (!workflowCanActForCurrentProduct(run)) {
      toast("当前工作流未精确绑定已确认的真实商品，禁止提交。请回到当前商品完成来源确认。", "error");
      return;
    }
    const payloadText = $("#workflowPayloadEditor")?.value || "{}";
    if (!workflowPayloadDraftMatchesRun(run, payloadText)) {
      toast("草稿内容已修改。请先保存草稿并重新预检，再确认提交。", "error");
      return;
    }
    const expectedDraftHash = String(run.validatedDraftHash || run.payloadDraftValidation?.draftHash || "").trim();
    if (!expectedDraftHash) {
      toast("当前草稿没有有效的预检版本。请先重新预检，再确认提交。", "error");
      return;
    }
    const workflowStoreId = String(run.entity?.storeId || "").trim();
    if (!workflowStoreId) {
      toast("当前工作流尚未绑定店铺。请先在商品任务中明确绑定店铺，再重新预检提交。", "error");
      return;
    }
    const ok = window.confirm("确认提交 Ozon 会调用 /v3/product/import。请确认 Payload 已校验通过且风险可接受，是否继续？");
    if (!ok) return;
    const result = await api(`/api/workflows/${encodeURIComponent(run.id)}/payload-draft/submit`, {
      method: "POST",
      body: JSON.stringify({ confirmSubmit: true, storeId: workflowStoreId, expectedDraftHash }),
    });
    const submitMessage = result.status === "replay"
      ? `此前已提交 Ozon task：${result.taskId || "-"}；本次未重复提交，请回查审核`
      : result.status === "needs_review"
        ? (result.message || "提交结果未知，请先人工回查 Ozon")
        : result.ok
          ? `已提交 Ozon task：${result.taskId || "-"}，等待审核回查`
          : (result.message || "Payload 未提交");
    toast(submitMessage, result.ok && result.status !== "needs_review" ? "ok" : "error");
    await loadWorkflowRuns();
    return;
  }
  if (action === "copy-repair-template") {
    const text = String(button?.dataset?.repairCopy || "").trim();
    if (!text) throw new Error("当前问题没有可复制的修复建议");
    await copyWorkflowText(text);
    toast("修复建议已复制");
    return;
  }
  if (action === "copy-run-summary") {
    await copyWorkflowText(workflowRunCopySummaryText(run, node));
    toast("工作流摘要已复制");
    return;
  }
  await loadWorkflowRuns();
}

async function loadShippingLevels() {
  const data = await api("/api/pricing/shipping-levels");
  $("#shippingLevelTable").innerHTML = data.levels.map((level) => `
    <tr>
      <td>${level.name}</td>
      <td>${level.weightMinG} - ${level.weightMaxG} g</td>
      <td>${level.priceMinCny} - ${level.priceMaxCny} RMB</td>
      <td>三边和 <= ${level.sizeSumMaxCm} cm${level.maxSideCm ? `，单边 <= ${level.maxSideCm} cm` : ""}</td>
      <td>${level.ratePerKg} RMB/kg + ${level.fixedFee} RMB/票</td>
    </tr>
  `).join("");
}

async function calculatePrice() {
  const button = $("#calculatePrice");
  const required = [
    ["calcPurchaseCost", "采购成本", 0.000001],
    ["calcWeight", "包装重量", 0.000001],
    ["calcLength", "包装长度", 0.000001],
    ["calcWidth", "包装宽度", 0.000001],
    ["calcHeight", "包装高度", 0.000001],
    ["calcCommissionRate", "佣金率", 0],
    ["calcMiscRate", "杂费率", 0],
    ["calcFixedMisc", "固定杂费", 0],
    ["calcProfitRate", "目标利润率", 0.000001],
  ];
  for (const [id, label, minimum] of required) {
    const raw = String($("#" + id)?.value || "").trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < minimum) {
      toast(`请先填写有效的${label}；当前没有发起定价请求。`, "warning");
      $("#" + id)?.focus();
      return false;
    }
  }
  setBusy(button, true);
  try {
    const payload = {
      purchaseCost: Number($("#calcPurchaseCost").value),
      weightG: Number($("#calcWeight").value),
      lengthMm: Number($("#calcLength").value),
      widthMm: Number($("#calcWidth").value),
      heightMm: Number($("#calcHeight").value),
      commissionRate: Number($("#calcCommissionRate").value) / 100,
      miscFeeRate: Number($("#calcMiscRate").value) / 100,
      fixedMiscFee: Number($("#calcFixedMisc").value),
      profitRate: Number($("#calcProfitRate").value) / 100,
    };
    const data = await api("/api/pricing/calculate", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    $("#calcResultPrice").textContent = data.priceCny ?? data.nextPriceCny ?? "-";
    $("#calcResultLevel").textContent = data.level?.name || data.levelName || "-";
    $("#calcResultLogistics").textContent = data.logisticsFee ?? "-";
    $("#calcResultProfit").textContent = data.profit ?? "-";
    $("#pricingStepsTable").innerHTML = (data.steps || []).map((step) => `
      <tr>
        <td>${step.iteration}</td>
        <td>${step.assumedPriceCny}</td>
        <td>${step.levelName}</td>
        <td>${step.logisticsFee}</td>
        <td>${step.commission}</td>
        <td>${step.miscFee}</td>
        <td>${step.nextPriceCny}</td>
      </tr>
    `).join("");
    showResponse(data);
    toast(data.converged === false ? "计算未完全收敛，请检查轮次" : "预计售价已计算");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function flattenCategories(nodes, parents = [], inheritedCategoryId = 0) {
  const rows = [];
  for (const node of nodes || []) {
    const label = fixMojibake(node.category_name || node.type_name || "");
    const path = [...parents, label].filter(Boolean);
    const descriptionCategoryId = node.description_category_id || inheritedCategoryId;
    if (node.type_id && descriptionCategoryId) {
      rows.push({
        description_category_id: descriptionCategoryId,
        type_id: node.type_id,
        name: label,
        path: path.join(" / "),
        disabled: node.disabled,
      });
    }
    rows.push(...flattenCategories(node.children || [], path, descriptionCategoryId));
  }
  return rows;
}

function fixMojibake(value = "") {
  const text = String(value || "");
  if (!/[ÃÂÐÑåæçèé]/.test(text)) return text;
  try {
    const decoded = new TextDecoder("utf-8").decode(Uint8Array.from([...text].map((char) => char.charCodeAt(0) & 0xff)));
    return /[\u4e00-\u9fffА-Яа-я]/.test(decoded) ? decoded : text;
  } catch {
    return text;
  }
}

async function loadCategoryTree() {
  const button = $("#loadCategoryTree");
  setBusy(button, true);
  try {
    const environment = currentSellerReadEnvironment();
    const data = await api(`/api/ozon/description-categories?storeId=${encodeURIComponent(selectedStoreId())}&environment=${encodeURIComponent(environment)}`);
    state.categoryTree = data.result || [];
    state.categoryEvidence.tree = data.operationEvidence || null;
    state.categoryEvidence.nextAction = data.cacheFreshness?.usable
      ? "可继续读取当前类目下的必填属性和字典值。"
      : "先刷新当前店铺的 Ozon 类目树，再执行类目匹配；不能把过期缓存当作当前类目证据。";
    renderCategoryEvidenceStatus();
    showResponse(data);
    toast("中文类目已读取");
    searchCategory();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function refreshCategoryCache() {
  const button = $("#refreshCategoryCache");
  setBusy(button, true);
  try {
    const data = await api("/api/ozon/category-cache/refresh", {
      method: "POST",
      body: JSON.stringify({ storeId: selectedStoreId(), environment: currentSellerReadEnvironment() }),
    });
    const treeData = await api(`/api/ozon/description-categories?storeId=${encodeURIComponent(selectedStoreId())}&environment=${encodeURIComponent(currentSellerReadEnvironment())}`);
    state.categoryTree = treeData.result || [];
    state.categoryEvidence.tree = treeData.operationEvidence || data.operationEvidence || null;
    renderCategoryEvidenceStatus();
    showResponse(data);
    toast(`本地类目库已刷新：${data.total || 0} 个类型`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function autoMatchCategory() {
  const button = $("#autoMatchCategory");
  setBusy(button, true);
  try {
    const product = {
      ...(state.collected1688 || {}),
      title: $("#listingOriginalTitle").value || state.collected1688?.title || $("#listingName").value,
      url: $("#sourceUrl").value || state.collected1688?.url || "",
      attributes: state.collected1688?.attributes || [],
      skuVariants: state.collected1688?.skuVariants || [],
    };
    const data = await api("/api/ozon/category-match", {
      method: "POST",
      body: JSON.stringify({ storeId: selectedStoreId(), product, limit: 8 }),
    });
    renderCategoryMatches(data.matches || []);
    const best = data.matches?.[0];
    if (best) {
      applyCategoryMatch(best);
      toast(`已自动匹配类目：${best.path}`);
      await loadListingAttributes();
    } else {
      toast("没有匹配到类目，请先刷新本地类目库或手动搜索", "error");
    }
    showResponse(data);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function renderCategoryMatches(matches) {
  $("#categoryResults").innerHTML = matches.length
    ? matches.map((item, index) => `
        <article data-category-id="${item.description_category_id}" data-type-id="${item.type_id}">
          <strong>${index === 0 ? "推荐 " : ""}${escapeHtml(item.name || "未命名类型")}</strong>
          <span>${escapeHtml(item.path)}</span>
          <code>分数: ${item.score} / 类目: ${item.description_category_id} / 类型: ${item.type_id}</code>
          <small>${escapeHtml((item.reasons || []).join("、"))}</small>
        </article>
      `).join("")
    : "<p class=\"hint\">没有匹配到类目。</p>";
  bindCategoryCards();
}

function applyCategoryMatch(item) {
  $("#listingCategoryId").value = item.description_category_id;
  $("#listingTypeId").value = item.type_id;
  $("#listingCategoryPath").value = item.path;
  $("#categoryKeyword").value = item.name || "";
}

async function ensureCategoryTreeLoaded() {
  if (state.categoryTree.length || state.categorySearchLoading) return;
  state.categorySearchLoading = true;
  try {
    const data = await api(`/api/ozon/description-categories?storeId=${encodeURIComponent(selectedStoreId())}&environment=${encodeURIComponent(currentSellerReadEnvironment())}`);
    state.categoryTree = data.result || [];
    state.categoryEvidence.tree = data.operationEvidence || null;
    renderCategoryEvidenceStatus();
  } catch (error) {
    toast(`读取中文类目失败：${error.message}`, "error");
  } finally {
    state.categorySearchLoading = false;
  }
}

function normalizeCategoryText(value) {
  return fixMojibake(value).toLowerCase().replace(/\s+/g, "");
}

function categorySearchScore(item, keyword) {
  const compactKeyword = normalizeCategoryText(keyword);
  const name = normalizeCategoryText(item.name);
  const path = normalizeCategoryText(item.path);
  if (!compactKeyword) return 1;
  if (name === compactKeyword) return 100;
  if (name.startsWith(compactKeyword)) return 80;
  if (name.includes(compactKeyword)) return 60;
  if (path.includes(compactKeyword)) return 30;
  return 0;
}

async function searchCategory() {
  await ensureCategoryTreeLoaded();
  const keyword = $("#categoryKeyword").value.trim().toLowerCase();
  const all = flattenCategories(state.categoryTree);
  const matches = all
    .map((item) => ({ ...item, score: categorySearchScore(item, keyword) }))
    .filter((item) => !keyword || item.score > 0)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    .slice(0, 60);

  $("#categoryResults").innerHTML = matches.length
    ? matches.map((item) => `
        <article data-category-id="${item.description_category_id}" data-type-id="${item.type_id}">
          <strong>${escapeHtml(item.name || "未命名类型")}</strong>
          <span>${escapeHtml(item.path)}</span>
          <code>类目: ${item.description_category_id} / 类型: ${item.type_id}</code>
        </article>
      `).join("")
    : "<p class=\"hint\">没有匹配的中文类目。</p>";

  bindCategoryCards();
}

function bindCategoryCards() {
  document.querySelectorAll("#categoryResults article").forEach((card) => {
    card.addEventListener("click", async () => {
      $("#listingCategoryId").value = card.dataset.categoryId;
      $("#listingTypeId").value = card.dataset.typeId;
      $("#listingCategoryPath").value = card.querySelector("span")?.textContent || card.textContent.trim();
      toast("已选择类目");
      $("#categoryResults").classList.remove("open");
      await rebuildListingDraftFromCurrentCategory({ preserveText: true, save: false });
    });
  });
}

async function rebuildListingDraftFromCurrentCategory(options = {}) {
  const { preserveText = true, save = true } = options;
  const data = state.collected1688;
  if (!data) {
    toast("请先从采集箱进入商品，再重建草稿", "error");
    return;
  }
  const keep = preserveText ? {
    name: $("#listingName").value,
    keywords: $("#listingKeywords").value,
    description: $("#listingDescription").value,
    richContent: $("#listingRichContent").value,
    images: $("#listingImages").value,
    videoUrl: $("#listingVideoUrl").value,
    videoCover: $("#listingVideoCover").value,
    remark: $("#listingRemark").value,
  } : null;
  await loadListingAttributes();
  await renderListingVariantsFrom1688(data, $("#listingParentSku").value.trim());
  applyCollectedAttributesToListing(data);
  applyGeneratedContentToDynamicAttributes();
  applyCardMergeModelAttribute();
  if (keep) {
    $("#listingName").value = keep.name;
    $("#listingNameCount").textContent = keep.name.length;
    $("#listingKeywords").value = keep.keywords;
    $("#listingDescription").value = keep.description;
    $("#listingRichContent").value = keep.richContent;
    $("#listingImages").value = keep.images;
    $("#listingVideoUrl").value = keep.videoUrl;
    $("#listingVideoCover").value = keep.videoCover;
    $("#listingRemark").value = keep.remark;
    previewListingImages();
  }
  markAllVariantRowsEdited("按当前分类重建，尚未提交");
  if (save) await saveListingDraft("draft", { categoryConfirmedAt: new Date().toISOString() });
  toast("已按当前分类重建属性和变体草稿");
}

function markAllVariantRowsEdited(message = "草稿已重建，尚未提交") {
  document.querySelectorAll("#listingVariantRows tr").forEach((row) => {
    setVariantRowStatus(row, "edited", message);
  });
}

async function loadListingAttributes() {
  const button = $("#loadListingAttributes");
  const requestToken = (state.categoryAttributeRequestToken = Number(state.categoryAttributeRequestToken || 0) + 1);
  const requestStoreId = String(selectedStoreId() || "").trim();
  const requestEnvironment = String(currentSellerReadEnvironment() || "").trim();
  setBusy(button, true);
  try {
    const descriptionCategoryId = Number($("#listingCategoryId").value);
    const typeId = Number($("#listingTypeId").value);
    if (!descriptionCategoryId || !typeId) {
      throw new Error("请先选择中文类目和类型 ID");
    }
    const data = await api("/api/ozon/description-attributes", {
      method: "POST",
      body: JSON.stringify({
        storeId: selectedStoreId(),
        environment: currentSellerReadEnvironment(),
        description_category_id: descriptionCategoryId,
        type_id: typeId,
      }),
    });
    if (requestToken !== state.categoryAttributeRequestToken
      || String(selectedStoreId() || "").trim() !== requestStoreId
      || String(currentSellerReadEnvironment() || "").trim() !== requestEnvironment) {
      return;
    }
    const operationEvidence = data.operationEvidence || null;
    const expectedEnvironmentRefHash = await sha256Text(requestEnvironment);
    if (String(operationEvidence?.storeId || "").trim() !== requestStoreId
      || String(operationEvidence?.environmentRefHash || "").trim() !== expectedEnvironmentRefHash
      || operationEvidence?.verificationLevel !== "server_observed") {
      state.categoryEvidence.attributes = null;
      state.categoryEvidence.nextAction = "确认当前店铺和读取环境后重新读取类目属性；不会使用跨店铺或跨环境的类目属性回执。";
      renderCategoryEvidenceStatus();
      toast("类目属性回执范围不匹配，未更新当前商品草稿。", "warning");
      return;
    }
    const attributes = data.result || [];
    state.categoryEvidence.attributes = operationEvidence;
    renderCategoryEvidenceStatus();
    state.listingAttributes = attributes;
    state.listingVariantAspects = attributes.filter((item) => item.is_aspect);
    const required = attributes.filter((item) => item.is_required);
    $("#attributeList").innerHTML = (required.length ? required : attributes.slice(0, 24))
      .map(attributeInputHtml)
      .join("");
    document.querySelectorAll("#attributeList .attribute-add").forEach((button) => {
      button.addEventListener("click", () => appendAttributeTemplate(button.closest(".attribute-form-row")));
    });
    bindAttributeValuePickers($("#attributeList"));
    await applyDefaultBrandAttribute();
    applyCollectedAttributesToListing(state.collected1688 || {});
    await applyDefaultTypeAttribute();
    applyDefaultVolumeAttributes();
    applyGeneratedContentToDynamicAttributes();
    applyCardMergeModelAttribute();
    await renderVariantAspectColumns();
    showResponse(data);
    toast("中文属性已读取");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function renderCategoryEvidenceStatus() {
  const target = $("#categoryEvidenceStatus");
  if (!target) return;
  const tree = state.categoryEvidence?.tree || null;
  const attributes = state.categoryEvidence?.attributes || null;
  const valid = (entry) => entry
    && entry.verificationLevel === "server_observed"
    && /^sha256:[a-f0-9]{64}$/i.test(String(entry.responseHash || ""))
    && Number(entry.statusCode || 0) >= 200
    && Number(entry.statusCode || 0) < 300;
  const missing = [
    ...(valid(tree) ? [] : ["类目树"]),
    ...(valid(attributes) ? [] : ["属性"]),
  ];
  if (missing.length) {
    target.className = "category-evidence-status warning";
    target.innerHTML = `<strong>当前店铺证据未齐</strong><span>缺少：${escapeHtml(missing.join("、"))}。${escapeHtml(state.categoryEvidence?.nextAction || "请读取/刷新后再进入上架预检。")}</span>`;
    return;
  }
  const checked = [tree.checkedAt, attributes.checkedAt].filter(Boolean).sort().slice(-1)[0] || "";
  const storeLabel = tree.storeId || attributes.storeId || selectedStoreId();
  target.className = "category-evidence-status ready";
  target.innerHTML = `<strong>当前店铺类目/属性证据已记录</strong><span>店铺：${escapeHtml(storeLabel)} · 读取：${escapeHtml(checked || "时间未知")} · 仅作为当前回执，不代表可自动提交。</span>`;
}

function attributeInputHtml(item) {
  const name = item.name || item.attribute_name || "未命名属性";
  const required = item.is_required ? "<b>*</b> " : "";
  // A numeric type is a validation rule, not a product fact. Never seed an
  // example number into a seller draft; the seller must provide evidence.
  const value = item.value == null ? "" : String(item.value);
  const placeholder = item.type === "Integer" || item.type === "Decimal"
    ? "填写真实数值；不能使用示例值"
    : (item.description || name);
  return `
    <div class="attribute-form-row" data-attribute-id="${item.id}" data-complex-id="${item.attribute_complex_id || 0}" data-attribute-type="${item.type || "String"}">
      <label>${required}${escapeHtml(name)} <span class="status-sub">ID ${item.id}</span></label>
      <div class="attribute-value-combobox">
        <input class="listing-attribute-input"
          data-attribute-id="${item.id}"
          data-complex-id="${item.attribute_complex_id || 0}"
          data-attribute-type="${item.type || "String"}"
          value="${value}"
          placeholder="${escapeHtml(placeholder)}" />
        <div class="attribute-value-menu"></div>
      </div>
      <button class="attribute-add" title="追加到 JSON">+</button>
    </div>
  `;
}

function attributeValueCacheKey(attributeId) {
  return [
    selectedStoreId(),
    $("#listingCategoryId")?.value || "",
    $("#listingTypeId")?.value || "",
    attributeId,
  ].join(":");
}

async function loadAttributeValues(attributeId) {
  const descriptionCategoryId = Number($("#listingCategoryId")?.value);
  const typeId = Number($("#listingTypeId")?.value);
  if (!descriptionCategoryId || !typeId || !attributeId) return [];
  const cacheKey = attributeValueCacheKey(attributeId);
  if (state.attributeValueCache[cacheKey]) return state.attributeValueCache[cacheKey];
  const data = await api("/api/ozon/description-attribute-values", {
    method: "POST",
    body: JSON.stringify({
      storeId: selectedStoreId(),
      environment: currentSellerReadEnvironment(),
      description_category_id: descriptionCategoryId,
      type_id: typeId,
      attribute_id: Number(attributeId),
      limit: 200,
    }),
  });
  const values = (data.result || []).map((item) => ({
    id: item.id || item.value_id || item.dictionary_value_id,
    value: item.value || item.name || item.attribute_value || "",
    info: item.info || item.description || "",
  })).filter((item) => item.value);
  state.attributeValueCache[cacheKey] = values;
  return values;
}

function bindAttributeValuePickers(root = document) {
  root.querySelectorAll(".listing-attribute-input[data-attribute-id], .variant-aspect-input[data-attribute-id]").forEach((input) => {
    if (input.dataset.valuePickerBound) return;
    input.dataset.valuePickerBound = "1";
    input.addEventListener("focus", () => showAttributeValueMenu(input));
    input.addEventListener("input", () => {
      input.dataset.dictionaryValueId = "";
      showAttributeValueMenu(input);
    });
  });
}

async function autoResolveAttributeValueInputs(root = document) {
  const inputs = [...root.querySelectorAll(".listing-attribute-input[data-attribute-id], .variant-aspect-input[data-attribute-id]")]
    .filter((input) => input.value.trim() && !input.dataset.dictionaryValueId);
  for (const input of inputs) {
    const attributeId = Number(input.dataset.attributeId);
    if (!attributeId) continue;
    let values = [];
    try {
      values = await loadAttributeValues(attributeId);
    } catch {
      values = [];
    }
    if (!values.length) continue;
    const rawValue = input.value.trim();
    const keyword = normalizeCategoryText(rawValue);
    const isColor = /颜色|цвет|color|colour/i.test(input.placeholder || "");
    const family = isColor ? colorFamily(rawValue) : "";
    const match = values
      .map((item) => ({
        ...item,
        score: normalizeCategoryText(item.value) === keyword ? 30
          : normalizeCategoryText(item.value).includes(keyword) || keyword.includes(normalizeCategoryText(item.value)) ? 18
            : family && colorFamily(item.value) === family ? 14
              : 0,
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (match?.id) {
      input.value = match.value;
      input.dataset.dictionaryValueId = match.id;
    }
  }
}

async function showAttributeValueMenu(input) {
  const combo = input.closest(".attribute-value-combobox");
  const menu = combo?.querySelector(".attribute-value-menu");
  if (!menu) return;
  const attributeId = Number(input.dataset.attributeId);
  menu.innerHTML = "<p>读取中文选项...</p>";
  menu.classList.add("open");
  try {
    const values = await loadAttributeValues(attributeId);
    const keyword = normalizeCategoryText(input.value);
    const family = /颜色|цвет|color|colour/i.test(input.placeholder || "") ? colorFamily(input.value) : "";
    const matches = values
      .map((item) => ({
        ...item,
        score: !keyword ? 1
          : normalizeCategoryText(item.value).includes(keyword) ? 10
            : family && colorFamily(item.value) === family ? 6
              : 0,
      }))
      .filter((item) => !keyword || item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 80);
    menu.innerHTML = matches.length
      ? matches.map((item) => `
          <button type="button" data-value-id="${escapeHtml(item.id || "")}" data-value="${escapeHtml(item.value)}">
            <strong>${escapeHtml(item.value)}</strong>
            ${item.info ? `<span>${escapeHtml(item.info)}</span>` : ""}
            ${item.id ? `<code>ID ${escapeHtml(item.id)}</code>` : ""}
          </button>
        `).join("")
      : "<p>没有匹配的中文选项，可以继续手动填写。</p>";
    menu.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        input.value = button.dataset.value || "";
        input.dataset.dictionaryValueId = button.dataset.valueId || "";
        menu.classList.remove("open");
      });
    });
  } catch (error) {
    menu.innerHTML = `<p>读取选项失败：${escapeHtml(error.message)}</p>`;
  }
}

function applyGeneratedContentToDynamicAttributes() {
  const content = state.generatedListingContent;
  if (!content) return;
  document.querySelectorAll("#attributeList .attribute-form-row").forEach((row) => {
    const name = normalizeAttributeRowName(row);
    const input = row.querySelector(".listing-attribute-input");
    if (!input) return;
    if (isCardMergeModelAttribute(name)) {
      input.value = $("#listingParentSku").value.trim() || content.parentSku || content.title;
      return;
    }
    if (isTagsAttribute(name)) input.value = content.tags;
    if (isDescriptionAttribute(name)) input.value = content.description;
    // Rich content JSON is handled manually to avoid template mismatch.
  });
}

function applyCardMergeModelAttribute() {
  const parentSku = $("#listingParentSku").value.trim();
  if (!parentSku) return;
  document.querySelectorAll("#attributeList .attribute-form-row").forEach((row) => {
    const name = normalizeAttributeRowName(row);
    const id = Number(row.dataset.attributeId);
    if (id === 9048 || isCardMergeModelAttribute(name)) {
      const input = row.querySelector(".listing-attribute-input");
      if (input) input.value = parentSku;
    }
  });
}

function normalizeAttributeRowName(row) {
  const label = row.querySelector("label")?.textContent || "";
  const id = Number(row.dataset.attributeId || 0);
  const meta = state.listingAttributes.find((item) => Number(item.id) === id) || {};
  const source = [label, meta.name || meta.attribute_name || "", meta.description || ""]
    .filter(Boolean)
    .join(" ");
  return normalizeName(source);
}

function isTitleAttribute(name) {
  if (isCardMergeModelAttribute(name)) return false;
  return /название|наименование|title|商品名称|标题|名称/.test(name);
}

function isCardMergeModelAttribute(name) {
  return /针对合并为一张商品卡片|объедин.*карточ|карточ.*объедин|型号名称.*合并|合并.*型号名称|一张卡片|同一卡片|同一商品卡/.test(name);
}

function isTagsAttribute(name) {
  return /хештег|хэштег|ключев|поисков|тег|tags|hashtag|主题标签|搜索关键词|关键词/.test(name);
}

function isDescriptionAttribute(name) {
  return /описан|description|商品描述|描述|文字描述/.test(name) && !isRichContentAttribute(name);
}

function isRichContentAttribute(name) {
  return /rich|контент|рич|富内容|richcontent|json|медиа|media/.test(name);
}

function isBrandAttribute(name) {
  return /бренд|brand|品牌/.test(name);
}

function isNoBrandValue(value) {
  return /нет\s*бренда|без\s*бренда|no\s*brand|无品牌|沒有品牌|无牌|без\s*торговой\s*марки/i.test(String(value || ""));
}

async function applyDefaultBrandAttribute() {
  const rows = [...document.querySelectorAll("#attributeList .attribute-form-row")];
  for (const row of rows) {
    const name = normalizeAttributeRowName(row);
    if (!isBrandAttribute(name)) continue;
    const input = row.querySelector(".listing-attribute-input");
    if (!input || input.value.trim()) continue;
    try {
      const values = await loadAttributeValues(Number(row.dataset.attributeId));
      const noBrand = values.find((item) => isNoBrandValue(item.value));
      if (noBrand) {
        input.value = noBrand.value;
        input.dataset.dictionaryValueId = noBrand.id || "";
      } else if (values.length) {
        input.value = values[0].value;
        input.dataset.dictionaryValueId = values[0].id || "";
      } else {
        input.value = "无品牌";
      }
    } catch (error) {
      input.value = "无品牌";
    }
  }
}

async function applyDefaultTypeAttribute() {
  const row = [...document.querySelectorAll("#attributeList .attribute-form-row")]
    .find((item) => Number(item.dataset.attributeId) === Number($("#listingTypeId")?.value || 0) || /类型|тип/.test(normalizeAttributeRowName(item)));
  const input = row?.querySelector(".listing-attribute-input");
  if (!row || !input) return;
  const currentTypeId = Number($("#listingTypeId")?.value || 0);
  try {
    const values = await loadAttributeValues(Number(row.dataset.attributeId));
    const exact = values.find((item) => Number(item.id) === currentTypeId)
      || values.find((item) => normalizeName(item.value) && normalizeName($("#listingCategoryPath")?.value || "").includes(normalizeName(item.value)));
    if (exact) {
      input.value = exact.value;
      input.dataset.dictionaryValueId = exact.id || "";
      return;
    }
  } catch {
    // keep fallback below
  }
  const path = $("#listingCategoryPath")?.value || "";
  input.value = path.split("/").map((part) => part.trim()).filter(Boolean).pop() || input.value || "";
}

function isVolumeAttribute(name = "") {
  return /体积|容量|毫升|升|volume|литр|мл/.test(name);
}

function volumeNumberFromCollectedData(data = state.collected1688 || {}) {
  const attrs = Array.isArray(data.attributes) ? data.attributes : [];
  const volumeAttr = attrs.find((item) => /容量|体积|毫升|升/.test(String(item.name || "")));
  const sourceText = [
    volumeAttr?.value || "",
    ...(data.skuVariants || []).map((sku) => sku.spec || ""),
    data.title || "",
  ].join(" ");
  const ml = sourceText.match(/(\d+(?:\.\d+)?)\s*ml/i);
  if (ml) return String(Math.round(Number(ml[1])));
  const l = sourceText.match(/(\d+(?:\.\d+)?)\s*[lL]|(\d+(?:\.\d+)?)\s*升/);
  if (l) {
    const value = Number(l[1] || l[2] || 0);
    if (value > 0) return String(Math.round(value * 1000));
  }
  return "";
}

function applyDefaultVolumeAttributes() {
  const volume = volumeNumberFromCollectedData();
  if (!volume) return;
  document.querySelectorAll("#attributeList .attribute-form-row").forEach((row) => {
    const input = row.querySelector(".listing-attribute-input");
    if (!input || input.value.trim()) return;
    const name = normalizeAttributeRowName(row);
    if (!isVolumeAttribute(name)) return;
    input.value = volume;
    input.dataset.dictionaryValueId = "";
  });
}

function appendAttributeTemplate(card) {
  const attributeId = Number(card.dataset.attributeId);
  const complexId = Number(card.dataset.complexId || 0);
  const type = card.dataset.attributeType || "String";
  const input = card.querySelector(".listing-attribute-input");
  const rawValue = input?.value?.trim() || (type === "Integer" || type === "Decimal" ? "1" : "请填写");
  const value = String(rawValue);
  const dictionaryValueId = Number(input?.dataset.dictionaryValueId || 0);
  const current = JSON.parse($("#listingAttributesJson").value || "[]");
  if (!current.some((item) => Number(item.id) === attributeId)) {
    current.push({
      id: attributeId,
      complex_id: complexId,
      values: [dictionaryValueId ? { dictionary_value_id: dictionaryValueId, value: rawValue } : { value }],
    });
    $("#listingAttributesJson").value = JSON.stringify(current, null, 2);
    toast("已追加属性模板");
  }
}

function collectAttributeInputs() {
  const rows = [...document.querySelectorAll("#attributeList .attribute-form-row")];
  return rows
    .map((row) => {
      const input = row.querySelector(".listing-attribute-input");
      const rawValue = input?.value?.trim();
      if (!rawValue) return null;
      const dictionaryValueId = Number(input?.dataset.dictionaryValueId || 0);
      const name = normalizeAttributeRowName(row);
      if (isTitleAttribute(name)) return null;
      if (isRichContentAttribute(name)) return null;
      const cleanValue = (isDescriptionAttribute(name) || isTagsAttribute(name))
        ? (isTagsAttribute(name) ? sanitizeHashtags(rawValue || state.generatedListingContent?.tags || "") : sanitizeCommercialText(rawValue))
        : rawValue;
      return {
        id: Number(row.dataset.attributeId),
        complex_id: Number(row.dataset.complexId || 0),
        values: [dictionaryValueId
          ? { dictionary_value_id: dictionaryValueId, value: cleanValue }
          : { value: String(cleanValue) }],
      };
    })
    .filter(Boolean);
}

function generatedContentAttributesFallback() {
  const content = state.generatedListingContent;
  if (!content) return [];
  const existing = new Set(collectAttributeInputs().map((item) => String(item.id)));
  const rows = [...document.querySelectorAll("#attributeList .attribute-form-row")];
  const result = [];
  const pushKnown = (id, value, sanitizer = safeRussianText) => {
    if (!value || existing.has(String(id))) return;
    result.push({ id, complex_id: 0, values: [{ value: sanitizer(value) }] });
    existing.add(String(id));
  };
  pushKnown(4191, $("#listingDescription")?.value || content.description, sanitizeCommercialText);
  pushKnown(23171, $("#listingKeywords")?.value || content.tags, sanitizeHashtags);
  const pairs = [
    [isCardMergeModelAttribute, $("#listingParentSku").value.trim()],
    [isTagsAttribute, $("#listingKeywords")?.value || content.tags],
    [isDescriptionAttribute, $("#listingDescription")?.value || content.description],
  ];
  for (const row of rows) {
    const name = normalizeAttributeRowName(row);
    const id = Number(row.dataset.attributeId);
    if (!id || existing.has(String(id))) continue;
    const match = pairs.find(([tester, value]) => value && tester(name));
    if (!match) continue;
    const sanitizer = isTagsAttribute(name) ? sanitizeHashtags
      : isRichContentAttribute(name) ? sanitizeOzonRichContent
        : sanitizeCommercialText;
    result.push({
      id,
      complex_id: Number(row.dataset.complexId || 0),
      values: [{ value: sanitizer(match[1]) }],
    });
  }
  return result;
}

function mergeAttributes(autoAttributes, jsonAttributes) {
  const map = new Map();
  for (const item of [...autoAttributes, ...jsonAttributes]) {
    if (!item?.id) continue;
    map.set(`${item.id}:${item.complex_id || 0}`, item);
  }
  return [...map.values()];
}

function collectVideoAttributes(offerId = "") {
  const videoUrl = $("#listingVideoUrl")?.value.trim();
  if (!videoUrl) return [];
  const videoTitle = ($("#listingName")?.value.trim() || "Видео товара").slice(0, 200);
  const values = [
    { id: 21841, complex_id: 100001, values: [{ value: videoUrl }] },
    { id: 21837, complex_id: 100001, values: [{ value: videoTitle }] },
  ];
  if (offerId) {
    values.push({ id: 22273, complex_id: 100001, values: [{ value: offerId }] });
  }
  return values;
}

function buildListingItemFromForm() {
  const images = normalizeImageUrlsForOzon($("#listingImages").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean));
  const firstVariant = collectListingVariants()[0] || {};
  const titleRu = ensureRussianTitle($("#listingName").value.trim());
  const tagsRu = ensureRussianTags($("#listingKeywords")?.value || "", titleRu);
  const descRu = ensureRussianDescription($("#listingDescription")?.value || "", titleRu);
  const richRu = ensureRussianRichContent($("#listingRichContent")?.value || "", titleRu, descRu);
  if ($("#listingName")) $("#listingName").value = titleRu;
  if ($("#listingKeywords")) $("#listingKeywords").value = tagsRu;
  if ($("#listingDescription")) $("#listingDescription").value = descRu;
  if ($("#listingRichContent")) $("#listingRichContent").value = richRu;

  const item = {
    offer_id: firstVariant.offer_id || $("#listingOfferId").value.trim(),
    name: titleRu || "Товар для дома",
    parent_sku: $("#listingParentSku").value.trim(),
    description_category_id: Number($("#listingCategoryId").value),
    new_description_category_id: 0,
    type_id: Number($("#listingTypeId").value),
    color_image: "",
    complex_attributes: [],
    price: firstVariant.price || $("#listingPrice").value.trim(),
    old_price: firstVariant.old_price || $("#listingOldPrice").value.trim(),
    min_price: firstVariant.min_price || $("#listingMinPrice").value.trim(),
    currency_code: $("#listingCurrency").value,
    vat: $("#listingVat").value,
    weight: Number(firstVariant.weight || $("#listingWeight").value),
    weight_unit: "g",
    depth: Number(firstVariant.depth || $("#listingDepth").value),
    width: Number(firstVariant.width || $("#listingWidth").value),
    height: Number(firstVariant.height || $("#listingHeight").value),
    dimension_unit: "mm",
    images,
    images360: [],
    pdf_list: [],
    primary_image: "",
    attributes: mergeAttributes(
      [
        ...collectAttributeInputs(),
        ...generatedContentAttributesFallback(),
        ...(firstVariant.aspectAttributes || []),
        ...collectVideoAttributes(firstVariant.offer_id || $("#listingOfferId")?.value.trim()),
      ],
      JSON.parse($("#listingAttributesJson").value || "[]")
    ),
  };

  if (!item.offer_id || !item.name || !item.description_category_id || !item.type_id) {
    throw new Error("Offer ID、商品名称、中文类目 ID、类型 ID 都必须填写");
  }
  if (!item.images.length) {
    throw new Error("至少填写一个图片 URL");
  }
  return item;
}

function buildListingItemsFromForm() {
  const base = buildListingItemFromForm();
  const variants = collectListingVariants();
  validateListingVariantsForUpload(variants);
  if (variants.length <= 1) return [base];
  return variants.map((variant) => ({
    ...base,
    offer_id: variant.offer_id,
    barcode: variant.barcode || undefined,
    name: variantTitle(base.name, variant),
    images: variant.images?.length ? variant.images : base.images,
    price: variant.price || base.price,
    old_price: variant.old_price || base.old_price,
    min_price: variant.min_price || base.min_price,
    weight: Number(variant.weight || base.weight),
    depth: Number(variant.depth || base.depth),
    width: Number(variant.width || base.width),
    height: Number(variant.height || base.height),
    attributes: mergeAttributes(base.attributes, [...(variant.aspectAttributes || []), ...collectVideoAttributes(variant.offer_id)]),
  }));
}

function variantTitle(baseName, variant) {
  const colorName = inferRussianColorNameFromSpec(variant.value || "") || "";
  const shapeName = detectRussianShape(variant.value || "", new Map());
  const suffix = [colorName, shapeName].filter(Boolean).join(", ");
  return compactRussianTitle(suffix ? `${baseName}, ${suffix}` : baseName);
}

function validateListingVariantsForUpload(variants) {
  if (!variants.length) throw new Error("至少需要一行变体");
  variants.forEach((variant, index) => {
    const rowNo = index + 1;
    if (!variant.offer_id) throw new Error(`第 ${rowNo} 行缺少 SKU编号`);
    if (!variant.price) throw new Error(`第 ${rowNo} 行缺少售价`);
    if (!variant.warehouse_id) throw new Error(`第 ${rowNo} 行缺少仓库`);
    if (!variant.stock && variant.stock !== "0") throw new Error(`第 ${rowNo} 行缺少库存`);
    if (!variant.weight || !variant.depth || !variant.width || !variant.height) throw new Error(`第 ${rowNo} 行缺少重量或包装尺寸`);
    if (variant.sizeWeightStatus === "missing") throw new Error(`第 ${rowNo} 行采集尺重不全，请先补齐重量和包装尺寸`);
    if (!variant.images?.length) throw new Error(`第 ${rowNo} 行缺少 SKU 图片`);
    if (variant.images.some((url) => /_+$|_b\.jpg$/i.test(url) || !/^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url))) {
      throw new Error(`第 ${rowNo} 行存在 Ozon 可能无法下载的图片链接，请先换成图片直链`);
    }
    const requiredAspects = variantAspectAttributes().filter((item) => item.is_required);
    const filled = new Set((variant.aspectAttributes || []).map((item) => Number(item.id)));
    const missing = requiredAspects.find((item) => !filled.has(Number(item.id)));
    if (missing) throw new Error(`第 ${rowNo} 行缺少必填变体属性：${missing.name || missing.attribute_name || missing.id}`);
  });
}

function collectListingVariants() {
  return [...document.querySelectorAll("#listingVariantRows tr")]
    .filter((row) => row.querySelector(".variant-row-check")?.checked !== false)
    .map((row) => ({
      offer_id: row.querySelector(".variant-offer-id, #listingOfferId")?.value.trim(),
      sku: row.querySelector(".variant-sku-text, #listingSkuText")?.value.trim(),
      barcode: row.querySelector(".variant-barcode")?.value.trim(),
      price: row.querySelector(".variant-price, #listingPrice")?.value.trim(),
      old_price: row.querySelector(".variant-old-price, #listingOldPrice")?.value.trim(),
      min_price: row.querySelector(".variant-min-price, #listingMinPrice")?.value.trim(),
      warehouse_id: row.querySelector(".variant-warehouse, #listingWarehouse")?.value,
      stock: row.querySelector(".variant-stock, #listingStock")?.value.trim(),
      images: variantImagesFromRow(row),
      weight: row.querySelector(".variant-weight, #listingWeight")?.value.trim(),
      depth: row.querySelector(".variant-depth, #listingDepth")?.value.trim(),
      width: row.querySelector(".variant-width, #listingWidth")?.value.trim(),
      height: row.querySelector(".variant-height, #listingHeight")?.value.trim(),
      sizeWeightStatus: row.dataset.sizeWeightStatus || "",
      status: row.querySelector(".variant-status-cell")?.dataset.status || "unlisted",
      taskId: row.querySelector(".variant-status-cell")?.dataset.taskId || "",
      productId: row.querySelector(".variant-status-cell")?.dataset.productId || "",
      statusMessage: row.querySelector(".variant-status-cell")?.dataset.message || "",
      value: variantDisplayValue(row),
      aspectAttributes: collectVariantAspectAttributes(row),
    }))
    .filter((item) => item.offer_id);
}

function variantDisplayValue(row) {
  const fallback = row.querySelector(".variant-value, #listingVariantValue")?.value.trim();
  if (fallback) return fallback;
  return [...row.querySelectorAll(".variant-aspect-input")]
    .map((input) => input.value.trim())
    .filter(Boolean)
    .join(" / ");
}

function variantImagesFromRow(row) {
  const textarea = row.querySelector(".variant-images-json");
  if (!textarea) return [];
  try {
    return normalizeImageUrlsForOzon(JSON.parse(textarea.value || "[]").filter(Boolean));
  } catch {
    return [];
  }
}

function collectVariantAspectAttributes(row) {
  return [...row.querySelectorAll(".variant-aspect-input")]
    .map((input) => {
      const rawValue = input.value.trim();
      if (!rawValue) return null;
      const type = input.dataset.attributeType || "String";
      let dictionaryValueId = Number(input.dataset.dictionaryValueId || 0);
      let value = rawValue;
      if (Number(input.dataset.attributeId) === 10096) {
        const colors = ozonColorDictionaryValues(rawValue);
        if (!colors.length) colors.push(...ozonColorDictionaryValues(defaultProductColorValue()));
        if (!colors.length) colors.push({ dictionary_value_id: 61571, value: "白色" });
        if (colors.length) {
          return {
            id: Number(input.dataset.attributeId),
            complex_id: Number(input.dataset.complexId || 0),
            values: colors,
          };
        }
      }
      return {
        id: Number(input.dataset.attributeId),
        complex_id: Number(input.dataset.complexId || 0),
        values: [dictionaryValueId
          ? { dictionary_value_id: dictionaryValueId, value }
          : { value: String(rawValue) }],
      };
    })
    .filter(Boolean);
}

function ozonColorDictionaryValues(value = "") {
  const text = String(value || "").toLowerCase();
  const rules = [
    [/白|米白|乳白|white|бел/, "白色", 61571],
    [/透明|clear|прозрач/, "透明", 61572],
    [/米色|米黄|беж/, "米色", 61573],
    [/黑|black|черн/, "黑色", 61574],
    [/棕|咖|brown|корич/, "棕色", 61575],
    [/灰|gray|grey|сер/, "灰色", 61576],
    [/黄|yellow|желт/, "黄色", 61578],
    [/酒红|枣红|玫红|红|red|бордо|красн/, "红色", 61579],
    [/粉红|粉|pink|розов/, "粉红色", 61580],
    [/蓝|藏青|navy|blue|син/, "蓝色", 61581],
    [/金|香槟|gold|золот/, "金色", 61582],
    [/绿|军绿|墨绿|green|зелен/, "绿色", 61583],
    [/天蓝|голуб/, "天蓝色", 61584],
    [/橙|orange|оранж/, "橙色", 61585],
    [/紫|purple|фиолет/, "紫色", 61586],
  ];
  const values = [];
  for (const [regex, color, id] of rules) {
    if (regex.test(text)) values.push({ dictionary_value_id: id, value: color });
  }
  if (!values.length) {
    const color = inferColorNameFromSpec(value);
    const fallback = rules.find(([, name]) => name === color || (color === "粉色" && name === "粉红色"));
    if (fallback) values.push({ dictionary_value_id: fallback[2], value: fallback[1] });
  }
  const seen = new Set();
  return values.filter((item) => {
    if (seen.has(item.dictionary_value_id)) return false;
    seen.add(item.dictionary_value_id);
    return true;
  }).slice(0, 6);
}

function previewListingImages() {
  const images = normalizeImageUrlsForOzon($("#listingImages").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean));
  $("#imagePreviewGrid").innerHTML = images.length
    ? images.slice(0, 30).map((src, index) => `
        <figure>
          <img src="${src}" alt="图片 ${index + 1}" />
          <figcaption>${index === 0 ? "主图" : `图片 ${index + 1}`}</figcaption>
        </figure>
      `).join("")
    : "<p class=\"hint\">暂无图片 URL。</p>";
  toast(images.length ? `已预览 ${Math.min(images.length, 30)} 张图片` : "当前没有可预览的图片 URL", images.length ? "ok" : "error");
}

async function submitListing() {
  toast("直通上架已关闭。请保存草稿，进入工作流预检，并使用绑定草稿哈希的人工确认提交。", "error");
  document.querySelector('[data-view="workflow-console"]')?.click();
}

async function saveSelectedCategoryToListingDraft() {
  const run = currentListingWorkflowRun();
  const job = currentListingAutoListJob(run);
  // A stale selected workflow must never fall through to the newest unrelated
  // draft. Category/type evidence is store- and product-scoped; saving it to
  // another job would make the next preflight appear to pass for the wrong
  // listing.
  if (state.selectedWorkflowRunId && state.selectedWorkflowRunId !== "__no_workflow__"
    && (!run || String(run.id || "") !== String(state.selectedWorkflowRunId || ""))) {
    toast("当前商品工作流已失效，请重新选择对应上架草稿后再保存类目", "warning");
    return;
  }
  const activeStoreId = String(selectedStoreId() || "").trim();
  if (job?.id && activeStoreId && String(job.storeId || "").trim() !== activeStoreId) {
    toast("当前草稿不属于所选店铺，未保存类目；请切换回原店铺后重试", "warning");
    return;
  }
  if (!job?.id) { toast("请先从候选池创建或选择上架草稿", "error"); return; }
  const button = $("#saveListingCategoryDraft");
  setBusy(button, true);
  try {
    let data = await api(`/api/ozon-learning/auto-list-jobs/${encodeURIComponent(job.id)}/manual-category`, {
      method: "POST",
      body: JSON.stringify({
        description_category_id: Number($("#listingCategoryId")?.value || 0),
        type_id: Number($("#listingTypeId")?.value || 0),
        path: $("#listingCategoryPath")?.value || $("#categoryKeyword")?.value || "已由当前店铺类目建议选择",
      }),
    });
    // Category selection is only useful to a seller once the refreshed draft
    // has a new local preflight result.  Validate the saved draft immediately
    // while keeping the hard boundary explicit: this endpoint only validates
    // the local payload; 不会调用 Seller API 写端点，也不会提交 Ozon。
    let preflight = null;
    if (data.workflowRunId) {
      try {
        preflight = await api(`/api/workflows/${encodeURIComponent(data.workflowRunId)}/payload-draft/validate`, {
          method: "POST",
          body: "{}",
        });
        data = { ...data, localPreflight: preflight };
      } catch (error) {
        data = { ...data, localPreflight: { ok: false, status: "unavailable", message: error.message || "本地预检未完成" } };
      }
    }
    showResponse(data);
    if (preflight) {
      toast(preflight.ok
        ? "类目已保存，本地预检通过；仍需媒体、价格和人工确认才能提交"
        : `类目已保存，但本地预检仍阻塞（${preflight.issues?.length || preflight.errors?.length || 0} 项）`, preflight.ok ? "ok" : "error");
    } else {
      toast(data.payloadDraftReady ? "类目已保存，Payload 已刷新；请继续运行本地预检" : "类目已保存到当前草稿");
    }
    await loadAutoListJobs();
    await loadWorkflowRuns();
  } catch (error) {
    toast(error.message || "保存类目失败", "error");
  } finally {
    setBusy(button, false);
    if (nextButton) {
      setBusy(nextButton, false);
      nextButton.disabled = !state.productHasNext;
    }
  }
}

function applySubmittedStatusToRows(items, taskId = "") {
  const offers = new Set((items || []).map((item) => item.offer_id));
  document.querySelectorAll("#listingVariantRows tr").forEach((row) => {
    const offer = row.querySelector(".variant-offer-id, #listingOfferId")?.value.trim();
    if (offers.has(offer)) setVariantRowStatus(row, "submitted", "已提交，等待 Ozon 处理", taskId);
  });
}

async function enqueueListingStockQueue(taskId, variants = collectListingVariants()) {
  const stocks = variants
    .map((variant) => ({
      offer_id: variant.offer_id,
      stock: Number(variant.stock || 0),
      warehouse_id: Number(variant.warehouse_id || 0),
    }))
    .filter((item) => item.offer_id && item.warehouse_id && Number.isFinite(item.stock));
  if (!stocks.length) return null;
  return api("/api/ozon/stock-queue", {
    method: "POST",
    body: JSON.stringify({
      storeId: selectedStoreId(),
      taskId,
      stocks,
      delayMs: 5 * 60 * 1000,
    }),
  });
}

async function prepareListingItemsForOzon(items) {
  const urls = [...new Set(items.flatMap((item) => item.images || []))];
  if (!urls.length) return items;
  toast("正在转存图片到 OSS...");
  const prepared = await api("/api/images/prepare-ozon", {
    method: "POST",
    body: JSON.stringify({ urls, ocr: true, blockChinese: true, translateChinese: true }),
  });
  const skipped = (prepared.images || []).filter((item) => item.skipped);
  const needsTranslation = skipped.filter((item) => item.reason === "needs_translation");
  const factoryIntro = skipped.filter((item) => item.reason === "factory_intro");
  const ocrUnavailable = (prepared.images || []).some((item) => item.ocr && item.ocr.available === false);
  if (ocrUnavailable) {
    toast("OCR 尚未启用，本次图片仅转存 OSS，未做文字筛选");
  }
  if (needsTranslation.length) {
    const missingConfig = needsTranslation.some((item) => item.translation?.reason === "missing_user_key_or_img_trans_key");
    if (missingConfig) {
      const sample = needsTranslation[0].ocr?.text || needsTranslation[0].sourceUrl;
      throw new Error(`检测到 ${needsTranslation.length} 张图片含中文，象寄图片翻译缺少 UserKey 或阿里标识码。示例：${sample}`);
    }
    toast(`有 ${needsTranslation.length} 张含中文图片未能自动翻译，已自动跳过这些图片`);
  }
  if (factoryIntro.length) {
    toast(`已剔除 ${factoryIntro.length} 张疑似工厂/联系方式介绍图`);
  }
  const map = new Map((prepared.images || []).map((item) => [item.sourceUrl, item.url]));
  return items.map((item) => ({
    ...item,
    images: (item.images || [])
      .map((url) => map.get(normalizeImageUrlForOzon(url)) || map.get(url) || "")
      .filter(Boolean),
  }));
}

function buildListingDraftSnapshot(extra = {}) {
  return {
    parentSku: $("#listingParentSku").value.trim(),
    parentSkus: state.reservedParentSkus || [],
    selectedVariantGroup: state.selectedVariantGroup || 0,
    title: $("#listingName").value.trim(),
    storeId: selectedStoreId(),
    categoryId: $("#listingCategoryId").value,
    typeId: $("#listingTypeId").value,
    categoryPath: $("#listingCategoryPath").value,
    videoUrl: $("#listingVideoUrl").value.trim(),
    variants: collectListingVariants().map((item) => ({
      offer_id: item.offer_id,
      status: item.status || "unlisted",
      taskId: item.taskId || "",
      productId: item.productId || "",
      message: item.statusMessage || "",
    })),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

async function saveListingDraft(status = "draft", extra = {}) {
  if (!state.currentCaptureId) {
    toast("当前不是从采集箱进入的商品，已保留在页面草稿中");
    return null;
  }
  const item = await api(`/api/1688/captures/${state.currentCaptureId}`, {
    method: "PATCH",
    body: JSON.stringify({
      storeId: selectedStoreId(),
      status,
      draft: buildListingDraftSnapshot(extra),
    }),
  });
  state.currentCaptureDraft = item.draft || buildListingDraftSnapshot(extra);
  // The collection-box editor historically saved only a local capture draft,
  // leaving the seller without a workflow run and therefore without the
  // existing preflight screen.  Bind it to a local workflow now; this route
  // is strictly local and does not call Ozon or submit anything.
  try {
    const workflow = await api(`/api/1688/captures/${encodeURIComponent(state.currentCaptureId)}/workflow`, {
      method: "POST",
      body: JSON.stringify({ storeId: selectedStoreId() }),
    });
    if (workflow.workflowRunId) {
      state.selectedWorkflowRunId = workflow.workflowRunId;
      state.selectedWorkflowNodeKey = "candidate_handoff";
      await loadWorkflowRuns();
    }
  } catch (error) {
    state.listingHandoffNotice = "草稿已保存，但商品工作流绑定失败；请重新保存后再进入预检。";
    console.warn("listing workflow binding failed", error?.message || error);
  }
  // Refresh the linked auto-listing job before the seller summary renders;
  // otherwise a newly created capture workflow has an id but the UI cannot
  // show its category/procurement/package repair forms yet.
  await loadAutoListJobs().catch(() => {});
  await loadCaptureBox();
  toast(status === "published" ? "已保存发布记录" : status === "submitted" ? "已保存提交回查记录" : "草稿已保存");
  return item;
}

async function saveAndSubmitListing() {
  await saveListingDraft("draft");
  await submitListing();
}

function backToCaptureBox() {
  document.querySelector('[data-view="sourcing"]').click();
  loadCaptureBox();
}

async function checkListingTask() {
  const button = $("#checkListingTask");
  setBusy(button, true);
  try {
    const taskId = Number($("#listingTaskId").value);
    if (!taskId) throw new Error("请填写 Task ID");
    const data = await api("/api/ozon/product-import-info", {
      method: "POST",
      body: JSON.stringify({
        storeId: selectedStoreId(),
        task_id: taskId,
        workflowRunId: state.selectedWorkflowRunId || "",
      }),
    });
    applyImportInfoToVariantRows(data, taskId);
    const currentRun = currentListingWorkflowRun();
    const currentJob = currentListingAutoListJob(currentRun);
    let reconciliation = null;
    if (currentJob?.id) {
      try {
        const environmentCheck = validateReadOperatorEnvironment(currentSellerReadEnvironment());
        if (!environmentCheck.ok) throw new Error(environmentCheck.message);
        reconciliation = await api("/api/ozon-learning/reconcile-submitted", {
          method: "POST",
          body: JSON.stringify({ limit: 1, jobId: currentJob.id, taskId, storeId: selectedStoreId(), environment: environmentCheck.environment }),
        });
      } catch (error) {
        reconciliation = { ok: false, sellerResult: { status: "readback_unavailable", action: error.message || "审核节点尚未同步" } };
      }
    }
    showResponse({ importInfo: data, reviewReconciliation: reconciliation });
    // A task readback is not moderation approval or sale readiness. Do not
    // mark a pending/failed asynchronous task as published in the capture box.
    await saveListingDraft("submitted", {
      taskId,
      checkedAt: new Date().toISOString(),
      taskReadbackStatus: reconciliation?.sellerResult?.status || data?.result?.status || data?.status || "unknown",
      taskReadbackEvidence: data.operationEvidence?.responseHash ? "server_observed" : "missing",
    });
    await loadAutoListJobs();
    await loadWorkflowRuns();
    const evidenceLabel = data.operationEvidence?.responseHash ? "已记录 1 条回查证据" : "未返回回查证据引用";
    const reconciliationLabel = reconciliation?.sellerResult?.result || reconciliation?.sellerResult?.action || "审核节点尚未同步";
    toast(`任务结果已读取；${evidenceLabel}；${reconciliationLabel}；不会自动生成条形码或执行其他写操作`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function applyImportInfoToVariantRows(data, taskId = "") {
  const items = data.result?.items || data.items || data.result || [];
  if (!Array.isArray(items)) return;
  const byOffer = new Map(items.map((item) => [item.offer_id, item]));
  document.querySelectorAll("#listingVariantRows tr").forEach((row) => {
    const offer = row.querySelector(".variant-offer-id, #listingOfferId")?.value.trim();
    const item = byOffer.get(offer);
    if (!item) {
      const current = row.querySelector(".variant-status-cell")?.dataset.status || "";
      if (current === "submitted") {
        setVariantRowStatus(row, "unclaimed", "Ozon 任务结果没有返回这个 SKU，请检查是否被合并或未进入本次任务", taskId);
      }
      return;
    }
    const errors = (item.errors || []).filter((error) => error.level === "error");
    const warnings = (item.errors || []).filter((error) => error.level !== "error");
    const message = errors.length
      ? errors.map((error) => `${error.attribute_name || error.field || error.code}: ${error.message || error.description || error.code}`).join("；")
      : warnings.map((error) => `${error.attribute_name || error.field || error.code}: ${error.message || error.description || error.code}`).join("；");
    const status = errors.length ? "error" : "success";
    setVariantRowStatus(row, status, message, taskId, item.product_id || "");
  });
}

function productIdsFromImportInfo(data) {
  const items = data.result?.items || data.items || data.result || [];
  if (!Array.isArray(items)) return [];
  return [...new Set(items
    .map((item) => item.product_id || item.productId || item.id)
    .map((id) => Number(id))
    .filter(Boolean))];
}

async function generateOzonBarcodes(productIds) {
  return api("/api/ozon/barcodes/generate", {
    method: "POST",
    ...directWriteRequest({
      storeId: selectedStoreId(),
      product_ids: productIds,
    }, "barcode-generate"),
  });
}

async function readStock() {
  const button = $("#readStock");
  const requestToken = (state.stockReadRequestToken = Number(state.stockReadRequestToken || 0) + 1);
  const requestStoreId = selectedStoreId();
  const requestEnvironment = String(currentSellerReadEnvironment() || "").trim();
  const environmentCheck = validateReadOperatorEnvironment(requestEnvironment);
  if (!environmentCheck.ok) {
    toast(environmentCheck.message || "请先选择有效的读取环境。", "error");
    return false;
  }
  setBusy(button, true);
  state.stockSnapshotProducts = null;
  state.stockSnapshot = null;
  const stockTable = $("#stockTable");
  if (stockTable) stockTable.innerHTML = "<tr><td colspan=\"5\">正在读取当前店铺库存……</td></tr>";
  try {
    const offerIds = [...new Set(String($("#stockOfferId").value || "")
      .split(/[\s,;]+/)
      .map((value) => value.trim())
      .filter(Boolean))].slice(0, 100);
    if (!offerIds.length) {
      toast("请先填写至少一个 Offer ID。", "error");
      return false;
    }
    const data = await api("/api/ozon/product-stocks", {
      method: "POST",
      body: JSON.stringify({
        storeId: requestStoreId,
        environment: requestEnvironment,
        filter: {
          offer_id: offerIds,
          visibility: "ALL",
        },
        // The seller can enter up to 100 Offer IDs.  A limit of 10 silently
        // dropped the remaining offers while the UI still announced a
        // successful inventory read.
        limit: 100,
      }),
    });
    if (requestToken !== state.stockReadRequestToken
      || requestStoreId !== selectedStoreId()
      || String(currentSellerReadEnvironment() || "").trim() !== requestEnvironment) return false;
    if (String(data?.storeId || "").trim() !== String(requestStoreId || "").trim()) {
      throw new Error("库存读取回执不属于当前店铺，已丢弃；请重新读取当前店铺库存。");
    }
    if (String(data?.environment || "").trim() !== requestEnvironment) {
      throw new Error("库存读取回执不属于当前读取环境，已丢弃；请重新读取当前环境库存。");
    }
    const rawItems = data?.items ?? data?.result?.items;
    if (!Array.isArray(rawItems)) {
      state.stockSnapshotProducts = null;
      state.stockSnapshot = null;
      if (stockTable) stockTable.innerHTML = "<tr><td colspan=\"5\">库存读取结果未知；Seller API 没有返回可解释的商品库存列表，请重试。</td></tr>";
      toast("库存读取结果未知，请检查 Seller API 返回后重试。", "error");
      return false;
    }
    const items = rawItems;
    const returnedOfferIds = new Set(items
      .map((item) => String(item?.offer_id || item?.offerId || "").trim())
      .filter(Boolean));
    const missingOfferIds = offerIds.filter((offerId) => !returnedOfferIds.has(offerId));
    const nextCursor = String(data?.cursor || data?.next_cursor || data?.result?.cursor || data?.result?.next_cursor || "").trim();
    const hasNextPage = Boolean(data?.has_next || data?.result?.has_next || nextCursor);
    state.stockSnapshotProducts = Array.isArray(items) ? items.map((item) => ({
      offer_id: item.offer_id,
      product_id: item.product_id,
      status: item.status || item.status_name || item.moderate_status || "",
      status_failed: item.status_failed === true,
    })) : null;
    const warehouseStocks = Array.isArray(items) ? items.flatMap((item) => (item.stocks || [])
      .filter((stock) => Number(stock.warehouse_id || stock.warehouseId || 0) > 0)
      .map((stock) => {
        // A missing present/stock field is unknown evidence, not zero. Keep
        // the null boundary so the dry-run and product ledger cannot present
        // an incomplete Seller response as an empty warehouse.
        const rawStock = stock.present ?? stock.stock;
        const numericStock = rawStock === null || rawStock === undefined || rawStock === ""
          ? null
          : Number(rawStock);
        return {
          offer_id: item.offer_id,
          warehouse_id: Number(stock.warehouse_id || stock.warehouseId),
          stock: Number.isFinite(numericStock) ? numericStock : null,
        };
      })) : [];
    state.stockSnapshot = warehouseStocks.length ? warehouseStocks : null;
    const rows = [];
    for (const item of items) {
      for (const stock of item.stocks || []) {
        rows.push(`
          <tr>
            <td>${item.offer_id || "-"}</td>
            <td>${item.product_id || "-"}</td>
            <td>${stock.type || "-"}</td>
            <td>${stock.present ?? "-"}</td>
            <td>${stock.reserved ?? "-"}</td>
          </tr>
        `);
      }
    }
    const completenessNotice = missingOfferIds.length || hasNextPage
      ? `<tr class="stock-read-incomplete"><td colspan="5">库存读取不完整：${missingOfferIds.length ? `未返回 Offer ${missingOfferIds.join(", ")}${hasNextPage ? "；还有下一页" : ""}` : "Seller API 返回了下一页游标，请改用库存预演读取完整范围"}。当前结果不能代表全部输入商品。</td></tr>`
      : "";
    $("#stockTable").innerHTML = rows.length
      ? `${completenessNotice}${rows.join("")}`
      : `${completenessNotice || "<tr><td colspan=\"5\">没有库存数据。</td></tr>"}`;
    showResponse(data);
    toast(missingOfferIds.length || hasNextPage ? "库存读取不完整，请按提示补读" : "库存已读取", missingOfferIds.length || hasNextPage ? "warning" : "success");
  } catch (error) {
    if (requestToken !== state.stockReadRequestToken
      || requestStoreId !== selectedStoreId()
      || String(currentSellerReadEnvironment() || "").trim() !== requestEnvironment) return false;
    state.stockSnapshotProducts = null;
    state.stockSnapshot = null;
    if (stockTable) stockTable.innerHTML = "<tr><td colspan=\"5\">库存读取失败；旧店铺数据已清除，请重试。</td></tr>";
    toast(error.message, "error");
  } finally {
    if (requestToken === state.stockReadRequestToken) setBusy(button, false);
  }
}

function renderStockDryRun(data = {}) {
  const view = data.sellerView || {};
  const result = $("#stockDryRunResult");
  if (!result) return;
  const blockers = (view.blockers || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const blockerDetails = (view.blockerDetails || []).map((item) => `
    <li><b>${escapeHtml(item.label || item.code || "库存阻断")}</b> · Offer ${escapeHtml(item.offer_id || "-")} · 仓库 ${escapeHtml(String(item.warehouse_id || "未知"))}</li>
  `).join("");
  const changes = (view.changes || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.offer_id || "-")}</td>
      <td>${escapeHtml(String(item.warehouse_id || "-"))}</td>
      <td>${escapeHtml(String(item.current))}</td>
      <td>${escapeHtml(String(item.target))}</td>
      <td>${escapeHtml(item.direction)} ${escapeHtml(String(Math.abs(item.delta)))}</td>
    </tr>
  `).join("");
  const targetTuples = Array.isArray(view.targetTuples) ? view.targetTuples : [];
  const unknownTuples = Array.isArray(view.unknownTuples) ? view.unknownTuples : [];
  const tupleRows = targetTuples.map((item) => `
    <tr>
      <td>${escapeHtml(String(item.offer_id || "-"))}</td>
      <td>${escapeHtml(String(item.warehouse_id || "-"))}</td>
      <td>${unknownTuples.some((unknown) => String(unknown.offer_id) === String(item.offer_id) && Number(unknown.warehouse_id) === Number(item.warehouse_id)) ? "待重新读取" : escapeHtml(String(item.target ?? "未知"))}</td>
    </tr>
  `).join("");
  const tupleEvidence = targetTuples.length ? `
    <div class="stock-dry-run-tuples">
      <strong>本次核对范围</strong>
      <p>每一行都对应一个商品和仓库；当前数量未知时不能按 0 处理。</p>
      <div class="table-wrap"><table><thead><tr><th>商品 Offer</th><th>仓库</th><th>目标库存</th></tr></thead><tbody>${tupleRows}</tbody></table></div>
    </div>
  ` : "";
  const unknownTupleNotice = unknownTuples.length ? `
    <p class="stock-dry-run-unknown"><b>还缺少当前库存：</b>${unknownTuples.map((item) => `Offer ${escapeHtml(String(item.offer_id || "-"))} / 仓库 ${escapeHtml(String(item.warehouse_id || "-"))}`).join("、")}。这些商品仓库组合必须重新读取到明确数量后，才能再次预演。</p>
  ` : "";
  const dryRun = data.dryRun || {};
  const canConfirmWrite = dryRun.executable === true
    && Number(view.changeCount || 0) > 0
    && stockEvidenceUsableForCurrentTarget()
    && stockDryRunMatchesCurrentTarget(data);
  const writeConfirmation = canConfirmWrite ? `
    <div class="stock-write-confirmation" data-stock-write-confirmation>
      <strong>受控库存写入</strong>
      <p>服务端会在写入前重新读取商品、仓库和当前库存；写入后仍会立即回读，不会把 accepted 当成已对账。</p>
      <label><input type="checkbox" data-stock-write-confirm /> 我确认当前差异、仓库和目标库存无误</label>
      <button type="button" class="primary" data-confirm-stock-write>确认并写入当前差异</button>
      <p class="stock-write-response" aria-live="polite"></p>
    </div>
  ` : "";
  result.innerHTML = `
    <div class="stock-dry-run-summary">
      <strong>${escapeHtml(view.statusLabel || "预演完成")}</strong>
      <p>${escapeHtml(view.summary || "")}</p>
      <small>${escapeHtml(view.sideEffect || "")}</small>
    </div>
    ${tupleEvidence}
    ${unknownTupleNotice}
    ${blockers || blockerDetails ? `<ul class="stock-dry-run-blockers">${blockerDetails || blockers}</ul>` : ""}
    ${changes ? `<div class="table-wrap"><table><thead><tr><th>Offer ID</th><th>仓库</th><th>当前</th><th>目标</th><th>变化</th></tr></thead><tbody>${changes}</tbody></table></div>` : ""}
    <p class="stock-dry-run-next"><strong>安全下一步：</strong>${escapeHtml(view.nextAction || "")}</p>
    ${writeConfirmation}
  `;
}

function stockTargetsFromEditor() {
  const rows = JSON.parse($("#stockJson")?.value || "[]");
  if (!Array.isArray(rows) || !rows.length) {
    const error = new Error("请先填写至少一条目标库存。");
    error.reasonCode = "STOCK_EVIDENCE_OFFERS_REQUIRED";
    throw error;
  }
  const offerIds = [...new Set(rows.map((row) => String(row?.offer_id || row?.offerId || "").trim()).filter(Boolean))];
  if (!offerIds.length) {
    const error = new Error("目标库存缺少 Offer ID。");
    error.reasonCode = "STOCK_EVIDENCE_OFFERS_REQUIRED";
    throw error;
  }
  if (offerIds.length > 100) {
    const error = new Error("一次最多读取 100 个商品的预演证据。");
    error.reasonCode = "STOCK_EVIDENCE_OFFERS_LIMIT_EXCEEDED";
    throw error;
  }
  const warehouseIds = [...new Set(rows
    .map((row) => Number(row?.warehouse_id || row?.warehouseId || 0))
    .filter((warehouseId) => Number.isSafeInteger(warehouseId) && warehouseId > 0))];
  // A target without its exact warehouse tuple cannot be safely reconciled.
  // Fail at the editor boundary with a seller-facing instruction instead of
  // sending an empty warehouse scope and waiting for a generic server block.
  const missingWarehouseRow = rows.findIndex((row) => {
    const warehouseId = Number(row?.warehouse_id || row?.warehouseId || 0);
    return !Number.isSafeInteger(warehouseId) || warehouseId <= 0;
  });
  if (missingWarehouseRow >= 0) {
    const error = new Error(`第 ${missingWarehouseRow + 1} 行缺少仓库 ID。`);
    error.reasonCode = "STOCK_EVIDENCE_WAREHOUSE_REQUIRED";
    throw error;
  }
  const normalizedRows = rows.map((row, index) => {
    const rawStock = row?.stock ?? row?.quantity;
    const stock = rawStock === null || rawStock === undefined || String(rawStock).trim() === ""
      ? NaN
      : Number(rawStock);
    if (!Number.isSafeInteger(stock) || stock < 0) {
      const error = new Error(`第 ${index + 1} 行目标库存必须填写大于等于 0 的整数。`);
      error.reasonCode = "STOCK_EVIDENCE_TARGET_STOCK_INVALID";
      throw error;
    }
    return {
      ...row,
      offer_id: String(row?.offer_id || row?.offerId || "").trim(),
      warehouse_id: Number(row?.warehouse_id || row?.warehouseId || 0),
      stock,
    };
  });
  return { rows: normalizedRows, offerIds, warehouseIds };
}

function stockTargetSignature(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      offer_id: String(row?.offer_id || row?.offerId || "").trim(),
      warehouse_id: Number(row?.warehouse_id || row?.warehouseId || 0),
      stock: Number(row?.stock ?? row?.quantity ?? 0),
    }))
    .sort((a, b) => a.offer_id.localeCompare(b.offer_id) || a.warehouse_id - b.warehouse_id)
    .map((row) => `${row.offer_id}::${row.warehouse_id}::${row.stock}`)
    .join("|");
}

function stockDryRunMatchesCurrentTarget(data = {}) {
  const planned = data?.dryRun?.plan?.targetStocks;
  if (!Array.isArray(planned) || !planned.length) return false;
  try {
    return stockTargetSignature(planned) === stockTargetSignature(stockTargetsFromEditor().rows);
  } catch {
    return false;
  }
}

// The preview/write entry point must be tied to the same fresh evidence that
// produced the target. A local JSON target alone is never write-ready.
function stockEvidenceUsableForCurrentTarget() {
  const evidence = state.stockEvidence;
  if (!evidence || evidence.failed === true || evidence.stale === true || evidence.partial === true) return false;
  // The read endpoint derives `partial` from this flag, but keep the guard at
  // the UI boundary as well. A stale/legacy state object (or a handoff from a
  // different view) must not become preview-ready merely because it omitted
  // the completeness marker. Product readiness is part of the same evidence
  // chain: current stock for a non-sellable or unconfirmed Offer is not a
  // valid inventory preview input.
  if (evidence.completeForRequestedIds !== true || evidence.productStatusReadyForAll !== true) return false;
  if (!Array.isArray(evidence.missingEvidence) || evidence.missingEvidence.length) return false;
  const checkedAt = Date.parse(String(evidence.checkedAt || ""));
  if (!Number.isFinite(checkedAt) || checkedAt > Date.now() || Date.now() - checkedAt > 30 * 60 * 1000) return false;
  let target;
  try {
    target = stockTargetsFromEditor();
  } catch {
    return false;
  }
  return evidence.storeId === selectedStoreId()
    && String(evidence.environment || "").trim() === String(currentSellerReadEnvironment() || "").trim()
    && Array.isArray(evidence.offerIds)
    && evidence.offerIds.join("|") === target.offerIds.join("|")
    && Array.isArray(evidence.warehouseIds)
    && evidence.warehouseIds.join("|") === target.warehouseIds.join("|");
}

function syncStockActionButtons() {
  const button = $("#stockDryRun");
  if (!button) return;
  const ready = stockEvidenceUsableForCurrentTarget();
  button.disabled = !ready;
  button.title = ready
    ? "当前商品、仓库和库存证据有效，可进行本地差异预演"
    : "必须先读取当前商品、仓库和库存证据；证据过期或目标变更后需重新读取";
}

function stockEvidenceSellerError(reasonCode = "") {
  const messages = {
    STOCK_EVIDENCE_STORE_REQUIRED: "请先选择当前店铺，再读取库存预演证据。",
    STOCK_EVIDENCE_OFFERS_REQUIRED: "请在目标库存中填写至少一个有效 Offer ID。",
    STOCK_EVIDENCE_OFFERS_LIMIT_EXCEEDED: "一次最多读取 100 个唯一 Offer ID，请拆分后再试。",
    STOCK_EVIDENCE_OFFER_INVALID: "目标库存包含无效 Offer ID，请修正后再读取。",
    STOCK_EVIDENCE_WAREHOUSE_REQUIRED: "每个目标库存都必须绑定明确的 Ozon 仓库 ID，不能按未知仓库读取。",
    STOCK_EVIDENCE_TARGET_STOCK_INVALID: "每个目标库存都必须填写大于等于 0 的整数；空值不会按 0 处理。",
  };
  return messages[reasonCode] || "库存预演证据读取失败，请检查店铺连接后重试。";
}

function stockProductReadinessNextAction(data = {}) {
  const products = Array.isArray(data.products) ? data.products : [];
  if (products.some((item) => item?.visible === false)) return "先确认隐藏商品已上架且对买家可见，再重新读取商品状态；当前不能进入库存预演。";
  if (products.some((item) => item?.status_stale === true || ["stale", "expired", "outdated"].includes(String(item?.statusFreshness || item?.freshnessStatus || "").toLowerCase()))) return "商品状态读取已陈旧；先重新读取并确认审核/在售状态，当前不能进入库存预演。";
  if (products.some((item) => ["moderating", "moderation", "processing", "imported", "under_review", "pending"].includes(String(item?.status || item?.status_name || item?.moderate_status || "").toLowerCase()))) return "商品仍在审核或导入中；等待 Ozon 完成后重新读取状态，当前不能进入库存预演。";
  if (products.some((item) => !String(item?.status || item?.status_name || item?.moderate_status || "").trim())) return "商品状态尚未确认；重新读取商品详情和审核状态，当前不能进入库存预演。";
  return "等待商品状态明确可售后重新读取证据；当前不能进入库存预演。";
}

function stockOperationSellerLabel(operationPath = "") {
  const path = String(operationPath || "");
  if (/product\/list/.test(path)) return "商品状态";
  if (/stocks/.test(path)) return "当前库存";
  if (/product\/info/.test(path)) return "商品详情";
  if (/warehouse/.test(path)) return "仓库状态";
  return "库存读取";
}

function renderStockEvidence(data = {}) {
  const result = $("#stockEvidenceResult");
  if (!result) return;
  const missing = Array.isArray(data.missingEvidence) ? data.missingEvidence : [];
  const targetTuples = Array.isArray(data.targetTuples) ? data.targetTuples : [];
  const unknownTuples = Array.isArray(data.unknownTuples) ? data.unknownTuples : missing
    .map((item) => String(item).match(/^current_stock:([^:]+):(\d+)$/))
    .filter(Boolean)
    .map((match) => ({ offer_id: match[1], warehouse_id: Number(match[2]), current: null }));
  const missingSellerLabels = missing.map((item) => {
    const text = String(item);
    const tuple = text.match(/^current_stock:([^:]+):(\d+)$/);
    if (tuple) return `Offer ${tuple[1]} / 仓库 ${tuple[2]}：当前库存未读取`;
    return ({
      product_list: "商品状态未读取",
      product_details: "商品详情未完整读取",
      current_stocks: "当前库存未完整读取",
      warehouses: "仓库状态未完整读取",
    })[text] || "仍有一项库存证据未补齐";
  });
  const tupleNeedsRead = unknownTuples.length
    ? `<p class="stock-evidence-unknown"><b>需要重新读取的商品仓库：</b>${unknownTuples.map((item) => `Offer ${escapeHtml(String(item.offer_id || "-"))} / 仓库 ${escapeHtml(String(item.warehouse_id || "-"))}`).join("、")}。当前数量未知，不能按 0 判断。</p>`
    : "";
  const tupleScope = targetTuples.length
    ? `<p class="stock-evidence-targets"><b>本次核对范围：</b>${targetTuples.map((item) => `Offer ${escapeHtml(String(item.offer_id || "-"))} / 仓库 ${escapeHtml(String(item.warehouse_id || "-"))}，目标 ${escapeHtml(String(item.target ?? "未知"))}`).join("；")}</p>`
    : "";
  const partial = data.partial === true || data.stale === true || missing.length > 0;
  const productNotReady = data.productStatusReadyForAll === false;
  const hasProblem = data.failed === true || partial || productNotReady;
  const verification = sellerEvidenceVerification({
    failed: data.failed === true,
    partial,
    liveReadObserved: data.liveReadObserved === true,
    verificationLevel: data.verificationLevel,
  });
  const scopeText = data.storeId
    ? `店铺 ${data.storeId} · ${Number(data.offerIds?.length || 0)} 个 Offer · ${Number(data.warehouseIds?.length || 0)} 个目标仓库`
    : "尚未绑定店铺和 Offer 范围";
  const nextAction = data.nextAction || (data.failed
    ? "检查店铺只读连接后重新读取证据。"
    : partial
      ? "补齐或重新读取缺失证据；当前不能继续库存预演。"
      : productNotReady
        ? stockProductReadinessNextAction(data)
      : "确认目标库存未变化后，再点击库存差异预演。");
  const receiptEligible = Boolean(!data.failed && !partial && !productNotReady && data.completeForRequestedIds === true && !data.stale && data.storeId && data.offerIds?.length);
  const operationEvidence = Array.isArray(data.operationEvidence) ? data.operationEvidence : [];
  const paginationAttempts = Array.isArray(data.endpointAttempts) ? data.endpointAttempts.filter((entry) => Number(entry?.pageCount || 0) > 1 || entry?.paginationComplete === false) : [];
  const paginationSummary = paginationAttempts.length
    ? `<small>分页读取：${paginationAttempts.map((entry) => `${escapeHtml(stockOperationSellerLabel(entry.endpoint))} ${Number(entry.pageCount || 0)} 页${entry.paginationCursorRepeated ? "，游标重复已停止" : entry.paginationComplete === false ? "，仍需重读" : ""}`).join("；")}</small>`
    : "";
  result.innerHTML = `
    <div class="stock-evidence-summary ${hasProblem ? "is-partial" : "is-complete"}">
      <strong>${data.failed === true ? "库存证据读取失败" : data.stale === true ? "目标库存已修改，原预演证据已陈旧" : partial ? "库存预演证据不完整" : productNotReady ? "商品尚未明确可售" : "库存预演证据已读取"}</strong>
      <span>证据时间：${escapeHtml(data.checkedAt || "未返回")}</span>
      <div class="seller-evidence-verification" data-level="${escapeHtml(verification.level)}">
        <span>验证等级：${escapeHtml(verification.label)}</span>
        <span>证据范围：${escapeHtml(scopeText)}</span>
        <small>${escapeHtml(verification.explanation)} 不代表商品可售，也不代表库存已写入。</small>
      </div>
      <small>商品 ${Number(data.products?.length || 0)} · 仓库 ${Number(data.warehouses?.length || 0)} · 当前库存 ${Number(data.currentStocks?.length || 0)}</small>
      ${operationEvidence.length ? `<small>本次读取：${[...new Set(operationEvidence.map((entry) => stockOperationSellerLabel(entry.operationPath)))].map(escapeHtml).join("、")}</small>` : ""}
      ${paginationSummary}
      ${missingSellerLabels.length ? `<p><b>还缺少：</b>${missingSellerLabels.map(escapeHtml).join("；")}</p>` : ""}
      ${tupleScope}
      ${tupleNeedsRead}
      <p>本次只读，不会写库存、不会创建库存队列。</p>
      <p><b>安全下一步：</b>${escapeHtml(nextAction)}</p>
      <div class="stock-evidence-receipt" data-stock-receipt-eligible="${receiptEligible ? "true" : "false"}">
        <strong>保存本地只读证据回执</strong>
        <label>环境名
          <input type="text" list="stockReceiptEnvironmentOptions" data-stock-receipt-environment placeholder="例如：local-dev-readonly" ${receiptEligible ? "" : "disabled"} />
          <datalist id="stockReceiptEnvironmentOptions"><option value="local-dev-readonly"></option><option value="staging-readonly"></option><option value="production-readonly"></option></datalist>
        </label>
        <label><input type="checkbox" data-stock-receipt-confirm ${receiptEligible ? "" : "disabled"} /> 我确认保存当前环境的一次只读证据回执</label>
         <button type="button" class="ghost" data-save-stock-evidence-receipt data-store-id="${escapeHtml(data.storeId || "")}" data-offer-ids="${escapeHtml((data.offerIds || []).join(","))}" data-warehouse-ids="${escapeHtml((data.warehouseIds || []).join(","))}" disabled>保存本次只读回执</button>
        <small>${receiptEligible ? "只保存脱敏本地回执；服务端会重新执行受限只读聚合。" : "证据 partial、stale、failed 或范围不完整时不能保存回执。"} 不会写库存、不会创建队列。</small>
        <p class="stock-evidence-receipt-response" aria-live="polite"></p>
      </div>
    </div>
  `;
}

function updateStockReceiptControl(container) {
  if (!container) return;
  const environment = container.querySelector("[data-stock-receipt-environment]")?.value.trim() || "";
  const confirmed = container.querySelector("[data-stock-receipt-confirm]")?.checked === true;
  const button = container.querySelector("[data-save-stock-evidence-receipt]");
  if (button) button.disabled = container.dataset.stockReceiptEligible !== "true" || !environment || !confirmed;
}

async function saveStockEvidenceReceipt(button) {
  const container = button.closest(".stock-evidence-receipt");
  const response = container?.querySelector(".stock-evidence-receipt-response");
  const environment = container?.querySelector("[data-stock-receipt-environment]")?.value.trim() || "";
  const offerIds = String(button.dataset.offerIds || "").split(",").filter(Boolean);
  const warehouseIds = String(button.dataset.warehouseIds || "").split(",").map(Number).filter((warehouseId) => Number.isSafeInteger(warehouseId) && warehouseId > 0);
  setBusy(button, true);
  try {
    const data = await api("/api/ozon/stock-reconciliation/evidence-receipts", {
      method: "POST",
      body: JSON.stringify({
        recordEvidence: true,
        environment,
        storeId: button.dataset.storeId,
        offerIds,
        warehouseIds,
      }),
    });
    const summaryQuery = new URLSearchParams({
      environment,
      storeId: String(button.dataset.storeId || ""),
      offerIds: offerIds.join(","),
      warehouseIds: warehouseIds.join(","),
    });
    const summary = await api(`/api/ozon/stock-reconciliation/evidence-receipts?${summaryQuery.toString()}`);
    if (response) response.textContent = `回执已保存并按当前店铺/目标范围回读 · 验证等级 ${escapeHtml(summary.verification?.verificationLevel || data.verification?.verificationLevel || "locally_tested")} · 当前范围回执 ${Number(summary.receiptCount || 0)} 条 · 证据时间 ${escapeHtml(data.receipt?.checkedAt || "未返回")}`;
  } catch {
    if (response) response.textContent = "只读回执保存未完成，请检查环境名和只读连接后重试。";
  } finally {
    setBusy(button, false);
    updateStockReceiptControl(container);
  }
}

function invalidateStockEvidenceOnTargetChange() {
  if (!state.stockEvidence) return;
  state.stockSnapshotProducts = null;
  state.stockWarehouses = null;
  state.stockSnapshot = null;
  state.stockEvidence = { ...state.stockEvidence, stale: true };
  state.stockDryRun = null;
  syncStockActionButtons();
  renderStockEvidence({ ...state.stockEvidence, products: [], warehouses: [], currentStocks: [] });
  const dryRun = $("#stockDryRunResult");
  if (dryRun) dryRun.innerHTML = "<p class=\"hint\">目标库存已修改；旧预演结果和只读证据均不可继续使用，请重新读取证据。</p>";
}

async function readStockReconciliationEvidence() {
  const button = $("#stockEvidenceRead");
  const requestToken = (state.stockEvidenceRequestToken = Number(state.stockEvidenceRequestToken || 0) + 1);
  const requestStoreId = selectedStoreId();
  const environmentCheck = validateReadOperatorEnvironment(currentSellerReadEnvironment());
  if (!environmentCheck.ok) {
    state.stockEvidence = { failed: true, stale: true, partial: true, missingEvidence: [], environment: "" };
    syncStockActionButtons();
    toast(environmentCheck.message, "warning");
    return false;
  }
  const requestEnvironment = environmentCheck.environment;
  setBusy(button, true);
  try {
    const { offerIds, warehouseIds } = stockTargetsFromEditor();
    const storeId = requestStoreId;
    const data = await api("/api/ozon/stock-reconciliation/evidence", {
      method: "POST",
      body: JSON.stringify({ storeId, offerIds, warehouseIds }),
    });
    if (requestToken !== state.stockEvidenceRequestToken || requestStoreId !== selectedStoreId()) return false;
    const responseOfferIds = Array.isArray(data.offerIds) ? data.offerIds.map((value) => String(value)).join("|") : "";
    const responseWarehouseIds = Array.isArray(data.warehouseIds) ? data.warehouseIds.map((value) => String(value)).join("|") : "";
    if (String(data.storeId || "").trim() !== String(requestStoreId || "").trim()
      || String(data.environment || "").trim() !== requestEnvironment
      || responseOfferIds !== offerIds.join("|")
      || responseWarehouseIds !== warehouseIds.join("|")) {
      throw new Error("库存证据回执范围已变化，已丢弃；请重新读取当前店铺和目标 Offer/仓库。");
    }
    state.stockSnapshotProducts = Array.isArray(data.products) ? data.products.map((item) => ({
      offer_id: String(item.offer_id || ""),
      product_id: Number(item.product_id || 0),
      status: String(item.status || "unknown"),
      visible: item.visible === true,
    })) : [];
    state.stockWarehouses = Array.isArray(data.warehouses) ? data.warehouses.map((item) => ({
      warehouse_id: Number(item.warehouse_id || 0),
      status: String(item.status || ""),
      is_rf: item.is_rf === true,
      is_rfbs: item.is_rfbs === true,
      delivery_method_type: String(item.delivery_method_type || ""),
    })) : [];
    const normalizeObservedStock = (value) => {
      if (value === null || value === undefined || value === "") return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    state.stockSnapshot = Array.isArray(data.currentStocks) ? data.currentStocks.map((item) => ({
      offer_id: String(item.offer_id || ""),
      product_id: Number(item.product_id || 0),
      warehouse_id: Number(item.warehouse_id || 0),
      stock: normalizeObservedStock(item.present),
      present: normalizeObservedStock(item.present),
      reserved: normalizeObservedStock(item.reserved),
    })) : [];
    state.stockEvidence = {
      storeId,
      environment: requestEnvironment,
      offerIds,
      warehouseIds,
      checkedAt: String(data.checkedAt || ""),
      partial: data.partial === true || data.completeForRequestedIds !== true,
      completeForRequestedIds: data.completeForRequestedIds === true,
      productStatusReadyForAll: data.productStatusReadyForAll === true,
      missingEvidence: Array.isArray(data.missingEvidence) ? data.missingEvidence.map(String) : [],
      targetTuples: Array.isArray(data.targetTuples) ? data.targetTuples : [],
      unknownTuples: Array.isArray(data.unknownTuples) ? data.unknownTuples : [],
      verificationLevel: String(data.verificationLevel || "locally_tested"),
      liveReadObserved: data.liveReadObserved === true,
    };
    syncStockActionButtons();
    renderStockEvidence({ ...state.stockEvidence, products: state.stockSnapshotProducts, warehouses: state.stockWarehouses, currentStocks: state.stockSnapshot });
    toast(state.stockEvidence.partial || state.stockEvidence.missingEvidence.length ? "库存预演证据不完整，请先处理缺项" : "库存预演证据已读取");
  } catch (error) {
    if (requestToken !== state.stockEvidenceRequestToken || requestStoreId !== selectedStoreId()) return false;
    state.stockSnapshotProducts = null;
    state.stockWarehouses = null;
    state.stockSnapshot = null;
    state.stockDryRun = null;
    state.stockEvidence = { failed: true, stale: true, partial: true, missingEvidence: [] };
    syncStockActionButtons();
    renderStockEvidence({
      failed: true,
      reasonCode: error.reasonCode || "STOCK_EVIDENCE_READ_FAILED",
      nextAction: stockEvidenceSellerError(error.reasonCode),
      storeId: selectedStoreId(),
      offerIds: [],
      checkedAt: new Date().toISOString(),
      verificationLevel: "locally_tested",
    });
    toast(stockEvidenceSellerError(error.reasonCode), "error");
  } finally {
    if (requestToken === state.stockEvidenceRequestToken) setBusy(button, false);
  }
}

async function runStockDryRun() {
  const button = $("#stockDryRun");
  setBusy(button, true);
  try {
    const { rows: targetStocks, offerIds, warehouseIds } = stockTargetsFromEditor();
    const evidence = state.stockEvidence;
    // Do not rely solely on the disabled attribute. Keyboard activation,
    // restored browser state, or a direct event dispatch can still reach this
    // handler. Re-run the exact store/Offer/warehouse/freshness gate before
    // asking the server to calculate a preview.
    if (!stockEvidenceUsableForCurrentTarget()) {
      toast("库存预演证据不完整、已过期或商品尚未明确可售，请先重新读取当前证据。", "error");
      return;
    }
    const evidenceCurrent = evidence
      && evidence.storeId === selectedStoreId()
      && evidence.offerIds.join("|") === offerIds.join("|")
      && evidence.warehouseIds.join("|") === warehouseIds.join("|");
    if (!evidenceCurrent || evidence.stale || evidence.partial || evidence.missingEvidence.length) {
      toast("库存预演证据不完整或已与目标库存不一致，请先重新读取一次预演证据。", "error");
      return;
    }
    const data = await api("/api/ozon/stock-reconciliation/dry-run", {
      method: "POST",
      body: JSON.stringify({
        storeId: selectedStoreId(),
        targetStocks,
        products: state.stockSnapshotProducts,
        warehouses: state.stockWarehouses,
        currentStocks: state.stockSnapshot,
      }),
    });
    renderStockDryRun(data);
    state.stockDryRun = data;
    showResponse(data);
    toast(data.dryRun?.executable ? "库存差异预演完成" : "库存预演发现阻断", data.dryRun?.executable ? "success" : "warning");
  } catch (error) {
    toast(error.reasonCode ? stockEvidenceSellerError(error.reasonCode) : "库存预演未完成，请检查目标库存和只读证据后重试。", "error");
  } finally {
    setBusy(button, false);
  }
}

async function confirmStockWrite() {
  const container = document.querySelector("[data-stock-write-confirmation]");
  const response = container?.querySelector(".stock-write-response");
  if (container?.querySelector("[data-stock-write-confirm]")?.checked !== true) {
    toast("请先确认当前库存差异、仓库和目标库存。", "error");
    return;
  }
  const dryRun = state.stockDryRun?.dryRun || {};
  if (dryRun.executable !== true || !dryRun.idempotencyKey) {
    toast("当前 dry-run 已失效，请重新读取证据并预演。", "error");
    return;
  }
  if (!stockEvidenceUsableForCurrentTarget() || !stockDryRunMatchesCurrentTarget(state.stockDryRun)) {
    state.stockDryRun = null;
    if (container) container.remove();
    syncStockActionButtons();
    toast("目标库存或只读证据已变化，旧 dry-run 不能复用；请重新读取证据并预演。", "error");
    return;
  }
  let targetStocks;
  try {
    targetStocks = stockTargetsFromEditor().rows;
  } catch (error) {
    if (error.reasonCode === "DIRECT_WRITE_UNKNOWN_OUTCOME" || error.commandState === "needs_review") {
      state.promotionMutationEvidence = {
        ...(state.promotionMutationEvidence || {}),
        status: "needs_review",
        writeStatus: "needs_review",
        checkedAt: new Date().toISOString(),
        readback: false,
      };
      renderPromotionDetail();
    }
    toast(error.message, "error");
    return;
  }
  const request = directWriteRequest({
    storeId: selectedStoreId(),
    stocks: targetStocks,
    confirmStockDryRun: true,
  }, "ozon.warehouse-stocks.confirmed");
  const button = container?.querySelector("[data-confirm-stock-write]");
  setBusy(button, true);
  try {
    const data = await api("/api/ozon/warehouse-stocks/confirmed", {
      method: "POST",
      headers: request.headers,
      body: request.body,
    });
    if (response) response.textContent = "Ozon 已返回写入结果，正在执行写后只读回查……";
    state.stockDryRun = null;
    const readbackOk = await readStockReconciliationEvidence();
    if (readbackOk !== true || String(data?.summary?.status || "") !== "reconciled") {
      if (response) response.textContent = "写入响应已返回，但写后精确 tuple 回查未完成；结果保持待复核，不宣称库存已更新。";
      toast("写入结果已返回，但写后库存回查未确认；请保持当前命令待复核，不要重复写入。", "warning");
      return;
    }
    const readbackAt = data?.summary?.readbackCheckedAt ? ` · 回查于 ${escapeHtml(data.summary.readbackCheckedAt)}` : "";
    if (response) response.textContent = `写入请求已完成并已通过精确 tuple 回查 · ${escapeHtml(data?.summary?.status || data?.status || "accepted")}${readbackAt}`;
  } catch (error) {
    if (response) response.textContent = error.message || "库存写入未完成";
    toast(error.message || "库存写入未完成", "error");
  } finally {
    setBusy(button, false);
  }
}

async function loadStockQueue() {
  const button = $("#loadStockQueue");
  setBusy(button, true);
  try {
    const data = await api(`/api/ozon/stock-queue?storeId=${encodeURIComponent(selectedStoreId())}&includeWarehouseRecommendation=1`);
    renderStockQueueWorkbench(data);
    showResponse(data);
    toast("库存队列已读取");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function replayStockQueueFailures() {
  const button = $("#replayStockQueue");
  setBusy(button, true);
  try {
    const data = await api("/api/ozon/stock-queue/replay-failed", {
      method: "POST",
      body: JSON.stringify({ limit: 10, storeId: selectedStoreId() }),
    });
    showResponse(data);
    await loadStockQueue();
    toast(`已回放 ${data.replayed || data.data?.replayed || 0} 个可重试库存失败`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function renderStockQueueWorkbench(data = {}) {
  const container = $("#stockQueueList");
  if (!container) return;
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const error = data.warehouseRecommendationError
    ? `<p class="hint warning">仓库推荐暂不可用：${escapeHtml(data.warehouseRecommendationError)}</p>`
    : "";
  container.innerHTML = error + (jobs.length
    ? jobs.slice(0, 12).map(renderStockQueueJobCard).join("")
    : `<p class="hint">当前没有库存队列任务。</p>`);
}

function renderStockQueueJobCard(job = {}) {
  const recommendation = job.warehouseRecommendation || {};
  const recommended = recommendation.recommended || {};
  const excluded = Array.isArray(recommendation.excluded) ? recommendation.excluded.slice(0, 4) : [];
  const candidates = Array.isArray(recommendation.candidates) ? recommendation.candidates.slice(0, 3) : [];
  const outcomeStatus = String(job.result?.status || job.result?.commandState || job.status || "unknown");
  const statusLabel = stockQueueStatusLabel(outcomeStatus);
  const safeNextAction = recommendation.safeNextAction || (
    ["needs_review", "partial"].includes(outcomeStatus)
      ? "先按相同 Offer/仓库逐项回查当前库存和写入结果；结果未确认前禁止换幂等键重复写入。"
      : outcomeStatus === "blocked"
        ? "补齐商品、仓库和精确库存证据后重新预演；不会创建写入任务。"
        : outcomeStatus === "failed"
          ? "查看失败原因后决定是否回放，不会直接盲写库存。"
          : "等待库存队列按商品就绪状态继续。"
  );
  const tupleRows = (job.stocks || []).slice(0, 20).map((stock) => `
    <li>Offer <code>${escapeHtml(String(stock.offer_id || "-"))}</code> · 仓库 <code>${escapeHtml(String(stock.warehouse_id || "未知"))}</code> · 目标库存 ${escapeHtml(String(stock.stock ?? "未知"))}</li>
  `).join("");
  const attention = ["needs_review", "partial", "blocked", "failed"].includes(outcomeStatus) ? `
    <section class="stock-queue-attention" data-stock-queue-outcome="${escapeHtml(outcomeStatus)}">
      <strong>${outcomeStatus === "needs_review" ? "结果需要人工复核" : outcomeStatus === "partial" ? "库存结果部分完成" : outcomeStatus === "blocked" ? "库存写入前证据被阻断" : "库存任务失败"}</strong>
      <p>阻塞/结果原因：${escapeHtml(job.reasonCode || job.lastError || outcomeStatus)}</p>
      <small>副作用：${outcomeStatus === "failed" || outcomeStatus === "blocked" ? "不会自动重复写入；回放前需重新确认证据。" : "在精确 tuple 回查完成前，不得换幂等键重复写入。"}</small>
    </section>
  ` : "";
  return `
    <article class="stock-queue-job ${escapeHtml(job.status || "unknown")}">
      <header>
        <div>
          <span>${escapeHtml(statusLabel)}</span>
          <strong>Task ${escapeHtml(String(job.taskId || "-"))}</strong>
        </div>
        <code>${escapeHtml(job.id || "")}</code>
      </header>
      <div class="stock-queue-meta">
        <span>SKU ${escapeHtml(String((job.stocks || []).length || 0))}</span>
        <span>尝试 ${escapeHtml(String(job.attempts || 0))}/${escapeHtml(String(job.maxAttempts || 10))}</span>
        <span>阻塞原因：${escapeHtml(job.reasonCode || "等待执行")}</span>
      </div>
      ${tupleRows ? `<section class="stock-queue-tuples"><strong>精确目标 tuple</strong><ul>${tupleRows}</ul></section>` : ""}
      ${job.lastError ? `<p class="stock-queue-error">最后失败：${escapeHtml(job.lastError)}</p>` : ""}
      ${attention}
      <section class="stock-warehouse-recommendation">
        <div>
          <span>推荐仓库</span>
          <strong>${recommended.warehouse_id ? `${escapeHtml(recommended.name || recommended.warehouse_name || "未命名仓库")} · ${escapeHtml(String(recommended.warehouse_id))}` : "需要人工确认仓库"}</strong>
          <p>${escapeHtml(recommendation.recommendedReason || "没有可自动确认的可用仓库。")}</p>
        </div>
        <em>${escapeHtml(safeNextAction)}</em>
      </section>
      ${candidates.length ? `
        <div class="stock-queue-chips">
          ${candidates.map((item) => `<span>候选 ${escapeHtml(item.name || "-")} · ${escapeHtml(String(item.score || 0))}</span>`).join("")}
        </div>
      ` : ""}
      ${excluded.length ? `
        <details class="stock-queue-excluded">
          <summary>排除原因 ${excluded.length}</summary>
          ${excluded.map((item) => `<p>${escapeHtml(item.name || String(item.warehouse_id || "-"))}：${escapeHtml(item.reason || "-")}</p>`).join("")}
        </details>
      ` : ""}
    </article>
  `;
}

function stockQueueStatusLabel(status = "") {
  const map = {
    pending: "排队",
    checking_task: "检查商品",
    waiting_product: "等待商品就绪",
    retry_stock: "等待重试",
    success: "成功",
    failed: "失败",
    blocked: "证据阻断",
    partial: "部分完成，需回查",
    needs_review: "需要人工复核",
    unknown: "结果未知",
  };
  return map[status] || status || "未知";
}

async function submitJsonTextarea(button, textarea, path, payloadKey) {
  const label = payloadKey === "prices" ? "价格" : "库存";
  if (!window.confirm(`确认将当前 ${label} JSON 写入 Ozon 吗？提交后仍需读取结果进行对账。`)) return;
  setBusy(button, true);
  try {
    const items = JSON.parse(textarea.value);
    const data = await api(path, {
      method: "POST",
      ...directWriteRequest({
        storeId: selectedStoreId(),
        [payloadKey]: items,
      }, `direct-${payloadKey}`),
    });
    showResponse(data);
    toast("提交成功");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const viewMap = {
        ozonLearning: "research",
        collector1688: "sourcing",
        crawler1688: "sourcing",
        warehouses: "warehouse",
        stock: "warehouse",
        prices: "listing",
        pipeline: "research",
      };
      const actualView = viewMap[tab.dataset.view] || tab.dataset.view;
      if (!activateErpView(actualView, tab)) return;
      toggleMobileNavigation(false);
      obsTrack("page_view", { view: actualView });
      obsSetContext({ activeView: actualView });
      if (actualView === "products" && state.productRows.length === 0) {
        loadProducts();
      }
      if (actualView === "orders" && state.orderRows.length === 0) {
        loadOrders();
      }
      if (actualView === "promotions" && state.promotionRows.length === 0) {
        loadPromotions();
      }
      if (actualView === "sourcing" && state.crawlerTasks.length === 0) {
        Promise.all([loadCrawlerWorkerStatus(), loadCrawlerTasks().then(loadCrawlerCandidates)]).catch((error) => toast(error.message, "error"));
      }
      if (actualView === "research" && state.ozonLearningTasks.length === 0) {
        Promise.all([loadOzonLearningTasks().then(loadOzonLearningItems), loadOzonOpportunities(), loadOzonImageStyleObservations(), loadOzonImageStyleAnalysis()]).catch((error) => toast(error.message, "error"));
      }
      if (actualView === "workflow-console" && state.workflowRuns.length === 0) {
        loadWorkflowRuns();
      }
      if (actualView === "system") {
        if (!state.readOperatorReceiptSummary) loadReadOperatorReceipts();
        if (!state.runtimeSafetySnapshot) loadRuntimeSafetySummary();
        if (!state.migrationStateAudit) loadMigrationStateAudit();
        if (!state.sessionProofSummary) loadSessionProofSummary();
      }
    });
  });
}

function renderViewOwnershipBars() {
  Object.entries(ERP_VIEW_OWNERSHIP_CONTRACTS).forEach(([viewId, contract]) => {
    const view = document.getElementById(viewId);
    if (!view || view.querySelector(".view-ownership-bar")) return;
    const bar = document.createElement("section");
    bar.className = "view-ownership-bar";
    bar.innerHTML = `
      <div>
        <span>当前功能区</span>
        <strong>${escapeHtml(contract.title)}</strong>
      </div>
      <p><b>本页处理：</b>${escapeHtml(contract.handles)}</p>
      <p><b>本页不处理：</b>${escapeHtml(contract.excludes)}</p>
      <em class="view-ownership-warning">错页提示：${escapeHtml(contract.wrongPageHint)}</em>
    `;
    const header = Array.from(view.children).find((child) => child.matches("header.page-head"));
    const dashboardGrid = viewId === "dashboard" ? view.querySelector(".erp-dashboard-grid") : null;
    if (dashboardGrid) {
      dashboardGrid.insertAdjacentElement("afterend", bar);
    } else if (header) {
      header.insertAdjacentElement("afterend", bar);
    } else {
      view.prepend(bar);
    }
  });
}

function renderTabTaskCards() {
  Object.entries(ERP_TAB_TASK_CARDS).forEach(([viewId, card]) => {
    const view = document.getElementById(viewId);
    if (!view || view.querySelector(".tab-task-card")) return;
    const section = document.createElement("section");
    section.className = "tab-task-card";
    section.dataset.taskCardView = viewId;
    section.innerHTML = `
      <div>
        <span>这个页面先做什么</span>
        <h2>${escapeHtml(card.title)}</h2>
        <p>${escapeHtml(card.primary)}</p>
      </div>
      <nav aria-label="${escapeHtml(card.title)}快捷动作">
        ${card.actions.map((action) => `<button type="button" data-task-card-view="${escapeHtml(action.view)}">${escapeHtml(action.label)}</button>`).join("")}
      </nav>
    `;
    const ownership = view.querySelector(".view-ownership-bar");
    const dashboardGrid = viewId === "dashboard" ? view.querySelector(".erp-dashboard-grid") : null;
    const header = Array.from(view.children).find((child) => child.matches("header.page-head"));
    if (ownership) {
      ownership.insertAdjacentElement("afterend", section);
    } else if (dashboardGrid) {
      dashboardGrid.insertAdjacentElement("afterend", section);
    } else if (header) {
      header.insertAdjacentElement("afterend", section);
    } else {
      view.prepend(section);
    }
  });
}

function applyProgressiveDisclosure() {
  document.querySelectorAll(".view").forEach((view) => {
    if (view.dataset.progressiveDisclosureReady === "1") return;
    const visibleBase = new Set(["page-head", "view-ownership-bar", "tab-task-card", "tab-primary-panel", "business-primary-panel"]);
    const isBusinessPrimaryPanel = (element) =>
      BUSINESS_PRIMARY_PANEL_CLASSES.some((className) => element.classList.contains(className));
    const contentSections = Array.from(view.children).filter((child) => {
      if (!(child instanceof HTMLElement)) return false;
      if (child.matches("header.page-head")) return false;
      return !Array.from(visibleBase).some((className) => child.classList.contains(className));
    });
    if (contentSections.length <= 3) {
      view.dataset.progressiveDisclosureReady = "1";
      return;
    }
    contentSections.slice(2).forEach((section) => {
      if (isBusinessPrimaryPanel(section)) return;
      section.classList.add("tab-secondary-panel", "tab-secondary-collapsed");
    });
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab-disclosure-toggle";
    button.textContent = "展开本页高级内容";
    button.addEventListener("click", () => {
      const collapsed = view.classList.toggle("show-tab-secondary");
      view.querySelectorAll(".tab-secondary-panel").forEach((section) => {
        section.classList.toggle("tab-secondary-collapsed", !collapsed);
      });
      button.textContent = collapsed ? "收起高级内容" : "展开本页高级内容";
    });
    const firstCollapsedSection = view.querySelector(".tab-secondary-panel.tab-secondary-collapsed");
    const taskCard = view.querySelector(".tab-task-card");
    if (firstCollapsedSection) {
      firstCollapsedSection.insertAdjacentElement("beforebegin", button);
    } else if (taskCard) {
      taskCard.insertAdjacentElement("afterend", button);
    }
    view.dataset.progressiveDisclosureReady = "1";
  });
}

function syncNavigationForView(view, activeTab = null) {
  const group = ERP_NAVIGATION_GROUPS.find((item) => item.views.includes(view));
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab === activeTab || (!activeTab && tab.dataset.view === view));
  });
  document.querySelectorAll("[data-nav-group-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.navGroupPanel === group?.key);
  });
  document.querySelectorAll("[data-nav-group]").forEach((button) => {
    button.classList.toggle("active", button.dataset.navGroup === group?.key);
  });
}

function activateErpView(view, sourceTab = null) {
  const tab = sourceTab || document.querySelector(`.tab[data-view="${view}"]`);
  const targetView = document.querySelector(`#${view}`);
  if (!tab || !targetView) return false;
  document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
  syncNavigationForView(view, tab);
  targetView.classList.add("active");
  document.body.dataset.activeView = view;
  if (!["dashboard", "sourcing", "listing", "products", "orders"].includes(view)) {
    toggleSecondaryNavigation(true);
  }
  return true;
}

function toggleMobileNavigation(force) {
  const shouldOpen = typeof force === "boolean" ? force : !document.body.classList.contains("mobile-nav-open");
  document.body.classList.toggle("mobile-nav-open", shouldOpen);
  const toggle = document.querySelector("#mobileNavToggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(shouldOpen));
    toggle.setAttribute("aria-label", shouldOpen ? "关闭导航" : "打开导航");
  }
  return shouldOpen;
}

function toggleSecondaryNavigation(force) {
  const nav = $("#sellerSecondaryNav");
  const button = $("#secondaryNavToggle");
  if (!nav || !button) return false;
  const shouldOpen = typeof force === "boolean" ? force : !nav.classList.contains("is-open");
  nav.classList.toggle("is-open", shouldOpen);
  button.setAttribute("aria-expanded", String(shouldOpen));
  button.classList.toggle("is-open", shouldOpen);
  return shouldOpen;
}

function bindApplicationNavigation() {
  document.querySelectorAll("[data-nav-group]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.view) {
        activateErpView(button.dataset.view);
        return;
      }
      const groupKey = button.dataset.navGroup;
      const panel = document.querySelector(`[data-nav-group-panel="${groupKey}"]`);
      if (!panel) return;
      const activeTab = panel.querySelector(".tab");
      if (activeTab) activeTab.click();
    });
  });
  on("#mobileNavToggle", "click", () => toggleMobileNavigation());
  on("#secondaryNavToggle", "click", () => toggleSecondaryNavigation());
  on("#sidebarBackdrop", "click", () => toggleMobileNavigation(false));
  $("#globalCurrentTaskBar")?.addEventListener("click", (event) => {
    const captureButton = event.target.closest("[data-global-capture-id]");
    if (captureButton) {
      openCurrentCaptureTask(captureButton.dataset.globalCaptureId, captureButton.dataset.globalCaptureStoreId)
        .catch((error) => toast(error.message || "打开当前商品失败", "error"));
      return;
    }
    const viewButton = event.target.closest("[data-cockpit-view]");
    if (viewButton) activateErpView(viewButton.dataset.cockpitView);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") toggleMobileNavigation(false);
  });
}

function promoteOzonImageStyleSection() {
  const button = $("#ozonImageStyleAnalyze");
  const section = button?.closest(".erp-section");
  const advanced = section?.closest(".erp-advanced-toggle");
  const panel = advanced?.closest(".erp-panel");
  if (!section || !advanced || !panel) return false;
  panel.insertBefore(section, advanced);
  return true;
}

function initDefaultDates() {
  const to = new Date();
  const since = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
  const format = (date) => date.toISOString().slice(0, 16);
  $("#orderSince").value = format(since);
  $("#orderTo").value = format(to);
}


async function reverseSearch1688(itemId, button) {
  const statusEl = document.getElementById("reverseStatus-" + itemId);
  if (!statusEl) return;
  setBusy(button, true);
  statusEl.textContent = "正在翻译并查找 1688 货源...";
  try {
    const data = await api("/api/ozon-learning/reverse-1688", { method: "POST", body: JSON.stringify({ itemId }) });
    if (!data.ok) {
      statusEl.textContent = data.reason || "查找失败";
      toast(data.reason || "反查 1688 失败", "error");
      return;
    }
    statusEl.textContent = "已创建 1688 任务：" + (data.keyword || "");
    toast("已创建 1688 采集任务：" + (data.keyword || "") + "，插件将自动执行");
    const crawlerTab = document.querySelector('.tab[data-view="sourcing"]');
    if (crawlerTab) crawlerTab.click();
  } catch (error) {
    statusEl.textContent = "请求失败";
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}


async function expandKeywords(seeds, andRun) {
  const btn = andRun ? $("#crawlerExpandAndRunBtn") : $("#crawlerExpandBtn");
  const resultDiv = $("#crawlerExpandResult");
  const resultInner = resultDiv?.querySelector("div");
  if (!resultInner) return;
  setBusy(btn, true);
  resultDiv.style.display = "block";
  resultInner.innerHTML = "<span class=\"hint\">AI 正在生成扩展词...</span>";
  try {
    const maxProducts = Number($("#crawlerExpandMaxProducts")?.value || 20);
    const maxPages = Number($("#crawlerExpandMaxPages")?.value || 2);
    if (andRun) {
      const data = await api("/api/1688-crawler/create-expanded-tasks", {
        method: "POST",
        body: JSON.stringify({ seeds: seeds.join(","), options: { maxProducts, maxPages } }),
      });
      if (!data.ok) { toast(data.reason || "拓词失败", "error"); resultInner.innerHTML = "<span class=\"hint\">" + (data.reason || "失败") + "</span>"; return; }
      resultInner.innerHTML = "<span class=\"hint\">已生成 " + (data.count || 0) + " 个任务</span>"
        + (data.expanded || []).map((w) => "<span class=\"opportunity-chip\">" + escapeHtml(w) + "</span>").join("");
      toast("已创建 " + (data.count || 0) + " 个拓词任务，插件将自动执行");
      await loadCrawlerTasks();
    } else {
      const data = await api("/api/1688-crawler/expand-keywords", {
        method: "POST",
        body: JSON.stringify({ seeds: seeds.join(",") }),
      });
      if (!data.ok) { toast(data.reason || "拓词失败", "error"); resultInner.innerHTML = "<span class=\"hint\">" + (data.reason || "失败") + "</span>"; return; }
      resultInner.innerHTML = (data.expanded || []).map((w) => "<span class=\"opportunity-chip\">" + escapeHtml(w) + "</span>").join("");
      toast("已生成 " + (data.count || 0) + " 个扩展词");
    }
  } catch (error) {
    resultInner.innerHTML = "<span class=\"hint\">请求失败</span>";
    toast(error.message, "error");
  } finally {
    setBusy(btn, false);
  }
}


async function loadAutoListJobs() {
  var data = await api("/api/ozon-learning/auto-list-jobs");
  state.autoListJobs = data.items || [];
  renderAutoListJobRows();
  renderListingSellerTaskSummary();
  await loadAutoFlowStatus();
}

async function loadAutoFlowStatus() {
  const el = $("#autoFlowStatusSummary");
  if (!el) return;
  try {
    const data = await api("/api/flow/status");
    const top = (data.topFailureReasons || []).map((x) => x.reasonCode + ":" + x.count).join(", ") || "-";
    const timeoutTop = (data.timeoutStageTop || []).map((x) => x.stage + ":" + x.count).join(", ") || "-";
    const stalledText = data.stalled ? "是" : "否";
    const automationSafetyText = data.automation?.mode === "observe_only"
      ? "观察模式（不会自动推进）"
      : "自动推进已开启";
    el.textContent =
      "自动化 " + automationSafetyText
      + " | 运行中 " + (data.runningJobCount || 0)
      + " | 待上架 " + (data.readyForListingCount || 0)
      + " | 待复核 " + (data.needsReviewCount || 0)
      + " | 机会池 " + (data.opportunityCount || 0)
      + " | 停滞 " + stalledText
      + " | 库存队列 P/S/F: "
      + (data.stockQueue?.pending || 0) + "/"
      + (data.stockQueue?.success || 0) + "/"
      + (data.stockQueue?.failed || 0)
      + " | 失败Top: " + top
      + " | 超时阶段Top: " + timeoutTop;
  } catch (e) {
    el.textContent = "状态读取失败: " + e.message;
  }
}

async function runAutoFlowAutoFix() {
  const btn = $("#autoFlowAutoFix");
  if (!btn) return;
  setBusy(btn, true);
  try {
    const data = await api("/api/ozon-learning/flow-autofix", {
      method: "POST",
      body: JSON.stringify({
        allowAutomation: false,
        reconcileLimit: 20,
        blindBatchSize: 2,
        autoListOpportunityBatch: 2,
        maxProducts: 12,
        detailSampleSize: 3,
        retryMatchLimit: 2,
        autoResubmit: true,
        remediateLimit: 3,
        stockDrivenRemediateLimit: 3,
        stockLearningLimit: 20,
        stockReplayLimit: 5,
        retryTimeoutLimit: 2,
        retryTimeoutBatch: 2,
        retryTimeoutCooldownMs: 8 * 60 * 1000,
        diversifiedSeedCount: 3,
        timeoutRetryStages: "translating,searching_1688,waiting_crawl,matching,generating_content",
        stageRetryPolicy: "translating:3:180,searching_1688:3:300,waiting_crawl:4:480,matching:3:480,generating_content:2:600,listing:1:1200,unknown:2:600",
      }),
    });
    const acts = (data.actions || []).map((a) => a.action).join(", ");
    const routed = (data.actions || [])
      .filter((a) => String(a.action || "").startsWith("route_"))
      .map((a) => a.action)
      .join(", ");
    const routeTemplateCount = (data.actions || []).filter((a) => a.fixTemplate).length;
    const d = data.delta || {};
    const deltaText = "Δ运行中:" + (d.runningJobCount || 0) + " Δ待上架:" + (d.readyForListingCount || 0) + " Δ机会池:" + (d.opportunityCount || 0);
    toast("自愈执行完成: " + (acts || "无动作") + (routed ? " | 分流: " + routed : "") + (routeTemplateCount ? " | 模板:" + routeTemplateCount : "") + " | " + deltaText);
  } catch (e) {
    toast("自愈失败: " + e.message, "error");
  } finally {
    setBusy(btn, false);
    await loadAutoListJobs();
  }
}

async function refreshCoreChainStatus() {
  const el = $("#cockpitSummary");
  const nextEl = $("#cockpitNextAction");
  if (!el) return;
  try {
    const [flow, pipe] = await Promise.all([
      api("/api/flow/status"),
      api("/api/pipeline/status"),
    ]);
    const timeoutTop = (flow.timeoutStageTop || []).map((x) => x.stage + ":" + x.count).join(", ") || "-";
    el.textContent =
      "流水线: " + (pipe.status || "idle")
      + " | 运行中: " + (flow.runningJobCount || 0)
      + " | 待上架: " + (flow.readyForListingCount || 0)
      + " | 停滞: " + (flow.stalled ? "是" : "否")
      + " | 超时阶段: " + timeoutTop;
    if (nextEl) {
      let next = "保持监控";
      if ((flow.stockQueue?.failed || 0) > 0) {
        const stockTop = (flow.stockQueue?.topFailureReasons || []).map((x) => x.reasonCode + ":" + x.count).join(", ") || "UNKNOWN";
        next = "优先处理库存失败队列（" + stockTop + "）";
      } else if ((flow.readyForListingCount || 0) > 0) {
        next = "优先提交待上架商品并回查 task 状态";
      } else if (flow.stalled) {
        next = "当前停滞，点击「停滞自愈」拉起新任务";
      } else if ((flow.runningJobCount || 0) > 0) {
        next = "有任务运行中，等待回流并检查失败Top";
      } else if ((pipe.status || "") === "idle") {
        next = "可启动自动流水线推进全链路";
      }
      nextEl.textContent = "下一步: " + next;
    }
  } catch (e) {
    el.textContent = "主链状态读取失败: " + e.message;
    if (nextEl) nextEl.textContent = "下一步: 先刷新主链状态";
  }
}

async function runCockpitAction(kind) {
  if (kind === "reverse") {
    await runReverseWorkflow();
  } else if (kind === "pipeline") {
    await runPipeline();
  } else if (kind === "autofix") {
    await runAutoFlowAutoFix();
  } else if (kind === "runall") {
    const summary = $("#cockpitSummary");
    if (summary) summary.textContent = "执行中: 正在拉起盲搜任务...";
    await createOzonBlindRun();
    if (summary) summary.textContent = "执行中: 正在推进自动流水线...";
    await runPipeline();
    if (summary) summary.textContent = "执行中: 正在执行停滞自愈...";
    await runAutoFlowAutoFix();
    toast("一键推进完成：盲搜 + 流水线 + 自愈");
  } else {
    await Promise.all([
      loadPipelineStatus(),
      loadAutoListJobs(),
      loadOzonLearningTasks(),
      loadOzonOpportunities(),
      loadCrawlerTasks(),
      loadCrawlerCandidates(),
    ]);
  }
  await refreshCoreChainStatus();
}


async function autoListCompleteListing(jobId) {
  var storeId = selectedStoreId || ($("#storeSelect")?.value || "");
  if (!storeId) { toast("请先选择店铺", "error"); return; }
  const job = (state.autoListJobs || []).find((item) => String(item.id || "") === String(jobId || ""));
  const workflowRunId = String(job?.workflowRunId || job?.workflow?.id || "").trim();
  if (workflowRunId) {
    state.selectedWorkflowRunId = workflowRunId;
    state.selectedWorkflowNodeKey = "preflight_check";
    activateErpView("listing");
    await loadWorkflowRuns();
    toast("已打开当前商品统一提交入口；请先完成预检、草稿 hash 确认和人工提交", "warning");
  } else {
    toast("旧自动上架入口已停用；请先为该商品生成工作流，再从上架草稿提交", "warning");
  }
}

function renderAutoListJobRows() {
  var tbody = document.getElementById("autoListJobRows");
  if (!tbody) return;
  var jobs = state.autoListJobs || [];
  tbody.innerHTML = jobs.length
    ? jobs.map(function(job) {
        var statusLabels = {
          translating: "翻译中",
          searching_1688: "搜索1688",
          waiting_crawl: "等待采集",
          matching: "匹配中",
          generating_content: "生成内容",
          ready_for_listing: "就绪上架",
          submitted: "已提交待审",
          live: "在售",
          failed: "失败",
        };
        var steps = (job.steps || []).slice(-3).map(function(s) { return s.detail; }).join(" | ");
        var matchInfo = job.bestMatch
          ? (job.bestMatch.candidateTitle || "").slice(0, 30) + "..."
          : "-";
        var margin = job.bestMatch ? job.bestMatch.margin + "%" : "-";
        var listBtn = job.status === "ready_for_listing"
          ? "<button class=\'small-blue\' onclick=\'autoListCompleteListing(\"" + job.id + "\")\' style=\'margin-left:4px;background:#27ae60\'>上架Ozon</button>"
          : "";
        return "<tr>" +
          "<td><strong>" + escapeHtml((job.ozonTitle || "").slice(0, 40)) + "</strong></td>" +
          "<td class='product-status'>" + (statusLabels[job.status] || job.status) + "</td>" +
          "<td>" + escapeHtml(job.keyword || "-") + "</td>" +
          "<td><small>" + escapeHtml(matchInfo) + "</small></td>" +
          "<td><strong>" + margin + "</strong></td>" +
          "<td><small>" + escapeHtml(steps) + "</small></td>" +
          "<td>" + escapeHtml(formatDateTime(job.updatedAt)) + "<br/>" + listBtn + "</td>" +
          "</tr>";
      }).join("")
    : "<tr><td colspan='7' class='product-empty'>暂无自动铺货记录</td></tr>";
}

function renderReverseGuidanceRows() {
  const tbody = $("#reverseGuidanceRows");
  if (!tbody) return;
  const cards = state.reverseGuidanceCards || [];
  tbody.innerHTML = cards.length
    ? cards.map((card) => {
        const oz = card.ozon || {};
        const c = card.candidate1688 || {};
        const g = card.guidance || {};
        return "<tr>"
          + "<td>" + escapeHtml(String(card.rank || "-")) + "</td>"
          + "<td><strong>" + escapeHtml((oz.title || "").slice(0, 60)) + "</strong>"
          + "<div class='status-sub'>类目: " + escapeHtml(oz.category || "-") + "</div>"
          + "<div class='status-sub'>价格/评分: " + escapeHtml(String(oz.price || "-")) + " / " + escapeHtml(String(oz.rating || "-")) + "</div>"
          + "<div class='status-sub'><a href='" + escapeHtml(oz.url || "#") + "' target='_blank'>Ozon链接</a></div></td>"
          + "<td><strong>" + escapeHtml((c.title || "").slice(0, 60)) + "</strong>"
          + "<div class='status-sub'>价格: " + escapeHtml(String(c.priceMin || "-")) + " ~ " + escapeHtml(String(c.priceMax || "-")) + "</div>"
          + "<div class='status-sub'>SKU数: " + escapeHtml(String(c.skuCount || 0)) + "</div>"
          + "<div class='status-sub'><a href='" + escapeHtml(c.url || "#") + "' target='_blank'>1688链接</a></div></td>"
          + "<td><div>品牌: " + escapeHtml(g.brand || "无品牌") + "</div>"
          + "<div>原产国: " + escapeHtml(g.country || "中国") + "</div>"
          + "<div>型号: " + escapeHtml(g.modelName || "-") + "</div>"
          + "<div>关键词: " + escapeHtml((g.titleKeywords || []).join(", ") || "-") + "</div>"
          + "<div class='status-sub'>" + escapeHtml(g.listingHint || "-") + "</div>"
          + "<button class='small-blue reverse-to-draft' data-candidate-id='" + escapeHtml(card.candidateId || "") + "' data-opportunity-id='" + escapeHtml(card.opportunityId || "") + "' style='margin-top:6px'>转上架草稿</button>"
          + "<button class='primary reverse-to-submit' data-candidate-id='" + escapeHtml(card.candidateId || "") + "' data-opportunity-id='" + escapeHtml(card.opportunityId || "") + "' style='margin-top:6px'>一键提交</button>"
          + "</td>"
          + "</tr>";
      }).join("")
    : "<tr><td colspan='4' class='product-empty'>暂无指导卡</td></tr>";
}

async function reverseCardToDraft(candidateId, opportunityId) {
  if (!candidateId) { toast("缺少候选ID", "error"); return; }
  const storeId = $("#captureStoreSelect")?.value || selectedStoreId();
  const data = await moveCrawlerCandidateToCapture(candidateId, storeId);
  const captureId = data?.capture?.id || data?.captureId || data?.candidate?.captureId || "";
  if (!captureId) {
    toast("入采集箱成功，但未拿到采集ID，请手动生成草稿", "error");
    return;
  }
  await editCaptureItem(captureId, storeId, { preserveText: false });
  if (opportunityId) {
    const card = (state.reverseGuidanceCards || []).find((x) => String(x.opportunityId) === String(opportunityId));
    const g = card?.guidance || {};
    if ($("#listingBrand") && g.brand) $("#listingBrand").value = g.brand;
    if ($("#listingCountry") && g.country) $("#listingCountry").value = g.country;
    if ($("#listingModelName") && g.modelName) $("#listingModelName").value = g.modelName;
  }
  toast("已转为上架草稿，可直接检查后提交");
}

async function reverseCardToSubmit(candidateId, opportunityId) {
  await reverseCardToDraft(candidateId, opportunityId);
  if (document.querySelector(".view.active")?.id !== "listing") {
    document.querySelector('.tab[data-view="listing"]')?.click();
  }
  await submitListing();
  const taskId = $("#listingTaskId")?.value || "";
  if (taskId) {
    toast("已提交上架，Task ID: " + taskId);
  } else {
    toast("已触发提交，请在上架页确认返回", "error");
  }
}

async function runReverseWorkflow() {
  const btn = $("#runReverseWorkflow");
  if (!btn) return;
  const seeds = ($("#reverseSeeds")?.value || "").trim();
  const minScore = Number($("#reverseMinScore")?.value || 60);
  const maxProducts = Number($("#reverseMaxProducts")?.value || 20);
  const maxCards = Number($("#reverseMaxCards")?.value || 20);
  if (!seeds) { toast("请先输入盲采种子词", "error"); return; }
  setBusy(btn, true);
  $("#reverseWorkflowSummary").textContent = "执行中：创建1688任务并反查Ozon同类...";
  try {
    const data = await api("/api/workflow/reverse-run", {
      method: "POST",
      body: JSON.stringify({ seeds, minScore, maxProducts, maxCards }),
    });
    state.reverseGuidanceCards = data.cards || [];
    renderReverseGuidanceRows();
    if (data.status === "pending_candidates") {
      $("#reverseWorkflowSummary").textContent = "已创建任务，等待候选回流。任务数: " + (data.createdTasks?.length || 0);
      toast("反向链路已触发，等待1688候选回流");
    } else {
      $("#reverseWorkflowSummary").textContent = "已生成指导卡 " + (data.matched || state.reverseGuidanceCards.length) + " 条；机会品 " + (data.opportunities || 0) + "；候选 " + (data.candidates || 0);
      toast("反向链路执行完成");
    }
  } catch (error) {
    toast(error.message, "error");
    $("#reverseWorkflowSummary").textContent = "执行失败：" + error.message;
  } finally {
    setBusy(btn, false);
  }
}


// Analyze Ozon opportunities and suggest 1688 sourcing strategy
async function analyzeOzonOpportunities() {
  const btn = $("#analyzeOpportunitiesBtn");
  const result = $("#analyzeResult");
  if (!btn || !result) return;
  setBusy(btn, true);
  result.textContent = "正在分析Ozon数据...";
  try {
    const data = await api("/api/ozon-learning/analyze-opportunities", {
      method: "POST",
      body: JSON.stringify({ minScore: Number($("#ozonOpportunityMinScore")?.value || 30) }),
    });
    if (data.hasData) {
      const totalOpps = data.totalOpportunities;
      const cats = data.rules.map(function(r) { return r.category + "(" + r.itemCount + "件, ¥" + r.suggestedPriceMinCny + "-" + r.suggestedPriceMaxCny + ")"; }).join("; ");
      result.innerHTML = "<b>" + totalOpps + "</b>个机会, " + data.totalCategories + "个品类: " + cats + ". 建议1688搜索: " + (data.strategy.searchSeeds || []).slice(0, 5).join(", ");
      toast("Ozon分析完成，建议搜索: " + (data.strategy.searchSeeds || []).slice(0, 3).join(", "));

      // Auto-fill expandKeywords seeds
      const seedsInput = $("#crawlerExpandSeeds");
      if (seedsInput && data.strategy.searchSeeds) {
        seedsInput.value = data.strategy.searchSeeds.slice(0, 5).join(",");
      }
    } else {
      result.textContent = data.reason || "暂无足够数据";
    }
  } catch (error) {
    result.textContent = "分析失败";
    toast(error.message, "error");
  } finally {
    setBusy(btn, false);
  }
}


async function analyzeListingRules() {
  const btn = $("#analyzeRulesBtn");
  const result = $("#rulesResult");
  if (!btn || !result) return;
  setBusy(btn, true);
  result.textContent = "正在分析Ozon商品数据...";
  try {
    const data = await api("/api/ozon-learning/analyze-rules", { method: "POST" });
    if (data.ok) {
      result.innerHTML = "<b>" + data.itemsAnalyzed + "</b>个商品, <b>" + data.categoriesBuilt + "</b>个品类规则已构建";
      toast("上架规则构建完成: " + data.itemsAnalyzed + "商品, " + data.categoriesBuilt + "品类");
    } else {
      result.textContent = data.reason || "分析失败";
    }
  } catch (error) {
    result.textContent = "分析失败";
    toast(error.message, "error");
  } finally {
    setBusy(btn, false);
  }
}

async function parseOzonSearchHtml() {
  const keyword = $("#ozonManualKeyword")?.value.trim();
  const html = $("#ozonManualHtml")?.value.trim();
  const result = $("#ozonManualResult");
  if (!keyword) { toast("请输入搜索关键词", "error"); return; }
  if (!html) { toast("请粘贴 Ozon 页面 HTML", "error"); return; }
  if (html.length < 500) { toast("HTML 内容太短，请粘贴完整的页面源代码", "error"); return; }
  setBusyText("正在解析 Ozon 页面...");
  try {
    const data = await api("/api/ozon-learning/parse-search-html", {
      method: "POST",
      body: JSON.stringify({ keyword: keyword, html: html, maxProducts: 24, detailSampleSize: 5 }),
    });
    if (data.ok) {
      result.textContent = "成功解析 " + data.itemsCount + " 个商品";
      toast("已添加 " + data.itemsCount + " 个 Ozon 商品到学习库");
      if (data.taskId) state.selectedOzonLearningTaskId = data.taskId;
      await loadOzonLearningTasks();
      await loadOzonLearningItems();
      await loadOzonOpportunities();
    } else {
      result.textContent = data.error || "解析失败";
    }
  } catch (error) {
    result.textContent = "解析失败";
    toast(error.message, "error");
  } finally {
    setBusyText(false);
  }
}
async function init() {
  bindTabs();
  bindApplicationNavigation();
  promoteOzonImageStyleSection();
  initDefaultDates();
  renderViewOwnershipBars();
  renderTabTaskCards();
  applyProgressiveDisclosure();
  renderErpWorkflowNavigator();
  await loadStores();
  await loadWorkflowRuns();
  await loadWriteCommandAttention();
  await loadRuleApprovalAuditIntents();
  await loadRulePublishReviewIntents();
  on("#storeSelect", "change", () => {
    // Category/type/attribute evidence is store-scoped just like stock and
    // order evidence. Do not leave the previous store's green badge visible
    // after a seller switches context.
    state.categoryEvidence = { tree: null, attributes: null };
    state.attributeValueCache = {};
    state.fbsReceiptRequestToken = Number(state.fbsReceiptRequestToken || 0) + 1;
    state.orderRequestToken = Number(state.orderRequestToken || 0) + 1;
    state.orderDetailRequestToken = Number(state.orderDetailRequestToken || 0) + 1;
    state.orderBatch = { loaded: false, loading: false, failed: false, partial: false, hasNext: false, syncedAt: "", sourceCount: 0, scope: { storeId: selectedStoreId() } };
    state.orderRows = [];
    state.orderCoverage = { pageOffsets: [], pageCursors: [], orderKeys: [], observedCount: 0, hasNext: false };
    state.orderCursor = "";
    state.orderCursorHistory = [];
    state.financeReadModel = null;
    // Activity rows and price-impact previews are store-scoped too. Clear
    // them even when the dashboard (rather than the promotions tab) is open,
    // otherwise the old store's activity count can remain in the finance and
    // cockpit summaries after a store switch.
    state.promotionRequestToken = Number(state.promotionRequestToken || 0) + 1;
    state.promotionDetailRequestToken = Number(state.promotionDetailRequestToken || 0) + 1;
    state.promotionRows = [];
    state.promotionSellerResult = null;
    state.promotionEvidence = null;
    state.promotionImpactPreview = null;
    state.promotionDetailSellerResult = { products: null, candidates: null };
    state.promotionProducts = [];
    state.promotionCandidates = [];
    state.promotionSelectedProductIds = [];
    state.selectedPromotion = null;
    state.stockReadRequestToken = Number(state.stockReadRequestToken || 0) + 1;
    state.warehouseRequestToken = Number(state.warehouseRequestToken || 0) + 1;
    state.listingWarehouseRequestToken = Number(state.listingWarehouseRequestToken || 0) + 1;
    state.stockEvidenceRequestToken = Number(state.stockEvidenceRequestToken || 0) + 1;
    state.stockSnapshotProducts = null;
    state.stockWarehouses = null;
    state.stockSnapshot = null;
    state.stockEvidence = state.stockEvidence ? { ...state.stockEvidence, stale: true, failed: false } : null;
    state.stockDryRun = null;
    // Product rows and their server-observed status are store-scoped too. A
    // store switch must invalidate the old ledger before the new store loads;
    // otherwise an old Offer row remains clickable and can be handed to the
    // newly selected store's inventory workflow.
    state.productRequestToken = Number(state.productRequestToken || 0) + 1;
    state.productRows = [];
    state.productCounts = {};
    state.productReadState = "idle";
    state.productSellerResult = null;
    state.productReadCheckedAt = "";
    state.productLastId = "";
    state.productHasNext = false;
    state.productNextAction = "已切换店铺，请重新读取商品后再进入库存。";
    if ($("#productsTable")) $("#productsTable").innerHTML = "<tr><td colspan=\"9\" class=\"product-empty\">已切换店铺，请重新读取当前店铺商品。</td></tr>";
    if ($("#productNextPage")) $("#productNextPage").disabled = true;
    // Product readiness is a store-scoped readback keyed only by local job id.
    // Clear it on a store switch before the listing panel can render again;
    // otherwise a job from the previous store can remain visibly "ready" until
    // the seller clicks another readback.
    state.productReadinessByJobId = {};
    // The controlled-read receipts are scoped by both store and environment;
    // keep the previous store's proof/receipt from remaining visible after a
    // context switch.
    state.readOperatorReceiptSummary = null;
    state.readOperatorMatrix = null;
    state.readOperatorMatrixEnvironment = "";
    state.readOperatorExecutionSummary = null;
    state.readOperatorExecutionRequestToken = Number(state.readOperatorExecutionRequestToken || 0) + 1;
    renderReadOperatorReceiptStatus();
    renderReadOperatorMatrix();
    renderReadOperatorExecutionStatus();
    renderPromotions();
    renderSecondaryDomainPanels();
    const stockTable = $("#stockTable");
    if (stockTable) stockTable.innerHTML = "<tr><td colspan=\"5\">已切换店铺，请重新读取库存。</td></tr>";
    const stockEvidenceResult = $("#stockEvidenceResult");
    if (stockEvidenceResult && state.stockEvidence) renderStockEvidence({ ...state.stockEvidence, stale: true, products: [], warehouses: [], currentStocks: [] });
    updateStoreHint();
    renderCategoryEvidenceStatus();
    syncStockActionButtons();
    refreshActiveStoreView();
    obsSetContext();
  });
  on("#readOperatorEnvironment", "input", invalidateReadOperatorEnvironmentEvidence);
  on("#readOperatorEnvironment", "change", invalidateReadOperatorEnvironmentEvidence);
  on("#listingReadEnvironment", "input", invalidateStockEvidenceForEnvironment);
  on("#listingReadEnvironment", "change", invalidateStockEvidenceForEnvironment);
  on("#listingReadEnvironment", "input", invalidateOrderEvidenceForEnvironment);
  on("#listingReadEnvironment", "change", invalidateOrderEvidenceForEnvironment);
  on("#listingReadEnvironment", "input", invalidatePromotionEvidenceForEnvironment);
  on("#listingReadEnvironment", "change", invalidatePromotionEvidenceForEnvironment);
  on("#testButton", "click", testApi);
  $("#dashboard")?.addEventListener("click", (event) => {
    const outcomeTarget = event.target.closest("[data-outcome-view]");
    if (outcomeTarget) {
      state.selectedWorkflowRunId = outcomeTarget.dataset.outcomeRunId || state.selectedWorkflowRunId;
      state.selectedWorkflowNodeKey = outcomeTarget.dataset.outcomeNodeKey || state.selectedWorkflowNodeKey;
      activateErpView(outcomeTarget.dataset.outcomeView);
      if (outcomeTarget.dataset.outcomeView === "workflow-console") renderWorkflowConsole();
    }
    const viewTarget = event.target.closest("[data-cockpit-view]");
    if (viewTarget) activateErpView(viewTarget.dataset.cockpitView);
    const pipelineTarget = event.target.closest("[data-pipeline-stage-view]");
    if (pipelineTarget) activateErpView(pipelineTarget.dataset.pipelineStageView);
    const pipelineRunTarget = event.target.closest("[data-pipeline-run-id]");
    if (pipelineRunTarget) {
      state.selectedWorkflowRunId = pipelineRunTarget.dataset.pipelineRunId || "";
      state.selectedWorkflowNodeKey = pipelineRunTarget.dataset.pipelineNodeKey || "";
      activateErpView("workflow-console");
      renderWorkflowConsole();
    }
    const runTarget = event.target.closest("[data-cockpit-run-id]");
    if (runTarget) {
      state.selectedWorkflowRunId = runTarget.dataset.cockpitRunId || "";
      state.selectedWorkflowNodeKey = "";
      activateErpView("workflow-console");
      renderWorkflowConsole();
    }
  });
  document.addEventListener("click", (event) => {
    const currentCaptureReviewTarget = event.target.closest("[data-current-capture-review]");
    if (currentCaptureReviewTarget) {
      reviewCurrentProductFromWorkspace(
        currentCaptureReviewTarget.dataset.currentCaptureReview,
        currentCaptureReviewTarget.dataset.currentCaptureStoreId,
        currentCaptureReviewTarget,
      ).catch((error) => toast(error.message || "确认当前商品失败", "error"));
      return;
    }
    const currentCaptureWorkflowTarget = event.target.closest("[data-current-capture-workflow]");
    if (currentCaptureWorkflowTarget) {
      setBusy(currentCaptureWorkflowTarget, true);
      openCurrentProductDraftFromWorkspace(
        currentCaptureWorkflowTarget.dataset.currentCaptureWorkflow,
        currentCaptureWorkflowTarget.dataset.currentCaptureStoreId,
      )
        .catch((error) => toast(error.message || "打开当前商品资料失败", "error"))
        .finally(() => setBusy(currentCaptureWorkflowTarget, false));
      return;
    }
    const currentCaptureTarget = event.target.closest("[data-current-capture-id]");
    if (currentCaptureTarget) {
      openCurrentCaptureTask(currentCaptureTarget.dataset.currentCaptureId, currentCaptureTarget.dataset.currentCaptureStoreId)
        .catch((error) => toast(error.message || "打开当前商品失败", "error"));
      return;
    }
    const currentWorkflowTarget = event.target.closest("[data-current-workflow-id]");
    if (currentWorkflowTarget) {
      openCurrentProductWorkflowFromWorkspace(
        currentWorkflowTarget.dataset.currentWorkflowId,
        currentWorkflowTarget.dataset.currentWorkflowStoreId,
      ).catch((error) => toast(error.message || "打开当前商品资料失败", "error"));
      return;
    }
    const reviewRepairLocateTarget = event.target.closest("[data-review-repair-locate]");
    if (reviewRepairLocateTarget) {
      event.preventDefault();
      openSellerPayloadIssue(reviewRepairLocateTarget.dataset.runId, reviewRepairLocateTarget);
      return;
    }
    const reviewRepairReturnTarget = event.target.closest("[data-review-repair-return]");
    if (reviewRepairReturnTarget) {
      openReviewRepairDraft(reviewRepairReturnTarget);
      return;
    }
    const variantSourceTarget = event.target.closest("[data-variant-source-task]");
    if (variantSourceTarget) {
      openVariantSourceTask(variantSourceTarget);
      return;
    }
    const fbsOrderDetailTarget = event.target.closest("[data-fbs-order-detail]");
    if (fbsOrderDetailTarget) {
      loadFbsOrderDetail(fbsOrderDetailTarget).catch(() => toast("FBS 货件详情读取失败，请刷新后重试。", "error"));
      return;
    }
    const fbsOrderRetryTarget = event.target.closest("[data-fbs-order-retry]");
    if (fbsOrderRetryTarget) {
      loadOrders({ resetOffset: true }).catch(() => toast("订单重新读取失败，请稍后重试。", "error"));
      return;
    }
    const stockWriteTarget = event.target.closest("[data-confirm-stock-write]");
    if (stockWriteTarget) {
      confirmStockWrite().catch(() => toast("受控库存写入未完成，请刷新后重试。", "error"));
      return;
    }
    const stockReceiptTarget = event.target.closest("[data-save-stock-evidence-receipt]");
    if (stockReceiptTarget) {
      saveStockEvidenceReceipt(stockReceiptTarget).catch(() => toast("只读回执保存未完成，请刷新后重试。", "error"));
      return;
    }
    const readinessReceiptTarget = event.target.closest("[data-save-readiness-evidence-receipt]");
    if (readinessReceiptTarget) {
      saveReadinessEvidenceReceipt(readinessReceiptTarget).catch(() => toast("商品状态只读回执保存未完成，请刷新后重试。", "error"));
      return;
    }
    const stockReadinessTarget = event.target.closest("[data-stock-readiness-offers]");
    if (stockReadinessTarget) {
      openStockReadinessTask(stockReadinessTarget);
      return;
    }
    const promotionStockTarget = event.target.closest("[data-promotion-stock-offer]");
    if (promotionStockTarget) {
      openStockReadinessTask({ dataset: {
        stockReadinessOffers: promotionStockTarget.dataset.promotionStockOffer || "",
        stockReadinessStatus: promotionStockTarget.dataset.stockReadinessStatus || "",
        stockReadinessVerification: promotionStockTarget.dataset.stockReadinessVerification || "",
      } });
      return;
    }
    const productStockTarget = event.target.closest("[data-product-stock-offer]");
    if (productStockTarget) {
      openStockReadinessTask({ dataset: {
        stockReadinessOffers: productStockTarget.dataset.productStockOffer || "",
        stockReadinessStatus: productStockTarget.dataset.stockReadinessStatus || "",
        stockReadinessVerification: productStockTarget.dataset.stockReadinessVerification || "",
      } });
      return;
    }
    const fbsReceiptTarget = event.target.closest("[data-save-fbs-evidence-receipt]");
    if (fbsReceiptTarget) {
      saveFbsEvidenceReceipt(fbsReceiptTarget).catch(() => toast("FBS 只读回执保存未完成，请刷新后重试。", "error"));
      return;
    }
    const fbsSummaryTarget = event.target.closest("[data-load-fbs-evidence-summary]");
    if (fbsSummaryTarget) {
      loadFbsEvidenceSummary(fbsSummaryTarget).catch(() => toast("FBS 回执摘要读取失败，请刷新后重试。", "error"));
      return;
    }
    const mediaPublishTarget = event.target.closest("[data-publish-media-approval]");
    if (mediaPublishTarget) {
      publishMediaApproval(mediaPublishTarget).catch(() => toast("本地媒体批准发布未完成，请刷新后重试。", "error"));
      return;
    }
    const mediaApprovalTarget = event.target.closest("[data-save-media-approval-draft]");
    if (mediaApprovalTarget) {
      saveMediaApprovalDraft(mediaApprovalTarget).catch(() => toast("批准草稿保存未完成，请刷新后重试。", "error"));
      return;
    }
    const readinessTarget = event.target.closest("[data-product-readiness-job-id]");
    if (readinessTarget) {
      loadListingProductReadiness(readinessTarget.dataset.productReadinessJobId).catch((error) => toast(error.message, "error"));
      return;
    }
    const sellerPrimaryTarget = event.target.closest("[data-listing-seller-primary-view]");
    if (sellerPrimaryTarget) {
      state.selectedWorkflowRunId = sellerPrimaryTarget.dataset.listingSellerRunId || state.selectedWorkflowRunId;
      state.selectedWorkflowNodeKey = sellerPrimaryTarget.dataset.listingSellerNodeKey || state.selectedWorkflowNodeKey;
      const target = sellerPrimaryTarget.dataset.listingSellerPrimaryView || "listing";
      const activated = activateErpView(target);
      // Refresh the listing destination from the workflow selected by the
      // seller. Otherwise this click can leave an old product summary visible.
      if (activated && target === "listing") {
        // Primary seller actions (source/category/price/preflight) all land
        // on the current-product workbench; keep the stage explicit so a
        // previously selected research/queue stage cannot swallow the action.
        setListingStage("current-product");
        renderListingSellerTaskSummary();
        renderListingStagePanels();
      }
      if (target === "workflow-console") renderWorkflowConsole();
      const label = sellerPrimaryTarget.textContent?.trim() || "下一步";
      toast(activated ? `已打开：${label}` : "目标页面暂不可用，请刷新后重试。", activated ? "ok" : "error");
      return;
    }
    const taskTarget = event.target.closest(".tab-task-card [data-task-card-view]");
    if (taskTarget) {
      activateErpView(taskTarget.dataset.taskCardView);
      return;
    }
    const listingStageTarget = event.target.closest("[data-listing-stage]");
    if (listingStageTarget) {
      setListingStage(listingStageTarget.dataset.listingStage);
      return;
    }
    const listingStageViewTarget = event.target.closest("[data-listing-stage-view]");
    if (listingStageViewTarget) {
      activateErpView(listingStageViewTarget.dataset.listingStageView);
      return;
    }
    const listingWorkflowActionTarget = event.target.closest("#listingStagePanels [data-workflow-action]");
    if (listingWorkflowActionTarget) {
      state.selectedWorkflowRunId = listingWorkflowActionTarget.dataset.workflowRunId || currentListingWorkflowRun()?.id || state.selectedWorkflowRunId;
      state.selectedWorkflowNodeKey = listingWorkflowActionTarget.dataset.workflowNodeKey || "preflight_check";
      setBusy(listingWorkflowActionTarget, true);
      handleWorkflowAction(listingWorkflowActionTarget.dataset.workflowAction, listingWorkflowActionTarget)
        .catch((error) => toast(error.message, "error"))
        .finally(() => setBusy(listingWorkflowActionTarget, false));
      return;
    }
    const listingPayloadLocatorTarget = event.target.closest("#listingStagePanels [data-payload-path]");
    if (listingPayloadLocatorTarget) {
      event.preventDefault();
      state.selectedWorkflowRunId = currentListingWorkflowRun()?.id || state.selectedWorkflowRunId;
      state.selectedWorkflowNodeKey = "preflight_check";
      activateErpView("workflow-console");
      renderWorkflowConsole();
      window.setTimeout(() => focusWorkflowPayloadIssue(listingPayloadLocatorTarget), 0);
      return;
    }
    const listingTaskViewTarget = event.target.closest("[data-listing-task-view]");
    if (listingTaskViewTarget) {
      state.selectedWorkflowRunId = listingTaskViewTarget.dataset.listingTaskRunId || currentListingWorkflowRun()?.id || state.selectedWorkflowRunId;
      state.selectedWorkflowNodeKey = listingTaskViewTarget.dataset.listingTaskNodeKey || state.selectedWorkflowNodeKey;
      const target = listingTaskViewTarget.dataset.listingTaskView || "";
      if (LISTING_CENTER_STAGES.some((stage) => stage.key === target)) setListingStage(target);
      else activateErpView(target || "listing");
      if (target === "workflow-console") renderWorkflowConsole();
    }
  });
  document.addEventListener("input", (event) => {
    const container = event.target.closest(".listing-media-review")?.querySelector(".listing-media-approval-draft");
    if (container) updateMediaApprovalDraftControl(container);
    const publishContainer = event.target.closest(".listing-media-review")?.querySelector(".listing-media-approval-publish");
    if (publishContainer) updateMediaApprovalPublishControl(publishContainer);
    const stockReceipt = event.target.closest(".stock-evidence-receipt");
    if (stockReceipt) updateStockReceiptControl(stockReceipt);
    const readinessReceipt = event.target.closest(".readiness-evidence-receipt");
    if (readinessReceipt) updateReadinessReceiptControl(readinessReceipt);
    const fbsReceipt = event.target.closest("#orderReceiptControls");
    if (fbsReceipt) updateFbsReceiptControl(fbsReceipt);
  });
  document.addEventListener("change", (event) => {
    const container = event.target.closest(".listing-media-review")?.querySelector(".listing-media-approval-draft");
    if (container) updateMediaApprovalDraftControl(container);
    const publishContainer = event.target.closest(".listing-media-review")?.querySelector(".listing-media-approval-publish");
    if (publishContainer) updateMediaApprovalPublishControl(publishContainer);
    const stockReceipt = event.target.closest(".stock-evidence-receipt");
    if (stockReceipt) updateStockReceiptControl(stockReceipt);
    const readinessReceipt = event.target.closest(".readiness-evidence-receipt");
    if (readinessReceipt) updateReadinessReceiptControl(readinessReceipt);
    const fbsReceipt = event.target.closest("#orderReceiptControls");
    if (fbsReceipt) updateFbsReceiptControl(fbsReceipt);
  });
  on("#refreshDashboard", "click", async () => {
    updateDataFreshness("#dashboardDataFreshness", "loading", "正在同步店铺连通状态和订单数据...");
    updateDataFreshness("#erpDataFreshness", "loading", "数据同步中");
    const apiOk = await testApi();
    const ordersOk = await loadOrders();
    await loadWriteCommandAttention();
    if (apiOk && ordersOk) {
      const message = synchronizedAt("最后同步");
      updateDataFreshness("#dashboardDataFreshness", "success", message);
      updateDataFreshness("#erpDataFreshness", "success", message);
    } else {
      const message = "同步失败；页面中的数据可能已过期，请重试。";
      updateDataFreshness("#dashboardDataFreshness", "error", message);
      updateDataFreshness("#erpDataFreshness", "error", "数据可能已过期");
    }
  });
  on("#refreshCurrentProduct", "click", async () => {
    await loadCaptureBox();
    await loadWorkflowRuns();
    toast("当前真实商品已刷新", "ok");
  });
  on("#refreshWriteCommandAttention", "click", loadWriteCommandAttention);
  on("#loadWarehouses", "click", loadWarehouses);
  // Keep the legacy header action connected to the guarded tuple-read flow;
  // an unbound “读取库存” button made the inventory entry appear inert.
  on("#readStock", "click", readStockReconciliationEvidence);
  on("#loadOrders", "click", () => loadOrders({ resetOffset: true }));
  on("#orderPreviousBatch", "click", loadPreviousOrderBatch);
  on("#orderNextBatch", "click", loadNextOrderBatch);
  on("#orderWarehouse", "change", () => loadOrders({ resetOffset: true }));
  on("#orderService", "change", () => loadOrders({ resetOffset: true }));
  on("#orderSearch", "keydown", (event) => {
    if (event.key === "Enter") loadOrders({ resetOffset: true });
  });
  document.querySelectorAll("#orderStatusTabs .product-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#orderStatusTabs .product-tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      state.orderStatus = tab.dataset.status;
      loadOrders({ resetOffset: true });
    });
  });
  on("#loadProducts", "click", loadProducts);
  on("#productNextPage", "click", () => loadProducts({ append: true }));
  on("#loadPromotions", "click", loadPromotions);
  on("#removePromotionProducts", "click", removePromotionProducts);
  document.querySelectorAll("#promotionProductTabs .product-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#promotionProductTabs .product-tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      state.promotionProductKind = tab.dataset.kind;
      renderPromotionProductRows();
    });
  });
  on("#applyProductSearch", "click", loadProducts);
  on("#productSearch", "keydown", (event) => {
    if (event.key === "Enter") loadProducts();
  });
  document.querySelectorAll("#productStatusTabs .product-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#productStatusTabs .product-tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      state.productStatus = tab.dataset.status;
      renderProducts();
    });
  });
  on("#calculatePrice", "click", calculatePrice);
  on("#loadCategoryTree", "click", loadCategoryTree);
  on("#refreshCategoryCache", "click", refreshCategoryCache);
  on("#autoMatchCategory", "click", autoMatchCategory);
  on("#searchCategory", "click", async () => {
    await searchCategory();
    $("#categoryResults").classList.add("open");
  });
  on("#categoryKeyword", "input", () => {
    window.clearTimeout(state.categorySearchTimer);
    state.categorySearchTimer = window.setTimeout(async () => {
      await searchCategory();
      $("#categoryResults").classList.add("open");
    }, 180);
  });
  on("#categoryKeyword", "focus", async () => {
    await searchCategory();
    $("#categoryResults").classList.add("open");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".category-search-box") && event.target.id !== "searchCategory") {
      $("#categoryResults").classList.remove("open");
    }
    if (!event.target.closest(".attribute-value-combobox")) {
      document.querySelectorAll(".attribute-value-menu.open").forEach((menu) => menu.classList.remove("open"));
    }
  });
  on("#loadListingAttributes", "click", loadListingAttributes);
  on("#saveListingCategoryDraft", "click", saveSelectedCategoryToListingDraft);
  on("#rebuildListingDraft", "click", () => rebuildListingDraftFromCurrentCategory({ preserveText: true, save: true }));
  on("#submitListing", "click", submitListing);
  on("#saveListingDraft", "click", () => saveListingDraft("draft"));
  on("#saveAndSubmitListing", "click", saveAndSubmitListing);
  on("#backToCaptureBox", "click", backToCaptureBox);
  on("#erpSessionForm", "submit", establishErpSession);
  on("#erpSessionLogout", "click", logoutErpSession);
  on("#refreshReadOperatorReceipts", "click", loadReadOperatorReceipts);
  on("#refreshReadOperatorMatrix", "click", loadReadOperatorMatrix);
  on("#refreshSessionProof", "click", loadSessionProofSummary);
  on("#executeReadOperatorCurrentStore", "click", executeCurrentStoreRead);
  on("#refreshRuntimeSafety", "click", loadRuntimeSafetySummary);
  on("#refreshMigrationState", "click", loadMigrationStateAudit);
  on("#refreshDeploymentPreflight", "click", loadDeploymentPreflight);
  on("#copyDeploymentPreflight", "click", copyDeploymentPreflightCommand);
  on("#checkListingTask", "click", checkListingTask);
  on("#previewListingImages", "click", previewListingImages);
  on("#variantSelectAll", "change", (event) => setAllVariantChecked(event.target.checked));
  on("#batchSelectVariants", "click", () => {
    $("#variantSelectAll").checked = true;
    setAllVariantChecked(true);
    toast(`已勾选 ${document.querySelectorAll(".variant-row-check").length} 行变体`);
  });
  on("#addVariantRow", "click", addBlankVariantRow);
  on("#batchDuplicateVariant", "click", addBlankVariantRow);
  on("#batchDeleteVariants", "click", deleteSelectedVariantRows);
  on("#showVariantTips", "click", showVariantTips);
  bindVariantRowActions();
  on("#enableLowestPrice", "change", syncLowestPriceVisibility);
  on("#batchApplyVariantPrice", "click", () =>
    batchApplyVariantFields([".variant-price, #listingPrice", ".variant-old-price, #listingOldPrice", ".variant-min-price, #listingMinPrice"])
  );
  on("#batchApplyVariantSize", "click", () =>
    batchApplyVariantFields([".variant-weight, #listingWeight", ".variant-depth, #listingDepth", ".variant-width, #listingWidth", ".variant-height, #listingHeight"])
  );
  on("#listingName", "input", () => {
    $("#listingNameCount").textContent = $("#listingName").value.length;
  });
  on("#readStock", "click", readStock);
  on("#stockEvidenceRead", "click", readStockReconciliationEvidence);
  on("#stockDryRun", "click", runStockDryRun);
  on("#stockJson", "input", invalidateStockEvidenceOnTargetChange);
  syncStockActionButtons();
  on("#loadStockQueue", "click", loadStockQueue);
  on("#replayStockQueue", "click", replayStockQueueFailures);
  on("#submitPrices", "click", () =>
    submitJsonTextarea($("#submitPrices"), $("#priceJson"), "/api/ozon/prices", "prices")
  );
  // 库存写入不再从原始 JSON 直通；必须先完成只读证据、dry-run 和受控确认流程。
  on("#collect1688", "click", collect1688);
  on("#import1688Fixture", "click", import1688Fixture);
  on("#refreshCaptureBox", "click", async () => {
    await loadCaptureBox();
    toast(`采集箱已刷新：${state.captureRows.length} 个商品`);
  });
  $("#crawlerTaskStart")?.addEventListener("click", createCrawlerTask);
  $("#ozonLearningStart")?.addEventListener("click", createOzonLearningTask);
  $("#ozonBlindStart")?.addEventListener("click", createOzonBlindRun);

$("#analyzeOpportunitiesBtn")?.addEventListener("click", analyzeOzonOpportunities);
$("#analyzeRulesBtn")?.addEventListener("click", analyzeListingRules);

// ====== Pipeline ======
async function loadPipelineStatus() {
  try {
    const data = await api("/api/pipeline/status");
    if (!data) return;
    const badge = $("#pipelineStatusBadge");
    if (badge) {
      badge.textContent = data.status === "running" ? "运行中" : data.status === "completed" ? "已完成" : data.status === "partial" ? "部分完成" : data.status === "failed" ? "失败" : "空闲";
      badge.className = "badge badge-" + (data.status || "idle");
    }
    const steps = data.steps || [];
        document.querySelectorAll(".pipeline-step-card").forEach(function(el) {
      const name = el.dataset.step;
      const step = steps.find(function(s) { return s.name === name; });
      const icon = el.querySelector(".pipeline-step-icon");
      const label = el.querySelector(".pipeline-step-label");
      if (step) {
        var sc = step.status;
        if (icon) icon.className = "pipeline-step-icon" + (sc === "completed" ? " done" : sc === "running" ? " running" : sc === "failed" ? " failed" : sc === "skipped" ? " skipped" : "");
        if (label) label.className = "pipeline-step-label" + (sc === "completed" ? " done" : sc === "running" ? " running" : sc === "failed" ? " failed" : "");
        el.title = step.detail || "";
      } else {
        if (icon) icon.className = "pipeline-step-icon";
        if (label) label.className = "pipeline-step-label";
        el.title = "";
      }
    });;
    const statusText = $("#pipelineStatusText");
    if (statusText) {
      statusText.textContent = data.status === "running" ? "▶ 运行中" : data.status === "completed" ? "✓ 已完成" : data.status === "partial" ? "◐ 部分完成" : data.status === "failed" ? "✗ 失败" : "○ 空闲";
    }
    const startTime = $("#pipelineStartTime");
    if (startTime && data.startedAt) {
      startTime.textContent = "开始: " + new Date(data.startedAt).toLocaleString();
    }
    const progress = $("#pipelineProgress");
    if (progress) {
      const done = steps.filter(function(s) { return s.status === "completed" || s.status === "skipped"; }).length;
      progress.textContent = done + "/" + steps.length + " 步骤完成";
    }
  } catch(e) { /* ignore */ }
}

async function runPipeline() {
  const btn = $("#runPipelineBtn");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "流水线运行中...";
  try {
    startPipelinePolling();
    const data = await api("/api/pipeline/run", { method: "POST", body: "{}" });
    if (data.status === "running") {
      toast("流水线已启动！将在后台逐步执行各步骤");
    } else {
      toast("流水线完成: " + (data.status || "unknown"));
    }
    await loadPipelineStatus();
  } catch(e) { toast("流水线启动失败: " + e.message); }
  btn.disabled = false;
  btn.textContent = "运行分析与采集流水线";
}

$("#runPipelineBtn")?.addEventListener("click", runPipeline);
$("#refreshPipelineBtn")?.addEventListener("click", loadPipelineStatus);

let pipelinePollTimer = null;
function startPipelinePolling() {
  stopPipelinePolling();
  pipelinePollTimer = setInterval(loadPipelineStatus, 3000);
}
function stopPipelinePolling() {
  if (pipelinePollTimer) { clearInterval(pipelinePollTimer); pipelinePollTimer = null; }
}
// Auto-stop polling when leaving pipeline tab
document.querySelectorAll(".tab").forEach(function(t) {
  t.addEventListener("click", function() {
    if (this.dataset.view !== "pipeline") stopPipelinePolling();
  });
});


async function resetPipelineStatus() {
  if (!confirm("重置流水线状态为空闲？")) return;
  await api("/api/pipeline/status", { method: "POST", body: JSON.stringify({reset: true}) });
  await loadPipelineStatus();
  toast("流水线状态已重置");
}

$("#resetPipelineBtn")?.addEventListener("click", resetPipelineStatus);


$("#ozonLearningRefresh")?.addEventListener("click", async () => {
    await loadOzonLearningTasks();
    await loadOzonLearningItems();
    await loadOzonOpportunities();
    await loadOzonImageStyleObservations();
    await loadOzonImageStyleAnalysis();
  await loadAutoListJobs();
    toast("Ozon 竞品学习数据已刷新");
  });
  $("#ozonLearningFilter")?.addEventListener("click", loadOzonLearningItems);
$("#ozonImageStyleRefresh")?.addEventListener("click", loadOzonImageStyleObservations);
$("#ozonImageStyleRebuild")?.addEventListener("click", rebuildOzonImageStyleObservations);
$("#ozonImageStyleAnalyze")?.addEventListener("click", runOzonImageStyleAnalysis);
$("#ozonReferenceGuidanceRun")?.addEventListener("click", runOzonReferenceGuidance);
$("#ozonImage2SubmitFirstPrompt")?.addEventListener("click", submitFirstImage2Prompt);
document.addEventListener("click", (event) => {
  const button = event.target.closest?.(".ozon-image2-poll");
  if (!button) return;
  pollImage2Task(button.dataset.image2TaskId);
});
$("#ozonManualParse")?.addEventListener("click", parseOzonSearchHtml);
  $("#ozonOpportunityFilter")?.addEventListener("click", loadOzonOpportunities);
  $("#autoListRefresh")?.addEventListener("click", loadAutoListJobs);
  $("#autoFlowAutoFix")?.addEventListener("click", runAutoFlowAutoFix);
  $("#workflowRefresh")?.addEventListener("click", loadWorkflowRuns);
  $("#workflowReconcileStale")?.addEventListener("click", async (event) => {
    if (!window.confirm("将超过 2 小时未更新的 running 工作流转为等待人工，不会删除数据。继续吗？")) return;
    const button = event.currentTarget;
    setBusy(button, true);
    try {
      const result = await api("/api/workflows/reconcile-stale", {
        method: "POST",
        body: JSON.stringify({ thresholdHours: 2 }),
      });
      toast(`已治理 ${Number(result.reconciled || 0)} 条陈旧工作流`);
      await loadWorkflowRuns();
    } finally {
      setBusy(button, false);
    }
  });
  $("#erpWorkflowNavigator")?.addEventListener("click", (event) => {
    const step = event.target.closest(".erp-workflow-step");
    if (!step) return;
    document.querySelector(`.tab[data-view="${step.dataset.view}"]`)?.click();
  });
  $("#workflowFilterChips")?.addEventListener("click", (event) => {
    const chip = event.target.closest(".workflow-filter-chip");
    if (!chip) return;
    state.workflowFilter = chip.dataset.filter || "all";
    renderWorkflowConsole();
  });
  $("#toggleSyntheticWorkflows")?.addEventListener("click", () => {
    state.showSyntheticWorkflows = !state.showSyntheticWorkflows;
    const runs = sellerWorkflowRuns();
    if (!runs.some((run) => run.id === state.selectedWorkflowRunId)) {
      state.selectedWorkflowRunId = runs[0]?.id || "";
      state.selectedWorkflowNodeKey = "";
    }
    renderWorkflowConsole();
  });
  $("#listingRulePoolWorkbench")?.addEventListener("input", (event) => {
    if (event.target?.id !== "rulePoolKeyword") return;
    const cursorPosition = event.target.selectionStart ?? String(event.target.value || "").length;
    state.rulePoolFilter.keyword = event.target.value || "";
    renderListingRequiredAttributeRulePoolWorkbench();
    const keywordInput = $("#rulePoolKeyword");
    if (keywordInput) {
      keywordInput.focus();
      keywordInput.setSelectionRange?.(cursorPosition, cursorPosition);
    }
  });
  $("#listingRulePoolWorkbench")?.addEventListener("change", (event) => {
    if (event.target?.id !== "rulePoolStatusFilter") return;
    state.rulePoolFilter.status = event.target.value || "all";
    renderListingRequiredAttributeRulePoolWorkbench();
  });
  $("#workflowRunList")?.addEventListener("click", (event) => {
    const card = event.target.closest(".workflow-run-card");
    if (!card) return;
    state.selectedWorkflowRunId = card.dataset.runId || "";
    state.selectedWorkflowNodeKey = "";
    renderWorkflowConsole();
    renderListingSellerTaskSummary();
  });
  $("#workflowNodeTimeline")?.addEventListener("click", (event) => {
    const card = event.target.closest(".workflow-node-card");
    if (!card) return;
    state.selectedWorkflowNodeKey = card.dataset.nodeKey || "";
    renderWorkflowConsole();
  });
  $("#workflowNodeDetail")?.addEventListener("click", (event) => {
    const locator = event.target.closest("[data-payload-path]");
    if (locator) {
      event.preventDefault();
      focusWorkflowPayloadIssue(locator);
      return;
    }
    const button = event.target.closest("[data-workflow-action]");
    if (!button) return;
    setBusy(button, true);
    handleWorkflowAction(button.dataset.workflowAction, button).catch((error) => toast(error.message, "error")).finally(() => setBusy(button, false));
  });
  $("#cockpitReverseRun")?.addEventListener("click", () => runCockpitAction("reverse").catch((e) => toast(e.message, "error")));
  $("#cockpitPipelineRun")?.addEventListener("click", () => runCockpitAction("pipeline").catch((e) => toast(e.message, "error")));
  $("#cockpitAutoFix")?.addEventListener("click", () => runCockpitAction("autofix").catch((e) => toast(e.message, "error")));
  $("#cockpitRunAll")?.addEventListener("click", () => runCockpitAction("runall").catch((e) => toast(e.message, "error")));
  $("#cockpitRefreshAll")?.addEventListener("click", () => runCockpitAction("refresh").catch((e) => toast(e.message, "error")));
  document.getElementById("ozonOpportunityRows")?.addEventListener("click", (event) => {
    const btn = event.target.closest(".ozon-reverse-1688");
    if (btn) {
      const itemId = btn.dataset.itemId;
      if (itemId) reverseSearch1688(itemId, btn);
    }
  });
  $("#crawlerCookieSave")?.addEventListener("click", () => saveCrawlerCookie().catch((error) => toast(error.message, "error")));
  $("#crawlerCookieClear")?.addEventListener("click", () => clearCrawlerCookie().catch((error) => toast(error.message, "error")));
  $("#crawlerExpandBtn")?.addEventListener("click", () => {
    const seeds = ($("#crawlerExpandSeeds")?.value || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!seeds.length) { toast("请先输入种子词", "error"); return; }
    expandKeywords(seeds, false);
  });
  $("#crawlerExpandAndRunBtn")?.addEventListener("click", () => {
    const seeds = ($("#crawlerExpandSeeds")?.value || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!seeds.length) { toast("请先输入种子词", "error"); return; }
    expandKeywords(seeds, true);
  });
  $("#crawlerTaskRefresh")?.addEventListener("click", async () => {
    await loadOpen1688Status();
    await loadCrawlerWorkerStatus();
    await loadCrawlerTasks();
    await loadCrawlerCandidates();
    toast("自动选品数据已刷新");
  });
  $("#crawlerCandidateFilter")?.addEventListener("click", loadCrawlerCandidates);
  $("#runReverseWorkflow")?.addEventListener("click", runReverseWorkflow);
  document.getElementById("reverseGuidanceRows")?.addEventListener("click", async (event) => {
    const btn = event.target.closest(".reverse-to-draft, .reverse-to-submit");
    if (!btn) return;
    const candidateId = btn.dataset.candidateId || "";
    const opportunityId = btn.dataset.opportunityId || "";
    setBusy(btn, true);
    try {
      if (btn.classList.contains("reverse-to-submit")) {
        await reverseCardToSubmit(candidateId, opportunityId);
      } else {
        await reverseCardToDraft(candidateId, opportunityId);
      }
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(btn, false);
    }
  });
  on("#captureSelectAll", "change", (event) => setAllCapturesChecked(event.target.checked));
  on("#selectAllCaptures", "click", () => {
    $("#captureSelectAll").checked = true;
    setAllCapturesChecked(true);
    toast(`已勾选 ${document.querySelectorAll(".capture-check").length} 个采集商品`);
  });
  on("#batchDraftCaptures", "click", batchGenerateDrafts);
  on("#batchPublishCaptures", "click", batchPublishCaptures);
  const latestCaptureButton = $("#load1688Capture");
  if (latestCaptureButton) latestCaptureButton.addEventListener("click", load1688Capture);
  const applyButton = $("#apply1688ToListing");
  if (applyButton) applyButton.addEventListener("click", () => apply1688ToListing());
  await loadShippingLevels();
  await loadListingWarehouses();
  await loadCaptureBox();
  openCaptureFromDeepLink();
  await loadOpen1688Status();
  await loadCrawlerWorkerStatus();
  await loadCrawlerTasks();
  await loadCrawlerCandidates();
  await loadCrawlerSessionStatus();
  await loadAutoFlowStatus();
  await refreshCoreChainStatus();
  setInterval(() => {
    loadAutoFlowStatus().catch(() => {});
    refreshCoreChainStatus().catch(() => {});
  }, 60000);
  startCrawlerAutoRefresh();
  syncListingStore();
}

init().catch((error) => {
  // A seller needs an actionable recovery state when bootstrap fails. A raw
  // API error alone leaves the otherwise visible shell unusable and may leak
  // technical details; no write is attempted by this recovery path.
  renderAppBootstrapRecovery(error);
  toast("工作台初始化未完成，请按页面提示处理。", "error");
});
